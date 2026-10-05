const { BASE, SHOTS, LAUNCH } = require('../lib/harness');
const { chromium } = require('playwright');
const OUT=SHOTS + '/';
const pass=[],fail=[]; const check=(ok,w)=>(ok?pass:fail).push(w);
async function join(ctx,url,name,room){
  const p=await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message.split('\n')[0])); p.errs=errs;
  await p.goto(url,{waitUntil:'domcontentloaded'});
  await p.waitForSelector('#usernameInput',{ state: 'attached',timeout:20000});
  await p.evaluate(() => document.getElementById('tabCustom')?.click());
  await p.fill('#usernameInput',name); await p.fill('#channelInput',room);
  const pw=await p.$('#passwordInput'); if(pw) await p.fill('#passwordInput','pw12345');
  await p.click('#connectBtn'); await p.waitForTimeout(7000); return p;
}
(async()=>{
  const b=await chromium.launch(LAUNCH);
  const ctx=await b.newContext({viewport:{width:1280,height:860}});

  // ---- pulse: can the host write a question? ----
  const q=await join(ctx,BASE + '/apps/pulse/index.html','Ann','pl'+Math.floor(Math.random()*9999));
  await q.waitForTimeout(2500);
  check(!!(await q.$('[data-compose]')), 'pulse offers the host a way to set the question');
  await q.screenshot({path:OUT+'tier2-pulse.png'});

  console.log('\nPASS ('+pass.length+')'); pass.forEach(x=>console.log('  ✓ '+x));
  console.log('\nFAIL ('+fail.length+')'); fail.forEach(x=>console.log('  ✗ '+x));
  console.log('errors:', [...new Set([...q.errs])].slice(0,4));
  await b.close();
})();
