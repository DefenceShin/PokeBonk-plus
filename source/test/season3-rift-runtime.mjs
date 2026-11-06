import fs from 'node:fs';import assert from 'node:assert/strict';
import {openSeason3Fixture} from './season3-browser-fixture.mjs';
const {page,context,errors,task}=await openSeason3Fixture('rift-navigation');
try{const result=await page.evaluate(()=>{
 const r=__M2_MAKE_RUN(),p=__PB_PILOT;r.capture.canThrow=()=>false;r.allies.canThrow=()=>false;
 r.terrain.height=()=>0;r.terrain.inBounds=()=>true;r.capture.canWait=()=>false;r.capture.canInteract=()=>false;r.allies.mods=()=>[];
 r.rifts={run:r,entrance:{x:0,z:0},busy:false,nearEntrance:__M2_NATIVE.riftNear};
 const chest={kind:'chest',x:1,y:0,z:1,r:2.6,used:false};r.interactables.list=[chest];r.interactables.nearest=chest;r.interactables.chestCost=()=>0;
 const advanceTo=target=>{const nav=p.navigationFor(r);nav.begin(r.player.pos,target,target.radius);for(let i=0;i<100&&!nav.done&&!nav.failed;i++)nav.advance(45);if(!nav.done)throw Error('existing GridNavigator failed');let frames=0;for(;frames<200&&Math.hypot(target.x-r.player.pos.x,target.z-r.player.pos.z)>target.radius;frames++){const w=nav.waypoint(r.player.pos),dx=w.x-r.player.pos.x,dz=w.z-r.player.pos.z,d=Math.hypot(dx,dz);if(!d)break;const stride=Math.min(.15,d);r.player.pos.x+=dx/d*stride;r.player.pos.z+=dz/d*stride;}return frames;};
 r.player.radius=.55;r.player.grounded=true;r.terrain.walkClear=(x,z,dx,dz,length,radius)=>Math.abs(Math.hypot(dx,dz)-1)<1e-6&&length>0&&radius>0;
 const escape=p.chooseWorldTarget(r),escapeFrames=advanceTo(escape);
 const targets=[];for(let i=0;i<4;i++){const t=p.chooseWorldTarget(r);targets.push({id:t.id,kind:t.entity?.kind,x:t.x,z:t.z,avoid:!!t.riftAvoidance});}
 const approach=p.chooseWorldTarget(r),approachFrames=advanceTo(approach),outside=!r.rifts.nearEntrance(),owner=p.nativeInteractionAction(r);
 const settledTargets=[];for(let i=0;i<20;i++){r.time+=.2;const t=p.chooseWorldTarget(r);settledTargets.push({x:t.x,z:t.z,avoid:!!t.riftAvoidance});}
 r.player.pos.x=0;r.player.pos.z=0;r.terrain.walkClear=()=>false;p.enabled=true;const blocked=p.chooseWorldTarget(r);
 return {escape,escapeFrames,approachFrames,targets,outside,owner,settledTargets,blocked:{enabled:p.enabled,state:r.state,id:blocked.id},status:p.status};
});fs.writeFileSync(new URL('evidence/rift-navigation-result.json',task),JSON.stringify(result,null,2));assert.equal(result.escape.riftAvoidance,true);assert.ok(result.targets.every(t=>Math.hypot(t.x,t.z)>3.4),'after escaping, a nearby chest must use an approach outside the native rift E zone');assert.ok(result.escapeFrames>0);assert.ok(result.approachFrames>0);assert.equal(result.outside,true);assert.equal(result.owner,'world');assert.ok(result.settledTargets.every(t=>!t.avoid&&Math.hypot(t.x,t.z)>3.4));assert.equal(result.blocked.enabled,false);assert.equal(result.blocked.state,'play');assert.deepEqual(errors,[]);console.log('PASS rift exit does not immediately reacquire an inaccessible overlapping chest');}finally{await context.close();}
