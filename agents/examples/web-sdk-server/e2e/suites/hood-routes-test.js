/**
 * Under the Hood, three people: every ping is drawn on the route it really took.
 *
 * Hana (the host, first in), Bea and Cal. The relay mode is p2p-host, a star:
 *  - Bea's peer-to-peer ping reaches Cal relayed by Hana, and Cal's page says so
 *    and draws Bea -> Hana -> Cal, naming Bea as the sender (the relay's stamp,
 *    not the hand that delivered it);
 *  - Hana's peer-to-peer ping reaches Cal straight, Hana -> Cal;
 *  - a ping through the server is drawn through the server, never through the
 *    host (the page used to draw every message through the host);
 *  - the pinger sees each person's peer-to-peer round trip, and its own ping's
 *    round trip to the server, timed by the server's echo (nobody has to reply).
 *
 * Channels are 'hdr<time>'; clean up with
 *   scripts/cleanup_channels.py --prefix '^hdr[0-9]+' --yes
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
const ROOM = 'hdr' + Math.floor(Date.now() / 1000);

async function waitFor(p, expr, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await game(p, expr)) return true; await sleep(200); }
    return false;
}

async function join(b, name, errors) {
    const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
    p.on('pageerror', (e) => errors.push(name + ': ' + e.message.split('\n')[0]));
    await p.goto(BASE + '/apps/under-the-hood/app.html', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#connectionModal.active', { timeout: 45000 });
    await useChannelForm(p);
    await p.evaluate(() => document.getElementById('tabCustom')?.click());
    await p.fill('#usernameInput', name);
    await p.fill('#channelInput', ROOM);
    await p.fill('#passwordInput', 'pw12345');
    await p.click('#connectBtn');
    await waitFor(p, 'window.underTheHood && underTheHood.connected', 45000);
    await sleep(4000);
    // Record every route this page draws.
    await p.evaluate(() => {
        window.__routes = [];
        const orig = underTheHood.flyRoute.bind(underTheHood);
        underTheHood.flyRoute = (paths) => { paths.forEach((x) => window.__routes.push(x.join('>'))); orig(paths); };
    });
    return p;
}

const logHas = (p, re) => game(p, `${re}.test(document.getElementById('log').innerText)`);
const drew = (p, route) => waitFor(p, `window.__routes.includes(${JSON.stringify(route)})`, 8000);

(async () => {
    const b = await chromium.launch(LAUNCH);
    const errors = [];
    try {
        const hana = await join(b, 'Hana', errors);
        const bea = await join(b, 'Bea', errors);
        const cal = await join(b, 'Cal', errors);
        await sleep(5000);   // the data channels to the host open
        r.check(await game(hana, 'underTheHood.isHost()'), 'Hana, first in, holds the crown');

        await bea.click('#pingDirectBtn');
        r.check(await drew(cal, 'Bea>Hana>Cal'), "Bea's peer-to-peer ping is drawn Bea -> Hana -> Cal on Cal's map");
        r.check(await logHas(cal, '/Bea sent a ping, peer to peer, relayed by Hana/'), "and Cal's log says Bea sent it and Hana relayed it");

        await hana.click('#pingDirectBtn');
        r.check(await drew(cal, 'Hana>Cal'), "Hana's peer-to-peer ping is drawn straight to Cal");
        r.check(await logHas(cal, '/Hana sent a ping, peer to peer, straight to you/'), 'and logged as direct');

        await game(cal, 'window.__routes = []');
        await bea.click('#pingBtn');
        r.check(await drew(cal, 'Bea>the server>Cal'), "a ping through the server is drawn through the server on Cal's map");
        r.check(await game(cal, "!window.__routes.some((x) => x.indexOf('>Hana>') >= 0)"), 'and not through the host (the page used to)');

        r.check(await waitFor(bea, "/\\d+ ms/.test(document.getElementById('roster').innerText)", 8000),
            "Bea's roster shows each person's peer-to-peer round trip");
        r.check(await waitFor(bea, "/^\\d+ ms$/.test(document.getElementById('serverRtt').textContent)", 8000),
            'and her ping to the server and back, timed by its own echo');
        r.check(!(await logHas(bea, '/Bea sent a ping/')), "Bea's own ping, echoed back by the server, is not news on her own log");
        await shot(cal, 'hood-routes');
        await shot(bea, 'hood-rtt');
    } catch (err) {
        r.check(false, 'the suite ran to the end: ' + (err && err.message));
    }
    r.check(errors.length === 0, 'no page errors ' + errors.slice(0, 2).join(' | '));
    console.log('room: ' + ROOM);
    await b.close();
    process.exitCode = r.report() ? 1 : 0;
})();
