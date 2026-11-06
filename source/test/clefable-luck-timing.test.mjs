import test from 'node:test';
import assert from 'node:assert/strict';
import {decisionPlayer,scoreMods,scoreOffer,evaluateItemDecision} from '../src/policy.mjs';
import {chooseOfferAction} from '../src/choice-strategy.mjs';

// Changing the phase boundary or scoring the whole mixed card would break these
// independent ratios. No App, account, native RNG or running client is used.
function setup({floor=10,luck=130,count=0,species=36,tower=true,onlyExperience=false,expectCleanse=true}={}) {
 const player={speciesId:species,level:30,hp:200,maxHp:200,types:['fairy'],moveSlots:1,vitaminSlots:2,vitCap:12,
  moves:[{def:{id:1,key:'hit',arch:'strike',cls:'special',type:'fairy',dmg:100,cd:1},level:8,mods:{}}],capOf:()=>8,
  items:new Map(count?[['cleanse-tag',count]]:[]),vitamins:new Map([['star-piece-v',{level:1,acc:1}],['calcium',{level:1,acc:1}]]),
  stats:{luck,damage:1,physical:1,special:1,attackSpeed:1,critChance:0,critDamage:1.5,maxHp:200,regen:1,armor:20,healing:1,moveSpeed:1,area:1,eliteDamage:1}};
 const nativeRun={player,tower:tower?{floor}:null,stage:1,time:100,tempMods:[],skips:0,rerolls:0};player.run=nativeRun;
 const build={items:['cleanse-tag'],avoidItems:expectCleanse?[]:['cleanse-tag'],vitaminRules:[{key:'star-piece-v'},{key:'calcium'}],allowOffPlan:true};
 const data={items:new Map([['cleanse-tag',{key:'cleanse-tag',rarity:0,mods:[{stat:'eliteDamage',mul:1.15}]}]]),
  vitamins:new Map([['star-piece-v',{key:'star-piece-v',stat:'luck',per:10,kind:'add'}],['calcium',{key:'calcium',stat:'special',per:.1,kind:'mul'}]]),rarityMultipliers:[1,1.2,1.45,1.75,2.1]};
 return {player,nativeRun,mode:tower?'tower':'standard',build,luckOnlyExperience:onlyExperience,data};
}
const score=(run,mods)=>scoreMods(mods,1,decisionPlayer(run));
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
for(const [floor,count,factor] of [[1,0,.1],[19,2,.1],[10,3,.5],[20,0,.5],[29,4,.5],[10,5,1],[30,0,1]])
 test(`luck uses only cleanse count ${count} at floor ${floor}`,()=>{
  const r=setup({floor,count}),base=setup({floor,count,expectCleanse:false});
  close(score(r,[{stat:'luck',add:20}]),score(base,[{stat:'luck',add:20}])*factor);
 });
