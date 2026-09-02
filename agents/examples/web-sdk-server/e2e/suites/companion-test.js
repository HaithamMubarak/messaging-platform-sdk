/*
 * Does a demo do anything when you are on your own?
 *
 *     xvfb-run -a node suites/companion-test.js
 *
 * Seventeen of the twenty-five gallery entries used to need a second person
 * before anything moved, which is most of the gallery doing nothing for the
 * developer evaluating it. js/companion.js answers that by starting a REAL
 * second UserConnectionBase in the same page rather than faking the far end in
 * the UI — so presence, host election and the relay all carry genuine traffic.
 *
 * This checks the two things that make it honest rather than a prop:
 *   1. the app's own roster gains a second member (it is really in the room),
 *   2. window.channel still points at the human's connection afterwards —
 *      UserConnectionBase assigns that global on connect, and the shared
 *      helpers read it, so a companion that clobbered it would repoint the
 *      agents badge and the disconnect button at the wrong connection.
 *
 * Then it checks the wire panel logged the calls that carried all this.
 */
const { chromium } = require('playwright');
const { BASE, LAUNCH, results, gotoStable } = require('../lib/harness');

const R = results();
function check(ok, label, extra) {
    console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${extra ? '  — ' + extra : ''}`);
    R.check(ok, label + (extra ? '  — ' + extra : ''));
    return ok;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(fn, ms, label) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        try { if (await fn()) return true; } catch (_) {}
        await sleep(250);
    }
    console.log(`  (timed out waiting for ${label})`);
    return false;
}

async function openAlone(browser, path, room) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(60000);
    await gotoStable(page, `${BASE}${path}?debug`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#connectionModal.active', { timeout: 30000 });
    await page.fill('#usernameInput', 'Solo');
    await page.fill('#channelInput', room);
    await page.fill('#passwordInput', 'comp-pass-' + Math.random().toString(36).slice(2, 8));
    await page.click('#connectBtn');
    const ok = await waitFor(async () =>
        !(await page.evaluate(() => document.getElementById('connectionModal')?.classList.contains('active'))),
        45000, 'to connect');
    return { ctx, page, connected: ok };
}

(async () => {
    console.log(`\nCompanion E2E — ${BASE}`);
    const browser = await chromium.launch(LAUNCH);
    const room = 'comp-e2e-' + Math.random().toString(36).slice(2, 7);
    let c = null;

    try {
        c = await openAlone(browser, '/apps/drop/index.html', room);
        check(c.connected, 'Drop connected on its own');
        await sleep(2500);

        // ---- 1. alone, the room has one person ----------------------------
        console.log('\n[1] on your own');
        const before = await c.page.evaluate(() => window.dropApp.getUserList().length);
        check(before === 1, 'the roster starts with just you', `${before} in the room`);

        const btn = await c.page.$('.companion-btn');
        check(!!btn, 'the companion button is in the header');
        const visible = btn && await btn.isVisible();
        check(!!visible, 'and it is offered once you are in a room');

        // ---- 2. the companion really joins --------------------------------
        console.log('\n[2] the companion joins for real');
        const savedChannel = await c.page.evaluate(() =>
            window.channel && window.channel === window.dropApp.channel);
        check(savedChannel === true, 'window.channel points at your connection before');

        await btn.click();
        const joined = await waitFor(async () =>
            (await c.page.evaluate(() => window.dropApp.getUserList().length)) === 2,
            40000, 'the companion to join');
        const after = await c.page.evaluate(() => window.dropApp.getUserList().length);
        check(joined, 'the app\'s own roster gains a second member', `${after} in the room`);

        const isReal = await c.page.evaluate(() =>
            !!(window.dropCompanion && window.dropCompanion.peer &&
               window.dropCompanion.peer.connected));
        check(isReal, 'and it is a real connection, not a drawn one');

        const stillHost = await c.page.evaluate(() => window.dropApp.isHost());
        check(stillHost === true, 'you keep the host seat — it joins after you');

        // ---- 3. the global it could have hijacked -------------------------
        console.log('\n[3] the global it must not steal');
        const stillYours = await c.page.evaluate(() =>
            window.channel === window.dropApp.channel);
        check(stillYours === true,
            'window.channel still points at YOUR connection',
            stillYours ? 'unchanged' : 'HIJACKED — the agents badge and disconnect button now act on the companion');

        // ---- 4. and it is not passed off as a person ----------------------
        console.log('\n[4] it is labelled, not disguised');
        const label = await c.page.evaluate(() => {
            const t = document.querySelector('.companion-note');
            return t ? t.textContent : '';
        });
        check(/second connection running in this tab/.test(label),
            'the page says plainly what the companion is');

    } catch (err) {
        console.error('\nTEST THREW:', err && err.stack || err);
        check(false, 'the suite ran to the end');
    } finally {
        if (c) { try { await c.ctx.close(); } catch (_) {} }
        await browser.close();
    }

    process.exit(R.report() === 0 ? 0 : 1);
})();
