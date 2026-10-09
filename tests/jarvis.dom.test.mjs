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
 * scenes themselves were checked in headless Chromium (tests/secrpts/37.html). */

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

        t.section('Projector without WebGL');

        const scriptsBefore = document.querySelectorAll('script').length;
        const answer = await window.__jarvis.project({ kind: 'galaxy' });
        t.ok('says it needs WebGL', /needs WebGL/.test(answer));
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
}
