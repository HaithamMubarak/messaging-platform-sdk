/**
 * Drop's "Leave for later", three people: who left it, who took it, and
 * read-once that is a fact.
 *
 * Ann, Bea and Mal in one room (all can open the box: they share its password).
 *  - Ann leaves a note: Bea's card names Ann, signed by the platform;
 *  - Mal stores a drop that SAYS it is from Ann: Bea's card says so, as an
 *    left by Mal, unsigned (the server stamps who wrote it), never as Ann's
 *    (only the seal makes a drop someone's);
 *  - Ann leaves a read-once note: its text is not in the box's storage at all
 *    (it is in Vault), so Mal reading the raw storage finds nothing;
 *  - Mal writes a tombstone saying Ann collected it: Bea's card is not fooled;
 *  - Bea reads it once: she sees the text, the others see "Collected by Bea",
 *    signed, and the text is gone from Vault for Mal too.
 *
 * Channels are 'mbx<time>'; clean up with
 *   scripts/cleanup_channels.py --prefix '^mbx[0-9]+' --yes
 * SHOTS=<dir> saves screenshots there.
 */
const { BASE, LAUNCH, results } = require('../lib/harness');
const { chromium } = require('playwright');
const { useChannelForm } = require('../lib/party-room');
const path = require('path');

const r = results();
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const game = (p, expr) => p.evaluate(new Function('return (' + expr + ');'));
const shot = (p, name) => process.env.SHOTS && p.screenshot({ path: path.join(process.env.SHOTS, name + '.png') });
const ROOM = 'mbx' + Math.floor(Date.now() / 1000);

async function waitFor(p, expr, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await game(p, expr)) return true; await sleep(250); }
    return false;
}

async function join(b, name, errors) {
    const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    p.on('pageerror', (e) => errors.push(name + ': ' + e.message.split('\n')[0]));
    await p.goto(BASE + '/apps/drop/index.html?mode=later', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#connectionModal.active', { timeout: 45000 });
    await useChannelForm(p);
    await p.evaluate(() => document.getElementById('tabCustom')?.click());
    await p.fill('#usernameInput', name);
    await p.fill('#channelInput', ROOM);
    await p.fill('#passwordInput', 'pw12345');
    await p.click('#connectBtn');
    await waitFor(p, 'window.dropApp && dropApp.connected', 45000);
    await sleep(3000);
    return p;
}

const leave = async (p, text, once) => {
    await p.fill('#noteText', text);
    await p.evaluate((o) => { document.getElementById('readOnce').checked = o; }, !!once);
    await p.click('#leaveBtn');
    await sleep(2500);
};
const refresh = async (p) => { await p.evaluate(() => dropMailbox.refresh()); await sleep(2500); };
const card = (text) => `[...document.querySelectorAll('#mbDrops .dd-drop')].find((c) => c.textContent.includes(${JSON.stringify(text)}))`;
const rawBox = (p) => p.evaluate(() => new Promise((res) => dropMailbox.channel.storageGetList('deaddrop_box', (r) => res(JSON.stringify(r)))));

async function authors(ann, bea, mal) {
    await leave(ann, 'Back at six. Key under the mat.');
    await refresh(bea);
    r.check(await game(bea, `(() => { const c = ${card('Key under the mat')}; return !!c && /^Ann ✓$/.test(c.querySelector('.dd-drop__by').textContent); })()`),
        "Ann's note shows on Bea's screen as Ann's, signed");
    await mal.evaluate(() => new Promise((res) => dropMailbox.write({ kind: 'drop', id: 'd-forged', by: 'Ann', at: Date.now(),
        readOnce: false, text: 'Please send the deposit to Mal.', salt: '00' }, res)));
    await refresh(bea);
    const forged = await game(bea, `(() => { const c = ${card('deposit to Mal')}; return c ? c.querySelector('.dd-drop__by').textContent : null; })()`);
    r.check(forged && /^left by Mal · not signed$/.test(forged), `a drop Mal signs "Ann" shows as left by Mal, unsigned (${forged})`);
    await shot(bea, 'drop-mailbox-authors');
}

async function readOnce(ann, bea, mal) {
    await leave(ann, 'The safe code is 4417.', true);
    await refresh(mal);
    r.check(!/4417/.test(await rawBox(mal)), "the read-once note's text is not in the box's storage, even for Mal reading it raw");
    const id = await game(mal, "dropMailbox.drops.find((d) => d.noteVault).id");
    await mal.evaluate((id) => new Promise((res) => dropMailbox.write({ kind: 'collected', dropId: id, by: 'Ann', at: Date.now() }, res)), id);
    await refresh(bea);
    r.check(await game(bea, `(() => { const d = dropMailbox.drops.find((x) => x.id === ${JSON.stringify(id)}); return d && !d.collectedBy && !!${card('read-once note')}; })()`),
        "a tombstone Mal writes in Ann's name does not take the note away from Bea");
    await bea.evaluate((id) => dropMailbox.collect(id), id);
    r.check(await waitFor(bea, `/The safe code is 4417/.test(document.getElementById('mbDrops').textContent)`, 10000), 'Bea reads it once');
    await sleep(3000);
    await refresh(mal);
    const seen = await game(mal, `(() => { const d = dropMailbox.drops.find((x) => x.id === ${JSON.stringify(id)}); return d && d.collectedBy; })()`);
    r.check(seen === 'Bea', `Mal's box says it was collected by Bea, signed (${seen})`);
    const v = await game(mal, `(() => { const d = dropMailbox.drops.find((x) => x.id === ${JSON.stringify(id)}); return dropMailbox.channel.vaultGet(d.noteVault.blobId, d.noteVault.key).then(() => 'still there', () => 'gone'); })()`);
    r.check(v === 'gone', `and the note itself is gone from Vault (${v})`);
    await shot(mal, 'drop-mailbox-collected');
}

(async () => {
    const b = await chromium.launch(LAUNCH);
    const errors = [];
    try {
        const ann = await join(b, 'Ann', errors);
        const bea = await join(b, 'Bea', errors);
        const mal = await join(b, 'Mal', errors);
        await authors(ann, bea, mal);
        await readOnce(ann, bea, mal);
    } catch (err) {
        r.check(false, 'the suite ran to the end: ' + (err && err.message));
    }
    r.check(errors.length === 0, 'no page errors ' + errors.slice(0, 2).join(' | '));
    console.log('room: ' + ROOM);
    await b.close();
    process.exitCode = r.report() ? 1 : 0;
})();
