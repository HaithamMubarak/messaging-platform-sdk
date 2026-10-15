/**
 * Call, alone, on a phone: the waiting room's "Add a companion" brings a real
 * second connection whose camera is a test card. Its picture arrives over
 * WebRTC and moves; you react, and it reacts back on its own tile. Nothing
 * overflows a 375 or a 320 px phone.
 *
 * Channels are code rooms ('call-NNNNNN.call'); clean up with
 *   scripts/cleanup_channels.py --prefix '^call-[0-9]{6}\.call$' --yes
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
    while (Date.now() - t0 < ms) { if (await game(p, expr)) return true; await sleep(250); }
    return false;
}

const frames = (p) => game(p, "(() => { const v = document.querySelector('.call-tile[data-name=\"Companion\"] video'); return v && v.videoWidth ? v.getVideoPlaybackQuality().totalVideoFrames : 0; })()");

async function alone(b, width) {
    const p = await (await b.newContext({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true })).newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(BASE + '/apps/call/index.html', { waitUntil: 'load' });
    await p.waitForSelector('#partyLobby:not(.pl-loading)', { timeout: 20000 });
    await p.click('#partyLobby .pl-btn--primary');
    await waitFor(p, 'window.callApp && callApp.connected', 45000);
    await sleep(1500);
    r.check(/Add a companion/.test(await p.innerText('#plWaiting').catch(() => '')), `${width}px: the waiting room offers a companion`);
    await p.click('#plWaiting .pl-btn:has-text("Add a companion")');
    r.check(await waitFor(p, '!!document.querySelector(\'.call-tile[data-name="Companion"]\')', 30000), `${width}px: the companion joins the call`);
    r.check(await waitFor(p, '(() => { const v = document.querySelector(\'.call-tile[data-name="Companion"] video\'); return !!(v && v.videoWidth === 640); })()', 30000),
        `${width}px: its test card arrives over WebRTC`);
    const a = await frames(p); await sleep(1500); const z = await frames(p);
    r.check(z > a, `${width}px: and it moves (${a} -> ${z} frames)`);
    await p.click('#reactions [data-react="👋"]');
    r.check(await waitFor(p, '!!document.querySelector(\'.call-tile[data-name="Companion"] .call-react\')', 5000), `${width}px: you wave, and the companion waves back`);
    const over = await game(p, 'document.documentElement.scrollWidth - innerWidth');
    r.check(over <= 0, `${width}px: nothing overflows the phone (${over}px over)`);
    await shot(p, 'call-solo-' + width);
    r.check(errors.length === 0, `${width}px: no page errors ` + errors.slice(0, 2).join(' | '));
    console.log('room: ' + await game(p, 'callApp.channelName'));
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
