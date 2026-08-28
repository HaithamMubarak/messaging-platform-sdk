const { BASE, SHOTS } = require('../lib/harness');
const { chromium } = require('playwright');
const ROOT = BASE + '/';
const seen = new Set(), bad = [];

/**
 * Links that deliberately leave this site.
 *
 * Some links point at apps hosted beside the SDK site rather than inside it,
 * and those are allowed to be absent here.
 *
 * ClassKit is one: it is a full app in the apps deployment, and the landing
 * page and playground both link across to it. The href is relative on purpose
 * so it resolves within /messaging-platform/ wherever this site is mounted —
 * which means that on a local container, where only the SDK is served, it
 * points at something this container does not have. Absent here is not broken;
 * the app has its own suite, and it is run against the deployed copy.
 *
 * The list is short on purpose. The CoShell entry that used to live here was
 * removed with its card, once that card was found to redirect to a page the
 * catalogue already listed.
 */
// Matched against the path AFTER it is resolved against the page, so the
// `../` in the markup is already gone by the time it is tested here.
// The whole apps deployment, not one app at a time: the SDK nav now links to
// its index, and every app under it is served by a different container that a
// local SDK-only run does not have.
const EXTERNAL_BY_DESIGN = [/^apps\//];
(async () => {
  const b = await chromium.launch({headless:true,args:['--no-sandbox']});
  const p = await b.newPage();
  const queue = ['index.html','playground.html','docs.html','apps/whiteboard/index.html','apps/terminal/index.html'];
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
