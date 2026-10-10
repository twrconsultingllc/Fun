/* jarvis-test.html in a real browser: Session 9's IndexedDB storage, checked in headless Chromium.
 *
 * jsdom has no IndexedDB, so jarvis-test.dom.test.mjs uses fake-indexeddb. This script checks the real one,
 * in one browser profile, the way you'd use the two pages in one browser:
 *   1. jarvis.html saves a skin, an orb colour and a taught phrase in localStorage.
 *   2. jarvis-test.html copies them in once, saves its own changes to its own database, and keeps them
 *      across a reload, while localStorage stays exactly as jarvis.html left it.
 *   3. jarvis.html, opened again in the same profile, still has its own settings, and the test copy's
 *      database reads back the same before and after.
 * It also takes screenshots of the booted page and the memory core at 1280×800 and 390×844, and fails on
 * any page error or CSP violation.
 *
 * It isn't part of run.mjs, because it needs Playwright and Chromium, which the claude.ai/code containers
 * have and the Codespace doesn't (see "Browsers and screenshots" in CLAUDE.md). Run it from tests/:
 *
 *   node jarvis-test.chromium.mjs
 *   node jarvis-test.chromium.mjs --out=/some/dir --three=/path/to/three.min.js
 *
 * The pages are served from the working copy by a small static server on 127.0.0.1, because the hand
 * tracker and the coastlines need HTTP, not file://, and so the real CSP applies. cdnjs is often blocked
 * from the containers, so three.js r128 comes from npm (byte-identical to cdnjs's, so the page's SRI hash
 * still checks it) unless --three names a copy. Without three.js the memory-core checks are skipped and
 * say so. Screenshots go to --out (a new temp folder by default). Exit code 0 when every check passes. */

import { createServer } from 'node:http';
import { readFile, mkdtemp, rm, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, sep, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const work = await mkdtemp(join(tmpdir(), 'jarvis-chromium-'));
const OUT = arg('out') ? resolve(arg('out')) : work;
const exists = (p) => access(p).then(() => true, () => false);

async function loadPlaywright() {
    for (const spec of ['playwright', '/opt/node22/lib/node_modules/playwright/index.mjs']) {
        try { return await import(spec); } catch { /* try the next */ }
    }
    throw new Error('Playwright is not installed. This needs a claude.ai/code container or a machine with Playwright and Chromium.');
}

async function threeJs() {
    if (arg('three')) return resolve(arg('three'));
    try {
        execFileSync('npm', ['pack', 'three@0.128.0', '--silent'], { cwd: work, stdio: 'ignore' });
        execFileSync('tar', ['xzf', 'three-0.128.0.tgz'], { cwd: work });
        const p = join(work, 'package/build/three.min.js');
        return (await exists(p)) ? p : null;
    } catch { return null; }
}

// Serves the working copy, read only, and nothing outside it.
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.json': 'application/json',
    '.wasm': 'application/wasm', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
function serve() {
    const server = createServer(async (req, res) => {
        let path;
        try { path = resolve(ROOT, '.' + decodeURIComponent(new URL(req.url, 'http://x').pathname)); } catch { res.writeHead(400).end(); return; }
        if (path !== ROOT && !path.startsWith(ROOT + sep)) { res.writeHead(403).end(); return; }
        try {
            const body = await readFile(path);
            res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }).end(body);
        } catch { res.writeHead(404).end(); }
    });
    return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

const results = [], problems = [];
const ok = (name, cond, extra = '') => results.push({ pass: !!cond, line: `${cond ? 'ok  ' : 'FAIL'} ${name}${!cond && extra ? '  (got ' + extra + ')' : ''}` });
const sorted = (o) => JSON.stringify(o, Object.keys(o).sort());

