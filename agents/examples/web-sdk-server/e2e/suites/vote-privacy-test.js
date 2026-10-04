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
 * `sendData({t:'vote', ...})` from a guest does not go to the host privately —
 * it lands in every other juror's browser. In a game made of secrets the
 * votes, the testimony and the plea are the entire secret, and they were all
 * being handed out before the reveal. Nothing in the UI showed it; the leak
 * was only visible in another player's devtools.
 *
 * The rule this pins: every client -> host message is ADDRESSED, which the
 * relay never sees. That is what `toHost()` does in shared/party-kit.js. The
 * vehicle was Find the Liar until it moved to Party Arcade (hub phase 4); it is
 * Gavel now, whose jury votes in sealed booths.
 *
 * Section 3 is the one that matters: it puts the old untargeted send back and
 * checks the leak reappears. If it does not, this suite cannot detect the bug
 * it exists for and its passes mean nothing.
 */
const { chromium } = require('playwright');
const { LAUNCH, results } = require('../lib/harness');
const { sleep, waitFor, openRoom, val, closeAll } = require('../lib/party-room');

const R = results();
function check(ok, label, extra) {
    console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${extra ? '  — ' + extra : ''}`);
    R.check(ok, label + (extra ? '  — ' + extra : ''));
    return ok;
}

const PRIVATE = ['vote', 'submit', 'plea'];
const heard = (c) => val(c, `(game.__seen || []).filter(m => ${JSON.stringify(PRIVATE)}.includes(m.t))`);
const forget = (c) => c.page.evaluate(() => { window.gavelGame.__seen = []; });

/** What the host's own handler received from players, by type. */
async function armHost(host) {
    await host.page.evaluate(() => {
        const game = window.gavelGame;
        game.__got = [];
        const orig = game.hostReceive.bind(game);
        game.hostReceive = function (from, msg) {
            game.__got.push(msg && msg.t);
            return orig(from, msg);
        };
    });
}

async function secretsStayWithTheHost(host, voter, bystander) {
    console.log('\n[1] the vote still gets where it is going');
    const sent = await voter.page.evaluate(() => window.gavelGame.toHost({ t: 'vote', vote: 'guilty' }));
    check(sent > 0, 'a juror can address the host', `toHost returned ${sent}`);
    const got = await waitFor(async () => (await val(host, 'game.__got')).includes('vote'), 10000, 'the vote');
    check(got, 'the host receives the vote');

    console.log('\n[2] and nobody else hears it');
    let leaked = await heard(bystander);
    check(leaked.length === 0, 'the other juror never receives another juror\'s vote',
        leaked.length ? `LEAKED ${leaked.map(l => l.t + ' via ' + l.from).join(', ')}` : 'heard nothing');

    for (const msg of [{ t: 'submit', text: 'secret testimony' }, { t: 'plea', text: 'secret plea' }]) {
        await forget(bystander);
        await voter.page.evaluate(m => window.gavelGame.toHost(m), msg);
        await sleep(1800);
        leaked = await heard(bystander);
        check(leaked.length === 0, `a ${msg.t} does not reach the other player`,
            leaked.length ? `LEAKED ${leaked.map(l => l.t).join(',')}` : 'heard nothing');
    }
}

async function theSuiteCanFail(voter, bystander) {
    console.log('\n[3] the same vote sent the OLD way');
    await forget(bystander);
    // What a vote was before toHost existed: no target, so the base class wraps
    // it with _needsRelay and the host fans it out to the room.
    const sent = await voter.page.evaluate(() => window.gavelGame.sendData({ t: 'vote', vote: 'guilty' }));
    await sleep(2800);
    const leaked = await heard(bystander);
    if (sent > 0) {
        check(leaked.length > 0, 'the untargeted send DOES leak — so this suite can detect the bug',
            leaked.length ? `leaked ${leaked.map(l => l.t).join(',')}` : 'NO LEAK — this suite proves nothing');
    } else {
        check(false, 'the untargeted send went somewhere, so the comparison means something');
    }
}

(async () => {
    console.log('\nVote-privacy E2E');
    const browser = await chromium.launch(LAUNCH);
    const room = 'vote-e2e-' + Math.random().toString(36).slice(2, 7);
    let clients = [];
    try {
        clients = await openRoom(browser, '/apps/mini-games/gavel/index.html', 'gavelGame', room);
        clients.forEach(c => check(c.connected, `${c.name} connected`));
        await waitFor(async () => (await val(clients[0], 'game.playerCount()')) === 3, 30000, 'a roster of 3');

        const [host, voter, bystander] = clients;
        check(await val(host, 'game.isHost()') === true, 'the first client is the host');
        await armHost(host);
        await forget(bystander);
        await secretsStayWithTheHost(host, voter, bystander);
        await theSuiteCanFail(voter, bystander);
    } catch (err) {
        console.error('\nTEST THREW:', err && err.stack || err);
        check(false, 'the suite ran to the end');
    } finally {
        await closeAll(clients);
        await browser.close();
    }
    process.exitCode = R.report() === 0 ? 0 : 1;
})();
