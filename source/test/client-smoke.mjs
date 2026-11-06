import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
// Historical guest-era fixture below is retained for provenance, not current QA.
throw new Error('HISTORICAL_LIVE_HARNESS_DISABLED_018: Historical guest smoke is source-only and disabled for every client/account. No flag authorizes its old finish/close cleanup; current validation preserves active runs until native ending/death and confirmed save.');
const productionGuest = process.argv.includes('--production-guest');
const artifactDir = productionGuest ? `artifacts/client-guest-production/${new Date().toISOString().replace(/[:.]/g,'-')}` : 'artifacts/client';

let browser;
for (let attempt=0;attempt<120;attempt++) {
  try { browser=await chromium.connectOverCDP('http://127.0.0.1:9223'); break; }
  catch (error) { if(attempt===119) throw error; await new Promise(resolve=>setTimeout(resolve,250)); }
}
let panel, game;
// The debug endpoint opens before both WebViews finish creating their tabs.
for (let i=0;i<120;i++) {
  const pages=browser.contexts().flatMap(c=>c.pages());
  panel=pages.find(p=>p.url().startsWith('https://pilot.local/'));
  game=pages.find(p=>p.url().startsWith('https://pokebonk.com/'));
  if(panel&&game)break;
  await new Promise(resolve=>setTimeout(resolve,250));
}
assert.ok(panel && game, 'both embedded surfaces are present');
const errors = [];
panel.on('pageerror', e => errors.push(e.message));
game.on('pageerror', e => errors.push(e.message));
await panel.waitForFunction(() => !!window.desktop, undefined, { timeout: 30000, polling: 100 });
const catalog = await panel.evaluate(() => desktop.getCatalog());
assert.equal(catalog.characters.length, 79);
assert.ok(catalog.builds.filter(v => v.victory).length >= 658);
const initial = await panel.evaluate(() => desktop.getState());
console.log('initial', JSON.stringify({status:initial.status,profile:!!initial.profile}));
if(productionGuest) {
  assert.equal(initial.version,'0.5.1');
  assert.equal(initial.diagnostics?.isolatedStorage,true);
  assert.equal(initial.diagnostics?.automaticGuestEntry,false,'normal guest access does not depend on the --guest automation flag');
}
await game.waitForFunction(() => !!globalThis.__PB_PILOT?.app?.meta?.profile?.starter, undefined, { timeout: 90000, polling: 100 });
if(productionGuest) assert.equal(await game.evaluate(()=>__PB_PILOT.snapshot().accountType),'guest','use an existing real guest session');
await panel.evaluate(() => desktop.command('config', { mode:'map', characterId:1, biome:'auto', build:'auto', fps:60, autoUpgrade:false }));
await panel.evaluate(() => desktop.command('start'));
await game.waitForFunction(() => globalThis.__PB_PILOT?.snapshot().state === 'play', undefined, { timeout: 60000, polling: 100 });
let naturalPlay;
if(productionGuest) {
  const before = await game.evaluate(()=>({time:__PB_BRIDGE.app.run.time,x:__PB_BRIDGE.app.run.player.pos.x,z:__PB_BRIDGE.app.run.player.pos.z}));
  await game.waitForFunction(t=>__PB_BRIDGE.app.run.time>=t+12,before.time,{timeout:30000,polling:100});
  naturalPlay=await game.evaluate(b=>{const r=__PB_BRIDGE.app.run;return {seconds:r.time-b.time,moved:Math.hypot(r.player.pos.x-b.x,r.player.pos.z-b.z),level:r.player.level,kills:r.stats.kills,frames:__PB_PILOT.frames}},before);
  assert.ok(naturalPlay.seconds>=12);
  assert.ok(naturalPlay.frames>100,'normal guest received actual controller frames');
}
await panel.evaluate(() => desktop.command('pause'));
await game.waitForFunction(() => globalThis.__PB_BRIDGE.app.run.state === 'paused', undefined, { timeout: 10000, polling: 100 });
const paused = await game.evaluate(() => ({time:__PB_BRIDGE.app.run.time,moves:__PB_BRIDGE.app.run.player.moves.filter(Boolean).map(m=>m.def.key),plan:__PB_PILOT.plan,slots:__PB_BRIDGE.app.run.player.moveSlots}));
await new Promise(resolve=>setTimeout(resolve,1200));
assert.equal(await game.evaluate(() => __PB_BRIDGE.app.run.time), paused.time, 'pause retains the current match');
await panel.evaluate(() => desktop.command('resume'));
await game.waitForFunction(t => __PB_BRIDGE.app.run.time > t + 2, paused.time, { timeout:15000, polling: 100 });
await game.keyboard.press('F8');
await game.waitForFunction(()=>__PB_BRIDGE.app.run.state==='paused', undefined, { timeout: 10000, polling: 100 });
await game.keyboard.press('F8');
await game.waitForFunction(()=>__PB_BRIDGE.app.run.state==='play', undefined, { timeout: 10000, polling: 100 });
await panel.locator('[data-tab="overview"]').click();
await panel.keyboard.press('F8');
await game.waitForFunction(()=>__PB_BRIDGE.app.run.state==='paused', undefined, { timeout: 10000, polling: 100 });
await panel.keyboard.press('F8');
await game.waitForFunction(()=>__PB_BRIDGE.app.run.state==='play', undefined, { timeout: 10000, polling: 100 });
// Switching embedded surfaces must not wait for the host's one-second cache.
await game.keyboard.press('F8');
await game.waitForFunction(()=>__PB_BRIDGE.app.run.state==='paused', undefined, { timeout: 10000, polling: 100 });
await panel.locator('[data-tab="overview"]').click();
await panel.keyboard.press('F8');
await game.waitForFunction(()=>__PB_BRIDGE.app.run.state==='play', undefined, { timeout: 10000, polling: 100 });
const tabs = ['overview','modes','characters','logs','settings'];
await mkdir(artifactDir, {recursive:true});
for (const tab of tabs) {
  await panel.locator(`[data-tab="${tab}"]`).click();
  await panel.screenshot({path:`${artifactDir}/${tab}.png`});
}
await panel.locator('[data-tab="characters"]').click();
await panel.locator('#character-search').fill('妙蛙');
assert.ok((await panel.locator('#character-grid').innerText()).includes('妙蛙'));
await panel.locator('#character-search').fill('');
await panel.locator('#expand-button').click();
await panel.screenshot({path:`${artifactDir}/expanded.png`});
await panel.locator('[data-tab="overview"]').click();
await game.screenshot({path:`${artifactDir}/game.png`});
await panel.evaluate(() => desktop.command('config', {autoRestart:false}));
await game.evaluate(async()=>await __PB_BRIDGE.app.run.finish(false,true));
await game.waitForFunction(()=>__PB_PILOT.events.some(e=>e.kind==='settlement'&&e.saved), undefined, {timeout:30000, polling:100});
let finalState;
for(let i=0;i<30;i++) {
  finalState=await panel.evaluate(()=>desktop.getState());
  if(finalState.session.completedRuns>=1&&finalState.logs.some(l=>l.type==='result'&&l.message.includes('已保存'))) break;
  await new Promise(resolve=>setTimeout(resolve,500));
}
assert.ok(finalState.logs.some(l=>l.type==='result'&&l.message.includes('已保存')), 'only a successful game response confirms settlement');
await writeFile(`${artifactDir}/smoke-result.json`, JSON.stringify({passed:true,productionGuest,noGuestFlag:productionGuest,naturalPlay,catalog:{characters:catalog.characters.length,builds:catalog.builds.length},state:finalState,pausedTime:paused.time,errors},null,2));
console.log(JSON.stringify({passed:true,productionGuest,naturalPlay,characters:catalog.characters.length,builds:catalog.builds.length,game:finalState.game?.state,saved:true,errors,artifactDir}));
if(productionGuest) {
  const result=await panel.evaluate(()=>desktop.command('testClose'));
  assert.equal(result.accepted,true,'only the isolated test instance may close itself normally');
}
await browser.close().catch(()=>{});
