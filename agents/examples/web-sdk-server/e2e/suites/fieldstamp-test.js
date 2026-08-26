// ============================================================================
// Fieldstamp — 2-client end-to-end test against the real backend.
//
//   xvfb-run -a --server-args="-screen 0 1280x900x24" node fs-test.js
//
// The chromium fake capture device stands in for a phone camera.
//
// Asserts:
//   1. inspector and capture page join one session
//   2. the camera reaches the inspector peer-to-peer
//   3. a capture round-trips: grabbed on the phone, chunked, re-hashed on the
//      console, and accepted
//   4. the hash chain verifies — AND is proven able to fail, by tampering with
//      a stamp and checking the verifier catches it at the right entry
//   5. a capture whose bytes do not match its published hash is REJECTED
//   6. the evidence log is in storage as separate appended versions
//   7. the exported report carries every hash and the re-derivation recipe
//   8. the capture page only ever hears from the inspector
// ============================================================================

const { chromium } = require('playwright');
const { BASE, LAUNCH_WITH_FAKE_MEDIA, results, gotoStable } = require('../lib/harness');

const INSPECT = BASE + '/apps/fieldstamp/inspect.html?debug';
const CAPTURE = BASE + '/apps/fieldstamp/capture.html?debug';
const ROOM = 'fs-e2e-' + Math.random().toString(36).slice(2, 8);
const PASS = 'inspect-pass-7742';

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
        try { if (await fn()) return true; } catch (_) {}
        await sleep(300);
    }
    console.log(`  (timed out waiting for ${label})`);
    return false;
}

async function open(browser, url, name) {
    const ctx = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        permissions: ['camera', 'microphone', 'geolocation'],
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(60000);
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));

    await gotoStable(page, url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#connectionModal.active', { timeout: 30000 });
    await page.fill('#usernameInput', name);
    await page.fill('#channelInput', ROOM);
    await page.fill('#passwordInput', PASS);
    await page.click('#connectBtn');
    const ok = await waitFor(async () =>
        !(await page.evaluate(() => document.getElementById('connectionModal')?.classList.contains('active'))),
        45000, `${name} to connect`);
    return { page, ctx, errors, connected: ok, name };
}