const { chromium } = await loadPlaywright();
const three = await threeJs();
const server = await serve();
const BASE = `http://127.0.0.1:${server.address().port}/`;
const executablePath = (await exists('/opt/pw-browsers/chromium')) ? '/opt/pw-browsers/chromium' : undefined;
const ctx = await chromium.launchPersistentContext(join(work, 'profile'), { executablePath, headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], viewport: { width: 1280, height: 800 } });
if (three) await ctx.route('https://cdnjs.cloudflare.com/**', (r) => r.fulfill({ path: three, contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' } }));
await ctx.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));

async function open(file, size = { width: 1280, height: 800 }) {
    const page = await ctx.newPage(); await page.setViewportSize(size);
    page.on('pageerror', (e) => problems.push(`${file} page error: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' || /Refused/.test(m.text())) problems.push(`${file} console: ${m.text()}`); });
    await page.goto(BASE + file); await page.waitForFunction(() => window.__jarvis);
    if (file === 'jarvis-test.html') await page.evaluate(() => window.__jarvis.ready);
    return page;
}
const lsOf = (p) => p.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) o[localStorage.key(i)] = localStorage.getItem(localStorage.key(i)); return o; });
// The test copy's database, read straight from IndexedDB in the page's origin, not from the page's own copy.
const dbOf = (p) => p.evaluate(async () => {
    const names = (await indexedDB.databases()).map((d) => d.name);
    if (!names.includes('jarvis-test')) return { names };
    return new Promise((res) => { const rq = indexedDB.open('jarvis-test'); rq.onsuccess = () => { const db = rq.result, out = { names }, tx = db.transaction([...db.objectStoreNames], 'readonly');
        for (const t of db.objectStoreNames) { out[t] = {}; const c = tx.objectStore(t).openCursor(); c.onsuccess = () => { const k = c.result; if (!k) return; out[t][JSON.stringify(k.key)] = k.value; k.continue(); }; }
        tx.oncomplete = () => { db.close(); res(out); }; }; });
});
const memoryCore = async (page, shot) => {
    await page.evaluate(async () => { await window.__jarvis.answer('show me your memory'); }); await page.waitForTimeout(2500);
    await page.screenshot({ path: join(OUT, shot) });
    return page.evaluate(() => [...document.querySelectorAll('#mem-labels *')].map((e) => e.textContent).join(' | '));
};

try {
    // 1. jarvis.html saves its settings the way a person would.
    let main = await open('jarvis.html');
    await main.evaluate(async () => { const J = window.__jarvis; await J.answer('switch to panthers'); await J.answer('make the orb pink'); await J.answer('beam me up'); await J.answer('I meant flip a coin'); });
    const mainLS = await lsOf(main);
    ok('jarvis.html saves its settings in localStorage', mainLS['jarvis-skin'] === 'panther' && /pink/.test(mainLS['jarvis-settings']) && /beam me up/.test(mainLS['jarvis-learned']), sorted(mainLS));
    ok('jarvis.html makes no database', !(await main.evaluate(async () => (await indexedDB.databases()).length)));
    await main.close();

    // 2. The test copy.
    let test = await open('jarvis-test.html');
    let st = await test.evaluate(() => ({ skin: window.__jarvis.skin(), color: window.__jarvis.settings().color, dbOK: window.__jarvis.dbOK() }));
    ok('the test copy copies jarvis.html\'s settings in on its first run', st.skin === 'panther' && st.color === 'pink' && st.dbOK, JSON.stringify(st));
    await test.evaluate(async () => { const J = window.__jarvis; await J.answer('switch to the matrix'); await J.answer('make the orb blue'); await J.answer('tell me a joke'); await J.answer('show me the galaxy'); await J.answer('close'); });
    await test.reload(); await test.waitForFunction(() => window.__jarvis); await test.evaluate(() => window.__jarvis.ready);
    st = await test.evaluate(() => ({ skin: window.__jarvis.skin(), color: window.__jarvis.settings().color, first: window.__jarvis.firstTime }));
    ok('after a reload it keeps its own settings', st.skin === 'matrix' && st.color === 'blue' && st.first === false, JSON.stringify(st));
    const db = await dbOf(test), evs = Object.values(db.events || {});
    ok('its database holds them', /matrix/.test(db.kept?.['"jarvis-skin"']) && /blue/.test(db.kept?.['"jarvis-settings"']), JSON.stringify(db.kept));
    ok('usage counts are {id, day, n} and nothing else', evs.length > 0 && evs.every((e) => Object.keys(e).sort().join() === 'day,id,n'), JSON.stringify(evs));
    // app:visit is 3: one carried from jarvis.html's own streak for today, plus the test copy's two loads.
    ok('today\'s counts: 3 visits, a joke, the galaxy, Morpheus', ['app:visit:3', 'cmd:joke:1', 'scene:galaxy:1', 'skin:matrix:1'].every((x) => { const [a, b, n] = x.split(':'); return evs.some((e) => e.id === `${a}:${b}` && e.n === +n); }), JSON.stringify(evs));
    ok('no words or dates in the database', !/joke me|show me|20\d\d-\d\d/.test(JSON.stringify(db)));
    ok('localStorage is exactly as jarvis.html left it', sorted(await lsOf(test)) === sorted(mainLS), sorted(await lsOf(test)));
    ok('"what do you save" mentions the counts', /Counts of which scenes and commands you use, by day\. Nothing you say\./.test(await test.evaluate(() => window.__jarvis.answer('what do you save'))));
    await test.click('#boot-skip'); await test.waitForTimeout(1500);
    await test.screenshot({ path: join(OUT, 'jarvis-test-1280.png') });
    if (three) ok('the memory core shows a Usage history star', /Usage history/.test(await memoryCore(test, 'memory-core-1280.png')));
    const dbBefore = JSON.stringify(await dbOf(test));
    await test.close();

    // 3. jarvis.html again, in the same profile.
    main = await open('jarvis.html');
    const m2 = await main.evaluate(() => ({ skin: window.__jarvis.skin(), color: window.__jarvis.settings().color, learned: window.__jarvis.learned()['beam me up'] }));
    ok('jarvis.html still has its own skin, colour and taught phrase', m2.skin === 'panther' && m2.color === 'pink' && m2.learned === 'flip a coin', JSON.stringify(m2));
    await main.waitForTimeout(500);
    ok('its localStorage is unchanged', sorted(await lsOf(main)) === sorted(mainLS), sorted(await lsOf(main)));
    ok('and the test copy\'s database is untouched by it', JSON.stringify(await dbOf(main)) === dbBefore);
    await main.close();

    // Phone size.
    test = await open('jarvis-test.html', { width: 390, height: 844 });
    await test.click('#boot-skip'); await test.waitForTimeout(1500);
    await test.screenshot({ path: join(OUT, 'jarvis-test-390.png') });
    if (three) ok('the Usage history star at phone size', /Usage history/.test(await memoryCore(test, 'memory-core-390.png')));
    ok('no sideways scroll at phone size', await test.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await test.close();
} finally {
    await ctx.close();
    server.close();
    await rm(join(work, 'profile'), { recursive: true, force: true });
}

ok('no page errors or CSP violations', !problems.length);
console.log(results.map((r) => r.line).join('\n'));
if (problems.length) console.log('\n' + problems.join('\n'));
if (!three) console.log('\nskipped: the memory-core checks (three.js could not be fetched from npm; pass --three=<path>)');
console.log(`\nscreenshots: ${OUT}`);
const failed = results.filter((r) => !r.pass).length;
console.log(failed ? `${failed} failed` : `${results.length} passed`);
process.exit(failed ? 1 : 0);
