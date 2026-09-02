/*
 * Attest: hash-chain receipts as a platform primitive.
 *
 *     xvfb-run -a node suites/attest-test.js
 *
 * Five apps had each hand-rolled this rule; the primitive only earns its place
 * if a chain it produces can be checked by somebody who does not trust it. So
 * the assertions that matter here are not "a record came back" -- they are:
 *
 *   1. the chain verifies with the platform's own answer ignored (the verifier
 *      is handed plain data and asked to re-derive everything);
 *   2. the server refuses records it cannot make verifiable (a bad hash, a
 *      payload trying to name a different author);
 *   3. and section 5, which is the whole point: every field that carries
 *      meaning is tampered with in turn, and the verifier must catch each one
 *      at the right index. A verifier that cannot fail proves nothing, and this
 *      codebase has twice shipped a check that could not.
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

/** Any page on the site gives us a connected AgentConnection to drive. */
async function connected(browser, room, name) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(60000);
    page.on('pageerror', e => console.log('  (pageerror) ' + e.message.split('\n')[0].slice(0, 120)));
    await gotoStable(page, `${BASE}/apps/evidence-chain/app.html?debug`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#usernameInput', { timeout: 45000 });
    await page.fill('#usernameInput', name);
    await page.fill('#channelInput', room);
    await page.fill('#passwordInput', 'attest-pw-1');
    await page.click('#connectBtn');
    await page.waitForFunction(
        () => window.ecApp && window.ecApp.connected && window.ecApp.channel && window.ecApp.channel.sessionId,
        { timeout: 45000 }).catch(() => {});
    return { ctx, page };
}

/** Append through the SDK exactly as an app would. */
const append = (page, chainKey, kind, text, meta) => page.evaluate(async ([k, kind2, t, m]) => {
    const ch = window.ecApp.channel;
    const contentHash = await ch.attestHash(t);
    return await new Promise(res => ch.attest({ chainKey: k, kind: kind2, contentHash, meta: m }, res));
}, [chainKey, kind, text, meta || null]);

const listChain = (page, chainKey) => page.evaluate(k =>
    new Promise(res => window.ecApp.channel.attestList(k, res)), chainKey);

