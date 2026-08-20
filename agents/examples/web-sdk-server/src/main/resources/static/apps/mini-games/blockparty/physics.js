/**
 * BlockParty — physics
 *
 * Blocks that fall, tip, tumble and land, and structures you can knock over.
 *
 * The whole design turns on one rule, because breaking it would poison the
 * thing that makes this game work over a network at all:
 *
 *   **A falling block is not a cell.**
 *
 * The voxel world is a map of independent cells with last-write-wins
 * semantics. That is what lets two people build in the same place at once, lets
 * an edit arrive twice with no ill effect, and lets a client that missed a
 * message catch up from a snapshot. Simulating gravity *inside* that map would
 * end it: every client would compute its own chain of collapses, at its own
 * frame rate, and they would disagree within seconds.
 *
 * So a block that starts moving stops being a cell and becomes a **prop** — a
 * rigid body in a physics world that sits alongside the voxel field and is not
 * part of it. Only the host simulates. Everyone else is sent transforms a few
 * times a second and interpolates, exactly the way walking avatars already
 * work. When a prop comes to rest the host snaps it to the grid and puts it
 * back into the world **through the ordinary edit path** — the same chunked,
 * policed, undoable bulk edit any other build makes.
 *
 * The result: physics is a layer over the world rather than a change to it.
 * Turn it off and every invariant is exactly as it was; the persisted world is
 * always a plain set of cells, and no saved world ever contains a half-fallen
 * anything.
 *
 * Collision is cannon.js (already carried for the other mini-games) against a
 * static shell of boxes rebuilt around wherever the props currently are — a
 * body per cell of a 161×161 world is not a thing anyone can afford, and a
 * falling brick can only ever hit what is next to it.
 */
