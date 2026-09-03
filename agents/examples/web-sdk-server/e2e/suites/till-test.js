/*
 * Till: licences, seats and webhooks.
 *
 *     node suites/till-test.js
 *
 * This suite talks to messaging-service directly, because that is where every
 * property worth proving lives. A licence check in a browser is a courtesy —
 * the server is the only place a "no" means anything.
 *
 * What it insists on:
 *
 *   1. a licence works, and stops working the moment it should (revoked,
 *      expired, wrong app, wrong site);
 *   2. the seat count is a real limit, and re-claiming a seat you already hold
 *      never fails on a full licence;
 *   3. a webhook signature is checked over the RAW body, replays are refused,
 *      and — the control — a GOOD signature is ACCEPTED. Without that last
 *      one, a verifier that rejects everything passes every tampering test.
 *      This codebase shipped exactly that bug in Attest and it took a full
 *      cycle to find.
 *
 * Needs: TILL_ADMIN_EMAIL / TILL_ADMIN_PASSWORD (or ADMIN_EMAIL /
 * ADMIN_PASSWORD) to mint licences, and TILL_WEBHOOK_SECRET matching what the
 * service was started with. The suite FAILS rather than skips when the webhook
 * secret is missing: a webhook section that quietly skips is how an unsigned
 * upgrade path ships.
 */
const crypto = require('crypto');
const { chromium } = require('playwright');
const { BASE, LAUNCH, gotoStable } = require('../lib/harness');

const API = (process.env.TILL_API_BASE
    || 'http://127.0.0.1:8082/messaging-platform/api/v1/messaging-service').replace(/\/$/, '');
const ADMIN_EMAIL = process.env.TILL_ADMIN_EMAIL || process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.TILL_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;
const WEBHOOK_SECRET = process.env.TILL_WEBHOOK_SECRET || '';

