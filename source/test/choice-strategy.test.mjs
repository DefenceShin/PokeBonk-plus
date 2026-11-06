import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeMoveReadiness,
  choiceMovePreferences,
  completeMovePreferences,
  completeVitaminPreferences,
  universalVitaminPriority,
  chooseOfferAction,
  tacticalChoice,
  chooseFusionAction,
  chooseNativeTrade,
  finalReplacementState,
  finalReplacementBuild,
  strictOfferAllowed,
  fusionGoalReplacementState,
} from "../src/choice-strategy.mjs";

test("hard challenge restrictions cannot re-enter through mandatory restricted fallback or strict forcing",()=>{
 const player={moves:[],moveSlots:3,vitaminSlots:3,vitamins:new Map(),items:new Map(),level:5,hp:100,maxHp:100,stats:{}},
   run={player,build:{masteryConstraints:{noVitamins:true}},rerolls:0,skips:0},
   data={vitamins:new Map([["protein",{stat:"physical",kind:"mul",per:.1}]])};
 let decision=chooseOfferAction([{kind:"newVit",vit:"protein"}],run,data,{kind:"upgrade",legal:()=>true,rerollLegal:false,skipLegal:false});
 assert.equal(decision.index,null);assert.equal(decision.blocked,true);
 decision=chooseOfferAction([{kind:"newVit",vit:"protein"}],run,data,{kind:"upgrade",legal:()=>true,rerollLegal:false,skipLegal:true,skips:1});
 assert.equal(decision.action,"skip");
});

function fixture(overrides = {}) {
  const definitions = [
    {
      id: 1,
      key: "water-gun",
      arch: "bolt",
      cls: "special",
      type: "water",
      count: 1,
      dmg: 12,
      cd: 1,
    },
    {
      id: 2,
      key: "surf",
      arch: "wave",
      cls: "special",
      type: "water",
      count: 1,
      dmg: 30,
      cd: 1.5,
    },
    {
      id: 3,
      key: "late-beam",
      arch: "beam",
      cls: "special",
      type: "water",
      count: 1,
      dmg: 40,
      cd: 1.5,
    },
    {
      id: 4,
      key: "shared-move",
      arch: "aura",
      cls: "special",
      type: "water",
      count: 1,
      dmg: 15,
      cd: 1,
    },
    {
      id: 5,
      key: "fifth-move",
      arch: "bolt",
      cls: "special",
      type: "water",
      count: 1,
      dmg: 15,
      cd: 1,
    },
    {
      id: 6,
      key: "unrelated",
      arch: "bolt",
      cls: "physical",
      type: "normal",
      count: 1,
      dmg: 10,
      cd: 1.5,
    },
    {
      id: 7,
      key: "weak-drain",
      arch: "homing",
      cls: "special",
      type: "water",
      count: 1,
      dmg: 2,
      cd: 3,
      drain: 0.05,
    },
    {
      id: 8,
      key: "crowd-wave",
      arch: "wave",
      cls: "special",
      type: "water",
      count: 1,
      dmg: 20,
      cd: 1.5,
    },
    {
      id: 9,
      key: "growth",
      arch: "buff",
      cls: "special",
      type: "normal",
      count: 1,
      dmg: 0,
      cd: 12.6,
      dur: 6,
    },
  ];
  const data = {
    moves: new Map(definitions.map((entry) => [entry.id, entry])),
    movesByKey: new Map(definitions.map((entry) => [entry.key, entry])),
    moveGuide: () => ({
      kit: [
        { id: 1, level: 1 },
        { id: 2, level: 4 },
        { id: 3, level: 30 },
      ],
      line: [],
      shared: [{ id: 4, level: 8, open: false }],
    }),
    items: new Map([
      [
        "leftovers",
        { max: 10, rarity: 1, mods: [{ stat: "regen", add: 1.2 }] },
      ],
      [
        "choice-band",
        {
          max: 10,
          rarity: 4,
          mods: [
            { stat: "physical", mul: 1.35 },
            { stat: "attackSpeed", mul: 0.92 },
          ],
        },
      ],
      [
        "rocky-helmet",
        { max: 10, rarity: 4, mods: [{ stat: "thorns", add: 25 }] },
      ],
      ["max-revive", { max: 3, rarity: 4, mods: [] }],
    ]),
    vitamins: new Map(),
    rarityMultipliers: [1, 1.2, 1.45, 1.75, 2.1],
  };
  const player = {
    hp: 100,
    maxHp: 100,
    level: 4,
    speciesId: 7,
    roster: { kit: ["water-gun", "surf", "late-beam"] },
    types: ["water"],
    moveSlots: 3,
    vitaminSlots: 6,
    moves: [
      { def: definitions[0], level: 1, mods: { dmg: 1, cd: 1, count: 0 } },
    ],
    items: new Map(),
    vitamins: new Map(),
    stats: {
      maxHp: 100,
      armor: 10,
      regen: 0.5,
      healing: 1,
      attackSpeed: 1,
      duration: 1,
      projectiles: 0,
      moveSpeed: 1,
    },
    ...overrides,
  };
  const run = {
    player,
    build: {
      moves: ["water-gun", "surf", "late-beam", "shared-move", "fifth-move"],
    },
    availableMoveKeys: definitions.map((entry) => entry.key),
    nativeRun: { rerolls: 2, skips: 2 },
  };
  return { run, player, data, definitions };
}
const upgrade = {
  kind: "upMove",
  slot: 0,
  rarity: 0,
  ups: [{ key: "dmg", value: 0.2 }],
};
const newMove = (id) => ({ kind: "newMove", id, rarity: 0 });
const nativeActions = { rerollLegal: true, skipLegal: true };

test("automatic move preferences contain only the first four unique allowed moves", () => {
  const { run } = fixture();
  assert.deepEqual(
    choiceMovePreferences(run.build).map((entry) => entry.key),
    ["water-gun", "surf", "late-beam", "shared-move"],
  );
  assert.deepEqual(
    choiceMovePreferences({
      moves: ["a", "a", "b", "c", "d", "e"],
      avoidMoves: ["b"],
    }).map((entry) => entry.key),
    ["a", "c", "d", "e"],
  );
});

test("custom explicit rule priority, avoidance and target levels survive preference normalization", () => {
  const prefs = choiceMovePreferences({
    sourceType: "custom",
    moves: ["discarded-order"],
    moveRules: [
      { key: "later", priority: 20, targetLevel: 6 },
      { key: "first", priority: -5, targetLevel: 8 },
      { key: "avoid", priority: -10, avoid: true },
      ...[1, 2, 3, 4].map((n) => ({ key: `other-${n}`, priority: n })),
    ],
  });
  assert.equal(prefs.length, 6);
  assert.equal(prefs[0].key, "first");
  assert.equal(prefs[0].targetLevel, 8);
  assert.equal(
    prefs.some((entry) => entry.key === "avoid"),
    false,
  );
  assert.equal(prefs.at(-1).key, "later");
});

test("readiness uses the native guide's real levels and closed shared unlocks", () => {
  const { run, data } = fixture();
  const readiness = analyzeMoveReadiness(run, data);
  assert.deepEqual(
    readiness.map((entry) => [entry.key, entry.state]),
    [
      ["water-gun", "held"],
      ["surf", "now"],
      ["late-beam", "far"],
      ["shared-move", "unavailable"],
    ],
  );
  run.player.level = 2;
  assert.equal(
    analyzeMoveReadiness(run, data).find((entry) => entry.key === "surf").state,
    "near",
  );
});

test("an eventual availability directory alone never proves a move can currently appear", () => {
  const { run, data } = fixture();
  delete data.moveGuide;
  const entry = analyzeMoveReadiness(run, data).find(
    (entry) => entry.key === "surf",
  );
  assert.equal(entry.state, "unknown");
  assert.match(entry.reason, /does-not-prove/);
});

test("native visible offered move overrides stale optional directory metadata", () => {
  const { run, data } = fixture();
  run.availableMoveKeys = [];
  run.build.unavailableMoves = ["surf"];
  assert.equal(
    analyzeMoveReadiness(run, data, { offers: [newMove(2)] }).find(
      (entry) => entry.key === "surf",
    ).state,
    "now",
  );
});

test("verified current learn pool is used but numeric map values are not guessed to be levels", () => {
  const { run, data } = fixture();
  delete data.moveGuide;
  run.player.learnPool = new Set([2]);
  assert.equal(
    analyzeMoveReadiness(run, data).find((entry) => entry.key === "surf").state,
    "now",
  );
  run.player.learnPool = [{ id: 2, level: 20 }];
  assert.equal(
    analyzeMoveReadiness(run, data).find((entry) => entry.key === "surf").state,
    "far",
  );
  run.player.learnPool = new Map([[2, 100]]);
  assert.equal(
    analyzeMoveReadiness(run, data).find((entry) => entry.key === "surf").state,
    "unknown",
  );
});

test("future evolution moves are near only when an explicit native evolution confirms it", () => {
  const { run, data } = fixture();
  delete data.moveGuide;
  const options = {
    moveAvailability: [{ key: "surf", level: 1, speciesId: 8 }],
  };
  assert.equal(
    analyzeMoveReadiness(run, data, options).find(
      (entry) => entry.key === "surf",
    ).state,
    "far",
  );
  run.nativeRun.nextEvo = { to: 8, level: 7 };
  assert.equal(
    analyzeMoveReadiness(run, data, options).find(
      (entry) => entry.key === "surf",
    ).state,
    "near",
  );
  run.nativeRun.nextEvo.level = 30;
  assert.equal(
    analyzeMoveReadiness(run, data, options).find(
      (entry) => entry.key === "surf",
    ).state,
    "far",
  );
});

test("a recommended currently offered move gets a bounded preference over an unrelated move", () => {
  const { run, data } = fixture();
  const result = chooseOfferAction(
    [newMove(6), newMove(2)],
    run,
    data,
    nativeActions,
  );
  assert.equal(result.action, "choose");
  assert.equal(result.index, 1);
  assert.ok(
    result.candidates.find((entry) => entry.index === 1).preferenceBonus <= 44,
  );
});

test("with no recommended move offered, a useful held-move upgrade beats unrelated new moves", () => {
  const { run, data } = fixture();
  const result = chooseOfferAction(
    [newMove(6), upgrade],
    run,
    data,
    nativeActions,
  );
  assert.equal(result.action, "choose");
  assert.equal(result.index, 1);
  assert.equal(result.reason, "recommended-move-with-bounded-preference");
});

test("all unrelated new moves use only finite native rerolls and skips before a legal fallback", () => {
  const { run, data } = fixture();
  let history,
    rerolls = 2,
    skips = 2;
  const actions = [];
  for (let iteration = 0; iteration < 6; iteration++) {
    const result = chooseOfferAction([newMove(6), newMove(8)], run, data, {
      ...nativeActions,
      history,
      rerolls,
      skips,
    });
    actions.push(result.action);
    history = result.nextHistory;
    if (result.action === "reroll") rerolls--;
    else if (result.action === "skip") skips--;
    else {
      assert.ok([0, 1].includes(result.index));
      assert.equal(result.fallback, true);
      break;
    }
  }
  assert.deepEqual(actions, ["reroll", "reroll", "skip", "skip", "choose"]);
  assert.equal(rerolls, 0);
  assert.equal(skips, 0);
});

test("disabled or exhausted native reroll and skip actions are never invented", () => {
  const { run, data } = fixture();
  for (const options of [
    {},
    { ...nativeActions, rerolls: 0, skips: 0 },
    {
      ...nativeActions,
      rerolls: 2,
      skips: 2,
      history: { rerollsThisPage: 2, unplannedRounds: 3 },
    },
  ]) {
    const result = chooseOfferAction([newMove(6)], run, data, options);
    assert.equal(result.action, "choose");
    assert.equal(result.index, 0);
  }
});

test("a distant high-level move cannot keep empty slots or native retries reserved", () => {
  const { run, data } = fixture();
  run.build.moves = ["water-gun", "late-beam"];
  const result = chooseOfferAction([newMove(6)], run, data, nativeActions);
  assert.equal(result.waitingForPlan, false);
  assert.equal(result.action, "choose");
  assert.equal(result.index, 0);
});

test("reservation ends after bounded missed rounds or the explicit level deadline", () => {
  const { run, data } = fixture();
  for (const options of [
    { history: { unplannedRounds: 3 } },
    { history: { unplannedRounds: 0 } },
  ]) {
    if (options.history.unplannedRounds === 0) run.player.level = 21;
    const result = chooseOfferAction([newMove(6)], run, data, {
      ...nativeActions,
      ...options,
    });
    assert.equal(result.waitingForPlan, false);
    assert.equal(result.action, "choose");
  }
});

test("three native slots remain three even if the future plan has four or five moves", () => {
  const { run, data, definitions } = fixture();
  run.player.moves = [0, 5, 7].map((id) => ({
    def: definitions[id],
    level: 1,
    mods: {},
  }));
  run.player.futureMoveSlots = 4;
  const result = chooseOfferAction([newMove(2), upgrade], run, data);
  assert.equal(result.slots.actual, 3);
  assert.equal(result.slots.free, 0);
  assert.equal(result.index, 1);
  run.player.moveSlots = 4;
  const unlocked = chooseOfferAction([newMove(2)], run, data);
  assert.equal(unlocked.slots.actual, 4);
  assert.equal(unlocked.index, 0);
});

test("low-health actual recovery can beat a recommended move without an infinite plan priority", () => {
  const { run, data } = fixture({ hp: 20 });
  const result = chooseOfferAction(
    [newMove(2), { kind: "newVit", vit: "super-potion", rarity: 4 }],
    run,
    data,
    nativeActions,
  );
  assert.equal(result.action, "choose");
  assert.equal(result.index, 1);
});

test("permanent fixed-strength buff upgrade cannot eclipse real HP or attack benefits", () => {
  const { run, data, definitions } = fixture();
  run.player.moves.push({
    def: definitions[8],
    level: 4,
    mods: { dmg: 1.24, cd: 0.778688, dur: 1.6 },
  });
  run.player.stats.attackSpeed = 1.2;
  run.build.moves = ["water-gun", "growth"];
  const buff = {
    kind: "upMove",
    slot: 1,
    rarity: 4,
    ups: [
      { key: "dmg", value: 1 },
      { key: "count", value: 10 },
    ],
  };
  const result = chooseOfferAction(
    [buff, { kind: "newVit", vit: "hp-up", rarity: 0 }],
    run,
    data,
  );
  assert.equal(result.index, 1);
  assert.ok(result.candidates.find((entry) => entry.index === 0).score < 10);
});

