/**
 * A client that vanishes without saying goodbye — and is never forgotten.
 *
 * Departure is announced by a pagehide beacon from the leaving tab. A crash, a
 * killed process, a laptop lid or a dead battery sends nothing. There is no
 * server-side presence timeout behind it, so the room keeps the vanished agent
 * in its roster indefinitely.
 *
 * It matters most for the host. Every host-only action is gated on isHost(),
 * host election only re-runs when someone is seen to leave, and so a host that
 * crashes leaves a room where nobody can ever start anything again.
 *
 * This probe measures the behaviour rather than failing on it: the fix belongs
 * in messaging-service (a heartbeat and a short TTL on agent presence), not
 * here. It prints what it observes so that a later fix shows up as a change,
 * and it is deliberately excluded from the pass/fail tally.
 */
const { BASE } = require('../lib/harness');
const { chromium } = require('playwright');

const MINUTES = Number(process.env.GHOST_MINUTES || 3);

async function join(b, name, room) {
    const ctx = await b.newContext({ viewport: { width: 1100, height: 800 } });
    const p = await ctx.newPage(); p.ctx = ctx;
    await p.goto(BASE + '/apps/mini-games/reactor/index.html', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#usernameInput', { timeout: 25000 });
    await p.fill('#usernameInput', name);
    await p.fill('#channelInput', room);
    await p.fill('#passwordInput', 'pw12345');
    await p.click('#connectBtn');
    await p.waitForTimeout(12000);
    return p;
}

(async () => {
    const b = await chromium.launch({ headless: false,
        args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
    const room = 'gh' + Math.floor(Math.random() * 99999);
    const ghost = await join(b, 'Ghost', room);
    const alive = await join(b, 'Alive', room);
    await alive.bringToFront(); await alive.waitForTimeout(3000);

    const before = await alive.evaluate(() => window.reactorGame.getConnectedUsers());
    console.log('two in the room: ' + JSON.stringify(before));

    // The network goes before the tab does, so no beacon can leave.
    await ghost.ctx.setOffline(true);
    const t0 = Date.now();
    let dropped = null;
    for (let i = 0; i < MINUTES * 6; i++) {
        await alive.waitForTimeout(10000);
        const roster = await alive.evaluate(() => window.reactorGame.getConnectedUsers());
        if (!roster.includes('Ghost')) { dropped = ((Date.now() - t0) / 60000).toFixed(1); break; }
    }
    const promoted = await alive.evaluate(() => window.reactorGame.isHost());

    if (dropped !== null) {
        console.log('the room dropped the vanished client after ' + dropped
            + ' min, survivor isHost = ' + promoted);
        console.log(promoted
            ? 'host election re-ran, so the room is usable again'
            : 'WARNING: dropped but nobody was promoted — the room still has no host');
    } else {
        console.log('KNOWN GAP: still in the roster after ' + MINUTES + ' min, survivor isHost = '
            + promoted + '.\nA client that dies without sending its beacon is never dropped, so a '
            + 'crashed host leaves a room nobody can host. Needs a heartbeat and a short presence '
            + 'TTL in messaging-service.');
    }
    await b.close();
})();
