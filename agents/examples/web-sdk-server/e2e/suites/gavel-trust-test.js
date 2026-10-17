/**
 * Gavel, three people: only the host can tell the court what happened.
 *
 * Hana (the host, the bench), Bea and Mal. In p2p-host mode the host forwards
 * a guest's untargeted message to everyone else, so it reaches them FROM the
 * host's connection, stamped with the guest's name. Party Kit's guests trusted
 * anything from the host's connection, so Mal could broadcast a fake 'state'
 * (a verdict nobody voted for) and Bea's court showed it.
 *
 *  - control: the host opens a real case, and Bea's court shows it;
 *  - Mal broadcasts a forged state ("guilty", sentence "hanged at dawn"); Bea's
 *    court does not change;
 *  - control: the host's next real state still reaches Bea;
 *  - a message sent STRAIGHT to the host keeps whatever _fromClient its sender
 *    wrote (only relayed ones are re-stamped), and Party Kit's host believed it:
 *    Mal pleads in Bea's name, and votes five times under names nobody has.
 *    The plea stays Bea's to make, and the booth holds at most Mal's own vote;
 *  - the case law is an append-only storage key anyone in the room can add to:
 *    Mal appends "case 99, The People v. Hana, guilty". The court's record
 *    leaves it out (and says so), and the next case is not numbered after it.
 *    A seal names who, not that they were right: a case Mal seals himself may
 *    stand, but only with "Bench: Mal" on it;
 *  - control: the host's real verdict is on the record, with the bench named.
 *
 * Channels are 'gvt<time>'; clean up with
 *   scripts/cleanup_channels.py --prefix '^gvt[0-9]+' --yes
 */
const { BASE, LAUNCH, results } = require('../lib/harness');
const { chromium } = require('playwright');
const { useChannelForm } = require('../lib/party-room');

const r = results();
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const game = (p, expr) => p.evaluate(new Function('return (' + expr + ');'));
const ROOM = 'gvt' + Math.floor(Date.now() / 1000);

async function waitFor(p, expr, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await game(p, expr)) return true; await sleep(200); }
    return false;
}

