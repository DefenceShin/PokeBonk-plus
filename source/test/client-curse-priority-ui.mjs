// Real UI assets with an isolated synthetic host; never opens the installed game.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
const out=process.argv[2]||'artifacts/curse-priority-ui';await fs.mkdir(out,{recursive:true});
const files=Object.fromEntries(await Promise.all(['index.html','app.js','styles.css'].map(async n=>[n,await fs.readFile('client/ui/'+n,'utf8')])));
const browser=await chromium.launch({headless:true,...(process.env.PB_TEST_BROWSER?{executablePath:process.env.PB_TEST_BROWSER}:{})}),page=await browser.newPage({viewport:{width:1280,height:900},recordVideo:{dir:out,size:{width:1280,height:900}}});
const checks=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',route=>{const u=new URL(route.request().url()),n=u.pathname==='/'?'index.html':u.pathname.slice(1);return u.hostname==='offline-curse.test'&&files[n]?route.fulfill({body:files[n],contentType:n.endsWith('.js')?'application/javascript':n.endsWith('.css')?'text/css':'text/html'}):route.abort();});
await page.addInitScript(()=>{
 window.__calls=[];window.__server={running:false,game:{state:'menu'},session:{},logs:[],profile:{league:[1]},connection:{stage:'ready',nativeBoot:{phase:'ready'}},config:{mode:'tower',modeSettings:{tower:{exitPolicy:'continue',aggressiveUltimate:true,saveMoneyAfter50:true},resources:{biome:'forest',tier:1}}}};
 window.__push=()=>window.__listener?.(structuredClone(window.__server));
 window.desktop={getState:async()=>structuredClone(window.__server),getCatalog:async()=>({characters:[],maps:[],builds:[],modes:[]}),onState(fn){window.__listener=fn;return()=>{};},onLog(){return()=>{};},command:async(action,payload={})=>{
  window.__calls.push({action,payload:structuredClone(payload)});
  if(action==='config'){const old=window.__server.config;window.__server.config={...old,...payload,modeSettings:{...old.modeSettings,...Object.fromEntries(Object.entries(payload.modeSettings||{}).map(([k,v])=>[k,{...old.modeSettings[k],...v}]))}};}
  return {ok:true,state:structuredClone(window.__server)};
 }};
});
const order=()=>page.locator('#tower-curse-priority [data-curse-id]').evaluateAll(nodes=>nodes.map(n=>n.dataset.curseId));
async function check(name,fn){await fn();checks.push(name);}
try {
 await page.goto('http://offline-curse.test/');await page.locator('#tab-modes').click();
 await check('experience blessing toggle is off by default and saves independently',async()=>{
  const toggle=page.getByRole('checkbox',{name:'提高经验优先级',exact:true});await toggle.waitFor({timeout:3000});
  assert.equal(await toggle.isChecked(),false);await toggle.check();
  await page.waitForFunction(()=>window.__server.config.modeSettings.tower.experienceBlessingPriority===true);
  assert.deepEqual(await page.evaluate(()=>window.__calls.filter(c=>c.action==='config').at(-1).payload),{modeSettings:{tower:{experienceBlessingPriority:true}}});
  await page.evaluate(()=>window.__push());assert(await toggle.isChecked());await toggle.uncheck();
  await page.waitForFunction(()=>window.__server.config.modeSettings.tower.experienceBlessingPriority===false);
  await page.evaluate(()=>{window.__calls=[];});
 });
 await check('all six curses below aggressive ultimate without changing legacy settings',async()=>{
  await page.locator('#tower-curse-priority').waitFor({timeout:3000});
  assert.deepEqual(await order(),['hunger','iron','dark','graves','swift','twin']);
  const a=await page.locator('#tower-aggressive-ultimate').boundingBox(),b=await page.locator('#tower-curse-priority').boundingBox();assert(b.y>a.y+a.height);
  assert.equal(await page.evaluate(()=>window.__calls.filter(c=>c.action==='config').length),0);
 });
 await check('move persists only curse order and reload restores it',async()=>{
  await page.locator('[data-curse-id="twin"] [data-curse-move="up"]').click();
  await page.waitForFunction(()=>window.__server.config.modeSettings.tower.cursePriority?.[4]==='twin');
  assert.deepEqual(await order(),['hunger','iron','dark','graves','twin','swift']);
  assert.deepEqual(await page.evaluate(()=>window.__calls.filter(c=>c.action==='config').at(-1).payload),{modeSettings:{tower:{cursePriority:['hunger','iron','dark','graves','twin','swift']}}});
  await page.evaluate(()=>window.__push());assert.deepEqual(await order(),['hunger','iron','dark','graves','twin','swift']);
 });
 await check('every curse can move to first and boundary buttons disable',async()=>{
  for(let i=0;i<4;i++)await page.locator('[data-curse-id="twin"] [data-curse-move="up"]').click();
  assert.equal((await order())[0],'twin');
  assert(await page.locator('[data-curse-id="twin"] [data-curse-move="up"]').isDisabled());
  assert(await page.locator('[data-curse-id="swift"] [data-curse-move="down"]').isDisabled());
  await page.locator('#tower-curse-priority').screenshot({path:out+'/custom.png'});
  await page.screenshot({path:out+'/page.png'});
 });
 await check('reset to algorithm preserves other tower settings and unrelated modes',async()=>{
  await page.locator('#tower-curse-reset').click();await page.waitForFunction(()=>window.__server.config.modeSettings.tower.cursePriority==='auto');
  const c=await page.evaluate(()=>window.__server.config);assert(c.modeSettings.tower.aggressiveUltimate);assert(c.modeSettings.tower.saveMoneyAfter50);assert.deepEqual(c.modeSettings.resources,{biome:'forest',tier:1});
  assert.deepEqual(await order(),['hunger','iron','dark','graves','swift','twin']);
 });
 for(const width of [520,320])await check('controls fit narrow viewport '+width,async()=>{await page.setViewportSize({width,height:800});const b=await page.locator('#tower-curse-priority').evaluate(n=>({w:n.clientWidth,s:n.scrollWidth}));assert(b.s<=b.w+1);});
 assert.deepEqual(errors,[]);
} finally {await page.close();await browser.close();await fs.writeFile(out+'/report.json',JSON.stringify({checks,errors,isolatedHost:true,liveRunControlled:false},null,2));}
console.log(JSON.stringify({passed:checks.length,checks,errors}));
