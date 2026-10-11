/* jarvis-test-sw.js, the test copy's service worker (Session 17 of jarvis/build-plan.html), and its install manifest.
 *
 * The worker is run here in a node:vm sandbox with a fake `self`, a fake Cache Storage and a fake network, so every
 * rule is checked as an event the browser would send: which requests it answers and which it leaves alone (other
 * pages, other sites, and above all the supercharger proxy on Vercel, which it must never cache or answer), the page
 * fetched from the network first with the saved copy only when offline, a new deploy picked up on the next online
 * load, libraries kept by version, and old versions deleted. The real thing in Chromium (registration, offline
 * reload, no request leaving the site) is checked in tests/jarvis-test.chromium.mjs.
 *
 * LIB_HASH is a fingerprint of the library files the worker keeps. It's worked out again here from the files
 * themselves, so changing one without changing LIB_HASH fails this suite: a stale library can't hide behind the cache.
 *
 * Registered against jarvis-test.html, so --page=jarvis-test.html runs it. */

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

export const name = 'J.A.R.V.I.S. Test service worker and manifest (jarvis-test-sw.js)';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SITE = 'https://twrconsultingllc.github.io/Fun/';
const PROXY = 'https://jarvis-cloud-gamma.vercel.app';

// Fake Cache Storage, keyed by URL string.
function fakeCaches() {
    const store = new Map();
    const keyOf = (r) => (typeof r === 'string' ? r : r.url);
    const open = async (n) => {
        if (!store.has(n)) store.set(n, new Map());
        const m = store.get(n);
        return {
            match: async (r) => { const v = m.get(keyOf(r)); return v ? v.clone() : undefined; },
            put: async (r, res) => { m.set(keyOf(r), res.clone()); },
            add: async () => { throw new Error('add is not used'); },
            keys: async () => [...m.keys()]
        };
    };
    return {
        store,
        api: {
            open,
            keys: async () => [...store.keys()],
            delete: async (n) => store.delete(n),
            has: async (n) => store.has(n),
            match: async (r) => { for (const m of store.values()) { const v = m.get(keyOf(r)); if (v) return v.clone(); } return undefined; }
        }
    };
}

// Loads the worker into a sandbox. net(url, init) answers fetches: a Response, or throws for "offline".
async function loadWorker(src, net) {
    const listeners = {}, calls = [], caches = fakeCaches();
    const self = {
        location: new URL('jarvis-test-sw.js', SITE),
        addEventListener: (t, f) => { listeners[t] = f; },
        skipWaiting: async () => { self.skipped = true; },
        clients: { claim: async () => { self.claimed = true; } }
    };
    const fetch = async (input, init = {}) => {
        const url = typeof input === 'string' ? input : input.url;
        calls.push({ url, init });
        return net(url, init);
    };
    const ctx = vm.createContext({ self, caches: caches.api, fetch, URL, Request, Response, Headers, Promise, console });
    vm.runInContext(src + '\n;globalThis.__sw={route,PREFIX,PAGE,LIB_HASH,SHELL,LIBS,PRECACHE,FRESH};', ctx);
    const sw = ctx.__sw;
    const lifecycle = async (type) => { let p; listeners[type]({ waitUntil: (x) => { p = x; } }); await p; };
    // A fetch event: whether the worker answered it, and with what.
    const request = async (url, init = {}) => {
        const req = new Request(url, init);
        let answered = null;
        listeners.fetch({ request: req, respondWith: (p) => { answered = p; } });
        if (!answered) return { answered: false };
        try { const res = await answered; return { answered: true, res, text: await res.text() }; } catch (e) { return { answered: true, error: e }; }
    };
    return { sw, self, caches, calls, lifecycle, request };
}

async function walk(dir) {
    const out = [];
    for (const e of await readdir(dir, { withFileTypes: true })) {
        const p = dir + e.name;
        if (e.isDirectory()) out.push(...await walk(p + '/'));
        else out.push(p);
    }
    return out;
}
// The fingerprint LIB_HASH must equal: every file the worker keeps by version, sorted by path, with its SHA-256.
export async function libHash(route) {
    const files = (await walk(ROOT + 'jarvis/')).map((f) => f.slice(ROOT.length)).filter((p) => route(SITE + p) === 'lib').sort();
    const h = createHash('sha256');
    for (const p of files) h.update(p + '\n' + createHash('sha256').update(await readFile(ROOT + p)).digest('hex') + '\n');
    return { hash: h.digest('hex').slice(0, 16), files };
}

