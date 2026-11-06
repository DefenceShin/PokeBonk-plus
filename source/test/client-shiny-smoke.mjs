// Run manually after the ordinary native-client smoke test has finished.
// Requires an already-open --smoke --guest client with CDP on localhost:9223.
// Uses normal UI configuration, normal play and normal settlement only.
// Does not create a shiny, alter RNG, edit a profile or grant/spend supplies.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { describeShinyTargets } from '../src/shiny.mjs';
// Historical guest-era fixture below is retained for provenance, not current QA.
throw new Error('HISTORICAL_LIVE_HARNESS_DISABLED_018: Historical shiny smoke is source-only and disabled for every client/account. No flag authorizes its old finish/close cleanup; current validation preserves active runs until native ending/death and confirmed save.');

const output = new URL('../artifacts/client-shiny/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const pages = browser.contexts().flatMap(context => context.pages());
const panel = pages.find(page => page.url().startsWith('https://pilot.local/'));
const game = pages.find(page => page.url().startsWith('https://pokebonk.com/'));
assert.ok(panel && game, 'native client exposes both local UI and game surfaces');
const errors = [];
panel.on('pageerror', error => errors.push({ surface: 'panel', message: error.message }));
game.on('pageerror', error => errors.push({ surface: 'game', message: error.message }));
const snapshots = [];
let originalConfig;
let ownRunStarted = false;
let validation;
let failure;
const getState = () => panel.evaluate(() => desktop.getState());
const command = (action, payload = {}) => panel.evaluate(({ action, payload }) => desktop.command(action, payload), { action, payload });
async function waitForState(predicate, message, timeout = 15000) {
  const deadline = Date.now() + timeout;
  do {
    const state = await getState();
    if (predicate(state)) return state;
    await delay(250);
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${message}`);
}
async function waitForConfig(patch) {
  return waitForState(state => Object.entries(patch).every(([key, value]) => state.config?.[key] === value), `config ${JSON.stringify(patch)}`);
}
async function screenshot(name) {
  await panel.screenshot({ path: new URL(name, output).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
}

try {
  await panel.waitForFunction(() => !!window.desktop, null, { timeout: 30000 });
  await game.waitForFunction(() => !!globalThis.__PB_PILOT?.app?.meta?.profile?.starter, null, { timeout: 90000 });
  assert.equal(await game.evaluate(() => globalThis.__PB_PILOT.app.meta.account?.guest), true,
    'this smoke script must never operate a registered player account');
  const existing = await game.evaluate(() => ({ state: __PB_BRIDGE.app.run?.state, pending: __PB_BRIDGE.app.meta.hasPending() }));
  assert.ok(!existing.state || existing.state === 'over',
    'finish the other smoke test first; this script does not interrupt its active match');
  assert.equal(existing.pending, false, 'wait for previous results to save before this smoke test');
  const initial = await getState();
  originalConfig = { ...initial.config };
  await command('config', { autoRestart: false });
  await command('pause');

  const catalog = await panel.evaluate(() => desktop.getCatalog());
  assert.equal(catalog.shinyTargets?.length, 151, 'native catalog lists all 151 exact species');
  assert.equal(new Set(catalog.shinyTargets.map(target => target.id)).size, 151);
  assert.deepEqual(catalog.shinyTargets.map(target => target.id).sort((a, b) => a - b), Array.from({ length: 151 }, (_, i) => i + 1));
  await command('config', { mode: 'shiny', shinyMode: 'missing', shinyTargetId: null,
    shinyStopWhenDone: true, shinyUseStone: false, biome: 'auto', tier: 0, characterId: null,
    build: 'auto', autoUpgrade: false, autoClaim: false, autoRestart: false, fps: 60 });
  await waitForConfig({ mode: 'shiny', shinyMode: 'missing', shinyUseStone: false });
  const dynamic = await waitForState(state => state.game?.shiny?.targets?.length === 151, 'live profile target availability');
  assert.deepEqual(dynamic.profile.shinies, dynamic.game.profile.shinies, 'native profile and pilot profile use the same exact collection');
  assert.equal(dynamic.game.shiny.owned, dynamic.profile.shinies.length);
  const runtime = await game.evaluate(() => {
    const bridge = __PB_BRIDGE;
    const profile = bridge.app.meta.profile;
    return { profile: { league: profile.league.slice(), shinies: (profile.shinies || []).slice(),
      biomes: { ...profile.biomes }, counters: { ...profile.counters } },
    ready: bridge.app.meta.leagueReady(), roster: bridge.roster,
    biomes: bridge.biomes.map(biome => ({ ...biome, live: bridge.biomeLive(biome.id) })),
    pokemon: bridge.data.pokemon };
  });
  const shinyCatalog = JSON.parse(await readFile(new URL('../data/shiny-catalog.json', import.meta.url), 'utf8'));
  const byId = new Map(runtime.pokemon.map(mon => [mon.id, mon]));
  const expected = describeShinyTargets(runtime.profile, dynamic.config, {
    shinyCatalog, roster: runtime.roster, biomes: runtime.biomes,
    data: { pokemon: runtime.pokemon, get: id => byId.get(id) },
    meta: { leagueReady: () => runtime.ready },
  });
  for (const target of dynamic.game.shiny.targets) {
    const source = expected.find(entry => entry.id === target.id);
    assert.equal(target.availability, source.availability, `dynamic source state for #${target.id}`);
    assert.equal(target.owned, runtime.profile.shinies.includes(target.id), `exact ownership for #${target.id}`);
    assert.equal(target.huntable, target.availability === 'available');
  }
  const validTarget = dynamic.game.shiny.targets.find(target => target.huntable && !target.owned);
  const blockedTarget = dynamic.game.shiny.targets.find(target => !target.huntable);
  assert.ok(validTarget && blockedTarget, 'real guest exposes both available and unavailable choices');

  await panel.locator('[data-tab="modes"]').click();
  await panel.locator('[data-mode="shiny"]').click();
  await panel.locator('[data-shiny-mode="missing"]').click();
  await waitForConfig({ shinyMode: 'missing' });
  assert.equal(await panel.locator('#shiny-options').isVisible(), true);
  assert.equal(await panel.locator('#shiny-target-picker').isVisible(), false);
  await screenshot('01-missing.png');
  await panel.locator('[data-shiny-mode="target"]').click();
  await waitForConfig({ shinyMode: 'target' });
  assert.equal(await panel.locator('#shiny-target-picker').isVisible(), true);
  await panel.locator('#shiny-search').fill(validTarget.name);
  const validCard = panel.locator(`[data-shiny-target="${validTarget.id}"]`);
  await validCard.waitFor({ state: 'visible' });
  assert.equal(await validCard.isEnabled(), true);
  await validCard.click();
  await waitForConfig({ shinyTargetId: validTarget.id });
  await screenshot('02-target-valid.png');
  await panel.locator('#shiny-search').fill(blockedTarget.name);
  const blockedCard = panel.locator(`[data-shiny-target="${blockedTarget.id}"]`);
  await blockedCard.waitFor({ state: 'visible' });
  assert.equal(await blockedCard.isDisabled(), true, 'unavailable source is not selectable');
  assert.equal((await getState()).config.shinyTargetId, validTarget.id, 'searching unavailable entry preserves selected target');
  await screenshot('03-target-unavailable.png');
  await panel.locator('#shiny-search').fill('this-species-does-not-exist-99999');
  assert.equal(await panel.locator('[data-shiny-target]').count(), 0, 'unmatched search has no false target');
  assert.match(await panel.locator('#shiny-target-list').innerText(), /没有匹配/);
  await screenshot('04-empty-search.png');
  await panel.locator('#shiny-search').fill('');
  assert.equal(await panel.locator('[data-shiny-target]').count(), 151);

  // Only configure the supply toggle; do not start with it enabled or spend it.
  const stoneBefore = dynamic.profile.shinyStones ?? dynamic.game.shiny.stones;
  await panel.locator('#shiny-stop-when-done').setChecked(false, { force: true });
  await waitForConfig({ shinyStopWhenDone: false });
  await panel.locator('#shiny-use-stone').setChecked(true, { force: true });
  await waitForConfig({ shinyUseStone: true });
  await panel.reload();
  await panel.waitForFunction(() => !!window.desktop, null, { timeout: 30000 });
  await panel.locator('[data-tab="modes"]').click();
  const roundTrip = await getState();
  assert.equal(roundTrip.config.shinyTargetId, validTarget.id);
  assert.equal(roundTrip.config.shinyMode, 'target');
  assert.equal(roundTrip.config.shinyStopWhenDone, false);
  assert.equal(roundTrip.config.shinyUseStone, true);
  assert.equal(await panel.locator('#shiny-use-stone').isChecked(), true);
  assert.equal(await panel.locator('#shiny-stop-when-done').isChecked(), false);
  assert.equal(roundTrip.profile.shinyStones ?? roundTrip.game.shiny.stones, stoneBefore, 'configuration alone does not consume supply');
  await panel.locator('#shiny-use-stone').setChecked(false, { force: true });
  await waitForConfig({ shinyUseStone: false });
  await command('config', { shinyTargetId: 999 });
  const invalid = await waitForConfig({ shinyTargetId: null });
  assert.equal(invalid.config.shinyTargetId, null, 'native schema rejects out-of-range species');
  await waitForState(state => state.config.shinyTargetId === null, 'invalid target reflected');
  await panel.waitForFunction(() => document.getElementById('main-action').disabled);
  await screenshot('05-invalid-target.png');

  // Run real gameplay for 60 seconds, without supplies or synthetic encounters.
  await command('config', { mode: 'shiny', shinyMode: 'missing', shinyTargetId: null,
    shinyStopWhenDone: true, shinyUseStone: false, autoUpgrade: false, autoClaim: false, autoRestart: false });
  await waitForConfig({ shinyMode: 'missing', shinyUseStone: false, autoRestart: false });
  const before = await game.evaluate(() => __PB_PILOT.snapshot());
  await command('start');
  ownRunStarted = true;
  await game.waitForFunction(() => __PB_BRIDGE.app.run?.state === 'play', null, { timeout: 60000 });
  const began = Date.now();
  const firstPlan = await game.evaluate(() => ({ mode: __PB_BRIDGE.app.run.mode, objective: __PB_PILOT.plan.objective,
    shinyMode: __PB_PILOT.plan.shinyMode, boosts: [...__PB_BRIDGE.app.run.boosts] }));
  assert.equal(firstPlan.mode, 'standard');
  assert.equal(firstPlan.objective, 'shiny');
  assert.equal(firstPlan.shinyMode, 'missing');
  assert.equal(firstPlan.boosts.includes('shiny-stone'), false);
  do {
    const snapshot = await game.evaluate(() => __PB_PILOT.snapshot());
    if (snapshot.shiny) delete snapshot.shiny.targets; // Availability was checked above; avoid repeating 151 rows in every sample.
    snapshots.push({ observedAt: new Date().toISOString(), ...snapshot });
    console.log(JSON.stringify({ phase: 'real-shiny-gameplay', elapsedSeconds: Math.round((Date.now() - began) / 1000),
      state: snapshot.state, time: snapshot.time, kills: snapshot.kills, hp: snapshot.hp,
      encounters: snapshot.shiny?.encounters, captures: snapshot.shiny?.captures, p95: snapshot.p95DecisionMs }));
    if (snapshot.state === 'over' && Date.now() - began < 60000) {
      await game.waitForFunction(() => __PB_BRIDGE.app.run.sent && !__PB_BRIDGE.app.meta.hasPending(), null, { timeout: 30000 });
      await command('start');
      await game.waitForFunction(() => __PB_BRIDGE.app.run?.state === 'play', null, { timeout: 60000 });
    }
    if (Date.now() - began >= 60000) break;
    await delay(Math.min(5000, 60000 - (Date.now() - began)));
  } while (true);
  const preFinish = await game.evaluate(() => ({ snapshot: __PB_PILOT.snapshot(), runAt: __PB_PILOT.runStartedAt,
    runShinies: __PB_BRIDGE.app.run.stats.shinies.slice() }));
  await panel.locator('[data-tab="modes"]').click();
  await screenshot('06-after-real-play.png');
  await game.screenshot({ path: new URL('07-game.png', output).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
  await command('config', { autoRestart: false });
  await game.evaluate(async () => {
    const run = __PB_BRIDGE.app.run;
    if (run && run.state !== 'over') await run.finish(false, true);
  });
  await game.waitForFunction(runAt => __PB_PILOT.events.some(event => event.kind === 'settlement' && event.saved && event.runAt === runAt), preFinish.runAt, { timeout: 45000 });
  const saved = await game.evaluate(runAt => __PB_PILOT.events.find(event => event.kind === 'settlement' && event.saved && event.runAt === runAt), preFinish.runAt);
  assert.ok(saved.saved, 'only a successful normal endRun response confirms saving');
  assert.deepEqual(saved.shinies, preFinish.runShinies, 'settlement reports only actually captured shinies');
  const finalState = await waitForState(state => state.game?.events?.some(event => event.id === saved.id && event.saved) &&
    state.logs?.some(log => log.type === 'result' && log.message?.includes('已保存') && (!log.runId || log.runId === saved.id)), 'native saved result log', 20000);
  const after = await game.evaluate(() => __PB_PILOT.snapshot());
  const encounterDelta = Math.max(0, (after.shiny?.encounters || 0) - (before.shiny?.encounters || 0));
  const captureDelta = Math.max(0, (after.shiny?.captures || 0) - (before.shiny?.captures || 0));
  const shinyEvents = after.events.filter(event => event.at >= began && ['shinyEncounter', 'shinyCapture'].includes(event.kind));
  assert.ok(snapshots.some(snapshot => snapshot.state === 'play' && snapshot.time > 0), 'real normal game updates advanced');
  assert.ok(snapshots.some(snapshot => Number.isFinite(snapshot.p95DecisionMs)), 'performance was measured during actual play');
  assert.deepEqual(errors, [], 'no browser-surface JavaScript exceptions');
  validation = { passed: true, startedAt: new Date(began).toISOString(), endedAt: new Date().toISOString(),
    catalog: { species: catalog.shinyTargets.length, dynamicallyChecked: expected.length },
    ui: { validTarget: validTarget.id, blockedTarget: blockedTarget.id, searchedModes: ['missing', 'target'], configurationRoundTrip: true },
    realGameplay: { wallSeconds: (Date.now() - began) / 1000, firstPlan, snapshots, preFinish: preFinish.snapshot,
      encounters: encounterDelta, captures: captureDelta, shinyEvents, settlement: saved },
    session: finalState.session, errors,
    limits: encounterDelta === 0 ? '自然遭遇异色 0 次、捕获 0 次。本次验证真实挂机、来源、UI和正常保存；未验证自然异色捕获，不证明出现概率或长期刷取效率。' :
      `自然遭遇 ${encounterDelta} 次、捕获 ${captureDelta} 次，详见真实事件记录。短时烟雾测试不证明概率、全目标可达或长期效率。` };
} catch (error) {
  failure = error;
  validation = { passed: false, at: new Date().toISOString(), error: String(error.stack || error), snapshots, errors };
} finally {
  // Never leave the smoke client auto-running after this isolated validation.
  if (originalConfig) {
    try {
      await command('config', { ...originalConfig, autoRestart: false, shinyUseStone: false });
      if (ownRunStarted) {
        await game.evaluate(async () => { const run = __PB_BRIDGE.app.run; if (run && run.state !== 'over') await run.finish(false, true); });
      }
      await command('pause');
      validation.restoredConfig = (await getState()).config;
    } catch (error) {
      validation.cleanupError = String(error.message || error);
      failure ||= error;
      validation.passed = false;
    }
  }
  await writeFile(new URL('smoke-result.json', output), JSON.stringify(validation, null, 2) + '\n');
  await browser.close();
}
console.log(JSON.stringify({ passed: validation.passed, encounters: validation.realGameplay?.encounters ?? 0,
  captures: validation.realGameplay?.captures ?? 0, error: validation.error, output: 'artifacts/client-shiny/smoke-result.json' }));
if (failure) throw failure;
