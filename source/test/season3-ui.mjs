import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const task=new URL('../../',import.meta.url),read=p=>fs.readFileSync(new URL(p,task),'utf8');
const actual=JSON.parse(read('evidence/editor-catalog.json')),base=JSON.parse(read('source/data/catalog.json'));
const catalog={...base,...actual};
const scope={stage:'M2',automaticPlay:true,reason:'旧常规地图离线候选，实战待验',modeIds:['resources','map','autoManage'],biomeIds:['forest','desert','coast','glacier']};
const state={running:false,paused:false,game:{},session:{},logs:[],profile:{league:actual.characters.map(c=>Number(c.id)),biomes:Object.fromEntries(actual.maps.map(m=>[m.id,2]))},compatibilityReport:{state:'ready',maintenanceScope:scope},connection:{stage:'ready'},config:{mode:'resources',characterId:1,modeSettings:{resources:{biome:'forest',tier:0}}},customPlans:[]};
const files=Object.fromEntries(['index.html','app.js','styles.css','product-source.js'].map(k=>[k,read('source/client/ui/'+k)]));
const context=await chromium.launchPersistentContext(new URL('isolated-user-data/ui/',task).pathname.replace(/^\/([A-Za-z]:)/,'$1'),{headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',viewport:{width:1280,height:900}});
try{
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',route=>{const u=new URL(route.request().url()),key=u.pathname.slice(1)||'index.html';return u.hostname==='m1-ui.test'&&files[key]?route.fulfill({body:files[key],contentType:key.endsWith('.js')?'application/javascript':key.endsWith('.css')?'text/css':'text/html'}):route.abort();});
 await page.exposeFunction('persistIsolatedPlan',plan=>{const p={...plan,id:plan.id||'m1-isolated-plan'};fs.writeFileSync(new URL('evidence/isolated-plan.json',task),JSON.stringify(p,null,2));return p;});
 await page.addInitScript(({catalog,state})=>{
  window.__server=state;window.__calls=[];window.desktop={getState:async()=>structuredClone(window.__server),getCatalog:async()=>catalog,onState(f){window.__listener=f;return()=>{}},onLog(){return()=>{}},command:async(action,payload={})=>{
   window.__calls.push({action,payload});if(action==='config')Object.assign(window.__server.config,payload);
   if(action==='saveCustomPlan'){const plan=await window.persistIsolatedPlan(payload.plan);window.__server.customPlans=[plan];return {ok:true,plan,customPlans:[plan],state:structuredClone(window.__server)};}
   return {ok:true,state:structuredClone(window.__server)};
  }};
 },{catalog,state});
 await page.goto('http://m1-ui.test/');
 await page.click('#tab-modes');
 await page.screenshot({path:new URL('evidence/ui-modes.png',task).pathname.replace(/^\/([A-Za-z]:)/,'$1')});
 assert.equal(await page.locator('[data-mode="mutation"]').isDisabled(),true,'unsupported mutation must be unavailable');
 assert.equal(await page.locator('#main-action').isDisabled(),false,'supported resource configuration can be manually started');
 assert.equal(await page.locator('#biome-select option[value="canela"]').evaluate(el=>el.disabled),true,'out-of-scope maps must be unavailable');
 await page.evaluate(()=>{window.__server.config.mode='tower';window.__listener(structuredClone(window.__server));});
 assert.equal(await page.locator('#main-action').isDisabled(),true,'previously saved unsupported mode cannot start from the action bar');
 await page.evaluate(()=>{window.__server.config.mode='resources';window.__listener(structuredClone(window.__server));});
 assert.equal(await page.locator('#main-action').isDisabled(),false);
 assert.equal(await page.evaluate(()=>window.__calls.some(c=>/start|begin|resume/i.test(c.action))),false,'loading a configuration must never start a run');
 await page.evaluate(()=>{window.__server.config.modeSettings.resources.biome='canela';window.__listener(structuredClone(window.__server));});
 assert.equal(await page.locator('#main-action').isDisabled(),true,'saved unsupported resource map stays disabled after refresh');
 await page.evaluate(()=>{window.__server.config.modeSettings.resources.biome='forest';window.__listener(structuredClone(window.__server));window.__calls=[];});
 await page.click('#main-action');await page.waitForFunction(()=>window.__calls.some(c=>c.action==='start'));
 assert.equal(await page.evaluate(()=>window.__calls.filter(c=>['start','resume'].includes(c.action)).length),1,'one manual resource click submits one start');
 await page.evaluate(()=>{window.__calls=[];window.__listener(structuredClone(window.__server));});
 await page.click('[data-mode="maps"]');await page.waitForFunction(()=>window.__server.config.mode==='map');
 assert.equal(await page.evaluate(()=>window.__calls.filter(c=>['start','resume'].includes(c.action)).length),0,'selecting map mode does not start');
 assert.equal(await page.evaluate(()=>window.__calls.find(c=>c.action==='config')?.payload.mode),'map');
 await page.click('#main-action');await page.waitForFunction(()=>window.__calls.some(c=>c.action==='start'));
 assert.equal(await page.evaluate(()=>window.__calls.filter(c=>['start','resume'].includes(c.action)).length),1,'one manual map click submits one start');
 await page.evaluate(()=>{window.__server.config.mode='resources';window.__listener(structuredClone(window.__server));});

 await page.click('#tab-plans');await page.click('#plan-new');await page.fill('#plan-name','M2 城都目录隔离测试');await page.click('[data-plan-section="moves"]');
 const move=actual.moves.find(m=>m.key==='moonblast');assert.ok(move);
 await page.fill('#plan-moves-search',move.name);
 await page.locator('#plan-moves-results button').filter({hasText:'moonblast'}).click();
 await page.click('#plan-save');await page.waitForFunction(()=>window.__server.customPlans.length===1);
 const saved=JSON.parse(read('evidence/isolated-plan.json'));assert.equal(saved.name,'M2 城都目录隔离测试');assert.ok(JSON.stringify(saved).includes('moonblast'));
 await page.screenshot({path:new URL('evidence/ui-plan-saved.png',task).pathname.replace(/^\/([A-Za-z]:)/,'$1')});
 await page.evaluate(p=>{window.__server.customPlans=[p];window.__listener(structuredClone(window.__server));},saved);
 assert.ok((await page.locator('#plan-list').innerText()).includes(saved.name));
 await page.locator('#tab-convenience').evaluate(el=>el.click());await page.click('#convenience-feature-outside');
 for(const key of ['autoUpgrade','autoUnlockItems','autoClaim','reserveMoveSlot'])assert.equal(await page.locator('#setting-'+key).isChecked(),false);
 await page.evaluate(()=>{Object.assign(window.__server.config,{autoUpgrade:true,autoClaim:true});window.__listener(structuredClone(window.__server));});
 for(const key of ['autoUpgrade','autoClaim'])assert.equal(await page.locator('#setting-'+key).isChecked(),true);
 assert.deepEqual(errors,[]);
 fs.writeFileSync(new URL('evidence/ui-result.json',task),JSON.stringify({actualCatalog:{characters:actual.characters.length,maps:actual.maps.length,moves:actual.moves.length},unsupportedMutationDisabled:true,m2UnsupportedStartDisabled:true,startupNoStart:true,savedUnsupportedMapBlocked:true,mapCardStoresMapWithoutStart:true,manualResourceStartOnce:true,manualMapStartOnce:true,savedPlan:saved.id,search:move.key,readSavedPlan:true,fourDefaultsFalse:true,explicitTruePreserved:true,pageErrors:errors,liveGame:false},null,2));console.log('PASS actual current catalog/search/plan save/read, unavailable modes, M2 scope gate, UI defaults');
}finally{await context.close();}
