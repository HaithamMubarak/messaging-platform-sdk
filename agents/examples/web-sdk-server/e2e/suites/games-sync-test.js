/**
 * Two faults that only show up with two clients side by side, and that a
 * one-client test can never see.
 *
 * Quiz Battle: every client shuffled its own question pool and the host sent
 * only an index, so players answered different questions and were scored
 * against each other anyway. Each client also advanced on its own timer.
 *
 * Reactor: the header counter was markup that said "Players: 0" and was never
 * written to, in a game called 4-Player Reactor.
 */
const { BASE, SHOTS } = require('../lib/harness');
const { chromium } = require('playwright');
const pass = [], fail = [];
const check = (ok, w) => (ok ? pass : fail).push(w);

async function join(b, path, name, room) {
  const ctx = await b.newContext({ viewport: { width: 1250, height: 860 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('THREW: ' + e.message.split('\n')[0].slice(0, 90)));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 90)); });
  p.errs = errs; p.ctx = ctx;
  await p.goto(BASE + '/apps/mini-games/' + path, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#usernameInput', { timeout: 25000 });
  await p.fill('#usernameInput', name);
  await p.fill('#channelInput', room);
  await p.fill('#passwordInput', 'pw12345');
  await p.click('#connectBtn');
  await p.waitForTimeout(13000);
  return p;
}

(async () => {
  const b = await chromium.launch({ headless: false,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });

  // ---- quiz battle: one room, one question ------------------------------
  let room = 'qz' + Math.floor(Math.random() * 99999);
  const qa = await join(b, 'quiz-battle/index.html', 'Alpha', room);
  const qc = await join(b, 'quiz-battle/index.html', 'Beta', room);
  await qa.bringToFront(); await qa.waitForTimeout(3000);
  await qa.evaluate(() => window.quizGame.startGame());
  const q = (p) => p.evaluate(() => ({
    text: (document.querySelector('#questionText, .question-text') || {}).innerText || '',
    n: (document.body.innerText.match(/QUESTION (\d+)/) || [])[1]
  }));
  let agreed = 0, samples = 0, advanced = new Set();
  for (const wait of [5000, 5000, 6000]) {
    await qa.waitForTimeout(wait);
    const A = await q(qa);
    await qc.bringToFront(); await qc.waitForTimeout(600);
    const B = await q(qc);
    await qa.bringToFront();
    samples++;
    if (A.text && A.text === B.text && A.n === B.n) agreed++;
    advanced.add(A.text);
    check(A.text === B.text && A.n === B.n,
      `quiz: both players are on the same question (${(A.text || 'none').slice(0, 34)} | ${(B.text || 'none').slice(0, 34)})`);
  }
  check(advanced.size > 1, `quiz: the room moves through questions together (${advanced.size} seen)`);
  check([...new Set([...qa.errs, ...qc.errs])].filter(e => e.startsWith('THREW')).length === 0, 'quiz: nothing throws');
  await qa.ctx.close(); await qc.ctx.close();

  // ---- reactor: the counter tells the truth -----------------------------
  room = 'rc' + Math.floor(Math.random() * 99999);
  const ra = await join(b, 'reactor/index.html', 'Alpha', room);
  const rc = await join(b, 'reactor/index.html', 'Beta', room);
  await ra.bringToFront(); await ra.waitForTimeout(5000);
  const r = (p) => p.evaluate(() => ({
    shown: Number((document.body.innerText.match(/Players:\s*(\d+)/) || [])[1]),
    real: window.reactorGame.getConnectedUsers().length
  }));
  for (const [who, p] of [['host', ra], ['guest', rc]]) {
    await p.bringToFront(); await p.waitForTimeout(2500);
    const v = await p.evaluate(() => ({
      shown: Number((document.body.innerText.match(/Players:\s*(\d+)/) || [])[1]),
      real: window.reactorGame.getConnectedUsers().length }));
    check(v.shown === v.real && v.shown === 2,
      `reactor: the ${who} header counts the room (shows ${v.shown}, actually ${v.real})`);
  }
  check([...new Set([...ra.errs, ...rc.errs])].filter(e => e.startsWith('THREW')).length === 0, 'reactor: nothing throws');

  console.log('\nPASS (' + pass.length + ')'); pass.forEach(x => console.log('  ✓ ' + x));
  console.log('\nFAIL (' + fail.length + ')'); fail.forEach(x => console.log('  ✗ ' + x));
  await b.close();
})();
