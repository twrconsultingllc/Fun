import { world, match, resetWorld } from './state.js';
import { TEAMS, MODES, spawnPoints } from './teams.js';
import { Bot } from './entities.js';
import { generateArena } from './arena.js';
import { initAudio } from './audio.js';
import { loadAvailableModels, startAiLoop, stopAiLoop } from './ai.js';
import { abortMatch, paintIdleArena, startRenderLoop } from './engine.js';
import { resetMatchMemory } from './memory.js';
import {
    activeTeams, bindGlobalSliders, dom, getArenaLevel, getMode, getTeamConfig,
    hideOverlay, renderTeamPanels, setMatchButton, updateScoreboard
} from './ui.js';

function buildRoster(mode) {
    const points = spawnPoints(mode);
    const bots = [];
    for (const teamId of MODES[mode].teams) {
        const cfg = getTeamConfig(teamId);
        points[teamId].forEach(([x, y], i) => {
            bots.push(new Bot(x, y, {
                id: `${teamId}-${i + 1}`,
                team: teamId,
                color: TEAMS[teamId].color,
                hp: cfg.hp,
                speed: cfg.speed
            }));
        });
    }
    return bots;
}

function startSimulation() {
    initAudio();
    stopAiLoop();

    const mode = getMode();
    const teams = MODES[mode].teams;
    match.mode = mode;
    match.teams = teams;
    for (const t of teams) match.wins[t] ??= 0;

    resetWorld();
    world.bots = buildRoster(mode);
    generateArena(getArenaLevel());
    resetMatchMemory(teams);

    hideOverlay();
    updateScoreboard();
    setMatchButton('■ ABORT AI MATCH', '#ef4444');

    match.phase = 'RUNNING';
    startAiLoop(teams);
    startRenderLoop();
}

function applyMode() {
    match.teams = activeTeams();
    renderTeamPanels();
    updateScoreboard();
}

bindGlobalSliders();
applyMode();
paintIdleArena();
loadAvailableModels();

dom.modeSelect.addEventListener('change', applyMode);
dom.btnOverlay.addEventListener('click', startSimulation);
dom.btnStart.addEventListener('click', () => {
    if (match.phase === 'INIT' || match.phase === 'ENDED') startSimulation();
    else abortMatch();
});
