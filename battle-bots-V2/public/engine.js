import { world, match, virtualSize } from './state.js';
import { spawnParticles } from './entities.js';
import { playSound } from './audio.js';
import { stopAiLoop } from './ai.js';
import { setMatchButton, updateScoreboard, getTeamConfig, addLog } from './ui.js';
import { pushGlobalEvent, recordRoundOutcome } from './memory.js';
import { TEAMS } from './teams.js';

const canvas = document.getElementById('arenaCanvas');
const ctx = canvas.getContext('2d');

let lastTime = 0;
let loopStarted = false;

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

function updateState(dt) {
    if (match.phase !== 'RUNNING') return;

    for (const bot of world.bots) bot.update(dt, world.bots);

    for (let i = world.bullets.length - 1; i >= 0; i--) {
        const b = world.bullets[i];
        b.update(dt);
        if (b.dead) { world.bullets.splice(i, 1); continue; }

        let hitWall = false;
        for (const obs of world.obstacles) {
            if (b.x >= obs.x && b.x <= obs.x + obs.w && b.y >= obs.y && b.y <= obs.y + obs.h) { hitWall = true; break; }
        }
        if (hitWall) { spawnParticles(b.x, b.y, '#fff', 5, false); world.bullets.splice(i, 1); continue; }

        for (const bot of world.bots) {
            if (bot.dead || b.team === bot.team) continue;
            if (Math.hypot(b.x - bot.x, b.y - bot.y) < bot.radius + 4) {
                bot.hp -= b.damage;
                playSound('hit');
                spawnParticles(b.x, b.y, b.color, 10, false);
                b.dead = true;
                if (bot.hp <= 0) killBot(bot);
                break;
            }
        }
        if (b.dead) { world.bullets.splice(i, 1); }
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
        ctx.fillStyle = '#111827'; ctx.strokeStyle = '#374151'; ctx.lineWidth = 2;
        ctx.fillRect(obs.x, obs.y, obs.w, obs.h);
        ctx.strokeRect(obs.x, obs.y, obs.w, obs.h);
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.strokeRect(obs.x + 2, obs.y + 2, obs.w - 4, obs.h - 4);
    }

    if (match.phase === 'RUNNING' || match.phase === 'ENDED') {
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
