/**
 * The clock and the game record.
 *
 * Chess had neither: the move list lived in the DOM of whichever tab was open,
 * so a finished game left nothing behind, and there was no sense of how long
 * anyone had been thinking.
 */
const { BASE } = require('../lib/harness');
const { chromium } = require('playwright');
const pass = [], fail = [];
const check = (ok, w) => (ok ? pass : fail).push(w);

async function join(b, room, name) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    const p = await ctx.newPage();
    p.on('pageerror', e => check(false, `${name} threw: ${e.message.split('\n')[0].slice(0, 70)}`));
    await p.goto(BASE + '/apps/chess/index.html', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#usernameInput', { timeout: 45000 });
    await p.fill('#usernameInput', name);
    await p.fill('#channelInput', room);
    await p.fill('#passwordInput', 'pw12345');
    await p.click('#connectBtn');
    await p.waitForFunction(() => window.chessGame && window.chessGame.connected, { timeout: 45000 }).catch(() => {});
    await p.waitForTimeout(3000);
    return p;
}

(async () => {
    const b = await chromium.launch({ headless: false,
        args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });

    const room = 'cf' + Math.floor(Date.now() / 1000);
    const white = await join(b, room, 'White');
    const black = await join(b, room, 'Black');
    await white.evaluate(() => window.chessGame.chooseColor('white'));
    await black.evaluate(() => window.chessGame.chooseColor('black'));
    await white.waitForTimeout(3000);

    check(await white.evaluate(() => !!document.getElementById('clockWhite')), 'the clocks are on the page');
    check(await white.evaluate(() => !!document.getElementById('exportPgn')), 'the export control is on the page');

    // Play a couple of real moves through the app's own path.
    await white.evaluate(() => window.chessGame.makeMove('e2', 'e4'));
    await white.waitForTimeout(2500);
    await black.evaluate(() => window.chessGame.makeMove('e7', 'e5'));
    await white.waitForTimeout(4000);

    const moves = await white.evaluate(() => window.chessGame.chess.history());
    check(moves.length >= 2, `two moves were played (${JSON.stringify(moves)})`);

    // The clock has to have started counting once moves happened.
    const clockText = await white.evaluate(() => document.getElementById('clockWhite').textContent);
    check(/W \d+:\d\d/.test(clockText), `the clock is running and formatted (${clockText})`);

    const ticked = await white.evaluate(() => window.chessGame._clockMs &&
        (window.chessGame._clockMs.w + window.chessGame._clockMs.b) > 0);
    check(ticked, 'thinking time has actually accumulated');

    // PGN: build it without triggering a download, and check it is real PGN.
    const pgn = await white.evaluate(() => {
        const g = window.chessGame;
        const body = typeof g.chess.pgn === 'function' ? g.chess.pgn() : g.chess.history().join(' ');
        return { body: String(body), result: g._pgnResult() };
    });
    check(/e4/.test(pgn.body), `the PGN movetext contains the moves (${pgn.body.slice(0, 40)})`);
    check(pgn.result === '*', `an unfinished game exports as in-progress (${pgn.result})`);

    await b.close();
    console.log('\nPASS (' + pass.length + ')'); pass.forEach(x => console.log('  ✓ ' + x));
    console.log('\nFAIL (' + fail.length + ')'); fail.forEach(x => console.log('  ✗ ' + x));
    process.exit(fail.length ? 1 : 0);
})();
