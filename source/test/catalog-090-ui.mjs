import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {prepareGameSource} from '../src/compatibility.mjs';
import {nativeSyntaxIndex} from '../src/native-adaptation.mjs';
import {createPlanEditorCatalog} from '../src/custom-plans.mjs';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
const native=read('../../../../analysis/leaderboard-growth-20261103/native-public.js'),defs=read('../../../../analysis/leaderboard-growth-20261103/native-definitions.js');
const syms=prepareGameSource(native).report.symbols, imp=nativeSyntaxIndex(native).ast.body.find(i=>i.source?.value.includes('defineProperty'));
const module=await import('data:text/javascript;base64,'+Buffer.from(defs.replace(/^import[^;]+;/,'const e=[],t=x=>x;')).toString('base64'));
const publicBindings={};for(const key of ['roster','biomes','biomeLive','quests','items','vitamins']){const exp=imp.specifiers.find(i=>i.local.name===syms[key]);assert(exp,key);publicBindings[key]=module[exp.imported.name];}
const readJson=p=>JSON.parse(read(p)),moves=readJson('../research/update-1.5.1-055-moves.json');
const localization=readJson('../data/localization.json'),catalog=createPlanEditorCatalog({...publicBindings,data:{moves:new Map(moves.map(m=>[m.id,m]))}},localization);
assert(catalog.characters.length&&catalog.maps.length&&catalog.planEditorSchema&&catalog.moves.length);
const base=readJson('../data/catalog.json');
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
try {
const page=await browser.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.message));
const files=Object.fromEntries(['index.html','app.js','styles.css','product-source.js'].map(k=>[k,read('../client/ui/'+k)]));
await page.route('**/*',route=>{const url=new URL(route.request().url()),k=url.pathname.slice(1)||'index.html';return url.hostname==='catalog.test'&&files[k]?route.fulfill({body:files[k],contentType:k.endsWith('.js')?'application/javascript':k.endsWith('.css')?'text/css':'text/html'}):route.abort();});
await page.addInitScript(c=>{const state={running:false,game:{state:'menu'},session:{},logs:[],profile:{league:[1]},connection:{stage:'ready'},config:{mode:'tower',characterId:1,modeSettings:{tower:{}}}};window.desktop={getState:async()=>state,getCatalog:async()=>c,onState(){return()=>{}},onLog(){return()=>{}},command:async()=>({ok:true,state})};},{...base,...catalog});
await page.goto('http://catalog.test/');await page.click('#tab-plans');await page.click('#plan-new');await page.click('[data-plan-section="moves"]');
const move=catalog.moves.find(m=>m.key==='moonblast');assert(move);
await page.fill('#plan-moves-search',move.name);const button=page.locator('#plan-moves-results button').filter({hasText:'moonblast'});await button.click();assert(await page.locator('#plan-moves-results button').filter({hasText:move.name}).first().isDisabled());assert((await page.locator('#plan-moves-rules').innerText()).includes(move.name));assert.deepEqual(errors,[]);
await page.screenshot({path:'../plan-search.png'});console.log(JSON.stringify({maps:catalog.maps.length,characters:catalog.characters.length,fixtureMoves:catalog.moves.length,search:move.name,added:move.key,liveGame:false}));
}finally{await browser.close();}


