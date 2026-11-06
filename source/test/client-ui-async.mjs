// Controlled, local-only RPC races. All identities, preferences and images
// below are synthetic; no real client, account, vault or game is accessed.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';

const root=process.cwd(), out=path.resolve(process.argv[2]||'artifacts/0.19.0-ui-review/async-final.json');
const source=await fs.readFile(path.resolve(process.argv[3]||'client/ui/app.js'),'utf8');
const browser=await chromium.launch({headless:true}), results=[];
const catalog={characters:[{id:1,name:'合成角色一',unlocked:true,learnableMoves:[{key:'move-a',name:'招式甲'}],learnableFusions:[{key:'fusion-a',name:'融合甲'}]},{id:25,name:'合成角色二',unlocked:true,learnableMoves:[{key:'move-b',name:'招式乙'}],learnableFusions:[]}],builds:[],maps:[{id:'forest',name:'合成森林',live:true},{id:'desert',name:'合成沙漠',live:true}],difficulties:[{id:0,name:'普通'}],moves:[{key:'move-a',name:'招式甲'},{key:'move-b',name:'招式乙'}],vitamins:[{key:'vit-a',name:'维生素甲'},{key:'vit-b',name:'维生素乙'}]};
const initialize=({catalog})=>{
  window.__calls=[];window.__pendingConfig=[];window.__pendingPlans=[];window.__holdConfig=true;window.__holdPlan=true;
  const merge=(a,b)=>{const next={...a,...b};for(const key of ['unlockTargets','eventTargets'])next[key]={...a[key],...b[key]};next.modeSettings={...a.modeSettings};for(const [mode,value]of Object.entries(b.modeSettings||{}))next.modeSettings[mode]={...a.modeSettings?.[mode],...value};next.finalReplacements={...a.finalReplacements};for(const[id,entry]of Object.entries(b.finalReplacements||{})){next.finalReplacements[id]={...a.finalReplacements?.[id]};for(const[kind,section]of Object.entries(entry||{}))if(section&&typeof section==='object')next.finalReplacements[id][kind]={...a.finalReplacements?.[id]?.[kind],...section};}return next;};
  window.__server={running:false,paused:false,profile:{name:'合成账号',league:[1,25],biomes:{forest:0,desert:0}},game:{state:'over',accountType:'guest'},config:{mode:'characters',characterId:1,build:'auto',pickup:true,autoRestart:true,autoClaim:true,modeSettings:{characters:{biome:'forest',tier:0}},finalReplacements:{'1':{moves:{enabled:true,level:30,targets:['move-a',null,null,null]},vitamins:{enabled:true,level:30,targets:['vit-a',null,null,null,null,null]},strictMoves:{enabled:true,targets:['fusion-a',null,null,null]}},'25':{strictMoves:{enabled:true,targets:['move-b',null,null,null]}}}},customPlans:[],session:{},logs:[],connection:{stage:'ready',nativeBoot:{phase:'ready'}},prerequisites:{status:'ready'},recovery:{wantedRun:false,phase:'idle',intentGeneration:7}};
  window.__push=patch=>window.__listener?.(structuredClone({...window.__server,...patch}));
  window.__settleConfig=(fail=false)=>{const pending=window.__pendingConfig.shift();if(!pending)throw Error('no pending config');if(fail){pending.reject(Error('合成保存失败'));return;}window.__server.config=merge(window.__server.config,pending.patch);pending.resolve({ok:true,state:structuredClone(window.__server)});};
  window.__settlePlan=()=>{const pending=window.__pendingPlans.shift();if(!pending)throw Error('no pending plan');const saved={...pending.plan,id:pending.plan.id||'custom-synthetic-1'};window.__server.customPlans=[saved];pending.resolve({ok:true,plan:saved,customPlans:[saved],state:structuredClone(window.__server)});};
  const atlas=document.createElement('canvas');atlas.width=atlas.height=256;const ctx=atlas.getContext('2d');ctx.fillStyle='#3c8d62';for(let y=0;y<4;y++)for(let x=0;x<4;x++)ctx.fillRect(x*64+16,y*64+8,32,48);
  window.__atlas=atlas.toDataURL();window.__skinState={skins:[{id:'skin-a',name:'合成皮肤甲',thumbnailDataUrl:window.__atlas},{id:'skin-b',name:'合成皮肤乙',thumbnailDataUrl:window.__atlas}],selectedId:null};
  window.desktop={getState:async()=>structuredClone(window.__server),getCatalog:async()=>structuredClone(catalog),onState(fn){window.__listener=fn;return()=>{};},onLog(){return()=>{};},command:async(action,payload={})=>{
    window.__calls.push({action,payload:structuredClone(payload)});
    if(action==='config'){const patch=payload.config||payload;if(window.__holdConfig)return new Promise((resolve,reject)=>window.__pendingConfig.push({patch,resolve,reject}));window.__server.config=merge(window.__server.config,patch);}
    if(action==='saveCustomPlan'&&window.__holdPlan)return new Promise(resolve=>window.__pendingPlans.push({plan:structuredClone(payload.plan),resolve}));
    if(action==='start'||action==='resume'){if(window.__cancelAtStart)window.__server.recovery.intentGeneration++;if(payload.expectedIntentGeneration!==undefined&&payload.expectedIntentGeneration!==window.__server.recovery.intentGeneration)return{ok:false,error:'挂机启动已取消'};window.__server.running=true;window.__server.game={state:'play',accountType:'guest'};}
    if(action==='pause'){window.__server.running=false;window.__server.paused=false;window.__server.recovery={...window.__server.recovery,wantedRun:false,phase:'idle',intentGeneration:window.__server.recovery.intentGeneration+1};}
    if(action==='getSkins')return structuredClone(window.__skinState);
    if(action==='getSkinPreview')return{id:payload.id,atlasDataUrl:window.__atlas,warnings:[]};
    if(action==='deleteSkin')return new Promise(resolve=>{window.__finishSkinDelete=()=>{window.__skinState.skins=window.__skinState.skins.filter(skin=>skin.id!==payload.id);resolve(structuredClone(window.__skinState));};});
    if(action==='readRecoveryLogin')return new Promise(resolve=>{window.__finishVaultRead=()=>resolve({name:'synthetic-vault-only',password:'dummy'});});
    if(action==='clearRecoveryLogin')window.__server.recoveryLogin={saved:false,complete:false};
    return{ok:true,state:structuredClone(window.__server)};
  }};
};
async function check(name,run){
  const context=await browser.newContext({viewport:{width:1280,height:850}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.hostname!=='offline-ui.test'){await route.abort();return;}const file=url.pathname==='/'?'index.html':url.pathname.slice(1);if(!['index.html','styles.css','app.js'].includes(file)){await route.abort();return;}await route.fulfill({contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html',body:file==='app.js'?source:await fs.readFile(path.join(root,'client/ui',file))});});
  await page.addInitScript(initialize,{catalog});
  try{await page.goto('http://offline-ui.test/');await page.waitForFunction(()=>document.querySelector('#client-stage-label')?.textContent==='就绪');await run(page);assert.deepEqual(errors,[]);results.push({name,passed:true});}
  catch(error){results.push({name,passed:false,error:error.message,errors});}
  finally{await context.close();}
}
const behaviorGroup=key=>['autoClaim','autoUpgrade','reserveMoveSlot'].includes(key)?'outside':'strategy';
const openBehavior=async(page,group)=>{await page.locator('#tab-convenience').click();await page.locator('#convenience-feature-'+group).click();};
const toggleBehavior=async(page,key,checked)=>{if(key==='autoRestart')await page.locator('#tab-settings').click();else await openBehavior(page,behaviorGroup(key));await page.locator('#setting-'+key).setChecked(checked);};
const behaviorChecked=async(page,key)=>{await openBehavior(page,behaviorGroup(key));return page.locator('#setting-'+key).isChecked();};
const settle=async(page,fail=false)=>{await page.waitForFunction(()=>window.__pendingConfig.length>0);await page.evaluate(fail=>window.__settleConfig(fail),fail);await page.waitForTimeout(20);};
try{
 await check('acknowledging-an-earlier-patch-keeps-later-false-edit-visible',async page=>{
  await page.locator('#tab-settings').click();await toggleBehavior(page,'pickup',false);await toggleBehavior(page,'autoRestart',false);
  await settle(page);assert.equal(await page.locator('#setting-autoRestart').isChecked(),false);
  await settle(page);assert.equal(await page.evaluate(()=>window.__server.config.pickup),false);assert.equal(await page.evaluate(()=>window.__server.config.autoRestart),false);
 });
 await check('failed-earlier-save-rolls-back-only-its-own-patch',async page=>{
  await page.locator('#tab-settings').click();await toggleBehavior(page,'pickup',false);await toggleBehavior(page,'autoClaim',false);
  await settle(page,true);assert.equal(await behaviorChecked(page,'pickup'),true);assert.equal(await behaviorChecked(page,'autoClaim'),false);
  await settle(page);assert.equal(await behaviorChecked(page,'autoClaim'),false);
 });
 await check('native-status-push-cannot-revert-pending-null-character-choice',async page=>{
  await page.locator('#tab-characters').click();await page.locator('.automatic-card').click();await page.evaluate(()=>window.__push({}));
  assert.equal(await page.locator('.automatic-card').getAttribute('aria-pressed'),'true');await settle(page);assert.equal(await page.evaluate(()=>window.__server.config.characterId),null);
 });
 await check('nested-final-replacements-preserve-disabled-null-and-other-character-sections',async page=>{
  await page.locator('#tab-characters').click();await page.locator('#final-strictMoves-enabled').uncheck();
  await page.locator('#final-vitamins-0').locator('..').locator('button.replacement-dropdown').click();await page.locator('#final-vitamins-0-options .replacement-option').first().click();
  await settle(page);assert.equal(await page.locator('#final-vitamins-0').getAttribute('data-target-key'),'');assert.equal(await page.locator('#final-strictMoves-enabled').isChecked(),false);
  await settle(page);const stored=await page.evaluate(()=>window.__server.config.finalReplacements);assert.equal(stored['1'].strictMoves.enabled,false);assert.equal(stored['1'].vitamins.targets[0],null);assert.equal(stored['25'].strictMoves.targets[0],'move-b');assert.equal(stored['1'].moves.targets[0],'move-a');
 });
 await check('mode-switch-pending-ack-does-not-restore-prior-mode',async page=>{
  await page.locator('#tab-modes').click();await page.locator('[data-mode="resources"]').click();await page.locator('[data-mode="research"]').click();await settle(page);
  assert.match(await page.locator('#mode-configuration-title').textContent(),/家族研究/);await settle(page);assert.equal(await page.evaluate(()=>window.__server.config.mode),'research');
 });
 await check('start-waits-for-visible-config-but-pause-is-not-held-by-save',async page=>{
  await page.locator('#tab-settings').click();await toggleBehavior(page,'pickup',false);await page.locator('#main-action').click();await page.waitForTimeout(20);
  assert.equal(await page.evaluate(()=>window.__calls.filter(call=>call.action==='start').length),0);await settle(page);await page.waitForFunction(()=>window.__calls.some(call=>call.action==='start'));
  await toggleBehavior(page,'autoClaim',false);await page.locator('#main-action').click();await page.waitForFunction(()=>window.__calls.some(call=>call.action==='pause'));await settle(page);
 });
 await check('config-failure-during-start-barrier-keeps-client-idle-and-button-usable',async page=>{
  await page.locator('#tab-settings').click();await toggleBehavior(page,'pickup',false);await page.locator('#main-action').click();await settle(page,true);
  assert.equal(await page.evaluate(()=>window.__calls.filter(call=>call.action==='start').length),0);assert.equal(await page.locator('#main-action').isEnabled(),true);assert.match(await page.locator('#toast').textContent(),/保存|设置/);
 });
 await check('editing-plan-during-save-keeps-newer-draft-and-reuses-created-id',async page=>{
  await page.locator('#tab-plans').click();await page.locator('#plan-name').fill('第一稿');await page.locator('#plan-save').click();await page.waitForFunction(()=>window.__pendingPlans.length===1);await page.locator('#plan-name').fill('新修改');
  await page.evaluate(()=>window.__settlePlan());await page.waitForFunction(()=>!document.querySelector('#plan-save').disabled);
  assert.equal(await page.locator('#plan-name').inputValue(),'新修改');assert.match(await page.locator('#plan-save-status').textContent(),/未保存|有修改/);
  await page.locator('#plan-save').click();await page.waitForFunction(()=>window.__pendingPlans.length===1);assert.equal(await page.evaluate(()=>window.__pendingPlans[0].plan.id),'custom-synthetic-1');
 });
 await check('manual-stop-during-config-barrier-cancels-older-start-click',async page=>{
  await page.locator('#tab-settings').click();await toggleBehavior(page,'pickup',false);await page.locator('#main-action').click();
  await page.evaluate(()=>{window.__server.recovery.intentGeneration++;window.__push({});});await settle(page);
  assert.equal(await page.evaluate(()=>window.__calls.filter(call=>call.action==='start').length),0);assert.equal(await page.evaluate(()=>window.__server.running),false);assert.equal(await page.locator('#main-action').isEnabled(),true);
 });
 await check('host-intent-fence-rejects-cancellation-before-new-start-arrives',async page=>{
  await page.evaluate(()=>{window.__cancelAtStart=true;});await page.locator('#main-action').click();await page.waitForFunction(()=>window.__calls.some(call=>call.action==='start'));
  assert.equal(await page.evaluate(()=>window.__calls.find(call=>call.action==='start').payload.expectedIntentGeneration),7);assert.equal(await page.evaluate(()=>window.__server.running),false);
 });
 await check('another-start-during-config-barrier-is-never-converted-to-pause',async page=>{
  await page.locator('#tab-settings').click();await toggleBehavior(page,'pickup',false);await page.locator('#main-action').click();
  await page.evaluate(()=>{window.__server.running=true;window.__server.game.state='play';window.__push({});});await settle(page);
  assert.equal(await page.evaluate(()=>window.__calls.filter(call=>call.action==='pause').length),0);assert.equal(await page.evaluate(()=>window.__server.running),true);
 });
 await check('hotkey-save-preserves-newer-capture-draft',async page=>{
  await page.locator('#tab-settings').click();await page.locator('#hotkey-hotkeyToggle').focus();await page.keyboard.press('F7');await page.locator('#save-hotkeys').click();
  await page.locator('#hotkey-hotkeyToggle').focus();await page.keyboard.press('F6');await settle(page);
  assert.equal(await page.locator('#hotkey-hotkeyToggle').inputValue(),'F6');assert.equal(await page.locator('#save-hotkeys').isEnabled(),true);assert.equal(await page.evaluate(()=>window.__server.config.hotkeyToggle),'F7');
 });
 await check('hidden-skin-mutation-defers-atlas-read-until-page-reentry',async page=>{
  await page.locator('#tab-skins').click();await page.waitForFunction(()=>!document.querySelector('#skin-preview-canvas').hidden);
  await page.locator('#skin-delete').click();await page.locator('#skin-delete-confirm').click();await page.waitForFunction(()=>typeof window.__finishSkinDelete==='function');await page.locator('#tab-overview').click();
  const reads=await page.evaluate(()=>window.__calls.filter(call=>call.action==='getSkinPreview').length);await page.evaluate(()=>window.__finishSkinDelete());await page.waitForFunction(()=>document.querySelector('#page-skins').getAttribute('aria-busy')==='false');
  assert.equal(await page.evaluate(()=>window.__calls.filter(call=>call.action==='getSkinPreview').length),reads);
  await page.locator('#tab-skins').click();await page.waitForFunction(()=>!document.querySelector('#skin-preview-canvas').hidden);assert.equal(await page.locator('#skin-name').inputValue(),'合成皮肤乙');
 });
 await check('late-synthetic-vault-read-after-page-exit-never-reveals-values',async page=>{
  await page.evaluate(()=>{window.__server.recoveryLogin={saved:true,complete:true};window.__push({});});await page.locator('#tab-account').click();await page.locator('#toggle-recovery-login-visibility').click();await page.waitForFunction(()=>typeof window.__finishVaultRead==='function');
  await page.locator('#tab-overview').click();await page.evaluate(()=>window.__finishVaultRead());await page.waitForTimeout(20);await page.locator('#tab-account').click();
  assert.equal(await page.locator('#recovery-login-name').inputValue(),'');assert.equal(await page.locator('#recovery-login-password').inputValue(),'');assert.equal(await page.locator('#recovery-login-password').getAttribute('type'),'password');
 });
 await check('clearing-synthetic-vault-during-read-invalidates-late-values',async page=>{
  await page.evaluate(()=>{window.__server.recoveryLogin={saved:true,complete:true};window.__push({});});await page.locator('#tab-account').click();await page.locator('#toggle-recovery-login-visibility').click();await page.waitForFunction(()=>typeof window.__finishVaultRead==='function');
  await page.locator('#clear-recovery-login').click();await page.evaluate(()=>window.__finishVaultRead());await page.waitForTimeout(20);
  assert.equal(await page.locator('#recovery-login-name').inputValue(),'');assert.equal(await page.locator('#recovery-login-password').inputValue(),'');assert.equal(await page.locator('#recovery-login-password').getAttribute('type'),'password');
 });
 await check('recovery-cancel-remains-clickable-during-config-save-barrier',async page=>{
  await page.locator('#tab-settings').click();await toggleBehavior(page,'pickup',false);await page.locator('#main-action').click();await page.evaluate(()=>{window.__server.recovery.wantedRun=true;window.__server.recovery.phase='waiting';window.__push({});});
  await page.locator('#main-action').click();await page.waitForFunction(()=>window.__calls.some(call=>call.action==='pause'));await settle(page);
  assert.equal(await page.evaluate(()=>window.__calls.filter(call=>call.action==='start').length),0);assert.equal(await page.evaluate(()=>window.__server.recovery.wantedRun),false);assert.equal(await page.locator('#main-action').isEnabled(),true);
 });
 await check('latest-save-failure-keeps-earlier-success-and-reverts-only-latest-field',async page=>{
  await page.locator('#tab-settings').click();await toggleBehavior(page,'pickup',false);await toggleBehavior(page,'autoClaim',false);await settle(page);await settle(page,true);
  assert.equal(await behaviorChecked(page,'pickup'),false);assert.equal(await behaviorChecked(page,'autoClaim'),true);assert.equal(await page.evaluate(()=>window.__server.config.pickup),false);
 });
 await check('cross-character-edit-queue-keeps-each-character-scope',async page=>{
  await page.locator('#tab-characters').click();await page.locator('#final-strictMoves-enabled').uncheck();await page.locator('.character-card').filter({hasText:'合成角色二'}).click();
  assert.equal(await page.locator('#build-character').textContent(),'合成角色二');await settle(page);assert.equal(await page.locator('#build-character').textContent(),'合成角色二');
  await page.locator('#final-strictMoves-enabled').uncheck();await settle(page);await settle(page);
  const saved=await page.evaluate(()=>window.__server.config.finalReplacements);assert.equal(saved['1'].strictMoves.enabled,false);assert.equal(saved['25'].strictMoves.enabled,false);assert.equal(saved['25'].strictMoves.targets[0],'move-b');assert.equal(saved['1'].vitamins.targets[0],'vit-a');
 });
 await check('partial-native-config-keeps-sibling-final-replacement-fields',async page=>{
  await page.evaluate(()=>window.__PB_UI.receiveState({config:{finalReplacements:{'1':{strictMoves:{enabled:false}}}}}));await page.locator('#tab-characters').click();
  assert.equal(await page.locator('#final-strictMoves-enabled').isChecked(),false);assert.equal(await page.locator('#final-strictMoves-0').getAttribute('data-target-key'),'fusion-a');assert.equal(await page.locator('#final-moves-enabled').isChecked(),true);assert.equal(await page.locator('#final-vitamins-0').getAttribute('data-target-key'),'vit-a');
 });
 await check('25-rapid-writes-stay-ordered-and-continue-after-middle-failure',async page=>{
  await openBehavior(page,'strategy');await page.evaluate(()=>{const input=document.querySelector('#setting-pickup');for(let i=0;i<25;i++){input.checked=i%2===1;input.dispatchEvent(new Event('change',{bubbles:true}));}});
  for(let i=0;i<25;i++){assert.equal(await page.evaluate(()=>window.__pendingConfig.length),1);await settle(page,i===12);}
  assert.equal(await page.evaluate(()=>window.__server.config.pickup),false);assert.equal(await behaviorChecked(page,'pickup'),false);assert.equal(await behaviorChecked(page,'autoClaim'),true);
 });
 await check('reset-hotkeys-during-pending-save-preserves-newer-capture',async page=>{
  await page.locator('#tab-settings').click();await page.locator('#hotkey-hotkeyToggle').focus();await page.keyboard.press('F7');await page.locator('#save-hotkeys').click();await page.locator('#reset-hotkeys').click();
  await page.locator('#hotkey-hotkeyToggle').focus();await page.keyboard.press('F6');await settle(page);await settle(page);
  assert.equal(await page.locator('#hotkey-hotkeyToggle').inputValue(),'F6');assert.equal(await page.locator('#save-hotkeys').isEnabled(),true);assert.equal(await page.evaluate(()=>window.__server.config.hotkeyToggle),'F8');
 });
}finally{await browser.close();await fs.mkdir(path.dirname(out),{recursive:true});await fs.writeFile(out,JSON.stringify({passed:results.every(result=>result.passed),isolatedMockOnly:true,noGameAccountOrProfileAccess:true,sourceSha256:createHash('sha256').update(source).digest('hex'),results},null,2));}
console.log(JSON.stringify({out,results},null,2));if(results.some(result=>!result.passed))process.exitCode=1;
