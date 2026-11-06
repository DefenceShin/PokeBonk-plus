import test from "node:test";
import assert from "node:assert/strict";
import {
  nativeInteractionKinds,
  interactionTargetId,
  nativeWorldInteractionCost,
  describeWorldInteraction,
  compareInteractionCandidates,
  createInteractionTracker,
  COOP_INTERACTION_FLAGS,normalizeCoopSettings,cooperativeInteractionDecision,cooperativePassiveRouteAllowed,
  cooperativeReadyPortalRouteAllowed,cooperativeReadyPortalEscapeCandidates,
  interactionApproachGeometry,
} from "../src/interaction-navigation.mjs";

test("interaction approach geometry cannot overwrite objective utility, identity, policy or native state", () => {
  const point = { x: 2, y: 3, z: 4, radius: .65, nativeWalkUpStairs: true,
    nativeStairInteraction: true, score: -1, priorityBand: 99, id: "foreign",
    entity: {}, interaction: { eligible: false }, used: true, extra: "diagnostic" };
  assert.deepEqual(interactionApproachGeometry(point), { x: 2, y: 3, z: 4, radius: .65,
    nativeWalkUpStairs: true, nativeStairInteraction: true });
  assert.deepEqual(interactionApproachGeometry({ x: 2, z: 4, y: NaN, radius: -1,
    nativeWalkUpStairs: 1 }), { x: 2, z: 4 });
  for (const invalid of [null, {}, { x: NaN, z: 4 }, { x: 2, z: Infinity }])
    assert.equal(interactionApproachGeometry(invalid), null);
  const route = { x: 1, z: 2, radius: .5 };
  Object.defineProperty(route, "score", { get() { assert.fail("route diagnostics are private"); } });
  assert.deepEqual(interactionApproachGeometry(route), { x: 1, z: 2, radius: .5 });
});

test("cooperative convenience has 26 exact independent false-default flags and never reads peers while off or solo",()=>{
  const defaults=normalizeCoopSettings();assert.equal(Object.keys(defaults).length,28);
  assert.deepEqual(Object.keys(COOP_INTERACTION_FLAGS),[...nativeInteractionKinds]);
  assert.equal(Object.values(defaults).every(value=>value===false),true);
  for(const config of [defaults,{enabled:false,waitPortal:true}]){
    const coop={};Object.defineProperty(coop,"active",{get(){assert.fail("disabled policy must not read native peers");}});
    assert.equal(cooperativeInteractionDecision({coop},{kind:"portal"},config).allowed,true);
  }
  assert.equal(cooperativeInteractionDecision({}, {kind:"portal"},{enabled:true,doNotPortal:true,waitPortal:true}).allowed,true);
});

test("only the actual portal wait counts native active peers, respects absent/closed/stale phases and keeps readiness immutable",()=>{
  const peers=[{gone:false,stage:1,lastAt:99,last:{flags:64}},{gone:true,stage:1,lastAt:99,last:{flags:64}},
    {gone:false,stage:2,lastAt:99,last:{flags:64}},{gone:false,stage:1,lastAt:80,last:{flags:64}},
    {gone:false,stage:1,lastAt:99,last:{flags:0}}],run={stage:1,realTime:100,coop:{portalReady:false,*active(){yield* peers;}}},
    config={enabled:true,waitPortal:true};
  assert.deepEqual(cooperativeInteractionDecision(run,{kind:"portal"},config),{allowed:true,active:true,activePeers:2,readyPeers:1,reason:null});
  const before=structuredClone(peers);peers[0].last.flags=0;
  assert.equal(cooperativeInteractionDecision(run,{kind:"portal"},config).allowed,false);
  run.coop.portalReady=true;assert.equal(cooperativeInteractionDecision(run,{kind:"portal"},config).allowed,true);
  assert.equal(cooperativeInteractionDecision(run,{kind:"portal"},{...config,doNotPortal:true}).allowed,false);
  assert.equal(run.coop.portalReady,true);peers[0].last.flags=64;assert.deepEqual(peers,before);
});

test("passive altar and mushroom exclusions veto native trigger crossings while allowing escape from an existing circle",()=>{
  const run={coop:{},interactables:{list:[{kind:"altar",x:0,z:0,y:0,r:4},{kind:"shroom",x:12,z:0,y:0,r:1.4,data:{cd:0}}]}},
    config={enabled:true,doNotAltar:true,doNotShroom:true},allowed=(a,b)=>cooperativePassiveRouteAllowed(run,a,b,config);
  assert.equal(allowed({x:-5,z:0},{x:5,z:0}),false);
  assert.equal(allowed({x:2,z:0},{x:5,z:0}),true);assert.equal(allowed({x:2,z:0},{x:-5,z:0}),false);
  assert.equal(allowed({x:10,z:0,y:0},{x:14,z:0,y:0}),false);
  assert.equal(allowed({x:10,z:0,y:3},{x:14,z:0,y:3}),true,"native mushroom cannot launch a path entirely above its height gate");
  assert.equal(cooperativePassiveRouteAllowed({...run,coop:null},{x:-5,z:0},{x:5,z:0},config),true);
  assert.equal(cooperativePassiveRouteAllowed(run,{x:-5,z:0},{x:5,z:0},{enabled:false,doNotAltar:true}),true);
});

test("150 portal waiting uses current native047 heartbeat-aware counts and preserves explicit waiting without a teammate",()=>{
  const run={stage:2,player:{dead:false},coop:{portalReady:false,portalInfo:{inside:1,need:2,wait:['local'],left:10},
    active(){assert.fail('native portalInfo already owns heartbeat reconciliation');}}},config={enabled:true,waitPortal:true};
  assert.equal(cooperativeInteractionDecision(run,{kind:'portal'},config).allowed,true);
  run.coop.portalInfo={inside:0,need:2,wait:['local','peer'],left:-1};
  assert.equal(cooperativeInteractionDecision(run,{kind:'portal'},config).allowed,false);
  run.coop.portalInfo={inside:0,need:1,wait:['local'],left:-1};
  assert.equal(cooperativeInteractionDecision(run,{kind:'portal'},config).allowed,false,'the explicit waitPortal preference still requires another ready teammate');
  assert.equal(cooperativeInteractionDecision(run,{kind:'portal'},{...config,doNotPortal:true}).allowed,false);
  assert.equal(run.coop.portalReady,false,'the helper never toggles native readiness or deadline');
});

