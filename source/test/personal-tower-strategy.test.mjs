import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreOffer,playerBenefitContext,towerLuckFactor,evaluateItemDecision,compareOfferCandidates,selectCopyItem,conditionalItemBenefit,canSpendGold} from '../src/policy.mjs';
import {chooseOfferAction,chooseTowerCurseAction} from '../src/choice-strategy.mjs';

function fixture() {
  const player={level:20,hp:100,maxHp:100,speciesId:99,ability:'hyper-cutter',noHitT:20,
    stats:{damage:1,physical:1,special:1,attackSpeed:1,critChance:0,critDamage:1.75,armor:100,luck:0,statusChance:1},
    moves:[{def:{key:'strike',arch:'strike',cls:'physical',dmg:50,cd:1},level:8,mods:{}}],
    items:new Map(),vitamins:new Map(),buffs:new Map(),moveSlots:1,vitaminSlots:0,capOf:()=>8,canHold:()=>true};
  const data={items:new Map([
    ['health',{max:10,mods:[{stat:'maxHp',add:1000}]}],
    ['attack',{max:10,mods:[{stat:'damage',mul:1.5}]}],
    ['tiny',{max:10,mods:[{stat:'damage',mul:1.00001}]}],
    // A proven no-op, not an unknown modless native passive (retained free).
    ['zero',{max:10,mods:[{stat:'damage',mul:1}]}],
    ['bad',{max:10,mods:[{stat:'moveSpeed',mul:.8}]}],
    ['star-piece',{max:10,mods:[{stat:'luck',add:10}]}],
    ['star-dust',{max:10,mods:[{stat:'area',mul:1.1}]}],
    ['thick-club',{max:2,mods:[]}],
    ['binding-band',{max:5,mods:[]}],
    ['metronome',{max:10,mods:[]}],
  ])};
  const nativeRun={tower:{floor:30},player,tempMods:[],time:100};player.run=nativeRun;
  return {player,nativeRun,data,build:{},objective:'event',mode:'tower'};
}
const bless=(stat,add)=>({mods:[{stat,add}]});

test('native tower context survives event objective; other modes keep survival behavior',()=>{
  const r=fixture();assert.equal(playerBenefitContext(r).weights.survival,.01);
  assert.equal(playerBenefitContext(r).tower,true);
  r.player.hp=1;assert.equal(playerBenefitContext(r).weights.survival,.01);
  delete r.nativeRun.tower;r.mode='standard';
  assert.equal(playerBenefitContext(r).tower,false);assert.ok(playerBenefitContext(r).weights.survival>1);
});

test('tower blessings compare actual value without a fixed pure-defense category penalty',()=>{
  const r=fixture(),offers=[bless('maxHp',100000),{mods:[{stat:'damage',mul:1.00001}]}];
  const d=chooseOfferAction(offers,r,r.data,{kind:'blessing'});
  assert.equal(d.index,0);assert.ok(d.candidates.every(c=>c.utilityTier===0));
  const mixed={mods:[{stat:'maxHp',add:100}, {stat:'damage',mul:1.2}]};
  assert.ok(scoreOffer(mixed,r,r.data)>0);assert.equal(chooseOfferAction([mixed],r,r.data,{kind:'blessing'}).candidates[0].utilityTier,0);
});

test('armor gains retain club offense only before armor 100',()=>{
  const r=fixture();r.player.items.set('thick-club',2);r.player.stats.armor=90;
  const low=scoreOffer(bless('armor',10),r,r.data);
  assert.equal(chooseOfferAction([bless('armor',10)],r,r.data,{kind:'blessing'}).candidates[0].utilityTier,0);
  r.player.stats.armor=100;const high=scoreOffer(bless('armor',10),r,r.data);
  assert.ok(low>high*10);assert.equal(chooseOfferAction([bless('armor',10)],r,r.data,{kind:'blessing'}).candidates[0].utilityTier,0);
});

test('luck follows level anchors and current luck, independently of time; area is unchanged',()=>{
  const r=fixture(),offer={kind:'item',id:'star-piece'};
  for(const [lv,factor] of [[1,2],[50,2],[100,1],[200,.25],[300,.05],[500,.05]]) assert.ok(Math.abs(towerLuckFactor(lv)-factor)<1e-12);
  const before=scoreOffer(offer,r,r.data);r.nativeRun.time=20000;assert.equal(scoreOffer(offer,r,r.data),before);
  const area=scoreOffer({kind:'item',id:'star-dust'},r,r.data);
  r.player.level=300;assert.ok(scoreOffer(offer,r,r.data)<before/30);
  assert.equal(scoreOffer({kind:'item',id:'star-dust'},r,r.data),area);
  const noLuck=scoreOffer(offer,r,r.data);r.player.stats.luck=1000;assert.ok(scoreOffer(offer,r,r.data)<noLuck/10);
  assert.ok(Math.abs(playerBenefitContext(r).luckFactor-.05)<1e-12);
});

