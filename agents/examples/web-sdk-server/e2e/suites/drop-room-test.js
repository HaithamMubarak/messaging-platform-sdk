/**
 * Drop, three people: a file goes only where it was meant to, from who it says.
 *
 * Ann, Rex and Mal on real data channels. Mal is the one who tries things:
 *  - an offer Mal sends signed "Ann" shows on Rex's screen as Mal's, and bytes
 *    Mal streams into Ann's transfer to Rex are refused;
 *  - Mal asking for the pieces of Ann's file to Rex gets nothing;
 *  - Ann offers to the room, Mal declines, and Rex can still accept and
 *    receive it (one decline used to end the offer for everybody);
 * and the moments: the flight strip with speed while it moves, the arrival
 * pulse, and a preview of what came (a postcard picture, a text file's lines).
 *
 * Channels are 'dpr<time>'; clean up with
 *   scripts/cleanup_channels.py --prefix '^dpr[0-9]+' --yes
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
const ROOM = 'dpr' + Math.floor(Date.now() / 1000);

async function waitFor(p, expr, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await game(p, expr)) return true; await sleep(150); }
    return false;
}

async function join(b, name, errors, viewport) {
    const p = await (await b.newContext({ viewport: viewport || { width: 1280, height: 860 } })).newPage();
    p.on('pageerror', (e) => errors.push(name + ': ' + e.message));
    await p.goto(BASE + '/apps/drop/index.html', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#connectionModal.active', { timeout: 45000 });
    await useChannelForm(p);
    await p.evaluate(() => document.getElementById('tabCustom')?.click());
    await p.fill('#usernameInput', name);
    await p.fill('#channelInput', ROOM);
    await p.fill('#passwordInput', 'pw12345');
    await p.click('#connectBtn');
    await waitFor(p, 'window.dropApp && dropApp.connected', 45000);
    await sleep(5000);
    // Count every chunk this page is handed, whatever the app then does with it.
    await p.evaluate(() => {
        window.__chunks = [];
        const orig = dropApp.onDataChannelMessage.bind(dropApp);
        dropApp.onDataChannelMessage = (peer, d) => { if (d && d.type === 'chunk') window.__chunks.push(d.id); orig(peer, d); };
    });
    return p;
}

const row = (p, name) => game(p, `(() => { const r = [...dropApp.transfers.values()].find((x) => x.name === ${JSON.stringify(name)}); return r ? { id: r.id, s: r.state, from: r.from, to: r.to } : null; })()`);
const offerTo = (p, name, body, to) => p.evaluate(({ name, body, to }) => { dropApp.target = to; dropApp.send(new File([body], name, { type: 'text/plain' })); }, { name, body, to });

async function forgedOffer(ann, rex, mal) {
    await mal.evaluate(() => dropApp.sendData({ type: 'offer', id: 'tFAKE1', name: 'invoice.pdf', size: 5, mime: 'application/pdf', chunks: 1, by: 'Ann' }, 'Rex'));
    await waitFor(rex, "dropApp.transfers.has('tFAKE1')", 6000);
    const fake = await row(rex, 'invoice.pdf');
    r.check(fake && fake.from === 'Mal', `an offer Mal signs "Ann" reaches Rex as Mal's (${JSON.stringify(fake)})`);
}

/**
 * Ann sends Rex 2 MB (128 chunks, a couple of seconds); the moment Rex accepts,
 * Mal pushes the LAST pieces in, long before Ann's own reach them. Before the
 * fix Rex kept whichever copy of a piece came first, so Mal's bytes won.
 */
