/*
 * DiskSink: receiving a transfer to disk instead of to memory.
 *
 *     xvfb-run -a node suites/disk-sink-test.js
 *
 * Drop Pro's 1.5 GB ceiling is what happens when the only place to put arriving
 * bytes is an array. The claim here is that OPFS is the other place, and the
 * two assertions that actually test it are:
 *
 *   1. bytes written before a RELOAD are still there afterwards — that is what
 *      makes resume real rather than a variable that survived because nothing
 *      interrupted it;
 *   2. finish() hands back a File, not an ArrayBuffer — returning bytes would
 *      put the whole transfer back in memory and undo the entire point.
 *
 * It deliberately does NOT assert "memory stayed low". performance.memory is
 * unreliable, quantised and absent outside Chrome, and a test that watched it
 * would fail for reasons unrelated to the code.
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
    console.log(`\nDiskSink E2E — ${BASE}\n`);
    const browser = await chromium.launch(LAUNCH);
    let ctx = null;

    try {
        ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
        const page = await ctx.newPage();
        page.setDefaultTimeout(90000);
        page.on('pageerror', e => console.log('  (pageerror) ' + e.message.split('\n')[0].slice(0, 120)));
        // Any page that loads the SDK. No channel needed: a disk sink is local.
        await gotoStable(page, `${BASE}/apps/evidence-chain/app.html?debug`,
            { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.AgentConnection, { timeout: 45000 });

        check(await page.evaluate(() => typeof window.AgentConnection.diskSink === 'function'),
            'the served SDK exposes AgentConnection.diskSink');

        const supported = await page.evaluate(async () => !!(await window.AgentConnection.diskSink(
            { name: 'probe.bin', resume: false })));
        if (!check(supported, 'OPFS is available in this browser')) {
            throw new Error('no OPFS — the rest of this suite would prove nothing');
        }

        // ---- 1. write more than a transfer would hold comfortably ----------
        console.log('\n[1] 8 MB in 1 MB chunks');
        const written = await page.evaluate(async () => {
            const sink = await window.AgentConnection.diskSink({ name: 'movie.bin', resume: false });
            const CHUNK = 1024 * 1024;
            for (let i = 0; i < 8; i++) {
                const chunk = new Uint8Array(CHUNK);
                // A per-chunk marker, so a mis-ordered write is visible later
                // rather than merely "some bytes differ".
                chunk.fill(i + 1);
                await sink.write(chunk);
            }
            const file = await sink.finish();
            return { size: file.size, isFile: file instanceof File, name: file.name };
        });
        check(written.size === 8 * 1024 * 1024, 'all 8 MB landed', written.size + ' bytes');
        check(written.isFile === true,
            'finish() hands back a File, not the bytes — the transfer never returns to memory',
            written.name);

        // ---- 2. the content is right, and in order -------------------------
        console.log('\n[2] and in the right order');
        const verified = await page.evaluate(async () => {
            const sink = await window.AgentConnection.diskSink({ name: 'movie.bin' });
            const file = await sink.finish();
            const CHUNK = 1024 * 1024;
            const marks = [];
            for (let i = 0; i < 8; i++) {
                const slice = new Uint8Array(await file.slice(i * CHUNK, i * CHUNK + 4).arrayBuffer());
                marks.push(slice[0]);
            }
            return marks;
        });
        check(JSON.stringify(verified) === JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8]),
            'each chunk is where it was written', verified.join(','));

        // ---- 3. out-of-order writes ----------------------------------------
        console.log('\n[3] chunks that arrive out of order');
        const sparse = await page.evaluate(async () => {
            const sink = await window.AgentConnection.diskSink({ name: 'sparse.bin', resume: false });
            const CHUNK = 64 * 1024;
            // Write the LAST chunk first, as a parallel transfer would.
            await sink.writeAt(3 * CHUNK, new Uint8Array(CHUNK).fill(4));
            await sink.writeAt(0, new Uint8Array(CHUNK).fill(1));
            await sink.writeAt(CHUNK, new Uint8Array(CHUNK).fill(2));
            await sink.writeAt(2 * CHUNK, new Uint8Array(CHUNK).fill(3));
            const file = await sink.finish();
            const marks = [];
            for (let i = 0; i < 4; i++) {
                marks.push(new Uint8Array(await file.slice(i * CHUNK, i * CHUNK + 1).arrayBuffer())[0]);
            }
            return { size: file.size, marks };
        });
        check(sparse.size === 4 * 64 * 1024 && JSON.stringify(sparse.marks) === '[1,2,3,4]',
            'writing at explicit offsets puts every chunk in its place',
            sparse.marks.join(','));

        // ---- 4. THE point: it survives the page ----------------------------
        // A `written` counter that survives because nothing interrupted it
        // proves nothing. Reloading the page is the interruption.
        console.log('\n[4] a reload is what resume has to survive');
        await page.evaluate(async () => {
            const sink = await window.AgentConnection.diskSink({ name: 'resumable.bin', resume: false });
            await sink.write(new Uint8Array(3 * 1024 * 1024).fill(9));
        });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.AgentConnection, { timeout: 45000 });

        const afterReload = await page.evaluate(async () => {
            const sink = await window.AgentConnection.diskSink({ name: 'resumable.bin' });
            const before = sink.written;
            await sink.write(new Uint8Array(1024 * 1024).fill(7));
            const file = await sink.finish();
            const tail = new Uint8Array(await file.slice(3 * 1024 * 1024, 3 * 1024 * 1024 + 1).arrayBuffer());
            return { before, after: file.size, tailMark: tail[0] };
        });
        check(afterReload.before === 3 * 1024 * 1024,
            'what arrived before the reload is still on disk',
            afterReload.before + ' bytes');
        check(afterReload.after === 4 * 1024 * 1024 && afterReload.tailMark === 7,
            'and the transfer continues from exactly there',
            afterReload.after + ' bytes');

        // ---- 5. a fresh sink truncates -------------------------------------
        // The mirror of the above, and the bug it prevents: appending to stale
        // bytes looks like corruption a long way from its cause.
        console.log('\n[5] resume:false starts over');
        const fresh = await page.evaluate(async () => {
            const sink = await window.AgentConnection.diskSink({ name: 'resumable.bin', resume: false });
            return { written: sink.written, size: await sink.size() };
        });
        check(fresh.written === 0 && fresh.size === 0,
            'a sink opened with resume:false is empty, not appended to',
            fresh.size + ' bytes');

        // ---- 6. listing and discarding --------------------------------------
        console.log('\n[6] what is being held, and letting go of it');
        const listed = await page.evaluate(() => window.AgentConnection.diskSinkList());
        check(Array.isArray(listed) && listed.some(f => f.name === 'movie.bin'),
            'part-finished transfers can be listed',
            listed.map(f => f.name + ':' + f.size).join(' '));

        const discarded = await page.evaluate(async () => {
            const sink = await window.AgentConnection.diskSink({ name: 'movie.bin' });
            const ok = await sink.discard();
            const after = await window.AgentConnection.diskSinkList();
            return { ok, stillThere: after.some(f => f.name === 'movie.bin') };
        });
        check(discarded.ok && discarded.stillThere === false,
            'and discarding one actually removes the file');

    } catch (err) {
        console.error('\nTEST THREW:', (err && err.stack) || err);
        check(false, 'the suite ran to the end');
    } finally {
        if (ctx) { try { await ctx.close(); } catch (_) {} }
        await browser.close();
    }

    process.exit(R.report() === 0 ? 0 : 1);
})();
