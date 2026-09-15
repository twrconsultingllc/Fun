import { world, virtualSize } from './state.js';
import { hasLineOfSight } from './arena.js';
import { playShot } from './audio.js';
import { SKILL_CATALOG, WEAPONS, PICKUPS, DEFAULT_WEAPON } from './skills.js';

export class Bot {
    constructor(x, y, opts) {
        this.id = opts.id;
        this.team = opts.team;
        this.color = opts.color;

        this.x = x; this.y = y;
        this.radius = 16;

        this.baseSpeed = opts.speed;
        this.maxHp = opts.hp;
        this.hp = this.maxHp;
        this.weapon = WEAPONS[opts.weapon] || WEAPONS[DEFAULT_WEAPON];
        this.weaponId = WEAPONS[opts.weapon] ? opts.weapon : DEFAULT_WEAPON;
        this.fireCooldown = 0;

        this.aggression = 50;
        this.optimalDistance = 400 - (this.aggression * 3.6);

        // Active skill state. skillTimer counts the effect down; when it hits zero
        // the bot reverts to its baseline stance.
        this.activeSkill = 'NONE';
        this.skill = null;
        this.skillTimer = 0;
        this.dashTimer = 0;
        this.chargeTimer = 0;
        this.chargePending = false;

        // A shield is a damage pool, not a timer: it lasts until something eats it.
        this.shieldHp = 0;
        this.shieldMax = 0;

        this.damageBuff = 1; this.damageBuffTimer = 0;
        this.speedBuff = 1;  this.speedBuffTimer = 0;

        this.angle = Math.atan2(virtualSize / 2 - y, virtualSize / 2 - x);
        this.vx = 0; this.vy = 0;
        this.strafeTimer = 0;
        this.strafeDir = Math.random() > 0.5 ? 1 : -1;
        this.dead = false;
        this.target = null;
        this.reasoning = '';
        this.taunt = '';

        this.damageTaken = 0;
        this.damageDealtTotal = 0;
        this.damageTakenTotal = 0;
        this.shotsFired = 0;
        this.shotsHit = 0;
    }

    applyAISkill(skillName, skill) {
        const def = skill && skill.effect ? skill : SKILL_CATALOG[skillName];
        if (!def) return;

        this.activeSkill = skillName;
        this.skill = def;
        this.skillTimer = def.duration || 0;
        this.aggression = def.aggression;
        this.optimalDistance = 400 - (this.aggression * 3.6);

        if (def.effect === 'shield') {
            this.shieldHp = Math.max(this.shieldHp, def.shieldHp);
            this.shieldMax = Math.max(this.shieldMax, def.shieldHp);
        } else if (def.effect === 'charge') {
            this.chargeTimer = def.chargeTime;
            this.chargePending = true;
        } else if (def.effect === 'dash') {
            this.dashTimer = def.dashTime;
        }
    }

    get effect() {
        return this.skillTimer > 0 && this.skill ? this.skill.effect : null;
    }

    currentSpeed() {
        const mod = this.skillTimer > 0 && this.skill ? this.skill.speedModifier : 1;
        return this.baseSpeed * mod * this.speedBuff;
    }

    // Shields soak damage before HP does.
    takeDamage(amount) {
        let absorbed = 0;
        if (this.shieldHp > 0) {
            absorbed = Math.min(this.shieldHp, amount);
            this.shieldHp -= absorbed;
            amount -= absorbed;
        }
        this.hp -= amount;
        this.damageTaken += amount + absorbed;
        this.damageTakenTotal += amount + absorbed;
        return { absorbed, hpLost: amount };
    }

    acquireTarget(bots) {
        let best = null, bestDist = Infinity;
        for (const other of bots) {
            if (other === this || other.dead || other.team === this.team) continue;
            const d = Math.hypot(other.x - this.x, other.y - this.y);
            if (d < bestDist) { bestDist = d; best = other; }
        }
        return best;
    }

    tickTimers(dt) {
        if (this.skillTimer > 0) this.skillTimer = Math.max(0, this.skillTimer - dt);
        if (this.dashTimer > 0) this.dashTimer = Math.max(0, this.dashTimer - dt);
        if (this.damageBuffTimer > 0) {
            this.damageBuffTimer -= dt;
            if (this.damageBuffTimer <= 0) this.damageBuff = 1;
        }
        if (this.speedBuffTimer > 0) {
            this.speedBuffTimer -= dt;
            if (this.speedBuffTimer <= 0) this.speedBuff = 1;
        }
    }

