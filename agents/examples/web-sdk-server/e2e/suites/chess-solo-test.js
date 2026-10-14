/**
 * Chess, alone: one person opens a room and plays the computer.
 *
 * The waiting room offers the computer; the computer takes the other seat and
 * answers real clicks on the board with legal moves; a check lights the king
 * and says so; a mate ends the game with a winner and closes the board; the
 * move list numbers a loaded game properly; a new game starts its clocks at 0.
 *
 * Joins through the party lobby, as a visitor does, so the channel is a code
 * room ('chess-NNNNNN.chess'); clean up with
 *   scripts/cleanup_channels.py --prefix '^chess-[0-9]{6}\.chess$' --yes
 * SHOTS=<dir> saves desktop and phone screenshots there.
 */
const { BASE, LAUNCH, results } = require('../lib/harness');
const { chromium } = require('playwright');
const path = require('path');

const r = results();
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const game = (p, expr) => p.evaluate(new Function('return (' + expr + ');'));
const shot = (p, name) => process.env.SHOTS && p.screenshot({ path: path.join(process.env.SHOTS, name + '.png') });

async function waitFor(p, expr, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await game(p, expr)) return true; await sleep(250); }
    return false;
}

/** Click a square by name, the way a player does (White's view: a8 top-left). */
async function click(p, sq) {
    const row = 8 - Number(sq[1]), col = 'abcdefgh'.indexOf(sq[0]);
    await p.click(`#chessBoard [data-row="${row}"][data-col="${col}"]`);
}

async function playsBack(p) {
    await click(p, 'e2'); await click(p, 'e4');
    r.check(await waitFor(p, 'window.chessGame.chess.history().length === 2', 8000),
        'the computer answers a clicked move with one of its own');
    r.check(await game(p, "document.querySelectorAll('#chessBoard .coord').length === 16"),
        'the board carries its coordinates (8 files, 8 ranks)');
    r.check(await game(p, "document.querySelectorAll('#chessBoard .last-move').length === 2"),
        "the computer's move is marked on the board");
    await shot(p, 'chess-vs-computer');
}

async function checkAndMate(p) {
    // 1.e4 e5 2.Bc4 Nc6 3.Qh5 Nf6?? — White to play Qxf7#.
    const PGN = '[Event "t"]\n\n1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 *\n';
    r.check(await game(p, `window.chessGame.loadPgnText(${JSON.stringify(PGN)})`), 'a game can be loaded as host');
    const rows = await game(p, "[...document.querySelectorAll('#moveHistory .move-number')].map((n) => n.textContent.trim()).join(' ')");
    r.check(rows === '1. 1… 2. 2… 3. 3…', `the loaded game is numbered move by move (${rows})`);
    await click(p, 'h5'); await click(p, 'f7');
    await sleep(300);
    const end = await game(p, "({ dialog: (document.querySelector('.game-over-dialog .result') || {}).textContent, glyph: !!document.querySelector('.game-over-glyph'), ended: window.chessGame.gameEnded })");
    r.check(/Checkmate! .+ wins/.test(end.dialog || '') && !/null/.test(end.dialog) && end.glyph,
        `a mate ends the game with a named winner (${end.dialog})`);
    await shot(p, 'chess-checkmate');
    await sleep(1500);
    r.check(await game(p, 'window.chessGame.chess.history().length === 7'), 'and the computer does not move after it');

    // A check, from a fresh load: 1.e4 f5 — Qh5+.
    await game(p, `window.chessGame.loadPgnText(${JSON.stringify('[Event "t"]\n\n1. e4 f5 *\n')})`);
    await click(p, 'd1'); await click(p, 'h5');
    r.check(await waitFor(p, "!!document.querySelector('.board-flash') && !!document.querySelector('#chessBoard .in-check')", 1500),
        'a check flashes "Check!" and lights the king in check');
    await shot(p, 'chess-check');
}

async function newGame(p) {
    await game(p, 'window.chessGame.handleNewGame({ type: "new-game" })');
    const fresh = await game(p, "({ w: window.chessGame._clockMs.w, b: window.chessGame._clockMs.b, rows: document.querySelectorAll('#moveHistory .move-entry').length, ended: window.chessGame.gameEnded })");
    r.check(fresh.w === 0 && fresh.b === 0 && fresh.rows === 0 && !fresh.ended,
        `a new game starts from zero clocks and an empty list (${JSON.stringify(fresh)})`);
}

async function phone(b, width) {
    const p = await (await b.newContext({ viewport: { width, height: 760 }, isMobile: true, hasTouch: true })).newPage();
    await p.goto(BASE + '/apps/chess/index.html', { waitUntil: 'load' });
    await p.waitForSelector('#partyLobby:not(.pl-loading)', { timeout: 20000 });
    await p.evaluate(() => {
        document.getElementById('partyLobby')?.remove();
        document.getElementById('connectionModal')?.classList.remove('active');
        document.getElementById('gameContainer').classList.remove('hidden');
        document.getElementById('lobbyPanel').classList.remove('hidden');
    });
    await sleep(400);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    r.check(over <= 0, `at ${width}px nothing overflows the phone (${over}px over)`);
    await shot(p, 'chess-phone-' + width);
    await p.context().close();
}

(async () => {
    const b = await chromium.launch(LAUNCH);
    const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    try {
        await p.goto(BASE + '/apps/chess/index.html', { waitUntil: 'load' });
        await p.waitForSelector('#partyLobby:not(.pl-loading)', { timeout: 20000 });
        await p.click('#partyLobby .pl-btn--primary');
        await waitFor(p, 'window.chessGame && window.chessGame.connected && window.chessGame.isHost()', 45000);
        await sleep(2000);
        r.check(/Play the computer/.test(await p.innerText('#plWaiting').catch(() => '')), 'the waiting room offers the computer');
        await p.click('#plWaiting .pl-btn:has-text("Play the computer")');
        await sleep(500);
        const seats = await game(p, '({ me: window.chessGame.myColor, w: window.chessGame.whitePlayer, b: window.chessGame.blackPlayer })');
        r.check(seats.me === 'white' && seats.b === 'Computer', `the lone player takes white and the computer black (${JSON.stringify(seats)})`);
        await playsBack(p);
        await checkAndMate(p);
        await newGame(p);
        await phone(b, 375);
        await phone(b, 320);
    } catch (err) {
        r.check(false, 'the suite ran to the end: ' + (err && err.message));
    }
    r.check(errors.length === 0, 'no page errors ' + errors.slice(0, 2).join(' | '));
    console.log('room: ' + await p.evaluate(() => window.chessGame && window.chessGame.channelName).catch(() => '?'));
    await b.close();
    process.exitCode = r.report() ? 1 : 0;
})();
