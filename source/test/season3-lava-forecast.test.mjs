import {test}from 'node:test';import assert from 'node:assert/strict';import * as policy from '../src/policy.mjs';import * as tactics from '../src/battle-tactics.mjs';
test('Canela native lava mask checks future local ground and fire immunity',()=>{assert.equal(typeof policy.terrainRegionWindows,'function');const run={biome:{id:'canela'},player:{maxHp:100,types:[],pos:{x:0,y:0,z:0}},terrain:{lavaAt:(x)=>x>1?.95:0,height:x=>x>2?2:0},canela:{bombs:[],pools:[],lavaHurtT:0}};const h=tactics.newMapEventHazards(run).find(h=>h.source==='canela-ground-lava');assert.ok(h);assert.equal(h.rawDamage,6);const path=[{x:0,z:0,t:0},{x:3,z:0,t:1}],grounded={y:0,height:0,grounded:true};assert.ok(policy.terrainRegionWindows(path,h,grounded,1).length>0);assert.deepEqual(policy.terrainRegionWindows(path,h,{y:4,height:4,grounded:false,trajectoryY:[{t:0,y:4},{t:1,y:4}]},1),[]);run.player.types=['fire'];assert.equal(tactics.newMapEventHazards(run).some(h=>h.source==='canela-ground-lava'),false);});

test('magic guard ignores environmental lava/pool but not eruption bombs',()=>{const run={biome:{id:'canela'},player:{maxHp:100,types:[],ability:'magic-guard'},terrain:{lavaAt:()=>1,height:()=>0},canela:{bombs:[{x:0,y:0,z:0,t:1,r:3}],pools:[{x:0,y:0,z:0,t:4,r:2}]}};assert.deepEqual(tactics.newMapEventHazards(run).map(h=>h.source),['canela-eruption-bomb']);});

test('motion policy rejects an unprotected walk into observed Canela lava',()=>{
 const run={biome:{id:'canela'},player:{maxHp:100,types:[]},terrain:{lavaAt:x=>x>1?1:0,height:()=>0},canela:{}};
 const player={x:0,y:0,z:0,speed:6.3,radius:.55,vx:0,vy:0,vz:0,height:0,grounded:true,frameDt:1/60,invulnerableFor:0,hp:100,maxHp:100,shield:0};
 const state={player,target:{x:10,z:0},enemies:[],bullets:[],hazards:tactics.newMapEventHazards(run),canDash:false};
 const motion=policy.chooseMotion(state);assert.equal(motion.expectedDamage,0);assert.ok(motion.jump||motion.x<.2);
});
