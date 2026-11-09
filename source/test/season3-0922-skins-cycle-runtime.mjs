import fs from 'node:fs';import assert from 'node:assert/strict';import {openSeason3Fixture} from './season3-0922-browser-fixture.mjs';
const f=await openSeason3Fixture('0922-skins-cycle',{unlockCatalog:JSON.parse(fs.readFileSync(new URL('../data/unlock-catalog.json',import.meta.url)))});
try{const result=await f.page.evaluate(async()=>{
 const p=__PB_PILOT,b=__PB_BRIDGE,app=b.app,m=app.meta,rows=[],base=structuredClone(m.profile);
 for(const mode of ['appearance','wardrobe'])for(const species of [7,152,170,251])for(const accepted of [false,true]){
  app.run=null;p.run=null;p.plan=null;p.finiteSettlementScope=null;p.savePending=false;p.enabled=false;p.nextStartAt=0;p.starting=false;p.settings.autoClaim=false;
  m.profile={...structuredClone(base),league:b.roster.map(x=>x.id),biomes:Object.fromEntries(b.biomes.map(x=>[x.id,3])),counters:{},quests:{},cosmetics:[],skins:[],forms:[],research:{},team:[]};
  m.backend={};m.snap=null;m.queued=0;m.batch=[];m.epoch=0;m.queue=Promise.resolve();m.hasPending=()=>false;
  p.confirmNativeProfileOrigin(m.profile,app,m,m.account);p.commitUnlockProfile(m.profile,'native-fixture');
  p.settings.mode=mode;p.settings.characterId=0;p.settings.autoRestart=true;p.settings.unlockTargets={appearance:`appearance:skin-m1:${species}`};p.settings.modeSettings[mode]={species,look:'m1',biome:'auto',tier:'auto',countMode:'auto'};p.unlockSelectionKey=null;
  const q=p.makePlan();let opened=null;app.saved=()=>null;
  app.openRun=async cfg=>{opened=structuredClone(cfg);const r=__M2_MAKE_RUN(cfg.species);Object.assign(r,{mode:cfg.mode,endless:cfg.mode==='endless',biome:b.biomes.find(x=>x.id===cfg.biome),tier:cfg.tier});return true;};
  p.start();await p.macro();const r=app.run;if(!r)throw Error('did not start '+JSON.stringify({mode,species,opened,status:p.status,health:p.health,proof:p.profileVerificationSnapshot()}));
  // Native App.startRun and Pilot start are real. Rendering/full run construction is isolated.
  p.plan=q;p.planRun=r;m.snap=structuredClone(m.profile);const g=q.unlockAction.normalFinishGoal;
  m.profile.counters[g.metric]=g.goal-1;const below=p.finiteRunCompletionState(r);m.count(g.metric,1);const reached=p.finiteRunCompletionState(r);
  let resolve,reject,reported;const receipt=new Promise((a,z)=>{resolve=a;reject=z});
  m.backend={finishRun:async(account,ticket,report)=>{reported=report;return receipt}};m.ticket={id:`skin-${mode}-${species}-${accepted}`};
  const nativeResult={mode:r.mode,biome:r.biome.id,tier:r.tier,species,victory:false,time:120,kills:0,end:{how:'quit'},build:{moves:[]}};
  r.result=()=>nativeResult;r.stats.league=[];r.stats.shinies=[];r.stats.classics=[];r.ui.saving=()=>{};r.ui.$1x6vr3r=()=>{};r.ui.$pm7cn4=()=>{};let finishing;r.finish=function(...args){finishing=__M2_TYPES.run.prototype.finish.apply(this,args);return finishing;};
  let menus=0;app.toMenu=()=>{menus++;app.run=null};p.observeSaves();
  const submitted=p.settleCompletedFiniteRun(r);await Promise.resolve();const during={pending:p.savePending,menus,target:p.savedUnlockProfileCurrent()?.counters?.[g.counter]??0};
  const responseProfile=structuredClone(m.profile),native=__SKIN_NATIVE.looks.find(x=>x.member===species&&x.n===1);
  const nativeValue=native.rule.v({r:nativeResult,d:reported?.progress?.counters??{}});responseProfile.counters[g.counter]=nativeValue;
  if(accepted)resolve({profile:responseProfile,stardust:0,tasks:[]});else reject(Error('isolated rejected finish'));
  await finishing;
  const saved=p.savedUnlockProfileCurrent()?.counters?.[g.counter]??0,event=p.events.filter(e=>e.kind==='settlement').at(-1);
  rows.push({mode,species,accepted,opened,below,reached,submitted,during,saved,nativeValue,reported:reported?.progress?.counters,eventSaved:event?.saved,phase:p.finiteSettlementScope?.phase});
  app.run=null;p.run=null;p.plan=null;p.enabled=true;p.unlockSelectionKey=null;
  if(accepted){const claim=p.makePlan();let claims=0,release;
   let serverProfile=structuredClone(m.profile);m.backend={loadProfile:async()=>structuredClone(serverProfile),claimQuest:async()=>{claims++;return new Promise(a=>{release=a})}};m.resync=Object.getPrototypeOf(m).resync;m.onError=()=>{};m.queue=Promise.resolve();m.queued=0;
   p.settings.autoClaim=false;await p.prepareUnlockMenuAction(claim,()=>true);const offCalls=claims;
   p.settings.autoClaim=true;p.actionTimes?.clear?.();p.lastActionAt=-Infinity;p.cadence.reset('claim-test');
   const claiming=p.prepareUnlockMenuAction(claim,()=>true);await Promise.resolve();await Promise.resolve();
   const beforeClaim=p.savedUnlockProfileCurrent()?.quests?.[claim.unlockAction.key]===true;
   await p.prepareUnlockMenuAction(claim,()=>true);const duringClaims=claims;
   const afterProfile=structuredClone(m.profile);afterProfile.quests[claim.unlockAction.key]=true;afterProfile.cosmetics.push('look:'+species+':1');serverProfile=afterProfile;release(afterProfile);await claiming;await m.resync();
   const next=p.makePlan();let following=null;if(mode==='wardrobe'&&species===7){m.profile.cosmetics.push('look:1:1','look:4:1');p.confirmNativeProfileOrigin(m.profile,app,m,m.account);p.commitUnlockProfile(m.profile,'native-test-previous-looks');p.settings.modeSettings.wardrobe.species='auto';p.unlockSelectionKey=null;following=p.makePlan().species;}rows.at(-1).claim={key:claim.unlockAction.key,offCalls,beforeClaim,duringClaims,claims,saved:!!p.savedUnlockProfileCurrent()?.quests?.[claim.unlockAction.key],nextTarget:next.goalProgress?.targetId,nextAction:next.unlockAction?.kind,nextStatus:next.goalProgress?.status,following};
  }
 }
 return rows;
});fs.writeFileSync(new URL('evidence/0922-skins-cycle.json',f.task),JSON.stringify({result,errors:f.errors},null,2));
for(const x of result){assert.equal(x.opened.mode,'endless');assert.equal(x.below.ready,false);assert.equal(x.reached.ready,true,JSON.stringify(x));assert.equal(x.submitted,true);assert.equal(x.during.pending,true);assert.equal(x.during.menus,0);assert.equal(x.during.target,0);assert.ok(x.nativeValue>0);assert.equal(x.saved,x.accepted?x.nativeValue:0);assert.equal(x.eventSaved,x.accepted);if(x.claim){assert.equal(x.claim.offCalls,0);assert.equal(x.claim.beforeClaim,false);assert.equal(x.claim.duringClaims,1);assert.equal(x.claim.claims,1);assert.equal(x.claim.saved,true);assert.notEqual(x.claim.nextAction,'claim-quest');if(x.mode==='wardrobe')assert.equal(x.claim.nextStatus,'complete');if(x.claim.following!==null)assert.equal(x.claim.following,10);}}
assert.deepEqual(f.errors,[]);console.log('PASS 16 actual-native App start/Run finish/Meta report+rollback cycles, threshold boundaries, 8 actual-native quest claims and next plans; backend receipts and result serialization isolated');
}finally{await f.context.close()}
