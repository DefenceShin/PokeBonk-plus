import test from 'node:test';
import assert from 'node:assert/strict';
import * as choices from '../src/choice-strategy.mjs';

function towerFixture() {
  const definitions=[
    {id:1,key:'first',arch:'bolt',type:'water',cls:'special',dmg:12,cd:1,count:1},
    {id:2,key:'second',arch:'wave',type:'water',cls:'special',dmg:25,cd:1.5,count:1},
    {id:3,key:'unwanted',arch:'bolt',type:'normal',cls:'physical',dmg:90,cd:1,count:1},
  ];
  const data={moves:new Map(definitions.map(d=>[d.id,d])),movesByKey:new Map(definitions.map(d=>[d.key,d])),
    vitamins:new Map([
      ['ether',{key:'ether',stat:'attackSpeed',per:.08,kind:'mul'}],
      ['carbos',{key:'carbos',stat:'moveSpeed',per:.07,kind:'mul'}],
      ['protein',{key:'protein',stat:'physical',per:.1,kind:'mul'}],
    ]),items:new Map(),rarityMultipliers:[1,1.2,1.45,1.75,2.1],
    moveGuide:()=>({kit:definitions.map(d=>({id:d.id,level:1})),line:[],shared:[]})};
  const player={speciesId:7,level:35,hp:100,maxHp:100,types:['water'],moveSlots:2,vitaminSlots:2,moveCap:8,vitCap:10,
    capOf(move){return move.def.arch==='fusion'?5:this.moveCap;},
    moves:definitions.slice(0,2).map(def=>({def,level:8,mods:{}})),
    vitamins:new Map([['ether',{level:10}],['carbos',{level:10}]]),items:new Map(),
    stats:{moveSpeed:1,attackSpeed:1,armor:0,regen:0,healing:1,projectiles:0}};
  const nativeRun={player,startSpecies:7,tower:{floor:8,beyond:true,curses:[]},banished:new Set(),banishes:1,skips:2,rerolls:2};
  const settings={finalReplacements:{7:{moves:{enabled:true,level:30,targets:['first','second']},
    vitamins:{enabled:true,level:30,targets:['ether','carbos']},fusion:{enabled:false,targets:[]}}}};
  const context=()=>({player,nativeRun,build:{moves:['first','second']},finalReplacement:choices.finalReplacementState(settings,nativeRun,data)});
  return {player,nativeRun,settings,data,context};
}

test('tower upgrade selection accepts a requested move or vitamin before any search action',()=>{
  const h=towerFixture();h.player.moves[0].level=1;h.player.moves[1]=null;h.player.vitamins.delete('carbos');
  const options={kind:'upgrade',banishLegal:true,rerollLegal:true,skipLegal:true};
  const unrelated={kind:'newMove',id:3,key:'m3',rarity:4};
  for(const wanted of [{kind:'newMove',id:2,key:'m2',rarity:0},{kind:'newVit',vit:'carbos',key:'vcarbos',rarity:0},
    {kind:'upMove',slot:0,key:'m1',rarity:0,ups:[{key:'dmg',value:.1}]}]){
    const result=choices.chooseOfferAction([unrelated,wanted],h.context(),h.data,options);
    assert.equal(result.action,'choose');assert.equal(result.index,1);
  }
});

test('missing tower targets use native search resources and preserve explicit restrictions when exhausted',()=>{
  const h=towerFixture();h.player.moves[1]=null;h.player.vitamins.delete('carbos');
  const offers=[{kind:'newMove',id:3,key:'m3',rarity:4},{kind:'newVit',vit:'protein',key:'vprotein',rarity:4}];
  const options={kind:'upgrade',banishLegal:true,rerollLegal:true,skipLegal:true,history:{rerollsThisPage:0,unplannedRounds:0}};
  const pick=()=>choices.chooseOfferAction(offers,h.context(),h.data,options);
  assert.equal(pick().action,'banish');assert.equal(pick().index,1,'the lower-valued unwanted vitamin is also removable');
  h.nativeRun.banishes=0;assert.equal(pick().action,'skip');
  h.nativeRun.skips=0;assert.equal(pick().action,'reroll','remaining native rerolls are not stopped by the old two-per-page limit');
  h.nativeRun.rerolls=0;assert.equal(pick().action,'restart','exit after native search is exhausted');
});

