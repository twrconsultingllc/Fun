/* battle-bots-V2 — the DOM-free half: weapon assignment, skill effects and
 * the skill-balance numbers, tested by importing the real ES modules
 * directly. Unlike this repo's other pages, this app ships its logic as
 * separate files rather than one inline script, so there is nothing to
 * extract — importing the real `entities.js`/`skills.js`/`state.js` IS the
 * DOM-free test, same spirit as `extractPureMath`, no extraction needed.
 *
 * battle-bots-V2's real, functional deployment is a separate Vercel project,
 * not GitHub Pages — but GitHub Pages serves this same repo, so `npm run
 * test:live` still reaches these static files (just without the working
 * `/api/get-actions` route, which this suite never calls). To check the
 * actual Vercel deployment instead:
 *   node run.mjs --only=bots-core --target=https://<live-vercel-url>/index.html
 *
 * Every expected number below is copied from `skills.js`/the balance change
 * itself, not re-derived from first principles — there is no independent
 * source of truth for a game-design number the way there is for a unit
 * conversion. What these pin is that the code matches the design intent:
 * a bot's configured weapon never changes at runtime, Aggressive Charge
 * scales off that weapon instead of firing a fixed generic shot, and the
 * other skills carry the shields that were added to offset its burst.
 */

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveModuleDir } from './lib/bots-modules.mjs';

export const name = 'battle-bots-V2 — weapons, skills & balance';

const MODULE_FILES = ['state.js', 'arena.js', 'audio.js', 'teams.js', 'skills.js', 'entities.js'];

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

    let Bot, world, resetWorld, match, SKILL_CATALOG, WEAPONS;
    try {
        ({ Bot } = await import(modUrl('entities.js')));
        ({ world, resetWorld, match } = await import(modUrl('state.js')));
        ({ SKILL_CATALOG, WEAPONS } = await import(modUrl('skills.js')));
    } catch (error) {
        t.ok('entities.js / skills.js / state.js import cleanly under Node', false);
        t.note(error.message);
        await cleanup();
        return;
    }

    match.phase = 'RUNNING';

    t.section('A bot keeps its configured weapon no matter what skills fire');
    resetWorld();
    const red = new Bot(100, 300, { id: 'red-1', team: 'red', color: '#f00', hp: 225, speed: 25, weapon: 'railgun' });
    const blue = new Bot(500, 300, { id: 'blue-1', team: 'blue', color: '#00f', hp: 225, speed: 25, weapon: 'shotgun' });
    world.bots.push(red, blue);

    const skillNames = Object.keys(SKILL_CATALOG);
    for (let i = 0; i < 400; i++) {
        if (i % 20 === 0) {
            const s = skillNames[i % skillNames.length];
            red.applyAISkill(s, SKILL_CATALOG[s]);
            blue.applyAISkill(s, SKILL_CATALOG[s]);
        }
        red.update(0.1, world.bots);
        blue.update(0.1, world.bots);
        world.bullets.length = 0; // don't let the arrays grow across 40 sim-seconds
    }
    t.eq('red keeps its configured railgun through 40s of skill churn', red.weaponId, 'railgun');
    t.eq('blue keeps its configured shotgun through 40s of skill churn', blue.weaponId, 'shotgun');

    t.section("Aggressive Charge fires the bot's OWN weapon, not a fixed generic shot");
    for (const [weaponId, ownerId] of [['rapid', 'r-rapid'], ['railgun', 'r-rail']]) {
        resetWorld();
        const bot = new Bot(100, 300, { id: ownerId, team: 'red', color: '#f00', hp: 225, speed: 25, weapon: weaponId });
        const enemy = new Bot(300, 300, { id: 'enemy', team: 'blue', color: '#00f', hp: 225, speed: 25, weapon: 'rapid' });
        world.bots.push(bot, enemy);
        bot.applyAISkill('CHARGE_BEAM', SKILL_CATALOG.CHARGE_BEAM);
        for (let i = 0; i < 15; i++) { bot.update(0.1, world.bots); enemy.update(0.1, world.bots); }

        const shot = world.bullets.find(b => b.ownerId === ownerId);
        const w = WEAPONS[weaponId];
        const c = SKILL_CATALOG.CHARGE_BEAM;
        t.ok(`${weaponId}: charge shot fired`, !!shot);
        if (shot) {
            t.eq(`${weaponId}: charge damage = weapon damage x ${c.chargeDamageMultiplier}`, shot.damage, w.damage * c.chargeDamageMultiplier);
            t.eq(`${weaponId}: charge speed = weapon speed x ${c.chargeSpeedMultiplier}`, shot.speed, w.speed * c.chargeSpeedMultiplier);
            t.eq(`${weaponId}: charge shot is team-colored (not the old fixed white)`, shot.color, '#f00');
            t.ok(`${weaponId}: charge shot always pierces`, shot.pierce === true);
        }
    }

    t.section('Bonus shields balance the skills that deal less damage than a charge');
    const shieldCases = [
        ['SNIPE_STANCE', 20],
        ['FLANK_LEFT', 30],
        ['FLANK_RIGHT', 30],
        ['KITE_RETREAT', 30],
        ['DEFENSIVE_SHIELD', 70]
    ];
    for (const [skillName, expected] of shieldCases) {
        resetWorld();
        const bot = new Bot(0, 0, { id: 'x', team: 'red', color: '#f00', hp: 225, speed: 25, weapon: 'rapid' });
        bot.applyAISkill(skillName, SKILL_CATALOG[skillName]);
        t.eq(`${skillName} raises a ${expected}-point shield`, bot.shieldHp, expected);
    }
    resetWorld();
    const charger = new Bot(0, 0, { id: 'y', team: 'red', color: '#f00', hp: 225, speed: 25, weapon: 'rapid' });
    charger.applyAISkill('CHARGE_BEAM', SKILL_CATALOG.CHARGE_BEAM);
    t.eq('Aggressive Charge raises no shield of its own', charger.shieldHp, 0);

    t.section('Weapon fire-rate balance pin (cut to 20% of the original values)');
    t.eq('rapid fire rate', WEAPONS.rapid.fireRate, 0.8);
    t.eq('shotgun fire rate', WEAPONS.shotgun.fireRate, 0.22);
    t.eq('railgun fire rate', WEAPONS.railgun.fireRate, 0.14);
    t.eq('homing fire rate', WEAPONS.homing.fireRate, 0.32);

    await cleanup();
}
