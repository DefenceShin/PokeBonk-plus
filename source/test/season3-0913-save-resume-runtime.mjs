import fs from 'node:fs';import assert from 'node:assert/strict';import {openSeason3Fixture} from './season3-0913-browser-fixture.mjs';
const f=await openSeason3Fixture('m3-0913-save-resume');
const rows=JSON.parse(fs.readFileSync(new URL('evidence/save-resume-0913-contracts.json',f.task),'utf8'));
const methods=['saveAndQuitOnce','resumeSaved'].map(name=>rows.find(r=>r.name===name));
try{const result=await f.page.evaluate(async methods=>{
 const app=__PB_BRIDGE.app,p=__PB_PILOT,meta=app.meta,results=[];
 const compile=(row,env)=>new Function(...Object.keys(env),'return ({'+row.code+'})['+JSON.stringify(row.actual)+']')(...Object.values(env));
 for(const failure of [false,true]){
  const r=__M2_MAKE_RUN();r.state='paused';meta.ticket={id:'save-fixture-'+failure};let record=null,resolve,reject,menus=0,starts=0;
  const snapshot={v:1,cfg:{mode:'standard',species:1,biome:'forest',tier:1,boosts:[]},result:{progress:{captured:[]}}};
  app.saved=()=>record;app.toMenu=()=>{menus++;app.run=null};app.startRun=async()=>{starts++;return false};
  meta.suspendRun=()=>new Promise((a,b)=>{resolve=a;reject=b});meta.uploadSave=async()=>true;p.observeNativePauseTransfers();
  const save=compile(methods[0],{U:x=>x,Pp:()=>null,Lp:()=>snapshot,Cs:{},Ah:async(id,ticket,save)=>{record={ticket,save};return {signature:'fixture'};},jh:()=>{record=null},Mh:()=>({local:'fixture'}),M:()=>{}});
  r.checkpoint=()=>{};const saving=save.call(r);await Promise.resolve();await Promise.resolve();
  const during={transfer:p.nativePauseTransferPending(),menuAllowed:p.menuOperationsAllowed(),state:r.state,starts};
  if(failure)reject({offline:true});else resolve({});const message=await saving;
  const savedState={state:r.state,sent:!!r.sent,record:!!record,message};
  if(!failure){app.toMenu();p.enabled=true;await p.macro();}
  results.push({kind:'save',failure,during,after:savedState,starts,recordPreserved:!!record});
 }
 for(const failure of [false,true]){
  app.run=null;let record={ticket:{id:'restore-fixture'},save:{v:1,cfg:{mode:'standard',species:1,biome:'forest',tier:1,boosts:['old']},result:{progress:{captured:[]}}}},resolve,reject,launchCfg,starts=0;
  app.saved=()=>record;app.toMenu=()=>{app.run=null};app.notice=()=>{};
  app.startRun=async()=>{starts++;return false};
  app.launch=(cfg)=>{launchCfg=cfg;const run=__M2_MAKE_RUN(cfg.species);run.tier=cfg.tier;run.$iacvfl=()=>{};};
  meta.resumeRun=()=>new Promise((a,b)=>{resolve=a;reject=b});p.observeNativePauseTransfers();
  const resume=compile(methods[1],{U:x=>x,Vh:async()=>({signature:'fixture'}),Rh:async()=>null,Fh:()=>null,jh:()=>{record=null},Lh:()=>{},M:()=>{},V:{deny(){}}});
  const resuming=resume.call(app);await Promise.resolve();await Promise.resolve();
  const during={transfer:p.nativePauseTransferPending(),menuAllowed:p.menuOperationsAllowed(),record:!!record};
  if(failure)reject({offline:true,message:'offline fixture'});else resolve({});await resuming;
  if(!failure)p.attachRun(app.run);else{p.enabled=true;await p.macro();}
  results.push({kind:'resume',failure,during,recordPreserved:!!record,run:!!app.run,restoredSameObject:launchCfg.restore.v===1,biome:launchCfg.biome,tier:launchCfg.tier,starting:app.starting,starts});
 }
 return results;
},methods);fs.writeFileSync(new URL('evidence/save-resume-0913-result.json',f.task),JSON.stringify({results:result,boundary:'Exact reviewed native method bodies; signing, local persistence, snapshot serializer and server promises are isolated memory fixtures. Pilot observes actual transfer wrappers/menu guards; no account, files or server save used.'},null,2));
 for(const x of result){assert.equal(x.during.transfer,true);assert.equal(x.during.menuAllowed,false);assert.equal(x.starts,0);if(x.kind==='save'){assert.equal(x.after.state,x.failure?'paused':'over');assert.equal(x.recordPreserved,!x.failure);}else{assert.equal(x.recordPreserved,x.failure);assert.equal(x.run,!x.failure);assert.equal(x.starting,false);assert.equal(x.restoredSameObject,true);assert.equal(x.tier,1);}}
 assert.deepEqual(f.errors,[]);console.log('PASS exact current native save/resume state machine -> Pilot transfer/menu guards -> same saved config, failure preserves playable/save state; isolated storage/signature/serializer/server dependencies');
}finally{await f.context.close();}
