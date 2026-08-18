/**
 * Map Data for Mini Fall Guys
 * Contains obstacle course definitions
 */

const MAP_DATA = {
    // Map 1: Obstacle Rush
    obstacleRush: {
        id: 'obstacle-rush',
        name: 'Obstacle Rush',
        description: 'Race through spinning obstacles and jump over barriers!',

        // Starting area
        startLine: {
            position: { x: 0, y: 0, z: 0 },
            width: 20,
            depth: 10
        },

        // Finish line
        finishLine: {
            position: { x: 0, y: 0, z: -200 },
            width: 20,
            depth: 5
        },

        // Track sections
        sections: [
            // Section 1: Starting Platform
            {
                type: 'platform',
                position: { x: 0, y: -0.5, z: 0 },
                size: { width: 20, height: 1, depth: 15 },
                color: 0x4a9eff
            },

            // Section 2: First Ramp Down
            {
                type: 'ramp',
                position: { x: 0, y: -2, z: -15 },
                size: { width: 20, height: 0.5, depth: 15 },
                rotation: { x: 0.15, y: 0, z: 0 },
                color: 0x4a9eff
            },

            // Section 3: Spinning Hammers Area
            {
                type: 'platform',
                position: { x: 0, y: -4, z: -40 },
                size: { width: 20, height: 1, depth: 30 },
                color: 0xff6b6b
            },

            // Section 4: Jump Gaps
            {
                type: 'platform',
                position: { x: -6, y: -4, z: -65 },
                size: { width: 6, height: 1, depth: 8 },
                color: 0x4ecdc4
            },
            {
                type: 'platform',
                position: { x: 6, y: -4, z: -65 },
                size: { width: 6, height: 1, depth: 8 },
                color: 0x4ecdc4
            },
            {
                type: 'platform',
                position: { x: 0, y: -4, z: -80 },
                size: { width: 8, height: 1, depth: 8 },
                color: 0x4ecdc4
            },

            // Section 5: Narrow Bridge
            {
                type: 'platform',
                position: { x: 0, y: -4, z: -100 },
                size: { width: 6, height: 1, depth: 25 },
                color: 0xffd93d
            },

            // Section 6: Wide Platform with Pushers
            {
                type: 'platform',
                position: { x: 0, y: -4, z: -135 },
                size: { width: 20, height: 1, depth: 25 },
                color: 0xff6b6b
            },

            // Section 7: Stepping Stones
            {
                type: 'platform',
                position: { x: -5, y: -3, z: -155 },
                size: { width: 4, height: 1, depth: 4 },
                color: 0x4ecdc4
            },
            {
                type: 'platform',
                position: { x: 5, y: -2, z: -162 },
                size: { width: 4, height: 1, depth: 4 },
                color: 0x4ecdc4
            },
            {
                type: 'platform',
                position: { x: -3, y: -1, z: -170 },
                size: { width: 4, height: 1, depth: 4 },
                color: 0x4ecdc4
            },
            {
                type: 'platform',
                position: { x: 4, y: 0, z: -178 },
                size: { width: 4, height: 1, depth: 4 },
                color: 0x4ecdc4
            },

            // Section 8: Final Platform
            {
                type: 'platform',
                position: { x: 0, y: 0, z: -195 },
                size: { width: 20, height: 1, depth: 15 },
                color: 0x4a9eff
            }
        ],

        // Obstacles
        obstacles: [
            // Spinning Hammers in Section 3
            {
                type: 'spinningBar',
                position: { x: 0, y: -2, z: -35 },
                size: { width: 14, height: 2, depth: 1 },
                rotationSpeed: 1.5,
                color: 0xff4757
            },
            {
                type: 'spinningBar',
                position: { x: 0, y: -2, z: -50 },
                size: { width: 14, height: 2, depth: 1 },
                rotationSpeed: -2,
                color: 0xff4757
            },

            // Swinging Pendulum in Section 5
            {
                type: 'pendulum',
                position: { x: 0, y: 2, z: -105 },
                size: { radius: 1.5, height: 6 },
                swingSpeed: 2,
                swingAngle: 0.8,
                color: 0xff4757
            },
            {
                type: 'pendulum',
                position: { x: 0, y: 2, z: -115 },
                size: { radius: 1.5, height: 6 },
                swingSpeed: 2.5,
                swingAngle: 0.7,
                color: 0xff4757
            },

            // Pushers in Section 6
            {
                type: 'pusher',
                position: { x: -12, y: -3, z: -130 },
                size: { width: 4, height: 3, depth: 3 },
                pushDistance: 8,
                pushSpeed: 3,
                pushDelay: 0,
                color: 0xffd93d
            },
            {
                type: 'pusher',
                position: { x: 12, y: -3, z: -138 },
                size: { width: 4, height: 3, depth: 3 },
                pushDistance: -8,
                pushSpeed: 3,
                pushDelay: 0.5,
                color: 0xffd93d
            },

            // Jump Barriers
            {
                type: 'barrier',
                position: { x: 0, y: -3.5, z: -28 },
                size: { width: 18, height: 1.5, depth: 0.5 },
                color: 0xff6b6b
            },
            {
                type: 'barrier',
                position: { x: 0, y: -3.5, z: -45 },
                size: { width: 18, height: 1.5, depth: 0.5 },
                color: 0xff6b6b
            }
        ],

        // Decorations
        decorations: [
            // Flags at start
            {
                type: 'flag',
                position: { x: -10, y: 0, z: 5 },
                color: 0x22c55e
            },
            {
                type: 'flag',
                position: { x: 10, y: 0, z: 5 },
                color: 0x22c55e
            },

            // Flags at finish
            {
                type: 'flag',
                position: { x: -10, y: 0, z: -200 },
                color: 0xffd700
            },
            {
                type: 'flag',
                position: { x: 10, y: 0, z: -200 },
                color: 0xffd700
            },

            // Finish Banner
            {
                type: 'banner',
                position: { x: 0, y: 6, z: -200 },
                text: 'FINISH',
                color: 0xffd700
            }
        ],

        // Boundaries (invisible walls)
        boundaries: [
            // Left wall
            {
                position: { x: -12, y: 0, z: -100 },
                size: { width: 1, height: 20, depth: 220 }
            },
            // Right wall
            {
                position: { x: 12, y: 0, z: -100 },
                size: { width: 1, height: 20, depth: 220 }
            }
        ],

        // Respawn points (if player falls)
        respawnPoints: [
            { x: 0, y: 2, z: 0 },
            { x: 0, y: -2, z: -30 },
            { x: 0, y: -2, z: -60 },
            { x: 0, y: -2, z: -95 },
            { x: 0, y: -2, z: -130 },
            { x: 0, y: 2, z: -175 }
        ],

        // Kill zone (Y position where player dies/respawns)
        killZoneY: -15,

        // Skybox color
        skyColor: 0x87ceeb,

        // Fog settings
        fog: {
            color: 0x87ceeb,
            near: 50,
            far: 250
        },

        // Ambient light
        ambientLight: {
            color: 0xffffff,
            intensity: 0.6
        },

        // Directional light (sun)
        directionalLight: {
            color: 0xffffff,
            intensity: 0.8,
            position: { x: 50, y: 100, z: 50 }
        }
    },

    // Map 2: Slime Climb — a steady ascent. Wide, forgiving platforms, but the
    // pushers sit right where you want to land and the beams narrow near the top.
    slimeClimb: {
        id: 'slime-climb',
        name: 'Slime Climb',
        description: 'Climb the terraces. The pushers are aiming for the edge you are standing on.',

        startLine: { position: { x: 0, y: 0, z: 0 }, width: 20, depth: 10 },
        finishLine: { position: { x: 0, y: 4, z: -152 }, width: 20, depth: 5 },

        sections: [
            // Terrace 0 — start
            { type: 'platform', position: { x: 0, y: -0.5, z: 0 }, size: { width: 20, height: 1, depth: 16 }, color: 0x4ecdc4 },
            // Ramp up to terrace 1
            { type: 'ramp', position: { x: 0, y: 0, z: -18 }, size: { width: 20, height: 0.5, depth: 16 }, rotation: { x: -0.09, y: 0, z: 0 }, color: 0x3fb8af },
            // Terrace 1 — pusher gauntlet
            { type: 'platform', position: { x: 0, y: 0.5, z: -40 }, size: { width: 20, height: 1, depth: 28 }, color: 0x4ecdc4 },
            // Ramp up to terrace 2
            { type: 'ramp', position: { x: 0, y: 1, z: -62 }, size: { width: 20, height: 0.5, depth: 16 }, rotation: { x: -0.09, y: 0, z: 0 }, color: 0x3fb8af },
            // Terrace 2 — pendulums
            { type: 'platform', position: { x: 0, y: 1.5, z: -85 }, size: { width: 20, height: 1, depth: 28 }, color: 0x4ecdc4 },
            // Split beams — pick a side, both work
            { type: 'platform', position: { x: -5.5, y: 1.5, z: -110 }, size: { width: 6, height: 1, depth: 22 }, color: 0xffd93d },
            { type: 'platform', position: { x: 5.5, y: 1.5, z: -110 }, size: { width: 6, height: 1, depth: 22 }, color: 0xffd93d },
            // Terrace 3 — spinning bars
            { type: 'platform', position: { x: 0, y: 1.5, z: -133 }, size: { width: 20, height: 1, depth: 24 }, color: 0x4ecdc4 },
            // Finish shelf
            { type: 'platform', position: { x: 0, y: 1.5, z: -152 }, size: { width: 20, height: 1, depth: 16 }, color: 0x22c55e }
        ],

        obstacles: [
            // Terrace 1 — pushers from alternating sides
            { type: 'pusher', position: { x: -12, y: 2, z: -34 }, size: { width: 4, height: 3, depth: 4 }, pushDistance: 9, pushSpeed: 3, pushDelay: 0, color: 0xffd93d },
            { type: 'pusher', position: { x: 12, y: 2, z: -44 }, size: { width: 4, height: 3, depth: 4 }, pushDistance: -9, pushSpeed: 3, pushDelay: 0.6, color: 0xffd93d },
            { type: 'barrier', position: { x: 0, y: 1.8, z: -50 }, size: { width: 18, height: 1.5, depth: 0.5 }, color: 0xff6b6b },

            // Terrace 2 — swinging pendulums
            { type: 'pendulum', position: { x: -4, y: 6, z: -80 }, size: { radius: 1.4, height: 6 }, swingSpeed: 2, swingAngle: 0.7, color: 0xff4757 },
            { type: 'pendulum', position: { x: 4, y: 6, z: -90 }, size: { radius: 1.4, height: 6 }, swingSpeed: 2.4, swingAngle: 0.7, color: 0xff4757 },

            // Beams — one spinner per lane, offset so the lanes are not identical
            { type: 'spinningBar', position: { x: -5.5, y: 3, z: -108 }, size: { width: 7, height: 1.6, depth: 1 }, rotationSpeed: 1.6, color: 0xff4757 },
            { type: 'spinningBar', position: { x: 5.5, y: 3, z: -114 }, size: { width: 7, height: 1.6, depth: 1 }, rotationSpeed: -2.1, color: 0xff4757 },

            // Terrace 3 — the last wall of hammers
            { type: 'spinningBar', position: { x: 0, y: 3, z: -128 }, size: { width: 16, height: 2, depth: 1 }, rotationSpeed: 2.2, color: 0xff4757 },
            { type: 'spinningBar', position: { x: 0, y: 3, z: -140 }, size: { width: 16, height: 2, depth: 1 }, rotationSpeed: -1.7, color: 0xff4757 },
            { type: 'barrier', position: { x: 0, y: 2.8, z: -146 }, size: { width: 18, height: 1.5, depth: 0.5 }, color: 0xff6b6b }
        ],

        decorations: [
            { type: 'flag', position: { x: -10, y: 0, z: 6 }, color: 0x22c55e },
            { type: 'flag', position: { x: 10, y: 0, z: 6 }, color: 0x22c55e },
            { type: 'flag', position: { x: -10, y: 2, z: -152 }, color: 0xffd700 },
            { type: 'flag', position: { x: 10, y: 2, z: -152 }, color: 0xffd700 },
            { type: 'banner', position: { x: 0, y: 8, z: -152 }, text: 'FINISH', color: 0xffd700 }
        ],

        boundaries: [
            { position: { x: -12, y: 2, z: -76 }, size: { width: 1, height: 22, depth: 180 } },
            { position: { x: 12, y: 2, z: -76 }, size: { width: 1, height: 22, depth: 180 } }
        ],

        respawnPoints: [
            { x: 0, y: 2, z: 0 },
            { x: 0, y: 3, z: -32 },
            { x: 0, y: 4, z: -76 },
            { x: -5.5, y: 4, z: -104 },
            { x: 0, y: 4, z: -128 }
        ],

        killZoneY: -10,
        skyColor: 0x9ad7ff,
        fog: { color: 0x9ad7ff, near: 50, far: 250 },
        ambientLight: { color: 0xffffff, intensity: 0.65 },
        directionalLight: { color: 0xffffff, intensity: 0.85, position: { x: 40, y: 100, z: 40 } }
    },

    // Map 3: Hammer Alley — short, flat and mean. No climbing, nowhere to hide.
    // Roughly half the length of the others, so it makes a good decider round.
    hammerAlley: {
        id: 'hammer-alley',
        name: 'Hammer Alley',
        description: 'One narrow corridor, eight moving parts. Short enough to run twice.',

        startLine: { position: { x: 0, y: 0, z: 0 }, width: 14, depth: 8 },
        finishLine: { position: { x: 0, y: 0, z: -112 }, width: 14, depth: 5 },

        sections: [
            { type: 'platform', position: { x: 0, y: -0.5, z: 0 }, size: { width: 14, height: 1, depth: 14 }, color: 0x6366f1 },
            // The alley itself
            { type: 'platform', position: { x: 0, y: -0.5, z: -32 }, size: { width: 14, height: 1, depth: 52 }, color: 0x818cf8 },
            // Gap, then the pusher pad
            { type: 'platform', position: { x: 0, y: -0.5, z: -74 }, size: { width: 14, height: 1, depth: 22 }, color: 0x6366f1 },
            // Final straight
            { type: 'platform', position: { x: 0, y: -0.5, z: -100 }, size: { width: 14, height: 1, depth: 26 }, color: 0x22c55e }
        ],

        obstacles: [
            { type: 'spinningBar', position: { x: 0, y: 1, z: -16 }, size: { width: 12, height: 1.8, depth: 1 }, rotationSpeed: 2.4, color: 0xff4757 },
            { type: 'spinningBar', position: { x: 0, y: 1, z: -28 }, size: { width: 12, height: 1.8, depth: 1 }, rotationSpeed: -2.8, color: 0xff4757 },
            { type: 'pendulum', position: { x: -3, y: 4, z: -38 }, size: { radius: 1.3, height: 5 }, swingSpeed: 2.6, swingAngle: 0.8, color: 0xff6b9d },
            { type: 'pendulum', position: { x: 3, y: 4, z: -46 }, size: { radius: 1.3, height: 5 }, swingSpeed: 3, swingAngle: 0.8, color: 0xff6b9d },
            { type: 'spinningBar', position: { x: 0, y: 1, z: -54 }, size: { width: 12, height: 1.8, depth: 1 }, rotationSpeed: 3.1, color: 0xff4757 },

            { type: 'pusher', position: { x: -9, y: 1, z: -70 }, size: { width: 4, height: 3, depth: 4 }, pushDistance: 8, pushSpeed: 3.5, pushDelay: 0, color: 0xffd93d },
            { type: 'pusher', position: { x: 9, y: 1, z: -80 }, size: { width: 4, height: 3, depth: 4 }, pushDistance: -8, pushSpeed: 3.5, pushDelay: 0.4, color: 0xffd93d },

            { type: 'barrier', position: { x: 0, y: 0.8, z: -94 }, size: { width: 13, height: 1.5, depth: 0.5 }, color: 0xff6b6b },
            { type: 'barrier', position: { x: 0, y: 0.8, z: -104 }, size: { width: 13, height: 1.5, depth: 0.5 }, color: 0xff6b6b }
        ],

        decorations: [
            { type: 'flag', position: { x: -7, y: 0, z: 5 }, color: 0x22c55e },
            { type: 'flag', position: { x: 7, y: 0, z: 5 }, color: 0x22c55e },
            { type: 'flag', position: { x: -7, y: 0, z: -112 }, color: 0xffd700 },
            { type: 'flag', position: { x: 7, y: 0, z: -112 }, color: 0xffd700 },
            { type: 'banner', position: { x: 0, y: 6, z: -112 }, text: 'FINISH', color: 0xffd700 }
        ],

        boundaries: [
            { position: { x: -8.5, y: 0, z: -56 }, size: { width: 1, height: 18, depth: 140 } },
            { position: { x: 8.5, y: 0, z: -56 }, size: { width: 1, height: 18, depth: 140 } }
        ],

        respawnPoints: [
            { x: 0, y: 2, z: 0 },
            { x: 0, y: 2, z: -22 },
            { x: 0, y: 2, z: -50 },
            { x: 0, y: 2, z: -74 },
            { x: 0, y: 2, z: -96 }
        ],

        killZoneY: -12,
        skyColor: 0x1e1b4b,
        fog: { color: 0x312e81, near: 40, far: 200 },
        ambientLight: { color: 0xc7d2fe, intensity: 0.7 },
        directionalLight: { color: 0xffffff, intensity: 0.9, position: { x: -40, y: 90, z: 30 } }
    }
};

