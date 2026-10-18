/**
 * Chess over a whole evening: people arrive, reload and leave mid-game, and the
 * game is still the same game on every screen.
 *
 * White (the host) and Black play; Sam watches; Dan comes later.
 *  - Sam, arriving after four moves, sees the same position and the whole
 *    move list, and is seated as a spectator, not a player;
 *  - Black closes the tab and comes back under the same name: the seat is
 *    still Black's, the board is the game's, and Black's next move reaches
 *    White;
 *    While Black is gone the seat is kept, marked away, and Sam cannot take it
 *    (it used to be emptied at once, so Black came back to no seat at all);
 *  - White, the host, leaves: Black and Sam keep the same game, and Dan,
 *    arriving after, gets it from whoever is host now; a new game frees the
 *    seat that was only kept for the game White left.
 *
 * Channels are 'chr<time>.chess'; clean up with
 *   scripts/cleanup_channels.py --prefix '^chr[0-9]+\.chess$' --yes
 */
const { BASE, LAUNCH, results } = require('../lib/harness');
const { chromium } = require('playwright');
const { useChannelForm } = require('../lib/party-room');

const r = results();
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const game = (p, expr) => p.evaluate(new Function('return (' + expr + ');'));
const ROOM = 'chr' + Math.floor(Date.now() / 1000);

async function waitFor(p, expr, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await game(p, expr)) return true; await sleep(250); }
    return false;
}

async function join(b, name, errors) {
    const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    p.on('pageerror', (e) => errors.push(name + ': ' + e.message.split('\n')[0]));
    await p.goto(BASE + '/apps/chess/index.html', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#connectionModal.active', { timeout: 45000 });
    await useChannelForm(p);
    await p.evaluate(() => document.getElementById('tabCustom')?.click());
    await p.fill('#usernameInput', name);
    await p.fill('#channelInput', ROOM);
    await p.fill('#passwordInput', 'pw12345');
    await p.click('#connectBtn');
    await waitFor(p, 'window.chessGame && window.chessGame.connected', 45000);
    await sleep(3000);
    return p;
}

const view = (p) => game(p, "({ fen: chessGame.chess.fen(), moves: chessGame.chess.history().join(' '), me: chessGame.myColor, w: chessGame.whitePlayer, b: chessGame.blackPlayer })");
const move = (p, from, to) => game(p, `chessGame.makeMove('${from}', '${to}')`);
const plies = (n) => `chessGame.chess.history().length === ${n}`;

async function spectatorMidGame(b, white, black, errors) {
    for (const [p, f, t] of [[white, 'e2', 'e4'], [black, 'e7', 'e5'], [white, 'g1', 'f3'], [black, 'b8', 'c6']]) {
        await move(p, f, t);
        await waitFor(p === white ? black : white, 'true', 0);
        await sleep(1200);
    }
    const sam = await join(b, 'Sam', errors);
    await waitFor(sam, plies(4), 15000);
    const [w, s] = [await view(white), await view(sam)];
    r.check(s.fen === w.fen, `Sam, arriving after four moves, sees the game's position (${s.moves})`);
    r.check(s.moves === 'e4 e5 Nf3 Nc6', `and the whole move list (${s.moves})`);
    r.check(s.me !== 'w' && s.me !== 'b' && s.w === 'White' && s.b === 'Black', `and is not seated as a player (${s.me}; ${s.w} v ${s.b})`);
    return sam;
}

async function blackReloads(b, white, black, sam, errors) {
    await black.close({ runBeforeUnload: true });
    await sleep(3000);
    r.check(await waitFor(white, "/Away/.test(document.getElementById('blackPlayerStatus').textContent)", 8000),
        `while Black is gone, White sees the seat kept and marked away (${await game(white, "document.getElementById('blackPlayerStatus').textContent")})`);
    await game(sam, "chessGame.chooseColor('black')");
    await sleep(2500);
    r.check((await view(white)).b === 'Black', "and Sam cannot sit down in Black's seat mid-game");
    const again = await join(b, 'Black', errors);
    await waitFor(again, plies(4), 15000);
    const v = await view(again);
    r.check(v.me === 'b' || v.me === 'black', `Black, back under the same name, has the black seat again (${v.me})`);
    r.check(v.moves === 'e4 e5 Nf3 Nc6', `and the game's board (${v.moves})`);
    await move(white, 'f1', 'c4');
    await waitFor(again, plies(5), 10000);
    await move(again, 'g8', 'f6');
    r.check(await waitFor(white, plies(6), 10000), "and Black's next move reaches White");
    return again;
}

async function hostLeaves(b, white, black, sam, errors) {
    const before = (await view(black)).fen;
    await white.close({ runBeforeUnload: true });
    await sleep(6000);
    const [bv, sv] = [await view(black), await view(sam)];
    r.check(bv.fen === before && sv.fen === before, `White, the host, leaves: Black and Sam keep the same game (${bv.moves})`);
    const dan = await join(b, 'Dan', errors);
    await waitFor(dan, plies(6), 20000);
    const dv = await view(dan);
    r.check(dv.fen === before && dv.moves === bv.moves, `Dan, arriving after, gets the game from the new host (${dv.moves || 'nothing'})`);
    await game(black, 'chessGame.requestNewGame()');
    await sleep(500);   // it asks first, like a person would be asked
    await black.evaluate(() => { const ok = [...document.querySelectorAll('button')].filter((x) => x.textContent.trim() === 'New game').pop(); if (ok) ok.click(); });
    r.check(await waitFor(black, 'chessGame.whitePlayer === null && chessGame.chess.history().length === 0', 8000),
        `a new game frees White's seat, kept only for the game White left (${(await view(black)).w})`);
}

(async () => {
    const b = await chromium.launch(LAUNCH);
    const errors = [];
    try {
        const white = await join(b, 'White', errors);
        const black = await join(b, 'Black', errors);
        await game(white, "chessGame.chooseColor('white')");
        await game(black, "chessGame.chooseColor('black')");
        await sleep(2500);
        const sam = await spectatorMidGame(b, white, black, errors);
        const black2 = await blackReloads(b, white, black, sam, errors);
        await hostLeaves(b, white, black2, sam, errors);
    } catch (err) {
        r.check(false, 'the suite ran to the end: ' + (err && err.message));
    }
    r.check(errors.length === 0, 'no page errors ' + errors.slice(0, 2).join(' | '));
    console.log('room: ' + ROOM + '.chess');
    await b.close();
    process.exitCode = r.report() ? 1 : 0;
})();
