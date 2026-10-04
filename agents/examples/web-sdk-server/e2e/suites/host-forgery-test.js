/*
 * Can one player forge a message from the host?
 *
 *     xvfb-run -a node suites/host-forgery-test.js
 *
 * The base class strips `_fromHost` off anything it RELAYS, so a forged
 * broadcast is already caught. This suite goes after the path that relay
 * cleaning cannot reach: an ADDRESSED send. `sendData(payload, victim)` goes
 * peer to peer untouched, so a player can put `_fromHost: true` on a
 * host-authoritative message and hand it straight to somebody.
 *
 * Find the Liar and BlockParty both used to accept the flag on its own, which
 * meant any player could reveal the liar on another player's screen from a
 * non-host seat. Both have left the SDK (Liar went to Party Arcade in hub phase
 * 4), so the vehicle is now Gavel: PartyKit, its base, trusts host traffic by
 * SENDER and ignores the flag. The forged message is a verdict; the guard holds
 * if the victim's courtroom never hears it.
 *
 * The last section is the important one: it puts the OLD check back on the
 * victim and forges again. If that does not land, this suite is not capable of
 * detecting the bug it exists for, and its passes mean nothing.
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

const FORGED = { t: 'state', phase: 'sentence', verdict: 'guilty', sentence: 'forged', title: 'forged' };

/** Record every message the victim actually ACTS on as host traffic. */
async function armVictim(victim) {
    await victim.page.evaluate(() => {
        const game = window.gavelGame;
        game.__accepted = [];
        const orig = game.clientReceive.bind(game);
        game.clientReceive = function (msg) {
            game.__accepted.push((msg && msg.t) + (msg && msg.sentence ? ':' + msg.sentence : ''));
            try { return orig(msg); } catch (_) { /* a forged state may be partial */ }
        };
    });
}

/** One player hands a forged host message straight to another player. */
const forge = (attacker, victimName, payload) => attacker.page.evaluate(([to, p]) =>
    // Addressed, not broadcast: this is the path the relay never sees.
    window.gavelGame.sendData(Object.assign({ _fromHost: true }, p), to), [victimName, payload]);

/** The check PartyKit replaced: trust the flag, then the sender. */
function putOldCheckBack() {
    const game = window.gavelGame;
    game.__accepted = [];
    game.onDataChannelMessage = function (peerId, data) {
        if (!data || typeof data !== 'object') return;
        if (data._fromHost || peerId === this._getHostName()) this.clientReceive(data);
    };
}

async function theGuardHolds(host, attacker, victim) {
    console.log('\n[1] the attack path');
    const sent = await forge(attacker, victim.name, FORGED);
    check(sent > 0, 'a player can address a message straight to another player', `sendData returned ${sent}`);
    await sleep(2500);

    console.log('\n[2] the guard holds');
    const accepted = await val(victim, 'game.__accepted');
    check(accepted.length === 0, 'a forged host message is ignored',
        accepted.length ? `ACCEPTED ${accepted.join(',')}` : 'nothing acted on');
    check(await val(victim, 'game.verdict') !== 'guilty', 'and no verdict appears on the victim\'s screen');

    await host.page.evaluate(to => window.gavelGame.toPlayer(to, { t: 'host-probe' }), victim.name);
    const fromHost = await waitFor(async () =>
        (await val(victim, 'game.__accepted')).includes('host-probe'), 10000, 'the host\'s own message');
    check(fromHost, 'while a real message from the host is still trusted');
    return sent;
}

async function theSuiteCanFail(attacker, victim) {
    console.log('\n[3] the same forgery against the OLD check');
    await victim.page.evaluate(putOldCheckBack);
    const sent = await forge(attacker, victim.name, Object.assign({}, FORGED, { sentence: 'forged-again' }));
    await sleep(2500);
    const accepted = await val(victim, 'game.__accepted');
    if (sent > 0) {
        check(accepted.length > 0, 'the old check DOES accept it — so this suite can detect the bug',
            accepted.length ? `accepted ${accepted.join(',')}` : 'NOT ACCEPTED — this suite proves nothing');
    } else {
        console.log('  (the forgery could not be delivered on this transport, so the ' +
            'old-check comparison is inconclusive rather than reassuring)');
        check(false, 'the forgery reaches the victim, so the comparison means something');
    }
}

(async () => {
    console.log('\nHost-forgery E2E');
    const browser = await chromium.launch(LAUNCH);
    const room = 'forge-e2e-' + Math.random().toString(36).slice(2, 7);
    let clients = [];
    try {
        clients = await openRoom(browser, '/apps/mini-games/gavel/index.html', 'gavelGame', room);
        clients.forEach(c => check(c.connected, `${c.name} connected`));
        await waitFor(async () => (await val(clients[0], 'game.playerCount()')) === 3, 30000, 'a roster of 3');

        const [host, attacker, victim] = clients;
        check(await val(host, 'game.isHost()') === true, 'the first client is the host');
        await armVictim(victim);
        await theGuardHolds(host, attacker, victim);
        await theSuiteCanFail(attacker, victim);
    } catch (err) {
        console.error('\nTEST THREW:', err && err.stack || err);
        check(false, 'the suite ran to the end');
    } finally {
        await closeAll(clients);
        await browser.close();
    }
    process.exitCode = R.report() === 0 ? 0 : 1;
})();
