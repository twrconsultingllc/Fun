import { world, match, virtualSize } from './state.js';
import { Pickup, spawnParticles } from './entities.js';
import { isClearOfCover } from './arena.js';
import { PICKUPS } from './skills.js';
import { playSound } from './audio.js';
import { stopAiLoop } from './ai.js';
import { setMatchButton, updateScoreboard, getTeamConfig, addLog } from './ui.js';
import { pushGlobalEvent, recordRoundOutcome } from './memory.js';
import { TEAMS } from './teams.js';

const canvas = document.getElementById('arenaCanvas');
const ctx = canvas.getContext('2d');

let lastTime = 0;
let loopStarted = false;

const PICKUP_INTERVAL = 11;   // seconds between spawns
const PICKUP_FIRST = 6;
let pickupTimer = PICKUP_FIRST;

export function resetRuntime() {
    pickupTimer = PICKUP_FIRST;
}

function spawnPickup() {
    if (world.pickups.length >= 3) return;
    const types = Object.keys(PICKUPS);
    const type = types[Math.floor(Math.random() * types.length)];

    for (let attempt = 0; attempt < 40; attempt++) {
        const x = 40 + Math.random() * (virtualSize - 80);
        const y = 40 + Math.random() * (virtualSize - 80);
        if (!isClearOfCover(x, y)) continue;
        if (world.bots.some(b => !b.dead && Math.hypot(b.x - x, b.y - y) < 70)) continue;
        world.pickups.push(new Pickup(x, y, type));
        return;
    }
}

function damageObstacle(obs, amount) {
    obs.hp -= amount;
    if (obs.hp > 0) return;
    const i = world.obstacles.indexOf(obs);
    if (i >= 0) world.obstacles.splice(i, 1);
    spawnParticles(obs.x + obs.w / 2, obs.y + obs.h / 2, '#6b7280', 22, true);
}

function livingTeams() {
    return [...new Set(world.bots.filter(b => !b.dead).map(b => b.team))];
}

function killBot(bot) {
    bot.hp = 0;
    bot.dead = true;
    playSound('explode');
    spawnParticles(bot.x, bot.y, bot.color, 50, true);

    // Every surviving team is told who died — it is the single most useful thing
    // for the model to know going into the next tick.
    pushGlobalEvent(`${bot.id} (${bot.team}) was destroyed`);
    addLog('RECV', `${bot.id} destroyed`);

    // A match now ends when only one team still has bots standing, not on first death.
    const remaining = livingTeams();
    if (remaining.length <= 1) endMatch(remaining[0] || null);
}

export function endMatch(winnerTeam) {
    // Simultaneous kills can call this twice in one frame; first result stands.
    if (match.phase === 'ENDED') return;
    match.phase = 'ENDED';
    stopAiLoop();

    // Persist the outcome so future matches can be told how this one went.
    const prompts = {}, models = {};
    for (const team of match.teams) {
        prompts[team] = getTeamConfig(team).prompt;
        models[team] = getTeamConfig(team).model;
    }
    recordRoundOutcome({ ts: Date.now(), mode: match.mode, winner: winnerTeam, prompts, models });

    if (!winnerTeam) {
        setMatchButton('▶ DRAW - RESTART', '#444');
        return;
    }

    match.wins[winnerTeam] = (match.wins[winnerTeam] || 0) + 1;
    updateScoreboard();

    const { label, color } = TEAMS[winnerTeam];
    setMatchButton(`▶ ${label} WINS - RESTART`, `linear-gradient(90deg, ${color}, #111)`);
}

export function abortMatch() {
    if (match.phase !== 'RUNNING') return;
    match.phase = 'ENDED';
    stopAiLoop();
    setMatchButton('▶ MATCH ABORTED - RESTART', '#ef4444');
}

