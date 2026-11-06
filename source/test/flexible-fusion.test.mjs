// Isolated source-path reproductions; synthetic catalogs/availability, not a live-game replay.
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as c from '../src/choice-strategy.mjs';
const root=new URL('../',import.meta.url);
const catalog=JSON.parse(await readFile(new URL('research/update-1.5.1-055-runtime-definitions.json',root),'utf8'));
const all=[...catalog.moves,...catalog.fusionMoves],byKey=new Map(all.map(d=>[d.key,d]));
const recipes=catalog.fusionMoves.map(d=>({...d.recipe,id:d.id}));
function setup(species,held,available,targets,level,build={}) {
 const definitions=available.map(k=>byKey.get(k)); assert(definitions.every(Boolean));
 const data={moves:new Map(all.map(d=>[d.id,d])),movesByKey:byKey,vitamins:new Map(catalog.vitamins.map(v=>[v.key,v])),
  items:new Map(),rarityMultipliers:[1,1.2,1.45,1.75,2.1],fusionRecipes:recipes,
  moveGuide:()=>({kit:definitions.map(d=>({id:d.id,level:1,open:true})),line:[],shared:[]}),
  fusionFor:(a,b)=>recipes.find(r=>r.kind==='signature'&&r.moves.includes(a.key)&&r.moves.includes(b.key)) ||
   recipes.find(r=>r.kind==='type'&&a.type===b.type&&r.type===a.type) ||
   recipes.find(r=>r.kind==='reaction'&&((r.pair[0].includes(a.type)&&r.pair[1].includes(b.type))||(r.pair[1].includes(a.type)&&r.pair[0].includes(b.type)))) ||
   recipes.find(r=>r.kind==='glitch')};
 const player={speciesId:species,level,hp:160,maxHp:160,types:['ghost'],moveSlots:4,vitaminSlots:5,moveCap:8,vitCap:10,
  capOf:m=>m.def.arch==='fusion'?5:8,moves:held.map(([key,lv,parents])=>({def:byKey.get(key),level:lv,parents,mods:{}})),
  vitamins:new Map(),items:new Map(),stats:{moveSpeed:1,attackSpeed:1,damage:1,special:1,physical:1,armor:20,regen:2,healing:1,projectiles:0}};
 const nativeRun={player,startSpecies:species,tower:{floor:3,curses:[]},banished:new Set(),banishes:0,skips:0,rerolls:0};
 const stored={moves:{enabled:false,targets:[],level:30},fusion:{enabled:true,targets,level:30},vitamins:{enabled:false,targets:[],level:30}};
 const settings={finalReplacements:{[species]:stored}};
 const final=c.finalReplacementState(settings,nativeRun,data,{build});
 final.towerPursuit=c.finalReplacementState({finalReplacements:{[species]:{...stored,fusion:{...stored.fusion,level:1}}}},nativeRun,data,{build});
 return {data,player,nativeRun,final,ctx:{player,nativeRun,build:c.finalReplacementBuild(build,final),finalReplacement:final}};
}
const options={kind:'upgrade',skipLegal:true,rerollLegal:true,banishLegal:true};
const vitamin={kind:'newVit',vit:'calcium',key:'vcalcium',rarity:0};
const keys=['draining-kiss','disarming-voice','gravity','moonblast','sing','hyper-voice','misty-explosion','pound'];
const goals=['fu-t-fairy','fu-35','fu-39'];
const build={sourceType:'custom',allowOffPlan:true,moves:['misty-explosion'],
 moveRules:[{key:'misty-explosion',priority:1}],
 vitaminRules:['star-piece-v','calcium','exp-candy','poke-radar'].map(key=>({key,priority:1}))};
