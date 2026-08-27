/**
 * Session-health telemetry: does the beacon fire, and does it stay quiet when
 * told to?
 *
 * Two halves, and the second matters more than the first. Anything can be made
 * to send. The claim worth testing is the RESTRAINT: that a page which has been
 * opted out sends nothing at all, and that what a page does send carries no
 * channel name, no agent name and no content — because every demo on this site
 * tells people the server does not see their content, and telemetry is the one
 * place that claim is easiest to quietly break.
 *
 * Requests are intercepted at the browser rather than counted in the database,
 * so the assertion is on the bytes that actually left the page.
 */
const { BASE, gotoStable, results, waitForService } = require('../lib/harness');
const { chromium } = require('playwright');

// Report through the shared reporter, so run-all.js counts this suite like
// every other one. Printing a bare "15 passed, 1 failed" put it in run-all's
// prose branch, where the numbers are DISPLAYED but never added to the totals
// and a failure here could not turn the run red.
const R = results();
const check = (ok, w) => R.check(ok, w);

/** Every telemetry POST this page makes, decoded. */
function trap(page) {
    const seen = [];
    page.on('request', req => {
        if (req.method() !== 'POST' || !req.url().includes('/telemetry')) return;
        try { seen.push({ url: req.url(), body: JSON.parse(req.postData() || '{}') }); }
        catch (e) { seen.push({ url: req.url(), body: null, raw: req.postData() }); }
    });
    return seen;
}

const events = seen => seen.flatMap(s => (s.body && s.body.events) || []);

/**
 * Poll for something to become true.
 *
 * The positive checks here used fixed sleeps, which is fine on an idle box and
 * false under a full 52-suite run — one such timeout is what made this suite
 * report a phantom failure in the regression. Note the OPPOSITE applies to the
 * opt-out check below: proving nothing was sent means waiting a fixed period
 * and then looking, so that one stays a flat sleep on purpose.
 */
async function until(fn, ms, label) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        try { if (await fn()) return true; } catch (_) {}
        await new Promise(r => setTimeout(r, 500));
    }
    console.log(`  (timed out waiting for ${label})`);
    return false;
}

async function join(b, room, name, { optOut = false } = {}) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => check(false, `${name} threw: ${e.message.split('\n')[0].slice(0, 80)}`));
    if (optOut) {
        // Set before any script runs — the module decides once, at load.
        await ctx.addInitScript(() => {
            try { localStorage.setItem('sdk_telemetry', 'off'); } catch (e) {}
        });
    }
    const seen = trap(page);
    await gotoStable(page, BASE + '/apps/dead-drop/app.html');
    await page.waitForSelector('#usernameInput', { timeout: 45000 });
    await page.fill('#usernameInput', name);
    await page.fill('#channelInput', room);
    await page.fill('#passwordInput', 'pw12345');
    await page.click('#connectBtn');
    await page.waitForFunction(() => window.deadDropApp && window.deadDropApp.connected, { timeout: 45000 })
        .catch(() => {});
    return { ctx, page, seen };
}

