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

test("new upstream cost policy declines negative Choice Band in free native choices", () => {
  const h = fixture();
  const score = scoreOffer({ kind: "item", id: "choice-band" },
    { player: h.run.player, build: {}, purpose: "free" }, h.bridge);
  assert.ok(score < 0, "the current physical benefit cannot help the sole special attack");
  h.open("itemChoice", ["choice-band"]);
  h.tick();
  assert.deepEqual(h.chosen, [null]);
  assert.equal(h.run.state, "play");
});

test("free:false sells even a beneficial optional native item through its normal exit", () => {
  const h = fixture({ interactions: { free: false } });
  h.open("itemChoice", ["leftovers"]);
  h.tick();
  assert.deepEqual(h.chosen, [null]);
});

test("all explicitly avoided optional native items use the legitimate None action", () => {
  const h = fixture({}, { sourceType: "custom", avoidItems: ["leftovers", "choice-band"] });
  h.open("itemChoice", ["leftovers", "choice-band"]);
  h.tick();
  assert.deepEqual(h.chosen, [null]);
});

test("beneficial permitted native item choices still pick the useful card", () => {
  const h = fixture();
  h.open("itemChoice", ["choice-band", "leftovers"]);
  h.tick();
  assert.deepEqual(h.chosen, ["leftovers"]);
});

test("a permitted benefit wins without reviving a higher-value explicitly avoided item", () => {
  const h = fixture({}, { sourceType: "custom", avoidItems: ["leftovers"] });
  h.open("itemChoice", ["leftovers", "oran-berry"]);
  h.tick();
  assert.deepEqual(h.chosen, ["oran-berry"]);
});

test("disabled useful card does not bypass upstream cost rejection", () => {
  const h = fixture();
  h.open("itemChoice", ["leftovers", "choice-band"], { disabled: [0] });
  h.tick();
  assert.deepEqual(h.chosen, [null]);
});

test("missing free item controls recover through the native item callback after the normal wait", () => {
  const h = fixture();
  h.open("itemChoice", ["leftovers"], { visible: false, exit: false });
  h.tick(2601);
  assert.deepEqual(h.chosen, ["leftovers"]);
});

test("free item retries keep the highest-ranked permitted card after a native no-op", () => {
  const h = fixture({}, { sourceType: "custom", avoidItems: ["oran-berry"] });
  h.open("itemChoice", ["leftovers", "choice-band", "oran-berry"], { noProgress: true });
  h.tick();
  h.tick(701);
  h.tick(701);
  assert.ok(h.clicked.length >= 2, "the fixture exercised actual retries, not only waiting ticks");
  assert.ok(h.clicked.every(key => key === "leftovers" || key === null),
    "only a permitted useful card or the native exit can be retried");
});

test('single free item uses pickup button and callback for negative scores; exclusions still sell',()=>{
 for(const visible of [true,false])for(const avoid of [false,true]){
  const h=fixture({},avoid?{avoidItems:['choice-band']}:{});
  h.open('itemChoice',['choice-band'],{visible:false});
  h.pilot.modal.kind='item';h.pilot.modal.offers='choice-band';
  h.pilot.modal.choose=value=>h.chosen.push(value);
  h.run.ui.modalEl.querySelector=selector=>visible&&['.actions button.green','.actions button.ghost'].includes(selector)
   ?{disabled:false,textContent:'native item action',click:()=>h.chosen.push(selector.endsWith('.green'))}:null;
  h.tick(2601);assert.deepEqual(h.chosen,[!avoid]);
 }
});

test('free item retries retain the useful card but recheck a newly added exclusion',()=>{
 const h=fixture();h.open('itemChoice',['leftovers'],{noProgress:true});
 h.tick();h.tick(701);assert(h.clicked.length>=2);assert(h.clicked.every(k=>k==='leftovers'));
 h.pilot.plan.build.avoidItems=['leftovers'];h.tick(701);assert.equal(h.clicked.at(-1),null);
});

test("mandatory upgrades retain a native legal fallback when every recommendation is avoided", () => {
  const h = fixture({}, { sourceType: "custom", allowOffPlan: false,
    avoidMoves: ["tackle"], moveRules: [] });
  const offer = { kind: "newMove", id: 33, rarity: 0 };
  h.open("upgrade", [offer], { exit: false });
  h.tick();
  assert.deepEqual(h.chosen, [offer]);
  assert.equal(h.run.rerolls, 0);
  assert.equal(h.run.skips, 0);
  assert.equal(h.run.state, "play");
});

