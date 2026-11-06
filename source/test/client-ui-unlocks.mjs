// Isolated local UI checks. No game, account, credentials or network is used.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "artifacts", "ui-unlocks", new Date().toISOString().replace(/[:.]/g, "-"));
await fs.mkdir(output, { recursive: true });
const categories = [
  ["maps", "地图", ["map"]], ["dex", "图鉴", ["dex", "auto"]],
  ["characters", "联盟角色", ["characters", "auto"]], ["research", "家族研究", ["research", "auto"]],
  ["shiny", "异色", ["shiny", "auto"]], ["lab", "实验室", []], ["items", "道具解锁", []],
  ["achievements", "成就", []], ["appearance", "外观", []], ["events", "活动奖励", []],
].map(([id, label, modes]) => ({ id, label, modes: [...new Set([...modes, id])] }));
const goals = { schemaVersion: 1, sourceHash: "synthetic-public-definitions", categories, targets: [
  { id: "dex:25", category: "dex", name: "皮卡丘", description: "在原生可遭遇地点发现", requirements: [], automation: { supported: true } },
  { id: "characters:150", category: "characters", name: "超梦", description: "原生前置条件示例", requirements: [{ kind: "target", targetId: "characters:144", description: "先集齐三神鸟" }] },
  { id: "research:1", category: "research", name: "妙蛙种子家族", description: "实际研究进度达到原生目标" },
  { id: "shiny:150", category: "shiny", name: "超梦异色", description: "按原生异色来源与前置推进" },
  { id: "shiny:perk:1", category: "shiny", name: "异色收藏奖励", acquisition: "取得原生要求数量的不同异色" },
  { id: "events:halloween26:quest:future", category: "events", eventId: "halloween26", name: "未开放活动示例", automation: { supported: false, reason: "等待原生活动开放" } },
] };
const catalog = { characters: [{ id: 1, name: "妙蛙种子", unlocked: true, learnableMoves: [{key:'vine-whip',minLevel:1},{key:'solar-beam',minLevel:36,description:'进化后的远程光束'}], learnableFusions:[{key:'fusion-vine-solar',name:'翠光融合示例',description:'父招式达到原生等级后融合',parents:['藤鞭','日光束'],routes:[{aKey:'vine-whip',bKey:'solar-beam'}]},{key:'fusion-flower',name:'花雨融合示例',description:'未来进化后融合',minLevel:36,routes:[{aKey:'vine-whip',bKey:'petal-dance'}]}] }, {id:25,name:'皮卡丘',unlocked:false,learnableMoves:[{key:'thunder-shock',minLevel:1}],learnableFusions:[{key:'fusion-electric',name:'电流融合示例',description:'皮卡丘专属融合池示例'}]}], builds: [], maps: [{ id: "forest", name: "翠绿森林", live: true }],
  moves: [{key:'vine-whip',name:'藤鞭'},{key:'solar-beam',name:'日光束'},{key:'thunder-shock',name:'电击'},{key:'not-learnable',name:'不可学示例'},{key:'fusion-global-unavailable',name:'不可学融合示例'}],
  vitamins: Array.from({length:6},(_,i)=>({key:`vit-${i+1}`,name:`营养 ${i+1}`,description:i===0?'提高物理伤害':'维生素目录示例'})),
  modes: [], difficulties: [{ id: 0, name: "普通" }], unlockGoals: goals,
  shinyTargets: [{ id: 150, name: "超梦", available: false, availability: { available: false, reason: "缺少前置" } }] };
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 620 } });
const errors = [], checks = []; page.on("pageerror", error => errors.push(error.message));
await page.route("https://**/*", route => route.abort());
await page.addInitScript(({ catalog }) => {
  window.__calls = []; window.__catalog = catalog;
  window.__mockState = { running: false, profile: { name: "界面隔离示例", league: [1], biomes: { forest: 0 }, seen: [], shinies: [] },
    game: { state: "over", accountType: "guest" }, config: { mode: "dex", biome: "forest", tier: 0, modeSettings: {}, unlockTargets: {}, eventTargets: {}, shinyMode: "missing", shinyTargetId: null }, logs: [], session: {} };
  window.desktop = { getCatalog: async () => structuredClone(window.__catalog), getState: async () => structuredClone(window.__mockState),
    onState(listener) { window.__renderState = listener; return () => {}; },
    command: async (action, payload = {}) => {
      window.__calls.push({ action, payload });
      if (action === "config") {
        const before = window.__mockState.config;
        window.__mockState.config = { ...before, ...payload,
          unlockTargets: { ...before.unlockTargets, ...payload.unlockTargets },
          eventTargets: { ...before.eventTargets, ...payload.eventTargets },
          modeSettings: { ...before.modeSettings, ...Object.fromEntries(Object.entries(payload.modeSettings || {})
            .map(([mode, value]) => [mode, { ...before.modeSettings?.[mode], ...value }])) },
          finalReplacements: { ...before.finalReplacements, ...Object.fromEntries(Object.entries(payload.finalReplacements || {}).map(([id,entry])=>[id,
            {...before.finalReplacements?.[id],...Object.fromEntries(Object.entries(entry).map(([kind,section])=>[kind,{...before.finalReplacements?.[id]?.[kind],...section}]))}])) } };
      }
      if (action === "start" || action === "resume") window.__mockState.running = true;
      return { ok: true, state: structuredClone(window.__mockState) };
    } };
}, { catalog });
const push = patch => page.evaluate(patch => {
  window.__mockState = { ...window.__mockState, ...patch,
    config: { ...window.__mockState.config, ...(patch.config || {}) }, game: { ...window.__mockState.game, ...(patch.game || {}) } };
  window.__renderState(structuredClone(window.__mockState));
}, patch);
const check = async (name, run) => { await run(); checks.push(name); };
try {
  await page.goto(pathToFileURL(path.join(root, "client/ui/index.html")).href);
  await check('jump-movement-defaults-off-and-retains-explicit-saved-values', async () => {
    await page.locator('#tab-settings').click();
    assert.equal(await page.locator('#setting-autoRestart').isChecked(), true);
    await page.locator('#tab-convenience').click();await page.locator('#convenience-feature-outside').click();
    for(const key of ['autoUpgrade','autoClaim','reserveMoveSlot'])assert.equal(await page.locator(`#setting-${key}`).isChecked(),true,key);
    await page.locator('#convenience-feature-strategy').click();
    assert.equal(await page.locator('#setting-bossPriority').isChecked(),false);assert.equal(await page.locator('#setting-portalPriority').isChecked(),false);
    for(const key of ['pickup','capturePriority','shinyPriority','pickupBonkoin'])assert.equal(await page.locator(`#setting-${key}`).isChecked(),true,key);
    await page.locator('#convenience-feature-movement').click();
    assert.equal(await page.locator('#setting-jumpMove').isChecked(), false);
    assert.equal(await page.locator('#setting-slideMove').isChecked(), false);
    assert.equal(await page.locator('#setting-jumpMove').evaluate(node=>node.closest('label').nextElementSibling.querySelector('input').id),'setting-slideMove');
    assert.match(await page.locator('#setting-slideMove').evaluate(node=>node.closest('label').innerText),/默认关闭.*原生.*救援.*楼梯.*不能保证无缝无敌/);
    assert.match(await page.locator('#setting-jumpMove').evaluate(node => node.closest('label').innerText), /默认关闭/);
    assert.equal(await page.locator('#setting-expertMode').count(), 0);
    assert.match(await page.locator('#native-controls-note').innerText(), /高玩模式已移除.*不再自动转镜或切锁/);
    await push({ config: { jumpMove: true, expertMode: true } });
    assert.equal(await page.locator('#setting-expertMode').count(), 0);
    assert.equal(await page.locator('#expert-settings-status').count(), 0);
    assert.equal(await page.locator('#setting-jumpMove').isChecked(), true);
    await push({ config: { fps: 90 } });
    assert.equal(await page.locator('#setting-jumpMove').isChecked(), true);
    await page.locator('#setting-jumpMove').uncheck();
    await page.waitForFunction(() => window.__mockState.config.jumpMove === false);
    await push({ config: { fps: 60 } });
    assert.equal(await page.locator('#setting-jumpMove').isChecked(), false);
  });
  await check('slide-movement-opt-in-preserves-jump-and-roundtrips-through-partial-state-updates',async()=>{
    await push({config:{jumpMove:true,slideMove:false}});await page.locator('#setting-slideMove').check();await page.waitForFunction(()=>window.__mockState.config.slideMove===true);
    assert.equal(await page.locator('#setting-jumpMove').isChecked(),true);await push({config:{fps:45}});assert.equal(await page.locator('#setting-slideMove').isChecked(),true);
    await page.locator('#setting-slideMove').uncheck();await page.waitForFunction(()=>window.__mockState.config.slideMove===false);assert.equal(await page.locator('#setting-jumpMove').isChecked(),true);
    for(const slideMove of [null,1,'true']){await push({config:{slideMove}});assert.equal(await page.locator('#setting-slideMove').isChecked(),false);}
    await push({config:{slideMove:false}});
  });
  await page.locator("#tab-modes").click();
  await check("mode-specific-selector-defaults-to-unowned", async () => {
    await page.locator('[data-unlock-category="dex"]').waitFor();
    assert.equal(await page.locator('[data-unlock-category="dex"]').inputValue(), "auto");
    assert.equal(await page.locator('[data-unlock-category="research"]').count(), 0);
  });
  await check("every-category-has-its-own-mode-and-only-its-own-target-selector", async () => {
    assert.equal(await page.locator('[data-mode="unlocks"]').count(), 0);
    assert.equal(await page.locator('[data-mode="events"]').count(), 0);
    assert.equal(await page.locator('#modes-grid > button').last().getAttribute('id'), 'limited-events-toggle');
    assert.equal(await page.locator('#modes-grid [data-mode="tower"]').count(), 0);
    assert.equal(await page.locator('#limited-events-region').isHidden(), true);
    await page.locator('#limited-events-toggle').click();
    assert.equal(await page.locator('#limited-events-grid [data-mode="tower"]').isVisible(), true);
    for (const category of categories) {
      const mode = category.id === "maps" ? "map" : category.id === "events" ? "tower" : category.id;
      await page.locator(`[data-mode="${mode}"]`).click();
      assert.equal(await page.locator('[data-unlock-category]').count(), 1, mode);
      assert.equal(await page.locator(`[data-unlock-category="${category.id}"]`).inputValue(), "auto", mode);
      assert.ok(await page.locator('#mode-configuration-title').innerText());
    }
    await page.locator('[data-mode="characters"]').click();
  });
  await check("search-matches-requirements-not-only-names", async () => {
    await page.locator("#unlock-target-search").fill("三神鸟");
    assert.equal(await page.locator('option[value="characters:150"]').count(), 1);
    assert.equal(await page.locator('option[value="research:1"]').count(), 0);
    await page.locator("#unlock-target-search").fill("");
  });
  await check('target-status-labels-separate-script-support-native-locks-configuration-and-unknown-state',async()=>{
    const selector=page.locator('[data-unlock-category="characters"] option[value="characters:150"]');
    for (const [blockerKind,label] of [['script','脚本未支持'],['native','待前置或未开放'],['config','当前设置冲突'],['manual','待手动或服务器结算'],['unknown','具体条件待核对']]) {
      await push({game:{unlockProgress:{status:'waiting',targetId:'characters:150',message:'具体原因在总览展开',targetStatuses:{'characters:150':{complete:false,available:false,blockerKind,reason:'隔离状态分类示例'}}}}});
      assert.ok((await selector.textContent()).includes(label),blockerKind);
      if (blockerKind !== 'native') assert.doesNotMatch(await selector.textContent(),/待前置或未开放/);
    }
  });
  await check("incomplete-prerequisite-target-remains-selectable-and-persists-per-category", async () => {
    await push({ game: { unlockProgress: { status: "ready", targetId: "characters:150", stepId: "characters:144", message: "当前先获取缺少的三神鸟", targetStatuses: { "characters:150": { complete: false, available: false, reason: "缺少三神鸟" } } } } });
    const select = page.locator('[data-unlock-category="characters"]');
    assert.equal(await select.locator('option[value="characters:150"]').isDisabled(), false);
    await select.selectOption("characters:150"); await select.blur();
    assert.equal(await page.evaluate(() => window.__mockState.config.unlockTargets.characters), "characters:150");
    await push({ config: { mode: "research" } });
    await page.locator('[data-unlock-category="research"]').selectOption("research:1");
    await page.locator('[data-unlock-category="research"]').blur();
    await push({ config: { mode: "characters" } });
    assert.equal(await page.locator('[data-unlock-category="characters"]').inputValue(), "characters:150");
  });
  await check("overview-shows-the-actual-prerequisite-step", async () => {
    await page.locator("#tab-overview").click();
    assert.match(await page.locator("#unlock-goal-detail").innerText(), /先获取.*三神鸟/);
  });
  await check("map-and-difficulty-are-mode-specific-with-real-auto-options", async () => {
    await page.locator("#tab-modes").click();
    await page.locator('[data-mode="characters"]').click();
    assert.equal(await page.locator('#biome-select').inputValue(), "auto");
    assert.equal(await page.locator('#tier-select').inputValue(), "auto");
    await page.locator('#biome-select').selectOption("forest"); await page.locator('#tier-select').selectOption("0");
    await page.locator('[data-mode="research"]').click();
    assert.equal(await page.locator('#biome-select').inputValue(), "auto");
    assert.equal(await page.locator('#tier-select').inputValue(), "auto");
    await page.locator('[data-mode="characters"]').click();
    assert.equal(await page.locator('#biome-select').inputValue(), "forest");
    assert.equal(await page.locator('#tier-select').inputValue(), "0");
    await page.locator('#tier-select').selectOption("auto");
    assert.equal(await page.evaluate(() => window.__mockState.config.modeSettings.characters.tier), "auto");
    await page.locator("#tab-overview").click();
  });
  await check("overview-distinguishes-final-target-current-prerequisite-and-the-next-action", async () => {
    await push({ config: { mode: "research" }, game: { unlockProgress: {
      mode: "shiny", status: "ready", targetId: "shiny:150", stepId: "characters:144", message: "先完成原生三神鸟条件",
      display: { targetName: "异色超梦", stepName: "先捕获急冻鸟", progressLabel: "三神鸟 2/3", completedLabel: "闪电鸟、火焰鸟", nextStep: "三神鸟齐全后挑战超梦" },
    } } });
    assert.match(await page.locator("#current-mode").innerText(), /刷异色/);
    assert.match(await page.locator("#unlock-goal-title").innerText(), /异色超梦/);
    const text = await page.locator("#unlock-goal-steps").innerText();
    for (const value of ["先捕获急冻鸟", "三神鸟 2/3", "闪电鸟、火焰鸟", "齐全后挑战超梦"]) assert.ok(text.includes(value));
  });
  await check('trick-overview-displays-real-tombstone-state-without-promoting-current-run-counts-to-saved-progress',async()=>{
    await push({running:true,config:{mode:'tower'},game:{state:'play',nativeMode:'tower',tower:{floor:3,tricks:2,trickRequested:true,trickStatus:'not-spawned'},
      unlockProgress:{mode:'tower',status:'ready',targetId:'events:halloween26:quest:trick',message:'正常交互耿鬼墓碑并选择捣蛋',action:{kind:'earn-event',mode:'tower',towerGoal:{trick:true}},
        display:{targetName:'不给糖就捣蛋',nativeConditions:['已保存活动捣蛋次数：4/10，还差6次，必须正常保存并领取。']}}}});
    const detail=page.locator('#unlock-goal-steps .native-conditions');
    assert.match(await detail.innerText(),/本层耿鬼墓碑尚未出现/);assert.match(await detail.innerText(),/本局原生已发生 2 次（未保存/);
    assert.match(await detail.innerText(),/已保存活动捣蛋次数：4\/10/);assert.doesNotMatch(await detail.innerText(),/已保存活动捣蛋次数：6\/10/);
    await push({game:{tower:{floor:3,tricks:2,trickRequested:true,trickStatus:'available'}}});
    assert.match(await detail.innerText(),/已出现且尚未使用/);
    await push({game:{tower:{floor:3,tricks:3,trickRequested:true,trickStatus:'used'}}});
    assert.match(await detail.innerText(),/本层耿鬼墓碑已使用/);assert.match(await detail.innerText(),/本局原生已发生 3 次（未保存/);
    await push({running:false,game:{state:'over',nativeMode:'standard',tower:null,unlockProgress:null}});
  });
  await check("overview-native-conditions-follow-next-step-and-preserve-readable-literal-details", async () => {
    await push({config:{mode:'tower'},game:{unlockProgress:{mode:'tower',status:'waiting',targetId:'events:halloween26:quest:future',message:'此任务须单独完成',
      display:{targetName:'紫苑塔之夜·深渊',stepName:'当前退出设置不执行高层目标',nextStep:'开启持续挑战后到达25层并正常保存领取',nativeConditions:[
        '到达塔的第25层：未满足（已保存 7/25，还差 18）',
        '配置冲突：当前设置7层退出，高层目标需要持续挑战，不代表游戏未解锁。',
        '未知文本 <img src=x onerror=alert(1)> 按文字显示。']}}}});
    const labels = await page.locator('#unlock-goal-steps dt').allTextContents();
    assert.equal(labels[labels.indexOf('接下来')+1],'原生条件');
    const conditions=page.locator('#unlock-goal-steps .native-conditions');
    assert.match(await conditions.innerText(),/7\/25，还差 18/); assert.match(await conditions.innerText(),/不代表游戏未解锁/);
    assert.equal(await conditions.locator('img').count(),0); assert.match(await conditions.innerText(),/<img src=x/);
    assert.ok(await conditions.locator('p').count() >= 3);
    assert.equal(await conditions.locator('p').first().evaluate(node=>getComputedStyle(node).userSelect),'text');
  });
  await check("plain-mode-conditions-use-current-map-and-native-unknown-progress-without-a-goal-graph", async () => {
    await push({profile:null,running:false,config:{mode:'endless',modeSettings:{endless:{biome:'forest',tier:'auto'}}},game:{state:'over',plan:null,profile:null,unlockProgress:null}});
    const text = await page.locator('#unlock-goal-steps .native-conditions').innerText();
    assert.match(text,/尚未读取该地图的已保存解锁进度/); assert.match(text,/无尽生存.*固定普通难度/);
    assert.doesNotMatch(text,/当前存档已解锁/);
    await push({profile:{league:[1],biomes:{forest:0}},config:{mode:'research'},game:{profile:null}});
  });
  await check("a-delayed-status-cannot-put-an-old-map-into-the-next-difficulty-save", async () => {
    await push({ config: { mode: "research", modeSettings: { research: { biome: "auto", tier: "auto" } } } });
    await page.locator('#tab-modes').click();
    await page.locator('#biome-select').selectOption('forest');
    await page.waitForFunction(() => window.__mockState.config.modeSettings.research.biome === 'forest');
    await page.evaluate(() => {
      const stale = structuredClone(window.__mockState);
      stale.config.modeSettings.research = { biome: 'auto', tier: 'auto' };
      window.__renderState(stale);
    });
    await page.locator('#tier-select').selectOption('0');
    await page.waitForFunction(() => window.__mockState.config.modeSettings.research.tier === 0);
    assert.deepEqual(await page.evaluate(() => window.__mockState.config.modeSettings.research), { biome: 'forest', tier: 0 });
    const last = await page.evaluate(() => window.__calls.filter(call => call.action === 'config').at(-1));
    assert.deepEqual(last.payload.modeSettings, { research: { tier: 0 } }, 'wire payload must contain only the changed field');
    await page.locator('#tab-overview').click();
  });
  await check("kill-and-time-ranking-cards-and-endless-keep-independent-route-preferences", async () => {
    await page.locator('#tab-modes').click();
    await page.locator('[data-mode="leaderboard-kills"]').click();
    await page.locator('#tier-select').selectOption('0');
    await page.locator('[data-mode="leaderboard-time"]').click();
    assert.equal(await page.locator('#tier-select').inputValue(), 'auto');
    await page.locator('[data-mode="endless"]').click();
    assert.equal(await page.locator('#tier-select').inputValue(), 'auto');
    await page.locator('[data-mode="leaderboard-kills"]').click();
    assert.equal(await page.locator('#tier-select').inputValue(), '0');
    await page.locator('#tab-overview').click();
    await push({ running: true, config: { mode: 'leaderboard', leaderboardGoal: 'time' }, game: {
      state: 'play', plan: { modePreference: { mode: 'leaderboard', routeKey: 'leaderboard-kills' } }, unlockProgress: null } });
    assert.match(await page.locator('#current-mode').innerText(), /击败数/);
    await push({ running: false, game: { state: 'over', plan: null } });
  });
  await check("changing-the-next-mode-does-not-relabel-a-live-resource-run", async () => {
    await push({ running: true, config: { mode: "research" }, game: { state: "play", unlockProgress: null,
      plan: { modePreference: { mode: "resources", biome: "forest", tier: 0 } } } });
    assert.match(await page.locator('#current-mode').innerText(), /刷资源/);
    await push({ running: false, game: { state: "over", plan: null } });
  });
  await check("overview-distinguishes-actual-config-from-conflicting-required-route", async () => {
    await push({ running: true, game: { state: 'play', biome: 'forest', plan: { biome: 'forest', tier: 0,
      modePreference: { mode: 'characters', biome: 'forest', tier: 0 } },
      unlockProgress: { mode: 'characters', targetId: 'characters:150', status: 'waiting', message: '保留本模式指定配置',
        constraintConflict: { requested:{biome:'forest',tier:0},required:{biome:'forest',tier:1},reason:'目标需要困难难度，不自动覆盖指定的普通难度。' } } } });
    assert.match(await page.locator('#unlock-goal-steps').innerText(), /本次地图.*翠绿森林.*普通/s);
    assert.match(await page.locator('#unlock-goal-steps').innerText(), /目标需要困难难度.*不自动覆盖/);
    await push({ running: false, game: { state: 'over', plan: null, unlockProgress: null } });
  });
  await check("tower-floor-four-is-not-mislabeled-as-a-standard-sanctuary", async () => {
    await push({ running: true, game: { state: 'play', stage: 4, biome: 'graveyard', nativeMode: 'tower',
      tower: { floor: 4, state: 'wave', wave: 1, roof: false, beyond: false } } });
    assert.match(await page.locator('#current-activity').innerText(), /第4层.*第2波/);
    assert.doesNotMatch(await page.locator('#current-activity').innerText(), /圣域/);
    await push({ running: false, game: { state: 'over', tower: null, nativeMode: 'standard' } });
  });
  await check("an-event-target-shows-its-actual-next-tower-route-before-entry", async () => {
    await push({ config: { mode: 'events' }, game: { state: 'over', plan: null,
      unlockProgress: { mode: 'events', status: 'ready', message: '按已开放活动积累奖励进度',
        action: { kind: 'earn-event', mode: 'tower', eventId: 'halloween26' },
        route: { biome: 'graveyard', tier: 0, nativeMode: 'tower' } } } });
    await page.locator('#tab-overview').click();
    const text = await page.locator('#unlock-goal-steps').innerText();
    assert.match(text, /下一步地图/); assert.match(text, /按活动规则/);
    assert.doesNotMatch(await page.locator('#unlock-goal-steps > div').filter({has:page.locator('dt', {hasText:'下一步地图'})}).innerText(), /普通/);
  });
  await check("tower-custom-plans-are-available-for-the-tower-and-targeted-event-routes", async () => {
    await push({ customPlans: [{ id: 'custom-tower-fixture', name: '塔内方案示例', enabled: true, mode: 'tower', biome: 'graveyard', tier: 0 }],
      config: { mode: 'tower', build: 'auto' }, game: { unlockProgress: null } });
    await page.locator('#tab-characters').click();
    assert.match(await page.locator('#build-select option[value="custom-tower-fixture"]').innerText(), /紫苑塔/);
    await push({ config: { mode: 'resources' } });
    assert.equal(await page.locator('#build-select option[value="custom-tower-fixture"]').count(), 0);
    await push({ config: { mode: 'events', modeSettings: { events: { biome: 'forest', tier: 2 } } }, game: { unlockProgress: { mode: 'events',
      status: 'ready', message: '前往已开放活动', route: { biome: 'graveyard', tier: 0, nativeMode: 'tower' } } } });
    assert.equal(await page.locator('#build-select option[value="custom-tower-fixture"]').count(), 1);
    await push({ customPlans: [], game: { unlockProgress: null } });
    await page.locator('#tab-overview').click();
  });
  await check("auto-with-no-remaining-goals-notifies-without-blocking-start", async () => {
    await push({ config: { mode: "research", unlockTargets: { research: "auto" } }, game: { unlockProgress: { status: "complete", targetId: null, counts: { remaining: 0 }, message: "当前没有可解锁内容，继续资源对局" } } });
    assert.match(await page.locator("#unlock-goal-title").innerText(), /无可解锁内容/);
    assert.equal(await page.locator("#main-action").isEnabled(), true);
    await page.locator("#main-action").click();
    assert.ok(await page.evaluate(() => window.__calls.some(call => ["start", "resume"].includes(call.action))));
  });
  await check("shiny-selector-and-legacy-panel-have-one-canonical-target", async () => {
    await push({ running: false, config: { mode: "shiny", unlockTargets: { shiny: "auto" }, shinyMode: "missing", shinyTargetId: null } });
    await page.locator("#tab-modes").click();
    await page.locator('[data-unlock-category="shiny"]').selectOption("shiny:150");
    await page.locator('[data-unlock-category="shiny"]').blur();
    const config = await page.evaluate(() => window.__mockState.config);
    assert.equal(config.unlockTargets.shiny, "shiny:150"); assert.equal(config.shinyMode, "target"); assert.equal(config.shinyTargetId, 150);
    assert.equal(await page.locator("#main-action").isEnabled(), true);
    await page.locator('[data-shiny-mode="missing"]').click();
    assert.equal(await page.evaluate(() => window.__mockState.config.unlockTargets.shiny), "auto");
    assert.equal(await page.evaluate(() => window.__mockState.config.shinyTargetId), null);
    await page.locator('[data-shiny-mode="target"]').click();
    assert.equal(await page.evaluate(() => window.__mockState.config.unlockTargets.shiny), "auto", "opening the picker must not select an arbitrary target");
    assert.equal(await page.locator('[data-shiny-target="150"]').isEnabled(), true);
    await page.locator('[data-shiny-target="150"]').click();
    assert.equal(await page.evaluate(() => window.__mockState.config.unlockTargets.shiny), "shiny:150");
  });
  await check("polling-does-not-replace-a-focused-target-select", async () => {
    const select = page.locator('[data-unlock-category="shiny"]');
    await select.focus(); await select.evaluate(element => element.dataset.sameElement = "retained");
    await push({ game: { unlockProgress: { status: "ready", message: "等待原生遭遇", targetStatuses: { "shiny:150": { available: false, reason: "仍缺前置" } } } } });
    assert.equal(await select.getAttribute("data-same-element"), "retained");
    await select.blur();
  });
  await check("collection-perk-selection-does-not-become-an-empty-species-target", async () => {
    await page.locator('[data-unlock-category="shiny"]').selectOption("shiny:perk:1");
    await page.locator('[data-unlock-category="shiny"]').blur();
    assert.equal(await page.locator('#shiny-current-target').innerText(), "异色收藏奖励");
    assert.equal(await page.locator('#shiny-target-picker').isHidden(), true);
    assert.notEqual(await page.locator('#shiny-status-label').innerText(), "待选择目标");
  });
  await check("the-real-public-catalog-retains-every-target-in-its-corresponding-mode", async () => {
    const real = JSON.parse(await fs.readFile(path.join(root, 'data/unlock-catalog.json'), 'utf8'));
    await push({ config: { unlockTargets: Object.fromEntries(real.categories.map(category => [category.id, 'auto'])), shinyMode: 'missing', shinyTargetId: null } });
    await push({ catalogRevision: 'synthetic-before-real' });
    await page.evaluate(real => { window.__catalog.unlockGoals = real; }, real);
    await push({ catalogRevision: 'audited-real-catalog' });
    await page.waitForFunction(() => document.querySelector('[data-unlock-category="shiny"]')?.options.length > 100);
    for (const category of real.categories) {
      await page.locator(`[data-mode="${category.id === 'maps' ? 'map' : category.id === 'events' ? 'tower' : category.id}"]`).click();
      const expected = real.targets.filter(target => target.category === category.id).length;
      assert.equal(await page.locator(`[data-unlock-category="${category.id}"] option`).count(), expected + 1, category.id);
    }
    await page.locator('[data-mode="shiny"]').click();
  });
  await check('tower-specific-settings-persist-and-selecting-a-high-floor-target-explicitly-enables-continuation',async()=>{
    await page.locator('[data-mode="tower"]').click();
    assert.equal(await page.locator('#tower-options').isVisible(),true);
    assert.equal(await page.locator('#tower-exit-policy').inputValue(),'clear');
    assert.equal(await page.locator('#tower-no-candles').isChecked(),false);
    assert.equal(await page.locator('#tower-only-experience').isChecked(),false);
    assert.equal(await page.locator('#tower-save-money-after-50').isChecked(),false);
    assert.equal(await page.locator('#tower-aggressive-ultimate').isChecked(),false);
    await page.locator('#tower-options').screenshot({path:path.join(output,'tower-aggressive-off.png')});
    await page.locator('#tower-aggressive-ultimate').check();
    await page.waitForFunction(()=>window.__mockState.config.modeSettings.tower?.aggressiveUltimate===true);
    await page.locator('#tower-save-money-after-50').check();
    await page.waitForFunction(()=>window.__mockState.config.modeSettings.tower?.saveMoneyAfter50===true);
    assert.equal(await page.locator('#tower-no-candles').evaluate(n=>n.closest('label').nextElementSibling.querySelector('input').id),'tower-only-experience');
    await page.locator('[data-unlock-category="events"]').selectOption('events:halloween26:quest:abyss');
    await page.locator('[data-unlock-category="events"]').blur();
    await page.waitForFunction(()=>window.__mockState.config.modeSettings.tower?.exitPolicy === 'continue');
    assert.equal(await page.locator('#tower-exit-policy').inputValue(),'continue');
    await page.locator('#tower-only-experience').check();
    await page.waitForFunction(()=>window.__mockState.config.modeSettings.tower?.onlyExperience===true);
    await page.locator('#tower-no-candles').check();
    await page.locator('#tower-exit-policy').selectOption('clear');
    await page.waitForFunction(()=>window.__mockState.config.modeSettings.tower?.exitPolicy === 'clear'&&window.__mockState.config.modeSettings.tower?.noCandles === true);
    assert.equal(await page.evaluate(()=>window.__mockState.config.eventTargets.halloween26),'events:halloween26:quest:abyss');
    await page.locator('#tab-overview').click();
    assert.match(await page.locator('#unlock-goal-steps .native-conditions').innerText(),/配置冲突，不是游戏未解锁/);
    await page.locator('#tab-modes').click(); await page.locator('[data-mode="resources"]').click();
    assert.equal(await page.locator('#tower-options').isHidden(),true);
    await page.locator('[data-mode="tower"]').click();
    assert.equal(await page.locator('#tower-exit-policy').inputValue(),'clear'); assert.equal(await page.locator('#tower-no-candles').isChecked(),true);
    assert.equal(await page.locator('#tower-only-experience').isChecked(),true);
    assert.equal(await page.locator('#tower-save-money-after-50').isChecked(),true);
    assert.equal(await page.locator('#tower-aggressive-ultimate').isChecked(),true);
    await page.locator('#tower-options').screenshot({path:path.join(output,'tower-aggressive-desktop.png')});
    await page.locator('#tower-options').screenshot({path:path.join(output,'tower-save-money-desktop.png')});
    await page.locator('#tower-options').screenshot({path:path.join(output,'tower-experience-desktop.png')});
    await page.setViewportSize({width:480,height:900});
    await page.locator('#tower-options').screenshot({path:path.join(output,'tower-aggressive-narrow.png')});
    await page.locator('#tower-options').screenshot({path:path.join(output,'tower-save-money-narrow.png')});
    await page.locator('#tower-options').screenshot({path:path.join(output,'tower-experience-narrow.png')});
    await page.setViewportSize({width:1280,height:900});
    await page.locator('#tower-aggressive-ultimate').uncheck();
    await page.waitForFunction(()=>window.__mockState.config.modeSettings.tower?.aggressiveUltimate===false);
    assert.equal(await page.locator('#tower-save-money-after-50').isChecked(),true);
    await page.locator('#tower-only-experience').uncheck();
    await page.waitForFunction(()=>window.__mockState.config.modeSettings.tower?.onlyExperience===false);
    assert.equal(await page.locator('#tower-no-candles').isChecked(),true);
    await page.locator('[data-mode="shiny"]').click();
  });
  await page.locator('#tab-characters').click();
  await check('final-replacement-only-shown-for-concrete-character-and-defaults-off', async () => {
    await page.locator('.automatic-card').click();
    assert.equal(await page.locator('#final-replacements').isVisible(), false);
    await page.locator('.character-card').filter({hasText:'妙蛙种子'}).click();
    assert.equal(await page.locator('#final-moves-enabled').isChecked(), false);
    assert.equal(await page.locator('#final-fusion-enabled').isChecked(), false);
    assert.equal(await page.locator('#final-vitamins-enabled').isChecked(), false);
    assert.equal(await page.locator('[data-replacement-kind="moves"] .replacement-fields').isVisible(), false);
    assert.equal(await page.locator('[data-replacement-kind="fusion"] .replacement-fields').isVisible(), false);
    assert.match(await page.locator('[data-replacement-kind="moves"]').innerText(),/最终招式替换/);
    assert.match(await page.locator('[data-replacement-kind="fusion"]').innerText(),/最终融合招式/);
  });
  await check('final-moves-pool-is-character-specific-searchable-and-retains-level-gates', async () => {
    await page.locator('#final-moves-enabled').check();
    assert.equal(await page.locator('[data-replacement-kind="moves"] input[role="combobox"]').count(), 4);
    const input = page.locator('#final-moves-0'); await input.click();
    assert.equal(await page.locator('#final-moves-0-options [role="option"]').count(),3);
    assert.equal(await page.locator('#final-moves-0-options').getByText('不可学示例').count(),0);
    await input.fill('远程光束');
    await page.locator('#final-moves-0-options').getByRole('option').filter({hasText:'日光束'}).click();
    assert.equal(await page.evaluate(()=>window.__mockState.config.finalReplacements['1'].moves.targets[0]),'solar-beam');
    await page.locator('#final-moves-1').fill('藤鞭');
    await page.locator('#final-moves-1-options').getByRole('option').filter({hasText:'藤鞭'}).click();
    assert.deepEqual(await page.evaluate(()=>window.__mockState.config.finalReplacements['1'].moves.targets),['solar-beam','vine-whip',null,null]);
    assert.match(await page.locator('#final-replacements').innerText(),/3 个招式槽只使用前三项/);
  });
  await check('duplicate-and-unrecognized-final-targets-do-not-overwrite-saved-settings', async () => {
    await page.locator('#final-moves-2').fill('日光束');
    await page.locator('#final-moves-2-options').getByRole('option').filter({hasText:'日光束'}).click();
    assert.match(await page.locator('#final-moves-error').innerText(),/已选在其他位置/);
    assert.equal(await page.evaluate(()=>window.__mockState.config.finalReplacements['1'].moves.targets[2]),null);
    await page.locator('#final-moves-2').fill('不存在的技能'); await page.locator('#build-character').click();
    await page.waitForFunction(()=>document.querySelector('#final-moves-error').textContent.includes('没有保存'));
    assert.equal(await page.evaluate(()=>window.__mockState.config.finalReplacements['1'].moves.targets[2]),null);
  });
  await check('final-replacement-level-rejects-exponent-and-clamps-native-spinner-range', async () => {
    const level = page.locator('#final-moves-level'); assert.equal(await level.inputValue(),'30');
    assert.equal(await level.getAttribute('min'),'1'); assert.equal(await level.getAttribute('max'),'999999'); assert.equal(await level.getAttribute('step'),'1');
    await level.fill(''); await level.pressSequentially('1e2'); assert.equal(await level.inputValue(),'12'); await level.blur();
    await page.waitForFunction(()=>window.__mockState.config.finalReplacements['1'].moves.level===12);
    await level.fill('0'); await level.blur(); await page.waitForFunction(()=>window.__mockState.config.finalReplacements['1'].moves.level===1);
    await level.fill('9999999'); await level.blur(); await page.waitForFunction(()=>window.__mockState.config.finalReplacements['1'].moves.level===999999);
    await level.fill(''); await level.blur(); assert.equal(await level.inputValue(),'999999');
  });
  await check('vitamins-expose-all-six-native-slots-and-remain-independent-from-moves', async () => {
    await page.locator('#final-vitamins-enabled').check();
    assert.equal(await page.locator('[data-replacement-kind="vitamins"] input[role="combobox"]').count(),6);
    await page.locator('#final-vitamins-5').fill('营养 6');
    await page.locator('#final-vitamins-5-options').getByRole('option').filter({hasText:'营养 6'}).click();
    assert.deepEqual(await page.evaluate(()=>window.__mockState.config.finalReplacements['1'].vitamins.targets),[null,null,null,null,null,'vit-6']);
    assert.equal(await page.evaluate(()=>window.__mockState.config.finalReplacements['1'].moves.targets[0]),'solar-beam');
    assert.match(await page.locator('[data-replacement-kind="vitamins"]').innerText(),/增加至 6 槽/);
  });
  await check('final-fusions-have-separate-character-specific-pool-and-parent-search',async()=>{
    await page.locator('#final-fusion-enabled').check();
    assert.equal(await page.locator('[data-replacement-kind="fusion"] input[role="combobox"]').count(),4);
    await page.locator('#final-fusion-0').click();
    assert.equal(await page.locator('#final-fusion-0-options [role="option"]').count(),3);
    assert.equal(await page.locator('#final-fusion-0-options').getByText('不可学融合示例').count(),0);
    await page.locator('#final-fusion-0').fill('藤鞭');
    await page.locator('#final-fusion-0-options').getByRole('option').filter({hasText:'翠光融合示例'}).click();
    await page.waitForFunction(()=>window.__mockState.config.finalReplacements['1'].fusion.targets[0]==='fusion-vine-solar');
    assert.deepEqual(await page.evaluate(()=>window.__mockState.config.finalReplacements['1'].fusion.targets),['fusion-vine-solar',null,null,null]);
    assert.equal(await page.evaluate(()=>window.__mockState.config.finalReplacements['1'].moves.targets[0]),'solar-beam');
    assert.equal(await page.evaluate(()=>window.__mockState.config.finalReplacements['1'].vitamins.targets[5]),'vit-6');
    const text=await page.locator('[data-replacement-kind="fusion"]').innerText();
    assert.match(text,/优先于普通最终方案/);assert.match(text,/同名填一次做一份，填两次做两份，做够后停止/);
    assert.match(text,/3 槽最多 2 个融合，4 槽最多 3 个/);assert.match(text,/第一项依序补位/);
  });
  await check('fusion-targets-retain-fourth-reserve-slot-save-requested-copies-and-validate-own-level',async()=>{
    await page.locator('#final-fusion-3').fill('花雨');
    await page.locator('#final-fusion-3-options').getByRole('option').filter({hasText:'花雨融合示例'}).click();
    assert.deepEqual(await page.evaluate(()=>window.__mockState.config.finalReplacements['1'].fusion.targets),['fusion-vine-solar',null,null,'fusion-flower']);
    assert.match(await page.locator('.replacement-fusion-conflicts').innerText(),/原料冲突.*翠光融合示例.*花雨融合示例/);
    await page.locator('#final-fusion-1').fill('翠光');
    await page.locator('#final-fusion-1-options').getByRole('option').filter({hasText:'翠光融合示例'}).click();
    await page.waitForFunction(()=>window.__mockState.config.finalReplacements['1'].fusion.targets[1]==='fusion-vine-solar');
    assert.equal(await page.locator('#final-fusion-error').innerText(),'');
    assert.equal(await page.locator('#final-fusion-1').inputValue(),'翠光融合示例');
    const input=page.locator('#final-fusion-level');
    assert.equal(await input.inputValue(),'30');assert.equal(await input.getAttribute('min'),'1');assert.equal(await input.getAttribute('max'),'999999');
    await input.fill('');await input.pressSequentially('3e2');assert.equal(await input.inputValue(),'32');await input.blur();
    await page.waitForFunction(()=>window.__mockState.config.finalReplacements['1'].fusion.level===32);
    await input.fill('0');await input.blur();await page.waitForFunction(()=>window.__mockState.config.finalReplacements['1'].fusion.level===1);
    await input.fill('1000000');await input.blur();await page.waitForFunction(()=>window.__mockState.config.finalReplacements['1'].fusion.level===999999);
    assert.equal(await page.locator('#final-moves-level').inputValue(),'999999');
    await page.locator('[data-replacement-kind="fusion"]').screenshot({path:path.join(output,'final-fusion-settings.png')});
  });
  await check('each-character-persists-own-final-replacement-through-build-switch-and-reload', async () => {
    await page.locator('#build-select').selectOption('generic');
    assert.equal(await page.locator('#final-moves-0').inputValue(),'日光束');
    await page.locator('.character-card').filter({hasText:'皮卡丘'}).click();
    assert.equal(await page.locator('#final-moves-enabled').isChecked(),false);
    assert.equal(await page.locator('#final-fusion-enabled').isChecked(),false);
    await page.locator('#final-moves-enabled').check(); await page.locator('#final-moves-0').fill('电击');
    await page.locator('#final-moves-0-options').getByRole('option').filter({hasText:'电击'}).click();
    assert.equal(await page.evaluate(()=>window.__mockState.config.finalReplacements['25'].moves.targets[0]),'thunder-shock');
    await page.locator('#final-fusion-enabled').check();await page.locator('#final-fusion-0').fill('电流');
    await page.locator('#final-fusion-0-options').getByRole('option').filter({hasText:'电流融合示例'}).click();
    assert.equal(await page.evaluate(()=>window.__mockState.config.finalReplacements['25'].fusion.targets[0]),'fusion-electric');
    await page.locator('.character-card').filter({hasText:'妙蛙种子'}).click();
    assert.equal(await page.locator('#final-moves-0').inputValue(),'日光束');
    assert.equal(await page.locator('#final-vitamins-5').inputValue(),'营养 6');
    assert.equal(await page.locator('#final-fusion-0').inputValue(),'翠光融合示例');
    assert.equal(await page.locator('#final-fusion-3').inputValue(),'花雨融合示例');
    await page.evaluate(()=>window.__renderState(structuredClone(window.__mockState)));
    await page.locator('#tab-overview').click(); await page.locator('#tab-characters').click();
    assert.equal(await page.locator('#final-moves-level').inputValue(),'999999');
    assert.equal(await page.locator('#final-moves-0').inputValue(),'日光束');
    assert.equal(await page.locator('#final-fusion-level').inputValue(),'999999');
    assert.match(await page.locator('#final-replacements').innerText(),/本局进化后继续沿用/);
  });
  await check('strict-selection-defaults-off-shows-four-searchable-fields-without-script-level-controls',async()=>{
    for (const kind of ['strictMoves','strictVitamins']) {
      assert.equal(await page.locator(`#final-${kind}-enabled`).isChecked(),false);
      assert.equal(await page.locator(`[data-replacement-kind="${kind}"] .replacement-fields`).isHidden(),true);
      assert.equal(await page.locator(`#final-${kind}-level`).count(),0);
      await page.locator(`#final-${kind}-enabled`).check();
      assert.equal(await page.locator(`[data-replacement-kind="${kind}"] input[role="combobox"]`).count(),4);
    }
    await page.locator('#final-strictMoves-0').click();
    assert.equal(await page.locator('#final-strictMoves-0-options [role="option"]').count(),5);
    assert.match(await page.locator('#final-strictMoves-0-options').innerText(),/普通招式.*融合招式/s);
    assert.equal(await page.locator('#final-strictMoves-0-options').getByText('不可学融合示例').count(),0);
    await page.locator('#build-character').click();
  });
  await check('strict-allowlists-merge-ordinary-and-fusion-search-preserve-duplicates-and-override-without-erasing-legacy',async()=>{
    await page.locator('#final-strictMoves-0').fill('藤鞭');
    await page.locator('#final-strictMoves-0-options').getByRole('option').filter({hasText:'普通招式'}).click();
    for (const index of [1,2]) {
      await page.locator(`#final-strictMoves-${index}`).fill('翠光');
      await page.locator(`#final-strictMoves-${index}-options`).getByRole('option').filter({hasText:'翠光融合示例'}).click();
    }
    assert.deepEqual(await page.evaluate(()=>window.__mockState.config.finalReplacements['1'].strictMoves.targets),['vine-whip','fusion-vine-solar','fusion-vine-solar',null]);
    assert.equal(await page.locator('#final-strictMoves-error').textContent(),'');
    await page.locator('#final-strictVitamins-0').fill('营养 6');
    await page.locator('#final-strictVitamins-0-options').getByRole('option').filter({hasText:'营养 6'}).click();
    assert.deepEqual(await page.evaluate(()=>window.__mockState.config.finalReplacements['1'].strictVitamins.targets),['vit-6',null,null,null]);
    assert.equal(await page.evaluate(()=>window.__mockState.config.finalReplacements['1'].strictMoves.level),undefined);
    assert.equal(await page.locator('#final-moves-enabled').isChecked(),true);assert.equal(await page.locator('#final-fusion-enabled').isChecked(),true);
    assert.match(await page.locator('[data-replacement-kind="moves"]').innerText(),/当前被.*只选指定招式.*覆盖.*旧配置仍保留/);
    assert.match(await page.locator('[data-replacement-kind="vitamins"]').innerText(),/只选指定维生素.*覆盖/);
    assert.equal(await page.locator('#final-moves-0').inputValue(),'日光束');assert.equal(await page.locator('#final-vitamins-5').inputValue(),'营养 6');
    await page.locator('#final-strictMoves-enabled').uncheck();await page.locator('#final-strictVitamins-enabled').uncheck();
    assert.doesNotMatch(await page.locator('[data-replacement-kind="moves"]').innerText(),/当前被/);
    assert.equal(await page.locator('#final-fusion-0').inputValue(),'翠光融合示例');
    await page.locator('#final-strictMoves-enabled').check();assert.equal(await page.locator('#final-strictMoves-2').inputValue(),'翠光融合示例');
  });
  await check('strict-settings-remain-per-character-through-mode-build-switch-and-ui-reload',async()=>{
    await page.locator('.character-card').filter({hasText:'皮卡丘'}).click();
    assert.equal(await page.locator('#final-strictMoves-enabled').isChecked(),false);
    await page.locator('#final-strictMoves-enabled').check();await page.locator('#final-strictMoves-0').fill('电流');
    await page.locator('#final-strictMoves-0-options').getByRole('option').filter({hasText:'电流融合示例'}).click();
    assert.equal(await page.evaluate(()=>window.__mockState.config.finalReplacements['25'].strictMoves.targets[0]),'fusion-electric');
    await page.locator('.character-card').filter({hasText:'妙蛙种子'}).click();
    assert.equal(await page.locator('#final-strictMoves-0').inputValue(),'藤鞭');
    await page.locator('#build-select').selectOption('generic');
    await page.locator('#tab-overview').click();await page.locator('#tab-characters').click();
    await page.evaluate(()=>window.__renderState(structuredClone(window.__mockState)));
    assert.equal(await page.locator('#final-strictMoves-enabled').isChecked(),true);
    assert.equal(await page.locator('#final-strictMoves-2').inputValue(),'翠光融合示例');
  });
  await check('strict-empty-lists-are-valid-do-not-block-start-and-runtime-notices-preserve-focused-input',async()=>{
    const previousMode=await page.evaluate(()=>window.__mockState.config.mode);
    await push({config:{mode:'resources',finalReplacements:{...await page.evaluate(()=>window.__mockState.config.finalReplacements),'1':{
      ...await page.evaluate(()=>window.__mockState.config.finalReplacements['1']),strictMoves:{enabled:true,targets:[null,null,null,null]},strictVitamins:{enabled:true,targets:[null,null,null,null]}}}},
      game:{state:'over',nativeMode:'standard',unlockProgress:null,tactics:{finalReplacement:{species:1,strictMoves:{enabled:true,phase:'empty',targets:[]},strictVitamins:{enabled:true,phase:'empty',targets:[]}}}}});
    assert.equal(await page.locator('#main-action').isEnabled(),true);
    assert.match(await page.locator('#final-replacement-runtime').innerText(),/只选指定招式.*允许列表为空/);
    assert.match(await page.locator('[data-replacement-kind="strictMoves"]').innerText(),/4格全空.*不主动学习新招式/);
    assert.equal(await page.locator('#final-strictMoves-0').inputValue(),'');
    await page.locator('#final-strictMoves-0').focus();
    await page.evaluate(()=>window.__strictFocusedInput=document.querySelector('#final-strictMoves-0'));
    await push({game:{tactics:{finalReplacement:{species:1,strictMoves:{enabled:true,phase:'prepare',reason:'父招式是所选融合的合法临时准备，不是无关补位'},strictVitamins:{enabled:true,phase:'empty',targets:[]}}}}});
    assert.match(await page.locator('#final-replacement-runtime').innerText(),/父招式是所选融合的合法临时准备/);
    assert.equal(await page.evaluate(()=>document.activeElement===window.__strictFocusedInput&&document.querySelector('#final-strictMoves-0')===window.__strictFocusedInput),true);
    await page.locator('#build-character').click();
    await page.locator('#final-strictMoves-enabled').uncheck();await page.locator('#final-strictVitamins-enabled').uncheck();
    await push({config:{mode:previousMode},game:{tactics:null}});
  });
  await check('missing-fusion-catalog-keeps-preset-without-offering-unreviewed-global-moves',async()=>{
    await page.evaluate(()=>{const next=structuredClone(window.__catalog);for(const character of next.characters)delete character.learnableFusions;window.__PB_UI.receiveCatalog(next);});
    await page.locator('#final-fusion-0').click();
    assert.equal(await page.locator('#final-fusion-0-options [role="option"]').count(),1);
    assert.match(await page.locator('#final-fusion-0-options').innerText(),/尚无该角色可用融合招式目录/);
    assert.equal(await page.evaluate(()=>window.__mockState.config.finalReplacements['1'].fusion.targets[0]),'fusion-vine-solar');
    await page.evaluate(()=>window.__PB_UI.receiveCatalog(structuredClone(window.__catalog)));
    assert.equal(await page.locator('#final-fusion-0').inputValue(),'翠光融合示例');
  });
  await check('fusion-parent-conflict-clears-when-a-native-nonoverlapping-recipe-exists',async()=>{
    // Remove the second requested copy first: its single recipe conflicts with
    // itself independently of the other fusion's newly unlocked route.
    await page.locator('#final-fusion-1').fill('');await page.locator('#final-fusion-1').press('Enter');
    await page.waitForFunction(()=>window.__mockState.config.finalReplacements['1'].fusion.targets[1]===null);
    await page.evaluate(()=>{const next=structuredClone(window.__catalog);next.characters[0].learnableFusions[1].routes.push({aKey:'tackle',bKey:'razor-leaf'});window.__PB_UI.receiveCatalog(next);});
    assert.equal(await page.locator('.replacement-fusion-conflicts').count(),0);
    assert.equal(await page.evaluate(()=>window.__mockState.config.finalReplacements['1'].fusion.targets[3]),'fusion-flower');
    await page.evaluate(()=>window.__PB_UI.receiveCatalog(structuredClone(window.__catalog)));
    assert.equal(await page.locator('.replacement-fusion-conflicts').count(),1);
  });
  await check('fusion-runtime-status-follows-starting-character-without-rebuilding-inputs',async()=>{
    await page.locator('#final-fusion-0').focus();
    await page.evaluate(()=>{window.__runtimeCharacterNode=document.querySelector('.character-card');window.__runtimeFusionInput=document.querySelector('#final-fusion-0');});
    await push({game:{tactics:{finalReplacement:{species:1,fusion:{enabled:true,active:true,phase:'leveling-parents',reason:'原料就绪前先升级至8级',completed:[],pending:['fusion-vine-solar'],blocked:[]}}}}});
    assert.match(await page.locator('#final-replacement-runtime').innerText(),/原料就绪前先升级至8级.*已完成 0.*待完成 1/);
    await push({game:{tactics:{finalReplacement:{species:1,fusion:{enabled:true,active:true,phase:'find-bill',completed:1,pending:0,blocked:0}}}}});
    assert.match(await page.locator('#final-replacement-runtime').innerText(),/寻找正辉的机器.*已完成 1/);
    await push({game:{tactics:{finalReplacement:{species:1,fusion:{enabled:true,active:true,phase:'upgrading-parents',completed:[],pending:{key:'fusion-vine-solar'},blocked:[]}}}}});
    assert.match(await page.locator('#final-replacement-runtime').innerText(),/将原料招式升至8级.*待完成 1/);
    await push({game:{tactics:{finalReplacement:{species:1,fusion:{enabled:true,active:true,phase:'remove-blocking-random',completed:[],pending:{key:'fusion-vine-solar',blockingMoveSlots:[1],relearnSlots:[2]},blocked:[]}}}}});
    assert.match(await page.locator('#final-replacement-runtime').innerText(),/保留输出后.*遗忘阻塞共享随机招式学习的普通招式.*共享→本系/);
    assert.equal(await page.evaluate(()=>window.__runtimeCharacterNode===document.querySelector('.character-card')&&window.__runtimeFusionInput===document.querySelector('#final-fusion-0')&&document.activeElement===window.__runtimeFusionInput),true);
    await push({game:{tactics:{finalReplacement:{species:25,fusion:{enabled:true,active:true,reason:'这条属于另一角色不能显示'}}}}});
    assert.match(await page.locator('#final-replacement-runtime').innerText(),/使用妙蛙种子开局时生效/);
    assert.doesNotMatch(await page.locator('#final-replacement-runtime').innerText(),/这条属于另一角色/);
  });
  await check('unchanged-state-custom-plans-do-not-rebuild-the-character-grid-every-tick',async()=>{
    await page.evaluate(()=>{window.__mockState.customPlans=[];window.__PB_UI.receiveState(structuredClone(window.__mockState));
      window.__preservedCharacterNode=document.querySelector('.character-card');});
    assert.equal(await page.evaluate(()=>{for(let i=0;i<10;i++)window.__PB_UI.receiveState(structuredClone(window.__mockState));
      return window.__preservedCharacterNode===document.querySelector('.character-card');}),true);
    assert.equal(await page.evaluate(()=>{window.__mockState.customPlans=[{id:'custom-public-example',name:'新的公开方案',species:null,enabled:true}];
      window.__PB_UI.receiveState(structuredClone(window.__mockState));return window.__preservedCharacterNode!==document.querySelector('.character-card');}),true);
  });
  await check('invalid-empty-catalog-preserves-valid-character-and-final-move-lists',async()=>{
    const before=await page.locator('#character-total').innerText();
    await page.evaluate(()=>window.__PB_UI.receiveCatalog({...window.__catalog,characters:[]}));
    assert.equal(await page.locator('#character-total').innerText(),before);
    assert.equal(await page.locator('.character-card').count(),3);
    await page.waitForTimeout(1200);
    assert.equal(await page.locator('#character-total').innerText(),before);
  });
  await check('catalog-read-failure-retries-without-reloading-game-or-clearing-owned-characters',async()=>{
    await page.evaluate(()=>{
      window.__retryReads=0;window.desktop.getCatalog=async()=>{if(++window.__retryReads===1)throw Error('synthetic-read-failure');return structuredClone(window.__catalog)};
      window.__PB_UI.receiveState({catalogRevision:'synthetic-catalog-1'});
      window.__PB_UI.receiveState({catalogRevision:'synthetic-catalog-2'});
    });
    await page.waitForFunction(()=>window.__retryReads>=2);
    assert.equal(await page.locator('.character-card').count(),3);
    assert.doesNotMatch(await page.locator('#toast').innerText(),/状态同步失败|目录更新未完成|连接失败/);
  });
  await page.setViewportSize({ width: 880, height: 360 });
  await page.locator('#final-vitamins-level').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(output,'compact-final-replacement.png')});
  await check('compact-final-replacement-panel-scrolls-and-does-not-overflow',async()=>{
    assert.equal(await page.locator('.build-panel').evaluate(node=>getComputedStyle(node).overflowY),'auto');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  });
  await page.locator('#tab-modes').click();
  await page.locator("#unlock-target-selects").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, "compact-targets.png") });
  await check("compact-layout-retains-a-scrollable-mode-page", async () => {
    assert.equal(await page.locator("#page-modes").evaluate(element => getComputedStyle(element).overflowY), "auto");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('#modes-grid').evaluate(element => getComputedStyle(element).display), "grid");
    assert.equal(await page.locator('#modes-grid').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length), 4);
  });
  await check('guide-references-are-explicit-only-and-never-labelled-victory-records',async()=>{
    await page.evaluate(()=>{
      const next=structuredClone(window.__catalog);
      next.builds=[{id:'generic',sourceType:'generic',name:'通用通关思路'},
        {id:'guide-ui-fixture',sourceType:'guide',species:1,name:'隔离攻略参考',moves:['vine-whip'],observedMoves:[],
          victory:null,ranked:false,hasDetailedBuild:false,rank:999,time:123,
          source:'https://example.invalid/guide#r1',guideObservation:{gameplayValidated:false}}];
      window.__guideFixtureCatalog=next;
      window.__catalog=next;
      window.__PB_UI.receiveCatalog(next);
    });
    await push({running:false,profile:{league:[1]},config:{build:'auto',characterId:1},game:{state:'over',characterId:1,buildId:null,tactics:null}});
    await page.locator('#tab-characters').click();
    await page.locator('.character-card').filter({hasText:'妙蛙种子'}).click();
    assert.match(await page.locator('#build-kind').innerText(),/通用方案/);
    assert.match(await page.locator('#build-select option[value="guide-ui-fixture"]').innerText(),/攻略参考/);
    await page.locator('#build-select').selectOption('guide-ui-fixture');
    await page.waitForFunction(()=>window.__mockState.config.build==='guide-ui-fixture');
    assert.match(await page.locator('#build-kind').innerText(),/攻略参考.*手动选择/);
    assert.match(await page.locator('#build-tags [data-move-source="guide"]').innerText(),/攻略参考.*藤鞭/);
    assert.equal(await page.locator('#build-tags [data-move-source="observed"]').count(),0);
    await page.locator('#build-details').evaluate(node=>node.open=true);
    assert.match(await page.locator('#build-extra [data-move-record="guide"]').innerText(),/不是胜利记录.*不自动抢占/);
    assert.match(await page.locator('#build-source').innerText(),/第三方攻略参考.*未实战验证/);
    assert.doesNotMatch(await page.locator('#build-source').innerText(),/排名 #999|通关 00:02:03|公开排行榜胜利记录/);
    await page.evaluate(()=>{
      const next=structuredClone(window.__guideFixtureCatalog);
      next.builds.unshift({id:'observed-ui-fixture',sourceType:'leaderboard',species:1,name:'隔离实战参考',
        observedMoves:['solar-beam'],moves:['solar-beam'],victory:true,hasDetailedBuild:true});
      window.__catalog=next;
      window.__PB_UI.receiveCatalog(next);
    });
    await push({config:{build:'auto'},game:{buildId:null,tactics:null}});
    assert.match(await page.locator('#build-tags [data-move-source="observed"]').innerText(),/实战记录.*日光束/);
    assert.equal(await page.locator('#build-tags [data-move-source="guide"]').count(),0);
    await page.evaluate(()=>{
      const next=structuredClone(window.__guideFixtureCatalog);
      next.builds.unshift({id:'nonvictory-ui-fixture',sourceType:'leaderboard',species:1,name:'隔离非胜利实战',
        observedMoves:['solar-beam'],moves:['solar-beam'],victory:false,ranked:false,hasDetailedBuild:true,time:123});
      window.__catalog=next;
      window.__PB_UI.receiveCatalog(next);
    });
    await push({config:{build:'nonvictory-ui-fixture'},game:{buildId:null,tactics:null}});
    assert.match(await page.locator('#build-source').innerText(),/公开排行榜记录.*原生记录：非胜利.*对局时长/);
    assert.doesNotMatch(await page.locator('#build-source').innerText(),/排行榜胜利记录|通关 /);
  });
  assert.deepEqual(errors, []);
  const sourceHashes = Object.fromEntries(await Promise.all(['client/ui/app.js','client/ui/index.html','client/ui/styles.css','test/client-ui-unlocks.mjs'].map(async name => [name,crypto.createHash('sha256').update(await fs.readFile(path.join(root,name))).digest('hex')])));
  await fs.writeFile(path.join(output, "summary.json"), JSON.stringify({ passed: true, checks, errors, sourceHashes, isolatedMockOnly: true,
    gameOpened: false, accountCreated: false, credentialsRead: false, nativeGameplayVerified: false }, null, 2));
  console.log(JSON.stringify({ passed: true, checks: checks.length, output }));
} catch (error) {
  await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});
  await fs.writeFile(path.join(output, "summary.json"), JSON.stringify({ passed: false, checks, errors, reason: error.message, isolatedMockOnly: true }, null, 2));
  throw error;
} finally { await browser.close(); }
