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
                born: Date.now(), still: 0
            };
            // Nothing has been simulated while the world was empty, so the
            // clock starts again with the first thing in the air.
            if (this.props.size === 0) this._lastStep = 0;
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

            // What it was propping up has nothing under it now.
            if (made) this.collapseAround([[x, y, z]]);
            return made;
        }

        /**
         * Everything that was resting on what just went away.
         *
         * A flood fill from the disturbed cells: any connected lump of blocks
         * with no path down to the ground comes loose. Capped, because a tower
         * ten thousand cells big should stand there looking structural rather
         * than becoming ten thousand rigid bodies.
         */
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
        step(seconds) {
            if (!this.on || !this.world || !this.props.size) return;
            const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
            const elapsed = typeof seconds === 'number'
                ? Math.min(CATCHUP, seconds)
                : Math.min(CATCHUP, (now - (this._lastStep || now)) / 1000);
            this._lastStep = now;
            this._refreshShell(false);
            this.world.step(FIXED, elapsed, Math.ceil(CATCHUP / FIXED));

            const wall = Date.now();
            const done = [];
            this.props.forEach(prop => {
                const b = prop.body;
                const speed = b.velocity.length() + b.angularVelocity.length();
                if (speed < REST_SPEED) prop.still++; else prop.still = 0;
                // Asleep, still for long enough, or simply out of patience.
                if (b.sleepState === window.CANNON.Body.SLEEPING
                    || prop.still > REST_FRAMES || wall - prop.born > LIFE_MS) done.push(prop);
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

            if (prop.brick || w * d > 1) {
                g.applyPhysicsEdit({
                    a: 'bulk', o: prop.owner || g.username,
                    addPieces: [[BlockPartyBricks.newId(prop.owner || g.username),
                        x, y, z, w, d, prop.c, prop.owner || null]]
                });
            } else {
                g.applyPhysicsEdit({
                    a: 'place', x, y, z, c: prop.c, o: prop.owner || g.username, s: 0
                });
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
                    if (!this.game._canEditCell(x + i, y, z + j, true)) return false;
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

        clearAll() {
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
            const now = Date.now();
            if (now - this._lastSend < SEND_MS) return null;
            this._lastSend = now;
            const out = [];
            this.props.forEach(p => {
                const b = p.body, q = b.quaternion;
                out.push([p.id,
                    +b.position.x.toFixed(2), +b.position.y.toFixed(2), +b.position.z.toFixed(2),
                    +q.x.toFixed(3), +q.y.toFixed(3), +q.z.toFixed(3), +q.w.toFixed(3),
                    p.c, p.w, p.d]);
            });
            return out;
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
                if (!view) { view = this._makeView(prop); this.views.set(prop.id, view); }
                const at = prop.body ? prop.body.position : prop.at;
                const q = prop.body ? prop.body.quaternion : prop.q;
                if (!at || !q) return;
                if (prop.body) {
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
