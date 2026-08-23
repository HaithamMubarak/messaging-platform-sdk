/**
 * The on-screen controls a phone player actually uses.
 *
 * These only exist below 768px, so no desktop test has ever touched them —
 * and a joystick that does not move the player is invisible to every check
 * that only asks whether the element is on the page.
 */
const { BASE, SHOTS } = require('../lib/harness');
const { chromium, devices } = require('playwright');
const pass = [], fail = [];
const check = (ok, w) => (ok ? pass : fail).push(w);
const SHOT = SHOTS + '/';

async function joinPhone(b, path, name, room) {
  const ctx = await b.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('THREW: ' + e.message.split('\n')[0].slice(0, 95)));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 95)); });
  p.errs = errs; p.ctx = ctx;
  await p.goto(BASE + '/apps/mini-games/' + path, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForSelector('#usernameInput', { timeout: 25000 });
  await p.fill('#usernameInput', name);
  await p.fill('#channelInput', room);
  await p.fill('#passwordInput', 'pw12345');
  await p.click('#connectBtn');
  await p.waitForTimeout(13000);
  return p;
}
const box = (p, sel) => p.evaluate((s) => {
  const e = document.querySelector(s);
  if (!e) return null;
  const r = e.getBoundingClientRect();
  const vis = r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'
              && !e.closest('.hidden');
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: Math.round(r.width), h: Math.round(r.height), vis };
}, sel);

