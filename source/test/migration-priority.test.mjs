import test from 'node:test';
import assert from 'node:assert/strict';
import * as policy from '../src/policy.mjs';
import {chooseOfferAction} from '../src/choice-strategy.mjs';

function fixture(enabled=false) {
 const player={level:100,hp:100,maxHp:100,stats:{damage:1,physical:1,special:1,attackSpeed:1,critChance:0,critDamage:1.75,luck:125},items:new Map(),vitamins:new Map(),buffs:new Map(),moves:[{def:{key:'hit',arch:'strike',cls:'physical',dmg:50,cd:1},mods:{},level:8}],canHold:()=>true};
 const nativeRun={player,tower:{floor:40},gold:1000};player.run=nativeRun;
 const data={items:new Map([['weak',{key:'weak',max:10,mods:[{stat:'damage',mul:1.01}]}],['strong',{key:'strong',max:10,mods:[{stat:'damage',mul:2}]}],['lucky-egg',{key:'lucky-egg',max:10,mods:[{stat:'xpGain',mul:1.1}]}]])};
 return {player,nativeRun,data,experienceBlessingPriority:enabled,build:{itemRules:[{key:'weak',priority:-100},{key:'strong',priority:999}]}};
}
test('numeric priority cannot override actual item benefit in free choice, purchase or copying',()=>{
 const r=fixture();
 assert.equal(chooseOfferAction(['weak','strong'],r,r.data,{kind:'itemChoice'}).index,1);
 assert.equal(policy.evaluateShopPurchases([{key:'weak',price:1},{key:'strong',price:1}],r,r.data).index,1);
 r.player.items=new Map([['weak',1],['strong',1]]);
 assert.equal(policy.selectCopyItem(r.player,r.build,r.data,r),'strong');
});
test('shared comparison ignores numeric priority but retains experience preference',()=>{
 const weak={key:'weak',priority:-100,score:1},strong={key:'strong',priority:999,score:100};
 assert.deepEqual([weak,strong].sort(policy.compareOfferCandidates).map(x=>x.key),['strong','weak']);
 assert.equal([{...weak,experiencePriority:1},strong].sort(policy.compareOfferCandidates)[0].key,'weak');
});
test('experience toggle remains useful without numeric priority enforcement',()=>{
 const r=fixture(true);
 assert.equal(chooseOfferAction(['strong','lucky-egg'],r,r.data,{kind:'itemChoice'}).index,1);
 r.experienceBlessingPriority=false;
 assert.equal(chooseOfferAction(['strong','lucky-egg'],r,r.data,{kind:'itemChoice'}).index,0);
});
