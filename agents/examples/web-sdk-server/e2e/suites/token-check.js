const { BASE, SHOTS } = require('../lib/harness');
const { chromium } = require('playwright');
// Every page that pulls in shared component CSS. Those files are written
// against the design tokens, and without them every var() resolves to nothing
// — the page renders unstyled in ways no console error reports.
const PAGES = ['index.html','playground.html','docs.html','apps/chat.html',
 'apps/storage-demo.html','apps/turn-stun-test.html','apps/cloud-connection-demo.html',
 'apps/test-api-key/index.html','apps/whiteboard/app.html','apps/rooms/app.html',
 'apps/terminal/app.html','apps/chess/index.html','apps/pictionary/index.html',
 'apps/pixel-art/index.html','apps/mind-map/index.html','apps/collab-doc/index.html',
 'apps/pulse/index.html','apps/drop/index.html','apps/mini-games/blockparty/index.html',
 'apps/mini-games/air-hockey/index.html','apps/mini-games/fall-guys/index.html',
 'apps/mini-games/find-the-liar/index.html','apps/mini-games/party-physics/index.html',
 'apps/mini-games/quiz-battle/index.html','apps/mini-games/race-balls/index.html',
 'apps/mini-games/reactor/reactor-client.html'];
(async()=>{
  const b=await chromium.launch({headless:false,args:['--no-sandbox','--enable-unsafe-swiftshader']});
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
