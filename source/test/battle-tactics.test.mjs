import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from 'node:fs/promises';
import { parsers } from 'prettier/plugins/meriyah';
import * as clusterTactics from '../src/battle-tactics.mjs';
import {chooseMotion} from '../src/policy.mjs';
import {
  nativeMovementInput,
  nativeEnemyControlActive,
  nativeContactDamageUpperBound,
  nativeProjectileDamageUpperBound,
  assessTacticalState,
  healingResourceDecision,
  resourceApproachDecision,
  scoreCombatPosition,
  combatDistanceOptions,
  chooseCombatMotion,
  planExpertCombat,
  planUltimateCombat,
  TacticalDirector,
} from "../src/battle-tactics.mjs";

test("native charm counter-steers input while preserving the world plan and status timer", () => {
  const run = { player: { pstat: { charm: 2.2 } } };
  const direction = { x: 0.6, z: -0.8 };
  assert.deepEqual(nativeMovementInput(run, direction, 1 / 60), { x: -0.6, z: 0.8, inverted: true });
  assert.deepEqual(direction, { x: 0.6, z: -0.8 });
  assert.equal(run.player.pstat.charm, 2.2);
});

test("counter-steering expires on the same frame as the native charm timer", () => {
  const run = { player: { pstat: { charm: 0.01 } } };
  assert.deepEqual(nativeMovementInput(run, { x: 1, z: 0.5 }, 0.02), { x: 1, z: 0.5, inverted: false });
  assert.equal(nativeMovementInput(run, { x: 1, z: 1 }, 0.01).inverted, false);
  assert.equal(nativeMovementInput(run, { x: 1, z: 1 }, 0.009).inverted, true);
});

test("old player state without charm keeps its input and invalid values cannot become movement", () => {
  assert.deepEqual(nativeMovementInput({ player: {} }, { x: 0.2, z: -1 }, 1 / 60), { x: 0.2, z: -1, inverted: false });
  assert.deepEqual(nativeMovementInput(null, { x: NaN, z: Infinity }), { x: 0, z: 0, inverted: false });
});

test("enemy control expires before the upcoming native steering step", () => {
  const run = { enemies: { flags: [2], sleep: [0.01], frozen: [0], stun: [0],
    ccT: [0], ccImmune: [0] } };
  const before = structuredClone(run);
  assert.equal(nativeEnemyControlActive(run, 0, 1 / 60), false);
  assert.equal(nativeEnemyControlActive(run, 0, 0.01), false);
  assert.equal(nativeEnemyControlActive(run, 0, 0.009), true);
  run.enemies.frozen[0] = 0.3;
  assert.equal(nativeEnemyControlActive(run, 0, 1 / 60), true,
    "one lasting control still suppresses steering after the shorter one ends");
  run.enemies.frozen[0] = 0;
  assert.deepEqual(run, before, "the predicate never ticks native status timers");
  assert.equal(nativeEnemyControlActive({}, 0, 1 / 60), false);
});

test("native heavy-enemy CC immunity and break-out restore steering in the same frame", () => {
  const run = { enemies: { flags: [4], sleep: [3], frozen: [0], stun: [0],
    ccT: [1.99], ccImmune: [0] } };
  assert.equal(nativeEnemyControlActive(run, 0, 0.02), false);
  assert.equal(nativeEnemyControlActive(run, 0, 0.005), true);
  run.enemies.ccT[0] = 0; run.enemies.ccImmune[0] = 0.001;
  assert.equal(nativeEnemyControlActive(run, 0, 0.02), false,
    "the native update enters its immunity branch before decrementing that timer");
  run.enemies.flags[0] = 2;
  assert.equal(nativeEnemyControlActive(run, 0, 0.02), true,
    "ordinary alphas are not given the heavy-enemy CC immunity branch");
});

function fixture() {
  return {
    state: "play", time: 100, stageTime: 100, stage: 1, terrain: {},
    bossSpawned: false, stageCleared: false, boss: { alive: false },
    player: {
      hp: 100, maxHp: 100, level: 8, moveSlots: 3,
      pos: { x: 0, y: 0, z: 0 },
      stats: { armor: 0, regen: 0, healing: 1, moveSpeed: 1 },
      moves: [{ def: { key: "tackle", arch: "strike" }, level: 2 },
        { def: { key: "swift", arch: "projectile" }, level: 2 }],
      iframes: 0, invisT: 0, woundT: 0,
    },
    enemies: { n: 0, alive: [], dying: [], flags: [], dmg: [],
      x: [], y: [], z: [], radius: [], hgt: [] },
    projectiles: { n: 0, alive: [], flags: [], x: [], z: [] },
    diff: { enemyDamage: 1 }, stats: { damageTaken: 0 }, ult: { ready: false },
  };
}
function enemy(run, properties = {}) {
  const values = { alive: 1, dying: 0, flags: 0, dmg: 5,
    x: 3, y: 0, z: 0, radius: 0.7, hgt: 2, ...properties };
  const index = run.enemies.n++;
  for (const [key, value] of Object.entries(values)) run.enemies[key][index] = value;
  return index;
}
const altar = (properties = {}) => ({ kind: "altar", x: 0, z: 0, r: 4,
  used: false, charge: 0.2, data: { tier: 0 }, ...properties });
const advance = (run, seconds = 0.5) => { run.time += seconds; run.stageTime += seconds; };

// Real reviewed casts are only parsed and constructed, never fired or booted.
const ultimateSource=await readFile(new URL('../research/tower-boss-current-20261027-main.js',import.meta.url),'utf8');
const ultimateCasts=new Map();
function collectUltimateCasts(node) {
 if(!node||typeof node!=='object')return;
 const put=(id,value)=>{if(value?.type!=='ObjectExpression')return;
  const cast=value.properties.find(p=>(p.key?.name??p.key?.value)==='cast')?.value;
  if(cast&&value.properties.some(p=>(p.key?.name??p.key?.value)==='names'))
   ultimateCasts.set(id,new Function('return ({cast'+ultimateSource.slice(cast.start,cast.end)+'}).cast')());};
 if(node.type==='ObjectExpression')for(const p of node.properties)put(p.key?.value,p.value);
 if(node.type==='AssignmentExpression'&&node.left?.object?.name==='P_')put(node.left.property?.value,node.right);
 for(const v of Object.values(node))if(Array.isArray(v))v.forEach(collectUltimateCasts);else if(v&&typeof v==='object')collectUltimateCasts(v);
}
collectUltimateCasts(parsers.meriyah.parse(ultimateSource));
function clusterFixture(id=35,tier=1) {
 const r=fixture();r.tower={state:'wave',floor:50};r.player.stats.area=1;r.player.stats.armor=0;
 r.player.speciesId=id;r.player.roster={id};r.ult={ready:true,active:0,uses:0,tier,form:tier,def:{cast:ultimateCasts.get(id)}};
 r.aimTarget=range=>{for(let i=0;i<r.enemies.n;i++)if(r.enemies.alive[i]&&Math.hypot(r.enemies.x[i]-r.player.pos.x,r.enemies.z[i]-r.player.pos.z)<range)return i;return -1;};
 r.terrain={height:()=>0};return r;
}
const addGroup=(r,x,n,z=0)=>{for(let i=0;i<n;i++)enemy(r,{x:x+i*.12,z:z+i*.08});};
const clusterPlan=(r,options={})=>clusterTactics.planTowerUltimateCluster?.(r,{enabled:true,routeAllowed:()=>true,...options})||{phase:'off',currentCount:0};

