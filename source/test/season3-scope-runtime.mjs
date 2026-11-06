import fs from 'node:fs';import assert from 'node:assert/strict';import {openSeason3Fixture} from './season3-browser-fixture.mjs';
const f=await openSeason3Fixture('scope-plans');try{const results=await f.page.evaluate(()=>{
 const p=__PB_PILOT,b=__PB_BRIDGE,out=[];Object.assign(b.app.meta.profile.biomes,{forest:2,desert:2,coast:2,glacier:2,canela:2,cave:2,encina:2,iris:2,graveyard:2,wilds:2});
 for(const mode of ['resources','map'])for(const biome of ['forest','desert','coast','glacier'])for(const tier of [0,1,2]){
  b.app.run=null;p.plan=null;p.settings.mode=mode;p.settings.modeSettings={[mode]:{biome,tier}};const plan=p.makePlan();out.push({mode,biome,tier,result:{mode:plan.mode,biome:plan.biome,tier:plan.tier,goalMode:plan.goalMode}});
 }
 const r=__M2_MAKE_RUN();p.settings.mode='autoManage';p.plan=null;const managed=p.start();out.push({managed,mode:'autoManage',preserving:p.autoManagePreserving(r),result:{mode:p.plan?.mode,biome:p.plan?.biome,tier:p.plan?.tier},sameRun:b.app.run===r});
 return out;
});fs.writeFileSync(new URL('evidence/scope-plans-result.json',f.task),JSON.stringify(results,null,2));for(const x of results){assert.equal(x.result.mode,'standard');assert.ok(['forest','desert','coast','glacier'].includes(x.result.biome));assert.ok([0,1,2].includes(x.result.tier));if(x.mode==='autoManage'){assert.equal(x.managed,true);assert.equal(x.preserving,true);assert.equal(x.sameRun,true);}else{assert.equal(x.result.biome,x.biome);assert.equal(x.result.tier,x.tier);}}
assert.deepEqual(f.errors,[]);console.log('PASS actual resources/map planners retain 24 fixed native routes in M2 range; autoManage starts on the same supported run while preserving loadout');}finally{await f.context.close();}
