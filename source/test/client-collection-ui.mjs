// Isolated collection-mode UI; no real client, game, account or network.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const out=process.argv[2]||'artifacts/0.19.0-collection-ui/results.json';
await fs.mkdir(path.dirname(out),{recursive:true});
const files=Object.fromEntries(await Promise.all(['index.html','app.js','styles.css'].map(async file=>[file,await fs.readFile('client/ui/'+file,'utf8')])));
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1280,height:850}}),errors=[],checks=[];
page.on('pageerror',error=>errors.push(error.message));
await page.route('**/*',async route=>{const url=new URL(route.request().url()),file=url.pathname==='/'?'index.html':url.pathname.slice(1);
 if(url.hostname!=='offline-collection.test'||!files[file])return route.abort();
 return route.fulfill({body:files[file],contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html'});});
await page.addInitScript(()=>{
 window.__calls=[];window.__listener=null;
 window.__server={running:false,game:{state:'over'},session:{},logs:[],profile:{league:[1],biomes:{forest:3,coast:-1}},
  config:{mode:'wardrobe',characterId:1,modeSettings:{wardrobe:{species:'auto',look:'auto',futureField:false},allClears:{species:25,biome:'coast',tier:2},resources:{biome:'forest',tier:1}}},
  connection:{stage:'ready',nativeBoot:{phase:'ready'}},prerequisites:{status:'ready'}};
 const targets=[1,25].flatMap(member=>[{id:'characters:'+member,category:'characters',nativeId:member,key:String(member)},
  ...['shiny','spectral','classic','m1','m2'].map(look=>({id:`appearance:skin-${look}:${member}`,category:'appearance',name:(member===25?'皮卡丘':'妙蛙种子')+'·'+(look==='m1'?'专属北极光':look),look:{member,key:look}}))]);
 window.__catalog={characters:[{id:1,name:'妙蛙种子'},{id:25,name:'皮卡丘'}],builds:[],modes:[],maps:[{id:'forest',name:'翠绿森林',live:true},{id:'coast',name:'风暴海岸',live:true},{id:'graveyard',name:'未开放地图',live:false}],difficulties:[{id:0,name:'普通'},{id:1,name:'困难'},{id:2,name:'噩梦'}],unlockGoals:{sourceHash:'synthetic-public-only',categories:[{id:'characters',modes:['characters']},{id:'appearance',modes:['appearance']}],targets}};
 window.__push=patch=>{Object.assign(window.__server,patch);window.__listener?.(structuredClone(window.__server));};
 window.desktop={getState:async()=>structuredClone(window.__server),getCatalog:async()=>structuredClone(window.__catalog),onState(fn){window.__listener=fn;return()=>{};},onLog(){return()=>{};},command:async(action,payload={})=>{
  window.__calls.push({action,payload:structuredClone(payload)});
  if(action==='config'){const before=window.__server.config;window.__server.config={...before,...payload,modeSettings:{...before.modeSettings,
   ...Object.fromEntries(Object.entries(payload.modeSettings||{}).map(([mode,value])=>[mode,{...before.modeSettings?.[mode],...value}]))}};}
  return {ok:true,state:structuredClone(window.__server)};
 }};
});
const check=async(name,run)=>{try{await run();checks.push({name,passed:true});}catch(error){checks.push({name,passed:false,error:error.message,stack:error.stack});}};
const config=()=>page.evaluate(()=>window.__server.config);
const mode=async id=>{await page.locator('#tab-modes').click();await page.locator(`[data-mode="${id}"]`).click();await page.waitForFunction(id=>window.__server.config.mode===id,id);};
try{
 await page.goto('http://offline-collection.test/');await page.waitForFunction(()=>document.querySelector('#client-stage-label')?.textContent==='就绪');await page.locator('#tab-modes').click();
 await check('both permanent collection modes precede limited events',async()=>{
  const ids=await page.locator('#modes-grid > button').evaluateAll(nodes=>nodes.map(node=>node.dataset.mode||node.id));
  assert.ok(ids.includes('wardrobe')&&ids.includes('allClears'));assert.ok(ids.indexOf('wardrobe')<ids.indexOf('limited-events-toggle'));assert.ok(ids.indexOf('allClears')<ids.indexOf('limited-events-toggle'));
  assert.equal(ids.at(-1),'limited-events-toggle');assert.equal(await page.locator('#modes-grid [data-mode="tower"]').count(),0);
  assert.equal(await page.locator('#limited-events-grid [data-mode="tower"]').count(),1);assert.equal(await page.locator('#limited-events-region').isHidden(),true);
 });
 await check('wardrobe defaults are auto with all current native look categories and includes unowned roles',async()=>{
  assert.equal(await page.locator('#collection-species').inputValue(),'auto');assert.equal(await page.locator('#wardrobe-look').inputValue(),'auto');
  assert.deepEqual(await page.locator('#wardrobe-look option').evaluateAll(nodes=>nodes.map(node=>node.value)),['auto','shiny','spectral','classic','m1','m2','t1','t2']);
  assert.equal(await page.locator('#collection-species option[value="25"]').isDisabled(),false);assert.match(await page.locator('#collection-species option[value="25"]').textContent(),/先自动解锁/);
  assert.equal(await page.locator('#biome-select').isVisible(),false);assert.equal(await page.locator('#tier-select').isVisible(),false);
 });
 await check('species changes link actual look names without changing global character or another mode',async()=>{
  await page.locator('#collection-species').selectOption('25');await page.waitForFunction(()=>window.__server.config.modeSettings.wardrobe.species===25);
  assert.equal(await page.locator('#wardrobe-look option[value="m1"]').textContent(),'皮卡丘·专属北极光');
  const saved=await config();assert.equal(saved.characterId,1);assert.equal(saved.modeSettings.wardrobe.futureField,false);assert.deepEqual(saved.modeSettings.allClears,{species:25,biome:'coast',tier:2});
 });
 await check('wardrobe look persists independently and explains native/local distinction and temporary priority',async()=>{
  await page.locator('#wardrobe-look').selectOption('m1');assert.equal((await config()).modeSettings.wardrobe.look,'m1');
  assert.match(await page.locator('#mode-constraint-note').textContent(),/原生更衣室.*本机 PNG.*临时优先/);
  await page.locator('#mode-configuration').scrollIntoViewIfNeeded();await page.screenshot({path:out.replace(/\.json$/,'-wardrobe.png')});
 });
 await check('allClears restores its own three controls and permits locked-map prerequisite selection',async()=>{
  await mode('allClears');assert.equal(await page.locator('#collection-species').inputValue(),'25');assert.equal(await page.locator('#biome-select').inputValue(),'coast');assert.equal(await page.locator('#tier-select').inputValue(),'2');
  assert.equal(await page.locator('#wardrobe-look').isVisible(),false);assert.equal(await page.locator('#biome-select option[value="coast"]').isDisabled(),false);
  assert.equal(await page.locator('#biome-select option[value="graveyard"]').evaluate(node=>node.disabled),true,await page.locator('#biome-select').evaluate(node=>node.innerHTML));
 });
 await check('all-auto settings save only this mode and never infer cross-map victory from native badges',async()=>{
  await page.locator('#collection-species').selectOption('auto');await page.locator('#biome-select').selectOption('auto');await page.locator('#tier-select').selectOption('auto');
  const saved=await config();assert.deepEqual(saved.modeSettings.allClears,{species:'auto',biome:'auto',tier:'auto'});assert.equal(saved.modeSettings.wardrobe.species,25);assert.equal(saved.modeSettings.wardrobe.look,'m1');assert.deepEqual(saved.modeSettings.resources,{biome:'forest',tier:1});
  assert.match(await page.locator('#mode-constraint-note').textContent(),/真实标准模式胜利.*通关圆圈.*不能拼.*塔与无尽不计入/);
  await page.locator('#mode-configuration').scrollIntoViewIfNeeded();await page.screenshot({path:out.replace(/\.json$/,'-all-clears.png')});
 });
 await check('return to wardrobe restores both linked selections',async()=>{
  await mode('wardrobe');assert.equal(await page.locator('#collection-species').inputValue(),'25');assert.equal(await page.locator('#wardrobe-look').inputValue(),'m1');
 });
 await check('overview renders final goal, current step, exact reason and separate total/current progress',async()=>{
  await page.evaluate(()=>window.__push({game:{state:'over',unlockProgress:{status:'ready',message:'先完成目标前置',display:{targetName:'专属北极光',finalTarget:'皮卡丘的原生衣橱',stepName:'先解锁皮卡丘',why:'当前存档尚未加入联盟',totalProgress:'已获得 2/5 个外观',currentProgress:'挑战计数 7/25',nextStep:'保存后继续专属挑战',nativeConditions:['必须成功捕获并保存联盟资格','本次临时执行目标配装，不改保存配置']}}}}));
  await page.locator('#tab-overview').click();const text=await page.locator('#unlock-goal-steps').textContent();
  for(const value of ['最终目标','皮卡丘的原生衣橱','正在做','先解锁皮卡丘','原因','尚未加入联盟','总进度','2/5','当前进度','7/25','原生条件'])assert.ok(text.includes(value),value);
 });
 await check('repeated state pushes preserve stable linked dropdown nodes and issue no config writes',async()=>{
  await page.locator('#tab-modes').click();const result=await page.evaluate(()=>{const node=document.querySelector('#wardrobe-look option[value="m1"]'),before=window.__calls.filter(call=>call.action==='config').length;
   for(let n=0;n<100;n++)window.__push({session:{elapsedSeconds:n}});return {same:node===document.querySelector('#wardrobe-look option[value="m1"]'),writes:window.__calls.filter(call=>call.action==='config').length-before};});
  assert.deepEqual(result,{same:true,writes:0});
 });
 for(const width of [760,520,320])await check('collection controls stay within viewport at '+width,async()=>{
  await page.setViewportSize({width,height:700});for(const id of ['wardrobe','allClears']){await mode(id);const box=await page.locator('#mode-configuration').boundingBox();
   const dimensions=await page.locator('#mode-configuration').evaluate(node=>({width:node.clientWidth,scroll:node.scrollWidth}));assert.ok(dimensions.scroll<=dimensions.width+1,`${id}: ${JSON.stringify(dimensions)}`);
   for(const selector of ['#collection-species',...(id==='wardrobe'?['#wardrobe-look']:['#biome-select','#tier-select'])]){const rect=await page.locator(selector).boundingBox();assert.ok(rect.x>=box.x&&rect.x+rect.width<=box.x+box.width+1,selector);}}
 });
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
const result={isolatedSyntheticOnly:true,noClientAccountOrNetwork:true,checks,errors,passed:checks.filter(row=>row.passed).length,total:checks.length,
 sourceHashes:Object.fromEntries(Object.entries(files).map(([name,source])=>[name,createHash('sha256').update(source).digest('hex')]))};
await fs.writeFile(out,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({out,passed:result.passed,total:result.total,failures:checks.filter(row=>!row.passed)},null,2));if(result.passed!==result.total||errors.length)process.exitCode=1;
