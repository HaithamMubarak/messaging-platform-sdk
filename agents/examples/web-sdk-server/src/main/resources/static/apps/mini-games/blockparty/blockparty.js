/**
 * BlockParty — Co-op Voxel Builder
 * Real-time multiplayer 3D building on the Messaging Platform SDK.
 *
 * - three.js (r128, self-hosted) for rendering
 * - UserConnectionBase for channel messaging + WebRTC P2P
 * - Channel Storage persists the shared world so it survives everyone leaving
 *
 * Networking model (host-relay / star topology):
 *   - Every player applies their own edits locally (optimistic).
 *   - Edits are sent with sendData(): a client's edit reaches the host, the host
 *     re-broadcasts it to everyone. Host edits broadcast directly. Edits are
 *     idempotent per cell (last-write-wins) so echoes are harmless.
 *   - The host owns persistence and answers world-snapshot requests from joiners.
 */

(function () {
    'use strict';

    // ---- World constants ----
    const HALF = 24;              // world spans [-HALF, HALF] on X/Z
    const MAX_Y = 40;             // build height ceiling
    const STORAGE_KEY = 'blockparty_world';
    const SAVE_DEBOUNCE_MS = 2500;
    const CURSOR_THROTTLE_MS = 120;
    const PLOT_COVER_H = 6;       // height of the cover that hides a rival's plot
    const MAX_FILL_CELLS = 1200;  // biggest region one fill may touch
    const BULK_CHUNK = 300;       // cells per wire message, to stay well under
                                  // the data-channel size limit
    // The platform expires a session after 180s unless something the client
    // sends touches it. BlockParty talks over WebRTC almost exclusively, so a
    // room deep in a quiet three-minute round would let its session lapse and
    // channel storage would start refusing writes. A cheap read-only call keeps
    // it alive without putting any traffic into the room.
    const SESSION_KEEPALIVE_MS = 45000;   // comfortably inside the 180s window
    const SLOT_PREFIX = 'blockparty_slot_';
    const STATS_KEY = 'blockparty_stats';

    // Palette — index maps to a color; sent over the wire as a small int.
    const PALETTE = [
        '#ef4444', '#f59e0b', '#facc15', '#22c55e',
        '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
        '#ffffff', '#94a3b8', '#78350f', '#111827'
    ];

    // Block shapes — index is sent over the wire as a small int, so entries must
    // only ever be appended (never reordered) or saved worlds would change shape.
    // `cy` is the mesh centre height inside the cell: a full-height shape sits at
    // 0.5, a half-height slab at 0.25, so every shape rests on the cell floor.
    const SHAPES = [
        { key: 'cube',    name: 'Cube',    icon: '🧱', cy: 0.5,  make: () => new THREE.BoxGeometry(1, 1, 1) },
        { key: 'slab',    name: 'Slab',    icon: '▬',  cy: 0.25, make: () => new THREE.BoxGeometry(1, 0.5, 1) },
        { key: 'pillar',  name: 'Pillar',  icon: '🥫', cy: 0.5,  make: () => new THREE.CylinderGeometry(0.35, 0.35, 1, 16) },
        { key: 'sphere',  name: 'Sphere',  icon: '⚪', cy: 0.5,  make: () => new THREE.SphereGeometry(0.5, 20, 14) },
        { key: 'cone',    name: 'Cone',    icon: '🔺', cy: 0.5,  make: () => new THREE.ConeGeometry(0.5, 1, 20) },
        // A 4-sided cone is a pyramid; rotating 45° squares its base to the cell.
        { key: 'pyramid', name: 'Pyramid', icon: '⛰️', cy: 0.5,  make: () => {
            const g = new THREE.ConeGeometry(0.707, 1, 4);
            g.rotateY(Math.PI / 4);
            return g;
        } }
    ];
    const shapeAt = i => SHAPES[i] || SHAPES[0];
    const shapeIndex = i => (Number.isInteger(i) && i >= 0 && i < SHAPES.length) ? i : 0;

    // =========================================================
    // Voxel renderer — owns the three.js scene, camera, picking
    // =========================================================
    class VoxelWorld {
        constructor(mountEl) {
            this.mountEl = mountEl;
            this.world = new Map();     // "x,y,z" -> colorIndex
            this.owners = new Map();    // "x,y,z" -> player name who placed it
            this.shapes = new Map();    // "x,y,z" -> shape index (absent = cube)
            this.meshes = new Map();    // "x,y,z" -> THREE.Mesh (single cells only)
            // A brick piece covers several cells but is one mesh and one thing
            // to break. Its cells are registered in world/owners too, so counts,
            // saves and blueprint scoring keep working per cell.
            this.pieces = new Map();    // pieceId -> { id, x, y, z, w, d, c, owner, cells, mesh }
            this.pieceOf = new Map();   // "x,y,z" -> pieceId
            this.brickLook = false;     // cubes render as studded 1x1 bricks
            this.remoteCursors = new Map(); // peerId -> { group, line, ghost, label, ... }

            this.geometries = SHAPES.map(s => s.make());
            this.geometry = this.geometries[0];   // cube, the default
            this.materials = PALETTE.map(hex => new THREE.MeshLambertMaterial({ color: new THREE.Color(hex) }));
            // Translucent twins of the palette, for placement ghosts.
            this.ghostMaterials = PALETTE.map(hex => new THREE.MeshLambertMaterial({
                color: new THREE.Color(hex), transparent: true, opacity: 0.45, depthWrite: false
            }));
            // A more solid set for the blueprint you are studying — it has to be
            // readable at a glance in three seconds.
            this.blueprintMaterials = PALETTE.map(hex => new THREE.MeshLambertMaterial({
                color: new THREE.Color(hex), transparent: true, opacity: 0.78
            }));
            this.cursorGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02, 1.02, 1.02));
            this.preview = null;        // local placement ghost (built lazily)

            this.arena = null;          // match plots (group), null in the sandbox
            this.pads = new Map();      // player name -> { group, cover, label, ... }
            this.ghostGroups = new Map(); // id -> blueprint ghost group

            this._initScene();
            this._initCamera();
            this._bindResize();
        }

        _initScene() {
            const w = window.innerWidth, h = window.innerHeight;

            this.renderer = new THREE.WebGLRenderer({ antialias: true });
            this.renderer.setSize(w, h);
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
            this.mountEl.appendChild(this.renderer.domElement);

            this.scene = new THREE.Scene();
            this.scene.background = new THREE.Color('#0b1020');
            this.scene.fog = new THREE.Fog('#0b1020', 55, 110);

            // Lighting
            const hemi = new THREE.HemisphereLight('#bcd0ff', '#0b1020', 0.9);
            this.scene.add(hemi);
            const dir = new THREE.DirectionalLight('#ffffff', 0.7);
            dir.position.set(20, 40, 15);
            this.scene.add(dir);

            // Ground plane (pick target for floor placement)
            const size = HALF * 2 + 1;
            const groundMat = new THREE.MeshLambertMaterial({ color: '#161d33' });
            this.ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), groundMat);
            this.ground.rotation.x = -Math.PI / 2;
            this.ground.position.set(0, 0, 0);
            this.ground.userData.isGround = true;
            this.scene.add(this.ground);

            // Grid + border
            const grid = new THREE.GridHelper(size, size, 0x2b3557, 0x1c2440);
            grid.position.y = 0.001;
            this.scene.add(grid);

            this.raycaster = new THREE.Raycaster();
        }

        _initCamera() {
            this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
            this.target = new THREE.Vector3(0, 2, 0);
            this.cam = { theta: Math.PI * 0.25, phi: Math.PI * 0.32, radius: 34 };
            // Where "reset view" goes back to. A match repoints it at your plot.
            this.home = { x: 0, y: 2, z: 0, radius: 34, phi: Math.PI * 0.32 };
            this._applyCamera();
        }

        resetView() {
            this.target.set(this.home.x, this.home.y, this.home.z);
            this.cam = {
                theta: Math.PI * 0.25,
                phi: this.home.phi || Math.PI * 0.32,
                radius: this.home.radius
            };
            this._applyCamera();
        }

        // Point the camera at a spot in the world. `phi` (optional) sets the
        // pitch, so a match can frame a plot from above without the player
        // having to re-aim after every round.
        focus(x, y, z, radius, phi) {
            this.target.set(x, y, z);
            if (radius) this.cam.radius = Math.max(6, Math.min(90, radius));
            if (phi) this.cam.phi = Math.max(0.12, Math.min(Math.PI / 2 - 0.02, phi));
            this.home = { x, y, z, radius: this.cam.radius, phi: this.cam.phi };
            this._applyCamera();
        }

        _applyCamera() {
            const { theta, phi, radius } = this.cam;
            const x = this.target.x + radius * Math.sin(phi) * Math.cos(theta);
            const y = this.target.y + radius * Math.cos(phi);
            const z = this.target.z + radius * Math.sin(phi) * Math.sin(theta);
            this.camera.position.set(x, y, z);
            this.camera.lookAt(this.target);
        }

        orbit(dx, dy) {
            // Drag-to-grab: the world should follow the pointer. Because theta is
            // measured from +X here (x=cos, z=sin), a rightward drag needs theta
            // to INCREASE — negating it spun the scene the wrong way.
            this.cam.theta += dx * 0.005;
            this.cam.phi -= dy * 0.005;
            const EPS = 0.12;
            this.cam.phi = Math.max(EPS, Math.min(Math.PI / 2 - 0.02, this.cam.phi));
            this._applyCamera();
        }

        zoom(delta) {
            this.cam.radius = Math.max(6, Math.min(90, this.cam.radius + delta));
            this._applyCamera();
        }

        _bindResize() {
            window.addEventListener('resize', () => {
                const w = window.innerWidth, h = window.innerHeight;
                this.renderer.setSize(w, h);
                this.camera.aspect = w / h;
                this.camera.updateProjectionMatrix();
            });
        }

        start() {
            // onConnect runs again after a session recovery; a second render
            // loop would double every frame's work for the rest of the session.
            if (this._raf) return;
            const loop = () => {
                this._raf = requestAnimationFrame(loop);
                this.stepFollow();
                this.renderer.render(this.scene, this.camera);
            };
            loop();
        }

        // Camera target to ease towards each frame, or null to stop following.
        followTo(point) {
            this._followPoint = point ? new THREE.Vector3(point.x, point.y, point.z) : null;
        }

        /**
         * One frame of following: ease the camera target towards the followed
         * player so a jumpy remote cursor does not jerk the whole view around.
         * Returns whether it moved.
         */
        stepFollow() {
            if (!this._followPoint) return false;
            const t = this.target, p = this._followPoint;
            if (t.distanceToSquared(p) <= 0.0004) return false;
            t.lerp(p, 0.10);
            this._applyCamera();
            return true;
        }

        // ---- world model ----
        static key(x, y, z) { return x + ',' + y + ',' + z; }

        inBounds(x, y, z) {
            return x >= -HALF && x <= HALF && z >= -HALF && z <= HALF && y >= 0 && y <= MAX_Y;
        }

        hasBlock(x, y, z) { return this.world.has(VoxelWorld.key(x, y, z)); }

        pieceAt(x, y, z) { return this.pieceOf.get(VoxelWorld.key(x, y, z)) || null; }

        // Geometry for a plain cell: in brick mode a cube becomes a studded 1x1
        // so single blocks and real pieces look like the same toy. The other
        // shapes are not bricks and are left alone.
        _cellGeometry(si) {
            if (si === 0 && this.brickLook) return BlockPartyBricks.geometry(1, 1);
            return this.geometries[si];
        }

        setBrickLook(on) {
            if (this.brickLook === !!on) return;
            this.brickLook = !!on;
            this.meshes.forEach(mesh => {
                if (mesh.userData.si === 0) mesh.geometry = this._cellGeometry(0);
            });
        }

        ownerOf(x, y, z) { return this.owners.get(VoxelWorld.key(x, y, z)); }
        shapeOf(x, y, z) { return this.shapes.get(VoxelWorld.key(x, y, z)) || 0; }

        setBlock(x, y, z, colorIndex, owner, shape) {
            const k = VoxelWorld.key(x, y, z);
            const si = shapeIndex(shape);
            // A cell inside a brick belongs to that brick, not to itself.
            if (this.pieceOf.has(k)) this.deletePiece(this.pieceOf.get(k));
            // Re-placing a block that is already exactly this block changes
            // nothing, so it must not quietly transfer credit for it — in Team
            // Build that would let a tidier-upper take the whole room's work.
            const identical = this.world.get(k) === colorIndex && (this.shapes.get(k) || 0) === si;
            if (owner && !identical) this.owners.set(k, owner);
            if (si) this.shapes.set(k, si); else this.shapes.delete(k);

            // While the x-ray is on, a block's colour shows its owner, so blocks
            // placed during it have to follow the same rule.
            const material = this.xray
                ? this._ownerMaterial(this.owners.get(k))
                : (this.materials[colorIndex] || this.materials[0]);

            const existing = this.meshes.get(k);
            // Same shape → just restyle. Different shape → the geometry changed,
            // so the mesh has to be rebuilt.
            if (existing && existing.userData.si === si) {
                existing.material = material;
                this.world.set(k, colorIndex);
                return;
            }
            if (existing) { this.scene.remove(existing); this.meshes.delete(k); }

            const mesh = new THREE.Mesh(this._cellGeometry(si), material);
            // A studded 1x1 has its origin at the cell corner; the other shapes
            // are centred, hence the half-cell offset.
            if (si === 0 && this.brickLook) mesh.position.set(x, y, z);
            else mesh.position.set(x + 0.5, y + shapeAt(si).cy, z + 0.5);
            mesh.userData = { cx: x, cy: y, cz: z, si };
            this.scene.add(mesh);
            this.meshes.set(k, mesh);
            this.world.set(k, colorIndex);
        }

        // ---- brick pieces ----
        // p = { id, x, y, z, w, d, c, owner }. Anything already standing in the
        // way is cleared first, so a piece landing on top wins the same way a
        // block does.
        setPiece(p) {
            if (this.pieces.has(p.id)) this.deletePiece(p.id);
            const cells = BlockPartyBricks.cellsOf(p.x, p.y, p.z, p.w, p.d);
            cells.forEach(([x, y, z]) => {
                const k = VoxelWorld.key(x, y, z);
                const other = this.pieceOf.get(k);
                if (other) this.deletePiece(other);
                else if (this.world.has(k)) this.deleteBlock(x, y, z);
            });

            const material = this.xray
                ? this._ownerMaterial(p.owner)
                : (this.materials[p.c] || this.materials[0]);
            const mesh = new THREE.Mesh(BlockPartyBricks.geometry(p.w, p.d), material);
            mesh.position.set(p.x, p.y, p.z);
            mesh.userData = { piece: p.id, px: p.x, py: p.y, pz: p.z, pw: p.w, pd: p.d };
            this.scene.add(mesh);

            const keys = [];
            cells.forEach(([x, y, z]) => {
                const k = VoxelWorld.key(x, y, z);
                keys.push(k);
                this.world.set(k, p.c);
                this.shapes.delete(k);                  // brick cells are cubes
                if (p.owner) this.owners.set(k, p.owner);
                this.pieceOf.set(k, p.id);
            });
            this.pieces.set(p.id, Object.assign({}, p, { cells: keys, mesh }));
        }

        deletePiece(id) {
            const piece = this.pieces.get(id);
            if (!piece) return;
            this.scene.remove(piece.mesh);
            piece.cells.forEach(k => {
                this.pieceOf.delete(k);
                this.world.delete(k);
                this.owners.delete(k);
                this.shapes.delete(k);
            });
            this.pieces.delete(id);
        }

        deleteBlock(x, y, z) {
            const k = VoxelWorld.key(x, y, z);
            // Breaking any stud of a brick takes the whole brick off.
            const pieceId = this.pieceOf.get(k);
            if (pieceId) { this.deletePiece(pieceId); return; }
            const mesh = this.meshes.get(k);
            if (mesh) { this.scene.remove(mesh); this.meshes.delete(k); }
            this.world.delete(k);
            this.owners.delete(k);
            this.shapes.delete(k);
        }

        clearAll() {
            this.meshes.forEach(m => this.scene.remove(m));
            this.meshes.clear();
            this.pieces.forEach(p => this.scene.remove(p.mesh));
            this.pieces.clear();
            this.pieceOf.clear();
            this.world.clear();
            this.owners.clear();
            this.shapes.clear();
        }

        count() { return this.world.size; }

        // name -> number of blocks currently standing that this player placed
        countsByOwner() {
            const m = new Map();
            this.owners.forEach((owner, k) => {
                if (owner && this.world.has(k)) m.set(owner, (m.get(owner) || 0) + 1);
            });
            return m;
        }

        // [x, y, z, colorIndex, owner?, shape?] — the tail is optional and only
        // written when it carries information, so rows stay short and worlds
        // saved by older versions (4- and 5-element rows) still load.
        // Cells that stand on their own. Cells belonging to a brick are left to
        // encodePieces, so a saved world reloads as bricks and not as rubble.
        encode() {
            const out = [];
            this.world.forEach((c, k) => {
                if (this.pieceOf.has(k)) return;
                const [x, y, z] = k.split(',').map(Number);
                const owner = this.owners.get(k);
                const si = this.shapes.get(k) || 0;
                if (si) out.push([x, y, z, c, owner || null, si]);
                else if (owner) out.push([x, y, z, c, owner]);
                else out.push([x, y, z, c]);
            });
            return out;
        }

        // [id, x, y, z, w, d, colorIndex, owner]
        encodePieces() {
            const out = [];
            this.pieces.forEach(p => out.push([p.id, p.x, p.y, p.z, p.w, p.d, p.c, p.owner || null]));
            return out;
        }

        replaceFrom(blocks, pieces) {
            this.clearAll();
            if (Array.isArray(pieces)) {
                for (const p of pieces) {
                    if (!p || p.length < 7) continue;
                    const [id, x, y, z, w, d, c, owner] = p;
                    if (this.inBounds(x, y, z)) {
                        this.setPiece({ id, x, y, z, w, d, c, owner: owner || undefined });
                    }
                }
            }
            if (Array.isArray(blocks)) {
                for (const b of blocks) {
                    if (!b || b.length < 4) continue;
                    const [x, y, z, c, owner, si] = b;
                    if (this.inBounds(x, y, z)) this.setBlock(x, y, z, c, owner || undefined, si);
                }
            }
        }

        // ---- picking ----
        // Returns { place:{x,y,z}, remove:{x,y,z} } for the pointer at (clientX,clientY), or null.
        pick(clientX, clientY) {
            const ndc = new THREE.Vector2(
                (clientX / window.innerWidth) * 2 - 1,
                -(clientY / window.innerHeight) * 2 + 1
            );
            this.raycaster.setFromCamera(ndc, this.camera);
            const targets = Array.from(this.meshes.values());
            this.pieces.forEach(p => targets.push(p.mesh));
            targets.push(this.ground);
            const hits = this.raycaster.intersectObjects(targets, false);
            if (!hits.length) return null;

            const hit = hits[0];
            const ud = hit.object.userData || {};
            if (ud.isGround) {
                const x = Math.floor(hit.point.x);
                const z = Math.floor(hit.point.z);
                return { place: { x, y: 0, z }, remove: null };
            }

            const n = hit.face.normal;
            if (ud.piece) {
                // A brick spans several cells, so the cell has to come from where
                // the ray landed: step just inside the surface and floor it. The
                // studs stick up into the cell above, so y is pinned to the piece.
                const inside = hit.point.clone().addScaledVector(n, -0.5);
                const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
                const cell = {
                    x: clamp(Math.floor(inside.x), ud.px, ud.px + ud.pw - 1),
                    y: ud.py,
                    z: clamp(Math.floor(inside.z), ud.pz, ud.pz + ud.pd - 1)
                };
                return {
                    place: { x: cell.x + Math.round(n.x), y: cell.y + Math.round(n.y), z: cell.z + Math.round(n.z) },
                    remove: cell
                };
            }

            const { cx, cy, cz } = ud;
            const place = { x: cx + Math.round(n.x), y: cy + Math.round(n.y), z: cz + Math.round(n.z) };
            return { place, remove: { x: cx, y: cy, z: cz } };
        }

        // Ghost of a whole brick about to be dropped, at its minimum corner.
        showPiecePreview(x, y, z, w, d, colorIndex, blocked) {
            if (!this.piecePreview) {
                this.piecePreview = new THREE.Mesh(
                    BlockPartyBricks.geometry(1, 1), this.ghostMaterials[0]
                );
                this.scene.add(this.piecePreview);
            }
            const p = this.piecePreview;
            p.visible = true;
            p.geometry = BlockPartyBricks.geometry(w, d);
            p.material = blocked ? this._blockedMaterial() : (this.ghostMaterials[colorIndex] || this.ghostMaterials[0]);
            p.position.set(x, y, z);
        }

        hidePiecePreview() { if (this.piecePreview) this.piecePreview.visible = false; }

        _blockedMaterial() {
            if (!this._blockedMat) {
                this._blockedMat = new THREE.MeshLambertMaterial({
                    color: new THREE.Color('#ff5a5f'), transparent: true, opacity: 0.35, depthWrite: false
                });
            }
            return this._blockedMat;
        }

        // ---- local placement preview (my own aim, before I commit an edit) ----
        showPreview(x, y, z, si, colorIndex, erasing) {
            if (!this.preview) {
                const group = new THREE.Group();
                const line = new THREE.LineSegments(
                    this.cursorGeometry, new THREE.LineBasicMaterial({ color: 0xffffff })
                );
                const ghost = new THREE.Mesh(this.geometries[0], this.ghostMaterials[0]);
                group.add(line);
                group.add(ghost);
                this.scene.add(group);
                this.preview = { group, line, ghost };
            }
            const p = this.preview;
            p.group.visible = true;
            p.group.position.set(x + 0.5, y, z + 0.5);
            p.line.position.y = 0.5;
            if (erasing) {
                // Nothing is being added — just ring the doomed cell in red.
                p.ghost.visible = false;
                p.line.material.color.set('#ff5a5f');
            } else {
                const idx = shapeIndex(si);
                p.ghost.visible = true;
                p.ghost.geometry = this.geometries[idx];
                p.ghost.material = this.ghostMaterials[colorIndex] || this.ghostMaterials[0];
                p.ghost.position.y = shapeAt(idx).cy;
                p.line.material.color.set('#ffffff');
            }
        }

        hidePreview() { if (this.preview) this.preview.group.visible = false; }

        // ---- region preview, for the box fill ----
        // One unit-cube wireframe, scaled to the pending box.
        showRegion(a, b, erase) {
            if (!this.region) {
                this.region = new THREE.LineSegments(
                    new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
                    new THREE.LineBasicMaterial({ color: 0x7dd3fc })
                );
                this.scene.add(this.region);
            }
            const lo = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) };
            const hi = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) };
            const w = hi.x - lo.x + 1, h = hi.y - lo.y + 1, d = hi.z - lo.z + 1;
            this.region.visible = true;
            this.region.scale.set(w, h, d);
            this.region.position.set(lo.x + w / 2, lo.y + h / 2, lo.z + d / 2);
            this.region.material.color.set(erase ? '#ff5a5f' : '#7dd3fc');
            return w * h * d;
        }

        hideRegion() { if (this.region) this.region.visible = false; }

        // ---- ownership x-ray: colour every block by who placed it ----
        setOwnerXray(on, colorFor) {
            this.xray = !!on;
            this._xrayColorFor = colorFor || null;
            this.meshes.forEach((mesh, k) => {
                mesh.material = this.xray
                    ? this._ownerMaterial(this.owners.get(k))
                    : (this.materials[this.world.get(k)] || this.materials[0]);
            });
            this.pieces.forEach(p => {
                p.mesh.material = this.xray
                    ? this._ownerMaterial(p.owner)
                    : (this.materials[p.c] || this.materials[0]);
            });
        }

        _ownerMaterial(owner) {
            const hex = (owner && this._xrayColorFor) ? this._xrayColorFor(owner) : '#64748b';
            if (!this._ownerMats) this._ownerMats = new Map();
            let m = this._ownerMats.get(hex);
            if (!m) {
                m = new THREE.MeshLambertMaterial({ color: new THREE.Color(hex) });
                this._ownerMats.set(hex, m);
            }
            return m;
        }

        // Every standing block as a remove row — used to clear the world in one
        // undoable edit.
        allCells() {
            const out = [];
            this.world.forEach((_c, k) => {
                const [x, y, z] = k.split(',').map(Number);
                out.push([x, y, z]);
            });
            return out;
        }

        // ---- match arena: one plot per player ----
        // A plot is a coloured floor pad, a name plaque, and a translucent cover
        // that hides a rival's plot while a round is running.
        setArena(pads) {
            this.clearArena();
            this.arena = new THREE.Group();
            pads.forEach(p => {
                const cx = p.x0 + p.size / 2, cz = p.z0 + p.size / 2;
                const color = new THREE.Color(p.color);
                const group = new THREE.Group();

                const floorGeo = new THREE.PlaneGeometry(p.size, p.size);
                const floor = new THREE.Mesh(floorGeo, new THREE.MeshBasicMaterial({
                    color, transparent: true, opacity: p.mine ? 0.28 : 0.07, depthWrite: false
                }));
                floor.rotation.x = -Math.PI / 2;
                floor.position.set(cx, 0.02, cz);
                group.add(floor);

                const boxGeo = new THREE.BoxGeometry(p.size, 0.04, p.size);
                const edgeGeo = new THREE.EdgesGeometry(boxGeo);
                const border = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color }));
                border.position.set(cx, 0.03, cz);
                group.add(border);

                // The cover reads as a crate you cannot see into: a faint tinted
                // volume with a hard wireframe, rather than a wall of fog.
                const coverGeo = new THREE.BoxGeometry(p.size, PLOT_COVER_H, p.size);
                const coverEdgeGeo = new THREE.EdgesGeometry(coverGeo);
                const cover = new THREE.Group();
                const coverBox = new THREE.Mesh(coverGeo, new THREE.MeshLambertMaterial({
                    color, transparent: true, opacity: 0.09, depthWrite: false
                }));
                const coverWire = new THREE.LineSegments(coverEdgeGeo, new THREE.LineBasicMaterial({
                    color, transparent: true, opacity: 0.5
                }));
                cover.add(coverBox);
                cover.add(coverWire);
                cover.position.set(cx, PLOT_COVER_H / 2, cz);
                cover.visible = false;
                group.add(cover);

                const label = this._makeLabelSprite(p.name, p.color);
                label.position.set(cx, PLOT_COVER_H + 1.4, cz);
                group.add(label);

                this.arena.add(group);
                this.pads.set(p.name, {
                    group, cover, label, color: p.color, text: p.name, cx, cz,
                    geos: [floorGeo, boxGeo, edgeGeo, coverGeo, coverEdgeGeo]
                });
            });
            this.scene.add(this.arena);
        }

        setPadLabel(name, text) {
            const pad = this.pads.get(name);
            if (!pad || pad.text === text) return;
            pad.group.remove(pad.label);
            this._disposeLabel(pad.label);
            pad.label = this._makeLabelSprite(text, pad.color);
            pad.label.position.set(pad.cx, PLOT_COVER_H + 1.4, pad.cz);
            pad.group.add(pad.label);
            pad.text = text;
        }

        setCover(name, visible) {
            const pad = this.pads.get(name);
            if (pad) pad.cover.visible = !!visible;
        }

        clearArena() {
            if (this.arena) this.scene.remove(this.arena);
            this.pads.forEach(pad => {
                this._disposeLabel(pad.label);
                pad.geos.forEach(g => { try { g.dispose(); } catch (e) { /* ignore */ } });
            });
            this.pads.clear();
            this.arena = null;
        }

        // ---- blueprint ghosts ----
        // Shared geometries/materials, so a group only owns its meshes.
        showGhost(id, cells, ox, oz, strong) {
            this.hideGhost(id);
            const mats = strong ? this.blueprintMaterials : this.ghostMaterials;
            const group = new THREE.Group();
            cells.forEach(c => {
                const si = shapeIndex(c.s);
                const mesh = new THREE.Mesh(this.geometries[si], mats[c.c] || mats[0]);
                mesh.position.set(ox + c.x + 0.5, c.y + shapeAt(si).cy, oz + c.z + 0.5);
                group.add(mesh);
            });
            this.scene.add(group);
            this.ghostGroups.set(id, group);
        }

        hideGhost(id) {
            const g = this.ghostGroups.get(id);
            if (!g) return;
            this.scene.remove(g);
            this.ghostGroups.delete(id);
        }

        clearGhosts() {
            this.ghostGroups.forEach(g => this.scene.remove(g));
            this.ghostGroups.clear();
        }

        // ---- region queries, for scoring and reveals ----
        // Rows are [x, y, z, colorIndex, shapeIndex] relative to (ox, oz).
        cellsInBox(box, ox, oz) {
            const out = [];
            this.world.forEach((c, k) => {
                const [x, y, z] = k.split(',').map(Number);
                if (x < box.x0 || x > box.x1 || z < box.z0 || z > box.z1) return;
                if (y < box.y0 || y > box.y1) return;
                out.push([x - ox, y, z - oz, c, this.shapes.get(k) || 0]);
            });
            return out;
        }

        paintCells(cells, ox, oz, owner) {
            (cells || []).forEach(a => {
                const x = a[0] + ox, y = a[1], z = a[2] + oz;
                if (this.inBounds(x, y, z)) this.setBlock(x, y, z, a[3], owner, a[4] | 0);
            });
        }

        // ---- remote cursors: where each other player is aiming, and who they are ----
        setRemoteCursor(peerId, info) {
            info = info || {};
            const color = info.color || '#ffffff';
            const name = info.name || peerId;
            const si = shapeIndex(info.shape);
            const erasing = info.tool === 'erase';

            let rec = this.remoteCursors.get(peerId);
            if (!rec) {
                const group = new THREE.Group();
                const line = new THREE.LineSegments(
                    this.cursorGeometry, new THREE.LineBasicMaterial({ color: new THREE.Color(color) })
                );
                const ghost = new THREE.Mesh(this.geometries[si], this._ghostMaterialFor(color));
                const label = this._makeLabelSprite(name, color);
                group.add(line); group.add(ghost); group.add(label);
                this.scene.add(group);
                rec = { group, line, ghost, label, name, color };
                this.remoteCursors.set(peerId, rec);
            }

            // Rebuild the label only when the identity it shows actually changes.
            if (rec.name !== name || rec.color !== color) {
                rec.group.remove(rec.label);
                this._disposeLabel(rec.label);
                rec.label = this._makeLabelSprite(name, color);
                rec.group.add(rec.label);
                rec.name = name;
                rec.color = color;
                rec.ghost.material = this._ghostMaterialFor(color);
            }

            rec.group.visible = true;
            rec.group.position.set(info.x + 0.5, info.y, info.z + 0.5);
            rec.line.position.y = 0.5;
            rec.line.material.color.set(erasing ? '#ff5a5f' : color);
            rec.label.position.y = 1.55;
            // Show the exact shape they are about to drop, so you can read intent.
            rec.ghost.visible = !erasing;
            rec.ghost.geometry = this.geometries[si];
            rec.ghost.position.y = shapeAt(si).cy;
        }

        // Peer is still here but has nothing under their pointer.
        hideRemoteCursor(peerId) {
            const rec = this.remoteCursors.get(peerId);
            if (rec) rec.group.visible = false;
        }

        removeRemoteCursor(peerId) {
            const rec = this.remoteCursors.get(peerId);
            if (!rec) return;
            this.scene.remove(rec.group);
            this._disposeLabel(rec.label);
            this.remoteCursors.delete(peerId);
        }

        _ghostMaterialFor(hexColor) {
            if (!this._remoteGhostMats) this._remoteGhostMats = new Map();
            let m = this._remoteGhostMats.get(hexColor);
            if (!m) {
                m = new THREE.MeshLambertMaterial({
                    color: new THREE.Color(hexColor), transparent: true, opacity: 0.35, depthWrite: false
                });
                this._remoteGhostMats.set(hexColor, m);
            }
            return m;
        }

        // A name pill drawn to a canvas and shown as a sprite, so it always faces
        // the camera. depthTest:false keeps it readable even behind other blocks.
        _makeLabelSprite(text, hexColor) {
            const FONT = 'bold 30px system-ui, -apple-system, "Segoe UI", sans-serif';
            const padX = 16, padY = 10, dot = 12, gap = 9;
            const canvas = document.createElement('canvas');
            let ctx = canvas.getContext('2d');
            ctx.font = FONT;
            const textW = Math.ceil(ctx.measureText(String(text)).width);
            canvas.width = padX * 2 + dot + gap + textW;
            canvas.height = 30 + padY * 2;

            ctx = canvas.getContext('2d');   // resizing resets the context state
            ctx.font = FONT;
            ctx.fillStyle = 'rgba(8, 12, 24, 0.82)';
            const r = canvas.height / 2;
            if (typeof ctx.roundRect === 'function') {
                ctx.beginPath(); ctx.roundRect(0, 0, canvas.width, canvas.height, r); ctx.fill();
            } else {
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }
            ctx.fillStyle = hexColor;
            ctx.beginPath();
            ctx.arc(padX + dot / 2, canvas.height / 2, dot / 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(text), padX + dot + gap, canvas.height / 2 + 1);

            const tex = new THREE.CanvasTexture(canvas);
            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
                map: tex, transparent: true, depthTest: false
            }));
            const S = 0.022;   // world units per canvas px
            sprite.scale.set(canvas.width * S, canvas.height * S, 1);
            sprite.renderOrder = 10;
            return sprite;
        }

        _disposeLabel(sprite) {
            if (!sprite) return;
            try {
                if (sprite.material.map) sprite.material.map.dispose();
                sprite.material.dispose();
            } catch (e) { /* nothing worth failing a frame over */ }
        }
    }

    // =========================================================
    // Networked game
    // =========================================================
    class BlockPartyGame extends UserConnectionBase {
        constructor() {
            super({
                storagePrefix: 'blockparty_',
                customType: 'blockparty',
                autoCreateDataChannel: true,
                dataChannelName: 'blockparty-data',
                dataChannelOptions: { ordered: true }   // reliable, ordered — never drop an edit
            });

            this.voxels = null;
            this.modes = null;              // match state machine (modes.js)
            this.stats = null;              // this room's running record
            this.currentColor = 0;
            this.currentShape = 0;          // index into SHAPES
            this.tool = 'build';            // 'build' | 'erase'
            this.brickMode = true;          // build with LEGO-style brick pieces
            this.currentBrick = '2x4';      // footprint from bricks.js
            this.brickRotated = false;      // swaps the footprint's w and d
            this.fillMode = false;          // box fill/clear rides on the tool
            this.fillAnchor = null;         // first corner, once tapped
            this.mirror = false;            // place a mirrored twin of each edit
            this.xray = false;              // colour blocks by who placed them
            this.worldLocked = false;       // host made the sandbox view-only
            this.following = null;          // player whose cursor the camera trails
            this.undoStack = [];            // inverse edits of my own actions
            this.redoStack = [];            // edits taken back off the undo stack
            this._saveTimer = null;
            this._lastCursorSent = 0;
            this._lastPointer = null;       // last hover position, for preview refreshes
        }

        // ---------- lifecycle ----------
        async onInitialize() {
            this.voxels = new VoxelWorld(document.getElementById('sceneRoot'));
            this.modes = new BlockPartyModes.ModeController(this);
            this._buildPalette();
            this._buildShapes();
            this._buildBricks();
            try {
                const saved = localStorage.getItem('blockparty_bricks');
                if (saved !== null) this.brickMode = saved === '1';
            } catch (e) { /* private mode, keep the default */ }
            this.voxels.setBrickLook(this.brickMode);
            this._bindUI();
            this._bindMatchUI();
            this._bindWorldUI();
            this._bindChat();
            this._bindPointer();
            this._syncHistoryButtons();
            this._syncTool();
        }

        onConnect(detail) {
            // Reveal the game, hide the connection modal
            const container = document.getElementById('gameContainer');
            container.classList.remove('hidden');
            if (window.ConnectionModal && typeof window.ConnectionModal.hide === 'function') {
                window.ConnectionModal.hide();
            }

            document.getElementById('roomBadge').textContent = this.channelName || '';
            this._setConnected(true);
            this._hideReconnect();

            this.voxels.start();
            this._refreshPlayers();
            this._updateBlockCount();

            // Load whatever was persisted (works even if we're the only/first player)
            this._loadWorldFromStorage();
            this._startSessionKeepAlive();

            this.showToast('Connected — start building! 🧱', 'success', 2500);
        }

        onDataChannelOpen(peerId) {
            if (this.isHost()) {
                // Bring the newcomer's world in sync with ours
                this._sendWorldSnapshot();
            } else {
                // Ask the host for the authoritative world
                this.sendData({ type: 'requestWorld' });
            }
            this._refreshPlayers();
        }

        onDataChannelClose(peerId) {
            this.voxels.removeRemoteCursor(peerId);
            this._refreshPlayers();
        }

        onUserJoining(detail) {
            this.showToast(`${detail.agentName} is joining…`, 'info', 1800);
        }

        onUserJoin(detail) {
            this.showToast(`${detail.agentName} joined`, 'info', 1800);
            if (this.isHost()) this._sendWorldSnapshot();
            this._refreshPlayers();
            if (this.modes) this.modes.onPlayersChanged();
        }

        onUserLeave(detail) {
            this.voxels.removeRemoteCursor(detail.agentName);
            this.showToast(`${detail.agentName} left`, 'warning', 1800);
            this._refreshPlayers();
            if (this.modes) this.modes.onPlayersChanged();
        }

        onBecomeHost() {
            this.showToast('You are now the room host', 'info', 2200);
            this._refreshPlayers();
            this._scheduleSave(); // take ownership of persistence
            if (this.modes) this.modes.onBecomeHost();
        }

        onLoseHost() {
            this._refreshPlayers();
        }

        onDisconnect() {
            this._stopSessionKeepAlive();
            this._setConnected(false);
            this._showReconnect('Connection lost — reconnecting…');
        }

        onSessionPaused() {
            this._setConnected(false);
            this._showReconnect('Reconnecting…');
        }

        onSessionResumed() {
            this._setConnected(true);
            this._hideReconnect();
            this.showToast('Reconnected', 'success', 1800);
            // Pull the authoritative world back in case we missed edits while away
            if (!this.isHost()) this.sendData({ type: 'requestWorld' });
            else this._sendWorldSnapshot();
            this._refreshPlayers();
        }

        onDataChannelMessage(peerId, data) {
            if (!data || !data.type) return;
            // A match replaces the shared world with private plots, so sandbox
            // traffic that is still in flight must not touch it.
            // In a race, a rival's aim would give their hidden build away, so
            // edits and cursors are dropped. Charades relays both on purpose —
            // the room is meant to watch the builder work.
            const inMatch = this.modes && this.modes.isMatchActive();
            const live = inMatch && this.modes.relaysEdits();
            if (inMatch && !live && (data.type === 'edit' || data.type === 'cursor')) return;
            if (inMatch && (data.type === 'world' || data.type === 'requestWorld')) return;
            switch (data.type) {
                case 'mode':
                    this.modes.handleMessage(peerId, data);
                    break;
                case 'chat':
                    // Relaying, muting and rendering are the component's job.
                    this.chat.handleMessage(peerId, data);
                    break;
                case 'edit': {
                    // The host decides who may edit; everyone else applies only
                    // what the host has passed on. Without that second half, the
                    // base class's own client-to-client relay would let an edit
                    // land on other screens without the host ever agreeing.
                    const by = data._fromClient || peerId;
                    if (!this.isHost() && !this._fromHost(peerId, data)) break;
                    if (this.isHost() && inMatch && !this.modes.canRelayEditFrom(by)) break;
                    this._applyEdit(data.edit);
                    this._updateBlockCount();
                    if (this.isHost()) {
                        // Relay client edits out to everyone else; persist.
                        this.sendData({ type: 'edit', edit: data.edit });
                        this._scheduleSave();
                    }
                    break;
                }
                case 'world':
                    this.voxels.replaceFrom(data.blocks, data.pieces);
                    // The snapshot carries the lock so a late joiner learns the
                    // room is read-only without a separate round trip.
                    if (typeof data.locked === 'boolean') this._setWorldLocked(data.locked);
                    this._updateBlockCount();
                    if (this.xray) this.voxels.setOwnerXray(true, (n) => this.generateUserColor(n));
                    break;
                case 'requestWorld':
                    if (this.isHost()) this._sendWorldSnapshot();
                    break;
                case 'lock':
                    this._setWorldLocked(!!data.locked, data.by);
                    break;
                case 'stats':
                    this.stats = data.stats || null;
                    this._renderLeaderboard();
                    break;
                case 'cursor':
                    // The host is the room's relay for these now.
                    if (this.isHost() && !data._fromHost) this.sendData(data);
                    else if (!this.isHost() && !this._fromHost(peerId, data)) break;
                    if (data.hide) { this.voxels.hideRemoteCursor(peerId); break; }
                    this.voxels.setRemoteCursor(peerId, {
                        x: data.x, y: data.y, z: data.z,
                        color: data.color, name: data.name, shape: data.shape, tool: data.tool
                    });
                    // Keep the camera on whoever this player is following.
                    if (this.following && data.name === this.following) {
                        this.voxels.followTo({ x: data.x + 0.5, y: data.y + 1.5, z: data.z + 0.5 });
                    }
                    break;
            }
        }

        // ---------- edits ----------
        // Three actions travel the wire: place, remove, and bulk (a fill, a
        // mirrored pair, or the inverse of either). Bulk rows are
        // [x, y, z, colorIndex, shapeIndex, owner?] — the owner is only written
        // when restoring somebody else's block, otherwise edit.o applies.
        _applyEdit(edit) {
            if (!edit) return;
            if (edit.a === 'place' && this.voxels.inBounds(edit.x, edit.y, edit.z)) {
                // edit.o = the player who placed it, so per-player counts stay
                // correct no matter which peer applied the edit. edit.s = shape.
                this.voxels.setBlock(edit.x, edit.y, edit.z, edit.c, edit.o, edit.s);
            } else if (edit.a === 'remove') {
                this.voxels.deleteBlock(edit.x, edit.y, edit.z);
            } else if (edit.a === 'bulk') {
                // Removals first: a fill over an existing region is a clear
                // followed by a build, and the two lists may overlap.
                (edit.delPieces || []).forEach(id => this.voxels.deletePiece(id));
                (edit.remove || []).forEach(r => this.voxels.deleteBlock(r[0], r[1], r[2]));
                (edit.addPieces || []).forEach(p => {
                    if (this.voxels.inBounds(p[1], p[2], p[3])) {
                        this.voxels.setPiece({
                            id: p[0], x: p[1], y: p[2], z: p[3],
                            w: p[4], d: p[5], c: p[6], owner: p[7] || edit.o
                        });
                    }
                });
                (edit.place || []).forEach(p => {
                    if (this.voxels.inBounds(p[0], p[1], p[2])) {
                        this.voxels.setBlock(p[0], p[1], p[2], p[3], p[5] || edit.o, p[4]);
                    }
                });
            }
        }

        _pieceRow(p) { return [p.id, p.x, p.y, p.z, p.w, p.d, p.c, p.owner || null]; }

        // What the world looks like at a cell right now, as a bulk row.
        _cellRow(x, y, z) {
            const k = VoxelWorld.key(x, y, z);
            if (!this.voxels.world.has(k)) return null;
            return [x, y, z, this.voxels.world.get(k), this.voxels.shapeOf(x, y, z), this.voxels.ownerOf(x, y, z)];
        }

        /**
         * The edit that would put the world back exactly as it is now, if the
         * given edit were applied. Undo and redo are both built from this, so
         * they need no separate bookkeeping — and it works the same for a single
         * block or a thousand-cell fill.
         */
        _inverseOf(edit) {
            if (!edit) return null;
            if (edit.a === 'place' || edit.a === 'remove') {
                const row = this._cellRow(edit.x, edit.y, edit.z);
                if (row) return { a: 'place', x: row[0], y: row[1], z: row[2], c: row[3], s: row[4], o: row[5] };
                return edit.a === 'place' ? { a: 'remove', x: edit.x, y: edit.y, z: edit.z } : null;
            }
            if (edit.a === 'bulk') {
                // Every cell this edit will disturb, including the footprints of
                // bricks it adds and the cells of bricks it removes.
                const cells = new Set();
                const add = (x, y, z) => cells.add(x + ',' + y + ',' + z);
                (edit.place || []).forEach(p => add(p[0], p[1], p[2]));
                (edit.remove || []).forEach(r => add(r[0], r[1], r[2]));
                (edit.addPieces || []).forEach(p => {
                    BlockPartyBricks.cellsOf(p[1], p[2], p[3], p[4], p[5]).forEach(c => add(c[0], c[1], c[2]));
                });
                (edit.delPieces || []).forEach(id => {
                    const piece = this.voxels.pieces.get(id);
                    if (piece) piece.cells.forEach(k => cells.add(k));
                });

                // A brick is restored whole, so any brick that overlaps the
                // disturbed area is put back in full — and its cells are then
                // not the business of the plain place/remove lists.
                const pieceIds = new Set();
                cells.forEach(k => {
                    const id = this.voxels.pieceOf.get(k);
                    if (id) pieceIds.add(id);
                });
                const addPieces = [], covered = new Set();
                pieceIds.forEach(id => {
                    const piece = this.voxels.pieces.get(id);
                    if (!piece) return;
                    addPieces.push(this._pieceRow(piece));
                    piece.cells.forEach(k => covered.add(k));
                });
                const delPieces = (edit.addPieces || []).map(p => p[0]);

                const place = [], remove = [];
                cells.forEach(k => {
                    if (covered.has(k)) return;
                    const [x, y, z] = k.split(',').map(Number);
                    const row = this._cellRow(x, y, z);
                    if (row) place.push(row); else remove.push([x, y, z]);
                });

                if (!place.length && !remove.length && !addPieces.length && !delPieces.length) return null;
                return { a: 'bulk', place, remove, addPieces, delPieces };
            }
            return null;
        }

        // Local action from this player: apply, record undo, broadcast, persist.
        _doLocalEdit(edit) {
            const inverse = this._inverseOf(edit);
            this._applyEdit(edit);
            this._updateBlockCount();
            if (inverse) {
                this.undoStack.push(inverse);
                if (this.undoStack.length > 100) this.undoStack.shift();
                this.redoStack.length = 0;      // a new edit forks the timeline
                this._syncHistoryButtons();
            }
            this._broadcastEdit(edit);
            if (this.modes) this.modes.onLocalEdit();
            if (window.GameKit && window.GameKit.Sfx) {
                edit.a === 'remove' ? null : (GameKit.Sfx.tick && GameKit.Sfx.tick());
            }
        }

        /**
         * Send something to the host and nobody else.
         *
         * A plain sendData() from a client is auto-relayed to the whole room by
         * UserConnectionBase before this app gets a look at it. Anything the
         * host is supposed to police — or keep to itself — has to be addressed
         * to the host directly. Returns false if I am the host, since then there
         * is nothing to send and the caller should act locally.
         */
        /**
         * Did the host's game actually send this, or did its base class merely
         * pass a client's message along?
         *
         * Both arrive over the host's data channel, so the sender is no help.
         * The tell is _fromClient: UserConnectionBase stamps it on every message
         * it auto-relays, while a broadcast the host's own code made carries
         * _fromHost. A targeted host message (the charades word) has neither, so
         * it is recognised by coming straight from the host with no client name
         * attached.
         */
        _fromHost(peerId, data) {
            if (data && data._fromHost) return true;
            if (data && data._fromClient) return false;
            const host = this._hostName();
            return !!host && peerId === host;
        }

        sendToHost(payload) {
            if (this.isHost()) return false;
            const host = this._hostName();
            if (!host) return false;
            this.sendData(payload, host);
            return true;
        }

        _broadcastEdit(edit) {
            // In a match with secret builds this edit stays on this client; the
            // finished build is submitted to the host at the end of the round.
            if (this.modes && !this.modes.shouldBroadcastEdit()) return;
            // A big fill would exceed the safe data-channel message size, so it
            // goes out as several bulk edits. Each is valid on its own because
            // the two lists never name the same cell: a fill either places or
            // removes, and _inverseOf assigns every touched cell to one list.
            const out = (payload) => {
                if (!this.sendToHost(payload)) this.sendData(payload);
            };
            if (edit.a === 'bulk') {
                const place = edit.place || [], remove = edit.remove || [];
                const addPieces = edit.addPieces || [], delPieces = edit.delPieces || [];
                const span = Math.max(place.length, remove.length, addPieces.length, delPieces.length, 1);
                for (let i = 0; i < span; i += BULK_CHUNK) {
                    out({
                        type: 'edit',
                        edit: {
                            a: 'bulk', o: edit.o,
                            place: place.slice(i, i + BULK_CHUNK),
                            remove: remove.slice(i, i + BULK_CHUNK),
                            addPieces: addPieces.slice(i, i + BULK_CHUNK),
                            delPieces: delPieces.slice(i, i + BULK_CHUNK)
                        }
                    });
                }
            } else {
                out({ type: 'edit', edit });
            }
            if (this.isHost()) this._scheduleSave();
        }

        /**
         * May this player change this cell? The world lock is the room's rule
         * and the mode's rules are the round's; `quiet` skips the explanation
         * so a fill can test a thousand cells without a thousand toasts.
         */
        _canEditCell(x, y, z, quiet) {
            if (!this.voxels.inBounds(x, y, z)) return false;
            if (this.worldLocked && !this.isHost() && !(this.modes && this.modes.isMatchActive())) {
                if (!quiet) this._denyOnce('🔒 The host locked the world');
                return false;
            }
            if (!this.modes) return true;
            return quiet ? this.modes.allows(x, y, z) : this.modes.canEdit(x, y, z);
        }

        _denyOnce(message) {
            const now = Date.now();
            if (now - (this._lastDeny || 0) < 2500) return;
            this._lastDeny = now;
            this.showToast(message, 'warning', 1800);
        }

        // Mirror a cell across the middle of the area being built in: your plot
        // during a match, the world otherwise.
        _mirrorOf(x, z) {
            const area = this.buildArea();
            return { x: Math.round(2 * area.cx - x - 1), z };
        }

        // { cx, cz } — the centre the mirror reflects around.
        buildArea() {
            const plot = this.modes && this.modes.myPlot;
            if (plot) return { cx: plot.x0 + plot.size / 2, cz: plot.z0 + plot.size / 2 };
            return { cx: 0.5, cz: 0.5 };
        }

        // The footprint of the brick about to be placed, at anchor (x, z).
        pieceFootprint() {
            const brick = BlockPartyBricks.byId(this.currentBrick);
            return BlockPartyBricks.footprint(brick, this.brickRotated);
        }

        // Where a brick may not go: off the grid, out of my plot, or on top of
        // something already standing. Returns the blocking reason, or null.
        pieceBlocked(x, y, z, w, d) {
            const cells = BlockPartyBricks.cellsOf(x, y, z, w, d);
            for (const [cx, cy, cz] of cells) {
                if (!this.voxels.inBounds(cx, cy, cz)) return 'off the board';
                if (!this._canEditCell(cx, cy, cz, true)) return 'out of your area';
                if (this.voxels.hasBlock(cx, cy, cz)) return 'something is in the way';
            }
            return null;
        }

        placeBrickAt(x, y, z) {
            const { w, d } = this.pieceFootprint();
            const blocked = this.pieceBlocked(x, y, z, w, d);
            if (blocked) {
                // The mode's own refusal is more informative than "in the way".
                if (blocked === 'out of your area') this._canEditCell(x, y, z);
                else this._denyOnce(`That brick does not fit — ${blocked}`);
                return;
            }
            const mk = (px, pz) => [
                BlockPartyBricks.newId(this.username), px, y, pz, w, d, this.currentColor, this.username
            ];
            const pieces = [mk(x, z)];
            if (this.mirror) {
                // Mirror the whole footprint, not just its corner, or a wide
                // brick would land offset from its twin.
                const area = this.buildArea();
                const mx = Math.round(2 * area.cx - x - w);
                if (mx !== x && !this.pieceBlocked(mx, y, z, w, d)) pieces.push(mk(mx, z));
            }
            this._doLocalEdit({ a: 'bulk', o: this.username, addPieces: pieces });
        }

        placeAt(x, y, z) {
            if (this.brickMode) { this.placeBrickAt(x, y, z); return; }
            if (!this._canEditCell(x, y, z)) return;
            const cells = [[x, y, z]];
            if (this.mirror) {
                const m = this._mirrorOf(x, z);
                if ((m.x !== x || m.z !== z) && this._canEditCell(m.x, y, m.z, true)) cells.push([m.x, y, m.z]);
            }
            if (cells.length === 1) {
                this._doLocalEdit({ a: 'place', x, y, z, c: this.currentColor, o: this.username, s: this.currentShape });
            } else {
                this._doLocalEdit({
                    a: 'bulk', o: this.username,
                    place: cells.map(c => [c[0], c[1], c[2], this.currentColor, this.currentShape])
                });
            }
        }

        removeAt(x, y, z) {
            if (!this.voxels.hasBlock(x, y, z)) return;
            if (!this._canEditCell(x, y, z)) return;

            // Breaking one stud of a brick takes the brick off, mirrored twin
            // included if the mirror is on.
            const pieceId = this.voxels.pieceAt(x, y, z);
            if (pieceId) {
                const ids = [pieceId];
                if (this.mirror) {
                    const piece = this.voxels.pieces.get(pieceId);
                    const area = this.buildArea();
                    const mx = Math.round(2 * area.cx - piece.x - piece.w);
                    const twin = this.voxels.pieceAt(mx, piece.y, piece.z);
                    if (twin && twin !== pieceId) ids.push(twin);
                }
                this._doLocalEdit({ a: 'bulk', o: this.username, delPieces: ids });
                return;
            }

            const cells = [[x, y, z]];
            if (this.mirror) {
                const m = this._mirrorOf(x, z);
                if ((m.x !== x || m.z !== z) && this.voxels.hasBlock(m.x, y, m.z)
                    && this._canEditCell(m.x, y, m.z, true)) cells.push([m.x, y, m.z]);
            }
            if (cells.length === 1) this._doLocalEdit({ a: 'remove', x, y, z });
            else this._doLocalEdit({ a: 'bulk', o: this.username, remove: cells });
        }

        /**
         * Fill (or clear) the box between two cells. Erase decides which:
         * the Fill toggle rides on top of whichever tool is active.
         */
        fillRegion(a, b, erase) {
            const lo = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) };
            const hi = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) };
            const volume = (hi.x - lo.x + 1) * (hi.y - lo.y + 1) * (hi.z - lo.z + 1);
            if (volume > MAX_FILL_CELLS) {
                this.showToast(`That region is too big (${volume} cells, max ${MAX_FILL_CELLS})`, 'warning', 2600);
                return 0;
            }

            const place = [], remove = [];
            let blocked = 0;
            for (let x = lo.x; x <= hi.x; x++) {
                for (let y = lo.y; y <= hi.y; y++) {
                    for (let z = lo.z; z <= hi.z; z++) {
                        if (!this._canEditCell(x, y, z, true)) { blocked++; continue; }
                        if (erase) {
                            if (this.voxels.hasBlock(x, y, z)) remove.push([x, y, z]);
                        } else {
                            place.push([x, y, z, this.currentColor, this.currentShape]);
                        }
                    }
                }
            }
            if (!place.length && !remove.length) {
                this._canEditCell(lo.x, lo.y, lo.z);    // let it explain why
                if (!blocked) this.showToast(erase ? 'No blocks to clear there' : 'Nothing to fill there', 'info', 1400);
                return 0;
            }
            this._doLocalEdit({ a: 'bulk', o: this.username, place, remove });
            const n = place.length + remove.length;
            this.showToast(`${erase ? 'Cleared' : 'Filled'} ${n} block${n === 1 ? '' : 's'}`
                + (blocked ? ` (${blocked} out of reach)` : ''), 'success', 1800);
            return n;
        }

        undo() { this._timeTravel(this.undoStack, this.redoStack, 'undo'); }
        redo() { this._timeTravel(this.redoStack, this.undoStack, 'redo'); }

        // Undo and redo are the same move in opposite directions: take the edit
        // off one stack, record its inverse on the other, and apply it.
        _timeTravel(from, to, label) {
            const next = from[from.length - 1];
            if (!next) { this.showToast(`Nothing to ${label}`, 'info', 1200); return; }
            const probe = next.a === 'bulk'
                ? ((next.place && next.place[0]) || (next.remove && next.remove[0]) || [0, 0, 0])
                : [next.x, next.y, next.z];
            // Time travel is editing too — the match and lock rules still apply.
            if (!this._canEditCell(probe[0], probe[1], probe[2])) return;

            const edit = from.pop();
            const inverse = this._inverseOf(edit);
            this._applyEdit(edit);
            this._updateBlockCount();
            if (inverse) to.push(inverse);
            this._syncHistoryButtons();
            this._broadcastEdit(edit);
            if (this.modes) this.modes.onLocalEdit();
        }

        _syncHistoryButtons() {
            const undoBtn = document.getElementById('undoBtn');
            const redoBtn = document.getElementById('redoBtn');
            if (undoBtn) undoBtn.classList.toggle('disabled', this.undoStack.length === 0);
            if (redoBtn) redoBtn.classList.toggle('disabled', this.redoStack.length === 0);
        }

        // ---------- persistence ----------
        _scheduleSave() {
            if (!this.isHost()) return;
            if (this.modes && this.modes.isMatchActive()) return;   // the arena is not the sandbox
            clearTimeout(this._saveTimer);
            this._saveTimer = setTimeout(() => this._saveWorld(), SAVE_DEBOUNCE_MS);
        }

        _saveWorld() {
            if (!this.isHost() || !this.channel || typeof this.channel.storagePut !== 'function') return;
            try {
                const snap = this.snapshotWorld();
                const payload = {
                    storageKey: STORAGE_KEY,
                    content: { v: 2, blocks: snap.blocks, pieces: snap.pieces },
                    encrypted: false,
                    metadata: { description: 'BlockParty voxel world', blocks: this.voxels.count() }
                };
                this._storage(
                    (cb) => this.channel.storagePut(payload, cb),
                    (res) => {
                        if (res && res.status !== 'success') {
                            console.warn('[BlockParty] world save failed:', res.statusMessage);
                            // Silence would let a room build for an hour on top
                            // of a world that is not being saved.
                            this._denyOnce('⚠️ The world could not be saved — ' + (res.statusMessage || 'storage error'));
                        }
                    });
            } catch (e) {
                console.warn('[BlockParty] world save error:', e.message);
            }
        }

        _loadWorldFromStorage() {
            if (this.modes && this.modes.isMatchActive()) return;
            if (!this.channel || typeof this.channel.storageGet !== 'function') return;
            try {
                this._storage((cb) => this.channel.storageGet({ storageKey: STORAGE_KEY }, cb), (res) => {
                    // A match may have started while this round-trip was in
                    // flight — the arena must not be overwritten.
                    if (this.modes && this.modes.isMatchActive()) return;
                    if (res && res.status === 'success' && res.data) {
                        const saved = res.data.content || res.data;
                        const blocks = saved.blocks, pieces = saved.pieces;
                        const any = (Array.isArray(blocks) && blocks.length)
                            || (Array.isArray(pieces) && pieces.length);
                        if (any && this.voxels.count() === 0) {
                            this.restoreWorldFrom({ blocks, pieces });
                            this._updateBlockCount();
                        }
                    }
                });
            } catch (e) {
                console.warn('[BlockParty] world load error:', e.message);
            }
        }

        // Everything standing, in both flavours: loose cells and brick pieces.
        snapshotWorld() {
            return { blocks: this.voxels.encode(), pieces: this.voxels.encodePieces() };
        }

        restoreWorldFrom(snap) {
            if (!snap) return;
            this.voxels.replaceFrom(snap.blocks, snap.pieces);
            if (this.xray) this.voxels.setOwnerXray(true, (n) => this.generateUserColor(n));
        }

        _sendWorldSnapshot() {
            // Never ship the arena out as if it were the shared world.
            if (this.modes && this.modes.isMatchActive()) return;
            const snap = this.snapshotWorld();
            this.sendData({ type: 'world', blocks: snap.blocks, pieces: snap.pieces, locked: this.worldLocked });
        }

        // ---------- session keep-alive ----------
        // /list-agents refreshes the session's TTL as a side effect and returns
        // the player list, so this doubles as a slow presence refresh.
        _startSessionKeepAlive() {
            this._stopSessionKeepAlive();
            this._keepAliveTimer = setInterval(() => this._touchSession(), SESSION_KEEPALIVE_MS);
            if (!this._visibilityBound) {
                // A backgrounded tab has its timers throttled and a sleeping
                // laptop stops them altogether, so touch the session the moment
                // the page is looked at again.
                this._visibilityBound = true;
                document.addEventListener('visibilitychange', () => {
                    if (!document.hidden) this._touchSession();
                });
            }
        }

        _touchSession() {
            if (!this.connected || !this.channel || typeof this.channel.getActiveAgents !== 'function') return;
            try {
                this.channel.getActiveAgents(() => this._refreshPlayers());
            } catch (e) {
                console.warn('[BlockParty] keep-alive failed:', e.message);
            }
        }

        _stopSessionKeepAlive() {
            clearInterval(this._keepAliveTimer);
            this._keepAliveTimer = null;
        }

        // ---------- storage, with session recovery ----------
        // The platform drops a session that has not been heard from in 180s.
        // BlockParty talks over WebRTC, so that can happen mid-session and every
        // storage call then fails with "Invalid session ID". Prevention is the
        // keep-alive above; this is what happens when prevention is not enough.
        _isDeadSession(res) {
            if (!res) return false;
            const msg = res.statusMessage || (typeof res.data === 'string' ? res.data : '') || '';
            return /invalid session/i.test(String(msg));
        }

        /**
         * Run a storage operation; if the session turns out to be dead, rebuild
         * it and run the operation once more. `op` receives the callback to hand
         * to the storage API, and is re-invoked on retry so it picks up the new
         * channel object.
         */
        _storage(op, done) {
            const attempt = (isRetry) => {
                try {
                    op((res) => {
                        if (!isRetry && this._isDeadSession(res)) {
                            this._recoverSession().then(ok => {
                                if (ok) attempt(true); else done(res);
                            });
                            return;
                        }
                        done(res);
                    });
                } catch (e) {
                    done({ status: 'error', statusMessage: e.message });
                }
            };
            attempt(false);
        }

        _recoverSession() {
            if (this._recovering) return this._recovering;
            this.showToast('Session expired — reconnecting…', 'warning', 2500);
            this._showReconnect('Session expired — reconnecting…');
            this._recovering = (async () => {
                try {
                    try { this.disconnect(); } catch (e) { /* already gone */ }
                    this.connected = false;
                    this.connecting = false;
                    await this.connect({
                        username: this.username,
                        channelName: this.channelName,
                        channelPassword: this.channelPassword
                    });
                    this._hideReconnect();
                    return true;
                } catch (e) {
                    console.warn('[BlockParty] session recovery failed:', e.message);
                    this._showReconnect('Could not reconnect — please reload');
                    return false;
                } finally {
                    this._recovering = null;
                }
            })();
            return this._recovering;
        }

        // ---------- world management (slots, lock, clear) ----------
        _setWorldLocked(locked, by) {
            const changed = this.worldLocked !== locked;
            this.worldLocked = locked;
            const badge = document.getElementById('lockBadge');
            if (badge) badge.classList.toggle('hidden', !locked);
            const btn = document.getElementById('lockBtn');
            if (btn) btn.textContent = locked ? '🔓 Unlock world' : '🔒 Lock world';
            if (changed && by && by !== this.username) {
                this.showToast(locked ? `${by} locked the world` : `${by} unlocked the world`, 'info', 2200);
            }
        }

        toggleWorldLock() {
            if (!this.isHost()) { this.showToast('Only the host can lock the world', 'warning'); return; }
            const locked = !this.worldLocked;
            this._setWorldLocked(locked);
            this.sendData({ type: 'lock', locked, by: this.username });
            this.showToast(locked ? 'World locked — only you can build' : 'World unlocked', 'success', 2000);
        }

        clearWorld() {
            if (!this.isHost()) { this.showToast('Only the host can clear the world', 'warning'); return; }
            const cells = this.voxels.allCells();
            if (!cells.length) { this.showToast('The world is already empty', 'info'); return; }
            if (!window.confirm(`Clear all ${cells.length} blocks? This can be undone with Z.`)) return;
            // Goes through the normal edit path, so it lands on everyone's
            // screen, persists, and stays undoable.
            this._doLocalEdit({ a: 'bulk', o: this.username, remove: cells });
            this.showToast(`Cleared ${cells.length} blocks`, 'success', 2000);
        }

        // Storage responses are wrapped twice: { data: { data: … } }.
        _storagePayload(res) {
            if (!res || res.status !== 'success') return null;
            const d = res.data;
            return (d && d.data) ? d.data : d;
        }

        saveSlot(name) {
            name = String(name || '').trim().slice(0, 40);
            if (!name) { this.showToast('Give the save a name', 'warning'); return; }
            if (!this.channel || typeof this.channel.storagePut !== 'function') return;
            if (this.modes && this.modes.isMatchActive()) {
                this.showToast('Finish the match before saving', 'warning');
                return;
            }
            const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'world';
            const snap = this.snapshotWorld();
            const count = this.voxels.count();
            const payload = {
                storageKey: SLOT_PREFIX + slug,
                content: { v: 2, name, by: this.username, at: Date.now(), blocks: snap.blocks, pieces: snap.pieces },
                encrypted: false,
                metadata: { description: 'BlockParty saved world', blocks: count }
            };
            this._storage((cb) => this.channel.storagePut(payload, cb), (res) => {
                if (res && res.status === 'success') {
                    this.showToast(`Saved “${name}” (${count} blocks)`, 'success', 2200);
                    this._loadSlotList();
                } else {
                    this.showToast('Save failed: ' + ((res && res.statusMessage) || 'unknown error'), 'error');
                }
            });
        }

        loadSlot(key, label) {
            if (!this.isHost()) { this.showToast('Only the host can load a world', 'warning'); return; }
            if (this.modes && this.modes.isMatchActive()) {
                this.showToast('Finish the match first', 'warning');
                return;
            }
            if (!window.confirm(`Load “${label}”? The current world will be replaced.`)) return;
            this._storage((cb) => this.channel.storageGet({ storageKey: key }, cb), (res) => {
                const payload = (res && res.status === 'success') ? res.data : null;
                const saved = payload && (payload.content || payload);
                const blocks = saved && saved.blocks;
                if (!Array.isArray(blocks)) { this.showToast('That save could not be read', 'error'); return; }
                this.restoreWorldFrom({ blocks, pieces: saved.pieces });
                this.undoStack.length = 0;
                this.redoStack.length = 0;
                this._syncHistoryButtons();
                this._updateBlockCount();
                this._refreshPlayers();
                this._sendWorldSnapshot();
                this._scheduleSave();
                this.showToast(`Loaded “${label}” — ${this.voxels.count()} blocks`, 'success', 2400);
                this._closeWorldModal();
            });
        }

        deleteSlot(key, label) {
            if (!window.confirm(`Delete the save “${label}”?`)) return;
            this._storage((cb) => this.channel.storageDeleteByKey(key, cb), (res) => {
                if (res && res.status === 'success') {
                    this.showToast(`Deleted “${label}”`, 'info', 1800);
                    this._loadSlotList();
                } else {
                    this.showToast('Delete failed', 'error');
                }
            });
        }

        // Called by the mode controller once a match is over: the host's copy of
        // the sandbox is the one everybody goes back to.
        restoreSandbox() {
            if (this.isHost()) {
                this._sendWorldSnapshot();
                this._scheduleSave();
            } else {
                this.sendData({ type: 'requestWorld' });
            }
            this._updateBlockCount();
            this._refreshPlayers();
        }

        // ---------- input ----------
        _bindPointer() {
            const el = this.voxels.renderer.domElement;
            const pointers = new Map();       // pointerId -> {x,y}
            let dragging = false;
            let lastX = 0, lastY = 0, downX = 0, downY = 0, downBtn = 0;
            let pinchDist = 0;

            const MOVE_THRESHOLD = 6;

            el.addEventListener('contextmenu', (e) => e.preventDefault());

            el.addEventListener('pointerdown', (e) => {
                el.setPointerCapture(e.pointerId);
                pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
                lastX = downX = e.clientX; lastY = downY = e.clientY;
                downBtn = e.button;
                dragging = false;
                // Touch has no hover, so first contact is when the ghost appears.
                this._updateAim(e.clientX, e.clientY);
                if (pointers.size === 2) {
                    const pts = Array.from(pointers.values());
                    pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
                }
            });

            el.addEventListener('pointermove', (e) => {
                if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

                // Pinch-zoom (two pointers)
                if (pointers.size === 2) {
                    const pts = Array.from(pointers.values());
                    const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
                    if (pinchDist) this.voxels.zoom((pinchDist - d) * 0.05);
                    pinchDist = d;
                    dragging = true;
                    return;
                }

                if (pointers.size === 1 && (e.buttons || e.pressure)) {
                    const dx = e.clientX - lastX, dy = e.clientY - lastY;
                    if (!dragging && Math.hypot(e.clientX - downX, e.clientY - downY) > MOVE_THRESHOLD) {
                        dragging = true;
                    }
                    if (dragging) { this.voxels.hidePreview(); this.voxels.orbit(dx, dy); }
                    lastX = e.clientX; lastY = e.clientY;
                } else {
                    // Hover: show my own placement ghost + tell the others where I aim
                    this._updateAim(e.clientX, e.clientY);
                }
            });

            const endPointer = (e) => {
                const wasSingle = pointers.size === 1;
                pointers.delete(e.pointerId);
                if (pointers.size < 2) pinchDist = 0;

                if (wasSingle && !dragging) {
                    // A tap/click — perform build/erase
                    const eraseIntent = (downBtn === 2) || (this.tool === 'erase');
                    this._actAt(downX, downY, eraseIntent);
                }
                dragging = false;
            };
            el.addEventListener('pointerup', endPointer);
            el.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); dragging = false; });
            el.addEventListener('pointerleave', () => {
                this._lastPointer = null;
                this.voxels.hidePreview();
            });

            el.addEventListener('wheel', (e) => {
                e.preventDefault();
                this.voxels.zoom(e.deltaY * 0.02);
            }, { passive: false });
        }

        _actAt(clientX, clientY, erase) {
            const pick = this.voxels.pick(clientX, clientY);
            if (!pick) return;

            // Fill is a two-tap gesture — corner, then opposite corner — so it
            // works the same with a mouse and a finger, and never fights the
            // drag-to-orbit that a click-and-drag box would need.
            if (this.fillMode) {
                const cell = erase ? pick.remove : pick.place;
                if (!cell) return;
                if (!this.fillAnchor) {
                    this.fillAnchor = { x: cell.x, y: cell.y, z: cell.z, erase };
                    this.voxels.showRegion(cell, cell, erase);
                    this.showToast('Now tap the opposite corner — Esc cancels', 'info', 2400);
                } else {
                    this.fillRegion(this.fillAnchor, cell, this.fillAnchor.erase);
                    this.cancelFill();
                }
                this._refreshAim();
                return;
            }

            if (erase) {
                if (pick.remove) this.removeAt(pick.remove.x, pick.remove.y, pick.remove.z);
            } else if (pick.place) {
                this.placeAt(pick.place.x, pick.place.y, pick.place.z);
            }
            // The cell under the pointer just changed — re-aim so the ghost moves
            // to the next face instead of sitting inside what was just built.
            this._refreshAim();
        }

        // Draw my own aim locally (every move, it's just a transform) and tell the
        // others about it on a throttle (that part costs bandwidth).
        _updateAim(clientX, clientY) {
            this._lastPointer = { x: clientX, y: clientY };
            const pick = this.voxels.pick(clientX, clientY);
            // Mid-fill the anchor decides which face to aim at, so switching
            // tools halfway through does not move the pending corner.
            const erasing = this.fillAnchor ? this.fillAnchor.erase : (this.tool === 'erase');
            const cell = erasing ? pick && pick.remove : pick && pick.place;
            if (!cell) {
                // No valid target (e.g. Erase aimed at empty ground). Tell the
                // others to drop my cursor, or they keep seeing a stale ghost.
                this.voxels.hidePreview();
                this.voxels.hidePiecePreview();
                this._sendCursor({ hide: true });
                return;
            }

            // Mid-fill, the pending box is the useful preview, not one cell.
            if (this.fillMode && this.fillAnchor) {
                this.voxels.hidePreview();
                this.voxels.hidePiecePreview();
                const n = this.voxels.showRegion(this.fillAnchor, cell, this.fillAnchor.erase);
                const hint = document.getElementById('fillHint');
                if (hint) hint.textContent = `${n} cell${n === 1 ? '' : 's'} — tap to ${this.fillAnchor.erase ? 'clear' : 'fill'}`;
            } else if (this.brickMode && !erasing && !this.fillMode) {
                // Show the whole brick, and show it red when it will not fit —
                // the footprint is the thing you need to judge before tapping.
                this.voxels.hidePreview();
                const { w, d } = this.pieceFootprint();
                this.voxels.showPiecePreview(cell.x, cell.y, cell.z, w, d, this.currentColor,
                    !!this.pieceBlocked(cell.x, cell.y, cell.z, w, d));
            } else {
                this.voxels.hidePiecePreview();
                this.voxels.showPreview(cell.x, cell.y, cell.z, this.currentShape, this.currentColor, erasing);
            }

            this._sendCursor({ x: cell.x, y: cell.y, z: cell.z });
        }

        // Throttled cursor broadcast. `extra` is either a cell or { hide:true }.
        _sendCursor(extra) {
            if (!this.connected) return;
            // Secret builds stay secret; in charades the room follows the cursor.
            if (this.modes && this.modes.isMatchActive() && !this.modes.relaysEdits()) return;
            const now = Date.now();
            if (now - this._lastCursorSent < CURSOR_THROTTLE_MS) return;
            this._lastCursorSent = now;
            const color = (typeof this.generateUserColor === 'function')
                ? this.generateUserColor(this.username) : '#ffffff';
            const cursor = Object.assign({
                type: 'cursor',
                color,
                name: this.username,
                shape: this.currentShape,
                tool: this.tool
            }, extra);
            if (!this.sendToHost(cursor)) this.sendData(cursor);
        }

        // Re-aim after a tool/colour/shape switch so the ghost reflects the change
        // without waiting for the pointer to move.
        _refreshAim() {
            if (this._lastPointer) this._updateAim(this._lastPointer.x, this._lastPointer.y);
        }

        // ---------- UI ----------
        _buildPalette() {
            const palette = document.getElementById('palette');
            palette.innerHTML = '';
            PALETTE.forEach((hex, i) => {
                const sw = document.createElement('div');
                sw.className = 'swatch' + (i === this.currentColor ? ' selected' : '');
                sw.style.background = hex;
                sw.title = hex;
                sw.addEventListener('click', () => {
                    this.currentColor = i;
                    this.tool = 'build';
                    this._syncTool();
                    palette.querySelectorAll('.swatch').forEach(s => s.classList.remove('selected'));
                    sw.classList.add('selected');
                    this._refreshAim();
                });
                palette.appendChild(sw);
            });
        }

        _buildShapes() {
            const bar = document.getElementById('shapes');
            if (!bar) return;
            bar.innerHTML = '';
            SHAPES.forEach((shape, i) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'shape-btn' + (i === this.currentShape ? ' selected' : '');
                btn.textContent = shape.icon;
                btn.title = shape.name + ' (' + (i + 1) + ')';
                btn.setAttribute('aria-label', shape.name);
                btn.addEventListener('click', () => this.selectShape(i));
                bar.appendChild(btn);
            });
        }

        selectShape(i) {
            this.currentShape = shapeIndex(i);
            this.tool = 'build';
            this._syncTool();
            const bar = document.getElementById('shapes');
            if (bar) {
                bar.querySelectorAll('.shape-btn').forEach((b, idx) => {
                    b.classList.toggle('selected', idx === this.currentShape);
                });
            }
            this._refreshAim();
        }

        _bindUI() {
            document.getElementById('toolBuild').addEventListener('click', () => { this.tool = 'build'; this._syncTool(); this._refreshAim(); });
            document.getElementById('toolErase').addEventListener('click', () => { this.tool = 'erase'; this._syncTool(); this._refreshAim(); });
            document.getElementById('undoBtn').addEventListener('click', () => this.undo());
            document.getElementById('resetViewBtn').addEventListener('click', () => {
                this.stopFollowing();
                this.voxels.resetView();
            });

            const on = (id, ev, fn) => {
                const el = document.getElementById(id);
                if (el) el.addEventListener(ev, fn);
            };
            on('redoBtn', 'click', () => this.redo());
            on('toolFill', 'click', () => this.toggleFill());
            on('toolBricks', 'click', () => this.toggleBrickMode());
            on('rotateBtn', 'click', () => this.rotateBrick());
            on('toolMirror', 'click', () => this.toggleMirror());
            on('xrayBtn', 'click', () => this.toggleXray());
            on('followPill', 'click', () => this.stopFollowing());

            const shareBtn = document.getElementById('shareBtn');
            shareBtn.addEventListener('click', () => {
                try { ShareModal.show(this.channelName, this.channelPassword); }
                catch (e) { console.warn('[BlockParty] share failed:', e.message); }
            });

            document.getElementById('leaveBtn').addEventListener('click', () => window.disconnect());
            document.getElementById('dismissHelp').addEventListener('click', () => {
                this._helpDismissed = true;
                document.getElementById('helpHint').classList.add('hidden');
            });

            // Keyboard shortcuts
            window.addEventListener('keydown', (e) => {
                if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
                const k = e.key.toLowerCase();
                if (k === 'escape') { this.cancelFill(); this.stopFollowing(); }
                else if (k === 'b') { this.tool = 'build'; this._syncTool(); this._refreshAim(); }
                else if (k === 'e') { this.tool = 'erase'; this._syncTool(); this._refreshAim(); }
                else if (k === 'f') { this.toggleFill(); }
                else if (k === 'm') { this.toggleMirror(); }
                else if (k === 'o') { this.toggleXray(); }
                else if (k === 'z') { e.shiftKey ? this.redo() : this.undo(); }
                else if (k === 'y') { this.redo(); }
                else if (k === 'r') {
                    // R is rotate while bricks are on, where it is the more
                    // useful key by far; V always resets the view.
                    if (this.brickMode) this.rotateBrick();
                    else { this.stopFollowing(); this.voxels.resetView(); }
                }
                else if (k === 'v') { this.stopFollowing(); this.voxels.resetView(); }
                else if (k === 'k') { this.toggleBrickMode(); }
                // 1..N pick a shape
                else if (/^[1-9]$/.test(k) && Number(k) <= SHAPES.length) { this.selectShape(Number(k) - 1); }
            });
        }

        // ---------- bricks ----------
        _buildBricks() {
            const bar = document.getElementById('bricks');
            if (!bar) return;
            bar.innerHTML = '';
            BlockPartyBricks.BRICKS.forEach(brick => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'brick-btn' + (brick.id === this.currentBrick ? ' selected' : '');
                btn.setAttribute('data-brick', brick.id);
                btn.title = brick.name + ' brick';
                // A little grid of studs reads faster than the label alone.
                btn.innerHTML = `<span class="brick-studs" style="grid-template-columns:repeat(${brick.w},6px)">`
                    + '<i></i>'.repeat(brick.w * brick.d) + `</span><span class="brick-label">${brick.name}</span>`;
                btn.addEventListener('click', () => this.selectBrick(brick.id));
                bar.appendChild(btn);
            });
        }

        selectBrick(id) {
            this.currentBrick = id;
            this.tool = 'build';
            const bar = document.getElementById('bricks');
            if (bar) {
                bar.querySelectorAll('.brick-btn').forEach(b => {
                    b.classList.toggle('selected', b.getAttribute('data-brick') === id);
                });
            }
            this._syncTool();
            this._refreshAim();
        }

        rotateBrick() {
            if (!this.brickMode) return;
            this.brickRotated = !this.brickRotated;
            const { w, d } = this.pieceFootprint();
            this._syncTool();
            this._refreshAim();
            this.showToast(`Rotated — ${w} × ${d}`, 'info', 1200);
        }

        toggleBrickMode(on) {
            this.brickMode = (typeof on === 'boolean') ? on : !this.brickMode;
            this.voxels.setBrickLook(this.brickMode);
            this.voxels.hidePiecePreview();
            try { localStorage.setItem('blockparty_bricks', this.brickMode ? '1' : '0'); } catch (e) { /* ignore */ }
            this._syncTool();
            this._refreshAim();
            this.showToast(this.brickMode ? '🧩 Brick pieces on' : 'Back to single blocks', 'info', 1800);
        }

        // ---------- build helpers ----------
        toggleFill() {
            this.fillMode = !this.fillMode;
            if (!this.fillMode) this.cancelFill();
            this._syncTool();
            this._refreshAim();
            if (this.fillMode) this.showToast('Fill: tap two opposite corners', 'info', 2200);
        }

        cancelFill() {
            this.fillAnchor = null;
            this.voxels.hideRegion();
            const hint = document.getElementById('fillHint');
            if (hint) hint.textContent = '';
        }

        toggleMirror() {
            this.mirror = !this.mirror;
            this._syncTool();
            this.showToast(this.mirror ? 'Mirror on — edits are twinned' : 'Mirror off', 'info', 1600);
        }

        toggleXray() {
            this.xray = !this.xray;
            this.voxels.setOwnerXray(this.xray, (name) => this.generateUserColor(name));
            this._syncTool();
            this.showToast(this.xray ? 'Showing who built what' : 'Back to block colours', 'info', 1800);
        }

        // ---------- following a player ----------
        followPlayer(name) {
            if (!name || name === this.username) return;
            if (this.following === name) { this.stopFollowing(); return; }
            this.following = name;
            const rec = this.voxels.remoteCursors.get(name);
            if (rec) this.voxels.followTo({ x: rec.group.position.x, y: rec.group.position.y + 1, z: rec.group.position.z });
            this._syncFollowPill();
            this.showToast(`Following ${name} — Esc or R to stop`, 'info', 2200);
        }

        stopFollowing() {
            if (!this.following) return;
            this.following = null;
            this.voxels.followTo(null);
            this._syncFollowPill();
        }

        _syncFollowPill() {
            const pill = document.getElementById('followPill');
            if (!pill) return;
            pill.classList.toggle('hidden', !this.following);
            if (this.following) pill.textContent = `👁 Following ${this.following} ✕`;
        }

        // ---------- match UI ----------
        _bindMatchUI() {
            const on = (id, ev, fn) => {
                const el = document.getElementById(id);
                if (el) el.addEventListener(ev, fn);
            };

            on('playBtn', 'click', () => this._openModePicker());
            on('modeClose', 'click', () => this._closeModePicker());
            on('modeModal', 'click', (e) => { if (e.target.id === 'modeModal') this._closeModePicker(); });
            on('modeStart', 'click', () => {
                const rounds = Number((document.getElementById('modeRounds') || {}).value) || 3;
                const roundTime = Number((document.getElementById('modeTime') || {}).value) || 180;
                this._closeModePicker();
                this.modes.startMatch(this._pickedMode || 'blueprint', { rounds, roundTime });
            });

            on('mhLockBtn', 'click', () => this.modes.lockIn());
            on('mhEndBtn', 'click', () => this.modes.endMatch());

            on('rsAgain', 'click', () => { this.hideResults(); this._openModePicker(); });
            on('rsSandbox', 'click', () => this.modes.endMatch());
            on('rsHide', 'click', () => this.hideResults());

            // Clicking a scoreboard row — or a player during a match — flies the
            // camera to that player's plot.
            const focusFrom = (e, sel) => {
                const row = e.target.closest && e.target.closest(sel);
                if (row) this.modes.focusPlayer(row.getAttribute('data-player'));
            };
            on('rsBody', 'click', (e) => {
                // A vote button is a vote; anywhere else on the row is "show me".
                const vote = e.target.closest && e.target.closest('.vote-btn');
                if (vote && !vote.disabled) { this.modes.castVote(vote.getAttribute('data-vote')); return; }
                focusFrom(e, '.rs-row');
            });
            on('playerList', 'click', (e) => {
                // During a match a click flies to that player's plot; in the
                // sandbox it follows them around instead.
                if (this.modes.isMatchActive()) { focusFrom(e, '.player-row'); return; }
                const row = e.target.closest && e.target.closest('.player-row');
                if (row) this.followPlayer(row.getAttribute('data-player'));
            });

            window.addEventListener('keydown', (e) => {
                if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
                if (e.key.toLowerCase() === 'l') this.modes.lockIn();
            });
        }

        _openModePicker() {
            const modal = document.getElementById('modeModal');
            const list = document.getElementById('modeList');
            if (!modal || !list) return;

            this._pickedMode = this._pickedMode || 'blueprint';
            list.innerHTML = BlockPartyModes.MODES.map(m => `
                <button class="mode-card${m.id === this._pickedMode ? ' selected' : ''}${m.ready ? '' : ' soon'}"
                        data-mode="${m.id}" ${m.ready ? '' : 'disabled'}>
                    <span class="mode-emoji">${m.emoji}</span>
                    <span class="mode-body">
                        <span class="mode-name">${this._esc(m.name)}${m.ready ? '' : ' <em>soon</em>'}</span>
                        <span class="mode-desc">${this._esc(m.desc)}</span>
                    </span>
                </button>`).join('');
            const applyDefaults = (id) => {
                const mode = BlockPartyModes.MODES.find(m => m.id === id);
                const time = document.getElementById('modeTime');
                // Each mode has its own natural round length — a 3-minute
                // charades round is a very long silence.
                if (mode && mode.defaultTime && time) time.value = String(mode.defaultTime);
            };
            list.querySelectorAll('.mode-card').forEach(card => {
                card.addEventListener('click', () => {
                    this._pickedMode = card.getAttribute('data-mode');
                    list.querySelectorAll('.mode-card').forEach(c => c.classList.remove('selected'));
                    card.classList.add('selected');
                    applyDefaults(this._pickedMode);
                });
            });
            applyDefaults(this._pickedMode);

            const isHost = this.isHost();
            const players = Math.max(1, (this.getConnectedUsers() || []).length);
            const hint = document.getElementById('modeHint');
            if (hint) {
                hint.textContent = isHost
                    ? `${players} player${players === 1 ? '' : 's'} in the room — everyone gets a plot`
                    : 'Only the room host can start a match';
            }
            const startBtn = document.getElementById('modeStart');
            if (startBtn) startBtn.disabled = !isHost;
            modal.classList.remove('hidden');
        }

        _closeModePicker() {
            const modal = document.getElementById('modeModal');
            if (modal) modal.classList.add('hidden');
        }

        // ---------- chat / guessing ----------
        // The panel, the badge, the relay and the mute rule all live in the
        // shared component now; what stays here is what is specific to this
        // game — that a charades round turns typing into guessing.
        _bindChat() {
            this.chat = new ChatPanel({
                game: this,
                toggleId: 'chatToggle',
                badgeId: 'chatBadge',
                side: 'left',
                bottom: 104,                      // clear of the tool dock
                title: '💬 Chat',
                onIntercept: (text) => this.modes && this.modes.handleLocalChat(text),
                isMuted: (name) => this.modes && this.modes.chatBlockedFor(name),
                colorFor: (name) => this.generateUserColor(name)
            });
        }

        openChat(on, focus) {
            if (!this.chat) return;
            this.chat.open(on, focus);
            if (on) this._updateChatMode();
        }

        // Placeholder and enabled-state follow the mode: in charades the builder
        // is muted and everyone else is prompted to guess.
        _updateChatMode() {
            if (!this.chat) return;
            const s = this.modes && this.modes.state;
            const charades = !!(s && s.mode === 'charades' && s.phase === 'play');
            const iBuild = charades && s.builder === this.username;
            this.chat.setMode({
                title: charades ? '🤫 Guesses' : '💬 Chat',
                disabled: iBuild,
                placeholder: iBuild ? 'No words — build it! 🤫'
                    : (charades ? `Guess what ${s.builder} is building…` : 'Say something…')
            });
            // A guesser wants the caret waiting for them.
            if (charades && !iBuild && this.chat.isOpen()) this.chat.open(true, true);
        }

        sendChatLine(text) { if (this.chat) this.chat.send(text); }

        relayChat(msg) { if (this.chat) this.chat.relay(msg); }

        addChatMessage(name, text, opts) { if (this.chat) this.chat.add(name, text, opts); }

        // ---------- world modal ----------
        _bindWorldUI() {
            const on = (id, ev, fn) => {
                const el = document.getElementById(id);
                if (el) el.addEventListener(ev, fn);
            };
            on('worldBtn', 'click', () => this._openWorldModal());
            on('worldClose', 'click', () => this._closeWorldModal());
            on('worldModal', 'click', (e) => { if (e.target.id === 'worldModal') this._closeWorldModal(); });
            on('saveSlotBtn', 'click', () => {
                const input = document.getElementById('slotName');
                this.saveSlot(input.value);
                input.value = '';
            });
            on('slotName', 'keydown', (e) => {
                e.stopPropagation();
                if (e.key === 'Enter') document.getElementById('saveSlotBtn').click();
            });
            on('lockBtn', 'click', () => { this.toggleWorldLock(); this._syncWorldControls(); });
            on('clearWorldBtn', 'click', () => this.clearWorld());
            on('slotList', 'click', (e) => {
                const btn = e.target.closest && e.target.closest('button[data-key]');
                if (!btn) return;
                const key = btn.getAttribute('data-key');
                const label = btn.getAttribute('data-label');
                if (btn.classList.contains('slot-load')) this.loadSlot(key, label);
                else if (btn.classList.contains('slot-del')) this.deleteSlot(key, label);
            });
        }

        _openWorldModal() {
            const modal = document.getElementById('worldModal');
            if (!modal) return;
            modal.classList.remove('hidden');
            this._syncWorldControls();
            this._loadSlotList();
            this._fetchStats();
        }

        _closeWorldModal() {
            const modal = document.getElementById('worldModal');
            if (modal) modal.classList.add('hidden');
        }

        _syncWorldControls() {
            const host = this.isHost();
            const lock = document.getElementById('lockBtn');
            const clear = document.getElementById('clearWorldBtn');
            if (lock) { lock.disabled = !host; lock.textContent = this.worldLocked ? '🔓 Unlock world' : '🔒 Lock world'; }
            if (clear) clear.disabled = !host;
            const note = document.getElementById('worldHostNote');
            if (note) note.classList.toggle('hidden', host);
        }

        _loadSlotList() {
            const list = document.getElementById('slotList');
            if (!list || !this.channel || typeof this.channel.storageKeys !== 'function') return;
            list.innerHTML = '<div class="slot-empty">Loading…</div>';

            this._storage((cb) => this.channel.storageKeys(cb), (res) => {
                const data = this._storagePayload(res);
                const keys = (data && data.keys ? data.keys : []).filter(k => k.indexOf(SLOT_PREFIX) === 0);
                if (res && res.status !== 'success') {
                    list.innerHTML = `<div class="slot-empty">Could not read saved worlds — ${this._esc(res.statusMessage || 'storage error')}</div>`;
                    return;
                }
                // Sizes and timestamps live in a second call; the list renders
                // without them if it fails, rather than showing nothing.
                this._storage((cb2) => this.channel.storageValues(cb2), (vres) => {
                    const vdata = this._storagePayload(vres);
                    const meta = new Map();
                    ((vdata && vdata.values) || []).forEach(v => meta.set(v.storageKey, v));
                    this._renderSlots(list, keys, meta);
                });
            });
        }

        _renderSlots(list, keys, meta) {
            if (!keys.length) {
                list.innerHTML = '<div class="slot-empty">No saved worlds yet — save one above.</div>';
                return;
            }
            const host = this.isHost();
            list.innerHTML = keys.map(key => {
                // The display name comes from the key, so listing costs one
                // request instead of one per save.
                const label = key.slice(SLOT_PREFIX.length).replace(/-/g, ' ').replace(/(^|\s)\w/g, c => c.toUpperCase());
                const m = meta.get(key);
                const size = m && m.sizeBytes ? `${(m.sizeBytes / 1024).toFixed(1)} KB` : '';
                const when = m && m.updatedAt ? new Date(m.updatedAt).toLocaleString() : '';
                return `<div class="slot-row">
                    <span class="slot-name">${this._esc(label)}</span>
                    <span class="slot-meta">${this._esc([when, size].filter(Boolean).join(' · '))}</span>
                    <button class="slot-load btn btn-ghost" data-key="${this._esc(key)}" data-label="${this._esc(label)}" ${host ? '' : 'disabled'}>Load</button>
                    <button class="slot-del btn btn-ghost" data-key="${this._esc(key)}" data-label="${this._esc(label)}" title="Delete">🗑</button>
                </div>`;
            }).join('');
        }

        // ---------- persistent room stats ----------
        _fetchStats() {
            if (!this.channel || typeof this.channel.storageGet !== 'function') return;
            this._storage((cb) => this.channel.storageGet({ storageKey: STATS_KEY }, cb), (res) => {
                if (res && res.status === 'success' && res.data) this.stats = res.data;
                this._renderLeaderboard();
            });
        }

        _renderLeaderboard() {
            const el = document.getElementById('leaderboard');
            if (!el) return;
            const players = (this.stats && this.stats.players) || {};
            const rows = Object.keys(players).map(name => Object.assign({ name }, players[name]))
                .sort((a, b) => (b.wins - a.wins) || (b.points - a.points));
            if (!rows.length) {
                el.innerHTML = '<div class="slot-empty">No matches played in this room yet.</div>';
                return;
            }
            el.innerHTML = rows.map(r => `
                <div class="lb-row${r.name === this.username ? ' me' : ''}">
                    <span class="lb-dot" style="background:${this.generateUserColor(r.name)}"></span>
                    <span class="lb-name">${this._esc(r.name)}</span>
                    <span class="lb-stat" title="Matches won">🏆 ${r.wins || 0}</span>
                    <span class="lb-stat" title="Matches played">🎮 ${r.matches || 0}</span>
                    <span class="lb-stat" title="Total match points">${r.points || 0} pts</span>
                    ${r.bestPct ? `<span class="lb-stat" title="Best blueprint accuracy">📐 ${r.bestPct}%</span>` : ''}
                    ${r.guesses ? `<span class="lb-stat" title="Charades guessed">🤫 ${r.guesses}</span>` : ''}
                </div>`).join('');
        }

        /**
         * Host-only, at the end of a match: fold this match's results into the
         * room's running record and hand the merged copy to everyone. Read then
         * write, because only the host ever writes this key.
         */
        recordMatchStats(results) {
            if (!this.isHost() || !results || !this.channel) return;
            this._storage((cb) => this.channel.storageGet({ storageKey: STATS_KEY }, cb), (res) => {
                const current = (res && res.status === 'success' && res.data && res.data.players)
                    ? res.data : { v: 1, players: {} };
                const players = current.players;
                const winner = (results.totals && results.totals[0]) ? results.totals[0].name : null;

                (results.totals || []).forEach(t => {
                    const p = players[t.name] || (players[t.name] = { matches: 0, wins: 0, points: 0, bestPct: 0, guesses: 0 });
                    p.matches += 1;
                    p.points += t.points || 0;
                    // A co-op match is won by the room or by nobody, so everyone
                    // who scored takes the win rather than whoever sorts first.
                    if (results.coop ? t.points > 0 : (t.name === winner && t.points > 0)) p.wins += 1;
                });
                (results.rows || []).forEach(r => {
                    const p = players[r.name];
                    if (!p) return;
                    if (typeof r.pct === 'number') p.bestPct = Math.max(p.bestPct || 0, Math.round(r.pct));
                    if (r.isGuesser) p.guesses = (p.guesses || 0) + 1;
                });

                this.stats = current;
                this._storage((cb) => this.channel.storagePut({
                    storageKey: STATS_KEY, content: current, encrypted: false,
                    metadata: { description: 'BlockParty room stats' }
                }, cb), (put) => {
                    if (put && put.status !== 'success') {
                        console.warn('[BlockParty] stats save failed:', put.statusMessage);
                    }
                });
                this.sendData({ type: 'stats', stats: current });
                this._renderLeaderboard();
            });
        }

        showResults(opts) {
            const ov = document.getElementById('resultsOverlay');
            if (!ov) return;
            const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html || ''; };
            set('rsTitle', opts.title);
            set('rsSubtitle', opts.subtitle);
            set('rsBody', opts.body);
            const again = document.getElementById('rsAgain');
            const sand = document.getElementById('rsSandbox');
            if (again) again.classList.toggle('hidden', !(opts.isFinal && opts.canControl));
            if (sand) sand.classList.toggle('hidden', !opts.canControl);
            ov.classList.remove('hidden');
        }

        hideResults() {
            const ov = document.getElementById('resultsOverlay');
            if (ov) ov.classList.add('hidden');
        }

        // Hide the build dock from anyone who cannot build this round — a
        // guesser waving at a palette that does nothing just reads as broken.
        setToolsVisible(on) {
            const dock = document.querySelector('.tool-dock');
            if (dock) dock.classList.toggle('hidden', !on);
        }

        showPlayHint() {
            const hint = document.getElementById('helpHint');
            if (hint && !this._helpDismissed) hint.classList.remove('hidden');
        }

        hidePlayHint() {
            const hint = document.getElementById('helpHint');
            if (hint) hint.classList.add('hidden');
        }

        _syncTool() {
            const set = (id, on) => {
                const el = document.getElementById(id);
                if (el) el.classList.toggle('active', !!on);
            };
            set('toolBuild', this.tool === 'build');
            set('toolErase', this.tool === 'erase');
            set('toolFill', this.fillMode);
            set('toolMirror', this.mirror);
            set('toolBricks', this.brickMode);
            set('xrayBtn', this.xray);

            // Bricks and single-block shapes are alternative palettes; only one
            // of them is meaningful at a time.
            const bricks = document.getElementById('bricks');
            const shapes = document.getElementById('shapes');
            const rotate = document.getElementById('rotateBtn');
            if (bricks) bricks.classList.toggle('hidden', !this.brickMode);
            if (shapes) shapes.classList.toggle('hidden', this.brickMode);
            if (rotate) {
                rotate.classList.toggle('hidden', !this.brickMode);
                const { w, d } = this.pieceFootprint();
                rotate.title = `Rotate the brick (R) — now ${w} × ${d}`;
            }
        }

        _updateBlockCount() {
            const n = this.voxels.count();
            document.getElementById('blockCount').textContent = n + (n === 1 ? ' block' : ' blocks');
            this._updatePlayerCounts();
        }

        // Live per-player block tallies. Patches the existing rows in place
        // (rather than re-rendering the list) so this stays cheap while a
        // player drags out a wall, and never fights the join/leave rebuild.
        _updatePlayerCounts() {
            const list = document.getElementById('playerList');
            if (!list) return;
            const counts = this.voxels.countsByOwner();
            const rows = list.querySelectorAll('.player-row');
            // A player who has blocks but no row yet (e.g. their join event has
            // not landed) means the list itself is stale — rebuild it once.
            let missing = false;
            const present = new Set();
            rows.forEach(row => present.add(row.getAttribute('data-player')));
            counts.forEach((_n, name) => { if (!present.has(name)) missing = true; });
            if (missing) { this._refreshPlayers(); return; }

            rows.forEach(row => {
                const name = row.getAttribute('data-player');
                const el = row.querySelector('.player-blocks');
                if (!el) return;
                const n = counts.get(name) || 0;
                el.textContent = n;
                el.classList.toggle('zero', n === 0);
                el.title = n + (n === 1 ? ' block' : ' blocks') + ' placed by ' + name;
            });
        }

        _refreshPlayers() {
            const list = document.getElementById('playerList');
            if (!list) return;
            let users = [];
            try { users = this.getConnectedUsers() || []; } catch (e) { users = []; }
            const online = new Set([this.username, ...users].filter(Boolean));
            const counts = this.voxels ? this.voxels.countsByOwner() : new Map();
            // Builders who have since left still own standing blocks — keep them
            // listed (dimmed) so the world's block tally always adds up.
            const names = Array.from(new Set([...online, ...counts.keys()]));
            const hostName = this._hostName();

            list.innerHTML = names.map(name => {
                const color = (typeof this.generateUserColor === 'function') ? this.generateUserColor(name) : '#6366f1';
                const isYou = name === this.username;
                const isHost = hostName ? (name === hostName) : (isYou && this.isHost());
                const isOnline = online.has(name);
                const n = counts.get(name) || 0;
                return `<div class="player-row${isOnline ? '' : ' offline'}" data-player="${this._esc(name)}">
                    <span class="player-dot" style="background:${color}"></span>
                    <span class="player-name">${this._esc(name)}${isYou ? ' <span class="you">(you)</span>' : ''}${isOnline ? '' : ' <span class="you">(left)</span>'}</span>
                    ${isHost ? '<span class="player-host" title="Room host">👑</span>' : ''}
                    <span class="player-blocks${n === 0 ? ' zero' : ''}" title="${n}${n === 1 ? ' block' : ' blocks'} placed by ${this._esc(name)}">${n}</span>
                </div>`;
            }).join('');
        }

        _hostName() {
            try {
                if (typeof this.getUserList === 'function') {
                    const u = this.getUserList().find(x => x.isHost);
                    if (u) return u.name;
                }
            } catch (e) { /* ignore */ }
            return this.isHost() ? this.username : null;
        }

        _setConnected(ok) {
            const el = document.getElementById('connectionIndicator');
            if (!el) return;
            el.classList.toggle('connected', !!ok);
            el.classList.toggle('disconnected', !ok);
        }

        _showReconnect(msg) {
            const ov = document.getElementById('reconnectOverlay');
            const m = document.getElementById('reconnectMsg');
            if (m && msg) m.textContent = msg;
            if (ov) ov.classList.remove('hidden');
        }

        _hideReconnect() {
            const ov = document.getElementById('reconnectOverlay');
            if (ov) ov.classList.add('hidden');
        }

        _esc(s) {
            return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        }
    }

    // =========================================================
    // Boot
    // =========================================================
    let game = null;
    let isConnecting = false;

    async function connectBlockParty(username, channel, password) {
        if (isConnecting) return;
        if (game && game.connected) return;
        isConnecting = true;
        try {
            game = new BlockPartyGame();
            window.blockPartyGame = game;

            await game.initialize();
            await game.connect({ username, channelName: channel, channelPassword: password });
            game.start();

            // Update URL hash for sharing
            if (typeof window.encodeChannelAuth === 'function') {
                const encoded = window.encodeChannelAuth(channel, password, null);
                if (encoded) {
                    const slug = channel.toLowerCase().replace(/[^a-z0-9]/g, '-');
                    window.history.replaceState(null, '', '#' + encoded + '#' + slug);
                }
            }
            try {
                if (typeof MiniGameUtils !== 'undefined') MiniGameUtils.toggleShareButton(true);
            } catch (e) { /* ignore */ }
            const shareBtn = document.getElementById('shareBtn');
            if (shareBtn) shareBtn.style.display = 'inline-block';
        } catch (error) {
            console.error('[BlockParty] Connection failed:', error);
            alert('Failed to connect: ' + error.message);
            game = null;
        } finally {
            isConnecting = false;
        }
    }

    function initializeConnectionModal() {
        window.loadConnectionModal({
            localStoragePrefix: 'blockparty_',
            channelPrefix: 'blockparty-',
            title: '🧱 Join BlockParty',
            collapsedTitle: '🧱 BlockParty',
            onConnect: function (username, channel, password) {
                connectBlockParty(username, channel, password);
            }
        });
    }

    window.disconnect = function () {
        if (game) { try { game.disconnect(); } catch (e) { /* ignore */ } }
        document.getElementById('gameContainer').classList.add('hidden');
        if (window.ConnectionModal && typeof window.ConnectionModal.show === 'function') {
            window.ConnectionModal.show();
        }
        try { if (typeof MiniGameUtils !== 'undefined') MiniGameUtils.toggleShareButton(false); } catch (e) { /* ignore */ }
    };

    document.addEventListener('DOMContentLoaded', () => {
        initializeConnectionModal();

        if (window.MiniGameUtils && typeof MiniGameUtils.processSharedLinkAndAutoConnect === 'function') {
            MiniGameUtils.processSharedLinkAndAutoConnect({
                gameName: 'BlockParty',
                storagePrefix: 'blockparty_',
                connectCallback: async function () {
                    const username = document.getElementById('usernameInput')?.value?.trim();
                    const channel = document.getElementById('channelInput')?.value?.trim();
                    const password = document.getElementById('passwordInput')?.value || '';
                    if (username && channel) await connectBlockParty(username, channel, password);
                }
            });
        }

        setTimeout(() => {
            const modal = document.getElementById('connectionModal');
            if (modal) modal.classList.add('active');
        }, 200);
    });
})();
