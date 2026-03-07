/**
 * Maps.js
 * Arena maps for different game modes
 * Each mode now has multiple map variations!
 */

const MAPS = {
    // FIGHT MODE MAPS (5 variations)
    fightMaps: [
        // MAP 1: Battle Colosseum (Original)
        {
            id: 'fight_colosseum',
            name: 'Battle Colosseum',
            type: 'circular',
            description: 'Ancient arena with multiple levels and hazards',
            difficulty: 'Medium',
            spawnPoints: [
                { x: 8, y: 2, z: 0 },
                { x: -8, y: 2, z: 0 },
                { x: 0, y: 2, z: 8 },
                { x: 0, y: 2, z: -8 },
                { x: 6, y: 2, z: 6 },
                { x: -6, y: 2, z: -6 },
                { x: 6, y: 2, z: -6 },
                { x: -6, y: 2, z: 6 }
            ],
            platform: {
                radius: 18,
                height: 1,
                segments: 32,
                color: 0x8B7355
            },
            outerRing: {
                radius: 19.5,
                height: 0.5,
                thickness: 0.8,
                color: 0xD4AF37
            },
            elevatedPlatforms: [
                { x: 0, y: 2, z: 0, radius: 3, height: 0.3, color: 0xD4AF37 },
                { x: 10, y: 1.5, z: 10, radius: 2, height: 0.3, color: 0x8B7355 },
                { x: -10, y: 1.5, z: 10, radius: 2, height: 0.3, color: 0x8B7355 },
                { x: 10, y: 1.5, z: -10, radius: 2, height: 0.3, color: 0x8B7355 },
                { x: -10, y: 1.5, z: -10, radius: 2, height: 0.3, color: 0x8B7355 }
            ],
            jumpPads: [
                { x: 5, y: 0.2, z: 0, radius: 1, force: 3, color: 0x00FF00 },
                { x: -5, y: 0.2, z: 0, radius: 1, force: 3, color: 0x00FF00 },
                { x: 0, y: 0.2, z: 5, radius: 1, force: 3, color: 0x00FF00 },
                { x: 0, y: 0.2, z: -5, radius: 1, force: 3, color: 0x00FF00 }
            ],
            hazards: [
                { type: 'spinner', x: 0, y: 1, z: 0, radius: 8, speed: 0.5, height: 2 }
            ],
            pillars: [
                { x: 15, y: 2.5, z: 0, radius: 0.8, height: 5, color: 0x8B7355 },
                { x: -15, y: 2.5, z: 0, radius: 0.8, height: 5, color: 0x8B7355 },
                { x: 0, y: 2.5, z: 15, radius: 0.8, height: 5, color: 0x8B7355 },
                { x: 0, y: 2.5, z: -15, radius: 0.8, height: 5, color: 0x8B7355 },
                { x: 10.6, y: 2.5, z: 10.6, radius: 0.8, height: 5, color: 0x8B7355 },
                { x: -10.6, y: 2.5, z: 10.6, radius: 0.8, height: 5, color: 0x8B7355 },
                { x: 10.6, y: 2.5, z: -10.6, radius: 0.8, height: 5, color: 0x8B7355 },
                { x: -10.6, y: 2.5, z: -10.6, radius: 0.8, height: 5, color: 0x8B7355 }
            ],
            lighting: {
                ambient: 0x404040,
                directional: { color: 0xFFFFFF, intensity: 1, position: { x: 10, y: 20, z: 10 } },
                spotlights: [
                    { x: 0, y: 15, z: 0, target: { x: 0, y: 0, z: 0 }, color: 0xFFFFFF, intensity: 2 }
                ]
            }
        },

        // MAP 2: Sky Fortress (NEW!)
        {
            id: 'fight_sky_fortress',
            name: 'Sky Fortress',
            type: 'circular',
            description: 'Floating castle high in the clouds with dangerous edges',
            difficulty: 'Hard',
            spawnPoints: [
                { x: 7, y: 3, z: 0 },
                { x: -7, y: 3, z: 0 },
                { x: 0, y: 3, z: 7 },
                { x: 0, y: 3, z: -7 },
                { x: 5, y: 3, z: 5 },
                { x: -5, y: 3, z: -5 },
                { x: 5, y: 3, z: -5 },
                { x: -5, y: 3, z: 5 }
            ],
            platform: {
                radius: 16,
                height: 1,
                segments: 32,
                color: 0xE6E6FA // Lavender stone
            },
            outerRing: {
                radius: 17.5,
                height: 0.3,
                thickness: 0.5,
                color: 0x4169E1 // Royal blue magic barrier
            },
            // Multiple floating platforms at different heights!
            elevatedPlatforms: [
                // Center tower (highest)
                { x: 0, y: 6, z: 0, radius: 2.5, height: 0.4, color: 0xFFD700 },
                // Mid-level ring of platforms
                { x: 8, y: 4, z: 0, radius: 2, height: 0.3, color: 0x87CEEB },
                { x: -8, y: 4, z: 0, radius: 2, height: 0.3, color: 0x87CEEB },
                { x: 0, y: 4, z: 8, radius: 2, height: 0.3, color: 0x87CEEB },
                { x: 0, y: 4, z: -8, radius: 2, height: 0.3, color: 0x87CEEB },
                // Low platforms (stepping stones)
                { x: 4, y: 2, z: 4, radius: 1.5, height: 0.2, color: 0xE6E6FA },
                { x: -4, y: 2, z: 4, radius: 1.5, height: 0.2, color: 0xE6E6FA },
                { x: 4, y: 2, z: -4, radius: 1.5, height: 0.2, color: 0xE6E6FA },
                { x: -4, y: 2, z: -4, radius: 1.5, height: 0.2, color: 0xE6E6FA }
            ],
            // Super jump pads to reach high platforms!
            jumpPads: [
                { x: 0, y: 0.2, z: 0, radius: 1.5, force: 5, color: 0x00FFFF }, // Center mega jump
                { x: 6, y: 0.2, z: 0, radius: 1, force: 4, color: 0x00FF00 },
                { x: -6, y: 0.2, z: 0, radius: 1, force: 4, color: 0x00FF00 },
                { x: 0, y: 0.2, z: 6, radius: 1, force: 4, color: 0x00FF00 },
                { x: 0, y: 0.2, z: -6, radius: 1, force: 4, color: 0x00FF00 }
            ],
            // Castle towers (decorative + collision)
            pillars: [
                { x: 12, y: 4, z: 0, radius: 1, height: 8, color: 0xC0C0C0 },
                { x: -12, y: 4, z: 0, radius: 1, height: 8, color: 0xC0C0C0 },
                { x: 0, y: 4, z: 12, radius: 1, height: 8, color: 0xC0C0C0 },
                { x: 0, y: 4, z: -12, radius: 1, height: 8, color: 0xC0C0C0 }
            ],
            // Wind zones (push players)
            windZones: [
                { x: 10, y: 1, z: 0, radius: 3, force: { x: 5, y: 0, z: 0 }, color: 0x87CEEB },
                { x: -10, y: 1, z: 0, radius: 3, force: { x: -5, y: 0, z: 0 }, color: 0x87CEEB }
            ],
            lighting: {
                ambient: 0x606060,
                directional: { color: 0xFFFFFF, intensity: 1.2, position: { x: 0, y: 30, z: 0 } },
                spotlights: [
                    { x: 0, y: 20, z: 0, target: { x: 0, y: 6, z: 0 }, color: 0xFFD700, intensity: 3 }
                ]
            }
        },

        // MAP 3: Lava Pit Arena (NEW!)
        {
            id: 'fight_lava_pit',
            name: 'Lava Pit Arena',
            type: 'circular',
            description: 'Volcanic crater with rising lava and collapsing platforms',
            difficulty: 'Hard',
            spawnPoints: [
                { x: 10, y: 3, z: 0 },
                { x: -10, y: 3, z: 0 },
                { x: 0, y: 3, z: 10 },
                { x: 0, y: 3, z: -10 },
                { x: 7, y: 3, z: 7 },
                { x: -7, y: 3, z: -7 },
                { x: 7, y: 3, z: -7 },
                { x: -7, y: 3, z: 7 }
            ],
            platform: {
                radius: 20,
                height: 1,
                segments: 32,
                color: 0x8B0000 // Dark red volcanic rock
            },
            outerRing: {
                radius: 21.5,
                height: 1,
                thickness: 1,
                color: 0xFF4500 // Orange-red lava glow
            },
            // Safe platforms above lava
            elevatedPlatforms: [
                // Center safe zone
                { x: 0, y: 2, z: 0, radius: 4, height: 0.4, color: 0x2F4F4F },
                // Ring of platforms
                { x: 12, y: 2.5, z: 0, radius: 2.5, height: 0.3, color: 0x696969 },
                { x: -12, y: 2.5, z: 0, radius: 2.5, height: 0.3, color: 0x696969 },
                { x: 0, y: 2.5, z: 12, radius: 2.5, height: 0.3, color: 0x696969 },
                { x: 0, y: 2.5, z: -12, radius: 2.5, height: 0.3, color: 0x696969 },
                // Corner emergency platforms
                { x: 8, y: 4, z: 8, radius: 1.5, height: 0.2, color: 0x8B4513 },
                { x: -8, y: 4, z: -8, radius: 1.5, height: 0.2, color: 0x8B4513 },
                { x: 8, y: 4, z: -8, radius: 1.5, height: 0.2, color: 0x8B4513 },
                { x: -8, y: 4, z: 8, radius: 1.5, height: 0.2, color: 0x8B4513 }
            ],
            // Jump pads to escape lava
            jumpPads: [
                { x: 0, y: 0.2, z: 0, radius: 1.2, force: 4, color: 0xFFFF00 },
                { x: 10, y: 0.2, z: 0, radius: 1, force: 3, color: 0xFFA500 },
                { x: -10, y: 0.2, z: 0, radius: 1, force: 3, color: 0xFFA500 },
                { x: 0, y: 0.2, z: 10, radius: 1, force: 3, color: 0xFFA500 },
                { x: 0, y: 0.2, z: -10, radius: 1, force: 3, color: 0xFFA500 }
            ],
            // Lava hazard zones (damage over time)
            hazardZones: [
                { x: 0, y: -1, z: 0, radius: 25, type: 'lava', damage: 5, color: 0xFF4500 }
            ],
            // Volcanic rock pillars
            pillars: [
                { x: 16, y: 3, z: 0, radius: 1.2, height: 6, color: 0x2F4F4F },
                { x: -16, y: 3, z: 0, radius: 1.2, height: 6, color: 0x2F4F4F },
                { x: 0, y: 3, z: 16, radius: 1.2, height: 6, color: 0x2F4F4F },
                { x: 0, y: 3, z: -16, radius: 1.2, height: 6, color: 0x2F4F4F }
            ],
            lighting: {
                ambient: 0x2F1F1F,
                directional: { color: 0xFF6347, intensity: 0.8, position: { x: 0, y: 15, z: 0 } },
                spotlights: [
                    { x: 0, y: 10, z: 0, target: { x: 0, y: 0, z: 0 }, color: 0xFF4500, intensity: 2.5 }
                ]
            }
        },

        // MAP 4: Ice Palace (NEW!)
        {
            id: 'fight_ice_palace',
            name: 'Ice Palace',
            type: 'circular',
            description: 'Frozen throne room with slippery floors and ice statues',
            difficulty: 'Medium',
            spawnPoints: [
                { x: 9, y: 2, z: 0 },
                { x: -9, y: 2, z: 0 },
                { x: 0, y: 2, z: 9 },
                { x: 0, y: 2, z: -9 },
                { x: 6.5, y: 2, z: 6.5 },
                { x: -6.5, y: 2, z: -6.5 },
                { x: 6.5, y: 2, z: -6.5 },
                { x: -6.5, y: 2, z: 6.5 }
            ],
            platform: {
                radius: 19,
                height: 1,
                segments: 32,
                color: 0xE0FFFF // Light cyan ice
            },
            outerRing: {
                radius: 20.5,
                height: 0.8,
                thickness: 0.7,
                color: 0x4682B4 // Steel blue
            },
            // Ice platforms
            elevatedPlatforms: [
                // Frozen throne (center)
                { x: 0, y: 2.5, z: 0, radius: 3, height: 0.5, color: 0xADD8E6 },
                // Ice blocks
                { x: 11, y: 1.5, z: 0, radius: 2, height: 0.3, color: 0xB0E0E6 },
                { x: -11, y: 1.5, z: 0, radius: 2, height: 0.3, color: 0xB0E0E6 },
                { x: 0, y: 1.5, z: 11, radius: 2, height: 0.3, color: 0xB0E0E6 },
                { x: 0, y: 1.5, z: -11, radius: 2, height: 0.3, color: 0xB0E0E6 }
            ],
            // Jump pads (ice crystals)
            jumpPads: [
                { x: 6, y: 0.2, z: 0, radius: 1, force: 3, color: 0x00FFFF },
                { x: -6, y: 0.2, z: 0, radius: 1, force: 3, color: 0x00FFFF },
                { x: 0, y: 0.2, z: 6, radius: 1, force: 3, color: 0x00FFFF },
                { x: 0, y: 0.2, z: -6, radius: 1, force: 3, color: 0x00FFFF }
            ],
            // Slippery ice zones (reduced friction)
            slipperyZones: [
                { x: 0, y: 0.1, z: 0, radius: 15, friction: 0.1, color: 0xE0FFFF }
            ],
            // Ice statues/pillars
            pillars: [
                { x: 14, y: 3.5, z: 0, radius: 0.8, height: 7, color: 0xB0E0E6 },
                { x: -14, y: 3.5, z: 0, radius: 0.8, height: 7, color: 0xB0E0E6 },
                { x: 0, y: 3.5, z: 14, radius: 0.8, height: 7, color: 0xB0E0E6 },
                { x: 0, y: 3.5, z: -14, radius: 0.8, height: 7, color: 0xB0E0E6 },
                { x: 10, y: 3, z: 10, radius: 0.6, height: 6, color: 0xADD8E6 },
                { x: -10, y: 3, z: 10, radius: 0.6, height: 6, color: 0xADD8E6 },
                { x: 10, y: 3, z: -10, radius: 0.6, height: 6, color: 0xADD8E6 },
                { x: -10, y: 3, z: -10, radius: 0.6, height: 6, color: 0xADD8E6 }
            ],
            lighting: {
                ambient: 0x505060,
                directional: { color: 0xFFFFFF, intensity: 1.3, position: { x: 10, y: 20, z: 10 } },
                spotlights: [
                    { x: 0, y: 18, z: 0, target: { x: 0, y: 2.5, z: 0 }, color: 0x87CEEB, intensity: 2.5 }
                ]
            }
        },

        // MAP 5: Jungle Temple (NEW!)
        {
            id: 'fight_jungle_temple',
            name: 'Jungle Temple',
            type: 'circular',
            description: 'Ancient overgrown ruins with vines and hidden passages',
            difficulty: 'Easy',
            spawnPoints: [
                { x: 8, y: 2, z: 0 },
                { x: -8, y: 2, z: 0 },
                { x: 0, y: 2, z: 8 },
                { x: 0, y: 2, z: -8 },
                { x: 5.5, y: 2, z: 5.5 },
                { x: -5.5, y: 2, z: -5.5 },
                { x: 5.5, y: 2, z: -5.5 },
                { x: -5.5, y: 2, z: 5.5 }
            ],
            platform: {
                radius: 17,
                height: 1,
                segments: 32,
                color: 0x6B8E23 // Olive drab (mossy stone)
            },
            outerRing: {
                radius: 18.5,
                height: 0.6,
                thickness: 0.7,
                color: 0x228B22 // Forest green
            },
            // Temple platforms
            elevatedPlatforms: [
                // Central altar
                { x: 0, y: 1.8, z: 0, radius: 3.5, height: 0.4, color: 0x8B7355 },
                // Temple steps
                { x: 9, y: 1.2, z: 0, radius: 2, height: 0.2, color: 0x8B7355 },
                { x: -9, y: 1.2, z: 0, radius: 2, height: 0.2, color: 0x8B7355 },
                { x: 0, y: 1.2, z: 9, radius: 2, height: 0.2, color: 0x8B7355 },
                { x: 0, y: 1.2, z: -9, radius: 2, height: 0.2, color: 0x8B7355 },
                // Hidden corners
                { x: 6, y: 1.5, z: 6, radius: 1.5, height: 0.3, color: 0x556B2F },
                { x: -6, y: 1.5, z: -6, radius: 1.5, height: 0.3, color: 0x556B2F },
                { x: 6, y: 1.5, z: -6, radius: 1.5, height: 0.3, color: 0x556B2F },
                { x: -6, y: 1.5, z: 6, radius: 1.5, height: 0.3, color: 0x556B2F }
            ],
            // Vine jump pads
            jumpPads: [
                { x: 4, y: 0.2, z: 0, radius: 1, force: 10, color: 0x32CD32 },
                { x: -4, y: 0.2, z: 0, radius: 1, force: 10, color: 0x32CD32 },
                { x: 0, y: 0.2, z: 4, radius: 1, force: 10, color: 0x32CD32 },
                { x: 0, y: 0.2, z: -4, radius: 1, force: 10, color: 0x32CD32 }
            ],
            // Ancient stone pillars and statues
            pillars: [
                { x: 13, y: 2.5, z: 0, radius: 1, height: 5, color: 0x8B7355 },
                { x: -13, y: 2.5, z: 0, radius: 1, height: 5, color: 0x8B7355 },
                { x: 0, y: 2.5, z: 13, radius: 1, height: 5, color: 0x8B7355 },
                { x: 0, y: 2.5, z: -13, radius: 1, height: 5, color: 0x8B7355 },
                // Smaller ruins
                { x: 10, y: 1.5, z: 10, radius: 0.7, height: 3, color: 0x696969 },
                { x: -10, y: 1.5, z: 10, radius: 0.7, height: 3, color: 0x696969 },
                { x: 10, y: 1.5, z: -10, radius: 0.7, height: 3, color: 0x696969 },
                { x: -10, y: 1.5, z: -10, radius: 0.7, height: 3, color: 0x696969 }
            ],
            // Dense foliage areas (cover zones)
            coverZones: [
                { x: 12, y: 1, z: 0, radius: 2.5, opacity: 0.7, color: 0x228B22 },
                { x: -12, y: 1, z: 0, radius: 2.5, opacity: 0.7, color: 0x228B22 },
                { x: 0, y: 1, z: 12, radius: 2.5, opacity: 0.7, color: 0x228B22 },
                { x: 0, y: 1, z: -12, radius: 2.5, opacity: 0.7, color: 0x228B22 }
            ],
            lighting: {
                ambient: 0x3F5F3F,
                directional: { color: 0xFFFFAA, intensity: 0.9, position: { x: 15, y: 25, z: 10 } },
                spotlights: [
                    { x: 0, y: 12, z: 0, target: { x: 0, y: 0, z: 0 }, color: 0x90EE90, intensity: 1.8 }
                ]
            }
        }
    ],

    // Legacy compatibility - default to first map
    fight: null, // Will be set below

    // DODGEBALL MODE MAPS (5 variations)
    dodgeballMaps: [
        // MAP 1: Dodgeball Stadium (Original)
        {
            id: 'dodgeball_stadium',
            name: 'Dodgeball Stadium',
            type: 'rectangular',
            description: 'Professional dodgeball court with barriers and power zones',
            difficulty: 'Medium',
            spawnPoints: [
                // Team A (left side)
                { x: -12, y: 2, z: 0 },
                { x: -12, y: 2, z: 5 },
                { x: -12, y: 2, z: -5 },
                { x: -15, y: 2, z: 0 },
                // Team B (right side)
                { x: 12, y: 2, z: 0 },
                { x: 12, y: 2, z: 5 },
                { x: 12, y: 2, z: -5 },
                { x: 15, y: 2, z: 0 }
            ],
            platform: {
                width: 36,
                depth: 24,
                height: 1,
                color: 0x4169E1
            },
            centerLine: {
                x: 0, y: 0.6, z: 0,
                width: 0.3, height: 0.2, depth: 24,
                color: 0xFFFF00
            },
            walls: [
                { x: -18, y: 2, z: 0, width: 0.5, height: 4, depth: 24, color: 0x8B4513 },
                { x: 18, y: 2, z: 0, width: 0.5, height: 4, depth: 24, color: 0x8B4513 },
                { x: 0, y: 2, z: -12, width: 36, height: 4, depth: 0.5, color: 0x8B4513 },
                { x: 0, y: 2, z: 12, width: 36, height: 4, depth: 0.5, color: 0x8B4513 }
            ],
            barriers: [
                { x: -8, y: 1, z: 0, width: 1, height: 2, depth: 6, color: 0xFF6347 },
                { x: -5, y: 1, z: 8, width: 4, height: 2, depth: 1, color: 0xFF6347 },
                { x: -5, y: 1, z: -8, width: 4, height: 2, depth: 1, color: 0xFF6347 },
                { x: 8, y: 1, z: 0, width: 1, height: 2, depth: 6, color: 0x4169E1 },
                { x: 5, y: 1, z: 8, width: 4, height: 2, depth: 1, color: 0x4169E1 },
                { x: 5, y: 1, z: -8, width: 4, height: 2, depth: 1, color: 0x4169E1 }
            ],
            ballSpawners: [
                { x: 0, y: 1, z: 0, count: 3, respawnTime: 5 },
                { x: 0, y: 1, z: 8, count: 2, respawnTime: 5 },
                { x: 0, y: 1, z: -8, count: 2, respawnTime: 5 }
            ],
            powerZones: [
                { x: -8, y: 0.3, z: -5, radius: 2, type: 'speed', color: 0x00FF00 },
                { x: 8, y: 0.3, z: 5, radius: 2, type: 'speed', color: 0x00FF00 },
                { x: -8, y: 0.3, z: 5, radius: 2, type: 'strength', color: 0xFF0000 },
                { x: 8, y: 0.3, z: -5, radius: 2, type: 'strength', color: 0xFF0000 }
            ],
            stands: [
                { x: 0, y: 3, z: -16, width: 40, height: 6, depth: 4, color: 0x696969 },
                { x: 0, y: 3, z: 16, width: 40, height: 6, depth: 4, color: 0x696969 }
            ],
            lighting: {
                ambient: 0x606060,
                directional: { color: 0xFFFFFF, intensity: 1.2, position: { x: 0, y: 25, z: 0 } },
                spotlights: [
                    { x: -10, y: 20, z: 0, target: { x: -10, y: 0, z: 0 }, color: 0xFFFFFF, intensity: 1.5 },
                    { x: 10, y: 20, z: 0, target: { x: 10, y: 0, z: 0 }, color: 0xFFFFFF, intensity: 1.5 }
                ]
            }
        },

        // MAP 2: Beach Volleyball (NEW!)
        {
            id: 'dodgeball_beach',
            name: 'Beach Volleyball',
            type: 'rectangular',
            description: 'Tropical beach court with sand zones and palm trees',
            difficulty: 'Easy',
            spawnPoints: [
                { x: -14, y: 2, z: 0 },
                { x: -14, y: 2, z: 6 },
                { x: -14, y: 2, z: -6 },
                { x: -17, y: 2, z: 0 },
                { x: 14, y: 2, z: 0 },
                { x: 14, y: 2, z: 6 },
                { x: 14, y: 2, z: -6 },
                { x: 17, y: 2, z: 0 }
            ],
            platform: {
                width: 40,
                depth: 28,
                height: 1,
                color: 0xF4A460 // Sandy brown
            },
            centerLine: {
                x: 0, y: 0.6, z: 0,
                width: 0.2, height: 0.15, depth: 28,
                color: 0xFFFFFF // White rope
            },
            // Beach net poles
            walls: [
                { x: 0, y: 2, z: -14, width: 0.3, height: 4, depth: 0.3, color: 0x8B4513 },
                { x: 0, y: 2, z: 14, width: 0.3, height: 4, depth: 0.3, color: 0x8B4513 }
            ],
            // Beach umbrellas as barriers
            barriers: [
                { x: -10, y: 1, z: 0, width: 2, height: 2.5, depth: 2, color: 0xFF6347 },
                { x: -7, y: 1, z: 10, width: 2, height: 2.5, depth: 2, color: 0xFF69B4 },
                { x: -7, y: 1, z: -10, width: 2, height: 2.5, depth: 2, color: 0x00CED1 },
                { x: 10, y: 1, z: 0, width: 2, height: 2.5, depth: 2, color: 0x4169E1 },
                { x: 7, y: 1, z: 10, width: 2, height: 2.5, depth: 2, color: 0xFFD700 },
                { x: 7, y: 1, z: -10, width: 2, height: 2.5, depth: 2, color: 0x7FFF00 }
            ],
            // Sand zones (slow movement)
            sandZones: [
                { x: -12, y: 0.1, z: 0, width: 8, depth: 20, slowMultiplier: 0.7, color: 0xF4A460 },
                { x: 12, y: 0.1, z: 0, width: 8, depth: 20, slowMultiplier: 0.7, color: 0xF4A460 }
            ],
            ballSpawners: [
                { x: 0, y: 1, z: 0, count: 4, respawnTime: 4 },
                { x: 0, y: 1, z: 10, count: 2, respawnTime: 4 },
                { x: 0, y: 1, z: -10, count: 2, respawnTime: 4 }
            ],
            // Palm trees (decorative)
            decorations: [
                { type: 'palmTree', x: -18, y: 3, z: 12, height: 6, color: 0x228B22 },
                { type: 'palmTree', x: -18, y: 3, z: -12, height: 6, color: 0x228B22 },
                { type: 'palmTree', x: 18, y: 3, z: 12, height: 6, color: 0x228B22 },
                { type: 'palmTree', x: 18, y: 3, z: -12, height: 6, color: 0x228B22 }
            ],
            lighting: {
                ambient: 0x808080,
                directional: { color: 0xFFFFAA, intensity: 1.5, position: { x: 20, y: 40, z: 10 } },
                spotlights: []
            }
        },

        // MAP 3: Cyber Arena (NEW!)
        {
            id: 'dodgeball_cyber',
            name: 'Cyber Arena',
            type: 'rectangular',
            description: 'Futuristic neon court with teleporter pads and energy barriers',
            difficulty: 'Hard',
            spawnPoints: [
                { x: -13, y: 2, z: 0 },
                { x: -13, y: 2, z: 5 },
                { x: -13, y: 2, z: -5 },
                { x: -16, y: 2, z: 0 },
                { x: 13, y: 2, z: 0 },
                { x: 13, y: 2, z: 5 },
                { x: 13, y: 2, z: -5 },
                { x: 16, y: 2, z: 0 }
            ],
            platform: {
                width: 38,
                depth: 26,
                height: 1,
                color: 0x1A1A2E // Dark cyber floor
            },
            centerLine: {
                x: 0, y: 0.7, z: 0,
                width: 0.4, height: 0.3, depth: 26,
                color: 0x00FFFF // Cyan energy
            },
            walls: [
                { x: -19, y: 2, z: 0, width: 0.3, height: 4, depth: 26, color: 0xFF00FF },
                { x: 19, y: 2, z: 0, width: 0.3, height: 4, depth: 26, color: 0xFF00FF },
                { x: 0, y: 2, z: -13, width: 38, height: 4, depth: 0.3, color: 0xFF00FF },
                { x: 0, y: 2, z: 13, width: 38, height: 4, depth: 0.3, color: 0xFF00FF }
            ],
            // Energy barriers (holographic)
            barriers: [
                { x: -9, y: 1.5, z: 0, width: 0.2, height: 3, depth: 8, color: 0x00FFFF },
                { x: -6, y: 1.5, z: 9, width: 5, height: 3, depth: 0.2, color: 0xFF00FF },
                { x: -6, y: 1.5, z: -9, width: 5, height: 3, depth: 0.2, color: 0xFF00FF },
                { x: 9, y: 1.5, z: 0, width: 0.2, height: 3, depth: 8, color: 0x00FFFF },
                { x: 6, y: 1.5, z: 9, width: 5, height: 3, depth: 0.2, color: 0xFF00FF },
                { x: 6, y: 1.5, z: -9, width: 5, height: 3, depth: 0.2, color: 0xFF00FF }
            ],
            // Teleporter pads!
            teleporters: [
                { x: -10, y: 0.3, z: -8, radius: 1.5, targetX: 10, targetZ: 8, color: 0x0000FF },
                { x: 10, y: 0.3, z: 8, radius: 1.5, targetX: -10, targetZ: -8, color: 0x0000FF },
                { x: -10, y: 0.3, z: 8, radius: 1.5, targetX: 10, targetZ: -8, color: 0xFF0000 },
                { x: 10, y: 0.3, z: -8, radius: 1.5, targetX: -10, targetZ: 8, color: 0xFF0000 }
            ],
            ballSpawners: [
                { x: 0, y: 1, z: 0, count: 3, respawnTime: 5 },
                { x: 0, y: 1, z: 9, count: 2, respawnTime: 5 },
                { x: 0, y: 1, z: -9, count: 2, respawnTime: 5 }
            ],
            powerZones: [
                { x: -9, y: 0.3, z: 0, radius: 2, type: 'speed', color: 0x00FF00 },
                { x: 9, y: 0.3, z: 0, radius: 2, type: 'speed', color: 0x00FF00 }
            ],
            lighting: {
                ambient: 0x202040,
                directional: { color: 0xCCCCFF, intensity: 0.8, position: { x: 0, y: 30, z: 0 } },
                spotlights: [
                    { x: 0, y: 15, z: 0, target: { x: 0, y: 0, z: 0 }, color: 0x00FFFF, intensity: 2 }
                ]
            }
        },

        // MAP 4: Prison Yard (NEW!)
        {
            id: 'dodgeball_prison',
            name: 'Prison Yard',
            type: 'rectangular',
            description: 'Maximum security courtyard with concrete barriers',
            difficulty: 'Medium',
            spawnPoints: [
                { x: -11, y: 2, z: 0 },
                { x: -11, y: 2, z: 5 },
                { x: -11, y: 2, z: -5 },
                { x: -14, y: 2, z: 0 },
                { x: 11, y: 2, z: 0 },
                { x: 11, y: 2, z: 5 },
                { x: 11, y: 2, z: -5 },
                { x: 14, y: 2, z: 0 }
            ],
            platform: {
                width: 34,
                depth: 22,
                height: 1,
                color: 0x696969 // Gray concrete
            },
            centerLine: {
                x: 0, y: 0.6, z: 0,
                width: 0.4, height: 0.2, depth: 22,
                color: 0xFFFFFF // White paint
            },
            // Prison walls
            walls: [
                { x: -17, y: 3, z: 0, width: 0.8, height: 6, depth: 22, color: 0x4A4A4A },
                { x: 17, y: 3, z: 0, width: 0.8, height: 6, depth: 22, color: 0x4A4A4A },
                { x: 0, y: 3, z: -11, width: 34, height: 6, depth: 0.8, color: 0x4A4A4A },
                { x: 0, y: 3, z: 11, width: 34, height: 6, depth: 0.8, color: 0x4A4A4A }
            ],
            // Concrete barriers
            barriers: [
                { x: -7, y: 1.5, z: 0, width: 2, height: 3, depth: 5, color: 0x808080 },
                { x: -4, y: 1.5, z: 7, width: 3, height: 3, depth: 2, color: 0x808080 },
                { x: -4, y: 1.5, z: -7, width: 3, height: 3, depth: 2, color: 0x808080 },
                { x: 7, y: 1.5, z: 0, width: 2, height: 3, depth: 5, color: 0x808080 },
                { x: 4, y: 1.5, z: 7, width: 3, height: 3, depth: 2, color: 0x808080 },
                { x: 4, y: 1.5, z: -7, width: 3, height: 3, depth: 2, color: 0x808080 }
            ],
            ballSpawners: [
                { x: 0, y: 1, z: 0, count: 3, respawnTime: 6 },
                { x: 0, y: 1, z: 7, count: 1, respawnTime: 6 },
                { x: 0, y: 1, z: -7, count: 1, respawnTime: 6 }
            ],
            // Guard towers (decorative)
            decorations: [
                { type: 'tower', x: -15, y: 5, z: -10, width: 2, height: 10, depth: 2, color: 0x4A4A4A },
                { type: 'tower', x: -15, y: 5, z: 10, width: 2, height: 10, depth: 2, color: 0x4A4A4A },
                { type: 'tower', x: 15, y: 5, z: -10, width: 2, height: 10, depth: 2, color: 0x4A4A4A },
                { type: 'tower', x: 15, y: 5, z: 10, width: 2, height: 10, depth: 2, color: 0x4A4A4A }
            ],
            lighting: {
                ambient: 0x303030,
                directional: { color: 0xCCCCCC, intensity: 1, position: { x: 10, y: 30, z: 10 } },
                spotlights: [
                    { x: -15, y: 15, z: -10, target: { x: 0, y: 0, z: 0 }, color: 0xFFFFFF, intensity: 2 },
                    { x: 15, y: 15, z: 10, target: { x: 0, y: 0, z: 0 }, color: 0xFFFFFF, intensity: 2 }
                ]
            }
        },

        // MAP 5: School Gymnasium (NEW!)
        {
            id: 'dodgeball_school',
            name: 'School Gymnasium',
            type: 'rectangular',
            description: 'Classic indoor gym with bleachers and basketball hoops',
            difficulty: 'Easy',
            spawnPoints: [
                { x: -13, y: 2, z: 0 },
                { x: -13, y: 2, z: 6 },
                { x: -13, y: 2, z: -6 },
                { x: -16, y: 2, z: 0 },
                { x: 13, y: 2, z: 0 },
                { x: 13, y: 2, z: 6 },
                { x: 13, y: 2, z: -6 },
                { x: 16, y: 2, z: 0 }
            ],
            platform: {
                width: 38,
                depth: 26,
                height: 1,
                color: 0xDEB887 // Burlywood (wooden floor)
            },
            centerLine: {
                x: 0, y: 0.6, z: 0,
                width: 0.3, height: 0.15, depth: 26,
                color: 0xFF0000 // Red line
            },
            walls: [
                { x: -19, y: 3, z: 0, width: 0.5, height: 6, depth: 26, color: 0xF5F5DC },
                { x: 19, y: 3, z: 0, width: 0.5, height: 6, depth: 26, color: 0xF5F5DC },
                { x: 0, y: 3, z: -13, width: 38, height: 6, depth: 0.5, color: 0xF5F5DC },
                { x: 0, y: 3, z: 13, width: 38, height: 6, depth: 0.5, color: 0xF5F5DC }
            ],
            // Gym equipment as barriers
            barriers: [
                { x: -8, y: 1, z: 0, width: 1.5, height: 2, depth: 4, color: 0x4169E1 },
                { x: -5, y: 1, z: 8, width: 3, height: 2, depth: 1.5, color: 0xFF6347 },
                { x: -5, y: 1, z: -8, width: 3, height: 2, depth: 1.5, color: 0xFF6347 },
                { x: 8, y: 1, z: 0, width: 1.5, height: 2, depth: 4, color: 0x4169E1 },
                { x: 5, y: 1, z: 8, width: 3, height: 2, depth: 1.5, color: 0xFF6347 },
                { x: 5, y: 1, z: -8, width: 3, height: 2, depth: 1.5, color: 0xFF6347 }
            ],
            ballSpawners: [
                { x: 0, y: 1, z: 0, count: 4, respawnTime: 4 },
                { x: 0, y: 1, z: 8, count: 2, respawnTime: 4 },
                { x: 0, y: 1, z: -8, count: 2, respawnTime: 4 }
            ],
            // Bleachers (decorative)
            decorations: [
                { type: 'bleachers', x: 0, y: 2, z: -16, width: 35, height: 4, depth: 3, color: 0x8B4513 },
                { type: 'bleachers', x: 0, y: 2, z: 16, width: 35, height: 4, depth: 3, color: 0x8B4513 },
                { type: 'basketballHoop', x: -18, y: 4, z: 0, color: 0xFF6347 },
                { type: 'basketballHoop', x: 18, y: 4, z: 0, color: 0x4169E1 }
            ],
            lighting: {
                ambient: 0x707070,
                directional: { color: 0xFFFFFF, intensity: 1.3, position: { x: 0, y: 25, z: 0 } },
                spotlights: [
                    { x: -10, y: 18, z: 0, target: { x: -10, y: 0, z: 0 }, color: 0xFFFFFF, intensity: 1.8 },
                    { x: 10, y: 18, z: 0, target: { x: 10, y: 0, z: 0 }, color: 0xFFFFFF, intensity: 1.8 },
                    { x: 0, y: 18, z: -10, target: { x: 0, y: 0, z: -10 }, color: 0xFFFFFF, intensity: 1.8 },
                    { x: 0, y: 18, z: 10, target: { x: 0, y: 0, z: 10 }, color: 0xFFFFFF, intensity: 1.8 }
                ]
            }
        }
    ],

    // Legacy compatibility
    dodgeball: null, // Will be set below

    // RACE MODE MAPS (5 variations)
    raceMaps: [
        // MAP 1: Chaos Dash Circuit (Original)
        {
            id: 'race_chaos_circuit',
            name: 'Chaos Dash Circuit',
            type: 'linear',
            description: 'Treacherous obstacle course with jumps, spinners, and moving platforms',
            difficulty: 'Hard',
            spawnPoints: [
                { x: 0, y: 2, z: -35 },
                { x: 2, y: 2, z: -35 },
                { x: -2, y: 2, z: -35 },
                { x: 4, y: 2, z: -35 },
                { x: -4, y: 2, z: -35 },
                { x: 1, y: 2, z: -37 },
                { x: -1, y: 2, z: -37 },
                { x: 3, y: 2, z: -37 }
            ],
            startLine: { x: 0, y: 0, z: -35 },
            finishLine: { x: 0, y: 0, z: 100 },
            checkpoints: [
                { x: 0, y: 0, z: -10, name: 'Checkpoint 1' },
                { x: 0, y: 0, z: 20, name: 'Checkpoint 2' },
                { x: 0, y: 0, z: 50, name: 'Checkpoint 3' },
                { x: 0, y: 0, z: 80, name: 'Checkpoint 4' }
            ],
            segments: [
                {
                    name: 'Starting Gate',
                    type: 'platform',
                    x: 0, y: -0.5, z: -25,
                    width: 18, depth: 20, height: 1,
                    color: 0x32CD32
                },
                {
                    name: 'Spinner Section',
                    type: 'platform',
                    x: 0, y: -0.5, z: -5,
                    width: 18, depth: 20, height: 1,
                    color: 0xFF6347
                },
                {
                    name: 'Shifty Platforms',
                    type: 'platform',
                    x: 0, y: -0.5, z: 15,
                    width: 18, depth: 20, height: 1,
                    color: 0x4169E1
                },
                {
                    name: 'Sky Jumps',
                    type: 'gapPlatforms',
                    platforms: [
                        { x: 0, y: -0.5, z: 35, width: 8, depth: 8, height: 1, color: 0xFF1493 },
                        { x: 4, y: 0.5, z: 42, width: 6, depth: 6, height: 1, color: 0xFF69B4 },
                        { x: -4, y: 1.5, z: 49, width: 6, depth: 6, height: 1, color: 0xFF1493 },
                        { x: 0, y: 2.5, z: 56, width: 7, depth: 7, height: 1, color: 0xFF69B4 }
                    ]
                },
                {
                    name: 'Victory Lane',
                    type: 'platform',
                    x: 0, y: -0.5, z: 95,
                    width: 20, depth: 15, height: 1,
                    color: 0xFFD700
                }
            ],
            boostPads: [
                { x: 0, y: 0.1, z: -15, width: 6, depth: 3, speedMultiplier: 1.5, color: 0x00FFFF },
                { x: 0, y: 0.1, z: 25, width: 6, depth: 3, speedMultiplier: 1.5, color: 0x00FFFF },
                { x: 0, y: 0.1, z: 90, width: 8, depth: 4, speedMultiplier: 2.0, color: 0x00FFFF }
            ],
            hazardZones: [
                { x: 0, y: 0.1, z: 5, width: 12, depth: 4, type: 'mud', slowMultiplier: 0.5, color: 0x8B4513 }
            ],
            lighting: {
                ambient: 0x505050,
                directional: { color: 0xFFFFFF, intensity: 1, position: { x: 20, y: 30, z: 50 } }
            }
        },

        // MAP 2: Rainbow Road (NEW!)
        {
            id: 'race_rainbow_road',
            name: 'Rainbow Road',
            type: 'linear',
            description: 'Colorful sky track with no barriers - fall off and lose!',
            difficulty: 'Very Hard',
            spawnPoints: [
                { x: 0, y: 5, z: -30 },
                { x: 2, y: 5, z: -30 },
                { x: -2, y: 5, z: -30 },
                { x: 4, y: 5, z: -30 },
                { x: -4, y: 5, z: -30 },
                { x: 1, y: 5, z: -32 },
                { x: -1, y: 5, z: -32 },
                { x: 3, y: 5, z: -32 }
            ],
            startLine: { x: 0, y: 4.5, z: -30 },
            finishLine: { x: 0, y: 4.5, z: 120 },
            checkpoints: [
                { x: 0, y: 4.5, z: 0, name: 'Red Section' },
                { x: 0, y: 4.5, z: 30, name: 'Orange Section' },
                { x: 0, y: 4.5, z: 60, name: 'Yellow Section' },
                { x: 0, y: 4.5, z: 90, name: 'Green Section' }
            ],
            segments: [
                // Red section
                { type: 'platform', x: 0, y: 4, z: -15, width: 12, depth: 25, height: 1, color: 0xFF0000 },
                // Orange curved section
                { type: 'platform', x: 3, y: 4.5, z: 10, width: 10, depth: 20, height: 1, color: 0xFF8C00 },
                // Yellow section
                { type: 'platform', x: 0, y: 5, z: 35, width: 12, depth: 25, height: 1, color: 0xFFFF00 },
                // Green winding section
                { type: 'platform', x: -3, y: 5.5, z: 60, width: 10, depth: 20, height: 1, color: 0x00FF00 },
                // Blue section
                { type: 'platform', x: 0, y: 6, z: 85, width: 12, depth: 25, height: 1, color: 0x0000FF },
                // Violet finish
                { type: 'platform', x: 0, y: 6.5, z: 110, width: 14, depth: 20, height: 1, color: 0x8B00FF }
            ],
            // Rainbow boost strips!
            boostPads: [
                { x: 0, y: 4.1, z: -10, width: 8, depth: 3, speedMultiplier: 1.8, color: 0xFF00FF },
                { x: 3, y: 4.6, z: 15, width: 6, depth: 3, speedMultiplier: 1.8, color: 0xFF00FF },
                { x: 0, y: 5.1, z: 40, width: 8, depth: 3, speedMultiplier: 1.8, color: 0xFF00FF },
                { x: -3, y: 5.6, z: 65, width: 6, depth: 3, speedMultiplier: 1.8, color: 0xFF00FF },
                { x: 0, y: 6.1, z: 90, width: 8, depth: 3, speedMultiplier: 2.5, color: 0xFF00FF }
            ],
            lighting: {
                ambient: 0x808080,
                directional: { color: 0xFFFFFF, intensity: 1.5, position: { x: 0, y: 50, z: 50 } }
            }
        },

        // MAP 3: Sewer Sprint (NEW!)
        {
            id: 'race_sewer_sprint',
            name: 'Sewer Sprint',
            type: 'linear',
            description: 'Dark underground tunnel with toxic water and narrow passages',
            difficulty: 'Medium',
            spawnPoints: [
                { x: 0, y: 2, z: -25 },
                { x: 2, y: 2, z: -25 },
                { x: -2, y: 2, z: -25 },
                { x: 3, y: 2, z: -27 },
                { x: -3, y: 2, z: -27 },
                { x: 1, y: 2, z: -29 },
                { x: -1, y: 2, z: -29 },
                { x: 0, y: 2, z: -29 }
            ],
            startLine: { x: 0, y: 0, z: -25 },
            finishLine: { x: 0, y: 0, z: 80 },
            checkpoints: [
                { x: 0, y: 0, z: 0, name: 'Pipe Junction' },
                { x: 0, y: 0, z: 30, name: 'Toxic Pool' },
                { x: 0, y: 0, z: 60, name: 'Exit Tunnel' }
            ],
            segments: [
                // Wide tunnel entrance
                { type: 'platform', x: 0, y: -0.5, z: -12, width: 16, depth: 22, height: 1, color: 0x2F4F4F },
                // Narrow pipe section
                { type: 'platform', x: 0, y: -0.5, z: 10, width: 10, depth: 20, height: 1, color: 0x3A5F5F },
                // Raised walkways over toxic water
                { type: 'gapPlatforms', platforms: [
                    { x: -4, y: 0.5, z: 35, width: 6, depth: 8, height: 1, color: 0x556B2F },
                    { x: 4, y: 0.5, z: 42, width: 6, depth: 8, height: 1, color: 0x556B2F },
                    { x: -4, y: 0.5, z: 49, width: 6, depth: 8, height: 1, color: 0x556B2F },
                    { x: 0, y: 0.5, z: 56, width: 8, depth: 8, height: 1, color: 0x556B2F }
                ]},
                // Exit tunnel
                { type: 'platform', x: 0, y: -0.5, z: 72, width: 14, depth: 18, height: 1, color: 0x2F4F4F }
            ],
            // Toxic water zones (damage + slow)
            hazardZones: [
                { x: 0, y: -0.5, z: 35, width: 20, depth: 30, type: 'toxic', slowMultiplier: 0.4, damage: 3, color: 0x00FF00 }
            ],
            lighting: {
                ambient: 0x202020,
                directional: { color: 0x88FF88, intensity: 0.6, position: { x: 0, y: 20, z: 40 } }
            }
        },

        // MAP 4: Mountain Pass (NEW!)
        {
            id: 'race_mountain_pass',
            name: 'Mountain Pass',
            type: 'linear',
            description: 'Alpine trail with winding paths and falling rocks',
            difficulty: 'Hard',
            spawnPoints: [
                { x: 0, y: 2, z: -30 },
                { x: 2, y: 2, z: -30 },
                { x: -2, y: 2, z: -30 },
                { x: 4, y: 2, z: -32 },
                { x: -4, y: 2, z: -32 },
                { x: 1, y: 2, z: -34 },
                { x: -1, y: 2, z: -34 },
                { x: 3, y: 2, z: -34 }
            ],
            startLine: { x: 0, y: 0, z: -30 },
            finishLine: { x: 0, y: 15, z: 100 },
            checkpoints: [
                { x: 0, y: 3, z: 0, name: 'Lower Trail' },
                { x: 0, y: 7, z: 35, name: 'Mid Mountain' },
                { x: 0, y: 12, z: 70, name: 'Peak Approach' }
            ],
            segments: [
                // Base of mountain
                { type: 'platform', x: 0, y: -0.5, z: -15, width: 18, depth: 25, height: 1, color: 0x8B7355 },
                // First incline
                { type: 'platform', x: 0, y: 2.5, z: 8, width: 16, depth: 18, height: 1, color: 0x8B7355 },
                // Switchback left
                { type: 'platform', x: -5, y: 6.5, z: 25, width: 12, depth: 15, height: 1, color: 0xA0826D },
                // Switchback right
                { type: 'platform', x: 5, y: 10.5, z: 42, width: 12, depth: 15, height: 1, color: 0xA0826D },
                // Narrow peak path
                { type: 'platform', x: 0, y: 14.5, z: 60, width: 10, depth: 20, height: 1, color: 0xC0C0C0 },
                // Summit finish
                { type: 'platform', x: 0, y: 14.5, z: 85, width: 16, depth: 20, height: 1, color: 0xFFFFFF }
            ],
            // Ice patches on mountain
            hazardZones: [
                { x: 0, y: 6.6, z: 25, width: 8, depth: 10, type: 'ice', slowMultiplier: 0.6, color: 0x87CEEB },
                { x: 0, y: 14.6, z: 65, width: 8, depth: 12, type: 'ice', slowMultiplier: 0.6, color: 0x87CEEB }
            ],
            lighting: {
                ambient: 0x606060,
                directional: { color: 0xFFFFDD, intensity: 1.3, position: { x: 30, y: 50, z: 50 } }
            }
        },

        // MAP 5: Candy Land Dash (NEW!)
        {
            id: 'race_candy_land',
            name: 'Candy Land Dash',
            type: 'linear',
            description: 'Sweet wonderland with candy obstacles and chocolate rivers',
            difficulty: 'Easy',
            spawnPoints: [
                { x: 0, y: 2, z: -28 },
                { x: 3, y: 2, z: -28 },
                { x: -3, y: 2, z: -28 },
                { x: 5, y: 2, z: -28 },
                { x: -5, y: 2, z: -28 },
                { x: 2, y: 2, z: -30 },
                { x: -2, y: 2, z: -30 },
                { x: 4, y: 2, z: -30 }
            ],
            startLine: { x: 0, y: 0, z: -28 },
            finishLine: { x: 0, y: 0, z: 85 },
            checkpoints: [
                { x: 0, y: 0, z: 0, name: 'Lollipop Forest' },
                { x: 0, y: 0, z: 30, name: 'Gummy Bridge' },
                { x: 0, y: 0, z: 60, name: 'Candy Castle' }
            ],
            segments: [
                // Candy cane start
                { type: 'platform', x: 0, y: -0.5, z: -15, width: 20, depth: 22, height: 1, color: 0xFF69B4 },
                // Chocolate river (with bridge)
                { type: 'platform', x: 0, y: -0.5, z: 8, width: 18, depth: 20, height: 1, color: 0xD2691E },
                // Gummy bear land
                { type: 'platform', x: 0, y: -0.5, z: 30, width: 20, depth: 22, height: 1, color: 0xFF1493 },
                // Lollipop jumps
                { type: 'gapPlatforms', platforms: [
                    { x: 0, y: -0.5, z: 48, width: 8, depth: 6, height: 1, color: 0xFF0000 },
                    { x: 0, y: 0.5, z: 55, width: 8, depth: 6, height: 1, color: 0xFF8C00 },
                    { x: 0, y: -0.5, z: 62, width: 8, depth: 6, height: 1, color: 0xFFFF00 }
                ]},
                // Candy castle finish
                { type: 'platform', x: 0, y: -0.5, z: 75, width: 22, depth: 18, height: 1, color: 0xFFD700 }
            ],
            // Rainbow boost stripes
            boostPads: [
                { x: 0, y: 0.1, z: -10, width: 10, depth: 4, speedMultiplier: 1.6, color: 0xFF00FF },
                { x: 0, y: 0.1, z: 15, width: 10, depth: 4, speedMultiplier: 1.6, color: 0x00FFFF },
                { x: 0, y: 0.1, z: 35, width: 10, depth: 4, speedMultiplier: 1.6, color: 0xFF00FF },
                { x: 0, y: 0.1, z: 70, width: 12, depth: 5, speedMultiplier: 2.0, color: 0xFFD700 }
            ],
            // Sticky zones (slow)
            hazardZones: [
                { x: 0, y: 0.1, z: 23, width: 14, depth: 6, type: 'honey', slowMultiplier: 0.7, color: 0xFFB90F }
            ],
            lighting: {
                ambient: 0x909090,
                directional: { color: 0xFFFFFF, intensity: 1.4, position: { x: 10, y: 40, z: 40 } }
            }
        }
    ],

    // Legacy compatibility
    race: null // Will be set below
};

// Set default maps for backward compatibility
MAPS.fight = MAPS.fightMaps[0];
MAPS.dodgeball = MAPS.dodgeballMaps[0];
MAPS.race = MAPS.raceMaps[0];

// Helper function to get all maps for a mode
MAPS.getMapsForMode = function(mode) {
    if (mode === 'fight') return this.fightMaps;
    if (mode === 'dodgeball') return this.dodgeballMaps;
    if (mode === 'race') return this.raceMaps;
    return [this[mode]]; // Fallback
};

// Helper function to get map by ID
MAPS.getMapById = function(mapId) {
    // Search in all map arrays
    const allMaps = [
        ...(this.fightMaps || []),
        ...(this.dodgeballMaps || []),
        ...(this.raceMaps || [])
    ];
    return allMaps.find(map => map.id === mapId) || this.fight;
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MAPS };
}

