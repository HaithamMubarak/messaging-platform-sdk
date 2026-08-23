/**
 * Emoji -> sprite, checked the way that class of change has to be: an <svg>
 * put where JS later writes textContent leaves a control that is still
 * clickable and shows nothing. So every icon slot is asked whether it renders,
 * in the lobby AND after the state changes.
 */
const { BASE, SHOTS } = require('../lib/harness');
const { chromium } = require('playwright');
const OUT = SHOTS + '/';
const pass = [], fail = [];
const check = (ok, w) => (ok ? pass : fail).push(w);

// An <svg><use> renders only if the sprite actually has that symbol.
const SCAN = () => {
  const bad = [], dangling = [], huge = [];
  document.querySelectorAll('svg use').forEach(u => {
    const href = u.getAttribute('href') || u.getAttribute('xlink:href') || '';
    const id = href.replace('#', '');
    if (id && !document.getElementById(id)) dangling.push(href);
    const svg = u.closest('svg');
    // SVGElement has no offsetParent, so the usual visibility test is always
    // true there. Ask the nearest HTML ancestor instead, and skip anything the
    // layout has not placed at all (a panel that starts hidden).
    const host = svg.parentElement;
    const visible = host && host.offsetParent !== null && svg.getClientRects().length > 0;
    if (!visible) return;
    const r = svg.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) bad.push(href + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    // An <svg> with no width or height falls back to 300x150, the CSS default
    // for a replaced element — which is how a Share pill became a slab across
    // a phone screen. Zero-size was checked; absurd-size was not.
    if (r.width > 160 || r.height > 160) huge.push(href + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  });
  const blank = [];
  document.querySelectorAll('button, .btn, .tool-btn, .action-btn, .character-btn, h1, h2, h3').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return;
    if (getComputedStyle(el).visibility === 'hidden') return;
    // Any svg counts, not just a sprite <use> — the shared modal draws its
    // chevron as an inline <path>. A swatch whose whole purpose is its colour
    // counts too.
    const hasIcon = !!el.querySelector('svg, img, canvas');
    const hasText = (el.textContent || '').trim().length > 0;
    // A control can also show something purely by paint — a colour swatch, or a
    // brush-size button whose dot is a painted child.
    const paints = (n) => {
      const cs = getComputedStyle(n);
      return (cs.backgroundImage && cs.backgroundImage !== 'none')
          || (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent')
          || (cs.borderStyle && cs.borderStyle !== 'none' && parseFloat(cs.borderWidth) > 0);
    };
    const painted = paints(el) || [...el.children].some(paints);
    if (!hasIcon && !hasText && !painted) blank.push(el.id || el.className || el.tagName);
  });
  return { dangling: [...new Set(dangling)], bad: [...new Set(bad)], huge: [...new Set(huge)], blank };
};

async function look(b, url, label, after) {
  const ctx = await b.newContext({ viewport: { width: 1320, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(4000);
  if (after) await after(p);
  const r = await p.evaluate(SCAN);
  check(r.dangling.length === 0, `${label}: every icon points at a symbol that exists (${r.dangling.join(', ') || 'clean'})`);
  check(r.bad.length === 0, `${label}: no icon renders at zero size (${r.bad.slice(0,4).join(', ') || 'clean'})`);
  check(r.huge.length === 0, `${label}: no icon renders at the unsized 300x150 default (${r.huge.slice(0,3).join(', ') || 'clean'})`);
  check(r.blank.length === 0, `${label}: no visible control is blank (${r.blank.slice(0,4).join(', ') || 'clean'})`);
  await p.screenshot({ path: OUT + label.replace(/\W+/g, '-') + '.png' });
  await ctx.close();
}

(async () => {
  const b = await chromium.launch({ headless: false,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
  const H = BASE + '/apps/';

  // Every page that draws from the sprite, so a dangling #i- reference or a
  // slot that collapsed to nothing shows up wherever it happens.
  const ALL = ['../index.html', '../playground.html', '../docs.html',
    'whiteboard/index.html', 'whiteboard/app.html', 'rooms/index.html', 'rooms/app.html',
    'terminal/index.html', 'terminal/app.html', 'chat.html', 'cloud-connection-demo.html',
    'mini-games/blockparty/index.html', 'chess/index.html', 'pixel-art/index.html',
    'mind-map/index.html', 'collab-doc/index.html', 'pulse/index.html', 'drop/index.html',
    'turn-stun-test.html', 'test-api-key/index.html',
    'mini-games/air-hockey/index.html', 'mini-games/find-the-liar/index.html',
    'mini-games/quiz-battle/index.html', 'mini-games/race-balls/index.html',
    'mini-games/fall-guys/index.html', 'mini-games/reactor/index.html'];
  for (const page of ALL) {
    try { await look(b, H + page, page.replace('../', '')); }
    catch (e) { check(false, `${page}: page loaded (${e.message.slice(0, 50)})`); }
  }

  await look(b, H + 'pictionary/index.html', 'pictionary lobby');
  await look(b, H + 'mini-games/party-physics/index.html', 'party-physics lobby');
  // and with the panels that start hidden forced open
  await look(b, H + 'mini-games/party-physics/index.html', 'party-physics panels', async (p) => {
    await p.evaluate(() => document.querySelectorAll('.hidden').forEach(e => e.classList.remove('hidden')));
    await p.waitForTimeout(800);
  });
  await look(b, H + 'mini-games/race-balls/index.html', 'race-balls panels', async (p) => {
    await p.evaluate(() => document.querySelectorAll('.hidden, [style*="display: none"], [style*="display:none"]')
      .forEach(e => { e.classList.remove('hidden'); e.style.display = ''; }));
    await p.waitForTimeout(900);
  });
  await look(b, H + 'mini-games/find-the-liar/index.html', 'find-the-liar panels', async (p) => {
    await p.evaluate(() => document.querySelectorAll('.hidden, [style*="display: none"], [style*="display:none"]')
      .forEach(e => { e.classList.remove('hidden'); e.style.display = ''; }));
    await p.waitForTimeout(900);
  });
  await look(b, H + 'pictionary/index.html', 'pictionary in-game panels', async (p) => {
    await p.evaluate(() => document.querySelectorAll('.hidden').forEach(e => e.classList.remove('hidden')));
    await p.waitForTimeout(800);
  });
  console.log('\nPASS (' + pass.length + ')'); pass.forEach(x => console.log('  ✓ ' + x));
  console.log('\nFAIL (' + fail.length + ')'); fail.forEach(x => console.log('  ✗ ' + x));
  await b.close();
})();
