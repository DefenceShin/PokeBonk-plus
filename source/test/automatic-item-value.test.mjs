import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fixture,sandbox} from './benefit-fixture.mjs';
import {evaluateItemDecision,scoreOffer,scoreMods,evaluateShopPurchases,selectCopyItem,offerUtilityTier,compareOfferCandidates} from '../src/policy.mjs';
import {chooseOfferAction} from '../src/choice-strategy.mjs';
const catalog=JSON.parse(readFileSync(new URL('./benefit-item-catalog.json',import.meta.url)));
const items=new Map(catalog.items.map(d=>[d.key,d]));
function setup(mode='tower'){
 sandbox.Kn=items;const r=fixture();r.mode=mode;r.player.level=100;
 if(mode==='tower')r.nativeRun.tower={floor:30};
 r.data={items,vitamins:sandbox.Tt};r.player.canHold=k=>(r.player.items.get(k)||0)<(items.get(k)?.max??10);
 return r;
}
const decision=(r,key,purpose='free')=>evaluateItemDecision(key,{...r,purpose},r.data);
function xpSetup(mode='tower') {
 const r=setup(mode);r.experienceBlessingPriority=true;
 r.data={...r.data,items:new Map(r.data.items).set('huge-damage',{key:'huge-damage',rarity:0,max:10,mods:[{stat:'damage',mul:10}]})};
 sandbox.Kn=r.data.items;r.nativeRun.gold=10000;return r;
}
test('experience toggle puts native XP items before ordinary item ranking',()=>{
 for(const key of ['lucky-egg','exp-share','macho-brace','white-flute','rare-candy']){
  const r=xpSetup();r.build={itemRules:[{key:'huge-damage',priority:-100}]};
  assert.equal(chooseOfferAction(['huge-damage',key],r,r.data,{kind:'itemChoice'}).index,1,key);
  r.experienceBlessingPriority=false;
  assert.equal(chooseOfferAction(['huge-damage',key],r,r.data,{kind:'itemChoice'}).index,0,key+' off');
 }
});
test('experience item priority applies to purchases and copies using the same comparison',()=>{
 const r=xpSetup();r.player.items=new Map([['huge-damage',1],['lucky-egg',1]]);r.player.recompute();
 const stock=[{key:'huge-damage',price:1},{key:'lucky-egg',price:100}];
 for(const spendAll of [false,true])assert.equal(evaluateShopPurchases(stock,r,r.data,{spendAll}).index,1);
 assert.equal(selectCopyItem(r.player,r.build,r.data,r),'lucky-egg');
 r.experienceBlessingPriority=false;
 assert.equal(evaluateShopPurchases(stock,r,r.data).index,0);
 assert.equal(selectCopyItem(r.player,r.build,r.data,r),'huge-damage');
});
test('shop forecast cannot reserve ordinary damage ahead of an affordable experience item',()=>{
 const r=xpSetup();Object.assign(r.nativeRun,{chestsBought:0,shopBuys:[],stage:1,gold:1000});
 assert.equal(evaluateShopPurchases([{key:'huge-damage',price:1000},{key:'lucky-egg',price:1000}],r,r.data).index,1);
});
test('XP candidates use benefit and fallback ignores numeric priority',()=>{
 const r=xpSetup();r.build={itemRules:[{key:'lucky-egg',priority:1},{key:'exp-share',priority:2}]};
 assert.equal(chooseOfferAction(['huge-damage','exp-share','lucky-egg'],r,r.data,{kind:'itemChoice'}).index,chooseOfferAction(['huge-damage','exp-share','lucky-egg'],{...r,build:{}},r.data,{kind:'itemChoice'}).index);
 r.build={itemRules:[{key:'old-rod',priority:-2}]};
 assert.equal(chooseOfferAction(['huge-damage','old-rod'],r,r.data,{kind:'itemChoice'}).index,0);
});
test('experience priority cannot bypass exclusions, caps, channel permissions, legality or budget',()=>{
 for(const build of [{avoidItems:['lucky-egg']},{itemCounts:{'lucky-egg':0}},{sourceType:'custom',allowOffPlan:false,itemRules:[{key:'huge-damage'}]}]){
  const r=xpSetup();r.build=build;
  assert.equal(chooseOfferAction(['huge-damage','lucky-egg'],r,r.data,{kind:'itemChoice'}).index,0);
 }
 const r=xpSetup();r.player.items.set('lucky-egg',10);
 assert.equal(chooseOfferAction(['huge-damage','lucky-egg'],r,r.data,{kind:'itemChoice'}).index,0);
 r.player.items.set('lucky-egg',1);r.player.items.set('huge-damage',1);
 assert.equal(chooseOfferAction(['huge-damage','lucky-egg'],r,r.data,{kind:'itemChoice',legal:i=>i===0}).index,0);
 assert.equal(evaluateShopPurchases([{key:'huge-damage',price:10},{key:'lucky-egg',price:10001}],r,r.data).index,0);
 r.build={itemRules:[{key:'lucky-egg',shop:false,copy:false}]};
 assert.equal(selectCopyItem(r.player,r.build,r.data,r),'huge-damage');
 assert.equal(evaluateShopPurchases([{key:'huge-damage',price:10},{key:'lucky-egg',price:1}],r,r.data).index,0);
});
test('experience item preference stays inside native tower runs',()=>{
 for(const mode of ['standard','endless']){
  const r=xpSetup(mode);
  assert.equal(chooseOfferAction(['huge-damage','lucky-egg'],r,r.data,{kind:'itemChoice'}).index,0);
 }
});
for(const mode of ['standard','endless','tower'])test(`${mode}: automatic choices recognize growth, flute, independent attack and economy without priorities`,()=>{
 const r=setup(mode);r.player.vitamins.set('ether',{level:8,acc:8});r.player.recompute();
 for(const key of ['tm-case','max-ether','poke-flute','old-rod','gold-teeth','guard-spec']){
  const d=decision(r,key);assert(d.score>0,key);assert(d.eligible,key);
  assert.equal(chooseOfferAction([key],r,r.data,{kind:'itemChoice'}).index,0,key);
 }
});
test('unlock value grows near cap, but duplicate cap unlock and caps remain enforced',()=>{
 const r=setup();r.player.moves[0].level=1;const early=decision(r,'tm-case');
 r.player.moves[0].level=8;const late=decision(r,'tm-case');
 assert(late.score>early.score&&early.score>0);
 r.player.items.set('tm-case',1);assert.equal(decision(r,'tm-case').eligible,false);
});
test('flute remains useful at speed cap; explicit unavailable ultimate has no invented value',()=>{
 const r=setup();r.nativeRun.tempMods=[{stat:'attackSpeed',mul:100}];r.player.recompute();
 assert(decision(r,'poke-flute').score>0);
 r.nativeRun.ult={enabled:false};assert.equal(decision(r,'poke-flute').score,0);
});
test('status passives use sources, and have diminishing next copy value',()=>{
 const r=setup();assert.equal(decision(r,'full-heal').score,0);assert.equal(decision(r,'ice-heal').score,0);
 r.player.items=new Map([['snowball',1],['flame-orb',1]]);r.player.recompute();
 for(const key of ['full-heal','ice-heal']){
  const first=decision(r,key).score;assert(first>0,key);
  r.player.items.set(key,1);const next=decision(r,key).score;assert(next>0&&next<first,key);r.player.items.delete(key);
 }
});
test('unknown modless free item is retained cautiously, not bought or copied speculatively',()=>{
 const r=setup();const key='future-native-passive';r.data={items:new Map(items).set(key,{mods:[],max:3,desc:'New native passive'})};
 const d=decision(r,key);assert(d.eligible&&d.score===0);
 assert.equal(decision(r,key,'shop').eligible,false);assert.equal(decision(r,key,'copy').eligible,false);
 assert.equal(d.assessment.confidence,'unknown');
});
test('known irrelevant stats and harmful items are not rescued by unknown fallback',()=>{
 const r=setup();assert.equal(decision(r,'wise-glasses','shop').eligible,false);
 r.player.moves[0].def.cls='special';assert.equal(decision(r,'choice-band','shop').eligible,false);
});
test('bans, target counts, closed plan, shop/copy exclusions and native caps still win',()=>{
 for(const build of [{avoidItems:['poke-flute']},{itemRules:[{key:'poke-flute',avoid:true}]},
  {itemCounts:{'poke-flute':0}},{sourceType:'custom',allowOffPlan:false,itemRules:[]}]){
  const r=setup();r.build=build;assert.equal(decision(r,'poke-flute').eligible,false);
 }
 const r=setup();r.build={itemRules:[{key:'old-rod',shop:false,copy:false}]};
 assert.equal(decision(r,'old-rod','shop').eligible,false);assert.equal(decision(r,'old-rod','copy').eligible,false);
 r.player.canHold=()=>false;assert.equal(decision(r,'poke-flute').eligible,false);
});
test('known defense stays below output tier without becoming worthless',()=>{
 const r=setup();const d=decision(r,'guard-spec');assert(d.score>0&&d.score<2);assert.equal(d.utilityTier,-1);
 assert.equal(offerUtilityTier({kind:'item',id:'rainbow-wing'},r,r.data),-1);
});
test('discount is useful only while paid channels remain allowed; subsequent discounts diminish',()=>{
 const r=setup();const first=decision(r,'gold-teeth').score;r.player.items.set('gold-teeth',1);
 const next=decision(r,'gold-teeth').score;assert(first>0&&next>0&&next<first);
 r.build.interactions={paid:false};assert.equal(decision(r,'gold-teeth').score,0);
});
test('support and map-only passives respect confirmed absence of mechanics',()=>{
 const r=setup();r.nativeRun.allies={list:[]};
 assert.equal(decision(r,'lemonade').score,0);assert.equal(decision(r,'poke-doll').score,0);
 assert.equal(decision(r,'dowsing-machine').score,0);assert.equal(decision(r,'secret-key').score,0);
 r.nativeRun.allies.list=[{id:1}];assert(decision(r,'lemonade').eligible&&decision(r,'poke-doll').eligible);
});
test('free legal zero, negative and saturated items are taken; scores only rank multiple offers',()=>{
 const r=setup();r.player.moves[0].def.cls='special';
 for(const key of ['choice-band','muscle-band']){
  assert(decision(r,key).eligible,key);
  assert.equal(chooseOfferAction([key],r,r.data,{kind:'itemChoice'}).index,0,key);
 }
 r.nativeRun.tempMods=[{stat:'attackSpeed',mul:100}];r.player.recompute();
 assert(decision(r,'quick-claw').eligible);
 assert.equal(chooseOfferAction(['quick-claw'],r,r.data,{kind:'itemChoice'}).index,0);
 r.nativeRun.tempMods=[];r.player.recompute();
 assert.equal(chooseOfferAction(['choice-band','wise-glasses'],r,r.data,{kind:'itemChoice'}).index,1);
});
test('fractional fusion projectile growth gets small investment, not full-volley value or cap resurrection',()=>{
 const r=setup();r.player.moves[0].def={key:'fu-t-ghost',arch:'fusion',dmg:100,cd:1,cls:'special'};
 r.player.stats.projectiles=0;
 const half=scoreMods([{stat:'projectiles',add:.5}],1,r.player),whole=scoreMods([{stat:'projectiles',add:1}],1,r.player);
 assert(half>0&&half<whole*.25);
 r.player.moves[0].mods.count=10;assert.equal(scoreMods([{stat:'projectiles',add:.5}],1,r.player),0);
});
test('automatic pickup, purchase and copy share known passive estimates and retain budget limits',()=>{
 const r=setup();r.nativeRun.gold=1000;
 assert(evaluateShopPurchases([{key:'old-rod',price:100}],r,r.data).evaluations[0].eligible);
 assert.equal(evaluateShopPurchases([{key:'old-rod',price:2000}],r,r.data).evaluations[0].eligible,false);
 r.player.items.set('old-rod',1);assert.equal(selectCopyItem(r.player,r.build,r.data,r),'old-rod');
});
test('item evaluation is read-only and flute buff estimate respects saturated speed',()=>{
 const r=setup();const before=JSON.stringify({stats:r.player.stats,items:[...r.player.items],buffs:[...r.player.buffs],temp:r.nativeRun.tempMods});
 const first=decision(r,'poke-flute').score;
 assert.equal(JSON.stringify({stats:r.player.stats,items:[...r.player.items],buffs:[...r.player.buffs],temp:r.nativeRun.tempMods}),before);
 r.nativeRun.tempMods=[{stat:'attackSpeed',mul:100}];r.player.recompute();
 assert(decision(r,'poke-flute').score<first);
});
test('small fusion growth can be chosen while a truly capped vitamin stays rejected',()=>{
 const r=setup();r.player.moves[0].def={key:'fu-t-ghost',arch:'fusion',dmg:100,cd:1,cls:'special'};
 // No shadow recompute: these are observed stats, so the test exercises the
 // conservative fallback without the fixture catalog's simplified vitamin body.
 r.player.recompute=undefined;r.player.stats.projectiles=0;
 r.player.vitamins.set('pp-up',{level:1,acc:1});r.player.vitaminSlots=3;
 assert(scoreOffer({kind:'upVit',vit:'pp-up',rarity:0},r,r.data)>0);
 r.player.moves[0].mods.count=10;
 assert(scoreOffer({kind:'upVit',vit:'pp-up',rarity:0},r,r.data)<0);
});