test('Tower aggressive ultimate casts on two reachable targets instead of waiting for five',()=>{
 const r=clusterFixture();addGroup(r,7,2);
 const plan=clusterPlan(r);assert.equal(plan.phase,'cast');assert.equal(plan.currentCount,2);
 assert.equal(planUltimateCombat(r,{clusterPlan:plan}).press,true);
});
test('Tower aggressive ultimate prefers five distant targets over two local targets and fires on arrival',()=>{
 const r=clusterFixture();addGroup(r,-8,2);addGroup(r,28,5);
 const plan=clusterPlan(r);assert.equal(plan.phase,'approach');assert.ok(plan.target.x>8&&plan.target.x<25);
 assert.equal(plan.bestCount,5);assert.equal(planUltimateCombat(r,{clusterPlan:plan}).press,false);
 r.player.pos.x=plan.target.x;r.player.pos.z=plan.target.z;r.time+=2;
 const arrived=clusterPlan(r,{history:plan.nextHistory});assert.equal(arrived.phase,'cast');
 assert.ok(arrived.currentCount>=5);assert.equal(planUltimateCombat(r,{clusterPlan:arrived}).press,true);
});
test('Tower aggressive ultimate casts in place when the larger group is already inside its native envelope',()=>{
 const r=clusterFixture();addGroup(r,-7,2);addGroup(r,12,5);
 assert.equal(clusterPlan(r).phase,'cast');
});
test('Tower aggressive ultimate avoids a trip for only one extra target or a group beyond three seconds',()=>{
 for(const [x,n] of [[28,3],[65,8]]) {
  const r=clusterFixture();addGroup(r,-8,2);addGroup(r,x,n);
  assert.equal(clusterPlan(r).phase,'cast');
 }
});
test('Tower aggressive ultimate rejects blocked approaches and cancels a charge-scoped chase at three seconds',()=>{
 const r=clusterFixture();addGroup(r,-8,2);addGroup(r,28,5);
 assert.equal(clusterPlan(r,{routeAllowed:()=>false}).phase,'cast');
 const first=clusterPlan(r);assert.equal(first.phase,'approach');r.time+=3.01;
 const timeout=clusterPlan(r,{history:first.nextHistory});assert.equal(timeout.phase,'cast');
 for(let i=2;i<7;i++)r.enemies.z[i]+=5;
 assert.equal(clusterPlan(r,{history:timeout.nextHistory}).phase,'cast','a changing group does not restart the chase budget');
});
test('Tower aggressive ultimate re-evaluates dispersed groups and never manufactures targets from corpses or captures',()=>{
 const r=clusterFixture();addGroup(r,-8,2);addGroup(r,28,5);
 const first=clusterPlan(r);assert.equal(first.phase,'approach');
 for(let i=2;i<7;i++)r.enemies.alive[i]=0;
 assert.equal(clusterPlan(r,{history:first.nextHistory}).phase,'cast');
 r.enemies.dying[0]=1;r.capture={state:'weakened',index:1};
 assert.equal(clusterPlan(r).currentCount,0);
});
test('Tower aggressive ultimate uses native area scaling and form-specific range rather than the common 18m gate',()=>{
 const r=clusterFixture(4,0);addGroup(r,11,2);
 assert.equal(clusterPlan(r).phase,'approach');
 r.player.stats.area=4;assert.equal(clusterPlan(r).phase,'cast');
 r.player.stats.area=.25;assert.equal(clusterPlan(r).phase,'approach');
});
test('Tower aggressive ultimate follows two-dimensional native moon acquisition even during flight',()=>{
 const r=clusterFixture();addGroup(r,7,2);r.player.pos.y=15;
 assert.equal(clusterPlan(r).phase,'cast');
});
test('Tower aggressive ultimate falls back for changed native casts, copying skills, disabled mode and bosses',()=>{
 for(const change of [r=>{r.ult.def.cast=function changed(){};},r=>{r.ult.def.cast=ultimateCasts.get(132);},
  r=>{r.tower=null;},r=>{r.tower={state:'clear',floor:50};},r=>{r.boss.alive=true;},r=>{r.player.stats.area=NaN;}]) {
  const r=clusterFixture();addGroup(r,7,2);change(r);assert.equal(clusterPlan(r).phase,'off');
 }
 const q=clusterFixture();addGroup(q,7,2);assert.equal(clusterPlan(q,{enabled:false}).phase,'off');
});
test('Tower aggressive ultimate cannot use the old five-nearby rule outside the reviewed spell envelope',()=>{
 const r=clusterFixture(4,0);addGroup(r,9.5,5);
 const plan=clusterPlan(r,{routeAllowed:()=>false});assert.equal(plan.currentCount,0);
 assert.equal(planUltimateCombat(r,{clusterPlan:plan}).press,false);
});
test('Tower aggressive ultimate never postpones real emergency defence to reach a larger group',()=>{
 const r=clusterFixture();addGroup(r,-8,2);addGroup(r,28,5);
 const plan=clusterPlan(r);assert.equal(plan.phase,'approach');
 assert.equal(planUltimateCombat(r,{clusterPlan:plan,imminentImpact:true,motion:{safety:{healthDamage:10}}}).press,true);
});