(async () => {
    console.log(`\nFieldstamp E2E — session ${ROOM}\n`);
    const browser = await chromium.launch(LAUNCH_WITH_FAKE_MEDIA);

    let insp = null, cap = null;
    try {
        // ---- 1. join ---------------------------------------------------
        console.log('[1] the two sides join one session');
        insp = await open(browser, INSPECT, 'Adjuster');
        check(insp.connected, 'inspector console connected');
        await sleep(2500);
        cap = await open(browser, CAPTURE, 'Claimant');
        check(cap.connected, 'capture page connected');

        // Spy on what the capture page receives.
        await cap.page.evaluate(() => {
            const g = window.fsCapture;
            g.__seen = [];
            const orig = g.onDataChannelMessage.bind(g);
            g.onDataChannelMessage = (peer, data) => {
                g.__seen.push({ from: peer, t: data && data.t });
                return orig(peer, data);
            };
        });

        const gotClaimant = await waitFor(async () =>
            await insp.page.evaluate(() => !!window.fsInspector.claimant), 40000, 'the claimant to appear');
        check(gotClaimant, 'inspector sees the claimant',
            await insp.page.evaluate(() => window.fsInspector.claimant || 'none'));

        // ---- 2. camera -------------------------------------------------
        console.log('\n[2] the camera arrives peer-to-peer');
        const camOn = await waitFor(async () =>
            await cap.page.evaluate(() => !!(window.fsCapture.stream && window.fsCapture.stream.getVideoTracks().length)),
            30000, 'the capture page camera');
        check(camOn, 'capture page has a camera');

        const videoUp = await waitFor(async () =>
            await insp.page.evaluate(() => {
                const v = document.getElementById('liveVideo');
                return !!(v && v.srcObject) && document.getElementById('noVideo').hidden;
            }), 60000, 'video on the console');
        check(videoUp, 'inspector is receiving the live stream');

        // ---- 3. capture ------------------------------------------------
        console.log('\n[3] captures round-trip and are verified on arrival');
        await insp.page.selectOption('#templateSelect', 'property');
        await sleep(400);
        const promptCount = await insp.page.evaluate(() => window.fsInspector.prompts.length);
        check(promptCount === 6, 'the property template loaded its prompts', `${promptCount}`);

        for (let i = 0; i < 3; i++) {
            await insp.page.evaluate(n => {
                document.querySelectorAll('.fs-cap')[n].click();
            }, i);
            const got = await waitFor(async () =>
                (await insp.page.evaluate(() => window.fsInspector.entries.length)) === i + 1,
                45000, `capture ${i + 1}`);
            check(got, `capture ${i + 1} accepted`);
            await sleep(600);
        }

        const entries = await insp.page.evaluate(() => window.fsInspector.entries.map(e => ({
            seq: e.seq, prompt: e.stamp.prompt, w: e.stamp.width, h: e.stamp.height,
            bytes: e.stamp.bytes, imageHash: e.imageHash, chain: e.chain, thumb: !!e.thumb,
        })));
        check(entries.length === 3, 'three entries in the log', `${entries.length}`);
        if (entries.length) {
            const e = entries[0];
            check(/^[0-9a-f]{64}$/.test(e.imageHash), 'image hash is a SHA-256', e.imageHash.slice(0, 16) + '…');
            check(/^[0-9a-f]{64}$/.test(e.chain), 'chain hash is a SHA-256', e.chain.slice(0, 16) + '…');
            check(e.w > 0 && e.h > 0 && e.bytes > 1000, 'the still has real dimensions and bytes',
                `${e.w}x${e.h}, ${e.bytes} B`);
            check(!!e.thumb, 'a thumbnail was made');
            check(!!e.prompt, 'the prompt was stamped on it', e.prompt);
        }
        const uniqueChains = new Set(entries.map(e => e.chain)).size;
        check(uniqueChains === entries.length, 'every chain hash is distinct');

        const rejected0 = await insp.page.evaluate(() => window.fsInspector.rejected);
        check(rejected0 === 0, 'nothing was rejected on the happy path', `${rejected0}`);

        // ---- 4. the chain verifies, and can fail -----------------------
        console.log('\n[4] the chain — verified, then deliberately broken');
        await insp.page.click('#verifyBtn');
        await sleep(900);
        let cls = await insp.page.evaluate(() => document.getElementById('verifyResult').className);
        let txt = await insp.page.evaluate(() => document.getElementById('verifyResult').textContent);
        check(/is-ok/.test(cls), 'intact chain verifies', txt.slice(0, 70));

        // Tamper with entry 2's stamp — exactly what the chain exists to catch.
        await insp.page.evaluate(() => {
            window.__savedPrompt = window.fsInspector.entries[1].stamp.prompt;
            window.fsInspector.entries[1].stamp.prompt = 'a completely different room';
        });
        await insp.page.click('#verifyBtn');
        await sleep(900);
        cls = await insp.page.evaluate(() => document.getElementById('verifyResult').className);
        txt = await insp.page.evaluate(() => document.getElementById('verifyResult').textContent);
        check(/is-bad/.test(cls), 'an edited stamp BREAKS the chain', txt.slice(0, 80));
        check(/entry 2/.test(txt), 'and it is caught at the entry that was edited', txt.slice(0, 40));

        // Put it back; the chain must hold again.
        await insp.page.evaluate(() => {
            window.fsInspector.entries[1].stamp.prompt = window.__savedPrompt;
        });
        await insp.page.click('#verifyBtn');
        await sleep(900);
        cls = await insp.page.evaluate(() => document.getElementById('verifyResult').className);
        check(/is-ok/.test(cls), 'restoring the stamp restores the chain');

        // Removing an entry must also be caught.
        await insp.page.evaluate(() => {
            window.__removed = window.fsInspector.entries.splice(1, 1)[0];
        });
        await insp.page.click('#verifyBtn');
        await sleep(900);
        cls = await insp.page.evaluate(() => document.getElementById('verifyResult').className);
        check(/is-bad/.test(cls), 'deleting an entry BREAKS the chain');
        await insp.page.evaluate(() => {
            window.fsInspector.entries.splice(1, 0, window.__removed);
        });

        // ---- 5. a damaged capture is rejected --------------------------
        console.log('\n[5] a photo that did not survive the wire is rejected');
        const rejectedNow = await insp.page.evaluate(async () => {
            const g = window.fsInspector;
            const before = g.rejected;
            // Publish one hash, deliver different bytes.
            g.pending.set('bogus', {
                stamp: { at: Date.now(), time: window.Fieldstamp.stampTime(Date.now()), by: 'Claimant',
                         prompt: 'tampered', width: 10, height: 10, bytes: 10, mime: 'image/jpeg',
                         geo: null, device: window.Fieldstamp.deviceLabel() },
                imageHash: '0'.repeat(64),
                from: 'Claimant',
            });
            await g.acceptCapture('bogus', 'data:image/jpeg;base64,' + btoa('not the photo that was hashed'));
            return { before, after: g.rejected, entries: g.entries.length };
        });
        check(rejectedNow.after === rejectedNow.before + 1, 'the mismatched capture was rejected',
            `rejected ${rejectedNow.before} -> ${rejectedNow.after}`);
        check(rejectedNow.entries === 3, 'and it did not enter the log', `${rejectedNow.entries} entries`);

        // ---- 6. storage holds it as appended versions ------------------
        console.log('\n[6] the log is in storage as separate versions');
        const versions = await insp.page.evaluate(() => new Promise(resolve => {
            const g = window.fsInspector;
            g.channel.storageGetList(g.logKey(), res => {
                // Read it back the way any other client would — through the
                // app's own decoder, so this asserts the decoder too.
                resolve(window.Fieldstamp.storedVersions(res)
                    .map(window.Fieldstamp.decodeStored)
                    .filter(Boolean)
                    .map(c => ({ seq: c.seq, chain: c.chain, hasThumb: !!c.thumb })));
            });
        }));
        check(versions.length >= 3, 'storage holds a version per capture', `${versions.length} versions`);
        check(versions.every(v => v.chain && v.hasThumb), 'each version carries its chain hash and thumbnail');
        const storedChains = new Set(versions.map(v => v.chain));
        const liveChains = await insp.page.evaluate(() => window.fsInspector.entries.map(e => e.chain));
        check(liveChains.every(c => storedChains.has(c)), 'every live entry is in storage');

        // ---- 7. the report ---------------------------------------------
        console.log('\n[7] the exported report');
        const report = await insp.page.evaluate(() => window.fsInspector.buildReport());
        check(report.includes('<!DOCTYPE html>'), 'report is a standalone HTML document');
        check(liveChains.every(c => report.includes(c)), 'every chain hash appears in the report');
        check(/SHA-256\(previous chain hash/.test(report), 'the report explains how to re-derive the chain');
        const imgs = (report.match(/<img src="data:image\/jpeg/g) || []).length;
        check(imgs === 3, 'every photo is embedded at full resolution', `${imgs} images`);
        check(report.includes(ROOM), 'the report names the session');

        // ---- 8. privacy -------------------------------------------------
        console.log('\n[8] the capture page hears only from the inspector');
        const seen = await cap.page.evaluate(() => window.fsCapture.__seen || []);
        const hostName = await cap.page.evaluate(() => window.fsCapture._getHostName());
        check(seen.length > 0, 'the capture page received instructions', `${seen.length} messages`);
        check(seen.every(m => m.from === hostName), 'all of them came from the inspector', hostName);
        console.log(`      kinds: ${[...new Set(seen.map(m => m.t))].join(', ')}`);

        // ---- console ----------------------------------------------------
        console.log('\n[9] console');
        for (const c of [insp, cap]) {
            const bad = c.errors.filter(e => !/favicon|404/.test(e));
            check(bad.length === 0, `${c.name} had no console errors`, bad.slice(0, 2).join(' | '));
        }

    } catch (err) {
        console.error('\nTEST THREW:', err && err.stack || err);
        check(false, 'the suite ran to the end');
    } finally {
        for (const c of [insp, cap]) { if (c) { try { await c.ctx.close(); } catch (_) {} } }
        await browser.close();
    }

    process.exit(R.report() === 0 ? 0 : 1);
})();
