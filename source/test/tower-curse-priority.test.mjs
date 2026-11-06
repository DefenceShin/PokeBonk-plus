import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseTowerCurseAction,chooseOfferAction} from '../src/choice-strategy.mjs';
import {fixture,sandbox} from './benefit-fixture.mjs';

const run={tower:{floor:69}}, offers=['hunger','dark','graves','swift','twin'].map(id=>({id}));
test('custom curse priority wins over automatic weights and native card order',()=>{
  const priority=['twin','swift','graves','dark','hunger','iron'];
  const before=structuredClone({run,offers,priority});
  assert.equal(chooseTowerCurseAction(offers,run,{cursePriority:priority}).id,'twin');
  assert.equal(chooseTowerCurseAction([...offers].reverse(),run,{cursePriority:priority}).id,'twin');
  assert.deepEqual({run,offers,priority},before);
});
test('priority skips absent, hidden, disabled, unknown and native illegal cards',()=>{
  const cards=[{id:'unknown'},{id:'twin',disabled:true},{id:'swift',hidden:true},{id:'graves'},{id:'dark'},{id:'hunger'}];
  const d=chooseTowerCurseAction(cards,run,{cursePriority:['unknown','iron','twin','swift','graves','dark','hunger'],legal:i=>i!==3});
  assert.equal(d.id,'dark');assert.equal(d.index,4);
});
test('partial priorities append known curses and malformed priorities keep automatic behavior',()=>{
  assert.equal(chooseTowerCurseAction(offers,run,{cursePriority:['swift','swift',null,'unknown']}).id,'swift');
  assert.equal(chooseTowerCurseAction([{id:'hunger'},{id:'dark'}],run,{cursePriority:['swift']}).id,'hunger');
  for(const cursePriority of [undefined,null,'auto',{},[],['unknown']])
    assert.equal(chooseTowerCurseAction(offers,run,{cursePriority}).id,'hunger');
});
test('iron priority cannot bypass unknown or failed payback and still falls back legally',()=>{
  const cursePriority=['iron','twin','hunger','dark','graves','swift'];
  assert.equal(chooseTowerCurseAction([{id:'iron'},{id:'hunger'},{id:'twin'}],run,{cursePriority}).id,'twin');
  assert.equal(chooseTowerCurseAction([{id:'iron'}],run,{cursePriority}).action,'leave');
});
test('iron may lead only when the existing payback algorithm accepts it',()=>{
  const h=fixture();h.data.items=new Map([['expert-belt',{key:'expert-belt',rarity:3,max:10,mods:[{stat:'damage',mul:1.2}]}]]);
  sandbox.Kn=h.data.items;h.player.level=100;
  Object.assign(h.data.data,{hasSprite:()=>true,get:()=>({bst:500})});
  Object.assign(h.nativeRun,{tower:{floor:69},time:600,stage:4,tier:0,diff:{enemyAmount:1},combat:{meter:{dps:1e16}},
    meta:{itemInPool:()=>true},banished:new Set(),tempMods:[],dpsLog:{times:[585,600],rows:[{hit:0,'#other':0,'#ult':0,'#allies':0},{hit:1e10,'#other':0,'#ult':0,'#allies':0}]}});
  h.player.recompute();
  const options={data:h.data,build:h.build,cursePriority:['iron','twin','hunger','dark','graves','swift']},cards=[{id:'hunger'},{id:'iron'},{id:'twin'}];
  const accepted=chooseTowerCurseAction(cards,h.nativeRun,options);
  assert.equal(accepted.payback.accept,true);assert.equal(accepted.id,'iron');
  h.nativeRun.time=21599;
  const rejected=chooseTowerCurseAction(cards,h.nativeRun,options);
  assert.equal(rejected.payback.accept,false);assert.equal(rejected.id,'twin');
});

test('tower blessing experience toggle ranks damage then experience',()=>{
  const h=fixture();h.nativeRun.tower={floor:30};
  const xp={mods:[{stat:'xpGain',mul:1.01}]},damage={mods:[{stat:'damage',mul:1.00001}]},armor={mods:[{stat:'armor',add:100000}]};
  const opts={kind:'blessing',experienceBlessingPriority:true};
  assert.equal(chooseOfferAction([armor,xp,damage],h,h.data,opts).index,2);
  assert.equal(chooseOfferAction([armor,xp],h,h.data,opts).index,1);
  assert.equal(chooseOfferAction([armor,xp],h,h.data,{kind:'blessing'}).index,0);
  assert.equal(chooseOfferAction([armor,xp],h,h.data,{...opts,experienceBlessingPriority:false}).index,0);
  assert.equal(chooseOfferAction([armor,xp,damage],h,h.data,{...opts,legal:i=>i===0}).index,0);
});
test('experience blessing toggle has no effect on other modes or upgrades',()=>{
  const h=fixture();const cards=[{mods:[{stat:'armor',add:100000}]},{mods:[{stat:'xpGain',mul:1.01}]}];
  assert.equal(chooseOfferAction(cards,h,h.data,{kind:'blessing',experienceBlessingPriority:true}).index,0);
  h.nativeRun.tower={floor:30};
  assert.equal(chooseOfferAction(cards,h,h.data,{kind:'upgrade',experienceBlessingPriority:true}).index,1);
});
test('experience preference never restores an attack-speed blessing rejected by native saturation',()=>{
  const h=fixture({speed:1e9});h.nativeRun.tower={floor:30};
  const speed={mods:[{stat:'attackSpeed',mul:1.2}]},xp={mods:[{stat:'xpGain',mul:1.1}]};
  const d=chooseOfferAction([speed,xp],h,h.data,{kind:'blessing',experienceBlessingPriority:true});
  assert.equal(d.index,1);assert.equal(d.candidates.some(c=>c.index===0),false);
  assert.equal(chooseOfferAction([speed],h,h.data,{kind:'blessing',experienceBlessingPriority:true}).action,'wait');
});
test('experience preference preserves zero area value after covering the tower arena',()=>{
  const h=fixture({moves:[{def:{key:'coverage',arch:'strike',dmg:100,cls:'physical',cd:1,area:3},mods:{},level:8}]});
  h.nativeRun.tower={floor:30};h.nativeRun.terrain={arenaR:31};h.nativeRun.tempMods.push({stat:'area',mul:100});h.player.recompute();
  const d=chooseOfferAction([{mods:[{stat:'area',mul:1.2}]},{mods:[{stat:'xpGain',mul:1.1}]}],h,h.data,{kind:'blessing',experienceBlessingPriority:true});
  assert.equal(d.index,1);assert.equal(d.candidates.find(c=>c.index===0).rawScore,0);
});
