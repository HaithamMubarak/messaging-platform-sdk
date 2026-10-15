/**
 * Drop, alone, on a phone: the waiting room's "Add a companion" brings a
 * second connection, and "Send a postcard" gives a visitor with no file to
 * hand something to send. The postcard goes the whole way (offer, accept,
 * chunks) and nothing on the page overflows a 375 or a 320 px phone.
 *
 * Channels are code rooms ('drop-NNNNNN.drop'); clean up with
 *   scripts/cleanup_channels.py --prefix '^drop-[0-9]{6}\.drop$' --yes
 * SHOTS=<dir> saves screenshots there.
 */
const { BASE, LAUNCH, results } = require('../lib/harness');
const { chromium } = require('playwright');
const path = require('path');

const r = results();
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const game = (p, expr) => p.evaluate(new Function('return (' + expr + ');'));
const shot = (p, name) => process.env.SHOTS && p.screenshot({ path: path.join(process.env.SHOTS, name + '.png'), fullPage: true });

async function waitFor(p, expr, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await game(p, expr)) return true; await sleep(200); }
    return false;
}

async function alone(b, width) {
    const p = await (await b.newContext({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true })).newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(BASE + '/apps/drop/index.html', { waitUntil: 'load' });
    await p.waitForSelector('#partyLobby:not(.pl-loading)', { timeout: 20000 });
    await p.click('#partyLobby .pl-btn--primary');
    await waitFor(p, 'window.dropApp && dropApp.connected', 45000);
    await sleep(1500);
    r.check(/Add a companion/.test(await p.innerText('#plWaiting').catch(() => '')), `${width}px: the waiting room offers a companion`);
    await p.click('#plWaiting .pl-btn:has-text("Add a companion")');
    r.check(!(await p.$('#plWaiting')), `${width}px: and choosing it closes the waiting room`);
    r.check(await waitFor(p, 'dropApp.getUserCount() >= 2', 30000), `${width}px: the companion joins the room`);
    await sleep(1500);
    await p.click('#postcardBtn');
    r.check(await waitFor(p, "[...dropApp.transfers.values()].some((x) => /^postcard-/.test(x.name) && x.state === 'sent')", 20000),
        `${width}px: a postcard goes the whole way to the companion`);
    await sleep(500);
    const over = await game(p, 'document.documentElement.scrollWidth - innerWidth');
    r.check(over <= 0, `${width}px: nothing overflows the phone (${over}px over)`);
    await shot(p, 'drop-solo-' + width);
    r.check(errors.length === 0, `${width}px: no page errors ` + errors.slice(0, 2).join(' | '));
    console.log('room: ' + await game(p, 'dropApp.channelName'));
    await p.context().close();
}

(async () => {
    const b = await chromium.launch(LAUNCH);
    try {
        await alone(b, 375);
        await alone(b, 320);
    } catch (err) {
        r.check(false, 'the suite ran to the end: ' + (err && err.message));
    }
    await b.close();
    process.exitCode = r.report() ? 1 : 0;
})();
