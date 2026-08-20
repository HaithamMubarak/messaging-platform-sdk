/**
 * BlockParty — sound
 *
 * Every sound here is synthesised on the spot: no files to load, nothing to
 * cache, and a placement noise that can change pitch with the height you are
 * building at. A brick going down is a short triangle tone with a noise click
 * on the front — the click is what makes it read as contact rather than a beep.
 *
 * Stacking upwards raises the pitch, so building a tower plays a rising scale.
 * That is the one deliberate piece of musicality: it tells you what you are
 * doing without a single word of UI.
 *
 * The audio context cannot start until the player has interacted with the page,
 * so it is created on the first gesture and everything before that is silently
 * dropped.
 */
(function () {
    'use strict';

    const RATE_LIMIT_MS = 28;     // a box fill would otherwise machine-gun

    const Sfx = {
        enabled: true,
        ctx: null,
        master: null,
        noise: null,
        _last: 0,

        /** Called from the first real gesture; safe to call repeatedly. */
        init() {
            if (this.ctx) {
                if (this.ctx.state === 'suspended') this.ctx.resume();
                return this.ctx;
            }
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return null;
            try {
                this.ctx = new AC();
                this.master = this.ctx.createGain();
                this.master.gain.value = 0.5;
                this.master.connect(this.ctx.destination);

                // One second of white noise, reused for every click and thud.
                const len = Math.floor(this.ctx.sampleRate);
                const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
                const data = buf.getChannelData(0);
                for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
                this.noise = buf;
            } catch (e) {
                this.ctx = null;
            }
            return this.ctx;
        },

        setEnabled(on) {
            this.enabled = !!on;
            try { localStorage.setItem('blockparty_sound', on ? '1' : '0'); } catch (e) { /* ignore */ }
            if (on) this.init();
            if (this.master) this.master.gain.value = on ? 0.5 : 0;
        },

        restore() {
            try {
                const saved = localStorage.getItem('blockparty_sound');
                if (saved !== null) this.enabled = saved === '1';
            } catch (e) { /* ignore */ }
            return this.enabled;
        },

        _ready() {
            if (!this.enabled) return false;
            if (!this.ctx) return false;
            if (this.ctx.state === 'suspended') this.ctx.resume();
            return true;
        },

        /** A tone with an exponential fall — the body of most of these sounds. */
        _tone(freq, dur, gain, type, when) {
            if (!this._ready()) return;
            const t = (when || this.ctx.currentTime);
            const osc = this.ctx.createOscillator();
            const g = this.ctx.createGain();
            osc.type = type || 'triangle';
            osc.frequency.setValueAtTime(freq, t);
            g.gain.setValueAtTime(gain, t);
            // Exponential, because a linear fade sounds like a switch closing.
            g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
            osc.connect(g); g.connect(this.master);
            osc.start(t);
            osc.stop(t + dur + 0.02);
        },

        /** A filtered noise burst — the click of two bricks meeting. */
        _click(freq, dur, gain, when) {
            if (!this._ready() || !this.noise) return;
            const t = (when || this.ctx.currentTime);
            const src = this.ctx.createBufferSource();
            src.buffer = this.noise;
            src.loop = true;
            const bp = this.ctx.createBiquadFilter();
            bp.type = 'bandpass';
            bp.frequency.value = freq;
            bp.Q.value = 1.2;
            const g = this.ctx.createGain();
            g.gain.setValueAtTime(gain, t);
            g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
            src.connect(bp); bp.connect(g); g.connect(this.master);
            src.start(t);
            src.stop(t + dur + 0.02);
        },

        _throttled() {
            const now = performance.now();
            if (now - this._last < RATE_LIMIT_MS) return true;
            this._last = now;
            return false;
        },

        // ---- the sounds themselves --------------------------------------

        /** A brick going down. Higher up the wall, higher the note. */
        place(y, remote) {
            if (!this._ready() || this._throttled()) return;
            const vol = remote ? 0.18 : 0.5;
            const detune = 1 + (Math.random() - 0.5) * 0.06;
            this._tone(180 * Math.pow(1.03, Math.max(0, y || 0)) * detune, 0.07, vol, 'triangle');
            this._click(2500, 0.015, vol * 0.5);
        },

        /** A brick coming off: lower, and with more grit to it. */
        remove(y, remote) {
            if (!this._ready() || this._throttled()) return;
            const vol = remote ? 0.16 : 0.45;
            this._tone(130 * Math.pow(1.02, Math.max(0, y || 0)), 0.09, vol, 'triangle');
            this._click(1200, 0.05, vol * 0.6);
        },

        /**
         * A brick hitting something. The sound a collapse is made of.
         *
         * Physics used to be silent until the very last block settled, which is
         * most of why a tower coming down could read as a glitch rather than as
         * drama. Weight is carried by pitch: a 2x4 lands lower than a cube.
         *
         * Its own rate limit, not the shared one — a collapse should sound like
         * several things landing, without the placement plinks starving it or
         * it starving them.
         *
         * @param {number} strength impact speed along the contact normal
         * @param {number} mass     cells in the piece, so bigger lands deeper
         */
        thud(strength, mass) {
            if (!this._ready()) return;
            const now = performance.now();
            if (now - (this._lastThud || 0) < 45) return;
            this._lastThud = now;

            const hit = Math.max(0, Math.min(1, (strength || 0) / 14));
            const heft = Math.max(1, mass || 1);
            const vol = 0.10 + hit * 0.34;
            // Bigger pieces ring lower; a little wobble so repeats never phase.
            const base = 96 / Math.pow(heft, 0.22) * (1 + (Math.random() - 0.5) * 0.08);
            this._tone(base, 0.10 + hit * 0.06, vol, 'sine');
            this._click(420 + hit * 500, 0.05 + hit * 0.04, vol * 0.7);
        },

        /** A refusal: dull, low, and obviously not a placement. */
        invalid() {
            this._tone(90, 0.14, 0.3, 'sine');
            this._click(300, 0.06, 0.12);
        },

        /** A UI tick — switching brick, rotating, picking a colour. */
        tick() { this._tone(1500, 0.02, 0.16, 'square'); },

        /** One step of a countdown; the last one is the high "go". */
        countdown(step) { this._tone(step > 0 ? 440 : 880, step > 0 ? 0.12 : 0.35, 0.34, 'triangle'); },

        /** A rising run — a round won, a build finished, a guess landed. */
        fanfare(base) {
            if (!this._ready()) return;
            const t0 = this.ctx.currentTime;
            [0, 4, 7, 12].forEach((semi, i) => {
                this._tone((base || 392) * Math.pow(2, semi / 12), 0.28, 0.3, 'triangle', t0 + i * 0.09);
            });
        },

        /** A single bright note, for a score ticking up. */
        chime(step) { this._tone(660 * Math.pow(2, ((step || 0) % 8) / 12), 0.10, 0.18, 'sine'); },

        /** Urgency: the last seconds of a round. */
        urgent(fast) { this._tone(fast ? 900 : 700, 0.05, 0.22, 'square'); }
    };

    window.BlockPartySfx = Sfx;
})();