export default async function run(t, page) {
    const src = await readFile(ROOT + 'jarvis-test-sw.js', 'utf8');
    let deploy = 'page v1', online = true;
    const net = async (url) => {
        if (!online) throw new TypeError('Failed to fetch');
        const u = new URL(url);
        if (u.href === SITE + 'jarvis-test.html') return new Response(deploy, { status: 200 });
        return new Response('net:' + u.pathname, { status: 200 });
    };
    // Response.type is 'basic' for a same-origin fetch in a browser, but 'default' for one made in Node. The worker
    // saves only 'basic' responses, so the fake network marks them the way a browser would.
    const basic = (fn) => async (url, init) => { const r = await fn(url, init); Object.defineProperty(r, 'type', { value: new URL(url).origin === new URL(SITE).origin ? 'basic' : 'cors' }); return r; };
    const W = await loadWorker(src, basic(net));
    const { sw } = W;

    t.section('Service worker: what it answers, and what it leaves alone');
    for (const p of ['jarvis-test.html', 'jarvis/knowledge/pack.json', 'jarvis/app/test.webmanifest']) t.eq(`${p}: network first`, sw.route(SITE + p), 'fresh');
    t.eq('the page with a query string too', sw.route(SITE + 'jarvis-test.html?x=1'), 'fresh');
    for (const p of ['jarvis/vendor/three.min.js', 'jarvis/vendor/fonts/chakra-petch-latin-500-normal.woff2', 'jarvis/hands/vision_bundle.js', 'jarvis/hands/hand_landmarker.task',
        'jarvis/text/text_wasm_internal.wasm', 'jarvis/text/universal_sentence_encoder.tflite', 'jarvis/qr/qrcode.js', 'jarvis/earth/land-110m.json',
        'jarvis/llm/web-llm.js', 'jarvis/llm/worker.js', 'jarvis/llm/models.json', 'jarvis/app/icon-192.png']) t.eq(`${p}: kept by version`, sw.route(SITE + p), 'lib');
    const untouched = [
        [SITE + 'index.html', 'the landing page'], [SITE + 'jarvis.html', 'the main J.A.R.V.I.S. page'], [SITE + 'snake.html', 'another page'],
        [SITE, 'the site root'], [SITE + 'jarvis/build-plan.html', 'the build plan'], [SITE + 'jarvis/cloud/README.md', 'the proxy source'],
        [SITE + 'jarvis/llm/resolve/Qwen3-0.6B-q4f16_1-MLC/params_shard_0.bin', "the full brain's weights (WebLLM keeps its own copy)"],
        [SITE + 'jarvis/llm/Qwen3-0.6B-q4f16_1_cs1k-webgpu.wasm', "the full brain's .wasm (WebLLM's too)"],
        [SITE + 'jarvis/hands/README.md', 'a README'], [SITE + 'tests/secrpts/73.html', 'a review'], [SITE + 'jarvis-test-sw.js', 'the worker itself'],
        [PROXY + '/api/status', 'the supercharger status'], [PROXY + '/api/brain', 'the supercharger brain'],
        ['https://twrconsultingllc.github.io/other/jarvis-test.html', 'the same name in another repo'], ['https://twrconsultingllc.github.io/jarvis-test.html', 'the same name above /Fun/'],
        ['https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', 'cdnjs'], ['https://fonts.gstatic.com/x.woff2', 'Google Fonts'], ['http://twrconsultingllc.github.io/Fun/jarvis-test.html', 'plain http']];
    for (const [u, what] of untouched) t.eq(`left alone: ${what}`, sw.route(u), null);

    t.section('Service worker: the supercharger proxy is never cached or answered');
    for (const path of ['/api/status', '/api/brain']) {
        const n = W.calls.length;
        const r = await W.request(PROXY + path);
        t.ok(`GET ${path}: no respondWith, so it goes straight to the network`, !r.answered);
        t.eq('and the worker made no request of its own for it', W.calls.length, n);
    }
    const post = await W.request(PROXY + '/api/brain', { method: 'POST', body: '{"q":"hi"}' });
    t.ok('POST /api/brain: not answered', !post.answered);
    t.ok('a POST to the page itself is not answered either', !(await W.request(SITE + 'jarvis-test.html', { method: 'POST', body: 'x' })).answered);
    t.ok('nor a range request for a library', !(await W.request(SITE + 'jarvis/vendor/three.min.js', { headers: { range: 'bytes=0-10' } })).answered);
    t.ok('other pages pass through untouched too', !(await W.request(SITE + 'index.html')).answered && !(await W.request(SITE + 'jarvis.html')).answered);

    t.section('Service worker: install and activate');
    W.caches.store.set('jarvis-test-lib-0123456789abcdef', new Map([['x', new Response('old')]]));
    W.caches.store.set('jarvis-test-old-shell', new Map());
    W.caches.store.set('jarvis-shell', new Map());       // what the main page's worker will use after promotion
    W.caches.store.set('webllm/model', new Map());       // the full brain's own copy
    await W.lifecycle('install');
    const shell = W.caches.store.get(sw.SHELL), libs = W.caches.store.get(sw.LIBS);
    t.ok('the page is saved when the worker installs, so one visit is enough', !!shell && shell.has(SITE + 'jarvis-test.html'));
    t.ok('and every PRECACHE file is saved under the current version', !!libs && sw.PRECACHE.every((f) => libs.has(SITE + f)));
    t.ok('every PRECACHE file is one the worker keeps by version', sw.PRECACHE.every((f) => sw.route(SITE + f) === 'lib'));
    t.ok('the font, three.js and the coastlines are among them', ['jarvis/vendor/three.min.js', 'jarvis/earth/land-110m.json'].every((f) => sw.PRECACHE.includes(f)) && sw.PRECACHE.filter((f) => /\.woff2$/.test(f)).length === 3);
    t.ok('nothing from the proxy was fetched while installing', !W.calls.some((c) => c.url.startsWith(PROXY)));
    t.ok('it takes over at once (skipWaiting)', W.self.skipped === true);
    await W.lifecycle('activate');
    const names = [...W.caches.store.keys()];
    t.ok("activating deletes this page's old versions", !names.includes('jarvis-test-lib-0123456789abcdef') && !names.includes('jarvis-test-old-shell'));
    t.ok("and keeps everyone else's caches (the main page's, WebLLM's)", names.includes('jarvis-shell') && names.includes('webllm/model'));
    t.ok('and claims the open page', W.self.claimed === true);

    t.section('Service worker: the page, network first');
    deploy = 'page v2';
    const c0 = W.calls.length;
    let r = await W.request(SITE + 'jarvis-test.html');
    t.eq('online, the page comes from the network', r.text, 'page v2');
    const pageCalls = W.calls.slice(c0);
    t.ok('fetched past the browser cache (no-cache), so a deploy is never hidden', pageCalls.length === 1 && pageCalls[0].url === SITE + 'jarvis-test.html' && pageCalls[0].init.cache === 'no-cache');
    online = false;
    r = await W.request(SITE + 'jarvis-test.html');
    t.eq('offline, the saved copy is used', r.text, 'page v2');
    r = await W.request(SITE + 'jarvis-test.html?from=home');
    t.eq('with a query string as well', r.text, 'page v2');
    online = true; deploy = 'page v3';
    r = await W.request(SITE + 'jarvis-test.html');
    t.eq('a new deploy is picked up on the next online load', r.text, 'page v3');
    online = false;
    t.eq('and becomes the offline copy', (await W.request(SITE + 'jarvis-test.html')).text, 'page v3');
    const pack = await W.request(SITE + 'jarvis/knowledge/pack.json');
    t.ok('the knowledge pack never fetched online yet: offline it fails rather than inventing an answer', !!pack.error);
    online = true;

    t.section('Service worker: libraries kept by version');
    const n0 = W.calls.length;
    r = await W.request(SITE + 'jarvis/hands/vision_bundle.js');
    t.eq('a library not yet saved comes from the network', r.text, 'net:/Fun/jarvis/hands/vision_bundle.js');
    t.eq('once', W.calls.length, n0 + 1);
    online = false;
    r = await W.request(SITE + 'jarvis/hands/vision_bundle.js');
    t.eq('then from the cache, even offline', r.text, 'net:/Fun/jarvis/hands/vision_bundle.js');
    t.eq('without touching the network', W.calls.length, n0 + 1);
    t.eq('three.js is there offline from the first visit', (await W.request(SITE + 'jarvis/vendor/three.min.js')).text, 'net:/Fun/jarvis/vendor/three.min.js');
    online = true;
    const W2 = await loadWorker(src, basic(async () => new Response('nope', { status: 404 })));
    await W2.request(SITE + 'jarvis/qr/qrcode.js');
    t.ok('a failed answer (404) is never saved', ![...W2.caches.store.values()].some((m) => m.size));

    t.section('Service worker: LIB_HASH matches the files it keeps');
    const { hash, files } = await libHash(sw.route);
    t.eq('LIB_HASH is the fingerprint of the library files', sw.LIB_HASH, hash);
    t.ok(`it covers the files it should (${files.length})`, files.includes('jarvis/vendor/three.min.js') && files.includes('jarvis/text/universal_sentence_encoder.tflite') && files.some((f) => f.startsWith('jarvis/app/')));
    t.ok('and no README, source or build script', !files.some((f) => /\.(?:md|mjs|html)$|README|LICENSE/.test(f)));
    t.ok('the cache names carry the prefix, so "update Jarvis" and activate can find them', sw.SHELL.startsWith('jarvis-test-') && sw.LIBS.startsWith('jarvis-test-lib-'));
    t.eq('the prefix is the one the page clears', sw.PREFIX, (page.html.match(/CACHE_PREFIX='([^']+)'/) || [])[1]);

    t.section('Install to home screen: the manifest');
    const html = page.html;
    t.ok('the page links its manifest', /<link rel="manifest" href="jarvis\/app\/test\.webmanifest">/.test(html));
    const mf = JSON.parse(await readFile(ROOT + 'jarvis/app/test.webmanifest', 'utf8'));
    const MF = SITE + 'jarvis/app/test.webmanifest', start = new URL(mf.start_url, MF).href;
    t.eq('start_url opens the test copy', start, SITE + 'jarvis-test.html');
    t.eq('its scope is the test copy alone', new URL(mf.scope, MF).href, SITE + 'jarvis-test.html');
    t.eq('its id is the test copy (so the main page can be installed separately later)', new URL(mf.id, start).href, SITE + 'jarvis-test.html');
    t.ok('it is marked as the test copy', /Test/.test(mf.name) && /Test/.test(mf.short_name));
    t.ok('full screen, no browser bar', mf.display_override?.[0] === 'fullscreen' && mf.display === 'standalone');
    t.eq('dark like the page', [mf.background_color, mf.theme_color].join(), '#020a06,#020a06');
    const png = async (f) => { const b = await readFile(ROOT + f); return b.readUInt32BE(0) === 0x89504e47 ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null; };
    for (const ic of mf.icons) {
        const [w, h] = (await png('jarvis/app/' + ic.src)) || [0, 0];
        t.eq(`icon ${ic.src} is a ${ic.sizes} PNG`, `${w}x${h}`, ic.sizes);
    }
    t.ok('there is a maskable icon for Android', mf.icons.some((i) => i.purpose === 'maskable'));
    t.ok('and a home-screen icon for iPhone', /<link rel="apple-touch-icon" href="jarvis\/app\/icon-180\.png">/.test(html) && String(await png('jarvis/app/icon-180.png')) === '180,180');
    t.ok('the manifest loads only from this site', !/https?:/.test(JSON.stringify(mf)));
    t.ok('the page registers this worker, scoped to itself', /SW_URL='jarvis-test-sw\.js',SW_SCOPE='\.\/jarvis-test\.html'/.test(html) && /serviceWorker\.register\(SW_URL,\{scope:SW_SCOPE\}\)/.test(html));
}
