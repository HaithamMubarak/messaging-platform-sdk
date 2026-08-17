/**
 * BlockParty — game modes
 *
 * The sandbox is the default "mode": the shared world everyone edits together.
 * A *match* temporarily takes the room over: the sandbox world is stashed, the
 * arena is laid out as one plot per player, and a host-driven state machine
 * walks everyone through countdown → study → play → scoring → reveal → final.
 *
 * Authority model — the host owns the match:
 *   - only the host runs the clock, picks the model, and computes scores;
 *   - the host broadcasts the whole match state once a second (it is small),
 *     so a client that joins, reconnects, or drops a packet is at most one
 *     second out of date and needs no catch-up protocol;
 *   - clients send exactly two things back: a throttled progress ping and
 *     their finished build.
 *
 * Because the host broadcasts to everyone but never receives its own messages,
 * the host applies each state to itself directly — _applyState is the single
 * path that turns a state into what you see, host or client.
 *
 * Builds are secret in Blueprint Race: edits are NOT relayed while a round is
 * running (see editPolicy) — rivals are drawn as covered plots with a block
 * counter, and everything is revealed at once when the round ends.
 */
(function () {
    'use strict';

    const Models = window.BlockPartyModels;

    // ---- arena geometry ----
    const WORLD_HALF = 24;        // must match HALF in blockparty.js
    const PLOT_GAP = 4;
    const PLOT_MIN = 8;
    const PLOT_MAX = 11;
    const BUILD_HEIGHT = 16;      // ceiling inside a plot during a match
    // Match camera pitch: higher over the plot than the sandbox default, so your
    // own build fills the view and the neighbouring plots stay out of the way.
    const PLOT_VIEW_PHI = Math.PI * 0.27;

    // ---- pacing (seconds) ----
    const COUNTDOWN_SECS = 3;
    const STUDY_SECS = 5;         // free look at the blueprint before the clock starts
    const SCORING_SECS = 3;       // window for builds to reach the host
    const REVEAL_SECS = 16;
    const PEEK_EVERY = 30;        // a peek window opens this often…
    const PEEK_LEN = 3;           // …and lasts this long
    const TOUR_SECS = 4;          // camera dwell per plot during the reveal

    const PROGRESS_THROTTLE_MS = 1500;
    const MAX_SUBMIT_CELLS = 1500;

    // Charades: the builder's plot is the room's stage, so it gets more space
    // than a race plot, and letters of the word leak out as time runs down.
    const STAGE_SIZE = 13;
    const CHARADES_REVEAL_SECS = 10;
    const HINT_AT = [0.45, 0.7, 0.85];   // fraction elapsed -> one more letter

    const MODES = [
        {
            id: 'blueprint', name: 'Blueprint Race', emoji: '📐', ready: true, defaultTime: 180,
            desc: 'Everyone gets the same secret blueprint. Study it, then rebuild it from memory — it flashes back for 3s every 30s. Accuracy plus speed wins.'
        },
        {
            id: 'charades', name: 'Voxel Charades', emoji: '🤫', ready: true, defaultTime: 90,
            desc: 'One player builds a secret word with no words allowed. Everyone else watches live and races to guess it in chat.'
        },
        {
            id: 'teambuild', name: 'Team Build', emoji: '🤝', ready: false,
            desc: 'The whole room builds one structure together against the clock, then shares the score.'
        },
        {
            id: 'memory', name: 'Memory Match', emoji: '🧠', ready: false,
            desc: 'The architect builds while you watch. Then it vanishes and you rebuild it from memory.'
        },
        {
            id: 'rush', name: 'Block Rush', emoji: '⚡', ready: false,
            desc: 'Fast creative prompts, no blueprint. The room votes on the best build.'
        },
        {
            id: 'territory', name: 'Territory', emoji: '🚩', ready: false,
            desc: 'One shared grid, claim it in your colour. Most blocks standing when time runs out wins.'
        }
    ];

    /**
     * Lay out one square plot per player, centred on the origin.
     * Shrinks the gap first and then the plots themselves, so a big room still
     * fits inside the world instead of spilling over the edge.
     */
    function computePlots(names) {
        const n = Math.max(1, names.length);
        const cols = Math.ceil(Math.sqrt(n));
        const rows = Math.ceil(n / cols);
        const span = WORLD_HALF * 2;
        let gap = PLOT_GAP;
        let size = Math.max(PLOT_MIN, Math.min(PLOT_MAX,
            Math.floor((span - (cols - 1) * gap) / cols)));
        while (cols * size + (cols - 1) * gap > span && (size > 5 || gap > 1)) {
            if (gap > 1) gap--; else size--;
        }
        const cell = size + gap;
        const totalW = cols * size + (cols - 1) * gap;
        const totalD = rows * size + (rows - 1) * gap;
        const startX = -Math.floor(totalW / 2);
        const startZ = -Math.floor(totalD / 2);
        return names.map((name, i) => ({
            name,
            x0: startX + (i % cols) * cell,
            z0: startZ + Math.floor(i / cols) * cell,
            size
        }));
    }

    // Where a model sits inside a plot: centred on X/Z, resting on the floor.
    function modelOrigin(plot, model) {
        const s = Models.size(model);
        return {
            x: plot.x0 + Math.floor((plot.size - s.w) / 2),
            z: plot.z0 + Math.floor((plot.size - s.d) / 2)
        };
    }

    /**
     * Compare a build against the blueprint, cell by cell in model space.
     *
     * A cell in the right place is most of the credit (0.6); the right colour
     * adds 0.25 and the right shape 0.15. The result is an F1 of that quality
     * against both counts, so spraying extra blocks costs you as much as
     * leaving cells out — otherwise "fill the whole plot" would score well.
     */
    function scoreBuild(target, built) {
        const tmap = new Map();
        target.forEach(c => tmap.set(c.x + ',' + c.y + ',' + c.z, c));

        const seen = new Set();
        let matched = 0, colorOk = 0, shapeOk = 0, quality = 0;
        built.forEach(c => {
            const k = c.x + ',' + c.y + ',' + c.z;
            if (seen.has(k)) return;
            seen.add(k);
            const t = tmap.get(k);
            if (!t) return;
            matched++;
            let q = 0.6;
            if (t.c === c.c) { q += 0.25; colorOk++; }
            if ((t.s | 0) === (c.s | 0)) { q += 0.15; shapeOk++; }
            quality += q;
        });

        const builtCount = seen.size, targetCount = tmap.size;
        const precision = builtCount ? quality / builtCount : 0;
        const recall = targetCount ? quality / targetCount : 0;
        const f1 = (precision + recall) ? (2 * precision * recall) / (precision + recall) : 0;
        return {
            pct: Math.round(f1 * 1000) / 10,
            matched, colorOk, shapeOk,
            missing: targetCount - matched,
            extra: builtCount - matched,
            builtCount, targetCount
        };
    }

    // ---- guessing ----------------------------------------------------------

    function normalizeWord(s) {
        return String(s || '').toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]/g, '');
    }

    function levenshtein(a, b) {
        const m = a.length, n = b.length;
        if (!m) return n;
        if (!n) return m;
        let prev = Array.from({ length: n + 1 }, (_, j) => j);
        for (let i = 1; i <= m; i++) {
            const row = [i];
            for (let j = 1; j <= n; j++) {
                row[j] = Math.min(
                    prev[j] + 1,
                    row[j - 1] + 1,
                    prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
                );
            }
            prev = row;
        }
        return prev[n];
    }

    /**
     * Accept the answer people actually type: case, punctuation and spacing are
     * ignored, a plural counts, and a longer word survives one typo. Anything
     * looser starts accepting wrong answers ("cat" for "car").
     */
    function guessMatches(guess, word) {
        const g = normalizeWord(guess), w = normalizeWord(word);
        if (!g || !w) return false;
        if (g === w) return true;
        if (g === w + 's' || w === g + 's') return true;
        return w.length >= 5 && Math.abs(g.length - w.length) <= 1 && levenshtein(g, w) <= 1;
    }

    // '•••' with leading letters uncovered as the round runs out.
    function wordHint(word, elapsed, total) {
        const frac = total ? elapsed / total : 0;
        let reveal = 0;
        HINT_AT.forEach((t, i) => { if (frac >= t) reveal = i + 1; });
        return String(word || '').split('')
            .map((ch, i) => (ch === ' ' ? ' ' : (i < reveal ? ch.toUpperCase() : '•')))
            .join('');
    }

    // =====================================================================
    // ModeController
    // =====================================================================
    class ModeController {
        constructor(game) {
            this.game = game;

            this.state = null;          // last match state (host-authoritative)
            this.host = null;           // host-only bookkeeping; null on clients
            this.hostTimer = null;

            this.myPlot = null;
            this.model = null;
            this.locked = false;        // I have locked my build in for this round
            this.secretWord = null;     // charades: set only on the builder
            this.accuracy = 0;
            this.sandboxBackup = null;  // world to restore when the match ends
            this.results = null;
            this.builds = new Map();    // name -> cells, during the reveal

            this._ghostVisible = false;
            this._lastProgressSent = 0;
            this._lastDeniedToast = 0;
            this._arenaSig = '';
            this._roundSig = '';
            this._deadline = 0;
            this._tourTimer = null;
            this._tourIndex = 0;
            this._hudTimer = null;
        }

        // ---------- public surface used by the game ----------

        /**
         * Why this cell may not be edited, or null if it may be. Split out from
         * canEdit so a box fill can test a thousand cells without a thousand
         * toasts — see allows().
         */
        _reasonFor(x, y, z) {
            const s = this.state;
            if (!this._matchRunning()) return null;
            if (s.phase !== 'play') return 'Wait for the round to start';
            if (!this.myPlot) {
                return s.mode === 'charades'
                    ? `Only ${s.builder} builds this round — guess in chat!`
                    : 'You are spectating this round';
            }
            if (this.locked) return 'Your build is locked in';
            const p = this.myPlot;
            if (x < p.x0 || x > p.x0 + p.size - 1 || z < p.z0 || z > p.z0 + p.size - 1) {
                return 'Build inside your own plot';
            }
            if (y > BUILD_HEIGHT) return 'Too high for this plot';
            return null;
        }

        /** Silent check. */
        allows(x, y, z) { return !this._reasonFor(x, y, z); }

        /** Sandbox rules unless a round is actually running; explains refusals. */
        canEdit(x, y, z) {
            const reason = this._reasonFor(x, y, z);
            if (reason) return this._deny(reason);
            return true;
        }

        /**
         * Blueprint Race keeps builds secret, so edits stay on the local client.
         * Charades is the opposite: the room has to watch the builder work.
         */
        shouldBroadcastEdit() {
            return !this._matchRunning() || this.relaysEdits();
        }

        relaysEdits() {
            return !!(this.state && this.state.relayEdits);
        }

        /**
         * Host-side: the builder is muted for the whole round. The local client
         * already swallows their typing, but the host must not take its word
         * for it — a chat line from the builder would hand out the answer.
         */
        chatBlockedFor(name) {
            const s = this.state;
            return !!(s && s.mode === 'charades' && s.phase === 'play' && name === s.builder);
        }

        /** Host-side: during a match only the current builder may edit. */
        canRelayEditFrom(name) {
            if (!this._matchRunning()) return true;
            if (!this.relaysEdits()) return false;
            return !!name && name === this.state.builder;
        }

        /** The sandbox world must not be overwritten by a match in progress. */
        isMatchActive() {
            return !!(this.state && this.state.mode && this.state.mode !== 'sandbox');
        }

        onLocalEdit() {
            if (!this._matchRunning() || !this.myPlot) return;
            this._recomputeAccuracy();
            this._renderHud();
            this._sendProgress();
        }

        onPlayersChanged() {
            if (this.host && this.state && this.state.phase === 'final') this._hostBroadcastState();
        }

        /** A new host inherits nothing, so an in-flight match cannot continue. */
        onBecomeHost() {
            if (this.isMatchActive() && !this.host) {
                this.game.showToast('Host left — match ended', 'warning', 3000);
                this._broadcast({ k: 'end' });
                this._endMatch();
            }
        }

        handleMessage(peerId, msg) {
            const from = msg.name || (msg._fromClient) || peerId;
            switch (msg.k) {
                case 'state':
                    if (this.host) return;             // I run the clock; ignore echoes
                    this._applyState(msg.s);
                    break;
                case 'results':
                    if (this.host) return;
                    this._applyResults(msg.r);
                    break;
                case 'build':
                    this.builds.set(msg.name, msg.cells || []);
                    this._paintBuild(msg.name, msg.cells || []);
                    break;
                case 'end':
                    if (!this.host) this._endMatch();
                    break;
                case 'progress':
                    if (this.host && this.host.progress) {
                        this.host.progress.set(from, msg.n | 0);
                    }
                    break;
                case 'submit':
                    if (this.host) this._hostRecordSubmit(from, msg);
                    break;
                case 'guess':
                    if (this.host) this.hostHandleGuess(from, msg.text);
                    break;
                case 'word':
                    // Sent to the builder only.
                    this.secretWord = msg.word;
                    this._renderHud();
                    break;
                case 'guessed':
                    this.game.addChatMessage(msg.name,
                        `guessed it — it was “${msg.word}” 🎉`, { system: true });
                    break;
            }
        }

        /**
         * A line the local player typed. During a charades round it is a guess,
         * not chat: it goes to the host to be judged instead of to the room, so
         * a correct answer never leaks to the other guessers.
         */
        handleLocalChat(text) {
            const s = this.state;
            if (!s || s.mode !== 'charades' || s.phase !== 'play') return false;
            if (s.builder === this.game.username) {
                this.game.showToast('No words! 🤫 Build it instead', 'warning', 1800);
                return true;
            }
            if (s.guessedBy) return false;      // already solved — plain chat again
            if (this.host) this.hostHandleGuess(this.game.username, text);
            else this._send({ k: 'guess', name: this.game.username, text });
            this.game.addChatMessage(this.game.username, text, { me: true, guess: true });
            return true;
        }

        // ---------- match lifecycle (host) ----------

        startMatch(modeId, opts) {
            if (!this.game.isHost()) {
                this.game.showToast('Only the host can start a match', 'warning');
                return;
            }
            const mode = MODES.find(m => m.id === modeId);
            if (!mode || !mode.ready) {
                this.game.showToast('That mode is not available yet', 'warning');
                return;
            }
            opts = opts || {};
            this.host = {
                mode: modeId,
                rounds: opts.rounds || 3,
                roundTime: opts.roundTime || 180,
                round: 0,
                elapsed: 0,
                usedModels: [],
                usedWords: [],
                totals: new Map(),
                plots: [],
                modelId: null,
                word: null,
                builder: null,
                guessed: null,
                phase: 'idle',
                remain: 0,
                submissions: new Map(),
                progress: new Map(),
                locked: new Set()
            };
            this._hostBeginRound();
            clearInterval(this.hostTimer);
            this.hostTimer = setInterval(() => this._hostTick(), 1000);
        }

        endMatch() {
            if (this.host) {
                this._broadcast({ k: 'end' });
                this._endMatch();
                // Put the sandbox back on everyone's screen from the host's copy.
                setTimeout(() => this.game.restoreSandbox(), 300);
            }
        }

        _hostBeginRound() {
            const h = this.host;
            h.round++;
            const players = this._eligiblePlayers();
            h.submissions.clear();
            h.progress.clear();
            h.locked.clear();
            h.elapsed = 0;
            h.guessed = null;

            if (h.mode === 'charades') {
                // One stage in the middle of the world; the builder rotates so
                // everyone takes a turn over the course of a match.
                h.builder = players[(h.round - 1) % players.length];
                h.plots = [{
                    name: h.builder,
                    x0: -Math.floor(STAGE_SIZE / 2),
                    z0: -Math.floor(STAGE_SIZE / 2),
                    size: STAGE_SIZE
                }];
                h.modelId = null;
                h.word = Models.pickWord(h.usedWords);
                h.usedWords.push(h.word);
                this._hostSendWord();
            } else {
                h.builder = null;
                h.word = null;
                h.plots = computePlots(players);
                const diff = Models.difficultyForRound(h.round, h.rounds);
                const model = Models.pick(diff, h.usedModels);
                h.usedModels.push(model.id);
                h.modelId = model.id;
            }
            this._hostPhase('countdown', COUNTDOWN_SECS);
        }

        // The word goes to the builder alone — it can never ride along in the
        // broadcast state, which everyone in the room receives.
        _hostSendWord() {
            const h = this.host;
            if (h.builder === this.game.username) this.secretWord = h.word;
            else this.game.sendData({ type: 'mode', k: 'word', word: h.word }, h.builder);
        }

        _hostPhase(phase, secs) {
            const h = this.host;
            h.phase = phase;
            h.remain = secs;
            this._hostPublish();
        }

        _hostTick() {
            const h = this.host;
            if (!h) return;
            if (h.phase === 'final') return;           // waits for the host to decide

            h.remain--;
            if (h.phase === 'play') h.elapsed++;

            if (h.remain > 0) { this._hostPublish(); return; }

            const charades = h.mode === 'charades';
            switch (h.phase) {
                // Charades needs no study phase (the builder alone has the word)
                // and no scoring window (every edit was already relayed live).
                case 'countdown': this._hostPhase(charades ? 'play' : 'study', charades ? h.roundTime : STUDY_SECS); break;
                case 'study':     this._hostPhase('play', h.roundTime); break;
                case 'play':      charades ? this._hostFinishRound() : this._hostPhase('scoring', SCORING_SECS); break;
                case 'scoring':   this._hostFinishRound(); break;
                case 'reveal':
                    if (h.round >= h.rounds) this._hostPhase('final', 0);
                    else this._hostBeginRound();
                    break;
                default: this._hostPublish();
            }
        }

        _hostRecordSubmit(name, msg) {
            const h = this.host;
            if (!h || !h.plots.some(p => p.name === name)) return;
            // A locked-in build is final: the end-of-round sweep must not
            // overwrite it, or the lock time (and its bonus) would be lost.
            const prev = h.submissions.get(name);
            if (prev && prev.locked && !msg.locked) return;
            h.submissions.set(name, {
                cells: (msg.cells || []).slice(0, MAX_SUBMIT_CELLS),
                locked: !!msg.locked,
                at: h.phase === 'play' ? h.elapsed : h.roundTime
            });
            if (msg.locked) {
                h.locked.add(name);
                this._hostPublish();
                // Everyone is done — no reason to keep the clock running.
                if (h.phase === 'play' && h.plots.every(p => h.locked.has(p.name))) {
                    this._hostPhase('scoring', SCORING_SECS);
                }
            }
        }

        /**
         * A guess from a player (host-side only). Wrong guesses are echoed to
         * the room as chat — half the fun is watching people converge — while a
         * right one ends the round immediately and is never repeated aloud.
         */
        hostHandleGuess(name, text) {
            const h = this.host;
            if (!h || h.mode !== 'charades' || h.phase !== 'play') return false;
            if (name === h.builder || h.guessed) return false;

            if (!guessMatches(text, h.word)) {
                this.game.relayChat({ name, text, guess: true });
                return true;
            }
            h.guessed = { name, at: h.elapsed };
            this._broadcast({ k: 'guessed', name, word: h.word, at: h.elapsed });
            // The host never receives its own broadcast, so it says it locally.
            this.game.addChatMessage(name, `guessed it — it was “${h.word}” 🎉`, { system: true });
            this._hostFinishRound();
            return true;
        }

        _hostFinishCharades() {
            const h = this.host;
            const players = this._eligiblePlayers();
            const frac = h.guessed ? Math.max(0, (h.roundTime - h.guessed.at) / h.roundTime) : 0;

            const rows = players.map(name => {
                const isBuilder = name === h.builder;
                const isGuesser = !!(h.guessed && h.guessed.name === name);
                // The guesser is paid for speed; the builder is paid for being
                // understood, on the same clock, so clarity beats showing off.
                const points = isGuesser ? 50 + Math.round(50 * frac)
                    : (isBuilder && h.guessed ? 40 + Math.round(40 * frac) : 0);
                h.totals.set(name, (h.totals.get(name) || 0) + points);
                return {
                    name, points, isBuilder, isGuesser,
                    note: isBuilder
                        ? (h.guessed ? 'built it' : 'nobody guessed it')
                        : (isGuesser ? `guessed in ${h.guessed.at}s` : '—')
                };
            }).sort((a, b) => b.points - a.points);

            const totals = Array.from(h.totals.entries())
                .map(([name, points]) => ({ name, points }))
                .sort((a, b) => b.points - a.points);

            const results = {
                mode: 'charades', round: h.round, rounds: h.rounds,
                word: h.word, builder: h.builder,
                guessedBy: h.guessed ? h.guessed.name : null,
                rows, totals, isFinal: h.round >= h.rounds
            };
            this._hostPhase('reveal', CHARADES_REVEAL_SECS);
            this._broadcast({ k: 'results', r: results });
            this._applyResults(results);
            if (results.isFinal) this.game.recordMatchStats(results);
        }

        _hostFinishRound() {
            const h = this.host;
            if (h.mode === 'charades') { this._hostFinishCharades(); return; }
            const model = Models.byId(h.modelId);
            const target = Models.decode(model);

            const rows = h.plots.map(p => {
                const sub = h.submissions.get(p.name);
                const cells = (sub && sub.cells) || [];
                const built = cells.map(a => ({ x: a[0], y: a[1], z: a[2], c: a[3], s: a[4] | 0 }));
                const sc = scoreBuild(target, built);
                const at = sub ? sub.at : h.roundTime;
                const timeLeft = Math.max(0, h.roundTime - at);
                // Locking in early is the only way to earn the speed bonus, and
                // it scales with accuracy so a fast wrong build gains nothing.
                const bonus = (sub && sub.locked)
                    ? Math.round(50 * (timeLeft / h.roundTime) * (sc.pct / 100)) : 0;
                const points = Math.round(sc.pct) + bonus;
                h.totals.set(p.name, (h.totals.get(p.name) || 0) + points);
                return {
                    name: p.name, pct: sc.pct, points, bonus,
                    matched: sc.matched, missing: sc.missing, extra: sc.extra,
                    blocks: sc.builtCount, target: sc.targetCount,
                    locked: !!(sub && sub.locked), at
                };
            }).sort((a, b) => b.points - a.points);

            const totals = Array.from(h.totals.entries())
                .map(([name, points]) => ({ name, points }))
                .sort((a, b) => b.points - a.points);

            const results = {
                mode: 'blueprint', round: h.round, rounds: h.rounds, modelId: h.modelId,
                modelName: model ? model.name : '', modelEmoji: model ? model.emoji : '',
                rows, totals, isFinal: h.round >= h.rounds
            };

            this._hostPhase('reveal', REVEAL_SECS);
            // Builds go out one message per player: a single combined payload
            // would be big enough to bump into data-channel size limits.
            h.plots.forEach(p => {
                const sub = h.submissions.get(p.name);
                const cells = (sub && sub.cells) || [];
                this._broadcast({ k: 'build', name: p.name, cells });
                this.builds.set(p.name, cells);
                this._paintBuild(p.name, cells);
            });
            this._broadcast({ k: 'results', r: results });
            this._applyResults(results);
            if (results.isFinal) this.game.recordMatchStats(results);
        }

        _hostState() {
            const h = this.host;
            const progress = {};
            h.progress.forEach((n, name) => { progress[name] = n; });
            return {
                mode: h.mode,
                phase: h.phase,
                round: h.round,
                rounds: h.rounds,
                remain: Math.max(0, h.remain),
                total: this._phaseTotal(h.phase, h.roundTime),
                elapsed: h.elapsed,
                roundTime: h.roundTime,
                modelId: h.modelId,
                plots: h.plots,
                locked: Array.from(h.locked),
                progress,
                peek: this._peekNow(h),
                nextPeek: this._nextPeekIn(h),
                // charades
                builder: h.builder,
                hint: h.mode === 'charades' && h.phase === 'play'
                    ? wordHint(h.word, h.elapsed, h.roundTime) : '',
                guessedBy: h.guessed ? h.guessed.name : null,
                // Only a race hides what the others are doing; in charades the
                // whole point is that the room watches the builder work.
                hideRivals: h.mode !== 'charades',
                relayEdits: h.mode === 'charades'
            };
        }

        _hostPublish() {
            const s = this._hostState();
            this._broadcast({ k: 'state', s });
            this._applyState(s);
        }

        _hostBroadcastState() { if (this.host) this._hostPublish(); }

        _phaseTotal(phase, roundTime) {
            const charades = this.host && this.host.mode === 'charades';
            switch (phase) {
                case 'countdown': return COUNTDOWN_SECS;
                case 'study': return STUDY_SECS;
                case 'play': return roundTime;
                case 'scoring': return SCORING_SECS;
                case 'reveal': return charades ? CHARADES_REVEAL_SECS : REVEAL_SECS;
                default: return 1;
            }
        }

        _peekNow(h) {
            if (h.phase !== 'play') return false;
            return h.elapsed >= PEEK_EVERY && (h.elapsed % PEEK_EVERY) < PEEK_LEN;
        }

        _nextPeekIn(h) {
            if (h.phase !== 'play') return 0;
            const into = h.elapsed % PEEK_EVERY;
            return into < PEEK_LEN && h.elapsed >= PEEK_EVERY ? 0 : (PEEK_EVERY - into);
        }

        _eligiblePlayers() {
            let users = [];
            try { users = this.game.getConnectedUsers() || []; } catch (e) { users = []; }
            const all = Array.from(new Set([this.game.username, ...users].filter(Boolean)));
            return all;
        }

        // ---------- applying state (host and client alike) ----------

        _applyState(s) {
            if (!s) return;
            const prev = this.state;
            this.state = s;
            this._deadline = Date.now() + s.remain * 1000;

            // First state of a match: stash the sandbox before the arena
            // overwrites the world. Late joiners take this path too.
            if (!this.sandboxBackup && s.mode && s.mode !== 'sandbox') this._enterMatch();

            this.myPlot = (s.plots || []).find(p => p.name === this.game.username) || null;
            this.model = Models.byId(s.modelId);
            this.game.setToolsVisible(!!this.myPlot);

            const roundSig = s.mode + '#' + s.round;
            if (roundSig !== this._roundSig) {
                this._roundSig = roundSig;
                this._startRound();
            }

            const arenaSig = JSON.stringify(s.plots || []);
            if (arenaSig !== this._arenaSig) {
                this._arenaSig = arenaSig;
                this._buildArena();
            }

            this._syncPhaseVisuals(prev);
            this._renderPads();
            this._renderHud();
            this._startHudTicker();
        }

        _enterMatch() {
            const g = this.game;
            this.sandboxBackup = g.voxels.encode();
            g.voxels.clearAll();
            g.undoStack.length = 0;
            g.redoStack.length = 0;
            g.hidePlayHint();
            this._showHud(true);
        }

        _startRound() {
            const g = this.game;
            this.locked = false;
            this.accuracy = 0;
            this.results = null;
            this.builds.clear();
            this._stopTour();
            g.voxels.clearAll();
            g.voxels.clearGhosts();
            this._ghostVisible = false;
            g.undoStack.length = 0;
            g.redoStack.length = 0;
            g.hideResults();
            const s = this.state;
            const charades = s.mode === 'charades';
            if (charades) {
                // Only the builder holds the word; everyone else watches the stage.
                if (s.builder !== g.username) this.secretWord = null;
                g.openChat(true);
            }

            if (this.myPlot) {
                const c = this._plotCentre(this.myPlot);
                g.voxels.focus(c.x, 2, c.z, this.myPlot.size * 2.4, PLOT_VIEW_PHI);
            } else if (charades && (s.plots || []).length) {
                const c = this._plotCentre(s.plots[0]);      // watch the builder
                g.voxels.focus(c.x, 2, c.z, s.plots[0].size * 2.4, PLOT_VIEW_PHI);
            } else if ((s.plots || []).length) {
                g.voxels.focus(0, 3, 0, 44, PLOT_VIEW_PHI);  // spectator: the whole arena
            }
        }

        _syncPhaseVisuals(prev) {
            const s = this.state;
            const phase = s.phase;
            const wasPhase = prev && prev.phase;
            if (phase !== wasPhase) this.game._updateChatMode();

            // Charades has no blueprint to ghost and nothing to submit — the
            // build was relayed live and the word is judged by the host.
            if (s.mode === 'charades') {
                if (phase === 'play' && wasPhase !== 'play') {
                    this.game.showToast(s.builder === this.game.username
                        ? 'Build it — no words! 🤫'
                        : `Guess what ${s.builder} is building 👀`, 'info', 2200);
                }
                return;
            }

            // Blueprint ghost: free look during study, flashes during a peek,
            // and stays up over every plot through the reveal for comparison.
            // Rebuild the ghost only when it actually appears or disappears —
            // this runs on every state tick.
            const showMine = (phase === 'study') || (phase === 'play' && s.peek);
            if (showMine && this.myPlot && this.model) {
                if (!this._ghostVisible) {
                    this._showGhostIn(this.myPlot, 'mine', true);
                    this._ghostVisible = true;
                }
            } else if (phase !== 'reveal') {
                if (this._ghostVisible) {
                    this.game.voxels.clearGhosts();
                    this._ghostVisible = false;
                }
            }

            if (phase === 'reveal' && wasPhase !== 'reveal') {
                // Every plot gets the blueprint ghosted over it, so what each
                // player missed or added is visible at a glance.
                this.game.voxels.clearGhosts();
                this._ghostVisible = false;
                (s.plots || []).forEach(p => this._showGhostIn(p, 'plot:' + p.name));
                this._startTour();
            }

            // Send my build up as soon as scoring opens (a locked-in build was
            // already sent, but re-sending is harmless — last write wins).
            if (phase === 'scoring' && wasPhase !== 'scoring') this._submitBuild(false);

            if (phase === 'play' && wasPhase === 'study' && this.myPlot) {
                this.game.showToast('Go! Rebuild it 🧱', 'success', 1500);
            }
            if (phase === 'play' && s.peek && !(prev && prev.peek)) {
                this.game.showToast('👀 Blueprint!', 'info', 1200);
            }
        }

        // `strong` is the blueprint you are studying; the faint set is the
        // comparison overlay laid over finished builds at the reveal.
        _showGhostIn(plot, id, strong) {
            if (!this.model) return;
            const o = modelOrigin(plot, this.model);
            this.game.voxels.showGhost(id, Models.decode(this.model), o.x, o.z, strong);
        }

        _plotCentre(plot) {
            return { x: plot.x0 + plot.size / 2, z: plot.z0 + plot.size / 2 };
        }

        // ---------- arena rendering ----------

        _buildArena() {
            const s = this.state;
            const g = this.game;
            const pads = (s.plots || []).map(p => ({
                name: p.name, x0: p.x0, z0: p.z0, size: p.size,
                color: g.generateUserColor ? g.generateUserColor(p.name) : '#6366f1',
                mine: p.name === g.username
            }));
            g.voxels.setArena(pads);
        }

        _renderPads() {
            const s = this.state;
            const g = this.game;
            const building = s.phase === 'play' || s.phase === 'study'
                || s.phase === 'countdown' || s.phase === 'scoring';
            const charades = s.mode === 'charades';
            (s.plots || []).forEach(p => {
                const mine = p.name === g.username;
                const n = (s.progress && s.progress[p.name]) || 0;
                const locked = (s.locked || []).indexOf(p.name) >= 0;

                let label = p.name;
                if (charades) {
                    label = mine ? `${p.name} (you) 🤫`
                        : (building ? `${p.name} is building…` : p.name);
                    if (this.results && this.results.word) label = `“${this.results.word}”`;
                } else if (this.results) {
                    const row = this.results.rows.find(r => r.name === p.name);
                    if (row) label = p.name + ' — ' + row.pct + '%';
                } else if (!mine) {
                    label = p.name + '  🧱' + n + (locked ? '  ✅' : '');
                }
                g.voxels.setPadLabel(p.name, label);
                // Rivals stay under a cover until the reveal — but only in the
                // modes where their build is supposed to be a secret.
                g.voxels.setCover(p.name, s.hideRivals !== false && building && !mine);
            });
        }

        _paintBuild(name, cells) {
            const s = this.state;
            if (!s) return;
            const plot = (s.plots || []).find(p => p.name === name);
            if (!plot || !this.model) return;
            if (name === this.game.username) return;    // mine is already standing
            const o = modelOrigin(plot, this.model);
            this.game.voxels.paintCells(cells, o.x, o.z, name);
        }

        // ---------- my build ----------

        _myCells() {
            if (!this.myPlot || !this.model) return [];
            const o = modelOrigin(this.myPlot, this.model);
            return this.game.voxels.cellsInBox({
                x0: this.myPlot.x0, x1: this.myPlot.x0 + this.myPlot.size - 1,
                z0: this.myPlot.z0, z1: this.myPlot.z0 + this.myPlot.size - 1,
                y0: 0, y1: BUILD_HEIGHT
            }, o.x, o.z).slice(0, MAX_SUBMIT_CELLS);
        }

        _recomputeAccuracy() {
            if (!this.model || !this.myPlot) { this.accuracy = 0; return; }
            const built = this._myCells().map(a => ({ x: a[0], y: a[1], z: a[2], c: a[3], s: a[4] | 0 }));
            this.accuracy = scoreBuild(Models.decode(this.model), built).pct;
        }

        _submitBuild(locked) {
            if (!this.myPlot) return;
            if (this.locked && !locked) return;     // the locked-in build already went up
            const cells = this._myCells();
            const msg = { k: 'submit', name: this.game.username, cells, locked: !!locked };
            if (this.host) this._hostRecordSubmit(this.game.username, msg);
            else this._send(msg);
        }

        lockIn() {
            if (!this._matchRunning() || this.state.phase !== 'play' || !this.myPlot) return;
            if (this.locked) return;
            this._recomputeAccuracy();
            this.locked = true;
            this._submitBuild(true);
            this._lastProgressSent = 0;     // let the final count out immediately
            this._sendProgress();
            this.game.showToast(`Locked in at ${this.accuracy}% — nice`, 'success', 2500);
            this._renderHud();
        }

        _sendProgress() {
            const now = Date.now();
            if (now - this._lastProgressSent < PROGRESS_THROTTLE_MS) return;
            this._lastProgressSent = now;
            const n = this._myCells().length;
            if (this.host) this.host.progress.set(this.game.username, n);
            else this._send({ k: 'progress', name: this.game.username, n });
        }

        // ---------- results ----------

        _applyResults(r) {
            this.results = r;
            this._renderResults();
            this._renderPads();
            // Restart the tour now that the ranking is known — it opens on the
            // winner's plot rather than wherever it happened to start.
            if (this.state && this.state.phase === 'reveal') this._startTour();
        }

        _renderResults() {
            const r = this.results;
            if (!r) return;
            const medal = i => ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;

            const totalsOf = () => r.totals.map((t, i) => `
                <div class="rs-total${t.name === this.game.username ? ' me' : ''}">
                    <span>${medal(i)} ${esc(t.name)}</span><span>${t.points}</span>
                </div>`).join('');

            if (r.mode === 'charades') {
                const crows = r.rows.map((row, i) => `
                    <div class="rs-row${row.name === this.game.username ? ' me' : ''}" data-player="${esc(row.name)}">
                        <span class="rs-rank">${medal(i)}</span>
                        <span class="rs-dot" style="background:${this.game.generateUserColor(row.name)}"></span>
                        <span class="rs-name">${esc(row.name)}${row.isBuilder ? ' 🧱' : ''}</span>
                        <span class="rs-pct"></span>
                        <span class="rs-detail">${esc(row.note)}</span>
                        <span class="rs-points">${row.points}</span>
                    </div>`).join('');
                this.game.showResults({
                    title: r.isFinal ? '🏆 Final standings' : `Round ${r.round} of ${r.rounds}`,
                    subtitle: r.guessedBy
                        ? `<strong>${esc(r.guessedBy)}</strong> guessed <strong>${esc(r.word)}</strong> — built by ${esc(r.builder)}`
                        : `Nobody got it. ${esc(r.builder)} was building <strong>${esc(r.word)}</strong>`,
                    body: `<div class="rs-list">${crows}</div>
                           <div class="rs-totals-title">Match points</div>
                           <div class="rs-totals">${totalsOf()}</div>`,
                    isFinal: r.isFinal,
                    canControl: this.game.isHost()
                });
                return;
            }

            const rows = r.rows.map((row, i) => `
                <div class="rs-row${row.name === this.game.username ? ' me' : ''}" data-player="${esc(row.name)}">
                    <span class="rs-rank">${medal(i)}</span>
                    <span class="rs-dot" style="background:${this.game.generateUserColor(row.name)}"></span>
                    <span class="rs-name">${esc(row.name)}</span>
                    <span class="rs-pct">${row.pct}%</span>
                    <span class="rs-detail">${row.matched}/${row.target} placed${row.extra ? ` · ${row.extra} extra` : ''}${row.locked ? ` · locked at ${fmt(row.at)}` : ''}</span>
                    <span class="rs-points">${row.points}${row.bonus ? `<span class="rs-bonus">+${row.bonus} speed</span>` : ''}</span>
                </div>`).join('');

            const totals = totalsOf();

            this.game.showResults({
                title: r.isFinal ? '🏆 Final standings' : `Round ${r.round} of ${r.rounds}`,
                subtitle: `The blueprint was ${r.modelEmoji || ''} <strong>${esc(r.modelName)}</strong>`,
                body: `<div class="rs-list">${rows}</div>
                       <div class="rs-totals-title">Match points</div>
                       <div class="rs-totals">${totals}</div>`,
                isFinal: r.isFinal,
                canControl: this.game.isHost()
            });
        }

        // ---------- reveal camera tour ----------

        _startTour() {
            this._stopTour();
            const plots = (this.state.plots || []);
            if (!plots.length) return;
            // Start on the winner if the results have landed, else on my own plot.
            const first = this.results && this.results.rows.length
                ? plots.findIndex(p => p.name === this.results.rows[0].name)
                : plots.findIndex(p => p.name === this.game.username);
            this._tourIndex = Math.max(0, first);
            this._focusTour();
            this._tourTimer = setInterval(() => {
                this._tourIndex = (this._tourIndex + 1) % plots.length;
                this._focusTour();
            }, TOUR_SECS * 1000);
        }

        _focusTour() {
            const plots = (this.state.plots || []);
            const p = plots[this._tourIndex];
            if (!p) return;
            const c = this._plotCentre(p);
            this.game.voxels.focus(c.x, 2, c.z, p.size * 2.3, PLOT_VIEW_PHI);
        }

        focusPlayer(name) {
            const p = (this.state && this.state.plots || []).find(q => q.name === name);
            if (!p) return;
            this._stopTour();
            const c = this._plotCentre(p);
            this.game.voxels.focus(c.x, 2, c.z, p.size * 2.2, PLOT_VIEW_PHI);
        }

        _stopTour() {
            clearInterval(this._tourTimer);
            this._tourTimer = null;
        }

        // ---------- HUD ----------

        _showHud(on) {
            const hud = document.getElementById('matchHud');
            if (hud) hud.classList.toggle('hidden', !on);
        }

        _startHudTicker() {
            if (this._hudTimer) return;
            this._hudTimer = setInterval(() => {
                if (!this.isMatchActive()) { clearInterval(this._hudTimer); this._hudTimer = null; return; }
                this._renderHud();
                // Keep rivals' block counters live even when I stop editing:
                // pinging only on edit leaves the last burst's count on screen.
                const s = this.state;
                if (s && s.phase === 'play' && this.myPlot && !this.locked) this._sendProgress();
            }, 200);
        }

        _remainNow() {
            return Math.max(0, (this._deadline - Date.now()) / 1000);
        }

        _renderHud() {
            const s = this.state;
            if (!s || !this.isMatchActive()) return;
            const mode = MODES.find(m => m.id === s.mode);
            const remain = this._remainNow();
            const total = s.total || 1;

            setText('mhMode', `${mode ? mode.emoji : ''} ${mode ? mode.name : ''}`);
            setText('mhRound', `Round ${s.round}/${s.rounds}`);

            const charades = s.mode === 'charades';
            const iBuild = charades && s.builder === this.game.username;

            let phaseText;
            switch (s.phase) {
                case 'countdown': phaseText = charades
                    ? `${iBuild ? 'You build' : s.builder + ' builds'} next… ${Math.ceil(remain)}`
                    : `Get ready… ${Math.ceil(remain)}`; break;
                case 'study': phaseText = `📐 Study the blueprint — ${Math.ceil(remain)}s`; break;
                case 'play':
                    if (charades) phaseText = `${iBuild ? 'Build it!' : 'Guess!'} ${fmt(remain)}`;
                    else phaseText = this.myPlot
                        ? (this.locked ? '✅ Locked in — waiting for the others' : `Build! ${fmt(remain)}`)
                        : `Spectating — ${fmt(remain)}`;
                    break;
                case 'scoring': phaseText = 'Scoring…'; break;
                case 'reveal': phaseText = '👀 Reveal'; break;
                case 'final': phaseText = '🏆 Match over'; break;
                default: phaseText = '';
            }
            setText('mhPhase', phaseText);

            const fill = document.getElementById('mhTimerFill');
            if (fill) {
                const pct = Math.max(0, Math.min(100, (remain / total) * 100));
                fill.style.width = pct + '%';
                fill.classList.toggle('urgent', s.phase === 'play' && remain <= 15);
                fill.classList.toggle('peek', !!s.peek);
            }

            const acc = document.getElementById('mhAccuracy');
            if (acc) {
                // Same slot, different job per mode: your live accuracy in a
                // race, the secret word (or its hint) in charades.
                const show = charades
                    ? (s.phase === 'play' || s.phase === 'countdown')
                    : (this.myPlot && (s.phase === 'play' || s.phase === 'scoring'));
                acc.classList.toggle('hidden', !show);
                if (show && charades) {
                    acc.textContent = iBuild
                        ? `🤫 ${String(this.secretWord || '…').toUpperCase()}`
                        : (s.hint || '• • •');
                    acc.className = 'mh-acc ' + (iBuild ? 'word' : 'hint');
                } else if (show) {
                    acc.textContent = `Match ${this.accuracy}%`;
                    acc.className = 'mh-acc ' + (this.accuracy >= 85 ? 'good' : this.accuracy >= 50 ? 'mid' : 'low');
                }
            }

            const peek = document.getElementById('mhPeek');
            if (peek) {
                const show = s.phase === 'play' && (charades || this.myPlot);
                peek.classList.toggle('hidden', !show);
                if (show && charades) {
                    peek.textContent = iBuild ? 'No words allowed' : `${s.builder} is building`;
                } else if (show) {
                    peek.textContent = s.peek ? '👀 Blueprint visible' : `Next peek in ${s.nextPeek}s`;
                }
            }

            const lock = document.getElementById('mhLockBtn');
            if (lock) {
                const show = !charades && s.phase === 'play' && this.myPlot && !this.locked;
                lock.classList.toggle('hidden', !show);
            }

            const leave = document.getElementById('mhEndBtn');
            if (leave) leave.classList.toggle('hidden', !this.game.isHost());
        }

        // ---------- teardown ----------

        _endMatch() {
            const g = this.game;
            clearInterval(this.hostTimer); this.hostTimer = null;
            clearInterval(this._hudTimer); this._hudTimer = null;
            this._stopTour();
            this.host = null;
            this.state = null;
            this.myPlot = null;
            this.model = null;
            this.results = null;
            this.locked = false;
            this.secretWord = null;
            this._arenaSig = '';
            this._roundSig = '';
            this.builds.clear();

            g.voxels.clearArena();
            g.voxels.clearGhosts();
            this._ghostVisible = false;
            g.voxels.clearAll();
            g.undoStack.length = 0;
            g.redoStack.length = 0;
            if (this.sandboxBackup) {
                g.voxels.replaceFrom(this.sandboxBackup);
                this.sandboxBackup = null;
            }
            g._updateBlockCount();
            this._showHud(false);
            g.hideResults();
            g.showPlayHint();
            g.setToolsVisible(true);
            g._updateChatMode();
        }

        // ---------- plumbing ----------

        _matchRunning() {
            return !!(this.state && this.state.mode && this.state.mode !== 'sandbox');
        }

        _deny(reason) {
            const now = Date.now();
            if (now - this._lastDeniedToast > 2500) {
                this._lastDeniedToast = now;
                this.game.showToast(reason, 'warning', 1600);
            }
            return false;
        }

        _send(msg) {
            this.game.sendData(Object.assign({ type: 'mode' }, msg));
        }

        _broadcast(msg) {
            this.game.sendData(Object.assign({ type: 'mode' }, msg));
        }
    }

    // ---- small helpers ----
    function setText(id, text) {
        const el = document.getElementById(id);
        if (el && el.textContent !== text) el.textContent = text;
    }

    function fmt(secs) {
        const s = Math.max(0, Math.round(secs));
        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }

    function esc(s) {
        return String(s).replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    window.BlockPartyModes = {
        MODES, ModeController, computePlots, scoreBuild, modelOrigin,
        BUILD_HEIGHT, WORLD_HALF
    };
})();
