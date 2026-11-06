import fs from 'node:fs';
import assert from 'node:assert/strict';
import {openSeason3Fixture} from './season3-browser-fixture.mjs';
const {page,context,errors,task}=await openSeason3Fixture('settlement-link');
try{
 const results=await page.evaluate(async()=>{
  const out=[];
  for(const how of ['won','died'])for(const failure of [false,true]){
   const r=__M2_MAKE_RUN(),p=__PB_PILOT,app=__PB_BRIDGE.app,meta=app.meta;let resolve,reject,menus=0,starts=0;
   const pending=new Promise((a,b)=>{resolve=a;reject=b});
   meta.endRun=()=>pending;meta.hasPending=()=>failure;meta.ticket={id:'fixture-'+how+failure};p.observeSaves();
   const result={mode:'standard',biome:'forest',tier:0,species:1,victory:how==='won',time:120,kills:10,end:{how}};
   r.result=()=>result;r.ui.saving=()=>{};r.ui.$1x6vr3r=()=>{};r.finish=__M2_TYPES.run.prototype.finish;
   app.toMenu=()=>{menus++;app.run=null};app.startRun=async()=>{starts++;return false};
   p.settings.autoRestart=false;p.plan.goalMode='resources';p.damageLog=[];
   const finishing=r.finish(how==='won');
   await p.macro();const during={savePending:p.savePending,menus,starts,state:r.state};
   if(failure)reject(Error('isolated native save failure'));else resolve({stardust:0,tasks:[],profile:meta.profile});
   await finishing;await p.macro();
   out.push({how,failure,during,sent:r.sent,menus,starts,enabled:p.enabled,status:p.status,events:p.events.filter(e=>e.kind==='settlement').map(e=>({saved:e.saved,victory:e.victory,endHow:e.endHow}))});
  }return out;
 });
 fs.writeFileSync(new URL('evidence/settlement-linked-result.json',task),JSON.stringify(results,null,2));
 for(const x of results){assert.equal(x.during.savePending,true);assert.equal(x.during.menus,0);assert.equal(x.during.starts,0);assert.equal(x.starts,0);assert.equal(x.events.at(-1)?.saved,!x.failure);if(x.failure){assert.equal(x.menus,0);assert.equal(x.sent,true);}else{assert.equal(x.menus,1);assert.equal(x.enabled,false);}}
 assert.deepEqual(errors,[]);console.log('PASS Pilot observes current native finish and waits actual receipt on win/loss, pending/error cannot restart; autoRestart false stops after accepted settlement');
}finally{await context.close();}
