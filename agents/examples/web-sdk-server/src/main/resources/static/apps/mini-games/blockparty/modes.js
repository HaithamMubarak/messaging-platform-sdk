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

    // Memory Match: the architect builds for this long while the room watches.
    const ARCHITECT_SECS = 45;
    // Block Rush: how long the room gets to vote, then to read the tally.
    const VOTE_SECS = 20;
    const TALLY_SECS = 10;
    // Territory is a floor fight, not a tower contest.
    const TERRITORY_HEIGHT = 4;
    const SHARED = '*';           // plot name meaning "everyone builds here"

    /**
     * Each mode is a sequence of phases and a few rules. Keeping the sequence
     * declarative is what makes a new mode mostly a matter of describing it:
     *   relay     — are edits broadcast live (watchers) or kept secret (races)?
     *   hide      — are rivals' plots covered while they build?
     *   scoreAt   — the phase whose end produces the round's result
     *   buildsAt  — the phase whose end publishes everyone's build to the room
     */
    const RULES = {
        blueprint: {
            flow: ['countdown', 'study', 'play', 'scoring', 'reveal'],
            relay: false, hide: true, scoreAt: 'scoring', buildsAt: 'scoring'
        },
        charades: {
            flow: ['countdown', 'play', 'reveal'],
            relay: true, hide: false, scoreAt: 'play'
        },
        teambuild: {
            flow: ['countdown', 'study', 'play', 'reveal'],
            relay: true, hide: false, scoreAt: 'play', shared: true
        },
        memory: {
            flow: ['countdown', 'architect', 'play', 'scoring', 'reveal'],
            relay: 'architect', hide: true, scoreAt: 'scoring', buildsAt: 'scoring'
        },
        rush: {
            flow: ['countdown', 'play', 'scoring', 'reveal', 'vote', 'tally'],
            relay: false, hide: true, scoreAt: 'vote', buildsAt: 'scoring'
        },
        territory: {
            flow: ['countdown', 'play', 'reveal'],
            relay: true, hide: false, scoreAt: 'play', shared: true,
            height: TERRITORY_HEIGHT
        }
    };

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
            id: 'teambuild', name: 'Team Build', emoji: '🤝', ready: true, defaultTime: 180,
            desc: 'One blueprint, one plot, everyone at once. Talk it out in chat — the room shares a single score, and you can see who laid what.'
        },
        {
            id: 'memory', name: 'Memory Match', emoji: '🧠', ready: true, defaultTime: 120,
            desc: 'One player builds while the room watches. Then it vanishes and everybody rebuilds it from memory. The architect scores on how well you remembered.'
        },
        {
            id: 'rush', name: 'Block Rush', emoji: '⚡', ready: true, defaultTime: 90,
            desc: 'A creative prompt, no blueprint, nothing to copy. Builds are revealed together and the room votes for its favourite.'
        },
        {
            id: 'territory', name: 'Territory', emoji: '🚩', ready: true, defaultTime: 120,
            desc: 'One shared arena, every block wears your colour. Build over rivals, tear theirs down — most blocks standing at the whistle wins.'
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

    // Slide a set of cell rows so their bounding box starts at the origin on
    // X/Z. Memory Match uses this so that remembering the *shape* is what
    // scores, not where in the plot you happened to start.
    function normalizeCells(rows) {
        if (!rows || !rows.length) return [];
        let minX = Infinity, minZ = Infinity;
        rows.forEach(r => {
            if (r[0] < minX) minX = r[0];
            if (r[2] < minZ) minZ = r[2];
        });
        return rows.map(r => [r[0] - minX, r[1], r[2] - minZ, r[3], r[4]]);
    }

    function toCell(r) { return { x: r[0], y: r[1], z: r[2], c: r[3], s: r[4] | 0 }; }

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
            this.voted = null;          // block rush: who I voted for
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
            if (!this._buildPhase()) {
                if (s.mode === 'memory' && s.phase === 'architect') {
                    return `Watch closely — ${s.builder} is building`;
                }
                if (s.phase === 'vote') return 'Voting now — pick your favourite';
                return 'Wait for the round to start';
            }
            const area = this.myArea();
            if (!area) {
                if (s.mode === 'charades') return `Only ${s.builder} builds this round — guess in chat!`;
                if (s.mode === 'memory') return 'You built it — let the others remember';
                return 'You are spectating this round';
            }
            if (this.locked) return 'Your build is locked in';
            if (x < area.x0 || x > area.x0 + area.size - 1 || z < area.z0 || z > area.z0 + area.size - 1) {
                return area.shared ? 'Build inside the arena' : 'Build inside your own plot';
            }
            if (y > (s.buildHeight || BUILD_HEIGHT)) return 'Too high for this round';
            return null;
        }

        /** Is this a phase where I, specifically, may build? */
        _buildPhase() {
            const s = this.state;
            if (!s) return false;
            if (s.mode === 'memory') {
                return (s.phase === 'architect' && s.builder === this.game.username)
                    || (s.phase === 'play' && s.builder !== this.game.username);
            }
            return s.phase === 'play';
        }

        /** The plot I may edit: my own, or the arena everybody shares. */
        myArea() {
            if (this.myPlot) return this.myPlot;
            const shared = (this.state && this.state.plots || []).find(p => p.shared);
            return shared || null;
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
            // On a shared arena everyone's edits are everyone's business; when
            // the room is watching one person, only that person's are.
            const shared = (this.state.plots || []).some(p => p.shared);
            if (shared) return !!name;
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
                case 'vote':
                    if (this.host) this.hostHandleVote(from, msg.for);
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

            h.builder = null;
            h.word = null;
            h.prompt = null;
            h.modelId = null;
            h.target = null;
            h.votes = new Map();

            const stage = (name) => [{
                name, x0: -Math.floor(STAGE_SIZE / 2), z0: -Math.floor(STAGE_SIZE / 2), size: STAGE_SIZE
            }];
            const takeModel = () => {
                const diff = Models.difficultyForRound(h.round, h.rounds);
                const model = Models.pick(diff, h.usedModels);
                h.usedModels.push(model.id);
                h.modelId = model.id;
            };

            switch (h.mode) {
                case 'charades':
                    // One stage in the middle of the world; the builder rotates
                    // so everyone takes a turn over the course of a match.
                    h.builder = players[(h.round - 1) % players.length];
                    h.plots = stage(h.builder);
                    h.word = Models.pickWord(h.usedWords);
                    h.usedWords.push(h.word);
                    this._hostSendWord();
                    break;

                case 'memory':
                    // The architect works on the stage; the rebuild plots are
                    // laid out later, once their build has been taken away.
                    h.builder = players[(h.round - 1) % players.length];
                    h.plots = stage(h.builder);
                    h.rebuilders = players.filter(n => n !== h.builder);
                    break;

                case 'rush':
                    h.prompt = Models.pickPrompt(h.usedWords);
                    h.usedWords.push(h.prompt);
                    h.plots = computePlots(players);
                    break;

                case 'teambuild':
                    // One plot the whole room shares, big enough to work around.
                    h.plots = [{ name: SHARED, shared: true, x0: -9, z0: -9, size: 18 }];
                    takeModel();
                    break;

                case 'territory':
                    h.plots = [{ name: SHARED, shared: true, x0: -11, z0: -11, size: 22 }];
                    break;

                default:
                    h.plots = computePlots(players);
                    takeModel();
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
            if (h.phase === 'play' || h.phase === 'architect') h.elapsed++;

            if (h.remain > 0) { this._hostPublish(); return; }

            // Walk this mode's declared sequence; the hooks below are where the
            // modes actually differ.
            const flow = RULES[h.mode].flow;
            const at = flow.indexOf(h.phase);
            this._hostLeavePhase(h.phase);
            if (at < 0 || at === flow.length - 1) {
                if (h.round >= h.rounds) this._hostPhase('final', 0);
                else this._hostBeginRound();
                return;
            }
            const next = flow[at + 1];
            this._hostPhase(next, this._phaseSecs(next));
        }

        _phaseSecs(phase) {
            const h = this.host;
            switch (phase) {
                case 'countdown': return COUNTDOWN_SECS;
                case 'study': return STUDY_SECS;
                case 'architect': return ARCHITECT_SECS;
                case 'play': return h.roundTime;
                case 'scoring': return SCORING_SECS;
                case 'vote': return VOTE_SECS;
                case 'tally': return TALLY_SECS;
                case 'reveal': return h.mode === 'charades' ? CHARADES_REVEAL_SECS : REVEAL_SECS;
                default: return 1;
            }
        }

        /**
         * Everything that happens *because* a phase ended: the architect's build
         * is taken away and kept as the answer, builds are published, and the
         * round is scored — each at the point its mode asks for.
         */
        _hostLeavePhase(phase) {
            const h = this.host;
            const rules = RULES[h.mode];

            if (phase === 'architect') {
                // Snapshot what the room just watched being built, then hand out
                // rebuild plots. The answer never leaves the host until reveal.
                const plot = h.plots[0];
                h.target = this.game.voxels.cellsInBox({
                    x0: plot.x0, x1: plot.x0 + plot.size - 1,
                    z0: plot.z0, z1: plot.z0 + plot.size - 1,
                    y0: 0, y1: BUILD_HEIGHT
                }, plot.x0, plot.z0).slice(0, MAX_SUBMIT_CELLS);
                h.plots = computePlots(h.rebuilders.length ? h.rebuilders : this._eligiblePlayers());
                h.elapsed = 0;
            }

            if (rules.buildsAt === phase) this._hostPublishBuilds();
            if (rules.scoreAt === phase) this._hostScoreRound();
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

        /**
         * One vote each, never for yourself. Votes are counted on the host and
         * the room only ever sees how many have been cast, not for whom, until
         * the tally — otherwise the first vote drags the rest along.
         */
        hostHandleVote(name, target) {
            const h = this.host;
            if (!h || h.mode !== 'rush' || h.phase !== 'vote') return false;
            if (!target || target === name) return false;
            if (!h.plots.some(p => p.name === target)) return false;
            h.votes.set(name, target);
            this._hostPublish();
            // Everyone has voted — no reason to sit out the rest of the clock.
            if (h.votes.size >= h.plots.length) h.remain = 1;
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

        // Builds go out one message per player: a single combined payload
        // would be big enough to bump into data-channel size limits.
        _hostPublishBuilds() {
            const h = this.host;
            h.plots.forEach(p => {
                if (p.shared) return;
                const sub = h.submissions.get(p.name);
                const cells = (sub && sub.cells) || [];
                this._broadcast({ k: 'build', name: p.name, cells });
                this.builds.set(p.name, cells);
                this._paintBuild(p.name, cells);
            });
        }

        _hostFinishRound() { this._hostScoreRound(); }

        // What everyone standing in the shared plot has built, by owner.
        _hostSharedCounts() {
            const h = this.host;
            const plot = h.plots[0];
            const counts = new Map();
            this.game.voxels.owners.forEach((owner, k) => {
                if (!owner || !this.game.voxels.world.has(k)) return;
                const [x, , z] = k.split(',').map(Number);
                if (x < plot.x0 || x > plot.x0 + plot.size - 1) return;
                if (z < plot.z0 || z > plot.z0 + plot.size - 1) return;
                counts.set(owner, (counts.get(owner) || 0) + 1);
            });
            return counts;
        }

        _hostTotalsList() {
            return Array.from(this.host.totals.entries())
                .map(([name, points]) => ({ name, points }))
                .sort((a, b) => b.points - a.points);
        }

        _hostScoreRound() {
            const h = this.host;
            switch (h.mode) {
                case 'charades': this._hostFinishCharades(); return;
                case 'teambuild': this._hostScoreTeam(); return;
                case 'memory': this._hostScoreMemory(); return;
                case 'rush': this._hostScoreRush(); return;
                case 'territory': this._hostScoreTerritory(); return;
                default: this._hostScoreBlueprint();
            }
        }

        _hostFinish(results) {
            this._broadcast({ k: 'results', r: results });
            this._applyResults(results);
            if (results.isFinal) this.game.recordMatchStats(results);
        }

        _hostScoreBlueprint() {
            const h = this.host;
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

            this._hostFinish({
                mode: 'blueprint', round: h.round, rounds: h.rounds, modelId: h.modelId,
                modelName: model ? model.name : '', modelEmoji: model ? model.emoji : '',
                rows, totals: this._hostTotalsList(), isFinal: h.round >= h.rounds
            });
        }

        /**
         * Team Build is scored once, for the room. The blueprint sits on the
         * shared plot and the host reads the plot straight out of its own world,
         * because every edit was relayed there as it happened.
         */
        _hostScoreTeam() {
            const h = this.host;
            const model = Models.byId(h.modelId);
            const plot = h.plots[0];
            const o = modelOrigin(plot, model);
            const built = this.game.voxels.cellsInBox({
                x0: plot.x0, x1: plot.x0 + plot.size - 1,
                z0: plot.z0, z1: plot.z0 + plot.size - 1,
                y0: 0, y1: BUILD_HEIGHT
            }, o.x, o.z).map(a => ({ x: a[0], y: a[1], z: a[2], c: a[3], s: a[4] | 0 }));
            const sc = scoreBuild(Models.decode(model), built);
            const points = Math.round(sc.pct);

            const counts = this._hostSharedCounts();
            const laid = Array.from(counts.values()).reduce((a, b) => a + b, 0) || 1;
            const rows = this._eligiblePlayers().map(name => {
                const blocks = counts.get(name) || 0;
                // Everyone shares the room's score — that is the point of co-op.
                // Contribution is shown, not scored, so nobody is pushed into
                // racing their own team-mates for blocks.
                h.totals.set(name, (h.totals.get(name) || 0) + points);
                return {
                    name, points, blocks, pct: sc.pct,
                    note: `${blocks} block${blocks === 1 ? '' : 's'} · ${Math.round(blocks / laid * 100)}% of the build`
                };
            }).sort((a, b) => b.blocks - a.blocks);

            this._hostFinish({
                mode: 'teambuild', coop: true, round: h.round, rounds: h.rounds,
                modelName: model ? model.name : '', modelEmoji: model ? model.emoji : '',
                teamPct: sc.pct, matched: sc.matched, target: sc.targetCount, extra: sc.extra,
                rows, totals: this._hostTotalsList(), isFinal: h.round >= h.rounds
            });
        }

        /**
         * Memory Match compares each rebuild against what the architect made.
         * Both sides are normalised to their own bounding box, so remembering
         * the shape is what counts and not where in the plot you started.
         */
        _hostScoreMemory() {
            const h = this.host;
            const target = normalizeCells(h.target || []).map(toCell);

            const rows = h.plots.map(p => {
                const sub = h.submissions.get(p.name);
                const built = normalizeCells((sub && sub.cells) || []).map(toCell);
                const sc = scoreBuild(target, built);
                const points = Math.round(sc.pct);
                h.totals.set(p.name, (h.totals.get(p.name) || 0) + points);
                return {
                    name: p.name, pct: sc.pct, points,
                    matched: sc.matched, missing: sc.missing, extra: sc.extra,
                    blocks: sc.builtCount, target: sc.targetCount, locked: false, at: h.roundTime
                };
            }).sort((a, b) => b.points - a.points);

            // The architect is paid by how well the room remembered: build
            // something memorable, not something impossible.
            const avg = rows.length ? Math.round(rows.reduce((a, r) => a + r.pct, 0) / rows.length) : 0;
            h.totals.set(h.builder, (h.totals.get(h.builder) || 0) + avg);
            rows.push({
                name: h.builder, pct: avg, points: avg, isBuilder: true,
                blocks: (h.target || []).length, target: (h.target || []).length,
                note: 'architect — scores the room average'
            });

            this._hostFinish({
                mode: 'memory', round: h.round, rounds: h.rounds, builder: h.builder,
                architectBlocks: (h.target || []).length, average: avg,
                rows, totals: this._hostTotalsList(), isFinal: h.round >= h.rounds
            });
        }

        _hostScoreRush() {
            const h = this.host;
            const tally = new Map();
            h.votes.forEach(target => tally.set(target, (tally.get(target) || 0) + 1));

            const rows = h.plots.map(p => {
                const votes = tally.get(p.name) || 0;
                // Points for being liked, and a couple for taking part in the
                // vote — otherwise a round where nobody votes is dead weight.
                const points = votes * 10 + (h.votes.has(p.name) ? 5 : 0);
                h.totals.set(p.name, (h.totals.get(p.name) || 0) + points);
                return {
                    name: p.name, votes, points,
                    blocks: ((h.submissions.get(p.name) || {}).cells || []).length,
                    note: votes ? `${votes} vote${votes === 1 ? '' : 's'}` : 'no votes'
                };
            }).sort((a, b) => b.points - a.points);

            this._hostFinish({
                mode: 'rush', round: h.round, rounds: h.rounds, prompt: h.prompt,
                rows, totals: this._hostTotalsList(), isFinal: h.round >= h.rounds
            });
        }

        _hostScoreTerritory() {
            const h = this.host;
            const counts = this._hostSharedCounts();
            const rows = this._eligiblePlayers().map(name => {
                const blocks = counts.get(name) || 0;
                h.totals.set(name, (h.totals.get(name) || 0) + blocks);
                return {
                    name, blocks, points: blocks,
                    note: `${blocks} block${blocks === 1 ? '' : 's'} standing`
                };
            }).sort((a, b) => b.blocks - a.blocks);

            this._hostFinish({
                mode: 'territory', round: h.round, rounds: h.rounds,
                rows, totals: this._hostTotalsList(), isFinal: h.round >= h.rounds
            });
        }

        _hostState() {
            const h = this.host;
            const rules = RULES[h.mode];
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
                // charades / memory: whoever is building for the room to watch
                builder: h.builder,
                hint: h.mode === 'charades' && h.phase === 'play'
                    ? wordHint(h.word, h.elapsed, h.roundTime) : '',
                guessedBy: h.guessed ? h.guessed.name : null,
                prompt: h.prompt || '',
                buildHeight: rules.height || BUILD_HEIGHT,
                votesCast: h.votes ? h.votes.size : 0,
                voters: h.mode === 'rush' ? Array.from(h.votes.keys()) : [],
                // The answer is only safe to send once the round is over.
                target: h.mode === 'memory' && (h.phase === 'reveal') ? h.target : null,
                // A race hides what the others are doing; the watching modes
                // exist precisely so the room can see it happen.
                hideRivals: !!rules.hide,
                relayEdits: rules.relay === true
                    || (rules.relay === 'architect' && h.phase === 'architect')
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
            // The dock is only useful in a phase where I may actually build —
            // it has no business being there while people are voting.
            this.game.setToolsVisible(!!this.myArea() && this._buildPhase());

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
            this.sandboxBackup = g.snapshotWorld();
            g.voxels.clearAll();
            g.undoStack.length = 0;
            g.redoStack.length = 0;
            g.hidePlayHint();
            this._showHud(true);
        }

        _startRound() {
            const g = this.game;
            this.locked = false;
            this.voted = null;
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

            const area = this.myArea();
            if (area) {
                const c = this._plotCentre(area);
                g.voxels.focus(c.x, 2, c.z, area.size * 2.4, PLOT_VIEW_PHI);
            } else if ((s.plots || []).length === 1) {
                const c = this._plotCentre(s.plots[0]);      // watch the stage
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

            if (s.mode === 'territory') {
                // Ownership is the whole game, so the x-ray goes on for it and
                // the player's own setting is put back afterwards.
                if (phase === 'play' && wasPhase !== 'play') {
                    this._xrayWasOn = this.game.xray;
                    if (!this.game.xray) this.game.toggleXray();
                    this.game.showToast('Claim ground — most blocks wins! 🚩', 'info', 2200);
                }
                return;
            }

            if (s.mode === 'memory') {
                if (phase === 'architect' && wasPhase !== 'architect') {
                    this.game.showToast(s.builder === this.game.username
                        ? 'Build something memorable — everyone is watching 🧠'
                        : `Watch ${s.builder} closely…`, 'info', 2600);
                }
                if (phase === 'play' && wasPhase === 'architect') {
                    // The architect's build is taken away and everyone starts
                    // from an empty plot, working from memory alone.
                    this.game.voxels.clearAll();
                    this.game.undoStack.length = 0;
                    this.game.redoStack.length = 0;
                    this.game._updateBlockCount();
                    this.game.showToast(s.builder === this.game.username
                        ? 'Now watch them try to remember it'
                        : 'Gone! Rebuild it from memory 🧠', 'warning', 2600);
                }
                if (phase === 'reveal' && wasPhase !== 'reveal' && s.target) {
                    // Ghost the original over every rebuild for comparison.
                    this.game.voxels.clearGhosts();
                    this._ghostVisible = false;
                    (s.plots || []).forEach(p => {
                        this.game.voxels.showGhost('plot:' + p.name,
                            (s.target || []).map(r => ({ x: r[0], y: r[1], z: r[2], c: r[3], s: r[4] | 0 })),
                            p.x0, p.z0);
                    });
                    this._startTour();
                }
                if (phase === 'scoring' && wasPhase !== 'scoring') this._submitBuild(false);
                return;
            }

            if (s.mode === 'rush') {
                if (phase === 'play' && wasPhase !== 'play') {
                    this.game.showToast(`⚡ Build: ${s.prompt}`, 'info', 3000);
                }
                if (phase === 'scoring' && wasPhase !== 'scoring') this._submitBuild(false);
                if (phase === 'vote' && wasPhase !== 'vote') {
                    this.voted = null;
                    this._renderVote();
                    this._startTour();
                }
                return;
            }

            // Blueprint ghost: free look during study, flashes during a peek,
            // and stays up over every plot through the reveal for comparison.
            // Rebuild the ghost only when it actually appears or disappears —
            // this runs on every state tick.
            const showMine = (phase === 'study') || (phase === 'play' && s.peek);
            const ghostPlot = this.myPlot || this.myArea();
            if (showMine && ghostPlot && this.model) {
                if (!this._ghostVisible) {
                    this._showGhostIn(ghostPlot, 'mine', true);
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
                color: p.shared ? '#6366f1' : (g.generateUserColor ? g.generateUserColor(p.name) : '#6366f1'),
                mine: p.shared || p.name === g.username
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
                const mine = p.name === g.username || p.shared;
                const n = (s.progress && s.progress[p.name]) || 0;
                const locked = (s.locked || []).indexOf(p.name) >= 0;

                let label = p.name;
                if (p.shared) {
                    label = s.mode === 'territory' ? '🚩 Territory' : '🤝 Everyone';
                    if (this.results && this.results.teamPct !== undefined) {
                        label = `Team — ${this.results.teamPct}%`;
                    }
                } else if (s.mode === 'memory' && s.phase === 'architect') {
                    label = `${p.name} is building — watch!`;
                } else if (s.mode === 'rush' && this.results) {
                    const row = this.results.rows.find(r => r.name === p.name);
                    label = row ? `${p.name} — ${row.votes} vote${row.votes === 1 ? '' : 's'}` : p.name;
                } else if (charades) {
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
                g.voxels.setCover(p.name, s.hideRivals !== false && building && !mine && !p.shared);
            });
        }

        _paintBuild(name, cells) {
            const s = this.state;
            if (!s) return;
            const plot = (s.plots || []).find(p => p.name === name);
            if (!plot) return;
            if (name === this.game.username) return;    // mine is already standing
            // Same frame the build was submitted in: the model's, or the plot's
            // corner in the modes that have no blueprint.
            const o = this.model ? modelOrigin(plot, this.model) : { x: plot.x0, z: plot.z0 };
            this.game.voxels.paintCells(cells, o.x, o.z, name);
        }

        // ---------- my build ----------

        _myCells() {
            const plot = this.myPlot;
            if (!plot) return [];
            // With a blueprint, cells are reported in the model's own frame so
            // the host can compare them directly; without one (Memory Match,
            // Block Rush) the plot corner is the frame.
            const o = this.model ? modelOrigin(plot, this.model) : { x: plot.x0, z: plot.z0 };
            return this.game.voxels.cellsInBox({
                x0: plot.x0, x1: plot.x0 + plot.size - 1,
                z0: plot.z0, z1: plot.z0 + plot.size - 1,
                y0: 0, y1: BUILD_HEIGHT
            }, o.x, o.z).slice(0, MAX_SUBMIT_CELLS);
        }

        _recomputeAccuracy() {
            // Only the blueprint modes have something to be accurate against.
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

            const simpleRows = (rows, extra) => rows.map((row, i) => `
                <div class="rs-row${row.name === this.game.username ? ' me' : ''}" data-player="${esc(row.name)}">
                    <span class="rs-rank">${medal(i)}</span>
                    <span class="rs-dot" style="background:${this.game.generateUserColor(row.name)}"></span>
                    <span class="rs-name">${esc(row.name)}${row.isBuilder ? ' 🧠' : ''}</span>
                    <span class="rs-pct">${extra ? extra(row) : ''}</span>
                    <span class="rs-detail">${esc(row.note || '')}</span>
                    <span class="rs-points">${row.points}</span>
                </div>`).join('');

            if (r.mode === 'teambuild') {
                this.game.showResults({
                    title: r.isFinal ? '🏆 Final standings' : `Round ${r.round} of ${r.rounds}`,
                    subtitle: `The room scored <strong>${r.teamPct}%</strong> on ${r.modelEmoji || ''} <strong>${esc(r.modelName)}</strong>`
                        + ` — ${r.matched}/${r.target} placed${r.extra ? `, ${r.extra} extra` : ''}`,
                    body: `<div class="rs-list">${simpleRows(r.rows)}</div>
                           <div class="rs-totals-title">Match points</div>
                           <div class="rs-totals">${totalsOf()}</div>`,
                    isFinal: r.isFinal, canControl: this.game.isHost()
                });
                return;
            }

            if (r.mode === 'memory') {
                this.game.showResults({
                    title: r.isFinal ? '🏆 Final standings' : `Round ${r.round} of ${r.rounds}`,
                    subtitle: `<strong>${esc(r.builder)}</strong> built ${r.architectBlocks} blocks —`
                        + ` the room remembered <strong>${r.average}%</strong> of it`,
                    body: `<div class="rs-list">${simpleRows(r.rows, row => row.pct + '%')}</div>
                           <div class="rs-totals-title">Match points</div>
                           <div class="rs-totals">${totalsOf()}</div>`,
                    isFinal: r.isFinal, canControl: this.game.isHost()
                });
                return;
            }

            if (r.mode === 'rush') {
                this.game.showResults({
                    title: r.isFinal ? '🏆 Final standings' : `Round ${r.round} of ${r.rounds}`,
                    subtitle: `The prompt was <strong>${esc(r.prompt)}</strong>`,
                    body: `<div class="rs-list">${simpleRows(r.rows, row => '🗳 ' + row.votes)}</div>
                           <div class="rs-totals-title">Match points</div>
                           <div class="rs-totals">${totalsOf()}</div>`,
                    isFinal: r.isFinal, canControl: this.game.isHost()
                });
                return;
            }

            if (r.mode === 'territory') {
                const top = r.rows[0];
                this.game.showResults({
                    title: r.isFinal ? '🏆 Final standings' : `Round ${r.round} of ${r.rounds}`,
                    subtitle: top && top.blocks
                        ? `<strong>${esc(top.name)}</strong> holds the most ground — ${top.blocks} blocks`
                        : 'Nobody claimed a thing',
                    body: `<div class="rs-list">${simpleRows(r.rows, row => '🚩 ' + row.blocks)}</div>
                           <div class="rs-totals-title">Match points</div>
                           <div class="rs-totals">${totalsOf()}</div>`,
                    isFinal: r.isFinal, canControl: this.game.isHost()
                });
                return;
            }

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

        // ---------- voting (Block Rush) ----------

        _renderVote() {
            const s = this.state;
            if (!s || s.mode !== 'rush') return;
            const me = this.game.username;
            const rows = (s.plots || []).map(p => {
                const mine = p.name === me;
                const picked = this.voted === p.name;
                const blocks = (this.builds.get(p.name) || []).length;
                return `<div class="rs-row${mine ? ' me' : ''}" data-player="${esc(p.name)}">
                    <span class="rs-rank">${mine ? '🫵' : '🧱'}</span>
                    <span class="rs-dot" style="background:${this.game.generateUserColor(p.name)}"></span>
                    <span class="rs-name">${esc(p.name)}${mine ? ' (you)' : ''}</span>
                    <span class="rs-pct"></span>
                    <span class="rs-detail">${blocks} block${blocks === 1 ? '' : 's'} · click the row to fly there</span>
                    <span class="rs-points">
                        <button class="vote-btn${picked ? ' picked' : ''}" data-vote="${esc(p.name)}"
                            ${mine ? 'disabled title="You cannot vote for your own build"' : ''}>
                            ${picked ? '✓ Voted' : 'Vote'}
                        </button>
                    </span>
                </div>`;
            }).join('');

            this.game.showResults({
                title: '🗳 Vote for your favourite',
                subtitle: `The prompt was <strong>${esc(s.prompt)}</strong> — you cannot vote for your own build`,
                body: `<div class="rs-list">${rows}</div>`,
                isFinal: false, canControl: false
            });
        }

        castVote(name) {
            const s = this.state;
            if (!s || s.mode !== 'rush' || s.phase !== 'vote') return;
            if (!name || name === this.game.username) return;
            this.voted = name;
            if (this.host) this.hostHandleVote(this.game.username, name);
            else this._send({ k: 'vote', name: this.game.username, for: name });
            this._renderVote();
            this.game.showToast(`Voted for ${name}`, 'success', 1600);
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
                case 'countdown': phaseText = (charades || s.mode === 'memory')
                    ? `${iBuild || s.builder === this.game.username ? 'You build' : s.builder + ' builds'} next… ${Math.ceil(remain)}`
                    : `Get ready… ${Math.ceil(remain)}`; break;
                case 'study': phaseText = `📐 Study the blueprint — ${Math.ceil(remain)}s`; break;
                case 'architect': phaseText = s.builder === this.game.username
                    ? `Build it — they are watching! ${fmt(remain)}`
                    : `👀 Memorise it — ${fmt(remain)}`; break;
                case 'play':
                    if (charades) phaseText = `${iBuild ? 'Build it!' : 'Guess!'} ${fmt(remain)}`;
                    else if (s.mode === 'memory' && s.builder === this.game.username) phaseText = `Watching — ${fmt(remain)}`;
                    else phaseText = this.myArea()
                        ? (this.locked ? '✅ Locked in — waiting for the others' : `Build! ${fmt(remain)}`)
                        : `Spectating — ${fmt(remain)}`;
                    break;
                case 'scoring': phaseText = 'Scoring…'; break;
                case 'reveal': phaseText = s.mode === 'rush' ? '👀 Take a look' : '👀 Reveal'; break;
                case 'vote': phaseText = `🗳 Vote! ${Math.ceil(remain)}s`; break;
                case 'tally': phaseText = '🏅 The votes are in'; break;
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
                const teamish = s.mode === 'teambuild';
                const show = charades
                    ? (s.phase === 'play' || s.phase === 'countdown')
                    : ((this.myPlot || teamish) && (s.phase === 'play' || s.phase === 'scoring') && !!this.model);
                acc.classList.toggle('hidden', !show);
                if (show && charades) {
                    acc.textContent = iBuild
                        ? `🤫 ${String(this.secretWord || '…').toUpperCase()}`
                        : (s.hint || '• • •');
                    acc.className = 'mh-acc ' + (iBuild ? 'word' : 'hint');
                } else if (show) {
                    // In Team Build the number is the room's, not yours.
                    const pct = teamish ? this._teamAccuracy() : this.accuracy;
                    acc.textContent = `${teamish ? 'Team' : 'Match'} ${pct}%`;
                    acc.className = 'mh-acc ' + (pct >= 85 ? 'good' : pct >= 50 ? 'mid' : 'low');
                }
            }

            const peek = document.getElementById('mhPeek');
            if (peek) {
                const show = s.phase === 'play' || s.phase === 'vote' || s.phase === 'architect';
                peek.classList.toggle('hidden', !show);
                if (!show) { /* nothing to say */ }
                else if (charades) peek.textContent = iBuild ? 'No words allowed' : `${s.builder} is building`;
                else if (s.mode === 'rush') {
                    peek.textContent = s.phase === 'vote'
                        ? `${s.votesCast}/${(s.plots || []).length} voted`
                        : `⚡ ${s.prompt}`;
                }
                else if (s.mode === 'territory') peek.textContent = `Your blocks: ${this._myTerritory()}`;
                else if (s.mode === 'memory') peek.textContent = s.phase === 'architect' ? 'Remember it!' : 'From memory';
                else peek.textContent = s.peek ? '👀 Blueprint visible' : `Next peek in ${s.nextPeek}s`;
            }

            const lock = document.getElementById('mhLockBtn');
            if (lock) {
                const lockable = s.mode === 'blueprint' || s.mode === 'memory';
                const show = lockable && s.phase === 'play' && this.myPlot && !this.locked;
                lock.classList.toggle('hidden', !show);
            }

            const leave = document.getElementById('mhEndBtn');
            if (leave) leave.classList.toggle('hidden', !this.game.isHost());
        }

        // Live accuracy of the shared build, for Team Build's HUD.
        _teamAccuracy() {
            const area = this.myArea();
            if (!area || !this.model) return 0;
            const o = modelOrigin(area, this.model);
            const built = this.game.voxels.cellsInBox({
                x0: area.x0, x1: area.x0 + area.size - 1,
                z0: area.z0, z1: area.z0 + area.size - 1, y0: 0, y1: BUILD_HEIGHT
            }, o.x, o.z).map(toCell);
            return scoreBuild(Models.decode(this.model), built).pct;
        }

        // How much of the arena is currently wearing my colour.
        _myTerritory() {
            let n = 0;
            const me = this.game.username;
            const v = this.game.voxels;
            v.owners.forEach((owner, k) => { if (owner === me && v.world.has(k)) n++; });
            return n;
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

            if (this._xrayWasOn === false && g.xray) g.toggleXray();
            this._xrayWasOn = undefined;
            g.voxels.clearArena();
            g.voxels.clearGhosts();
            this._ghostVisible = false;
            g.voxels.clearAll();
            g.undoStack.length = 0;
            g.redoStack.length = 0;
            if (this.sandboxBackup) {
                g.restoreWorldFrom(this.sandboxBackup);
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
