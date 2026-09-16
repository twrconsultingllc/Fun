/* snake.html — rival AI snakes and the expanded food roster, driven in jsdom.
 *
 * jsdom has no 2D canvas backend without the optional `canvas` package (see
 * the note in CLAUDE.md about battle-bots-V2), so `getContext('2d')` returns
 * null and the page's self-scheduling requestAnimationFrame loop would throw
 * on its first draw() and never reschedule itself. `stubCanvas` below hands
 * back a Proxy that no-ops every method/property the page's drawing code
 * touches, the same technique ai-swarm.dom.test.mjs uses, so the loop keeps
 * running and the game's actual simulation (movement, collisions, food) is
 * exercised for real through `window.__snake`.
 *
 * The rival AI picks a direction fresh every tick (greedy toward the nearest
 * food, steering away from anything lethal), so getting it to walk into a
 * specific cell on cue means cornering it for real: obstacles block every
 * direction except the one under test, food is cleared so it has no target
 * to chase, and Math.random is pinned so its "which safe-ish option" pick
 * lands on a known index. That mirrors the in-game strategy the guide
 * describes — "cut one off and it dies instead" — rather than special-casing
 * anything in the game code itself.
 */

import { openDom } from './lib/page.mjs';

export const name = 'Snake — rival snakes and food';

function stubCanvas(window) {
    window.HTMLCanvasElement.prototype.getContext = function () {
        const noop = () => {};
        return new Proxy({}, {
            get: (target, prop) => (prop in target ? target[prop] : noop),
            set: (target, prop, value) => { target[prop] = value; return true; }
        });
    };
}

async function open(html, url) {
    return openDom(html, url, { beforeParse: stubCanvas });
}

export default async function run(t, page) {
    let env;
    try {
        env = await open(page.html, page.url);
    } catch (error) {
        t.ok('the page opens in jsdom', false);
        t.note(error.message);
        return;
    }

    const { window, errors } = env;

    try {
        t.section('Booting');

        t.eq('the page script ran without throwing', errors.length, 0);
        if (errors.length) t.note(errors.join('\n       '));

        const api = window.__snake;
        t.ok('the page exposes its test hooks', !!api);
        if (!api) return;

        /* -------------------------------------------------------------- */
        t.section('New food types');

        const kinds = Object.keys(api.FOOD_TYPES);
        t.ok('triangle is a new food kind', kinds.includes('triangle'));
        t.ok('shard is a new food kind', kinds.includes('shard'));
        t.ok('the original kinds are all still there', ['pip', 'cube', 'star', 'orb', 'fruit'].every((k) => kinds.includes(k)));

        // Level 1 is deliberately plain (pip/cube only) — check the fuller
        // distribution that kicks in from level 2 on.
        api.setLevel(2);
        let sawTriangle = false, sawShard = false, sawUnknown = false;
        for (let i = 0; i < 500; i++) {
            const kind = api.rollFoodType();
            if (!kinds.includes(kind)) sawUnknown = true;
            if (kind === 'triangle') sawTriangle = true;
            if (kind === 'shard') sawShard = true;
        }
        t.ok('rollFoodType() only ever returns a known kind', !sawUnknown);
        t.ok('rollFoodType() can produce triangle food', sawTriangle);
        t.ok('rollFoodType() can produce shard food', sawShard);
        api.setLevel(1);

        /* -------------------------------------------------------------- */
        t.section('Rival snakes populate the board');

        api.buildLevel();
        const expected = api.enemyCountForLevel();
        t.eq('at least one rival snake spawns at level 1', api.enemies.length > 0, true);
        t.ok('the spawned count is within the level/difficulty formula', api.enemies.length <= expected);

        const cells = new Set();
        let overlap = false;
        const claim = (x, y) => {
            const k = x + ',' + y;
            if (cells.has(k)) overlap = true;
            cells.add(k);
        };
        for (const seg of api.snake) claim(seg.x, seg.y);
        for (const o of api.obstacles) claim(o.x, o.y);
        for (const e of api.enemies) for (const seg of e.body) claim(seg.x, seg.y);
        for (const f of api.foods) claim(f.x, f.y);
        t.ok('nothing spawns on top of anything else', !overlap);

        /* -------------------------------------------------------------- */
        t.section('Running into a rival snake kills the player');

        api.buildLevel();
        api.play();
        const livesBefore = api.lives;
        const head = api.snake[0];
        api.enemies.length = 0;
        // A rival lying across the player's path, two cells ahead.
        api.addEnemy(head.x + 2, head.y, 1, 0);
        api.setDir(1, 0);
        api.step();   // moves onto (head.x+1, head.y) — the rival's middle segment
        t.eq('the player died', api.state === 'DEAD' || api.state === 'GAMEOVER', true);
        t.eq('and lost a life', api.lives, livesBefore - 1);

        /* -------------------------------------------------------------- */
        t.section('A rival that runs into the player dies instead');

        api.buildLevel();
        api.play();
        api.foods.length = 0;          // no food to chase, so the AI's fallback pick is what we pin below
        api.obstacles.length = 0;
        api.enemies.length = 0;
        const victim = api.snake[1];   // stays put — the player itself never steps in this scenario
        const rx = victim.x, ry = victim.y - 1;
        api.obstacles.push({ x: rx + 1, y: ry }, { x: rx - 1, y: ry }); // wall off every way but down, into the player
        const rival = api.addEnemy(rx, ry, 0, 1);
        const livesBefore2 = api.lives;
        const origRandom = window.Math.random;
        window.Math.random = () => 0.99;   // forces the 3rd of [right, left, down] — "down", into the player
        api.stepEnemies();
        window.Math.random = origRandom;
        t.eq('the rival snake is removed from the board', api.enemies.includes(rival), false);
        t.eq('the player is unharmed', api.lives, livesBefore2);
        t.eq('the player is still playing', api.state, 'PLAYING');

        /* -------------------------------------------------------------- */
        t.section('A head-on crash kills both');

        api.buildLevel();
        api.play();
        api.foods.length = 0;
        api.obstacles.length = 0;
        api.enemies.length = 0;
        const h3 = api.snake[0];
        const ex = h3.x + 2, ey = h3.y;
        api.obstacles.push({ x: ex, y: ey - 1 }, { x: ex, y: ey + 1 }); // wall off every way but left, into the player
        api.addEnemy(ex, ey, -1, 0);   // heading straight at the player
        const livesBefore3 = api.lives;
        api.setDir(1, 0);
        api.step();                    // player moves to (h3.x+1, h3.y)
        const origRandom2 = window.Math.random;
        window.Math.random = () => 0.01;   // forces the 1st of [left, down, up] — "left", the head-on cell
        api.stepEnemies();
        window.Math.random = origRandom2;
        t.eq('the player died in the head-on crash', api.state === 'DEAD' || api.state === 'GAMEOVER', true);
        t.eq('and lost a life', api.lives, livesBefore3 - 1);
        t.eq('the rival is gone too', api.enemies.length, 0);
    } finally {
        env.close();
    }
}
