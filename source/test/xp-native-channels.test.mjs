import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createHash } from "node:crypto";
import {readControllerPackage} from "../scripts/controller-sources.mjs";
import { scoreOffer } from "../src/policy.mjs";

// Exercise the shipped controller at its original native UI boundary. No app,
// account, network, browser, RNG or simulated match is started by this fixture.
const source=(await readControllerPackage()).sharedSource;

// These are actual native item modifiers, independently checked in the reviewed
// 0.8.18 main snapshot. Choice Band helps physical damage and slows all attacks;
// it has negative marginal value for a player whose sole move is special.
const items = new Map([
  ["choice-band", { key: "choice-band", max: 5, rarity: 2, mods: [
    { stat: "physical", mul: 1.35 }, { stat: "attackSpeed", mul: 0.92 },
  ] }],
  ["leftovers", { key: "leftovers", max: 10, rarity: 1, mods: [
    { stat: "regen", add: 1.2 },
  ] }],
  ["oran-berry", { key: "oran-berry", max: 10, rarity: 0, mods: [
    { stat: "maxHp", add: 15 },
  ] }],
]);
const waterGun = { id: 55, key: "water-gun", arch: "bolt", cls: "special",
  type: "water", count: 1, dmg: 12, cd: 1 };
const tackle = { id: 33, key: "tackle", arch: "bolt", cls: "physical",
  type: "normal", count: 1, dmg: 10, cd: 1.5 };

function fixture(settings = {}, build = {}) {
  let now = 1000;
  const document = { body: null, addEventListener() {},
    querySelector: () => null, querySelectorAll: () => [] };
  const sandbox = { document, console, performance: { now: () => now },
    setInterval() {}, addEventListener() {}, dispatchEvent() {},
    KeyboardEvent: class { constructor(type, properties) {
      this.type = type; Object.assign(this, properties);
    } } };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context, { filename: "shipped-choice-audit.bundle.js" });
  context.options = { embedded: true, autoStart: false, settings: {
    mode: "map", randomDelay: false, autoClaim: false, autoUpgrade: false,
    shinyPriority: false, capturePriority: false, ...settings,
  } };
  vm.runInContext("installPilot(options)", context);
  const pilot = context.__PB_PILOT;
  const profile = { league: [7], starter: 7, biomes: { forest: 0 }, seen: [7],
    played: [], settings: {}, daily: { prog: [0, 0, 0], claimed: [] },
    weekly: { prog: [0, 0, 0], claimed: [] } };
  const app = { run: null, input: {}, startRun: async () => false,
    meta: { profile, account: { id: "isolated-choice-fixture", guest: false },
      hasPending: () => false, task: () => null, claimTask() {},
      questProgress: () => 0, claimQuest() {}, lab: () => 0,
      buyLab: () => false, inLeague: () => true, leagueReady: () => [],
      biomeTier: () => 0, endRun: async () => ({}), queue: Promise.resolve(), queued: 0 } };
  const mon = { id: 7, types: ["water"], name: "Squirtle" };
  const moves = new Map([[55, waterGun], [33, tackle]]);
  const movesByKey = new Map([...moves.values()].map(move => [move.key, move]));
  const bridge = { app, roster: [{ id: 7, kit: ["water-gun"] }],
    biomes: [{ id: "forest", types: ["grass"], residents: [7], encounters: [] }],
    biomeLive: () => true, data: { get: () => mon, root: () => mon,
      pokemon: [mon], moves, movesByKey, hasSprite: () => true, hasAnimated: () => true },
    moves, movesByKey, moveDef: id => moves.get(id) || movesByKey.get(id) || null,
    moveGuide: () => ({ kit: [], line: [], shared: [] }),
    vitamins: new Map(), items, rarityMultipliers: [1, 1.2, 1.45, 1.75, 2.1],
    lab: [{ id: "fixture", max: 0, cost: () => Infinity }],
    quests: [{ id: "fixture", counter: "fixture", goal: 100 }] };
  pilot.attach(bridge);
  const run = { state: "play", startSpecies: 7, biome: { id: "forest" },
    stage: 1, pendingUps: 1, time: 120, gold: 0, rerolls: 0, skips: 0,
    player: { speciesId: 7, pos: { x: 0, y: 0, z: 0 }, hp: 100, maxHp: 100,
      moves: [{ def: waterGun, level: 1, mods: {} }], moveSlots: 3,
      vitamins: new Map(), vitaminSlots: 3, items: new Map(), canHold: () => true,
      stats: { physical: 1, special: 1, attackSpeed: 1, regen: 0 }, level: 26,
      types: ["water"] },
    enemies: { alive: new Uint8Array(0) }, projectiles: { flags: new Uint8Array(0) },
    terrain: { walkClear: () => true }, boss: { lineStrike() {}, strike() {}, waves: [] },
    vfx: { telegraph() {}, beams: { spawn() {} } }, allies: { list: [] },
    update() {}, later() {}, finish: async () => {}, stats: { kills: 0, damageTaken: 0 },
    ui: {}, resume() { this.state = "play"; this.ui.modalEl.isConnected = false; } };
  const chosen = [], clicked = [];
  function open(kind, offers, { disabled = [], visible = true, exit = true,
    noProgress = false } = {}) {
    const callback = value => {
      chosen.push(value);
      if (!noProgress) run.resume();
    };
    const button = (label, value, isDisabled = false) => ({ textContent: label,
      disabled: isDisabled, click() { clicked.push(value); callback(value); } });
    const method = kind === "itemChoice" ? "showItemChoice" :
      kind === "blessing" ? "showBlessing" : kind === "pact" ? "showPact" : "showLevelUp";
    run.ui[method] = (...args) => {
      const nativeOffers = kind === "blessing" ? args[2] : args[1];
      const nativeCallback = kind === "blessing" ? args[3] : args[2];
      run.state = "modal";
      const cards = nativeOffers.map((value, index) => ({
        textContent: typeof value === "string" ? value : value.kind || "blessing",
        disabled: disabled.includes(index), click() {
          clicked.push(value); nativeCallback(value);
        },
      }));
      const ghost = exit ? button("None (+native gold)", null) : null;
      run.ui.modalEl = { isConnected: true,
        querySelector: selector => selector === ".actions button.ghost" ? ghost : null,
        querySelectorAll: selector => selector === ".cards button.card" && visible ? cards : [] };
    };
    pilot.attachRun(run);
    pilot.plan = { build, metrics: [] };
    app.run = run;
    if (kind === "blessing") run.ui[method](run, "Native blessing", offers, callback);
    else run.ui[method](run, offers, callback);
  }
  function tick(milliseconds = 501) {
    now += milliseconds; pilot.enabled = true; pilot.handleModal();
  }
  return { pilot, app, bridge, run, chosen, clicked, open, tick };
}


