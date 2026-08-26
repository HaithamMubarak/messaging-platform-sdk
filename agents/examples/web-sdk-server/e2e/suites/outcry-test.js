// ============================================================================
// Open Outcry — 3-client end-to-end test against the real backend.
//
//   xvfb-run -a --server-args="-screen 0 1280x900x24" node oo-test.js
//
// Asserts, in order:
//   1. three clients connect to one room and agree on the roster
//   2. the host can open the floor from the UI
//   3. exactly ONE client is dealt the secret each round
//   4. orders move the price and print on every client's tape
//   5. PRIVACY — no client except the host ever receives an 'order' message
//      (the whole game rests on this; a broadcast order would leak the insider)
//   6. the vote phase runs and settlement pays out with a P&L table
//   7. the match reaches 'over' with standings
// ============================================================================

const { chromium } = require('playwright');
const { BASE, LAUNCH, results, gotoStable } = require('../lib/harness');

const URL = BASE + '/apps/mini-games/open-outcry/index.html';
const ROOM = 'outcry-e2e-' + Math.random().toString(36).slice(2, 8);
const PASS = 'floor-pass-9931';
const NAMES = ['Mara', 'Odell', 'Priya'];

const ROUNDS = '3';
const OPEN_S = '25';

const R = results();
function check(ok, label, extra) {
    console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${extra ? '  — ' + extra : ''}`);
    R.check(ok, label + (extra ? '  — ' + extra : ''));
    return ok;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(fn, timeoutMs, label) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        try { if (await fn()) return true; } catch (_) { /* page busy */ }
        await sleep(300);
    }
    console.log(`  (timed out waiting for ${label})`);
    return false;
}

const phaseOf = p => p.evaluate(() => window.outcryGame ? window.outcryGame.phase : null);
const priceOf = p => p.evaluate(() => window.outcryGame ? Math.round(window.outcryGame.price) : null);
const tapeLen = p => p.evaluate(() => window.outcryGame ? window.outcryGame.tape.length : -1);
const visible = (p, id) => p.evaluate(i => {
    const el = document.getElementById(i);
    return !!el && !el.hidden && el.offsetParent !== null;
}, id);

async function connectClient(browser, name) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(60000);
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));

    await gotoStable(page, URL + '?debug', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#connectionModal.active', { timeout: 30000 });
    await page.fill('#usernameInput', name);
    await page.fill('#channelInput', ROOM);
    await page.fill('#passwordInput', PASS);
    await page.click('#connectBtn');

    const ok = await waitFor(async () =>
        !(await page.evaluate(() => document.getElementById('connectionModal')?.classList.contains('active'))),
        45000, `${name} to connect`);

    // Record every datachannel message this client receives, so the privacy
    // assertion can look at the real wire rather than at the UI.
    await page.evaluate(() => {
        const g = window.outcryGame;
        if (!g || g.__spied) return;
        g.__spied = true;
        g.__seen = [];
        const orig = g.onDataChannelMessage.bind(g);
        g.onDataChannelMessage = function (peerId, data) {
            try { g.__seen.push({ from: peerId, t: data && data.t }); } catch (_) {}
            return orig(peerId, data);
        };
    });

    return { name, page, ctx, errors, connected: ok };
}

(async () => {
    console.log(`\nOpen Outcry E2E — room ${ROOM}\n${URL}\n`);
    const browser = await chromium.launch(LAUNCH);

    const clients = [];
    try {
        // ---- 1. connect ------------------------------------------------
        console.log('[1] three clients join one room');
        for (const n of NAMES) {
            const c = await connectClient(browser, n);
            check(c.connected, `${n} connected`);
            clients.push(c);
            await sleep(2500);   // let the mesh settle before the next join
        }
        const host = clients[0], guests = clients.slice(1);

        await waitFor(async () =>
            (await host.page.evaluate(() => window.outcryGame.getUserList().length)) === 3,
            30000, 'roster of 3');
        for (const c of clients) {
            const n = await c.page.evaluate(() => window.outcryGame.getUserList().length);
            check(n === 3, `${c.name} sees 3 traders`, `saw ${n}`);
        }
        const isHost = await host.page.evaluate(() => window.outcryGame.isHost());
        check(isHost, 'first client is the floor manager');

        // ---- 2. open the floor from the UI -----------------------------
        console.log('\n[2] host opens the floor');
        check(await visible(host.page, 'hostControls'), 'host sees the floor-manager card');
        check(!(await visible(guests[0].page, 'hostControls')), 'a guest does not');
        await host.page.selectOption('#roundsSelect', ROUNDS);
        await host.page.selectOption('#timeSelect', OPEN_S);
        await host.page.click('#startBtn');

        const started = await waitFor(async () => {
            const p = await phaseOf(host.page);
            return p === 'open' || p === 'subject';
        }, 20000, 'the market to open');
        check(started, 'a round started');

        let sawVote = false, sawSettle = false, sawSubject = false;
        let roundsSeen = 0;

        // ---- 3-6. play the match ---------------------------------------
        console.log('\n[3] playing the rounds');
        const deadline = Date.now() + 4 * 60 * 1000;
        let lastPhase = null, lastRound = 0;

        while (Date.now() < deadline) {
            const phase = await phaseOf(host.page);
            const round = await host.page.evaluate(() => window.outcryGame.round);
            if (phase === 'over') break;

            if (phase !== lastPhase || round !== lastRound) {
                console.log(`    round ${round} — ${phase}`);
                lastPhase = phase; lastRound = round;

                if (phase === 'subject') {
                    sawSubject = true;
                    // Exactly one client is the subject; they answer in private.
                    let answered = 0;
                    for (const c of clients) {
                        if (await visible(c.page, 'subjectButtons')) {
                            await c.page.click('#subjYes');
                            answered++;
                        }
                    }
                    check(answered === 1, 'exactly one client was asked the private question', `${answered} were`);
                }

                if (phase === 'open') {
                    roundsSeen++;
                    await sleep(800);
                    // Exactly one client holds the secret this round.
                    let holders = 0;
                    for (const c of clients) if (await visible(c.page, 'secretBox')) holders++;
                    check(holders === 1, `round ${round}: exactly one insider`, `${holders} held a secret`);

                    // Trade. Guests buy YES, host buys NO — the price must move
                    // and every client must see the prints.
                    const before = await priceOf(host.page);
                    const cashBefore = await guests[0].page.evaluate(() => window.outcryGame.wallet.cash);
                    for (const g of guests) {
                        await g.page.click('#buyYes');
                        await sleep(250);
                        await g.page.click('#buyYes');
                        await sleep(250);
                    }
                    await host.page.click('.oo-lot[data-lot="5"]');
                    await host.page.click('#buyNo');
                    await sleep(1500);

                    const after = await priceOf(host.page);
                    check(after !== before, `round ${round}: flow moved the price`, `${before} -> ${after}`);

                    for (const c of clients) {
                        const px = await priceOf(c.page);
                        const tl = await tapeLen(c.page);
                        check(px === after, `${c.name} agrees on the price`, `${px} vs ${after}`);
                        // Five orders go in each round; every client, host
                        // included, must show exactly five prints — the host
                        // applying its own print twice is a real bug.
                        check(tl === 5, `${c.name} sees the whole tape, once`, `${tl} prints`);
                    }

                    // Cash carries across rounds and winners come in above 1000,
                    // so the assertion is against THIS round's opening cash.
                    const cash = await guests[0].page.evaluate(() => window.outcryGame.wallet.cash);
                    const yes = await guests[0].page.evaluate(() => window.outcryGame.wallet.yes);
                    check(cash < cashBefore && yes >= 2, 'a guest wallet was debited and filled',
                        `cash ${cashBefore} -> ${cash}, yes ${yes}`);
                }

                if (phase === 'vote') {
                    sawVote = true;
                    await sleep(600);
                    for (const c of clients) {
                        const who = await c.page.evaluate(() => {
                            const b = document.querySelector('.oo-vote');
                            if (b) { b.click(); return b.dataset.who; }
                            return null;
                        });
                        check(!!who, `${c.name} named somebody`, who || 'no candidates rendered');
                    }
                }

                if (phase === 'settle') {
                    sawSettle = true;
                    await sleep(800);
                    for (const c of clients) {
                        const rows = await c.page.evaluate(() =>
                            document.querySelectorAll('#settleBody .oo-table tbody tr').length);
                        check(rows === 3, `${c.name} sees a 3-row settlement`, `${rows} rows`);
                    }
                    const verdict = await host.page.evaluate(() =>
                        document.querySelector('#settleBody .oo-verdict')?.textContent || '');
                    check(/insider/i.test(verdict), 'settlement names the insider', verdict.slice(0, 90));
                }
            }
            await sleep(700);
        }

        // ---- 5. the privacy assertion ----------------------------------
        console.log('\n[4] privacy — orders reached the host and nobody else');
        for (const g of guests) {
            const seen = await g.page.evaluate(() => window.outcryGame.__seen || []);
            const leaked = seen.filter(m => m.t === 'order');
            check(leaked.length === 0, `${g.name} never received another trader's order`,
                `${seen.length} messages seen, ${leaked.length} orders`);
            const kinds = [...new Set(seen.map(m => m.t))].join(',');
            console.log(`      ${g.name} received: ${kinds}`);
        }
        const hostSeen = await host.page.evaluate(() => window.outcryGame.__seen || []);
        check(hostSeen.some(m => m.t === 'order'), 'the host did receive orders',
            `${hostSeen.filter(m => m.t === 'order').length} orders`);
        const fromHostOnly = await guests[0].page.evaluate(() => {
            const g = window.outcryGame;
            const host = g._getHostName();
            return (g.__seen || []).every(m => m.from === host);
        });
        check(fromHostOnly, 'a guest only ever heard from the host');

        // ---- 7. the end ------------------------------------------------
        console.log('\n[5] the match finishes');
        const over = await waitFor(async () => (await phaseOf(host.page)) === 'over', 90000, 'the floor to close');
        check(over, 'match reached "over"');
        check(sawSubject || roundsSeen > 0, 'at least one round was played', `${roundsSeen} markets opened`);
        check(sawVote, 'a vote phase ran');
        check(sawSettle, 'a settlement ran');

        if (over) {
            for (const c of clients) {
                const title = await c.page.evaluate(() => document.getElementById('overTitle')?.textContent || '');
                check(/takes the floor/.test(title), `${c.name} sees the winner`, title);
                const st = await c.page.evaluate(() => window.outcryGame.standings.length);
                check(st === 3, `${c.name} has 3 in the standings`, `${st}`);
            }
            const cashes = await host.page.evaluate(() => window.outcryGame.standings.map(s => s.cash));
            check(cashes.some(c => c !== 1000), 'cash actually moved', JSON.stringify(cashes));
        }

        // ---- console hygiene -------------------------------------------
        console.log('\n[6] console');
        for (const c of clients) {
            const bad = c.errors.filter(e => !/favicon|Failed to load resource.*404/.test(e));
            check(bad.length === 0, `${c.name} had no console errors`, bad.slice(0, 2).join(' | '));
        }
        const mixed = clients.flatMap(c => c.errors.filter(e => /Mixed Content/.test(e)));
        check(mixed.length === 0, 'no mixed-content errors');

    } catch (err) {
        console.error('\nTEST THREW:', err && err.stack || err);
        check(false, 'the suite ran to the end');
    } finally {
        for (const c of clients) { try { await c.ctx.close(); } catch (_) {} }
        await browser.close();
    }

    process.exit(R.report() === 0 ? 0 : 1);
})();