test("mandatory blessing pages retain their native legal fallback without inventing an exit", () => {
  const h = fixture();
  const offer = { label: "Native negative-only fallback", mods: [{ stat: "armor", add: -5 }] };
  h.open("blessing", [offer], { exit: false });
  h.tick();
  assert.deepEqual(h.chosen, [offer]);
  assert.equal(h.run.state, "play");
});

function towerSearchFixture(settings={}) {
  const h=fixture({autoRestart:false,...settings,finalReplacements:{7:{
    moves:{enabled:true,level:1,targets:['water-gun']},fusion:{refuse:true}}}});
  h.run.tower={floor:1,state:'fight'};h.run.banishes=0;h.run.banished=new Set();h.run.player.moveCap=8;
  h.pilot.controlIdentityScope={app:h.app,meta:h.app.meta,account:h.app.meta.account};
  h.open('upgrade',[{kind:'newMove',id:33,key:'m33',rarity:0}],{exit:false});
  h.pilot.currentVerifiedClears=()=>[];
  h.pilot.observeMenuAvailability=()=>{};
  h.pilot.reviewMenuMaintenance=()=>{};
  h.pilot.handleAppDialogs=()=>false;
  h.pilot.accountWaitReason=()=>null;
  h.pilot.menuProfileScopeCurrent=()=>true;
  h.app.toMenu=()=>{h.app.run=null;};
  return h;
}

function impossibleTowerFixture() {
  const h=towerSearchFixture();
  h.pilot.settings.finalReplacements[7].moves.targets=['tackle'];
  h.run.banished.add('m33');
  h.open('upgrade',[{kind:'upMove',slot:0,rarity:0}],{exit:false});
  return h;
}

for(const rarity of [0,3,4])test(`Star Piece priority survives native no-progress retries at rarity ${rarity}`,()=>{
  const h=fixture({}, {sourceType:'custom',allowOffPlan:true,moves:['water-gun'],vitaminRules:[{key:'star-piece-v',priority:2}]}),
    star={kind:'upVit',vit:'star-piece-v',key:'vstar-piece-v',rarity},
    move={kind:'upMove',slot:0,key:'m55',rarity:0,ups:[{key:'count',value:1}]};
  h.bridge.vitamins.set('star-piece-v',{key:'star-piece-v',stat:'luck',per:10,kind:'add'});
  h.run.player.vitamins.set('star-piece-v',{level:1});
  h.open('upgrade',[move,star],{noProgress:true,exit:false});
  for(let i=0;i<4;i++)h.tick(801);
  assert(h.clicked.length>=3);
  assert(h.clicked.every(offer=>offer===star),JSON.stringify({clicked:h.clicked,trace:h.pilot.choiceTrace?.map(t=>t.decision)}));
});

test('Tower finishes only after rechecking a directly observed permanent target exclusion',async()=>{
  const h=impossibleTowerFixture(),calls=[];
  h.run.finish=async(...args)=>{calls.push(args);h.run.state='over';};
  h.tick();assert.equal(h.pilot.enabled,true);assert.equal(calls.length,0);
  assert.equal(h.pilot.towerChoiceRestart?.proof?.confirmed,true);
  await h.pilot.macro();assert.deepEqual(calls,[[false,true]]);
  await h.pilot.macro();assert.equal(calls.length,1);
});

for(const change of ['banish','target','stop','account','run','page','terrain','settings']) {
  test(`Tower permanent-exclusion intent is cancelled when ${change} changes before dispatch`,async()=>{
    const h=impossibleTowerFixture();let finishes=0;h.run.finish=async()=>{finishes++;};
    h.tick();assert(h.pilot.towerChoiceRestart);
    if(change==='banish')h.run.banished.clear();
    if(change==='target')h.pilot.settings.finalReplacements[7].moves.targets=['water-gun'];
    if(change==='stop')h.pilot.stop();
    if(change==='account')h.app.meta.account={id:'other'};
    if(change==='run')h.app.run=null;
    if(change==='page')h.run.ui.modalEl={isConnected:true,querySelector:()=>null,querySelectorAll:()=>[]};
    if(change==='terrain')h.run.terrain={walkClear:()=>true};
    if(change==='settings')h.pilot.settings={...h.pilot.settings};
    await h.pilot.macro();assert.equal(finishes,0);
  });
}

