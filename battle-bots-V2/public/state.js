// Shared mutable world + match state.
// Every module imports these objects rather than passing them around, which keeps
// the module graph acyclic (nothing here imports anything).

export const virtualSize = 600;

export const world = {
    bots: [],
    bullets: [],
    particles: [],
    obstacles: [],
    pickups: [],
    rings: []          // expanding shockwaves
};

// Wall clock for canvas animations, advanced by the engine each frame.
export const clock = { t: 0 };

// Which teams have a model call in flight right now, for the thinking indicator.
export const thinking = {};

export const match = {
    phase: 'INIT',   // INIT | RUNNING | ENDED
    mode: '1v1',
    teams: ['red', 'blue'],
    wins: {},
    startedAt: 0,
    elapsed: 0
};

export function resetWorld() {
    world.bots = [];
    world.bullets = [];
    world.particles = [];
    world.obstacles = [];
    world.pickups = [];
    world.rings = [];
}
