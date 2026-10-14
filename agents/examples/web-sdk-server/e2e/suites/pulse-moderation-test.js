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
    await p.waitForSelector('#usernameInput', { state: 'attached', timeout: 45000 });
    await p.evaluate(() => document.getElementById('tabCustom')?.click());
    await p.fill('#usernameInput', name);
    await p.fill('#channelInput', room);
    await p.fill('#passwordInput', 'pw12345');
    await p.click('#connectBtn');
    await p.waitForFunction(() => window.pulseApp && window.pulseApp.connected, { timeout: 45000 })
        .catch(() => {});
    await p.waitForTimeout(3000);
    return p;
}

/** Count reaction bubbles as they are added, before anything is sent. */
const watchReactions = (p) => p.evaluate(() => {
    window.__reactions = 0;
    new MutationObserver((ms) => ms.forEach((m) => { window.__reactions += m.addedNodes.length; }))
        .observe(document.getElementById('reactionLayer'), { childList: true });
});

/** Reactions, the host's simulated voters, the replay and the big screen. */
async function glowUp(host, guest) {
    await watchReactions(host);
    await watchReactions(guest);
    await guest.click('[data-react="zap"]');
    await host.waitForTimeout(3000);
    const one = [await host.evaluate(() => window.__reactions), await guest.evaluate(() => window.__reactions)];
    check(one[0] === 1 && one[1] === 1, `a guest's reaction floats on the host and comes back to the guest (${one})`);

    // Ten taps at once: the host relays at most one per 700 ms.
    await guest.evaluate(() => { for (let i = 0; i < 10; i++) window.pulseApp.react('hand'); });
    await host.waitForTimeout(3000);
    const burst = await host.evaluate(() => window.__reactions) - one[0];
    check(burst >= 1 && burst <= 2, `a burst of ten is rate-limited at the host (${burst} relayed)`);

    // A guest forging a relay is ignored: 'reaction' counts only from the host.
    await guest.evaluate(() => window.pulseApp.sendCustomEventMessage({ type: 'reaction', kind: 'zap', by: 'Host' }, '*'));
    await host.waitForTimeout(2000);
    check(await host.evaluate(() => window.__reactions) - one[0] === burst, 'a guest cannot fake a relayed reaction');

    const v0 = await host.evaluate(() => window.pulseApp.versions.length);
    await host.click('[data-simulate]');
    await host.waitForTimeout(6500);
    const sim = await host.evaluate(() => ({
        votes: Object.keys(window.pulseApp.poll.votes).filter((n) => n.startsWith('Simulated ')).length,
        versions: window.pulseApp.versions.length,
        label: document.querySelector('#poll .poll__head').innerText }));
    check(sim.votes === 5 && sim.versions >= v0 + 5 && /5 simulated/.test(sim.label),
        `"Add 5 simulated votes" votes five times through the tally, a version each, labelled (${JSON.stringify(sim)})`);
    check(!(await guest.$('[data-simulate]')), 'a guest is not offered simulated votes');

    const seen = await host.evaluate(async () => {
        const viewed = new Set();
        window.pulseApp.replay();
        for (let i = 0; i < 40 && window.pulseApp._replaying; i++) {
            viewed.add(window.pulseApp.viewing);
            await new Promise((r) => setTimeout(r, 150));
        }
        return { distinct: viewed.size, endsLive: window.pulseApp.viewing === null };
    });
    check(seen.distinct >= 4 && seen.endsLive, `Replay walks the versions and comes back to live (${JSON.stringify(seen)})`);

    await host.click('#presentBtn');
    const big = await host.evaluate(() => ({ on: document.body.classList.contains('is-presenting'),
        code: document.getElementById('presentCode').textContent,
        qr: !!document.querySelector('#presentQr canvas, #presentQr img'),
        sideHidden: getComputedStyle(document.querySelector('.sdk-side')).display === 'none' }));
    check(big.on && big.sideHidden && (big.qr || /Invite/.test(big.code)),
        `Big screen shows the poll alone with a way in (${JSON.stringify(big)})`);
    await host.keyboard.press('Escape');
    check(!(await host.evaluate(() => document.body.classList.contains('is-presenting'))), 'and Esc leaves it');
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

    await glowUp(host, guest);

    await b.close();
    console.log('\nPASS (' + pass.length + ')'); pass.forEach(x => console.log('  ✓ ' + x));
    console.log('\nFAIL (' + fail.length + ')'); fail.forEach(x => console.log('  ✗ ' + x));
    console.log('room: ' + room);
    process.exitCode = fail.length ? 1 : 0;   // exit() would drop buffered stdout
})();