test('hot replacement rejects legacy queued search-exhaustion restart without proof',async()=>{
  const h=towerSearchFixture();let finishes=0;h.run.finish=async()=>{finishes++;};
  h.pilot.enabled=true;
  h.pilot.towerChoiceRestart={run:h.run,app:h.app,meta:h.app.meta,account:h.app.meta.account,
    epoch:h.pilot.controlEpoch||0,settings:h.pilot.settings,plan:h.pilot.plan,
    modal:h.pilot.modal,root:h.run.ui.modalEl,decide:()=>({action:'restart',reason:'tower-target-search-exhausted'})};
  await h.pilot.macro();assert.equal(finishes,0);assert.equal(h.pilot.towerChoiceRestart,null);
});

test('Tower exhaustion exits without taking off-plan growth',async()=>{
  const h=towerSearchFixture();let finishes=0,starts=0;
  h.app.startRun=async()=>{starts++;return false;};h.run.finish=async()=>finishes++;
  h.tick();assert.equal(h.chosen.length,0);assert.equal(h.run.state,'modal');
  await h.pilot.macro();assert.equal(finishes,1);assert.equal(starts,0);
});

for(const change of ['stop','account','run','page','terrain','settings','counter','target']) {
  test(`Tower exhausted mandatory exit is cancelled after ${change}`,async()=>{
    const h=towerSearchFixture();let finishes=0;h.run.finish=async()=>finishes++;
    h.run.player.moveSlots=1;
    h.tick();assert.equal(h.pilot.enabled,true);assert.equal(h.run.state,'modal');assert.equal(h.chosen.length,0);
    assert.equal(h.pilot.towerChoiceRestart?.searchExhausted,true);
    if(change==='stop')h.pilot.stop();
    if(change==='account')h.app.meta.account={id:'different-isolated-account'};
    if(change==='run')h.app.run=null;
    if(change==='page')h.run.ui.modalEl={isConnected:true,querySelector:()=>null,querySelectorAll:()=>[]};
    if(change==='terrain')h.run.terrain={walkClear:()=>true};
    if(change==='settings')h.pilot.settings={...h.pilot.settings};
    if(change==='counter')h.run.rerolls=1;
    if(change==='target'){h.run.player.moveSlots=2;h.pilot.settings.finalReplacements[7].moves.targets=['tackle'];}
    await h.pilot.macro();assert.equal(finishes,0);
  });
}

// Execute the exact 0.8.34 two-click banish UI rather than recreating its
// confirmation algorithm. Only DOM rendering and native callback are fixtures.
const nativeBytes=await readFile(new URL('../research/update-1.0.1-034-main.min.js',import.meta.url));
assert.equal(createHash('sha256').update(nativeBytes).digest('hex'),'646d9e1caa6e0618dbcb7b405bc06052549a08a99b528e3344b0898ee6575088');
const nativeText=nativeBytes.toString('utf8'),uiStart=nativeText.indexOf('showLevelUp(e,t,n){'),uiEnd=nativeText.indexOf('buildMini(e){',uiStart);
assert.ok(uiStart>=0&&uiEnd>uiStart);
function node(tag,attrs={},...children) {
  const classes=new Set((attrs.class||'').split(' '));
  const value={tag,children,style:{},disabled:false,isConnected:true,textContent:tag,
    classList:{contains:k=>classes.has(k),toggle(k,on){on?classes.add(k):classes.delete(k);}},
    append(...rows){this.children.push(...rows);},click(){if(!this.disabled)attrs.onclick?.();},
    querySelectorAll(selector){
      const tokens=selector.split(' '),matches=(n,token)=>{const [tag,...cs]=token.split('.');return (!tag||n.tag===tag)&&cs.every(c=>n.classList?.contains(c));};
      const walk=(n,parts)=>n.children?.flatMap(child=>typeof child!=='object'||!child?[]:
        [...(matches(child,parts[0])?(parts.length===1?[child]:walk(child,parts.slice(1))):[]),...walk(child,parts)])||[];
      return walk(this,tokens);
    },querySelector(selector){return this.querySelectorAll(selector)[0]||null;}};
  return value;
}
test('Tower banish clicks the actual native confirmation and never acquires the rejected skill',()=>{
  const h=towerSearchFixture(),taken=[];h.run.banishes=1;
  const nativeUI=vm.runInNewContext(`({${nativeText.slice(uiStart,uiEnd)}}).showLevelUp`,{
    X:node,Z:()=>null,c:text=>text,KI:()=>null,$:n=>{n.children=[];return n;},Wb:()=>({title:'fixture'}),
    sO:()=>null,addEventListener(){},removeEventListener(){},GI(){},lO(){}});
  // The existing shared UI wrapper dispatches the replacement native method.
  const ui={showLevelUp:nativeUI,buildMini:()=>null,
    offerCard:(r,offer,index,click)=>node('button',{class:'card',onclick:click}),
    modal(...children){h.run.state='modal';return this.modalEl=node('section',{},...children);}};
  h.run.ui=ui;h.pilot.attachRun(h.run);
  ui.showLevelUp(h.run,[{kind:'newMove',id:33,key:'m33',rarity:0}],(offer,action)=>{
    taken.push(action);if(action==='banish'){h.run.banishes--;h.run.banished.add(offer.key);}h.run.resume();
  });
  h.tick();assert.deepEqual(taken,['banish']);assert.equal(h.run.banishes,0);assert.equal(h.run.banished.has('m33'),true);
  assert.equal(h.run.player.moves.length,1);assert.equal(h.pilot.towerChoiceRestart,null);
});

