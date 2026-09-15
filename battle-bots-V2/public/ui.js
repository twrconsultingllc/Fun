// All DOM reads/writes live here so the engine and AI modules stay DOM-free.
// Team panels and the scoreboard are rendered from the active mode's roster,
// which is what lets 1v1, 2v2 and a four-way free-for-all share one UI.

import { match } from './state.js';
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
    teamConfig[id] = { prompt: DEFAULT_PROMPTS[id], hp: 225, speed: 125, model: '', weapon: DEFAULT_WEAPON };
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
            <input type="range" id="cfg-${team}-spd" class="slider-${team}" min="30" max="250" value="${c.speed}" step="5">
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
