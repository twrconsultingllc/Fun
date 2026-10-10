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

async function open(file, size = { width: 1280, height: 800 }, on = ctx) {
    const page = await on.newPage(); await page.setViewportSize(size);
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
            ok('the real database is at version 2', await test.evaluate(async () => (await indexedDB.databases()).find((d) => d.name === 'jarvis-test')?.version === 2));
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