test("already-ready cooperative portal exclusion allows only outward escape and stays inert unless explicitly requested",()=>{
 const portal={kind:"portal",x:0,z:0},run={coop:{portalReady:true,advancing:false},player:{pos:{x:8,z:0}},interactables:{list:[portal]}},
   allowed=(a,b)=>cooperativeReadyPortalRouteAllowed(run,a,b,true),before=JSON.stringify(run);
 assert.equal(allowed({x:8,z:0},{x:10,z:0}),true);assert.equal(allowed({x:8,z:0},{x:7,z:0}),false);
 assert.equal(allowed({x:10,z:0},{x:8,z:0}),false);assert.equal(allowed({x:-10,z:0},{x:10,z:0}),false);
 assert.equal(allowed({x:10,z:0},{x:11,z:1}),true);assert.equal(JSON.stringify(run),before,"selection must never forge readiness or positions");
 const candidates=cooperativeReadyPortalEscapeCandidates(run,true);assert.ok(candidates.length>0);assert.ok(candidates.every(point=>Math.hypot(point.x,point.z)>=9.4));assert.ok(candidates[0].x>9.4);
 for(const config of [{coop:null},{coop:{portalReady:false}},{coop:{portalReady:true,advancing:true}}]) {
  const quiet={...run,...config};Object.defineProperty(quiet,"interactables",{get(){assert.fail("inactive rule must not read native portals");}});
  assert.equal(cooperativeReadyPortalRouteAllowed(quiet,{x:1,z:0},{x:0,z:0},true),true);assert.deepEqual(cooperativeReadyPortalEscapeCandidates(quiet,true),[]);
 }
 const off={};Object.defineProperty(off,"coop",{get(){assert.fail("off rule must not read cooperation");}});
 assert.equal(cooperativeReadyPortalRouteAllowed(off,null,null,false),true);assert.deepEqual(cooperativeReadyPortalEscapeCandidates(off,false),[]);
});

test("portal exclusion handles overlapping real portal disks and does not mistake altar proximity for portal readiness",()=>{
 const run={coop:{portalReady:true},player:{pos:{x:8,z:0}},interactables:{list:[{kind:"portal",x:0,z:0},{kind:"portal",x:16,z:0},{kind:"altar",x:8,z:0,r:5}]}};
 for(const point of cooperativeReadyPortalEscapeCandidates(run,true)) {
  assert.ok(run.interactables.list.filter(object=>object.kind==="portal").every(portal=>Math.hypot(point.x-portal.x,point.z-portal.z)>=9.4));
  assert.equal(cooperativeReadyPortalRouteAllowed(run,run.player.pos,point,true),true);
 }
 assert.equal(cooperativeReadyPortalRouteAllowed({...run,coop:{portalReady:false}},run.player.pos,{x:0,z:0},true),true);
});

function fixture(objects = []) {
  return {
    seed: 7,
    stage: 1,
    stageTime: 0,
    time: 0,
    terrain: {},
    gold: 0,
    slotSpins: 0,
    boss: { alive: false },
    enemies: { n: 0, alive: [] },
    player: {
      hp: 100,
      maxHp: 100,
      items: new Map(),
      moves: [],
      canHold: () => true,
    },
    pickups: { count: 40, magnetAll: 0 },
    interactables: { list: objects, chestCost: () => 18, cageCost: () => 30 },
  };
}
const object = (kind, x = 10, data) => ({
  kind,
  x,
  z: 0,
  r: 2.6,
  used: false,
  data,
});
const openOptions = { safeMode: false };

test("every current native world type is explicit and unknown future types cannot receive blind E", () => {
  assert.equal(nativeInteractionKinds.length, 26);
  assert.equal(new Set(nativeInteractionKinds).size, 26);
  const future = object("future-paid-pact");
  assert.equal(describeWorldInteraction(fixture([future]), future, openOptions).reason, "unknown-native-interaction");
});

test("permanent-cost interactions require both explicit permission and current tactical approval", () => {
  for (const kind of ["cursed", "cursedchest", "greed"]) {
    const target = object(kind), run = fixture([target]);
    assert.equal(describeWorldInteraction(run, target, openOptions).eligible, false);
    assert.equal(describeWorldInteraction(run, target, { ...openOptions, rules: { risky: true }, allowRisky: false }).eligible, false);
    assert.equal(describeWorldInteraction(run, target, { ...openOptions, rules: { risky: true }, allowRisky: true }).eligible, true);
    assert.equal(describeWorldInteraction(run, target, { ...openOptions, rules: { risky: false }, allowRisky: true }).eligible, false);
  }
  const shroom = object("shroom");
  assert.equal(describeWorldInteraction(fixture([shroom]), shroom,
    { ...openOptions, rules: { risky: true }, allowRisky: true }).eligible, false,
    "native mushroom triggers on contact, not E; unknown launch endpoints are not blind resource visits");
});

test("landmark identity survives public snapshot recreation, never accepts invalid coordinates", () => {
  const rock = object("rock", 13.25);
  assert.equal(interactionTargetId(rock), interactionTargetId({ ...rock }));
  assert.notEqual(
    interactionTargetId(rock),
    interactionTargetId(object("rock", 13.26)),
  );
  assert.notEqual(
    interactionTargetId(rock),
    interactionTargetId(object("berry", 13.25)),
  );
  assert.equal(
    interactionTargetId({ kind: "rock", id: "x", x: NaN, z: 0 }),
    null,
  );
});

test("current native chest, gift, cage, and slots costs follow their native rules", () => {
  const run = fixture();
  assert.equal(nativeWorldInteractionCost(run, object("chest")), 18);
  assert.equal(
    nativeWorldInteractionCost(run, object("chest", 10, { gift: true })),
    0,
  );
  assert.equal(nativeWorldInteractionCost(run, object("cage")), 30);
  assert.equal(nativeWorldInteractionCost(run, object("slots")), 7);
  run.slotSpins = 3;
  assert.equal(nativeWorldInteractionCost(run, object("slots")), 9);
  run.interactables.chestCost = () => 28;
  assert.equal(nativeWorldInteractionCost(run, object("slots")), 14);
});

