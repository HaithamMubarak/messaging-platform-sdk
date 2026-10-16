/**
 * An append-only log cannot be rewritten by another member of the room.
 *
 * Until 2026-10-15 any session in a channel could put over a key (replacing
 * every version) or erase it, so a guest in Evidence Chain could replace the
 * whole log with one entry of their own. Now the first add with appendOnly
 * locks the key, and the server stamps each version with its writer.
 *
 *  - Ann seals three entries in Evidence Chain (its first add locks the log);
 *  - Mal, in the same room on another browser, puts over the log and then
 *    deletes it: both answer 409 with appendOnly, and Bea still reads three;
 *  - every version names Ann as its writer (writtenBy), whatever it says;
 *  - control: Mal's put on a key nobody locked still succeeds, so the 409 is
 *    the lock and not a failure of any put from Mal.
 *
 * Needs messaging-service with storage-authors (V22). Channels are
 * 'stl<time>'; clean up with
 *   scripts/cleanup_channels.py --prefix '^stl[0-9]+' --yes
 */
const { BASE, LAUNCH, results } = require('../lib/harness');
const { chromium } = require('playwright');
const { useChannelForm } = require('../lib/party-room');

const r = results();
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const game = (p, expr) => p.evaluate(new Function('return (' + expr + ');'));
const ROOM = 'stl' + Math.floor(Date.now() / 1000);
const LOG = 'evidence_chain_log';

async function waitFor(p, expr, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await game(p, expr)) return true; await sleep(200); }
    return false;
}

async function join(b, name, errors) {
    const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    p.on('pageerror', (e) => errors.push(name + ': ' + e.message.split('\n')[0]));
    await p.goto(BASE + '/apps/evidence-chain/app.html', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#connectionModal.active', { timeout: 45000 });
    await useChannelForm(p);
    await p.evaluate(() => document.getElementById('tabCustom')?.click());
    await p.fill('#usernameInput', name);
    await p.fill('#channelInput', ROOM);
    await p.fill('#passwordInput', 'pw12345');
    await p.click('#connectBtn');
    await waitFor(p, 'window.ecApp && ecApp.connected', 45000);
    await sleep(3500);
    return p;
}

/** Run one storage call on a page's own channel; resolves its callback result. */
const call = (p, method, args) => p.evaluate(({ method, args }) => new Promise((res) =>
    ecApp.channel[method](...args, (x) => res({ status: x.status, httpStatus: x.httpStatus,
        appendOnly: x.appendOnly, data: typeof x.data === 'string' ? x.data : null }))), { method, args });

async function lockedLog(ann, bea, mal) {
    await ann.evaluate(() => ecApp.seedExamples());
    r.check(await waitFor(bea, 'ecApp.entries.length === 3', 15000), "Ann's three entries reach Bea");

    const put = await call(mal, 'storagePut', [{ storageKey: LOG, content: JSON.stringify({ seq: 1, note: 'forged' }) }]);
    r.check(put.httpStatus === 409 && put.appendOnly === true,
        `Mal's put over the log answers 409, appendOnly (${JSON.stringify(put)})`);
    const del = await call(mal, 'storageDeleteByKey', [LOG]);
    r.check(del.httpStatus === 409 && del.appendOnly === true,
        `Mal's delete of the log answers 409, appendOnly (${JSON.stringify(del)})`);

    const rows = await bea.evaluate((k) => ecApp.channel.storageReadEntries(k), LOG);
    r.check(rows.length === 3 && rows.every((e) => e.appendOnly),
        `the log still holds Ann's three versions, all locked (${rows.length})`);
    r.check(rows.every((e) => e.writtenBy === 'Ann'),
        `every version names Ann as its writer (${rows.map((e) => e.writtenBy).join(',')})`);

    const control = await call(mal, 'storagePut', [{ storageKey: 'stl-scratch', content: 'mine' }]);
    r.check(control.status === 'success', `control: Mal's put on an unlocked key succeeds (${JSON.stringify(control)})`);
}

(async () => {
    const b = await chromium.launch(LAUNCH);
    const errors = [];
    try {
        const ann = await join(b, 'Ann', errors);
        const bea = await join(b, 'Bea', errors);
        const mal = await join(b, 'Mal', errors);
        await lockedLog(ann, bea, mal);
    } catch (err) {
        r.check(false, 'the suite ran to the end: ' + (err && err.message));
    }
    r.check(errors.length === 0, 'no page errors ' + errors.slice(0, 2).join(' | '));
    console.log('room: ' + ROOM);
    await b.close();
    process.exitCode = r.report() ? 1 : 0;
})();