// Map rotation offered in the lobby, in the order it is shown. Keys index
// MAP_DATA; `laps` is advisory copy, not engine input.
const MAP_ORDER = [
    { key: 'obstacleRush', difficulty: 'Standard', length: 'Long' },
    { key: 'slimeClimb',   difficulty: 'Tricky',   length: 'Long' },
    { key: 'hammerAlley',  difficulty: 'Brutal',   length: 'Short' }
];

// Player colors for different players
const PLAYER_COLORS = [
    { body: 0x4a9eff, name: 'Blue' },      // Player 1 - Blue
    { body: 0xff6b6b, name: 'Red' },       // Player 2 - Red
    { body: 0x4ecdc4, name: 'Teal' },      // Player 3 - Teal
    { body: 0xffd93d, name: 'Yellow' },    // Player 4 - Yellow
    { body: 0xff6b9d, name: 'Pink' },      // Player 5 - Pink
    { body: 0x9b59b6, name: 'Purple' },    // Player 6 - Purple
    { body: 0x2ecc71, name: 'Green' },     // Player 7 - Green
    { body: 0xe67e22, name: 'Orange' }     // Player 8 - Orange
];

// Player faces (simple emoji-style)
const PLAYER_FACES = [
    { eyes: '•_•', expression: 'normal' },
    { eyes: '>_<', expression: 'determined' },
    { eyes: 'O_O', expression: 'surprised' },
    { eyes: '^_^', expression: 'happy' },
    { eyes: '-_-', expression: 'chill' },
    { eyes: '@_@', expression: 'dizzy' },
    { eyes: '*_*', expression: 'starry' },
    { eyes: '•‿•', expression: 'smile' }
];

// Export for use in game
if (typeof window !== 'undefined') {
    window.MAP_DATA = MAP_DATA;
    window.MAP_ORDER = MAP_ORDER;
    window.PLAYER_COLORS = PLAYER_COLORS;
    window.PLAYER_FACES = PLAYER_FACES;
}
