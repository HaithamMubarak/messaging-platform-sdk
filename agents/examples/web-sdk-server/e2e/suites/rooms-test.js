/**
 * Rooms end-to-end: two clients, the green room, camera, chat, pin, hand.
 * Fake media devices give Chromium a rolling test pattern for the camera.
 * Run: xvfb-run -a --server-args="-screen 0 1440x900x24" node rooms-test.js
 */
const { BASE, SHOTS } = require('../lib/harness');
const { chromium } = require('playwright');
const OUT = SHOTS + '/';
const ROOM = 'rm' + Math.floor(Math.random() * 100000);
const URL = BASE + '/apps/rooms/app.html?debug';

const pass = [], fail = [];
const check = (ok, what) => (ok ? pass : fail).push(what);

async function join(ctx, name) {
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push('PAGEERROR ' + e.message.split('\n')[0]));
    p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 160)); });
    p.errs = errs;
    await p.goto(URL, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#usernameInput', { timeout: 20000 });
    await p.fill('#usernameInput', name);
    await p.fill('#channelInput', ROOM);
    await p.fill('#passwordInput', 'pw12345');
    await p.click('#connectBtn');
    await p.waitForTimeout(6000);
    return p;
}

(async () => {
    const b = await chromium.launch({
        headless: false,
        args: ['--no-sandbox', '--enable-unsafe-swiftshader',
               '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
    });
    const ctx = await b.newContext({
        viewport: { width: 1440, height: 900 },
        permissions: ['camera', 'microphone']
    });

    const a = await join(ctx, 'Alice');

    // --- the green room ------------------------------------------------------
    check(!!(await a.$('#lobby')), 'the green room greets you before the room sees you');
    const sending = await a.evaluate(() => !!(window.roomsApp && roomsApp.cam));
    check(!sending, 'nothing is being captured while you are still in the green room');
    await a.screenshot({ path: OUT + 'rooms-lobby.png' });

    // test the camera in the lobby, then join with it
    const testBtn = await a.$('.lobby__row .btn--ghost');
    if (testBtn) { await testBtn.click(); await a.waitForTimeout(2500); }
    check(await a.evaluate(() => {
        const v = document.querySelector('.lobby__video');
        return !!(v && !v.hidden && v.videoWidth > 0);
    }), 'the camera test shows you yourself');
    await a.screenshot({ path: OUT + 'rooms-lobby-preview.png' });

    await a.evaluate(() => {
        const btns = document.querySelectorAll('.lobby__row .btn');
        btns[btns.length - 2].click();       // "Join with camera"
    });
    await a.waitForTimeout(3000);
    check(await a.evaluate(() => !document.getElementById('lobby')), 'joining closes the green room');
    check(await a.evaluate(() => !!(roomsApp.cam && roomsApp.cam.getVideoTracks().length)),
        'joining with the camera actually turns it on');

    // --- alone in the room ---------------------------------------------------
    check(!!(await a.$('.alone')), 'alone in the room, the stage offers to fetch somebody');
    await a.screenshot({ path: OUT + 'rooms-alone.png' });

    // --- a second person -----------------------------------------------------
    const c = await join(ctx, 'Bob');
    await c.evaluate(() => {
        const btns = document.querySelectorAll('.lobby__row .btn');
        btns[btns.length - 2].click();
    });
    await c.waitForTimeout(6000);
    await a.bringToFront();
    await a.waitForTimeout(6000);

    const peers = await a.evaluate(() => roomsApp._peers().length);
    check(peers === 1, `the roster sees the other person (${peers})`);
    const seesBob = await a.evaluate(() =>
        !!document.querySelector('.people') &&
        document.querySelector('.people').textContent.includes('Bob'));
    check(seesBob, 'Bob is in the member list');

    const gotVideo = await a.evaluate(() => {
        const vids = Array.from(document.querySelectorAll('.tile__video'));
        return vids.filter(v => !v.hidden && v.videoWidth > 0).length;
    });
    check(gotVideo >= 2, `both cameras are painting pixels (${gotVideo} live tiles)`);
    await a.screenshot({ path: OUT + 'rooms-two.png' });

    // --- pin -----------------------------------------------------------------
    await a.evaluate(() => roomsApp.pin('Bob'));
    await a.waitForTimeout(800);
    check(await a.evaluate(() => roomsApp.pinned === 'Bob'), 'clicking a tile pins that person');
    await a.screenshot({ path: OUT + 'rooms-pinned.png' });
    await a.evaluate(() => roomsApp.pin('Bob'));
    await a.waitForTimeout(500);
    check(await a.evaluate(() => roomsApp.pinned === null), 'clicking again unpins');

    // --- raise a hand --------------------------------------------------------
    await a.keyboard.press('h');
    await a.waitForTimeout(2500);
    check(await a.evaluate(() => roomsApp.hand === true), 'H raises your hand');
    const bobSees = await c.evaluate(() => {
        const st = roomsApp.state.get('Alice');
        return !!(st && st.hand);
    });
    check(bobSees, 'the room sees the hand go up');
    await a.keyboard.press('h');
    await a.waitForTimeout(500);

    // --- chat ----------------------------------------------------------------
    await a.fill('#chatInput', 'Can everyone see the shared board?');
    await a.press('#chatInput', 'Enter');
    await a.waitForTimeout(2500);
    const heard = await c.evaluate(() =>
        document.getElementById('log').textContent.includes('shared board'));
    check(heard, 'chat reaches the other person');
    const failedRows = await a.evaluate(() => document.querySelectorAll('.msg.is-failed').length);
    check(failedRows === 0, 'the message was not marked undelivered');

    // --- mute ----------------------------------------------------------------
    await a.keyboard.press('m');
    await a.waitForTimeout(600);
    const micPressed = await a.evaluate(() => document.getElementById('micBtn').getAttribute('aria-pressed'));
    check(micPressed === 'false' || micPressed === 'true', 'the mic button carries aria-pressed');

    // --- the device menu -----------------------------------------------------
    await a.click('#gearBtn');
    await a.waitForTimeout(2000);
    check(await a.evaluate(() => !document.getElementById('deviceMenu').hidden), 'the device menu opens');
    check(await a.evaluate(() => document.getElementById('gearBtn').getAttribute('aria-expanded') === 'true'),
        'the gear reports itself expanded');
    await a.screenshot({ path: OUT + 'rooms-devices.png' });
    await a.keyboard.press('Escape');
    await a.waitForTimeout(400);
    check(await a.evaluate(() => document.getElementById('deviceMenu').hidden), 'Escape closes it');

    // --- shortcuts -----------------------------------------------------------
    await a.keyboard.press('?');
    await a.waitForTimeout(400);
    check(await a.evaluate(() => !document.getElementById('keysModal').hidden), '? shows the shortcuts');
    await a.screenshot({ path: OUT + 'rooms-keys.png' });
    await a.keyboard.press('Escape');
    await a.waitForTimeout(300);

    // --- screen-reader text is not on screen --------------------------------
    const srVisible = await a.evaluate(() => Array.from(document.querySelectorAll('.sr-only'))
        .filter(e => e.getBoundingClientRect().width > 2).length);
    check(srVisible === 0, 'screen-reader labels stay off screen');

    // --- the stats are measured ---------------------------------------------
    const stats = await a.evaluate(() => document.getElementById('connStats').textContent);
    check(/peer|relayed/.test(stats), `the control bar reports the route: "${stats}"`);

    console.log('\nPASS (' + pass.length + ')');
    pass.forEach(p => console.log('  ✓ ' + p));
    console.log('\nFAIL (' + fail.length + ')');
    fail.forEach(f => console.log('  ✗ ' + f));
    const errs = [...new Set([...a.errs, ...c.errs])];
    console.log('\nconsole errors (' + errs.length + '):');
    errs.slice(0, 12).forEach(e => console.log('  ! ' + e));
    await b.close();
})();
