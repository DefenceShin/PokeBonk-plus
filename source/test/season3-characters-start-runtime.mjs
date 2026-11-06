import fs from 'node:fs';import assert from 'node:assert/strict';import {openSeason3Fixture} from './season3-0913-browser-fixture.mjs';
const f=await openSeason3Fixture('characters-start-linked',{characterUnlockImplementation:'legacy160',unlockCatalog:JSON.parse(fs.readFileSync(new URL('../data/unlock-catalog.json',import.meta.url)))});
try{const result=await f.page.evaluate(async()=>{
 const p=__PB_PILOT,app=__PB_BRIDGE.app,meta=app.meta,out=[];
 for(const scenario of ['saved','refused','accepted']){
  app.run=null;p.enabled=false;p.nextStartAt=0;p.starting=false;p.plan=null;p.settings.autoRestart=true;
  let opens=0,offered=0;const saved={ticket:{id:'keep-fixture'},save:{v:1,cfg:{mode:'standard',species:1,biome:'forest',tier:0}}};
  app.saved=()=>scenario==='saved'?saved:null;app.offerSaved=()=>offered++;
  app.openRun=async cfg=>{opens++;if(scenario==='accepted'){__M2_MAKE_RUN(cfg.species);return true;}return false;};
  p.settings.mode='characters';p.settings.characterId=1;p.settings.modeSettings.characters={biome:'forest',tier:0};p.settings.unlockTargets={characters:'characters:4'};meta.profile.counters={runs:2};p.confirmNativeProfileOrigin(meta.profile,app,meta,meta.account);p.commitUnlockProfile(meta.profile,'native-test-receipt');p.unlockSelectionKey=null;
  const started=p.start();await p.macro();out.push({scenario,started,opens,offered,run:!!app.run,status:p.status,health:p.health?.state,savedStill:scenario==='saved'&&app.saved()===saved});
 }
 return out;
});fs.writeFileSync(new URL('evidence/characters-start-linked-result.json',f.task),JSON.stringify(result,null,2));for(const x of result){assert.equal(x.opens,x.scenario==='saved'?0:1,x.scenario);if(x.scenario==='saved'){assert.equal(x.savedStill,true);assert.equal(x.run,false);}else assert.equal(x.run,x.scenario==='accepted');}assert.deepEqual(f.errors,[]);console.log('PASS character mode manual Pilot actual planner/start/macro -> actual App.startRun preserves native saved game, handles refused start, attaches accepted native run');}finally{await f.context.close();}