function ultimateBossFixture(id=35,tier=1,x=20){
 const r=clusterFixture(id,tier);enemy(r,{x,z:0,flags:4});r.boss={alive:true,bossIndex:0};return r;
}
test('aggressive Tower boss priority holds R outside the reviewed spell radius despite five nearby adds',()=>{
 const r=ultimateBossFixture(4,0,12);addGroup(r,-7,5);
 const plan=clusterPlan(r);assert.equal(plan.boss?.index,0);
 assert.equal(planUltimateCombat(r,{clusterPlan:plan,bossPriority:true}).press,false);
});
test('aggressive Tower boss priority approaches native coverage instead of looking for a larger ordinary group',()=>{
 const r=ultimateBossFixture(35,1,22);addGroup(r,-8,8);
 const plan=clusterPlan(r);assert.equal(plan.phase,'approach');assert.ok(plan.target.x>0);
 assert.equal(planUltimateCombat(r,{clusterPlan:plan,bossPriority:true}).press,false);
 r.player.pos.x=plan.target.x;r.player.pos.z=plan.target.z;
 const arrived=clusterPlan(r,{history:plan.nextHistory});assert.equal(arrived.phase,'cast');
 assert.equal(planUltimateCombat(r,{clusterPlan:arrived,bossPriority:true}).press,true);
});
test('aggressive Tower area ultimate can cover the boss while native aim remains on an add',()=>{
 const r=ultimateBossFixture(4,0,6);addGroup(r,-2,1);r.aimTarget=()=>1;
 assert.equal(planUltimateCombat(r,{clusterPlan:clusterPlan(r),bossPriority:true}).press,true);
 assert.equal(r.aimTarget(18),1);
});
test('aggressive Tower boss acquisition counts rivals beyond the planning margin but inside the native area-scaled range',()=>{
 const r=ultimateBossFixture(35,1,14);r.player.stats.area=4;addGroup(r,20,8);
 assert.equal(planUltimateCombat(r,{clusterPlan:clusterPlan(r),bossPriority:true}).press,false,
  'eight targets at20m can outrank the14m boss in native randomized32m acquisition');
});
test('aggressive Tower unknown or directional ultimate waits for native boss aim instead of spending on adds',()=>{
 const r=ultimateBossFixture(128,1,10);addGroup(r,-4,5);r.aimTarget=()=>1;
 assert.equal(planUltimateCombat(r,{clusterPlan:clusterPlan(r),bossPriority:true}).press,false);
 r.aimTarget=()=>0;assert.equal(planUltimateCombat(r,{clusterPlan:clusterPlan(r),bossPriority:true}).press,true);
});
test('aggressive Tower boss priority cannot withhold emergency defence or affect the disabled policy',()=>{
 const r=ultimateBossFixture(4,0,12);addGroup(r,-7,5);
 assert.equal(planUltimateCombat(r,{bossPriority:false}).press,true);
 assert.equal(planUltimateCombat(r,{clusterPlan:clusterPlan(r),bossPriority:true,imminentImpact:true,
  motion:{safety:{healthDamage:20}}}).press,true);
});

test("ordinary contact damage upper bounds weakness and armor without crediting shield or evasion", () => {
  const run = fixture(), index = enemy(run, { dmg: 10 });
  run.diff.enemyDamage = 1.5;
  run.player.stats.armor = 45;
  run.player.shield = 100;
  run.player.stats.evasion = 0.6;
  assert.equal(nativeContactDamageUpperBound(run, index), 12);
  run.player.ability = "battle-armor";
  const nativeHurtMod = damage => Math.max(damage * 0.25, damage - (3 + run.player.level * 0.3));
  assert.ok(nativeContactDamageUpperBound(run, index) >= nativeHurtMod(12));
});

test("remote cooperative bodies retain the same native contact bound and local danger assessment",()=>{
  const run=fixture(),index=enemy(run,{flags:65536,dmg:10});
  const proxy=nativeContactDamageUpperBound(run,index),state=assessTacticalState(run);
  assert.ok(proxy>0);assert.equal(state.close,1);assert.ok(state.incomingRate>0);
  run.enemies.flags[index]=0;assert.equal(nativeContactDamageUpperBound(run,index),proxy);
});

test("boss and alpha family contact caps bound one hit while missing native damage remains unknown", () => {
  for (const flags of [2, 4, 4096, 8192]) {
    const run = fixture(), index = enemy(run, { flags });
    assert.equal(nativeContactDamageUpperBound(run, index), 25);
  }
  const run = fixture(), index = enemy(run, { dmg: NaN });
  assert.equal(nativeContactDamageUpperBound(run, index), null);
  run.enemies.dmg[index] = -1;
  assert.equal(nativeContactDamageUpperBound(run, index), null);
  assert.equal(nativeContactDamageUpperBound(run, 20), null);
});

test("native projectile factories are not discounted twice and per-hit caps do not imply slide immunity", () => {
  const run = fixture();
  run.projectiles = { dmg: [20, 100, 100, NaN], flags: [1, 1025, 2049, 1] };
  run.player.stats.armor = 45; run.diff.enemyDamage = 1.5;
  assert.equal(nativeProjectileDamageUpperBound(run, 0), 24);
  assert.equal(nativeProjectileDamageUpperBound(run, 1), 15);
  assert.equal(nativeProjectileDamageUpperBound(run, 2), 25);
  assert.equal(nativeProjectileDamageUpperBound(run, 3), null);
  run.player.stats.armor = -10;
  assert.ok(nativeProjectileDamageUpperBound(run, 0) > 32);
  run.player.stats.armor = NaN;
  assert.equal(nativeProjectileDamageUpperBound(run, 0), null);
});

test("assessment excludes dead, hidden and vertically separated bodies and friendly projectiles", () => {
  const run = fixture();
  enemy(run);
  enemy(run, { flags: 4 });
  enemy(run, { x: -3, dmg: NaN });
  enemy(run, { alive: 0 });
  enemy(run, { dying: 0.1 });
  enemy(run, { flags: 128 });
  enemy(run, { y: 30 });
  run.projectiles = { n: 3, alive: [1, 1, 1], flags: [1, 0, 1], x: [1, 1, 30], z: [0, 0, 0] };
  const state = assessTacticalState(run);
  assert.equal(state.close, 3);
  assert.equal(state.unknownClose, 1);
  assert.equal(state.nearBullets, 1);
  assert.ok(state.pressure > 1);
});

test("wounds halve native healing and regeneration instead of pretending every berry fully heals", () => {
  const run = fixture();
  run.player.hp = 30;
  run.player.stats.regen = 4;
  run.player.stats.healing = 1.2;
  run.player.woundT = 5;
  const state = assessTacticalState(run);
  assert.equal(state.regen, 2.4);
  const decision = healingResourceDecision(run, { kind: "berry", x: 0, z: 0 }, state);
  assert.equal(decision.use, true);
  assert.equal(decision.gain, 30);
});

test("endless healing and regen use the deployed time penalty, including its 30 percent floor", () => {
  for (const minutes of [10, 40, 70]) {
    const run = fixture();
    run.endless = {};
    run.time = minutes * 60;
    run.player.hp = 20;
    run.player.stats.regen = 4;
    const multiplier = Math.max(0.3, 1 - 0.025 * Math.max(0, minutes - 30));
    const state = assessTacticalState(run);
    assert.ok(Math.abs(state.regen - 4 * multiplier) < 1e-8);
    const decision = healingResourceDecision(run, { kind: "berry", x: 0, z: 0 }, state);
    assert.ok(Math.abs(decision.gain - 50 * multiplier) < 1e-8);
  }
});

