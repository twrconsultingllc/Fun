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
import { openDom } from './lib/page.mjs';

// The self-hosted hand tracker, pinned (see jarvis/hands/README.md).
const HAND_FILES = {
    'vision_bundle.js': 'e77f281f9619150d937023c355bae170e9120e3b9e43f1e23a2a7bee07197669',
    'vision_wasm_internal.js': '9440cf0cc0cea21800e31581ec32aeedcc5fbf9df4509796bbc7d3f99e52ab9c',
    'vision_wasm_internal.wasm': 'f82a8e6c05e08a44cc9f9e7ec5f845935bcbb1b1500ebe8c2f4812fb4e2917dc',
    'hand_landmarker.task': 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1'
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
        t.eq('"my name is tony" is', brain('my name is tony'), "Nice to meet you, Tony. I'll remember that on this device.");
        t.eq('the name is remembered on this device', window.localStorage.getItem('jarvis-name'), 'Tony');
        t.ok('the name is used in greetings', /Tony/.test(brain('hello')));
        t.ok('help lists what it can do', /flip a coin/.test(brain('what can you do')));
        t.ok('help mentions the holo-projector', /show me the galaxy/.test(brain('help')));
        t.ok('unknown questions get a fallback', /demo|databanks|brain/.test(brain('what is the capital of peru')));

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

        t.section('Projector without WebGL');

        const scriptsBefore = document.querySelectorAll('script').length;
        const answer = await window.__jarvis.project({ kind: 'galaxy' });
        t.ok('says it needs WebGL', /needs WebGL/.test(answer));
        t.ok('the neural network says so too', /needs WebGL/.test(await window.__jarvis.project({ kind: 'neural' })));
        t.ok('and the suit', /needs WebGL/.test(await window.__jarvis.project({ kind: 'suit', arg: 'assemble' })));
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
