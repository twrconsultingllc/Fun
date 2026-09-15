// Shared mutable world + match state.
// Every module imports these objects rather than passing them around, which keeps
// the module graph acyclic (nothing here imports anything).

export const virtualSize = 600;

export const world = {
    bots: [],
    bullets: [],
    particles: [],
    obstacles: []
};

export const match = {
    phase: 'INIT',   // INIT | RUNNING | ENDED
    mode: '1v1',
    teams: ['red', 'blue'],
    wins: {}
};

export function resetWorld() {
    world.bots = [];
    world.bullets = [];
    world.particles = [];
    world.obstacles = [];
}
