const { BASE, SHOTS } = require('../lib/harness');
const { chromium } = require('playwright');
const ROOT = BASE + '/';
const seen = new Set(), bad = [];

/**
 * Links that deliberately leave this site.
 *
 * The playground cards CoShell, a product hosted beside the SDK site rather
 * than inside it. The href is relative on purpose so it resolves within
 * /messaging-platform/ wherever the site is mounted — which means that on a
 * local container, where this tree is served at the root, it points at
 * something the container does not serve. Absent here is not broken.
 */
const EXTERNAL_BY_DESIGN = [/^apps\/coshell\//];
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
