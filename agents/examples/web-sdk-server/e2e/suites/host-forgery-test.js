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
 * non-host seat.
 *
 * The last section is the important one: it puts the OLD check back on the
 * victim and forges again. If that does not land, this suite is not capable of
 * detecting the bug it exists for, and its passes mean nothing.
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

async function openRoom(browser, path, globalName, room) {
    const pass = 'forge-pass-' + Math.random().toString(36).slice(2, 8);
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

/** Record every time the victim actually ACTS on a host-authoritative message. */
async function armVictim(victim, handler) {
    await victim.page.evaluate(([g, h]) => {
        const game = window[g];
        game.__accepted = [];
        const orig = game[h].bind(game);
        game[h] = function (data) {
            game.__accepted.push(data && data.type);
            return orig(data);
        };
    }, [victim.g, handler]);
}

/** One player hands a forged host message straight to another player. */
async function forge(attacker, victimName, payload) {
    return attacker.page.evaluate(([g, to, p]) => {
        const game = window[g];
        // Addressed, not broadcast: this is the path the relay never sees.
        return game.sendData(Object.assign({ _fromHost: true }, p), to);
    }, [attacker.g, victimName, payload]);
}

(async () => {
    console.log(`\nHost-forgery E2E — ${BASE}`);
    const browser = await chromium.launch(LAUNCH);
    const room = 'forge-e2e-' + Math.random().toString(36).slice(2, 7);
    let clients = [];

    try {
        clients = await openRoom(browser, '/apps/mini-games/find-the-liar/index.html', 'liarGame', room);
        clients.forEach(c => check(c.connected, `${c.name} connected`));

        await waitFor(async () => (await val(clients[0], 'game.getUserList().length')) === 3,
            30000, 'a roster of 3');

        const host = clients[0], attacker = clients[1], victim = clients[2];
        const hostName = await val(host, 'game.username');
        check(hostName === 'Mara', 'the first client is the host', hostName);

        await armVictim(victim, 'handleLiarSecretRevealed');

        // ---- 1. can one guest even reach another directly? ---------------
        console.log('\n[1] the attack path');
        const sent = await forge(attacker, victim.name, {
            type: 'liar-secret-revealed', liar: 'Mara', secret: 'forged',
        });
        check(sent > 0, 'a player can address a message straight to another player',
            `sendData returned ${sent}`);
        if (!sent) {
            console.log('  (no peer-to-peer channel between guests here, so the forgery ' +
                'could not be delivered — the check below proves the guard anyway)');
        }
        await sleep(2500);

        // ---- 2. the guard --------------------------------------------------
        console.log('\n[2] the guard holds');
        const accepted = await val(victim, 'game.__accepted');
        check(accepted.length === 0, 'a forged host message is ignored',
            accepted.length ? `ACCEPTED ${accepted.join(',')}` : 'nothing acted on');

        const stillHonoursHost = await val(victim, 'game._isFromHost(game._getHostName(), {type:"phase-change"})');
        check(stillHonoursHost === true, 'and a real message from the host is still trusted');
        const rejectsRelayed = await val(victim,
            'game._isFromHost(game._getHostName(), {type:"phase-change", _fromClient:"Odell"})');
        check(rejectsRelayed === false, 'while one the host merely relayed is not');
        const rejectsFlag = await val(victim, 'game._isFromHost("Odell", {type:"phase-change", _fromHost:true})');
        check(rejectsFlag === false, 'and the flag alone buys nothing');

        // ---- 3. prove this suite can fail ----------------------------------
        console.log('\n[3] the same forgery against the OLD check');
        await victim.page.evaluate(() => {
            const game = window.liarGame;
            game.__accepted = [];
            // The version that shipped before this suite existed.
            game._isFromHost = function (peerId, data) {
                if (!data) return false;
                if (data._fromHost) return true;
                if (data._fromClient) return false;
                const host = this._getHostName();
                return !!host && peerId === host;
            };
        });
        const sent2 = await forge(attacker, victim.name, {
            type: 'liar-secret-revealed', liar: 'Mara', secret: 'forged-again',
        });
        await sleep(2500);
        const acceptedOld = await val(victim, 'game.__accepted');

        if (sent2 > 0) {
            check(acceptedOld.length > 0,
                'the old check DOES accept it — so this suite can detect the bug',
                acceptedOld.length ? `accepted ${acceptedOld.join(',')}` : 'NOT ACCEPTED — this suite proves nothing');
        } else {
            console.log('  (the forgery could not be delivered on this transport, so the ' +
                'old-check comparison is inconclusive rather than reassuring)');
            check(true, 'old-check comparison skipped: no direct guest-to-guest channel');
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
