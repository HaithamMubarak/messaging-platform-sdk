// ============================================================================
// PartySFX — the party games' sound, synthesised.
//
// No audio files. Every cue is a few oscillators and an envelope, which keeps
// the games asset-free and means a new sound is three lines rather than a
// licensing conversation.
//
// Two rules the browser imposes and this module hides:
//   * an AudioContext created before a user gesture starts suspended, so it is
//     created lazily on the first play() and resumed if it is asleep;
//   * a game that makes noise the moment it loads is a game people mute for
//     ever, so the toggle is remembered per browser and honoured everywhere.
// ============================================================================
(function () {
    'use strict';

    const STORE_KEY = 'party_sound';
    let ctx = null;
    let muted = false;

    try { muted = localStorage.getItem(STORE_KEY) === 'off'; } catch (_) {}

    function audio() {
        if (muted) return null;
        try {
            if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
            if (ctx.state === 'suspended') ctx.resume();
            return ctx;
        } catch (_) {
            return null;   // no Web Audio here; the games are all playable silent
        }
    }

    /** One shaped note. Everything below is built out of these. */
    function tone(opts) {
        const ac = audio();
        if (!ac) return;
        const t0 = ac.currentTime + (opts.at || 0);
        const osc = ac.createOscillator();
        const gain = ac.createGain();

        osc.type = opts.type || 'sine';
        osc.frequency.setValueAtTime(opts.from || 440, t0);
        if (opts.to && opts.to !== opts.from) {
            osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t0 + (opts.dur || 0.2));
        }

        const peak = (opts.gain == null ? 0.18 : opts.gain);
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + (opts.dur || 0.2));

        osc.connect(gain).connect(ac.destination);
        osc.start(t0);
        osc.stop(t0 + (opts.dur || 0.2) + 0.03);
    }

    /** A short burst of filtered noise — thuds, gavels, applause. */
    function noise(opts) {
        const ac = audio();
        if (!ac) return;
        const dur = opts.dur || 0.2;
        const frames = Math.floor(ac.sampleRate * dur);
        const buf = ac.createBuffer(1, frames, ac.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < frames; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / frames, opts.decay || 2);
        }
        const src = ac.createBufferSource();
        src.buffer = buf;

        const filter = ac.createBiquadFilter();
        filter.type = opts.filter || 'lowpass';
        filter.frequency.value = opts.freq || 900;

        const gain = ac.createGain();
        gain.gain.value = opts.gain == null ? 0.25 : opts.gain;

        src.connect(filter).connect(gain).connect(ac.destination);
        src.start(ac.currentTime + (opts.at || 0));
    }

    const SOUNDS = {
        // ---- Chorus
        cue:      () => tone({ type: 'triangle', from: 660, to: 880, dur: 0.12, gain: 0.14 }),
        place:    () => { tone({ type: 'sine', from: 523, dur: 0.1 }); tone({ type: 'sine', from: 784, dur: 0.16, at: 0.07 }); },
        miss:     () => tone({ type: 'sawtooth', from: 220, to: 90, dur: 0.32, gain: 0.16 }),
        reveal:   () => [0, 0.09, 0.18, 0.3].forEach((at, i) =>
                        tone({ type: 'triangle', from: [523, 659, 784, 1047][i], dur: 0.3, at, gain: 0.13 })),

        // ---- Autocue
        line:     () => tone({ type: 'sine', from: 392, to: 523, dur: 0.14, gain: 0.12 }),
        attrib:   () => { tone({ type: 'triangle', from: 880, dur: 0.12 }); tone({ type: 'triangle', from: 1319, dur: 0.22, at: 0.1, gain: 0.13 }); },
        heckle:   () => tone({ type: 'sawtooth', from: 180, to: 120, dur: 0.28, gain: 0.13 }),
        direction:() => { tone({ type: 'square', from: 740, dur: 0.08, gain: 0.1 }); tone({ type: 'square', from: 988, dur: 0.1, at: 0.09, gain: 0.1 }); },

        // ---- Gavel
        gavel:    () => { noise({ dur: 0.16, freq: 420, gain: 0.4, decay: 3 }); tone({ type: 'sine', from: 140, to: 70, dur: 0.2, gain: 0.2 }); },
        objection:() => { tone({ type: 'square', from: 587, dur: 0.1, gain: 0.14 }); tone({ type: 'square', from: 587, dur: 0.14, at: 0.14, gain: 0.14 }); },
        guilty:   () => { tone({ type: 'sawtooth', from: 200, to: 100, dur: 0.5, gain: 0.18 }); noise({ dur: 0.3, freq: 300, gain: 0.2 }); },
        cleared:  () => [0, 0.1, 0.22].forEach((at, i) =>
                        tone({ type: 'sine', from: [523, 659, 880][i], dur: 0.35, at, gain: 0.14 })),

        // ---- Nudge
        deal:     () => { tone({ type: 'sine', from: 330, dur: 0.09, gain: 0.1 }); tone({ type: 'sine', from: 440, dur: 0.12, at: 0.08, gain: 0.1 }); },
        claim:    () => { tone({ type: 'square', from: 494, dur: 0.1, gain: 0.12 }); tone({ type: 'square', from: 659, dur: 0.16, at: 0.1, gain: 0.12 }); },
        carried:  () => { tone({ type: 'sine', from: 659, dur: 0.12 }); tone({ type: 'sine', from: 988, dur: 0.24, at: 0.1 }); },
        thrown:   () => tone({ type: 'sawtooth', from: 300, to: 140, dur: 0.3, gain: 0.15 }),

        // ---- shared
        join:     () => tone({ type: 'sine', from: 587, to: 784, dur: 0.16, gain: 0.1 }),
        tick:     () => tone({ type: 'sine', from: 1200, dur: 0.05, gain: 0.07 }),
        applause: () => { noise({ dur: 1.1, freq: 2400, filter: 'bandpass', gain: 0.14, decay: 0.6 });
                          [0, 0.12, 0.26].forEach((at, i) => tone({ type: 'triangle', from: [659, 880, 1319][i], dur: 0.5, at, gain: 0.1 })); },
    };

    function play(name) {
        const fn = SOUNDS[name];
        if (!fn || muted) return;
        try { fn(); } catch (_) { /* never let a sound break a game */ }
    }

    function setMuted(on) {
        muted = !!on;
        try { localStorage.setItem(STORE_KEY, muted ? 'off' : 'on'); } catch (_) {}
        if (muted && ctx && ctx.state === 'running') ctx.suspend();
    }

    function isMuted() { return muted; }

    /**
     * Wire a header button to the toggle. Games call this once; the icon and
     * the label stay in step with the stored preference.
     */
    function attachToggle(buttonId) {
        const btn = document.getElementById(buttonId);
        if (!btn) return;
        const paint = () => {
            btn.setAttribute('aria-pressed', String(!muted));
            btn.title = muted ? 'Sound off' : 'Sound on';
            const use = btn.querySelector('use');
            if (use) use.setAttribute('href', muted ? '#i-mic-off' : '#i-mic');
            const label = btn.querySelector('span');
            if (label) label.textContent = muted ? 'Sound off' : 'Sound';
        };
        btn.addEventListener('click', () => { setMuted(!muted); paint(); if (!muted) play('tick'); });
        paint();
    }

    window.PartySFX = { play, setMuted, isMuted, attachToggle, tone, noise };
})();
