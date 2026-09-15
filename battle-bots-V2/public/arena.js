import { world, virtualSize } from './state.js';

export function lineIntersectsRect(x1, y1, x2, y2, rect) {
    const minX = rect.x, maxX = rect.x + rect.w, minY = rect.y, maxY = rect.y + rect.h;
    if (Math.min(x1, x2) > maxX || Math.max(x1, x2) < minX || Math.min(y1, y2) > maxY || Math.max(y1, y2) < minY) return false;
    const steps = 10;
    for (let i = 0; i <= steps; i++) {
        const t = i / steps, tx = x1 + (x2 - x1) * t, ty = y1 + (y2 - y1) * t;
        if (tx >= minX && tx <= maxX && ty >= minY && ty <= maxY) return true;
    }
    return false;
}

export function hasLineOfSight(x1, y1, x2, y2) {
    for (const obs of world.obstacles) {
        if (lineIntersectsRect(x1, y1, x2, y2, obs)) return false;
    }
    return true;
}

export function generateArena(level) {
    const obstacles = [];
    if (level === 1) {
        const size = 60, inset = 90;
        obstacles.push({ x: inset, y: inset, w: size, h: size });
        obstacles.push({ x: virtualSize - inset - size, y: inset, w: size, h: size });
        obstacles.push({ x: inset, y: virtualSize - inset - size, w: size, h: size });
        obstacles.push({ x: virtualSize - inset - size, y: virtualSize - inset - size, w: size, h: size });
    } else if (level === 2) {
        const w = 240, h = 40, cx = virtualSize / 2 - w / 2;
        obstacles.push({ x: cx, y: 150, w: w, h: h });
        obstacles.push({ x: cx, y: virtualSize - 150 - h, w: w, h: h });
    } else if (level === 3) {
        const w = 120, h = 40;
        obstacles.push({ x: virtualSize / 2 - w / 2, y: 100, w: w, h: h });
        obstacles.push({ x: virtualSize / 2 - w / 2, y: virtualSize - 100 - h, w: w, h: h });
        obstacles.push({ x: 100, y: virtualSize / 2 - w / 2, w: h, h: w });
        obstacles.push({ x: virtualSize - 100 - h, y: virtualSize / 2 - w / 2, w: h, h: w });
    }
    world.obstacles = obstacles;
}