test("safe natural regeneration preserves a berry while critical life uses accessible recovery", () => {
  const run = fixture(), berry = { kind: "berry", x: 0, z: 0 };
  run.player.hp = 50;
  run.player.stats.regen = 5;
  const safe = healingResourceDecision(run, berry);
  assert.equal(safe.safeRecovery, true);
  assert.equal(safe.use, false);
  run.player.hp = 25;
  assert.equal(healingResourceDecision(run, berry).use, true);
  run.player.hp = 100;
  assert.equal(healingResourceDecision(run, berry).use, false);
});

test("recent damage and close attackers make recovery useful before critical health", () => {
  const run = fixture();
  run.player.hp = 70;
  enemy(run, { dmg: 15 }); enemy(run, { x: -3, dmg: 15 });
  const state = assessTacticalState(run, [{ time: 99, stage: 1, lost: 20 }]);
  const decision = healingResourceDecision(run, { kind: "berry", x: 3, z: 0 }, state);
  assert.equal(state.recentLoss, 20);
  assert.equal(decision.threatened, true);
  assert.equal(decision.use, true);
});

test("altar duration follows native tier and stage and distinguishes actual immunity from a ready Ultimate", () => {
  const run = fixture(), director = new TacticalDirector(), object = altar({ charge: 0.5, data: { tier: 2 } });
  run.stage = 3;
  let state = assessTacticalState(run);
  let policy = director.altarPolicy(run, object, state, false);
  assert.equal(policy.chargeSeconds, 33);
  assert.equal(policy.remaining, 16.5);
  run.ult.ready = true;
  policy = director.altarPolicy(run, object, assessTacticalState(run), false);
  assert.equal(policy.protectedFinish, false);
  run.player.iframes = 17;
  policy = director.altarPolicy(run, object, assessTacticalState(run), false);
  assert.equal(policy.protectedFinish, true);
});

test("an altar that never charges exhausts a finite active attempt and eventually all retry opportunities", () => {
  const run = fixture(), object = altar({ charge: 0 }), director = new TacticalDirector();
  let result;
  for (let retry = 0; retry < 3; retry++) {
    for (let tick = 0; tick < 90; tick++) {
      result = director.observe(run, { entity: object }, assessTacticalState(run), false);
      if (!result.allowed) break;
      advance(run);
    }
    assert.equal(result.allowed, false);
    assert.equal(result.reason, "altar-attempt-budget");
    advance(run, 36);
  }
  advance(run, 300);
  assert.equal(director.altarPolicy(run, object, assessTacticalState(run), false).allowed, false);
});

test("repeated exits and charge decay cannot keep a contested altar active indefinitely", () => {
  const run = fixture(), object = altar(), director = new TacticalDirector();
  director.observe(run, { entity: object }, assessTacticalState(run), false);
  let result;
  for (let exit = 0; exit < 4; exit++) {
    run.player.pos.x = 0;
    advance(run);
    director.observe(run, { entity: object }, assessTacticalState(run), false);
    run.player.pos.x = 10;
    for (let tick = 0; tick < 3; tick++) {
      advance(run);
      result = director.observe(run, { entity: object }, assessTacticalState(run), false);
      if (!result.allowed) break;
    }
    if (!result.allowed) break;
  }
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "altar-attempt-budget");
});

test("a dangerous damage rate and low health override altar completion greed", () => {
  const run = fixture(), director = new TacticalDirector(), object = altar({ charge: 0.95 });
  run.player.hp = 20;
  assert.equal(director.altarPolicy(run, object, assessTacticalState(run), false).allowed, false);
  run.player.hp = 70;
  object.charge = 0;
  enemy(run, { dmg: 50 }); enemy(run, { x: -3, dmg: 50 });
  assert.equal(director.altarPolicy(run, object, assessTacticalState(run), false).allowed, false);
});

test("altar memory resets for a new stage, terrain or native run without changing native charge", () => {
  for (const change of ["stage", "terrain", "run"]) {
    let run = fixture();
    const object = altar(), director = new TacticalDirector();
    const entry = director.entry(run, object);
    entry.attempts = 3; entry.spentTime = 150;
    if (change === "stage") run.stage++;
    else if (change === "terrain") run.terrain = {};
    else run = { ...run };
    const replacement = director.entry(run, object);
    assert.notEqual(entry, replacement);
    assert.equal(replacement.attempts, 0);
    assert.equal(object.charge, 0.2);
  }
});

test("poor combat output cannot defer the mandatory boss beyond the fixed preparation budget", () => {
  const run = fixture(), director = new TacticalDirector();
  run.player.moves = [{ def: { arch: "strike" }, level: 1 }];
  run.player.hp = 30;
  run.stageTime = 239;
  assert.equal(director.progression(run, assessTacticalState(run), { safeMode: false }).summonBoss, false);
  run.stageTime = 240;
  assert.equal(director.progression(run, assessTacticalState(run), { safeMode: false }).summonBoss, true);
  run.bossSpawned = true;
  assert.equal(director.progression(run, assessTacticalState(run), { safeMode: false }).summonBoss, false);
});

test("portal detour time is stable when more optional rewards repeatedly become visible", () => {
  const run = fixture(), director = new TacticalDirector();
  run.stageCleared = true;
  run.stageTime = 120;
  assert.equal(director.progression(run, assessTacticalState(run), { nearbyValuable: true }).leaveStage, false);
  for (let time = 125; time < 165; time += 5) {
    run.stageTime = time;
    assert.equal(director.progression(run, assessTacticalState(run), { nearbyValuable: true }).leaveStage, false);
  }
  run.stageTime = 165;
  const result = director.progression(run, assessTacticalState(run), { nearbyValuable: true });
  assert.equal(result.sinceClear, 45);
  assert.equal(result.leaveStage, true);
  assert.equal(result.forceLeave, true);
});

test("shiny and quest holds have finite stable deadlines and critical life can leave immediately", () => {
  const run = fixture(), director = new TacticalDirector();
  run.stageCleared = true;
  run.stageTime = 100;
  assert.equal(director.progression(run, assessTacticalState(run), { shinyHold: true }).leaveStage, false);
  run.stageTime = 220;
  assert.equal(director.progression(run, assessTacticalState(run), { shinyHold: true }).forceLeave, true);
  run.stage++;
  run.stageCleared = false;
  run.stageTime = 10;
  const first = director.progression(run, assessTacticalState(run), { questHold: true, minTime: 10000 });
  run.stageTime = 100;
  const again = director.progression(run, assessTacticalState(run), { questHold: true, minTime: 100000 });
  assert.equal(first.bossDeadline, 1800);
  assert.equal(again.bossDeadline, first.bossDeadline);
  run.stageCleared = true;
  run.player.hp = 20;
  assert.equal(director.progression(run, assessTacticalState(run), { shinyHold: true }).leaveStage, true);
});

