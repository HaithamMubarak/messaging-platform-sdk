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
    // The world spans [-HALF, HALF] on X and Z: 161 x 161 cells, about ten
    // times the area it started with. Everything that frames it — the ground,
    // the grid, the fog, how far the camera may pull back — is derived from
    // this, so the size is one number to change.
    const HALF = 80;
    const MAX_Y = 40;             // build height ceiling
    const WORLD_SPAN = HALF * 2 + 1;
    const CAM_MIN_RADIUS = 6;
    // Far enough to see the whole world at once, on a tall phone as well as a
    // wide monitor — a world that is a map of somewhere is worth looking at
    // whole, and 1.9 spans only managed that in landscape.
    const CAM_MAX_RADIUS = Math.round(WORLD_SPAN * 3.4);
    const CAM_START_RADIUS = 40;
    const STORAGE_KEY = 'blockparty_world';
    const SAVE_DEBOUNCE_MS = 2500;
    const CURSOR_THROTTLE_MS = 120;
    const PLOT_COVER_H = 6;       // height of the cover that hides a rival's plot
    const MAX_FILL_CELLS = 1200;  // biggest region one fill may touch
    const BULK_CHUNK = 300;       // cells per wire message, to stay well under
                                  // the data-channel size limit
    const WORLD_CHUNK = 400;      // cells (or pieces) per world-snapshot message
    const PLAIN_SCALE = 9;        // how far the ground runs past the build area
    const CHUNK = 16;             // render chunk size on X/Z, in cells
    const CHUNK_BUDGET = 6;       // chunk rebuilds allowed per frame
    // The platform expires a session after 180s unless something the client
    // sends touches it. BlockParty talks over WebRTC almost exclusively, so a
    // room deep in a quiet three-minute round would let its session lapse and
    // channel storage would start refusing writes. A cheap read-only call keeps
    // it alive without putting any traffic into the room.
    const SESSION_KEEPALIVE_MS = 45000;   // comfortably inside the 180s window
    const MAX_IMAGE_CELLS = 9000;   // an imported picture is one bulk edit
    const SLOT_PREFIX = 'blockparty_slot_';
    const STATS_KEY = 'blockparty_stats';
    const GEO_SEEN_KEY = 'blockparty_geo_seen';

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
    // How much light a face catches by the way it points: a cheap stand-in for
    // sky light, and the reason a flat-shaded cube reads as a solid object
    // rather than a silhouette.
    const FACE_TINT = { top: 1.0, side: 0.80, sideAlt: 0.72, bottom: 0.55 };
    // Ambient occlusion baked per vertex at merge time: 0 (tucked into a corner)
    // to 3 (open air).
    const AO_BASE = 0.55, AO_STEP = 0.15;
    // In-world text is measured in world units, so a tag that reads well from
    // across the map blots out the view when you are standing next to it.
    const LABEL_CURSOR = 0.5;    // who is aiming where
    const LABEL_AVATAR = 0.34;   // over a player's head, read from a few paces
    const LABEL_PLOT = 0.55;     // a match plot's plaque
    const SKY_ZENITH = '#0b1226', SKY_HORIZON = '#31456e';
    // How far off the key light sits. Inside the shadow camera's far plane, and
    // far enough that its rays are parallel across the world.
    const SUN_DISTANCE = 130;
    // The grid texture is drawn near-white and tinted by this, so a map can
    // recolour the floor with one value. The default is the dark blue the
    // sandbox has always had.
    const GROUND_BASE = '#2f3853';
    const SHADOW_RADIUS = 46;     // how much of the world the sun's shadow covers

    /**
     * Colours are small integers on the wire. 0..11 are palette swatches; any
     * value with RGB_FLAG set carries a literal colour in its low 24 bits.
     * That keeps every saved world, every edit and every snapshot exactly as
     * compact as before for palette colours, while letting a block be any
     * colour at all — which is what makes an imported photograph look like the
     * photograph.
     */
    const RGB_FLAG = 1 << 24;
    const isRGB = c => typeof c === 'number' && c >= RGB_FLAG;
    const packRGB = (r, g, b) => RGB_FLAG | ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
    const hexOf = (c) => {
        if (!isRGB(c)) return PALETTE[c] || PALETTE[0];
        return '#' + ((c & 0xffffff) | 0x1000000).toString(16).slice(1);
    };

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
            // Rendering is per chunk, not per block: a 16x16 column of the world
            // is merged into one geometry per material. A world with 20,000
            // blocks is then a few hundred draw calls instead of 20,000.
            this.chunks = new Map();    // "cx,cz" -> { meshes: [], cells: Set, pieces: Set }
            // The highest block in each column, and what colour it is. Kept up
            // to date as blocks come and go so the minimap can be drawn without
            // walking the whole world every time.
            this.columns = new Map();   // "x,z" -> { top, hex }
            this.dirtyChunks = new Set();
            // A brick piece covers several cells but is one mesh and one thing
            // to break. Its cells are registered in world/owners too, so counts,
            // saves and blueprint scoring keep working per cell.
            this.pieces = new Map();    // pieceId -> { id, x, y, z, w, d, c, owner, cells, mesh }
            this.pieceOf = new Map();   // "x,y,z" -> pieceId
            this.brickLook = false;     // cubes render as studded 1x1 bricks
            this.remoteCursors = new Map(); // peerId -> { group, line, ghost, label, ... }
            this.avatars = new Map();       // peerId -> a little person walking about

            this.geometries = SHAPES.map(s => s.make());
            this.geometry = this.geometries[0];   // cube, the default
            this.materials = PALETTE.map(hex => {
                const m = new THREE.MeshLambertMaterial({ color: new THREE.Color(hex) });
                m.color.convertSRGBToLinear();
                return m;
            });
            // Chunks are drawn with vertex colours, so the palette is also kept
            // as plain linear RGB to bake in directly.
            this.paletteLinear = PALETTE.map(hex => new THREE.Color(hex).convertSRGBToLinear());
            // One material for every chunk in the world: colour, shading and
            // occlusion all live in the vertex data.
            this.chunkMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
            // Translucent twins of the palette, for placement ghosts.
            this.ghostMaterials = PALETTE.map(hex => new THREE.MeshLambertMaterial({
                color: new THREE.Color(hex).convertSRGBToLinear(), transparent: true, opacity: 0.45, depthWrite: false
            }));
            // A more solid set for the blueprint you are studying — it has to be
            // readable at a glance in three seconds.
            this.blueprintMaterials = PALETTE.map(hex => new THREE.MeshLambertMaterial({
                color: new THREE.Color(hex).convertSRGBToLinear(), transparent: true, opacity: 0.78
            }));
            this.cursorGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02, 1.02, 1.02));
            this.preview = null;        // local placement ghost (built lazily)

            this.half = HALF;           // the world's reach, for anyone who asks
            this.arena = null;          // match plots (group), null in the sandbox
            this.pads = new Map();      // player name -> { group, cover, label, ... }
            this.ghostGroups = new Map(); // id -> blueprint ghost group

            this._initScene();
            this.fx = new BlockPartyFx(this.scene, { software: this.software });
            this._initCamera();
            this._bindResize();
        }

        _initScene() {
            const w = window.innerWidth, h = window.innerHeight;

            this.renderer = new THREE.WebGLRenderer({ antialias: true });
            this.renderer.setSize(w, h);

            // Software rendering (SwiftShader, llvmpipe) turns up in CI and on
            // machines without a GPU. It cannot afford shadows or a retina
            // buffer, so ask what we are running on before spending anything.
            this.software = VoxelWorld.isSoftwareRenderer(this.renderer);
            this.renderer.setPixelRatio(this.software ? 1 : Math.min(window.devicePixelRatio || 1, 2));

            // Colour pipeline. Without these the palette renders washed out and
            // highlights blow to white; with them the darks hold.
            this.renderer.outputEncoding = THREE.sRGBEncoding;
            this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
            this.renderer.toneMappingExposure = 1.1;
            if (!this.software) {
                this.renderer.shadowMap.enabled = true;
                this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            }
            this.mountEl.appendChild(this.renderer.domElement);

            this.scene = new THREE.Scene();
            this.scene.background = new THREE.Color(SKY_HORIZON);
            // Fog hides the far edge without hiding the build you walked away
            // from, so it is pinned to the world's size rather than a constant.
            // Fog matches the horizon, so distance melts into the sky rather
            // than into a dark band.
            this.scene.fog = new THREE.Fog(SKY_HORIZON, WORLD_SPAN * 0.55, WORLD_SPAN * 2.6);

            // Two lights, deliberately: each extra one slows the shader on every
            // merged chunk. Warm key, cool sky, warm bounce off the ground.
            const hemi = new THREE.HemisphereLight('#a8c4ff', '#3a3226', 0.55);
            this.scene.add(hemi);
            this.hemi = hemi;
            const dir = new THREE.DirectionalLight('#fff4e0', 0.85);
            dir.position.set(60, 90, 40);
            if (!this.software) {
                dir.castShadow = true;
                dir.shadow.mapSize.set(2048, 2048);
                // A shadow camera spanning all 161 units would give a dozen
                // texels per cell — mush. It covers what you are looking at and
                // follows the camera instead, snapped to whole texels so the
                // edges do not crawl while you orbit.
                const R = SHADOW_RADIUS;
                dir.shadow.camera.left = -R; dir.shadow.camera.right = R;
                dir.shadow.camera.top = R; dir.shadow.camera.bottom = -R;
                dir.shadow.camera.near = 1; dir.shadow.camera.far = 400;
                dir.shadow.bias = -0.0005;
                dir.shadow.normalBias = 0.02;
            }
            this.scene.add(dir);
            this.scene.add(dir.target);
            this.sun = dir;

            // Ground plane (pick target for floor placement). Its grid is a
            // texture rather than two GridHelpers: it mipmaps away with distance
            // instead of moiring, takes shadow and fog, and stops two helper
            // meshes z-fighting the floor.
            const size = WORLD_SPAN;
            const groundMat = new THREE.MeshLambertMaterial({
                map: this._gridTexture(), color: new THREE.Color(GROUND_BASE).convertSRGBToLinear()
            });
            this.ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), groundMat);
            this.ground.rotation.x = -Math.PI / 2;
            this.ground.position.set(0, 0, 0);
            // Beyond the buildable square, the ground carries on to the
            // horizon. Without it the world reads as a table top floating in
            // space; with it, the build area is a place within somewhere
            // larger — which is also what being pinned to real coordinates
            // implies.
            const plainGeo = new THREE.PlaneGeometry(size * PLAIN_SCALE, size * PLAIN_SCALE);
            const plain = new THREE.Mesh(plainGeo, new THREE.MeshLambertMaterial({
                map: this._gridTexture(PLAIN_SCALE), color: new THREE.Color(GROUND_BASE).convertSRGBToLinear()
            }));
            plain.rotation.x = -Math.PI / 2;
            plain.position.y = -0.08;      // just under the build area, never z-fighting it
            plain.receiveShadow = false;
            this.scene.add(plain);
            this.plain = plain;

            this.ground.userData.isGround = true;
            this.ground.receiveShadow = !this.software;
            this.scene.add(this.ground);
            this.skyDome = this._skyDome();
            this.scene.add(this.skyDome);
            // Which way the key light comes from. Replaced by the real sun once
            // the world knows where on Earth it is standing.
            this.sunDir = new THREE.Vector3(60, 90, 40).normalize();
            this.skyMode = 'real';
            // Off the map until told otherwise, and explicitly so: the lighting
            // is set from one place rather than left wherever construction
            // happened to leave it.
            this._defaultSky();

            this.raycaster = new THREE.Raycaster();
        }

        /**
         * Is this a software renderer? Shadows and a retina buffer are the first
         * things to cost more than they are worth when there is no GPU.
         */
        static isSoftwareRenderer(renderer) {
            try {
                const gl = renderer.getContext();
                const ext = gl.getExtension('WEBGL_debug_renderer_info');
                const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
                return /swiftshader|llvmpipe|software|basic render/i.test(name);
            } catch (e) {
                return false;
            }
        }

        /**
         * Tint the ground. A map that wants snow or regolith says so with one
         * colour rather than laying 24,000 blocks over the floor to say it.
         */
        /**
         * Lay a map over the ground, or take it away.
         *
         * The shape of the place belongs to the floor, not to a hundred
         * thousand blocks: people came here to build, and a world that arrives
         * already full of somebody else's cubes is a world you have to clear
         * before you can start. So the coastline is painted, and every block in
         * the world is one a person put there.
         */
        setGroundMap(canvas) {
            const mat = this.ground.material;
            if (mat.map && mat.map !== this._gridTex) mat.map.dispose();
            if (!canvas) {
                if (!this._gridTex) this._gridTex = this._gridTexture();
                mat.map = this._gridTex;
                this.groundMapped = false;
                this.setGroundTint(this.groundTint);
                mat.needsUpdate = true;
                return;
            }
            const tex = new THREE.CanvasTexture(canvas);
            tex.encoding = THREE.sRGBEncoding;
            tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
            try { tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy(); } catch (e) { /* fine */ }
            mat.map = tex;
            // The paint carries its own colour; tinting it would only muddy it.
            mat.color.setRGB(1, 1, 1);
            mat.needsUpdate = true;
            this.groundMapped = true;
        }

        setGroundTint(hex) {
            this.groundTint = hex || null;
            const c = new THREE.Color(hex || GROUND_BASE).convertSRGBToLinear();
            if (!this.groundMapped) this.ground.material.color.copy(c);
            // The land beyond the build area is the same ground, a shade darker
            // so the edge of what you can build on stays legible.
            if (this.plain) this.plain.material.color.copy(c).multiplyScalar(0.62);
        }

        /** A gradient dome, so the world has a sky rather than a clear colour. */
        _skyDome() {
            const geo = new THREE.SphereGeometry(WORLD_SPAN * 2.8, 24, 12);
            geo.setAttribute('color',
                new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
            const dome = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
                vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false
            }));
            dome.renderOrder = -1;
            this._paintSky(dome, SKY_ZENITH, SKY_HORIZON);
            return dome;
        }

        /**
         * Repaint the dome between two colours. It is 325 vertices, so the sky
         * changing colour costs less than one frame's worth of anything else —
         * which is why the sky can follow the sun rather than being baked once.
         */
        _paintSky(dome, zenithHex, horizonHex) {
            const geo = dome.geometry;
            const pos = geo.attributes.position, col = geo.attributes.color;
            const zenith = new THREE.Color(zenithHex).convertSRGBToLinear();
            const horizon = new THREE.Color(horizonHex).convertSRGBToLinear();
            const c = new THREE.Color();
            for (let i = 0; i < pos.count; i++) {
                // Blend on height, with a bias that keeps the horizon band tight.
                const t = Math.pow(Math.max(0, pos.getY(i) / (WORLD_SPAN * 2.8)), 0.55);
                c.copy(horizon).lerp(zenith, t);
                col.setXYZ(i, c.r, c.g, c.b);
            }
            col.needsUpdate = true;
        }

        // ---- the sky, from the place and the hour --------------------------
        /**
         * Put the sun where it really is.
         *
         * The world knows its latitude and longitude and the browser knows the
         * time, which is all the almanac needs — so an evening in your own
         * street is lit from the west, low and orange, and nobody had to be
         * told. Every client derives it from the same anchor and the same
         * clock, so a room agrees on the sky without sending anything.
         *
         * Off the map there is no "where", so a private world keeps the fixed
         * dusk it has always had.
         */
        applySky(when) {
            const Sky = window.BlockPartySky;
            const anchor = this.geoAnchor;
            if (!Sky || !anchor || this.skyMode === 'off') { this._defaultSky(); return null; }

            const sun = Sky.position(anchor.lat, anchor.lon, when);
            const p = Sky.palette(sun.elevation, this.skyMode);
            const d = Sky.direction(sun.elevation, sun.azimuth);
            this.sunDir = new THREE.Vector3(d.x, d.y, d.z);

            this.sun.color.set(new THREE.Color(p.key).convertSRGBToLinear());
            this.sun.intensity = p.keyIntensity;
            this.hemi.color.set(new THREE.Color(p.hemiSky).convertSRGBToLinear());
            this.hemi.groundColor.set(new THREE.Color(p.hemiGround).convertSRGBToLinear());
            this.hemi.intensity = p.hemiIntensity;
            // ACES can go muddy at the dim end, so the exposure lifts with the
            // sun rather than being left where midday put it.
            this.renderer.toneMappingExposure = p.exposure;

            this._paintSky(this.skyDome, p.zenith, p.horizon);
            this.scene.background.set(new THREE.Color(p.horizon));
            if (this.scene.fog) this.scene.fog.color.set(new THREE.Color(p.horizon));
            this._updateSun();

            this.sky = { elevation: sun.elevation, azimuth: sun.azimuth, night: p.night, dusk: p.dusk };
            return this.sky;
        }

        /** The fixed dusk a world off the map has always had. */
        _defaultSky() {
            this.sunDir = new THREE.Vector3(60, 90, 40).normalize();
            this.sun.color.set(new THREE.Color('#fff4e0').convertSRGBToLinear());
            this.sun.intensity = 0.85;
            this.hemi.color.set(new THREE.Color('#a8c4ff').convertSRGBToLinear());
            this.hemi.groundColor.set(new THREE.Color('#3a3226').convertSRGBToLinear());
            this.hemi.intensity = 0.55;
            this.renderer.toneMappingExposure = 1.1;
            this._paintSky(this.skyDome, SKY_ZENITH, SKY_HORIZON);
            this.scene.background.set(new THREE.Color(SKY_HORIZON));
            if (this.scene.fog) this.scene.fog.color.set(new THREE.Color(SKY_HORIZON));
            this._updateSun();
            this.sky = null;
        }

        /** 'real' — the truth, floored so night stays playable — or 'day'. */
        setSkyMode(mode) {
            this.skyMode = mode || 'real';
            this.applySky();
        }

        /** The floor grid, drawn once into a texture and tiled per cell. */
        _gridTexture(scale) {
            const S = 64;
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = S;
            const ctx = canvas.getContext('2d');
            // Drawn light so the ground's tint comes through it; a map can then
            // turn the floor to snow or regolith by colour alone.
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, S, S);
            ctx.strokeStyle = '#c9d4e8';
            ctx.lineWidth = 2;
            ctx.strokeRect(0, 0, S, S);
            const tex = new THREE.CanvasTexture(canvas);
            tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
            tex.repeat.set(WORLD_SPAN * (scale || 1), WORLD_SPAN * (scale || 1));
            tex.encoding = THREE.sRGBEncoding;
            try {
                tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
            } catch (e) { /* not fatal */ }
            return tex;
        }

        _initCamera() {
            this.camera = new THREE.PerspectiveCamera(
                60, window.innerWidth / window.innerHeight, 0.1, WORLD_SPAN * 6);
            this.target = new THREE.Vector3(0, 2, 0);
            this.cam = { theta: Math.PI * 0.25, phi: Math.PI * 0.32, radius: CAM_START_RADIUS };
            // Where "reset view" goes back to. A match repoints it at your plot.
            this.home = { x: 0, y: 2, z: 0, radius: CAM_START_RADIUS, phi: Math.PI * 0.32 };
            this._applyCamera();
        }

        /**
         * Reset the view: everything that is standing, framed, looking north.
         *
         * A world that is a map wants to be looked at like a map — square on,
         * north up, all of it on screen. So reset frames what actually exists
         * rather than returning to a fixed spot: the whole Earth if that is
         * what is there, a handful of bricks if that is.
         */
        resetView() {
            const half = this.half;
            // With nothing built, the ground itself is what there is to see —
            // and when it is a map of somewhere, all of it is worth seeing.
            const b = this.contentBounds()
                || (this.groundMapped ? { minX: -half, maxX: half, minZ: -half, maxZ: half } : null);
            if (!b) {
                // Nothing built: the view it opened with.
                this.target.set(this.home.x, this.home.y, this.home.z);
                this.cam = { theta: Math.PI * 0.25, phi: this.home.phi || Math.PI * 0.32,
                             radius: this.home.radius };
                this._applyCamera();
                return;
            }

            const phi = Math.PI * 0.14;                    // 25° off straight down
            const spanX = b.maxX - b.minX + 1, spanZ = b.maxZ - b.minZ + 1;
            const fov = this.camera.fov * Math.PI / 180;
            const aspect = this.camera.aspect || 1;
            // Far enough back that both spans fit, with a little air around it.
            // Tilting foreshortens depth, which is why the Z span is divided.
            const byHeight = (spanZ / Math.cos(phi)) / (2 * Math.tan(fov / 2));
            const byWidth = spanX / (2 * Math.tan(fov / 2) * aspect);
            // The extra is for the header and the toolbar, which cover the top
            // and bottom of the screen and would otherwise eat the edges.
            const radius = Math.max(byHeight, byWidth) * 1.34;

            this.target.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
            this.cam = {
                theta: -Math.PI / 2,                       // north at the top
                phi,
                radius: Math.max(CAM_MIN_RADIUS, Math.min(CAM_MAX_RADIUS, radius))
            };
            this._applyCamera();
        }

        /** The box everything standing fits inside, or null if nothing does. */
        contentBounds() {
            if (!this.columns || !this.columns.size) return null;
            let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
            this.columns.forEach((col, key) => {
                const comma = key.indexOf(',');
                const x = +key.slice(0, comma), z = +key.slice(comma + 1);
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (z < minZ) minZ = z;
                if (z > maxZ) maxZ = z;
            });
            return isFinite(minX) ? { minX, maxX, minZ, maxZ } : null;
        }

        /**
         * Hand the camera to the first-person controller, or take it back.
         * Orbiting, the drag-to-look and the placement ghost all key off this.
         */
        setFirstPerson(on) {
            this.firstPerson = !!on;
            this.hideLandingShadow();
            if (!on) {
                this.camera.rotation.set(0, 0, 0);
                this._applyCamera();
            }
        }

        /** Put the camera at the player's eye, looking where they look. */
        setEyeCamera(eye, yaw, pitch) {
            this.camera.position.copy(eye);
            this.camera.rotation.order = 'YXZ';
            this.camera.rotation.set(pitch, yaw, 0);
            this.target.set(
                eye.x - Math.sin(yaw) * 8,
                eye.y + Math.sin(pitch) * 8,
                eye.z - Math.cos(yaw) * 8
            );
            this._updateSun();
        }

        /**
         * Turn slowly around the current target. A reveal shot that holds
         * perfectly still looks like a paused game.
         */
        startDrift(rate) { this._drift = rate || 0; }

        _applyDrift(dt) {
            if (!this._drift || this.firstPerson) return;
            this.cam.theta += this._drift * dt;
            this._applyCamera();
        }

        // Point the camera at a spot in the world. `phi` (optional) sets the
        // pitch, so a match can frame a plot from above without the player
        // having to re-aim after every round.
        focus(x, y, z, radius, phi) {
            this.target.set(x, y, z);
            if (radius) this.cam.radius = Math.max(CAM_MIN_RADIUS, Math.min(CAM_MAX_RADIUS, radius));
            if (phi) this.cam.phi = Math.max(0.12, Math.min(Math.PI / 2 - 0.02, phi));
            this.home = { x, y, z, radius: this.cam.radius, phi: this.cam.phi };
            this._applyCamera();
        }

        /**
         * Keep the sun's shadow box over what the player is looking at, snapped
         * to whole shadow texels so its edges do not crawl while orbiting.
         */
        _updateSun() {
            // The sky is set once while the scene is still being assembled, and
            // the camera target does not exist yet at that point. The render
            // loop calls this on every frame, so there is nothing to catch up.
            if (!this.sun || !this.target) return;
            // Software renderers cast no shadows, so there is no shadow box to
            // snap — but the light still has to come from the right direction.
            let sx = this.target.x, sz = this.target.z;
            if (!this.software) {
                const texel = (SHADOW_RADIUS * 2) / 2048;
                sx = Math.round(sx / texel) * texel;
                sz = Math.round(sz / texel) * texel;
            }
            const d = this.sunDir || new THREE.Vector3(60, 90, 40).normalize();
            this.sun.target.position.set(sx, 0, sz);
            this.sun.position.set(sx + d.x * SUN_DISTANCE, d.y * SUN_DISTANCE, sz + d.z * SUN_DISTANCE);
            this.sun.target.updateMatrixWorld();
        }

        _applyCamera() {
            const { theta, phi, radius } = this.cam;
            const x = this.target.x + radius * Math.sin(phi) * Math.cos(theta);
            const y = this.target.y + radius * Math.cos(phi);
            const z = this.target.z + radius * Math.sin(phi) * Math.sin(theta);
            this.camera.position.set(x, y, z);
            this.camera.lookAt(this.target);
            this._updateSun();
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
            // Proportional zoom: a step that feels right next to a brick would
            // take forever to cross the world from high up.
            const scaled = delta * Math.max(1, this.cam.radius / 30);
            this.cam.radius = Math.max(CAM_MIN_RADIUS, Math.min(CAM_MAX_RADIUS, this.cam.radius + scaled));
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
                const now = performance.now();
                const dt = Math.min(0.05, (now - (this._lastFrame || now)) / 1000);
                this._lastFrame = now;
                this.stepFollow();
                this._applyDrift(dt);
                this._animateAvatars(dt);
                this._bobSpawnGhost();
                this.fx.update(dt);
                this.flushChunks();
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

        // ---- chunked rendering -------------------------------------------
        static chunkKey(x, z) {
            return Math.floor(x / CHUNK) + ',' + Math.floor(z / CHUNK);
        }

        _chunk(ck) {
            let c = this.chunks.get(ck);
            if (!c) {
                c = { meshes: [], cells: new Set(), pieces: new Set() };
                this.chunks.set(ck, c);
            }
            return c;
        }

        _touchChunk(ck) { this.dirtyChunks.add(ck); }

        /**
         * Mark this cell's chunk and its neighbours. A block becoming solid can
         * bury the one next to it, and a block going away can expose it — and
         * that neighbour may live in the next chunk along.
         */
        _touchAround(x, z) {
            this._touchChunk(VoxelWorld.chunkKey(x, z));
            this._touchChunk(VoxelWorld.chunkKey(x - 1, z));
            this._touchChunk(VoxelWorld.chunkKey(x + 1, z));
            this._touchChunk(VoxelWorld.chunkKey(x, z - 1));
            this._touchChunk(VoxelWorld.chunkKey(x, z + 1));
        }

        /**
         * Is this block completely walled in? A mountain is mostly interior:
         * 43,000 blocks of rock with only its surface ever visible. Skipping
         * what cannot be seen is the difference between a cave you can walk
         * into and a cave that will not render.
         */
        _enclosed(x, y, z) {
            return this.world.has((x + 1) + ',' + y + ',' + z)
                && this.world.has((x - 1) + ',' + y + ',' + z)
                && this.world.has(x + ',' + (y + 1) + ',' + z)
                && this.world.has(x + ',' + (y - 1) + ',' + z)
                && this.world.has(x + ',' + y + ',' + (z + 1))
                && this.world.has(x + ',' + y + ',' + (z - 1));
        }

        /**
         * The raw vertex arrays for a geometry, cached.
         *
         * Merging by hand rather than cloning THREE geometries: every block in a
         * chunk is the same handful of shapes at different offsets, so the merge
         * is a copy with an added translation. Cloning geometry objects for
         * thousands of blocks is what makes a naive chunk rebuild slow.
         */
        _template(geo) {
            if (!this._templates) this._templates = new Map();
            let t = this._templates.get(geo);
            if (!t) {
                const g = geo.index ? geo.toNonIndexed() : geo;
                t = {
                    pos: g.attributes.position.array,
                    norm: g.attributes.normal.array,
                    count: g.attributes.position.count
                };
                this._templates.set(geo, t);
            }
            return t;
        }

        /**
         * How dark this vertex is: the tint its face gets from the direction it
         * points, times ambient occlusion from the blocks tucked around it.
         *
         * The occlusion is the standard voxel trick. A vertex on a flat face has
         * four cells meeting it in the layer just outside that face; one is the
         * empty cell the face looks into, and the other three are what can shut
         * the light out. Count them and darken accordingly. Faces that are not
         * axis-aligned (spheres, cones) just take the directional tint.
         */
        _shadeAt(px, py, pz, nx, ny, nz) {
            const tint = ny > 0.9 ? FACE_TINT.top
                : ny < -0.9 ? FACE_TINT.bottom
                    : (Math.abs(nx) > 0.9 ? FACE_TINT.sideAlt : FACE_TINT.side);

            const axis = Math.abs(nx) > 0.99 ? 0 : (Math.abs(ny) > 0.99 ? 1 : (Math.abs(nz) > 0.99 ? 2 : -1));
            if (axis < 0) return tint;      // curved surface: tint only

            // Step half a cell out from the face; the four cells that meet the
            // vertex there are the candidates.
            const qx = px + nx * 0.5, qy = py + ny * 0.5, qz = pz + nz * 0.5;
            const E = 0.25;
            const t1 = axis === 0 ? [0, 1, 0] : [1, 0, 0];
            const t2 = axis === 2 ? [0, 1, 0] : [0, 0, 1];

            // Count how many of those four cells are solid. Three is a vertex
            // wedged into a corner, none is a vertex out in the open. (The
            // textbook version weighs the two edge-adjacent cells against the
            // diagonal one; telling them apart needs to know which cell the
            // face looks into, and a straight count reads the same on screen.)
            let solid = 0;
            const E2 = E;
            for (const s1 of [-1, 1]) {
                for (const s2 of [-1, 1]) {
                    const cx = Math.floor(qx + t1[0] * s1 * E2 + t2[0] * s2 * E2);
                    const cy = Math.floor(qy + t1[1] * s1 * E2 + t2[1] * s2 * E2);
                    const cz = Math.floor(qz + t1[2] * s1 * E2 + t2[2] * s2 * E2);
                    if (this.world.has(cx + ',' + cy + ',' + cz)) solid++;
                }
            }
            const ao = Math.max(0, 3 - solid);
            return tint * (AO_BASE + AO_STEP * ao);
        }

        /** The linear-space colour a block draws in, palette or owner. */
        _linearFor(colorIndex, owner) {
            if (this.xray) {
                if (!this._ownerLinear) this._ownerLinear = new Map();
                const hex = (owner && this._xrayColorFor) ? this._xrayColorFor(owner) : '#64748b';
                let c = this._ownerLinear.get(hex);
                if (!c) {
                    c = new THREE.Color(hex).convertSRGBToLinear();
                    this._ownerLinear.set(hex, c);
                }
                return c;
            }
            if (isRGB(colorIndex)) {
                if (!this._rgbLinear) this._rgbLinear = new Map();
                let c = this._rgbLinear.get(colorIndex);
                if (!c) {
                    c = new THREE.Color(hexOf(colorIndex)).convertSRGBToLinear();
                    this._rgbLinear.set(colorIndex, c);
                }
                return c;
            }
            return this.paletteLinear[colorIndex] || this.paletteLinear[0];
        }

        _materialFor(colorIndex, owner) {
            if (this.xray) return this._ownerMaterial(owner);
            return this.materials[colorIndex] || this.materials[0];
        }

        /** Rebuild one chunk's merged meshes from the world model. */
        _rebuildChunk(ck) {
            const chunk = this.chunks.get(ck);
            if (!chunk) return;
            chunk.meshes.forEach(m => {
                this.scene.remove(m);
                m.geometry.dispose();
            });
            chunk.meshes = [];

            // Everything in the chunk goes into one buffer. Colour, the tint a
            // face gets from the way it points, and baked occlusion all travel
            // as vertex colours — which is why a whole chunk is a single draw
            // call with a single material.
            const parts = [];
            let verts = 0;
            const add = (tmpl, ox, oy, oz, colorIndex, owner) => {
                parts.push({ tmpl, ox, oy, oz, color: this._linearFor(colorIndex, owner) });
                verts += tmpl.count;
            };

            chunk.cells.forEach(k => {
                if (this.pieceOf.has(k)) return;          // drawn as part of its brick
                if (!this.world.has(k)) return;
                const [x, y, z] = k.split(',').map(Number);
                if (y > 0 && this._enclosed(x, y, z)) return;   // buried: nobody can see it
                const si = this.shapes.get(k) || 0;
                const tmpl = this._template(this._cellGeometry(si));
                const c = this.world.get(k), owner = this.owners.get(k);
                if (si === 0 && this.brickLook) add(tmpl, x, y, z, c, owner);
                else add(tmpl, x + 0.5, y + shapeAt(si).cy, z + 0.5, c, owner);
            });

            chunk.pieces.forEach(id => {
                const p = this.pieces.get(id);
                if (!p) return;
                add(this._template(BlockPartyBricks.geometry(p.w, p.d)), p.x, p.y, p.z, p.c, p.owner);
            });

            if (verts) {
                const position = new Float32Array(verts * 3);
                const normal = new Float32Array(verts * 3);
                const color = new Float32Array(verts * 3);
                let at = 0;
                parts.forEach(part => {
                    const { tmpl, ox, oy, oz } = part;
                    for (let i = 0; i < tmpl.count; i++) {
                        const s3 = i * 3, d3 = (at + i) * 3;
                        const px = tmpl.pos[s3] + ox;
                        const py = tmpl.pos[s3 + 1] + oy;
                        const pz = tmpl.pos[s3 + 2] + oz;
                        const nx = tmpl.norm[s3], ny = tmpl.norm[s3 + 1], nz = tmpl.norm[s3 + 2];
                        position[d3] = px; position[d3 + 1] = py; position[d3 + 2] = pz;
                        normal[d3] = nx; normal[d3 + 1] = ny; normal[d3 + 2] = nz;

                        const shade = this._shadeAt(px, py, pz, nx, ny, nz);
                        color[d3] = part.color.r * shade;
                        color[d3 + 1] = part.color.g * shade;
                        color[d3 + 2] = part.color.b * shade;
                    }
                    at += tmpl.count;
                });
                const geo = new THREE.BufferGeometry();
                geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
                geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
                geo.setAttribute('color', new THREE.BufferAttribute(color, 3));
                geo.computeBoundingSphere();
                const mesh = new THREE.Mesh(geo, this.chunkMaterial);
                mesh.userData.chunk = ck;
                mesh.castShadow = !this.software;
                mesh.receiveShadow = !this.software;
                this.scene.add(mesh);
                chunk.meshes.push(mesh);
            }

            if (!chunk.cells.size && !chunk.pieces.size) this.chunks.delete(ck);
            this._dirtyTargets();
        }

        /**
         * Flush pending chunk rebuilds. Called once per frame with a budget, so
         * dropping a map of 10,000 blocks costs several frames rather than one
         * long freeze.
         */
        flushChunks(budget) {
            if (!this.dirtyChunks.size) return 0;
            let done = 0;
            for (const ck of this.dirtyChunks) {
                this._rebuildChunk(ck);
                this.dirtyChunks.delete(ck);
                if (++done >= (budget || CHUNK_BUDGET)) break;
            }
            return done;
        }

        /** How many meshes the world currently costs to draw. */
        drawCalls() {
            let n = 0;
            this.chunks.forEach(c => { n += c.meshes.length; });
            return n;
        }

        /** Rebuild everything — after an x-ray toggle or a brick-look change. */
        _rebuildAll() {
            this.chunks.forEach((_c, ck) => this.dirtyChunks.add(ck));
        }

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
            this._rebuildAll();
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

            this.world.set(k, colorIndex);
            this._chunk(VoxelWorld.chunkKey(x, z)).cells.add(k);
            this._touchAround(x, z);
            this._raiseColumn(x, y, z, colorIndex);
        }

        _raiseColumn(x, y, z, colorIndex) {
            const ck = x + ',' + z;
            const col = this.columns.get(ck);
            if (!col || y >= col.top) this.columns.set(ck, { top: y, hex: hexOf(colorIndex) });
        }

        /** Something went from this column; find the new top of it. */
        _rescanColumn(x, z) {
            const ck = x + ',' + z;
            const col = this.columns.get(ck);
            if (!col) return;
            for (let y = col.top; y >= 0; y--) {
                const k = VoxelWorld.key(x, y, z);
                if (this.world.has(k)) {
                    this.columns.set(ck, { top: y, hex: hexOf(this.world.get(k)) });
                    return;
                }
            }
            this.columns.delete(ck);
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

            const keys = [];
            cells.forEach(([x, y, z]) => {
                const k = VoxelWorld.key(x, y, z);
                keys.push(k);
                this.world.set(k, p.c);
                this.shapes.delete(k);                  // brick cells are cubes
                if (p.owner) this.owners.set(k, p.owner);
                this.pieceOf.set(k, p.id);
            });
            this.pieces.set(p.id, Object.assign({}, p, { cells: keys }));
            // A brick can straddle a chunk edge, so every chunk it touches has to
            // redraw — but it is only ever *owned* by the chunk of its corner.
            const home = VoxelWorld.chunkKey(p.x, p.z);
            this._chunk(home).pieces.add(p.id);
            this._touchChunk(home);
            this._touchChunk(VoxelWorld.chunkKey(p.x + p.w - 1, p.z + p.d - 1));
        }

        deletePiece(id) {
            const piece = this.pieces.get(id);
            if (!piece) return;
            piece.cells.forEach(k => {
                this.pieceOf.delete(k);
                this.world.delete(k);
                this.owners.delete(k);
                this.shapes.delete(k);
                const [x, , z] = k.split(',').map(Number);
                const c = this.chunks.get(VoxelWorld.chunkKey(x, z));
                if (c) c.cells.delete(k);
                this._touchAround(x, z);
                this._rescanColumn(x, z);
            });
            const home = VoxelWorld.chunkKey(piece.x, piece.z);
            const hc = this.chunks.get(home);
            if (hc) { hc.pieces.delete(id); this._touchChunk(home); }
            this.pieces.delete(id);
        }

        deleteBlock(x, y, z) {
            const k = VoxelWorld.key(x, y, z);
            // Breaking any stud of a brick takes the whole brick off.
            const pieceId = this.pieceOf.get(k);
            if (pieceId) { this.deletePiece(pieceId); return; }
            this.world.delete(k);
            this.owners.delete(k);
            this.shapes.delete(k);
            const c = this.chunks.get(VoxelWorld.chunkKey(x, z));
            if (c) c.cells.delete(k);
            this._touchAround(x, z);
            this._rescanColumn(x, z);
        }

        clearAvatars() {
            Array.from(this.avatars.keys()).forEach(id => this.removeAvatar(id));
        }

        clearAll() {
            this.chunks.forEach(c => c.meshes.forEach(m => {
                this.scene.remove(m);
                m.geometry.dispose();
            }));
            this.chunks.clear();
            this.dirtyChunks.clear();
            this.columns.clear();
            this.pieces.clear();
            this.pieceOf.clear();
            this.world.clear();
            this.owners.clear();
            this.shapes.clear();
            this._dirtyTargets();
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
            const hits = this.raycaster.intersectObjects(this._pickTargets(), false);
            if (!hits.length) return null;

            const hit = hits[0];
            const ud = hit.object.userData || {};
            if (ud.isGround) {
                const x = Math.floor(hit.point.x);
                const z = Math.floor(hit.point.z);
                return { place: { x, y: 0, z }, remove: null };
            }

            // A merged chunk is one mesh for hundreds of blocks, so the cell has
            // to be worked out from where the ray landed rather than read off
            // the object. Step just inside the surface and floor it; the
            // candidates cover the awkward cases — a stud poking up into the
            // cell above, and the rounded shapes whose surface sits well inside
            // their cell.
            const n = hit.face.normal;
            const p = hit.point;
            const at = (dx, dy, dz) => ({
                x: Math.floor(p.x - n.x * dx), y: Math.floor(p.y - n.y * dy), z: Math.floor(p.z - n.z * dz)
            });
            const candidates = [at(0.02, 0.02, 0.02), at(0.5, 0.5, 0.5)];
            const first = candidates[0];
            candidates.push({ x: first.x, y: first.y - 1, z: first.z });   // hit a stud
            const cell = candidates.find(c => this.hasBlock(c.x, c.y, c.z)) || first;

            const place = { x: cell.x + Math.round(n.x), y: cell.y + Math.round(n.y), z: cell.z + Math.round(n.z) };
            return { place, remove: cell };
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
            p.material = blocked ? this._blockedMaterial() : this._ghostForColor(colorIndex);
            p.position.set(x, y, z);
        }

        hidePiecePreview() { if (this.piecePreview) this.piecePreview.visible = false; }

        // ---- landing shadow ----
        /**
         * Where the ghost would come down.
         *
         * From an oblique orbit camera you cannot tell which column a block
         * held in mid-air is over — depth and height look the same on screen —
         * so tall builds quietly accumulate blocks one column out. A dark patch
         * on top of whatever is under the ghost, and a thread down to it, says
         * which column it is. The columns index already holds the top of every
         * (x, z), so this costs a lookup per footprint cell and nothing else.
         */
        showLandingShadow(x, y, z, w, d) {
            if (this.firstPerson) { this.hideLandingShadow(); return; }
            w = w || 1; d = d || 1;

            // The highest thing under the footprint is what it would land on.
            let ground = 0;
            for (let i = 0; i < w; i++) {
                for (let j = 0; j < d; j++) {
                    const col = this.columns.get((x + i) + ',' + (z + j));
                    if (col && col.top + 1 > ground) ground = col.top + 1;
                }
            }
            // Sitting on it already: two translucent quads in the same place
            // read as a smudge, not as a shadow.
            if (ground >= y) { this.hideLandingShadow(); return; }

            if (!this.landingShadow) {
                const plane = new THREE.PlaneGeometry(1, 1);
                plane.rotateX(-Math.PI / 2);
                plane.translate(0.5, 0, 0.5);       // corner origin, like a piece
                const patch = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({
                    color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false
                }));
                const thread = new THREE.Line(
                    new THREE.BufferGeometry().setFromPoints(
                        [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)]),
                    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28 })
                );
                const group = new THREE.Group();
                group.add(patch);
                group.add(thread);
                this.scene.add(group);
                this.landingShadow = { group, patch, thread };
            }

            const sh = this.landingShadow;
            sh.group.visible = true;
            sh.patch.position.set(x, ground + 0.02, z);   // just clear of the face
            sh.patch.scale.set(w, 1, d);
            sh.thread.position.set(x + w / 2, ground, z + d / 2);
            sh.thread.scale.y = Math.max(0.001, y - ground);
        }

        hideLandingShadow() { if (this.landingShadow) this.landingShadow.group.visible = false; }

        // ---- "stand here": the marker for dropping into first person ----
        /**
         * Where you would be standing, drawn as somebody standing there.
         *
         * Arming first person asks you to click a spot, and the ghost under the
         * pointer used to be the brick you would otherwise have placed — a
         * brick to answer "where do you want to stand?". This is the same
         * figure the other players see walking about, in outline: it stands on
         * top of whatever is in the column, at the height you would actually
         * be, so you can see whether you are picking the roof or the street.
         */
        showSpawnPreview(x, z, color) {
            if (!this.spawnGhost) this.spawnGhost = this._makeSpawnGhost();
            const g = this.spawnGhost;
            if (color && g.colour !== color) {
                g.colour = color;
                g.material.color.set(new THREE.Color(color).convertSRGBToLinear());
            }
            const col = this.columns.get(x + ',' + z);
            const stand = col ? col.top + 1 : 0;
            g.group.visible = true;
            g.stand = stand;
            g.group.position.set(x + 0.5, stand, z + 0.5);
            // A slow bob, so it reads as a marker being placed rather than as
            // something already built there. The frame loop keeps it going.
            this._bobSpawnGhost();
            return stand;
        }

        hideSpawnPreview() { if (this.spawnGhost) this.spawnGhost.group.visible = false; }

        /** Keep the marker breathing between pointer moves. */
        _bobSpawnGhost() {
            const g = this.spawnGhost;
            if (!g || !g.group.visible) return;
            g.group.position.y = g.stand + Math.sin(performance.now() / 260) * 0.06;
        }

        /**
         * The walking figure, in outline — same proportions as a real one.
         *
         * Drawn twice: a dark shell a little larger, from the inside, and the
         * coloured figure inside it. That silhouette is what lets it read while
         * standing on a bright green tower in the player's own colour, which is
         * exactly where it tends to end up.
         */
        _makeSpawnGhost() {
            const group = new THREE.Group();
            const material = new THREE.MeshLambertMaterial({
                color: new THREE.Color('#6366f1').convertSRGBToLinear(),
                transparent: true, opacity: 0.8, depthWrite: false
            });
            const shell = new THREE.MeshBasicMaterial({
                color: new THREE.Color('#0b1020').convertSRGBToLinear(),
                transparent: true, opacity: 0.85, side: THREE.BackSide, depthWrite: false
            });
            const part = (w, h, d, x, y, z) => {
                const geo = new THREE.BoxGeometry(w, h, d);
                const outline = new THREE.Mesh(geo, shell);
                outline.position.set(x, y, z);
                outline.scale.setScalar(1.14);
                group.add(outline);
                const m = new THREE.Mesh(geo, material);
                m.position.set(x, y, z);
                group.add(m);
            };
            part(0.26, 0.7, 0.26, -0.16, 0.35, 0);      // legs
            part(0.26, 0.7, 0.26, 0.16, 0.35, 0);
            part(0.62, 0.66, 0.36, 0, 1.03, 0);         // torso
            part(0.2, 0.6, 0.2, -0.42, 1.0, 0);         // arms
            part(0.2, 0.6, 0.2, 0.42, 1.0, 0);
            part(0.5, 0.5, 0.5, 0, 1.62, 0);            // head

            // A ring on the ground under the feet, so the exact cell is clear.
            const ring = new THREE.Mesh(
                new THREE.RingGeometry(0.34, 0.46, 24).rotateX(-Math.PI / 2),
                new THREE.MeshBasicMaterial({
                    color: 0xffffff, transparent: true, opacity: 0.55,
                    side: THREE.DoubleSide, depthWrite: false
                })
            );
            ring.position.y = 0.03;
            group.add(ring);

            // A thread from the ring up through the figure, so the column it is
            // standing in is unambiguous from a shallow camera angle.
            const post = new THREE.Line(
                new THREE.BufferGeometry().setFromPoints(
                    [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 2.1, 0)]),
                new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 })
            );
            group.add(post);

            this.scene.add(group);
            return { group, material, colour: '#6366f1' };
        }

        _blockedMaterial() {
            if (!this._blockedMat) {
                this._blockedMat = new THREE.MeshLambertMaterial({
                    color: new THREE.Color('#ff5a5f'), transparent: true, opacity: 0.35, depthWrite: false
                });
            }
            return this._blockedMat;
        }

        /**
         * Everything a ray may hit, rebuilt only when the world changes.
         * Hover fires on every mouse move, and in a world this size collecting
         * thousands of meshes each time is the difference between a smooth aim
         * and a stuttering one.
         */
        _pickTargets() {
            if (!this._targets || this._targetsDirty) {
                this._targets = [];
                this.chunks.forEach(c => c.meshes.forEach(m => this._targets.push(m)));
                this._targets.push(this.ground);
                this._targetsDirty = false;
            }
            return this._targets;
        }

        _dirtyTargets() { this._targetsDirty = true; }

        // ---- local placement preview (my own aim, before I commit an edit) ----
        /**
         * The ghost under my own pointer. `mode` says what the click will do:
         * nothing (build or paint — the ghost wears the colour), 'erase' (a red
         * ring round the doomed cell, no ghost) or 'pick' (an amber ring, since
         * the eyedropper changes the world not at all).
         */
        showPreview(x, y, z, si, colorIndex, mode) {
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
            if (mode) {
                // Nothing is being added — just ring the cell, in the colour of
                // what is about to happen to it.
                p.ghost.visible = false;
                p.line.material.color.set(mode === 'pick' ? '#fbbf24' : '#ff5a5f');
            } else {
                const idx = shapeIndex(si);
                p.ghost.visible = true;
                p.ghost.geometry = this.geometries[idx];
                p.ghost.material = this._ghostForColor(colorIndex);
                p.ghost.position.y = shapeAt(idx).cy;
                p.line.material.color.set('#ffffff');
            }
        }

        // The shadow belongs to the ghost, so it goes wherever the ghost goes —
        // orbiting, walking, locking the world. Anything that puts the ghost
        // back shows the shadow again itself.
        hidePreview() {
            if (this.preview) this.preview.group.visible = false;
            this.hideLandingShadow();
        }

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
            this._rebuildAll();
        }

        /**
         * The colour a cell is actually drawn in right now — the palette colour,
         * or its owner's colour while the x-ray is on. With merged chunks there
         * is no per-block mesh to inspect, so this is how anything (including a
         * test) asks what it would see.
         */
        renderColorAt(x, y, z) {
            const k = VoxelWorld.key(x, y, z);
            if (!this.world.has(k)) return null;
            if (this.xray) {
                const owner = this.owners.get(k);
                return (owner && this._xrayColorFor) ? this._xrayColorFor(owner) : '#64748b';
            }
            return hexOf(this.world.get(k));
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

                const label = this._makeLabelSprite(p.name, p.color, LABEL_PLOT);
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
            pad.label = this._makeLabelSprite(text, pad.color, LABEL_PLOT);
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

        // ---- where people really are ------------------------------------
        /**
         * A pin standing on the spot a player is physically at, once the world
         * has been anchored to real coordinates.
         */
        setGeoMarker(name, x, z, color, isMe, live) {
            if (!this.geoMarkers) this.geoMarkers = new Map();
            let m = this.geoMarkers.get(name);
            if (!m) {
                const group = new THREE.Group();
                const col = new THREE.Color(color).convertSRGBToLinear();
                const mat = new THREE.MeshLambertMaterial({ color: col, transparent: true, opacity: 0.9 });
                const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 5, 8), mat);
                post.position.y = 2.5;
                const head = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 10), mat);
                head.position.y = 5.4;
                const ring = new THREE.Mesh(
                    new THREE.RingGeometry(1.2, 1.6, 20),
                    new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
                );
                ring.rotation.x = -Math.PI / 2;
                ring.position.y = 0.06;
                const label = this._makeLabelSprite(isMe ? name + ' (you)' : name, color, LABEL_AVATAR);
                label.position.y = 6.4;
                group.add(post); group.add(head); group.add(ring); group.add(label);
                this.scene.add(group);
                m = { group, label };
                this.geoMarkers.set(name, m);
            }
            m.group.position.set(x + 0.5, 0, z + 0.5);
            // Solid where somebody is; faint where somebody was.
            const solid = live !== false;
            m.group.children.forEach(child => {
                if (!child.material || child.type === 'Sprite') return;
                child.material.opacity = solid ? 0.9 : 0.32;
                child.material.transparent = true;
            });
        }

        pruneGeoMarkers(keep) {
            if (!this.geoMarkers) return;
            Array.from(this.geoMarkers.keys()).forEach(name => {
                if (!keep.has(name)) this.removeGeoMarker(name);
            });
        }

        removeGeoMarker(name) {
            const m = this.geoMarkers && this.geoMarkers.get(name);
            if (!m) return;
            this.scene.remove(m.group);
            this._disposeLabel(m.label);
            this.geoMarkers.delete(name);
        }

        clearGeoMarkers() {
            if (!this.geoMarkers) return;
            Array.from(this.geoMarkers.keys()).forEach(n => this.removeGeoMarker(n));
        }

        /** Remember where this world is. */
        setGeoAnchor(anchor) {
            this.geoAnchor = anchor || null;
            if (!anchor) this.clearGeoMarkers();
            // A new place is a new sky: a different latitude, a different hour
            // of the local day, and a sun somewhere else entirely.
            this.applySky();
        }

        // ---- avatars: the other players, as people ----------------------
        /**
         * A minifigure in the player's colour: legs, arms, a body and a head
         * with a face on the front. Built from a handful of boxes because it
         * has to sit in a world made of boxes and still read as a person from
         * across a village.
         */
        _makeAvatar(name, color) {
            const group = new THREE.Group();
            const col = new THREE.Color(color).convertSRGBToLinear();
            const dark = col.clone().multiplyScalar(0.65);
            const body = new THREE.MeshLambertMaterial({ color: col });
            const trousers = new THREE.MeshLambertMaterial({ color: dark });
            const skin = new THREE.MeshLambertMaterial({ color: new THREE.Color('#f2c48a').convertSRGBToLinear() });

            const part = (w, h, d, mat, x, y, z) => {
                const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
                m.position.set(x, y, z);
                m.castShadow = !this.software;
                return m;
            };

            // Legs hang from hips so they can swing from the top.
            const legL = new THREE.Group(), legR = new THREE.Group();
            legL.add(part(0.26, 0.7, 0.26, trousers, 0, -0.35, 0));
            legR.add(part(0.26, 0.7, 0.26, trousers, 0, -0.35, 0));
            legL.position.set(-0.16, 0.7, 0);
            legR.position.set(0.16, 0.7, 0);

            const torso = part(0.62, 0.66, 0.36, body, 0, 1.03, 0);

            const armL = new THREE.Group(), armR = new THREE.Group();
            armL.add(part(0.2, 0.6, 0.2, body, 0, -0.3, 0));
            armR.add(part(0.2, 0.6, 0.2, body, 0, -0.3, 0));
            armL.position.set(-0.42, 1.3, 0);
            armR.position.set(0.42, 1.3, 0);

            const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), [
                skin, skin, skin, skin, new THREE.MeshLambertMaterial({ map: this._faceTexture() }), skin
            ]);
            head.position.set(0, 1.62, 0);
            head.castShadow = !this.software;

            // Half size: this one is read from a few paces away, not from
             // across the world like a cursor tag.
            const label = this._makeLabelSprite(name, color, LABEL_AVATAR);
            label.position.set(0, 2.25, 0);

            group.add(legL); group.add(legR); group.add(torso);
            group.add(armL); group.add(armR); group.add(head); group.add(label);
            this.scene.add(group);
            return {
                group, legL, legR, armL, armR, head, label, name, color,
                target: new THREE.Vector3(), yaw: 0, phase: 0, moving: false, seen: performance.now()
            };
        }

        /** A face, drawn once and shared by every avatar. */
        _faceTexture() {
            if (this._face) return this._face;
            const S = 64;
            const c = document.createElement('canvas');
            c.width = c.height = S;
            const g = c.getContext('2d');
            g.fillStyle = '#f2c48a'; g.fillRect(0, 0, S, S);
            g.fillStyle = '#1b1b1b';
            g.fillRect(16, 22, 8, 10);
            g.fillRect(40, 22, 8, 10);
            g.beginPath();
            g.lineWidth = 4; g.strokeStyle = '#1b1b1b';
            g.arc(S / 2, 34, 13, 0.15 * Math.PI, 0.85 * Math.PI);
            g.stroke();
            const tex = new THREE.CanvasTexture(c);
            tex.encoding = THREE.sRGBEncoding;
            this._face = tex;
            return tex;
        }

        setAvatar(id, info) {
            let a = this.avatars.get(id);
            if (!a) {
                a = this._makeAvatar(info.name || id, info.color || '#6366f1');
                a.group.position.set(info.x, info.y, info.z);
                this.avatars.set(id, a);
            }
            a.target.set(info.x, info.y, info.z);
            a.yaw = info.yaw || 0;
            a.moving = !!info.moving;
            a.seen = performance.now();
        }

        removeAvatar(id) {
            const a = this.avatars.get(id);
            if (!a) return;
            this.scene.remove(a.group);
            this._disposeLabel(a.label);
            this.avatars.delete(id);
        }

        /**
         * Walk cycle. Positions arrive a few times a second, so the body eases
         * towards where it was last seen rather than snapping — and the legs
         * keep swinging in between, which is what makes it look alive.
         */
        _animateAvatars(dt) {
            const now = performance.now();
            this.avatars.forEach((a, id) => {
                if (now - a.seen > 12000) { this.removeAvatar(id); return; }
                a.group.position.lerp(a.target, Math.min(1, dt * 9));
                a.group.rotation.y = a.yaw;
                a.phase += dt * (a.moving ? 9 : 1.8);
                const swing = Math.sin(a.phase);
                if (a.moving) {
                    a.legL.rotation.x = swing * 0.7;
                    a.legR.rotation.x = -swing * 0.7;
                    a.armL.rotation.x = -swing * 0.55;
                    a.armR.rotation.x = swing * 0.55;
                    a.group.position.y += Math.abs(Math.sin(a.phase * 2)) * 0.04;
                } else {
                    // Idle: a slow breath and a bit of a sway.
                    const idle = Math.sin(a.phase) * 0.08;
                    a.legL.rotation.x = a.legR.rotation.x = 0;
                    a.armL.rotation.x = idle; a.armR.rotation.x = -idle;
                    a.head.rotation.y = Math.sin(a.phase * 0.6) * 0.25;
                }
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
                const label = this._makeLabelSprite(name, color, LABEL_CURSOR);
                group.add(line); group.add(ghost); group.add(label);
                this.scene.add(group);
                rec = { group, line, ghost, label, name, color };
                this.remoteCursors.set(peerId, rec);
            }

            // Rebuild the label only when the identity it shows actually changes.
            if (rec.name !== name || rec.color !== color) {
                rec.group.remove(rec.label);
                this._disposeLabel(rec.label);
                rec.label = this._makeLabelSprite(name, color, LABEL_CURSOR);
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

        /** A translucent material in any colour, for previewing a custom shade. */
        _ghostForColor(colorIndex) {
            if (!isRGB(colorIndex)) return this.ghostMaterials[colorIndex] || this.ghostMaterials[0];
            if (!this._rgbGhosts) this._rgbGhosts = new Map();
            let m = this._rgbGhosts.get(colorIndex);
            if (!m) {
                m = new THREE.MeshLambertMaterial({
                    color: new THREE.Color(hexOf(colorIndex)).convertSRGBToLinear(),
                    transparent: true, opacity: 0.45, depthWrite: false
                });
                this._rgbGhosts.set(colorIndex, m);
            }
            return m;
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
        _makeLabelSprite(text, hexColor, scale) {
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
            const S = 0.022 * (scale || 1);   // world units per canvas px
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
            this.tool = 'build';            // 'build' | 'erase' | 'paint'
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
            this.fps = new BlockPartyFPS(this);
            this.geo = new BlockPartyGeo(this);
            this.minimap = new BlockPartyMinimap(this);

            // The sun moves. Once a minute is often enough to follow it and
            // rare enough that shadow edges never visibly crawl.
            this._skyMode = localStorage.getItem('bp_sky') || 'real';
            this.voxels.skyMode = this._skyMode;
            setInterval(() => this.voxels.applySky(), 60000);
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
            this._bindSound();
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
            this._loadWorldFromStorage(() => this._settleWhereYouAre());
            this._loadGeoSeen();
            this._loadSettlements();
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
            this.voxels.removeAvatar(detail.agentName);
            this.geo.forget(detail.agentName);
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
                    this._feedback(data.edit, true);
                    if (this.isHost()) {
                        // Relay client edits out to everyone else; persist.
                        this.sendData({ type: 'edit', edit: data.edit });
                        this._scheduleSave();
                    }
                    break;
                }
                case 'world':
                    if (!this.isHost() && !this._fromHost(peerId, data)) break;
                    this._receiveWorldChunk(data);
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
                case 'geo':
                    // Relayed by the host like everything else about presence.
                    if (this.isHost() && !data._fromHost) this.sendData(data);
                    else if (!this.isHost() && !this._fromHost(peerId, data)) break;
                    if (data.name !== this.username) this.geo.receive(data);
                    break;
                case 'avatar':
                    // Same shape as a cursor: the host relays, everyone else
                    // trusts only what the host passed on.
                    if (this.isHost() && !data._fromHost) this.sendData(data);
                    else if (!this.isHost() && !this._fromHost(peerId, data)) break;
                    if (data.name === this.username) break;
                    if (data.hide) this.voxels.removeAvatar(data.name);
                    else this.voxels.setAvatar(data.name, data);
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
            this._feedback(edit, false);
        }

        /**
         * The sound and the flash that go with an edit. Remote players' edits
         * get the same treatment at a lower volume, so a busy room sounds busy
         * without becoming noise.
         */
        _feedback(edit, remote) {
            const fx = this.voxels.fx, sfx = window.BlockPartySfx;
            const hex = (c) => this.voxels.renderColorAt ? null : null;
            const at = (x, y, z, colour, removing) => {
                const tint = colour === undefined ? '#ffffff' : colour;
                if (removing) fx.burst(x, y, z, tint); else fx.pop(x, y, z, tint);
            };
            if (edit.a === 'place') {
                sfx.place(edit.y, remote);
                at(edit.x, edit.y, edit.z, this.voxels.renderColorAt(edit.x, edit.y, edit.z) || '#ffffff', false);
            } else if (edit.a === 'remove') {
                sfx.remove(edit.y, remote);
                at(edit.x, edit.y, edit.z, '#cbd5e1', true);
            } else if (edit.a === 'bulk') {
                // One sound for the whole fill, and a handful of pops spread
                // across it rather than one per cell.
                const place = edit.place || [], remove = edit.remove || [], pieces = edit.addPieces || [];
                const gone = edit.delPieces || [];
                if (place.length || pieces.length) sfx.place(place.length ? place[0][1] : pieces[0][2], remote);
                else if (remove.length || gone.length) sfx.remove(remove.length ? remove[0][1] : 0, remote);
                const sample = (rows, removing, get) => {
                    const step = Math.max(1, Math.floor(rows.length / 6));
                    for (let i = 0; i < rows.length; i += step) {
                        const c = get(rows[i]);
                        at(c[0], c[1], c[2], removing ? '#cbd5e1' : (this.voxels.renderColorAt(c[0], c[1], c[2]) || '#ffffff'), removing);
                    }
                };
                sample(place, false, r => [r[0], r[1], r[2]]);
                sample(remove, true, r => [r[0], r[1], r[2]]);
                sample(pieces, false, r => [r[1], r[2], r[3]]);
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
        /** Tell the room where I am (or that I have stopped saying). */
        sendGeo(msg) {
            const payload = Object.assign({ type: 'geo' }, msg);
            if (!this.sendToHost(payload)) this.sendData(payload);
        }

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
            window.BlockPartySfx.invalid();
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

        /**
         * Repaint what is already there, in the current colour and shape.
         *
         * Without this, changing a block's colour means erase, re-aim, place —
         * three actions and a moment where the wall has a hole in it. It
         * matters more now that any colour at all can be mixed: a custom colour
         * that has left the swatch is otherwise unrecoverable, which is what
         * the eyedropper is for.
         *
         * Whoever built the block keeps the credit. Repainting somebody's wall
         * is not building it, and the leaderboard and the owner X-ray both read
         * from that.
         */
        paintAt(x, y, z) {
            if (!this.voxels.hasBlock(x, y, z)) return;
            if (!this._canEditCell(x, y, z)) return;

            // A brick is one thing with one colour, so painting any of its
            // studs repaints the whole piece — anything else would leave the
            // piece two colours, which it has no way to be.
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
                this.repaintPieces(ids);
                return;
            }

            const cells = [[x, y, z]];
            if (this.mirror) {
                const m = this._mirrorOf(x, z);
                if ((m.x !== x || m.z !== z) && this.voxels.hasBlock(m.x, y, m.z)
                    && this._canEditCell(m.x, y, m.z, true)) cells.push([m.x, y, m.z]);
            }
            const rows = cells.map(c => this._repaintRow(c[0], c[1], c[2]))
                .filter(r => r);
            if (!rows.length) return;
            this._doLocalEdit({ a: 'bulk', o: this.username, place: rows });
        }

        /** A cell as it would be after painting it — same block, my colour. */
        _repaintRow(x, y, z) {
            const row = this._cellRow(x, y, z);
            if (!row) return null;
            // Already exactly this? Then there is nothing to broadcast, and an
            // empty edit would still cost an undo step.
            if (row[3] === this.currentColor && row[4] === this.currentShape) return null;
            return [x, y, z, this.currentColor, this.currentShape, row[5]];
        }

        /** The same, for whole brick pieces: put them back in my colour. */
        repaintPieces(ids) {
            const rows = [];
            ids.forEach(id => {
                const piece = this.voxels.pieces.get(id);
                if (!piece || piece.c === this.currentColor) return;
                const row = this._pieceRow(piece);
                row[6] = this.currentColor;
                rows.push(row);
            });
            if (!rows.length) return;
            // setPiece replaces a piece of the same id in place, so adding it
            // again with a new colour is the whole edit.
            this._doLocalEdit({ a: 'bulk', o: this.username, addPieces: rows });
        }

        /**
         * Take the colour and shape of whatever is under the pointer.
         *
         * The counterpart to painting: "carry on in exactly that colour" is
         * unanswerable otherwise once a colour has been mixed rather than
         * chosen from the twelve.
         */
        eyedropAt(x, y, z) {
            if (!this.voxels.hasBlock(x, y, z)) {
                this.showToast('Nothing there to pick up', 'info', 1400);
                return false;
            }
            const colour = this.voxels.world.get(VoxelWorld.key(x, y, z));
            const pieceId = this.voxels.pieceAt(x, y, z);
            const piece = pieceId && this.voxels.pieces.get(pieceId);
            const brick = piece && BlockPartyBricks.bySize(piece.w, piece.d);
            if (brick) {
                // A brick's size is as much a part of it as its colour.
                this.brickRotated = brick.rotated;
                this.selectBrick(brick.id);
            } else if (!piece) {
                this.selectShape(this.voxels.shapeOf(x, y, z));
            }

            if (isRGB(colour)) this.setCustomColor(hexOf(colour));
            else this.selectColor(colour);
            this.showToast(`Picked up ${hexOf(colour)}`, 'success', 1400);
            return true;
        }

        /** Choose one of the twelve, from the palette or from the world. */
        selectColor(i) {
            this.currentColor = i;
            const palette = document.getElementById('palette');
            if (palette) {
                palette.querySelectorAll('.swatch').forEach((sw, idx) => {
                    sw.classList.toggle('selected', idx === i);
                });
            }
            this._afterBrushChange();
        }

        /**
         * Picking a colour or a shape means you intend to put it somewhere. It
         * used to always mean building — but while painting, it means painting,
         * and being thrown back to Build every time you changed colour made the
         * paint tool useless.
         */
        _afterBrushChange() {
            if (this.tool === 'erase') this.tool = 'build';
            this._syncTool();
            this._refreshAim();
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
         * Fill, clear, or repaint the box between two cells. The tool decides
         * which: the Fill toggle rides on top of whichever one is active.
         *
         * Repainting only touches cells that already hold something — a paint
         * box over a courtyard recolours the walls around it and leaves the
         * courtyard empty, which is the only reading of it that is any use.
         */
        fillRegion(a, b, erase, paint) {
            const lo = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) };
            const hi = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) };
            const volume = (hi.x - lo.x + 1) * (hi.y - lo.y + 1) * (hi.z - lo.z + 1);
            if (volume > MAX_FILL_CELLS) {
                this.showToast(`That region is too big (${volume} cells, max ${MAX_FILL_CELLS})`, 'warning', 2600);
                return 0;
            }

            const place = [], remove = [];
            // Bricks inside the box are repainted whole, however few of their
            // studs the box happens to cover.
            const pieceIds = new Set();
            let blocked = 0;
            for (let x = lo.x; x <= hi.x; x++) {
                for (let y = lo.y; y <= hi.y; y++) {
                    for (let z = lo.z; z <= hi.z; z++) {
                        if (!this._canEditCell(x, y, z, true)) { blocked++; continue; }
                        if (erase) {
                            if (this.voxels.hasBlock(x, y, z)) remove.push([x, y, z]);
                        } else if (paint) {
                            const id = this.voxels.pieceAt(x, y, z);
                            if (id) { pieceIds.add(id); continue; }
                            const row = this._repaintRow(x, y, z);
                            if (row) place.push(row);
                        } else {
                            place.push([x, y, z, this.currentColor, this.currentShape]);
                        }
                    }
                }
            }
            const addPieces = [];
            pieceIds.forEach(id => {
                const piece = this.voxels.pieces.get(id);
                if (!piece || piece.c === this.currentColor) return;
                const row = this._pieceRow(piece);
                row[6] = this.currentColor;
                addPieces.push(row);
            });

            if (!place.length && !remove.length && !addPieces.length) {
                this._canEditCell(lo.x, lo.y, lo.z);    // let it explain why
                if (!blocked) {
                    this.showToast(erase ? 'No blocks to clear there'
                        : paint ? 'Nothing there to repaint' : 'Nothing to fill there', 'info', 1400);
                }
                return 0;
            }
            this._doLocalEdit({ a: 'bulk', o: this.username, place, remove, addPieces });
            const n = place.length + remove.length + addPieces.length;
            const did = erase ? 'Cleared' : paint ? 'Repainted' : 'Filled';
            this.showToast(`${did} ${n} block${n === 1 ? '' : 's'}`
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

        /**
         * Which world this is, in storage.
         *
         * Once the room is pinned, the Earth is divided into regions and each
         * one persists separately — so travelling to another place and building
         * there does not overwrite the place you left, and coming back finds it
         * as you left it.
         */
        _worldStorageKey() {
            const region = this.geo && this.geo.regionKey();
            return region ? STORAGE_KEY + '_' + region : STORAGE_KEY;
        }

        _saveWorld() {
            if (!this.isHost() || !this.channel || typeof this.channel.storagePut !== 'function') return;
            try {
                const snap = this.snapshotWorld();
                const payload = {
                    storageKey: this._worldStorageKey(),
                    content: { v: 4, blocks: snap.blocks, pieces: snap.pieces, ground: snap.ground, geo: snap.geo },
                    encrypted: false,
                    metadata: { description: 'BlockParty voxel world', blocks: this.voxels.count() }
                };
                this._noteSettlement();
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

        /**
         * Fill an empty world from storage. `after` runs once the round trip is
         * done either way — travelling has to wait for it before telling the
         * room where everybody now is, or the room gets the empty world that
         * existed for the moment before the blocks arrived.
         */
        _loadWorldFromStorage(after) {
            const done = () => { if (typeof after === 'function') after(); };
            if (this.modes && this.modes.isMatchActive()) return done();
            if (!this.channel || typeof this.channel.storageGet !== 'function') return done();
            try {
                this._storage((cb) => this.channel.storageGet({ storageKey: this._worldStorageKey() }, cb), (res) => {
                    // A match may have started while this round-trip was in
                    // flight — the arena must not be overwritten.
                    if (this.modes && this.modes.isMatchActive()) return done();
                    if (res && res.status === 'success' && res.data) {
                        const saved = res.data.content || res.data;
                        const blocks = saved.blocks, pieces = saved.pieces;
                        const any = (Array.isArray(blocks) && blocks.length)
                            || (Array.isArray(pieces) && pieces.length);
                        // Only ever fills an empty world: on arrival, or on
                        // joining. It must never overwrite what is being built.
                        if (any && this.voxels.count() === 0) {
                            this.restoreWorldFrom({ blocks, pieces, ground: saved.ground, geo: saved.geo });
                            this._updateBlockCount();
                        }
                    }
                    done();
                });
            } catch (e) {
                console.warn('[BlockParty] world load error:', e.message);
                done();
            }
        }

        // Everything standing, in both flavours: loose cells and brick pieces.
        snapshotWorld() {
            return {
                blocks: this.voxels.encode(),
                pieces: this.voxels.encodePieces(),
                ground: this.voxels.groundTint || null,
                geo: (this.geo && this.geo.anchor) || null
            };
        }

        restoreWorldFrom(snap) {
            if (!snap) return;
            // A snapshot that says nothing about place does not move the world.
            //
            // Loading a map is a change of *build*, not of where the room is —
            // it arrives with no `geo` at all, and treating that as "nowhere"
            // silently unpinned the world, took the coast off the ground and
            // left the minimap with no Earth to zoom out to. A snapshot from
            // the host does carry the key, null included, and that null still
            // means what it says: follow me off the map.
            if (this.geo && snap.geo !== undefined) this.geo.applyAnchor(snap.geo || null);
            this.voxels.setGroundTint(snap.ground || null);
            this.voxels.replaceFrom(snap.blocks, snap.pieces);
            this.paintGround();
            if (this.xray) this.voxels.setOwnerXray(true, (n) => this.generateUserColor(n));
        }

        /**
         * Send the whole world to the room, in pieces.
         *
         * A full 161x161 world does not fit in one data-channel message, so it
         * goes out as numbered chunks and the receiver assembles them before
         * touching anything. Chunk 0 announces how many are coming, so a client
         * that joins mid-stream simply waits for the next complete run rather
         * than rendering half a world.
         */
        _sendWorldSnapshot() {
            // Never ship the arena out as if it were the shared world.
            if (this.modes && this.modes.isMatchActive()) return;
            const snap = this.snapshotWorld();
            const chunks = [];
            for (let i = 0; i < snap.blocks.length; i += WORLD_CHUNK) {
                chunks.push({ blocks: snap.blocks.slice(i, i + WORLD_CHUNK), pieces: [] });
            }
            for (let i = 0; i < snap.pieces.length; i += WORLD_CHUNK) {
                chunks.push({ blocks: [], pieces: snap.pieces.slice(i, i + WORLD_CHUNK) });
            }
            if (!chunks.length) chunks.push({ blocks: [], pieces: [] });

            chunks.forEach((c, i) => this.sendData({
                type: 'world', i, n: chunks.length,
                blocks: c.blocks, pieces: c.pieces,
                ground: snap.ground, geo: snap.geo, locked: this.worldLocked
            }));
        }

        /** Collect a chunked snapshot; apply it once the last chunk lands. */
        _receiveWorldChunk(data) {
            const total = data.n || 1;
            if (data.i === 0 || !this._incoming) this._incoming = { blocks: [], pieces: [], seen: 0, total };
            if (this._incoming.total !== total) this._incoming = { blocks: [], pieces: [], seen: 0, total };

            this._incoming.blocks.push(...(data.blocks || []));
            this._incoming.pieces.push(...(data.pieces || []));
            this._incoming.seen++;
            if (this._incoming.seen < total) return;

            const snap = this._incoming;
            this._incoming = null;
            this.restoreWorldFrom({
                blocks: snap.blocks, pieces: snap.pieces,
                ground: data.ground || null, geo: data.geo || null
            });
            // The snapshot carries the lock so a late joiner learns the room is
            // read-only without a separate round trip.
            if (typeof data.locked === 'boolean') this._setWorldLocked(data.locked);
            this._updateBlockCount();
            this._refreshPlayers();
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

        /**
         * Drop a prebuilt map into the world. Host-only, like loading a save:
         * it replaces what everyone can see. The map is generated here and then
         * travels to the room as an ordinary world snapshot.
         */
        loadMap(id) {
            if (!this.isHost()) { this.showToast('Only the host can load a map', 'warning'); return; }
            if (this.modes && this.modes.isMatchActive()) {
                this.showToast('Finish the match first', 'warning');
                return;
            }
            const map = BlockPartyMaps.byId(id);
            if (!map) return;
            if (this.voxels.count() && !window.confirm(
                `Load “${map.name}”? The current world will be replaced.`)) return;

            const t0 = Date.now();
            const built = BlockPartyMaps.generate(id);
            this.restoreWorldFrom(built);
            this.undoStack.length = 0;
            this.redoStack.length = 0;
            this._syncHistoryButtons();
            this._updateBlockCount();
            this._refreshPlayers();
            this._sendWorldSnapshot();
            this._scheduleSave();
            this._closeWorldModal();
            this.voxels.focus(0, 2, 0, 120, Math.PI * 0.30);
            this.showToast(`${map.emoji} ${map.name} — ${this.voxels.count()} blocks in ${Date.now() - t0}ms`, 'success', 3000);
        }

        // ---------- the world as a real place ----------
        _bindGeoUI() {
            const on = (id, ev, fn) => {
                const el = document.getElementById(id);
                if (el) el.addEventListener(ev, fn);
            };

            on('geoAnchorBtn', 'click', () => this.pinToMyLocation());

            on('geoShareBtn', 'click', async () => {
                if (this.geo.sharing) { this.geo.stopSharing(); this.showToast('Stopped sharing your location', 'info'); return; }
                try {
                    await this.geo.locate();
                    this.geo.startSharing();
                    this.geo._share();
                    this._syncGeoUI();
                    this.showToast('Sharing your location, rounded to about 5m', 'success', 3200);
                } catch (e) {
                    this.showToast(e.message, 'error', 3600);
                }
            });

            on('geoTravelBtn', 'click', () => {
                const raw = (document.getElementById('geoCoords') || {}).value || '';
                const m = raw.split(/[ ,;]+/).filter(Boolean).map(Number);
                if (m.length < 2 || !isFinite(m[0]) || !isFinite(m[1])) {
                    this.showToast('Enter coordinates as "51.5074, -0.1278"', 'warning', 3200);
                    return;
                }
                const mpc = Number((document.getElementById('geoScale') || {}).value) || 2;
                this.travelTo(m[0], m[1], mpc);
            });

            on('geoHereBtn', 'click', async () => {
                try {
                    const fix = await this.geo.locate();
                    const mpc = Number((document.getElementById('geoScale') || {}).value) || 2;
                    this.travelTo(fix.lat, fix.lon, mpc);
                } catch (e) {
                    this.showToast(e.message, 'error', 3600);
                }
            });

            on('geoScale', 'change', () => {
                // Changing the scale is itself a move: the region is a
                // different size, so it is a different region.
                const a = this.geo.anchor;
                if (!a || !this.isHost()) return;
                this.travelTo(a.lat, a.lon, Number(document.getElementById('geoScale').value) || 2);
            });

            on('geoSky', 'change', () => {
                const el = document.getElementById('geoSky');
                this._skyMode = el.value;
                localStorage.setItem('bp_sky', this._skyMode);
                this.voxels.setSkyMode(this._skyMode);
                this._syncGeoUI();
                const sun = this.voxels.sky;
                this.showToast(sun ? `Sky: ${window.BlockPartySky.describe(sun.elevation, sun.azimuth)}`
                    : 'Sky: the fixed dusk — pin this world to a place for the real one', 'info', 3000);
            });

            on('geoTraceBtn', 'click', () => this.traceWorld());

            on('modeBtn', 'click', () => this.setWorldMode(this.worldMode() === 'earth' ? 'private' : 'earth'));

            on('geoCalloutPin', 'click', () => this.setWorldMode('earth'));
            on('geoCalloutMore', 'click', () => { this._openWorldModal(); this._syncGeoCallout(); });
            on('geoCalloutHide', 'click', () => {
                const bar = document.getElementById('geoCallout');
                if (bar) bar.classList.add('hidden');
            });

            const auto = document.getElementById('geoAutoTrace');
            if (auto) {
                // Off by default: the place is painted on the ground, and the
                // blocks in a world should be the ones people put there.
                this._autoTrace = localStorage.getItem('bp_autotrace') === '1';
                auto.checked = this._autoTrace;
                auto.addEventListener('change', () => {
                    this._autoTrace = auto.checked;
                    localStorage.setItem('bp_autotrace', auto.checked ? '1' : '0');
                });
            }

            on('geoGoBtn', 'click', () => {
                const r = this.geo.goTo(this.username);
                if (!r) this.showToast('Share your location first', 'warning');
                else if (r.outside) this.showToast('You are outside this world — pin it here, or use a bigger scale', 'warning', 4000);
            });

            on('geoList', 'click', (e) => {
                const btn = e.target.closest && e.target.closest('button[data-geo]');
                if (!btn) return;
                const who = btn.getAttribute('data-geo');
                const r = this.geo.goTo(who);
                if (!r) { this.showToast(`${who} is not sharing a location`, 'warning'); return; }
                if (r.outside) {
                    // They are in a different region of the Earth. The host can
                    // move the room to them; anyone else is told where to look.
                    const where = `${who} is ${r.metres}m ${r.dir} of here, in another region`;
                    const coords = this.geo.coordsOf(who);
                    if (this.isHost() && coords) {
                        this.showToast(where + ' — travelling', 'info', 2600);
                        this.travelTo(coords.lat, coords.lon, this.geo.anchor.mpc);
                        this._closeWorldModal();
                    } else {
                        this.showToast(where, 'warning', 4000);
                    }
                    return;
                }
                this._closeWorldModal();
                this.showToast(`Flew to ${who}'s spot`, 'success', 2200);
            });
        }

        /** Redraw the geolocation panel from the current state. */
        _syncGeoUI() {
            // Whether this world has a place is the one thing the offer tracks.
            this._syncGeoCallout();
            const geo = this.geo;
            if (!geo) return;
            const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
            const anchor = geo.anchor;

            const span = geo.span();
            const across = span >= 10000 ? `${(span / 1000).toFixed(0)} km` : `${span} m`;
            const sun = this.voxels && this.voxels.sky;
            set('geoState', anchor
                ? `${BlockPartyGeo.format(anchor.lat, anchor.lon)} · ${anchor.mpc}m per block · ${across} across`
                  + (anchor.region ? ` · region ${anchor.region}` : '')
                  + (sun ? ` · ${window.BlockPartySky.describe(sun.elevation, sun.azimuth)}` : '')
                : 'This world is not pinned to anywhere on Earth yet.');
            const skySel = document.getElementById('geoSky');
            if (skySel && skySel.value !== this._skyMode) skySel.value = this._skyMode || 'real';

            const share = document.getElementById('geoShareBtn');
            if (share) {
                share.textContent = geo.sharing ? '📍 Stop sharing' : '📍 Share my location';
                share.classList.toggle('active', geo.sharing);
            }
            const anchorBtn = document.getElementById('geoAnchorBtn');
            if (anchorBtn) anchorBtn.disabled = !this.isHost();

            const list = document.getElementById('geoList');
            if (list) {
                const rows = geo.roster().map(entry => {
                    const p = entry.pos;
                    const off = p && p.outside ? geo.offsetTo(entry.name) : null;
                    const where = !p ? '—' : (off ? `${off.metres}m ${off.dir} · another region`
                        : `${Math.round(p.x)}, ${Math.round(p.z)}`);
                    const isMe = entry.name === this.username;
                    // Live, remembered, or only on this device and not shared.
                    const status = entry.live ? 'here now'
                        : (entry.private ? 'on this device only' : 'last seen ' + BlockPartyGeo.ago(entry.at));
                    return `<div class="geo-row${entry.live ? '' : ' stale'}">
                        <span class="geo-dot" style="background:${this.generateUserColor(entry.name)};${entry.live ? '' : 'opacity:.45'}"></span>
                        <span class="geo-name">${this._esc(entry.name)}${isMe ? ' (you)' : ''}</span>
                        <span class="geo-when">${this._esc(status)}</span>
                        <span class="geo-where">${this._esc(where)}</span>
                        <button class="btn btn-ghost" data-geo="${this._esc(entry.name)}" ${p ? '' : 'disabled'}>${p && p.outside ? (this.isHost() ? 'Travel' : 'Where?') : 'Go'}</button>
                    </div>`;
                });
                list.innerHTML = rows.length ? rows.join('')
                    : '<div class="slot-empty">Nobody has shared a location in this room yet.</div>';
            }

            // The map keeps the same list, and has to hear about the same
            // changes — a position arriving is a redraw of both or neither.
            if (this.minimap) this.minimap.renderPlaces();
        }

        /**
         * Where the pointer is, in the real world. Only meaningful once the
         * world has been pinned — and it is the thing that makes the grid feel
         * like ground rather than graph paper.
         */
        _updateGeoReadout(cell) {
            const el = document.getElementById('geoReadout');
            if (!el) return;
            if (!this.geo || !this.geo.anchor || !cell) { el.classList.add('hidden'); return; }
            const ll = this.geo.toLatLon(cell.x, cell.z);
            el.textContent = '🌍 ' + BlockPartyGeo.format(ll.lat, ll.lon);
            el.classList.remove('hidden');
        }

        // ---------- pictures into blocks ----------
        /**
         * Nearest palette colour to an RGB triple.
         *
         * Distance is weighted towards green, roughly how the eye judges it —
         * a plain RGB distance sends skin tones and foliage to the wrong swatch.
         * Returns the index and the error, which dithering needs to carry.
         */
        _nearestSwatch(r, g, b) {
            if (!this._paletteRGB) {
                this._paletteRGB = PALETTE.map(hex => {
                    const c = new THREE.Color(hex);
                    return [c.r * 255, c.g * 255, c.b * 255];
                });
            }
            let best = 0, bestD = Infinity;
            for (let i = 0; i < this._paletteRGB.length; i++) {
                const p = this._paletteRGB[i];
                const dr = r - p[0], dg = g - p[1], db = b - p[2];
                const d = dr * dr * 0.30 + dg * dg * 0.59 + db * db * 0.11;
                if (d < bestD) { bestD = d; best = i; }
            }
            const p = this._paletteRGB[best];
            return { index: best, er: r - p[0], eg: g - p[1], eb: b - p[2] };
        }

        /**
         * Read an image into a grid of palette indexes and brightnesses.
         *
         * With twelve colours to work with, a straight nearest-colour match
         * bands badly on anything with gradients. Floyd–Steinberg dithering
         * pushes each pixel's error into its neighbours, which trades a little
         * noise for shading the palette cannot otherwise express.
         */
        _quantizeImage(img, width, dither, trueColor) {
            const w = Math.max(4, Math.min(64, width | 0));
            const h = Math.max(1, Math.min(64, Math.round(w * img.height / img.width)));
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            const data = ctx.getImageData(0, 0, w, h).data;

            // Work in floats so dithering can carry fractional error.
            const buf = new Float32Array(w * h * 3);
            const alpha = new Uint8Array(w * h);
            for (let i = 0; i < w * h; i++) {
                buf[i * 3] = data[i * 4];
                buf[i * 3 + 1] = data[i * 4 + 1];
                buf[i * 3 + 2] = data[i * 4 + 2];
                alpha[i] = data[i * 4 + 3];
            }

            const cells = [];
            const spread = (i, er, eg, eb, f) => {
                if (i < 0 || i >= w * h) return;
                buf[i * 3] += er * f; buf[i * 3 + 1] += eg * f; buf[i * 3 + 2] += eb * f;
            };
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const i = y * w + x;
                    if (alpha[i] < 128) continue;                 // transparent: no block
                    const r = buf[i * 3], g = buf[i * 3 + 1], b = buf[i * 3 + 2];
                    const lum = Math.max(0, Math.min(1, (0.30 * r + 0.59 * g + 0.11 * b) / 255));
                    if (trueColor) {
                        // Every pixel keeps its own colour: no palette, nothing
                        // to dither against, and the picture looks like itself.
                        cells.push({
                            x, y, lum,
                            c: packRGB(Math.round(Math.max(0, Math.min(255, r))),
                                Math.round(Math.max(0, Math.min(255, g))),
                                Math.round(Math.max(0, Math.min(255, b))))
                        });
                        continue;
                    }
                    const m = this._nearestSwatch(r, g, b);
                    cells.push({ x, y, c: m.index, lum });
                    if (!dither) continue;
                    if (x + 1 < w) spread(i + 1, m.er, m.eg, m.eb, 7 / 16);
                    if (y + 1 < h) {
                        if (x > 0) spread(i + w - 1, m.er, m.eg, m.eb, 3 / 16);
                        spread(i + w, m.er, m.eg, m.eb, 5 / 16);
                        if (x + 1 < w) spread(i + w + 1, m.er, m.eg, m.eb, 1 / 16);
                    }
                }
            }
            return { w, h, cells };
        }

        /**
         * Build a quantised picture into the world.
         *   wall   — standing up, as you would hang it
         *   floor  — laid flat, a mosaic
         *   relief — laid flat and extruded by brightness, so it reads as 3D
         */
        placeImage(quant, style) {
            const place = [];
            const centre = this.voxels.target;
            const ox = Math.round(centre.x - quant.w / 2);
            const oz = Math.round(centre.z - (style === 'wall' ? 0 : quant.h / 2));
            const RELIEF = 8;

            quant.cells.forEach(cell => {
                const x = ox + cell.x;
                if (style === 'wall') {
                    // Image rows run top-down; the world's Y runs up.
                    place.push([x, quant.h - cell.y, oz, cell.c, 0]);
                } else if (style === 'floor') {
                    place.push([x, 0, oz + cell.y, cell.c, 0]);
                } else {
                    const height = 1 + Math.round(cell.lum * RELIEF);
                    for (let y = 0; y < height; y++) place.push([x, y, oz + cell.y, cell.c, 0]);
                }
            });

            const kept = place.filter(r => this.voxels.inBounds(r[0], r[1], r[2]))
                .filter(r => this._canEditCell(r[0], r[1], r[2], true));
            if (!kept.length) {
                this.showToast('That picture would land outside your building area', 'warning', 2600);
                return 0;
            }
            if (kept.length > MAX_IMAGE_CELLS) {
                this.showToast(`That is ${kept.length} blocks — try a smaller width or a flatter style`, 'warning', 3200);
                return 0;
            }
            // Through the normal edit path: it syncs, persists and undoes as one.
            this._doLocalEdit({ a: 'bulk', o: this.username, place: kept });
            this.showToast(`Built ${kept.length} blocks from your picture`, 'success', 2600);
            return kept.length;
        }

        _bindImageImport() {
            const file = document.getElementById('imgFile');
            const place = document.getElementById('imgPlace');
            const note = document.getElementById('imgNote');
            if (!file || !place) return;

            file.addEventListener('change', () => {
                const f = file.files && file.files[0];
                if (!f) return;
                const reader = new FileReader();
                reader.onload = () => {
                    const img = new Image();
                    img.onload = () => {
                        this._importImage = img;
                        place.disabled = false;
                        if (note) note.textContent = `${f.name} — ${img.width}x${img.height}. It lands in front of the camera.`;
                    };
                    img.onerror = () => { if (note) note.textContent = 'That file could not be read as an image.'; };
                    img.src = reader.result;
                };
                reader.readAsDataURL(f);
            });

            place.addEventListener('click', () => {
                if (!this._importImage) return;
                const width = Number((document.getElementById('imgSize') || {}).value) || 32;
                const style = (document.getElementById('imgStyle') || {}).value || 'wall';
                const dither = !!(document.getElementById('imgDither') || {}).checked;
                const trueColor = ((document.getElementById('imgPalette') || {}).value || 'true') === 'true';
                const quant = this._quantizeImage(this._importImage, width, dither, trueColor);
                if (this.placeImage(quant, style)) this._closeWorldModal();
            });
        }

        /**
         * Go somewhere else on Earth.
         *
         * The world you are leaving is written down first, then the region that
         * contains the new coordinates becomes the world: its anchor, its
         * stored blocks, its ground. Host-only, because it moves the room.
         */
        travelTo(lat, lon, mpc) {
            if (!this.isHost()) { this.showToast('Only the host can move the room', 'warning'); return null; }
            if (this.modes && this.modes.isMatchActive()) {
                this.showToast('Finish the match first', 'warning');
                return null;
            }
            if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) {
                this.showToast('That is not a place on Earth', 'warning');
                return null;
            }

            // Leave the world you were in as you found it — including the
            // private one, which has no anchor but is still somebody's build.
            if (this.voxels.count()) this._saveWorld();

            const scale = mpc || (this.geo.anchor && this.geo.anchor.mpc) || 2;
            this.voxels.clearAll();
            this.undoStack.length = 0;
            this.redoStack.length = 0;
            const anchor = this.geo.setAnchor(lat, lon, scale);
            this._updateBlockCount();

            // Whatever has been built here before, if anything — and only once
            // it has arrived is the room told where it now is.
            this._loadWorldFromStorage(() => {
                this._sendWorldSnapshot();
                this._scheduleSave();
                this._updateBlockCount();
                this._refreshPlayers();
                // Whoever is in this region now needs a pin, and whoever is not
                // needs theirs taken away — an empty region loads nothing, so
                // this cannot be left to the world restore.
                this.geo.refresh();
                this._loadSettlements();
                this._syncGeoUI();
                if (this.minimap) this.minimap.draw();
                this.paintGround();
                this._maybeAutoTrace();
            });
            this.voxels.focus(0, 2, 0, 60, Math.PI * 0.3);

            // Where the room has been is worth keeping: it is the list people
            // come back to, and the only record of a place once the world there
            // has been put away. Announced as well as stored, so a client who
            // was not host when it happened still has the history.
            const visit = {
                lat: anchor.lat, lon: anchor.lon, mpc: anchor.mpc,
                region: anchor.region, at: Date.now()
            };
            this.geo.recordVisit(this.username, visit);
            this.sendGeo({ name: this.username, visit });
            this._syncGeoUI();
            this.showToast(`Moved to ${BlockPartyGeo.format(anchor.lat, anchor.lon)} · `
                + `${anchor.mpc}m per block · ${this.geo.span()}m across`, 'success', 3600);
            return anchor;
        }

        /**
         * Build the real place: read the map tiles for this region and lay it
         * out in blocks — sea, parks, roads and buildings where they actually
         * are. Host-only, because it replaces the world.
         */
        /**
         * Paint the ground with wherever the room is now — or clear it, off the
         * map. Nothing here touches a single block.
         */
        async paintGround() {
            if (!window.BlockPartyEarth) return;
            if (!this.geo || !this.geo.region) { this.voxels.setGroundMap(null); return; }
            const region = this.geo.region;
            try {
                const earth = await BlockPartyEarth.load();
                // The room may have moved on while the coastlines were loading.
                if (!this.geo.region || this.geo.region.key !== region.key) return;
                const cells = this.voxels.half * 2 + 1;
                this.voxels.setGroundMap(BlockPartyEarth.groundCanvas(earth, region, cells));
                this._reportGroundMix(earth, region, cells);
            } catch (e) {
                this.voxels.setGroundMap(null);
                console.warn('[BlockParty] ground map:', e.message);
            }
        }

        /**
         * Say what the ground turned out to be.
         *
         * Most places on Earth have no coastline within a few hundred metres,
         * so at street scale the map of somewhere real is a field of grey —
         * correct, and indistinguishable from a bug. This says which it is, and
         * where the nearest edge would be found.
         */
        _reportGroundMix(earth, region, cells) {
            const m = BlockPartyEarth.landMask(earth, region, cells);
            let land = 0;
            for (let i = 0; i < m.mask.length; i++) land += m.mask[i];
            const fraction = land / m.mask.length;
            const across = this.geo.span();
            const km = across >= 1000 ? `${Math.round(across / 1000)} km` : `${Math.round(across)} m`;
            const what = fraction === 1 ? `all land, ${km} of it`
                : fraction === 0 ? `open water, ${km} across`
                : `${Math.round(fraction * 100)}% land, ${km} across`;

            // An explicit "draw this place" reports what it did; this is the
            // standing description of the ground, and must not talk over it.
            const note = (this._noteHeldUntil || 0) > Date.now()
                ? null : document.getElementById('geoNote');
            if (note) {
                note.textContent = fraction === 1 || fraction === 0
                    ? `This place is ${what} — no coast at this scale. Pick a bigger scale above, or pull the map out with −.`
                    : `This place is ${what}.`;
            }
            // Said once per place, and only when there is nothing to see: a
            // toast on every arrival would be noise.
            if ((fraction === 1 || fraction === 0) && this._mixSaid !== region.key) {
                this._mixSaid = region.key;
                this.showToast(`Real ground here is ${what} — no coastline this close in. `
                    + 'Try a bigger scale in 🗂, or pull the map out with −.', 'info', 5200);
            }
            this.groundMix = fraction;
        }

        /**
         * Two worlds, one room: a private one that is nowhere in particular,
         * and one that is a window onto the Earth.
         *
         * They are kept apart rather than converted into each other — each is
         * stored under its own key, so switching back and forth never costs
         * anybody what they built. Host-only: it moves the room.
         */
        async setWorldMode(mode) {
            if (!this.isHost()) { this.showToast('Only the host can change the world', 'warning'); return false; }
            if (this.modes && this.modes.isMatchActive()) {
                this.showToast('Finish the match first', 'warning');
                return false;
            }
            const now = this.worldMode();
            if (mode === now) return true;

            if (mode === 'earth') {
                const mpc = Number((document.getElementById('geoScale') || {}).value) || 2;
                let fix;
                try {
                    fix = await this.geo.locate();
                } catch (e) {
                    this.showToast(`${e.message} — pick a place instead`, 'warning', 4200);
                    this._openWorldModal();
                    return false;
                }
                // travelTo does the rest: puts this world away, moves the room,
                // brings up whatever is stored there, and draws it if empty.
                return !!this.travelTo(fix.lat, fix.lon, mpc);
            }

            // Off the map: keep your position to yourself, and open the world
            // that is nowhere.
            if (this.geo.sharing) this.geo.stopSharing();
            if (this.voxels.count()) this._saveWorld();
            this.voxels.clearAll();
            this.undoStack.length = 0;
            this.redoStack.length = 0;
            this.geo.applyAnchor(null);
            this.voxels.setGroundMap(null);
            this._updateBlockCount();
            this._loadWorldFromStorage(() => {
                this._sendWorldSnapshot();
                this._scheduleSave();
                this._updateBlockCount();
                this._refreshPlayers();
                this._syncGeoUI();
                if (this.minimap) this.minimap.draw();
            });
            this.voxels.focus(0, 2, 0, 60, Math.PI * 0.3);
            this._syncGeoUI();
            this.showToast('Private world — off the map, and your location is your own', 'success', 3600);
            return true;
        }

        /** Which of the two this room is in right now. */
        worldMode() { return (this.geo && this.geo.anchor) ? 'earth' : 'private'; }

        /**
         * A world with nowhere to be is put where you are.
         *
         * Only if the browser has already been given permission — a game that
         * demands your position the moment it opens is a game people close, so
         * without it the map simply offers its 📍 and waits.
         */
        async _settleWhereYouAre() {
            if (!this.isHost() || (this.geo && this.geo.anchor)) return;
            // Asking outright is the point: a world that is nowhere has no map
            // to show, and waiting for someone to find a 📍 they have no reason
            // to look for is how it stayed nowhere. Somewhere already refused
            // is not asked again — the call to action stays instead.
            let state = 'prompt';
            try {
                if (navigator.permissions && navigator.permissions.query) {
                    state = (await navigator.permissions.query({ name: 'geolocation' })).state;
                }
            } catch (e) { /* no permissions API: just ask */ }

            // The offer goes up first and comes down if the answer arrives:
            // asking can take twelve seconds to time out, and twelve seconds of
            // an empty world with no explanation is how this looked broken.
            this._syncGeoCallout();
            if (state === 'denied') return;
            await this.pinToMyLocation({ quiet: true });
            this._syncGeoCallout();
        }

        /**
         * The standing offer to put this world somewhere, for when asking did
         * not work — refused, unavailable, or nobody was listening.
         */
        _syncGeoCallout() {
            const earth = this.worldMode() === 'earth';
            const btn = document.getElementById('modeBtn');
            if (btn) {
                btn.textContent = earth ? '🌍' : '🔒';
                btn.classList.toggle('active', earth);
                btn.title = earth
                    ? 'This world is a window onto the Earth — click for a private world'
                    : 'Private world — click to put it on the Earth, with real ground and sea';
            }
            const bar = document.getElementById('geoCallout');
            if (!bar) return;
            bar.classList.toggle('hidden', !(this.isHost() && !earth));
        }

        /**
         * Put the world where the player is standing. Reachable from the world
         * panel and from the map itself, because until this happens the map has
         * nowhere real to show.
         */
        async pinToMyLocation(opts) {
            opts = opts || {};
            if (!this.isHost()) { this.showToast('Only the host can pin the world', 'warning'); return null; }
            const note = document.getElementById('geoNote');
            if (note) note.textContent = 'Asking your browser for a position…';
            try {
                const fix = await this.geo.locate();
                const mpc = Number((document.getElementById('geoScale') || {}).value) || 2;
                this.geo.setAnchor(fix.lat, fix.lon, mpc);
                this._sendWorldSnapshot();
                this._scheduleSave();
                this._syncGeoUI();
                if (this.minimap) this.minimap.draw();
                this.showToast(`World pinned — ${this.geo.span()}m across, ${mpc}m per block`, 'success', 3600);
                this._syncGeoCallout();
                this.paintGround();
                // Somewhere real deserves to look like it.
                this._maybeAutoTrace();
                return this.geo.anchor;
            } catch (e) {
                if (note) note.textContent = e.message;
                // Refusing on arrival is a choice, not an error worth shouting
                // about; the offer stays on screen either way.
                if (!opts.quiet) this.showToast(e.message, 'error', 3600);
                this._syncGeoCallout();
                return null;
            }
        }

        /**
         * Arriving somewhere nobody has built yet, draw the place itself. This
         * is what makes zooming feel like a map rather than like eight
         * unrelated empty rooms — every scale of every region already looks
         * like the ground it stands on.
         */
        _maybeAutoTrace() {
            if (!this.isHost() || this.voxels.count()) return;
            if (!this._autoTrace || !this.geo || !this.geo.anchor) return;
            if (this.modes && this.modes.isMatchActive()) return;
            this.traceWorld({ quiet: true });
        }

        async traceWorld(opts) {
            if (!this.isHost()) { this.showToast('Only the host can trace the map', 'warning'); return; }
            if (!this.geo || !this.geo.anchor) { this.showToast('Pin the world to a place first', 'warning'); return; }
            if (this.modes && this.modes.isMatchActive()) { this.showToast('Finish the match first', 'warning'); return; }
            opts = opts || {};
            if (this.voxels.count() && !opts.quiet && !window.confirm(
                'Trace this place from the map? The current world will be replaced.')) return;

            const note = document.getElementById('geoNote');
            // This action's own report holds the line for a few seconds.
            this._noteHeldUntil = Date.now() + 8000;
            if (note) note.textContent = 'Reading the map…';
            if (!opts.quiet) this.showToast('Drawing this place…', 'info', 2600);
            try {
                const t0 = Date.now();
                const sel = document.getElementById('geoTraceStyle');
                const style = opts.style || (sel && sel.value) || 'earth';
                // The world's own shape comes from coastline data; the other
                // two read the map's picture of the place instead.
                const built = style === 'earth'
                    ? await BlockPartyEarth.shapeFor(this)
                    : await BlockPartyTerrain.trace(this, { style });
                this.voxels.clearAll();
                this.undoStack.length = 0;
                this.redoStack.length = 0;
                this.restoreWorldFrom({
                    blocks: built.blocks, pieces: [],
                    ground: this.voxels.groundTint, geo: this.geo.anchor
                });
                this._updateBlockCount();
                this._refreshPlayers();
                this._sendWorldSnapshot();
                this._scheduleSave();
                if (this.minimap) this.minimap.draw();
                const kinds = Object.entries(built.counts || {})
                    .filter(([k]) => k !== 'ground')
                    .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k).join(', ');
                if (note) note.textContent = built.style === 'earth'
                    ? `Ground and sea from the real coastlines — ${built.land} land, ${built.sea} sea.`
                    : built.style === 'outline'
                        ? `Outlined from map tiles at zoom ${built.zoom} — coastlines and borders only.`
                        : `Traced from map tiles at zoom ${built.zoom} — mostly ${kinds}.`;
                this.showToast(built.style === 'earth'
                    ? `Ground and sea drawn here — ${built.land} land, ${built.sea} sea`
                    : opts.quiet
                        ? `Drew this place from the map — ${this.voxels.count()} blocks`
                        : `Traced ${this.voxels.count()} blocks from the map in ${Date.now() - t0}ms`,
                    'success', 3600);
            } catch (e) {
                if (note) note.textContent = e.message;
                if (!opts.quiet) this.showToast(e.message, 'error', 4200);
            }
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
                content: { v: 4, name, by: this.username, at: Date.now(), blocks: snap.blocks, pieces: snap.pieces, ground: snap.ground, geo: snap.geo },
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
                this.restoreWorldFrom({ blocks, pieces: saved.pieces, ground: saved.ground, geo: saved.geo });
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
            let lastX = 0, lastY = 0, downX = 0, downY = 0, downBtn = 0, downAlt = false;
            let pinchDist = 0;

            const MOVE_THRESHOLD = 6;

            el.addEventListener('contextmenu', (e) => e.preventDefault());

            el.addEventListener('pointerdown', (e) => {
                if (this.voxels.firstPerson) return;   // the walker owns the mouse
                el.setPointerCapture(e.pointerId);
                pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
                lastX = downX = e.clientX; lastY = downY = e.clientY;
                downBtn = e.button;
                downAlt = !!(e.altKey || e.metaKey);
                dragging = false;
                // Touch has no hover, so first contact is when the ghost appears.
                this._updateAim(e.clientX, e.clientY);
                if (pointers.size === 2) {
                    const pts = Array.from(pointers.values());
                    pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
                }
            });

            el.addEventListener('pointermove', (e) => {
                if (this.voxels.firstPerson) return;
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
                    // Alt-click takes a colour, which is the convention every
                    // drawing program uses and costs no button.
                    if (downAlt && !this.picking) {
                        this.setPicking(true);
                        this._actAt(downX, downY, false);
                        return;
                    }
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
                if (this.voxels.firstPerson) return;
                this.voxels.zoom(e.deltaY * 0.02);
            }, { passive: false });
        }

        _actAt(clientX, clientY, erase) {
            const pick = this.voxels.pick(clientX, clientY);
            if (!pick) return;

            // Fill is a two-tap gesture — corner, then opposite corner — so it
            // works the same with a mouse and a finger, and never fights the
            // drag-to-orbit that a click-and-drag box would need.
            // Dropping into first person: this click picks the spot.
            if (this._fpsDrop) {
                const spot = pick.place || pick.remove;
                this._cancelDrop();
                this.voxels.hideSpawnPreview();
                if (spot) this.fps.enterAt(spot.x, spot.z);
                return;
            }

            // Armed eyedropper: this click reads a colour and nothing else.
            if (this.picking) {
                const spot = pick.remove;
                this.setPicking(false);
                if (spot) this.eyedropAt(spot.x, spot.y, spot.z);
                else this.showToast('Nothing there to pick up', 'info', 1400);
                this._refreshAim();
                return;
            }

            const painting = !erase && this.tool === 'paint';

            if (this.fillMode) {
                // Painting works on what is already standing, so the box is
                // anchored to filled cells the way erasing is.
                const cell = (erase || painting) ? pick.remove : pick.place;
                if (!cell) return;
                if (!this.fillAnchor) {
                    this.fillAnchor = { x: cell.x, y: cell.y, z: cell.z, erase, paint: painting };
                    this.voxels.showRegion(cell, cell, erase);
                    this.showToast('Now tap the opposite corner — Esc cancels', 'info', 2400);
                } else {
                    this.fillRegion(this.fillAnchor, cell, this.fillAnchor.erase, this.fillAnchor.paint);
                    this.cancelFill();
                }
                this._refreshAim();
                return;
            }

            if (erase) {
                if (pick.remove) this.removeAt(pick.remove.x, pick.remove.y, pick.remove.z);
            } else if (painting) {
                if (pick.remove) this.paintAt(pick.remove.x, pick.remove.y, pick.remove.z);
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
            // Choosing where to stand is not choosing where to build: the whole
            // aim is a different question, so it gets its own answer.
            if (this._fpsDrop) {
                const spot = pick && (pick.place || pick.remove);
                this.voxels.hidePreview();
                this.voxels.hidePiecePreview();
                if (!spot) { this.voxels.hideSpawnPreview(); this._sendCursor({ hide: true }); return; }
                this.voxels.showSpawnPreview(spot.x, spot.z,
                    typeof this.generateUserColor === 'function' ? this.generateUserColor(this.username) : '#6366f1');
                // Nobody else needs to watch me deciding where to stand.
                this._sendCursor({ hide: true });
                return;
            }

            // Mid-fill the anchor decides which face to aim at, so switching
            // tools halfway through does not move the pending corner.
            const erasing = this.fillAnchor ? this.fillAnchor.erase : (this.tool === 'erase');
            // Painting and the armed eyedropper both act on what is standing,
            // so they aim at the filled cell rather than the empty face in
            // front of it.
            const onSolid = erasing || this.picking
                || (this.fillAnchor ? this.fillAnchor.paint : this.tool === 'paint');
            const cell = onSolid ? pick && pick.remove : pick && pick.place;
            if (!cell) {
                // No valid target (e.g. Erase aimed at empty ground). Tell the
                // others to drop my cursor, or they keep seeing a stale ghost.
                this.voxels.hidePreview();
                this.voxels.hidePiecePreview();
                this.voxels.hideLandingShadow();
                this._sendCursor({ hide: true });
                return;
            }

            // Mid-fill, the pending box is the useful preview, not one cell.
            if (this.fillMode && this.fillAnchor) {
                this.voxels.hidePreview();
                this.voxels.hidePiecePreview();
                this.voxels.hideLandingShadow();
                const n = this.voxels.showRegion(this.fillAnchor, cell, this.fillAnchor.erase);
                const hint = document.getElementById('fillHint');
                if (hint) hint.textContent = `${n} cell${n === 1 ? '' : 's'} — tap to ${this.fillAnchor.erase ? 'clear' : 'fill'}`;
            } else if (this.picking) {
                // Nothing is being added or taken away — just say which cell
                // the colour would come from.
                this.voxels.hidePiecePreview();
                this.voxels.showPreview(cell.x, cell.y, cell.z, 0, 0, 'pick');
                this.voxels.hideLandingShadow();
            } else if (this.tool === 'paint') {
                // Show the block wearing the new colour, in place, rather than
                // a ghost floating in front of it.
                this.voxels.hidePiecePreview();
                this.voxels.showPreview(cell.x, cell.y, cell.z, this.currentShape, this.currentColor);
                // The block is already standing on something; a shadow under it
                // would be a shadow under itself.
                this.voxels.hideLandingShadow();
            } else if (this.brickMode && !erasing && !this.fillMode) {
                // Show the whole brick, and show it red when it will not fit —
                // the footprint is the thing you need to judge before tapping.
                this.voxels.hidePreview();
                const { w, d } = this.pieceFootprint();
                this.voxels.showPiecePreview(cell.x, cell.y, cell.z, w, d, this.currentColor,
                    !!this.pieceBlocked(cell.x, cell.y, cell.z, w, d));
                this.voxels.showLandingShadow(cell.x, cell.y, cell.z, w, d);
            } else {
                this.voxels.hidePiecePreview();
                this.voxels.showPreview(cell.x, cell.y, cell.z, this.currentShape, this.currentColor,
                    erasing ? 'erase' : null);
                if (erasing) this.voxels.hideLandingShadow();
                else this.voxels.showLandingShadow(cell.x, cell.y, cell.z, 1, 1);
            }

            this._updateGeoReadout(cell);
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
        /** Pick any colour at all, not just the twelve swatches. */
        setCustomColor(hex) {
            const c = new THREE.Color(hex);
            this.currentColor = packRGB(Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255));
            const palette = document.getElementById('palette');
            if (palette) palette.querySelectorAll('.swatch').forEach(sw => sw.classList.remove('selected'));
            const chip = document.getElementById('customSwatch');
            if (chip) { chip.style.background = hex; chip.classList.add('selected'); }
            this._afterBrushChange();
        }

        _buildPalette() {
            const palette = document.getElementById('palette');
            palette.innerHTML = '';
            PALETTE.forEach((hex, i) => {
                const sw = document.createElement('div');
                sw.className = 'swatch' + (i === this.currentColor ? ' selected' : '');
                sw.style.background = hex;
                sw.title = hex;
                sw.addEventListener('click', () => this.selectColor(i));
                palette.appendChild(sw);
            });

            // The custom swatch doubles as the colour input, so any colour is
            // one click away from the twelve.
            const custom = document.createElement('label');
            custom.className = 'swatch custom';
            custom.id = 'customSwatch';
            custom.title = 'Any colour you like';
            custom.innerHTML = '<input type="color" id="customColor" value="#e07b39">';
            custom.querySelector('input').addEventListener('input', (e) => this.setCustomColor(e.target.value));
            palette.appendChild(custom);
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
            window.BlockPartySfx.tick();
            const bar = document.getElementById('shapes');
            if (bar) {
                bar.querySelectorAll('.shape-btn').forEach((b, idx) => {
                    b.classList.toggle('selected', idx === this.currentShape);
                });
            }
            this._afterBrushChange();
        }

        _bindUI() {
            const pickTool = (name) => {
                this.tool = name;
                this.setPicking(false);
                this._syncTool();
                this._refreshAim();
            };
            document.getElementById('toolBuild').addEventListener('click', () => pickTool('build'));
            document.getElementById('toolErase').addEventListener('click', () => pickTool('erase'));
            const paint = document.getElementById('toolPaint');
            if (paint) paint.addEventListener('click', () => pickTool('paint'));
            const pick = document.getElementById('toolPick');
            if (pick) pick.addEventListener('click', () => this.togglePicking());
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
            on('fpsBtn', 'click', () => this.toggleFirstPerson());
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
                if (k === 'escape') { this.cancelFill(); this.stopFollowing(); this._cancelDrop(); this.setPicking(false); }
                else if (k === 'b') { this.tool = 'build'; this.setPicking(false); this._syncTool(); this._refreshAim(); }
                else if (k === 'e') { this.tool = 'erase'; this.setPicking(false); this._syncTool(); this._refreshAim(); }
                else if (k === 'p') { this.tool = 'paint'; this.setPicking(false); this._syncTool(); this._refreshAim(); }
                else if (k === 'i') { this.togglePicking(); }
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
                else if (k === 'g') { this.toggleFirstPerson(); }
                else if (k === 'n') { this.minimap.toggle(); }
                else if (k === 'k') { this.toggleBrickMode(); }
                // 1..N pick a shape
                else if (/^[1-9]$/.test(k) && Number(k) <= SHAPES.length) { this.selectShape(Number(k) - 1); }
            });
        }

        // ---------- sound ----------
        _bindSound() {
            const sfx = window.BlockPartySfx;
            sfx.restore();
            // Browsers refuse to start audio until the player has touched the
            // page, so the first interaction is what opens it.
            const wake = () => sfx.init();
            window.addEventListener('pointerdown', wake, { once: true });
            window.addEventListener('keydown', wake, { once: true });

            const btn = document.getElementById('soundBtn');
            if (btn) {
                btn.classList.toggle('active', sfx.enabled);
                btn.textContent = sfx.enabled ? '🔊' : '🔇';
                btn.addEventListener('click', () => {
                    sfx.setEnabled(!sfx.enabled);
                    btn.classList.toggle('active', sfx.enabled);
                    btn.textContent = sfx.enabled ? '🔊' : '🔇';
                    if (sfx.enabled) sfx.tick();
                });
            }
        }

        // ---------- first person ----------
        /**
         * Leaving first person is immediate; entering asks where to stand
         * first, because dropping in wherever the camera happened to point is
         * rarely where you meant.
         */
        toggleFirstPerson() {
            if (this.fps.active) { this.fps.exit(); return; }
            if (this._fpsDrop) { this._cancelDrop(); return; }
            this._fpsDrop = true;
            this.voxels.renderer.domElement.style.cursor = 'crosshair';
            document.getElementById('fpsBtn').classList.add('active');
            this.showToast('Click where you want to stand — Esc to cancel', 'info', 4000);
            this._refreshAim();     // swap the brick ghost for a figure at once
        }

        _cancelDrop() {
            if (!this._fpsDrop) return;
            this._fpsDrop = false;
            this.voxels.renderer.domElement.style.cursor = '';
            this.voxels.hideSpawnPreview();
            document.getElementById('fpsBtn').classList.remove('active');
            this._refreshAim();
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
            window.BlockPartySfx.tick();
            const bar = document.getElementById('bricks');
            if (bar) {
                bar.querySelectorAll('.brick-btn').forEach(b => {
                    b.classList.toggle('selected', b.getAttribute('data-brick') === id);
                });
            }
            this._afterBrushChange();
        }

        rotateBrick() {
            if (!this.brickMode) return;
            this.brickRotated = !this.brickRotated;
            window.BlockPartySfx.tick();
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

        /**
         * Arm the next click to take a colour instead of using one.
         *
         * Alt-click does it without arming anything, which is what people who
         * know the convention will reach for; the button is for everyone else,
         * and it disarms itself the moment it has been used.
         */
        setPicking(on) {
            this.picking = !!on;
            const btn = document.getElementById('toolPick');
            if (btn) btn.classList.toggle('active', this.picking);
            if (this.picking) this.showToast('Tap a block to take its colour — Esc cancels', 'info', 2400);
            this._refreshAim();
        }

        togglePicking() { this.setPicking(!this.picking); }

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
            const players = Math.max(1, (this.getConnectedUsers() || []).length);
            list.innerHTML = BlockPartyModes.MODES.map(m => `
                <button class="mode-card${m.id === this._pickedMode ? ' selected' : ''}${m.ready ? '' : ' soon'}"
                        data-mode="${m.id}" ${m.ready ? '' : 'disabled'}>
                    <span class="mode-emoji">${m.emoji}</span>
                    <span class="mode-body">
                        <span class="mode-name">${this._esc(m.name)}${m.ready ? '' : ' <em>soon</em>'}</span>
                        <span class="mode-desc">${this._esc(m.desc)}</span>
                        ${this._playerNote(m, players)}
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

        // Say up front which modes want more people, rather than letting someone
        // start a guessing game with nobody to guess.
        _playerNote(mode, players) {
            const need = mode.minPlayers || 1;
            if (players < need) {
                return `<span class="mode-warn">Needs ${need}+ players — you have ${players}</span>`;
            }
            return mode.note ? `<span class="mode-note">${this._esc(mode.note)}</span>` : '';
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
            this._bindImageImport();
            this._bindGeoUI();
            on('mapList', 'click', (e) => {
                const btn = e.target.closest && e.target.closest('button[data-map]');
                if (btn) this.loadMap(btn.getAttribute('data-map'));
            });
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
            this._renderMaps();
            this._syncGeoUI();
            this._syncWorldControls();
            this._loadSlotList();
            this._fetchStats();
        }

        _closeWorldModal() {
            const modal = document.getElementById('worldModal');
            if (modal) modal.classList.add('hidden');
        }

        _renderMaps() {
            const list = document.getElementById('mapList');
            if (!list) return;
            const host = this.isHost();
            list.innerHTML = BlockPartyMaps.MAPS.map(m => `
                <button class="map-card" data-map="${this._esc(m.id)}" ${host ? '' : 'disabled'}>
                    <span class="map-emoji">${m.emoji}</span>
                    <span class="map-body">
                        <span class="map-name">${this._esc(m.name)}</span>
                        <span class="map-desc">${this._esc(m.desc)}</span>
                    </span>
                </button>`).join('');
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

        // ---------- remembered locations ----------
        /**
         * Where people were, kept in the room's storage. Written by the host on
         * a debounce — positions arrive every few seconds and none of them is
         * worth a round trip on its own.
         */
        scheduleGeoSave() {
            if (!this.isHost()) return;
            clearTimeout(this._geoSaveTimer);
            this._geoSaveTimer = setTimeout(() => this._saveGeoSeen(), 8000);
        }

        _saveGeoSeen() {
            if (!this.isHost() || !this.channel || !this.geo) return;
            const seen = this.geo.exportSeen();
            const visits = this.geo.exportVisits();
            if (!Object.keys(seen).length && !Object.keys(visits).length) return;
            this._storage(
                (cb) => this.channel.storagePut({
                    storageKey: GEO_SEEN_KEY, content: { v: 2, seen, visits }, encrypted: false,
                    metadata: { description: 'BlockParty last-known locations and places visited' }
                }, cb),
                (res) => {
                    if (res && res.status !== 'success') {
                        console.warn('[BlockParty] location memory save failed:', res.statusMessage);
                    }
                });
        }

        // ---------- worlds already built ----------
        /**
         * Every region this room has left a world in.
         *
         * Regions persist one world each, so a room that has travelled slowly
         * leaves builds scattered across the Earth — and until now nothing said
         * where. Read back as pins on the map, travel stops being navigation to
         * coordinates and becomes going back somewhere.
         *
         * Keys only. The values are the worlds themselves: a room with forty
         * regions would pull megabytes of block arrays to draw forty dots.
         */
        _loadSettlements() {
            if (!this.channel || typeof this.channel.storageKeys !== 'function') return;
            this._storage((cb) => this.channel.storageKeys(cb), (res) => {
                const data = this._storagePayload(res);
                if (!data || !data.keys) return;
                const prefix = STORAGE_KEY + '_';
                const found = [];
                data.keys.forEach(key => {
                    if (key.indexOf(prefix) !== 0) return;
                    const parts = key.slice(prefix.length).split('_').map(Number);
                    if (parts.length !== 3 || parts.some(n => !isFinite(n))) return;
                    const [z, x, y] = parts;
                    // The region carries its own centre and scale, so a pin
                    // needs nothing from the world it is standing for.
                    const region = this.geo.regionAt(z, x, y);
                    found.push({
                        key, z, x, y, region: region.key,
                        lat: region.lat, lon: region.lon, mpc: region.mpc,
                        span: Math.round((this.voxels.half * 2 + 1) * region.mpc)
                    });
                });
                this.settlements = found;
                if (this.minimap) { this.minimap.draw(); this.minimap.renderPlaces(); }
            });
        }

        /**
         * A world was just saved somewhere. Rather than re-reading every key,
         * note the one region we know about — the full list is refreshed on the
         * next arrival anyway.
         */
        _noteSettlement() {
            const region = this.geo && this.geo.region;
            if (!region) return;
            this.settlements = this.settlements || [];
            if (this.settlements.some(w => w.region === region.key)) return;
            this.settlements.push({
                key: STORAGE_KEY + '_' + region.key,
                z: region.z, x: region.x, y: region.y, region: region.key,
                lat: region.lat, lon: region.lon, mpc: region.mpc,
                span: Math.round((this.voxels.half * 2 + 1) * region.mpc)
            });
            if (this.minimap) this.minimap.renderPlaces();
        }

        _loadGeoSeen() {
            if (!this.channel || !this.geo) return;
            this._storage(
                (cb) => this.channel.storageGet({ storageKey: GEO_SEEN_KEY }, cb),
                (res) => {
                    const data = res && res.status === 'success' && res.data;
                    if (!data) return;
                    // v1 documents have no visits; a room that predates them
                    // simply starts its history now.
                    if (data.seen) this.geo.importSeen(data.seen);
                    if (data.visits) this.geo.importVisits(data.visits);
                    if (this.minimap) this.minimap.renderPlaces();
                });
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

        /** Big counted numbers over the world: 3, 2, 1, GO. */
        showCountdown(text) {
            const el = document.getElementById('ceremony');
            if (!el) return;
            el.textContent = text;
            el.classList.remove('hidden');
            // Restart the animation even if the last one has not finished.
            el.style.animation = 'none';
            void el.offsetWidth;
            el.style.animation = '';
            clearTimeout(this._ceremonyTimer);
            this._ceremonyTimer = setTimeout(() => el.classList.add('hidden'), 900);
        }

        /** A line of headline text — a guess landing, a round won. */
        showBanner(text) {
            const el = document.getElementById('banner');
            if (!el) return;
            el.textContent = text;
            el.classList.remove('hidden');
            clearTimeout(this._bannerTimer);
            this._bannerTimer = setTimeout(() => el.classList.add('hidden'), 3200);
        }

        /**
         * Run every number in the results panel up from zero. A score that
         * simply appears is information; a score that climbs is a result.
         */
        _countUpScores() {
            const nodes = Array.from(document.querySelectorAll('#rsBody .rs-points, #rsBody .rs-total span:last-child'));
            const targets = nodes.map(n => {
                const raw = (n.firstChild && n.firstChild.nodeValue) || n.textContent;
                return { node: n, to: parseInt(String(raw).replace(/[^0-9-]/g, ''), 10) || 0, html: n.innerHTML };
            }).filter(t => t.to > 0);
            if (!targets.length) return;

            clearInterval(this._countTimer);
            const started = performance.now();
            const DUR = 900;
            let lastTick = 0;
            this._countTimer = setInterval(() => {
                const t = Math.min(1, (performance.now() - started) / DUR);
                const eased = 1 - Math.pow(1 - t, 3);
                targets.forEach(target => {
                    const value = Math.round(target.to * eased);
                    const extra = target.html.indexOf('<span') >= 0
                        ? target.html.slice(target.html.indexOf('<span')) : '';
                    target.node.innerHTML = value + extra;
                });
                if (t - lastTick > 0.18) { lastTick = t; window.BlockPartySfx.chime(Math.round(t * 8)); }
                if (t >= 1) {
                    clearInterval(this._countTimer);
                    targets.forEach(target => { target.node.innerHTML = target.html; });
                }
            }, 40);
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
            this._countUpScores();
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
            set('toolPaint', this.tool === 'paint');
            set('toolPick', this.picking);
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
