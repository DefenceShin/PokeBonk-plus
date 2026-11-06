import fs from 'node:fs';import assert from 'node:assert/strict';import {openSeason3Fixture} from './season3-0913-browser-fixture.mjs';
const f=await openSeason3Fixture('skin-routes',{unlockCatalog:JSON.parse(fs.readFileSync(new URL('../data/unlock-catalog.json',import.meta.url)))});
try{const result=await f.page.evaluate(()=>{const p=__PB_PILOT,b=__PB_BRIDGE,m=b.app.meta,base=JSON.parse(JSON.stringify(m.profile)),rows=[];
 for(const mode of ['appearance','wardrobe'])for(const species of [7,152,170,251]){
  b.app.run=null;p.run=null;p.plan=null;m.profile={...JSON.parse(JSON.stringify(base)),league:b.roster.map(r=>r.id),biomes:Object.fromEntries(b.biomes.map(r=>[r.id,3])),counters:{},cosmetics:[],quests:{}};
  p.confirmNativeProfileOrigin(m.profile,b.app,m,m.account);p.commitUnlockProfile(m.profile,'native-fixture');
  p.settings.mode=mode;p.settings.characterId=0;p.settings.autoClaim=false;p.settings.unlockTargets={appearance:`appearance:skin-m1:${species}`};
  p.settings.modeSettings[mode]={species,look:'m1',biome:'auto',tier:'auto',countMode:'auto'};p.unlockSelectionKey=null;
  const q=p.makePlan();p.plan=q;p.enabled=true;const menuAllowed=p.automationAllowed();
  const run=__M2_MAKE_RUN(species);Object.assign(run,{mode:q.mode,endless:q.mode==='endless',biome:b.biomes.find(r=>r.id===q.biome),tier:q.tier});p.plan=q;p.planRun=run;p.enabled=true;
  rows.push({mode,species,status:q.goalProgress?.status,metric:q.mastery?.metric,route:q.mode,actor:q.species,automatable:q.automatable,menuAllowed,liveAllowed:p.automationAllowed(),preferred:q.buildPreferences,need:q.needs});
 }
 const run=__M2_MAKE_RUN(1);run.mode='endless';run.endless=true;p.plan={goalMode:'resources'};p.enabled=true;const unrelatedEndless=p.automationAllowed();
 return{rows,scope:b.compatibility.maintenanceScope,unrelatedEndless};});
 fs.writeFileSync(new URL('evidence/skin-routes.json',f.task),JSON.stringify(result,null,2));
 for(const row of result.rows){assert.equal(row.status,'ready',JSON.stringify(row));assert.equal(row.route,'endless',JSON.stringify(row));assert.equal(row.actor,row.species);assert.notEqual(row.automatable,false,JSON.stringify(row));assert.equal(row.menuAllowed,true,JSON.stringify(row));assert.equal(row.liveAllowed,true,JSON.stringify(row));}
 assert.equal(result.unrelatedEndless,false);assert.deepEqual(f.errors,[]);console.log('PASS 8 current native appearance/wardrobe quantity routes and mode boundaries');
}finally{await f.context.close();}
