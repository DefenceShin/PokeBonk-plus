// Deterministic rebuild from an explicitly reviewed public snapshot. This
// never opens a browser or evaluates App/Run/Player/account code.
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { buildPublicResourceEncyclopedia, buildRuntimeEncyclopedia, compactHistoricalDetails, encyclopediaCategories } from "../src/encyclopedia.mjs";

const root = new URL("../", import.meta.url);
const read = async (path) => JSON.parse(await fs.readFile(new URL(path, root), "utf8"));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Deployment coverage belongs to the same immutable reviewed snapshot as the
// definitions. Never consult the historical, unversioned deployment report or
// relabel its collection time when rebuilding a current catalog.
export function projectReviewedPublicDeployment(snapshot, deployment, path) {
  const { audit, manifestPath } = snapshot || {};
  const expectedPath = typeof manifestPath === 'string'
    ? manifestPath.replace(/public-audit\.json$/, 'deployment-review.json') : null;
  if (!audit || path !== expectedPath || !Object.hasOwn(audit.reviewedArtifacts || {}, path) ||
      deployment?.schemaVersion !== 1 || deployment.reportType !== 'public-static-deployment-inventory' ||
      deployment.publicOnly !== true || deployment.authenticatedRequests !== false ||
      deployment.credentialsRead !== false || deployment.browserOpened !== false || deployment.gameExecuted !== false ||
      deployment.gameVersion !== audit.gameVersion || deployment.sourceHash !== audit.sourceHash ||
      deployment.newsHash !== audit.newsHash || !Number.isFinite(Date.parse(deployment.completedAt)))
    throw Error('Current deployment review does not match the reviewed public snapshot');
  const records = deployment.resources, closure = deployment.fullResourceClosure,
    consistency = deployment.deploymentConsistency, final = deployment.finalConsistency;
  if (!Array.isArray(records) || records.length === 0 || !closure ||
      records.some(row => row.status !== 200 || !/^[a-f0-9]{64}$/.test(row.sha256 || '') ||
        row.credentialsAdded !== false || row.cookiesAdded !== false || typeof row.url !== 'string') ||
      !Array.isArray(deployment.failures) || deployment.failures.length ||
      !Array.isArray(deployment.parseFailures) || deployment.parseFailures.length ||
      !Array.isArray(closure.failures) || closure.failures.length ||
      !Array.isArray(closure.parseFailures) || closure.parseFailures.length ||
      closure.requests !== records.length || closure.uniqueURLs !== new Set(records.map(row => row.url)).size ||
      !Number.isInteger(closure.jsModules) || closure.jsModules < 1 ||
      !Number.isInteger(closure.cssModules) || closure.cssModules < 1 ||
      !Number.isInteger(closure.nativeVersionedJSON) || closure.nativeVersionedJSON < 1 ||
      closure.allNativeVersionedBytesMatchPlain !== true ||
      consistency?.initialVersion?.version !== audit.gameVersion ||
      consistency?.closingVersion?.version !== audit.gameVersion ||
      consistency?.initialVersion?.build !== deployment.gameBuild ||
      consistency?.closingVersion?.build !== deployment.gameBuild ||
      ['indexUnchanged','versionUnchanged','primaryBuildMatchesManifest','newsBuildMatchesManifest']
        .some(key => consistency?.[key] !== true) ||
      ['htmlUnchanged','versionUnchanged','mainUnchanged','newsUnchanged'].some(key => final?.[key] !== true))
    throw Error('Current public deployment closure is incomplete or unstable');
  const modules = records.filter(row => row.kind === 'module'),
    versioned = records.filter(row => row.kind === 'native-versioned-data'),
    plain = new Map(records.filter(row => row.kind === 'data').map(row => [row.url, row.sha256]));
  if (modules.filter(row => new URL(row.url).pathname.endsWith('.js')).length !== closure.jsModules ||
      modules.filter(row => new URL(row.url).pathname.endsWith('.css')).length !== closure.cssModules ||
      versioned.length !== closure.nativeVersionedJSON || versioned.some(row => {
        const url = new URL(row.url); url.search = ''; url.hash = '';
        return plain.get(url.href) !== row.sha256;
      })) throw Error('Current deployment module counts or native versioned resource bytes differ');
  const comparisons = deployment.moduleComparison;
  const dataChanges = deployment.nativeDataComparison;
  const newOfficialContentDetected = Array.isArray(comparisons) && Array.isArray(dataChanges)
    ? comparisons.some(row => row.counts?.changedUnits > 0 || row.counts?.changedMethods > 0 ||
        row.counts?.removed > 0 || row.counts?.added > 0) || dataChanges.some(row => row.byteIdentical === false)
    : null;
  return { path, verifiedAt: deployment.completedAt, gameVersion: deployment.gameVersion,
    gameBuild: deployment.gameBuild, sourceHash: deployment.sourceHash, newsHash: deployment.newsHash,
    resourceReviewPassed: true, coverage: { requests: closure.requests, uniqueURLs: closure.uniqueURLs,
      jsModules: closure.jsModules, cssModules: closure.cssModules, nativeVersionedJSON: closure.nativeVersionedJSON },
    newOfficialContentDetected };
}

