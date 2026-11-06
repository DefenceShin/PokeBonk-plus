import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fixture,sandbox} from './benefit-fixture.mjs';
import {evaluatePlayerMods,evaluateOfferBenefit,scoreOffer,evaluateItemDecision,conditionalItemBenefit,selectCopyItem} from '../src/policy.mjs';
import {chooseOfferAction} from '../src/choice-strategy.mjs';

const speed={mods:[{stat:'attackSpeed',mul:1.2}]};
function run(arch='strike',mode='standard') {
  const r=fixture();r.player.moves[0].def.arch=arch;r.mode=mode;
  if(mode==='tower')r.nativeRun.tower={floor:30};
  return r;
}

for(const mode of ['standard','endless','tower'])test(`${mode}: meteor smite dash use ordinary cadence caps and preserve partial benefit`,()=>{
  for(const arch of ['meteor','smite','dash']){
    const r=run(arch,mode);r.nativeRun.tempMods=[{stat:'attackSpeed',mul:100}];r.player.recompute();
    assert.equal(evaluateOfferBenefit(speed,r).hardRejected,true,arch);
    assert.equal(scoreOffer(speed,r),-Infinity);
    r.nativeRun.tempMods=[{stat:'attackSpeed',mul:1}];r.player.recompute();
    assert.equal(evaluateOfferBenefit(speed,r).hardRejected,false);assert(scoreOffer(speed,r)>0);
  }
});

test('random scheduling remains estimated while known child cadence retains additive-group dilution',()=>{
  const r=run('random');r.nativeRun.tempMods=[{stat:'attackSpeed',mul:2}];r.player.recompute();
  const b=evaluateOfferBenefit(speed,r);
  assert(b.unknown.includes('random-submove-scheduling:hit'));assert.equal(b.hardRejected,false);
  assert.equal(b.after.attackSpeed,2.2);assert(b.mechanisms.length>300);
  assert(b.components.speed>0&&b.components.speed<.1);
  assert(scoreOffer(speed,r)>0);
});

test('one unknown cadence does not replace known global damage with legacy weights',()=>{
  const r=run();r.player.moves.push({def:{key:'future',arch:'future-unknown',dmg:1,cd:2,cls:'physical'},mods:{},level:8});
  const offer={mods:[{stat:'damage',mul:1.1}]};
  assert(evaluateOfferBenefit(offer,r).unknown.includes('future'));
  assert(Math.abs(scoreOffer(offer,r)-16.2)<1e-9);
});

test('an unknown item passive preserves its known double-critical modifier benefit',()=>{
  const r=run('strike','tower');
  r.nativeRun.tempMods.push({stat:'critChance',add:3},{stat:'critDamage',add:6.35-r.player.stats.critDamage});r.player.recompute();
  const mods=[{stat:'critChance',add:.08},{stat:'critDamage',add:.4}];
  sandbox.Kn=new Map([['dusk-stone',{mods,max:10}]]);
  try {
    const data={items:sandbox.Kn},item={kind:'item',id:'dusk-stone'};
    assert(evaluateOfferBenefit(item,r,data).unknown.includes('item-passive-uses-existing-native-aware-score'));
    assert(Math.abs(scoreOffer(item,r,data)-22.512871605335057)<1e-9);
    assert(Math.abs(scoreOffer(item,r,data)-scoreOffer({mods},r,data))<1e-9);
  } finally {sandbox.Kn=new Map();}
});

test('status items are eligible without skill status labels, including assumed trigger availability',()=>{
  sandbox.Kn=new Map([['power-herb',{mods:[{stat:'statusDamage',mul:1.3}],max:10}]]);
  try {
    for(const items of [[],[['flame-orb',1],['toxic-orb',1]]]){
      const r=run();r.player.items=new Map(items);r.player.recompute();
      assert(evaluateItemDecision('power-herb',r,{items:sandbox.Kn}).eligible);
      assert(scoreOffer({mods:[{stat:'statusChance',mul:1.2}]},r)>0);
    }
    const r=run();r.player.moves[0].def.arch='buff';assert.equal(scoreOffer({mods:[{stat:'statusDamage',mul:1.3}]},r),0);
  } finally {sandbox.Kn=new Map();}
});

test('poison fusion duration and area participate; normal fusion has no direct duration scaling',()=>{
  const r=run('fusion');r.player.moves[0].def.key='fu-t-poison';
  assert(scoreOffer({mods:[{stat:'duration',mul:1.2}]},r)>0);
  assert(scoreOffer({mods:[{stat:'area',mul:1.2}]},r)>0);
  r.player.moves[0].def.key='fu-t-normal';assert.equal(scoreOffer({mods:[{stat:'duration',mul:1.2}]},r),0);
});