test("vitamin applicability beats rarity for a physical-only attacker", () => {
  const { run, data, definitions } = fixture();
  run.player.moves = [{ def: definitions[5], level: 1, mods: {} }];
  run.build = {};
  const result = chooseOfferAction(
    [
      { kind: "newVit", vit: "calcium", rarity: 4 },
      { kind: "newVit", vit: "protein", rarity: 0 },
    ],
    run,
    data,
  );
  assert.equal(result.index, 1);
});

test("all native vitamins remain in the general fallback even when a historical build has none",()=>{
  const data={vitamins:new Map([['new-native',{stat:'armor',per:2,kind:'add'}],
    ['iron',{key:'iron',stat:'armor',per:5,kind:'add'}],['ether',{key:'ether',stat:'attackSpeed',per:.08,kind:'mul'}]])};
  assert.equal(new Set(universalVitaminPriority).size,26);
  for(const key of ['sticky-barb','enigma-berry','super-lure','poke-radar','loaded-dice'])
    assert.ok(universalVitaminPriority.includes(key));
  assert.deepEqual(completeVitaminPreferences({vitamins:[]},data),['iron','ether','new-native']);
  assert.deepEqual(completeVitaminPreferences({vitaminPriority:['attackSpeed']},data),['ether','iron','new-native']);
  assert.equal(completeVitaminPreferences({vitamins:[]}).length,26);
});

test("useful vitamins cannot lose to move upgrades on every committed page while all slots remain empty",()=>{
  const {run,data}=fixture({vitaminSlots:4,level:26});
  const offers=[upgrade,{kind:'newVit',vit:'ether',rarity:1},{kind:'newVit',vit:'carbos',rarity:0}];
  let history={};const indices=[];
  for(let page=0;page<3;page++) {
    const decision=chooseOfferAction(offers,run,data,{...nativeActions,history});
    assert.equal(decision.action,'choose');indices.push(decision.index);history=decision.nextHistory;
  }
  assert.deepEqual(indices,[0,0,1]);
  assert.equal(history.vitaminDeferrals,0);
  assert.equal(run.player.vitamins.size,0,'the pure planner never fabricates a vitamin acquisition');
});

test("repeated evaluation without a real native action cannot advance empty-slot growth counters",()=>{
  const {run,data}=fixture({vitaminSlots:4,level:26}),history={vitaminDeferrals:1};
  const offers=[upgrade,{kind:'newVit',vit:'ether',rarity:0}];
  const first=chooseOfferAction(offers,run,data,{history});
  for(let frame=0;frame<100;frame++) assert.deepEqual(chooseOfferAction(offers,run,data,{history}),first);
  assert.deepEqual(history,{vitaminDeferrals:1});
  assert.equal(first.nextHistory.vitaminDeferrals,2);
});

test("a useful vitamin prevents empty-slot refresh or skip hunting when a signature is absent",()=>{
  const {run,data}=fixture();
  run.build.moves=['surf'];
  const decision=chooseOfferAction([newMove(6),{kind:'newVit',vit:'iron',rarity:0}],run,data,nativeActions);
  assert.equal(decision.action,'choose');
  assert.ok(decision.candidates.some(entry=>entry.kind==='newVit'&&entry.actualScore>0));
});

test("an exceptional rare early upgrade may defer one extra useful vitamin page but cannot starve it",()=>{
  const {run,data}=fixture({level:4});
  const offers=[{...upgrade,rarity:4,ups:[{key:'count',value:5},{key:'dmg',value:.5}]},
    {kind:'newVit',vit:'carbos',rarity:0}];
  const first=chooseOfferAction(offers,run,data,{history:{vitaminDeferrals:2}});
  assert.equal(first.index,0);
  const second=chooseOfferAction(offers,run,data,{history:first.nextHistory});
  assert.equal(second.index,1);assert.equal(second.reason,'bounded-useful-vitamin-growth');
});

test("inapplicable or harmful vitamins cannot be forced merely to fill an empty slot",()=>{
  const {run,data,definitions}=fixture();run.player.moves=[{def:definitions[5],level:1,mods:{}}];
  const offers=[upgrade,{kind:'newVit',vit:'calcium',rarity:4},{kind:'newVit',vit:'cursed',rarity:4}];
  const result=chooseOfferAction(offers,run,data,{history:{vitaminDeferrals:6}});
  assert.equal(result.index,0);assert.equal(result.growth.vitaminOpportunities,0);
});

test("a useful temporary attack eventually fills an open slot after repeated upgrades without a recommended offer",()=>{
  const {run,data}=fixture({level:26});run.build.moves=['water-gun','late-beam'];
  let history={};const offers=[upgrade,newMove(6)],indices=[];
  for(let page=0;page<4;page++) {
    const result=chooseOfferAction(offers,run,data,{history});
    indices.push(result.index);history=result.nextHistory;
  }
  assert.deepEqual(indices,[0,0,0,1]);
  assert.equal(history.moveDeferrals,0);
});

test("integer projectile thresholds are preserved rather than assigning every half step a full shot", () => {
  const { run, data } = fixture();
  run.build = {};
  const offers = [
    { kind: "upVit", vit: "pp-up", rarity: 0 },
    { kind: "newVit", vit: "hp-up", rarity: 0 },
  ];
  assert.equal(chooseOfferAction(offers, run, data).index, 1);
  run.player.stats.projectiles = 0.5;
  assert.equal(chooseOfferAction(offers, run, data).index, 0);
});

test("strong passive recovery yields to useful burst protection", () => {
  const { run, data } = fixture();
  run.build = {};
  run.player.stats.regen = 13;
  run.player.stats.healing = 2;
  const result = chooseOfferAction(
    [
      { kind: "newVit", vit: "super-potion", rarity: 0 },
      { kind: "newVit", vit: "hp-up", rarity: 0 },
    ],
    run,
    data,
  );
  assert.equal(result.index, 1);
});

test("rare thorns and a wrong-class speed penalty cannot outrank useful common recovery", () => {
  const { run, data } = fixture();
  run.build = { items: ["choice-band", "rocky-helmet"] };
  const result = chooseOfferAction(
    ["choice-band", "rocky-helmet", "leftovers"],
    run,
    data,
    { kind: "itemChoice" },
  );
  assert.equal(result.index, 2);
});

test("native passive lifesaving items are retained even when their mods array is empty", () => {
  const { run, data } = fixture();
  run.build = {};
  const result = chooseOfferAction(["rocky-helmet", "max-revive"], run, data, {
    kind: "itemChoice",
  });
  assert.equal(result.index, 1);
});

test("all avoided or completed custom targets still produce a native legal fallback after exits are exhausted", () => {
  const { run, data } = fixture();
  run.build = {
    sourceType: "custom",
    allowOffPlan: false,
    moveRules: [{ key: "water-gun", priority: 1, targetLevel: 1 }],
  };
  const result = chooseOfferAction([newMove(6), upgrade], run, data, {
    ...nativeActions,
    rerolls: 0,
    skips: 0,
    legal: [true, false],
  });
  assert.equal(result.action, "choose");
  assert.equal(result.index, 0);
  assert.equal(result.fallback, true);
});

test("a legal finite custom rule wins over explicitly avoided alternatives", () => {
  const { run, data } = fixture();
  run.build = {
    sourceType: "custom",
    allowOffPlan: false,
    moveRules: [
      { key: "surf", priority: 2 },
      { key: "unrelated", priority: 1, avoid: true },
    ],
  };
  const result = chooseOfferAction(
    [newMove(6), newMove(2)],
    run,
    data,
    nativeActions,
  );
  assert.equal(result.index, 1);
});

test("native item holding cap and current disabled masks are re-evaluated on every call", () => {
  const { run, data } = fixture();
  run.build = {};
  const offers = ["leftovers", "max-revive"];
  run.player.canHold = (key) => key !== "max-revive";
  assert.equal(
    chooseOfferAction(offers, run, data, { kind: "itemChoice" }).index,
    0,
  );
  run.player.canHold = () => true;
  run.player.items.set("leftovers", 10);
  assert.equal(
    chooseOfferAction(offers, run, data, {
      kind: "itemChoice",
      legal: [true, true],
    }).index,
    1,
  );
  assert.equal(
    chooseOfferAction(offers, run, data, {
      kind: "itemChoice",
      legal: [false, false],
    }).index,
    null,
  );
});

test("no legal card or native exit is reported honestly rather than fabricating an index", () => {
  const { run, data } = fixture();
  const result = chooseOfferAction([newMove(2)], run, data, {
    legal: [false],
    rerollLegal: false,
    skipLegal: false,
  });
  assert.equal(result.action, "choose");
  assert.equal(result.index, null);
  assert.equal(result.blocked, true);
});

test("a native reroll remains available when temporarily no card is legal", () => {
  const { run, data } = fixture();
  const result = chooseOfferAction([newMove(2)], run, data, {
    ...nativeActions,
    legal: [false],
  });
  assert.equal(result.action, "reroll");
});

test("blessing choices use current marginal modifiers rather than blindly taking the rarest", () => {
  const { run, data } = fixture();
  run.build = {};
  const result = chooseOfferAction(
    [
      { rarity: 4, mods: [{ stat: "physical", mul: 1.1 }] },
      { rarity: 0, mods: [{ stat: "attackSpeed", mul: 1.1 }] },
    ],
    run,
    data,
    { kind: "blessing" },
  );
  assert.equal(result.index, 1);
});

test("an unknown future rare effect has no imaginary power but remains a legal last resort", () => {
  const { run, data } = fixture();
  run.build = {};
  const unknown = { kind: "future-native-effect", rarity: 999 };
  assert.equal(
    chooseOfferAction(
      [unknown, { kind: "newVit", vit: "hp-up", rarity: 0 }],
      run,
      data,
    ).index,
    1,
  );
  assert.equal(chooseOfferAction([unknown], run, data).index, 0);
});

test("weak single-target drain does not receive an unlimited survival or plan bonus", () => {
  const { run, data } = fixture();
  run.build = {};
  assert.equal(chooseOfferAction([newMove(7), newMove(8)], run, data).index, 1);
});

test("selection is pure and pending ticks cannot consume history or native counters", () => {
  const { run, data } = fixture(),
    history = { unplannedRounds: 0, rerollsThisPage: 0 };
  const state = JSON.stringify({
    player: {
      ...run.player,
      items: [...run.player.items],
      vitamins: [...run.player.vitamins],
    },
    build: run.build,
    history,
    counters: run.nativeRun,
  });
  const first = chooseOfferAction([newMove(6)], run, data, {
    ...nativeActions,
    history,
  });
  const second = tacticalChoice([newMove(6)], run, data, {
    ...nativeActions,
    history,
  });
  assert.deepEqual(second, first);
  assert.equal(
    JSON.stringify({
      player: {
        ...run.player,
        items: [...run.player.items],
        vitamins: [...run.player.vitamins],
      },
      build: run.build,
      history,
      counters: run.nativeRun,
    }),
    state,
  );
  assert.deepEqual(history, { unplannedRounds: 0, rerollsThisPage: 0 });
});

test("same-architecture new attacks use a bounded actual damage/cooldown clue", () => {
  const { run, data } = fixture();
  run.build = {};
  const weak = {
    id: 90,
    key: "weak-bolt",
    arch: "bolt",
    cls: "special",
    type: "water",
    dmg: 2,
    count: 1,
    cd: 3,
  };
  const strong = { ...weak, id: 91, key: "strong-bolt", dmg: 20, cd: 1 };
  for (const def of [weak, strong]) {
    data.moves.set(def.id, def);
    data.movesByKey.set(def.key, def);
  }
  const result = chooseOfferAction([newMove(90), newMove(91)], run, data);
  assert.equal(result.index, 1);
  for (const candidate of result.candidates)
    assert.ok(candidate.damageClue >= -12 && candidate.damageClue <= 18);
});

test("missing nominal damage data or malformed optional mods cannot invent damage or crash a fallback", () => {
  const { run, data } = fixture();
  run.build = {};
  data.moves.set(90, { id: 90, key: "unknown-attack", arch: "bolt" });
  const result = chooseOfferAction(
    [newMove(90), { kind: "future", mods: { stat: "regen" } }],
    run,
    data,
  );
  assert.equal(
    result.candidates.find((candidate) => candidate.index === 0).damageClue,
    0,
  );
  assert.ok([0, 1].includes(result.index));
});

test("an optional legality lookup failure excludes that card and leaves a legal fallback", () => {
  const { run, data } = fixture();
  const result = chooseOfferAction([newMove(2), upgrade], run, data, {
    legal(index) {
      if (index === 0) throw Error("disconnected native card");
      return true;
    },
  });
  assert.equal(result.index, 1);
});

test("native kit and verified guide supplement a two-move record without changing historical evidence", () => {
  const { data, player } = fixture();
  const build = {
    id: "public-victory",
    moves: ["water-gun", "surf"],
    victory: true,
    ranked: true,
    moveDetails: [{ key: "water-gun", level: 8 }],
    stats: { damage: 2 },
  };
  const before = JSON.stringify(build);
  const result = completeMovePreferences(build, data, {
    species: 7,
    roster: { id: 7, kit: ["water-gun", "surf", "late-beam"] },
    guide: data.moveGuide(),
  });
  assert.deepEqual(result.moves, ["water-gun", "surf", "late-beam"]);
  assert.deepEqual(result.observedMoves, ["water-gun", "surf"]);
  assert.equal(
    result.movePreferenceCompletion.status,
    "partial-native-candidates",
  );
  assert.equal(result.movePreferenceCompletion.inferredCount, 1);
  assert.equal(result.moveRecommendationSources[2].observed, false);
  assert.deepEqual(result.moveDetails, build.moveDetails);
  assert.deepEqual(result.stats, build.stats);
  assert.equal(JSON.stringify(build), before);
  assert.equal(player.moveSlots, 3);
});

