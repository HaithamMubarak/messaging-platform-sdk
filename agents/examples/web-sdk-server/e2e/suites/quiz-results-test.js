/**
 * A quiz result that outlives the room.
 *
 * The scoreboard lived only in the tabs that were open, so the result was gone
 * the moment everyone left — which for a quiz between friends is the one thing
 * anybody wants afterwards. Each finished game is now written to channel
 * storage as its own version.
 */
const { BASE } = require('../lib/harness');
const { chromium } = require('playwright');
const pass = [], fail = [];
const check = (ok, w) => (ok ? pass : fail).push(w);

async function join(b, room, name) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    const p = await ctx.newPage();
    p.on('pageerror', e => check(false, `${name} threw: ${e.message.split('\n')[0].slice(0, 70)}`));
    await p.goto(BASE + '/apps/mini-games/quiz-battle/index.html', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#usernameInput', { timeout: 45000 });
    await p.fill('#usernameInput', name);
    await p.fill('#channelInput', room);
    await p.fill('#passwordInput', 'pw12345');
    await p.click('#connectBtn');
    await p.waitForFunction(() => window.quizGame && window.quizGame.connected, { timeout: 45000 })
        .catch(() => {});
    await p.waitForTimeout(3500);
    return p;
}

(async () => {
    const b = await chromium.launch({ headless: false,
        args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });

    const room = 'qr' + Math.floor(Date.now() / 1000);
    const host = await join(b, room, 'Quizmaster');
    await host.waitForTimeout(2000);

    check(await host.evaluate(() => !!window.quizGame), 'quiz-battle is running');
    check(await host.evaluate(() => typeof window.quizGame.loadPastResults === 'function'),
        'past results can be read back');

    // End a game with a known scoreboard, through the app's own path.
    const ended = await host.evaluate(() => {
        const app = window.quizGame;
        if (!app.playerScores) app.playerScores = new Map();
        app.playerScores.set('Quizmaster', 300);
        app.playerScores.set('Rival', 150);
        if (typeof app.endGame === 'function') { app.endGame(); return 'endGame'; }
        return null;
    });
    check(!!ended, `the game can be ended (${ended})`);
    await host.waitForTimeout(5000);

    // Read them back the way a later visitor would.
    const past = await host.evaluate(() => new Promise((resolve) => {
        window.quizGame.loadPastResults(resolve);
    }));

    check(Array.isArray(past) && past.length >= 1,
        `the finished game was kept (${Array.isArray(past) ? past.length : 'none'})`);

    if (past && past.length) {
        const names = past[0].scores.map(r => r.name);
        check(names.includes('Quizmaster'),
            `and the scoreboard came back with it (${JSON.stringify(names)})`);
        const top = past[0].scores.slice().sort((a, b) => b.score - a.score)[0];
        check(top && top.score === 300, `with the scores intact (top ${top && top.score})`);
    } else {
        check(false, 'nothing to read back');
        check(false, 'nothing to read back');
    }

    await b.close();
    console.log('\nPASS (' + pass.length + ')'); pass.forEach(x => console.log('  ✓ ' + x));
    console.log('\nFAIL (' + fail.length + ')'); fail.forEach(x => console.log('  ✗ ' + x));
    process.exit(fail.length ? 1 : 0);
})();
