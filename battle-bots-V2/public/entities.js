import { world, virtualSize } from './state.js';
import { hasLineOfSight } from './arena.js';
import { playSound } from './audio.js';

export class Bot {
    constructor(x, y, opts) {
        this.id = opts.id;          // e.g. "red-1"
        this.team = opts.team;
        this.color = opts.color;

        this.x = x; this.y = y;
        this.radius = 16;

        this.baseSpeed = opts.speed;
        this.maxHp = opts.hp;
        this.hp = this.maxHp;
        this.speed = this.baseSpeed;
        this.fireDelay = 1.0 / 2.5;
        this.fireCooldown = 0;

        this.aggression = 50;
        this.optimalDistance = 400 - (this.aggression * 3.6);
        this.activeSkill = "NONE";

        // Face the middle of the arena on spawn, whichever side we start on.
        this.angle = Math.atan2(virtualSize / 2 - y, virtualSize / 2 - x);
        this.vx = 0; this.vy = 0;
        this.strafeTimer = 0;
        this.strafeDir = Math.random() > 0.5 ? 1 : -1;
        this.dead = false;
        this.target = null;
    }

    applyAISkill(skillName, stats) {
        this.activeSkill = skillName;
        this.aggression = stats.aggression;
        this.optimalDistance = 400 - (this.aggression * 3.6);
        this.speed = this.baseSpeed * stats.speedModifier;
    }

    // Nearest living bot that isn't on our team.
    acquireTarget(bots) {
        let best = null, bestDist = Infinity;
        for (const other of bots) {
            if (other === this || other.dead || other.team === this.team) continue;
            const d = Math.hypot(other.x - this.x, other.y - this.y);
            if (d < bestDist) { bestDist = d; best = other; }
        }
        return best;
    }

    update(dt, bots) {
        if (this.dead) return;

        const target = this.acquireTarget(bots);
        this.target = target;
        if (!target) return;

        const dx = target.x - this.x, dy = target.y - this.y;
        const dist = Math.hypot(dx, dy) || 1;
        this.angle = Math.atan2(dy, dx);

        const dirX = dx / dist, dirY = dy / dist;
        const distError = dist - this.optimalDistance;
        const driveWeight = Math.min(Math.abs(distError) / 100, 1.0) * Math.sign(distError);

        this.strafeTimer -= dt;
        if (this.strafeTimer <= 0) {
            this.strafeDir *= -1;
            this.strafeTimer = Math.random() * 2 + 1;
        }

        const perpX = -dirY, perpY = dirX;
        const strafeWeight = 1.0 - (this.aggression / 100) * 0.5;

        let targetVx = (dirX * driveWeight + perpX * this.strafeDir * strafeWeight);
        let targetVy = (dirY * driveWeight + perpY * this.strafeDir * strafeWeight);

        const mag = Math.hypot(targetVx, targetVy);
        if (mag > 0) { targetVx = (targetVx / mag) * this.speed; targetVy = (targetVy / mag) * this.speed; }

        this.vx += (targetVx - this.vx) * 5 * dt;
        this.vy += (targetVy - this.vy) * 5 * dt;
        this.x += this.vx * dt;
        this.y += this.vy * dt;

        const pad = this.radius + 5;
        if (this.x < pad) { this.x = pad; this.vx *= -1; this.strafeDir *= -1; }
        if (this.x > virtualSize - pad) { this.x = virtualSize - pad; this.vx *= -1; this.strafeDir *= -1; }
        if (this.y < pad) { this.y = pad; this.vy *= -1; this.strafeDir *= -1; }
        if (this.y > virtualSize - pad) { this.y = virtualSize - pad; this.vy *= -1; this.strafeDir *= -1; }

        for (const obs of world.obstacles) {
            let testX = this.x, testY = this.y;
            if (this.x < obs.x) testX = obs.x; else if (this.x > obs.x + obs.w) testX = obs.x + obs.w;
            if (this.y < obs.y) testY = obs.y; else if (this.y > obs.y + obs.h) testY = obs.y + obs.h;

            let distance = Math.hypot(this.x - testX, this.y - testY);
            if (distance <= this.radius) {
                const overlap = this.radius - distance;
                if (distance === 0) distance = 1;
                const nx = (this.x - testX) / distance;
                const ny = (this.y - testY) / distance;
                this.x += nx * overlap; this.y += ny * overlap;
                const dot = this.vx * nx + this.vy * ny;
                if (dot < 0) { this.vx -= dot * nx; this.vy -= dot * ny; }
                if (this.strafeTimer <= 0) { this.strafeDir *= -1; this.strafeTimer = 0.5; }
            }
        }

        this.fireCooldown -= dt;
        if (this.fireCooldown <= 0) {
            const canSee = hasLineOfSight(this.x, this.y, target.x, target.y);
            if (canSee || (this.aggression > 80 && Math.random() > 0.5)) {
                const inaccuracy = (1.0 - (this.aggression / 100)) * 0.15;
                const fireAngle = this.angle + (Math.random() * inaccuracy * 2 - inaccuracy);
                world.bullets.push(new Bullet(
                    this.x + Math.cos(fireAngle) * 20,
                    this.y + Math.sin(fireAngle) * 20,
                    fireAngle, this.color, this.team, this.id
                ));
                playSound(this.team === 'red' ? 'shoot_red' : 'shoot_blue');
                this.fireCooldown = this.fireDelay;
            }
        }
    }

