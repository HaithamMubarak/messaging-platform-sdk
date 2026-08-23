const { BASE, SHOTS } = require('../lib/harness');
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ headless: false, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
  await p.goto(BASE + '/playground.html', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2500);
  const probe = async (label) => {
    await p.evaluate(() => document.activeElement && document.activeElement.blur());
    let none = 0, seen = 0;
    for (let i = 0; i < 12; i++) {
      await p.keyboard.press('Tab');
      const r = await p.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el); const rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) return null;
        const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0)
          || (cs.boxShadow && cs.boxShadow !== 'none');
        return { ring };
      });
      if (r) { seen++; if (!r.ring) none++; }
    }
    console.log(`${label}: ${seen} stops, ${none} without a ring`);
    return none;
  };
  const before = await probe('as shipped        ');
  // Strip every focus indicator, the way a careless reset would.
  await p.addStyleTag({ content: `*:focus, *:focus-visible { outline: none !important; box-shadow: none !important; }
                                   * { box-shadow: none !important; }` });
  await p.waitForTimeout(300);
  const after = await probe('focus styles removed');
  console.log(after > before
    ? '\nthe check goes red when the ring is taken away — green means something'
    : '\nTHE CHECK STAYED GREEN WITH NO FOCUS RING — it proves nothing');
  await b.close();
})();