test("completion reaches four using trustworthy open native candidates and is idempotent", () => {
  const { data } = fixture();
  const roster = { id: 7, kit: ["water-gun", "surf", "late-beam"] };
  const guide = {
    kit: [{ id: 1, level: 1 }],
    line: [{ id: 8, level: 6 }],
    shared: [{ id: 4, level: 8, open: true }],
  };
  const original = { moves: ["water-gun", "surf"] };
  const result = completeMovePreferences(original, data, {
    species: 7,
    roster,
    guide,
  });
  assert.deepEqual(result.moves, [
    "water-gun",
    "surf",
    "late-beam",
    "crowd-wave",
  ]);
  assert.equal(result.movePreferenceCompletion.inferredCount, 2);
  assert.equal(
    result.moveRecommendationSources.at(-1).source,
    "native-guide-line",
  );
  assert.deepEqual(
    completeMovePreferences(result, data, { species: 7, roster, guide }),
    result,
  );
  assert.deepEqual(result.observedMoves, original.moves);
});

test("generic strategy can infer native preferences but never calls them observed historical moves", () => {
  const { data } = fixture();
  const result = completeMovePreferences({ id: "generic", moves: [] }, data, {
    species: 7,
    roster: { id: 7, kit: ["water-gun", "surf", "late-beam"] },
    guide: { line: [{ id: 8, level: 6 }] },
  });
  assert.equal(result.moves.length, 4);
  assert.deepEqual(result.observedMoves, []);
  assert.equal(result.movePreferenceCompletion.inferredCount, 4);
  assert.equal(
    result.moveRecommendationSources.every((entry) => !entry.observed),
    true,
  );
});

test("completion never forces extra moves or changes priority in custom plans", () => {
  const { data } = fixture();
  const custom = {
    sourceType: "custom",
    moves: ["surf"],
    moveRules: [{ key: "surf", priority: -5, targetLevel: 8 }],
  };
  const result = completeMovePreferences(custom, data, {
    species: 7,
    roster: { id: 7, kit: ["water-gun", "late-beam"] },
    guide: { line: [{ id: 8 }] },
  });
  assert.deepEqual(result.moves, ["surf"]);
  assert.deepEqual(result.moveRules, custom.moveRules);
  assert.equal(result.movePreferenceCompletion.status, "custom-user-defined");
  assert.equal(result.movePreferenceCompletion.inferredCount, 0);
  assert.equal(Object.hasOwn(result, "observedMoves"), false);
});

test("mismatched character, unresolved keys, closed shared unlocks and explicit avoided moves are not fabricated as supplements", () => {
  const { data } = fixture();
  const result = completeMovePreferences(
    { moves: ["water-gun"], avoidMoves: ["surf"] },
    data,
    {
      species: 7,
      roster: { id: 4, kit: ["late-beam"] },
      guide: {
        kit: [{ id: 2 }, { key: "unknown-native-key" }],
        shared: [{ id: 4, open: false }],
      },
    },
  );
  assert.deepEqual(result.moves, ["water-gun"]);
  assert.equal(
    result.movePreferenceCompletion.status,
    "partial-native-candidates",
  );
  assert.deepEqual(result.observedMoves, ["water-gun"]);
});

test("native fusion selects only real ready pairs and honors custom parent preservation",()=>{
 const player={moves:[{def:{key:"a",arch:"bolt"},level:8},{def:{key:"b",arch:"beam"},level:8}]};
 const offer={r:{key:"fu-native",kind:"signature",power:3,cd:2},a:0,b:1,ready:true};
 assert.equal(chooseFusionAction([offer],{player}).key,"fu-native");
 assert.equal(chooseFusionAction([{...offer,ready:false}],{player}).action,"leave");
 player.moves[1].level=7;assert.equal(chooseFusionAction([offer],{player}).action,"leave");player.moves[1].level=8;
 assert.equal(chooseFusionAction([offer],{player,build:{sourceType:"custom",moves:["a"],replacementPolicy:"lowest"}}).action,"leave");
 assert.equal(chooseFusionAction([offer],{player,build:{sourceType:"custom",moves:["fu-native"],allowOffPlan:false}}).action,"choose");
 assert.equal(chooseFusionAction([offer],{player,build:{avoidMoves:["fu-native"]}}).action,"leave");
 assert.equal(chooseFusionAction([{...offer,a:0,b:0}],{player}).action,"leave");
 player.moves[1].def.arch="buff";assert.equal(chooseFusionAction([offer],{player}).action,"leave");
});

test("fusion preference uses the actual offered recipe and never manufactures a missing signature",()=>{
 const player={moves:[{def:{key:"a",arch:"bolt"},level:8},{def:{key:"b",arch:"beam"},level:8},{def:{key:"c",arch:"cone"},level:8}]};
 const offers=[{r:{key:"fu-type",kind:"type",power:3,cd:2},a:0,b:1,ready:true},
  {r:{key:"fu-reaction",kind:"reaction",power:3,cd:2},a:0,b:2,ready:true}];
 assert.equal(chooseFusionAction(offers,{player}).key,"fu-reaction");
 assert.equal(chooseFusionAction(offers,{player,build:{sourceType:"custom",moves:["fu-type","missing-signature"]}}).key,"fu-type");
});

test("permanent trade costs require explicit tactical approval and a legal native offer",()=>{
 const run={player:{hp:100,maxHp:100,moves:[{def:{arch:"bolt"}}],stats:{armor:10,regen:0}}};
 const page={offers:[{key:"helix"},{key:"dome"},{key:"amber"}]};
 for(const options of [{},{risky:true},{risky:false,allowRisky:true}])
  assert.equal(chooseNativeTrade(page,run,{}, {kind:"fossil",...options}).action,"leave");
 assert.equal(chooseNativeTrade(page,run,{}, {kind:"fossil",risky:true,allowRisky:true}).action,"choose");
 run.player.hp=50;assert.equal(chooseNativeTrade(page,run,{}, {kind:"fossil",risky:true,allowRisky:true}).action,"choose",'a nonlethal maximum-HP trade is evaluated rather than rejected by an arbitrary 82% gate');
 run.player.hp=100;page.offers.forEach(offer=>offer.off="unavailable");
 assert.equal(chooseNativeTrade(page,run,{}, {kind:"fossil",risky:true,allowRisky:true}).action,"leave");
});

test("Porygon compares both real stat changes using plan weights and rejects unknown or harmful trades",()=>{
 const run={player:{hp:100,maxHp:100,moves:[{def:{arch:"bolt",cls:"special"}}],stats:{moveSpeed:1,armor:10,regen:0}}};
 const options={kind:"porygon",risky:true,allowRisky:true};
 const page={offers:[{key:"damage>moveSpeed"},{key:"armor>xpGain"},{key:"future>damage"}]};
 const decision=chooseNativeTrade(page,run,{},options);
 assert.equal(decision.key,"armor>xpGain","a permanent speed loss cannot hide behind a damage label");
 assert.equal(chooseNativeTrade({offers:[{key:"future>damage"}]},run,{},options).action,"leave");
 assert.equal(chooseNativeTrade({offers:[{key:"damage>damage"}]},run,{},options).action,"leave");
 const weighted={...run,build:{statWeights:{armor:0,xpGain:5}}};
 assert.equal(chooseNativeTrade({offers:[page.offers[1]]},weighted,{},options).action,"leave");
});

test("Gengar defaults to safe treat and generic risk permission does not authorize a trick",()=>{
 const page={offers:[{key:"trick"},{key:"treat"}]};
 const run={player:{hp:40,maxHp:100}};
 assert.equal(chooseNativeTrade(page,run,{}, {kind:"tower"}).key,"treat");
 assert.equal(chooseNativeTrade({offers:[{key:"trick"}]},run,{}, {kind:"tower",risky:true,allowRisky:true}).action,"leave");
});

test("the current trick goal selects only an available native Tower trick without a generic risk or health gate",()=>{
 const run={player:{hp:1,maxHp:100,stats:{luck:125}}},page={offers:[{key:"treat"},{key:"trick"}]};
 const options={kind:"tower",towerTrick:true,risky:false,allowRisky:false};
 assert.equal(chooseNativeTrade(page,run,{},options).key,"trick");
 assert.equal(chooseNativeTrade({offers:[{key:"trick",off:true},{key:"treat"}]},run,{},options).action,"leave");
 assert.equal(chooseNativeTrade({offers:[{key:"treat"}]},run,{},options).action,"leave");
 assert.equal(chooseNativeTrade({offers:[{key:"future-risk"}]},run,{},options).action,"leave");
 for(const kind of ["fossil","porygon","unknown"])
  assert.equal(chooseNativeTrade({offers:[{key:"trick"},{key:"helix"},{key:"damage>armor"}]},run,{}, {...options,kind}).action,"leave");
 run.player.stats.luck=124.9;
 assert.equal(chooseNativeTrade(page,run,{}, {kind:"tower"}).key,"treat");
});

function finalLoadoutFixture({ moveSlots = 4, vitaminSlots = 3, level = 30 } = {}) {
  const value = fixture({ moveSlots, vitaminSlots, level });
  const { player, run, data, definitions } = value;
  run.nativeRun = { ...run.nativeRun, player, startSpecies: 7 };
  data.moveGuide = () => ({ kit: [1, 2, 3, 4].map(id => ({ id, level: 1, open: true })), line: [], shared: [] });
  for (let index = 1; index <= 6; index++) data.vitamins.set(`final-vit-${index}`, { id: `final-vit-${index}`, stat: 'damage', per: .1, max: 99 });
  player.moves = [definitions[5], definitions[6], definitions[7], definitions[8]].slice(0, moveSlots)
    .map((def, index) => ({ def, level: index + 1, mods: { dmg: 1, cd: 1, count: 0 } }));
  const settings = { finalReplacements: { 7: {
    moves: { enabled: true, level: 30, targets: ['water-gun', 'surf', 'late-beam', 'shared-move'] },
    vitamins: { enabled: true, level: 30, targets: Array.from({ length: 6 }, (_, index) => `final-vit-${index + 1}`) },
  } } };
  const state = () => finalReplacementState(settings, run.nativeRun, data);
  return { ...value, settings, state };
}

test('final loadouts use native slot counts before filtering empty target positions and never mutate saved settings', () => {
  for (const moveSlots of [3, 4]) {
    const { settings, state } = finalLoadoutFixture({ moveSlots });
    settings.finalReplacements[7].moves.targets = [null, 'surf', null, 'shared-move'];
    const before = structuredClone(settings);
    assert.deepEqual(state().moves.targets, moveSlots === 3 ? ['surf'] : ['surf', 'shared-move']);
    assert.deepEqual(settings, before, 'fourth target must remain saved when only three native slots are unlocked');
  }
});

test('final vitamin loadouts support every real capacity from three through six without move-slot coupling', () => {
  for (let vitaminSlots = 3; vitaminSlots <= 6; vitaminSlots++) {
    const h = finalLoadoutFixture({ moveSlots: 3, vitaminSlots });
    const value = h.state();
    assert.equal(value.vitamins.targets.length, vitaminSlots);
    assert.equal(value.moves.targets.length, 3);
    assert.equal(value.vitamins.targets.at(-1), `final-vit-${vitaminSlots}`);
  }
});

test('migration preserves map-stage overrides and returns Tower to the common loadout', () => {
  const h=finalLoadoutFixture();
  h.settings.finalReplacements[7].stageProfiles={default:{2:{moves:{enabled:true,level:1,targets:['surf']}}},forest:{2:{moves:{enabled:true,level:1,targets:['water-gun']}}}};
  Object.assign(h.run.nativeRun,{stage:2,biome:{id:'forest'}});
  assert.equal(h.state().moves.targets[0],'water-gun');
  h.run.nativeRun.biome={id:'cave'};assert.equal(h.state().moves.targets[0],'surf');
  h.run.nativeRun.tower={floor:2};assert.deepEqual(h.state().moves.targets.slice(0,4),['water-gun','surf','late-beam','shared-move']);
});

test('migration preserves explicit vacancies before replacement level without treating null as a vacancy',()=>{
  const h=finalLoadoutFixture({level:5});
  h.settings.finalReplacements[7].moves={schemaVersion:2,enabled:true,level:100,targets:[null,'pb:empty-slot','pb:empty-slot','pb:empty-slot']};
  const held=h.player.moves.slice();
  for(let removed=0;removed<3;removed++){
    const blank=h.state();assert.equal(blank.moves.forget.length,1,'one native forget action at a time');
    h.player.moves[blank.moves.forget[0]]=null;
  }
  assert.equal(h.state().moves.forget.length,0,'native last attack survives');
  h.player.moves=held;
  h.settings.finalReplacements[7].moves.targets=[null,null,null,null];
  assert.equal(h.state().moves.forget.length,0);
});

test('final loadouts bind to starting species across evolution and never inherit a different preview character', () => {
  const h = finalLoadoutFixture();
  h.player.speciesId = 8;
  h.settings.characterId = 25;
  h.settings.finalReplacements[8] = { moves: { enabled: true, level: 1, targets: ['unrelated'] } };
  assert.equal(h.state().species, 7);
  assert.deepEqual(h.state().moves.targets, ['water-gun', 'surf', 'late-beam', 'shared-move']);
  h.run.nativeRun.startSpecies = 25;
  assert.equal(h.state().moves.enabled, false);
  assert.equal(h.state().needsTutor, false);
});

test('final tutor cannot forget before its threshold or for targets gated behind future levels, evolution or closed research', () => {
  const h = finalLoadoutFixture({ level: 29 });
  assert.equal(h.state().moves.active, false);
  assert.deepEqual(h.state().moves.forget, []);
  h.player.level = 30;
  h.data.moveGuide = () => ({ kit: [{ id: 1, level: 999 }], line: [{ id: 2, level: 1, speciesId: 9 }], shared: [{ id: 3, level: 1, open: false }, { id: 4, level: 1, available: false }] });
  assert.deepEqual(h.state().moves.readyMissing, []);
  assert.deepEqual(h.state().moves.forget, []);
  assert.equal(h.state().needsTutor, false);
});

