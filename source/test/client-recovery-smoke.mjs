// Native recovery regression. Default mode is a fresh no-account client.
// Registered gameplay additionally requires an explicit current-account authorization.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, copyFile, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

// Historical source only: fault injection and cleanup are not current consent.
// Refuse before payload/profile reads, endpoint access or process creation.
throw new Error("HISTORICAL_LIVE_HARNESS_DISABLED_018: This historical recovery script cannot run against any client or account. No command-line flag authorizes its old finish/close/fault cleanup. Current validation must preserve active runs until native ending/death and confirmed save.");

const workspace = fileURLToPath(new URL("../", import.meta.url));
const source = path.resolve(process.argv[2] || "dist/0.11.0");
const registered = process.argv.includes("--dedicated-test-account");
const chinesePath = process.argv.includes("--chinese-path");
assert.ok(!registered || !chinesePath, "registered gameplay must retain its fixed authorized original directory");
assert.ok(!registered || process.argv.includes("--registered-gameplay-authorized"),
  "registered gameplay must be separately authorized for this invocation; do not run while its owner is playing");
assert.ok(!process.argv.some(value => /guest|reuse-own|profile=/.test(value) && value !== "--dedicated-test-account"),
  "this regression cannot select another account/profile");
const cases = (process.argv.find(value => value.startsWith("--case="))?.slice(7) ||
  (registered ? "crash,network,stop" : "crash,browser,intent,network,stop")).split(",");
assert.ok(cases.every(value => (registered ? ["crash", "network", "stop", "session"] : ["cold", "slow", "crash", "browser", "intent", "network", "stop"]).includes(value)));
const output = path.join(workspace, "artifacts", "native-recovery", new Date().toISOString().replace(/[:.]/g, "-"));
const root = registered ? path.join(workspace, "artifacts", "dedicated-native-client-v2") : path.join(output, chinesePath ? "中文 空格客户端" : "client");
await mkdir(output, { recursive: true });
const info = JSON.parse(await readFile(path.join(source, "build-info.json"), "utf8"));
const digest = value => createHash("sha256").update(value).digest("hex");
let expectedIdentityHash;
if (registered) {
const authorizationPath = path.join(root, "data", "pilot-test-authorization.json");
for (let current = authorizationPath; current.length >= workspace.length; current = path.dirname(current))
  assert.equal((await lstat(current)).isSymbolicLink(), false, "authorized original paths must not be linked");
assert.ok((await lstat(authorizationPath)).size <= 4096);
// This file contains purpose/registered/hash only, not a name, password, or token.
const authorization = JSON.parse((await readFile(authorizationPath, "utf8")).replace(/^\uFEFF/, ""));
assert.equal(authorization.purpose, "user-authorized-dedicated-test");
assert.equal(authorization.registered, true);
assert.match(authorization.identityHash, /^[a-f0-9]{64}$/);
expectedIdentityHash = authorization.identityHash;
}
// Refuse another live host before any static payload can overwrite its portable directory.
let occupied = false;
try { occupied = (await fetch("http://127.0.0.1:9223/json/version")).ok; } catch {}
assert.equal(occupied, false, "preexisting debug endpoint must not be attached or closed");
for (const entry of info.payloadFiles) {
  assert.ok(!path.isAbsolute(entry.path) && !entry.path.split(/[\\/]/).includes("..") &&
    !/^data(?:[\\/]|$)/i.test(entry.path), "only static build members may be updated");
  const target = path.resolve(root, entry.path);
  assert.ok(target.startsWith(root + path.sep));
  for (let current = target; current.length >= root.length; current = path.dirname(current)) {
    const metadata = await lstat(current).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    assert.ok(!metadata?.isSymbolicLink());
  }
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(path.join(source, entry.path), target);
}
await copyFile(path.join(source, "build-info.json"), path.join(root, "build-info.json"));
assert.equal(digest(await readFile(path.join(root, "PokeBonk Pilot.exe"))), info.sha256);
if (!registered) assert.equal(await lstat(path.join(root, "data")).then(() => true).catch(error => {
  if (error.code === "ENOENT") return false; throw error;
}), false, "cold no-account startup must contain static payload only, never runtime data");
const child = spawn(path.join(root, "PokeBonk Pilot.exe"), ["--diagnostics", "--diagnostics-no-activate",
  ...(registered ? ["--authorized-test-account"] : [])],
  { cwd: root, windowsHide: true, stdio: "ignore" });
const summary = { version: info.version, exeSha256: info.sha256, controllerRevision: info.controllerRevision,
  passed: false, scope: registered ? "current-authorized-v2" : "fresh-no-account",
  currentRegisteredV2Only: registered, credentialsRead: false, profileCopied: false,
  guestCreated: false, gameRulesModified: false, countsAsCampaignVictory: false,
  ...(registered ? {} : { freshStaticPayloadOnly: true, chineseAndSpaceRoot: chinesePath }),
  cases: {}, recoveryTimeline: [], nativeFinishResponses: [], errors: [] };
