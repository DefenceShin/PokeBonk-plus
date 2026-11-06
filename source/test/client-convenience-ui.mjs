// Isolated synthetic host; no live client, account, credentials or game access.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {CONVENIENCE_DEFAULTS} from '../src/player-convenience.mjs';
import {generateMaintenancePrompt} from '../src/maintenance-prompts.mjs';

const root=process.cwd(),out=path.resolve(process.argv[2]||'artifacts/0.19.0-convenience-ui/results.json');
const files=Object.fromEntries(await Promise.all(['index.html','app.js','styles.css','product-source.js'].map(async file=>[file,await fs.readFile(path.join(root,'client/ui',file),'utf8')])));
const browser=await chromium.launch({headless:true,executablePath:process.env.PB_TEST_BROWSER}),results=[];
await fs.mkdir(path.dirname(out),{recursive:true});
async function check(name,run,config={}) {
 if(process.env.PB_UI_CASE && !name.includes(process.env.PB_UI_CASE))return;
 const context=await browser.newContext({viewport:{width:1280,height:850}}),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{const url=new URL(route.request().url()),file=url.pathname==='/'?'index.html':url.pathname.slice(1);if(url.hostname!=='offline-convenience.test'||!files[file])return route.abort();await route.fulfill({body:files[file],contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html'});});
 await page.addInitScript(({config,interactionPrompt})=>{
  window.__calls=[];window.__pending=[];window.__hold=false;window.__favoriteHold=false;window.__favoriteError='';window.__favoriteDecline='';window.__favoriteResultOnly=false;window.__rejectConfig=false;
  window.__server={running:false,game:{state:'over'},session:{},logs:[],customPlans:[],config:{mode:'auto',build:'generic',...config},connection:{stage:'ready',nativeBoot:{phase:'ready'}},prerequisites:{status:'ready'}};
  const mergeConfig=patch=>{const prior=window.__server.config,convenience=prior.convenience||{};Object.assign(prior,patch);
   if(patch.convenience){prior.convenience={...convenience};for(const[group,value]of Object.entries(patch.convenience)){prior.convenience[group]={...convenience[group],...value};if(group==='alerts'&&value.events)prior.convenience.alerts.events={...convenience.alerts?.events,...value.events};}}};
  window.__push=patch=>{window.__server={...window.__server,...patch};window.__listener?.(structuredClone(window.__server));};
  window.__settle=()=>{const next=window.__pending.shift();if(!next)throw Error('No pending synthetic save');mergeConfig(next.payload);next.resolve({ok:true,state:structuredClone(window.__server)});};
  window.desktop={getState:async()=>structuredClone(window.__server),getCatalog:async()=>({characters:[{id:1,name:'合成角色'}],builds:[{id:'generic',name:'合成通用',generic:true}],maps:[{id:'forest',name:'合成森林',live:true}],modes:[],difficulties:[]}),onState(fn){window.__listener=fn;return()=>{};},onLog(){return()=>{};},command:async(action,payload={})=>{
   window.__calls.push({action,payload:structuredClone(payload)});
   if(action==='generateUpdatePrompt')return {ok:true,text:interactionPrompt};
   if(action==='config'){if(window.__rejectConfig)return {ok:false,message:'合成保存被拒绝，请重试。'};if(window.__hold)return new Promise(resolve=>window.__pending.push({payload:structuredClone(payload),resolve}));mergeConfig(payload);}
   if(action==='favoriteCurrentBuild'){
    if(window.__favoriteHold)await new Promise(resolve=>window.__favoriteResolve=resolve);
    if(window.__favoriteError)return {ok:false,message:window.__favoriteError};
    if(window.__favoriteDecline)return {ok:true,saved:false,reason:window.__favoriteDecline};
    const plan={id:'custom-favorite',name:payload.name||'合成配装收藏',enabled:true,autoSelect:false,species:1,mode:'any',moveRules:[],itemRules:[],vitaminRules:[],capturedBuild:{version:1,currentSpecies:1,moves:[{key:'fu-1',id:50000,level:4,parents:[1,2]},{key:'fu-1',id:50000,level:2,parents:[3,4]}],items:[],vitamins:[]}};
    window.__server.customPlans=[plan];return window.__favoriteResultOnly ? {ok:true,saved:true,id:plan.id,name:plan.name,species:1,count:1,state:structuredClone(window.__server)} : {ok:true,plan,state:structuredClone(window.__server)};
   }
   if(action==='saveCustomPlan'){window.__server.customPlans=[payload.plan];return {ok:true,plan:payload.plan,state:structuredClone(window.__server)};}
   return {ok:true,state:structuredClone(window.__server)};
  }};
 },{config,interactionPrompt:generateMaintenancePrompt('interactions')});
 try{await page.goto('http://offline-convenience.test/');await page.waitForFunction(()=>document.querySelector('#client-stage-label')?.textContent==='就绪');await page.locator('#tab-convenience').click();assert.equal(await page.locator('#convenience-title').textContent(),'运行节奏');await feature(page,'favorite');await run(page);assert.deepEqual(errors,[]);results.push({name,passed:true});}
 catch(error){results.push({name,passed:false,error:error.message,stack:error.stack,errors});}
 finally{await context.close();}
}
const feature=(page,key)=>page.locator(`#convenience-feature-${key}`).click();
const config=page=>page.evaluate(()=>window.__server.config);
const calls=(page,action)=>page.evaluate(action=>window.__calls.filter(row=>row.action===action),action);
const fill=async(page,id,value)=>{await page.locator(id).fill(String(value));await page.locator(id).dispatchEvent('change');};
try {
 await check('tab-after-overlay-rhythm-first-and-read-only-annotation-default-render',async page=>{
  assert.equal(await page.locator('#tab-overlay + #tab-convenience').count(),1);assert.equal(await page.locator('#convenience-nav button').count(),10);
  assert.equal(await page.locator('#convenience-nav button').first().getAttribute('data-convenience-feature'),'rhythm');
  for(const group of Object.keys(CONVENIENCE_DEFAULTS)){await feature(page,group);assert.equal(await page.locator(`#convenience-${group}-enabled`).isChecked(),false);}
  assert.equal((await calls(page,'config')).length,0);assert.equal((await calls(page,'favoriteCurrentBuild')).length,0);
  assert.match(await page.locator('#page-convenience').textContent(),/不采集.*不.*监听|不采集、计算、刷新或监听/);
 });
 await check('each-group-preserves-the-exact-runtime-defaults-and-enables-only-itself',async page=>{
  for(const group of Object.keys(CONVENIENCE_DEFAULTS)){await feature(page,group);await page.locator(`#convenience-${group}-enabled`).check();const state=await config(page);assert.deepEqual(state.convenience[group],{...CONVENIENCE_DEFAULTS[group],enabled:true});assert.deepEqual(Object.keys((await calls(page,'config')).at(-1).payload.convenience),[group]);await page.locator(`#convenience-${group}-enabled`).uncheck();}
  for(const group of Object.keys(CONVENIENCE_DEFAULTS))assert.equal((await config(page)).convenience[group].enabled,false);
 });
 await check('coop-every-restriction-and-wait-are-default-false-and-independent',async page=>{
  await feature(page,'coop');const checks=page.locator('#convenience-fields input[type=checkbox]');assert.equal(await checks.count(),Object.keys(CONVENIENCE_DEFAULTS.coop).length);
  for(const key of Object.keys(CONVENIENCE_DEFAULTS.coop))assert.equal(await page.locator(`#convenience-coop-${key}`).isChecked(),false,key);
  await page.locator('#convenience-coop-doNotMeowth').check();await page.locator('#convenience-coop-waitPortal').check();
  const coop=(await config(page)).convenience.coop;assert.equal(coop.enabled,false);assert.equal(coop.doNotMeowth,true);assert.equal(coop.waitPortal,true);assert.equal(coop.doNotPortal,false);
  assert.match(await page.locator('#convenience-detail-note').textContent(),/仅联机.*单人逻辑/);
 });
 await check('rapid-nested-saves-are-fifo-with-pending-overlay-and-unknown-settings-preserved',async page=>{
  await page.evaluate(()=>window.__hold=true);await feature(page,'fusion');await page.locator('#convenience-fusion-enabled').check();await page.locator('#convenience-fusion-showLevels').uncheck();
  await feature(page,'alerts');await page.locator('#convenience-alerts-rare').uncheck();await feature(page,'quantity');await page.locator('#convenience-quantity-enabled').check();
  assert.equal((await calls(page,'config')).length,1);await page.evaluate(()=>window.__settle());await page.waitForFunction(()=>window.__calls.filter(row=>row.action==='config').length===2);
  await page.evaluate(()=>window.__settle());await page.waitForFunction(()=>window.__calls.filter(row=>row.action==='config').length===3);await page.evaluate(()=>window.__settle());await page.waitForFunction(()=>window.__calls.filter(row=>row.action==='config').length===4);await page.evaluate(()=>window.__settle());
  const value=(await config(page)).convenience;assert.equal(value.fusion.enabled,true);assert.equal(value.fusion.showLevels,false);assert.equal(value.alerts.events.rare,false);assert.equal(value.quantity.enabled,true);assert.equal(value.future.preserved,7);assert.equal(value.alerts.events.futureEvent,true);
 },{convenience:{future:{preserved:7},alerts:{events:{futureEvent:true}}}});
 await check('number-inputs-and-steppers-use-runtime-ranges-without-sliders',async page=>{
  const ranges={fusion:{fontSize:[10,20],rowsPerCard:[1,12],cycleSeconds:[3,20]},quantity:{fontSize:[10,24]},alerts:{volume:[0,100],cooldownSeconds:[3,120],lowHealthPercent:[5,75]},recommendations:{fontSize:[10,24],opacity:[20,100]}};
  for(const [group,fields]of Object.entries(ranges)){await feature(page,group);for(const [key,[lo,hi]]of Object.entries(fields)){const id=`#convenience-${group}-${key}`;await fill(page,id,lo-10);assert.equal((await config(page)).convenience[group][key],lo);await fill(page,id,hi+10);assert.equal((await config(page)).convenience[group][key],hi);}}
  assert.equal(await page.locator('#page-convenience input[type=range]').count(),0);
 });
 await check('empty-number-and-invalid-color-do-not-save-and-valid-color-is-normalized',async page=>{
  await feature(page,'recommendations');const before=(await calls(page,'config')).length;await fill(page,'#convenience-recommendations-fontSize','');assert.equal((await calls(page,'config')).length,before);
  await fill(page,'#convenience-recommendations-color','red');assert.equal((await calls(page,'config')).length,before);assert.equal(await page.locator('#convenience-recommendations-color').getAttribute('aria-invalid'),'true');
  await fill(page,'#convenience-recommendations-color','#AABBCC');assert.equal((await config(page)).convenience.recommendations.color,'#aabbcc');
 });
 await check('sound-preview-is-explicit-once-and-does-not-enable-alert-collection',async page=>{
  await feature(page,'alerts');await page.locator('#convenience-alerts-tone').selectOption('soft');await fill(page,'#convenience-alerts-volume',35);await page.locator('#convenience-test-sound').click();
  assert.deepEqual((await calls(page,'testConvenienceSound'))[0].payload,{tone:'soft',volume:35});assert.equal((await calls(page,'testConvenienceSound')).length,1);assert.equal((await config(page)).convenience.alerts.enabled,false);
 });
 await check('favorite-keeps-current-build-and-is-enabled-but-manual-only-with-separate-duplicate-observation',async page=>{
  await page.locator('#convenience-favorite-name').fill('合成收藏');await page.locator('#convenience-favorite').click();await page.waitForFunction(()=>window.__server.customPlans.length===1);
  const server=await page.evaluate(()=>window.__server);assert.equal(server.config.build,'generic');assert.equal(server.customPlans[0].autoSelect,false);assert.equal(server.customPlans[0].enabled,true);assert.equal(server.customPlans[0].capturedBuild.moves.length,2);assert.equal((await calls(page,'config')).length,0);
  assert.match(await page.locator('#convenience-action-status').textContent(),/合成收藏.*仅手动选择/);
 });
 await check('pending-favorite-rejects-repeated-clicks-and-survives-detail-navigation',async page=>{
  await page.evaluate(()=>window.__favoriteHold=true);await page.locator('#convenience-favorite').click();assert.equal(await page.locator('#convenience-favorite').isDisabled(),true);await feature(page,'fusion');await feature(page,'favorite');assert.equal(await page.locator('#convenience-favorite').isDisabled(),true);
  await page.evaluate(()=>window.__favoriteResolve());await page.waitForFunction(()=>window.__server.customPlans.length===1);assert.equal((await calls(page,'favoriteCurrentBuild')).length,1);
 });
 await check('favorite-native-refusal-is-readable-and-does-not-change-control-or-settings',async page=>{
  await page.evaluate(()=>window.__favoriteError='当前原生对局已切换，请重试收藏。');await page.locator('#convenience-favorite').click();await page.waitForFunction(()=>document.querySelector('#convenience-action-status').textContent.includes('已切换'));
  assert.equal((await calls(page,'config')).length,0);assert.equal((await calls(page,'pause')).length,0);assert.equal((await config(page)).build,'generic');assert.equal(await page.locator('#convenience-favorite').isEnabled(),true);
 });
 await check('actual-host-favorite-result-displays-the-saved-plan-name-without-needing-plan-object',async page=>{
  await page.evaluate(()=>window.__favoriteResultOnly=true);await page.locator('#convenience-favorite-name').fill('主机返回收藏名');await page.locator('#convenience-favorite').click();await page.waitForFunction(()=>document.querySelector('#convenience-action-status').textContent.includes('主机返回收藏名'));
  assert.match(await page.locator('#convenience-action-status').textContent(),/仅手动选择.*未切换/);assert.equal((await config(page)).build,'generic');
 });
 await check('non-saved-native-result-is-a-specific-refusal-and-never-success',async page=>{
  await page.evaluate(()=>window.__favoriteDecline='该原生页面正在切换，尚不能收藏。');await page.locator('#convenience-favorite').click();await page.waitForFunction(()=>document.querySelector('#convenience-action-status').textContent.includes('尚不能收藏'));
  assert.equal(await page.evaluate(()=>window.__server.customPlans.length),0);assert.equal(await page.locator('#convenience-favorite').isEnabled(),true);
 });
 await check('rejected-setting-rolls-back-only-the-changed-convenience-group',async page=>{
  await feature(page,'quantity');await page.locator('#convenience-quantity-showVitamins').check();await page.evaluate(()=>window.__rejectConfig=true);await feature(page,'fusion');await page.locator('#convenience-fusion-enabled').click();await page.waitForFunction(()=>!document.querySelector('#convenience-fusion-enabled').checked);
  assert.equal((await config(page)).convenience.quantity.showVitamins,true);assert.equal((await config(page)).convenience.fusion?.enabled ?? false,false);
 });
 await check('manual-only-plan-label-and-editor-save-preserve-observed-loadout-and-auto-select-control',async page=>{
  await page.locator('#convenience-favorite').click();await page.waitForFunction(()=>window.__server.customPlans.length===1);await page.locator('#tab-plans').click();await page.locator('.plan-library-card').first().click();
  assert.equal(await page.locator('#plan-auto-select').isChecked(),false);assert.match(await page.locator('.plan-library-card').first().textContent(),/仅手动选择/);
  await page.locator('#plan-name').fill('编辑收藏');await page.locator('#plan-save').click();await page.waitForFunction(()=>window.__calls.some(row=>row.action==='saveCustomPlan'));
  const plan=(await calls(page,'saveCustomPlan')).at(-1).payload.plan;assert.equal(plan.autoSelect,false);assert.equal(plan.capturedBuild.moves.length,2);assert.equal((await config(page)).build,'generic');
 });
 await check('six-feature-detail-layout-remains-usable-at-narrow-widths',async page=>{
  for(const width of [1280,760,520,320]){await page.setViewportSize({width,height:850});for(const group of ['favorite','coop','recommendations']){await feature(page,group);assert.equal(await page.locator('#convenience-title').isVisible(),true);const overflow=await page.locator('#page-convenience').evaluate(node=>node.scrollWidth>node.clientWidth+2);assert.equal(overflow,false,`${width}/${group}`);}}
  await page.setViewportSize({width:1280,height:850});await feature(page,'fusion');await page.screenshot({path:path.join(path.dirname(out),'fusion-settings.png')});await feature(page,'coop');await page.screenshot({path:path.join(path.dirname(out),'coop-settings.png')});
 });
 await check('160-settings-contain-global-controls-and-link-to-convenience',async page=>{
  await page.locator('#tab-settings').click();
  assert.deepEqual(await page.locator('#automation-settings input').evaluateAll(rows=>rows.map(row=>row.id)),['setting-autoRestart']);
  assert.match(await page.locator('#page-settings').innerText(),/开关即时保存，更多策略修改在便利功能中设置。/);
  assert.ok(await page.locator('#display-mode').isVisible());assert.ok(await page.locator('#hotkey-list').isVisible());
  for(const group of ['movement','outside','strategy'])assert.equal(await page.locator('#convenience-feature-'+group).count(),1);
 });
 await check('160-movement-defaults-off-and-threshold-steps-use-one-flat-setting',async page=>{
  await feature(page,'movement');
  for(const key of ['jumpMove','slideMove','flightMove','flightNoInteractions'])assert.equal(await page.locator('#setting-'+key).isChecked(),false,key);
  assert.equal(await page.locator('#setting-flightJumpItemCount').inputValue(),'5');
  await page.getByRole('button',{name:'增加跳跃道具数量',exact:true}).click();await page.waitForFunction(()=>window.__server.config.flightJumpItemCount===6);
  await page.getByRole('button',{name:'减少跳跃道具数量',exact:true}).click();await page.waitForFunction(()=>window.__server.config.flightJumpItemCount===5);
  await page.locator('#setting-flightJumpItemCount').fill('0');await page.locator('#setting-flightJumpItemCount').dispatchEvent('change');
  assert.equal(await page.locator('#setting-flightJumpItemCount').getAttribute('aria-invalid'),'true');assert.equal((await config(page)).flightJumpItemCount,5);
  await page.locator('#setting-flightJumpItemCount').fill('7');await page.locator('#setting-flightJumpItemCount').dispatchEvent('change');await page.waitForFunction(()=>window.__server.config.flightJumpItemCount===7);
  await page.locator('#setting-flightMove').check();await page.locator('#setting-flightNoInteractions').check();
  await page.waitForFunction(()=>window.__server.config.flightNoInteractions===true);
  const saved=await config(page);assert.equal(saved.flightMove,true);assert.equal(saved.convenience?.movement,undefined);
  assert.match(await page.locator('#convenience-fields').innerText(),/气球.*原生跳跃.*不保证无限滞空或无伤/);
 });
 await check('160-legacy-explicit-movement-and-pickup-values-survive-view-migration',async page=>{
  await feature(page,'movement');assert.equal(await page.locator('#setting-jumpMove').isChecked(),true);assert.equal(await page.locator('#setting-slideMove').isChecked(),true);assert.equal(await page.locator('#setting-flightMove').isChecked(),false);
  await feature(page,'strategy');assert.equal(await page.locator('#setting-pickupBonkoin').isChecked(),false);
  await feature(page,'outside');assert.equal(await page.locator('#setting-autoUpgrade').isChecked(),false);
  assert.equal((await calls(page,'config')).length,0,'viewing the new groups cannot overwrite saved preferences');
 },{jumpMove:true,slideMove:true,pickupBonkoin:false,autoUpgrade:false});
 await check('tomb-floor-ui',async page=>{
  await page.locator('#tab-modes').click();if(await page.locator('#limited-events-region').isHidden())await page.locator('#limited-events-toggle').click();await page.locator('[data-mode="tower"]').click();
  const picker=page.locator('#tower-tomb-experience-floor');assert.equal(await picker.inputValue(),'0');
  await picker.selectOption('30');await page.waitForFunction(()=>window.__server.config.modeSettings?.tower?.tombExperienceFloor===30);
  await page.locator('[data-mode="resources"]').click();if(await page.locator('#limited-events-region').isHidden())await page.locator('#limited-events-toggle').click();await page.locator('[data-mode="tower"]').click();
  assert.equal(await picker.inputValue(),'30');await picker.scrollIntoViewIfNeeded();
  await page.locator('#tower-options').screenshot({path:path.join(path.dirname(out),'tower.png')});
 });
 await check('outside-defaults-opt-in',async page=>{
  await feature(page,'outside');for(const key of ['autoUpgrade','autoUnlockItems','autoClaim','reserveMoveSlot'])assert.equal(await page.locator('#setting-'+key).isChecked(),false,key);
  await page.locator('#setting-autoClaim').check();await page.waitForFunction(()=>window.__server.config.autoClaim===true);
  await feature(page,'strategy');assert.equal(await page.locator('#setting-expandVitaminSlots').isChecked(),true);
  await feature(page,'outside');assert.equal(await page.locator('#setting-autoClaim').isChecked(),true);
  assert.equal(await page.locator('#setting-autoUnlockItems').isChecked(),false);
 });
 await check('160-update-access-is-left-of-optimization-and-does-not-require-login',async page=>{
  assert.equal(await page.locator('#get-client-updates + #optimize-browser').count(),1);
  await page.locator('#get-client-updates').click();assert.equal((await calls(page,'showClientUpdates')).length,1);
  assert.equal((await calls(page,'start')).length,0);assert.equal((await calls(page,'config')).length,0);
 });
 await check('160-interaction-maintenance-button-follows-encyclopedia-and-uses-complete-prompt',async page=>{
  await page.locator('#tab-maintenance').click();
  assert.equal(await page.locator('[data-maintenance-kind="encyclopedia"] + [data-maintenance-kind="interactions"]').count(),1);
  await page.locator('[data-maintenance-kind="interactions"]').click();await page.waitForFunction(()=>document.querySelector('#update-prompt').value.includes('本次任务：更新交互点'));
  const prompt=await page.locator('#update-prompt').inputValue();assert.ok(prompt.includes('真实地形/高度/碰撞'));assert.ok(prompt.includes('保存'));assert.ok(prompt.includes('MAINTENANCE')||prompt.includes('维护与验收操作指南'));
  assert.equal((await calls(page,'generateUpdatePrompt')).at(-1).payload.kind,'interactions');
 });
 await check('160-movement-controls-and-added-footer-fit-narrow-viewports',async page=>{
  for(const width of [1280,760,520,320]){
   await page.setViewportSize({width,height:850});await page.locator('#tab-convenience').click();await feature(page,'movement');
   assert.equal(await page.locator('#page-convenience').evaluate(node=>node.scrollWidth>node.clientWidth+2),false,String(width));
   const bounds=await page.locator('.control-actions').boundingBox();assert.ok(bounds.x>=-1&&bounds.x+bounds.width<=width+1,`${width}/footer`);
  }
  await page.setViewportSize({width:1280,height:850});await page.screenshot({path:path.join(path.dirname(out),'movement-settings-160.png')});
 });
} finally {await browser.close();}
const report={schemaVersion:1,isolatedSyntheticOnly:true,noCurrentClientAccountOrExternalNetwork:true,files:Object.fromEntries(Object.entries(files).map(([file,text])=>[file,createHash('sha256').update(text).digest('hex')])),results,passed:results.filter(row=>row.passed).length,total:results.length};
await fs.writeFile(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({out,passed:report.passed,total:report.total,failures:results.filter(row=>!row.passed)},null,2));if(report.passed!==report.total)process.exitCode=1;
