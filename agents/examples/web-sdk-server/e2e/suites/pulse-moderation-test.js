/**
 * Pulse moderation, from both sides of the room.
 *
 * A host with no way to take a question down had to end the session to deal
 * with a disruptive one. And a host who takes down the WRONG question needs a
 * way back, so removal hides rather than deletes: the room stops seeing it, the
 * host still does, and it can be put back.
 */
const { BASE } = require('../lib/harness');
const { chromium } = require('playwright');
const pass = [], fail = [];
const check = (ok, w) => (ok ? pass : fail).push(w);

async function join(b, room, name) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    const p = await ctx.newPage();
    p.on('pageerror', e => check(false, `${name} threw: ${e.message.split('\n')[0].slice(0, 70)}`));
    await p.goto(BASE + '/apps/pulse/index.html', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#usernameInput', { timeout: 45000 });
    await p.fill('#usernameInput', name);
    await p.fill('#channelInput', room);
    await p.fill('#passwordInput', 'pw12345');
    await p.click('#connectBtn');
    await p.waitForFunction(() => window.pulseApp && window.pulseApp.connected, { timeout: 45000 })
        .catch(() => {});
    await p.waitForTimeout(3000);
    return p;
}

(async () => {
    const b = await chromium.launch({ headless: false,
        args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });

    const room = 'pm' + Math.floor(Date.now() / 1000);
    const host = await join(b, room, 'Host');
    const guest = await join(b, room, 'Guest');
    await host.waitForTimeout(2500);

    // The guest asks something the host will want to take down.
    await guest.evaluate(() => window.pulseApp.ask('a question the host will remove'));
    await host.waitForTimeout(4000);

    const asked = await host.evaluate(() => window.pulseApp.questions.length);
    check(asked === 1, `the question reaches the host (${asked})`);

    const seenByRoom = await guest.evaluate(() =>
        (document.getElementById('questions').innerText || '').includes('will remove'));
    check(seenByRoom, 'and the room can see it');

    // Take it down.
    const id = await host.evaluate(() => window.pulseApp.questions[0].id);
    await host.evaluate((qid) => window.pulseApp.removeQuestion(qid), id);
    await host.waitForTimeout(4000);

    const goneForRoom = await guest.evaluate(() =>
        !(document.getElementById('questions').innerText || '').includes('will remove'));
    check(goneForRoom, 'removing it takes it off the room\'s board');

    const stillHeld = await host.evaluate(() => {
        const q = window.pulseApp.questions[0];
        return q ? { removed: !!q.removed, kept: !!q.text } : null;
    });
    check(stillHeld && stillHeld.removed && stillHeld.kept,
        'but the host still holds it, marked, rather than it being deleted');

    const hostSeesUndo = await host.evaluate(() =>
        (document.getElementById('questions').innerText || '').includes('Put back'));
    check(hostSeesUndo, 'and the host is offered a way back');

    // Put it back.
    await host.evaluate((qid) => window.pulseApp.removeQuestion(qid), id);
    await host.waitForTimeout(4000);

    const restored = await guest.evaluate(() =>
        (document.getElementById('questions').innerText || '').includes('will remove'));
    check(restored, 'putting it back returns it to the room');

    // Only the host may do any of this.
    const guestTried = await guest.evaluate((qid) => {
        window.pulseApp.removeQuestion(qid);
        return true;
    }, id);
    await host.waitForTimeout(3500);
    const survived = await host.evaluate(() => !window.pulseApp.questions[0].removed);
    check(guestTried && survived, 'a guest asking for a removal is ignored');

    await b.close();
    console.log('\nPASS (' + pass.length + ')'); pass.forEach(x => console.log('  ✓ ' + x));
    console.log('\nFAIL (' + fail.length + ')'); fail.forEach(x => console.log('  ✗ ' + x));
    process.exit(fail.length ? 1 : 0);
})();
