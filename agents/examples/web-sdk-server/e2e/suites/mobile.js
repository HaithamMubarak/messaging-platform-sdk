/*
 * Every page on a phone: nothing overflows sideways, no text is unreadably
 * small, and no control is too small for a finger.
 *
 *   node suites/mobile.js
 *
 * The pages are the site's own plus every live entry in data/catalogue.json
 * (each demo's page and its about page), so a new demo is covered the moment
 * it is listed rather than when somebody remembers this file.
 *
 * Small tap targets used to be counted and not failed on, because the count
 * could not tell a real 21px button from a link inside a sentence (WCAG 2.5.8
 * exempts those) or a checkbox whose whole label is the target. It now can,
 * so a control under 32px fails, by name. Found 47 on 2026-09-27; fixed with
 * pointer:coarse rules in the stylesheet that owns each component.
 */
const { BASE, SHOTS, LAUNCH } = require('../lib/harness');
const { chromium } = require('playwright');

const ROOT = BASE + '/';
const SITE_PAGES = ['index.html', 'playground.html', 'hub.html', 'docs.html', 'apps/chat.html', 'apps/storage-demo.html',
  'apps/terminal/index.html', 'apps/test-api-key/index.html'];
const MIN_TAP = 32;

/** The site's pages plus every live catalogue entry's own pages, deduplicated. */
async function pagesToCheck() {
  const res = await fetch(ROOT + 'data/catalogue.json');
  const cat = await res.json();
  const sdk = /^\/messaging-platform\/sdk\//;
  const fromCatalogue = cat.entries.filter((e) => e.status === 'live' || e.status === 'moved')   // moved pages are still served
    .flatMap((e) => [e.url, e.about]).filter((u) => u && sdk.test(u)).map((u) => u.replace(sdk, ''));
  return [...new Set(SITE_PAGES.concat(fromCatalogue))];
}

/** Runs in the page: overflow, tiny type, and the controls a finger would miss. */
function measure(MIN) {
  const de = document.documentElement;
  const over = Math.max(0, de.scrollWidth - de.clientWidth);
  // A link inside a sentence is exempt; look through inline wrappers (a bold
  // or code-formatted link) to the block that holds the sentence.
  const inProse = (el) => {
    if (el.tagName !== 'A') return false;
    let blk = el.parentElement;
    while (blk && /^(STRONG|EM|B|I|CODE|MARK)$/.test(blk.tagName)) blk = blk.parentElement;
    return !!blk && /^(P|LI|TD|DD|FIGCAPTION|SMALL|SPAN)$/.test(blk.tagName)
      && blk.textContent.trim().length > el.textContent.trim().length + 15;
  };
  const small = [];
  document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], summary').forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || el.closest('[hidden]') || inProse(el)) return;
    const b = (el.closest('label') || el).getBoundingClientRect();   // a control inside a label: the label is the target
    if (b.width < 2 || b.height < 2 || b.right < 0 || b.left > innerWidth) return;
    if (b.width < MIN || b.height < MIN) {
      small.push(Math.round(b.width) + 'x' + Math.round(b.height) + ' ' + el.tagName.toLowerCase()
        + (el.id ? '#' + el.id : '') + ' "' + (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24) + '"');
    }
  });
  let tiny = 0;
  document.querySelectorAll('body *').forEach((e) => {
    // SVG <text> is measured in the diagram's own viewBox units and scales
    // with the drawing, so a "10px" label there is not small type.
    if (e.ownerSVGElement || e.namespaceURI === 'http://www.w3.org/2000/svg') return;
    if (!e.childElementCount && e.textContent.trim().length > 3) {
      const fs = parseFloat(getComputedStyle(e).fontSize);
      if (fs && fs < 11) tiny++;
    }
  });
  return { over, tiny, small };
}

async function checkPage(b, path) {
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  try {
    await p.goto(ROOT + path, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await p.waitForTimeout(3500);
    // The connection modal covers an app until it joins; what is under it is the page being judged.
    await p.evaluate(() => { const m = document.getElementById('connectionModal'); if (m) { m.classList.remove('active'); m.style.display = 'none'; } });
    return await p.evaluate(measure, MIN_TAP);
  } catch (e) {
    return { error: 'TIMEOUT' };
  } finally {
    await p.close();
  }
}

(async () => {
  const pages = await pagesToCheck();
  const b = await chromium.launch(LAUNCH);
  const problems = [];
  console.log(pages.length + ' pages at 390px');
  for (const path of pages) {
    const r = await checkPage(b, path);
    if (r.error) { problems.push(path + '  ' + r.error); console.log('  FAIL ' + path + '  ' + r.error); continue; }
    if (r.over > 0 || r.tiny > 0 || r.small.length) {
      problems.push(path);
      console.log('  FAIL ' + path + '  overflow ' + r.over + 'px, ' + r.tiny + ' sub-11px text, ' + r.small.length + ' controls under ' + MIN_TAP + 'px');
      r.small.forEach((s) => console.log('         ' + s));
    }
  }
  console.log(problems.length === 0
    ? 'no page overflows sideways, renders text under 11px, or has a control under ' + MIN_TAP + 'px'
    : problems.length + ' page(s) with a problem');
  await b.close();
  process.exitCode = problems.length ? 1 : 0;   // not process.exit(): it drops buffered stdout (guideline 6.10)
})();