const pass = [], fail = [];
function check(ok, label, extra) {
    console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${extra ? '  — ' + extra : ''}`);
    (ok ? pass : fail).push(label + (extra ? '  — ' + extra : ''));
    return ok;
}

async function post(path, body, headers) {
    const res = await fetch(API + path, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
        body: typeof body === 'string' ? body : JSON.stringify(body)
    });
    let json = null;
    try { json = JSON.parse(await res.text()); } catch (_) {}
    return { status: res.status, json, data: json && json.data };
}

async function get(path, headers) {
    const res = await fetch(API + path, { headers: headers || {} });
    let json = null;
    try { json = JSON.parse(await res.text()); } catch (_) {}
    return { status: res.status, json, data: json && json.data };
}

const APP = 'tilltest' + Math.random().toString(36).slice(2, 7);

(async () => {
    console.log(`\nTill E2E — ${API}\n`);

    // ---- admin session, to mint licences with ----------------------------
    if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
        check(false, 'admin credentials are available to mint a licence',
            'set ADMIN_EMAIL and ADMIN_PASSWORD');
        return report();
    }
    const auth = await post('/admin/auth', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const adminToken = auth.data && (auth.data.token || auth.data.sessionToken);
    if (!check(!!adminToken, 'an admin session is available', 'status ' + auth.status)) {
        return report();
    }
    const asAdmin = { 'X-Admin-Token': adminToken };

    // ---- 1. issue, and use ------------------------------------------------
    console.log('\n[1] a licence that works');
    const issued = await post('/till/admin/issue',
        { app: APP, plan: 'pro', seats: 2, issuedTo: 'e2e@example.test' }, asAdmin);
    const key = issued.data && issued.data.key;
    check(issued.status === 201 && !!key, 'a licence is issued', 'status ' + issued.status);
    check(/^TILL-[A-Z0-9]+-[0-9A-Z]{24}$/.test(key || ''), 'the key looks like a licence key', key);

    const verdict = await post('/till/entitlement', { app: APP, key });
    check(verdict.data && verdict.data.valid === true, 'it entitles the app it was issued for',
        verdict.data && verdict.data.reason);
    check(verdict.data && verdict.data.plan === 'pro' && verdict.data.seats === 2,
        'with the plan and seat count it was issued with');

    // ---- 2. the key is never readable back --------------------------------
    console.log('\n[2] the key exists once');
    const listed = await get('/till/admin/licences?app=' + APP, asAdmin);
    const row = listed.data && listed.data.licences && listed.data.licences[0];
    check(!!row && !JSON.stringify(listed.data).includes(key),
        'the admin listing cannot reproduce the key — only its prefix',
        row ? row.keyPrefix : 'no row');

    // ---- 3. refusals ------------------------------------------------------
    console.log('\n[3] every way a licence can be no');
    const unknown = await post('/till/entitlement', { app: APP, key: 'TILL-NOPE-000000000000000000000000' });
    check(unknown.status === 200 && unknown.data && unknown.data.valid === false
        && unknown.data.reason === 'unknown_or_revoked',
        'an unknown key is a 200 with a verdict, not a 404',
        'status ' + unknown.status + ' / ' + (unknown.data && unknown.data.reason));

    const wrongApp = await post('/till/entitlement', { app: APP + 'x', key });
    check(wrongApp.data && wrongApp.data.valid === false && wrongApp.data.reason === 'unknown_or_revoked',
        'a real key for another app answers exactly like an unknown one',
        wrongApp.data && wrongApp.data.reason);

    const boundIssue = await post('/till/admin/issue',
        { app: APP, seats: 1, site: 'clinic.example.test' }, asAdmin);
    const boundKey = boundIssue.data && boundIssue.data.key;
    const wrongSite = await post('/till/entitlement', { app: APP, key: boundKey },
        { Origin: 'https://elsewhere.example.test' });
    check(wrongSite.data && wrongSite.data.reason === 'site_mismatch',
        'a site-bound licence refuses another origin', wrongSite.data && wrongSite.data.reason);
    const rightSite = await post('/till/entitlement', { app: APP, key: boundKey },
        { Origin: 'https://clinic.example.test:8443/some/path' });
    check(rightSite.data && rightSite.data.valid === true,
        'and accepts its own, port and path ignored', rightSite.data && rightSite.data.reason);

    const expiredIssue = await post('/till/admin/issue',
        { app: APP, seats: 1, expiresAt: '2020-01-01T00:00:00Z' }, asAdmin);
    const expiredCheck = await post('/till/entitlement', { app: APP, key: expiredIssue.data.key });
    check(expiredCheck.data && expiredCheck.data.reason === 'expired',
        'an expired licence says so', expiredCheck.data && expiredCheck.data.reason);

    // ---- 4. seats ---------------------------------------------------------
    console.log('\n[4] two seats means two');
    const seatA = await post('/till/seat/claim', { app: APP, key, seatRef: 'alice@example.test' });
    const seatB = await post('/till/seat/claim', { app: APP, key, seatRef: 'bob@example.test' });
    check(seatA.data && seatA.data.valid === true && seatB.data && seatB.data.valid === true,
        'two seats are claimed');
    check(seatB.data && seatB.data.seatsUsed === 2, 'and counted', String(seatB.data && seatB.data.seatsUsed));

    const seatC = await post('/till/seat/claim', { app: APP, key, seatRef: 'carol@example.test' });
    check(seatC.data && seatC.data.valid === false && seatC.data.reason === 'no_seats_available',
        'the third is refused', seatC.data && seatC.data.reason);

    // The one that matters in practice: closing a laptop must not lock you out.
    const seatAgain = await post('/till/seat/claim', { app: APP, key, seatRef: 'alice@example.test' });
    check(seatAgain.data && seatAgain.data.valid === true,
        'but a seat you already hold refreshes even on a full licence',
        seatAgain.data && seatAgain.data.reason);

    await post('/till/seat/release', { app: APP, key, seatRef: 'bob@example.test' });
    const seatCAgain = await post('/till/seat/claim', { app: APP, key, seatRef: 'carol@example.test' });
    check(seatCAgain.data && seatCAgain.data.valid === true,
        'releasing one frees it for somebody else', seatCAgain.data && seatCAgain.data.reason);

    // ---- 5. checkout refuses honestly -------------------------------------
    console.log('\n[5] no silent upgrades');
    const checkout = await post('/till/checkout', { app: APP, plan: 'pro', seats: 5 });
    check(checkout.status === 501,
        'checkout answers 501 rather than pretending to sell something',
        'status ' + checkout.status);

    // ---- 6. webhooks ------------------------------------------------------
    console.log('\n[6] a webhook is only as good as its signature');
    if (!WEBHOOK_SECRET) {
        check(false, 'TILL_WEBHOOK_SECRET is set so the accept path can be proven',
            'unset — the section below would only ever prove that everything is refused');
    } else {
        const providerRef = 'sub_' + Math.random().toString(36).slice(2, 10);
        const subIssue = await post('/till/admin/issue',
            { app: APP, seats: 1, provider: process.env.TILL_WEBHOOK_PROVIDER || 'stripe',
              providerRef }, asAdmin);
        const subKey = subIssue.data && subIssue.data.key;

        const sign = (ts, body) => 't=' + ts + ',v1=' + crypto.createHmac('sha256', WEBHOOK_SECRET)
            .update(ts + '.' + body).digest('hex');

        const now = Math.floor(Date.now() / 1000);
        const body = JSON.stringify({
            id: 'evt_' + Math.random().toString(36).slice(2, 10),
            type: 'subscription.past_due', ref: providerRef, status: 'past_due'
        });

        // The CONTROL, first: a correctly signed webhook must be ACCEPTED.
        const good = await post('/till/webhook', body, { 'X-Till-Signature': sign(now, body) });
        const accepted = good.status === 200 && good.data && good.data.applied === true;
        check(accepted, 'a correctly signed webhook is accepted and applied',
            'status ' + good.status + ' / updated ' + (good.data && good.data.licencesUpdated));

        const afterHook = await post('/till/entitlement', { app: APP, key: subKey });
        check(afterHook.data && afterHook.data.reason === 'past_due',
            'and the licence it named actually changed',
            afterHook.data && afterHook.data.reason);

        // Only now do refusals mean anything.
        const replay = await post('/till/webhook', body, { 'X-Till-Signature': sign(now, body) });
        check(replay.status === 200 && replay.data && replay.data.applied === false
            && replay.data.reason === 'duplicate_event',
            'the same event delivered twice is applied once',
            replay.data && replay.data.reason);

        const tamperedBody = body.replace('past_due', 'active');
        const tampered = await post('/till/webhook', tamperedBody, { 'X-Till-Signature': sign(now, body) });
        check(tampered.status === 401,
            'a body edited after signing is rejected — the signature covers the raw bytes',
            'status ' + tampered.status);

        const stale = JSON.stringify({ id: 'evt_stale', type: 'x', ref: providerRef, status: 'active' });
        const staleRes = await post('/till/webhook', stale,
            { 'X-Till-Signature': sign(now - 3600, stale) });
        check(staleRes.status === 401,
            'an hour-old signature is rejected, so a captured body cannot be replayed later',
            'status ' + staleRes.status);

        const unsigned = await post('/till/webhook',
            JSON.stringify({ id: 'evt_unsigned', type: 'x', ref: providerRef, status: 'active' }), {});
        check(unsigned.status === 401, 'and an unsigned one never gets near the parser',
            'status ' + unsigned.status);
    }

    // ---- 7. revocation ----------------------------------------------------
    console.log('\n[7] revoking means revoked');
    const licenceId = row && row.id;
    const revoked = await post('/till/admin/revoke', { id: licenceId }, asAdmin);
    check(revoked.status === 200, 'a licence can be revoked', 'status ' + revoked.status);
    const afterRevoke = await post('/till/entitlement', { app: APP, key });
    check(afterRevoke.data && afterRevoke.data.valid === false && afterRevoke.data.reason === 'revoked',
        'and stops working immediately', afterRevoke.data && afterRevoke.data.reason);

    // ---- 8. admin endpoints are admin only --------------------------------
    console.log('\n[8] minting is not a public endpoint');
    const noToken = await post('/till/admin/issue', { app: APP, seats: 99 }, {});
    check(noToken.status === 401, 'issuing without an admin token is refused',
        'status ' + noToken.status);
    const badToken = await post('/till/admin/issue', { app: APP, seats: 99 },
        { 'X-Admin-Token': 'not-a-token' });
    check(badToken.status === 401, 'and a made-up token is not a token', 'status ' + badToken.status);

    // ---- 9. the client half, in a real browser ----------------------------
    // Everything above proves the server. This proves the SDK that apps will
    // actually call — and it asserts a TRUE verdict, not just "it answered",
    // because AgentConnection.Till.check() deliberately resolves
    // {valid:false, reason:'unavailable'} on a network failure. A test that
    // only checked for a verdict object would pass with the API unreachable.
    console.log('\n[9] AgentConnection.Till, from a page');
    const browserIssue = await post('/till/admin/issue', { app: APP, seats: 3 }, asAdmin);
    const browserKey = browserIssue.data && browserIssue.data.key;
    let browser = null;
    try {
        browser = await chromium.launch(LAUNCH);
        const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
        const page = await ctx.newPage();
        page.setDefaultTimeout(45000);
        // An app page, not the playground: playground.html does not load the
        // SDK at all, so asserting there would test nothing but the harness.
        await gotoStable(page, `${BASE}/apps/evidence-chain/app.html?debug`,
            { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.AgentConnection, { timeout: 45000 });

        const exposed = await page.evaluate(() =>
            !!(window.AgentConnection && window.AgentConnection.Till
               && typeof window.AgentConnection.Till.check === 'function'));
        check(exposed, 'the served SDK exposes AgentConnection.Till');

        const fromPage = await page.evaluate(async ([api, app, key]) => {
            const Till = window.AgentConnection.Till.configure(api);
            const good = await Till.check({ app, key });
            const bad = await Till.check({ app, key: 'TILL-NOPE-000000000000000000000000' });
            const seat = await Till.claimSeat({ app, key, seatRef: 'browser@example.test' });
            let requireThrew = false;
            try {
                await Till.require({ app, key: 'TILL-NOPE-000000000000000000000000' });
            } catch (e) {
                requireThrew = !!(e && e.verdict);
            }
            return { good, bad, seat, requireThrew };
        }, [API, APP, browserKey]);

        check(fromPage.good && fromPage.good.valid === true,
            'Till.check() from the page gets a real yes',
            fromPage.good && fromPage.good.reason);
        check(fromPage.bad && fromPage.bad.valid === false
            && fromPage.bad.reason === 'unknown_or_revoked',
            'and a real no for a key that does not exist',
            fromPage.bad && fromPage.bad.reason);
        check(fromPage.seat && fromPage.seat.seatHeld === true,
            'Till.claimSeat() takes a seat from the browser');
        check(fromPage.requireThrew === true,
            'Till.require() rejects with the verdict attached, so a shell can say why');

        await ctx.close();
    } catch (e) {
        check(false, 'the browser section ran', String(e && e.message).slice(0, 120));
    } finally {
        if (browser) { try { await browser.close(); } catch (_) {} }
    }

    report();
})().catch(err => {
    console.error('\nTEST THREW:', (err && err.stack) || err);
    check(false, 'the suite ran to the end');
    report();
});

function report() {
    console.log('\nPASS (' + pass.length + ')');
    pass.forEach(x => console.log('  ✓ ' + x));
    console.log('\nFAIL (' + fail.length + ')');
    fail.forEach(x => console.log('  ✗ ' + x));
    process.exit(fail.length === 0 ? 0 : 1);
}
