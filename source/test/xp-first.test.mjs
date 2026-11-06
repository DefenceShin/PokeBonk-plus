import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fixture,sandbox} from './benefit-fixture.mjs';
import {chooseOfferAction,chooseTowerCurseAction,chooseNativeTrade} from '../src/choice-strategy.mjs';
import {evaluateShopPurchases,offerExperiencePriority} from '../src/policy.mjs';
const catalog=JSON.parse(readFileSync(new URL('./benefit-item-catalog.json',import.meta.url)));
function setup(enabled=true){
 const h=fixture();h.experienceBlessingPriority=enabled;h.nativeRun.tower={floor:26};h.player.level=100;
 h.data.items=new Map(catalog.items.map(d=>[d.key,d]));h.data.items.set('damage',{key:'damage',rarity:0,mods:[{stat:'damage',mul:100}]});
 sandbox.Kn=h.data.items;h.player.canHold=k=>(h.player.items.get(k)||0)<(h.data.items.get(k)?.max??10);
 Object.assign(h.nativeRun,{gold:10000,chestsBought:0,shopBuys:[],stage:1});return h;
}
for(const enabled of [true,false])test(`direct damage blessing precedes XP: ${enabled}`,()=>{
 const h=setup(enabled),offers=[{mods:[{stat:'damage',mul:100}]},{mods:[{stat:'xpGain',mul:1.01}]}];
 assert.equal(chooseOfferAction(offers,h,h.data,{kind:'blessing',experienceBlessingPriority:enabled}).index,0);
});
test('tower blessing ranks legal general damage above XP and XP above other stats',()=>{
 const h=setup(),xp={mods:[{stat:'xpGain',mul:1.315}]},dmg={mods:[{stat:'damage',mul:1.05}]},special={mods:[{stat:'special',mul:1.5}]};
 const pick=cards=>chooseOfferAction(cards,h,h.data,{kind:'blessing'}).index;
 assert.equal(pick([xp,special,dmg]),2);
 assert.equal(pick([special,xp,{...dmg,disabled:true}]),1);
 assert.equal(pick([xp,{mods:[{stat:'damage',mul:.9}]}]),0);
});
for(const enabled of [true,false])test(`twin curse beats old highest and configured order: ${enabled}`,()=>{
 const h=setup(enabled);const d=chooseTowerCurseAction([{id:'hunger'},{id:'twin'}],h.nativeRun,{experienceBlessingPriority:enabled,cursePriority:['hunger','twin']});
 assert.equal(d.id,enabled?'twin':'hunger');
 assert.equal(chooseTowerCurseAction([{id:'hunger'},{id:'twin',disabled:true}],h.nativeRun,{experienceBlessingPriority:enabled}).id,'hunger');
});
test('planned candy can still be acquired without the experience override',()=>{
 const h=setup();h.player.vitaminSlots=3;h.data.vitamins=new Map(h.data.vitamins).set('exp-candy',{key:'exp-candy',stat:'xpGain',kind:'mul',per:.1}).set('star-piece-v',{key:'star-piece-v',stat:'luck',kind:'add',per:2});
 sandbox.Tt=h.data.vitamins;h.player.vitamins.set('star-piece-v',{level:1,acc:1});h.player.recompute();
 h.build={vitamins:['star-piece-v','exp-candy'],vitaminPriority:['star-piece-v','exp-candy']};
 const cards=[{kind:'upVit',vit:'star-piece-v',key:'vstar-piece-v',rarity:3},{kind:'newVit',vit:'exp-candy',key:'vexp-candy',rarity:0}];
 const on=chooseOfferAction(cards,h,h.data,{kind:'upgrade'});assert.notEqual(on.reason,'experience-first');h.experienceBlessingPriority=false;assert.equal(on.index,chooseOfferAction(cards,h,h.data,{kind:'upgrade'}).index);
});
test('shop XP is not deferred for another XP item absent from the shop',()=>{
 const h=setup();h.nativeRun.gold=100;h.data.items.set('later-xp',{key:'later-xp',rarity:0,mods:[{stat:'xpGain',mul:100}]});h.nativeRun.meta={itemInPool:()=>true};
 const d=evaluateShopPurchases([{key:'lucky-egg',price:100}],h,h.data);
 assert.equal(d.index,0);assert.equal(d.evaluations[0].coreReserve,0);
});
test('XP switch makes tombstone treat beat trick, keeps off path',()=>{
 const h=setup();const page={offers:[{key:'trick'},{key:'treat'}]};
 assert.equal(chooseNativeTrade(page,h,h.data,{kind:'tower',towerTrick:true}).key,'treat');
 h.experienceBlessingPriority=false;
 assert.equal(chooseNativeTrade(page,h,h.data,{kind:'tower',towerTrick:true}).key,'trick');
});

