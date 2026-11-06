import fs from 'node:fs';import assert from 'node:assert/strict';import {openSeason3Fixture} from './season3-browser-fixture.mjs';
const f=await openSeason3Fixture('portal-controller');try{const result=await f.page.evaluate(()=>{
 const r=__M2_MAKE_RUN(),p=__PB_PILOT,events=[];r.stage=1;r.stageTime=400;r.stageCleared=true;r.regionCleared=true;
 Object.assign(r.player,{vel:{x:0,y:0,z:0},grounded:true,radius:.55,kx:0,kz:0,crowdX:0,crowdZ:0,slideCd:0});
 Object.assign(r.terrain,{height:()=>0,inBounds:()=>true,waterAt:()=>-10,hitProp:()=>false});
 r.capture.canThrow=()=>false;r.capture.canWait=()=>false;r.allies.canThrow=()=>false;
 r.boss.alive=false;r.mewtwo={active:false};p.settings.portalPriority=true;p.clearNotice={stage:r.stage,time:0};const portal={kind:'portal',x:0,y:0,z:0,r:3,used:false};r.interactables.list=[portal];r.interactables.nearest=portal;
 r.$z57n2s=async()=>{events.push('next-stage');r.stage++};r.finish=won=>{events.push(won?'victory':'failure');r.state='over';r.sent=true;};
 const world=Object.assign(Object.create(__M2_NATIVE.World.prototype),{run:r});
 const listener=e=>{if(e.code==='KeyE'){events.push('E');world.interact(portal);}};window.addEventListener('keydown',listener);
 try{p.chooseWorldTarget(r);r.time+=10;r.realTime+=10;r.stageTime+=10;p.target=p.chooseWorldTarget(r);p.lastWorld=r.time;p.step(r,.016);return {events,state:r.state,stage:r.stage,status:p.status,enabled:p.enabled,target:p.target,stageCleared:r.stageCleared,desc:p.worldInteractionDescription(r,portal),progression:p.progressionDecision,flight:p.flightState(r)};}finally{window.removeEventListener('keydown',listener);}
 });fs.writeFileSync(new URL('evidence/portal-controller-result.json',f.task),JSON.stringify(result,null,2));assert.ok(result.events.includes('E'));assert.ok(result.events.includes('next-stage'));assert.equal(result.stage,2);assert.deepEqual(f.errors,[]);console.log('PASS current Pilot.step -> E -> actual native World.interact -> actual native enterPortal -> stage transition');}finally{await f.context.close();}