test("tactical decisions do not mutate native state and do not read loadout preference metadata", () => {
  const run = fixture(), object = altar(), original = structuredClone(run), originalObject = structuredClone(object);
  const director = new TacticalDirector();
  const baseline = assessTacticalState(run);
  director.observe(run, { entity: object }, baseline, false);
  director.progression(run, baseline, {});
  healingResourceDecision(run, { kind: "berry", x: 0, z: 0 }, baseline);
  assert.deepEqual(run, original);
  assert.deepEqual(object, originalObject);
  const withPreferences = structuredClone(run);
  withPreferences.build = { items: ["invincibility"], statWeights: { damage: 999 } };
  withPreferences.player.build = { healthBudget: 9999, priority: "never-escape" };
  assert.deepEqual(assessTacticalState(withPreferences), baseline);
});

test("alternating stalled altar targets still consumes each finite active and total visit budget", () => {
  const run = fixture(), director = new TacticalDirector();
  const objects = [altar({ x: -10, charge: 0 }), altar({ x: 10, charge: 0 })];
  let deferred = 0;
  for (let tick = 0; tick < 1200; tick++) {
    advance(run);
    const policy = director.observe(run, { entity: objects[tick % 2] }, assessTacticalState(run), false);
    if (!policy.allowed) deferred++;
  }
  assert.ok(deferred > 0, "frequent target changes cannot restart the visit clock forever");
  const entries = objects.map(object => director.entry(run, object));
  assert.ok(entries.every(entry => entry.spentTime > 0), "time is charged to both previously active targets");
  assert.ok(entries.every(entry => entry.attempts >= 3 || entry.spentTime >= 150));
  for (const object of objects)
    assert.equal(director.altarPolicy(run, object, assessTacticalState(run), false).allowed, false);
});

test("native wave timing advances the finite boss budget before the first major swarm", () => {
  const run = fixture(), director = new TacticalDirector();
  run.player.moves = [{ def: { arch: "strike" }, level: 1 }];
  run.director = { timeline: [{ t: 60, kind: "card" }, { t: 200, kind: "swarm" }, { t: 255, kind: "totem" }] };
  run.stageTime = 139;
  assert.equal(director.progression(run, assessTacticalState(run), {}).summonBoss, false);
  run.stageTime = 140;
  const result = director.progression(run, assessTacticalState(run), {});
  assert.equal(result.bossDeadline, 140);
  assert.equal(result.summonBoss, true);
  assert.equal(result.firstSurge, 200);
  assert.equal(result.reason, "before-native-escalation");
  run.director.timeline = [{ t: 390, kind: "swarm" }];
  assert.equal(director.progression(run, assessTacticalState(run), {}).bossDeadline, 140,
    "native removal of a processed event cannot extend the commitment deadline");
  run.endless = {};
  assert.equal(director.progression(run, assessTacticalState(run), {}).bossDeadline, 300);
});

test("readiness keeps a boss travel intent through temporary crowd pressure and a bounded recovery", () => {
  const run = fixture(), director = new TacticalDirector();
  let state = assessTacticalState(run);
  assert.equal(director.progression(run, state, {}).forceBoss, true);
  run.stageTime = 105; run.time = 105; run.player.hp = 30;
  enemy(run, { dmg: 30 }); enemy(run, { x: -3, dmg: 30 });
  const recovery = director.progression(run, assessTacticalState(run), {});
  assert.equal(recovery.summonBoss, true);
  assert.equal(recovery.forceBoss, false);
  run.stageTime = 121; run.time = 121;
  assert.equal(director.progression(run, assessTacticalState(run), {}).forceBoss, true);
  run.player.hp = 100; run.stageTime = 110; run.time = 110;
  assert.equal(director.progression(run, assessTacticalState(run), {}).forceBoss, true);
  run.stage = 2;
  const reset = director.progression(run, assessTacticalState(run), {});
  assert.equal(reset.bossCommittedAt, null);
  assert.equal(reset.forceBoss, false);
});

test("explicit quest or shiny holds are not silently overridden by an old preparation intent", () => {
  const run = fixture(), director = new TacticalDirector();
  assert.equal(director.progression(run, assessTacticalState(run), {}).forceBoss, true);
  assert.equal(director.progression(run, assessTacticalState(run), { shinyHold: true }).summonBoss, false);
  assert.equal(director.progression(run, assessTacticalState(run), { questHold: true, minTime: 700 }).summonBoss, false);
});

test("resource value accounts for an occupied destination and approach corridor without modifying the run", () => {
  const run = fixture(), goal = { kind: "freechest", x: 10, y: 0, z: 0 };
  const clear = resourceApproachDecision(run, goal);
  enemy(run, { x: 9, dmg: 35 }); enemy(run, { x: 11, dmg: 35 }); enemy(run, { x: 10, z: 1, dmg: 35 });
  const before = structuredClone(run), dangerous = resourceApproachDecision(run, goal);
  assert.ok(dangerous.utilityFactor < clear.utilityFactor);
  assert.ok(dangerous.immediateBurst > 0);
  assert.deepEqual(run, before);
  run.player.hp = 30;
  assert.equal(resourceApproachDecision(run, goal).eligible, false);
  assert.equal(resourceApproachDecision(run, { ...goal, kind: "berry" }).eligible, true);
  run.player.pos.x = goal.x;
  assert.equal(resourceApproachDecision(run, goal).eligible, true,
    "an immediately usable free interaction is not abandoned as a distant detour");
  run.player.pos.x = 0;
  run.enemies.alive.fill(0);
  assert.equal(resourceApproachDecision(run, goal).eligible, true);
});

test("macro combat positioning avoids an occupied kite destination and its crowded approach", () => {
  const run = fixture();
  const target = enemy(run, { flags: 4, x: 10, z: 8, dmg: 100 });
  for (let i = 0; i < 12; i++) enemy(run, { x: 9 + i % 3, z: (i % 2) - 0.5, dmg: 20 });
  const crowded = scoreCombatPosition(run, target, { x: 12, z: 0 });
  const clear = scoreCombatPosition(run, target, { x: -12, z: 0 });
  assert.ok(crowded.cost > clear.cost + 30);
  assert.ok(crowded.destinationPressure > clear.destinationPressure);
  assert.ok(crowded.corridorPressure > 0);
});

