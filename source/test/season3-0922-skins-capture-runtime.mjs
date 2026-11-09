import fs from 'node:fs';import assert from 'node:assert/strict';import{openSeason3Fixture}from './season3-0922-browser-fixture.mjs';import{prepareRiftFixture}from './season3-0922-rift-fixture.mjs';
const read=n=>JSON.parse(fs.readFileSync(new URL('../data/'+n+'.json',import.meta.url)));
const f=await openSeason3Fixture('0922-skins-capture',{unlockCatalog:read('unlock-catalog'),shinyCatalog:read('shiny-catalog')});
try{await prepareRiftFixture(f.page);const result=await f.page.evaluate(async()=>{const b=__PB_BRIDGE,p=__PB_PILOT,m=b.app.meta,out=[];
 for(const kind of ['shiny','classic'])for(const saved of [false,true]){
  const species=152,field=kind==='shiny'?'shinies':'classics';b.app.run=null;p.run=null;p.plan=null;
  m.profile={...m.profile,league:[1,152],counters:{},quests:{},biomes:{forest:3},seen:[1,152],played:[],forms:[],cosmetics:[],classics:[],shinies:[],totalStardust:0};
  p.confirmNativeProfileOrigin(m.profile,b.app,m,m.account);p.commitUnlockProfile(m.profile,'native-test-receipt');
  p.settings.mode=kind==='shiny'?'shiny':'wardrobe';p.settings.shinyTypes=[kind];p.settings.unlockTargets={shiny:'shiny:'+species};p.settings.modeSettings.wardrobe={species,look:'classic'};p.unlockSelectionKey=null;const plan=p.makePlan();
  const r=__M3_MAKE_RIFT_RUN('forest');r.incense=0;r.rifts.nearEntrance=()=>null;r.rifts.update=()=>{};r.sprites.get=()=>({ready:false});r.enemies=new __M3_NATIVE.Enemies(r);r.capture=new __M3_CAPTURE(r);r.capture.beamFx=()=>{};r.capture.shinyEntrance=()=>{};r.capture.update=()=>{};m.count=Object.getPrototypeOf(m).count;
  r.$xtzrm8=()=>{};r.$1kzj4d4=()=>{};r.$wx4c9a=()=>{};r.$ici86w=()=>{};r.ui.caught=()=>{};r.ui.setPrompt=()=>{};r.ui.$1lfz083=()=>{};
  r.allies.makeShiny=id=>({name:b.data.get(id).name});r.allies.shinyLabel=id=>b.data.get(id).name;r.allies.setShiny=ally=>{r.allies.shinyAlly=ally};
  if(kind==='shiny')r.capture.spawnShiny([species]);else r.capture.spawnClassic(species);
  const c=r.capture,index=c.index;c.onDefeated(index);r.player.pos.set(r.enemies.x[index]+3,r.enemies.y[index],r.enemies.z[index]);r.player.vel.set(0,0,0);p.plan=plan;p.planRun=r;p.settings.capturePriority=true;p.settings.shinyPriority=true;p.release(true);p.actionTimes?.clear?.();p.lastActionAt=-Infinity;p.cadence.reset('capture-test');
  const action=p.nativeInteractionAction(r);p.step(r,.016);r.simulate(.016);r.input.endFrame();const throwing=c.state==='throwing';
  // Actual native spawn and caught methods; isolate the random success, visuals and ally render.
  c.ball.breakAt=0;c.ball.finish();const nativeOwned=m.profile[field].includes(species),beforeSaved=p.savedUnlockProfileCurrent()[field].includes(species);
  let resolve,reject;m.endRun=()=>new Promise((yes,no)=>{resolve=yes;reject=no});p.observeSaves();const pending=m.endRun({mode:'standard',biome:'forest',tier:0,species:1,victory:true,time:120,kills:0,end:{how:'won'}},{shinies:r.stats.shinies,classics:r.stats.classics}).catch(()=>null);
  const duringSaved=p.savedUnlockProfileCurrent()[field].includes(species);if(saved)resolve({profile:m.profile,stardust:0,tasks:[]});else reject(Error('isolated rejected save'));await pending;
  out.push({kind,saved,planStatus:plan.goalProgress?.status??plan.shinyStatus,planMode:plan.mode,action,throwing,nativeOwned,beforeSaved,duringSaved,afterSaved:p.savedUnlockProfileCurrent()[field].includes(species)});c.dispose();b.app.run=null;p.run=null;
 }return out;});fs.writeFileSync(new URL('evidence/0922-skins-capture.json',f.task),JSON.stringify({result,errors:f.errors},null,2));for(const x of result){assert.equal(x.planStatus,'ready',JSON.stringify(x));assert.equal(x.planMode,'standard');assert.equal(x.action,'capture');assert.equal(x.throwing,true);assert.equal(x.nativeOwned,true);assert.equal(x.beforeSaved,false);assert.equal(x.duringSaved,false);assert.equal(x.afterSaved,x.saved);}assert.deepEqual(f.errors,[]);console.log('PASS Johto shiny/classic actual native spawn, Pilot E, native capture -> owned; accepted/rejected receipt boundaries');
}finally{await f.context.close()}
