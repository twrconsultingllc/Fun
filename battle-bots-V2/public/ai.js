// Tactical pulse: asks the model which skill each team should run, applies the result.

import { world, match } from './state.js';
import { addLog, dom, getSelectedModel, readPrompt } from './ui.js';

const TICK_MS = 6500;

let aiTimer = null;
let isFetching = false;

export function stopAiLoop() {
    if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
    isFetching = false;
}

export async function loadAvailableModels() {
    try {
        const response = await fetch('/api/get-actions');
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);

        dom.modelSelect.innerHTML = '';

        const targetModels = data.models.filter(m =>
            m.includes('3.5-flash') || m.includes('lite') || m.includes('8b')
        );
        const displayModels = targetModels.length > 0 ? targetModels : data.models.filter(m => m.includes('flash'));

        displayModels.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m;
            opt.innerText = m.toUpperCase();
            dom.modelSelect.appendChild(opt);
        });

        addLog('RECV', 'Models loaded and filtered successfully.');
    } catch (e) {
        addLog('ERROR', e.message);
        dom.modelSelect.innerHTML = '<option value="">ERROR LOADING MODELS</option>';
    }
}

// The roster is variable now, so send every living bot grouped by team.
function buildGameState() {
    const teams = {};
    for (const bot of world.bots) {
        (teams[bot.team] ||= []).push({
            id: bot.id,
            hp: Math.round(bot.hp),
            maxHp: bot.maxHp,
            x: Math.round(bot.x),
            y: Math.round(bot.y),
            dead: bot.dead
        });
    }
    return { mode: match.mode, teams };
}

// Phase 1 keeps the existing botA/botB contract: orders are issued per team, so
// every bot on a team runs its team's skill.
function applyOrders(actions) {
    for (const bot of world.bots) {
        const order = bot.team === 'red' ? actions.botA : actions.botB;
        if (order && order.stats) bot.applyAISkill(order.skill, order.stats);
    }
}

function livingBotsExist() {
    return world.bots.some(b => !b.dead);
}

export async function fetchTacticalTurn(retryCount = 0) {
    if ((isFetching && retryCount === 0) || match.phase !== 'RUNNING' || !livingBotsExist()) return;
    isFetching = true;

    const selectedModel = getSelectedModel();
    const gameState = buildGameState();

    if (retryCount === 0) addLog('SENT', { model: selectedModel, state: gameState });

    try {
        const response = await fetch('/api/get-actions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                gameState,
                selectedModel,
                promptA: readPrompt('red'),
                promptB: readPrompt('blue')
            })
        });

        if (response.status === 429) {
            const waitTime = Math.pow(2, retryCount + 1) * 2000;
            addLog('ERROR', `Rate limited. Retrying in ${waitTime / 1000}s...`);
            aiTimer = setTimeout(() => fetchTacticalTurn(retryCount + 1), waitTime);
            return;
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Server returned status: ${response.status}`);
        }

        const actions = await response.json();
        addLog('RECV', { red: actions.botA?.skill, blue: actions.botB?.skill });
        applyOrders(actions);

    } catch (e) {
        addLog('ERROR', e.message);
    } finally {
        if (retryCount === 0) isFetching = false;

        if (match.phase === 'RUNNING' && retryCount === 0) {
            aiTimer = setTimeout(() => fetchTacticalTurn(0), TICK_MS);
        }
    }
}