test('tower search banishes an unwanted vitamin when no unwanted skill is offered',()=>{
  const h=towerFixture();h.player.moves[1]=null;h.player.vitamins.delete('carbos');
  const result=choices.chooseOfferAction([{kind:'newVit',vit:'protein',key:'vprotein',rarity:4}],h.context(),h.data,
    {kind:'upgrade',banishLegal:true,rerollLegal:true,skipLegal:true});
  assert.equal(result.action,'banish');assert.equal(result.index,0);
});

test('tower protects fusion parents that are already ready and never uses an off-target retry',()=>{
  const h=towerFixture();h.player.moves[1]=null;h.player.moveCap=10;
  const final=h.context().finalReplacement;
  final.fusion={enabled:true,active:true,targets:['fusion-goal'],assignments:[{parents:['first','second']}],
    pending:{parents:['first','second'],needLearn:['second'],needUpgrade:[],learningOrder:['second'],relearnSlots:[],available:true}};
  const context={...h.context(),finalReplacement:final};
  final.moves.enabled=false;final.vitamins.enabled=false;
  const options={kind:'upgrade',banishLegal:true,skipLegal:true,rerollLegal:true};
  const onlyReadyParent=[{kind:'upMove',slot:0,key:'m1',rarity:4,ups:[]}];
  assert.equal(choices.chooseOfferAction(onlyReadyParent,context,h.data,options).action,'choose',
    'ready ingredients can keep improving while waiting for the fusion machine');
  const offers=[{kind:'newMove',id:3,key:'m3',rarity:4},{kind:'newMove',id:2,key:'m2',rarity:0}];
  const decision=choices.chooseOfferAction(offers,context,h.data,options);
  assert.equal(decision.index,1);assert.deepEqual(decision.candidates.map(row=>row.index),[1]);
});

test('tower does not restart finished targets or invent strict goals from generic automatic preferences',()=>{
  const h=towerFixture(),offers=[{kind:'newMove',id:3,key:'m3',rarity:0}];
  h.nativeRun.rerolls=0;h.nativeRun.skips=0;h.nativeRun.banishes=0;
  assert.notEqual(choices.chooseOfferAction(offers,h.context(),h.data).action,'restart');
  h.player.moves[1]=null;
  assert.notEqual(choices.chooseOfferAction(offers,{player:h.player,nativeRun:h.nativeRun,build:{moves:['second']}},h.data).action,'restart');
});

test('tower waits for unknown native counters rather than treating missing data as exhausted',()=>{
  const h=towerFixture();h.player.moves[1]=null;delete h.nativeRun.banishes;delete h.nativeRun.skips;delete h.nativeRun.rerolls;
  const decision=choices.chooseOfferAction([{kind:'newMove',id:3,key:'m3',rarity:0}],h.context(),h.data,{kind:'upgrade'});
  assert.equal(decision.action,'wait');
});

function stagedFusionFixture({slots=4,finalMoves=false,threshold=1}={}) {
  const h=towerFixture();
  const defs=[
    {id:4,key:'third',arch:'buff',type:'normal',cls:'special',dmg:0,cd:4},
    {id:5,key:'parent-a',arch:'wave',type:'water',cls:'special',dmg:12,cd:2},
    {id:6,key:'parent-b',arch:'beam',type:'normal',cls:'special',dmg:20,cd:3},
    {id:50001,key:'fusion-goal',arch:'fusion',type:'water',cls:'special',dmg:90,cd:3},
  ];
  for(const def of defs){h.data.moves.set(def.id,def);h.data.movesByKey.set(def.key,def);}
  h.data.moveGuide=()=>({kit:[...h.data.moves.values()].filter(d=>d.id<50000).map(d=>({id:d.id,level:1,open:true})),line:[],shared:[]});
  h.data.fusionRecipes=[{key:'fusion-goal',id:50001,kind:'signature',power:90,cd:3}];
  h.data.fusionFor=(a,b)=>[a.id,b.id].sort().join(',')==='5,6'?h.data.fusionRecipes[0]:null;
  h.player.moveSlots=slots;h.player.moveCap=10;h.player.moves=[h.player.moves[0],...Array(slots-1).fill(null)];
  const config=h.settings.finalReplacements[7];
  config.moves={enabled:finalMoves,level:threshold,targets:['first','second','third']};
  config.fusion={enabled:true,level:threshold,targets:['fusion-goal']};
  config.vitamins.enabled=false;
  const build={sourceType:'custom',moves:['first','second','third'],moveRules:['first','second','third'].map(key=>({key,priority:1})),vitaminRules:[{key:'carbos',priority:1}]};
  const context=()=>{
    const finalReplacement=choices.finalReplacementState(h.settings,h.nativeRun,h.data);
    finalReplacement.towerPursuit=choices.finalReplacementState({finalReplacements:{7:{...config,
      fusion:{...config.fusion,level:1},moves:{...config.moves,level:1}}}},h.nativeRun,h.data);
    // The desktop modal handler applies this adapter before the choice engine.
    return {player:h.player,nativeRun:h.nativeRun,build:choices.finalReplacementBuild(build,finalReplacement),finalReplacement};
  };
  const hold=(id,slot,level=1)=>h.player.moves[slot]={def:h.data.moves.get(id),level,mods:{}};
  const choose=offers=>choices.chooseOfferAction(offers,context(),h.data,{kind:'upgrade',skipLegal:true,banishLegal:true,rerollLegal:true});
  return {...h,context,hold,choose};
}
const learn=id=>({kind:'newMove',id,key:`m${id}`,rarity:0});
const improve=slot=>({kind:'upMove',slot,key:`m-slot-${slot}`,rarity:0,ups:[{key:'dmg',value:.1}]});

