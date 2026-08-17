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

    // =========================================================
    // Voxel renderer — owns the three.js scene, camera, picking
    // =========================================================
    class VoxelWorld {
        constructor(mountEl) {
            this.mountEl = mountEl;
            this.world = new Map();     // "x,y,z" -> colorIndex
            this.meshes = new Map();    // "x,y,z" -> THREE.Mesh
            this.remoteCursors = new Map(); // peerId -> THREE.LineSegments

            this.geometry = new THREE.BoxGeometry(1, 1, 1);
            this.materials = PALETTE.map(hex => new THREE.MeshLambertMaterial({ color: new THREE.Color(hex) }));
            this.cursorGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02, 1.02, 1.02));

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

        setBlock(x, y, z, colorIndex) {
            const k = VoxelWorld.key(x, y, z);
            const existing = this.meshes.get(k);
            if (existing) {
                existing.material = this.materials[colorIndex] || this.materials[0];
                this.world.set(k, colorIndex);
                return;
            }
            const mesh = new THREE.Mesh(this.geometry, this.materials[colorIndex] || this.materials[0]);
            mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
            mesh.userData = { cx: x, cy: y, cz: z };
            this.scene.add(mesh);
            this.meshes.set(k, mesh);
            this.world.set(k, colorIndex);
        }

        deleteBlock(x, y, z) {
            const k = VoxelWorld.key(x, y, z);
            const mesh = this.meshes.get(k);
            if (mesh) { this.scene.remove(mesh); this.meshes.delete(k); }
            this.world.delete(k);
        }

        clearAll() {
            this.meshes.forEach(m => this.scene.remove(m));
            this.meshes.clear();
            this.world.clear();
        }

        count() { return this.world.size; }

        encode() {
            const out = [];
            this.world.forEach((c, k) => {
                const [x, y, z] = k.split(',').map(Number);
                out.push([x, y, z, c]);
            });
            return out;
        }

        replaceFrom(blocks) {
            this.clearAll();
            if (Array.isArray(blocks)) {
                for (const b of blocks) {
                    if (!b || b.length < 4) continue;
                    const [x, y, z, c] = b;
                    if (this.inBounds(x, y, z)) this.setBlock(x, y, z, c);
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

        setRemoteCursor(peerId, x, y, z, hexColor) {
            let line = this.remoteCursors.get(peerId);
            if (!line) {
                const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(hexColor || '#ffffff') });
                line = new THREE.LineSegments(this.cursorGeometry, mat);
                this.remoteCursors.set(peerId, line);
                this.scene.add(line);
            }
            line.material.color.set(hexColor || '#ffffff');
            line.position.set(x + 0.5, y + 0.5, z + 0.5);
            line.visible = true;
        }

        removeRemoteCursor(peerId) {
            const line = this.remoteCursors.get(peerId);
            if (line) { this.scene.remove(line); this.remoteCursors.delete(peerId); }
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
            this.tool = 'build';            // 'build' | 'erase'
            this.undoStack = [];            // inverse edits of my own actions
            this._saveTimer = null;
            this._lastCursorSent = 0;
        }

        // ---------- lifecycle ----------
        async onInitialize() {
            this.voxels = new VoxelWorld(document.getElementById('sceneRoot'));
            this._buildPalette();
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
                    this.voxels.setRemoteCursor(peerId, data.x, data.y, data.z, data.color);
                    break;
            }
        }

        // ---------- edits ----------
        _applyEdit(edit) {
            if (!edit) return;
            if (edit.a === 'place' && this.voxels.inBounds(edit.x, edit.y, edit.z)) {
                this.voxels.setBlock(edit.x, edit.y, edit.z, edit.c);
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
            const inverse = (prev === undefined)
                ? { a: 'remove', x, y, z }
                : { a: 'place', x, y, z, c: prev };
            this._doLocalEdit({ a: 'place', x, y, z, c: this.currentColor }, inverse);
        }

        removeAt(x, y, z) {
            const prev = this.voxels.world.get(VoxelWorld.key(x, y, z));
            if (prev === undefined) return;
            this._doLocalEdit({ a: 'remove', x, y, z }, { a: 'place', x, y, z, c: prev });
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
                    if (dragging) { this.voxels.orbit(dx, dy); }
                    lastX = e.clientX; lastY = e.clientY;
                } else {
                    // Hover: broadcast my cursor cell to others (throttled)
                    this._maybeSendCursor(e.clientX, e.clientY);
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
        }

        _maybeSendCursor(clientX, clientY) {
            const now = Date.now();
            if (now - this._lastCursorSent < CURSOR_THROTTLE_MS) return;
            this._lastCursorSent = now;
            const pick = this.voxels.pick(clientX, clientY);
            if (!pick || !pick.place) return;
            const color = (typeof this.generateUserColor === 'function')
                ? this.generateUserColor(this.username) : '#ffffff';
            this.sendData({ type: 'cursor', x: pick.place.x, y: pick.place.y, z: pick.place.z, color });
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
                });
                palette.appendChild(sw);
            });
        }

        _bindUI() {
            document.getElementById('toolBuild').addEventListener('click', () => { this.tool = 'build'; this._syncTool(); });
            document.getElementById('toolErase').addEventListener('click', () => { this.tool = 'erase'; this._syncTool(); });
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
                if (k === 'b') { this.tool = 'build'; this._syncTool(); }
                else if (k === 'e') { this.tool = 'erase'; this._syncTool(); }
                else if (k === 'z') { this.undo(); }
                else if (k === 'r') { this.voxels.resetView(); }
            });
        }

        _syncTool() {
            document.getElementById('toolBuild').classList.toggle('active', this.tool === 'build');
            document.getElementById('toolErase').classList.toggle('active', this.tool === 'erase');
        }

        _updateBlockCount() {
            const n = this.voxels.count();
            document.getElementById('blockCount').textContent = n + (n === 1 ? ' block' : ' blocks');
        }

        _refreshPlayers() {
            const list = document.getElementById('playerList');
            if (!list) return;
            let users = [];
            try { users = this.getConnectedUsers() || []; } catch (e) { users = []; }
            const names = Array.from(new Set([this.username, ...users].filter(Boolean)));
            const hostName = this._hostName();

            list.innerHTML = names.map(name => {
                const color = (typeof this.generateUserColor === 'function') ? this.generateUserColor(name) : '#6366f1';
                const isYou = name === this.username;
                const isHost = hostName ? (name === hostName) : (isYou && this.isHost());
                return `<div class="player-row">
                    <span class="player-dot" style="background:${color}"></span>
                    <span class="player-name">${this._esc(name)}${isYou ? ' <span class="you">(you)</span>' : ''}</span>
                    ${isHost ? '<span class="player-host" title="Room host">👑</span>' : ''}
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