export async function loadReviewedPublicDeployment(snapshot) {
  const path = snapshot.manifestPath.replace(/public-audit\.json$/, 'deployment-review.json');
  const expected = snapshot.audit.reviewedArtifacts?.[path], bytes = await fs.readFile(new URL(path, root));
  if (!/^[a-f0-9]{64}$/.test(expected || '') || sha(bytes) !== expected)
    throw Error('Unreviewed or changed current public deployment dependency: ' + path);
  return projectReviewedPublicDeployment(snapshot, JSON.parse(bytes), path);
}

export async function loadReviewedPublicSnapshot({ manifestPath } = {}) {
  if(manifestPath===undefined){
    const pointer=await read('data/reviewed-native-snapshot.json');
    if(pointer.schemaVersion!==1||typeof pointer.manifestPath!=='string')throw Error('Current reviewed native snapshot pointer is invalid');
    manifestPath=pointer.manifestPath;
  }
  if (!/^research\/update-\d+\.\d+\.\d+(?:-[a-z0-9]{1,16})?-public-audit\.json$/.test(manifestPath)) throw Error("Invalid reviewed public manifest path");
  const prefix = manifestPath.slice(0, -"public-audit.json".length);
  const audit = await read(manifestPath);
  if (audit.schemaVersion !== 1 || audit.publicOnly !== true || !audit.reviewedArtifacts ||
      !audit.sourceHash || !audit.newsHash || !audit.files)
    throw Error("Reviewed public snapshot manifest is incomplete; refusing a legacy fallback");
  for (const [path, expected] of Object.entries(audit.reviewedArtifacts)) {
    if (!path.startsWith(prefix) || !/^[A-Za-z0-9-]+(?:\.min)?\.(?:js|json)$/.test(path.slice(prefix.length)) || !/^[a-f0-9]{64}$/.test(expected))
      throw Error("Invalid reviewed artifact manifest entry");
    if (sha(await fs.readFile(new URL(path, root))) !== expected)
      throw Error("Reviewed public snapshot hash mismatch: " + path);
  }
  const required = path => {
    if (!Object.hasOwn(audit.reviewedArtifacts, path)) throw Error("Unreviewed public snapshot dependency: " + path);
    return path;
  };
  const definitions = await read(required(audit.files.definitions));
  const rules = await read(required(audit.files.rules));
  const metadata = await read(required(audit.files.unlock));
  const systems = await read(required(audit.files.systems));
  const learning = await read(required(audit.files.learning));
  if ([definitions, rules, metadata, systems, learning].some(value => value.sourceHash !== audit.sourceHash ||
      value.newsHash !== audit.newsHash || value.gameVersion !== audit.gameVersion) ||
      sha(await fs.readFile(new URL(required(audit.files.main), root))) !== audit.sourceHash ||
      sha(await fs.readFile(new URL(required(audit.files.news), root))) !== audit.newsHash)
    throw Error("Public definitions, source and reviewed version do not match");
  const resources = Object.fromEntries(await Promise.all(["pokemon", "moves", "items", "abilities", "learnsets"].map(async name =>
    [name, await read(required(audit.files.resources[name]))])));
  resources.gameVersion = definitions.gameVersion;
  resources.verifiedAt = definitions.verifiedAt;
  const vitaminEffects = await read("data/native-vitamin-effects.json");
  const vitaminReview=[vitaminEffects,vitaminEffects.reviewedAgainst].find(value=>value?.sourceHash===audit.sourceHash&&
    value?.newsHash===audit.newsHash&&value?.gameVersion===audit.gameVersion);
  if (vitaminEffects.schemaVersion !== 1 || vitaminEffects.publicOnly !== true ||
      !vitaminReview ||
      !Array.isArray(vitaminEffects.vitamins) || vitaminEffects.vitamins.length > 512 ||
      vitaminEffects.vitamins.some(def => !def || typeof def.key !== "string" ||
        typeof def.stat !== "string" || !Number.isFinite(def.per) || !["add","mul"].includes(def.kind)) ||
      !isDeepStrictEqual(vitaminEffects.vitamins,definitions.vitamins))
    throw Error("Public vitamin-effect snapshot is invalid");
  const guideReference = await read("data/guide-reference-2026-10-22.json");
  if (guideReference.schemaVersion !== 1 || guideReference.publicOnly !== true ||
      guideReference.pageScriptsExecuted !== false || guideReference.credentialsUsed !== false ||
      !Array.isArray(guideReference.sources) || !Array.isArray(guideReference.characters) ||
      !Array.isArray(guideReference.builds) || guideReference.reviewedAgainst?.sourceHash !== audit.sourceHash ||
      guideReference.reviewedAgainst?.gameVersion !== audit.gameVersion) throw Error("Public guide-reference snapshot is invalid");
  const shinyCatalog = await read("data/shiny-catalog.json");
  if (shinyCatalog.schemaVersion !== 1 || shinyCatalog.gameVersion !== audit.gameVersion ||
      shinyCatalog.bundleHashes?.game !== audit.sourceHash || shinyCatalog.bundleHashes?.news !== audit.newsHash ||
      !Array.isArray(shinyCatalog.species) || shinyCatalog.liveSourceVerification?.sourceHash !== audit.sourceHash)
    throw Error("Public shiny-source snapshot is invalid");
  return { audit, manifestPath, definitions, rules, metadata, systems, learning, resources, vitaminEffects, guideReference, shinyCatalog,
    localization: await read(required(audit.files.localization)) };
}

