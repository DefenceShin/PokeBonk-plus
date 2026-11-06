import { chromium } from "playwright";
import { readFile, writeFile, appendFile, mkdir, unlink, lstat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { prepareGameSource } from "../src/compatibility.mjs";
import {readControllerPackage,browserControllerSource} from "../scripts/controller-sources.mjs";

// Only the explicitly authorized dedicated-v2 registered test account is permitted.
// No game values or random outcomes are changed, and credentials are never read.
const root = fileURLToPath(new URL("../", import.meta.url));
const reviewRoot=root,reviewEvidenceArtifacts=new WeakMap();
const args = process.argv.slice(2);
// Preserve the pure public-data self-test, which exits before all live paths.
// Old dedicated-profile gameplay, time-limit finish and context close are
// historical source only; their old authorization flags cannot enable them.
if (!args.includes("--self-test")) throw new Error("HISTORICAL_LIVE_HARNESS_DISABLED_018: Historical campaign gameplay is disabled for every account/client. Only --self-test is available; old finish/close cleanup must not end active runs. Current validation waits for native ending/death and confirmed save.");
const arg = (name, fallback) => args.find((s) => s.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const catalog = JSON.parse(await readFile(path.join(root,"data/catalog.json"),"utf8"));
const campaignBiomes = ordinaryCampaignMaps(catalog);
if (!campaignBiomes.length) throw Error("Missing reviewed live ordinary campaign maps");
const requested = { biome: arg("biome", "forest"), tier: Number(arg("tier", "0")), character: Number(arg("character", "1")) };
const matrixMode = args.includes("--matrix");
const requestedNativeMoveSlots = args.includes("--three-slots") ? 3 : null;
const requestedNativeAim = arg("native-aim", null);
if (requestedNativeAim !== null && !["auto", "manual"].includes(requestedNativeAim)) throw Error("Invalid --native-aim; use auto or manual");
if (requestedNativeAim === "auto" && args.includes("--expert")) throw Error("--native-aim=auto conflicts with --expert native manual settings");
const observedNativeAimModes = new Set();
let nativeAimMismatch = null;
const nativeAimSettings = { requested: requestedNativeAim, state: requestedNativeAim === null ? "not-requested" : "pending", method: "native-settings-ui", serverConfirmed: false };
const observedNativeMoveSlots = new Set();
let nativeMoveSlotsMismatch = null;
const matrix = [0, 1, 2].flatMap((tier) => campaignBiomes.map((biome) => ({ biome, tier, character: requested.character, status: "pending", verifiedThisRun: false })));
let activeAttempt = null, matrixFailure = null;
if (!campaignBiomes.includes(requested.biome) || ![0, 1, 2].includes(requested.tier)) throw Error("Invalid biome/tier");
const seconds = Number(arg("seconds", matrixMode ? "12000" : "1800"));
const maxRuns = Number(arg("runs", matrixMode ? String(matrix.length * 2) : "1"));
if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isInteger(maxRuns) || maxRuns < 1) throw Error("Invalid seconds/runs limit");
const baselineEvidence = "research/update-0.8.0-latest-review.json";
const reviewedBaseline = JSON.parse(await readFile(path.join(root,baselineEvidence),"utf8"));
if (reviewedBaseline.coreContractReady !== true || !/^[a-f0-9]{64}$/.test(reviewedBaseline.sourceHash)) throw Error("Missing reviewed report baseline");
const supportedHash = reviewedBaseline.sourceHash;
const reviewBaselineHashes=[reviewedBaseline.sourceHash,catalog.verification?.mainSha256];
const explicitGameHash = arg("game-hash",null), explicitGameEvidence = arg("game-evidence",null);
if (!!explicitGameHash !== !!explicitGameEvidence) throw Error("--game-hash and --game-evidence must be provided together");
const targetGameHash = explicitGameHash || supportedHash;
if (explicitGameHash && !reviewedTargetEvidence(await publicEvidence(explicitGameEvidence),explicitGameHash))
  throw Error("Target game fingerprint lacks an explicit matching public static review");
// Baseline and target are reporting requirements, not a startup hash allowlist.
// Each actual native match records its own fixed source/revision evidence.
if (args.includes("--self-test")) {
  const assert = (await import("node:assert/strict")).default;
  assert.deepEqual(campaignBiomes,["forest","desert","coast","glacier"]);assert.equal(matrix.length,12);
  assert.deepEqual(legalAttempt({biomes:{forest:2,desert:0}},{biome:"coast",tier:0}),{requested:{biome:"coast",tier:0},biome:"desert",tier:0,kind:"prerequisite"});
  assert.equal(legalAttempt({biomes:{forest:2,desert:2,coast:0}},{biome:"glacier",tier:0}).biome,"coast");
  assert.equal(legalAttempt({biomes:{forest:0}},{biome:"forest",tier:2}).tier,0);
  assert.equal(legalAttempt({biomes:{forest:2,desert:2,coast:2,glacier:2}},{biome:"glacier",tier:2}).kind,"validation");
  assert.deepEqual(ordinaryCampaignMaps({maps:[{id:"forest",live:true},{id:"graveyard",live:true},{id:"event",live:true,mode:"tower"},{id:"future",live:false}]}),["forest"]);
  const reviewChecks=reviewEvidenceSelfTest(assert,reviewedBaseline.sourceHash);
  console.log(JSON.stringify({passed:true,checks:7+reviewChecks,reviewChecks,campaignMaps:campaignBiomes,matrixCells:matrix.length,accountsRead:false,browserStarted:false}));process.exit(0);
}
const debugPort = Number(arg("port", "9225"));
const profileName = arg("profile", "campaign");
if (!/^[a-z0-9-]{1,30}$/.test(profileName)) throw Error("Invalid isolated profile name");
const dedicatedTestAccount = args.includes("--dedicated-test-account");
if (!dedicatedTestAccount || profileName !== "dedicated-v2") throw Error("Only --dedicated-test-account with --profile=dedicated-v2 is authorized for this project");
const artifactDir = path.join(root, "artifacts", profileName);
const profileDir = path.join(root, `.test-profile-${profileName}`);
const authorizationFile = path.join(profileDir, "pilot-test-authorization.json");
let dedicatedAuthorization = null;
if (dedicatedTestAccount) {
  const directory = await lstat(profileDir), marker = await lstat(authorizationFile);
  if (!directory.isDirectory() || directory.isSymbolicLink() || !marker.isFile() || marker.isSymbolicLink())
    throw Error("Dedicated test authorization must be a regular file in the original non-linked test profile");
  const authorization = JSON.parse(await readFile(authorizationFile, "utf8"));
  if (authorization?.purpose !== "user-authorized-dedicated-test" || authorization.registered !== true ||
      typeof authorization.identityHash !== "string" || !/^[a-f0-9]{64}$/.test(authorization.identityHash))
    throw Error("Invalid dedicated test account authorization");
  dedicatedAuthorization = { purpose: authorization.purpose, registered: true, identityHash: authorization.identityHash };
}
let accountAuthorization = { dedicatedTestAccount, state: dedicatedTestAccount ? "pending-native-identity" : "guest-only" };
let observedGameHash = null;
const launchAt = Date.now();
const launchId = new Date(launchAt).toISOString().replace(/[:.]/g, "-");
const runDir = path.join(artifactDir, launchId);
await mkdir(runDir, { recursive: true });
const writeNativeAimEvidence = async () => {
  if (requestedNativeAim !== null) await writeFile(path.join(runDir, "native-aim-settings.json"), JSON.stringify(nativeAimSettings, null, 2) + "\n");
};
await writeNativeAimEvidence();
const shinyCatalog = JSON.parse(await readFile(path.join(root, "data/shiny-catalog.json"), "utf8"));
const unlockCatalog = JSON.parse(await readFile(path.join(root, "data/unlock-catalog.json"), "utf8"));
// Optional comparison flags exercise the existing bounded preparation/looting
// choices; they never change product defaults or native progression rules.
let settings = { mode: "map", biome: "auto", characterId: requested.character, tier: requested.tier, fps: 60, autoRestart: false, autoUpgrade: requestedNativeMoveSlots === 3 ? false : true, autoClaim: true, pickup: true, safeMode: args.includes("--safe"), bossPriority: !args.includes("--prepare-before-boss"), portalPriority: !args.includes("--loot-before-exit"), shinyPriority: true, expertMode: args.includes("--expert"), randomDelay: false };
let revision, sourceHashes;
async function makeBundle(hotReload = false) {
  const controller=await readControllerPackage(), names=controller.manifest.entries.map(row=>row.name);
  const sources=names.map(name=>controller.sources.get(name));
  sourceHashes=Object.fromEntries(names.map((name,i)=>[name,createHash('sha256').update(sources[i]).digest('hex')]));
  revision=controller.revision;
  if (activeAttempt) { activeAttempt.observedRevisions=[...new Set([...activeAttempt.observedRevisions,revision])]; }
  const config = { autoStart: false, allowGuest: !dedicatedTestAccount, buyUpgrades: true, settings, shinyCatalog, unlockCatalog, builds: catalog.builds, revision, hotReload };
  await appendFile(path.join(runDir, "revisions.jsonl"), JSON.stringify({ at: new Date().toISOString(), revision, hashes: sourceHashes, settings, gameHash: observedGameHash }) + "\n");
  return `(()=>{if(location.hostname!=='pokebonk.com')return;\n${controller.sharedSource}\ninstallPilot(${JSON.stringify(config)});(()=>{${browserControllerSource(controller.sources.get('player-overlay'))}\ninstallPlayerOverlay(()=>({run:globalThis.__PB_BRIDGE?.app?.run,bridge:globalThis.__PB_BRIDGE}),{});})();(()=>{${browserControllerSource(controller.sources.get('player-convenience'))}\ninstallPlayerConvenience(()=>({run:globalThis.__PB_BRIDGE?.app?.run,bridge:globalThis.__PB_BRIDGE,pilot:globalThis.__PB_PILOT}),{});})();})();`;

}
let bundle = await makeBundle();
const context = await chromium.launchPersistentContext(profileDir, {
  channel: "chromium", headless: !args.includes("--headed"), viewport: { width: 1280, height: 900 }, locale: "zh-CN",
  args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", `--remote-debugging-port=${debugPort}`, "--remote-debugging-address=127.0.0.1"],
});
await context.addInitScript({ content: bundle });
let compatibilityError;
await context.route(/^https:\/\/pokebonk\.com\/assets\/[^?#]+\.m?js(?:\?[^#]*)?$/, async (route) => {
  const response = await route.fetch();
  const source = await response.text();
  const hash = createHash("sha256").update(source).digest("hex");
  const prepared = prepareGameSource(source, { sourceHash: hash });
  if (!prepared.isGame) return route.fulfill({ response });
  await writeFile(path.join(runDir, "compatibility.json"), JSON.stringify(prepared.report, null, 2));
  if (!prepared.ok) {
    compatibilityError = prepared.report.reason;
    return route.fulfill({ response });
  }
  observedGameHash = hash;
  if (activeAttempt) activeAttempt.observedGameHashes=[...new Set([...activeAttempt.observedGameHashes,hash])];
  await appendFile(path.join(runDir, "revisions.jsonl"), JSON.stringify({ at: new Date().toISOString(), revision, hashes: sourceHashes, settings, gameHash: hash, compatibility: prepared.report }) + "\n");
  compatibilityError = null;
  return route.fulfill({ response, body: prepared.code });
});
const page = context.pages()[0] || await context.newPage();
let stopping = false, lastSuccessfulTelemetry = null;
const pageDiagnostics = [];
function observePageEvent(kind) {
  const previous = lastSuccessfulTelemetry?.run;
  const event = { at: new Date().toISOString(), kind, expectedDuringShutdown: stopping,
    lastSuccessfulTelemetryAt: lastSuccessfulTelemetry?.at ?? null,
    lastKnownRunOnly: previous ? { state: previous.state, stage: previous.stage, time: previous.time,
      hp: previous.player?.hp, moveSlots: previous.player?.moveSlots } : null };
  pageDiagnostics.push(event);
  appendFile(path.join(runDir, "page-diagnostics.jsonl"), JSON.stringify(event) + "\n").catch(() => {});
}
// These observers record browser events only. They do not synthesize an
// outcome, restore a page, or alter the running game's state.
page.on("crash", () => observePageEvent("crash"));
page.on("close", () => observePageEvent("close"));
page.on("pageerror", (error) => appendFile(path.join(runDir, "browser-errors.jsonl"), JSON.stringify({ at: Date.now(), message: error.message }) + "\n").catch(() => {}));
page.on("dialog", (dialog) => dialog.type() === "beforeunload" && dialog.accept().catch(() => {}));
await page.goto("https://pokebonk.com/?lang=zh", { waitUntil: "domcontentloaded", timeout: 90000 });
await writeFile(path.join(artifactDir, "active.json"), JSON.stringify({ pid: process.pid, runDir, requested: { ...requested }, requestedNativeMoveSlots, requestedNativeAim, dedicatedTestAccount, matrixMode, profileDir, control: path.join(artifactDir, "control.json"), port: debugPort, launchedAt: new Date(launchAt).toISOString() }, null, 2));
console.log(JSON.stringify({ type: "ready", pid: process.pid, runDir, requested: { ...requested }, requestedNativeMoveSlots, requestedNativeAim, dedicatedTestAccount, matrixMode, control: path.join(artifactDir, "control.json"), debugPort }));
let runCount = 0, lastSample = 0, lastStage = "", lastRunAt = 0, lastOutcome = 0, awaitingStart = false, guestEntryRequested = false;
const outcomes = [], recorded = new Set();
const screenshot = async (name) => page.screenshot({ path: path.join(runDir, name), timeout: 15000 }).catch(() => {});
async function inspectTestAccount() {
  const inspection = await page.evaluate(async ({ dedicated, expectedHash }) => {
    const app = globalThis.__PB_BRIDGE?.app, meta = app?.meta, account = meta?.account;
    const previousAuthorization = globalThis.__CAMPAIGN_ACCOUNT_AUTHORIZATION;
    if (!account) return { state: "not-logged-in", authorized: false, hasRun: Boolean(app?.run) };
    if (!dedicated && account.guest !== true) return { state: "registered-account-not-authorized", authorized: false };
    if (dedicated) {
      if (account.guest !== false) return { state: "dedicated-test-account-not-registered", authorized: false };
      if (!["number", "string"].includes(typeof account.id) || String(account.id).length === 0 ||
          typeof account.id === "number" && !Number.isFinite(account.id))
        return { state: "dedicated-test-account-id-unavailable", authorized: false };
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("pokebonk-dedicated-test:" + String(account.id)));
      const identityHash = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
      if (identityHash !== expectedHash) return { state: "dedicated-test-account-identity-mismatch", authorized: false };
      if (app.meta !== meta || meta.account !== account) return { state: "native-account-changed-during-validation", authorized: false };
    }
    if (!meta.profile) return { state: "native-profile-pending", authorized: false };
    if (previousAuthorization && (previousAuthorization.app !== app || previousAuthorization.meta !== meta || previousAuthorization.account !== account))
      return { state: "native-account-reference-changed", authorized: false };
    const authorization = previousAuthorization || { app, meta, account, dedicated, run: null, startToken: null };
    authorization.observedEpoch = meta.epoch; // Native send() changes epoch during normal growth.
    if (app.run && authorization.run !== app.run && previousAuthorization) {
      if (!authorization.startToken) return { state: "native-run-not-owned-by-this-start", authorized: false };
      authorization.run = app.run; authorization.runStartToken = authorization.startToken; authorization.startToken = null;
    }
    globalThis.__CAMPAIGN_ACCOUNT_AUTHORIZATION = authorization;
    return { state: dedicated ? "authorized-dedicated-test" : "authorized-guest", authorized: true,
      registered: dedicated, hasRun: Boolean(app.run), pilotEnabled: Boolean(globalThis.__PB_PILOT?.enabled) };
  }, { dedicated: dedicatedTestAccount, expectedHash: dedicatedAuthorization?.identityHash ?? null });
  accountAuthorization = { ...inspection, dedicatedTestAccount, checkedAt: new Date().toISOString() };
  return inspection;
}
async function prepareNativeAimThroughUi() {
  if (requestedNativeAim === null || nativeAimSettings.state === "applied") return;
  const inspectMenu = () => page.evaluate(() => {
    const app = globalThis.__PB_BRIDGE?.app, pilot = globalThis.__PB_PILOT;
    const authorization = globalThis.__CAMPAIGN_ACCOUNT_AUTHORIZATION;
    if (!authorization || authorization.app !== app || authorization.meta !== app?.meta ||
        authorization.account !== app.meta.account || !app.meta.profile || app.run || !pilot || pilot.enabled)
      throw Error("native aim UI requires an authorized test account at the initial menu, without a run or enabled controller");
    const source = app.meta.profile.settings;
    return Object.fromEntries(["aimMode", "fov", "camDist", "autoUlt", "ultPose", "ultQuiet", "quality", "sensitivity", "invertY"]
      .filter(key => ["string", "number", "boolean"].includes(typeof source?.[key])).map(key => [key, source[key]]));
  });
  const clickNative = async (control, step) => {
    await inspectMenu();
    const restoredTitle = /^(?:我们找回了你的上一局|我们已找回你的上一局|已找回你的上一局|已恢复你的上一局|你的上一局已保存|上一局已保存|Hemos recuperado tu última partida|Tu partida anterior se ha guardado|We(?:'|’)ve recovered your last (?:run|game)|Your (?:previous|last) (?:run|game) has been saved)$/i;
    const acknowledgement = /^(?:知道了|明白|Entendido|Got it|Understood|OK)$/i;
    const records = nativeAimSettings.recoveredRunAcknowledgements ||= [];
    for (;;) {
      const visible = page.locator(".season-modal:visible");
      if (await visible.count() === 0) break;
      if (await visible.count() !== 1) throw Error("multiple native overlays block aim preparation; no automatic confirmation");
      const modal = visible.first();
      const title = (await modal.locator("h2.cl-mh").innerText().catch(() => "")).trim();
      const buttons = modal.locator(".cl-mbtns button");
      const labels = (await buttons.allTextContents()).map(label => label.trim());
      const text = (await modal.innerText()).slice(0, 8000);
      if (!restoredTitle.test(title) || labels.length !== 1 || !acknowledgement.test(labels[0]) ||
        await modal.locator(".cl-mbtns button.green").count() !== 1) {
        nativeAimSettings.blockingModal = { at: new Date().toISOString(), step, title, labels, text, clicked: false };
        await writeNativeAimEvidence();
        throw Error("an unrecognized native overlay blocks aim preparation; it was not acknowledged");
      }
      if (records.length >= 2) throw Error("native recovered-run acknowledgement limit reached");
      await inspectMenu();
      const record = { observedAt: new Date().toISOString(), step, title, text, button: labels[0], clicked: false,
        source: "native-savedCard-ui", countsAsPreviousVictory: false, syntheticSettlementAdded: false };
      records.push(record); await writeNativeAimEvidence();
      // Only the known single-button native savedCard is acknowledged. No
      // force click, DOM removal, season-dialog dismissal or CAPTCHA handling.
      await modal.locator(".cl-mbtns button.green").click({ timeout: 5000 });
      record.clicked = true; record.clickedAt = new Date().toISOString();
      await modal.waitFor({ state: "hidden", timeout: 5000 });
      record.dismissedAt = new Date().toISOString(); await writeNativeAimEvidence();
    }
    await inspectMenu();
    await control.click({ timeout: 15000 });
  };
  try {
    nativeAimSettings.before = await inspectMenu();
    await clickNative(page.locator(".mm-small").getByRole("button", { name: /^(?:设置|設定|Settings|Ajustes)$/i }), "open-settings");
    const settingsScreen = page.locator(".sec.st");
    await settingsScreen.waitFor({ state: "visible", timeout: 15000 });
    await inspectMenu();
    let controls = settingsScreen.locator(".st-tab").filter({ has: page.locator('img[src*="quick-claw"]') });
    if (await controls.count() !== 1) controls = settingsScreen.locator(".st-tab").filter({ hasText: /Controles|Controls|操控|控制|操作/i });
    if (await controls.count() !== 1) throw Error("native controls settings tab is not uniquely identifiable");
    await clickNative(controls, "open-controls");
    const manualLabel = /^(?:手动(?:瞄准)?|手動(?:瞄準)?|Manual(?: aim)?)$/i;
    const autoLabel = /^(?:自动(?:瞄准)?|自動(?:瞄準)?|Auto(?:matic)?(?: aim)?|Automático)$/i;
    const aimRow = settingsScreen.locator(".st-pane .st-row.segrow").filter({ has: page.getByRole("button", { name: manualLabel }) });
    if (await aimRow.count() !== 1 || await aimRow.locator("button.pill").count() !== 2)
      throw Error("native auto/manual aim row changed; no preference was written directly");
    nativeAimSettings.controlLabels = await aimRow.locator("button.pill").allTextContents();
    await inspectMenu();
    // Observe only the native UI's own request metadata. Never read headers,
    // request bodies, response bodies or credentials, and never issue a request.
    const saved = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.hostname === "api.pokebonk.com" && url.pathname === "/profile/prefs" && response.request().method() === "PUT";
    }, { timeout: 12000 }).then(response => ({ status: response.status(), ok: response.ok() }), () => null);
    await clickNative(aimRow.getByRole("button", { name: requestedNativeAim === "auto" ? autoLabel : manualLabel }), "select-native-aim");
    nativeAimSettings.afterSelection = await inspectMenu();
    if (nativeAimSettings.afterSelection.aimMode !== requestedNativeAim) throw Error("native aim UI did not apply the requested selection");
    nativeAimSettings.selectedButtonOn = await aimRow.getByRole("button", { name: requestedNativeAim === "auto" ? autoLabel : manualLabel }).evaluate(button => button.classList.contains("on"));
    if (!nativeAimSettings.selectedButtonOn) throw Error("native aim UI selection indicator disagrees with the setting");
    await screenshot("native-aim-settings.png");
    // Native settings Back calls meta.save(); this is the actual UI save path.
    await clickNative(settingsScreen.locator(".scr-head .back-btn"), "return-to-menu");
    await page.locator(".mm-small").waitFor({ state: "visible", timeout: 15000 });
    nativeAimSettings.nativeSaveResponse = await saved;
    // HTTP success is a request receipt, not proof the preference was durably saved.
    nativeAimSettings.serverConfirmed = false;
    nativeAimSettings.afterReturn = await inspectMenu();
    if (nativeAimSettings.afterReturn.aimMode !== requestedNativeAim) throw Error("native aim mode changed after returning to the initial menu");
    for (const [key, value] of Object.entries(nativeAimSettings.before))
      if (key !== "aimMode" && nativeAimSettings.afterReturn[key] !== value) throw Error(`native aim UI unexpectedly changed another setting: ${key}`);
    Object.assign(nativeAimSettings, { state: "applied", appliedAt: new Date().toISOString(), profileDirectoryUnchanged: true,
      directPreferenceWrites: false, gameRulesModified: false, returnedToInitialMenu: true });
    await writeNativeAimEvidence();
    console.log(JSON.stringify({ type: "native_aim_settings", ...nativeAimSettings }));
  } catch (error) {
    Object.assign(nativeAimSettings, { state: "blocked", reason: error.message, failedAt: new Date().toISOString() });
    await writeNativeAimEvidence(); await screenshot("native-aim-settings-failure.png"); throw error;
  }
}
async function readTelemetry() {
  const observed = await page.evaluate(() => {
    const pilot = globalThis.__PB_PILOT, app = globalThis.__PB_BRIDGE?.app, run = app?.run, p = run?.player;
    const authorization = globalThis.__CAMPAIGN_ACCOUNT_AUTHORIZATION;
    if (app?.meta?.account && (!authorization || authorization.app !== app || authorization.meta !== app.meta ||
        authorization.account !== app.meta.account || !app.meta.profile || run && authorization.run !== run))
      return { at: new Date().toISOString(), accountRejected: true, snapshot: null, result: null, savedProgress: null, run: null };
    const primitives = (object) => Object.fromEntries(Object.entries(object || {}).filter(([, v]) => v == null || ["number", "string", "boolean"].includes(typeof v)));
    const vector = (v) => v && { x: v.x, y: v.y, z: v.z };
    if (run && !run.__campaignObserved) {
      run.__campaignObserved = true;
      const original = run.finish;
      run.finish = function (...args) {
        globalThis.__CAMPAIGN_FINISH = { at: Date.now(), victoryArgument: args[0], endHow: this.endHow, hp: this.player.hp, moveSlots: this.player.moveSlots, aimMode: this.aimMode, time: this.time, stage: this.stage, stats: { ...this.stats }, lastHit: this.player.lastHit, biome: this.biome.id, tier: this.tier, mode: this.mode };
        const result = original.apply(this, args);
        globalThis.__CAMPAIGN_FINISH.actualVictory = this.victory;
        globalThis.__CAMPAIGN_FINISH.actualState = this.state;
        return result;
      };
    }
    let nearby = [];
    if (run && p) {
      const en = run.enemies;
      for (let i = 0; i < en.n; i++) if (en.alive[i]) {
        const d = Math.hypot(en.x[i] - p.pos.x, en.z[i] - p.pos.z);
        if (d < 30) nearby.push({ index: i, distance: d, x: en.x[i], y: en.y[i], z: en.z[i], vx: en.vx?.[i], vz: en.vz?.[i], vy: en.vy?.[i], air: en.air?.[i], hgt: en.hgt?.[i], hp: en.hp[i], maxHp: en.maxHp[i], flags: en.flags[i], species: en.species?.[i], radius: en.radius?.[i], damage: en.dmg?.[i], speed: en.speed?.[i], atk: en.atk?.[i], dirX: en.dirX?.[i], dirZ: en.dirZ?.[i], sleep: en.sleep?.[i], frozen: en.frozen?.[i], stun: en.stun?.[i], ccImmune: en.ccImmune?.[i] });
      }
      nearby = nearby.sort((a, b) => a.distance - b.distance).slice(0, 24);
    }
    const snapshot = pilot?.snapshot();
    if (authorization?.dedicated && snapshot) delete snapshot.accountId;
    if (snapshot?.shiny) { delete snapshot.shiny.targets; delete snapshot.shiny.sources; }
    const profile = app?.meta?.profile;
    const output = { at: new Date().toISOString(), wallSeconds: (Date.now() - (globalThis.__CAMPAIGN_STARTED || Date.now())) / 1000,
      snapshot, result: globalThis.__CAMPAIGN_FINISH,
      savedProgress: profile ? { biomes: { ...profile.biomes }, medals: { ...profile.medals }, times: Object.fromEntries(Object.entries(profile.times || {}).map(([key, value]) => [key, { time: value?.time }])) } : null,
      run: run ? { state: run.state, victory: run.victory, sent: run.sent, endHow: run.endHow, mode: run.mode, aimMode: run.aimMode, biome: run.biome.id, tier: run.tier, stage: run.stage, stageTime: run.stageTime, time: run.time, timeScale: run.timeScale, stats: { ...run.stats }, diff: run.diff,
        player: { position: vector(p.pos), hp: p.hp, maxHp: p.maxHp, level: p.level, moveSlots: p.moveSlots, stats: primitives(p.stats), lastHit: p.lastHit, moves: p.moves.filter(Boolean).map((m) => ({ key: m.def.key, name: m.def.name, level: m.level, cooldown: m.cd, ...primitives(m) })), items: [...(p.items?.entries?.() || [])].map(([key, count]) => ({ key, count: typeof count === "number" ? count : null, ...(typeof count === "object" ? primitives(count) : {}) })), vitamins: [...(p.vitamins?.entries?.() || [])].map(([key, level]) => ({ key, level: typeof level === "number" ? level : null, ...(typeof level === "object" ? primitives(level) : {}) })), ultimate: primitives(run.ult) },
        minibosses: (run.minibosses?.list || []).slice(0, 20).map(primitives),
        boss: { ...primitives(run.boss), position: run.boss?.alive ? { x: run.enemies.x[run.boss.bossIndex], y: run.enemies.y[run.boss.bossIndex], z: run.enemies.z[run.boss.bossIndex] } : null }, capture: primitives(run.capture), director: primitives(run.director),
        target: pilot?.target && { ...primitives(pilot.target), position: vector(pilot.target) }, hazards: pilot?.hazards?.slice(0, 35).map((h) => ({ ...primitives(h) })), nearby,
      } : null,
    };
    // Some game diagnostic structures hold scene objects. Keep telemetry JSON
    // bounded without mutating the live structures or crashing a real match.
    const seen = new WeakSet();
    return JSON.parse(JSON.stringify(output, (_key, value) => {
      if (value && typeof value === "object") {
        if (seen.has(value)) return undefined;
        seen.add(value);
      }
      return value;
    }));
  });
  if (observed && (observed.run || observed.snapshot)) lastSuccessfulTelemetry = observed;
  return observed;
}
async function persistOutcome(event, telemetry) {
  if (recorded.has(event.id)) return;
  recorded.add(event.id);
  const target = { ...(activeAttempt?.requested || requested) };
  const result = { number: outcomes.length + 1, requested: target, dedicatedTestAccount, requestedNativeMoveSlots, actualNativeMoveSlots: telemetry.run?.player?.moveSlots ?? telemetry.result?.moveSlots ?? null,
    requestedNativeAim, actualNativeAimMode: telemetry.run?.aimMode ?? telemetry.result?.aimMode ?? null, nativeAimSettings: structuredClone(nativeAimSettings), attempt: activeAttempt ? structuredClone(activeAttempt) : null,
    actualBiome: telemetry.run?.biome || telemetry.result?.biome || event.biome, actualTier: telemetry.run?.tier ?? telemetry.result?.tier,
    revision, sourceHashes: { ...sourceHashes },
    observedRevisions:[...new Set([...(activeAttempt?.observedRevisions||[]),revision])],
    observedGameHashes:[...new Set([...(activeAttempt?.observedGameHashes||[]),observedGameHash].filter(Boolean))],
    targetGameHash,baselineGameHash:supportedHash,gameEvidence:explicitGameEvidence||baselineEvidence,
    event, finish: telemetry.result,
    nativeVictorySaved: event.saved === true && event.victory === true && telemetry.result?.victoryArgument === true && telemetry.result?.actualVictory === true && telemetry.result?.actualState === "over", run: telemetry.run };
  result.matchesRequested = result.actualBiome === target.biome && result.actualTier === target.tier;
  result.matchesAttempt = !activeAttempt || result.actualBiome === activeAttempt.biome && result.actualTier === activeAttempt.tier;
  result.prerequisite = activeAttempt?.kind === "prerequisite";
  result.nativeMoveSlotsMatched = requestedNativeMoveSlots === null ? null : result.actualNativeMoveSlots === requestedNativeMoveSlots && !nativeMoveSlotsMismatch;
  result.nativeAimMatched = requestedNativeAim === null ? null : result.actualNativeAimMode === requestedNativeAim && nativeAimSettings.state === "applied" && !nativeAimMismatch;
  result.fixedVersionMatchesTarget = result.observedRevisions.length===1 && result.observedGameHashes.length===1 && result.observedGameHashes[0]===targetGameHash;
  result.passed = result.fixedVersionMatchesTarget && result.nativeVictorySaved && result.matchesRequested && result.matchesAttempt && !result.prerequisite && (requestedNativeMoveSlots === null || result.nativeMoveSlotsMatched) && (requestedNativeAim === null || result.nativeAimMatched);
  result.combatDefeat = telemetry.result?.actualVictory === false && telemetry.result?.hp <= 0;
  result.reason = requestedNativeMoveSlots !== null && !result.nativeMoveSlotsMatched ? "native_move_slots_mismatch" : requestedNativeAim !== null && !result.nativeAimMatched ? "native_aim_mode_mismatch" : result.combatDefeat ? (event.saved ? "combat_defeat" : "combat_defeat_save_failed") : !event.saved ? "save_failed" : !event.victory ? telemetry.result?.endHow || "defeat_or_incomplete" : !result.nativeVictorySaved ? "victory_evidence_missing" : !result.matchesAttempt ? "actual_map_or_tier_mismatch" : !result.fixedVersionMatchesTarget ? "fixed_game_or_controller_fingerprint_mismatch" : result.passed ? "normal_victory_saved" : "prerequisite_victory_does_not_validate_requested_map_or_tier";
  if (matrixMode) {
    const cell = matrix.find((entry) => entry.biome === target.biome && entry.tier === target.tier);
    if (!result.nativeVictorySaved || !result.matchesAttempt || !result.fixedVersionMatchesTarget || requestedNativeMoveSlots !== null && !result.nativeMoveSlotsMatched || requestedNativeAim !== null && !result.nativeAimMatched) {
      matrixFailure = { outcome: result.number, requested: { ...target }, actualBiome: result.actualBiome, actualTier: result.actualTier, reason: result.reason, at: new Date().toISOString() };
      if (cell) Object.assign(cell, { status: "failed", verifiedThisRun: false, failure: { ...matrixFailure } });
    } else if (result.passed && cell) Object.assign(cell, { status: "passed", verifiedThisRun: true, outcome: result.number, revision, gameHash:observedGameHash, savedAt: event.at });
    await writeFile(path.join(runDir, "matrix.json"), JSON.stringify({ matrix, failure: matrixFailure }, null, 2));
  }
  outcomes.push(result); lastOutcome = Date.now(); awaitingStart = false;
  await appendFile(path.join(runDir, "outcomes.jsonl"), JSON.stringify(result) + "\n");
  await screenshot(`run-${runCount}-${result.passed ? "VICTORY" : result.nativeVictorySaved ? "PREREQUISITE" : "FAILURE"}.png`);
  console.log(JSON.stringify({ type: "outcome", number: result.number, requested: { ...target }, requestedNativeMoveSlots, actualNativeMoveSlots: result.actualNativeMoveSlots, nativeMoveSlotsMatched: result.nativeMoveSlotsMatched, passed: result.passed, nativeVictorySaved: result.nativeVictorySaved, prerequisite: result.prerequisite, reason: result.reason, actualBiome: result.actualBiome, actualTier: result.actualTier, stage: telemetry.result?.stage, seconds: event.time, hits: telemetry.result?.stats?.hits, damageTaken: telemetry.result?.stats?.damageTaken }));
}
function savedCompletion(progress, cell) {
  const key = `${cell.biome}-${cell.tier}`;
  return Number(progress?.medals?.[key] || 0) > 0;
}
async function nextMatrixCell(progress) {
  for (const cell of matrix) {
    if (cell.status !== "pending") continue;
    if (savedCompletion(progress, cell)) {
      Object.assign(cell, { status: "skipped_saved_profile", verifiedThisRun: false, skipReason: "victory_medal_in_preexisting_saved_profile", existingMedal: progress.medals[`${cell.biome}-${cell.tier}`], existingTime: progress.times?.[`${cell.biome}-${cell.tier}`]?.time ?? null });
      console.log(JSON.stringify({ type: "matrix_skip", cell: { ...cell }, message: "Previously saved completion; not verified in this invocation" }));
      await writeFile(path.join(runDir, "matrix.json"), JSON.stringify({ matrix, failure: matrixFailure }, null, 2));
      continue;
    }
    return cell;
  }
  return null;
}
function legalAttempt(profile, target) {
  const unlocked = profile.biomes || {};
  if ((unlocked[target.biome] ?? -1) >= target.tier) return { requested: { ...target }, biome: target.biome, tier: target.tier, kind: "validation" };
  // A requested map/tier cannot be injected into the profile. Play the normal
  // unlocked prerequisite and record it separately from the requested cell.
  const targetIndex = campaignBiomes.indexOf(target.biome);
  const firstLocked = campaignBiomes.slice(0,targetIndex+1).findIndex(id=>(unlocked[id]??-1)<0);
  const biome = firstLocked > 0 ? campaignBiomes[firstLocked-1] :
    firstLocked === -1 ? target.biome : null;
  if (!biome || (unlocked[biome] ?? -1) < 0) return null;
  return { requested: { ...target }, biome, tier: biome !== target.biome ? 0 : Math.min(target.tier, unlocked[biome], 2), kind: "prerequisite" };
}
function campaignCompletionEvidence(current, lastKnown, matchesStarted, recordedOutcomes) {
  const currentStateKnown = Boolean(current?.snapshot || current?.run);
  const unrecordedStartedMatches = Math.max(0, matchesStarted - recordedOutcomes.length);
  const lastOutcome = matchesStarted > 0 ? recordedOutcomes.findLast(outcome => outcome.number === matchesStarted) : null;
  const lastStartedMatchSaveConfirmed = matchesStarted > 0 ? lastOutcome?.event?.saved === true : null;
  const liveRunUnfinished = Boolean(current?.run && current.run.state !== "over");
  const currentStateUnavailableAndSaveUnconfirmed = matchesStarted > 0 && !currentStateKnown && lastStartedMatchSaveConfirmed !== true;
  const activeMatchIncomplete = unrecordedStartedMatches > 0 || liveRunUnfinished || currentStateUnavailableAndSaveUnconfirmed;
  return { activeMatchIncomplete, unrecordedStartedMatches, lastStartedMatchSaveConfirmed,
    finalTelemetryReadSucceeded: current !== null, currentGameStateKnown: currentStateKnown,
    finalTelemetrySource: current === null ? "unavailable" : "live-read",
    lastKnownTelemetryOnly: !currentStateKnown && Boolean(lastKnown), lastSuccessfulTelemetryAt: lastKnown?.at ?? null,
    reason: unrecordedStartedMatches > 0 ? "started_match_without_recorded_outcome" : liveRunUnfinished ? "live_run_not_over" :
      currentStateUnavailableAndSaveUnconfirmed ? "current_state_unavailable_and_save_unconfirmed" : lastStartedMatchSaveConfirmed ? "recorded_native_saved_outcome" : "no_unfinished_match_observed" };
}
async function shutdown(reason) {
  if (stopping) return; stopping = true;
  const ownership = await inspectTestAccount().catch(() => null);
  let finalTelemetryReadError = null;
  const lifecycleOwned = ownership?.authorized && (!ownership.hasRun || runCount > 0);
  const before = lifecycleOwned ? await readTelemetry().catch(error => { finalTelemetryReadError = error.message; return null; }) : null;
  const completionEvidence = campaignCompletionEvidence(before, lastSuccessfulTelemetry, runCount, outcomes);
  // Never stop or finish a rejected account or a preexisting registered run.
  if (ownership?.authorized && (!dedicatedTestAccount || runCount > 0)) await page.evaluate(async () => {
    const app = globalThis.__PB_BRIDGE?.app, authorization = globalThis.__CAMPAIGN_ACCOUNT_AUTHORIZATION;
    if (!authorization || authorization.app !== app || authorization.meta !== app?.meta ||
        authorization.account !== app.meta.account || !app.meta.profile || authorization.run !== app.run) return;
    globalThis.__PB_PILOT?.stop("独立实战验证结束");
    const r = app.run;
    if (r && r.state !== "over") await Promise.race([r.finish(false, true), new Promise((resolve) => setTimeout(resolve, 10000))]);
  }).catch(() => {});
  if (lifecycleOwned) await screenshot("final.png");
  const matrixComplete = matrixMode && matrix.every((cell) => ["passed", "skipped_saved_profile"].includes(cell.status));
  const summary = { reason, campaignScope:{mode:"standard",biomes:campaignBiomes,tiers:[0,1,2],cells:matrix.length,tower:"Separate live-event validation; excluded from ordinary campaign matrix"},
    baselineGameHash:supportedHash,targetGameHash,gameEvidence:explicitGameEvidence||baselineEvidence,actualObservedGameHash:observedGameHash,
    requested: { ...requested }, dedicatedTestAccount, accountAuthorization: { ...accountAuthorization }, requestedNativeMoveSlots, observedNativeMoveSlots: [...observedNativeMoveSlots], nativeMoveSlotsMismatch, nativeMoveSlotsMatched: requestedNativeMoveSlots === null || observedNativeMoveSlots.size === 0 ? null : !nativeMoveSlotsMismatch && [...observedNativeMoveSlots].every((slots) => slots === requestedNativeMoveSlots),
    requestedNativeAim, nativeAimSettings: structuredClone(nativeAimSettings), observedNativeAimModes: [...observedNativeAimModes], nativeAimMismatch,
    nativeAimMatched: requestedNativeAim === null || observedNativeAimModes.size === 0 ? null : nativeAimSettings.state === "applied" && !nativeAimMismatch && [...observedNativeAimModes].every(mode => mode === requestedNativeAim), matrixMode, limits: { seconds, maxRuns }, launchedAt: new Date(launchAt).toISOString(), endedAt: new Date().toISOString(), wallSeconds: (Date.now() - launchAt) / 1000, matchesStarted: runCount, outcomes: outcomes.map(({ run, ...o }) => o), completed: outcomes.length,
    victories: outcomes.filter((r) => r.nativeVictorySaved).length, verifiedMatches: outcomes.filter((r) => r.passed).length, defeats: outcomes.filter((r) => !r.nativeVictorySaved).length,
    incomplete: completionEvidence.activeMatchIncomplete || Boolean(matrixMode && !matrixComplete && !matrixFailure), activeMatchIncomplete: completionEvidence.activeMatchIncomplete,
    completionEvidence, finalTelemetryReadError, manualCloseRequired: !lifecycleOwned, pageDiagnostics: structuredClone(pageDiagnostics),
    matrix: matrixMode ? structuredClone(matrix) : undefined, matrixFailure, matrixComplete, fullyVerifiedThisInvocation: matrixMode ? matrix.every((cell) => cell.status === "passed") : undefined,
    finalTelemetry: before, lastSuccessfulTelemetry: structuredClone(lastSuccessfulTelemetry) };
  await writeFile(path.join(runDir, "summary.json"), JSON.stringify(summary, null, 2));
  await writeFile(path.join(artifactDir, "latest-summary.json"), JSON.stringify(summary, null, 2));
  if (lifecycleOwned) await context.close().catch(() => {});
  console.log(JSON.stringify({ type: "finished", reason, completed: summary.completed, victories: summary.victories, defeats: summary.defeats, incomplete: summary.incomplete, summary: path.join(runDir, "summary.json") }));
}
process.on("SIGINT", () => shutdown("interrupted"));
process.on("SIGTERM", () => shutdown("terminated"));
while (!stopping && Date.now() - launchAt < seconds * 1000) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  if (compatibilityError) { await shutdown(compatibilityError); break; }
  const ownership = await inspectTestAccount().catch(() => null);
  if (ownership && !ownership.authorized && !["not-logged-in", "native-profile-pending"].includes(ownership.state)) {
    await shutdown(ownership.state); break;
  }
  if (dedicatedTestAccount && ownership?.authorized && runCount === 0 && (ownership.hasRun || ownership.pilotEnabled)) {
    await shutdown("dedicated_test_requires_initial_menu_without_existing_run"); break;
  }
  const guestButton = page.getByRole("button", { name: /以游客身份游玩|Play as guest|Jugar como invitado/i }).first();
  if (!dedicatedTestAccount && !guestEntryRequested && await guestButton.isVisible().catch(() => false)) {
    await guestButton.click().then(() => { guestEntryRequested = true; }).catch(() => {});
    await inspectTestAccount().catch(() => null);
  }
  await page.evaluate(async ({ starter, dedicated }) => {
    const app = globalThis.__PB_BRIDGE?.app;
    const authorization = globalThis.__CAMPAIGN_ACCOUNT_AUTHORIZATION;
    if (authorization && authorization.app === app && authorization.meta === app?.meta &&
        authorization.account === app.meta.account && Boolean(app.meta.profile) &&
        !app.run && !globalThis.__PB_PILOT?.enabled && !app.meta.profile.starter && !app.__campaignChoosing) {
      app.__campaignChoosing = true;
      await app.meta.chooseStarter(dedicated ? 1 : [1, 4, 7].includes(starter) ? starter : 1);
      if (app.meta.account === authorization.account) app.toMenu();
    }
  }, { starter: requested.character, dedicated: dedicatedTestAccount }).catch(() => {});
  const telemetryOwnership = await inspectTestAccount().catch(() => null);
  if (telemetryOwnership && !telemetryOwnership.authorized && !["not-logged-in", "native-profile-pending"].includes(telemetryOwnership.state)) {
    await shutdown(telemetryOwnership.state); break;
  }
  if (telemetryOwnership && !telemetryOwnership.authorized) {
    if (Date.now() - launchAt > 90000) {
      await shutdown(dedicatedTestAccount ? "dedicated_test_native_login_or_profile_required" : "native_guest_or_profile_not_ready"); break;
    }
    continue;
  }
  const t = await readTelemetry().catch(() => null);
  if (t?.accountRejected) { await shutdown("native_account_changed_or_not_authorized"); break; }
  if (t?.run) {
    const actualAim = t.run.aimMode ?? null;
    observedNativeAimModes.add(actualAim);
    if (requestedNativeAim !== null && (nativeAimSettings.state !== "applied" || actualAim !== requestedNativeAim)) {
      nativeAimMismatch = { at: t.at, reason: "native_aim_mode_mismatch", requestedNativeAim, actualNativeAimMode: actualAim,
        settingsPreparation: nativeAimSettings.state, run: runCount, biome: t.run.biome, tier: t.run.tier, stage: t.run.stage, state: t.run.state };
      nativeAimSettings.runMismatch = { ...nativeAimMismatch };
      await writeNativeAimEvidence();
      await appendFile(path.join(runDir, "validation-failures.jsonl"), JSON.stringify(nativeAimMismatch) + "\n");
      console.log(JSON.stringify({ type: "validation_failure", ...nativeAimMismatch }));
      await shutdown("native_aim_mode_mismatch"); break;
    }
    if (requestedNativeAim !== null && !nativeAimSettings.runConfirmed) {
      nativeAimSettings.runConfirmed = { at: t.at, actualNativeAimMode: actualAim, state: t.run.state, gameTime: t.run.time };
      await writeNativeAimEvidence();
    }
  }
  // Capacity is evidence from an actual native player, never a rule override.
  // A preexisting four-slot profile must fail this trial rather than be edited.
  if (t?.run?.player) {
    const actualSlots = t.run.player.moveSlots ?? null;
    observedNativeMoveSlots.add(actualSlots);
    if (requestedNativeMoveSlots !== null && actualSlots !== requestedNativeMoveSlots) {
      nativeMoveSlotsMismatch = { at: t.at, reason: "native_move_slots_mismatch", requestedNativeMoveSlots, actualNativeMoveSlots: actualSlots, run: runCount, biome: t.run.biome, tier: t.run.tier, stage: t.run.stage, state: t.run.state };
      await appendFile(path.join(runDir, "validation-failures.jsonl"), JSON.stringify(nativeMoveSlotsMismatch) + "\n");
      await writeFile(path.join(runDir, "native-slot-mismatch.json"), JSON.stringify(nativeMoveSlotsMismatch, null, 2));
      console.log(JSON.stringify({ type: "validation_failure", ...nativeMoveSlotsMismatch }));
      for (const event of t.snapshot?.events || []) if (event.kind === "settlement") await persistOutcome(event, t);
      if (matrixMode) {
        matrixFailure = { ...nativeMoveSlotsMismatch, requested: { ...(activeAttempt?.requested || requested) } };
        const cell = matrix.find((entry) => entry.biome === matrixFailure.requested.biome && entry.tier === matrixFailure.requested.tier);
        if (cell) Object.assign(cell, { status: "failed", verifiedThisRun: false, failure: { ...matrixFailure } });
        await writeFile(path.join(runDir, "matrix.json"), JSON.stringify({ matrix, failure: matrixFailure }, null, 2));
      }
      await shutdown("native_move_slots_mismatch"); break;
    }
  }
  if (t?.snapshot?.compatibility?.state === "blocked") {
    await shutdown(`runtime_compatibility_failed: ${t.snapshot.compatibility.reason || t.snapshot.compatibility.code}`); break;
  }
  if (!t?.snapshot || t.snapshot.compatibility?.state === "pending") {
    const pageFailure = pageDiagnostics.findLast(event => !event.expectedDuringShutdown && ["crash", "close"].includes(event.kind));
    if (pageFailure) { await shutdown(`page_${pageFailure.kind}_observed`); break; }
    if (Date.now() - launchAt > 90000) { await shutdown("game_bridge_connection_timeout"); break; }
    continue;
  }
  await writeFile(path.join(artifactDir, "status.json"), JSON.stringify({ ...t, pid: process.pid, requested: { ...(activeAttempt?.requested || requested) }, dedicatedTestAccount, accountAuthorization: { ...accountAuthorization }, requestedNativeMoveSlots, observedNativeMoveSlots: [...observedNativeMoveSlots], requestedNativeAim,
    nativeAimSettings: structuredClone(nativeAimSettings), observedNativeAimModes: [...observedNativeAimModes], activeAttempt: activeAttempt ? structuredClone(activeAttempt) : null, matrix: matrixMode ? matrix : undefined, revision, runDir }, null, 2));
  const controlPath = path.join(artifactDir, "control.json");
  const control = await readFile(controlPath, "utf8").then(JSON.parse).catch(() => null);
  if (control) {
    await unlink(controlPath).catch(() => {});
    if (control.action === "reload") {
      bundle = await makeBundle(true); await page.evaluate(bundle);
      console.log(JSON.stringify({ type: "reloaded", revision, runPreserved: !!t.run }));
    } else if (control.action === "pause") await page.evaluate(() => {
      const app=globalThis.__PB_BRIDGE?.app, a=globalThis.__CAMPAIGN_ACCOUNT_AUTHORIZATION;
      if(a?.app===app && a.meta===app?.meta && a.account===app.meta.account && Boolean(app.meta.profile) && a.run===app.run)
        globalThis.__PB_PILOT?.stop("验证暂停");
    });
    else if (control.action === "resume") await page.evaluate(async () => {
      const app=globalThis.__PB_BRIDGE?.app, a=globalThis.__CAMPAIGN_ACCOUNT_AUTHORIZATION;
      const valid=()=>a?.app===app && a.meta===app?.meta && a.account===app.meta.account && Boolean(app.meta.profile) && app.run && a.run===app.run;
      if(!valid()) return false;
      const p=globalThis.__PB_PILOT; await p?.prepareOperationSettings?.(); return valid() ? p?.start() : false;
    });
    else if (control.action === "stop") { await shutdown("control_stop"); break; }
    else if (control.action === "screenshot") await screenshot(`manual-${Date.now()}.png`);
  }
  const stageKey = t.run ? `${runCount}-${t.run.stage}` : "";
  const activeRunAt = t.snapshot.history?.findLast((v) => v.event === "run")?.at;
  if (activeRunAt && activeRunAt !== lastRunAt) {
    lastRunAt = activeRunAt; await appendFile(path.join(runDir, "run-starts.jsonl"), JSON.stringify({ at: new Date().toISOString(), runCount, revision, settings, history: t.snapshot.history }) + "\n");
  }
  if (stageKey && stageKey !== lastStage) { lastStage = stageKey; await screenshot(`run-${runCount}-stage-${t.run.stage}.png`); }
  for (const event of t.snapshot.events || []) if (event.kind === "settlement") await persistOutcome(event, t);
  if (matrixFailure) { await shutdown("matrix_failed_no_retry"); break; }
  if (Date.now() - lastSample >= 10000) {
    lastSample = Date.now(); await appendFile(path.join(runDir, "telemetry.jsonl"), JSON.stringify({ ...t, revision }) + "\n");
    console.log(JSON.stringify({ type: "sample", revision, run: runCount, requestedNativeMoveSlots, moveSlots: t.run?.player.moveSlots, requestedNativeAim, aimMode: t.run?.aimMode, state: t.run?.state, biome: t.run?.biome, stage: t.run?.stage, time: Math.round(t.run?.time || 0), level: t.run?.player.level, hp: t.run?.player.hp, maxHp: t.run?.player.maxHp, kills: t.run?.stats.kills, hits: t.run?.stats.hits, damageTaken: t.run?.stats.damageTaken, bossHp: t.snapshot.bossHp, target: t.snapshot.target, errors: t.snapshot.errors }));
    await screenshot("live.png");
  }
  if (outcomes.length >= maxRuns) { await shutdown("requested_matches_finished"); break; }
  if (!awaitingStart && !t.run && t.snapshot.accountType === (dedicatedTestAccount ? "registered" : "guest") &&
      telemetryOwnership?.authorized && t.snapshot.profile?.league?.length && (!lastOutcome || Date.now() - lastOutcome > 2000)) {
    const profile = t.snapshot.profile;
    const matrixCell = matrixMode ? await nextMatrixCell(t.savedProgress) : null;
    if (matrixMode && !matrixCell) { await shutdown("matrix_finished_with_saved_skips_separately_reported"); break; }
    const target = matrixCell ? { biome: matrixCell.biome, tier: matrixCell.tier, character: matrixCell.character } : { ...requested };
    activeAttempt = legalAttempt(profile, target);
    if (activeAttempt) Object.assign(activeAttempt,{observedRevisions:[revision],observedGameHashes:observedGameHash?[observedGameHash]:[]});
    if (!activeAttempt) { await shutdown("no_legally_unlocked_prerequisite"); break; }
    if (!profile.league.includes(target.character)) { await shutdown(`character_${target.character}_not_legally_owned`); break; }
    if (requestedNativeAim !== null && nativeAimSettings.state !== "applied") {
      try { await prepareNativeAimThroughUi(); }
      catch (error) { await shutdown(`native_aim_ui_failed: ${error.message}`); break; }
    }
    settings = { ...settings, biome: activeAttempt.biome, tier: activeAttempt.tier, characterId: target.character };
    const startResult = await page.evaluate(async ({ s, token }) => {
      const app = globalThis.__PB_BRIDGE?.app, authorization = globalThis.__CAMPAIGN_ACCOUNT_AUTHORIZATION;
      const valid = () => authorization && authorization.app === app && authorization.meta === app?.meta &&
        authorization.account === app.meta.account && Boolean(app.meta.profile) && !app.run;
      if (!valid()) return { ok: false, reason: "native account changed before start" };
      const p = globalThis.__PB_PILOT;
      p.setSettings(s); await p.prepareOperationSettings?.();
      if (!valid()) return { ok: false, reason: "native account changed during start preparation" };
      authorization.run = null; authorization.startToken = token;
      globalThis.__CAMPAIGN_FINISH = null; globalThis.__CAMPAIGN_STARTED = Date.now();
      const ok = p.start() === true;
      if (!ok) authorization.startToken = null;
      return { ok, reason: p.status };
    }, { s: settings, token: randomUUID() });
    if (!startResult.ok) { await shutdown(`start_rejected: ${startResult.reason}`); break; }
    runCount++; awaitingStart = true;
    console.log(JSON.stringify({ type: "starting", run: runCount, settings: { ...settings }, requested: { ...target }, attempt: structuredClone(activeAttempt), unlockedBiomes: { ...profile.biomes } }));
  }
}
await shutdown("time_limit_incomplete");