for(const enabled of [true,false])test(`native blessing callback uses XP switch ${enabled}`,()=>{
 const h=fixture({modeSettings:{tower:{experienceBlessingPriority:enabled}}});h.run.tower={floor:26};
 const damage={mods:[{stat:'damage',mul:100}]},xp={mods:[{stat:'xpGain',mul:1.01}]};
 h.open('blessing',[damage,xp]);h.tick();
 assert.deepEqual(h.chosen,[damage]);
});
for(const enabled of [true,false])test(`native curse callback overrides manual order only when on ${enabled}`,()=>{
 const h=fixture({modeSettings:{tower:{experienceBlessingPriority:enabled,cursePriority:['hunger','twin']}}});h.run.tower={floor:26};
 const cards=[{id:'hunger'},{id:'twin'}];h.open('pact',cards);h.tick();assert.deepEqual(h.chosen,[cards[enabled?1:0]]);
});
for(const enabled of [true,false])test(`native item choice beats manual tower rank ${enabled}`,()=>{
 const h=fixture({modeSettings:{tower:{experienceBlessingPriority:enabled}}},{towerStrategy:{itemPriorities:['super-damage']}});h.run.tower={floor:26};
 h.bridge.items.set('super-damage',{key:'super-damage',mods:[{stat:'damage',mul:100}]});
 h.bridge.items.set('exp-share',{key:'exp-share',mods:[{stat:'xpGain',mul:1.25}]});
 h.open('itemChoice',['super-damage','exp-share']);h.tick();assert.deepEqual(h.chosen,[enabled?'exp-share':'super-damage']);
});
test('money saving cannot suppress XP stock and XP does not relax explicit budgets',()=>{
 const h=fixture({modeSettings:{tower:{experienceBlessingPriority:true,saveMoneyAfter50:true}}});h.run.tower={floor:52};
 assert.equal(h.pilot.towerMoneyPolicy(h.run).active,true);
 assert.equal(h.pilot.towerExperienceShopAccess(h.run),false);
 h.run.shop={stage:252,stock:[{key:'exp-share',price:100}]};h.run.gold=100;
 h.bridge.items.set('exp-share',{key:'exp-share',mods:[{stat:'xpGain',mul:1.25}]});
 assert.equal(h.pilot.towerExperienceShopAccess(h.run),true);
 h.run.gold=99;assert.equal(h.pilot.towerExperienceShopAccess(h.run),false);
 assert.equal(h.pilot.towerShopRules(h.run,{shop:false,maxSpend:1}).shop,false);
 assert.equal(h.pilot.towerShopRules(h.run,{shop:true,maxSpend:1}).maxSpend,1);
});

