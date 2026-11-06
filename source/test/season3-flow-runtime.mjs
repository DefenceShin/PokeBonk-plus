import fs from 'node:fs';
import assert from 'node:assert/strict';
import {openSeason3Fixture} from './season3-browser-fixture.mjs';
const {page,context,errors,task}=await openSeason3Fixture('current-flow');
try{
 const branch=await page.evaluate(()=>{
  const r=__M2_MAKE_RUN(133),p=__PB_PILOT,received=[];p.plan.evolutionTarget=134;
  r.state='modal';r.ui.showBranch(r,[134,135,136],value=>{received.push(value);r.resume();},{stay:133,stone:'use'});
  __M2_OLD_MODAL();p.handleModal();return {received,state:r.state,enabled:p.enabled,status:p.status};
 });
 fs.writeFileSync(new URL('evidence/branch-current-result.json',task),JSON.stringify(branch,null,2));
 assert.deepEqual(branch.received,[134],'native stay card preceding evolution cards must not change requested target');
 const fusion=await page.evaluate(()=>{
  const r=__M2_MAKE_RUN(1),p=__PB_PILOT,b=__PB_BRIDGE,n=__M2_NATIVE;
  const recipe=b.fusionRecipes.find(r=>r.kind==='signature'&&r.member===1);
  r.player.moves=recipe.moves.map(key=>{const move=new n.Move(b.moveDef(b.data.movesByKey.get(key).id));move.level=8;return move;});
  p.plan.build={sourceType:'custom',moveRules:[{key:recipe.key,priority:1,level:5}],allowOffPlan:false};
  const machine={kind:'bill',x:2,y:0,z:2,used:false};n.billOpen(r,machine);
  __M2_OLD_MODAL();p.handleModal();
  return {expected:recipe.key,fusions:r.fusions,moves:r.player.moves.filter(Boolean).map(m=>({key:m.def.key,link:!!m.link,parents:m.parents})),machineUsed:machine.used,state:r.state,status:p.status};
 });
 fs.writeFileSync(new URL('evidence/fusion-current-result.json',task),JSON.stringify(fusion,null,2));
 assert.deepEqual(fusion.fusions,[fusion.expected],'current native Bill page must confirm requested fusion, never merge');
 assert.equal(fusion.moves.length,1);assert.equal(fusion.moves[0].link,false);assert.equal(fusion.machineUsed,true);
 const dojo=await page.evaluate(()=>{
  const r=__M2_MAKE_RUN(1),p=__PB_PILOT,entity={kind:'dojo',data:{},used:false};r.openDojo(entity);
  if(!p.modal)p.handleModal();__M2_OLD_MODAL();p.handleModal();
  return {state:r.state,used:entity.used,trialStarted:!!r.dojo,enabled:p.enabled,status:p.status};
 });
 assert.equal(dojo.state,'play','optional current dojo page must use the native null exit, not choose a trial');assert.equal(dojo.used,false);assert.equal(dojo.trialStarted,false);
 const rift=await page.evaluate(()=>{
  const r=__M2_MAKE_RUN(1),p=__PB_PILOT;r.capture.canThrow=()=>false;r.allies.canThrow=()=>false;
  r.interactables.nearest={kind:'chest',x:1,y:0,z:1,used:false};
  r.rifts={run:r,entrance:{x:0,z:0},busy:false,nearEntrance:__M2_NATIVE.riftNear};
  const actual=p.nativeInteractionAction(r),tap=p.tap('interact',1);return {actual,tap};
 });
 assert.equal(rift.actual,'rift');assert.equal(rift.tap,false,'native Rift entrance owns E before capture/world; M2 must not enter it');
 const route=await page.evaluate(()=>{
  const r=__M2_MAKE_RUN(1),p=__PB_PILOT,scope={stage:'M2',automaticPlay:true,modeIds:['resources','map','autoManage'],biomeIds:['forest','desert','coast','glacier'],nativeModes:['standard'],tiers:[0,1,2]};
  p.compatibility.maintenanceScope=scope;__PB_BRIDGE.compatibility.maintenanceScope=scope;
  r.mode='expedition';r.expedition={};const allowed=p.automationAllowed();return {allowed,enabled:p.enabled,status:p.status};
 });
 assert.equal(route.allowed,false,'M2 must not control an out-of-scope native run');
 const unknown=await page.evaluate(()=>{
  const r=__M2_MAKE_RUN(1),p=__PB_PILOT;let clicks=0;
  r.state='modal';p.modal=null;const button=document.createElement('button');button.className='card';button.textContent='Unknown mandatory choice';button.onclick=()=>clicks++;
  const cards=document.createElement('div');cards.className='cards';cards.append(button);r.ui.modal(cards);
  p.handleModal();__M2_OLD_MODAL();p.handleModal();return {clicks,enabled:p.enabled,state:r.state,status:p.status};
 });
 fs.writeFileSync(new URL('evidence/unknown-current-result.json',task),JSON.stringify(unknown,null,2));
 assert.equal(unknown.clicks,0);assert.equal(unknown.enabled,false,'unknown mandatory page must request takeover without pretending the game is paused');
 assert.deepEqual(errors,[]);console.log('PASS real 0.9.8 branch and Bill callbacks/consumption');
}finally{await context.close();}