(function () {
    'use strict';

    const GRAVITY = -26;          // heavier than Earth: toys, not masonry
    const MAX_PROPS = 60;         // the whole point is a shower, not a landslide
    const MAX_COLLAPSE = 140;     // how much unsupported structure may come down at once
    const SHELL_RADIUS = 3;       // cells of world around a prop that can be hit
    const SHELL_CAP = 2600;       // boxes; past this the shell is thinned rather than grown
    const SHELL_MS = 90;          // how often the shell may be rebuilt
    const LIFE_MS = 14000;        // a prop that never settles is settled for it
    const SEND_MS = 66;           // ~15Hz, the same rate walking avatars go out at
    const REST_SPEED = 0.55;      // below this for REST_FRAMES it has stopped
    const REST_FRAMES = 12;
    const FIXED = 1 / 60;         // the simulation's own tick
    const CATCHUP = 0.25;         // how much real time one frame may make up
    const HIT_SPEED = 2.2;        // below this a contact is a nudge, not a landing
    const HIT_MAX = 6;            // impacts reported per packet — a collapse, not a drum roll
    // Chain reactions: a prop that hits the world hard enough can bring down
    // what it hit. Bounded on three axes so a cascade provably dies out —
    // speed to start one, how many may start per tick, and how many
    // generations deep it may go before it stops counting as the same event.
    // Measured against the shell in a real collapse, impacts peak around 7 and
    // sit well below that most of the time — a threshold of 6 fired only on the
    // luckiest hits, and since knock impulses carry a random component that made
    // chaining a coin toss. 4.5 is still firmly "struck", not "brushed".
    const CHAIN_SPEED = 4.5;
    const CHAIN_PER_STEP = 2;
    const CHAIN_MAX_DEPTH = 3;

    let nextId = 1;

    class Physics {
        constructor(game) {
            this.game = game;
            this.on = false;
            this.props = new Map();      // id -> prop (host: with body; client: render only)
            this.views = new Map();      // id -> { group, mesh } — what is drawn
            this._lastSend = 0;
            this._shellAt = 0;
            this._shellKey = '';
        }

        get available() { return typeof window.CANNON !== 'undefined'; }
        get count() { return this.props.size; }

        // ---- turning it on and off ---------------------------------------

        /**
         * Physics is the host's, because the host is the only one simulating.
         * Everyone is told, so the tools appear for them too.
         */
        setEnabled(on) {
            on = !!on && this.available;
            if (on === this.on) return this.on;
            this.on = on;
            if (on) this._makeWorld();
            else this.clearAll();
            return this.on;
        }

        _makeWorld() {
            const CANNON = window.CANNON;
            const world = new CANNON.World();
            world.gravity.set(0, GRAVITY, 0);
            world.broadphase = new CANNON.SAPBroadphase(world);
            world.allowSleep = true;
            world.defaultContactMaterial.friction = 0.55;
            world.defaultContactMaterial.restitution = 0.08;

            // The ground the whole world stands on. It reaches past the build
            // area, so a brick knocked off the edge lands on the plain rather
            // than falling forever.
            const ground = new CANNON.Body({ mass: 0 });
            ground.addShape(new CANNON.Plane());
            ground.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
            world.addBody(ground);

            this.world = world;
            this.ground = ground;
            this.shell = null;
        }

        // ---- the static shell --------------------------------------------

        /**
         * The bit of the world a prop can currently hit.
         *
         * Rebuilt from the cells around the live props rather than from the
         * whole world: 161×161×24 boxes is not a physics world, it is a hang.
         * Cheap enough to redo several times a second, and only redone when the
         * props have actually moved to different cells.
         */
        _refreshShell(force) {
            const now = Date.now();
            if (!force && now - this._shellAt < SHELL_MS) return;
            this._shellAt = now;

            const v = this.game.voxels;
            const cells = [];
            const seen = new Set();
            let key = '';

            this.props.forEach(p => {
                if (!p.body) return;
                const cx = Math.round(p.body.position.x), cy = Math.round(p.body.position.y),
                    cz = Math.round(p.body.position.z);
                key += cx + ',' + cy + ',' + cz + ';';
                const r = SHELL_RADIUS;
                for (let x = cx - r; x <= cx + r; x++) {
                    for (let y = Math.max(0, cy - r); y <= cy + r; y++) {
                        for (let z = cz - r; z <= cz + r; z++) {
                            const k = x + ',' + y + ',' + z;
                            if (seen.has(k)) continue;
                            seen.add(k);
                            if (v.hasBlock(x, y, z)) cells.push([x, y, z]);
                        }
                    }
                }
            });

            // The world changes under the props too — a wall built while a
            // brick is in the air has to be there when it arrives.
            key += '|' + v.count();
            if (key === this._shellKey && !force) return;
            this._shellKey = key;

            const CANNON = window.CANNON;
            if (this.shell) this.world.removeBody(this.shell);
            if (!cells.length) { this.shell = null; return; }

            const body = new CANNON.Body({ mass: 0 });
            const half = new CANNON.Vec3(0.5, 0.5, 0.5);
            const limit = Math.min(cells.length, SHELL_CAP);
            for (let i = 0; i < limit; i++) {
                const [x, y, z] = cells[i];
                body.addShape(new CANNON.Box(half), new CANNON.Vec3(x + 0.5, y + 0.5, z + 0.5));
            }
            body.isWorldShell = true;   // survives the shell being rebuilt
            this.world.addBody(body);
            this.shell = body;
        }

        // ---- making props -------------------------------------------------

        /**
         * A block or brick leaves the world and becomes a falling thing.
         *
         * The cells it occupied are taken out through the ordinary edit path,
         * so every client's world agrees about the hole before anything starts
         * moving. Host only — everywhere else this is a request.
         */
        spawn(opts) {
            if (!this.on || !this.world) return null;
            if (this.props.size >= MAX_PROPS) return null;
            const CANNON = window.CANNON;
            const w = Math.max(1, opts.w || 1), d = Math.max(1, opts.d || 1);

            const body = new CANNON.Body({
                mass: 0.9 * w * d,
                // Corner coordinates in, centre-of-box out: the physics world
                // thinks in centres and the voxel world thinks in corners.
                position: new CANNON.Vec3(opts.x + w / 2, opts.y + 0.5, opts.z + d / 2)
            });
            body.addShape(new CANNON.Box(new CANNON.Vec3(w / 2, 0.5, d / 2)));
            body.allowSleep = true;
            body.sleepSpeedLimit = REST_SPEED;
            body.sleepTimeLimit = 0.35;
            body.linearDamping = 0.06;
            body.angularDamping = 0.12;
            if (opts.impulse) {
                body.velocity.set(opts.impulse.x || 0, opts.impulse.y || 0, opts.impulse.z || 0);
            }
            // Tumble belongs to a blow, not to a drop. A piece let go above a
            // spot should land on that spot; one that has been hit should go
            // end over end. Spinning everything meant a dropped brick bounced
            // off across the floor and settled somewhere else entirely.
            if (opts.spin) {
                const s = opts.spin;
                body.angularVelocity.set(
                    (Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
            }
            this.world.addBody(body);

            const prop = {
                id: 'p' + (nextId++), body, w, d,
                c: opts.c, owner: opts.owner || null, brick: !!opts.brick,
                born: Date.now(), age: 0, still: 0
            };
            // Nothing has been simulated while the world was empty, so the
            // clock starts again with the first thing in the air.
            if (this.props.size === 0) this._lastStep = 0;
            // Every contact hard enough to hear. cannon reports these during
            // the step, on the host, which is the only place bodies exist.
            body.addEventListener('collide', (e) => {
                const c = e.contact;
                if (!c || !c.getImpactVelocityAlongNormal) return;
                const speed = Math.abs(c.getImpactVelocityAlongNormal());
                if (speed >= HIT_SPEED) this._noteHit(prop, speed);
                // Hard enough, and against the world rather than another prop:
                // whatever it struck may not survive being struck.
                if (speed >= CHAIN_SPEED && e.body && e.body.isWorldShell) {
                    this._noteChain(prop, c, speed);
                }
            });

            this.props.set(prop.id, prop);
            this._refreshShell(true);
            return prop;
        }

        /**
         * Hit something. The block under the blow — and its whole brick, if it
         * is one — comes loose and flies, and whatever it was holding up is
         * then unsupported and follows it down.
         */
        knock(x, y, z, dir, power) {
            if (!this.on) return 0;
            const g = this.game, v = g.voxels;
            if (!v.hasBlock(x, y, z)) return 0;

            const cells = [];
            const pieceId = v.pieceAt(x, y, z);
            if (pieceId) {
                const piece = v.pieces.get(pieceId);
                if (piece) cells.push({ piece, id: pieceId });
            } else {
                cells.push({ cell: [x, y, z] });
            }

            const push = power || 9;
            const made = this._launch(cells, () => ({
                x: (dir.x || 0) * push + (Math.random() - 0.5) * 2,
                y: Math.abs(push) * 0.35 + Math.random() * 2,
                z: (dir.z || 0) * push + (Math.random() - 0.5) * 2
            }), 7);

            // What it was propping up has nothing under it now. A blow is
            // worth everything it brought with it, which is what Demolition
            // Party scores, so the collapse counts towards the same total.
            const brought = made ? this.collapseAround([[x, y, z]]) : 0;
            return made + (brought || 0);
        }

        /**
         * Everything that was resting on what just went away.
         *
         * A flood fill from the disturbed cells: any connected lump of blocks
         * with no path down to the ground comes loose. Capped, because a tower
         * ten thousand cells big should stand there looking structural rather
         * than becoming ten thousand rigid bodies.
         */
        /**
         * Which cells would come loose if these ones went away.
         *
         * The same walk `collapseAround` does, without touching anything — so
         * the Knock tool can show you what a blow is about to bring down before
         * you commit to it. `gone` lets the caller pretend a cell is already
         * removed, which is exactly the question a preview is asking.
         *
         * @param {Array} removed cells that have gone (or would)
         * @param {Set}   [gone]  extra keys to treat as empty
         * @returns {Array} the cells with no path to the ground
         */
        looseCells(removed, gone) {
            const v = this.game.voxels;
            const solid = (x, y, z) => y >= 0 && v.hasBlock(x, y, z)
                && !(gone && gone.has(x + ',' + y + ',' + z));
            const near = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
            const seeds = [];
            removed.forEach(([x, y, z]) => {
                near.forEach(([dx, dy, dz]) => {
                    const p = [x + dx, y + dy, z + dz];
                    if (solid(p[0], p[1], p[2])) seeds.push(p);
                });
            });

            const checked = new Set();
            const out = [];
            for (const seed of seeds) {
                const start = seed.join(',');
                if (checked.has(start)) continue;
                const lump = [], queue = [seed], mine = new Set([start]);
                let grounded = false, over = false;
                while (queue.length) {
                    const [x, y, z] = queue.pop();
                    if (y === 0) { grounded = true; break; }
                    lump.push([x, y, z]);
                    if (lump.length > MAX_COLLAPSE) { over = true; break; }
                    for (const [dx, dy, dz] of near) {
                        const nx = x + dx, ny = y + dy, nz = z + dz;
                        const k = nx + ',' + ny + ',' + nz;
                        if (mine.has(k) || !solid(nx, ny, nz)) continue;
                        mine.add(k);
                        queue.push([nx, ny, nz]);
                    }
                }
                mine.forEach(k => checked.add(k));
                if (grounded || over || !lump.length) continue;
                lump.forEach(c => out.push(c));
            }
            return out;
        }

        /**
         * What a blow at this cell would bring down, counting the cell (or the
         * whole brick) that takes the hit. Read-only, so any client may ask.
         */
        previewKnock(x, y, z) {
            const v = this.game.voxels;
            if (!this.on || !v.hasBlock(x, y, z)) return [];
            const hit = [];
            const gone = new Set();
            const pieceId = v.pieceAt(x, y, z);
            if (pieceId) {
                const piece = v.pieces.get(pieceId);
                const cells = piece && window.BlockPartyBricks
                    ? BlockPartyBricks.cellsOf(piece.x, piece.y, piece.z, piece.w, piece.d) : null;
                (cells || [[x, y, z]]).forEach(c => {
                    const cell = c.length ? c : [c.x, c.y, c.z];
                    hit.push(cell); gone.add(cell.join(','));
                });
            } else {
                hit.push([x, y, z]); gone.add(x + ',' + y + ',' + z);
            }
            return hit.concat(this.looseCells(hit, gone));
        }

        collapseAround(removed) {
            if (!this.on) return 0;
            const v = this.game.voxels;
            const seeds = [];
            const near = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
            removed.forEach(([x, y, z]) => {
                near.forEach(([dx, dy, dz]) => {
                    const p = [x + dx, y + dy, z + dz];
                    if (p[1] >= 0 && v.hasBlock(p[0], p[1], p[2])) seeds.push(p);
                });
            });
            if (!seeds.length) return 0;

            const checked = new Set();
            let made = 0;
            for (const seed of seeds) {
                const start = seed.join(',');
                if (checked.has(start)) continue;

                // Walk the lump this cell belongs to, looking for the ground.
                const lump = [], queue = [seed], mine = new Set([start]);
                let grounded = false, over = false;
                while (queue.length) {
                    const [x, y, z] = queue.pop();
                    if (y === 0) { grounded = true; break; }
                    lump.push([x, y, z]);
                    if (lump.length > MAX_COLLAPSE) { over = true; break; }
                    for (const [dx, dy, dz] of near) {
                        const nx = x + dx, ny = y + dy, nz = z + dz;
                        if (ny < 0) continue;
                        const k = nx + ',' + ny + ',' + nz;
                        if (mine.has(k) || !v.hasBlock(nx, ny, nz)) continue;
                        mine.add(k);
                        queue.push([nx, ny, nz]);
                    }
                }
                mine.forEach(k => checked.add(k));
                // Too big to be rubble is architecture: leave it standing.
                if (grounded || over || !lump.length) continue;

                const pieces = new Map();
                const loose = [];
                lump.forEach(([x, y, z]) => {
                    const id = v.pieceAt(x, y, z);
                    if (id) { if (!pieces.has(id)) pieces.set(id, v.pieces.get(id)); }
                    else loose.push([x, y, z]);
                });
                const batch = [];
                pieces.forEach((piece, id) => { if (piece) batch.push({ piece, id }); });
                loose.forEach(cell => batch.push({ cell }));
                // A collapse topples; it does not explode.
                made += this._launch(batch, () => ({
                    x: (Math.random() - 0.5) * 1.4, y: 0, z: (Math.random() - 0.5) * 1.4
                }), 1.8);
                if (this.props.size >= MAX_PROPS) break;
            }
            return made;
        }

        /**
         * Take a batch of cells and bricks out of the world and put the same
         * things into the air. One edit for the lot, so the room sees the hole
         * appear once rather than a block at a time.
         */
        _launch(batch, impulseFor, spin) {
            const g = this.game, v = g.voxels;
            const remove = [], delPieces = [], plan = [];

            batch.forEach(item => {
                if (this.props.size + plan.length >= MAX_PROPS) return;
                if (item.piece) {
                    const p = item.piece;
                    delPieces.push(item.id);
                    plan.push({ x: p.x, y: p.y, z: p.z, w: p.w, d: p.d, c: p.c, owner: p.owner, brick: true });
                } else {
                    const [x, y, z] = item.cell;
                    if (!v.hasBlock(x, y, z)) return;
                    remove.push([x, y, z]);
                    plan.push({
                        x, y, z, w: 1, d: 1,
                        c: v.world.get(VoxelKey(x, y, z)), owner: v.ownerOf(x, y, z), brick: false
                    });
                }
            });
            if (!plan.length) return 0;
            // Without a world nothing can spawn, and digging the hole anyway
            // would delete the blocks on every client for good. This is the
            // state a freshly promoted host is in until it builds one.
            if (!this.world) return 0;

            // The hole is an ordinary edit: undoable, chunked, and identical on
            // every client before anything is allowed to move.
            g.applyPhysicsEdit({ a: 'bulk', o: g.username, remove, delPieces });

            plan.forEach(item => this.spawn(Object.assign({}, item, { impulse: impulseFor(item), spin })));
            return plan.length;
        }

        // ---- the simulation ----------------------------------------------

        /**
         * Host only. Everyone else is shown what this produced.
         *
         * Physics keeps its own clock rather than taking the renderer's. The
         * render loop clamps its delta to keep camera easing sane on a stutter,
         * and feeding that to the simulation makes everything fall in slow
         * motion on a slow machine — a tower knocked over at three frames a
         * second took half a minute to reach the floor. Real elapsed time, with
         * a ceiling so a backgrounded tab does not come back to a catapult.
         *
         * `seconds` overrides the clock, which is how a test drives the
         * simulation without waiting on a renderer — a headless software
         * renderer manages two frames a second, and a tower that takes a
         * minute of wall time to fall over cannot be asserted about.
         */
        /**
         * Remember a contact worth hearing.
         *
         * Host-only by construction — only the host has bodies. The room is
         * told about these on the ordinary props packet so everybody hears the
         * same collapse at the same moment.
         */
        _noteHit(prop, speed) {
            if (!this._hits) this._hits = [];
            if (this._hits.length >= HIT_MAX) return;
            const b = prop.body;
            this._hits.push([
                +b.position.x.toFixed(1), +b.position.y.toFixed(1), +b.position.z.toFixed(1),
                Math.round(Math.min(20, speed)), prop.w * prop.d, prop.c
            ]);
        }

        /**
         * Play what the host heard: a thud and a puff of dust at each impact.
         * Runs on every client, host included, off the same list.
         */
        playHits(hits) {
            if (!hits || !hits.length) return;
            const sfx = window.BlockPartySfx;
            const fx = this.game.voxels && this.game.voxels.fx;
            let loudest = 0;
            hits.forEach(h => {
                const speed = h[3] || 0;
                if (speed > loudest) loudest = speed;
                if (sfx && sfx.thud) sfx.thud(speed, h[4] || 1);
                if (fx && speed >= HIT_SPEED) {
                    fx.burst(Math.round(h[0]), Math.max(0, Math.round(h[1])), Math.round(h[2]), '#cbd5e1');
                }
            });
            // One shake for the whole moment, not one per brick.
            if (loudest >= 8 && this.game.voxels && this.game.voxels.shake) {
                this.game.voxels.shake(Math.min(1, loudest / 20));
            }
        }

        /**
         * Remember where a prop hit the world hard, so the next tick can ask
         * whether what it hit is still standing up.
         *
         * Queued rather than acted on immediately: this fires inside cannon's
         * solver, and launching new bodies mid-solve is how you corrupt a
         * simulation.
         */
        _noteChain(prop, contact, speed) {
            if ((prop.chain || 0) >= CHAIN_MAX_DEPTH) return;   // that is deep enough
            if (!this._chains) this._chains = [];
            if (this._chains.length >= CHAIN_PER_STEP * 3) return;
            const CANNON = window.CANNON;
            // Contact point in world space, nudged along the normal so it lands
            // in the cell that was struck rather than the one that struck it.
            const at = new CANNON.Vec3();
            contact.bi.position.vadd(contact.ri, at);
            const n = contact.ni;
            this._chains.push({
                x: Math.floor(at.x + n.x * 0.35),
                y: Math.floor(at.y + n.y * 0.35),
                z: Math.floor(at.z + n.z * 0.35),
                depth: (prop.chain || 0) + 1,
                speed
            });
        }

        /** Bring down whatever the last tick's impacts knocked the legs from under. */
        _runChains() {
            const list = this._chains;
            if (!list || !list.length) return 0;
            this._chains = [];
            const v = this.game.voxels;
            let made = 0, started = 0;
            for (const hit of list) {
                if (started >= CHAIN_PER_STEP) break;
                if (this.props.size >= MAX_PROPS) break;
                if (!v.hasBlock(hit.x, hit.y, hit.z)) continue;
                const before = this.props.size;
                // The struck cell goes, and the flood fill decides what was
                // relying on it — the same path an ordinary knock takes.
                const n = this.knock(hit.x, hit.y, hit.z,
                    { x: 0, z: 0 }, Math.min(9, hit.speed * 0.5));
                if (n) {
                    started++;
                    made += n;
                    // Mark the new props with this generation so a cascade
                    // cannot recurse forever.
                    let i = 0;
                    this.props.forEach(p => { if (i++ >= before) p.chain = hit.depth; });
                }
            }
            return made;
        }

        step(seconds) {
            if (!this.on || !this.world || !this.props.size) return;
            const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
            const elapsed = typeof seconds === 'number'
                ? Math.min(CATCHUP, seconds)
                : Math.min(CATCHUP, (now - (this._lastStep || now)) / 1000);
            this._lastStep = now;
            this._refreshShell(false);
            this.world.step(FIXED, elapsed, Math.ceil(CATCHUP / FIXED));

            // Anything struck hard last tick may now be unsupported.
            this._runChains();

            const done = [];
            const restNeeded = REST_FRAMES * FIXED;      // seconds of stillness
            this.props.forEach(prop => {
                const b = prop.body;
                // Time the simulation actually ran, not time that passed. A
                // backgrounded tab stops stepping while Date.now() carries on.
                prop.age = (prop.age || 0) + elapsed;
                const speed = b.velocity.length() + b.angularVelocity.length();
                if (speed < REST_SPEED) prop.still += elapsed; else prop.still = 0;
                // Asleep, still for long enough, or simply out of patience.
                if (b.sleepState === window.CANNON.Body.SLEEPING
                    || prop.still > restNeeded || prop.age > LIFE_MS / 1000) done.push(prop);
                // Through the floor is a physics failure, not a place to land.
                else if (b.position.y < -4) done.push(prop);
            });
            done.forEach(p => this._settle(p));
        }

        /**
         * A prop has stopped. Snap it to the grid and put it back into the
         * world as an ordinary block or brick — and if it cannot go back
         * anywhere sensible, let it go rather than leaving it hanging.
         */
        _settle(prop) {
            const g = this.game, v = g.voxels;
            this._remove(prop);

            const b = prop.body;
            if (b.position.y < -1) { this._puff(prop); return; }

            // A brick that came to rest turned a quarter is a brick the other
            // way round, so the footprint turns with it.
            const yaw = yawOf(b.quaternion);
            const turned = (yaw === 1 || yaw === 3);
            const w = turned ? prop.d : prop.w, d = turned ? prop.w : prop.d;

            let x = Math.round(b.position.x - w / 2);
            let z = Math.round(b.position.z - d / 2);
            let y = Math.max(0, Math.round(b.position.y - 0.5));

            // Nudge upwards out of anything it is overlapping, rather than
            // deleting whatever it happened to land inside.
            let fits = false;
            for (let lift = 0; lift <= 3 && !fits; lift++) {
                fits = this._roomFor(x, y + lift, z, w, d);
                if (fits) y += lift;
            }
            if (!fits) { this._puff(prop); return; }

            // A mode may declare that what lands is wreckage rather than
            // anybody's block — Demolition Party does, so a settled pile cannot
            // be knocked over again for more points.
            const owner = this.rubbleOwner || prop.owner || g.username;
            if (prop.brick || w * d > 1) {
                g.applyPhysicsEdit({
                    a: 'bulk', o: owner,
                    addPieces: [[BlockPartyBricks.newId(owner), x, y, z, w, d, prop.c, owner]]
                });
            } else {
                g.applyPhysicsEdit({ a: 'place', x, y, z, c: prop.c, o: owner, s: 0 });
            }
            const fx = v.fx;
            if (fx) fx.pop(x, y, z, v.renderColorAt(x, y, z) || '#ffffff');
            const sfx = window.BlockPartySfx;
            if (sfx) sfx.place(y, true);
        }

        _roomFor(x, y, z, w, d) {
            const v = this.game.voxels;
            for (let i = 0; i < w; i++) {
                for (let j = 0; j < d; j++) {
                    if (!v.inBounds(x + i, y, z + j)) return false;
                    if (v.hasBlock(x + i, y, z + j)) return false;
                    // A landing is not an edit: ask whether a block may REST
                    // here, not whether the player could have put one here.
                    const modes = this.game.modes;
                    if (modes && modes.allowsSettle && !modes.allowsSettle(x + i, y, z + j)) return false;
                    if (!modes && !this.game._canEditCell(x + i, y, z + j, true)) return false;
                }
            }
            return true;
        }

        /** It could not land anywhere. Better a puff of dust than a lie. */
        _puff(prop) {
            const v = this.game.voxels;
            const b = prop.body;
            if (v.fx) v.fx.burst(Math.round(b.position.x), Math.max(0, Math.round(b.position.y)),
                Math.round(b.position.z), '#cbd5e1');
        }

        _remove(prop) {
            if (prop.body && this.world) this.world.removeBody(prop.body);
            this.props.delete(prop.id);
            this._dropView(prop.id);
        }

        /**
         * Put every prop in flight back into the world, then let go of them.
         *
         * A prop's cell is removed the moment it launches; the block only exists
         * again when the prop settles. So anything that ends the simulation
         * early — turning physics off, travelling to another region, loading a
         * map, starting a match — destroys those blocks outright unless it lands
         * them first. Settling straight down from where each one currently is
         * conserves the build; a prop with genuinely nowhere to go puffs, which
         * is the same answer `_settle` gives.
         *
         * Host-only: a guest has no bodies and nothing to conserve.
         */
        flush() {
            if (!this.world || !this.props.size) return 0;
            let landed = 0;
            // _settle mutates this.props, so walk a copy.
            Array.from(this.props.values()).forEach(prop => {
                if (!prop.body) return;
                try { this._settle(prop); landed++; }
                catch (e) { console.warn('[Physics] could not land a prop', e); }
            });
            this.clearAll();
            return landed;
        }

        clearAll() {
            // Queued impacts refer to cells that may not exist any more.
            this._chains = [];
            this.props.forEach(p => { if (p.body && this.world) this.world.removeBody(p.body); });
            this.props.clear();
            this.views.forEach((view) => this._disposeView(view));
            this.views.clear();
            if (this.shell && this.world) { this.world.removeBody(this.shell); this.shell = null; }
            this._shellKey = '';
        }

        // ---- the wire ------------------------------------------------------

        /**
         * What the room needs to draw what the host is simulating. Coordinates
         * to a hundredth of a block and the quaternion to three places: a prop
         * is a tumbling toy, not a survey point.
         */
        states() {
            // One empty list is what clears everyone's props; after that there is
            // nothing to say until something spawns again.
            const empty = !this.props.size;
            if (empty && this._sentEmpty) return null;
            if (!empty) this._sentEmpty = false;

            // The empty list is what clears everyone's props, so it must never
            // be swallowed by the rate limit — marking it sent before the
            // throttle could drop it left guests drawing frozen ghost blocks
            // until something else spawned.
            const now = Date.now();
            if (!empty && now - this._lastSend < SEND_MS) return null;
            this._lastSend = now;
            if (empty) this._sentEmpty = true;
            const out = [];
            this.props.forEach(p => {
                const b = p.body, q = b.quaternion;
                out.push([p.id,
                    +b.position.x.toFixed(2), +b.position.y.toFixed(2), +b.position.z.toFixed(2),
                    +q.x.toFixed(3), +q.y.toFixed(3), +q.z.toFixed(3), +q.w.toFixed(3),
                    p.c, p.w, p.d]);
            });
            const hits = this._hits && this._hits.length ? this._hits : null;
            this._hits = [];
            return { props: out, hits };
        }

        /** A client, told what is in the air. */
        apply(list) {
            const seen = new Set();
            (list || []).forEach(r => {
                const id = r[0];
                seen.add(id);
                let p = this.props.get(id);
                if (!p) {
                    p = { id, c: r[8], w: r[9], d: r[10], remote: true };
                    this.props.set(id, p);
                }
                p.at = { x: r[1], y: r[2], z: r[3] };
                p.q = { x: r[4], y: r[5], z: r[6], w: r[7] };
            });
            this.props.forEach((p, id) => {
                if (!seen.has(id) && p.remote) { this.props.delete(id); this._dropView(id); }
            });
        }

        // ---- drawing --------------------------------------------------------

        /**
         * Props are drawn from wherever they are — the host's own bodies, or
         * the last transform a client was sent, eased towards so fifteen
         * updates a second look like sixty.
         */
        draw(dt) {
            if (!this.props.size) { if (this.views.size) this._clearViews(); return; }
            const v = this.game.voxels;
            this.props.forEach(prop => {
                let view = this.views.get(prop.id);
                let fresh = false;
                if (!view) {
                    view = this._makeView(prop);
                    this.views.set(prop.id, view);
                    fresh = true;      // nothing to ease from yet
                }
                const at = prop.body ? prop.body.position : prop.at;
                const q = prop.body ? prop.body.quaternion : prop.q;
                if (!at || !q) return;
                if (prop.body) {
                    view.group.position.set(at.x, at.y, at.z);
                    view.group.quaternion.set(q.x, q.y, q.z, q.w);
                } else if (fresh) {
                    // A view created this frame has no previous position to come
                    // from; easing would streak it in from the world origin.
                    view.group.position.set(at.x, at.y, at.z);
                    view.group.quaternion.set(q.x, q.y, q.z, q.w);
                } else {
                    // Eased, because these arrive fifteen times a second.
                    const k = Math.min(1, dt * 14);
                    view.group.position.lerp(new THREE.Vector3(at.x, at.y, at.z), k);
                    view.group.quaternion.slerp(new THREE.Quaternion(q.x, q.y, q.z, q.w), k);
                }
            });
            this.views.forEach((view, id) => { if (!this.props.has(id)) { this._disposeView(view); this.views.delete(id); } });
            void v;
        }

        _makeView(prop) {
            const v = this.game.voxels;
            const geo = prop.w * prop.d > 1 || prop.brick
                ? BlockPartyBricks.geometry(prop.w, prop.d)
                : v.brickLook ? BlockPartyBricks.geometry(1, 1) : new THREE.BoxGeometry(1, 1, 1);
            const mesh = new THREE.Mesh(geo, v.materialForColor(prop.c));
            // The geometry's origin is its corner and the body's is its centre.
            mesh.position.set(-prop.w / 2, -0.5, -prop.d / 2);
            mesh.castShadow = !v.software;
            const group = new THREE.Group();
            group.add(mesh);
            v.scene.add(group);
            return { group, mesh, owned: !(prop.w * prop.d > 1 || prop.brick) && !v.brickLook };
        }

        _dropView(id) {
            const view = this.views.get(id);
            if (!view) return;
            this._disposeView(view);
            this.views.delete(id);
        }

        _disposeView(view) {
            this.game.voxels.scene.remove(view.group);
            // Brick geometry is shared and cached; a plain cube is this view's own.
            if (view.owned && view.mesh.geometry) view.mesh.geometry.dispose();
        }

        _clearViews() {
            this.views.forEach(view => this._disposeView(view));
            this.views.clear();
        }
    }

    /** The same cell key the world uses. */
    function VoxelKey(x, y, z) { return x + ',' + y + ',' + z; }

    /** Which quarter turn about Y this rotation is nearest. */
    function yawOf(q) {
        const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
        return ((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4;
    }

    Physics.MAX_PROPS = MAX_PROPS;
    Physics.MAX_COLLAPSE = MAX_COLLAPSE;
    window.BlockPartyPhysics = Physics;
})();
