/**
 * Evidence Chain, three people: a shared log nobody can quietly frame.
 *
 *  - Ann seals three examples and Bea's screen shows them without a reload;
 *  - Mal plants a text for entry 4 BEFORE Ann writes it. Ann's real entry 4
 *    still reads as Ann wrote it on Bea's screen, with a note that one other
 *    text was stored and ignored, and Verify passes. Before the fix the planted
 *    words became entry 4 and Verify said "Caught at entry 4", blaming Ann;
 *  - Bea is in the middle of a trick when Ann seals entry 5: Bea's game is left
 *    alone, and her page says there is a new entry to reload;
 *  - control: Bea's trick is still caught by Verify.
 *
 * Channels are 'ecr<time>'; clean up with
 *   scripts/cleanup_channels.py --prefix '^ecr[0-9]+' --yes
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
const ROOM = 'ecr' + Math.floor(Date.now() / 1000);

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

const PLANTED = 'Left site 03:00. Gate left open.';
const REAL = 'Left site 17:40. Gate locked.';

async function liveAndPlanted(ann, bea, mal) {
    await ann.evaluate(() => ecApp.seedExamples());
    r.check(await waitFor(bea, 'ecApp.entries.length === 3', 15000), "Ann's three entries appear on Bea's screen without a reload");

    await mal.evaluate((t) => new Promise((res) => ecApp.channel.storageAdd({ storageKey: 'evidence_chain_log',
        content: JSON.stringify({ seq: 4, note: t }), encrypted: false, metadata: { seq: 4 } }, res)), PLANTED);
    await ann.evaluate((t) => ecApp.append(t), REAL);
    r.check(await waitFor(bea, `ecApp.entries.length === 4 && ecApp.entries[3].note === ${JSON.stringify(REAL)}`, 15000),
        "Mal's planted text does not become Ann's entry 4: Bea reads what Ann sealed");
    r.check(await waitFor(bea, "/1 other text was stored for this entry/.test(document.getElementById('entries').innerText)", 3000),
        'and the page says one other text was stored and ignored');
    const v = await bea.evaluate(() => ecApp.verify().then((x) => x.ok));
    r.check(v, 'Verify passes: nobody is blamed for a text they did not write');
    await shot(bea, 'ec-planted');
}

async function trickInProgress(ann, bea) {
    await bea.evaluate(() => ecApp.alter(1, 'Meter reading 1 kWh.'));
    await ann.evaluate(() => ecApp.append('Second visit 18:05.'));
    await sleep(4000);
    const s = await game(bea, "({ n: ecApp.entries.length, tampered: ecApp.tampered, said: document.getElementById('state').textContent })");
    r.check(s.n === 4 && s.tampered, `Bea's trick is left alone while Ann seals entry 5 (${s.n} entries, tampered ${s.tampered})`);
    r.check(/Ann sealed entry 5\. Reload to see it/.test(s.said), `and her page says there is a new entry (${s.said})`);
    const caught = await bea.evaluate(() => ecApp.verify().then((x) => !x.ok));
    r.check(caught, "control: Bea's edit is still caught by Verify");
}

(async () => {
    const b = await chromium.launch(LAUNCH);
    const errors = [];
    try {
        const ann = await join(b, 'Ann', errors);
        const bea = await join(b, 'Bea', errors);
        const mal = await join(b, 'Mal', errors);
        await liveAndPlanted(ann, bea, mal);
        await trickInProgress(ann, bea);
    } catch (err) {
        r.check(false, 'the suite ran to the end: ' + (err && err.message));
    }
    r.check(errors.length === 0, 'no page errors ' + errors.slice(0, 2).join(' | '));
    console.log('room: ' + ROOM);
    await b.close();
    process.exitCode = r.report() ? 1 : 0;
})();