test("a clear endpoint does not excuse crossing a dense escort line", () => {
  const run = fixture();
  for (let i = 0; i < 5; i++) enemy(run, { x: 5, z: i * 0.2, dmg: 30 });
  const through = scoreCombatPosition(run, -1, { x: 25, z: 0 });
  const away = scoreCombatPosition(run, -1, { x: -25, z: 0 });
  assert.equal(through.destinationPressure, 0);
  assert.ok(through.corridorPressure > 0);
  assert.ok(through.cost > away.cost);
});

test("macro retreat trigger uses actual close pressure and health, not loadout preferences", () => {
  const run = fixture();
  for (let i = 0; i < 3; i++) enemy(run, { x: 3, z: i });
  assert.equal(scoreCombatPosition(run, -1, { x: -10, z: 0 }).retreatNeeded, false);
  run.player.hp = 40;
  assert.equal(scoreCombatPosition(run, -1, { x: -10, z: 0 }).retreatNeeded, true);
  run.player.hp = 100;
  for (let i = 0; i < 7; i++) enemy(run, { x: -3, z: i % 2 });
  const before = structuredClone(run), result = scoreCombatPosition(run, -1, { x: -10, z: 0 });
  assert.equal(result.retreatNeeded, true);
  run.plan = { objective: "time", items: ["anything"] };
  assert.deepEqual(scoreCombatPosition(run, -1, { x: -10, z: 0 }), result);
  delete run.plan;
  assert.deepEqual(run, before);
});

test("macro pressure retains unknown and waking bodies, but ignores dead and separated ground enemies", () => {
  const run = fixture(), point = { x: 10, y: 0, z: 0 };
  const index = enemy(run, { x: 10, dmg: NaN });
  const unknown = scoreCombatPosition(run, -1, point);
  assert.ok(unknown.cost > 0);
  run.enemies.sleep = [30];
  assert.equal(scoreCombatPosition(run, -1, point).cost, unknown.cost);
  run.enemies.y[index] = 30;
  assert.equal(scoreCombatPosition(run, -1, point).cost, 0);
  run.enemies.flags[index] = 16;
  assert.ok(scoreCombatPosition(run, -1, point).cost > 0, "flying pursuit is not assumed stuck on a ledge");
  run.enemies.alive[index] = 0;
  assert.equal(scoreCombatPosition(run, -1, point).cost, 0);
});

test("boss exclusion preserves escort costs and nearer moving enemies raise arrival pressure", () => {
  const run = fixture(), target = enemy(run, { flags: 4, x: 12, dmg: 100 });
  const point = { x: 12, z: 0 };
  assert.equal(scoreCombatPosition(run, target, point).cost, 0);
  const escort = enemy(run, { x: 30, dmg: 10 });
  assert.equal(scoreCombatPosition(run, target, point).cost, 0);
  run.enemies.vx = []; run.enemies.vx[escort] = -12;
  assert.ok(scoreCombatPosition(run, target, point).destinationPressure > 0);
  run.enemies.dying[escort] = 0.2;
  assert.equal(scoreCombatPosition(run, target, point).cost, 0);
});

test("a newly learned weak barrage does not erase the native working distance of an established strike", () => {
  const run = fixture(), boss = enemy(run, { flags: 4, radius: 1.5 });
  run.player.moves = [
    { def: { key: "vine-whip", arch: "strike", area: 3.3, dmg: 15.1823, cd: 0.8075 },
      level: 3, mods: {}, damageDone: 2411 },
    { def: { key: "razor-leaf", arch: "barrage", area: 0.35, speed: 30, dur: 0.6,
      dmg: 4, cd: 2, count: 4 }, level: 1, mods: {}, damageDone: 0 },
  ];
  const options = combatDistanceOptions(run, boss, 11),
    main = options.find(option => option.reason === "weighted-native-coverage"),
    far = options.find(option => option.reason === "ranged-fallback");
  assert.ok(options.length <= 3);
  assert.ok(main.range < 3.3 * 1.35 + run.enemies.radius[boss]);
  assert.ok(main.range > run.enemies.radius[boss] + (run.player.radius || 0.55));
  assert.ok(main.coverage > far.coverage + 0.7,
    "standing at the old MAX range cannot pretend the actual melee damage is still covered");
  assert.equal(far.range, 11);
});

test("native Bulbasaur capture distances preserve short output beside a newly learnt barrage", () => {
  const run = fixture(), alpha = enemy(run, { flags: 2, radius: 0.7 });
  // Public 0.8.13 ng definitions, not a user build or a gameplay damage claim.
  run.player.moves = [
    { def: { key: "vine-whip", arch: "strike", dmg: 15.182307692307692,
      cd: 0.8075, count: 1, area: 3.3 }, mods: {}, level: 1, damageDone: 0 },
    { def: { key: "razor-leaf", arch: "barrage", dmg: 4.657692307692308,
      cd: 1.0005, count: 4, area: 0.35, speed: 30, dur: 0.6 }, mods: {}, level: 1, damageDone: 0 },
    { def: { key: "sleep-powder", arch: "cone", dmg: 3.1655384615384614,
      cd: 1.8, count: 1, area: 7, dur: 1 }, mods: {}, level: 1, damageDone: 0 },
  ];
  const before = structuredClone(run);
  for (const fallback of [11, 8, 7]) {
    const options = combatDistanceOptions(run, alpha, fallback),
      working = options.find(option => option.reason === "weighted-native-coverage"),
      far = options.find(option => option.reason === "ranged-fallback");
    assert.ok(working && Math.abs(working.range - (3.3 * 1.35 + 0.7 - 0.25)) < 1e-9);
    assert.ok(working.coverage > 0.9,
      "a legal closer candidate covers the dominant strike and barrage instead of only the farthest barrage");
    assert.ok(far && far.coverage < 0.5);
    assert.ok(options.some(option => option.reason === "body-gap"));
  }
  assert.deepEqual(run, before, "capture positioning never changes native attacks, damage or timers");
});

test("a capture approach at low health cannot force a lethal straight line through a moving body", () => {
  const state = { player: { x: 0, y: 0, z: 0, radius: 0.55, speed: 6.3,
    hp: 10, maxHp: 100, shield: 0, grounded: true, vx: 0, vz: 0, frameDt: 1 / 60 },
    target: { x: 7, z: 0 }, walkable: () => true, canDash: false, canJump: false,
    enemies: [{ x: 4, z: 0, radius: 0.7, vx: -4, vz: 0, damage: 25, frameLag: 1 / 60 }] };
  const motion = chooseCombatMotion(state);
  assert.ok(Math.abs(motion.z) > 0.5, "the safe detour beats walking straight toward the capture target");
  assert.equal(motion.safety.hitCount, 0);
  assert.equal(motion.safety.healthDamage, 0);
  assert.equal(motion.acceptedDamage, false);
  assert.equal(state.player.hp, 10);
});