test('crossing 125 discounts only the excess five of a ten-point increase',()=>{
 const r=setup({luck:120}),base=setup({luck:120,expectCleanse:false});
 close(score(r,[{stat:'luck',add:10}]),score(base,[{stat:'luck',add:10}])*.55);
});
test('experience-only target uses 100 and reaches it without discount',()=>{
 const r=setup({luck:95,onlyExperience:true}),base=setup({luck:95,expectCleanse:false});
 close(score(r,[{stat:'luck',add:10}]),score(base,[{stat:'luck',add:10}])*.55);
});
test('mixed blessing keeps its non-luck contribution',()=>{
 const r=setup(),base=setup({expectCleanse:false}),other=[{stat:'maxHp',add:20}];
 close(score(r,[...other,{stat:'luck',add:20}])-score(r,other),score(base,[{stat:'luck',add:20}])*.1);
});
test('missing gold items or grip claw do not delay release at five cleanse tags',()=>{
 const r=setup({count:5});close(score(r,[{stat:'luck',add:20}]),score(setup({count:5,expectCleanse:false}),[{stat:'luck',add:20}]));
});
test('avoided cleanse goal and standard mode preserve existing luck scoring',()=>{
 const r=setup();r.build.avoidItems=['cleanse-tag'];
 close(score(r,[{stat:'luck',add:20}]),score(setup({expectCleanse:false}),[{stat:'luck',add:20}]));
 const standard=setup({tower:false});close(score(standard,[{stat:'luck',add:20}]),score(setup({tower:false,expectCleanse:false}),[{stat:'luck',add:20}]));
});
test('star item and vitamin use the same phase as blessings',()=>{
 const r=setup(),base=setup({expectCleanse:false});
 for(const ctx of [r,base])ctx.data.items.set('star-piece',{key:'star-piece',rarity:2,mods:[{stat:'luck',add:20}]});
 for(const offer of [{kind:'upVit',vit:'star-piece-v',rarity:1},{kind:'item',id:'star-piece'},{mods:[{stat:'luck',add:20}]}])
  close(scoreOffer(offer,r,r.data),scoreOffer(offer,base,base.data)*.1);
});
test('held star no longer overrides a useful equal rarity calcium upgrade',()=>{
 const r=setup();const d=chooseOfferAction([{kind:'upVit',vit:'calcium',rarity:1},{kind:'upVit',vit:'star-piece-v',rarity:1}],r,r.data,{kind:'upgrade'});
 assert.equal(d.action,'choose');assert.equal(d.index,0);assert.notEqual(d.reason,'same-rarity-star-piece-priority');
});
test('a lone legal star upgrade remains selectable rather than forcing search or exit',()=>{
 const r=setup();const d=chooseOfferAction([{kind:'upVit',vit:'star-piece-v',rarity:1}],r,r.data,{kind:'upgrade'});
 assert.equal(d.action,'choose');assert.equal(d.index,0);
});
test('clefable blessing compares defense and luck by score after release',()=>{
 const r=setup({floor:68,luck:913,count:10});r.player.level=398;
 const d=chooseOfferAction([{mods:[{stat:'luck',add:31.5}]},{mods:[{stat:'armor',add:16.8}]}],r,r.data,{kind:'blessing'});
 assert.equal(d.index,1);
});
test('early cleanse preference ends at three and ignores numeric priority',()=>{
 const r=setup();assert.equal(evaluateItemDecision('cleanse-tag',r,r.data).utilityTier,1);
 r.data.items.set('star-piece',{key:'star-piece',rarity:2,mods:[{stat:'luck',add:20}]});
 r.build.itemRules=[{key:'star-piece',priority:1},{key:'cleanse-tag',priority:2}];
 assert.equal(chooseOfferAction(['star-piece','cleanse-tag'],r,r.data,{kind:'itemChoice'}).index,1);
 r.player.items.set('cleanse-tag',3);assert.equal(evaluateItemDecision('cleanse-tag',r,r.data).utilityTier,0);
});
test('single legal item fallback honors experience-only timing',()=>{
 const r=setup({luck:105,onlyExperience:true}),baseline=setup({luck:105,expectCleanse:false});
 for(const ctx of [r,baseline])ctx.data.items.set('star-piece',{key:'star-piece',rarity:2,mods:[{stat:'luck',add:20}]});
 close(evaluateItemDecision('star-piece',r,r.data).score,evaluateItemDecision('star-piece',baseline,baseline.data).score*.1);
});
test('mixed lucky punch keeps the critical contribution and scores only excess luck lower',()=>{
 const r=setup(),baseline=setup({expectCleanse:false});
 for(const ctx of [r,baseline])ctx.data.items.set('lucky-punch',{key:'lucky-punch',rarity:0,mods:[{stat:'luck',add:10},{stat:'critChance',add:.03}]});
 const difference=scoreOffer({kind:'item',id:'lucky-punch'},baseline,baseline.data)-scoreOffer({kind:'item',id:'lucky-punch'},r,r.data);
 close(difference,score(baseline,[{stat:'luck',add:10}])*.9);
});
test('blessing change leaves ordinary item defense category unchanged',()=>{
 const r=setup();r.data.items.set('oran-berry',{key:'oran-berry',rarity:0,mods:[{stat:'maxHp',add:15}]});
 assert.equal(evaluateItemDecision('oran-berry',r,r.data).utilityTier,-1);
});
test('cleanse acquisition preference never displaces an available native revival',()=>{
 const r=setup();r.data.items.set('max-revive',{key:'max-revive',rarity:3,mods:[],max:3});
 const d=chooseOfferAction(['cleanse-tag','max-revive'],r,r.data,{kind:'itemChoice'});
 assert.equal(d.action,'choose');assert.equal(d.index,1);
});

for(const species of [35,36,92,99,150,31]) test(`tower luck timing also applies to species ${species}`,()=>{
 const r=setup({species}),base=setup({species,expectCleanse:false});
 close(score(r,[{stat:'luck',add:20}]),score(base,[{stat:'luck',add:20}])*.1);
});
