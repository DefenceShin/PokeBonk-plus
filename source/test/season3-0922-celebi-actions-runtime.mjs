import fs from 'node:fs';import assert from 'node:assert/strict';import{openSeason3Fixture}from './season3-0922-browser-fixture.mjs';import{prepareBossFixture}from './season3-0922-boss-fixture.mjs';
const f=await openSeason3Fixture('m3-0922-celebi-actions');try{
 await prepareBossFixture(f.page);
 const result=await f.page.evaluate(async()=>{
  const p=__PB_PILOT,scope={stage:'M3',automaticPlay:true,modeIds:['resources'],nativeModes:['standard'],biomeIds:['encina'],tiers:[0,1,2],allowRifts:true};p.compatibility.maintenanceScope=scope;__PB_BRIDGE.compatibility.maintenanceScope=scope;
  const out=[];
  for(const defeat of [true,false]){
   const r=__M3_MAKE_BOSS_RUN('encina'),kit=r.boss.kit;p.release(true);r.input.stickX=r.input.stickY=0;
   if(kit.constructor.name!=='YP')throw Error('Actual Ilex factory must select HP');
   const loadout=()=>JSON.stringify({moves:r.player.moves,items:r.player.items,vitamins:r.player.vitamins,banished:[...r.banished],fusions:r.fusions});
   const before=loadout(),epochs=[],phases=[];let launched=false,maxInput=0,clockAim=null,killed=false,clockSnapshot=null,firstPast=null,presentAt=null;
   r.boss.tick=dt=>{if(!launched){launched=true;__M2_NATIVE.NativeRng.s=146432;kit.openRift();}kit.tick(dt);};
   for(let frame=0;frame<1300;frame++){
    r.realTime+=.016;r.realDt=.016;p.step(r,.016);maxInput=Math.max(maxInput,Math.hypot(r.input.stickX,r.input.stickY));
    const phase=p.target?.celebiPhase??'ordinary';if(phases.at(-1)!==phase)phases.push(phase);
    if(kit.clock&&kit.clockAlive()){
     const j=kit.clock.j;clockSnapshot={j,g:kit.clock.g,flags:r.enemies.flags[j],hp:r.enemies.hp[j]};
     if(Math.hypot(r.player.pos.x-r.enemies.x[j],r.player.pos.z-r.enemies.z[j])<2){
      clockAim=r.aimTarget(12);
      if(defeat){r.enemies.kill(j);killed=true;}
     }
    }
    r.simulate(.016);r.input.endFrame();
    const epoch=r.sanctuary.epoch;if(epochs.at(-1)!==epoch)epochs.push(epoch);
    if(epoch==='past'&&firstPast===null)firstPast=r.time;
    if(firstPast!==null&&epoch==='present'){presentAt=r.time;break;}
    await new Promise(resolve=>setTimeout(resolve,16));
   }
   out.push({defeat,kit:kit.constructor.name,epochs,phases,maxInput,clockAim,clockSnapshot,killed,firstPast,presentAt,down:kit.down,clockGone:!kit.clock,preserved:before===loadout(),state:r.state,enabled:p.enabled,status:p.status,position:{...r.player.pos},rift:kit.rift,pastT:kit.pastT});
  }
  return out;
 });
 console.log(JSON.stringify(result));fs.writeFileSync(new URL('evidence/celebi-actions-0922-result.json',f.task),JSON.stringify(result,null,2));
 for(const row of result){assert.deepEqual(row.epochs,['present','past','present']);assert.ok(row.phases.includes('rift'));assert.ok(row.phases.includes('clock'));assert.ok(row.maxInput>.5);assert.equal(row.clockAim,row.clockSnapshot.j);assert.ok(row.clockSnapshot.flags&32768);assert.equal(row.killed,row.defeat);assert.equal(row.down>0,row.defeat);assert.ok(row.clockGone);assert.ok(row.preserved);assert.equal(row.state,'play');assert.equal(row.enabled,true);if(!row.defeat)assert.ok(row.presentAt-row.firstPast>=5);}
 assert.deepEqual(f.errors,[]);console.log('PASS actual Ilex HP time-rift proximity/Past clock native auto aim/native kill to strand, plus natural timeout Present return');
}finally{await f.context.close();}