function nativeCurseFixture(floor, ids) {
  const h=fixture(),start=nativeText.indexOf('ST=(e,t,n,r,i,a,o)=>'),end=nativeText.indexOf(',wT=',start),
    pactStart=nativeText.indexOf('showPact(e,t,n){'),pactEnd=nativeText.indexOf('showTrade(e,t,n){',pactStart),
    pickStart=nativeText.indexOf('pickCurse(e){'),pickEnd=nativeText.indexOf('trickOrTreat(e){',pickStart);
  assert.ok(start>=0&&end>start&&pactStart>=0&&pactEnd>pactStart&&pickStart>=0&&pickEnd>pickStart);
  const definitions=vm.runInNewContext(`(()=>{let ${nativeText.slice(start,end)};return CT;})()`,
    {c:text=>text,OS(){throw Error('forbidden grave reward must not execute');}});
  const offers=ids.map(id=>definitions.find(row=>row.id===id));assert.ok(offers.every(Boolean));
  const native=vm.runInNewContext(`({${nativeText.slice(pactStart,pactEnd)},${nativeText.slice(pickStart,pickEnd)}})`,
    {X:node,Q:()=>null,c:text=>text,PN:()=>null,Ys:()=>'',VI:()=>0,
      setTimeout(){},addEventListener(){},removeEventListener(){},CT:offers,F:{shuffle:list=>list}});
  let climbs=0,recomputes=0;
  h.run.tower={floor,curses:[],floorCurse:null,afterClimb:[],run:h.run};h.run.tempMods=[];
  h.run.player.recompute=()=>recomputes++;
  h.run.ui={showPact:native.showPact,hideModal(){this.modalEl.isConnected=false;},
    modal(...children){h.run.state='modal';return this.modalEl=node('section',{},...children);}};
  h.app.run=h.run;h.pilot.attachRun(h.run);
  native.pickCurse.call(h.run.tower,()=>{climbs++;h.run.tower.floor++;});
  return {...h,counts:()=>({climbs,recomputes})};
}

test('actual native curse page grants hunger before and after floor67',()=>{
  for(const floor of [7,38,49,50,64,65,66,67]) {
    const h=nativeCurseFixture(floor,['iron','hunger']);
    assert.equal(h.run.tower.floor,floor,'pact is displayed before climbing');
    h.tick();h.tick();
    assert.equal(h.run.tower.floor,floor+1);assert.equal(h.counts().climbs,1);
    assert.equal(h.run.state,'play');
    assert.equal(h.run.tower.floorCurse,'hunger');
    assert.deepEqual([...h.run.tower.curses],['hunger']);
    assert.equal(h.run.tempMods.length,1);
    assert.deepEqual(JSON.parse(JSON.stringify(h.run.tempMods[0])),{stat:'damage',mul:1.2});
    assert.equal(h.run.tower.afterClimb.length,0,'lower priority iron reward must not also execute');
  }
});

test('actual curse page accepts swift and twin without the discarded speed or ghost restrictions',()=>{
  for(const [id,stat,mul] of [['swift','moveSpeed',1.1],['twin','xpGain',1.2]]) {
    const h=nativeCurseFixture(20,[id]);h.run.player.stats.moveSpeed=9;
    h.tick();assert.equal(h.run.tower.floorCurse,id);
    assert.deepEqual(JSON.parse(JSON.stringify(h.run.tempMods)),[{stat,mul}]);
    assert.equal(h.counts().climbs,1);
  }
});

test('curse dispatch preserves disabled checks and upstream cost choices outside Tower',()=>{
  const h=nativeCurseFixture(20,['hunger','iron']);
  h.run.ui.modalEl.querySelectorAll('.cards button.card')[0].disabled=true;
  h.tick();assert.equal(h.run.tower.floorCurse,null);assert.equal(h.run.tower.afterClimb.length,0);
  const outside=fixture();outside.open('pact',[{id:'hunger'},{id:'iron'}]);outside.tick();
  assert.deepEqual(outside.chosen,[{id:'iron'}]);
});

