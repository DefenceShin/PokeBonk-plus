// Real website smoke test in an existing, isolated guest browser profile.
// No credentials are read/exported and no gameplay values or outcomes are set.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, open, unlink } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { prepareGameSource } from "../src/compatibility.mjs";
import {readControllerPackage,browserControllerSource} from "../scripts/controller-sources.mjs";

throw Error("HISTORICAL_LIVE_HARNESS_DISABLED_018: Historical guest update-live is source-only and disabled for every client/account. No flag authorizes its old finish/close cleanup; current validation preserves active runs until native ending/death and confirmed save.");

const root = fileURLToPath(new URL("../", import.meta.url));
const expectedGameHash =
  "e7ca16965476d1c1235e43f3cbe97ca2fa127fd613988b940ead9bfe1a6aad71";
const profileDir = path.join(root, ".test-profile-campaign");
const output = path.join(root, "artifacts/update-live-smoke");
const launchedAt = new Date().toISOString();
const runDir = path.join(output, launchedAt.replace(/[:.]/g, "-"));
await mkdir(runDir, { recursive: true });
const lockPath = path.join(output, "profile.lock");
const lock = await open(lockPath, "wx");
await lock.writeFile(JSON.stringify({ pid: process.pid, launchedAt }));
const hash = (text) => createHash("sha256").update(text).digest("hex");
const controller=await readControllerPackage(),names=controller.manifest.entries.map(row=>row.name);
const sources=names.map(name=>controller.sources.get(name));
const sourceHashes=Object.fromEntries(names.map((name,i)=>[name,hash(sources[i])]));
const revision=controller.revision;
const catalog = JSON.parse(
  await readFile(path.join(root, "data/catalog.json"), "utf8"),
);
const shinyCatalog = JSON.parse(
  await readFile(path.join(root, "data/shiny-catalog.json"), "utf8"),
);
const config = {
  autoStart: false,
  allowGuest: true,
  buyUpgrades: false,
  revision,
  builds: catalog.builds,
  shinyCatalog,
  unlockCatalog: JSON.parse(await readFile(path.join(root,"data/unlock-catalog.json"),"utf8")),
  settings: {
    mode: "map",
    biome: "forest",
    tier: 0,
    characterId: null,
    fps: 60,
    autoRestart: false,
    autoUpgrade: false,
    autoClaim: false,
    pickup: true,
    safeMode: true,
    randomDelay: false,
    shinyUseStone: false,
  },
};
const bundle = `(()=>{if(location.hostname!=='pokebonk.com')return;\n${controller.sharedSource}\ninstallPilot(${JSON.stringify(config)});(()=>{${browserControllerSource(controller.sources.get('player-overlay'))}\ninstallPlayerOverlay(()=>({run:globalThis.__PB_BRIDGE?.app?.run,bridge:globalThis.__PB_BRIDGE}),{});})();(()=>{${browserControllerSource(controller.sources.get('player-convenience'))}\ninstallPlayerConvenience(()=>({run:globalThis.__PB_BRIDGE?.app?.run,bridge:globalThis.__PB_BRIDGE,pilot:globalThis.__PB_PILOT}),{});})();})();`;
const summary = {
  purpose: "live_update_compatibility_smoke",
  launchedAt,
  revision,
  sourceHashes,
  expectedGameHash,
  accountType: null,
  voluntaryQuit: false,
  countsAsCampaignVictory: false,
  passed: false,
  routeReports: [],
  samples: [],
  browserErrors: [],
};
let context,
  page,
  ownRun = false;
