// Native production-path integration. Does not log in, create a guest, or start a match.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';
const root=path.resolve(process.argv[2]||'dist/0.11.0');
const backgroundSafe=process.argv.includes('--background-safe');
const info=JSON.parse(await readFile(path.join(root,'build-info.json'),'utf8'));
const output=path.resolve('artifacts/client-maintenance',new Date().toISOString().replace(/[:.]/g,'-'));await mkdir(output,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');
assert.equal(sha(await readFile(path.join(root,'PokeBonk Pilot.exe'))),info.sha256);
if(await stat(path.join(root,'data','status.json')).catch(()=>false)){
 const previous=JSON.parse(await readFile(path.join(root,'data','status.json'),'utf8'));
 assert.ok(!previous.game?.accountType&&!previous.game?.state&&!previous.profile,'never reuse a player profile or active match');
}
let occupied=false;try{occupied=(await fetch('http://127.0.0.1:9223/json/version')).ok;}catch{}assert.ok(!occupied,'preexisting debug port must not be used');
let malformedFixture=null;
if(process.argv.includes('--invalid-plans')){
 const existing=await readFile(path.join(root,'data','custom-plans.json'),'utf8').then(JSON.parse).catch(()=>null);
 assert.ok(!existing||Array.isArray(existing.plans)&&existing.plans.length===0,'never replace a real custom-plan collection');
 await mkdir(path.join(root,'data'),{recursive:true});malformedFixture='{"plans":{"malformed":true}}';
 await writeFile(path.join(root,'data','custom-plans.json'),malformedFixture);
}
let child=spawn(path.join(root,'PokeBonk Pilot.exe'),['--diagnostics','--diagnostics-no-activate'],{cwd:root,windowsHide:true,stdio:'ignore'});
const summary={version:info.version,exeSha256:info.sha256,controllerRevision:info.controllerRevision,passed:false,noAccountCreated:true,noMatchStarted:true,countsAsCampaignVictory:false,errors:[]};
let browser,panel,game,nextAttachAt=0,syntheticVaultTouched=false;
const observedPages=new WeakSet();
async function wait(check,message,seconds=45){const end=Date.now()+seconds*1000;while(Date.now()<end){try{if(await check())return;}catch{}await delay(200);}throw Error(message);}
const state=()=>panel.evaluate(()=>desktop.getState());
const cmd=(action,payload={})=>panel.evaluate(({action,payload})=>desktop.command(action,payload),{action,payload});
async function closeClient(message){
 try{await cmd('testClose');}catch(error){if(!/closed|Target page|browser has been closed/i.test(error.message))throw error;}
 await wait(()=>child.exitCode!==null,message,20);assert.equal(child.exitCode,0,'normal close must exit successfully');
}
async function discoverSurfaces(){
 if(!browser?.isConnected()){
  if(Date.now()<nextAttachAt)return false;nextAttachAt=Date.now()+1000;
  browser=await chromium.connectOverCDP('http://127.0.0.1:9223',{timeout:5000});
 }
 const pages=browser.contexts().flatMap(c=>c.pages()).filter(p=>!p.isClosed()).reverse();
 const candidatePanel=pages.find(p=>p.url().startsWith('https://pilot.local/'));
 const candidateGame=pages.find(p=>p.url().startsWith('https://pokebonk.com/'));
 if(!candidatePanel||!candidateGame){browser=null;return false;}
 const host=await candidatePanel.evaluate(()=>desktop.getState());
 assert.equal(host.storage.root,root,'only this owned client may be controlled');assert.equal(host.version,info.version);
 panel=candidatePanel;game=candidateGame;
 for(const p of [panel,game])if(!observedPages.has(p)){observedPages.add(p);p.on('pageerror',e=>summary.errors.push(e.message));}
 try{await game.evaluate(()=>0);}catch(error){
  if(/crash|Target.*closed|Execution context|Cannot find context/i.test(error.message))browser=null;
  else throw error;
 }
 return true;
}
async function attachSurfaces(){
 await wait(discoverSurfaces,'native endpoint or owned surfaces missing');
 await wait(async()=>{const s=await state();return s.compatibilityReport?.state==='ready'&&s.catalogRevision>2&&s.updateStatus.state!=='checking';},'runtime catalog or update check not ready after bounded native boot grace',150);
 await wait(async()=>{const s=await state(),c=s.connection;return c?.strategy==='browser-response-v1'&&c.javascriptFeatures?.ok===true&&
  c.nativeBoot?.phase==='ready'&&c.nativeBoot?.stage==='complete'&&c.events?.some(e=>e.code==='game-module-transformed')&&
  c.sourceHash===s.compatibilityReport.sourceHash;},'browser response adaptation and native boot proof missing',30);
 const connection=(await state()).connection;
 assert.ok(Number.parseInt(connection.runtimeVersion,10)>=98);
 assert.equal(await game.evaluate(hash=>__PB_BRIDGE.compatibility.sourceHash===hash,connection.sourceHash),true);
 for(const event of connection.events||[])if(event.resource){const uri=new URL(event.resource);assert.equal(uri.origin,'https://pokebonk.com');assert.ok(!uri.search&&!uri.hash&&!uri.username&&!uri.password);}
 summary.connection={strategy:connection.strategy,runtimeVersion:connection.runtimeVersion,sourceHash:connection.sourceHash,
  javascriptFeatureProbePassed:true,nativeBootReady:true,transformedResponseObserved:true,publicResourceDiagnosticsOnly:true};
}
async function exerciseLocalAccountPage(){
 const initial=await state();
 assert.equal(initial.profile,null);assert.equal(initial.recovery.wantedRun,false);
 assert.equal(initial.recoveryLogin.saved,false,'never replace an existing local login record');
 assert.equal(await game.evaluate(()=>!__PB_BRIDGE.app.meta?.account&&!__PB_BRIDGE.app.run),true);
 const tabs=await panel.locator('.tabs .tab').evaluateAll(nodes=>nodes.map(node=>node.id));
 assert.equal(tabs.length,9);assert.equal(tabs.at(-2),'tab-maintenance');assert.equal(tabs.at(-1),'tab-account');
 await panel.locator('#tab-account').click();
 for(const id of ['recovery-login-name','recovery-login-password']){
  assert.equal(await panel.locator('#'+id).getAttribute('type'),'password');
  assert.ok((await panel.locator('#'+id).inputValue())==='','account inputs start empty');
 }
 assert.equal(await panel.locator('#toggle-recovery-login-visibility').getAttribute('aria-pressed'),'false');
 // These fixed placeholders are never submitted to the game. This fixture
 // owns only a previously empty local vault and never arms run/guest intent.
 const syntheticName=['local','only','qa'].join('-'),syntheticSecret=['not','a','real','login','42'].join('-');
 syntheticVaultTouched=true;
 await panel.locator('#recovery-login-name').fill(syntheticName);
 await wait(async()=>{const info=(await state()).recoveryLogin;return info.saved&&info.hasDraft&&!info.complete;},
  'partial local draft was not encrypted automatically');
 assert.equal((await state()).recovery.wantedRun,false);
 await panel.locator('#recovery-login-password').fill(syntheticSecret);
 await wait(async()=>{const info=(await state()).recoveryLogin;return info.saved&&info.complete&&info.bound===false&&!!info.updatedAt;},
  'complete pre-login record was not saved automatically');
 await wait(async()=>await panel.locator('#save-recovery-login').isEnabled()&&
  /已在本机加密保存/.test(await panel.locator('#recovery-login-draft-status').innerText()),
  'UI must finish its autosave response before testing page-leave masking');
 const encrypted=await readFile(path.join(root,'data','recovery-login.dpapi'));
 assert.ok(encrypted.length>0&&!encrypted.includes(Buffer.from(syntheticName))&&!encrypted.includes(Buffer.from(syntheticSecret)),
  'the local record must be encrypted');
 for(const id of ['recovery-login-name','recovery-login-password'])
  assert.equal(await panel.locator('#'+id).getAttribute('type'),'password','saved input remains masked');
 const containsPlaceholders=value=>JSON.stringify(value).includes(syntheticName)||JSON.stringify(value).includes(syntheticSecret);
 assert.equal(containsPlaceholders(await state()),false,'regular host state must contain metadata only');
 for(const relative of ['data/settings.json','data/status.json','data/journal.jsonl','挂机日志.txt']){
  const content=await readFile(path.join(root,relative),'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});
  assert.equal(containsPlaceholders(content),false,'local plaintext must not leak into ordinary storage');
 }
 await panel.locator('#tab-overview').click();await panel.locator('#tab-account').click();
 for(const id of ['recovery-login-name','recovery-login-password']){
  assert.equal(await panel.locator('#'+id).getAttribute('type'),'password');
  assert.ok((await panel.locator('#'+id).inputValue())==='','leaving the account page clears displayed input');
 }
 await panel.locator('#toggle-recovery-login-visibility').click();
 await wait(()=>panel.evaluate(({name,secret})=>document.getElementById('recovery-login-name').value===name&&
  document.getElementById('recovery-login-password').value===secret,{name:syntheticName,secret:syntheticSecret}),
  'explicit display did not read the synthetic local record');
 for(const id of ['recovery-login-name','recovery-login-password'])assert.equal(await panel.locator('#'+id).getAttribute('type'),'text');
 await panel.locator('#toggle-recovery-login-visibility').click();
 for(const id of ['recovery-login-name','recovery-login-password'])assert.equal(await panel.locator('#'+id).getAttribute('type'),'password');
 await panel.locator('#clear-recovery-login').click();
 await wait(async()=>{const info=(await state()).recoveryLogin;return !info.saved&&!info.complete&&!info.hasDraft&&!info.bound;},
  'clear must remove the synthetic local record and draft');
 await delay(1200);
 assert.equal((await state()).recoveryLogin.saved,false,'late autosave must not recreate a cleared record');
 assert.equal(await stat(path.join(root,'data','recovery-login.dpapi')).then(()=>true).catch(()=>false),false);
 for(const id of ['recovery-login-name','recovery-login-password']){
  assert.ok((await panel.locator('#'+id).inputValue())==='','clearing the local record clears its DOM inputs');
  assert.equal(await panel.locator('#'+id).getAttribute('type'),'password');
 }
 const after=await state();assert.equal(after.recovery.wantedRun,false);assert.equal(after.profile,null);
 assert.equal(await game.evaluate(()=>!__PB_BRIDGE.app.meta?.account&&!__PB_BRIDGE.app.run&&!__PB_PILOT.enabled),true);
 syntheticVaultTouched=false;
 summary.accountPage={afterMaintenance:true,nineTabs:true,defaultMasked:true,preLoginDraftAutoSaved:true,
  completeInputAutoSaved:true,localDpapiRoundTrip:true,unboundBeforeLogin:true,explicitDisplayOnly:true,
  leavingPageClearsDom:true,regularStateAndLogsContainMetadataOnly:true,clearRemovesVaultAndDraft:true,
  lateAutosaveDoesNotRecreate:true,syntheticOnly:true,nativeLoginSubmitted:false,runIntentArmed:false,
  noAccountCreated:true,noMatchStarted:true,noGuestCreated:true};
 await panel.locator('#tab-overview').click();
}
try{
 await attachSurfaces();
 let s=await state();assert.equal(s.version,info.version);assert.equal(s.profile,null);assert.equal(s.storage.root,root);
 assert.equal(s.config.capturePriority,true,'new capture priority is enabled by default');
 assert.equal(await game.evaluate(()=>__PB_PILOT.settings.capturePriority),true);
 if(malformedFixture){assert.equal(await readFile(path.join(root,'data','custom-plans.json'),'utf8'),malformedFixture);assert.deepEqual(s.customPlans,[]);summary.malformedPlanRecovery={startupPassed:true,originalFilePreserved:true};}
 let catalog;
 const catalogWaitStarted=Date.now();
 await wait(async()=>{
  const current=await panel.evaluate(()=>desktop.getCatalog()),host=await state();
  summary.catalogReadiness={waitedMs:Date.now()-catalogWaitStarted,revision:host.catalogRevision,
   sourceHash:current?.currentVerification?.sourceHash||null,entries:current?.encyclopedia?.entries?.length??null,
   categories:current?.encyclopedia?.categories?.length??null,catalogWarning:host.updateStatus?.catalogWarning||null};
  if(current?.currentVerification?.sourceHash===host.compatibilityReport?.sourceHash&&
   current?.encyclopedia?.entries?.length>2000&&current.encyclopedia.categories?.length>=12){catalog=current;return true;}
  return false;
 },'actual current runtime encyclopedia did not become complete',60);
 for(const k of ['moves','items','vitamins','characters','maps'])assert.ok(catalog[k]?.length>0,'missing live '+k);
 assert.ok(catalog.planEditorSchema?.stats?.length>=20);assert.equal(catalog.currentVerification.sourceHash,s.compatibilityReport.sourceHash);
 // A live rule dependency can change while the public items JSON stays equal.
 // Check the native -> host catalog -> encyclopedia path without an account.
 const nativeShellDescription=await game.evaluate(()=>__PB_BRIDGE.items?.get('shed-shell')?.desc||null);
 assert.ok(typeof nativeShellDescription==='string'&&nativeShellDescription.length>0,'native item description missing');
 const currentShell=catalog.encyclopedia.entries.find(entry=>entry.id==='items:shed-shell');
 assert.equal(catalog.items.find(item=>item.key==='shed-shell')?.description,nativeShellDescription,'plan catalog must use the current native item description');
 assert.equal(currentShell?.description,nativeShellDescription,'encyclopedia must use the current native item description');
 assert.equal(currentShell?.source?.sourceHash,catalog.currentVerification.sourceHash,'current item provenance must bind the actual game source');
 const reviewedShellRule=['1417a0501ebd85e5574166c9f7c47cd27a4da03e3484e89c9f08a95a83363252',
  '0e159d66cbf0ad7fcdc720aa2f321bc03beea611d0236075468530f5f5487e92'].includes(catalog.currentVerification.sourceHash);
 if(reviewedShellRule){assert.match(nativeShellDescription,/10\s*[%％]/u);assert.doesNotMatch(nativeShellDescription,/40\s*[%％]/u);}
 summary.nativeItemDescription={key:'shed-shell',actualSourceHash:catalog.currentVerification.sourceHash,nativeToPlanCatalogEqual:true,
  nativeToEncyclopediaEqual:true,currentSourceProvenance:true,reviewedCurrentDescriptionChecked:reviewedShellRule};
 const auditedUnlockCatalog=JSON.parse(await readFile(new URL('../data/unlock-catalog.json',import.meta.url),'utf8'));
 const auditedUnlockIds=auditedUnlockCatalog.targets.map(target=>target.id).sort();
 const runtimeUnlockIds=(catalog.unlockGoals?.targets||[]).map(target=>target.id).sort();
 assert.ok(auditedUnlockIds.length>0,'reviewed local unlock target catalog is empty');
 assert.equal(new Set(auditedUnlockIds).size,auditedUnlockIds.length,'reviewed target IDs must be unique');
 assert.equal(new Set(runtimeUnlockIds).size,runtimeUnlockIds.length,'runtime target IDs must be unique');
 assert.deepEqual(runtimeUnlockIds,auditedUnlockIds,'runtime unlock graph must retain the complete reviewed target ID set');
 const expectedShinyPerks=[2,4,6,10,15].map(count=>'shiny:perk:'+count).sort();
 assert.deepEqual(runtimeUnlockIds.filter(id=>id.startsWith('shiny:perk:')),expectedShinyPerks,'all five native shiny collection perks must remain selectable');
 summary.unlockCatalogCompleteness={auditedTargets:auditedUnlockIds.length,runtimeTargets:runtimeUnlockIds.length,completeTargetIdSetEqual:true,uniqueIds:true,shinyPerks:5};
 // Compare only public rule fields, never an account snapshot or claim result.
 const publicCondition=condition=>Object.fromEntries(['kind','key','counter','goal','field','value','family','biome','track','quest','targetId'].filter(key=>condition?.[key]!==undefined).map(key=>[key,condition[key]]));
 const eventProjection=target=>{
  const action=target.action||{},earning=action.earning;
  return {id:target.id,executable:target.executable,
   action:Object.fromEntries(['kind','eventId','track','quest','step','questId'].filter(key=>action[key]!==undefined).map(key=>[key,action[key]])),
   earning:earning?{mode:earning.mode,supported:earning.supported,progress:publicCondition(earning.progress),reason:earning.reason??null}:null,
   requirements:(target.requirements||[]).map(publicCondition),
   availability:{state:target.availability?.state??null,reason:target.availability?.reason??null}};
 };
 const auditedEvents=auditedUnlockCatalog.targets.filter(target=>target.category==='events'),
  runtimeEvents=catalog.unlockGoals.targets.filter(target=>target.category==='events');
 assert.ok(auditedEvents.length>0,'reviewed event rules are missing');
 const sortedProjection=entries=>entries.map(eventProjection).sort((a,b)=>a.id.localeCompare(b.id));
 assert.deepEqual(sortedProjection(runtimeEvents),sortedProjection(auditedEvents),'same event IDs must retain current claim/earning/availability rules');
 const eventIds=new Set(auditedEvents.map(target=>target.id));
 const appearanceDependencies=targets=>targets.filter(target=>target.category==='appearance'&&(target.dependencies||[]).some(dependency=>eventIds.has(typeof dependency==='string'?dependency:dependency?.targetId)))
  .map(target=>({id:target.id,dependencies:(target.dependencies||[]).map(dependency=>typeof dependency==='string'?dependency:publicCondition(dependency))})).sort((a,b)=>a.id.localeCompare(b.id));
 const auditedEventAppearances=appearanceDependencies(auditedUnlockCatalog.targets);
 assert.ok(auditedEventAppearances.length>0,'reviewed event appearance dependencies are missing');
 assert.deepEqual(appearanceDependencies(catalog.unlockGoals.targets),auditedEventAppearances,'event cosmetics must depend on the exact native reward');
 summary.unlockCatalogCompleteness.events={targets:auditedEvents.length,completePublicMetadataEqual:true,
  nativeClaimTargets:auditedEvents.filter(target=>['event-reward','event-quest'].includes(target.action?.kind)).length,
  supportedEarning:auditedEvents.filter(target=>target.action?.earning?.supported===true).length,
  manualTargets:auditedEvents.filter(target=>target.executable===false).length,
  appearanceDependencies:auditedEventAppearances.length,completeAppearanceDependenciesEqual:true,
  claimSubmitted:false,accountProgressCreated:false,projectionContainsPublicRulesOnly:true};
 for(const category of ['maps','dex','characters','research','shiny','lab','items','achievements','appearance','events'])
  assert.ok(catalog.unlockGoals.categories.some(entry=>entry.id===category),'missing unlock category '+category);
 await panel.locator('#tab-modes').click();
 assert.equal(await panel.locator('[data-mode="unlocks"]').count(),0,'no duplicate aggregate mode card');
 for(const category of ['maps','dex','characters','research','shiny','lab','items','achievements','appearance','events']){
  const mode=category==='maps'?'map':category;
  const card=category==='maps'?panel.locator('[data-mode="maps"], [data-mode="map"]').first():panel.locator(`[data-mode="${mode}"]`);
  await card.click();
  await wait(async()=>(await state()).config.mode===mode&&await panel.locator(`[data-unlock-category="${category}"]`).count()===1,'independent native mode did not persist '+mode);
  assert.equal(await panel.locator('[data-unlock-category]').count(),1,'only selected mode target control is shown');
 }
 await panel.locator('[data-mode="research"]').click();
 await wait(async()=>(await state()).config.mode==='research','research mode did not save');
 const initialModes=(await state()).config.modeSettings;
 assert.equal(Object.keys(initialModes).length,19,'core modes and all three leaderboard cards have independent route preferences');
 for(const preference of Object.values(initialModes)){assert.equal(preference.biome,'auto');assert.equal(preference.tier,'auto');}
 for(const goal of ['kills','time','survival']){
  const selector=goal==='survival'?'[data-mode="endless"]':`[data-mode="leaderboard-${goal}"]`;
  await panel.locator(selector).first().click();
  await wait(async()=>{const c=(await state()).config;return (goal==='survival'?c.mode==='endless':c.mode==='leaderboard'&&c.leaderboardGoal===goal)&&await panel.locator('#biome-select').inputValue()==='auto'&&await panel.locator('#tier-select').inputValue()==='auto';},'leaderboard card inherited another route '+goal);
  assert.equal(await game.evaluate(()=>__PB_PILOT.modePlanningSettings().modePreference.routeKey),goal==='survival'?'endless':'leaderboard-'+goal);
  if(goal!=='survival'){
   await panel.locator('#biome-select').selectOption('forest');await panel.locator('#tier-select').selectOption(goal==='kills'?'1':'2');
   await wait(async()=>{const own=(await state()).config.modeSettings['leaderboard-'+goal];return own.biome==='forest'&&own.tier===(goal==='kills'?1:2);},'leaderboard route did not persist '+goal);
  }
 }
 for(const goal of ['kills','time']){
  await panel.locator(`[data-mode="leaderboard-${goal}"]`).click();
  await wait(async()=>await panel.locator('#biome-select').inputValue()==='forest'&&await panel.locator('#tier-select').inputValue()===(goal==='kills'?'1':'2'),'leaderboard routes were not independent '+goal);
 }
 summary.leaderboardRoutes={keys:['leaderboard-kills','leaderboard-time','endless'],legacySurvivalKeyNotAVisibleCard:true,initialAuto:true,independentSwitches:true};
 await panel.locator('[data-mode="research"]').click();
 await wait(async()=>(await state()).config.mode==='research'&&await panel.locator('#tier-select').inputValue()==='auto','research route should retain its own default');
 await panel.locator('#biome-select').selectOption('forest');await panel.locator('#tier-select').selectOption('0');
 await wait(async()=>{const v=(await state()).config.modeSettings.research;return v.biome==='forest'&&v.tier===0;},'native per-mode route did not save');
 await panel.locator('[data-mode="items"]').click();
 await wait(async()=>(await state()).config.mode==='items'&&await panel.locator('#biome-select').inputValue()==='auto'&&await panel.locator('#tier-select').inputValue()==='auto','other mode inherited a stored route');
 await cmd('config',{modeSettings:{items:{tier:2}}});
 await wait(async()=>(await state()).config.modeSettings.items.tier===2,'partial mode tier did not save');
 assert.equal((await state()).config.modeSettings.items.biome,'auto','partial route merge retains the other field');
 await panel.locator('[data-mode="research"]').click();
 await wait(async()=>await panel.locator('#biome-select').inputValue()==='forest'&&await panel.locator('#tier-select').inputValue()==='0','research route did not restore after mode switch');
 await panel.locator('[data-unlock-category="research"]').selectOption('research:1');
 await wait(async()=>(await state()).config.unlockTargets.research==='research:1','native specific research target did not save');
 assert.equal(await game.evaluate(()=>__PB_PILOT.settings.unlockTargets.research),'research:1');
 await panel.locator('#unlock-target-search').fill('zz-no-matching-unlock');
 assert.equal(await panel.locator('[data-unlock-category="research"]').inputValue(),'research:1','search must retain the actual selected target');
 await panel.locator('#unlock-target-search').fill('');
 summary.unlockGoals={categories:catalog.unlockGoals.categories.length,targets:catalog.unlockGoals.targets.length,
  publicGraphPresent:true,independentModeCards:true,noAggregateCard:true,perModeRoutePersisted:true,actualNativeCategoryAndTargetSaved:true,selectedTargetRetainedDuringSearch:true,
  noAccountCreated:true,noRunStarted:true};
 await exerciseLocalAccountPage();
 const pre=await cmd('getPrerequisites');assert.equal(pre.status,'ready');assert.ok(pre.runtimeVersion);assert.equal(pre.installerAvailable,true);
 const already=await cmd('installPrerequisites');assert.equal(already.status,'ready');assert.ok(!already.installerExitCode,'installed runtime does not run installer');
 const changelog=await cmd('showChangelog');assert.equal(path.basename(changelog.path),'更新日志.txt');
 const history=await readFile(changelog.path,'utf8');for(const version of ['0.4.0','0.5.0','0.5.1','0.5.2','0.6.0','0.7.0','0.8.0','0.9.0','0.10.0','0.11.0'])assert.ok(history.includes(version));
 assert.ok(catalog.encyclopedia.entries.length>2000);assert.ok(catalog.encyclopedia.categories.length>=12);
 await panel.locator('#tab-encyclopedia').click();
 await wait(()=>panel.evaluate(()=>innerHeight>550),'encyclopedia must automatically expand before browsing');
 await panel.locator('#encyclopedia-search').fill('每秒');
 assert.ok(await panel.locator('.encyclopedia-card').count()>0,'description query must match real data');
 assert.ok((await panel.locator('#encyclopedia-detail').innerText()).includes('每秒'));
 await panel.screenshot({path:path.join(output,'encyclopedia.png')});
 await panel.locator('#encyclopedia-search').fill('zz-no-match-encyclopedia');assert.equal(await panel.locator('.encyclopedia-card').count(),0);
 await panel.locator('#encyclopedia-search').fill('');
 await panel.locator('#tab-plans').click();await panel.locator('#plan-new').click();await panel.locator('#plan-name').fill('原生集成测试方案');await panel.locator('#plan-save').click();
 await wait(async()=>(await state()).customPlans.some(p=>p.name==='原生集成测试方案'),'UI native save failed');
 s=await state();const created=s.customPlans.find(p=>p.name==='原生集成测试方案');
 const saved=await cmd('saveCustomPlan',{plan:{...created,species:4,moveRules:[{key:'ember',priority:1,targetLevel:4}],itemRules:[{key:'leftovers',priority:1,targetCount:2,copy:true,shop:true}],vitaminRules:[{key:catalog.vitamins[0].key,priority:1,targetCount:3}],interactions:{free:true,paid:true,goldReserve:25,maxSpend:120,totalBudget:240}}});
 assert.equal(saved.plan.items[0],'leftovers');assert.equal(saved.plan.interactions.goldReserve,25);
 assert.equal(saved.plan.interactions.totalBudget,240);
 const disk=JSON.parse(await readFile(path.join(root,'data','custom-plans.json'),'utf8'));assert.ok(disk.plans.some(p=>p.id===created.id));
 assert.ok(await game.evaluate(id=>globalThis.__PB_PILOT.settings.customPlans.some(p=>p.id===id),created.id));
 let rejected=false;try{await cmd('importCustomPlans',{plans:[{name:'a',id:'custom-dupe'},{name:'b',id:'custom-dupe'}]});}catch{rejected=true;}assert.ok(rejected);assert.ok((await state()).customPlans.some(p=>p.id===created.id));
 const exported=await cmd('exportCustomPlans');assert.ok(exported.path.startsWith(root+path.sep));assert.ok(exported.plans.some(p=>p.id===created.id));
 for(const kind of ['full','fix','content','builds','guides','diagnostics','prerequisites','sharing','encyclopedia']){const prompt=await cmd('generateUpdatePrompt',{kind});assert.ok(prompt.text.includes('UPDATE-STANDARD.md'));assert.ok(prompt.text.includes('百变怪'));assert.ok(prompt.text.includes('百科'));assert.ok(prompt.text.includes('Standalone'));assert.ok(prompt.text.includes('unlockTargets'));assert.ok(prompt.text.includes('PokeBonk-Pilot-maintenance-source.zip'));assert.ok(!prompt.text.includes('accountId'));}
 const maintenance=await cmd('prepareMaintenancePackage');assert.ok(maintenance.path.startsWith(path.join(root,'data','maintenance')+path.sep));assert.ok((await stat(maintenance.path)).size>100000);
 await panel.locator('#tab-maintenance').click();
 assert.ok((await panel.locator('#connection-status').innerText()).includes(summary.connection.runtimeVersion));
 await panel.locator('#copy-connection-diagnostics').click();
 summary.connection.copyObservation={completed:false};
 try {
  await wait(async()=>/^(已复制接入诊断|复制未完成)/.test(await panel.locator('#toast').innerText()),'native safe diagnostic copy did not complete');
 } finally {
  const text=await panel.locator('#toast').innerText().catch(()=>''),buttonEnabled=await panel.locator('#copy-connection-diagnostics').isEnabled().catch(()=>false);
  summary.connection.copyObservation={completed:/^已复制接入诊断/.test(text),
   safeToast:/^(已复制接入诊断|复制未完成)/.test(text)?text:'other-or-missing-ui-message',buttonEnabled};
 }
 assert.equal(summary.connection.copyObservation.completed,true,'native safe diagnostic copy must report success');
 summary.connection.nativeCopyButtonCompleted=true;
 summary.connection.operatingSystemClipboardRead=false;
 // Allowlist contents are independently checked by the isolated UI suite;
 // never read a possibly changed user clipboard to inspect this click.
 await panel.screenshot({path:path.join(output,'maintenance.png')});
 const update=await cmd('checkUpdates');assert.ok(['ready','changed','blocked','offline'].includes(update.state));
 summary.updateStatus=update;summary.catalogCounts=Object.fromEntries(['moves','items','vitamins','characters','maps'].map(k=>[k,catalog[k].length]));summary.liveCatalogHash=catalog.currentVerification.sourceHash;
 summary.maintenancePackage=maintenance.path;summary.customPlan={nativeCreate:true,persisted:true,policySettingsUpdated:true,invalidImportRetainsExisting:true,exportInsideRoot:true};summary.prompts=9;
 summary.prerequisites={ready:true,offlineInstallerChecked:true,existingRuntimeNotReinstalled:true};summary.changelog={sidecarAndViewer:true,historicalVersions:true};summary.encyclopedia={entries:catalog.encyclopedia.entries.length,categories:catalog.encyclopedia.categories.length,descriptionQuery:true,emptySearch:true};
 await panel.locator('#tab-plans').click();await panel.screenshot({path:path.join(output,'plans.png')});
 await cmd('config',{build:created.id});
 await cmd('deleteCustomPlan',{id:created.id});assert.ok(!(await state()).customPlans.some(p=>p.id===created.id));
 assert.equal((await state()).config.build,'auto');assert.equal(await game.evaluate(()=>__PB_PILOT.settings.build),'auto');summary.deletedSelectedPlanResetsHostAndPilot=true;
 await cmd('config',{randomDelay:'invalid',randomDelayMinMs:50000,randomDelayMaxMs:-9});
 s=await state();assert.equal(s.config.randomDelay,true);assert.equal(s.config.randomDelayMinMs,0);assert.equal(s.config.randomDelayMaxMs,30000);
 await cmd('config',{mode:'research',unlockCategory:'research',unlockTargets:{...(await state()).config.unlockTargets,research:'research:1',shiny:'auto'},
  randomDelay:false,safeMode:false,autoUpgrade:false,capturePriority:false,randomDelayMinMs:1250,randomDelayMaxMs:2200});
 const bindings={hotkeyToggle:'Ctrl+Shift+KeyP',hotkeyStop:'Ctrl+Shift+KeyO',hotkeyReleaseMouse:'Ctrl+Shift+KeyM'};
 await cmd('config',bindings);
 let duplicateRejected=false;try{await cmd('config',{hotkeyToggle:bindings.hotkeyStop});}catch{duplicateRejected=true;}
 assert.equal(duplicateRejected,true);assert.equal((await state()).config.hotkeyToggle,bindings.hotkeyToggle);
 await panel.locator('#tab-settings').click();
 const hotkeyRenderStarted=Date.now();
 await wait(async()=>{
  for(const key of Object.keys(bindings))if(await panel.locator('#hotkey-'+key).inputValue()!==bindings[key].replace(/Key([A-Z])$/,'$1'))return false;
  return true;
 },'saved host hotkeys were not rendered in the actual UI',15);
 summary.hotkeyRenderObservation={waitedMs:Date.now()-hotkeyRenderStarted,actualDomValuesRequired:true,noUiStateMutation:true};
 for(const key of Object.keys(bindings))assert.equal(await panel.locator('#hotkey-'+key).inputValue(),bindings[key].replace(/Key([A-Z])$/,'$1'));
 const releases=async()=>(await state()).logs.filter(log=>log.title==='鼠标已释放').length;
 let releaseCount=await releases();
 if(!backgroundSafe){
  await game.bringToFront();await game.keyboard.press('Control+Shift+M');
  await wait(async()=>await releases()>releaseCount,'configured game-surface release hotkey failed');
  await panel.bringToFront();
 }
 releaseCount=await releases();await panel.locator('#tab-settings').click();await panel.locator('#release-mouse').click();
 await wait(async()=>await releases()>releaseCount,'native release button failed');
 assert.equal((await state()).profile,null,'releasing mouse must not create a guest');
 const persisted=JSON.parse(await readFile(path.join(root,'data','settings.json'),'utf8'));
 for(const key of ['randomDelay','safeMode','autoUpgrade','capturePriority'])assert.equal(persisted[key],false,'false saved before restart: '+key);
 await closeClient('first test client failed to close normally');
 browser=panel=game=null;
 await wait(async()=>{try{await fetch('http://127.0.0.1:9223/json/version');return false;}catch{return true;}},'debug endpoint did not close before restart',20);
 child=spawn(path.join(root,'PokeBonk Pilot.exe'),['--diagnostics','--diagnostics-no-activate'],{cwd:root,windowsHide:true,stdio:'ignore'});
 await attachSurfaces();s=await state();assert.equal(s.profile,null);assert.equal(s.version,info.version);
 for(const key of ['randomDelay','safeMode','autoUpgrade','capturePriority']){
  assert.equal(s.config[key],false,'false restored by native startup: '+key);
  assert.equal(await game.evaluate(key=>__PB_PILOT.settings[key],key),false,'false restored to pilot: '+key);
 }
 assert.equal(s.config.randomDelayMinMs,1250);assert.equal(s.config.randomDelayMaxMs,2200);
 for(const key of Object.keys(bindings)){assert.equal(s.config[key],bindings[key]);assert.equal(await game.evaluate(key=>__PB_PILOT.settings[key],key),bindings[key]);}
 assert.equal(s.config.mode,'research');
 assert.deepEqual(s.config.modeSettings.research,{biome:'forest',tier:0});assert.deepEqual(s.config.modeSettings.items,{biome:'auto',tier:2});
 assert.deepEqual(s.config.modeSettings['leaderboard-kills'],{biome:'forest',tier:1,campStage:3});assert.deepEqual(s.config.modeSettings['leaderboard-time'],{biome:'forest',tier:2});assert.deepEqual(s.config.modeSettings.endless,{biome:'auto',tier:'auto',campStage:'auto'});assert.deepEqual(s.config.modeSettings['leaderboard-survival'],{biome:'auto',tier:'auto',campStage:'auto'});
 summary.leaderboardRoutes.normalRestartPreserved=true;
 assert.equal(await game.evaluate(()=>__PB_PILOT.settings.modeSettings.research.biome),'forest');
 assert.equal(await game.evaluate(()=>__PB_PILOT.settings.modeSettings.items.tier),2);
 assert.equal(s.config.unlockTargets.research,'research:1');assert.equal(s.config.unlockTargets.shiny,'auto');
 assert.equal(await game.evaluate(()=>__PB_PILOT.settings.unlockTargets.research),'research:1');
 summary.unlockGoals.normalRestartSelectionPreserved=true;
 await cmd('config',{mode:'auto',unlockCategory:'all'});
 summary.hotkeys={customBindingsPersisted:true,duplicateRejected:true,gameSurfaceRelease:backgroundSafe?null:true,
   focusedHotkeyTestSkipped:backgroundSafe,...(backgroundSafe?{reason:'user-playing'}:{}),
   nativeButtonRelease:true,noAccountCreated:true};
 await cmd('config',{hotkeyToggle:'F8',hotkeyStop:'F9',hotkeyReleaseMouse:'F10'});
 summary.settingsRestart={normalCloseAndRelaunch:true,samePortableDirectory:true,dataPreserved:true,falseBooleans:['randomDelay','safeMode','autoUpgrade','capturePriority'],delayBounds:[1250,2200],hostAndPilotAgree:true,invalidBooleanDefaultsAndBoundsChecked:true};
 await cmd('config',{capturePriority:true});
 assert.equal(await game.evaluate(()=>__PB_PILOT.settings.capturePriority),true);
 summary.capturePriority={defaultEnabled:true,disabledPersisted:true,pilotAndHostAgree:true,restoredTrue:true};
 await cmd('clearLogs');assert.equal((await readFile(path.join(root,'挂机日志.txt'))).length,0);
 // Deliberately fail only this unlogged maintenance GameView. This verifies
 // the native host's repair path; it does not identify the cause of any
 // separately observed campaign/browser failure and cannot count as gameplay.
 const beforeCrash=await state();
 assert.equal(beforeCrash.profile,null);assert.ok(!beforeCrash.game?.accountType&&!beforeCrash.game?.state);
 assert.equal(beforeCrash.running,false);
 for(const key of ['runs','completedRuns','wins'])assert.equal(beforeCrash.session[key],0);
 const nativeEventsBefore=beforeCrash.game?.events||[];
 const oldInstance=await game.evaluate(()=>__PB_PILOT.controlSnapshot().instance);
 const gameCdp=await game.context().newCDPSession(game);
 let actualPageCrash=false,crashCommandResult='pending';
 game.once('crash',()=>{actualPageCrash=true;});
 void gameCdp.send('Page.crash').then(()=>{crashCommandResult='returned';},()=>{crashCommandResult='protocol-disconnected-after-crash';});
 await wait(()=>actualPageCrash,'real Page.crash event missing',30);
 // Native Core.Reload is external to Playwright. Reconnect so its old
 // Page's sticky crashed flag cannot hide a repaired native document.
 browser=panel=game=null;
 await wait(async()=>await discoverSurfaces()&&((await state()).recovery?.phase!=='idle'||
   (await state()).logs.some(log=>log.title==='游戏进程异常，自动恢复中')),
   'native ProcessFailed did not start automatic repair',60);
 const failurePhase=(await state()).recovery.phase;
 await wait(async()=>{
  if(!await discoverSurfaces())return false;
  const host=await state();
  return host.recovery?.phase==='idle'&&host.compatibilityReport?.state==='ready'&&
    await game.evaluate(old=>!!globalThis.__PB_BRIDGE?.app&&globalThis.__PB_PILOT?.compatibility.state==='ready'&&
      __PB_PILOT.controlSnapshot().instance!==old,oldInstance);
 },'isolated no-account renderer did not recover to a fresh ready document',150);
 const recoveredState=await state();
 assert.equal(recoveredState.running,false);assert.equal(Boolean(recoveredState.game?.enabled),false);
 assert.equal(recoveredState.profile,null);assert.equal(recoveredState.recovery.wantedRun,false);
 assert.deepEqual(recoveredState.session,beforeCrash.session,'page repair does not invent elapsed play, wins or rewards');
 assert.ok(!(recoveredState.game?.events||[]).some(e=>e.kind==='settlement'&&e.saved),'page repair does not invent a native saved settlement');
 assert.equal(await game.evaluate(()=>!__PB_BRIDGE.app.meta?.account&&!__PB_BRIDGE.app.run&&!__PB_PILOT.enabled),true);
 await delay(2300);
 const twoTicksAfter=await state();
 assert.equal(twoTicksAfter.running,false);assert.equal(Boolean(twoTicksAfter.game?.enabled),false);
 assert.equal(twoTicksAfter.recovery.phase,'idle');assert.equal(twoTicksAfter.recovery.wantedRun,false);
 assert.deepEqual(twoTicksAfter.session,recoveredState.session,'unarmed repaired page must not accumulate gameplay statistics');
 assert.equal(twoTicksAfter.profile,null);
 summary.browserFailure={scope:'injected renderer failure in this unlogged no-match maintenance client only',
   actualCdpPageCrashRequested:true,actualPageCrashObserved:actualPageCrash,crashCommandResult,
   observedRecoveryPhase:failurePhase,freshDocumentInstance:true,automaticallyReady:true,panelStillResponsive:true,runningFalse:true,staleEnabledFalse:true,
   twoTicksNoStatisticsGrowth:true,noAccountCreated:true,noMatchStarted:true,noInventedWinsOrSaveEvents:true,
   unarmedIntentStaysStopped:true,provesCauseOfSeparateCampaignCrash:false};
 await closeClient('test client failed to close normally');
 summary.browserFailure.normalCloseAfterCrash=true;
 assert.equal(sha(await readFile(path.join(root,'PokeBonk Pilot.exe'))),info.sha256);assert.deepEqual(summary.errors,[]);summary.passed=true;
}catch(error){summary.reason=error.message;throw error;}
finally{
 if(syntheticVaultTouched&&child.exitCode===null&&panel){
  await cmd('clearRecoveryLogin').catch(()=>{});
  await panel.evaluate(()=>{for(const id of ['recovery-login-name','recovery-login-password']){const input=document.getElementById(id);if(input){input.value='';input.type='password';}}}).catch(()=>{});
 }
 if(child.exitCode===null&&panel)await cmd('testClose').catch(()=>{});
 summary.endedAt=new Date().toISOString();await writeFile(path.join(output,'summary.json'),JSON.stringify(summary,null,2)+'\n');
 console.log(JSON.stringify({passed:summary.passed,reason:summary.reason,output,catalogCounts:summary.catalogCounts,update:summary.updateStatus?.state}));
}