test('Tower curses keep the accepted order without a floor cutoff regardless of card order or movement speed',()=>{
  const order=['hunger','dark','swift','twin'];
  for(let first=0;first<order.length;first++)for(let second=first;second<order.length;second++) {
    for(const ids of [[order[first],order[second]],[order[second],order[first]]]) {
      const offers=ids.map(id=>({id})),run={tower:{floor:48,curses:['swift','twin']},player:{stats:{moveSpeed:9}}};
      const before=structuredClone(run),pick=choices.chooseTowerCurseAction(offers,run);
      assert.equal(pick.action,'choose');assert.equal(pick.id,order[first]);assert.equal(pick.targetFloor,49);
      assert.equal(offers[pick.index].id,pick.id);assert.deepEqual(run,before);
    }
  }
  for(const id of order)assert.equal(choices.chooseTowerCurseAction([{id:'graves'},{id}],{tower:{floor:7}}).id,
    ['swift','twin'].includes(id)?'graves':id);
});

test('Tower curse destination validates unknown floors and legal cards',()=>{
  const offers=[{id:'hunger'},{id:'iron'}];
  assert.equal(choices.chooseTowerCurseAction(offers,{tower:{floor:48}}).action,'choose');
  for(const floor of [undefined,null,NaN,0,-1,38.5,'38'])
    assert.equal(choices.chooseTowerCurseAction(offers,{tower:{floor}}).action,'leave');
  assert.equal(choices.chooseTowerCurseAction(offers,{}).action,'leave');
  assert.equal(choices.chooseTowerCurseAction([{id:'graves'},{id:'new-unknown-curse'}],{tower:{floor:8}}).id,'graves');
  assert.equal(choices.chooseTowerCurseAction([{id:'new-unknown-curse'}],{tower:{floor:8}}).action,'leave');
  assert.equal(choices.chooseTowerCurseAction(offers,{tower:{floor:65}}).targetFloor,66);
  assert.equal(choices.chooseTowerCurseAction(offers,{tower:{floor:8}},{legal:index=>index===1}).action,'leave');
  assert.equal(choices.chooseTowerCurseAction(offers,{tower:{floor:8}},{legal:()=>false}).action,'leave');
});

test('tower reserves two ingredient slots and automatically releases the last normal target after fusion',()=>{
  for(const finalMoves of [false,true]) {
    const h=stagedFusionFixture({finalMoves});
    assert.equal(h.choose([learn(2)]).action,'choose','one companion joins the initial move');h.hold(2,1);
    assert.equal(h.choose([learn(4)]).action,'skip','third normal is deferred and protected from banishment');
    assert.equal(h.choose([learn(4),learn(5)]).index,1);h.hold(5,2,8);
    assert.equal(h.choose([learn(4),learn(6)]).index,1);h.hold(6,3,8);
    const fusion=choices.chooseFusionAction([{a:2,b:3,ready:true,r:h.data.fusionRecipes[0]}],h.context(),h.data);
    assert.equal(fusion.action,'choose');
    h.hold(50001,2);h.player.moves[2].parents=[5,6];h.player.moves[3]=null;
    assert.equal(h.choose([learn(4)]).action,'choose','same saved configuration finishes the loadout');
  }
});

