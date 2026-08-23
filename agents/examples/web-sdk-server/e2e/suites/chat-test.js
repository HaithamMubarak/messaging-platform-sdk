/**
 * chat.html: three faults, one mistake — the code treated the message column
 * as the scrolling element, and .chat-body is. Driven through the real UI,
 * because the page's script is wrapped in an IIFE and has no test surface.
 */
const { BASE, SHOTS } = require('../lib/harness');
const { chromium } = require('playwright');
const OUT = SHOTS + '/';
const ROOM = 'ch' + Math.floor(Math.random() * 99999);
const pass = [], fail = [];
const check = (ok, w) => (ok ? pass : fail).push(w);

async function join(ctx, name) {
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message.split('\n')[0].slice(0,90)));
  p.on('console', m => { if (m.type()==='error') errs.push(m.text().slice(0,90)); });
  p.errs = errs;
  await p.goto(BASE + '/apps/chat.html', {waitUntil:'domcontentloaded'});
  await p.waitForSelector('#start', {timeout:25000});
  await p.fill('#channelName', ROOM);
  await p.fill('#channelPassword', 'pw12345');
  await p.fill('#agentName', name);
  await p.click('#start');
  await p.waitForTimeout(9000);
  return p;
}
const say = async (p, t) => { await p.fill('#agentmsg', t); await p.click('#submitmsg'); await p.waitForTimeout(420); };
const body = (p) => p.evaluate(() => { const b=document.querySelector('.chat-body');
  return {h:b.scrollHeight,c:b.clientHeight,top:Math.round(b.scrollTop)}; });

(async () => {
  const b = await chromium.launch({headless:false,args:['--no-sandbox','--enable-unsafe-swiftshader']});
  const ctx = await b.newContext({viewport:{width:1200,height:800}});

  const api = await (async () => { const p = await ctx.newPage();
    await p.goto(BASE + '/apps/chat.html',{waitUntil:'domcontentloaded'});
    await p.waitForTimeout(2500);
    const v = await p.evaluate(() => typeof ApiConfig !== 'undefined' ? ApiConfig.getMessagingServiceUrl() : 'NO ApiConfig');
    await p.close(); return v; })();
  // On localhost api-config's documented fallback IS the public host, so the
  // assertion is that the value comes from the resolver at all — the page used
  // to carry the literal regardless of where it was served.
  check(typeof api === 'string' && api.endsWith('/messaging-service'),
    `the API base comes from ApiConfig ("${api}")`);

  const a = await join(ctx, 'Ann');
  const c = await join(ctx, 'Bob');
  await a.bringToFront(); await a.waitForTimeout(2500);

  // Connect notices land in the Events panel, not the message column, so the
  // column is legitimately empty until somebody says something.
  const connected = await a.evaluate(() => /Connected/.test(document.body.innerText));
  check(connected, 'both clients connected');

  for (let i = 0; i < 25; i++) await say(a, 'filler line ' + i);
  await a.waitForTimeout(1200);
  const rows1 = await a.evaluate(() => document.getElementById('app-container').childElementCount);
  check(rows1 >= 25, `the messages land in the column, not the scroller (${rows1} rows)`);
  const s1 = await body(a);
  check(s1.h > s1.c, `the message area overflows (${s1.h} > ${s1.c})`);
  check(s1.top > 0, `it auto-scrolled to the newest message (scrollTop ${s1.top})`);

  await a.evaluate(() => { document.querySelector('.chat-body').scrollTop = 0; });
  await a.waitForTimeout(400);
  await say(c, 'one more while you are reading back');
  await a.bringToFront(); await a.waitForTimeout(2500);
  const bub = await a.evaluate(() => { const e=document.getElementById('newMessagesBubble');
    return {shown:getComputedStyle(e).display!=='none', label:e.textContent.trim()}; });
  check(bub.shown, `the new-messages bubble appears while reading back (${bub.label})`);
  await a.screenshot({path: OUT+'chat-bubble.png'});

  if (bub.shown) {
    await a.click('#newMessagesBubble'); await a.waitForTimeout(700);
    const after = await a.evaluate(() => { const b=document.querySelector('.chat-body');
      return {atBottom: b.scrollHeight-(b.scrollTop+b.clientHeight) < 10,
              hidden: getComputedStyle(document.getElementById('newMessagesBubble')).display==='none'}; });
    check(after.atBottom, 'clicking it jumps to the latest message');
    check(after.hidden, 'and the bubble goes away');
  }

  await a.click('#clear'); await a.waitForTimeout(800);
  const confirm = await a.$('.mgu-actions button:last-child');
  if (confirm) { await confirm.click(); await a.waitForTimeout(900); }
  const cleared = await a.evaluate(() => ({
    column: !!document.getElementById('app-container'),
    bubble: !!document.getElementById('newMessagesBubble'),
    rows: document.getElementById('app-container') ? document.getElementById('app-container').childElementCount : -1 }));
  check(cleared.column, 'clearing leaves the message column in the page');
  check(cleared.bubble, 'clearing leaves the new-messages bubble in the page');
  check(cleared.rows === 0, `and it actually cleared (${cleared.rows} rows)`);

  await say(c, 'still alive after a clear');
  await a.bringToFront(); await a.waitForTimeout(2500);
  const revived = await a.evaluate(() => document.getElementById('app-container').childElementCount > 0);
  check(revived, 'messages still arrive after clearing — the real consequence of the old bug');

  console.log('\nPASS ('+pass.length+')'); pass.forEach(x=>console.log('  ✓ '+x));
  console.log('\nFAIL ('+fail.length+')'); fail.forEach(x=>console.log('  ✗ '+x));
  console.log('errors:', [...new Set([...a.errs,...c.errs])].slice(0,4));
  await b.close();
})();
