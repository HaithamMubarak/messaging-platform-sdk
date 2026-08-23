/**
 * cloud-connection-demo: the page now has its own data layer and tells the
 * reader to open a second tab. Both claims are checked by doing exactly that.
 */
const { BASE, SHOTS } = require('../lib/harness');
const { chromium } = require('playwright');
const OUT = SHOTS + '/';
const ROOM = 'cd' + Math.floor(Math.random() * 99999);
const pass = [], fail = [];
const check = (ok, w) => (ok ? pass : fail).push(w);

async function open(b, name) {
  const ctx = await b.newContext({ viewport: { width: 1200, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message.split('\n')[0].slice(0, 100)));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 100)); });
  p.errs = errs;
  await p.goto(BASE + '/apps/cloud-connection-demo.html', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2500);
  await p.fill('#cloudChannelName', ROOM);
  await p.fill('#cloudChannelPassword', 'pw12345');
  await p.fill('#cloudAgentName', name);
  await p.click('#cloudConnectBtn');
  await p.waitForTimeout(11000);
  return p;
}
const log = (p) => p.evaluate(() => document.getElementById('messageLog').innerText);

(async () => {
  const b = await chromium.launch({ headless: false, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });

  const a = await open(b, 'TabOne');
  // the terminal app's class must not be what powers this page any more
  const wiring = await a.evaluate(() => ({
    own: typeof window.CloudDemoConnection === 'function',
    terminal: typeof window.TerminalSharing !== 'undefined',
    instance: window.cloudInteraction ? window.cloudInteraction.constructor.name : null
  }));
  check(wiring.own, 'the page ships its own connection class');
  check(!wiring.terminal, 'and no longer loads the terminal app\'s TerminalSharing');

  check(/Connected as TabOne/.test(await log(a)), 'the first tab connects');

  // the copy tells the reader to open a second tab — so do that
  const intro = await a.evaluate(() => document.querySelector('.demo-intro')?.innerText || '');
  check(/second tab/i.test(intro), 'the page says to open a second tab');

  const c = await open(b, 'TabTwo');
  await a.bringToFront(); await a.waitForTimeout(4000);
  const roster = await a.evaluate(() => document.getElementById('cloudAgentsList').innerText);
  check(/TabTwo/.test(roster), `the first tab sees the second in the agent list ("${roster.replace(/\s+/g,' ').slice(0,40)}")`);

  // ...and a test message crosses between them, which is what the copy promises
  await c.bringToFront();
  await c.evaluate(() => sendTestMessage());
  await c.waitForTimeout(3000);
  await a.bringToFront(); await a.waitForTimeout(3000);
  const received = await log(a);
  check(/Message from TabTwo/.test(received),
        `the message arrives in the other tab's log (${received.split('\n').pop().slice(0,60)})`);
  await a.screenshot({ path: OUT + 'cloud-demo.png', fullPage: true });

  check([...a.errs, ...c.errs].length === 0,
        `no console errors (${[...new Set([...a.errs, ...c.errs])].slice(0,2).join(' | ') || 'clean'})`);

  console.log('\nPASS (' + pass.length + ')'); pass.forEach(x => console.log('  ✓ ' + x));
  console.log('\nFAIL (' + fail.length + ')'); fail.forEach(x => console.log('  ✗ ' + x));
  await b.close();
})();
