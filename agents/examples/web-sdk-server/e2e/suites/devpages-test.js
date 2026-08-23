/**
 * The two developer pages, after their chrome moved onto the sprite.
 *
 * Both have a control whose label is rewritten while the page runs — one with
 * textContent, one with innerHTML — which is precisely the write that deletes
 * an injected icon and leaves a button showing nothing.
 */
const { BASE, SHOTS } = require('../lib/harness');
const { chromium } = require('playwright');
const pass = [], fail = [];
const check = (ok, w) => (ok ? pass : fail).push(w);
const SHOT = SHOTS + '/';

const SCAN = () => {
  const bad = [], dangling = [], huge = [];
  document.querySelectorAll('svg use').forEach(u => {
    const href = u.getAttribute('href') || u.getAttribute('xlink:href') || '';
    const id = href.replace('#', '');
    if (id && !document.getElementById(id)) dangling.push(href);
    const svg = u.closest('svg');
    const host = svg.parentElement;
    if (!(host && host.offsetParent !== null && svg.getClientRects().length > 0)) return;
    const r = svg.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) bad.push(href + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    if (r.width > 160 || r.height > 160) huge.push(href + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  });
  return { dangling: [...new Set(dangling)], bad: [...new Set(bad)], huge: [...new Set(huge)] };
};
const shows = (p, sel) => p.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return 'missing';
  const use = el.querySelector('use');
  return { icon: use ? (use.getAttribute('href') || '') : null,
           text: (el.textContent || '').trim().slice(0, 24) };
}, sel);

(async () => {
  const b = await chromium.launch({ headless: false, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });

  // ---- turn-stun-test: the button relabels itself twice while running ----
  {
    const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
    const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 80)));
    await p.goto(BASE + '/apps/turn-stun-test.html', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(3000);
    const r = await p.evaluate(SCAN);
    check(r.dangling.length === 0, `turn-stun-test: every icon resolves (${r.dangling.join(', ') || 'clean'})`);
    check(r.huge.length === 0, `turn-stun-test: none at the unsized default (${r.huge.join(', ') || 'clean'})`);
    check(r.bad.length === 0, `turn-stun-test: none at zero size (${r.bad.join(', ') || 'clean'})`);

    const before = await shows(p, '#testBtn');
    check(before.icon === '#i-activity', `turn-stun-test: the test button shows an icon (${JSON.stringify(before)})`);
    // Run it: the handler rewrites this button's innerHTML when it finishes.
    await p.evaluate(() => window.testServers && window.testServers());
    await p.waitForTimeout(14000);
    const after = await shows(p, '#testBtn');
    check(after.icon === '#i-activity',
      `turn-stun-test: and still shows one after a run relabels it (${JSON.stringify(after)})`);
    await p.screenshot({ path: SHOT + 'dev-turn-stun.png' });
    check(errs.length === 0, `turn-stun-test: nothing throws (${errs.slice(0, 1).join('') || 'clean'})`);
    await p.close();
  }

  // ---- test-api-key: the results banner swaps its symbol ------------------
  {
    const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
    const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 80)));
    await p.goto(BASE + '/apps/test-api-key/index.html', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(3000);
    const r = await p.evaluate(SCAN);
    check(r.dangling.length === 0, `test-api-key: every icon resolves (${r.dangling.join(', ') || 'clean'})`);
    check(r.huge.length === 0, `test-api-key: none at the unsized default (${r.huge.join(', ') || 'clean'})`);

    const ok = await p.evaluate(() => {
      const fn = window.showResults || window.showResultsBanner;
      if (typeof fn !== 'function') return 'no showResults';
      fn(true, 'Working', 'ok'); const a = document.querySelector('#resultsIcon use')?.getAttribute('href');
      fn(false, 'Failed', 'no'); const b = document.querySelector('#resultsIcon use')?.getAttribute('href');
      return { success: a, failure: b };
    });
    check(ok && ok.success === '#i-check-circle' && ok.failure === '#i-alert-circle',
      `test-api-key: the banner swaps its symbol instead of deleting it (${JSON.stringify(ok)})`);
    check(errs.length === 0, `test-api-key: nothing throws (${errs.slice(0, 1).join('') || 'clean'})`);
    await p.screenshot({ path: SHOT + 'dev-api-key.png' });
    await p.close();
  }

  console.log('\nPASS (' + pass.length + ')'); pass.forEach(x => console.log('  ✓ ' + x));
  console.log('\nFAIL (' + fail.length + ')'); fail.forEach(x => console.log('  ✗ ' + x));
  await b.close();
})();
