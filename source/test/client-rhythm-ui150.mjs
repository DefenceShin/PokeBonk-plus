// Real local UI, inert desktop adapter; no game, account or network.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route('https://**/*',route=>route.abort());
await page.addInitScript(()=>{
  window.calls=[];
  let listener;
  const config={mode:'shiny',randomDelay:true,randomDelayMinMs:600,randomDelayMaxMs:1800,
    convenience:{rhythm:{enabled:true,randomDelay:true,randomDelayMinMs:600,randomDelayMaxMs:1800,
      betweenRunWait:true,betweenRunWaitMinSeconds:5,betweenRunWaitMaxSeconds:15,inspectPanel:true,
      activationSchedule:false,activationStart:'00:00',activationEnd:'00:00',activationDays:[1,2,3,4,5,6,7]}}};
  window.desktop={getState:async()=>({config,game:{},logs:[],session:{}}),getCatalog:async()=>({characters:[],builds:[],maps:[],modes:[]}),
    onState:cb=>{listener=cb;return()=>{};},onLog:()=>()=>{},command:async(action,payload={})=>{
      window.calls.push({action,payload});
      if(action==='configure') {Object.assign(config,payload);listener?.({config,game:{},logs:[],session:{}});}
      return {ok:true};}};
});
try {
  await page.goto(new URL('../client/ui/index.html',import.meta.url).href);
  await page.locator('#tab-convenience').click();
  await page.locator('#convenience-feature-rhythm').waitFor();
  assert.equal(await page.locator('#convenience-nav button').first().getAttribute('data-convenience-feature'),'rhythm');
  assert.equal(await page.locator('#convenience-title').textContent(),'运行节奏');
  assert.equal(await page.locator('#random-delay-min').isVisible(),true);
  await page.locator('#random-delay-min').fill('0.7');await page.locator('#random-delay-min').dispatchEvent('change');
  await page.locator('#convenience-rhythm-activationSchedule').check();
  await page.locator('#convenience-rhythm-activationStart').fill('22:00');await page.locator('#convenience-rhythm-activationStart').dispatchEvent('change');
  await page.locator('#convenience-feature-favorite').click();
  assert.equal(await page.locator('#convenience-title').textContent(),'一键收藏');
  assert.equal(await page.locator('#random-delay-min').isVisible(),false);
  await page.locator('#convenience-feature-rhythm').click();
  assert.equal(await page.locator('#random-delay-min').isVisible(),true);
  const calls=await page.evaluate(()=>window.calls);
  assert.ok(calls.some(x=>x.payload?.convenience?.rhythm?.randomDelayMinMs===700));
  assert.ok(calls.some(x=>x.payload?.convenience?.rhythm?.activationSchedule===true));
  assert.ok(calls.some(x=>x.payload?.convenience?.rhythm?.activationStart==='22:00'));
  assert.deepEqual(errors,[]);
  await fs.mkdir(new URL('../artifacts/',import.meta.url),{recursive:true});
  await fs.writeFile(new URL('../artifacts/1.5.0-rhythm-ui150.json',import.meta.url),JSON.stringify({passed:true,network:'blocked',checks:10},null,2));
  console.log('Rhythm UI: 10 checks passed');
} finally {await browser.close();}
