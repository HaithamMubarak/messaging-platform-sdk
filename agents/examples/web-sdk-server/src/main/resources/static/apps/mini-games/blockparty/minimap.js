/**
 * BlockParty — the map
 *
 * A world 161 blocks across is bigger than one screen, and once it is pinned to
 * real coordinates it is a map of somewhere. This draws it from above: the real
 * coast underneath, what has been built on top, where everybody is, where
 * everybody *was*, everywhere the room has been, and where the camera is
 * looking. Drag it, zoom it, double-click a spot to go there, or type
 * coordinates and go.
 *
 * Two rules keep it honest as a map rather than a decoration:
 *
 * 1. Everything is projected the same way. The coastlines are Web Mercator,
 *    because a region *is* a Mercator tile — so people, trails and the
 *    graticule are drawn in Mercator too. Placing a pin with the world's own
 *    flat local projection agrees near the anchor and drifts badly a country
 *    away, which is exactly where the interesting pins are.
 *
 * 2. Once you drag it, the view is a place, not an offset. It stops following
 *    the camera, so nothing slides out from under your finger while you read
 *    it. ⌖ hands it back.
 *
 * It reads a column index the world keeps up to date — the top block of every
 * (x, z) — rather than walking tens of thousands of cells on every redraw.
 */
(function () {
    'use strict';

    const DEFAULT_SIZE = 248;      // canvas edge, in CSS pixels
    const MIN_SIZE = 170, MAX_SIZE = 560;
    // Repaints are driven by change now (see invalidate/frame), not by a clock.
    // This is only the fallback tick for state with no hook of its own.
    const IDLE_MS = 1000;

    // A dark cartographic palette, so the map reads as a map inside a dark
    // panel rather than as the daylight one painted on the ground. Published
    // as Minimap.PALETTE: anything checking what the map drew has to check
    // against the colours the map actually uses, not the ground's.
    const MAP = {
        sea: '#0e1a2e',
        seaDeep: '#0a1424',
        // Nowhere: what the map shows when the world is not on the Earth. A
        // neutral grey, the cartographic convention for no data — and far
        // enough from both land and sea that an unpinned world cannot be read
        // as either a continent or an ocean.
        blank: '#24242e',
        blankHatch: 'rgba(255,255,255,0.035)',
        land: '#2f3a52',
        landEdge: '#3c4a67',
        coast: 'rgba(158,197,255,0.85)',
        coastGlow: 'rgba(99,150,255,0.20)',
        grid: 'rgba(255,255,255,0.055)',
        gridMajor: 'rgba(255,255,255,0.11)',
        gridText: 'rgba(200,214,240,0.42)',
        chrome: 'rgba(232,238,252,0.78)',
        chromeDim: 'rgba(232,238,252,0.42)',
        shadow: 'rgba(6,10,22,0.85)'
    };

    // Nice graticule steps, in degrees — the ladder every atlas uses.
    const STEPS = [45, 30, 15, 10, 5, 2, 1, 0.5, 0.25, 0.1, 0.05, 0.02, 0.01,
        0.005, 0.002, 0.001, 0.0005, 0.0002, 0.0001];

    // The projection lives in geo.js, because the world's regions are defined
    // by it — the map and the world must agree on where things are.
    const M = () => window.BlockPartyGeo.MERCATOR;

    const LAYER_KEY = 'bp_minimap_layers';
    const SIZE_KEY = 'bp_minimap_size';

    class Minimap {
        constructor(game) {
            this.game = game;
            this.canvas = document.getElementById('minimap');
            this.open = false;
            if (!this.canvas) return;

            // The map is a rectangle. `size` stays the SHORT side and remains the
            // basis for scale/zoom, so a wider map shows more ground rather than
            // stretched ground — anisotropic scaling would shear the coastlines.
            const saved = this._restoreSize();
            this.vw = this._fit(saved.w);
            this.vh = this._fit(saved.h);
            this.ctx = this.canvas.getContext('2d');
            this._resizeCanvas();

            // The basemap is drawn once per view into its own canvas and then
            // blitted, so a redraw four times a second costs nothing.
            this.base = document.createElement('canvas');
            this.baseReady = false;
            this.baseKey = null;

            // What is drawn. Everything on by default; the ones people turn off
            // are turned off for a reason and should stay that way.
            this.layers = Object.assign({
                map: true, build: true, people: true, trails: true, grid: true, worlds: true
            }, this._restoreLayers());
            this.showMap = this.layers.map;   // kept for older callers

            // How far out the map is pulled, in doublings of the world's own
            // width: 0 shows this world exactly, 4 shows sixteen worlds of
            // ground around it, -2 shows a quarter of it close up.
            this.zoom = 0;
            // Where the map is looking. Until it is dragged this follows the
            // world (or the camera, close in); a drag pins it to a place and
            // it stops moving on its own.
            this.locked = false;
            this.centre = { x: 0, z: 0 };
            // Kept so old code and tests that poke at `pan` still read sanely.
            this.pan = { x: 0, z: 0 };
            this.expanded = new Set();

            // A double-click is two clicks first. Acting on the first one
            // moves the camera and complains about the spot before the card
            // that is about to explain it has even opened, so the single-click
            // action waits long enough to be cancelled by its own second half.
            this.canvas.addEventListener('click', (e) => {
                const at = this._at(e), armed = this.armed;
                clearTimeout(this._clickTimer);
                this._clickTimer = setTimeout(() => this._click(at, armed), 220);
            });
            this.canvas.addEventListener('dblclick', (e) => {
                clearTimeout(this._clickTimer);
                this._dblclick(e);
            });
            this.canvas.addEventListener('contextmenu', (e) => {
                // Right-click is the desktop way to ask "what is here?".
                e.preventDefault();
                this._openScope(e);
            });
            this._initPan();
            this._initDrag();
            this._initResize();
            this._initControls();
            this._initGoBox();
            this._initScope();
            this._initPlaces();
        }

        // ---- chrome ------------------------------------------------------

        _initControls() {
            const travel = document.getElementById('minimapTravel');
            if (travel) {
                travel.addEventListener('click', () => {
                    // Arm the next click to move the whole room, rather than
                    // just the camera. It disarms itself either way. The
                    // double-click card is the quicker way; this stays for
                    // touch, where a double-tap is easy to miss.
                    this.armed = !this.armed;
                    travel.classList.toggle('armed', this.armed);
                    travel.textContent = this.armed ? '🌍 pick a spot' : '🌍 travel';
                });
            }
            const pin = document.getElementById('minimapPin');
            if (pin) pin.addEventListener('click', () => this.game.pinToMyLocation());

            const zoomBtn = (id, by) => {
                const el = document.getElementById(id);
                if (el) el.addEventListener('click', () => this.setZoom(this.zoom + by));
            };
            zoomBtn('minimapZoomIn', -1);
            zoomBtn('minimapZoomOut', 1);

            const home = document.getElementById('minimapHome');
            if (home) home.addEventListener('click', () => this.recentre());

            const me = document.getElementById('minimapMe');
            if (me) me.addEventListener('click', () => this.centreOnMe());

            this.canvas.addEventListener('wheel', (e) => {
                e.preventDefault();
                // Zoom about the pointer, the way every map does: the thing you
                // are pointing at is the thing you want to keep looking at.
                this.setZoom(this.zoom + (e.deltaY > 0 ? 1 : -1), this._at(e));
            }, { passive: false });

            // Where the pointer is, in the real world, without a redraw.
            this.canvas.addEventListener('pointermove', (e) => this._readout(e));
            this.canvas.addEventListener('pointerleave', () => this._readout(null));

            const layers = document.getElementById('minimapLayers');
            const menu = document.getElementById('minimapLayerMenu');
            if (layers && menu) {
                layers.addEventListener('click', (e) => {
                    e.stopPropagation();
                    menu.classList.toggle('hidden');
                    layers.classList.toggle('active', !menu.classList.contains('hidden'));
                });
                menu.addEventListener('click', (e) => e.stopPropagation());
                menu.querySelectorAll('input[data-layer]').forEach(box => {
                    const key = box.getAttribute('data-layer');
                    box.checked = this.layers[key] !== false;
                    box.addEventListener('change', () => this.setLayer(key, box.checked));
                });
                document.addEventListener('click', () => {
                    menu.classList.add('hidden');
                    layers.classList.remove('active');
                });
            }

            const close = document.getElementById('minimapClose');
            if (close) close.addEventListener('click', () => this.setOpen(false));

            const toggle = document.getElementById('mapBtn');
            if (toggle) toggle.addEventListener('click', () => this.toggle());
        }

        setLayer(key, on) {
            this.layers[key] = !!on;
            if (key === 'map') { this.showMap = !!on; this.baseKey = null; }
            try { localStorage.setItem(LAYER_KEY, JSON.stringify(this.layers)); } catch (e) { /* fine */ }
            this.draw();
        }

        _restoreLayers() {
            try { return JSON.parse(localStorage.getItem(LAYER_KEY) || '{}') || {}; }
            catch (e) { return {}; }
        }

        /**
         * The remembered map size, as {w, h}.
         *
         * Older builds stored a single number because the map was locked
         * square; that value is still honoured and read as both axes, so an
         * existing player's map does not jump the first time they open it.
         */
        _restoreSize() {
            const ok = (n) => isFinite(n) && n >= MIN_SIZE && n <= MAX_SIZE;
            let raw = null;
            try { raw = localStorage.getItem(SIZE_KEY); } catch (e) { /* fine */ }
            if (raw) {
                if (raw.charAt(0) === '{') {
                    try {
                        const v = JSON.parse(raw);
                        if (ok(+v.w) && ok(+v.h)) return { w: +v.w, h: +v.h };
                    } catch (e) { /* fall through to the default */ }
                } else if (ok(+raw)) {
                    return { w: +raw, h: +raw };
                }
            }
            return { w: DEFAULT_SIZE, h: DEFAULT_SIZE };
        }

        /**
         * A size that fits the screen it is on.
         *
         * The map is resizable and the size is remembered, so a map dragged out
         * to half a desktop follows the player onto a phone in landscape, where
         * it would cover the game. The remembered size is a wish, not a
         * promise: the window has the last word, and it may go below the
         * resize handle's own minimum to keep it.
         */
        _fit(size) {
            const room = Math.min(window.innerWidth, window.innerHeight);
            // A phone has to keep the tool dock and the roster reachable, and
            // this panel is now taller than it was — map, coordinate box, foot
            // and list. A desktop can give the map whatever it is dragged to.
            const ceiling = room < 480 ? room * 0.38 : room * 0.55;
            return Math.round(Math.max(110, Math.min(size, ceiling)));
        }

        /** Match the backing store to the CSS size, at the screen's density. */
        _resizeCanvas() {
            const dpr = Math.min(2, window.devicePixelRatio || 1);
            this.canvas.width = Math.round(this.vw * dpr);
            this.canvas.height = Math.round(this.vh * dpr);
            this.canvas.style.width = this.vw + 'px';
            this.canvas.style.height = this.vh + 'px';
            this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            if (this.base) {
                this.base.width = this.canvas.width;
                this.base.height = this.canvas.height;
                this.baseKey = null;
            }
        }

        /**
         * Drag the bottom-right corner to make the map bigger.
         *
         * A map you cannot see detail on is a compass, not a map — and how much
         * of the screen it is worth giving up is the player's call, not ours.
         */
        _initResize() {
            const grip = document.getElementById('minimapResize');
            if (!grip) return;
            let from = null;
            grip.style.touchAction = 'none';
            grip.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                from = { x: e.clientX, y: e.clientY, vw: this.vw, vh: this.vh };
                try { grip.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
            });
            grip.addEventListener('pointermove', (e) => {
                if (!from) return;
                // Independent axes: the map was locked square, so it could never
                // be dragged to the shape of the screen it sits on.
                const clamp = (n) => this._fit(Math.max(MIN_SIZE, Math.min(MAX_SIZE, n)));
                const w = clamp(from.vw + (e.clientX - from.x));
                const h = clamp(from.vh + (e.clientY - from.y));
                if (w === this.vw && h === this.vh) return;
                this.vw = w; this.vh = h;
                this._resizeCanvas();
                this.draw();
            });
            const end = (e) => {
                if (!from) return;
                from = null;
                try { grip.releasePointerCapture(e.pointerId); } catch (err) { /* fine */ }
                try { localStorage.setItem(SIZE_KEY, JSON.stringify({ w: this.vw, h: this.vh })); } catch (err) { /* fine */ }
                this._reflow();
            };
            grip.addEventListener('pointerup', end);
            grip.addEventListener('pointercancel', end);
        }

        /**
         * Ask for a repaint on the next animation frame.
         *
         * The map used to repaint on a 400ms setInterval no matter what, which
         * is both too slow and too often: moving showed up to 400ms late, and
         * a map of a world nobody is touching still walked every column twice a
         * second. Coalescing to one frame means many invalidations in a single
         * frame cost one draw, and an idle map costs nothing.
         */
        invalidate() {
            if (!this.open || this._rafId) return;
            this._rafId = requestAnimationFrame(() => {
                this._rafId = 0;
                this.draw();
            });
        }

        /**
         * Called from the game's own render loop, so there is no second rAF.
         *
         * Cheap on purpose: build a short signature of everything the map draws
         * from live state and only repaint when it actually changed. The camera
         * angle is quantised so a slow cinematic drift does not force a redraw
         * every single frame.
         */
        frame() {
            if (!this.open) return;
            const g = this.game, v = g.voxels;
            if (!v) return;
            const f = g.fps;
            const sig = (v.target ? v.target.x.toFixed(2) + ',' + v.target.z.toFixed(2) : '') + '|'
                + (v.cam ? Math.round(v.cam.theta * 100) : '') + '|'
                + (f && f.active ? f.pos.x.toFixed(2) + ',' + f.pos.z.toFixed(2) + ',' + Math.round(f.yaw * 50) : '') + '|'
                + (v.columnsRev | 0);
            if (sig === this._sig) return;
            this._sig = sig;
            this.invalidate();
        }

        toggle() { this.setOpen(!this.open); }

        setOpen(on) {
            this.open = !!on;
            const panel = document.getElementById('minimapPanel');
            if (panel) panel.classList.toggle('hidden', !this.open);
            const btn = document.getElementById('mapBtn');
            if (btn) btn.classList.toggle('active', this.open);
            clearInterval(this._timer);
            this._closeScope();
            if (this.open) {
                // The panel has no layout until it is unhidden, so its width can
                // only be measured now — and again next frame, once the rows
                // below the map have settled and set the panel's true width.
                this._fillStage();
                this.draw();
                requestAnimationFrame(() => { if (this.open && this._fillStage()) this.draw(); });
                this.renderPlaces();
                // A slow safety tick for the few things with no change hook of
                // their own — an avatar going stale, a remembered pin ageing.
                this._timer = setInterval(() => this.invalidate(), IDLE_MS);
            }
        }

        // ---- the basemap -------------------------------------------------

        /**
         * Draw the real place under the world: land, water, and the coast
         * between them, and nothing else.
         *
         * The same coastlines the ground is painted from, drawn at the map's
         * own scale — a skeleton of the world rather than a picture of it. No
         * tiles, no network, no third party watching which places get looked
         * at, and it works at any zoom because it is drawn, not fetched.
         */
        _ensureBasemap() {
            const geo = this.game.geo;
            if (!this.layers.map || !geo || !geo.anchor || !geo.region || !window.BlockPartyEarth) {
                this.baseReady = false;
                return;
            }

            const a = geo.anchor;
            const c = this._centre();
            // The view moves, so the coast has to be redrawn when it does — but
            // redrawing every coastline on Earth once per pointer event is not
            // how a map pans. While the view is moving the cached image is
            // blitted at an offset, which is exact, and the repaint happens
            // once the movement settles.
            const key = [a.region, this.zoom, this.game.voxels.half, this.vw, this.vh,
                Math.round(c.x * 4), Math.round(c.z * 4)].join(',');
            if (key === this.baseKey) return;         // already drawn for this view
            this.baseKey = key;

            const paint = () => BlockPartyEarth.load().then(earth => {
                // The map may have moved on while the coastlines were loading.
                if (this.baseKey !== key) return;
                this._paintBase(earth);
                this.baseReady = true;
                this.draw();
            }).catch(() => { this.baseReady = false; });

            clearTimeout(this._baseTimer);
            // Nothing to blit yet, or the offset trick cannot cover it: draw now.
            if (!this.baseReady || !this._blitFits()) paint();
            else this._baseTimer = setTimeout(paint, 140);
        }

        /**
         * Whether the cached coast can stand in for the real one right now.
         *
         * It can if it was drawn at this zoom and this size and the view has
         * not slid so far that most of the canvas would be empty sea.
         */
        _blitFits() {
            const v = this.baseView;
            if (!v || v.zoom !== this.zoom || v.vw !== this.vw || v.vh !== this.vh) return false;
            const c = this._centre(), s = this.scale;
            return Math.abs((v.centre.x - c.x) * s) < this.vw * 0.45
                && Math.abs((v.centre.z - c.z) * s) < this.vh * 0.45;
        }

        /** Where the cached coast belongs on the canvas, now. */
        _blitOffset() {
            const v = this.baseView, c = this._centre(), s = this.scale;
            return { dx: (v.centre.x - c.x) * s, dy: (v.centre.z - c.z) * s };
        }

        /**
         * The coastlines of what is on screen. Past zoom 0 that is more ground
         * than this world covers, so the region is scaled down inside the
         * canvas rather than the projection being changed: same maths, same
         * place, just further away.
         */
        _paintBase(earth) {
            const geo = this.game.geo;
            const W = this.vw, H = this.vh;
            // What this image is of, so a later frame can tell whether it can
            // still be used and where it now belongs.
            const c = this._centre();
            this.baseView = { centre: { x: c.x, z: c.z }, zoom: this.zoom, vw: W, vh: H };
            const dpr = this.base.width / W;
            const ctx = this.base.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            // A sea with a little depth to it, so a coastline has somewhere to be.
            const sky = ctx.createLinearGradient(0, 0, 0, H);
            sky.addColorStop(0, MAP.sea);
            sky.addColorStop(1, MAP.seaDeep);
            ctx.fillStyle = sky;
            ctx.fillRect(0, 0, W, H);

            const path = BlockPartyEarth.ringPath(earth, geo.region, this.tileSpan,
                { w: W, h: H, ox: this.tileOrigin.cx, oy: this.tileOrigin.cy });

            ctx.fillStyle = MAP.land;
            ctx.fill(path, 'evenodd');

            // A wide, faint stroke under a thin bright one: the shoreline reads
            // at a glance without turning into a cartoon outline up close.
            ctx.lineJoin = ctx.lineCap = 'round';
            ctx.strokeStyle = MAP.coastGlow;
            ctx.lineWidth = Math.max(2.5, Math.min(6, this.tileSpan / 120));
            ctx.stroke(path);
            ctx.strokeStyle = MAP.coast;
            ctx.lineWidth = Math.max(0.6, Math.min(1.4, this.tileSpan / 300));
            ctx.stroke(path);
        }

        // ---- projection --------------------------------------------------

        /** How many cells of ground the map is showing across. */
        get viewCells() { return (this.game.voxels.half * 2 + 1) * Math.pow(2, this.zoom); }

        /** Screen pixels per world cell. */
        /**
         * The short side of the map — the basis for scale and zoom.
         *
         * The map used to be square and `size` was the one dimension, so
         * callers set it to resize. It is now derived from the two axes, but
         * assigning it still works and makes the map square, so nothing that
         * predates the rectangle breaks.
         */
        get size() { return Math.min(this.vw, this.vh); }
        set size(n) {
            const v = this._fit(n);
            this.vw = v;
            this.vh = v;
        }

        get scale() { return this.size / this.viewCells; }

        /** How many pixels one whole region tile covers at this zoom. */
        get tileSpan() { return this.size / Math.pow(2, this.zoom); }

        /** Where the region's north-west corner falls on the canvas. */
        get tileOrigin() {
            const half = this.game.voxels.half;
            return this._toCanvas(-half, -half);
        }

        /**
         * What the map centres itself on when it has not been dragged. Pulled
         * out, that is the world; pushed in past its edges it follows the
         * camera, because at that magnification the centre of the world is
         * rarely where you are.
         */
        _autoCentre() {
            return this.zoom >= 0
                ? { x: 0, z: 0 }
                : { x: this.game.voxels.target.x, z: this.game.voxels.target.z };
        }

        _centre() {
            return this.locked ? this.centre : this._autoCentre();
        }

        /** Hold the view over a place, and stop following anything. */
        _lockTo(c) {
            this.locked = true;
            this.centre = { x: c.x, z: c.z };
            const auto = this._autoCentre();
            this.pan = { x: c.x - auto.x, z: c.z - auto.z };
        }

        /** Put the map back over whatever it centres itself on. */
        recentre() {
            this.locked = false;
            this.pan = { x: 0, z: 0 };
            this.draw();
        }

        /** Hold the view over wherever I am, if the room knows. */
        centreOnMe() {
            const g = this.game;
            const place = g.geo && g.geo.placeOf(g.username);
            if (!place) {
                g.showToast('Share your location, or use 📍 to pin this world where you are', 'warning', 3600);
                return;
            }
            const w = g.geo.toWorld(place.rec.lat, place.rec.lon);
            if (!w) { g.showToast('Pin this world to a place first', 'warning'); return; }
            this._lockTo(w);
            this.draw();
        }

        _toCanvas(x, z) {
            const c = this._centre(), s = this.scale;
            return { cx: this.vw / 2 + (x - c.x) * s, cy: this.vh / 2 + (z - c.z) * s };
        }

        /** Canvas pixels back to world cells, unrounded. */
        _toWorldF(cx, cy) {
            const c = this._centre(), s = this.scale;
            return { x: c.x + (cx - this.vw / 2) / s, z: c.z + (cy - this.vh / 2) / s };
        }

        _toWorld(cx, cy) {
            const p = this._toWorldF(cx, cy);
            return { x: Math.round(p.x), z: Math.round(p.z) };
        }

        /**
         * Real coordinates straight to map pixels, in Web Mercator.
         *
         * This is the projection the coastlines are drawn in, so a pin lands on
         * the shore it is actually on — at any distance. The world's own flat
         * projection is used only when there is no region to be in.
         */
        _llToCanvas(lat, lon) {
            const geo = this.game.geo;
            const region = geo && geo.region;
            if (!region) {
                const w = geo && geo.toWorld(lat, lon);
                return w ? this._toCanvas(w.x, w.z) : null;
            }
            const o = this.tileOrigin, span = this.tileSpan;
            return {
                cx: o.cx + (M().lonToTileX(lon, region.z) - region.x) * span,
                cy: o.cy + (M().latToTileY(lat, region.z) - region.y) * span
            };
        }

        /** Map pixels back to real coordinates, in the same projection. */
        _canvasToLatLon(cx, cy) {
            const geo = this.game.geo;
            const region = geo && geo.region;
            if (!region) {
                const w = this._toWorldF(cx, cy);
                return geo && geo.anchor ? geo.toLatLon(w.x, w.z) : null;
            }
            const o = this.tileOrigin, span = this.tileSpan;
            return {
                lat: M().tileYToLat(region.y + (cy - o.cy) / span, region.z),
                lon: M().tileXToLon(region.x + (cx - o.cx) / span, region.z)
            };
        }

        /**
         * How far out this map can go: far enough to show the whole Earth,
         * whatever scale the world itself is at. A street-scale world is 380
         * metres across, so seeing the coast from it means pulling back a
         * hundred thousand times — which is a map's job, not the world's.
         */
        maxZoom() {
            const a = this.game.geo && this.game.geo.anchor;
            if (!a) return 6;
            const cells = this.game.voxels.half * 2 + 1;
            return Math.max(4, Math.min(20, Math.ceil(Math.log2(40075017 / (cells * a.mpc)))));
        }

        /**
         * Pull the map out or push it in, within what the projection can hold.
         * Given a point, that point stays where it is on screen.
         */
        setZoom(z, at) {
            const next = Math.max(-3, Math.min(this.maxZoom(), z));
            if (next === this.zoom) return;
            const before = at ? this._toWorldF(at.cx, at.cy) : null;
            this.zoom = next;
            if (before) {
                const c = this._centre();
                const after = this._toWorldF(at.cx, at.cy);
                this._lockTo({ x: c.x + (before.x - after.x), z: c.z + (before.z - after.z) });
            }
            this._closeScope();
            this.draw();
        }

        /** A pointer event in the map's own pixels. */
        _at(e) {
            const rect = this.canvas.getBoundingClientRect();
            const kx = rect.width ? this.vw / rect.width : 1;
            const ky = rect.height ? this.vh / rect.height : 1;
            return { cx: (e.clientX - rect.left) * kx, cy: (e.clientY - rect.top) * ky };
        }

        // ---- panning the view --------------------------------------------

        /**
         * Drag the map itself to look somewhere else.
         *
         * A tap still means "go there", so the two have to be told apart: past
         * a few pixels of movement it is a drag, and the click the browser
         * sends afterwards is swallowed. Pointer events cover mouse, pen and
         * finger at once, which is the only reason this is not three handlers.
         *
         * The drag sets an absolute centre rather than an offset, so the view
         * stops following the camera the moment you take hold of it — otherwise
         * everything on the map slides out from under the finger reading it.
         */
        _initPan() {
            const c = this.canvas;
            let from = null;
            c.style.touchAction = 'none';       // the finger pans the map, not the page

            c.addEventListener('pointerdown', (e) => {
                if (e.button !== undefined && e.button > 1) return;
                const centre = this._centre();
                from = { x: e.clientX, y: e.clientY, centre, moved: false };
                try { c.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
            });
            c.addEventListener('pointermove', (e) => {
                if (!from) return;
                const rect = c.getBoundingClientRect();
                // The canvas may be displayed smaller than it is drawn.
                const kx = rect.width ? this.vw / rect.width : 1;
                const ky = rect.height ? this.vh / rect.height : 1;
                const dx = (e.clientX - from.x) * kx, dy = (e.clientY - from.y) * ky;
                if (!from.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
                if (!from.moved) { from.moved = true; this._closeScope(); c.classList.add('dragging'); }
                const s = this.scale;
                this._lockTo({ x: from.centre.x - dx / s, z: from.centre.z - dy / s });
                // A high-rate mouse delivers well over 60 of these a second;
                // one draw per frame is all the screen can show anyway.
                this.invalidate();
            });
            const end = (e) => {
                if (!from) return;
                if (from.moved) this._pannedAt = Date.now();
                from = null;
                c.classList.remove('dragging');
                try { c.releasePointerCapture(e.pointerId); } catch (err) { /* fine */ }
            };
            c.addEventListener('pointerup', end);
            c.addEventListener('pointercancel', end);
        }

        /**
         * Drag the whole panel somewhere else by its title bar.
         *
         * On a phone the map is in one of four corners and every corner is
         * somebody's, so it has to be movable. Where it was left is kept per
         * browser, and pulled back on screen if the window is later too small
         * for where that was.
         */
        _initDrag() {
            const panel = document.getElementById('minimapPanel');
            const head = panel && panel.querySelector('.minimap-head');
            if (!panel || !head) return;
            this.panel = panel;
            head.style.touchAction = 'none';

            let from = null;
            head.addEventListener('pointerdown', (e) => {
                // The buttons live in this bar; they are not handles.
                if (e.target.closest && e.target.closest('button')) return;
                const r = panel.getBoundingClientRect();
                from = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
                try { head.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
                head.style.cursor = 'grabbing';
            });
            head.addEventListener('pointermove', (e) => {
                if (!from) return;
                this._place(from.left + (e.clientX - from.x), from.top + (e.clientY - from.y));
            });
            const end = (e) => {
                if (!from) return;
                from = null;
                head.style.cursor = 'grab';
                try { head.releasePointerCapture(e.pointerId); } catch (err) { /* fine */ }
                this._savePlace();
            };
            head.addEventListener('pointerup', end);
            head.addEventListener('pointercancel', end);

            window.addEventListener('resize', () => this._reflow());
            this._restorePlace();
        }

        /** Put the panel at a point, never further out than its own edge. */
        _place(left, top) {
            const panel = this.panel;
            if (!panel) return;
            const r = panel.getBoundingClientRect();
            const maxX = Math.max(0, window.innerWidth - r.width);
            const maxY = Math.max(0, window.innerHeight - r.height);
            const x = Math.max(0, Math.min(maxX, left));
            const y = Math.max(0, Math.min(maxY, top));
            panel.style.left = x + 'px';
            panel.style.top = y + 'px';
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
            this.placed = { x, y };
        }

        _savePlace() {
            if (!this.placed) return;
            try { localStorage.setItem('bp_minimap_pos', JSON.stringify(this.placed)); } catch (e) { /* fine */ }
        }

        _restorePlace() {
            let saved = null;
            try { saved = JSON.parse(localStorage.getItem('bp_minimap_pos') || 'null'); } catch (e) { /* fine */ }
            if (saved && isFinite(saved.x) && isFinite(saved.y)) this._place(saved.x, saved.y);
        }

        /**
         * Grow the map to whatever width the panel actually has.
         *
         * The panel's width is set by its widest row — the title bar, with its
         * readout and four chips — not by the map. A square canvas therefore
         * sat in a 294px-wide stage leaving a ~46px dead strip down its right
         * side, inside a 312x355 panel: a portrait box containing a square map
         * and a gap. Filling the stage costs nothing and is simply more map.
         */
        _fillStage() {
            const stage = document.querySelector('.minimap-stage');
            if (!stage) return false;
            const avail = Math.round(stage.clientWidth || 0);
            if (!avail) return false;
            const w = this._fit(Math.max(MIN_SIZE, Math.min(MAX_SIZE, avail)));
            if (w <= this.vw) return false;
            this.vw = w;
            this._resizeCanvas();
            return true;
        }

        /** A smaller window must not leave the map off the side of it. */
        _reflow() {
            const saved = this._restoreSize();
            const w = this._fit(saved.w), h = this._fit(saved.h);
            let changed = false;
            if (w !== this.vw || h !== this.vh) {
                this.vw = w; this.vh = h;
                this._resizeCanvas();
                changed = true;
            }
            // Reapply afterwards: restoring the saved size would otherwise put
            // the dead strip straight back the next time the window changes.
            if (this._fillStage()) changed = true;
            if (changed) this.draw();
            if (this.placed) this._place(this.placed.x, this.placed.y);
        }

        // ---- going places -------------------------------------------------

        /** Click the map, move the camera there. */
        _click(at, armed) {
            // The click the browser sends at the end of a drag is not a tap.
            if (this._pannedAt && Date.now() - this._pannedAt < 400) return;
            const p = this._toWorld(at.cx, at.cy);
            const g = this.game;

            // Something has taken the map over — a round asking where you think
            // you are. It gets the coordinates and the map does nothing else:
            // no camera move, no travel, because during that round the map is a
            // form rather than a way of getting about.
            if (this.pickMode) {
                const ll = this._canvasToLatLon(at.cx, at.cy);
                if (ll) this.pickMode(ll.lat, ll.lon);
                return;
            }

            if (armed) {
                this.armed = false;
                const travel = document.getElementById('minimapTravel');
                if (travel) { travel.classList.remove('armed'); travel.textContent = '🌍 travel'; }
                if (!g.geo || !g.geo.anchor) { g.showToast('Pin the world to a place first', 'warning'); return; }
                const ll = this._canvasToLatLon(at.cx, at.cy);
                if (ll) g.travelTo(ll.lat, ll.lon, g.geo.anchor.mpc);
                return;
            }
            const half = g.voxels.half;
            if (Math.abs(p.x) > half || Math.abs(p.z) > half) {
                // Out there a single click is ambiguous, so say what would work
                // rather than doing something arbitrary with the camera.
                g.showToast('That is outside this world — double-click it to travel there', 'info', 3200);
                return;
            }
            if (g.fps && g.fps.active) g.fps.teleport(p.x, p.z);
            else g.voxels.focus(p.x, 2, p.z, 40, Math.PI * 0.3);
            const ll = this._canvasToLatLon(at.cx, at.cy);
            const where = ll ? ' · ' + window.BlockPartyGeo.format(ll.lat, ll.lon) : '';
            g.showToast(`Moved to ${p.x}, ${p.z}${where}`, 'info', 1800);
        }

        _dblclick(e) {
            e.preventDefault();
            this._openScope(e);
        }

        /**
         * The card that opens on a double-click: what is at this spot, and the
         * things you can do about it.
         *
         * "Travel here" is the point of it. A single click has to stay cheap —
         * it moves the camera — so moving the whole room is a deliberate second
         * action on a spot you have already chosen, with the coordinates in
         * front of you before you commit.
         */
        _openScope(e) {
            const card = document.getElementById('minimapScope');
            if (!card) return;
            const g = this.game;
            const at = this._at(e);
            const cell = this._toWorld(at.cx, at.cy);
            const ll = this._canvasToLatLon(at.cx, at.cy);
            const half = g.voxels.half;
            const inside = Math.abs(cell.x) <= half && Math.abs(cell.z) <= half;
            // The camera may go anywhere there is ground, not just anywhere you
            // can build. The plain runs well past the buildable square, so
            // refusing every spot outside it made the button dead for most of
            // the map.
            const reach = g.voxels.groundReach || half;
            const reachable = Math.abs(cell.x) <= reach && Math.abs(cell.z) <= reach;
            const flyHint = inside ? 'Look at this spot' : 'Look at this spot, out on the plain';

            this.scopeAt = ll ? { lat: ll.lat, lon: ll.lon, cell, inside } : null;

            const anchored = !!(g.geo && g.geo.anchor);
            const host = g.isHost();
            const matchOn = !!(g.modes && g.modes.isMatchActive());
            const why = !anchored ? 'Pin this world to a place first'
                : !host ? 'Only the host can move the room'
                    : matchOn ? 'Finish the match first' : '';

            const coords = ll ? window.BlockPartyGeo.format(ll.lat, ll.lon) : `${cell.x}, ${cell.z}`;
            const dist = ll && anchored ? this._distanceFromCentre(ll.lat, ll.lon) : null;
            const sub = inside
                ? `in this world · block ${cell.x}, ${cell.z}`
                : (dist ? `${dist.text} ${dist.dir} of here · another region` : 'outside this world');

            card.innerHTML = `
                <div class="mm-scope-head">
                    <span class="mm-scope-coords">${this._esc(coords)}</span>
                    <button class="mm-scope-x" data-scope="close" aria-label="Close">✕</button>
                </div>
                <div class="mm-scope-sub">${this._esc(sub)}</div>
                <div class="mm-scope-actions">
                    <button class="mm-scope-btn primary" data-scope="travel"
                        ${why ? `disabled title="${this._esc(why)}"` : ''}>✈️ Travel here</button>
                    <button class="mm-scope-btn" data-scope="camera"
                        ${reachable ? `title="${this._esc(flyHint)}"` : 'disabled title="Past the edge of the ground — travel there instead"'}>🎥 Fly camera</button>
                    <button class="mm-scope-btn" data-scope="copy" title="Copy the coordinates">📋</button>
                </div>`;

            card.classList.remove('hidden');
            // Placed inside the map, and nudged so it never hangs off an edge.
            const r = card.getBoundingClientRect();
            const w = r.width || 190, h = r.height || 92;
            const x = Math.max(6, Math.min(this.vw - w - 6, at.cx - w / 2));
            const y = at.cy + 12 + h > this.vh ? Math.max(6, at.cy - h - 12) : at.cy + 12;
            card.style.left = x + 'px';
            card.style.top = y + 'px';
            this.draw();
        }

        _closeScope() {
            const card = document.getElementById('minimapScope');
            if (card) card.classList.add('hidden');
            this.scopeAt = null;
        }

        _initScope() {
            const card = document.getElementById('minimapScope');
            if (!card) return;
            card.addEventListener('click', (e) => {
                const btn = e.target.closest && e.target.closest('[data-scope]');
                if (!btn) return;
                e.stopPropagation();
                const what = btn.getAttribute('data-scope');
                const spot = this.scopeAt;
                if (what === 'close' || !spot) { this._closeScope(); return; }
                const g = this.game;
                if (what === 'travel') {
                    this._closeScope();
                    g.travelTo(spot.lat, spot.lon, (g.geo.anchor && g.geo.anchor.mpc) || 2);
                } else if (what === 'camera') {
                    this._closeScope();
                    const reach = g.voxels.groundReach || g.voxels.half;
                    const cx = Math.max(-reach, Math.min(reach, spot.cell.x));
                    const cz = Math.max(-reach, Math.min(reach, spot.cell.z));
                    const clamped = cx !== spot.cell.x || cz !== spot.cell.z;
                    // Walking off the buildable square is fine; walking off the
                    // ground is not, so first person stays inside the world.
                    if (g.fps && g.fps.active) {
                        const h = g.voxels.half;
                        g.fps.teleport(Math.max(-h, Math.min(h, cx)), Math.max(-h, Math.min(h, cz)));
                    } else {
                        // Pull back a little for a spot out on the empty plain:
                        // there is nothing there to give the view a sense of scale.
                        const far = Math.abs(cx) > g.voxels.half || Math.abs(cz) > g.voxels.half;
                        g.voxels.focus(cx, 2, cz, far ? 90 : 40, Math.PI * 0.3);
                    }
                    if (clamped) g.showToast('Flew as far as the ground goes', 'info', 2400);
                    this.invalidate();
                } else if (what === 'copy') {
                    const text = `${spot.lat.toFixed(6)}, ${spot.lon.toFixed(6)}`;
                    const done = () => g.showToast(`Copied ${text}`, 'success', 2000);
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(text).then(done, () => this._fillGo(text));
                    } else this._fillGo(text);
                }
            });
        }

        /** No clipboard: put it somewhere it can be read and reused instead. */
        _fillGo(text) {
            const box = document.getElementById('minimapGo');
            if (box) { box.value = text; box.focus(); box.select(); }
            else this.game.showToast(text, 'info', 5000);
        }

        /**
         * Type a place and go to it.
         *
         * Inside this world that is the camera; outside it, it is the room —
         * which is the distinction people should not have to think about, so
         * the one box does both and says which it did.
         */
        _initGoBox() {
            const box = document.getElementById('minimapGo');
            const btn = document.getElementById('minimapGoBtn');
            const go = () => {
                if (!box) return;
                const place = window.BlockPartyGeo.parse(box.value);
                if (!place) {
                    this.game.showToast('Enter coordinates like "51.5074, -0.1278"', 'warning', 3200);
                    box.focus();
                    return;
                }
                if (this.goTo(place.lat, place.lon)) box.blur();
            };
            if (btn) btn.addEventListener('click', go);
            if (box) {
                box.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') { e.preventDefault(); go(); }
                    if (e.key === 'Escape') box.blur();
                    // The world listens for single keys; while typing it must not.
                    e.stopPropagation();
                });
                box.addEventListener('keyup', (e) => e.stopPropagation());
                box.addEventListener('keypress', (e) => e.stopPropagation());
            }
        }

        /**
         * Go to a real place: the camera if it is in this world, the whole room
         * if it is not — and the map either way, so you can see where you went.
         */
        goTo(lat, lon, opts) {
            const g = this.game;
            opts = opts || {};
            // A region is a tile at a particular scale, so "the world at these
            // coordinates" is only the same world at the same metres-per-block.
            // Travelling back to a saved world at whatever scale happens to be
            // current lands in a neighbouring region with nothing in it.
            const mpc = opts.mpc || (g.geo.anchor && g.geo.anchor.mpc) || 2;
            if (!g.geo || !g.geo.anchor) {
                g.showToast('Pin this world to a place first', 'warning', 3200);
                return false;
            }
            const w = g.geo.toWorld(lat, lon);
            const half = g.voxels.half;
            const inside = w && Math.abs(w.x) <= half && Math.abs(w.z) <= half;

            if (inside && !opts.travel && mpc === g.geo.anchor.mpc) {
                const x = Math.round(w.x), z = Math.round(w.z);
                if (g.fps && g.fps.active) g.fps.teleport(x, z);
                else g.voxels.focus(x, 2, z, 40, Math.PI * 0.3);
                this._lockTo({ x: w.x, z: w.z });
                this.draw();
                g.showToast(`Flew to ${window.BlockPartyGeo.format(lat, lon)}`, 'success', 2400);
                return true;
            }
            if (!g.isHost()) {
                const d = this._distanceFromCentre(lat, lon);
                g.showToast(`That is ${d ? d.text + ' ' + d.dir : 'outside this world'} — ask the host to travel there`,
                    'warning', 4200);
                // Show it anyway: being told where it is beats being told no.
                this._lockTo(w || { x: 0, z: 0 });
                this.draw();
                return false;
            }
            return !!g.travelTo(lat, lon, mpc);
        }

        /** How far a place is from the middle of the world, and which way. */
        _distanceFromCentre(lat, lon) {
            const a = this.game.geo && this.game.geo.anchor;
            if (!a) return null;
            const north = (lat - a.lat) * 110540;
            const east = (lon - a.lon) * 111320 * Math.cos(a.lat * Math.PI / 180);
            const m = Math.hypot(north, east);
            const compass = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
            const bearing = (Math.atan2(east, north) * 180 / Math.PI + 360) % 360;
            return {
                metres: m, dir: compass[Math.round(bearing / 45) % 8],
                text: m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${Math.round(m)} m`
            };
        }

        // ---- who has been where -------------------------------------------

        _initPlaces() {
            const list = document.getElementById('minimapPlaces');
            const toggle = document.getElementById('minimapPeople');
            if (toggle && list) {
                toggle.addEventListener('click', () => {
                    const shut = list.classList.toggle('hidden');
                    toggle.classList.toggle('active', !shut);
                    if (!shut) this.renderPlaces();
                    this._reflow();
                });
            }
            if (!list) return;
            list.addEventListener('click', (e) => {
                const row = e.target.closest && e.target.closest('[data-mmgo]');
                if (row) {
                    const [lat, lon] = row.getAttribute('data-mmgo').split(',').map(Number);
                    this.goTo(lat, lon, {
                        travel: row.hasAttribute('data-mmtravel'),
                        mpc: +row.getAttribute('data-mmmpc') || 0
                    });
                    return;
                }
                const head = e.target.closest && e.target.closest('[data-mmwho]');
                if (head) {
                    const who = head.getAttribute('data-mmwho');
                    if (this.expanded.has(who)) this.expanded.delete(who);
                    else this.expanded.add(who);
                    this.renderPlaces();
                }
            });
        }

        /**
         * Everyone the room knows about, and everywhere they took it.
         *
         * Three different facts share one row, and they are not the same thing:
         * where somebody is now, where they were last seen, and the places they
         * chose to go. The last of those outlives the session, which is what
         * makes a room a place people come back to rather than a session.
         */
        renderPlaces() {
            const list = document.getElementById('minimapPlaces');
            const count = document.getElementById('minimapPeople');
            const g = this.game, geo = g.geo;
            // The whole map bails out in its constructor when there is no
            // canvas, so nothing below it exists either.
            if (!this.canvas || !list || !geo) return;

            const names = new Set();
            geo.roster().forEach(r => names.add(r.name));
            geo.travellers().forEach(n => names.add(n));
            const roster = new Map(geo.roster().map(r => [r.name, r]));

            if (count) {
                count.textContent = `👥 ${names.size || 0}`;
                count.title = names.size ? `${names.size} known ${names.size === 1 ? 'place' : 'places'} and people`
                    : 'Nobody has shared a location yet';
            }
            if (list.classList.contains('hidden')) return;

            const worlds = this._placesSection();
            if (!names.size) {
                list.innerHTML = worlds
                    || '<div class="mm-empty">Nobody has shared a location, and the room has not travelled yet.</div>';
                return;
            }

            const mine = g.username;
            const sorted = Array.from(names).sort((a, b) => {
                if (a === mine) return -1;
                if (b === mine) return 1;
                const la = roster.get(a), lb = roster.get(b);
                return (lb && lb.live ? 1 : 0) - (la && la.live ? 1 : 0) || a.localeCompare(b);
            });

            list.innerHTML = sorted.map(name => {
                const r = roster.get(name);
                const visits = geo.visitsOf(name);
                const open = this.expanded.has(name) || name === mine;
                const colour = g.generateUserColor(name);
                const status = !r ? 'no position shared'
                    : r.live ? 'here now'
                        : r.private ? 'on this device only'
                            : 'last seen ' + window.BlockPartyGeo.ago(r.at);
                const where = r ? window.BlockPartyGeo.format(r.lat, r.lon) : '—';
                const arrow = visits.length ? (open ? '▾' : '▸') : '·';

                const head = `<div class="mm-who${r && r.live ? ' live' : ''}" data-mmwho="${this._esc(name)}">
                    <span class="mm-arrow">${arrow}</span>
                    <span class="mm-dot" style="background:${colour}${r && r.live ? '' : ';opacity:.45'}"></span>
                    <span class="mm-name">${this._esc(name)}${name === mine ? ' (you)' : ''}</span>
                    <span class="mm-when">${this._esc(status)}</span>
                    ${r ? `<button class="mm-go" data-mmgo="${r.lat},${r.lon}" title="${this._esc(where)}">go</button>` : ''}
                </div>`;

                if (!open || !visits.length) return head;
                const rows = visits.map(v => `
                    <div class="mm-visit">
                        <span class="mm-visit-mark">↩</span>
                        <span class="mm-visit-when">${this._esc(window.BlockPartyGeo.ago(v.at))}</span>
                        <span class="mm-visit-where">${this._esc(window.BlockPartyGeo.format(v.lat, v.lon))}</span>
                        <button class="mm-go" data-mmgo="${v.lat},${v.lon}" data-mmmpc="${v.mpc || 0}" data-mmtravel
                            title="Take the room back to this place">go</button>
                    </div>`).join('');
                return head + rows;
            }).join('') + worlds;
        }

        /**
         * The worlds this room has already built, as somewhere to go back to.
         *
         * Drawn on the map as houses; listed here because a pin the size of a
         * house on a map of Europe is not something you can reliably click.
         */
        _placesSection() {
            const g = this.game;
            const list = (g.settlements || []).slice();
            if (!list.length) return '';
            const here = g.geo && g.geo.anchor && g.geo.anchor.region;

            // Nearest first, so going back somewhere means the top of the list.
            const a = g.geo && g.geo.anchor;
            if (a) {
                list.forEach(w => { w._d = Math.hypot(w.lat - a.lat, w.lon - a.lon); });
                list.sort((p, q) => p._d - q._d);
            }

            const rows = list.slice(0, 12).map(w => {
                const span = w.span >= 1000 ? `${(w.span / 1000).toFixed(1)} km` : `${w.span} m`;
                return `<div class="mm-visit mm-world${w.region === here ? ' here' : ''}">
                    <span class="mm-visit-mark">⌂</span>
                    <span class="mm-visit-when">${w.region === here ? 'you are here' : span}</span>
                    <span class="mm-visit-where">${this._esc(window.BlockPartyGeo.format(w.lat, w.lon))}</span>
                    ${w.region === here ? ''
                        : `<button class="mm-go" data-mmgo="${w.lat},${w.lon}" data-mmmpc="${w.mpc || 0}" data-mmtravel
                             title="Take the room back to this world, at the scale it was built">go</button>`}
                </div>`;
            }).join('');

            const more = list.length > 12 ? `<div class="mm-empty">…and ${list.length - 12} more</div>` : '';
            return `<div class="mm-heading">⌂ Worlds built (${list.length})</div>${rows}${more}`;
        }

        _esc(s) {
            return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
                ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        }

        // ---- drawing -------------------------------------------------------

        /** Where the pointer is, said in coordinates rather than pixels. */
        _readout(e) {
            const el = document.getElementById('minimapCursor');
            if (!el) return;
            if (!e) { el.textContent = ''; return; }
            const at = this._at(e);
            const ll = this._canvasToLatLon(at.cx, at.cy);
            const cell = this._toWorld(at.cx, at.cy);
            el.textContent = ll ? window.BlockPartyGeo.format(ll.lat, ll.lon)
                : `${cell.x}, ${cell.z}`;
        }

        draw() {
            if (!this.ctx || !this.open) return;
            const g = this.game, v = g.voxels, ctx = this.ctx, s = this.scale;
            const W = this.vw, H = this.vh;

            this._ensureBasemap();
            this._syncChrome();

            ctx.clearRect(0, 0, W, H);
            ctx.fillStyle = MAP.seaDeep;
            ctx.fillRect(0, 0, W, H);

            // A stale coast, slid to where it now belongs, is a far better
            // answer mid-pan than the "nothing surveyed" hatch: panning used to
            // flash grey the moment the cached image slid past 45% of the view,
            // until the async repaint landed ~140ms later. The hatch is for a
            // world that genuinely has no place, not for one still catching up.
            const pinned = this.layers.map && this.baseReady && this.baseView
                && this.baseView.vw === this.vw && this.baseView.vh === this.vh;
            if (pinned) {
                const o = this._blitOffset();
                ctx.drawImage(this.base, o.dx, o.dy, W, H);
            } else {
                // No place to draw: neutral grey under a faint hatch, which is
                // how a chart says "nothing surveyed here" rather than letting
                // an unpinned world pass for ground.
                ctx.fillStyle = MAP.blank;
                ctx.fillRect(0, 0, W, H);
                ctx.save();
                ctx.strokeStyle = MAP.blankHatch;
                ctx.lineWidth = 1;
                ctx.beginPath();
                for (let d = -H; d < W + H; d += 9) { ctx.moveTo(d, 0); ctx.lineTo(d + H, H); }
                ctx.stroke();
                ctx.restore();
            }

            if (this.layers.grid) this._drawGraticule(ctx);
            if (this.layers.build) this._drawBuild(ctx, v, s);
            this._drawRegionBox(ctx, v);
            if (this.layers.worlds) this._drawSettlements(ctx);
            if (this.layers.trails) this._drawTrails(ctx);
            if (this.layers.people) this._drawPeople(ctx);
            this._drawMe(ctx);
            this._drawMarks(ctx);
            this._drawScopeMark(ctx);
            this._drawChrome(ctx);
        }

        /** Buttons and labels that describe the view rather than draw it. */
        _syncChrome() {
            const g = this.game;
            const pinBtn = document.getElementById('minimapPin');
            if (pinBtn) pinBtn.classList.toggle('hidden', !!(g.geo && g.geo.anchor) || !g.isHost());

            const label = document.getElementById('minimapZoomLabel');
            if (label) {
                label.textContent = (this.zoom === 0 && !this.locked ? 'this world · ' : '') + this._spanLabel();
            }
            const home = document.getElementById('minimapHome');
            if (home) home.classList.toggle('hidden', !this.locked);

            const centre = document.getElementById('minimapCentre');
            if (centre) {
                const ll = this._canvasToLatLon(this.vw / 2, this.vh / 2);
                centre.textContent = ll ? window.BlockPartyGeo.format(ll.lat, ll.lon) : 'not on the Earth';
                centre.classList.toggle('dim', !ll);
            }
        }

        /** How much ground the map covers, in words. */
        _spanLabel() {
            const a = this.game.geo && this.game.geo.anchor;
            if (!a) return `${Math.round(this.viewCells)} blocks`;
            const m = this.viewCells * a.mpc;
            return m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${Math.round(m)} m`;
        }

        /**
         * Latitude and longitude, ruled and labelled.
         *
         * The step is chosen so four or five lines cross the view at any zoom —
         * whole degrees over a continent, ten-thousandths over a courtyard —
         * and the labels sit on the lines they belong to, which is what turns a
         * picture of a coast into something you can take a bearing from.
         */
        _drawGraticule(ctx) {
            const geo = this.game.geo;
            if (!geo || !geo.region) return;
            const nw = this._canvasToLatLon(0, 0);
            const se = this._canvasToLatLon(this.vw, this.vh);
            if (!nw || !se) return;

            const spanLon = Math.abs(se.lon - nw.lon);
            if (!isFinite(spanLon) || spanLon <= 0) return;
            const step = STEPS.find(d => spanLon / d >= 3) || STEPS[STEPS.length - 1];
            const dp = step >= 1 ? 0 : Math.min(6, Math.ceil(-Math.log10(step)));
            // Lines are numbered off the equator and the prime meridian, so
            // "every fifth one is a major" is exact rather than a comparison of
            // two accumulated floats that never quite agree. Only three to six
            // lines cross the view at any zoom, so all of them are labelled —
            // an unlabelled graticule is a texture, not a coordinate system.
            const major = (i) => i % 5 === 0;

            ctx.save();
            ctx.font = '500 9px ui-monospace, SFMono-Regular, Menlo, monospace';
            ctx.textBaseline = 'top';

            const label = (text, x, y, big) => {
                ctx.fillStyle = MAP.shadow;
                const w = ctx.measureText(text).width;
                ctx.fillRect(x - 2, y - 1, w + 4, 11);
                ctx.fillStyle = big ? MAP.chromeDim : MAP.gridText;
                ctx.fillText(text, x, y);
            };

            // Meridians.
            const lonLo = Math.min(nw.lon, se.lon), lonHi = Math.max(nw.lon, se.lon);
            for (let i = Math.ceil(lonLo / step); i * step <= lonHi; i++) {
                const lon = i * step;
                const p = this._llToCanvas(0, lon);
                if (!p || p.cx < -1 || p.cx > this.vw + 1) continue;
                const big = major(i);
                ctx.strokeStyle = big ? MAP.gridMajor : MAP.grid;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(Math.round(p.cx) + 0.5, 0);
                ctx.lineTo(Math.round(p.cx) + 0.5, this.vh);
                ctx.stroke();
                // Not under the compass rose in the top-right corner.
                if (p.cx < this.vw - 58) label(this._degrees(lon, dp, 'EW'), p.cx + 3, 2, big);
            }

            // Parallels.
            const latLo = Math.min(nw.lat, se.lat), latHi = Math.max(nw.lat, se.lat);
            for (let i = Math.ceil(latLo / step); i * step <= latHi; i++) {
                const lat = i * step;
                if (Math.abs(lat) > 85.05) continue;
                const p = this._llToCanvas(lat, lonLo);
                if (!p || p.cy < -1 || p.cy > this.vh + 1) continue;
                const big = major(i);
                ctx.strokeStyle = big ? MAP.gridMajor : MAP.grid;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(0, Math.round(p.cy) + 0.5);
                ctx.lineTo(this.vw, Math.round(p.cy) + 0.5);
                ctx.stroke();
                // Not over the scale bar along the bottom, or the meridian
                // labels along the top.
                if (p.cy > 14 && p.cy < this.vh - 26) label(this._degrees(lat, dp, 'NS'), 3, p.cy + 3, big);
            }
            ctx.restore();
        }

        /** A graticule label: no minus signs on a map, a hemisphere letter. */
        _degrees(value, dp, axis) {
            const text = Math.abs(value).toFixed(dp);
            // The equator and the prime meridian belong to neither hemisphere.
            if (+text === 0) return '0°';
            return text + '°' + (value < 0 ? axis[1] : axis[0]);
        }

        /** What has been built, as seen from above. */
        _drawBuild(ctx, v, s) {
            const W = this.vw, H = this.vh;
            const cell = Math.max(1, Math.ceil(s));
            v.columns.forEach((col, key) => {
                const comma = key.indexOf(',');
                const x = +key.slice(0, comma), z = +key.slice(comma + 1);
                const p = this._toCanvas(x, z);
                if (p.cx < -cell || p.cy < -cell || p.cx > W || p.cy > H) return;
                // Higher blocks read lighter, so a skyline has shape.
                const shade = 0.55 + Math.min(0.45, col.top / 24);
                ctx.fillStyle = this._shade(col.hex, shade);
                ctx.fillRect(p.cx, p.cy, cell, cell);
            });
        }

        /**
         * Pulled out, this world is a rectangle of ground among others — so say
         * which rectangle it is.
         */
        _drawRegionBox(ctx, v) {
            if (this.zoom <= 0 && !this.locked) return;
            const tl = this._toCanvas(-v.half, -v.half);
            const br = this._toCanvas(v.half + 1, v.half + 1);
            // Far enough out the world is a speck, so it never shrinks below
            // something you can actually see and aim at.
            const w = Math.max(12, br.cx - tl.cx), h = Math.max(12, br.cy - tl.cy);
            const x = tl.cx - (w - (br.cx - tl.cx)) / 2, y = tl.cy - (h - (br.cy - tl.cy)) / 2;
            ctx.save();
            ctx.setLineDash([4, 3]);
            ctx.strokeStyle = MAP.shadow;   // a dark halo, so it
            ctx.lineWidth = 3.5;            // reads over pale map
            ctx.strokeRect(x, y, w, h);
            ctx.strokeStyle = '#9ec5ff';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(x, y, w, h);
            ctx.setLineDash([]);
            if (w < this.vw * 0.6 && y > 12) {
                ctx.fillStyle = '#9ec5ff';
                ctx.font = '600 9px system-ui, sans-serif';
                ctx.fillText('this world', x, y - 3);
            }
            ctx.restore();
        }

        /**
         * Every region this room has already built in.
         *
         * The room's own civilisation, dotted across the planet. Pulled far
         * enough out, forty street-scale worlds in one city land on the same
         * few pixels, so markers are bucketed to a small grid and drawn once
         * with a count — otherwise a well-travelled room smears into a blob.
         */
        _drawSettlements(ctx) {
            const g = this.game, geo = g.geo;
            const list = g.settlements;
            if (!list || !list.length || !geo || !geo.region) return;
            const here = geo.anchor && geo.anchor.region;

            // Bucket to an eight-pixel grid: one pin per bucket, with a count.
            const buckets = new Map();
            list.forEach(w => {
                const p = this._llToCanvas(w.lat, w.lon);
                if (!p || p.cx < -6 || p.cy < -6 || p.cx > this.vw + 6 || p.cy > this.vh + 6) return;
                const key = Math.round(p.cx / 8) + ',' + Math.round(p.cy / 8);
                const b = buckets.get(key);
                if (b) { b.n++; b.here = b.here || w.region === here; }
                else buckets.set(key, { cx: p.cx, cy: p.cy, n: 1, here: w.region === here });
            });

            ctx.save();
            ctx.lineJoin = 'round';
            buckets.forEach(b => {
                // A little house: it has to say "somebody built here" at six
                // pixels, which a dot does not.
                const r = b.here ? 4.5 : 3.6;
                ctx.beginPath();
                ctx.moveTo(b.cx, b.cy - r * 1.5);
                ctx.lineTo(b.cx + r, b.cy - r * 0.2);
                ctx.lineTo(b.cx + r * 0.66, b.cy - r * 0.2);
                ctx.lineTo(b.cx + r * 0.66, b.cy + r);
                ctx.lineTo(b.cx - r * 0.66, b.cy + r);
                ctx.lineTo(b.cx - r * 0.66, b.cy - r * 0.2);
                ctx.lineTo(b.cx - r, b.cy - r * 0.2);
                ctx.closePath();
                ctx.fillStyle = MAP.shadow;
                ctx.strokeStyle = MAP.shadow;
                ctx.lineWidth = 3;
                ctx.stroke();
                ctx.fillStyle = b.here ? '#fde68a' : '#fbbf24';
                ctx.fill();

                if (b.n > 1) {
                    ctx.fillStyle = MAP.shadow;
                    ctx.beginPath();
                    ctx.arc(b.cx + r + 2, b.cy - r, 5.5, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.fillStyle = '#fde68a';
                    ctx.font = '700 8px system-ui, sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText(b.n > 99 ? '99+' : String(b.n), b.cx + r + 2, b.cy - r + 3);
                    ctx.textAlign = 'left';
                }
            });
            ctx.restore();
        }

        /**
         * Everywhere the room has been, per player.
         *
         * Drawn behind the people, in their own colour, oldest faintest — a
         * route rather than a heap of pins, so you can see at a glance that a
         * room has been up and down one coast all week.
         */
        _drawTrails(ctx) {
            const geo = this.game.geo;
            if (!geo || !geo.region) return;
            const W = this.vw, H = this.vh;
            ctx.save();
            ctx.lineJoin = ctx.lineCap = 'round';
            geo.travellers().forEach(name => {
                const visits = geo.visitsOf(name);
                if (visits.length < 1) return;
                const colour = this.game.generateUserColor(name);
                const pts = visits.map(v => this._llToCanvas(v.lat, v.lon)).filter(Boolean);
                if (!pts.length) return;

                // A leg of the journey is clipped to just outside the map
                // before it is drawn. Zoomed into one street, Tokyo is several
                // thousand canvases away: drawn whole, the leg to it is a
                // diagonal scratch across everything; dropped entirely, the map
                // stops saying the room went that way. Clipped, it leaves the
                // edge in the right direction and stops.
                ctx.strokeStyle = colour;
                ctx.globalAlpha = 0.28;
                ctx.lineWidth = 1.2;
                ctx.setLineDash([3, 3]);
                ctx.beginPath();
                for (let i = 1; i < pts.length; i++) {
                    const leg = this._clipSegment(pts[i - 1], pts[i]);
                    if (!leg) continue;
                    ctx.moveTo(leg[0].cx, leg[0].cy);
                    ctx.lineTo(leg[1].cx, leg[1].cy);
                }
                ctx.stroke();
                ctx.setLineDash([]);

                pts.forEach((p, i) => {
                    if (p.cx < -8 || p.cy < -8 || p.cx > W + 8 || p.cy > H + 8) return;
                    // Newest first in the list, so the first one is the freshest.
                    ctx.globalAlpha = Math.max(0.25, 0.85 - i * 0.09);
                    ctx.fillStyle = colour;
                    ctx.beginPath();
                    ctx.moveTo(p.cx, p.cy - 3.2);
                    ctx.lineTo(p.cx + 3.2, p.cy);
                    ctx.lineTo(p.cx, p.cy + 3.2);
                    ctx.lineTo(p.cx - 3.2, p.cy);
                    ctx.closePath();
                    ctx.fill();
                });
            });
            ctx.restore();
        }

        /**
         * A line cut down to the part of it near the map — Liang–Barsky, which
         * is the short way to do it. Returns null when none of the line is.
         */
        _clipSegment(a, b) {
            const padX = this.vw * 0.2, padY = this.vh * 0.2;
            const loX = -padX, hiX = this.vw + padX, loY = -padY, hiY = this.vh + padY;
            const dx = b.cx - a.cx, dy = b.cy - a.cy;
            let t0 = 0, t1 = 1;
            const edges = [[-dx, a.cx - loX], [dx, hiX - a.cx], [-dy, a.cy - loY], [dy, hiY - a.cy]];
            for (const [p, q] of edges) {
                if (p === 0) { if (q < 0) return null; continue; }
                const r = q / p;
                if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
                else { if (r < t0) return null; if (r < t1) t1 = r; }
            }
            return [
                { cx: a.cx + t0 * dx, cy: a.cy + t0 * dy },
                { cx: a.cx + t1 * dx, cy: a.cy + t1 * dy }
            ];
        }

        /**
         * People: solid if they are there now, hollow if it is where they were.
         *
         * Anyone off the edge of the view gets an arrow on the border pointing
         * at them — being told "they are that way, 40 km" is more use than
         * being told nothing, and it is how you decide where to pan next.
         */
        /**
         * Where I am *right now*, in world cells, with the way I am facing.
         *
         * Not where my phone says my body is. The map used to draw the local
         * player from `geo.roster()`, which is a device GPS fix: opt-in,
         * blurred to a 5m grid and shared at most once every 5s (geo.js
         * SHARE_PRECISION / SHARE_THROTTLE_MS). So the dot wearing your colour
         * sat wherever your real body was, drifted with GPS noise, and did not
         * move when you walked — which is exactly the "my marker is in the
         * wrong place" complaint. The in-world position is right here on the
         * game object and is exact.
         */
        _mePos() {
            const g = this.game;
            const fps = g.fps;
            if (fps && fps.active) {
                // First person walks along -(sin yaw, cos yaw) in xz.
                return {
                    x: fps.pos.x, z: fps.pos.z,
                    heading: Math.atan2(-Math.cos(fps.yaw), -Math.sin(fps.yaw))
                };
            }
            const v = g.voxels;
            if (!v || !v.target || !v.cam) return null;
            // The orbit camera looks from its angle in towards the target.
            return {
                x: v.target.x, z: v.target.z,
                heading: Math.atan2(-Math.sin(v.cam.theta), -Math.cos(v.cam.theta))
            };
        }

        /**
         * The wedge showing which way you are looking.
         *
         * A minimap exists to answer "where am I and which way am I facing";
         * the second half was missing.
         */
        _drawHeading(ctx, cx, cy, heading, colour) {
            if (!isFinite(heading)) return;
            const reach = 26, spread = 0.52;          // ~60 degrees
            const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, reach);
            grad.addColorStop(0, 'rgba(255,255,255,0.34)');
            grad.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, reach, heading - spread, heading + spread);
            ctx.closePath();
            ctx.fillStyle = grad;
            ctx.fill();
            ctx.strokeStyle = colour;
            ctx.globalAlpha = 0.5;
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.restore();
        }

        _drawPeople(ctx) {
            const g = this.game, geo = g.geo;
            if (!geo || !geo.anchor) return;
            const edge = 10;

            geo.roster().forEach(entry => {
                // Mine is not drawn here: a GPS record says where somebody's
                // body is, which is the wrong answer for my own avatar, and
                // this whole method is skipped in an unpinned world. _drawMe
                // owns the local player.
                if (entry.name === g.username) return;
                const me = false;
                const colour = g.generateUserColor(entry.name);

                if (!isFinite(entry.lat) || !isFinite(entry.lon)) return;
                const at = this._llToCanvas(entry.lat, entry.lon);
                if (!at) return;

                if (at.cx < edge || at.cy < edge || at.cx > this.vw - edge || at.cy > this.vh - edge) {
                    this._drawOffscreen(ctx, at, colour, entry, me);
                    return;
                }

                ctx.save();
                if (entry.live) {
                    // A halo, so a live person is findable over a busy build.
                    ctx.globalAlpha = 0.22;
                    ctx.fillStyle = colour;
                    ctx.beginPath();
                    ctx.arc(at.cx, at.cy, 9, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.globalAlpha = 1;
                    ctx.fillStyle = colour;
                    ctx.beginPath();
                    ctx.arc(at.cx, at.cy, 4.5, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
                    ctx.lineWidth = 1.2;
                    ctx.stroke();
                } else {
                    ctx.strokeStyle = colour;
                    ctx.setLineDash([2, 2]);
                    ctx.lineWidth = 1.4;
                    ctx.beginPath();
                    ctx.arc(at.cx, at.cy, 3.5, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.setLineDash([]);
                }
                ctx.restore();
            });
        }

        /** An arrow on the border, pointing at somebody past it. */
        _drawOffscreen(ctx, at, colour, entry, me) {
            const pad = 9;
            const cx = this.vw / 2, cy = this.vh / 2;
            const dx = at.cx - cx, dy = at.cy - cy;
            // Where the line out to them crosses the border box.
            const k = Math.min((cx - pad) / Math.abs(dx || 1e-6), (cy - pad) / Math.abs(dy || 1e-6));
            const px = cx + dx * k, py = cy + dy * k;
            const a = Math.atan2(dy, dx);

            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(a);
            ctx.globalAlpha = entry.live ? 0.95 : 0.5;
            ctx.fillStyle = colour;
            ctx.beginPath();
            ctx.moveTo(6, 0);
            ctx.lineTo(-4, 4);
            ctx.lineTo(-4, -4);
            ctx.closePath();
            ctx.fill();
            if (me) {
                ctx.strokeStyle = 'rgba(255,255,255,0.8)';
                ctx.lineWidth = 1;
                ctx.stroke();
            }
            ctx.restore();
        }

        /** The area the camera is looking at, and which way it faces. */
        /**
         * The one and only "you are here".
         *
         * There used to be two glyphs fighting over this: an anonymous white
         * ring at the camera target drawn here, and a coloured, ringed dot in
         * _drawPeople placed from the device's GPS fix. The colour and the ring
         * — the cues that read as "me" — were on the one in the wrong place.
         * Now there is a single marker, in your own colour, at your real
         * in-world position, showing which way you face.
         */
        _drawMe(ctx) {
            const p = this._mePos();
            if (!p) return;
            const g = this.game;
            const at = this._toCanvas(p.x, p.z);
            const colour = (g.generateUserColor && g.generateUserColor(g.username)) || '#ffffff';

            this._drawHeading(ctx, at.cx, at.cy, p.heading, colour);

            ctx.save();
            ctx.fillStyle = colour;
            ctx.beginPath();
            ctx.arc(at.cx, at.cy, 4.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.95)';
            ctx.lineWidth = 1.4;
            ctx.stroke();
            ctx.strokeStyle = 'rgba(255,255,255,0.5)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(at.cx, at.cy, 8.5, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        /**
         * Extra pins somebody else owns — a round's guesses, and the answer.
         *
         * Set with `setMarks`; the map neither knows nor cares what they mean,
         * which is what keeps the mode's rules out of the map's code.
         */
        _drawMarks(ctx) {
            const marks = this.marks;
            if (!marks || !marks.length) return;
            const S = this.size;
            ctx.save();
            marks.forEach(mk => {
                const p = this._llToCanvas(mk.lat, mk.lon);
                if (!p || p.cx < -20 || p.cy < -20 || p.cx > S + 20 || p.cy > S + 20) return;
                const r = mk.big ? 7 : 5;
                ctx.beginPath();
                ctx.arc(p.cx, p.cy, r + 2, 0, Math.PI * 2);
                ctx.fillStyle = MAP.shadow;
                ctx.fill();
                ctx.beginPath();
                ctx.arc(p.cx, p.cy, r, 0, Math.PI * 2);
                ctx.fillStyle = mk.colour || '#fbbf24';
                ctx.fill();
                if (mk.big) {
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }
                if (mk.label) {
                    ctx.font = '700 10px system-ui, sans-serif';
                    const w = ctx.measureText(mk.label).width;
                    ctx.fillStyle = MAP.shadow;
                    ctx.fillRect(p.cx + r + 3, p.cy - 7, w + 6, 14);
                    ctx.fillStyle = '#ffffff';
                    ctx.fillText(mk.label, p.cx + r + 6, p.cy + 3);
                }
            });
            ctx.restore();
        }

        /** Hand the map a set of pins to draw, or null to clear them. */
        setMarks(marks) {
            this.marks = marks || null;
            this.draw();
        }

        /** A crosshair on the spot the open card is about. */
        _drawScopeMark(ctx) {
            const spot = this.scopeAt;
            if (!spot) return;
            const p = this._llToCanvas(spot.lat, spot.lon);
            if (!p) return;
            ctx.save();
            ctx.strokeStyle = '#fde68a';
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.arc(p.cx, p.cy, 7, 0, Math.PI * 2);
            ctx.moveTo(p.cx - 11, p.cy); ctx.lineTo(p.cx - 3, p.cy);
            ctx.moveTo(p.cx + 3, p.cy); ctx.lineTo(p.cx + 11, p.cy);
            ctx.moveTo(p.cx, p.cy - 11); ctx.lineTo(p.cx, p.cy - 3);
            ctx.moveTo(p.cx, p.cy + 3); ctx.lineTo(p.cx, p.cy + 11);
            ctx.stroke();
            ctx.restore();
        }

        /** Border, north, scale bar, and whatever the map needs to say. */
        _drawChrome(ctx) {
            const g = this.game, W = this.vw, H = this.vh;
            ctx.save();
            ctx.strokeStyle = 'rgba(255,255,255,0.22)';
            ctx.lineWidth = 1;
            ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

            // North: an arrow rather than a letter, at the top right where it
            // is out of the way of the graticule labels.
            const nx = W - 16, ny = 14;
            ctx.fillStyle = MAP.shadow;
            ctx.beginPath();
            ctx.arc(nx, ny, 11, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = MAP.chrome;
            ctx.beginPath();
            ctx.moveTo(nx, ny - 8);
            ctx.lineTo(nx + 4, ny + 3);
            ctx.lineTo(nx, ny + 0.5);
            ctx.lineTo(nx - 4, ny + 3);
            ctx.closePath();
            ctx.fill();
            ctx.font = '700 8px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('N', nx, ny + 10);
            ctx.textAlign = 'left';

            // Scale bar: a round number of metres, not a round number of pixels.
            const anchor = g.geo && g.geo.anchor;
            const bar = this._scaleBar(anchor);
            const y = H - 12;
            ctx.fillStyle = MAP.shadow;
            ctx.fillRect(6, y - 13, bar.px + 12, 20);
            ctx.strokeStyle = MAP.chrome;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(10, y); ctx.lineTo(10 + bar.px, y);
            ctx.moveTo(10, y - 4); ctx.lineTo(10, y + 3);
            ctx.moveTo(10 + bar.px, y - 4); ctx.lineTo(10 + bar.px, y + 3);
            ctx.stroke();
            ctx.fillStyle = MAP.chrome;
            ctx.font = '600 9px system-ui, sans-serif';
            ctx.fillText(bar.text, 10, y - 5);

            // A map of nowhere is just a grid — say what would fix that.
            if (!anchor) {
                const msg = g.isHost() ? 'not pinned — 📍 pin for the real map'
                    : 'the host has not pinned this world yet';
                ctx.font = '600 9px system-ui, sans-serif';
                const w = ctx.measureText(msg).width;
                ctx.fillStyle = MAP.shadow;
                ctx.fillRect(0, 0, w + 12, 15);
                ctx.fillStyle = 'rgba(255,255,255,0.8)';
                ctx.fillText(msg, 6, 11);
            } else if (this.layers.map && !this.baseReady) {
                ctx.fillStyle = MAP.chromeDim;
                ctx.font = '500 9px system-ui, sans-serif';
                ctx.fillText('drawing the coast…', 8, 12);
            }
            ctx.restore();
        }

        /**
         * A scale bar of a round distance. A quarter of the view is the target
         * width; the nearest 1/2/5 above or below it is what gets drawn, so the
         * bar always says something like "500 m" rather than "483 m".
         */
        _scaleBar(anchor) {
            const quarter = this.viewCells / 4;
            if (!anchor) return { px: quarter * this.scale, text: `${Math.round(quarter)} blocks` };
            const metres = quarter * anchor.mpc;
            const pow = Math.pow(10, Math.floor(Math.log10(metres)));
            const nice = [1, 2, 5, 10].map(k => k * pow).reduce((best, v) =>
                Math.abs(v - metres) < Math.abs(best - metres) ? v : best, pow);
            return {
                px: (nice / anchor.mpc) * this.scale,
                text: nice >= 1000 ? `${+(nice / 1000).toFixed(1)} km` : `${Math.round(nice)} m`
            };
        }

        /** Multiply a hex colour, for the height shading. */
        _shade(hex, k) {
            const n = parseInt((hex || '#888888').slice(1), 16);
            const r = Math.min(255, Math.round(((n >> 16) & 255) * k));
            const g = Math.min(255, Math.round(((n >> 8) & 255) * k));
            const b = Math.min(255, Math.round((n & 255) * k));
            return `rgb(${r},${g},${b})`;
        }
    }

    Minimap.PALETTE = MAP;
    window.BlockPartyMinimap = Minimap;
})();
