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

            this.canvas.addEventListener('click', (e) => this._click(e));
            const toggle = document.getElementById('mapBtn');
            if (toggle) toggle.addEventListener('click', () => this.toggle());
        }

        toggle() { this.setOpen(!this.open); }

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

        /** Screen pixels per world cell. */
        get scale() { return SIZE / (this.game.voxels.half * 2 + 1); }

        _toCanvas(x, z) {
            const half = this.game.voxels.half;
            return { cx: (x + half) * this.scale, cy: (z + half) * this.scale };
        }

        _toWorld(cx, cy) {
            const half = this.game.voxels.half;
            return { x: Math.round(cx / this.scale - half), z: Math.round(cy / this.scale - half) };
        }

        /** Click the map, go to that spot. */
        _click(e) {
            const rect = this.canvas.getBoundingClientRect();
            const p = this._toWorld(e.clientX - rect.left, e.clientY - rect.top);
            const g = this.game;
            if (g.fps && g.fps.active) g.fps.teleport(p.x, p.z);
            else g.voxels.focus(p.x, 2, p.z, 40, Math.PI * 0.3);
            const where = g.geo && g.geo.anchor
                ? ' · ' + window.BlockPartyGeo.format(...Object.values(g.geo.toLatLon(p.x, p.z))) : '';
            g.showToast(`Moved to ${p.x}, ${p.z}${where}`, 'info', 1800);
        }

        draw() {
            if (!this.ctx || !this.open) return;
            const g = this.game, v = g.voxels, ctx = this.ctx, s = this.scale;

            ctx.clearRect(0, 0, SIZE, SIZE);
            ctx.fillStyle = v.groundTint || '#2f3853';
            ctx.fillRect(0, 0, SIZE, SIZE);

            // What has been built, as seen from above.
            const cell = Math.max(1, Math.ceil(s));
            v.columns.forEach((col, key) => {
                const comma = key.indexOf(',');
                const x = +key.slice(0, comma), z = +key.slice(comma + 1);
                const p = this._toCanvas(x, z);
                // Higher blocks read lighter, so a skyline has shape.
                const shade = 0.55 + Math.min(0.45, col.top / 24);
                ctx.globalAlpha = 1;
                ctx.fillStyle = this._shade(col.hex, shade);
                ctx.fillRect(p.cx, p.cy, cell, cell);
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

            // Border, north, and a scale bar in real metres when it means something.
            ctx.strokeStyle = 'rgba(255,255,255,0.25)';
            ctx.lineWidth = 1;
            ctx.strokeRect(0.5, 0.5, SIZE - 1, SIZE - 1);
            ctx.fillStyle = 'rgba(255,255,255,0.75)';
            ctx.font = '600 10px system-ui, sans-serif';
            ctx.fillText('N', SIZE / 2 - 3, 11);

            const anchor = g.geo && g.geo.anchor;
            const barCells = Math.round((v.half * 2 + 1) / 4);
            const barPx = barCells * s;
            ctx.strokeStyle = 'rgba(255,255,255,0.7)';
            ctx.beginPath();
            ctx.moveTo(8, SIZE - 10); ctx.lineTo(8 + barPx, SIZE - 10);
            ctx.moveTo(8, SIZE - 13); ctx.lineTo(8, SIZE - 7);
            ctx.moveTo(8 + barPx, SIZE - 13); ctx.lineTo(8 + barPx, SIZE - 7);
            ctx.stroke();
            ctx.fillText(anchor ? `${Math.round(barCells * anchor.mpc)} m` : `${barCells} blocks`, 8, SIZE - 15);
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
