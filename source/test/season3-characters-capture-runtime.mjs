import fs from 'node:fs';import assert from 'node:assert/strict';import{openSeason3Fixture}from './season3-0913-browser-fixture.mjs';import{prepareRiftFixture}from './season3-0913-rift-fixture.mjs';
const offline=JSON.parse(fs.readFileSync(new URL('../data/unlock-catalog.json',import.meta.url)));
const f=await openSeason3Fixture('characters-capture',{characterUnlockImplementation:'legacy160',unlockCatalog:offline});
try{await prepareRiftFixture(f.page);const result=await f.page.evaluate(async()=>{const b=__PB_BRIDGE,p=__PB_PILOT,m=b.app.meta,out=[];for(const species of [4,165])for(const saved of [false,true]){
 b.app.run=null;p.run=null;p.plan=null;m.profile={...m.profile,league:[1,152],unlocked:[1,152],captured:{},counters:{runs:2,kills_j:2500},biomes:{forest:3},seen:[1,152],played:[],forms:[],cosmetics:[],classics:[],shinies:[]};p.confirmNativeProfileOrigin(m.profile,b.app,m,m.account);p.commitUnlockProfile(m.profile,'native-test-receipt');p.settings.mode='characters';p.settings.characterId=1;p.settings.modeSettings.characters={biome:'auto',tier:'auto'};p.settings.unlockTargets={characters:'characters:'+species};p.unlockSelectionKey=null;const plan=p.makePlan();
 const r=__M3_MAKE_RIFT_RUN('forest');r.incense=0;r.rifts.nearEntrance=()=>null;r.rifts.update=()=>{};r.sprites.get=()=>({ready:false});r.enemies=new __M3_NATIVE.Enemies(r);r.capture=new __M3_CAPTURE(r);r.capture.beamFx=()=>{};r.capture.update=()=>{};m.count=Object.getPrototypeOf(m).count;
 r.$iacvfl=()=>{};r.$ttncrf=()=>{};r.$1sbmkxe=()=>{};r.$1c2y7kt=()=>{};r.ui.caught=()=>{};r.ui.setPrompt=()=>{};r.capture.spawnEncounter(species);const c=r.capture,index=c.index;
 c.onDefeated(index);r.player.pos.set(r.enemies.x[index]+3,r.enemies.y[index],r.enemies.z[index]);r.player.vel.set(0,0,0);p.plan=plan;p.planRun=r;p.settings.capturePriority=true;p.settings.shinyPriority=false;p.release(true);p.actionTimes?.clear?.();p.lastActionAt=-Infinity;p.cadence.reset('capture-test');
 const action=p.nativeInteractionAction(r);p.step(r,.016);r.simulate(.016);r.input.endFrame();const throwing=c.state==='throwing',ballActive=c.ball.active;
 // Control only the random outcome/animation boundary; native finish invokes caught.
 c.ball.breakAt=0;c.ball.finish();const nativeOwned=m.inLeague(species),beforeSaved=(p.savedUnlockProfileCurrent()?.league||[]).includes(species);
 let resolve,reject;m.endRun=()=>new Promise((yes,no)=>{resolve=yes;reject=no});p.observeSaves();const pending=m.endRun({mode:'standard',biome:'forest',tier:0,species:1,victory:true,time:120,kills:0,end:{how:'won'}},{shinies:[]}).catch(()=>null);
 const duringSaved=(p.savedUnlockProfileCurrent()?.league||[]).includes(species);
 if(saved)resolve({profile:m.profile,stardust:0,tasks:[]});else reject(Error('isolated rejected save'));await pending;
 const afterSaved=(p.savedUnlockProfileCurrent()?.league||[]).includes(species);
 out.push({species,saved,action,throwing,ballActive,nativeOwned,beforeSaved,duringSaved,afterSaved,event:p.events.filter(x=>x.kind==='settlement').at(-1)?.saved});c.dispose();b.app.run=null;p.run=null;
 }return out;});fs.writeFileSync(new URL('evidence/characters-capture.json',f.task),JSON.stringify({result,errors:f.errors},null,2));for(const x of result){assert.equal(x.action,'capture');assert.equal(x.throwing,true);assert.equal(x.ballActive,true);assert.equal(x.nativeOwned,true);assert.equal(x.beforeSaved,false);assert.equal(x.duringSaved,false);assert.equal(x.afterSaved,x.saved);assert.equal(x.event,x.saved);}assert.deepEqual(f.errors,[]);console.log('PASS actual native encounter/weakening, Pilot E -> throwBall -> native ball finish/caught/joinLeague; only accepted save confirms unlock');}finally{await f.context.close();}


