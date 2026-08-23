const { BASE, SHOTS } = require('../lib/harness');
const { chromium } = require('playwright');
const OUT=SHOTS + '/';
const pass=[],fail=[]; const check=(ok,w)=>(ok?pass:fail).push(w);
async function join(ctx,url,name,room){
  const p=await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message.split('\n')[0])); p.errs=errs;
  await p.goto(url,{waitUntil:'domcontentloaded'});
  await p.waitForSelector('#usernameInput',{timeout:20000});
  await p.fill('#usernameInput',name); await p.fill('#channelInput',room);
  const pw=await p.$('#passwordInput'); if(pw) await p.fill('#passwordInput','pw12345');
  await p.click('#connectBtn'); await p.waitForTimeout(7000); return p;
}
(async()=>{
  const b=await chromium.launch({headless:false,args:['--no-sandbox','--enable-unsafe-swiftshader']});
  const ctx=await b.newContext({viewport:{width:1280,height:860}});

  // ---- collab-doc: is the preview legible? ----
  const d=await join(ctx,BASE + '/apps/collab-doc/index.html','Ann','cd'+Math.floor(Math.random()*9999));
  await d.waitForTimeout(2000);
  const contrast = await d.evaluate(()=>{
    const el=document.getElementById('previewContent'); if(!el) return null;
    const cs=getComputedStyle(el);
    const lum=(c)=>{const m=c.match(/\d+/g).map(Number).slice(0,3).map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);});
      return 0.2126*m[0]+0.7152*m[1]+0.0722*m[2];};
    const a=lum(cs.color), bl=lum(cs.backgroundColor);
    const ratio=(Math.max(a,bl)+0.05)/(Math.min(a,bl)+0.05);
    return {color:cs.color,bg:cs.backgroundColor,ratio:Math.round(ratio*10)/10};
  });
  check(contrast && contrast.ratio>=4.5, `collab-doc preview is legible (${contrast?contrast.ratio+':1':'n/a'}, ${contrast?contrast.color+' on '+contrast.bg:''})`);
  await d.screenshot({path:OUT+'tier2-collabdoc.png'});
  // theme toggle keeps its icon
  await d.evaluate(()=>collabDoc && collabDoc.toggleTheme());
  await d.waitForTimeout(800);
  check(await d.evaluate(()=>!!document.querySelector('#themeBtn use')), 'collab-doc theme button keeps its icon after toggling');
  const darkBg = await d.evaluate(()=>getComputedStyle(document.querySelector('.app-container')).backgroundColor);
  const darkIsDark = await d.evaluate(()=>{const c=getComputedStyle(document.querySelector('.app-container')).backgroundColor.match(/\d+/g).map(Number);return (c[0]+c[1]+c[2])/3 < 90;});
  check(darkIsDark, `collab-doc dark theme is actually dark (${darkBg})`);
  await d.screenshot({path:OUT+'tier2-collabdoc-dark.png'});

  // ---- pulse: can the host write a question? ----
  const q=await join(ctx,BASE + '/apps/pulse/index.html','Ann','pl'+Math.floor(Math.random()*9999));
  await q.waitForTimeout(2500);
  check(!!(await q.$('[data-compose]')), 'pulse offers the host a way to set the question');
  await q.screenshot({path:OUT+'tier2-pulse.png'});

  console.log('\nPASS ('+pass.length+')'); pass.forEach(x=>console.log('  ✓ '+x));
  console.log('\nFAIL ('+fail.length+')'); fail.forEach(x=>console.log('  ✗ '+x));
  console.log('errors:', [...new Set([...d.errs,...q.errs])].slice(0,4));
  await b.close();
})();