let browser, panel, game, ownRunHash = null, currentCase = null, sampler, previousConfig, sampling = false, nextAttachAt = 0, sessionRecoveryIncomplete = false;
const observedPages = new WeakSet(), observedBrowsers = new WeakSet(), observedContexts = new WeakSet();
const savedCards = [];
const state = () => panel.evaluate(() => desktop.getState());
async function writeProgress() {
  await writeFile(path.join(output, "progress.json"), JSON.stringify({ version: info.version,
    exeSha256: info.sha256, currentCase, completedCases: Object.keys(summary.cases),
    recovery: summary.recoveryTimeline.at(-1) ?? null,
    lastObserverWaitError: summary.lastObserverWaitError ?? null, at: Date.now() }, null, 2) + "\n");
}
async function wait(check, message, seconds = 90, allowExit = false) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if (!allowExit) assert.equal(child.exitCode, null, "owned native client exited before the test completed");
    try { if (await check()) return; }
    catch (error) { summary.lastObserverWaitError = String(error.message).slice(0, 500); }
    await delay(150);
  }
  throw Error(message);
}
function observeContext(context) {
  if (observedContexts.has(context)) return;
  observedContexts.add(context);
  context.on("page", observePage);
  context.pages().forEach(observePage);
}
function observePage(page) {
  if (observedPages.has(page)) return;
  observedPages.add(page);
  page.on("pageerror", error => summary.errors.push(String(error.message).slice(0, 300)));
  page.on("response", response => {
    const match = /^https:\/\/api\.pokebonk\.com\/runs\/([^/?]+)\/finish(?:\?|$)/.exec(response.url());
    if (!match) return;
    summary.nativeFinishResponses.push({ at: Date.now(), case: currentCase, status: response.status(),
      runHash: digest("pokebonk-recovery-run:" + match[1]) });
  });
}
async function surfaces() {
  if (!browser?.isConnected()) {
    if (Date.now() < nextAttachAt) return false;
    nextAttachAt = Date.now() + 1000;
    browser = await chromium.connectOverCDP("http://127.0.0.1:9223", { timeout: 5000 });
  }
  if (!observedBrowsers.has(browser)) {
    observedBrowsers.add(browser); browser.on("context", observeContext);
  }
  browser.contexts().forEach(observeContext);
  const pages = browser.contexts().flatMap(context => context.pages()).filter(page => !page.isClosed()).reverse();
  const control = pages.find(page => page.url().startsWith("https://pilot.local/"));
  const candidate = pages.find(page => page.url().startsWith("https://pokebonk.com/"));
  if (!control || !candidate) {
    // WebView2 can recreate a CDP target without delivering the new target to
    // an otherwise connected Playwright browser. Re-read the endpoint inventory.
    browser = null;
    return false;
  }
  const host = await control.evaluate(() => desktop.getState());
  assert.equal(host.storage.root, root, "only the owned portable client may be controlled");
  assert.equal(host.version, info.version);
  panel = control; game = candidate; observePage(game);
  try { await game.evaluate(() => 0); }
  catch (error) {
    if (/crash|Target.*closed|Execution context|Cannot find context/i.test(String(error.message))) {
      // A CDP connection established DURING host backoff can itself acquire a
      // crashed Page. Keep the usable panel for cancellation, but re-discover
      // the Game on the next poll instead of caching that Page indefinitely.
      browser = null;
    } else throw error;
  }
  return true;
}
async function verifyIdentity() {
  if (!registered) {
    assert.equal(await game.evaluate(() => {
      const app = globalThis.__PB_BRIDGE?.app;
      return !!app && !app.meta?.account && !app.meta?.profile && !app.run;
    }), true, "a no-account fault test must never log in, create a guest, or start a match");
    return;
  }
  assert.equal(await game.evaluate(async expected => {
    const app = globalThis.__PB_BRIDGE?.app, account = app?.meta?.account;
    if (!account || account.guest !== false || !["string", "number"].includes(typeof account.id) || !app.meta.profile)
      return false;
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("pokebonk-dedicated-test:" + String(account.id)));
    return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, "0")).join("") === expected;
  }, expectedIdentityHash), true, "native identity is not the current authorized registered test account");
}
async function command(action, payload = {}) {
  await verifyIdentity();
  return panel.evaluate(({ action, payload }) => desktop.command(action, payload), { action, payload });
}
async function ready() {
  await wait(async () => await surfaces() &&
    await game.evaluate(needsProfile => !!globalThis.__PB_BRIDGE?.app &&
      (!needsProfile || !!__PB_BRIDGE.app.meta?.profile) && __PB_PILOT?.compatibility.state === "ready", registered),
  "authorized game bridge did not recover; owner login/captcha may be required", 150);
  await verifyIdentity();
}
async function connectionEvidence() {
  await wait(async () => {
    const host = await state(), c = host.connection;
    return c?.strategy === "browser-response-v1" && c.javascriptFeatures?.ok === true &&
      c.nativeBoot?.phase === "ready" && c.nativeBoot?.stage === "complete" &&
      c.events?.some(event => event.code === "game-module-transformed") &&
      c.sourceHash === host.compatibilityReport?.sourceHash;
  }, "same-browser script processing or native boot evidence is missing", 30);
  const c = (await state()).connection;
  assert.ok(Number.parseInt(c.runtimeVersion, 10) >= 98, "native runtime must meet the supported minimum");
  assert.equal(await game.evaluate(hash => globalThis.__PB_BRIDGE?.compatibility?.sourceHash === hash,
    c.sourceHash), true, "connected native bridge must use the browser response hash");
  for (const event of c.events || []) if (event.resource) {
    const url = new URL(event.resource);
    assert.equal(url.origin, "https://pokebonk.com");
    assert.ok(!url.search && !url.hash && !url.username && !url.password,
      "connection diagnostics must not include query, credentials, or fragments");
  }
  return { strategy: c.strategy, runtimeVersion: c.runtimeVersion, sourceHash: c.sourceHash,
    javascriptFeatureProbePassed: true, nativeBootReady: true, transformedResponseObserved: true,
    publicResourceDiagnosticsOnly: true, provesEveryUserComputerWorks: false };
}
async function runHash() {
  return game.evaluate(async () => {
    const id = __PB_BRIDGE.app.meta.ticket?.id;
    if (!id || !__PB_BRIDGE.app.run) return null;
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("pokebonk-recovery-run:" + id));
    return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, "0")).join("");
  });
}
async function readNative() {
  return game.evaluate(() => {
    const p = __PB_PILOT, app = __PB_BRIDGE.app, run = app.run;
    return { state: run?.state ?? null, time: run?.time ?? null, enabled: p.enabled,
      control: p.controlSnapshot(), health: p.snapshot().health,
      pending: app.meta.hasPending(), nativeLivePresent: !!app.backend.live,
      savedCardVisible: !!document.querySelector(".season-modal .cl-card, .season-modal .cl-modal") };
  });
}
async function startRun() {
  assert.equal(registered, true, "no-account maintenance cannot start gameplay");
  await ready();
  assert.equal(await game.evaluate(() => !__PB_BRIDGE.app.run || __PB_BRIDGE.app.run.state === "over"), true,
    "never adopt a preexisting active battle");
  await command("start");
  await wait(() => game.evaluate(() => __PB_BRIDGE.app.run?.state === "play" && __PB_PILOT.enabled), "native battle did not start");
  ownRunHash = await runHash(); assert.ok(ownRunHash, "the owned native battle requires a normal server ticket");
  await wait(() => game.evaluate(() => __PB_BRIDGE.app.run?.state === "play" &&
    __PB_BRIDGE.app.run.time >= 12 && !!__PB_BRIDGE.app.backend.live), "no natural live checkpoint before fault");
  return ownRunHash;
}
async function finishOwned() {
  await ready();
  const actual = await runHash();
  const exists = await game.evaluate(() => !!__PB_BRIDGE.app.run);
  if (!exists) return;
  assert.equal(actual, ownRunHash, "cleanup cannot finish a replacement or preexisting run");
  await command("pause");
  await game.evaluate(async () => {
    const app = __PB_BRIDGE.app;
    if (app.run && app.run.state !== "over") await app.run.finish(false, true);
  });
  await wait(() => game.evaluate(() => {
    const p = __PB_PILOT;
    return !__PB_BRIDGE.app.meta.hasPending() && p.events.some(event =>
      event.kind === "settlement" && event.saved === true && event.runAt === p.runStartedAt);
  }), "normal cleanup server receipt missing", 90);
  ownRunHash = null;
}
async function rendererCrash() {
  const oldPage = game;
  let observed = false, result = "pending";
  oldPage.once("crash", () => { observed = true; });
  const cdp = await oldPage.context().newCDPSession(oldPage);
  void cdp.send("Page.crash").then(() => { result = "returned"; }, () => { result = "protocol-disconnected-after-crash"; });
  await wait(() => observed, "real Page.crash event missing", 30);
  // Host Core.Reload happens outside Playwright. Its old Page can retain a
  // permanent crashed flag even after the native document is healthy again.
  // Re-discover CDP objects; never close the browser to clear test-side state.
  browser = panel = game = null;
  return { actualPageCrash: observed, result: () => result };
}
async function nativeReload(page = game) {
  const onDialog = dialog => {
    if (dialog.type() === "beforeunload") void dialog.accept();
    else void dialog.dismiss();
  };
  page.on("dialog", onDialog);
  let cdp;
  try {
    // A real Page.crash leaves Playwright's Page permanently marked crashed.
    // CDP reload addresses the owned native target without Browser.close.
    cdp = await page.context().newCDPSession(page);
    await cdp.send("Page.reload");
  } finally {
    await cdp?.detach().catch(() => {});
    page.off("dialog", onDialog); browser = panel = game = null;
  }
}
function receiptFor(hash, since) {
  return summary.nativeFinishResponses.find(response => response.runHash === hash &&
    response.at >= since && [200, 409].includes(response.status));
}
async function recoveryCompleted(oldHash, since) {
  await ready();
  await wait(async () => {
    await surfaces(); await verifyIdentity();
    const native = await readNative(), host = await state();
    const card = savedCards.find(card => card.observedAt >= since && card.rescued === true &&
      card.acknowledgedAt >= card.observedAt) ?? native.health?.nativeSavedCard;
    return receiptFor(oldHash, since) && !native.pending &&
      card?.rescued === true && card.acknowledgedAt >= card.observedAt &&
      host.recovery?.phase === "idle" && native.state === "play" && native.enabled &&
      await runHash() !== oldHash;
  }, "real interrupted-save/card acknowledgement and same-account next run were not confirmed", 180);
  const native = await readNative();
  ownRunHash = await runHash();
  return { sameAuthorizedIdentity: true, interruptedReceipt: receiptFor(oldHash, since),
    nativeSavedCard: savedCards.find(card => card.observedAt >= since && card.rescued === true &&
      card.acknowledgedAt >= card.observedAt) ?? native.health.nativeSavedCard, newNativeRun: true,
    originalBattleResumed: false, oldBattleCountsAsVictory: false,
    connection: await connectionEvidence() };
}
async function sampleRecovery() {
  if (sampling) return;
  sampling = true;
  try {
    if (!panel || child.exitCode !== null) return;
    const host = await state();
    const recovery = host.recovery;
    if (!recovery) return;
    const key = JSON.stringify([recovery.phase, recovery.attempts, recovery.wantedRun, recovery.generation]);
    if (summary.recoveryTimeline.at(-1)?.key !== key && summary.recoveryTimeline.length < 120)
      summary.recoveryTimeline.push({ at: Date.now(), case: currentCase, key, phase: recovery.phase,
        attempts: recovery.attempts, wantedRun: recovery.wantedRun, generation: recovery.generation,
        nextRetryAt: recovery.nextRetryAt, requiresLogin: recovery.requiresLogin });
    await writeProgress();
    if (game && !game.isClosed()) {
      const card = await game.evaluate(() => globalThis.__PB_PILOT?.snapshot?.().health?.nativeSavedCard ?? null);
      if (card && savedCards.length < 50 && !savedCards.some(old => old.observedAt === card.observedAt &&
          old.acknowledgedAt === card.acknowledgedAt)) savedCards.push(card);
      if (currentCase === "session" && summary.sessionObservations) {
        const authentication = await game.evaluate(() => globalThis.__PB_PILOT?.authenticationSnapshot?.().state ?? null);
        if (authentication === "native-login") summary.sessionObservations.nativeLoginFormObserved = true;
      }
    }
  } catch {} finally { sampling = false; }
}
async function armNoAccountIntent() {
  await ready(); await verifyIdentity();
  const result = await command("testArmRecoveryIntent");
  assert.equal(result.scope, "no-account-no-run-host-fixture");
  const recovery = (await state()).recovery;
  assert.equal(recovery.wantedRun, true);
  assert.equal(recovery.guestFallbackAuthorized, false,
    "synthetic host intent must never authorize native guest creation");
}
async function noAccountIdle() {
  await ready();
  await wait(async () => (await state()).recovery?.phase === "idle", "unarmed page did not recover to idle", 120);
  const before = await state();
  await delay(2300);
  const after = await state();
  await verifyIdentity();
  assert.equal(after.running, false); assert.equal(after.recovery.wantedRun, false);
  assert.equal(after.recovery.guestFallbackAuthorized, false);
  assert.equal(Boolean(after.game?.enabled), false); assert.equal(after.profile, null);
  assert.deepEqual(after.session, before.session, "no-account recovery cannot invent elapsed play or rewards");
  for (const key of ["runs", "completedRuns", "wins"]) assert.equal(after.session[key], 0);
  assert.ok(!(after.game?.events || []).some(event => event.kind === "settlement" && event.saved));
}
async function stableNoAccountReady(seconds) {
  const instance = await game.evaluate(() => __PB_PILOT.controlSnapshot().instance);
  const session = (await state()).session, until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    await delay(500);
    assert.equal(await surfaces(), true);
    await verifyIdentity();
    const host = await state();
    assert.equal(host.recovery.phase, "idle", "healthy ready page unexpectedly entered recovery again");
    assert.equal(host.running, false); assert.deepEqual(host.session, session);
    assert.equal(await game.evaluate(expected => __PB_PILOT.compatibility.state === "ready" &&
      __PB_PILOT.controlSnapshot().instance === expected && !__PB_PILOT.enabled &&
      !__PB_BRIDGE.app.meta?.account && !__PB_BRIDGE.app.run, instance), true,
    "healthy unarmed no-account document changed or lost its ready contract");
  }
}
async function slowMainCase() {
  const initial = await state();
  const resource = [...initial.connection.events].reverse().find(event => event.code === "game-module-transformed")?.resource;
  const url = new URL(resource);
  assert.equal(url.origin, "https://pokebonk.com"); assert.ok(!url.search && /\.m?js$/.test(url.pathname));
  const observedGame = game, cdp = await observedGame.context().newCDPSession(observedGame);
  await cdp.send("Network.enable");
  const requests = new Map(); let phase = "baseline", navigations = 0, ruleActive = false;
  const matches = value => { try { const parsed = new URL(value); return parsed.origin === url.origin && parsed.pathname === url.pathname; } catch { return false; } };
  const onRequest = event => {
    if (matches(event.request.url)) requests.set(event.requestId, { phase, start: event.timestamp });
  };
  const onResponse = event => {
    const item = requests.get(event.requestId); if (!item) return;
    item.httpStatus = event.response.status;
    const timing = event.response.timing;
    if (Number.isFinite(timing?.requestTime) && Number.isFinite(timing.receiveHeadersEnd) && timing.receiveHeadersEnd >= 0)
      item.headers = timing.requestTime + timing.receiveHeadersEnd / 1000;
  };
  const onFinished = event => {
    const item = requests.get(event.requestId); if (item) Object.assign(item, { finish: event.timestamp, encodedBytes: event.encodedDataLength });
  };
  const onNavigation = frame => { if (phase === "slow" && frame === observedGame.mainFrame()) navigations++; };
  cdp.on("Network.requestWillBeSent", onRequest); cdp.on("Network.responseReceived", onResponse);
  cdp.on("Network.loadingFinished", onFinished); observedGame.on("framenavigated", onNavigation);
  try {
    // First observe actual transfer bytes through a normal reload; do not use
    // source-text size or disable cache for this baseline/hot-cache check.
    await nativeReload(observedGame); await ready(); await connectionEvidence();
    await wait(() => [...requests.values()].some(item => item.phase === "baseline" && Number.isFinite(item.finish)),
      "baseline native module transfer was not observed", 15);
    const baseline = [...requests.values()].filter(item => item.phase === "baseline" && Number.isFinite(item.finish)).at(-1);
    const measuredBytes = baseline.encodedBytes > 0 ? baseline.encodedBytes : null;
    const throughput = measuredBytes ? Math.max(1024, Math.ceil(measuredBytes / 30)) : 24 * 1024;
    let rule;
    try {
      rule = await cdp.send("Network.emulateNetworkConditionsByRule", { offline: false,
        matchedNetworkConditions: [{ urlPattern: url.href, latency: 50000,
          downloadThroughput: throughput, uploadThroughput: -1 }] });
    } catch (error) {
      if (!/not found|wasn.t found|unknown method|not supported/i.test(String(error.message))) throw error;
      return { performed: false, passed: false, notTested: true,
        reason: "experimental per-URL network emulation is unavailable in this runtime",
        protocolMethod: "Network.emulateNetworkConditionsByRule", baselineNormalReloadVerified: true,
        noAccountCreated: true, noMatchStarted: true };
    }
    assert.equal(rule.ruleIds?.length, 1, "one actual game-module URL must have one network rule"); ruleActive = true;
    // Force a real module transfer only for the slow case. Other resource URLs
    // have no throughput rule; navigator and native game values stay unchanged.
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    phase = "slow";
    const oldInstance = await game.evaluate(() => __PB_PILOT.controlSnapshot().instance);
    await nativeReload(game); await ready(); await noAccountIdle();
    await wait(() => [...requests.values()].some(item => item.phase === "slow" && Number.isFinite(item.finish)),
      "slow native module transfer did not finish", 15);
    const slow = [...requests.values()].filter(item => item.phase === "slow" && Number.isFinite(item.finish)).at(-1);
    const durationMs = (slow.finish - slow.start) * 1000;
    assert.ok(durationMs > 45000, "the actual native request must cross the old 45-second threshold");
    assert.equal(navigations, 1, "slow native loading must not cause a repeated reload loop");
    assert.equal(await game.evaluate(old => __PB_PILOT.controlSnapshot().instance !== old, oldInstance), true);
    const bodyDurationMs = Number.isFinite(slow.headers) && slow.headers >= slow.start && slow.headers <= slow.finish
      ? (slow.finish - slow.headers) * 1000 : null;
    return { performed: true, passed: true, protocolMethod: "Network.emulateNetworkConditionsByRule",
      publicModulePath: url.origin + url.pathname, exactModuleRuleOnly: true, navigatorStateModified: false,
      baselineNormalReloadVerified: true, baselineEncodedBytes: measuredBytes,
      targetDownloadBytesPerSecond: throughput, targetLatencyMs: 50000, actualRequestDurationMs: durationMs,
      actualEncodedBytes: slow.encodedBytes, bodyDurationMs,
      bodyTimingSource: bodyDurationMs === null ? "not-observed" : "Network.Response.timing.receiveHeadersEnd to loadingFinished",
      bodyWaitAbove15SecondsCovered: bodyDurationMs !== null && bodyDurationMs > 15000,
      bodyTimingLimitation: "Fetch response replacement may affect Network timing; absent or short body timing does not establish a >15-second body-read regression.",
      noAutomaticReloadLoop: true, freshDocumentReady: true, noAccountCreated: true, noMatchStarted: true };
  } finally {
    observedGame.off("framenavigated", onNavigation);
    cdp.off("Network.requestWillBeSent", onRequest); cdp.off("Network.responseReceived", onResponse); cdp.off("Network.loadingFinished", onFinished);
    if (ruleActive) await cdp.send("Network.emulateNetworkConditionsByRule", { offline: false, matchedNetworkConditions: [] }).catch(() => {});
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: false }).catch(() => {}); await cdp.detach().catch(() => {});
  }
}
async function noAccountWaitReason() {
  const host=await state(),r=host.recovery;
  if(!r?.wantedRun)return null;
  const authentication=await game.evaluate(()=>globalThis.__PB_PILOT?.authenticationSnapshot?.().state??null);
  if(authentication==="maintenance" && ["blocked","waiting"].includes(r.phase))
    return {kind:"official-maintenance",phase:r.phase,requiresLogin:r.requiresLogin===true,nativeAuthentication:authentication};
  if(authentication!=="maintenance" && authentication!=="banned" && r.requiresLogin && ["login","waiting"].includes(r.phase))
    return {kind:"original-login-required",phase:r.phase,requiresLogin:true,nativeAuthentication:authentication};
  return null;
}
async function noAccountCases() {
  for (const kind of cases) {
    currentCase = kind;
    await writeProgress();
    await noAccountIdle();
    if (kind === "cold") {
      const oldInstance = await game.evaluate(() => __PB_PILOT.controlSnapshot().instance);
      await nativeReload(); await noAccountIdle();
      assert.equal(await game.evaluate(old => __PB_PILOT.controlSnapshot().instance !== old, oldInstance), true);
      summary.cases.cold = { freshStaticPayloadOnly: true, initialColdBootReady: true,
        normalReloadWithNativeCacheVerified: true, cacheOverrideUsed: false, newDocumentReady: true,
        noAccountCreated: true, noMatchStarted: true, chineseAndSpaceRoot: chinesePath };
    } else if (kind === "slow") {
      summary.cases.slow = await slowMainCase();
    } else if (kind === "crash") {
      const crash = await rendererCrash();
      await noAccountIdle();
      await stableNoAccountReady(60);
      summary.cases.crash = { actualPageCrash: true, commandResult: crash.result(), automaticallyReady: true,
        noAccountCreated: true, noMatchStarted: true, noFalseSettlement: true, statisticsStable: true,
        stableReadySeconds: 60, sameDocumentThroughoutStableReady: true };
    } else if (kind === "browser") {
      // The endpoint was absent before OUR child launch and its panel root was
      // checked above. Crash only that isolated browser, never Browser.close.
      const beforePanel = panel, beforeGame = game, oldBrowser = browser;
      const browserCdp = await oldBrowser.newBrowserCDPSession();
      let result = "pending";
      void browserCdp.send("Browser.crash").then(() => { result = "returned"; },
        () => { result = "protocol-disconnected-after-browser-crash"; });
      await wait(() => !oldBrowser.isConnected() || beforePanel.isClosed() || beforeGame.isClosed(),
        "owned Browser.crash did not invalidate its old browser/surfaces", 30);
      browser = panel = game = null;
      await noAccountIdle();
      assert.notEqual(panel, beforePanel); assert.notEqual(game, beforeGame);
      summary.cases.browser = { actualOwnedBrowserCrashRequested: true, commandResult: result,
        replacementEndpointDiscovered: true, gameAndPanelRecreated: true, samePortableRoot: true,
        automaticallyReady: true, noAccountCreated: true, noMatchStarted: true };
    } else if (kind === "intent") {
      await armNoAccountIntent();
      const crash = await rendererCrash();
      await ready();
      let waitReason;
      await wait(async()=>!!(waitReason=await noAccountWaitReason()),
        "unbound intent did not wait for original login or verified official maintenance",120);
      await verifyIdentity();
      const login = (await state()).recovery;
      assert.equal(login.wantedRun,true);
      assert.ok(waitReason.kind==="official-maintenance"||login.requiresLogin===true);
      assert.equal(login.guestFallbackAuthorized, false);
      assert.equal(await game.evaluate(() => !!__PB_BRIDGE.app.run || __PB_PILOT.enabled), false);
      await command("pause"); await noAccountIdle();
      summary.cases.intent = { actualPageCrash: crash.actualPageCrash, hostOnlyFixture: true,
        wantedRunPreserved:true,requiresLoginWithoutGuest:login.requiresLogin===true,observedLoginPhase:login.phase,
        waitingReason:waitReason.kind,nativeMaintenanceObserved:waitReason.nativeAuthentication==="maintenance",
        guestFallbackAuthorized: false, explicitPauseCancelled: true };
    } else if (kind === "network") {
      const observedGame = game;
      const cdp = await observedGame.context().newCDPSession(observedGame);
      await cdp.send("Network.enable");
      const offline = value => cdp.send("Network.emulateNetworkConditions",
        { offline: value, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      let healthyNavigations = 0;
      const countNavigation = frame => { if (frame === observedGame.mainFrame()) healthyNavigations++; };
      observedGame.on("framenavigated", countNavigation);
      try {
        await offline(true); await delay(8000);
        await verifyIdentity(); assert.equal(healthyNavigations, 0, "healthy menu should not reload for a brief network outage");
        await armNoAccountIntent();
        await nativeReload().catch(() => {});
        await delay(4000);
        await offline(false);
        await ready();
        let waitReason;
        await wait(async()=>!!(waitReason=await noAccountWaitReason()),
          "offline startup did not reconnect and preserve unbound intent or verified maintenance wait",150);
        const host = await state();
        assert.equal(host.recovery.wantedRun, true); await verifyIdentity();
        assert.equal(host.recovery.guestFallbackAuthorized, false);
        await command("pause"); await noAccountIdle();
        summary.cases.network = { healthyMenuOfflineNoReload: true, targetOnlyOffline: true,
          startupReloadWhileOffline: true, reconnectedAfterOnline: true, wantedRunPreserved: true,
          loginRequiredWithoutGuest:host.recovery.requiresLogin===true,observedLoginPhase:host.recovery.phase,
          waitingReason:waitReason.kind,nativeMaintenanceObserved:waitReason.nativeAuthentication==="maintenance",
          guestFallbackAuthorized: false, explicitPauseCancelled: true };
      } finally {
        observedGame.off("framenavigated", countNavigation);
        await offline(false).catch(() => {}); await cdp.detach().catch(() => {});
      }
    } else if (kind === "stop") {
      await armNoAccountIntent();
      const cancelPanel = panel, cleanupGame = game;
      const crash = await rendererCrash();
      await wait(async () => (await cancelPanel.evaluate(() => desktop.getState())).recovery?.phase === "waiting",
        "recovery backoff was not observable", 20);
      const before = (await cancelPanel.evaluate(() => desktop.getState())).recovery;
      await cancelPanel.evaluate(() => desktop.command("pause", {})).catch(() => {});
      const stopped = (await cancelPanel.evaluate(() => desktop.getState())).recovery;
      assert.equal(stopped.wantedRun, false); assert.ok(stopped.generation > before.generation);
      assert.equal(stopped.guestFallbackAuthorized, false);
      await delay(7500);
      assert.equal((await cancelPanel.evaluate(() => desktop.getState())).recovery.wantedRun, false);
      // Cancellation may leave the deliberately crashed page unrepaired.
      // This explicit cleanup is never reported as automatic recovery.
      await nativeReload(cleanupGame).catch(() => {});
      await noAccountIdle();
      summary.cases.stop = { actualPageCrash: crash.actualPageCrash, hostOnlyFixture: true,
        cancelledDuringBackoff: true, generationAdvanced: true, noDelayedStart: true,
        guestFallbackAuthorized: false, explicitCleanupReload: true };
    }
    summary.cases[kind].connection = await connectionEvidence();
    await writeProgress();
  }
}
try {
  await ready();
  summary.initialConnection = await connectionEvidence();
  assert.equal(await game.evaluate(() => !!__PB_BRIDGE.app.run && __PB_BRIDGE.app.run.state !== "over"), false,
    "owner must finish any earlier battle before this isolated regression");
  sampler = setInterval(() => { void sampleRecovery(); }, 100);
  if (!registered) await noAccountCases();
  else {
  const initial = await state();
  previousConfig = Object.fromEntries(["autoRestart", "autoUpgrade", "safeMode", "expertMode", "mode"]
    .map(key => [key, initial.config[key]]));
  await command("config", { autoRestart: true, autoUpgrade: false, safeMode: true, expertMode: false, mode: "resources" });
  if (cases.includes("crash")) {
    currentCase = "crash";
    const oldHash = await startRun(), since = Date.now(), crash = await rendererCrash();
    summary.cases.crash = { actualPageCrash: crash.actualPageCrash, ...await recoveryCompleted(oldHash, since),
      crashCommandResult: crash.result() };
    await finishOwned();
  }
  if (cases.includes("network")) {
    currentCase = "network";
    const oldHash = await startRun(), before = await readNative();
    const cdp = await game.context().newCDPSession(game);
    await cdp.send("Network.enable");
    const offline = value => cdp.send("Network.emulateNetworkConditions",
      { offline: value, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    try {
      await offline(true); await delay(8000);
      await verifyIdentity();
      const healthy = await readNative();
      assert.equal(await runHash(), oldHash);
      assert.equal(healthy.state, "play"); assert.ok(healthy.time > before.time + 2);
      const since = Date.now();
      await nativeReload().catch(() => {});
      await delay(4000);
      await offline(false);
      summary.cases.network = { healthyOfflineNoReload: true, healthyBattleAdvanced: true,
        targetOnlyOffline: true, startupReloadWhileOffline: true,
        ...await recoveryCompleted(oldHash, since) };
    } finally { await offline(false).catch(() => {}); await cdp.detach().catch(() => {}); }
    await finishOwned();
  }
  if (cases.includes("stop")) {
    currentCase = "stop";
    const oldHash = await startRun(), since = Date.now(), cancelPanel = panel, cleanupGame = game;
    const crash = await rendererCrash();
    await wait(async () => (await cancelPanel.evaluate(() => desktop.getState())).recovery?.phase === "waiting",
      "recovery backoff was not observable", 20);
    const before = (await cancelPanel.evaluate(() => desktop.getState())).recovery;
    // Control cancellation is native and must work while the crashed GameView
    // cannot answer an identity probe or a script command.
    await cancelPanel.evaluate(() => desktop.command("pause", {})).catch(() => {});
    const stopped = (await cancelPanel.evaluate(() => desktop.getState())).recovery;
    assert.equal(stopped.wantedRun, false); assert.ok(stopped.generation > before.generation);
    await delay(7500);
    assert.equal((await cancelPanel.evaluate(() => desktop.getState())).recovery.wantedRun, false);
    // Explicit test cleanup navigation repairs the page without authorizing
    // automation; this is not claimed as automatic repair after cancellation.
    await nativeReload(cleanupGame).catch(() => {});
    await ready();
    await wait(() => receiptFor(oldHash, since) && game.evaluate(() => !__PB_BRIDGE.app.meta.hasPending()),
      "cancelled trial native interrupted save was not acknowledged", 150);
    await delay(5000);
    const native = await readNative(), host = await state();
    assert.equal(host.recovery.wantedRun, false); assert.equal(native.enabled, false); assert.equal(native.state, null);
    summary.cases.stop = { actualPageCrash: crash.actualPageCrash, cancelledDuringBackoff: true,
      generationAdvanced: true, noDelayedStart: true, sameAuthorizedIdentity: true,
      interruptedReceipt: receiptFor(oldHash, since), explicitCleanupReload: true };
    ownRunHash = null;
  }
  if (cases.includes("session")) {
    currentCase = "session";
    await ready();
    const login = (await state()).recoveryLogin;
    assert.equal(login?.saved, true, "owner must explicitly save current-account recovery login locally before this case");
    assert.equal(login?.complete, true, "session-loss testing requires a complete local login record, never a draft");
    assert.equal(login.blocked, false, "blocked recovery credentials cannot be used by this test");
    const successCount = (await state()).logs.filter(log => log.title === "自动重登成功").length;
    summary.sessionObservations = { nativeLoginFormObserved: false, credentialsRead: false };
    const oldHash = await startRun(), since = Date.now();
    // Remove ONLY the cached session key, without reading its value, logging
    // out on the server, or touching native live/pending/checkpoint records.
    await verifyIdentity();
    await game.evaluate(() => localStorage.removeItem("pb.session"));
    sessionRecoveryIncomplete = true;
    await nativeReload();
    const recovered = await recoveryCompleted(oldHash, since);
    sessionRecoveryIncomplete = false;
    const autoReloginLogObserved = (await state()).logs.filter(log => log.title === "自动重登成功").length > successCount;
    assert.equal(autoReloginLogObserved, true, "a cached-session-loss trial must confirm the host's original-account relogin");
    summary.cases.session = { ...recovered, sessionLocalOnly: true, serverLogoutCalled: false,
      credentialsRead: false, nativePendingAndLiveUntouched: true, nativeReload: true,
      autoReloginLogObserved, nativeLoginFormObserved: summary.sessionObservations.nativeLoginFormObserved,
      simulatesServerTokenRevocation: false };
    await finishOwned();
  }
  }
  currentCase = "cleanup";
  await ready(); await command("pause");
  if (previousConfig) await command("config", previousConfig);
  await command("testClose");
  await wait(() => child.exitCode !== null, "owned client did not close normally", 30, true);
  assert.equal(child.exitCode, 0);
  summary.normalOwnedShutdown = true; summary.passed = true;
} catch (error) {
  summary.reason = String(error.message).slice(0, 500); process.exitCode = 1;
} finally {
  clearInterval(sampler);
  if (sessionRecoveryIncomplete) {
    summary.manualCloseRequired = true;
    summary.cleanupDeferred = "local-session recovery incomplete; native live/pending preserved, no unauthenticated finish or logout";
  } else if (child.exitCode === null) {
    try {
      await surfaces(); await verifyIdentity();
      if (ownRunHash) await finishOwned();
      if (previousConfig) await command("config", previousConfig);
      await command("testClose");
      await wait(() => child.exitCode !== null, "owned cleanup close pending", 30, true);
    } catch { summary.manualCloseRequired = true; }
  }
  summary.endedAt = new Date().toISOString();
  await writeFile(path.join(output, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify({ passed: summary.passed, reason: summary.reason, output, cases: Object.keys(summary.cases) }));
  // Dropping this test process's CDP socket never sends Browser.close to a
  // replacement browser. An unverified client is explicitly left for its owner.
  if (summary.manualCloseRequired) process.exit(1);
}
