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
 *  - control: the host's next real state still reaches Bea.
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

        await hana.evaluate(() => gavelGame.hostOpenCase({ title: 'The People v. Crumbs', charge: 'More crumbs', bots: false }));
        r.check(await waitFor(bea, "gavelGame.title === 'The People v. Crumbs'", 10000), "control: the host's next real state still does");
    } catch (err) {
        r.check(false, 'the suite ran to the end: ' + (err && err.message));
    }
    r.check(errors.length === 0, 'no page errors ' + errors.slice(0, 2).join(' | '));
    console.log('room: ' + ROOM);
    await b.close();
    process.exitCode = r.report() ? 1 : 0;
})();
