/**
 * BlockParty — transient effects
 *
 * Chunks rebuild instantly, so a placed brick simply appears. These are the
 * things that make it land: a pop where it went down, debris where one came
 * off, confetti when somebody wins, a ring when ground changes hands.
 *
 * Everything is drawn from fixed pools — a placement effect must never allocate
 * during a box fill of a thousand cells — and the whole system switches off on
 * software renderers, where the frame budget is better spent on the world.
 */
(function () {
    'use strict';

    const POPS = 24, DEBRIS = 60, CONFETTI = 220;
    const GRAVITY = 26;
    // A software renderer still deserves feedback — it just gets less of it.
    // The pools are the cap on cost either way: a fill of a thousand cells can
    // never spawn more than this many effects.
    const SOFT_SCALE = 0.35;

    class Effects {
        constructor(scene, opts) {
            this.scene = scene;
            this.enabled = true;
            this.scale = (opts && opts.software) ? SOFT_SCALE : 1;
            this.pops = [];
            this.debris = [];
            this.rings = [];
            this.confetti = null;
            this._build();
        }

        _build() {
            const pops = Math.max(6, Math.round(POPS * this.scale));
            const debris = Math.max(10, Math.round(DEBRIS * this.scale));
            const confetti = Math.max(60, Math.round(CONFETTI * this.scale));
            const popGeo = new THREE.BoxGeometry(1, 1, 1);
            for (let i = 0; i < pops; i++) {
                const m = new THREE.Mesh(popGeo, new THREE.MeshBasicMaterial({
                    color: 0xffffff, transparent: true, opacity: 0, depthWrite: false,
                    blending: THREE.AdditiveBlending
                }));
                m.visible = false;
                this.scene.add(m);
                this.pops.push({ mesh: m, life: 0 });
            }

            const bitGeo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
            for (let i = 0; i < debris; i++) {
                const m = new THREE.Mesh(bitGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }));
                m.visible = false;
                this.scene.add(m);
                this.debris.push({ mesh: m, life: 0, vx: 0, vy: 0, vz: 0 });
            }

            const ringGeo = new THREE.RingGeometry(0.9, 1, 24);
            for (let i = 0; i < 6; i++) {
                const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
                    color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false
                }));
                m.rotation.x = -Math.PI / 2;
                m.visible = false;
                this.scene.add(m);
                this.rings.push({ mesh: m, life: 0 });
            }

            this.confettiCount = confetti;
            const pos = new Float32Array(confetti * 3);
            const col = new Float32Array(confetti * 3);
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
            const points = new THREE.Points(geo, new THREE.PointsMaterial({
                size: 0.35, vertexColors: true, transparent: true, opacity: 1, depthWrite: false
            }));
            points.visible = false;
            points.frustumCulled = false;
            this.scene.add(points);
            this.confetti = { points, vel: new Float32Array(confetti * 3), life: 0 };
        }

        _freePop() { return this.pops.find(p => p.life <= 0); }
        _freeDebris() { return this.debris.find(d => d.life <= 0); }
        _freeRing() { return this.rings.find(r => r.life <= 0); }

        /** A block just landed here. */
        pop(x, y, z, hex) {
            if (!this.enabled) return;
            const p = this._freePop();
            if (!p) return;
            p.mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
            p.mesh.scale.setScalar(1.25);
            p.mesh.material.color.set(hex || '#ffffff');
            p.mesh.material.opacity = 0.5;
            p.mesh.visible = true;
            p.life = 0.14;
            p.max = 0.14;
        }

        /** A block just came off — throw a few chips of it about. */
        burst(x, y, z, hex) {
            if (!this.enabled) return;
            for (let i = 0; i < 5; i++) {
                const d = this._freeDebris();
                if (!d) return;
                d.mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
                d.mesh.material.color.set(hex || '#ffffff');
                d.mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
                d.mesh.visible = true;
                d.vx = (Math.random() - 0.5) * 5;
                d.vy = 2.5 + Math.random() * 4;
                d.vz = (Math.random() - 0.5) * 5;
                d.life = 0.45;
            }
        }

        /** Ground changing hands, or a plot being claimed. */
        ring(x, z, hex) {
            if (!this.enabled) return;
            const r = this._freeRing();
            if (!r) return;
            r.mesh.position.set(x, 0.08, z);
            r.mesh.scale.setScalar(1);
            r.mesh.material.color.set(hex || '#ffffff');
            r.mesh.material.opacity = 0.8;
            r.mesh.visible = true;
            r.life = 0.7;
            r.max = 0.7;
        }

        /** Somebody won something. */
        celebrate(x, y, z, colors) {
            if (!this.enabled || !this.confetti) return;
            const c = this.confetti;
            const pos = c.points.geometry.attributes.position.array;
            const col = c.points.geometry.attributes.color.array;
            const palette = (colors && colors.length ? colors : ['#ef4444', '#facc15', '#22c55e', '#3b82f6', '#ec4899'])
                .map(h => new THREE.Color(h));
            for (let i = 0; i < this.confettiCount; i++) {
                pos[i * 3] = x + (Math.random() - 0.5) * 3;
                pos[i * 3 + 1] = y + Math.random() * 2;
                pos[i * 3 + 2] = z + (Math.random() - 0.5) * 3;
                c.vel[i * 3] = (Math.random() - 0.5) * 7;
                c.vel[i * 3 + 1] = 7 + Math.random() * 7;
                c.vel[i * 3 + 2] = (Math.random() - 0.5) * 7;
                const p = palette[i % palette.length];
                col[i * 3] = p.r; col[i * 3 + 1] = p.g; col[i * 3 + 2] = p.b;
            }
            c.points.geometry.attributes.position.needsUpdate = true;
            c.points.geometry.attributes.color.needsUpdate = true;
            c.points.visible = true;
            c.points.material.opacity = 1;
            c.life = 2.4;
        }

        /** One frame of everything in flight. */
        update(dt) {
            if (!this.enabled || !dt) return;

            this.pops.forEach(p => {
                if (p.life <= 0) return;
                p.life -= dt;
                const t = Math.max(0, p.life / p.max);
                p.mesh.scale.setScalar(1 + 0.25 * t);
                p.mesh.material.opacity = 0.5 * t;
                if (p.life <= 0) p.mesh.visible = false;
            });

            this.debris.forEach(d => {
                if (d.life <= 0) return;
                d.life -= dt;
                d.vy -= GRAVITY * dt;
                d.mesh.position.x += d.vx * dt;
                d.mesh.position.y += d.vy * dt;
                d.mesh.position.z += d.vz * dt;
                d.mesh.rotation.x += dt * 6;
                d.mesh.rotation.z += dt * 4;
                if (d.mesh.position.y < 0.1) { d.mesh.position.y = 0.1; d.vy = Math.abs(d.vy) * 0.3; }
                if (d.life <= 0) d.mesh.visible = false;
            });

            this.rings.forEach(r => {
                if (r.life <= 0) return;
                r.life -= dt;
                const t = 1 - r.life / r.max;
                r.mesh.scale.setScalar(1 + t * 7);
                r.mesh.material.opacity = 0.8 * (1 - t);
                if (r.life <= 0) r.mesh.visible = false;
            });

            const c = this.confetti;
            if (c && c.life > 0) {
                c.life -= dt;
                const pos = c.points.geometry.attributes.position.array;
                for (let i = 0; i < this.confettiCount; i++) {
                    c.vel[i * 3 + 1] -= GRAVITY * 0.55 * dt;
                    pos[i * 3] += c.vel[i * 3] * dt;
                    pos[i * 3 + 1] += c.vel[i * 3 + 1] * dt;
                    pos[i * 3 + 2] += c.vel[i * 3 + 2] * dt;
                }
                c.points.geometry.attributes.position.needsUpdate = true;
                c.points.material.opacity = Math.max(0, Math.min(1, c.life));
                if (c.life <= 0) c.points.visible = false;
            }
        }
    }

    window.BlockPartyFx = Effects;
})();