function shopFixture(enabled=true,{floor=26,gold=100,price=100,disabled=false,save=true,xp=true}={}) {
 const h=fixture({modeSettings:{tower:{experienceBlessingPriority:enabled,saveMoneyAfter50:save}}});
 h.run.tower={floor};h.run.gold=gold;h.run.chestsBought=0;h.run.shopBuys=[];
 h.bridge.items.set('super-damage',{key:'super-damage',rarity:0,mods:[{stat:'damage',mul:100}]});
 h.bridge.items.set('exp-share',{key:'exp-share',rarity:2,mods:[{stat:'xpGain',mul:1.25}]});
 h.run.shop={stage:200+floor,stock:[{key:'super-damage',price:1},...(xp?[{key:'exp-share',price}]:[])]};
 h.open('itemChoice',[]);
 const purchases=[];let exits=0;
 h.run.ui.showShop=(run,done)=>{
  run.state='modal';const cards=run.shop.stock.map((entry,index)=>({disabled:index===1&&disabled,hidden:false,
   textContent:entry.key,click(){purchases.push(entry.key);run.gold-=entry.price;entry.sold=true;run.resume();}}));
  run.ui.modalEl={isConnected:true,querySelectorAll:s=>s==='.cards button.card'?cards:[],
   querySelector:s=>s==='.shop-exit'?{disabled:false,click(){exits++;run.resume();}}:null};
 };
 h.pilot.observeNativeModals(h.run.ui);h.run.ui.showShop(h.run,()=>{});
 return {...h,purchases,exits:()=>exits};
}
for(const enabled of [true,false])test(`native shop purchase dispatch uses XP preference ${enabled}`,()=>{
 const h=shopFixture(enabled);h.tick();assert.deepEqual(h.purchases,[enabled?'exp-share':'super-damage']);
});
for(const state of ['xp','none','unaffordable','disabled','sold','full'])test(`saving floor native shop ${state}`,()=>{
 const h=shopFixture(true,{floor:52,xp:state!=='none',gold:state==='unaffordable'?99:100,disabled:state==='disabled'});
 if(state==='sold')h.run.shop.stock[1].sold=true;
 if(state==='full')h.run.player.canHold=k=>k!=='exp-share';
 h.tick();assert.deepEqual(h.purchases,state==='xp'?['exp-share']:[]);
 assert.equal(h.pilot.towerMoneyPolicy(h.run).active,true);
});
for(const enabled of [false,true])test('native level-up respects five plan slots with XP '+enabled,()=>{
 const keys=['star-piece-v','exp-candy','super-lure','pp-up','calcium'];
 const h=fixture({modeSettings:{tower:{experienceBlessingPriority:enabled}}},{sourceType:'custom',allowOffPlan:true,vitaminPriority:keys,vitaminRules:keys.map(key=>({key,priority:1}))});
 h.run.tower={floor:30};h.run.player.vitaminSlots=5;
 for(const k of keys.slice(0,4))h.run.player.vitamins.set(k,{level:5,acc:5});
 h.bridge.vitamins.set('cursed',{key:'cursed',stat:'difficulty',per:.12,kind:'mul',extra:[{stat:'xpGain',mul:.06}]});
 h.bridge.vitamins.set('calcium',{key:'calcium',stat:'special',per:.1,kind:'mul'});
 const card=k=>({kind:'newVit',vit:k,key:'v'+k,rarity:1}),target=card('calcium');
 h.open('upgrade',[card('cursed'),target]);h.tick();assert.deepEqual(h.chosen,[target]);
});

for(const forbidden of [false,true])test(`native single item retain respects explicit avoidance ${forbidden}`,()=>{
 const h=fixture({modeSettings:{tower:{experienceBlessingPriority:true}}},forbidden?{avoidItems:['exp-share']}:{});h.run.tower={floor:26};
 h.bridge.items.set('exp-share',{key:'exp-share',mods:[{stat:'xpGain',mul:1.25}]});h.open('itemChoice',[]);const taken=[];
 h.run.ui.showItem=(run,key,done)=>{run.state='modal';const button=take=>({disabled:false,click(){taken.push(take);done(take);run.resume();}});
  run.ui.modalEl={isConnected:true,querySelectorAll:()=>[],querySelector:s=>s==='.actions button.green'?button(true):s==='.actions button.ghost'?button(false):null};};
 h.pilot.observeNativeModals(h.run.ui);h.run.ui.showItem(h.run,'exp-share',()=>{});h.tick();assert.deepEqual(taken,[!forbidden]);
});