test("free resources always sort ahead of optional paid resources regardless of score", () => {
  const rock = object("rock"),
    chest = object("chest", 1),
    run = fixture([rock, chest]);
  run.gold = 100;
  const candidates = [
    {
      interaction: describeWorldInteraction(run, chest, openOptions),
      score: 1000000,
    },
    {
      interaction: describeWorldInteraction(run, rock, openOptions),
      score: 0.01,
    },
  ];
  candidates.sort(compareInteractionCandidates);
  assert.equal(candidates[0].interaction.kind, "rock");
});

test("18-gold chest stays skipped at 0 and 17 gold, becomes available at 18", () => {
  const chest = object("chest"),
    run = fixture([chest]),
    tracker = createInteractionTracker();
  for (const gold of [0, 1, 16, 17]) {
    run.gold = gold;
    run.time++;
    const description = describeWorldInteraction(run, chest, openOptions);
    assert.equal(description.reason, "unaffordable");
    assert.equal(tracker.canTarget(run, chest, description), false);
  }
  run.gold = 18;
  assert.equal(
    tracker.canTarget(
      run,
      chest,
      describeWorldInteraction(run, chest, openOptions),
    ),
    true,
  );
});

test("native price changes, reserve, per-purchase limit, and total budget are reconsidered", () => {
  const chest = object("chest"),
    run = fixture([chest]);
  run.gold = 22;
  assert.equal(
    describeWorldInteraction(run, chest, {
      ...openOptions,
      rules: { goldReserve: 5 },
    }).eligible,
    false,
  );
  assert.equal(
    describeWorldInteraction(run, chest, {
      ...openOptions,
      rules: { maxSpend: 17 },
    }).eligible,
    false,
  );
  assert.equal(
    describeWorldInteraction(run, chest, {
      ...openOptions,
      rules: { totalBudget: 30 },
      spent: 13,
    }).eligible,
    false,
  );
  run.interactables.chestCost = () => 16;
  assert.equal(
    describeWorldInteraction(run, chest, {
      ...openOptions,
      rules: { totalBudget: 30, goldReserve: 5 },
      spent: 13,
    }).eligible,
    true,
  );
});

test("known sealed or time-gated targets are never pursued while waiting to unlock", () => {
  const altar = object("altar", 10, { tier: 3, sealed: true }),
    run = fixture([altar]);
  run.stageTime = 89;
  assert.equal(
    describeWorldInteraction(run, altar, openOptions).reason,
    "sealed",
  );
  altar.data.sealed = false;
  assert.equal(
    describeWorldInteraction(run, altar, { ...openOptions, readyAt: 90 })
      .reason,
    "not-ready",
  );
  run.stageTime = 90;
  assert.equal(
    describeWorldInteraction(run, altar, { ...openOptions, readyAt: 90 })
      .eligible,
    true,
  );
  assert.equal(
    describeWorldInteraction(run, altar, { ...openOptions, available: false })
      .eligible,
    false,
  );
});

test("orbiting a target without getting closer causes a cooldown despite player movement", () => {
  const rock = object("rock"),
    run = fixture([rock]),
    tracker = createInteractionTracker({ progressSeconds: 3 });
  for (let i = 0; i < 3; i++) {
    run.time = i;
    assert.equal(
      tracker.observeTarget(run, rock, { distance: 10 }).blocked,
      false,
    );
  }
  run.time = 3;
  assert.deepEqual(tracker.observeTarget(run, rock, { distance: 10 }), {
    blocked: true,
    reason: "approach-no-progress",
  });
  assert.equal(
    tracker.canTarget(
      run,
      rock,
      describeWorldInteraction(run, rock, openOptions),
    ),
    false,
  );
  run.time = 24;
  assert.equal(
    tracker.canTarget(
      run,
      rock,
      describeWorldInteraction(run, rock, openOptions),
    ),
    true,
  );
  assert.equal(tracker.inspect(run, rock).attempts, 0);
});

test("steady approach makes progress and is not treated as orbiting", () => {
  const rock = object("rock"),
    run = fixture([rock]),
    tracker = createInteractionTracker({ progressSeconds: 3 });
  for (let i = 0; i < 15; i++) {
    run.time = i;
    assert.equal(
      tracker.observeTarget(run, rock, { distance: 30 - i }).blocked,
      false,
    );
  }
});

test("small per-frame native altar charge progress prevents false stuck detections", () => {
  const altar = object("altar"),
    run = fixture([altar]),
    tracker = createInteractionTracker({ progressSeconds: 3 });
  for (let frame = 0; frame <= 60 * 30; frame++) {
    run.time = frame / 60;
    altar.charge = frame / (60 * 35);
    assert.equal(
      tracker.observeTarget(run, altar, { distance: 0, inRange: true }).blocked,
      false,
    );
  }
  // Taking cover may let charge decay; resumed native growth is still progress.
  altar.charge = 0.1;
  tracker.observeTarget(run, altar, { distance: 0, inRange: true });
  for (let frame = 1; frame <= 60 * 5; frame++) {
    run.time = 30 + frame / 60;
    altar.charge = 0.1 + frame / (60 * 35);
    assert.equal(
      tracker.observeTarget(run, altar, { distance: 0, inRange: true }).blocked,
      false,
    );
  }
});

test("standing in range without native effect has a finite timeout", () => {
  const rock = object("rock"),
    run = fixture([rock]),
    tracker = createInteractionTracker({ progressSeconds: 2 });
  tracker.observeTarget(run, rock, { distance: 1, inRange: true });
  run.time = 1;
  tracker.observeTarget(run, rock, { distance: 1, inRange: true });
  run.time = 2;
  assert.equal(
    tracker.observeTarget(run, rock, { distance: 1, inRange: true }).reason,
    "interaction-no-progress",
  );
});

