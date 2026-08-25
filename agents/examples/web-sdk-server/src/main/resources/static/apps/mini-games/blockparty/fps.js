/**
 * BlockParty — first-person mode
 *
 * The orbit camera is right for laying out a build you are looking at; it is
 * wrong for being *inside* one. This puts a person in the world: walk with
 * WASD, look with the mouse, jump, and build what is under the crosshair.
 *
 * It borrows the game's existing rules rather than inventing new ones — the
 * same placeAt/removeAt, so match plots, the world lock, bricks, mirror and
 * undo all behave exactly as they do from above. Only the camera and the aim
 * are different.
 *
 * Collision is swept per axis against the voxel grid, which is what stops a
 * player walking into a wall corner and squeezing through it. Gravity is
 * constant; there is no air control penalty, because this is a builder and
 * fighting the controls while placing a brick is not fun.
 */
(function () {
    'use strict';

    const EYE = 1.62;            // eye height above the feet, in blocks
    const RADIUS = 0.3;          // how wide the player is
    const HEIGHT = 1.8;          // how tall
    const SPEED = 5.2;           // blocks per second, walking
    const SPRINT = 8.5;
    const HOVERBOARD_SPEED = 12.5;
    const BIKE_SPEED = 11;
    const BIKE_SPRINT = 15.5;
    const GRAVITY = 22;
    const JUMP = 7.6;
    const REACH = 6;             // how far you can place or break
    // A whole block, plus a hair. Everything in this world is built in
    // one-block steps — staircases, kerbs, the rising floor of a tunnel — so a
    // step height below 1 makes most of it impassable on foot.
    const STEP = 1.05;
    const MAX_DT = 0.05;         // never integrate more than this in one frame
    const BROADCAST_MS = 110;    // how often the room hears where I am

    class FirstPerson {
        constructor(game) {
            this.game = game;
            this.active = false;
            this.pos = new THREE.Vector3(0, 0, 0);      // feet
            this.vel = new THREE.Vector3();
            this.yaw = 0;
            this.pitch = 0;
            this.onGround = false;
            this.keys = new Set();
            this._last = 0;
            this._bound = false;
            this.vehicle = 'foot';
        }

        // ---------------------------------------------------------- lifecycle

        toggle() { this.active ? this.exit() : this.enter(); }

        /** Cycle the first two vehicles without a menu: it is useful on touch
         * screens and keeps riding available before entering first person. */
        cycleVehicle() {
            this.vehicle = this.vehicle === 'foot' ? 'hoverboard'
                : this.vehicle === 'hoverboard' ? 'bike' : 'foot';
            const labels = { foot: ['🚶', 'on foot'], hoverboard: ['🛹', 'hoverboard'], bike: ['🚲', 'bike'] };
            const item = labels[this.vehicle];
            const btn = document.getElementById('vehicleBtn');
            if (btn) { btn.firstChild.textContent = item[0]; btn.title = `Vehicle: ${item[1]} — click to change (H)`; btn.classList.toggle('active', this.vehicle !== 'foot'); }
            this.game.showToast(this.vehicle === 'foot' ? 'On foot' : `${item[0]} ${item[1]} ready — press G or keep riding`, 'info', 1800);
            if (this.active) this._broadcast(false);
        }

        /**
         * Drop in at a chosen spot rather than wherever the camera was aimed.
         * Already walking? Then this is a move, not an entry.
         */
        enterAt(x, z) {
            if (this.active) { this.teleport(x, z); return; }
            this._spawn = { x, z };
            this.enter();
        }

        enter() {
            if (this.active) return;
            const g = this.game, v = g.voxels;
            this.active = true;
            this._bind();

            // Drop in above whatever the camera was looking at, facing the
            // middle of the world so the player is not staring at nothing.
            const t = v.target;
            const spot = this._spawn || { x: Math.round(t.x), z: Math.round(t.z) };
            this._spawn = null;
            this.teleport(spot.x, spot.z);
            this.yaw = Math.atan2(-(this.pos.x), -(this.pos.z));
            this.pitch = -0.1;

            v.setFirstPerson(true);
            this._lastSent = 0;
            this._last = performance.now();
            this._tick = this._tick.bind(this);
            this._raf = requestAnimationFrame(this._tick);

            document.getElementById('fpsHud').classList.remove('hidden');
            document.getElementById('fpsBtn').classList.add('active');
            document.getElementById('gameContainer').classList.add('fps-mode');
            g.showToast('Click to look around · WASD to walk · Space jumps · Esc leaves', 'info', 4500);
            // Pointer lock is only granted off a real click, so the first click
            // in the world takes the mouse — asking for it here would be
            // refused by the browser and log an error for nothing.
        }

        exit() {
            if (!this.active) return;
            this.active = false;
            cancelAnimationFrame(this._raf);
            this.keys.clear();
            if (document.pointerLockElement) document.exitPointerLock();
            this.game.voxels.setFirstPerson(false);
            this.game.voxels.resetView();
            // Take my person out of everybody else's world.
            this._broadcast(true);
            document.getElementById('fpsHud').classList.add('hidden');
            document.getElementById('fpsBtn').classList.remove('active');
            document.getElementById('gameContainer').classList.remove('fps-mode');
            this.game.voxels.renderer.domElement.style.cursor = '';
        }

        _requestPointerLock() {
            const el = this.game.voxels.renderer.domElement;
            if (el.requestPointerLock) el.requestPointerLock();
        }

        // ------------------------------------------------------------- input

        _bind() {
            if (this._bound) return;
            this._bound = true;
            const el = this.game.voxels.renderer.domElement;

            window.addEventListener('keydown', (e) => {
                if (!this.active) return;
                if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
                if (e.code === 'Escape') { this.exit(); return; }
                this.keys.add(e.code);
                // The browser scrolls on space; the player jumps.
                if (e.code === 'Space') e.preventDefault();
            });
            window.addEventListener('keyup', (e) => this.keys.delete(e.code));
            window.addEventListener('blur', () => this.keys.clear());

            document.addEventListener('mousemove', (e) => {
                if (!this.active || !document.pointerLockElement) return;
                const s = 0.0022;
                this.yaw -= e.movementX * s;
                this.pitch -= e.movementY * s;
                const lim = Math.PI / 2 - 0.02;
                this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
            });

            el.addEventListener('mousedown', (e) => {
                if (!this.active) return;
                if (!document.pointerLockElement) { this._requestPointerLock(); return; }
                e.preventDefault();
                this.act(e.button === 2);
            });

            // Touch: drag to look, tap to build, two fingers to jump.
            let lastTouch = null;
            el.addEventListener('touchstart', (e) => {
                if (!this.active) return;
                if (e.touches.length === 2) this.jump();
                lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now(), moved: 0 };
            }, { passive: true });
            el.addEventListener('touchmove', (e) => {
                if (!this.active || !lastTouch) return;
                const t = e.touches[0];
                const dx = t.clientX - lastTouch.x, dy = t.clientY - lastTouch.y;
                lastTouch.moved += Math.abs(dx) + Math.abs(dy);
                this.yaw -= dx * 0.006;
                this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - dy * 0.006));
                lastTouch.x = t.clientX; lastTouch.y = t.clientY;
            }, { passive: true });
            el.addEventListener('touchend', () => {
                if (this.active && lastTouch && lastTouch.moved < 12 && Date.now() - lastTouch.t < 400) this.act(false);
                lastTouch = null;
            });

            const border = document.getElementById('fpsBorderTravel');
            if (border) border.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const dir = border.dataset.dir;
                if (dir) this.game.travelNeighbour(dir, true);
            });

            // Coarse-pointer devices can look around on the canvas and walk
            // with the separate pad. The original touch gesture only looked
            // and built, so Walk mode on a phone could never actually walk.
            document.querySelectorAll('[data-fps-key]').forEach((button) => {
                const key = button.dataset.fpsKey;
                const down = (e) => {
                    if (!this.active) return;
                    e.preventDefault();
                    e.stopPropagation();
                    this.keys.add(key);
                    if (key === 'Space') this.jump();
                    // Explicit capture is a nicety for a finger that slides off
                    // the button mid-press; touch already gets it implicitly.
                    // It throws InvalidStateError while walk mode holds pointer
                    // lock, so it must not be the thing that decides whether the
                    // key above got pressed. minimap.js guards its own the same
                    // way, for the same reason.
                    try {
                        if (button.setPointerCapture && e.pointerId !== undefined) button.setPointerCapture(e.pointerId);
                    } catch (err) { /* implicit capture already covers touch */ }
                };
                const up = (e) => {
                    this.keys.delete(key);
                    if (e) { e.preventDefault(); e.stopPropagation(); }
                };
                button.addEventListener('pointerdown', down);
                button.addEventListener('pointerup', up);
                button.addEventListener('pointercancel', up);
                button.addEventListener('lostpointercapture', up);
            });
        }

        jump() { if (this.onGround) { this.vel.y = JUMP; this.onGround = false; } }

        /** Stand on top of whatever is at (x, z), rather than inside it. */
        teleport(x, z) {
            const gx = Math.round(x), gz = Math.round(z);
            let y = this._groundAt(gx, gz, 40);
            // If that spot is walled in, rise until there is room to stand.
            for (let i = 0; i < 6 && this._blocked(gx + 0.5, y, gz + 0.5); i++) y++;
            this.pos.set(gx + 0.5, y, gz + 0.5);
            this.vel.set(0, 0, 0);
            this.onGround = true;
            return this.pos;
        }

        // ------------------------------------------------------------ physics

        _solid(x, y, z) {
            const v = this.game.voxels;
            if (y < 0) return true;                        // the floor
            return v.hasBlock(Math.floor(x), Math.floor(y), Math.floor(z));
        }

        /** Does the player's box overlap anything solid at this position? */
        _blocked(px, py, pz) {
            const x0 = Math.floor(px - RADIUS), x1 = Math.floor(px + RADIUS);
            const z0 = Math.floor(pz - RADIUS), z1 = Math.floor(pz + RADIUS);
            const y0 = Math.floor(py + 0.001), y1 = Math.floor(py + HEIGHT - 0.001);
            for (let x = x0; x <= x1; x++) {
                for (let z = z0; z <= z1; z++) {
                    for (let y = y0; y <= y1; y++) {
                        if (this._solid(x + 0.5, y + 0.5, z + 0.5)) return true;
                    }
                }
            }
            return false;
        }

        /** The height to stand at over this column, searching down from `from`. */
        _groundAt(x, z, from) {
            for (let y = Math.min(40, from); y >= 0; y--) {
                if (this.game.voxels.hasBlock(x, y, z)) return y + 1;
            }
            return 0;
        }

        _move(dt) {
            // Somebody can build around you, or you can land in a slab. Rather
            // than freezing in place, rise out of it.
            if (this._blocked(this.pos.x, this.pos.y, this.pos.z)) {
                for (let i = 0; i < 4 && this._blocked(this.pos.x, this.pos.y, this.pos.z); i++) this.pos.y += 1;
                this.vel.y = 0;
            }

            const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
            const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
            const wish = new THREE.Vector3();
            if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) wish.add(forward);
            if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) wish.sub(forward);
            if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) wish.add(right);
            if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) wish.sub(right);
            if (this.keys.has('Space')) this.jump();
            if (wish.lengthSq() > 0) wish.normalize();

            const sprinting = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
            const speed = this.vehicle === 'hoverboard' ? HOVERBOARD_SPEED
                : this.vehicle === 'bike' ? (sprinting ? BIKE_SPRINT : BIKE_SPEED)
                    : (sprinting ? SPRINT : SPEED);
            this.vel.x = wish.x * speed;
            this.vel.z = wish.z * speed;
            this.vel.y -= GRAVITY * dt;
            if (this.vel.y < -40) this.vel.y = -40;

            // Swept per axis: hitting a wall on one axis must not cancel the
            // other, or you stick on corners instead of sliding along them.
            const step = (axis, amount) => {
                if (!amount) return;
                const next = this.pos.clone();
                next[axis] += amount;
                if (!this._blocked(next.x, next.y, next.z)) { this.pos.copy(next); return; }
                if (axis === 'y') {
                    if (amount < 0) { this.onGround = true; this.pos.y = Math.floor(this.pos.y + 0.001); }
                    this.vel.y = 0;
                    return;
                }
                // Walking into a low ledge steps up onto it rather than stopping.
                const up = next.clone();
                up.y += STEP;
                if (this.onGround && !this._blocked(up.x, up.y, up.z)) this.pos.copy(up);
            };

            step('x', this.vel.x * dt);
            step('z', this.vel.z * dt);
            const before = this.pos.y;
            this.onGround = false;
            step('y', this.vel.y * dt);
            if (this.vel.y <= 0 && this.pos.y === before) this.onGround = true;

            // Never leave the world.
            const lim = this.game.voxels.half - 0.5;
            this.pos.x = Math.max(-lim, Math.min(lim, this.pos.x));
            this.pos.z = Math.max(-lim, Math.min(lim, this.pos.z));
            if (this.pos.y < 0) { this.pos.y = 0; this.vel.y = 0; this.onGround = true; }
        }

        // ------------------------------------------------------------- aiming

        /** March along the view ray a step at a time; cheap and exact enough. */
        target() {
            const dir = new THREE.Vector3(
                -Math.sin(this.yaw) * Math.cos(this.pitch),
                Math.sin(this.pitch),
                -Math.cos(this.yaw) * Math.cos(this.pitch)
            );
            const eye = this.pos.clone();
            eye.y += EYE;
            let prev = null;
            for (let t = 0; t < REACH; t += 0.05) {
                const p = eye.clone().addScaledVector(dir, t);
                const cell = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
                if (this.game.voxels.hasBlock(cell.x, cell.y, cell.z)) {
                    return { remove: cell, place: prev || cell };
                }
                if (p.y < 0) return { remove: null, place: prev || { x: cell.x, y: 0, z: cell.z } };
                if (!prev || prev.x !== cell.x || prev.y !== cell.y || prev.z !== cell.z) prev = cell;
            }
            return { remove: null, place: null };
        }

        act(erase) {
            const aim = this.target();
            if (!aim) return;
            const g = this.game;
            if (erase || g.tool === 'erase') {
                if (aim.remove) g.removeAt(aim.remove.x, aim.remove.y, aim.remove.z);
            } else if (g.tool === 'paint') {
                // Painting works on what you are looking at, not on the empty
                // face in front of it — the same as it does from the orbit
                // camera, so the tool behaves the same from either view.
                if (aim.remove) g.paintAt(aim.remove.x, aim.remove.y, aim.remove.z);
            } else if (aim.place) {
                // Refuse to build inside your own head.
                const p = aim.place;
                const feet = Math.floor(this.pos.y), head = Math.floor(this.pos.y + HEIGHT);
                const sameColumn = p.x === Math.floor(this.pos.x) && p.z === Math.floor(this.pos.z);
                if (sameColumn && p.y >= feet && p.y <= head) {
                    g.showToast('You are standing there', 'warning', 1200);
                    return;
                }
                g.placeAt(p.x, p.y, p.z);
            }
        }

        /**
         * Tell the room where this person is. Ten times a second is enough —
         * the other clients ease between the updates and keep the legs moving,
         * so it looks continuous without putting a packet on every frame.
         */
        _broadcast(leaving) {
            const g = this.game;
            if (!g.connected) return;
            const now = performance.now();
            if (!leaving && now - this._lastSent < BROADCAST_MS) return;
            this._lastSent = now;
            const moving = Math.abs(this.vel.x) + Math.abs(this.vel.z) > 0.2;
            const payload = {
                type: 'avatar', name: g.username, hide: !!leaving,
                x: +this.pos.x.toFixed(2), y: +this.pos.y.toFixed(2), z: +this.pos.z.toFixed(2),
                yaw: +this.yaw.toFixed(3), moving,
                vehicle: this.vehicle,
                color: typeof g.generateUserColor === 'function' ? g.generateUserColor(g.username) : '#6366f1'
            };
            // The host never receives its own relay. Feed its runner position
            // through the identical validation path before broadcasting it.
            if (g.isHost && g.isHost() && g.modes) g.modes.onAvatar(g.username, payload);
            if (!g.sendToHost(payload)) g.sendData(payload);
        }

        // --------------------------------------------------------------- loop

        _tick(now) {
            if (!this.active) return;
            this._raf = requestAnimationFrame(this._tick);
            const dt = Math.min(MAX_DT, (now - this._last) / 1000 || 0);
            this._last = now;
            this.step(dt);
        }

        /**
         * One step of being a person: move, put the camera behind the eyes, and
         * show what the crosshair is on. Separate from the frame callback so it
         * can be driven at a fixed rate — a page the browser is not drawing
         * gets almost no frames, and physics that only runs on frames is
         * physics you cannot test.
         */
        step(dt) {
            this._move(dt);
            if (this.game.pois) this.game.pois.update(this.pos);
            this._broadcast(false);

            const eye = this.pos.clone();
            eye.y += EYE;
            this.game.voxels.setEyeCamera(eye, this.yaw, this.pitch);

            // Show what the crosshair is on, using the same ghost as the orbit
            // view so building feels identical from either camera.
            const aim = this.target();
            const erasing = this.game.tool === 'erase';
            const painting = this.game.tool === 'paint';
            const cell = (erasing || painting) ? aim.remove : aim.place;
            const v = this.game.voxels;
            if (cell) {
                if (painting) {
                    // The block wearing its new colour, rather than a ghost
                    // hanging in the air in front of it.
                    v.hidePiecePreview();
                    v.showPreview(cell.x, cell.y, cell.z, this.game.currentShape, this.game.currentColor);
                } else if (this.game.brickMode && !erasing) {
                    const fp = this.game.pieceFootprint();
                    v.hidePreview();
                    // A brick that will not fit is shown in red from the orbit
                    // camera, where you can see it in context. Standing next to
                    // it, that red block is most of the screen — so up close a
                    // refusal is just nothing to place, plus the sound.
                    if (this.game.pieceBlocked(cell.x, cell.y, cell.z, fp.w, fp.d)) v.hidePiecePreview();
                    else v.showPiecePreview(cell.x, cell.y, cell.z, fp.w, fp.d, this.game.currentColor, false);
                } else {
                    v.hidePiecePreview();
                    v.showPreview(cell.x, cell.y, cell.z, this.game.currentShape, this.game.currentColor,
                        erasing ? 'erase' : null);
                }
                this.game._sendCursor({ x: cell.x, y: cell.y, z: cell.z });
            } else {
                v.hidePreview();
                v.hidePiecePreview();
            }

            const hud = document.getElementById('fpsCoords');
            if (hud) {
                const speed = Math.hypot(this.vel.x, this.vel.z);
                const motion = speed > SPRINT * 0.8 ? 'running' : speed > 0.2 ? 'walking' : 'standing';
                const ride = this.vehicle === 'foot' ? '' : ` · ${this.vehicle}`;
                hud.textContent = `x ${Math.round(this.pos.x)} · y ${Math.round(this.pos.y)} · z ${Math.round(this.pos.z)} · ${motion}${ride}`;
            }

            // Yaw zero faces -Z, which is north in the geo projection. A
            // clockwise compass bearing is therefore the negative yaw.
            const bearing = ((-this.yaw * 180 / Math.PI) % 360 + 360) % 360;
            const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
            const cardinal = directions[Math.round(bearing / 45) % directions.length];
            const compass = document.getElementById('fpsCompass');
            if (compass) compass.textContent = `${cardinal} · ${String(Math.round(bearing)).padStart(3, '0')}°`;

            const objective = document.getElementById('fpsObjective');
            const guidance = this.game.modes && this.game.modes.fpsGuidance(this.pos.x, this.pos.z, this.yaw);
            if (objective) { objective.textContent = guidance || ''; objective.classList.toggle('hidden', !guidance); }

            const place = document.getElementById('fpsPlace');
            if (place) {
                const geo = this.game.geo;
                const latLon = geo && geo.toLatLon(this.pos.x, this.pos.z);
                if (latLon && window.BlockPartyGeo) {
                    const scale = geo.anchor && geo.anchor.mpc ? ` · ${geo.anchor.mpc} m/block` : '';
                    place.textContent = `${BlockPartyGeo.format(latLon.lat, latLon.lon)}${scale}`;
                } else {
                    place.textContent = 'Off the map · local world coordinates';
                }
            }

            // A region edge is a real map border, not an invisible wall. The
            // prompt turns a walk to the edge into an intentional crossing;
            // guests can see where the road leads, while the host moves the
            // shared room only after pressing the button.
            const border = document.getElementById('fpsBorder');
            const borderText = document.getElementById('fpsBorderText');
            const borderGo = document.getElementById('fpsBorderTravel');
            const lim = this.game.voxels.half - 0.5;
            // The central build region has changed only after an intentional
            // host walk into its edge. Map ground is already present around it,
            // so the new region arrives as the continuation of the same road.
            // A short cooldown prevents one held key from stepping two regions.
            const wants = this.game._autoRegionCross && this.game.isHost()
                && !(this.game.modes && this.game.modes.isMatchActive());
            const now = performance.now();
            let crossing = null;
            if (wants && now >= (this._crossAt || 0)) {
                if (this.pos.z <= -lim && this.vel.z < -0.1) crossing = 'n';
                else if (this.pos.x >= lim && this.vel.x > 0.1) crossing = 'e';
                else if (this.pos.z >= lim && this.vel.z > 0.1) crossing = 's';
                else if (this.pos.x <= -lim && this.vel.x < -0.1) crossing = 'w';
                if (crossing && this.game.geo && this.game.geo.region) {
                    this._crossAt = now + 1400;
                    this.game.travelNeighbour(crossing, true);
                }
            }
            const near = 6;
            let edge = null;
            if (this.pos.z <= -lim + near) edge = 'n';
            else if (this.pos.x >= lim - near) edge = 'e';
            else if (this.pos.z >= lim - near) edge = 's';
            else if (this.pos.x <= -lim + near) edge = 'w';
            const geo = this.game.geo;
            const canCross = !!(edge && geo && geo.region && !(this.game.modes && this.game.modes.isMatchActive()));
            if (border) border.classList.toggle('hidden', !canCross);
            if (canCross) {
                const names = { n: 'North', e: 'East', s: 'South', w: 'West' };
                if (borderText) borderText.textContent = `Border ahead · ${names[edge]} world`;
                if (borderGo) {
                    borderGo.dataset.dir = edge;
                    borderGo.textContent = this.game.isHost() ? `Cross to ${names[edge]}` : 'Host moves room';
                    borderGo.disabled = !this.game.isHost();
                }
            }
        }
    }

    window.BlockPartyFPS = FirstPerson;
})();
