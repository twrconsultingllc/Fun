/* J.A.R.V.I.S. Test's service worker (Session 17 of jarvis/build-plan.html), so the test copy works offline after
 * one visit and can be installed to the home screen.
 *
 * It lives in /Fun/ because the page does, but jarvis-test.html registers it with the page itself as its scope, so it
 * controls no other page on this site. Even inside that page it answers only for Jarvis's own files and lets every
 * other request through untouched (no respondWith at all):
 *
 *   - the page, the knowledge pack and the manifest: network first, so a deploy is never hidden behind a stale copy.
 *     The saved copy is used only when the network fails.
 *   - libraries and models (three.js, the font, the hand tracker, the language module, the QR files, the coastlines,
 *     the full brain's loader, the icons): kept in a cache named after LIB_HASH, a fingerprint of those files.
 *     tests/jarvis-test-sw.test.mjs fails if a file changes and LIB_HASH doesn't, so a new version is never hidden.
 *   - never another site. The supercharger proxy on Vercel is another site, so its requests always go to the network,
 *     and with no network the page reads the supercharger as off. Nothing here caches or answers for it.
 *   - never the full brain's model weights (jarvis/llm/resolve/) or its .wasm: WebLLM keeps its own copy of those.
 *
 * "Update Jarvis" on the page deletes these caches and reloads. On promotion, jarvis.html gets its own copy of this
 * file (jarvis-sw.js, PREFIX 'jarvis-', PAGE 'jarvis.html', its own manifest), so the two never share a cache. */

const PREFIX = 'jarvis-test-';
const PAGE = 'jarvis-test.html';
const LIB_HASH = 'c3be065fdbb619de';
const SHELL = PREFIX + 'shell', LIBS = PREFIX + 'lib-' + LIB_HASH;
const BASE = new URL('./', self.location.href);

// Network first: what can change on any deploy.
const FRESH = [PAGE, 'jarvis/knowledge/pack.json', 'jarvis/app/test.webmanifest'];
// Kept by version: pinned files that only change with a new LIB_HASH.
const LIB = [
    /^jarvis\/vendor\/(?:three\.min\.js|fonts\/[a-z0-9-]+\.woff2)$/,
    /^jarvis\/hands\/[a-z_]+\.(?:js|wasm|task|tflite)$/,
    /^jarvis\/text\/[a-z_]+\.(?:js|wasm|tflite)$/,
    /^jarvis\/qr\/[A-Za-z]+\.js$/,
    /^jarvis\/earth\/land-110m\.json$/,
    /^jarvis\/llm\/(?:web-llm\.js|worker\.js|models\.json)$/,
    /^jarvis\/app\/[a-z0-9-]+\.png$/
];
// Saved when the worker installs, so the first visit is enough to work offline.
const PRECACHE = [
    'jarvis/vendor/fonts/chakra-petch-latin-300-normal.woff2',
    'jarvis/vendor/fonts/chakra-petch-latin-500-normal.woff2',
    'jarvis/vendor/fonts/chakra-petch-latin-700-normal.woff2',
    'jarvis/vendor/three.min.js',
    'jarvis/earth/land-110m.json',
    'jarvis/app/icon-192.png',
    'jarvis/app/icon-512.png'
];

// 'fresh', 'lib', or null for anything this worker must leave alone.
function route(url) {
    let u;
    try { u = new URL(url); } catch { return null; }
    if (u.origin !== BASE.origin || !u.pathname.startsWith(BASE.pathname)) return null;
    const path = u.pathname.slice(BASE.pathname.length);
    if (FRESH.includes(path)) return 'fresh';
    if (LIB.some((r) => r.test(path))) return 'lib';
    return null;
}
const keyOf = (url) => { const u = new URL(url); u.search = ''; u.hash = ''; return u.href; };

self.addEventListener('install', (e) => {
    e.waitUntil((async () => {
        const shell = await caches.open(SHELL);
        const page = await fetch(new URL(PAGE, BASE).href, { cache: 'no-cache' });
        if (page.ok) await shell.put(new URL(PAGE, BASE).href, page);
        const libs = await caches.open(LIBS);
        await Promise.all(PRECACHE.map(async (f) => {
            const url = new URL(f, BASE).href;
            if (await libs.match(url)) return;
            try { const r = await fetch(url, { cache: 'no-cache' }); if (r.ok) await libs.put(url, r); } catch { /* fetched on first use instead */ }
        }));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (e) => {
    e.waitUntil((async () => {
        for (const k of await caches.keys()) if (k.startsWith(PREFIX) && k !== SHELL && k !== LIBS) await caches.delete(k);
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (e) => {
    const r = e.request;
    if (r.method !== 'GET' || r.headers.has('range')) return;
    const kind = route(r.url);
    if (!kind) return; // straight through, untouched
    e.respondWith(kind === 'fresh' ? fresh(r) : lib(r));
});

async function fresh(req) {
    const key = keyOf(req.url);
    try {
        // A navigation request can't be refetched with options, so the URL is fetched instead, revalidated past the
        // browser's own cache (GitHub Pages sends max-age=600), so a deploy shows on the next load.
        const res = await fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' });
        if (res.redirected) return fetch(req);
        if (res.ok && res.type === 'basic') { const c = await caches.open(SHELL); await c.put(key, res.clone()); }
        return res;
    } catch (err) {
        const hit = await (await caches.open(SHELL)).match(key);
        if (hit) return hit;
        throw err;
    }
}

async function lib(req) {
    const key = keyOf(req.url), c = await caches.open(LIBS);
    const hit = await c.match(key);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') await c.put(key, res.clone());
    return res;
}
