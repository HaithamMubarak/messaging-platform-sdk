/**
 * Party Physics: five abilities behind one key, plus the wiring that had to
 * exist first — a guest could never actually enter a game, so "the ability
 * works" is only meaningful once two clients are both playing.
 */
const { BASE, SHOTS } = require('../lib/harness');
const { chromium } = require('playwright');
const OUT = SHOTS + '/';
const ROOM = 'pp' + Math.floor(Math.random() * 99999);
const pass = [], fail = [];
const check = (ok, w) => (ok ? pass : fail).push(w);

async function join(b, name) {
  const ctx = await b.newContext({ viewport: { width: 1320, height: 880 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message.split('\n')[0].slice(0, 100)));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 100)); });
  p.errs = errs;
  await p.goto(BASE + '/apps/mini-games/party-physics/index.html', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#usernameInput', { timeout: 30000 });
  await p.fill('#usernameInput', name);
  await p.fill('#channelInput', ROOM);
  await p.fill('#passwordInput', 'pw12345');
  await p.click('#connectBtn');
  await p.waitForTimeout(13000);
  return p;
}
const hud = (p) => p.evaluate(() => ({
  label: (document.getElementById('abilityLabel') || {}).textContent,
  key: (document.getElementById('abilityKey') || {}).textContent,
  cd: (document.getElementById('cooldownValue') || {}).textContent,
  shown: !document.getElementById('playerStats').classList.contains('hidden'),
  hp: (document.getElementById('hpValue') || {}).textContent
}));

(async () => {
  const b = await chromium.launch({ headless: false,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
  const host = await join(b, 'Hostie');
  const guest = await join(b, 'Guestie');

  // every character card explains its Q
  const cards = await host.evaluate(() => [...document.querySelectorAll('.character-btn')].map(el => ({
    a: el.dataset.archetype,
    text: (el.querySelector('.char-ability') || {}).textContent || '' })));
  check(cards.length === 5, `all five characters are offered (${cards.length})`);
  check(cards.every(c => /\(Q\)/.test(c.text) && c.text.length > 25),
        `each card says what Q does (${cards.map(c => c.a).join(', ')})`);

  // guest picks a different archetype, host starts
  await guest.bringToFront();
  await guest.evaluate(() => partyPhysicsGame.selectCharacter('bear'));
  await guest.waitForTimeout(2500);
  await host.bringToFront();
  await host.evaluate(() => partyPhysicsGame.selectCharacter('frog'));
  await host.waitForTimeout(1500);
  const errsBefore = host.errs.length + guest.errs.length;
  await host.evaluate(() => partyPhysicsGame.hostStartGame());
  await host.waitForTimeout(9000);

  const h1 = await hud(host);
  check(h1.shown, 'the host is playing (stats panel up)');
  check(/frog|buff|random/i.test(h1.label || ''), `the HUD names the host's ability ("${h1.label}")`);
  check(h1.key === 'Q', `and the key that fires it ("${h1.key}")`);

  await guest.bringToFront(); await guest.waitForTimeout(4000);
  const g1 = await hud(guest);
  check(g1.shown, 'the guest entered the game too — START_GAME reaches guests now');
  check(/bear|slam|ground/i.test(g1.label || ''), `the guest's HUD names their own ability ("${g1.label}")`);

  // fire it
  check((g1.cd || '').toLowerCase().includes('ready'), `the ability starts ready ("${g1.cd}")`);
  // Host first: it is the authority, so a host Q needs no network hop. If the
  // host fires and the guest does not, the fault is the request path, not the key.
  await host.bringToFront();
  // Held, not press(): press() releases in ~10ms and the input packet is
  // sampled at the tick rate, so a synthetic tap can fall between two samples.
  // A real tap, ~10ms down. This used to be dropped between two input samples.
  await host.keyboard.press('q');
  await host.waitForTimeout(1200);
  const h2 = await hud(host);
  check(/\d/.test(h2.cd || ''), `the host's Q puts it on cooldown ("${h2.cd}")`);

  await guest.bringToFront();
  await guest.evaluate(() => document.querySelector('canvas')?.focus());
  await guest.keyboard.down('q'); await guest.waitForTimeout(220); await guest.keyboard.up('q');
  await guest.waitForTimeout(1500);
  const g2 = await hud(guest);
  check(/\d/.test(g2.cd || ''), `the guest's Q puts it on cooldown ("${g2.cd}")`);
  await guest.screenshot({ path: OUT + 'pp-ability.png' });

  // and it comes back
  await guest.waitForTimeout(7000);
  const g3 = await hud(guest);
  check((g3.cd || '').toLowerCase().includes('ready'), `and it recharges ("${g3.cd}")`);

  // guest HUD is live, not frozen
  const live = await guest.evaluate(() => ({ hp: document.getElementById('hpValue').textContent,
    players: document.getElementById('playerCountValue').textContent }));
  check(live.players === '2' || Number(live.players) >= 2,
        `the guest sees both players (${live.players})`);
  check(/^\d+$/.test(live.hp), `the guest's HP is a real number from the host (${live.hp})`);

  check(host.errs.length + guest.errs.length === errsBefore,
        `no errors through a whole game (${[...new Set([...host.errs, ...guest.errs])].slice(0,3).join(' | ') || 'clean'})`);

  console.log('\nPASS (' + pass.length + ')'); pass.forEach(x => console.log('  ✓ ' + x));
  console.log('\nFAIL (' + fail.length + ')'); fail.forEach(x => console.log('  ✗ ' + x));
  console.log('\nerrors:', [...new Set([...host.errs, ...guest.errs])].slice(0, 6));
  await b.close();
})();