    // Where the bot wants to be heading this frame, per its active skill.
    desiredVelocity(target, dirX, dirY, dist) {
        const speed = this.currentSpeed();
        const effect = this.effect;

        if (effect === 'dash' && this.dashTimer > 0) {
            const s = this.skill.dashSpeed * this.speedBuff;
            return [-dirX * s, -dirY * s];
        }

        if (effect === 'flank') {
            // Orbit to a point offset around the target; wall collision then does
            // the actual pathing around whatever cover is in the way.
            const around = Math.atan2(this.y - target.y, this.x - target.x) + this.skill.flankDir * 0.9;
            const wx = target.x + Math.cos(around) * this.optimalDistance;
            const wy = target.y + Math.sin(around) * this.optimalDistance;
            const wdx = wx - this.x, wdy = wy - this.y;
            const wmag = Math.hypot(wdx, wdy) || 1;
            return [(wdx / wmag) * speed, (wdy / wmag) * speed];
        }

        const distError = dist - this.optimalDistance;
        const driveWeight = Math.min(Math.abs(distError) / 100, 1.0) * Math.sign(distError);
        const perpX = -dirY, perpY = dirX;
        const strafeWeight = 1.0 - (this.aggression / 100) * 0.5;

        let vx = dirX * driveWeight + perpX * this.strafeDir * strafeWeight;
        let vy = dirY * driveWeight + perpY * this.strafeDir * strafeWeight;
        const mag = Math.hypot(vx, vy);
        if (mag > 0) { vx = (vx / mag) * speed; vy = (vy / mag) * speed; }
        return [vx, vy];
    }

    update(dt, bots) {
        if (this.dead) return;
        this.tickTimers(dt);

        const target = this.acquireTarget(bots);
        this.target = target;
        if (!target) return;

        const dx = target.x - this.x, dy = target.y - this.y;
        const dist = Math.hypot(dx, dy) || 1;
        this.angle = Math.atan2(dy, dx);
        const dirX = dx / dist, dirY = dy / dist;

        this.strafeTimer -= dt;
        if (this.strafeTimer <= 0) {
            this.strafeDir *= -1;
            this.strafeTimer = Math.random() * 2 + 1;
        }

        const [targetVx, targetVy] = this.desiredVelocity(target, dirX, dirY, dist);
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

        this.updateWeapons(dt, target);
    }

    updateWeapons(dt, target) {
        // A charging bot holds fire, then releases one piercing beam.
        if (this.chargePending) {
            this.chargeTimer -= dt;
            if (this.chargeTimer <= 0) {
                this.chargePending = false;
                this.fireBeam();
            }
            return;
        }

        this.fireCooldown -= dt;
        if (this.fireCooldown > 0) return;

        const canSee = hasLineOfSight(this.x, this.y, target.x, target.y);
        if (!canSee && !(this.aggression > 80 && Math.random() > 0.5)) return;

        this.fireWeapon();
    }

    fireDelay() {
        const rateMod = this.skillTimer > 0 && this.skill ? this.skill.fireRateModifier : 1;
        return 1 / (this.weapon.fireRate * rateMod);
    }

    fireWeapon() {
        const w = this.weapon;
        const skill = this.skillTimer > 0 ? this.skill : null;
        const aggrFactor = 0.5 + (1 - this.aggression / 100);
        const spread = w.spread * (skill ? skill.accuracyMultiplier : 1) * aggrFactor;
        const damage = w.damage * (skill ? skill.damageMultiplier : 1) * this.damageBuff;

        for (let i = 0; i < (w.pellets || 1); i++) {
            const a = this.angle + (Math.random() * spread * 2 - spread);
            world.bullets.push(new Bullet(
                this.x + Math.cos(a) * 20, this.y + Math.sin(a) * 20, a,
                { color: this.color, team: this.team, ownerId: this.id,
                  damage, speed: w.speed, pierce: !!w.pierce, homing: w.homing || 0 }
            ));
        }
        playShot(this.team);
        this.shotsFired++;
        this.fireCooldown = this.fireDelay();
    }

    fireBeam() {
        world.bullets.push(new Bullet(
            this.x + Math.cos(this.angle) * 20, this.y + Math.sin(this.angle) * 20, this.angle,
            { color: '#ffffff', team: this.team, ownerId: this.id,
              damage: this.skill.beamDamage * this.damageBuff, speed: 950,
              pierce: true, homing: 0, length: 30, width: 5 }
        ));
        playShot(this.team);
        this.shotsFired++;
        this.fireCooldown = this.fireDelay();
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

        // Shield arc, sized by how much of the pool is left.
        if (this.shieldHp > 0) {
            const pct = Math.max(0.15, this.shieldHp / (this.shieldMax || this.shieldHp));
            ctx.strokeStyle = '#c084fc';
            ctx.shadowBlur = 12; ctx.shadowColor = '#c084fc';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius + 7, -Math.PI * pct, Math.PI * pct);
            ctx.stroke();
            ctx.shadowBlur = 0;
        }

        // Charge tell: a ring that tightens as the beam winds up.
        if (this.chargePending && this.skill) {
            const t = 1 - Math.max(0, this.chargeTimer) / this.skill.chargeTime;
            ctx.strokeStyle = '#fff';
            ctx.globalAlpha = 0.4 + 0.6 * t;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius + 16 - 12 * t, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
        }

        // Rooted snipers get crosshair ticks so the stance reads at a glance.
        if (this.effect === 'root') {
            ctx.strokeStyle = this.color; ctx.globalAlpha = 0.7; ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(this.x - 26, this.y); ctx.lineTo(this.x - 20, this.y);
            ctx.moveTo(this.x + 20, this.y); ctx.lineTo(this.x + 26, this.y);
            ctx.moveTo(this.x, this.y - 26); ctx.lineTo(this.x, this.y - 20);
            ctx.moveTo(this.x, this.y + 20); ctx.lineTo(this.x, this.y + 26);
            ctx.stroke(); ctx.globalAlpha = 1;
        }

