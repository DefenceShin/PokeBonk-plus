import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import * as old from '../../evidence/personal-2000/src/choice-strategy.mjs';
import * as now from '../src/choice-strategy.mjs';
const root=new URL('../',import.meta.url);
const catalog=JSON.parse(await readFile(new URL('research/update-1.5.1-055-runtime-definitions.json',root),'utf8'));
const all=[...catalog.moves,...catalog.fusionMoves],byKey=new Map(all.map(d=>[d.key,d]));
const recipes=catalog.fusionMoves.map(d=>({...d.recipe,id:d.id}));
function setup(c,species,held,available,targets,level,build={}) {
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
function clef(c,held=[['draining-kiss',8]],custom=build){return setup(c,35,held,keys,goals,57,custom);}
function decide(c,h,offers,opts={}) {
 const final=c.finalReplacementState({finalReplacements:{35:{fusion:{enabled:true,targets:goals,level:1}}}},
   h.nativeRun,h.data,{build:h.ctx.build,offers});
 final.towerPursuit={...final};
 h.final=final;h.ctx.finalReplacement=final;
 return c.chooseOfferAction(offers,h.ctx,h.data,{...options,...opts});
}

const identicalExports=Object.keys(old).filter(k=>/fusion|banish|replacement|readiness|towerLoadout|movePreferences|vitaminPreferences/i.test(k));
for(const key of identicalExports)assert.equal(String(now[key]),String(old[key]),key);
const slots=['star-piece-v','exp-candy','super-lure','pp-up','calcium'],plan={...build,vitaminRules:slots.map(key=>({key,priority:1,avoid:false})),vitaminPriority:slots,allowOffPlan:true};
const menus=[[move('gravity'),vit('exp-candy')],[move('sing'),vit('cursed')],[move('moonblast'),move('sing')],[vit('cursed'),vit('calcium')],[vit('cursed')],[vit('exp-candy'),vit('star-piece-v')],[move('misty-explosion'),vit('cursed')],[{kind:'upMove',slot:0,rarity:1},vit('exp-candy')],[{kind:'upVit',vit:'exp-candy',rarity:1},move('gravity')]];
function sample(c,on,held,n,menu,search){
 const h=clef(c,held,plan);for(const k of slots.slice(0,n))h.player.vitamins.set(k,{level:4,acc:4});h.ctx.experienceBlessingPriority=on;h.nativeRun.rerolls=search;h.nativeRun.skips=search;
 const d=decide(c,h,menu,{experienceBlessingPriority:on,rerolls:search,skips:search});
 return [d.action,d.index,h.final.fusion?.pending?.key??null,d.towerProgress?.readyFusion??null];
}
let cases=0;
for(const held of [[['draining-kiss',8]],[['draining-kiss',8],['gravity',8]],[['draining-kiss',8],['gravity',8],['sing',5]]])
for(const n of [0,4,5])for(const menu of menus)for(const search of [0,1]){
 const ref=sample(old,false,held,n,menu,search);for(const [impl,on] of [[old,true],[now,false],[now,true]])assert.deepEqual(sample(impl,on,held,n,menu,search),ref,JSON.stringify([held,n,menu,search,on]));cases++;}
console.log(JSON.stringify({cases,perCase:['2.0.0+ off','2.0.0+ on','new off','new on'],identicalExports},null,2));
