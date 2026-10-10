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
 * Session 10 added step 4: a protocol saved and kept across a reload in real IndexedDB (version 2, IDs only), the
 * "PROTOCOL: MOVIE NIGHT · 3/3" HUD line over the galaxy and over the orb, House Party opening all six scenes in
 * turn, and follow-ups ("now Jupiter", "bigger", "faster", "go back") with the real scenes open. Screenshots of the
 * HUD line and House Party at both sizes. These need three.js, like the memory core.
 *
 * Session 8 added step 5: settings moved between two devices, each its own browser profile. Device A (the profile
 * above) saves jarvis-settings.json through a real download and shows its settings code. The code is cut out of a
 * screenshot of A's screen, made into a fake camera's video with ffmpeg, and device B, a second Chromium with that
 * fake camera, scans it with the self-hosted decoder, which the page loads with its SRI hash. B then restores the
 * downloaded file through the real file picker. Both land in B's real IndexedDB, merged with what B had. A copy of
 * the encoder with one byte changed is refused by the browser. Screenshots of the code and the scan at both sizes.
 *
 * Session 11 added step 6: clearance, in a fresh profile at each size. The memory core of a newcomer, with its four
 * red locked stars (one is tapped for real, and says what opens it). Then nine earlier days and four scenes are
 * restored from a backup, "show me the suit" is typed, and the fifth scene makes level 3 mid-visit: the "ACCESS
 * LEVEL 3 GRANTED" sweep over the real suit. Then the extras level 3 opened: the Tesseract, rendered, and the
 * gold-and-red HUD. Screenshots of each.
 *
 * Session 12 added step 7: the meaning module with the real model, in a fresh profile at each size. Nothing comes from
 * jarvis/text/ until "jarvis upgrade your brain please" is typed; the neural network plays the upgrade while it downloads;
 * "show me the planet we live on" ranks closest to the globe and opens it; "make me smile" asks "Did you mean a joke?" and
 * "yes" tells one. The real database gains nothing but usage counts, the Cache API stays empty, and a reload starts
 * without the module. Screenshots of the upgrade and the question at both sizes. This step is slow under SwiftShader.
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
    '.wasm': 'application/wasm', '.y4m': 'application/octet-stream', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
