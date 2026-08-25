/**
 * Two clients into every app that has never been driven through a browser.
 * chat.html taught the lesson: an app can look finished, pass every static
 * check, and not actually work. The bar here is deliberately low — both
 * clients connect, each sees the other, nothing throws — because anything
 * failing that is broken for real users.
 */
const { BASE, SHOTS } = require('../lib/harness');
const { chromium } = require('playwright');
const APPS = [
  ['chess',        'chess/index.html'],
  ['collab-doc',   'collab-doc/index.html'],
  ['drop',         'drop/index.html'],
  ['mind-map',     'mind-map/index.html'],
  ['pixel-art',    'pixel-art/index.html'],
  ['pulse',        'pulse/index.html'],
  ['air-hockey',   'mini-games/air-hockey/index.html'],
  ['find-the-liar','mini-games/find-the-liar/index.html'],
  ['quiz-battle',  'mini-games/quiz-battle/index.html'],
  ['reactor',      'mini-games/reactor/index.html']
];
const ROOT = BASE + '/apps/';

async function join(b, url, name, room) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('THREW: ' + e.message.split('\n')[0].slice(0, 90)));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 90)); });
  p.errs = errs; p.ctx = ctx;
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForSelector('#usernameInput, #agentName, #playerName', { timeout: 90000 });
  const fill = async (sels, val) => {
    for (const s of sels) { const el = await p.$(s); if (el) { await el.fill(val); return s; } }
    return null;
  };
  await fill(['#usernameInput', '#agentName', '#playerName'], name);
  await fill(['#channelInput', '#channelName', '#roomInput'], room);
  await fill(['#passwordInput', '#channelPassword', '#roomPassword'], 'pw12345');
  const btn = await p.$('#connectBtn, #start, #joinBtn');
  if (!btn) throw new Error('no connect button');
  // A click here is answered in under two seconds by every app on an idle
  // machine. The patience is for a starved harness, not for a slow page: this
  // sweep opens many browsers at once and a contended one can sit far past the
  // default. Not what this sweep is measuring, so it waits rather than fails.
  try {
    await btn.click({ timeout: 45000 });
  } catch (e) {
    await p.waitForTimeout(2000);
    await btn.click({ timeout: 30000 });
  }
  await p.waitForTimeout(12000);
  return p;
}

(async () => {
  const b = await chromium.launch({ headless: false,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
  const rows = [];
  for (const [name, path] of APPS) {
    const room = 'sm' + Math.floor(Math.random() * 99999);
    let a, c, verdict = '', detail = '';
    try {
      a = await join(b, ROOT + path, 'Alpha', room);
      c = await join(b, ROOT + path, 'Beta', room);
      await a.bringToFront(); await a.waitForTimeout(5000);
      // Ask the app's own roster where there is one, and fall back to the page
      // text. Two apps do not print peer names and used to look broken here:
      // chess seats nobody until a colour is chosen, and pulse is deliberately
      // anonymous — it shows "2 in the room" and no names at all.
      const roster = (p) => p.evaluate(() => {
        for (const k of Object.keys(window)) {
          const g = window[k];
          if (g && typeof g === 'object' && typeof g.getConnectedUsers === 'function') {
            try { return g.getConnectedUsers(); } catch (e) {}
          }
        }
        return null;
      });
      const ra = await roster(a), rc = await roster(c);
      const bothSee = (r, other) => Array.isArray(r)
        ? r.length >= 2
        : new RegExp(other).test('');
      const sees = await a.evaluate(() => {
        const t = document.body.innerText;
        return { peer: /Beta/.test(t) || /\b2\b[^\n]{0,20}(in the room|Players|Agents)/i.test(t),
                 self: /Alpha/.test(t),
                 connected: /connect(ed)?/i.test(t) && !/disconnected/i.test(t.slice(0, 400)) };
      });
      const seesBack = await c.evaluate(() => {
        const t = document.body.innerText;
        return /Alpha/.test(t) || /\b2\b[^\n]{0,20}(in the room|Players|Agents)/i.test(t);
      });
      if (Array.isArray(ra)) sees.peer = ra.length >= 2;
      const backOk = Array.isArray(rc) ? rc.length >= 2 : seesBack;
      void bothSee;
      const errs = [...new Set([...a.errs, ...c.errs])];
      const threw = errs.filter(e => e.startsWith('THREW'));
      verdict = (sees.peer && backOk) ? (threw.length ? 'ROSTER ok, THREW' : 'ok')
              : (sees.peer || backOk) ? 'ONE-WAY roster' : 'NO PEER VISIBLE';
      detail = errs.slice(0, 2).join(' | ');
      await a.screenshot({ path: `${SHOTS}/smoke-${name}.png` });
    } catch (e) {
      verdict = 'FAILED TO JOIN'; detail = e.message.slice(0, 80);
    }
    rows.push([name, verdict, detail]);
    console.log(name.padEnd(15) + verdict.padEnd(18) + detail);
    for (const p of [a, c]) { try { await p.ctx.close(); } catch (e) {} }
  }
  console.log('\n=== summary ===');
  rows.forEach(r => { if (r[1] !== 'ok') console.log('  ! ' + r[0] + ': ' + r[1] + '  ' + r[2]); });
  const good = rows.filter(r => r[1] === 'ok').length;
  console.log(good === rows.length
    ? 'all ' + rows.length + ' apps connect and see each other'
    : good + ' of ' + rows.length + ' apps connect and see each other');
  process.exitCode = good === rows.length ? 0 : 1;
  await b.close();
})();
