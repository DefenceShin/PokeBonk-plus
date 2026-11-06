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

export function fixture(settings = {}, build = {}, extra = {}) {
  let now = 1000; const timers = [], ackListeners = [], messages = [];
  const document = { body: null, addEventListener() {},
    querySelector: () => null, querySelectorAll: () => [] };
  const sandbox = { document, console, performance: { now: () => now },
    setInterval(fn) { timers.push(fn); }, addEventListener() {}, dispatchEvent() {},
    chrome: { webview: { postMessage(message) { messages.push(message); }, addEventListener(type, callback) { if(type === "message") ackListeners.push(callback); } } },
    KeyboardEvent: class { constructor(type, properties) {
      this.type = type; Object.assign(this, properties);
    } } };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context, { filename: "shipped-choice-audit.bundle.js" });
  context.options = { ...extra, embedded: true, autoStart: false, settings: {
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
    pilot.battleRecorder?.observe(run, pilot, true);
    if (kind === "blessing") run.ui[method](run, "Native blessing", offers, callback);
    else run.ui[method](run, offers, callback);
  }
  function tick(milliseconds = 501) {
    now += milliseconds; pilot.enabled = true; pilot.handleModal();
  }
  return { pilot, app, bridge, run, chosen, clicked, open, tick, messages,
    pulse() { for (const timer of timers) if (String(timer).includes("p.battleRecorder")) timer(); },
    ack(value) { for (const listener of ackListeners) listener({ data: { kind:"battleRecordsAck", ack:value } }); },
    channelCounts() { return { ackListeners:ackListeners.length, heartbeats:timers.filter(t => String(t).includes("p.battleRecorder")).length }; },
    reload(options={}) { context.reloadOptions = { ...context.options, ...options, hotReload:true }; vm.runInContext("installPilot(reloadOptions)", context); }
  };
}

