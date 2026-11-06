import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {scoreOffer,evaluateOfferBenefit} from '../src/policy.mjs';
import {fixture} from './benefit-fixture.mjs';
const catalog=JSON.parse(readFileSync(new URL('../research/update-1.5.1-055-runtime-definitions.json',import.meta.url),'utf8'));
test('all055 fusion capabilities including random recipe pools are known',()=>{
 for(const d of catalog.fusionMoves){
  const r=fixture();r.player.moves[0].def=d;
  const b=evaluateOfferBenefit({mods:[{stat:'area',mul:1.2}]},r);
  assert.equal(b.unknown.some(s=>s.startsWith('fusion-capabilities:')),false,d.key);
 }
});
test('native055 fusion radius stops growing at3.4 including move-specific area',()=>{
 for(const key of ['fu-t-poison','fu-t-ghost','fu-t-normal','fu-92']){
  const r=fixture();r.player.moves[0].def=catalog.fusionMoves.find(m=>m.key===key);
  r.player.moves[0].mods.area=4;
  assert.equal(scoreOffer({mods:[{stat:'area',mul:1.2}]},r),0,key);
 }
});
test('055 fusion repeated casts add output even if their own projectile channel is absent',()=>{
 const d=catalog.fusionMoves.find(m=>m.recipe.repeats&&!m.recipe.info.count&&!m.recipe.info.random);
 assert(d);
 const r=fixture();r.player.moves[0].def=d;
 assert(scoreOffer({mods:[{stat:'projectiles',add:1}]},r)>0,d.key);
 r.nativeRun.tempMods.push({stat:'projectiles',add:20});r.player.recompute();
 assert.equal(scoreOffer({mods:[{stat:'projectiles',add:1}]},r),0,d.key+' repeats capped');
});