const move=key=>({kind:'newMove',id:byKey.get(key).id,key:'m'+byKey.get(key).id,rarity:0});
const vit=key=>({kind:'newVit',vit:key,key:'v'+key,rarity:0});
function clef(held=[['draining-kiss',8]],custom=build){return setup(35,held,keys,goals,57,custom);}
function decide(h,offers,opts={}) {
 const final=c.finalReplacementState({finalReplacements:{35:{fusion:{enabled:true,targets:goals,level:1}}}},
   h.nativeRun,h.data,{build:h.ctx.build,offers});
 final.towerPursuit={...final};
 h.final=final;h.ctx.finalReplacement=final;
 return c.chooseOfferAction(offers,h.ctx,h.data,{...options,...opts});
}
test('a seed for the second fusion is learned before vitamins while the first partner is absent',()=>{
 const h=clef(),offers=[move('gravity'),vit('calcium')],d=decide(h,offers);
 assert.equal(d.action,'choose');assert.equal(d.index,0);
});
test('a seed for the third fusion is also eligible without its partner already held',()=>{
 const h=clef(),d=decide(h,[move('sing'),vit('calcium')]);assert.equal(d.action,'choose');assert.equal(d.index,0);
});
test('offered partner completing a held pair outranks opening another fusion',()=>{
 const h=clef([['draining-kiss',8],['gravity',3]]),d=decide(h,[move('sing'),move('moonblast')]);
 assert.equal(d.action,'choose');assert.equal(d.index,1);
});
test('material collection before machine threshold still prefers completing a held pair',()=>{
 const h=setup(35,[['draining-kiss',8],['gravity',3]],keys,goals,10,build);
 const d=c.chooseOfferAction([move('sing'),move('moonblast')],h.ctx,h.data,options);
 assert.equal(d.action,'choose');assert.equal(d.index,1);
});
test('parallel seeds never fill the last slot when none of their partners can then be learned',()=>{
 const h=clef([['draining-kiss',8],['gravity',3],['sing',3]]);
 h.nativeRun.rerolls=1;
 const d=decide(h,[move('misty-explosion'),vit('calcium')]);
 assert.notEqual(d.index,0,'ordinary final move must wait for a fusion to release a slot');
});
test('with three actual slots a third half-pair cannot block both existing routes',()=>{
 const h=clef([['draining-kiss',8],['gravity',3]]);h.player.moveSlots=3;
 const d=decide(h,[move('sing'),vit('calcium')]);
 assert.notEqual(d.index,0);
});
test('two completed parents protect a route even when another route has a more advanced single parent',()=>{
 const h=clef([['draining-kiss',8],['sing',4],['hyper-voice',4]]);decide(h,[]);
 assert.equal(h.final.fusion.pending.key,'fu-39');
 assert.equal(h.final.needsTutor,false,'never forget a pair to chase the older incomplete route');
});
for(const heldStar of [false,true])test(`fusion material beats even orange star piece; held=${heldStar}`,()=>{
 const h=clef();if(heldStar)h.player.vitamins.set('star-piece-v',{level:2});
 const d=decide(h,[move('disarming-voice'),{...vit('star-piece-v'),kind:heldStar?'upVit':'newVit',rarity:4}]);
 assert.equal(d.action,'choose');assert.equal(d.index,0);
});
test('ordinary planned vitamin does not end a material search when unwanted moves can be banished',()=>{
 const h=clef();h.nativeRun.banishes=2;
 const d=decide(h,[move('pound'),vit('calcium')]);assert.equal(d.action,'banish');assert.equal(d.index,0);
});
test('search keeps rerolling beyond the old per-page limit while native resources remain',()=>{
 const h=clef();h.nativeRun.rerolls=4;
 const d=decide(h,[vit('dire-hit'),vit('x-defense')],{history:{rerollsThisPage:40,unplannedRounds:40}});
 assert.equal(d.action,'reroll');
});
test('banish continues beyond the old unplanned-round limit and preserves all target parents',()=>{
 const h=clef();h.nativeRun.banishes=4;
 const d=decide(h,[move('pound'),vit('calcium')],{history:{unplannedRounds:40}});
 assert.equal(d.action,'banish');assert.equal(d.index,0);
});
test('native skip remains usable after many search rounds',()=>{
 const h=clef();h.nativeRun.skips=4;
 assert.equal(decide(h,[vit('dire-hit')],{history:{unplannedRounds:40}}).action,'skip');
});
test('exhausted search exits rather than acquiring off-plan growth',()=>{
 const h=clef(),d=decide(h,[vit('dire-hit'),vit('x-defense')]);
 assert.equal(d.action,'restart');assert.equal(d.index,null);
});
test('unwanted vitamins can be banished while material search is incomplete',()=>{
 const h=clef();h.nativeRun.banishes=3;
 const d=decide(h,[vit('dire-hit'),vit('calcium')]);
 assert.equal(d.action,'banish');assert.equal(d.index,0);
});
test('target vitamins, star piece and held vitamin upgrades are never search banishments',()=>{
 const h=clef();h.nativeRun.banishes=3;h.nativeRun.rerolls=2;
 h.player.vitamins.set('dire-hit',{level:2});
 const d=decide(h,[vit('calcium'),vit('star-piece-v'),{...vit('dire-hit'),kind:'upVit'}]);
 assert.notEqual(d.action,'banish');
});
test('configured vitamins beyond current slot capacity are protected from permanent banishment',()=>{
 const h=clef();h.player.vitaminSlots=1;h.nativeRun.banishes=3;h.nativeRun.rerolls=1;
 const d=decide(h,[vit('poke-radar')]);assert.notEqual(d.action,'banish');
});
test('fallback still respects explicit avoid, native legality, and strict vitamin selection',()=>{
 for(const mode of ['avoid','illegal','strict']) {
  const h=clef(undefined,{...build,avoidVitamins:mode==='avoid'?['dire-hit','x-defense']:[]});
  if(mode==='strict') {
   h.final.towerPursuit.strictVitamins={enabled:true,targets:['calcium']};
   h.final.strictVitamins={enabled:true,targets:['calcium']};
   const d=c.chooseOfferAction([vit('dire-hit'),vit('x-defense')],h.ctx,h.data,options);assert.notEqual(d.action,'choose');
  } else {
   const d=decide(h,[vit('dire-hit'),vit('x-defense')],mode==='illegal'?{legal:()=>false}:{});
   assert.notEqual(d.action,'choose');
  }
 }
});
test('the four offers at the recorded level-57 stall now learn gravity',()=>{
 const h=clef();h.player.vitamins=new Map(['star-piece-v','calcium','exp-candy','poke-radar'].map(k=>[k,{level:10}]));
 const d=decide(h,[move('gravity'),vit('dire-hit'),{...vit('cursed'),rarity:3},vit('x-defense')],
   {history:{rerollsThisPage:2,unplannedRounds:1}});
 assert.equal(d.action,'choose');assert.equal(d.index,0);
});
test('a ready later pair is dispatched without waiting for the first recipe',()=>{
 const h=clef([['draining-kiss',8],['sing',8],['hyper-voice',8]]);decide(h,[]);
 assert.equal(h.final.fusion.pending.key,'fu-39');assert.equal(h.final.needsFusion,true);
 const d=c.chooseFusionAction([{a:1,b:2,ready:true,r:recipes.find(r=>r.key==='fu-39')}],h.ctx,h.data);
 assert.equal(d.action,'choose');assert.equal(d.key,'fu-39');
});