async function injectedChunks(ann, rex, mal) {
    await offerTo(ann, 'plan.txt', 'the real plan\n'.repeat(150000), 'Rex');
    await waitFor(rex, "[...dropApp.transfers.values()].some((x) => x.name === 'plan.txt')", 8000);
    const plan = await row(rex, 'plan.txt');
    await rex.evaluate((id) => dropApp.accept(id), plan.id);
    await mal.evaluate((id) => { for (let i = 120; i < 128; i++) dropApp.sendData({ type: 'chunk', id, i, b: btoa('EVIL'.repeat(64)) }, 'Rex'); }, plan.id);
    const flew = await waitFor(ann, "!!document.querySelector('.tr__flight .tr__plane') && /\\/s/.test(document.querySelector('.tr__flight .tr__chunks').textContent)", 8000);
    r.check(flew, 'while it moves, the row shows the flight, the speed and the time left');
    if (flew) await shot(ann, 'drop-flight');
    r.check(await waitFor(rex, `dropApp.transfers.get(${JSON.stringify(plan.id)}).state === 'ready'`, 30000), "control: Ann's 2 MB reaches Rex");
    const text = await rex.evaluate((id) => dropApp.transfers.get(id).blob.text(), plan.id);
    r.check(!/EVIL/.test(text) && text.length === 'the real plan\n'.length * 150000, `and it holds Ann's bytes only, none of Mal's (${text.length} bytes)`);

    // Mal asks Ann for the pieces of that file.
    await mal.evaluate((id) => { window.__chunks = []; dropApp.sendData({ type: 'need', id, missing: [0, 1, 2] }, 'Ann'); }, plan.id);
    await sleep(2500);
    const leaked = await mal.evaluate((id) => window.__chunks.filter((x) => x === id).length, plan.id);
    r.check(leaked === 0, `Mal asking for pieces of Ann's file to Rex gets none (${leaked})`);
}

async function roomOffer(ann, rex, mal) {
    await offerTo(ann, 'menu.txt', 'soup\nsalad\nbread\n'.repeat(20), null);
    await waitFor(mal, "[...dropApp.transfers.values()].some((x) => x.name === 'menu.txt')", 8000);
    await waitFor(rex, "[...dropApp.transfers.values()].some((x) => x.name === 'menu.txt')", 8000);
    const id = (await row(mal, 'menu.txt')).id;
    await mal.evaluate((id) => dropApp.decline(id), id);
    await sleep(1500);
    const afterNo = await row(ann, 'menu.txt');
    r.check(afterNo.s === 'offered', `one decline leaves a room-wide offer open to the rest (${afterNo.s})`);
    await rex.evaluate((id) => dropApp.accept(id), id);
    r.check(await waitFor(rex, `dropApp.transfers.get(${JSON.stringify(id)}).state === 'ready'`, 15000), 'and Rex can still accept and receive it');
    r.check(await waitFor(rex, "!!document.querySelector('.tr__preview--text')", 4000), 'a text file arrives with its first lines shown');
}

async function postcardFlight(ann, rex) {
    await game(ann, "dropApp.target = 'Rex'");
    await ann.click('#postcardBtn');
    await waitFor(rex, "[...dropApp.transfers.values()].some((x) => /^postcard-/.test(x.name) && x.state === 'offered')", 8000);
    const id = await game(rex, "[...dropApp.transfers.values()].find((x) => /^postcard-/.test(x.name)).id");
    await rex.evaluate((id) => dropApp.accept(id), id);
    r.check(await waitFor(rex, "!!document.querySelector('img.tr__preview') && document.querySelector('img.tr__preview').naturalWidth === 800", 15000),
        'the postcard lands as a picture you can see before saving');
    await shot(rex, 'drop-postcard');
}

(async () => {
    const b = await chromium.launch(LAUNCH);
    const errors = [];
    try {
        const ann = await join(b, 'Ann', errors);
        const rex = await join(b, 'Rex', errors);
        const mal = await join(b, 'Mal', errors);
        await sleep(2500);
        await forgedOffer(ann, rex, mal);
        await injectedChunks(ann, rex, mal);
        await roomOffer(ann, rex, mal);
        await postcardFlight(ann, rex);
    } catch (err) {
        r.check(false, 'the suite ran to the end: ' + (err && err.message));
    }
    r.check(errors.length === 0, 'no page errors ' + errors.slice(0, 2).join(' | '));
    console.log('room: ' + ROOM);
    await b.close();
    process.exitCode = r.report() ? 1 : 0;
})();
