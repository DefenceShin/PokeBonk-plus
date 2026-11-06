import fs from 'node:fs';
import assert from 'node:assert/strict';
import {openSeason3Fixture} from './season3-browser-fixture.mjs';
const {page,context,errors,task}=await openSeason3Fixture('upgrade-shop');
try{
 const upgrades=await page.evaluate(()=>{
  const results=[];
  for(const slots of [1,5]){
   const r=__M2_MAKE_RUN(),p=__PB_PILOT,chosen=[];r.player.vitaminSlots=slots;
   p.plan.build={sourceType:'custom',allowOffPlan:false,vitaminRules:[{key:'calcium',priority:1}],vitaminPriority:['calcium']};
   const offers=['protein','calcium'].map(vit=>({kind:'newVit',vit,key:'v'+vit,rarity:0}));
   r.state='modal';r.ui.showLevelUp(r,offers,(offer,reason)=>{chosen.push({offer,reason});if(offer)__M2_APPLY_OFFER(r,offer);r.resume();});
   __M2_OLD_MODAL();p.handleModal();results.push({slots,chosen,vitamins:[...r.player.vitamins],state:r.state});
  }
  return results;
 });
 fs.writeFileSync(new URL('evidence/upgrade-current-result.json',task),JSON.stringify(upgrades,null,2));
 for(const u of upgrades){assert.equal(u.chosen[0]?.offer?.vit,'calcium');assert.equal(u.vitamins.length,1);assert.equal(u.vitamins[0][0],'calcium');assert.equal(u.state,'play');}
 const shops=await page.evaluate(()=>{
  const results=[];
  for(const scenario of ['buy','poor','avoid','full']){
   const r=__M2_MAKE_RUN(),p=__PB_PILOT,key='charcoal',price=100;
   r.player.typeHeld=new Set();r.player.evoStage=0;r.player.growth=0;r.allies.mods=()=>[];delete r.player.recompute;r.player.recompute();
   const def=__PB_BRIDGE.data.movesByKey.get('ember');r.player.moves[0]=new __M2_NATIVE.Move(__PB_BRIDGE.moveDef(def.id));
   p.plan.build={sourceType:'custom',allowOffPlan:false,itemRules:[{key,priority:1,targetCount:1}],itemPriority:[key],avoidItems:scenario==='avoid'?[key]:[]};
   r.gold=scenario==='poor'?0:1000;if(scenario==='full')r.player.items.set(key,10);
   r.shop={stock:[{key,price,sold:false}],rerolls:0};r.state='modal';r.ui.showShop(r,()=>r.resume());
   __M2_OLD_MODAL();const decision=p.costModalDecision(p.modal,r.ui.modalEl);p.handleModal();results.push({decision,scenario,gold:r.gold,count:r.player.items.get(key)||0,sold:r.shop.stock[0].sold,spent:r.goldSpent,buys:r.shopBuys,state:r.state});
  }return results;
 });
 fs.writeFileSync(new URL('evidence/shop-current-result.json',task),JSON.stringify(shops,null,2));
 const buy=shops[0];assert.equal(buy.count,1);assert.equal(buy.gold,900);assert.equal(buy.spent,100);assert.equal(buy.sold,true);assert.equal(buy.buys.length,1);
 for(const x of shops.slice(1)){assert.equal(x.spent,0);assert.equal(x.sold,false);assert.equal(x.count,x.scenario==='full'?10:0);}
 assert.deepEqual(errors,[]);console.log('PASS actual current upgrade/shop UI -> Pilot -> original native application, plan slots, native payment, explicit avoidance/cap/poverty');
}finally{await context.close();}