test('shipped pact handler supplies live economy, item catalog and interaction budgets to graves ranking',()=>{
  for(const [gold,interactions,wanted] of [[0,{},'graves'],[1e7,{},'dark'],[0,{paid:false},'dark'],[0,{totalBudget:0},'dark']]) {
    const h=fixture({mode:'tower',interactions});
    h.bridge.items=new Map([['expert-belt',{key:'expert-belt',rarity:1,max:10,mods:[{stat:'damage',mul:1.2}]}]]);
    Object.assign(h.run,{tower:{floor:20},chestsBought:0,shopBuys:[],gold,stage:4,banished:new Set()});
    h.run.player.stats.luck=100;h.run.meta=h.app.meta;h.app.meta.itemInPool=()=>true;
    h.open('pact',[{id:'dark'},{id:'graves'}]);h.tick();
    assert.equal(h.chosen[0]?.id,wanted,JSON.stringify({gold,interactions}));
    assert.equal(h.run.gold,gold,'forecast must not spend live gold');
    assert.equal(h.run.chestsBought,0,'forecast must not open live balls');
  }
});

test('delayed curse action rechecks the destination floor and discards stale native pages',()=>{
  const h=nativeCurseFixture(65,['hunger','iron']);
  h.pilot.settings.randomDelay=true;h.pilot.settings.randomDelayMinMs=1000;h.pilot.settings.randomDelayMaxMs=1000;
  h.tick(1);assert.equal(h.counts().climbs,0);
  h.run.tower.floor=66;h.tick(1100);h.tick(1100);
  assert.equal(h.counts().climbs,1);assert.equal(h.run.tower.floor,67);assert.equal(h.run.tempMods.length,1);
  const stale=nativeCurseFixture(20,['hunger','iron']);
  stale.run.ui.modalEl=node('section');stale.tick();
  assert.equal(stale.counts().climbs,0);assert.equal(stale.run.tempMods.length,0);
});

test('shipped pact handler evaluates iron against target-floor work and remaining time',()=>{
  for(const [time,wanted] of [[600,'iron'],[21599,null]]) {
    const h=fixture({mode:'tower'});
    h.bridge.data.get=()=>({id:94,bst:500,types:['ghost'],name:'Fixture'});
    h.bridge.items=new Map([['expert-belt',{key:'expert-belt',rarity:3,max:10,mods:[{stat:'damage',mul:1.2}]}]]);
    Object.assign(h.run,{tower:{floor:69},time,stage:4,tier:0,diff:{enemyAmount:1},
      combat:{meter:{dps:1e16}},banished:new Set(),tempMods:[],meta:h.app.meta,
      dpsLog:{times:[time-15,time],rows:[{'water-gun':0,'#other':0},{'water-gun':1e10,'#other':0}]}});
    Object.assign(h.run.player.stats,{damage:1,difficulty:1,enemyAmount:1,eliteSpawn:1,luck:100});
    h.app.meta.itemInPool=()=>true;
    h.open('pact',[{id:'iron'}]);h.tick();
    assert.equal(h.chosen[0]?.id??null,wanted);
    assert.equal(h.run.time,time);assert.equal(h.run.tower.floor,69);
  }
});