// Session 13: no pack.json is committed until the real build runs (jarvis/knowledge/README.md), so the server hands
// out the pack built from the sample documents at jarvis/knowledge/pack.json, the way the page will fetch the real one.
const KB = await import('../jarvis/knowledge/build.mjs');
const PACK = await KB.buildPack(await KB.fixtureGetter(join(ROOT, 'tests/fixtures/jarvis-knowledge/')), await readFile(join(ROOT, 'jarvis/knowledge/suits.json'), 'utf8'));
function serve() {
    const server = createServer(async (req, res) => {
        if (new URL(req.url, 'http://x').pathname === '/jarvis/knowledge/pack.json') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(PACK)); return; }
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

async function open(file, size = { width: 1280, height: 800 }, on = ctx) {
    const page = await on.newPage(); await page.setViewportSize(size);
    page.on('pageerror', (e) => problems.push(`${file} page error: ${e.message}`));
    // MediaPipe's text embedder (Session 12) prints its own two start-up notes through console.error. They're the
    // library's logging, not page errors, so exactly those two lines are let through; anything else still fails.
    const MEDIAPIPE_LOG = /^(?:INFO: Created TensorFlow Lite XNNPACK delegate for CPU\.|WARNING: Attempting to use a delegate that only supports static-sized tensors with a graph that has dynamic-sized tensors \(tensor#\d+ is a dynamic-sized tensor\)\.)$/;
    page.on('console', (m) => { if ((m.type() === 'error' && !MEDIAPIPE_LOG.test(m.text())) || /Refused/.test(m.text())) problems.push(`${file} console: ${m.text()}`); });
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

    // 4. Session 10: protocols in real IndexedDB, the HUD line, House Party and follow-ups, at both sizes.
    if (three) for (const [w, h] of [[1280, 800], [390, 844]]) {
        test = await open('jarvis-test.html', { width: w, height: h });
        await test.click('#boot-skip'); await test.waitForTimeout(800);
        const say = (q) => test.evaluate((x) => window.__jarvis.answer(x), q);
        if (w === 1280) {
            const made = await say('create movie night protocol: make the orb purple, speak slower, then open the galaxy');
            ok('a protocol is saved', /^Protocol saved: Movie night, three steps/.test(made), made);
            await test.reload(); await test.waitForFunction(() => window.__jarvis); await test.evaluate(() => window.__jarvis.ready);
            await test.click('#boot-skip'); await test.waitForTimeout(800);
            const pdb = await dbOf(test);
            ok('it is kept across a reload, in real IndexedDB, as fixed IDs only', JSON.stringify(pdb.protocols) === '{"\\"movie night\\"":{"steps":["orb:purple","speed:slow","scene:galaxy"]}}', JSON.stringify(pdb.protocols));
            ok('the real database is at version 3 (Session 13 added the pack table)', await test.evaluate(async () => (await indexedDB.databases()).find((d) => d.name === 'jarvis-test')?.version === 3));
            ok('and the context was forgotten by the reload', await test.evaluate(() => window.__jarvis.context().lastCmd === null && window.__jarvis.context().scenes.length === 0));
        }
        // The HUD line: slowed down so the run can be caught on its last step, with the galaxy up.
        await test.evaluate(() => window.__jarvis.setPace(4));
        await say('movie night');
        await test.waitForFunction(() => window.__jarvis.running()?.i === 2 && document.getElementById('holo-title').textContent.includes('GALAXY'), null, { timeout: 30000 });
        await test.waitForTimeout(1500);
        const line = await test.evaluate(() => [document.getElementById('holo-proto').textContent, getComputedStyle(document.getElementById('holo-proto')).display]);
        ok(`the HUD line shows the run at ${w}×${h}`, line[0] === 'PROTOCOL: MOVIE NIGHT · 3/3' && line[1] !== 'none', JSON.stringify(line));
        await test.screenshot({ path: join(OUT, `protocol-hud-${w}.png`) });
        const fitsLine = await test.evaluate(() => { const r = document.getElementById('holo-proto').getBoundingClientRect(), b = ['holo-close', 'holo-hands'].map((id) => document.getElementById(id).getBoundingClientRect());
            return r.right <= innerWidth && b.every((x) => r.right <= x.left || r.top >= x.bottom || r.bottom <= x.top); });
        ok(`and doesn't run under the buttons at ${w}×${h}`, fitsLine);
        // The main view's copy of the line, with no projector open.
        await test.evaluate(() => window.__jarvis.protocolDone());
        await say('close');
        await test.waitForTimeout(800);
        await say('create orb only protocol: make the orb gold, wait 10 seconds, make the orb purple');
        await say('orb only');
        await test.waitForFunction(() => window.__jarvis.running()?.i === 1, null, { timeout: 10000 });
        const main2 = await test.evaluate(() => { const e = document.getElementById('proto'), r = e.getBoundingClientRect(); return [e.textContent, r.left >= 0 && r.right <= innerWidth && r.height > 0]; });
        ok(`the line over the orb at ${w}×${h}`, main2[0] === 'PROTOCOL: ORB ONLY · 2/3' && main2[1], JSON.stringify(main2));
        await test.screenshot({ path: join(OUT, `protocol-orb-${w}.png`) });
        ok('saying anything stops it', (await say('stop')) === 'Protocol stopped.' && await test.evaluate(() => !window.__jarvis.running() && document.getElementById('proto').hidden));
        // House Party: every scene in turn, normally.
        await test.evaluate(() => window.__jarvis.setPace(0.4));
        await say('house party');
        const kinds = [];
        for (let i = 0; i < 6; i++) {
            await test.waitForFunction((n) => window.__jarvis.running()?.i === n || !window.__jarvis.running(), i, { timeout: 60000 });
            await test.waitForTimeout(1800);
            kinds.push(await test.evaluate(() => [document.getElementById('holo-title').textContent, document.getElementById('holo-proto').textContent]));
            if (i === 1 || i === 4) await test.screenshot({ path: join(OUT, `house-party-${i + 1}-${w}.png`) });
        }
        await test.evaluate(() => window.__jarvis.protocolDone());
        const titles = kinds.map(([a]) => a.replace('HOLO-PROJECTOR // ', '')).join(', ');
        ok(`House Party opens each scene in turn at ${w}×${h}`, titles === 'SPIRAL GALAXY, SOLAR SYSTEM, EARTH, NEURAL NETWORK, SUIT SCHEMATIC, PARTICLE SCULPTOR', titles);
        ok('with the HUD counting them', kinds.map(([, b]) => b).join(',') === [1, 2, 3, 4, 5, 6].map((n) => `PROTOCOL: HOUSE PARTY · ${n}/6`).join(','), kinds.map(([, b]) => b).join(','));
        ok('and the HUD clears at the end', await test.evaluate(() => document.getElementById('holo-proto').hidden && !window.__jarvis.running()));
        if (w === 1280) {
            // Follow-ups with real scenes open.
            await say('take me to mars');
            const j = await say('now jupiter');
            ok('"now Jupiter" after Mars flies to Jupiter', /^Jupiter\./.test(j) && (await test.evaluate(() => document.getElementById('holo-stat').textContent)) === 'JUPITER', j);
            const g0 = await test.evaluate(() => document.querySelector('#stage canvas') && true);
            ok('"bigger" and "faster" adjust the open scene', (await say('bigger')) === 'Moving in on the solar system.' && (await say('faster')) === 'The planets move faster now.' && g0);
            ok('"slower" back again', (await say('slower')) === 'The planets move slower now.');
            const back = await say('go back');
            ok('"go back" returns to Mars', /^Going back\. Mars\./.test(back), back);
            ok('"what was that?" repeats it', (await say('what was that')) === back);
            await say('show me the galaxy');
            ok('"go back" from another scene reopens the one before', /^Going back\. Mars\./.test(await say('go back')) && (await test.evaluate(() => document.getElementById('holo-title').textContent)).includes('SOLAR'));
            const dbNow = JSON.stringify(await dbOf(test));
            ok('nothing from the follow-ups reached the database', !/jupiter|Going back|lastCmd|take me to/i.test(dbNow));
            // The built-in boot protocol: power down, boot, then build the suit.
            await test.evaluate(() => window.__jarvis.setPace(0.3));
            await say("wake up, daddy's home");
            await test.waitForTimeout(400);
            const booted = await test.evaluate(() => !document.getElementById('boot').hidden && !document.getElementById('holo').classList.contains('open'));
            await test.waitForFunction(() => document.getElementById('holo-title').textContent.includes('SUIT') && document.getElementById('boot').hidden, null, { timeout: 30000 });
            const said = await test.evaluate(() => [...document.querySelectorAll('#log .msg.ai')].slice(-2).map((m) => m.textContent).join(' | '));
            ok('"wake up, daddy\'s home" reboots him, then builds the suit', booted && said.split(' | ').length === 2 && /Welcome home\. Suiting up/.test(said), said);
            await test.evaluate(() => window.__jarvis.protocolDone());
        }
        ok(`no sideways scroll at ${w}×${h}`, await test.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await test.close();
    }

    // 5. Session 8: moving settings to another device. Device A is this profile; device B is a second browser.
    {
        const a = await open('jarvis-test.html');
        await a.click('#boot-skip'); await a.waitForTimeout(600);
        const sayA = (q) => a.evaluate((x) => window.__jarvis.answer(x), q);
        await sayA('switch to panthers'); await sayA('make the orb gold'); await sayA('speak faster');
        await sayA('create game day protocol switch to panthers tell me a joke then start a launch countdown');
        await sayA('my dog is Rex');
        const dl = a.waitForEvent('download', { timeout: 10000 }).catch(() => null);
        const said = await sayA('back up my settings');
        const download = await dl;
        ok('"back up my settings" downloads a real file, even when asked by voice', !!download && download.suggestedFilename() === 'jarvis-settings.json', said);
        const backupPath = join(work, 'jarvis-settings.json');
        if (download) await download.saveAs(backupPath);
        const fileText = download ? await readFile(backupPath, 'utf8') : '{}', file = JSON.parse(fileText);
        ok('the file holds settings, protocols and counts, and nothing said this visit', file.app === 'jarvis' && file.kept['jarvis-skin'] === 'panther' && file.protocols['game day'] && file.days.length > 0 && !/Rex|dog/.test(fileText), fileText.slice(0, 200));
        ok('the panel opens with it', await a.evaluate(() => window.__jarvis.transferState()?.view === 'menu'));
        await a.screenshot({ path: join(OUT, 'transfer-menu-1280.png') });
        const shown = await sayA('send my settings to my phone');
        await a.waitForTimeout(800);
        const qr = await a.evaluate(() => { const c = document.querySelector('.xfer-qr'), r = c && c.getBoundingClientRect(), s = document.querySelector('script[src*="jarvis/qr/qrcode.js"]');
            return { stat: document.getElementById('holo-stat').textContent, box: r && [r.x, r.y, r.width, r.height], sri: s && s.integrity, payload: window.__jarvis.qrPayload() }; });
        ok('"send my settings to my phone" shows the code, made by the self-hosted encoder loaded with its SRI hash', /^Here's your settings code/.test(shown) && /^READY · \d+ BYTES · QR V\d+$/.test(qr.stat) && /^sha384-/.test(qr.sri || ''), qr.stat + ' ' + qr.sri);
        const ver = +(/QR V(\d+)/.exec(qr.stat) || [])[1];
        ok(`it is a small code: ${qr.payload.length} bytes, QR version ${ver}`, qr.payload.length <= 500 && ver <= 15);
        const fitsBox = await a.evaluate(() => { const q = document.querySelector('.xfer-qr').getBoundingClientRect(), top = document.getElementById('holo-top').getBoundingClientRect(), form = document.getElementById('f').getBoundingClientRect();
            return q.top >= top.bottom - 1 && q.bottom <= form.top && q.width >= 200 && Math.abs(q.width - q.height) < 2; });
        ok('it sits between the top HUD and the input, square and at least 200 px', fitsBox);
        await a.screenshot({ path: join(OUT, 'transfer-code-1280.png') });
        const codePng = join(work, 'code.png');
        await a.screenshot({ path: codePng, clip: { x: qr.box[0], y: qr.box[1], width: qr.box[2], height: qr.box[3] } });
        await a.close();
        // The phone-sized view of the same code.
        const a390 = await open('jarvis-test.html', { width: 390, height: 844 });
        await a390.click('#boot-skip'); await a390.waitForTimeout(600);
        await a390.evaluate(() => window.__jarvis.answer('send my settings to my phone')); await a390.waitForTimeout(800);
        ok('at 390×844 the top lines end above the buttons, and the status line isn\'t cut off', await a390.evaluate(() => { const hud = document.getElementById('holo-hint').getBoundingClientRect(), btn = document.querySelector('.xfer-btns').getBoundingClientRect(), st = document.getElementById('holo-stat');
            return hud.bottom <= btn.top && st.scrollWidth <= st.clientWidth; }));
        ok('at 390×844 the code fits on screen with nothing scrolling sideways', await a390.evaluate(() => { const q = document.querySelector('.xfer-qr').getBoundingClientRect(); return q.left >= 0 && q.right <= innerWidth && q.width >= 200 && document.documentElement.scrollWidth <= innerWidth; }));
        await a390.screenshot({ path: join(OUT, 'transfer-code-390.png') });
        await a390.close();

        // The code, as a camera would see it: A's own pixels, centred on a 640×480 frame, as y4m video.
        const y4m = join(work, 'code.y4m');
        // The first 1.5 s are out of focus, as a phone camera is while it settles, so a screenshot can catch the scan running.
        const frame = 'scale=-2:400:flags=neighbor,pad=640:480:(ow-iw)/2:(oh-ih)/2:color=white';
        execFileSync('ffmpeg', ['-v', 'error', '-y', '-loop', '1', '-t', '1.5', '-i', codePng, '-loop', '1', '-t', '4', '-i', codePng, '-filter_complex',
            `[0]${frame},boxblur=8,fps=10,format=yuv420p[a];[1]${frame},fps=10,format=yuv420p[b];[a][b]concat=n=2:v=1[v]`, '-map', '[v]', y4m]);
        const ctxB = await chromium.launchPersistentContext(join(work, 'profile-b'), { executablePath, headless: true, viewport: { width: 1280, height: 800 },
            args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${y4m}`] });
        if (three) await ctxB.route('https://cdnjs.cloudflare.com/**', (r) => r.fulfill({ path: three, contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' } }));
        await ctxB.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
        try {
            for (const [w, h] of [[1280, 800], [390, 844]]) {
                const b = await open('jarvis-test.html', { width: w, height: h }, ctxB);
                await b.evaluate(() => { window.__camLog = []; const g = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
                    navigator.mediaDevices.getUserMedia = async (c) => { const s = await g(c); window.__camLog.push({ c, s }); return s; }; });
                await b.click('#boot-skip'); await b.waitForTimeout(600);
                const sayB = (q) => b.evaluate((x) => window.__jarvis.answer(x), q);
                if (w === 1280) { await sayB('make the orb blue'); await sayB('use imperial units'); await sayB('create the bedtime protocol make the orb green'); }
                const before = await b.evaluate(() => window.__jarvis.saved());
                const started = await sayB('scan settings');
                await b.waitForTimeout(500);
                const scanning = await b.evaluate(() => [document.getElementById('holo-stat').textContent, !!document.querySelector('.xfer video'), window.__jarvis.transferState()?.camera]);
                ok(`while it looks, the camera's view is on the panel at ${w}×${h}`, scanning[0] === 'SCANNING FOR A SETTINGS CODE…' && scanning[1] && scanning[2], JSON.stringify(scanning));
                await b.screenshot({ path: join(OUT, `transfer-scan-${w}.png`) });
                await b.waitForFunction(() => /CODE READ/.test(document.getElementById('holo-stat').textContent), null, { timeout: 20000 }).catch(() => {});
                const got = await b.evaluate(() => ({ stat: document.getElementById('holo-stat').textContent, skin: window.__jarvis.skin(), settings: window.__jarvis.settings(), protocols: Object.keys(window.__jarvis.protocols()),
                    cam: window.__camLog.map(({ c, s }) => ({ c, live: s.getTracks().filter((t) => t.readyState === 'live').length, audio: s.getAudioTracks().length })),
                    decoder: typeof BarcodeDetector === 'function' ? 'BarcodeDetector' : 'jsQR', sri: document.querySelector('script[src*="jarvis/qr/jsQR.js"]')?.integrity,
                    said: [...document.querySelectorAll('#log .msg.ai')].pop()?.textContent }));
                ok(`B scans A's code through the fake camera at ${w}×${h} (${got.decoder})`, /Point the camera/.test(started) && /CODE READ/.test(got.stat) && got.skin === 'panther' && got.protocols.includes('game day'), JSON.stringify(got));
                await b.screenshot({ path: join(OUT, `transfer-read-${w}.png`) });
                ok('the camera was video only, and is off once the code is read', got.cam.length === 1 && got.cam[0].c.audio === false && got.cam[0].audio === 0 && got.cam[0].live === 0 && !(await b.$('.xfer video')), JSON.stringify(got.cam));
                if (got.decoder === 'jsQR') ok('the decoder came from jarvis/qr/ with its SRI hash', /^sha384-/.test(got.sri || ''));
                if (w === 1280) {
                    ok('B\'s own things are kept: its units and its other protocol', got.settings.units === 'imperial' && got.settings.color === 'gold' && got.protocols.includes('bedtime'), JSON.stringify(got.settings));
                    // Then the file, through the real file picker.
                    const chooser = b.waitForEvent('filechooser');
                    await b.click('.xfer-btns button[data-x="restore"]');
                    await (await chooser).setFiles(backupPath);
                    await b.waitForFunction(() => /^Restored/.test([...document.querySelectorAll('#log .msg.ai')].pop()?.textContent || '') && window.__jarvis.saved().events.some((e) => e.id === 'cmd:restore' && e.n >= 2), null, { timeout: 10000 }).catch(() => {});
                    const said2 = await b.evaluate(() => [...document.querySelectorAll('#log .msg.ai')].pop()?.textContent);
                    const dbB = await dbOf(b), evB = Object.values(dbB.events || {});
                    ok('RESTORE FROM FILE takes the downloaded backup', /^Restored your skin, your settings.* protocols? and your usage counts\./.test(said2 || ''), said2);
                    ok('in B\'s real IndexedDB: A\'s protocol and counts, B\'s own protocol, nothing dropped', dbB.protocols?.['"game day"'] && dbB.protocols?.['"bedtime"'] && file.days.every(([id, day, n]) => evB.some((e) => e.id === id && e.day === day && e.n >= n))
                        && before.events.every((e) => evB.some((x) => x.id === e.id && x.day === e.day && x.n >= e.n)), JSON.stringify(Object.keys(dbB.protocols || {})));
                    ok('B\'s localStorage was never written', Object.keys(await lsOf(b)).length === 0);
                    ok('nothing from A\'s visit reached B', !/Rex|dog/.test(JSON.stringify(dbB)));
                }
                ok(`no sideways scroll at ${w}×${h}`, await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
                await b.close();
            }
            // A changed encoder is refused: one byte different, so its SRI hash no longer matches.
            const real = await readFile(join(ROOT, 'jarvis/qr/qrcode.js'), 'utf8');
            const t = await ctxB.newPage(); const errs = [];
            t.on('console', (m) => errs.push(m.text()));
            await t.route('**/jarvis/qr/qrcode.js', (r) => r.fulfill({ body: real.replace('QR Code Generator', 'QR Code Generatoz'), contentType: 'application/javascript' }));
            await t.goto(BASE + 'jarvis-test.html'); await t.waitForFunction(() => window.__jarvis); await t.evaluate(() => window.__jarvis.ready);
            const r = await t.evaluate(() => window.__jarvis.answer('show my settings code'));
            ok('an encoder with one byte changed is refused by the browser, and he points to the file instead', /couldn't load my code maker/.test(r) && errs.some((e) => /integrity/i.test(e)) && !(await t.evaluate(() => typeof window.qrcode)).includes('function'), r + ' | ' + errs.join(' | '));
            await t.close();
        } finally { await ctxB.close(); }
    }
    // 6. Session 11: clearance, in a fresh profile at each size, so each one starts as a newcomer.
    if (three) for (const [w, h] of [[1280, 800], [390, 844]]) {
        const ctxC = await chromium.launchPersistentContext(join(work, `profile-c-${w}`), { executablePath, headless: true,
            args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], viewport: { width: w, height: h } });
        await ctxC.route('https://cdnjs.cloudflare.com/**', (r) => r.fulfill({ path: three, contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' } }));
        await ctxC.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
        try {
            const p = await open('jarvis-test.html', { width: w, height: h }, ctxC);
            await p.click('#boot-skip'); await p.waitForTimeout(800);
            const say = (q) => p.evaluate((x) => window.__jarvis.answer(x), q);
            const lastAi = () => p.evaluate(() => [...document.querySelectorAll('#log .msg.ai')].pop()?.textContent || '');
            ok(`a newcomer is level 1 at ${w}×${h}`, await p.evaluate(() => window.__jarvis.levelNow()) === 1);
            // The memory core: four red locked stars on the outer shell, among the dim ones not found yet.
            await say('show me your memory'); await p.waitForTimeout(2500);
            const caps = await p.evaluate(() => window.__jarvis.holoCaps());
            ok(`the memory core shows the four locked stars at ${w}×${h}`, caps && caps.filter((x) => x === 'locked').length === 4 && caps.includes('unfound'), JSON.stringify(caps));
            await p.screenshot({ path: join(OUT, `locked-stars-${w}.png`) });
            // Tap a locked star that's on screen and clear of the labels.
            const spot = await p.evaluate(() => { const boxes = [...document.querySelectorAll('#mem-labels .suit-label')].map((b) => b.getBoundingClientRect());
                return (window.__jarvis.holoCapScreen() || []).find((s) => s.state === 'locked' && !s.behind && s.x > 20 && s.x < innerWidth - 20 && s.y > 140 && s.y < innerHeight - 200 && boxes.every((b) => s.x < b.left - 30 || s.x > b.right + 30 || s.y < b.top - 30 || s.y > b.bottom + 30)); });
            if (spot) {
                await p.mouse.click(spot.x, spot.y); await p.waitForTimeout(400);
                const heard = await lastAi();
                ok(`tapping a locked star says what opens it at ${w}×${h}`, /^Locked\. Clearance level (two|three|four|five), \w+, opens it\.$/.test(heard), heard);
            } else ok(`a locked star is clear of the labels to tap at ${w}×${h}`, false, 'none on screen');
            await say('close'); await p.waitForTimeout(800);
            // Nine earlier days and three scenes, restored from another device: with the memory core, ten days and four scenes is level 2.
            const today = await p.evaluate(() => window.__jarvis.dayNumber());
            const days = [];
            for (let k = 1; k <= 9; k++) days.push(['app:visit', today - k, 1]);
            ['galaxy', 'solar', 'globe'].forEach((s, k) => days.push(['scene:' + s, today - 1 - k, 2])); // the memory core, opened above, is the fourth
            await p.evaluate((d) => window.__jarvis.restoreBackup(JSON.stringify({ app: 'jarvis', backup: 1, kept: {}, protocols: {}, days: d, totals: [] })), days);
            ok(`ten days and four scenes is level 2 at ${w}×${h}`, await p.evaluate(() => window.__jarvis.levelNow()) === 2);
            // The fifth scene, typed: level 3, mid-visit, with the sweep over the suit.
            await p.fill('#q', 'show me the suit'); await p.press('#q', 'Enter');
            await p.waitForFunction(() => !document.getElementById('levelup').hidden, null, { timeout: 15000 }).catch(() => {});
            await p.waitForTimeout(700);
            const sw = await p.evaluate(() => { const e = document.getElementById('levelup'), r = e.getBoundingClientRect(); return { text: e.textContent, shown: !e.hidden && r.width > 0, inside: r.left >= 0 && r.right <= innerWidth, holo: document.getElementById('holo-title').textContent }; });
            ok(`"ACCESS LEVEL 3 GRANTED" sweeps in over the suit at ${w}×${h}`, sw.shown && sw.inside && sw.text === 'ACCESS LEVEL 3 GRANTEDENGINEER' && /SUIT/.test(sw.holo), JSON.stringify(sw));
            await p.screenshot({ path: join(OUT, `level-up-${w}.png`) });
            await p.waitForFunction(() => /Access level three granted: Engineer/.test([...document.querySelectorAll('#log .msg.ai')].pop()?.textContent || ''), null, { timeout: 5000 }).catch(() => {});
            ok('and he says so after his answer', /Access level three granted: Engineer\./.test(await lastAi()), await lastAi());
            await p.waitForTimeout(3600);
            ok('the sweep goes after a few seconds', await p.evaluate(() => document.getElementById('levelup').hidden));
            // What level 3 opened: the Tesseract, rendered, and the gold-and-red HUD.
            const ts = await say('show me the tesseract'); await p.waitForTimeout(2000);
            ok(`the Tesseract opens at level 3 at ${w}×${h}`, /^Clearance confirmed\. This is the Tesseract/.test(ts) && (await p.evaluate(() => document.getElementById('holo-title').textContent)).includes('TESSERACT'), ts);
            await p.screenshot({ path: join(OUT, `tesseract-${w}.png`) });
            await say('close'); await p.waitForTimeout(800);
            const hud = await say('gold and red hud'); await p.waitForTimeout(300);
            ok(`the gold-and-red HUD at ${w}×${h}`, /^Gold-and-red HUD engaged/.test(hud) && (await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--phos').trim())) === '#ffc93c', hud);
            await p.screenshot({ path: join(OUT, `hud-${w}.png`) });
            const dbC = await dbOf(p);
            ok('nothing about the level, the HUD or the favourites is in the real database', !/Engineer|clearance|hotrod|favourite/i.test(JSON.stringify({ kept: dbC.kept, meta: dbC.meta })) && Object.keys(dbC.meta || {}).every((k) => ['"copied"', '"rolled"', '"carry"'].includes(k)), JSON.stringify(dbC.meta));
            ok(`no sideways scroll at ${w}×${h}`, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
            await p.close();
        } finally { await ctxC.close(); await rm(join(work, `profile-c-${w}`), { recursive: true, force: true }); }
    }
    // 7. Session 12: the meaning module, with the real model, in a fresh profile at each size. Nothing is fetched from
    // jarvis/text/ until "upgrade your brain" is typed. The neural network plays the upgrade while it downloads (a
    // screenshot part way), then "show me the planet we live on" ranks closest to the globe and opens it, and a
    // somewhat-close "make me smile" asks "Did you mean a joke?" (a screenshot), which yes answers. The real database
    // is the same before and after apart from the usage counts, the Cache API is unused, and a reload starts without it.
    // Slow under SwiftShader: the model works out the example sentences' fingerprints on the CPU.
    if (three) for (const [w, h] of [[1280, 800], [390, 844]]) {
        const ctxM = await chromium.launchPersistentContext(join(work, `profile-m-${w}`), { executablePath, headless: true,
            args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], viewport: { width: w, height: h } });
        await ctxM.route('https://cdnjs.cloudflare.com/**', (r) => r.fulfill({ path: three, contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' } }));
        await ctxM.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
        const asked = [];
        ctxM.on('request', (rq) => asked.push(rq.url()));
        try {
            const p = await open('jarvis-test.html', { width: w, height: h }, ctxM);
            await p.click('#boot-skip'); await p.waitForTimeout(800);
            const lastAi = () => p.evaluate(() => [...document.querySelectorAll('#log .msg.ai')].pop()?.textContent || '');
            const type = async (q) => { await p.fill('#q', q); await p.press('#q', 'Enter'); await p.waitForTimeout(900); return lastAi(); };
            ok(`nothing is fetched from jarvis/text/ at start-up at ${w}×${h}`, !asked.some((u) => u.includes('/jarvis/text/')) && await p.evaluate(() => window.__jarvis.mind().state) === 'off');
            const dbBefore = await dbOf(p);
            const said = await type('jarvis upgrade your brain please');
            ok(`"jarvis upgrade your brain please", typed unpunctuated, starts the upgrade at ${w}×${h}`, /^Upgrading\. I'm downloading my language comprehension module from this site, about 12 megabytes\. Watch my neural network\.$/.test(said), said);
            await p.waitForFunction(() => /^UPGRADING · ([3-9]\d)%$/.test(window.__jarvis.holoStat()), null, { timeout: 120000 }).catch(() => {});
            const mid = await p.evaluate(() => ({ title: document.getElementById('holo-title').textContent, stat: window.__jarvis.holoStat(), amber: !document.getElementById('holo-proto').hidden, cut: (() => { const e = document.getElementById('holo-stat'); return e.scrollWidth > e.clientWidth; })() }));
            ok(`the neural network plays the upgrade while it downloads at ${w}×${h}`, /NEURAL NETWORK/.test(mid.title) && /^UPGRADING · \d+%$/.test(mid.stat), JSON.stringify(mid));
            ok(`the percentage fits on the line, not cut off, at ${w}×${h}`, !mid.cut);
            ok('shown once, in the scene\'s stat line, not again in the amber line', !mid.amber);
            await p.screenshot({ path: join(OUT, `upgrade-${w}.png`) });
            await p.waitForFunction(() => window.__jarvis.mind().state !== 'loading', null, { timeout: 300000 }).catch(() => {});
            ok(`"Language comprehension module online." at ${w}×${h}`, /^Language comprehension module online\./.test(await lastAi()) && await p.evaluate(() => window.__jarvis.mind().state) === 'on', await lastAi());
            ok('the stat line says so', await p.evaluate(() => window.__jarvis.holoStat()) === 'BRAIN UPGRADED');
            await p.waitForTimeout(600);
            await p.screenshot({ path: join(OUT, `upgrade-done-${w}.png`) });
            const files = asked.filter((u) => u.includes('/jarvis/text/')).map((u) => u.replace(/^.*\/jarvis\/text\//, '')).sort();
            ok('it fetched the bundle, the loader, the WebAssembly and the model, all from this site', ['text_bundle.js', 'text_wasm_internal.js', 'text_wasm_internal.wasm', 'universal_sentence_encoder.tflite'].every((f) => files.includes(f)), files.join());
            ok('and nothing from any other host', asked.every((u) => u.startsWith(BASE) || /^(data|blob):|^https:\/\/(cdnjs\.cloudflare\.com|fonts\.googleapis\.com)\//.test(u)), asked.filter((u) => !u.startsWith(BASE)).join());
            if (w === 1280) {
                const rank = await p.evaluate(() => { const m = window.__jarvis.meaningOf('show me the planet we live on'); return m && { key: m.c.key, score: m.score, sure: m.sure }; });
                ok('"show me the planet we live on" ranks closest to the globe, close enough to do it', rank && rank.key === 'cmd:show me earth' && rank.sure, JSON.stringify(rank));
                results.push({ pass: true, line: `     (its score: ${rank && rank.score.toFixed(3)})` });
                // Session 13 added fact questions to MEANINGS, which moves the mean every score is measured from. The bands
                // (0.80 do, 0.60 ask) are re-checked here against the real model: rewordings of a fact question naming
                // another thing, and unrelated sentences that must stay below 0.60.
                await p.evaluate(() => window.__jarvis.knowAnswer({ q: 'about', x: 'peru' })); // the pack, so names can be found
                const probe = await p.evaluate(() => ['give me the lowdown on japan', 'what can you tell me about brazil', "i'd like to learn about kenya", 'how many kilometres is it to jupiter', 'what is the distance from here to saturn',
                    'fill me in on the hulkbuster', 'teach me about the element iron', 'what sort of element is copper', 'paint my kitchen japan red', 'is jupiter a good name for a dog', 'i ate gold leaf once'].map((q) => { const m = window.__jarvis.meaningOf(q); return [q, m ? m.c.key : null, m ? +m.score.toFixed(3) : null, m ? m.sure : false]; }));
                for (const [q, key, score, sure] of probe) results.push({ pass: true, line: `     ${JSON.stringify(q)} -> ${key} ${score ?? ''}${sure ? ' (does it)' : key ? ' (asks)' : ''}` });
                const unrelated = probe.slice(8);
                ok('unrelated sentences naming a country, a planet or an element are not taken for fact questions', unrelated.every(([, key, , sure]) => !sure && !(key && /about|how far/.test(key) && sure)), JSON.stringify(unrelated));
                ok('most rewordings of a fact question are understood (does it or asks)', probe.slice(0, 8).filter(([, key]) => key && /tell me about|how far/.test(key)).length >= 6, JSON.stringify(probe.slice(0, 8)));
            }
            const globeBefore = await p.evaluate(() => window.__jarvis.usageNow().n['scene:globe'] || 0);
            await type('show me the planet we live on'); await p.waitForTimeout(2500);
            ok(`typed, it opens the globe at ${w}×${h}`, (await p.evaluate(() => document.getElementById('holo-title').textContent)).includes('EARTH'));
            ok('counted as scene:globe', await p.evaluate(() => window.__jarvis.usageNow().n['scene:globe'] || 0) === globeBefore + 1);
            await type('close'); await p.waitForTimeout(800);
            const dym = await type('make me smile');
            ok(`somewhat close: "Did you mean a joke?" at ${w}×${h}`, dym === 'Did you mean a joke? Say yes or no.', dym);
            await p.screenshot({ path: join(OUT, `did-you-mean-${w}.png`) });
            const jokes = await p.evaluate(() => window.__jarvis.usageNow().n['cmd:joke'] || 0);
            const y = await type('yes');
            ok('and "yes" tells one, counted as cmd:joke', !/Did you mean|Yes to what/.test(y) && await p.evaluate(() => window.__jarvis.usageNow().n['cmd:joke'] || 0) === jokes + 1, y);
            await p.waitForTimeout(300);
            // The knowledge pack (Session 13) may be copied in here: public facts read for the meaning module, not something it stored.
            const dbAfter = await dbOf(p), strip = (d) => JSON.stringify({ ...d, events: null, names: null, pack: null, meta: Object.fromEntries(Object.entries(d.meta || {}).filter(([k]) => k !== '"pack"')) });
            ok(`the real database: nothing new but usage counts at ${w}×${h}`, strip(dbAfter) === strip(dbBefore) && Object.values(dbAfter.events || {}).every((e) => Object.keys(e).sort().join() === 'day,id,n'), strip(dbAfter).slice(0, 300));
            ok('still version 3, and no fingerprint in it', await p.evaluate(() => new Promise((res) => { const rq = indexedDB.open('jarvis-test'); rq.onsuccess = () => { const v = rq.result.version; rq.result.close(); res(v); }; })) === 3 && !/\[(?:-?\d+(?:\.\d+)?(?:e-?\d+)?,){6,}/.test(JSON.stringify({ ...dbAfter, pack: null })));
            ok('no Cache API storage and no localStorage', (await p.evaluate(() => caches.keys())).length === 0 && Object.keys(await lsOf(p)).length === 0);
            ok(`no sideways scroll at ${w}×${h}`, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
            await p.reload(); await p.waitForFunction(() => window.__jarvis); await p.evaluate(() => window.__jarvis.ready);
            ok(`a reload starts without the module at ${w}×${h}`, await p.evaluate(() => window.__jarvis.mind()).then((m) => m.state === 'off' && m.fingerprints === 0));
            await p.close();
        } finally { await ctxM.close(); await rm(join(work, `profile-m-${w}`), { recursive: true, force: true }); }
    }
    // 8. Session 13: the knowledge pack, in a fresh profile at each size, typed unpunctuated with "jarvis" and "please".
    // A protocol and a setting are saved first, so the version 3 upgrade can be seen to keep the older tables. "Tell me
    // about Peru" spins the real globe to Peru and reads the facts (a screenshot); "how far is Mars" opens the solar
    // system near Mars; "tell me about the Mark 42" opens the suit schematic. The pack lands in real IndexedDB.
    if (three) for (const [w, h] of [[1280, 800], [390, 844]]) {
        const ctxK = await chromium.launchPersistentContext(join(work, `profile-k-${w}`), { executablePath, headless: true,
            args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], viewport: { width: w, height: h } });
        await ctxK.route('https://cdnjs.cloudflare.com/**', (r) => r.fulfill({ path: three, contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' } }));
        await ctxK.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
        const asked = []; ctxK.on('request', (rq) => asked.push(rq.url()));
        try {
            const p = await open('jarvis-test.html', { width: w, height: h }, ctxK);
            await p.click('#boot-skip'); await p.waitForTimeout(800);
            const lastAi = () => p.evaluate(() => [...document.querySelectorAll('#log .msg.ai')].pop()?.textContent || '');
            const type = async (q, ms = 2500) => { await p.fill('#q', q); await p.press('#q', 'Enter'); await p.waitForTimeout(ms); return lastAi(); };
            await type('create movie night protocol make the orb purple then open the galaxy', 900);
            await type('close', 600);
            ok(`nothing from the pack is fetched at start-up at ${w}×${h}`, !asked.some((u) => u.includes('/jarvis/knowledge/')));
            const before = await dbOf(p);
            const peru = await type('jarvis tell me about peru please', 4000);
            ok(`"jarvis tell me about peru please" reads Peru's facts at ${w}×${h}`, /^Peru\. Its capital is Lima\. It's in South America, covering 1,285,216 square kilometres, and its highest point is Nevado Huascaran, at 6,746 metres\. The flag of Peru: /.test(peru), peru.slice(0, 120));
            const globe = await p.evaluate(() => ({ title: document.getElementById('holo-title').textContent, kind: window.__jarvis.holoKind(), stat: window.__jarvis.holoStat() }));
            ok(`and spins the globe to Peru at ${w}×${h}`, globe.kind === 'globe' && /EARTH/.test(globe.title) && /^PERU · 9\.2°S 75\.0°W/.test(globe.stat), JSON.stringify(globe));
            await p.screenshot({ path: join(OUT, `knowledge-peru-${w}.png`) });
            ok('the pack was fetched once, from this site', asked.filter((u) => u.includes('/jarvis/knowledge/pack.json')).length === 1 && asked.filter((u) => u.includes('/jarvis/knowledge/')).every((u) => u.startsWith(BASE)));
            await p.waitForTimeout(300);
            const after = await dbOf(p);
            ok(`the real database is at version 3 at ${w}×${h}`, await p.evaluate(async () => (await indexedDB.databases()).find((d) => d.name === 'jarvis-test')?.version) === 3);
            ok('the pack is in its own table, every record, exactly as built', Object.keys(after.pack || {}).length === PACK.records.length && JSON.stringify(after.pack['"country:peru"']) === JSON.stringify(PACK.records.find((r) => r.name === 'Peru')) && after.meta['"pack"'] === PACK.version);
            ok('the older tables are unchanged: settings and protocols as they were, counts only added to', JSON.stringify(after.kept) === JSON.stringify(before.kept) && JSON.stringify(after.protocols) === JSON.stringify(before.protocols) && JSON.stringify(after.totals) === JSON.stringify(before.totals)
                && Object.entries(before.events).every(([k, e]) => after.events[k] && after.events[k].n >= e.n), JSON.stringify(after.protocols));
            ok('counted as cmd:know-country, never by name', await p.evaluate(() => window.__jarvis.usageNow().n['cmd:know-country']) === 1 && !JSON.stringify(after.events).includes('peru'));
            const mars = await type('jarvis how far is mars please', 4000);
            const solar = await p.evaluate(() => ({ title: document.getElementById('holo-title').textContent, kind: window.__jarvis.holoKind() }));
            ok(`"jarvis how far is mars please" opens the solar system near Mars and answers at ${w}×${h}`, solar.kind === 'solar' && /^Mars is 227\.9 million kilometres from the Sun/.test(mars), JSON.stringify(solar) + ' ' + mars.slice(0, 80));
            await p.screenshot({ path: join(OUT, `knowledge-mars-${w}.png`) });
            const suit = await type('jarvis tell me about the mark 42 please', 4000);
            ok(`"jarvis tell me about the mark 42 please" opens the suit schematic, as fan knowledge, at ${w}×${h}`, await p.evaluate(() => window.__jarvis.holoKind()) === 'suit' && /^Fan knowledge, not an official source: the Mark 42/.test(suit), suit.slice(0, 80));
            await p.screenshot({ path: join(OUT, `knowledge-suit-${w}.png`) });
            ok(`no sideways scroll at ${w}×${h}`, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
            ok('no localStorage written', Object.keys(await lsOf(p)).length === 0);
            await p.reload(); await p.waitForFunction(() => window.__jarvis); await p.evaluate(() => window.__jarvis.ready);
            ok(`after a reload the pack is read from IndexedDB at ${w}×${h}`, await p.evaluate(() => Object.keys(window.__jarvis.pack()).length) === PACK.records.length);
            await p.close();
        } finally { await ctxK.close(); await rm(join(work, `profile-k-${w}`), { recursive: true, force: true }); }
    }
} finally {
    await ctx.close();
    server.close();
    await rm(join(work, 'profile'), { recursive: true, force: true });
    await rm(join(work, 'profile-b'), { recursive: true, force: true });
}

ok('no page errors or CSP violations', !problems.length);
console.log(results.map((r) => r.line).join('\n'));
if (problems.length) console.log('\n' + problems.join('\n'));
if (!three) console.log('\nskipped: the memory-core checks (three.js could not be fetched from npm; pass --three=<path>)');
console.log(`\nscreenshots: ${OUT}`);
const failed = results.filter((r) => !r.pass).length;
console.log(failed ? `${failed} failed` : `${results.length} passed`);
process.exit(failed ? 1 : 0);
