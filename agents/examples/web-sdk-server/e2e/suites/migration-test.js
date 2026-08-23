/**
 * The host closes their tab. Does the room survive?
 *
 * This is the most ordinary failure in the world — somebody shuts a laptop —
 * and nothing on the site tested it. The platform promotes a new host and
 * calls onBecomeHost; what matters is whether the remaining players end up in
 * a working room or a frozen one.
 *
 * Two survivors, so promotion has a choice to make and the surviving pair
 * still has somebody to talk to.
 */
const { BASE, SHOTS } = require('../lib/harness');
const { chromium } = require('playwright');
const pass = [], fail = [];
const check = (ok, w) => (ok ? pass : fail).push(w);
const SHOT = SHOTS + '/';

async function join(b, path, name, room) {
  const ctx = await b.newContext({ viewport: { width: 1240, height: 840 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('THREW: ' + e.message.split('\n')[0].slice(0, 95)));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 95)); });
  p.errs = errs; p.ctx = ctx;
  await p.goto(BASE + '/apps/' + path, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForSelector('#usernameInput', { timeout: 25000 });
  await p.fill('#usernameInput', name);
  await p.fill('#channelInput', room);
  await p.fill('#passwordInput', 'pw12345');
  await p.click('#connectBtn');
  await p.waitForTimeout(12000);
  return p;
}

/** Which of these pages thinks it is the host? */
const AM_I_HOST = () => {
  for (const k of ['pictionaryGame', 'airHockeyGame', 'fallGuysGame', 'reactorGame',
                   'pulseApp', 'liarGame', 'quizGame', 'raceBallsGame', 'partyPhysicsGame',
                   'mindMapApp', 'pixelArtApp', 'collabDoc', 'dropApp']) {
    const g = window[k];
    if (g && typeof g.isHost === 'function') { try { return { app: k, host: g.isHost() }; } catch (e) {} }
  }
  return { app: null, host: null };
};

async function migrate(b, label, path, after) {
  const room = 'mg' + Math.floor(Math.random() * 99999);
  let host, s1, s2;
  try {
    host = await join(b, path, 'Hostie', room);
    s1 = await join(b, path, 'Survivor', room);
    s2 = await join(b, path, 'Witness', room);
    await host.bringToFront(); await host.waitForTimeout(5000);

    const before = await host.evaluate(AM_I_HOST);
    check(before.host === true, `${label}: the first to arrive is the host (${before.app})`);

    const errsBefore = [...s1.errs, ...s2.errs].length;

    // Depart deterministically. Closing the tab relies on a pagehide beacon
    // reaching the server, and roughly one abrupt close in three does not get
    // it out — with no server-side presence timeout to catch it, the room then
    // keeps a ghost forever. That gap is real and is measured on its own in
    // ghost-departure.js; this suite is about whether host election works, so
    // it announces the departure rather than gambling on the beacon.
    try { await host.evaluate(() => {
      for (const k of Object.keys(window)) {
        const g = window[k];
        if (g && typeof g === 'object' && typeof g.disconnect === 'function'
            && typeof g.getConnectedUsers === 'function') { g.disconnect(); return; }
      }
    }); await host.waitForTimeout(1200); } catch (e) { /* closing anyway */ }
    await host.ctx.close();
    await s1.bringToFront();

    // Poll for the departure rather than waiting a fixed span. Detection is
    // about 3s in isolation, but under load it drifts, and a fixed wait turns
    // a slow notice into a false report of a frozen room.
    const roster = async () => s1.evaluate(() => {
      for (const k of Object.keys(window)) {
        const g = window[k];
        if (g && typeof g === 'object' && typeof g.getConnectedUsers === 'function') {
          try { return g.getConnectedUsers(); } catch (e) {}
        }
      }
      return null;
    });
    let seen = null;
    for (let i = 0; i < 16; i++) {
      await s1.waitForTimeout(3000);
      seen = await roster();
      if (Array.isArray(seen) && !seen.includes('Hostie')) break;
    }

    const a = await s1.evaluate(AM_I_HOST);
    const c = await s2.evaluate(AM_I_HOST);
    check(a.host === true || c.host === true,
      `${label}: somebody is promoted to host (survivor=${a.host}, witness=${c.host})`);
    check(!(a.host === true && c.host === true),
      `${label}: and only one of them is (survivor=${a.host}, witness=${c.host})`);

    check(Array.isArray(seen) && seen.length === 2 && !seen.includes('Hostie'),
      `${label}: the roster drops the departed host (${JSON.stringify(seen)})`);

    // Promotion is not the same as a working room. Whoever is host now has to
    // be able to do the thing only a host can do, and the two survivors still
    // have to reach each other.
    if (after) {
      const newHost = a.host === true ? s1 : s2;
      const other = a.host === true ? s2 : s1;
      try {
        const ok = await after(newHost, other);
        check(ok === true, `${label}: the room still works after migration (${ok})`);
      } catch (e) {
        check(false, `${label}: the room still works after migration (threw: ${e.message.slice(0, 55)})`);
      }
    }

    const threw = [...new Set([...s1.errs, ...s2.errs])].filter(e => e.startsWith('THREW'));
    check(threw.length === 0, `${label}: the survivors raise no error (${threw.slice(0, 1).join('') || 'clean'})`);
    await s1.screenshot({ path: SHOT + 'migrate-' + label + '.png' });
  } catch (e) {
    check(false, `${label}: ran at all (${e.message.slice(0, 70)})`);
  }
  for (const p of [s1, s2]) { try { await p.ctx.close(); } catch (e) {} }
}

