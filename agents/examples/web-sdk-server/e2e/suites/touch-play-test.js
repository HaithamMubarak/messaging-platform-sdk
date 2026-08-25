/**
 * The on-screen controls a phone player actually uses.
 *
 * These only exist below 768px, so no desktop test has ever touched them —
 * and a joystick that does not move the player is invisible to every check
 * that only asks whether the element is on the page. BlockParty's walk mode
 * is the surviving example of the class: the pad was added precisely because
 * the original touch gesture only looked and built, so Walk mode on a phone
 * could never actually walk.
 *
 * Touch is dispatched through CDP rather than element.dispatchEvent, because
 * the handler captures the pointer — a synthetic event with no real pointerId
 * makes setPointerCapture throw, and the test would be exercising a code path
 * a phone never takes.
 */
const { BASE, SHOTS } = require('../lib/harness');
const { chromium } = require('playwright');
const pass = [], fail = [];
const check = (ok, w) => (ok ? pass : fail).push(w);
const SHOT = SHOTS + '/';

const PHONE = {
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 '
             + '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
};

/** Tap a real finger at a point on the screen. */
async function tapAt(cdp, p, x, y) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await p.waitForTimeout(60);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** Hold a real finger on an element for `ms`, then lift it. */
async function hold(cdp, p, selector, ms) {
    const box = await (await p.$(selector)).boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await p.waitForTimeout(ms);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

(async () => {
    const b = await chromium.launch({ headless: false,
        args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
    const ctx = await b.newContext(PHONE);
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push('THREW: ' + e.message.split('\n')[0].slice(0, 95)));
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 95)); });

    const room = 'touch' + Math.floor(Date.now() / 1000);
    await p.goto(BASE + '/apps/mini-games/blockparty/play.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await p.waitForSelector('#usernameInput', { timeout: 45000 });
    await p.fill('#usernameInput', 'Phone');
    await p.fill('#channelInput', room);
    await p.fill('#passwordInput', 'pw12345');
    try {
        await p.click('#connectBtn', { timeout: 45000 });
    } catch (e) {
        await p.waitForTimeout(2000);
        await p.click('#connectBtn', { timeout: 30000 });
    }
    await p.waitForTimeout(13000);

    check(await p.evaluate(() => !!window.blockPartyGame), 'phone: the game is running');

    const cdp = await ctx.newCDPSession(p);

    // Walk mode is two steps on purpose: press Walk, then tap the spot you want
    // to stand on. Both steps go through real touch, because the second one is
    // the half that only exists as a pointer handler on the canvas.
    const fpsBtn = await p.$('#fpsBtn');
    const btnUsable = fpsBtn && await fpsBtn.isVisible();
    check(!!btnUsable, 'phone: the Walk control is reachable on a phone screen');
    if (btnUsable) {
        const box = await fpsBtn.boundingBox();
        await tapAt(cdp, p, box.x + box.width / 2, box.y + box.height / 2);
    } else {
        await p.keyboard.press('g');
    }
    await p.waitForTimeout(1200);
    check(await p.evaluate(() => !!window.blockPartyGame._fpsDrop),
        'phone: tapping Walk arms the choose-your-spot step');

    // Tap the middle of the world to drop in.
    const vp = p.viewportSize();
    await tapAt(cdp, p, vp.width / 2, vp.height / 2);
    await p.waitForTimeout(2500);

    const active = await p.evaluate(() => !!(window.blockPartyGame.fps && window.blockPartyGame.fps.active));
    check(active, 'phone: tapping the ground drops the player into first person');

    // The pad is display:none above 768px, so this is the assertion that a
    // desktop run can never make.
    const padShown = await p.evaluate(() => {
        const pad = document.querySelector('.fps-touch');
        if (!pad) return false;
        return getComputedStyle(pad).display !== 'none' && pad.getBoundingClientRect().width > 0;
    });
    check(padShown, 'phone: the touch movement pad is actually displayed');

    const posOf = () => p.evaluate(() => {
        const f = window.blockPartyGame.fps;
        return { x: f.pos.x, y: f.pos.y, z: f.pos.z };
    });

    if (active && padShown) {
        // Walk forward: the player has to end up somewhere else on the ground.
        const before = await posOf();
        await hold(cdp, p, '[data-fps-key="KeyW"]', 1400);
        await p.waitForTimeout(600);
        const after = await posOf();
        const moved = Math.hypot(after.x - before.x, after.z - before.z);
        check(moved > 0.4, `phone: holding forward walks the player (moved ${moved.toFixed(2)} blocks)`);

        // And releasing has to stop them, or the pad latches the key forever.
        const restA = await posOf();
        await p.waitForTimeout(1200);
        const restB = await posOf();
        const drift = Math.hypot(restB.x - restA.x, restB.z - restA.z);
        check(drift < 0.3, `phone: lifting the finger stops the player (drifted ${drift.toFixed(2)})`);

        // Strafe has to go somewhere different from forward.
        const sBefore = await posOf();
        await hold(cdp, p, '[data-fps-key="KeyD"]', 1200);
        await p.waitForTimeout(600);
        const sAfter = await posOf();
        const strafed = Math.hypot(sAfter.x - sBefore.x, sAfter.z - sBefore.z);
        check(strafed > 0.3, `phone: the strafe key moves the player too (moved ${strafed.toFixed(2)})`);

        // Jump has to leave the ground.
        let peak = 0;
        const jBefore = await posOf();
        await hold(cdp, p, '.fps-touch-jump', 120);
        for (let i = 0; i < 12; i++) {
            const now = await posOf();
            peak = Math.max(peak, now.y - jBefore.y);
            await p.waitForTimeout(90);
        }
        check(peak > 0.3, `phone: the jump button leaves the ground (rose ${peak.toFixed(2)})`);
    } else {
        check(false, 'phone: could not test movement — walk mode or pad unavailable');
    }

    await p.screenshot({ path: SHOT + 'touch-play-blockparty.png' });
    check(errs.length === 0, `phone: no console errors while walking (${errs.slice(0, 2).join(' | ') || 'clean'})`);

    await b.close();
    console.log('\nPASS (' + pass.length + ')'); pass.forEach(x => console.log('  ✓ ' + x));
    console.log('\nFAIL (' + fail.length + ')'); fail.forEach(x => console.log('  ✗ ' + x));
    process.exit(fail.length ? 1 : 0);
})();
