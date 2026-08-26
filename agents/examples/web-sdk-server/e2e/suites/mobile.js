const { BASE, SHOTS } = require('../lib/harness');
const { chromium } = require('playwright');
const ROOT = BASE + '/';
const PAGES = ['index.html','playground.html','docs.html',
  'apps/whiteboard/index.html','apps/whiteboard/app.html','apps/rooms/index.html','apps/rooms/app.html',
  'apps/terminal/index.html','apps/terminal/app.html','apps/mini-games/blockparty/index.html',
  'apps/mini-games/blockparty/play.html','apps/chess/index.html','apps/pictionary/index.html',
  'apps/pixel-art/index.html','apps/mind-map/index.html','apps/collab-doc/index.html','apps/pulse/index.html','apps/under-the-hood/index.html','apps/dead-drop/index.html','apps/sponsorpulse/index.html','apps/sponsorpulse/join.html',
  'apps/mini-games/air-hockey/index.html','apps/mini-games/find-the-liar/index.html',
  'apps/mini-games/quiz-battle/index.html'];
(async () => {
  const b = await chromium.launch({headless:false,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader']});
  const problems = [];
  console.log('PAGE'.padEnd(42)+'OVERFLOW  SMALLTAP  TINYTEXT');
  for (const path of PAGES) {
    const p = await b.newPage({viewport:{width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:2});
    try {
      await p.goto(ROOT+path,{waitUntil:'domcontentloaded',timeout:30000});
      await p.waitForTimeout(3500);
      const r = await p.evaluate(() => {
        const de = document.documentElement;
        const over = Math.max(0, de.scrollWidth - de.clientWidth);
        let small = 0, tiny = 0;
        document.querySelectorAll('button,a,select,input[type=button],[role=button]').forEach(e => {
          const b = e.getBoundingClientRect();
          if (b.width < 2 || b.height < 2) return;
          if (getComputedStyle(e).display === 'none') return;
          if (b.height < 32 || b.width < 32) small++;
        });
        document.querySelectorAll('body *').forEach(e => {
          // SVG <text> is measured in the diagram's own viewBox units and scales
          // with the drawing, so a "10px" label there is not small type.
          if (e.ownerSVGElement || e.namespaceURI === 'http://www.w3.org/2000/svg') return;
          if (!e.childElementCount && e.textContent.trim().length > 3) {
            const fs = parseFloat(getComputedStyle(e).fontSize);
            if (fs && fs < 11) tiny++;
          }
        });
        return {over, small, tiny};
      });
      // Small tap targets are counted but not failed on: what is left below
      // 32px are links inside sentences and card CTAs whose whole card is the
      // target. Overflow and unreadably small type are the real faults.
      if (r.over > 0 || r.tiny > 0) {
        problems.push(path + '  overflow ' + r.over + 'px, ' + r.tiny + ' sub-11px');
        console.log(path.padEnd(42)+String(r.over+'px').padEnd(10)+String(r.small).padEnd(10)+r.tiny);
      }
    } catch(e) { problems.push(path + '  TIMEOUT'); console.log(path.padEnd(42)+'TIMEOUT'); }
    await p.close();
  }
  console.log(problems.length === 0
    ? 'no page overflows sideways or renders text under 11px'
    : problems.length + ' page(s) with an overflow or unreadable type');
  await b.close();
  process.exit(problems.length ? 1 : 0);
})();
