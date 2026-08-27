/**
 * Accessible names, across every page.
 *
 * This is a check on my own work as much as the site's: converting an emoji
 * label to <svg aria-hidden="true"> removes the button's only text. If nothing
 * else names it, the control becomes an unlabelled button — visible to a
 * sighted user, silent to a screen reader. Nothing on this site had ever
 * looked for that.
 */
const { BASE, SHOTS } = require('../lib/harness');
const { chromium } = require('playwright');
const PAGES = ['index.html','playground.html','docs.html','apps/chat.html','apps/storage-demo.html',
 'apps/webrtc.html','apps/turn-stun-test.html','apps/cloud-connection-demo.html','apps/test-api-key/index.html',
 'apps/whiteboard/index.html','apps/whiteboard/app.html','apps/rooms/index.html','apps/rooms/app.html',
 'apps/terminal/index.html','apps/terminal/app.html','apps/chess/index.html','apps/pictionary/index.html',
 'apps/collab-doc/index.html','apps/pulse/index.html','apps/rewind/index.html','apps/rewind/app.html','apps/under-the-hood/index.html','apps/under-the-hood/app.html','apps/dead-drop/index.html','apps/dead-drop/app.html','apps/sponsorpulse/index.html','apps/sponsorpulse/host.html','apps/sponsorpulse/join.html',
 'apps/drop/index.html','apps/mini-games/blockparty/index.html','apps/mini-games/blockparty/play.html',
 'apps/mini-games/air-hockey/index.html','apps/mini-games/find-the-liar/index.html','apps/mini-games/reactor/reactor-client.html'];

const AUDIT = () => {
  // The accessible name a browser would compute, near enough for this purpose.
  const nameOf = (el) => {
    const aria = (el.getAttribute('aria-label') || '').trim();
    if (aria) return aria;
    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const t = labelledby.split(/\s+/).map(id => (document.getElementById(id) || {}).textContent || '').join(' ').trim();
      if (t) return t;
    }
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (text) return text;
    const title = (el.getAttribute('title') || '').trim();
    if (title) return title;
    const img = el.querySelector('img[alt]');
    if (img && img.getAttribute('alt').trim()) return img.getAttribute('alt').trim();
    // A form control is named by <label for=...> or by a <label> wrapped around
    // it, for every labelable element — not just <input>. Missing both is what
    // made four properly-labelled fields look unlabelled.
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) {
      const forLab = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
      if (forLab && forLab.textContent.trim()) return forLab.textContent.trim();
      const wrapping = el.closest('label');
      if (wrapping && wrapping.textContent.trim()) return wrapping.textContent.trim();
      const ph = (el.getAttribute('placeholder') || '').trim();
      if (ph) return ph;
    }
    return '';
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && el.offsetParent !== null;
  };
  const id = (el) => (el.id ? '#' + el.id : '') +
    (typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : '') +
    '<' + el.tagName + '>';

  const unnamed = [], unlabelledInputs = [], imgsNoAlt = [];
  document.querySelectorAll('button, a[href], [role="button"]').forEach(el => {
    if (!visible(el)) return;
    if (!nameOf(el)) unnamed.push(id(el));
  });
  document.querySelectorAll('input:not([type=hidden]), select, textarea').forEach(el => {
    if (!visible(el)) return;
    if (!nameOf(el)) unlabelledInputs.push(id(el));
  });
  document.querySelectorAll('img').forEach(el => {
    if (!visible(el)) return;
    if (el.getAttribute('alt') === null) imgsNoAlt.push(id(el));
  });
  return {
    lang: document.documentElement.getAttribute('lang') || '',
    unnamed: [...new Set(unnamed)], unlabelledInputs: [...new Set(unlabelledInputs)],
    imgsNoAlt: [...new Set(imgsNoAlt)]
  };
};

(async () => {
  const b = await chromium.launch({ headless: false,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
  const rows = [];
  for (const path of PAGES) {
    const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await p.goto(BASE + '/' + path, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await p.waitForTimeout(2600);
      const r = await p.evaluate(AUDIT);
      rows.push([path, r]);
      const probs = r.unnamed.length + r.unlabelledInputs.length + r.imgsNoAlt.length + (r.lang ? 0 : 1);
      if (probs) {
        console.log('\n' + path);
        if (!r.lang) console.log('   no lang on <html>');
        if (r.unnamed.length) console.log('   unnamed controls: ' + r.unnamed.slice(0, 8).join(', '));
        if (r.unlabelledInputs.length) console.log('   unlabelled fields: ' + r.unlabelledInputs.slice(0, 6).join(', '));
        if (r.imgsNoAlt.length) console.log('   img without alt: ' + r.imgsNoAlt.slice(0, 5).join(', '));
      }
    } catch (e) { console.log('\n' + path + '  ERROR ' + e.message.slice(0, 50)); }
    await p.close();
  }
  const bad = rows.filter(([, r]) => r.unnamed.length || r.unlabelledInputs.length || r.imgsNoAlt.length || !r.lang);
  console.log('\n' + (bad.length === 0
    ? 'every control on ' + rows.length + ' pages has a name, every field a label, every page a lang'
    : bad.length + ' of ' + rows.length + ' pages have an unnamed control, unlabelled field or missing lang'));
  await b.close();
  process.exit(bad.length ? 1 : 0);
})();