for(const key of ['lucky-egg','exp-share','macho-brace','white-flute','rare-candy'])test(`${key}: channel ordering and hard limits`,()=>{
 const h=setup();h.build={towerStrategy:{itemPriorities:['damage'],vitaminPriorities:[]},itemRules:[{key:'damage',priority:-999}]};
 h.player.items.set('damage',1);h.player.items.set(key,1);h.player.recompute();
 const stock=[{key:'damage',price:1},{key,price:10000}];
 for(const spendAll of [false,true])assert.equal(evaluateShopPurchases(stock,h,h.data,{spendAll}).index,1);
 assert.equal(chooseOfferAction(['damage',key],h,h.data,{kind:'itemChoice'}).index,1);
 assert.equal(evaluateShopPurchases(stock,h,h.data,{legal:i=>i===0}).index,0);
 h.nativeRun.gold=9999;assert.equal(evaluateShopPurchases(stock,h,h.data).index,0);
 h.nativeRun.gold=10000;h.player.items.set(key,h.data.items.get(key).max??10);
 assert.equal(evaluateShopPurchases(stock,h,h.data).index,0);
 assert.equal(chooseOfferAction(['damage',key],h,h.data,{kind:'itemChoice'}).index,0);
});
test('classification ignores fake labels, pickup radius, dice chance and net-negative XP mods',()=>{
 const h=setup();
 for(const offer of [{name:'经验 +100%'},{mods:[{stat:'xpMult',mul:100}]},{mods:[{stat:'pickupRange',add:100}]},{mods:[{stat:'xpGain',mul:1.1},{stat:'xpGain',mul:.5}]},{kind:'newMove',id:1,mods:[{stat:'xpGain',mul:2}]}])
  assert.equal(offerExperiencePriority(offer,h,h.data),0);
 assert.equal(offerExperiencePriority({kind:'item',id:'rare-candy'},h,h.data),1);
 assert.equal(offerExperiencePriority({kind:'newVit',vit:'exp-candy'},h,h.data),0);
 assert.equal(offerExperiencePriority({kind:'item',id:'unknown-xp'},h,h.data),0);
});
test('native XP vitamin caps, no slots, avoidance, strict choices and disabled cards remain hard',()=>{
 const h=setup();h.player.vitaminSlots=1;h.data.vitamins=new Map([['exp-candy',{key:'exp-candy',stat:'xpGain',per:.1,kind:'mul'}]]);
 const xp={kind:'newVit',vit:'exp-candy',key:'vexp-candy',rarity:0},damage={mods:[{stat:'damage',mul:100}]};
 h.build={avoidVitamins:['exp-candy']};assert.equal(chooseOfferAction([damage,xp],h,h.data).index,0);
 h.build={};assert.equal(chooseOfferAction([damage,{...xp,disabled:true}],h,h.data).index,0);
 h.player.vitaminSlots=0;assert.equal(chooseOfferAction([damage,xp],h,h.data).index,0);
 h.player.vitaminSlots=1;h.player.vitamins.set('exp-candy',{level:10,acc:10});
 assert.equal(chooseOfferAction([damage,{...xp,kind:'upVit'}],h,h.data).index,0);
 h.player.vitamins.clear();h.finalReplacement={strictVitamins:{enabled:true,targets:['ether']}};
 assert.notEqual(chooseOfferAction([damage,xp],h,h.data).index,1);
});

test('vitamins stay outside the tower XP override',()=>{
 const h=setup();assert.equal(offerExperiencePriority({kind:'newVit',vit:'cursed'},h,h.data),0);
 assert.equal(offerExperiencePriority({kind:'newVit',vit:'loaded-dice'},h,h.data),0);
 h.player.vitaminSlots=2;
 assert.notEqual(chooseOfferAction([{mods:[{stat:'damage',mul:100}]},{kind:'newVit',vit:'exp-candy',key:'vexp-candy'}],h,h.data).reason,'experience-first');
});

test('explicit XP exclusions remain hard even when upstream forced cost mode is enabled',()=>{
 const h=setup();h.costPolicy={forceCostInteractions:true};h.build={avoidItems:['macho-brace'],avoidVitamins:['cursed']};h.player.vitaminSlots=2;
 assert.equal(chooseOfferAction(['damage','macho-brace'],h,h.data,{kind:'itemChoice'}).index,0);
 assert.notEqual(chooseOfferAction([{mods:[{stat:'damage',mul:100}]},{kind:'newVit',vit:'cursed',key:'vcursed'}],h,h.data).index,1);
});
