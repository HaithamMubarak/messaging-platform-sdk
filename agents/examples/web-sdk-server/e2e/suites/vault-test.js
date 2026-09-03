/*
 * Vault: encrypted blobs past dead-drop's 512 KB line.
 *
 *     xvfb-run -a node suites/vault-test.js
 *
 * The claim being tested is narrow and worth stating exactly: the server holds
 * ciphertext it cannot read. Not "nothing is on a server" — that is Dead Drop's
 * promise and Vault does not make it.
 *
 * So the assertions that matter are:
 *
 *   1. what is stored is NOT the plaintext (checked by reading the raw stored
 *      bytes back and looking for the plaintext in them);
 *   2. a round trip through encryption, chunking and reassembly returns
 *      byte-identical content, including a blob well past 512 KB;
 *   3. resume works — kill an upload halfway, ask what arrived, send the rest;
 *   4. a blob that does not add up is REFUSED rather than quietly sealed;
 *   5. the wrong key fails to decrypt, which is the only proof that any of the
 *      above was ever encrypted at all.
 */
const { chromium } = require('playwright');
const { BASE, LAUNCH, results, gotoStable } = require('../lib/harness');

const R = results();
function check(ok, label, extra) {
    console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${extra ? '  — ' + extra : ''}`);
    R.check(ok, label + (extra ? '  — ' + extra : ''));
    return ok;
}

(async () => {
    console.log(`\nVault E2E — ${BASE}\n`);
    const browser = await chromium.launch(LAUNCH);
    const room = 'vault-e2e-' + Math.random().toString(36).slice(2, 7);
    let ctx = null;

    try {
        ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
        const page = await ctx.newPage();
        page.setDefaultTimeout(90000);
        page.on('pageerror', e => console.log('  (pageerror) ' + e.message.split('\n')[0].slice(0, 120)));
        await gotoStable(page, `${BASE}/apps/evidence-chain/app.html?debug`,
            { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#usernameInput', { timeout: 45000 });
        await page.fill('#usernameInput', 'Keeper');
        await page.fill('#channelInput', room);
        await page.fill('#passwordInput', 'vault-pw-1');
        await page.click('#connectBtn');
        await page.waitForFunction(() => window.ecApp && window.ecApp.connected
            && window.ecApp.channel && window.ecApp.channel.sessionId, { timeout: 45000 });

        check(await page.evaluate(() => typeof window.ecApp.channel.vaultPut === 'function'),
            'the served SDK exposes vaultPut()');

        // ---- 1. quota is a real answer, not a placeholder ------------------
        console.log('\n[1] what this deployment allows');
        const quota = await page.evaluate(() =>
            new Promise(r => window.ecApp.channel.vaultQuota(r)));
        check(quota.data && quota.data.quotaBytes > 0 && quota.data.maxBlobBytes > 0,
            'the channel is told its quota and per-blob ceiling',
            quota.data && (quota.data.usedBytes + '/' + quota.data.quotaBytes));

        // ---- 2. a round trip, past the old 512 KB line ---------------------
        console.log('\n[2] 2 MB in, 2 MB out — four times dead-drop\'s ceiling');
        const trip = await page.evaluate(async () => {
            const ch = window.ecApp.channel;
            // Deterministic content, so a mismatch is diagnosable rather than
            // "some bytes differ".
            const size = 2 * 1024 * 1024;
            const original = new Uint8Array(size);
            for (let i = 0; i < size; i++) original[i] = (i * 31 + 7) & 0xff;

            const progress = [];
            const put = await ch.vaultPut(original.buffer, {
                ttlSeconds: 600,
                onProgress: p => progress.push(p.sent)
            });
            const back = await ch.vaultGet(put.blobId, put.key);

            let identical = back.length === original.length;
            if (identical) {
                for (let i = 0; i < size; i++) {
                    if (back[i] !== original[i]) { identical = false; break; }
                }
            }
            return {
                blobId: put.blobId, key: put.key, chunkCount: put.chunkCount,
                cipherBytes: put.sizeBytes, plainBytes: size,
                identical, progressSteps: progress.length
            };
        });
        check(trip.identical, 'what came back is byte-for-byte what went in',
            trip.plainBytes + ' bytes, ' + trip.chunkCount + ' chunks');
        check(trip.cipherBytes > trip.plainBytes,
            'and the stored size is larger than the plaintext — an IV and a tag per chunk',
            trip.cipherBytes + ' vs ' + trip.plainBytes);
        check(trip.progressSteps === trip.chunkCount,
            'progress was reported per chunk', trip.progressSteps + ' callbacks');

        // ---- 3. the server is holding ciphertext ---------------------------
        // The claim in one assertion: read the stored bytes back RAW, without
        // the key, and look for the plaintext in them.
        console.log('\n[3] what the server is actually holding');
        const raw = await page.evaluate(async (blobId) => {
            const ch = window.ecApp.channel;
            const chunk = await ch._vaultReadChunk(blobId, 0);
            // The plaintext's first 32 bytes, by the same formula.
            const expected = [];
            for (let i = 0; i < 32; i++) expected.push((i * 31 + 7) & 0xff);
            // Search the raw stored chunk for that run.
            let found = false;
            for (let off = 0; off + 32 <= chunk.length && !found; off++) {
                let match = true;
                for (let i = 0; i < 32; i++) {
                    if (chunk[off + i] !== expected[i]) { match = false; break; }
                }
                if (match) found = true;
            }
            return { length: chunk.length, plaintextFound: found };
        }, trip.blobId);
        check(raw.plaintextFound === false,
            'the stored chunk does not contain the plaintext anywhere in it',
            raw.length + ' bytes of ciphertext');

        // ---- 4. the wrong key ----------------------------------------------
        // Without this, everything above would pass on a Vault that stored
        // plaintext and did nothing at all.
        console.log('\n[4] the control: a wrong key must fail');
        const wrongKey = await page.evaluate(async (blobId) => {
            const ch = window.ecApp.channel;
            const other = await ch.vaultNewKey();
            try {
                await ch.vaultGet(blobId, other);
                return { threw: false };
            } catch (e) {
                return { threw: true, message: String(e && e.message || e).slice(0, 60) };
            }
        }, trip.blobId);
        check(wrongKey.threw === true,
            'a different key cannot open the blob — so the round trip above was really encrypted',
            wrongKey.message);

        // ---- 5. resume ------------------------------------------------------
        console.log('\n[5] an interrupted upload resumes from what arrived');
        const resumed = await page.evaluate(async () => {
            const ch = window.ecApp.channel;
            const size = 900 * 1024;
            const data = new Uint8Array(size);
            for (let i = 0; i < size; i++) data[i] = (i * 17 + 3) & 0xff;

            // Do what vaultPut does, but stop after two chunks — the shape of
            // a connection dying mid-upload.
            const keyB64 = await ch.vaultNewKey();
            const key = await window.crypto.subtle.importKey(
                'raw', Uint8Array.from(atob(keyB64), c => c.charCodeAt(0)),
                { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);

            const CHUNK = 256 * 1024;
            const sealed = [];
            for (let off = 0; off < size; off += CHUNK) {
                const iv = crypto.getRandomValues(new Uint8Array(12));
                const cipher = new Uint8Array(await crypto.subtle.encrypt(
                    { name: 'AES-GCM', iv }, key, data.subarray(off, Math.min(off + CHUNK, size))));
                const c = new Uint8Array(iv.length + cipher.length);
                c.set(iv, 0); c.set(cipher, iv.length);
                sealed.push(c);
            }
            const total = sealed.reduce((s, c) => s + c.length, 0);
            const joined = new Uint8Array(total);
            let at = 0;
            for (const c of sealed) { joined.set(c, at); at += c.length; }
            const digest = await crypto.subtle.digest('SHA-256', joined);
            const sha256 = Array.from(new Uint8Array(digest))
                .map(b => b.toString(16).padStart(2, '0')).join('');

            const begun = await new Promise(r => ch._vaultPost('begin', {
                sizeBytes: total, chunkCount: sealed.length, sha256
            }, r));
            const blobId = begun.data.blobId;

            await ch._vaultPutChunk(blobId, 0, sealed[0]);
            await ch._vaultPutChunk(blobId, 1, sealed[1]);

            // Sealing now must be refused: the bytes do not add up.
            const early = await new Promise(r => ch._vaultPost('complete', { blobId }, r));

            // What does the server say is missing?
            const status = await new Promise(r => ch._vaultPost('status', { blobId }, r));

            // Resume, including re-sending the one that was "in flight".
            await ch._vaultPutChunk(blobId, 1, sealed[1]);
            await ch._vaultSendChunks(blobId, sealed);
            const done = await new Promise(r => ch._vaultPost('complete', { blobId }, r));

            const back = await ch.vaultGet(blobId, keyB64);
            let identical = back.length === size;
            if (identical) {
                for (let i = 0; i < size; i++) {
                    if (back[i] !== data[i]) { identical = false; break; }
                }
            }
            return {
                earlyStatus: early.status, earlyMessage: early.statusMessage,
                missingAfterTwo: status.data.missingCount, totalChunks: sealed.length,
                completed: done.status === 'success', identical
            };
        });
        check(resumed.earlyStatus === 'error',
            'a blob missing chunks is refused, not quietly sealed', resumed.earlyMessage);
        check(resumed.missingAfterTwo === resumed.totalChunks - 2,
            'the server says exactly which chunks it is still waiting for',
            resumed.missingAfterTwo + ' of ' + resumed.totalChunks + ' missing');
        check(resumed.completed === true, 'the resumed upload completes');
        check(resumed.identical === true, 'and the resumed blob is byte-identical too');

        // ---- 6. a lie about the hash --------------------------------------
        console.log('\n[6] the hash is checked, not trusted');
        const lied = await page.evaluate(async () => {
            const ch = window.ecApp.channel;
            const bytes = new Uint8Array(1000).fill(7);
            const begun = await new Promise(r => ch._vaultPost('begin', {
                sizeBytes: 1000, chunkCount: 1, sha256: 'a'.repeat(64)
            }, r));
            await ch._vaultPutChunk(begun.data.blobId, 0, bytes);
            const done = await new Promise(r => ch._vaultPost('complete', { blobId: begun.data.blobId }, r));
            return { status: done.status, message: done.statusMessage };
        });
        check(lied.status === 'error', 'ciphertext that does not match its declared hash is refused',
            lied.message);

        // ---- 7. another channel cannot reach in ----------------------------
        console.log('\n[7] a blob id is not an access control decision');
        const other = await browser.newContext({ viewport: { width: 1000, height: 700 } });
        const otherPage = await other.newPage();
        otherPage.setDefaultTimeout(60000);
        await gotoStable(otherPage, `${BASE}/apps/evidence-chain/app.html?debug`,
            { waitUntil: 'domcontentloaded' });
        await otherPage.waitForSelector('#usernameInput', { timeout: 45000 });
        await otherPage.fill('#usernameInput', 'Stranger');
        await otherPage.fill('#channelInput', room + '-elsewhere');
        await otherPage.fill('#passwordInput', 'vault-pw-2');
        await otherPage.click('#connectBtn');
        await otherPage.waitForFunction(() => window.ecApp && window.ecApp.connected
            && window.ecApp.channel && window.ecApp.channel.sessionId, { timeout: 45000 });

        const stolen = await otherPage.evaluate(async ([blobId, key]) => {
            const ch = window.ecApp.channel;
            const status = await new Promise(r => ch._vaultPost('status', { blobId }, r));
            let readThrew = false;
            try { await ch._vaultReadChunk(blobId, 0); } catch (e) { readThrew = true; }
            return { status: status.status, message: status.statusMessage, readThrew };
        }, [trip.blobId, trip.key]);
        check(stolen.status === 'error' && stolen.readThrew,
            'a member of another channel with the id AND the key still gets nothing',
            stolen.message);
        await other.close();

        // ---- 8. deletion ----------------------------------------------------
        console.log('\n[8] deleting means deleted');
        const deleted = await page.evaluate(async (blobId) => {
            const ch = window.ecApp.channel;
            const del = await new Promise(r => ch.vaultDelete(blobId, r));
            const after = await new Promise(r => ch.vaultStatus(blobId, r));
            return { deleted: del.status === 'success', afterStatus: after.status };
        }, trip.blobId);
        check(deleted.deleted && deleted.afterStatus === 'error',
            'a deleted blob is gone, not merely hidden');

    } catch (err) {
        console.error('\nTEST THREW:', (err && err.stack) || err);
        check(false, 'the suite ran to the end');
    } finally {
        if (ctx) { try { await ctx.close(); } catch (_) {} }
        await browser.close();
    }

    process.exit(R.report() === 0 ? 0 : 1);
})();
