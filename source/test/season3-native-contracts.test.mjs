import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
const task=new URL('../../',import.meta.url),rows=JSON.parse(fs.readFileSync(new URL('evidence/native-contracts.json',task)));
for(const [module,sha]of new Map(rows.map(r=>[r.module,r.moduleSha256])))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(new URL('evidence/current-public/'+module,task))).digest('hex'),sha);
const code=(role,name)=>{const matches=rows.filter(r=>r.role===role&&r.name===name);assert.equal(matches.length,1,role+'.'+name);return matches[0];};
const method=(role,name,env={})=>{const row=code(role,name);return vm.runInNewContext('({'+row.code+'})',{Date,Promise,Math,console,...env})[row.actual];};
const tr=(text)=>text;
test('current App saved-run guard cannot overwrite an existing native save when starting standard play',async()=>{
 const calls=[],app={starting:false,saved:()=>({save:{v:1}}),offerSaved:reason=>calls.push(reason),openRun:async()=>{throw Error('must not start over save')}};
 const result=await method('app','startRun',{pt:()=>{}}).call(app,{mode:'standard',biome:'forest',species:1,tier:0});
 assert.equal(result,false);assert.deepEqual(calls,['start']);assert.equal(app.starting,false);
});
for(const rejected of [false,true])test('current App start promise resets its starting state '+(rejected?'on native failure':'on success'),async()=>{
 let cfg,starts=0;const app={starting:false,saved:()=>null,openRun:async c=>{cfg=c;starts++;if(rejected)throw Error('native failure');return true;}};
 const run=method('app','startRun',{pt:()=>{}}).call(app,{mode:'standard',biome:'coast',species:99,tier:1});
 if(rejected)await assert.rejects(run,/native failure/);else assert.equal(await run,true);
 assert.equal(starts,1);assert.equal(app.starting,false);assert.equal(cfg.biome,'coast');
});
const portal=method('run','enterPortal',{U:tr,F:{get:()=>({name:'fixture capture'})}}),next=code('run','changeZone').actual;
function portalRun({stage=3,sanctuary=null,rewards=0,waiting=false}={}){
 const events=[];const run={state:'play',stage,biome:{sanctuary},player:{dead:false},capture:{throwing:false,canWait:()=>waiting,species:1},interactables:{rewardsLeft:()=>rewards},realTime:20,rewardWarnAt:0,leaveWarnAt:0,ui:{toast:()=>events.push('warning')},audio:{deny(){}},finish:v=>events.push(v?'victory':'failure'),[next]:async()=>{events.push('next-stage');run.stage++;}};
 return {run,events};
}
for(const map of ['forest','desert','coast','glacier'])for(const tier of [0,1,2])test('current portal standard transition and terminal stage '+map+'/'+tier,async()=>{
 const {run,events}=portalRun({stage:1});run.biome.id=map;run.tier=tier;
 await portal.call(run);assert.deepEqual(events,['next-stage']);
 run.stage=3;await portal.call(run);assert.equal(events.at(-1),'victory');
 run.biome.sanctuary={};events.length=0;run.stage=3;await portal.call(run);assert.deepEqual(events,['next-stage']);
 run.stage=4;await portal.call(run);assert.equal(events.at(-1),'victory');
});
test('current native unclaimed reward and waiting capture warnings require four explicit E attempts before leaving',async()=>{
 const {run,events}=portalRun({rewards:1,waiting:true});
 for(let i=0;i<3;i++){await portal.call(run);assert.ok(!events.includes('victory'));}
 await portal.call(run);assert.equal(events.at(-1),'victory');assert.equal(events.filter(e=>e==='warning').length,3);
});
for(const how of ['won','died'])for(const saveFailure of [false,true])test('current finish '+how+' / '+(saveFailure?'save error':'accepted save')+' keeps settlement identity and summary order',async()=>{
 const events=[],summaryName=code('ui','showSummary').actual;
 const run={state:'play',tower:null,timeScale:.5,stats:{captured:[1],shinies:[2],classics:[3]},seed:7,input:{releaseLock:()=>events.push('release')},result:()=>({mode:'standard',end:{how}}),meta:{endRun:async(result,progress)=>{events.push('endRun');assert.equal(result.end.how,how);assert.equal(progress.league[0],1);if(saveFailure)throw Error('offline fixture');return {record:{id:'accepted-fixture'}};}},ui:{saving:v=>events.push(v?'saving':'saved'),[summaryName]:(r,record,receipt,message)=>{assert.equal(r,run);events.push(message?'error-summary':'summary');}}};
 const finish=method('run','finish',{Is:()=>0,ja:()=>{}});await finish.call(run,how==='won');
 assert.equal(run.state,'over');assert.equal(run.sent,true);assert.equal(run.victory,how==='won');assert.equal(events.filter(e=>e==='endRun').length,1);assert.equal(events.at(-1),saveFailure?'error-summary':'summary');
 await finish.call(run,how==='won');assert.equal(events.filter(e=>e==='endRun').length,1);
});
for(const failure of ['none','blocked','local-full','server-offline'])test('current native save-and-quit '+failure+' only marks over after accepted suspension',async()=>{
 const events=[];const run={duel:null,state:'paused',stats:{},meta:{ticket:{id:'isolated-ticket'},account:{id:'isolated'},suspendRun:async()=>{events.push('suspend');if(failure==='server-offline')throw {offline:true};},uploadSave:async()=>{events.push('upload');return true;}},checkpoint:()=>events.push('checkpoint'),input:{releaseLock:()=>events.push('release')}};
 const save=method('run','saveAndQuitOnce',{U:tr,Xp:()=>failure==='blocked'?'native blocked':null,$p:()=>({cfg:{mode:'standard',biome:'forest'},v:1}),Hs:{},Kh:async()=>{events.push('local-save');return failure==='local-full'?null:{signed:'isolated'};},qh:()=>events.push('discard-invalid-local-save'),Jh:()=>({local:'isolated'}),ja:()=>{}});
 const result=await save.call(run);
 if(failure==='none'){assert.equal(result,null);assert.equal(run.state,'over');assert.equal(run.sent,true);assert.deepEqual(events,['checkpoint','local-save','suspend','upload','release']);}
 else {assert.equal(typeof result,'string');assert.equal(run.state,'paused');assert.notEqual(run.sent,true);assert.ok(!events.includes('release'));if(failure==='blocked')assert.deepEqual(events,[]);if(failure==='server-offline')assert.ok(events.includes('discard-invalid-local-save'));}
});
test('current native resume restores the same saved config and waits on meta.resumeRun before clearing its saved record',async()=>{
 const events=[],saved={save:{v:1,cfg:{mode:'standard',species:94,biome:'forest',tier:1,boosts:['old-boost']},result:{progress:{captured:[]}}},ticket:{id:'fixture-ticket'}};
 const updateName=rows.find(r=>r.role==='run'&&r.code.includes('nextLive')&&r.code.length<200)?.actual;
 const app={starting:false,meta:{account:{id:'isolated'},resumeRun:async(ticket,signature,progress,reason)=>{events.push(reason);assert.equal(ticket,saved.ticket);}},saved:()=>saved,launch:(cfg,offline)=>{events.push('launch');assert.equal(cfg.restore,saved.save);app.run=new Proxy({},{get:()=>()=>events.push('live-refresh')});},notice:()=>{throw Error('unexpected notice')},toMenu:()=>events.push('menu')};
 const resume=method('app','resumeSaved',{U:tr,rg:async()=>({signature:'local'}),eg:async()=>null,Zh:()=>null,qh:()=>events.push('clear-save-after-resume'),$h:()=>{},ja:()=>{},P:{deny(){}}});
 await resume.call(app);assert.equal(app.starting,false);assert.deepEqual(events.slice(0,3),['launch','resume','clear-save-after-resume']);assert.deepEqual(Array.from(app.lastCfg.boosts),[]);assert.equal(app.lastCfg.biome,'forest');
});
