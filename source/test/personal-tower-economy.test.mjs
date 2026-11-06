import test from 'node:test';
import assert from 'node:assert/strict';
import {towerChestBasePrice,towerCurseEconomy,chooseTowerCurseAction} from '../src/choice-strategy.mjs';

function fixture(overrides={}) {
  const player={level:100,types:['water'],stats:{luck:100,damage:1,physical:1,attackSpeed:1,critChance:0,critDamage:1.75},
    items:new Map(),vitamins:new Map(),moves:[{def:{key:'tackle',arch:'strike',cls:'physical',dmg:10,cd:1,type:'normal'},level:10}]},
    run={player,meta:{itemInPool:()=>true},banished:new Set(),tower:{floor:14},stage:4,chestsBought:0,shopBuys:[],gold:0,...overrides},
    data={items:new Map([
      ['muscle-band',{key:'muscle-band',rarity:1,max:10,mods:[{stat:'physical',mul:1.15}]}],
      ['scope-lens',{key:'scope-lens',rarity:2,max:10,mods:[{stat:'critDamage',add:.3}]}],
    ])};
  return {run,data,evaluate:options=>towerCurseEconomy(run,{data,...options}),
    choose:options=>chooseTowerCurseAction([{id:'dark'},{id:'graves'}],run,{data,...options})};
}

test('the curse forecast does not spend a second shop purchase on low value that the controller would defer',()=>{
  const h=fixture({gold:1e7,chestsBought:25,shopBuys:Array(12).fill(1)});
  h.data.items.delete('scope-lens');
  h.data.items.set('smoke-ball',{key:'smoke-ball',rarity:1,max:10,mods:[{stat:'evasion',add:.02}]});
  h.run.player.items.set('smoke-ball',7);
  // Future16F has one shop with these two items. Paid balls cost more than
  // this per-purchase budget. Buy muscle-band, reserve its next copy, skip smoke.
  const result=h.evaluate({rules:{maxSpend:20000}});
  assert(Math.abs(result.expectedPurchases.baseline-1)<1e-9);
});

test('audited reward and paid ball formula includes floors of growth, native rounding and the 80 minimum',()=>{
  for(const [bought,reward,price] of [[0,80,14],[5,92,115],[10,205,256],[15,1324,1655],[20,4725,5906],[25,19559,24449],[30,67113,83892]]) {
    const h=fixture({chestsBought:bought}), result=h.evaluate();
    assert.equal(result.gravesGold,reward);assert.equal(result.paidBallPrice,price);
    assert.equal(result.samples,96);
  }
  // Native 40/50 thresholds intentionally use (n-30), not (n-threshold).
  for(const n of [41,51]) {
    const growth=35*n+300*(n-10)+550*(n-20)+1200*(n-30)+2400*(n-30)+(n>50?4500*(n-30):0);
    assert.equal(towerChestBasePrice(n),18*((1.22**n+growth/30)*1.12**(n-12)));
  }
});

test('two cheap paid balls beat one free item, but cash that already funds the route favors dark',()=>{
  const poor=fixture();assert.equal(poor.choose().id,'graves');
  const rich=fixture({gold:1e7});assert.equal(rich.choose().id,'dark');
  const result=poor.evaluate();assert.ok(result.expectedPurchases.graves>result.expectedPurchases.baseline+1);
  assert.equal(result.reason,'extra-gold-buys-more-useful-items');
});

test('below-price gold alone cannot fund a ball; bridging a deficit can fund the stronger three-choice',()=>{
  const h=fixture({chestsBought:10,tower:{floor:20}});
  h.data.items.set('oran-berry',{key:'oran-berry',rarity:1,max:10,mods:[{stat:'maxHp',add:15}]});
  h.data.items.delete('muscle-band');h.data.items.delete('scope-lens');
  h.data.items.set('expert-belt',{key:'expert-belt',rarity:2,max:10,mods:[{stat:'damage',mul:2}]});
  assert.equal(h.choose().id,'dark');
  h.run.gold=51;
  assert.equal(h.choose().id,'graves');
  assert.equal(h.evaluate().expectedPurchases.baseline,0);
  assert.ok(h.evaluate().expectedPurchases.graves>.99);
});

test('shop schedule, actual heat and buying switches decide whether a large reward can be spent',()=>{
  const h=fixture({chestsBought:25});
  assert.equal(h.choose().id,'graves','floor16 has a native shop; reward buys both useful items');
  assert.equal(h.choose({rules:{shop:false}}).id,'dark','cannot afford next ball with gold alone');
  h.run.tower.floor=20;assert.equal(h.choose().id,'dark','floors21/22 have no shop');
  h.run.tower.floor=14;h.run.shopBuys=Array(40).fill(4);
  assert.equal(h.choose().id,'dark','native shop heat makes the stock unaffordable');
  assert.equal(h.evaluate().shopHeat,2**30);
});

test('forecast respects the seven-layout cycle and even-floor gate instead of inventing shops every other floor',()=>{
  const expected=[2,5,7,12,14,16,26,28], observed=[];
  for(let floor=1;floor<28;floor++) {
    const h=fixture({tower:{floor}}), next=h.evaluate().horizon[0];
    if(next.shop)observed.push(next.floor);
  }
  assert.deepEqual(observed,expected);
  const h=fixture({tower:{floor:20},chestsBought:25}), before=h.evaluate();
  h.run.shop={stage:219,stock:[{key:'muscle-band',price:1}]};
  assert.deepEqual(h.evaluate(),before,'previous-floor stock is not a known future bargain');
});

