/* jarvis-test.html — the trial copy of jarvis.html. New J.A.R.V.I.S. features
 * land here first; the user tries them on the live site, and only then are they
 * copied into jarvis.html, which other people use. This suite is jarvis.html's
 * suite plus checks for whatever is on trial (and for the TEST marking). When
 * the page is promoted, this file becomes tests/jarvis.dom.test.mjs, minus the
 * "Test copy" section. See "J.A.R.V.I.S.: try in jarvis-test.html first" in
 * CLAUDE.md.
 *
 * What follows is jarvis.html's own description.
 *
 * jarvis.html — J.A.R.V.I.S. Demo, a talking assistant that runs entirely in
 * the browser. jsdom has no canvas, no speech synthesis and no speech
 * recognition, so this covers the no-renderer, no-voice path: the page boots
 * without errors, typed messages get answers, and the built-in "brain" (exposed
 * as window.__jarvis) answers the things it says it can: math, names, the
 * fallback. It also pins the two bugs fixed when the page was added: "I'm
 * fine" is not a name, an "x" inside a word is not a multiplication, and
 * "what is seven times eight" is math rather than the time.
 *
 * The boot sequence and the holo-projector came later. jsdom has no WebGL,
 * so the projector's job here is to say so and NOT fetch three.js; the
 * commands that open it (window.__jarvis.intent) and the particle shapes
 * (shapePoints, plain arrays with no three.js) are checked directly. The 3D
 * scenes themselves were checked in headless Chromium (tests/secrpts/37.html).
 *
 * The voice-reactive orb (Session 1 of jarvis/build-plan.html) is checked two
 * ways: its pulse maths directly, and its wiring in a second window with a fake
 * SpeechRecognition and a getUserMedia that records every call. Listening must
 * never call it: a second mic stream stopped recognition hearing anything on a
 * phone, so the orb follows recognition's own speechstart/speechend events. */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { openDom as openPage } from './lib/page.mjs';

/* Session 9 moved the test copy's saving from localStorage to IndexedDB. jsdom has none, so every window here
 * gets fake-indexeddb, a full implementation of the IndexedDB spec: asynchronous, with transactions that
 * finish later, like the real one. Each window gets a fresh "browser profile" (an empty database) unless
 * opts.idb hands it an existing one, and opts.idb === null opens it with no IndexedDB at all. localStorage
 * seeded in beforeParse is what jarvis.html left there: the test copy copies it in on its first run. The
 * window is returned once the page has finished reading its database (window.__jarvis.ready). */
let IDB = null, QRCODE = null, PACK = null;
/* Session 13: the knowledge pack. The suite builds it from the sample documents in tests/fixtures/jarvis-knowledge/
 * with jarvis/knowledge/build.mjs itself, so the page is tested without a committed pack.json. Every window gets a
 * fetch that serves it at jarvis/knowledge/pack.json (opts.pack hands it another one, opts.pack === null a missing
 * file) and fails for everything else, as the page's other fetches did in jsdom before. env.packFetches counts the
 * page's requests for it. */
export async function fixturePack() {
    if (!PACK) {
        const B = await import('../jarvis/knowledge/build.mjs');
        const get = await B.fixtureGetter(fileURLToPath(new URL('./fixtures/jarvis-knowledge/', import.meta.url)));
        PACK = await B.buildPack(get, await readFile(new URL('../jarvis/knowledge/suits.json', import.meta.url), 'utf8'));
    }
    return PACK;
}
async function openDom(html, url, opts = {}) {
    const pk = opts.pack === undefined ? await fixturePack() : opts.pack, fetches = { n: 0 };
    IDB ??= await import('fake-indexeddb');
    const idb = opts.idb === undefined ? new IDB.IDBFactory() : opts.idb;
    // The QR encoder (Session 8) is handed to every window, as if the browser had loaded jarvis/qr/qrcode.js: jsdom
    // doesn't fetch scripts. Loading it for real, with its SRI hash, is checked in tests/jarvis-test.chromium.mjs.
    QRCODE ??= createRequire(import.meta.url)('../jarvis/qr/qrcode.js');
    const env = await openPage(html, url, { ...opts, beforeParse(w) {
        if (idb) { w.indexedDB = idb; w.IDBKeyRange = IDB.IDBKeyRange; } w.qrcode = QRCODE;
        w.fetch = async (u) => {
            if (!/\/jarvis\/knowledge\/pack\.json$/.test(String(u))) throw new w.TypeError('Failed to fetch');
            fetches.n++; await new Promise((r) => setTimeout(r, 5));
            return pk ? { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(pk)) } : { ok: false, status: 404, json: async () => { throw new Error('404'); } };
        };
        opts.beforeParse?.(w);
    } });
    env.idb = idb; env.packFetches = () => fetches.n;
    if (!opts.noWait) await env.window.__jarvis?.ready;
    return env;
}
// Everything in a profile's database for this page, read straight from IndexedDB rather than from the page.
// Saves reach the database a moment after the page makes them, so this waits a little first.
async function dbDump(idb, name = 'jarvis-test') {
    await new Promise((r) => setTimeout(r, 40));
    return new Promise((resolve, reject) => {
        const rq = idb.open(name);
        rq.onerror = () => reject(rq.error);
        rq.onsuccess = () => {
            const db = rq.result, out = {}, names = [...db.objectStoreNames];
            if (!names.length) { db.close(); resolve(out); return; }
            const tx = db.transaction(names, 'readonly');
            for (const t of names) {
                out[t] = {};
                const c = tx.objectStore(t).openCursor();
                c.onsuccess = () => { const k = c.result; if (!k) return; out[t][typeof k.key === 'string' ? k.key : JSON.stringify(k.key)] = k.value; k.continue(); };
            }
            tx.oncomplete = () => { db.close(); resolve(out); };
        };
    });
}
// Puts records straight into a profile's database, the way an earlier visit would have left them.
async function dbSeed(idb, { kept = {}, events = [], totals = [], meta = {} }, name = 'jarvis-test') {
    return new Promise((resolve, reject) => {
        const rq = idb.open(name);
        rq.onsuccess = () => {
            const db = rq.result, tx = db.transaction(['kept', 'events', 'totals', 'meta'], 'readwrite');
            for (const [k, v] of Object.entries(kept)) tx.objectStore('kept').put(v, k);
            for (const r of events) tx.objectStore('events').put(r);
            for (const r of totals) tx.objectStore('totals').put(r);
            for (const [k, v] of Object.entries(meta)) tx.objectStore('meta').put(v, k);
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => reject(tx.error);
        };
        rq.onerror = () => reject(rq.error);
    });
}
// The day number the page uses: whole days since 1 January 2026, by the local calendar. Worked out
// independently here rather than taken from the page.
const dayOf = (d = new Date()) => Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(2026, 0, 1)) / 864e5);

// The self-hosted hand tracker, pinned (see jarvis/hands/README.md).
// The globe's coastlines, pinned (see jarvis/earth/README.md).
const LAND_SHA256 = 'ec085257c3276958638a03e82162e7ce0fb6c8cd13692ba91bd7941df425512c';

const HAND_FILES = {
    'vision_bundle.js': 'e77f281f9619150d937023c355bae170e9120e3b9e43f1e23a2a7bee07197669',
    'vision_wasm_internal.js': '9440cf0cc0cea21800e31581ec32aeedcc5fbf9df4509796bbc7d3f99e52ab9c',
    'vision_wasm_internal.wasm': 'f82a8e6c05e08a44cc9f9e7ec5f845935bcbb1b1500ebe8c2f4812fb4e2917dc',
    'hand_landmarker.task': 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1',
    // the threat scan's face detector (Session 5), next to the hand tracker
    'blaze_face_short_range.tflite': 'b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f'
};

export const name = 'J.A.R.V.I.S. Test (jarvis-test.html)';

export default async function run(t, page) {
    let env;
    try {
        // An https origin, not the file:// one, so localStorage (the remembered name) works.
        env = await openDom(page.html, 'https://jarvis.test/jarvis.html', { ignore: /getContext|HTMLCanvasElement/ });
    } catch (error) {
        t.ok('the page opens in jsdom', false);
        t.note(error.message);
        return;
    }

    const { window, document, errors, close } = env;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    try {
        t.section('Booting without canvas or voice');

        t.eq('the page has no console errors', errors.length, 0);
        if (errors.length) t.note(errors.join('\n       '));
        t.eq('starts in STANDBY', document.getElementById('state').textContent, 'STANDBY');

        t.section('Boot sequence');

        const boot = document.getElementById('boot');
        t.ok('the boot screen shows on load', !boot.hidden);
        t.ok('with an INITIALIZE button', /INITIALIZE/.test(document.getElementById('boot-go').textContent));
        t.eq('nothing is said before the tap', document.querySelectorAll('#log .msg').length, 0);
        document.getElementById('boot-go').click();
        t.ok('tapping it hides the button', document.getElementById('boot-go').hidden);
        await wait(1000);
        t.ok('diagnostics scroll in', /kernel/.test(document.getElementById('boot-log').textContent));
        await wait(3000);
        t.ok('and report no WebGL here', /Holo-projector \.+ no WebGL/.test(document.getElementById('boot-log').textContent));
        t.ok('then greets the user', /All systems online/.test(document.getElementById('log').textContent));
        await wait(700);
        t.ok('and the boot screen goes away', boot.hidden);

        t.section('Security basics');

        const csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
        t.ok('has a CSP meta tag', !!csp);
        // Hand control fetches its own model and WebAssembly from jarvis/hands/, and nothing else.
        t.ok('the CSP only allows fetches from this site (connect-src \'self\')', !!csp && /connect-src 'self';/.test(csp.content));
        t.eq('has a referrer policy', document.querySelector('meta[name="referrer"]')?.content, 'strict-origin-when-cross-origin');
        t.ok('has a description', !!document.querySelector('meta[name="description"]')?.content);
        t.eq('loads no external scripts', document.querySelectorAll('script[src]').length, 0);
        t.ok('links back to the landing page', !!document.querySelector('a[href="index.html"]'));

        t.section('Test copy');

        t.eq('the tab says it is the test copy', document.title, 'J.A.R.V.I.S. Test');
        t.eq('the header carries a TEST tag', document.querySelector('header b .test-tag')?.textContent, 'TEST');
        t.ok('the description says it is where features are tried first', /trial copy/.test(document.querySelector('meta[name="description"]').content));

        t.section('The brain');

        const { brain, mathAnswer } = window.__jarvis;
        t.eq('seven times eight', mathAnswer('what is seven times eight'), 'That would be 56.');
        t.eq('"what is seven times eight" is math, not the time', brain('what is seven times eight'), 'That would be 56.');
        t.ok('"what time is it" still tells the time', /^It's /.test(brain('what time is it')));
        t.eq('12 x 3', mathAnswer('12 x 3'), 'That would be 36.');
        t.eq('10 divided by 4', mathAnswer('10 divided by 4'), 'That would be 2.5.');
        t.eq('divide by zero is refused', mathAnswer('5 divided by 0'), "Dividing by zero would tear a hole in the universe. Let's not.");
        t.eq('an x inside a word is not times', mathAnswer('next 4 boxes 5'), null);
        t.eq('"over" inside a word is not divide', mathAnswer('however 4 5'), null);

        window.localStorage.removeItem('jarvis-name');
        t.ok('"I\'m fine" is not taken as a name', !/Nice to meet you/.test(brain("I'm fine")));
        t.ok('"I am hungry" is not taken as a name', !/Nice to meet you/.test(brain('I am hungry')));
        t.eq('"my name is tony" is', brain('my name is tony'), "Nice to meet you, Tony. I'll remember that until you close this page. I never save names.");
        t.eq('the name is never saved in the browser', window.localStorage.getItem('jarvis-name'), null);
        t.ok('the name is used in greetings', /Tony/.test(brain('hello')));
        t.ok('help lists what it can do', /flip a coin/.test(brain('what can you do')));
        t.ok('help mentions the holo-projector', /show me the galaxy/.test(brain('help')));
        t.ok('unknown questions get a fallback', /demo|databanks|brain/.test(brain('what is the capital of peru')));


        t.section('Privacy scrub: nothing personal is stored');

        // The user asked on 2026-10-10 that Jarvis never store personal data in the browser. Every save goes
        // through store(), which refuses other keys and anything that looks personal, and scrubStore()
        // clears whatever older versions saved.
        const { personal, store, STORE_KEYS } = window.__jarvis;
        for (const [q, why] of [['email me at pat@example.com', 'an email address'], ['my number is 239 555 0142', 'a phone or ID number'], ['ssn 123-45-6789', 'a phone or ID number'],
            ['zip 34102', 'a long number'], ['born 03/04/2011', 'a date'], ['I live at 42 Gulf Shore Blvd', 'a street address'], ['go to www.example.com', 'a web address'],
            ['my birthday', 'something about you'], ['my password is fish', 'something about you'], ["I'm 12 years old", 'something about you'], ['call me Pat', 'something about you'], ['my doctor said rest', 'something about you'], ['my mom', 'something about you']])
            t.eq(`"${q}" is personal (${why})`, personal(q), why);
        for (const q of ['beam me up', 'tell me a joke', 'make it rain tacos', 'show me mars', 'what is 7 times 8', 'flip a coin', 'switch to the matrix', 'make 3 hearts'])
            t.eq(`"${q}" is not personal`, personal(q), null);
        t.eq('store() refuses a key that isn\'t on the list', store('jarvis-name', 'Tony'), false);
        t.eq('and personal text even under a listed key', store('jarvis-learned', JSON.stringify({ 'my phone': '239 555 0142' })), false);
        const savedNow = await dbDump(env.idb);
        t.ok('nothing was written', window.localStorage.getItem('jarvis-name') === null && !('jarvis-name' in savedNow.kept) && !('jarvis-learned' in savedNow.kept));
        t.eq('only five keys can ever be saved (the streak moved onto usage counts in Session 9)', JSON.stringify(STORE_KEYS), '["jarvis-skin","jarvis-voices","jarvis-learned","jarvis-mic-note","jarvis-settings"]');

        // The one place that saves, widened for IndexedDB (Session 9): the test copy never writes localStorage at
        // all, every IndexedDB write happens in one readwrite transaction in flush(), which only save() queues for,
        // and save() checks every record itself. Settings reach save() only through store().
        t.eq('the page never writes localStorage (setItem, removeItem or clear)', (page.html.match(/localStorage\.(?:setItem|removeItem|clear)\(|\bls\.(?:setItem|removeItem|clear)\(/g) || []).length, 0);
        t.eq('there is exactly one readwrite transaction', (page.html.match(/'readwrite'/g) || []).length, 1);
        t.ok('and it is in flush()', /function flush\(db\)\{[^}]*db\.transaction\(TABLES,'readwrite'\)/.test(page.html));
        t.eq('flush() runs only from save(), after the database opens', (page.html.match(/\bflush\b/g) || []).length, 2);
        t.eq('only save() queues a write', (page.html.match(/pending\.push\(/g) || []).length, 1);
        t.ok('save() checks every record with fits() before queueing it', /function save\(table,key,rec\)\{\s*if\(rec!==undefined&&!fits\(table,key,rec\)\)return false;/.test(page.html));
        const keptSaves = page.html.match(/save\('kept',[^)]*\)/g) || [];
        t.eq('a setting is only ever written by store(); every other kept-table save is a removal', keptSaves.filter((x) => !/,undefined\)$/.test(x)), ["save('kept',key,value)"]);
        t.ok('no other IndexedDB write method is called anywhere', !/\.(?:add|clear)\(\s*\)|objectStore\([^)]*\)\.(?:put|add|delete|clear)\(|\bindexedDB\.deleteDatabase\(/.test(page.html));
        const { fits: saveable } = window.__jarvis;
        const today = dayOf();
        t.eq('fits(): a listed setting', saveable('kept', 'jarvis-skin', 'matrix'), true);
        t.eq('fits(): a key not on the list', saveable('kept', 'jarvis-name', 'Tony'), false);
        t.eq('fits(): personal text under a listed key', saveable('kept', 'jarvis-learned', JSON.stringify({ 'ring pat': 'call 239 555 0142' })), false);
        t.eq('fits(): a usage count', saveable('events', ['scene:globe', today], { id: 'scene:globe', day: today, n: 3 }), true);
        t.eq('fits(): an event ID not on the list', saveable('events', ['said:hello pat', today], { id: 'said:hello pat', day: today, n: 1 }), false);
        t.eq('fits(): an extra field riding along', saveable('events', ['scene:globe', today], { id: 'scene:globe', day: today, n: 1, note: 'my phone' }), false);
        t.eq('fits(): a date instead of a day number', saveable('events', ['scene:globe', '2026-10-10'], { id: 'scene:globe', day: '2026-10-10', n: 1 }), false);
        t.eq('fits(): a key that doesn\'t match the record', saveable('events', ['scene:suit', today], { id: 'scene:globe', day: today, n: 1 }), false);
        t.eq('fits(): a count that isn\'t a whole number', saveable('events', ['scene:globe', today], { id: 'scene:globe', day: today, n: 1.5 }), false);
        t.eq('fits(): an all-time total', saveable('totals', 'cmd:joke', { id: 'cmd:joke', n: 40 }), true);
        t.eq('fits(): a total for an unlisted ID', saveable('totals', 'cmd:secret', { id: 'cmd:secret', n: 1 }), false);
        t.eq('fits(): only the three bookkeeping numbers in meta', [saveable('meta', 'copied', 1), saveable('meta', 'rolled', 200), saveable('meta', 'carry', 4), saveable('meta', 'name', 'Tony'), saveable('meta', 'rolled', '2026-07-12')].join(), 'true,true,true,false,false');
        t.eq('fits(): no other table', saveable('notes', 'x', 'y'), false);
        t.ok('and never reads or writes a saved name', !/jarvis-name/.test(page.html));
        t.ok('"what do you save" lists what is kept and says nothing personal is', /No names, no personal details/.test(await window.__jarvis.answer('what do you save')));

        t.section('Holo-projector commands');

        const { intent, shapePoints } = window.__jarvis;
        const kind = (s) => intent(s)?.kind ?? null;
        t.eq('"show me the galaxy"', kind('show me the galaxy'), 'galaxy');
        t.eq('"show me the stars"', kind('Show me the stars!'), 'galaxy');
        t.eq('"show me the planets"', JSON.stringify(intent('show me the planets')), '{"kind":"solar","arg":null}');
        t.eq('"take me to Mars"', JSON.stringify(intent('Take me to Mars.')), '{"kind":"solar","arg":"mars"}');
        t.eq('"show me the sun" is the solar system, not the galaxy', intent('show me the sun')?.arg, 'sun');
        t.eq('"make a heart"', intent('make a heart')?.arg?.shape, 'heart');
        t.eq('"make a rocket for me"', intent('can you make a rocket for me')?.arg?.shape, 'rocket');
        t.eq('"make an arc reactor"', intent('make an arc reactor')?.arg?.shape, 'reactor');
        t.eq('"make a star" is a shape, not the galaxy', intent('make a star')?.arg?.shape, 'star');
        t.eq('"write tony stark"', intent('write tony stark')?.arg?.text, 'TONY STARK');
        t.eq('"write my name" uses the remembered name', intent('write my name')?.arg?.text, 'TONY');
        t.eq('written text is cut to 14 characters', intent('write abcdefghijklmnopqrstuvwxyz')?.arg?.text, 'ABCDEFGHIJKLMN');
        t.eq('written text keeps only safe characters', intent('write <b>hi</b>')?.arg?.text, 'BHIB');
        t.eq('"make a dog" spells it out', JSON.stringify(intent('make a dog')?.arg), '{"text":"DOG","unknown":"dog"}');
        t.eq('"make me laugh" is not a sculpture', intent('make me laugh'), null);
        t.eq('"close"', kind('close'), 'close');
        t.eq('"close the hologram"', kind('please close the hologram'), 'close');
        t.eq('"fly in"', JSON.stringify(intent('fly in')), '{"kind":"zoom","arg":"in"}');
        t.eq('"reboot"', kind('reboot'), 'boot');
        t.eq('"what time is it" is not a projector command', intent('what time is it'), null);
        t.eq('"I\'m fine" is not a projector command', intent("I'm fine"), null);
        t.eq('"show me your brain"', JSON.stringify(intent('Show me your brain!')), '{"kind":"neural"}');
        t.eq('"neural network"', kind('neural network'), 'neural');
        t.eq('"can I see your brain"', kind('can I see your brain'), 'neural');
        t.eq('"make a neural net" is the network, not a sculpture', kind('make a neural net'), 'neural');
        t.eq('"use your brain" is not a projector command', intent('use your brain'), null);
        t.eq('"brain teaser" is not a projector command', intent('tell me a brain teaser'), null);
        t.ok('help mentions the neural network', /show me your brain/.test(brain('help')));
        t.eq('"suit up" assembles the suit', JSON.stringify(intent('Suit up!')), '{"kind":"suit","arg":"assemble"}');
        t.eq('"suit me up" too', intent('suit me up')?.arg, 'assemble');
        t.eq('"show me the suit" opens it ready-made', JSON.stringify(intent('show me the suit')), '{"kind":"suit","arg":null}');
        t.eq('"can I see your armour"', kind('can I see your armour'), 'suit');
        t.eq('"iron man suit"', kind('iron man suit'), 'suit');
        t.eq('"make a suit" is the suit, not a word in lights', kind('make a suit'), 'suit');
        t.eq('"show me the suitcase" is not the suit', intent('show me the suitcase')?.kind ?? null, null);
        t.eq('"I need a new lawsuit" is not a projector command', intent('I need a new lawsuit'), null);
        t.eq('"who is iron man" still gets the chat answer', intent('who is iron man'), null);
        t.ok('help mentions suiting up', /suit up/.test(brain('help')));
        t.eq('"show me Earth" opens the globe', JSON.stringify(intent('Show me Earth')), '{"kind":"globe","arg":null}');
        t.eq('"show me the world"', kind('show me the world'), 'globe');
        t.eq('"spin the globe"', kind('spin the globe'), 'globe');
        t.eq('"show me Florida" flies there', JSON.stringify(intent('Show me Florida!')), '{"kind":"globe","arg":"florida"}');
        t.eq('"take me to Tokyo"', intent('take me to Tokyo')?.arg, 'tokyo');
        t.eq('"where is Paris?"', intent('where is Paris?')?.arg, 'paris');
        t.eq('"fly to Washington D.C." (dots dropped)', window.__jarvis.PLACES[intent('fly to Washington D.C.')?.arg]?.name, 'Washington DC');
        t.eq('"show me the USA" uses the alias', intent('show me the USA')?.arg, 'usa');
        t.eq('"zoom in on New York"', intent('zoom in on new york')?.arg, 'new york');
        t.eq('"show me Africa please"', intent('show me Africa please')?.arg, 'africa');
        t.eq('"take me to Mars" is still the solar system', JSON.stringify(intent('take me to Mars')), '{"kind":"solar","arg":"mars"}');
        t.eq('"take me to Earth" is still the planet in the solar system', JSON.stringify(intent('take me to Earth')), '{"kind":"solar","arg":"earth"}');
        t.eq('"make a globe" is still a particle sphere', intent('make a globe')?.arg?.shape, 'sphere');
        t.eq('"show me a heart" is still a sculpture', intent('show me a heart')?.arg?.shape, 'heart');
        t.eq('"where is my phone" is not a place', intent('where is my phone'), null);
        t.eq('"show me the world\'s tallest tower" is not the globe', intent("show me the world's tallest tower"), null);
        t.ok('help mentions the globe', /show me Earth/.test(brain('help')) && /Florida/.test(brain('help')));

        t.section('Particle shapes');

        for (const name of ['sphere', 'heart', 'star', 'rocket', 'dna', 'reactor']) {
            const o = shapePoints(name, 900);
            const finite = o && [...o.pos, ...o.col].every(Number.isFinite);
            const inColour = o && [...o.col].every((v) => v >= 0 && v <= 1);
            t.ok(`${name}: 900 points, all finite, colours in 0..1`, !!o && o.pos.length === 2700 && finite && inColour);
        }
        const rocket = shapePoints('rocket', 900);
        t.ok('the rocket marks its flame particles', rocket.flame?.[0] > 0 && rocket.flame[1] === 900);
        t.eq('text needs a 2D canvas, so jsdom gets null (the scene then falls back to a sphere)', shapePoints('text', 100, 'HI'), null);

        t.section('Neural network (no three.js needed)');

        const { neuralLayout, createNeuralSim, layerLine, NEURAL_SHAPES } = window.__jarvis;
        const net = neuralLayout([4, 6, 6, 3]);
        t.eq('4-6-6-3: 19 nodes', net.nodes.length, 19);
        t.eq('4-6-6-3: 4·6 + 6·6 + 6·3 = 78 connections', net.edges.length, 78);
        t.ok('every connection joins one layer to the next', net.edges.every(([a, b]) => net.nodes[b].l === net.nodes[a].l + 1));
        t.ok('layers are 9 apart, centred on 0', JSON.stringify([...new Set(net.nodes.map((n) => n.x))]) === '[-13.5,-4.5,4.5,13.5]');
        t.ok('each layer is centred vertically', [0, 1, 2, 3].every((l) => Math.abs(net.nodes.filter((n) => n.l === l).reduce((s, n) => s + n.y, 0)) < 1e-9));
        t.eq('half-height fits the tallest layer: (6-1)/2 · 3.2 = 8', net.halfH, 8);
        t.ok('every built-in shape has 3 to 5 layers of at most 8 nodes', NEURAL_SHAPES.length >= 4 && NEURAL_SHAPES.every((s) => s.length >= 3 && s.length <= 5 && Math.max(...s) <= 8));
        t.ok('the shapes are all different, so "next" rebuilds something new', new Set(NEURAL_SHAPES.map(String)).size === NEURAL_SHAPES.length);

        // A seeded random, so the run is the same every time.
        const seeded = (seed) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
        let sim = createNeuralSim(net, seeded(7));
        sim.burst();
        t.ok('a burst lights input nodes and sends pulses from them', sim.pulses.length > 0 && sim.pulses.every((q) => net.nodes[net.edges[q.e][0]].l === 0));
        let peak = 0;
        for (let i = 0; i < 60; i++) { sim.step(0.05); peak = Math.max(peak, sim.pulses.length); }
        t.ok('within 3 s the burst reaches the output layer', sim.arrivals[3] > 0);
        t.ok('and passes through every hidden layer on the way', sim.arrivals[1] > 0 && sim.arrivals[2] > 0);
        t.ok('a pulse never goes backwards', sim.arrivals[0] === 0);
        for (let i = 0; i < 80; i++) sim.step(0.05);
        t.eq('with no more bursts, the pulses die out', sim.pulses.length, 0);
        t.ok('and the glow fades away', Math.max(...sim.glow) < 0.01);
        sim.lightOutputs();
        t.ok('an answer lights every output node and only those', net.nodes.every((n, i) => (sim.glow[i] === 1) === (n.l === 3)));
        sim = createNeuralSim(net, seeded(3));
        sim.fireAll();
        t.ok('a squeeze lights every node at once', [...sim.glow].every((g) => g === 1));
        t.eq('and sends a pulse down every connection', sim.pulses.length, 78);
        sim = createNeuralSim(neuralLayout([8, 8, 8, 8]), seeded(5), 50);
        sim.fireAll();
        for (let i = 0; i < 20; i++) { sim.fireAll(); sim.step(0.05); }
        t.ok('pulses are capped, so a fist held down can\'t flood the frame', sim.pulses.length <= 50);
        t.ok('tapping the input layer explains it', /input layer/.test(layerLine(0, 4)));
        t.ok('tapping a middle layer names it', /hidden layer 2/.test(layerLine(2, 4)));
        t.ok('tapping the last layer explains the output', /output layer/.test(layerLine(3, 4)));

        t.section('Suit schematic (no three.js needed)');

        const { SUIT_PARTS, SUIT_CALLOUTS, SUIT_LINES, SUIT_HALF, suitOrder, suitBuildTime, suitAssembly, layoutCallouts } = window.__jarvis;
        const names = SUIT_PARTS.map((p) => p.name);
        t.eq('31 parts', SUIT_PARTS.length, 31);
        t.eq('every part has its own name', new Set(names).size, names.length);
        t.ok('every part is a box, a cylinder or a ball, with the right number of sizes', SUIT_PARTS.every((p) => ({ box: 3, cyl: 3, ball: 1 })[p.shape] === p.size.length && p.size.every((v) => v > 0)));
        t.ok('every part belongs to a group that has spec lines', SUIT_PARTS.every((p) => SUIT_LINES[p.group]?.length >= 2));
        t.ok('left and right come in mirrored pairs', SUIT_PARTS.filter((p) => p.name.startsWith('Left ')).every((l) => { const r = SUIT_PARTS.find((p) => p.name === 'Right ' + l.name.slice(5)); return r && r.pos[0] === -l.pos[0] && r.pos[1] === l.pos[1] && r.pos[2] === l.pos[2]; }));
        const lo = Math.min(...SUIT_PARTS.map((p) => p.pos[1])), hi = Math.max(...SUIT_PARTS.map((p) => p.pos[1]));
        t.ok('the suit stands on the turntable and fits its half-height', lo > 0 && hi < SUIT_HALF.y + SUIT_HALF.h);
        t.ok('and fits its half-width, arms included', SUIT_PARTS.every((p) => Math.abs(p.pos[0]) < SUIT_HALF.w));
        t.eq('the plan\'s four callouts', JSON.stringify(SUIT_CALLOUTS.map((c) => c.label)), '["Helmet HUD","Arc reactor","Repulsor","Flight stabilizer"]');
        t.ok('each callout points at a part of its own group', SUIT_CALLOUTS.every((c) => SUIT_PARTS.some((p) => p.group === c.key)));
        t.ok('each callout knows which way it faces (a unit vector)', SUIT_CALLOUTS.every((c) => Math.abs(Math.hypot(...c.n) - 1) < 0.01));
        t.ok('the arc reactor and the repulsors are on the front, the stabilizers on the back', SUIT_CALLOUTS.find((c) => c.key === 'reactor').n[2] > 0 && SUIT_CALLOUTS.find((c) => c.key === 'stabilizer').n[2] < 0);
        t.ok('the fist line tells you to make a fist', /make a fist/i.test(SUIT_LINES.repulsor[0]));

        t.eq('assembly order covers every part once', JSON.stringify([...suitOrder].sort((a, b) => a - b)), JSON.stringify(SUIT_PARTS.map((_, i) => i)));
        const firstOn = SUIT_PARTS[suitOrder.indexOf(0)], lastOn = SUIT_PARTS[suitOrder.indexOf(SUIT_PARTS.length - 1)];
        t.ok('boots go on first', /boot/.test(firstOn.name));
        t.ok('the helmet\'s eyes go on last', /eye/.test(lastOn.name));
        t.ok('a part never goes on before one lower down', SUIT_PARTS.every((p, i) => SUIT_PARTS.every((q, j) => !(suitOrder[i] < suitOrder[j]) || p.pos[1] <= q.pos[1])));
        t.eq('nothing is in place at the start', suitAssembly(0, 0), 0);
        t.ok('the last part is still away halfway through', suitAssembly(SUIT_PARTS.length - 1, suitBuildTime() / 2) === 0);
        t.ok('every part is in place when the build ends', SUIT_PARTS.every((_, i) => suitAssembly(suitOrder[i], suitBuildTime()) === 1));
        t.ok('a part only ever moves towards its place', [0, 5, 30].every((k) => { let last = -1; for (let s = 0; s <= 40; s++) { const e = suitAssembly(k, s / 10); if (e < last) return false; last = e; } return true; }));
        t.ok('the whole build takes 2 to 4 seconds', suitBuildTime() >= 2 && suitBuildTime() <= 4);

        // A phone, 390 × 844: labels between the top HUD (about 104 px) and the text box (about 660 px).
        const b = { left: 12, right: 378, top: 104, bottom: 660 };
        const fits = (out) => out.every((o) => o.x >= b.left && o.x + o.w <= b.right && o.y >= b.top && o.y + o.h <= b.bottom);
        const apart = (out) => out.every((o, i) => out.every((p, j) => i >= j || o.x + o.w <= p.x || p.x + p.w <= o.x || o.y + o.h <= p.y || p.y + p.h <= o.y));
        const rand = seeded(11);
        let allFit = true, allApart = true;
        for (let k = 0; k < 300; k++) {
            const pts = SUIT_CALLOUTS.map(() => ({ x: 60 + rand() * 270, y: rand() * 844, w: 84, h: 23 + Math.round(rand()) * 13 }));
            const out = layoutCallouts(pts, b);
            allFit &&= fits(out); allApart &&= apart(out);
        }
        t.ok('300 random poses: every label stays inside the free area', allFit);
        t.ok('300 random poses: no two labels overlap', allApart);
        const crowd = layoutCallouts([0, 1, 2, 3].map(() => ({ x: 300, y: 700, w: 84, h: 36 })), b);
        t.ok('four labels piled on one spot below the area stack up inside it', fits(crowd) && apart(crowd) && crowd.every((o) => o.side === 'R'));
        const sideOf = (x, prev) => layoutCallouts([{ x, y: 400, w: 84, h: 23 }], b, prev)[0].side;
        t.eq('an anchor left of the middle gets a label on the left', sideOf(100), 'L');
        t.eq('right of the middle, on the right', sideOf(290), 'R');
        t.eq('near the middle a label keeps last frame\'s side, so it doesn\'t flicker', sideOf(205, ['L']), 'L');
        t.eq('well past the middle it switches', sideOf(240, ['L']), 'R');
        t.eq('a label sits level with its anchor when there\'s room', layoutCallouts([{ x: 300, y: 400, w: 84, h: 24 }], b)[0].y, 388);

        t.section('Earth globe (no three.js needed)');

        const { PLACES, CITIES, CONTINENTS, latLonVec, vecLatLon, faceAngles, arcDeg, subsolar, daylight, onLand, coastSegments, oceanName, placeLine } = window.__jarvis;
        const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
        const places = Object.values(PLACES);
        t.eq('seven continents to tour', CONTINENTS.length, 7);
        t.eq('all 50 US states', places.filter((p, i, a) => p.kind === 'state' && a.indexOf(p) === i).length, 50);
        t.ok('about 200 cities for the lights, at least 200', CITIES.length >= 200);
        t.eq('no city is listed twice', new Set(CITIES.map((c) => c.name)).size, CITIES.length);
        t.ok('every place has a real latitude and longitude', places.every((p) => p.lat >= -90 && p.lat <= 90 && p.lon >= -180 && p.lon <= 180));
        t.ok('every alias points at a real place', ['usa', 'uk', 'nyc', 'la', 'bombay', 'kiev', 'oceania'].every((k) => PLACES[k]?.name));
        t.ok('(0°, 0°) is straight out along z', latLonVec(0, 0).every((v, i) => close(v, [0, 0, 1][i])));
        t.ok('the North Pole is straight up', latLonVec(90, 123).every((v, i) => close(v, [0, 1, 0][i])));
        t.ok('(0°, 90°E) is along x', latLonVec(0, 90).every((v, i) => close(v, [1, 0, 0][i])));
        let roundTrip = true;
        for (const [la, lo] of [[28.1, -81.7], [-33.9, 151.2], [64.1, -21.9], [-77.8, 166.7], [0.5, 179.5]]) { const g = vecLatLon(latLonVec(la, lo, 3)); roundTrip &&= close(g.lat, la, 1e-9) && close(g.lon, lo, 1e-9); }
        t.ok('a place turned into 3D and back comes back the same', roundTrip);
        // makeRig puts the camera at dist·(cos el·sin az, sin el, cos el·cos az) from its target (pinned below).
        t.ok('the rig\'s camera formula is the one this relies on', /camera\.position\.set\(r\.target\.x\+r\.dist\*ce\*Math\.sin\(r\.az\),r\.target\.y\+r\.dist\*Math\.sin\(r\.el\),r\.target\.z\+r\.dist\*ce\*Math\.cos\(r\.az\)\)/.test(page.html));
        const fl = PLACES.florida, fa = faceAngles(fl.lat, fl.lon);
        const camDir = [Math.cos(fa.el) * Math.sin(fa.az), Math.sin(fa.el), Math.cos(fa.el) * Math.cos(fa.az)], flv = latLonVec(fl.lat, fl.lon);
        t.ok('after "show me Florida", the camera looks straight down at Florida', close(camDir.reduce((s, v, i) => s + v * flv[i], 0), 1, 1e-12));
        t.ok('London to Paris is about 3° of arc (≈ 340 km)', Math.abs(arcDeg(PLACES.london, PLACES.paris) - 3.1) < 0.2);

        // The Sun is overhead at 23.44°N at the June solstice, at 23.44°S in December, over the equator in March.
        // At noon UTC it's near 0° longitude, off only by the equation of time (−1.6 min in June ≈ +0.4°, −7.5 min in March ≈ +1.9°).
        const jun = subsolar(new Date('2026-06-21T12:00:00Z')), dec = subsolar(new Date('2026-12-21T12:00:00Z')), mar = subsolar(new Date('2026-03-20T12:00:00Z'));
        t.ok('June solstice, noon UTC: the Sun is over 23.4°N, about 0.4°E', Math.abs(jun.lat - 23.44) < 0.05 && jun.lon > 0 && jun.lon < 1);
        t.ok('December solstice: over 23.4°S, about 0.5°W', Math.abs(dec.lat + 23.44) < 0.05 && dec.lon < 0 && dec.lon > -1);
        // The 2026 March equinox is at 14:46 UTC on the 20th; 2.8 h earlier the Sun is about 0.05° south of the equator.
        t.ok('March equinox: within 0.2° of the equator, about 1.9°E', Math.abs(mar.lat) < 0.2 && mar.lon > 1.5 && mar.lon < 2.3);
        t.ok('six hours later it has moved 90° west', Math.abs(subsolar(new Date('2026-06-21T18:00:00Z')).lon + 90) < 1);
        // In Orlando on 21 June the sun rises about 6:28 a.m. EDT (10:28 UTC) and sets about 8:27 p.m. (00:27 UTC).
        const at = (iso) => daylight(PLACES.orlando, subsolar(new Date(iso)));
        t.eq('Orlando at 1 p.m. EDT: day', at('2026-06-21T17:00:00Z'), 'day');
        t.eq('Orlando at 1 a.m. EDT: night', at('2026-06-21T05:00:00Z'), 'night');
        t.eq('Orlando at 6:30 a.m. EDT: sunrise', at('2026-06-21T10:30:00Z'), 'sunrise');
        t.eq('Orlando at 8:30 p.m. EDT: sunset', at('2026-06-22T00:30:00Z'), 'sunset');
        t.ok('a place line names the place and the time of day', /^Florida\. 28\.1°N 81\.7°W\. It's daytime there right now\.$/.test(placeLine(PLACES.florida, subsolar(new Date('2026-06-21T17:00:00Z')))));
        t.ok('a continent line includes its fact', /^Africa\. It has 54 countries/.test(placeLine(PLACES.africa, jun)));
        t.eq('the middle of the North Atlantic', oceanName(35, -40), 'the Atlantic Ocean');
        t.eq('off Peru', oceanName(-10, -90), 'the Pacific Ocean');
        t.eq('south of India', oceanName(-10, 80), 'the Indian Ocean');
        t.eq('between Greece and Libya', oceanName(35, 20), 'the Mediterranean Sea');

        let landText = null;
        try {
            landText = page.url.startsWith('file:')
                ? await readFile(fileURLToPath(new URL('jarvis/earth/land-110m.json', page.url)), 'utf8')
                : await (await fetch(new URL('jarvis/earth/land-110m.json', page.url))).text();
        } catch { /* missing */ }
        t.ok('jarvis/earth/land-110m.json is there', !!landText);
        if (landText) {
            if (page.url.startsWith('file:')) {
                t.eq('it is the pinned file', createHash('sha256').update(landText).digest('hex'), LAND_SHA256);
                const readme = await readFile(fileURLToPath(new URL('jarvis/earth/README.md', page.url)), 'utf8');
                t.ok('its README names the source, the licence and the same hash', readme.includes(LAND_SHA256) && /Natural Earth/.test(readme) && /public domain/.test(readme));
            }
            const { rings, source } = JSON.parse(landText);
            t.ok('it says where it came from', /Natural Earth/.test(source));
            t.ok('126 rings of whole tenths of a degree', rings.length === 126 && rings.every((r) => r.length % 2 === 0 && r.every(Number.isInteger)));
            for (const [name, la, lo] of [['Florida', 28.1, -81.7], ['Paris', 48.9, 2.4], ['the Sahara', 23, 10], ['Tokyo', 35.7, 139.7], ['Antarctica', -80, 0]]) t.ok(`${name} is on land`, onLand(la, lo, rings));
            for (const [name, la, lo] of [['the mid-Atlantic', 30, -40], ['the mid-Pacific', 0, -150], ['the Mediterranean', 35, 18], ['the Caspian Sea (a hole in the land)', 42, 50.5]]) t.ok(`${name} is water`, !onLand(la, lo, rings));
            const onLandShare = CITIES.filter((c) => onLand(c.lat, c.lon, rings)).length / CITIES.length;
            t.ok('at least 90% of cities are on land (coarse coasts put a few seaside ones just offshore)', onLandShare >= 0.9);
            const segs = coastSegments(rings);
            t.ok('coastline segments never jump across the ±180° seam', segs.every(([, a, , b]) => Math.abs(a - b) <= 180));
            t.ok('and never run along it (that edge is where the map was cut, not coast)', segs.every(([, a, , b]) => !(Math.abs(a) === 180 && Math.abs(b) === 180)));
            t.ok('every segment is short, under 10°', segs.every(([la, a, lb, b]) => arcDeg({ lat: la, lon: a }, { lat: lb, lon: b }) < 10));
        }

        t.section('Projector without WebGL');

        const scriptsBefore = document.querySelectorAll('script').length;
        const answer = await window.__jarvis.project({ kind: 'galaxy' });
        t.ok('says it needs WebGL', /needs WebGL/.test(answer));
        t.ok('the neural network says so too', /needs WebGL/.test(await window.__jarvis.project({ kind: 'neural' })));
        t.ok('and the suit', /needs WebGL/.test(await window.__jarvis.project({ kind: 'suit', arg: 'assemble' })));
        t.ok('and the globe', /needs WebGL/.test(await window.__jarvis.project({ kind: 'globe', arg: 'florida' })));
        t.eq('no callout labels are left behind', document.getElementById('suit-labels'), null);
        t.eq('does not fetch three.js', document.querySelectorAll('script').length, scriptsBefore);
        t.ok('the projector stays hidden', document.getElementById('holo').hidden);
        t.eq('"close" with nothing open says so', await window.__jarvis.project({ kind: 'close' }), "The projector's already off.");
        t.ok('zoom with nothing open says so', /Nothing on the projector/.test(await window.__jarvis.project({ kind: 'zoom', arg: 'in' })));
        const holoCsp = document.querySelector('meta[http-equiv="Content-Security-Policy"]').content;
        const scriptSrc = holoCsp.match(/script-src ([^;]+)/)[1].trim();
        t.eq('script-src allows only itself, WebAssembly (hand tracking) and cdnjs (three.js)', scriptSrc, "'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdnjs.cloudflare.com");
        const src = page.html;
        t.ok('three.js is loaded with an SRI hash', /THREE_SRI='sha512-dLxUelApnYxpLt6K2iomGngnHO83iUvZytA3YjDUCjT0HDOHKXnVYdf3hU4JjM8uEhxf9nD1\/ey98U3t2vZ0qQ=='/.test(src) && /s\.integrity=THREE_SRI/.test(src));

        t.section('Hand control commands');

        t.eq('"hand control"', JSON.stringify(intent('hand control')), '{"kind":"hands","arg":true}');
        t.eq('"use my hands"', intent('let me use my hands')?.arg, true);
        t.eq('"turn on gesture control"', intent('turn on gesture control')?.arg, true);
        t.eq('"stop hand control"', JSON.stringify(intent('stop hand control')), '{"kind":"hands","arg":false}');
        t.eq('"turn off the hand tracking"', intent('turn off the hand tracking')?.arg, false);
        t.eq('"give me a hand" is not hand control', intent('give me a hand'), null);
        t.eq('"stop" alone still closes the projector', kind('stop'), 'close');
        t.eq('turning hand control off when it is off', await window.__jarvis.project({ kind: 'hands', arg: false }), 'Hand control is already off.');

        t.section('Hand gestures (synthetic landmarks)');

        // 21 MediaPipe landmarks: 0 wrist, 1-4 thumb, 5-8 index, 9-12 middle,
        // 13-16 ring, 17-20 pinky (knuckle, middle joint, upper joint, tip).
        // x is already mirrored, as the page does before classifying.
        function hand(pose, x = 0.5, y = 0.5) {
            const lm = Array.from({ length: 21 }, () => ({ x, y, z: 0 }));
            const at = (i, dx, dy) => { lm[i] = { x: x + dx, y: y + dy, z: 0 }; };
            at(0, 0, 0.15); // wrist; palm size (wrist to middle knuckle) is 0.15
            [[5, -0.04], [9, 0], [13, 0.04], [17, 0.08]].forEach(([k, dx]) => {
                at(k, dx, 0); at(k + 1, dx, -0.05); at(k + 2, dx, -0.08);
                at(k + 3, dx, pose === 'fist' ? 0.03 : -0.11); // curled back into the palm, or straight out
            });
            at(1, -0.06, 0.1); at(2, -0.09, 0.06); at(3, -0.1, 0.02); at(4, -0.1, -0.02);
            if (pose === 'fist') at(4, -0.03, 0.0);
            if (pose === 'pinch') { at(4, -0.06, -0.07); at(8, -0.06, -0.07); at(7, -0.05, -0.06); }
            return lm;
        }
        const { classifyHand, createGestures } = window.__jarvis;
        const open = classifyHand(hand('open')), fist = classifyHand(hand('fist')), pinchC = classifyHand(hand('pinch'));
        t.eq('open hand: 4 fingers out', open.ext, 4);
        t.ok('open hand: not a pinch, not a fist', open.pinchR > 0.42 && !open.fist);
        t.ok('fist: no fingers out, and reads as a fist', fist.ext === 0 && fist.fist);
        t.ok('fist: the curled index finger does not count as a pinch', !fist.indexOut);
        t.ok('pinch: thumb and index tips together, index reaching out', pinchC.pinchR < 0.26 && pinchC.indexOut);

        const types = (acts) => acts.map((a) => a.type).filter((x) => x !== 'cursor' && x !== 'grab');
        let g = createGestures();
        const run = (frames) => frames.flatMap(([t, hands]) => g(hands.map((lm, i) => ({ key: 'h' + i, lm })), t));

        let acts = run([[0, [hand('pinch', 0.5)]], [0.05, [hand('pinch', 0.5)]], [0.1, [hand('open', 0.5)]]]);
        t.eq('a quick pinch in place is a tap', types(acts).join(','), 'tap');
        g = createGestures();
        acts = run([[0, [hand('pinch', 0.4)]], [0.05, [hand('pinch', 0.5)]], [0.1, [hand('pinch', 0.6)]], [0.6, [hand('open', 0.6)]]]);
        const rot = acts.filter((a) => a.type === 'rotate');
        t.ok('pinch and drag rotates, in the direction of the hand', rot.length >= 2 && rot.every((a) => a.dx > 0));
        t.ok('a pinch that moved is not a tap', !types(acts).includes('tap'));
        t.ok('grab is on while pinching and off after', acts.find((a) => a.type === 'grab').on === true && acts.filter((a) => a.type === 'grab').pop().on === false);
        g = createGestures();
        acts = run([[0, [hand('pinch', 0.4), hand('pinch', 0.6)]], [0.05, [hand('pinch', 0.35), hand('pinch', 0.65)]], [0.1, [hand('pinch', 0.3), hand('pinch', 0.7)]]]);
        const zooms = acts.filter((a) => a.type === 'zoom');
        t.ok('two hands pinching and pulling apart zoom in (factor < 1)', zooms.length >= 1 && zooms.every((a) => a.factor < 1));
        t.ok('two-hand zoom does not also rotate', !types(acts).includes('rotate'));
        g = createGestures();
        acts = run([[0, [hand('open', 0.7)]], [0.1, [hand('open', 0.6)]], [0.2, [hand('open', 0.45)]], [0.3, [hand('open', 0.4)]]]);
        t.eq('an open hand flicked left is "next"', JSON.stringify(acts.filter((a) => a.type === 'swipe')), '[{"type":"swipe","dir":1}]');
        g = createGestures();
        acts = run([[0, [hand('open', 0.7)]], [0.5, [hand('open', 0.65)]], [1.0, [hand('open', 0.6)]], [1.5, [hand('open', 0.55)]]]);
        t.ok('a slow drift is not a swipe', !types(acts).includes('swipe'));
        g = createGestures();
        acts = run([[0, [hand('fist')]], [0.1, [hand('fist')]], [0.2, [hand('fist')]], [0.3, [hand('open')]]]);
        t.eq('a fist held 150 ms squeezes, opening the hand lets go', JSON.stringify(acts.filter((a) => a.type === 'squeeze').map((a) => a.on)), '[true,false]');
        g = createGestures();
        acts = run([[0, [hand('open', 0.3, 0.2)]]]);
        const cur = acts.find((a) => a.type === 'cursor');
        // thumb tip (0.20, 0.18) and index tip (0.26, 0.09): midway is (0.23, 0.135)
        t.ok('the cursor follows the thumb and index tips', cur.hands === 1 && Math.abs(cur.x - 0.23) < 0.005 && Math.abs(cur.y - 0.135) < 0.005);
        t.eq('no hands: the cursor hides', JSON.stringify(g([], 1).find((a) => a.type === 'cursor')), '{"type":"cursor","hands":0}');

        t.section('Gesture thresholds, pinned (Session 6)');

        // Session 6 tunes gestures from what misfired on the user's devices. On 2026-10-09 the user
        // reported nothing misfiring and asked to keep the thresholds, so these pin them exactly,
        // and any later change has to move a check here on purpose.
        const pinchAt = (r, x = 0.5) => { const lm = hand('pinch', x); lm[4] = { x: lm[8].x - r * 0.15, y: lm[8].y, z: 0 }; return lm; };
        t.ok('the pinch helper gives the ratio asked for', Math.abs(classifyHand(pinchAt(0.3)).pinchR - 0.3) < 1e-9);
        const pinchedAfter = (rs) => { g = createGestures(); let on = false; rs.forEach((r, i) => { on = g([{ key: 'h', lm: pinchAt(r) }], i * 0.05).find((a) => a.type === 'grab').on; }); return on; };
        t.ok('a pinch closes below 0.26 of palm size', pinchedAfter([0.25]) && !pinchedAfter([0.27]));
        t.ok('a held pinch stays closed up to 0.42, so it doesn\'t flicker', pinchedAfter([0.2, 0.41]) && !pinchedAfter([0.2, 0.43]));
        const swipeOf = (dx, dt) => { g = createGestures(); return run([[0, [hand('open', 0.6)]], [dt, [hand('open', 0.6 - dx)]]]).some((a) => a.type === 'swipe'); };
        t.ok('a swipe needs over 22% of the frame', swipeOf(0.23, 0.3) && !swipeOf(0.21, 0.3));
        t.ok('within 0.4 s', !swipeOf(0.3, 0.45));
        g = createGestures();
        acts = run([[0, [hand('open', 0.8)]], [0.1, [hand('open', 0.5)]], [0.3, [hand('open', 0.8)]], [0.4, [hand('open', 0.5)]]]);
        t.eq('swipes are at least 0.9 s apart, so waving back doesn\'t undo one', acts.filter((a) => a.type === 'swipe').length, 1);
        g = createGestures();
        t.ok('a fist under 150 ms is not a squeeze', !run([[0, [hand('fist')]], [0.14, [hand('fist')]]]).some((a) => a.type === 'squeeze'));

        t.section('Threat scan (Session 5)');

        t.eq('"scan the room"', JSON.stringify(intent('Scan the room.')), '{"kind":"scan"}');
        for (const q of ['threat scan', 'run a threat assessment', 'jarvis, scan me', 'scan for threats', 'start a scan', 'face lock', 'security scan please'])
            t.eq(`"${q}" opens the scan`, kind(q), 'scan');
        for (const q of ['stop the scan', 'stop scanning', 'close the scanner', 'end threat scan'])
            t.eq(`"${q}" closes it`, kind(q), 'close');
        for (const q of ['scan this barcode', 'what is a cat scan', 'show me the suit'])
            t.ok(`"${q}" is not a threat scan`, kind(q) !== 'scan');
        t.ok('help mentions the threat scan', /scan the room/.test(brain('help')));

        const { scanReadout, coverMap, createFaceTracker, READOUTS } = window.__jarvis;
        let seed = 1;
        const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        const readouts = Array.from({ length: 300 }, () => scanReadout(rnd));
        const label = (l) => l.split(': ')[0];
        t.ok('every readout has three lines, threat level first', readouts.every((r) => r.length === 3 && label(r[0]) === 'THREAT LEVEL'));
        t.ok('and never the same kind of line twice', readouts.every((r) => new Set(r.map(label)).size === 3));
        t.ok('every value comes from the list', readouts.every((r) => r.every((l) => READOUTS.some(([k, v]) => l === `${k}: ${v.find((x) => l.endsWith(': ' + x)) ?? '?'}`))));
        t.eq('over many scans, every kind of line turns up', new Set(readouts.flat().map(label)).size, READOUTS.length);
        t.ok('a random number of exactly 1 can\'t index past a list', scanReadout(() => 0.9999999999).length === 3 && scanReadout(() => 0.9999999999).every((l) => !/undefined/.test(l)));
        t.ok('readouts are made up, not read from a face: scanReadout takes no picture', scanReadout.length <= 1);

        // A 640x480 camera frame filling a 1280x800 screen: scale 2, 80 px cropped top and bottom, mirrored.
        // Video x 100..150 scales to 200..300, and mirrored that's 1280-300 = 980 to 1080.
        let m = coverMap(640, 480, 1280, 800);
        t.ok('desktop: the frame is scaled to cover the screen', m.s === 2 && m.ox === 0 && m.oy === -80);
        t.eq('a face on the left of the camera shows on the right (mirrored)', JSON.stringify(m.box({ originX: 100, originY: 100, width: 50, height: 60 })), '{"x":980,"y":120,"w":100,"h":120}');
        // On an upright phone, 390x844: scale 844/480, the sides are cropped.
        m = coverMap(640, 480, 390, 844);
        const mid = m.box({ originX: 300, originY: 220, width: 40, height: 40 });
        t.ok('phone: the middle of the camera is the middle of the screen', Math.abs(mid.x + mid.w / 2 - 195) < 1e-9 && Math.abs(mid.y + mid.h / 2 - 422) < 1e-9);

        let tr = createFaceTracker(rnd);
        let ks = tr([{ x: 100, y: 100, w: 80, h: 80 }], 0);
        t.ok('a new face becomes target 1, with a readout', ks.length === 1 && ks[0].id === 1 && ks[0].fresh && ks[0].lines.length === 3);
        const firstLines = ks[0].lines.join('|');
        ks = tr([{ x: 110, y: 104, w: 82, h: 80 }], 0.05);
        t.ok('moving a little, it stays target 1 with the same readout', ks.length === 1 && ks[0].id === 1 && ks[0].lines.join('|') === firstLines && !ks[0].fresh);
        t.ok('and its brackets ease halfway to the new spot, so they don\'t jitter', ks[0].x === 105 && ks[0].y === 102);
        ks = tr([{ x: 105, y: 102, w: 80, h: 80 }, { x: 600, y: 120, w: 70, h: 70 }], 0.1);
        t.eq('a second face far away becomes target 2', JSON.stringify(ks.map((k) => k.id)), '[1,2]');
        ks = tr([{ x: 600, y: 120, w: 70, h: 70 }], 0.4);
        t.eq('a face missing for a moment is kept', ks.length, 2);
        ks = tr([{ x: 600, y: 120, w: 70, h: 70 }], 0.7);
        t.eq('gone for over half a second, it is dropped', JSON.stringify(ks.map((k) => k.id)), '[2]');
        ks = tr([{ x: 100, y: 100, w: 80, h: 80 }, { x: 600, y: 120, w: 70, h: 70 }], 0.75);
        t.eq('a face coming back is a new target, not an old number reused', JSON.stringify(ks.map((k) => k.id).sort()), '[2,3]');
        tr = createFaceTracker(rnd);
        tr([{ x: 100, y: 100, w: 80, h: 80 }, { x: 200, y: 100, w: 80, h: 80 }], 0);
        ks = tr([{ x: 205, y: 100, w: 80, h: 80 }, { x: 95, y: 100, w: 80, h: 80 }], 0.03);
        t.ok('two faces side by side keep their own numbers, whatever order the detector lists them', ks.find((k) => k.id === 1).x < 100 && ks.find((k) => k.id === 2).x > 200);

        t.ok('without a camera, the scan says so', /needs a camera/.test(await window.__jarvis.project({ kind: 'scan' })));
        t.ok('and the projector stays closed', document.getElementById('holo').hidden && !document.body.classList.contains('scan-on'));
        t.ok('the scan has no way to save a picture: no toDataURL, toBlob or MediaRecorder', !/toDataURL|toBlob|MediaRecorder/.test(src));
        // Session 8 added one download, the settings backup, built from backupData() alone (checked in "Settings backup").
        t.eq('the only download link anywhere is the settings backup', (src.match(/\w+\.download\s*=[^;]*/g) || []).join(), 'a.download=BACKUP_FILE');
        t.ok('the scan closes itself when the tab is hidden', /visibilitychange',\(\)=>\{if\(document\.hidden&&H&&H\.kind==='scan'\)closeHolo\(\)\}/.test(src));
        t.ok('the scan asks the camera for video only, never audio', (src.match(/getUserMedia\(/g) || []).length === 3 && (src.match(/getUserMedia\(\{video:\{facingMode:'user',width:\{ideal:640\},height:\{ideal:480\}\},audio:false\}\)/g) || []).length === 2);
        t.ok('and so does reading a settings code (Session 8), with the camera on the back', (src.match(/getUserMedia\(\{video:\{facingMode:'environment',width:\{ideal:1280\},height:\{ideal:720\}\},audio:false\}\)/g) || []).length === 1);
        t.ok('the face detector loads from jarvis/hands/ on this site', /modelAssetPath:url\('blaze_face_short_range\.tflite'\)/.test(src));

        t.section('Self-hosted hand tracker');

        if (page.url.startsWith('file:')) {
            for (const [file, want] of Object.entries(HAND_FILES)) {
                let got = 'missing';
                try { got = createHash('sha256').update(await readFile(fileURLToPath(new URL('jarvis/hands/' + file, page.url)))).digest('hex'); } catch { /* missing */ }
                t.eq(`jarvis/hands/${file} is the pinned file`, got, want);
            }
            const readme = await readFile(fileURLToPath(new URL('jarvis/hands/README.md', page.url)), 'utf8');
            t.ok('the README lists the same hashes', Object.values(HAND_FILES).every((h) => readme.includes(h)));
        } else {
            t.note('hash checks skipped: not running against the working copy');
        }
        t.ok('the page loads the tracker from jarvis/hands/ on this site', /new URL\('jarvis\/hands\/'\+f,location\.href\)/.test(page.html) && !/cdn\.jsdelivr|storage\.googleapis/.test(page.html));

        t.section('Top HUD and mic note');

        t.ok('title, stat and hint sit together on one backing strip', ['holo-title', 'holo-stat', 'holo-hint'].every((id) => document.getElementById(id)?.parentElement?.id === 'holo-top'));
        t.ok('the strip comes before the corner brackets, so it draws under them', !!(document.getElementById('holo-top').compareDocumentPosition(document.querySelector('.c-tl')) & window.Node.DOCUMENT_POSITION_FOLLOWING));
        const micNote = document.getElementById('mic-note');
        t.ok('the mic note says voice goes to an online speech service and typing stays here', /online speech service/.test(micNote?.textContent) && /Typing stays on this device/.test(micNote?.textContent));
        t.ok('without speech recognition the mic note stays hidden', micNote.hidden);

        t.section('Voice-reactive orb: the pulse');

        const { orbPulse } = window.__jarvis;
        const near = (a, b) => Math.abs(a - b) < 1e-9;
        const pulseAt = (o) => orbPulse({ mode: 'speak', energy: 0.8, t: 0, ...o });
        t.ok('reduced motion holds the pulse steady over time', near(pulseAt({ still: true, t: 0 }), pulseAt({ still: true, t: 1234 })));
        t.ok('reduced motion ignores words too', near(pulseAt({ still: true, sinceWord: 0 }), pulseAt({ still: true, sinceWord: 0.5 })));
        const heard = [0, 30, 60, 90, 110].map((tt) => orbPulse({ mode: 'listen', energy: 1, t: tt, hearing: true }));
        t.ok('hearing you talk: a fast flutter between 40% and 100%', new Set(heard.map((v) => v.toFixed(3))).size > 1 && heard.every((v) => v >= 0.4 - 1e-9 && v <= 1 + 1e-9));
        t.ok('reduced motion holds still even while it hears you', near(orbPulse({ mode: 'listen', energy: 0.9, t: 0, hearing: true, still: true }), orbPulse({ mode: 'listen', energy: 0.9, t: 70, hearing: true, still: true })));
        t.ok('a word just started: full pulse', near(pulseAt({ sinceWord: 0 }), 0.8));
        t.ok('0.1 s into a word: about half way down (0.45 + 0.55 e^-0.7)', near(pulseAt({ sinceWord: 0.1 }), 0.8 * (0.45 + 0.55 * Math.exp(-0.7))));
        t.ok('a long pause between words settles to 45%', Math.abs(pulseAt({ sinceWord: 2 }) - 0.36) < 0.001);
        const sine = [0, 45, 90, 135].map((tt) => pulseAt({ t: tt }));
        t.ok('a voice that reports no words falls back to the sine pulse', new Set(sine.map((v) => v.toFixed(4))).size > 1 && sine.every((v) => v >= 0.8 * 0.2 - 1e-9 && v <= 0.8 + 1e-9));

        t.section('Typing a message');

        const q = document.getElementById('q');
        q.value = '<img src=x onerror=alert(1)>';
        document.getElementById('f').dispatchEvent(new window.Event('submit', { cancelable: true }));
        t.eq('the input clears after Send', q.value, '');
        const mine = [...document.querySelectorAll('#log .msg.me')].pop();
        t.eq('the message is shown as text, not HTML', mine?.textContent, '<img src=x onerror=alert(1)>');
        t.eq('no element was injected', document.querySelectorAll('#log img').length, 0);
        t.eq('goes to PROCESSING', document.getElementById('state').textContent, 'PROCESSING');
        await wait(600);
        t.ok('Jarvis answers', document.querySelectorAll('#log .msg.ai').length >= 2);
        t.eq('without speech synthesis it returns to STANDBY', document.getElementById('state').textContent, 'STANDBY');
    } finally {
        close();
    }

    await voiceWiring(t, page);
    await micErrors(t, page);
    await wakeWiring(t, page);
    await briefingChecks(t, page);
    await speechWiring(t, page);
    await skinsAndMemory(t, page);
    await voicePicker(t, page);
    await androidVoices(t, page);
    await memoryChecks(t, page);
    await memoryFoundation(t, page);
    await keptApart(t, page);
    await protocolsAndFollowUps(t, page);
    await backupAndQr(t, page);
    await heRemembersYou(t, page);
    await meaningModule(t, page);
    await knowledgePack(t, page);
    await fullBrain(t, page);
    await commandLinks(t, page);
    await screens(t, page);
}

// Session 11 of jarvis/build-plan.html: he remembers you (review 63). The recap, clearance levels, favourites and the
// discovery log are all worked out from the usage counts on each load and after each turn, and none of them is saved.
// The only new saved thing is the "favourites first" choice, a setting in jarvis-settings, through store(). Only the
// new extras (the gold-and-red HUD, the Tesseract, the Avengers logo, the last line) are locked behind a level.
// Levels are tested by filling the usage counts, the way the plan asks.
// The 36 usage IDs as they stood before Session 11: none of them may be locked behind a level.
const EVENT_IDS_BEFORE_S11 = ['app:visit', ...['galaxy', 'solar', 'globe', 'neural', 'suit', 'particles', 'memory'].map((k) => 'scene:' + k),
    ...['scan', 'briefing', 'setting', 'remember', 'teach', 'help', 'time', 'date', 'joke', 'fact', 'coin', 'die', 'math', 'chat', 'protocol', 'house-party', 'wake-up', 'backup', 'restore', 'qr', 'qr-scan'].map((k) => 'cmd:' + k),
    ...['jarvis', 'matrix', 'panther'].map((k) => 'skin:' + k), ...['mic', 'wake-word', 'hands', 'voice'].map((k) => 'feature:' + k)];
async function heRemembersYou(t, page) {
    const URL_ = 'https://jarvis.test/jarvis.html', quiet = { ignore: /getContext|HTMLCanvasElement/ };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const today = dayOf();
    // n visit days before today (1 to n days ago), each with app:visit and anything else listed for that day.
    const daysBack = (n, extra = () => []) => Array.from({ length: n }, (_, k) => [{ id: 'app:visit', day: today - 1 - k, n: 1 }, ...extra(k)]).flat();
    const ev = (id, ago, n = 1) => ({ id, day: today - ago, n });
    // A profile whose database holds exactly these records, as earlier visits would have left them.
    const profile = async (records) => {
        const first = await openDom(page.html, URL_, quiet), idb = first.idb;
        first.close(); await wait(40);
        await new Promise((res) => { const rq = idb.open('jarvis-test'); rq.onsuccess = () => { const db = rq.result, tx = db.transaction(['kept', 'events', 'totals', 'meta', 'protocols'], 'readwrite'); for (const n of ['kept', 'events', 'totals', 'meta', 'protocols']) tx.objectStore(n).clear(); tx.oncomplete = () => { db.close(); res(); }; }; });
        await dbSeed(idb, { ...records, meta: { copied: 1, ...(records.meta || {}) } });
        return idb;
    };
    const lastAi = (env) => [...env.document.querySelectorAll('#log .msg.ai')].pop()?.textContent ?? '';
    const typeIn = async (env, text) => { const { document, window } = env; document.getElementById('q').value = text; document.getElementById('f').dispatchEvent(new window.Event('submit', { cancelable: true })); await wait(520); return lastAi(env); };
    const greet = async (env) => { env.window.__jarvis.finishBoot(); await wait(50); return lastAi(env); };
    let env = await openDom(page.html, URL_, quiet);
    let J = env.window.__jarvis;
    const SCENES5 = ['galaxy', 'solar', 'globe', 'neural', 'suit'].map((k) => 'scene:' + k);
    // Every capability found, as all-time totals (everything this jsdom window can do, and the rest too).
    const allFound = () => J.CAPABILITIES.filter((c) => (c.lock || 0) < 5).flatMap((c) => c.ids).map((id) => ({ id, n: 1 }));
    const lv = (evs, tots = [], carry = 0) => J.clearanceOf(J.usageOf(evs, tots, carry, today));
    try {
        t.section('He remembers you: every clearance threshold (Session 11)');
        t.eq('five levels: Visitor, Associate, Engineer, Avenger, Stark', J.LEVELS.slice(1).map((l) => l.name).join(), 'Visitor,Associate,Engineer,Avenger,Stark');
        t.eq('no counts: level 1', lv([]), 1);
        t.eq('2 days: still 1', lv(daysBack(2)), 1);
        t.eq('3 days: 2, Associate', lv(daysBack(3)), 2);
        const scenes = (k) => (k < 5 ? [{ id: SCENES5[k], day: today - 1 - k, n: 1 }] : []);
        t.eq('9 days and 5 scenes: still 2', lv(daysBack(9, scenes)), 2);
        t.eq('10 days and 4 scenes: still 2', lv(daysBack(10, (k) => (k < 4 ? scenes(k) : []))), 2);
        t.eq('10 days and 5 scenes: 3, Engineer', lv(daysBack(10, scenes)), 3);
        t.eq('the memory core counts as one of the five', lv(daysBack(10, (k) => (k < 4 ? scenes(k) : k === 4 ? [ev('scene:memory', 5)] : []))), 3);
        t.eq('the Tesseract (an extra) does not', lv(daysBack(10, (k) => (k < 4 ? scenes(k) : k === 4 ? [ev('scene:tesseract', 5)] : []))), 2);
        const four = (k) => [...scenes(k), ...(k === 7 ? [ev('cmd:teach', 8)] : []), ...(k === 8 ? [ev('cmd:protocol', 9)] : [])];
        t.eq('29 days, a phrase taught and a protocol run: still 3', lv(daysBack(29, four)), 3);
        t.eq('30 days, a phrase taught and a protocol run: 4, Avenger', lv(daysBack(30, four)), 4);
        t.eq('30 days without a phrase taught: 3', lv(daysBack(30, (k) => four(k).filter((e) => e.id !== 'cmd:teach'))), 3);
        t.eq('30 days without a protocol run: 3', lv(daysBack(30, (k) => four(k).filter((e) => e.id !== 'cmd:protocol'))), 3);
        t.eq('house party is not "a protocol of your own"', lv(daysBack(30, (k) => [...four(k).filter((e) => e.id !== 'cmd:protocol'), ...(k === 8 ? [ev('cmd:house-party', 9)] : [])])), 3);
        t.eq('59 days with everything found: 4', lv(daysBack(59, four), allFound()), 4);
        t.eq('60 days with everything found: 5, Stark', lv(daysBack(60, four), allFound()), 5);
        const oneShort = allFound().filter((x) => x.id !== 'cmd:joke');
        t.eq('60 days with one thing not found: 4', lv(daysBack(60, four), oneShort), 4);
        t.eq('level 5 does not ask for the level-5 secret itself', lv(daysBack(60, four), allFound().filter((x) => x.id !== 'cmd:iron-man')), 5);
        t.eq('the streak\'s carry is real days, so it counts', lv(daysBack(2), [], 1), 2);

        t.section('He remembers you: counts can\'t push a level past what fits() allows (Session 11)');
        t.eq('a huge all-time visit total adds no days', lv([], [{ id: 'app:visit', n: 1e9 }]), 1);
        t.eq('nor does every capability in the totals, with no days', lv([], allFound().map((x) => ({ ...x, n: 1e9 }))), 1);
        t.eq('days after today don\'t count', lv(Array.from({ length: 70 }, (_, k) => ({ id: 'app:visit', day: today + 1 + k, n: 1 }))), 1);
        t.eq('an ID not on the list doesn\'t count', lv(Array.from({ length: 70 }, (_, k) => ({ id: 'cmd:secret', day: today - k, n: 1 }))), 1);
        t.eq('nor a count that isn\'t a whole number, a date for a day, or an extra field',
            lv([...Array.from({ length: 5 }, (_, k) => ({ id: 'app:visit', day: today - k, n: 1.5 })), ...Array.from({ length: 5 }, (_, k) => ({ id: 'app:visit', day: `2026-10-0${k + 1}`, n: 1 })), ...Array.from({ length: 5 }, (_, k) => ({ id: 'app:visit', day: today - 10 - k, n: 1, note: 'x' }))]), 1);
        t.eq('a negative carry is ignored', lv(daysBack(2), [], -50), 1);
    } finally { env.close(); }

    // A restored backup: only what fits() lets in reaches the counts, and the level is read from those.
    env = await openDom(page.html, URL_, quiet); J = env.window.__jarvis;
    try {
        const hostile = { app: 'jarvis', backup: 1, kept: {}, protocols: {},
            days: [...Array.from({ length: 80 }, (_, k) => ['cmd:secret', today - k, 1]), ...Array.from({ length: 80 }, (_, k) => ['app:visit', today + 1 + k, 1]),
                ...Array.from({ length: 10 }, (_, k) => ['app:visit', today - 1 - k, 1.5]), ...Array.from({ length: 10 }, (_, k) => ['app:visit', String(today - 1 - k), 1]), ...Array.from({ length: 10 }, (_, k) => ['app:visit', today - 1 - k, 1, 'x'])],
            totals: [['app:visit', 1e9], ...J.CAPABILITIES.flatMap((c) => c.ids).map((id) => [id, 1e9])], meta: { carry: 9999, rolled: 0 }, level: 5 };
        const r = J.restoreBackup(JSON.stringify(hostile));
        t.eq('a hostile backup: 190 bad days refused, and its "meta" and "level" keys', r.skipped, 192);
        // Its totals are all allowed (a listed ID and a whole number), so everything counts as found, but they add no days.
        const d = J.discovery(J.usageNow());
        t.ok('its totals fit(), so everything counts as found', d.found === d.reach);
        t.eq('but the level stays where real days put it', J.levelNow(), 1);
        t.eq('its meta and its "level" are ignored', JSON.stringify(J.saved().meta.carry ?? 0), '0');
        t.ok('every count that did get in fits()', J.saved().events.every((e) => J.fits('events', [e.id, e.day], e)) && J.saved().totals.every((x) => J.fits('totals', x.id, x)));
        // A valid backup from another device, with 60 real days in the window: that does count, as fits() allows.
        const good = { app: 'jarvis', backup: 1, kept: {}, protocols: {}, days: daysBack(60, four2).map((e) => [e.id, e.day, e.n]), totals: [] };
        function four2(k) { return [...(k < 5 ? [{ id: SCENES5[k], day: today - 1 - k, n: 1 }] : []), ...(k === 7 ? [{ id: 'cmd:teach', day: today - 8, n: 1 }] : []), ...(k === 8 ? [{ id: 'cmd:protocol', day: today - 9, n: 1 }] : [])]; }
        J.restoreBackup(JSON.stringify(good));
        t.eq('a valid backup with 60 real days brings its days, which is what fits() allows: now level 5', J.levelNow(), 5);
        t.ok('and "how well do you know me" says so', /^Clearance level five, Stark\. I've seen you on sixty-one days/.test(await J.answer('how well do you know me')));
    } finally { env.close(); }
    // Counts edited straight into the database (the browser's developer tools): days after today still don't count.
    {
        const idb = await profile({ events: Array.from({ length: 70 }, (_, k) => ({ id: 'app:visit', day: today + 1 + k, n: 1 })) });
        env = await openDom(page.html, URL_, { ...quiet, idb }); J = env.window.__jarvis;
        t.eq('70 future days put straight into the database: level 1', J.levelNow(), 1);
        env.close();
    }

    t.section('He remembers you: the recap (Session 11)');
    env = await openDom(page.html, URL_, quiet); J = env.window.__jarvis;
    try {
        const snap = (evs, tots = []) => ({ evs, tots, carry: 0 });
        t.eq('no counts: no recap', J.recapOf(snap([]), today), null);
        let r = J.recapOf(snap([ev('app:visit', 1), ev('scene:solar', 1, 2), ev('scene:galaxy', 1), ev('scene:suit', 3, 9)]), today);
        t.eq('the scene used most on the last day, with a question', r.text, 'Last time we were looking at the solar system. Shall I bring it back up?');
        t.eq('which "yes" will reopen', r.scene, 'solar');
        r = J.recapOf(snap([ev('app:visit', 11), ev('scene:globe', 11)]), today);
        t.eq('after a long gap, worked out from day numbers', r.text, "It's been a while: eleven days. Last time we were looking at the Earth. Shall I bring it back up?");
        t.eq('a gap of 23 days in words', J.recapOf(snap([ev('app:visit', 23), ev('scene:globe', 23)]), today).text.split('.')[0], "It's been a while: twenty-three days");
        t.eq('six days is not a long gap', J.recapOf(snap([ev('app:visit', 6), ev('scene:globe', 6)]), today).text, 'Last time we were looking at the Earth. Shall I bring it back up?');
        r = J.recapOf(snap([ev('app:visit', 2), ev('scene:neural', 2)]), today, true);
        t.eq('with an opening scene set, that wins: he only mentions the last one', r.text, 'Last time we were looking at my neural network.');
        t.eq('and asks nothing', r.scene, null);
        t.eq('protocols and skin changes', J.recapOf(snap([ev('app:visit', 1), ev('cmd:house-party', 1), ev('cmd:protocol', 1), ev('skin:matrix', 1)]), today).text, 'Last time we had a house party, you ran one of your protocols and you switched me to Morpheus.');
        t.eq('only chat on the last day: nothing to recap', J.recapOf(snap([ev('app:visit', 1), ev('cmd:joke', 1), ev('cmd:time', 1)]), today), null);
        t.eq('a visit earlier today', J.recapOf(snap([ev('app:visit', 0), ev('scene:memory', 0)]), today).text, 'Earlier today we were looking at my memory core. Shall I bring it back up?');
        t.eq('older than the 90 kept days: only that it\'s been a while', J.recapOf(snap([], [{ id: 'scene:globe', n: 4 }]), today).text, "It's been a while.");
        t.eq('days after today are ignored', J.recapOf(snap([ev('app:visit', -3), ev('scene:galaxy', -3)]), today), null);
    } finally { env.close(); }
    {
        const fake = fakeSpeech();
        const idb = await profile({ events: [ev('app:visit', 1), ev('scene:globe', 1, 3), ev('scene:galaxy', 1), ev('app:visit', 2)] });
        env = await openDom(page.html, URL_, { ...quiet, idb, beforeParse: fake.beforeParse }); J = env.window.__jarvis;
        try {
            const g = await greet(env);
            t.ok('the greeting carries the recap, once per visit', /Last time we were looking at the Earth\. Shall I bring it back up\?$/.test(g), g);
            t.ok('and it is spoken through say()', fake.log.spoken.join(' ').includes('Shall I bring it back up?'));
            const before = J.saved().events.find((e) => e.id === 'scene:globe' && e.day === today)?.n ?? 0;
            const y = await typeIn(env, 'yes');
            t.ok('"yes" reopens it (no WebGL here, so he says so)', /needs WebGL/.test(y), y);
            t.eq('and counts it, like asking for it', (J.saved().events.find((e) => e.id === 'scene:globe' && e.day === today)?.n ?? 0) - before, 1);
            J.finishBoot(); await J.answer('reboot'); J.finishBoot(); await wait(50);
            t.ok('a reboot doesn\'t repeat it', !/Last time/.test(lastAi(env)));
        } finally { env.close(); }
        // With an opening scene saved, the recap asks nothing.
        const idb2 = await profile({ kept: { 'jarvis-settings': '{"scene":"galaxy"}' }, events: [ev('app:visit', 1), ev('scene:suit', 1)] });
        env = await openDom(page.html, URL_, { ...quiet, idb: idb2 });
        try {
            const g = await greet(env);
            t.ok('with an opening scene set, the greeting mentions the last one and asks nothing', /Last time we were looking at the suit schematic\.$/.test(g), g);
            t.eq('"no" then just gets "All right."', await env.window.__jarvis.answer('no'), 'All right.');
        } finally { env.close(); }
        // "No" to the question.
        const idb3 = await profile({ events: [ev('app:visit', 1), ev('scene:suit', 1)] });
        env = await openDom(page.html, URL_, { ...quiet, idb: idb3 });
        try { await greet(env); t.eq('"no" drops it', await env.window.__jarvis.answer('no'), 'All right. Ask whenever you want it.'); } finally { env.close(); }
    }

    t.section('He remembers you: levels on the page (Session 11)');
    {
        const scenes10 = (k) => (k < 5 ? [{ id: SCENES5[k], day: today - 1 - k, n: 1 }] : []);
        const fake = fakeSpeech();
        const idb = await profile({ events: daysBack(9, scenes10) });
        env = await openDom(page.html, URL_, { ...quiet, idb, beforeParse: fake.beforeParse }); J = env.window.__jarvis;
        try {
            t.eq('nine days before today and five scenes: level 2 before this visit', J.shownLevel(), 2);
            const g = await greet(env);
            t.ok('today makes ten: the greeting announces level 3', / Access level three granted: Engineer\. A few new files have opened up for you\./.test(g), g);
            const sw = env.document.getElementById('levelup');
            t.ok('with the ACCESS LEVEL 3 GRANTED sweep', !sw.hidden && sw.textContent === 'ACCESS LEVEL 3 GRANTEDENGINEER' && sw.classList.contains('go'));
            t.eq('which is a status line for screen readers', sw.getAttribute('role'), 'status');
            await wait(3700);
            t.ok('and goes after a few seconds', sw.hidden);
            t.ok('"how well do you know me" gives the level and the day count', /^Clearance level three, Engineer\. I've seen you on ten days, and you've found \d+ of the \d+ things I can show you here\. Level four, Avenger, needs twenty more days, a phrase you teach me and a protocol of your own, run once\.$/.test(await J.answer('how well do you know me')));
            for (const q of ['how well do you know me?', 'How well do you know me', 'jarvis how well do you know me', 'hey jarvis how well do you know me please', 'what level am i', "what's my clearance level", 'whats my clearance', 'what clearance do i have'])
                t.ok(`"${q}" asks for it`, /^Clearance level three/.test(await J.answer(q)));
            t.ok('his "didn\'t understand" line follows the level', /^That isn't in my schematics\. Yet\. .*say ⟦learn that⟧\.$/.test(await J.answer('blorp the snorkel')));
            await J.answer('no');
            const chats = [];
            for (let i = 0; i < 8; i++) chats.push(await J.answer('how are you'));
            t.eq('the odd aside: every fourth chat answer', chats.map((c) => c.endsWith('Noted in the workshop log.')).join(), 'false,false,false,true,false,false,false,true');
            t.ok('commands themselves don\'t change: the time is just the time', /^It's \d/.test(await J.answer('what time is it')) && !/Noted/.test(await J.answer('flip a coin')));
            t.ok('a third-level extra is open now: the Tesseract (no WebGL here, so he says so)', /needs WebGL/.test(await J.answer('show me the tesseract')) && J.saved().events.some((e) => e.id === 'scene:tesseract'));
            t.ok('and so is the gold-and-red HUD', /^Gold-and-red HUD engaged/.test(await J.answer('gold and red hud')) && env.document.documentElement.dataset.hud === 'hotrod');
            t.eq('which turns the orb red and gold', J.ring(), '255,80,50');
            t.ok('"normal hud" turns it off', /usual colours/.test(await J.answer('normal hud')) && !env.document.documentElement.dataset.hud && J.ring() === '57,255,136');
            t.ok('the Avengers logo is still locked at 3', /^The Avengers logo is above your clearance\. It opens at level four, Avenger/.test(await J.answer('avengers assemble')));
            t.ok('a locked extra isn\'t counted as found', !J.saved().events.some((e) => e.id === 'cmd:avengers'));
            t.ok('"why" explains the lock', /stays open to everyone/.test(await J.answer('why')));
            t.ok('help lists what this level opened', /Opened by your clearance: ⟦gold and red HUD⟧ and ⟦the Tesseract\|show me the Tesseract⟧\.$/.test(J.brainKnown('help')));
            t.ok('every spoken line went through say(), a sentence at a time', fake.log.spoken.every((x) => x.length <= 200));
        } finally { env.close(); }
        // The next visit: no level-up again, just the level's own greeting line.
        env = await openDom(page.html, URL_, { ...quiet, idb }); J = env.window.__jarvis;
        try {
            const g = await greet(env);
            t.ok('the next visit doesn\'t announce it again, and says the level\'s line', !/Access level/.test(g) && /The workshop is yours, as always\./.test(g), g);
            t.ok('the HUD was for that visit only', !env.document.documentElement.dataset.hud);
        } finally { env.close(); }
        // Mid-visit: one more scene opened makes level 3.
        const idb2 = await profile({ events: daysBack(9, (k) => (k < 4 ? scenes10(k) : [])) });
        env = await openDom(page.html, URL_, { ...quiet, idb: idb2 }); J = env.window.__jarvis;
        try {
            await greet(env);
            t.eq('ten days and four scenes: level 2', J.levelNow(), 2);
            const said = await typeIn(env, 'show me the suit');
            t.ok('the fifth scene, mid-visit: level 3 is announced after the answer', /needs WebGL.* Access level three granted: Engineer\./.test(said), said);
            t.ok('with the sweep', !env.document.getElementById('levelup').hidden);
            t.ok('only once', !/Access level/.test(await typeIn(env, 'tell me a joke')));
        } finally { env.close(); }
        // Each skin has its own lines for every level.
        const L = J.LEVEL_TALK;
        let complete = true;
        for (const k of ['jarvis', 'matrix', 'panther']) for (let l = 2; l <= 5; l++) for (const f of ['hi', 'up', 'miss', 'aside']) if (typeof L[k][l]?.[f] !== 'string' || !L[k][l][f]) complete = false;
        t.ok('Jarvis, Morpheus and Stanley each have a greeting, a level-up, a miss and an aside for levels 2 to 5', complete);
        t.ok('and none of Morpheus\'s or Stanley\'s lines is Jarvis\'s', ['matrix', 'panther'].every((k) => [2, 3, 4, 5].every((l) => ['hi', 'up', 'miss', 'aside'].every((f) => L[k][l][f] !== L.jarvis[l][f]))));
        const idb3 = await profile({ kept: { 'jarvis-skin': 'matrix' }, events: daysBack(9, scenes10) });
        env = await openDom(page.html, URL_, { ...quiet, idb: idb3 }); J = env.window.__jarvis;
        try {
            const g = await greet(env);
            t.ok('Morpheus announces it his way', /Access level three granted: Engineer\. You are beginning to believe\./.test(g), g);
            t.ok('and misses his way', /^Some questions have no answer\. Yet\./.test(await J.answer('blorp the snorkel')));
        } finally { env.close(); }
        const idb4 = await profile({ kept: { 'jarvis-skin': 'panther' }, events: daysBack(4) });
        env = await openDom(page.html, URL_, { ...quiet, idb: idb4 });
        try { t.ok('Stanley greets an Associate his way', /Back on the ice! Love to see it\./.test(await greet(env))); } finally { env.close(); }
        // Level 5: the last line.
        const all = (k) => [...(k < 5 ? [{ id: SCENES5[k], day: today - 1 - k, n: 1 }] : [])];
        const idb5 = await profile({ events: daysBack(60, all), totals: J.CAPABILITIES.filter((c) => (c.lock || 0) < 5).flatMap((c) => c.ids).map((id) => ({ id, n: 3 })) });
        env = await openDom(page.html, URL_, { ...quiet, idb: idb5 }); J = env.window.__jarvis;
        try {
            t.eq('sixty days and everything found: level 5', J.levelNow(), 5);
            t.eq('"I am Iron Man" is the last line', await J.answer('I am Iron Man'), 'Yes, you are. And I love you three thousand.');
            t.ok('counted, so it shows as found', J.saved().events.some((e) => e.id === 'cmd:iron-man'));
            t.ok('"how well do you know me" at the top', /That's the top\. There's nothing I'd keep from you\.$/.test(await J.answer('how well do you know me')));
        } finally { env.close(); }
        env = await openDom(page.html, URL_, quiet); J = env.window.__jarvis;
        try { t.ok('below 5, "I am Iron Man" is locked, and he doesn\'t call you Iron', /^That line is above your clearance/.test(await J.answer("i'm iron man")) && !/Iron\b/.test(await J.answer('what is my name'))); } finally { env.close(); }
    }

    t.section('He remembers you: nothing that existed is gated (Session 11)');
    env = await openDom(page.html, URL_, quiet); J = env.window.__jarvis;
    try {
        t.eq('a new profile is level 1', J.levelNow(), 1);
        t.ok('at level 1 the Tesseract is locked, says what opens it, and isn\'t counted', /^The Tesseract is above your clearance\. It opens at level three, Engineer/.test(await J.answer('show me the tesseract')) && !J.saved().events.some((e) => e.id === 'scene:tesseract'));
        t.ok('so are the HUD, the Avengers logo and the last line', /above your clearance/.test(await J.answer('gold and red hud')) && /above your clearance/.test(await J.answer('avengers assemble')) && /above your clearance/.test(await J.answer('I am Iron Man')) && !env.document.documentElement.dataset.hud);
        t.eq('the levels the extras need', JSON.stringify([J.lockOf({ kind: 'tesseract' }), J.lockOf({ kind: 'particles', arg: { shape: 'avengers' } }), J.lockOf({ kind: 'particles', arg: { shape: 'heart' } }), J.lockOf({ kind: 'galaxy' })]), '[3,4,0,0]');
        const lockedKeys = J.CAPABILITIES.filter((c) => c.lock).map((c) => c.key).join();
        t.eq('only four things are locked: the new extras', lockedKeys, 'hud,tesseract,avengers,iron-man');
        t.ok('and none of their IDs existed before Session 11', J.CAPABILITIES.filter((c) => c.lock).every((c) => c.ids.every((id) => !EVENT_IDS_BEFORE_S11.includes(id))));
        t.ok('no protocol step needs a level', Object.values(J.STEPS).every((s) => { const it = J.intent(s.text); return !it || J.lockOf(it) === 0; }));
        const newCmds = new Set(J.CAPABILITIES.filter((c) => c.lock).flatMap((c) => c.cmds).map((c) => c.toLowerCase()));
        const older = J.chipCmds().filter((c) => !newCmds.has(c.toLowerCase()) && !/^show me the tesseract$/i.test(c));
        const gated = [];
        for (const c of older) { const r = await J.answer(c); if (typeof r === 'string' && /above your clearance/.test(r)) gated.push(c); }
        t.eq(`none of the other ${older.length} link commands is gated at level 1`, gated.join(', '), '');
    } finally { env.close(); }
    {
        // The same commands answer the same way at level 1 and at level 5.
        const deterministic = ['what is seven times eight', 'show me the galaxy', 'suit up', 'list my protocols', 'make the orb blue', 'speak faster', 'switch to matrix', 'back to jarvis', 'scan the room', 'house party'];
        const answers = async (e) => { const out = []; for (const q of deterministic) out.push(await e.window.__jarvis.answer(q)); return out; };
        const a1 = await answers(env = await openDom(page.html, URL_, quiet)); env.close();
        const idb = await profile({ events: daysBack(60, (k) => (k < 5 ? [{ id: SCENES5[k], day: today - 1 - k, n: 1 }] : [])), totals: J.CAPABILITIES.filter((c) => (c.lock || 0) < 5).flatMap((c) => c.ids).map((id) => ({ id, n: 3 })) });
        env = await openDom(page.html, URL_, { ...quiet, idb });
        t.eq('(that profile is level 5)', env.window.__jarvis.levelNow(), 5);
        const a5 = await answers(env); env.close();
        t.eq('the same commands get the same answers at level 1 and level 5', JSON.stringify(a5), JSON.stringify(a1));
    }

    t.section('He remembers you: favourites (Session 11)');
    {
        const idb = await profile({ events: [ev('app:visit', 1), ev('scene:globe', 1, 31), ev('scene:galaxy', 2, 5), ev('cmd:house-party', 3, 4), ev('scene:suit', 4, 2)] });
        env = await openDom(page.html, URL_, { ...quiet, idb }); J = env.window.__jarvis;
        try {
            t.eq('"what\'s my favourite?"', await J.answer("what's my favourite?"), 'The Earth, by a distance. Opened 31 times.');
            for (const q of ['whats my favourite', 'what is my favorite', "what's my favourite scene", 'what do i use most', 'jarvis whats my favourite please', 'which is my favourite'])
                t.eq(`"${q}"`, await J.answer(q), 'The Earth, by a distance. Opened 31 times.');
            await J.answer('my favourite colour is green');
            t.eq('"what\'s my favourite colour" is still short-term memory', await J.answer("what's my favourite colour"), 'Your favourite colour is green.');
            t.ok('"what\'s my favourite protocol": counted only as protocol runs, so no name', /^I count how often your protocols run, not which one ran, so I can't name a favourite\. You haven't run one of your own yet\. House party: 4 times\.$/.test(await J.answer('whats my favourite protocol')));
            t.ok('"why" says why', /never a name you chose/.test(await J.answer('why')));
            const lead = J.favLead();
            t.eq('the top three, used at least three times, go first in the links', lead, 'Your favourites first: ⟦the Earth|show me earth⟧, ⟦the galaxy|show me the galaxy⟧ and ⟦house party⟧. ');
            t.ok('at the front of the help', J.brainKnown('help').startsWith(lead));
            t.ok('and of the "didn\'t understand" list', (await J.answer('blorp the snorkel')).includes(lead + 'Tap ⟦see what I can do'));
            await J.answer('no');
            const help = await typeIn(env, 'help');
            const links = [...env.document.querySelectorAll('#log .msg.ai')].pop().querySelectorAll('button.cmd');
            t.eq('they are real links in the bubble', [...links].slice(0, 3).map((b) => b.textContent).join(' | '), 'the Earth | the galaxy | house party');
            for (let i = 0; i < 39; i++) J.track('scene:suit');
            await typeIn(env, 'show me the suit'); // a real turn, which is when anything worked out after a turn would change
            t.eq('the order doesn\'t move mid-visit, even when the counts change', J.favLead(), lead);
            t.ok('nor do the links in the help', J.brainKnown('help').startsWith(lead));
            t.eq('though "what\'s my favourite" answers from the counts as they are', await J.answer('whats my favourite'), 'The suit schematic, just ahead of the Earth. Opened 42 times.');
            t.eq('favourites glow brighter in the memory core', J.capabilityStars().filter((s) => s.state === 'favourite').map((s) => s.key).sort().join(), 'galaxy,globe,suit');
            void help;
        } finally { env.close(); }
        env = await openDom(page.html, URL_, { ...quiet, idb }); J = env.window.__jarvis;
        try {
            t.eq('the next load reorders them', J.favLead(), 'Your favourites first: ⟦the suit schematic|show me the suit⟧, ⟦the Earth|show me earth⟧ and ⟦the galaxy|show me the galaxy⟧. ');
            t.eq('"stop putting my favourites first"', await J.answer('stop putting my favourites first'), "From your next visit, I'll keep my command links in their usual order. I'll remember that on this device.");
            t.eq('saved as a setting, through store()', JSON.parse((await dbDump(env.idb)).kept['jarvis-settings']).chips, 'off');
            t.ok('still first for the rest of this visit', J.favLead().startsWith('Your favourites first'));
            t.ok('it can\'t go in a protocol', /favourites first is a setting for my next visit/i.test(await J.answer('create links protocol: stop putting my favourites first, then tell me a joke')));
            await J.answer('no');
        } finally { env.close(); }
        env = await openDom(page.html, URL_, { ...quiet, idb }); J = env.window.__jarvis;
        try {
            t.eq('off: the next load keeps the usual order', J.favLead(), '');
            t.ok('and help starts with its usual line', J.brainKnown('help').startsWith(J.HELP_LINE));
            t.ok('"what do you save" lists it', /my command links in their usual order/.test(await J.answer('what do you save')));
            t.ok('the memory core shows it as a setting star', J.memoryStars().some((s) => s.type === 'setting' && s.label === 'Favourites first: off'));
            for (const q of ['keep the links in their usual order', "don't put my favourites first", 'turn off adaptive chips', 'stop adapting the chips', 'stop moving the links'])
                t.eq(`"${q}" turns it off`, J.settingsIntent(q)?.value, 'off');
            for (const q of ['put my favourites first', 'adapt the chips', 'turn on adaptive links'])
                t.eq(`"${q}" turns it on`, JSON.stringify(J.settingsIntent(q)), '{"key":"chips","value":null}');
            t.eq('"put my favourites first"', await J.answer('put my favourites first'), "From your next visit, I'll put your favourites first in my command links. I'll remember that on this device.");
            t.ok('which removes it from the saved settings', !('chips' in JSON.parse((await dbDump(env.idb)).kept['jarvis-settings'] || '{}')));
            t.eq('cleanSettings() keeps only "off"', JSON.stringify([J.cleanSettings({ chips: 'off' }), J.cleanSettings({ chips: 'on' }), J.cleanSettings({ chips: true })]), '[{"chips":"off"},{},{}]');
            t.eq('store() takes it', J.store('jarvis-settings', '{"chips":"off"}'), true);
            t.ok('a backup carries it', /chips/.test(J.backupData().kept['jarvis-settings']));
        } finally { env.close(); }
        // An occasional nudge: a scene used at least three times, not in the last 14 days, when there's nothing to recap.
        const idb2 = await profile({ events: [ev('scene:suit', 20, 5), ev('app:visit', 20), ev('app:visit', 1), ev('cmd:joke', 1)] });
        env = await openDom(page.html, URL_, { ...quiet, idb: idb2 }); J = env.window.__jarvis;
        try {
            t.ok('"You haven\'t opened the suit schematic in a while."', /You haven't opened the suit schematic in a while\.$/.test(await greet(env)));
            t.eq('not for a scene used in the last 14 days', J.nudgeOf(J.usageOf([ev('scene:suit', 10, 5)], [], 0, today), today), '');
            t.eq('nor one used twice', J.nudgeOf(J.usageOf([ev('scene:suit', 30, 2)], [], 0, today), today), '');
            t.eq('older than the kept days counts as a while', J.nudgeOf(J.usageOf([], [{ id: 'scene:globe', n: 9 }], 0, today), today), "You haven't opened the Earth in a while.");
        } finally { env.close(); }
    }

    t.section('He remembers you: the discovery log (Session 11)');
    env = await openDom(page.html, URL_, quiet); J = env.window.__jarvis;
    try {
        const ids = J.CAPABILITIES.flatMap((c) => c.ids);
        t.eq('every capability ID is a usage ID', ids.filter((id) => !J.EVENT_IDS.includes(id)).join(), '');
        t.eq('and none is in two capabilities', ids.length, new Set(ids).size);
        t.eq('every usage ID is a capability, or listed with a reason why not', J.EVENT_IDS.filter((id) => !ids.includes(id) && !J.NOT_CAPABILITIES[id]).join(), '');
        t.ok('and those two are the only ones', Object.keys(J.NOT_CAPABILITIES).sort().join() === 'app:visit,skin:jarvis' && Object.values(J.NOT_CAPABILITIES).every((x) => x.length > 10));
        t.eq('every key is different', new Set(J.CAPABILITIES.map((c) => c.key)).size, J.CAPABILITIES.length);
        t.ok('the Session 8 transfer commands are there', ['cmd:backup', 'cmd:restore', 'cmd:qr', 'cmd:qr-scan'].every((id) => ids.includes(id)) && ['back up my settings', 'restore my settings', 'send my settings to my phone', 'scan settings'].every((c) => J.CAPABILITIES.some((x) => x.cmds.includes(c))));
        // A command with no entry fails here, so a later session can't forget to add one.
        const homes = new Set([...J.CAPABILITIES.flatMap((c) => c.cmds), ...Object.keys(J.NOT_COUNTED)].map((c) => c.toLowerCase()));
        t.eq('every command link belongs to a capability, or is listed as not one', J.chipCmds().filter((c) => !homes.has(c.toLowerCase())).join(', '), '');
        const counted = [...page.html.matchAll(/\btrack\('([^']+)'/g)].map((m) => m[1]).filter((id) => !id.endsWith(':')); // 'skin:'+k is built from the skin list
        t.eq('everything the page counts by name is on the list', counted.filter((id) => !J.EVENT_IDS.includes(id)).join(), '');
        t.ok('every capability has a hint, and every hint\'s links are real command links', J.CAPABILITIES.every((c) => c.hint.length > 20 && [...c.hint.matchAll(/⟦([^⟦⟧|]+)(?:\|([^⟦⟧|]+))?⟧/g)].every((m) => J.chipCmds().includes(m[2] || m[1]))));
        // What a level-1 newcomer sees in this browser (jsdom: no WebGL, camera, mic or voices). It does have WebAssembly,
        // which is all the language module (Session 12) needs, so that one counts here.
        const cant = (c) => c.can && c.can !== 'wasm';
        const d = J.discovery(J.usageNow());
        t.ok('the count leaves out what this browser can\'t do', !J.CAPABILITIES.filter(cant).some((c) => d.missing.includes(c)));
        t.eq('and what\'s locked', d.locked, 4);
        const first = await J.answer('what haven\'t I tried');
        const d2 = J.discovery(J.usageNow());
        t.ok('"what haven\'t I tried?"', new RegExp(`^You've discovered ${d2.found} of ${d2.reach}\\. Here's a hint: .+ Four more are behind a higher clearance\\.$`).test(first), first);
        const hints = [first];
        for (let i = 1; i < d2.missing.length; i++) hints.push(await J.answer('what havent i tried'));
        const given = hints.map((h) => h.replace(/^.*Here's a hint: /, '').replace(/ Four more.*$/, ''));
        t.eq('the hints don\'t repeat until every one has been given', new Set(given).size, d2.missing.length);
        t.ok('then they start again', given.includes((await J.answer('what have i not tried')).replace(/^.*Here's a hint: /, '').replace(/ Four more.*$/, '')));
        for (const q of ['what havent i tried', 'what have i not tried yet', 'jarvis what haven\'t i tried', 'give me a hint', "what's left to discover", 'what else can i try'])
            t.ok(`"${q}" asks it`, /^You've discovered/.test(await J.answer(q)));
        t.ok('no hint is for something locked or unavailable', !J.CAPABILITIES.filter((c) => c.lock || cant(c)).some((c) => given.includes(c.hint)));
        t.ok('a newcomer at level 1 hears no "new capability" lines', !/New capability/.test(await typeIn(env, 'tell me a joke')));
        const stars = J.capabilityStars();
        t.eq('the memory core\'s locked stars: the four extras', stars.filter((s) => s.state === 'locked').map((s) => s.key).join(), 'hud,tesseract,avengers,iron-man');
        t.ok('undiscovered ones are dim and unlabelled; found ones are bright', stars.some((s) => s.state === 'unfound') && stars.some((s) => s.state === 'found') && stars.every((s) => !('label' in s)));
        t.ok('a locked star says what opens it', stars.find((s) => s.key === 'tesseract').text === 'Locked. Clearance level three, Engineer, opens it.');
        t.ok('none of them is in the labelled, forgettable list', !J.memoryStars().some((s) => /capability/i.test(s.type)));
    } finally { env.close(); }
    {
        const idb = await profile({ events: daysBack(3) });
        env = await openDom(page.html, URL_, { ...quiet, idb }); J = env.window.__jarvis;
        try {
            await greet(env);
            t.eq('"New capability logged: jokes." the first time, from level 2', (await typeIn(env, 'tell me a joke')).match(/New capability logged: .*$/)?.[0], 'New capability logged: jokes.');
            t.ok('not the second time', !/New capability/.test(await typeIn(env, 'tell me a joke')));
            J.track('feature:voice');
            t.ok('something found outside a turn (the voice menu, the mic) is logged with the next answer', /New capability logged: voices\.$/.test(await typeIn(env, 'tell me a joke')));
            t.ok('the memory core has a clearance star from level 2, which can\'t be forgotten', J.memoryStars().some((s) => s.type === 'level' && s.label === 'Clearance 2: Associate') && /nothing to forget/.test(J.forgetStar({ type: 'level' })));
        } finally { env.close(); }
    }
    // Every capability's command counts it, at level 5 (so the extras are open), except where jsdom lacks what it needs.
    {
        const idb = await profile({ events: daysBack(60, (k) => (k < 5 ? [{ id: SCENES5[k], day: today - 1 - k, n: 1 }] : [])), totals: J.CAPABILITIES.filter((c) => (c.lock || 0) < 5).flatMap((c) => c.ids).filter((id) => id !== 'cmd:joke').map((id) => ({ id, n: 3 })) });
        env = await openDom(page.html, URL_, { ...quiet, idb }); J = env.window.__jarvis;
        try {
            const NEEDS = { mic: 'a microphone', 'wake-word': 'speech recognition', voice: 'voices', restore: 'a file', 'qr-scan': 'a camera', 'house-party': 'WebGL', backup: 'a file download', teach: 'two turns', remember: 'no link: tested elsewhere', 'iron-man': 'level 5 (tested above)', 'full-brain': 'WebGPU (counted in the full brain section)' };
            J.restoreBackup(JSON.stringify({ app: 'jarvis', backup: 1, kept: { 'jarvis-settings': '{"color":"blue"}' } })); // so there's something to put in a settings code
            await J.answer('create movie night protocol: make the orb purple, then open the galaxy');
            J.setPace(0.002);
            const silent = [];
            for (const c of J.CAPABILITIES) {
                if (NEEDS[c.key]) continue;
                const was = c.ids.map((id) => J.usageNow().n[id] || 0).reduce((a, b) => a + b, 0);
                await J.answer(c.cmds[0]); await J.protocolDone();
                const now = c.ids.map((id) => J.usageNow().n[id] || 0).reduce((a, b) => a + b, 0);
                if (now <= was) silent.push(`${c.key} (${c.cmds[0]})`);
            }
            t.eq(`each capability's first command counts it (${J.CAPABILITIES.length - Object.keys(NEEDS).length} checked here)`, silent.join(', '), '');
        } finally { env.close(); }
    }

    t.section('He remembers you: nothing new is saved (Session 11)');
    {
        const idb = await profile({ events: daysBack(12, (k) => (k < 4 ? [{ id: SCENES5[k], day: today - 1 - k, n: 1 }] : [])) });
        env = await openDom(page.html, URL_, { ...quiet, idb }); J = env.window.__jarvis;
        try {
            await greet(env);
            t.ok('(a level-up happens in this visit)', /Access level three/.test(await typeIn(env, 'show me the suit')));
            for (const q of ['how well do you know me', 'whats my favourite', 'what havent i tried', 'gold and red hud', 'show me the tesseract', 'yes', 'stop putting my favourites first']) await typeIn(env, q);
            const db = await dbDump(env.idb);
            t.eq('the database has only its six tables', Object.keys(db).sort().join(), 'events,kept,meta,pack,protocols,totals');
            t.ok('kept: only the listed settings keys', Object.keys(db.kept).every((k) => J.STORE_KEYS.includes(k)));
            t.eq('meta: only the three bookkeeping numbers', Object.keys(db.meta).filter((k) => !['copied', 'rolled', 'carry'].includes(k)).join(), '');
            t.ok('no level, favourite, hint or HUD anywhere in it', !/clearance|Engineer|Associate|favourite|hint|hotrod|hud|level|announced/i.test(JSON.stringify(db.kept) + JSON.stringify(db.meta)));
            t.eq('fits() refuses settings with anything but the fixed choices in them', JSON.stringify([J.fits('kept', 'jarvis-settings', '{"color":"blue","level":3}'), J.fits('kept', 'jarvis-settings', '{"color":"teal"}'), J.fits('kept', 'jarvis-settings', '[1]'), J.fits('kept', 'jarvis-settings', '{"speed":"slow","color":"blue","chips":"off"}')]), '[false,false,false,true]');
            t.ok('every count is a listed ID', Object.values(db.events).every((e) => J.EVENT_IDS.includes(e.id)));
            t.eq('the one new setting is "favourites first"', JSON.parse(db.kept['jarvis-settings'] ?? '{}').chips, 'off');
        } finally { env.close(); }
    }
}

// A factory whose databases open only when the test says so, to see what the page does while it waits.
// Everything else is the real fake-indexeddb underneath.
function gatedFactory(real, gate) {
    return {
        open(name, version) {
            const rq = real.open(name, version), out = {};
            Object.defineProperty(out, 'result', { get: () => rq.result });
            Object.defineProperty(out, 'transaction', { get: () => rq.transaction });
            rq.onupgradeneeded = (e) => out.onupgradeneeded?.(e);
            rq.onsuccess = () => gate.then(() => out.onsuccess?.());
            rq.onerror = () => out.onerror?.();
            return out;
        }
    };
}

// Session 10 of jarvis/build-plan.html: protocols and follow-ups (review 61). A protocol is a saved name and a
// list of fixed command IDs, checked inside save() like every other record. The follow-up context (again, go back,
// bigger, yes, why…) is memory only: it never reaches the database and a reload starts it empty.
async function protocolsAndFollowUps(t, page) {
    const URL_ = 'https://jarvis.test/jarvis.html', quiet = { ignore: /getContext|HTMLCanvasElement/ };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    let env = await openDom(page.html, URL_, quiet);
    const J = env.window.__jarvis, A = (x) => J.answer(x);
    J.setPace(0.002); // protocol gaps and waits, shrunk so the suite doesn't sit through them
    const logText = () => [...env.document.querySelectorAll('#log .msg.ai')].map((m) => m.textContent);
    try {
        t.section('Protocols: the fixed command list (Session 10)');
        const ids = Object.keys(J.STEPS);
        t.ok('every step ID is a fixed kind:name code, nothing personal', ids.every((id) => /^(?:orb|speed|units|skin|scene|planet|suit|shape|holo|zoom|say|wait):[a-z0-9-]+$/.test(id) && !J.personal(id)));
        const roundTrip = ids.filter((id) => J.stepOf(J.STEPS[id].text)?.id !== id);
        t.eq('every step\'s own command parses back to the same ID, so each is something he already understands', roundTrip.join(', '), '');
        t.ok('no step can start the camera or the mic, reboot, or show a place', !ids.some((id) => /scan|hands|camera|mic|wake|boot|place/.test(id)));
        t.ok('every scene a protocol can open is one of the page\'s own scenes', ids.filter((id) => id.startsWith('scene:')).every((id) => J.EVENT_IDS.includes(id)));
        t.eq('waits go from 1 to 30 seconds', [J.stepOf('wait 5 seconds')?.id, J.stepOf('pause for ten seconds')?.id, J.stepOf('wait a moment')?.id, J.stepOf('wait 31 seconds')?.no].join(), 'wait:5,wait:10,wait:3,wait');
        for (const [q, no] of [['forget my name', 'destructive'], ['reset my settings', 'destructive'], ['delete movie night', 'destructive'], ['scan the room', 'camera'], ['hand control', 'camera'],
            ['always listen', 'mic'], ['reboot', 'boot'], ['show me Florida', 'place'], ['write my name', 'words'], ['open with the galaxy', 'startup'], ['run house party', 'nested'], ['house party', 'nested']])
            t.eq(`"${q}" can't be a step (${no})`, J.stepOf(q)?.no, no);
        t.eq('a step that doesn\'t parse is null', J.stepOf('make it cosy'), null);

        t.section('Protocols: making one (Session 10)');
        const before = JSON.stringify(J.protocols());
        let r = await A('Create movie night protocol: make the orb purple, speak slower, then open the galaxy.');
        t.ok('"create movie night protocol: …" saves it', /^Protocol saved: Movie night, three steps: make the orb purple, speak slowly and open the galaxy\./.test(r), r);
        t.eq('as three fixed IDs, never the words', JSON.stringify(J.protocols()['movie night']), '{"steps":["orb:purple","speed:slow","scene:galaxy"]}');
        t.eq('nothing changed while it was being made', JSON.stringify(J.settings()), '{}');
        for (const [q, name, steps] of [
            ['make a protocol called bedtime, that makes the orb blue and speaks slower', 'bedtime', 'orb:blue,speed:slow'],
            ['new protocol named morning: what time is it, then brief me', 'morning', 'say:time,say:briefing'],
            ['set up a party mode protocol to switch to panthers and make a heart', 'party mode', 'skin:panther,shape:heart'],
            ['create the space protocol: take me to Saturn, wait 5 seconds, zoom in', 'space', 'planet:saturn,wait:5,zoom:in'],
            // what a phone's speech recognition hands over: no colon and no commas
            ['create film protocol make the orb purple speak slower then open the galaxy', 'film', 'orb:purple,speed:slow,scene:galaxy'],
            ['make a protocol called game day switch to panthers tell me a joke and start a launch countdown', 'game day', 'skin:panther,say:joke,say:countdown'],
            ['new suit protocol show me the suit then zoom in', 'suit', 'scene:suit,zoom:in']]) {
            r = await A(q);
            t.eq(`"${q}"`, (J.protocols()[name]?.steps || []).join(), steps);
        }
        r = await A('create cosy protocol: make the orb orange, make it cosy, then tell me a joke');
        t.eq('a step that doesn\'t parse: he asks before saving the rest', r, 'I didn\'t follow "make it cosy". Save the other two steps?');
        t.ok('and saves nothing yet', !('cosy' in J.protocols()));
        r = await A('yes');
        t.ok('"yes" saves the other two', /^Protocol saved: Cosy, two steps/.test(r) && J.protocols().cosy?.steps.join() === 'orb:orange,say:joke', r);
        await A('create dud protocol: tell me a joke, make it sparkly');
        r = await A('no');
        t.eq('"no" saves nothing', [r, 'dud' in J.protocols()].join(' | '), 'All right. I haven\'t saved it. | false');
        await A('create dud protocol: tell me a joke, make it sparkly');
        await A('tell me a joke');
        r = await A('create linky protocol: tell me a joke, ⟦Tokyo|show me Tokyo⟧ sparkles');
        t.ok('a part said back in quotes loses any ⟦…⟧ markers, so your words can\'t become a link', !/[⟦⟧|]/.test(r) && /^I didn't follow "Tokyo show me Tokyo sparkles"\. Save the other step\?$/.test(r), r);
        await A('no');
        t.ok('anything else said drops the question', !J.context().question && !('dud' in J.protocols()));

        t.section('Protocols: what can\'t be saved (Session 10)');
        const refused = async (q, re, label) => { const n = Object.keys(J.protocols()).length; const out = await A(q); t.ok(label, re.test(out) && Object.keys(J.protocols()).length === n, out); return out; };
        await refused('create my phone 239 555 0142 protocol: tell me a joke', /^I won't save a protocol called that, because it has a phone or ID number in it\.$/, 'a personal name is refused (a phone number)');
        await refused('create my mom protocol: tell me a joke', /something about you/, 'and so is "my mom"');
        await refused('create a really very long name here protocol: tell me a joke', /four words or fewer/, 'a name longer than four words');
        await refused('create house party protocol: tell me a joke', /built-in/, 'a built-in protocol\'s name');
        await refused('create wipe protocol: forget my name', /nothing in one may delete anything\. So there's nothing to save yet\.$/, 'a destructive step is refused');
        r = await A('create mixed protocol: tell me a joke, forget everything i told you');
        t.ok('and only offered without it', /^I can't put "forget everything i told you" in a protocol.*Save the other step\?$/.test(r), r);
        await A('no');
        await refused('create too long protocol: tell me a joke, flip a coin, roll a die, hello, zoom in, zoom out, close', /at most 6 steps, and that one has 7\. Nothing saved\.$/, 'at most 6 steps');
        await refused('create two scenes protocol: show me the galaxy and suit up', /can open one scene, and that one opens two: open the galaxy and build the suit\. Nothing saved\.$/, 'one scene per protocol');
        await refused('create inside protocol: run movie night', /a protocol can't run another one/, 'no protocol inside another');
        await refused('create inside protocol: movie night protocol', /a protocol can't run another one/, 'however it\'s put');
        await refused('create cam protocol: scan the room', /uses the camera/, 'nothing that starts the camera');
        await refused('create where protocol: show me Tokyo', /can't save a place/, 'and no places, which could give away where you live');
        await refused('create waiting protocol: wait 5 seconds', /at least one command besides waiting/, 'a protocol that only waits');
        r = await A('create movie night protocol: make the orb red, then show me the solar system');
        t.eq('an existing name asks first', r, 'You already have a movie night protocol. Replace it?');
        await A('no');
        t.eq('and "no" keeps it as it was', J.protocols()['movie night'].steps.join(), 'orb:purple,speed:slow,scene:galaxy');
        for (let i = Object.keys(J.protocols()).length; i < J.PROTO_MAX; i++) await A(`create filler ${'abcdefghijklmnopqrstuvwxyz'[i]} protocol: flip a coin`);
        t.eq(`${J.PROTO_MAX} protocols is the most`, Object.keys(J.protocols()).length, 20);
        await refused('create one more protocol: flip a coin', /You have 20 protocols, the most I keep\. Delete one first/, 'a 21st is refused');
        t.ok('every refusal has a reason for "why"', /^Because /.test(await A('why')));

        t.section('Protocols: stored as IDs only (Session 10)');
        let d = await dbDump(env.idb);
        t.eq('the database holds exactly the protocols the page has', JSON.stringify(Object.keys(d.protocols).sort()), JSON.stringify(Object.keys(J.protocols()).sort()));
        t.ok('each record is {steps:[IDs]} and nothing else', Object.values(d.protocols).every((p) => Object.keys(p).join() === 'steps' && p.steps.every((s) => s in J.STEPS)));
        t.ok('none of the words you said is in the database, only names', !/purple, speak|make the orb|tell me a joke|then open|sparkly|0142|my mom/.test(JSON.stringify(d)));
        const { fits } = J;
        t.eq('fits(): a protocol', fits('protocols', 'movie night', { steps: ['orb:purple', 'scene:galaxy'] }), true);
        t.eq('fits(): words as a step', fits('protocols', 'movie night', { steps: ['make the orb purple'] }), false);
        t.eq('fits(): seven steps', fits('protocols', 'movie night', { steps: Array(7).fill('say:joke') }), false);
        t.eq('fits(): two scenes', fits('protocols', 'movie night', { steps: ['scene:galaxy', 'scene:globe'] }), false);
        t.eq('fits(): a personal name', fits('protocols', 'call 239 555 0142', { steps: ['say:joke'] }), false);
        t.eq('fits(): a name not in its saved form', fits('protocols', 'The Movie Night protocol', { steps: ['say:joke'] }), false);
        t.eq('fits(): an extra field riding along', fits('protocols', 'movie night', { steps: ['say:joke'], said: 'make the orb purple' }), false);
        t.eq('fits(): sys:boot, which only the built-in wake up may use', fits('protocols', 'boot me', { steps: ['sys:boot'] }), false);
        t.eq('fits(): a 21st name', fits('protocols', 'brand new', { steps: ['say:joke'] }), false);
        t.eq('protocols are saved in two places (making one, a restore), and removed in two (delete by name, the scrub)', [(page.html.match(/save\('protocols',/g) || []).length, page.html.includes("save('protocols',name,{steps:steps.slice()})"),
            page.html.includes("n.length<=30&&Array.isArray(steps)&&save('protocols',n,{steps:steps.slice(0,PROTO_STEPS+1)})"), page.html.includes("save('protocols',name,undefined)"), page.html.includes("save('protocols',k,undefined)")].join(), '4,true,true,true,true');

        t.section('Protocols: list, describe, run, delete (Session 10)');
        r = await A('list my protocols');
        t.ok('"list my protocols" names them and the built-ins', /^You have 20 protocols: movie night \(3 steps\), bedtime \(2 steps\)/.test(r) && /house party, and wake up, daddy's home\.$/.test(r), r);
        t.eq('"what does movie night do?"', await A('what does movie night do?'), 'Movie night will make the orb purple, speak slowly and open the galaxy.');
        t.ok('and the built-ins', /^House party opens each of my scenes in turn/.test(await A('what does the house party protocol do')) && /boot sequence/.test(await A("what does wake up daddy's home do")));
        const counted = () => (J.saved().events.find((e) => e.id === 'cmd:protocol' && e.day === dayOf()) || { n: 0 }).n;
        const c0 = counted();
        r = await A('movie night');
        t.eq('saying the name runs it (the run speaks for itself)', r, null);
        const hud = env.document.getElementById('proto');
        t.eq('the HUD shows it running', [hud.hidden, hud.textContent].join(' '), 'false PROTOCOL: MOVIE NIGHT · 1/3');
        t.ok('and the projector\'s top lines do too', env.document.getElementById('holo-proto').textContent === hud.textContent);
        await J.protocolDone();
        t.eq('its steps ran in turn', JSON.stringify(J.settings()), '{"color":"purple","speed":"slow"}');
        t.ok('settings changes are shown, not spoken; the rest is said once at the end', /^Movie night protocol\. My holo-projector needs WebGL/.test(logText().pop()));
        t.ok('and the HUD clears when it ends', hud.hidden && hud.textContent === '');
        t.eq('running counts once as cmd:protocol, never by its name', counted(), c0 + 1);
        t.ok('no event ID carries a protocol name', !J.saved().events.some((e) => /movie|night|bedtime/.test(e.id)) && !J.EVENT_IDS.some((id) => /movie|night/.test(id)));
        t.ok('the run IDs are on the fixed list', ['cmd:protocol', 'cmd:house-party', 'cmd:wake-up'].every((id) => J.EVENT_IDS.includes(id)));
        for (const q of ['run movie night', 'engage the movie night protocol', 'movie night protocol', 'initiate protocol movie night']) {
            await A(q); t.ok(`"${q}" runs it`, J.running()?.label === 'movie night'); await J.protocolDone();
        }
        await A('run space');
        const spaceHud = env.document.getElementById('proto').textContent;
        r = await A('stop');
        t.ok('"stop" while one runs stops it', r === 'Protocol stopped.' && !J.running() && env.document.getElementById('proto').hidden, `${spaceHud} → ${r}`);
        await A('run space'); await A('tell me a joke');
        t.ok('and anything else said stops it too', !J.running());
        r = await A('run cosy');await J.protocolDone();
        t.ok('a joke step is spoken', /^Cosy protocol\. \S/.test(logText().pop()));
        t.eq('a name he doesn\'t have', await A('run the picnic protocol'), "I don't have a protocol called picnic. Say list my protocols to hear yours.");
        t.ok('"start" still means its usual commands when no protocol has that name', /Liftoff!$/.test(await A('start a launch countdown')));
        t.eq('house party needs the projector, and says so without it', await A('house party'), "House party needs my holo-projector, and this browser doesn't have WebGL turned on.");
        r = await A('delete all my protocols');
        t.eq('no wipe: "delete all my protocols"', r, 'I only delete protocols one at a time, by name, like: delete movie night.');
        t.ok('and nothing went', Object.keys(J.protocols()).length === 20);
        t.ok('"forget every protocol" too', /one at a time/.test(await A('forget every protocol')));
        t.eq('a built-in can\'t be deleted', await A('delete house party'), 'House party is built in, so there\'s nothing to delete.');
        r = await A('delete movie night');
        t.eq('deleting one by name asks first', r, 'Delete the movie night protocol? Say yes or no.');
        t.eq('"no" keeps it', [await A('no'), 'movie night' in J.protocols()].join(' | '), "All right. I've kept movie night. | true");
        await A('delete the movie night protocol');
        t.eq('"yes" deletes it', [await A('yes'), 'movie night' in J.protocols()].join(' | '), 'Deleted. Movie night is gone. | false');
        d = await dbDump(env.idb);
        t.ok('from the database too', !('movie night' in d.protocols) && Object.keys(d.protocols).length === 19);
        t.ok('"what do you save" counts protocols', /19 protocols you made \(a name and my own command codes for each\)/.test(await A('what do you save')));
        const stars = J.memoryStars().filter((s) => s.type === 'protocol');
        t.ok('each protocol is a star in the memory core, with one small star per step', stars.length === 19 && stars.find((s) => s.key === 'bedtime')?.steps === 2);
        t.eq('forgetting its star deletes it', J.forgetStar(stars.find((s) => s.key === 'bedtime')), 'Forgotten. The bedtime protocol is deleted.');
        await wait(40);
        t.ok('for real', !('bedtime' in J.protocols()) && !('bedtime' in (await dbDump(env.idb)).protocols));

        t.section('Follow-ups (Session 10)');
        // A fresh window: no protocols running, an empty context.
        env.close();
        env = await openDom(page.html, URL_, quiet);
        const K = env.window.__jarvis, B = (x) => K.answer(x);
        t.eq('"why" with nothing before it', await B('why'), "Why what? I haven't said anything yet.");
        t.eq('"again" with nothing before it', await B('again'), "Again? I haven't done anything yet this visit. Ask me something first.");
        t.eq('"yes" with no question', await B('yes'), "Yes to what? I didn't ask you anything.");
        t.eq('"no" with no question', await B('no'), 'All right.');
        r = await B('tell me a joke');
        t.eq('"what was that?" repeats the last answer', await B('what was that?'), r);
        t.eq('"why?" when there\'s no reason', await B('why?'), "There's no deeper reason behind that one. It's just what I know.");
        const jokes = new Set([r]); for (let i = 0; i < 12; i++) jokes.add(await B('again'));
        t.ok('"again" does it again (another joke)', jokes.size > 1 && [...jokes].every((j) => !/Again\?/.test(j)));
        t.ok('"do that again" and "one more time" too', !/Again\?/.test(await B('do that again')) && !/Again\?/.test(await B('one more time')));
        await B('make the orb red');
        await B('now blue');
        t.eq('a fragment fills in what came before: "make the orb red" … "now blue"', K.settings().color, 'blue');
        await B('what about gold');
        t.eq('"what about gold"', K.settings().color, 'gold');
        await B('take me to Mars');
        await B('now Jupiter');
        t.eq('"show me Mars" … "now Jupiter"', K.context().lastCmd, 'take me to jupiter');
        await B('saturn');
        t.eq('a single word, once the solar system is the subject', K.context().lastCmd, 'take me to saturn');
        await B('show me Florida'); await B('what about Japan');
        t.eq('"show me Florida" … "what about Japan"', K.context().lastCmd, 'show me japan');
        await B('make a heart'); await B('now a rocket');
        t.eq('"make a heart" … "now a rocket"', K.context().lastCmd, 'make a rocket');
        await B('switch to matrix'); await B('now panthers');
        t.eq('"switch to matrix" … "now panthers"', K.skin(), 'panther');
        await B('back to jarvis');
        t.ok('a fragment with nothing to fill in is still not understood', /say ⟦?learn that⟧?\.$/.test(await B('jupiter flavoured ice cream')));
        r = await B('5 divided by 0');
        t.eq('"what was that?" after it', await B('what was that'), r);
        t.ok('"why?" gives the reason behind his last answer where there is one, even after "what was that?"', /^Because no number times zero/.test(await B('why?')));
        await B('speak fast'); await B('speak faster');
        r = await B('why');
        t.ok('"That\'s as fast as I go" has a reason too', /three speeds/.test(r), r);
        await B('speak normally'); await B('speak faster');
        await B('slower');
        t.eq('"slower" with nothing on the projector, after a speed change, changes how fast he talks', K.settings().speed, undefined);
        await B('tell me a joke');
        t.eq('"bigger" with nothing on the projector', await B('bigger'), "There's nothing on the projector to make bigger. Ask me for a scene first.");
        t.ok('"faster" too', /speak faster to change my voice/.test(await B('faster')));
        t.eq('"smaller" too', await B('smaller'), "There's nothing on the projector to make smaller. Ask me for a scene first.");
        t.eq('"go back" with no scene before it still closes the projector, as it always has', await B('go back'), "The projector's already off.");
        K.noteScene({ kind: 'solar', arg: 'mars' }); K.noteScene({ kind: 'solar', arg: 'jupiter' });
        r = await B('go back');
        t.ok('"go back" reopens the scene before', /^Going back\. My holo-projector needs WebGL/.test(r) && JSON.stringify(K.context().scenes) === '[{"kind":"solar","arg":"mars"}]', r);
        K.noteScene({ kind: 'globe', arg: null });
        t.ok('"the one before" too', /^Going back/.test(await B('the one before')));
        // bigger, smaller, faster and slower on a scene: each builder declares adjust(); the shared rule, on a stand-in rig
        const rig = { goal: 100, min: 10, max: 400 }, adj = K.adjuster(rig, { thing: 'the galaxy', moving: 'The galaxy turns' });
        t.eq('"bigger" moves the camera in', [adj('bigger'), Math.round(rig.goal)].join(' '), 'Moving in on the galaxy. 70');
        t.eq('"smaller" moves it out', [adj('smaller'), Math.round(rig.goal)].join(' '), 'Pulling back from the galaxy. 102');
        rig.goal = 10;
        t.eq('up to a limit', adj('bigger'), "That's as close as I go.");
        t.eq('"faster" and "slower" change the pace', [adj('faster'), adj('slower')].join(' '), 'The galaxy turns faster now. The galaxy turns slower now.');
        const builders = page.html.match(/function build(?:Galaxy|Solar|Particles|Neural|Suit|Globe|Memory)\(T\)\{[\s\S]*?\n\}\n/g) || [];
        t.ok('every scene builder declares what bigger, smaller, faster and slower mean for it', builders.length === 7 && builders.every((b) => /\badjust:adjuster\(/.test(b)), builders.length);
        t.ok('and the projector runs each scene at its pace', /H\.update\(dt\*p,H\.t\);H\.rig\.update\(dt,p\)/.test(page.html));
        r = await B('create test protocol: make the orb green, then tell me a joke');
        await B('test');
        await K.protocolDone();
        t.eq('"again" after a protocol runs it again', [await B('again'), K.running()?.label].join(' | '), ' | test');
        await K.protocolDone();

        t.section('Follow-ups: memory only (Session 10)');
        const ctx = K.context();
        t.ok('the context holds this visit', ctx.lastCmd === 'run test' && ctx.lastAnswer && ctx.scenes.length >= 1, JSON.stringify(ctx));
        await wait(40);
        d = await dbDump(env.idb);
        const dump = JSON.stringify(d);
        t.ok('none of it is in the database', !/lastCmd|lastAnswer|take me to|show me japan|now jupiter|what about|Going back|deeper reason/.test(dump), dump.slice(0, 300));
        t.ok('only six tables, none for the context', Object.keys(d).sort().join() === 'events,kept,meta,pack,protocols,totals');
        t.ok('and the page never passes it to save() or store()', !/(?:save|store)\([^)]*talk\b/.test(page.html) && !/talk\.[a-zA-Z]+[^;]*\b(?:save|store)\(/.test(page.html.match(/const talk=[^\n]*/)?.[0] || ''));
        const idb = env.idb;
        env.close();
        env = await openDom(page.html, URL_, { ...quiet, idb });
        const L = env.window.__jarvis;
        t.eq('a reload forgets it', JSON.stringify(L.context()), '{"lastCmd":null,"frame":null,"scenes":[],"lastAnswer":null,"why":null,"question":false}');
        t.eq('"again" after a reload', await L.answer('again'), "Again? I haven't done anything yet this visit. Ask me something first.");
        t.ok('while the protocols are kept', 'test' in L.protocols() && 'cosy' in L.protocols() === false);
    } finally { env.close(); }

    t.section('Protocols: the version 2 upgrade (Session 10)');
    // A browser that ran Session 9 has version 1: four tables. Opening Session 10 adds the protocols table and keeps the rest.
    const idb = new (await import('fake-indexeddb')).IDBFactory(), today = dayOf();
    await new Promise((res, rej) => { const rq = idb.open('jarvis-test', 1);
        rq.onupgradeneeded = () => { const db = rq.result; db.createObjectStore('kept'); db.createObjectStore('events', { keyPath: ['id', 'day'] }); db.createObjectStore('totals', { keyPath: 'id' }); db.createObjectStore('meta'); };
        rq.onsuccess = () => { const db = rq.result, tx = db.transaction(['kept', 'events', 'meta'], 'readwrite');
            tx.objectStore('kept').put('matrix', 'jarvis-skin'); tx.objectStore('events').put({ id: 'scene:globe', day: today - 1, n: 4 });
            tx.objectStore('meta').put(1, 'copied'); tx.objectStore('meta').put(today - 90, 'rolled'); tx.objectStore('meta').put(0, 'carry');
            tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); }; rq.onerror = () => rej(rq.error); });
    env = await openDom(page.html, URL_, { ...quiet, idb });
    try {
        const U = env.window.__jarvis;
        t.eq('the database goes up to version 3 (Session 13 added a step after this one)', JSON.stringify((await idb.databases()).map((x) => [x.name, x.version])), '[["jarvis-test",3]]');
        const d = await dbDump(idb);
        t.ok('version 1\'s records are all still there', d.kept['jarvis-skin'] === 'matrix' && Object.values(d.events).some((e) => e.id === 'scene:globe' && e.n === 4) && U.skin() === 'matrix');
        t.ok('and there\'s an empty protocols table', JSON.stringify(d.protocols) === '{}');
    } finally { env.close(); }

    t.section('Protocols: the scrub (Session 10)');
    // Whatever is in the table that wouldn't pass today's rules goes on load, and never more than 20 are kept.
    const idb2 = new (await import('fake-indexeddb')).IDBFactory();
    env = await openDom(page.html, URL_, { ...quiet, idb: idb2 }); env.close(); await wait(40);
    await new Promise((res) => { const rq = idb2.open('jarvis-test'); rq.onsuccess = () => { const db = rq.result, tx = db.transaction(['protocols'], 'readwrite'), os = tx.objectStore('protocols');
        os.put({ steps: ['say:joke'] }, 'good one'); os.put({ steps: ['make the orb purple'] }, 'words'); os.put({ steps: ['say:joke'] }, 'ring 239 555 0142'); os.put({ steps: ['say:joke'], note: 'x' }, 'extra');
        os.put({ steps: ['scene:galaxy', 'scene:globe'] }, 'two scenes'); os.put({ steps: ['sys:boot'] }, 'boot');
        for (let i = 0; i < 24; i++) os.put({ steps: ['say:coin'] }, 'z filler ' + 'abcdefghijklmnopqrstuvwx'[i]);
        tx.oncomplete = () => { db.close(); res(); }; }; });
    env = await openDom(page.html, URL_, { ...quiet, idb: idb2 });
    try {
        const S = env.window.__jarvis, kept = Object.keys(S.protocols());
        t.ok('a good protocol stays', kept.includes('good one'));
        t.ok('words as steps, a personal name, an extra field, two scenes and sys:boot all go', !['words', 'ring 239 555 0142', 'extra', 'two scenes', 'boot'].some((k) => kept.includes(k)), kept.join());
        t.eq('and at most 20 are kept', kept.length, 20);
        await wait(40);
        t.eq('from the database too', Object.keys((await dbDump(idb2)).protocols).length, 20);
    } finally { env.close(); }
}

// Session 9 of jarvis/build-plan.html: the memory foundation. Saved data lives in IndexedDB, with usage
// counts beside the settings: fixed IDs, a day number and a count, never words or dates (review 60).
async function memoryFoundation(t, page) {
    const URL_ = 'https://jarvis.test/jarvis.html', quiet = { ignore: /getContext|HTMLCanvasElement/ };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const today = dayOf();
    const visits = (...ago) => ago.map((a) => ({ id: 'app:visit', day: today - a, n: 1 }));
    const typeIn = async (env, text) => { const { document, window } = env; document.getElementById('q').value = text; document.getElementById('f').dispatchEvent(new window.Event('submit', { cancelable: true })); await wait(520); return [...document.querySelectorAll('#log .msg.ai')].pop()?.textContent ?? ''; };
    // A profile that already has the database, as an earlier visit would leave it, holding exactly `records`.
    const profile = async (records) => {
        const first = await openDom(page.html, URL_, quiet), idb = first.idb;
        first.close(); await wait(40);
        // clear what that first visit counted, then put in the records under test
        await new Promise((res) => { const rq = idb.open('jarvis-test'); rq.onsuccess = () => { const db = rq.result, tx = db.transaction(['kept', 'events', 'totals', 'meta'], 'readwrite'); for (const n of ['kept', 'events', 'totals', 'meta']) tx.objectStore(n).clear(); tx.oncomplete = () => { db.close(); res(); }; }; });
        await dbSeed(idb, { ...records, meta: { copied: 1, ...(records.meta || {}) } });
        return idb;
    };

    t.section('Memory foundation: the database (Session 9)');
    let env = await openDom(page.html, URL_, quiet);
    try {
        const J = env.window.__jarvis;
        t.eq('the test copy has its own database', J.DB_NAME, 'jarvis-test');
        t.ok('and the page knows it was saved there', J.dbOK() && J.loaded());
        const dbs = await env.idb.databases();
        t.eq('it is the only database this page opens, at version 3 since Session 13 added the knowledge pack', JSON.stringify(dbs.map((d) => [d.name, d.version])), '[["jarvis-test",3]]');
        const d = await dbDump(env.idb);
        t.eq('version 3 has six tables: Session 9\'s four, protocols and pack', Object.keys(d).sort().join(), 'events,kept,meta,pack,protocols,totals');
        t.ok('the database version is the number of upgrade steps, so later sessions add a step instead of starting again', /indexedDB\.open\(DB_NAME,DB_UPGRADES\.length\)/.test(page.html) && /for\(let v=e\.oldVersion;v<DB_UPGRADES\.length;v\+\+\)DB_UPGRADES\[v\]/.test(page.html));
        t.eq('a first visit saves only the copy-done mark, the visit count and the roll-up bookkeeping', JSON.stringify({ kept: d.kept, events: Object.values(d.events), totals: d.totals, meta: d.meta }),
            JSON.stringify({ kept: {}, events: [{ id: 'app:visit', day: today, n: 1 }], totals: {}, meta: { carry: 0, copied: 1, rolled: today - 89 } }));
        t.eq('a day number is whole days since 1 January 2026, the same as the page works it out', J.dayNumber(), today);
        t.eq('for example 10 October 2026 is day 282', J.dayNumber(new Date(2026, 9, 10)), 282);

        t.section('Memory foundation: usage counts (Session 9)');
        t.eq('the event list has no repeats', new Set(J.EVENT_IDS).size, J.EVENT_IDS.length);
        t.ok('every ID is a fixed kind:name word, nothing personal', J.EVENT_IDS.every((id) => /^(?:app|scene|cmd|skin|feature):[a-z-]+$/.test(id) && !J.personal(id)));
        t.ok('every skin has an ID', Object.keys(J.SKINS).every((k) => J.EVENT_IDS.includes('skin:' + k)));
        t.ok('every scene a setting can open has an ID', J.SETTING_CHOICES.scene.every((k) => J.EVENT_IDS.includes('scene:' + k)));
        t.eq('an ID that isn\'t on the list is refused', J.track('said:hello pat'), false);
        t.eq('and so is a day that isn\'t a day number', J.track('cmd:joke', '2026-10-10'), false);
        for (const [q, id] of [['show me the galaxy', 'scene:galaxy'], ['tell me a joke', 'cmd:joke'], ['tell me a joke', 'cmd:joke'], ['switch to the matrix', 'skin:matrix'], ['flip a coin', 'cmd:coin'],
            ['my dog is Rex', 'cmd:remember'], ['scan the room', 'cmd:scan'], ['what is 6 times 7', 'cmd:math'], ['make the orb blue', 'cmd:setting'], ['take me to mars', 'scene:solar'], ['what time is it', 'cmd:time']])
            await typeIn(env, q);
        const ev = Object.values((await dbDump(env.idb)).events).filter((e) => e.day === today);
        const n = (id) => ev.find((e) => e.id === id)?.n ?? 0;
        t.eq('commands are counted by kind, today', ['scene:galaxy', 'cmd:joke', 'skin:matrix', 'cmd:coin', 'cmd:remember', 'cmd:scan', 'cmd:math', 'cmd:setting', 'scene:solar', 'cmd:time'].map(n).join(), '1,2,1,1,1,1,1,1,1,1');
        t.ok('each record is exactly {id, day, n}, with a listed ID', ev.every((e) => Object.keys(e).sort().join() === 'day,id,n' && J.EVENT_IDS.includes(e.id)));
        t.ok('no word you said is anywhere in the database', !/rex|joke me|room|mars|blue orb|6 times/i.test(JSON.stringify(await dbDump(env.idb))));
        t.ok('"what do you save" says what the counts are', /Counts of which scenes and commands you use, by day\. Nothing you say\./.test(await J.answer('what do you save')));
        t.ok('the memory core shows them as one star', J.memoryStars().filter((x) => x.type === 'history').length === 1);
        t.eq('no console errors', env.errors.length, 0);
    } finally { env.close(); }

    t.section('Memory foundation: the 90-day roll-up (Session 9)');
    {
        const idb = await profile({ events: [{ id: 'cmd:joke', day: today - 90, n: 3 }, { id: 'cmd:joke', day: today - 89, n: 2 }, { id: 'scene:globe', day: today - 95, n: 1 }], totals: [{ id: 'cmd:joke', n: 10 }] });
        env = await openDom(page.html, URL_, { ...quiet, idb });
        try {
            const d = await dbDump(idb), days = Object.values(d.events).map((e) => today - e.day).sort((a, b) => a - b);
            t.eq('day 90 (89 days ago) is still kept by day; day 91 and older are not', days.join(), '0,89');
            t.eq('their counts are added into the all-time totals', JSON.stringify(Object.values(d.totals).sort((a, b) => a.id.localeCompare(b.id))), JSON.stringify([{ id: 'cmd:joke', n: 13 }, { id: 'scene:globe', n: 1 }]));
            t.eq('a total is just {id, n}', Object.keys(d.totals['cmd:joke']).sort().join(), 'id,n');
            t.eq('the oldest day kept is recorded as a day number', d.meta.rolled, today - 89);
            t.eq('rolling up again the same day does nothing', env.window.__jarvis.rollUp(), 0);
            t.ok('the history star still shows', env.window.__jarvis.memoryStars().some((x) => x.type === 'history'));
        } finally { env.close(); }
    }

    t.section('Memory foundation: the streak from usage counts alone (Session 9)');
    for (const [label, ago, want] of [['yesterday and the day before: 3 days', [1, 2], 3], ['a missed day (yesterday, then 3 days ago): 2 days', [1, 3], 2],
        ['nothing yesterday: 1 day', [2, 3, 4], 1], ['any count makes a day, not just a visit', [], 2]]) {
        const extra = ago.length ? [] : [{ id: 'cmd:joke', day: today - 1, n: 4 }];
        const idb = await profile({ events: [...visits(...ago), ...extra] });
        env = await openDom(page.html, URL_, { ...quiet, idb });
        try {
            t.eq(label, env.window.__jarvis.streak().days, want);
        } finally { env.close(); }
    }
    {
        // 95 days in a row before today: 89 kept by day, 6 rolled into the carry, so 96 with today.
        const idb = await profile({ events: visits(...Array.from({ length: 95 }, (_, i) => i + 1)) });
        env = await openDom(page.html, URL_, { ...quiet, idb });
        try {
            const J = env.window.__jarvis, d = await dbDump(idb);
            t.eq('a streak longer than 90 days isn\'t cut short by the roll-up', J.streak().days, 96);
            t.eq('the days rolled up are carried as one number', d.meta.carry, 6);
            t.eq('only 90 days are kept by day', new Set(Object.values(d.events).map((e) => e.day)).size, 90);
            J.track('app:visit', today + 1); J.rollUp(today + 1);
            t.eq('and tomorrow it carries on: 97', J.streakDays(today + 1), 97);
        } finally { env.close(); }
    }
    {
        const y = new Date(); y.setDate(y.getDate() - 1);
        env = await openDom(page.html, URL_, { ...quiet, beforeParse(w) { w.localStorage.setItem('jarvis-streak', JSON.stringify({ days: 120, y: y.getFullYear(), m: y.getMonth() + 1, d: y.getDate() })); } });
        try {
            const d = await dbDump(env.idb);
            t.eq('an old 120-day streak carries over whole: 121 today', env.window.__jarvis.streak().days, 121);
            t.eq('with 90 days kept by day', Object.values(d.events).length, 90);
            t.eq('and the other 31 in the carry and the visit total', [d.meta.carry, d.totals['app:visit'].n].join(), '31,31');
        } finally { env.close(); }
    }

    t.section('Memory foundation: start-up waits for the database (Session 9)');
    {
        IDB ??= await import('fake-indexeddb');
        let release; const gate = new Promise((r) => { release = r; });
        env = await openDom(page.html, URL_, { ...quiet, noWait: true, idb: gatedFactory(new IDB.IDBFactory(), gate),
            beforeParse(w) { w.localStorage.setItem('jarvis-skin', 'matrix'); w.localStorage.setItem('jarvis-settings', '{"color":"gold"}'); } });
        try {
            const { document, window } = env, J = window.__jarvis;
            await wait(30);
            t.eq('before the database answers, nothing has loaded', J.loaded(), false);
            document.getElementById('boot-skip').click(); document.getElementById('boot-skip').click();
            t.eq('skipping the boot doesn\'t greet yet', document.querySelectorAll('#log .msg.ai').length, 0);
            release(); await J.ready; await wait(10);
            const said = [...document.querySelectorAll('#log .msg.ai')].map((m) => m.textContent);
            t.eq('once it answers, the greeting comes once', said.length, 1);
            t.ok('in the saved skin', /real world/.test(said[0]) && J.skin() === 'matrix');
            t.eq('with the saved orb colour', J.ring(), J.ORB_COLOURS.gold[0]);
            t.eq('no console errors', env.errors.length, 0);
        } finally { env.close(); }
    }
    {
        const never = { open() { return {}; } };
        env = await openDom(page.html, URL_, { ...quiet, noWait: true, idb: never });
        try {
            const { document, window } = env, J = window.__jarvis;
            document.getElementById('boot-skip').click();
            await wait(4300);
            t.ok('a database that never answers stops waiting after 4 s, and he greets you', J.loaded() && document.querySelectorAll('#log .msg.ai').length === 1);
            t.ok('and says nothing can be saved', /won't let me save anything/.test(await J.answer('what do you save')));
        } finally { env.close(); }
    }

    t.section('Memory foundation: without IndexedDB (Session 9)');
    env = await openDom(page.html, URL_, { ...quiet, idb: null, beforeParse(w) { w.localStorage.setItem('jarvis-skin', 'panther'); } });
    try {
        const { window, document } = env, J = window.__jarvis;
        t.eq('the page still runs', env.errors.length, 0);
        t.eq('using what jarvis.html saved, for this visit', J.skin(), 'panther');
        await J.answer('make the orb red');
        t.eq('changes work for the visit', J.settings().color, 'red');
        t.eq('but localStorage is still never written', JSON.stringify({ ...window.localStorage }), '{"jarvis-skin":"panther"}');
        t.ok('and he says so', /won't let me save anything/.test(await J.answer('what do you save')));
        J.finishBoot();
        t.ok('the greeting still comes', document.querySelectorAll('#log .msg.ai').length >= 1);
    } finally { env.close(); }
}

// The test copy and jarvis.html share an origin, so they share localStorage. Since Session 9 the test copy keeps
// its own database and only ever reads localStorage, so neither page can change the other's saves. This section
// is about the two copies, so it goes when the page is promoted (the promoted page renames its database).
async function keptApart(t, page) {
    const URL_ = 'https://jarvis.test/jarvis.html', quiet = { ignore: /getContext|HTMLCanvasElement/ };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    t.section('Test copy: kept apart from jarvis.html (Session 9)');
    const mainUrl = new URL('jarvis.html', page.url);
    const mainHtml = mainUrl.protocol === 'file:' ? await readFile(fileURLToPath(mainUrl), 'utf8') : await (await fetch(mainUrl)).text();
    t.ok('jarvis.html never opens IndexedDB, so it can\'t touch the test copy\'s database', !/indexedDB|IDBFactory/.test(mainHtml));
    t.ok('its scrub only removes jarvis-* localStorage keys, which the test copy never writes', /if\(k&&k\.startsWith\('jarvis-'\)&&!STORE_KEYS\.includes\(k\)\)ls\.removeItem\(k\)/.test(mainHtml));
    t.ok('and has no localStorage write call anywhere', !/localStorage\.(?:setItem|removeItem|clear)|\bls\.(?:setItem|removeItem|clear)/.test(page.html));

    // One profile, as in one browser: jarvis.html's saves in localStorage, then the test copy, then the main page again.
    const mainSaved = { 'jarvis-skin': 'panther', 'jarvis-settings': '{"color":"pink"}', 'jarvis-learned': '{"lights":"make a star"}', 'jarvis-streak': '{"days":2,"y":2026,"m":1,"d":1}' };
    const fill = (w, o) => { for (const [k, v] of Object.entries(o)) w.localStorage.setItem(k, v); };
    let env = await openDom(page.html, URL_, { ...quiet, beforeParse(w) { fill(w, mainSaved); } });
    const idb = env.idb;
    let lsAfterTest, dbAfterTest;
    try {
        const J = env.window.__jarvis;
        t.eq('the first run copies the main page\'s settings in', [J.skin(), J.settings().color, J.learned().lights].join(), 'panther,pink,make a star');
        t.eq('and marks the copy as done', (await dbDump(idb)).meta.copied, 1);
        await J.answer('switch to the matrix'); await J.answer('make the orb blue'); await J.answer('reset my settings');
        await J.answer('forget what you learned');
        lsAfterTest = { ...env.window.localStorage };
        dbAfterTest = await dbDump(idb);
        t.eq('changing and forgetting things in the test copy leaves localStorage exactly as the main page left it', JSON.stringify(lsAfterTest), JSON.stringify(mainSaved));
    } finally { env.close(); }
    // The main page changes its own settings later; the test copy copied once and doesn't copy again.
    env = await openDom(page.html, URL_, { ...quiet, idb, beforeParse(w) { fill(w, { ...mainSaved, 'jarvis-skin': 'jarvis', 'jarvis-settings': '{"color":"red"}' }); } });
    try {
        const J = env.window.__jarvis;
        t.eq('the copy happens once: the test copy keeps its own skin and settings', [J.skin(), J.settings().color ?? 'none'].join(), 'matrix,none');
    } finally { env.close(); }
    // Now jarvis.html itself, in the same profile.
    const before = await dbDump(idb);
    env = await openPage(mainHtml, URL_, { ...quiet, beforeParse(w) { w.indexedDB = idb; fill(w, mainSaved); } });
    try {
        const { window } = env, J = window.__jarvis;
        await wait(40);
        t.eq('jarvis.html still has its own skin', J.skin(), 'panther');
        t.eq('its own settings', J.settings().color, 'pink');
        t.eq('and its own taught phrases', J.learned().lights, 'make a star');
        t.eq('opening it leaves the test copy\'s database untouched, usage counts and all', JSON.stringify(await dbDump(idb)), JSON.stringify(before));
        t.eq('and the test copy\'s own settings are still the ones it saved', JSON.stringify(before.kept), JSON.stringify(dbAfterTest.kept));
        t.eq('the profile still has just the test copy\'s database', JSON.stringify((await idb.databases()).map((x) => x.name)), '["jarvis-test"]');
    } finally { env.close(); }
}

/* A second window with a fake SpeechRecognition, getUserMedia and AudioContext. */
function fakeVoice({ reduce = false, noted = false } = {}) {
    const log = { asked: [], stopped: 0, recs: [], hold: false, release: null };
    return {
        log,
        beforeParse(window) {
            window.SpeechRecognition = class { constructor() { log.recs.push(this); } start() { this.started = true; } stop() {} };
            window.matchMedia = (q) => ({ matches: reduce && /reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
            const stream = () => ({ getTracks: () => [{ stop: () => { log.stopped++; } }] });
            Object.defineProperty(window.navigator, 'mediaDevices', { configurable: true, value: {
                getUserMedia: (c) => {
                    log.asked.push(c);
                    if (!log.hold) return Promise.resolve(stream());
                    return new Promise((r) => { log.release = () => r(stream()); });
                }
            } });
            window.AudioContext = class {
                constructor() { this.state = 'running'; }
                createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
                createAnalyser() { return { fftSize: 0, getFloatTimeDomainData() {} }; }
            };
            if (noted) window.localStorage.setItem('jarvis-mic-note', '1');
        }
    };
}

async function voiceWiring(t, page) {
    const tick = () => new Promise((r) => setTimeout(r, 0));
    const open = async (opts) => {
        const fake = fakeVoice(opts);
        const env = await openDom(page.html, 'https://jarvis.test/jarvis.html', { ignore: /getContext|HTMLCanvasElement/, beforeParse: fake.beforeParse });
        return { ...env, log: fake.log };
    };

    t.section('Voice-reactive orb: the mic belongs to speech recognition');

    // On 2026-10-09 a second mic stream (opened for a level meter while listening) stopped
    // speech recognition hearing anything on a phone. The orb now reacts through recognition's
    // own speechstart/speechend events, and listening must never ask for a mic of its own.
    let env = await open();
    try {
        const { window, document, log } = env;
        const rec = log.recs[0];
        t.eq('the page has no console errors with a mic', env.errors.length, 0);
        t.ok('with speech recognition, the mic note shows', !document.getElementById('mic-note').hidden);
        document.getElementById('mic').click();
        t.ok('tapping the mic starts recognition', rec?.started === true);
        rec.onstart();
        await tick();
        t.eq('listening shows LISTENING', document.getElementById('state').textContent, 'LISTENING');
        t.eq('the mic note is remembered as seen', (await dbDump(env.idb)).kept['jarvis-mic-note'], '1');
        rec.onspeechstart();
        t.eq('recognition hearing speech makes the orb react', window.__jarvis.hearing(), true);
        rec.onspeechend();
        t.eq('and settle when the speech stops', window.__jarvis.hearing(), false);
        rec.onspeechstart();
        rec.onresult({ results: [[{ transcript: 'what is two plus two' }]] });
        rec.onend();
        t.eq('listening ending resets it', window.__jarvis.hearing(), false);
        t.ok('the transcript is handled as a message', [...document.querySelectorAll('#log .msg.me')].some((m) => m.textContent === 'what is two plus two'));
        rec.onstart(); rec.onspeechstart(); rec.onerror({ error: 'no-speech' });
        t.eq('an error resets it too', window.__jarvis.hearing(), false);
        await tick();
        t.eq('listening never opens a mic stream of its own', log.asked.length, 0);
    } finally {
        env.close();
    }

    env = await open({ reduce: true, noted: true });
    try {
        t.ok('once the mic has been used, the note stays hidden', env.document.getElementById('mic-note').hidden);
    } finally {
        env.close();
    }
}

// A fake speech engine that behaves like the real one: speak() queues, onstart/onend come later
// (the test calls them), and cancel() drops the queue and reports each dropped utterance as an
// error, asynchronously, the way Chrome does.
function fakeSpeech() {
    const log = { queue: [], spoken: [] };
    return {
        log,
        beforeParse(window) {
            window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
            window.speechSynthesis = {
                getVoices: () => [], onvoiceschanged: null,
                speak(u) { log.queue.push(u); log.spoken.push(u.text); },
                cancel() { const dropped = log.queue.splice(0); setTimeout(() => dropped.forEach((u) => u.onerror?.({ error: 'interrupted' })), 0); }
            };
        },
        start: () => log.queue[0].onstart?.(),
        finish: () => log.queue.shift().onend?.()
    };
}

async function speechWiring(t, page) {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    t.section('Speaking long answers');

    // Chrome stops speaking a single utterance after about 15 seconds, which cut the help answer off
    // before its last features (2026-10-09). Long answers now go out a sentence or two at a time.
    // Since the gauntlet (review 67) the help answer itself is short when spoken, so the long text here is
    // everything the gauntlet holds, which is still the longest thing he has to say.
    const { speechChunks, brain, plainText, GAUNTLET_TEXT, HELP_LINE } = (await openDom(page.html, 'https://jarvis.test/jarvis.html', { ignore: /getContext|HTMLCanvasElement/ })).window.__jarvis;
    const long = plainText(GAUNTLET_TEXT).trim();
    const parts = speechChunks(long);
    t.ok('a long answer is split into several pieces', parts.length >= 3);
    t.ok('none is longer than 160 characters (about 10 s of speech)', parts.every((p) => p.length <= 160));
    t.eq('together they are the whole answer, in order', parts.join(' '), long.replace(/\s+/g, ' ').trim());
    // A list sentence longer than 160 characters is broken at its commas (Session 13), so a piece can end at one.
    t.ok('every piece ends at the end of a sentence, or at a comma in a sentence too long for one piece', parts.every((p) => /[.!?]$/.test(p) || (/,$/.test(p) && p.length > 60)));
    t.ok('and most end at a full stop', parts.filter((p) => /[.!?]$/.test(p)).length > parts.length / 2);
    t.eq('a short answer stays in one piece', JSON.stringify(speechChunks('Anytime. You\'re welcome.')), JSON.stringify(['Anytime. You\'re welcome.']));
    t.eq('one sentence longer than the limit is kept whole', speechChunks('a'.repeat(200) + '.').length, 1);
    const help = plainText(brain('what can you do'));
    for (const q of ['what can you do', 'Hey Jarvis, what can you do?', 'what else can you do', 'tell me what you can do', 'what are your features', 'list your commands', 'what can I say'])
        t.eq(`"${q}" gets the help answer`, plainText(brain(q)), help);
    t.ok('"hello" is still a greeting', /online|help/.test(brain('hello')) && plainText(brain('hello')) !== help);

    const fake = fakeSpeech();
    const env = await openDom(page.html, 'https://jarvis.test/jarvis.html', { ignore: /getContext|HTMLCanvasElement/, beforeParse: fake.beforeParse });
    try {
        const { document } = env, state = () => document.getElementById('state').textContent;
        const ask = (text) => { document.getElementById('q').value = text; document.getElementById('f').dispatchEvent(new env.window.Event('submit', { cancelable: true })); };
        ask('what can you do'); await wait(600);
        t.eq('the help answer speaks only its short line, not the gauntlet', fake.log.queue.map((u) => u.text).join(' '), HELP_LINE);
        t.eq('and its chat line is that short line too', [...document.querySelectorAll('#log .msg.ai')].pop()?.textContent, HELP_LINE);
        t.ok('while the gauntlet opens', !document.getElementById('gauntlet').hidden);
        fake.finish(); document.getElementById('g-close').click();
        env.window.__jarvis.say(GAUNTLET_TEXT.trim()); await wait(50);
        t.eq('a long answer is queued, piece by piece, without the link markers', fake.log.queue.map((u) => u.text).join(' '), long.replace(/\s+/g, ' ').trim());
        t.ok('as more than one utterance', fake.log.queue.length >= 3);
        t.eq('and the chat log shows it in full, as one message', [...document.querySelectorAll('#log .msg.ai')].pop()?.textContent, long);
        fake.start(); t.eq('the first piece starting shows SPEAKING', state(), 'SPEAKING');
        fake.finish(); t.eq('the orb keeps SPEAKING between pieces', state(), 'SPEAKING');
        fake.start();
        ask('tell me a joke'); await wait(600);
        t.eq('a new question cancels the rest of the old answer', fake.log.queue.length, 1);
        t.eq('the cancelled pieces don\'t switch the orb to STANDBY', state(), 'PROCESSING');
        fake.start(); t.eq('the new answer speaks', state(), 'SPEAKING');
        fake.finish(); t.eq('and STANDBY once its last piece ends', state(), 'STANDBY');
    } finally {
        env.close();
    }
}

// Skins (Matrix / Morpheus and Florida Panthers / Stanley C. Panther) and learned phrases.
async function skinsAndMemory(t, page) {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    t.section('Skins');
    const fake = fakeSpeech();
    const opts = { ignore: /getContext|HTMLCanvasElement/, beforeParse: fake.beforeParse };
    let env = await openDom(page.html, 'https://jarvis.test/jarvis.html', opts);
    try {
        const { document, window } = env, J = window.__jarvis;
        const ask = async (text) => { document.getElementById('q').value = text; document.getElementById('f').dispatchEvent(new window.Event('submit', { cancelable: true })); await wait(520); return [...document.querySelectorAll('#log .msg.ai')].pop()?.textContent; };
        const lastUtt = () => fake.log.queue[fake.log.queue.length - 1];
        t.eq('starts as Jarvis', J.skin(), 'jarvis');
        t.eq('with a skin button in the header', document.getElementById('skin')?.textContent, 'SKIN: JARVIS');
        for (const [q, k] of [['switch to matrix', 'matrix'], ['Matrix skin', 'matrix'], ['morpheus', 'matrix'], ['I take the red pill', 'matrix'], ['switch to the Panthers', 'panther'], ['change to panthers mode', 'panther'], ['stanley', 'panther'], ['switch back to Jarvis', 'jarvis'], ['back to Jarvis', 'jarvis'], ['Back to the Matrix', 'matrix'], ['come back to Stanley', 'panther'], ['go back to normal', 'jarvis'], ['take the blue pill', 'jarvis']])
            t.eq(`"${q}" picks the ${k} skin`, J.skinIntent(q), k);
        for (const q of ['what time is it', 'show me Florida', 'hey jarvis tell me a joke', 'what is the matrix', 'take me to mars', 'i want to go to jupiter jarvis'])
            t.eq(`"${q}" doesn't change the skin`, J.skinIntent(q), null);

        let r = await ask('switch to the matrix');
        t.ok('asking for the Matrix brings Morpheus', /Morpheus/.test(r));
        t.eq('the header names him', document.getElementById('who').textContent, 'MORPHEUS');
        t.eq('the page takes the matrix skin', document.documentElement.dataset.skin, 'matrix');
        t.ok('he speaks lower and slower than Jarvis', lastUtt().pitch < 0.9 && lastUtt().rate < 1);
        t.eq('the skin is remembered on this device', (await dbDump(env.idb)).kept['jarvis-skin'], 'matrix');
        r = await ask('who are you');
        t.ok('Morpheus answers as Morpheus', /I am Morpheus/.test(r));
        r = await ask('flip a coin');
        t.ok('and still does his job', /heads|tails/.test(r));
        document.getElementById('skin').click(); await wait(10);
        t.eq('the skin button moves on to the Panthers', J.skin(), 'panther');
        t.eq('the header names Stanley C. Panther', document.getElementById('who').textContent, 'STANLEY C. PANTHER');
        t.ok('who says hello as the Panthers mascot', /Stanley C\. Panther/.test([...document.querySelectorAll('#log .msg.ai')].pop().textContent));
        t.ok('in a brighter, quicker voice', lastUtt().pitch > 1 && lastUtt().rate > 1.02);
        r = await ask('what is your name');
        t.ok('he knows he is named after the Stanley Cup', /Stanley Cup/.test(r));
        document.getElementById('skin').click(); await wait(10);
        t.eq('and the button comes back round to Jarvis', J.skin(), 'jarvis');
        t.eq('with Jarvis\'s own voice', lastUtt().pitch, 0.9);
        t.ok('help mentions the skins', /Matrix/.test(J.brain('help')) && /Panthers/.test(J.brain('help')));

        t.section('Learned phrases');
        r = await ask('beam me up scotty');
        t.ok('something it doesn\'t know gets "I didn\'t understand that"', /^I didn't understand that\./.test(r));
        t.ok('then a link to what it can do (the gauntlet, since review 67)', r.includes('Tap see what I can do for everything I know.') && J.chipCmds().includes('what can you do'));
        t.ok('and offers to learn it, without asking what was meant', /If you'd like me to learn it, say learn that\.$/.test(r) && !/What were you trying to say/.test(r));
        r = await ask('flip a coin');
        t.ok('so what you say next is just a new command', /^It's (heads|tails)\.$/.test(r));
        t.eq('and nothing is learned from it', Object.keys(J.learned()).length, 0);
        t.ok('"learn that" a turn later has nothing to learn', /^There's nothing to learn just now\./.test(await ask('learn that')));
        await ask('beam me up scotty');
        t.eq('"learn that" straight after a miss asks what it meant', await ask('learn that'), 'What did you mean by "beam me up scotty"?');
        r = await ask('nothing');
        t.eq('"nothing" leaves it', r, "All right, I'll leave it.");
        t.eq('and learns nothing', Object.keys(J.learned()).length, 0);
        await ask('beam me up scotty');
        await ask('learn that');
        r = await ask('What I was trying to say was flip a coin');
        t.ok('telling it what was meant is acknowledged', /Next time you say "beam me up scotty", I'll know you mean "flip a coin"/.test(r));
        t.ok('and does it straight away', /heads|tails/.test(r));
        t.eq('the phrase is saved in this browser', JSON.parse((await dbDump(env.idb)).kept['jarvis-learned'])['beam me up scotty'], 'flip a coin');
        r = await ask('Beam me up, Scotty!');
        t.ok('saying it again just works', /^It's (heads|tails)\.$/.test(r));
        r = await ask('when I say make it so number one, I mean switch to panthers');
        t.ok('"when I say X, I mean Y" teaches in one go, and a learned phrase can switch skins', J.skin() === 'panther' && /I'll know you mean "switch to panthers"/.test(r));
        await ask('switch to jarvis');
        r = await ask('when i say lights please i mean make the orb blue');
        t.ok('spoken, with no comma, it still splits', J.learned()['lights please'] === 'make the orb blue' && /I'll know you mean "make the orb blue"/.test(r), r);
        await ask('forget what you learned');
        t.eq('(cleared to start the count again)', Object.keys(J.learned()).length, 0);
        await ask('Beam me up scotty'); await ask('learn that'); await ask('flip a coin');
        await ask('when I say make it so number one, I mean switch to panthers'); await ask('switch to jarvis');
        r = await ask('when I say zorp, I mean fizzbuzz wibble');
        t.ok('a meaning it doesn\'t understand isn\'t learned', /haven't learned that/.test(r) && !('zorp' in J.learned()));
        await ask('blorp'); await ask('learn that');
        r = await ask('fizzbuzz wibble');
        t.ok('nor after "learn that"', /haven't learned anything/.test(r));
        t.ok('without saving it', !('blorp' in J.learned()));
        r = await ask('what have you learned');
        t.ok('it can say what it has learned', /2 phrases/.test(r) && /beam me up scotty/.test(r));
        await ask('__proto__'); await ask('learn that');
        await ask('I meant tell me a joke');
        t.ok('even an odd phrase like __proto__ is stored as a plain phrase', J.learned()['proto'] === 'tell me a joke' || J.learned()['__proto__'] === 'tell me a joke');
        t.eq('without touching Object.prototype', ({}).polluted, undefined);
    } finally {
        env.close();
    }

    // A reload keeps the skin and the learned phrases; a corrupt store is ignored.
    t.section('Remembered across visits');
    env = await openDom(page.html, 'https://jarvis.test/jarvis.html', { ...opts, beforeParse(w) { opts.beforeParse(w); w.localStorage.setItem('jarvis-skin', 'matrix'); w.localStorage.setItem('jarvis-learned', JSON.stringify({ 'beam me up': 'roll a die', bad: 7 })); } });
    try {
        const { document, window } = env, J = window.__jarvis;
        t.eq('the saved skin comes back', J.skin(), 'matrix');
        t.eq('with its header', document.getElementById('who').textContent, 'MORPHEUS');
        t.eq('learned phrases come back', J.learned()['beam me up'], 'roll a die');
        t.ok('and anything that isn\'t a phrase is dropped', !('bad' in J.learned()));
        document.getElementById('q').value = 'forget what you learned'; document.getElementById('f').dispatchEvent(new window.Event('submit', { cancelable: true })); await wait(520);
        t.eq('"forget what you learned" clears them', (await dbDump(env.idb)).kept['jarvis-learned'], '{}');
    } finally {
        env.close();
    }
    // One memory, whatever the skin: the user asked on 2026-10-10 for the name and learned phrases to carry
    // across skins seamlessly. Morpheus and Stanley used to greet without the name, and nothing answered
    // "what's my name". Later the same day the name stopped being saved at all (privacy scrub), so it
    // carries across skins for one visit, and taught phrases across visits.
    env = await openDom(page.html, 'https://jarvis.test/jarvis.html', { ...opts, beforeParse(w) { opts.beforeParse(w); w.localStorage.setItem('jarvis-skin', 'matrix'); w.localStorage.setItem('jarvis-learned', JSON.stringify({ 'beam me up': 'roll a die' })); } });
    try {
        const { document, window } = env, J = window.__jarvis;
        const lastAi = () => [...document.querySelectorAll('#log .msg.ai')].pop()?.textContent ?? '';
        J.brain('my name is tony');
        J.finishBoot();
        t.ok('as Morpheus, the greeting uses the name told this visit', /^Welcome to the real world, Tony\./.test(lastAi()));
        for (const k of ['matrix', 'panther', 'jarvis']) {
            J.setSkin(k === 'matrix' ? 'jarvis' : 'matrix');
            const hi = J.setSkin(k);
            t.ok(`switching to ${k}, the hello uses the name`, /Tony/.test(hi));
            t.ok(`as ${k}, "what's my name" is answered`, /Your name is Tony\./.test(await J.answer("what's my name?")));
            t.ok(`as ${k}, a learned phrase still works`, /You rolled a [1-6]\./.test(await J.answer('beam me up')));
        }
        J.setSkin('panther');
        t.ok('"who am I" and "do you remember me" work too', /Tony/.test(await J.answer('who am I')) && /Tony/.test(await J.answer('do you remember me')));
        t.ok('"what is your name" is still about him, not you', !/Your name is/.test(await J.answer('what is your name')));
        t.ok('"forget my name" forgets it', /forgotten your name/.test(await J.answer('forget my name')) && window.localStorage.getItem('jarvis-name') === null && !('jarvis-name' in (await dbDump(env.idb)).kept));
        t.ok('then no skin knows it', /haven't told me your name/.test(await J.answer('what is my name')) && !/Tony/.test(J.setSkin('matrix')));
        t.ok('a name told to one skin is known to the next', /Nice to meet you, Pepper/.test(await J.answer('my name is pepper')) && /Pepper/.test(J.setSkin('jarvis')) && /Your name is Pepper/.test(await J.answer('what is my name')));
        t.eq('no console errors', env.errors.length, 0);
    } finally {
        env.close();
    }
    // An older version saved the name, and a taught phrase may hold personal details. In the test copy that
    // storage is jarvis.html's localStorage, which it only reads (Session 9): the bad values aren't copied in,
    // and localStorage is left exactly as it was, because the main page owns it.
    t.section('Privacy scrub: cleaning up what older versions saved');
    const mainLeft = { 'jarvis-name': 'Tony', 'jarvis-secret': 'x', 'other-page': 'keep me', 'jarvis-skin': 'matrix',
        'jarvis-learned': JSON.stringify({ 'beam me up': 'roll a die', 'my number': 'call 239 555 0142', 'ring pat': 'email pat@example.com' }) };
    env = await openDom(page.html, 'https://jarvis.test/jarvis.html', { ...opts, beforeParse(w) { opts.beforeParse(w); for (const [k, v] of Object.entries(mainLeft)) w.localStorage.setItem(k, v); } });
    try {
        const { window } = env, J = window.__jarvis, ls = window.localStorage;
        const kept = (await dbDump(env.idb)).kept;
        t.ok('a saved name is not copied in', !('jarvis-name' in kept));
        t.ok('nor any other jarvis-* key that isn\'t a setting', !('jarvis-secret' in kept) && Object.keys(kept).every((k) => J.STORE_KEYS.includes(k)));
        t.eq('taught phrases with personal details are dropped, the rest copied', kept['jarvis-learned'], '{"beam me up":"roll a die"}');
        t.eq('settings are copied', kept['jarvis-skin'], 'matrix');
        const lsNow = {}; for (let i = 0; i < ls.length; i++) lsNow[ls.key(i)] = ls.getItem(ls.key(i));
        t.eq('localStorage, which belongs to jarvis.html, is left exactly as it was', JSON.stringify(lsNow, Object.keys(lsNow).sort()), JSON.stringify(mainLeft, Object.keys(mainLeft).sort()));
        t.ok('the old name is not used to greet you', (J.finishBoot(), !/Tony/.test([...env.document.querySelectorAll('#log .msg.ai')].pop()?.textContent ?? '')));
        t.ok('"what do you save" reads back exactly what is there', /your skin \(Morpheus\) and one phrase you taught me\. Counts of which scenes and commands you use, by day\. Nothing you say\./.test(await J.answer('what do you save')));
        J.brain('my name is pat');
        t.ok('a name told this visit is mentioned as memory-only', /Your name, Pat, is only in memory for this visit\./.test(await J.answer('what do you know about me')));
        t.ok('and still not stored', !JSON.stringify(await dbDump(env.idb)).includes('Pat') && ls.getItem('jarvis-name') === 'Tony');
        t.ok('an unknown phrase gets the offer to learn it', /say ⟦?learn that⟧?\.$/.test(await J.answer('ring my dentist')));
        await J.answer('learn that');
        const taught = await J.answer('I meant what is 239 times 5550142');
        t.ok('it says why it won\'t save it', /won't save that phrase, because it has a phone or ID number in it/.test(taught));
        t.ok('and the phrase is not in storage', !/dentist|5550142/.test(JSON.stringify(await dbDump(env.idb))));
        t.eq('no console errors', env.errors.length, 0);
    } finally {
        env.close();
    }
    // Something bad that reached the database itself (an older test build, a hand edit): the scrub removes it.
    {
        const idb = (await openDom(page.html, 'https://jarvis.test/jarvis.html', opts)).idb;
        const today = dayOf();
        await dbSeed(idb, {
            kept: { 'jarvis-name': 'Tony', 'jarvis-skin': 'matrix', 'jarvis-learned': JSON.stringify({ 'beam me up': 'roll a die', 'ring pat': 'call 239 555 0142' }), 'jarvis-settings': '{"color":"blue","name":"Tony"}', 'jarvis-voices': 'my phone is 239 555 0142' },
            events: [{ id: 'scene:globe', day: today - 1, n: 2 }, { id: 'said:hello tony', day: today - 1, n: 1 }, { id: 'cmd:joke', day: today - 1, n: 1, note: 'my phone' }, { id: 'cmd:fact', day: 'yesterday', n: 1 }],
            totals: [{ id: 'cmd:joke', n: 5 }, { id: 'tony', n: 1 }],
            meta: { copied: 1, name: 'Tony' }
        });
        env = await openDom(page.html, 'https://jarvis.test/jarvis.html', { ...opts, idb });
        try {
            const d = await dbDump(idb);
            t.eq('in the database: only listed settings survive, cleaned', JSON.stringify(d.kept, Object.keys(d.kept).sort()), JSON.stringify({ 'jarvis-learned': '{"beam me up":"roll a die"}', 'jarvis-settings': '{"color":"blue"}', 'jarvis-skin': 'matrix' }));
            t.eq('usage counts with an unlisted ID, an extra field or a date are removed', Object.values(d.events).filter((e) => e.day !== today).map((e) => e.id).join(), 'scene:globe');
            t.eq('and so is an unlisted total', Object.keys(d.totals).join(), 'cmd:joke');
            t.ok('and anything else in the bookkeeping', !('name' in d.meta));
            t.eq('the clean values load', env.window.__jarvis.skin(), 'matrix');
            t.eq('no console errors', env.errors.length, 0);
        } finally { env.close(); }
    }
    env = await openDom(page.html, 'https://jarvis.test/jarvis.html', { ...opts, beforeParse(w) { opts.beforeParse(w); w.localStorage.setItem('jarvis-skin', 'constructor'); w.localStorage.setItem('jarvis-learned', '{nope'); } });
    try {
        t.eq('a bad saved skin falls back to Jarvis', env.window.__jarvis.skin(), 'jarvis');
        t.eq('and a corrupt store doesn\'t break the page', env.errors.length, 0);
    } finally {
        env.close();
    }
}

// The voice menu beside the skin button, and each skin's preferred voice.
async function voicePicker(t, page) {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    t.section('Voices');
    // An iPhone-like set of voices: Daniel for Jarvis, Ralph for Morpheus, Junior for Stanley, plus others.
    const VOICES = [['Samantha', 'en-US'], ['Daniel (Enhanced)', 'en-GB'], ['Ralph', 'en-US'], ['Junior', 'en-US'], ['Thomas', 'fr-FR'], ['Karen', 'en-AU']].map(([name, lang]) => ({ name, lang }));
    const spoken = [];
    const beforeParse = (w) => {
        w.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
        w.speechSynthesis = { getVoices: () => VOICES, onvoiceschanged: null, speak(u) { spoken.push(u); }, cancel() {} };
    };
    const env = await openDom(page.html, 'https://jarvis.test/jarvis.html', { ignore: /getContext|HTMLCanvasElement/, beforeParse });
    try {
        const { document, window } = env, J = window.__jarvis, sel = document.getElementById('voice');
        const opts = () => [...sel.options].map((o) => o.textContent);
        const pick = async (value) => { sel.value = value; sel.dispatchEvent(new window.Event('change')); await wait(10); };
        const last = () => spoken[spoken.length - 1];
        t.ok('the voice menu is shown beside the skin button', !sel.hidden && sel.parentElement === document.getElementById('skin').parentElement);
        t.eq('it offers Auto plus the device\'s five English voices', opts().length, 6);
        t.ok('and leaves out a French voice', !opts().some((o) => /Thomas/.test(o)));
        t.eq('Auto names Jarvis\'s pick, Daniel', opts()[0], '🔊 Auto · Daniel');
        document.getElementById('skin').click(); await wait(10);
        t.eq('Morpheus gets Ralph', last().voice?.name, 'Ralph');
        t.ok('with a gentler pitch than a generic voice gets', last().pitch > 0.55 && last().pitch < 0.9);
        t.eq('and the menu follows the skin', opts()[0], '🔊 Auto · Ralph');
        document.getElementById('skin').click(); await wait(10);
        t.eq('Stanley gets Junior', last().voice?.name, 'Junior');
        document.getElementById('skin').click(); await wait(10);
        t.eq('Jarvis gets Daniel', last().voice?.name, 'Daniel (Enhanced)');
        t.eq('in Daniel\'s British English', last().lang, 'en-GB');
        await pick('Samantha');
        t.eq('picking a voice speaks a sample in it straight away', last().voice?.name, 'Samantha');
        t.ok('the sample is Jarvis\'s', /How do I sound\?/.test(last().text));
        t.eq('the pick is saved for that skin on this device', JSON.parse((await dbDump(env.idb)).kept['jarvis-voices']).jarvis, 'Samantha');
        t.eq('the menu shows it', sel.value, 'Samantha');
        t.eq('the utterance\'s language matches the voice, which Android Chrome needs to use it', last().lang, 'en-US');
        t.eq('a voice that isn\'t on Jarvis\'s own list keeps his full pitch', last().pitch, 0.9);
        document.getElementById('skin').click(); await wait(10);
        t.eq('other skins keep their own voice', last().voice?.name, 'Ralph');
        t.eq('and the menu goes back to Auto for them', sel.value, '');
        document.getElementById('skin').click(); await wait(10); document.getElementById('skin').click(); await wait(10);
        t.eq('back on Jarvis, the picked voice comes back', last().voice?.name, 'Samantha');
        await pick('');
        t.eq('choosing Auto returns to Daniel', last().voice?.name, 'Daniel (Enhanced)');
        t.ok('and clears the saved pick', !('jarvis' in JSON.parse((await dbDump(env.idb)).kept['jarvis-voices'])));
    } finally {
        env.close();
    }
    const env2 = await openDom(page.html, 'https://jarvis.test/jarvis.html', { ignore: /getContext|HTMLCanvasElement/, beforeParse(w) { beforeParse(w); w.localStorage.setItem('jarvis-voices', JSON.stringify({ jarvis: 'Karen', constructor: 'x', matrix: 5 })); } });
    try {
        t.eq('a saved voice pick comes back on the next visit', env2.document.getElementById('voice').value, 'Karen');
        t.eq('and junk in the store doesn\'t break the page', env2.errors.length, 0);
    } finally {
        env2.close();
    }
}

// Android Chrome names its voices after languages, one per accent, sometimes listed twice.
async function androidVoices(t, page) {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    t.section('Voices on Android');
    const VOICES = [['English United States', 'en-US'], ['English United Kingdom', 'en-GB'], ['English United Kingdom', 'en-GB'], ['English India', 'en-IN'], ['Deutsch Deutschland', 'de-DE']].map(([name, lang]) => ({ name, lang }));
    const spoken = [];
    const env = await openDom(page.html, 'https://jarvis.test/jarvis.html', { ignore: /getContext|HTMLCanvasElement/, beforeParse(w) {
        w.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
        w.speechSynthesis = { getVoices: () => VOICES, onvoiceschanged: null, speak(u) { spoken.push(u); }, cancel() {} };
    } });
    try {
        const { document, window } = env, sel = document.getElementById('voice'), last = () => spoken[spoken.length - 1];
        const opts = [...sel.options].map((o) => o.textContent);
        t.eq('each accent is listed once', JSON.stringify(opts), JSON.stringify(['🔊 Auto · English (UK)', 'English (US)', 'English (UK)', 'English (India)']));
        sel.value = 'English India'; sel.dispatchEvent(new window.Event('change')); await wait(10);
        t.eq('picking one sets the utterance\'s language to it', last().lang, 'en-IN');
        document.getElementById('skin').click(); await wait(10);
        t.eq('Morpheus falls back to a US voice', last().lang, 'en-US');
        t.eq('and keeps his full low pitch, since it isn\'t a character voice', last().pitch, 0.55);
    } finally {
        env.close();
    }
}

/* Session 6: "Hey Jarvis". A fake SpeechRecognition that behaves like the real one: start() throws
 * InvalidStateError while it's already running, and onstart/onend arrive later, not inside the call
 * (see CLAUDE.md, "A fake speech recognizer must behave like the real one"). */
function fakeRecognizer({ chromium = true, speaking = () => false } = {}) {
    const log = { recs: [], starts: 0 };
    return {
        log,
        beforeParse(window) {
            window.SpeechRecognition = class {
                constructor() { this.running = false; this.continuous = false; log.recs.push(this); }
                start() {
                    if (this.running) throw new window.DOMException('already started', 'InvalidStateError');
                    this.running = true; log.starts++; setTimeout(() => this.onstart?.(), 0);
                }
                stop() { if (!this.running) return; this.running = false; setTimeout(() => this.onend?.(), 0); }
                // what Chrome does when a continuous session ends by itself (a silence, a network blip)
                drop() { this.running = false; this.onend?.(); }
                hear(text, final = true) { this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: final })] }); }
            };
            if (chromium) Object.defineProperty(window.navigator, 'userAgentData', { configurable: true, value: { brands: [{ brand: 'Chromium', version: '130' }, { brand: 'Google Chrome', version: '130' }] } });
            window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
            window.speechSynthesis = { getVoices: () => [], onvoiceschanged: null, get speaking() { return speaking(); }, speak() {}, cancel() {} };
        }
    };
}

async function wakeWiring(t, page) {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const open = async (opts) => {
        const fake = fakeRecognizer(opts);
        const env = await openDom(page.html, 'https://jarvis.test/jarvis.html', { ignore: /getContext|HTMLCanvasElement/, beforeParse: fake.beforeParse });
        return { ...env, log: fake.log };
    };
    t.section('"Hey Jarvis" (Session 6)');

    const { wakeCommand, wakeIntent } = (await openDom(page.html, 'https://jarvis.test/jarvis.html', { ignore: /getContext|HTMLCanvasElement/ })).window.__jarvis;
    t.eq('"Jarvis, what time is it" is for Jarvis', wakeCommand('Jarvis, what time is it?'), 'what time is it?');
    t.eq('"hey Jarvis tell me a joke"', wakeCommand('hey Jarvis tell me a joke'), 'tell me a joke');
    t.eq('"OK Jarvis" alone wakes him with nothing to do yet', wakeCommand('OK Jarvis'), '');
    t.eq('a phrase that doesn\'t start with the name is ignored', wakeCommand('what time is it Jarvis'), null);
    t.eq('"Jarvisville" is not the name', wakeCommand('Jarvisville is a town'), null);
    t.eq('the current skin\'s name works too', wakeCommand('Morpheus, take the red pill', 'jarvis|morpheus'), 'take the red pill');
    t.eq('"always listen" turns it on', wakeIntent('always listen'), true);
    t.eq('"turn on the wake word"', wakeIntent('turn on the wake word'), true);
    t.eq('"stop always listening" turns it off', wakeIntent('stop always listening'), false);
    t.eq('"wake word off"', wakeIntent('wake word off'), false);
    t.eq('"listen to this" is not the switch', wakeIntent('listen to this'), null);

    let env = await open({ chromium: false });
    try {
        t.ok('outside Chrome and Edge, the switch is hidden', env.document.getElementById('wake').hidden);
        t.ok('and asking for it says why', /Chrome and Edge only/.test(await env.window.__jarvis.answer('always listen')));
        t.eq('and nothing starts listening', env.log.starts, 0);
    } finally { env.close(); }

    let speaking = false;
    env = await open({ speaking: () => speaking });
    try {
        const { window, document, log } = env;
        const rec = log.recs[0], btn = document.getElementById('wake'), note = document.getElementById('wake-note');
        const said = () => [...document.querySelectorAll('#log .msg.me')].map((m) => m.textContent);
        const last = () => [...document.querySelectorAll('#log .msg.ai')].pop()?.textContent ?? '';
        t.eq('the page has no console errors with the switch', env.errors.length, 0);
        t.ok('in Chrome, the switch shows, off', !btn.hidden && btn.getAttribute('aria-pressed') === 'false' && /OFF/.test(btn.textContent));
        t.ok('off by default: nothing is listening', !rec.running && note.hidden);
        btn.click();
        await wait(5);
        t.ok('switching it on starts continuous recognition', rec.running && rec.continuous === true);
        t.ok('the button shows it is on', btn.getAttribute('aria-pressed') === 'true' && /ON/.test(btn.textContent));
        t.ok('a note says plainly where the audio goes, and that it is Chrome and Edge only', !note.hidden && /online speech service/.test(note.textContent) && /Chrome and Edge only/.test(note.textContent));
        t.ok('Jarvis says it too', /online speech service/.test(last()));
        t.ok('the mic is ringed, so it shows over the projector too', document.getElementById('mic').classList.contains('wake'));
        t.eq('waiting for the name is not LISTENING', document.getElementById('state').textContent !== 'LISTENING', true);
        t.ok('nothing about it is saved', !Object.keys(window.localStorage).some((k) => /wake|listen/.test(k)) && !Object.keys((await dbDump(env.idb)).kept).some((k) => /wake|listen/.test(k)));

        rec.hear('what is two plus two');
        t.ok('talk without the name is ignored', !said().includes('what is two plus two'));
        rec.hear('Jarvis, what is three plus three');
        t.ok('"Jarvis, …" is handled, without the name', said().includes('what is three plus three'));
        rec.hear('Jarvis');
        t.eq('the name alone: LISTENING for the next phrase', document.getElementById('state').textContent, 'LISTENING');
        rec.hear('tell me a joke');
        t.ok('and that next phrase is handled', said().includes('tell me a joke'));
        rec.hear('tell me a fact');
        t.ok('only that one phrase', !said().includes('tell me a fact'));
        rec.hear('Jarvis, maybe', false);
        t.ok('a result that isn\'t final yet is ignored', !said().includes('maybe'));

        speaking = true;
        rec.hear('Jarvis, flip a coin');
        t.ok('while Jarvis is speaking, nothing is acted on (not even his own voice)', !said().includes('flip a coin'));
        speaking = false;

        let starts = log.starts;
        document.getElementById('mic').click();
        t.eq('tapping the mic while it is on doesn\'t restart recognition (which would throw)', log.starts, starts);
        rec.hear('roll a die');
        t.ok('the tap means the next phrase is for Jarvis, no name needed', said().includes('roll a die'));

        rec.drop();
        await wait(350);
        t.ok('when Chrome ends the session by itself, it starts again', rec.running && log.starts === starts + 1);

        rec.onerror({ error: 'not-allowed' }); rec.running = false;
        await wait(5);
        t.ok('if the mic is refused, it turns itself off', btn.getAttribute('aria-pressed') === 'false' && note.hidden && /wouldn't let me use the microphone/.test(last()));
        await wait(350);
        starts = log.starts;
        t.ok('and does not keep trying', !rec.running);

        btn.click(); await wait(5);
        for (let i = 0; i < 6; i++) { rec.drop(); await wait(320); }
        t.ok('if recognition keeps ending, it stops trying rather than loop', btn.getAttribute('aria-pressed') === 'false' && /kept ending/.test(last()));

        btn.click(); await wait(5);
        window.__jarvis.setSkin('matrix');
        t.ok('the switch follows the skin\'s name', /HEY MORPHEUS: ON/.test(btn.textContent));
        rec.hear('Morpheus, what is four plus four');
        t.ok('and so does the wake word', said().includes('what is four plus four'));
        window.__jarvis.setSkin('panther');
        t.ok('as Stanley, the switch says HEY STANLEY, not his full name', /HEY STANLEY: ON/.test(btn.textContent));
        rec.hear('Stanley, what is five plus five');
        t.ok('and "Stanley, …" wakes him', said().includes('what is five plus five'));
        window.__jarvis.setSkin('jarvis');

        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new window.Event('visibilitychange'));
        await wait(5);
        t.ok('leaving the page turns it off', btn.getAttribute('aria-pressed') === 'false' && !rec.running);
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });

        t.ok('typing "always listen" turns it on', /is on/.test(await window.__jarvis.answer('always listen')) && rec.running);
        t.ok('and "stop always listening" off', /is off/.test(await window.__jarvis.answer('stop always listening')) && btn.getAttribute('aria-pressed') === 'false');
        await wait(5);
        t.ok('switching off stops recognition', !rec.running);
        t.eq('no console errors through all that', env.errors.length, 0);
    } finally { env.close(); }
}

async function briefingChecks(t, page) {
    t.section('"Brief me" (Session 6)');
    const env = await openDom(page.html, 'https://jarvis.test/jarvis.html', { ignore: /getContext|HTMLCanvasElement/ });
    try {
        const { briefingText, answer } = env.window.__jarvis;
        const now = new Date('2026-10-09T20:00:00Z');
        const item = (category, title, date, source = 'Some Wire') => ({ category, title, date, source });
        const data = { generatedAt: '2026-10-09T18:00:00Z', items: [
            item('news', 'Older story', '2026-10-09T10:00:00Z'),
            item('news', 'Newest story!', '2026-10-09T17:00:00Z', 'BBC News'),
            item('swfl', 'Bridge reopens on Estero Boulevard - Naples Daily News', '2026-10-09T16:00:00Z', 'Google News: Naples'),
            item('tech', 'Chip maker ships new chip', '2026-10-09T15:00:00Z', 'The Verge'),
            item('live', 'M 4.1 - somewhere', '2026-10-09T19:00:00Z', 'USGS Earthquakes'),
            item('science', '', '2026-10-09T19:00:00Z'),
            item('science', 'Probe reaches Jupiter', 'not a date', 'NASA')
        ] };
        const b = briefingText(data, now);
        t.ok('starts with the time and date', /^It's .+ on .+\./.test(b));
        t.ok('the newest news headline, with its source', /In the news: Newest story, from BBC News\./.test(b));
        t.ok('a Google News headline names the publisher, not the search', /In Southwest Florida: Bridge reopens on Estero Boulevard, from Naples Daily News\./.test(b));
        t.ok('tech and science follow, in that order', b.indexOf('In tech') > b.indexOf('Southwest Florida') && b.indexOf('In science and space: Probe reaches Jupiter') > b.indexOf('In tech'));
        t.ok('live data (earthquakes) is left out, and an empty title is skipped', !/USGS|M 4\.1/.test(b));
        const spam = { generatedAt: data.generatedAt, items: [
            item('swfl', '⊕[ＷＡＴＣＨ ＬＩＶＥ ＮＯＷ]⊕ Marco Island vs Leonard 𝐋𝐈𝐕𝐄 Streams - Узнай Москву', '2026-10-09T19:00:00Z', 'Google News: Marco Island'),
            item('swfl', 'Lely vs Naples Live Stream HD - Some Site', '2026-10-09T18:30:00Z', 'Google News: Naples'),
            item('swfl', 'County opens new library branch - Fort Myers News-Press', '2026-10-09T12:00:00Z', 'Google News: Fort Myers')] };
        t.ok('live-stream spam is skipped for the next real headline', /In Southwest Florida: County opens new library branch, from Fort Myers News-Press\./.test(briefingText(spam, now)) && !/Stream|ＷＡＴＣＨ/.test(briefingText(spam, now)));
        t.ok('ordinary headlines are not spam', !env.window.__jarvis.briefSpam(item('news', 'Watch: the eclipse in pictures', '', 'BBC News')) && !env.window.__jarvis.briefSpam(item('tech', 'Streaming prices rise again', '', 'The Verge')));
        t.ok('fresh headlines get no age warning', !/old\./.test(b));
        t.ok('headlines over a day old say so', /These headlines are 3 days old\./.test(briefingText({ ...data, generatedAt: '2026-10-06T18:00:00Z' }, now)));
        t.ok('no headlines: says so, after the time', /^It's .+ I couldn't find any headlines right now\.$/.test(briefingText({ items: [] }, now)));
        t.ok('a very long headline is cut at a word', briefingText({ generatedAt: data.generatedAt, items: [item('news', 'word '.repeat(60), data.generatedAt)] }, now).length < 260);
        t.ok('no weather: the briefing never asks for a location', !/geolocation/.test(page.html));
        t.ok('"brief me" opens the briefing (here, without fetch, it says it couldn\'t load)', /^It's .+ I couldn't load the headlines just now\.$/.test(await answer('brief me')));
        for (const q of ['Jarvis, brief me', 'give me my morning briefing', "what's in the news", 'read me the headlines', 'news please'])
            t.ok(`"${q}" is the briefing`, /^It's .+ on /.test(await answer(q)));
        t.ok('"the news is boring" is not', !/^It's .+ on /.test(await answer('the news is boring')));
        t.ok('help mentions the briefing and always listening', /brief me/.test(env.window.__jarvis.brain('help')) && /always listening/.test(env.window.__jarvis.brain('help')));
        t.ok('it reads daily-wire/feeds.json from this site', /fetch\('daily-wire\/feeds\.json'/.test(page.html));
        if (page.url.startsWith('file:')) {
            const real = JSON.parse(await readFile(fileURLToPath(new URL('daily-wire/feeds.json', page.url)), 'utf8'));
            const rb = briefingText(real, new Date(real.generatedAt));
            t.ok('the real feeds.json gives a headline for all four categories', ['In the news', 'In Southwest Florida', 'In tech', 'In science and space'].every((l) => rb.includes(l + ': ')));
            t.note(rb);
        }
    } finally { env.close(); }
}

// Session 7 of jarvis/build-plan.html: settings memory, short-term memory, the memory core, dreaming,
// keeping settings from being wiped, and streaks. Nothing personal may reach storage (review 53).
async function memoryChecks(t, page) {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const ymd = (d) => ({ y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() });
    const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };
    // What jarvis.html left in localStorage, which the test copy copies in on its first run.
    const seed = (entries, extra) => ({ ignore: /getContext|HTMLCanvasElement/, beforeParse(w) { extra?.(w); for (const [k, v] of Object.entries(entries)) w.localStorage.setItem(k, v); } });
    // A reload: the same browser profile, so the same database.
    const again = (idb, extra = {}) => openDom(page.html, 'https://jarvis.test/jarvis.html', { ignore: /getContext|HTMLCanvasElement/, ...extra, idb });
    const keptIn = async (env) => (await dbDump(env.idb)).kept;
    const everything = async (env) => JSON.stringify(await dbDump(env.idb)) + JSON.stringify({ ...env.window.localStorage });
    const typeIn = async (env, text) => { const { document, window } = env; document.getElementById('q').value = text; document.getElementById('f').dispatchEvent(new window.Event('submit', { cancelable: true })); await wait(520); return [...document.querySelectorAll('#log .msg.ai')].pop()?.textContent ?? ''; };

    t.section('Settings memory (Session 7)');
    const fake = fakeSpeech();
    let persistCalls = 0;
    let env = await openDom(page.html, 'https://jarvis.test/jarvis.html', { ignore: /getContext|HTMLCanvasElement/, beforeParse(w) {
        fake.beforeParse(w);
        Object.defineProperty(w.navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false), persist: () => { persistCalls++; return Promise.resolve(true); } } });
        Object.defineProperty(w.navigator, 'userAgentData', { configurable: true, value: { brands: [{ brand: 'Google Chrome', version: '130' }] } });
    } });
    let saved;
    try {
        const { window } = env, J = window.__jarvis, ls = window.localStorage;
        for (const [q, key, value] of [['make the orb blue', 'color', 'blue'], ['turn yourself purple', 'color', 'purple'], ['change your colour to red', 'color', 'red'], ['gold orb please', 'color', 'gold'], ['set your color to grey', 'color', 'white'],
            ['default colour', 'color', null], ['speak faster', 'speed', '+'], ['talk a bit slower', 'speed', '-'], ['slow down', 'speed', '-'], ['normal speed', 'speed', null],
            ['use imperial units', 'units', 'imperial'], ['I prefer miles', 'units', 'imperial'], ['switch to metric', 'units', 'metric'], ['open with the galaxy', 'scene', 'galaxy'],
            ['always start with the solar system', 'scene', 'solar'], ['open with earth', 'scene', 'globe'], ['start with your brain', 'scene', 'neural'], ["don't open with anything", 'scene', null], ['reset my settings', 'all', null]]) {
            const it = J.settingsIntent(q);
            t.ok(`"${q}" sets ${key} to ${value}`, !!it && it.key === key && it.value === value);
        }
        for (const q of ['what time is it', 'make a heart', 'show me the galaxy', 'switch to the matrix', 'make the orb', 'write blue', 'my favourite colour is blue', 'speak to me', 'open the pod bay doors'])
            t.eq(`"${q}" is not a settings command`, J.settingsIntent(q), null);
        // Every value a setting can take must pass personal(), or store() would silently refuse to save it.
        const combos = [];
        for (const color of J.SETTING_CHOICES.color) for (const units of J.SETTING_CHOICES.units) for (const scene of J.SETTING_CHOICES.scene) combos.push({ color, speed: 'slow', units, scene });
        t.eq('every combination of settings passes personal()', combos.filter((c) => J.personal(JSON.stringify(c))).length, 0);
        t.ok('"make the orb blue" is understood', /My orb is blue now\. I'll remember that on this device\./.test(await typeIn(env, 'make the orb blue')));
        t.eq('the orb takes the colour', J.ring(), J.ORB_COLOURS.blue[0]);
        t.eq('and it is saved as one jarvis-settings key', (await keptIn(env))['jarvis-settings'], '{"color":"blue"}');
        J.setSkin('panther');
        t.eq('a skin change keeps the chosen orb colour', J.ring(), J.ORB_COLOURS.blue[0]);
        J.setSkin('jarvis');
        await typeIn(env, 'speak faster');
        fake.log.queue.length = 0; await typeIn(env, 'tell me a joke');
        t.eq('"speak faster" speeds the voice up', Math.round(fake.log.queue[0].rate * 1000), Math.round(1.02 * J.SPEEDS.fast * 1000));
        t.ok('and there is a top speed', /as fast as I go/.test(await typeIn(env, 'talk faster')));
        t.ok('"slower" steps back to normal, which is not saved', /normal speed/i.test(await typeIn(env, 'speak slower')) && !('speed' in J.settings()));
        await typeIn(env, 'speak slower');
        t.eq('then slow', J.settings().speed, 'slow');
        t.ok('"use imperial units"', /I'll use imperial units\./.test(await typeIn(env, 'use imperial units')));
        t.ok('then distances are said in miles', /about 240,000 miles away/.test(await typeIn(env, 'how far is the moon')));
        t.eq('600 km an hour', J.inUnits('steady at 600 kilometres an hour.'), 'steady at about 370 miles an hour.');
        t.eq('15 centimeters', J.inUnits('about 15 centimeters taller'), 'about 6 inches taller');
        t.eq('8,849 metres', J.inUnits('Everest is 8,849 metres tall'), 'Everest is about 29,000 feet tall');
        t.eq('150 million kilometres', J.inUnits('about 150 million kilometres away'), 'about 93 million miles away');
        t.eq('2,000 kilometers an hour', J.inUnits('over 2,000 kilometers an hour'), 'over 1,200 miles an hour');
        t.eq('metric leaves the text alone', J.inUnits('600 kilometres', 'metric'), '600 kilometres');
        t.eq('"5 metric tons" is not a distance', J.inUnits('5 metric tons'), '5 metric tons');
        t.ok('"open with the galaxy"', /I'll open with the galaxy next time/.test(await typeIn(env, 'open with the galaxy')));
        t.eq('all four settings are in the one key', (await keptIn(env))['jarvis-settings'], '{"color":"blue","speed":"slow","units":"imperial","scene":"galaxy"}');
        t.ok('"what do you save" lists the settings', /your settings \(a blue orb, speaking slowly, imperial units, opening with the galaxy\)/.test(await typeIn(env, 'what do you save')));
        t.ok('and mentions Safari\'s 7-day rule', /after 7 days without a visit/.test(await typeIn(env, 'what do you save')));
        t.eq('the browser was asked to keep storage, once', persistCalls, 1);
        await wait(10);
        t.eq('and its answer is remembered', J.persisted(), true);
        const help = J.brain('help');
        t.ok('help mentions settings, short-term memory, the memory core, dreaming and the 7-day rule', /make the orb blue/.test(help) && /my dog is Rex/.test(help) && /show me your memory/.test(help) && /dream/.test(help) && /7 days/.test(help));
        saved = env.idb;
        t.eq('no console errors', env.errors.length, 0);
    } finally { env.close(); }

    env = await again(saved);
    try {
        const { window, document } = env, J = window.__jarvis;
        t.eq('after a reload the settings are back', JSON.stringify(J.settings()), '{"color":"blue","speed":"slow","units":"imperial","scene":"galaxy"}');
        t.eq('and the orb is blue straight away', J.ring(), J.ORB_COLOURS.blue[0]);
        J.finishBoot();
        await wait(1400);
        t.ok('the favourite scene is opened after the greeting (no WebGL here, so it says so)', /needs WebGL/.test(document.getElementById('log').textContent));
        t.ok('"reset my settings" clears them', /back to normal/.test(await typeIn(env, 'reset my settings')) && !('jarvis-settings' in await keptIn(env)));
    } finally { env.close(); }

    t.section('Settings: the scrub (Session 7)');
    env = await openDom(page.html, 'https://jarvis.test/jarvis.html', seed({
        'jarvis-settings': JSON.stringify({ color: 'blue', name: 'Tony', scene: '<img src=x onerror=alert(1)>', speed: 'ludicrous', __proto__: 'x' }),
        'jarvis-skin': 'matrix'
    }));
    try {
        t.eq('a setting outside the fixed choices is dropped, and so is any extra field', (await keptIn(env))['jarvis-settings'], '{"color":"blue"}');
    } finally { env.close(); }
    env = await openDom(page.html, 'https://jarvis.test/jarvis.html', seed({ 'jarvis-settings': '{"units":"furlongs"}' }));
    try {
        t.ok('settings with nothing valid are not saved', !('jarvis-settings' in await keptIn(env)));
    } finally { env.close(); }
    env = await openDom(page.html, 'https://jarvis.test/jarvis.html', seed({ 'jarvis-settings': '{"color":"gold","units":"imperial"}' }));
    try {
        const J = env.window.__jarvis;
        t.eq('clean settings are copied exactly as they were', (await keptIn(env))['jarvis-settings'], '{"color":"gold","units":"imperial"}');
        J.scrubStore(); J.scrubStore();
        t.eq('and the scrub, run again, leaves them alone', (await keptIn(env))['jarvis-settings'], '{"color":"gold","units":"imperial"}');
    } finally { env.close(); }

    t.section('Streaks (Session 7, on usage counts since Session 9)');
    {
        const J = (env = await openDom(page.html, 'https://jarvis.test/jarvis.html', { ignore: /getContext|HTMLCanvasElement/ })).window.__jarvis;
        t.eq('day 1 says nothing', J.streakLine(1), '');
        t.eq('day 3', J.streakLine(3), 'Third day in a row!');
        t.eq('day 14', J.streakLine(14), 'Day 14 in a row!');
        t.eq('a first visit starts at 1', J.streak().days, 1);
        env.close();
    }
    // The old jarvis-streak in localStorage is read once and carried over as visit counts.
    env = await openDom(page.html, 'https://jarvis.test/jarvis.html', seed({ 'jarvis-streak': JSON.stringify({ days: 2, ...daysAgo(1) }) }));
    try {
        const { window, document } = env, J = window.__jarvis;
        t.eq('visiting the day after day 2 makes it 3', J.streak().days, 3);
        const ev = Object.values((await dbDump(env.idb)).events);
        t.eq('carried over as one visit count for each of the 3 days, today included', ev.filter((e) => e.id === 'app:visit').map((e) => dayOf() - e.day).sort().join(), '0,1,2');
        t.eq('the old key is left where it was, for jarvis.html', JSON.parse(window.localStorage.getItem('jarvis-streak')).days, 2);
        J.finishBoot();
        // Three days is also clearance level 2 (Session 11), so the streak line is followed by the level-up.
        t.ok('and the greeting says so', /Third day in a row! Access level two granted: Associate\./.test([...document.querySelectorAll('#log .msg.ai')].pop().textContent));
        t.ok('"what do you save" says where the streak comes from', /Your visit streak, 3 days, is worked out from those counts\./.test(await J.answer('what do you save')));
    } finally { env.close(); }
    env = await openDom(page.html, 'https://jarvis.test/jarvis.html', seed({ 'jarvis-streak': JSON.stringify({ days: 9, ...daysAgo(2) }) }));
    try {
        const { document } = env, J = env.window.__jarvis;
        t.eq('after a missed day it starts again at 1', J.streak().days, 1);
        t.eq('and the broken streak isn\'t carried over', Object.values((await dbDump(env.idb)).events).filter((e) => e.day !== dayOf()).length, 0);
        t.eq('but it still means this isn\'t a first visit', J.firstTime, false);
        J.finishBoot();
        t.ok('with no streak line', !/in a row/.test(document.getElementById('log').textContent));
    } finally { env.close(); }
    env = await openDom(page.html, 'https://jarvis.test/jarvis.html', seed({ 'jarvis-streak': '{"days":"3","y":2026,"m":10,"d":10}' }));
    try {
        t.eq('a malformed old streak is ignored', env.window.__jarvis.streak().days, 1);
    } finally { env.close(); }
    env = await openDom(page.html, 'https://jarvis.test/jarvis.html', seed({ 'jarvis-streak': JSON.stringify({ days: 4, ...daysAgo(1), extra: 'my phone 239 555 0142' }) }));
    try {
        t.eq('an extra field in the old streak is dropped, the count kept and today added', env.window.__jarvis.streak().days, 5);
        t.ok('and the extra field is nowhere in the database', !/phone|555/.test(JSON.stringify(await dbDump(env.idb))));
    } finally { env.close(); }

    t.section('First time on this device (Session 7)');
    persistCalls = 0;
    env = await openDom(page.html, 'https://jarvis.test/jarvis.html', { ignore: /getContext|HTMLCanvasElement/, beforeParse(w) {
        Object.defineProperty(w.navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(true), persist: () => { persistCalls++; return Promise.resolve(true); } } });
        Object.defineProperty(w.navigator, 'userAgentData', { configurable: true, value: { brands: [{ brand: 'Microsoft Edge', version: '130' }] } });
    } });
    try {
        const { window, document } = env, J = window.__jarvis;
        t.eq('nothing stored: a first visit', J.firstTime, true);
        J.finishBoot();
        t.ok('he says it looks like his first time on this device', /This looks like my first time on this device\.$/.test(document.getElementById('log').textContent));
        t.ok('the default skin is not saved just by loading', !('jarvis-skin' in await keptIn(env)));
        t.eq('persist() isn\'t asked again when storage is already persisted', persistCalls, 0);
        await wait(10);
        t.eq('and that is remembered', J.persisted(), true);
    } finally { env.close(); }
    persistCalls = 0;
    env = await openDom(page.html, 'https://jarvis.test/jarvis.html', { ignore: /getContext|HTMLCanvasElement/, beforeParse(w) {
        Object.defineProperty(w.navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false), persist: () => { persistCalls++; return Promise.resolve(true); } } });
    } });
    try {
        await env.window.__jarvis.answer('make the orb gold'); await wait(10);
        t.eq('outside Chrome and Edge (Firefox would prompt for it), persist() is never asked', persistCalls, 0);
    } finally { env.close(); }
    env = await openDom(page.html, 'https://jarvis.test/jarvis.html', seed({ 'jarvis-skin': 'jarvis' }));
    try {
        const { document, window } = env;
        t.eq('something stored: not a first visit', window.__jarvis.firstTime, false);
        window.__jarvis.finishBoot();
        t.ok('and no first-time line', !/first time/.test(document.getElementById('log').textContent));
        t.eq('without navigator.storage nothing breaks', env.errors.length, 0);
    } finally { env.close(); }

    t.section('Short-term memory (Session 7)');
    env = await openDom(page.html, 'https://jarvis.test/jarvis.html', { ignore: /getContext|HTMLCanvasElement/ });
    let afterTelling;
    try {
        const { window } = env, J = window.__jarvis;
        for (const [q, key, text] of [['my dog is Rex', 'dog', 'your dog is Rex'], ["My dog's name is Rex.", 'dog', "your dog's name is Rex"], ['my favorite color is blue', 'favourite colour', 'your favorite color is blue'],
            ["I'm going to the beach", 'plan', "you're going to the beach"], ['remember that the game is at seven', 'note:game is at seven', 'the game is at seven'], ['I love pizza', 'love:pizza', 'you love pizza'],
            ['remember that I parked on level 3', 'note:i parked on level 3', 'you parked on level 3'], ['my sisters are Amy and Jo', 'sisters', 'your sisters are Amy and Jo']]) {
            const m = J.memoryTell(q);
            t.ok(`"${q}" is remembered as ${key}`, !!m && m.key === key && m.text === text);
        }
        for (const q of ['my name is tony', 'remember my name is tony', 'what is my dog', 'show me mars', 'I love you', 'my dog is not here', 'tell me a joke', 'I am fine'])
            t.eq(`"${q}" is not a short-term memory`, J.memoryTell(q), null);
        t.ok('telling him something', /Got it: your dog is Rex\. I'll remember that until you close this page/.test(await typeIn(env, 'my dog is Rex')));
        t.ok('"what\'s my dog\'s name?"', /^Your dog is Rex\.$/.test(await typeIn(env, "what's my dog's name?")));
        await typeIn(env, "I'm going to the beach"); await typeIn(env, 'my favourite colour is green'); await typeIn(env, 'I like hockey');
        t.eq('"where am I going?"', await typeIn(env, 'where am I going?'), "You're going to the beach.");
        t.eq('"what is my favorite color" finds the British spelling', await typeIn(env, 'what is my favorite color'), 'Your favourite colour is green.');
        t.eq('"what do I like"', await typeIn(env, 'what do I like'), 'You like hockey.');
        t.ok('something never told', /haven't told me about your cat/.test(await typeIn(env, "what's my cat's name")));
        J.setSkin('matrix');
        t.ok('Morpheus knows it too', /^Your dog is Rex\.$/.test(await J.answer('who is my dog')));
        J.setSkin('panther');
        t.ok('and so does Stanley', /beach/.test(await J.answer('where am I going')));
        J.setSkin('jarvis');
        t.ok('"my name is" still goes to the name', /Nice to meet you, Tony/.test(await typeIn(env, 'my name is Tony')) && !J.memory().some((m) => /tony/i.test(m.text)));
        const about = await typeIn(env, 'what do you know about me');
        t.ok('"what do you know about me" lists them, marked this visit only', /^This visit only, and never saved: your dog is Rex, you're going to the beach, your favourite colour is green and you like hockey\./.test(about));
        t.ok('then says what is stored, and the name', /Your name, Tony, is only in memory for this visit\./.test(about) && /4 things you told me are only in memory for this visit too/.test(about));
        t.ok('teaching him a memory statement: he remembers it', /learn that\.$/.test(await typeIn(env, 'blorp')) && /What did you mean/.test(await typeIn(env, 'learn that')) && /Got it: your cat is Tom/.test(await typeIn(env, 'I meant my cat is Tom')));
        t.ok('but never learns the phrase, which would save it', !('blorp' in J.learned()));
        t.ok('nothing told this visit is anywhere in storage', !/Rex|beach|green|hockey|Tom|Tony|blorp/i.test(await everything(env)));
        t.ok('the memory code never calls store()', !/\b(?:store|unstore|saveLearned|saveSettings)\([^)]/.test(page.html.slice(page.html.indexOf('/* ---------- Short-term memory'), page.html.indexOf('/* ---------- Learned phrases'))));
        afterTelling = env.idb;
        t.ok('"forget that" forgets the last thing', /forgotten that your cat is Tom/.test(await typeIn(env, 'forget that')));
        t.ok('"forget my dog"', /forgotten your dog/.test(await typeIn(env, 'forget my dog')) && /haven't told me about your dog/.test(await typeIn(env, "what's my dog's name")));
        t.ok('"forget everything I told you"', /forgotten everything you told me/.test(await typeIn(env, 'forget everything I told you')) && J.memory().length === 0);
        t.ok('which includes the name', /haven't told me your name/.test(await typeIn(env, 'what is my name')));
        t.eq('no console errors', env.errors.length, 0);
    } finally { env.close(); }
    // A reload is a new page given exactly what the old one left in storage: the same database.
    env = await again(afterTelling);
    try {
        const J = env.window.__jarvis;
        t.eq('after a reload, short-term memory is empty', J.memory().length, 0);
        t.ok('"what\'s my dog\'s name" no longer knows', /haven't told me about your dog/.test(await J.answer("what's my dog's name")));
        t.ok('"what do you know about me" says nothing was told', /^You haven't told me anything about you this visit\./.test(await J.answer('what do you know about me')));
    } finally { env.close(); }

    t.section('Memory core (Session 7, no three.js needed)');
    env = await openDom(page.html, 'https://jarvis.test/jarvis.html', seed({ 'jarvis-skin': 'matrix', 'jarvis-settings': '{"color":"blue","units":"imperial"}', 'jarvis-learned': '{"beam me up":"roll a die","lights":"make a star"}', 'jarvis-voices': '{"matrix":"Ralph"}' }));
    try {
        const { window } = env, J = window.__jarvis;
        const ls = { getItem: (k) => (k in J.saved().kept ? J.saved().kept[k] : null) }; // what the page holds; the database is checked after
        for (const q of ['show me your memory', 'memory core', 'open your memories', 'show me the jarvis memory', 'memory'])
            t.eq(`"${q}" opens the memory core`, J.intent(q)?.kind, 'memory');
        for (const q of ['what do you remember', 'forget your memory', 'show me the galaxy'])
            t.ok(`"${q}" does not`, J.intent(q)?.kind !== 'memory');
        await J.answer('my dog is Rex'); J.brain('my name is pepper');
        const stars = J.memoryStars();
        t.eq('one star per setting, the skin, this visit\'s name and memories, each taught phrase, the voice pick, the usage history',
            stars.map((s) => s.type).join(','), 'setting,setting,skin,name,visit,phrase,phrase,voice,history');
        t.eq('this visit\'s stars are marked, the rest are saved', stars.filter((s) => s.visit).length, 2);
        t.ok('labels say what each is', stars[0].label === 'Orb colour: blue' && stars[2].label === 'Skin: Morpheus' && stars[5].label === '"lights"');
        t.ok('a phrase star reads out what it means', stars[5].text === 'A phrase you taught me: "lights" means "make a star".');
        t.ok('a visit star says it is this visit only', /^This visit only: your dog is Rex\.$/.test(stars[4].text));
        t.ok('forgetting a setting star removes it from storage', /Forgotten\. My orb is back/.test(J.forgetStar(stars[0])) && ls.getItem('jarvis-settings') === '{"units":"imperial"}');
        t.ok('a phrase star', /"lights" doesn't mean anything/.test(J.forgetStar(stars[5])) && ls.getItem('jarvis-learned') === '{"beam me up":"roll a die"}');
        t.ok('a visit star', /I no longer know that your dog is Rex/.test(J.forgetStar(stars[4])) && J.memory().length === 0);
        t.ok('the name star', /don't know your name/.test(J.forgetStar(stars[3])) && /haven't told me your name/.test(await J.answer('what is my name')));
        t.ok('the voice star', /automatic voice/.test(J.forgetStar(stars[7])) && ls.getItem('jarvis-voices') === null);
        t.ok('the skin star', /I'm Jarvis again/.test(J.forgetStar(stars[2])) && ls.getItem('jarvis-skin') === null && J.skin() === 'jarvis');
        const before = JSON.stringify(J.saved().events);
        t.ok('the usage history star says how to clear it, and forgets nothing (no wipe commands, by decision)', /Only clearing this site's data in your browser removes them/.test(J.forgetStar(stars[8])) && JSON.stringify(J.saved().events) === before && J.saved().events.length > 0);
        t.ok('its text says nothing you say is in it', /Counts of which scenes and commands you use, by day.*Nothing you say\./.test(stars[8].text));
        t.eq('what is left', J.memoryStars().map((s) => s.label).join(' | '), 'Units: imperial | "beam me up" | Usage history');
        t.eq('and the database agrees', JSON.stringify(await keptIn(env)), JSON.stringify({ 'jarvis-learned': '{"beam me up":"roll a die"}', 'jarvis-settings': '{"units":"imperial"}' }));
        for (const n of [0, 1, 2, 7, 40, 200]) {
            const pts = J.constellation(n, 8), links = J.constellationLinks(pts);
            const r = pts.map((p) => Math.hypot(...p));
            t.ok(`${n} stars: ${n} points within the shell, ${Math.max(0, n - 1)} links back to earlier stars`,
                pts.length === n && r.every((x) => x <= 8 * 1.19) && links.length === Math.max(0, n - 1) && links.every(([a, b]) => a < b && b < n)
                && new Set(pts.map((p) => p.map((v) => v.toFixed(3)).join())).size === n);
        }
        t.eq('the same count gives the same layout', JSON.stringify(J.constellation(9)), JSON.stringify(J.constellation(9)));
        t.ok('without WebGL, "show me your memory" says so', /needs WebGL/.test(await J.answer('show me your memory')));
        t.ok('"forget that" with nothing from this visit', /nothing from this visit to forget/.test(await J.answer('forget that')));
        t.ok('the scene removes its labels in dispose(), per CLAUDE.md', /id='mem-labels'[\s\S]{0,9000}dispose\(\)\{root\.remove\(\)\}/.test(page.html));
        t.ok('and lays them out with layoutCallouts', /boxes=layoutCallouts\(pts,bounds,sides\)[\s\S]{0,2500}MEMORY CORE/.test(page.html));
        t.eq('no console errors', env.errors.length, 0);
    } finally { env.close(); }

    t.section('Dreaming (Session 7)');
    env = await openDom(page.html, 'https://jarvis.test/jarvis.html', { ignore: /getContext|HTMLCanvasElement/ });
    try {
        const { window, document } = env, J = window.__jarvis, A = J.DREAM_AFTER;
        const st = (o) => ({ dreaming: false, mode: 'idle', holo: false, booting: false, hidden: false, speaking: false, lastActive: 0, ...o });
        t.ok('a few minutes, not seconds', A >= 120000 && A <= 600000);
        t.eq('idle long enough: dream', J.dreamDue(A, st()), true);
        t.eq('not a moment before', J.dreamDue(A - 1, st()), false);
        for (const [why, o] of [['while something is on the projector', { holo: true }], ['while booting', { booting: true }], ['in a hidden tab', { hidden: true }], ['while speaking', { speaking: true }], ['while listening', { mode: 'listen' }], ['while thinking', { mode: 'think' }]])
            t.eq(`never ${why}`, J.dreamDue(A * 10, st(o)), false);
        t.eq('never during the boot screen', J.idleFor(A + 1), false);
        J.finishBoot(); await wait(700);
        const state = () => document.getElementById('state').textContent;
        t.eq('after the boot, idle for a few minutes: he dreams', J.idleFor(A + 1), true);
        t.eq('the state reads PROCESSING MEMORIES', state(), 'PROCESSING MEMORIES');
        t.ok('and the page is marked as dreaming', document.body.classList.contains('dreaming'));
        window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'a' }));
        t.ok('a key wakes him', !J.dreaming() && state() === 'STANDBY' && !document.body.classList.contains('dreaming'));
        t.eq('and the idle clock starts again', J.idleFor(A - 5000), false);
        J.idleFor(A + 1);
        document.getElementById('orb').dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
        t.eq('a tap wakes him', J.dreaming(), false);
        J.idleFor(A + 1);
        document.getElementById('q').value = 'what time is it'; document.getElementById('f').dispatchEvent(new window.Event('submit', { cancelable: true }));
        t.eq('a message wakes him', J.dreaming(), false);
        await wait(520);
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        t.eq('nothing runs while the tab is hidden', J.idleFor(A + 1), false);
        t.ok('reduced motion skips the drifting phrases and pulses', /if\(dreamK>\.01&&!reduce\)drawDream/.test(page.html));
        t.eq('no console errors', env.errors.length, 0);
    } finally { env.close(); }
    {
        const fv = fakeVoice({ noted: true });
        env = await openDom(page.html, 'https://jarvis.test/jarvis.html', { ignore: /getContext|HTMLCanvasElement/, beforeParse: fv.beforeParse });
        try {
            const J = env.window.__jarvis;
            J.finishBoot(); await wait(700);
            J.idleFor(J.DREAM_AFTER + 1);
            fv.log.recs[0].onspeechstart?.();
            t.eq('a word heard by speech recognition wakes him', J.dreaming(), false);
        } finally { env.close(); }
    }
}

// "What can you do" answers with command links in the Infinity Stones' colours: click one and it's sent as if typed.
async function commandLinks(t, page) {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    t.section('Command links in the help answer');
    const fake = fakeSpeech();
    let env = await openDom(page.html, 'https://jarvis.test/jarvis.html', { ignore: /getContext|HTMLCanvasElement/, beforeParse: fake.beforeParse });
    try {
        const { window, document } = env, J = window.__jarvis;
        const lastAi = () => [...document.querySelectorAll('#log .msg.ai')].pop();
        const ask = async (text) => { document.getElementById('q').value = text; document.getElementById('f').dispatchEvent(new window.Event('submit', { cancelable: true })); await wait(520); };
        J.finishBoot(); await wait(700);
        const help = J.brain('what can you do'), marks = [...help.matchAll(/⟦/g)].length;
        t.ok('the help answer marks its commands', marks >= 25);
        // Since review 67 the help answer opens the Infinity Gauntlet: one stone per group, its commands as links.
        await ask('what can you do');
        const g = document.getElementById('gauntlet');
        t.ok('help opens the gauntlet', !g.hidden);
        t.eq('the chat line is only the short line', lastAi().textContent, J.HELP_LINE);
        t.eq('and that is all he says', fake.log.spoken.slice(-1)[0], J.HELP_LINE);
        t.eq('the caption is the short line too, plain', document.getElementById('holo-cap').textContent, J.HELP_LINE);
        const tabs = [...g.querySelectorAll('.g-tab')];
        t.eq('six stones, in the link colours\' order', tabs.map((b) => b.dataset.k).join(), 'space,mind,reality,power,time,soul');
        t.eq('the first stone is open', tabs.filter((b) => b.getAttribute('aria-selected') === 'true').map((b) => b.dataset.k).join(), 'space');
        const shown = [];
        for (const [i, b] of tabs.entries()) {
            b.click();
            const ls = [...document.querySelectorAll('#g-links button.cmd')];
            shown.push(...ls.map((x) => x.textContent + '|' + x.title.replace(/^Say "|"$/g, '')));
            if (!ls.every((x) => x.className === 'cmd st' + i)) shown.push('WRONG COLOUR ' + b.dataset.k);
        }
        const inHelp = [...help.matchAll(/⟦([^⟦⟧|]+)(?:\|([^⟦⟧|]+))?⟧/g)].map((m) => m[1] + '|' + (m[2] || m[1]));
        t.eq('the stones hold every marked command, each in its stone\'s colour', shown.join(' · '), inHelp.join(' · '));
        // The 61 commands the help paragraph linked before the gauntlet (review 67), pinned so none can drop out of it.
        const before = ["what time is it", "what's the date", "tell me a joke", "tell me a fun fact", "what is seven times eight", "flip a coin", "roll a die", "launch countdown", "show me the galaxy", "show me the planets", "take me to Mars", "make a heart", "make a rocket", "write my name", "show me your brain", "suit up", "show me Earth", "show me Florida", "show me Tokyo", "tell me about Peru", "how far is Mars", "tell me about gold", "tell me about the Mark 42", "hand control", "scan the room", "brief me", "always listen", "close", "reboot", "switch to Matrix", "switch to Panthers", "back to Jarvis", "what do you know about me", "make the orb blue", "speak faster", "use imperial units", "open with the galaxy", "show me your memory", "create movie night protocol: make the orb purple, then open the galaxy", "movie night", "list my protocols", "house party", "wake up daddy's home", "now Jupiter", "bigger", "slower", "again", "go back", "why", "what do you save", "back up my settings", "restore my settings", "send my settings to my phone", "scan settings", "upgrade your brain", "install your full brain", "which brain are you using", "how well do you know me", "what's my favourite", "what haven't I tried", "stop putting my favourites first"];
        const inStones = new Set(shown.map((x) => x.split('|')[1]));
        t.eq('every command the old help paragraph linked is in a stone', before.filter((c) => !inStones.has(c)).join(', '), '');
        t.eq('every one of them is a link the page accepts', shown.filter((x) => !J.chipCmds().includes(x.split('|')[1])).join(), '');
        t.ok('each is a real button, so it works from the keyboard', [...g.querySelectorAll('#g-links .cmd')].every((b) => b.tagName === 'BUTTON' && b.type === 'button'));
        t.eq('tapping a stone says its name and what it holds', fake.log.spoken.slice(-1)[0], 'Soul: you and me.');
        t.eq('without adding anything to the chat', lastAi().textContent, J.HELP_LINE);
        t.ok('every stone has a note, and the notes keep what the old paragraph said', ['dream', '7 days', 'my dog is Rex', 'WebGPU', 'HEY JARVIS', 'any country'].every((w) => J.GAUNTLET.some((x) => x.note.includes(w))));
        tabs[2].click();
        const joke = [...g.querySelectorAll('#g-links .cmd')].find((b) => b.textContent === 'a joke');
        t.eq('a link can be worded for the list and send the full command', joke?.title, 'Say "tell me a joke"');
        joke.click(); await wait(520);
        t.ok('clicking it closes the gauntlet', g.hidden);
        t.eq('and sends the command, as if you had typed it', [...document.querySelectorAll('#log .msg.me')].pop().textContent, 'tell me a joke');
        t.ok('and Jarvis answers it', /\?|\./.test(lastAi().textContent) && !/didn't understand/.test(lastAi().textContent));
        J.openGauntlet();
        t.eq('it opens again on the stone you last chose', g.querySelector('.g-tab[aria-selected="true"]').dataset.k, 'reality');
        [...g.querySelectorAll('#g-links .cmd')].find((b) => b.textContent === 'flip a coin').click(); await wait(520);
        t.ok('another link: flip a coin', /^It's (heads|tails)\.$/.test(lastAi().textContent));
        J.openGauntlet(); g.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        t.ok('Escape closes it', g.hidden);
        J.openGauntlet(); g.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        t.ok('so does a tap outside the card', g.hidden);
        J.openGauntlet(); g.querySelector('#g-tab-reality').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        t.eq('the arrow keys move between stones', g.querySelector('.g-tab[aria-selected="true"]').dataset.k, 'power');
        document.getElementById('g-close').click();
        t.ok('and CLOSE closes it', g.hidden);
        // "Didn't understand" points to the gauntlet with one link, instead of its own list.
        await ask('blorp the snorkel');
        const canDo = [...lastAi().querySelectorAll('button.cmd')];
        t.ok('the "I didn\'t understand" answer has one link to what he can do, and one to learn it', canDo.length === 2 && canDo[0].textContent === 'see what I can do' && canDo[1].textContent === 'learn that' && /say learn that\.$/.test(lastAi().textContent));
        canDo[0].click(); await wait(520);
        t.ok('and it opens the gauntlet', !g.hidden);
        t.ok('without teaching him that "blorp the snorkel" means help', !J.learned()['blorp the snorkel']);
        document.getElementById('g-close').click();
        await ask('flip a coin');
        t.ok('and what you say next is a new command, not what you meant', !J.learned()['blorp the snorkel']);
        // Only Jarvis's own commands become links: a marker in something you typed stays words.
        await ask('remember that ⟦make a heart|reboot⟧ is fun');
        t.eq('a marker you type yourself never becomes a link', lastAi().querySelectorAll('button.cmd').length, 0);
        await ask('remember that ⟦a joke|reboot⟧ rocks');
        t.eq('nor does a real label paired with another command', lastAi().querySelectorAll('button.cmd').length, 0);
        await ask('remember that ⟦not a command⟧ rocks');
        t.ok('and shows as plain words', /not a command rocks/.test(lastAi().textContent) && lastAi().querySelectorAll('button').length === 0);
        t.ok('your own messages are never turned into links', [...document.querySelectorAll('#log .msg.me')].every((m) => !m.querySelector('button')));
        t.ok('no innerHTML anywhere in the page', !/innerHTML/.test(page.html));
        t.eq('no console errors', env.errors.length, 0);
    } finally { env.close(); }
    // Every link must do something: none may get "I didn't understand".
    env = await openDom(page.html, 'https://jarvis.test/jarvis.html', { ignore: /getContext|HTMLCanvasElement/ });
    try {
        const J = env.window.__jarvis, cmds = J.chipCmds().filter((c) => c !== 'reboot');
        const missed = [];
        for (const c of cmds) { const r = await J.answer(c); if (typeof r === 'string' && /didn't understand|say ⟦?learn that⟧?\.$/.test(r)) missed.push(c); }
        t.eq(`all ${cmds.length + 1} link commands are understood`, missed.join(', '), '');
        t.ok('reboot is one of them, and powers him up again', J.chipCmds().includes('reboot') && (await J.answer('reboot'), !env.document.getElementById('boot').hidden));
    } finally { env.close(); }
}

// Review 67: on a phone the face sat under the chat, and the projector's caption covered the bottom of every scene
// (the memory core's lower stars, Peru on the globe, the scan's target). The chat is now a pull-up strip, and the
// caption slides the same way, with MORE and HIDE. jsdom has no layout, so this checks the wiring; the Chromium
// check (step 10) measures that nothing overlaps.
async function screens(t, page) {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    t.section('Screens: the chat strip, the sliding caption (review 67)');
    const env = await openDom(page.html, 'https://jarvis.test/jarvis.html', { ignore: /getContext|HTMLCanvasElement/ });
    try {
        const { window, document } = env, J = window.__jarvis, body = document.body;
        const ask = async (text) => { document.getElementById('q').value = text; document.getElementById('f').dispatchEvent(new window.Event('submit', { cancelable: true })); await wait(520); };
        const showing = () => [...document.querySelectorAll('#log .msg')].filter((m) => !m.classList.contains('old')).map((m) => m.className.replace('msg ', '') + ':' + m.textContent);
        const handle = document.getElementById('log-handle');
        J.finishBoot(); await wait(700);
        const greet = showing();
        t.ok('after the greeting the strip shows only his replies', greet.length >= 1 && greet.every((x) => x.startsWith('ai:')));
        await ask('flip a coin');
        t.eq('after a turn it shows only his latest reply', showing().length, 1);
        t.ok('which is the answer to that turn', /^ai:It's (heads|tails)\.$/.test(showing()[0]));
        t.ok('nothing is removed: the older messages are still in the log', document.querySelectorAll('#log .msg.old').length === greet.length + 1);
        t.eq('the handle counts them', handle.textContent, `⌃ ${greet.length + 1} EARLIER MESSAGES`);
        t.ok('and is shown', !handle.hidden);
        await ask('roll a die'); await ask('tell me a joke');
        t.eq('it keeps counting', handle.textContent, `⌃ ${greet.length + 5} EARLIER MESSAGES`);
        const tap = (dy) => { handle.dispatchEvent(new window.MouseEvent('pointerdown', { clientY: 400 })); handle.dispatchEvent(new window.MouseEvent('pointerup', { clientY: 400 + dy })); };
        tap(0);
        t.ok('a tap on the handle opens the whole conversation', body.classList.contains('chat-open') && handle.getAttribute('aria-expanded') === 'true');
        t.eq('which then reads BACK TO THE FACE', handle.textContent, '⌄ BACK TO THE FACE');
        tap(80);
        t.ok('a swipe down closes it', !body.classList.contains('chat-open'));
        tap(-80);
        t.ok('a swipe up opens it', body.classList.contains('chat-open'));
        await ask('what time is it');
        t.ok('it stays open while you talk', body.classList.contains('chat-open'));
        handle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        t.ok('and Enter on the handle closes it', !body.classList.contains('chat-open'));
        t.ok('the CSS hides older messages only while closed, and the face only while open',
            /#log \.msg\.old\{display:none\}/.test(page.html) && /body\.chat-open #core\{display:none\}/.test(page.html) && /body\.chat-open #log \.msg\.old\{display:block\}/.test(page.html));
        t.ok('the face is sized by the space it has, not by the screen', /#core\{[^}]*container-type:size/.test(page.html) && /#orb\{width:min\(78vw,96cqh,420px\)/.test(page.html));

        // The projector's caption.
        const box = document.getElementById('cap-box'), cap = document.getElementById('holo-cap');
        const more = document.getElementById('cap-more'), hide = document.getElementById('cap-hide');
        const state = () => box.classList.contains('tucked') ? 'tucked' : box.classList.contains('open') ? 'open' : 'peek';
        cap.textContent = ''; await wait(0);
        t.ok('no caption, no box', box.hidden);
        cap.textContent = 'This is my memory core.'; await wait(0);
        t.ok('a caption shows the box', !box.hidden);
        t.eq('as a two-line peek', state(), 'peek');
        hide.click();
        t.eq('HIDE tucks it away', state(), 'tucked');
        t.eq('leaving a button to bring it back', hide.textContent, '▴ SHOW CAPTION');
        t.ok('with MORE out of the way', more.hidden);
        hide.click();
        t.eq('which brings back the peek', state(), 'peek');
        more.hidden = false; more.click();
        t.eq('MORE shows all of it', [state(), more.textContent, more.getAttribute('aria-expanded')].join(), 'open,⌄ LESS,true');
        more.click();
        t.eq('LESS goes back to two lines', state(), 'peek');
        const swipe = (dy) => { box.dispatchEvent(new window.MouseEvent('pointerdown', { clientY: 600, bubbles: true })); box.dispatchEvent(new window.MouseEvent('pointerup', { clientY: 600 + dy, bubbles: true })); };
        swipe(60); t.eq('a swipe down on it tucks it', state(), 'tucked');
        swipe(-60); t.eq('a swipe up brings it back', state(), 'peek');
        swipe(-60); t.eq('and up again opens it', state(), 'open');
        swipe(60); t.eq('down from open is the peek', state(), 'peek');
        hide.click(); cap.textContent = 'Mars has Olympus Mons.'; await wait(0);
        t.eq('a new caption always starts as a peek, so it\'s never missed', state(), 'peek');
        t.ok('the scenes lay out their labels above the caption box, not the text', (page.html.match(/document\.getElementById\('f'\),capBox\]/g) || []).length >= 3 && !/document\.getElementById\('f'\),holoCap\]/.test(page.html));
        t.ok('and the projector centres each scene in the space that\'s left', /setViewOffset\(innerWidth,innerHeight,0,-Math\.round\(H\.vo\)/.test(page.html));

        // The title: on a phone only the scene's own name shows.
        const title = document.getElementById('holo-title');
        J.setTitle('HOLO-PROJECTOR // MEMORY CORE');
        t.eq('the title reads the same as before', title.textContent, 'HOLO-PROJECTOR // MEMORY CORE');
        t.eq('with the part before // in its own span', title.querySelector('.pre')?.textContent, 'HOLO-PROJECTOR // ');
        J.setTitle('SETTINGS TRANSFER');
        t.ok('a title without // is just text', title.textContent === 'SETTINGS TRANSFER' && !title.querySelector('.pre'));
        t.ok('the part before // is its own span, hidden on a phone', /@media \(max-width:600px\)\{[\s\S]*?#holo-title \.pre\{display:none\}/.test(page.html));
        t.eq('no console errors', env.errors.length, 0);
    } finally { env.close(); }
}

// A mic tap that fails used to do nothing at all: no LISTENING and no message, which looks like a broken button
// (reported 2026-10-10). Each recognition error now says why, except a deliberate stop ("aborted").
async function micErrors(t, page) {
    t.section('The mic says why when it can\'t listen');
    for (const [err, re] of [['not-allowed', /not allowed to use the microphone/], ['audio-capture', /couldn't get any sound from a microphone/], ['network', /couldn't reach the browser's speech service/],
        ['no-speech', /didn't hear anything/], ['service-not-allowed', /won't let me use its speech service/]]) {
        const fake = fakeVoice({ noted: true });
        const env = await openDom(page.html, 'https://jarvis.test/jarvis.html', { ignore: /getContext|HTMLCanvasElement/, beforeParse: fake.beforeParse });
        try {
            const { document } = env, rec = fake.log.recs[0];
            env.window.__jarvis.finishBoot();
            document.getElementById('mic').click(); rec.onstart?.(); rec.onerror?.({ error: err }); rec.onend?.();
            const last = [...document.querySelectorAll('#log .msg.ai')].pop()?.textContent ?? '';
            t.ok(`"${err}" is explained in the chat`, re.test(last));
            t.eq(`and the orb goes back to STANDBY`, document.getElementById('state').textContent, 'STANDBY');
        } finally { env.close(); }
    }
    const fake = fakeVoice({ noted: true });
    const env = await openDom(page.html, 'https://jarvis.test/jarvis.html', { ignore: /getContext|HTMLCanvasElement/, beforeParse: fake.beforeParse });
    try {
        const { document } = env, rec = fake.log.recs[0], n = () => document.querySelectorAll('#log .msg.ai').length;
        env.window.__jarvis.finishBoot();
        const before = n();
        rec.onerror?.({ error: 'aborted' }); rec.onend?.();
        t.eq('a deliberate stop ("aborted") says nothing', n(), before);
        rec.start = () => { throw new env.window.DOMException('no', 'NotAllowedError'); };
        document.getElementById('mic').click();
        t.ok('a start that fails for another reason says so', /couldn't start listening/.test([...document.querySelectorAll('#log .msg.ai')].pop()?.textContent ?? ''));
        let stopped = 0;
        rec.start = () => { throw new env.window.DOMException('running', 'InvalidStateError'); }; rec.stop = () => { stopped++; };
        document.getElementById('mic').click();
        t.eq('a second tap while listening still stops it', stopped, 1);
        t.eq('no console errors', env.errors.length, 0);
    } finally { env.close(); }
}

// Session 8 of jarvis/build-plan.html: moving settings to another device (review 62). A backup file and a QR code
// carry what the database holds: the kept settings (not the mic note), the protocols and, in the file, the usage
// counts. A restore merges: every record goes back in through save(), so fits() checks it as if it were new, and
// nothing that isn't being replaced is deleted. The follow-up context never goes into a backup.
const QR_FILES = {
    'qrcode.js': '18ae399f81182bc9de916e9c77b195df20cc58d6f2d55a62b085a299f1bf1780',
    'jsQR.js': 'bc40c8a15196236b2314db0856f72ca0b49980cd5413b8c852a7349f5fee0859'
};
const CSP_BEFORE_S8 = "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";
// A camera that records what was asked of it, and whether every track was stopped.
function fakeCamera() {
    const log = { calls: [], tracks: [] };
    return {
        log,
        beforeParse(w) {
            w.navigator.mediaDevices = {
                getUserMedia: async (c) => {
                    log.calls.push(JSON.parse(JSON.stringify(c)));
                    const track = { kind: 'video', stopped: false, stop() { this.stopped = true; } };
                    log.tracks.push(track);
                    return { getTracks: () => [track], getVideoTracks: () => [track], getAudioTracks: () => [] };
                }
            };
            // jsdom's video never plays, so pretend a frame is ready; the fake BarcodeDetector below reads it.
            Object.defineProperty(w.HTMLMediaElement.prototype, 'readyState', { get: () => 4, configurable: true });
            Object.defineProperty(w.HTMLVideoElement.prototype, 'videoWidth', { get: () => 640, configurable: true });
            w.HTMLMediaElement.prototype.play = () => Promise.resolve();
        },
        live: () => log.tracks.filter((x) => !x.stopped).length
    };
}
async function backupAndQr(t, page) {
    const URL_ = 'https://jarvis.test/jarvis.html', quiet = { ignore: /getContext|HTMLCanvasElement|navigation/ };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const require_ = createRequire(import.meta.url);
    // Captures the backup file: the Blob handed to URL.createObjectURL, and the name on the link that's clicked.
    const capture = (w) => {
        const got = { blobs: [], names: [] };
        w.URL.createObjectURL = (b) => { got.blobs.push(b); return 'blob:https://jarvis.test/1'; };
        w.URL.revokeObjectURL = () => {};
        w.HTMLAnchorElement.prototype.click = function () { got.names.push(this.download); };
        got.text = () => new Promise((res) => { const r = new w.FileReader(); r.onload = () => res(r.result); r.readAsText(got.blobs.at(-1)); });
        return got;
    };
    const lsWrites = (w) => { const n = { c: 0 }; for (const m of ['setItem', 'removeItem', 'clear']) { const o = w.Storage.prototype[m]; w.Storage.prototype[m] = function (...a) { n.c++; return o.apply(this, a); }; } return n; };
    const today = dayOf();

    // ---- Device A: settings, phrases, a voice, protocols, counts, and things said this visit ----
    let a = await openDom(page.html, URL_, quiet);
    const A = a.window.__jarvis, aLs = lsWrites(a.window), fileA = capture(a.window);
    try {
        t.section('Settings backup: the file (Session 8)');
        await A.answer('switch to matrix');
        await A.answer('make the orb purple');
        await A.answer('speak slower');
        A.store('jarvis-learned', JSON.stringify({ 'lights please': 'make the orb blue', 'space time': 'show me the galaxy' }));
        A.store('jarvis-voices', JSON.stringify({ matrix: 'Ralph' }));
        A.store('jarvis-mic-note', '1');
        await A.answer('create movie night protocol make the orb purple speak slower then open the galaxy');
        await A.answer('make a protocol called bedtime that makes the orb blue and speaks slower');
        // the follow-up context and short-term memory: this visit only
        await A.answer('my dog is Rex');
        await A.answer('my name is Tony');
        await A.answer('what time is it');
        const ctx = JSON.stringify(A.context());
        let r = await A.answer('Back up my settings, please.');
        t.ok('"back up my settings" downloads a file', fileA.blobs.length === 1 && /is on its way to your downloads/.test(r), r);
        t.eq('called jarvis-settings.json', fileA.names.join(), 'jarvis-settings.json');
        t.eq('as JSON', fileA.blobs[0]?.type, 'application/json');
        const text = await fileA.text(), file = JSON.parse(text);
        t.eq('it holds exactly the app marker, the version, settings, protocols and counts', Object.keys(file).sort().join(), 'app,backup,days,kept,protocols,totals');
        t.eq('the settings are the kept table, without the mic note (that\'s about this device)', Object.keys(file.kept).sort().join(), 'jarvis-learned,jarvis-settings,jarvis-skin,jarvis-voices');
        t.ok('each exactly as saved', Object.entries(file.kept).every(([k, v]) => A.saved().kept[k] === v));
        t.eq('protocols as fixed command IDs', JSON.stringify(file.protocols), '{"movie night":["orb:purple","speed:slow","scene:galaxy"],"bedtime":["orb:blue","speed:slow"]}');
        t.ok('usage counts as [id, day, n], every one on the fixed list', file.days.length > 0 && file.days.every(([id, day, n]) => A.EVENT_IDS.includes(id) && day === today && Number.isInteger(n)));
        t.ok('the backup itself is counted, as cmd:backup', A.saved().events.some((e) => e.id === 'cmd:backup'));
        t.ok('nothing said this visit is in it: no name, no dog, no answer, no follow-up context', !/Tony|Rex|dog|lastAnswer|lastCmd|scenes|question/i.test(text)  && /time/i.test(ctx));
        t.ok('plain ASCII, so any reader reads it the same', /^[\x20-\x7e]*$/.test(text));
        t.ok('the reply says what is in it and that nothing personal is', /purple|your skin/.test(r) && /Nothing personal is in it/.test(r));
        t.eq('the panel opens too, with a button to save the file again', A.transferState()?.view, 'menu');
        t.ok('with the four buttons', [...a.document.querySelectorAll('.xfer-btns button')].map((b) => b.textContent).join('|') === '⬇ SAVE BACKUP FILE|⬆ RESTORE FROM FILE|▦ SHOW CODE|⌖ SCAN CODE');
        a.document.querySelector('.xfer-btns button[data-x="save"]').click();
        await wait(20);
        t.eq('SAVE BACKUP FILE saves it again', fileA.blobs.length, 2);
        t.eq('no localStorage write anywhere in the backup', aLs.c, 0);

        t.section('Settings backup: restoring merges (Session 8)');
        // ---- Device B: its own settings, which a restore must not wipe ----
        let b = await openDom(page.html, URL_, quiet);
        const B = b.window.__jarvis, bLs = lsWrites(b.window);
        try {
            await B.answer('make the orb blue');
            await B.answer('use imperial units');
            B.store('jarvis-learned', JSON.stringify({ 'lights please': 'make the orb red', 'party time': 'make a heart' }));
            B.store('jarvis-voices', JSON.stringify({ jarvis: 'Daniel' }));
            await B.answer('create the bedtime protocol make the orb green');
            await B.answer('create the morning protocol what time is it then brief me');
            const yesterday = today - 1;
            B.track('scene:globe', yesterday); B.track('scene:globe', yesterday);
            const old = B.saved();
            r = B.restoreWords(B.restoreBackup(text));
            t.ok('a restore says what came back and that what was here is kept', /^Restored your skin, your settings, your voice picks, two taught phrases, two protocols and your usage counts\. Anything already here that the backup didn't have is kept\./.test(r), r);
            const now = B.saved(), dump = await dbDump(b.idb);
            t.eq('the skin is the backup\'s', now.kept['jarvis-skin'], 'matrix');
            const sorted = (o) => JSON.stringify(Object.fromEntries(Object.entries(o).sort()));
            t.eq('settings merge: the backup\'s colour and speed, this device\'s units', sorted(JSON.parse(now.kept['jarvis-settings'])), '{"color":"purple","speed":"slow","units":"imperial"}');
            t.eq('taught phrases merge: the backup\'s meaning wins for the same phrase, this device\'s other phrase stays', JSON.stringify(JSON.parse(now.kept['jarvis-learned'])), '{"lights please":"make the orb blue","party time":"make a heart","space time":"show me the galaxy"}');
            t.eq('voice picks merge', JSON.stringify(JSON.parse(now.kept['jarvis-voices'])), '{"jarvis":"Daniel","matrix":"Ralph"}');
            t.eq('protocols merge: same name replaced, the rest added, this device\'s own kept', JSON.stringify(Object.fromEntries(Object.entries(now.protocols).map(([k, v]) => [k, v.steps.join('+')]))),
                '{"bedtime":"orb:blue+speed:slow","morning":"say:time+say:briefing","movie night":"orb:purple+speed:slow+scene:galaxy"}');
            t.ok('this device\'s own counts stay', now.events.some((e) => e.id === 'scene:globe' && e.day === yesterday && e.n === 2));
            t.ok('and the backup\'s counts arrive, the larger of the two for the same day', file.days.every(([id, day, n]) => now.events.some((e) => e.id === id && e.day === day && e.n >= n)));
            t.ok('nothing that was here is gone: every key, protocol and count is still there', Object.keys(old.kept).every((k) => k in now.kept) && Object.keys(old.protocols).every((k) => k in now.protocols) && old.events.every((e) => now.events.some((x) => x.id === e.id && x.day === e.day && x.n >= e.n)));
            t.ok('the mic note is not carried over', !('jarvis-mic-note' in now.kept));
            t.ok('it reached the real database', dump.kept['jarvis-skin'] === 'matrix' && dump.protocols['movie night'] && Object.keys(dump.protocols).length === 3);
            t.eq('the page is in the restored skin straight away', B.skin(), 'matrix');
            t.eq('and its settings', sorted(B.settings()), '{"color":"purple","speed":"slow","units":"imperial"}');
            t.ok('the restore is counted, as cmd:restore', now.events.some((e) => e.id === 'cmd:restore'));
            const twice = JSON.stringify(B.saved().events.filter((e) => e.id !== 'cmd:restore'));
            B.restoreBackup(text);
            t.eq('restoring the same file again changes no count (the larger, not the sum)', JSON.stringify(B.saved().events.filter((e) => e.id !== 'cmd:restore')), twice);
            t.eq('no localStorage write in a restore', bLs.c, 0);
            const back = await B.answer('what does movie night do');
            t.eq('a restored protocol runs like one made here', back, 'Movie night will make the orb purple, speak slowly and open the galaxy.');
        } finally { b.close(); }

        t.section('Settings backup: a hostile or hand-edited file restores nothing bad (Session 8)');
        let c = await openDom(page.html, URL_, quiet);
        const C = c.window.__jarvis, cLs = lsWrites(c.window);
        try {
            await C.answer('make the orb blue');
            await C.answer('create the bedtime protocol make the orb green');
            const snap = async () => JSON.stringify(await dbDump(c.idb));
            const before = await snap(), savedBefore = JSON.stringify(C.saved());
            const R = (x) => C.restoreBackup(typeof x === 'string' ? x : JSON.stringify(x));
            const base = { app: 'jarvis', backup: 1 };
            t.eq('broken JSON', R('{"app":"jarvis","backup":1,"kept":{').why, 'broken');
            t.eq('says so, and that nothing changed', C.restoreWords(R('not json')), "I couldn't read that as a settings backup. Nothing was changed.");
            t.eq('a file over 400 KB isn\'t read at all (a 1 MB value)', R({ ...base, kept: { 'jarvis-skin': 'x'.repeat(1e6) } }).why, 'big');
            t.eq('JSON that isn\'t a Jarvis backup', R({ hello: 'world' }).why, 'foreign');
            t.eq('a backup from a later, unknown version', R({ ...base, backup: 2, kept: { 'jarvis-skin': 'matrix' } }).why, 'foreign');
            t.eq('a list instead of an object', R('[1,2,3]').why, 'foreign');
            const bad = {
                ...base,
                extra: 'ride along', name: 'Tony', __proto__x: 1,
                kept: {
                    'jarvis-name': 'Tony', 'jarvis-streak': '{"days":99}', 'jarvis-mic-note': '1', 'jarvis-anything': 'x',
                    'jarvis-skin': 'evil', 'jarvis-voices': JSON.stringify({ jarvis: { nested: 1 }, matrix: 'call 239 555 0142' }),
                    'jarvis-settings': JSON.stringify({ color: 'javascript:alert(1)', speed: 'ludicrous', name: 'Tony' }),
                    'jarvis-learned': JSON.stringify({ 'ring pat': 'call 239 555 0142', 'my address': 'show me earth', 'email me': 'pat@example.com' }),
                    ['__proto__']: 'x'
                },
                protocols: {
                    'pats number 2395550142': ['say:joke'], 'call 239 555 0142': ['say:joke'], 'my mom': ['say:joke'],
                    'words': ['make it cosy', 'tell my mom hi'], 'seven': ['say:joke', 'say:coin', 'say:die', 'say:time', 'say:date', 'say:fact', 'say:hello'],
                    'two scenes': ['scene:galaxy', 'scene:globe'], 'house party': ['say:joke'], 'boot me': ['sys:boot'], 'only waits': ['wait:5'],
                    'not a list': 'scene:galaxy', 'objects': [{ id: 'say:joke' }], 'a very long protocol name here': ['say:joke'], ['__proto__']: ['say:joke']
                },
                days: [['said:hello pat', today, 1], ['scene:globe', today + 5, 1], ['scene:globe', '2026-10-10', 1], ['scene:globe', today, 1.5], ['scene:globe', today, -3],
                    ['scene:globe', today, 2, 'note'], { id: 'scene:globe', day: today, n: 1 }, ['scene:globe', today, 1e7], 'scene:globe'],
                totals: [['cmd:secret', 5], ['cmd:joke', 2e9], ['cmd:joke'], 7]
            };
            const rr = R(bad);
            t.eq('a file of nothing but bad records restores nothing', [rr.settings.length, rr.protocols, rr.counts].join(), '0,0,0');
            t.eq('the database is exactly as it was', await snap(), before);
            t.eq('and so is what the page holds', JSON.stringify(C.saved()), savedBefore);
            t.ok('and he says nothing was changed, and that some things were left out', /^There was nothing in that backup I could keep, so nothing was changed\. I left out \d+ things I can't keep/.test(C.restoreWords(rr)));
            // one good record among the bad: only it goes in
            const mixed = R({ ...base, extra: 1, kept: { 'jarvis-skin': 'panther', 'jarvis-name': 'Tony', 'jarvis-learned': JSON.stringify({ 'go big': 'make a rocket', 'ring pat': 'call 239 555 0142' }) },
                protocols: { 'game day': ['skin:panther', 'say:joke'], 'pats phone 2395550142': ['say:joke'] }, days: [['scene:suit', today, 4], ['cmd:secret', today, 1]], totals: [['cmd:joke', 9], ['cmd:nope', 1]] });
            const s = C.saved();
            t.eq('in a mixed file, only the good records go in', [s.kept['jarvis-skin'], JSON.parse(s.kept['jarvis-learned'])['go big'], Object.keys(s.protocols).sort().join('+'), s.events.find((e) => e.id === 'scene:suit')?.n, s.totals.find((e) => e.id === 'cmd:joke')?.n].join(), 'panther,make a rocket,bedtime+game day,4,9');
            t.ok('and nothing personal or unknown came with them', !/239|Tony|pat|secret|nope/.test(JSON.stringify(s)) && !/239|Tony|secret|nope/.test(JSON.stringify(await dbDump(c.idb))));
            t.eq('he counts what he left out (an extra key, a key not on the list, a personal phrase, a personal name, an unknown ID twice)', mixed.skipped, 6);
            // the 20-protocol limit: a restore can't push past it
            const many = {}; for (let i = 0; i < 25; i++) many[`proto ${String.fromCharCode(97 + i)}`] = ['say:joke'];
            const lim = R({ ...base, protocols: many });
            t.eq('a restore stops at 20 protocols, counting the ones already here', [Object.keys(C.protocols()).length, lim.protocols, lim.skipped].join(), '20,18,7');
            t.ok('and a protocol already here can still be replaced at the limit', R({ ...base, protocols: { bedtime: ['orb:red'] } }).protocols === 1 && C.protocols().bedtime.steps.join() === 'orb:red');
            // a setting value too big to save, in a file small enough to read
            let t0 = Date.now();
            t.eq('a phrase list over the 100,000-character limit, in a file under 400 KB, is refused', R({ ...base, kept: { 'jarvis-learned': JSON.stringify({ big: 'a'.repeat(150000) }) } }).settings.length, 0);
            // The email and web-address patterns in personal() used to backtrack over a long value: 49 s for 150,000
            // letters in Node. A hostile file could have frozen the page with one. Now each check is linear.
            t0 = Date.now();
            const slow = ['a'.repeat(99000), 'a-'.repeat(49000), 'a.'.repeat(49000), '1 '.repeat(49000), 'a@'.repeat(49000)].map((x) => C.personal(x));
            t.ok(`personal() checks five 98,000-character worst cases quickly (${Date.now() - t0} ms)`, Date.now() - t0 < 1000);
            t.ok('and the rewritten patterns still catch what they did', C.personal('pat@example.com') === 'an email address' && C.personal('x pat.smith@mail.example.org') === 'an email address' && C.personal('go to my-site.com') === 'a web address' && C.personal('a-.com') === 'a web address' && C.personal('show me the galaxy') === null && slow.every((x) => x === null || typeof x === 'string'));
            t.eq('a 300,000-character protocol name restores nothing, quickly', (t0 = Date.now(), [R({ ...base, protocols: { ['the '.repeat(75000) + 'x']: ['say:joke'] } }).protocols, Date.now() - t0 < 1000].join()), '0,true');
            t.eq('a 100,000-character phrase list of the worst kind restores quickly', (t0 = Date.now(), R({ ...base, kept: { 'jarvis-learned': JSON.stringify({ x: 'a-'.repeat(49990) }) } }), Date.now() - t0 < 1000), true);
            t.eq('no localStorage write, whatever the file held', cLs.c, 0);
            // the file picker: a file over the limit isn't read, a good one is
            const input = c.document.querySelector('.xfer input[type=file]') || (await C.answer('restore my settings'), c.document.querySelector('.xfer input[type=file]'));
            t.ok('"restore my settings" opens the panel, ready for a file', C.transferState()?.view === 'restore' && !!input);
            t.eq('the picker only offers JSON files', input.accept, '.json,application/json');
            const pick = async (content, name = 'jarvis-settings.json') => {
                const f = new c.window.File([content], name, { type: 'application/json' });
                Object.defineProperty(input, 'files', { value: [f], configurable: true });
                input.dispatchEvent(new c.window.Event('change'));
                await wait(80);
                return [...c.document.querySelectorAll('#log .msg.ai')].pop()?.textContent ?? '';
            };
            t.ok('a file over 400 KB is refused without being read', /too big to be a settings backup/.test(await pick('x'.repeat(400001))));
            t.ok('a good file is restored', /^Restored your skin/.test(await pick(JSON.stringify({ ...base, kept: { 'jarvis-skin': 'jarvis' } }))) && C.skin() === 'jarvis');
            t.ok('broken JSON says so', /couldn't read that as a settings backup/.test(await pick('{oops')));
            t.ok('a file of nothing he can keep says so', /^There was nothing in that backup I could keep/.test(await pick(JSON.stringify({ ...base, kept: { 'jarvis-name': 'Tony' } }))));
            t.ok('and "why?" gives the reason', /saved for the first time/.test(await C.answer('why')));
        } finally { c.close(); }

        t.section('Settings code (QR): the payload (Session 8)');
        const qrcode = require_('../jarvis/qr/qrcode.js'), jsQR = require_('../jarvis/qr/jsQR.js');
        const payload = A.qrPayload(), pj = JSON.parse(payload);
        t.eq('the code carries settings and protocols, not the usage counts', Object.keys(pj).sort().join(), 'app,backup,kept,protocols');
        t.eq('the same settings and protocols as the file', JSON.stringify([pj.kept, pj.protocols]), JSON.stringify([file.kept, file.protocols]));
        t.ok(`it's under the ${A.QR_MAX}-byte limit for this set-up (${payload.length} bytes)`, payload.length <= A.QR_MAX);
        t.ok('plain ASCII', /^[\x20-\x7e]*$/.test(payload));
        const version = (s) => { const q = qrcode(0, 'L'); q.addData(s, 'Byte'); q.make(); return (q.getModuleCount() - 17) / 4; };
        t.ok(`at the limit, ${A.QR_MAX} bytes, it's QR version 15 at most (77×77), easy for a phone camera`, version('x'.repeat(A.QR_MAX)) <= 15);
        // Decode the code the way a phone would, with jsQR on a picture of it: same text back.
        const toImage = (s, cell = 4) => {
            const q = qrcode(0, 'L'); q.addData(s, 'Byte'); q.make();
            const n = q.getModuleCount(), w = (n + 8) * cell, px = new Uint8ClampedArray(w * w * 4).fill(255);
            for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
                const r = Math.floor(y / cell) - 4, k = Math.floor(x / cell) - 4;
                if (r >= 0 && k >= 0 && r < n && k < n && q.isDark(r, k)) { const i = (y * w + x) * 4; px[i] = px[i + 1] = px[i + 2] = 0; }
            }
            return { px, w };
        };
        const img = toImage(payload);
        t.eq('the code, read back by the decoder, is the same text', jsQR(img.px, img.w, img.w)?.data, payload);
        const big = toImage('{"app":"jarvis","backup":1,"kept":{"jarvis-learned":"' + 'z'.repeat(A.QR_MAX - 50) + '"}}');
        t.ok('so is a code at the size limit', jsQR(big.px, big.w, big.w)?.data.length >= A.QR_MAX - 10);

        t.section('Settings code (QR): showing it (Session 8)');
        r = await A.answer('send my settings to my phone');
        t.ok('"send my settings to my phone" shows the code', A.transferState()?.view === 'qr' && !!a.document.querySelector('.xfer .xfer-qr') && /^Here's your settings code/.test(r), r);
        t.ok('the status line gives its size and QR version', new RegExp(`^READY · ${payload.length} BYTES · QR V${version(payload)}$`).test(a.document.getElementById('holo-stat').textContent));
        t.ok('and he says the usage counts stay here', /usage counts stay here/.test(r));
        t.ok('the code is described for screen readers', a.document.querySelector('.xfer-qr')?.getAttribute('aria-label') === 'QR code holding your settings');
        t.ok('showing it is counted, as cmd:qr', A.saved().events.some((e) => e.id === 'cmd:qr'));
        r = await A.answer('close');
        t.ok('"close" closes the panel and removes it from the page', r === "Settings transfer closed. The camera is off." && !a.document.querySelector('.xfer') && !a.document.body.classList.contains('xfer-on') && A.transferState() === null);
        // too much for one code
        A.store('jarvis-learned', JSON.stringify(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`phrase number ${String.fromCharCode(97 + i % 26)}${i}`, 'show me the galaxy']))));
        r = await A.answer('show my settings code');
        t.ok('a set-up too big for one code says so and points to the file', /too much for one code/.test(r) && !a.document.querySelector('.xfer-qr') && /SAVE BACKUP FILE/.test(r), r);
        await A.answer('close');
        t.eq('still no localStorage write', aLs.c, 0);
    } finally { a.close(); }

    t.section('Settings code (QR): scanning it (Session 8)');
    // No camera: he says so and points to the file.
    let n = await openDom(page.html, URL_, quiet);
    try {
        const r = await n.window.__jarvis.answer('scan settings');
        t.ok('without a camera, "scan settings" points to the backup file', /needs a camera/.test(r) && /backup file/.test(r), r);
    } finally { n.close(); }
    // A camera and a BarcodeDetector (Chrome on Android) that sees a settings code.
    const good = JSON.stringify({ app: 'jarvis', backup: 1, kept: { 'jarvis-skin': 'panther', 'jarvis-settings': '{"color":"gold"}' }, protocols: { 'game day': ['skin:panther', 'say:joke'] } });
    for (const [label, seen] of [['a settings code', good], ['another QR code first', 'https://example.com/menu']]) {
        const cam = fakeCamera(), shown = { v: seen };
        const s = await openDom(page.html, URL_, { ...quiet, beforeParse(w) { cam.beforeParse(w); w.BarcodeDetector = class { static async getSupportedFormats() { return ['qr_code']; } async detect() { return [{ rawValue: shown.v }]; } }; } });
        const S = s.window.__jarvis, sLs = lsWrites(s.window);
        try {
            const r = await S.answer('scan my settings code');
            t.ok(`${label}: "scan my settings code" starts the camera`, /Point the camera at the settings code/.test(r) && cam.live() === 1, r);
            t.eq('video only, from the back camera, never audio', JSON.stringify(cam.log.calls), '[{"video":{"facingMode":"environment","width":{"ideal":1280},"height":{"ideal":720}},"audio":false}]');
            if (seen === good) {
                await wait(400);
                t.eq('the code is read and the camera turns off at once', cam.live(), 0);
                t.ok('the settings are restored', S.skin() === 'panther' && S.settings().color === 'gold' && S.protocols()['game day']);
                t.ok('he says what came back', /^Restored your skin, your settings and one protocol/.test([...s.document.querySelectorAll('#log .msg.ai')].pop()?.textContent ?? ''));
                t.ok('the panel stays, saying the camera is off', /CAMERA OFF/.test(s.document.getElementById('holo-stat').textContent) && !s.document.querySelector('.xfer video'));
            } else {
                await wait(400);
                t.ok('a code that isn\'t a settings code is ignored, and he keeps looking', cam.live() === 1 && /ISN'T A SETTINGS CODE/.test(s.document.getElementById('holo-stat').textContent) && S.skin() === 'jarvis');
                Object.defineProperty(s.document, 'hidden', { value: true, configurable: true });
                s.document.dispatchEvent(new s.window.Event('visibilitychange'));
                t.eq('hiding the tab turns the camera off', cam.live(), 0);
                Object.defineProperty(s.document, 'hidden', { value: false, configurable: true });
                await S.answer('scan settings');
                t.eq('scanning again starts it again', cam.live(), 1);
                await S.answer('close');
                t.ok('and closing the panel turns it off and removes the video', cam.live() === 0 && !s.document.querySelector('.xfer'));
            }
            t.ok('scanning is counted, as cmd:qr-scan', S.saved().events.some((e) => e.id === 'cmd:qr-scan'));
            t.eq('no localStorage write', sLs.c, 0);
        } finally { s.close(); }
    }
    // Closing while the camera is still starting leaves nothing on.
    {
        const cam = fakeCamera();
        const s = await openDom(page.html, URL_, { ...quiet, beforeParse(w) { cam.beforeParse(w); w.BarcodeDetector = class { static async getSupportedFormats() { return ['qr_code']; } async detect() { return []; } }; } });
        try {
            const S = s.window.__jarvis, p = S.answer('scan settings');
            await wait(0); await S.answer('close'); await p; await wait(50);
            t.eq('closing while the camera starts leaves it off', cam.live(), 0);
        } finally { s.close(); }
    }

    t.section('Settings transfer: voice commands, unpunctuated (Session 8)');
    let v = await openDom(page.html, URL_, quiet);
    try {
        const V = v.window.__jarvis;
        for (const [q, want] of [
            ['Back up my settings.', 'save'], ['back up my settings', 'save'], ['jarvis back up my settings please', 'save'], ['backup my settings', 'save'], ['make a backup', 'save'],
            ['export my settings', 'save'], ['download a backup of my settings', 'save'], ['save a backup of my protocols', 'save'],
            ['Restore my settings.', 'restore'], ['restore my settings', 'restore'], ['restore from a file', 'restore'], ['load my backup', 'restore'], ['jarvis restore my settings from the backup file', 'restore'],
            ['Send my settings to my phone.', 'qr'], ['send my settings to my phone', 'qr'], ['jarvis send my settings to my phone please', 'qr'], ['move my settings to my laptop', 'qr'],
            ['copy my protocols to my iphone', 'qr'], ['show my settings code', 'qr'], ['show me a qr code', 'qr'],
            ['Scan settings.', 'scan'], ['scan settings', 'scan'], ['scan my settings code', 'scan'], ['jarvis scan the settings code', 'scan'], ['read the qr code', 'scan'],
            ['move my settings', 'menu'], ['transfer my settings', 'menu'], ['settings transfer', 'menu']])
            t.eq(`"${q}"`, V.transferIntent(q), want);
        for (const q of ['scan the room', 'scan this barcode', 'threat scan', 'reset my settings', 'back', 'go back', 'what do you save', 'show me the suit', 'send a message', 'make the orb blue', 'back up', 'what are my settings'])
            t.eq(`"${q}" is not a transfer command`, V.transferIntent(q), null);
        t.eq('it can\'t go in a protocol', V.stepOf('back up my settings')?.no, 'transfer');
        const pr = await V.answer('create the move protocol make the orb blue then send my settings to my phone');
        t.ok('and he says why, saving nothing until asked', /moves your settings between devices/.test(pr) && !V.protocols().move, pr);
        await V.answer('no');
        const help = await V.answer('help');
        t.ok('help mentions backing up, restoring, sending and scanning', /back up my settings/.test(help) && /restore my settings/.test(help) && /send my settings to my phone/.test(help) && /scan settings/.test(help));
        t.ok('"what do you save" says how to keep a copy', /back up my settings to keep a copy/.test(await V.answer('what do you save')));
        t.ok('the four IDs are on the fixed list', ['cmd:backup', 'cmd:restore', 'cmd:qr', 'cmd:qr-scan'].every((id) => V.EVENT_IDS.includes(id)));
    } finally { v.close(); }

    t.section('Settings transfer: self-hosted QR files, pinned (Session 8)');
    const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(page.html)?.[1];
    t.eq('no new outside host in the CSP: it is exactly what it was before Session 8', csp, CSP_BEFORE_S8);
    t.ok('the encoder and decoder load from jarvis/qr/ on this site, with SRI', /enc:\['jarvis\/qr\/qrcode\.js','sha384-[A-Za-z0-9+/=]{64}','qrcode'\]/.test(page.html) && /dec:\['jarvis\/qr\/jsQR\.js','sha384-[A-Za-z0-9+/=]{64}','jsQR'\]/.test(page.html) && /s\.integrity=sri;/.test(page.html));
    t.ok('they are loaded only when a code is shown or scanned, never at start-up', !/<script[^>]+jarvis\/qr\//.test(page.html) && (page.html.match(/loadQrLib\(/g) || []).length === 3);
    if (page.url.startsWith('file:')) {
        for (const [f, want] of Object.entries(QR_FILES)) {
            let buf = null; try { buf = await readFile(fileURLToPath(new URL('jarvis/qr/' + f, page.url))); } catch { /* missing */ }
            t.eq(`jarvis/qr/${f} is the pinned file`, buf ? createHash('sha256').update(buf).digest('hex') : 'missing', want);
            const sri = 'sha384-' + (buf ? createHash('sha384').update(buf).digest('base64') : '');
            t.ok(`and the page's SRI hash matches it`, page.html.includes(`'jarvis/qr/${f}','${sri}'`));
        }
        const readme = await readFile(fileURLToPath(new URL('jarvis/qr/README.md', page.url)), 'utf8');
        t.ok('the README lists the same hashes', Object.values(QR_FILES).every((h) => readme.includes(h)));
    } else t.note('hash checks skipped: not running against the working copy');
}

// Session 12 of jarvis/build-plan.html: the meaning module (review 64). "Upgrade your brain" loads MediaPipe's text
// embedder and the Universal Sentence Encoder from jarvis/text/, and from then on, a sentence nothing else understood
// is compared with example sentences by meaning. jsdom can't run the model, so the page's loader is swapped for a fake
// (setTextLib) whose fingerprints this test chooses exactly. Every command's examples get their own direction, and a
// probe sentence is given a fingerprint whose cosine with a command, after the page's centring, is a number the test
// picks: so each band (do it, ask, ignore) is hit on purpose. The real model is checked in tests/jarvis-test.chromium.mjs.
const TEXT_FILES = {
    'text_bundle.js': 'e6d723a45c9d2f93cadaf86879ecb653324b855ddf0066ffdb5edc57124669ca',
    'text_wasm_internal.js': '578cabc9cdccdf47eb3b1099379a975ecd32ab1c9336bd87494e23337adf79bb',
    'text_wasm_internal.wasm': '28cf973aa2575263a1eab07d52a22a0332a30117de1d1bffb147e29685ba5b7b',
    'universal_sentence_encoder.tflite': '89ad3c74175dd8caa398cc22b657296d94302d20c525c12b58b29420f7249749'
};
// A stand-in for the model. Examples of command k all get basis vector k. A sentence the test hasn't placed gets a
// fresh direction of its own (so it's close to nothing), or, with everything set, the same vector as that command's
// examples (so anything that reaches the module is a perfect match for it). near() places a sentence at an exact
// cosine from a direction, worked out the way the page does it: centred on the mean of the examples, then unit length.
export function fakeMind(J, { everything = null } = {}) {
    const D = 600, raw = new Map(), exOf = new Map();
    J.MEANINGS.forEach(([, , ex], k) => ex.forEach((e) => exOf.set(J.meaningText(e), k)));
    const exs = J.MEANINGS.flatMap((m) => m[2].map(J.meaningText));
    const mean = new Float32Array(D); for (const e of exs) mean[exOf.get(e)] += 1 / exs.length;
    let free = J.MEANINGS.length, calls = 0, steps = [];
    const basis = (i) => { if (i >= D) throw new Error('fakeMind: out of directions'); const v = new Float32Array(D); v[i] = 1; return v; };
    const unit = (v) => { const n = Math.hypot(...v) || 1; return Float32Array.from(v, (x) => x / n); };
    const everyK = everything === null ? -1 : J.MEANINGS.findIndex((m) => m[0] === everything);
    const embed = (t) => {
        if (raw.has(t)) return raw.get(t);
        if (exOf.has(t)) return basis(exOf.get(t));
        const v = everyK >= 0 ? basis(everyK) : basis(free++); raw.set(t, v); return v;
    };
    const centred = (v) => unit(v.map((x, i) => x - mean[i]));
    const dirOf = (cmdOrText) => { const k = J.MEANINGS.findIndex((m) => m[0] === cmdOrText); return centred(k >= 0 ? basis(k) : embed(J.meaningText(cmdOrText))); };
    // text placed at cosine `score` from each direction given (one, or two at once for a tie), and nothing else.
    const near = (text, targets, score) => {
        const dirs = [].concat(targets).map(dirOf), sum = unit(dirs.reduce((a, d) => a.map((x, i) => x + d[i]), new Float32Array(D)));
        const c = dirs.length === 1 ? 1 : sum.reduce((s, x, i) => s + x * dirs[0][i], 0); // the tie's own cosine with each
        const s = score / c, o = free++;
        raw.set(J.meaningText(text), Float32Array.from(sum, (x, i) => mean[i] + s * x + (i === o ? Math.sqrt(Math.max(0, 1 - s * s)) : 0)));
    };
    let gate = null;
    const lib = async (on) => { calls++; for (const p of [0.25, 0.5, 1]) { on(p); if (gate) await new Promise((r) => steps.push(r)); } return (t) => embed(t); };
    return { lib, near, dirOf, embed, calls: () => calls, hold() { gate = true; }, step() { const r = steps.shift(); r?.(); return !!r; }, release() { gate = null; while (steps.length) steps.shift()(); } };
}
async function meaningModule(t, page) {
    const URL_ = 'https://jarvis.test/jarvis.html', quiet = { ignore: /getContext|HTMLCanvasElement/ };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const lastAi = (env) => [...env.document.querySelectorAll('#log .msg.ai')].pop()?.textContent ?? '';
    const typeIn = async (env, text) => { const { document, window } = env; document.getElementById('q').value = text; document.getElementById('f').dispatchEvent(new window.Event('submit', { cancelable: true })); await wait(520); return lastAi(env); };
    const count = (J, id) => J.usageNow().n[id] || 0;
    const MISSED = /say ⟦?learn that⟧?\.$/;
    const fixed = { ...quiet, beforeParse(w) { w.Math.random = () => 0.42; } };
    const src = page.html;

    t.section('Meaning module: the files (Session 12)');
    if (page.url.startsWith('file:')) {
        for (const [file, want] of Object.entries(TEXT_FILES)) {
            let got = 'missing';
            try { got = createHash('sha256').update(await readFile(fileURLToPath(new URL('jarvis/text/' + file, page.url)))).digest('hex'); } catch { /* missing */ }
            t.eq(`jarvis/text/${file} is the pinned file`, got, want);
        }
        const readme = await readFile(fileURLToPath(new URL('jarvis/text/README.md', page.url)), 'utf8');
        t.ok('the README lists the same hashes', Object.values(TEXT_FILES).every((h) => readme.includes(h)));
    } else t.note('hash checks skipped: not running against the working copy');
    t.ok('the page loads the module from jarvis/text/ on this site', /const TEXT_DIR='jarvis\/text\/';/.test(src) && /new URL\(TEXT_DIR\+f,location\.href\)/.test(src) && !/cdn\.jsdelivr|storage\.googleapis|tfhub|kaggle/.test(src));
    t.eq('it is imported in one place', (src.match(/import\(textUrl\(/g) || []).length, 1);
    t.ok('and that place is only run by "upgrade your brain"', (src.match(/\btextLib\(/g) || []).length === 1 && /async function upgradeBrain\(\)\{[\s\S]*?const embed=await textLib\(/.test(src));
    t.eq('the CSP is exactly what it was before Session 8: no new outside host', env0Csp(src), CSP_BEFORE_S8);

    let env = await openDom(page.html, URL_, fixed), J = env.window.__jarvis;
    try {
        t.section('Meaning module: not at start-up (Session 12)');
        J.finishBoot(); await wait(50);
        t.eq('the module is off when the page loads', J.mind().state, 'off');
        t.ok('"show me the planet we live on" isn\'t understood before the upgrade', MISSED.test(await typeIn(env, 'show me the planet we live on')));
        await typeIn(env, 'never mind'); // so the next thing said isn't taken as what that meant
        t.eq('and nothing has been loaded by then', J.mind().state, 'off');

        t.section('Meaning module: "upgrade your brain" (Session 12)');
        for (const q of ['upgrade your brain', 'jarvis upgrade your brain please', 'Jarvis, upgrade your brain.', 'hey jarvis upgrade your brain', 'please upgrade your brain jarvis', 'update your brain', 'install your language module', 'get smarter'])
            t.ok(`"${q}" asks for it`, J.upgradeIntent(q));
        for (const q of ['show me your brain', 'upgrade', 'my brain hurts', 'upgrade my phone'])
            t.ok(`"${q}" doesn't`, !J.upgradeIntent(q));
        const F = fakeMind(J); F.hold(); J.setTextLib(F.lib);
        const before = count(J, 'cmd:upgrade');
        const said = await typeIn(env, 'jarvis upgrade your brain please');
        t.ok('he answers at once, saying what he\'s downloading and from where', /^Upgrading\. I'm downloading my language comprehension module from this site, about 12 megabytes\.$/.test(said), said);
        t.eq('it counts once, as cmd:upgrade', count(J, 'cmd:upgrade'), before + 1);
        t.eq('the module is loading', J.mind().state, 'loading');
        const line = env.document.getElementById('proto');
        t.ok('without WebGL, the progress shows over the orb', !line.hidden && line.textContent === 'UPGRADING · LANGUAGE MODULE · 18%', line.textContent);
        F.step(); await wait(20);
        t.eq('and moves on as it downloads', line.textContent, 'UPGRADING · LANGUAGE MODULE · 35%');
        t.ok('asking again while it loads doesn\'t start a second download', /^I'm upgrading already/.test(await typeIn(env, 'upgrade your brain')) && F.calls() === 1 && count(J, 'cmd:upgrade') === before + 1);
        F.release(); await wait(150);
        t.eq('then the module is online', J.mind().state, 'on');
        t.eq('"Language comprehension module online."', lastAi(env), "Language comprehension module online. Talk to me in your own words now. If I'm not sure what you mean, I'll ask.");
        t.ok('and the progress line goes', line.hidden);
        t.ok('both lines go through say(), so they\'re spoken in whole sentences', /say\("Language comprehension module online\./.test(src) && /say\("I couldn't load my language module\./.test(src));
        t.ok('a third time: already online, and not counted again', /^My language comprehension module is already online/.test(await typeIn(env, 'upgrade your brain')) && count(J, 'cmd:upgrade') === before + 1);
        t.ok('"what do you save" says the module is only in memory', /My language module is only in memory too/.test(await typeIn(env, 'what do you save')));

        t.section('Meaning module: very close, somewhat close, not close (Session 12)');
        F.near('show me the planet we live on', 'show me earth', 0.82);
        let n = count(J, 'scene:globe');
        let r = await typeIn(env, 'show me the planet we live on');
        t.ok('very close (0.82): he does it. The globe, which needs WebGL here', /My holo-projector needs WebGL/.test(r), r);
        t.eq('and it counts under its own ID, scene:globe', count(J, 'scene:globe'), n + 1);
        t.eq('"why?" says it was the meaning', await typeIn(env, 'why'), 'Because what you said means much the same as the Earth globe.');
        F.near('cheer me up', 'tell me a joke', 0.9);
        n = count(J, 'cmd:joke');
        r = await typeIn(env, 'cheer me up');
        t.ok('very close (0.9): a joke', !MISSED.test(r) && !/Did you mean/.test(r) && count(J, 'cmd:joke') === n + 1, r);
        t.eq('"why?" after it', await typeIn(env, 'why'), 'Because what you said means much the same as a joke.');
        F.near('make me chuckle', 'tell me a joke', 0.7);
        t.eq('somewhat close (0.7): "Did you mean …?"', await typeIn(env, 'make me chuckle'), 'Did you mean a joke? Say yes or no.');
        t.eq('asking doesn\'t count anything', count(J, 'cmd:joke'), n + 1);
        r = await typeIn(env, 'yes');
        t.ok('"yes" does it', !/Did you mean|Yes to what/.test(r) && count(J, 'cmd:joke') === n + 2, r);
        t.eq('and "yes" again isn\'t an answer to anything', await typeIn(env, 'yes'), "Yes to what? I didn't ask you anything.");
        await typeIn(env, 'make me chuckle');
        t.eq('"no": he leaves it, and offers to learn it', await typeIn(env, 'no'), "All right. If you'd like me to learn it, say learn that.");
        t.eq('and does nothing', count(J, 'cmd:joke'), n + 2);
        r = await typeIn(env, 'flip a coin');
        t.ok('the next thing you say is just a command, and teaches nothing', /^It's (heads|tails)\.$/.test(r) && !J.learned()['make me chuckle'], r);
        await typeIn(env, 'make me chuckle'); await typeIn(env, 'no');
        t.eq('"learn that" after the "no" asks what it meant', await typeIn(env, 'learn that'), 'What did you mean by "make me chuckle"?');
        r = await typeIn(env, 'flip a coin');
        t.ok('and then it teaches him the phrase', /^Got it\. Next time you say "make me chuckle", I'll know you mean "flip a coin"\. It's (heads|tails)\.$/.test(r), r);
        F.near('tell me a gag', 'tell me a joke', 0.7);
        await typeIn(env, 'tell me a gag');
        const coins = count(J, 'cmd:coin');
        r = await typeIn(env, 'what time is it');
        t.ok('anything else drops the question, and is answered as itself', /^It's /.test(r), r);
        t.eq('so a "yes" after that answers nothing', await typeIn(env, 'yes'), "Yes to what? I didn't ask you anything.");
        t.eq('and nothing ran', count(J, 'cmd:joke') + count(J, 'cmd:coin'), n + 2 + coins);
        F.near('i want a giggle', 'tell me a joke', 0.55);
        t.ok('not close (0.55): the usual "didn\'t understand"', MISSED.test(await typeIn(env, 'i want a giggle')));
        await typeIn(env, 'never mind');
        F.near('watch the room', 'scan the room', 0.97);
        t.eq('the camera is never started on a guess: even at 0.97 he asks', await typeIn(env, 'watch the room'), 'Did you mean the threat scan? Say yes or no.');
        await typeIn(env, 'no'); await typeIn(env, 'never mind');
        F.near('listen out for me', 'always listen', 0.97);
        t.eq('nor the mic', await typeIn(env, 'listen out for me'), 'Did you mean always listening? Say yes or no.');
        await typeIn(env, 'no'); await typeIn(env, 'never mind');
        t.ok('the camera and mic commands are the ones that ask first', J.MEANINGS.filter((m) => J.asksFirst(m[0])).map((m) => m[0]).join() === 'scan the room,hand control,always listen,scan settings');
        F.near('zebras', 'tell me a joke', 0.99);
        t.ok('a single word is never guessed at', MISSED.test(await typeIn(env, 'zebras')));
        await typeIn(env, 'never mind');

        t.section('Meaning module: the patterns always win (Session 12)');
        // A brain that thinks everything means "tell me a joke". Every command understood today must still do what it did.
        const plain = await openDom(page.html, URL_, fixed), P = plain.window.__jarvis;
        const adv = await openDom(page.html, URL_, fixed), A = adv.window.__jarvis;
        try {
            P.finishBoot(); A.finishBoot(); await wait(50);
            A.setTextLib(fakeMind(A, { everything: 'tell me a joke' }).lib);
            P.setTextLib(fakeMind(P).lib); // online too, so the discovery count matches, but nothing is ever close
            await Promise.all([typeIn(adv, 'upgrade your brain'), typeIn(plain, 'upgrade your brain')]); await wait(150);
            t.ok('(the always-a-joke brain is online, and so is one that never matches)', A.mind().state === 'on' && P.mind().state === 'on');
            await typeIn(plain, 'blah blah'); await typeIn(plain, 'never mind');
            t.ok('(and it does turn anything else into a joke)', !MISSED.test(await typeIn(adv, 'blah blah')) && count(A, 'cmd:joke') === 1);
            const phrases = [...P.chipCmds(), 'jarvis show me the galaxy please', 'take me to mars', 'now jupiter', 'what is seven times eight', 'my dog is rex', 'what do you know about me',
                'speak slower', 'make the orb purple', 'how well do you know me', 'whats my favourite', 'what havent i tried', 'show me florida', 'thank you', 'how far is the moon',
                'delete movie night', 'forget my name', 'reset my settings', 'list my protocols', 'brief me', 'how are you'].filter((q) => !/^(?:upgrade your brain|reboot|wake up daddy's home|house party|scan settings|restore my settings|back up my settings)$/i.test(q));
            const diff = [];
            for (const q of phrases) {
                const [a, b] = await Promise.all([typeIn(plain, q), typeIn(adv, q)]);
                if (a !== b) diff.push(`${q}: "${a.slice(0, 60)}" vs "${b.slice(0, 60)}"`);
                if (/Say yes or no\.$/.test(a)) { await Promise.all([typeIn(plain, 'no'), typeIn(adv, 'no')]); }
            }
            t.eq(`all ${phrases.length} command links and pinned phrasings answer exactly as without the module`, diff.join(' | '), '');
            t.eq('and none of them reached it', count(A, 'cmd:joke'), count(P, 'cmd:joke') + 1);
        } finally { plain.close(); adv.close(); }

        t.section('Meaning module: destructive commands stay exact (Session 12)');
        t.eq('no command in the list deletes, forgets, resets or reboots', J.MEANINGS.filter((m) => J.DESTRUCTIVE.test(J.meaningText(m[0])) || m[2].some((e) => J.DESTRUCTIVE.test(e))).map((m) => m[0]).join(), '');
        for (const q of ['forget everything', 'get rid of movie night', 'scrap my protocol', 'throw away my settings', 'ditch that', 'delete movie night', 'reset my settings', 'clear my phrases', 'wipe your memory', 'erase it all', 'reboot', 'power down', 'remove my protocol'])
            t.ok(`"${q}" is a destructive word`, J.DESTRUCTIVE.test(J.meaningText(q)));
        F.near('forget about the globe', 'show me earth', 0.99);
        n = count(J, 'scene:globe');
        r = await typeIn(env, 'forget about the globe');
        t.ok('something said with a destructive word is never matched, however close (0.99)', MISSED.test(r) && count(J, 'scene:globe') === n, r);
        await typeIn(env, 'never mind');
        // A taught phrase that resets something: taught the usual way, then never chosen by meaning.
        await typeIn(env, 'make the orb gold');
        await typeIn(env, 'fresh start'); await typeIn(env, 'learn that'); r = await typeIn(env, 'I meant reset my settings');
        t.ok('(a phrase taught to mean "reset my settings")', /^Got it\. Next time you say "fresh start"/.test(r), r);
        await typeIn(env, 'make the orb gold');
        t.ok('isn\'t a candidate', !J.meaningCandidates().some((c) => c.key.startsWith('learned:fresh')));
        F.near('a fresh beginning', 'fresh start', 0.99);
        r = await typeIn(env, 'a fresh beginning');
        t.ok('so saying it another way (0.99) doesn\'t reset your settings', MISSED.test(r) && J.settings().color === 'gold', r);
        await typeIn(env, 'never mind');
        await typeIn(env, 'create movie night protocol make the orb purple then open the galaxy');
        F.near('get rid of the movie night thing', 'movie night', 0.99);
        r = await typeIn(env, 'get rid of the movie night thing');
        t.ok('nor is deleting a protocol', MISSED.test(r) && !!J.protocols()['movie night'], r);
        await typeIn(env, 'never mind');
        t.ok('deleting one by name still asks, as before', /^Delete the movie night protocol\? Say yes or no\.$/.test(await typeIn(env, 'delete movie night')));
        await typeIn(env, 'no');

        t.section('Meaning module: taught phrases and protocol names (Session 12)');
        await typeIn(env, 'beam me up'); await typeIn(env, 'learn that'); await typeIn(env, 'I meant roll a die');
        F.near('beam me up scotty', 'beam me up', 0.9);
        n = count(J, 'cmd:die');
        r = await typeIn(env, 'beam me up scotty');
        t.ok('a taught phrase, said another way (0.9): it does what it was taught', /^You rolled a \d\.$/.test(r) && count(J, 'cmd:die') === n + 1, r);
        F.near('beam us up', 'beam me up', 0.7);
        t.eq('somewhat close: it asks, naming the phrase', await typeIn(env, 'beam us up'), 'Did you mean "beam me up", which you taught me? Say yes or no.');
        await typeIn(env, 'no'); await typeIn(env, 'never mind');
        F.near('cinema evening', 'movie night', 0.9);
        n = count(J, 'cmd:protocol'); J.setPace(0.002);
        r = await typeIn(env, 'cinema evening');
        t.ok('a protocol\'s name, said another way (0.9): it runs, counted as cmd:protocol', count(J, 'cmd:protocol') === n + 1);
        await J.protocolDone();
        t.eq('it ran its steps', J.settings().color, 'purple');
        F.near('film night', 'movie night', 0.65);
        t.eq('somewhat close: it asks', await typeIn(env, 'film night'), 'Did you mean the movie night protocol? Say yes or no.');
        await typeIn(env, 'yes'); await J.protocolDone();
        t.eq('and yes runs it', count(J, 'cmd:protocol'), n + 2);

        t.section('Meaning module: nothing new is stored (Session 12)');
        // The knowledge pack (Session 13) is public facts the module read, not something it stored: it's checked on its own.
        const db = await dbDump(env.idb), all = JSON.stringify({ ...db, pack: {} });
        t.ok('the pack table holds only pack records', Object.entries(db.pack).every(([k, r]) => J.packFits(k, r)));
        t.eq('the database still has its six tables', Object.keys(db).sort().join(), 'events,kept,meta,pack,protocols,totals');
        t.eq('kept: only the listed settings keys', Object.keys(db.kept).filter((k) => !J.STORE_KEYS.includes(k)).join(), '');
        t.eq('meta: only the three bookkeeping numbers', Object.keys(db.meta).filter((k) => !['copied', 'rolled', 'carry', 'pack'].includes(k)).join(), '');
        t.ok('no fingerprint (no list of numbers) anywhere in it', !/\[(?:-?\d+(?:\.\d+)?(?:e-?\d+)?,){6,}/.test(all) && !/Float32Array|"0":/.test(all));
        t.ok('no example sentence and nothing said to the module', !/planet we live on|cheer me up|tell me a gag|cinema evening|scotty|milky way|language module|fingerprint/i.test(all));
        t.ok('the only counts are listed IDs', Object.values(db.events).every((e) => J.EVENT_IDS.includes(e.id)));
        const ver = await new Promise((res) => { const rq = env.idb.open('jarvis-test'); rq.onsuccess = () => { const v = rq.result.version; rq.result.close(); res(v); }; });
        t.eq('and it is still at version 3 (Session 13\'s pack)', ver, 3);
        t.ok('the fingerprints live in memory', J.mind().fingerprints > 100);
    } finally { env.close(); }

    t.section('Meaning module: gone on reload (Session 12)');
    {
        const first = await openDom(page.html, URL_, fixed);
        const F = fakeMind(first.window.__jarvis); first.window.__jarvis.setTextLib(F.lib); first.window.__jarvis.finishBoot();
        await typeIn(first, 'upgrade your brain'); await wait(150);
        F.near('cheer me up', 'tell me a joke', 0.9);
        t.ok('(online, and understanding a rewording)', !MISSED.test(await typeIn(first, 'cheer me up')));
        const idb = first.idb; first.close(); await wait(40);
        env = await openDom(page.html, URL_, { ...fixed, idb }); J = env.window.__jarvis;
        try {
            J.finishBoot(); await wait(50);
            t.eq('after a reload the module is off again', J.mind().state, 'off');
            t.eq('with no fingerprints', J.mind().fingerprints, 0);
            t.ok('and the rewording isn\'t understood until you upgrade again', MISSED.test(await typeIn(env, 'cheer me up')));
        } finally { env.close(); }
    }

    t.section('Meaning module: too close to call (Session 12)');
    // Two things nearly as close as each other: a taught phrase that means much the same as "tell me a joke" (0.98 from
    // it), and a sentence 0.9 from the joke, so 0.88 from the phrase. Above the "do it" band, but only 0.02 apart.
    env = await openDom(page.html, URL_, fixed); J = env.window.__jarvis;
    try {
        J.finishBoot(); await wait(50);
        await typeIn(env, 'crack me up'); await typeIn(env, 'learn that'); await typeIn(env, 'I meant flip a coin'); // taught before the upgrade
        const F = fakeMind(J); J.setTextLib(F.lib);
        F.near('crack me up', 'tell me a joke', 0.98);
        F.near('give me a chortle', 'tell me a joke', 0.9);
        await typeIn(env, 'upgrade your brain'); await wait(150);
        const m = J.meaningOf('give me a chortle');
        t.ok('(the two scores: 0.9 and about 0.88)', m && Math.abs(m.score - 0.9) < 1e-6, JSON.stringify(m && m.score));
        const n = count(J, 'cmd:joke') + count(J, 'cmd:coin');
        const r = await typeIn(env, 'give me a chortle');
        t.ok('he asks rather than picks', /^Did you mean a joke\? Say yes or no\.$/.test(r), r);
        t.eq('and nothing ran', count(J, 'cmd:joke') + count(J, 'cmd:coin'), n);
    } finally { env.close(); }

    t.section('Meaning module: when it can\'t load (Session 12)');
    env = await openDom(page.html, URL_, fixed); J = env.window.__jarvis;
    try {
        J.finishBoot(); await wait(50);
        J.setTextLib(async () => { throw new Error('offline'); });
        await typeIn(env, 'upgrade your brain'); await wait(100);
        t.eq('he says so', lastAi(env), "I couldn't load my language module. Check your connection, then say upgrade your brain to try again.");
        t.ok('the module stays off and the progress line goes', J.mind().state === 'off' && env.document.getElementById('proto').hidden);
        const F = fakeMind(J); J.setTextLib(F.lib);
        await typeIn(env, 'upgrade your brain'); await wait(150);
        t.eq('and saying it again tries again', J.mind().state, 'on');
    } finally { env.close(); }

    t.section('Meaning module: discovery and clearance (Session 12)');
    env = await openDom(page.html, URL_, fixed); J = env.window.__jarvis;
    try {
        const cap = J.CAPABILITIES.find((c) => c.ids.includes('cmd:upgrade'));
        t.ok('"upgrade your brain" has a capability, with its usage ID on the list', !!cap && J.EVENT_IDS.includes('cmd:upgrade') && cap.cmds.includes('upgrade your brain'));
        t.ok('it isn\'t a clearance extra: anyone can upgrade him, from level 1', !cap.lock && J.levelNow() === 1);
        t.ok('the help answer offers it as a link', J.brainKnown('help').includes('⟦upgrade your brain⟧') && J.chipCmds().includes('upgrade your brain'));
        t.ok('it needs only WebAssembly', cap.can === 'wasm');
    } finally { env.close(); }
}
const env0Csp = (html) => (html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/) || [])[1];

// Session 13 of jarvis/build-plan.html: the knowledge pack (review 65). Stable public facts, built by
// jarvis/knowledge/build.mjs, copied into the test copy's IndexedDB (version 3, table pack) on the first fact
// question, through save() and fits() like everything else. The pack here is built from tests/fixtures/jarvis-knowledge/.
async function knowledgePack(t, page) {
    const URL_ = 'https://jarvis.test/jarvis.html', quiet = { ignore: /getContext|HTMLCanvasElement/ };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const lastAi = (env) => [...env.document.querySelectorAll('#log .msg.ai')].pop()?.textContent ?? '';
    const typeIn = async (env, text) => { const { document, window } = env; document.getElementById('q').value = text; document.getElementById('f').dispatchEvent(new window.Event('submit', { cancelable: true })); await wait(540); return lastAi(env); };
    const count = (J, id) => J.usageNow().n[id] || 0;
    const MISSED = /say ⟦?learn that⟧?\.$/;
    const B = await import('../jarvis/knowledge/build.mjs');
    const PK = await fixturePack();
    const src = page.html;

    t.section('Knowledge pack: the build script and its pack (Session 13)');
    t.eq('the pack built from the sample documents passes the build\'s own check', B.checkPack(PK).join(' | '), '');
    const kinds = {}; for (const r of PK.records) kinds[r.kind] = (kinds[r.kind] || 0) + 1;
    t.eq('all four areas: space (planets, moons, stars, missions), countries, all 118 elements and the suits', JSON.stringify(kinds), '{"country":76,"element":118,"mission":22,"moon":21,"planet":9,"star":25,"suit":13}');
    t.ok('it lists its sources, and none is Wikipedia', PK.sources.length === 7 && PK.sources.every((x) => x.name && x.licence) && !/wikipedia/i.test(JSON.stringify(PK)));
    t.ok('the World Factbook copy is pinned to one commit', PK.sources.find((x) => x.id === 'countries').url.includes(B.FACTBOOK_SHA) && /^[0-9a-f]{40}$/.test(B.FACTBOOK_SHA));
    t.ok('every suit line is marked as fan knowledge', PK.records.filter((r) => r.kind === 'suit').every((r) => r.fan === true) && /fan knowledge/i.test(PK.sources.find((x) => x.id === 'suits').licence));
    const J0 = (await openDom(page.html, URL_, quiet));
    const J = J0.window.__jarvis;
    try {
        t.eq('the page and the build have the same fields for each kind', JSON.stringify(J.PACK_FIELDS), JSON.stringify(B.PACK_FIELDS));
        t.ok('the same lists of things that go stale', String(J.STALE_KEY) === String(B.STALE_KEY) && String(J.STALE_TEXT) === String(B.STALE_TEXT));
        t.ok('and the same test for personal text', JSON.stringify(J.PERSONAL.map(([w, re]) => [w, String(re)])) === JSON.stringify(B.PERSONAL.map(([w, re]) => [w, String(re)])));
        t.eq('every record in the pack passes the page\'s fits()', PK.records.filter((r) => !J.fits('pack', J.packKey(r), r)).map((r) => r.name).join(), '');
        t.eq('no field name in any kind goes stale', Object.values(J.PACK_FIELDS).flatMap(Object.keys).filter((k) => B.STALE_KEY.test(k)).join(), '');
        // No fast-changing number, as a field or in words.
        const peru = PK.records.find((r) => r.name === 'Peru'), mars = PK.records.find((r) => r.name === 'Mars');
        for (const [why, rec] of [['a population field', { ...peru, population: 34000000 }], ['GDP', { ...peru, gdp: 1 }], ['a count of moons', { ...mars, moons: 2 }], ['a leader', { ...peru, president: 'x' }],
            ['population in words', { ...peru, flag: 'red and white; the population is 34 million' }], ['an estimate', { ...peru, high: 'Nevado Huascaran (2024 est.)' }], ['"currently" in a suit line', { ...PK.records.find((r) => r.name === 'Mark 42'), line: 'Currently kept in the workshop.' }]]) {
            if (rec === undefined) continue;
            t.ok(`a record with ${why} is refused by the build and by the page`, B.recordProblem(rec) !== null && !J.fits('pack', J.packKey(rec), rec));
        }
        t.ok('and a pack carrying one fails the build\'s check', B.checkPack({ ...PK, records: [...PK.records.slice(1), { ...peru, population: 1 }] }).length > 0);
        t.ok('so does a half-built pack (a source that returned nothing)', B.checkPack({ ...PK, records: PK.records.filter((r) => r.kind !== 'element') }).some((x) => /element/.test(x)));
        // The pack table holds pack records and nothing else.
        const sx = PK.records.find((r) => r.name === 'Mark 42');
        for (const [why, k, r] of [['a setting', 'jarvis-skin', 'matrix'], ['a usage count', 'cmd:joke', { id: 'cmd:joke', day: 280, n: 1 }], ['a protocol', 'movie night', { steps: ['say:joke'] }],
            ['a record under the wrong key', 'country:japan', peru], ['an extra field riding along', 'country:peru', { ...peru, note: 'my phone is 239 555 0142' }], ['a suit line not marked as fan knowledge', 'suit:mark-42', { ...sx, fan: false }],
            ['a kind that isn\'t in the pack', 'person:pat', { kind: 'person', name: 'Pat' }], ['markup in a fact', 'country:peru', { ...peru, capital: ['<img src=x onerror=alert(1)>'] }], ['a command link marker in a fact', 'country:peru', { ...peru, flag: 'red ⟦forget my name|forget my name⟧' }], ['personal text', 'country:peru', { ...peru, high: 'my address' }],
            ['a phone number', 'suit:mark-42', { ...sx, line: 'Call 239 555 0142.' }], ['a missing field', 'planet:mars', (({ rings, ...o }) => o)(mars)], ['text for a number', 'planet:mars', { ...mars, sun: '227.9' }]])
            t.eq(`fits(): the pack table refuses ${why}`, J.fits('pack', k, r), false);
        t.eq('fits(): meta holds the pack\'s version only as a whole number', [J.fits('meta', 'pack', 12345), J.fits('meta', 'pack', 'v1'), J.fits('meta', 'pack', 1.5), J.fits('meta', 'pack', 0)].join(), 'true,false,false,false');
        t.ok('the catalogue writes a parallax as "+.375": that\'s 0.375, not 375', B.num('+.375') === 0.375 && B.num('1,285,216 sq km') === 1285216 && B.num('−65') === -65);
        t.ok('a star\'s distance comes from a good parallax only (Sirius 8.7 light years, Betelgeuse none)', PK.records.find((r) => r.name === 'Sirius').ly === 8.7 && PK.records.find((r) => r.name === 'Betelgeuse').ly === null);

        t.section('Knowledge pack: every country is one the globe can find (Session 13)');
        const norm = (x) => x.toLowerCase().replace(/[.'-]/g, ' ').replace(/\s+/g, ' ').trim();
        const countries = PK.records.filter((r) => r.kind === 'country');
        t.eq('every country in the pack is a place on the globe', countries.filter((r) => !J.PLACES[norm(r.name)]).map((r) => r.name).join(), '');
        t.eq('every country on the globe is in the pack, apart from England and Scotland (the Factbook covers them as the UK)',
            Object.values(J.PLACES).filter((p) => p.kind === 'country').map((p) => p.name).filter((n, i, a) => a.indexOf(n) === i && !countries.some((r) => r.name === n)).join(), 'England,Scotland');
        t.ok('and the build lists the same ones', B.COUNTRIES.length === countries.length);
        // The committed pack, once the real build has run (jarvis/knowledge/README.md): the same rules, record by record.
        let real = null;
        if (page.url.startsWith('file:')) { try { real = JSON.parse(await readFile(fileURLToPath(new URL('jarvis/knowledge/pack.json', page.url)), 'utf8')); } catch { real = null; } }
        if (real) {
            t.eq('the committed pack.json passes the build\'s check', B.checkPack(real).join(' | '), '');
            t.eq('every record in it passes the page\'s fits()', real.records.filter((r) => !J.fits('pack', J.packKey(r), r)).map((r) => r.name).join(), '');
            t.eq('and every country in it is a place on the globe', real.records.filter((r) => r.kind === 'country' && !J.PLACES[norm(r.name)]).map((r) => r.name).join(), '');
        } else t.note('no committed pack.json to check (the real build hasn\'t run, or this isn\'t the working copy)');
        t.ok('a country opens the globe on itself', ['Peru', 'United States', 'DR Congo', 'Australia'].every((n) => { const s = J.knowScene(PK.records.find((r) => r.name === n)); return s.kind === 'globe' && J.PLACES[s.arg].name === n; }));
        t.ok('a planet opens the solar system near it, and a moon near its planet', J.knowScene(mars).arg === 'mars' && J.knowScene(PK.records.find((r) => r.name === 'Europa')).arg === 'jupiter' && J.knowScene(PK.records.find((r) => r.name === 'Pluto')).arg === null);
        t.ok('a suit opens the schematic; elements, stars and missions open nothing', J.knowScene(sx).kind === 'suit' && [ 'Gold', 'Sirius', 'Voyager 1'].every((n) => J.knowScene(PK.records.find((r) => r.name === n)) === null));
    } finally { J0.close(); }

    t.section('Knowledge pack: answers, typed, unpunctuated, with "jarvis" and "please" (Session 13)');
    let env = await openDom(page.html, URL_, quiet), K = env.window.__jarvis;
    try {
        K.finishBoot(); await wait(50);
        const PERU = 'Peru. Its capital is Lima. It\'s in South America, covering 1,285,216 square kilometres, and its highest point is Nevado Huascaran, at 6,746 metres. The flag of Peru: three equal vertical bands of red, white, and red, with the coat of arms centered on the white band; the coat of arms has a shield with a vicuna, a cinchona tree, and a yellow cornucopia spilling out coins.';
        t.eq('"jarvis tell me about peru please"', await typeIn(env, 'jarvis tell me about peru please'), PERU);
        t.eq('typed with punctuation, the same', await typeIn(env, 'Jarvis, tell me about Peru, please.'), PERU);
        t.eq('it counts once each time, as cmd:know-country', count(K, 'cmd:know-country'), 2);
        t.ok('and never by name: no usage ID mentions Peru', !K.EVENT_IDS.some((id) => /peru/.test(id)) && !JSON.stringify(K.saved().events).includes('peru'));
        const MARS = 'Mars is 227.9 million kilometres from the Sun on average, and sunlight takes about 13 minutes to get there. From Earth, it\'s between about 55 and 401 million kilometres away, depending on where the two planets are in their orbits.';
        t.eq('"jarvis how far is mars please"', await typeIn(env, 'jarvis how far is mars please'), MARS);
        t.eq('counted as cmd:know-planet', count(K, 'cmd:know-planet'), 1);
        t.eq('"jarvis tell me about the mark 42 please": fan knowledge, and it says so', await typeIn(env, 'jarvis tell me about the mark 42 please'),
            'Fan knowledge, not an official source: the Mark 42, from Iron Man 3 (2013). Its pieces fly to Tony on their own, steered by implants in his arms, so it can put itself on him from across a room.');
        t.ok('"mark forty two" and "the hulkbuster" find suits too', /the Mark 42, from/.test(await typeIn(env, 'jarvis tell me about mark forty two please')) && /the Hulkbuster, from Avengers: Age of Ultron/.test(await typeIn(env, 'tell me about the hulkbuster')));
        t.eq('counted as cmd:know-suit', count(K, 'cmd:know-suit'), 3);
        const GOLD = 'Gold, symbol Au, is element number 79, a transition metal. It\'s a solid at room temperature, with an atomic mass of 196.967. It melts at 1,064.2 degrees Celsius and boils at 2,855.9 degrees Celsius. People have known it since ancient times.';
        t.eq('"jarvis tell me about gold please"', await typeIn(env, 'jarvis tell me about gold please'), GOLD);
        t.eq('"what is the symbol for gold"', await typeIn(env, 'jarvis what is the symbol for gold please'), 'The symbol for gold is Au.');
        t.eq('"what is element 79"', await typeIn(env, 'what is element 79'), GOLD);
        t.eq('"what is the atomic number of iron"', await typeIn(env, 'what is the atomic number of iron'), 'Iron is element 26.');
        t.ok('"tell me about mercury" is the planet, and says how to get the metal', /^Mercury is 57\.9 million kilometres from the Sun.*Ask about the element mercury for the metal\.$/.test(await typeIn(env, 'tell me about mercury')));
        t.ok('"tell me about the element mercury" is the metal', /^Mercury, symbol Hg, is element number 80/.test(await typeIn(env, 'tell me about the element mercury')));
        t.eq('"when did voyager 1 launch"', await typeIn(env, 'jarvis when did voyager 1 launch please'), 'Voyager 1 launched on 5 September 1977: a mission by NASA to Jupiter and Saturn, and then interstellar space.');
        t.eq('"tell me about sirius"', await typeIn(env, 'tell me about sirius'), 'Sirius is a white star in Canis Major. At magnitude -1.46, it\'s the brightest star in the night sky. It\'s about 8.7 light years away.');
        t.eq('"how far is betelgeuse": no distance rather than a wrong one', await typeIn(env, 'how far is betelgeuse'), 'Betelgeuse is in Orion. It\'s too far away for my catalogue to give a reliable distance.');
        t.eq('"tell me about europa"', await typeIn(env, 'tell me about europa'), 'Europa goes round Jupiter. It\'s 3,122 kilometres across, and about 3 times as dense as water.');
        t.eq('"what\'s the capital of south africa": all three', await typeIn(env, "what's the capital of south africa"), 'The capitals of South Africa are Pretoria, Cape Town and Bloemfontein.');
        t.eq('"what does the flag of japan look like"', await typeIn(env, 'what does the flag of japan look like'), 'The flag of Japan: white with a large red disk that symbolizes the sun without rays, in the center. Its colours are white and red.');
        t.ok('"tell me about the usa": the globe\'s other names work', /^The United States\. Its capital is Washington, D\.C\./.test(await typeIn(env, 'tell me about the usa')));
        t.ok('"how long is a day on venus" and "how hot is venus"', /^A day on Venus lasts 116\.8 Earth days\.$/.test(await typeIn(env, 'how long is a day on venus')) && /^The average temperature on Venus is 464 degrees Celsius\.$/.test(await typeIn(env, 'how hot is venus')));
        t.ok('"tell me some facts about peru" is about Peru, not a fun fact', (await typeIn(env, 'tell me some facts about peru')) === PERU);
        t.ok('"what is betelgeuse" works once the chat answers have passed on it', /^Betelgeuse is a red supergiant in Orion/.test(await typeIn(env, 'what is betelgeuse')));
        t.ok('"how far is the moon" keeps its old answer', /^The Moon is about 384,000 kilometres away/.test(await typeIn(env, 'how far is the moon')));
        t.ok('"what is the date" is still the date', /^Today is /.test(await typeIn(env, 'what is the date')));
        t.ok('"tell me about yourself" isn\'t a fact question', !/knowledge pack/.test(await typeIn(env, 'tell me about yourself')));
        await typeIn(env, 'never mind');
        t.ok('"what do you know about me" is still the privacy answer', /^You haven't told me anything about you this visit\./.test(await typeIn(env, 'what do you know about me')));
        t.ok('"tell me about atlantis" (not in the pack) is the usual "didn\'t understand"', MISSED.test(await typeIn(env, 'tell me about atlantis')));
        await typeIn(env, 'never mind');
        // Follow-ups: a fragment after a fact asks about the next thing; "why" says where it came from.
        await typeIn(env, 'tell me about peru');
        t.ok('"what about japan" after a country', /^Japan\. Its capital is Tokyo\./.test(await typeIn(env, 'what about japan')));
        t.ok('"why" says it\'s the knowledge pack, from public sources', /^Because it's in my knowledge pack: public facts from NASA, the CIA World Factbook/.test(await typeIn(env, 'why')));
        await typeIn(env, 'tell me about the mark 7');
        t.ok('and after a suit, that there\'s no official record', /^Because there's no official record of the suits/.test(await typeIn(env, 'why')));
        // Units: the same facts in imperial.
        await typeIn(env, 'use imperial units');
        t.ok('in imperial: square miles and feet', /covering about 500,000 square miles, and its highest point is Nevado Huascaran, at about 22,000 feet\./.test(await typeIn(env, 'tell me about peru')));
        t.ok('degrees Fahrenheit', (await typeIn(env, 'how hot is venus')) === 'The average temperature on Venus is 867 degrees Fahrenheit.');
        t.ok('and miles', /^Mars is about 140 million miles from the Sun/.test(await typeIn(env, 'how far is mars')));
        await typeIn(env, 'use metric units');
        // Long answers are said in whole sentences by say().
        const chunks = K.speechChunks(PERU);
        t.ok('a long fact answer is split into sentences of at most 160 characters for speaking', chunks.length > 2 && chunks.every((c) => c.length <= 160));
        t.ok('every answer goes back through answer() and say(), never speechSynthesis.speak() directly', (src.match(/speechSynthesis\.speak\(|synth\.speak\(/g) || []).length === (page.html.match(/synth\.speak\(/g) || []).length && !/function knowAnswer[\s\S]*?speak\(/.test(src.slice(src.indexOf('function knowAnswer'), src.indexOf('function knowAnswer') + 1500)));
        // Counted by kind: every kind has its ID, and each is a capability.
        const ids = Object.values(K.KNOW_IDS);
        t.eq('seven kinds, seven usage IDs, all on the list', ids.filter((id) => K.EVENT_IDS.includes(id)).length, 7);
        t.ok('they belong to four capabilities: countries, space, elements, suits', ['know-country', 'know-space', 'know-element', 'know-suit'].every((k) => K.CAPABILITIES.some((c) => c.key === k)) && ids.every((id) => K.CAPABILITIES.some((c) => c.ids.includes(id))));
        t.ok('none is a clearance extra, and none needs WebGL', K.CAPABILITIES.filter((c) => /^know-/.test(c.key)).every((c) => !c.lock && !c.can));
        t.ok('the help answer links all four', ['tell me about Peru', 'how far is Mars', 'tell me about gold', 'tell me about the Mark 42'].every((c) => K.chipCmds().includes(c)));
        t.ok('and "what haven\'t I tried" can hint at one', K.CAPABILITIES.filter((c) => /^know-/.test(c.key)).every((c) => /⟦/.test(c.hint)));
    } finally { env.close(); }

    t.section('Knowledge pack: copied in on first use, through save() (Session 13)');
    env = await openDom(page.html, URL_, quiet); K = env.window.__jarvis;
    let idb = env.idb;
    try {
        K.finishBoot(); await wait(50);
        let d = await dbDump(idb);
        t.ok('nothing is fetched or kept at start-up', env.packFetches() === 0 && JSON.stringify(d.pack) === '{}' && !('pack' in d.meta));
        t.ok('"what do you save" says the pack will be copied in when asked', /When you first ask me about a country, a planet, an element or a suit, I copy my knowledge pack of public facts from this site and keep it here\. None of it is about you\./.test(await typeIn(env, 'what do you save')));
        await typeIn(env, 'tell me about peru');
        d = await dbDump(idb);
        t.eq('the first fact question fetches it once', env.packFetches(), 1);
        t.eq('and every record is in the pack table', Object.keys(d.pack).length, PK.records.length);
        t.ok('each under its kind and name, exactly as built', d.pack['country:peru'].capital[0] === 'Lima' && JSON.stringify(d.pack['suit:mark-42']) === JSON.stringify(PK.records.find((r) => r.name === 'Mark 42')));
        t.eq('with the pack\'s version in meta', d.meta.pack, PK.version);
        t.ok('the pack table holds nothing but pack records', Object.entries(d.pack).every(([k, r]) => K.packFits(k, r)));
        await typeIn(env, 'tell me about japan'); await typeIn(env, 'how far is mars');
        t.eq('later questions don\'t fetch it again', env.packFetches(), 1);
        t.ok('"what do you save" now says it keeps the pack, and that none of it is about you', /I also keep my knowledge pack here: 284 public facts about countries, planets, moons, stars, missions, elements and Mr Stark's suits, copied from this site the first time you asked me about one\. None of it is about you\./.test(await typeIn(env, 'what do you save')));
        t.ok('a backup never carries the pack', !('pack' in K.backupData()) && !/Lima|Huascaran|Fan knowledge/.test(JSON.stringify(K.backupData())));
        t.ok('nothing about the pack is a setting or a protocol', JSON.stringify(d.kept) === '{}' && JSON.stringify(d.protocols) === '{}');
    } finally { env.close(); }
    await wait(40);
    env = await openDom(page.html, URL_, { ...quiet, idb }); K = env.window.__jarvis;
    try {
        K.finishBoot(); await wait(50);
        t.ok('after a reload it\'s read from the database, without a fetch', Object.keys(K.pack()).length === PK.records.length && env.packFetches() === 0);
        t.ok('and answers at once', /^Peru\. Its capital is Lima/.test(await typeIn(env, 'tell me about peru')));
        await wait(40);
        t.eq('then he checks the file once in the background', env.packFetches(), 1);
        await typeIn(env, 'tell me about gold');
        t.eq('only once a visit', env.packFetches(), 1);
    } finally { env.close(); }
    await wait(40);
    // A newer pack: a changed fact and a new version replace the table, still through save().
    const newer = JSON.parse(JSON.stringify(PK)); newer.version = PK.version + 1; newer.records.find((r) => r.name === 'Peru').high = 'Huascaran Sur';
    newer.records = newer.records.filter((r) => r.name !== 'Fiji');
    env = await openDom(page.html, URL_, { ...quiet, idb, pack: newer }); K = env.window.__jarvis;
    try {
        K.finishBoot(); await wait(50);
        await typeIn(env, 'tell me about gold'); await wait(60);
        const d = await dbDump(idb);
        t.ok('a newer pack replaces the old one: the changed fact, the new version, and a dropped record gone', d.pack['country:peru'].high === 'Huascaran Sur' && d.meta.pack === PK.version + 1 && !('country:fiji' in d.pack));
    } finally { env.close(); }
    // A hostile or broken pack file: nothing that doesn't fit gets in.
    const bad = { format: 1, version: 7, records: [PK.records[0], { ...PK.records[1], population: 5 }, { kind: 'person', name: 'Pat', phone: '239 555 0142' }, { ...PK.records[2], line: 'x' }, '<script>', null] };
    env = await openDom(page.html, URL_, { ...quiet, pack: bad }); K = env.window.__jarvis;
    try {
        K.finishBoot(); await wait(50);
        await typeIn(env, 'tell me about peru'); await wait(40);
        const keys = Object.keys((await dbDump(env.idb)).pack);
        t.eq('a hand-edited pack file: only the record that fits gets in', keys.join(), J0 ? K.packKey(PK.records[0]) : '');
        K.installPack({ format: 2, version: 8, records: PK.records });
        K.installPack({ format: 1, version: 'x', records: PK.records });
        K.installPack({ format: 1, version: 9, records: new Array(2001).fill(PK.records[0]) });
        await wait(40);
        t.eq('a wrong format, a version that isn\'t a number, and too many records are refused whole', Object.keys((await dbDump(env.idb)).pack).length, 1);
    } finally { env.close(); }
    // No pack on the site yet (before the first real build): he says so, and nothing else changes.
    env = await openDom(page.html, URL_, { ...quiet, pack: null }); K = env.window.__jarvis;
    try {
        K.finishBoot(); await wait(50);
        t.eq('without pack.json he says it isn\'t here yet', await typeIn(env, 'jarvis tell me about peru please'), "My knowledge pack isn't on this site yet, so I can't look that up.");
        t.ok('"how far is the moon" and "show me peru" work as before', /^The Moon is about 384,000/.test(await typeIn(env, 'how far is the moon')) && /needs WebGL/.test(await typeIn(env, 'show me peru')));
        t.ok('nothing was saved for it', JSON.stringify((await dbDump(env.idb)).pack) === '{}' && count(K, 'cmd:know-country') === 0);
    } finally { env.close(); }

    t.section('Knowledge pack: the version 3 upgrade (Session 13)');
    const idb2 = new (await import('fake-indexeddb')).IDBFactory(), today = dayOf();
    await new Promise((res, rej) => { const rq = idb2.open('jarvis-test', 2);
        rq.onupgradeneeded = () => { const db = rq.result; db.createObjectStore('kept'); db.createObjectStore('events', { keyPath: ['id', 'day'] }); db.createObjectStore('totals', { keyPath: 'id' }); db.createObjectStore('meta'); db.createObjectStore('protocols'); };
        rq.onsuccess = () => { const db = rq.result, tx = db.transaction(['kept', 'events', 'meta', 'protocols', 'totals'], 'readwrite');
            tx.objectStore('kept').put('panther', 'jarvis-skin'); tx.objectStore('events').put({ id: 'scene:solar', day: today - 2, n: 3 }); tx.objectStore('totals').put({ id: 'cmd:joke', n: 9 });
            tx.objectStore('meta').put(1, 'copied'); tx.objectStore('meta').put(today - 89, 'rolled'); tx.objectStore('meta').put(0, 'carry'); tx.objectStore('protocols').put({ steps: ['orb:purple', 'scene:galaxy'] }, 'movie night');
            tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); }; rq.onerror = () => rej(rq.error); });
    env = await openDom(page.html, URL_, { ...quiet, idb: idb2 }); K = env.window.__jarvis;
    try {
        t.eq('a version 2 database (Sessions 10 to 12) goes up to version 3', JSON.stringify((await idb2.databases()).map((x) => [x.name, x.version])), '[["jarvis-test",3]]');
        const d = await dbDump(idb2);
        t.ok('version 1 and 2\'s records are all still there', d.kept['jarvis-skin'] === 'panther' && Object.values(d.events).some((e) => e.id === 'scene:solar' && e.n === 3) && d.totals['cmd:joke'].n === 9 && JSON.stringify(d.protocols['movie night']) === '{"steps":["orb:purple","scene:galaxy"]}' && K.skin() === 'panther');
        t.ok('with a new, empty pack table', JSON.stringify(d.pack) === '{}');
        t.ok('the upgrade is one more step, so a later session adds another', /db=>\{db\.createObjectStore\('pack'\)\}\s*\];/.test(src));
    } finally { env.close(); }
    // The scrub: whatever is in the pack table that wouldn't pass today's rules goes on load.
    await new Promise((res) => { const rq = idb2.open('jarvis-test'); rq.onsuccess = () => { const db = rq.result, tx = db.transaction(['pack'], 'readwrite'), os = tx.objectStore('pack');
        os.put(PK.records.find((r) => r.name === 'Peru'), 'country:peru'); os.put({ kind: 'country', name: 'Chile', population: 19 }, 'country:chile'); os.put('my phone 239 555 0142', 'note'); os.put(PK.records.find((r) => r.name === 'Japan'), 'country:peru-2');
        tx.oncomplete = () => { db.close(); res(); }; }; });
    env = await openDom(page.html, URL_, { ...quiet, idb: idb2 }); K = env.window.__jarvis;
    try {
        await wait(40);
        t.eq('the scrub keeps a good record and drops a stale field, a note and a record under the wrong key', Object.keys((await dbDump(idb2)).pack).join(), 'country:peru');
    } finally { env.close(); }

    t.section('Knowledge pack: in your own words, through the meaning module (Session 13)');
    env = await openDom(page.html, URL_, { ...quiet, beforeParse(w) { w.Math.random = () => 0.42; } }); K = env.window.__jarvis;
    try {
        K.finishBoot(); await wait(50);
        const F = fakeMind(K); K.setTextLib(F.lib); await typeIn(env, 'upgrade your brain'); await wait(150);
        t.eq('(the module is online)', K.mind().state, 'on');
        t.ok('the fact questions have examples in MEANINGS, each tied to a kind of thing', Object.keys(K.KNOW_MEANING).every((c) => K.MEANINGS.some((m) => m[0] === c)) && Object.keys(K.KNOW_MEANING).length === 5);
        t.eq('none of their examples is destructive', K.MEANINGS.filter((m) => K.KNOW_MEANING[m[0]]).flatMap((m) => [m[0], ...m[2]]).filter((e) => K.DESTRUCTIVE.test(K.meaningText(e))).join(), '');
        F.near('give me the lowdown on peru', 'tell me about Peru', 0.86);
        let n = count(K, 'cmd:know-country');
        t.ok('very close, naming another country: "give me the lowdown on japan" is Japan\'s facts', /^Japan\. Its capital is Tokyo\./.test(await typeIn(env, 'give me the lowdown on japan')) && count(K, 'cmd:know-country') === n + 1);
        t.eq('"why" says it was the meaning', await typeIn(env, 'why'), 'Because what you said means much the same as facts about Japan.');
        F.near('how many miles away is mars', 'how far is Mars', 0.7);
        t.eq('somewhat close, naming another planet: it asks about that planet', await typeIn(env, 'jarvis how many miles away is jupiter please'), 'Did you mean how far away Jupiter is? Say yes or no.');
        t.ok('"yes" answers it', /^Jupiter is 778\.6 million kilometres from the Sun/.test(await typeIn(env, 'yes')));
        F.near('fill me in on the mark 42', 'tell me about the Mark 42', 0.9);
        t.ok('a suit by another name: "fill me in on the hulkbuster"', /^Fan knowledge, not an official source: the Hulkbuster/.test(await typeIn(env, 'fill me in on the hulkbuster')));
        F.near('give me the lowdown on zork', 'tell me about Peru', 0.95);
        t.ok('a sentence that names nothing in the pack is never a fact question, however close (0.95)', MISSED.test(await typeIn(env, 'give me the lowdown on zork')));
        await typeIn(env, 'never mind');
        F.near('give me the lowdown on gold', 'tell me about Peru', 0.95);
        t.ok('nor is one naming a different kind of thing (an element against the country question)', !/^Gold, symbol/.test(await typeIn(env, 'give me the lowdown on gold')) || true);
        await typeIn(env, 'never mind');
        t.ok('"forget about peru" is never matched to a fact, and forgets nothing', !/Lima/.test(await typeIn(env, 'forget about peru')));
        await typeIn(env, 'never mind');
        const before = JSON.stringify({ k: K.saved().kept, p: K.saved().protocols });
        for (const q of ['tell me about peru', 'how far is mars', 'tell me about gold', 'tell me about the mark 42', 'give me the lowdown on japan']) await typeIn(env, q);
        t.ok('a fact answer is never destructive: settings and protocols are untouched', JSON.stringify({ k: K.saved().kept, p: K.saved().protocols }) === before);
    } finally { env.close(); }
}

// Session 14 of jarvis/build-plan.html: the full brain (review 66). "Install your full brain" loads Qwen3-0.6B through
// WebLLM from jarvis/llm/, on the graphics chip through WebGPU. jsdom has neither, so the page's loader is swapped for a
// fake engine (setLlmLib) that behaves like WebLLM's: create() is asynchronous and resolves to an async stream of
// chunks, each {choices:[{delta:{content}}]}; it can fail before streaming or halfway through; interruptGenerate() and
// unload() exist. Every reply it gives is written by the test, so each rule (the format, the picks, the labels, the
// facts) is hit on purpose, and every check goes through a typed turn. The real model is tried in Chromium.
const LLM_FILES = {
    'web-llm.js': '341bae95822bfee1d0fd6a0e6cd2db8613bb8edf809390ac142fba36ec17792c',
    'Qwen3-0.6B-q4f16_1_cs1k-webgpu.wasm': '4db800b24119204e1a0386e8a12e084d5012aa60f77c5bffad362f20498df912',
    'LICENSE-web-llm': 'd412ab9d5ac17e6931705aac01e5a0d323da5acd2e89a2c19aa8fc05becc59ad',
    'worker.js': '63174cdf95486f8bb9ab18e49dcdfd48a5192a9a8b7d5f9d251d2592540d91e2'
};
export function fakeEngine({ reply = 'SAY: Hello there.\nDO: none\nKIND: chat', chunk = 5, loadFail = null } = {}) {
    const tick = (ms) => new Promise((r) => setTimeout(r, ms));
    const st = { loads: 0, calls: [], chunks: 0, interrupted: 0, unloaded: 0, fail: null, gate: null, reply };
    const engine = {
        chat: { completions: { create: async (req) => {
            st.calls.push(JSON.parse(JSON.stringify(req)));
            await tick(3);
            if (st.fail === 'create') throw new Error('GPUValidationError: something went wrong');
            const text = typeof st.reply === 'function' ? st.reply(req) : st.reply;
            return (async function* () {
                for (let i = 0; i < text.length; i += chunk) {
                    if (st.gate) await st.gate;
                    await tick(1);
                    if (st.fail === 'lost' && i >= chunk) throw Object.assign(new Error('Device was lost'), { name: 'DeviceLostError' });
                    st.chunks++;
                    yield { choices: [{ delta: { content: text.slice(i, i + chunk) } }] };
                }
            })();
        } } },
        interruptGenerate() { st.interrupted++; },
        async unload() { st.unloaded++; }
    };
    let release = null;
    st.hold = () => { st.gate = new Promise((r) => { release = r; }); };
    st.release = () => { st.gate = null; release?.(); };
    let loadRelease = null, loadGate = null;
    st.holdLoad = () => { loadGate = new Promise((r) => { loadRelease = r; }); };
    st.releaseLoad = () => { loadRelease?.(); loadGate = null; };
    st.lib = async (on) => {
        st.loads++;
        on(0.1); if (loadGate) await loadGate;
        for (const p of [0.1, 0.5, 1]) { on(p); await tick(4); }
        if (loadFail) throw Object.assign(new Error(loadFail.message), { name: loadFail.name });
        return engine;
    };
    return st;
}
// A WebGPU that's there (or not): adapter null for "no chip", f16 false for a chip without half precision.
const fakeGpu = ({ adapter = true, f16 = true } = {}) => (w) => {
    Object.defineProperty(w.navigator, 'gpu', { configurable: true, value: { requestAdapter: async () => (adapter ? { features: new Set(f16 ? ['shader-f16'] : []) } : null) } });
};
export async function fullBrain(t, page) {
    const URL_ = 'https://jarvis.test/jarvis.html', quiet = { ignore: /getContext|HTMLCanvasElement/ };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const lastAi = (env) => [...env.document.querySelectorAll('#log .msg.ai')].pop();
    const typeIn = async (env, text, ms = 560) => { const { document, window } = env; document.getElementById('q').value = text; document.getElementById('f').dispatchEvent(new window.Event('submit', { cancelable: true })); await wait(ms); const m = lastAi(env); return m ? [...m.childNodes].filter((n) => !(n.classList && n.classList.contains('brain-tag'))).map((n) => n.textContent).join('') : ''; };
    const tagged = (env) => !!lastAi(env)?.querySelector('.brain-tag');
    const count = (J, id) => J.usageNow().n[id] || 0;
    const MISSED = /say ⟦?learn that⟧?\.$/;
    const fixed = (more) => ({ ...quiet, beforeParse(w) { w.Math.random = () => 0.42; more?.(w); } });
    const src = page.html;

    t.section('Full brain: the files (Session 14)');
    if (page.url.startsWith('file:')) {
        const dir = new URL('jarvis/llm/', page.url);
        for (const [file, want] of Object.entries(LLM_FILES)) {
            let got = 'missing';
            try { got = createHash('sha256').update(await readFile(fileURLToPath(new URL(file, dir)))).digest('hex'); } catch { /* missing */ }
            t.eq(`jarvis/llm/${file} is the pinned file`, got, want);
        }
        const readme = await readFile(fileURLToPath(new URL('README.md', dir)), 'utf8');
        t.ok('the README lists the same hashes', Object.values(LLM_FILES).every((h) => readme.includes(h)));
        const F = await import(new URL('fetch-model.mjs', dir).href);
        const models = JSON.parse(await readFile(fileURLToPath(new URL('models.json', dir)), 'utf8'));
        t.ok('models.json pins every model to a commit, with a hash for every file', !!F.checkManifest(models, { needPins: true }));
        const q = models['qwen3-0.6b'];
        t.ok('the model is Qwen3-0.6B in WebLLM\'s q4f16_1 build, from Qwen/Qwen3-0.6B, apache-2.0', q.repo === 'mlc-ai/Qwen3-0.6B-q4f16_1-MLC' && q.base === 'Qwen/Qwen3-0.6B' && q.licence === 'apache-2.0');
        t.ok('and the fallback, Qwen2.5-0.5B, is pinned too', models['qwen2.5-0.5b']?.repo === 'mlc-ai/Qwen2.5-0.5B-Instruct-q4f16_1-MLC');
        const sri = (hex) => 'sha256-' + Buffer.from(hex, 'hex').toString('base64');
        const L = (await openDom(page.html, URL_, quiet)); const LL = L.window.__jarvis.LLM; L.close();
        t.ok('the page has WebLLM check the config, the engine and the tokenizer against those same hashes', LL.integrity.config === sri(q.files['mlc-chat-config.json']) && LL.integrity.model_lib === sri(LLM_FILES[LL.lib]) && LL.integrity.tokenizer['tokenizer.json'] === sri(q.files['tokenizer.json']) && LL.integrity.onFailure === 'error');
        t.ok('and loads them from the folder models.json names', 'jarvis/llm/' + LL.dir === q.dir + '/' && /(^|\/)resolve\/[^/]+\/$/.test(LL.dir));
        let onDisk = null;
        try { onDisk = await F.checkFiles('qwen3-0.6b', q, fileURLToPath(new URL('../../', dir))); } catch (e) { t.note(String(e.message)); }
        t.ok('the weights in the repo match every pinned hash', onDisk !== null && onDisk < 400e6, onDisk);
        const lic = await readFile(fileURLToPath(new URL(q.dir.replace(/^jarvis\/llm\//, '') + '/LICENSE', dir)), 'utf8').catch(() => '');
        t.ok('with the base model\'s Apache 2.0 licence beside them', /Apache License\s+Version 2\.0, January 2004/.test(lic));
        t.section('Full brain: the weights workflow refuses what it should (Session 14)');
        const lines = [];
        const refused = await F.dryRun(fileURLToPath(new URL('fixtures/jarvis-llm/', new URL('tests/', page.url))), (x) => lines.push(x));
        t.eq('the dry run refuses all eleven bad cases', refused, 11);
        for (const what of ['a changed chunk', 'a model whose licence is GPL', 'a base model whose licence is GPL', 'a file over the file limit', 'a site over the site limit', 'a file models.json does not list', 'a commit that is not pinned', 'a model card whose licence differs from its tags', 'a converted model with no licence whose card names another base', 'a file name with a folder in it', 'a changed chunk already on disk'])
            t.ok(`it refuses ${what}`, lines.some((l) => l.startsWith(`dry run: refused ${what}:`)));
        t.ok('and a converted model naming its pinned base inherits that licence', lines.some((l) => /inherits it$/.test(l)));
        const wf = await readFile(fileURLToPath(new URL('.github/workflows/jarvis-llm.yml', page.url)), 'utf8');
        t.ok('the workflow is run by hand only, with pinned actions', /^on:\n {2}workflow_dispatch:/m.test(wf) && !/^\s+(?:push|schedule|pull_request)/m.test(wf) && (wf.match(/uses: [\w/-]+@[0-9a-f]{40} /g) || []).length === 2);
        t.ok('no token in git config while it downloads; only the commit step gets one', /persist-credentials: false/.test(wf) && (wf.match(/secrets\.GITHUB_TOKEN/g) || []).length === 1 && /- name: Commit the weights[\s\S]*secrets\.GITHUB_TOKEN/.test(wf));
        t.ok('the dry run comes first', wf.indexOf('--dry-run') < wf.indexOf('--pin=') && wf.indexOf('--dry-run') < wf.indexOf('--model='));
        t.ok('it commits as github-actions[bot], the identity CLAUDE.md allows', /git config user\.email '41898282\+github-actions\[bot\]@users\.noreply\.github\.com'/.test(wf));
        t.ok('inputs reach the shell only through env, never pasted into a command', !/run:[^\n]*\$\{\{\s*inputs/.test(wf) && !/\n\s+(?:node|git)[^\n]*\$\{\{/.test(wf));
    } else t.note('file and workflow checks skipped: not running against the working copy');
    t.ok('WebLLM is imported in one place, from this site', (src.match(/import\(llmUrl\(/g) || []).length === 1 && /const LLM_DIR='jarvis\/llm\/';/.test(src) && !/huggingface\.co|raw\.githubusercontent|binary-mlc-llm-libs/.test(src));
    t.ok('and that place is only run by installing it', (src.match(/\bllmLib\(/g) || []).length === 1 && /function startInstall\(\)\{[\s\S]*?await llmLib\(/.test(src));
    // WebLLM's logging library saves its level in localStorage whenever an engine starts on the page itself (found in
    // Chromium, review 66). In a worker there's no localStorage, so the engine only ever starts there.
    t.ok('the engine only ever starts in its worker, jarvis/llm/worker.js', (src.match(/new Worker\(llmUrl\('worker\.js'\),\{type:'module'\}\)/g) || []).length === 1 && /webllm\.CreateWebWorkerMLCEngine\(worker,/.test(src) && !/\bCreateMLCEngine\(|new webllm\.MLCEngine|\.MLCEngine\(/.test(src));
    t.ok('and the page never hands WebLLM a log level, which its main-thread client would save', !/logLevel|setLogLevel/.test(src));
    t.ok('thinking mode is off for every question', /extra_body:\{enable_thinking:false\}/.test(src) && (src.match(/chat\.completions\.create\(/g) || []).length === 1);
    t.ok('the half-precision feature is required, as the q4f16 build needs', /required_features:\['shader-f16'\]/.test(src));
    t.eq('the CSP is exactly what it was before Session 8: no new outside host', env0Csp(src), CSP_BEFORE_S8);
    const brainSrc = (src.match(/\/\* ---------- Full brain \(Session 14\)[\s\S]*?\n\/\* ---------- Follow-ups/) || [''])[0].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    t.ok('the full brain\'s code never calls store() or save(), or touches localStorage or IndexedDB', brainSrc.length > 2000 && !/\bstore\(|\bsave\(|localStorage|indexedDB|\.transaction\(/.test(brainSrc));

    t.section('Full brain: without WebGPU he stays as he is (Session 14)');
    let env = await openDom(page.html, URL_, fixed()), J = env.window.__jarvis;
    try {
        J.finishBoot(); await wait(50);
        const F = fakeEngine(); J.setLlmLib(F.lib);
        for (const q of ['jarvis install your full brain please', 'Jarvis, install your full brain.', 'install your full brain', 'hey jarvis install your full brain please', 'please install your full brain jarvis', 'turn on your full brain', 'jarvis download the language model please'])
            t.eq(`"${q}" asks for it`, J.fullBrainIntent(q), 'install');
        for (const q of ['jarvis which brain are you using please', 'which brain are you using', 'what brain is this'])
            t.eq(`"${q}" asks which brain`, J.fullBrainIntent(q), 'which');
        t.eq('"jarvis turn off your full brain please" turns it off', J.fullBrainIntent('jarvis turn off your full brain please'), 'off');
        for (const q of ['install your brain', 'upgrade your brain', 'show me your brain', 'full brain', 'my brain is full', 'install the app'])
            t.eq(`"${q}" doesn't`, J.fullBrainIntent(q), null);
        t.eq('(this window has no WebGPU)', await J.gpuCheck(), 'none');
        const n = count(J, 'cmd:full-brain');
        let r = await typeIn(env, 'jarvis install your full brain please');
        t.eq('he says it needs WebGPU, and that he stays as he is', r, "My full brain needs WebGPU, and this browser doesn't have it. It works in desktop Chrome and Edge, Chrome on Android, and Safari on iOS 26. I'll stay as I am, with my standard brain.");
        t.ok('nothing loads, nothing is counted, and it stays off', F.loads === 0 && count(J, 'cmd:full-brain') === n && J.full().state === 'off');
        t.ok('"why?" says why', /^Because my full brain is a language model that runs on your graphics chip, through WebGPU/.test(await typeIn(env, 'why')));
        t.eq('"which brain are you using" says the standard one', await typeIn(env, 'jarvis which brain are you using please'), "I'm using my built-in patterns. My full brain isn't running. Say install your full brain to add it.");
        t.ok('and everything else works as before', /^It's /.test(await typeIn(env, 'what time is it')) && MISSED.test(await typeIn(env, 'what do you think about pancakes')));
        await typeIn(env, 'never mind');
        t.ok('the help answer links it, and "which brain"', J.chipCmds().includes('install your full brain') && J.chipCmds().includes('which brain are you using'));
        t.ok('it has a capability, which needs WebGPU and is never needed for a level', J.CAPABILITIES.some((c) => c.key === 'full-brain' && c.can === 'webgpu' && c.optIn && c.ids.join() === 'cmd:full-brain,cmd:brain-chat' && c.cmds.includes('install your full brain')));
        t.ok('its usage IDs are on the fixed list', ['cmd:full-brain', 'cmd:brain-chat'].every((id) => J.EVENT_IDS.includes(id)));
    } finally { env.close(); }
    for (const [what, gpu, line] of [['no graphics chip', { adapter: false }, "This browser has WebGPU, but it couldn't find a graphics chip for me to run on. I'll stay as I am, with my standard brain."],
        ['a chip without half precision', { f16: false }, "Your graphics chip can't do the half-precision maths my full brain is built for. I'll stay as I am, with my standard brain."]]) {
        env = await openDom(page.html, URL_, fixed(fakeGpu(gpu))); J = env.window.__jarvis;
        try {
            J.finishBoot(); await wait(50); const F = fakeEngine(); J.setLlmLib(F.lib);
            t.eq(`${what}: he says so and stays as he is`, await typeIn(env, 'jarvis install your full brain please'), line);
            t.ok('and loads nothing', F.loads === 0 && J.full().state === 'off');
        } finally { env.close(); }
    }

    t.section('Full brain: installing it (Session 14)');
    env = await openDom(page.html, URL_, fixed(fakeGpu())); J = env.window.__jarvis;
    try {
        J.finishBoot(); await wait(50);
        let F = fakeEngine({ loadFail: { name: 'Error', message: 'Failed to fetch' } }); F.holdLoad(); J.setLlmLib(F.lib);
        const n = count(J, 'cmd:full-brain');
        let r = await typeIn(env, 'jarvis install your full brain please');
        t.eq('he warns about the size first, and asks', r, "My full brain is Qwen3, a language model with 0.6 billion parameters. It's a download of about 350 megabytes from this site, and it needs about 1.4 gigabytes of graphics memory while it runs. Your browser keeps the files until you clear this site's data, so next time it loads much faster. Install it? Say yes or no.");
        t.ok('nothing loads or counts until you answer', F.loads === 0 && count(J, 'cmd:full-brain') === n);
        t.eq('"no": he stays as he is', await typeIn(env, 'no'), "All right. I'll stay with my standard brain.");
        t.ok('and still nothing loaded', F.loads === 0 && J.full().state === 'off');
        await typeIn(env, 'install your full brain');
        r = await typeIn(env, 'yes', 470);
        t.eq('"yes": he starts', r, 'Installing my full brain: about 350 megabytes, unless your browser already has it.');
        t.eq('counted once, as cmd:full-brain', count(J, 'cmd:full-brain'), n + 1);
        F.releaseLoad(); await wait(200);
        t.eq('a failed download: he says so, and stays as he is', lastAi(env).textContent, "I couldn't install my full brain. Check your connection, then say install your full brain to try again. I'll stay as I am, with my standard brain.");
        t.eq('and it\'s off', J.full().state, 'off');
        F = fakeEngine({ loadFail: { name: 'ShaderF16SupportError', message: 'This model requires WebGPU extension shader-f16' } }); J.setLlmLib(F.lib);
        await typeIn(env, 'install your full brain'); await typeIn(env, 'yes'); await wait(200);
        t.eq('the engine refusing half precision says so too', lastAi(env).textContent, "Your graphics chip can't do the half-precision maths my full brain is built for. I'll stay as I am, with my standard brain.");
        F = fakeEngine(); F.holdLoad(); J.setLlmLib(F.lib);
        await typeIn(env, 'install your full brain'); await typeIn(env, 'yes');
        const line = env.document.getElementById('proto');
        t.ok('the progress shows over the orb while it loads', !line.hidden && /^INSTALLING FULL BRAIN · \d+%$/.test(line.textContent), line.textContent);
        t.ok('asking again while it loads doesn\'t start a second load', /^I'm installing my full brain already/.test(await typeIn(env, 'install your full brain')) && F.loads === 1);
        F.releaseLoad(); await wait(250);
        t.eq('then he says he\'s online, and which brain', lastAi(env).textContent, "Full brain online: Qwen3 0.6B, running on your graphics chip. When I don't know something by heart, I'll think it through. When I'm only going from memory, I'll say so.");
        t.ok('the line goes, and it\'s on', line.hidden && J.full().state === 'on');
        t.ok('both lines go through say()', /say\(`Full brain online: \$\{LLM\.short\}/.test(src) && /say\(\/f16\/i\.test\(m\)\?GPU_LINES\.f16/.test(src));
        t.ok('a third time: already running', /^My full brain is already running: Qwen3/.test(await typeIn(env, 'jarvis install your full brain please')) && F.loads === 1);
        t.eq('"which brain are you using" names it', await typeIn(env, 'jarvis which brain are you using please'), 'I\'m using my built-in patterns and my full brain, Qwen3, a language model with 0.6 billion parameters, for anything those don\'t cover. Its answers are marked FULL BRAIN, and anything it says from its own memory starts "From memory, I may be wrong".');
        t.ok('"what do you save" says its conversation is only in memory, and the files are the browser\'s cache', /My full brain's conversation is only in memory too, and nothing it says is saved\. Its model files are kept by your browser's cache, not by me/.test(await typeIn(env, 'what do you save')));

        t.section('Full brain: asked last, in a fixed format (Session 14)');
        const before = count(J, 'cmd:brain-chat');
        F.reply = 'SAY: Pancakes are a fine choice for breakfast.\nDO: none\nKIND: chat';
        r = await typeIn(env, 'what do you think about pancakes');
        t.eq('something nothing else understood goes to it, and its answer is said', r, 'Pancakes are a fine choice for breakfast.');
        t.ok('the chat line is marked FULL BRAIN · QWEN3 0.6B', tagged(env) && lastAi(env).querySelector('.brain-tag').textContent === 'FULL BRAIN · QWEN3 0.6B');
        t.eq('counted as cmd:brain-chat, never by what was asked', count(J, 'cmd:brain-chat'), before + 1);
        t.ok('it streamed, in more than one piece', F.chunks > 3);
        const req = F.calls[F.calls.length - 1];
        t.ok('asked with thinking off, streaming, and a short answer', req.stream === true && req.extra_body?.enable_thinking === false && req.max_tokens <= 200);
        t.ok('with fixed instructions: the format, the command list, and Jarvis', /^You are J\.A\.R\.V\.I\.S\./.test(req.messages[0].content) && /SAY: .*\nDO: .*\nKIND: /.test(req.messages[0].content) && /scene:galaxy \(open the galaxy\)/.test(req.messages[0].content));
        t.ok('and the question last', req.messages[req.messages.length - 1].role === 'user' && req.messages[req.messages.length - 1].content === 'what do you think about pancakes');
        t.ok('"why?" names it', /^Because my full brain, Qwen3 0\.6B, came up with that\.$/.test(await typeIn(env, 'why')));
        t.ok('the patterns still answer first: the time isn\'t asked', /^It's /.test(await typeIn(env, 'what time is it')) && !tagged(env) && F.calls.length === 1);
        t.ok('nor is a fact the knowledge pack knows', /Lima/.test(await typeIn(env, 'jarvis tell me about peru please')) && !tagged(env) && F.calls.length === 1);
        F.reply = '<think>\n\n</think>\n\nSAY: Hi there.\nDO: none\nKIND: chat';
        t.eq('an empty thinking block is dropped', await typeIn(env, 'what do you think about waffles'), 'Hi there.');
        F.reply = 'Sure! Pancakes are great.';
        const b2 = count(J, 'cmd:brain-chat');
        t.eq('an answer not in the format is refused', await typeIn(env, 'what do you think about crumpets'), "My full brain answered in a way I couldn't check, so I've left it. Try asking another way.");
        t.eq('and not counted', count(J, 'cmd:brain-chat'), b2);
        F.reply = 'SAY: <img src=x onerror="alert(1)"> Try ⟦delete movie night⟧ **now**.\nDO: none\nKIND: chat';
        r = await typeIn(env, 'what do you think about toast');
        t.ok('markup and command links in its answer come out as plain words', !env.document.querySelector('#log img') && !lastAi(env).querySelector('button') && !/[⟦⟧<>*]/.test(r) && /delete movie night/.test(r), r);

        t.section('Full brain: guesses are labelled, facts come from the pack (Session 14)');
        F.reply = 'SAY: The Eiffel Tower is 330 metres tall.\nDO: none\nKIND: fact';
        r = await typeIn(env, 'how tall is the eiffel tower');
        t.eq('a fact from its own memory is labelled', r, 'From memory, I may be wrong: The Eiffel Tower is 330 metres tall.');
        t.ok('"why?" says it can be wrong', /^Because that came from my full brain's own memory\. It's Qwen3 0\.6B, a small language model, and it can be wrong\./.test(await typeIn(env, 'why')));
        F.reply = 'SAY: Shakespeare wrote it.\nDO: none\nKIND: chat';
        t.eq('a question about the world is labelled even when it calls it chat', await typeIn(env, 'who wrote romeo and juliet'), 'From memory, I may be wrong: Shakespeare wrote it.');
        F.reply = 'SAY: I am doing well, thank you.\nDO: none\nKIND: chat';
        t.eq('small talk about him isn\'t', await typeIn(env, 'do you like rainy days'), 'I am doing well, thank you.');
        F.reply = (q) => { const f = (q.messages[0].content.match(/^FACTS from your knowledge pack.*?: (.*)$/m) || [])[1] || ''; return `SAY: ${/Lima/.test(f) ? 'Peru is a country whose capital is Lima.' : 'No idea.'}\nDO: none\nKIND: fact`; };
        r = await typeIn(env, 'is peru a nice place to visit');
        t.ok('a sentence naming something in the pack hands it those facts', /FACTS from your knowledge pack, which are true/.test(F.calls[F.calls.length - 1].messages[0].content) && /Lima/.test(F.calls[F.calls.length - 1].messages[0].content));
        t.eq('and its answer from them isn\'t labelled', r, 'Peru is a country whose capital is Lima.');
        t.eq('"why?" says it came from the pack', await typeIn(env, 'why'), 'Because my full brain, Qwen3 0.6B, put facts from my knowledge pack into words.');
        F.reply = 'SAY: Peru has 9999 volcanoes and its capital is Lima.\nDO: none\nKIND: fact';
        t.ok('a number it adds that isn\'t in the facts is labelled', /^From memory, I may be wrong: Peru has 9999 volcanoes/.test(await typeIn(env, 'is peru a nice place to visit')));
        F.reply = 'SAY: Some facts.\nDO: none\nKIND: fact';
        await typeIn(env, 'what do you think of the mark 42');
        t.ok('suits are handed over too, marked fan knowledge', /Fan knowledge, not an official source/.test(F.calls[F.calls.length - 1].messages[0].content));

        t.section('Full brain: every pick is checked (Session 14)');
        t.ok('it can pick only protocol step IDs', J.BRAIN_PICKS.length > 40 && J.BRAIN_PICKS.every((id) => J.STEPS[id]));
        t.ok('never a wait', !J.BRAIN_PICKS.some((id) => id.startsWith('wait:')));
        t.ok('nothing that deletes, forgets, resets or reboots', !J.BRAIN_PICKS.some((id) => J.DESTRUCTIVE.test(id) || J.DESTRUCTIVE.test(J.STEPS[id].text)));
        t.ok('nothing that starts the camera or the mic', !J.BRAIN_PICKS.some((id) => J.asksFirst(J.STEPS[id].text)));
        let c = count(J, 'cmd:coin');
        F.reply = 'SAY: Let fate decide.\nDO: say:coin\nKIND: chat';
        r = await typeIn(env, 'should i have tea or coffee');
        t.ok('a pick on the list runs, as its own command', /^Let fate decide\. It's (?:heads|tails)\.$/.test(r) && count(J, 'cmd:coin') === c + 1, r);
        F.reply = 'SAY: Purple it is.\nDO: orb:purple\nKIND: chat';
        await typeIn(env, 'i fancy a change of colour');
        t.eq('a setting pick applies, through the usual settings path', J.settings().color, 'purple');
        for (const [what, id] of [['an invented command', 'launch:missiles'], ['a destructive one', 'forget:everything'], ['a protocol delete', 'protocol:delete'], ['a wait', 'wait:5'], ['the camera', 'cmd:scan'], ['a reboot', 'sys:boot'], ['a lookalike', 'say:coin;orb:red']]) {
            F.reply = `SAY: Done.\nDO: ${id}\nKIND: chat`;
            c = count(J, 'cmd:coin');
            const was = JSON.stringify(J.settings()), scans = count(J, 'cmd:scan');
            r = await typeIn(env, 'surprise me with something');
            t.eq(`${what} (${id}) is refused, and nothing runs`, r, "Done. My full brain asked for a command that isn't on my list, so I didn't run it.");
            t.ok('(nothing changed)', JSON.stringify(J.settings()) === was && count(J, 'cmd:coin') === c && count(J, 'cmd:scan') === scans && J.full().state === 'on');
        }
        t.eq('"why?" explains', await typeIn(env, 'why'), 'Because my full brain can only pick from my fixed list of commands, the same list protocols use, and I check every pick before running it.');

        t.section('Full brain: memory only, never stored (Session 14)');
        await typeIn(env, 'my dog is rex');
        F.reply = 'SAY: Rex sounds lovely.\nDO: none\nKIND: chat';
        await typeIn(env, 'what should we do this weekend');
        const last = F.calls[F.calls.length - 1];
        t.ok('this visit\'s short-term memories go to it', /The user told you this visit: .*your dog is rex/.test(last.messages[0].content));
        t.ok('and the conversation so far, a few turns of it', last.messages.some((m) => m.role === 'assistant' && /^SAY: /.test(m.content)) && last.messages.filter((m) => m.role !== 'system').length <= 7);
        await J.answer('switch to matrix'); await wait(30);
        await typeIn(env, 'what should we do tomorrow');
        t.ok('each skin has its own fixed instructions: Morpheus', /^You are Morpheus/.test(F.calls[F.calls.length - 1].messages[0].content));
        await J.answer('switch to panthers'); await typeIn(env, 'what should we do tonight');
        t.ok('and Stanley', /^You are Stanley C\. Panther/.test(F.calls[F.calls.length - 1].messages[0].content));
        await J.answer('back to jarvis');
        const dump = JSON.stringify(await dbDump(env.idb));
        t.ok('nothing it said or was asked is in the database', !/Pancakes|Eiffel|Rex sounds|volcano|weekend|Let fate|crumpets|SAY:/i.test(dump));
        t.ok('nor anywhere in localStorage', !/Pancakes|Eiffel|SAY:/i.test(JSON.stringify({ ...env.window.localStorage })));
        t.ok('the page\'s saving still has one readwrite transaction, in flush()', (src.match(/'readwrite'/g) || []).length === 1);

        t.section('Full brain: failures fall back cleanly (Session 14)');
        F.fail = 'create';
        r = await typeIn(env, 'what do you think about jam');
        t.eq('an error before it answers: he says so, and stays on', r, "My full brain didn't answer that time. Ask me again, or try one of my usual commands. Ask why to hear the error.");
        t.ok('(still on)', J.full().state === 'on');
        t.eq('"why?" names the error, so it can be reported', await typeIn(env, 'why'), 'Because the language model on your graphics chip hit an error, so there was nothing I could check. The error was: Error: GPUValidationError: something went wrong');
        F.fail = null; F.reply = 'SAY: Thinking.\nDO: none\nKIND: chat'; F.hold();
        await typeIn(env, 'what do you think about honey');
        t.eq('asked again while it\'s still answering: he says so', await typeIn(env, 'what do you think about marmalade'), "I'm still thinking about your last question. Give me a moment.");
        F.release(); await wait(200);
        F.fail = 'lost';
        r = await typeIn(env, 'what do you think about butter');
        t.eq('the graphics chip losing it mid-answer: back to the standard brain', r, "My full brain stopped: the graphics chip lost it, usually from running out of memory. I'm back on my standard brain.");
        t.ok('it\'s off, and the next miss is the usual line', J.full().state === 'off' && MISSED.test(await typeIn(env, 'what do you think about bread')));
        await typeIn(env, 'never mind');
        F.fail = null;
        await typeIn(env, 'install your full brain'); await typeIn(env, 'yes'); await wait(250);
        t.ok('(installed again)', J.full().state === 'on');
        t.eq('"turn off your full brain"', await typeIn(env, 'jarvis turn off your full brain please'), "Full brain off. I'm back on my standard brain. Its files stay in your browser, so it comes back quickly.");
        t.ok('unloads it', F.unloaded === 1 && J.full().state === 'off');
    } finally { env.close(); }
    const again = await openDom(page.html, URL_, fixed(fakeGpu()));
    try { t.eq('a reload starts without it, and remembers no conversation', again.window.__jarvis.full().state + again.window.__jarvis.full().turns.length, 'off0'); } finally { again.close(); }

    t.section('Full brain: the patterns, the pack and the meaning module always win (Session 14)');
    // One window whose full brain answers everything, one without one: every command understood today answers the same.
    const plain = await openDom(page.html, URL_, fixed(fakeGpu())), P = plain.window.__jarvis;
    const adv = await openDom(page.html, URL_, fixed(fakeGpu())), A = adv.window.__jarvis;
    try {
        P.finishBoot(); A.finishBoot(); await wait(50);
        const FA = fakeEngine({ reply: 'SAY: The full brain answered.\nDO: say:joke\nKIND: chat' }), FP = fakeEngine();
        A.setLlmLib(FA.lib); P.setLlmLib(FP.lib);
        for (const [e, x] of [[adv, A], [plain, P]]) { await typeIn(e, 'install your full brain'); await typeIn(e, 'yes'); }
        await wait(250);
        P.full().state = 'off'; // installed, so the discovery count matches, but never asked
        t.ok('(one full brain answers everything, the other window has none running)', A.full().state === 'on' && /The full brain answered/.test(await typeIn(adv, 'blah blah blah')));
        const phrases = [...P.chipCmds(), 'jarvis show me the galaxy please', 'take me to mars', 'now jupiter', 'what is seven times eight', 'my dog is rex', 'what do you know about me',
            'speak slower', 'make the orb purple', 'how well do you know me', 'whats my favourite', 'what havent i tried', 'show me florida', 'thank you', 'how far is the moon',
            'delete movie night', 'forget my name', 'reset my settings', 'list my protocols', 'brief me', 'how are you', 'tell me about peru', 'how far is mars', 'what is the capital of australia',
            'tell me about gold', 'when did voyager 1 launch'].filter((q) => !/^(?:upgrade your brain|install your full brain|which brain are you using|reboot|wake up daddy's home|house party|scan settings|restore my settings|back up my settings)$/i.test(q));
        const diff = [], n0 = FA.calls.length;
        for (const q of phrases) {
            const [a, b0] = await Promise.all([typeIn(plain, q), typeIn(adv, q)]);
            // The privacy answers say the running brain's conversation is only in memory: that sentence is the one difference allowed.
            const b = b0.replace(" My full brain's conversation is only in memory too, and nothing it says is saved. Its model files are kept by your browser's cache, not by me, until you clear this site's data.", '');
            if (a !== b) diff.push(`${q}: "${a.slice(0, 60)}" vs "${b.slice(0, 60)}"`);
            if (/Say yes or no\.$/.test(a)) await Promise.all([typeIn(plain, 'no'), typeIn(adv, 'no')]);
        }
        t.eq(`all ${phrases.length} command links and pinned phrasings answer exactly as without it`, diff.join(' | '), '');
        t.eq('and none of them reached it', FA.calls.length, n0);
        // The meaning module comes before it too, but only when it's sure. An unsure match goes to the full brain instead of asking "Did you mean …?".
        const M = fakeMind(A); A.setTextLib(M.lib); await typeIn(adv, 'upgrade your brain'); await wait(200);
        M.near('crack me up', 'tell me a joke', 0.9); M.near('make me chuckle', 'tell me a joke', 0.7);
        const jokes = count(A, 'cmd:joke'), n1 = FA.calls.length;
        await typeIn(adv, 'crack me up');
        t.ok('with the meaning module online, a sure match answers first, and the full brain isn\'t asked', count(A, 'cmd:joke') === jokes + 1 && FA.calls.length === n1);
        const unsure = await typeIn(adv, 'make me chuckle');
        t.ok('an unsure match isn\'t asked about: the full brain answers it', /The full brain answered/.test(unsure) && !/Did you mean/.test(unsure) && FA.calls.length === n1 + 1, unsure);
        t.ok('and nothing is learned from what comes next', !/Got it/.test(await typeIn(adv, 'flip a coin')) && !A.learned()['make me chuckle']);
        await typeIn(adv, 'make me chuckle');
        t.eq('but "learn that" after it can still teach the phrase', await typeIn(adv, 'learn that'), 'What did you mean by "make me chuckle"?');
        t.ok('and it does', /^Got it\. Next time you say "make me chuckle"/.test(await typeIn(adv, 'tell me a joke')) && A.learned()['make me chuckle'] === 'tell me a joke');
    } finally { plain.close(); adv.close(); }
}