export function rebuildReviewedEncyclopedia(snapshot, base, catalog) {
  const { definitions, resources, localization, metadata } = snapshot;
  const output = buildRuntimeEncyclopedia({ ...definitions, masteryLooks: metadata.masteryLooks, treasureLooks:metadata.treasureLooks, masteryStyles: metadata.masteryStyles, modes: catalog.modes },
    buildPublicResourceEncyclopedia(resources, localization, base));
  const retainedBuildIds=new Set((catalog.builds||[]).map(build=>'builds:'+build.id));
  output.entries=output.entries.filter(entry=>entry.category!=='builds'||retainedBuildIds.has(entry.id));
  if (snapshot.vitaminEffects) {
    // Vitamins also retain a separate, exactly matched effects snapshot; its
    // history records previous audits without relabeling old gameplay results.
    const effects=snapshot.vitaminEffects,currentReview=effects.reviewedAgainst?.sourceHash===snapshot.definitions.sourceHash?effects.reviewedAgainst:effects,
      // This projection is already checked against all current definitions by
      // the loader. It does not rewrite the original effect collection file.
      projection={...effects,gameVersion:snapshot.definitions.gameVersion,sourceHash:snapshot.definitions.sourceHash,
        verifiedAt:currentReview.reviewedAt??currentReview.verifiedAt},
      patch = buildRuntimeEncyclopedia(projection, {}),
      vitaminEntries = new Map(patch.entries.filter(entry=>entry.category==="vitamins")
        .map(entry=>[entry.id,{...entry,source:{...entry.source,
          originalCollection:{gameVersion:effects.gameVersion,sourceHash:effects.sourceHash,newsHash:effects.newsHash,url:effects.sourceURL,verifiedAt:effects.verifiedAt},
          reviewedAgainst:{gameVersion:snapshot.definitions.gameVersion,sourceHash:snapshot.definitions.sourceHash,
            reviewedAt:currentReview.reviewedAt??currentReview.verifiedAt,...(currentReview.proof?{proof:currentReview.proof}:{})}}}]));
    output.entries = output.entries.filter(entry=>entry.category!=="vitamins" || vitaminEntries.has(entry.id))
      .map(entry=>vitaminEntries.get(entry.id) || entry);
    for (const entry of vitaminEntries.values())
      if (!output.entries.some(existing=>existing.id===entry.id)) output.entries.push(entry);
  }
  const refreshedBuilds=(catalog.builds||[]).filter(build=>build.publicObservation);
  if (refreshedBuilds.length) {
    const entries=new Map(output.entries.map(entry=>[entry.id,entry]));
    for (const build of refreshedBuilds) {
      const id='builds:'+build.id,observation=build.publicObservation;
      entries.set(id,{id,category:'builds',name:build.name,
        subtitle:'公开局末配装 · '+build.biome+' · '+build.date,
        description:build.note,
        keywords:[build.id,String(build.species),build.biome,...build.moves,...build.items,
          ...build.vitamins.map(v=>v.k||v.key||'')],
        details:{species:build.species,finalSpecies:build.finalSpecies,biome:build.biome,tier:build.tier,
          mode:build.mode,engineMode:build.engineMode,nativeModeProvided:build.nativeModeProvided,
          modeInferredFromPublicBoard:build.modeInferredFromPublicBoard,inferredNativeResult:build.inferredNativeResult,
          modeEvidenceConflict:build.modeEvidenceConflict,moves:build.moveDetails,
          vitamins:build.vitamins,items:build.itemCounts,stats:build.stats,
          ...(build.passive?{passive:build.passive}:{}),
          victory:build.victory,ranked:build.ranked,time:build.time,kills:build.kills,level:build.level,
          runAt:build.date,collectedAt:build.collectedAt,publicObservation:observation,
          runVersionKnown:false,currentControllerValidation:false},
        source:{url:build.source,label:'原生公开玩家卡/对局详情；局末参考，当前辅助未复现',
          verifiedAt:observation.at,gameVersion:null,collectionGameVersion:observation.collectionGameVersion},
        availability:{state:'historical',label:'公开历史局末记录；不表示当前版本可复现'}});
    }
    output.entries=[...entries.values()];
  }
  if (snapshot.guideReference) {
    const reference = snapshot.guideReference, entries = new Map(output.entries.map(entry=>[entry.id,entry])),
      sources = new Map(reference.sources.map(source=>[source.id,source]));
    for (const build of (catalog.builds||[]).filter(build=>build.sourceType==='guide')) {
      const observation=build.guideObservation, id='builds:'+build.id;
      entries.set(id,{id,category:'builds',name:build.name,subtitle:'第三方攻略参考 · 未作实战胜利验证',
        description:build.description+' '+build.note,
        keywords:[build.id,String(build.species),...build.moves,...build.fallbackMoves,...build.vitaminPriority,
          ...[...build.moves,...build.fallbackMoves].map(key=>catalog.moveNames?.[key]||key)],
        details:{species:build.species,recommendedMoves:build.moves,alternativeMoves:build.fallbackMoves,
          vitaminPriority:build.vitaminPriority,authorScores:observation.authorScores,
          corrections:observation.corrections,nativeConditions:'共享角色、当前形态、等级、禁选和空槽以原生对局与实时招式目录为准。',
          gameplayValidated:false,currentControllerValidation:false,victoryRecord:false},
        source:{url:build.source,label:'第三方配招思路；原生条件校对，作者评分仅参考',
          verifiedAt:observation.collectedAt,gameVersion:null,
          checkedAgainstVersion:observation.reviewedAgainstVersion,checkedAgainstHash:observation.reviewedAgainstHash},
        availability:{state:'reference',label:'手动参考方案；不会自动替换公开胜利配装'}});
    }
    const source=sources.get('general');
    for (const character of reference.characters) {
      const id='guides:reference-role-'+character.id;
      entries.set(id,{id,category:'guides',name:character.name+' · 攻略招式表核对',
        subtitle:'第三方表格 '+character.reportedPool.length+' 行 · 原生条件池 '+character.nativePoolCount+' 招',
        description:'保留第三方招式表的对照来源，等级以原生结果为准。共享角色、未来进化与变身复制条件不能忽略；可学全集见实时角色招式目录。网站未列齐维生素，也没有融合配方，不能当作当前游戏完整百科。',
        keywords:[String(character.id),character.name,...character.nativeLearnableMoves.flatMap(move=>[move.key,move.name])],
        details:{species:character.id,sourceRows:character.reportedPool,
          nativeMovePool:character.nativeLearnableMoves.map(move=>({key:move.key,name:move.name,minLevel:move.minLevel,
            mayRequireEvolution:move.routes.some(route=>route.requiresEvolution),
            mayRequireSharedCharacter:move.routes.some(route=>route.requiresSharedUnlock),
            mayRequireCopiedTypes:move.routes.some(route=>route.requiredCopiedTypes)})),
          conditionDetails:'精确形态、共享角色、变身复制属性组合与各条路线等级以实时角色与配装目录为准；最低等级不能替代这些前置。',
          gameplayValidated:false},
        source:{url:source.url+'#'+character.sourceAnchor,label:'第三方公开招式表；与原生条件池对照',
          verifiedAt:source.collectedAt,gameVersion:null,checkedAgainstVersion:reference.reviewedAgainst.gameVersion},
        availability:{state:'reference',label:'资料对照；不表示当前账号已经解锁'}});
    }
    output.entries=[...entries.values()];
  }
  if (snapshot.learning) {
    const learning = new Map(snapshot.learning.characters.map(character => [character.id, character]));
    for (const entry of output.entries) if (entry.category === "characters") {
      const character = learning.get(Number(entry.details?.id));
      if (character) entry.details = { ...entry.details,
        当前原生条件学习池: character.learnableMoves,
        可由合法招式对生成的融合: character.availableFusionKeys,
        学习条件说明: "这是未来进化、共享角色和复制属性条件的并集；每条 routes 保留具体前置，不能用最低等级代替全部资格。融合仍需两招达到原生等级8并使用实际比尔机器。" };
    }
  }
  if (snapshot.shinyCatalog) {
    const shiny = snapshot.shinyCatalog, maps = new Map(definitions.maps.map(map => [map.id, map.name]));
    for (const row of shiny.species) {
      const entry = output.entries.find(value => value.id === "shiny:" + row.id);
      if (!entry) continue;
      entry.name = "异色·" + row.name;
      entry.description = row.reachable
        ? "当前开放地图有原生条件来源；出现、收藏和联盟资格仍按该来源的真实限制。"
        : "当前开放地图没有已核实来源；保留未来地图资料，不表示现在可获取。";
      entry.details = { ...entry.details, 可遇来源: row.sources.map(source => ({ ...source, 地图: maps.get(source.biome) || source.biome })),
        资格说明: "来源条件按当前公开原生代码核对；未入盟限定和重复来源分别标示，不读取玩家个人资格。" };
      entry.source = { url: definitions.sourceURL, label: "当前原生异色来源与条件",
        gameVersion: shiny.gameVersion, sourceHash: shiny.bundleHashes.game, verifiedAt: shiny.reviewedAt ?? shiny.collectedAt };
      entry.availability = row.reachable ? { state: "current", label: "当前开放地图有条件来源；仍需满足原生资格" }
        : { state: "future", label: "当前开放地图无已核实来源" };
    }
  }
  if (snapshot.systems) {
    const supplement = snapshot.systems, entries = new Map(output.entries.map(entry => [entry.id, entry]));
    const names = { currentRelease: "当前更新内容", typeEffectiveness: "原作属性克制基础表", nativeTypeEffectiveness: "本作属性克制倍率转换",
      towerFloors: "紫苑塔全部楼层与敌群", towerLayouts: "紫苑塔楼层空间配置", towerCurses: "紫苑塔全部诅咒供品",
      altarKinds: "祭坛阶级与交互条件", signatureUltimates: "全部家族专属终极技", typeUltimates: "各属性保底终极技",
      shopBasePrice: "商店稀有度基价", shopRarityPriceScaling: "商店稀有度价格系数", slotWeights: "老虎机奖项基础权重",
      ultimateChargeBaseSeconds: "终极技基础充能时间", ultimateKillCharge: "击杀终极技充能",
      ultimateKillChargeRoomPerSecond: "终极技击杀充能补充", ultimateBaseDamage: "终极技基础伤害",
      blessings: "全部祝福选项", blessingScaling: "祝福数值与稀有度", interactionPrices: "局内交互价格规则", weather: "天气及属性效果", rarityMultipliers: "稀有度倍率",
      rarityNames: "稀有度", difficultyNames: "难度名称", kitLevels: "角色固有招式等级", liveRules: "当前赛季开放目录",
      questDefinitions: "完整成就目录（含尚未开放条件）", questTemplates: "每日与每周委托全部模板",
      contractBonus: "每日与每周委托完成奖励", consumables: "局前消耗品", shinyPerks: "异色收藏里程碑",
      shinyRewards: "异色收藏星尘奖励", shinyOdds: "异色出现概率参数", legendaryShinyBaseChance: "传说异色基础概率",
      shinyCharmMultiplier: "异色护符倍率", shinyFleeSeconds: "异色停留时间", difficulty: "各难度原生倍率",
      endlessPhases: "无尽阶段与里程碑", endlessCamping: "无尽驻留收益限制", endlessProjectileSoftCap: "无尽投射物软上限",
      seasonMedals: "赛季名次奖牌分段", seasonDust: "赛季名次星尘", clanFrames: "战队装饰解锁条件",
      clanSymbols: "战队赛季徽记", clanLevelRewards: "战队等级外观奖励", clanMissionKinds: "战队任务类型",
      clanMissionDurationHours: "战队任务时间", clanLeagueRewards: "战队联赛奖励", clanCupRewards: "战队杯赛奖励",
      fusionInheritance: "融合招式升级继承规则", fusionBalance: "融合招式当前数值校准",
      eventFormulas: "紫苑塔积分与任务计数规则", conditions: "公开获取与融合资格", interfaceMechanics: "当前原生界面与设置机制",
      treasures:"宝藏奖池与 Bonkoin",menuShop:"原生补给商店" };
    const add = (key, value) => entries.set("guides:official-" + key, { id: "guides:official-" + key,
      category: "guides", name: names[key] || key, subtitle: "官方公开 " + supplement.gameVersion + " · 静态定义核对",
      description: "依据当前公开客户端定义整理。账号资格、实时活动覆盖、服务器保存与领奖仍以原生状态为准；没有进行本轮游戏实测。",
      keywords: [key, names[key] || key], details: { 公开定义: value },
      source: { url: supplement.newsURL, label: "当前官方静态定义与纯目录计算", gameVersion: supplement.gameVersion,
        sourceHash: supplement.sourceHash, verifiedAt: supplement.verifiedAt },
      availability: { state: "current", label: "公开定义已核；不表示账号已满足条件" } });
    for (const [key, value] of Object.entries(supplement.systems)) add(key, value);
    for (const key of ["currentRelease", "eventFormulas", "conditions", "interfaceMechanics"]) if (supplement[key]) add(key, supplement[key]);
    output.entries = [...entries.values()];
  }
  // Activities keep separate identities/settings and remain documented when
  // closed. Static schedule dates must never manufacture native availability.
  output.entries = output.entries.filter(entry => entry.id !== "modes:events");
  for (const mode of (catalog.modes || []).filter(mode => mode.eventId)) {
    const entry = output.entries.find(entry => entry.id === "modes:" + mode.id);
    if (!entry) continue;
    entry.details = { ...entry.details, 活动设置: { eventId: mode.eventId, category: mode.category,
      activityKind: mode.activityKind, startsAt: mode.startsAt, endsAt: mode.endsAt,
      openingPeriods: mode.openingPeriods || [], displayTimeZone: "Asia/Shanghai",
      claimDays: mode.claimDays, sourceDefinitionPresent: mode.definitionPresent,
      rewardSelection: "在本活动下选择具体奖励或自动选择；每个活动单独保存配置。",
      lifecycle: "常驻模式和永久活动之后是统一的限时活动展开区；区内最新活动在前、已结束活动在后。返场复用原入口，卡片只显示最近北京时间日期，具体配置保留已核实的历次开放时间。",
      availabilitySource: "只有原生实时 live/claimable 能确定可积累或可领奖；本机日期不决定资格。" } };
    entry.availability = { state: "unknown", label: "活动资格按原生实时状态；结束后保留入口，返场重新核对" };
  }
  output.notes = [
    "百科只包含公开资料，不读取账号、会话或私人进度。",
    "1025种基础物种不表示全部可玩；联盟目录79名角色，经典地图当前开放森林、沙漠、海岸、冰川，另2张地图仍未开放。",
    "当前定义快照为" + definitions.gameVersion + "；新道具、维生素、研究与成就来自公开静态定义与纯计算，新增机制未作完整实战验证。",
    definitions.fusionMoves.length + "个融合招式由原生静态配方、数值校准及注册函数生成；保留真实配方条件，不表示当前角色满足融合资格。",
    "原生被动、条件学习池、活动与公开系统按当前快照重新整理；旧公开配装保留原作者和采集来源，不表示原版本成绩已在新版重现。",
    "紫苑塔活动须由原生活动入口开放；先完成塔顶目标，进入彼岸需另行授权。",
    "每个活动拥有独立模式入口和具体奖励选择；限时活动结束后保留入口与设置，返场由原生活动状态重新确认。",
    ...(snapshot.vitaminEffects ? ["26种维生素的额外效果、随机骰子与机制说明另以公开" +
      snapshot.vitaminEffects.gameVersion + "定义核对；该补充不表示其他类别已重新审核或完成实战验证。"] : []),
    ...(snapshot.guideReference ? ["第三方流派方案和招式对照另标为参考资料；按原生门槛和弹道校正，不当作胜利实测或完整游戏资料。"] : []),
  ];
  // Learning pools, event settings and other reviewed supplements are added
  // after the native definition merge. Compact against the complete current
  // details now, so a source migration reaches its fixed point in one rebuild.
  output.entries = output.entries.map(entry => ({ ...entry, details: compactHistoricalDetails(entry.details) }));
  return output;
}

async function main() {
  const snapshot = await loadReviewedPublicSnapshot();
  const [base, catalog] = await Promise.all([read("data/encyclopedia.json"), read("data/catalog.json")]);
  const output = rebuildReviewedEncyclopedia(snapshot, base, catalog);
  if (process.argv.includes("--check")) {
    if (!isDeepStrictEqual(output, base)) throw Error("Offline encyclopedia differs from the reviewed rebuild");
  } else await fs.writeFile(new URL("data/encyclopedia.json", root), JSON.stringify(output) + "\n");
  console.log(JSON.stringify({ gameVersion: output.gameVersion, sourceHash: snapshot.definitions.sourceHash,
    entries: output.entries.length, counts: Object.fromEntries(encyclopediaCategories.map(category =>
      [category.id, output.entries.filter(entry => entry.category === category.id).length])),
    checkedOnly: process.argv.includes("--check"), publicOnly: true, accountOrGameExecuted: false }));
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();

