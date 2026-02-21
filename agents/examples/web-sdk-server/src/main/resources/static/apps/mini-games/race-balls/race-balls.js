/**
 * Race Balls - Multiplayer 3D Physics Mini-Game
 *
 * Tech:
 * - Three.js (render)
 * - Cannon.js (physics) (via CDN already loaded in index.html)
 * - AgentSessionBase (connection + WebRTC DataChannels)
 *
 * Core design:
 * - Host-authoritative physics: host steps physics at fixed 60 Hz, applies all players' inputs,
 *   and broadcasts periodic snapshots.
 * - Clients send input state to host (move dir, boost, jump edge).
 * - Clients also do lightweight local prediction for their own ball for responsiveness, then
 *   smoothly correct to host snapshots.
 *
 * Requirements:
 * - Physics-only movement (forces/impulses), no teleport controls
 * - Jump only when grounded (with small coyote time)
 * - Boost with stamina 0..100; drains while boosting; recharge over configurable duration; tired slowdown
 * - Clamp speed and impulses
 * - Simple ball "personality" via sprite face that changes to state
 */

(function () {
    'use strict';

    // ----------------------------
    // Config
    // ----------------------------

    const RB_CONFIG = {
        NAME: 'race-balls',
        VERSION: '1.0.0',

        // Rooms
        MAX_PLAYERS: 4,

        // Physics
        FIXED_TIMESTEP_HZ: 60,
        MAX_SUBSTEPS: 3,
        GRAVITY: -35,

        // Arena
        GROUND_Y: 0,
        ARENA_SIZE: 60,
        WALL_HEIGHT: 4,
        WALL_THICKNESS: 0.5,
        FALL_RESPAWN_Y: -10,  // If ball falls below this, respawn it

        // Ball
        BALL_RADIUS: 0.5,
        BALL_MASS: 1.5,
        BALL_LINEAR_DAMPING: 0.5,
        BALL_ANGULAR_DAMPING: 0.5,

        // Movement parameters - SLOWER and more controlled
        movement: {
            maxNormalSpeed: 10,           // units/sec (SLOWER!)
            maxBoostSpeed: 16,            // units/sec (slower boost)
            tiredSpeedMultiplier: 0.5,    // normal speed * multiplier while recharging
            drainRatePerSecond: 20,       // stamina per second
            rechargeDurationSeconds: 4,   // time from 0->100

            // Force/impulse tuning - more controlled
            maxMoveForce: 60,             // capped force magnitude (reduced)
            maxBoostForce: 100,           // capped force magnitude while boosting (reduced)
            maxJumpImpulse: 14,           // upward impulse
            maxAirControlForceMultiplier: 0.5,
            brakingForce: 30,

            // Grounding
            groundedEpsilon: 0.3,
            coyoteTimeSeconds: 0.15,
        },

        // Networking
        INPUT_SEND_HZ: 30,
        SNAPSHOT_SEND_HZ: 15,
        SNAPSHOT_LERP: 0.25,
        REMOTE_INTERP_DELAY_MS: 120,

        // Race
        COUNTDOWN_SECONDS: 3,

        // Pickups
        DEFAULT_PICKUP_RESPAWN_SECONDS: 10,

        // HUD
        NAMEPLATE_HEIGHT: 2.4,
        STAMINA_SPRITE_SIZE: { w: 2.2, h: 0.45 },

        // Player colors (unique color per join order)
        PLAYER_COLORS: ['#f87171', '#60a5fa', '#34d399', '#fbbf24'],

        // Expression timing
        expression: {
            impactFlashSeconds: 0.35,
        },
    };

    // ----------------------------
    // Small helpers
    // ----------------------------

    function clamp(v, min, max) {
        return Math.max(min, Math.min(max, v));
    }

    function nowMs() {
        return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    }

    function vec2Normalize(x, y) {
        const len = Math.hypot(x, y);
        if (len < 1e-6) return { x: 0, y: 0, len: 0 };
        return { x: x / len, y: y / len, len };
    }

    function isMobileDevice() {
        const ua = navigator.userAgent || '';
        return /Android|iPhone|iPad|iPod/i.test(ua) || (navigator.maxTouchPoints || 0) > 0;
    }

    // ----------------------------
    // Texture Generator for world visuals
    // ----------------------------

    class TextureGenerator {
        constructor() {
            this._cache = new Map();
        }

        // Generate a canvas-based texture
        _createCanvas(width, height) {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            return canvas;
        }

        // Get or create cached texture
        getTexture(type, baseColor) {
            const key = `${type}-${baseColor}`;
            if (this._cache.has(key)) return this._cache.get(key);

            let texture;
            switch (type) {
                case 'road':
                    texture = this._createRoadTexture(baseColor);
                    break;
                case 'checkerboard':
                    texture = this._createCheckerboardTexture();
                    break;
                case 'crate':
                    texture = this._createCrateTexture(baseColor);
                    break;
                case 'hazard':
                    texture = this._createHazardTexture(baseColor);
                    break;
                case 'rubber':
                    texture = this._createRubberTexture(baseColor);
                    break;
                case 'wall':
                    texture = this._createWallTexture(baseColor);
                    break;
                case 'dizzy':
                    texture = this._createDizzyTexture(baseColor);
                    break;
                default:
                    texture = this._createDefaultTexture(baseColor);
            }

            this._cache.set(key, texture);
            return texture;
        }

        _createRoadTexture(baseColor) {
            const canvas = this._createCanvas(256, 256);
            const ctx = canvas.getContext('2d');

            // Base asphalt color
            ctx.fillStyle = baseColor || '#3d4f5f';
            ctx.fillRect(0, 0, 256, 256);

            // Add noise/grain for asphalt look
            for (let i = 0; i < 2000; i++) {
                const x = Math.random() * 256;
                const y = Math.random() * 256;
                const gray = Math.floor(Math.random() * 30);
                ctx.fillStyle = `rgba(${gray}, ${gray}, ${gray}, 0.3)`;
                ctx.fillRect(x, y, 2, 2);
            }

            // Road markings - dashed center line
            ctx.strokeStyle = '#fbbf24';
            ctx.lineWidth = 4;
            ctx.setLineDash([20, 15]);
            ctx.beginPath();
            ctx.moveTo(128, 0);
            ctx.lineTo(128, 256);
            ctx.stroke();

            const texture = new THREE.CanvasTexture(canvas);
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.repeat.set(1, 8);
            return texture;
        }

        _createCheckerboardTexture() {
            const canvas = this._createCanvas(256, 256);
            const ctx = canvas.getContext('2d');
            const size = 32;

            for (let y = 0; y < 256; y += size) {
                for (let x = 0; x < 256; x += size) {
                    const isWhite = ((x / size) + (y / size)) % 2 === 0;
                    ctx.fillStyle = isWhite ? '#ffffff' : '#1a1a1a';
                    ctx.fillRect(x, y, size, size);
                }
            }

            const texture = new THREE.CanvasTexture(canvas);
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.repeat.set(2, 1);
            return texture;
        }

        _createCrateTexture(baseColor) {
            const canvas = this._createCanvas(128, 128);
            const ctx = canvas.getContext('2d');

            // Wood base
            ctx.fillStyle = baseColor || '#8b7355';
            ctx.fillRect(0, 0, 128, 128);

            // Wood grain lines
            ctx.strokeStyle = 'rgba(0,0,0,0.2)';
            ctx.lineWidth = 2;
            for (let i = 0; i < 128; i += 8) {
                ctx.beginPath();
                ctx.moveTo(0, i + Math.random() * 4);
                ctx.lineTo(128, i + Math.random() * 4);
                ctx.stroke();
            }

            // Crate border
            ctx.strokeStyle = '#5a4a3a';
            ctx.lineWidth = 6;
            ctx.strokeRect(4, 4, 120, 120);

            // Cross boards
            ctx.strokeStyle = '#6a5a4a';
            ctx.lineWidth = 8;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(128, 128);
            ctx.moveTo(128, 0);
            ctx.lineTo(0, 128);
            ctx.stroke();

            const texture = new THREE.CanvasTexture(canvas);
            return texture;
        }

        _createHazardTexture(baseColor) {
            const canvas = this._createCanvas(128, 128);
            const ctx = canvas.getContext('2d');

            // Warning stripes
            const stripeWidth = 16;
            for (let i = -128; i < 256; i += stripeWidth * 2) {
                ctx.fillStyle = '#1a1a1a';
                ctx.beginPath();
                ctx.moveTo(i, 0);
                ctx.lineTo(i + stripeWidth, 0);
                ctx.lineTo(i + stripeWidth + 128, 128);
                ctx.lineTo(i + 128, 128);
                ctx.fill();

                ctx.fillStyle = baseColor || '#f97316';
                ctx.beginPath();
                ctx.moveTo(i + stripeWidth, 0);
                ctx.lineTo(i + stripeWidth * 2, 0);
                ctx.lineTo(i + stripeWidth * 2 + 128, 128);
                ctx.lineTo(i + stripeWidth + 128, 128);
                ctx.fill();
            }

            const texture = new THREE.CanvasTexture(canvas);
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            return texture;
        }

        _createRubberTexture(baseColor) {
            const canvas = this._createCanvas(64, 64);
            const ctx = canvas.getContext('2d');

            // Base rubber color
            ctx.fillStyle = baseColor || '#ef4444';
            ctx.fillRect(0, 0, 64, 64);

            // Bumpy texture
            ctx.fillStyle = 'rgba(255,255,255,0.2)';
            for (let y = 0; y < 64; y += 8) {
                for (let x = 0; x < 64; x += 8) {
                    ctx.beginPath();
                    ctx.arc(x + 4, y + 4, 3, 0, Math.PI * 2);
                    ctx.fill();
                }
            }

            const texture = new THREE.CanvasTexture(canvas);
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.repeat.set(2, 2);
            return texture;
        }

        _createWallTexture(baseColor) {
            const canvas = this._createCanvas(128, 128);
            const ctx = canvas.getContext('2d');

            // Base concrete color
            ctx.fillStyle = baseColor || '#374151';
            ctx.fillRect(0, 0, 128, 128);

            // Concrete texture - horizontal lines
            ctx.strokeStyle = 'rgba(0,0,0,0.15)';
            ctx.lineWidth = 2;
            for (let y = 0; y < 128; y += 16) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(128, y);
                ctx.stroke();
            }

            // Vertical grooves
            for (let x = 0; x < 128; x += 32) {
                ctx.strokeStyle = 'rgba(0,0,0,0.1)';
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, 128);
                ctx.stroke();
            }

            const texture = new THREE.CanvasTexture(canvas);
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.repeat.set(1, 4);
            return texture;
        }

        _createDizzyTexture(baseColor) {
            const canvas = this._createCanvas(128, 128);
            const ctx = canvas.getContext('2d');

            // Swirl pattern
            ctx.fillStyle = baseColor || '#a855f7';
            ctx.fillRect(0, 0, 128, 128);

            // Spiral
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 4;
            ctx.beginPath();
            for (let angle = 0; angle < Math.PI * 6; angle += 0.1) {
                const r = angle * 3;
                const x = 64 + Math.cos(angle) * r;
                const y = 64 + Math.sin(angle) * r;
                if (angle === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();

            // Stars
            ctx.fillStyle = '#fde047';
            const starPoints = [[20, 20], [100, 30], [30, 100], [90, 90]];
            starPoints.forEach(([sx, sy]) => {
                ctx.beginPath();
                for (let i = 0; i < 5; i++) {
                    const angle = (i * 4 * Math.PI) / 5 - Math.PI / 2;
                    const r = i % 2 === 0 ? 8 : 4;
                    const px = sx + Math.cos(angle) * r;
                    const py = sy + Math.sin(angle) * r;
                    if (i === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                ctx.fill();
            });

            const texture = new THREE.CanvasTexture(canvas);
            return texture;
        }

        _createDefaultTexture(baseColor) {
            const canvas = this._createCanvas(64, 64);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = baseColor || '#4a5568';
            ctx.fillRect(0, 0, 64, 64);

            // Add slight grid
            ctx.strokeStyle = 'rgba(255,255,255,0.1)';
            ctx.lineWidth = 1;
            for (let i = 0; i < 64; i += 16) {
                ctx.beginPath();
                ctx.moveTo(i, 0);
                ctx.lineTo(i, 64);
                ctx.moveTo(0, i);
                ctx.lineTo(64, i);
                ctx.stroke();
            }

            const texture = new THREE.CanvasTexture(canvas);
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            return texture;
        }
    }

    // ----------------------------
    // Face / expression sprites
    // ----------------------------

    class FaceFactory {
        constructor() {
            this._cache = new Map();
        }

        /**
         * Create a canvas-based sprite texture for a given expression.
         * This avoids needing external assets.
         */
        getTexture(expression, colorHex) {
            const key = `${expression}|${colorHex}`;
            if (this._cache.has(key)) return this._cache.get(key);

            const size = 128;
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');

            // Transparent background; we draw only face details.
            ctx.clearRect(0, 0, size, size);

            // Make eyes/mouth dark but tint slightly to match player color.
            ctx.fillStyle = 'rgba(0,0,0,0.75)';
            ctx.strokeStyle = 'rgba(0,0,0,0.75)';
            ctx.lineWidth = 8;
            ctx.lineCap = 'round';

            // Eyes
            const eyeY = 44;
            const eyeXOffset = 24;
            const eyeRadius = 10;

            // Different eyes by expression
            const drawEye = (cx, cy, type) => {
                ctx.beginPath();
                if (type === 'normal') {
                    ctx.arc(cx, cy, eyeRadius, 0, Math.PI * 2);
                    ctx.fill();
                } else if (type === 'excited') {
                    // bigger eyes
                    ctx.arc(cx, cy, eyeRadius + 3, 0, Math.PI * 2);
                    ctx.fill();
                    // sparkle
                    ctx.fillStyle = 'rgba(255,255,255,0.9)';
                    ctx.beginPath();
                    ctx.arc(cx + 4, cy - 4, 3, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.fillStyle = 'rgba(0,0,0,0.75)';
                } else if (type === 'tired') {
                    // sleepy half-lids
                    ctx.beginPath();
                    ctx.arc(cx, cy + 6, eyeRadius + 2, Math.PI, Math.PI * 2);
                    ctx.stroke();
                } else if (type === 'impact') {
                    // angry slanted eyes
                    ctx.beginPath();
                    ctx.moveTo(cx - 14, cy - 6);
                    ctx.lineTo(cx + 10, cy + 6);
                    ctx.stroke();
                } else if (type === 'dizzy') {
                    // X X eyes (dizzy/confused)
                    ctx.lineWidth = 6;
                    // X shape
                    ctx.beginPath();
                    ctx.moveTo(cx - 8, cy - 8);
                    ctx.lineTo(cx + 8, cy + 8);
                    ctx.moveTo(cx + 8, cy - 8);
                    ctx.lineTo(cx - 8, cy + 8);
                    ctx.stroke();
                    ctx.lineWidth = 8; // restore
                }
            };

            let eyeType = 'normal';
            if (expression === 'boosting') eyeType = 'excited';
            if (expression === 'tired') eyeType = 'tired';
            if (expression === 'impact') eyeType = 'impact';
            if (expression === 'dizzy') eyeType = 'dizzy';

            drawEye(size / 2 - eyeXOffset, eyeY, eyeType);
            drawEye(size / 2 + eyeXOffset, eyeY, eyeType);

            // Mouth
            const mouthY = 78;
            ctx.beginPath();
            if (expression === 'normal') {
                ctx.arc(size / 2, mouthY, 18, 0.15 * Math.PI, 0.85 * Math.PI);
                ctx.stroke();
            } else if (expression === 'boosting') {
                // open smile
                ctx.arc(size / 2, mouthY, 22, 0, Math.PI);
                ctx.stroke();
                ctx.fillStyle = 'rgba(0,0,0,0.55)';
                ctx.beginPath();
                ctx.arc(size / 2, mouthY + 7, 10, 0, Math.PI);
                ctx.fill();
                ctx.fillStyle = 'rgba(0,0,0,0.75)';
            } else if (expression === 'tired') {
                // flat mouth
                ctx.moveTo(size / 2 - 18, mouthY + 8);
                ctx.lineTo(size / 2 + 18, mouthY + 8);
                ctx.stroke();
            } else if (expression === 'impact') {
                // surprised O
                ctx.beginPath();
                ctx.arc(size / 2, mouthY + 6, 14, 0, Math.PI * 2);
                ctx.stroke();
            } else if (expression === 'dizzy') {
                // wavy/confused mouth
                ctx.moveTo(size / 2 - 20, mouthY + 8);
                ctx.quadraticCurveTo(size / 2 - 10, mouthY + 2, size / 2, mouthY + 8);
                ctx.quadraticCurveTo(size / 2 + 10, mouthY + 14, size / 2 + 20, mouthY + 8);
                ctx.stroke();
            }

            const texture = new THREE.CanvasTexture(canvas);
            texture.needsUpdate = true;
            this._cache.set(key, texture);
            return texture;
        }

        createSprite(expression, colorHex) {
            const map = this.getTexture(expression, colorHex);
            const material = new THREE.SpriteMaterial({ map, transparent: true });
            const sprite = new THREE.Sprite(material);
            sprite.scale.set(1.8, 1.8, 1.8);
            return sprite;
        }

        updateSprite(sprite, expression, colorHex) {
            const map = this.getTexture(expression, colorHex);
            sprite.material.map = map;
            sprite.material.needsUpdate = true;
        }
    }

    // ----------------------------
    // Input
    // ----------------------------

    class InputState {
        constructor() {
            this.moveX = 0; // -1..1
            this.moveY = 0; // -1..1
            this.boost = false;
            this.jumpPressed = false; // edge-trigger for networking
            this._jumpHeld = false;

            // Desktop
            this._keys = new Set();
            this._mouseDown = false;
            this._mouseVec = { x: 0, y: 0 };

            // Mobile
            this._touchActive = false;
            this._touchStart = { x: 0, y: 0 };
            this._touchCurrent = { x: 0, y: 0 };
            this._mobileBoostActive = false;  // Track mobile boost button state
        }

        attach(targetEl) {
            // Keyboard
            window.addEventListener('keydown', (e) => {
                this._keys.add(e.key.toLowerCase());
                if (e.key === ' ' || e.code === 'Space') {
                    if (!this._jumpHeld) {
                        this.jumpPressed = true;
                    }
                    this._jumpHeld = true;
                }
            });
            window.addEventListener('keyup', (e) => {
                this._keys.delete(e.key.toLowerCase());
                if (e.key === ' ' || e.code === 'Space') {
                    this._jumpHeld = false;
                }
            });

            // Mouse direction (relative to screen center). Holding mouse button acts like boost.
            window.addEventListener('mousedown', (e) => {
                this._mouseDown = true;
            });
            window.addEventListener('mouseup', () => {
                this._mouseDown = false;
            });
            window.addEventListener('mousemove', (e) => {
                const cx = window.innerWidth / 2;
                const cy = window.innerHeight / 2;
                const dx = (e.clientX - cx) / Math.max(cx, 1);
                const dy = (e.clientY - cy) / Math.max(cy, 1);
                // Store as-is: mouse DOWN = positive dy = positive my = forward (like W key)
                this._mouseVec.x = dx;
                this._mouseVec.y = dy;
            });

            // Touch controls
            if (!targetEl) targetEl = document.body;

            const onTouchStart = (e) => {
                this._touchActive = true;
                const t = e.touches[0];
                this._touchStart.x = t.clientX;
                this._touchStart.y = t.clientY;
                this._touchCurrent.x = t.clientX;
                this._touchCurrent.y = t.clientY;

                // Holding anywhere boosts on mobile (per requirements)
                this.boost = true;
            };

            const onTouchMove = (e) => {
                if (!this._touchActive) return;
                const t = e.touches[0];
                this._touchCurrent.x = t.clientX;
                this._touchCurrent.y = t.clientY;
            };

            const onTouchEnd = () => {
                this._touchActive = false;
                this.boost = false;
                this.moveX = 0;
                this.moveY = 0;
            };

            targetEl.addEventListener('touchstart', onTouchStart, { passive: true });
            targetEl.addEventListener('touchmove', onTouchMove, { passive: true });
            targetEl.addEventListener('touchend', onTouchEnd, { passive: true });
            targetEl.addEventListener('touchcancel', onTouchEnd, { passive: true });

            // Mobile buttons (if present)
            const jumpBtn = document.getElementById('jumpBtn');
            const boostBtn = document.getElementById('boostBtn');
            if (jumpBtn) {
                // Touch events for mobile
                jumpBtn.addEventListener('touchstart', (e) => {
                    e.preventDefault();
                    if (!this._jumpHeld) this.jumpPressed = true;
                    this._jumpHeld = true;
                }, { passive: false });
                jumpBtn.addEventListener('touchend', (e) => {
                    e.preventDefault();
                    this._jumpHeld = false;
                }, { passive: false });

                // Click event for PC mouse
                jumpBtn.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    if (!this._jumpHeld) this.jumpPressed = true;
                    this._jumpHeld = true;
                });
                jumpBtn.addEventListener('mouseup', (e) => {
                    e.preventDefault();
                    this._jumpHeld = false;
                });
            }
            if (boostBtn) {
                // Touch events for mobile
                boostBtn.addEventListener('touchstart', (e) => {
                    e.preventDefault();
                    this._mobileBoostActive = true;
                }, { passive: false });
                boostBtn.addEventListener('touchend', (e) => {
                    e.preventDefault();
                    this._mobileBoostActive = false;
                }, { passive: false });
                boostBtn.addEventListener('touchcancel', (e) => {
                    this._mobileBoostActive = false;
                }, { passive: false });

                // Click event for PC mouse on boost button
                boostBtn.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    this._mobileBoostActive = true;
                });
                boostBtn.addEventListener('mouseup', (e) => {
                    e.preventDefault();
                    this._mobileBoostActive = false;
                });
                boostBtn.addEventListener('mouseleave', (e) => {
                    this._mobileBoostActive = false;
                });
            }
        }

        update() {
            // Reset per-frame edge flags
            // (callers should consume jumpPressed and then this method can clear it if desired)

            // Desktop: WASD + Arrow Keys
            // Note: Arrow keys can be lowercase 'arrowup' or proper case 'ArrowUp' depending on browser
            const w = this._keys.has('w') || this._keys.has('arrowup') || this._keys.has('ArrowUp');
            const s = this._keys.has('s') || this._keys.has('arrowdown') || this._keys.has('ArrowDown');
            const a = this._keys.has('a') || this._keys.has('arrowleft') || this._keys.has('ArrowLeft');
            const d = this._keys.has('d') || this._keys.has('arrowright') || this._keys.has('ArrowRight');

            // Mouse defines movement direction if mouse is far enough from center
            const mouseHasDir = Math.hypot(this._mouseVec.x, this._mouseVec.y) > 0.15;

            let mx = 0;
            let my = 0;

            if (mouseHasDir) {
                // Normalize the mouse vector for direction
                // DON'T invert Y here - it will be inverted later at force calculation (line ~1560)
                const n = vec2Normalize(this._mouseVec.x, this._mouseVec.y);
                mx = n.x;
                my = n.y;
            } else {
                mx = (d ? 1 : 0) + (a ? -1 : 0);
                my = (w ? 1 : 0) + (s ? -1 : 0);
                const n = vec2Normalize(mx, my);
                mx = n.x;
                my = n.y;
            }

            // Mobile swipe direction controls movement via impulse. We'll interpret drag vector as desired direction.
            if (this._touchActive) {
                const dx = this._touchCurrent.x - this._touchStart.x;
                const dy = this._touchStart.y - this._touchCurrent.y; // invert so up = forward
                const n = vec2Normalize(dx, dy);
                mx = n.x;
                my = n.y;
            }

            this.moveX = clamp(mx, -1, 1);
            this.moveY = clamp(my, -1, 1);

            // Boost: desktop shift OR mouse button held, mobile handled by touch/button
            // Directly assign - boost STOPS when button is released
            const shift = this._keys.has('shift');
            const desktopBoost = shift || this._mouseDown;
            // Only keep mobile boost if it's still being held (set via touchMoveActive or button)
            this.boost = desktopBoost || this._mobileBoostActive;
        }

        consumeJumpPressed() {
            const v = this.jumpPressed;
            this.jumpPressed = false;
            return v;
        }

        snapshot() {
            return {
                moveX: this.moveX,
                moveY: this.moveY,
                boost: !!this.boost,
                jumpPressed: !!this.jumpPressed,
            };
        }
    }

    // ----------------------------
    // Player state
    // ----------------------------

    class PlayerModel {
        constructor(playerId, colorHex) {
            this.playerId = playerId;
            this.colorHex = colorHex;

            // Physics bodies
            this.body = null;

            // Render
            this.mesh = null;
            this.faceSprite = null;

            // Gameplay
            this.stamina = 100;
            this.isTired = false;
            this.lastGroundedAtMs = 0;
            this.lastImpactAtMs = -Infinity;
            this._lastVelForImpact = 0;

            // Dizzy state
            this.isDizzy = false;
            this.dizzyUntilMs = 0;

            // Input (last received from peer)
            this.input = {
                moveX: 0,
                moveY: 0,
                boost: false,
                jumpEdge: false,
                seq: 0,
            };

            // Race progress (host-authoritative)
            this.nextCheckpointIndex = 0;
            this.finished = false;
            this.finishTimeMs = null;

            // Remote interpolation
            this.netBuffer = []; // [{t, px,py,pz, qx,qy,qz,qw, vx,vy,vz, stamina, tired, cp, finished, finishTimeMs}]
        }

        getExpression() {
            const t = nowMs();
            if (this.isDizzy) return 'dizzy';
            if ((t - this.lastImpactAtMs) / 1000 < RB_CONFIG.expression.impactFlashSeconds) return 'impact';
            if (this.isTired) return 'tired';
            if (this.input.boost && this.stamina > 0.1) return 'boosting';
            return 'normal';
        }
    }

    // ----------------------------
    // Main game
    // ----------------------------

    class RaceBallsGame extends AgentInteractionBase {
        constructor() {
            super({
                storagePrefix: 'raceballs',
                customType: 'race-balls',

                // Prompt#2 requirement: sync over WebSocket
                relayMode: 'p2p-host',
                relayEnabled: false,
                autoCreateDataChannel: true,

                dataChannelName: 'raceballs-data',
                dataChannelOptions: {
                    ordered: false,
                    maxRetransmits: 0
                }
            });

            // Three
            this.renderer = null;
            this.scene = null;
            this.camera = null;

            // Physics
            this.world = null;

            // Players
            this.players = new Map(); // id -> PlayerModel
            this.playerOrder = [];
            this._connectedPeers = new Set(); // Track connected peers for status display

            // Input
            this.input = new InputState();

            // Loop
            this._rafId = null;
            this._accumulator = 0;
            this._lastFrameMs = 0;

            // Network timers
            this._lastInputSendMs = 0;
            this._lastSnapshotSendMs = 0;

            // UI
            this._ui = {
                shareBtn: null,
                playerCountValue: null,
                connectionStatusText: null,
                connectionStatusDot: null,
                speedBarContainer: null,
                speedBarFill: null,
                speedBarStatus: null,
                waitingRoom: null,
                playerList: null,
                startBtn: null,
                mobileControls: null,

                // Race HUD
                checkpointProgress: null,
                checkpointText: null,
                timerDisplay: null,
                timerValue: null,
                countdownOverlay: null,
                countdownNumber: null,
                finishOverlay: null,
                finishTitle: null,
                finishResults: null,
                playAgainBtn: null,
                racePosition: null,
                positionNumber: null,
            };

            // Face
            this.faceFactory = new FaceFactory();

            // Textures
            this.textureGen = new TextureGenerator();

            // Local player
            this.localPlayerId = null;

            // Tracks if host started race. For core engine, we keep free-roam always-on.
            this.raceStarted = false;

            // Map (optional)
            this.mapConfig = null;

            // Map-driven cap (do not mutate RB_CONFIG)
            this.maxPlayers = RB_CONFIG.MAX_PLAYERS;

            // Physics materials (set in _initPhysics)
            this._physicsMaterials = {
                ground: null,
                ball: null,
            };

            // World from map
            this._world = {
                groundSegments: [],
                checkpoints: [],
                finish: null,
                pickups: [],
                pickupState: new Map(), // id -> {active:boolean, respawnAtMs:number|null}
                dizzyObstacles: [], // special obstacles that disable control
            };

            // Race state
            this._race = {
                state: 'lobby', // lobby | countdown | racing | finished
                raceStartAtMs: null,
                countdownStartAtMs: null,
                winnerId: null,
            };
        }

        async onInitialize() {
            this._bindUI();

            // Setup renderer + scene
            this._initThree();
            this._initPhysics();

            // Input
            this.input.attach(document.getElementById('gameContainer'));

            // Don't show waiting room yet - wait until user connects via connection modal
            this._showWaitingRoom(false);

            // Load map and build world
            await this._tryLoadMap();
            this._applyMapConfigToConstants();
            this._buildWorldFromMap();

            // Initialize connection modal (embedded) - this shows the join panel
            this._initConnectionModal();

            // Init ShareModal if present
            if (typeof ShareModal !== 'undefined' && typeof ShareModal.init === 'function') {
                ShareModal.init();
            }

            // Mobile controls visibility
            this._updateMobileControlsVisibility();
            window.addEventListener('resize', () => this._updateMobileControlsVisibility());
        }

        _bindUI() {
            this._ui.shareBtn = document.getElementById('shareBtn');
            this._ui.playerCountValue = document.getElementById('playerCountValue');
            this._ui.connectionStatusText = document.getElementById('statusText');
            this._ui.connectionStatusDot = document.getElementById('statusDot');
            this._ui.speedBarContainer = document.getElementById('speedBarContainer');
            this._ui.speedBarFill = document.getElementById('speedBarFill');
            this._ui.speedBarStatus = document.getElementById('speedBarStatus');
            this._ui.waitingRoom = document.getElementById('waitingRoom');
            this._ui.controlPanel = document.getElementById('controlPanel');
            this._ui.playersList = document.getElementById('playersList');
            this._ui.gameMessage = document.getElementById('gameMessage');
            this._ui.startBtn = document.getElementById('startBtn');
            this._ui.mobileControls = document.getElementById('mobileControls');

            // Race HUD
            this._ui.checkpointProgress = document.getElementById('checkpointProgress');
            this._ui.checkpointText = document.getElementById('checkpointText');
            this._ui.timerDisplay = document.getElementById('timerDisplay');
            this._ui.timerValue = document.getElementById('timerValue');
            this._ui.countdownOverlay = document.getElementById('countdownOverlay');
            this._ui.countdownNumber = document.getElementById('countdownNumber');
            this._ui.finishOverlay = document.getElementById('finishOverlay');
            this._ui.finishTitle = document.getElementById('finishTitle');
            this._ui.finishResults = document.getElementById('finishResults');
            this._ui.playAgainBtn = document.getElementById('playAgainBtn');
            this._ui.racePosition = document.getElementById('racePosition');
            this._ui.positionNumber = document.getElementById('positionNumber');
        }

        _applyMapConfigToConstants() {
            // Map settings are applied in _initPhysics / _buildWorldFromMap where safe.
            // RB_CONFIG is treated as a constant; do not mutate it here.
            return;
        }

        async _tryLoadMap() {
            try {
                // Allow selecting a map file without code changes:
                //   race-balls/?map=map-default.json
                //   race-balls/?map=maps/track-02.json
                const params = new URLSearchParams(window.location.search || '');
                const mapParam = (params.get('map') || '').trim();
                const mapUrl = mapParam || 'map-default.json';

                if (typeof RaceMapSystem?.loadRaceMapConfig === 'function') {
                    this.mapConfig = await RaceMapSystem.loadRaceMapConfig({ url: mapUrl });
                } else {
                    // Fallback (shouldn't happen if index.html includes map-system.js)
                    const resp = await fetch(mapUrl);
                    if (!resp.ok) return;
                    this.mapConfig = await resp.json();
                }

                // Apply map metadata-driven player cap if present.
                const maxPlayers = Number(this.mapConfig?.metadata?.maxPlayers);
                if (Number.isFinite(maxPlayers) && maxPlayers > 0) {
                    this.maxPlayers = Math.min(Math.max(1, Math.floor(maxPlayers)), 64);
                }
            } catch (e) {
                console.warn('Failed to load or validate map config:', e);
                MiniGameUtils?.showToast?.('Failed to load map; using built-in defaults', 'warning');
                // Keep running with built-in arena if map fails
                this.mapConfig = null;
                this.maxPlayers = RB_CONFIG.MAX_PLAYERS;
            }
        }

        _buildWorldFromMap() {
            if (!this.mapConfig) return;

            // Clear prior world extras (leave base arena meshes if already created)
            this._world.groundSegments = [];
            this._world.checkpoints = [];
            this._world.finish = null;
            this._world.pickups = [];
            this._world.pickupState.clear();

            // Build friction materials
            const frictionTypes = this.mapConfig.frictionTypes || {};
            this._physicsMaterials.groundByType = new Map();

            const ensureGroundMaterial = (typeKey) => {
                if (this._physicsMaterials.groundByType.has(typeKey)) return this._physicsMaterials.groundByType.get(typeKey);
                const mat = new CANNON.Material('ground-' + typeKey);
                this._physicsMaterials.groundByType.set(typeKey, mat);

                const info = frictionTypes[typeKey] || frictionTypes.normal || { friction: 0.5, restitution: 0.2 };
                const cm = new CANNON.ContactMaterial(mat, this._physicsMaterials.ball, {
                    friction: clamp(Number(info.friction ?? 0.5), 0, 2),
                    restitution: clamp(Number(info.restitution ?? 0.2), 0, 2),
                });
                this.world.addContactMaterial(cm);
                return mat;
            };

            // Add large flat ground plane at y=0 as base surface
            const arenaSize = RB_CONFIG.ARENA_SIZE || 60;
            const baseGroundMat = ensureGroundMaterial('normal');
            this._addStaticBox(
                { x: 0, y: -0.5, z: 0 },
                { width: arenaSize * 2, height: 1, depth: arenaSize * 2 },
                '#1e293b', // dark slate
                baseGroundMat
            );

            // Ground segments
            const segments = this.mapConfig.track?.groundSegments || [];
            for (const seg of segments) {
                const pos = seg.position || { x: 0, y: 0, z: 0 };
                const size = seg.size || { width: 10, height: 1, depth: 10 };
                const rot = seg.rotation || { x: 0, y: 0, z: 0 };
                const type = seg.frictionType || 'normal';
                const groundMat = ensureGroundMaterial(type);
                const frictionInfo = frictionTypes[type] || {};
                const color = frictionInfo.color || '#4a5568';
                const textureType = frictionInfo.texture || type;

                // Physics box (static) - positioned at y=0 (ground level)
                const shape = new CANNON.Box(new CANNON.Vec3(size.width / 2, size.height / 2, size.depth / 2));
                const body = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, material: groundMat });
                body.addShape(shape);
                body.position.set(pos.x, pos.y, pos.z);
                body.quaternion.setFromEuler(rot.x || 0, rot.y || 0, rot.z || 0);
                this.world.addBody(body);

                // Three mesh with texture
                const texture = this.textureGen.getTexture(textureType, color);
                const matOptions = {
                    color: new THREE.Color(color),
                    roughness: 0.8,
                    metalness: 0.0
                };
                if (texture) {
                    matOptions.map = texture;
                    matOptions.color = new THREE.Color('#ffffff'); // Use texture color
                }

                const mesh = new THREE.Mesh(
                    new THREE.BoxGeometry(size.width, size.height, size.depth),
                    new THREE.MeshStandardMaterial(matOptions)
                );
                mesh.position.set(pos.x, pos.y, pos.z);
                mesh.rotation.set(rot.x || 0, rot.y || 0, rot.z || 0);
                mesh.receiveShadow = true;
                this.scene.add(mesh);

                this._world.groundSegments.push({ id: seg.id, type, body, mesh });
            }

            // Add boundary walls around the entire arena to prevent falling
            this._addArenaWalls();

            // Static walls from map (rotation + optional physics overrides)
            const walls = this.mapConfig.walls || [];
            for (const w of walls) {
                const pos = w.position || { x: 0, y: 0, z: 0 };
                const size = w.size || { width: 1, height: 3, depth: 5 };
                const rot = w.rotation || { x: 0, y: 0, z: 0 };
                const color = w.color || '#2d3748';
                const textureType = w.texture || 'wall';

                const matKey = w.physics?.frictionType || 'normal';
                const mat = ensureGroundMaterial(matKey);
                const { body } = this._addStaticBox(pos, size, color, mat, textureType);
                body.quaternion.setFromEuler(rot.x || 0, rot.y || 0, rot.z || 0);
            }

            // Obstacles (rotation + optional physics overrides)
            const obstacles = this.mapConfig.obstacles || [];
            for (const o of obstacles) {
                const pos = o.position || { x: 0, y: 0, z: 0 };
                const size = o.size || { width: 1, height: 2, depth: 1 };
                const rot = o.rotation || { x: 0, y: 0, z: 0 };
                const color = o.color || '#718096';
                const textureType = o.texture || 'crate';

                const matKey = o.physics?.frictionType || 'normal';
                const mat = ensureGroundMaterial(matKey);
                const { body } = this._addStaticBox(pos, size, color, mat, textureType);
                body.quaternion.setFromEuler(rot.x || 0, rot.y || 0, rot.z || 0);

                // If restitution override is provided, add a dedicated contact material.
                if (typeof o.physics?.restitution === 'number') {
                    const cm = new CANNON.ContactMaterial(mat, this._physicsMaterials.ball, {
                        friction: clamp(Number(o.physics?.friction ?? frictionTypes[matKey]?.friction ?? 0.5), 0, 2),
                        restitution: clamp(Number(o.physics.restitution), 0, 2),
                    });
                    this.world.addContactMaterial(cm);
                }
            }

            // Bounce elements (high restitution). Supports both map.bounceElements and legacy map.bouncers.
            const bounceEls = this.mapConfig.bounceElements || this.mapConfig.bouncers || [];
            for (const b of bounceEls) {
                const pos = b.position || { x: 0, y: 0, z: 0 };
                const size = b.size || { width: 1, height: 1, depth: 1 };
                const rot = b.rotation || { x: 0, y: 0, z: 0 };
                const color = b.color || '#e53e3e';
                const textureType = b.texture || 'rubber';

                const rubberMat = ensureGroundMaterial('rubber');
                // Override restitution if present by adding a dedicated contact material
                if (typeof b.restitution === 'number') {
                    const cm = new CANNON.ContactMaterial(rubberMat, this._physicsMaterials.ball, {
                        friction: clamp(Number(this.mapConfig.frictionTypes?.rubber?.friction ?? 0.8), 0, 2),
                        restitution: clamp(Number(b.restitution), 0, 2),
                    });
                    this.world.addContactMaterial(cm);
                }

                const { body } = this._addStaticBox(pos, size, color, rubberMat, textureType);
                body.quaternion.setFromEuler(rot.x || 0, rot.y || 0, rot.z || 0);
            }

            // Dizzy Obstacles (disable control on touch)
            const dizzyObs = this.mapConfig.dizzyObstacles || [];
            for (const d of dizzyObs) {
                const pos = d.position || { x: 0, y: 0, z: 0 };
                const size = d.size || { width: 1, height: 2, depth: 1 };
                const rot = d.rotation || { x: 0, y: 0, z: 0 };
                const color = d.color || '#a855f7'; // purple
                const dizzyDurationSeconds = Number(d.dizzyDurationSeconds ?? 3);
                const textureType = d.texture || 'dizzy';

                const matKey = d.physics?.frictionType || 'normal';
                const mat = ensureGroundMaterial(matKey);
                const { body, mesh } = this._addStaticBox(pos, size, color, mat, textureType);
                body.quaternion.setFromEuler(rot.x || 0, rot.y || 0, rot.z || 0);

                // Add pulsing emissive effect to indicate special obstacle
                if (mesh.material) {
                    mesh.material.emissive = new THREE.Color(color);
                    mesh.material.emissiveIntensity = 0.3;
                }

                this._world.dizzyObstacles.push({
                    id: d.id,
                    body,
                    mesh,
                    dizzyDurationSeconds
                });
            }

            // Checkpoints (visual rings - small arch gates)
            const cps = (this.mapConfig.checkpoints || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
            for (const cp of cps) {
                const pos = cp.position || { x: 0, y: 0, z: 0 };
                const radius = Number(cp.radius || 3);

                // Create arch/gate checkpoint (two posts + top bar)
                const postHeight = 4;
                const postWidth = 0.3;
                const gateWidth = radius * 1.5; // Width of gate opening

                // Left post
                const leftPost = new THREE.Mesh(
                    new THREE.BoxGeometry(postWidth, postHeight, postWidth),
                    new THREE.MeshStandardMaterial({ color: new THREE.Color('#9f7aea'), emissive: new THREE.Color('#4c1d95'), emissiveIntensity: 0.4 })
                );
                leftPost.position.set(pos.x - gateWidth / 2, pos.y + postHeight / 2, pos.z);
                this.scene.add(leftPost);

                // Right post
                const rightPost = new THREE.Mesh(
                    new THREE.BoxGeometry(postWidth, postHeight, postWidth),
                    new THREE.MeshStandardMaterial({ color: new THREE.Color('#9f7aea'), emissive: new THREE.Color('#4c1d95'), emissiveIntensity: 0.4 })
                );
                rightPost.position.set(pos.x + gateWidth / 2, pos.y + postHeight / 2, pos.z);
                this.scene.add(rightPost);

                // Top bar
                const topBar = new THREE.Mesh(
                    new THREE.BoxGeometry(gateWidth + postWidth, postWidth, postWidth),
                    new THREE.MeshStandardMaterial({ color: new THREE.Color('#9f7aea'), emissive: new THREE.Color('#4c1d95'), emissiveIntensity: 0.4 })
                );
                topBar.position.set(pos.x, pos.y + postHeight, pos.z);
                this.scene.add(topBar);

                this._world.checkpoints.push({ id: cp.id, order: cp.order ?? 0, x: pos.x, y: pos.y, z: pos.z, radius, meshes: [leftPost, rightPost, topBar] });
            }

            // Finish line (proper checkered flag style)
            const fin = this.mapConfig.finishLine;
            if (fin) {
                const pos = fin.position || { x: 0, y: 2, z: -220 };
                const radius = Number(fin.radius || 5);
                const required = Number(fin.requiredCheckpoints || cps.length);
                const gateWidth = 18; // Wide finish gate
                const postHeight = 6;
                const postWidth = 0.5;

                // Create finish line posts (gold/yellow)
                const finishMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#fbbf24'), emissive: new THREE.Color('#f59e0b'), emissiveIntensity: 0.5 });

                // Left post
                const leftPost = new THREE.Mesh(
                    new THREE.BoxGeometry(postWidth, postHeight, postWidth),
                    finishMat
                );
                leftPost.position.set(pos.x - gateWidth / 2, pos.y + postHeight / 2 - 2, pos.z);
                this.scene.add(leftPost);

                // Right post
                const rightPost = new THREE.Mesh(
                    new THREE.BoxGeometry(postWidth, postHeight, postWidth),
                    finishMat
                );
                rightPost.position.set(pos.x + gateWidth / 2, pos.y + postHeight / 2 - 2, pos.z);
                this.scene.add(rightPost);

                // Top bar
                const topBar = new THREE.Mesh(
                    new THREE.BoxGeometry(gateWidth + postWidth, postWidth * 1.5, postWidth),
                    finishMat
                );
                topBar.position.set(pos.x, pos.y + postHeight - 2, pos.z);
                this.scene.add(topBar);

                // Checkered banner
                const bannerCanvas = document.createElement('canvas');
                bannerCanvas.width = 256;
                bannerCanvas.height = 64;
                const ctx = bannerCanvas.getContext('2d');
                const squareSize = 16;
                for (let y = 0; y < bannerCanvas.height; y += squareSize) {
                    for (let x = 0; x < bannerCanvas.width; x += squareSize) {
                        ctx.fillStyle = ((x / squareSize + y / squareSize) % 2 === 0) ? '#ffffff' : '#000000';
                        ctx.fillRect(x, y, squareSize, squareSize);
                    }
                }
                const bannerTex = new THREE.CanvasTexture(bannerCanvas);
                bannerTex.wrapS = THREE.RepeatWrapping;
                bannerTex.wrapT = THREE.RepeatWrapping;

                const banner = new THREE.Mesh(
                    new THREE.PlaneGeometry(gateWidth, 2),
                    new THREE.MeshStandardMaterial({ map: bannerTex, side: THREE.DoubleSide })
                );
                banner.position.set(pos.x, pos.y + postHeight - 3, pos.z + 0.1);
                this.scene.add(banner);

                // Ground finish line (checkered stripe on ground)
                const groundLine = new THREE.Mesh(
                    new THREE.PlaneGeometry(gateWidth, 2),
                    new THREE.MeshStandardMaterial({ map: bannerTex, side: THREE.DoubleSide })
                );
                groundLine.rotation.x = -Math.PI / 2;
                groundLine.position.set(pos.x, 0.05, pos.z);
                this.scene.add(groundLine);

                // "FINISH" text banner
                const textCanvas = document.createElement('canvas');
                textCanvas.width = 512;
                textCanvas.height = 128;
                const tctx = textCanvas.getContext('2d');
                tctx.fillStyle = '#1a1a2e';
                tctx.fillRect(0, 0, 512, 128);
                tctx.fillStyle = '#fbbf24';
                tctx.font = 'bold 72px Arial';
                tctx.textAlign = 'center';
                tctx.textBaseline = 'middle';
                tctx.fillText('FINISH', 256, 64);
                const textTex = new THREE.CanvasTexture(textCanvas);

                const textBanner = new THREE.Mesh(
                    new THREE.PlaneGeometry(gateWidth * 0.8, 2),
                    new THREE.MeshStandardMaterial({ map: textTex, transparent: true, side: THREE.DoubleSide })
                );
                textBanner.position.set(pos.x, pos.y + postHeight - 0.5, pos.z - 0.1);
                this.scene.add(textBanner);

                this._world.finish = { x: pos.x, y: pos.y, z: pos.z, radius, requiredCheckpoints: required, meshes: [leftPost, rightPost, topBar, banner, groundLine, textBanner] };
            }

            // Starting line (similar to finish line but green/white)
            const spawns = this.mapConfig.spawns || [];
            if (spawns.length > 0) {
                // Calculate average z position of spawns
                const avgZ = spawns.reduce((sum, s) => sum + (s.z || 0), 0) / spawns.length;
                const startLineZ = avgZ - 1; // Place 1 unit behind spawn points
                const startWidth = 16;
                const postHeight = 4;
                const postWidth = 0.4;

                // Create checkered pattern for start line (green/white)
                const startCanvas = document.createElement('canvas');
                startCanvas.width = 256;
                startCanvas.height = 32;
                const sctx = startCanvas.getContext('2d');
                const checkSize = 32;
                for (let x = 0; x < 256; x += checkSize) {
                    sctx.fillStyle = (x / checkSize) % 2 === 0 ? '#22c55e' : '#ffffff';
                    sctx.fillRect(x, 0, checkSize, 32);
                }
                const startTex = new THREE.CanvasTexture(startCanvas);
                startTex.wrapS = THREE.RepeatWrapping;
                startTex.repeat.x = 4;

                // Left post (green)
                const startLeftPost = new THREE.Mesh(
                    new THREE.BoxGeometry(postWidth, postHeight, postWidth),
                    new THREE.MeshStandardMaterial({ color: new THREE.Color('#22c55e'), emissive: new THREE.Color('#16a34a'), emissiveIntensity: 0.5 })
                );
                startLeftPost.position.set(-startWidth / 2, postHeight / 2, startLineZ);
                this.scene.add(startLeftPost);

                // Right post (green)
                const startRightPost = new THREE.Mesh(
                    new THREE.BoxGeometry(postWidth, postHeight, postWidth),
                    new THREE.MeshStandardMaterial({ color: new THREE.Color('#22c55e'), emissive: new THREE.Color('#16a34a'), emissiveIntensity: 0.5 })
                );
                startRightPost.position.set(startWidth / 2, postHeight / 2, startLineZ);
                this.scene.add(startRightPost);

                // Top bar (green)
                const startTopBar = new THREE.Mesh(
                    new THREE.BoxGeometry(startWidth + postWidth, postWidth, postWidth),
                    new THREE.MeshStandardMaterial({ color: new THREE.Color('#22c55e'), emissive: new THREE.Color('#16a34a'), emissiveIntensity: 0.5 })
                );
                startTopBar.position.set(0, postHeight, startLineZ);
                this.scene.add(startTopBar);

                // Ground start line (checkered on ground)
                const startGroundLine = new THREE.Mesh(
                    new THREE.PlaneGeometry(startWidth, 1.5),
                    new THREE.MeshStandardMaterial({ map: startTex, side: THREE.DoubleSide })
                );
                startGroundLine.rotation.x = -Math.PI / 2;
                startGroundLine.position.set(0, 0.05, startLineZ);
                this.scene.add(startGroundLine);

                // "START" text banner
                const startTextCanvas = document.createElement('canvas');
                startTextCanvas.width = 512;
                startTextCanvas.height = 128;
                const stctx = startTextCanvas.getContext('2d');
                stctx.fillStyle = '#1a1a2e';
                stctx.fillRect(0, 0, 512, 128);
                stctx.fillStyle = '#22c55e';
                stctx.font = 'bold 72px Arial';
                stctx.textAlign = 'center';
                stctx.textBaseline = 'middle';
                stctx.fillText('START', 256, 64);
                const startTextTex = new THREE.CanvasTexture(startTextCanvas);

                const startTextBanner = new THREE.Mesh(
                    new THREE.PlaneGeometry(startWidth * 0.6, 1.5),
                    new THREE.MeshStandardMaterial({ map: startTextTex, transparent: true, side: THREE.DoubleSide })
                );
                startTextBanner.position.set(0, postHeight - 0.5, startLineZ - 0.1);
                this.scene.add(startTextBanner);
            }

            // Pickups
            const pickups = this.mapConfig.pickups || [];
            for (const pu of pickups) {
                const pos = pu.position || { x: 0, y: 1.5, z: 0 };
                const radius = Number(pu.radius || 0.5);
                const restore = Number(pu.staminaRestoreAmount ?? pu.restoreAmount ?? 20);
                const respawnSeconds = (pu.respawnSeconds == null) ? RB_CONFIG.DEFAULT_PICKUP_RESPAWN_SECONDS : Number(pu.respawnSeconds);
                const color = pu.color || '#48bb78';

                const mesh = new THREE.Mesh(
                    new THREE.SphereGeometry(radius, 16, 16),
                    new THREE.MeshStandardMaterial({ color: new THREE.Color(color), emissive: new THREE.Color(color), emissiveIntensity: 0.3, roughness: 0.35, metalness: 0.0 })
                );
                mesh.position.set(pos.x, pos.y, pos.z);
                this.scene.add(mesh);

                const pickup = { id: pu.id, x: pos.x, y: pos.y, z: pos.z, radius, restoreAmount: restore, respawnSeconds, mesh };
                this._world.pickups.push(pickup);
                this._world.pickupState.set(pu.id, { active: true, respawnAtMs: null });
            }
        }

        _addStaticBox(position, size, color, material, textureType) {
            const pos = position || { x: 0, y: 0, z: 0 };
            const sz = size || { width: 1, height: 1, depth: 1 };
            const shape = new CANNON.Box(new CANNON.Vec3(sz.width / 2, sz.height / 2, sz.depth / 2));
            const body = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, material: material || this._physicsMaterials.ground });
            body.addShape(shape);
            body.position.set(pos.x, pos.y, pos.z);
            this.world.addBody(body);

            // Create material with optional texture
            const matOptions = {
                color: new THREE.Color(color || '#718096'),
                roughness: 0.85,
                metalness: 0.0
            };

            if (textureType && this.textureGen) {
                const texture = this.textureGen.getTexture(textureType, color);
                if (texture) {
                    matOptions.map = texture;
                }
            }

            const mesh = new THREE.Mesh(
                new THREE.BoxGeometry(sz.width, sz.height, sz.depth),
                new THREE.MeshStandardMaterial(matOptions)
            );
            mesh.position.set(pos.x, pos.y, pos.z);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            this.scene.add(mesh);
            return { body, mesh };
        }

        _addArenaWalls() {
            // Add boundary walls aligned with the track
            // Track: 20m wide, ~240m long (z=0 to z=-230)
            const trackWidth = 20;
            const trackLength = 240;
            const trackStartZ = 10; // Slightly behind start
            const trackEndZ = -230;
            const wallHeight = RB_CONFIG.WALL_HEIGHT || 8;
            const wallThickness = RB_CONFIG.WALL_THICKNESS || 2;
            const wallColor = '#1a2332'; // Dark blue-gray

            const mat = this._physicsMaterials.ground;

            // Left wall (negative X) - runs along entire track
            this._addStaticBox(
                { x: -(trackWidth / 2 + wallThickness / 2), y: wallHeight / 2, z: (trackStartZ + trackEndZ) / 2 },
                { width: wallThickness, height: wallHeight, depth: trackLength + 20 },
                wallColor,
                mat
            );

            // Right wall (positive X) - runs along entire track
            this._addStaticBox(
                { x: (trackWidth / 2 + wallThickness / 2), y: wallHeight / 2, z: (trackStartZ + trackEndZ) / 2 },
                { width: wallThickness, height: wallHeight, depth: trackLength + 20 },
                wallColor,
                mat
            );

            // Start wall (positive Z) - behind start line
            this._addStaticBox(
                { x: 0, y: wallHeight / 2, z: trackStartZ + wallThickness / 2 },
                { width: trackWidth + wallThickness * 2, height: wallHeight, depth: wallThickness },
                wallColor,
                mat
            );

            // Finish wall (negative Z) - past finish line
            this._addStaticBox(
                { x: 0, y: wallHeight / 2, z: trackEndZ - wallThickness / 2 },
                { width: trackWidth + wallThickness * 2, height: wallHeight, depth: wallThickness },
                wallColor,
                mat
            );
        }

        // ----------------------------
        // AgentSessionBase Lifecycle Hooks
        // ----------------------------

        onStart() {
            // Start render/physics loop
            this._lastFrameMs = nowMs();
            this._frame();
        }

        onConnect(info) {
            console.log('[RaceBalls] Connected:', info);
            this._setConnectionIndicator(true);

            // Set local player ID
            this.localPlayerId = this.username;

            // Create local player
            this._ensurePlayer(this.localPlayerId);

            // If host, broadcast player assignments
            if (this.isHost()) {
                this._broadcastPlayerAssignments();
                console.log('[RaceBalls] ✅ You are the HOST - Start button will be visible');
            } else {
                console.log('[RaceBalls] ⚠️ You are NOT the host - Start button will be hidden');
            }

            // Update URL with auth hash so link can be shared
            if (window.ShareModal && typeof ShareModal.updateUrlWithAuth === 'function') {
                ShareModal.updateUrlWithAuth({
                    channel: this.channelName,
                    password: this.channelPassword
                });
            }

            // Update UI - show control panel with player list
            console.log('[RaceBalls] Calling _updateLobbyUI() to show control panel...');
            this._updateLobbyUI();

            // FORCE show control panel after connecting (bypass any logic issues)
            if (this._ui.controlPanel) {
                this._ui.controlPanel.classList.remove('hidden');
                console.log('[RaceBalls] 🔧 FORCED control panel to show by removing hidden class');
            }

            // Show share button
            if (this._ui.shareBtn) {
                this._ui.shareBtn.style.display = '';
            }

            console.log('[RaceBalls] ✅ Connection complete! Check if control panel is visible above the 3D scene.');
        }

        onPlayerJoin(info) {
            console.log('[RaceBalls] Player joined:', info.agentName);

            // Show toast notification
            MiniGameUtils?.showToast?.(`✅ ${info.agentName} joined!`, 'success');

            // Create player model for new peer
            this._ensurePlayer(info.agentName);

            // If host, send current state and assignments
            if (this.isHost()) {
                this._broadcastPlayerAssignments();
                this._sendSnapshot(info.agentName);

                // If game is in progress, send current race state
                if (this._race.state !== 'lobby') {
                    this.sendData({
                        type: 'race-state',
                        state: this._race.state,
                        raceStartAtMs: this._race.raceStartAtMs,
                        winnerId: this._race.winnerId
                    }, info.agentName);
                }
            }

            this._updateLobbyUI();
        }

        onPlayerLeave(info) {
            console.log('[RaceBalls] Player left:', info.agentName);

            // Show toast notification
            MiniGameUtils?.showToast?.(`${info.agentName} left`, 'info');

            this._removePlayer(info.agentName);
            this._updateLobbyUI();

            // If only one player remains during race, declare winner or end
            if (this.isHost() && this._race.state === 'racing' && this.players.size < 2) {
                const remaining = Array.from(this.players.keys())[0];
                if (remaining) {
                    this._declareWinner(remaining);
                }
            }
        }

        onDataChannelMessage(fromPeer, data) {
            // Route incoming messages by type
            if (!data || !data.type) return;

            switch (data.type) {
                case 'input':
                    this._handleInputFromClient(fromPeer, data);
                    break;
                case 'snapshot':
                    this._handleSnapshotFromHost(data);
                    break;
                case 'player-assignments':
                    this._handlePlayerAssignments(data);
                    break;
                case 'race-countdown':
                    this._handleRaceCountdown(data);
                    break;
                case 'race-go':
                    this._handleRaceGo(data);
                    break;
                case 'race-winner':
                    this._handleRaceWinner(data);
                    break;
                case 'race-reset':
                    this._handleRaceReset();
                    break;
                case 'race-state':
                    this._handleRaceState(data);
                    break;
                case 'pickup-state':
                    this._handlePickupState(data);
                    break;
            }
        }

        onDataChannelOpen(peerId) {
            console.log('[RaceBalls] DataChannel open with:', peerId);
            this._connectedPeers.add(peerId);
            this._updateLobbyUI();

            // If host, send current state to newly connected peer
            if (this.isHost()) {
                this._broadcastPlayerAssignments();
                this._sendSnapshot(peerId);

                // Send race state if not in lobby
                if (this._race.state !== 'lobby') {
                    this.sendData({
                        type: 'race-state',
                        state: this._race.state,
                        raceStartAtMs: this._race.raceStartAtMs,
                        winnerId: this._race.winnerId
                    }, peerId);
                }
            }
        }

        onDataChannelClose(peerId) {
            console.log('[RaceBalls] DataChannel closed with:', peerId);
            this._connectedPeers.delete(peerId);
            this._updateLobbyUI();
        }

        // ----------------------------
        // Player Management
        // ----------------------------

        _ensurePlayer(playerId) {
            if (this.players.has(playerId)) return;
            if (this.players.size >= (this.maxPlayers || RB_CONFIG.MAX_PLAYERS)) return;

            if (!this.playerOrder.includes(playerId)) this.playerOrder.push(playerId);
            const idx = this.playerOrder.indexOf(playerId);
            const colorHex = RB_CONFIG.PLAYER_COLORS[clamp(idx, 0, RB_CONFIG.PLAYER_COLORS.length - 1)];

            const p = new PlayerModel(playerId, colorHex);
            this.players.set(playerId, p);
            this._spawnPlayerAtMapSpawn(p);
        }

        _spawnPlayerAtMapSpawn(p) {
            // Create player body/mesh
            this._spawnPlayer(p);

            const spawns = this.mapConfig?.spawns || [];
            const idx = this.playerOrder.indexOf(p.playerId);
            const s = spawns[idx] || spawns[idx % spawns.length] || { x: -3 + idx * 2, y: 2, z: 2 };

            // Support both new format {position:{x,y,z}} and legacy {x,y,z}
            const pos = s.position || s;

            if (p.body) {
                p.body.position.set(pos.x, pos.y, pos.z);
                p.body.velocity.set(0, 0, 0);
                p.body.angularVelocity.set(0, 0, 0);

                // Apply map-driven damping defaults if present
                p.body.linearDamping = Number(this.mapConfig?.physicsDefaults?.linearDamping ?? RB_CONFIG.BALL_LINEAR_DAMPING);
                p.body.angularDamping = Number(this.mapConfig?.physicsDefaults?.angularDamping ?? RB_CONFIG.BALL_ANGULAR_DAMPING);
            }
        }

        _removePlayer(playerId) {
            const p = this.players.get(playerId);
            if (p) {
                if (p.body) this.world.removeBody(p.body);
                if (p.mesh) this.scene.remove(p.mesh);
            }
            this.players.delete(playerId);
            const idx = this.playerOrder.indexOf(playerId);
            if (idx >= 0) this.playerOrder.splice(idx, 1);
        }

        _broadcastPlayerAssignments() {
            const assignments = [];
            for (const [id, p] of this.players.entries()) {
                assignments.push({ playerId: id, colorHex: p.colorHex });
            }
            this.sendData({ type: 'player-assignments', playerOrder: this.playerOrder, assignments });
        }

        _handlePlayerAssignments(data) {
            const order = Array.isArray(data.playerOrder) ? data.playerOrder : [];
            const assignments = Array.isArray(data.assignments) ? data.assignments : [];

            // Update player order
            this.playerOrder = order.slice();

            // Create/update players from assignments
            for (const a of assignments) {
                if (!a.playerId) continue;
                if (!this.players.has(a.playerId)) {
                    const p = new PlayerModel(a.playerId, a.colorHex || '#888888');
                    this.players.set(a.playerId, p);
                    this._spawnPlayerAtMapSpawn(p);
                }
            }

            this._updateLobbyUI();
        }

        _handleInputFromClient(fromPeer, data) {
            if (!this.isHost()) return;
            const p = this.players.get(fromPeer);
            if (!p) return;

            p.input.moveX = Number(data.moveX ?? 0);
            p.input.moveY = Number(data.moveY ?? 0);
            p.input.boost = !!data.boost;
            if (data.jumpEdge) p.input.jumpEdge = true;
            p.input.seq = Number(data.seq ?? 0);
        }

        // ----------------------------
        // Input Networking
        // ----------------------------

        _sendLocalInputToHost() {
            const me = this.players.get(this.localPlayerId);
            if (!me) return;


            this.sendData({
                type: 'input',
                moveX: me.input.moveX,
                moveY: me.input.moveY,
                boost: me.input.boost,
                jumpEdge: me.input.jumpEdge,
                seq: ++me.input.seq,
            });

            me.input.jumpEdge = false;
        }

        // ----------------------------
        // UI Methods
        // ----------------------------

        _showWaitingRoom(show) {
            if (this._ui.waitingRoom) {
                this._ui.waitingRoom.classList.toggle('hidden', !show);
            }
        }

        _updateLobbyUI() {
            // Update player count
            if (this._ui.playerCountValue) {
                this._ui.playerCountValue.textContent = String(this.players.size);
            }

            // Update player list with connection status (like air-hockey)
            if (this._ui.playersList) {
                this._ui.playersList.innerHTML = '';
                for (const [id, p] of this.players.entries()) {
                    const isMe = id === this.localPlayerId;
                    const isConnected = isMe || this._connectedPeers?.has(id);

                    const div = document.createElement('div');
                    div.className = 'player-item';
                    if (isMe) div.classList.add('local');

                    div.innerHTML = `
                        <span class="player-color" style="background:${p.colorHex}"></span>
                        <span class="player-name">${id}${isMe ? ' (You)' : ''}</span>
                        <span class="player-status">${!isMe ? (isConnected ? '🔗' : '⏳') : ''}</span>
                    `;
                    this._ui.playersList.appendChild(div);
                }
            }

            // Update game message
            this._updateGameMessage();

            // Show/hide start button (host only)
            if (this._ui.startBtn) {
                const shouldShow = this.isHost();
                this._ui.startBtn.classList.toggle('hidden', !shouldShow);
            }

            // Show/hide control panel based on race state
            const inLobby = this._race.state === 'lobby';
            if (this._ui.controlPanel) {
                const shouldShowPanel = inLobby && this.connected;
                this._ui.controlPanel.classList.toggle('hidden', !shouldShowPanel);
            }

            // Show/hide speed bar (only during race)
            if (this._ui.speedBarContainer) {
                this._ui.speedBarContainer.classList.toggle('hidden', inLobby);
            }
        }

        _updateGameMessage() {
            const msgEl = this._ui.gameMessage;
            if (!msgEl) return;

            const playerCount = this.players.size;

            if (playerCount < 1) {
                msgEl.textContent = 'Waiting for players to join...';
            } else if (playerCount === 1) {
                msgEl.textContent = this.isHost()
                    ? 'Waiting for other players... (Share the link!)'
                    : 'Waiting for host...';
            } else {
                msgEl.textContent = this.isHost()
                    ? `${playerCount} players ready - Click Start Race!`
                    : 'Waiting for host to start the race...';
            }
        }

        _updateLocalUI() {
            const me = this.players.get(this.localPlayerId);
            if (!me) return;

            // Update speed bar
            if (this._ui.speedBarFill) {
                this._ui.speedBarFill.style.width = `${clamp(me.stamina, 0, 100)}%`;
            }
            if (this._ui.speedBarStatus) {
                if (me.isTired) {
                    this._ui.speedBarStatus.textContent = 'TIRED';
                    this._ui.speedBarStatus.classList.add('tired');
                } else if (me.input.boost && me.stamina > 0) {
                    this._ui.speedBarStatus.textContent = 'BOOST!';
                    this._ui.speedBarStatus.classList.remove('tired');
                } else {
                    this._ui.speedBarStatus.textContent = 'READY';
                    this._ui.speedBarStatus.classList.remove('tired');
                }
            }
        }

        // ----------------------------
        // Three.js Initialization
        // ----------------------------

        _initThree() {
            this.scene = new THREE.Scene();
            this.scene.background = new THREE.Color(this.mapConfig?.skybox?.color || '#0b1220');

            const ambientCfg = this.mapConfig?.lighting?.ambient;
            const dirCfg = this.mapConfig?.lighting?.directional;

            const ambient = new THREE.AmbientLight(
                new THREE.Color(ambientCfg?.color || '#404040'),
                Number(ambientCfg?.intensity ?? 0.5)
            );
            this.scene.add(ambient);

            const dir = new THREE.DirectionalLight(
                new THREE.Color(dirCfg?.color || '#ffffff'),
                Number(dirCfg?.intensity ?? 0.7)
            );
            const dp = dirCfg?.position || { x: 10, y: 18, z: 8 };
            dir.position.set(dp.x, dp.y, dp.z);
            this.scene.add(dir);

            this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / Math.max(window.innerHeight, 1), 0.1, 700);

            this.renderer = new THREE.WebGLRenderer({ antialias: true });
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
            this.renderer.setSize(window.innerWidth, window.innerHeight);

            const container = document.getElementById('gameContainer');
            if (container) container.appendChild(this.renderer.domElement);

            window.addEventListener('resize', () => {
                this.camera.aspect = window.innerWidth / Math.max(window.innerHeight, 1);
                this.camera.updateProjectionMatrix();
                this.renderer.setSize(window.innerWidth, window.innerHeight);
            });

            // Base ground for visual reference (map segments will add their own)
            const grid = new THREE.GridHelper(RB_CONFIG.ARENA_SIZE, 40, 0x233044, 0x1a2436);
            grid.position.y = 0.02;
            this.scene.add(grid);
        }

        // ----------------------------
        // Render Helpers
        // ----------------------------

        _syncMeshesFromBodies() {
            for (const p of this.players.values()) {
                if (p.body && p.mesh) {
                    p.mesh.position.copy(p.body.position);
                    p.mesh.quaternion.copy(p.body.quaternion);
                }
            }
        }

        _updateCamera() {
            const me = this.players.get(this.localPlayerId);
            if (!me || !me.body) {
                // Default camera position
                this.camera.position.set(0, 25, 35);
                this.camera.lookAt(0, 0, 0);
                return;
            }

            // Chase camera: behind and above player
            const targetPos = me.body.position;
            const camOffset = new THREE.Vector3(0, 12, 18);

            // Smooth follow
            const targetCamPos = new THREE.Vector3(
                targetPos.x + camOffset.x,
                targetPos.y + camOffset.y,
                targetPos.z + camOffset.z
            );

            this.camera.position.lerp(targetCamPos, 0.08);

            // Look at player
            const lookTarget = new THREE.Vector3(targetPos.x, targetPos.y + 1, targetPos.z);
            this.camera.lookAt(lookTarget);
        }

        _updateExpressions() {
            for (const p of this.players.values()) {
                if (!p.faceSprite) continue;
                const expr = p.getExpression();
                this.faceFactory.updateSprite(p.faceSprite, expr, p.colorHex);
            }
        }

        // ----------------------------
        // Movement / Physics
        // ----------------------------

        _applyMovementForPlayer(p, dt) {
            if (!p.body) return;

            // NO MOVEMENT IN LOBBY! Players must wait for race to start
            if (this._race.state === 'lobby') {
                return;
            }

            // No control when dizzy!
            if (p.isDizzy) {
                // Player can't control the ball, but physics still applies
                return;
            }

            const input = p.input;
            const mv = RB_CONFIG.movement;
            const speedCaps = this._getSpeedCaps();

            // Grounded check
            const groundThreshold = RB_CONFIG.GROUND_Y + RB_CONFIG.BALL_RADIUS + mv.groundedEpsilon;
            const grounded = p.body.position.y <= groundThreshold;
            if (grounded) p.lastGroundedAtMs = nowMs();
            const coyote = (nowMs() - p.lastGroundedAtMs) / 1000 < mv.coyoteTimeSeconds;

            // Boost / stamina logic
            const wantsBoost = input.boost && p.stamina > 0 && !p.isTired;

            if (wantsBoost) {
                p.stamina = Math.max(0, p.stamina - mv.drainRatePerSecond * dt);
                if (p.stamina <= 0) {
                    p.isTired = true;
                    p._rechargeStartMs = nowMs();
                }
            } else if (p.isTired) {
                // Recharging
                const elapsed = (nowMs() - (p._rechargeStartMs || nowMs())) / 1000;
                const progress = Math.min(1, elapsed / mv.rechargeDurationSeconds);
                p.stamina = progress * 100;
                if (progress >= 1) {
                    p.isTired = false;
                    p.stamina = 100;
                }
            } else if (!wantsBoost && p.stamina < 100) {
                // Passive recharge when not boosting
                const rechargeRate = 100 / mv.rechargeDurationSeconds;
                p.stamina = Math.min(100, p.stamina + rechargeRate * dt);
            }

            // Speed cap
            let maxSpeed = speedCaps.maxNormalSpeed;
            if (wantsBoost) maxSpeed = speedCaps.maxBoostSpeed;
            else if (p.isTired) maxSpeed = speedCaps.maxNormalSpeed * mv.tiredSpeedMultiplier;

            // Movement force
            const moveLen = Math.hypot(input.moveX, input.moveY);
            if (moveLen > 0.01) {
                const nx = input.moveX / moveLen;
                const ny = input.moveY / moveLen;

                // Convert 2D input to 3D world direction
                // moveX: -1 (left/A) to +1 (right/D) → X axis
                // moveY: -1 (back/S) to +1 (forward/W) → Z axis (inverted because forward is negative Z)
                const forceX = nx;  // Left/Right matches X axis
                const forceZ = -ny; // Forward (positive input.moveY) = negative Z


                const forceMag = wantsBoost ? mv.maxBoostForce : mv.maxMoveForce;
                const airMult = (grounded || coyote) ? 1 : mv.maxAirControlForceMultiplier;

                p.body.applyForce(
                    new CANNON.Vec3(forceX * forceMag * airMult, 0, forceZ * forceMag * airMult),
                    p.body.position
                );
            } else if (grounded) {
                // Braking when no input
                const vel = p.body.velocity;
                const speed = Math.hypot(vel.x, vel.z);
                if (speed > 0.1) {
                    const brakeForce = Math.min(speed, mv.brakingForce);
                    p.body.applyForce(
                        new CANNON.Vec3(-vel.x / speed * brakeForce, 0, -vel.z / speed * brakeForce),
                        p.body.position
                    );
                }
            }

            // Clamp horizontal speed
            const vel = p.body.velocity;
            const hSpeed = Math.hypot(vel.x, vel.z);
            if (hSpeed > maxSpeed) {
                // When over max speed (e.g., after boost ends), quickly slow down
                // Use a lerp factor for smooth deceleration instead of instant clamp
                const slowdownRate = wantsBoost ? 1.0 : 0.92; // 0.92 = gradual slowdown when not boosting
                const targetSpeed = wantsBoost ? hSpeed : Math.max(maxSpeed, hSpeed * slowdownRate);
                const scale = targetSpeed / hSpeed;
                p.body.velocity.x *= scale;
                p.body.velocity.z *= scale;
            }

            // Jump
            if (input.jumpEdge && (grounded || coyote)) {
                p.body.velocity.y = Math.max(p.body.velocity.y, 0);
                p.body.applyImpulse(new CANNON.Vec3(0, mv.maxJumpImpulse, 0), p.body.position);
                input.jumpEdge = false;
            }
        }


        // ----------------------------
        // Race state + countdown
        // ----------------------------

        hostStartRace() {
            if (!this.isHost()) return;
            if (this._race.state !== 'lobby' && this._race.state !== 'finished') return;

            console.log('[RaceBalls] 🏁 HOST STARTING RACE!');

            this._resetAllPlayersToSpawns();
            this._resetRaceProgress();

            this._race.state = 'countdown';
            this._race.countdownStartAtMs = Date.now() + 200;

            console.log('[RaceBalls] Race state changed to:', this._race.state);
            console.log('[RaceBalls] Sending race-countdown to all players...');

            this.sendData({ type: 'race-countdown', startAtMs: this._race.countdownStartAtMs, seconds: RB_CONFIG.COUNTDOWN_SECONDS });
            this._updateLobbyUI();

            console.log('[RaceBalls] ✅ Race countdown started! Control panel should hide, game world should be visible');
        }

        hostRestartRace() {
            if (!this.isHost()) return;
            this.sendData({ type: 'race-reset' });
            this._handleRaceReset();
        }

        _handleRaceCountdown(data) {
            this._race.state = 'countdown';
            this._race.countdownStartAtMs = Number(data.startAtMs || Date.now());
            this._race.raceStartAtMs = null;
            this._race.winnerId = null;
            this._showFinishOverlay(false);
            this._updateLobbyUI();
        }

        _handleRaceGo(data) {
            console.log('[RaceBalls] 🏁 RACE GO! Changing state from countdown to racing');
            this._race.state = 'racing';
            this._race.raceStartAtMs = Number(data.raceStartAtMs || Date.now());
            this._race.countdownStartAtMs = null;

            // FORCE hide countdown overlay
            this._showCountdown(false);

            this._updateLobbyUI();

            // Debug: Check scene state
            console.log('[RaceBalls] 🔍 DEBUG - Scene info:', {
                sceneChildCount: this.scene?.children?.length || 0,
                playerCount: this.players.size,
                hasRenderer: !!this.renderer,
                hasCamera: !!this.camera
            });

            // Debug: Check each player
            this.players.forEach((p, id) => {
                console.log(`[RaceBalls] Player ${id}:`, {
                    mesh: !!p.mesh,
                    visible: p.mesh?.visible,
                    body: !!p.body,
                    bodyY: p.body?.position?.y?.toFixed(1)
                });
            });

            console.log('[RaceBalls] ✅ Race started! State:', this._race.state);
        }

        _handleRaceWinner(data) {
            this._race.state = 'finished';
            this._race.winnerId = data.winnerId || null;
            this._race.raceStartAtMs = Number(data.raceStartAtMs || this._race.raceStartAtMs || Date.now());
            this._showFinishOverlay(true);
            this._renderFinishResults(data.results || []);
        }

        _handleRaceReset() {
            this._race.state = 'lobby';
            this._race.raceStartAtMs = null;
            this._race.countdownStartAtMs = null;
            this._race.winnerId = null;

            this._resetAllPlayersToSpawns();
            this._resetRaceProgress();
            this._showFinishOverlay(false);
            this._updateLobbyUI();

            // Reset pickups visibility
            for (const pu of this._world.pickups) {
                const st = this._world.pickupState.get(pu.id);
                if (st) {
                    st.active = true;
                    st.respawnAtMs = null;
                }
                if (pu.mesh) pu.mesh.visible = true;
            }
        }

        _handleRaceState(data) {
            // Sync race state for late-joining players
            if (data.state) {
                this._race.state = data.state;
            }
            if (data.raceStartAtMs) {
                this._race.raceStartAtMs = data.raceStartAtMs;
            }
            if (data.winnerId) {
                this._race.winnerId = data.winnerId;
                this._showFinishOverlay(true);
            }
            this._updateLobbyUI();
        }

        _resetRaceProgress() {
            for (const p of this.players.values()) {
                p.nextCheckpointIndex = 0;
                p.finished = false;
                p.finishTimeMs = null;
            }
        }

        _resetAllPlayersToSpawns() {
            const spawns = this.mapConfig?.spawns || [];
            console.log('[RaceBalls] 🔄 Resetting players to spawns. Total spawns:', spawns.length);

            let i = 0;
            for (const p of this.players.values()) {
                if (!p.body) {
                    console.warn('[RaceBalls] Player has no body:', p.playerId);
                    continue;
                }

                const s = spawns[i] || { x: -3 + i * 2, y: 2, z: 2 };

                // Validate spawn position
                const x = Number(s.x) || 0;
                const y = Number(s.y) || 2;
                const z = Number(s.z) || 0;

                console.log(`[RaceBalls] Setting ${p.playerId} spawn to (${x}, ${y}, ${z})`);

                p.body.position.set(x, y, z);
                p.body.velocity.set(0, 0, 0);
                p.body.angularVelocity.set(0, 0, 0);
                p.body.quaternion.set(0, 0, 0, 1); // Reset rotation
                p.stamina = 100;
                p.isTired = false;

                // Verify position was set correctly
                console.log(`[RaceBalls] ${p.playerId} body position after reset:`, {
                    x: p.body.position.x,
                    y: p.body.position.y,
                    z: p.body.position.z
                });

                i++;
            }
        }

        // ----------------------------
        // Pickups (host authoritative)
        // ----------------------------

        _handlePickupState(data) {
            const id = data.id;
            if (!id) return;
            const st = this._world.pickupState.get(id);
            if (!st) return;
            st.active = !!data.active;
            st.respawnAtMs = data.respawnAtMs ?? null;

            const pickup = this._world.pickups.find(p => p.id === id);
            if (pickup?.mesh) pickup.mesh.visible = st.active;
        }

        _hostUpdatePickups() {
            const now = Date.now();

            for (const pu of this._world.pickups) {
                const st = this._world.pickupState.get(pu.id);
                if (!st) continue;

                if (!st.active && st.respawnAtMs && now >= st.respawnAtMs) {
                    st.active = true;
                    st.respawnAtMs = null;
                    if (pu.mesh) pu.mesh.visible = true;
                    this.sendData({ type: 'pickup-state', id: pu.id, active: true, respawnAtMs: null });
                }

                if (!st.active) continue;

                for (const p of this.players.values()) {
                    if (!p.body) continue;
                    const d = Math.hypot(p.body.position.x - pu.x, p.body.position.y - pu.y, p.body.position.z - pu.z);
                    if (d <= (pu.radius + RB_CONFIG.BALL_RADIUS * 0.9)) {
                        p.stamina = clamp(p.stamina + pu.restoreAmount, 0, 100);
                        st.active = false;
                        st.respawnAtMs = now + Math.floor((pu.respawnSeconds || RB_CONFIG.DEFAULT_PICKUP_RESPAWN_SECONDS) * 1000);
                        if (pu.mesh) pu.mesh.visible = false;
                        this.sendData({ type: 'pickup-state', id: pu.id, active: false, respawnAtMs: st.respawnAtMs });
                        break;
                    }
                }
            }
        }

        // ----------------------------
        // Checkpoints + finish (host authoritative)
        // ----------------------------

        _hostUpdateRaceLogic() {
            if (!this.isHost()) return;
            if (this._race.state !== 'racing') return;
            if (this._race.winnerId) return;

            const now = Date.now();
            const cps = this._world.checkpoints;
            const fin = this._world.finish;

            for (const p of this.players.values()) {
                if (!p.body || p.finished) continue;

                // Update dizzy state
                if (p.isDizzy && now >= p.dizzyUntilMs) {
                    p.isDizzy = false;
                }

                // Check dizzy obstacle collisions
                for (const dobs of this._world.dizzyObstacles) {
                    if (!dobs.body || !dobs.dizzyDurationSeconds) continue;
                    const dx = p.body.position.x - dobs.body.position.x;
                    const dy = p.body.position.y - dobs.body.position.y;
                    const dz = p.body.position.z - dobs.body.position.z;
                    const dist = Math.hypot(dx, dy, dz);

                    // Simple AABB-sphere collision (rough approximation)
                    const threshold = RB_CONFIG.BALL_RADIUS + 1.5;
                    if (dist < threshold && !p.isDizzy) {
                        p.isDizzy = true;
                        p.dizzyUntilMs = now + Math.floor(dobs.dizzyDurationSeconds * 1000);
                    }
                }

                // ordered checkpoints
                const idx = clamp(p.nextCheckpointIndex, 0, cps.length);
                const next = cps[idx];
                if (next) {
                    const d = Math.hypot(p.body.position.x - next.x, p.body.position.y - next.y, p.body.position.z - next.z);
                    if (d <= next.radius) {
                        p.nextCheckpointIndex = idx + 1;
                    }
                }

                if (fin && p.nextCheckpointIndex >= fin.requiredCheckpoints) {
                    const dFin = Math.hypot(p.body.position.x - fin.x, p.body.position.y - fin.y, p.body.position.z - fin.z);
                    if (dFin <= fin.radius) {
                        this._declareWinner(p.playerId);
                        return;
                    }
                }
            }

            this._hostUpdatePickups();
        }

        _declareWinner(winnerId) {
            if (!this.isHost()) return;
            if (this._race.winnerId) return;

            this._race.winnerId = winnerId;
            this._race.state = 'finished';

            const results = [];
            const start = this._race.raceStartAtMs || Date.now();
            const end = Date.now();
            for (const p of this.players.values()) {
                const timeMs = (p.playerId === winnerId) ? (end - start) : 99999999;
                results.push({ playerId: p.playerId, timeMs, colorHex: p.colorHex });
                p.finished = p.playerId === winnerId;
                p.finishTimeMs = p.playerId === winnerId ? end : null;
            }

            this.sendData({ type: 'race-winner', winnerId, raceStartAtMs: start, results });
            this._handleRaceWinner({ winnerId, raceStartAtMs: start, results });
        }

        // ----------------------------
        // Snapshots
        // ----------------------------

        _sendSnapshot(toPlayer = null) {
            if (!this.isHost()) return;

            // Don't send if no peers are connected yet (data channels still connecting)
            if (!toPlayer && (!this._connectedPeers || this._connectedPeers.size === 0)) {
                return; // No peers connected yet, skip broadcast
            }

            const players = [];
            for (const [id, p] of this.players.entries()) {
                if (!p.body) continue;
                players.push({
                    id,
                    px: p.body.position.x,
                    py: p.body.position.y,
                    pz: p.body.position.z,
                    qx: p.body.quaternion.x,
                    qy: p.body.quaternion.y,
                    qz: p.body.quaternion.z,
                    qw: p.body.quaternion.w,
                    vx: p.body.velocity.x,
                    vy: p.body.velocity.y,
                    vz: p.body.velocity.z,
                    stamina: p.stamina,
                    tired: p.isTired,
                    dizzy: p.isDizzy,
                    dizzyUntil: p.dizzyUntilMs,
                    cp: p.nextCheckpointIndex,
                    finished: p.finished,
                });
            }

            this.sendData({
                type: 'snapshot',
                t: Date.now(),
                raceState: this._race.state,
                raceStartAtMs: this._race.raceStartAtMs,
                winnerId: this._race.winnerId,
                players
            }, toPlayer);
        }

        _handleSnapshotFromHost(data) {
            const serverT = Number(data.t || Date.now());

            if (data.raceState) this._race.state = data.raceState;
            this._race.raceStartAtMs = data.raceStartAtMs ?? this._race.raceStartAtMs;
            this._race.winnerId = data.winnerId ?? this._race.winnerId;

            const players = Array.isArray(data.players) ? data.players : [];

            // Debug logging
            if (Math.random() < 0.05) { // Log occasionally
                console.log('[RaceBalls] Snapshot received:', {
                    playerCount: players.length,
                    localPlayer: this.localPlayerId,
                    players: players.map(s => ({ id: s.id, pos: `(${s.px.toFixed(1)}, ${s.py.toFixed(1)}, ${s.pz.toFixed(1)})` }))
                });
            }

            for (const s of players) {
                // Ensure player exists (important for late joiners)
                if (!this.players.has(s.id)) {
                    console.log('[RaceBalls] Creating missing player from snapshot:', s.id);
                    this._ensurePlayer(s.id);
                }

                const p = this.players.get(s.id);
                if (!p || !p.body) {
                    console.warn('[RaceBalls] Player has no body after ensure:', s.id);
                    continue;
                }

                p.nextCheckpointIndex = Number(s.cp ?? p.nextCheckpointIndex);
                p.finished = !!s.finished;
                p.stamina = clamp(Number(s.stamina ?? p.stamina), 0, 100);
                p.isTired = !!s.tired;
                p.isDizzy = !!s.dizzy;
                p.dizzyUntilMs = Number(s.dizzyUntil ?? p.dizzyUntilMs);

                if (s.id === this.localPlayerId) {
                    // reconcile
                    const lerp = RB_CONFIG.SNAPSHOT_LERP;
                    p.body.position.x += (s.px - p.body.position.x) * lerp;
                    p.body.position.y += (s.py - p.body.position.y) * lerp;
                    p.body.position.z += (s.pz - p.body.position.z) * lerp;

                    p.body.velocity.x += (s.vx - p.body.velocity.x) * lerp;
                    p.body.velocity.y += (s.vy - p.body.velocity.y) * lerp;
                    p.body.velocity.z += (s.vz - p.body.velocity.z) * lerp;
                } else {
                    p.netBuffer.push({
                        t: serverT,
                        px: s.px, py: s.py, pz: s.pz,
                        qx: s.qx, qy: s.qy, qz: s.qz, qw: s.qw,
                        stamina: s.stamina,
                        tired: s.tired,
                        dizzy: s.dizzy,
                        dizzyUntil: s.dizzyUntil,
                        cp: s.cp,
                        finished: s.finished,
                    });
                    if (p.netBuffer.length > 30) p.netBuffer.splice(0, p.netBuffer.length - 30);
                }
            }
        }

        _applyRemoteInterpolation() {
            const targetT = Date.now() - RB_CONFIG.REMOTE_INTERP_DELAY_MS;

            for (const p of this.players.values()) {
                if (p.playerId === this.localPlayerId) continue;
                if (!p.body || p.netBuffer.length < 2) {
                    // Debug: log why interpolation is skipped
                    if (p.playerId && Math.random() < 0.02) {
                        console.log('[RaceBalls] Skipping interpolation for', p.playerId, {
                            hasBody: !!p.body,
                            bufferSize: p.netBuffer?.length || 0
                        });
                    }
                    continue;
                }

                while (p.netBuffer.length >= 2 && p.netBuffer[1].t <= targetT) {
                    p.netBuffer.shift();
                }

                const a = p.netBuffer[0];
                const b = p.netBuffer[1];
                if (!a || !b) continue;

                const span = Math.max(1, b.t - a.t);
                const alpha = clamp((targetT - a.t) / span, 0, 1);

                p.body.position.x = a.px + (b.px - a.px) * alpha;
                p.body.position.y = a.py + (b.py - a.py) * alpha;
                p.body.position.z = a.pz + (b.pz - a.pz) * alpha;

                const qa = new THREE.Quaternion(a.qx, a.qy, a.qz, a.qw);
                const qb = new THREE.Quaternion(b.qx, b.qy, b.qz, b.qw);
                qa.slerp(qb, alpha);
                p.body.quaternion.set(qa.x, qa.y, qa.z, qa.w);

                p.stamina = clamp(Number(b.stamina ?? p.stamina), 0, 100);
                p.isTired = !!b.tired;
                p.isDizzy = !!b.dizzy;
                p.dizzyUntilMs = Number(b.dizzyUntil ?? p.dizzyUntilMs);
                p.nextCheckpointIndex = Number(b.cp ?? p.nextCheckpointIndex);
                p.finished = !!b.finished;
            }
        }

        // ----------------------------
        // HUD
        // ----------------------------

        _updateRaceHUD() {
            const me = this.players.get(this.localPlayerId);
            const total = this._world.checkpoints.length;

            if (this._ui.checkpointProgress) {
                this._ui.checkpointProgress.classList.toggle('hidden', !this.connected);
            }
            if (this._ui.checkpointText && me) {
                this._ui.checkpointText.textContent = `CP: ${clamp(me.nextCheckpointIndex, 0, total)}/${total}`;
            }

            if (this._ui.timerDisplay) {
                this._ui.timerDisplay.classList.toggle('hidden', !(this._race.state === 'countdown' || this._race.state === 'racing' || this._race.state === 'finished'));
            }
            if (this._ui.timerValue) {
                const start = this._race.raceStartAtMs;
                const tMs = (this._race.state === 'racing' || this._race.state === 'finished') && start ? (Date.now() - start) : 0;
                this._ui.timerValue.textContent = this._formatTime(tMs);
            }

            // Countdown overlay
            if (this._race.state === 'countdown' && this._race.countdownStartAtMs) {
                const remaining = RB_CONFIG.COUNTDOWN_SECONDS - (Date.now() - this._race.countdownStartAtMs) / 1000;
                if (remaining > 0) {
                    this._showCountdown(true, Math.ceil(remaining));
                } else {
                    this._showCountdown(true, 'GO');
                }
            } else {
                // Not in countdown - hide overlay
                this._showCountdown(false);
            }

            // Place
            if (this._ui.racePosition && me && this._ui.positionNumber) {
                const place = this._computePlaceForPlayer(me.playerId);
                const suffix = place === 1 ? 'st' : place === 2 ? 'nd' : place === 3 ? 'rd' : 'th';
                this._ui.positionNumber.textContent = `${place}${suffix}`;
                this._ui.racePosition.classList.toggle('hidden', this._race.state === 'lobby');
            }
        }

        // ----------------------------
        // Main loop
        // ----------------------------

        _frame() {
            this._rafId = requestAnimationFrame(() => this._frame());

            const tMs = nowMs();
            const dtMs = clamp(tMs - this._lastFrameMs, 0, 50);
            this._lastFrameMs = tMs;

            this.input.update();

            // Host countdown -> GO
            if (this.isHost() && this._race.state === 'countdown' && this._race.countdownStartAtMs) {
                const elapsed = (Date.now() - this._race.countdownStartAtMs) / 1000;
                if (elapsed >= RB_CONFIG.COUNTDOWN_SECONDS) {
                    this._race.state = 'racing';
                    this._race.raceStartAtMs = Date.now();
                    this._race.countdownStartAtMs = null;

                    // Send to other players
                    this.sendData({ type: 'race-go', raceStartAtMs: this._race.raceStartAtMs });

                    // Host also needs to process race-go logic (hide countdown overlay, etc)
                    this._handleRaceGo({ raceStartAtMs: this._race.raceStartAtMs });
                }
            }

            // Local input into model
            const me = this.players.get(this.localPlayerId);
            if (me) {
                me.input.moveX = this.input.moveX;
                me.input.moveY = this.input.moveY;
                me.input.boost = !!this.input.boost;
                if (this.input.jumpPressed) {
                    me.input.jumpEdge = true;
                }
            }

            // Consume jump AFTER copying to player model
            this.input.consumeJumpPressed();

            // Send inputs
            if (!this.isHost()) {
                const interval = 1000 / RB_CONFIG.INPUT_SEND_HZ;
                if ((tMs - this._lastInputSendMs) >= interval) {
                    this._lastInputSendMs = tMs;
                    this._sendLocalInputToHost();
                }
            }

            // Fixed physics
            const fixedDt = 1 / RB_CONFIG.FIXED_TIMESTEP_HZ;
            this._accumulator += dtMs / 1000;
            let steps = 0;
            while (this._accumulator >= fixedDt && steps < RB_CONFIG.MAX_SUBSTEPS) {
                this._stepPhysics(fixedDt);
                this._accumulator -= fixedDt;
                steps++;
            }

            // Host race logic
            this._hostUpdateRaceLogic();

            // Snapshots
            if (this.isHost()) {
                const snapInterval = 1000 / RB_CONFIG.SNAPSHOT_SEND_HZ;
                if ((tMs - this._lastSnapshotSendMs) >= snapInterval) {
                    this._lastSnapshotSendMs = tMs;
                    this._sendSnapshot();
                }
            } else {
                this._applyRemoteInterpolation();
            }

            // Render updates
            this._syncMeshesFromBodies();
            this._updateCamera();
            this._updateExpressions();
            this._updateLocalUI();
            this._updateRaceHUD();

            // Update stamina sprites and name labels
            for (const p of this.players.values()) {
                if (p.staminaSprite) {
                    this._drawStaminaSprite(p.staminaSprite, p.stamina);
                    p.staminaSprite.quaternion.copy(this.camera.quaternion);
                }
                // Keep name sprite always facing camera (don't rotate with ball)
                if (p.nameSprite) {
                    p.nameSprite.quaternion.copy(this.camera.quaternion);
                }
            }

            if (this.renderer && this.scene && this.camera) {
                this.renderer.render(this.scene, this.camera);
            } else {
                if (Math.random() < 0.01) { // Log occasionally
                    console.error('[RaceBalls] 🚨 RENDER FAILED!', {
                        hasRenderer: !!this.renderer,
                        hasScene: !!this.scene,
                        hasCamera: !!this.camera,
                        sceneChildren: this.scene?.children?.length || 0
                    });
                }
            }
        }

        _stepPhysics(dt) {
            if (!this.world) return;
            // Allow movement in lobby (free-roam) and during racing
            const allowMove = this._race.state === 'lobby' || this._race.state === 'racing';

            if (this.isHost()) {
                for (const p of this.players.values()) {
                    if (allowMove) this._applyMovementForPlayer(p, dt);
                    // Check for fall and respawn
                    this._checkFallAndRespawn(p);
                }
            } else {
                const me = this.players.get(this.localPlayerId);
                if (me && allowMove) this._applyMovementForPlayer(me, dt);
                // Check for fall and respawn (local player)
                if (me) this._checkFallAndRespawn(me);
            }

            this.world.step(dt);
        }

        _checkFallAndRespawn(p) {
            if (!p.body) return;

            const fallY = RB_CONFIG.FALL_RESPAWN_Y || -10;

            // Check if ball fell below threshold
            if (p.body.position.y < fallY) {
                console.log('[RaceBalls] Player fell off world, respawning:', p.playerId);

                // Get spawn position for this player
                const spawns = this.mapConfig?.spawns || [];
                const playerIndex = Array.from(this.players.keys()).indexOf(p.playerId);
                const spawn = spawns[playerIndex] || { x: 0, y: 2, z: 0 };

                // Respawn at spawn with zero velocity
                p.body.position.set(
                    Number(spawn.x) || 0,
                    Number(spawn.y) || 2,
                    Number(spawn.z) || 0
                );
                p.body.velocity.set(0, 0, 0);
                p.body.angularVelocity.set(0, 0, 0);
                p.body.quaternion.set(0, 0, 0, 1);
            }
        }


        // ----------------------------
        // Lifecycle
        // ----------------------------

        onStop() {
            if (this._rafId) cancelAnimationFrame(this._rafId);
            this._rafId = null;
            this._setConnectionIndicator(false);
        }

        disconnect() {
            super.disconnect?.();
            this._setConnectionIndicator(false);
        }

        _setConnectionIndicator(connected) {
            if (this._ui.connectionStatusText) {
                this._ui.connectionStatusText.textContent = connected ? 'Connected' : 'Disconnected';
            }
            if (this._ui.connectionStatusDot) {
                this._ui.connectionStatusDot.style.background = connected ? '#10b981' : '#ef4444';
            }
        }

        _initConnectionModal() {
            if (!window.loadConnectionModal) {
                console.warn('[RaceBalls] connection-modal.js not loaded');
                return;
            }

            window.loadConnectionModal({
                localStoragePrefix: 'raceballs_',
                channelPrefix: 'raceballs-',
                title: '🏎️ Join Race Balls',
                collapsedTitle: '🏎️ Race Balls',
                onConnect: async (username, channel, password) => {
                    try {
                        if (this.connected || this.connecting) return;

                        await this.initialize();
                        await this.connect({ username, channelName: channel, channelPassword: password });
                        await this.start();

                        const modal = document.getElementById('connectionModal');
                        if (modal) modal.classList.remove('active');
                    } catch (e) {
                        console.error('[RaceBalls] Connect failed:', e);
                        MiniGameUtils?.showToast?.('Connection failed: ' + (e?.message || e), 'error');
                    }
                }
            });

            // Show modal by default
            setTimeout(() => {
                const modal = document.getElementById('connectionModal');
                if (modal) modal.classList.add('active');
            }, 150);

            // Shared link auto-connect
            if (window.MiniGameUtils && typeof MiniGameUtils.processSharedLinkAndAutoConnect === 'function') {
                MiniGameUtils.processSharedLinkAndAutoConnect({
                    gameName: 'RaceBalls',
                    storagePrefix: 'raceballs_',
                    connectCallback: async () => {
                        const username = document.getElementById('usernameInput')?.value?.trim();
                        const channel = document.getElementById('channelInput')?.value?.trim();
                        const password = document.getElementById('passwordInput')?.value || '';
                        if (username && channel) {
                            await this.initialize();
                            await this.connect({ username, channelName: channel, channelPassword: password });
                            await this.start();
                            const modal = document.getElementById('connectionModal');
                            if (modal) modal.classList.remove('active');
                        }
                    }
                });
            }
        }

        openShareModal() {
            if (!this.connected) {
                MiniGameUtils?.showToast?.('Connect first to share', 'warning');
                return;
            }
            if (typeof ShareModal !== 'undefined' && ShareModal.show) {
                ShareModal.show(this.channelName, this.channelPassword, '');
            }
        }

        _updateMobileControlsVisibility() {
            const mobile = isMobileDevice() || window.innerWidth < 900;
            if (this._ui.mobileControls) {
                this._ui.mobileControls.classList.toggle('hidden', !mobile);
            }
        }

        _getSpeedCaps() {
            // Map can override speed limits without changing game logic.
            const pd = this.mapConfig?.physicsDefaults;
            return {
                maxNormalSpeed: Number(pd?.maxNormalSpeed ?? RB_CONFIG.movement.maxNormalSpeed),
                maxBoostSpeed: Number(pd?.maxBoostSpeed ?? RB_CONFIG.movement.maxBoostSpeed),
            };
        }

        _initPhysics() {
            if (typeof CANNON === 'undefined') {
                throw new Error('Cannon.js not found (CANNON global missing)');
            }

            this.world = new CANNON.World();

            // Apply map gravity if defined; fall back to RB_CONFIG
            const g = Number(this.mapConfig?.physicsDefaults?.gravity ?? RB_CONFIG.GRAVITY);
            this.world.gravity.set(0, g, 0);

            const groundMat = new CANNON.Material('ground');
            const ballMat = new CANNON.Material('ball');
            this._physicsMaterials.ground = groundMat;
            this._physicsMaterials.ball = ballMat;

            // Default contact
            const defaultFriction = Number(this.mapConfig?.physicsDefaults?.friction ?? this.mapConfig?.physicsDefaults?.defaultFriction ?? 0.35);
            const defaultRestitution = Number(this.mapConfig?.physicsDefaults?.restitution ?? this.mapConfig?.physicsDefaults?.defaultRestitution ?? 0.25);
            this.world.addContactMaterial(new CANNON.ContactMaterial(groundMat, ballMat, {
                friction: clamp(defaultFriction, 0, 2),
                restitution: clamp(defaultRestitution, 0, 2)
            }));

            // Infinite plane just in case (map segments are actual colliders)
            const plane = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, material: groundMat });
            plane.addShape(new CANNON.Plane());
            plane.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
            this.world.addBody(plane);

            // Impact heuristic
            this.world.addEventListener('postStep', () => {
                for (const p of this.players.values()) {
                    if (!p.body) continue;
                    const v = p.body.velocity;
                    const speed = Math.hypot(v.x, v.y, v.z);
                    const dv = Math.abs(speed - (p._lastVelForImpact || 0));
                    p._lastVelForImpact = speed;
                    if (dv > 8) p.lastImpactAtMs = nowMs();
                }
            });
        }

        // ----------------------------
        // Player spawning + visuals
        // ----------------------------

        _spawnPlayer(p) {
            // Physics body
            const shape = new CANNON.Sphere(RB_CONFIG.BALL_RADIUS);
            const body = new CANNON.Body({ mass: RB_CONFIG.BALL_MASS, material: this._physicsMaterials.ball || undefined });
            body.addShape(shape);
            body.linearDamping = RB_CONFIG.BALL_LINEAR_DAMPING;
            body.angularDamping = RB_CONFIG.BALL_ANGULAR_DAMPING;

            // Default spawn (will be overwritten by map spawn)
            body.position.set(0, RB_CONFIG.GROUND_Y + RB_CONFIG.BALL_RADIUS + 0.5, 0);

            // Start in steady state - zero velocity
            body.velocity.set(0, 0, 0);
            body.angularVelocity.set(0, 0, 0);

            this.world.addBody(body);
            p.body = body;

            // Render mesh
            const mesh = new THREE.Mesh(
                new THREE.SphereGeometry(RB_CONFIG.BALL_RADIUS, 24, 24),
                new THREE.MeshStandardMaterial({ color: new THREE.Color(p.colorHex), roughness: 0.35, metalness: 0.1 })
            );
            this.scene.add(mesh);
            p.mesh = mesh;

            // Face
            p.faceSprite = this.faceFactory.createSprite('normal', p.colorHex);
            p.faceSprite.position.set(0, 0.4, RB_CONFIG.BALL_RADIUS + 0.05);
            mesh.add(p.faceSprite);

            // Player name text above ball
            p.nameSprite = this._createNameSprite(p.playerId, p.colorHex);
            p.nameSprite.position.set(0, RB_CONFIG.BALL_RADIUS + 0.8, 0);
            mesh.add(p.nameSprite);

            // Stamina bar removed - only show in HUD, not on ball
            p.staminaSprite = null;
        }

        _createNameSprite(playerName, colorHex) {
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 64;
            const ctx = canvas.getContext('2d');

            // Clear canvas
            ctx.clearRect(0, 0, 256, 64);

            // Draw background
            ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
            ctx.roundRect(10, 10, 236, 44, 8);
            ctx.fill();

            // Draw player name
            ctx.font = 'bold 28px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // Outline
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 4;
            ctx.strokeText(playerName, 128, 32);

            // Fill with player color
            ctx.fillStyle = colorHex || '#ffffff';
            ctx.fillText(playerName, 128, 32);

            const tex = new THREE.CanvasTexture(canvas);
            const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
            const sprite = new THREE.Sprite(mat);
            sprite.scale.set(2, 0.5, 1);

            return sprite;
        }

        _createStaminaSprite(colorHex) {
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 64;
            const ctx = canvas.getContext('2d');
            const tex = new THREE.CanvasTexture(canvas);
            const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
            const sprite = new THREE.Sprite(mat);
            sprite.scale.set(RB_CONFIG.STAMINA_SPRITE_SIZE.w, RB_CONFIG.STAMINA_SPRITE_SIZE.h, 1);
            sprite.userData = { canvas, ctx, tex, colorHex, lastPct: null };
            return sprite;
        }

        _drawStaminaSprite(sprite, stamina) {
            if (!sprite?.userData?.ctx) return;
            const pct = clamp(Number(stamina), 0, 100);
            if (sprite.userData.lastPct !== null && Math.abs(sprite.userData.lastPct - pct) < 0.5) return;
            sprite.userData.lastPct = pct;

            const { ctx, canvas, tex } = sprite.userData;
            const w = canvas.width;
            const h = canvas.height;
            ctx.clearRect(0, 0, w, h);

            // bg
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            ctx.fillRect(10, 18, w - 20, 28);

            // border
            ctx.strokeStyle = 'rgba(255,255,255,0.65)';
            ctx.lineWidth = 3;
            ctx.strokeRect(10, 18, w - 20, 28);

            // fill
            const fillW = (w - 24) * (pct / 100);
            ctx.fillStyle = sprite.userData.colorHex || '#22c55e';
            ctx.fillRect(12, 20, fillW, 24);

            // text
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            ctx.font = 'bold 18px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(Math.round(pct)), w / 2, 32);

            tex.needsUpdate = true;
        }

        // ----------------------------
        // UI helpers
        // ----------------------------

        _formatTime(ms) {
            const total = Math.max(0, Math.floor(ms / 1000));
            const mins = Math.floor(total / 60);
            const secs = total % 60;
            const remMs = Math.max(0, ms % 1000);
            return `${mins}:${String(secs).padStart(2, '0')}.${String(Math.floor(remMs / 10)).padStart(2, '0')}`;
        }

        _showCountdown(show, text) {
            if (this._ui.countdownOverlay) this._ui.countdownOverlay.classList.toggle('hidden', !show);
            if (show && this._ui.countdownNumber) this._ui.countdownNumber.textContent = String(text ?? '');
        }

        _showFinishOverlay(show) {
            if (this._ui.finishOverlay) this._ui.finishOverlay.classList.toggle('hidden', !show);
        }

        _renderFinishResults(results) {
            if (!this._ui.finishResults) return;
            this._ui.finishResults.innerHTML = '';

            // Sort by time (winner first)
            const sorted = (Array.isArray(results) ? results : []).sort((a, b) => (a.timeMs || 0) - (b.timeMs || 0));

            // Create leaderboard
            const leaderboard = document.createElement('div');
            leaderboard.className = 'race-leaderboard';
            leaderboard.innerHTML = '<h3>🏆 Race Results</h3>';

            sorted.forEach((r, idx) => {
                const row = document.createElement('div');
                row.className = 'leaderboard-item';

                // Add rank class for styling
                if (idx === 0) row.classList.add('rank-1');
                else if (idx === 1) row.classList.add('rank-2');
                else if (idx === 2) row.classList.add('rank-3');

                // Medal emoji
                const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}.`;

                // Time display (winner shows actual time, others show DNF or time)
                const timeStr = (r.timeMs && r.timeMs < 90000000) ? this._formatTime(r.timeMs) : 'DNF';

                // Color indicator
                const colorStyle = r.colorHex ? `background-color: ${r.colorHex}` : '';

                row.innerHTML = `
                    <span class="rank-medal">${medal}</span>
                    <span class="player-color-dot" style="${colorStyle}"></span>
                    <span class="player-name">${r.playerId || 'Player'}</span>
                    <span class="player-time">${timeStr}</span>
                `;

                // Highlight local player
                if (r.playerId === this.localPlayerId) {
                    row.classList.add('local-player');
                }

                leaderboard.appendChild(row);
            });

            this._ui.finishResults.appendChild(leaderboard);

            // Update title with winner name
            if (this._ui.finishTitle && sorted?.length) {
                const winner = sorted[0];
                const winnerName = winner?.playerId || 'Winner';
                const isMe = winner?.playerId === this.localPlayerId;
                this._ui.finishTitle.textContent = isMe ? '🏆 You Won!' : `🏆 ${winnerName} Wins!`;
            }

            // Show/hide play again button (host only)
            if (this._ui.playAgainBtn) {
                this._ui.playAgainBtn.style.display = this.isHost() ? '' : 'none';
            }
        }

        _computePlaceForPlayer(playerId) {
            const fin = this._world.finish;

            const score = (p) => {
                if (p.finished) return 1e9;

                const cp = p.nextCheckpointIndex || 0;
                let tx = 0, ty = 0, tz = 0;

                const next = this._world.checkpoints[Math.min(cp, Math.max(0, this._world.checkpoints.length - 1))];
                if (next) {
                    tx = next.x; ty = next.y; tz = next.z;
                } else if (fin) {
                    tx = fin.x; ty = fin.y; tz = fin.z;
                }

                const b = p.body;
                const d = b ? Math.hypot(b.position.x - tx, b.position.y - ty, b.position.z - tz) : 999999;
                return cp * 10000 - d;
            };

            const arr = Array.from(this.players.values());
            arr.sort((a, b) => score(b) - score(a));
            const idx = arr.findIndex(p => p.playerId === playerId);
            return idx >= 0 ? idx + 1 : 1;
        }

    }

    // ----------------------------
    // Boot
    // ----------------------------

    let raceBallsGame = null;

    document.addEventListener('DOMContentLoaded', async () => {
        try {
            raceBallsGame = new RaceBallsGame();
            window.raceBallsGame = raceBallsGame;
            await raceBallsGame.initialize();
            raceBallsGame._setConnectionIndicator(false);
        } catch (e) {
            console.error('[RaceBalls] Failed to initialize:', e);
            MiniGameUtils?.showToast?.('Failed to initialize: ' + (e?.message || e), 'error');
        }
    });

})();
