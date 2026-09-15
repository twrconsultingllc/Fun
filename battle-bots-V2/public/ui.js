// All DOM reads/writes live here so the engine and AI modules stay DOM-free.

import { match } from './state.js';

const els = {
    overlay:     document.getElementById('arena-overlay'),
    btnStart:    document.getElementById('btn-start'),
    btnOverlay:  document.getElementById('btn-overlay-start'),
    modelSelect: document.getElementById('model-select'),
    modeSelect:  document.getElementById('mode-select'),
    logContent:  document.getElementById('log-content'),
    scoreRed:    document.getElementById('score-red'),
    scoreBlue:   document.getElementById('score-blue')
};

export const dom = els;

let logs = [];

export function addLog(type, data) {
    const timestamp = new Date().toLocaleTimeString();
    const colorClass = type === 'SENT' ? 'log-sent' : type === 'RECV' ? 'log-recv' : 'log-error';
    const body = typeof data === 'object' ? JSON.stringify(data) : data;
    logs.unshift(`<div class="log-entry"><span style="color:#555">[${timestamp}]</span> <strong class="${colorClass}">${type}:</strong> ${body}</div>`);
    if (logs.length > 10) logs.pop();
    els.logContent.innerHTML = logs.join('');
}

export function bindSlider(id, labelId, suffix = '') {
    const slider = document.getElementById(id);
    const label = document.getElementById(labelId);
    slider.addEventListener('input', () => label.innerText = slider.value + suffix);
}

export function bindAllSliders() {
    bindSlider('cfg-r-hp', 'val-r-hp'); bindSlider('cfg-r-spd', 'val-r-spd');
    bindSlider('cfg-b-hp', 'val-b-hp'); bindSlider('cfg-b-spd', 'val-b-spd');
    bindSlider('cfg-a-obs', 'val-a-obs');
}

// Both bots on a team share their team's configuration in 2v2.
export function readTeamConfig(team) {
    const p = team === 'red' ? 'r' : 'b';
    return {
        hp: parseFloat(document.getElementById(`cfg-${p}-hp`).value),
        speed: parseFloat(document.getElementById(`cfg-${p}-spd`).value)
    };
}

export function readPrompt(team) {
    return document.getElementById(team === 'red' ? 'prompt-a' : 'prompt-b').value;
}

export const getSelectedModel = () => els.modelSelect.value;
export const getMode = () => els.modeSelect.value;
export const getArenaLevel = () => parseInt(document.getElementById('cfg-a-obs').value, 10);

export function setMatchButton(text, background) {
    els.btnStart.innerHTML = text;
    els.btnStart.style.background = background;
}

export function hideOverlay() { els.overlay.classList.add('hidden'); }

export function updateScoreboard() {
    els.scoreRed.innerText = `RED: ${match.wins.red}`;
    els.scoreBlue.innerText = `BLUE: ${match.wins.blue}`;
}