(async () => {
  const b = await chromium.launch({ headless: false,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
  // The new host starts a round; the other player must see it begin.
  await migrate(b, 'pictionary', 'pictionary/index.html', async (h, o) => {
    await h.bringToFront();
    await h.evaluate(() => window.pictionaryGame.startGame());
    await h.waitForTimeout(7000);
    await o.bringToFront(); await o.waitForTimeout(5000);
    return o.evaluate(() => /_|Round\s*1/i.test(
      document.getElementById('currentWordDisplay').innerText + document.body.innerText));
  });

  await migrate(b, 'air-hockey', 'mini-games/air-hockey/index.html', async (h, o) => {
    await h.bringToFront();
    await h.evaluate(() => window.startGame && window.startGame());
    await h.waitForTimeout(7000);
    await o.bringToFront(); await o.waitForTimeout(5000);
    // Not a specific colour: the scoreboard correctly drops the departed
    // player's colour, so "Blue" is gone once the original host leaves.
    return o.evaluate(() => /CONTROLS[\s\S]*LEADERBOARD/.test(document.body.innerText));
  });

  await migrate(b, 'reactor', 'mini-games/reactor/index.html', async (h, o) => {
    await h.bringToFront();
    await h.evaluate(() => window.startGame && window.startGame());
    await h.waitForTimeout(7000);
    await o.bringToFront(); await o.waitForTimeout(5000);
    return o.evaluate(() => /Round:\s*1\/\d/.test(document.body.innerText));
  });

  // Content apps: a change made by either survivor must still reach the other.
  await migrate(b, 'pulse', 'pulse/index.html', async (h, o) => {
    const before = await o.evaluate(() => Number((document.body.innerText.match(/(\d+) votes?/) || [])[1] || 0));
    await h.bringToFront();
    await h.evaluate(() => { const el = document.querySelector('[data-option]');
      window.pulseApp.vote(el.getAttribute('data-option')); });
    await h.waitForTimeout(3000);
    await o.bringToFront(); await o.waitForTimeout(5000);
    const now = await o.evaluate(() => Number((document.body.innerText.match(/(\d+) votes?/) || [])[1] || 0));
    return now > before;
  });

  await migrate(b, 'mind-map', 'mind-map/index.html', async (h, o) => {
    const before = await o.evaluate(() => window.mindMapApp.nodes.size);
    await h.bringToFront();
    await h.evaluate(() => window.mindMapApp.addNode());
    await h.waitForTimeout(3000);
    await o.bringToFront(); await o.waitForTimeout(5000);
    return (await o.evaluate(() => window.mindMapApp.nodes.size)) > before;
  });

  await migrate(b, 'collab-doc', 'collab-doc/index.html', async (h, o) => {
    await h.bringToFront();
    await h.evaluate(() => window.collabDoc.editor.setValue('written after the host left'));
    await h.waitForTimeout(3000);
    await o.bringToFront(); await o.waitForTimeout(5000);
    return /written after the host left/.test(
      await o.evaluate(() => window.collabDoc.editor.getValue()));
  });
  console.log('\nPASS (' + pass.length + ')'); pass.forEach(x => console.log('  ✓ ' + x));
  console.log('\nFAIL (' + fail.length + ')'); fail.forEach(x => console.log('  ✗ ' + x));
  await b.close();
})();
