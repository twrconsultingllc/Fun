// Single source of truth for skills, weapons and pickups.
// Imported by the browser AND by api/get-actions.js, so the options the model is
// offered and the behaviour the engine implements cannot drift apart.

// effect drives real behaviour in Bot.update — these are no longer just two numbers.
export const SKILL_CATALOG = {
    SNIPE_STANCE: {
        action: 'Snipe',
        description: 'Root in place for slow, very accurate, double-damage shots.',
        effect: 'root',
        aggression: 10, speedModifier: 0.0, duration: 3.0,
        damageMultiplier: 2.0, fireRateModifier: 0.5, accuracyMultiplier: 0.15
    },
    FLANK_LEFT: {
        action: 'Flank Left',
        description: 'Arc around the target to its left, using cover.',
        effect: 'flank', flankDir: -1,
        aggression: 60, speedModifier: 1.2, duration: 4.0,
        damageMultiplier: 1.0, fireRateModifier: 1.0, accuracyMultiplier: 1.0
    },
    FLANK_RIGHT: {
        action: 'Flank Right',
        description: 'Arc around the target to its right, using cover.',
        effect: 'flank', flankDir: 1,
        aggression: 60, speedModifier: 1.2, duration: 4.0,
        damageMultiplier: 1.0, fireRateModifier: 1.0, accuracyMultiplier: 1.0
    },
    CHARGE_BEAM: {
        action: 'Aggressive Charge',
        description: 'Wind up briefly, then fire one heavy piercing shot from your own weapon, while closing fast.',
        effect: 'charge', chargeTime: 1.2, chargeDamageMultiplier: 6, chargeSpeedMultiplier: 1.4,
        aggression: 100, speedModifier: 1.5, duration: 4.0,
        damageMultiplier: 1.0, fireRateModifier: 1.0, accuracyMultiplier: 1.0
    },
    KITE_RETREAT: {
        action: 'Retreat',
        description: 'Burst-dash away from the target, then hold distance.',
        effect: 'dash', dashTime: 0.45, dashSpeed: 520,
        aggression: 0, speedModifier: 1.0, duration: 3.5,
        damageMultiplier: 1.0, fireRateModifier: 1.0, accuracyMultiplier: 1.0
    },
    DEFENSIVE_SHIELD: {
        action: 'Defend',
        description: 'Raise a shield that absorbs 70 damage before HP is touched.',
        effect: 'shield', shieldHp: 70,
        aggression: 30, speedModifier: 0.5, duration: 5.0,
        damageMultiplier: 1.0, fireRateModifier: 1.0, accuracyMultiplier: 1.0
    }
};

export const DEFAULT_SKILL = 'SNIPE_STANCE';

export const WEAPONS = {
    rapid:   { label: 'Rapid',   fireRate: 0.8,  damage: 9,  speed: 430, spread: 0.09, pellets: 1 },
    shotgun: { label: 'Shotgun', fireRate: 0.22, damage: 7,  speed: 380, spread: 0.30, pellets: 5 },
    railgun: { label: 'Railgun', fireRate: 0.14, damage: 45, speed: 900, spread: 0.02, pellets: 1, pierce: true },
    homing:  { label: 'Homing',  fireRate: 0.32, damage: 12, speed: 260, spread: 0.05, pellets: 1, homing: 2.6 }
};

export const DEFAULT_WEAPON = 'rapid';

export const PICKUPS = {
    health: { label: 'HP',  color: '#39ff6a', amount: 60 },
    damage: { label: 'DMG', color: '#ff8c1a', multiplier: 1.6, duration: 9 },
    speed:  { label: 'SPD', color: '#00e5ff', multiplier: 1.45, duration: 9 },
    shield: { label: 'SHD', color: '#c084fc', shieldHp: 50 }
};

// Trimmed view for the model prompt: what a skill does, not how the engine does it.
export function catalogForPrompt() {
    const out = {};
    for (const [name, s] of Object.entries(SKILL_CATALOG)) {
        out[name] = { action: s.action, description: s.description, lastsSeconds: s.duration };
    }
    return out;
}
