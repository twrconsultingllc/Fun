// All DOM reads/writes live here so the engine and AI modules stay DOM-free.
// Team panels and the scoreboard are rendered from the active mode's roster,
// which is what lets 1v1, 2v2 and a four-way free-for-all share one UI.

import { match, world } from './state.js';
import { loadHistory } from './memory.js';
import { TEAMS, MODES } from './teams.js';
import { WEAPONS, DEFAULT_WEAPON } from './skills.js';

const els = {
    overlay:     document.getElementById('arena-overlay'),
    btnStart:    document.getElementById('btn-start'),
    btnOverlay:  document.getElementById('btn-overlay-start'),
    modeSelect:  document.getElementById('mode-select'),
    logContent:  document.getElementById('log-content'),
    scoreboard:  document.getElementById('scoreboard'),
    teamConfigs: document.getElementById('team-configs')
};

export const dom = els;

const DEFAULT_PROMPTS = {
    red:    'Aggressive close-range charger',
    blue:   'Sniper playstyle, keep distance',
    green:  'Opportunist — finish off weakened targets',
    yellow: 'Cautious defender, use cover'
};

// Survives panel re-renders when the mode changes.
const teamConfig = {};
for (const id of Object.keys(TEAMS)) {
    teamConfig[id] = { prompt: DEFAULT_PROMPTS[id], hp: 225, speed: 25, model: '', weapon: DEFAULT_WEAPON };
}

// Preferred default for every team. Resolved against the live catalog at
// runtime, so a rename upstream degrades to a sensible sibling rather than
// breaking every call.
export const PREFERRED_MODEL = 'gemini-3.5-flash-lite';

export function pickDefaultModel(models) {
    if (!models.length) return '';
    return models.find(m => m === PREFERRED_MODEL)
        || models.find(m => m.includes('flash-lite'))
        || models.find(m => m.includes('flash'))
        || models[0];
}

let availableModels = [];
let logs = [];

