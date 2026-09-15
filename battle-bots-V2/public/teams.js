// Team identities and match-mode rosters.

import { virtualSize as S } from './state.js';

export const TEAMS = {
    red:  { id: 'red',  label: 'RED',  color: '#ff0055' },
    blue: { id: 'blue', label: 'BLUE', color: '#00e5ff' }
};

export const MODES = {
    '1v1': { label: '1 v 1', teams: ['red', 'blue'] },
    '2v2': { label: '2 v 2', teams: ['red', 'blue'] }
};

// Spawn coordinates per mode, keyed by team. Bot count per team is the array length,
// so adding a mode here is all it takes to change the roster.
export function spawnPoints(mode) {
    if (mode === '2v2') {
        return {
            red:  [[50, S / 2 - 100], [50, S / 2 + 100]],
            blue: [[S - 50, S / 2 - 100], [S - 50, S / 2 + 100]]
        };
    }
    return {
        red:  [[50, S / 2]],
        blue: [[S - 50, S / 2]]
    };
}
