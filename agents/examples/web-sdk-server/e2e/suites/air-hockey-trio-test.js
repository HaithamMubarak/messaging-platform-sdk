/**
 * Air Hockey, three players: each paddle is its owner's, and only the host
 * moves the puck.
 *
 * Mara (the host), Odell and Priya. In p2p-host mode a guest's broadcast
 * reaches the other guests through the host, on the host's connection,
 * stamped with the guest's name. Attributing by connection meant:
 *  - Odell's paddle moved MARA's paddle on Priya's screen (two-player games
 *    never showed it: there is no third screen to relay to);
 *  - Priya could broadcast a 'puck-update' (or a goal) that Odell took as the
 *    host's.
 *
 * Channels are 'aht<time>'; clean up with
 *   scripts/cleanup_channels.py --prefix '^aht[0-9]+' --yes
 */
const { LAUNCH, results } = require('../lib/harness');
const { chromium } = require('playwright');
const { joinOne, sleep, waitFor } = require('../lib/party-room');

const GAME = 'airHockeyGame';
const r = results();
const PATH = '/apps/mini-games/air-hockey/index.html';

const paddle = (p, who) => p.evaluate((n) => { const pl = window.airHockeyGame.players.get(n); return pl ? { x: Math.round(pl.paddle.x), y: Math.round(pl.paddle.y) } : null; }, who);

(async () => {
    const b = await chromium.launch(LAUNCH);
    const room = 'aht' + Math.floor(Date.now() / 1000);
    const errors = [];
    try {
        const mara = await joinOne(b, PATH, GAME, room, 'Mara', 'pw12345');
        await sleep(2500);
        const odell = await joinOne(b, PATH, GAME, room, 'Odell', 'pw12345');
        await sleep(2500);
        const priya = await joinOne(b, PATH, GAME, room, 'Priya', 'pw12345');
        for (const x of [mara, odell, priya]) x.page.on('pageerror', (e) => errors.push(x.name + ': ' + e.message.split('\n')[0]));
        await sleep(6000);
        r.check(await mara.page.evaluate(() => window.airHockeyGame.isHost()), 'Mara, first in, hosts');
        const seen = await waitFor(() => priya.page.evaluate(() => ['Mara', 'Odell', 'Priya'].every((n) => window.airHockeyGame.players.has(n))), 15000, 'all three players on Priya\'s screen');
        r.check(seen, 'Priya sees all three players');

        const maraBefore = await paddle(priya.page, 'Mara');
        await odell.page.evaluate(() => window.airHockeyGame.sendData({ type: 'paddle-update', x: 321, y: 123, vx: 0, vy: 0 }));
        const moved = await waitFor(async () => { const p = await paddle(priya.page, 'Odell'); return p && p.x === 321 && p.y === 123; }, 6000, "Odell's paddle on Priya's screen");
        r.check(moved, "Odell's paddle moves Odell's paddle on Priya's screen");
        const maraAfter = await paddle(priya.page, 'Mara');
        r.check(!(maraAfter.x === 321 && maraAfter.y === 123) && JSON.stringify(maraAfter) === JSON.stringify(maraBefore),
            `and not Mara's (${JSON.stringify(maraBefore)} -> ${JSON.stringify(maraAfter)})`);

        const puckBefore = await odell.page.evaluate(() => ({ x: Math.round(window.airHockeyGame.puck.x), y: Math.round(window.airHockeyGame.puck.y) }));
        await priya.page.evaluate(() => window.airHockeyGame.sendData({ type: 'puck-update', x: 7, y: 7, vx: 0, vy: 0 }));
        await sleep(3000);
        const puckAfter = await odell.page.evaluate(() => ({ x: Math.round(window.airHockeyGame.puck.x), y: Math.round(window.airHockeyGame.puck.y) }));
        r.check(!(puckAfter.x === 7 && puckAfter.y === 7), `Priya cannot move the puck on Odell's screen (${JSON.stringify(puckBefore)} -> ${JSON.stringify(puckAfter)})`);
    } catch (err) {
        r.check(false, 'the suite ran to the end: ' + (err && err.message));
    }
    r.check(errors.length === 0, 'no page errors ' + errors.slice(0, 2).join(' | '));
    console.log('room: ' + room);
    await b.close();
    process.exitCode = r.report() ? 1 : 0;
})();