function towerOfferedFusionFixture(threshold = 1) {
  const build={sourceType:'custom',moves:['swords-dance'],moveRules:[{key:'swords-dance',priority:1}],
    vitaminRules:[{key:'super-lure',priority:1}],allowOffPlan:true};
  const h=fixture({mode:'tower',finalReplacements:{7:{fusion:{enabled:true,level:threshold,targets:['fu-t-normal']}}}},build);
  const defs=[
    {id:11,key:'vice-grip',type:'normal',arch:'strike',cls:'physical',dmg:20,cd:1},
    {id:132,key:'constrict',type:'normal',arch:'strike',cls:'physical',dmg:10,cd:1},
    {id:21,key:'slam',type:'normal',arch:'strike',cls:'physical',dmg:30,cd:1},
    {id:14,key:'swords-dance',type:'normal',arch:'buff',cls:'special',dmg:0,cd:7.4},
    {id:50001,key:'fu-t-normal',type:'normal',arch:'fusion',cls:'physical',dmg:90,cd:3},
  ];
  h.bridge.moves=new Map(defs.map(d=>[d.id,d]));h.bridge.movesByKey=new Map(defs.map(d=>[d.key,d]));
  h.bridge.data.moves=h.bridge.moves;h.bridge.data.movesByKey=h.bridge.movesByKey;
  h.bridge.moveDef=id=>h.bridge.moves.get(id)||h.bridge.movesByKey.get(id);
  h.bridge.moveGuide=()=>({kit:defs.filter(d=>d.arch!=='fusion').map(d=>({id:d.id,level:1,open:true})),line:[],shared:[]});
  h.bridge.fusionRecipes=[{id:50001,key:'fu-t-normal',kind:'type',type:'normal',cls:'physical'}];
  h.bridge.fusionFor=(a,b)=>a.id!==b.id&&[a,b].every(d=>d.arch==='strike'&&d.type==='normal')?h.bridge.fusionRecipes[0]:null;
  h.bridge.vitamins=new Map([['super-lure',{key:'super-lure',stat:'eliteDamage',per:.05,kind:'mul'}]]);
  Object.assign(h.run.player,{level:55,moveSlots:4,moveCap:12,vitCap:12,capOf:()=>12,
    moves:[{def:defs[0],level:8,mods:{}},{def:defs[3],level:1,mods:{}},null,null],
    vitamins:new Map([['super-lure',{level:1}]])});
  h.run.tower={floor:6,roof:false};h.run.banished=new Set();h.run.banishes=0;h.run.skips=3;h.run.rerolls=8;
  const slam={kind:'newMove',id:21,key:'m21',rarity:0},vit={kind:'upVit',vit:'super-lure',key:'vsuper-lure',rarity:4};
  return {...h,defs,slam,vit};
}

test('shipped Tower choice takes an offered equivalent fusion parent but lets high quality vitamins beat its upgrades',()=>{
  const h=towerOfferedFusionFixture();
  assert.ok(h.pilot.finalReplacement(h.run).fusion.pending.parents.includes('constrict'));
  h.open('upgrade',[h.vit,h.slam]);h.tick();assert.equal(h.chosen[0],h.slam);
  h.run.player.moves[2]={def:h.defs[2],level:1,mods:{}};
  assert.ok(h.pilot.finalReplacement(h.run).fusion.pending.parents.includes('slam'));
  const upgrade={kind:'upMove',slot:2,key:'m21',rarity:0,ups:[{key:'dmg',value:.1}]};
  h.open('upgrade',[h.vit,upgrade]);h.tick();assert.equal(h.chosen[1],h.vit);
  h.run.player.moves[2].level=8;
  assert.equal(h.pilot.finalReplacement(h.run).needsFusion,true,'8 is sufficient even with cap 12');
});

test('shipped Tower offer evidence is refreshed per page and excludes disabled cards',()=>{
  const h=towerOfferedFusionFixture();
  h.open('upgrade',[h.vit,h.slam],{disabled:[1]});h.tick();assert.equal(h.chosen[0],null,'native skip preserves the disabled material for a later search');
  h.open('upgrade',[h.vit,h.slam]);h.tick();assert.equal(h.chosen[1],h.slam);
});

test('shipped Tower prepares the offered fusion route before the configured machine threshold',()=>{
  const h=towerOfferedFusionFixture(100);
  h.open('upgrade',[h.vit,h.slam]);h.tick();assert.equal(h.chosen[0],h.slam);
  assert.equal(h.pilot.finalReplacement(h.run).fusion.active,false);
});

test('offered alternatives do not abandon a learned parent and buffs never become fusion materials',()=>{
  const h=towerOfferedFusionFixture();
  h.run.player.moves[2]={def:h.defs[1],level:2,mods:{}};
  h.open('upgrade',[h.vit,h.slam]);h.tick();assert.equal(h.chosen[0],h.vit);
  h.run.player.moves[2]=null;h.run.player.moves[1].level=8;
  const final=h.pilot.finalReplacement(h.run);
  assert.equal(final.needsFusion,false);
  assert.equal(final.fusion.pending.parents.includes('swords-dance'),false);
});

test('Tower strict fusion targets also accept the currently offered equivalent material',()=>{
 const h=towerOfferedFusionFixture();
 h.pilot.settings.finalReplacements[7].strictMoves={enabled:true,targets:['fu-t-normal','swords-dance']};
 h.open('upgrade',[h.vit,h.slam]);h.tick();assert.equal(h.chosen[0],h.slam);
});

