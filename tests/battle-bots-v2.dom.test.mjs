/* battle-bots-V2 — the DOM half, but not through `openDom`.
 *
 * Every other DOM suite in this repo (`tricalc.dom`, `ai-swarm.dom`,
 * `race-day.dom`) hands the WHOLE real page to jsdom with `runScripts:
 * 'dangerously'` and lets the page's own script run, then reads results off
 * a `window.__pagename` hook the page exposes for exactly this. That doesn't
 * work here for two unrelated reasons:
 *
 *   1. battle-bots-V2 has no such hook — its state lives inside each ES
 *      module's own closure (`ui.js`'s `teamConfig`), not on `window`.
 *   2. `main.js` calls `paintIdleArena()` at import time, which calls
 *      `canvas.getContext('2d').fillRect(...)` — jsdom has no `<canvas>`
 *      backend without the native `canvas` package, so `getContext('2d')`
 *      returns `null` and that throws before anything else can run.
 *      Starting an actual match makes this worse: `initAudio()` needs
 *      `window.AudioContext`, which jsdom also doesn't implement.
 *
 * So this suite parses the real `index.html` with `runScripts: 'outside-only'`
 * (the markup and CSS load; the embedded `<script type="module">` does not
 * run), points `global.document` at that parsed DOM, and imports `ui.js`
 * directly — a unit test of one module against a real document, rather than
 * a full-page integration test. That sidesteps both problems: nothing calls
 * `paintIdleArena` or `initAudio` because `main.js` never executes.
 *
 * See `battle-bots-v2.core.test.mjs` for why a remote target still works —
 * GitHub Pages serves these same static files even though the functional
 * deployment is on Vercel.
 */

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { requireJsdom } from './lib/page.mjs';
import { resolveModuleDir } from './lib/bots-modules.mjs';

export const name = 'battle-bots-V2 — control panel wiring';

const MODULE_FILES = ['state.js', 'memory.js', 'teams.js', 'skills.js', 'entities.js', 'arena.js', 'audio.js', 'ui.js'];

export default async function run(t, page) {
    let dir, cleanup;
    try {
        ({ dir, cleanup } = await resolveModuleDir(page, MODULE_FILES));
    } catch (error) {
        t.ok('battle-bots-V2 module files are reachable', false);
        t.note(error.message);
        return;
    }
    const modUrl = (file) => pathToFileURL(join(dir, file)).href;

    const { JSDOM } = await requireJsdom();
    const dom = new JSDOM(page.html, { url: page.url, runScripts: 'outside-only' });
    const previousDocument = globalThis.document;
    const previousWindow = globalThis.window;
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;

    try {
        let ui;
        try {
            ui = await import(modUrl('ui.js'));
        } catch (error) {
            t.ok('ui.js imports cleanly against the real index.html', false);
            t.note(error.message);
            return;
        }

        t.section('Defaults match the slowdown balance change');
        const teams = ui.activeTeams();
        t.ok('at least one team is active by default', teams.length > 0);
        const firstTeam = teams[0];
        t.eq(`${firstTeam} default speed is 25 (20% of the old 125 default)`, ui.getTeamConfig(firstTeam).speed, 25);
        t.eq(`${firstTeam} default weapon is rapid`, ui.getTeamConfig(firstTeam).weapon, 'rapid');

        ui.renderTeamPanels();
        const speedSlider = document.getElementById(`cfg-${firstTeam}-spd`);
        t.ok('speed slider exists after rendering the panel', !!speedSlider);
        if (speedSlider) t.eq('speed slider min matches the new default (25, not the old 30)', speedSlider.min, '25');

        t.section('The weapon dropdown actually drives the team config');
        const weaponSelect = document.getElementById(`cfg-${firstTeam}-weapon`);
        t.ok('weapon dropdown exists', !!weaponSelect);
        if (weaponSelect) {
            const options = [...weaponSelect.options].map(o => o.value);
            t.ok('weapon dropdown offers all four weapons', ['rapid', 'shotgun', 'railgun', 'homing'].every(w => options.includes(w)));

            weaponSelect.value = 'homing';
            weaponSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
            t.eq('picking a weapon updates the team config', ui.getTeamConfig(firstTeam).weapon, 'homing');

            // A mode switch rebuilds the whole panel from scratch (innerHTML replace) —
            // this is what would silently revert the pick if the config weren't the
            // source of truth for which <option> gets `selected`.
            ui.renderTeamPanels();
            const rebuilt = document.getElementById(`cfg-${firstTeam}-weapon`);
            t.eq('the pick survives a panel re-render (a mode switch)', rebuilt.value, 'homing');
        }

        t.section("The stats table shows each bot's actual weapon (WPN column)");
        const { world, resetWorld } = await import(modUrl('state.js'));
        const { Bot } = await import(modUrl('entities.js'));
        resetWorld();
        world.bots.push(new Bot(0, 0, { id: 'red-1', team: firstTeam, color: '#f00', hp: 225, speed: 25, weapon: 'railgun' }));
        ui.renderStats();
        const statsHtml = document.getElementById('stats-body').innerHTML;
        const headers = [...document.querySelectorAll('#stats-body th')].map(th => th.textContent);
        t.ok('WPN header is present', headers.includes('WPN'));
        t.ok("the bot's equipped weapon (Railgun) is shown in the row", statsHtml.includes('Railgun'));
    } finally {
        globalThis.document = previousDocument;
        globalThis.window = previousWindow;
        try { dom.window.close(); } catch { /* already gone */ }
        await cleanup();
    }
}
