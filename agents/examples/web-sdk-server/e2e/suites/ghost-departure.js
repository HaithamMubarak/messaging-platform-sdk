/**
 * A client that vanishes without saying goodbye.
 *
 * Departure is normally announced by a pagehide beacon from the leaving tab. A
 * crash, a killed process, a laptop lid or a dead battery sends nothing, and
 * this used to mean the room kept the vanished agent in its roster forever —
 * measured at over five minutes with no drop. It mattered most for the host:
 * every host-only action is gated on isHost() and host election only re-runs
 * when somebody is seen to leave, so a crashed host left a room nobody could
 * ever host again.
 *
 * PresenceSweepService closed that. The session TTL expires the vanished agent
 * and a sweep announces the DISCONNECT, so the room drops it and re-elects.
 * Measured at 2.8-3.0 min over three runs, against a 180s TTL and a 30s sweep.
 *
 * So this is now a regression test rather than a probe, and it asserts: the
 * ghost has to leave the roster, and somebody has to be host afterwards.
 * Dropping without promoting would be its own bug — a room with no host is the
 * failure this was written about. Still opt-in, because waiting out a TTL takes
 * minutes: run it with `npm test -- ghost`.
 */
const { LAUNCH } = require('../lib/harness');
const { joinOne } = require('../lib/party-room');
const { chromium } = require('playwright');

const MINUTES = Number(process.env.GHOST_MINUTES || 3);

/** The shared join (lib/party-room.js); the page carries its context for setOffline. */
async function join(b, name, room) {
    const c = await joinOne(b, '/apps/mini-games/gavel/index.html', 'gavelGame', room, name, 'pw12345');
    c.page.ctx = c.ctx;
    return c.page;
}

(async () => {
    const b = await chromium.launch(LAUNCH);
    const room = 'gh' + Math.floor(Math.random() * 99999);
    const ghost = await join(b, 'Ghost', room);
    const alive = await join(b, 'Alive', room);
    await alive.bringToFront(); await alive.waitForTimeout(3000);

    const pass = [], fail = [];
    const check = (ok, w) => (ok ? pass : fail).push(w);

    // Without this a ghost that never arrived "leaves" at once, and the suite
    // passed on an empty room (2026-10-04, after the move off Reactor).
    const roster = () => alive.evaluate(() => window.gavelGame.getConnectedUsers());
    let before = [];
    for (let i = 0; i < 15 && !before.includes('Ghost'); i++) { await alive.waitForTimeout(2000); before = await roster(); }
    console.log('two in the room: ' + JSON.stringify(before));
    check(before.includes('Ghost') && before.includes('Alive'), `both are in the room first (${JSON.stringify(before)})`);

    // The network goes before the tab does, so no beacon can leave.
    await ghost.ctx.setOffline(true);
    const t0 = Date.now();
    let dropped = null;
    for (let i = 0; i < MINUTES * 6; i++) {
        await alive.waitForTimeout(10000);
        if (!(await roster()).includes('Ghost')) { dropped = ((Date.now() - t0) / 60000).toFixed(1); break; }
    }
    const promoted = await alive.evaluate(() => window.gavelGame.isHost());

    check(dropped !== null, dropped !== null
        ? `the room drops a client that vanished without a beacon (after ${dropped} min)`
        : `the room drops a client that vanished without a beacon (still listed after ${MINUTES} min)`);
    // Dropping without promoting would leave a room nobody can host, which is
    // the whole failure this suite exists for.
    check(promoted, promoted
        ? 'host election re-ran, so the room is usable again'
        : 'host election re-ran (dropped, but nobody was promoted — the room has no host)');

    await b.close();
    console.log('\nPASS (' + pass.length + ')'); pass.forEach(x => console.log('  ✓ ' + x));
    console.log('\nFAIL (' + fail.length + ')'); fail.forEach(x => console.log('  ✗ ' + x));
    process.exitCode = fail.length ? 1 : 0;
})();