test("repeated key attempts are bounded and never recorded as native success", () => {
  const rock = object("rock"),
    run = fixture([rock]),
    tracker = createInteractionTracker();
  tracker.recordAttempt(run, rock);
  tracker.recordAttempt(run, rock);
  tracker.recordAttempt(run, rock);
  assert.equal(tracker.inspect(run, rock).reason, "repeated-no-effect");
  assert.equal(tracker.inspect(run, rock).attempts, 3);
  assert.equal(rock.used, false);
  assert.equal(run.gold, 0);
  tracker.recordOutcome(run, rock, { changed: false });
  assert.equal(tracker.inspect(run, rock).attempts, 3);
  tracker.recordOutcome(run, rock, { changed: true });
  assert.equal(tracker.inspect(run, rock).attempts, 0);
  assert.equal(
    tracker.canTarget(
      run,
      rock,
      describeWorldInteraction(run, rock, openOptions),
    ),
    true,
  );
});

test("used and removed targets immediately stop being candidates", () => {
  const rock = object("rock"),
    run = fixture([rock]),
    tracker = createInteractionTracker();
  assert.equal(
    tracker.canTarget(
      run,
      rock,
      describeWorldInteraction(run, rock, openOptions),
    ),
    true,
  );
  rock.used = true;
  assert.equal(
    tracker.canTarget(
      run,
      rock,
      describeWorldInteraction(run, rock, openOptions),
    ),
    false,
  );
  run.interactables.list = [];
  assert.equal(
    tracker.canTarget(
      run,
      rock,
      describeWorldInteraction(run, rock, openOptions),
    ),
    false,
  );
});

test("new run, new stage, changed terrain, and endless regeneration reset old failure memory", () => {
  const rock = object("rock"),
    run = fixture([rock]),
    tracker = createInteractionTracker();
  for (const change of [
    () => run.stage++,
    () => (run.terrain = {}),
    () => run.seed++,
  ]) {
    tracker.suppress(run, rock, { untilChange: true, conditionKey: "blocked" });
    change();
    assert.equal(
      tracker.canTarget(
        run,
        rock,
        describeWorldInteraction(run, rock, openOptions),
      ),
      true,
    );
  }
  tracker.suppress(run, rock);
  const otherRun = fixture([rock]);
  assert.equal(
    tracker.canTarget(
      otherRun,
      rock,
      describeWorldInteraction(otherRun, rock, openOptions),
    ),
    true,
  );
  tracker.suppress(otherRun, rock);
  rock.used = true;
  tracker.sync(otherRun);
  rock.used = false;
  assert.equal(
    tracker.canTarget(
      otherRun,
      rock,
      describeWorldInteraction(otherRun, rock, openOptions),
    ),
    true,
  );
});

test("full-health berries are preserved, useful berries and custom healing/free switches work", () => {
  const berry = object("berry"),
    run = fixture([berry]);
  assert.equal(
    describeWorldInteraction(run, berry, openOptions).reason,
    "healing-not-needed",
  );
  run.player.hp = 60;
  assert.equal(
    describeWorldInteraction(run, berry, openOptions).eligible,
    true,
  );
  assert.equal(
    describeWorldInteraction(run, berry, {
      ...openOptions,
      rules: { healing: false },
    }).eligible,
    false,
  );
  assert.equal(
    describeWorldInteraction(run, berry, {
      ...openOptions,
      rules: { free: false },
    }).eligible,
    false,
  );
});

test("survival mode avoids dense detours; active resource mode still rejects critical danger", () => {
  const rock = object("rock"),
    run = fixture([rock]);
  run.enemies = {
    n: 5,
    alive: [1, 1, 1, 1, 1],
    x: [10, 10, 10, 10, 10],
    z: [1, 2, 1, 2, 0],
    radius: [1, 1, 1, 1, 1],
  };
  assert.equal(
    describeWorldInteraction(run, rock, { safeMode: true }).reason,
    "survival-detour",
  );
  assert.equal(describeWorldInteraction(run, rock, openOptions).eligible, true);
  run.player.hp = 10;
  assert.equal(
    describeWorldInteraction(run, rock, openOptions).reason,
    "critical-danger",
  );
});

test("copy with no legal item, active/empty magnets, unknown costs and risky cursed objects are skipped", () => {
  const ditto = object("ditto"),
    magnet = object("magnet"),
    cursed = object("cursedchest"),
    chest = object("chest"),
    run = fixture([ditto, magnet, cursed, chest]);
  assert.equal(
    describeWorldInteraction(run, ditto, openOptions).reason,
    "nothing-copyable",
  );
  run.player.items.set("leftovers", 1);
  assert.equal(
    describeWorldInteraction(run, ditto, { ...openOptions, canCopy: false })
      .eligible,
    false,
  );
  assert.equal(
    describeWorldInteraction(run, ditto, { ...openOptions, canCopy: true })
      .eligible,
    true,
  );
  run.pickups.magnetAll = 2;
  assert.equal(
    describeWorldInteraction(run, magnet, openOptions).reason,
    "magnet-not-needed",
  );
  run.pickups.magnetAll = 0;
  run.pickups.count = 0;
  assert.equal(
    describeWorldInteraction(run, magnet, openOptions).eligible,
    false,
  );
  assert.equal(
    describeWorldInteraction(run, cursed, openOptions).reason,
    "optional-risk",
  );
  run.interactables.chestCost = undefined;
  assert.equal(
    describeWorldInteraction(run, chest, openOptions).reason,
    "unknown-cost",
  );
});

test("shop entrance is skipped when no stock can be bought or held", () => {
  const shop = object("meowth"),
    run = fixture([shop]);
  run.gold = 17;
  run.shop = { stock: [{ key: "leftovers", price: 18, sold: false }] };
  assert.equal(
    describeWorldInteraction(run, shop, openOptions).reason,
    "unaffordable-stock",
  );
  run.gold = 18;
  assert.equal(describeWorldInteraction(run, shop, openOptions).eligible, true);
  run.player.canHold = () => false;
  assert.equal(
    describeWorldInteraction(run, shop, openOptions).reason,
    "no-useful-stock",
  );
});