async function join(b, name, errors) {
    const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    p.on('pageerror', (e) => errors.push(name + ': ' + e.message.split('\n')[0]));
    await p.goto(BASE + '/apps/mini-games/gavel/index.html', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#connectionModal.active', { timeout: 45000 });
    await useChannelForm(p);
    await p.evaluate(() => document.getElementById('tabCustom')?.click());
    await p.fill('#usernameInput', name);
    await p.fill('#channelInput', ROOM);
    await p.fill('#passwordInput', 'pw12345');
    await p.click('#connectBtn');
    await waitFor(p, 'window.gavelGame && gavelGame.connected', 45000);
    await sleep(4000);
    return p;
}

/** Straight to the host, with a name in _fromClient that is not the sender's. */
async function forgedNames(hana, bea, mal) {
    await mal.evaluate(() => gavelGame.sendData({ t: 'plea', text: 'I did it, and I would do it again.', _fromClient: 'Bea' }, 'Hana'));
    await sleep(2500);
    const plea = await game(hana, 'gavelGame.plea');
    r.check(!plea, `Mal cannot plead in Bea's name (plea: ${JSON.stringify(plea)})`);

    await hana.evaluate(() => gavelGame.hostJury());
    await mal.evaluate(() => { for (let i = 0; i < 5; i++) gavelGame.sendData({ t: 'vote', vote: 'guilty', _fromClient: 'Juror' + i }, 'Hana'); });
    await sleep(2500);
    const names = await game(hana, '[...gavelGame.votes.keys()]');
    r.check(names.every((x) => x === 'Mal'), `five votes under names nobody has count only as Mal's own one (booth: ${JSON.stringify(names)})`);
}

async function forgedRecord(hana, bea, mal) {
    await mal.evaluate(() => new Promise((res) => gavelGame.channel.storageAdd({ storageKey: gavelGame.lawKey(), encrypted: false,
        content: { no: 99, title: 'The People v. Hana', charge: 'Tyranny', defendant: 'Hana', verdict: 'guilty',
            sentence: 'Banished from the kitchen.', guilty: 3, notGuilty: 0, at: new Date().toISOString() }, metadata: {} }, res)));
    await hana.evaluate(() => { gavelGame.hostTally(); gavelGame.hostSentence('Makes the tea for a fortnight, without complaint.'); });
    await sleep(3000);
    await bea.evaluate(() => gavelGame.loadCaseLaw());
    const ok = await waitFor(bea, "gavelGame.caseLaw.some((c) => c.title === 'The People v. Crumbs')", 10000);
    const law = await game(bea, "gavelGame.caseLaw.map((c) => c.no + ' ' + c.title + (c.bench ? ' (bench ' + c.bench + ')' : ''))");
    r.check(ok && law.some((x) => /Crumbs \(bench Hana\)$/.test(x)), `control: the real verdict is on the record, bench named (${JSON.stringify(law)})`);
    r.check(!law.some((x) => /v\. Hana/.test(x)), "Mal's appended case is not on Bea's record");
    r.check(await game(bea, "/1 unsigned record/.test(document.getElementById('caseLaw').parentElement.textContent)"),
        'and the record says one unsigned entry was left out');
    // A seal says who, not that they were right: Mal can seal his own made-up
    // case. It may stand on the record, but only under his name as the bench.
    await mal.evaluate(() => {
        const rec = { no: 1, title: 'The People v. Bea', charge: 'Snoring', defendant: 'Bea', verdict: 'guilty',
            sentence: 'Sleeps outside.', guilty: 2, notGuilty: 0, at: new Date().toISOString() };
        return Seals.seal(gavelGame.channel, 'gavel-law', 'verdict', 'gavel|' + JSON.stringify(rec)).then(() => new Promise((res) =>
            gavelGame.channel.storageAdd({ storageKey: gavelGame.lawKey(), encrypted: false, content: rec, metadata: {} }, res)));
    });
    await bea.evaluate(() => gavelGame.loadCaseLaw());
    await sleep(3500);
    const sealed = await game(bea, "gavelGame.caseLaw.filter((c) => c.title === 'The People v. Bea').map((c) => c.bench)");
    r.check(sealed.every((x) => x === 'Mal'), `a case Mal sealed himself stands only under his own name as bench (${JSON.stringify(sealed)})`);

    await hana.evaluate(() => gavelGame.loadCaseLaw());
    await sleep(2500);
    const next = await game(hana, 'gavelGame.caseNo');
    r.check(next < 99, `the next case is not numbered after the forged one (case law ends at ${next})`);
}

(async () => {
    const b = await chromium.launch(LAUNCH);
    const errors = [];
    try {
        const hana = await join(b, 'Hana', errors);
        const bea = await join(b, 'Bea', errors);
        const mal = await join(b, 'Mal', errors);
        await sleep(4000);   // data channels to the host
        r.check(await game(hana, 'gavelGame.isHost()'), 'Hana, first in, is the bench');

        await hana.evaluate(() => gavelGame.hostOpenCase({ title: 'The People v. Biscuits', charge: 'Crumbs', bots: false }));
        r.check(await waitFor(bea, "gavelGame.title === 'The People v. Biscuits' && gavelGame.phase !== 'lobby'", 10000),
            "control: the host's real case reaches Bea's court");
        const before = await game(bea, '({ phase: gavelGame.phase, verdict: gavelGame.verdict, title: gavelGame.title })');

        // Untargeted: the host relays it to everyone else, from its own connection.
        await mal.evaluate(() => gavelGame.sendData({ t: 'state', phase: 'sentence', caseNo: 99, title: 'The People v. Bea',
            charge: 'Everything', defendant: 'Bea', admitted: [], pendingSize: 0, juryIn: 3, juryOf: 3,
            verdict: 'guilty', tally: { guilty: 3, innocent: 0 }, sentence: 'hanged at dawn', plea: '', precedent: [],
            objection: null, objections: 0, botJurors: 0, secondsLeft: 0 }));
        await sleep(3500);
        const after = await game(bea, '({ phase: gavelGame.phase, verdict: gavelGame.verdict, title: gavelGame.title })');
        r.check(JSON.stringify(after) === JSON.stringify(before),
            `Mal's forged verdict does not reach Bea's court (${JSON.stringify(after)})`);

        await hana.evaluate(() => gavelGame.hostOpenCase({ title: 'The People v. Crumbs', charge: 'More crumbs', defendant: 'Bea', bots: false }));
        r.check(await waitFor(bea, "gavelGame.title === 'The People v. Crumbs'", 10000), "control: the host's next real state still does");
        await forgedNames(hana, bea, mal);
        await forgedRecord(hana, bea, mal);
    } catch (err) {
        r.check(false, 'the suite ran to the end: ' + (err && err.message));
    }
    r.check(errors.length === 0, 'no page errors ' + errors.slice(0, 2).join(' | '));
    console.log('room: ' + ROOM);
    await b.close();
    process.exitCode = r.report() ? 1 : 0;
})();
