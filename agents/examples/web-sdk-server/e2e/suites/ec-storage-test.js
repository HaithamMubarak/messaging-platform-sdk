/**
 * Channel storage between two people, on Evidence Chain's own connection.
 *
 * The site's only two-client check of plain storage drove Pulse's Raw storage
 * tab (undriven-test), and went when Pulse was removed on 2026-10-18. This is
 * that promise again, plus what Evidence Chain adds on top of it:
 *  - Ann puts a value and Bea reads exactly it; Ann replaces it and Bea reads
 *    the new one; Bea deletes it and Ann reads nothing (a key nobody wrote is
 *    the control: it reads as nothing, so a read cannot pass on junk);
 *  - an entry Ann seals in the app is in Bea's read of the log, stamped by the
 *    SERVER as written by Ann (writtenBy), not by anything inside the entry;
 *  - the log is append-only: Bea's put and delete on it are refused, and
 *    Ann's entry is still there.
 *
 * Channels are 'ecs<time>'; clean up with
 *   scripts/cleanup_channels.py --prefix '^ecs[0-9]+' --yes
 */
const { BASE, LAUNCH, results } = require('../lib/harness');
const { chromium } = require('playwright');
const { useChannelForm } = require('../lib/party-room');

const r = results();
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const ROOM = 'ecs' + Math.floor(Date.now() / 1000);
const LOG = 'evidence_chain_log';

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
    const ok = await p.waitForFunction(() => window.ecApp && ecApp.connected, null, { timeout: 45000 }).then(() => true, () => false);
    r.check(ok, name + ' joins the room');
    await sleep(2500);
    return p;
}

// The SDK's own calls on the page's connection, as a developer would make them.
const put = (p, key, content) => p.evaluate(({ key, content }) => new Promise((res) =>
    ecApp.channel.storagePut({ storageKey: key, content }, (x) => res({ status: x && x.status, appendOnly: !!(x && x.appendOnly) }))), { key, content });
const read = (p, key) => p.evaluate((key) => ecApp.channel.storageRead(key).then((v) => v, (e) => 'ERROR ' + e.message), key);
const del = (p, key) => p.evaluate((key) => new Promise((res) =>
    ecApp.channel.storageDeleteByKey(key, (x) => res({ status: x && x.status, appendOnly: !!(x && x.appendOnly) }))), key);

async function plainStorage(ann, bea) {
    const KEY = 'scratch-' + Math.floor(Math.random() * 1e6);
    r.check(await read(bea, KEY) === null, `control: a key nobody wrote reads as nothing (${KEY})`);
    const w = await put(ann, KEY, { written: 'by Ann', n: 42 });
    r.check(w.status === 'success', `Ann's put is accepted (${w.status})`);
    const got = await read(bea, KEY);
    r.check(got && got.written === 'by Ann' && got.n === 42, `Bea reads exactly what Ann wrote (${JSON.stringify(got)})`);
    await put(ann, KEY, { written: 'by Ann, again', n: 43 });
    const again = await read(bea, KEY);
    r.check(again && again.n === 43, `a second put replaces it, for Bea too (${JSON.stringify(again)})`);
    const d = await del(bea, KEY);
    r.check(d.status === 'success', `Bea can delete it (${d.status})`);
    const gone = await read(ann, KEY);
    r.check(gone === null, `and Ann reads nothing there now (${JSON.stringify(gone)})`);
}

async function theLog(ann, bea) {
    const text = 'Storage check ' + Date.now() + ': gate locked.';
    await ann.evaluate((t) => ecApp.append(t), text);
    await sleep(2500);
    const entries = await bea.evaluate((k) => ecApp.channel.storageReadEntries(k).then((es) => es.map((e) => ({
        note: (() => { try { return JSON.parse(e.value).note; } catch (_) { return e.value && e.value.note; } })(), by: e.writtenBy, locked: e.appendOnly }))), LOG);
    const mine = entries.find((e) => e.note === text);
    r.check(!!mine, `an entry Ann seals is in Bea's read of the log (${entries.length} versions)`);
    r.check(mine && mine.by === 'Ann', `stamped by the server as written by Ann (${mine && mine.by})`);
    r.check(mine && mine.locked, 'and the log is append-only');
    const p = await put(bea, LOG, { seq: 1, note: 'rewritten by Bea' });
    r.check(p.status !== 'success' && p.appendOnly, `Bea cannot overwrite the log (${p.status}, appendOnly ${p.appendOnly})`);
    const d = await del(bea, LOG);
    r.check(d.status !== 'success' && d.appendOnly, `nor delete it (${d.status}, appendOnly ${d.appendOnly})`);
    const still = await ann.evaluate((k) => ecApp.channel.storageReadEntries(k).then((es) => es.length), LOG);
    r.check(still === entries.length, `and Ann's entries are all still there (${still})`);
}

(async () => {
    const b = await chromium.launch(LAUNCH);
    const errors = [];
    try {
        const ann = await join(b, 'Ann', errors);
        const bea = await join(b, 'Bea', errors);
        await plainStorage(ann, bea);
        await theLog(ann, bea);
    } catch (err) {
        r.check(false, 'the suite ran to the end: ' + (err && err.message));
    }
    r.check(errors.length === 0, 'no page errors ' + errors.slice(0, 2).join(' | '));
    console.log('room: ' + ROOM);
    await b.close();
    process.exitCode = r.report() ? 1 : 0;
})();
