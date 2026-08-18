/**
 * BlockParty — prebuilt maps
 *
 * Ten scenes a host can drop into the world: somewhere to play in, and a
 * starting point to build on rather than a blank floor.
 *
 * Maps are written as code, not data. A village is "put a house here, scatter
 * forty trees, run a road across" — a few lines each — where the same scene as
 * a block list would be tens of thousands of numbers. The builder below is that
 * vocabulary; each map is then short enough to read and change.
 *
 * Everything is generated from a fixed seed, so a map is the same scene every
 * time it is loaded. Only the host generates it; the result travels to the room
 * as an ordinary (chunked) world snapshot.
 */
(function () {
    'use strict';

    // palette indexes, by name — same order as PALETTE in blockparty.js
    const C = {
        red: 0, orange: 1, yellow: 2, green: 3, cyan: 4, blue: 5,
        violet: 6, pink: 7, white: 8, slate: 9, brown: 10, black: 11
    };
    // shape indexes — same order as SHAPES in blockparty.js
    const S = { cube: 0, slab: 1, pillar: 2, sphere: 3, cone: 4, pyramid: 5 };

    const HALF = 80;                 // must match the world
    const clampY = y => Math.max(0, Math.min(40, y));

    // A small deterministic PRNG, so a map looks the same every time.
    function rng(seed) {
        let a = seed >>> 0;
        return function () {
            a += 0x6D2B79F5;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function builder(seed) {
        const cells = new Map();     // "x,y,z" -> [x, y, z, colour, shape]
        const pieces = [];
        const rand = rng(seed);
        let pieceNo = 0;

        const api = {
            rand,
            rnd: (n) => Math.floor(rand() * n),
            between: (a, b) => a + Math.floor(rand() * (b - a + 1)),
            chance: (p) => rand() < p,
            pick: (arr) => arr[Math.floor(rand() * arr.length)],

            /** One block. Out-of-world coordinates are dropped, not clamped. */
            set(x, y, z, colour, shape) {
                x = Math.round(x); y = Math.round(y); z = Math.round(z);
                if (x < -HALF || x > HALF || z < -HALF || z > HALF || y < 0 || y > 40) return api;
                cells.set(x + ',' + y + ',' + z, [x, y, z, colour, shape || 0]);
                return api;
            },

            /** A solid box, corners inclusive. */
            box(x0, y0, z0, x1, y1, z1, colour, shape) {
                for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
                    for (let y = clampY(Math.min(y0, y1)); y <= clampY(Math.max(y0, y1)); y++) {
                        for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) api.set(x, y, z, colour, shape);
                    }
                }
                return api;
            },

            /** Walls only — the four sides of a box, no floor or ceiling. */
            walls(x0, y0, z0, x1, y1, z1, colour, shape) {
                for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
                    for (let y = clampY(Math.min(y0, y1)); y <= clampY(Math.max(y0, y1)); y++) {
                        for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) {
                            const edge = x === x0 || x === x1 || z === z0 || z === z1;
                            if (edge) api.set(x, y, z, colour, shape);
                        }
                    }
                }
                return api;
            },

            /** A brick piece, w x d at its minimum corner. */
            brick(x, y, z, w, d, colour) {
                pieces.push(['map' + (++pieceNo), Math.round(x), Math.round(y), Math.round(z), w, d, colour, null]);
                return api;
            },

            // ---- scenery ------------------------------------------------

            /** Trunk plus canopy. `kind` picks a round tree or a conifer. */
            tree(x, z, h, kind) {
                h = h || 5;
                for (let y = 0; y < h; y++) api.set(x, y, z, C.brown, S.pillar);
                if (kind === 'pine') {
                    for (let i = 0; i < 3; i++) {
                        const r = 2 - i;
                        for (let dx = -r; dx <= r; dx++) {
                            for (let dz = -r; dz <= r; dz++) {
                                if (Math.abs(dx) + Math.abs(dz) <= r) api.set(x + dx, h + i, z + dz, C.green);
                            }
                        }
                    }
                    api.set(x, h + 3, z, C.green, S.cone);
                } else {
                    for (let dx = -2; dx <= 2; dx++) {
                        for (let dz = -2; dz <= 2; dz++) {
                            for (let dy = 0; dy < 2; dy++) {
                                if (Math.abs(dx) + Math.abs(dz) <= 3 - dy) {
                                    api.set(x + dx, h + dy, z + dz, C.green);
                                }
                            }
                        }
                    }
                    api.set(x, h + 2, z, C.green, S.sphere);
                }
                return api;
            },

            /**
             * A house: walls, a door, windows, and a roof that either steps up
             * to a ridge or sits flat, depending on the roof colour given.
             */
            house(x, z, w, d, h, wall, roof, opts) {
                opts = opts || {};
                api.walls(x, 0, z, x + w - 1, h - 1, z + d - 1, wall);
                // door on the south face, windows on the long sides
                const doorX = x + Math.floor(w / 2);
                api.set(doorX, 0, z + d - 1, C.brown);
                api.set(doorX, 1, z + d - 1, C.brown);
                for (let wx = x + 1; wx < x + w - 1; wx += 2) {
                    api.set(wx, 1, z, C.cyan);
                    if (wx !== doorX) api.set(wx, 1, z + d - 1, C.cyan);
                }
                // roof: each course steps in by one until it closes
                let y = h, x0 = x - 1, z0 = z - 1, x1 = x + w, z1 = z + d;
                while (x1 - x0 >= 0 && z1 - z0 >= 0 && y < 40) {
                    for (let rx = x0; rx <= x1; rx++) {
                        for (let rz = z0; rz <= z1; rz++) {
                            const edge = rx === x0 || rx === x1 || rz === z0 || rz === z1;
                            if (edge || opts.solidRoof) api.set(rx, y, rz, roof, y === h ? S.slab : 0);
                        }
                    }
                    x0++; z0++; x1--; z1--; y++;
                }
                return api;
            },

            /** A strip of road with a dashed centre line. */
            road(x0, z0, x1, z1, colour, line) {
                const horizontal = Math.abs(x1 - x0) >= Math.abs(z1 - z0);
                api.box(x0, 0, z0, x1, 0, z1, colour === undefined ? C.slate : colour, S.slab);
                if (line === false) return api;
                const midZ = Math.round((z0 + z1) / 2), midX = Math.round((x0 + x1) / 2);
                if (horizontal) {
                    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x += 4) {
                        api.set(x, 0, midZ, C.yellow, S.slab);
                        api.set(x + 1, 0, midZ, C.yellow, S.slab);
                    }
                } else {
                    for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z += 4) {
                        api.set(midX, 0, z, C.yellow, S.slab);
                        api.set(midX, 0, z + 1, C.yellow, S.slab);
                    }
                }
                return api;
            },

            /** A lamp post with a glowing head. */
            lamp(x, z, h) {
                h = h || 4;
                for (let y = 0; y < h; y++) api.set(x, y, z, C.slate, S.pillar);
                api.set(x, h, z, C.yellow, S.sphere);
                return api;
            },

            fence(x0, z0, x1, z1, colour) {
                const c = colour === undefined ? C.brown : colour;
                if (x0 === x1) for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) api.set(x0, 0, z, c, S.pillar);
                else for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) api.set(x, 0, z0, c, S.pillar);
                return api;
            },

            /** A parked car, two bricks and a cabin. */
            car(x, z, colour, facing) {
                const w = facing === 'z' ? 2 : 4, d = facing === 'z' ? 4 : 2;
                api.brick(x, 0, z, w, d, colour);
                api.brick(x + (facing === 'z' ? 0 : 1), 1, z + (facing === 'z' ? 1 : 0), facing === 'z' ? 2 : 2, 2, C.cyan);
                return api;
            },

            /**
             * Rows in the world's own format: [x, y, z, colour, owner, shape],
             * with the tail left off when there is nothing to say. Map blocks
             * have NO owner — they were not placed by anyone, so they must not
             * turn up in the player list (a shape index sitting in the owner
             * slot is exactly how "player 2" and "player 4" once appeared).
             */
            result() {
                const blocks = [];
                cells.forEach(c => {
                    const [x, y, z, colour, shape] = c;
                    if (shape) blocks.push([x, y, z, colour, null, shape]);
                    else blocks.push([x, y, z, colour]);
                });
                return { blocks, pieces };
            }
        };
        return api;
    }

    // =====================================================================
    // The maps
    // =====================================================================
    const MAPS = [
        {
            id: 'village', name: 'Village Green', emoji: '🏘️', ground: '#3f6b3a',
            desc: 'Cottages round a green, a well, hedgerows and a lane running through.',
            build(b) {
                b.road(-80, 2, 80, 4);                       // the lane
                b.box(-26, 0, -26, 26, 0, -6, C.green, S.slab);   // the green
                const spots = [[-40, 10], [-20, 14], [4, 12], [26, 16], [-46, -30], [-14, -40], [16, -36], [44, -18]];
                spots.forEach(([x, z], i) => {
                    b.house(x, z, b.between(6, 9), b.between(6, 8), b.between(3, 4),
                        b.pick([C.white, C.orange, C.yellow]), b.pick([C.red, C.brown, C.slate]));
                    b.lamp(x - 2, z + 9);
                });
                // the well on the green
                b.walls(-2, 0, -18, 1, 1, -15, C.slate);
                b.box(-2, 3, -18, 1, 3, -15, C.brown, S.slab);
                b.set(-1, 2, -17, C.slate, S.pillar); b.set(0, 2, -16, C.slate, S.pillar);
                for (let i = 0; i < 42; i++) {
                    const x = b.between(-72, 72), z = b.between(-72, 72);
                    if (Math.abs(z - 3) < 5) continue;                  // keep the lane clear
                    if (x > -28 && x < 28 && z > -28 && z < -4) continue; // and the green
                    b.tree(x, z, b.between(4, 7), b.chance(0.3) ? 'pine' : 'round');
                }
                b.fence(-26, -28, 26, -28); b.fence(-26, -4, 26, -4);
            }
        },
        {
            id: 'downtown', name: 'Downtown', emoji: '🏙️', ground: '#2b3142',
            desc: 'City blocks, crossroads, traffic and towers you can climb.',
            build(b) {
                for (const z of [-40, 0, 40]) b.road(-80, z - 2, 80, z + 2);
                for (const x of [-40, 0, 40]) b.road(x - 2, -80, x + 2, 80);
                const towers = [[-70, -70], [10, -70], [50, -30], [-30, -30],
                                [-70, 10], [10, 10], [50, 50], [-30, 50], [-70, 50], [10, 50]];
                towers.forEach(([x, z], i) => {
                    const w = b.between(10, 16), d = b.between(10, 16), h = b.between(6, 20);
                    const wall = b.pick([C.slate, C.white, C.cyan, C.blue]);
                    b.walls(x, 0, z, x + w, h, z + d, wall);
                    b.box(x, h + 1, z, x + w, h + 1, z + d, C.black, S.slab);   // roof deck
                    // window bands
                    for (let y = 2; y < h; y += 3) {
                        for (let wx = x + 1; wx < x + w; wx += 2) {
                            b.set(wx, y, z, C.cyan); b.set(wx, y, z + d, C.cyan);
                        }
                    }
                    if (b.chance(0.4)) b.set(x + Math.floor(w / 2), h + 2, z + Math.floor(d / 2), C.red, S.cone);
                });
                for (let i = 0; i < 14; i++) {
                    const onX = b.chance(0.5);
                    const lane = b.pick([-40, 0, 40]);
                    const along = b.between(-70, 70);
                    b.car(onX ? along : lane - 1, onX ? lane - 1 : along,
                        b.pick([C.red, C.yellow, C.white, C.violet]), onX ? 'x' : 'z');
                }
                for (const x of [-42, -2, 38]) for (const z of [-42, -2, 38]) b.lamp(x, z, 5);
            }
        },
        {
            id: 'park', name: 'Central Park', emoji: '🌳', ground: '#3f7a3c',
            desc: 'A lake, winding paths, benches and a bandstand under old trees.',
            build(b) {
                // lake
                for (let x = -30; x <= 10; x++) {
                    for (let z = -10; z <= 24; z++) {
                        const dx = (x + 10) / 21, dz = (z + 7) / 17;
                        if (dx * dx + dz * dz <= 1) b.set(x, 0, z, C.cyan, S.slab);
                    }
                }
                // paths
                b.road(-70, -30, 70, -28, C.orange, false);
                b.road(30, -70, 32, 70, C.orange, false);
                for (let t = 0; t < 60; t++) {
                    const x = Math.round(-60 + t * 2), z = Math.round(40 + 12 * Math.sin(t / 6));
                    b.set(x, 0, z, C.orange, S.slab); b.set(x, 0, z + 1, C.orange, S.slab);
                }
                // bandstand
                b.box(40, 0, -50, 52, 0, -38, C.white, S.slab);
                for (const [px, pz] of [[40, -50], [52, -50], [40, -38], [52, -38], [46, -50], [46, -38]]) {
                    for (let y = 1; y <= 4; y++) b.set(px, y, pz, C.white, S.pillar);
                }
                b.box(39, 5, -51, 53, 5, -37, C.red, S.slab);
                b.set(46, 6, -44, C.yellow, S.cone);
                for (let i = 0; i < 60; i++) {
                    const x = b.between(-70, 70), z = b.between(-70, 70);
                    if (x > -32 && x < 12 && z > -12 && z < 26) continue;    // not in the lake
                    b.tree(x, z, b.between(5, 8), b.chance(0.25) ? 'pine' : 'round');
                }
                for (let i = 0; i < 10; i++) {
                    const x = b.between(-60, 60);
                    b.brick(x, 0, -26, 4, 2, C.brown);
                }
            }
        },
        {
            id: 'castle', name: 'Castle Keep', emoji: '🏰', ground: '#4a5c3a',
            desc: 'Curtain walls, corner towers, a gatehouse and a moat to cross.',
            build(b) {
                // moat
                for (let x = -46; x <= 46; x++) {
                    for (let z = -46; z <= 46; z++) {
                        const onRing = Math.abs(x) > 38 || Math.abs(z) > 38;
                        if (onRing) b.set(x, 0, z, C.cyan, S.slab);
                    }
                }
                b.walls(-34, 1, -34, 34, 6, 34, C.slate);             // curtain wall
                // crenellations
                for (let x = -34; x <= 34; x += 2) { b.set(x, 7, -34, C.slate); b.set(x, 7, 34, C.slate); }
                for (let z = -34; z <= 34; z += 2) { b.set(-34, 7, z, C.slate); b.set(34, 7, z, C.slate); }
                // corner towers
                [[-34, -34], [34, -34], [-34, 34], [34, 34]].forEach(([cx, cz]) => {
                    b.walls(cx - 3, 1, cz - 3, cx + 3, 12, cz + 3, C.slate);
                    for (let x = cx - 3; x <= cx + 3; x += 2) { b.set(x, 13, cz - 3, C.slate); b.set(x, 13, cz + 3, C.slate); }
                    b.set(cx, 14, cz, C.red, S.cone);
                });
                // gatehouse, with the gate left open
                b.walls(-6, 1, 32, 6, 10, 38, C.slate);
                b.box(-2, 1, 32, 2, 4, 38, C.brown, S.cube);
                b.box(-2, 1, 33, 2, 4, 37, C.slate, S.slab);
                // keep
                b.walls(-10, 1, -12, 10, 16, 8, C.white);
                b.box(-11, 17, -13, 11, 17, 9, C.red, S.slab);
                for (let y = 3; y <= 14; y += 4) {
                    b.set(-10, y, -2, C.cyan); b.set(10, y, -2, C.cyan);
                }
                [[-10, -12], [10, -12], [-10, 8], [10, 8]].forEach(([x, z]) => b.set(x, 18, z, C.violet, S.cone));
                for (let i = 0; i < 16; i++) b.tree(b.between(-74, 74), b.between(-74, 74), b.between(4, 6), 'pine');
            }
        },
        {
            id: 'harbour', name: 'Harbour', emoji: '⚓', ground: '#3d4457',
            desc: 'Deep water, a working quay, cranes, containers and boats at their moorings.',
            build(b) {
                b.box(-62, 0, 10, 62, 0, 62, C.cyan, S.slab);          // the bay
                b.box(-62, 0, 4, 62, 1, 9, C.slate);                    // quay wall
                b.box(-62, 0, -24, 62, 0, 3, C.slate, S.slab);          // hard standing
                // container stacks
                for (let i = 0; i < 26; i++) {
                    const x = b.between(-72, 60), z = b.between(-40, 0), h = b.between(1, 3);
                    for (let y = 0; y < h; y++) b.brick(x, y, z, 2, 6, b.pick([C.red, C.orange, C.blue, C.green, C.yellow]));
                }
                // cranes
                [-50, -10, 30].forEach(cx => {
                    for (let y = 0; y <= 14; y++) b.set(cx, y, 6, C.yellow, S.pillar);
                    b.box(cx - 1, 15, 6, cx + 1, 15, 6, C.yellow);
                    b.box(cx, 15, 7, cx, 15, 22, C.yellow, S.slab);
                    for (let y = 10; y <= 15; y++) b.set(cx, y, 18, C.slate, S.pillar);
                });
                // boats
                [[-60, 30], [-20, 44], [24, 26], [56, 50]].forEach(([x, z], i) => {
                    const w = 6 + i, d = 12 + i * 2;
                    b.box(x, 0, z, x + w, 1, z + d, C.white);
                    b.box(x + 1, 2, z + 2, x + w - 1, 3, z + 5, C.red);
                    for (let y = 2; y <= 8; y++) b.set(x + Math.floor(w / 2), y, z + Math.floor(d / 2), C.brown, S.pillar);
                    b.box(x + Math.floor(w / 2), 4, z + Math.floor(d / 2) + 1, x + Math.floor(w / 2), 7, z + Math.floor(d / 2) + 4, C.white, S.slab);
                });
                // warehouses
                [[-74, -70], [-30, -74], [20, -70], [58, -66]].forEach(([x, z]) => {
                    b.walls(x, 0, z, x + 18, 6, z + 14, C.white);
                    b.box(x - 1, 7, z - 1, x + 19, 7, z + 15, C.blue, S.slab);
                });
                for (let i = 0; i < 8; i++) b.lamp(b.between(-70, 70), 2, 5);
            }
        },
        {
            id: 'farm', name: 'Farmstead', emoji: '🚜', ground: '#5c6b33',
            desc: 'A red barn, a silo, fenced fields of crops and a duck pond.',
            build(b) {
                // crop fields, each a different crop colour
                const fields = [[-70, -70, 30, 26], [-30, -70, 26, 26], [10, -74, 30, 22],
                                [-70, 20, 26, 30], [-34, 24, 30, 26], [22, 20, 28, 30]];
                fields.forEach(([x, z, w, d], i) => {
                    const crop = [C.yellow, C.orange, C.green, C.brown][i % 4];
                    for (let cx = x; cx < x + w; cx += 2) {
                        for (let cz = z; cz < z + d; cz++) b.set(cx, 0, cz, crop);
                    }
                    b.fence(x - 1, z - 1, x + w, z - 1);
                    b.fence(x - 1, z + d, x + w, z + d);
                    b.fence(x - 1, z - 1, x - 1, z + d);
                    b.fence(x + w, z - 1, x + w, z + d);
                });
                // barn
                b.walls(-10, 0, -18, 8, 8, -4, C.red);
                b.box(-4, 0, -4, 2, 5, -4, C.brown);
                for (let i = 0; i <= 5; i++) {
                    b.box(-11 + i, 9 + i, -19, 9 - i, 9 + i, -3, C.white, S.slab);
                }
                // silo
                for (let y = 0; y <= 14; y++) {
                    b.walls(12, y, -16, 18, y, -10, C.slate);
                }
                b.box(11, 15, -17, 19, 15, -9, C.slate, S.slab);
                b.set(15, 16, -13, C.slate, S.cone);
                // pond and tractor
                for (let x = 26; x <= 40; x++) for (let z = -4; z <= 8; z++) {
                    const dx = (x - 33) / 8, dz = (z - 2) / 7;
                    if (dx * dx + dz * dz <= 1) b.set(x, 0, z, C.cyan, S.slab);
                }
                b.brick(-20, 0, 4, 2, 4, C.green);
                b.brick(-20, 1, 5, 2, 2, C.green);
                b.set(-20, 0, 3, C.black, S.pillar); b.set(-19, 0, 3, C.black, S.pillar);
                for (let i = 0; i < 12; i++) b.tree(b.between(-74, 74), b.between(-74, 74), b.between(4, 6));
            }
        },
        {
            id: 'forest', name: 'Pine Forest', emoji: '🌲', ground: '#2f5c33',
            desc: 'Deep conifers, a clearing with tents and a campfire, and a log cabin.',
            build(b) {
                for (let i = 0; i < 150; i++) {
                    const x = b.between(-76, 76), z = b.between(-76, 76);
                    if (Math.abs(x) < 18 && Math.abs(z) < 18) continue;      // the clearing
                    b.tree(x, z, b.between(4, 9), 'pine');
                }
                // campfire
                for (let a = 0; a < 8; a++) {
                    const x = Math.round(4 * Math.cos(a * Math.PI / 4));
                    const z = Math.round(4 * Math.sin(a * Math.PI / 4));
                    b.set(x, 0, z, C.slate);
                }
                b.set(0, 0, 0, C.brown); b.set(0, 1, 0, C.orange, S.cone);
                b.set(1, 0, 0, C.brown, S.pillar); b.set(-1, 0, 0, C.brown, S.pillar);
                // tents
                [[-12, -8, C.red], [10, -10, C.blue], [-8, 10, C.yellow]].forEach(([x, z, col]) => {
                    for (let i = 0; i < 3; i++) {
                        b.box(x - 2 + i, i, z, x + 2 - i, i, z + 5, col, i === 0 ? 0 : S.slab);
                    }
                });
                // log cabin
                b.walls(24, 0, 22, 36, 5, 32, C.brown);
                for (let i = 0; i <= 4; i++) b.box(23 + i, 6 + i, 21, 37 - i, 6 + i, 33, C.slate, S.slab);
                b.set(30, 0, 32, C.black); b.set(30, 1, 32, C.black);
                b.set(34, 7, 26, C.slate, S.pillar); b.set(34, 8, 26, C.slate, S.pillar);
                // a track through the wood
                for (let t = 0; t < 70; t++) {
                    const z = -76 + t * 2, x = Math.round(20 * Math.sin(t / 10));
                    b.set(x, 0, z, C.brown, S.slab); b.set(x + 1, 0, z, C.brown, S.slab);
                }
            }
        },
        {
            id: 'speedway', name: 'Speedway', emoji: '🏁', ground: '#40693c',
            desc: 'A banked oval, pit boxes, a grandstand and a start-finish gantry.',
            build(b) {
                // the oval: an elliptical band of tarmac with white kerbs
                for (let x = -70; x <= 70; x++) {
                    for (let z = -50; z <= 50; z++) {
                        const r = (x / 66) * (x / 66) + (z / 46) * (z / 46);
                        if (r <= 1.0 && r >= 0.55) b.set(x, 0, z, C.black, S.slab);
                        else if ((r > 1.0 && r <= 1.06) || (r < 0.55 && r >= 0.50)) b.set(x, 0, z, C.white, S.slab);
                    }
                }
                // start/finish line and gantry
                for (let z = -50; z <= -34; z++) {
                    if (z % 2 === 0) { b.set(0, 0, z, C.white, S.slab); b.set(1, 0, z, C.black, S.slab); }
                    else { b.set(0, 0, z, C.black, S.slab); b.set(1, 0, z, C.white, S.slab); }
                }
                for (let y = 1; y <= 8; y++) { b.set(-2, y, -42, C.slate, S.pillar); b.set(4, y, -42, C.slate, S.pillar); }
                b.box(-2, 9, -42, 4, 9, -42, C.red);
                b.box(-2, 10, -42, 4, 10, -42, C.white, S.slab);
                // pit lane and boxes
                b.box(-40, 0, -30, 40, 0, -26, C.slate, S.slab);
                for (let x = -38; x <= 34; x += 8) {
                    b.walls(x, 0, -24, x + 6, 4, -18, C.white);
                    b.box(x - 1, 5, -25, x + 7, 5, -17, b.pick([C.red, C.blue, C.yellow, C.green]), S.slab);
                }
                // grandstand
                for (let i = 0; i < 6; i++) {
                    b.box(-30, i, 54 + i, 30, i, 54 + i, C.slate);
                    for (let x = -30; x <= 30; x += 3) b.set(x, i + 1, 54 + i, b.pick([C.red, C.blue, C.yellow]));
                }
                b.box(-32, 8, 52, 32, 8, 62, C.white, S.slab);
                for (const x of [-32, 0, 32]) for (let y = 1; y <= 7; y++) b.set(x, y, 62, C.slate, S.pillar);
                // cars on the grid
                for (let i = 0; i < 8; i++) {
                    b.car(-6 + (i % 2) * 6, -46 + Math.floor(i / 2) * 6, b.pick([C.red, C.yellow, C.blue, C.white]), 'z');
                }
            }
        },
        {
            id: 'moonbase', name: 'Moon Base', emoji: '🚀', ground: '#5a5f6b',
            desc: 'Domes and tunnels on grey regolith, solar arrays, a landing pad and a rocket.',
            build(b) {
                // craters
                for (let i = 0; i < 14; i++) {
                    const cx = b.between(-70, 70), cz = b.between(-70, 70), r = b.between(4, 9);
                    for (let x = cx - r; x <= cx + r; x++) {
                        for (let z = cz - r; z <= cz + r; z++) {
                            const d = Math.hypot(x - cx, z - cz);
                            if (d <= r && d >= r - 1.5) b.set(x, 0, z, C.black, S.slab);
                        }
                    }
                }
                // domes joined by tunnels
                const domes = [[-40, -20, 9], [-8, -34, 7], [16, -6, 10], [-24, 24, 8], [40, 26, 7]];
                domes.forEach(([cx, cz, r]) => {
                    for (let x = cx - r; x <= cx + r; x++) {
                        for (let z = cz - r; z <= cz + r; z++) {
                            const d = Math.hypot(x - cx, z - cz);
                            if (d <= r) b.set(x, 0, z, C.white, S.slab);
                            if (d <= r && d >= r - 1) for (let y = 1; y <= 3; y++) b.set(x, y, z, C.white);
                        }
                    }
                    for (let y = 4; y <= 4 + r - 2; y++) {
                        const rr = r - (y - 3);
                        for (let x = cx - rr; x <= cx + rr; x++) {
                            for (let z = cz - rr; z <= cz + rr; z++) {
                                if (Math.hypot(x - cx, z - cz) <= rr) b.set(x, y, z, C.cyan);
                            }
                        }
                    }
                });
                for (let i = 0; i < domes.length - 1; i++) {
                    const [x0, z0] = domes[i], [x1, z1] = domes[i + 1];
                    const steps = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0));
                    for (let t = 0; t <= steps; t++) {
                        const x = Math.round(x0 + (x1 - x0) * t / steps);
                        const z = Math.round(z0 + (z1 - z0) * t / steps);
                        b.set(x, 0, z, C.white, S.slab); b.set(x, 1, z, C.cyan, S.slab);
                    }
                }
                // solar arrays
                for (let i = 0; i < 6; i++) {
                    const x = -70 + i * 8;
                    for (let y = 1; y <= 2; y++) b.set(x, y, 60, C.slate, S.pillar);
                    b.box(x - 1, 3, 56, x + 1, 3, 64, C.blue, S.slab);
                }
                // landing pad and rocket
                for (let x = 44; x <= 68; x++) for (let z = -68; z <= -44; z++) {
                    const d = Math.hypot(x - 56, z + 56);
                    if (d <= 12) b.set(x, 0, z, C.black, S.slab);
                    if (d <= 12 && d >= 10.5) b.set(x, 0, z, C.yellow, S.slab);
                }
                for (let y = 0; y <= 18; y++) b.walls(54, y, -58, 58, y, -54, C.white);
                b.box(54, 19, -58, 58, 19, -54, C.red);
                b.set(56, 20, -56, C.red, S.cone);
                [[53, -59], [59, -59], [53, -53], [59, -53]].forEach(([x, z]) => {
                    for (let y = 0; y <= 3; y++) b.set(x, y, z, C.slate, S.pillar);
                });
            }
        },
        {
            id: 'winter', name: 'Winter Village', emoji: '❄️', ground: '#dfe8f5',
            desc: 'Snow on the roofs, a frozen pond, lit lanterns and snowmen in the square.',
            build(b) {
                b.road(-80, 1, 80, 3, C.slate, false);
                // frozen pond
                for (let x = 20; x <= 50; x++) for (let z = 18; z <= 44; z++) {
                    const dx = (x - 35) / 16, dz = (z - 31) / 14;
                    if (dx * dx + dz * dz <= 1) b.set(x, 0, z, C.cyan, S.slab);
                }
                const spots = [[-56, -30], [-30, -34], [-4, -30], [22, -36], [48, -28],
                               [-52, 18], [-26, 22], [0, 16], [-14, 46], [30, -6]];
                spots.forEach(([x, z]) => {
                    b.house(x, z, b.between(6, 9), b.between(6, 8), b.between(3, 4),
                        b.pick([C.brown, C.red, C.slate]), C.white, { solidRoof: true });
                    b.lamp(x - 2, z + 9, 4);
                    // smoke from the chimney
                    const cx = x + 2, cz = z + 2;
                    b.set(cx, 5, cz, C.slate); b.set(cx, 6, cz, C.slate);
                });
                // snowmen in the square
                [[-8, -6], [-2, -8], [4, -4]].forEach(([x, z]) => {
                    b.set(x, 0, z, C.white, S.sphere);
                    b.set(x, 1, z, C.white, S.sphere);
                    b.set(x, 2, z, C.white, S.sphere);
                    b.set(x, 3, z, C.black, S.slab);
                });
                // snow-laden pines
                for (let i = 0; i < 70; i++) {
                    const x = b.between(-76, 76), z = b.between(-76, 76);
                    if (Math.abs(z - 2) < 4) continue;
                    if (x > 18 && x < 52 && z > 16 && z < 46) continue;
                    const h = b.between(4, 8);
                    b.tree(x, z, h, 'pine');
                    b.set(x, h + 4, z, C.white, S.cone);
                }
            }
        }
    ];

    function byId(id) { return MAPS.find(m => m.id === id) || null; }

    /** Build a map into plain block and piece lists. Host-side only. */
    function generate(id) {
        const map = byId(id);
        if (!map) return null;
        const b = builder(hashSeed(id));
        map.build(b);
        const out = b.result();
        out.ground = map.ground || null;
        return out;
    }

    function hashSeed(id) {
        let h = 2166136261;
        for (let i = 0; i < id.length; i++) {
            h ^= id.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return h >>> 0;
    }

    window.BlockPartyMaps = { MAPS, C, S, byId, generate, builder };
})();
