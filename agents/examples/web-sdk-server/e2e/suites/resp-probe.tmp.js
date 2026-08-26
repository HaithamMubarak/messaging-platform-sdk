const { chromium } = require('playwright');
const { BASE, LAUNCH, gotoStable } = require('../lib/harness');
const fs = require('fs');
const PAGES = fs.readFileSync('/tmp/allpages.txt','utf8').split('\n').filter(Boolean);
(async () => {
  const b = await chromium.launch(LAUNCH);
  const bad = [];
  for (const w of [390, 320]) {
    for (const path of PAGES) {
      const p = await b.newPage({viewport:{width:w,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:2});
      try {
        await gotoStable(p, BASE + '/' + path, {waitUntil:'domcontentloaded'});
        await p.waitForTimeout(2200);
        const r = await p.evaluate(() => {
          const de = document.documentElement;
          const over = Math.max(0, de.scrollWidth - de.clientWidth);
          let small = 0, tiny = 0, worst = null;
          document.querySelectorAll('button,a,select,input,[role=button]').forEach(e => {
            const bb = e.getBoundingClientRect();
            if (bb.width < 2 || bb.height < 2) return;
            const cs = getComputedStyle(e);
            if (cs.display === 'none' || cs.visibility === 'hidden') return;
            if (bb.height < 32 || bb.width < 32) small++;
          });
          document.querySelectorAll('*').forEach(e => {
            let has = false; e.childNodes.forEach(n => { if (n.nodeType===3 && n.textContent.trim()) has = true; });
            if (!has) return;
            const cs = getComputedStyle(e);
            if (cs.display === 'none' || cs.visibility === 'hidden') return;
            const f = parseFloat(cs.fontSize);
            if (f && f < 11) { tiny++; if (!worst || f < worst.size) worst = {size:f, tag:e.tagName, cls:(e.className||'').toString().slice(0,30), txt:(e.textContent||'').trim().slice(0,30)}; }
          });
          let widest = null;
          document.querySelectorAll('body *').forEach(e => {
            const bb = e.getBoundingClientRect();
            if (bb.width === 0) return;
            const ov = bb.right - de.clientWidth;
            if (ov > 2 && (!widest || ov > widest.ov)) widest = {ov: Math.round(ov), tag:e.tagName, cls:(e.className||'').toString().slice(0,40), id:e.id||''};
          });
          return {over, small, tiny, worst, widest};
        });
        if (r.over > 2 || r.tiny > 0) bad.push({w, path, ...r});
      } catch (e) { bad.push({w, path, err: String(e.message||e).slice(0,60)}); }
      await p.close();
    }
  }
  fs.writeFileSync('/tmp/resp.json', JSON.stringify(bad, null, 1));
  console.log(bad.length + ' problem(s) across ' + PAGES.length + ' pages x 2 widths -> /tmp/resp.json');
  await b.close();
})();
