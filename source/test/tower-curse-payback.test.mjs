import test from 'node:test';
import assert from 'node:assert/strict';
import * as choices from '../src/choice-strategy.mjs';
import {fixture,sandbox} from './benefit-fixture.mjs';

function setup({floor=69,time=600,dps=1e17,gain=.2}={}) {
  const h=fixture();
  h.data.items=new Map([['expert-belt',{key:'expert-belt',rarity:3,max:10,mods:[{stat:'damage',mul:1+gain}]}]]);
  sandbox.Kn=h.data.items;
  h.player.level=100;
  Object.assign(h.data.data,{hasSprite:()=>true,get:()=>({bst:500})});
  Object.assign(h.nativeRun,{tower:{floor},time,stage:4,tier:0,diff:{enemyAmount:1},combat:{meter:{dps}},
    meta:{itemInPool:()=>true},banished:new Set(),tempMods:[],dpsLog:{times:[time-15,time],
      rows:[{hit:0,'#other':0,'#ult':0,'#allies':0},{hit:1e10,'#other':0,'#ult':0,'#allies':0}]}});
  h.player.recompute();
  h.choose=(offers=[{id:'iron'}])=>choices.chooseTowerCurseAction(offers,h.nativeRun,{data:h.data,build:h.build});
  return h;
}

test('late tower keeps no-HP-cost curses; iron no longer wins merely by fixed priority',()=>{
  for(const floor of [65,66,79,90])for(const id of ['hunger','dark','graves','swift','twin'])
    assert.equal(choices.chooseTowerCurseAction([{id}],{tower:{floor}}).id,id);
  assert.equal(choices.chooseTowerCurseAction([{id:'iron'},{id:'dark'}],{tower:{floor:60}}).id,'dark');
});

test('same current kit and next-floor enemies accept early payback and reject a near-deadline loss',()=>{
  const early=setup({dps:1e16}),late=setup({time:21599,dps:1e16});
  assert.equal(early.choose().id,'iron');
  assert.equal(late.choose().action,'leave');
  assert.equal(early.choose().payback.targetFloor,70);
  assert(early.choose().payback.reward.expectedGain>0);
  assert.equal(early.choose().payback.previousFloorTimeUsed,false);
});

test('target floor projection responds to actual HP scaling, output and boss rotation, never stageTime',()=>{
  assert.equal(typeof choices.projectTowerFloor,'function');
  const h=setup({floor:76,dps:1e15}),p=()=>choices.projectTowerFloor(h.nativeRun,h.data);
  const a=p();assert.equal(a.guardian.kind,'boss');assert.equal(a.guardian.id,105);
  assert.equal(a.waves[2].count,0);assert.equal(a.waves[0].count,120);
  h.nativeRun.stageTime=1e8;assert.deepEqual(p(),a);
  h.nativeRun.tower.floor=77;const b=p();assert(b.waves[0].meanHp>a.waves[0].meanHp*1.5);
  h.nativeRun.combat.meter.dps*=2;assert(p().seconds.serial<b.seconds.serial);
});

test('HP penalty is next-floor only and native guardian limit prevents instant kills',()=>{
  assert.equal(typeof choices.projectTowerFloor,'function');
  const h=setup({floor:76,dps:1e30});
  const a=choices.projectTowerFloor(h.nativeRun,h.data),b=choices.projectTowerFloor(h.nativeRun,h.data,{hp:1.4});
  assert.equal(a.guardian.capSeconds,35);assert(a.guardian.seconds>=32);
  assert(Math.abs(b.waves[0].meanHp/a.waves[0].meanHp-1.4)<1e-10);
  h.nativeRun.tower.floorCurse='iron';assert.deepEqual(choices.projectTowerFloor(h.nativeRun,h.data),a);
});

