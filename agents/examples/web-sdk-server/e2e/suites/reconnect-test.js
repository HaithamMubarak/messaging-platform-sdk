/**
 * The network blips. Somebody walks into a lift, the wifi hiccups, the tab
 * sleeps. UserConnectionBase has a whole reconnect ladder for this and nothing
 * had ever taken it for a walk.
 *
 * The test drops one client's network, brings it back, and asks the question
 * that matters: is that person in the room again, and can they still work?
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
  // chat.html predates the shared connection modal and has its own field ids.
  await p.waitForSelector('#usernameInput, #agentName', { timeout: 25000 });
  const shared = await p.$('#usernameInput');
  if (shared) {
    await p.fill('#usernameInput', name);
    await p.fill('#channelInput', room);
    await p.fill('#passwordInput', 'pw12345');
    await p.click('#connectBtn');
  } else {
    await p.fill('#agentName', name);
    await p.fill('#channelName', room);
    await p.fill('#channelPassword', 'pw12345');
    await p.click('#start');
  }
  await p.waitForTimeout(12000);
  return p;
}
const app = (p) => p.evaluate(() => {
  // Apps built on UserConnectionBase expose the roster directly.
  for (const k of Object.keys(window)) {
    const g = window[k];
    if (g && typeof g === 'object' && typeof g.getConnectedUsers === 'function') {
      try { return { key: k, connected: !!g.connected, users: g.getConnectedUsers() }; } catch (e) {}
    }
  }
  // chat.html holds an AgentConnection directly and has no roster API, so it is
  // read from the agent count it renders. Checked last: window.channel exists in
  // the other apps too, and matching on it first hijacked all of them.
  if (window.channel) {
    const n = Number((document.body.innerText.match(/Agents\s*\|?\s*(\d+)/) || [])[1] || 0);
    return { key: 'channel', connected: n > 0, users: new Array(n).fill('?'), count: n };
  }
  return null;
});

async function blip(b, label, path, work) {
  const room = 'rc' + Math.floor(Math.random() * 99999);
  let a, c;
  try {
    a = await join(b, path, 'Stayer', room);
    c = await join(b, path, 'Blipper', room);
    await a.bringToFront(); await a.waitForTimeout(4000);
    const before = await app(a);
    check(before && before.users.length === 2, `${label}: both are in the room to start (${JSON.stringify(before && before.users)})`);

    // Pull the floor out from under one of them.
    await c.ctx.setOffline(true);
    await c.bringToFront(); await c.waitForTimeout(9000);
    const down = await app(c);
    check(down !== null, `${label}: the offline client is still alive, not crashed (connected=${down && down.connected})`);

    // ...and put it back.
    await c.ctx.setOffline(false);
    let back = null;
    for (let i = 0; i < 20; i++) {
      await c.waitForTimeout(3000);
      back = await app(c);
      if (back && back.connected && back.users.length === 2) break;
    }
    check(back && back.connected,
      `${label}: it reconnects on its own (connected=${back && back.connected}, users=${JSON.stringify(back && back.users)})`);

    // The other side has to agree that they are back.
    let seen = null;
    for (let i = 0; i < 12; i++) {
      await a.bringToFront(); await a.waitForTimeout(2500);
      seen = await app(a);
      // chat renders a count, not names, so it is judged on the count coming back.
      if (seen && (seen.users.includes('Blipper') || seen.count === 2)) break;
    }
    check(seen && (seen.users.includes('Blipper') || seen.count === 2),
      `${label}: and the other side sees them again (${JSON.stringify(seen && seen.users)})`);

    if (work) {
      const ok = await work(a, c);
      check(ok === true, `${label}: they can still work together afterwards (${ok})`);
    }
    const threw = [...new Set([...a.errs, ...c.errs])].filter(e => e.startsWith('THREW'));
    check(threw.length === 0, `${label}: nothing throws through the whole blip (${threw.slice(0, 1).join('') || 'clean'})`);
    await c.screenshot({ path: SHOT + 'reconnect-' + label + '.png' });
  } catch (e) {
    check(false, `${label}: ran at all (${e.message.slice(0, 70)})`);
  }
  for (const p of [a, c]) { try { await p.ctx.close(); } catch (e) {} }
}

(async () => {
  const b = await chromium.launch({ headless: false,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });

  await blip(b, 'mind-map', 'mind-map/index.html', async (a, c) => {
    const before = await a.evaluate(() => window.mindMapApp.nodes.size);
    await c.bringToFront();
    await c.evaluate(() => window.mindMapApp.addNode());
    await c.waitForTimeout(3000);
    await a.bringToFront(); await a.waitForTimeout(5000);
    return (await a.evaluate(() => window.mindMapApp.nodes.size)) > before;
  });

  await blip(b, 'collab-doc', 'collab-doc/index.html', async (a, c) => {
    await c.bringToFront();
    await c.evaluate(() => window.collabDoc.editor.setValue('typed after the wifi came back'));
    await c.waitForTimeout(3000);
    await a.bringToFront(); await a.waitForTimeout(5000);
    return /typed after the wifi came back/.test(await a.evaluate(() => window.collabDoc.editor.getValue()));
  });

  await blip(b, 'chat', 'chat.html', null);

  console.log('\nPASS (' + pass.length + ')'); pass.forEach(x => console.log('  ✓ ' + x));
  console.log('\nFAIL (' + fail.length + ')'); fail.forEach(x => console.log('  ✗ ' + x));
  await b.close();
})();