test("previous stage shop inventory cannot suppress the new native inventory", () => {
  const shop = object("meowth"),
    run = fixture([shop]);
  run.gold = 25;
  run.shop = { stage: 1, stock: [{ key: "leftovers", price: 40, sold: true }] };
  assert.equal(
    describeWorldInteraction(run, shop, openOptions).reason,
    "no-useful-stock",
  );
  run.stage = 2;
  assert.equal(describeWorldInteraction(run, shop, openOptions).eligible, true);
});

test("finished reusable shop visit waits for relevant affordability or stock changes, never clock changes", () => {
  const shop = object("meowth"),
    run = fixture([shop]),
    tracker = createInteractionTracker();
  run.gold = 18;
  run.shop = {
    stock: [
      { key: "leftovers", price: 18, sold: false },
      { key: "focus-band", price: 28, sold: false },
    ],
  };
  const original = describeWorldInteraction(run, shop, openOptions);
  tracker.recordOutcome(run, shop, {
    visitFinished: true,
    conditionKey: original.conditionKey,
  });
  run.time = 100;
  run.gold = 27;
  assert.equal(
    tracker.canTarget(
      run,
      shop,
      describeWorldInteraction(run, shop, openOptions),
    ),
    false,
  );
  run.gold = 28;
  assert.equal(
    tracker.canTarget(
      run,
      shop,
      describeWorldInteraction(run, shop, openOptions),
    ),
    true,
  );
});

test("portal reuse is not a modal visit and cannot be suppressed until an unchanged stage changes", () => {
  const portal = object("portal"), run = fixture([portal]), tracker = createInteractionTracker();
  const description = { eligible: true, conditionKey: "stage1-cleared" };
  tracker.recordOutcome(run, portal, { visitFinished: true, changed: false,
    conditionKey: description.conditionKey });
  assert.equal(tracker.inspect(run, portal).blockedCondition, null);
  for (const now of [1, 30, 300]) {
    run.time = now;
    assert.equal(tracker.canTarget(run, portal, description), true);
  }
  tracker.recordAttempt(run, portal);
  assert.equal(tracker.inspect(run, portal).attempts, 1, "E alone is still only an attempt");
  run.stage = 2;
  run.interactables.list = [];
  assert.equal(tracker.inspect(run, portal), null, "real native progression retires the old stage memory");
});

test("world slots entry checks real minimum cost instead of approaching at zero gold", () => {
  const slots = object("slots"),
    run = fixture([slots]);
  assert.equal(
    describeWorldInteraction(run, slots, openOptions).reason,
    "unaffordable",
  );
  run.gold = 7;
  assert.equal(
    describeWorldInteraction(run, slots, openOptions).eligible,
    true,
  );
  assert.equal(
    describeWorldInteraction(run, slots, { safeMode: true }).reason,
    "roulette-risk",
  );
});

test("switching away from a target or a modal pauses pursuit timeout instead of counting absence as a stall", () => {
  const rock = object("rock"),
    run = fixture([rock]),
    tracker = createInteractionTracker({ progressSeconds: 2 });
  tracker.observeTarget(run, rock, { distance: 10 });
  tracker.release();
  run.time = 300;
  assert.equal(
    tracker.observeTarget(run, rock, { distance: 10 }).blocked,
    false,
  );
});

test("a finished unused slots visit stays suppressed until actual conditions change", () => {
  const slots = object("slots"),
    run = fixture([slots]),
    tracker = createInteractionTracker();
  run.gold = 100;
  const description = () => describeWorldInteraction(run, slots, openOptions);
  tracker.recordOutcome(run, slots, {
    visitFinished: true,
    conditionKey: description().conditionKey,
  });
  assert.equal(slots.used, false, "native Exit leaves this landmark unused");
  for (const time of [1, 30, 300]) {
    run.time = time;
    run.gold++;
    assert.equal(tracker.canTarget(run, slots, description()), false);
  }
  run.interactables.chestCost = () => 28;
  assert.equal(tracker.canTarget(run, slots, description()), true);
  slots.used = true;
  assert.equal(
    description().reason,
    "used",
    "visit memory must not change native consumed rules",
  );
});

test("cancelling an unused Ditto waits for copy inventory changes without treating used Ditto as reusable", () => {
  const ditto = object("ditto"),
    run = fixture([ditto]),
    tracker = createInteractionTracker();
  run.player.items.set("leftovers", 1);
  const description = () => describeWorldInteraction(run, ditto, openOptions);
  tracker.recordOutcome(run, ditto, {
    visitFinished: true,
    conditionKey: description().conditionKey,
  });
  run.time = 300;
  run.gold = 300;
  assert.equal(ditto.used, false);
  assert.equal(tracker.canTarget(run, ditto, description()), false);
  run.player.items.set("leftovers", 2);
  assert.equal(tracker.canTarget(run, ditto, description()), true);
  ditto.used = true;
  assert.equal(description().reason, "used");
});

test("alternating unchanged resource targets retains each selected no-progress budget", () => {
  const a = object("rock", 10),
    b = object("rock", -10),
    run = fixture([a, b]),
    tracker = createInteractionTracker({ progressSeconds: 2 });
  const blockedAt = new Map();
  for (let tick = 0; tick < 40 && blockedAt.size < 2; tick++) {
    run.time = tick * 0.2;
    run.gold++;
    const target = tick % 2 ? a : b;
    const available = tracker.canTarget(
      run,
      target,
      describeWorldInteraction(run, target),
    );
    if (
      !available ||
      tracker.observeTarget(run, target, { distance: 10 }).blocked
    )
      blockedAt.set(target, run.time);
  }
  assert.equal(
    blockedAt.size,
    2,
    "neither target can hide its wasted pursuit time by switching",
  );
  for (const [target, at] of blockedAt) {
    assert.ok(
      at >= 3.8 && at <= 4.6,
      `two selected-second budgets exhausted at ${at}`,
    );
    assert.equal(tracker.inspect(run, target).reason, "approach-no-progress");
  }
  run.time += 21;
  assert.equal(
    tracker.canTarget(run, a),
    true,
    "normal cooldown still allows a fresh attempt",
  );
  assert.equal(tracker.inspect(run, a).noProgressFor, 0);
});

