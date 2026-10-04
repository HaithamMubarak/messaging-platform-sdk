const { BASE, SHOTS, LAUNCH } = require('../lib/harness');
const { discoverPages } = require('../lib/pages');
const { chromium } = require('playwright');
// Every page that pulls in shared component CSS. Those files are written
// against the design tokens, and without them every var() resolves to nothing
// — the page renders unstyled in ways no console error reports.
// Found on disk (lib/pages.js), not hand-kept. The error pages are skipped:
// they inline their styles on purpose, so they render when the CSS is what failed.
const PAGES = discoverPages([/^error\//]);
(async()=>{
  const b=await chromium.launch(LAUNCH);
  const bad = [];
  for(const path of PAGES){
    const p=await b.newPage({viewport:{width:1300,height:860}});
    await p.goto(BASE + '/'+path,{waitUntil:'domcontentloaded'});
    await p.waitForTimeout(3500);
    const r=await p.evaluate(()=>{
      const cs=getComputedStyle(document.documentElement);
      const tok=n=>cs.getPropertyValue(n).trim()||'(unset)';
      const chip=document.querySelector('.sdk-home-chip a');
      const chipBg=chip?getComputedStyle(chip.parentElement).backgroundColor:'no chip';
      return {brand:tok('--brand'), surface:tok('--surface-1'), text:tok('--text-body'),
              radius:tok('--r-md'), chipBg};
    });
    const missing = Object.entries(r).filter(([k,v]) => k !== 'chipBg' && v === '(unset)').map(([k]) => k);
    if (missing.length) { bad.push(path); console.log('  ! ' + path.padEnd(44) + 'unset: ' + missing.join(', ')); }
    await p.close();
  }
  console.log(bad.length === 0
    ? 'design tokens resolve on all ' + PAGES.length + ' pages'
    : bad.length + ' of ' + PAGES.length + ' pages render without their design tokens');
  await b.close();
  process.exit(bad.length ? 1 : 0);
})();