test('tower acquires missing materials but their upgrades compete before the final replacement threshold',()=>{
  const h=stagedFusionFixture({threshold:100});
  const vitamin={kind:'upVit',vit:'carbos',key:'vcarbos',rarity:4};
  assert.equal(h.choose([learn(2),vitamin,learn(5)]).index,2);
  h.hold(5,1,7);
  assert.equal(h.choose([learn(2),vitamin,improve(1)]).index,0,'holding an ingredient does not force its upgrade');
  h.player.moves[1].level=8;
  assert.equal(h.choose([learn(2),vitamin,improve(1)]).index,0,'ready material upgrades are still not forced');
  assert.equal(h.choose([improve(1)]).index,0,'a useful material upgrade remains available');
  assert.equal(h.choose([improve(1),learn(6)]).index,1,'missing ingredient precedes optional extra levels');
});

test('tower reserves only missing ingredients and follows actual three-slot capacity',()=>{
  const h=stagedFusionFixture({slots:3});
  assert.equal(h.choose([learn(2)]).action,'skip');
  h.hold(5,1,8);
  assert.equal(h.choose([learn(2),learn(6)]).index,1);h.hold(6,2,8);
  h.hold(50001,1);h.player.moves[1].parents=[5,6];h.player.moves[2]=null;
  assert.equal(h.choose([learn(2)]).action,'choose');h.hold(2,2);
  h.player.moveSlots=4;h.player.moves.push(null);
  assert.equal(h.choose([learn(4)]).action,'choose','an unlocked fourth slot admits the remaining goal');
});

test('tower can use either offered companion while preserving ingredients, and still upgrade held companions',()=>{
  const h=stagedFusionFixture();
  assert.equal(h.choose([learn(4)]).action,'choose');h.hold(4,1);
  assert.equal(h.choose([learn(2)]).action,'skip');
  h.player.moves[0].level=2;
  assert.equal(h.choose([improve(0)]).action,'choose','reservation concerns new slots, not held upgrades');
});

// Other author semantics remain independent of Tower loadout completion.
test('completed Tower targets still use the author luck blessing score',()=>{
  const h=towerFixture(),offers=[{mods:[{stat:'luck',add:10000}],rarity:4},{mods:[{stat:'damage',mul:1.12}],rarity:0}];
  assert.equal(choices.chooseOfferAction(offers,h.context(),h.data,{kind:'blessing'}).index,0);
});
test('Tower retains native parent locks and releases normal targets after its requested fusion',()=>{
  const h=stagedFusionFixture();h.hold(50001,1,1);h.player.moves[1].parents=[5,6];
  const final=h.context().finalReplacement;
  assert.equal(final.fusion.continuous,false);assert.equal(final.fusion.pending,null);
  assert.equal(h.choose([learn(2)]).action,'choose');
});
test('author strict allow-lists do not revive non-target Tower cards or prevent their banishment',()=>{
  const h=towerFixture();h.player.moves[1]=null;
  h.settings.finalReplacements[7].strictMoves={enabled:true,targets:['first','second']};
  const offer={kind:'newMove',id:3,key:'m3',rarity:4};
  assert.equal(choices.chooseOfferAction([offer],h.context(),h.data,{banishLegal:true}).action,'banish');
  h.nativeRun.banishes=0;h.nativeRun.skips=0;h.nativeRun.rerolls=0;
  assert.equal(choices.chooseOfferAction([offer],h.context(),h.data).action,'restart');
});
test('Tower completes each fusion once and resumes ordinary targets from either saved goal source',()=>{
  for(const finalMoves of [false,true]) {
    const h=stagedFusionFixture({finalMoves});
    h.data.fusionFor=(a,b)=>['5,6','2,3'].includes([a.id,b.id].sort().join(','))?h.data.fusionRecipes[0]:null;
    h.hold(50001,1,1);h.player.moves[1].parents=[5,6];
    const before=structuredClone(h.settings),final=h.context().finalReplacement;
    assert.deepEqual(final.fusion.targets,["fusion-goal"]);assert.equal(final.fusion.continuous,false);
    assert.equal(final.fusion.pending,null);assert.deepEqual(final.fusion.assignments,[]);
    assert.equal(h.choose([learn(4)]).action,'choose','custom ordinary target released after fusion');
    assert.equal(choices.chooseFusionAction([{a:2,b:3,ready:true,r:h.data.fusionRecipes[0]}],h.context(),h.data).action,'leave');
    assert.deepEqual(h.settings,before,'normalization does not rewrite saved settings');
  }
});