test('enabling a later final replacement cannot replace ordinary early growth preferences or extend its reservation deadline',()=>{
  const h=finalLoadoutFixture({level:4});
  const normal={moves:['water-gun','shared-move'],moveRules:[{key:'water-gun'}],
    avoidMoves:['surf'],vitaminPriority:['iron'],reserveUntilLevel:10,allowOffPlan:true};
  const before=structuredClone(normal),early=finalReplacementBuild(normal,h.state());
  assert.deepEqual(early.moves,normal.moves);assert.deepEqual(early.moveRules,normal.moveRules);
  assert.deepEqual(early.vitaminPriority,['iron']);assert.equal(early.reserveUntilLevel,10);
  assert.deepEqual(normal,before);
  h.player.level=30;
  const late=finalReplacementBuild(normal,h.state());
  assert.ok(late.moves.includes('surf'));assert.equal(late.avoidMoves.includes('surf'),false);
  assert.ok(late.vitaminPriority.includes('final-vit-1'));
});

test('final skill replacement always retains a damaging move even if the temporary buff has the highest level', () => {
  const h = finalLoadoutFixture();
  const value = h.state();
  assert.equal(value.moves.forget.length, 1);
  const retained = h.player.moves.filter((move, index) => !value.moves.forget.includes(index));
  assert.equal(retained.length, 3);
  assert.ok(retained.some(move=>!['buff','weather'].includes(move.def.arch)));
  h.player.moves = [h.player.moves[0]];
  assert.deepEqual(h.state().moves.forget, []);
});

test('final replacement re-evaluates after every native removal and preserves existing final skills', () => {
  const h = finalLoadoutFixture();
  for (let attempt = 0; attempt < 4; attempt++) {
    const slot = h.state().moves.forget[0];
    if (slot === undefined) break;
    h.player.moves[slot] = null;
  }
  assert.equal(h.player.moves.filter(Boolean).length, 3,'repeated tutor renders cannot create a second opening');
  assert.equal(h.state().needsTutor, false);
  const free=h.player.moves.findIndex(move=>!move);
  h.player.moves[free]={def:h.definitions[0],level:1};
  assert.equal(h.state().moves.forget.length,1,'another opening is considered only after native acquisition filled the first');
  assert.equal(h.state().moves.forget.some(slot => ['water-gun', 'surf', 'late-beam'].includes(h.player.moves[slot].def.key)), false);
});

test('partially specified final targets do not delete unrelated capacity and vitamins preserve one existing upgrade', () => {
  const h = finalLoadoutFixture();
  h.settings.finalReplacements[7].moves.targets = ['water-gun', null, null, null];
  h.player.moves = h.player.moves.slice(0, 2);
  assert.deepEqual(h.state().moves.forget, [], 'two empty skill slots already cover the one missing target');
  h.player.vitamins = new Map([['temporary-vit-a', { level: 5 }], ['temporary-vit-b', { level: 8 }], ['temporary-vit-c', { level: 9 }]]);
  assert.equal(h.state().vitamins.forget.length, 1);
  h.player.vitamins.delete(h.state().vitamins.forget[0]);
  assert.deepEqual(h.state().vitamins.forget, []);
  assert.equal(h.player.vitamins.size, 2);
  h.player.vitamins.set('final-vit-1',{level:1});
  assert.equal(h.state().vitamins.forget.length,1);
});

test('final target offers override ordinary preferences without selecting illegal or locked slot candidates', () => {
  const h = finalLoadoutFixture({ moveSlots: 3 });
  h.player.moves = [h.player.moves[0]];
  h.run.finalReplacement = h.state();
  const options = { ...nativeActions, legal: [true, true, true] };
  const decision = chooseOfferAction([newMove(6), upgrade, newMove(2)], h.run, h.data, options);
  assert.equal(decision.action, 'choose'); assert.equal(decision.index, 2);
  const disabled = chooseOfferAction([newMove(2), upgrade], h.run, h.data, { ...nativeActions, legal: [false, true] });
  assert.equal(disabled.index, 1);
  const built = finalReplacementBuild({ moves: ['unrelated'], avoidMoves: ['surf'] }, h.state());
  assert.equal(built.moves.includes('surf'), true); assert.equal(built.avoidMoves.includes('surf'), false);
});

test('absent final offers consume available native refreshes and skips before legal fallback', () => {
  const h = finalLoadoutFixture();
  h.player.moves = [h.player.moves[0]];
  h.run.finalReplacement = h.state();
  let history = {}, rerolls = 20, skips = 2, selected = false, refreshes = 0;
  for (let attempt = 0; attempt < 24; attempt++) {
    const result = chooseOfferAction([newMove(8)], h.run, h.data, { ...nativeActions, history, rerolls, skips });
    history = result.nextHistory;
    if (result.action === 'reroll') { rerolls--; refreshes++; }
    else if (result.action === 'skip') { skips--; }
    else { assert.equal(result.action, 'choose'); assert.equal(result.index, 0); selected = true; break; }
  }
  assert.equal(selected, true); assert.equal(refreshes,20,'all native rerolls remain available, with no per-page software cap');
});

test('direct final-loadout settings use the same strict level and target-key validation as local client storage', () => {
  const h = finalLoadoutFixture();
  for (const invalid of [null, '1', '50', true, NaN, Infinity, undefined]) {
    h.settings.finalReplacements[7].moves.level = invalid;
    assert.equal(h.state().moves.level, 30, String(invalid));
  }
  for (const [input, expected] of [[0, 1], [-20, 1], [30.9, 30], [1000000, 999999]]) {
    h.settings.finalReplacements[7].moves.level = input;
    assert.equal(h.state().moves.level, expected);
  }
  for (const key of ['../../invalid', 'with space', 'a'.repeat(101)]) {
    const def = { id: 777, key, arch: 'bolt' }; h.data.moves.set(777, def); h.data.movesByKey.set(key, def);
    h.settings.finalReplacements[7].moves.targets = [key];
    assert.equal(h.state().moves.enabled, false);
  }
});

test('native fusion never consumes a final target move for an undesired recipe', () => {
  const player={moves:[{def:{key:'water-gun',arch:'bolt'},level:8},
    {def:{key:'surf',arch:'wave'},level:8}]};
  const replacement={moves:{enabled:true,targets:['water-gun','surf']}};
  const build=finalReplacementBuild({},replacement);
  const offers=[{a:0,b:1,ready:true,r:{key:'off-target-fusion',kind:'reaction',power:20,cd:1}}];
  assert.equal(chooseFusionAction(offers,{player,build}).action,'leave');
  assert.equal(chooseFusionAction(offers,{player,build:{}}).action,'choose');
});

function finalFusionFixture({slots=4,level=30,pairs}={}) {
  const h=finalLoadoutFixture({moveSlots:slots,level}), routes=pairs||{
    'fu-first':[[1,2]],'fu-second':[[3,4]],'fu-third':[[5,6]],'fu-fourth':[[7,8]],
  };
  h.data.moveGuide=()=>({kit:h.definitions.map(def=>({id:def.id,level:1,open:true})),line:[],shared:[]});
  h.data.fusionRecipes=Object.keys(routes).map((key,index)=>({key,kind:'signature',power:2,cd:2,id:50000+index}));
  const fusionDefs=new Map(h.data.fusionRecipes.map(recipe=>[recipe.key,{id:recipe.id,key:recipe.key,arch:'fusion',type:'water',cls:'special',dmg:30,cd:2}]));
  for(const def of fusionDefs.values()){h.data.moves.set(def.id,def);h.data.movesByKey.set(def.key,def);}
  h.data.fusionFor=(a,b)=>h.data.fusionRecipes.find(recipe=>routes[recipe.key].some(pair=>pair.includes(a.id)&&pair.includes(b.id)))||null;
  h.settings.finalReplacements[7].fusion={enabled:true,level:30,targets:Object.keys(routes)};
  h.settings.finalReplacements[7].moves.targets=['water-gun','fifth-move','crowd-wave','unrelated'];
  const hold=(id,slot,moveLevel=1)=>{h.player.moves[slot]={def:h.data.moves.get(id),level:moveLevel,parents:[],mods:{dmg:1,cd:1,count:0}};};
  const fuseFixture=(key,parentIds,slot=0)=>{h.player.moves[slot]={def:fusionDefs.get(key),level:1,parents:[...parentIds],mods:{dmg:1,cd:1,count:0}};};
  return {...h,routes,fusionDefs,hold,fuseFixture};
}

for (const mode of ['standard','endless','tower','event-tower']) {
  test(`personal fusion count: ${mode} stops at one and rejects another ready pair`,()=>{
    const h=finalFusionFixture({pairs:{'fu-first':[[1,2],[3,4]]}});
    h.settings.finalReplacements[7].moves.enabled=false;
    Object.assign(h.run.nativeRun,{mode,...(mode.includes('tower')?{tower:{floor:25}}:{}),...(mode==='endless'?{endless:{}}:{})});
    h.player.moves=[null,null,null,null];h.fuseFixture('fu-first',[1,2],0);h.hold(3,1,8);h.hold(4,2,8);
    const value=h.state();
    assert.equal(value.fusion.pending,null);
    assert.equal(value.needsFusion,false);
    assert.equal(chooseFusionAction([{a:1,b:2,ready:true,r:h.data.fusionRecipes[0]}],{player:h.player,finalReplacement:value},h.data).action,'leave');
    assert.equal(value.moves.forget.includes(0),false);
  });
  test(`personal fusion count: ${mode} repeats only when final fusion contains two copies`,()=>{
    const h=finalFusionFixture({pairs:{'fu-first':[[1,2],[3,4]]}});
    h.settings.finalReplacements[7].moves.enabled=false;
    h.settings.finalReplacements[7].fusion.targets=['fu-first','fu-first'];
    h.run.nativeRun.mode=mode;
    h.player.moves=[null,null,null,null];h.fuseFixture('fu-first',[1,2],0);h.hold(3,1,8);h.hold(4,2,8);
    let value=h.state();assert.deepEqual(value.fusion.targets,['fu-first','fu-first']);assert.equal(value.needsFusion,true);
    assert.equal(chooseFusionAction([{a:1,b:2,ready:true,r:h.data.fusionRecipes[0]}],{player:h.player,finalReplacement:value},h.data).action,'choose');
    h.fuseFixture('fu-first',[3,4],1);h.player.moves[2]=null;
    value=h.state();assert.equal(value.fusion.pending,null);assert.equal(value.needsFusion,false);
    assert.deepEqual(value.fusion.protectedSlots,[0,1]);
  });
}

test('personal fusion count: strict allowlist repeats do not request copies, final fusion does',()=>{
  const h=finalFusionFixture({pairs:{'fu-first':[[1,2],[3,4]]}}),stored=h.settings.finalReplacements[7];
  stored.moves.enabled=false;stored.strictMoves={enabled:true,targets:['fu-first','fu-first']};
  h.player.moves=[null,null,null,null];h.fuseFixture('fu-first',[1,2],0);h.hold(3,1,8);h.hold(4,2,8);
  assert.equal(h.state().needsFusion,false);
  stored.fusion.targets=['fu-first','fu-first'];
  assert.equal(h.state().needsFusion,true);
});

test('personal fusion count: automatic offers cannot produce a second same-name result',()=>{
  const h=finalFusionFixture({pairs:{'fu-first':[[1,2],[3,4]]}});
  h.player.moves=[null,null,null,null];h.fuseFixture('fu-first',[1,2],0);h.hold(3,1,8);h.hold(4,2,8);
  const offers=[{a:1,b:2,ready:true,r:h.data.fusionRecipes[0]}];
  assert.equal(chooseFusionAction(offers,{player:h.player,build:{}},h.data).action,'leave');
});

test('personal fusion materials: ordinary upgrades compete on benefit and do not force a refresh',()=>{
 const h=finalFusionFixture({pairs:{'fu-first':[[1,2]]}});h.settings.finalReplacements[7].moves.enabled=false;
 h.player.moves=[null,null,null,null];h.hold(1,0,2);h.hold(2,1,8);
 const run={player:h.player,nativeRun:h.run.nativeRun,finalReplacement:h.state()},
   choice=chooseOfferAction([{kind:'upMove',slot:0,rarity:0},{mods:[{stat:'damage',mul:4}]}],run,h.data,{kind:'upgrade',rerollLegal:true,rerolls:3});
 assert.equal(choice.index,1);assert.equal(choice.action,'choose');
 assert.equal(choice.candidates.find(row=>row.index===0).fusionPriority,false);
 h.player.moves[0].level=7;run.finalReplacement=h.state();
 const last=chooseOfferAction([{kind:'upMove',slot:0,rarity:0}],run,h.data,{kind:'upgrade'});
 assert.equal(last.candidates[0].fusionCompletionBonus,8);
});

test('personal fusion count: achievement preparation cannot retire and remake a completed result',()=>{
  const h=finalFusionFixture({pairs:{'fu-first':[[1,2],[3,4]]}}),r={...h.run.nativeRun,player:h.player,startSpecies:7,fusions:['fu-first']};
  h.player.moves=[null,null,null,null];h.fuseFixture('fu-first',[1,2],0);h.hold(3,1,8);h.hold(4,2,8);
  assert.equal(fusionGoalReplacementState({kind:'fusion',count:3,singleRun:true},r,h.data),null);
  const repeated=fusionGoalReplacementState({kind:'fusion',count:3,singleRun:true},r,h.data,h.settings);
  assert.equal(repeated?.needsFusion??false,false);
  h.settings.finalReplacements[7].fusion.targets=['fu-first','fu-first'];
  assert.equal(fusionGoalReplacementState({kind:'fusion',count:3,singleRun:true},r,h.data,h.settings)?.needsFusion,true);
});

test('fusion-count goals prepare an actual native parent pair from level1 rather than stopping at an existing product',()=>{
 const h=finalFusionFixture({slots:3,level:1}),r={...h.run.nativeRun,player:h.player,startSpecies:7,fusions:[]};
 h.player.moves=[null,null,null];h.hold(1,0,8);h.hold(2,1,8);
 let state=fusionGoalReplacementState({kind:'fusion',count:3,singleRun:true},r,h.data);
 assert.equal(state.fusion.pending.key,'fu-first');assert.equal(state.needsFusion,true);
 r.fusions.push('fu-first');h.fuseFixture('fu-first',[1,2],0);h.player.moves[1]=null;
 state=fusionGoalReplacementState({kind:'fusion',count:3,singleRun:true},r,h.data);
 assert.ok(state.fusion.pending);assert.notEqual(state.fusion.phase,'complete');
 assert.ok(!state.moves.forget.includes(0),'a second unused parent route is prepared before retiring a made fusion');
 r.fusions.push('fu-second','fu-third');assert.equal(fusionGoalReplacementState({kind:'fusion',count:3,singleRun:true},r,h.data),null);
});

