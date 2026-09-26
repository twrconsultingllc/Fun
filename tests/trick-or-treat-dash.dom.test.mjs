/* trick-or-treat-dash.html: the runner's physics, spawning fairness,
 * scoring, saved progress and costume unlocks, driven in jsdom through
 * `window.__dash`.
 *
 * jsdom has no 2D canvas backend (see CLAUDE.md), so `stubCanvas` hands back
 * a Proxy whose every method returns the Proxy itself. That lets the page's
 * drawing code (including `createLinearGradient(...).addColorStop(...)`) run
 * to completion without drawing anything, the same idea as snake.dom.test.mjs.
 *
 * The simulation (`step(dt)`) is DOM-free, so most checks switch the page's
 * real-time loop off with `setManual(true)` and step it frame by frame at a
 * fixed 1/120 s. The headline check is "every obstacle can be cleared at the
 * slowest and fastest speed it can appear at": it searches jump timings using
 * the page's own physics rather than trusting the tuning numbers.
 *
 * The page is loaded at an https:// URL (not file://) so jsdom gives it a
 * real localStorage, the same approach as academy.dom.test.mjs.
 */

import { openDom } from './lib/page.mjs';

export const name = 'Trick-or-Treat Dash: physics, fairness, candy and costumes';

const URL_ = 'https://dash.test/trick-or-treat-dash.html';
const STORE = 'fun.trickOrTreatDash.v1';
const DT = 1 / 120;

function stubCanvas(window) {
    window.HTMLCanvasElement.prototype.getContext = function () {
        const target = {};
        const proxy = new Proxy(target, {
            get: (t, prop) => (prop in t ? t[prop] : () => proxy),
            set: (t, prop, value) => { t[prop] = value; return true; }
        });
        return proxy;
    };
}

async function open(page, storage) {
    return openDom(page.html, URL_, {
        beforeParse(w) {
            stubCanvas(w);
            if (storage !== undefined) w.localStorage.setItem(STORE, storage);
        }
    });
}

/* Run one obstacle past the kid. `jumpAt`: jump when the obstacle's front is
 * this many px ahead of the kid's centre (null = never jump). `doubleAfter`:
 * seconds after the first jump to double-jump (null = never). Returns true
 * when the kid gets past without being hit. */
function tryObstacle(api, diff, kind, speed, jumpAt, doubleAfter) {
    const { state, CFG } = api;
    api.start(diff);
    api.setManual(true);
    api.clearWorld();
    state.speed = speed;
    const o = api.spawnPattern(kind);
    state.candies = [];
    state.untilNext = 1e9;
    state.powerIn = 1e9;
    const hearts = state.hearts, candy = state.candy;
    let jumped = false, jumpT = 0, doubled = false;
    for (let i = 0; i < 20000 && o.x + o.w > CFG.KID_X - 80; i++) {
        if (!jumped && jumpAt !== null && o.x - CFG.KID_X <= jumpAt) { api.jump(); jumped = true; jumpT = state.t; }
        if (jumped && !doubled && doubleAfter !== null && state.t - jumpT >= doubleAfter) { api.jump(); doubled = true; }
        api.step(DT);
        if (state.mode !== 'playing') return false;
    }
    return state.hearts === hearts && state.candy === candy && !o.cleared;
}

function findClear(api, diff, kind, speed) {
    const doubles = [null, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4];
    if (tryObstacle(api, diff, kind, speed, null, null)) return { jumpAt: null, doubleAfter: null };
    for (let jumpAt = 0; jumpAt <= 700; jumpAt += 10) {
        for (const d of doubles) if (tryObstacle(api, diff, kind, speed, jumpAt, d)) return { jumpAt, doubleAfter: d };
    }
    return null;
}

