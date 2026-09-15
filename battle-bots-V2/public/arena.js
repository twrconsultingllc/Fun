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

// Cover is destructible now, so every block carries hit points.
const COVER_HP = 120;
const rect = (x, y, w, h) => ({ x, y, w, h, hp: COVER_HP, maxHp: COVER_HP });

export function generateArena(level) {
    const obstacles = [];
    if (level === 1) {
        const size = 60, inset = 90;
        obstacles.push(rect(inset, inset, size, size));
        obstacles.push(rect(virtualSize - inset - size, inset, size, size));
        obstacles.push(rect(inset, virtualSize - inset - size, size, size));
        obstacles.push(rect(virtualSize - inset - size, virtualSize - inset - size, size, size));
    } else if (level === 2) {
        const w = 240, h = 40, cx = virtualSize / 2 - w / 2;
        obstacles.push(rect(cx, 150, w, h));
        obstacles.push(rect(cx, virtualSize - 150 - h, w, h));
    } else if (level === 3) {
        const w = 120, h = 40;
        obstacles.push(rect(virtualSize / 2 - w / 2, 100, w, h));
        obstacles.push(rect(virtualSize / 2 - w / 2, virtualSize - 100 - h, w, h));
        obstacles.push(rect(100, virtualSize / 2 - w / 2, h, w));
        obstacles.push(rect(virtualSize - 100 - h, virtualSize / 2 - w / 2, h, w));
    }
    world.obstacles = obstacles;
}


export function isClearOfCover(x, y, pad = 18) {
    for (const obs of world.obstacles) {
        if (x > obs.x - pad && x < obs.x + obs.w + pad && y > obs.y - pad && y < obs.y + obs.h + pad) return false;
    }
    return true;
}