test('numeric priority does not override benefit across ball shop and copy',()=>{
  for(const key of ['zero','bad','health']) {
    const r=fixture();r.build={itemRules:[{key,priority:-1},{key:'attack',priority:0}]};
    const d=chooseOfferAction(['attack',key],r,r.data,{kind:'itemChoice'});assert.equal(d.index,0);
    const shop=['attack',key].map(k=>evaluateItemDecision(k,{...r,purpose:'shop'},r.data)).filter(c=>c.eligible).sort(compareOfferCandidates);
    assert.equal(shop[0].key,'attack');
    r.player.items.set('attack',1);r.player.items.set(key,1);
    assert.equal(selectCopyItem(r.player,r.build,r.data,r),'attack');
  }
});

test('same priority uses benefit and then shop price, independent of list order',()=>{
  const r=fixture();
  for(const keys of [['health','attack'],['attack','health']]) {
    r.build={items:keys,itemRules:keys.map(key=>({key,priority:0}))};
    assert.equal(chooseOfferAction(['health','attack'],r,r.data,{kind:'itemChoice'}).index,1);
  }
  assert.deepEqual([{key:'b',priority:0,score:10,price:20},{key:'a',priority:0,score:10,price:30}].sort(compareOfferCandidates).map(x=>x.key),['b','a']);
  r.build={itemRules:[{key:'zero',priority:100}]};
  assert.equal(chooseOfferAction(['attack','zero'],r,r.data,{kind:'itemChoice'}).index,0,'numeric priority no longer precedes benefit');
});

test('manual priority cannot bypass bans, counts, native legality, channel permissions or budget',()=>{
  for(const extra of [{avoid:true},{targetCount:1},{shop:false}]) {
    const r=fixture();r.player.items.set('zero',1);r.build={itemRules:[{key:'zero',priority:-100,...extra}]};
    assert.equal(evaluateItemDecision('zero',{...r,purpose:'shop'},r.data).eligible,false);
  }
  const r=fixture();r.build={itemRules:[{key:'zero',priority:-100,copy:false}]};r.player.items.set('zero',1);
  assert.equal(selectCopyItem(r.player,r.build,r.data,r),null);
  assert.equal(chooseOfferAction(['zero','attack'],r,r.data,{kind:'itemChoice',legal:i=>i===1}).index,1);
  assert.equal(canSpendGold(101,100),false);assert.equal(canSpendGold(20,100,{totalBudget:25},10),false);
  r.player.canHold=()=>false;assert.equal(evaluateItemDecision('zero',r,r.data).eligible,false);
});

test('zero items are taken free but not copied, and mixed useful items rank first',()=>{
  const r=fixture();assert.equal(chooseOfferAction(['zero','attack'],r,r.data,{kind:'itemChoice'}).index,1);
  assert.equal(chooseOfferAction(['zero'],r,r.data,{kind:'itemChoice'}).index,0);
  r.player.items.set('zero',1);assert.equal(selectCopyItem(r.player,{},r.data,r),null);
});

test('conditional items use passive/item control sources and diminishing extra-copy returns',()=>{
  const r=fixture();assert.ok(scoreOffer({kind:'item',id:'binding-band'},r,r.data)>0,'hyper-cutter strike is a real control source');
  r.player.ability='none';assert.equal(conditionalItemBenefit('binding-band',r.player).gain,0);
  for(const key of ['snowball','grip-claw','awakening']) {
    r.player.items=new Map([[key,1]]);assert.ok(conditionalItemBenefit('binding-band',r.player).gain>0);
  }
  r.player.items=new Map();const first=conditionalItemBenefit('metronome',r.player).gain;
  r.player.items.set('metronome',5);assert.ok(conditionalItemBenefit('metronome',r.player).gain<first);
  r.player.noHitT=5;assert.ok(conditionalItemBenefit('metronome',r.player).gain<.1);
  r.player.noHitT=0;assert.equal(conditionalItemBenefit('metronome',r.player).gain,0);
});

test('non-HP curses remain accepted after destination 66, including graves alone',()=>{
  for(const id of ['hunger','dark','swift','twin','graves']) {
    assert.equal(chooseTowerCurseAction([{id}],{tower:{floor:65}}).id,id);
    assert.equal(chooseTowerCurseAction([{id}],{tower:{floor:66}}).id,id);
  }
  const d=chooseTowerCurseAction([{id:'graves'},{id:'hunger'}],{tower:{floor:65}});
  assert.equal(d.id,'hunger');assert.equal(d.score,100);assert.equal(d.candidates[1].score,55);
});
