import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,sandbox} from './benefit-fixture.mjs';
import {chooseOfferAction} from '../src/choice-strategy.mjs';
const keys=['star-piece-v','exp-candy','super-lure','pp-up','calcium'];
const defs=new Map([...keys,'cursed'].map((key,i)=>[key,{key,stat:['luck','xpGain','eliteSpawn','projectiles','special','difficulty'][i],per:.1,kind:'mul',...(key==='cursed'?{extra:[{stat:'xpGain',mul:.06}]}:{})}]));
for(const on of [true,false])for(const heldCount of [0,4])test('custom five vitamin slots stay reserved at '+heldCount+' held; XP '+on,()=>{
 const h=fixture();sandbox.Tt=defs;h.data.vitamins=defs;h.nativeRun.tower={floor:26};h.experienceBlessingPriority=on;h.player.vitaminSlots=5;h.player.level=80;
 for(const k of keys.slice(0,heldCount))h.player.vitamins.set(k,{level:2,acc:2});
 h.build={sourceType:'custom',allowOffPlan:true,vitaminPriority:keys,vitaminRules:keys.map(key=>({key,priority:1,avoid:false}))};
 const card=k=>({kind:'newVit',vit:k,key:'v'+k,rarity:1});
 const pick=chooseOfferAction([card('cursed'),card('calcium')],h,h.data,{kind:'upgrade'});assert.equal(pick.index,1);
 const only=chooseOfferAction([card('cursed')],h,h.data,{kind:'upgrade',rerollLegal:true,rerolls:1});assert.notEqual(only.action,'choose');
});
