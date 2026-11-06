import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {prepareGameSource,prepareNativeMemberAliases} from '../src/compatibility.mjs';
import {nativeSyntaxIndex} from '../src/native-adaptation.mjs';
import {createPlanEditorCatalog} from '../src/custom-plans.mjs';
const task=new URL('../../',import.meta.url),dir=new URL('evidence/current-public/',task);
const manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',dir)));
const modules=manifest.records.filter(r=>r.name.endsWith('.js')).map(r=>({...r,source:fs.readFileSync(new URL(r.name,dir),'utf8')}));
const app=modules.find(r=>r.name.startsWith('main-C00'));
let prepared=prepareGameSource(app.source,{moduleURL:app.url,moduleSources:modules,sourceHash:app.sha256});
assert.deepEqual(prepared.report.missing,[]);
const index=nativeSyntaxIndex(prepared.code),owner=index.classes.find(c=>c.symbol===prepared.report.appSymbol);
// Isolation fixture only: suppress native graphics/auth boot and constructor.
// Actual imports, definitions, data.load, adapters and bridge are executed.
const edits=owner.node.body.body.filter(n=>n.key?.name==='constructor'||n.key?.name==='boot').map(n=>({start:n.start,end:n.end,text:n.key.name==='constructor'?'constructor(){}':`async boot(){this.input={};await F.load();this.meta=Object.create(Ye.prototype);this.meta.profile={biomes:{forest:2},league:[1],quests:{},lab:{},settings:{}};}`}));
let code=prepared.code;for(const e of edits.sort((a,b)=>b.start-a.start))code=code.slice(0,e.start)+e.text+code.slice(e.end);
code=code.replace(/\(Cr\(\),ES\(\),await /,'(await ');
const typeNames=new Map(prepareNativeMemberAliases(app.source,undefined,{partial:true}).groups.map(g=>[g.ownerId,g.symbol]));
for(const row of prepared.report.moduleBindings.filter(r=>r.owner))typeNames.set(row.owner,row.binding);
code+='\nglobalThis.__M1_TYPES={'+[...typeNames].map(([owner,name])=>JSON.stringify(owner)+':'+name).join(',')+'};';
fs.writeFileSync(new URL('evidence/isolated-main.js',task),code);
assert.ok(!code.includes('await new '+prepared.report.appSymbol+'().boot()'));
const files=new Map(modules.map(r=>[new URL(r.url).pathname,r.source]));files.set(new URL(app.url).pathname,code);
for(const patch of prepared.modulePatches)files.set(new URL(patch.url).pathname,patch.code);
const dataManifest=JSON.parse(fs.readFileSync(new URL('data/manifest.json',dir)));
for(const row of dataManifest.records)files.set(new URL(row.url).pathname,fs.readFileSync(new URL('data/'+row.file,dir),'utf8'));
for(const name of fs.readdirSync(new URL('../src/',import.meta.url)).filter(n=>n.endsWith('.mjs')))files.set('/__pilot/'+name,fs.readFileSync(new URL('../src/'+name,import.meta.url),'utf8'));
const context=await chromium.launchPersistentContext(new URL('isolated-user-data/runtime/',task).pathname.replace(/^\/([A-Za-z]:)/,'$1'),{headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
try{
 const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
 // Execute the adapter emitted by the actual compiled host/resource resolver.
 await page.goto('about:blank');await page.evaluate(read=>{(0,eval)(read);},fs.readFileSync(new URL('evidence/host-adapter.js',task),'utf8'));
 const hostPrepared=await page.evaluate(({source,options})=>__M1_PREPARE(source,options),{source:app.source,options:{moduleURL:app.url,moduleSources:modules,sourceHash:app.sha256}});
 assert.deepEqual(hostPrepared.report.symbols,prepared.report.symbols);assert.equal(hostPrepared.code,prepared.code);
 assert.deepEqual(hostPrepared.modulePatches,prepared.modulePatches);
 await context.route('**/*',route=>{
  const u=new URL(route.request().url());requests.push(u.pathname);
  if(u.pathname==='/__isolated_m1')return route.fulfill({body:`<html lang="es"><body><script type="module" src="${app.url}"></script></body></html>`,contentType:'text/html'});
  const body=files.get(u.pathname);return body!=null?route.fulfill({body,contentType:u.pathname.endsWith('.json')?'application/json':'application/javascript'}):route.abort();
 });
 await page.goto('https://pokebonk.com/__isolated_m1');
 await page.waitForFunction(()=>globalThis.__PB_BRIDGE?.compatibility?.state==='ready',{},{timeout:30000}).catch(e=>{throw Error(JSON.stringify(errors)+' '+e.message)});
 const result=await page.evaluate(()=>{
  const b=globalThis.__PB_BRIDGE,meta=b.app.meta;
  const guide=b.moveGuide(1,b.roster.find(r=>r.id===1),b.data.get(1).types,()=>true);
  const recipe=b.fusionRecipes.find(r=>r.kind==='signature'&&r.moves?.every(k=>b.data.movesByKey.has(k)));
  const moves=recipe.moves.map(k=>b.moveDef(b.data.movesByKey.get(k).id));
  const fused=b.fusionFor(...moves);
  const player=Object.assign(Object.create(__M1_TYPES.player.prototype),{items:new Map(),stats:{moveSpeed:1},baseSpeed:1,ability:'',hp:100,maxHp:100});
  const director=Object.assign(Object.create(__M1_TYPES.director.prototype),{run:{biome:b.biomes[0],stage:1},rng:{shuffle:array=>array}});director.buildPool();
  const descriptors=Object.fromEntries(Object.entries(__M1_TYPES).map(([owner,type])=>[owner,Object.getOwnPropertyNames(type.prototype)]));
  return {state:b.compatibility.state,contract:b.compatibility,roster:b.roster.length,biomes:b.biomes.map(r=>r.id),pokemon:b.data.pokemon.length,moves:b.data.moves.size,items:b.items.size,vitamins:b.vitamins.size,rarity:b.rarityMultipliers,
   mapLive:b.biomeLive('forest'),tier:meta.biomeTier('forest'),guideKeys:Object.keys(guide),fusionExpected:recipe.key,fusionActual:fused.key,
   memberAliases:b.compatibility.nativeAliasOwners,descriptors,rageBonus:player.rageBonus(),enemyPool:director.pool.length,networkSuppressed:true};
 });
 assert.equal(result.rageBonus,1);assert.ok(result.enemyPool>0);assert.ok(result.descriptors.ui.includes('showFusion'));assert.ok(result.descriptors.damage.includes('eliteBurst'));
 const modal=await page.evaluate(()=>{
  const ui=Object.create(__M1_TYPES.ui.prototype);let root,receipt='pending';
  ui.modal=function(el){root=document.createElement('div');root.append(el);document.body.append(root);return root;};
  const b=__PB_BRIDGE,run={player:{moves:[],stats:{},speciesId:1},meta:b.app.meta,banished:new Set(),fusions:[],movesOff:new Set(),buildPlan:null};
  ui.showFusion(run,[],(choice,kind)=>{receipt={choice,kind};root.remove();});
  globalThis.__M1_MODAL={get receipt(){return receipt;}};
  return {opened:root.isConnected,title:root.querySelector('h1')?.textContent};
 });
 assert.equal(modal.opened,true);await page.waitForTimeout(400);await page.keyboard.press('Escape');
 const exit=await page.evaluate(()=>__M1_MODAL.receipt);assert.equal(exit.choice,null);
 result.fusionModal={...modal,exitChoice:exit.choice};
 assert.equal(result.fusionActual,result.fusionExpected);assert.equal(result.tier,2);assert.ok(result.roster>=100);assert.ok(result.biomes.length>=10);
 assert.deepEqual(errors,[]);
 // Serialize only public definitions; the synthetic meta/profile is never serialized.
 const publicCatalog=await page.evaluate(()=>{
  const b=__PB_BRIDGE;
  return {roster:b.roster,biomes:b.biomes,moves:[...b.data.moves.values()],pokemon:b.data.pokemon,items:[...b.items.values()],vitamins:[...b.vitamins.values()],fusionRecipes:b.fusionRecipes};
 });
 const serialized=JSON.stringify(publicCatalog);fs.writeFileSync(new URL('evidence/runtime-public-catalog.json',task),serialized);
 const localization=JSON.parse(fs.readFileSync(new URL('../data/localization.json',import.meta.url)));
 const editor=await page.evaluate(async loc=>{const {createPlanEditorCatalog}=await import('/__pilot/custom-plans.mjs');return createPlanEditorCatalog(__PB_BRIDGE,loc);},localization);
 assert.equal(editor.characters.length,138);assert.ok(editor.characters.some(c=>Number(c.id)>151));
 fs.writeFileSync(new URL('evidence/editor-catalog.json',task),JSON.stringify(editor));
 result.editor={characters:editor.characters.length,maps:editor.maps.length,moves:editor.moves.length,warnings:editor.warnings};
 fs.writeFileSync(new URL('evidence/runtime-result.json',task),JSON.stringify({...result,errors,requests},null,2));
 fs.writeFileSync(new URL('evidence/m1-report.json',task),JSON.stringify(prepared.report,null,2));
 console.log(JSON.stringify({...result,contract:{state:result.contract.state,capabilities:result.contract.capabilities,optionalMissing:result.contract.optionalMissing}}));
}finally{await context.close();}