test('fusion goals cannot retire a full product just to remake the same result',()=>{
 const h=finalFusionFixture({slots:3,level:30,pairs:{'fu-first':[[1,2]]}}),r={...h.run.nativeRun,player:h.player,startSpecies:7,fusions:['fu-first','fu-first']};
 h.player.moves=[null,null,null];h.fuseFixture('fu-first',[1,2],0);h.fuseFixture('fu-first',[3,4],1);
 h.hold(7,2);
 const before=r.fusions.slice(),state=fusionGoalReplacementState({kind:'fusion',count:3,singleRun:true},r,h.data);
 assert.equal(state,null);assert.deepEqual(r.fusions,before);
 assert.ok(h.player.moves[0]);assert.equal(h.player.moves[1].def.key,'fu-first');
});

test('strict move and vitamin sets apply from native level1 while preserving disabled legacy configuration',()=>{
 const h=finalLoadoutFixture({level:1}),stored=h.settings.finalReplacements[7];
 stored.strictMoves={enabled:true,targets:['surf',null,'surf',null]};
 stored.strictVitamins={enabled:true,targets:['final-vit-4',null,null,null]};
 const before=structuredClone(h.settings),value=h.state();
 assert.equal(value.moves.active,true);assert.equal(value.vitamins.active,true);
 assert.deepEqual(value.strictMoves.targets,['surf']);assert.deepEqual(value.strictVitamins.targets,['final-vit-4']);
 assert.deepEqual(h.settings,before);stored.strictMoves.enabled=false;stored.strictVitamins.enabled=false;
 assert.equal(h.state().moves.active,false);assert.equal(h.state().vitamins.active,false);
});

test('strict choices reject unrelated new and held upgrades even when they are rarer or tactically useful',()=>{
 const h=finalLoadoutFixture({level:1}),stored=h.settings.finalReplacements[7];h.player.moves=[h.player.moves[0]];
 stored.strictMoves={enabled:true,targets:['surf']};stored.strictVitamins={enabled:true,targets:['final-vit-1']};
 const run={player:h.player,nativeRun:h.run.nativeRun,finalReplacement:h.state()},offers=[
  {kind:'upMove',slot:0,rarity:4},newMove(3),newMove(2),{kind:'newVit',vit:'final-vit-2',rarity:4}];
 const choice=chooseOfferAction(offers,run,h.data,{...nativeActions,rerolls:0,skips:0});
 assert.equal(choice.index,2);assert.equal(choice.strictForced,false);
 assert.equal(choice.candidates.every(row=>row.strictAllowed),true);
 assert.equal(strictOfferAllowed({kind:'upMove',slot:0},run,h.data),false);
 assert.equal(strictOfferAllowed({kind:'newVit',vit:'final-vit-1'},run,h.data),true);
 assert.equal(strictOfferAllowed({kind:'upVit',vit:'final-vit-2'},run,h.data),false);
});

test('strict permitted vitamin upgrades override older custom avoid and target-count rules without mutating the plan',()=>{
 const h=finalLoadoutFixture({level:1});
 h.settings.finalReplacements[7].strictVitamins={enabled:true,targets:['final-vit-1']};
 h.player.vitamins=new Map([['final-vit-1',{level:1}]]);
 const build={sourceType:'custom',allowOffPlan:false,avoidVitamins:['final-vit-1'],
  vitaminRules:[{key:'final-vit-1',avoid:true,targetCount:1}],itemCounts:{'final-vit-1':1}},
  before=structuredClone(build),run={player:h.player,nativeRun:h.run.nativeRun,build,finalReplacement:h.state()};
 const result=chooseOfferAction([{kind:'upVit',vit:'final-vit-1'}],run,h.data,
  {...nativeActions,rerolls:1,skips:1});
 assert.equal(result.action,'choose');assert.equal(result.index,0);
 assert.ok(result.candidates[0].rawScore>0);
 assert.deepEqual(build,before);
});

test('a strict vitamin permission cannot relax custom move bans and disabling it restores the old rules',()=>{
 const h=finalLoadoutFixture({level:1});
 h.player.moves=h.player.moves.slice(0,1);
 h.settings.finalReplacements[7].strictVitamins={enabled:true,targets:['final-vit-1']};
 h.player.vitamins=new Map([['final-vit-1',{level:1}]]);
 const build={sourceType:'custom',allowOffPlan:false,vitaminRules:[],avoidVitamins:['final-vit-1'],
  moveRules:[{key:'surf',avoid:true}],avoidMoves:['surf']},
  run={player:h.player,nativeRun:h.run.nativeRun,build,finalReplacement:h.state()},
  result=chooseOfferAction([{kind:'upVit',vit:'final-vit-1'},newMove(2)],run,h.data,{...nativeActions,rerolls:1,skips:1});
 assert.equal(result.index,0);assert.equal(result.action,'choose');
 assert.equal(result.candidates.find(row=>row.key==='surf')?.rawScore,-Infinity);
 h.settings.finalReplacements[7].strictVitamins.enabled=false;
 const old=chooseOfferAction([{kind:'upVit',vit:'final-vit-1'}],{...run,finalReplacement:h.state()},h.data,
  {...nativeActions,rerolls:1,skips:1});
 assert.equal(old.action,'reroll');
});

test('final move preferences and strict moves do not grant off-plan permission to items or vitamins',()=>{
 for(const strict of [false,true]){
  const h=finalLoadoutFixture({level:30}),stored=h.settings.finalReplacements[7];
  h.player.moves=[{def:h.definitions[0],level:1,mods:{dmg:1,cd:1,count:0}}];
  stored.moves.targets=['water-gun'];stored.vitamins.enabled=false;
  if(strict)stored.strictMoves={enabled:true,targets:['water-gun']};
  const build={sourceType:'custom',allowOffPlan:false,moveRules:[],vitaminRules:[],itemRules:[]},
   run={player:h.player,nativeRun:h.run.nativeRun,build,finalReplacement:h.state()},
   projected=finalReplacementBuild(build,run.finalReplacement);
  assert.equal(projected.allowOffPlan,false,'move-only override must retain other categories\' custom permission');
  const items=chooseOfferAction(['leftovers'],run,h.data,{kind:'itemChoice'});
  assert.equal(items.index,null,'an optional item page cannot select the forbidden item');
  assert.equal(items.candidates.length,0,'forbidden items cannot re-enter through fallback');
  const offers=chooseOfferAction([{kind:'newVit',vit:'final-vit-1'},upgrade],run,h.data,
   {...nativeActions,rerolls:0,skips:1});
  assert.equal(offers.candidates.find(row=>row.kind==='newVit').rawScore,-Infinity);
  assert.ok(offers.candidates.find(row=>row.kind==='upMove').rawScore>0,'the intended move category remains permitted');
  assert.equal(offers.index,1);
 }
});

test('strict pages consume real refresh or skip before an unavoidable native forced exception',()=>{
 const h=finalLoadoutFixture({level:1});h.player.moves=[h.player.moves[0]];
 h.settings.finalReplacements[7].strictMoves={enabled:true,targets:['surf']};
 const run={player:h.player,nativeRun:h.run.nativeRun,finalReplacement:h.state()},offers=[newMove(3)],
  history={unplannedRounds:999,rerollsThisPage:999};
 assert.equal(chooseOfferAction(offers,run,h.data,{...nativeActions,history,rerolls:1,skips:1}).action,'reroll');
 assert.equal(chooseOfferAction(offers,run,h.data,{...nativeActions,history,rerolls:0,skips:1}).action,'skip');
 const forced=chooseOfferAction(offers,run,h.data,{...nativeActions,history,rerolls:0,skips:0});
 assert.equal(forced.action,'choose');assert.equal(forced.strictForced,true);
 assert.equal(forced.reason,'mandatory-native-strict-exception-awaiting-tutor');
 assert.equal(chooseOfferAction(offers,run,h.data,{kind:'itemChoice'}).index,null,'optional pages cannot use the mandatory upgrade exception');
});

test('strict initial and forced unrelated moves wait for native forgetting while the native minimum one move remains',()=>{
 const h=finalLoadoutFixture({level:1});h.settings.finalReplacements[7].strictMoves={enabled:true,targets:['surf']};
 h.player.moves=[{def:h.definitions[1],level:1},...h.player.moves.slice(0,3)];
 const value=h.state();assert.deepEqual(value.moves.forget,[1]);assert.equal(value.needsTutor,true);
 h.player.moves=[h.player.moves[1]];
 const only=h.state();assert.deepEqual(only.moves.forget,[]);
 assert.ok(only.strictMoves.blocked.some(row=>row.reason==='native-minimum-one-move'));
});

test('strict forgetting keeps a specified buff or weather and removes the last unrelated attack when native total remains one',()=>{
 for(const arch of ['buff','weather']){
  const h=finalLoadoutFixture({level:1}),def={...h.definitions[0],key:'specified-'+arch,arch};
  h.data.moves.set(def.id,def);h.data.movesByKey.set(def.key,def);
  h.settings.finalReplacements[7].strictMoves={enabled:true,targets:[def.key]};
  h.player.moves=[{def,level:1},h.player.moves[0]];
  const value=h.state();assert.deepEqual(value.moves.forget,[1]);
  assert.equal(value.strictMoves.blocked.some(row=>row.reason==='native-minimum-one-move'),false);
  assert.equal(value.needsTutor,true);
 }
});

test('an empty strict vitamin configuration waits for targets without stripping existing native growth',()=>{
 const h=finalLoadoutFixture({level:1});h.settings.finalReplacements[7].strictVitamins={enabled:true,targets:[]};
 h.player.vitamins=new Map([['final-vit-2',{level:3}],['final-vit-3',{level:8}]]);
 const value=h.state();assert.equal(value.strictVitamins.phase,'waiting-configured-targets');
 assert.deepEqual(value.vitamins.forget,[]);assert.equal(h.player.vitamins.size,2);
});

test('native single-offer auto choice is an explicit strict conflict and is never changed by planning',()=>{
 const h=finalLoadoutFixture({level:1});h.settings.finalReplacements[7].strictMoves={enabled:true,targets:['surf']};
 h.settings.finalReplacements[7].strictVitamins={enabled:true,targets:['final-vit-1']};
 h.run.nativeRun.meta={profile:{settings:{skipEmptyLevelUp:true}}};
 let value=h.state();assert.equal(value.strictMoves.nativeAutoSingleChoice,true);
 assert.ok(value.strictMoves.blocked.some(row=>row.reason==='native-auto-single-offer-before-controller'));
 assert.match(value.strictVitamins.reason,/原生已开启单张强化自动选择/);
 assert.equal(h.run.nativeRun.meta.profile.settings.skipEmptyLevelUp,true);
 h.run.nativeRun.meta.profile.settings.skipEmptyLevelUp=false;value=h.state();
 assert.equal(value.strictMoves.nativeAutoSingleChoice,false);
 assert.equal(value.strictMoves.blocked.some(row=>row.reason==='native-auto-single-offer-before-controller'),false);
});

test('an enabled empty strict set does not restore the old recommended fallback or authorize an unrelated fusion',()=>{
 const h=finalFusionFixture({level:1});h.settings.finalReplacements[7].strictMoves={enabled:true,targets:[null,null,null,null]};
 const value=h.state(),run={player:h.player,nativeRun:h.run.nativeRun,finalReplacement:value};
 assert.equal(value.strictMoves.enabled,true);assert.deepEqual(value.strictMoves.allowed,[]);
 assert.equal(value.strictMoves.phase,'waiting-configured-targets');
 assert.equal(chooseOfferAction([newMove(1)],run,h.data,{...nativeActions,rerolls:0,skips:1}).action,'skip');
 assert.equal(chooseFusionAction([{a:0,b:1,ready:true,r:{key:'fu-first'}}],run,h.data).action,'leave');
});

test('strict fusion preparation allows only the verified required parents and refuses arbitrary temporary output',()=>{
 const h=finalFusionFixture({level:1,slots:3,pairs:{'fu-first':[[1,2]]}});
 h.settings.finalReplacements[7].strictMoves={enabled:true,targets:['fu-first']};
 h.player.moves=[null,null,null];
 const value=h.state(),run={player:h.player,nativeRun:h.run.nativeRun,finalReplacement:value};
 assert.deepEqual(value.strictMoves.parents,['water-gun','surf']);
 assert.equal(strictOfferAllowed(newMove(1),run,h.data),true);assert.equal(strictOfferAllowed(newMove(2),run,h.data),true);
 assert.equal(strictOfferAllowed(newMove(8),run,h.data),false);
 const decision=chooseOfferAction([newMove(8),newMove(1)],run,h.data,{...nativeActions,rerolls:0,skips:0});
 assert.equal(decision.index,1);assert.equal(decision.strictForced,false);
});

test('strict fusion remains pending for an explicitly requested second copy with different legal parents',()=>{
 const h=finalFusionFixture({level:1,slots:4,pairs:{'fu-first':[[1,2],[3,4]]}});
 h.settings.finalReplacements[7].strictMoves={enabled:true,targets:['fu-first',null,null,null]};
 h.settings.finalReplacements[7].fusion.targets=['fu-first','fu-first'];
 h.player.moves=[null,null,null,null];h.fuseFixture('fu-first',[1,2],0);
 const first=h.state();assert.equal(first.fusion.completed.length,1);
 assert.equal(first.fusion.pending.key,'fu-first');assert.deepEqual(first.fusion.pending.parentIds,[3,4]);
 assert.equal(first.moves.forget.includes(0),false,'the already allowed native result is never dismantled for the repeat');
 h.hold(3,1,8);h.hold(4,2,8);
 const ready=h.state();assert.equal(ready.needsFusion,true);
 assert.equal(chooseFusionAction([{a:1,b:2,ready:true,r:h.data.fusionRecipes[0]}],
  {player:h.player,finalReplacement:ready},h.data).action,'choose');
 h.player.moves[1]=null;h.player.moves[2]=null;h.fuseFixture('fu-first',[3,4],1);
 const blocked=h.state();assert.equal(blocked.fusion.completed.length,2);assert.equal(blocked.fusion.pending,null);
 assert.equal(blocked.fusion.phase,'complete','two requested copies are enough; no third search');
 assert.deepEqual(blocked.moves.forget,[]);
});