test('one random epic reward preserves native probabilities and counts disallowed results as zero benefit',()=>{
  const h=setup();
  h.data.items.set('defense',{key:'defense',rarity:4,max:10,mods:[{stat:'armor',add:1}]});
  let r=h.choose().payback.reward;
  assert.equal(r.outcomes.length,2);assert(Math.abs(r.outcomes.reduce((s,x)=>s+x.probability,0)-1)<1e-12);
  const strong=r.outcomes.find(x=>x.key==='expert-belt');assert(strong.gain>0);
  h.build.avoidItems=['expert-belt'];r=h.choose().payback.reward;
  assert.equal(r.outcomes.find(x=>x.key==='expert-belt').probability,strong.probability);
  assert.equal(r.expectedGain,0);assert.equal(h.choose().action,'leave');
});

test('capped and banished epic pools become unpriced gold, not imaginary lower-rarity rewards',()=>{
  const h=setup();h.player.items.set('expert-belt',10);h.player.recompute();
  assert.equal(h.choose().action,'leave');assert.equal(h.choose().payback.reward.reason,'epic-pool-exhausted-gold-unpriced');
  h.player.items.clear();h.nativeRun.banished.add('iexpert-belt');
  assert.equal(h.choose().payback.reward.reason,'epic-pool-exhausted-gold-unpriced');
});

test('hunger adds .2 to the temporary damage bucket rather than multiplying every copy by 1.2',()=>{
  const h=setup();h.nativeRun.tempMods=[{stat:'damage',mul:3}];h.player.recompute();
  const d=h.choose([{id:'hunger'}]);assert(Math.abs(d.hunger.relativeDamageGain-.2/3)<1e-12);
  assert.equal(d.hunger.hpPenalty,1);assert.equal(d.id,'hunger');
});

test('missing output or species is explicit unknown and evaluation never consumes native RNG or changes the run',()=>{
  const h=setup(),before={items:[...h.player.items],mods:structuredClone(h.nativeRun.tempMods)};
  const old=Math.random;Math.random=()=>{throw Error('RNG must not run');};
  try {assert.deepEqual(h.choose(),h.choose());} finally {Math.random=old;}
  assert.deepEqual({items:[...h.player.items],mods:h.nativeRun.tempMods},before);
  h.nativeRun.combat.meter.dps=0;assert.equal(h.choose().payback.reason,'current-output-unavailable');
  h.nativeRun.combat.meter.dps=1e17;h.data.data.get=()=>null;
  assert.equal(h.choose().payback.reason,'target-species-unavailable');
});

test('fixed-timer and other damage cannot inherit the full player move speed reward',()=>{
  const h=setup({time:21000,dps:1e16});
  h.data.items.clear();h.data.items.set('max-elixir',{key:'max-elixir',rarity:3,max:10,mods:[{stat:'attackSpeed',mul:1.2}]});
  h.player.items.set('electirizer',3);h.player.recompute();
  h.nativeRun.dpsLog={times:[20985,21000],rows:[{hit:0,'#other':0,'#ult':0,'#allies':0},
    {hit:1e10,'#other':9e10,'#ult':0,'#allies':0}],rates(){throw Error('must not mutate native rates/born');}};
  const before=JSON.stringify(h.nativeRun.dpsLog);
  const d=h.choose();assert.equal(d.action,'leave');
  assert(Math.abs(d.payback.reward.expectedGain-.02)<1e-10);
  assert.equal(d.payback.reward.attribution.playerMoveShare,.1);
  assert.equal(JSON.stringify(h.nativeRun.dpsLog),before);
});

test('missing, stale and reset output shares do not silently become 100 percent player damage',()=>{
  const h=setup();
  delete h.nativeRun.dpsLog;assert.equal(h.choose().payback.reward.expectedGain,0);
  h.nativeRun.dpsLog={times:[560,575],rows:[{hit:0,'#other':0},{hit:10,'#other':90}]};
  assert.equal(h.choose().payback.reward.expectedGain,0);
  h.nativeRun.dpsLog={times:[585,600],rows:[{hit:20,'#other':0},{hit:10,'#other':90}]};
  assert.equal(h.choose().payback.reward.expectedGain,0);
});
