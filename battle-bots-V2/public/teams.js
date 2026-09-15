// Team identities and match-mode rosters.

import { virtualSize as S } from './state.js';

export const TEAMS = {
    red:    { id: 'red',    label: 'RED',    color: '#ff0055', tone: 400 },
    blue:   { id: 'blue',   label: 'BLUE',   color: '#00e5ff', tone: 600 },
    green:  { id: 'green',  label: 'GREEN',  color: '#39ff6a', tone: 500 },
    yellow: { id: 'yellow', label: 'YELLOW', color: '#ffd23f', tone: 720 }
};

export const MODES = {
    '1v1': { label: '1 V 1',                 teams: ['red', 'blue'] },
    '2v2': { label: '2 V 2 — TEAM BATTLE',   teams: ['red', 'blue'] },
    'ffa': { label: 'FREE-FOR-ALL — 4 BOTS', teams: ['red', 'green', 'blue', 'yellow'] }
};

// Spawn coordinates per mode, keyed by team. Bot count per team is the array
// length, so adding a mode here is all it takes to change the roster.
export function spawnPoints(mode) {
    if (mode === '2v2') {
        return {
            red:  [[50, S / 2 - 100], [50, S / 2 + 100]],
            blue: [[S - 50, S / 2 - 100], [S - 50, S / 2 + 100]]
        };
    }
    if (mode === 'ffa') {
        return {
            red:    [[60, 60]],
            green:  [[S - 60, 60]],
            blue:   [[S - 60, S - 60]],
            yellow: [[60, S - 60]]
        };
    }
    return {
        red:  [[50, S / 2]],
        blue: [[S - 50, S / 2]]
    };
}