test('strict fusion blocked by capacity or parent locks preserves the sole requested native result',()=>{
 const h=finalFusionFixture({level:1,slots:3,pairs:{'fu-first':[[1,2]]}});
 h.settings.finalReplacements[7].strictMoves={enabled:true,targets:['fu-first']};
 h.player.moves=[null,null,null];h.fuseFixture('fu-first',[1,2],0);
 const value=h.state();assert.equal(value.fusion.pending,null);assert.equal(value.needsFusion,false);
 assert.equal(value.moves.forget.includes(0),false);assert.equal(value.strictMoves.completed[0],'fu-first');
});

test('all four strict fusion keys are candidates and a feasible fourth is not lost behind three unavailable routes',()=>{
 const h=finalFusionFixture({level:1,slots:3}),keys=Object.keys(h.routes);
 h.settings.finalReplacements[7].strictMoves={enabled:true,targets:keys};h.player.moves=[null,null,null];
 h.run.nativeRun.banished=new Set([1,2,3,4,5,6].map(id=>'m'+id));
 let value=h.state();assert.deepEqual(value.strictMoves.targets,keys);
 assert.deepEqual(value.fusion.ignoredTargets,[]);
 assert.equal(value.fusion.pending.key,keys[3]);assert.deepEqual(value.fusion.pending.parentIds,[7,8]);
 assert.equal(value.strictMoves.allowed.includes('weak-drain'),true);
 h.fuseFixture(keys[3],[7,8],0);value=h.state();
 assert.equal(value.fusion.protectedSlots.includes(0),true,'an already held allowed fourth result must be protected');
 assert.equal(value.moves.forget.includes(0),false);assert.equal(value.strictMoves.unwanted.includes(keys[3]),false);
});

test('extra strict fusion preparation preserves specified ordinary results and reports insufficient spare slots',()=>{
 const h=finalFusionFixture({level:1,slots:4,pairs:{'fu-first':[[1,2],[3,4]]}});
 h.settings.finalReplacements[7].strictMoves={enabled:true,targets:['fu-first','fifth-move','crowd-wave']};
 h.settings.finalReplacements[7].fusion.targets=['fu-first','fu-first'];
 h.player.moves=[null,null,null,null];h.fuseFixture('fu-first',[1,2],0);h.hold(5,1,8);h.hold(8,2,8);
 const value=h.state();assert.equal(value.fusion.pending.key,'fu-first');
 assert.deepEqual(value.moves.forget,[],'do not dismantle specified ordinary results just to prepare an extra copy');
 assert.equal(value.strictMoves.phase,'waiting-preparation-slots');
 assert.ok(value.strictMoves.blocked.some(row=>row.reason==='strict-preserve-requested-moves-no-preparation-slot'));
});

test('strict requested fusion upgrades obey current native cap availability rather than inventing unlimited levels',()=>{
 const h=finalFusionFixture({level:1});h.settings.finalReplacements[7].strictMoves={enabled:true,targets:['fu-first']};
 h.player.moves=[null,null,null,null];h.fuseFixture('fu-first',[1,2],0);
 // The real capOf method is independently executed in the current-native audit;
 // this boundary returns its observed5/6 caps to the shipped offer validator.
 let cap=5;h.player.capOf=()=>cap;
 for(const [nativeCap,level,allowed] of [[5,4,true],[5,5,false],[6,5,true],[6,6,false]]){
  cap=nativeCap;h.player.moves[0].level=level;
  const run={player:h.player,nativeRun:h.run.nativeRun,finalReplacement:h.state()},
   choice=chooseOfferAction([{kind:'upMove',slot:0}],run,h.data,{...nativeActions,rerolls:0,skips:0});
  assert.equal(choice.index,allowed?0:null);if(allowed){assert.equal(choice.strictForced,false);assert.equal(choice.candidates[0].strictAllowed,true);}
 }
});

test('final fusion keeps all allowed candidates while only slots minus one assignments can coexist',()=>{
  for(const slots of [3,4]) {
    const h=finalFusionFixture({slots}),before=structuredClone(h.settings),value=h.state();
    assert.equal(value.fusion.maximum,slots-1);
    assert.deepEqual(value.fusion.targets,Object.keys(h.routes));
    assert.deepEqual(value.fusion.ignoredTargets,[]);
    assert.equal(value.fusion.continuous,false);assert.ok(value.fusion.assignments.length<=slots-1);
    assert.deepEqual(h.settings,before);
    assert.equal(value.moves.slots,1,'two ordinary preparation slots leave one slot per completed fusion');
  }
});

test('ordinary final fusion finds a second same-key route only for two requested copies in every mode',()=>{
 for(const mode of ['standard','endless','tower']){
  const h=finalFusionFixture({slots:4,pairs:{'fu-first':[[1,2],[3,4]]}});
  h.settings.finalReplacements[7].moves.enabled=false;h.run.nativeRun.mode=mode;
  h.settings.finalReplacements[7].fusion.targets=['fu-first','fu-first'];
  if(mode==='tower')h.run.nativeRun.tower={floor:25};if(mode==='endless')h.run.nativeRun.endless={};
  h.player.moves=[null,null,null,null];h.fuseFixture('fu-first',[1,2],0);
  let value=h.state();assert.equal(value.fusion.continuous,false);assert.equal(value.fusion.pending.key,'fu-first');
  assert.deepEqual(value.fusion.pending.parentIds,[3,4]);assert.equal(value.moves.forget.includes(0),false);
  h.hold(3,1,8);h.hold(4,2,8);value=h.state();assert.equal(value.needsFusion,true);
  assert.equal(chooseFusionAction([{a:1,b:2,ready:true,r:h.data.fusionRecipes[0]}],
   {player:h.player,finalReplacement:value},h.data).action,'choose');
  h.player.moves[1]=null;h.player.moves[2]=null;h.fuseFixture('fu-first',[3,4],1);
  value=h.state();assert.equal(value.needsFusion,false);assert.equal(value.fusion.pending,null);
  assert.deepEqual(value.fusion.protectedSlots,[0,1]);assert.equal(value.moves.forget.some(slot=>slot===0||slot===1),false);
 }
});

test('continuous final fusion prioritizes a missing permitted result over a ready extra copy',()=>{
 const h=finalFusionFixture({slots:3,pairs:{'fu-first':[[1,2],[3,4]],'fu-second':[[5,6]]}});
 h.settings.finalReplacements[7].moves.enabled=false;h.player.moves=[null,null,null];
 h.fuseFixture('fu-first',[1,2],0);h.hold(3,1,8);h.hold(4,2,8);
 const value=h.state();assert.equal(value.fusion.pending.key,'fu-second');
 assert.deepEqual(value.fusion.pending.parentIds,[5,6]);assert.equal(value.needsFusion,false);
 assert.equal(value.moves.forget.includes(0),false,'the first finished permitted result stays protected');
});

test('four-key final fusion waits for blocked targets instead of making an unrequested extra copy',()=>{
 const h=finalFusionFixture({slots:4,pairs:{'fu-first':[[1,2],[3,4]],'fu-second':[[1,5]],'fu-third':[[2,6]],'fu-fourth':[[1,8]]}});
 h.settings.finalReplacements[7].moves.enabled=false;h.player.moves=[null,null,null,null];h.fuseFixture('fu-first',[1,2],0);
 const value=h.state();assert.equal(value.fusion.pending,null);assert.equal(value.needsFusion,false);
 assert.equal(value.fusion.blocked.some(row=>row.key==='fu-second'),true);assert.equal(value.moves.forget.includes(0),false);
});

test('continuous final fusion protects specified ordinary results and custom plans still veto unrequested fusions',()=>{
 const h=finalFusionFixture({slots:4,pairs:{'fu-first':[[1,2],[3,4]]}});
 h.settings.finalReplacements[7].moves.targets=['late-beam'];
 h.player.moves=[null,null,null,null];h.fuseFixture('fu-first',[1,2],0);h.hold(3,1,8);
 const value=h.state();assert.equal(value.fusion.pending,null);assert.equal(value.needsFusion,false);
 assert.equal(value.moves.forget.includes(0),false);assert.equal(value.moves.forget.includes(1),false);
 const offer={a:0,b:1,ready:true,r:{key:'unrequested-fusion'}};
 const ordinary={player:{moves:[{def:{key:'a',arch:'bolt'},level:8},{def:{key:'b',arch:'beam'},level:8}]}};
 for(const veto of [{allowOffPlan:false},{replacementPolicy:'never'}])
  assert.equal(chooseFusionAction([offer],{...ordinary,build:{sourceType:'custom',moves:['a'],...veto}},h.data).action,'leave');
});

test('fusion parent allocation forward-checks later unique recipes instead of consuming them greedily',()=>{
  const h=finalFusionFixture({slots:3,pairs:{'fu-first':[[1,2],[3,4]],'fu-second':[[1,5]]}});
  h.player.moves=[];h.hold(1,0,8);h.hold(2,1,8);
  const value=h.state();
  assert.deepEqual(Object.fromEntries(value.fusion.assignments.map(pair=>[pair.key,pair.parentIds])),{'fu-first':[3,4],'fu-second':[1,5]});
  assert.deepEqual(value.fusion.assignments.find(pair=>pair.key==='fu-first').parents,['late-beam','shared-move']);
  assert.equal(value.needsFusion,false,'a ready cheap pair must not destroy the only route to target2');
});

test('successful desired fusions are retained while new parents use the remaining two preparation slots',()=>{
  for(const slots of [3,4]) {
    const h=finalFusionFixture({slots});h.player.moves=Array(slots).fill(null);
    h.settings.finalReplacements[7].moves.enabled=false;
    for(let index=0;index<slots-1;index++) {
      const before=h.state(),pending=before.fusion.pending;
      assert.equal(pending.key,Object.keys(h.routes)[index]);
      assert.equal(before.moves.forget.some(slot=>h.player.moves[slot]?.def.arch==='fusion'),false);
      for(const id of pending.parentIds)h.hold(id,h.player.moves.findIndex(move=>!move),8);
      const ready=h.state();assert.equal(ready.needsFusion,true);
      const [a,b]=ready.fusion.pending.parentSlots;
      const decision=chooseFusionAction([{a,b,ready:true,r:h.data.fusionRecipes.find(row=>row.key===pending.key)}],
        {player:h.player,build:finalReplacementBuild({},ready)},h.data);
      assert.equal(decision.key,pending.key);
      h.player.moves[a]=null;h.player.moves[b]=null;
      h.fuseFixture(pending.key,pending.parentIds,Math.min(a,b));
    }
    h.settings.finalReplacements[7].moves.enabled=true;
    const done=h.state();assert.equal(done.fusion.phase,'waiting-preparation-slots');assert.equal(done.needsFusion,false);
    assert.equal(done.fusion.pending,null);assert.equal(done.moves.slots,1);
    assert.equal(done.moves.targets[0],slots===3?'fifth-move':'crowd-wave','remaining ordinary targets start from the first still legal configured key');
    assert.equal(done.moves.blocked.some(row=>row.key==='water-gun'&&row.reason==='native-fusion-parent-consumed'),true);
    assert.deepEqual(done.moves.forget,[],'the planner never tries to start an impossible extra pair');
  }
});

test('incompatible desired fusion parents are reported and achieved desired fusions are never dismantled',()=>{
  const h=finalFusionFixture({slots:3,pairs:{'fu-first':[[1,2]],'fu-second':[[1,3]]}});
  let value=h.state();
  assert.deepEqual(value.fusion.assignments.map(pair=>pair.key),['fu-first']);
  assert.equal(value.fusion.blocked.some(row=>row.key==='fu-second'&&row.reason==='fusion-parent-conflict'),true);
  h.player.moves=[null,null,null];h.fuseFixture('fu-first',[1,2],0);h.hold(7,1);h.hold(8,2);
  value=h.state();assert.equal(value.fusion.pending,null);
  assert.equal(value.fusion.blocked.some(row=>row.key==='fu-second'),true);
  assert.equal(value.moves.forget.includes(0),false);
});

test('an unwanted fusion blocking required parents is forgotten before unrelated low-level fillers',()=>{
  const h=finalFusionFixture({slots:4});h.player.moves=[null,null,null,null];
  h.settings.finalReplacements[7].fusion.targets=['fu-first'];
  const wrong={id:50200,key:'fu-wrong',arch:'fusion',dmg:10,cd:1};
  h.player.moves[0]={def:wrong,parents:[1,2],level:5};h.hold(7,1,1);h.hold(8,2,1);
  assert.deepEqual(h.state().moves.forget,[],'existing native empty capacity is filled before another removal');h.hold(6,3,1);
  const value=h.state();
  assert.deepEqual(value.fusion.pending.blockingFusionSlots,[0]);
  assert.equal(value.moves.forget[0],0,'do not repeatedly remove only the latest filler while retaining the lock');
  assert.equal(value.fusion.phase,'remove-blocking-fusion');
});

test('the sole blocking fusion remains as output until a real temporary attack or parent is learned',()=>{
  const h=finalFusionFixture({slots:3});h.player.moves=[null,null,null];
  h.settings.finalReplacements[7].fusion.targets=['fu-first'];
  h.player.moves[0]={def:{id:50200,key:'fu-wrong',arch:'fusion',dmg:10,cd:1},parents:[1,2],level:5};
  let value=h.state();assert.equal(value.fusion.pending.needsTemporaryOutput,true);
  assert.deepEqual(value.moves.forget,[]);
  const run={player:h.player,nativeRun:h.run.nativeRun,finalReplacement:value};
  const decision=chooseOfferAction([upgrade,newMove(7)],run,h.data,nativeActions);
  assert.equal(decision.index,1);assert.equal(decision.action,'choose');
  h.hold(7,1);assert.deepEqual(h.state().moves.forget,[]);h.hold(8,2);value=h.state();assert.equal(value.moves.forget[0],0);
});