test('offered Tower material cannot steal the unique parent of another configured fusion',()=>{
 const h=towerOfferedFusionFixture(),other={id:50002,key:'other-fusion',type:'water',arch:'fusion',cls:'special',dmg:90,cd:3},
   water={...waterGun};
 for(const def of [other,water]){h.bridge.moves.set(def.id,def);h.bridge.movesByKey.set(def.key,def);}
 h.defs.push(other,water);
 const original=h.bridge.fusionFor,recipe={key:other.key,id:other.id,kind:'signature',moves:['slam','water-gun']};
 h.bridge.fusionRecipes.push(recipe);
 h.bridge.fusionFor=(a,b)=>[a.id,b.id].sort((x,y)=>x-y).join(',')==='21,55'?recipe:original(a,b);
 h.pilot.settings.finalReplacements[7].moves.targets[1]=other.key;
 h.open('upgrade',[h.vit,h.slam]);h.tick();assert.equal(h.chosen[0],h.slam,'learn it for its own later fusion');
 const assignments=h.pilot.finalReplacement(h.run).fusion.assignments;
 assert.equal(assignments.length,2);assert.ok(assignments.find(pair=>pair.key==='fu-t-normal').parents.includes('constrict')); 
 assert.ok(assignments.find(pair=>pair.key===other.key).parents.includes('slam')); 
});


test('native ball retries ignore numeric priority and retain useful item',()=>{
  const h=fixture({}, {sourceType:'custom',itemRules:[{key:'choice-band',priority:0},{key:'leftovers',priority:1}]});
  h.open('itemChoice',['leftovers','choice-band'],{noProgress:true});
  h.tick();h.tick(701);h.tick(701);
  assert.ok(h.clicked.length>=2);assert.ok(h.clicked.every(key=>key==='leftovers'));
});

test('native ball disabled low-priority card remains excluded from callback recovery',()=>{
  const h=fixture({}, {itemRules:[{key:'choice-band',priority:0},{key:'leftovers',priority:1}]});
  h.open('itemChoice',['choice-band','leftovers'],{disabled:[0]});h.tick(2601);
  assert.deepEqual(h.chosen,['leftovers']);
});

test('shop ignores numeric priority and preserves affordability',()=>{
  for(const price of [10,110]) {
    const h=fixture({}, {itemRules:[{key:'choice-band',priority:0},{key:'leftovers',priority:1}]});
    h.run.gold=100;h.run.shop={stock:[{key:'leftovers',price:10},{key:'choice-band',price}]};
    h.open('itemChoice',['leftovers','choice-band']);h.pilot.modal.kind='shop';h.tick();
    assert.deepEqual(h.chosen,['leftovers']);
  }
});

test('copy channel ignores numeric item priority',()=>{
  const h=fixture({}, {itemRules:[{key:'choice-band',priority:0},{key:'leftovers',priority:1}]});
  h.run.player.items=new Map([['leftovers',1],['choice-band',1]]);
  h.open('itemChoice',['leftovers','choice-band']);h.pilot.modal.kind='ditto';h.tick();
  assert.deepEqual(h.chosen,['leftovers']);
});

for(const channel of ['shop','ditto','itemChoice'])test(`item ${channel} rechecks holdings at the dispatch boundary`,()=>{
 const h=fixture({}, {itemRules:[{key:'choice-band',priority:0},{key:'leftovers',priority:1}]});
 h.run.gold=100;h.run.shop={stock:[{key:'choice-band',price:10},{key:'leftovers',price:10}]};
 h.run.player.items=new Map([['choice-band',1],['leftovers',1]]);
 h.open('itemChoice',['choice-band','leftovers']);h.pilot.modal.kind=channel;
 const original=h.pilot.modalAction.bind(h.pilot);
 h.pilot.modalAction=(modal,root,callback,...args)=>original(modal,root,()=>{
   h.run.player.items.set('choice-band',5);callback();
 },...args);
 h.tick();assert.equal(h.chosen.includes('choice-band'),false);
});

for(const change of ['disabled','plan'])test(`copy callback rechecks ${change} immediately before dispatch`,()=>{
 const h=fixture({}, {itemRules:[{key:'choice-band',priority:0},{key:'leftovers',priority:1}]});
 h.run.player.items=new Map([['choice-band',1],['leftovers',1]]);
 h.open('itemChoice',['choice-band','leftovers'],{visible:false});h.pilot.modal.kind='ditto';
 const original=h.pilot.modalAction.bind(h.pilot);
 h.pilot.modalAction=(modal,root,callback,...args)=>original(modal,root,()=>{
   if(change==='disabled')h.pilot.settings.interactions={free:false,copy:false};
   else h.pilot.plan.build={avoidItems:['choice-band']};
   callback();
 },...args);
 h.tick(2601);assert.equal(h.chosen.includes('choice-band'),false);
});