test('Tower strict targets deduplicate fusion names and retain already acquired duplicate products',()=>{
  const h=stagedFusionFixture();
  h.data.fusionFor=(a,b)=>['5,6','2,3'].includes([a.id,b.id].sort().join(','))?h.data.fusionRecipes[0]:null;
  h.settings.finalReplacements[7].strictMoves={enabled:true,targets:['fusion-goal','fusion-goal','first','third']};
  h.hold(50001,1,1);h.player.moves[1].parents=[5,6];
  let value=h.context().finalReplacement;
  assert.deepEqual(value.fusion.targets,['fusion-goal']);assert.equal(value.fusion.pending,null);
  assert.equal(h.choose([learn(4)]).action,'choose');
  h.hold(50001,2,1);h.player.moves[2].parents=[2,3];
  value=h.context().finalReplacement;
  assert.deepEqual(value.fusion.protectedSlots,[1,2]);assert.deepEqual(value.moves.forget,[]);
});

test('Tower continues distinct missing fusion targets, then releases all preparation slots',()=>{
  const h=stagedFusionFixture();
  const other={id:50002,key:'fusion-other',arch:'fusion',type:'normal',cls:'special',dmg:50,cd:3};
  h.data.moves.set(other.id,other);h.data.movesByKey.set(other.key,other);
  h.data.fusionRecipes.push({key:other.key,id:other.id,kind:'signature',moves:['second','unwanted']});
  h.data.fusionFor=(a,b)=>['5,6','2,3'].indexOf([a.id,b.id].sort().join(','))<0?null:
    h.data.fusionRecipes[['5,6','2,3'].indexOf([a.id,b.id].sort().join(','))];
  h.settings.finalReplacements[7].fusion.targets=['fusion-goal','fusion-other'];
  h.hold(50001,1,1);h.player.moves[1].parents=[5,6];
  assert.equal(h.context().finalReplacement.fusion.pending.key,'fusion-other');
  h.hold(50002,2,1);h.player.moves[2].parents=[2,3];
  const final=h.context().finalReplacement;
  assert.equal(final.fusion.pending,null);assert.deepEqual(final.fusion.completed,['fusion-goal','fusion-other']);
  assert.equal(choices.towerLoadoutProgress(h.context(),h.data).reservedMaterialSlots,0);
});

test('explicit duplicate final targets request two copies in Tower',()=>{
  const h=stagedFusionFixture();
  h.data.fusionFor=(a,b)=>['5,6','2,3'].includes([a.id,b.id].sort().join(','))?h.data.fusionRecipes[0]:null;
  h.hold(50001,1,1);h.player.moves[1].parents=[5,6];
  const stored=h.settings.finalReplacements[7];
  stored.fusion={enabled:true,level:1,targets:['fusion-goal','fusion-goal'],goalOnly:true,allowRepeated:true};
  const final=choices.finalReplacementState(h.settings,h.nativeRun,h.data);
  assert.deepEqual(final.fusion.targets,["fusion-goal","fusion-goal"]);assert.equal(final.fusion.pending.key,'fusion-goal');
  assert.deepEqual(final.fusion.pending.parentIds,[2,3]);
});


test('tower completion counts two requested copies separately',()=>{
  const h=stagedFusionFixture();
  h.settings.finalReplacements[7].moves.enabled=false;
  h.settings.finalReplacements[7].fusion.targets=['fusion-goal','fusion-goal'];
  h.hold(50001,1,5);
  const run={player:h.player,nativeRun:h.nativeRun,build:{},finalReplacement:choices.finalReplacementState(h.settings,h.nativeRun,h.data)};
  assert.equal(choices.towerLoadoutProgress(run,h.data).complete,false);
  h.hold(50001,2,5);
  run.finalReplacement=choices.finalReplacementState(h.settings,h.nativeRun,h.data);
  assert.equal(choices.towerLoadoutProgress(run,h.data).complete,true);
});