test('a sole blocking fusion plus buffs makes a safe empty slot before requesting temporary output',()=>{
  const h=finalFusionFixture({slots:3});h.player.moves=[null,null,null];
  h.settings.finalReplacements[7].fusion.targets=['fu-first'];
  h.player.moves[0]={def:{id:50200,key:'fu-wrong',arch:'fusion'},parents:[1,2],level:5};
  h.hold(9,1,1);h.hold(9,2,2);
  const value=h.state();
  assert.equal(value.fusion.pending.needsTemporaryOutput,true);
  assert.equal(value.moves.forget.includes(0),false);
  assert.ok(value.moves.forget.length>0);
});

test('fusion learning gives legal needed parents and their upgrades to eight priority over normal final targets',()=>{
  const h=finalFusionFixture({slots:3});h.player.moves=[null,null,null];h.hold(1,0,7);
  const value=h.state(),run={player:h.player,nativeRun:h.run.nativeRun,finalReplacement:value};
  let decision=chooseOfferAction([newMove(5),upgrade,newMove(2)],run,h.data,nativeActions);
  assert.equal(decision.index,2);
  decision=chooseOfferAction([newMove(5),upgrade],run,h.data,nativeActions);
  assert.equal(decision.index,1);
  h.player.moves[0].level=8;
  const state=h.state(),built=finalReplacementBuild({moves:['fifth-move']},state);
  assert.deepEqual(built.moves,['water-gun','surf']);
});

test('planned fusion selection only accepts the actual ready pending recipe and allocated parent pair',()=>{
  const h=finalFusionFixture({slots:4});h.player.moves=[null,null,null,null];h.hold(1,0,8);h.hold(2,1,8);h.hold(3,2,8);h.hold(4,3,8);
  const value=h.state(),build=finalReplacementBuild({sourceType:'custom',allowOffPlan:false,avoidMoves:['fu-first']},value),
    offers=[{a:2,b:3,ready:true,r:h.data.fusionRecipes[1]},{a:0,b:1,ready:true,r:h.data.fusionRecipes[0]}];
  assert.equal(chooseFusionAction(offers,{player:h.player,build},h.data).index,1);
  assert.equal(chooseFusionAction([offers[0]],{player:h.player,build},h.data).action,'leave');
  h.player.moves[1].level=7;
  assert.equal(chooseFusionAction(offers,{player:h.player,build},h.data).action,'leave','recheck actual levels even if the state snapshot was ready');
});

test('fusion threshold, unknown native resolver and future or banished parents never trigger destructive preparation',()=>{
  const h=finalFusionFixture({slots:3,level:29});
  h.settings.finalReplacements[7].fusion.targets=['fu-first'];
  assert.equal(h.state().fusion.phase,'threshold-wait');
  const offer={a:0,b:1,ready:true,r:h.data.fusionRecipes[0]};
  assert.equal(chooseFusionAction([offer],{player:h.player,build:finalReplacementBuild({},h.state())},h.data).action,'leave');
  h.player.level=30;h.data.moveGuide=()=>({kit:[{id:1,level:999},{id:2,level:999},{id:3,level:999},{id:4,level:999}],line:[],shared:[]});
  const future=h.state();assert.equal(future.fusion.phase,'waiting-parent-availability');assert.deepEqual(future.moves.forget,[]);
  h.run.nativeRun.banished=new Set(['m1']);
  assert.equal(h.state().fusion.blocked.some(row=>row.key==='fu-first'),true);
  delete h.data.fusionFor;
  const unknown=h.state();assert.equal(unknown.fusion.phase,'blocked');
  assert.equal(unknown.fusion.blocked.every(row=>row.reason==='native-fusion-planning-unavailable'),true);
});

test('final vitamins banished by their native v-key do not provoke forget or forced refresh of other vitamins',()=>{
  const h=finalLoadoutFixture({moveSlots:3});h.settings.finalReplacements[7].moves.enabled=false;
  h.run.nativeRun.banished=new Set(['vfinal-vit-1','vfinal-vit-2','vfinal-vit-3']);
  h.player.vitamins=new Map([['temporary-a',{}],['temporary-b',{}],['temporary-c',{}]]);
  const value=h.state();assert.deepEqual(value.vitamins.readyMissing,[]);assert.deepEqual(value.vitamins.forget,[]);
  h.player.vitamins.clear();
  const result=chooseOfferAction([{kind:'newVit',vit:'final-vit-6',rarity:0}],
    {player:h.player,nativeRun:h.run.nativeRun,finalReplacement:h.state()},h.data,nativeActions);
  assert.equal(result.action,'choose');assert.ok(result.score>0);
});

test('future-only ordinary final skills keep useful fallback scores and currently available partial targets free only needed slots',()=>{
  const h=finalLoadoutFixture({moveSlots:4});h.player.moves=h.player.moves.slice(0,1);
  h.data.moveGuide=()=>({kit:[1,2,3,4].map(id=>({id,level:999})),line:[],shared:[]});
  let state=h.state();assert.deepEqual(state.moves.readyMissing,[]);
  const result=chooseOfferAction([newMove(8)],{player:h.player,nativeRun:h.run.nativeRun,finalReplacement:state},h.data,nativeActions);
  assert.equal(result.action,'choose');assert.ok(result.candidates[0].score>-1000);
  h.player.moves=[5,6,7,8].map(id=>({def:h.data.moves.get(id),level:1}));
  h.data.moveGuide=()=>({kit:[{id:1,level:1},...([2,3,4].map(id=>({id,level:999})))],line:[],shared:[]});
  state=h.state();assert.deepEqual(state.moves.readyMissing,['water-gun']);assert.equal(state.moves.forget.length,1);
});

test('owned fusion parents and shared random restrictions report explicit native unavailability',()=>{
  const h=fixture({moveSlots:4});
  h.player.moves=[{def:{id:50000,key:'fu-held',arch:'fusion'},parents:[2],level:1}];
  let rows=analyzeMoveReadiness(h.run,h.data);
  assert.equal(rows.find(row=>row.key==='surf').reason,'native-fusion-parent-consumed');
  const random={id:20,key:'random-shared',arch:'random',dmg:1,cd:1};h.data.moves.set(20,random);h.data.movesByKey.set(random.key,random);
  h.player.moves=[{def:{id:21,key:'random-held',arch:'random'},level:1}];h.run.build={moves:[random.key]};
  h.data.moveGuide=()=>({kit:[],line:[],shared:[{id:20,level:1,open:true}]});
  rows=analyzeMoveReadiness(h.run,h.data);assert.equal(rows[0].reason,'native-shared-random-already-held');
});

test('fusion nonempty target order differs from ordinary physical-slot target positions',()=>{
  const h=finalFusionFixture({slots:3});
  h.settings.finalReplacements[7].fusion.targets=[null,'fu-first',null,'fu-second'];
  h.settings.finalReplacements[7].moves.targets=[null,'surf',null,'shared-move'];
  const value=h.state();assert.deepEqual(value.fusion.targets,['fu-first','fu-second']);
  assert.deepEqual(value.moves.configuredTargets,['surf'],'ordinary fourth position stays inactive with three native slots');
});

test('unrelated global definitions do not enlarge a character fusion pool or trigger a bogus 256-move limit',()=>{
  const h=finalFusionFixture({slots:3}),before=h.state().fusion.search.pairChecks;
  for(let index=0;index<700;index++) {
    const def={id:1000+index,key:'global-unrelated-'+index,arch:'bolt',type:'fire'};
    h.data.moves.set(def.id,def);h.data.movesByKey.set(def.key,def);
  }
  const value=h.state();assert.equal(value.fusion.search.pairChecks,before);
  assert.equal(value.fusion.search.exhausted,false);assert.equal(value.fusion.pending.key,'fu-fourth');
});

test('a large verified native pool is supported and signature metadata avoids quadratic resolver calls',()=>{
  const h=finalFusionFixture({slots:3});
  for(let index=0;index<430;index++) {
    const def={id:1000+index,key:'learnable-extra-'+index,arch:'bolt',type:'normal'};
    h.definitions.push(def);h.data.moves.set(def.id,def);h.data.movesByKey.set(def.key,def);
  }
  for(const [index,parents] of [['water-gun','surf'],['late-beam','shared-move'],['fifth-move','unrelated'],['weak-drain','crowd-wave']].entries())
    h.data.fusionRecipes[index].moves=parents;
  let calls=0;const resolver=h.data.fusionFor;h.data.fusionFor=(...args)=>{calls++;return resolver(...args);};
  const value=h.state();assert.equal(value.fusion.search.exhausted,false);
  assert.equal(value.fusion.pending.key,'fu-fourth');assert.equal(calls,4,'each of four verified signature candidates is checked once');
});

test('an evolution-only parent stays future until the native species actually changes, even past its level gate',()=>{
  const h=finalFusionFixture({slots:3});h.player.moves=[null,null,null];h.hold(7,0);
  h.run.nativeRun.nextEvo={to:8,level:30};
  h.data.data={get:id=>({id,types:['water']})};
  h.data.moveGuide=id=>({kit:(id===8?[1,2,3,4]:[7]).map(id=>({id,level:1,open:true})),line:[],shared:[]});
  let value=h.state();assert.equal(value.fusion.phase,'waiting-parent-availability');assert.deepEqual(value.moves.forget,[]);
  assert.equal(value.fusion.pending.readiness.every(row=>row.state!=='now'),true);
  h.player.speciesId=8;delete h.run.nativeRun.nextEvo;
  value=h.state();assert.equal(value.fusion.pending.available,true);
});

test('five verified glitch neighbours retain a pair after four parents are reserved for later signatures',()=>{
  const h=finalFusionFixture({slots:4,pairs:{'fu-first':[[1,6]],'fu-second':[[2,3]],'fu-third':[[4,5]]}});
  h.data.fusionRecipes[0].kind='glitch';
  h.data.fusionRecipes[1].moves=['surf','late-beam'];
  h.data.fusionRecipes[2].moves=['shared-move','fifth-move'];
  h.data.fusionFor=(a,b)=>{
    const ids=[a.id,b.id];
    if(ids.includes(2)&&ids.includes(3))return h.data.fusionRecipes[1];
    if(ids.includes(4)&&ids.includes(5))return h.data.fusionRecipes[2];
    return ids.every(id=>id<=6)?h.data.fusionRecipes[0]:null;
  };
  h.player.moves=[null,null,null,null];[2,3,4,5].forEach((id,index)=>h.hold(id,index,8));
  const value=h.state();
  assert.equal(value.fusion.search.sparsifiedGlitch,true);
  assert.deepEqual([...value.fusion.assignments.find(pair=>pair.key==='fu-first').parentIds].sort((a,b)=>a-b),[1,6]);
  assert.equal(value.fusion.assignments.length,3);
});

test('dense glitch planning retains verified alternatives with bounded resolver work and supports new same-type fallback',()=>{
  const h=finalFusionFixture({slots:3,pairs:{'fu-first':[[1,2]]}});
  h.data.fusionRecipes[0].kind='glitch';
  for(let index=0;index<430;index++) {
    const def={id:1000+index,key:'glitch-extra-'+index,arch:'bolt',type:'new-native-type'};
    h.definitions.push(def);h.data.moves.set(def.id,def);h.data.movesByKey.set(def.key,def);
  }
  for(const def of h.definitions)if(!['buff','weather'].includes(def.arch))def.type='new-native-type';
  let calls=0;h.data.fusionFor=()=>{calls++;return h.data.fusionRecipes[0];};
  const value=h.state(),ordinary=h.definitions.filter(def=>!['buff','weather','fusion'].includes(def.arch)).length;
  assert.equal(value.fusion.pending.key,'fu-first');assert.equal(value.fusion.search.exhausted,false);
  assert.ok(calls<=ordinary*5,`dense fallback graph need not query every pair: ${calls}`);
  assert.ok(calls>0,'same-type is not excluded when no actual native type recipe exists');
});

test('missing fusion parent offers spend only finite native refreshes and skips before a legal choice',()=>{
  const h=finalFusionFixture({slots:3});h.player.moves=[null,null,null];h.hold(7,0);
  const run={player:h.player,nativeRun:h.run.nativeRun,finalReplacement:h.state()};
  let history={},rerolls=20,skips=2,chosen=false,refreshes=0;
  for(let attempt=0;attempt<20;attempt++) {
    const result=chooseOfferAction([newMove(8)],run,h.data,{...nativeActions,history,rerolls,skips});
    history=result.nextHistory;
    if(result.action==='reroll'){rerolls--;refreshes++;}
    else if(result.action==='skip')skips--;
    else {assert.equal(result.action,'choose');assert.equal(result.index,0);chosen=true;break;}
  }
  assert.equal(chosen,true);assert.ok(refreshes<=6);
});

test('a fusion key in ordinary final-move settings cannot turn into a fictitious level-up learning target',()=>{
  const h=finalFusionFixture({slots:3});h.settings.finalReplacements[7].fusion.enabled=false;
  h.settings.finalReplacements[7].moves.targets=['fu-first'];
  const value=h.state();assert.equal(value.moves.enabled,false);assert.deepEqual(value.moves.readyMissing,[]);
});

function finalRandomFusionFixture() {
  const h=finalFusionFixture({slots:3,pairs:{'fu-random':[[20,21]]}});
  for(const [id,key]of [[20,'random-shared'],[21,'random-kit'],[22,'random-other']]) {
    const def={id,key,arch:'random',type:'water',cls:'special',dmg:10,cd:1};
    h.data.moves.set(id,def);h.data.movesByKey.set(key,def);h.definitions.push(def);
  }
  h.settings.finalReplacements[7].moves.enabled=false;h.settings.finalReplacements[7].vitamins.enabled=false;
  h.data.moveGuide=()=>({kit:[21,22,7,1].map(id=>({id,level:1,open:true})),line:[],shared:[{id:20,level:1,open:true}]});
  h.data.fusionRecipes[0].moves=['random-shared','random-kit'];
  h.player.moves=[null,null,null];h.hold(21,0,8);h.hold(7,1,1);
  return h;
}