test('ghost fusion impact area scales through its native homing impact helper',()=>{
  const r=run('fusion');r.player.moves[0].def.key='fu-t-ghost';
  assert(scoreOffer({mods:[{stat:'area',mul:1.2}]},r)>0);
});

test('fusion projectile increments respect poison three-extra and ghost six-extra limits',()=>{
  for(const [key,n,expected] of [['fu-t-poison',0,22.5],['fu-t-poison',3,0],['fu-t-ghost',0,22.5],['fu-t-ghost',3,0]]){
    const r=run('fusion');r.player.moves[0].def.key=key;r.player.moves[0].mods.count=n;r.player.stats.projectiles=0;
    const value=scoreOffer({mods:[{stat:'projectiles',add:1}]},r);
    assert(Math.abs(value-expected)<1e-9,`${key} ${n}: ${value}`);
  }
});

test('unreviewed fusion has a labelled capability estimate rather than a proven zero',()=>{
  const r=run('fusion');r.player.moves[0].def.key='fu-future';
  const b=evaluateOfferBenefit({mods:[{stat:'duration',mul:1.2}]},r);
  assert(b.unknown.some(x=>x.includes('fusion-capabilities')));
  assert(scoreOffer({mods:[{stat:'duration',mul:1.2}]},r)>0);
});

test('scope target multiplier has diminishing next-copy value and never claims total DPS',()=>{
  const r=run();const first=conditionalItemBenefit('silph-scope',r.player);
  assert(first?.gain>0);assert.equal(first.source,'estimated-marked-damage-share');
  r.player.items.set('silph-scope',1);const next=conditionalItemBenefit('silph-scope',r.player);
  assert(next.gain>0&&next.gain<first.gain);assert.equal(first.channelGain,.4);
  assert(Math.abs(next.channelGain-2/7)<1e-9);
});

test('new positive status score still obeys bans cap and benefit ranking',()=>{
  const r=run('strike','tower');r.player.items.set('power-herb',1);
  const data={items:new Map([['power-herb',{mods:[{stat:'statusDamage',mul:1.3}],max:2}],['attack',{mods:[{stat:'damage',mul:1.01}],max:2}]])};
  for(const extra of [{avoid:true},{targetCount:1}]){
    r.build={itemRules:[{key:'power-herb',priority:-5,...extra}]};
    assert.equal(evaluateItemDecision('power-herb',r,data).eligible,false);assert.equal(selectCopyItem(r.player,r.build,data,r),null);
  }
  r.build={itemRules:[{key:'power-herb',priority:0},{key:'attack',priority:1}]};
  assert.equal(chooseOfferAction(['attack','power-herb'],r,data,{kind:'itemChoice'}).index,0);
  assert.equal(selectCopyItem(r.player,r.build,data,r),null,'numeric priority cannot make a zero-benefit held item worth copying');
  r.player.items.set('power-herb',2);assert.equal(evaluateItemDecision('power-herb',r,data).eligible,false);
});

test('all 126 retained items ignore numeric priority and retain caps across ball shop copy',()=>{
  const catalog=JSON.parse(readFileSync(new URL('./benefit-item-catalog.json',import.meta.url),'utf8'));
  assert.equal(catalog.version,'0.8.55');assert.equal(catalog.items.length,126);
  sandbox.Kn=new Map(catalog.items.map(d=>[d.key,d]));const data={items:sandbox.Kn};
  try {
    for(const mode of ['standard','endless','tower'])for(const def of catalog.items)for(let count=0;count<=(def.max??10);count++){
      const r=run('strike',mode);if(count)r.player.items.set(def.key,count);r.player.recompute();
      r.build={itemRules:[{key:def.key,priority:0}]};r.player.canHold=key=>(r.player.items.get(key)||0)<(data.items.get(key).max??10);
      const allowed=count<(def.max??10),before=JSON.stringify({stats:r.player.stats,items:[...r.player.items],mods:r.nativeRun.tempMods});
      const shop=evaluateItemDecision(def.key,{...r,purpose:'shop'},data);
      const automatic={...r,build:{itemRules:[{key:def.key}]}};
      assert.equal(shop.eligible,evaluateItemDecision(def.key,{...automatic,purpose:'shop'},data).eligible,`${mode} ${def.key} ${count} shop`);
      if(!allowed)assert.equal(shop.eligible,false);
      assert.equal(chooseOfferAction([def.key],r,data,{kind:'itemChoice'}).index,allowed?0:null,`${def.key} ${count} ball`);
      if(count)assert.equal(selectCopyItem(r.player,r.build,data,r),selectCopyItem(r.player,automatic.build,data,automatic),`${def.key} ${count} copy`);
      assert.equal(JSON.stringify({stats:r.player.stats,items:[...r.player.items],mods:r.nativeRun.tempMods}),before);
    }
  } finally {sandbox.Kn=new Map();}
});
