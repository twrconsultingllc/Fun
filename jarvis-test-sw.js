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
 *   - his recorded voice (Session 18): jarvis/voice/manifest.json network first like the page, and the recordings
 *     (jarvis/voice/<skin>/<fingerprint>.mp3) kept once played, in a cache of their own. A recording's name is a
 *     fingerprint of its words and voice, so a new recording is a new name and an old one is never stale. The cache
 *     keeps the newest VOICE_MAX. Lines voiced live are kept by the page itself in PREFIX + 'voice-live'.
 *   - never another site. The supercharger proxy on Vercel is another site, so its requests always go to the network,
 *     and with no network the page reads the supercharger as off. Nothing here caches or answers for it.
 *   - never the full brain's model weights (jarvis/llm/resolve/) or its .wasm: WebLLM keeps its own copy of those.
 *
 * "Update Jarvis" on the page deletes these caches and reloads. jarvis.html has its own copy of this file since the
 * promotion on 2026-10-12 (jarvis-sw.js: PREFIX 'jarvis-main-', PAGE 'jarvis.html', its own manifest), so the two
 * never share a scope, a cache or an install. Neither prefix may start the other: 'jarvis-' would match these. */

const PREFIX = 'jarvis-test-';
const PAGE = 'jarvis-test.html';
const LIB_HASH = 'c3be065fdbb619de';
const SHELL = PREFIX + 'shell', LIBS = PREFIX + 'lib-' + LIB_HASH, VOICE = PREFIX + 'voice', VOICE_LIVE = PREFIX + 'voice-live', VOICE_MAX = 2000;
const BASE = new URL('./', self.location.href);

// Network first: what can change on any deploy.
const VOICE_MANIFEST = 'jarvis/voice/manifest.json';
const FRESH = [PAGE, 'jarvis/knowledge/pack.json', 'jarvis/app/test.webmanifest', VOICE_MANIFEST];
const VOICE_FILE = /^jarvis\/voice\/(?:jarvis|matrix|panther)\/[a-f0-9]{16}\.mp3$/;
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

// 'fresh', 'lib', 'voice', or null for anything this worker must leave alone.
function route(url) {
    let u;
    try { u = new URL(url); } catch { return null; }
    if (u.origin !== BASE.origin || !u.pathname.startsWith(BASE.pathname)) return null;
    const path = u.pathname.slice(BASE.pathname.length);
    if (FRESH.includes(path)) return 'fresh';
    if (LIB.some((r) => r.test(path))) return 'lib';
    if (VOICE_FILE.test(path)) return 'voice';
    return null;
}
const keyOf = (url) => { const u = new URL(url); u.search = ''; u.hash = ''; return u.href; };

self.addEventListener('install', (e) => {
    e.waitUntil((async () => {
        const shell = await caches.open(SHELL);
        const page = await fetch(new URL(PAGE, BASE).href, { cache: 'no-cache' });
        if (page.ok) await shell.put(new URL(PAGE, BASE).href, page);
        // Session 18: the recordings' manifest too, so his recorded voice works offline after one visit, even when the
        // page read it before this worker took over.
        try { const m = await fetch(new URL(VOICE_MANIFEST, BASE).href, { cache: 'no-cache' }); if (m.ok) await shell.put(new URL(VOICE_MANIFEST, BASE).href, m); } catch { /* fetched on first use instead */ }
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
        for (const k of await caches.keys()) if (k.startsWith(PREFIX) && ![SHELL, LIBS, VOICE, VOICE_LIVE].includes(k)) await caches.delete(k);
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (e) => {
    const r = e.request;
    if (r.method !== 'GET' || r.headers.has('range')) return;
    const kind = route(r.url);
    if (!kind) return; // straight through, untouched
    e.respondWith(kind === 'fresh' ? fresh(r) : kind === 'voice' ? voice(r) : lib(r));
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

async function voice(req) {
    const key = keyOf(req.url), c = await caches.open(VOICE);
    const hit = await c.match(key);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') {
        await c.put(key, res.clone());
        const keys = await c.keys();
        for (const k of keys.slice(0, Math.max(0, keys.length - VOICE_MAX))) await c.delete(k);
    }
    return res;
}