async function readState() {
  return page.evaluate(() => {
    const pilot = globalThis.__PB_PILOT;
    const bridge = globalThis.__PB_BRIDGE;
    const app = bridge?.app;
    const run = app?.run;
    return {
      compatibility:
        pilot?.compatibility || globalThis.__PB_COMPATIBILITY || null,
      guest: app?.meta?.account?.guest === true,
      accountPresent: !!app?.meta?.account,
      profileReady: !!app?.meta?.profile?.starter,
      rosterCount: bridge?.roster?.length,
      pending: app?.meta?.hasPending?.(),
      pilotStatus: pilot?.status,
      enabled: pilot?.enabled,
      errors: pilot?.errors?.slice(-4) || [],
      run: run
        ? {
            state: run.state,
            biome: run.biome?.id,
            tier: run.tier,
            time: run.time,
            hp: run.player?.hp,
            maxHp: run.player?.maxHp,
            level: run.player?.level,
            kills: run.stats?.kills,
            position: { x: run.player?.pos?.x, z: run.player?.pos?.z },
            frames: pilot?.frames,
            sent: run.sent,
            victory: run.victory,
            choices:
              pilot?.events?.filter((event) => event.kind === "choice")
                .length || 0,
          }
        : null,
      settlements:
        pilot?.events
          ?.filter((event) => event.kind === "settlement")
          .map(({ saved, victory, time, kills, biome, stardust }) => ({
            saved,
            victory,
            time,
            kills,
            biome,
            stardust,
          })) || [],
    };
  });
}
async function waitState(predicate, message, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const state = await readState();
    if (state.compatibility?.state === "blocked")
      throw new Error(`compatibility_blocked: ${state.compatibility.reason}`);
    if (predicate(state)) return state;
    await delay(200);
  }
  throw new Error(`timeout: ${message}`);
}
async function normalQuit(reason) {
  return page.evaluate(async (reason) => {
    const pilot = globalThis.__PB_PILOT;
    const run = globalThis.__PB_BRIDGE?.app?.run;
    pilot?.stop(reason);
    if (run && run.state !== "over") await run.finish(false, true);
  }, reason);
}
try {
  context = await chromium.launchPersistentContext(profileDir, {
    channel: "chromium",
    headless: true,
    locale: "zh-CN",
    viewport: { width: 1280, height: 900 },
    args: [
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      "--remote-debugging-port=9234",
      "--remote-debugging-address=127.0.0.1",
    ],
  });
  await context.addInitScript({ content: bundle });
  await context.route("https://pokebonk.com/assets/*.js", async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const sourceHash = hash(source);
    const prepared = prepareGameSource(source, { sourceHash });
    if (!prepared.isGame) return route.fulfill({ response });
    summary.routeReports.push(prepared.report);
    summary.observedGameHash = sourceHash;
    return route.fulfill({
      response,
      ...(prepared.ok ? { body: prepared.code } : {}),
    });
  });
  page = context.pages()[0] || (await context.newPage());
  page.on("pageerror", (error) =>
    summary.browserErrors.push(error.message.slice(0, 250)),
  );
  page.on("dialog", (dialog) => {
    if (dialog.type() === "beforeunload") dialog.accept().catch(() => {});
  });
  await page.goto("https://pokebonk.com/?lang=zh", {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });
  const boot = await waitState(
    (state) => state.compatibility?.state === "ready",
    "game bridge",
    120000,
  );
  assert.equal(
    summary.observedGameHash,
    expectedGameHash,
    "the observed official resource must match this update baseline",
  );
  assert.equal(
    boot.guest,
    true,
    "the existing test profile must be a guest; no registered account is permitted",
  );
  assert.equal(
    boot.profileReady,
    true,
    "existing saved guest session is required; do not create or solve a login challenge",
  );
  assert.equal(
    boot.rosterCount,
    79,
    "the live roster is read from the new game module",
  );
  assert.equal(boot.run, null, "never interrupt an existing active match");
  await waitState((state) => !state.pending, "previous guest progress saved");
  summary.accountType = "guest";
  summary.rosterCount = boot.rosterCount;
  summary.bootCompatibility = boot.compatibility;
  ownRun = true;
  assert.equal(
    await page.evaluate(() => __PB_PILOT.start()),
    true,
    "pilot accepts the checked game interface",
  );
  const start = await waitState(
    (state) => state.run?.state === "play",
    "normal game start",
    60000,
  );
  summary.start = start.run;
  console.log(
    JSON.stringify({
      type: "started",
      revision,
      gameHash: summary.observedGameHash,
      rosterCount: boot.rosterCount,
      runDir,
    }),
  );
  const playDeadline = Date.now() + 150000;
  let played = start;
  while (Date.now() < playDeadline) {
    await delay(1000);
    played = await readState();
    summary.samples.push(played.run);
    assert.equal(played.errors.length, 0, "the live pilot must not throw");
    assert.ok(
      played.run && played.run.state !== "over",
      "a natural defeat or early finish fails this smoke test",
    );
    if (
      played.run.time - start.run.time >= 30 &&
      played.run.level > start.run.level
    )
      break;
  }
  assert.ok(
    played.run.time - start.run.time >= 30,
    "at least 30 seconds of native game time elapsed",
  );
  assert.ok(
    played.run.level > start.run.level,
    "natural XP and the original level-up flow advanced the player",
  );
  const moved = Math.max(
    ...summary.samples.map((sample) =>
      Math.hypot(
        sample.position.x - start.run.position.x,
        sample.position.z - start.run.position.z,
      ),
    ),
  );
  assert.ok(moved > 1, "the pilot moved the player through native input");
  assert.ok(
    played.run.kills > 0 && played.run.frames > 0,
    "native combat and controller decisions ran",
  );
  summary.naturalPlay = {
    seconds: played.run.time - start.run.time,
    maxDistanceFromStart: moved,
    end: played.run,
  };
  await page.evaluate(() => __PB_PILOT.stop("更新兼容实测暂停"));
  const paused = await waitState(
    (state) => state.run?.state === "paused",
    "native pause",
  );
  await delay(1000);
  assert.equal(
    (await readState()).run.time,
    paused.run.time,
    "paused game time remains unchanged",
  );
  assert.equal(await page.evaluate(() => __PB_PILOT.start()), true);
  const resumed = await waitState(
    (state) =>
      state.run?.state === "play" && state.run.time > paused.run.time + 2,
    "native resume",
  );
  summary.pauseResume = {
    pausedTime: paused.run.time,
    resumedTime: resumed.run.time,
    passed: true,
  };
  summary.voluntaryQuit = true;
  await normalQuit("更新兼容实测主动退出，非通关");
  const settled = await waitState(
    (state) =>
      state.run?.state === "over" &&
      state.run.sent &&
      !state.pending &&
      state.settlements.some((event) => event.saved),
    "server settlement receipt",
    60000,
  );
  summary.settlement = settled.settlements.findLast((event) => event.saved);
  summary.finalRun = settled.run;
  assert.equal(
    summary.settlement.victory,
    false,
    "the deliberate smoke-test exit is never counted as victory",
  );
  assert.equal(settled.run.victory, false);
  assert.ok(settled.run.hp > 0, "the test exited voluntarily before death");
  assert.equal(settled.errors.length, 0);
  assert.equal(summary.browserErrors.length, 0);
  const finalSources = await Promise.all(
    names.map((name) => readFile(path.join(root, `src/${name}.mjs`), "utf8")),
  );
  summary.sourcesUnchanged = finalSources.every(
    (text, index) => hash(text) === sourceHashes[names[index]],
  );
  assert.equal(
    summary.sourcesUnchanged,
    true,
    "all controller sources stay frozen during this invocation",
  );
  summary.passed = true;
  summary.reason = "natural_play_pause_resume_and_voluntary_exit_saved";
} catch (error) {
  summary.reason = String(error.message || error);
  process.exitCode = 1;
} finally {
  if (ownRun && page) {
    const final = await readState().catch(() => null);
    if (final?.run && final.run.state !== "over") {
      summary.cleanupQuit = true;
      await normalQuit("更新兼容测试清理主动退出，非通关").catch(() => {});
      await waitState(
        (state) => state.run?.state === "over" && !state.pending,
        "cleanup settlement",
        30000,
      ).catch(() => {});
    }
  }
  summary.endedAt = new Date().toISOString();
  await context?.close().catch(() => {});
  await lock.close();
  await unlink(lockPath).catch(() => {});
  await writeFile(
    path.join(runDir, "summary.json"),
    JSON.stringify(summary, null, 2),
  );
  await writeFile(
    path.join(output, "latest-summary.json"),
    JSON.stringify(summary, null, 2),
  );
  console.log(
    JSON.stringify({
      type: "finished",
      passed: summary.passed,
      reason: summary.reason,
      voluntaryQuit: summary.voluntaryQuit,
      serverSaved: summary.settlement?.saved || false,
      summary: path.join(runDir, "summary.json"),
    }),
  );
}
