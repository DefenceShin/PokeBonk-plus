import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {selectShinyPlan} from '../src/shiny.mjs';import {selectUnlockGoal} from '../src/unlock-goals.mjs';
const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url),'utf8')),shiny=read('../data/shiny-catalog.json'),catalog=read('../data/unlock-catalog.json');
test('Johto shiny planning uses current native wild pools instead of the Kanto catalog',()=>{
 const target=shiny.species.find(s=>s.id===152);assert.ok(target);assert.ok(target.sources.some(s=>s.kind==='wild'&&s.biome==='forest'&&s.stage===1));
 const bridge={shinyCatalog:shiny,roster:[{id:1}],biomes:[{id:'forest',types:['grass']}],data:{get:()=>({})}};
 const plan=selectShinyPlan({league:[1],shinies:[],biomes:{forest:3}},{mode:'shiny',shinyTypes:['shiny'],unlockTargets:{shiny:'shiny:152'}},bridge);
 assert.equal(plan.shinyStatus,'ready');assert.equal(plan.biome,'forest');assert.equal(plan.shinyTargetId,152);
 assert.equal(shiny.species.find(s=>s.id===206).sources.some(s=>s.kind==='wild'||s.kind==='missing-base-family'),false,'do not invent a Johto base fallback');
});
test('Johto wardrobe targets use the current exact-member family eligibility',()=>{
 for(const key of ['shiny','classic','spectral'])assert.ok(catalog.targets.find(t=>t.id===`appearance:skin-${key}:152`));
 const target=catalog.targets.find(t=>t.id==='appearance:skin-shiny:152');
 assert.deepEqual(target.completion.conditions[1].conditions.map(c=>c.value),[152,153,154]);
 const p={league:[152],biomes:{forest:3},shinies:[154],classics:[],cosmetics:[],quests:{},counters:{}};
 assert.equal(selectUnlockGoal(p,catalog,{targetId:target.id,category:'appearance',confirmed:true,advanceOnComplete:false}).status,'complete');
 assert.notEqual(selectUnlockGoal({...p,shinies:[],classics:[154]},catalog,{targetId:target.id,category:'appearance',confirmed:true,advanceOnComplete:false}).status,'complete');
});
