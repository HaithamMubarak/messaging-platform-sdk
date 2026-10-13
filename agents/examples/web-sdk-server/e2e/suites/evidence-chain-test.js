/**
 * Evidence Chain: the demo of the Attest primitive.
 *
 * The suite exists to prove the verifier can FAIL. A chain that always reports
 * "ok" is indistinguishable from a chain that is never checked, so a green run
 * here has to include the verifier catching a break at the right entry — twice,
 * once for an altered entry and once for a removed one.
 *
 * It also proves the log is genuinely in channel storage and the platform
 * chain rather than in the tab that wrote it: the second browser context is
 * created after the first is destroyed, so there is no peer and nothing in
 * memory. Whatever it reads came out of storage and out of attestList.
 *
 * The app moved off its own hand-rolled chain onto attest(), so two things
 * changed here on purpose: sequence numbers are assigned by the server and
 * start at 1 (the app never picks one), and verification now has two halves --
 * the signed chain, and whether each stored note still hashes to its receipt.
 */
const { BASE } = require('../lib/harness');
const { chromium } = require('playwright');
const pass = [], fail = [];
const check = (ok, w) => (ok ? pass : fail).push(w);

async function open(b, room, name) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    const p = await ctx.newPage();
    p.on('pageerror', e => check(false, `${name} threw: ${e.message.split('\n')[0].slice(0, 80)}`));
    await p.goto(BASE + '/apps/evidence-chain/app.html', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#usernameInput', { state: 'attached', timeout: 45000 });
    await p.evaluate(() => document.getElementById('tabCustom')?.click());
    await p.fill('#usernameInput', name);
    await p.fill('#channelInput', room);
    await p.fill('#passwordInput', 'pw12345');
    await p.click('#connectBtn');
    await p.waitForFunction(() => window.ecApp && window.ecApp.connected, { timeout: 45000 })
        .catch(() => {});
    await p.waitForTimeout(3500);
    return p;
}

const verdict = (p) => p.evaluate(() => ({
    state: document.getElementById('verdict').dataset.state,
    title: document.getElementById('verdictTitle').textContent,
    attempts: Number(document.getElementById('scoreAttempts').textContent),
    fooled: Number(document.getElementById('scoreFooled').textContent),
    firstBreak: [...document.querySelectorAll('#entries > li')].findIndex(li => li.classList.contains('ec-entry--first-break'))
}));

const putBack = async (p) => { await p.click('#reloadBtn'); await p.waitForTimeout(2500); };

/** Play each trick through the page's buttons, and expect Verify to catch every one. */
async function challenge(p) {
    await putBack(p);
    const start = await verdict(p);
    await p.click('#verifyBtn');
    let v = await verdict(p);
    check(v.state === 'ok' && v.attempts === start.attempts, 'an untouched log verifies, and is not counted as an attempt');

    const seq1 = await p.evaluate(() => window.ecApp.entries[1].seq);
    await p.click('#entries > li:nth-child(2) button:has-text("Edit")');
    await p.fill('.ec-edit input', 'Nothing was missing. All fine.');
    await p.click('.ec-edit button[type=submit]');
    check(await p.evaluate(() => document.getElementById('trick-edit').classList.contains('is-played')), 'Edit marks its trick as played');
    await p.click('#verifyBtn');
    v = await verdict(p);
    check(v.state === 'caught' && v.firstBreak === 1 && v.title.includes(String(seq1)),
        `an edit made in the page is caught at the entry it changed (${v.state}, li ${v.firstBreak}, "${v.title}")`);
    check(v.attempts === start.attempts + 1, 'and counts as one attempt');

    await putBack(p);
    check((await verdict(p)).state === 'idle', '"Put it back" reads the original and clears the verdict');
    await p.click('#entries > li:nth-child(1) button:has-text("Swap")');
    await p.click('#verifyBtn');
    v = await verdict(p);
    const scope = await p.evaluate(() => window.ecApp.result.scope);
    check(v.state === 'caught' && v.firstBreak === 0 && scope === 'order', `a swap is caught as an order break at the first entry (${scope}, li ${v.firstBreak})`);

    await putBack(p);
    await p.click('#entries > li:nth-child(2) button:has-text("Delete")');
    await p.click('#verifyBtn');
    v = await verdict(p);
    check(v.state === 'caught', 'a delete made in the page is caught');
    const tried = await p.evaluate(() => ['edit', 'delete', 'swap'].every(t => document.getElementById('trick-' + t).classList.contains('is-tried')));
    check(tried && v.fooled === 0, `all three tricks are ticked as tried, and "fooled it" stays 0 (${v.fooled})`);
    await putBack(p);
}

const append = async (p, text) => {
    await p.fill('#note', text);
    await p.click('#appendBtn');
    await p.waitForTimeout(4000);
};

