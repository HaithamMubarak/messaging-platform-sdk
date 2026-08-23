/**
 * Prove the audit can go red. A green sweep over 31 pages means nothing until
 * the checker is shown failing on a control that really is broken.
 */
const { BASE, SHOTS } = require('../lib/harness');
const { chromium } = require('playwright');
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/a11y.js', 'utf8');
const AUDIT = src.slice(src.indexOf('const AUDIT = () => {') + 'const AUDIT = '.length,
                        src.indexOf('(async () => {'));
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
  await p.goto(BASE + '/playground.html', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2500);

  const before = await p.evaluate(new Function('return (' + AUDIT.trim().replace(/;$/, '') + ')()'));
  console.log('clean page      ->', JSON.stringify({ unnamed: before.unnamed.length,
    fields: before.unlabelledInputs.length, imgs: before.imgsNoAlt.length, lang: before.lang || 'MISSING' }));

  // Break it four ways, exactly as a careless change would.
  await p.evaluate(() => {
    const b1 = document.createElement('button');
    b1.innerHTML = '<svg aria-hidden="true" width="16" height="16"><circle cx="8" cy="8" r="7"/></svg>';
    b1.style.cssText = 'width:40px;height:40px'; document.body.appendChild(b1);
    const i1 = document.createElement('input'); i1.type = 'text';
    i1.style.cssText = 'width:120px;height:30px'; document.body.appendChild(i1);
    const im = document.createElement('img');
    im.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw='; im.removeAttribute('alt');
    im.style.cssText = 'width:20px;height:20px'; document.body.appendChild(im);
    document.documentElement.removeAttribute('lang');
  });
  await p.waitForTimeout(300);
  const after = await p.evaluate(new Function('return (' + AUDIT.trim().replace(/;$/, '') + ')()'));
  console.log('deliberately broken ->', JSON.stringify({ unnamed: after.unnamed.length,
    fields: after.unlabelledInputs.length, imgs: after.imgsNoAlt.length, lang: after.lang || 'MISSING' }));

  const caught = after.unnamed.length > before.unnamed.length
    && after.unlabelledInputs.length > before.unlabelledInputs.length
    && after.imgsNoAlt.length > before.imgsNoAlt.length && !after.lang;
  console.log(caught ? '\nthe audit catches all four — a green run means something'
                     : '\nTHE AUDIT MISSED SOMETHING — a green run proves nothing');
  await b.close();
})();
