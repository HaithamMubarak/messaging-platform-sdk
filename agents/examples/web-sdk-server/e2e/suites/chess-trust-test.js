/**
 * Chess believes the transport about who sent a message, not the message.
 *
 * Three browsers: White (the host), Black, and a spectator who forges. Every
 * forgery is sent the way a real client sends anything (sendData), and each is
 * bracketed by a REAL move that must arrive, so a forgery "refused" because
 * nothing was delivered at all cannot pass (forgery-test.js's old note on chess
 * is exactly that trap).
 *
 * Channels are 'ct<time>.chess'; clean up with
 *   scripts/cleanup_channels.py --prefix '^ct[0-9]+\.chess$' --yes
 */
const { BASE, LAUNCH, results } = require('../lib/harness');
const { chromium } = require('playwright');
const { useChannelForm } = require('../lib/party-room');

const r = results();
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const game = (p, expr) => p.evaluate(new Function('return (' + expr + ');'));

async function waitFor(p, expr, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await game(p, expr)) return true; await sleep(250); }
    return false;
}

async function join(b, room, name, errors) {
    const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    p.on('pageerror', (e) => errors.push(name + ': ' + e.message));
    await p.goto(BASE + '/apps/chess/index.html', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#connectionModal.active', { timeout: 45000 });
    await useChannelForm(p);
    await p.evaluate(() => document.getElementById('tabCustom')?.click());
    await p.fill('#usernameInput', name);
    await p.fill('#channelInput', room);
    await p.fill('#passwordInput', 'pw12345');
    await p.click('#connectBtn');
    await waitFor(p, 'window.chessGame && window.chessGame.connected', 45000);
    await sleep(3000);
    return p;
}

const forge = (p, data) => p.evaluate((d) => window.chessGame.sendData(d), data);
const plies = (p) => game(p, 'window.chessGame.chess.history().length');

async function forgeries(white, black, spy) {
    // The resignation alone first: the forged reset below would clear its dialog.
    await forge(spy, { type: 'resign', username: 'White', color: 'white' });
    await sleep(3000);
    for (const [p, who] of [[white, 'White'], [black, 'Black']]) {
        r.check(!(await game(p, "!!document.querySelector('.game-over-dialog')")), `${who}: a spectator cannot resign for White`);
    }
    await forge(spy, { type: 'move', from: 'e7', to: 'e5' });                  // Black's move, by a spectator
    await forge(spy, { type: 'new-game' });                                    // a reset, by a spectator
    await forge(spy, { type: 'game-sync', fen: '8/8/8/8/8/8/8/K6k w - - 0 1', pgn: '',
        whitePlayer: 'Spy', blackPlayer: 'Black', spectators: [] });           // the host's sync, by a spectator
    await forge(spy, { type: 'choose-color', username: 'Black', color: 'spectator' }); // seat someone else
    await sleep(3500);
    for (const [p, who] of [[white, 'White'], [black, 'Black']]) {
        const s = await game(p, "({ n: window.chessGame.chess.history().length, w: window.chessGame.whitePlayer, specs: window.chessGame.spectators.join(',') })");
        r.check(s.n === 1, `${who}: a spectator cannot move for Black, reset or replace the game (${s.n} plies)`);
        r.check(s.w === 'White', `${who}: nor take White's seat by a forged sync (${s.w})`);
        r.check(!/Black/.test(s.specs), `${who}: nor move Black to the spectators (${s.specs})`);
    }
}

(async () => {
    const b = await chromium.launch(LAUNCH);
    const errors = [];
    const room = 'ct' + Math.floor(Date.now() / 1000);
    try {
        const white = await join(b, room, 'White', errors);
        const black = await join(b, room, 'Black', errors);
        const spy = await join(b, room, 'Spy', errors);
        await game(white, "window.chessGame.chooseColor('white')");
        await game(black, "window.chessGame.chooseColor('black')");
        await game(spy, 'window.chessGame.chooseSpectator()');
        await sleep(2500);

        // Control: a real move travels to everyone.
        await game(white, "window.chessGame.makeMove('e2', 'e4')");
        r.check(await waitFor(black, 'window.chessGame.chess.history().length === 1', 8000), 'control: White\'s real move reaches Black');
        r.check(await waitFor(spy, 'window.chessGame.chess.history().length === 1', 8000), 'control: and the spectator');

        await forgeries(white, black, spy);

        // Control: and Black's real move still lands afterwards.
        await game(black, "window.chessGame.makeMove('c7', 'c5')");
        r.check(await waitFor(white, 'window.chessGame.chess.history().length === 2', 8000), 'control: Black\'s real move reaches White afterwards');
        r.check(await waitFor(spy, 'window.chessGame.chess.history().length === 2', 8000), 'control: and the spectator');
        console.log('plies: ' + [await plies(white), await plies(black), await plies(spy)].join(' '));
    } catch (err) {
        r.check(false, 'the suite ran to the end: ' + (err && err.message));
    }
    r.check(errors.length === 0, 'no page errors ' + errors.slice(0, 2).join(' | '));
    console.log('room: ' + room + '.chess');
    await b.close();
    process.exitCode = r.report() ? 1 : 0;
})();
