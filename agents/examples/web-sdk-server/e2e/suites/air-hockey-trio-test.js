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

/**
 * A paddle update is the one thing a guest sends, and its numbers were taken
 * as sent: Odell could park his paddle in the other team's goal mouth, at any
 * speed, and the host's physics bounced the puck off it there.
 */
async function paddleRules(mara, priya, odell, left) {
    const goalMouth = { x: left ? 960 : 40, y: 300 };
    await odell.page.evaluate((s) => window.airHockeyGame.sendData({ type: 'paddle-update', x: s.x, y: s.y, vx: 9999, vy: -9999 }), goalMouth);
    await sleep(2500);
    const rule = (p) => p.evaluate((isLeft) => {
        const g = window.airHockeyGame, pd = g.players.get('Odell').paddle, half = 1000 / 2;
        return { x: Math.round(pd.x), speed: Math.round(Math.hypot(pd.vx, pd.vy)), max: 50,
            ownHalf: isLeft ? pd.x <= half : pd.x >= half };
    }, left);
    for (const [who, p] of [['Mara (the host)', mara.page], ['Priya', priya.page]]) {
        const s = await rule(p);
        r.check(s.ownHalf, `on ${who}'s screen Odell's paddle stays in his own half (x ${s.x})`);
        r.check(s.speed <= s.max, `and moves no faster than any paddle can (${s.speed}, max ${s.max})`);
    }
    await odell.page.evaluate(() => window.airHockeyGame.sendData({ type: 'paddle-update', x: 'nope', y: null }));
    await sleep(2000);
    const finite = await mara.page.evaluate(() => { const pd = window.airHockeyGame.players.get('Odell').paddle; return [pd.x, pd.y, pd.vx, pd.vy].every(Number.isFinite); });
    r.check(finite, "a paddle update that is not numbers leaves Odell's paddle a real position on the host");
}

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

        // A spot inside Odell's own half (left team: x < 500 of 1000).
        const left = await odell.page.evaluate(() => window.airHockeyGame.players.get('Odell').team === 'left');
        const spot = { x: left ? 321 : 679, y: 223 };
        const maraBefore = await paddle(priya.page, 'Mara');
        await odell.page.evaluate((s) => window.airHockeyGame.sendData({ type: 'paddle-update', x: s.x, y: s.y, vx: 0, vy: 0 }), spot);
        const moved = await waitFor(async () => { const p = await paddle(priya.page, 'Odell'); return p && p.x === spot.x && p.y === spot.y; }, 6000, "Odell's paddle on Priya's screen");
        r.check(moved, "Odell's paddle moves Odell's paddle on Priya's screen");
        const maraAfter = await paddle(priya.page, 'Mara');
        r.check(!(maraAfter.x === spot.x && maraAfter.y === spot.y) && JSON.stringify(maraAfter) === JSON.stringify(maraBefore),
            `and not Mara's (${JSON.stringify(maraBefore)} -> ${JSON.stringify(maraAfter)})`);
        await paddleRules(mara, priya, odell, left);

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
