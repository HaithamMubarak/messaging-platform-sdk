/**
 * The reachable app nothing had ever driven.
 *
 * Channel storage (now Pulse's Raw storage tab) is one of the platform's primitives, and
 * the whole point is that what one person writes another person reads. Never
 * once tested with two clients.
 *
 * This suite also covered apps/webrtc.html, the bare media-negotiation demo.
 * That page is gone: Rooms is the same negotiation as a product people can
 * actually use, and two cards for one primitive is one card too many.
 */
const { BASE, SHOTS, LAUNCH } = require('../lib/harness');
const { chromium } = require('playwright');
const pass = [], fail = [];
const check = (ok, w) => (ok ? pass : fail).push(w);
const SHOT = SHOTS + '/';

async function join(b, path, name, room, fill) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 880 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('THREW: ' + e.message.split('\n')[0].slice(0, 95)));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 95)); });
  p.errs = errs; p.ctx = ctx;
  await p.goto(BASE + '/apps/' + path, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await fill(p, name, room);
  await p.waitForTimeout(12000);
  return p;
}

(async () => {
  const b = await chromium.launch({ ...LAUNCH, args: [...LAUNCH.args,
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--allow-file-access-from-files'] });

  // ---------- raw storage: one writes, the other reads ----------------------
  // The Channel storage demo became Pulse's "Raw storage" tab in hub phase 4;
  // the calls and the promise are the same.
  {
    const room = 'st' + Math.floor(Math.random() * 99999);
    const fill = async (p, name, room) => {
      p.on('dialog', d => d.accept());   // Delete asks first, for everyone on the channel
      await p.waitForSelector('#usernameInput', { timeout: 25000 });
      await p.fill('#usernameInput', name);
      await p.fill('#channelInput', room);
      await p.fill('#passwordInput', 'pw12345');
      await p.click('#connectBtn');
    };
    const a = await join(b, 'pulse/index.html?tab=storage', 'Writer', room, fill);
    const c = await join(b, 'pulse/index.html?tab=storage', 'Reader', room, fill);
    check(await a.evaluate(() => !!(window.pulseApp && window.pulseApp.connected)), 'storage: the writer connects');
    check(await a.evaluate(() => !document.getElementById('tabRaw').hidden), 'storage: ?tab=storage opens the Raw storage tab');

    const KEY = 'k' + Math.floor(Math.random() * 99999);
    const op = async (p, name, key, value) => {
      await p.bringToFront();
      await p.fill('#rawKey', key);
      if (value !== undefined) await p.fill('#rawValue', value);
      await p.click('[data-raw-op="' + name + '"]');
      await p.waitForTimeout(4000);
      return p.evaluate(() => document.getElementById('rawOut').textContent);
    };

    const put = await op(a, 'put', KEY, JSON.stringify({ written: 'by the other tab', n: 42 }));
    check(/PUT .*: ok/.test(put), 'storage: the write is accepted (' + put.split('\n')[0] + ')');
    // The other client reads it back — the actual promise of channel storage.
    const got = await op(c, 'get', KEY);
    check(/by the other tab/.test(got), 'storage: the other client reads it back (' + got.slice(0, 60).replace(/\s+/g, ' ') + ')');
    await c.screenshot({ path: SHOT + 'storage-read.png' });

    // ...and deleting it removes it for everyone.
    const del = await op(c, 'del', KEY);
    check(/DELETE .*: ok/.test(del), 'storage: the reader can delete it (' + del.split('\n')[0] + ')');
    const after = await op(a, 'get', KEY);
    check(!/by the other tab/.test(after), 'storage: a delete is seen by the other client too (' + after.slice(0, 55).replace(/\s+/g, ' ') + ')');

    const threw = [...new Set([...a.errs, ...c.errs])].filter(e => e.startsWith('THREW'));
    check(threw.length === 0, `storage: nothing throws (${threw.slice(0, 1).join('') || 'clean'})`);
    await a.ctx.close(); await c.ctx.close();
  }

  console.log('\nPASS (' + pass.length + ')'); pass.forEach(x => console.log('  ✓ ' + x));
  console.log('\nFAIL (' + fail.length + ')'); fail.forEach(x => console.log('  ✗ ' + x));
  await b.close();
})();
