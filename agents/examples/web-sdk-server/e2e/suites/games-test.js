/**
 * Does the game actually start for both players?
 *
 * Pictionary and Party Physics both looked finished and could not be played
 * by two people — in Party Physics the guest could never enter a game at all,
 * because START_GAME used a signature that never matched. That failure is
 * invisible to every static check, so each remaining game is asked the same
 * question: host presses start, does the guest end up in a running game.
 */
const { BASE, SHOTS } = require('../lib/harness');
const { chromium } = require('playwright');
const pass = [], fail = [];
const check = (ok, w) => (ok ? pass : fail).push(w);
const SHOT = SHOTS + '/';

async function join(b, path, name, room) {
  const ctx = await b.newContext({ viewport: { width: 1300, height: 880 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('THREW: ' + e.message.split('\n')[0].slice(0, 90)));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 90)); });
  p.errs = errs; p.ctx = ctx;
  await p.goto(BASE + '/apps/mini-games/' + path, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // A loaded machine — several browsers up at once — can push a page that
  // normally shows its connect button in under a second past a 25s wait. That
  // is the harness being starved, not the game being broken, so the join is
  // given room and one retry. A page that is genuinely broken still fails both.
  await p.waitForSelector('#usernameInput', { timeout: 60000 });
  await p.fill('#usernameInput', name);
  await p.fill('#channelInput', room);
  await p.fill('#passwordInput', 'pw12345');
  try {
    await p.click('#connectBtn', { timeout: 30000 });
  } catch (e) {
    await p.waitForTimeout(2000);
    await p.click('#connectBtn', { timeout: 30000 });
  }
  await p.waitForTimeout(13000);
  return p;
}

/** "in a running game" = the lobby/waiting UI is gone and a play surface is up. */
const RUNNING = () => {
  const vis = (sel) => [...document.querySelectorAll(sel)].some(e => {
    const r = e.getBoundingClientRect();
    return r.width > 40 && r.height > 40 && getComputedStyle(e).visibility !== 'hidden';
  });
  const t = document.body.innerText;
  return {
    lobby: /waiting for (the )?host|waiting for players|lobby/i.test(t),
    canvas: vis('canvas'),
    playing: vis('.game-area, .game-board, #gameCanvas, canvas, .question-area, .quiz-area, .rink'),
    snippet: t.replace(/\s+/g, ' ').slice(0, 110)
  };
};

async function game(b, label, path, start, playing, minPlayers) {
  const room = 'g' + Math.floor(Math.random() * 99999);
  let ps = [];
  try {
    const names = ['Alpha', 'Beta', 'Gamma'].slice(0, minPlayers || 2);
    for (const n of names) ps.push(await join(b, path, n, room));
    const [host, guest] = ps;
    await host.bringToFront(); await host.waitForTimeout(4000);
    const started = await host.evaluate(start).catch(e => 'threw: ' + e.message.slice(0, 60));
    await host.waitForTimeout(9000);
    await guest.bringToFront();

    // Poll rather than take one snapshot: a game can take a beat to swap the
    // lobby for the play surface, and a single read at a fixed moment reports
    // a slow start as a broken one.
    const settle = async (p) => {
      let last = await p.evaluate(RUNNING);
      for (let i = 0; i < 10 && !playing.test(last.snippet); i++) {
        await p.waitForTimeout(1500);
        last = await p.evaluate(RUNNING);
      }
      return last;
    };
    const g = await settle(guest);
    const h = await settle(host);
    // A start call returning undefined is the normal case; only a throw is a
    // failure. And "in a game" is asked per game, because each one shows its
    // running state differently — a generic play-surface selector missed most.
    check(!String(started).startsWith('threw'),
      `${label}: the host can start (${started === undefined ? 'ok' : started})`);
    check(playing.test(h.snippet), `${label}: the host is in a game (${h.snippet.slice(0, 62)})`);
    check(playing.test(g.snippet),
      `${label}: the guest is in the game too (${g.snippet.slice(0, 62)})`);
    const threw = [...new Set(ps.flatMap(p => p.errs))].filter(e => e.startsWith('THREW'));
    check(threw.length === 0, `${label}: nothing throws (${threw.slice(0, 1).join('') || 'clean'})`);
    await guest.screenshot({ path: SHOT + 'game-' + label + '.png' });
  } catch (e) {
    check(false, `${label}: ran at all (${e.message.slice(0, 70)})`);
  }
  for (const p of ps) { try { await p.ctx.close(); } catch (e) {} }
}

(async () => {
  const b = await chromium.launch({ headless: false,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });

  await game(b, 'air-hockey',    'air-hockey/index.html',    () => window.startGame(), /Blue \d+ Red \d+/);
  await game(b, 'quiz-battle',   'quiz-battle/index.html',   () => window.quizGame.startGame(), /QUESTION \d+\/\d+/);
  await game(b, 'reactor',       'reactor/index.html',       () => window.startGame(), /Round: \d+\/\d+/);
  await game(b, 'fall-guys',     'fall-guys/index.html',     () => window.fallGuysGame.hostStartGame(), /Place/);
  await game(b, 'race-balls',    'race-balls/index.html',    () => window.raceBallsGame.hostStartRace(), /PLACE/);
  await game(b, 'find-the-liar', 'find-the-liar/index.html', () => window.liarGame.requestNewRound(), /Round \d+\/\d+/, 3);

  console.log('\nPASS (' + pass.length + ')'); pass.forEach(x => console.log('  ✓ ' + x));
  console.log('\nFAIL (' + fail.length + ')'); fail.forEach(x => console.log('  ✗ ' + x));
  await b.close();
})();
