/**
 * Guess the Doodle: the Whiteboard's game for one, or for a room.
 *
 * The doodle bot (doodle-bot.js) draws something on the board one line at a
 * time, with its own cursor, through the same path a pen stroke takes: kept on
 * the board, painted, and sent to the room. Anyone guesses in the chat, or in
 * the card this puts on screen. The tab that started the game is the referee:
 * it hears every guess, and a right one is announced to the room in the chat.
 *
 * Why it exists: a whiteboard on your own is a piece of paper. This gives a
 * lone visitor something to do with it, and shows a room what "every stroke
 * appears as it is made" looks like before anyone else has joined.
 */
(function () {
    'use strict';

    const SEGMENT_MS = 45;       // one segment of a line
    const PATH_PAUSE_MS = 220;   // lifting the pen between lines
    const NEXT_MS = 3500;        // after a win, the next doodle starts by itself

    const game = { round: null, rounds: 0, wins: 0, last: null, timer: null, nextTimer: null };

    /** A square in the middle of what this screen shows, in canvas coordinates. */
    function boxInView() {
        const size = 360;
        const mid = viewportToCanvas(window.innerWidth / 2, window.innerHeight / 2);
        const x = Math.min(Math.max(mid.x - size / 2, 20), CANVAS_CONFIG.WIDTH - size - 20);
        const y = Math.min(Math.max(mid.y - size / 2, 20), CANVAS_CONFIG.HEIGHT - size - 20);
        return { x, y, size };
    }

    function say(message) {
        // To the room, as a chat line; and here, since our own sends are not echoed.
        if (typeof whiteboardGame !== 'undefined' && whiteboardGame && connected) {
            whiteboardGame.sendChat('🤖 ' + message).catch(() => {});
        }
        if (typeof addChatMessage === 'function') addChatMessage(DoodleBot.NAME, message, '#7048e8');
    }

    /** One segment onto the board, exactly as a pen puts it there. */
    function ink(seg, round) {
        const stroke = { x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2, color: round.doodle.color,
            size: 5, erase: false, isMagic: false, op: round.op, by: DoodleBot.NAME };
        addStrokeToBoardState(stroke);
        drawStroke(stroke);
        if (typeof webrtcHelper !== 'undefined' && webrtcHelper && connected) {
            webrtcHelper.broadcastDataChannel({ type: 'stroke-batch', op: round.op, strokes: [stroke], sender: username });
        }
        remoteCursorTargets.set(DoodleBot.NAME, { x: seg.x2, y: seg.y2, color: round.doodle.color });
    }

    /** Draw the next segment, or the next line, until the doodle is done. */
    function step() {
        const r = game.round;
        if (!r) return;
        const path = r.paths[r.path];
        if (!path) return finishDrawing();
        ink(path[r.seg], r);
        r.seg++;
        r.drawn++;
        render();
        let wait = SEGMENT_MS;
        if (r.seg >= path.length) { r.path++; r.seg = 0; wait = PATH_PAUSE_MS; }
        game.timer = setTimeout(step, wait);
    }

    /** Put whatever is left of the doodle down at once (a win or a reveal). */
    function drawTheRest() {
        const r = game.round;
        clearTimeout(game.timer);
        while (r && r.paths[r.path]) {
            ink(r.paths[r.path][r.seg], r);
            r.drawn++;
            r.seg++;
            if (r.seg >= r.paths[r.path].length) { r.path++; r.seg = 0; }
        }
        finishDrawing();
    }

    function finishDrawing() {
        clearTimeout(game.timer);
        remoteCursorTargets.delete(DoodleBot.NAME);
        const cursor = remoteCursors.get(DoodleBot.NAME);
        if (cursor) { cursor.remove(); remoteCursors.delete(DoodleBot.NAME); }
        if (typeof captureHistorySnapshot === 'function') captureHistorySnapshot();
        if (game.round) game.round.finished = true;
        render();
    }

    function start() {
        if (typeof canvas === 'undefined' || !canvas) return false;
        stopTimers();
        const doodle = DoodleBot.pick(Math.random, game.last);
        game.last = doodle.name;
        game.rounds++;
        const paths = DoodleBot.strokesFor(doodle, boxInView());
        game.round = { doodle, paths, path: 0, seg: 0, drawn: 0,
            total: paths.reduce((n, p) => n + p.length, 0),
            op: 'op_doodle_' + Date.now().toString(36), winner: null, revealed: false, finished: false };
        say('I am drawing something. Guess what it is!');
        render();
        game.timer = setTimeout(step, 400);
        return true;
    }

    /** A chat line from anyone (this tab included): is it the answer? */
    function heard(from, text) {
        const r = game.round;
        // The bot's own lines start with its face; another game's announcement is not a guess.
        if (!r || r.winner || r.revealed || !text || from === DoodleBot.NAME || /^\s*🤖/.test(text)) return false;
        if (!DoodleBot.matches(r.doodle, text)) return false;
        r.winner = from;
        game.wins++;
        drawTheRest();
        say(`${from} got it: ${DoodleBot.called(r.doodle)}!`);
        celebrate();
        game.nextTimer = setTimeout(start, NEXT_MS);
        render();
        return true;
    }

    function reveal() {
        const r = game.round;
        if (!r || r.winner || r.revealed) return;
        r.revealed = true;
        drawTheRest();
        say(`It was ${DoodleBot.called(r.doodle)}.`);
        render();
    }

    function stopTimers() { clearTimeout(game.timer); clearTimeout(game.nextTimer); }

    function stop() {
        stopTimers();
        if (game.round && !game.round.finished) finishDrawing();
        game.round = null;
        render();
    }

    // ------------------------------------------------------------- the card

    function guessFromCard(e) {
        e.preventDefault();
        const input = document.getElementById('doodleGuess');
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        // A guess is a chat line: the room sees it, and the referee hears it.
        if (typeof whiteboardGame !== 'undefined' && whiteboardGame && connected) {
            whiteboardGame.sendChat(text).catch(() => {});
        }
        addChatMessage(username || 'You', text, '#6965db');
        if (!heard(username || 'You', text)) {
            const card = document.getElementById('doodleCard');
            card.classList.remove('is-wrong');
            void card.offsetWidth;   // restart the shake
            card.classList.add('is-wrong');
        }
    }

    function card() {
        let el = document.getElementById('doodleCard');
        if (el) return el;
        el = document.createElement('section');
        el.id = 'doodleCard';
        el.className = 'doodle-card';
        el.setAttribute('aria-label', 'Guess the doodle');
        el.innerHTML = `
            <div class="doodle-card__head">
                <span class="doodle-card__bot" aria-hidden="true">🤖</span>
                <p class="doodle-card__line" id="doodleLine" role="status" aria-live="polite"></p>
                <button class="wb-btn" type="button" id="doodleStop" aria-label="Stop the game" title="Stop the game">
                    <svg class="icon" aria-hidden="true"><use href="#i-x"></use></svg>
                </button>
            </div>
            <div class="doodle-card__bar" aria-hidden="true"><span id="doodleBar"></span></div>
            <form class="doodle-card__form" id="doodleForm">
                <input id="doodleGuess" type="text" autocomplete="off" maxlength="60" placeholder="What is it?" aria-label="Your guess">
                <button class="wb-btn wb-btn--primary" type="submit">Guess</button>
                <button class="wb-btn" type="button" id="doodleReveal">Reveal</button>
                <button class="wb-btn" type="button" id="doodleNext" hidden>Draw another</button>
            </form>
            <p class="doodle-card__score" id="doodleScore"></p>`;
        document.body.appendChild(el);
        el.querySelector('#doodleForm').addEventListener('submit', guessFromCard);
        el.querySelector('#doodleReveal').addEventListener('click', reveal);
        el.querySelector('#doodleNext').addEventListener('click', start);
        el.querySelector('#doodleStop').addEventListener('click', stop);
        return el;
    }

    function render() {
        const r = game.round;
        const el = r ? card() : document.getElementById('doodleCard');
        if (!el) return;
        el.hidden = !r;
        if (!r) return;
        const done = !!(r.winner || r.revealed);
        el.classList.toggle('is-won', !!r.winner);
        el.querySelector('#doodleLine').textContent = r.winner
            ? `🎉 ${r.winner} got it: ${DoodleBot.called(r.doodle)}!`
            : r.revealed ? `It was ${DoodleBot.called(r.doodle)}.`
                : r.finished ? 'Done drawing. What is it?' : 'Doodle bot is drawing… what is it?';
        el.querySelector('#doodleBar').style.width = Math.round(100 * r.drawn / Math.max(1, r.total)) + '%';
        el.querySelector('#doodleGuess').disabled = done;
        el.querySelector('#doodleReveal').hidden = done;
        el.querySelector('#doodleNext').hidden = !done;
        el.querySelector('#doodleScore').textContent = `Guessed ${game.wins} of ${game.rounds}`;
    }

    /** A burst of colour over the card: the moment you got it. */
    function celebrate() {
        if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const host = card();
        const burst = document.createElement('div');
        burst.className = 'doodle-burst';
        burst.setAttribute('aria-hidden', 'true');
        const colours = ['#e03131', '#f08c00', '#2f9e44', '#1c7ed6', '#ae3ec9', '#fab005'];
        for (let i = 0; i < 24; i++) {
            const bit = document.createElement('i');
            const a = (i / 24) * Math.PI * 2;
            bit.style.setProperty('--dx', Math.round(Math.cos(a) * (70 + (i % 3) * 30)) + 'px');
            bit.style.setProperty('--dy', Math.round(Math.sin(a) * (50 + (i % 4) * 20) - 30) + 'px');
            bit.style.background = colours[i % colours.length];
            burst.appendChild(bit);
        }
        host.appendChild(burst);
        setTimeout(() => burst.remove(), 1200);
    }

    window.DoodleGame = { start, stop, reveal, heard, get round() { return game.round; }, get wins() { return game.wins; } };
})();
