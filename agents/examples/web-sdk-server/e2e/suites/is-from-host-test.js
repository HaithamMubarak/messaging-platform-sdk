/**
 * isFromHost, three people: a guest's broadcast relayed by the host is not
 * the host's.
 *
 * Hana (the host), Bea and Mal, in Gavel because it is a three-seat room that
 * loads UserConnectionBase. In p2p-host mode the host forwards a guest's
 * untargeted message to everyone else, so it reaches Bea FROM the host's
 * connection, stamped `_fromClient: 'Mal'`. `isFromHost(peerId)` looked at the
 * peer alone and said yes: Baton, Signet, Screener, Turnstile, the SDK
 * terminal and Gatehouse each trusted Mal's broadcasts as the host's.
 *
 *  - control: Hana's own broadcast passes isFromHost(peerId, data) on Bea;
 *  - Mal's relayed broadcast fails it on Bea, and senderOf names Mal;
 *  - the one-argument form with a peer id fails safe on both: it cannot tell
 *    a relayed message from the host's own, so it trusts neither.
 *
 * Channels are 'ifh<time>'; clean up with
 *   scripts/cleanup_channels.py --prefix '^ifh[0-9]+' --yes
 */
const { BASE, LAUNCH, results } = require('../lib/harness');
const { chromium } = require('playwright');
const { useChannelForm } = require('../lib/party-room');

const r = results();
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const game = (p, expr) => p.evaluate(new Function('return (' + expr + ');'));
const ROOM = 'ifh' + Math.floor(Date.now() / 1000);

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
    if (!await waitFor(p, 'window.gavelGame && gavelGame.connected', 45000)) throw new Error(name + ' did not join ' + ROOM);
    await sleep(4000);
    return p;
}

/** Bea records what the base class says about each probe, before Gavel sees anything. */
const tapProbes = (p) => p.evaluate(() => {
    const app = window.gavelGame, inner = app.onDataChannelMessage.bind(app);
    window.probes = {};
    app.onDataChannelMessage = (peerId, data) => {
        if (!data || data.t !== 'ifh-probe') return inner(peerId, data);
        window.probes[data.who] = { peerId, sender: app.senderOf(peerId, data),
            withData: app.isFromHost(peerId, data), peerOnly: app.isFromHost(peerId) };
    };
});

(async () => {
    const b = await chromium.launch(LAUNCH);
    const errors = [];
    try {
        const hana = await join(b, 'Hana', errors);
        const bea = await join(b, 'Bea', errors);
        const mal = await join(b, 'Mal', errors);
        await sleep(4000);   // data channels to the host
        r.check(await game(hana, 'gavelGame.isHost()'), 'Hana, first in, is the host');
        await tapProbes(bea);

        await hana.evaluate(() => gavelGame.sendData({ t: 'ifh-probe', who: 'Hana' }));
        await mal.evaluate(() => gavelGame.sendData({ t: 'ifh-probe', who: 'Mal' }));
        const both = await waitFor(bea, 'window.probes.Hana && window.probes.Mal', 10000);
        const seen = await game(bea, 'window.probes');
        r.check(both, `Bea received both probes (${JSON.stringify(seen)})`);
        const h = seen.Hana || {}, m = seen.Mal || {};
        r.check(h.withData === true, `control: Hana's own broadcast is from the host (${JSON.stringify(h)})`);
        r.check(m.peerId === 'Hana' && m.sender === 'Mal',
            `Mal's broadcast reaches Bea on the host's connection, and senderOf names Mal (${JSON.stringify(m)})`);
        r.check(m.withData === false, `isFromHost(peerId, data) refuses Mal's relayed broadcast (${m.withData})`);
        r.check(m.peerOnly === false && h.peerOnly === false,
            `isFromHost(peerId) without the message trusts neither (Mal ${m.peerOnly}, Hana ${h.peerOnly})`);
    } catch (err) {
        r.check(false, 'the suite ran to the end: ' + (err && err.message));
    }
    r.check(errors.length === 0, 'no page errors ' + errors.slice(0, 2).join(' | '));
    console.log('room: ' + ROOM);
    await b.close();
    process.exitCode = r.report() ? 1 : 0;
})();