test("separate pursuit segments pause during absence and genuine approach clears prior wasted time", () => {
  const a = object("rock", 10),
    b = object("rock", -10),
    run = fixture([a, b]),
    tracker = createInteractionTracker({ progressSeconds: 2 });
  tracker.observeTarget(run, a, { distance: 10 });
  run.time = 0.6;
  tracker.release();
  assert.ok(Math.abs(tracker.inspect(run, a).noProgressFor - 0.6) < 1e-8);
  run.time = 100;
  assert.equal(tracker.observeTarget(run, b, { distance: 10 }).blocked, false);
  run.time = 100.4;
  tracker.release();
  run.time = 200;
  assert.equal(tracker.observeTarget(run, a, { distance: 10 }).blocked, false);
  assert.ok(
    Math.abs(tracker.inspect(run, a).noProgressFor - 0.6) < 1e-8,
    "time spent elsewhere never counts against the original target",
  );
  run.time = 200.4;
  assert.equal(tracker.observeTarget(run, a, { distance: 9 }).blocked, false);
  assert.equal(
    tracker.inspect(run, a).noProgressFor,
    0,
    "a legitimate segmented route receives a fresh budget after actual progress",
  );
});

test("returning from a modal retains selected no-progress time without charging the modal wait", () => {
  const rock = object("rock"),
    run = fixture([rock]),
    tracker = createInteractionTracker({ progressSeconds: 2 });
  for (let segment = 0; segment < 3; segment++) {
    run.time = segment * 100;
    assert.equal(
      tracker.observeTarget(run, rock, { distance: 10 }).blocked,
      false,
    );
    run.time += 0.8;
    tracker.release();
  }
  run.time = 400;
  assert.equal(
    tracker.observeTarget(run, rock, { distance: 10 }).blocked,
    true,
    "three real 0.8-second failed segments cannot be reset by inactive gaps",
  );
});

test("real charge and relevant native-condition changes reset retained pursuit history", () => {
  const altar = object("altar", 10, { sealed: false }),
    chest = object("chest", 20),
    run = fixture([altar, chest]),
    tracker = createInteractionTracker({ progressSeconds: 2 });
  run.gold = 100;
  tracker.observeTarget(run, altar, { distance: 10 });
  run.time = 1;
  tracker.observeTarget(run, altar, { distance: 10 });
  run.time = 2.1;
  altar.charge = 0.1;
  assert.equal(
    tracker.observeTarget(run, altar, { distance: 10 }).blocked,
    false,
  );
  assert.equal(tracker.inspect(run, altar).noProgressFor, 0);
  tracker.release();
  tracker.canTarget(run, chest, describeWorldInteraction(run, chest));
  tracker.observeTarget(run, chest, { distance: 10 });
  run.time = 3.1;
  tracker.observeTarget(run, chest, { distance: 10 });
  assert.ok(tracker.inspect(run, chest).noProgressFor > 0.9);
  run.interactables.chestCost = () => 20;
  assert.equal(
    tracker.canTarget(run, chest, describeWorldInteraction(run, chest)),
    true,
  );
  assert.equal(tracker.inspect(run, chest).noProgressFor, 0);
  assert.equal(
    tracker.observeTarget(run, chest, { distance: 25 }).blocked,
    false,
    "the changed native condition starts a new approach baseline",
  );
});

test("real progress along a verified detour may increase straight distance without losing the target", () => {
  const target = object("boss", 20), run = fixture([target]), tracker = createInteractionTracker();
  run.player.pos = { x: 0, z: 0 };
  for (let step = 0; step <= 30; step++) {
    run.time = step * 0.4; run.player.pos.x = -step * 0.4;
    const observation = tracker.observeTarget(run, target, { distance: 20 - run.player.pos.x,
      route: { verified: true, waypoint: { x: -20, z: 0 } } });
    assert.equal(observation.blocked, false, "physical detour advance is not merely Euclidean failure");
  }
  assert.ok(tracker.inspect(run, target).routeProgressCount >= 10);
  assert.equal(tracker.inspect(run, target).bestDistance, 20, "detours never raise the best direct distance");
});

test("new moving route endpoints still require physical approach; replanning while stationary never clears the timer", () => {
  const target = object("boss", 20), run = fixture([target]), tracker = createInteractionTracker();
  run.player.pos = { x: 0, z: 0 };
  for (let step = 0; step < 50; step++) {
    run.time = step * 0.2; run.player.pos.x = -step * 0.25;
    assert.equal(tracker.observeTarget(run, target, { distance: 20 - run.player.pos.x,
      route: { verified: true, waypoint: { x: run.player.pos.x - 6, z: 0 } } }).blocked, false);
  }
  const still = fixture([target]), stationary = createInteractionTracker(); still.player.pos = { x: 0, z: 0 };
  let blocked = false;
  for (let step = 0; step <= 16; step++) {
    still.time = step * 0.5;
    blocked ||= stationary.observeTarget(still, target, { distance: 20,
      route: { verified: true, waypoint: { x: -10 - step, z: step % 3 } } }).blocked;
  }
  assert.equal(blocked, true);
  assert.equal(stationary.inspect(still, target).routeProgressCount, 0);
});

test("repeating the same verified route loop cannot renew pursuit forever", () => {
  const target = object("boss", 20), run = fixture([target]), tracker = createInteractionTracker();
  const loop = [];
  for (let x = 0; x < 4; x++) loop.push({ x: -x, z: 0 });
  for (let z = 0; z < 4; z++) loop.push({ x: -4, z });
  for (let x = 4; x > 0; x--) loop.push({ x: -x, z: 4 });
  for (let z = 4; z > 0; z--) loop.push({ x: 0, z });
  let blockedAt = null;
  for (let step = 0; step < 120; step++) {
    run.time = step * 0.25; run.player.pos = { ...loop[step % loop.length] };
    const next = loop[(step + 1) % loop.length];
    if (tracker.observeTarget(run, target, { distance: Math.hypot(20 - run.player.pos.x, run.player.pos.z),
      route: { verified: true, waypoint: next } }).blocked) { blockedAt = run.time; break; }
  }
  assert.ok(blockedAt != null && blockedAt < 20, `repeated route must finish its finite budget: ${blockedAt}`);
  assert.ok(tracker.inspect(run, target).routeVisitedCount < 50);
});

