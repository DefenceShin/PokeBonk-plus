import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {prepareGameSource} from '../src/compatibility.mjs';
const folder=new URL('../../evidence/current-public/',import.meta.url);
const manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',folder)));
const modules=manifest.records.filter(r=>r.name.endsWith('.js')).map(r=>({...r,source:fs.readFileSync(new URL(r.name,folder),'utf8')}));
const app=modules.find(r=>r.name.startsWith('main-C00'));
test('preload entry prepares both App and dependency exports before either response is fulfilled',()=>{
 const entry=modules.find(r=>r.name.startsWith('main-BXF'));
 const prepared=prepareGameSource(entry.source,{moduleURL:entry.url,moduleSources:modules,sourceHash:entry.sha256});
 assert.equal(prepared.isGame,true);
 assert.equal(prepared.code,entry.source);
 assert.equal(prepared.originalGameModuleURL,app.url);
 assert.ok(prepared.modulePatches.some(p=>p.url===app.url));
 assert.ok(prepared.modulePatches.some(p=>p.url.includes('menus-')));
});
test('current real App binds required definitions through actual module exports',()=>{
 const prepared=prepareGameSource(app.source,{moduleURL:app.url,moduleSources:modules});
 assert.equal(prepared.isGame,true);
 for(const key of ['data','roster','biomes','biomeLive','moveDef','moveGuide','fusionFor','fusionRecipes','items','vitamins','rarityMultipliers'])
  assert.ok(prepared.report.symbols[key],key+' must bind');
 assert.deepEqual(prepared.report.missing,[]);
 assert.ok(prepared.report.moduleBindings?.length);
});
test('unrelated module cannot supply definitions without an import edge',()=>{
 const unrelated=modules.filter(r=>r!==app).map(r=>({...r,url:r.url.replace('/assets/','/unrelated/')}));
 const prepared=prepareGameSource(app.source,{moduleURL:app.url,moduleSources:unrelated});
 assert.ok(prepared.report.missing.includes('roster'));
});
test('current combat owners and modal mapping resolve the required real members',()=>{
 const prepared=prepareGameSource(app.source,{moduleURL:app.url,moduleSources:modules});
 assert.deepEqual(prepared.report.unresolvedMembers,[]);
 assert.ok(prepared.report.effectiveConfig['members.director.buildPool']);
 for(const owner of ['damage','director'])assert.ok(prepared.report.moduleBindings.some(row=>row.owner===owner));
});