        const hpPct = Math.max(0, this.hp / this.maxHp);
        ctx.fillStyle = '#333'; ctx.fillRect(this.x - 20, this.y - 30, 40, 6);
        ctx.fillStyle = hpPct > 0.5 ? '#0f0' : (hpPct > 0.2 ? '#fa0' : '#f00');
        ctx.fillRect(this.x - 20, this.y - 30, 40 * hpPct, 6);

        // Buff pips.
        let pip = 0;
        if (this.damageBuffTimer > 0) { ctx.fillStyle = PICKUPS.damage.color; ctx.fillRect(this.x - 20 + pip * 7, this.y - 38, 5, 5); pip++; }
        if (this.speedBuffTimer > 0)  { ctx.fillStyle = PICKUPS.speed.color;  ctx.fillRect(this.x - 20 + pip * 7, this.y - 38, 5, 5); pip++; }
    }
}

export class Bullet {
    constructor(x, y, angle, opts) {
        this.x = x; this.y = y;
        this.speed = opts.speed;
        this.vx = Math.cos(angle) * this.speed;
        this.vy = Math.sin(angle) * this.speed;
        this.color = opts.color;
        this.team = opts.team;
        this.ownerId = opts.ownerId;
        this.damage = opts.damage;
        this.pierce = !!opts.pierce;
        this.homing = opts.homing || 0;
        this.length = opts.length || 12;
        this.width = opts.width || 3;
        this.dead = false;
        this.hitIds = new Set();
    }

    update(dt) {
        if (this.homing > 0) {
            let best = null, bestDist = Infinity;
            for (const bot of world.bots) {
                if (bot.dead || bot.team === this.team) continue;
                const d = Math.hypot(bot.x - this.x, bot.y - this.y);
                if (d < bestDist) { bestDist = d; best = bot; }
            }
            if (best) {
                const desired = Math.atan2(best.y - this.y, best.x - this.x);
                const current = Math.atan2(this.vy, this.vx);
                let delta = desired - current;
                while (delta > Math.PI) delta -= Math.PI * 2;
                while (delta < -Math.PI) delta += Math.PI * 2;
                const next = current + Math.max(-this.homing * dt, Math.min(this.homing * dt, delta));
                this.vx = Math.cos(next) * this.speed;
                this.vy = Math.sin(next) * this.speed;
            }
        }

        this.x += this.vx * dt; this.y += this.vy * dt;
        if (this.x < 0 || this.x > virtualSize || this.y < 0 || this.y > virtualSize) this.dead = true;
    }

    draw(ctx) {
        ctx.strokeStyle = '#fff'; ctx.shadowBlur = 10; ctx.shadowColor = this.color;
        ctx.lineWidth = this.width;
        ctx.beginPath();
        ctx.moveTo(this.x, this.y);
        ctx.lineTo(this.x - (this.vx / this.speed) * this.length, this.y - (this.vy / this.speed) * this.length);
        ctx.stroke();
        ctx.shadowBlur = 0;
    }
}

export class Pickup {
    constructor(x, y, type) {
        this.x = x; this.y = y;
        this.type = type;
        this.def = PICKUPS[type];
        this.radius = 12;
        this.life = 22;
        this.pulse = 0;
        this.dead = false;
    }

    update(dt) {
        this.life -= dt;
        this.pulse += dt * 4;
        if (this.life <= 0) this.dead = true;
    }

    applyTo(bot) {
        const d = this.def;
        if (this.type === 'health') bot.hp = Math.min(bot.maxHp, bot.hp + d.amount);
        else if (this.type === 'shield') {
            bot.shieldHp += d.shieldHp;
            bot.shieldMax = Math.max(bot.shieldMax, bot.shieldHp);
        } else if (this.type === 'damage') { bot.damageBuff = d.multiplier; bot.damageBuffTimer = d.duration; }
        else if (this.type === 'speed') { bot.speedBuff = d.multiplier; bot.speedBuffTimer = d.duration; }
    }

    draw(ctx) {
        const wobble = 1 + Math.sin(this.pulse) * 0.12;
        const fading = this.life < 4 && Math.floor(this.life * 6) % 2 === 0;
        ctx.globalAlpha = fading ? 0.35 : 1;

        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(Math.PI / 4);
        ctx.shadowBlur = 14; ctx.shadowColor = this.def.color;
        ctx.strokeStyle = this.def.color; ctx.lineWidth = 2;
        ctx.fillStyle = 'rgba(10,10,16,0.85)';
        const s = this.radius * wobble;
        ctx.fillRect(-s, -s, s * 2, s * 2);
        ctx.strokeRect(-s, -s, s * 2, s * 2);
        ctx.restore();

        ctx.shadowBlur = 0;
        ctx.fillStyle = this.def.color;
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(this.def.label, this.x, this.y);
        ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
        ctx.globalAlpha = 1;
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
