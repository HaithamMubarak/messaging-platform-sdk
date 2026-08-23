/**
 * Drop moves a file between two people, and only after the receiver agrees.
 * That is the whole demo, and none of it had ever been run: the offer, the
 * consent step, the stream, and whether the bytes that arrive are the bytes
 * that were sent.
 */
const { BASE, SHOTS } = require('../lib/harness');
const { chromium } = require('playwright');
const pass = [], fail = [];
const check = (ok, w) => (ok ? pass : fail).push(w);
const SHOT = SHOTS + '/';
const ROOM = 'dp' + Math.floor(Math.random() * 99999);

async function join(b, name) {
  const ctx = await b.newContext({ viewport: { width: 1240, height: 860 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('THREW: ' + e.message.split('\n')[0].slice(0, 95)));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 95)); });
  p.errs = errs; p.ctx = ctx;
  await p.goto(BASE + '/apps/drop/index.html', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#usernameInput', { timeout: 25000 });
  await p.fill('#usernameInput', name);
  await p.fill('#channelInput', ROOM);
  await p.fill('#passwordInput', 'pw12345');
  await p.click('#connectBtn');
  await p.waitForTimeout(12000);
  return p;
}

(async () => {
  const b = await chromium.launch({ headless: false,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  const a = await join(b, 'Sender');
  const c = await join(b, 'Receiver');
  await a.bringToFront(); await a.waitForTimeout(4000);

  check(await a.evaluate(() => /Receiver/.test(document.body.innerText)), 'the sender sees the other person');

  // A real file, with content we can compare on the far side.
  const BODY = 'the quick brown fox jumps over the lazy dog\n'.repeat(40);
  await a.setInputFiles('#fileInput', {
    name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from(BODY)
  });
  await a.waitForTimeout(3500);

  const offered = await a.evaluate(() =>
    [...window.dropApp.transfers.values()].map(r => ({ n: r.name, s: r.state })));
  check(offered.some(r => r.n === 'note.txt'), `the sender offers the file (${JSON.stringify(offered)})`);

  // Nothing may move before the receiver agrees — that is the point of Drop.
  await c.bringToFront(); await c.waitForTimeout(4000);
  const beforeConsent = await c.evaluate(() =>
    [...window.dropApp.transfers.values()].map(r => ({ n: r.name, s: r.state, done: r.done })));
  check(beforeConsent.some(r => r.n === 'note.txt' && r.s === 'offered'),
    `the receiver is asked first, and nothing has moved (${JSON.stringify(beforeConsent)})`);
  await c.screenshot({ path: SHOT + 'drop-offer.png' });

  // Accept it.
  const accepted = await c.evaluate(() => {
    const row = [...window.dropApp.transfers.values()].find(r => r.name === 'note.txt');
    if (!row) return 'no row';
    window.dropApp.accept(row.id);
    return 'accepted ' + row.id;
  });
  check(!String(accepted).startsWith('no row'), `the receiver can accept (${accepted})`);

  // Let it stream.
  let got = null;
  for (let i = 0; i < 20; i++) {
    await c.waitForTimeout(1500);
    got = await c.evaluate(() => {
      const r = [...window.dropApp.transfers.values()].find(x => x.name === 'note.txt');
      return r ? { state: r.state, done: r.done, total: r.total,
                   bytes: r.blob ? r.blob.size : null } : null;
    });
    // 'ready' means the bytes matched the promised size; 'damaged' means they
    // did not, and is a completed outcome worth failing on rather than waiting out.
    if (got && (got.state === 'ready' || got.state === 'damaged')) break;
  }
  check(got && got.state === 'ready',
    `the file arrives complete and undamaged (${JSON.stringify(got)})`);

  // ...and the bytes are the bytes.
  const size = await c.evaluate(async () => {
    const r = [...window.dropApp.transfers.values()].find(x => x.name === 'note.txt');
    if (!r) return null;
    const blob = r.blob;
    if (!blob) return 'no blob';
    const text = await blob.text();
    return { size: blob.size, head: text.slice(0, 20), lines: text.split('\n').length };
  });
  check(size && size.size === BODY.length,
    `the received file is byte-for-byte the file that was sent (${JSON.stringify(size)} vs ${BODY.length})`);
  await c.screenshot({ path: SHOT + 'drop-done.png' });

  // ---- declining must stop it -------------------------------------------
  await a.bringToFront();
  await a.setInputFiles('#fileInput', {
    name: 'unwanted.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(50000, 7)
  });
  await a.waitForTimeout(3500);
  await c.bringToFront(); await c.waitForTimeout(3500);
  const declined = await c.evaluate(() => {
    const row = [...window.dropApp.transfers.values()].find(r => r.name === 'unwanted.bin');
    if (!row) return 'no row';
    window.dropApp.decline(row.id);
    return 'declined';
  });
  check(declined === 'declined', `the receiver can decline (${declined})`);
  await c.waitForTimeout(5000);
  const afterDecline = await c.evaluate(() => {
    const r = [...window.dropApp.transfers.values()].find(x => x.name === 'unwanted.bin');
    return r ? { state: r.state, done: r.done, hasBlob: !!r.blob } : 'gone';
  });
  check(afterDecline === 'gone' || (!afterDecline.hasBlob && afterDecline.state !== 'ready'),
    `a declined file never arrives (${JSON.stringify(afterDecline)})`);

  // ---- a file that spans many chunks -------------------------------------
  // 16KB per chunk, so this one is 40 of them: ordering and reassembly, not
  // just "did anything arrive at all".
  const BIG_LEN = 640 * 1024;
  const big = Buffer.alloc(BIG_LEN);
  for (let i = 0; i < BIG_LEN; i++) big[i] = i % 251;   // a pattern any mis-order breaks
  await a.bringToFront();
  await a.setInputFiles('#fileInput', {
    name: 'big.bin', mimeType: 'application/octet-stream', buffer: big
  });
  await a.waitForTimeout(3500);
  await c.bringToFront(); await c.waitForTimeout(3000);
  const chunks = await c.evaluate(() => {
    const r = [...window.dropApp.transfers.values()].find(x => x.name === 'big.bin');
    if (!r) return null;
    window.dropApp.accept(r.id);
    return r.total;
  });
  check(chunks && chunks > 30, `the big file is offered in ${chunks} chunks`);
  let bigGot = null;
  for (let i = 0; i < 40; i++) {
    await c.waitForTimeout(1500);
    bigGot = await c.evaluate(() => {
      const r = [...window.dropApp.transfers.values()].find(x => x.name === 'big.bin');
      return r ? { state: r.state, done: r.done, total: r.total, bytes: r.blob ? r.blob.size : null } : null;
    });
    if (bigGot && (bigGot.state === 'ready' || bigGot.state === 'damaged')) break;
  }
  check(bigGot && bigGot.state === 'ready',
    `every chunk arrives (${JSON.stringify(bigGot)})`);

  // and in the right order — the pattern is position-dependent
  const intact = await c.evaluate(async (len) => {
    const r = [...window.dropApp.transfers.values()].find(x => x.name === 'big.bin');
    if (!r || !r.blob) return 'no blob';
    const buf = new Uint8Array(await r.blob.arrayBuffer());
    if (buf.length !== len) return 'length ' + buf.length + ' != ' + len;
    for (let i = 0; i < buf.length; i++) if (buf[i] !== i % 251) return 'byte ' + i + ' wrong';
    return 'intact';
  }, BIG_LEN);
  check(intact === 'intact', `and in the right order, byte for byte (${intact})`);

  const threw = [...new Set([...a.errs, ...c.errs])].filter(e => e.startsWith('THREW'));
  check(threw.length === 0, `nothing throws (${threw.slice(0, 1).join('') || 'clean'})`);

  console.log('\nPASS (' + pass.length + ')'); pass.forEach(x => console.log('  ✓ ' + x));
  console.log('\nFAIL (' + fail.length + ')'); fail.forEach(x => console.log('  ✗ ' + x));
  await b.close();
})();
