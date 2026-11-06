import fs from 'node:fs';
import {openSeason3Fixture} from './source/test/season3-0913-browser-fixture.mjs';
const f=await openSeason3Fixture('skin-audit',{unlockCatalog:JSON.parse(fs.readFileSync(new URL('source/data/unlock-catalog.json',import.meta.url)))});
try {
 const result=await f.page.evaluate(()=>{
  const p=__PB_PILOT,b=__PB_BRIDGE,m=b.app.meta,c=p.getUnlockCatalog();
  const methods={};for(const k of Object.getOwnPropertyNames(Object.getPrototypeOf(m)))if(/quest|endRun|counter|claim/i.test(k)&&typeof m[k]==='function')methods[k]=String(m[k]);
  m.profile={...m.profile,league:b.roster.map(r=>r.id),biomes:Object.fromEntries(b.biomes.map(r=>[r.id,3])),cosmetics:[],counters:{},quests:{},shiny:[],classics:[]};
  p.confirmNativeProfileOrigin(m.profile,b.app,m,m.account);p.commitUnlockProfile(m.profile,'audit-fixture');
  const plans=[];for(const t of c.targets.filter(t=>/^appearance:skin-m[12]:/.test(t.id))){
   p.settings.mode='appearance';p.settings.characterId=0;p.settings.unlockTargets={appearance:t.id};p.settings.modeSettings.appearance={biome:'auto',tier:'auto',countMode:'auto'};p.unlockSelectionKey=null;
   const q=p.makePlan();plans.push({id:t.id,name:t.name,action:q.unlockAction,status:q.goalProgress?.status,mode:q.mode,species:q.species,automatable:q.automatable,need:q.need});
  }
  return {scope:b.compatibility.maintenanceScope,methods,catalog:c,plans,roster:b.roster};
 });
 fs.writeFileSync(new URL('evidence/skin-audit.json',import.meta.url),JSON.stringify({result,errors:f.errors},null,2));
 const counts={};for(const p of result.plans){const key=[p.status,p.mode,p.action?.mastery?.metric,p.action?.kind].join('/');counts[key]=(counts[key]||0)+1;}
 console.log(JSON.stringify({targets:result.plans.length,counts,waiting:result.plans.filter(p=>p.status!=='ready'),errors:f.errors},null,2));
}finally{await f.context.close();}
