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
    }
};

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
    window.PLAYER_COLORS = PLAYER_COLORS;
    window.PLAYER_FACES = PLAYER_FACES;
}
