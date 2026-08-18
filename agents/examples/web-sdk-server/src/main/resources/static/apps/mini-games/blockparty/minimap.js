/**
 * BlockParty — minimap
 *
 * A world 161 blocks across is bigger than one screen, and once it is pinned to
 * real coordinates it is a map of somewhere. This draws it from above: what has
 * been built, where everybody is, where everybody *was*, and where the camera
 * is looking. Click it to go there.
 *
 * It reads a column index the world keeps up to date — the top block of every
 * (x, z) — rather than walking tens of thousands of cells on every redraw.
 */
(function () {
    'use strict';

    const SIZE = 232;          // canvas edge, in CSS pixels
    const REDRAW_MS = 400;     // the world does not change fast enough to need more

    // The projection lives in geo.js, because the world's regions are defined
    // by it — the map and the world must agree on where things are.
    const M = () => window.BlockPartyGeo.MERCATOR;

    class Minimap {
        constructor(game) {
            this.game = game;
            this.canvas = document.getElementById('minimap');
            this.open = false;
            if (!this.canvas) return;

            this.ctx = this.canvas.getContext('2d');
            const dpr = Math.min(2, window.devicePixelRatio || 1);
            this.canvas.width = SIZE * dpr;
            this.canvas.height = SIZE * dpr;
            this.ctx.scale(dpr, dpr);

            // The basemap is drawn once per anchor into its own canvas and
            // then blitted, so a redraw four times a second costs nothing.
            this.base = document.createElement('canvas');
            this.base.width = this.canvas.width;
            this.base.height = this.canvas.height;
            this.baseReady = false;
            this.baseKey = null;
            this.showMap = true;
            // How far out the map is pulled, in doublings of the world's own
            // width: 0 shows this world exactly, 4 shows sixteen worlds of
            // ground around it, -2 shows a quarter of it close up.
            this.zoom = 0;
            // Where the map is looking, as an offset from wherever it would
            // centre itself. Dragging the map moves this; the ⌖ puts it back.
            this.pan = { x: 0, z: 0 };

            this.canvas.addEventListener('click', (e) => this._click(e));
            this._initPan();
            this._initDrag();
            const travel = document.getElementById('minimapTravel');
            if (travel) {
                travel.addEventListener('click', () => {
                    // Arm the next click to move the whole room, rather than
                    // just the camera. It disarms itself either way.
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
            this.canvas.addEventListener('wheel', (e) => {
                e.preventDefault();
                this.setZoom(this.zoom + (e.deltaY > 0 ? 1 : -1));
            }, { passive: false });

            const toggle = document.getElementById('mapBtn');
            if (toggle) toggle.addEventListener('click', () => this.toggle());
        }

        toggle() { this.setOpen(!this.open); }

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
            if (!this.showMap || !geo || !geo.anchor || !window.BlockPartyEarth) {
                this.baseReady = false;
                return;
            }

            const a = geo.anchor;
            const key = `${a.region},${this.zoom},${this.game.voxels.half}`;
            if (key === this.baseKey) return;         // already drawn for this view
            this.baseKey = key;
            this.baseReady = false;

            BlockPartyEarth.load().then(earth => {
                // The map may have moved on while the coastlines were loading.
                if (this.baseKey !== key) return;
                this._paintBase(earth);
                this.baseReady = true;
                this.draw();
            }).catch(() => { this.baseReady = false; });
        }

        /**
         * The coastlines of what is on screen. Past zoom 0 that is more ground
         * than this world covers, so the region is scaled down inside the
         * canvas rather than the projection being changed: same maths, same
         * place, just further away.
         */
        _paintBase(earth) {
            const geo = this.game.geo;
            const dpr = this.base.width / SIZE;
            const ctx = this.base.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            const P = BlockPartyEarth.PAINT;
            ctx.fillStyle = P.sea;
            ctx.fillRect(0, 0, SIZE, SIZE);

            // How big this region is on the map: the whole canvas at zoom 0,
            // half of it one step out, and so on.
            const span = SIZE / Math.pow(2, this.zoom);
            const origin = this._toCanvas(-this.game.voxels.half, -this.game.voxels.half);

            // The path is built in canvas coordinates, so the region can be a
            // hundred-thousandth of the screen and the world around it still
            // draws.
            const path = BlockPartyEarth.ringPath(earth, geo.region, span,
                { w: SIZE, h: SIZE, ox: origin.cx, oy: origin.cy });
            ctx.fillStyle = P.land;
            ctx.fill(path, 'evenodd');
            ctx.strokeStyle = P.coast;
            ctx.lineWidth = Math.max(0.6, Math.min(1.4, span / 300));
            ctx.stroke(path);
        }

        /** Real coordinates straight to minimap pixels. */
        _latLonToCanvas(lat, lon) {
            const w = this.game.geo.toWorld(lat, lon);
            return this._toCanvas(w.x, w.z);
        }

        setOpen(on) {
            this.open = !!on;
            const panel = document.getElementById('minimapPanel');
            if (panel) panel.classList.toggle('hidden', !this.open);
            const btn = document.getElementById('mapBtn');
            if (btn) btn.classList.toggle('active', this.open);
            clearInterval(this._timer);
            if (this.open) {
                this.draw();
                this._timer = setInterval(() => this.draw(), REDRAW_MS);
            }
        }

        /** How many cells of ground the map is showing across. */
        get viewCells() { return (this.game.voxels.half * 2 + 1) * Math.pow(2, this.zoom); }

        /** Screen pixels per world cell. */
        get scale() { return SIZE / this.viewCells; }

        /**
         * What the map is centred on. Pulled out, it is the world itself;
         * pushed in past the world's edges, it follows the camera, because at
         * that magnification the centre of the world is rarely where you are.
         */
        _centre() {
            const base = this.zoom >= 0
                ? { x: 0, z: 0 }
                : { x: this.game.voxels.target.x, z: this.game.voxels.target.z };
            return { x: base.x + this.pan.x, z: base.z + this.pan.z };
        }

        /**
         * Drag the map itself to look somewhere else.
         *
         * A tap still means "go there", so the two have to be told apart: past
         * a few pixels of movement it is a drag, and the click the browser
         * sends afterwards is swallowed. Pointer events cover mouse, pen and
         * finger at once, which is the only reason this is not three handlers.
         */
        _initPan() {
            const c = this.canvas;
            let from = null;
            c.style.touchAction = 'none';       // the finger pans the map, not the page

            c.addEventListener('pointerdown', (e) => {
                if (e.button !== undefined && e.button !== 0) return;
                from = { x: e.clientX, y: e.clientY, pan: { x: this.pan.x, z: this.pan.z }, moved: false };
                try { c.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
            });
            c.addEventListener('pointermove', (e) => {
                if (!from) return;
                const rect = c.getBoundingClientRect();
                // The canvas may be displayed smaller than it is drawn.
                const k = rect.width ? SIZE / rect.width : 1;
                const dx = (e.clientX - from.x) * k, dy = (e.clientY - from.y) * k;
                if (!from.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
                from.moved = true;
                const s = this.scale;
                this.pan = { x: from.pan.x - dx / s, z: from.pan.z - dy / s };
                this.draw();
            });
            const end = (e) => {
                if (!from) return;
                if (from.moved) this._pannedAt = Date.now();
                from = null;
                try { c.releasePointerCapture(e.pointerId); } catch (err) { /* fine */ }
            };
            c.addEventListener('pointerup', end);
            c.addEventListener('pointercancel', end);
        }

        /** Put the map back over whatever it centres itself on. */
        recentre() {
            this.pan = { x: 0, z: 0 };
            this.draw();
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
                // The travel and pin buttons live in this bar; they are not handles.
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

        /** A smaller window must not leave the map off the side of it. */
        _reflow() {
            if (this.placed) this._place(this.placed.x, this.placed.y);
        }

        _toCanvas(x, z) {
            const c = this._centre(), s = this.scale;
            return { cx: SIZE / 2 + (x - c.x) * s, cy: SIZE / 2 + (z - c.z) * s };
        }

        _toWorld(cx, cy) {
            const c = this._centre(), s = this.scale;
            return { x: Math.round(c.x + (cx - SIZE / 2) / s), z: Math.round(c.z + (cy - SIZE / 2) / s) };
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

        /** Pull the map out or push it in, within what the projection can hold. */
        setZoom(z) {
            const next = Math.max(-3, Math.min(this.maxZoom(), z));
            if (next === this.zoom) return;
            this.zoom = next;
            this.draw();
        }

        /** How much ground the map covers, in words. */
        _spanLabel() {
            const a = this.game.geo && this.game.geo.anchor;
            if (!a) return `${Math.round(this.viewCells)} blocks`;
            const m = this.viewCells * a.mpc;
            return m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${Math.round(m)} m`;
        }

        /** Click the map, go to that spot. */
        _click(e) {
            // The click the browser sends at the end of a drag is not a tap.
            if (this._pannedAt && Date.now() - this._pannedAt < 400) return;
            // On a phone the canvas is displayed smaller than it is drawn, so
            // a tap has to be scaled back into the map's own pixels.
            const rect = this.canvas.getBoundingClientRect();
            const k = rect.width ? SIZE / rect.width : 1;
            const p = this._toWorld((e.clientX - rect.left) * k, (e.clientY - rect.top) * k);
            const g = this.game;

            if (this.armed) {
                this.armed = false;
                const travel = document.getElementById('minimapTravel');
                if (travel) { travel.classList.remove('armed'); travel.textContent = '🌍 travel'; }
                if (!g.geo || !g.geo.anchor) { g.showToast('Pin the world to a place first', 'warning'); return; }
                const ll = g.geo.toLatLon(p.x, p.z);
                g.travelTo(ll.lat, ll.lon, g.geo.anchor.mpc);
                return;
            }
            const half = g.voxels.half;
            if (Math.abs(p.x) > half || Math.abs(p.z) > half) {
                g.showToast('That is outside this world — use 🌍 travel to move the room there', 'info', 3200);
                return;
            }
            if (g.fps && g.fps.active) g.fps.teleport(p.x, p.z);
            else g.voxels.focus(p.x, 2, p.z, 40, Math.PI * 0.3);
            const where = g.geo && g.geo.anchor
                ? ' · ' + window.BlockPartyGeo.format(...Object.values(g.geo.toLatLon(p.x, p.z))) : '';
            g.showToast(`Moved to ${p.x}, ${p.z}${where}`, 'info', 1800);
        }

        draw() {
            if (!this.ctx || !this.open) return;
            const g = this.game, v = g.voxels, ctx = this.ctx, s = this.scale;

            this._ensureBasemap();

            const pinBtn = document.getElementById('minimapPin');
            if (pinBtn) {
                pinBtn.classList.toggle('hidden',
                    !!(g.geo && g.geo.anchor) || !g.isHost());
            }

            const panned = this.pan.x || this.pan.z;
            const label = document.getElementById('minimapZoomLabel');
            if (label) {
                label.textContent = (this.zoom === 0 && !panned ? 'this world · ' : '') + this._spanLabel();
            }
            const home = document.getElementById('minimapHome');
            if (home) home.classList.toggle('hidden', !panned);

            ctx.clearRect(0, 0, SIZE, SIZE);
            ctx.fillStyle = v.groundTint || '#2f3853';
            ctx.fillRect(0, 0, SIZE, SIZE);

            // The real place underneath, dimmed so the build reads on top of it.
            const mapped = this.showMap && this.baseKey && this.baseReady;
            if (mapped) {
                ctx.save();
                ctx.drawImage(this.base, 0, 0, SIZE, SIZE);
                ctx.restore();
            }

            // What has been built, as seen from above.
            const cell = Math.max(1, Math.ceil(s));
            v.columns.forEach((col, key) => {
                const comma = key.indexOf(',');
                const x = +key.slice(0, comma), z = +key.slice(comma + 1);
                const p = this._toCanvas(x, z);
                // Higher blocks read lighter, so a skyline has shape.
                const shade = 0.55 + Math.min(0.45, col.top / 24);
                // Over a real map the build is drawn slightly transparent, so
                // you can see which street it is standing on.
                // The build is what people came for; the coast underneath is
                // only there to say where it is.
                ctx.globalAlpha = 1;
                ctx.fillStyle = this._shade(col.hex, shade);
                ctx.fillRect(p.cx, p.cy, cell, cell);
                ctx.globalAlpha = 1;
            });

            // The area the camera is looking at.
            const t = v.target;
            const c = this._toCanvas(t.x, t.z);
            ctx.strokeStyle = 'rgba(255,255,255,0.9)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(c.cx, c.cy, 5, 0, Math.PI * 2);
            ctx.stroke();
            // …and which way it faces.
            const theta = v.cam.theta;
            ctx.beginPath();
            ctx.moveTo(c.cx, c.cy);
            ctx.lineTo(c.cx - Math.cos(theta) * 13, c.cy - Math.sin(theta) * 13);
            ctx.stroke();

            // People: solid if they are there now, hollow if it is where they were.
            if (g.geo) {
                g.geo.roster().forEach(entry => {
                    const p = entry.pos;
                    if (!p || p.outside) return;
                    const at = this._toCanvas(p.x, p.z);
                    const colour = g.generateUserColor(entry.name);
                    ctx.beginPath();
                    ctx.arc(at.cx, at.cy, entry.live ? 4.5 : 3.5, 0, Math.PI * 2);
                    if (entry.live) {
                        ctx.fillStyle = colour;
                        ctx.fill();
                        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
                        ctx.lineWidth = 1.2;
                        ctx.stroke();
                    } else {
                        ctx.strokeStyle = colour;
                        ctx.setLineDash([2, 2]);
                        ctx.lineWidth = 1.4;
                        ctx.stroke();
                        ctx.setLineDash([]);
                    }
                });
            }

            // Where the walking player is, if there is one.
            if (g.fps && g.fps.active) {
                const f = this._toCanvas(g.fps.pos.x, g.fps.pos.z);
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(f.cx, f.cy, 3, 0, Math.PI * 2);
                ctx.fill();
            }

            // Pulled out, this world is a rectangle of ground among others —
            // so say which rectangle it is.
            if (this.zoom > 0) {
                const tl = this._toCanvas(-v.half, -v.half);
                const br = this._toCanvas(v.half + 1, v.half + 1);
                // Far enough out the world is a speck, so it never shrinks
                // below something you can actually see and aim at.
                let w = Math.max(12, br.cx - tl.cx), h = Math.max(12, br.cy - tl.cy);
                let x = tl.cx - (w - (br.cx - tl.cx)) / 2, y = tl.cy - (h - (br.cy - tl.cy)) / 2;
                ctx.setLineDash([4, 3]);
                ctx.strokeStyle = 'rgba(8,12,24,0.75)';   // a dark halo, so it
                ctx.lineWidth = 3.5;                       // reads over pale map
                ctx.strokeRect(x, y, w, h);
                ctx.strokeStyle = '#9ec5ff';
                ctx.lineWidth = 1.5;
                ctx.strokeRect(x, y, w, h);
                ctx.setLineDash([]);
                if (this.zoom >= 3) {
                    ctx.fillStyle = '#9ec5ff';
                    ctx.font = '600 9px system-ui, sans-serif';
                    ctx.fillText('this world', x, y - 3);
                }
            }

            // Border, north, and a scale bar in real metres when it means something.
            ctx.strokeStyle = 'rgba(255,255,255,0.25)';
            ctx.lineWidth = 1;
            ctx.strokeRect(0.5, 0.5, SIZE - 1, SIZE - 1);
            ctx.fillStyle = 'rgba(255,255,255,0.75)';
            ctx.font = '600 10px system-ui, sans-serif';
            ctx.fillText('N', SIZE / 2 - 3, 11);

            const anchor = g.geo && g.geo.anchor;
            const barCells = Math.round(this.viewCells / 4);
            const barPx = barCells * s;
            ctx.strokeStyle = 'rgba(255,255,255,0.7)';
            ctx.beginPath();
            ctx.moveTo(8, SIZE - 10); ctx.lineTo(8 + barPx, SIZE - 10);
            ctx.moveTo(8, SIZE - 13); ctx.lineTo(8, SIZE - 7);
            ctx.moveTo(8 + barPx, SIZE - 13); ctx.lineTo(8 + barPx, SIZE - 7);
            ctx.stroke();
            const barM = barCells * (anchor ? anchor.mpc : 0);
            ctx.fillText(!anchor ? `${barCells} blocks`
                : barM >= 1000 ? `${(barM / 1000).toFixed(barM >= 10000 ? 0 : 1)} km`
                : `${Math.round(barM)} m`, 8, SIZE - 15);

            // A map of nowhere is just a grid — say what would fix that, along
            // the bottom edge where it covers nothing worth seeing.
            if (this.showMap && !anchor) {
                ctx.font = '600 9px system-ui, sans-serif';
                const msg = this.game.isHost()
                    ? 'not pinned — 📍 pin for the real map'
                    : 'the host has not pinned this world yet';
                const w = ctx.measureText(msg).width;
                // Top-left: the scale bar owns the bottom, the compass the top
                // centre, and the middle is the map itself.
                ctx.fillStyle = 'rgba(11,16,32,0.78)';
                ctx.fillRect(0, 0, w + 12, 15);
                ctx.fillStyle = 'rgba(255,255,255,0.8)';
                ctx.fillText(msg, 6, 11);
            } else if (this.showMap && anchor && !this.baseReady) {
                ctx.fillStyle = 'rgba(255,255,255,0.6)';
                ctx.font = '500 9px system-ui, sans-serif';
                ctx.fillText('drawing the coast…', 8, 12);
            }

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

    window.BlockPartyMinimap = Minimap;
})();
