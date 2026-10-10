/* jarvis.html — J.A.R.V.I.S. Demo, a talking assistant that runs entirely in
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
import { openDom } from './lib/page.mjs';

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

export const name = 'J.A.R.V.I.S. Demo (jarvis.html)';

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
        t.eq('nothing was written', window.localStorage.getItem('jarvis-name'), null);
        t.eq('only six keys can ever be saved (settings and the streak added in Session 7)', JSON.stringify(STORE_KEYS), '["jarvis-skin","jarvis-voices","jarvis-learned","jarvis-mic-note","jarvis-settings","jarvis-streak"]');
        t.eq('the page calls localStorage.setItem in exactly one place (store)', (page.html.match(/localStorage\.setItem\(/g) || []).length, 1);
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
        t.ok('the scan has no way to save a picture: no toDataURL, toBlob, MediaRecorder or download link', !/toDataURL|toBlob|MediaRecorder|\.download\s*=/.test(src));
        t.ok('the scan closes itself when the tab is hidden', /visibilitychange',\(\)=>\{if\(document\.hidden&&H&&H\.kind==='scan'\)closeHolo\(\)\}/.test(src));
        t.ok('the scan asks the camera for video only, never audio', (src.match(/getUserMedia\(/g) || []).length === 2 && (src.match(/getUserMedia\(\{video:\{facingMode:'user',width:\{ideal:640\},height:\{ideal:480\}\},audio:false\}\)/g) || []).length === 2);
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
    await commandLinks(t, page);
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
        t.eq('the mic note is remembered as seen', window.localStorage.getItem('jarvis-mic-note'), '1');
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
    const { speechChunks, brain, plainText } = (await openDom(page.html, 'https://jarvis.test/jarvis.html', { ignore: /getContext|HTMLCanvasElement/ })).window.__jarvis;
    // say() speaks the help answer without its link markers (see "Command links"), so that's what is chunked.
    const help = plainText(brain('what can you do'));
    const parts = speechChunks(help);
    t.ok('the help answer is split into several pieces', parts.length >= 3);
    t.ok('none is longer than 160 characters (about 10 s of speech)', parts.every((p) => p.length <= 160));
    t.eq('together they are the whole answer, in order', parts.join(' '), help.replace(/\s+/g, ' ').trim());
    t.ok('every piece ends at the end of a sentence', parts.every((p) => /[.!?]$/.test(p)));
    t.eq('a short answer stays in one piece', JSON.stringify(speechChunks('Anytime. You\'re welcome.')), JSON.stringify(['Anytime. You\'re welcome.']));
    t.eq('one sentence longer than the limit is kept whole', speechChunks('a'.repeat(200) + '.').length, 1);
    for (const q of ['what can you do', 'Hey Jarvis, what can you do?', 'what else can you do', 'tell me what you can do', 'what are your features', 'list your commands', 'what can I say'])
        t.eq(`"${q}" gets the help answer`, plainText(brain(q)), help);
    t.ok('"hello" is still a greeting', /online|help/.test(brain('hello')) && plainText(brain('hello')) !== help);

    const fake = fakeSpeech();
    const env = await openDom(page.html, 'https://jarvis.test/jarvis.html', { ignore: /getContext|HTMLCanvasElement/, beforeParse: fake.beforeParse });
    try {
        const { document } = env, state = () => document.getElementById('state').textContent;
        const ask = (text) => { document.getElementById('q').value = text; document.getElementById('f').dispatchEvent(new env.window.Event('submit', { cancelable: true })); };
        ask('what can you do'); await wait(600);
        const plain = help;
        t.eq('the whole help answer is queued, piece by piece, without the link markers', fake.log.queue.map((u) => u.text).join(' '), plain.replace(/\s+/g, ' ').trim());
        t.ok('as more than one utterance', fake.log.queue.length >= 3);
        t.eq('and the chat log shows it in full, as one message', [...document.querySelectorAll('#log .msg.ai')].pop()?.textContent, plain);
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
        t.eq('the skin is remembered on this device', window.localStorage.getItem('jarvis-skin'), 'matrix');
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
        t.ok('then what it can do', /Here's what I can do/.test(r));
        t.ok('and asks what was meant', /What were you trying to say\?$/.test(r));
        r = await ask('nothing');
        t.ok('"nothing" moves on', /move on\. I'm not programmed for this\./.test(r));
        t.eq('and learns nothing', Object.keys(J.learned()).length, 0);
        await ask('beam me up scotty');
        r = await ask('What I was trying to say was flip a coin');
        t.ok('telling it what was meant is acknowledged', /Next time you say "beam me up scotty", I'll know you mean "flip a coin"/.test(r));
        t.ok('and does it straight away', /heads|tails/.test(r));
        t.eq('the phrase is saved in this browser', JSON.parse(window.localStorage.getItem('jarvis-learned'))['beam me up scotty'], 'flip a coin');
        r = await ask('Beam me up, Scotty!');
        t.ok('saying it again just works', /^It's (heads|tails)\.$/.test(r));
        await ask('make it so number one');
        r = await ask('I meant switch to panthers');
        t.ok('a learned phrase can switch skins', J.skin() === 'panther' && /I'll know you mean "switch to panthers"/.test(r));
        await ask('switch to jarvis');
        await ask('blorp');
        r = await ask('fizzbuzz wibble');
        t.ok('a meaning it doesn\'t understand either moves on', /I'm not programmed for this/.test(r));
        t.ok('without saving it', !('blorp' in J.learned()));
        r = await ask('what have you learned');
        t.ok('it can say what it has learned', /2 phrases/.test(r) && /beam me up scotty/.test(r));
        await ask('__proto__');
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
        t.eq('"forget what you learned" clears them', window.localStorage.getItem('jarvis-learned'), '{}');
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
        t.ok('"forget my name" forgets it', /forgotten your name/.test(await J.answer('forget my name')) && window.localStorage.getItem('jarvis-name') === null);
        t.ok('then no skin knows it', /haven't told me your name/.test(await J.answer('what is my name')) && !/Tony/.test(J.setSkin('matrix')));
        t.ok('a name told to one skin is known to the next', /Nice to meet you, Pepper/.test(await J.answer('my name is pepper')) && /Pepper/.test(J.setSkin('jarvis')) && /Your name is Pepper/.test(await J.answer('what is my name')));
        t.eq('no console errors', env.errors.length, 0);
    } finally {
        env.close();
    }
    // An older version saved the name, and a taught phrase may hold personal details: both go on the next visit.
    t.section('Privacy scrub: cleaning up what older versions saved');
    env = await openDom(page.html, 'https://jarvis.test/jarvis.html', { ...opts, beforeParse(w) { opts.beforeParse(w);
        w.localStorage.setItem('jarvis-name', 'Tony'); w.localStorage.setItem('jarvis-secret', 'x'); w.localStorage.setItem('other-page', 'keep me');
        w.localStorage.setItem('jarvis-skin', 'matrix');
        w.localStorage.setItem('jarvis-learned', JSON.stringify({ 'beam me up': 'roll a die', 'my number': 'call 239 555 0142', 'ring pat': 'email pat@example.com' })); } });
    try {
        const { window } = env, J = window.__jarvis, ls = window.localStorage;
        t.eq('a saved name is deleted on load', ls.getItem('jarvis-name'), null);
        t.eq('so is any other jarvis-* key that isn\'t a setting', ls.getItem('jarvis-secret'), null);
        t.eq('other pages\' storage on this site is left alone', ls.getItem('other-page'), 'keep me');
        t.eq('taught phrases with personal details are dropped, the rest kept', ls.getItem('jarvis-learned'), '{"beam me up":"roll a die"}');
        t.eq('settings stay', ls.getItem('jarvis-skin'), 'matrix');
        t.ok('the deleted name is not used to greet you', (J.finishBoot(), !/Tony/.test([...env.document.querySelectorAll('#log .msg.ai')].pop()?.textContent ?? '')));
        t.ok('"what do you save" reads back exactly what is there', /your skin \(Morpheus\), one phrase you taught me and your visit streak \(one day, and the date of your last visit\)\./.test(await J.answer('what do you save')));
        J.brain('my name is pat');
        t.ok('a name told this visit is mentioned as memory-only', /Your name, Pat, is only in memory for this visit\./.test(await J.answer('what do you know about me')));
        t.eq('and still not stored', ls.getItem('jarvis-name'), null);
        t.ok('an unknown phrase gets the "what were you trying to say" question', /What were you trying to say\?$/.test(await J.answer('ring my dentist')));
        const taught = await J.answer('I meant what is 239 times 5550142');
        t.ok('it says why it won\'t save it', /won't save that phrase, because it has a phone or ID number in it/.test(taught));
        t.ok('and the phrase is not in storage', !/dentist|5550142/.test(ls.getItem('jarvis-learned')));
        t.eq('no console errors', env.errors.length, 0);
    } finally {
        env.close();
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
        t.eq('the pick is saved for that skin on this device', JSON.parse(window.localStorage.getItem('jarvis-voices')).jarvis, 'Samantha');
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
        t.ok('and clears the saved pick', !('jarvis' in JSON.parse(window.localStorage.getItem('jarvis-voices'))));
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
        t.ok('nothing about it is saved', !Object.keys(window.localStorage).some((k) => /wake|listen/.test(k)));

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
    const allStored = (w) => { const o = {}; for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); o[k] = w.localStorage.getItem(k); } return o; };
    const seed = (entries, extra) => ({ ignore: /getContext|HTMLCanvasElement/, beforeParse(w) { extra?.(w); for (const [k, v] of Object.entries(entries)) w.localStorage.setItem(k, v); } });
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
        t.eq('and it is saved as one jarvis-settings key', ls.getItem('jarvis-settings'), '{"color":"blue"}');
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
        t.eq('all four settings are in the one key', ls.getItem('jarvis-settings'), '{"color":"blue","speed":"slow","units":"imperial","scene":"galaxy"}');
        t.ok('"what do you save" lists the settings', /your settings \(a blue orb, speaking slowly, imperial units, opening with the galaxy\)/.test(await typeIn(env, 'what do you save')));
        t.ok('and mentions Safari\'s 7-day rule', /after 7 days without a visit/.test(await typeIn(env, 'what do you save')));
        t.eq('the browser was asked to keep storage, once', persistCalls, 1);
        await wait(10);
        t.eq('and its answer is remembered', J.persisted(), true);
        const help = J.brain('help');
        t.ok('help mentions settings, short-term memory, the memory core, dreaming and the 7-day rule', /make the orb blue/.test(help) && /my dog is Rex/.test(help) && /show me your memory/.test(help) && /dream/.test(help) && /7 days/.test(help));
        saved = allStored(window);
        t.eq('no console errors', env.errors.length, 0);
    } finally { env.close(); }

    env = await openDom(page.html, 'https://jarvis.test/jarvis.html', seed(saved));
    try {
        const { window, document } = env, J = window.__jarvis;
        t.eq('after a reload the settings are back', JSON.stringify(J.settings()), '{"color":"blue","speed":"slow","units":"imperial","scene":"galaxy"}');
        t.eq('and the orb is blue straight away', J.ring(), J.ORB_COLOURS.blue[0]);
        J.finishBoot();
        await wait(1400);
        t.ok('the favourite scene is opened after the greeting (no WebGL here, so it says so)', /needs WebGL/.test(document.getElementById('log').textContent));
        t.ok('"reset my settings" clears them', /back to normal/.test(await typeIn(env, 'reset my settings')) && window.localStorage.getItem('jarvis-settings') === null);
    } finally { env.close(); }

    t.section('Settings and streak: the scrub (Session 7)');
    env = await openDom(page.html, 'https://jarvis.test/jarvis.html', seed({
        'jarvis-settings': JSON.stringify({ color: 'blue', name: 'Tony', scene: '<img src=x onerror=alert(1)>', speed: 'ludicrous', __proto__: 'x' }),
        'jarvis-skin': 'matrix'
    }));
    try {
        const ls = env.window.localStorage;
        t.eq('a setting outside the fixed choices is dropped, and so is any extra field', ls.getItem('jarvis-settings'), '{"color":"blue"}');
    } finally { env.close(); }
    env = await openDom(page.html, 'https://jarvis.test/jarvis.html', seed({ 'jarvis-settings': '{"units":"furlongs"}', 'jarvis-streak': '{"days":"3","y":2026,"m":10,"d":10}' }));
    try {
        const ls = env.window.localStorage;
        t.eq('settings with nothing valid are deleted', ls.getItem('jarvis-settings'), null);
        t.eq('a malformed streak is replaced by a fresh one', JSON.parse(ls.getItem('jarvis-streak')).days, 1);
    } finally { env.close(); }
    {
        const y = daysAgo(1), clean = JSON.stringify({ days: 4, ...y });
        env = await openDom(page.html, 'https://jarvis.test/jarvis.html', seed({ 'jarvis-settings': '{"color":"gold","units":"imperial"}', 'jarvis-streak': JSON.stringify({ days: 4, ...y, extra: 'my phone 239 555 0142' }) }));
        try {
            const { window } = env, J = window.__jarvis, ls = window.localStorage;
            t.eq('clean settings are left exactly as they were', ls.getItem('jarvis-settings'), '{"color":"gold","units":"imperial"}');
            t.eq('an extra field in the streak is dropped, the count kept and today added', ls.getItem('jarvis-streak'), JSON.stringify({ days: 5, ...ymd(new Date()) }));
            ls.setItem('jarvis-streak', clean); J.scrubStore();
            t.eq('the scrub leaves a clean streak alone', ls.getItem('jarvis-streak'), clean);
            J.scrubStore();
            t.eq('and clean settings, run again', ls.getItem('jarvis-settings'), '{"color":"gold","units":"imperial"}');
        } finally { env.close(); }
    }

    t.section('Streaks (Session 7)');
    {
        const J = (env = await openDom(page.html, 'https://jarvis.test/jarvis.html', { ignore: /getContext|HTMLCanvasElement/ })).window.__jarvis;
        const s = (days, y, m, d) => ({ days, y, m, d });
        t.eq('a first visit starts at 1', J.streakNext(null, { y: 2026, m: 10, d: 10 }).days, 1);
        t.eq('the same day keeps the count', J.streakNext(s(3, 2026, 10, 10), { y: 2026, m: 10, d: 10 }).days, 3);
        t.eq('the next day adds one', J.streakNext(s(3, 2026, 10, 9), { y: 2026, m: 10, d: 10 }).days, 4);
        t.eq('a missed day starts again at 1', J.streakNext(s(3, 2026, 10, 8), { y: 2026, m: 10, d: 10 }).days, 1);
        t.eq('across a month end', J.streakNext(s(6, 2026, 10, 31), { y: 2026, m: 11, d: 1 }).days, 7);
        t.eq('across a year end', J.streakNext(s(6, 2026, 12, 31), { y: 2027, m: 1, d: 1 }).days, 7);
        t.eq('across Feb 29', J.streakNext(s(2, 2028, 2, 29), { y: 2028, m: 3, d: 1 }).days, 3);
        t.eq('a clock set backwards starts again', J.streakNext(s(5, 2026, 10, 11), { y: 2026, m: 10, d: 10 }).days, 1);
        t.eq('the count stops at 9999 (five digits would read as personal)', J.streakNext(s(9999, 2026, 10, 9), { y: 2026, m: 10, d: 10 }).days, 9999);
        t.eq('day 1 says nothing', J.streakLine(1), '');
        t.eq('day 3', J.streakLine(3), 'Third day in a row!');
        t.eq('day 14', J.streakLine(14), 'Day 14 in a row!');
        // The decision (2026-10-10): personal() stays strict and the date is stored as separate numbers.
        t.ok('an ISO date would be refused by personal()', J.personal('{"days":3,"last":"2026-10-10"}') !== null);
        let bad = 0;
        for (let i = 0; i < 800; i++) { const d = new Date(2026, 0, 1 + i); if (J.personal(JSON.stringify({ days: 1 + (i * 37) % 9999, ...ymd(d) }))) bad++; }
        for (const days of [1, 99, 999, 9999]) if (J.personal(JSON.stringify({ days, y: 2026, m: 12, d: 31 }))) bad++;
        t.eq('the stored form passes personal() for every day of 2026–2028', bad, 0);
        env.close();
    }
    env = await openDom(page.html, 'https://jarvis.test/jarvis.html', seed({ 'jarvis-streak': JSON.stringify({ days: 2, ...daysAgo(1) }) }));
    try {
        const { window, document } = env, J = window.__jarvis;
        t.eq('visiting the day after day 2 makes it 3', JSON.parse(window.localStorage.getItem('jarvis-streak')).days, 3);
        J.finishBoot();
        t.ok('and the greeting says so', /Third day in a row!$/.test([...document.querySelectorAll('#log .msg.ai')].pop().textContent));
        t.ok('"what do you save" mentions the streak', /your visit streak \(3 days, and the date of your last visit\)/.test(await J.answer('what do you save')));
        J.showBoot ? J.showBoot() : null;
    } finally { env.close(); }
    env = await openDom(page.html, 'https://jarvis.test/jarvis.html', seed({ 'jarvis-streak': JSON.stringify({ days: 9, ...daysAgo(2) }) }));
    try {
        const { window, document } = env, J = window.__jarvis;
        t.eq('after a missed day it starts again at 1', JSON.parse(window.localStorage.getItem('jarvis-streak')).days, 1);
        J.finishBoot();
        t.ok('with no streak line', !/in a row/.test(document.getElementById('log').textContent));
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
        t.eq('the default skin is not saved just by loading', window.localStorage.getItem('jarvis-skin'), null);
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
        t.ok('teaching him a memory statement: he remembers it', /What were you trying to say\?$/.test(await typeIn(env, 'blorp')) && /Got it: your cat is Tom/.test(await typeIn(env, 'I meant my cat is Tom')));
        t.ok('but never learns the phrase, which would save it', !('blorp' in J.learned()));
        const stored = Object.values(allStored(window)).join(' ');
        t.ok('nothing told this visit is anywhere in storage', !/Rex|beach|green|hockey|Tom|Tony|blorp/i.test(stored));
        t.ok('the memory code never calls store()', !/\b(?:store|unstore|saveLearned|saveSettings)\([^)]/.test(page.html.slice(page.html.indexOf('/* ---------- Short-term memory'), page.html.indexOf('/* ---------- Learned phrases'))));
        afterTelling = allStored(window);
        t.ok('"forget that" forgets the last thing', /forgotten that your cat is Tom/.test(await typeIn(env, 'forget that')));
        t.ok('"forget my dog"', /forgotten your dog/.test(await typeIn(env, 'forget my dog')) && /haven't told me about your dog/.test(await typeIn(env, "what's my dog's name")));
        t.ok('"forget everything I told you"', /forgotten everything you told me/.test(await typeIn(env, 'forget everything I told you')) && J.memory().length === 0);
        t.ok('which includes the name', /haven't told me your name/.test(await typeIn(env, 'what is my name')));
        t.eq('no console errors', env.errors.length, 0);
    } finally { env.close(); }
    // A reload is a new page given exactly what the old one left in storage.
    env = await openDom(page.html, 'https://jarvis.test/jarvis.html', seed(afterTelling));
    try {
        const J = env.window.__jarvis;
        t.eq('after a reload, short-term memory is empty', J.memory().length, 0);
        t.ok('"what\'s my dog\'s name" no longer knows', /haven't told me about your dog/.test(await J.answer("what's my dog's name")));
        t.ok('"what do you know about me" says nothing was told', /^You haven't told me anything about you this visit\./.test(await J.answer('what do you know about me')));
    } finally { env.close(); }

    t.section('Memory core (Session 7, no three.js needed)');
    env = await openDom(page.html, 'https://jarvis.test/jarvis.html', seed({ 'jarvis-skin': 'matrix', 'jarvis-settings': '{"color":"blue","units":"imperial"}', 'jarvis-learned': '{"beam me up":"roll a die","lights":"make a star"}', 'jarvis-voices': '{"matrix":"Ralph"}' }));
    try {
        const { window } = env, J = window.__jarvis, ls = window.localStorage;
        for (const q of ['show me your memory', 'memory core', 'open your memories', 'show me the jarvis memory', 'memory'])
            t.eq(`"${q}" opens the memory core`, J.intent(q)?.kind, 'memory');
        for (const q of ['what do you remember', 'forget your memory', 'show me the galaxy'])
            t.ok(`"${q}" does not`, J.intent(q)?.kind !== 'memory');
        await J.answer('my dog is Rex'); J.brain('my name is pepper');
        const stars = J.memoryStars();
        t.eq('one star per setting, the skin, this visit\'s name and memories, each taught phrase, the voice pick, the streak',
            stars.map((s) => s.type).join(','), 'setting,setting,skin,name,visit,phrase,phrase,voice,streak');
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
        t.ok('the streak star', /starts again/.test(J.forgetStar(stars[8])) && ls.getItem('jarvis-streak') === null);
        t.eq('what is left', J.memoryStars().map((s) => s.label).join(' | '), 'Units: imperial | "beam me up"');
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
        t.ok('and lays them out with layoutCallouts', /boxes=layoutCallouts\(pts,bounds,sides\)[\s\S]{0,1500}MEMORY CORE/.test(page.html));
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
        await ask('what can you do');
        const links = [...lastAi().querySelectorAll('button.cmd')];
        t.eq('every marked command is a link in the chat bubble', links.length, marks);
        t.eq('the bubble reads as plain text, with no markers', lastAi().textContent, J.plainText(help));
        t.ok('and no marker is left anywhere in it', !/[⟦⟧|]/.test(lastAi().textContent));
        t.eq('the links take turns through the six stone colours', links.slice(0, 7).map((b) => b.className).join(' '), 'cmd st0 cmd st1 cmd st2 cmd st3 cmd st4 cmd st5 cmd st0');
        t.ok('each is a real button, so it works from the keyboard', links.every((b) => b.tagName === 'BUTTON' && b.type === 'button'));
        t.ok('Jarvis speaks the plain sentence', fake.log.spoken.join(' ').includes('Ask me the time or date, a joke') && !/[⟦⟧]/.test(fake.log.spoken.join(' ')));
        t.ok('and the projector caption is plain too', !/[⟦⟧]/.test(document.getElementById('holo-cap').textContent));
        const joke = links.find((b) => b.textContent === 'a joke');
        t.eq('a link can be worded for the sentence and send the full command', joke?.title, 'Say "tell me a joke"');
        joke.click(); await wait(520);
        const mine = [...document.querySelectorAll('#log .msg.me')].pop().textContent;
        t.eq('clicking it sends the command, as if you had typed it', mine, 'tell me a joke');
        t.ok('and Jarvis answers it', /\?|\./.test(lastAi().textContent) && !/didn't understand/.test(lastAi().textContent));
        links.find((b) => b.textContent === 'flip a coin').click(); await wait(520);
        t.ok('another link: flip a coin', /^It's (heads|tails)\.$/.test(lastAi().textContent));
        // "Didn't understand" lists what he can do, with links too.
        await ask('blorp the snorkel');
        const canDo = [...lastAi().querySelectorAll('button.cmd')];
        t.ok('the "I didn\'t understand" answer has links too', canDo.length >= 12 && /What were you trying to say\?$/.test(lastAi().textContent));
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
        for (const c of cmds) { const r = await J.answer(c); if (typeof r === 'string' && /didn't understand|What were you trying to say/.test(r)) missed.push(c); }
        t.eq(`all ${cmds.length + 1} link commands are understood`, missed.join(', '), '');
        t.ok('reboot is one of them, and powers him up again', J.chipCmds().includes('reboot') && (await J.answer('reboot'), !env.document.getElementById('boot').hidden));
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
