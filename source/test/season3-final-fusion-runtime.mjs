import fs from 'node:fs';import assert from 'node:assert/strict';
import {openSeason3Fixture} from './season3-browser-fixture.mjs';
const {page,context,errors,task}=await openSeason3Fixture('final-fusion');
try{
 const results=await page.evaluate(()=>{
  const out=[];
  for(const scenario of ['final','disabled','underlevel','free-off','double','rejected']){
   const r=__M2_MAKE_RUN(),p=__PB_PILOT,b=__PB_BRIDGE,n=__M2_NATIVE,recipe=b.fusionRecipes.find(x=>x.kind==='signature'&&x.member===1);
   const count=scenario==='double'?2:1,targets=Array(count).fill(recipe.key);
   p.settings.finalReplacements={1:{fusion:{enabled:scenario!=='disabled',level:1,targets}}};
   p.settings.interactions={free:scenario!=='free-off'};p.plan.build={sourceType:'custom',allowOffPlan:false,moveRules:[]};
   r.player.moves=Array.from({length:count},()=>recipe.moves).flat().map(key=>{const m=new n.Move(b.moveDef(b.data.movesByKey.get(key).id));m.level=scenario==='underlevel'?7:8;return m;});
   if(scenario==='rejected')r.animate=()=>{throw Error('isolated native animation rejection')};
   const before=p.finalReplacement(r),machines=[];
   for(let i=0;i<(scenario==='rejected'?4:count);i++){const machine={kind:'bill',x:2,y:0,z:2,used:false};n.billOpen(r,machine);__M2_OLD_MODAL();p.handleModal();machines.push(machine.used);}
   out.push({scenario,key:recipe.key,before:{needsFusion:before.needsFusion,pending:before.fusion?.pending},after:{needsFusion:p.finalReplacement(r).needsFusion},fusions:r.fusions,moves:r.player.moves.filter(Boolean).map(m=>({key:m.def.key,link:!!m.link})),machines,attempts:[...p.finalFusionAttempts.values()],state:r.state});
  }return out;
 });
 fs.writeFileSync(new URL('evidence/final-fusion-current-result.json',task),JSON.stringify(results,null,2));
 for(const x of results){const expected=['final','double'].includes(x.scenario)?(x.scenario==='double'?2:1):0;assert.equal(x.fusions.length,expected,x.scenario);assert.equal(x.moves.some(m=>m.link),false);assert.equal(x.machines.filter(Boolean).length,x.scenario==='rejected'?3:expected);assert.equal(x.state,'play');if(x.scenario==='rejected')assert.equal(x.attempts.reduce((a,b)=>a+b,0),3,'reopening a rejected native fusion cannot exceed the existing three-attempt budget');if(expected){assert.ok(x.attempts.reduce((a,b)=>a+b,0)>=expected,'actual final fusion confirmations must count toward the existing finite retry budget');assert.equal(x.after.needsFusion,false);}}
 assert.deepEqual(errors,[]);console.log('PASS real Bill final replacement config, disabled/underlevel/free-off, duplicate copies, native consumption and finite attempt accounting');
}finally{await context.close();}
