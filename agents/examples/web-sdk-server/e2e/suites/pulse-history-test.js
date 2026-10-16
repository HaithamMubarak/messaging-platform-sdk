/**
 * Pulse's time machine holds only history somebody can be named for.
 *
 * The poll's versions live in one shared, append-only storage key, so anyone in
 * the room could append a version ("HACKED: Mal wins") and the time machine
 * showed and replayed it as part of the vote. The host now seals each version
 * it writes (js/seals.js); the history keeps sealed versions, says who wrote
 * each, and counts what it left out.
 *
 *  - control: Bea's vote appears as a version, written by Hana (the host);
 *  - Mal appends a forged version: Bea's history leaves it out and says one
 *    unsigned version was ignored;
 *  - control: the host's next version still appears.
 *
 * Channels are 'plh<time>'; clean up with
 *   scripts/cleanup_channels.py --prefix '^plh[0-9]+' --yes
 */
const { BASE, LAUNCH, results } = require('../lib/harness');
const { chromium } = require('playwright');
const { useChannelForm } = require('../lib/party-room');

const r = results();
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const game = (p, expr) => p.evaluate(new Function('return (' + expr + ');'));
const ROOM = 'plh' + Math.floor(Date.now() / 1000);

async function waitFor(p, expr, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await game(p, expr)) return true; await sleep(250); }
    return false;
}

async function join(b, name, errors) {
    const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    p.on('pageerror', (e) => errors.push(name + ': ' + e.message.split('\n')[0]));
    await p.goto(BASE + '/apps/pulse/index.html', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#connectionModal.active', { timeout: 45000 });
    await useChannelForm(p);
    await p.evaluate(() => document.getElementById('tabCustom')?.click());
    await p.fill('#usernameInput', name);
    await p.fill('#channelInput', ROOM);
    await p.fill('#passwordInput', 'pw12345');
    await p.click('#connectBtn');
    await waitFor(p, 'window.pulseApp && pulseApp.connected', 45000);
    await sleep(4000);
    return p;
}

const history = (p) => game(p, "pulseApp.versions.map((v) => v.why + ' by ' + v.by)");

(async () => {
    const b = await chromium.launch(LAUNCH);
    const errors = [];
    try {
        const hana = await join(b, 'Hana', errors);
        const bea = await join(b, 'Bea', errors);
        const mal = await join(b, 'Mal', errors);
        await sleep(2000);
        const [a, c] = await game(hana, 'pulseApp.poll.options.map((o) => o.id)');

        await bea.evaluate((id) => pulseApp.vote(id), a);
        r.check(await waitFor(bea, "pulseApp.versions.some((v) => v.why === 'vote by Bea' && v.by === 'Hana')", 10000),
            `control: Bea's vote is a version, written by Hana (${JSON.stringify(await history(bea))})`);

        await mal.evaluate(() => new Promise((res) => pulseApp.channel.storageAdd({ storageKey: 'pulse_poll', encrypted: false,
            content: { poll: { question: 'HACKED: Mal wins', options: [{ id: 'm', label: 'Mal' }], votes: {}, closesAt: Date.now() + 999999 },
                tallies: { m: 4 }, why: 'vote by everyone', at: Date.now() + 1000 }, metadata: {} }, res)));
        await sleep(1000);
        await bea.evaluate(() => pulseApp._loadVersions());
        await sleep(3500);
        const h = await history(bea);
        r.check(!h.some((x) => /vote by everyone/.test(x)), `Mal's appended version is not in Bea's history (${JSON.stringify(h)})`);
        r.check(await game(bea, "/1 unsigned version in storage/.test(document.getElementById('versions').textContent)"),
            'and the history says one unsigned version was left out');

        await hana.evaluate((id) => pulseApp.vote(id), c);
        r.check(await waitFor(bea, "pulseApp.versions.some((v) => v.why === 'vote by Hana' && v.by === 'Hana')", 10000),
            "control: the host's next version still appears");
    } catch (err) {
        r.check(false, 'the suite ran to the end: ' + (err && err.message));
    }
    r.check(errors.length === 0, 'no page errors ' + errors.slice(0, 2).join(' | '));
    console.log('room: ' + ROOM);
    await b.close();
    process.exitCode = r.report() ? 1 : 0;
})();