test('paid switch, per-purchase cap, total budget, reserves and already-spent money are respected',()=>{
  const h=fixture();
  for(const options of [{rules:{paid:false}},{rules:{maxSpend:0}},{rules:{totalBudget:0}},
    {rules:{goldReserve:80}},{rules:{totalBudget:14},spent:14}]) {
    assert.equal(h.choose(options).id,'dark',JSON.stringify(options));
  }
  const r=h.evaluate({rules:{maxSpend:14}});assert.ok(r.expectedPurchases.graves<=1.00001);
});

test('discounts change paid prices and shop costs; panel gold gain never multiplies graves',()=>{
  const h=fixture({chestsBought:20});h.run.player.stats.goldGain=999;
  h.run.player.items.set('big-nugget',5);h.run.player.items.set('gold-teeth',3);
  let r=h.evaluate();assert.equal(r.gravesGold,4725);assert.equal(r.paidBallPrice,3544);
  h.run.player.stats.luck=0;r=h.evaluate();assert.equal(r.paidBallPrice,4725);
  h.run.player.stats.luck=-100;assert.equal(h.evaluate().paidBallPrice,4725);
});

test('data gaps and native formula or layout drift have explicit conservative fallbacks',()=>{
  for(const field of ['gold','chestsBought','shopBuys','banished','player']) {
    const h=fixture();delete h.run[field];const d=h.choose();
    assert.equal(d.id,'dark');assert.equal(d.economy.reason,'economy-data-unavailable');
  }
  const h=fixture();h.run.shopHeat=100;assert.equal(h.evaluate().reason,'native-shop-formula-mismatch');
  delete h.run.shopHeat;h.run.interactables={chestCost:()=>999};assert.equal(h.evaluate().reason,'native-ball-formula-mismatch');
  delete h.run.interactables;h.run.tower.def={plan:{chests:[]}};assert.equal(h.evaluate().reason,'native-floor-layout-mismatch');
  delete h.run.tower.def;h.run.meta.itemInPool=()=>{throw Error('missing catalog');};
  assert.equal(h.evaluate().reason,'economy-evaluation-unavailable');
});

test('pool unlocks, cap, bans, channel exclusions remain active while numeric priorities are ignored',()=>{
  const h=fixture();
  h.run.meta.itemInPool=()=>false;assert.equal(h.evaluate().reason,'native-item-pool-empty');
  h.run.meta.itemInPool=()=>true;
  assert.equal(h.evaluate({build:{avoidItems:['muscle-band','scope-lens']}}).reason,'no-useful-item-purchases');
  h.run.player.items=new Map([['muscle-band',10],['scope-lens',10]]);
  assert.equal(h.evaluate().reason,'native-item-pool-empty');
  h.run.player.items=new Map();
  const build={itemRules:[{key:'muscle-band',priority:0,targetCount:1},{key:'scope-lens',priority:1,targetCount:1}]};
  const r=h.evaluate({build});assert.deepEqual(r.dimensions.slice(0,2),['automatic:benefit','automatic:defense']);
  assert.equal(r.extraGoldBenefit.length,2);assert.ok(r.extraGoldBenefit.every(Number.isFinite));
  h.run.chestsBought=25;
  assert.equal(h.choose({build:{itemRules:[{key:'muscle-band',shop:false},{key:'scope-lens',shop:false}]}}).id,'dark');
});

test('banished rarity fallback and all-banned fallback remain deterministic and nonmutating',()=>{
  const h=fixture(), before={items:[...h.run.player.items],shopBuys:[...h.run.shopBuys],gold:h.run.gold,bought:h.run.chestsBought};
  h.run.banished=new Set(['imuscle-band','iscope-lens']);
  const oldRandom=Math.random;Math.random=()=>{throw Error('must not use game RNG');};
  try {assert.deepEqual(h.evaluate(),h.evaluate());assert.equal(h.evaluate().samples,96);}
  finally {Math.random=oldRandom;}
  assert.deepEqual({items:[...h.run.player.items],shopBuys:[...h.run.shopBuys],gold:h.run.gold,bought:h.run.chestsBought},before);
});

test('graves only moves either side of dark; hunger and legal cards remain authoritative after floor66',()=>{
  const h=fixture();
  for(const gold of [0,1e7]) {
    h.run.gold=gold;
    const d=chooseTowerCurseAction(['twin','graves','iron','dark','hunger','swift'].map(id=>({id})),h.run,{data:h.data});
    assert.equal(d.id,'hunger');assert.deepEqual(d.candidates.slice(0,1).map(row=>row.id),['hunger']);
    assert.deepEqual(d.candidates.slice(3).map(row=>row.id),['swift','twin']);
    assert.equal(d.candidates.find(row=>row.id==='graves').score,gold===0?65:55);
  }
  h.run.gold=0;assert.equal(h.choose({legal:index=>index===0}).id,'dark');
  h.run.tower.floor=65;assert.equal(h.choose().action,'choose');
  h.run.tower.floor=66;assert.equal(h.choose().action,'choose');
});
