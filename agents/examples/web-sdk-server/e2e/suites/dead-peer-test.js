/**
 * A peer that vanishes is seen leaving in seconds; a slow one is not.
 *
 * Until the server measured its sockets, a host whose laptop lid closed (or
 * whose network died, or whose tab was killed) stayed in the room until its
 * session expired, about three minutes, and nobody re-elected. This suite
 * makes that happen for real: three people in one room, each in their own
 * browser whose every connection (page, API, WebSocket) goes through its own
 * faulty proxy (lib/faulty-link.js). Cutting a proxy silences that browser as
 * far as the platform can tell, with no socket closed anywhere.
 *
 *   Beta  joins first and holds the crown; its link is cut.
 *   Alpha must see Beta leave within ~15 s and take the crown.
 *   Gamma gets 3 s each way of latency for the whole wait, and must stay.
 *   Then Alpha pulls the plug (Under the Hood's button: no goodbye, socket
 *   closed), and Gamma must see Alpha leave and take the crown.
 *
 *   NODE_PATH=<apps>/node_modules node -r <ops>/scripts/use-edge.cjs suites/dead-peer-test.js
 *
 * Against production by default; SDK_BASE_URL points it at another deployment.
 *
 * Every join makes a channel under the public demo key; the room names are
 * printed at the end for cleanup_channels.py (guidelines 6.21).
 */
const { chromium } = require('playwright');
const { faultyProxy } = require('../lib/faulty-link');

const BASE = (process.env.SDK_BASE_URL || 'https://hmdevonline.com/messaging-platform/sdk').replace(/\/$/, '');
const PAGE = BASE + '/apps/under-the-hood/app.html';
const SEEN_LEAVING_MS = 16000;     // the goal is ~10-15 s
const WAIT_MS = 60000;             // long enough to measure, short of the 180 s session expiry

const pass = [], fail = [];
const check = (ok, w) => { (ok ? pass : fail).push(w); console.log((ok ? '  ✓ ' : '  ✗ ') + w); };

/** One person: a browser of their own, every byte of it through their own proxy. */
async function open(room, name) {
    const link = await faultyProxy();
    const browser = await chromium.launch({ headless: false, proxy: { server: link.server } });
    const p = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    const sockets = [];
    p.on('websocket', ws => sockets.push(ws.url()));
    p.on('pageerror', e => console.log(`  (${name} threw: ${e.message.split('\n')[0].slice(0, 100)})`));
    await p.goto(PAGE, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#usernameInput', { state: 'attached', timeout: 45000 });
    await p.evaluate(() => document.getElementById('tabCustom')?.click());
    await p.fill('#usernameInput', name);
    await p.fill('#channelInput', room);
    await p.fill('#passwordInput', 'pw12345');
    await p.click('#connectBtn');
    const joined = await p.waitForFunction(() => window.underTheHood && window.underTheHood.connected,
        null, { timeout: 45000 }).then(() => true, () => false);
    if (!joined) throw new Error(name + ' could not join ' + room);   // a join must fail loudly (6.21)
    await p.waitForTimeout(2500);
    return { page: p, link, browser, name, sockets };
}

const users = (tab) => tab.page.evaluate(() => window.underTheHood.getConnectedUsers());
const hostOf = (tab) => tab.page.evaluate(() => window.underTheHood._getHostName());

/** Milliseconds until `watcher` no longer lists `name`, or -1 within WAIT_MS. */
async function timeUntilGone(watcher, name, since) {
    while (Date.now() - since < WAIT_MS) {
        if (!(await users(watcher)).includes(name)) return Date.now() - since;
        await watcher.page.waitForTimeout(250);
    }
    return -1;
}

async function crownMovesWhenHostIsCut(alpha, beta, gamma) {
    check((await hostOf(alpha)) === 'Beta', `Beta, first in, holds the crown (${await hostOf(alpha)})`);
    gamma.link.delay(3000);
    beta.link.cut();
    const cutAt = Date.now();

    const seen = await timeUntilGone(alpha, 'Beta', cutAt);
    console.log(`  Alpha saw Beta leave ${seen} ms after Beta's network was cut`);
    check(seen > 0 && seen <= SEEN_LEAVING_MS,
        `a host whose network is cut is seen leaving within ${SEEN_LEAVING_MS / 1000} s (${seen < 0 ? 'not within ' + WAIT_MS / 1000 + ' s' : seen + ' ms'})`);
    await alpha.page.waitForTimeout(1500);
    check((await hostOf(alpha)) === 'Alpha', `and the crown passes to the next in line (${await hostOf(alpha)})`);

    // Gamma has been slow (3 s each way) since the cut; give it the rest of a long wait.
    await alpha.page.waitForTimeout(Math.max(0, 35000 - (Date.now() - cutAt)));
    check((await users(alpha)).includes('Gamma'), 'a slow but alive peer (3 s each way, 35 s) is not evicted');
    gamma.link.delay(0);
    await gamma.page.waitForTimeout(8000);   // let the delayed traffic drain
    check(await gamma.page.evaluate(() => window.underTheHood.connected), 'and the slow peer still believes it is in the room');
}

async function crownMovesWhenHostPullsThePlug(alpha, gamma) {
    await alpha.page.click('#plugBtn');
    const pulledAt = Date.now();
    const seen = await timeUntilGone(gamma, 'Alpha', pulledAt);
    console.log(`  Gamma saw Alpha leave ${seen} ms after Alpha pulled the plug`);
    check(seen > 0 && seen <= SEEN_LEAVING_MS,
        `Pull the plug: the room sees the host leave within ${SEEN_LEAVING_MS / 1000} s (${seen < 0 ? 'not within ' + WAIT_MS / 1000 + ' s' : seen + ' ms'})`);
    await gamma.page.waitForTimeout(1500);
    check((await hostOf(gamma)) === 'Gamma', `and Gamma takes the crown (${await hostOf(gamma)})`);
    check(await alpha.page.isVisible('#rejoinBtn'), 'the unplugged tab is offered Rejoin');
}

(async () => {
    const room = 'deadpeer-' + Math.floor(Date.now() / 1000);
    const tabs = [];
    try {
        const beta = await open(room, 'Beta'); tabs.push(beta);
        const alpha = await open(room, 'Alpha'); tabs.push(alpha);
        const gamma = await open(room, 'Gamma'); tabs.push(gamma);
        await alpha.page.waitForTimeout(5000);
        check((await users(alpha)).length === 3, `three people in one room (${JSON.stringify(await users(alpha))})`);
        // The proxy only cuts what goes through it: a socket opened anywhere
        // else would make every "cut" below a no-op that still reads as a test.
        check(tabs.every(t => t.sockets.length > 0), 'each browser opened its socket (all its traffic goes through its proxy)');

        await crownMovesWhenHostIsCut(alpha, beta, gamma);
        await crownMovesWhenHostPullsThePlug(alpha, gamma);
    } catch (e) {
        check(false, 'the suite ran to the end: ' + e.message);
    } finally {
        for (const t of tabs) { await t.browser.close(); t.link.close(); }
        console.log('\nPASS (' + pass.length + ')  FAIL (' + fail.length + ')');
        console.log('rooms: ' + room);
        process.exitCode = fail.length ? 1 : 0;   // exit() would drop buffered stdout
    }
})();