function ordinaryCampaignMaps(value) {
  return (value?.maps||[]).filter(map=>map.live===true&&map.id!=="graveyard"&&!map.eventOnly&&!map.event&&(!map.mode||map.mode==="standard"))
    .sort((a,b)=>(a.index??0)-(b.index??0)).map(map=>map.id);
}
// BEGIN PUBLIC REVIEW EVIDENCE CONTRACT: mirrored by the two validation tools.
function reviewDigest(bytes){return createHash("sha256").update(bytes).digest("hex");}
function reviewSourcePath(value){return typeof value==="string"&&(/^(src\/(policy|pilot|objectives|shiny|compatibility|custom-plans|action-cadence|interaction-navigation|battle-tactics|choice-strategy|unlock-goals|player-overlay|player-convenience|unlock-catalog|encyclopedia|telemetry)\.mjs|client\/GameUpdates\.cs)$/.test(value));}
function reviewedTargetEvidence(report,hash,observed=reviewEvidenceArtifacts.get(report)) {
  try {
    const actual=report?.actual, validHash=value=>/^[a-f0-9]{64}$/.test(value||""),
      bodyMatches=(record,body)=>record?.status===200&&Number.isInteger(record.bytes)&&record.bytes>0&&
        typeof record.file==="string"&&/^[A-Za-z0-9._-]+\.js$/.test(record.file)&&validHash(record.sha256)&&
        Buffer.isBuffer(body)&&body.length===record.bytes&&reviewDigest(body)===record.sha256;
    if (!validHash(hash)||report?.reportType!=="pokebonk-public-static-review"||report.publicOnly!==true||report.reviewed!==true||
        report.reviewedGameHash!==hash||actual?.sha256!==hash||report.accountUsed!==false||report.credentialsRead!==false||
        report.browserOpened!==false||report.gameplayValidated!==false||report.requestsAuthenticated===true||report.gameExecuted===true||report.contract?.ok!==true||
        !Array.isArray(report.contract.missing)||report.contract.missing.length||
        !bodyMatches(actual,observed?.mainBytes)||!bodyMatches(actual.news,observed?.newsBytes)) return false;
    if (report.definitionEquivalent===true&&report.definitionsAndCombatUnchanged===true) {
      return observed.baselineHashes?.includes(report.definitionEquivalentToHash)===true&&
        report.assessment?.battleChangesIdentified!==true&&!(report.changes||[]).some(change=>change.gameplay===true);
    }
    if (report.definitionEquivalent!==false||report.definitionsAndCombatUnchanged!==false||
        report.assessment?.staticReviewComplete!==true||report.assessment.connectionContractSatisfied!==true) return false;
    const mr=report.mechanicsReview, ref=mr?.proof;
    if (mr?.schemaVersion!==1||mr.reviewed!==true||mr.allChangesReviewed!==true||mr.adapterCoverageConfirmed!==true||
        !Array.isArray(mr.unresolvedRequiredChanges)||mr.unresolvedRequiredChanges.length||ref?.passed!==true||
        ref.reportType!=="pokebonk-public-mechanics-adapter-proof"||!validHash(ref.sha256)||
        !Number.isInteger(ref.bytes)||ref.bytes<=0||!Buffer.isBuffer(observed.proofBytes)||
        observed.proofBytes.length!==ref.bytes||reviewDigest(observed.proofBytes)!==ref.sha256) return false;
    const proof=JSON.parse(observed.proofBytes.toString("utf8"));
    if (proof.schemaVersion!==1||proof.reportType!==ref.reportType||proof.publicOnly!==true||proof.passed!==true||
        proof.actualSourceHash!==hash||proof.accountUsed!==false||proof.credentialsRead!==false||proof.browserOpened!==false||
        proof.AppRunBackendExecuted!==false||proof.gameplayValidated!==false) return false;
    const exactSources=entries=>Array.isArray(entries)&&entries.length>0&&new Set(entries.map(entry=>entry.file)).size===entries.length&&
      entries.every(entry=>reviewSourcePath(entry.file)&&validHash(entry.sha256)&&
        Buffer.isBuffer(observed.sourceBytes?.get(entry.file))&&reviewDigest(observed.sourceBytes.get(entry.file))===entry.sha256);
    if (!exactSources(proof.sourceFiles)||!exactSources(mr.adapterSourceFiles)||
        proof.sourceFiles.length!==mr.adapterSourceFiles.length||
        !proof.sourceFiles.every(entry=>mr.adapterSourceFiles.some(item=>item.file===entry.file&&item.sha256===entry.sha256))) return false;
    const details=[...(proof.driveCases||[]),...(proof.proofCases||[])], ids=new Set(details.map(item=>item.id));
    if (!details.length||proof.caseCount!==details.length||ids.size!==details.length||
        !details.every(item=>typeof item.id==="string"&&item.id&&((item.equal===true&&item.nativeDriveSpeed===item.productDriveSpeed)||item.passed===true))) return false;
    if (!Array.isArray(proof.checks)||!proof.checks.length||new Set(proof.checks.map(item=>item.id)).size!==proof.checks.length||
        !proof.checks.every(item=>typeof item.id==="string"&&item.id&&item.passed===true&&Array.isArray(item.caseIds)&&
          item.caseIds.length>0&&new Set(item.caseIds).size===item.caseIds.length&&item.caseIds.every(id=>ids.has(id)))) return false;
    if (!Array.isArray(report.changes)||!report.changes.length||
        !report.changes.every(change=>typeof change.id==="string"&&change.id&&typeof change.gameplay==="boolean")||
        new Set(report.changes.map(change=>change.id)).size!==report.changes.length) return false;
    const gameplay=report.changes.filter(change=>change.gameplay), coverage=mr.changes;
    if (!gameplay.length||!Array.isArray(coverage)||coverage.length!==gameplay.length||
        new Set(coverage.map(change=>change.id)).size!==coverage.length) return false;
    return gameplay.every(change=>coverage.some(entry=>entry.id===change.id&&entry.coverage?.state==="covered"&&
      Array.isArray(entry.coverage.checkIds)&&entry.coverage.checkIds.length>0&&
      entry.coverage.checkIds.every(id=>proof.checks.some(check=>check.id===id&&check.passed===true))&&
      Array.isArray(entry.evidence)&&entry.evidence.length>0&&entry.evidence.every(item=>proof.sourceFiles.some(source=>source.file===item.file)&&
        Array.isArray(item.lines)&&item.lines.length>0&&item.lines.every(n=>Number.isInteger(n)&&n>0&&
          n<=observed.sourceBytes.get(item.file).toString("utf8").split("\n").length))));
  } catch { return false; }
}
async function readReviewFile(reference,source=false) {
  if(typeof reference!=="string"||reference.includes("\\")||path.isAbsolute(reference)||reference.split("/").some(part=>!part||part==="."||part==="..")||
      !(source?reviewSourcePath(reference):/^(research\/[^/]+\.(json|js)|artifacts\/official-[^/]+\/[^/]+\.(json|js))$/.test(reference)))
    throw Error("Public review attachment path is outside the reviewed source/public-evidence scope");
  const absolute=path.resolve(reviewRoot,reference);
  for(let current=absolute;current!==path.resolve(reviewRoot);current=path.dirname(current))
    if((await lstat(current)).isSymbolicLink())throw Error("Public review attachments cannot follow links");
  return readFile(absolute);
}
async function loadReviewAttachments(report,reference,baselineHashes) {
  const relative=path.relative(reviewRoot,path.resolve(reviewRoot,reference)).replaceAll("\\","/");
  if(!/^(research\/[^/]+\.json|artifacts\/official-[^/]+\/[^/]+\.json)$/.test(relative))throw Error("Game evidence must be public research/official-review JSON");
  const local=record=>{
    if(!record||typeof record.file!=="string"||!/^[A-Za-z0-9._-]+\.js$/.test(record.file))throw Error("Public review must identify exact local main/news bodies");
    return path.posix.join(path.posix.dirname(relative),record.file);
  };
  const result={baselineHashes,mainBytes:await readReviewFile(local(report.actual)),newsBytes:await readReviewFile(local(report.actual?.news)),sourceBytes:new Map()};
  if(report.definitionEquivalent===false||report.definitionsAndCombatUnchanged===false){
    result.proofBytes=await readReviewFile(report.mechanicsReview?.proof?.path);
    const proof=JSON.parse(result.proofBytes.toString("utf8"));
    for(const entry of [...(report.mechanicsReview?.adapterSourceFiles||[]),...(proof.sourceFiles||[])])
      if(!result.sourceBytes.has(entry.file))result.sourceBytes.set(entry.file,await readReviewFile(entry.file,true));
  }
  return result;
}
async function publicEvidence(reference) {
  const relative=path.relative(reviewRoot,path.resolve(reviewRoot,reference)).replaceAll("\\","/");
  const report=JSON.parse((await readReviewFile(relative)).toString("utf8").replace(/^\uFEFF/,""));
  reviewEvidenceArtifacts.set(report,await loadReviewAttachments(report,reference,reviewBaselineHashes));
  return report;
}
function reviewEvidenceSelfTest(assert,baselineHash) {
  const mainBytes=Buffer.from("public-main"),newsBytes=Buffer.from("public-news"),hash=reviewDigest(mainBytes),source=Buffer.from("public-controller");
  const observed={mainBytes,newsBytes,baselineHashes:[baselineHash],sourceBytes:new Map([["src/policy.mjs",source]])};
  const original={reportType:"pokebonk-public-static-review",publicOnly:true,reviewed:true,reviewedGameHash:hash,
    actual:{file:"main.min.js",status:200,bytes:mainBytes.length,sha256:hash,news:{file:"news.min.js",status:200,bytes:newsBytes.length,sha256:reviewDigest(newsBytes)}},
    definitionEquivalent:true,definitionsAndCombatUnchanged:true,definitionEquivalentToHash:baselineHash,
    accountUsed:false,credentialsRead:false,browserOpened:false,gameplayValidated:false,contract:{ok:true,missing:[]}};
  let checks=0;const accept=(report,evidence=observed)=>{assert.equal(reviewedTargetEvidence(report,hash,evidence),true);checks++;},
    reject=(report,evidence=observed)=>{assert.equal(reviewedTargetEvidence(report,hash,evidence),false);checks++;};
  accept(original);for(const patch of [{publicOnly:false},{reviewed:false},{reviewedGameHash:"b".repeat(64)},{accountUsed:true},{credentialsRead:true},{browserOpened:true},{gameplayValidated:true},{requestsAuthenticated:true},{gameExecuted:true},{contract:{ok:false,missing:[]}},{definitionEquivalent:false}])reject({...original,...patch});
  reject({sourceHash:hash});reject({...original,actual:{...original.actual,bytes:mainBytes.length+1}});reject(original,{...observed,mainBytes:Buffer.from("wrong")});reject(original,{...observed,newsBytes:Buffer.from("wrong")});
  const sourceFiles=[{file:"src/policy.mjs",sha256:reviewDigest(source)}],proof={schemaVersion:1,reportType:"pokebonk-public-mechanics-adapter-proof",publicOnly:true,passed:true,actualSourceHash:hash,
    accountUsed:false,credentialsRead:false,browserOpened:false,AppRunBackendExecuted:false,gameplayValidated:false,sourceFiles,
    proofCases:[{id:"case-one",passed:true},{id:"case-two",passed:true}],driveCases:[],caseCount:2,
    checks:[{id:"check-one",passed:true,caseIds:["case-one"]},{id:"check-two",passed:true,caseIds:["case-two"]}]};
  const proofBytes=Buffer.from(JSON.stringify(proof)),changed={...original,definitionEquivalent:false,definitionsAndCombatUnchanged:false,definitionEquivalentToHash:null,
    assessment:{staticReviewComplete:true,connectionContractSatisfied:true,battleChangesIdentified:true},
    changes:[{id:"mechanic-one",gameplay:true},{id:"mechanic-two",gameplay:true},{id:"display",gameplay:false}],
    mechanicsReview:{schemaVersion:1,reviewed:true,allChangesReviewed:true,adapterCoverageConfirmed:true,unresolvedRequiredChanges:[],adapterSourceFiles:sourceFiles,
      proof:{path:"artifacts/official-fixture/proof.json",sha256:reviewDigest(proofBytes),bytes:proofBytes.length,reportType:proof.reportType,passed:true},
      changes:["one","two"].map(n=>({id:"mechanic-"+n,coverage:{state:"covered",checkIds:["check-"+n]},evidence:[{file:"src/policy.mjs",lines:[1]}]}))}};
  const evidence={...observed,proofBytes};accept(changed,evidence);
  for(const patch of [{mechanicsReview:null},{changes:[...changed.changes,{id:"uncovered",gameplay:true}]},{changes:changed.changes.map(({gameplay,...rest})=>rest)},
      {mechanicsReview:{...changed.mechanicsReview,allChangesReviewed:false}},{mechanicsReview:{...changed.mechanicsReview,unresolvedRequiredChanges:["missing"]}},
      {mechanicsReview:{...changed.mechanicsReview,changes:changed.mechanicsReview.changes.slice(1)}},
      {mechanicsReview:{...changed.mechanicsReview,changes:changed.mechanicsReview.changes.map(x=>({...x,coverage:{state:"covered",checkIds:["generic sentence"]}}))}}])reject({...changed,...patch},evidence);
  reject(changed,{...evidence,proofBytes:Buffer.from("wrong")});reject(changed,{...evidence,sourceBytes:new Map([["src/policy.mjs",Buffer.from("changed-controller")]])});
  const rejectedProof={...proof,checks:[{id:"check-one",passed:true,caseIds:["nonexistent"]},proof.checks[1]]},bad=Buffer.from(JSON.stringify(rejectedProof));
  reject({...changed,mechanicsReview:{...changed.mechanicsReview,proof:{...changed.mechanicsReview.proof,sha256:reviewDigest(bad),bytes:bad.length}}},{...evidence,proofBytes:bad});
  for(const patch of [{actualSourceHash:"b".repeat(64)},{publicOnly:false},{accountUsed:true},{credentialsRead:true},{gameplayValidated:true},{caseCount:99},
      {checks:[{id:"check-one",passed:true},proof.checks[1]]}]) {
    const bytes=Buffer.from(JSON.stringify({...proof,...patch}));
    reject({...changed,mechanicsReview:{...changed.mechanicsReview,proof:{...changed.mechanicsReview.proof,sha256:reviewDigest(bytes),bytes:bytes.length}}},{...evidence,proofBytes:bytes});
  }
  reject({...changed,definitionEquivalent:true,definitionsAndCombatUnchanged:true},evidence);
  return checks;
}
// END PUBLIC REVIEW EVIDENCE CONTRACT
