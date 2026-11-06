import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

// Isolated panel stress against the shipped public catalog, with a synthetic
// account and blocked network. Structural budgets are asserted; timings and
// unforced browser heap samples are observations, not leak/crash proof.
const root=process.cwd(), output=path.resolve(process.argv[2]||'artifacts/ui-skin-performance-0.18.0-checked.json');
const app=await fs.readFile(path.join(root,'client/ui/app.js'),'utf8');
const catalog=JSON.parse(await fs.readFile(path.join(root,'data/catalog.json'),'utf8'));
catalog.encyclopedia=JSON.parse(await fs.readFile(path.join(root,'data/encyclopedia.json'),'utf8'));
catalog.unlockGoals=JSON.parse(await fs.readFile(path.join(root,'data/unlock-catalog.json'),'utf8'));
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1280,height:850}}), errors=[];
page.on('pageerror',error=>errors.push(error.message));
const measured=['allBuilds','dedicatedBuild','renderConfig','renderCharacters','renderBuild','renderFinalReplacements','finalReplacementPool','modes','indexEncyclopedia','renderEncyclopedia','renderOverview','renderRecent','renderSkins'];
let instrumented=app;
for(const name of measured) instrumented=instrumented.replace(new RegExp(`function ${name}\\(([^)]*)\\) \\{`),`function ${name}($1) { if(window.__collect){window.__counts.calls.${name}=(window.__counts.calls.${name}||0)+1;}`);
await page.route('**/*',async route=>{
 const url=new URL(route.request().url());
 if(url.hostname!=='offline-ui.test'){await route.abort();return;}
 const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
 if(!['index.html','styles.css','app.js'].includes(name)){await route.abort();return;}
 await route.fulfill({status:200,contentType:name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html',body:name==='app.js'?instrumented:await fs.readFile(path.join(root,'client/ui',name))});
});
await page.addInitScript(({catalog})=>{
 window.__collect=false;window.__counts={};window.__reset=()=>{window.__counts={calls:{},created:0,replaced:0,stringifies:0,stringBytes:0};};window.__reset();
 const create=document.createElement.bind(document);document.createElement=(...args)=>{if(window.__collect)window.__counts.created++;return create(...args);};
 const replace=Element.prototype.replaceChildren;Element.prototype.replaceChildren=function(...args){if(window.__collect)window.__counts.replaced++;return replace.apply(this,args);};
 const stringify=JSON.stringify;JSON.stringify=function(...args){const result=stringify(...args);if(window.__collect){window.__counts.stringifies++;window.__counts.stringBytes+=result?.length||0;}return result;};
 window.__state={running:true,paused:false,profile:{league:catalog.characters.map(char=>char.id),biomes:{forest:2,desert:2,graveyard:2,coast:2},stardust:100},config:{mode:'tower',characterId:1,build:'auto',modeSettings:{tower:{exitPolicy:'continue',noCandles:false}}},session:{elapsedSeconds:1},game:{state:'play',accountType:'guest',characterId:1,species:1,level:27,hp:200,maxHp:200,stage:1,nativeMode:'tower',tower:{floor:25,wave:2},buildId:'generic',unlockProgress:{status:'earning',targetId:'events:halloween26:quest:abyss',message:'按原生条件继续挑战',display:{targetName:'深渊',stepName:'持续推进塔层',progressLabel:'7/25',nativeConditions:['达到25层，按原生保存后的进度确认。']}}},logs:Array.from({length:20},(_,i)=>({id:i,type:'run',title:`开始第${i+1}局`,at:'2026-10-23T00:00:00Z'})),connection:{stage:'ready',nativeBoot:{phase:'ready'}},prerequisites:{status:'ready'}};
 window.__push=(iteration,changing)=>{window.__state.game={...window.__state.game,time:iteration,gameFps:60+(iteration%3),tower:{floor:1+iteration%30,wave:iteration%4},...(changing?{tactics:{preferredMoves:['vine-whip','solar-beam',iteration%2?'razor-leaf':'sleep-powder'],observedMoves:['vine-whip']}}:{})};window.__state.session={elapsedSeconds:iteration};window.__listener?.(structuredClone(window.__state));};
 window.desktop={getState:async()=>structuredClone(window.__state),getCatalog:async()=>catalog,onState(listener){window.__listener=listener;return()=>{};},onLog(){return()=>{};},command:async(action,payload)=>({ok:true})};
},{catalog});
const phases=[];
try{
 await page.goto('http://offline-ui.test/');await page.waitForFunction(()=>document.querySelector('#client-stage-label')?.textContent.includes('就绪'));
 const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
 const metrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.filter(item=>['JSHeapUsedSize','JSHeapTotalSize','Nodes','Documents','JSEventListeners'].includes(item.name)).map(item=>[item.name,item.value]));
 for(const [tab,count,changing] of [['overview',300,false],['characters',120,false],['characters',120,true],['encyclopedia',120,false],['overview',300,false]]){
  await page.locator(`#tab-${tab}`).click();await page.waitForTimeout(50);const before=await metrics();
  const value=await page.evaluate(({count,changing})=>{window.__reset();window.__collect=true;const times=[];for(let i=0;i<count;i++){const start=performance.now();window.__push(i,changing);times.push(performance.now()-start);}window.__collect=false;times.sort((a,b)=>a-b);return {count,medianMs:times[Math.floor(count/2)],p95Ms:times[Math.floor(count*.95)],maxMs:times.at(-1),totalMs:times.reduce((a,b)=>a+b,0),...window.__counts};},{count,changing});
  const after=await metrics();phases.push({tab,changing,...value,before,after});
 }
 for(const phase of phases){
  assert.equal(phase.calls.indexEncyclopedia||0,0,'game status must not reindex the full encyclopedia');
  assert.equal(phase.calls.finalReplacementPool||0,0,'unchanged settings must not reconstruct full learnable pools');
  if(!phase.changing){assert.equal(phase.created,0,'stable content must not create fresh elements');assert.equal(phase.replaced,0,'stable content must not replace child trees');}
  else {assert.ok(phase.created<=phase.count*10);assert.ok((phase.calls.dedicatedBuild||0)<=phase.count*2);assert.ok(phase.after.JSEventListeners-phase.before.JSEventListeners<=phase.count);}
 }
 // Index caches must follow genuine catalog and custom-plan changes too.
 const refresh=await page.evaluate(()=>{
  const char={id:1,name:'新目录角色',unlocked:true,learnableMoves:[{key:'fresh-move',name:'新招式'}]};
  window.__PB_UI.receiveCatalog({characters:[char],builds:[{id:'fresh-build',characterId:1,name:'新专属',moves:['fresh-move']}],maps:[{id:'forest',name:'新地图'}],moves:[{key:'fresh-move',name:'新招式'}]});
  window.__PB_UI.receiveState({customPlans:[{id:'fresh-custom',name:'自定义新方案',species:1,enabled:true}],config:{characterId:1,build:'fresh-custom'}});
  window.__PB_UI.showTab('characters');
  return {character:document.querySelector('#build-character').textContent,options:[...document.querySelector('#build-select').options].map(option=>option.value),replacement:document.querySelector('#final-replacements').dataset.characterId};
 });
 assert.equal(refresh.character,'新目录角色');assert.ok(refresh.options.includes('fresh-build'));assert.ok(refresh.options.includes('fresh-custom'));assert.equal(refresh.replacement,'1');
 assert.deepEqual(errors,[]);
 await fs.writeFile(output,JSON.stringify({passed:true,isolatedMockOnly:true,noGameAccountOrProfileAccess:true,noForcedGcOrReload:true,catalog:{characters:catalog.characters.length,builds:catalog.builds.length,encyclopedia:catalog.encyclopedia.entries.length,unlockGoals:catalog.unlockGoals.targets?.length},sourceSha256:createHash('sha256').update(app).digest('hex'),phases,cacheRefresh:refresh,errors},null,2));
 console.log(JSON.stringify({output,phases,errors},null,2));
}finally{await browser.close();}
