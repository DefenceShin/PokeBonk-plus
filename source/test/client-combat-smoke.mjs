// Final-EXE regression using only the current explicitly authorized local test identity.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, copyFile, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
// Historical source only: old cleanup can finish a live run or close its host.
// This guard must precede payload/profile reads, endpoint access and spawning.
throw new Error("HISTORICAL_LIVE_HARNESS_DISABLED_018: This historical combat script cannot run against any client or account. No command-line flag authorizes its old finish/close/fault cleanup. Current validation must preserve active runs until native ending/death and confirmed save.");
const source = path.resolve(process.argv[2] || "dist/0.11.0");
const info = JSON.parse(
  await readFile(path.join(source, "build-info.json"), "utf8"),
);
const output = path.resolve(
  "artifacts/native-combat",
  new Date().toISOString().replace(/[:.]/g, "-"),
);
await mkdir(output, { recursive: true });
assert.ok(process.argv.includes('--dedicated-test-account'),'only the current explicitly authorized dedicated test account is permitted');
assert.ok(!process.argv.some(value=>value.startsWith('--reuse-own-guest')),'old guest profiles may not be reused');
const requestedNativeMoveSlots=process.argv.includes('--three-slots')?3:null;
const manualFirst=process.argv.includes('--manual-first');
const workspace=fileURLToPath(new URL('../',import.meta.url));
const root=path.join(workspace,'artifacts','dedicated-native-client-v2');
const authorizationFile=path.join(root,'data','pilot-test-authorization.json');
for(let ancestor=authorizationFile;ancestor.length>=workspace.length;ancestor=path.dirname(ancestor))
 assert.equal((await lstat(ancestor)).isSymbolicLink(),false,'original authorization/profile paths must not be linked');