test("strong observed ranged output retains a ranged candidate instead of blindly closing to the shortest move", () => {
  const run = fixture(), boss = enemy(run, { flags: 4 });
  run.player.moves = [
    { def: { key: "short", arch: "strike", area: 3, dmg: 10, cd: 1 }, mods: {}, level: 1, damageDone: 0 },
    { def: { key: "ranged", arch: "barrage", speed: 30, dur: 0.6, dmg: 20, cd: 1 },
      mods: {}, level: 5, damageDone: 4000 },
  ];
  const options = combatDistanceOptions(run, boss, 11), main = options.find(option =>
    option.reason === "weighted-native-coverage");
  assert.ok(main.range > 10);
  assert.ok(main.coverage > 0.8);
  assert.ok(options.some(option => option.reason === "body-gap"));
});

test("strike coverage uses native area modifiers and enemy radius while respecting the body gap", () => {
  const run = fixture(), boss = enemy(run, { flags: 4, radius: 1.5 });
  run.player.stats.area = 1.5;
  run.player.moves = [{ def: { arch: "strike", area: 3.3, dmg: 15, cd: 1 },
    mods: { area: 1.2 }, level: 3, damageDone: 50 }];
  const main = combatDistanceOptions(run, boss, 11).find(option => option.reason === "weighted-native-coverage");
  assert.ok(Math.abs(main.range - (3.3 * 1.2 * 1.5 * 1.35 + 1.5 - 0.25)) < 1e-9);
  run.enemies.radius[boss] = 15;
  assert.ok(combatDistanceOptions(run, boss, 11).every(option => option.range >= 16.3));
});

test("distance opportunities are deterministic and independent of build labels without changing native stats", () => {
  const run = fixture(), boss = enemy(run, { flags: 4 });
  run.player.moves = [{ def: { arch: "strike", area: 3.3, dmg: 15, cd: 1 },
    mods: {}, level: 3, damageDone: 50 }];
  const before = structuredClone(run), original = combatDistanceOptions(run, boss, 11);
  assert.deepEqual(run, before);
  run.plan = { range: 999, items: ["anything"] };
  assert.deepEqual(combatDistanceOptions(run, boss, 11), original);
  run.player.moves = [{ def: { arch: "buff", dmg: 0 } }];
  assert.deepEqual(combatDistanceOptions(run, boss, 11), [{ range: 11, coverage: 0, reason: "ranged-fallback" }]);
});

function ultimateFixture() {
  const run=fixture();run.time=100;run.aimMode='manual';run.camYaw=.9;run.camPitch=.7;run.lockTarget=-1;
  run.ult={ready:true,active:0,uses:0};run.aimTarget=()=>-1;return run;
}

test('ultimate-only planning leaves native manual and automatic aiming completely untouched',()=>{
  for(const mode of ['manual','auto']) {
    const run=ultimateFixture();run.aimMode=mode;const index=enemy(run,{x:10,flags:4});run.aimTarget=()=>index;
    const before=JSON.stringify(run),plan=planUltimateCombat(run,{expertMode:true,targetIndex:999});
    assert.equal(plan.press,true);assert.equal(JSON.stringify(run),before);
    const old=planExpertCombat(run,{expertMode:true});assert.equal(old.aim,null);
    assert.deepEqual(old.fireWindows,[]);assert.equal(old.ultimate.press,true);
    assert.equal(run.camYaw,.9);assert.equal(run.camPitch,.7);assert.equal(run.lockTarget,-1);
  }
});

function emptyUltimateMotion(blocked=false,hazards=[]) {
  return chooseMotion({player:{x:0,y:0,z:0,speed:6.3,radius:.55,vx:0,vy:0,vz:0,height:0,
    grounded:true,slideT:0,frameDt:1/60,invulnerableFor:0,hp:100,maxHp:100,shield:0},
    target:{x:10,z:0},enemies:[],bullets:[],hazards,canDash:false,
    ...(blocked?{pathAllowed:()=>false}:{})});
}

test('geometric route restrictions in an empty arena never become an ultimate emergency',()=>{
  const motion=emptyUltimateMotion(true);
  assert.equal(motion.collision,true);assert.equal(motion.danger,true);
  assert.equal(motion.safety.healthDamage,0);assert.equal(motion.safety.hitCount,0);
  for(const hp of [100,20]) {
    const run=ultimateFixture();run.player.hp=hp;
    const operation=planUltimateCombat(run,{imminentImpact:motion.danger,motion});
    assert.equal(operation.press,false,'path restriction is not an attack, HP='+hp);
    assert.equal(operation.nextHistory.lastPressAt,undefined,'no fake native-use attempt');
  }
});

test('an old imminentImpact boolean without an actual damage forecast cannot waste an empty-arena ultimate',()=>{
  const run=ultimateFixture();
  for(const motion of [undefined,{danger:true,collision:true,safety:{healthDamage:0,hitCount:0,unknownHits:0,lethal:false}}])
    assert.equal(planUltimateCombat(run,{imminentImpact:true,motion}).press,false);
});

test('residual hostile attacks still permit an emergency ultimate with no living enemy or native aim target',()=>{
  for(const blocked of [false,true]) for(const damage of [80,undefined]) {
    const motion=emptyUltimateMotion(blocked,[{shape:'circle',x:0,y:0,z:0,radius:100,eta:.2,
      oneShot:true,maxHeight:1.3,life:.3,...(damage===undefined?{}:{damage})}]);
    assert.ok(motion.safety.healthDamage>0 || motion.safety.unknownHits>0);
    const run=ultimateFixture();
    const operation=planUltimateCombat(run,{imminentImpact:motion.danger,motion});
    assert.equal(operation.press,true);assert.equal(operation.reason,'protect-before-imminent-hit');
    assert.equal(operation.targetIndex,null);
    assert.equal(planUltimateCombat(run,{autoUlt:true,imminentImpact:motion.danger,motion}).press,false);
  }
});

test('native automatic ultimate never receives an extra scripted R action',()=>{
  const run=ultimateFixture();run.aimTarget=()=>enemy(run,{x:10,flags:4});
  assert.equal(planUltimateCombat(run,{autoUlt:true,motion:{safety:{lethal:true}}}).press,false);
  run.meta={profile:{settings:{autoUlt:true}}};
  assert.equal(planUltimateCombat(run,{autoUlt:false,motion:{safety:{lethal:true}}}).press,false);
});

