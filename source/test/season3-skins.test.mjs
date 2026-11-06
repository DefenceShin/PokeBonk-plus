import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {selectUnlockGoal,masteryNormalSettlementState} from '../src/unlock-goals.mjs';
const catalog=JSON.parse(fs.readFileSync(new URL('../data/unlock-catalog.json',import.meta.url)));
test('current Johto mastery targets use native counters, goals and required actor',()=>{
 for(const [member,metric,goal]of [[152,'healed',30000],[155,'burned',30000],[251,'ultimates',100]]){
  const target=catalog.targets.find(t=>t.id===`achievements:lk${member}_1`);
  assert.ok(target,`current native look for ${member}`);
  const condition=target.requirements.find(t=>t.kind==='counter');
  assert.equal(condition.counter,`lk:${member}:1`);assert.equal(condition.goal,goal);assert.equal(condition.mastery.metric,metric);assert.equal(condition.mastery.member,member);
 }
 assert.equal(catalog.targets.filter(t=>/^appearance:skin-m[12]:/.test(t.id)).length,276);
});
test('reviewed recovery and Ultimate count challenges choose endless and finish only at native threshold',()=>{
 for(const [member,metric,goal]of [[152,'healed',30000],[251,'ultimates',100]]){
  const profile={league:[member],biomes:{forest:3},counters:{},cosmetics:[],quests:{}};
  const q=selectUnlockGoal(profile,catalog,{targetId:`appearance:skin-m1:${member}`,category:'appearance',confirmed:true,appearanceOptions:{countMode:'auto'}});
  assert.equal(q.status,'ready');assert.equal(q.action.mode,'endless');
  const g=q.action.normalFinishGoal;assert.ok(g);
  const r={mode:'endless',state:'play',tier:0,biome:{id:'forest'},time:120,startSpecies:member,player:{},meta:{snap:{counters:{[metric]:10}},profile:{counters:{[metric]:goal+9}}}};
  assert.equal(masteryNormalSettlementState(r,g,catalog.sourceHash).met,false);
  r.meta.profile.counters[metric]++;assert.equal(masteryNormalSettlementState(r,g,catalog.sourceHash).met,true);
 }
});
test('Johto map and nightmare victories retain their native route',()=>{
 const profile={league:[161,155],biomes:{forest:3,encina:3,iris:3},counters:{},cosmetics:[],quests:{}};
 const one=selectUnlockGoal(profile,catalog,{targetId:'appearance:skin-m1:161',confirmed:true,appearanceOptions:{countMode:'endless'}});
 assert.equal(one.action.mode,'standard');assert.equal(one.action.biome,'encina');
 profile.counters['lk:161:1']=1;
 const two=selectUnlockGoal(profile,catalog,{targetId:'appearance:skin-m1:161',confirmed:true,appearanceOptions:{countMode:'endless'}});
 assert.equal(two.action.biome,'iris');
 profile.counters['lk:161:1']=2;
 const onlyIris=selectUnlockGoal(profile,catalog,{targetId:'appearance:skin-m1:161',confirmed:true,appearanceOptions:{countMode:'endless'}});
 assert.equal(onlyIris.action.kind,'pursue-counter');assert.equal(onlyIris.action.biome,'encina','a bit mask of 2 is one map, not two completed maps');
 const win=selectUnlockGoal(profile,catalog,{targetId:'appearance:skin-m2:155',confirmed:true,appearanceOptions:{countMode:'endless'}});
 assert.equal(win.action.mode,'standard');assert.equal(win.action.tier,2);assert.deepEqual(win.action.mastery.constraints.finalSpecies,[157]);assert.equal(win.action.normalFinishGoal,undefined);
});
test('current legendary outfits preserve their solo, survival and distinct-map conditions',()=>{
 const p={league:[144],biomes:{forest:3,desert:3,coast:3,glacier:3,canela:3,cave:3,encina:3,iris:3},counters:{},cosmetics:[],quests:{}};
 const q=key=>selectUnlockGoal(p,catalog,{targetId:'appearance:skin-'+key+':144',category:'appearance',confirmed:true,advanceOnComplete:false,appearanceOptions:{countMode:'auto'}});
 assert.equal(q('l1').status,'ready');assert.equal(q('l1').action.biome,'glacier');assert.equal(q('l1').action.tier,2);assert.equal(q('l1').action.mastery.constraints.maxHits,100);
 assert.equal(q('l2').action.mode,'endless');assert.equal(q('l2').action.goal,2400);
 p.counters['lk:144:7']=31;assert.equal(q('l3').action.kind,'pursue-counter');assert.equal(q('l3').action.biome,'cave');
 p.counters['lk:144:7']=63;assert.equal(q('l3').action.kind,'claim-quest');
});
test('legendary survival stops at 2400 seconds only in its solo endless route',()=>{
 const p={league:[144],biomes:{forest:3},counters:{},cosmetics:[],quests:{}};
 const q=selectUnlockGoal(p,catalog,{targetId:'appearance:skin-l2:144',confirmed:true});
 const g=q.action.normalFinishGoal;
 const run={mode:'endless',state:'play',tier:g.tier,biome:{id:g.biome},time:2399.99,startSpecies:144,player:{}};
 assert.equal(masteryNormalSettlementState(run,g,catalog.sourceHash).met,false);
 run.time=2400;assert.equal(masteryNormalSettlementState(run,g,catalog.sourceHash).met,true);
 run.coop={};assert.equal(masteryNormalSettlementState(run,g,catalog.sourceHash).active,false);
 delete run.coop;run.mode='standard';assert.equal(masteryNormalSettlementState(run,g,catalog.sourceHash).active,false);
});
test('appearance keeps the selected standard route and natural-end preference',()=>{
 const p={league:[152],biomes:{forest:3},counters:{},cosmetics:[],quests:{}};
 const q=selectUnlockGoal(p,catalog,{targetId:'appearance:skin-m1:152',confirmed:true,appearanceOptions:{countMode:'standard',settleOnGoal:false}});
 assert.equal(q.action.mode,'standard');assert.equal(q.action.appearanceCounting.settleOnGoal,false);
});
