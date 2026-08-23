/**
 * Pictionary, reworked to host-authoritative. Six faults were reported; each
 * one is driven through two real clients, because every one of them lived in
 * the gap between what a client knew and what it was allowed to decide.
 */
const { BASE, SHOTS } = require('../lib/harness');
const { chromium } = require('playwright');
const OUT = SHOTS + '/';
const ROOM = 'pic' + Math.floor(Math.random() * 99999);
const pass = [], fail = [];
const check = (ok, w) => (ok ? pass : fail).push(w);

async function join(b, name) {
  const ctx = await b.newContext({ viewport: { width: 1320, height: 880 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message.split('\n')[0].slice(0, 100)));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 100)); });
  p.errs = errs; p.who = name;
  await p.goto(BASE + '/apps/pictionary/index.html', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#usernameInput', { timeout: 30000 });
  await p.fill('#usernameInput', name);
  await p.fill('#channelInput', ROOM);
  await p.fill('#passwordInput', 'pw12345');
  await p.click('#connectBtn');
  await p.waitForTimeout(11000);
  return p;
}
const txt = (p, sel) => p.evaluate(s => (document.querySelector(s)?.innerText || '').trim(), sel);

(async () => {
  const b = await chromium.launch({ headless: false,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
  const host = await join(b, 'Artist');
  const guest = await join(b, 'Guesser');
  await host.bringToFront(); await host.waitForTimeout(4000);

  check(await host.evaluate(() => document.querySelectorAll('#playersList *').length > 0
        || /2/.test(document.getElementById('playerCount').innerText)), 'both players are in the room');

  // start a round
  await host.evaluate(() => window.pictionaryGame && pictionaryGame.startGame());
  await host.waitForTimeout(6000);
  await guest.bringToFront(); await guest.waitForTimeout(2500);

  // --- 3. the word is not broadcast ---------------------------------------
  const hostWord = await host.evaluate(() => window.pictionaryGame?.currentWord || null);
  const guestWord = await guest.evaluate(() => window.pictionaryGame?.currentWord || null);
  const guestSeesWord = await guest.evaluate(() =>
      document.getElementById('currentWordDisplay').innerText.trim());
  check(!!hostWord, `the artist is given a word (${hostWord ? 'yes' : 'no'})`);
  check(!guestWord, `the guesser is never told the word (currentWord=${JSON.stringify(guestWord)})`);
  check(!hostWord || !guestSeesWord.toLowerCase().includes(String(hostWord).toLowerCase()),
        `and it is not rendered on the guesser's screen ("${guestSeesWord.slice(0,30)}")`);

  // --- 5. the guest's clock runs -------------------------------------------
  const t1 = await txt(guest, '#timerValue');
  await guest.waitForTimeout(3200);
  const t2 = await txt(guest, '#timerValue');
  check(t1 !== t2 && t2 !== '0:00', `the guesser's timer counts down (${t1} then ${t2})`);

  // --- 1 + 2. a guesser can guess, and the room sees it --------------------
  const before = guest.errs.length;
  await guest.fill('#chatInput', 'definitelywrongguess');
  await guest.evaluate(() => pictionaryGame.sendGuess());
  await guest.waitForTimeout(2500);
  check(guest.errs.length === before,
        `guessing raises no error (${guest.errs.slice(before).join(' | ') || 'clean'})`);
  const guestChat = await txt(guest, '#chatMessages');
  check(/definitelywrongguess/.test(guestChat), 'the guesser sees their own guess');
  await host.bringToFront(); await host.waitForTimeout(2500);
  const hostChat = await txt(host, '#chatMessages');
  check(/definitelywrongguess/.test(hostChat), 'and the artist sees it too — the room watches the guessing');

  // --- the right answer scores, host-side ----------------------------------
  await guest.bringToFront();
  await guest.fill('#chatInput', String(hostWord || ''));
  await guest.evaluate(() => pictionaryGame.sendGuess());
  await guest.waitForTimeout(3000);
  const scored = await guest.evaluate(() =>
      /correct|guessed|\+\s*\d/i.test(document.getElementById('chatMessages').innerText));
  check(scored, 'a correct guess is confirmed by the host');
  await guest.screenshot({ path: OUT + 'pict-guest.png' });

  // --- 6. canvas coordinates on a scaled canvas ----------------------------
  const coord = await host.evaluate(() => {
    const c = document.getElementById('drawingCanvas');
    const r = c.getBoundingClientRect();
    if (!r.width || !c.width) return null;
    const g = window.pictionaryGame;
    if (!g || typeof g._canvasPos !== 'function') return 'no-helper';
    // _canvasPos takes two client coordinates, not an event.
    const mid = g._canvasPos(r.left + r.width / 2, r.top + r.height / 2);
    return { x: Math.round(mid.x), y: Math.round(mid.y), w: c.width, h: c.height,
             scaled: Math.abs(r.width - c.width) > 1 };
  });
  if (coord && coord !== 'no-helper') {
    const okx = Math.abs(coord.x - coord.w / 2) <= 2, oky = Math.abs(coord.y - coord.h / 2) <= 2;
    check(okx && oky,
      `the centre of a ${coord.scaled ? 'scaled' : 'unscaled'} canvas maps to its centre (${coord.x},${coord.y} of ${coord.w}x${coord.h})`);
  } else check(false, `_canvasPos is reachable (${coord})`);

  // --- pinch-zoom is no longer blocked -------------------------------------
  const vp = await host.evaluate(() =>
      document.querySelector('meta[name=viewport]')?.getAttribute('content') || '');
  check(!/user-scalable\s*=\s*no|maximum-scale/.test(vp), `the page can be zoomed ("${vp}")`);

  // --- 4. Play Again rebuilds a usable lobby everywhere --------------------
  await host.evaluate(() => { const g = window.pictionaryGame; g && g.endGame && g.endGame(); });
  await host.waitForTimeout(3000);
  const paErrBefore = host.errs.length + guest.errs.length;
  const restarted = await host.evaluate(() => {
    const g = window.pictionaryGame;
    if (!g || typeof g.restartGame !== 'function') return 'missing';
    try { g.restartGame(); return 'ok'; } catch (e) { return 'threw: ' + e.message; }
  });
  await host.waitForTimeout(3500);
  check(restarted === 'ok', `Play Again does not throw (${restarted})`);
  const lobbyBack = await host.evaluate(() =>
      !!document.getElementById('roundsPerGame') && !!document.getElementById('startGameBtn'));
  check(lobbyBack, 'and the lobby controls come back, so a second game can start');
  await guest.bringToFront(); await guest.waitForTimeout(2000);
  const guestLobby = await guest.evaluate(() => !!document.getElementById('roundsPerGame'));
  check(guestLobby, 'the guest gets the lobby back too');
  check(host.errs.length + guest.errs.length === paErrBefore,
        'restarting raises no error on either client');

  console.log('\nPASS (' + pass.length + ')'); pass.forEach(x => console.log('  ✓ ' + x));
  console.log('\nFAIL (' + fail.length + ')'); fail.forEach(x => console.log('  ✗ ' + x));
  console.log('\nhost errors:', [...new Set(host.errs)].slice(0, 5));
  console.log('guest errors:', [...new Set(guest.errs)].slice(0, 5));
  await b.close();
})();
