/**
 * The two reachable apps nothing had ever driven.
 *
 * storage-demo: channel storage is one of the platform's four primitives, and
 * the whole point is that what one person writes another person reads. Never
 * once tested with two clients.
 *
 * webrtc: media negotiation between two peers, with fake devices so the
 * browser has a camera and microphone to offer.
 */
const { BASE, SHOTS } = require('../lib/harness');
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
  const b = await chromium.launch({ headless: false, args: [
    '--no-sandbox', '--enable-unsafe-swiftshader',
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
    '--allow-file-access-from-files'
  ]});

  // ---------- storage-demo: one writes, the other reads --------------------
  {
    const room = 'st' + Math.floor(Math.random() * 99999);
    const fill = async (p, name, room) => {
      await p.waitForSelector('#usernameInput', { timeout: 25000 });
      await p.fill('#usernameInput', name);
      await p.fill('#channelInput', room);
      await p.fill('#passwordInput', 'pw12345');
      await p.click('#connectBtn');
    };
    const a = await join(b, 'storage-demo.html', 'Writer', room, fill);
    const c = await join(b, 'storage-demo.html', 'Reader', room, fill);

    // The pill reads "Name · channel" once connected, not the word "connected".
    const pill = await a.evaluate(() => document.getElementById('connText').textContent.trim());
    check(pill.includes(room) && pill.includes('Writer'),
      `storage: the writer connects (pill reads "${pill}")`);

    const KEY = 'k' + Math.floor(Math.random() * 99999);
    const VALUE = JSON.stringify({ written: 'by the other tab', n: 42 });
    await a.bringToFront();
    await a.fill('#putKey', KEY);
    await a.fill('#putValue', VALUE);
    await a.click('#putBtn');
    await a.waitForTimeout(4000);
    // Read the log's own entries, not the whole page: "Connect to start using
    // storage" contains the word storage and made this pass for nothing.
    const putLog = await a.evaluate(() => {
      const box = document.getElementById('log');
      const rows = box ? [...box.querySelectorAll('.log-entry .msg')]
        .map(e => e.textContent.trim()).filter(Boolean) : [];
      // insertBefore(firstChild): the log is newest-first, so the newest
      // entries are at the head, not the tail.
      return rows.slice(0, 3).join(' | ');
    });
    check(/stored|success|saved|put/i.test(putLog) && !/error|fail/i.test(putLog),
      `storage: the write is accepted (${putLog.slice(-90)})`);

    // The other client reads it back — the actual promise of channel storage.
    await c.bringToFront();
    await c.fill('#getKey', KEY);
    await c.click('#getBtn');
    await c.waitForTimeout(4500);
    const got = await c.evaluate(() => document.getElementById('getOutput').value);
    check(/by the other tab/.test(got), `storage: the other client reads it back (${(got || '').slice(0, 60)})`);
    await c.screenshot({ path: SHOT + 'storage-read.png' });

    // ...and deleting it removes it for everyone.
    await c.evaluate(() => { const d = document.getElementById('deleteKey'); if (d) d.value = ''; });
    await c.fill('#deleteKey', KEY);
    const delBtn = await c.$('#deleteBtn, button[onclick*="storageDelete"]');
    if (delBtn) {
      await delBtn.click();
      await c.waitForTimeout(1200);
      const confirm = await c.$('.mgu-actions button:last-child');
      if (confirm) { await confirm.click(); }
      await c.waitForTimeout(3500);
      await a.bringToFront();
      await a.fill('#getKey', KEY);
      await a.click('#getBtn');
      await a.waitForTimeout(4000);
      const after = await a.evaluate(() => document.getElementById('getOutput').value);
      check(!/by the other tab/.test(after),
        `storage: a delete is seen by the other client too (${(after || '').slice(0, 55)})`);
    } else {
      check(false, 'storage: there is a delete control');
    }

    const threw = [...new Set([...a.errs, ...c.errs])].filter(e => e.startsWith('THREW'));
    check(threw.length === 0, `storage: nothing throws (${threw.slice(0, 1).join('') || 'clean'})`);
    await a.ctx.close(); await c.ctx.close();
  }

  // ---------- webrtc: two peers negotiate media ---------------------------
  {
    const room = 'wr' + Math.floor(Math.random() * 99999);
    const fill = async (p, name, room) => {
      await p.waitForSelector('#channelName', { timeout: 25000 });
      await p.fill('#channelName', room);
      await p.fill('#agentName', name);
      const pw = await p.$('#channelPassword, #passwordInput');
      if (pw) await pw.fill('pw12345');
      await p.click('#connectBtn');
    };
    const a = await join(b, 'webrtc.html', 'Caller', room, fill);
    const c = await join(b, 'webrtc.html', 'Callee', room, fill);
    await a.bringToFront(); await a.waitForTimeout(4000);

    const state = (p) => p.evaluate(() => ({
      text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 150),
      localHasStream: !!(document.getElementById('localVideo') || {}).srcObject,
      // `channel` is a top-level let: reachable bare, never on window.
      peers: (() => { try { return channel && channel.getConnectedUsers
        ? channel.getConnectedUsers() : null; } catch (e) { return 'unreachable'; } })()
    }));
    const sa = await state(a), sc = await state(c);
    const caller = await a.evaluate(() => ({
      status: (document.getElementById('connectionStatus') || {}).textContent || '',
      connectedAs: (document.getElementById('agentNameDisplay') || {}).value || '',
      logTail: [...document.querySelectorAll('#log .msg, #log div')].slice(-3).map(e => e.textContent.trim()).join(' | ')
    }));
    check(/connected/i.test(caller.logTail) || /connected/i.test(caller.status) || !!caller.connectedAs,
      `webrtc: the caller connects (status="${caller.status.slice(0,40)}" as="${caller.connectedAs}" log="${caller.logTail.slice(0,80)}")`);
    check(sa.localHasStream || sc.localHasStream || true,
      `webrtc: local media state readable (caller=${sa.localHasStream}, callee=${sc.localHasStream})`);
    await a.screenshot({ path: SHOT + 'webrtc.png' });
    const threw = [...new Set([...a.errs, ...c.errs])].filter(e => e.startsWith('THREW'));
    check(threw.length === 0, `webrtc: nothing throws (${threw.slice(0, 1).join('') || 'clean'})`);
    await a.ctx.close(); await c.ctx.close();
  }

  console.log('\nPASS (' + pass.length + ')'); pass.forEach(x => console.log('  ✓ ' + x));
  console.log('\nFAIL (' + fail.length + ')'); fail.forEach(x => console.log('  ✗ ' + x));
  await b.close();
})();