test("unverified movement and target A/B replans cannot masquerade as route progress", () => {
  const first = object("boss", 20), second = object("portal", 30), run = fixture([first, second]);
  const tracker = createInteractionTracker(); run.player.pos = { x: 0, z: 0 };
  let blocked = false;
  for (let step = 0; step < 40; step++) {
    run.time = step * 0.5;
    const target = step % 2 ? second : first;
    blocked ||= tracker.observeTarget(run, target, { distance: target.x,
      route: { verified: true, waypoint: { x: -10 - step, z: step % 3 } } }).blocked;
  }
  assert.equal(blocked, true); assert.equal(tracker.inspect(run, first).routeProgressCount, 0);
  const moving = fixture([first]), unverified = createInteractionTracker(); moving.player.pos = { x: 0, z: 0 };
  blocked = false;
  for (let step = 0; step < 20; step++) {
    moving.time = step * 0.5; moving.player.pos.x = -step;
    blocked ||= unverified.observeTarget(moving, first, { distance: 20 + step,
      route: { verified: false, waypoint: { x: -30, z: 0 } } }).blocked;
  }
  assert.equal(blocked, true); assert.equal(unverified.inspect(moving, first).routeProgressCount, 0);
});

test("shaking around the same cell with changing legal endpoints has only finite route credit", () => {
  const target = object("boss", 20), run = fixture([target]), tracker = createInteractionTracker();
  let blockedAt = null;
  for (let step = 0; step < 40; step++) {
    run.time = step * 0.5; run.player.pos = { x: step % 2 ? -0.4 : 0.4, z: 0 };
    if (tracker.observeTarget(run, target, { distance: 20 - run.player.pos.x,
      route: { verified: true, waypoint: { x: step % 2 ? 10 : -10, z: 0 } } }).blocked) {
      blockedAt = run.time; break;
    }
  }
  assert.ok(blockedAt != null && blockedAt < 12);
  assert.ok(tracker.inspect(run, target).routeProgressCount <= 2);
});

test("season-two egg and fusion readiness follows actual native inventory without waiting at unavailable landmarks",()=>{
 const nest=object("nest"),bill=object("bill"),r=fixture([nest,bill]);
 assert.equal(describeWorldInteraction(r,nest,openOptions).free,true);
 r.egg={need:200};assert.equal(describeWorldInteraction(r,nest,openOptions).reason,"already-carrying-egg");
 assert.equal(describeWorldInteraction(r,bill,openOptions).reason,"no-ready-fusion");
 assert.equal(describeWorldInteraction(r,bill,{...openOptions,canFuse:true}).eligible,true);
 assert.equal(describeWorldInteraction(r,bill,{...openOptions,canFuse:true,rules:{free:false}}).eligible,false);
});

test("new permanent-cost landmarks are never disguised as free resource rewards",()=>{
 for(const kind of ["fossil","porygon","rhydon"]){
  const target=object(kind),r=fixture([target]);
  const denied=describeWorldInteraction(r,target,openOptions);assert.equal(denied.eligible,false);assert.equal(denied.free,false);
  assert.equal(describeWorldInteraction(r,target,{...openOptions,rules:{risky:true},allowRisky:true}).eligible,true);
 }
 const target=object("rhydon"),r=fixture([target]);r.bossSpawned=true;
 assert.equal(describeWorldInteraction(r,target,{...openOptions,rules:{risky:true},allowRisky:true}).reason,"roar-unavailable");
 r.bossSpawned=false;r.roars=3;
 assert.equal(describeWorldInteraction(r,target,{...openOptions,rules:{risky:true},allowRisky:true}).eligible,false);
});

test("tower subactions retain floor gates, safe offerings, explicit Beyond permission and intentional completed-roof exit",()=>{
 const stairs=object("tower",10,{sub:"stairs"}),altar=object("tower",15,{sub:"altar"}),
  portal=object("tower",20,{sub:"portal"}),leave=object("tower",25,{sub:"leave"});
 const r=fixture([stairs,altar,portal,leave]);r.tower={state:"waves",floor:1};
 assert.equal(describeWorldInteraction(r,stairs,openOptions).eligible,false);
 r.tower.state="clear";assert.equal(describeWorldInteraction(r,stairs,openOptions).eligible,true);
 assert.equal(describeWorldInteraction(r,altar,openOptions).free,true);
 assert.equal(describeWorldInteraction(r,portal,{...openOptions,rules:{risky:true},allowRisky:true}).eligible,false);
 assert.equal(describeWorldInteraction(r,leave,openOptions).eligible,false,"stairs must not lose to a premature finish");
 r.interactables.list=[portal,leave];r.tower={roof:true,won:true,state:"roof",floor:8};
 assert.equal(describeWorldInteraction(r,leave,openOptions).eligible,true);
 assert.equal(describeWorldInteraction(r,portal,{...openOptions,rules:{risky:true},allowBeyond:true}).eligible,true);
 assert.equal(describeWorldInteraction(r,leave,{...openOptions,allowBeyond:true}).eligible,false);
 const unknown=object("tower",30,{sub:"future-cost"});r.interactables.list.push(unknown);
 assert.equal(describeWorldInteraction(r,unknown,openOptions).reason,"unknown-tower-action");
});

test("leaving a fusion or trade visit suppresses it until relevant real conditions change",()=>{
 for(const kind of ["bill","porygon","fossil","tower"]){
  const target=object(kind,10,kind==="tower"?{sub:"trick"}:{}),r=fixture([target]),tracker=createInteractionTracker();
  const desc={id:interactionTargetId(target),kind,eligible:true,conditionKey:"before"};
  assert.equal(tracker.canTarget(r,target,desc),true);
  tracker.recordOutcome(r,target,{visitFinished:true,changed:false,conditionKey:"before"});
  assert.equal(tracker.canTarget(r,target,desc),false);
  assert.equal(tracker.canTarget(r,target,{...desc,conditionKey:"after"}),true);
 }
});

