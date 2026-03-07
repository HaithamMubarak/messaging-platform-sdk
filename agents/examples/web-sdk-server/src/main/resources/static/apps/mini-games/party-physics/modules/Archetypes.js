/**
 * Archetypes.js
 * Character archetypes with stats and abilities
 */

const ARCHETYPES = {
    bear: {
        name: 'Bear',
        icon: '🐻',
        role: 'Tank',
        hpMax: 140,
        speed: 0.85,
        mass: 1.5,
        strength: 1.3,
        staminaMax: 80,
        staminaRegenRate: 8,
        abilityCooldown: 8,
        abilityStaminaCost: 30,
        abilityName: 'Ground Slam',
        abilityDesc: 'AoE knockback around player',
        color: 0x8B4513,
        abilityFn: 'groundSlam'
    },
    bunny: {
        name: 'Bunny',
        icon: '🐰',
        role: 'Speedster',
        hpMax: 90,
        speed: 1.25,
        mass: 0.8,
        strength: 0.9,
        staminaMax: 120,
        staminaRegenRate: 12,
        abilityCooldown: 6,
        abilityStaminaCost: 35,
        abilityName: 'Blink Dash',
        abilityDesc: 'Long-distance dash',
        color: 0xFFB6C1,
        abilityFn: 'blinkDash'
    },
    bull: {
        name: 'Bull',
        icon: '🐂',
        role: 'Brawler',
        hpMax: 110,
        speed: 1.0,
        mass: 1.2,
        strength: 1.4,
        staminaMax: 90,
        staminaRegenRate: 9,
        abilityCooldown: 9,
        abilityStaminaCost: 40,
        abilityName: 'Charge',
        abilityDesc: 'Forward burst + stun on hit',
        color: 0xA52A2A,
        abilityFn: 'charge'
    },
    monkey: {
        name: 'Monkey',
        icon: '🐵',
        role: 'Trickster',
        hpMax: 100,
        speed: 1.05,
        mass: 1.0,
        strength: 1.0,
        staminaMax: 100,
        staminaRegenRate: 10,
        abilityCooldown: 4,
        abilityStaminaCost: 20,
        abilityName: 'Double Jump',
        abilityDesc: 'Extra mid-air jump',
        color: 0xD2691E,
        abilityFn: 'doubleJump'
    },
    frog: {
        name: 'Frog',
        icon: '🐸',
        role: 'Chaos',
        hpMax: 105,
        speed: 1.0,
        mass: 1.0,
        strength: 1.0,
        staminaMax: 100,
        staminaRegenRate: 10,
        abilityCooldown: 10,
        abilityStaminaCost: 0,
        abilityName: 'Random Buff',
        abilityDesc: 'Temporary random boost',
        color: 0x32CD32,
        abilityFn: 'randomBuff'
    }
};

// Damage constants
const DAMAGE = {
    PUNCH_BASE: 8,
    DASH_COLLISION: 6,
    BALL_HIT: 12,
    FALL_DAMAGE: 25,
    OUT_OF_BOUNDS_Y: -10
};

// Stamina costs
const STAMINA_COSTS = {
    DASH: 20,
    PUNCH: 5
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ARCHETYPES, DAMAGE, STAMINA_COSTS };
}

