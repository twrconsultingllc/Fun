/* haunted-house.html: the scare-level picker, the age gate and the whole
 * search-and-escape loop, driven in jsdom through `window.__haunted`.
 *
 * The page draws with inline SVG and DOM buttons (no canvas, no WebGL), so
 * jsdom runs it for real, with no stubs. Web Audio is absent under jsdom,
 * which also pins the "no audio support" path: every sound call must be a
 * silent no-op rather than an exception.
 *
 * Timers matter on this page (the hunter's hide window, scare auto-dismiss),
 * so the suite drives time through the hook (`tick`, `caught`, `dismissScare`)
 * rather than waiting on real setTimeouts.
 */

import { openDom } from './lib/page.mjs';

export const name = 'Haunted House Explorer: scare levels and gameplay';

/* Every text variant a level can show, for the content checks. */
function allTextsForLevel(api, n) {
    const L = api.LEVELS[n];
    const out = [];
    for (const room of Object.values(api.ROOMS)) {
        out.push(room.desc[n - 1]);
        for (const h of room.hotspots) if (h.text) out.push(h.text[L.tier]);
    }
    return out.concat(L.toasts.map((t) => t[1]), L.ambient, L.extras || [], [L.intro, L.win.text]);
}

export default async function run(t, page) {
    let env;
    try {
        env = await openDom(page.html, page.url);
    } catch (error) {
        t.ok('the page opens in jsdom', false);
        t.note(error.message);
        return;
    }
    const { window, document, errors } = env;
    const $ = (id) => document.getElementById(id);

    try {
        t.section('Booting');
        t.eq('the page script ran without throwing', errors.length, 0);
        if (errors.length) t.note(errors.join('\n       '));
        const api = window.__haunted;
        t.ok('the page exposes its test hook', !!api);
        if (!api) return;

        const html = page.html;
        t.ok('CSP meta is present', /http-equiv="Content-Security-Policy"/.test(html));
        t.ok('CSP blocks plugins and base-tag hijacking', /object-src 'none'/.test(html) && /base-uri 'none'/.test(html));
        t.ok('referrer policy is set', /name="referrer" content="strict-origin-when-cross-origin"/.test(html));
        t.ok('the page loads nothing from another origin', !/(src|href)="https?:/i.test(html) && !/@import|url\(\s*['"]?https?:/i.test(html));
        t.ok('no inline event handler attributes', !/\son[a-z]+="/i.test(html));
        t.ok('there is a way back to the arcade', !!document.querySelector('a[href="index.html"]'));

        /* -------------------------------------------------------------- */
        t.section('Scare level picker');
        const cards = document.querySelectorAll('.level-card');
        t.eq('five level cards', cards.length, 5);
        t.eq('level 1 is selected when the page opens', api.state.level, 1);
        t.eq('...and its card shows as pressed', document.querySelector('.level-card[aria-pressed="true"]').dataset.lv, '1');
        t.ok('level 5 is labelled adults only', /Adults only/i.test(cards[4].textContent) && /18\+/.test(cards[4].textContent));
        t.ok('level 4 is labelled teens and up', /13\+/.test(cards[3].textContent));
        t.ok('level 1 is labelled for little kids', /3\+/.test(cards[0].textContent));

        cards[2].click();
        t.eq('clicking a card selects that level', api.state.level, 3);
        t.eq('the page theme follows the selected level', document.body.dataset.level, '3');
        cards[3].click();
        t.ok('picking level 4 shows a teen warning', /teens/i.test($('level-warning').textContent));

        /* -------------------------------------------------------------- */
        t.section('Level 5 age gate');
        cards[0].click();
        cards[4].click();
        t.ok('picking level 5 opens the age gate', !$('age-gate').classList.contains('hidden'));
        t.eq('...without selecting level 5 yet', api.state.level, 1);
        t.ok('the gate is a labelled modal dialog', !!document.querySelector('#age-gate [role="dialog"][aria-modal="true"][aria-labelledby="gate-title"]'));
        t.eq('focus starts on the safe "No" button', document.activeElement && document.activeElement.id, 'gate-no');
        $('gate-no').click();
        t.ok('"No" closes the gate', $('age-gate').classList.contains('hidden'));
        t.eq('...and leaves the previous level selected', api.state.level, 1);

        cards[4].click();
        document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        t.ok('Escape closes the gate too', $('age-gate').classList.contains('hidden'));
        t.eq('...still on level 1', api.state.level, 1);

        t.eq('start(5) cannot skip the gate', api.start(5), false);
        t.ok('...and the game did not start', $('game-screen').classList.contains('hidden'));

        cards[4].click();
        $('gate-yes').click();
        t.eq('confirming 18+ selects level 5', api.state.level, 5);
        t.ok('...and closes the gate', $('age-gate').classList.contains('hidden'));

        /* -------------------------------------------------------------- */
        t.section('House and content integrity');
        const roomIds = Object.keys(api.ROOMS);
        t.eq('six rooms', roomIds.length, 6);
        let exitsOk = true, twoWay = true, textsOk = true, descOk = true, idsUnique = true, posOk = true;
        for (const [id, room] of Object.entries(api.ROOMS)) {
            if (room.desc.length !== 5 || room.desc.some((d) => !d)) descOk = false;
            const seen = new Set();
            for (const h of room.hotspots) {
                if (seen.has(h.id)) idsUnique = false;
                seen.add(h.id);
                if (!(h.x >= 5 && h.x <= 95 && h.y >= 10 && h.y <= 90)) posOk = false;
                if (!h.door && (!Array.isArray(h.text) || h.text.length !== 4 || h.text.some((x) => !x) || !h.where)) textsOk = false;
            }
            for (const to of room.exits) {
                if (!api.ROOMS[to]) exitsOk = false;
                else if (!api.ROOMS[to].exits.includes(id)) twoWay = false;
            }
        }
        t.ok('every room has a description for each of the 5 levels', descOk);
        t.ok('every searchable spot has 4 text tiers and a "where" phrase', textsOk);
        t.ok('hotspot ids are unique within each room', idsUnique);
        t.ok('every hotspot sits inside the scene', posOk);
        t.ok('every exit leads to a real room', exitsOk);
        t.ok('every doorway works in both directions', twoWay);
        const reach = new Set(['hall']);
        for (let i = 0; i < 6; i++) for (const r of [...reach]) api.ROOMS[r].exits.forEach((x) => reach.add(x));
        t.eq('every room is reachable from the Front Hall', reach.size, roomIds.length);
        t.eq('exactly one front door', roomIds.reduce((n, r) => n + api.ROOMS[r].hotspots.filter((h) => h.door).length, 0), 1);

        const tiers = [1, 2, 3, 4, 5].map((n) => api.LEVELS[n].tier);
        t.eq('text tiers never get milder as the level rises', tiers.every((v, i) => i === 0 || v >= tiers[i - 1]), true);
        t.eq('levels 1, 2 and 3 each get their own tier', new Set(tiers.slice(0, 3)).size, 3);

        // Words that must never reach the little-kid levels.
        const HARSH = /\b(blood|dead|death|die|kill|scream|teeth|tooth|rott|corpse|eyes? (carefully )?removed|hair)\b/i;
        const kidTexts = allTextsForLevel(api, 1).concat(allTextsForLevel(api, 2));
        const harsh = kidTexts.filter((s) => HARSH.test(s));
        t.eq('levels 1-2 contain none of the horror vocabulary', harsh.length, 0);
        if (harsh.length) t.note(harsh.join('\n       '));
        t.eq('levels 1-2 have no hunter', [1, 2].filter((n) => api.LEVELS[n].hunter).length, 0);
        t.eq('levels 1-3 never use the full-screen face scare', [1, 2, 3].filter((n) => api.LEVELS[n].event === 'face').length, 0);
        t.ok('levels 4 and 5 both have a hunter', !!api.LEVELS[4].hunter && !!api.LEVELS[5].hunter);
        t.ok('level 5 hunts faster than level 4', api.LEVELS[5].hunter.perSecond > api.LEVELS[4].hunter.perSecond && api.LEVELS[5].hunter.hideWindow < api.LEVELS[4].hunter.hideWindow);
        t.ok('only level 5 takes items back', api.LEVELS[5].hunter.penalty && !api.LEVELS[4].hunter.penalty);
        const lights = [1, 2, 3, 4, 5].map((n) => api.LEVELS[n].light);
        t.ok('levels 1-2 are fully lit; 3-5 need a flashlight that shrinks with each level',
            lights[0] === 0 && lights[1] === 0 && lights[2] > lights[3] && lights[3] > lights[4] && lights[4] > 0);

        /* -------------------------------------------------------------- */
        t.section('Playing level 1 start to finish');
        cards[0].click();
        const realRandom = window.Math.random;
        window.Math.random = () => 0.99; // no random toasts, so messages are predictable
        t.ok('start() begins the game', api.start());
        t.ok('the game screen is showing', !$('game-screen').classList.contains('hidden'));
        t.eq('play begins in the Front Hall', $('room-title').textContent, 'Front Hall');
        t.ok('the room description is the level 1 one', $('room-desc').textContent === api.ROOMS.hall.desc[0]);
        t.ok('the flashlight overlay is off on level 1', $('dark').classList.contains('hidden'));
        t.ok('the danger meter is off on level 1', $('dread').classList.contains('hidden'));
        t.eq('the HUD shows 0 of 5', $('slots').getAttribute('aria-label'), '0 of 5 smiley pumpkins found');

        const spots = api.itemSpots();
        t.eq('5 items are hidden', spots.length, 5);
        t.eq('...in 5 different rooms', new Set(spots.map((k) => k.split(':')[0])).size, 5);
        t.ok('...never behind the front door', spots.every((k) => !k.endsWith(':frontdoor')));

        t.ok('the hint names the room of a hidden item', api.useHint().includes(api.ROOMS[spots[0].split(':')[0]].name));
        t.eq('the front door stays locked with 0 found', api.search('frontdoor'), 'locked');
        t.ok('...and says how many are left', /5 more/.test($('message').textContent));

        const hallButtons = document.querySelectorAll('#hotspots .hotspot');
        t.eq('the hall shows its 5 hotspots as buttons', hallButtons.length, 5);
        t.ok('each hotspot has an accessible name', [...hallButtons].every((b) => b.getAttribute('aria-label')));
        const exitNames = [...document.querySelectorAll('#exits .exit-btn')].map((b) => b.dataset.to).sort().join(',');
        t.eq('the hall exits match the map', exitNames, 'basement,kitchen,library,nursery');

        // Search an empty spot first.
        const hallEmpty = api.ROOMS.hall.hotspots.find((h) => !h.door && !spots.includes('hall:' + h.id));
        document.querySelector('.hotspot[data-id="' + hallEmpty.id + '"]').click();
        t.eq('clicking an empty spot shows its level 1 text', $('message').textContent, hallEmpty.text[0]);
        t.ok('...and marks it as searched', document.querySelector('.hotspot[data-id="' + hallEmpty.id + '"]').classList.contains('searched'));

        // Walk to each item and click it through the real buttons.
        const clickExit = (to) => { const b = document.querySelector('.exit-btn[data-to="' + to + '"]'); if (b) b.click(); };
        const walkTo = (target) => {
            // Back to the hall first (the attic only connects through the bedroom)...
            if (api.state.room === 'attic') clickExit('nursery');
            if (api.state.room !== 'hall' && api.state.room !== target) clickExit('hall');
            // ...then out to the target.
            if (target === 'attic') { if (api.state.room === 'hall') clickExit('nursery'); clickExit('attic'); }
            else if (api.state.room !== target) clickExit(target);
        };
        let foundAll = true;
        for (const k of spots) {
            const [roomId, id] = k.split(':');
            walkTo(roomId);
            if (api.state.room !== roomId) { foundAll = false; t.note('could not walk to ' + roomId); break; }
            document.querySelector('.hotspot[data-id="' + id + '"]').click();
            if (!/Yay! You found a smiley pumpkin/.test($('message').textContent)) foundAll = false;
        }
        t.ok('walking the exits reaches every item and each click finds it', foundAll);
        t.eq('the HUD counts 5 of 5', $('slots').getAttribute('aria-label'), '5 of 5 smiley pumpkins found');
        t.ok('the last find says to go to the front door', /front door/i.test($('message').textContent));
        t.eq('searching a collected spot again finds nothing new', api.search(spots[spots.length - 1].split(':')[1]), 'empty');
        walkTo('hall');
        document.querySelector('.hotspot[data-id="frontdoor"]').click();
        t.ok('the front door opens and the win screen shows', !$('win-screen').classList.contains('hidden'));
        t.ok('the win text is the level 1 party', /party/i.test($('win-text').textContent));
        t.ok('the win stats name the level', /Level 1/.test($('win-stats').textContent));
        t.eq('the game has stopped', api.state.running, false);
        window.Math.random = realRandom;

        /* -------------------------------------------------------------- */
        t.section('Level 1-2 surprises stay friendly');
        api.start(1);
        window.Math.random = () => 0; // always trigger the surprise
        const s1 = api.ROOMS.hall.hotspots.find((h) => !h.door && !api.itemSpots().includes('hall:' + h.id));
        if (s1) {
            api.search(s1.id);
            t.ok('a level 1 surprise is a toast, not a full-screen scare', !$('toast').classList.contains('hidden') && $('scare').classList.contains('hidden'));
        } else t.ok('found an empty hall spot to test with', false);
        window.Math.random = realRandom;
        api.quit();
        t.ok('quit returns to the title screen', !$('title-screen').classList.contains('hidden'));

        /* -------------------------------------------------------------- */
        t.section('Level 3: flashlight, BOOs and limited hints');
        cards[2].click();
        api.start();
        t.ok('the flashlight overlay is on', !$('dark').classList.contains('hidden'));
        t.ok('the danger meter is still off', $('dread').classList.contains('hidden'));
        t.eq('3 hints available', api.state.hintsLeft, 3);
        api.useHint(); api.useHint(); api.useHint();
        t.eq('hints run out after 3', api.useHint(), null);
        t.ok('...and the hint button is disabled', $('hint-btn').disabled);
        window.Math.random = () => 0;
        const s3 = api.ROOMS.hall.hotspots.find((h) => !h.door && !api.itemSpots().includes('hall:' + h.id));
        api.search(s3.id);
        t.ok('a level 3 surprise is the cartoon BOO ghost', !$('scare').classList.contains('hidden') && $('scare').classList.contains('boo'));
        t.eq('the game pauses while it shows', api.search('frontdoor'), null);
        api.dismissScare();
        t.ok('dismissing it resumes play', $('scare').classList.contains('hidden') && !api.state.paused);
        window.Math.random = realRandom;
        api.quit();

        /* -------------------------------------------------------------- */
        t.section('Level 4: the hunter');
        cards[3].click();
        api.start();
        t.ok('the danger meter shows', !$('dread').classList.contains('hidden'));
        t.ok('no hint button', $('hint-btn').classList.contains('hidden'));
        api.tick(10);
        t.near('danger rises over time', api.state.dread, 10 * api.LEVELS[4].hunter.perSecond, 0.001);
        api.tick(1000);
        t.ok('at 100% the hunt starts', api.state.hunting);
        t.ok('the HIDE button appears', !$('hide-panel').classList.contains('hidden'));
        t.eq('you can\'t keep searching during a hunt', api.search('clock'), null);
        t.eq('...or run to another room', api.goTo('library'), false);
        document.getElementById('hide-btn').click();
        t.ok('hiding in time ends the hunt safely', !api.state.hunting && api.state.dread === 25);
        t.ok('...with the "it moves away" message', /move away/.test($('message').textContent));

        const [r4, h4] = api.itemSpots()[0].split(':');
        api.goTo(r4, true);
        window.Math.random = () => 0.99;
        api.search(h4);
        window.Math.random = realRandom;
        const heldBefore = api.state.found;
        t.eq('holding one key before getting caught', heldBefore, 1);
        api.startHunt();
        api.caught();
        t.ok('being caught shows the full-screen face', !$('scare').classList.contains('hidden') && $('scare').classList.contains('face'));
        api.dismissScare();
        t.eq('level 4 takes nothing away when caught', api.state.found, heldBefore);
        t.ok('...and says it found you', /found you/i.test($('message').textContent));
        api.quit();
        t.eq('quitting stops the hunt timers', api.state.running, false);

        /* -------------------------------------------------------------- */
        t.section('Level 5: she takes things back');
        cards[4].click();
        $('gate-yes').click();
        api.start();
        t.eq('level 5 starts', api.state.level, 5);
        const five = api.itemSpots();
        window.Math.random = () => 0.99; // no random face scares while collecting
        const [r0, h0] = five[0].split(':');
        api.goTo('hall', true);
        api.goTo(r0, true);
        api.search(h0);
        t.eq('one tooth found', api.state.found, 1);
        api.startHunt();
        api.caught();
        api.dismissScare();
        t.eq('being caught takes the tooth back', api.state.found, 0);
        t.eq('...and there are still exactly 5 hidden', api.itemSpots().length, 5);
        t.eq('...still in 5 different rooms', new Set(api.itemSpots().map((k) => k.split(':')[0])).size, 5);
        t.eq('...and you wake in the basement', api.state.room, 'basement');
        window.Math.random = realRandom;
        api.quit();

        /* -------------------------------------------------------------- */
        t.section('Sound without Web Audio');
        t.ok('jsdom has no AudioContext', typeof window.AudioContext === 'undefined');
        let threw = false;
        try { ['chime', 'scream', 'boo', 'heartbeat', 'whisper', 'nope'].forEach((n) => api.Sound.play(n)); api.Sound.droneStart(5); api.Sound.droneStop(); } catch { threw = true; }
        t.ok('every sound call is a silent no-op', !threw);
        document.querySelector('.sound-toggle').click();
        t.eq('the sound toggle turns sound off', api.Sound.on, false);
        t.ok('...and both toggles say so', [...document.querySelectorAll('.sound-toggle')].every((b) => b.getAttribute('aria-pressed') === 'false'));

        t.eq('nothing threw during the whole run', errors.length, 0);
        if (errors.length) t.note(errors.join('\n       '));
    } finally {
        env.close();
    }
}