test('ordinary ultimate windows use only the actual native target and current crowd pressure',()=>{
  const run=ultimateFixture(),boss=enemy(run,{x:10,flags:4});run.aimTarget=()=>boss;
  assert.equal(planUltimateCombat(run).press,true);
  run.aimTarget=()=>-1;assert.equal(planUltimateCombat(run,{targetIndex:boss}).press,false,
    'a script-preferred target cannot substitute for the current native manual view');
  const emergency=planUltimateCombat(run,{motion:{safety:{lethal:true}}});
  assert.equal(emergency.press,true);assert.equal(run.player.iframes,0);
  run.ult.active=1;assert.equal(planUltimateCombat(run,{motion:{safety:{lethal:true}}}).press,false);
});

test('normal capture weakening can use a ready ultimate but a parked capture or ally cannot consume a fast-cycle cast',()=>{
  const run=ultimateFixture(),capture=enemy(run,{x:10,flags:128});run.aimTarget=()=>capture;
  run.capture={index:capture,state:'roaming'};
  assert.equal(planUltimateCombat(run).press,true);
  const history={lastPressAt:98,nativeUsesAtPress:0,attempts:1,fastCycles:1};run.ult.uses=1;
  run.capture.state='weakened';assert.equal(planUltimateCombat(run,{history}).press,false);
  run.capture.state='idle';run.enemies.flags[capture]=2;run.allies={down:capture,state:'down'};
  assert.equal(planUltimateCombat(run,{history}).press,false);
});

test('rapid recharge requires a real native use increase and a subsequently ready short cycle rather than a high player level',()=>{
  const run=ultimateFixture(),target=enemy(run,{x:12});run.aimTarget=()=>target;run.player.level=999;
  const history={lastPressAt:98,nativeUsesAtPress:0,attempts:1,fastCycles:0};
  assert.equal(planUltimateCombat(run,{history}).rapidRecharge.confirmed,false);
  assert.equal(planUltimateCombat(run,{history}).press,false);
  run.ult.uses=1;
  const fast=planUltimateCombat(run,{history});
  assert.equal(fast.rapidRecharge.confirmed,true);assert.equal(fast.rapidRecharge.seconds,2);
  assert.equal(fast.press,true);assert.equal(fast.reason,'observed-fast-native-recharge');
  run.ult.ready=false;assert.equal(planUltimateCombat(run,{history:fast.nextHistory}).press,false);
  run.time=102;run.ult.ready=true;run.ult.uses=2;
  const next=planUltimateCombat(run,{history:fast.nextHistory});
  assert.equal(next.press,true);assert.equal(next.rapidRecharge.cycles,2);
  run.time=120;
  assert.equal(planUltimateCombat(run,{history:next.nextHistory}).rapidRecharge.confirmed,false);
  assert.equal(planUltimateCombat(run,{history:next.nextHistory}).press,false);
});

test('an ignored native R has bounded three-press batches and resumes after native-time backoff without an input storm',()=>{
  const run=ultimateFixture(),boss=enemy(run,{x:10,flags:4});run.aimTarget=()=>boss;
  let history={};const first=planUltimateCombat(run,{history});assert.equal(first.press,true);
  history=first.nextHistory;run.time+=.01;assert.equal(planUltimateCombat(run,{history}).press,false);
  run.time+=.5;const retry=planUltimateCombat(run,{history});assert.equal(retry.press,true);history=retry.nextHistory;
  run.time+=.5;const last=planUltimateCombat(run,{history});assert.equal(last.press,true);history=last.nextHistory;
  run.time+=1;assert.equal(planUltimateCombat(run,{history}).press,false);
  run.time+=1;const nextBatch=planUltimateCombat(run,{history});
  assert.equal(nextBatch.press,true,'a temporary native rejection cannot permanently disable ready R');
  assert.equal(nextBatch.nextHistory.attempts,1);assert.equal(nextBatch.nextHistory.retryBatch,1);
  history=nextBatch.nextHistory;run.time+=.01;
  assert.equal(planUltimateCombat(run,{history}).press,false);
  run.time+=.5;
  run.ult.uses=1;
  assert.equal(planUltimateCombat(run,{history}).press,true,'a real observed native use releases the old acknowledgement limit');
});

test('expired ultimate retry batches still require a useful window and never override native automatic ultimates',()=>{
  const run=ultimateFixture(),boss=enemy(run,{x:10,flags:4});run.aimTarget=()=>boss;
  const history={lastPressAt:90,nativeUsesAtPress:0,attempts:3,retryBatch:2};
  run.aimTarget=()=>-1;
  const noWindow=planUltimateCombat(run,{history});assert.equal(noWindow.press,false);
  assert.equal(noWindow.nextHistory,history,'an expired batch does not commit until a real useful tap');
  run.aimTarget=()=>boss;
  assert.equal(planUltimateCombat(run,{history,autoUlt:true}).press,false);
  run.meta={profile:{settings:{autoUlt:true}}};
  assert.equal(planUltimateCombat(run,{history,autoUlt:false}).press,false);
  run.meta.profile.settings.autoUlt=false;
  const recovered=planUltimateCombat(run,{history});assert.equal(recovered.press,true);
  assert.equal(recovered.nextHistory.retryBatch,3);assert.equal(run.ult.uses,0);assert.equal(run.ult.ready,true);
});

test('paused, dead, unavailable and empty arenas produce no ultimate inputs',()=>{
  const run=ultimateFixture();assert.equal(planUltimateCombat(run).press,false);
  const index=enemy(run,{x:10,flags:4});run.aimTarget=()=>index;
  for(const state of ['paused','modal','over']) {run.state=state;assert.equal(planUltimateCombat(run).press,false);}
  run.state='play';run.player.dead=true;assert.equal(planUltimateCombat(run).press,false);
  run.player.dead=false;run.ult.ready=false;assert.equal(planUltimateCombat(run).press,false);
  run.ult.ready=true;run.aimTarget=()=>{throw Error('optional resolver changed')};
  assert.equal(planUltimateCombat(run).press,false);
});

test('ultimate timing and history evaluation are pure and independent of loadout preference labels',()=>{
  const run=ultimateFixture(),target=enemy(run,{x:10,flags:4});run.aimTarget=()=>target;
  const history={lastPressAt:95,nativeUsesAtPress:0,attempts:1,fastCycles:0};run.ult.uses=1;
  const before=JSON.stringify({run,history}),first=planUltimateCombat(run,{history});
  for(let index=0;index<50;index++)assert.deepEqual(planUltimateCombat(run,{history}),first);
  assert.equal(JSON.stringify({run,history}),before);
  run.plan={build:{moves:['another-build']}};
  assert.deepEqual(planUltimateCombat(run,{history}),first);
});