(async () => {
    console.log(`\nAttest E2E — ${BASE}`);
    const browser = await chromium.launch(LAUNCH);
    const room = 'attest-e2e-' + Math.random().toString(36).slice(2, 7);
    let a = null;

    try {
        a = await connected(browser, room, 'Registrar');
        const ready = await a.page.evaluate(() =>
            !!(window.ecApp && window.ecApp.channel && typeof window.ecApp.channel.attest === 'function'));
        check(ready, 'the SDK exposes attest() on a live channel');

        // ---- 1. a chain gets written --------------------------------------
        console.log('\n[1] four records, one ceremony');
        const chainKey = 'consent-' + Math.random().toString(36).slice(2, 7);
        const steps = [
            ['consent-opened', 'template v7 text', { formVersion: 7 }],
            ['comprehension', 'answers: 2 of 2', { correct: 2 }],
            ['consent-signed', 'patient signature blob', null],
            ['countersigned', 'clinician signature blob', { role: 'clinician' }]
        ];
        const written = [];
        for (const [kind, text, meta] of steps) {
            const res = await append(a.page, chainKey, kind, text, meta);
            written.push(res);
        }
        const allOk = written.every(r => r && r.status === 'success' && r.data && r.data.record);
        check(allOk, 'four records appended', written.map(r => (r && r.status) || 'null').join(','));

        const seqs = written.filter(r => r && r.data).map(r => r.data.record.seq);
        check(JSON.stringify(seqs) === '[1,2,3,4]', 'seq is server-assigned and gapless', seqs.join(','));

        const first = written[0] && written[0].data && written[0].data.record;
        check(!!first && /^[0-9a-f]{64}$/.test(first.chain || ''), 'each record carries a chain value');
        check(!!first && !!first.sig && !!first.kid, 'and a signature with the key that made it');

        // ---- 2. it verifies, without believing the platform -----------------
        console.log('\n[2] the verifier re-derives everything itself');
        const listed = await listChain(a.page, chainKey);
        check(listed && listed.status === 'success', 'the chain reads back');
        const bundle = listed && listed.data;
        check(!!bundle && Array.isArray(bundle.records) && bundle.records.length === 4,
            'with all four records, oldest first',
            bundle && bundle.records ? String(bundle.records.length) : 'none');
        check(!!bundle && /^[0-9a-f]{64}$/.test(bundle.genesis || ''),
            'and the derived genesis to start from');

        const verdict = await a.page.evaluate(b =>
            window.ecApp.channel.constructor.attestVerify
                ? window.ecApp.channel.constructor.attestVerify(b)
                : window.AgentConnection.attestVerify(b), bundle);
        check(verdict && verdict.ok === true, 'the chain verifies end to end',
            verdict && verdict.ok ? `${verdict.length} records` : (verdict && verdict.reason) || 'no verdict');

        // ---- 3. identity comes from the transport --------------------------
        console.log('\n[3] a payload cannot name its own author');
        const forged = await a.page.evaluate(async k => {
            const ch = window.ecApp.channel;
            const contentHash = await ch.attestHash('forged');
            // agentName is not part of the DTO; sending it must change nothing.
            return await new Promise(res => ch._attestPost('append', {
                chainKey: k, kind: 'forged', contentHash, agentName: 'SomebodyElse'
            }, res));
        }, chainKey);
        const forgedAgent = forged && forged.data && forged.data.record
            && forged.data.record.stamp && forged.data.record.stamp.agent;
        check(forgedAgent === 'Registrar',
            'the stamped agent is the session identity, not the one the payload claimed',
            'stamped: ' + forgedAgent);

        // ---- 4. the server refuses what it cannot make verifiable ----------
        console.log('\n[4] refusals');
        const badHash = await a.page.evaluate(k => new Promise(res =>
            window.ecApp.channel.attest({ chainKey: k, kind: 'x', contentHash: 'not-a-hash' }, res)), chainKey);
        check(badHash && badHash.status === 'error', 'a contentHash that is not a SHA-256 is rejected');

        const bigMeta = await a.page.evaluate(async k => {
            const ch = window.ecApp.channel;
            const contentHash = await ch.attestHash('big');
            const meta = { blob: 'x'.repeat(5000) };
            return await new Promise(res => ch.attest({ chainKey: k, kind: 'x', contentHash, meta }, res));
        }, chainKey);
        check(bigMeta && bigMeta.status === 'error',
            'meta past the cap is rejected — it is evidence, not storage');

        // ---- 5. prove the verifier can fail --------------------------------
        // If any of these pass verification, every green tick above is noise.
        console.log('\n[5] every field that means something, tampered with in turn');
        const fresh = await listChain(a.page, chainKey);
        const good = fresh.data;

        // Each case names the index it must break at. Asserting only "ok is
        // false" is not enough: a verifier that rejects EVERYTHING passes that,
        // and one did -- signatures were DER while the browser wanted raw
        // r||s, so every chain failed at record 0 and six tamper checks looked
        // green while proving nothing. The index is what tells the two apart.
        const tampers = [
            ['a rewritten contentHash', 1, b => { b.records[1].contentHash = 'a'.repeat(64); }],
            ['a rewritten agent name', 1, b => { b.records[1].stamp.agent = 'SomebodyElse'; }],
            ['a shifted server time', 1, b => { b.records[1].stamp.serverTime = '2020-01-01T00:00:00.000Z'; }],
            ['a doctored chain value', 2, b => { b.records[2].chain = 'b'.repeat(64); }],
            ['a removed record', 1, b => { b.records.splice(1, 1); }],
            ['a reordered pair', 1, b => { const t = b.records[1]; b.records[1] = b.records[2]; b.records[2] = t; }]
        ];

        for (const [label, expectedAt, mutate] of tampers) {
            const copy = JSON.parse(JSON.stringify(good));
            mutate(copy);
            const v = await a.page.evaluate(b => window.AgentConnection.attestVerify(b), copy);
            const caught = v && v.ok === false && v.brokenAt === expectedAt;
            check(caught, `the verifier catches ${label} at record ${expectedAt}`,
                !v ? 'no verdict'
                   : v.ok ? 'ACCEPTED IT — this suite proves nothing'
                   : `broke at ${v.brokenAt}: ${v.reason}`);
        }

        // And the untampered copy still passes, so the failures above are the
        // tampering and not something incidental to the round-trip.
        const control = await a.page.evaluate(b => window.AgentConnection.attestVerify(b),
            JSON.parse(JSON.stringify(good)));
        check(control && control.ok === true,
            'while the untouched chain still verifies — the failures above are the tampering, '
            + 'not a verifier that rejects everything',
            control && control.ok ? `${control.length} records` : (control && control.reason) || 'no verdict');

    } catch (err) {
        console.error('\nTEST THREW:', (err && err.stack) || err);
        check(false, 'the suite ran to the end');
    } finally {
        if (a) { try { await a.ctx.close(); } catch (_) {} }
        await browser.close();
    }

    process.exit(R.report() === 0 ? 0 : 1);
})();
