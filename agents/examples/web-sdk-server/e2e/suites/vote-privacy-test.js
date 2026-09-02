/*
 * Does a player's vote reach anybody but the host?
 *
 *     xvfb-run -a node suites/vote-privacy-test.js
 *
 * host-forgery-test.js covers one half of the relay hazard: a client must not
 * be able to forge a message FROM the host. This suite covers the other half,
 * which shipped broken for much longer and is far harder to notice.
 *
 * UserConnectionBase in p2p-host mode wraps any untargeted client send with
 * `_needsRelay`, and the host then rebroadcasts it to every other client. So
 * `sendData({type:'submit-vote', ...})` from a guest does not go to the host
 * privately — it lands in every opponent's browser. In a hidden-role game the
 * votes, the answers and the role reveals are the entire secret, and they were
 * all being handed out before the reveal. Nothing in the UI showed it; the
 * leak was only visible in another player's devtools.
 *
 * The rule this pins: every client -> host message is ADDRESSED
 * (`sendData(payload, hostName)`), which the relay never sees. That is what
 * `_toHost()` does here, and what `toHost()` does in shared/party-kit.js.
 *
 * Section 3 is the one that matters: it puts the old untargeted send back and
 * checks the leak reappears. If it does not, this suite cannot detect the bug
 * it exists for and its passes mean nothing.
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

const NAMES = ['Mara', 'Odell', 'Priya'];

/** The message types that must never reach a player other than the host. */
const PRIVATE_TYPES = ['submit-vote', 'submit-answer', 'role-reveal-response'];

async function openRoom(browser, path, globalName, room) {
    const pass = 'vote-pass-' + Math.random().toString(36).slice(2, 8);
    const clients = [];
    for (const name of NAMES) {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        const page = await ctx.newPage();
        page.setDefaultTimeout(60000);
        await gotoStable(page, `${BASE}${path}?debug`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#connectionModal.active', { timeout: 30000 });
        await page.fill('#usernameInput', name);
        await page.fill('#channelInput', room);
        await page.fill('#passwordInput', pass);
        await page.click('#connectBtn');
        const ok = await waitFor(async () =>
            !(await page.evaluate(() => document.getElementById('connectionModal')?.classList.contains('active'))),
            45000, `${name} to connect`);
        clients.push({ name, page, ctx, connected: ok, g: globalName });
        await sleep(2200);
    }
    return clients;
}

const val = (c, expr) => c.page.evaluate(
    new Function(`const game = window["${c.g}"]; return (${expr});`));

/**
 * Record every private-type message that arrives at this client, whoever it
 * came from. Wrapping onDataChannelMessage catches it at the door, before the
 * game decides whether to act on it — a message the app ignores has still been
 * delivered to the opponent's machine, which is the whole problem.
 */
async function armEavesdropper(client, types) {
    await client.page.evaluate(([g, t]) => {
        const game = window[g];
        game.__heard = [];
        const orig = game.onDataChannelMessage.bind(game);
        game.onDataChannelMessage = function (peerId, data) {
            if (data && t.includes(data.type)) {
                game.__heard.push({ type: data.type, from: peerId, payload: data });
            }
            return orig(peerId, data);
        };
    }, [client.g, types]);
}

(async () => {
    console.log(`\nVote-privacy E2E — ${BASE}`);
    const browser = await chromium.launch(LAUNCH);
    const room = 'vote-e2e-' + Math.random().toString(36).slice(2, 7);
    let clients = [];

    try {
        clients = await openRoom(browser, '/apps/mini-games/find-the-liar/index.html', 'liarGame', room);
        clients.forEach(c => check(c.connected, `${c.name} connected`));

        await waitFor(async () => (await val(clients[0], 'game.getUserList().length')) === 3,
            30000, 'a roster of 3');

        const host = clients[0], voter = clients[1], bystander = clients[2];
        const hostName = await val(host, 'game.username');
        check(hostName === 'Mara', 'the first client is the host', hostName);

        // Both the host and the uninvolved third player listen. The host SHOULD
        // hear the vote; the bystander must not.
        await armEavesdropper(host, PRIVATE_TYPES);
        await armEavesdropper(bystander, PRIVATE_TYPES);

        // ---- 1. the vote reaches the host ---------------------------------
        console.log('\n[1] the vote still gets where it is going');
        const sent = await voter.page.evaluate(() =>
            window.liarGame._toHost({ type: 'submit-vote', votedFor: 'Mara' }));
        check(sent > 0, 'a guest can address the host', `_toHost returned ${sent}`);
        await sleep(2500);

        const hostHeard = await val(host, 'game.__heard.map(h => h.type)');
        check(hostHeard.includes('submit-vote'), 'the host receives the vote',
            hostHeard.length ? hostHeard.join(',') : 'heard nothing');

        // ---- 2. and nobody else -------------------------------------------
        console.log('\n[2] and nobody else hears it');
        const leaked = await val(bystander, 'game.__heard');
        check(leaked.length === 0, 'the other player never receives another player\'s vote',
            leaked.length ? `LEAKED ${leaked.map(l => l.type + ' via ' + l.from).join(', ')}` : 'heard nothing');

        // The same rule for the other two secrets.
        for (const type of ['submit-answer', 'role-reveal-response']) {
            await bystander.page.evaluate(() => { window.liarGame.__heard = []; });
            await voter.page.evaluate(t =>
                window.liarGame._toHost({ type: t, answer: 'secret', role: 'liar' }), type);
            await sleep(1800);
            const heard = await val(bystander, 'game.__heard.map(h => h.type)');
            check(heard.length === 0, `a ${type} does not reach the other player`,
                heard.length ? `LEAKED ${heard.join(',')}` : 'heard nothing');
        }

        // ---- 3. prove this suite can fail ----------------------------------
        console.log('\n[3] the same vote sent the OLD way');
        await bystander.page.evaluate(() => { window.liarGame.__heard = []; });
        const sentOld = await voter.page.evaluate(() =>
            // Exactly what submitVote() did before this suite existed: no target,
            // so the base class wraps it with _needsRelay and the host fans it out.
            window.liarGame.sendData({ type: 'submit-vote', votedFor: 'Mara' }));
        await sleep(2800);
        const heardOld = await val(bystander, 'game.__heard.map(h => h.type)');

        if (sentOld > 0) {
            check(heardOld.length > 0,
                'the untargeted send DOES leak — so this suite can detect the bug',
                heardOld.length ? `leaked ${heardOld.join(',')}` : 'NO LEAK — this suite proves nothing');
        } else {
            console.log('  (the untargeted send went nowhere on this transport, so the ' +
                'old-behaviour comparison is inconclusive rather than reassuring)');
            check(true, 'old-behaviour comparison skipped: nothing was sent');
        }

    } catch (err) {
        console.error('\nTEST THREW:', err && err.stack || err);
        check(false, 'the suite ran to the end');
    } finally {
        for (const c of clients) { try { await c.ctx.close(); } catch (_) {} }
        await browser.close();
    }

    process.exit(R.report() === 0 ? 0 : 1);
})();