(async () => {
  const b = await chromium.launch({ headless: false,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });

  // ---------------- Party Physics: joystick + four action buttons ----------
  {
    const room = 'mp' + Math.floor(Math.random() * 99999);
    const host = await joinPhone(b, 'party-physics/index.html', 'Phone', room);
    const mate = await joinPhone(b, 'party-physics/index.html', 'Mate', room);
    await host.bringToFront(); await host.waitForTimeout(3000);

    const wired = await host.evaluate(() => ({
      built: !!window.partyPhysicsGame?.mobileControls,
      detected: typeof MobileControls !== 'undefined' ? MobileControls.isMobile() : null
    }));
    check(wired.detected === true, `party-physics: the phone is recognised as one (${wired.detected})`);
    check(wired.built === true, `party-physics: the on-screen controls are built (${wired.built})`);

    await host.evaluate(() => window.partyPhysicsGame.hostStartGame());
    await host.waitForTimeout(9000);

    for (const [label, sel] of [['jump', '#jumpBtn'], ['dash', '#dashBtn'],
                                ['punch', '#punchBtn'], ['ability', '#abilityBtn']]) {
      const bx = await box(host, sel);
      check(bx && bx.vis && bx.w >= 44 && bx.h >= 44,
        `party-physics: the ${label} button is on screen and thumb-sized (${bx ? bx.w + 'x' + bx.h : 'missing'})`);
    }

    // Tap Ability: the cooldown is the observable proof it reached the game.
    const cd0 = await host.evaluate(() => document.getElementById('cooldownValue')?.textContent);
    const ab = await box(host, '#abilityBtn');
    if (ab && ab.vis) {
      await host.touchscreen.tap(ab.x, ab.y);
      await host.waitForTimeout(1500);
    }
    const cd1 = await host.evaluate(() => document.getElementById('cooldownValue')?.textContent);
    check(/\d/.test(cd1 || ''), `party-physics: tapping Ability fires it ("${cd0}" -> "${cd1}")`);

    // Drag the joystick and see the player's own velocity change.
    const j = await box(host, '#joystickContainer');
    if (j && j.vis) {
      // Real touch input over CDP: a hand-built TouchEvent is not the same
      // thing, and getting it wrong looks exactly like a broken joystick.
      // A tap is over before anything can read the joystick, so record what
      // the touch actually reached and what the stick did while it was down.
      await host.evaluate(() => {
        window.__jlog = [];
        const d = (e) => e ? ((e.id ? '#' + e.id : '') + '<' + e.tagName + '>') : 'null';
        document.addEventListener('touchstart', (ev) => window.__jlog.push('touch -> ' + d(ev.target)), true);
        const js = window.partyPhysicsGame.mobileControls.joystick;
        let was = js.active;
        setInterval(() => { if (js.active !== was) { window.__jlog.push('active=' + js.active); was = js.active; } }, 5);
      });
      await host.touchscreen.tap(j.x, j.y);
      await host.waitForTimeout(700);
      const log = await host.evaluate(() => window.__jlog);
      // This is the fault that existed: the floating Share pill sat at
      // z-index 400 over the bottom of the screen, so the touch landed on it
      // instead of the stick. A tap's down and up are the same instant, which
      // is why the active flag is not what gets asserted here.
      check(log.some(l => /touch -> #joystick/.test(l)),
        `party-physics: a thumb on the joystick reaches the joystick, not the chrome (${JSON.stringify(log)})`);

      // ...and once it arrives, the stick tracks the finger.
      const dragged = await host.evaluate(({ x, y }) => {
        const jc = document.getElementById('joystickContainer');
        const mk = (cx, cy) => { const t = new Touch({ identifier: 3, target: jc, clientX: cx, clientY: cy });
          return { touches: [t], targetTouches: [t], changedTouches: [t], bubbles: true, cancelable: true }; };
        jc.dispatchEvent(new TouchEvent('touchstart', mk(x, y)));
        jc.dispatchEvent(new TouchEvent('touchmove', mk(x + 45, y)));
        const js = window.partyPhysicsGame.mobileControls.joystick;
        const out = { active: js.active, mx: Math.round(js.moveX), my: Math.round(js.moveY) };
        jc.dispatchEvent(new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: [], bubbles: true }));
        return out;
      }, { x: j.x, y: j.y });
      check(dragged && dragged.active && Math.abs(dragged.mx) > 1,
        `party-physics: and dragging it moves the player (${JSON.stringify(dragged)})`);
    } else {
      check(false, `party-physics: the joystick is on screen (${JSON.stringify(j)})`);
    }
    await host.screenshot({ path: SHOT + 'mobile-party-physics.png' });
    check([...new Set([...host.errs, ...mate.errs])].filter(e => e.startsWith('THREW')).length === 0,
      'party-physics: nothing throws on a phone');
    await host.ctx.close(); await mate.ctx.close();
  }

  // ---------------- Race Balls: joystick + jump/boost ----------------------
  {
    const room = 'mr' + Math.floor(Math.random() * 99999);
    const host = await joinPhone(b, 'race-balls/index.html', 'Phone', room);
    const mate = await joinPhone(b, 'race-balls/index.html', 'Mate', room);
    await host.bringToFront(); await host.waitForTimeout(3000);
    const mc = await box(host, '#mobileControls');
    check(mc && mc.vis, `race-balls: the on-screen controls appear on a phone (${JSON.stringify(mc)})`);
    const stick = await box(host, '#joystickStick');
    check(stick && stick.vis, `race-balls: the joystick is on screen (${stick ? stick.w + 'x' + stick.h : 'missing'})`);

    // Reachable, not merely present: the floating chrome used to sit on top of
    // exactly this part of the screen.
    await host.evaluate(() => {
      window.__rlog = [];
      const d = (e) => e ? ((e.id ? '#' + e.id : '') + '<' + e.tagName + '>') : 'null';
      document.addEventListener('touchstart', (ev) => window.__rlog.push(d(ev.target)), true);
    });
    for (const [label, sel] of [['jump', '#jumpBtn'], ['boost', '#boostBtn'], ['joystick', '#joystickArea']]) {
      const bx = await box(host, sel);
      if (!bx || !bx.vis) { check(false, `race-balls: the ${label} control is on screen`); continue; }
      await host.touchscreen.tap(bx.x, bx.y);
      await host.waitForTimeout(350);
      const landed = await host.evaluate(() => window.__rlog.pop() || 'nothing');
      const want = sel.replace('#', '');
      check(new RegExp(want.replace('Area', ''), 'i').test(landed) || /joystick/i.test(landed),
        `race-balls: a thumb on ${label} reaches it, not the chrome (${landed})`);
    }
    // ...and the jump actually registers, since it latches until consumed.
    const jumped = await host.evaluate(() => {
      // jumpPressed lives on the game's InputState, not on the game itself.
      const g = window.raceBallsGame && window.raceBallsGame.input;
      if (!g) return 'no input state';
      g.jumpPressed = false; g._jumpHeld = false;
      const b = document.getElementById('jumpBtn');
      b.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true,
        touches: [new Touch({ identifier: 5, target: b, clientX: 0, clientY: 0 })] }));
      const v = g.jumpPressed;
      b.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [] }));
      return { pressed: v, survivesRelease: g.jumpPressed };
    });
    check(jumped && jumped.pressed && jumped.survivesRelease,
      `race-balls: a jump tap registers and survives the release (${JSON.stringify(jumped)})`);
    await host.screenshot({ path: SHOT + 'mobile-race-balls.png' });
    check([...new Set([...host.errs, ...mate.errs])].filter(e => e.startsWith('THREW')).length === 0,
      'race-balls: nothing throws on a phone');
    await host.ctx.close(); await mate.ctx.close();
  }

  console.log('\nPASS (' + pass.length + ')'); pass.forEach(x => console.log('  ✓ ' + x));
  console.log('\nFAIL (' + fail.length + ')'); fail.forEach(x => console.log('  ✗ ' + x));
  await b.close();
})();
