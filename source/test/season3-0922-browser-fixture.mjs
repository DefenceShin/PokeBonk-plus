import fs from 'node:fs';
import {chromium} from 'playwright';
import {prepareGameSource,prepareNativeMemberAliases} from '../src/compatibility.mjs';
import {nativeSyntaxIndex} from '../src/native-adaptation.mjs';
import {readControllerPackage} from '../scripts/controller-sources.mjs';
export async function openSeason3Fixture(name='flow',installOptions={}) {
 const task=new URL('../../',import.meta.url),dir=new URL('evidence/public-0922/',task);
 const manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',dir)));
 const modules=manifest.records.filter(r=>r.name.endsWith('.js')).map(r=>({...r,source:fs.readFileSync(new URL(r.name,dir),'utf8')}));
 const app=modules.find(r=>r.name.startsWith('main-BDr')),prepared=prepareGameSource(app.source,{moduleURL:app.url,moduleSources:modules,sourceHash:app.sha256});
 const index=nativeSyntaxIndex(prepared.code),owner=index.classes.find(c=>c.symbol===prepared.report.appSymbol);
 const edits=owner.node.body.body.filter(n=>n.key?.name==='constructor'||n.key?.name==='boot').map(n=>({start:n.start,end:n.end,text:n.key.name==='constructor'?'constructor(){}':`async boot(){this.input={};await M.load();this.meta=Object.create(Ri.prototype);this.meta.profile={biomes:{forest:2},league:[1],quests:{},lab:{},settings:{}};}`}));
 let code=prepared.code;for(const e of edits.sort((a,b)=>b.start-a.start))code=code.slice(0,e.start)+e.text+code.slice(e.end);
 code=code.replace('S(),xS(),await new','await new');
 const typeNames=new Map(prepareNativeMemberAliases(app.source,undefined,{partial:true}).groups.map(g=>[g.ownerId,g.symbol]));
 for(const r of prepared.report.moduleBindings.filter(r=>r.owner))typeNames.set(r.owner,r.binding);
 const defaultInitializers={};
 for(const role of ['run','player']){
  const symbol=typeNames.get(role),ctor=index.methods.find(m=>m.owner===symbol&&m.name==='constructor');
  const expressions=ctor.node.value.body.body[0]?.expression;
  const parts=expressions?.type==='SequenceExpression'?expressions.expressions:[expressions];const initial=[];
  for(const part of parts){if(part?.type!=='CallExpression'||part.arguments[0]?.type!=='ThisExpression')break;initial.push(prepared.code.slice(part.start,part.end));}
  defaultInitializers[role]='function(){'+initial.join(';')+'}';
  if(role==='run'){const field=parts.find(part=>part?.type==='CallExpression'&&(part.arguments[1]?.value??part.arguments[1]?.quasis?.[0]?.value?.cooked)==='cine');if(!field)throw Error('Native run cine initializer missing');defaultInitializers.cine='function(){'+prepared.code.slice(field.start,field.end)+'}';}
 }
 code+='\nglobalThis.__M3_CAPTURE='+index.methods.find(m=>m.name==='spawnEncounter').owner+';';
 code+='\nglobalThis.__M3_DEFAULTS={run:'+defaultInitializers.run+',player:'+defaultInitializers.player+',cine:'+defaultInitializers.cine+'};';
 code+='\nglobalThis.__M3_NATIVE={speciesLive:ss,shinySpecials:fs,Enemies:qt,Boss:Cn,Sanctuary:Eh,Canela:pf,Cave:Tf,Iris:Lf,Ultimate:ay,Combat:Hn,Relics:jp,relicDefs:zs,relicMap:_s,relicUI:Nb,johtoBranches:uo,enemyFlags:b,NativeInput:Ml,NativeSprites:o,difficultyTable:ws,sanctuaryArena:Th,Terrain:ue,copyPickups:Gp,restorePickups:Kp};';
 code+='\nglobalThis.__M2_TYPES={'+[...typeNames].map(([k,v])=>JSON.stringify(k)+':'+v).join(',')+'};globalThis.__M2_APPLY_OFFER=Hr;';
 const files=new Map(modules.map(r=>[new URL(r.url).pathname,r.source]));files.set(new URL(app.url).pathname,code);
 const definitions=modules.find(r=>r.name.startsWith('defineProperty-'));
 files.set(new URL(definitions.url).pathname,definitions.source+'\nglobalThis.__SKIN_NATIVE={looks:aa,legendary:ha,treasures:sa,quests:b,lookAvailable:Pa,classicAvailable:Ia};');
 for(const patch of prepared.modulePatches)files.set(new URL(patch.url).pathname,patch.code);
 const menuPath='/assets/menus-DqU5mYee-mw88813m.js';
 const menus=modules.find(r=>r.name.startsWith('menus-')),menuIndex=nativeSyntaxIndex(menus.source),riftOwner=menuIndex.methods.find(m=>m.name==='nearEntrance').owner;
 const worldOwner=menuIndex.methods.find(m=>m.name==='interact'&&menus.source.slice(m.start,m.end).includes('switch(e.kind)')).owner;
 files.set(menuPath,files.get(menuPath)+`\nglobalThis.__M2_NATIVE={legendaryHunt:sI,legendaryChance:aI,NativeRng:A,billOpen:Az,billApply:jz,billOffers:Dz,Move:Xx,Rifts:${riftOwner},Group:la,terrainPacks:Td,riftMap:OI,riftTiers:vI,riftNear:${riftOwner}.prototype.nearEntrance,World:${worldOwner}};`);
 const dataManifest=JSON.parse(fs.readFileSync(new URL('data/manifest.json',dir)));
 for(const row of dataManifest.records)files.set(new URL(row.url).pathname,fs.readFileSync(new URL('data/'+row.file,dir),'utf8'));
 const context=await chromium.launchPersistentContext(new URL('isolated-user-data/'+name+'/',task).pathname.replace(/^\/([A-Za-z]:)/,'$1'),{headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',route=>{
  const u=new URL(route.request().url());if(u.pathname==='/__m2_fixture')return route.fulfill({body:`<html lang="es"><body><script type="module" src="${app.url}"></script></body></html>`,contentType:'text/html'});
  const body=files.get(u.pathname);return body!=null?route.fulfill({body,contentType:u.pathname.endsWith('.json')?'application/json':'application/javascript'}):route.abort();
 });
 await page.goto('https://pokebonk.com/__m2_fixture');await page.waitForFunction(()=>__PB_BRIDGE?.compatibility.state==='ready');
 const source=(await readControllerPackage()).sharedSource;
 await page.evaluate(({source,installOptions})=>{
  const app=__PB_BRIDGE.app;
  app.meta.account={id:'m2-isolated',guest:true};Object.assign(app.meta.profile,{starter:1,itemsOwned:[],itemsOff:[],seen:[1],played:[],daily:{ids:[],prog:[],claimed:[]},weekly:{ids:[],prog:[],claimed:[]},bag:{},counters:{},stardust:0});
  app.meta.queue=Promise.resolve();app.meta.hasPending=()=>false;
  Object.assign(app.input,{pressed:()=>false,held:()=>false,releaseLock(){},endFrame(){},update(){}});
  const timer=window.setInterval;window.setInterval=()=>0;
  const options={embedded:true,autoStart:false,battleRecorder:false,...installOptions,settings:{mode:'resources',randomDelay:false,autoClaim:false,autoUpgrade:false,autoUnlockItems:false,reserveMoveSlot:false,modeSettings:{resources:{biome:'forest',tier:0}},...installOptions.settings}};
  try{(0,eval)(source+';installPilot('+JSON.stringify(options)+');');}finally{window.setInterval=timer;}
  const p=__PB_PILOT;p.attach(__PB_BRIDGE);
  globalThis.__M2_MAKE_RUN=(species=1)=>{
   p.enabled=false;const b=__PB_BRIDGE,ui=Object.create(__M2_TYPES.ui.prototype),noop=()=>{};
   const player=Object.assign(Object.create(__M2_TYPES.player.prototype),{speciesId:species,roster:b.roster.find(r=>r.id===species),pos:{x:0,y:0,z:0},hp:100,maxHp:100,baseSpeed:1,ability:'',level:35,types:b.data.get(species).types,moveSlots:4,vitaminSlots:5,items:new Map(),vitamins:new Map(),moves:[],stats:{physical:1,special:1,damage:1,attackSpeed:1,moveSpeed:1,armor:0,luckMult:1,regen:0,pickupRange:6},recompute:noop});
   player.kitKeys=new Set(player.roster.kit);player.buffs=new Map();player.meta=app.meta;player.data=b.data.get(species);player.moves=Array(4).fill(null);
   Object.assign(player.stats,{typeBoost:{},area:1,duration:1,projSpeed:1,projectiles:0,bounces:0,statusChance:1,critChance:0});
   ui.modal=function(...els){this.modalEl?.remove();const root=document.createElement('div');root.className='modal';root.append(...els);document.body.append(root);this.modalEl=root;return root;};
   ui[b.nativeMemberKey(ui,'hideModal')]=function(){this.modalEl?.remove();this.modalEl=null;};ui.toast=noop;ui.banner=noop;
   const vfx=new Proxy({beams:{spawn:noop},add:{spawn:noop}},{get:(o,k)=>k in o?o[k]:noop});
   const run=Object.assign(Object.create(__M2_TYPES.run.prototype),{favs:[],state:'play',mode:'standard',startSpecies:species,biome:b.biomes[0],tier:0,stage:1,time:120,realTime:120,gold:10000,goldSpent:0,econ:{shop:0},shopBuys:[],peakItems:0,rerolls:0,skips:0,banishes:0,banished:new Set(),fusions:[],boosts:new Set(),tempMods:[],player,ui,meta:app.meta,input:app.input,vfx,audio:new Proxy({},{get:()=>noop}),sprites:{get:noop},cry:noop,shake:noop,camYaw:0,rifts:{isInside:false},allies:{list:[]},stats:{kills:0,damage:0,damageTaken:0,captured:[],shinies:[],classics:[],forgotten:{},links:0},enemies:{alive:new Uint8Array(0)},projectiles:{flags:new Uint8Array(0)},terrain:{walkClear:()=>true,ground:()=>0},boss:{lineStrike:noop,strike:noop,waves:[]},capture:{throwing:false},interactables:{list:[],dim:noop,rewardsLeft:()=>0},pickups:{n:0},update:noop,later:(t,fn)=>fn(),finish:async()=>{},resume(){this.state='play';ui.hideModal();},animate(duration,frame,done){frame(1);done();}});
   __M3_DEFAULTS.cine.call(run);player.run=run;app.run=run;
   p.attachRun(run);p.enabled=true;p.plan={species,biome:'forest',tier:0,mode:'standard',build:{},metrics:[]};p.planRun=run;
   return run;
  };
  globalThis.__M2_OLD_MODAL=()=>{if(p.modal)p.modal.at=performance.now()-5000;p.actionTimes?.clear?.();p.lastActionAt=-Infinity;p.cadence.reset('fixture-next-choice');};
 },{source,installOptions});
 return {page,context,errors,task,prepared};
}