(async () => {
    const b = await chromium.launch({ headless: false,
        args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });

    const room = 'ec' + Math.floor(Date.now() / 1000);
    const ENTRIES = ['meter reading 41892', 'seal intact, photographed', 'handed to the depot at 14:05'];

    let first = null, second = null, third = null;
    try {
        // ---- the core functions, before any UI --------------------------
        first = await open(b, room, 'Recorder');
        check(await first.evaluate(() => !!window.ecApp), 'the app starts');

        const canon = await first.evaluate(() => {
            const C = window.EvidenceChainCore;
            // Same object, keys supplied in a different order, must serialise
            // identically — this is the whole reason re-derivation works.
            return [C.canonical({ b: 1, a: 2 }), C.canonical({ a: 2, b: 1 })];
        });
        check(canon[0] === canon[1], 'canonical() is order-independent, so a hash is reproducible');

        // ---- append -----------------------------------------------------
        for (const e of ENTRIES) await append(first, e);

        const wrote = await first.evaluate(() => window.ecApp.entries.length);
        check(wrote === 3, `three entries appended (${wrote})`);

        const seqs = await first.evaluate(() => window.ecApp.entries.map(e => e.seq));
        check(JSON.stringify(seqs) === '[1,2,3]',
            `the server assigned each append the next sequence, starting at 1 (${seqs})`);

        const distinct = await first.evaluate(() =>
            new Set(window.ecApp.entries.map(e => e.chain)).size);
        check(distinct === 3, 'every entry has its own chain hash');

        const signed = await first.evaluate(() =>
            (window.ecApp.bundle.records || []).every(r => !!r.sig && !!r.kid)
            && (window.ecApp.bundle.publicKeys || []).length > 0);
        check(signed, 'each record is signed, and the key to check it came back with the log');

        await first.context().close();      // nobody is online now
        first = null;

        // ---- it is in storage, not in that tab ---------------------------
        second = await open(b, room, 'Auditor');
        await second.waitForTimeout(2500);

        const read = await second.evaluate(() => window.ecApp.entries.map(e => e.note));
        check(read.length === 3 && read[2] === ENTRIES[2],
            `the log reads back from storage with nobody else online (${read.length})`);

        // ---- an untouched chain verifies ---------------------------------
        const clean = await second.evaluate(() => window.ecApp.verify());
        check(clean.ok === true, 'an untouched chain verifies');
        check(clean.brokenAt === -1, 'and reports no break');

        // ---- ALTER: the verifier must catch it ---------------------------
        await second.evaluate(() => window.ecApp.alter(1));
        const altered = await second.evaluate(() => window.ecApp.verify());
        check(altered.ok === false, 'altering entry 1 is DETECTED — the verifier can fail');
        check(altered.brokenAt === 1, `and it names entry 1 as the first break (got ${altered.brokenAt})`);
        check(altered.expected !== altered.found, 'the re-derived hash differs from the attested one');
        check(altered.scope === 'content',
            `and it is named as a content break, not a chain break (got ${altered.scope})`);

        const flagged = await second.evaluate(() =>
            document.querySelectorAll('.ec-entry--broken').length);
        check(flagged === 2, `the break is shown on entry 1 and everything after it (${flagged})`);

        // ---- storage still holds the original ----------------------------
        await second.evaluate(() => window.ecApp.reload());
        await second.waitForTimeout(3000);
        const restored = await second.evaluate(() => window.ecApp.entries.map(e => e.note));
        check(restored[1] === ENTRIES[1],
            'storage still holds the original — the tamper was only ever local');
        const reclean = await second.evaluate(() => window.ecApp.verify());
        check(reclean.ok === true, 'and the reloaded chain verifies again');

        // ---- REMOVE: a deletion must also be caught ----------------------
        await second.evaluate(() => window.ecApp.remove(1));
        const removed = await second.evaluate(() => window.ecApp.verify());
        check(removed.ok === false, 'removing an entry is DETECTED');
        check(removed.brokenAt === 1,
            `the break is at the entry that moved up into the hole (got ${removed.brokenAt})`);
        check(removed.scope === 'order' || removed.scope === 'count',
            `and the log and its receipts are reported as disagreeing (got ${removed.scope})`);

        // ---- an entry is somebody else's text ----------------------------
        await second.evaluate(() => window.ecApp.reload());
        await second.waitForTimeout(2500);
        await append(second, '<img src=x onerror="window.__x=1">');
        const escaped = await second.evaluate(() =>
            !window.__x && document.querySelectorAll('#entries img').length === 0);
        check(escaped, 'an entry is rendered as text, never as markup');

        // ---- the challenge, played with the page's own controls ----------
        await challenge(second);
        third = await open(b, room + 's', 'Seeder');
        await third.click('#seedBtn');
        await third.waitForFunction(() => window.ecApp.entries.length === 3, null, { timeout: 60000 }).catch(() => {});
        check(await third.evaluate(() => window.ecApp.entries.length) === 3,
            '"Add three example entries" seals three entries in one click');

    } catch (err) {
        console.error('\nTEST THREW:', (err && err.stack) || err);
        check(false, 'the suite ran to the end');
    } finally {
        for (const p of [first, second, third]) {
            if (p) { try { await p.context().close(); } catch (_) {} }
        }
        await b.close();
    }

    console.log('\nPASS (' + pass.length + ')');
    pass.forEach(x => console.log('  ✓ ' + x));
    console.log('\nFAIL (' + fail.length + ')');
    fail.forEach(x => console.log('  ✗ ' + x));
    process.exitCode = fail.length === 0 ? 0 : 1;   // exit() would drop buffered stdout
})();
