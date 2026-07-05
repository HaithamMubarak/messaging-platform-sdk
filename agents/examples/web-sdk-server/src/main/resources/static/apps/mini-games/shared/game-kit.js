// ============================================================================
// GameKit — shared base kit for the mini-games (plain script, no deps).
//
// Exposes window.GameKit with:
//   Vec2           static vector math on plain {x, y}
//   GameObject     base entity: position/velocity/integration/lifecycle
//   CircleBody     GameObject with radius/mass + impulse collision
//   Physics        static helpers that work on PLAIN objects ({x,y,vx,vy})
//                  so existing games can adopt them without touching their
//                  network-synced state shapes
//   ParticleSystem canvas-space particle bursts (impacts, dust, goals)
//   Trail          fading motion trail for a moving body
//   Shake          screen shake with decay (preDraw/postDraw around a frame)
//   Confetti       fullscreen DOM overlay burst for non-canvas games
//   Draw           small canvas helpers (radialGlow, roundRect)
//
// Rules: physics in most games runs host-only with state synced to peers —
// drive visual effects from OBSERVED state (velocity flips, score changes),
// never from host-only code paths, so remote players see them too.
// ============================================================================
(function () {
    'use strict';

    // ---------------------------------------------------------------- Vec2
    const Vec2 = {
        len(x, y) { return Math.sqrt(x * x + y * y); },
        dist(ax, ay, bx, by) { return Vec2.len(bx - ax, by - ay); },
        dot(ax, ay, bx, by) { return ax * bx + ay * by; },
        clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); },
        lerp(a, b, t) { return a + (b - a) * t; },
        // Normalize in place on a plain {x, y}; returns the original length.
        norm(v) {
            const l = Vec2.len(v.x, v.y);
            if (l > 0) { v.x /= l; v.y /= l; }
            return l;
        },
    };

    // ---------------------------------------------------------- GameObject
    // Base entity for NEW games. Existing games keep their plain synced
    // objects and use Physics.* helpers instead.
    class GameObject {
        constructor(x = 0, y = 0) {
            this.x = x; this.y = y;
            this.vx = 0; this.vy = 0;
            this.alive = true;
        }
        get speed() { return Vec2.len(this.vx, this.vy); }
        integrate(dt, friction = 1) {
            this.x += this.vx * dt;
            this.y += this.vy * dt;
            if (friction !== 1) {
                const f = Math.pow(friction, dt);
                this.vx *= f; this.vy *= f;
            }
        }
        clampSpeed(max) {
            const s = this.speed;
            if (s > max) { this.vx = this.vx / s * max; this.vy = this.vy / s * max; }
        }
        update(_dt) {}   // override
        draw(_ctx) {}    // override
    }

    class CircleBody extends GameObject {
        constructor(x, y, radius, mass = 1) {
            super(x, y);
            this.radius = radius;
            this.mass = mass;
        }
        overlaps(other) {
            return Vec2.dist(this.x, this.y, other.x, other.y) < this.radius + other.radius;
        }
        collide(other, restitution = 1) {
            return Physics.circleImpulse(this, other, {
                restitution,
                radiusA: this.radius, radiusB: other.radius,
                massA: this.mass, massB: other.mass,
            });
        }
    }

    // -------------------------------------------------------------- Physics
    const Physics = {
        // Elastic impulse between two circles given as PLAIN objects with
        // {x, y, vx, vy}. Separates them and applies the impulse to `a`
        // (and to `b` proportionally if moveB). Returns impact info or null.
        // opts: {radiusA, radiusB, restitution=1, massA=1, massB=Infinity,
        //        transfer=0 (extra fraction of b's velocity added to a),
        //        english=0 (tangential fraction of b's velocity added to a),
        //        moveB=false}
        circleImpulse(a, b, opts) {
            const rA = opts.radiusA, rB = opts.radiusB;
            const minDist = rA + rB;
            let dx = a.x - b.x, dy = a.y - b.y;
            let dist = Vec2.len(dx, dy);
            if (dist >= minDist) return null;
            if (dist === 0) { dx = 1; dy = 0; dist = 0.0001; }
            const nx = dx / dist, ny = dy / dist;

            // Positional separation (a pushed out along the normal).
            a.x = b.x + nx * minDist;
            a.y = b.y + ny * minDist;

            const bvx = b.vx || 0, bvy = b.vy || 0;
            const dvx = a.vx - bvx, dvy = a.vy - bvy;
            const dvn = dvx * nx + dvy * ny;
            if (dvn >= 0) return { nx, ny, speed: 0, x: a.x - nx * rA, y: a.y - ny * rA };

            const e = opts.restitution != null ? opts.restitution : 1;
            const mA = opts.massA != null ? opts.massA : 1;
            const mB = opts.massB != null ? opts.massB : Infinity;
            const invA = 1 / mA, invB = isFinite(mB) ? 1 / mB : 0;
            const j = -(1 + e) * dvn / (invA + invB);

            a.vx += j * invA * nx;
            a.vy += j * invA * ny;
            if (opts.moveB && invB > 0) {
                b.vx = bvx - j * invB * nx;
                b.vy = bvy - j * invB * ny;
            }
            // Velocity transfer: shove some of b's motion into a (arcade feel).
            if (opts.transfer) {
                a.vx += bvx * opts.transfer;
                a.vy += bvy * opts.transfer;
            }
            // English: tangential component of b's motion spins a sideways.
            if (opts.english) {
                const tx = -ny, ty = nx;
                const bt = bvx * tx + bvy * ty;
                a.vx += tx * bt * opts.english;
                a.vy += ty * bt * opts.english;
            }
            return { nx, ny, speed: -dvn, x: a.x - nx * rA, y: a.y - ny * rA };
        },

        // Continuous collision: does the segment (from prev to cur position
        // of a moving point) pass within `minDist` of circle center (cx,cy)?
        // Returns {x, y, t} of the closest approach point on the path, or null.
        sweptCircleHit(prevX, prevY, curX, curY, cx, cy, minDist) {
            const pdx = curX - prevX, pdy = curY - prevY;
            const len2 = pdx * pdx + pdy * pdy;
            if (len2 === 0) return null;
            const t = Vec2.clamp(((cx - prevX) * pdx + (cy - prevY) * pdy) / len2, 0, 1);
            const px = prevX + t * pdx, py = prevY + t * pdy;
            if (Vec2.dist(px, py, cx, cy) < minDist) return { x: px, y: py, t };
            return null;
        },
    };

    // ------------------------------------------------------- ParticleSystem
    class ParticleSystem {
        constructor(max = 400) {
            this.pool = [];
            this.max = max;
        }
        // burst(x, y, {count, color, speed, spread, life, size, gravity, dirX, dirY})
        burst(x, y, o = {}) {
            const count = o.count || 12;
            const baseAngle = (o.dirX !== undefined || o.dirY !== undefined)
                ? Math.atan2(o.dirY || 0, o.dirX || 0) : null;
            const spread = o.spread != null ? o.spread : Math.PI * 2;
            for (let i = 0; i < count; i++) {
                if (this.pool.length >= this.max) this.pool.shift();
                const ang = baseAngle === null
                    ? Math.random() * Math.PI * 2
                    : baseAngle + (Math.random() - 0.5) * spread;
                const spd = (o.speed || 4) * (0.35 + Math.random() * 0.65);
                this.pool.push({
                    x, y,
                    vx: Math.cos(ang) * spd,
                    vy: Math.sin(ang) * spd,
                    life: 1,
                    decay: 1 / ((o.life || 0.5) * 60),
                    size: (o.size || 3) * (0.6 + Math.random() * 0.8),
                    color: Array.isArray(o.color)
                        ? o.color[(Math.random() * o.color.length) | 0]
                        : (o.color || '#ffffff'),
                    gravity: o.gravity || 0,
                });
            }
        }
        update(dt) {
            const p = this.pool;
            for (let i = p.length - 1; i >= 0; i--) {
                const q = p[i];
                q.x += q.vx * dt;
                q.y += q.vy * dt;
                q.vy += q.gravity * dt;
                q.vx *= 0.96; q.vy *= 0.96;
                q.life -= q.decay * dt;
                if (q.life <= 0) p.splice(i, 1);
            }
        }
        draw(ctx) {
            for (const q of this.pool) {
                ctx.globalAlpha = Math.max(0, q.life);
                ctx.fillStyle = q.color;
                ctx.beginPath();
                ctx.arc(q.x, q.y, q.size * q.life, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
        }
    }

    // ----------------------------------------------------------------- Trail
    // Ring buffer of recent positions; drawn as fading circles. Only records
    // when the body actually moves (minSpeed gate) so idle objects stay clean.
    class Trail {
        constructor(maxPoints = 14, minSpeed = 1.5) {
            this.points = [];
            this.maxPoints = maxPoints;
            this.minSpeed = minSpeed;
        }
        push(x, y, speed) {
            if (speed < this.minSpeed) { this.fade(); return; }
            this.points.push({ x, y });
            if (this.points.length > this.maxPoints) this.points.shift();
        }
        fade() { if (this.points.length) this.points.shift(); }
        clear() { this.points.length = 0; }
        draw(ctx, radius, color) {
            const n = this.points.length;
            for (let i = 0; i < n; i++) {
                const t = (i + 1) / n;
                ctx.globalAlpha = t * 0.25;
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(this.points[i].x, this.points[i].y, radius * (0.4 + 0.6 * t), 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
        }
    }

    // ----------------------------------------------------------------- Shake
    class Shake {
        constructor() { this.mag = 0; this.decay = 6; }
        trigger(mag, decay = 6) {
            this.mag = Math.max(this.mag, mag);
            this.decay = decay;
        }
        // Call around the frame's world drawing.
        preDraw(ctx, dt) {
            this.mag = Math.max(0, this.mag - this.decay * dt * this.mag - 0.02 * dt);
            if (this.mag <= 0.01) { this.mag = 0; return; }
            ctx.save();
            ctx.translate(
                (Math.random() - 0.5) * 2 * this.mag,
                (Math.random() - 0.5) * 2 * this.mag
            );
            this._active = true;
        }
        postDraw(ctx) {
            if (this._active) { ctx.restore(); this._active = false; }
        }
    }

    // -------------------------------------------------------------- Confetti
    // For DOM-based games (quiz, social): one call spawns a fullscreen canvas
    // overlay, plays a burst, then removes itself. No setup required.
    const Confetti = {
        burst(opts = {}) {
            const colors = opts.colors ||
                ['#f43f5e', '#f59e0b', '#10b981', '#3b82f6', '#a855f7', '#facc15'];
            const count = opts.count || 120;
            const duration = opts.duration || 1.8;

            const cv = document.createElement('canvas');
            cv.style.cssText =
                'position:fixed;inset:0;pointer-events:none;z-index:99999;';
            cv.width = window.innerWidth;
            cv.height = window.innerHeight;
            document.body.appendChild(cv);
            const ctx = cv.getContext('2d');

            const ox = opts.x != null ? opts.x : cv.width / 2;
            const oy = opts.y != null ? opts.y : cv.height * 0.35;
            const parts = [];
            for (let i = 0; i < count; i++) {
                const ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1;
                const spd = 6 + Math.random() * 9;
                parts.push({
                    x: ox, y: oy,
                    vx: Math.cos(ang) * spd,
                    vy: Math.sin(ang) * spd,
                    w: 5 + Math.random() * 6,
                    h: 8 + Math.random() * 8,
                    rot: Math.random() * Math.PI * 2,
                    vr: (Math.random() - 0.5) * 0.4,
                    color: colors[(Math.random() * colors.length) | 0],
                });
            }

            let last = performance.now();
            const t0 = last;
            (function tick(now) {
                const dt = Math.min((now - last) / 16.67, 3);
                last = now;
                const elapsed = (now - t0) / 1000;
                ctx.clearRect(0, 0, cv.width, cv.height);
                const fade = Vec2.clamp(1 - (elapsed - duration * 0.6) / (duration * 0.4), 0, 1);
                for (const p of parts) {
                    p.x += p.vx * dt;
                    p.y += p.vy * dt;
                    p.vy += 0.35 * dt;
                    p.vx *= 0.99;
                    p.rot += p.vr * dt;
                    ctx.save();
                    ctx.translate(p.x, p.y);
                    ctx.rotate(p.rot);
                    ctx.globalAlpha = fade;
                    ctx.fillStyle = p.color;
                    ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
                    ctx.restore();
                }
                if (elapsed < duration) requestAnimationFrame(tick);
                else cv.remove();
            })(last);
        },
    };

    // ------------------------------------------------------------------- Sfx
    // Tiny synthesized sound effects (WebAudio oscillators — no asset files).
    // Safe everywhere: silently no-ops if audio is unavailable, and resumes
    // the context lazily so autoplay policies are satisfied after the first
    // user gesture. Set GameKit.Sfx.enabled = false to mute a game.
    const Sfx = {
        _ctx: null,
        enabled: true,
        _ac() {
            if (!this.enabled) return null;
            try {
                if (!this._ctx) {
                    const AC = window.AudioContext || window.webkitAudioContext;
                    if (!AC) return null;
                    this._ctx = new AC();
                }
                if (this._ctx.state === 'suspended') this._ctx.resume();
                return this._ctx;
            } catch (e) { return null; }
        },
        // One enveloped oscillator note. slideTo bends the pitch over dur.
        tone(freq, dur = 0.08, type = 'sine', vol = 0.15, slideTo = null, delay = 0) {
            const ac = this._ac();
            if (!ac) return;
            const t0 = ac.currentTime + delay;
            const osc = ac.createOscillator();
            const gain = ac.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, t0);
            if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
            gain.gain.setValueAtTime(vol, t0);
            gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
            osc.connect(gain);
            gain.connect(ac.destination);
            osc.start(t0);
            osc.stop(t0 + dur + 0.02);
        },
        hit(strength = 1) {
            this.tone(200 + strength * 70, 0.06, 'square',
                Math.min(0.2, 0.07 + strength * 0.04), 130);
        },
        ding() {
            this.tone(880, 0.12, 'sine', 0.15);
            this.tone(1320, 0.18, 'sine', 0.12, null, 0.06);
        },
        buzz() { this.tone(170, 0.22, 'sawtooth', 0.11, 110); },
        thud() { this.tone(95, 0.16, 'sine', 0.25, 45); },
        fanfare() {
            [523, 659, 784, 1047].forEach((f, i) =>
                this.tone(f, 0.16, 'triangle', 0.13, null, i * 0.09));
        },
    };

    // ------------------------------------------------------------------ Draw
    const Draw = {
        radialGlow(ctx, x, y, radius, color, alpha = 0.5) {
            const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
            g.addColorStop(0, color);
            g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.globalAlpha = alpha;
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
        },
        roundRect(ctx, x, y, w, h, r) {
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.arcTo(x + w, y, x + w, y + h, r);
            ctx.arcTo(x + w, y + h, x, y + h, r);
            ctx.arcTo(x, y + h, x, y, r);
            ctx.arcTo(x, y, x + w, y, r);
            ctx.closePath();
        },
    };

    window.GameKit = {
        Vec2, GameObject, CircleBody, Physics,
        ParticleSystem, Trail, Shake, Confetti, Sfx, Draw,
    };
})();
