/**
 * Both marketing homepages: responsive rendering and real UI interactions.
 * Run only against isolated loopback previews. Every API-key request is mocked.
 * SDK_BASE_URL and APPS_BASE_URL must include /messaging-platform/{sdk,apps}.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { BASE, SHOTS, LAUNCH, results } = require('../lib/harness');
const APPS = (process.env.APPS_BASE_URL || new URL('../apps', BASE + '/').href).replace(/\/$/, '');
const sources = [{name:'sdk',url:BASE+'/'},{name:'apps',url:APPS+'/'}];
for (const source of sources) {
  if (!['127.0.0.1','localhost','[::1]'].includes(new URL(source.url).hostname)) {
    throw new Error('Homepage review refuses non-loopback targets: '+source.name);
  }
}
const report=results();
const evidence={pages:[],links:[],requests:[],external:[],errors:[]};
const origins=new Set(sources.map(s=>new URL(s.url).origin));
const shots=path.resolve(SHOTS);
fs.mkdirSync(shots,{recursive:true});
let browser, formMode='success', releasePending;
const check=report.check;
async function isolate(context) {
  await context.route('**/*',async route=>{
    const req=route.request();
    const url=new URL(req.url());
    if (!origins.has(url.origin)) {
      evidence.external.push(url.origin+url.pathname);
      return route.abort('blockedbyclient');
    }
    if (url.pathname.endsWith('/request-api-key')) {
      evidence.requests.push({method:req.method(),body:req.postDataJSON()});
      if (formMode==='pending') await new Promise(resolve=>{releasePending=resolve;});
      const bad=formMode==='error';
      return route.fulfill({status:bad?503:200,contentType:'application/json',body:JSON.stringify(bad?{message:'Preview service unavailable'}:{status:'success'})});
    }
    if (!['GET','HEAD'].includes(req.method())) {
      evidence.errors.push('Unexpected mutation: '+req.method()+' '+url.pathname);
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  context.on('page',p=>p.on('websocket',ws=>evidence.errors.push('Unexpected WebSocket: '+new URL(ws.url()).origin)));
}
async function ready(page) {
  await page.evaluate(()=>document.fonts.ready);
  for (const img of await page.locator('img').all()) await img.scrollIntoViewIfNeeded();
  await page.evaluate(async()=>{
    await Promise.all(Array.from(document.images).map(image=>image.decode().catch(()=>{})));
    window.scrollTo(0,0);
  });
}
async function keyDialog(page) {
  await page.locator('[data-open-request]').first().click();
  const dialog=page.getByRole('dialog');
  await dialog.waitFor({state:'visible'});
  return dialog;
}
(async()=>{
  browser=await chromium.launch({...LAUNCH,args:[...LAUNCH.args,'--disable-dev-shm-usage']});
  const internalLinks=new Set();
  for (const width of [390,768,1440]) {
    for (const source of sources) {
      const context=await browser.newContext({viewport:{width,height:width===390?844:900},deviceScaleFactor:1,reducedMotion:'reduce',serviceWorkers:'block'});
      await isolate(context);
      const page=await context.newPage();
      const errors=[],missing=[];
      page.on('pageerror',error=>errors.push(error.message));
      page.on('response',r=>{if(r.status()>=400 && !new URL(r.url()).pathname.endsWith('/request-api-key'))missing.push(new URL(r.url()).pathname+' '+r.status());});
      const response=await page.goto(source.url,{waitUntil:'networkidle'});
      await ready(page);
      const facts=await page.evaluate(()=>({
        width:document.documentElement.clientWidth,
        overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
        h1s:document.querySelectorAll('h1').length,
        heading:document.querySelector('h1')?.textContent.trim(),
        brokenImages:Array.from(document.images).filter(i=>!i.complete||!i.naturalWidth).map(i=>i.getAttribute('src')),
        missingAlt:Array.from(document.images).filter(i=>!i.hasAttribute('alt')).map(i=>i.getAttribute('src')),
        imageCount:document.images.length,
        lang:document.documentElement.lang,
        tinyText:Array.from(document.querySelectorAll('body *')).filter(e=>!e.children.length && e.textContent.trim().length>2 && e.getClientRects().length && !e.closest('[aria-hidden="true"],svg,script,style') && parseFloat(getComputedStyle(e).fontSize)<11).map(e=>e.textContent.trim().slice(0,50)),
        duplicateIds:Array.from(document.querySelectorAll('[id]')).map(e=>e.id).filter((v,i,a)=>a.indexOf(v)!==i),
        links:Array.from(document.querySelectorAll('a[href]')).map(a=>({href:a.href,text:a.textContent.trim(),localAnchor:a.getAttribute('href')?.startsWith('#'),anchorExists:!a.hash||!!document.getElementById(decodeURIComponent(a.hash.slice(1)))})),
        scrollBehavior:getComputedStyle(document.documentElement).scrollBehavior
      }));
      const label=source.name+' '+width+'px';
      check(response.status()===200,label+' responds');
      check(facts.overflow<=1,label+' has no page overflow ('+facts.overflow+'px)');
      check(facts.h1s===1,label+' has one main heading');
      check(!!facts.lang,label+' declares a language');
      check(facts.imageCount>=4 && facts.brokenImages.length===0,label+' loads its product images '+JSON.stringify(facts.brokenImages));
      check(facts.missingAlt.length===0,label+' images have descriptions');
      check(facts.duplicateIds.length===0,label+' has unique IDs');
      check(facts.tinyText.length===0,label+' has readable labels and captions '+JSON.stringify(facts.tinyText));
      check(errors.length===0,label+' has no script errors '+errors.join('; '));
      check(missing.length===0,label+' has no missing resources '+missing.join('; '));
      check(facts.links.filter(l=>l.localAnchor&&!l.anchorExists).length===0,label+' section links resolve');
      check(facts.scrollBehavior!=='smooth',label+' respects reduced-motion scroll');
      for (const link of facts.links) {
        const u=new URL(link.href);
        if(origins.has(u.origin)){u.hash='';internalLinks.add(u.href);}
      }
      await page.keyboard.press('Tab');
      const focus=await page.evaluate(()=>{
        const el=document.activeElement,style=getComputedStyle(el);
        return {tag:el.tagName,text:el.textContent.trim(),outline:style.outlineStyle,shadow:style.boxShadow};
      });
      check(focus.text.includes('Skip') && (focus.outline!=='none'||focus.shadow!=='none'),label+' starts with a visible skip-link focus');
      await page.locator('h1').click();
      await page.evaluate(()=>window.scrollTo(0,0));
      if (width===390) {
        const toggle=page.locator('#navToggle');
        if(await toggle.count() && await toggle.isVisible()){
          await toggle.click();
          check(await toggle.getAttribute('aria-expanded')==='true',label+' menu expands accessibly');
          await page.keyboard.press('Escape');
          check(await toggle.getAttribute('aria-expanded')==='false',label+' Escape closes menu');
          await toggle.click();
          const currentLink=page.locator('#siteNav a[href^="#"]').first();
          if(await currentLink.count()){
            await currentLink.click();
            check(await toggle.getAttribute('aria-expanded')==='false',label+' section navigation closes menu');
          } else await page.keyboard.press('Escape');
          await page.evaluate(()=>window.scrollTo(0,0));
        } else {
          const links=page.locator('#siteNav a');
          check(await links.count()>0 && (await Promise.all((await links.all()).map(link=>link.isVisible()))).every(Boolean),label+' navigation remains visible without a collapsed menu');
        }
      }
      if (width===1440 && source.name==='sdk') {
        const tabs=page.getByRole('tab');
        check(await tabs.count()===4,'SDK exposes all four language examples');
        await tabs.first().focus();
        await page.keyboard.press('ArrowRight');
        check(await tabs.nth(1).getAttribute('aria-selected')==='true','Language tabs support ArrowRight');
        await page.keyboard.press('End');
        check(await tabs.last().getAttribute('aria-selected')==='true','Language tabs support End');
        await page.keyboard.press('Home');
        check(await tabs.first().getAttribute('aria-selected')==='true','Language tabs support Home');
        await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:new URL(BASE).origin});
        async function checkCopy(button,label){
          const target=await button.getAttribute('data-copy-target');
          await button.click();
          const copied=await page.evaluate(()=>navigator.clipboard.readText());
          check(copied===(await page.locator('[id="'+target+'"]').textContent()).trim(),label+' copies the complete snippet');
        }
        await checkCopy(page.locator('[data-copy-target]:visible').first(),'Install command');
        for (const tab of await tabs.all()) {
          await tab.click();
          const panel=page.locator('[id="'+await tab.getAttribute('aria-controls')+'"]');
          check(await panel.isVisible(),(await tab.innerText()).trim()+' selected panel is visible');
          await checkCopy(panel.locator('[data-copy-target]'),(await tab.innerText()).trim());
        }
        await tabs.first().click();
        let dialog=await keyDialog(page);
        await dialog.locator('button').last().focus();
        await page.keyboard.press('Tab');
        check(await page.evaluate(()=>!!document.activeElement?.closest('[role="dialog"]')),'API dialog traps keyboard focus');
        await dialog.getByRole('button',{name:'Submit request'}).click();
        check(await dialog.locator('#req-email').getAttribute('aria-invalid')==='true','API form rejects missing email');
        await dialog.locator('#req-email').fill('invalid');
        await dialog.getByRole('button',{name:'Submit request'}).click();
        check(evidence.requests.length===0,'Invalid forms send no request');
        await dialog.locator('#req-email').fill('preview@example.invalid');
        formMode='pending';
        await dialog.getByRole('button',{name:'Submit request'}).click();
        await page.waitForFunction(()=>document.querySelector('#apiKeyRequestForm button[type="submit"]')?.disabled===true);
        check(await dialog.locator('button[type="submit"]').isDisabled(),'Submission provides busy feedback');
        if (!releasePending) throw new Error('Mock request was not intercepted');
        formMode='success';releasePending();
        await dialog.waitFor({state:'hidden'});
        check(evidence.requests.length===1&&evidence.requests[0].method==='POST'&&evidence.requests[0].body.email==='preview@example.invalid','API form preserves its POST contract with a mocked request');
        check(await page.evaluate(()=>document.activeElement?.hasAttribute('data-open-request')),'Successful request restores focus to its opener');
        dialog=await keyDialog(page);
        await dialog.locator('#req-email').fill('preview@example.invalid');
        formMode='error';
        await dialog.getByRole('button',{name:'Submit request'}).click();
        await page.getByText('Preview service unavailable',{exact:true}).waitFor({state:'visible'});
        check(await dialog.isVisible(),'Failed request leaves the form available');
        await page.keyboard.press('Escape');
        await dialog.waitFor({state:'hidden'});
        check(await page.evaluate(()=>document.activeElement?.hasAttribute('data-open-request')),'Escape closes the modal and restores focus');
        formMode='success';
      }
      if (width===1440 && source.name==='apps') {
        const log=page.locator('details').first();
        check(await log.count()===1,'Apps keeps the release log expandable');
        if(await log.count()){
          const summary=log.locator('summary');
          await summary.focus();await page.keyboard.press('Enter');
          check(await log.getAttribute('open')!==null,'Release log opens by keyboard');
          await page.keyboard.press('Enter');
          check(await log.getAttribute('open')===null,'Release log closes by keyboard');
        }
      }
      // Reload to remove test toasts and restore the default tab before marketing captures.
      await page.reload({waitUntil:'networkidle'});
      await ready(page);
      await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0);});
      await page.screenshot({path:path.join(shots,source.name+'-'+width+'-full.png'),fullPage:true,animations:'disabled'});
      const format=width===390?'mobile':width===768?'tablet':'desktop';
      await page.screenshot({path:path.join(shots,source.name+'-'+format+'.png'),animations:'disabled'});
      evidence.pages.push({name:source.name,width,...facts,errors,missing});
      await context.close();
    }
  }
  // Link checks are restricted to the preview; external destinations are not contacted.
  for(const href of internalLinks){
    const response=await fetch(href,{method:'HEAD',redirect:'follow'});
    evidence.links.push({href,status:response.status});
    check(response.ok,'Internal destination responds: '+new URL(href).pathname);
  }
  check(evidence.external.length===0,'Homepages request no external assets or services '+JSON.stringify([...new Set(evidence.external)]));
  check(evidence.errors.length===0,'No unexpected mutations or sockets '+JSON.stringify(evidence.errors));
  const badPaths=['/messaging-platform/apps/capture/capture.cjs','/messaging-platform/apps/review/server.cjs','/messaging-platform/apps/rooms/test/e2e.js','/.git/config','/messaging-platform/apps/../.git/config'];
  for(const p of badPaths){
    const r=await fetch(new URL(p,BASE));
    check(r.status===404,'Preview does not publish private/development path '+p);
  }
})().catch(error=>{check(false,error.stack||String(error));}).finally(async()=>{
  if(browser)await browser.close();
  const failed=report.report();
  fs.writeFileSync(path.join(shots,'homepages-report.json'),JSON.stringify({passed:report.pass.length,failed,checks:{pass:report.pass,fail:report.fail},...evidence},null,2));
  process.exitCode=failed?1:0;
});