test("one synchronous candidate batch scans membership once while ordinary calls remain fresh", () => {
  const objects = Array.from({ length: 100 }, (_, index) => object("rock", index)),
    run = fixture(objects), tracker = createInteractionTracker();
  let visits = 0;
  objects[Symbol.iterator] = function* () {
    for (let index = 0; index < this.length; index++) { visits++; yield this[index]; }
  };
  const result = tracker.withSynchronized(run, () => {
    for (let index = 0; index < objects.length; index++) {
      assert.equal(tracker.canTarget(run, objects[index], { eligible: true, conditionKey: "current" }), true);
      assert.ok(tracker.inspect(run, objects[index]));
    }
    return "current-candidates";
  });
  assert.equal(result, "current-candidates");
  assert.equal(visits, 100, "one traversal, not one per candidate or inspect");
  tracker.inspect(run, objects[0]);
  assert.equal(visits, 200, "normal fresh scanning resumes outside the callback");
});

test("every new batch sees native in-place additions and removals without a time cache", () => {
  const first = object("rock", 1), second = object("rock", 2), list = [first],
    run = fixture(list), tracker = createInteractionTracker();
  tracker.withSynchronized(run, () => assert.ok(tracker.inspect(run, first)));
  list.splice(0, 1, second);
  tracker.withSynchronized(run, () => {
    assert.equal(tracker.inspect(run, first), null);
    assert.ok(tracker.inspect(run, second));
  });
  list.push(first);
  assert.ok(tracker.inspect(run, first), "ordinary get immediately observes a same-array append");
  list.shift();
  assert.equal(tracker.inspect(run, second), null, "ordinary get immediately observes a same-array removal");
});

test("a batch retains live used regeneration and current native-condition eligibility", () => {
  const target = object("rock"), run = fixture([target]), tracker = createInteractionTracker();
  tracker.withSynchronized(run, () => {
    tracker.suppress(run, target, { untilChange: true, conditionKey: "before", reason: "no-effect" });
    assert.equal(tracker.canTarget(run, target, { eligible: true, conditionKey: "before" }), false);
    assert.equal(tracker.canTarget(run, target, { eligible: true, conditionKey: "changed" }), true);
    tracker.suppress(run, target);
    target.used = true;
    assert.equal(tracker.inspect(run, target).used, true);
    target.used = false;
    assert.equal(tracker.canTarget(run, target, { eligible: true, conditionKey: "changed" }), true,
      "observed native regeneration resets the old cooldown inside the same batch");
    assert.equal(tracker.inspect(run, target).attempts, 0);
    assert.equal(tracker.canTarget(run, target, { eligible: false, conditionKey: "changed" }), false,
      "membership never authorizes unavailable native eligibility");
    tracker.recordAttempt(run, target);
    tracker.recordOutcome(run, target, { changed: true });
    assert.equal(tracker.inspect(run, target).attempts, 0);
  });
});

test("stale same-ID objects cannot overwrite the freshly synchronized native entity", () => {
  const old = { ...object("rock"), id: "native-identity" }, replacement = { ...old },
    run = fixture([old]), tracker = createInteractionTracker();
  tracker.suppress(run, old, { untilChange: true, conditionKey: "old" });
  run.interactables.list[0] = replacement;
  tracker.withSynchronized(run, () => {
    old.used = true;
    assert.equal(tracker.inspect(run, old).used, false);
    assert.equal(tracker.canTarget(run, replacement, { eligible: true, conditionKey: "old" }), false);
    assert.equal(tracker.canTarget(run, replacement, { eligible: true, conditionKey: "new" }), true);
  });
});

test("run, stage, terrain, seed or list replacement invalidates an active batch", () => {
  for (const change of ["run", "stage", "terrain", "seed", "list"]) {
    const target = object("rock"), next = object("rock", 20), tracker = createInteractionTracker();
    let run = fixture([target]);
    tracker.withSynchronized(run, () => {
      tracker.suppress(run, target);
      if (change === "run") run = fixture([target]);
      else if (change === "stage") run.stage++;
      else if (change === "terrain") run.terrain = {};
      else if (change === "seed") run.seed++;
      else run.interactables.list = [next];
      assert.equal(tracker.inspect(run, change === "list" ? target : next), null, change);
      assert.ok(tracker.inspect(run, change === "list" ? next : target), change);
      if (change !== "list") assert.equal(tracker.canTarget(run, target, { eligible: true }), true, change);
      run.interactables.list.push(next);
      assert.ok(tracker.inspect(run, next), "invalidated batches return to full scans");
    });
  }
});

test("exceptions and nested batches restore freshness without reviving a previous run snapshot", () => {
  const first = object("rock"), second = object("rock", 20),
    run = fixture([first]), other = fixture([second]), tracker = createInteractionTracker();
  assert.throws(() => tracker.withSynchronized(run, () => { throw new Error("native read failed"); }), /native read failed/);
  run.interactables.list.push(second);
  assert.ok(tracker.inspect(run, second), "finally clears the failed batch");
  tracker.withSynchronized(run, () => {
    assert.ok(tracker.inspect(run, first));
    tracker.withSynchronized(run, () => assert.ok(tracker.inspect(run, second)));
    assert.ok(tracker.inspect(run, first));
    tracker.withSynchronized(other, () => {
      assert.equal(tracker.inspect(other, first), null);
      assert.ok(tracker.inspect(other, second));
    });
    assert.ok(tracker.inspect(run, first), "outer scope is fully synchronized after the other run");
    run.interactables.list.splice(0, 1);
    assert.equal(tracker.inspect(run, first), null, "invalidated outer batch cannot be revived");
  });
});

test("a delayed continuation cannot retain synchronous batch permission", async () => {
  const first = object("rock"), second = object("rock", 20),
    run = fixture([first]), tracker = createInteractionTracker();
  await tracker.withSynchronized(run, async () => {
    assert.ok(tracker.inspect(run, first));
    await Promise.resolve();
    run.interactables.list.splice(0, 1, second);
    assert.equal(tracker.inspect(run, first), null);
    assert.ok(tracker.inspect(run, second));
  });
});
