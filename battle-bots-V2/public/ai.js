// Tactical pulse. Each team gets its own model call, fired in parallel, with its
// own rate-limit backoff so one throttled team never stalls the others.

import { world, match, virtualSize } from './state.js';
import { hasLineOfSight } from './arena.js';
import { addLog, getTickMs, getTeamConfig, setAvailableModels, PREFERRED_MODEL } from './ui.js';
import { getEvents, historyForPrompt, pushEvent } from './memory.js';

let timer = null;
let tickCount = 0;
let teamState = {};   // team -> { inFlight, retryCount, nextAllowedAt }

export function stopAiLoop() {
    if (timer) { clearTimeout(timer); timer = null; }
    teamState = {};
}

export function startAiLoop(teams) {
    stopAiLoop();
    tickCount = 0;
    teamState = {};
    for (const t of teams) teamState[t] = { inFlight: false, retryCount: 0, nextAllowedAt: 0 };
    tick();
}

export async function loadAvailableModels() {
    try {
        const response = await fetch('/api/get-actions');
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        const models = data.models || [];
        setAvailableModels(models);
        addLog('RECV', `${models.length} models available.`);
        if (models.length && !models.includes(PREFERRED_MODEL)) {
            addLog('ERROR', `Default ${PREFERRED_MODEL} not in catalog — using closest match.`);
        }
    } catch (e) {
        addLog('ERROR', `Model list: ${e.message}`);
        setAvailableModels([]);
    }
}

function botView(bot) {
    return {
        id: bot.id,
        team: bot.team,
        hp: Math.round(bot.hp),
        maxHp: bot.maxHp,
        x: Math.round(bot.x),
        y: Math.round(bot.y),
        activeSkill: bot.activeSkill,
        shieldHp: Math.round(bot.shieldHp),
        weapon: bot.weaponId,
        dead: bot.dead
    };
}

// Everything the model is allowed to see, from one team's point of view.
function buildGameState(team) {
    const mine = world.bots.filter(b => b.team === team && !b.dead);
    const others = world.bots.filter(b => b.team !== team);
    const livingOthers = others.filter(b => !b.dead);

    return {
        mode: match.mode,
        tick: tickCount,
        arena: {
            width: virtualSize,
            height: virtualSize,
            // Cover is destructible, so hp matters when deciding what to hide behind.
            cover: world.obstacles.map(o => ({ x: o.x, y: o.y, w: o.w, h: o.h, hp: Math.round(o.hp) })),
            pickups: world.pickups.map(p => ({ type: p.type, x: Math.round(p.x), y: Math.round(p.y) }))
        },
        you: {
            team,
            bots: mine.map(b => ({
                ...botView(b),
                vx: Math.round(b.vx),
                vy: Math.round(b.vy),
                speed: Math.round(b.currentSpeed()),
                fireCooldownSeconds: Math.max(0, +b.fireCooldown.toFixed(2)),
                damageTakenSinceLastTick: Math.round(b.damageTaken),
                activeSkillSecondsLeft: +b.skillTimer.toFixed(1),
                damageBoosted: b.damageBuffTimer > 0,
                speedBoosted: b.speedBuffTimer > 0,
                enemies: livingOthers.map(e => ({
                    id: e.id,
                    team: e.team,
                    hp: Math.round(e.hp),
                    distance: Math.round(Math.hypot(e.x - b.x, e.y - b.y)),
                    lineOfSight: hasLineOfSight(b.x, b.y, e.x, e.y)
                }))
            }))
        },
        opponents: livingOthers.map(botView)
    };
}

function applyOrders(team, orders) {
    const summary = [];
    for (const bot of world.bots) {
        if (bot.team !== team || bot.dead) continue;
        const order = orders[bot.id];
        if (!order || !order.stats) continue;
        bot.applyAISkill(order.skill, order.stats);
        bot.reasoning = order.reasoning || '';
        bot.taunt = order.taunt || '';
        summary.push(`${bot.id} ${Math.round(bot.hp)}hp took ${Math.round(bot.damageTaken)} dmg -> ${order.skill}`);
    }
    if (summary.length) pushEvent(team, `T${tickCount}: ${summary.join('; ')}`);
}

async function requestTeamOrders(team, gameState) {
    const st = teamState[team];
    if (!st || st.inFlight || Date.now() < st.nextAllowedAt) return;
    if (gameState.you.bots.length === 0) return;

    const cfg = getTeamConfig(team);
    st.inFlight = true;

    try {
        const response = await fetch('/api/get-actions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                teamId: team,
                model: cfg.model,
                prompt: cfg.prompt,
                gameState,
                memory: { events: getEvents(team), history: historyForPrompt(team) }
            })
        });

        if (response.status === 429) {
            st.retryCount++;
            const waitMs = Math.min(Math.pow(2, st.retryCount) * 2000, 60000);
            st.nextAllowedAt = Date.now() + waitMs;
            addLog('ERROR', `${team.toUpperCase()} rate limited — backing off ${Math.round(waitMs / 1000)}s`);
            return;
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `status ${response.status}`);
        }

        const data = await response.json();
        st.retryCount = 0;
        st.nextAllowedAt = 0;
        applyOrders(team, data.orders || {});

        for (const [id, order] of Object.entries(data.orders || {})) {
            addLog('RECV', `${id}: ${order.skill}${order.reasoning ? ` — ${order.reasoning}` : ''}`);
        }
    } catch (e) {
        addLog('ERROR', `${team.toUpperCase()}: ${e.message}`);
    } finally {
        st.inFlight = false;
    }
}

function teamsWithLivingBots() {
    return [...new Set(world.bots.filter(b => !b.dead).map(b => b.team))];
}

async function tick() {
    if (match.phase !== 'RUNNING') return;
    tickCount++;

    const teams = teamsWithLivingBots();

    // Snapshot every team's view before any await, so all teams reason about the
    // same instant, then clear the per-tick damage counters.
    const payloads = teams.map(team => ({ team, gameState: buildGameState(team) }));
    for (const bot of world.bots) bot.damageTaken = 0;

    addLog('SENT', `tick ${tickCount}: ${teams.map(t => `${t}=${getTeamConfig(t).model || 'auto'}`).join(', ')}`);

    await Promise.allSettled(payloads.map(p => requestTeamOrders(p.team, p.gameState)));

    if (match.phase === 'RUNNING') timer = setTimeout(tick, getTickMs());
}
