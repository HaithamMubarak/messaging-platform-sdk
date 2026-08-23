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
  ['fall-guys',    'mini-games/fall-guys/index.html'],
  ['find-the-liar','mini-games/find-the-liar/index.html'],
  ['quiz-battle',  'mini-games/quiz-battle/index.html'],
  ['race-balls',   'mini-games/race-balls/index.html'],
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
  await p.waitForSelector('#usernameInput, #agentName, #playerName', { timeout: 25000 });
  const fill = async (sels, val) => {
    for (const s of sels) { const el = await p.$(s); if (el) { await el.fill(val); return s; } }
    return null;
  };
  await fill(['#usernameInput', '#agentName', '#playerName'], name);
  await fill(['#channelInput', '#channelName', '#roomInput'], room);
  await fill(['#passwordInput', '#channelPassword', '#roomPassword'], 'pw12345');
  const btn = await p.$('#connectBtn, #start, #joinBtn');
  if (!btn) throw new Error('no connect button');
  await btn.click();
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
      const sees = await a.evaluate(() => {
        const t = document.body.innerText;
        return { peer: /Beta/.test(t), self: /Alpha/.test(t),
                 connected: /connect(ed)?/i.test(t) && !/disconnected/i.test(t.slice(0, 400)) };
      });
      const seesBack = await c.evaluate(() => /Alpha/.test(document.body.innerText));
      const errs = [...new Set([...a.errs, ...c.errs])];
      const threw = errs.filter(e => e.startsWith('THREW'));
      verdict = (sees.peer && seesBack) ? (threw.length ? 'ROSTER ok, THREW' : 'ok')
              : (sees.peer || seesBack) ? 'ONE-WAY roster' : 'NO PEER VISIBLE';
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
  console.log('ok: ' + rows.filter(r => r[1] === 'ok').length + '/' + rows.length);
  await b.close();
})();