(async () => {
    const b = await chromium.launch({ headless: false,
        args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });

    const stamp = Math.floor(Date.now() / 1000);

    try {
        await waitForService();
        // ---- 1. the module loads and is on by default -----------------------
        const a = await join(b, 'tel' + stamp, 'Watcher');
        check(await a.page.evaluate(() => !!window.SdkTelemetry), 'the beacon module loads on an app page');
        check(await a.page.evaluate(() => window.SdkTelemetry.enabled()),
            'it is on by default when nothing has opted out');

        // A connect queues session_started; the flush timer is 5s.
        await until(() => events(a.seen).some(e => e.event === 'session_started'), 45000,
            'the first beacon');
        let evs = events(a.seen);
        check(evs.some(e => e.event === 'session_started'), 'connecting reports session_started');

        // ---- 2. it posts where the app is already talking -------------------
        const url = a.seen.length ? a.seen[0].url : '';
        check(/\/messaging-platform\/api\/v1\/messaging-service\/telemetry$/.test(url),
            `it posts to the real service path — ${url.replace(/^https?:\/\/[^/]+/, '') || '(nothing sent)'}`);

        // ---- 3. what it sends carries nothing private -----------------------
        //
        // The room name and the display name are both known here, so this is a
        // literal search for them anywhere in the payload — not a check that
        // the fields we happen to remember are absent.
        const raw = JSON.stringify(a.seen);
        check(!raw.includes('tel' + stamp), 'the channel name never appears in a payload');
        check(!raw.toLowerCase().includes('watcher'), 'the agent name never appears in a payload');
        check(!raw.includes('pw12345'), 'the channel password never appears in a payload');
        const ALLOWED = ['event', 'app', 'device', 'session', 'detail'];
        const extras = [...new Set(evs.flatMap(e => Object.keys(e)))].filter(k => !ALLOWED.includes(k));
        check(extras.length === 0,
            `an event carries only the five declared fields${extras.length ? ' — EXTRA ' + extras.join(', ') : ''}`);
        const started = evs.find(e => e.event === 'session_started') || {};
        check(started.app === 'dead-drop' || started.app === 'deaddrop' || started.app === 'app',
            `app is the demo folder, not free text — got ${JSON.stringify(started.app)}`);
        check(['phone', 'tablet', 'desktop'].includes(started.device),
            `device is one of the three classes — got ${JSON.stringify(started.device)}`);

        // ---- 4. the closed vocabulary is enforced in the page ---------------
        const rejected = await a.page.evaluate(() => {
            const before = performance.getEntriesByType('resource').length;
            window.SdkTelemetry.record('exfiltrate_everything', 'secret');
            window.SdkTelemetry.flush(false);
            return performance.getEntriesByType('resource').length === before;
        });
        check(rejected, 'an event outside the closed vocabulary is dropped in the page, not sent');

        // ---- 5. opting out means silence, not a smaller payload -------------
        const off = await join(b, 'telq' + stamp, 'Quiet', { optOut: true });
        check(await off.page.evaluate(() => window.SdkTelemetry.enabled() === false),
            'localStorage.sdk_telemetry=off disables the beacon');
        await off.page.waitForTimeout(7000);
        check(off.seen.length === 0,
            `an opted-out page sends nothing at all — saw ${off.seen.length} request(s)`);
        check(await off.page.evaluate(() => window.deadDropApp && window.deadDropApp.connected),
            'and it still connects normally with the beacon off');

        // ---- 6. losing the host is reported by whoever is promoted ----------
        //
        // Two clients, host closes. Exactly one survivor is promoted, so exactly
        // one host_lost should be raised — that is what makes the number mean
        // "rooms that lost their host" rather than "people who noticed".
        const room = 'telh' + stamp;
        const host = await join(b, room, 'Host');
        await host.page.waitForTimeout(2000);
        const peer = await join(b, room, 'Peer');
        await peer.page.waitForTimeout(4000);
        peer.seen.length = 0;                      // ignore the peer's own session_started
        await host.ctx.close();                    // the host vanishes
        await until(() => events(peer.seen).some(e => e.event === 'host_lost'), 90000,
            'the promotion to be reported');
        // Then settle, so a SECOND host_lost would still be caught — the check
        // is "exactly once", which a wait that stops at the first one cannot see.
        await peer.page.waitForTimeout(8000);

        const peerEvents = events(peer.seen);
        const lost = peerEvents.filter(e => e.event === 'host_lost');
        check(lost.length === 1,
            `the promoted client reports host_lost exactly once — saw ${lost.length}`);
        check(lost.every(e => !JSON.stringify(e).includes(room)),
            'the host_lost event does not name the room');

        await peer.ctx.close();
        await a.ctx.close();
        await off.ctx.close();
    } catch (err) {
        check(false, 'the suite ran to the end — ' + String(err.message || err).split('\n')[0].slice(0, 90));
    }

    await b.close();
    process.exit(R.report() ? 1 : 0);
})();
