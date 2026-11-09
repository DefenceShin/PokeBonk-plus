export async function prepareRiftFixture(page){
 await page.evaluate(()=>{
  const n=__M3_NATIVE,m=__M2_NATIVE,T=n.Terrain;
  if(!globalThis.__M3_GFX_ISOLATED){
   globalThis.__M3_GFX_ISOLATED=true;
   T.prototype.buildMesh=function(){};T.prototype.buildWater=function(){};T.prototype.setSunDir=function(){};
   T.prototype.initEnv=function(){const pack=m.terrainPacks[this.arena?.pack??this.biome.id];if(!pack)throw Error('Missing actual terrain pack');const method=this.arena?'placeArenaEnv':this.island?'placeIslandEnv':this.cave?'placeCaveEnv':this.ancient?'placeAncientEnv':this.valley?'placeValleyEnv':'placeEnv';this.envList=this[method](pack);};
   const canvas=document.createElement('canvas');canvas.id='game';document.body.append(canvas);globalThis.__M3_INPUT=new n.NativeInput(canvas);__PB_BRIDGE.app.input=__M3_INPUT;
  }
  globalThis.__M3_MAKE_RIFT_RUN=(map='forest')=>{
   const r=__M2_MAKE_RUN(),p=__PB_PILOT,vec=()=>new m.Group().position.clone(),noop=()=>{};
   const originalFields={...r},playerFields={...r.player};__M3_DEFAULTS.run.call(r);const nativeStats=r.stats;Object.assign(r,originalFields);r.stats={...nativeStats,...originalFields.stats};__M3_DEFAULTS.player.call(r.player);Object.assign(r.player,playerFields);
   r.biome=__PB_BRIDGE.biomes.find(b=>b.id===map);r.seed=712367;r.zone={sun:r.biome.sun,light:r.biome.light,sunDir:[.5,1,.2]};
   r.r={scene:new m.Group(),shared:{},camera:{position:vec().set(10,15,20)},kick:noop};r.terrain=new T(r.biome,r.seed,r.r.shared);
   r.player.pos=vec().copy(r.terrain.spawn);r.player.vel=vec();r.player.iframes=0;r.player.grounded=true;r.player.radius=.55;r.camTarget=vec().copy(r.player.pos);
   r.vfx.ground={spawn:noop};r.vfx.groundN={spawn:noop};r.timers=[];r.anims=[];r.ghosts=[];r.projectiles.clear=noop;r.zones={clear:noop};r.pickups.clear=function(){this.n=0};r.pickups.gatherAll=noop;r.pickups.spawn=noop;
   r.animate=(duration,frame,done)=>{frame(1);done?.()};r.ui.$q4a01f=noop;r.ui.$brlpbe=noop;r.ui.fade=async()=>{};r.ui.mapState=()=>({fixtureMap:map});r.allies.onStage=noop;r.allies.state='idle';r.capture.state='idle';r.capture.canThrow=()=>false;r.allies.canThrow=()=>false;
   r.ult={active:0,castPending:false};r.mewtwo={active:false};r.boss.alive=false;r.incense=1;r.teamRifts={enabled:false,list:[],clear:noop};r.diff={enemyHp:n.difficultyTable.hp[r.tier]??1,enemyDamage:n.difficultyTable.dmg[r.tier]??1,enemySpeed:n.difficultyTable.speed[r.tier]??1,enemyAmount:n.difficultyTable.amount[r.tier]??1,xp:1,xpMult:1+r.tier*.15,stardust:1+r.tier*.75};r.sprites=new n.NativeSprites(r.r.scene,r.r.shared);r.riftSecs=0;r.riftKills=0;r.relicKeys=[];r.relics=new n.Relics(r);r.rifts=new m.Rifts(r);
   r.nextCp=Infinity;r.nextLive=Infinity;r.musicT=Infinity;r.saveQueued=false;r.lockTarget=-1;
   r.weather=r.baseWeather=r.statsWeather='clear';r.hints={tick:noop};r.player.update=noop;
   r.orbitals={begin:noop};r.orbitalsGlow={begin:noop};r.ult.update=noop;r.dpsLog={tick:noop};
   r.enemies.update=noop;r.interactables.update=noop;r.minibosses={update:noop,list:[]};r.teamRifts.update=noop;r.boss.tick=noop;
   r.ult=new n.Ultimate(r);r.ult.update=noop;r.combat=new n.Combat(r);r.events={update:noop};r.projectiles.update=noop;r.zones.update=noop;r.pickups.update=noop;
   r.capture.beamFx=noop;r.capture.update=noop;r.mewtwo.update=noop;r.allies.update=noop;
   for(const key of ['tide','mapEvents','canela','cave','encina','iris'])r[key]={update:noop};
   r.meta.count=noop;r.meta.hasForm=()=>false;r.allies.mods=()=>[];r.player.typeHeld=new Set();r.player.evoStage=0;r.player.growth=0;delete r.player.recompute;r.player.recompute();r.player.update=__M2_TYPES.player.prototype.update;r.input=__M3_INPUT;__PB_BRIDGE.app.input=__M3_INPUT;r.pushLook=noop;r.director=new __M2_TYPES.director(r);r.director.update=noop;r.later=(delay,fn)=>r.timers.push({t:delay,fn});
   return r;
  };
 });
}