export function addLog(type, data) {
    const timestamp = new Date().toLocaleTimeString();
    const colorClass = type === 'SENT' ? 'log-sent' : type === 'RECV' ? 'log-recv' : 'log-error';
    const body = typeof data === 'object' ? JSON.stringify(data) : data;
    logs.unshift(`<div class="log-entry"><span style="color:#555">[${timestamp}]</span> <strong class="${colorClass}">${type}:</strong> ${escapeHtml(body)}</div>`);
    if (logs.length > 14) logs.pop();
    els.logContent.innerHTML = logs.join('');
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

export function bindSlider(id, labelId, suffix = '') {
    const slider = document.getElementById(id);
    const label = document.getElementById(labelId);
    if (!slider || !label) return;
    slider.addEventListener('input', () => label.innerText = slider.value + suffix);
}

export function bindGlobalSliders() {
    bindSlider('cfg-a-obs', 'val-a-obs');
    bindSlider('cfg-tick', 'val-tick', 's');
}

export const getMode = () => els.modeSelect.value;
export const getArenaLevel = () => parseInt(document.getElementById('cfg-a-obs').value, 10);
export const getTickMs = () => parseFloat(document.getElementById('cfg-tick').value) * 1000;
export const getTeamConfig = (team) => teamConfig[team];
export const activeTeams = () => MODES[getMode()].teams;

export function setMatchButton(text, background) {
    els.btnStart.innerHTML = text;
    els.btnStart.style.background = background;
}

export function hideOverlay() { els.overlay.classList.add('hidden'); }

export function updateScoreboard() {
    const teams = activeTeams();
    els.scoreboard.innerHTML = teams.map(id => {
        const t = TEAMS[id];
        return `<div class="score-chip" style="color:${t.color}; text-shadow:0 0 10px ${t.color}99;">${t.label}: ${match.wins[id] || 0}</div>`;
    }).join('<div class="score-vs">VS</div>');
}

// --- team panels ---------------------------------------------------------

function panelHtml(team) {
    const t = TEAMS[team];
    const c = teamConfig[team];
    const input = 'w-full bg-[#111] text-white p-1 text-xs border border-[#333] rounded outline-none';
    return `
    <div class="config-section team-panel">
        <div class="config-header" style="color:${t.color}; text-shadow:0 0 5px ${t.color}66;">${t.label}</div>

        <div class="slider-group">
            <label class="slider-label" style="color:${t.color};">AI Strategy Prompt</label>
            <input type="text" id="cfg-${team}-prompt" class="${input}" value="${escapeHtml(c.prompt)}">
        </div>

        <div class="slider-group">
            <label class="slider-label">Model</label>
            <select id="cfg-${team}-model" class="${input} cursor-pointer"></select>
        </div>

        <div class="slider-group">
            <label class="slider-label">Weapon</label>
            <select id="cfg-${team}-weapon" class="${input} cursor-pointer">
                ${Object.entries(WEAPONS).map(([k, w]) =>
                    `<option value="${k}"${k === c.weapon ? ' selected' : ''}>${w.label} — ${w.damage}dmg x${w.fireRate}/s</option>`).join('')}
            </select>
        </div>

        <div class="slider-group">
            <div class="slider-label"><span>Base HP</span><span id="val-${team}-hp">${c.hp}</span></div>
            <input type="range" id="cfg-${team}-hp" class="slider-${team}" min="50" max="600" value="${c.hp}" step="10">
        </div>

        <div class="slider-group">
            <div class="slider-label"><span>Base Speed</span><span id="val-${team}-spd">${c.speed}</span></div>
            <input type="range" id="cfg-${team}-spd" class="slider-${team}" min="25" max="250" value="${c.speed}" step="5">
        </div>
    </div>`;
}

export function renderTeamPanels() {
    const teams = activeTeams();
    els.teamConfigs.className = teams.length > 2 ? 'team-grid team-grid-quad' : 'team-grid';
    els.teamConfigs.innerHTML = teams.map(panelHtml).join('');

    for (const team of teams) {
        const promptEl = document.getElementById(`cfg-${team}-prompt`);
        const hpEl     = document.getElementById(`cfg-${team}-hp`);
        const spdEl    = document.getElementById(`cfg-${team}-spd`);
        const modelEl  = document.getElementById(`cfg-${team}-model`);
        const weaponEl = document.getElementById(`cfg-${team}-weapon`);

        promptEl.addEventListener('input', () => teamConfig[team].prompt = promptEl.value);
        hpEl.addEventListener('input', () => {
            teamConfig[team].hp = parseFloat(hpEl.value);
            document.getElementById(`val-${team}-hp`).innerText = hpEl.value;
        });
        spdEl.addEventListener('input', () => {
            teamConfig[team].speed = parseFloat(spdEl.value);
            document.getElementById(`val-${team}-spd`).innerText = spdEl.value;
        });
        modelEl.addEventListener('change', () => teamConfig[team].model = modelEl.value);
        weaponEl.addEventListener('change', () => teamConfig[team].weapon = weaponEl.value);
    }

    populateModelSelects();
}

export function setAvailableModels(models) {
    availableModels = models;

    // Every team starts on the same default; changing one team's dropdown is
    // what turns a match into a model-vs-model comparison.
    const fallback = pickDefaultModel(models);
    for (const team of Object.keys(teamConfig)) {
        if (!teamConfig[team].model && fallback) teamConfig[team].model = fallback;
    }

    populateModelSelects();
}

function populateModelSelects() {
    for (const team of activeTeams()) {
        const sel = document.getElementById(`cfg-${team}-model`);
        if (!sel) continue;

        if (!availableModels.length) {
            sel.innerHTML = '<option value="">LOADING MODELS…</option>';
            continue;
        }

        sel.innerHTML = availableModels
            .map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`)
            .join('');

        if (teamConfig[team].model && availableModels.includes(teamConfig[team].model)) {
            sel.value = teamConfig[team].model;
        } else {
            teamConfig[team].model = sel.value;
        }
    }
}


// --- stats & history -----------------------------------------------------

function formatClock(seconds) {
    const m = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
}

function topSkill(bot) {
    const entries = Object.entries(bot.skillCounts || {});
    if (!entries.length) return '—';
    const [name, n] = entries.sort((a, b) => b[1] - a[1])[0];
    return `${name.replace(/_/g, ' ').toLowerCase()} ×${n}`;
}

export function renderStats() {
    const body = document.getElementById('stats-body');
    if (!body) return;

    if (!world.bots.length) {
        body.innerHTML = '<div class="panel-empty">No match run yet.</div>';
        return;
    }

    const rows = world.bots.map(b => {
        const acc = b.shotsFired ? Math.round((b.shotsHit / b.shotsFired) * 100) : 0;
        const color = TEAMS[b.team].color;
        return `<tr${b.dead ? ' class="stat-dead"' : ''}>
            <td style="color:${color}">${b.id}</td>
            <td>${Math.max(0, Math.round(b.hp))}</td>
            <td>${Math.round(b.damageDealtTotal)}</td>
            <td>${Math.round(b.damageTakenTotal)}</td>
            <td>${acc}%</td>
            <td class="stat-skill">${escapeHtml(topSkill(b))}</td>
        </tr>`;
    }).join('');

    body.innerHTML = `
        <div class="stat-timer">MATCH TIME ${formatClock(match.elapsed)}</div>
        <div class="table-scroll">
            <table class="stat-table">
                <thead><tr><th>BOT</th><th>HP</th><th>OUT</th><th>IN</th><th>ACC</th><th>TOP SKILL</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}

export function renderHistory() {
    const body = document.getElementById('history-body');
    if (!body) return;

    const history = loadHistory();
    if (!history.length) {
        body.innerHTML = '<div class="panel-empty">No completed matches yet.</div>';
        return;
    }

    const rows = history.map(h => {
        const color = h.winner ? TEAMS[h.winner]?.color || '#aaa' : '#888';
        const label = h.winner ? TEAMS[h.winner]?.label || h.winner : 'DRAW';
        const model = h.winner ? (h.models?.[h.winner] || '—') : '—';
        const strategy = h.winner ? (h.prompts?.[h.winner] || '—') : '—';
        return `<tr>
            <td style="color:${color}">${escapeHtml(label)}</td>
            <td>${escapeHtml(h.mode || '')}</td>
            <td class="stat-skill">${escapeHtml(model)}</td>
            <td class="stat-skill">${escapeHtml(strategy)}</td>
        </tr>`;
    }).join('');

    body.innerHTML = `
        <div class="table-scroll">
            <table class="stat-table">
                <thead><tr><th>WON</th><th>MODE</th><th>MODEL</th><th>STRATEGY</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}