test('a held kit random can be forgotten and relearned after its shared random fusion parent',()=>{
  const h=finalRandomFusionFixture();h.hold(8,2);let value=h.state();
  assert.equal(value.fusion.phase,'remove-blocking-random');
  assert.deepEqual(value.fusion.pending.blockingMoveSlots,[0]);assert.deepEqual(value.fusion.pending.relearnSlots,[0]);
  assert.deepEqual(value.fusion.pending.learningOrder,['random-shared','random-kit']);
  assert.equal(value.moves.forget[0],0,'the parent itself must not be incorrectly frozen before required relearning');
  h.player.moves[0]=null;value=h.state();
  let decision=chooseOfferAction([newMove(21),newMove(20)],{player:h.player,nativeRun:h.run.nativeRun,finalReplacement:value},h.data,nativeActions);
  assert.equal(decision.index,1,'shared random is learned first');
  h.hold(20,0,8);value=h.state();
  assert.deepEqual(value.moves.forget,[1],'weaker drain is replaced while stronger crowd output is kept');h.player.moves[1]=null;value=h.state();
  decision=chooseOfferAction([newMove(21),newMove(8)],{player:h.player,nativeRun:h.run.nativeRun,finalReplacement:value},h.data,nativeActions);
  assert.equal(decision.index,0,'kit random remains native-learnable after the shared parent');
  h.hold(21,1,8);value=h.state();assert.equal(value.needsFusion,true);
});

test('a sole blocking random remains usable until a non-random temporary output is actually learned',()=>{
  const h=finalRandomFusionFixture();h.player.moves[1]=null;
  let value=h.state();assert.equal(value.fusion.pending.needsTemporaryOutput,true);assert.deepEqual(value.moves.forget,[]);
  const decision=chooseOfferAction([newMove(22),newMove(7)],{player:h.player,nativeRun:h.run.nativeRun,finalReplacement:value},h.data,nativeActions);
  assert.equal(decision.index,1,'another random would keep blocking the shared parent');
  h.hold(7,1);assert.deepEqual(h.state().moves.forget,[]);h.hold(8,2);value=h.state();assert.equal(value.moves.forget[0],0);
});

test('unrelated random blockers and unwanted fusion-parent blockers are removed without discarding the last output',()=>{
  const h=finalRandomFusionFixture();
  h.player.moves[2]={def:{id:50200,key:'fu-wrong',arch:'fusion'},parents:[20],level:2};
  let value=h.state();assert.deepEqual(value.fusion.pending.blockingFusionSlots,[2]);
  assert.deepEqual(value.fusion.pending.blockingMoveSlots,[0]);
  assert.equal(value.moves.forget[0],2);assert.equal(value.moves.forget.includes(0),false,'only one lock is removed before the next native refill');
  assert.equal(value.moves.forget.includes(1),false,'the normal attack supplies output while both locks are removed');
  h.player.moves[1]=null;value=h.state();
  assert.equal(value.fusion.pending.needsTemporaryOutput,true);
  assert.ok(value.moves.forget.length<=1,'two current outputs cannot both be removed in one NPC visit');
});

test('future shared parents do not dismantle random output and banned held parents below eight cannot be upgraded into a fusion',()=>{
  const h=finalRandomFusionFixture();
  h.data.moveGuide=()=>({kit:[21,22,7].map(id=>({id,level:1,open:true})),line:[],shared:[{id:20,level:100,open:true}]});
  let value=h.state();assert.equal(value.fusion.phase,'waiting-parent-availability');assert.deepEqual(value.moves.forget,[]);
  h.data.moveGuide=()=>({kit:[21,22,7].map(id=>({id,level:1,open:true})),line:[],shared:[{id:20,level:1,open:true}]});
  h.run.nativeRun.banished=new Set(['m21']);
  value=h.state();assert.equal(value.fusion.pending,null,'a required forget/relearn of a banished parent is impossible');
  h.player.moves=[null,null,null];h.hold(20,0,8);h.hold(21,1,7);
  value=h.state();assert.equal(value.fusion.pending,null,'native banish blocks further upgrades even when the parent is held');
  h.player.moves[1].level=8;value=h.state();assert.equal(value.needsFusion,true,'native Cb can use a banned but already-ready parent');
});

test('a held random parent is not discarded if its required relearning is gated until a future native level',()=>{
  const h=finalRandomFusionFixture();
  h.data.moveGuide=()=>({kit:[{id:21,level:100,open:true},{id:7,level:1,open:true}],line:[],shared:[{id:20,level:1,open:true}]});
  const value=h.state();assert.equal(value.fusion.phase,'waiting-parent-availability');
  assert.deepEqual(value.fusion.pending.relearnSlots,[0]);assert.deepEqual(value.moves.forget,[]);
});

function finalOrdinaryRandomFixture(targets=['random-shared']) {
  const h=finalRandomFusionFixture();
  h.settings.finalReplacements[7].fusion.enabled=false;
  h.settings.finalReplacements[7].moves={enabled:true,level:30,targets};
  return h;
}

test('ordinary final moves can forget an unrelated random blocker before learning a shared random target',()=>{
  const h=finalOrdinaryRandomFixture();h.hold(8,2);const value=h.state();
  assert.equal(value.moves.phase,'remove-blocking-random');assert.deepEqual(value.moves.readyMissing,['random-shared']);
  assert.equal(value.moves.forget[0],0);assert.equal(value.needsTutor,true);
  h.player.moves[0]=null;
  const next=h.state();assert.equal(next.moves.readiness.find(row=>row.key==='random-shared').state,'now');
  const decision=chooseOfferAction([newMove(21),newMove(20)],{player:h.player,nativeRun:h.run.nativeRun,finalReplacement:next},h.data,nativeActions);
  assert.equal(decision.index,1);
});

test('ordinary final replacement preserves the sole random output and first learns non-random temporary output',()=>{
  const h=finalOrdinaryRandomFixture();h.player.moves[1]=null;
  const value=h.state();assert.equal(value.moves.phase,'temporary-output-before-forget');assert.deepEqual(value.moves.forget,[]);
  const decision=chooseOfferAction([newMove(22),newMove(7)],{player:h.player,nativeRun:h.run.nativeRun,finalReplacement:value},h.data,nativeActions);
  assert.equal(decision.action,'choose');assert.equal(decision.index,1);
  h.hold(7,1);assert.deepEqual(h.state().moves.forget,[]);h.hold(8,2);assert.equal(h.state().moves.forget[0],0);
});

test('two only-shared final random targets retain the earlier goal without alternating forget/relearn cycles',()=>{
  const h=finalOrdinaryRandomFixture(['random-shared','random-other']);
  h.data.moveGuide=()=>({kit:[{id:7,level:1,open:true}],line:[],shared:[{id:20,level:1,open:true},{id:22,level:1,open:true}]});
  h.player.moves=[null,null,null];h.hold(20,0,8);h.hold(7,1);
  for(let tick=0;tick<20;tick++) {
    const value=h.state();assert.deepEqual(value.moves.targets,['random-shared']);
    assert.equal(value.moves.blocked.find(row=>row.key==='random-other').reason,'native-shared-random-conflict');
    assert.equal(value.moves.forget.includes(0),false);assert.equal(value.needsTutor,false);
  }
  h.player.moves[0]=null;h.hold(22,0,8);
  h.hold(8,2);
  assert.equal(h.state().moves.forget[0],0,'a lower-priority already-held shared move may be replaced once by the earlier goal');
});

test('ordinary shared-plus-kit random finals learn shared first even when the user lists kit first',()=>{
  const h=finalOrdinaryRandomFixture(['random-kit','random-shared']);
  h.hold(8,2);
  let value=h.state();assert.deepEqual(value.moves.randomPreparation.relearnSlots,[0]);assert.equal(value.moves.forget[0],0);
  h.player.moves[0]=null;value=h.state();
  assert.deepEqual(finalReplacementBuild({},value).moves,['random-shared','random-kit']);
  let decision=chooseOfferAction([newMove(21),newMove(20)],{player:h.player,nativeRun:h.run.nativeRun,finalReplacement:value},h.data,nativeActions);
  assert.equal(decision.index,1);
  h.hold(20,0,1);value=h.state();
  assert.deepEqual(value.moves.forget,[1]);h.player.moves[1]=null;value=h.state();
  decision=chooseOfferAction([newMove(21),newMove(8)],{player:h.player,nativeRun:h.run.nativeRun,finalReplacement:value},h.data,nativeActions);
  assert.equal(decision.index,0);
  h.hold(21,1,1);assert.deepEqual(h.state().moves.missing,[]);assert.equal(h.state().needsTutor,false);
});

test('ordinary random blockers are not removed for banished targets or an impossible future kit relearn',()=>{
  const h=finalOrdinaryRandomFixture(['random-kit','random-shared']);
  h.run.nativeRun.banished=new Set(['m20']);
  let value=h.state();assert.deepEqual(value.moves.readyMissing,[]);assert.deepEqual(value.moves.forget,[]);
  h.run.nativeRun.banished=new Set(['m21']);value=h.state();
  assert.equal(value.moves.phase,'blocked');assert.deepEqual(value.moves.forget,[]);
  h.run.nativeRun.banished.clear();
  h.data.moveGuide=()=>({kit:[{id:21,level:100,open:true},{id:7,level:1,open:true}],line:[],shared:[{id:20,level:1,open:true}]});
  value=h.state();assert.equal(value.moves.phase,'waiting-parent-availability');assert.deepEqual(value.moves.forget,[]);
});

test('ordinary final random preparation yields entirely to an active fusion preparation',()=>{
  const h=finalRandomFusionFixture();
  h.hold(8,2);
  h.settings.finalReplacements[7].moves={enabled:true,level:30,targets:['random-other']};
  const value=h.state();assert.equal(value.moves.randomPreparation,null);
  assert.equal(value.fusion.pending.key,'fu-random');assert.equal(value.moves.forget[0],0);
});

test('an unavailable throwing native fusion matcher stops after one call instead of retrying every possible pair',()=>{
  const h=finalFusionFixture({slots:4});let calls=0;
  h.data.fusionFor=()=>{calls++;throw Error('fixture unavailable native matcher');};
  const value=h.state();assert.equal(calls,1);assert.equal(value.fusion.phase,'blocked');
  assert.equal(value.fusion.pending,null);
  assert.equal(value.fusion.blocked.every(row=>row.reason==='native-fusion-planning-unavailable'),true);
  assert.equal(value.moves.enabled,true,'ordinary final choices remain available when only fusion planning is unavailable');
});

test('ordinary final skills release the exact unwanted fusion parent lock while preserving another attack',()=>{
  const h=finalOrdinaryRandomFixture(['water-gun']);h.player.moves=[null,null,null];
  h.player.moves[0]={def:{id:50200,key:'fu-old',arch:'fusion'},parents:[1,2],level:2};h.hold(21,1,8);
  h.hold(8,2);
  const value=h.state();assert.equal(value.moves.phase,'remove-blocking-fusion');
  assert.deepEqual(value.moves.randomPreparation.blockingFusionSlots,[0]);
  assert.deepEqual(value.moves.randomPreparation.blockingMoveSlots,[],'a held kit random does not block this native kit/line target');
  assert.equal(value.moves.forget[0],0);assert.equal(value.needsTutor,true);
  h.player.moves[0]=null;assert.equal(h.state().moves.readiness.find(row=>row.key==='water-gun').state,'now');
});

test('ordinary consumed-parent replacement keeps a sole fusion output until a temporary attack is learned',()=>{
  const h=finalOrdinaryRandomFixture(['water-gun']);h.player.moves=[null,null,null];
  h.player.moves[0]={def:{id:50200,key:'fu-old',arch:'fusion'},parents:[1,2],level:2};
  let value=h.state();assert.equal(value.moves.phase,'temporary-output-before-forget');assert.deepEqual(value.moves.forget,[]);
  const decision=chooseOfferAction([newMove(22),newMove(7)],{player:h.player,nativeRun:h.run.nativeRun,finalReplacement:value},h.data,nativeActions);
  assert.equal(decision.index,1);
  h.hold(7,1);assert.deepEqual(h.state().moves.forget,[]);h.hold(8,2);value=h.state();assert.equal(value.moves.forget[0],0);
});

test('all unprotected inherited fusion holders must be removable but any protected desired fusion prevents dismantling',()=>{
  const h=finalOrdinaryRandomFixture(['water-gun']);h.player.moves=[null,null,null];
  h.player.moves[0]={def:{id:50200,key:'fu-old',arch:'fusion'},parents:[1,2],level:2};
  h.player.moves[1]={def:{id:50201,key:'fu-retained',arch:'fusion'},parents:[1,3],level:3};h.hold(7,2);
  let value=h.state();assert.deepEqual(value.moves.randomPreparation.blockingFusionSlots,[0,1]);
  assert.deepEqual(value.moves.forget,[0],'multiple native locks are handled in separate refill cycles');
  h.settings.finalReplacements[7].fusion={enabled:true,level:1,targets:['fu-retained']};
  value=h.state();assert.equal(value.fusion.completed.includes('fu-retained'),true);
  assert.deepEqual(value.moves.forget,[],'removing only the other holder cannot release a parent owned by a protected fusion');
});

test('future and banished consumed parents cannot justify forgetting a fusion and fusion parents do not themselves block unrelated shared random',()=>{
  const h=finalOrdinaryRandomFixture(['water-gun']);h.player.moves=[null,null,null];
  h.player.moves[0]={def:{id:50200,key:'fu-old',arch:'fusion'},parents:[1,2],level:2};h.hold(7,1);
  h.run.nativeRun.banished=new Set(['m1']);assert.deepEqual(h.state().moves.forget,[]);
  h.run.nativeRun.banished.clear();
  h.data.moveGuide=()=>({kit:[{id:1,level:100,open:true},{id:7,level:1,open:true}],line:[],shared:[]});
  let value=h.state();assert.equal(value.moves.phase,'waiting-parent-availability');assert.deepEqual(value.moves.forget,[]);
  h.settings.finalReplacements[7].moves.targets=['random-shared'];
  h.data.moveGuide=()=>({kit:[{id:7,level:1,open:true}],line:[],shared:[{id:20,level:1,open:true}]});
  h.player.moves[0].parents=[22];value=h.state();
  assert.deepEqual(value.moves.randomPreparation.blockingFusionSlots,[]);assert.deepEqual(value.moves.forget,[]);
  assert.deepEqual(value.moves.readyMissing,['random-shared'],'native Qv checks held arch=random, not the parents of an unrelated fusion');
});
