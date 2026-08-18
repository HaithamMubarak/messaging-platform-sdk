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

            // ---- carving ------------------------------------------------
            // Interiors are made by building solid and taking material away:
            // it is how a cave is dug and how a room gets its doorway.

            /** Remove every block in a box. */
            clear(x0, y0, z0, x1, y1, z1) {
                for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
                    for (let y = Math.max(0, Math.min(y0, y1)); y <= Math.max(y0, y1); y++) {
                        for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) {
                            cells.delete(x + ',' + y + ',' + z);
                        }
                    }
                }
                return api;
            },

            /** Hollow out a rough sphere — one chamber of a cave. */
            carve(cx, cy, cz, r, jitter) {
                const j = jitter === undefined ? 0.25 : jitter;
                for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
                    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.ceil(cy + r); y++) {
                        for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++) {
                            const d = Math.hypot(x - cx, (y - cy) * 1.15, z - cz);
                            if (d <= r * (1 - j / 2 + rand() * j)) cells.delete(x + ',' + y + ',' + z);
                        }
                    }
                }
                return api;
            },

            /** Carve a passage along a path of points. */
            tunnel(points, r) {
                for (let i = 0; i < points.length - 1; i++) {
                    const [x0, y0, z0] = points[i], [x1, y1, z1] = points[i + 1];
                    const steps = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)));
                    for (let t = 0; t <= steps; t++) {
                        const f = steps ? t / steps : 0;
                        api.carve(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, z0 + (z1 - z0) * f, r, 0.2);
                    }
                }
                return api;
            },

            // ---- interiors ----------------------------------------------

            /**
             * A room you can walk into: four walls, a floor, a ceiling, and a
             * doorway two blocks high because that is what a person needs.
             * `door` is a side (n/s/e/w) or 'none'.
             */
            room(x, z, w, d, h, opts) {
                opts = opts || {};
                const wall = opts.wall === undefined ? C.white : opts.wall;
                api.walls(x, 0, z, x + w - 1, h - 1, z + d - 1, wall);
                if (opts.floor !== undefined) api.box(x, 0, z, x + w - 1, 0, z + d - 1, opts.floor, S.slab);
                if (opts.ceiling !== undefined) api.box(x - 1, h, z - 1, x + w, h, z + d, opts.ceiling, S.slab);

                const midX = x + Math.floor(w / 2), midZ = z + Math.floor(d / 2);
                const door = opts.door || 's';
                if (door !== 'none') {
                    const at = { n: [midX, z], s: [midX, z + d - 1], w: [x, midZ], e: [x + w - 1, midZ] }[door];
                    if (at) api.clear(at[0], 1, at[1], at[0], 2, at[1]);
                }
                (opts.windows || []).forEach(([wx, wz]) => {
                    api.set(x + wx, 2, z + wz, C.cyan);
                });
                return api;
            },

            /** A staircase climbing one block per step. */
            stairs(x, y, z, dir, steps, colour) {
                const dx = dir === 'x' ? 1 : 0, dz = dir === 'z' ? 1 : 0;
                for (let i = 0; i < steps; i++) {
                    api.box(x + dx * i, y, z + dz * i, x + dx * i + (dz ? 2 : 0), y + i, z + dz * i + (dx ? 2 : 0),
                        colour === undefined ? C.brown : colour);
                }
                return api;
            },

            // ---- furniture ----------------------------------------------
            bed(x, z, colour) {
                api.box(x, 0, z, x + 1, 0, z + 3, C.brown);
                api.box(x, 1, z, x + 1, 1, z + 2, colour === undefined ? C.blue : colour, S.slab);
                api.box(x, 1, z + 3, x + 1, 1, z + 3, C.white, S.slab);
                return api;
            },
            table(x, z, w, d, colour) {
                const c = colour === undefined ? C.brown : colour;
                for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) api.set(x + i, 1, z + j, c, S.slab);
                api.set(x, 0, z, c, S.pillar);
                api.set(x + w - 1, 0, z, c, S.pillar);
                api.set(x, 0, z + d - 1, c, S.pillar);
                api.set(x + w - 1, 0, z + d - 1, c, S.pillar);
                return api;
            },
            chair(x, z, colour) {
                const c = colour === undefined ? C.brown : colour;
                api.set(x, 0, z, c, S.pillar);
                api.set(x, 1, z, c, S.slab);
                return api;
            },
            sofa(x, z, len, colour) {
                const c = colour === undefined ? C.red : colour;
                api.box(x, 0, z, x + len - 1, 0, z + 1, c);
                api.box(x, 1, z, x + len - 1, 1, z, c);
                return api;
            },
            shelf(x, z, len, colour) {
                for (let i = 0; i < len; i++) {
                    api.set(x + i, 0, z, C.brown);
                    api.set(x + i, 1, z, C.brown, S.slab);
                    api.set(x + i, 2, z, api.pick([C.red, C.green, C.blue, C.yellow]), S.slab);
                }
                return api;
            },
            counter(x, z, len, dir) {
                for (let i = 0; i < len; i++) {
                    const cx = dir === 'z' ? x : x + i, cz = dir === 'z' ? z + i : z;
                    api.set(cx, 0, cz, C.white);
                    api.set(cx, 1, cz, C.slate, S.slab);
                }
                return api;
            },
            rug(x, z, w, d, colour) {
                api.box(x, 0, z, x + w - 1, 0, z + d - 1, colour === undefined ? C.red : colour, S.slab);
                return api;
            },
            /** A torch: a stub of wood with a flame on top. */
            torch(x, y, z) {
                api.set(x, y, z, C.brown, S.pillar);
                api.set(x, y + 1, z, C.orange, S.cone);
                return api;
            },
            chest(x, z) {
                api.set(x, 0, z, C.brown);
                api.set(x, 1, z, C.yellow, S.slab);
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
        },
        {
            id: 'caves', name: 'Crystal Caves', emoji: '🕳️', ground: '#4a4238',
            desc: 'A massif you can walk into: tunnels, chambers, an underground lake and crystal seams. Best explored on foot.',
            build(b) {
                // Build the mountain solid, then dig it out — the same way you
                // would if it were real.
                const peak = (cx, cz, r, h) => {
                    for (let y = 0; y <= h; y++) {
                        const rr = r * (1 - y / (h + 2));
                        for (let x = Math.floor(cx - rr); x <= Math.ceil(cx + rr); x++) {
                            for (let z = Math.floor(cz - rr); z <= Math.ceil(cz + rr); z++) {
                                if (Math.hypot(x - cx, z - cz) <= rr) {
                                    b.set(x, y, z, y > h - 3 ? C.white : (b.chance(0.12) ? C.black : C.slate));
                                }
                            }
                        }
                    }
                };
                peak(-18, -10, 34, 22);
                peak(20, 14, 28, 17);
                peak(2, 34, 20, 12);

                // The way in, at ground level, lit so it is findable.
                b.tunnel([[-18, 2, 22], [-18, 3, 8], [-14, 4, -4], [-18, 5, -14]], 2.6);
                b.torch(-21, 1, 20); b.torch(-15, 1, 20);
                b.torch(-21, 1, 10); b.torch(-15, 1, 8);

                // The great chamber, with a lake in the floor of it.
                b.carve(-18, 8, -14, 10, 0.3);
                b.box(-25, 0, -21, -11, 0, -7, C.cyan, S.slab);
                for (let i = 0; i < 14; i++) {
                    const x = b.between(-25, -11), z = b.between(-21, -7);
                    b.set(x, 1, z, C.cyan, S.cone);           // stalagmites in the shallows
                }
                // crystals in the walls of it
                for (let i = 0; i < 26; i++) {
                    const a = b.rand() * Math.PI * 2, r = 8 + b.rand() * 2;
                    const x = Math.round(-18 + Math.cos(a) * r), z = Math.round(-14 + Math.sin(a) * r);
                    const y = 2 + b.rnd(9);
                    b.set(x, y, z, b.pick([C.violet, C.cyan, C.pink]), S.cone);
                }

                // Deeper: a passage to a second chamber, and a shaft to daylight.
                b.tunnel([[-18, 8, -14], [-2, 7, -10], [12, 8, 2], [20, 9, 14]], 2.4);
                b.carve(20, 9, 14, 8, 0.3);
                for (let i = 0; i < 10; i++) {
                    b.set(b.between(14, 26), 2, b.between(8, 20), b.pick([C.violet, C.cyan]), S.cone);
                }
                b.tunnel([[20, 14, 14], [20, 20, 14]], 1.8);   // the shaft
                b.tunnel([[-2, 7, -10], [2, 6, 24], [2, 6, 34]], 2.2);
                b.carve(2, 6, 34, 7, 0.3);
                b.torch(-4, 6, -10); b.torch(10, 7, 0); b.torch(18, 8, 12); b.torch(2, 5, 30);

                // a mining camp outside the mouth
                b.room(-26, 26, 7, 6, 4, { wall: C.brown, floor: C.slate, door: 'n' });
                b.chest(-24, 29); b.chest(-22, 29);
                b.table(-24, 27, 2, 2);
                for (let i = 0; i < 20; i++) b.tree(b.between(-70, 70), b.between(40, 74), b.between(4, 7), 'pine');
            }
        },
        {
            id: 'house', name: 'Furnished House', emoji: '🏡', ground: '#4f7a45',
            desc: 'A home you can actually walk through: kitchen, living room, stairs, two bedrooms and a bathroom.',
            build(b) {
                const X = -12, Z = -10, W = 24, D = 20, H = 4;

                // ground floor shell, with a door and windows
                b.box(X, 0, Z, X + W - 1, 0, Z + D - 1, C.brown, S.slab);
                b.walls(X, 1, Z, X + W - 1, H, Z + D - 1, C.white);
                b.clear(X + 11, 1, Z + D - 1, X + 12, 2, Z + D - 1);       // front door
                [[4, 0], [8, 0], [16, 0], [20, 0]].forEach(([wx, wz]) => {
                    b.box(X + wx, 2, Z + wz, X + wx + 1, 3, Z + wz, C.cyan);
                });
                [[0, 5], [0, 12], [W - 1, 5], [W - 1, 12]].forEach(([wx, wz]) => {
                    b.box(X + wx, 2, Z + wz, X + wx, 3, Z + wz + 1, C.cyan);
                });

                // internal walls: kitchen to the west, living room to the east
                b.box(X + 10, 1, Z, X + 10, H, Z + 13, C.white);
                b.clear(X + 10, 1, Z + 8, X + 10, 2, Z + 9);                // doorway

                // kitchen
                b.counter(X + 1, Z + 1, 8, 'x');
                b.counter(X + 1, Z + 2, 6, 'z');
                b.set(X + 6, 1, Z + 1, C.black);                            // stove
                b.table(X + 4, Z + 9, 3, 2, C.brown);
                b.chair(X + 3, Z + 9); b.chair(X + 8, Z + 10);

                // living room
                b.rug(X + 13, Z + 6, 7, 5, C.red);
                b.sofa(X + 13, Z + 4, 5, C.blue);
                b.table(X + 15, Z + 8, 3, 2);
                b.shelf(X + 22, Z + 3, 5);
                b.box(X + 21, 1, Z + 14, X + 23, 3, Z + 15, C.slate);       // fireplace
                b.set(X + 22, 1, Z + 14, C.orange, S.cone);

                // stairs up, and the hole in the ceiling they climb through
                b.stairs(X + 11, 1, Z + 14, 'x', 4, C.brown);
                b.box(X - 1, H + 1, Z - 1, X + W, H + 1, Z + D, C.brown, S.slab);   // first floor
                b.clear(X + 11, H + 1, Z + 14, X + 14, H + 1, Z + 17);

                // upstairs: two bedrooms and a bathroom off a landing
                const U = H + 2;
                b.walls(X, U, Z, X + W - 1, U + 3, Z + D - 1, C.white);
                b.box(X + 9, U, Z, X + 9, U + 3, Z + 12, C.white);
                b.clear(X + 9, U, Z + 6, X + 9, U + 1, Z + 7);
                b.box(X + 9, U, Z + 12, X + W - 1, U + 3, Z + 12, C.white);
                b.clear(X + 16, U, Z + 12, X + 17, U + 1, Z + 12);
                b.box(X - 1, U + 4, Z - 1, X + W, U + 4, Z + D, C.red, S.slab);     // roof

                b.bed(X + 2, Z + 2, C.blue);   b.shelf(X + 6, Z + 1, 3);
                b.bed(X + 12, Z + 2, C.green); b.table(X + 16, Z + 3, 2, 2);
                b.box(X + 12, U, Z + 15, X + 13, U + 1, Z + 16, C.white);           // bath
                b.set(X + 16, U, Z + 15, C.white, S.pillar);                        // basin
                [[4, 4], [14, 4], [14, 16]].forEach(([wx, wz]) => b.set(X + wx, U + 2, Z + wz, C.yellow, S.sphere));

                // outside
                b.road(X + 11, Z + D, X + 12, Z + D + 12, C.slate, false);
                b.fence(X - 4, Z - 4, X + W + 3, Z - 4);
                b.fence(X - 4, Z + D + 12, X + W + 3, Z + D + 12);
                b.fence(X - 4, Z - 4, X - 4, Z + D + 12);
                b.fence(X + W + 3, Z - 4, X + W + 3, Z + D + 12);
                for (let i = 0; i < 10; i++) b.tree(b.between(-60, 60), b.between(-60, 60), b.between(4, 7));
                b.lamp(X + 14, Z + D + 6, 4);
            }
        },
        {
            id: 'dungeon', name: 'Torchlit Dungeon', emoji: '🗝️', ground: '#33313c',
            desc: 'Corridors, cells and a throne room under one roof — torches on the walls and chests worth finding.',
            build(b) {
                const H = 5;
                // one solid slab of stone, then the rooms and corridors cut out
                b.box(-46, 0, -34, 46, H + 1, 34, C.slate);

                const hall = (x, z, w, d) => {
                    b.clear(x, 1, z, x + w - 1, H - 1, z + d - 1);
                    b.box(x, 0, z, x + w - 1, 0, z + d - 1, C.black, S.slab);
                };
                // four chambers and a great hall between them
                hall(-42, -30, 16, 14);
                hall(-42, 8, 16, 20);
                hall(26, -30, 16, 14);
                hall(26, 10, 16, 18);
                hall(-12, -12, 24, 24);

                // corridors joining them
                b.clear(-26, 1, -25, -12, 3, -22);
                b.clear(-26, 1, 14, -12, 3, 17);
                b.clear(12, 1, -25, 26, 3, -22);
                b.clear(12, 1, 14, 26, 3, 17);
                b.clear(-2, 1, -34, 1, 3, -12);        // the way in from the north

                // torches down every corridor and around the hall
                for (let x = -40; x <= 40; x += 8) { b.torch(x, 2, -13); b.torch(x, 2, 11); }
                for (let z = -24; z <= 16; z += 8) { b.torch(-11, 2, z); b.torch(11, 2, z); }

                // the throne
                b.box(-4, 1, 6, 3, 1, 10, C.violet, S.slab);
                b.box(-2, 2, 8, 1, 4, 9, C.yellow);
                b.set(-1, 5, 8, C.yellow, S.cone); b.set(0, 5, 8, C.yellow, S.cone);
                for (const px of [-6, 5]) for (const pz of [4, 12]) {
                    for (let y = 1; y <= H - 1; y++) b.set(px, y, pz, C.white, S.pillar);
                }

                // cells, chests and a little water
                [[-40, -28], [-40, 10], [28, -28], [28, 12]].forEach(([x, z], i) => {
                    b.chest(x + 2, z + 2); b.chest(x + 4, z + 2);
                    if (i % 2) b.box(x + 6, 0, z + 6, x + 10, 0, z + 9, C.cyan, S.slab);
                    b.torch(x + 1, 2, z + 1);
                });
                // and a way back to daylight
                b.clear(-2, 1, -34, 1, 3, -30);
                b.torch(-3, 2, -32); b.torch(2, 2, -32);
            }
        },
        {
            id: 'apartments', name: 'Apartment Block', emoji: '🏢', ground: '#3a3f4d',
            desc: 'Four floors of flats around a stairwell, each one furnished, with balconies over the street.',
            build(b) {
                const X = -20, Z = -16, W = 40, D = 28, FLOOR = 5, FLOORS = 4;

                for (let f = 0; f < FLOORS; f++) {
                    const y = f * FLOOR;
                    b.box(X, y, Z, X + W - 1, y, Z + D - 1, C.slate, S.slab);      // slab
                    b.walls(X, y + 1, Z, X + W - 1, y + FLOOR - 1, Z + D - 1, f % 2 ? C.white : C.orange);

                    // windows along the long faces
                    for (let wx = X + 3; wx < X + W - 3; wx += 5) {
                        b.box(wx, y + 2, Z, wx + 1, y + 3, Z, C.cyan);
                        b.box(wx, y + 2, Z + D - 1, wx + 1, y + 3, Z + D - 1, C.cyan);
                    }
                    // the stairwell, and the hole each floor leaves for it
                    b.box(X + 17, y + 1, Z + 11, X + 17, y + FLOOR - 1, Z + 17, C.white);
                    b.box(X + 23, y + 1, Z + 11, X + 23, y + FLOOR - 1, Z + 17, C.white);
                    b.clear(X + 18, y, Z + 12, X + 22, y, Z + 16);
                    b.stairs(X + 18, y + 1, Z + 12, 'z', 4, C.slate);

                    // two flats a floor, each with a bed, a sofa and a kitchen
                    [[X + 2, Z + 3], [X + 26, Z + 3]].forEach(([fx, fz], i) => {
                        b.box(fx + 12, y + 1, fz, fx + 12, y + FLOOR - 1, fz + 20, C.white);
                        b.clear(fx + 12, y + 1, fz + 9, fx + 12, y + 2, fz + 10);
                        b.bed(fx + 1, fz + 1, i ? C.green : C.blue);
                        b.sofa(fx + 6, fz + 4, 4, i ? C.violet : C.red);
                        b.table(fx + 7, fz + 9, 2, 2);
                        b.counter(fx + 1, fz + 14, 6, 'x');
                        b.rug(fx + 5, fz + 12, 4, 3, C.yellow);
                        b.set(fx + 3, y + FLOOR - 2, fz + 8, C.yellow, S.sphere);
                    });

                    // balconies
                    if (f > 0) {
                        b.box(X + 4, y, Z + D, X + 12, y, Z + D + 2, C.slate, S.slab);
                        b.walls(X + 4, y + 1, Z + D, X + 12, y + 1, Z + D + 2, C.slate);
                        b.box(X + 27, y, Z + D, X + 35, y, Z + D + 2, C.slate, S.slab);
                        b.walls(X + 27, y + 1, Z + D, X + 35, y + 1, Z + D + 2, C.slate);
                    }
                }
                // roof, entrance and street
                b.box(X - 1, FLOORS * FLOOR, Z - 1, X + W, FLOORS * FLOOR, Z + D, C.black, S.slab);
                b.clear(X + 19, 1, Z + D - 1, X + 21, 2, Z + D - 1);
                b.road(-70, Z + D + 6, 70, Z + D + 10);
                for (let x = -60; x <= 60; x += 20) b.lamp(x, Z + D + 4, 5);
                for (let i = 0; i < 8; i++) b.tree(b.between(-70, 70), b.between(Z + D + 14, 70), b.between(4, 6));
            }
        },
        {
            id: 'oldtown', name: 'Old Town Street', emoji: '🏬', ground: '#4a4a52',
            desc: 'A parade of shops you can walk into — a bakery, a bookshop, a café with tables on the cobbles.',
            build(b) {
                b.road(-72, -3, 72, 3, C.slate, false);
                for (let x = -72; x <= 72; x += 2) { b.set(x, 0, -4, C.white, S.slab); b.set(x, 0, 4, C.white, S.slab); }

                const shop = (x, z, w, d, wall, awning, name) => {
                    b.box(x, 0, z, x + w - 1, 0, z + d - 1, C.brown, S.slab);
                    b.walls(x, 1, z, x + w - 1, 5, z + d - 1, wall);
                    // shopfront: a door and a big window onto the street
                    const front = z < 0 ? z + d - 1 : z;
                    b.clear(x + 2, 1, front, x + 3, 2, front);
                    b.box(x + 5, 2, front, x + w - 2, 3, front, C.cyan);
                    b.box(x - 1, 6, z - 1, x + w, 6, z + d, awning, S.slab);
                    // the awning over the pavement
                    const out = z < 0 ? front + 1 : front - 1;
                    b.box(x, 4, out, x + w - 1, 4, out, awning, S.slab);
                    return { front, name };
                };

                const bakery = shop(-64, 6, 14, 12, C.orange, C.red);
                b.counter(-62, 10, 8, 'x');
                b.shelf(-62, 16, 6);
                b.table(-56, 10, 2, 2);

                const books = shop(-44, 6, 14, 12, C.white, C.blue);
                b.shelf(-42, 16, 10); b.shelf(-42, 12, 10);
                b.table(-36, 9, 2, 2); b.chair(-34, 9);

                const cafe = shop(-20, 6, 16, 12, C.yellow, C.green);
                b.counter(-18, 16, 10, 'x');
                for (const [tx, tz] of [[-16, 9], [-10, 9], [-16, 12], [-10, 12]]) {
                    b.table(tx, tz, 2, 2); b.chair(tx - 1, tz); b.chair(tx + 2, tz + 1);
                }
                // pavement tables outside the café
                for (const tx of [-18, -12, -6]) { b.table(tx, 0, 2, 2); b.chair(tx - 1, 0); b.chair(tx + 2, 1); }

                const grocer = shop(6, 6, 14, 12, C.green, C.orange);
                b.shelf(8, 16, 10);
                for (let i = 0; i < 8; i++) b.set(10 + i, 1, 10, b.pick([C.red, C.orange, C.yellow, C.green]));

                const inn = shop(28, 6, 18, 14, C.brown, C.violet);
                b.counter(30, 18, 12, 'x');
                for (const [tx, tz] of [[32, 10], [38, 10], [32, 14], [38, 14]]) { b.table(tx, tz, 2, 2); b.chair(tx - 1, tz); }
                for (let y = 1; y <= 5; y += 2) b.torch(29, y, 9);

                // houses on the other side of the street
                for (let i = 0; i < 5; i++) {
                    const x = -60 + i * 26;
                    b.house(x, -22, 12, 10, 4, b.pick([C.white, C.orange, C.yellow]), b.pick([C.red, C.brown]));
                }
                for (let x = -68; x <= 68; x += 12) b.lamp(x, -6, 5);
                for (let i = 0; i < 14; i++) b.tree(b.between(-70, 70), b.between(30, 70), b.between(4, 7));
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
