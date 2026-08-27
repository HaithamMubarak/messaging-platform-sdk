/**
 * The core loop of each collaborative app, with two live clients.
 *
 * Presence is not the product. These apps exist to move a change from one
 * person's screen to another's, so each one performs its characteristic
 * action on client A and asks client B whether it arrived.
 */
const { BASE, SHOTS } = require('../lib/harness');
const { chromium } = require('playwright');
const pass = [], fail = [];
const check = (ok, w) => (ok ? pass : fail).push(w);

async function join(b, path, name, room) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 880 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('THREW: ' + e.message.split('\n')[0].slice(0, 90)));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 90)); });
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

/** act on A, then read B. */
async function pair(b, label, path, act, read, expect) {
  const room = 'cl' + Math.floor(Math.random() * 99999);
  let a, c;
  try {
    a = await join(b, path, 'Alpha', room);
    c = await join(b, path, 'Beta', room);
    await a.bringToFront(); await a.waitForTimeout(3000);
    const before = await c.evaluate(read);
    await a.evaluate(act);
    await a.waitForTimeout(2500);
    await c.bringToFront(); await c.waitForTimeout(5000);
    const after = await c.evaluate(read);
    check(expect(before, after), `${label}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    const threw = [...new Set([...a.errs, ...c.errs])].filter(e => e.startsWith('THREW'));
    check(threw.length === 0, `${label}: nothing throws (${threw.slice(0, 1).join('') || 'clean'})`);
    await c.screenshot({ path: `${SHOTS}/core-${label}.png` });
  } catch (e) {
    check(false, `${label}: ran at all (${e.message.slice(0, 70)})`);
  }
  for (const p of [a, c]) { try { await p.ctx.close(); } catch (e) {} }
}

(async () => {
  const b = await chromium.launch({ headless: false,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });

  // collab-doc: typing reaches the other editor
  await pair(b, 'collab-doc', 'collab-doc/index.html',
    () => window.collabDoc.editor.setValue('hello from alpha'),
    () => (window.collabDoc.editor.getValue() || '').slice(0, 40),
    (x, y) => /hello from alpha/.test(y));

  // pulse: a vote is counted for everyone
  await pair(b, 'pulse', 'pulse/index.html',
    () => { const el = document.querySelector('[data-option]');
            window.pulseApp.vote(el.getAttribute('data-option')); },
    () => { const m = document.body.innerText.match(/(\d+) votes?/); return m ? Number(m[1]) : -1; },
    (x, y) => y > x);

  console.log('\nPASS (' + pass.length + ')'); pass.forEach(x => console.log('  ✓ ' + x));
  console.log('\nFAIL (' + fail.length + ')'); fail.forEach(x => console.log('  ✗ ' + x));
  await b.close();
})();
