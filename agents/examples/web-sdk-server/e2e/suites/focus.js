/**
 * Keyboard focus, made visible.
 *
 * The design system defines --focus-ring and :focus-visible, but nothing had
 * ever tabbed through a page to confirm the ring actually lands on the
 * controls people would reach. A keyboard user who cannot see where they are
 * is stuck, however good the tokens are.
 */
const { BASE, SHOTS } = require('../lib/harness');
const { chromium } = require('playwright');
const PAGES = ['index.html','playground.html','docs.html','apps/chat.html',
 'apps/whiteboard/index.html','apps/terminal/index.html',
 'apps/pictionary/index.html','apps/drop/index.html','apps/pulse/index.html',
 'apps/mini-games/blockparty/index.html',];

(async () => {
  const b = await chromium.launch({ headless: false,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
  let bad = 0, checked = 0;
  for (const path of PAGES) {
    const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await p.goto(BASE + '/' + path, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await p.waitForTimeout(2500);
      const invisible = [];
      // Walk the first dozen focus stops the way a keyboard user would.
      for (let i = 0; i < 12; i++) {
        await p.keyboard.press('Tab');
        const r = await p.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return null;
          const cs = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          if (rect.width < 2 || rect.height < 2) return null;   // offscreen skip link etc.
          const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0)
            || (cs.boxShadow && cs.boxShadow !== 'none')
            || (cs.borderColor && el.matches(':focus-visible') && parseFloat(cs.borderWidth) > 0);
          return { ring, id: (el.id ? '#' + el.id : '') +
            (typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : '') +
            '<' + el.tagName + '>' };
        });
        if (r && !r.ring) invisible.push(r.id);
      }
      checked++;
      if (invisible.length) { bad++; console.log(path + '\n   no visible focus on: ' + [...new Set(invisible)].slice(0, 6).join(', ')); }
    } catch (e) { console.log(path + '  ERROR ' + e.message.slice(0, 45)); }
    await p.close();
  }
  console.log('\n' + (bad === 0 ? 'every focus stop on ' + checked + ' pages shows a ring'
                                : bad + ' of ' + checked + ' pages have an invisible focus stop'));
  await b.close();
})();
