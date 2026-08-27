const { BASE, SHOTS } = require('../lib/harness');
const { chromium } = require('playwright');
const ROOT = BASE + '/';
const seen = new Set(), bad = [];

/**
 * Links that deliberately leave this site.
 *
 * Some cards point at products hosted beside the SDK site rather than inside
 * it, and those are allowed to be absent here. Nothing claims that today: the
 * CoShell card was removed once its target was found to redirect to
 * apps/terminal, which the catalogue already lists — so the list is empty and
 * every href must resolve.
 */
const EXTERNAL_BY_DESIGN = [];
(async () => {
  const b = await chromium.launch({headless:true,args:['--no-sandbox']});
  const p = await b.newPage();
  const queue = ['index.html','playground.html','docs.html','apps/whiteboard/index.html','apps/rooms/index.html','apps/terminal/index.html'];
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const url = new URL(rel, BASE).href;
    const res = await p.goto(url, {waitUntil:'domcontentloaded'}).catch(e => null);
    if (!res || res.status() >= 400) { bad.push(`${res?res.status():'ERR'}  ${rel}`); continue; }
    const links = await p.evaluate(() => Array.from(document.querySelectorAll('a[href]'))
      .map(a => a.getAttribute('href')).filter(h => h && !/^(https?:|mailto:|#|javascript:)/.test(h)));
    for (const h of links) {
      const abs = new URL(h, url).href;
      if (!abs.startsWith(BASE)) continue;
      const r = abs.slice(BASE.length).split('#')[0].replace(/^\//, '');
      if (!r || seen.has(r)) continue;
      if (EXTERNAL_BY_DESIGN.some(re => re.test(r))) { seen.add(r); continue; }
      const head = await p.request.get(abs).catch(()=>null);
      if (!head || head.status() >= 400) bad.push(`${head?head.status():'ERR'}  ${r}   (linked from ${rel})`);
      else seen.add(r);
    }
  }
  console.log('checked', seen.size, 'pages/targets');
  console.log(bad.length ? 'BROKEN:\n' + bad.join('\n') : 'no broken links');
  await b.close();
  process.exit(bad.length ? 1 : 0);
})();