export function updateState(dt) {
    if (match.phase !== 'RUNNING') return;

    for (const bot of world.bots) bot.update(dt, world.bots);

    for (let i = world.bullets.length - 1; i >= 0; i--) {
        const b = world.bullets[i];
        b.update(dt);
        if (b.dead) { world.bullets.splice(i, 1); continue; }

        // Cover stops everything, including piercing shots — that is what makes
        // it worth using. It just wears down while doing so.
        let hitWall = null;
        for (const obs of world.obstacles) {
            if (b.x >= obs.x && b.x <= obs.x + obs.w && b.y >= obs.y && b.y <= obs.y + obs.h) { hitWall = obs; break; }
        }
        if (hitWall) {
            damageObstacle(hitWall, b.damage);
            spawnParticles(b.x, b.y, '#9ca3af', 5, false);
            world.bullets.splice(i, 1);
            continue;
        }

        for (const bot of world.bots) {
            if (bot.dead || b.team === bot.team || b.hitIds.has(bot.id)) continue;
            if (Math.hypot(b.x - bot.x, b.y - bot.y) < bot.radius + 4) {
                const result = bot.takeDamage(b.damage);
                const owner = world.bots.find(o => o.id === b.ownerId);
                if (owner) { owner.shotsHit++; owner.damageDealtTotal += b.damage; }

                playSound('hit');
                spawnParticles(b.x, b.y,
                    result.absorbed > 0 ? PICKUPS.shield.color : b.color,
                    result.absorbed > 0 ? 6 : 10, false);

                b.hitIds.add(bot.id);
                if (!b.pierce) b.dead = true;
                if (bot.hp <= 0) killBot(bot);
                if (b.dead) break;
            }
        }
        if (b.dead) { world.bullets.splice(i, 1); }
    }

    // Pickups
    pickupTimer -= dt;
    if (pickupTimer <= 0) { spawnPickup(); pickupTimer = PICKUP_INTERVAL; }

    for (let i = world.pickups.length - 1; i >= 0; i--) {
        const p = world.pickups[i];
        p.update(dt);
        if (p.dead) { world.pickups.splice(i, 1); continue; }

        for (const bot of world.bots) {
            if (bot.dead) continue;
            if (Math.hypot(p.x - bot.x, p.y - bot.y) < bot.radius + p.radius) {
                p.applyTo(bot);
                pushGlobalEvent(`${bot.id} grabbed the ${p.type} pickup`);
                spawnParticles(p.x, p.y, p.def.color, 14, false);
                world.pickups.splice(i, 1);
                break;
            }
        }
    }

    for (let i = world.particles.length - 1; i >= 0; i--) {
        world.particles[i].update(dt);
        if (world.particles[i].life <= 0) world.particles.splice(i, 1);
    }
}

function draw() {
    ctx.fillStyle = 'rgba(10, 10, 16, 0.5)';
    ctx.fillRect(0, 0, virtualSize, virtualSize);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = 0; x < virtualSize; x += 40) { ctx.moveTo(x, 0); ctx.lineTo(x, virtualSize); }
    for (let y = 0; y < virtualSize; y += 40) { ctx.moveTo(0, y); ctx.lineTo(virtualSize, y); }
    ctx.stroke();

    for (const obs of world.obstacles) {
        const wear = 1 - Math.max(0, obs.hp) / obs.maxHp;
        ctx.fillStyle = '#111827'; ctx.strokeStyle = '#374151'; ctx.lineWidth = 2;
        ctx.fillRect(obs.x, obs.y, obs.w, obs.h);
        ctx.strokeRect(obs.x, obs.y, obs.w, obs.h);
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.strokeRect(obs.x + 2, obs.y + 2, obs.w - 4, obs.h - 4);

        // Cracks deepen as cover takes damage.
        if (wear > 0.05) {
            ctx.strokeStyle = `rgba(239, 68, 68, ${0.25 + wear * 0.6})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            const steps = Math.ceil(wear * 4);
            for (let k = 0; k < steps; k++) {
                const fx = obs.x + (obs.w / (steps + 1)) * (k + 1);
                ctx.moveTo(fx, obs.y + 3);
                ctx.lineTo(fx - obs.w * 0.12, obs.y + obs.h - 3);
            }
            ctx.stroke();
        }
    }

    if (match.phase === 'RUNNING' || match.phase === 'ENDED') {
        for (const p of world.pickups) p.draw(ctx);
        for (const bot of world.bots) bot.draw(ctx);
        for (const b of world.bullets) b.draw(ctx);
        for (const p of world.particles) p.draw(ctx);
    }
}

function gameLoop(timestamp) {
    if (!lastTime) lastTime = timestamp;
    let dt = (timestamp - lastTime) / 1000;
    if (dt > 0.1) dt = 0.1;
    lastTime = timestamp;
    updateState(dt);
    draw();
    requestAnimationFrame(gameLoop);
}

export function startRenderLoop() {
    if (loopStarted) return;
    loopStarted = true;
    requestAnimationFrame(gameLoop);
}

export function paintIdleArena() {
    ctx.fillStyle = '#0a0a10';
    ctx.fillRect(0, 0, virtualSize, virtualSize);
}