export default async function run(t, page) {
    let env;
    try {
        env = await open(page);
    } catch (error) {
        t.ok('the page opens in jsdom', false);
        t.note(error.message);
        return;
    }
    const opened = [env];
    const { window, document, errors } = env;
    const $ = (id) => document.getElementById(id);

    try {
        t.section('Booting');
        t.eq('the page script ran without throwing', errors.length, 0);
        if (errors.length) t.note(errors.join('\n       '));
        const api = window.__dash;
        t.ok('the page exposes its test hook', !!api);
        if (!api) return;
        const { CFG, OBST, COSTUMES, state } = api;
        const N = CFG.modes.normal;

        const html = page.html;
        t.ok('CSP meta is present', /http-equiv="Content-Security-Policy"/.test(html));
        t.ok('CSP blocks plugins and base-tag hijacking', /object-src 'none'/.test(html) && /base-uri 'none'/.test(html));
        t.ok('referrer policy is set', /name="referrer" content="strict-origin-when-cross-origin"/.test(html));
        t.ok('the page loads nothing from another origin', !/(src|href)="https?:/i.test(html) && !/@import|url\(\s*['"]?https?:/i.test(html));
        t.ok('no inline event handler attributes', !/\son[a-z]+="/i.test(html));
        t.ok('there is a way back to the arcade', !!document.querySelector('a[href="index.html"]'));

        /* -------------------------------------------------------------- */
        t.section('Title screen and a fresh save');
        t.eq('the title panel shows first', $('title-panel').classList.contains('hidden'), false);
        t.eq('the touch JUMP button is hidden on the menu', document.body.dataset.menu, 'yes');
        t.eq('Normal is the default mode', document.querySelector('.choice[aria-pressed="true"]').dataset.mode, 'normal');
        t.eq('8 costumes', document.querySelectorAll('.costume').length, 8);
        t.eq('with no save, only the Ghost is unlocked', document.querySelectorAll('.costume:not(:disabled)').length, 1);
        t.ok('locked costumes say how much candy they need', /locked: collect 40 candy/.test(document.querySelector('.costume[data-id="cat"]').getAttribute('aria-label')));
        t.eq('choosing a locked costume is refused', api.chooseCostume('unicorn'), false);
        const needs = COSTUMES.map((c) => c.need);
        t.ok('unlock thresholds rise with every costume', needs.every((n, i) => i === 0 || n > needs[i - 1]) && needs[0] === 0);

        /* -------------------------------------------------------------- */
        t.section('Jump physics');
        api.start('normal');
        api.setManual(true);
        api.clearWorld();
        t.eq('...and shown once a run starts', document.body.dataset.menu, 'no');
        const k = state.kid;
        api.jump();
        let peak = 0, air = 0;
        for (let i = 0; i < 1000; i++) { api.step(DT); air += DT; peak = Math.max(peak, k.y); if (k.y === 0) break; }
        const wantPeak = N.jump * N.jump / (2 * N.g);
        t.near('a jump peaks at v²/2g', peak, wantPeak, 3);
        t.near('a jump lasts 2v/g seconds', air, 2 * N.jump / N.g, 0.02);
        t.eq('the kid lands back on the pavement', k.y, 0);
        const peakAt = (dt) => { api.jump(); let p = 0; for (let i = 0; i < 2000; i++) { api.step(dt); p = Math.max(p, k.y); if (k.y === 0) break; } return p; };
        const p30 = peakAt(1 / 30), p144 = peakAt(1 / 144);
        t.near('jump height is the same at 30 fps and 144 fps', p30, p144, 4);
        t.ok('a jump from the ground works', api.jump());
        api.step(0.05); api.step(0.05);
        const yAtDouble = k.y;
        t.near('after 0.1 s the kid is at v·t − g·t²/2', yAtDouble, N.jump * 0.1 - N.g * 0.01 / 2, 0.01);
        t.ok('a second jump in the air works (double jump)', api.jump());
        t.eq('a third jump in the air does not', api.jump(), false);
        let peak2 = 0;
        for (let i = 0; i < 1000; i++) { api.step(DT); peak2 = Math.max(peak2, k.y); if (k.y === 0) break; }
        t.near('the double jump adds v₂²/2g on top of where it started', peak2, yAtDouble + N.jump2 * N.jump2 / (2 * N.g), 3);
        t.ok('...which is higher than a single jump', peak2 > wantPeak);
        t.eq('landing resets the jump count', k.jumps, 0);
        api.jump(); api.release(); api.step(DT * 6);
        t.ok('letting go straight away still gives a full jump (no tiny hops)', k.vy > N.jump - N.g * DT * 7 - 1);

        /* -------------------------------------------------------------- */
        t.section('Every obstacle can be cleared at every speed it appears at');
        for (const diff of ['easy', 'normal']) {
            const m = CFG.modes[diff];
            for (const kind of new Set(m.kinds)) {
                for (const [label, speed] of [['slowest', m.start], ['fastest', m.max]]) {
                    const how = findClear(api, diff, kind, speed);
                    const desc = !how ? 'none found' : how.jumpAt === null ? 'stay on the ground' :
                        'jump ' + how.jumpAt + ' px ahead' + (how.doubleAfter !== null ? ', double after ' + how.doubleAfter + ' s' : '');
                    t.ok(`${diff}: ${OBST[kind].label} at ${label} speed (${speed} px/s) — ${desc}`, !!how);
                }
            }
        }
        // Clearable isn't enough for a 6-year-old: the timing window has to be forgiving.
        const MIN_MS = { easy: 350, normal: 250 };
        for (const diff of ['easy', 'normal']) {
            const m = CFG.modes[diff];
            for (const kind of new Set(m.kinds)) {
                if (OBST[kind].duck) continue; // bats: staying on the ground always works
                for (const speed of [m.start, m.max]) {
                    let best = 0;
                    for (const d of OBST[kind].tall ? [0.2, 0.25, 0.3, 0.35, 0.4] : [null]) {
                        let ok = 0;
                        for (let ja = 0; ja <= 800; ja += 4) if (tryObstacle(api, diff, kind, speed, ja, d)) ok++;
                        best = Math.max(best, ok);
                    }
                    const ms = Math.round((best * 4) / speed * 1000);
                    t.ok(`${diff}: ${OBST[kind].label} at ${speed} px/s gives a ≥ ${MIN_MS[diff]} ms jump window (${ms} ms)`, ms >= MIN_MS[diff]);
                }
            }
        }
        t.eq('the giant ghost really needs the double jump', [0, 50, 100, 150, 200, 250, 300].some((j) => tryObstacle(api, 'normal', 'ghost', 320, j, null)), false);
        t.eq('bats are cleared by staying on the ground', tryObstacle(api, 'normal', 'bat', 700, null, null), true);
        t.ok('...and jumping into one hurts', [60, 90, 120, 150].some((j) => !tryObstacle(api, 'normal', 'bat', 320, j, null)));
        t.eq('an obstacle you do nothing about hits you', tryObstacle(api, 'normal', 'tomb', 320, null, null), false);

        /* -------------------------------------------------------------- */
        t.section('Spawning leaves room to land and react');
        for (const diff of ['easy', 'normal']) {
            const m = CFG.modes[diff];
            api.seed(42);
            api.start(diff);
            api.setManual(true);
            const spawns = [];
            const seen = new Set();
            for (let i = 0; i < 60 * 120 && state.mode === 'playing'; i++) {
                state.shield = 1e9; // survive every hit so the run keeps going
                api.step(1 / 60);
                for (const o of state.obstacles) {
                    if (seen.has(o)) continue;
                    seen.add(o);
                    spawns.push({ o, dist: state.dist, speed: state.speed, kind: o.kind });
                }
            }
            let tight = [];
            for (let i = 1; i < spawns.length; i++) {
                const prev = spawns[i - 1], cur = spawns[i];
                const sep = cur.dist - prev.dist;
                // Worst case: the next obstacle reaches the kid ~1.5 s after it spawns.
                const v = Math.min(m.max, cur.speed + m.accel * 1.5);
                const need = v * (api.airTime() + m.reaction) + OBST[prev.kind].w + CFG.KID_W;
                if (sep < need) tight.push(`${prev.kind}→${cur.kind}: ${Math.round(sep)} < ${Math.round(need)}`);
            }
            t.ok(`${diff}: a 2-minute run spawns plenty of obstacles`, spawns.length > 30);
            t.eq(`${diff}: every gap leaves a full jump plus ${m.reaction} s to react`, tight.length, 0);
            if (tight.length) t.note(tight.slice(0, 5).join('\n       '));
            const kinds = new Set(spawns.map((s) => s.kind));
            t.ok(`${diff}: only spawns its own obstacle kinds`, [...kinds].every((x) => m.kinds.includes(x)));
            if (diff === 'easy') t.ok('easy: no giant ghosts or bats', !kinds.has('ghost') && !kinds.has('bat'));
            else t.ok('normal: every obstacle kind shows up', ['puddle', 'pumpkin', 'tomb', 'ghost', 'bat'].every((x) => kinds.has(x)));
            t.ok(`${diff}: speed ramps up and stops at the cap`, state.speed <= m.max && state.speed > m.start);
        }

        /* -------------------------------------------------------------- */
        t.section('Candy and power-ups');
        api.start('normal');
        api.setManual(true);
        api.clearWorld();
        api.addCandy('corn', CFG.KID_X, 26);
        api.addCandy('pop', CFG.KID_X + 5, 26);
        api.addCandy('bar', CFG.KID_X + 10, 26);
        api.step(DT);
        t.eq('candy corn + lollipop + chocolate = 1 + 2 + 5', state.candy, 8);
        t.eq('the HUD shows it', $('hud-candy').textContent, '8');
        api.addCandy('corn', CFG.KID_X, 130);
        api.step(DT);
        t.eq('candy up high is not collected from the ground', state.candy, 8);

        api.addCandy('magnet', CFG.KID_X, 26);
        api.step(DT);
        t.ok('grabbing 🧲 turns the magnet on', state.magnet > 0);
        const far = api.addCandy('corn', CFG.KID_X + 220, 110);
        for (let i = 0; i < 60; i++) { state.speed = 0; api.step(DT); }
        t.ok('the magnet pulls in candy that is out of reach', far.got);
        state.magnet = 0;

        api.addCandy('shield', CFG.KID_X, 26);
        api.step(DT);
        t.ok('grabbing ⭐ turns the shield on', state.shield > 0);
        state.speed = 320;
        const hBefore = state.hearts;
        t.ok('the shielded kid runs straight through a tombstone', tryShield(api));
        t.eq('...without losing a heart', state.hearts, hBefore);

        /* -------------------------------------------------------------- */
        t.section('Hearts and game over (normal)');
        // Earlier sections finished an easy run, which banked candy: start from zero.
        window.localStorage.removeItem(STORE);
        Object.assign(api.save, { lifetime: 0, best: { easy: 0, normal: 0 }, costume: 'ghost' });
        api.start('normal');
        api.setManual(true);
        api.clearWorld();
        state.candy = 45;
        const hitOnce = () => { const o = api.spawnPattern('tomb'); state.candies = []; state.untilNext = 1e9; o.x = CFG.KID_X - 10; api.step(DT); };
        hitOnce();
        t.eq('a hit costs one heart', state.hearts, 2);
        t.ok('...and makes the kid briefly invulnerable', state.kid.inv > 0);
        hitOnce();
        t.eq('no second hit while invulnerable', state.hearts, 2);
        state.kid.inv = 0; hitOnce();
        state.kid.inv = 0; hitOnce();
        t.eq('three hits end the run', state.mode, 'over');
        t.ok('the game-over panel shows', !$('over-panel').classList.contains('hidden'));
        t.ok('...with the candy total', /45 candy/.test($('over-stats').textContent));
        t.ok('...and the Black Cat unlock (40 candy)', /Black Cat/.test($('over-unlock').textContent));
        const saved = JSON.parse(window.localStorage.getItem(STORE));
        t.eq('lifetime candy is saved', saved.lifetime, 45);
        t.eq('best is saved per mode', saved.best.normal, 45);
        t.eq('stepping after game over does nothing', (api.step(DT), state.mode), 'over');
        $('menu-btn').click();
        t.eq('Change costume returns to the title', $('title-panel').classList.contains('hidden'), false);
        t.eq('the Black Cat is now unlocked', document.querySelector('.costume[data-id="cat"]').disabled, false);
        document.querySelector('.costume[data-id="cat"]').click();
        t.eq('and can be chosen', JSON.parse(window.localStorage.getItem(STORE)).costume, 'cat');

        /* -------------------------------------------------------------- */
        t.section('Easy mode: no game over, a finish line');
        api.toMenu();
        api.chooseMode('easy');
        t.eq('switching to Easy on the title after a Normal game over is safe', errors.length, 0);
        t.eq('...and the HUD shows the flag instead of hearts', $('hud-lives').textContent, '🏁');
        api.chooseMode('normal');
        t.eq('switching back shows full hearts, not the last run\'s', $('hud-lives').textContent, '❤️❤️❤️');
        api.chooseMode('easy');
        api.start();
        api.setManual(true);
        api.clearWorld();
        state.candy = 10;
        for (let i = 0; i < 6; i++) { state.kid.inv = 0; hitOnce(); }
        t.eq('six hits and still running', state.mode, 'playing');
        t.eq('each bump costs 3 candy instead (10 → 0, never negative)', state.candy, 0);
        t.eq('the HUD shows the finish distance', $('hud-dist').textContent, Math.floor(state.dist / CFG.PX_PER_M) + ' / 600 m');
        state.dist = 600 * CFG.PX_PER_M - 5;
        state.speed = 400;
        for (let i = 0; i < 10 && state.mode === 'playing'; i++) api.step(DT);
        t.eq('reaching 600 m ends the run', state.mode, 'over');
        t.eq('...as a finish, not a loss', state.finished, true);
        t.ok('...with the finish message', /end of the street/.test($('over-title').textContent));
        api.chooseMode('normal');

        /* -------------------------------------------------------------- */
        t.section('Keyboard, pause and focus');
        api.start('normal');
        api.setManual(true);
        api.clearWorld();
        const space = new window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
        document.dispatchEvent(space);
        t.ok('Space jumps', state.kid.jumps === 1);
        t.ok('...and doesn\'t scroll the page', space.defaultPrevented);
        document.dispatchEvent(new window.KeyboardEvent('keyup', { key: ' ', bubbles: true }));
        document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
        t.eq('↑ double-jumps', state.kid.jumps, 2);
        document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'p', bubbles: true, cancelable: true }));
        t.eq('P pauses', state.mode, 'paused');
        t.ok('the pause panel shows', !$('pause-panel').classList.contains('hidden'));
        const d0 = state.dist;
        api.step(0.05);
        t.eq('nothing moves while paused', state.dist, d0);
        $('resume-btn').click();
        t.eq('Keep running resumes', state.mode, 'playing');
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new window.Event('visibilitychange'));
        t.eq('switching tabs pauses the game', state.mode, 'paused');
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        $('end-btn').click();
        t.eq('End this run goes to the game-over panel', state.mode, 'over');

        /* -------------------------------------------------------------- */
        t.section('The real-time loop');
        api.setManual(false);
        api.start('normal');
        await new Promise((r) => setTimeout(r, 400));
        t.ok('with the loop running, the kid actually moves forward', state.dist > 0);
        api.setManual(true);
        api.togglePause(true);

        /* -------------------------------------------------------------- */
        t.section('Sound without Web Audio');
        t.ok('jsdom has no AudioContext', typeof window.AudioContext === 'undefined');
        let threw = false;
        try { ['jump', 'jump2', 'candy', 'power', 'bonk', 'oops', 'over', 'finish', 'nope'].forEach((n) => api.Sound.play(n, 5)); } catch { threw = true; }
        t.ok('every sound call is a silent no-op', !threw);
        $('sound-btn').click();
        t.eq('the sound button mutes', $('sound-btn').getAttribute('aria-pressed'), 'false');
        t.eq('...and the choice is saved', JSON.parse(window.localStorage.getItem(STORE)).muted, true);
        t.eq('nothing threw during the whole run', errors.length, 0);
        if (errors.length) t.note(errors.join('\n       '));

        /* -------------------------------------------------------------- */
        t.section('Saved progress is validated on load');
        const cases = [
            ['a good save', JSON.stringify({ lifetime: 130, best: { easy: 12, normal: 88 }, costume: 'witch', muted: true }),
                (a) => a.save.lifetime === 130 && a.save.best.normal === 88 && a.save.costume === 'witch' && a.save.muted === true],
            ['a costume that isn\'t unlocked yet', JSON.stringify({ lifetime: 10, costume: 'unicorn' }), (a) => a.save.costume === 'ghost'],
            ['numbers as strings, negatives and fractions', JSON.stringify({ lifetime: '9999', best: { easy: -5, normal: 2.5 } }),
                (a) => a.save.lifetime === 0 && a.save.best.easy === 0 && a.save.best.normal === 0],
            ['a made-up costume id', JSON.stringify({ lifetime: 5000, costume: '<img src=x onerror=alert(1)>' }), (a) => a.save.costume === 'ghost'],
            ['corrupt JSON', '{not json', (a) => a.save.lifetime === 0 && a.save.costume === 'ghost'],
            ['a JSON string instead of an object', '"hello"', (a) => a.save.lifetime === 0]
        ];
        for (const [label, raw, check] of cases) {
            const e2 = await open(page, raw);
            opened.push(e2);
            const a = e2.window.__dash;
            t.ok(`${label} → loads safely`, !!a && e2.errors.length === 0 && check(a));
        }
        const good = opened[1].window;
        t.eq('a good save unlocks costumes up to its total', good.document.querySelectorAll('.costume:not(:disabled)').length, 3);
        t.eq('...and restores the mute button', good.document.getElementById('sound-btn').getAttribute('aria-pressed'), 'false');
    } finally {
        for (const e of opened) e.close();
    }
}

function tryShield(api) {
    const { state, CFG } = api;
    const o = api.spawnPattern('tomb');
    state.candies = [];
    state.untilNext = 1e9;
    state.powerIn = 1e9;
    for (let i = 0; i < 2000 && o.x + o.w > CFG.KID_X - 80; i++) { api.step(DT); if (state.mode !== 'playing') return false; }
    return o.cleared === true;
}
