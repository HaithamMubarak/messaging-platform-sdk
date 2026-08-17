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
            this.meshes = new Map();    // "x,y,z" -> THREE.Mesh
            this.remoteCursors = new Map(); // peerId -> { group, line, ghost, label, ... }

            this.geometries = SHAPES.map(s => s.make());
            this.geometry = this.geometries[0];   // cube, the default
            this.materials = PALETTE.map(hex => new THREE.MeshLambertMaterial({ color: new THREE.Color(hex) }));
            // Translucent twins of the palette, for placement ghosts.
            this.ghostMaterials = PALETTE.map(hex => new THREE.MeshLambertMaterial({
                color: new THREE.Color(hex), transparent: true, opacity: 0.45, depthWrite: false
            }));
            this.cursorGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02, 1.02, 1.02));
            this.preview = null;        // local placement ghost (built lazily)

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
            this._applyCamera();
        }

        resetView() {
            this.cam = { theta: Math.PI * 0.25, phi: Math.PI * 0.32, radius: 34 };
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
            this.cam.theta -= dx * 0.005;
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
            const loop = () => {
                this._raf = requestAnimationFrame(loop);
                this.renderer.render(this.scene, this.camera);
            };
            loop();
        }

        // ---- world model ----
        static key(x, y, z) { return x + ',' + y + ',' + z; }

        inBounds(x, y, z) {
            return x >= -HALF && x <= HALF && z >= -HALF && z <= HALF && y >= 0 && y <= MAX_Y;
        }

        hasBlock(x, y, z) { return this.world.has(VoxelWorld.key(x, y, z)); }

        ownerOf(x, y, z) { return this.owners.get(VoxelWorld.key(x, y, z)); }
        shapeOf(x, y, z) { return this.shapes.get(VoxelWorld.key(x, y, z)) || 0; }

        setBlock(x, y, z, colorIndex, owner, shape) {
            const k = VoxelWorld.key(x, y, z);
            const si = shapeIndex(shape);
            if (owner) this.owners.set(k, owner);
            if (si) this.shapes.set(k, si); else this.shapes.delete(k);

            const existing = this.meshes.get(k);
            // Same shape → just restyle. Different shape → the geometry changed,
            // so the mesh has to be rebuilt.
            if (existing && existing.userData.si === si) {
                existing.material = this.materials[colorIndex] || this.materials[0];
                this.world.set(k, colorIndex);
                return;
            }
            if (existing) { this.scene.remove(existing); this.meshes.delete(k); }

            const mesh = new THREE.Mesh(this.geometries[si], this.materials[colorIndex] || this.materials[0]);
            mesh.position.set(x + 0.5, y + shapeAt(si).cy, z + 0.5);
            mesh.userData = { cx: x, cy: y, cz: z, si };
            this.scene.add(mesh);
            this.meshes.set(k, mesh);
            this.world.set(k, colorIndex);
        }

        deleteBlock(x, y, z) {
            const k = VoxelWorld.key(x, y, z);
            const mesh = this.meshes.get(k);
            if (mesh) { this.scene.remove(mesh); this.meshes.delete(k); }
            this.world.delete(k);
            this.owners.delete(k);
            this.shapes.delete(k);
        }

        clearAll() {
            this.meshes.forEach(m => this.scene.remove(m));
            this.meshes.clear();
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
        encode() {
            const out = [];
            this.world.forEach((c, k) => {
                const [x, y, z] = k.split(',').map(Number);
                const owner = this.owners.get(k);
                const si = this.shapes.get(k) || 0;
                if (si) out.push([x, y, z, c, owner || null, si]);
                else if (owner) out.push([x, y, z, c, owner]);
                else out.push([x, y, z, c]);
            });
            return out;
        }

        replaceFrom(blocks) {
            this.clearAll();
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
            targets.push(this.ground);
            const hits = this.raycaster.intersectObjects(targets, false);
            if (!hits.length) return null;

            const hit = hits[0];
            if (hit.object.userData && hit.object.userData.isGround) {
                const x = Math.floor(hit.point.x);
                const z = Math.floor(hit.point.z);
                return { place: { x, y: 0, z }, remove: null };
            }
            const { cx, cy, cz } = hit.object.userData;
            const n = hit.face.normal;
            const place = { x: cx + Math.round(n.x), y: cy + Math.round(n.y), z: cz + Math.round(n.z) };
            return { place, remove: { x: cx, y: cy, z: cz } };
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
            this.currentColor = 0;
            this.currentShape = 0;          // index into SHAPES
            this.tool = 'build';            // 'build' | 'erase'
            this.undoStack = [];            // inverse edits of my own actions
            this._saveTimer = null;
            this._lastCursorSent = 0;
            this._lastPointer = null;       // last hover position, for preview refreshes
        }

        // ---------- lifecycle ----------
        async onInitialize() {
            this.voxels = new VoxelWorld(document.getElementById('sceneRoot'));
            this._buildPalette();
            this._buildShapes();
            this._bindUI();
            this._bindPointer();
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
        }

        onUserLeave(detail) {
            this.voxels.removeRemoteCursor(detail.agentName);
            this.showToast(`${detail.agentName} left`, 'warning', 1800);
            this._refreshPlayers();
        }

        onBecomeHost() {
            this.showToast('You are now the room host', 'info', 2200);
            this._refreshPlayers();
            this._scheduleSave(); // take ownership of persistence
        }

        onLoseHost() {
            this._refreshPlayers();
        }

        onDisconnect() {
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
            switch (data.type) {
                case 'edit':
                    this._applyEdit(data.edit);
                    this._updateBlockCount();
                    if (this.isHost()) {
                        // Relay client edits out to everyone else; persist.
                        this.sendData({ type: 'edit', edit: data.edit });
                        this._scheduleSave();
                    }
                    break;
                case 'world':
                    this.voxels.replaceFrom(data.blocks);
                    this._updateBlockCount();
                    break;
                case 'requestWorld':
                    if (this.isHost()) this._sendWorldSnapshot();
                    break;
                case 'cursor':
                    if (data.hide) { this.voxels.hideRemoteCursor(peerId); break; }
                    this.voxels.setRemoteCursor(peerId, {
                        x: data.x, y: data.y, z: data.z,
                        color: data.color, name: data.name, shape: data.shape, tool: data.tool
                    });
                    break;
            }
        }

        // ---------- edits ----------
        _applyEdit(edit) {
            if (!edit) return;
            if (edit.a === 'place' && this.voxels.inBounds(edit.x, edit.y, edit.z)) {
                // edit.o = the player who placed it, so per-player counts stay
                // correct no matter which peer applied the edit. edit.s = shape.
                this.voxels.setBlock(edit.x, edit.y, edit.z, edit.c, edit.o, edit.s);
            } else if (edit.a === 'remove') {
                this.voxels.deleteBlock(edit.x, edit.y, edit.z);
            }
        }

        // Local action from this player: apply, record undo, broadcast, persist.
        _doLocalEdit(edit, inverse) {
            this._applyEdit(edit);
            this._updateBlockCount();
            if (inverse) {
                this.undoStack.push(inverse);
                if (this.undoStack.length > 100) this.undoStack.shift();
            }
            this.sendData({ type: 'edit', edit });
            if (this.isHost()) this._scheduleSave();
            if (window.GameKit && window.GameKit.Sfx) {
                edit.a === 'place' ? GameKit.Sfx.tick && GameKit.Sfx.tick() : null;
            }
        }

        placeAt(x, y, z) {
            if (!this.voxels.inBounds(x, y, z)) return;
            const prev = this.voxels.world.get(VoxelWorld.key(x, y, z));
            const prevOwner = this.voxels.ownerOf(x, y, z);
            const prevShape = this.voxels.shapeOf(x, y, z);
            const inverse = (prev === undefined)
                ? { a: 'remove', x, y, z }
                : { a: 'place', x, y, z, c: prev, o: prevOwner, s: prevShape };
            this._doLocalEdit(
                { a: 'place', x, y, z, c: this.currentColor, o: this.username, s: this.currentShape },
                inverse
            );
        }

        removeAt(x, y, z) {
            const prev = this.voxels.world.get(VoxelWorld.key(x, y, z));
            if (prev === undefined) return;
            const prevOwner = this.voxels.ownerOf(x, y, z);
            const prevShape = this.voxels.shapeOf(x, y, z);
            this._doLocalEdit(
                { a: 'remove', x, y, z },
                { a: 'place', x, y, z, c: prev, o: prevOwner, s: prevShape }
            );
        }

        undo() {
            const inv = this.undoStack.pop();
            if (!inv) { this.showToast('Nothing to undo', 'info', 1200); return; }
            // Apply the inverse as a fresh authoritative edit (no new undo entry)
            this._applyEdit(inv);
            this._updateBlockCount();
            this.sendData({ type: 'edit', edit: inv });
            if (this.isHost()) this._scheduleSave();
        }

        // ---------- persistence ----------
        _scheduleSave() {
            if (!this.isHost()) return;
            clearTimeout(this._saveTimer);
            this._saveTimer = setTimeout(() => this._saveWorld(), SAVE_DEBOUNCE_MS);
        }

        _saveWorld() {
            if (!this.isHost() || !this.channel || typeof this.channel.storagePut !== 'function') return;
            try {
                this.channel.storagePut({
                    storageKey: STORAGE_KEY,
                    content: { v: 1, blocks: this.voxels.encode() },
                    encrypted: false,
                    metadata: { description: 'BlockParty voxel world', blocks: this.voxels.count() }
                }, (res) => {
                    if (res && res.status !== 'success') {
                        console.warn('[BlockParty] world save failed:', res.statusMessage);
                    }
                });
            } catch (e) {
                console.warn('[BlockParty] world save error:', e.message);
            }
        }

        _loadWorldFromStorage() {
            if (!this.channel || typeof this.channel.storageGet !== 'function') return;
            try {
                this.channel.storageGet({ storageKey: STORAGE_KEY }, (res) => {
                    if (res && res.status === 'success' && res.data) {
                        const blocks = res.data.blocks || (res.data.content && res.data.content.blocks);
                        if (Array.isArray(blocks) && blocks.length && this.voxels.count() === 0) {
                            this.voxels.replaceFrom(blocks);
                            this._updateBlockCount();
                        }
                    }
                });
            } catch (e) {
                console.warn('[BlockParty] world load error:', e.message);
            }
        }

        _sendWorldSnapshot() {
            this.sendData({ type: 'world', blocks: this.voxels.encode() });
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
            const erasing = this.tool === 'erase';
            const cell = erasing ? pick && pick.remove : pick && pick.place;
            if (!cell) {
                // No valid target (e.g. Erase aimed at empty ground). Tell the
                // others to drop my cursor, or they keep seeing a stale ghost.
                this.voxels.hidePreview();
                this._sendCursor({ hide: true });
                return;
            }

            this.voxels.showPreview(cell.x, cell.y, cell.z, this.currentShape, this.currentColor, erasing);

            this._sendCursor({ x: cell.x, y: cell.y, z: cell.z });
        }

        // Throttled cursor broadcast. `extra` is either a cell or { hide:true }.
        _sendCursor(extra) {
            if (!this.connected) return;
            const now = Date.now();
            if (now - this._lastCursorSent < CURSOR_THROTTLE_MS) return;
            this._lastCursorSent = now;
            const color = (typeof this.generateUserColor === 'function')
                ? this.generateUserColor(this.username) : '#ffffff';
            this.sendData(Object.assign({
                type: 'cursor',
                color,
                name: this.username,
                shape: this.currentShape,
                tool: this.tool
            }, extra));
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
            document.getElementById('resetViewBtn').addEventListener('click', () => this.voxels.resetView());

            const shareBtn = document.getElementById('shareBtn');
            shareBtn.addEventListener('click', () => {
                try { ShareModal.show(this.channelName, this.channelPassword); }
                catch (e) { console.warn('[BlockParty] share failed:', e.message); }
            });

            document.getElementById('leaveBtn').addEventListener('click', () => window.disconnect());
            document.getElementById('dismissHelp').addEventListener('click', () => {
                document.getElementById('helpHint').classList.add('hidden');
            });

            // Keyboard shortcuts
            window.addEventListener('keydown', (e) => {
                if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
                const k = e.key.toLowerCase();
                if (k === 'b') { this.tool = 'build'; this._syncTool(); this._refreshAim(); }
                else if (k === 'e') { this.tool = 'erase'; this._syncTool(); this._refreshAim(); }
                else if (k === 'z') { this.undo(); }
                else if (k === 'r') { this.voxels.resetView(); }
                // 1..N pick a shape
                else if (/^[1-9]$/.test(k) && Number(k) <= SHAPES.length) { this.selectShape(Number(k) - 1); }
            });
        }

        _syncTool() {
            document.getElementById('toolBuild').classList.toggle('active', this.tool === 'build');
            document.getElementById('toolErase').classList.toggle('active', this.tool === 'erase');
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
