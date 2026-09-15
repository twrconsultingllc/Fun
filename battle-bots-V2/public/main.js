import { world, match, resetWorld } from './state.js';
import { TEAMS, MODES, spawnPoints } from './teams.js';
import { Bot } from './entities.js';
import { generateArena } from './arena.js';
import { initAudio } from './audio.js';
import { fetchTacticalTurn, loadAvailableModels, stopAiLoop } from './ai.js';
import { abortMatch, paintIdleArena, startRenderLoop } from './engine.js';
import {
    bindAllSliders, dom, getArenaLevel, getMode,
    hideOverlay, readTeamConfig, setMatchButton, updateScoreboard
} from './ui.js';

function buildRoster(mode) {
    const points = spawnPoints(mode);
    const bots = [];
    for (const teamId of MODES[mode].teams) {
        const cfg = readTeamConfig(teamId);
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
    match.mode = mode;

    resetWorld();
    world.bots = buildRoster(mode);
    generateArena(getArenaLevel());

    hideOverlay();
    setMatchButton('■ ABORT AI MATCH', '#ef4444');

    match.phase = 'RUNNING';
    fetchTacticalTurn(0);
    startRenderLoop();
}

bindAllSliders();
updateScoreboard();
paintIdleArena();
loadAvailableModels();

dom.btnOverlay.addEventListener('click', startSimulation);
dom.btnStart.addEventListener('click', () => {
    if (match.phase === 'INIT' || match.phase === 'ENDED') startSimulation();
    else abortMatch();
});
