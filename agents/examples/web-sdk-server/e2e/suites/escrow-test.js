/*
 * Key escrow and the recovery ceremony.
 *
 *     xvfb-run -a node suites/escrow-test.js
 *
 * Encrypted storage where a fumbled key loses the records is a liability. This
 * is the way back in — and the tests are mostly about it NOT being an easy one:
 *
 *   1. both halves open it;
 *   2. either half alone does not, and a wrong half is not told which half was
 *      wrong (that would make one half an oracle for the other);
 *   3. the server is holding ciphertext, checked by reading the stored record
 *      raw and looking for the secret in it;
 *   4. and every seal, recovery and FAILED attempt lands in an Attest chain
 *      that the person who made it cannot edit — because the property being
 *      bought is not "recovery is possible" but "recovery cannot happen
 *      quietly".
 */
const { chromium } = require('playwright');
const { BASE, LAUNCH, results, gotoStable } = require('../lib/harness');

const R = results();
function check(ok, label, extra) {
    console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${extra ? '  — ' + extra : ''}`);
    R.check(ok, label + (extra ? '  — ' + extra : ''));
    return ok;
}

const SECRET = 'the-clinic-channel-password-2026';
const PHRASE = 'seventeen rusty lanterns above the harbour';

(async () => {
    console.log(`\nEscrow E2E — ${BASE}\n`);
    const browser = await chromium.launch(LAUNCH);
    const room = 'escrow-e2e-' + Math.random().toString(36).slice(2, 7);
    let ctx = null;

    try {
        ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
        const page = await ctx.newPage();
        page.setDefaultTimeout(90000);
        page.on('pageerror', e => console.log('  (pageerror) ' + e.message.split('\n')[0].slice(0, 120)));
        await gotoStable(page, `${BASE}/apps/evidence-chain/app.html?debug`,
            { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#usernameInput', { timeout: 45000 });
        await page.fill('#usernameInput', 'Registrar');
        await page.fill('#channelInput', room);
        await page.fill('#passwordInput', 'escrow-pw-1');
        await page.click('#connectBtn');
        await page.waitForFunction(() => window.ecApp && window.ecApp.connected
            && window.ecApp.channel && window.ecApp.channel.sessionId, { timeout: 45000 });

        check(await page.evaluate(() => typeof window.ecApp.channel.escrowSeal === 'function'),
            'the served SDK exposes escrowSeal()');

        // ---- 1. seal ------------------------------------------------------
        console.log('\n[1] sealing');
        const sealed = await page.evaluate(async ([secret, phrase]) => {
            return await window.ecApp.channel.escrowSeal({
                secret, recoveryPhrase: phrase, label: 'clinic channel password'
            });
        }, [SECRET, PHRASE]);
        check(!!sealed.escrowId && !!sealed.ownerShare, 'an escrow is sealed and an owner share issued',
            sealed.escrowId);
        const shareBytes = Buffer.from(sealed.ownerShare, 'base64');
        check(shareBytes.length === 32, 'the owner share is 32 random bytes',
            shareBytes.length + ' bytes');

        // A short phrase is refused. This is half of everything and is
        // attacked offline by anybody holding the other half.
        const shortPhrase = await page.evaluate(async () => {
            try {
                await window.ecApp.channel.escrowSeal({ secret: 'x', recoveryPhrase: 'short' });
                return { threw: false };
            } catch (e) { return { threw: true, message: e.message }; }
        });
        check(shortPhrase.threw, 'a too-short recovery phrase is refused', shortPhrase.message);

        // ---- 2. what the server is holding --------------------------------
        console.log('\n[2] the stored record');
        const stored = await page.evaluate(async (escrowId) => {
            const record = await window.ecApp.channel._escrowFind(escrowId);
            const asText = JSON.stringify(record);
            return {
                found: !!record,
                hasSecret: asText.includes('the-clinic-channel-password'),
                hasPhrase: asText.toLowerCase().includes('lanterns'),
                hasOwnerShare: false,     // filled below
                keys: Object.keys(record || {}),
                label: record && record.label
            };
        }, sealed.escrowId);
        check(stored.found, 'the record is readable by a channel member', stored.keys.join(','));
        check(stored.hasSecret === false && stored.hasPhrase === false,
            'and contains neither the secret nor the phrase — only ciphertext');
        const shareInRecord = await page.evaluate(async ([escrowId, share]) => {
            const record = await window.ecApp.channel._escrowFind(escrowId);
            return JSON.stringify(record).includes(share);
        }, [sealed.escrowId, sealed.ownerShare]);
        check(shareInRecord === false,
            'nor the owner share — it was handed back once and never written down');

        // ---- 3. both halves open it ---------------------------------------
        console.log('\n[3] the ceremony');
        const opened = await page.evaluate(async ([escrowId, phrase, share]) => {
            return await window.ecApp.channel.escrowRecover({
                escrowId, recoveryPhrase: phrase, ownerShare: share
            });
        }, [sealed.escrowId, PHRASE, sealed.ownerShare]);
        check(opened.secret === SECRET, 'both halves recover the exact secret');

        // ---- 4. neither half alone ----------------------------------------
        // Without these, everything above would pass on an escrow that ignored
        // its inputs entirely.
        console.log('\n[4] either half alone is worth nothing');
        const attempts = await page.evaluate(async ([escrowId, phrase, share]) => {
            const ch = window.ecApp.channel;
            const out = {};
            const tryIt = async (name, opts) => {
                try { await ch.escrowRecover(opts); out[name] = 'OPENED'; }
                catch (e) { out[name] = e.message; }
            };
            await tryIt('phraseOnly', { escrowId, recoveryPhrase: phrase,
                ownerShare: btoa(String.fromCharCode(...new Uint8Array(32))) });
            await tryIt('shareOnly', { escrowId, recoveryPhrase: 'not the phrase at all',
                ownerShare: share });
            await tryIt('neither', { escrowId, recoveryPhrase: 'nope nope nope',
                ownerShare: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))) });
            return out;
        }, [sealed.escrowId, PHRASE, sealed.ownerShare]);
        check(attempts.phraseOnly !== 'OPENED', 'the phrase alone does not open it',
            attempts.phraseOnly);
        check(attempts.shareOnly !== 'OPENED', 'the owner share alone does not open it',
            attempts.shareOnly);
        check(attempts.phraseOnly === attempts.shareOnly,
            'and a wrong phrase reads exactly like a wrong share — neither is an oracle for the other',
            attempts.shareOnly);

        // ---- 5. the ceremony is on the record ------------------------------
        console.log('\n[5] recovery cannot happen quietly');
        const history = await page.evaluate(() =>
            new Promise(r => window.ecApp.channel.escrowHistory(r)));
        const records = (history.data && history.data.records) || [];
        const kinds = records.map(r => r.kind);
        check(kinds.filter(k => k === 'escrow-sealed').length >= 1, 'the seal is in the chain');
        check(kinds.filter(k => k === 'escrow-recovered').length === 1,
            'the successful recovery is in the chain', kinds.join(','));
        check(kinds.filter(k => k === 'escrow-recovery-failed').length === 3,
            'and so is every failed attempt — three tries, three receipts',
            kinds.filter(k => k === 'escrow-recovery-failed').length + ' recorded');

        const verdict = await page.evaluate(b => window.AgentConnection.attestVerify(b), history.data);
        check(verdict && verdict.ok === true,
            'the whole ceremony verifies as one unbroken chain',
            verdict && verdict.ok ? verdict.length + ' records' : verdict && verdict.reason);

        // The receipts must not carry what they are receipts ABOUT.
        const leaked = JSON.stringify(records);
        check(!leaked.includes('lanterns') && !leaked.includes('the-clinic-channel-password')
            && !leaked.includes(sealed.ownerShare),
            'and no receipt carries the phrase, the share or the secret');

        // ---- 6. the escrow survives being listed --------------------------
        console.log('\n[6] listing');
        const listed = await page.evaluate(() =>
            new Promise(r => window.ecApp.channel.escrowList(r)));
        const rows = (listed.data && listed.data.escrows) || [];
        const mine = rows.filter(r => r.escrowId === sealed.escrowId)[0];
        check(!!mine && mine.label === 'clinic channel password',
            'the escrow lists with its label and who sealed it',
            mine && mine.sealedBy);
        // Compare against the ACTUAL ciphertext, not the word "sealed" — an
        // earlier version searched for that string and failed on the
        // `sealedBy` field, which is a test bug wearing a finding's clothes.
        const blob = await page.evaluate(async (escrowId) =>
            (await window.ecApp.channel._escrowFind(escrowId)).sealed, sealed.escrowId);
        check(!JSON.stringify(rows).includes(blob),
            'and the listing does not hand out the sealed ciphertext itself',
            blob.slice(0, 12) + '…');

    } catch (err) {
        console.error('\nTEST THREW:', (err && err.stack) || err);
        check(false, 'the suite ran to the end');
    } finally {
        if (ctx) { try { await ctx.close(); } catch (_) {} }
        await browser.close();
    }

    process.exit(R.report() === 0 ? 0 : 1);
})();