const markerInfo=await lstat(authorizationFile);assert.ok(markerInfo.isFile()&&markerInfo.size<=4096);
const authorization=JSON.parse((await readFile(authorizationFile,'utf8')).replace(/^\uFEFF/,''));
assert.equal(authorization.purpose,'user-authorized-dedicated-test');assert.equal(authorization.registered,true);
assert.match(authorization.identityHash,/^[a-f0-9]{64}$/);
const expectedIdentityHash=authorization.identityHash;
// Refuse another live host before any static payload can overwrite its portable directory.
let occupied = false;
try {
  occupied = (await fetch("http://127.0.0.1:9223/json/version")).ok;
} catch {}
assert.ok(!occupied);
await mkdir(root, { recursive: true });
for (const entry of info.payloadFiles) {
  assert.ok(!path.isAbsolute(entry.path)&&!entry.path.split(/[\\/]/).includes('..')&&!/^data(?:[\\/]|$)/i.test(entry.path),'static build payload must not include runtime/account files');
  const target = path.resolve(root, entry.path);
  assert.ok(target.startsWith(root+path.sep),'static payload target must stay in the original client folder');
  for(let ancestor=target;ancestor.length>=root.length;ancestor=path.dirname(ancestor)){
    const entryInfo=await lstat(ancestor).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    assert.ok(!entryInfo?.isSymbolicLink(),'static payload may not follow links');
  }
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(path.join(source, entry.path), target);
}
await copyFile(
  path.join(source, "build-info.json"),
  path.join(root, "build-info.json"),
);
assert.equal(
  createHash("sha256")
    .update(await readFile(path.join(root, "PokeBonk Pilot.exe")))
    .digest("hex"),
  info.sha256,
);
const child = spawn(path.join(root, "PokeBonk Pilot.exe"), ["--diagnostics","--authorized-test-account"], {
  cwd: root,
  windowsHide: true,
  stdio: "ignore",
});
let browser, panel, game;
const summary = {
  version: info.version,
  exeSha256: info.sha256,
  controllerRevision: info.controllerRevision,
  passed: false,
  dedicatedTestAccount: true,
  registeredTestIdentityVerified: false,
  isolatedNewGuest: false,
  reusedOwnGuest: false,
  requestedNativeMoveSlots,
  manualFirstRequested: manualFirst,
  clientDirectory: path.relative('.',root).replaceAll('\\','/'),
  browserCredentialsCopied: false,
  gameRulesModified: false,
  countsAsCampaignVictory: false,
  errors: [],
  samples: [],
};
async function wait(check, message, seconds = 45) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    try {
      if (await check()) return;
    } catch {}
    await delay(250);
  }
  throw Error(message);
}
const cmd = async (action, payload = {}) => {
  await verifyTestOwnership();
  return panel.evaluate(({ action, payload }) => desktop.command(action, payload), {action,payload});
};
// This interval belongs only to the isolated regression. It reads native state
// and public controller telemetry; no method, input, clock, RNG, or game rule is
// intercepted. All deadline comparisons use the page's performance clock.
function installReadonlyObservations() {
  const previous = globalThis.__PB_TEST_OBSERVATIONS;
  previous?.stop?.();
  const observations = {
    observer: "readonly-native-state-50ms",
    pollPeriodMs: 50,
    startedAt: new Date().toISOString(),
    performanceTimeOrigin: performance.timeOrigin,
    cadence: {
      defaults: {
        randomDelay: __PB_PILOT.settings.randomDelay,
        minMs: __PB_PILOT.settings.randomDelayMinMs,
        maxMs: __PB_PILOT.settings.randomDelayMaxMs,
      },
      samples: 0,
      waitingSamples: 0,
      selectionWaitingSamples: 0,
      nativeSelectionCompletions: 0,
      confirmedNativeSelectionCompletions: 0,
      completedCounterStart: __PB_PILOT.cadence.snapshot().completed,
      completedCounterEnd: 0,
      waits: [],
      completions: [],
      maxPollGapMs: 0,
      liveSamples: 0,
      liveFrameAdvances: 0,
      firstLiveFrames: null,
      lastLiveFrames: null,
      firstLiveGameTime: null,
      lastLiveGameTime: null,
    },
    resources: {
      targets: [],
      worldE: [],
      goldChanges: [],
      itemChanges: [],
      usedTransitions: [],
      notes: [
        "Observed input timestamps are not proof that an interaction succeeded.",
        "Only sampled native used/item/gold changes are recorded as outcome evidence; encounter types are not guaranteed.",
      ],
    },
    errors: [],
  };
  globalThis.__PB_TEST_OBSERVATIONS = observations;
  let currentRun = null,
    previousSample = null,
    pending = null,
    lastWorldE = null;
  const targetCounts = new Map(),
    used = new Map();
  const append = (array, value, limit = 80) => {
    if (array.length < limit) array.push(value);
  };
  const itemsOf = (run) =>
    Array.from(run?.player?.items || [], ([key, count]) => [
      String(key),
      Number(count) || 0,
    ]).sort((a, b) => a[0].localeCompare(b[0]));
  const choiceSignature = (run) =>
    JSON.stringify({
      items: itemsOf(run),
      gold: run?.gold,
      moves: (run?.player?.moves || [])
        .filter(Boolean)
        .map((move) => [move.def?.key || move.key || move.id, move.level]),
      vitamins: Array.from(run?.player?.vitamins || [], ([key, value]) => [
        key,
        typeof value === "number" ? value : value?.level,
      ]),
      mods: run?.tempMods?.length,
      skips: run?.skips,
      pendingUps: run?.pendingUps,
    });
  const sample = () => {
    try {
      const pilot = globalThis.__PB_PILOT,
        run = globalThis.__PB_BRIDGE?.app?.run;
      if (!pilot?.cadence) return;
      const now = performance.now(),
        cadence = pilot.cadence.snapshot(),
        stats = observations.cadence;
      const state = run?.state || "menu",
        frames = Number(pilot.frames) || 0,
        gameTime = Number(run?.time) || 0;
      stats.samples++;
      stats.completedCounterEnd = cadence.completed;
      if (previousSample)
        stats.maxPollGapMs = Math.max(
          stats.maxPollGapMs,
          now - previousSample.now,
        );
      if (run !== currentRun) {
        currentRun = run;
        used.clear();
        pending = null;
        previousSample = null;
        lastWorldE = null;
      }
      const nativeSignature = choiceSignature(run);
      if (
        previousSample &&
        cadence.completed > previousSample.completed &&
        pending
      ) {
        const nativeChanged =
          state !== pending.nativeState ||
          run?.ui?.modalEl !== pending.root ||
          nativeSignature !== pending.nativeSignature;
        const selection =
          ["modal", "paused"].includes(pending.nativeState) &&
          pending.key === "modal";
        const completion = {
          id: pending.id,
          key: pending.key,
          modalKind: pending.modalKind,
          nativeStateBefore: pending.nativeState,
          nativeStateAfter: state,
          delayMs: pending.delayMs,
          deadlineMs: pending.deadline,
          waitFirstObservedMs: pending.firstObserved,
          earliestPossibleCompletionMs: previousSample.now,
          latestPossibleCompletionMs: now,
          completionWindowMs: now - previousSample.now,
          deadlineWallTime: new Date(
            performance.timeOrigin + pending.deadline,
          ).toISOString(),
          counterDelta: cadence.completed - previousSample.completed,
          nativeChanged,
          framesBefore: pending.frames,
          framesAfter: frames,
        };
        // Native action occurred after the last unchanged completion-counter sample.
        // A <=100 ms lower-bound tolerance accounts only for read-only sampling.
        completion.deadlineBoundConfirmed =
          completion.earliestPossibleCompletionMs >= pending.deadline - 100 &&
          completion.latestPossibleCompletionMs >= pending.deadline - 100;
        completion.confirmedNativeSelection =
          selection &&
          nativeChanged &&
          completion.counterDelta === 1 &&
          completion.deadlineBoundConfirmed &&
          pending.delayMs >= 600 &&
          pending.delayMs <= 1800;
        append(stats.completions, completion, 40);
        if (selection && nativeChanged) stats.nativeSelectionCompletions++;
        if (completion.confirmedNativeSelection)
          stats.confirmedNativeSelectionCompletions++;
        pending = null;
      }
      if (cadence.state === "waiting" || cadence.state === "ready") {
        const id = `${cadence.key}:${cadence.startedAt}:${cadence.deadline}`;
        if (!pending || pending.id !== id) {
          pending = {
            id,
            key: cadence.key,
            delayMs: cadence.sampledDelayMs,
            deadline: cadence.deadline,
            firstObserved: now,
            nativeState: state,
            modalKind: pilot.modal?.kind || null,
            root: run?.ui?.modalEl,
            nativeSignature,
            frames,
          };
          append(
            stats.waits,
            {
              id,
              key: pending.key,
              nativeState: state,
              modalKind: pending.modalKind,
              delayMs: pending.delayMs,
              startedMs: cadence.startedAt,
              deadlineMs: cadence.deadline,
              firstObservedMs: now,
            },
            40,
          );
        }
        if (cadence.state === "waiting") {
          stats.waitingSamples++;
          if (["modal", "paused"].includes(state) && cadence.key === "modal")
            stats.selectionWaitingSamples++;
        }
      } else if (cadence.completed === previousSample?.completed)
        pending = null;
      if (state === "play") {
        stats.liveSamples++;
        stats.firstLiveFrames ??= frames;
        stats.firstLiveGameTime ??= gameTime;
        stats.lastLiveFrames = frames;
        stats.lastLiveGameTime = gameTime;
        if (previousSample?.state === "play" && frames > previousSample.frames)
          stats.liveFrameAdvances++;
      }
      if (run) {
        const target = pilot.target,
          entity = target?.entity;
        if (target) {
          const kind =
              entity?.kind ||
              (target.loot
                ? "pickup"
                : target.enemyIndex != null
                  ? "enemy"
                  : "navigation"),
            label = String(target.label || "").slice(0, 120),
            key = `${kind}:${label}`;
          let entry = targetCounts.get(key);
          if (!entry && observations.resources.targets.length < 60) {
            entry = {
              kind,
              label,
              firstObservedGameTime: gameTime,
              lastObservedGameTime: gameTime,
              samples: 0,
            };
            targetCounts.set(key, entry);
            observations.resources.targets.push(entry);
          }
          if (entry) {
            entry.samples++;
            entry.lastObservedGameTime = gameTime;
          }
        }
        const worldE = pilot.lastTap?.get?.(pilot.code("interact"));
        if (Number.isFinite(worldE) && worldE !== lastWorldE) {
          lastWorldE = worldE;
          append(observations.resources.worldE, {
            inputPerformanceMs: worldE,
            observedPerformanceMs: now,
            gameTime,
            state,
            nearestKind: run.interactables?.nearest?.kind || null,
            lastInteractionKind: pilot.lastWorldInteraction?.kind || null,
            targetKind: entity?.kind || null,
            targetLabel: String(target?.label || "").slice(0, 120),
            gold: Number(run.gold) || 0,
          });
        }
        const items = itemsOf(run),
          itemSignature = JSON.stringify(items),
          gold = Number(run.gold) || 0;
        if (previousSample?.runPresent) {
          if (previousSample.gold !== gold)
            append(observations.resources.goldChanges, {
              gameTime,
              state,
              before: previousSample.gold,
              after: gold,
              delta: gold - previousSample.gold,
            });
          if (previousSample.itemSignature !== itemSignature)
            append(observations.resources.itemChanges, {
              gameTime,
              state,
              before: previousSample.items,
              after: items,
            });
        }
        for (const object of run.interactables?.list || []) {
          const key = `${object.kind}:${object.x}:${object.z}`,
            before = used.get(key);
          if (before === false && object.used === true)
            append(observations.resources.usedTransitions, {
              gameTime,
              kind: object.kind,
              x: object.x,
              z: object.z,
              evidence: "native-used-false-to-true",
            });
          used.set(key, object.used === true);
        }
        previousSample = {
          now,
          completed: cadence.completed,
          state,
          frames,
          runPresent: true,
          items,
          itemSignature,
          gold,
        };
      } else
        previousSample = {
          now,
          completed: cadence.completed,
          state,
          frames,
          runPresent: false,
        };
    } catch (error) {
      append(observations.errors, String(error.message || error), 10);
    }
  };
  sample();
  const timer = setInterval(sample, 50);
  observations.stop = () => {
    clearInterval(timer);
    sample();
    observations.stoppedAt = new Date().toISOString();
  };
}
let ownRunStarted=false;
async function verifyTestOwnership(bind=false){
 const observed=await game.evaluate(async({expected,bind})=>{
  const app=globalThis.__PB_BRIDGE?.app,meta=app?.meta,a=meta?.account;
  if(!a||a.guest!==false||!['string','number'].includes(typeof a.id)||!String(a.id)||typeof a.id==='number'&&!Number.isFinite(a.id))return false;
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('pokebonk-dedicated-test:'+String(a.id)));
  const hash=[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
  if(hash!==expected||app.meta!==meta||meta.account!==a||!meta.profile)return false;
  if(bind){
   if(app.run||globalThis.__PB_PILOT?.enabled)return false;
   globalThis.__PB_NATIVE_TEST_OWNERSHIP={app,meta,account:a,run:null,startToken:null,observedEpoch:meta.epoch};
  }
  const o=globalThis.__PB_NATIVE_TEST_OWNERSHIP;
  if(!o||o.app!==app||o.meta!==meta||o.account!==a)return false;
  o.observedEpoch=meta.epoch; // Native send() advances this during legitimate growth.
  return o.run ? o.run===app.run : Boolean(o.startToken)||!app.run;
 },{expected:expectedIdentityHash,bind});
 assert.equal(observed,true,'current native account/run is not the explicitly authorized local test identity');
 return true;
}
async function nativeTicketHash(){
 return game.evaluate(async()=>{
  const id=__PB_BRIDGE.app.meta.ticket?.id;
  if(!id)return null;
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('pokebonk-combat-run:'+String(id)));
  return [...new Uint8Array(bytes)].map(value=>value.toString(16).padStart(2,'0')).join('');
 });
}
async function finishOwnedRun(){
 await verifyTestOwnership();
 return game.evaluate(async()=>{
  const a=globalThis.__PB_BRIDGE?.app,o=globalThis.__PB_NATIVE_TEST_OWNERSHIP;
  if(!o||o.app!==a||o.meta!==a?.meta||o.account!==a.meta.account||!a.meta.profile||!o.run||o.run!==a.run)throw Error('test run ownership changed before cleanup');
  globalThis.__PB_PILOT?.stop('测试正常结束');
  if(a.run&&a.run.state!=='over')await a.run.finish(false,true);
  return {nativeOver:a.run?.state==='over',savedReceipt:globalThis.__PB_PILOT.events.some(e=>e.kind==='settlement'&&e.saved===true&&e.runAt===globalThis.__PB_PILOT.runStartedAt)};
 });
}
async function captureObservations(stop = false) {
  if (!game) return;
  const observations = await game.evaluate((stop) => {
    const value = globalThis.__PB_TEST_OBSERVATIONS;
    if (!value) return null;
    if (stop) value.stop?.();
    return JSON.parse(JSON.stringify(value));
  }, stop);
  if (observations) {
    summary.cadence = observations.cadence;
    summary.cadence.observer = observations.observer;
    summary.cadence.performanceTimeOrigin = observations.performanceTimeOrigin;
    summary.cadence.clock =
      "page-performance.now; wall times use performance.timeOrigin + deadline";
    summary.resources = observations.resources;
    summary.observerErrors = observations.errors;
  }
}
try {
  await wait(async () => {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
      return true;
    } catch {
      return false;
    }
  }, "native endpoint missing");
  await wait(() => {
    const p = browser.contexts().flatMap((c) => c.pages());
    panel = p.find((p) => p.url().startsWith("https://pilot.local/"));
    game = p.find((p) => p.url().startsWith("https://pokebonk.com/"));
    return panel && game;
  }, "native surfaces missing");
  panel.on("pageerror", (e) => summary.errors.push(e.message));
  game.on("pageerror", (e) => summary.errors.push(e.message));
  await wait(
    () =>
      game.evaluate(
        () => globalThis.__PB_PILOT?.compatibility.state === "ready",
      ),
    "game bridge missing",
  );
  const observed = await game.evaluate(() => ({
    gameHash: globalThis.__PB_COMPATIBILITY?.sourceHash,
    gameVersion: globalThis.__PB_COMPATIBILITY?.gameVersion,
  }));
  assert.ok(
    /^[a-f0-9]{64}$/.test(observed.gameHash),
    "record actual loaded game fingerprint",
  );
  summary.gameHash = observed.gameHash;
  summary.gameVersion = observed.gameVersion;
  await wait(()=>game.evaluate(()=>Boolean(__PB_BRIDGE.app.meta.account)),'the current authorized test account must be logged in by its owner; no guest fallback');
  await wait(()=>game.evaluate(()=>Boolean(__PB_BRIDGE.app.meta.profile)),'authorized native profile was not loaded');
  await verifyTestOwnership(true);
  assert.equal(await game.evaluate(()=>Boolean(__PB_BRIDGE.app.meta.profile?.starter)),true,'choose the starter through the native UI before running this test');
  summary.registeredTestIdentityVerified=true;
  const cadenceDefaults = await game.evaluate(() => ({
    randomDelay: __PB_PILOT.settings.randomDelay,
    minMs: __PB_PILOT.settings.randomDelayMinMs,
    maxMs: __PB_PILOT.settings.randomDelayMaxMs,
  }));
  assert.deepEqual(
    cadenceDefaults,
    { randomDelay: true, minMs: 600, maxMs: 1800 },
    "the documented test client must retain its 600..1800 ms operation delay setting",
  );
  await game.evaluate(installReadonlyObservations);
  assert.equal(await game.evaluate(() => __PB_PILOT.settings.capturePriority), true,
    "the current default must enable capture priority without changing native capture rules");
  summary.capturePriority = { defaultEnabled: true, observedCaptureRequired: false,
    note: "A short natural run may not encounter an eligible capture; absence is not successful capture evidence." };
  await cmd("config", {
    mode: "map",
    characterId: 1,
    modeSettings: { map: { biome: "forest", tier: 0 } },
    build: "auto",
    autoRestart: false,
    autoUpgrade: false,
    safeMode: false,
    pickup: true,
    capturePriority: true,
  });
  await verifyTestOwnership();
  const ownStartToken=randomUUID();
  assert.equal(await game.evaluate(token=>{const a=__PB_BRIDGE.app,o=__PB_NATIVE_TEST_OWNERSHIP;if(!o||o.app!==a||o.meta!==a.meta||o.account!==a.meta.account||a.run)return false;o.startToken=token;return true;},ownStartToken),true,'start must be armed only at the owned empty menu');
  if(manualFirst){
    assert.equal(await game.evaluate(()=>__PB_PILOT.enabled),false,'manual-first starts before auxiliary control is enabled');
    await game.evaluate(async token=>{
      const a=__PB_BRIDGE.app,o=__PB_NATIVE_TEST_OWNERSHIP;
      if(!o||o.app!==a||o.meta!==a.meta||o.account!==a.meta.account||a.run||o.startToken!==token)
        throw Error('owned manual native start was cancelled');
      await a.startRun({species:1,biome:'forest',tier:0,mode:'standard',boosts:[]});
    },ownStartToken);
  }else await cmd("start");
  await wait(
    () => game.evaluate(() => __PB_BRIDGE.app.run?.state === "play"),
    "natural run did not start",
  );
  await verifyTestOwnership();
  assert.equal(await game.evaluate(token=>{const a=__PB_BRIDGE.app,o=__PB_NATIVE_TEST_OWNERSHIP;if(!o||o.account!==a.meta.account||o.meta!==a.meta||o.app!==a||!a.run||o.run||o.startToken!==token)return false;o.run=a.run;o.runStartToken=token;o.startToken=null;return true;},ownStartToken),true,'only this accepted start token may bind the new native run');
  ownRunStarted=true;
  if(manualFirst){
    assert.equal(await game.evaluate(()=>__PB_PILOT.enabled),false);
    const manualTime=await game.evaluate(()=>__PB_BRIDGE.app.run.time);
    const ticket=await nativeTicketHash();assert.ok(ticket,'manual native start requires its real server ticket');
    await game.keyboard.down('w');
    try{
      assert.equal(await game.evaluate(()=>__PB_BRIDGE.app.input.raw.has('KeyW')),true,'native manual input before first adoption');
      await delay(120);
    }finally{await game.keyboard.up('w');}
    await wait(()=>game.evaluate(t=>__PB_BRIDGE.app.run.time>t+.5&&!__PB_PILOT.enabled,manualTime),
      'native manually started run must progress before first auxiliary adoption');
    const catalog=await panel.evaluate(()=>desktop.getCatalog());
    const league=await game.evaluate(()=>__PB_BRIDGE.app.meta.profile.league);
    const unowned=catalog.characters.find(character=>!league.includes(Number(character.id)));
    const otherMap=catalog.maps.find(map=>map.id!=='forest'&&map.live!==false);
    assert.ok(unowned&&otherMap,'manual adoption needs a distinct future locked character and different configured map');
    await cmd('config',{characterId:Number(unowned.id),modeSettings:{map:{biome:otherMap.id,tier:0}}});
    assert.equal((await panel.evaluate(()=>desktop.getState())).config.modeSettings.map.biome,otherMap.id,
      'the next-run map must really differ in the current mode settings');
    await cmd('start');
    await wait(()=>game.evaluate(()=>__PB_PILOT.enabled&&__PB_BRIDGE.app.run.state==='play'),
      'first auxiliary adoption was incorrectly blocked by the next-run selection');
    await verifyTestOwnership();
    assert.equal(await nativeTicketHash(),ticket,'manual adoption must retain the original native server ticket');
    const adoption=await game.evaluate(()=>{
      const r=__PB_BRIDGE.app.run,p=__PB_PILOT;
      return {sameOwnedRun:__PB_NATIVE_TEST_OWNERSHIP.run===r,startSpecies:r.startSpecies,
        biome:r.biome.id,tier:r.tier,planSpecies:p.plan.species,planBiome:p.plan.biome,planTier:p.plan.tier,
        currentLoadoutPresent:!!p.plan.currentLoadout,enabled:p.enabled};
    });
    assert.equal(adoption.sameOwnedRun,true);assert.equal(adoption.enabled,true);
    assert.equal(adoption.planSpecies,adoption.startSpecies);assert.equal(adoption.planBiome,adoption.biome);
    assert.equal(adoption.planTier,adoption.tier);assert.equal(adoption.currentLoadoutPresent,true);
    summary.firstManualAdoption={...adoption,nativeStartRunCalled:true,boosts:[],
      nativeManualKeyAccepted:true,nativeTimeAdvancedBeforeAdoption:true,originalTicketHash:ticket,
      ticketRetained:true,nextLockedCharacter:Number(unowned.id),nextDifferentMap:otherMap.id,
      currentRunRecreated:false,gameRulesModified:false};
    await cmd('config',{characterId:1,modeSettings:{map:{biome:'forest',tier:0}}});
  }
  const before = await game.evaluate(() => ({
    time: __PB_BRIDGE.app.run.time,
    level: __PB_BRIDGE.app.run.player.level,
    kills: __PB_BRIDGE.app.run.stats.kills,
    x: __PB_BRIDGE.app.run.player.pos.x,
    z: __PB_BRIDGE.app.run.player.pos.z,
  }));
  summary.growth = {
    scope: "isolated forest tier 0 short natural-play regression",
    countsAsCampaignVictory: false,
    provesFullMapClear: false,
    requirement: {
      minimumNaturalSeconds: 60,
      maximumNaturalSeconds: 90,
      minimumLevel: 2,
      minimumKills: 1,
    },
    start: { gameTime: before.time, level: before.level, kills: before.kills },
    finish: null,
    passed: false,
    note: "Only verifies natural early growth; does not validate complete maps or difficulties.",
  };
  const end = Date.now() + 240000;
  let reached = false;
  while (Date.now() < end) {
    await verifyTestOwnership();
    const sample = await game.evaluate(() => {
      const p = __PB_PILOT,
        r = __PB_BRIDGE.app.run;
      return {
        time: r.time,
        state: r.state,
        hp: r.player.hp,
        maxHp: r.player.maxHp,
        level: r.player.level,
        moveSlots: r.player.moveSlots,
        kills: r.stats.kills,
        items: [...r.player.items],
        vitamins: [...r.player.vitamins].map(([k, v]) => [
          k,
          typeof v === "number" ? v : v?.level,
        ]),
        frames: p.frames,
        modal: p.modal?.kind,
        errors: p.errors,
        position: { x: r.player.pos.x, z: r.player.pos.z },
      };
    });
    summary.samples.push(sample);
    assert.ok([3,4].includes(sample.moveSlots),"record supported actual native capacity without editing slots");
    if(requestedNativeMoveSlots!==null)assert.equal(sample.moveSlots,requestedNativeMoveSlots,"explicit three-slot trial must remain three slots");
    summary.nativeMoveSlots = sample.moveSlots;
    summary.observedNativeMoveSlots=[...new Set([...(summary.observedNativeMoveSlots||[]),sample.moveSlots])];
    summary.growth.finish = {
      gameTime: sample.time,
      naturalSeconds: sample.time - before.time,
      level: sample.level,
      kills: sample.kills,
      hp: sample.hp,
      state: sample.state,
    };
    const growthReady = sample.level >= 2 && sample.kills > 0;
    summary.growth.passed =
      sample.time >= before.time + 60 &&
      growthReady &&
      sample.hp > 0 &&
      sample.state !== "over";
    if (sample.state === "over" || sample.hp <= 0) {
      summary.naturalDefeat = true;
      throw Error(
        "authorized test run died before the short-play regression completed",
      );
    }
    if (sample.time >= before.time + 60) {
      const evidence = await game.evaluate(
        () =>
          globalThis.__PB_TEST_OBSERVATIONS?.cadence
            .confirmedNativeSelectionCompletions || 0,
      );
      if (evidence >= 1 && growthReady) {
        reached = true;
        break;
      }
      if (sample.time >= before.time + 90) {
        const missing = [];
        if (evidence < 1)
          missing.push("no confirmed native safe-page delay completion");
        if (!growthReady)
          missing.push(
            `insufficient natural growth (level ${sample.level}, kills ${sample.kills})`,
          );
        throw Error("90 natural game seconds: " + missing.join("; "));
      }
    }
    await delay(2000);
  }
  assert.ok(
    reached,
    "natural short-play regression did not complete its 60..90-second progression, delay, and growth checks",
  );
  const after = summary.samples.at(-1);
  assert.ok(after.frames > 1000);
  assert.ok(
    after.level >= 2 && after.kills > 0,
    "natural short play must show real growth and at least one kill",
  );
  assert.equal(summary.growth.passed, true);
  summary.naturalPlaySeconds = after.time - before.time;
  summary.moved = Math.hypot(
    after.position.x - before.x,
    after.position.z - before.z,
  );
  await verifyTestOwnership();
  await wait(() => game.evaluate(() => __PB_BRIDGE.app.run?.state === 'play'), 'play boundary before pointer-lock regression');
  // Stopping the helper must hand a live match to the player rather than
  // opening the native pause page. This does not substitute for raw Esc below.
  await cmd("pause");
  const handedOff = await game.evaluate(() => ({
    state: __PB_BRIDGE.app.run.state, time: __PB_BRIDGE.app.run.time,
    enabled: __PB_PILOT.enabled, held: __PB_PILOT.held.size,
    stickX: __PB_BRIDGE.app.input.stickX, stickY: __PB_BRIDGE.app.input.stickY,
    sameOwnedRun: __PB_NATIVE_TEST_OWNERSHIP.run === __PB_BRIDGE.app.run,
  }));
  assert.equal(handedOff.state, "play", "stopping only the helper must not pause native gameplay");
  assert.equal(handedOff.enabled, false); assert.equal(handedOff.held, 0);
  assert.equal(handedOff.stickX, 0); assert.equal(handedOff.stickY, 0);
  assert.equal(handedOff.sameOwnedRun, true);
  await game.keyboard.down("w");
  try {
    assert.equal(await game.evaluate(() => __PB_BRIDGE.app.input.raw.has("KeyW")), true,
      "native manual input must be accepted while helper control is released");
    await delay(120);
  } finally { await game.keyboard.up("w"); }
  await wait(() => game.evaluate(time => __PB_BRIDGE.app.run.time > time + .5 &&
    __PB_BRIDGE.app.run.state !== "paused" && !__PB_PILOT.enabled, handedOff.time),
    "native time did not advance after helper-only stop", 15);
  await cmd("releaseMouse");
  assert.notEqual(await game.evaluate(() => __PB_BRIDGE.app.run.state), "paused",
    "F10/native release must not introduce a pause after manual handover");
  assert.equal((await panel.evaluate(() => desktop.getState())).recovery.wantedRun, false,
    "manual handover must cancel automatic recovery");
  await cmd("resume");
  await wait(() => game.evaluate(() => __PB_PILOT.enabled && __PB_BRIDGE.app.run.state === "play" &&
    __PB_NATIVE_TEST_OWNERSHIP.run === __PB_BRIDGE.app.run), "explicit continuation did not adopt the same live run");
  summary.manualHandover = { helperOnlyStop: true, nativeTimeContinued: true, inputsReleased: true,
    manualNativeKeyAccepted: true, releaseMouseDidNotPause: true, recoveryIntentCancelled: true,
    resumedSameNativeRun: true, nativePauseTestSeparate: true };
  await wait(() => game.evaluate(() => !Number.isFinite(__PB_BRIDGE.app.input.unlockAt) ||
    performance.now() - __PB_BRIDGE.app.input.unlockAt >= 800),
    "wait for the real native unlock cooldown before requesting pointer lock");
  await game.locator('#game').click({position:{x:40,y:40},force:true});
  await wait(() => game.evaluate(() => Boolean(document.pointerLockElement)), 'real native pointer lock was not acquired');
  // Native lockFlicker ignores losses within 700 ms. Wait beyond that real
  // native timestamp so this checks the actual pointer-unlock pause path.
  await wait(() => game.evaluate(() => Boolean(document.pointerLockElement) &&
    Number.isFinite(__PB_BRIDGE.app.input.lockedAt) && performance.now() - __PB_BRIDGE.app.input.lockedAt >= 750), 'native pointer lock did not remain past its 700 ms flicker threshold');
  summary.pointerReleaseSetup = await game.evaluate(() => ({nativeLockAgeBeforeF10Ms:performance.now()-__PB_BRIDGE.app.input.lockedAt,
    nativeLockFlickerThresholdMs:700,actualPointerLocked:Boolean(document.pointerLockElement)}));
  const releaseFrames = await game.evaluate(() => __PB_PILOT.frames);
  await verifyTestOwnership();
  await game.keyboard.press('F10');
  await wait(() => game.evaluate(() => !document.pointerLockElement && __PB_PILOT.enabled && __PB_BRIDGE.app.run?.state === 'play'), 'release hotkey must keep the actual match running');
  await wait(() => game.evaluate(frames => __PB_PILOT.frames > frames + 10 && __PB_BRIDGE.app.run?.state === 'play', releaseFrames), 'combat did not continue after actual pointer unlock');
  summary.pointerReleaseSetup.nativeLockDurationAtReleaseMs = await game.evaluate(() => __PB_BRIDGE.app.input.unlockAt - __PB_BRIDGE.app.input.lockedAt);
  assert.ok(summary.pointerReleaseSetup.nativeLockDurationAtReleaseMs >= 700,'F10 must exercise a real native loss rather than lockFlicker suppression');
  summary.pointerRelease = {actualLockAcquired:true,hotkeyReleased:true,gameplayContinued:true,controllerKeptRunning:true};
  // A raw native pause is different from the controller's pause command.
  // Exercise real key input, without calling run.pause/stop or changing state.
  // F10 intentionally keeps the mouse released; native Escape input works
  // without pointer lock. Do not demand a second, disallowed lock acquisition.
  summary.nativeManualPause = {actualEscapeKeyRequested:true,syntheticPauseCalls:false,countsAsCampaignVictory:false};
  await verifyTestOwnership();
  await game.keyboard.press('Escape');
  await wait(() => game.evaluate(() => __PB_BRIDGE.app.run?.state === 'paused' &&
    __PB_PILOT.enabled === false && __PB_PILOT.pauseRequested === true), 'native Escape pause was automatically resumed or its user intent was not preserved');
  const readNativePause = () => game.evaluate(() => ({state:__PB_BRIDGE.app.run.state,
    time:__PB_BRIDGE.app.run.time,enabled:__PB_PILOT.enabled,pauseRequested:__PB_PILOT.pauseRequested,
    pointerLocked:Boolean(document.pointerLockElement)}));
  const nativePaused = await readNativePause();
  summary.nativeManualPause.afterEscape = nativePaused;
  await delay(2300);
  const heldNativePause = await readNativePause();
  assert.equal(heldNativePause.state,'paused','native pause must survive two host ticks');
  assert.equal(heldNativePause.time,nativePaused.time,'native time must not advance while manually paused');
  assert.equal(heldNativePause.enabled,false);assert.equal(heldNativePause.pauseRequested,true);
  summary.nativeManualPause.afterTwoTicks = heldNativePause;
  await verifyTestOwnership();
  await game.keyboard.press('F10');
  await delay(2300);
  const releasedWhilePaused = await readNativePause();
  assert.equal(releasedWhilePaused.state,'paused','F10 must not resume a native manual pause');
  assert.equal(releasedWhilePaused.time,nativePaused.time,'F10 must not advance a manually paused match');
  assert.equal(releasedWhilePaused.enabled,false);assert.equal(releasedWhilePaused.pauseRequested,true);
  assert.equal(releasedWhilePaused.pointerLocked,false);
  summary.nativeManualPause.afterF10AndTwoTicks = releasedWhilePaused;
  await game.screenshot({path:path.join(output,'native-escape-paused.png')});
  await wait(async()=>/继续挂机/.test(await panel.locator('#main-action-label').innerText()),'panel must expose explicit Continue after a native pause');
  await verifyTestOwnership();
  await panel.locator('#main-action').click();
  await wait(() => game.evaluate(time => __PB_BRIDGE.app.run?.state === 'play' &&
    __PB_BRIDGE.app.run.time > time + 1 && __PB_PILOT.enabled && !__PB_PILOT.pauseRequested,nativePaused.time), 'explicit user Continue did not resume native paused gameplay');
  summary.nativeManualPause.explicitPanelContinue = true;
  summary.nativeManualPause.passed = true;
  await captureObservations();
  assert.deepEqual(summary.cadence.defaults, {
    randomDelay: true,
    minMs: 600,
    maxMs: 1800,
  });
  assert.ok(
    summary.cadence.selectionWaitingSamples > 0,
    "observe an actual native modal/paused page waiting",
  );
  assert.ok(
    summary.cadence.confirmedNativeSelectionCompletions >= 1,
    "observe a native selection change after its real deadline, within 100 ms sampling tolerance",
  );
  assert.ok(
    summary.cadence.liveFrameAdvances > 0 &&
      summary.cadence.lastLiveFrames > summary.cadence.firstLiveFrames + 1000,
    "real combat frames continue between naturally paused selection pages",
  );
  assert.deepEqual(
    summary.observerErrors,
    [],
    "read-only monitor must remain valid for the loaded version",
  );
  await verifyTestOwnership();
  const dialogPause = await cmd("testPauseForPlanFileDialog");
  assert.equal(dialogPause.paused, true);
  await wait(
    () => game.evaluate(() => __PB_BRIDGE.app.run.state === "paused"),
    "file selection pause failed",
  );
  const paused = await game.evaluate(() => __PB_BRIDGE.app.run.time);
  await delay(2000);
  assert.equal(
    await game.evaluate(() => __PB_BRIDGE.app.run.time),
    paused,
    "watchdog must preserve manual pause",
  );
  await cmd("resume");
  await wait(
    () => game.evaluate((t) => __PB_BRIDGE.app.run.time > t + 2, paused),
    "resume failed",
  );
  await finishOwnedRun();
  await wait(
    () =>
      game.evaluate(() =>
        __PB_PILOT.events.some(
          (e) =>
            e.kind === "settlement" &&
            e.saved === true &&
            e.runAt === __PB_PILOT.runStartedAt,
        ),
      ),
    "native saved receipt missing",
    45,
  );
  summary.voluntaryQuit = true;
  summary.settlementSaved = true;
  summary.manualPausePreserved = true;
  summary.fileSelectionPausePreserved = true;
  assert.equal(
    await game.evaluate(() => globalThis.__PB_COMPATIBILITY?.sourceHash),
    summary.gameHash,
    "loaded module remains fixed through the regression",
  );
  summary.observedChoices = await game.evaluate(() =>
    __PB_PILOT.events
      .filter((e) => e.kind === "choice")
      .map((e) => ({ type: e.type, message: e.message })),
  );
  await captureObservations(true);
  await game.screenshot({ path: path.join(output, "game.png") });
  await verifyTestOwnership();
  await cmd("testClose");
  await wait(
    () => child.exitCode !== null,
    "authorized test client did not close normally",
    25,
  );
  assert.equal(child.exitCode,0,"authorized test client must exit normally");
  assert.deepEqual(summary.errors, []);
  summary.passed = true;
} catch (error) {
  summary.reason = error.message;
  throw error;
} finally {
  await captureObservations(true).catch(() => {});
  let mayDisconnect=false;
  if(child.exitCode===null&&game&&panel){
    try{
      await verifyTestOwnership();
      if(ownRunStarted)summary.cleanup=await finishOwnedRun();
      await cmd('testClose');
      mayDisconnect=true;
    }catch(error){summary.cleanupRefused=error.message;summary.manualCloseRequired=true;}
  }else mayDisconnect=child.exitCode!==null;
  // Native testClose owns shutdown. Never send Browser.close, including when
  // a replacement endpoint or unknown account prevents normal cleanup.
  summary.endedAt = new Date().toISOString();
  await writeFile(
    path.join(output, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      passed: summary.passed,
      reason: summary.reason,
      output,
      naturalPlaySeconds: summary.naturalPlaySeconds,
      choices: summary.observedChoices?.length,
      confirmedNativeDelays:
        summary.cadence?.confirmedNativeSelectionCompletions,
      observedWorldE: summary.resources?.worldE.length,
    }),
  );
}
