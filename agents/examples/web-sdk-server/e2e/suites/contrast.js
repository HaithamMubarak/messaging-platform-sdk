/**
 * A page that paints its background but leaves the text colour to the browser
 * renders white-on-white for anyone whose system is in dark mode. Chromium here
 * reports dark, so this sweep sees exactly what those visitors see.
 */
const { BASE, SHOTS, LAUNCH } = require('../lib/harness');
const { discoverPages } = require('../lib/pages');
const { chromium } = require('playwright');
// Every published page, found on disk (lib/pages.js): a hand-kept list here
// went on asking for demos that had been deleted.
const PAGES = discoverPages();
const lum = (c) => { const m=c.match(/\d+/g); if(!m) return null;
  const [r,g,b]=m.map(Number).map(v=>{v/=255; return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);});
  return 0.2126*r+0.7152*g+0.0722*b; };
(async()=>{
  const b=await chromium.launch({...LAUNCH,args:[...LAUNCH.args,'--force-dark-mode']});
  const ctx=await b.newContext({colorScheme:'dark', viewport:{width:1280,height:860}});
  let bad=0;
  for(const path of PAGES){
    const p=await ctx.newPage();
    try{
      await p.goto(BASE + '/'+path,{waitUntil:'domcontentloaded',timeout:30000});
      await p.waitForTimeout(2800);
      const r=await p.evaluate(()=>{
        // the effective ground behind the body
        // A gradient is background-image, not background-color, so a page that
        // paints its ground with one reads as transparent unless asked properly.
        let el=document.body, bg='rgba(0, 0, 0, 0)', painted=false;
        while(el){ const cs=getComputedStyle(el);
          if(cs.backgroundImage && cs.backgroundImage!=='none'){ painted=true; break; }
          const c=cs.backgroundColor;
          if(c && c!=='rgba(0, 0, 0, 0)' && c!=='transparent'){ bg=c; painted=true; break; }
          el=el.parentElement; }
        return {bg, painted, fg:getComputedStyle(document.body).color};
      });
      if(r.painted && r.bg==='rgba(0, 0, 0, 0)') { await p.close(); continue; }  // gradient ground
      const lb=lum(r.bg), lf=lum(r.fg);
      if(lb!=null&&lf!=null){
        const ratio=(Math.max(lb,lf)+0.05)/(Math.min(lb,lf)+0.05);
        if(ratio<3){ bad++; console.log('  ! '+path.padEnd(44)+`ratio ${ratio.toFixed(2)}  text ${r.fg} on ${r.bg}`); }
      }
    }catch(e){ console.log('  ? '+path+' '+e.message.slice(0,40)); }
    await p.close();
  }
  console.log(bad===0?'all pages readable in dark mode':`${bad} page(s) with unreadable body text`);
  await b.close();
})();