    draw(ctx) {
        if (this.dead) return;
        ctx.shadowBlur = 15; ctx.shadowColor = this.color; ctx.fillStyle = this.color;
        ctx.beginPath(); ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0; ctx.fillStyle = '#222';
        ctx.beginPath(); ctx.arc(this.x, this.y, this.radius - 4, 0, Math.PI * 2); ctx.fill();

        ctx.save(); ctx.translate(this.x, this.y); ctx.rotate(this.angle);
        ctx.fillStyle = this.color; ctx.fillRect(0, -4, 25, 8);
        ctx.fillStyle = '#fff'; ctx.fillRect(20, -2, 5, 4);
        ctx.restore();

        const hpPct = Math.max(0, this.hp / this.maxHp);
        ctx.fillStyle = '#333'; ctx.fillRect(this.x - 20, this.y - 30, 40, 6);
        ctx.fillStyle = hpPct > 0.5 ? '#0f0' : (hpPct > 0.2 ? '#fa0' : '#f00');
        ctx.fillRect(this.x - 20, this.y - 30, 40 * hpPct, 6);
    }
}

export class Bullet {
    constructor(x, y, angle, color, team, ownerId) {
        this.x = x; this.y = y; this.speed = 400;
        this.vx = Math.cos(angle) * this.speed; this.vy = Math.sin(angle) * this.speed;
        this.color = color; this.team = team; this.ownerId = ownerId;
        this.dead = false; this.damage = 15; this.length = 12;
    }
    update(dt) {
        this.x += this.vx * dt; this.y += this.vy * dt;
        if (this.x < 0 || this.x > virtualSize || this.y < 0 || this.y > virtualSize) this.dead = true;
    }
    draw(ctx) {
        ctx.strokeStyle = '#fff'; ctx.shadowBlur = 10; ctx.shadowColor = this.color; ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(this.x, this.y);
        ctx.lineTo(this.x - (this.vx / this.speed) * this.length, this.y - (this.vy / this.speed) * this.length);
        ctx.stroke();
        ctx.shadowBlur = 0;
    }
}

export class Particle {
    constructor(x, y, color, isExplosion = false) {
        this.x = x; this.y = y;
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * (isExplosion ? 250 : 80) + 20;
        this.vx = Math.cos(angle) * speed; this.vy = Math.sin(angle) * speed;
        this.color = color; this.life = 1.0;
        this.decay = Math.random() * 1.5 + 0.5;
        this.size = Math.random() * 4 + 2;
    }
    update(dt) {
        this.x += this.vx * dt; this.y += this.vy * dt;
        this.vx *= 0.95; this.vy *= 0.95; this.life -= this.decay * dt;
    }
    draw(ctx) {
        ctx.globalAlpha = Math.max(0, this.life); ctx.fillStyle = this.color;
        ctx.fillRect(this.x, this.y, this.size, this.size); ctx.globalAlpha = 1.0;
    }
}

export function spawnParticles(x, y, color, amount, isExplosion) {
    for (let i = 0; i < amount; i++) world.particles.push(new Particle(x, y, color, isExplosion));
}