for(const visible of [true,false])for(const change of ['disabled','plan'])test(`ball dispatch rechecks ${change} with visible cards=${visible}`,()=>{
 const h=fixture({}, {itemRules:[{key:'choice-band',priority:0},{key:'leftovers',priority:1}]});
 h.open('itemChoice',['choice-band','leftovers'],{visible});
 const original=h.pilot.modalAction.bind(h.pilot);
 h.pilot.modalAction=(modal,root,callback,...args)=>original(modal,root,()=>{
  if(change==='disabled')h.pilot.settings.interactions={free:false};
  else h.pilot.plan.build={avoidItems:['choice-band']};
  callback();
 },...args);
 h.tick(2601);assert.equal(h.chosen.includes('choice-band'),false);
});
test('Tower vitamin banish uses native two-click confirmation without acquiring the vitamin',()=>{
  const h=towerSearchFixture(),taken=[];h.run.banishes=1;h.bridge.vitamins.set('protein',{key:'protein',stat:'physical',per:.1,kind:'mul'});
  h.pilot.settings.finalReplacements[7].vitamins={enabled:true,level:1,targets:['calcium']};h.bridge.vitamins.set('calcium',{key:'calcium',stat:'special',per:.1,kind:'mul'});
  const nativeUI=vm.runInNewContext(`({${nativeText.slice(uiStart,uiEnd)}}).showLevelUp`,{
    X:node,Z:()=>null,c:text=>text,KI:()=>null,$:n=>{n.children=[];return n;},Wb:()=>({title:'fixture'}),
    sO:()=>null,addEventListener(){},removeEventListener(){},GI(){},lO(){}});
  // The existing shared UI wrapper dispatches the replacement native method.
  const ui={showLevelUp:nativeUI,buildMini:()=>null,
    offerCard:(r,offer,index,click)=>node('button',{class:'card',onclick:click}),
    modal(...children){h.run.state='modal';return this.modalEl=node('section',{},...children);}};
  h.run.ui=ui;h.pilot.attachRun(h.run);
  ui.showLevelUp(h.run,[{kind:'newVit',vit:'protein',key:'vprotein',rarity:0}],(offer,action)=>{
    taken.push(action);if(action==='banish'){h.run.banishes--;h.run.banished.add(offer.key);}h.run.resume();
  });
  h.tick();assert.deepEqual(taken,['banish']);assert.equal(h.run.banishes,0);assert.equal(h.run.banished.has('vprotein'),true);
  assert.equal(h.run.player.moves.length,1);assert.equal(h.pilot.towerChoiceRestart,null);
});

for(const progress of [false,true])test(`native reroll retries distinguish progress from stuck callbacks: ${progress}`,()=>{
 const h=towerSearchFixture();h.run.rerolls=10;
 h.open('upgrade',[{kind:'newMove',id:33,key:'m33',rarity:0}],{exit:false,noProgress:true});
 let clicks=0;
 const query=h.run.ui.modalEl.querySelector;
 h.run.ui.modalEl.querySelector=selector=>selector==='.actions button.blue'?{
  disabled:false,textContent:'Reroll',click(){clicks++;if(progress)h.run.rerolls--;}
 }:query(selector);
 for(let i=0;i<3;i++)h.tick(701);
 assert.equal(clicks,3);
 assert.equal(h.pilot.enabled,progress,'only a no-effect callback should suspend assistance');
 assert.equal(h.run.state,'modal');assert.equal(h.run.rerolls,progress?7:10);
});

test('exhausted tower search queues abandonment and rechecks before native finish',async()=>{
 const h=towerSearchFixture();let finishes=0;h.run.finish=async()=>{finishes++;h.run.state='over';};
 h.tick();assert.equal(h.chosen.length,0);assert.equal(finishes,0);
 assert.equal(h.pilot.towerChoiceRestart?.searchExhausted,true);
 await h.pilot.macro();assert.equal(finishes,1);
});
for(const change of ['counter','page','stop'])test(`exhausted search exit rechecks ${change}`,async()=>{
 const h=towerSearchFixture();let finishes=0;h.run.finish=async()=>finishes++;
 h.tick();assert(h.pilot.towerChoiceRestart);
 if(change==='counter')h.run.rerolls=2;
 if(change==='page')h.run.ui.modalEl={isConnected:true};
 if(change==='stop')h.pilot.stop();
 await h.pilot.macro();assert.equal(finishes,0);
});
