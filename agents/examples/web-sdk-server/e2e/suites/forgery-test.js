/**
 * What happens when a peer lies about who it is.
 *
 * Every app here receives messages from other people's browsers, which the
 * people holding them can edit. Most apps read the sender out of the PAYLOAD
 * (data.by, data.username) rather than from the transport, so claiming to be
 * somebody else was just a matter of typing a different name.
 *
 * Each case below sends a deliberately forged message from a second, ordinary
 * participant and asserts the first one ignores it. The forgeries are sent with
 * the app's own send path, so nothing here depends on a private API.
 */
const { BASE, SHOTS } = require('../lib/harness');
const { chromium } = require('playwright');
const pass = [], fail = [];
const check = (ok, w) => (ok ? pass : fail).push(w);

async function join(b, path, name, room, ready) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    const p = await ctx.newPage();
    p.on('pageerror', e => check(false, `${name} threw: ${e.message.split('\n')[0].slice(0, 70)}`));
    await p.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#usernameInput', { timeout: 45000 });
    await p.fill('#usernameInput', name);
    await p.fill('#channelInput', room);
    await p.fill('#passwordInput', 'pw12345');
    await p.click('#connectBtn');
    // Wait for the app to actually be connected rather than guessing at a
    // sleep — sendCustomEventMessage throws "Not connected" until it is.
    await p.waitForFunction(() => {
        const app = window.pulseApp || window.chessGame || window.sponsorPulseHost;
        return !!(app && app.connected);
    }, { timeout: 45000 }).catch(() => {});
    await p.waitForTimeout(ready || 4000);
    return p;
}

(async () => {
    const b = await chromium.launch({ headless: false,
        args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });

    // ---- pulse: one person voting as many ---------------------------------
    {
        const room = 'fg-pulse' + Math.floor(Date.now() / 1000);
        const host = await join(b, '/apps/pulse/index.html', 'Host', room);
        const guest = await join(b, '/apps/pulse/index.html', 'Guest', room);
        await host.waitForTimeout(2500);

        // The host opens a poll so there is something to stuff.
        await host.evaluate(() => {
            const app = window.pulseApp;
            if (app && typeof app.hostStartPoll === 'function') app.hostStartPoll('Tea or coffee?', ['Tea', 'Coffee']);
        }).catch(() => {});
        await host.waitForTimeout(2500);

        const before = await host.evaluate(() =>
            window.pulseApp && window.pulseApp.poll ? Object.keys(window.pulseApp.poll.votes || {}).length : -1);

        // Guest votes five times, each time claiming to be somebody else.
        await guest.evaluate(() => {
            const app = window.pulseApp;
            const opt = app && app.poll && app.poll.options && app.poll.options[0];
            if (!app || !opt) return;
            ['Ghost1', 'Ghost2', 'Ghost3', 'Ghost4', 'Ghost5'].forEach((who) => {
                app.sendCustomEventMessage({ type: 'vote', by: who, option: opt.id }, '*');
            });
        });
        await host.waitForTimeout(4000);

        const after = await host.evaluate(() =>
            window.pulseApp && window.pulseApp.poll ? Object.keys(window.pulseApp.poll.votes || {}).length : -1);

        if (before < 0 || after < 0) {
            check(false, 'pulse: could not read the poll (app shape changed?)');
        } else {
            check(after - before <= 1,
                `pulse: five votes under invented names count as at most one real voter (${before} -> ${after})`);
            const ghosts = await host.evaluate(() =>
                Object.keys((window.pulseApp.poll || {}).votes || {}).filter(n => n.startsWith('Ghost')).length);
            check(ghosts === 0, `pulse: no invented voter reaches the tally (${ghosts} present)`);
        }
        await host.context().close(); await guest.context().close();
    }

    // ---- chess -------------------------------------------------------------
    //
    // NOT tested here, deliberately. chess-game.js had a real defect — an
    // illegal remote move ran this.chess.load(data.fen), so any peer could set
    // the board to a position of its choosing — and that IS fixed. But I could
    // not build a check that goes red when the fix is reverted: even with both
    // players seated via chooseColor(), a forged 'move' never reaches
    // handleRemoteMove, so the assertion passed against the reintroduced bug.
    //
    // A test that cannot fail is worse than no test, so it is not here. What is
    // needed is a forgery sent the way a real client sends a move, once the
    // routing that swallows it is understood.

    await b.close();
    console.log('\nPASS (' + pass.length + ')'); pass.forEach(x => console.log('  ✓ ' + x));
    console.log('\nFAIL (' + fail.length + ')'); fail.forEach(x => console.log('  ✗ ' + x));
    process.exit(fail.length ? 1 : 0);
})();
