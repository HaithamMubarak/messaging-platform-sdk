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
    const Places = window.BlockPartyPlaces;

    // ---- arena geometry ----
    const WORLD_HALF = 80;        // must match HALF in blockparty.js
    const PLOT_GAP = 6;
    const PLOT_MIN = 12;
    const PLOT_MAX = 22;          // a plot you can build something in, not on
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
    const REVEAL_FRAMES = 80;     // how long a build takes to rise, in frames
    const REVEAL_MIN_BATCH = 3;   // never so slow that a big build outlasts the tour

    const PROGRESS_THROTTLE_MS = 1500;
    const MAX_SUBMIT_CELLS = 4000;   // plots are big now; builds travel chunked
    const BUILD_CHUNK = 300;         // cells (or pieces) per build message

    // Charades: the builder's plot is the room's stage, so it gets more space
    // than a race plot, and letters of the word leak out as time runs down.
    const STAGE_SIZE = 22;
    const CHARADES_REVEAL_SECS = 10;
    // When most of a race has locked in, the rest of the clock is dead time for
    // everybody who finished. The stragglers get this long and no longer.
    const LAST_CALL_SECS = 15;
    const LAST_CALL_SHARE = 0.66;
    // Checkpoint Race is deliberately a short foot course.  Its coordinates
    // stay well inside every generated region, so it works on an empty local
    // world as well as a traced street map.
    const CHECKPOINTS = [
        { x: -42, z: -42, label: 'Start' },
        { x: 38, z: -34, label: 'Harbour turn' },
        { x: 31, z: 36, label: 'Market corner' },
        { x: -35, z: 30, label: 'North gate' },
        { x: -42, z: -42, label: 'Finish' }
    ];
    const CHECKPOINT_RADIUS = 4;
    const CHECKPOINT_MAX_SPEED = 13; // generous for jitter, not teleporting
    // Delivery Run uses a shared depot and three deliberately spaced stops.
    // A runner must return to the depot for the next parcel; the host never
    // accepts a client-side "delivered" claim.
    const DELIVERY_DEPOT = { x: 0, z: 0, label: 'Parcel depot' };
    const DELIVERY_STOPS = [
        { x: 43, z: -31, label: 'Riverside café' },
        { x: -38, z: -28, label: 'Old station' },
        { x: 25, z: 40, label: 'Hilltop house' }
    ];
    const TREASURE_START = { x: 0, z: 0 };
    const TREASURES = [
        { x: -46, z: -35, label: 'the cedar grove' },
        { x: 41, z: -40, label: 'the old quay' },
        { x: 47, z: 24, label: 'the windmill hill' },
        { x: -22, z: 43, label: 'the north ruins' },
        { x: -42, z: 8, label: 'the stone bridge' }
    ];
    const HINT_AT = [0.45, 0.7, 0.85];   // fraction elapsed -> one more letter
    // Never more than this share of a word, however long the round runs. Ten of
    // the ninety-eight words are three letters, and three reveals spelled every
    // one of them out completely by 85% — which is not a hint, it is the answer
    // handed over while the sculptor is still working.
    const HINT_MAX_SHARE = 0.5;

    // Memory Match: the architect builds for this long while the room watches.
    const ARCHITECT_SECS = 45;
    // Block Rush: how long the room gets to vote, then to read the tally.
    const GUESS_SECS = 30;        // time to drop a pin once exploring is over
    const EARTH_REVEAL_SECS = 20; // long enough to read where everyone guessed
    const VOTE_SECS = 20;
    const TALLY_SECS = 10;
    // Territory is a floor fight, not a tower contest.
    const TERRITORY_HEIGHT = 4;
    // Demolition: a town of towers in the middle of the arena. Tall enough to
    // come down properly, short enough that one tower is well inside the
    // physics collapse cap.
    const DEMO_HALF = 22;
    const DEMO_HEIGHT = 12;
    const DEMO_MIN_H = 5;
    const DEMO_GRID = 6;          // towers per side
    // Earthquake: build tall on a budget, then the ground decides.
    const QUAKE_BUDGET = 90;      // blocks each player gets to spend
    const QUAKE_HEIGHT = 20;      // room to build something worth toppling
    const QUAKE_PER_PLOT = 4;     // seconds the camera spends on each victim
    const QUAKE_POWER = 9;
    // Memory Match: how big a build has to be before its average is worth full
    // marks to the architect, and how much a build that sorts the room can add.
    // Saboteur: what getting away with it is worth, and what naming the right
    // person is worth. Deliberately close together — a room that catches its
    // saboteur should come out ahead of one that does not, without the round
    // becoming only about the vote.
    const SABOTEUR_ESCAPE_BONUS = 40;
    const SABOTEUR_CAUGHT_BONUS = 30;

    const MEMORY_FULL_SIZE = 30;
    // How much of the architect's build the flashback may outline. A build
    // bigger than this is past remembering anyway, and the silhouette rides in
    // the once-a-second state — only while the peek window is actually open.
    const MEMORY_HINT_CELLS = 260;
    // The one colour a silhouette is drawn in: slate, which is not in the
    // palette anyone builds with, so it can never be mistaken for a hint.
    const MEMORY_HINT_COLOUR = 11;
    const MEMORY_SPREAD_BONUS = 25;
    // Team Build: a co-op round should end when the job is done.
    const TEAM_PLATEAU_SECS = 15;
    // Towers are one cell thick on purpose. `collapseAround` only takes a lump
    // that has NO path down to the ground, so a 3x3 tower with eight base cells
    // left standing is still perfectly supported — one hit took one block and
    // the mode felt like chipping, not demolition. A slender tower loses its
    // footing to a single low blow and comes down whole.
    const SHARED = '*';           // plot name meaning "everyone builds here"
    const RUBBLE = '~';           // what a demolished block becomes: nobody's, and worth nothing

    /**
     * Each mode is a sequence of phases and a few rules. Keeping the sequence
     * declarative is what makes a new mode mostly a matter of describing it:
     *   relay     — are edits broadcast live (watchers) or kept secret (races)?
     *   hide      — are rivals' plots covered while they build?
     *   scoreAt   — the phase whose end produces the round's result
     *   buildsAt  — the phase whose end publishes everyone's build to the room
     */
    const RULES = {
        whereonearth: {
            // Nothing is built and nothing is hidden: the world itself is the
            // question, and everyone is standing in it.
            flow: ['countdown', 'explore', 'guess', 'reveal'],
            relay: true, hide: false, scoreAt: 'guess', shared: true, noBuild: true
        },
        blueprint: {
            flow: ['countdown', 'study', 'play', 'scoring', 'reveal'],
            relay: false, hide: true, scoreAt: 'scoring', buildsAt: 'scoring'
        },
        charades: {
            flow: ['countdown', 'play', 'reveal'],
            relay: true, hide: false, scoreAt: 'play'
        },
        relay: {
            // Structurally identical to charades. The only new mechanic is the
            // host handing the chisel on partway through, which needs no new
            // phase and no new message: `canRelayEditFrom` already gates edits
            // to `state.builder`, so moving that name IS the rotation.
            flow: ['countdown', 'play', 'reveal'],
            relay: true, hide: false, scoreAt: 'play'
        },
        teambuild: {
            flow: ['countdown', 'study', 'play', 'reveal'],
            relay: true, hide: false, scoreAt: 'play', shared: true
        },
        saboteur: {
            // Team Build with somebody in it who does not want it to work.
            // Everything is shared and visible — that is the point: the
            // sabotage has to happen in plain sight and look like an honest
            // mistake. The only secret in the round is who, and it is one
            // targeted message the host sends at the start.
            flow: ['countdown', 'study', 'play', 'vote', 'tally'],
            relay: true, hide: false, scoreAt: 'vote', shared: true
        },
        memory: {
            flow: ['countdown', 'architect', 'play', 'scoring', 'reveal'],
            relay: 'architect', hide: true, scoreAt: 'scoring', buildsAt: 'scoring'
        },
        rush: {
            flow: ['countdown', 'play', 'scoring', 'reveal', 'vote', 'tally'],
            relay: false, hide: true, scoreAt: 'vote', buildsAt: 'scoring'
        },
        postcard: {
            // Structurally Block Rush with a picture instead of a prompt. The
            // reference is public — everyone gets the same one — so the only
            // secret is what each player made of it, which is what `hide`
            // already covers. No blueprint, no ghost, nothing to copy cell for
            // cell: the reference is two-dimensional and stays that way.
            flow: ['countdown', 'play', 'scoring', 'reveal', 'vote', 'tally'],
            relay: false, hide: true, scoreAt: 'vote', buildsAt: 'scoring'
        },
        territory: {
            flow: ['countdown', 'play', 'reveal'],
            relay: true, hide: false, scoreAt: 'play', shared: true,
            height: TERRITORY_HEIGHT,
            // One cell at a time. The box fill takes up to 1200 cells in a
            // single drag and a bulk place overwrites the owner, so the whole
            // mode came down to who dragged the biggest rectangle fastest —
            // taking a rival's ground was a gesture, not a fight.
            maxFill: 1
        },
        earthquake: {
            // Nothing secret, and watching the towers go up IS the mid-round
            // entertainment — so edits relay. The quake is its own phase
            // because the host has to shake each plot in turn while everyone
            // watches, and scoring happens once the dust settles.
            flow: ['countdown', 'play', 'quake', 'reveal'],
            relay: true, hide: false, scoreAt: 'quake',
            height: QUAKE_HEIGHT, budget: QUAKE_BUDGET
        },
        demolition: {
            // Nothing is built in this one, so there is no study and no secret:
            // the whole point is that everybody watches it come down together.
            flow: ['countdown', 'play', 'reveal'],
            relay: true, hide: false, scoreAt: 'play', shared: true,
            height: DEMO_HEIGHT
        },
        checkpoint: {
            // A movement-only mode: there is no arena to build and no client
            // submission to believe.  The host advances a runner only after
            // seeing their relayed FPS position inside the next checkpoint.
            flow: ['countdown', 'play', 'reveal'],
            relay: false, hide: false, scoreAt: 'play', noBuild: true
        },
        delivery: {
            flow: ['countdown', 'play', 'reveal'],
            relay: false, hide: false, scoreAt: 'play', noBuild: true
        },
        treasure: {
            flow: ['countdown', 'play', 'reveal'],
            relay: false, hide: false, scoreAt: 'play', noBuild: true
        }
    };

    /**
     * Modes the room settles with a vote rather than with a score.
     *
     * There is no right answer to "build what this picture shows", any more
     * than there is to a Block Rush prompt — so both hand the decision to the
     * players, and both use the same vote and tally phases to do it.
     */
    function isVoted(mode) { return mode === 'rush' || mode === 'postcard' || mode === 'saboteur'; }

    /**
     * What the room is voting *on*.
     *
     * Rush and Postcard vote for a build — the plots are the ballot. Saboteur
     * votes for a person, and there is only one plot, so the ballot is the
     * player list. Same votes, same tally, different list.
     */
    function votesOnPlayers(mode) { return mode === 'saboteur'; }

    /** Population standard deviation — how much a set of scores disagreed. */
    function stdev(values) {
        if (!values || values.length < 2) return 0;
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const varc = values.reduce((a, v) => a + (v - mean) * (v - mean), 0) / values.length;
        return Math.sqrt(varc);
    }

    // What kind of round it is, for the picker: building against a brief,
    // working out what somebody means, remembering, or knocking things over.
    const MODE_KINDS = [
        { id: 'build', name: 'Build' },
        { id: 'guess', name: 'Guess' },
        { id: 'remember', name: 'Remember' },
        { id: 'wreck', name: 'Wreck' }
        , { id: 'race', name: 'Race' }
    ];

    const MODES = [
        {
            id: 'blueprint', kind: 'build', name: 'Blueprint Race', emoji: '📐', ready: true, defaultTime: 180, minPlayers: 1, note: 'Solo works: race the clock and your own memory.',
            desc: 'Everyone gets the same secret blueprint. Study it, then rebuild it from memory — it flashes back for 3s every 30s. Accuracy plus speed wins.'
        },
        {
            // NOT offered yet: a guest does not follow the room to the mystery
            // place — the world snapshot that carries it never lands on them,
            // so on a second screen the world is empty and unpinned. Solo play
            // and every other part of the round works. Fix that before turning
            // this on.
            id: 'whereonearth', kind: 'guess', name: 'Where on Earth', emoji: '🌍', ready: true, defaultTime: 120, minPlayers: 1, note: 'Works alone — guess against your own geography.',
            desc: 'The room is moved to a real place, built from the map. Walk it, fly it, look at the coast — then drop a pin where you think you are. Closest wins.'
        },
        {
            id: 'charades', kind: 'guess', name: 'Voxel Charades', emoji: '🤫', ready: true, defaultTime: 90, minPlayers: 2, note: 'Needs somebody to guess.',
            desc: 'One player builds a secret word with no words allowed. Everyone else watches live and races to guess it in chat.'
        },
        {
            id: 'relay', kind: 'guess', name: 'Relay Sculptors', emoji: '🎽', ready: true, defaultTime: 90, minPlayers: 3, note: 'Needs three: two to sculpt, one to guess.',
            desc: 'One word, three sculptors. Each gets a turn on the same statue, carrying on from whatever the last one left — while everyone else races to guess what it is becoming.'
        },
        {
            id: 'teambuild', kind: 'build', name: 'Team Build', emoji: '🤝', ready: true, defaultTime: 180, minPlayers: 1, note: 'Better with a crowd, fine alone.',
            desc: 'One blueprint, one plot, everyone at once. Talk it out in chat — the room shares a single score, and you can see who laid what.'
        },
        {
            id: 'memory', kind: 'remember', name: 'Memory Match', emoji: '🧠', ready: true, defaultTime: 120, minPlayers: 1, note: 'Alone, you rebuild your own from memory.',
            desc: 'One player builds while the room watches. Then it vanishes and everybody rebuilds it from memory. The architect scores on how well you remembered.'
        },
        {
            id: 'postcard', kind: 'build', name: 'Postcard', emoji: '🖼', ready: true, defaultTime: 120, minPlayers: 3, note: 'Needs three: the room votes, and you cannot vote for yourself.',
            desc: 'Everyone gets the same picture — and only the picture. No model, no ghost, nothing to copy: work out what it shows and build that. The room votes for the best one.'
        },
        {
            id: 'saboteur', kind: 'guess', name: 'Saboteur', emoji: '🕵', ready: true, defaultTime: 180, minPlayers: 3, note: 'Needs three: two to build and one to be the problem.',
            desc: 'One blueprint, one plot, everybody on it — except one of you is quietly wrecking it and must not be caught. Build it anyway, then the room votes on who it was.'
        },
        {
            id: 'rush', kind: 'build', name: 'Block Rush', emoji: '⚡', ready: true, defaultTime: 90, minPlayers: 3, note: 'Needs three: with two it is always a tie.',
            desc: 'A creative prompt, no blueprint, nothing to copy. Builds are revealed together and the room votes for its favourite.'
        },
        {
            id: 'territory', kind: 'wreck', name: 'Territory', emoji: '🚩', ready: true, defaultTime: 120, minPlayers: 2, note: 'Needs somebody to take ground from.',
            desc: 'One shared arena, every block wears your colour. Build over rivals, tear theirs down — most blocks standing at the whistle wins.'
        },
        {
            id: 'earthquake', kind: 'wreck', name: 'Earthquake', emoji: '🌋', ready: true, defaultTime: 90, minPlayers: 1, note: 'Solo works: beat your own record.',
            desc: 'Build the tallest thing you can from 90 blocks — then the ground shakes. Whatever is still standing scores, and height counts double. Bracing beats stacking.'
        },
        {
            id: 'demolition', kind: 'wreck', name: 'Demolition Party', emoji: '🧨', ready: true, defaultTime: 90, minPlayers: 1, note: 'Solo works: beat the clock, not the room.',
            desc: 'A block town, and everyone with a wrecking ball. Hit a tower low and take the whole thing down — you score every block your own blow brings with it.'
        },
        {
            id: 'checkpoint', kind: 'race', name: 'Checkpoint Race', emoji: '🏁', ready: true, defaultTime: 120, minPlayers: 1, note: 'Solo works: set a clean time; races use the host-validated route.',
            desc: 'Run the waypoint course in first person. The host validates each checkpoint from your movement feed, then ranks the fastest finishers.'
        },
        {
            id: 'delivery', kind: 'race', name: 'Delivery Run', emoji: '📦', ready: true, defaultTime: 150, minPlayers: 1, note: 'Solo works: race your delivery time; return to the depot for each parcel.',
            desc: 'Pick up at the depot, carry each parcel to its marked stop, then return for the next one. The host validates every pickup and delivery from movement.'
        },
        {
            id: 'treasure', kind: 'race', name: 'Treasure Hunt', emoji: '🗺️', ready: true, defaultTime: 180, minPlayers: 1, note: 'Solo works: find every cache before time runs out.',
            desc: 'Follow compass clues to hidden caches across the world. The host confirms each find from your first-person position.'
        }
    ];

    /**
     * Lay out one square plot per player, centred on the origin.
     * Shrinks the gap first and then the plots themselves, so a big room still
     * fits inside the world instead of spilling over the edge.
     */
    function computePlots(names) {
        names = (names && names.length) ? names : [];
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
        const w = String(word || '');
        const spots = [];
        for (let i = 0; i < w.length; i++) if (w[i] !== ' ') spots.push(i);
        if (!spots.length) return w;

        const frac = total ? elapsed / total : 0;
        let steps = 0;
        HINT_AT.forEach((t, i) => { if (frac >= t) steps = i + 1; });
        const reveal = Math.min(steps, Math.max(1, Math.floor(spots.length * HINT_MAX_SHARE)));

        // Which letters, and not left to right: the opening letter of a short
        // word is most of the word. The order is a stable function of the word
        // itself, so a letter never moves once it has been shown.
        let seed = 0;
        for (let i = 0; i < w.length; i++) seed = (Math.imul(seed, 31) + w.charCodeAt(i)) >>> 0;
        const rank = (i) => {
            let h = (Math.imul(seed ^ (i + 1), 2246822519)) >>> 0;
            h ^= h >>> 13; return Math.imul(h, 3266489917) >>> 0;
        };
        const shown = new Set(spots.slice().sort((a, b) => rank(a) - rank(b)).slice(0, reveal));
        return w.split('')
            .map((ch, i) => (ch === ' ' ? ' ' : (shown.has(i) ? ch.toUpperCase() : '•')))
            .join('');
    }

    // =====================================================================
    // ModeController
    // =====================================================================
    class ModeController {
        constructor(game) {
            this.game = game;
            // The world's size is written down in two files. If they ever drift,
            // plots would be laid out over the edge of a world that no longer
            // reaches that far — so say so loudly rather than debug it later.
            const worldHalf = game.voxels && game.voxels.half;
            if (worldHalf && worldHalf !== WORLD_HALF) {
                console.warn(`[BlockParty] world size mismatch: modes.js has ${WORLD_HALF}, `
                    + `the world is ${worldHalf}. Arenas will be laid out for the wrong size.`);
            }

            this.state = null;          // last match state (host-authoritative)
            this.host = null;           // host-only bookkeeping; null on clients
            this.hostTimer = null;

            this.myPlot = null;
            this.model = null;
            this.locked = false;        // I have locked my build in for this round
            this.voted = null;          // block rush: who I voted for
            this.secretWord = null;     // charades: set only on the builder
            this.myRole = null;         // saboteur: set only on the saboteur
            this._roleRound = 0;        // ...and only for the round it was given for
            this.accuracy = 0;
            this.sandboxBackup = null;  // world to restore when the match ends
            this.results = null;
            this.builds = new Map();    // name -> cells, during the reveal
            this._reveals = [];         // builds still rising, one per player
            this._revealRaf = null;
            // A backgrounded tab is handed no animation frames at all, so a
            // reveal started just before switching away would sit half-built
            // until the player came back. Finish it instead.
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) this._stopReveals(true);
            });

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
                if (s.mode === 'relay') return `${s.builder} has the chisel — guess in chat!`;
                if (s.mode === 'memory') return 'You built it — let the others remember';
                return 'You are spectating this round';
            }
            if (this.locked) return 'Your build is locked in';
            // The relay stage is shared so everyone can watch it, but only the
            // sculptor holding the chisel may cut it. Without this a guesser's
            // edits landed locally and were then dropped by the host.
            if (s.mode === 'relay' && s.builder !== this.game.username) {
                return `${s.builder} has the chisel`;
            }
            // Demolition is a knocking round. Anything that puts blocks into the
            // arena is a way to manufacture your own score, and anything that
            // takes them out without physics is a way to deny everyone else's.
            // Tool rule, not a cell rule — see allowsSettle().
            if (s.mode === 'demolition') return 'Knock it down — that is the whole round';
            if (x < area.x0 || x > area.x0 + area.size - 1 || z < area.z0 || z > area.z0 + area.size - 1) {
                return area.shared ? 'Build inside the arena' : 'Build inside your own plot';
            }
            if (y > (s.buildHeight || BUILD_HEIGHT)) return 'Too high for this round';
            // A budget makes the round a question — brace it or build it taller?
            // Without one the answer is always "taller", every time.
            if (s.budget && this._spentByMe() >= s.budget) return `Out of blocks — you have used all ${s.budget}`;
            return null;
        }

        /** How many blocks I have laid this round, for a budgeted mode. */
        _spentByMe() {
            const area = this.myArea();
            if (!area) return 0;
            const cells = this.game.voxels.cellsInBox({
                x0: area.x0, x1: area.x0 + area.size - 1,
                z0: area.z0, z1: area.z0 + area.size - 1,
                y0: 0, y1: (this.state && this.state.buildHeight) || BUILD_HEIGHT
            }, area.x0, area.z0);
            return (cells && cells.length) || 0;
        }

        /** Is this a phase where I, specifically, may build? */
        _buildPhase() {
            const s = this.state;
            if (!s) return false;
            if (s.mode === 'memory') {
                // Normally the architect sits the rebuild out. Alone in a room
                // they are also the only rebuilder, and the host gives them a
                // plot for it — so having a plot is the real test, not who built.
                return (s.phase === 'architect' && s.builder === this.game.username)
                    || (s.phase === 'play' && !!this.myPlot);
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

        /**
         * May a *falling block* come to rest here?
         *
         * Physics is not a player and is not holding a tool: it asks about the
         * arena's shape (bounds, plot, height), never about whose turn it is or
         * which tool this round allows.
         */
        allowsSettle(x, y, z) {
            const s = this.state;
            if (!this._matchRunning()) return true;
            if (y > (s.buildHeight || BUILD_HEIGHT)) return false;
            // ANY plot, not mine. Physics settles props in whichever plot they
            // fell in, and the host runs it for everybody — asking about the
            // local player's own plot meant that during an Earthquake every
            // rival's rubble failed to land and puffed into dust, while the
            // host's came to rest and scored.
            return this._plotAt(x, z) !== null;
        }

        /** The plot a cell sits in, or null if it is outside every one. */
        _plotAt(x, z) {
            const plots = (this.state && this.state.plots) || [];
            for (let i = 0; i < plots.length; i++) {
                const p = plots[i];
                if (x >= p.x0 && x <= p.x0 + p.size - 1 && z >= p.z0 && z <= p.z0 + p.size - 1) return p;
            }
            return null;
        }

        /**
         * May a blow land here?
         *
         * Knocking is not editing: it has its own round rule (`physicsAllowed`)
         * and its own geometry (the arena), and running it through the edit
         * rule made Demolition Party refuse the one verb it has.
         */
        allowsKnock(x, y, z) {
            if (!this._matchRunning()) return true;
            if (!this.physicsAllowed()) return false;
            return this._plotAt(x, z) !== null;
        }

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
            if (!s || s.phase !== 'play' || !name) return false;
            if (s.mode === 'charades') return name === s.builder;
            // Relay: a sculptor who has already had their turn still knows the
            // answer, so the mute has to outlast the turn.
            if (s.mode === 'relay') return (s.sculptors || []).indexOf(name) >= 0;
            return false;
        }

        /**
         * How many cells one gesture may touch this round.
         *
         * A mode scored by ground held has to be played a block at a time, or
         * the fill tool decides it.
         */
        maxFill() {
            const s = this.state;
            if (!this._matchRunning() || !s) return Infinity;
            const rules = RULES[s.mode];
            return (rules && rules.maxFill) || Infinity;
        }

        /** Host-side: during a match only the current builder may edit. */
        canRelayEditFrom(name) {
            if (!this._matchRunning()) return true;
            if (!this.relaysEdits()) return false;
            // On a shared arena everyone's edits are everyone's business; when
            // the room is watching one person, only that person's are.
            // Relay shares one statue but not the chisel: the plot is shared so
            // everyone can SEE it, while only the current sculptor may cut it.
            if (this.state.mode === 'relay') return !!name && name === this.state.builder;
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

        /**
         * Called from the host's avatar relay.  Checkpoints are deliberately
         * never accepted from a client message: this is the host observing a
         * runner's movement, with a speed envelope between observations.
         */
        onAvatar(name, avatar) {
            const h = this.host;
            if (!h || (h.mode !== 'checkpoint' && h.mode !== 'delivery' && h.mode !== 'treasure') || h.phase !== 'play' || !name || !avatar || avatar.hide) return;
            const runner = h.runners && h.runners.get(name);
            if (!runner || runner.done || !Number.isFinite(+avatar.x) || !Number.isFinite(+avatar.z)) return;
            const now = Date.now(), x = +avatar.x, z = +avatar.z;
            const dt = Math.max(0.05, (now - runner.lastAt) / 1000);
            const moved = Math.hypot(x - runner.lastX, z - runner.lastZ);
            // A new runner begins at the start line.  Thereafter a report that
            // jumps farther than a very forgiving sprint envelope is ignored.
            if (moved > CHECKPOINT_MAX_SPEED * dt + 3) return;
            runner.lastX = x; runner.lastZ = z; runner.lastAt = now;
            if (h.mode === 'treasure') {
                let found = false;
                TREASURES.forEach((treasure, i) => {
                    if (runner.found.indexOf(i) < 0 && Math.hypot(x - treasure.x, z - treasure.z) <= CHECKPOINT_RADIUS) {
                        runner.found.push(i); found = true;
                        this.game.showToast(`${name} found treasure ${runner.found.length}/${TREASURES.length}!`, 'success', 1800);
                    }
                });
                if (!found) return;
                if (runner.found.length === TREASURES.length) { runner.done = true; runner.finishedAt = now; }
                this._hostPublish();
                if (h.runners.size && Array.from(h.runners.values()).every(r => r.done)) h.remain = 1;
                return;
            }
            if (h.mode === 'delivery') {
                const target = runner.carrying ? DELIVERY_STOPS[runner.delivered] : DELIVERY_DEPOT;
                if (!target || Math.hypot(x - target.x, z - target.z) > CHECKPOINT_RADIUS) return;
                if (!runner.carrying) {
                    runner.carrying = true;
                    this.game.showToast(`${name} picked up parcel ${runner.delivered + 1}`, 'info', 1800);
                } else {
                    runner.carrying = false;
                    runner.delivered++;
                    runner.splits.push(now - runner.startedAt);
                    if (runner.delivered >= DELIVERY_STOPS.length) {
                        runner.done = true; runner.finishedAt = now;
                        this.game.showToast(`${name} completed every delivery!`, 'success', 2200);
                    }
                }
                this._hostPublish();
                if (h.runners.size && Array.from(h.runners.values()).every(r => r.done)) h.remain = 1;
                return;
            }
            const target = CHECKPOINTS[runner.next];
            if (!target || Math.hypot(x - target.x, z - target.z) > CHECKPOINT_RADIUS) return;
            runner.splits.push(now - runner.startedAt);
            runner.next++;
            if (runner.next >= CHECKPOINTS.length) {
                runner.done = true;
                runner.finishedAt = now;
                this.game.showToast(`${name} finished the course!`, 'success', 2200);
            }
            this._hostPublish();
            if (h.runners.size && Array.from(h.runners.values()).every(r => r.done)) h.remain = 1;
        }

        /** A local-only compass clue.  Positions remain host-confirmed. */
        fpsGuidance(x, z, yaw) {
            const s = this.state;
            if (!s || s.phase !== 'play') return '';
            let target = null, prefix = '';
            if (s.mode === 'checkpoint') {
                const r = s.runners && s.runners[this.game.username];
                target = r && !r.done && s.checkpoints && s.checkpoints[r.next]; prefix = 'Gate';
            } else if (s.mode === 'delivery') {
                const r = s.deliveries && s.deliveries[this.game.username];
                target = r && !r.done && s.delivery && (r.carrying ? s.delivery.stops[r.delivered] : s.delivery.depot);
                prefix = r && r.carrying ? 'Deliver' : 'Pickup';
            } else if (s.mode === 'treasure') {
                const r = s.treasure && s.treasure[this.game.username];
                const remaining = TREASURES.filter((_, i) => !r || r.found.indexOf(i) < 0);
                target = remaining.sort((a, b) => Math.hypot(x - a.x, z - a.z) - Math.hypot(x - b.x, z - b.z))[0];
                prefix = 'Clue';
            }
            if (!target) return '';
            const bearing = Math.atan2(target.x - x, -(target.z - z));
            let turn = (bearing - yaw) * 180 / Math.PI;
            turn = ((turn + 540) % 360) - 180;
            const side = Math.abs(turn) < 12 ? 'ahead' : `${Math.round(Math.abs(turn))}° ${turn > 0 ? 'right' : 'left'}`;
            return `🧭 ${prefix}: ${target.label || 'next stop'} · ${Math.round(Math.hypot(target.x - x, target.z - z))} blocks · ${side}`;
        }

        /** A new host inherits nothing, so an in-flight match cannot continue. */
        onBecomeHost() {
            if (this.isMatchActive() && !this.host) {
                this.game.showToast('Host left — match ended', 'warning', 3000);
                this._broadcast({ k: 'end' });
                this._endMatch();
            }
        }

        // Anything that describes the match itself is the host's to say. A
        // client that forged one could otherwise fake a phase, a result or a
        // whole scoreboard on somebody else's screen.
        static get HOST_ONLY() { return ['state', 'results', 'build', 'end', 'guessed', 'word', 'model', 'turn', 'quake', 'role']; }

        handleMessage(peerId, msg) {
            // Identity comes from the transport, never from the payload:
            // `_fromClient` is stamped by the relay, `peerId` is who the data
            // channel says sent it. A `name` in the body is only a claim.
            const from = msg._fromClient || peerId;
            if (!this.host && ModeController.HOST_ONLY.indexOf(msg.k) >= 0
                && !this.game._fromHost(peerId, msg)) return;
            switch (msg.k) {
                case 'state':
                    if (this.host) return;             // I run the clock; ignore echoes
                    this._applyState(msg.s);
                    break;
                case 'results':
                    if (this.host) return;
                    this._applyResults(msg.r);
                    break;
                case 'model': {
                    // A blueprint the room made, arriving before the round that
                    // uses it. Assembled first: half a blueprint is a wrong one.
                    const total = msg.n || 1;
                    if (!this._incomingModels) this._incomingModels = new Map();
                    let mbuf = this._incomingModels.get(msg.id);
                    if (!mbuf || msg.i === 0 || mbuf.total !== total) {
                        mbuf = { cells: [], seen: 0, total };
                        this._incomingModels.set(msg.id, mbuf);
                    }
                    mbuf.cells.push(...(msg.cells || []));
                    mbuf.seen++;
                    if (mbuf.seen < total) break;
                    this._incomingModels.delete(msg.id);
                    Models.register({
                        id: msg.id, name: msg.name, author: msg.author,
                        cells: mbuf.cells, size: msg.size
                    });
                    // The round may already be waiting on it. Clearing the
                    // flag is enough: the state tick rebuilds the ghost when it
                    // is not currently up, and it runs every second.
                    if (this.state && this.state.modelId === msg.id) {
                        this.model = Models.byId(msg.id);
                        this._ghostVisible = false;
                    }
                    break;
                }

                case 'build': {
                    // Assemble the chunks before painting; half a build looks
                    // like a bad build.
                    const total = msg.n || 1;
                    if (!this._incomingBuilds) this._incomingBuilds = new Map();
                    let buf = this._incomingBuilds.get(msg.name);
                    if (!buf || msg.i === 0 || buf.total !== total) {
                        buf = { cells: [], pieces: [], seen: 0, total };
                        this._incomingBuilds.set(msg.name, buf);
                    }
                    buf.cells.push(...(msg.cells || []));
                    buf.pieces.push(...(msg.pieces || []));
                    buf.seen++;
                    if (buf.seen < total) break;
                    this._incomingBuilds.delete(msg.name);
                    this.builds.set(msg.name, buf.cells);
                    this._paintBuild(msg.name, buf.cells, buf.pieces);
                    break;
                }
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
                case 'pin':
                    if (this.host) this.hostHandlePin(from, msg.lat, msg.lon);
                    break;
                case 'turn':
                    // Host-only (HOST_ONLY gate above). The state broadcast
                    // carries the same thing a second later; this is just so it
                    // lands the moment it happens.
                    if (this.state) this.state.builder = msg.name;
                    this.game.showToast(msg.name === this.game.username
                        ? '🎽 Your turn — carry it on'
                        : `🎽 ${msg.name} takes over`, 'info', 2200);
                    this._renderHud();
                    break;
                case 'word':
                    // Sent to the builder only.
                    this.secretWord = msg.word;
                    this._renderHud();
                    break;
                case 'role':
                    // Sent to the saboteur only, and HOST_ONLY above — a client
                    // that could forge this could appoint somebody else, or
                    // convince a player they were the saboteur when they were
                    // not, which is a whole round ruined from the outside.
                    this._takeRole(msg.role, msg.round);
                    this.game.showToast('🕵 You are the saboteur — wreck it without being caught', 'warning', 5000);
                    this._renderHud();
                    break;
                case 'guessed':
                    this.game.addChatMessage(msg.name,
                        `guessed it — it was “${msg.word}” 🎉`, { system: true });
                    this._celebrateGuess(msg.name, msg.word);
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
            // The player note was only ever advice. Some modes are not merely
            // worse when under-populated, they are broken: Block Rush with two
            // players is a forced tie every round because you cannot vote for
            // yourself, and charades alone is ninety seconds with nobody to
            // guess.
            const here = this._eligiblePlayers().length;
            const need = mode.minPlayers || 1;
            if (here < need) {
                this.game.showToast(
                    `${mode.name} needs ${need} players — there ${here === 1 ? 'is' : 'are'} ${here} here`,
                    'warning', 3200);
                return;
            }
            // A prop in flight belongs to the world it was knocked out of, not
            // to the arena that is about to replace it.
            if (this.game.physics && this.game.physics.on) this.game.physics.flush();

            opts = opts || {};
            this.host = {
                mode: modeId,
                rounds: opts.rounds || 3,
                roundTime: opts.roundTime || 180,
                // 'builtin' | 'room' | 'both' — where each round's blueprint
                // comes from. Host-side only: clients are handed the model.
                source: opts.source || 'builtin',
                round: 0,
                elapsed: 0,
                usedModels: [],
                usedWords: [],
                usedPictures: [],
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
            // Demolition needs the wrecking ball, so it turns physics on for
            // the duration and puts the setting back exactly as it found it.
            if ((modeId === 'demolition' || modeId === 'earthquake') && this.game.physics) {
                this._physicsWas = !!this.game.physics.on;
                if (!this._physicsWas) this.game._setPhysics(true);
                // Demolition scores what came down, so rubble must stop being
                // worth hitting. Earthquake scores what is still UP, and a
                // fallen block keeps its owner so the debris in your plot is
                // still visibly yours.
                if (modeId === 'demolition') this.game.physics.rubbleOwner = RUBBLE;
            }

            this._hostBeginRound();
            clearInterval(this.hostTimer);
            this.hostTimer = setInterval(() => this._hostTick(), 1000);
        }

        endMatch() {
            if (this.host) {
                // Land whatever the last blow put in the air before the arena
                // goes away under it, then restore the room's own setting.
                if (this.game.physics && this.game.physics.on) this.game.physics.flush();
                if (this.game.physics) this.game.physics.rubbleOwner = null;
                if (this._physicsWas === false && this.game.physics) this.game._setPhysics(false);
                this._physicsWas = undefined;

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
            h.picture = null;
            h.saboteur = null;
            h.lastCall = false;
            h.lastResults = null;      // the previous round's, not this one's

            const stage = (name) => [{
                name, x0: -Math.floor(STAGE_SIZE / 2), z0: -Math.floor(STAGE_SIZE / 2), size: STAGE_SIZE
            }];
            const takeModel = () => {
                // A build the room made has no difficulty to ramp — it is as
                // hard as whoever made it made it — so the round ladder only
                // applies to the ones that ship.
                let model = null;
                if (h.source === 'room') model = Models.pickRoom(h.usedModels);
                else if (h.source === 'both' && Math.random() < 0.5) model = Models.pickRoom(h.usedModels);
                if (!model) {
                    const diff = Models.difficultyForRound(h.round, h.rounds);
                    model = Models.pick(diff, h.usedModels);
                }
                h.usedModels.push(model.id);
                h.modelId = model.id;
                // A room blueprint exists only in the host's browser, so the
                // room has to be handed it before anyone can be asked to
                // rebuild it. Chunked, because a blueprint is a build.
                if (model.room) this._hostPublishModel(model);
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

                case 'postcard': {
                    // One picture for the whole room. It is not secret — it is
                    // the brief — so it simply rides in the state from here on.
                    const pics = window.BlockPartyPictures;
                    h.picture = pics ? pics.pick(h.usedPictures) : null;
                    if (h.picture) h.usedPictures.push(h.picture.id);
                    h.plots = computePlots(players);
                    break;
                }

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
                    h.plots = [{ name: SHARED, shared: true, x0: -18, z0: -18, size: 36 }];
                    h.teamBest = 0;
                    h.teamStill = 0;
                    takeModel();
                    break;

                case 'saboteur':
                    h.plots = [{ name: SHARED, shared: true, x0: -18, z0: -18, size: 36 }];
                    h.teamBest = 0;
                    h.teamStill = 0;
                    takeModel();
                    // Somebody different each round where the room allows it,
                    // so a match does not turn into one person's evening.
                    h.saboteur = players[(h.round - 1) % players.length];
                    this._hostSendRole();
                    break;

                case 'whereonearth': {
                    // The world *is* the round, so there are no plots to lay
                    // out — everyone stands in the same place, which is the
                    // question.
                    h.plots = [];
                    h.pins = new Map();
                    const place = Places.pick(h.usedPlaces || []);
                    h.usedPlaces = (h.usedPlaces || []).concat([place.id]);
                    h.place = place;
                    // Building it is a network round trip, so the countdown is
                    // held until the place is standing — otherwise half the
                    // room explores an empty world.
                    h.building = true;
                    this.game.travelForMatch(place.lat, place.lon, place.mpc,
                        this.game._earthStyle || 'full')
                        .then(() => { h.building = false; })
                        .catch(() => { h.building = false; });
                    break;
                }

                case 'territory':
                    h.plots = [{ name: SHARED, shared: true, x0: -22, z0: -22, size: 44 }];
                    break;

                case 'relay': {
                    // Up to three sculptors, rotating who leads across rounds so
                    // the same person does not always open.
                    const line = [];
                    const want = Math.min(3, Math.max(2, players.length - 1));
                    for (let i = 0; i < want; i++) line.push(players[(h.round - 1 + i) % players.length]);
                    h.sculptors = line;
                    h.turnAt = -1;
                    h.builder = line[0];
                    h.plots = stage(SHARED);
                    h.plots[0].shared = true;      // the statue belongs to the round
                    h.word = Models.pickWord(h.usedWords);
                    h.usedWords.push(h.word);
                    this._hostSendWord();
                    break;
                }

                case 'earthquake':
                    h.plots = computePlots(players);
                    h.spent = new Map();       // blocks each player has laid
                    h.quakeAt = -1;            // which plot the ground is under
                    break;

                case 'demolition':
                    h.plots = [{ name: SHARED, shared: true, x0: -DEMO_HALF, z0: -DEMO_HALF, size: DEMO_HALF * 2 }];
                    h.demo = new Map();
                    h.demoTotal = 0;
                    // The town itself goes up in _startRound: both _enterMatch
                    // and _startRound clear the world on the way into a round,
                    // and anything raised before that is wiped.
                    break;

                case 'checkpoint': {
                    h.plots = [];
                    h.runners = new Map();
                    const now = Date.now();
                    players.forEach(name => h.runners.set(name, {
                        next: 1, done: false, startedAt: now, finishedAt: 0,
                        lastX: CHECKPOINTS[0].x, lastZ: CHECKPOINTS[0].z, lastAt: now, splits: []
                    }));
                    break;
                }

                case 'delivery': {
                    h.plots = [];
                    h.runners = new Map();
                    const now = Date.now();
                    players.forEach(name => h.runners.set(name, {
                        carrying: false, delivered: 0, done: false, startedAt: now, finishedAt: 0,
                        lastX: DELIVERY_DEPOT.x, lastZ: DELIVERY_DEPOT.z, lastAt: now, splits: []
                    }));
                    break;
                }

                case 'treasure': {
                    h.plots = [];
                    h.runners = new Map();
                    const now = Date.now();
                    players.forEach(name => h.runners.set(name, {
                        found: [], done: false, startedAt: now, finishedAt: 0,
                        lastX: TREASURE_START.x, lastZ: TREASURE_START.z, lastAt: now
                    }));
                    break;
                }

                default:
                    h.plots = computePlots(players);
                    takeModel();
            }
            this._hostPhase('countdown', COUNTDOWN_SECS);
        }

        // The word goes to the builder alone — it can never ride along in the
        // broadcast state, which everyone in the room receives.
        /**
         * The word goes to the current builder alone — never into the broadcast
         * state, which the whole room receives.
         */
        /**
         * Tell the saboteur, and only the saboteur.
         *
         * Exactly the shape the secret word already travels in: one targeted
         * message, never in the broadcast state. Everyone else's client has no
         * idea the field exists, which is the only reason a hidden role can
         * work at all on a transport that relays everything by default.
         */
        _hostSendRole() {
            const h = this.host;
            // Stamped with the round it belongs to. The message and the state
            // that starts the round travel separately and can arrive in either
            // order, so a role is only ever true *for a round* — otherwise last
            // round's saboteur is still the saboteur on their own screen.
            if (h.saboteur === this.game.username) this._takeRole('saboteur', h.round);
            else this.game.sendData({ type: 'mode', k: 'role', role: 'saboteur', round: h.round }, h.saboteur);
        }

        _takeRole(role, round) {
            this.myRole = role || null;
            this._roleRound = round || 0;
        }

        /** Am I the saboteur, in the round currently being played? */
        _iAmSaboteur() {
            return this.myRole === 'saboteur'
                && !!this.state && this._roleRound === this.state.round;
        }

        _hostSendWord() {
            const h = this.host;
            if (h.builder === this.game.username) this.secretWord = h.word;
            else this.game.sendData({ type: 'mode', k: 'word', word: h.word }, h.builder);
        }

        /**
         * Hand the chisel to the next sculptor.
         *
         * Charades gives one person the stage and leaves everyone else
         * watching; with eight players that is one performer and seven
         * spectators, and over three rounds most people never build at all.
         * Rotating mid-round puts three people on the same statue, and
         * inheriting somebody else's half-finished duck is the joke.
         */
        _hostRelayTurn() {
            const h = this.host;
            const line = h.sculptors || [];
            if (!line.length) return;
            const share = h.roundTime / line.length;
            const turn = Math.min(line.length - 1, Math.floor(h.elapsed / share));
            if (turn === h.turnAt) return;
            h.turnAt = turn;
            h.builder = line[turn];
            // Each new sculptor needs the word, and only them.
            this._hostSendWord();
            this._broadcast({ k: 'turn', name: h.builder, at: turn });
            this._hostPublish();
        }

        _hostPhase(phase, secs) {
            const h = this.host;
            h.phase = phase;
            h.remain = secs;
            if ((h.mode === 'checkpoint' || h.mode === 'delivery' || h.mode === 'treasure') && phase === 'play' && h.runners) {
                const now = Date.now();
                h.runners.forEach(r => {
                    r.startedAt = now; r.lastAt = now;
                    r.lastX = h.mode === 'delivery' ? DELIVERY_DEPOT.x : h.mode === 'treasure' ? TREASURE_START.x : CHECKPOINTS[0].x;
                    r.lastZ = h.mode === 'delivery' ? DELIVERY_DEPOT.z : h.mode === 'treasure' ? TREASURE_START.z : CHECKPOINTS[0].z;
                });
            }
            this._hostPublish();
        }

        _hostTick() {
            const h = this.host;
            if (!h) return;
            if (h.phase === 'final') return;           // waits for the host to decide

            h.remain--;
            if (h.phase === 'play' || h.phase === 'architect') h.elapsed++;

            // Everything must have landed before the survivors are counted.
            if (h.mode === 'earthquake' && h.phase === 'quake' && h.remain <= 1
                && this.game.physics && this.game.physics.on) {
                this.game.physics.flush();
            }

            // Nothing left to knock down is the end of a demolition round: the
            // room used to stand around in the rubble waiting out the clock.
            if (h.mode === 'demolition' && h.phase === 'play' && h.remain > 0
                && this._townLeft() === 0) {
                this.game.showToast('The town is down!', 'success', 2200);
                h.remain = 0;
            }

            // A finished co-op build, or one nobody has improved in a while,
            // ends the round rather than running out the clock on a crowd
            // standing around admiring it.
            if (h.mode === 'teambuild' && h.phase === 'play' && h.remain > 0) {
                const pct = this._hostTeamPct();
                if (pct >= 100) {
                    this.game.showToast('Built it! 🎉', 'success', 2400);
                    h.remain = 0;
                } else if (pct > (h.teamBest || 0)) {
                    h.teamBest = pct;
                    h.teamStill = 0;
                } else if (pct > 0 && ++h.teamStill >= TEAM_PLATEAU_SECS) {
                    this.game.showToast('Nobody is adding to it — calling it there', 'info', 2400);
                    h.remain = 0;
                }
            }

            if (h.mode === 'relay' && h.phase === 'play') this._hostRelayTurn();

            if (h.phase === 'quake') {
                const total = this._phaseSecs('quake');
                const done = total - h.remain;              // seconds into the quake
                const which = Math.floor((done - 1) / QUAKE_PER_PLOT);
                if (which >= 0 && which < (h.plots || []).length && which !== h.quakeAt) {
                    h.quakeAt = which;
                    this._hostShakePlot(h.plots[which]);
                    this._broadcast({ k: 'quake', at: which });
                    this._quakeFelt(which);
                }
            }

            if (h.remain > 0) { this._hostPublish(); return; }

            this._hostAdvancePhase();
        }

        /**
         * Leave the current phase and enter the next one in this mode's flow.
         *
         * Normally the clock decides this, but a phase can also be *finished* —
         * an architect who has built what they meant to build should not have
         * to stand there while the room watches nothing happen.
         */
        _hostAdvancePhase() {
            const h = this.host;
            if (!h) return;
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
            // Exploring a place that has not finished arriving is exploring an
            // empty world, so the countdown waits rather than lying.
            if (next === 'explore' && this._waitingForWorld()) {
                this._hostPhase('countdown', 1);
                return;
            }
            this._hostPhase(next, this._phaseSecs(next));
            // The place was built while the room was still entering the match,
            // so the snapshot that carried it raced everyone's own clearing of
            // the world. Send it again now that everybody is certainly here —
            // otherwise a guest explores an empty world it was never moved to.
            if (next === 'explore' && this.arenaIsWorld()) {
                this.game._sendWorldSnapshot({ force: true });
            }
        }

        /**
         * Whether this mode's arena IS the shared world.
         *
         * Every other mode builds an arena the host synthesises, so a joiner
         * asking for the world mid-match must be sent the arena. "Where on
         * Earth" moves the room to a real place instead — there is no arena to
         * send, and answering with one hands the joiner an empty world.
         */
        arenaIsWorld() {
            const mode = (this.state && this.state.mode) || (this.host && this.host.mode);
            return !!(mode && RULES[mode] && RULES[mode].noBuild);
        }

        /** True while the mystery place is still being built. */
        _waitingForWorld() {
            return !!(this.host && this.host.mode === 'whereonearth' && this.host.building);
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
                case 'quake': return Math.max(6, (h.plots || []).length * QUAKE_PER_PLOT + 3);
                case 'explore': return h.roundTime;
                case 'guess': return GUESS_SECS;
                case 'reveal':
                    if (h.mode === 'charades') return CHARADES_REVEAL_SECS;
                    return h.mode === 'whereonearth' ? EARTH_REVEAL_SECS : REVEAL_SECS;
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
                // The answer, with everything that makes it the answer taken
                // out: where the blocks were, and nothing about what they were.
                // Remembering the shape stops being the whole game; remembering
                // the colours becomes it.
                h.shapeHint = normalizeCells(h.target).slice(0, MEMORY_HINT_CELLS)
                    .map(r => [r[0], r[1], r[2]]);
                h.plots = computePlots(h.rebuilders.length ? h.rebuilders : this._eligiblePlayers());
                h.elapsed = 0;
            }

            if (rules.buildsAt === phase) this._hostPublishBuilds();
            if (rules.scoreAt === phase) {
                if (h.mode === 'whereonearth') this._hostScoreEarth();
                else if (h.mode === 'checkpoint') this._hostScoreCheckpoint();
                else if (h.mode === 'delivery') this._hostScoreDelivery();
                else if (h.mode === 'treasure') this._hostScoreTreasure();
                else this._hostScoreRound();
            }
        }

        _hostRecordSubmit(name, msg) {
            const h = this.host;
            if (!h || !h.plots.some(p => p.name === name)) return;

            // Memory Match: the architect saying "done" is the end of the
            // watching, not a submission. The phase ran a flat 45 seconds
            // whether they finished in twelve or wanted seventy — so the room
            // either stared at a finished build or watched one get cut off.
            if (h.mode === 'memory' && h.phase === 'architect' && name === h.builder && msg.locked) {
                this._hostAdvancePhase();
                return;
            }
            // A locked-in build is final: the end-of-round sweep must not
            // overwrite it, or the lock time (and its bonus) would be lost.
            const prev = h.submissions.get(name);
            if (prev && prev.locked && !msg.locked) return;
            h.submissions.set(name, {
                cells: (msg.cells || []).slice(0, MAX_SUBMIT_CELLS),
                pieces: (msg.pieces || []).slice(0, MAX_SUBMIT_CELLS),
                locked: !!msg.locked,
                at: h.phase === 'play' ? h.elapsed : h.roundTime
            });
            if (msg.locked) {
                h.locked.add(name);
                // Everyone is done — no reason to keep the clock running.
                if (h.phase === 'play' && h.plots.every(p => h.locked.has(p.name))) {
                    this._hostPublish();
                    this._hostPhase('scoring', SCORING_SECS);
                    return;
                }
                // Most of the room is done: the last few get a short countdown
                // instead of two more minutes everybody else has to sit through.
                const races = h.mode === 'blueprint' || h.mode === 'memory';
                if (races && h.phase === 'play' && !h.lastCall && h.plots.length >= 3) {
                    const done = h.plots.filter(p => h.locked.has(p.name)).length;
                    if (done >= Math.ceil(h.plots.length * LAST_CALL_SHARE) && h.remain > LAST_CALL_SECS) {
                        h.lastCall = true;
                        h.remain = LAST_CALL_SECS;
                    }
                }
                this._hostPublish();
            }
        }

        /**
         * A guess from a player (host-side only). Wrong guesses are echoed to
         * the room as chat — half the fun is watching people converge — while a
         * right one ends the round immediately and is never repeated aloud.
         */
        hostHandleGuess(name, text) {
            const h = this.host;
            const guessing = h && (h.mode === 'charades' || h.mode === 'relay');
            if (!guessing || h.phase !== 'play') return false;
            // In relay every sculptor has seen the word, not just the one
            // currently holding the chisel.
            const knows = h.mode === 'relay'
                ? (h.sculptors || []).indexOf(name) >= 0
                : name === h.builder;
            if (knows || h.guessed) return false;

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
            if (!h || !isVoted(h.mode) || h.phase !== 'vote') return false;
            if (!target || target === name) return false;
            // A vote has to name something on the ballot, and the ballot is not
            // the same list in every mode: Rush and Postcard vote for a build,
            // so the plots are the ballot; Saboteur votes for a person, and its
            // one shared plot is not anybody's name.
            const ballot = votesOnPlayers(h.mode) ? this._eligiblePlayers() : h.plots.map(p => p.name);
            if (ballot.indexOf(target) < 0) return false;
            h.votes.set(name, target);
            this._hostPublish();
            // Everyone has voted — no reason to sit out the rest of the clock.
            if (h.votes.size >= ballot.length) h.remain = 1;
            return true;
        }

        /** Somebody got it: banner, confetti over the stage, a run of notes. */
        _celebrateGuess(name, word) {
            const plot = (this.state && this.state.plots || [])[0];
            const v = this.game.voxels;
            if (plot) {
                const c = this._plotCentre(plot);
                v.fx.celebrate(c.x, 8, c.z, [this.game.generateUserColor(name), '#facc15', '#22c55e']);
            }
            this.game.showBanner(`${name} got it — “${word}”`);
            window.BlockPartySfx.fanfare(440);
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
            this._hostKeepResults(results);
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
                const pieces = (sub && sub.pieces) || [];

                // Chunked for the same reason the world is: a full plot does not
                // fit in one message.
                const chunks = [];
                for (let i = 0; i < cells.length; i += BUILD_CHUNK) {
                    chunks.push({ cells: cells.slice(i, i + BUILD_CHUNK), pieces: [] });
                }
                for (let i = 0; i < pieces.length; i += BUILD_CHUNK) {
                    chunks.push({ cells: [], pieces: pieces.slice(i, i + BUILD_CHUNK) });
                }
                if (!chunks.length) chunks.push({ cells: [], pieces: [] });
                chunks.forEach((c, i) => this._broadcast({
                    k: 'build', name: p.name, i, n: chunks.length, cells: c.cells, pieces: c.pieces
                }));

                this.builds.set(p.name, cells);
                this._paintBuild(p.name, cells, pieces);
            });
        }

        /**
         * Send a room-made blueprint to everyone, once, in chunks.
         *
         * It never rides the state broadcast: that goes out once a second and
         * would put a thousand cells on the wire every tick. This is the same
         * shape a finished build travels in, and the client caches it by id.
         */
        _hostPublishModel(model) {
            const cells = Models.decode(model) || [];
            const chunks = [];
            for (let i = 0; i < cells.length; i += BUILD_CHUNK) {
                chunks.push(cells.slice(i, i + BUILD_CHUNK));
            }
            if (!chunks.length) chunks.push([]);
            chunks.forEach((c, i) => this._broadcast({
                k: 'model', id: model.id, name: model.name, author: model.author || null,
                size: Models.size(model), i, n: chunks.length, cells: c
            }));
        }

        /**
         * Somebody's guess. Only during the guessing, and only one each — a pin
         * dropped again replaces the first rather than adding a second.
         */
        hostHandlePin(from, lat, lon) {
            const h = this.host;
            if (!h || h.mode !== 'whereonearth' || h.phase !== 'guess') return;
            if (!isFinite(lat) || !isFinite(lon)) return;
            h.pins.set(from, { lat: +lat, lon: +lon, at: Date.now() });
            this._hostPublish();
        }

        /**
         * Score the guesses and tell the room where it actually was.
         *
         * The answer goes out here and nowhere earlier: until this moment it
         * has only ever existed in the host's own `h.place`.
         */
        _hostScoreEarth() {
            const h = this.host;
            const place = h.place;
            if (!place) return;

            const rows = this._eligiblePlayers().map(name => {
                const pin = h.pins.get(name);
                if (!pin) return { name, points: 0, km: null, note: 'no guess' };
                const km = Places.distanceKm(pin, place);
                const points = Places.score(km);
                h.totals.set(name, (h.totals.get(name) || 0) + points);
                return {
                    name, points, km, lat: pin.lat, lon: pin.lon,
                    note: km <= 25 ? 'spot on' : km < 1000 ? km + ' km out' : Math.round(km / 100) / 10 + ' thousand km out'
                };
            }).sort((a, b) => b.points - a.points);

            const totals = Array.from(h.totals.entries())
                .map(([name, points]) => ({ name, points }))
                .sort((a, b) => b.points - a.points);

            const results = {
                mode: 'whereonearth', round: h.round, rounds: h.rounds,
                place: { name: place.name, country: place.country, lat: place.lat, lon: place.lon, hint: place.hint },
                rows, totals, isFinal: h.round >= h.rounds
            };
            this._hostKeepResults(results);
            this._broadcast({ k: 'results', r: results });
            this._applyResults(results);
            if (results.isFinal) this.game.recordMatchStats(results);
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
                case 'saboteur': this._hostScoreSaboteur(); return;
                case 'memory': this._hostScoreMemory(); return;
                case 'rush': case 'postcard': this._hostScoreRush(); return;
                case 'territory': this._hostScoreTerritory(); return;
                case 'demolition': this._hostScoreDemolition(); return;
                case 'relay': this._hostScoreRelay(); return;
                case 'earthquake': this._hostScoreQuake(); return;
                case 'checkpoint': this._hostScoreCheckpoint(); return;
                case 'delivery': this._hostScoreDelivery(); return;
                case 'treasure': this._hostScoreTreasure(); return;
                default: this._hostScoreBlueprint();
            }
        }

        _hostScoreCheckpoint() {
            const h = this.host;
            const limit = h.roundTime * 1000;
            const rows = this._eligiblePlayers().map(name => {
                const r = h.runners && h.runners.get(name);
                const complete = !!(r && r.done);
                const elapsed = complete ? r.finishedAt - r.startedAt : limit;
                // A completed route always beats an incomplete one; among
                // unfinished runners, more validated gates is the tie-break.
                const gates = r ? Math.max(0, r.next - 1) : 0;
                const points = complete ? Math.max(10, 140 - Math.round(elapsed / 1000)) : gates * 12;
                h.totals.set(name, (h.totals.get(name) || 0) + points);
                return {
                    name, complete, gates, elapsed, points,
                    note: complete ? `${fmt(elapsed / 1000)} · all ${CHECKPOINTS.length - 1} gates` : `${gates}/${CHECKPOINTS.length - 1} checkpoints`
                };
            }).sort((a, b) => (b.complete - a.complete) || (b.gates - a.gates) || (a.elapsed - b.elapsed));
            this._hostFinish({
                mode: 'checkpoint', round: h.round, rounds: h.rounds, rows,
                totals: this._hostTotalsList(), isFinal: h.round >= h.rounds
            });
        }

        _hostScoreDelivery() {
            const h = this.host;
            const limit = h.roundTime * 1000;
            const rows = this._eligiblePlayers().map(name => {
                const r = h.runners && h.runners.get(name);
                const complete = !!(r && r.done);
                const elapsed = complete ? r.finishedAt - r.startedAt : limit;
                const delivered = r ? r.delivered : 0;
                const points = complete ? Math.max(10, 170 - Math.round(elapsed / 1000)) : delivered * 25;
                h.totals.set(name, (h.totals.get(name) || 0) + points);
                return {
                    name, complete, delivered, elapsed, points,
                    note: complete ? `${fmt(elapsed / 1000)} · all ${DELIVERY_STOPS.length} parcels delivered`
                        : `${delivered}/${DELIVERY_STOPS.length} parcels delivered`
                };
            }).sort((a, b) => (b.complete - a.complete) || (b.delivered - a.delivered) || (a.elapsed - b.elapsed));
            this._hostFinish({
                mode: 'delivery', round: h.round, rounds: h.rounds, rows,
                totals: this._hostTotalsList(), isFinal: h.round >= h.rounds
            });
        }

        _hostScoreTreasure() {
            const h = this.host, limit = h.roundTime * 1000;
            const rows = this._eligiblePlayers().map(name => {
                const r = h.runners && h.runners.get(name);
                const complete = !!(r && r.done), found = r ? r.found.length : 0;
                const elapsed = complete ? r.finishedAt - r.startedAt : limit;
                const points = complete ? Math.max(10, 190 - Math.round(elapsed / 1000)) : found * 30;
                h.totals.set(name, (h.totals.get(name) || 0) + points);
                return { name, complete, found, elapsed, points,
                    note: complete ? `${fmt(elapsed / 1000)} · every cache found` : `${found}/${TREASURES.length} caches found` };
            }).sort((a, b) => (b.complete - a.complete) || (b.found - a.found) || (a.elapsed - b.elapsed));
            this._hostFinish({ mode: 'treasure', round: h.round, rounds: h.rounds, rows,
                totals: this._hostTotalsList(), isFinal: h.round >= h.rounds });
        }

        _hostFinish(results) {
            this._hostKeepResults(results);
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
        /**
         * How much of the co-op model is standing, right now.
         *
         * Cheap enough to ask once a second, and it is the only way to know the
         * room has finished: `lockIn` needs `myPlot`, which a shared plot never
         * is, so Team Build had no completion signal at all — eight players
         * finished a 5x5x5 model in well under a minute and then stood on it
         * for the remaining two.
         */
        _hostTeamPct() {
            const h = this.host;
            const model = Models.byId(h.modelId);
            const plot = h.plots && h.plots[0];
            if (!model || !plot) return 0;
            const o = modelOrigin(plot, model);
            const built = this.game.voxels.cellsInBox({
                x0: plot.x0, x1: plot.x0 + plot.size - 1,
                z0: plot.z0, z1: plot.z0 + plot.size - 1,
                y0: 0, y1: BUILD_HEIGHT
            }, o.x, o.z).map(a => ({ x: a[0], y: a[1], z: a[2], c: a[3], s: a[4] | 0 }));
            return scoreBuild(Models.decode(model), built).pct;
        }

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
                    // The score has always been three things — where, what
                    // shape, what colour — and players have never seen which of
                    // them they lost. As percentages of what there was to get.
                    place: sc.targetCount ? Math.round(100 * sc.matched / sc.targetCount) : 0,
                    shape: sc.matched ? Math.round(100 * sc.shapeOk / sc.matched) : 0,
                    colour: sc.matched ? Math.round(100 * sc.colorOk / sc.matched) : 0,
                    blocks: sc.builtCount, target: sc.targetCount, locked: false, at: h.roundTime
                };
            }).sort((a, b) => b.points - a.points);

            // The architect is paid by how well the room remembered: build
            // something memorable, not something impossible. Alone, they are
            // also the rebuilder, and must not be listed — or paid — twice.
            const avg = rows.length ? Math.round(rows.reduce((a, r) => a + r.pct, 0) / rows.length) : 0;
            if (!rows.some(r => r.name === h.builder)) {
                const built = (h.target || []).length;
                // Paying the room average alone made a single block the optimal
                // build: everyone copies it perfectly, everyone scores ~100, and
                // the architect banks the lot. So the average is scaled by how
                // much there was to remember...
                const size = Math.max(0.2, Math.min(1, built / MEMORY_FULL_SIZE));
                // ...and topped up for a build that actually separated the room.
                // Trivial (everyone perfect) and impossible (everyone lost) both
                // have no spread; the interesting build is the one in between.
                const spread = rows.length > 1 ? stdev(rows.map(r => r.pct)) : 0;
                const bonus = Math.round(Math.min(1, spread / 25) * MEMORY_SPREAD_BONUS);
                const points = Math.round(avg * size) + bonus;
                h.totals.set(h.builder, (h.totals.get(h.builder) || 0) + points);
                rows.push({
                    name: h.builder, pct: avg, points, isBuilder: true,
                    blocks: built, target: built,
                    note: built < MEMORY_FULL_SIZE
                        ? `architect — ${built} block${built === 1 ? '' : 's'} was too easy to be worth much`
                        : (bonus > 6 ? 'architect — memorable, and it sorted the room'
                            : 'architect — scored on how well the room remembered')
                });
            }

            this._hostFinish({
                mode: 'memory', round: h.round, rounds: h.rounds, builder: h.builder,
                architectBlocks: (h.target || []).length, average: avg,
                rows, totals: this._hostTotalsList(), isFinal: h.round >= h.rounds
            });
        }

        /**
         * Score a round of Saboteur.
         *
         * Two jobs pulling against each other, so they are paid separately:
         * the builders are paid for the model standing up and for working out
         * who was wrecking it, and the saboteur is paid for the damage and for
         * getting away with it. A saboteur who is caught still keeps the
         * damage; a room that finishes the build still loses marks for
         * accusing the wrong person.
         */
        _hostScoreSaboteur() {
            const h = this.host;
            const pct = this._hostTeamPct();
            const players = h.plots[0] && h.plots[0].shared
                ? this._eligiblePlayers() : h.plots.map(p => p.name);

            const votes = new Map();
            h.votes.forEach(target => votes.set(target, (votes.get(target) || 0) + 1));
            const cast = h.votes.size;
            const against = votes.get(h.saboteur) || 0;
            // Caught means more of the room named them than named anyone else,
            // and at least half of those who voted at all.
            let topVotes = 0;
            votes.forEach(n => { if (n > topVotes) topVotes = n; });
            const caught = against > 0 && against === topVotes && against * 2 >= cast;

            const rows = players.map(name => {
                const isSab = name === h.saboteur;
                const votedFor = h.votes.get(name) || null;
                let points, note;
                if (isSab) {
                    points = Math.round(100 - pct) + (caught ? 0 : SABOTEUR_ESCAPE_BONUS);
                    note = caught
                        ? `the saboteur — caught, ${against} of ${cast} named them`
                        : `the saboteur — got away with it`;
                } else {
                    const right = votedFor === h.saboteur;
                    points = Math.round(pct) + (right ? SABOTEUR_CAUGHT_BONUS : 0);
                    note = right ? `built, and named the saboteur`
                        : (votedFor ? `built, but blamed ${votedFor}` : 'built, and named nobody');
                }
                h.totals.set(name, (h.totals.get(name) || 0) + points);
                return { name, points, isSaboteur: isSab, caught, votes: votes.get(name) || 0, note };
            }).sort((a, b) => b.points - a.points);

            this._hostFinish({
                mode: 'saboteur', round: h.round, rounds: h.rounds,
                saboteur: h.saboteur, caught, teamPct: Math.round(pct),
                modelName: (Models.byId(h.modelId) || {}).name || '',
                modelEmoji: (Models.byId(h.modelId) || {}).emoji || '',
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
                mode: h.mode, round: h.round, rounds: h.rounds, prompt: h.prompt,
                picture: h.picture ? { id: h.picture.id, name: h.picture.name, rows: h.picture.rows } : null,
                rows, totals: this._hostTotalsList(), isFinal: h.round >= h.rounds
            });
        }

        /**
         * Put up the town that the round exists to knock down.
         *
         * Deterministic on purpose — no Math.random. The host is the only one
         * that builds it, and it reaches everyone as an ordinary relayed edit,
         * so the room does not need to agree on a seed.
         */
        _hostRaiseTown() {
            const rows = [];
            const span = DEMO_HALF * 2 - 6;
            const step = Math.floor(span / (DEMO_GRID - 1));
            let i = 0;
            for (let gx = 0; gx < DEMO_GRID; gx++) {
                for (let gz = 0; gz < DEMO_GRID; gz++) {
                    const x = -DEMO_HALF + 3 + gx * step;
                    const z = -DEMO_HALF + 3 + gz * step;
                    // Deterministic but not uniform: a skyline reads better
                    // than a grid of identical posts, and a tall one is worth
                    // going out of your way for.
                    const height = DEMO_MIN_H + ((gx * 5 + gz * 3 + gx * gz) % (DEMO_HEIGHT - DEMO_MIN_H + 1));
                    const colour = 1 + (i % 9);
                    for (let y = 0; y < height; y++) rows.push([x, y, z, colour, 0, SHARED]);
                    i++;
                }
            }
            this.host.demoTotal = rows.length;
            // Straight through the ordinary edit path, like every other block
            // that has ever appeared in this world.
            this.game.applyPhysicsEdit({ a: 'bulk', o: SHARED, place: rows });
        }

        /**
         * Credit a blow. Called by the host for its own knocks and for the ones
         * guests ask it to make — `physics.knock()` returns how much it brought
         * down, which is exactly the score this mode wants.
         */
        /**
         * What a blow at this cell is worth, before it is struck.
         *
         * Only the town scores. Rubble that has already come down settles under
         * a dead owner, so whacking a settled pile — which credited again, and
         * again, forever — is now worth nothing, and the round's total credit
         * can never exceed the town that was raised.
         */
        demolitionValue(x, y, z) {
            const g = this.game;
            if (!this.host || this.host.mode !== 'demolition' || !g.physics) return 0;
            const doomed = g.physics.previewKnock(x, y, z) || [];
            let n = 0;
            doomed.forEach(([cx, cy, cz]) => {
                if (g.voxels.ownerOf(cx, cy, cz) === SHARED) n++;
            });
            return n;
        }

        creditDemolition(name, blocks) {
            const h = this.host;
            if (!h || h.mode !== 'demolition' || !name || !(blocks > 0)) return;
            h.demo.set(name, (h.demo.get(name) || 0) + blocks);
        }

        /** Cells of the original town still standing. */
        _townLeft() {
            const counts = this.game.voxels.countsByOwner();
            return (counts && counts.get(SHARED)) || 0;
        }

        /** Knocking is the whole round, so it is allowed — and only here. */
        physicsAllowed() {
            const s = this.state;
            return !!(s && s.mode === 'demolition' && s.phase === 'play');
        }

        _hostScoreDemolition() {
            const h = this.host;
            const rows = this._eligiblePlayers().map(name => {
                const blocks = h.demo.get(name) || 0;
                h.totals.set(name, (h.totals.get(name) || 0) + blocks);
                return {
                    name, blocks, points: blocks,
                    note: `${blocks} block${blocks === 1 ? '' : 's'} brought down`
                };
            }).sort((a, b) => b.blocks - a.blocks);

            const felled = rows.reduce((n, r) => n + r.blocks, 0);
            this._hostFinish({
                mode: 'demolition', round: h.round, rounds: h.rounds,
                rows, totals: this._hostTotalsList(), isFinal: h.round >= h.rounds,
                note: `${felled} of ${h.demoTotal} blocks came down`
            });
        }

        /** Point every camera at whoever the ground is under. */
        _quakeFelt(index) {
            const s = this.state || {};
            const plot = (s.plots || this.host.plots || [])[index];
            if (!plot) return;
            const mine = plot.name === this.game.username;
            this.game.showToast(mine ? '🌋 Your turn — hold on' : `🌋 ${plot.name}'s ground gives way`,
                mine ? 'warning' : 'info', 1800);
            const c = this._plotCentre(plot);
            this.game.voxels.focus(c.x, 3, c.z, 30, Math.PI * 0.30);
        }

        /**
         * Shake one plot: hit every cell around the foot of whatever is standing
         * there, from outside, so a tower is pushed over rather than punched
         * through. Same pattern, same power, every plot — the only variable is
         * what you built.
         */
        _hostShakePlot(plot) {
            const g = this.game, v = g.voxels;
            if (!plot || !g.physics || !g.physics.on) return;
            const cx = plot.x0 + plot.size / 2, cz = plot.z0 + plot.size / 2;

            const feet = [];
            for (let x = plot.x0; x < plot.x0 + plot.size; x++) {
                for (let z = plot.z0; z < plot.z0 + plot.size; z++) {
                    if (v.hasBlock(x, 0, z)) feet.push([x, z]);
                }
            }
            // Outermost first: the ground gives way at the edges of a footprint.
            feet.sort((a, b) => (Math.abs(b[0] - cx) + Math.abs(b[1] - cz))
                - (Math.abs(a[0] - cx) + Math.abs(a[1] - cz)));

            feet.slice(0, 24).forEach(([x, z]) => {
                const dx = x + 0.5 - cx, dz = z + 0.5 - cz;
                const len = Math.hypot(dx, dz) || 1;
                // Shoved outward, away from the middle of the plot.
                g.physics.knock(x, 0, z, { x: dx / len, z: dz / len }, QUAKE_POWER);
            });
        }

        /** Height counts: a tall thing that stands beats a slab that cannot fall. */
        _hostScoreQuake() {
            const h = this.host, v = this.game.voxels;
            const rows = (h.plots || []).map(plot => {
                const cells = v.cellsInBox({
                    x0: plot.x0, x1: plot.x0 + plot.size - 1,
                    z0: plot.z0, z1: plot.z0 + plot.size - 1,
                    y0: 0, y1: QUAKE_HEIGHT
                }, plot.x0, plot.z0) || [];
                let points = 0, top = 0;
                cells.forEach(c => {
                    const y = (c.y !== undefined ? c.y : c[1]) || 0;
                    points += y + 1;               // a block up high is worth more
                    if (y + 1 > top) top = y + 1;
                });
                h.totals.set(plot.name, (h.totals.get(plot.name) || 0) + points);
                return {
                    name: plot.name, blocks: cells.length, points, height: top,
                    note: cells.length
                        ? `${cells.length} left standing, ${top} high`
                        : 'flattened'
                };
            }).sort((a, b) => b.points - a.points);

            this._hostFinish({
                mode: 'earthquake', round: h.round, rounds: h.rounds,
                rows, totals: this._hostTotalsList(), isFinal: h.round >= h.rounds
            });
        }

        /**
         * The guesser is paid for speed, as in charades. The sculptors share a
         * pot weighted by how long each had held the chisel when it was solved
         * — so opening well is worth as much as finishing.
         */
        _hostScoreRelay() {
            const h = this.host;
            const players = this._eligiblePlayers();
            const line = h.sculptors || [];
            const frac = h.guessed ? Math.max(0, (h.roundTime - h.guessed.at) / h.roundTime) : 0;
            const pot = h.guessed ? 40 + Math.round(60 * frac) : 0;

            // Seconds each sculptor actually served before the solve.
            const share = h.roundTime / (line.length || 1);
            const upTo = h.guessed ? h.guessed.at : h.roundTime;
            const served = line.map((_, i) => {
                const from = i * share, to = (i + 1) * share;
                return Math.max(0, Math.min(upTo, to) - from);
            });
            const total = served.reduce((a, b) => a + b, 0) || 1;

            const rows = players.map(name => {
                const idx = line.indexOf(name);
                const isGuesser = !!(h.guessed && h.guessed.name === name);
                let points = 0, note = '—';
                if (isGuesser) {
                    points = 50 + Math.round(50 * frac);
                    note = `guessed in ${h.guessed.at}s`;
                } else if (idx >= 0) {
                    points = Math.round(pot * (served[idx] / total));
                    note = h.guessed
                        ? `sculpted ${Math.round(served[idx])}s of it`
                        : 'nobody guessed it';
                }
                h.totals.set(name, (h.totals.get(name) || 0) + points);
                return { name, points, isBuilder: idx >= 0, isGuesser, note };
            }).sort((a, b) => b.points - a.points);

            this._hostFinish({
                mode: 'relay', round: h.round, rounds: h.rounds,
                word: h.word, sculptors: line,
                guessedBy: h.guessed ? h.guessed.name : null,
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
            // Demolition scores live on the host; the room needs them to show
            // each player their own running tally while the round is on.
            const demo = {};
            if (h.demo) h.demo.forEach((n, name) => { demo[name] = n; });
            const runners = {};
            if (h.runners && h.mode === 'checkpoint') h.runners.forEach((r, name) => {
                runners[name] = { next: r.next, done: r.done, gates: Math.max(0, r.next - 1), elapsed: r.done ? r.finishedAt - r.startedAt : 0 };
            });
            const deliveries = {};
            if (h.runners && h.mode === 'delivery') h.runners.forEach((r, name) => {
                deliveries[name] = { carrying: r.carrying, delivered: r.delivered, done: r.done, elapsed: r.done ? r.finishedAt - r.startedAt : 0 };
            });
            const treasure = {};
            if (h.runners && h.mode === 'treasure') h.runners.forEach((r, name) => {
                treasure[name] = { found: r.found.slice(), done: r.done, elapsed: r.done ? r.finishedAt - r.startedAt : 0 };
            });
            return {
                demo,
                runners,
                checkpoints: h.mode === 'checkpoint' ? CHECKPOINTS.map(p => ({ x: p.x, z: p.z, label: p.label })) : null,
                deliveries,
                delivery: h.mode === 'delivery' ? { depot: DELIVERY_DEPOT, stops: DELIVERY_STOPS } : null,
                treasure,
                sculptors: h.sculptors || null,
                budget: rules.budget || 0,
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
                // Postcard's reference. Small enough (sixteen short strings)
                // to ride the once-a-second state, which means a dropped
                // packet costs nothing and a mid-round joiner gets it for
                // free. What it is *called* waits until the round is over —
                // naming it would do the interesting half of the thinking.
                pic: h.mode === 'postcard' && h.picture ? {
                    id: h.picture.id,
                    rows: h.picture.rows,
                    name: ['reveal', 'vote', 'tally', 'final'].indexOf(h.phase) >= 0
                        ? h.picture.name : ''
                } : null,
                buildHeight: rules.height || BUILD_HEIGHT,
                lastCall: !!h.lastCall,
                // Saboteur votes on people rather than plots, and a shared plot
                // is one row for the whole room — so the ballot needs the list.
                players: h.mode === 'saboteur' ? this._eligiblePlayers() : null,
                teamPct: h.mode === 'saboteur' && h.phase !== 'countdown' ? Math.round(this._hostTeamPct()) : 0,
                votesCast: h.votes ? h.votes.size : 0,
                voters: isVoted(h.mode) ? Array.from(h.votes.keys()) : [],
                // The answer is only safe to send once the round is over.
                target: h.mode === 'memory' && (h.phase === 'reveal') ? h.target : null,
                // ...but its outline may flash back mid-round. Only while the
                // peek window is open, so the shape is not simply sitting on
                // the wire for anyone who cares to read it.
                shape: (h.mode === 'memory' && h.phase === 'play' && this._peekNow(h))
                    ? (h.shapeHint || null) : null,
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

            // The results go out once, on a channel that makes no promises —
            // and a dropped one leaves a player staring at a scoreboard that
            // never arrives, with nothing to ask for. State survives being lost
            // because it repeats every second; the result now does too, for as
            // long as it is the thing on screen.
            const h = this.host;
            if (h && h.lastResults && ['reveal', 'vote', 'tally', 'final'].indexOf(h.phase) >= 0) {
                h.resultTick = (h.resultTick || 0) + 1;
                if (h.resultTick % 2 === 0) this._broadcast({ k: 'results', r: h.lastResults });
            }
        }

        /** Remember the round's result so it can be said again. */
        _hostKeepResults(results) {
            if (this.host) { this.host.lastResults = results; this.host.resultTick = 0; }
        }

        _hostBroadcastState() { if (this.host) this._hostPublish(); }

        _phaseTotal(phase, roundTime) {
            const charades = this.host && this.host.mode === 'charades';
            switch (phase) {
                case 'countdown': return COUNTDOWN_SECS;
                case 'study': return STUDY_SECS;
                case 'play': return roundTime;
                case 'scoring': return SCORING_SECS;
                case 'explore': return roundTime;
                case 'guess': return GUESS_SECS;
                case 'reveal': return charades ? CHARADES_REVEAL_SECS : REVEAL_SECS;
                case 'vote': return VOTE_SECS;
                case 'tally': return TALLY_SECS;
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
            // Ask for the arena *after* clearing, not before: a joiner who is
            // sent it on connect would have it wiped by this very line a moment
            // later, which is exactly what happened.
            if (!g.isHost()) setTimeout(() => g.sendData({ type: 'requestWorld' }), 250);
            g.undoStack.length = 0;
            g.redoStack.length = 0;
            g.hidePlayHint();
            this._showHud(true);
        }

        /**
         * Everything this mode does to the interface, in one place.
         *
         * Exploring: the coordinates go quiet, because reading them off the
         * screen would be the whole game. Guessing: the map becomes a form —
         * one click drops your pin and nothing else happens. Reveal: the pins
         * come back, everyone's and the true one.
         */
        _syncEarth(phase) {
            const g = this.game, s = this.state;
            if (!s || s.mode !== 'whereonearth') {
                if (this._earthOn) {
                    g.setPlaceSecret(false);
                    if (g.minimap) { g.minimap.pickMode = null; g.minimap.setMarks(null); }
                    this._earthOn = false;
                }
                return;
            }
            this._earthOn = true;
            const revealing = phase === 'reveal';
            g.setPlaceSecret(!revealing);

            if (!g.minimap) return;
            if (phase === 'guess') {
                if (!g.minimap.open) g.minimap.setOpen(true);
                g.minimap.pickMode = (lat, lon) => {
                    this.myPin = { lat, lon };
                    this._send({ k: 'pin', lat, lon });
                    this._markPins();
                    g.showToast('Pin dropped — you can move it until time is up', 'success', 2200);
                };
            } else {
                g.minimap.pickMode = null;
            }
            this._markPins();
        }

        /** What the map should be showing: my pin, and at the reveal, everyone's. */
        _markPins() {
            const g = this.game, s = this.state;
            if (!g.minimap || !s) return;
            const marks = [];
            if (this.myPin) {
                marks.push({ lat: this.myPin.lat, lon: this.myPin.lon, colour: '#22d3ee', label: 'you' });
            }
            const r = this.results;
            if (r && r.place) {
                marks.push({ lat: r.place.lat, lon: r.place.lon, colour: '#34d399', label: r.place.name, big: true });
                (r.rows || []).forEach(row => {
                    if (typeof row.lat !== 'number') return;
                    if (row.name === g.username) return;
                    marks.push({
                        lat: row.lat, lon: row.lon,
                        colour: g.generateUserColor(row.name), label: row.name
                    });
                });
            }
            g.minimap.setMarks(marks.length ? marks : null);
        }

        _startRound() {
            const g = this.game;
            this.locked = false;
            this.voted = null;
            this.accuracy = 0;
            this.results = null;
            this.builds.clear();
            this.myPin = null;
            this._stopReveals(false);   // the world is about to be cleared
            this._stopTour();
            g.voxels.clearAll();
            g.voxels.clearGhosts();
            this._ghostVisible = false;
            g.undoStack.length = 0;
            g.redoStack.length = 0;
            g.hideResults();
            const s = this.state;

            if (s.mode === 'checkpoint') {
                const start = (s.checkpoints || [])[0];
                if (start && g.fps) g.fps.enterAt(start.x, start.z);
            }
            if (s.mode === 'delivery' && s.delivery && g.fps) {
                g.fps.enterAt(s.delivery.depot.x, s.delivery.depot.z);
            }
            if (s.mode === 'treasure' && g.fps) g.fps.enterAt(TREASURE_START.x, TREASURE_START.z);

            // The world has just been cleared for the round; now the host puts
            // up the thing this mode exists to knock down. It reaches everyone
            // as an ordinary relayed edit, so only the host builds it.
            if (this.host && s.mode === 'demolition') this._hostRaiseTown();

            // Relay is a guessing round with the same chat and word plumbing.
            const charades = s.mode === 'charades' || s.mode === 'relay';
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
            this._ceremony(s, prev);

            if (s.mode === 'whereonearth') {
                this._syncEarth(phase);
                if (phase !== wasPhase) {
                    if (phase === 'explore') {
                        this.game.showToast('Where are you? Look around — fly, walk, read the coast', 'info', 3200);
                    } else if (phase === 'guess') {
                        this.game.showToast('Time is up — drop a pin on the map where you think this is', 'info', 3600);
                    }
                }
                return;
            }

            if (s.mode === 'checkpoint') {
                this._syncCheckpointMarkers();
                return;
            }

            if (s.mode === 'delivery') {
                this._syncDeliveryMarkers();
                return;
            }

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

            if (s.mode === 'saboteur') {
                if (phase === 'play' && wasPhase !== 'play') {
                    this.game.showToast(this._iAmSaboteur()
                        ? '🕵 Wreck it quietly — look like you are helping'
                        : '🤝 Build it together. One of you is not helping.', 'info', 3400);
                }
                if (phase === 'vote' && wasPhase !== 'vote') {
                    this.voted = null;
                    this._renderPlayerVote();
                }
                return;
            }

            if (s.mode === 'postcard') {
                if (phase === 'play' && wasPhase !== 'play') {
                    this.game.showToast('🖼 Build what the picture shows', 'info', 3000);
                }
                if (phase === 'scoring' && wasPhase !== 'scoring') this._submitBuild(false);
                if (phase === 'vote' && wasPhase !== 'vote') {
                    this.voted = null;
                    this._renderVote();
                    this._startTour();
                }
                if (phase === 'reveal' && wasPhase !== 'reveal' && s.pic && s.pic.name) {
                    this.game.showToast(`🖼 It was ${s.pic.name.toLowerCase()}`, 'info', 3000);
                }
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

            // Memory's flashback: the outline of what you are trying to
            // remember, in one flat colour. It arrives with the peek and goes
            // with it, so there is never a copy of it sitting on screen.
            if (s.mode === 'memory') {
                const shapePlot = this.myPlot || this.myArea();
                const showShape = phase === 'play' && s.peek && s.shape && s.shape.length && shapePlot;
                if (showShape && !this._shapeVisible) {
                    this.game.voxels.showGhost('shape', s.shape.map(r => ({
                        x: r[0], y: r[1], z: r[2], c: MEMORY_HINT_COLOUR, s: 0
                    })), shapePlot.x0, shapePlot.z0, false);
                    this._shapeVisible = true;
                } else if (!showShape && this._shapeVisible) {
                    this.game.voxels.hideGhost('shape');
                    this._shapeVisible = false;
                }
            } else if (this._shapeVisible) {
                this.game.voxels.hideGhost('shape');
                this._shapeVisible = false;
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
            if (s.lastCall && !(prev && prev.lastCall)) {
                this.game.showToast(this.locked
                    ? 'Most of the room is done — 15 seconds for the stragglers'
                    : '⏳ Last call — 15 seconds!', 'warning', 2600);
            }
            if (phase === 'play' && s.peek && !(prev && prev.peek)) {
                this.game.showToast(s.mode === 'memory' ? '👀 Flashback — the shape only' : '👀 Blueprint!',
                    'info', 1200);
            }
        }

        _syncCheckpointMarkers() {
            const s = this.state;
            if (!s || s.mode !== 'checkpoint') return;
            const mine = s.runners && s.runners[this.game.username];
            const keep = new Set();
            (s.checkpoints || []).forEach((point, i) => {
                const name = '__race_' + i;
                keep.add(name);
                const active = mine && mine.next === i && !mine.done;
                this.game.voxels.setGeoMarker(name, point.x, point.z,
                    active ? '#fbbf24' : (i === 0 ? '#34d399' : '#64748b'), false, active);
            });
            this._checkpointMarkers = keep;
        }

        _clearCheckpointMarkers() {
            if (!this._checkpointMarkers) return;
            this._checkpointMarkers.forEach(name => this.game.voxels.removeGeoMarker(name));
            this._checkpointMarkers = null;
        }

        _syncDeliveryMarkers() {
            const s = this.state;
            if (!s || s.mode !== 'delivery' || !s.delivery) return;
            const mine = s.deliveries && s.deliveries[this.game.username];
            const active = mine && !mine.done
                ? (mine.carrying ? s.delivery.stops[mine.delivered] : s.delivery.depot) : null;
            const keep = new Set();
            [s.delivery.depot].concat(s.delivery.stops || []).forEach((point, i) => {
                const name = '__delivery_' + i;
                keep.add(name);
                const on = !!active && active.x === point.x && active.z === point.z;
                this.game.voxels.setGeoMarker(name, point.x, point.z,
                    on ? '#fbbf24' : (i === 0 ? '#38bdf8' : '#64748b'), false, on);
            });
            this._deliveryMarkers = keep;
        }

        _clearDeliveryMarkers() {
            if (!this._deliveryMarkers) return;
            this._deliveryMarkers.forEach(name => this.game.voxels.removeGeoMarker(name));
            this._deliveryMarkers = null;
        }

        // `strong` is the blueprint you are studying; the faint set is the
        // comparison overlay laid over finished builds at the reveal.
        /**
         * The theatre around a round: a counted start, a clock that gets loud
         * near the end, a reveal that drifts rather than freezing, and confetti
         * for whoever earned it. None of it changes what happens — all of it
         * changes whether a round feels like an event.
         */
        _ceremony(s, prev) {
            const sfx = window.BlockPartySfx;
            const was = prev && prev.phase;

            // Counted start. One beep a second, a higher one on "GO".
            if (s.phase === 'countdown') {
                const left = Math.ceil(s.remain);
                if (left !== this._countShown) {
                    this._countShown = left;
                    this.game.showCountdown(String(left));
                    sfx.countdown(left);
                }
            } else if (was === 'countdown') {
                this._countShown = null;
                const first = s.phase === 'study' ? 'STUDY' : (s.phase === 'architect' ? 'WATCH' : 'GO!');
                this.game.showCountdown(first);
                sfx.countdown(0);
            }

            // The last ten seconds of building tighten up.
            if (s.phase === 'play') {
                const left = Math.ceil(s.remain);
                if (left <= 10 && left !== this._urgentAt) {
                    this._urgentAt = left;
                    if (left > 0) sfx.urgent(left <= 3);
                }
            } else {
                this._urgentAt = null;
            }

            if (s.phase === 'reveal' && was !== 'reveal') sfx.fanfare(392);
            if (s.phase === 'final' && was !== 'final') this._celebrateWinner();
        }

        /** Confetti over whoever won, and a run of notes to go with it. */
        _celebrateWinner() {
            const r = this.results;
            const top = r && r.totals && r.totals[0];
            if (!top) return;
            const plot = (this.state.plots || []).find(p => p.name === top.name) || (this.state.plots || [])[0];
            const v = this.game.voxels;
            if (plot) {
                const c = this._plotCentre(plot);
                v.focus(c.x, 3, c.z, plot.size * 2.2, PLOT_VIEW_PHI);
                v.fx.celebrate(c.x, 6, c.z, [this.game.generateUserColor(top.name), '#facc15', '#ffffff']);
            }
            window.BlockPartySfx.fanfare(523);
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
            // Relay is a guessing round with the same chat and word plumbing.
            const charades = s.mode === 'charades' || s.mode === 'relay';
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
                } else if (isVoted(s.mode) && this.results) {
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

        _paintBuild(name, cells, pieces) {
            const s = this.state;
            if (!s) return;
            const plot = (s.plots || []).find(p => p.name === name);
            if (!plot) return;
            if (name === this.game.username) return;    // mine is already standing
            // Same frame the build was submitted in: the model's, or the plot's
            // corner in the modes that have no blueprint.
            const o = this.model ? modelOrigin(plot, this.model) : { x: plot.x0, z: plot.z0 };

            // Bricks and the loose cells around them. A brick's cells are in the
            // cell list too — that is what was scored — so those are skipped, or
            // placing them would break the very bricks just laid.
            const covered = new Set();
            (pieces || []).forEach(a => {
                BlockPartyBricks.cellsOf(a[1] + o.x, a[2], a[3] + o.z, a[4], a[5])
                    .forEach(c => covered.add(c[0] + ',' + c[1] + ',' + c[2]));
            });
            const loose = (cells || []).filter(a =>
                !covered.has((a[0] + o.x) + ',' + a[1] + ',' + (a[2] + o.z)));

            const items = [];
            (pieces || []).forEach(a => items.push({ y: a[2], piece: a }));
            loose.forEach(a => items.push({ y: a[1], cell: a }));
            if (!items.length) return;

            // In the relay modes the build has been standing all along and this
            // is only a resync, so it goes down at once. Where it was a secret,
            // the moment the covers come off is the whole point of the round.
            if (s.hideRivals === false) {
                items.forEach(it => this._placeRevealItem(name, o, it));
                return;
            }

            // Bottom up, and outward from the middle: a build that rises like a
            // building being built, rather than one that appears like a page
            // refresh. Bricks and cells are sorted together, and they never
            // overlap, so the order between them does not matter.
            const c = this._plotCentre(plot);
            const away = (x, z) => Math.hypot(x + o.x - c.x, z + o.z - c.z);
            items.forEach(it => {
                it.d = it.piece ? away(it.piece[1], it.piece[3]) : away(it.cell[0], it.cell[2]);
            });
            items.sort((a, b) => a.y - b.y || a.d - b.d);

            this._reveals.push({
                sig: this._roundSig, name, o, items, i: 0,
                per: Math.max(REVEAL_MIN_BATCH, Math.ceil(items.length / REVEAL_FRAMES)),
                // One sound per handful, or a four-hundred-block build is a
                // machine gun rather than a flourish.
                every: Math.max(4, Math.ceil(items.length / 12)), since: 0
            });
            this._pumpReveals();
        }

        /** One block or one brick, put where it belongs. */
        _placeRevealItem(name, o, it) {
            const v = this.game.voxels;
            if (it.piece) {
                const a = it.piece;
                v.setPiece({
                    id: name + ':' + a[0], x: a[1] + o.x, y: a[2], z: a[3] + o.z,
                    w: a[4], d: a[5], c: a[6], owner: a[7] || name
                });
                return { x: a[1] + o.x, y: a[2], z: a[3] + o.z };
            }
            const a = it.cell;
            const x = a[0] + o.x, y = a[1], z = a[2] + o.z;
            if (v.inBounds(x, y, z)) v.setBlock(x, y, z, a[3], name, a[4] | 0);
            return { x, y, z };
        }

        /**
         * Drain the rising builds, a batch per frame.
         *
         * Every queue is stamped with the round it belongs to and dropped the
         * moment the round changes — a straggler painting cells into the next
         * round's empty arena would be a genuinely baffling bug, and
         * `_startRound` clears the world out from under anything still running.
         */
        _pumpReveals() {
            if (this._revealRaf) return;
            const step = () => {
                this._revealRaf = null;
                this._reveals = this._reveals.filter(r => r.sig === this._roundSig && r.i < r.items.length);
                if (!this._reveals.length) return;

                const sfx = window.BlockPartySfx, fx = this.game.voxels.fx;
                this._reveals.forEach(r => {
                    const end = Math.min(r.items.length, r.i + r.per);
                    for (; r.i < end; r.i++) {
                        const at = this._placeRevealItem(r.name, r.o, r.items[r.i]);
                        if (++r.since < r.every) continue;
                        r.since = 0;
                        // The place sound already climbs with height, so a build
                        // rising plays its own scale.
                        if (sfx) sfx.place(at.y, true);
                        if (fx) fx.pop(at.x, at.y, at.z, this.game.voxels.renderColorAt(at.x, at.y, at.z) || '#ffffff');
                    }
                });
                this._revealRaf = requestAnimationFrame(step);
            };
            this._revealRaf = requestAnimationFrame(step);
        }

        /**
         * Stop the builds rising. Flushed when the animation cannot run — a
         * hidden tab gets no frames, and coming back to a half-built reveal
         * would be worse than not animating at all — and discarded when the
         * round is over and the world is about to be cleared anyway.
         */
        _stopReveals(flush) {
            if (this._revealRaf) cancelAnimationFrame(this._revealRaf);
            this._revealRaf = null;
            if (flush) {
                this._reveals.forEach(r => {
                    for (; r.i < r.items.length; r.i++) this._placeRevealItem(r.name, r.o, r.items[r.i]);
                });
            }
            this._reveals = [];
        }

        // ---------- my build ----------

        // The bricks standing in my plot, in the same frame as _myCells.
        _myPieces() {
            const plot = this.myPlot;
            if (!plot) return [];
            const o = this.model ? modelOrigin(plot, this.model) : { x: plot.x0, z: plot.z0 };
            const out = [];
            this.game.voxels.pieces.forEach(p => {
                if (p.x < plot.x0 || p.x > plot.x0 + plot.size - 1) return;
                if (p.z < plot.z0 || p.z > plot.z0 + plot.size - 1) return;
                out.push([p.id, p.x - o.x, p.y, p.z - o.z, p.w, p.d, p.c, p.owner || null]);
            });
            return out.slice(0, MAX_SUBMIT_CELLS);
        }

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
            // Cells are what gets scored; the pieces ride along so the reveal
            // shows the bricks somebody actually laid rather than a pile of
            // loose studs.
            const msg = { k: 'submit', name: this.game.username, cells, pieces: this._myPieces(), locked: !!locked };
            if (this.host) this._hostRecordSubmit(this.game.username, msg);
            else this._send(msg);
        }

        lockIn() {
            if (!this._matchRunning() || !this.myPlot) return;

            // Memory Match: the architect's "done" ends the watching rather
            // than submitting a rebuild. Nothing is scored, so none of the
            // accuracy bookkeeping below applies.
            if (this.state.mode === 'memory' && this.state.phase === 'architect'
                && this.state.builder === this.game.username) {
                const msg = { k: 'submit', name: this.game.username, cells: [], pieces: [], locked: true };
                if (this.host) this._hostRecordSubmit(this.game.username, msg);
                else this._send(msg);
                this.game.showToast('Done — the room gets a good look, then it goes', 'success', 2200);
                return;
            }

            if (this.state.phase !== 'play') return;
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
            // The answer has just arrived: put it on the map next to everyone's
            // guesses, and give the coordinates back.
            if (r && r.mode === 'whereonearth') {
                this.game.setPlaceSecret(false);
                this._markPins();
            }
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

            if (r.mode === 'whereonearth') {
                const p = r.place || {};
                this.game.showResults({
                    title: r.isFinal ? '🏆 Final standings' : `Round ${r.round} of ${r.rounds}`,
                    subtitle: `It was <strong>${esc(p.name || 'somewhere')}</strong>, ${esc(p.country || '')}`
                        + (p.hint ? ` — ${esc(p.hint)}` : ''),
                    body: `<div class="rs-list">${simpleRows(r.rows, row => row.km === null ? '—' : row.km + ' km')}</div>
                           <div class="rs-totals-title">Match points</div>
                           <div class="rs-totals">${totalsOf()}</div>`,
                    isFinal: r.isFinal, canControl: this.game.isHost()
                });
                return;
            }

            if (r.mode === 'checkpoint') {
                this.game.showResults({
                    title: r.isFinal ? '🏆 Final standings' : `🏁 Round ${r.round} of ${r.rounds}`,
                    subtitle: 'Every gate was host-validated from first-person movement.',
                    body: `<div class="rs-list">${simpleRows(r.rows, row => row.complete ? fmt(row.elapsed / 1000) : row.gates + ' gates')}</div>
                           <div class="rs-totals-title">Match points</div><div class="rs-totals">${totalsOf()}</div>`,
                    isFinal: r.isFinal, canControl: this.game.isHost()
                });
                return;
            }

            if (r.mode === 'delivery') {
                this.game.showResults({
                    title: r.isFinal ? '🏆 Final standings' : `📦 Round ${r.round} of ${r.rounds}`,
                    subtitle: 'Pickups and drop-offs were host-validated from first-person movement.',
                    body: `<div class="rs-list">${simpleRows(r.rows, row => row.complete ? fmt(row.elapsed / 1000) : row.delivered + ' parcels')}</div>
                           <div class="rs-totals-title">Match points</div><div class="rs-totals">${totalsOf()}</div>`,
                    isFinal: r.isFinal, canControl: this.game.isHost()
                });
                return;
            }

            if (r.mode === 'treasure') {
                this.game.showResults({
                    title: r.isFinal ? '🏆 Final standings' : `🗺️ Round ${r.round} of ${r.rounds}`,
                    subtitle: 'Every cache was confirmed by the host from first-person movement.',
                    body: `<div class="rs-list">${simpleRows(r.rows, row => row.complete ? fmt(row.elapsed / 1000) : row.found + ' caches')}</div>
                           <div class="rs-totals-title">Match points</div><div class="rs-totals">${totalsOf()}</div>`,
                    isFinal: r.isFinal, canControl: this.game.isHost()
                });
                return;
            }

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
                // Three bars per rebuild: where the blocks went, what shape
                // they were, what colour they were. A round that ends in one
                // number tells you that you did badly; this tells you at what.
                const bar = (label, pct, cls) => `
                    <span class="rs-bar" title="${label}">
                        <span class="rs-bar-label">${label}</span>
                        <span class="rs-bar-track"><span class="rs-bar-fill ${cls}" style="width:${Math.max(0, Math.min(100, pct))}%"></span></span>
                        <span class="rs-bar-pct">${pct}%</span>
                    </span>`;
                const mrows = r.rows.map((row, i) => `
                    <div class="rs-row${row.name === this.game.username ? ' me' : ''}" data-player="${esc(row.name)}">
                        <span class="rs-rank">${medal(i)}</span>
                        <span class="rs-dot" style="background:${this.game.generateUserColor(row.name)}"></span>
                        <span class="rs-name">${esc(row.name)}${row.isBuilder ? ' 🧠' : ''}</span>
                        <span class="rs-pct">${row.pct}%</span>
                        <span class="rs-detail">${row.isBuilder ? esc(row.note || '')
                            : `<span class="rs-bars">${bar('place', row.place || 0, 'place')}${bar('shape', row.shape || 0, 'shape')}${bar('colour', row.colour || 0, 'colour')}</span>`}</span>
                        <span class="rs-points">${row.points}</span>
                    </div>`).join('');
                this.game.showResults({
                    title: r.isFinal ? '🏆 Final standings' : `Round ${r.round} of ${r.rounds}`,
                    subtitle: `<strong>${esc(r.builder)}</strong> built ${r.architectBlocks} blocks —`
                        + ` the room remembered <strong>${r.average}%</strong> of it`,
                    body: `<div class="rs-list">${mrows}</div>
                           <div class="rs-totals-title">Match points</div>
                           <div class="rs-totals">${totalsOf()}</div>`,
                    isFinal: r.isFinal, canControl: this.game.isHost()
                });
                return;
            }

            if (r.mode === 'saboteur') {
                const srows = r.rows.map((row, i) => `
                    <div class="rs-row${row.name === this.game.username ? ' me' : ''}${row.isSaboteur ? ' saboteur' : ''}" data-player="${esc(row.name)}">
                        <span class="rs-rank">${row.isSaboteur ? '🕵' : medal(i)}</span>
                        <span class="rs-dot" style="background:${this.game.generateUserColor(row.name)}"></span>
                        <span class="rs-name">${esc(row.name)}</span>
                        <span class="rs-pct">${row.votes ? '🗳 ' + row.votes : ''}</span>
                        <span class="rs-detail">${esc(row.note || '')}</span>
                        <span class="rs-points">${row.points}</span>
                    </div>`).join('');
                this.game.showResults({
                    title: r.isFinal ? '🏆 Final standings' : `Round ${r.round} of ${r.rounds}`,
                    subtitle: `It was <strong>${esc(r.saboteur)}</strong> — ${r.caught ? 'and the room got them' : 'and they got away with it'}`
                        + `. The build finished at <strong>${r.teamPct}%</strong>`,
                    body: `<div class="rs-list">${srows}</div>
                           <div class="rs-totals-title">Match points</div>
                           <div class="rs-totals">${totalsOf()}</div>`,
                    isFinal: r.isFinal, canControl: this.game.isHost()
                });
                return;
            }

            if (r.mode === 'postcard') {
                this.game.showResults({
                    title: r.isFinal ? '🏆 Final standings' : `Round ${r.round} of ${r.rounds}`,
                    subtitle: r.picture
                        ? `The picture was <strong>${esc(r.picture.name.toLowerCase())}</strong>`
                        : 'The room has voted',
                    body: `<div class="rs-list">${simpleRows(r.rows, row => '🗳 ' + row.votes)}</div>
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

        /**
         * Draw the round's reference picture, or take it away.
         *
         * Drawn as squares in the game's own palette rather than shown as an
         * image, because that is what it is: a grid of the same twelve colours
         * the room is building with. Redrawn only when the picture changes —
         * this runs on every state tick.
         */
        _renderPicture() {
            const card = document.getElementById('pictureCard');
            if (!card) return;
            const s = this.state;
            const pic = s && s.pic;
            const show = !!(pic && pic.rows && this._matchRunning());
            card.classList.toggle('hidden', !show);
            if (!show) { this._picDrawn = null; return; }

            // Sit under the players panel, wherever it happens to end.
            const players = document.getElementById('playersPanel') || document.querySelector('.players-panel');
            if (players) {
                const r = players.getBoundingClientRect();
                if (r.height) card.style.top = Math.round(r.bottom + 10) + 'px';
            }

            const caption = document.getElementById('pictureCaption');
            if (caption) {
                caption.innerHTML = pic.name
                    ? `It was <strong>${esc(pic.name.toLowerCase())}</strong>.`
                    : 'This is the whole brief. There is no model to copy — work out what it shows, and build that.';
            }

            const sig = pic.id + '|' + (pic.rows[0] || '');
            if (this._picDrawn === sig) return;
            this._picDrawn = sig;

            const cv = document.getElementById('pictureCanvas');
            if (!cv || !cv.getContext) return;
            const hexes = this.game.voxels.paletteHex();
            const KEY = (window.BlockPartyPictures || {}).KEY || {};
            const rows = pic.rows;
            const n = rows.length;
            const px = cv.width / (rows[0] || '').length || 20;
            const ctx = cv.getContext('2d');
            ctx.clearRect(0, 0, cv.width, cv.height);
            for (let y = 0; y < n; y++) {
                for (let x = 0; x < rows[y].length; x++) {
                    const ch = rows[y][x];
                    if (ch === '.') continue;
                    const idx = KEY[ch];
                    if (idx == null) continue;
                    ctx.fillStyle = hexes[idx] || '#94a3b8';
                    ctx.fillRect(Math.round(x * px), Math.round(y * px), Math.ceil(px), Math.ceil(px));
                }
            }
        }

        _renderVote() {
            const s = this.state;
            if (!s || !isVoted(s.mode)) return;
            const me = this.game.username;
            if (votesOnPlayers(s.mode)) return this._renderPlayerVote();
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
                subtitle: s.mode === 'postcard'
                    ? `The picture was ${s.pic && s.pic.name ? `<strong>${esc(s.pic.name.toLowerCase())}</strong>` : 'the one on the right'} — you cannot vote for your own build`
                    : `The prompt was <strong>${esc(s.prompt)}</strong> — you cannot vote for your own build`,
                body: `<div class="rs-list">${rows}</div>`,
                isFinal: false, canControl: false
            });
        }

        /**
         * The ballot when the question is "which one of us was it".
         *
         * Everyone in the room is on it except you — you already know.
         */
        _renderPlayerVote() {
            const s = this.state;
            const me = this.game.username;
            const players = (s.players || []).filter(Boolean);
            const rows = players.map(name => {
                const mine = name === me;
                const picked = this.voted === name;
                return `<div class="rs-row${mine ? ' me' : ''}" data-player="${esc(name)}">
                    <span class="rs-rank">${mine ? '🫵' : '🕵'}</span>
                    <span class="rs-dot" style="background:${this.game.generateUserColor(name)}"></span>
                    <span class="rs-name">${esc(name)}${mine ? ' (you)' : ''}</span>
                    <span class="rs-pct"></span>
                    <span class="rs-detail">${mine ? 'you cannot accuse yourself' : 'laid ' + ((s.progress && s.progress[name]) || 0) + ' blocks'}</span>
                    <span class="rs-points">
                        <button class="vote-btn${picked ? ' picked' : ''}" data-vote="${esc(name)}"
                            ${mine ? 'disabled title="You cannot accuse yourself"' : ''}>
                            ${picked ? '✓ Accused' : 'Accuse'}
                        </button>
                    </span>
                </div>`;
            }).join('');

            this.game.showResults({
                title: '🕵 Who was wrecking it?',
                subtitle: `The build finished at <strong>${this.results ? this.results.teamPct : (s.teamPct || 0)}%</strong> — one of you did not want it to`,
                body: `<div class="rs-list">${rows}</div>`,
                isFinal: false, canControl: false
            });
        }

        castVote(name) {
            const s = this.state;
            if (!s || !isVoted(s.mode) || s.phase !== 'vote') return;
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
            // A held shot reads as frozen; a slow orbit reads as a camera move.
            this.game.voxels.startDrift(0.16);
            window.BlockPartySfx.chime(this._tourIndex);
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
            this.game.voxels.startDrift(0);
        }

        // ---------- HUD ----------

        _showHud(on) {
            const hud = document.getElementById('matchHud');
            if (hud) hud.classList.toggle('hidden', !on);
            // The reference card belongs to the match, not to the world — and
            // the HUD comes down without another render to take it with it.
            if (!on) {
                const card = document.getElementById('pictureCard');
                if (card) card.classList.add('hidden');
                this._picDrawn = null;
            }
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

            // Relay is a guessing round with the same chat and word plumbing.
            const charades = s.mode === 'charades' || s.mode === 'relay';
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
                    else if (s.mode === 'checkpoint') {
                        const mine = s.runners && s.runners[this.game.username];
                        phaseText = mine && mine.done ? `🏁 Finished — ${fmt((mine.elapsed || 0) / 1000)}` : `🏁 Run! ${fmt(remain)}`;
                    }
                    else if (s.mode === 'delivery') {
                        const mine = s.deliveries && s.deliveries[this.game.username];
                        phaseText = mine && mine.done ? `📦 Delivered — ${fmt((mine.elapsed || 0) / 1000)}` : `📦 Deliver! ${fmt(remain)}`;
                    }
                    else if (s.mode === 'treasure') {
                        const mine = s.treasure && s.treasure[this.game.username];
                        phaseText = mine && mine.done ? `🗺️ Complete — ${fmt((mine.elapsed || 0) / 1000)}` : `🗺️ Hunt! ${fmt(remain)}`;
                    }
                    else if (s.mode === 'memory' && s.builder === this.game.username) phaseText = `Watching — ${fmt(remain)}`;
                    else if (s.mode === 'memory') phaseText = `From memory — ${fmt(remain)}`;
                    else if (s.mode === 'demolition') phaseText = `🧨 Wreck it! ${fmt(remain)}`;
                    else if (s.lastCall) phaseText = this.locked
                        ? `✅ Locked in — last call, ${fmt(remain)}`
                        : `⏳ Last call! ${fmt(remain)}`;
                    else phaseText = this.myArea()
                        ? (this.locked ? '✅ Locked in — waiting for the others' : `Build! ${fmt(remain)}`)
                        : `Spectating — ${fmt(remain)}`;
                    break;
                case 'quake': phaseText = `🌋 Earthquake! ${fmt(remain)}`; break;
                case 'scoring': phaseText = 'Scoring…'; break;
                case 'reveal': phaseText = isVoted(s.mode) ? '👀 Take a look' : '👀 Reveal'; break;
                case 'vote': phaseText = s.mode === 'saboteur'
                    ? `🕵 Who was it? ${Math.ceil(remain)}s` : `🗳 Vote! ${Math.ceil(remain)}s`; break;
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
                else if (s.mode === 'postcard') {
                    peek.textContent = s.phase === 'vote'
                        ? `${s.votesCast}/${(s.plots || []).length} voted`
                        : '🖼 The picture is the brief';
                }
                else if (s.mode === 'saboteur') {
                    peek.textContent = s.phase === 'vote'
                        ? `${s.votesCast}/${(s.players || []).length} accused somebody`
                        : (this._iAmSaboteur() ? '🕵 You are the saboteur' : `Together: ${s.teamPct || 0}%`);
                }
                else if (s.mode === 'territory') peek.textContent = `Your blocks: ${this._myTerritory()}`;
                else if (s.mode === 'earthquake') {
                    const left = Math.max(0, (s.budget || 0) - this._spentByMe());
                    peek.textContent = s.phase === 'quake' ? '🌋 Hold on…' : `Blocks left: ${left}`;
                }
                else if (s.mode === 'demolition') {
                    const mine = (s.demo && s.demo[this.game.username]) || 0;
                    peek.textContent = `Brought down: ${mine}`;
                }
                else if (s.mode === 'checkpoint') {
                    const mine = s.runners && s.runners[this.game.username];
                    const next = mine && s.checkpoints && s.checkpoints[mine.next];
                    peek.textContent = mine && mine.done ? '🏁 Course complete'
                        : (next ? `🧭 ${next.label} · gate ${(mine.gates || 0) + 1}/${(s.checkpoints || []).length - 1}` : '🧭 Find the next gate');
                }
                else if (s.mode === 'delivery') {
                    const mine = s.deliveries && s.deliveries[this.game.username];
                    const target = mine && s.delivery && (mine.carrying ? s.delivery.stops[mine.delivered] : s.delivery.depot);
                    peek.textContent = mine && mine.done ? '📦 All deliveries complete'
                        : (target ? `🧭 ${mine.carrying ? 'Deliver to' : 'Pick up at'} ${target.label} · ${(mine.delivered || 0) + 1}/${(s.delivery.stops || []).length}` : '📦 Awaiting route');
                }
                else if (s.mode === 'treasure') {
                    const mine = s.treasure && s.treasure[this.game.username];
                    peek.textContent = mine && mine.done ? '🗺️ Every cache found'
                        : `🧭 ${mine ? mine.found.length : 0}/${TREASURES.length} caches found — follow the compass clue`;
                }
                else if (s.mode === 'memory') {
                    peek.textContent = s.phase === 'architect' ? 'Remember it!'
                        : (s.peek ? '👀 The shape — no colours'
                            : (s.nextPeek ? `Flashback in ${s.nextPeek}s` : 'From memory'));
                }
                else peek.textContent = s.peek ? '👀 Blueprint visible' : `Next peek in ${s.nextPeek}s`;
            }

            const lock = document.getElementById('mhLockBtn');
            if (lock) {
                const lockable = s.mode === 'blueprint' || s.mode === 'memory';
                const architect = s.mode === 'memory' && s.phase === 'architect'
                    && s.builder === this.game.username;
                const show = architect
                    || (lockable && s.phase === 'play' && this.myPlot && !this.locked);
                lock.classList.toggle('hidden', !show);
                if (show) {
                    lock.innerHTML = window.icon('check', 'icon--sm') + (architect ? ' Done — start the clock' : ' Lock in');
                    lock.title = architect
                        ? 'Stop building and give the room its look at it (L)'
                        : 'Submit your build now and claim the speed bonus (L)';
                }
            }

            const leave = document.getElementById('mhEndBtn');
            if (leave) leave.classList.toggle('hidden', !this.game.isHost());

            this._renderPicture();
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
            this._stopReveals(false);   // the sandbox is coming back
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

            // Whatever the round took over, give back.
            g.setPlaceSecret(false);
            if (g.minimap) { g.minimap.pickMode = null; g.minimap.setMarks(null); }
            this._earthOn = false;
            this.myPin = null;

            if (this._xrayWasOn === false && g.xray) g.toggleXray();
            this._xrayWasOn = undefined;
            g.voxels.clearArena();
            g.voxels.clearGhosts();
            this._clearCheckpointMarkers();
            this._clearDeliveryMarkers();
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

        /**
         * Client → host only. These messages are nobody else's business: a
         * guess must not reach the other guessers, a vote must not sway them,
         * and a submitted build is the host's to score. A plain sendData()
         * would have UserConnectionBase fan them out to the whole room.
         */
        _send(msg) {
            const payload = Object.assign({ type: 'mode' }, msg);
            if (!this.game.sendToHost(payload)) this.game.sendData(payload);
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
        MODES, MODE_KINDS, ModeController, computePlots, scoreBuild, modelOrigin,
        BUILD_HEIGHT, WORLD_HALF
    };
})();
