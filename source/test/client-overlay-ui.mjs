// Isolated synthetic host only: no game, account, profile files or network.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';

const root=process.cwd(), out=path.resolve(process.argv[2]||'artifacts/0.19.0-overlay-page-ui/final.json');
const files=Object.fromEntries(await Promise.all(['index.html','app.js','styles.css'].map(async name=>[name,await fs.readFile(path.join(root,'client/ui',name),'utf8')])));
const browser=await chromium.launch({headless:true}),results=[];
await fs.mkdir(path.dirname(out),{recursive:true});
async function check(name, run, overlay, viewport={width:1280,height:850}) {
 const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{const url=new URL(route.request().url()),file=url.pathname==='/'?'index.html':url.pathname.slice(1);if(url.hostname!=='offline-overlay.test'||!files[file])return route.abort();await route.fulfill({body:files[file],contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html'});});
 await page.addInitScript(({overlay})=>{
  window.__calls=[];window.__pending=[];window.__hold=false;
  window.__server={running:false,game:{state:'over'},session:{},logs:[],config:{mode:'auto',...(overlay?{overlay}:{})},connection:{stage:'ready',nativeBoot:{phase:'ready'}},prerequisites:{status:'ready'}};
  const merge=(a,b)=>({...a,...b,overlay:b.overlay?{...a.overlay,...b.overlay,fields:{...a.overlay?.fields,...b.overlay.fields},team:b.overlay.team?{...a.overlay?.team,...b.overlay.team,fields:{...a.overlay?.team?.fields,...b.overlay.team.fields}}:a.overlay?.team}:a.overlay});
  window.__push=patch=>window.__listener?.(structuredClone({...window.__server,...patch}));
  window.__settle=()=>{const next=window.__pending.shift();if(!next)throw Error('No synthetic pending write');window.__server.config=merge(window.__server.config,next.payload);next.resolve({ok:true,state:structuredClone(window.__server)});};
  window.desktop={getState:async()=>structuredClone(window.__server),getCatalog:async()=>({characters:[{id:1,name:'合成角色'}],builds:[],maps:[{id:'forest',name:'合成森林',live:true}],modes:[],difficulties:[]}),onState(fn){window.__listener=fn;return()=>{};},onLog(){return()=>{};},command:async(action,payload={})=>{window.__calls.push({action,payload:structuredClone(payload)});if(action==='config'){if(window.__hold)return new Promise(resolve=>window.__pending.push({payload:structuredClone(payload),resolve}));window.__server.config=merge(window.__server.config,payload);}return{ok:true,state:structuredClone(window.__server)};}};
 },{overlay});
 try{await page.goto('http://offline-overlay.test/');await page.waitForFunction(()=>document.querySelector('#client-stage-label')?.textContent==='就绪');await page.locator('#tab-overlay').click();await run(page);assert.deepEqual(errors,[]);results.push({name,passed:true});}
 catch(error){results.push({name,passed:false,error:error.message,stack:error.stack,errors});}
 finally{await context.close();}
}
const stored=page=>page.evaluate(()=>window.__server.config.overlay);
const writeCount=page=>page.evaluate(()=>window.__calls.filter(row=>row.action==='config').length);
const fill=async(page,key,value)=>{await page.locator(`#overlay-${key}`).fill(String(value));await page.locator(`#overlay-${key}`).press('Tab');await page.waitForTimeout(10);};
const settle=async page=>{await page.waitForFunction(()=>window.__pending.length===1);await page.evaluate(()=>window.__settle());await page.waitForTimeout(15);};
const teamFields=['identity','totalDamage','averageDps','recentDps','damageShare','moveDamage','otherDamage','kills','health','shield','level','revives','status','damageTaken','items','vitamins','ultimate','rescue','area','distance','connection'];
const teamOpen=page=>page.locator('#overlay-team-options summary').click();
try{
 await check('tab-follows-skins-and-keyboard-can-reach-it-before-convenience',async page=>{
  assert.equal(await page.locator('#tab-overlay').evaluate(node=>node.previousElementSibling.id),'tab-skins');
  await page.locator('#tab-overview').focus();await page.keyboard.press('End');assert.equal(await page.locator('#tab-convenience').getAttribute('aria-selected'),'true');await page.keyboard.press('ArrowLeft');assert.equal(await page.locator('#tab-overlay').getAttribute('aria-selected'),'true');assert.equal(await page.locator('#page-overlay').isVisible(),true);
 });
 await check('missing-config-uses-all-four-default-fields-and-live-display-defaults',async page=>{
  for(const key of ['enabled','totalDamage','moveDamage','otherDamage','revives','hidePaused','autoPage'])assert.equal(await page.locator(`#overlay-${key}`).isChecked(),true,key);
  assert.equal(await page.locator('#overlay-number-format').inputValue(),'compact');
  for(const[key,value]of Object.entries({fontSize:12,opacity:45,width:220,height:260,x:1.5,y:46,rowGap:4,refreshMs:500,pageSeconds:6}))assert.equal(await page.locator(`#overlay-${key}`).inputValue(),String(value),key);
  assert.equal(await writeCount(page),0,'rendering defaults must not emit a write');
  assert.equal(await page.locator('#overlay-page-row').isVisible(),false);assert.equal(await page.locator('#overlay-page').isDisabled(),true);
  await page.screenshot({path:path.join(path.dirname(out),'settings-default.png')});
 });
 await check('all-24-optional-native-fields-are-off-and-individually-persistable',async page=>{
  const keys=['averageDps','damageShare','elapsed','kills','damageTaken','health','shield','experience','gold','ultimate','armor','critChance','critDamage','physical','special','damageMultiplier','attackSpeed','moveSpeed','luck','xpGain','healingMultiplier','regen','itemTriggers','rebirth'];
  assert.equal(await page.locator('#overlay-extra-fields input[type=checkbox]').count(),24);await page.locator('#overlay-extra-options summary').click();
  for(const key of keys)assert.equal(await page.locator(`#overlay-${key}`).isChecked(),false,key);
  for(const key of keys){await page.locator(`#overlay-${key}`).check();assert.equal((await stored(page)).fields[key],true,key);await page.locator(`#overlay-${key}`).uncheck();assert.equal((await stored(page)).fields[key],false,key);}
  assert.match(await page.locator('#overlay-itemTriggers').locator('xpath=ancestor::label').innerText(),/重叠/);assert.match(await page.locator('#overlay-healingMultiplier').locator('xpath=ancestor::label').innerText(),/未提供本局累计治疗/);
 });
 await check('team-group-and-sharing-and-all21-fields-default-off-without-saving',async page=>{
  assert.match(await page.locator('#overlay-team-options summary').innerText(),/默认关闭/);assert.equal(await page.locator('#overlay-team-options').evaluate(node=>node.open),false);await teamOpen(page);
  for(const key of ['enabled','shareStats','includeSelf','sameAreaOnly',...teamFields])assert.equal(await page.locator(`#overlay-team-${key}`).isChecked(),false,key);
  assert.equal(await page.locator('#overlay-team-fields input[type=checkbox]').count(),21);assert.equal(await page.locator('#overlay-team-sort').inputValue(),'damage');assert.equal(await page.locator('#overlay-team-recentSeconds').inputValue(),'10');assert.equal(await page.locator('#overlay-team-staleSeconds').inputValue(),'8');assert.equal(await writeCount(page),0);
  assert.match(await page.locator('#overlay-team-options').innerText(),/不.*击败数推算输出/);assert.match(await page.locator('#overlay-team-options').innerText(),/仅当前合作队伍的游戏连接传递/);assert.match(await page.locator('#overlay-team-options').innerText(),/可能经过游戏中继/);assert.match(await page.locator('#overlay-team-options').innerText(),/查看对方统计无需共享自己/);assert.match(await page.locator('#overlay-team-options').innerText(),/本机显示项关闭不撤回共享授权/);assert.match(await page.locator('#overlay-team-options').innerText(),/由提供方按本局游戏时间与累计伤害采样/);
 });
 await check('team-fields-are-individually-saved-without-enabling-sharing-or-old-fields',async page=>{
  await teamOpen(page);
  for(const key of teamFields){await page.locator(`#overlay-team-${key}`).check();let value=await stored(page);assert.equal(value.team.fields[key],true,key);assert.equal(value.team.enabled,false);assert.equal(value.team.shareStats,false);await page.locator(`#overlay-team-${key}`).uncheck();assert.equal((await stored(page)).team.fields[key],false,key);}
  const value=await stored(page);assert.equal(value.fields.totalDamage,true);assert.equal(value.fields.moveDamage,true);assert.equal(value.fields.otherDamage,true);assert.equal(value.fields.revives,true);
 });
 await check('team-master-empty-state-and-sharing-remain-separate-opt-in-controls',async page=>{
  await teamOpen(page);await page.locator('#overlay-team-enabled').check();assert.equal(await page.locator('#overlay-team-empty-help').isVisible(),true);assert.equal((await stored(page)).team.shareStats,false);
  await page.locator('#overlay-team-shareStats').check();let value=await stored(page);assert.equal(value.team.shareStats,true);assert.equal(teamFields.some(key=>value.team.fields[key]),false,'share-only must not turn any display fields on');
  await page.locator('#overlay-team-health').check();assert.equal(await page.locator('#overlay-team-empty-help').isVisible(),false);
  await page.locator('#overlay-team-enabled').uncheck();value=await stored(page);assert.equal(value.team.enabled,false);assert.equal(value.team.shareStats,true,'master gates runtime sharing without rewriting user preference');assert.equal(value.team.fields.health,true);
 });
 await check('team-common-preset-enables-explicit-useful-fields-and-clear-stops-team-only',async page=>{
  await teamOpen(page);await page.locator('#overlay-team-common').click();let value=await stored(page);assert.equal(value.team.enabled,true);assert.equal(value.team.shareStats,false);
  const expected=new Set(['identity','totalDamage','averageDps','recentDps','damageShare','health','status']);for(const key of teamFields)assert.equal(value.team.fields[key],expected.has(key),key);
  await page.locator('#overlay-team-shareStats').check();await page.locator('#overlay-team-clear').click();value=await stored(page);assert.equal(value.team.enabled,false);assert.equal(value.team.shareStats,false);assert.equal(teamFields.some(key=>value.team.fields[key]),false);assert.equal(value.enabled,true);assert.equal(value.fields.totalDamage,true);
 });
 await check('team-sort-and-time-controls-use-bounded-integer-values-without-dragging',async page=>{
  await teamOpen(page);for(const sort of ['slot','name','damage']){await page.locator('#overlay-team-sort').selectOption(sort);assert.equal((await stored(page)).team.sort,sort);}
  for(const key of ['recentSeconds','staleSeconds']){await fill(page,`team-${key}`,-1);assert.equal((await stored(page)).team[key],3);assert.equal(await page.locator(`#overlay-team-${key}-minus`).isDisabled(),true);await fill(page,`team-${key}`,99);assert.equal((await stored(page)).team[key],30);assert.equal(await page.locator(`#overlay-team-${key}-plus`).isDisabled(),true);await fill(page,`team-${key}`,7.5);assert.equal((await stored(page)).team[key],8);await page.locator(`#overlay-team-${key}-minus`).click();assert.equal((await stored(page)).team[key],7);const before=await writeCount(page);await fill(page,`team-${key}`,'');assert.equal(await page.locator(`#overlay-team-${key}`).getAttribute('aria-invalid'),'true');assert.equal(await writeCount(page),before);}
  assert.equal(await page.locator('#overlay-team-options input[type=range],#overlay-team-options [draggable=true]').count(),0);
 });
 await check('team-partial-state-push-preserves-explicit-false-and-future-preferences',async page=>{
  await teamOpen(page);await page.evaluate(()=>window.__push({config:{overlay:{team:{fields:{health:false}}}}}));assert.equal(await page.locator('#overlay-team-totalDamage').isChecked(),false);assert.equal(await page.locator('#overlay-team-health').isChecked(),false);assert.equal(await page.locator('#overlay-team-shareStats').isChecked(),true);
  await page.locator('#overlay-team-kills').check();const value=await stored(page);assert.equal(value.team.fields.totalDamage,false);assert.equal(value.team.fields.health,false);assert.equal(value.team.fields.kills,true);assert.equal(value.team.fields.futureCounter,true);assert.equal(value.team.futureProperty,17);assert.equal(value.team.shareStats,true);
 },{team:{enabled:true,shareStats:true,fields:{totalDamage:false,health:true,futureCounter:true},futureProperty:17}});
 await check('team-fifo-pending-full-snapshots-survive-older-ack-and-state-push',async page=>{
  await teamOpen(page);await page.evaluate(()=>window.__hold=true);await page.locator('#overlay-team-enabled').check();await page.locator('#overlay-team-health').check();await page.locator('#overlay-team-shareStats').check();await page.locator('#overlay-team-health').uncheck();await page.evaluate(()=>window.__push({}));
  assert.equal(await page.locator('#overlay-team-shareStats').isChecked(),true);assert.equal(await page.locator('#overlay-team-health').isChecked(),false);
  for(let i=0;i<4;i++){await settle(page);assert.equal(await page.locator('#overlay-team-shareStats').isChecked(),true);assert.equal(await page.locator('#overlay-team-health').isChecked(),false);}
  const value=await stored(page);assert.equal(value.team.enabled,true);assert.equal(value.team.shareStats,true);assert.equal(value.team.fields.health,false);assert.equal(value.team.fields.futureCounter,true);assert.equal(value.team.futureProperty,17);
 },{team:{fields:{futureCounter:true},futureProperty:17}});
 await check('team-reset-restores-known-opt-out-defaults-with-future-options-retained',async page=>{
  await page.locator('#overlay-reset').click();const value=await stored(page);assert.equal(value.team.enabled,false);assert.equal(value.team.shareStats,false);assert.equal(value.team.includeSelf,false);assert.equal(value.team.sameAreaOnly,false);assert.equal(value.team.sort,'damage');assert.equal(value.team.recentSeconds,10);assert.equal(value.team.staleSeconds,8);for(const key of teamFields)assert.equal(value.team.fields[key],false,key);assert.equal(value.team.fields.futureCounter,true);assert.equal(value.team.futureProperty,17);assert.equal(value.fields.futureSelf,true);
 },{fields:{futureSelf:true},team:{enabled:true,shareStats:true,includeSelf:true,sameAreaOnly:true,sort:'name',recentSeconds:30,staleSeconds:3,fields:{health:true,identity:true,futureCounter:true},futureProperty:17}});
 await check('malformed-stored-team-config-is-not-interpreted-as-consent',async page=>{
  await teamOpen(page);for(const key of ['enabled','shareStats','includeSelf','sameAreaOnly','health','totalDamage'])assert.equal(await page.locator(`#overlay-team-${key}`).isChecked(),false,key);assert.equal(await page.locator('#overlay-team-sort').inputValue(),'damage');assert.equal(await page.locator('#overlay-team-recentSeconds').inputValue(),'3');assert.equal(await page.locator('#overlay-team-staleSeconds').inputValue(),'30');assert.equal(await writeCount(page),0);
 },{team:{enabled:'true',shareStats:1,includeSelf:null,sameAreaOnly:[],sort:'unknown',recentSeconds:-1,staleSeconds:99,fields:{health:'true',totalDamage:1}}});
 await check('expanded-team-settings-fit-small-window-with-unchanged-numeric-only-layout',async page=>{
  await teamOpen(page);const result=await page.locator('#page-overlay').evaluate(node=>({client:node.clientWidth,scroll:node.scrollWidth}));assert.ok(result.scroll<=result.client+1,JSON.stringify(result));for(const selector of ['#overlay-team-enabled','#overlay-team-shareStats','#overlay-team-connection','#overlay-team-recentSeconds'])assert.equal(await page.locator(selector).count(),1);await page.screenshot({path:path.join(path.dirname(out),'team-settings-narrow.png')});
 },undefined,{width:600,height:850});
 await check('field-edit-sends-complete-object-preserving-unknown-fields',async page=>{
  await page.locator('#overlay-totalDamage').uncheck();const value=await stored(page);
  assert.equal(value.fields.totalDamage,false);assert.equal(value.fields.moveDamage,true);assert.equal(value.fields.futureCounter,false);assert.equal(value.futureProperty,'preserved');assert.equal(value.width,220);assert.equal(value.enabled,true);
 },{fields:{futureCounter:false},futureProperty:'preserved'});
 await check('whole-overlay-off-is-distinct-from-zero-background-opacity',async page=>{
  await fill(page,'opacity',0);assert.equal((await stored(page)).enabled,true);
  await page.locator('#overlay-enabled').uncheck();assert.equal((await stored(page)).enabled,false);assert.match(await page.locator('#page-overlay').innerText(),/关闭整个悬浮窗会停止刷新/);assert.match(await page.locator('#page-overlay').innerText(),/透明仍会刷新/);
 });
 await check('full-and-compact-format-are-saved-booleans',async page=>{
  await page.locator('#overlay-number-format').selectOption('full');assert.equal((await stored(page)).compactNumbers,false);
  await page.locator('#overlay-number-format').selectOption('compact');assert.equal((await stored(page)).compactNumbers,true);
 });
 await check('manual-page-is-visible-only-with-auto-page-off-and-preserves-default-and-bounds',async page=>{
  await page.locator('#overlay-autoPage').uncheck();assert.equal(await page.locator('#overlay-page-row').isVisible(),true);assert.equal(await page.locator('#overlay-page').isEnabled(),true);assert.equal(await page.locator('#overlay-page').inputValue(),'1');
  assert.match(await page.locator('#overlay-page-help').innerText(),/超出实际页数会显示最后一页/);assert.match(await page.locator('#overlay-page-help').innerText(),/底部查看/);
  await page.locator('#overlay-page-plus').click();assert.equal((await stored(page)).page,2);await page.locator('#overlay-page-minus').click();assert.equal((await stored(page)).page,1);assert.equal(await page.locator('#overlay-page-minus').isDisabled(),true);
  await fill(page,'page',10000);assert.equal((await stored(page)).page,9999);assert.equal(await page.locator('#overlay-page-plus').isDisabled(),true);
  await fill(page,'page',-1);assert.equal((await stored(page)).page,1);await fill(page,'page',3.5);assert.equal((await stored(page)).page,4);
  await page.locator('#overlay-autoPage').check();assert.equal(await page.locator('#overlay-page-row').isVisible(),false);assert.equal(await page.locator('#overlay-page').isDisabled(),true);assert.equal(await page.locator('#overlay-page-plus').isDisabled(),true);assert.equal((await stored(page)).page,4);
 });
 await check('numeric-inputs-and-buttons-replace-sliders-and-dragging',async page=>{
  assert.equal(await page.locator('#page-overlay input[type=range], #page-overlay [draggable=true]').count(),0);
  for(const key of ['fontSize','opacity','rowGap','refreshMs','pageSeconds','width','height','x','y']){assert.equal(await page.locator(`#overlay-${key}`).getAttribute('type'),'number');assert.equal(await page.locator(`#overlay-${key}-plus`).count(),1);assert.equal(await page.locator(`#overlay-${key}-minus`).count(),1);}
 });
 await check('plus-minus-use-final-step-sizes-and-keep-fractional-position',async page=>{
  await page.locator('#overlay-x-plus').click();assert.equal((await stored(page)).x,2.5);await page.locator('#overlay-x-minus').click();assert.equal((await stored(page)).x,1.5);
  await page.locator('#overlay-width-plus').click();assert.equal((await stored(page)).width,230);
  await page.locator('#overlay-refreshMs-plus').click();assert.equal((await stored(page)).refreshMs,750);
  await fill(page,'y',23.75);assert.equal((await stored(page)).y,23.75);
 });
 await check('numeric-values-clamp-to-runtime-contract-and-boundary-buttons-disable',async page=>{
  for(const[key,min,max]of [['fontSize',10,26],['opacity',0,95],['rowGap',0,12],['refreshMs',250,2000],['pageSeconds',3,20],['width',160,560],['height',120,800],['x',0,100],['y',0,100]]){
   await fill(page,key,-100);assert.equal((await stored(page))[key],min,key);assert.equal(await page.locator(`#overlay-${key}-minus`).isDisabled(),true);
   await fill(page,key,10000);assert.equal((await stored(page))[key],max,key);assert.equal(await page.locator(`#overlay-${key}-plus`).isDisabled(),true);
  }
 });
 await check('integer-fields-and-refresh-quantization-match-host-contract',async page=>{
  await fill(page,'fontSize',12.7);assert.equal((await stored(page)).fontSize,13);
  await fill(page,'rowGap',3.1);assert.equal((await stored(page)).rowGap,3);
  await fill(page,'refreshMs',600);assert.equal((await stored(page)).refreshMs,500);
  await fill(page,'refreshMs',1700);assert.equal((await stored(page)).refreshMs,1750);
  assert.equal(await page.locator('#overlay-x').getAttribute('step'),'any');
 });
 await check('invalid-empty-number-and-invalid-colors-do-not-save',async page=>{
  const before=await writeCount(page);await fill(page,'fontSize','');assert.equal(await page.locator('#overlay-fontSize').getAttribute('aria-invalid'),'true');
  await fill(page,'fontColor','bad');assert.equal(await page.locator('#overlay-fontColor').getAttribute('aria-invalid'),'true');assert.equal(await writeCount(page),before);
  await fill(page,'fontColor','#Aa00FF');assert.equal((await stored(page)).fontColor,'#aa00ff');assert.equal(await page.locator('#overlay-fontColor').getAttribute('aria-invalid'),'false');
 });
 await check('native-partial-config-push-preserves-previous-false-and-unknown-fields',async page=>{
  await page.evaluate(()=>window.__push({config:{overlay:{fields:{moveDamage:false}}}}));
  assert.equal(await page.locator('#overlay-totalDamage').isChecked(),false);assert.equal(await page.locator('#overlay-moveDamage').isChecked(),false);
  await fill(page,'height',300);const value=await stored(page);assert.equal(value.fields.futureCounter,true);assert.equal(value.fields.totalDamage,false);assert.equal(value.fields.moveDamage,false);
 },{fields:{totalDamage:false,futureCounter:true}});
 await check('fifo-pending-full-snapshots-survive-earlier-ack-and-state-push',async page=>{
  await page.evaluate(()=>window.__hold=true);await page.locator('#overlay-totalDamage').uncheck();await fill(page,'width',340);await page.locator('#overlay-revives').uncheck();
  assert.equal(await page.evaluate(()=>window.__pending.length),1);await page.evaluate(()=>window.__push({}));
  assert.equal(await page.locator('#overlay-width').inputValue(),'340');assert.equal(await page.locator('#overlay-revives').isChecked(),false);
  await settle(page);assert.equal(await page.locator('#overlay-width').inputValue(),'340');assert.equal(await page.locator('#overlay-revives').isChecked(),false);
  await settle(page);await settle(page);const value=await stored(page);assert.equal(value.width,340);assert.equal(value.fields.totalDamage,false);assert.equal(value.fields.revives,false);
 });
 await check('reset-restores-known-defaults-and-retains-future-schema-fields',async page=>{
  await page.locator('#overlay-reset').click();const value=await stored(page);assert.equal(value.enabled,true);assert.equal(value.width,220);assert.equal(value.fields.totalDamage,true);assert.equal(value.fields.futureCounter,true);assert.equal(value.futureProperty,17);
 },{enabled:false,width:500,fields:{totalDamage:false,futureCounter:true},futureProperty:17});
 await check('repeated-state-push-keeps-settings-input-dom-and-focused-draft',async page=>{
  await page.locator('#overlay-fontSize').focus();await page.locator('#overlay-fontSize').fill('19');
  const result=await page.evaluate(()=>{const before=document.querySelector('#overlay-fontSize');for(let i=0;i<100;i++)window.__push({});return{same:before===document.querySelector('#overlay-fontSize'),value:before.value,focused:document.activeElement===before};});assert.deepEqual(result,{same:true,value:'19',focused:true});
 });
 await check('small-viewport-layout-stays-inside-panel-and-tab-scrolls',async page=>{
  const result=await page.locator('#page-overlay').evaluate(node=>({client:node.clientWidth,scroll:node.scrollWidth}));assert.ok(result.scroll<=result.client+1,JSON.stringify(result));assert.equal(await page.locator('#overlay-enabled').isVisible(),true);
  await page.screenshot({path:path.join(path.dirname(out),'settings-narrow.png')});
 },undefined,{width:600,height:850});
 await check('auto-manage-is-between-quests-and-dex-in-fallback-and-host-catalog',async page=>{
  await page.locator('#tab-modes').click();
  const order=()=>page.locator('#modes-grid [data-mode]').evaluateAll(nodes=>nodes.map(node=>node.dataset.mode));
  let ids=await order();assert.equal(ids[ids.indexOf('quests')+1],'autoManage');assert.equal(ids[ids.indexOf('autoManage')+1],'dex');
  await page.evaluate(()=>window.__PB_UI.receiveCatalog({modes:[{id:'auto',label:'自动'},{id:'dex',label:'图鉴'},{id:'quests',label:'委托'},{id:'autoManage',label:'自动托管'}]}));
  ids=await order();assert.equal(ids.filter(id=>id==='autoManage').length,1);assert.equal(ids[ids.indexOf('quests')+1],'autoManage');assert.equal(ids[ids.indexOf('autoManage')+1],'dex');
 });
 await check('auto-manage-options-default-off-and-hide-unused-new-run-route',async page=>{
  await page.locator('#tab-modes').click();await page.locator('[data-mode=autoManage]').click();
  assert.equal(await page.locator('#auto-manage-options').isVisible(),true);assert.equal(await page.locator('#auto-manage-build-priority').isChecked(),false);
  assert.equal(await page.locator('#biome-select').isVisible(),false);assert.equal(await page.locator('#tier-select').isVisible(),false);assert.equal(await page.locator('#tower-options').isVisible(),false);
  assert.match(await page.locator('#mode-help').innerText(),/先手动开始游戏/);assert.match(await page.locator('#mode-constraint-note').innerText(),/优先于“结束后继续”/);
  assert.match(await page.locator('#auto-manage-options').innerText(),/不主动新增、替换、遗忘或融合/);assert.match(await page.locator('#auto-manage-options').innerText(),/原生必选页/);
  await page.locator('#auto-manage-options').scrollIntoViewIfNeeded();await page.waitForTimeout(200);
  await page.screenshot({path:path.join(path.dirname(out),'auto-manage-settings.png')});
 });
 await check('auto-manage-priority-true-and-false-save-without-mutating-other-plan-or-restart',async page=>{
  await page.evaluate(()=>{window.__server.config={...window.__server.config,autoRestart:true,finalReplacements:{'1':{strictMoves:{enabled:true,targets:['move-a']}}}};window.__push({});});
  await page.locator('#tab-modes').click();await page.locator('[data-mode=autoManage]').click();await page.locator('#auto-manage-build-priority').check();
  assert.equal(await page.evaluate(()=>window.__server.config.autoManageBuildPriority),true);
  await page.locator('#auto-manage-build-priority').uncheck();const saved=await page.evaluate(()=>window.__server.config);assert.equal(saved.autoManageBuildPriority,false);assert.equal(saved.autoRestart,true);assert.deepEqual(saved.finalReplacements,{'1':{strictMoves:{enabled:true,targets:['move-a']}}});
  assert.deepEqual(await page.evaluate(()=>window.__calls.filter(row=>row.action==='config').at(-1).payload),{autoManageBuildPriority:false});
 });
 await check('auto-manage-menu-overview-names-live-run-requirement-without-fake-map-prerequisite',async page=>{
  await page.locator('#tab-modes').click();await page.locator('[data-mode=autoManage]').click();await page.locator('#tab-overview').click();
  const text=await page.locator('#unlock-goal-steps').innerText();assert.match(text,/原生条件/);assert.match(text,/当前没有读取到进行中的对局/);assert.doesNotMatch(text,/具体路线尚未选定|先通关本图/);
  assert.match(await page.locator('#control-detail').innerText(),/请先手动开始原生对局/);assert.equal(await page.locator('#main-action-label').innerText(),'开始托管');
 });
 await check('auto-manage-active-run-preserves-specific-runtime-waiting-message',async page=>{
  await page.locator('#tab-modes').click();await page.locator('[data-mode=autoManage]').click();
  await page.evaluate(()=>window.__push({running:true,game:{state:'play',nativeMode:'tower',plan:{mode:'autoManage'}},status:{title:'等待手动处理',message:'本次必须新增招式，请手动选择或开启配装最高优先级'}}));
  assert.match(await page.locator('#control-detail').innerText(),/本次必须新增招式/);assert.equal(await page.locator('#main-action-label').innerText(),'停止托管');
  await page.evaluate(()=>window.__push({running:true,game:{state:'play',nativeMode:'tower',plan:{mode:'autoManage'},status:'自动托管：本次必须新增维生素，请手动选择'},status:null}));
  assert.match(await page.locator('#control-detail').innerText(),/本次必须新增维生素/);
  await page.locator('#tab-overview').click();assert.match(await page.locator('#unlock-goal-steps').innerText(),/当前已读取到进行中的原生对局/);
 });
 await check('auto-manage-priority-pending-false-survives-mode-roundtrip-and-old-push',async page=>{
  await page.locator('#tab-modes').click();await page.locator('[data-mode=autoManage]').click();await page.evaluate(()=>window.__hold=true);
  await page.locator('#auto-manage-build-priority').check();await page.locator('[data-mode=resources]').click();await page.locator('[data-mode=autoManage]').click();await page.locator('#auto-manage-build-priority').uncheck();await page.evaluate(()=>window.__push({}));
  for(let i=0;i<4;i++){assert.equal(await page.locator('#auto-manage-build-priority').isChecked(),false);await settle(page);}
  const saved=await page.evaluate(()=>window.__server.config);assert.equal(saved.mode,'autoManage');assert.equal(saved.autoManageBuildPriority,false);
 });
}finally{
 await browser.close();await fs.mkdir(path.dirname(out),{recursive:true});await fs.writeFile(out,JSON.stringify({passed:results.every(row=>row.passed),isolatedSyntheticHostOnly:true,noGameAccountOrNetworkAccess:true,sourceSha256:Object.fromEntries(Object.entries(files).map(([name,content])=>[name,createHash('sha256').update(content).digest('hex')])),results},null,2)+'\n');
}
console.log(JSON.stringify({out,passed:results.filter(row=>row.passed).length,total:results.length,failures:results.filter(row=>!row.passed)},null,2));if(results.some(row=>!row.passed))process.exitCode=1;
