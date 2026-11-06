import fs from 'node:fs';import assert from 'node:assert/strict';import {openSeason3Fixture} from './season3-browser-fixture.mjs';
const f=await openSeason3Fixture('m3-relic-native');try{const results=await f.page.evaluate(()=>{
 const out=[];
 for(const full of [false,true]){
  const r=__M2_MAKE_RUN(),p=__PB_PILOT,n=__M3_NATIVE,counts={};r.relicKeys=full?['c-coin','c-fang','c-amber']:[];r.relics=new n.Relics(r);r.meta.count=(key,num)=>counts[key]=(counts[key]||0)+num;
  r.player.typeHeld=new Set();r.player.evoStage=0;r.player.growth=0;r.allies.mods=()=>[];delete r.player.recompute;r.player.recompute();
  const before={keys:r.relicKeys.slice(),hp:r.player.maxHp};r.relics.cards=()=>[n.relicMap.get('l-dragon'),n.relicMap.get('c-feather')];r.relics.offer(2);
  if(!p.modal)p.handleModal();__M2_OLD_MODAL();p.handleModal();out.push({full,before,keys:r.relicKeys.slice(),hp:r.player.maxHp,state:r.state,enabled:p.enabled,counts,status:p.status});
 }return out;
});fs.writeFileSync(new URL('evidence/relic-native-result.json',f.task),JSON.stringify(results,null,2));for(const x of results){assert.ok(x.keys.includes('l-dragon'),'Pilot must handle the actual mandatory native relic page, not unknown-page takeover');assert.equal(x.keys.length,x.full?3:1);assert.equal(x.state,'play');assert.equal(x.counts.relics,1);assert.equal(x.counts.relics_legend,1);assert.ok(x.hp>x.before.hp);}assert.deepEqual(f.errors,[]);console.log('PASS actual native Relics.offer -> relicChoice UI -> Pilot original callback -> native take/recompute/resume, free slot and full three-slot replacement');}finally{await f.context.close();}
