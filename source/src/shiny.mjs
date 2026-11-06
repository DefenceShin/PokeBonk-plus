// Read-only shiny hunting plans. Exact Pokédex entries and family skins are
// deliberately separate: the native game stores exact species in shinies.
const shinyEclipsePools = [[41, 92, 96, 35, 43], [42, 93, 97, 36, 44], [42, 94, 97, 36, 45]];
export const shinyTypeChoices = Object.freeze([{id:'shiny',label:'异色'}, {id:'classic',label:'经典异色'}].map(Object.freeze));
export function normalizeShinyTypes(raw) {
  const values=Array.isArray(raw)?raw:[];
  const result=shinyTypeChoices.map(row=>row.id).filter(id=>values.includes(id));
  return result.length?result:['shiny','classic'];
}
export function shinyOwnedForTypes(profile={},raw) {
  const types=normalizeShinyTypes(raw),collections=types.map(type=>new Set((profile[type==='classic'?'classics':'shinies']||[]).map(Number)));
  return [...collections[0]].filter(id=>collections.every(values=>values.has(id)));
}
// Only an executed shiny hunt narrows the catch types. Other goals and their
// explicit classic/normal capture requirements retain their existing priority.
export function shinyHuntTypeAllowed(type,settings={},plan={}) {
  const mode=plan.goalMode || (plan.objective==='shiny'?'shiny':settings.mode);
  return mode!=='shiny'||normalizeShinyTypes(settings.shinyTypes??plan.shinyTypes).includes(type);
}

function shinyNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function shinyMon(bridge, id) {
  try { return bridge.data?.get?.(id) || bridge.data?.pokemon?.find((mon) => mon.id === id) || {}; }
  catch { return {}; }
}

function shinyFamily(bridge, id) {
  const mon = shinyMon(bridge, id);
  if (mon.family != null) return mon.family;
  const catalogFamily = bridge.shinyCatalog?.species?.find((entry) => entry.id === id)?.family;
  if (catalogFamily != null) return catalogFamily;
  try { return bridge.data?.root?.(id)?.id ?? id; } catch { return id; }
}

function shinyHas(bridge, method, id) {
  try { return bridge.data?.[method] ? !!bridge.data[method](id) : true; } catch { return false; }
}

function shinyReady(profile, bridge, id) {
  if (profile.league?.includes(id)) {
    // Current native legendary hunting can repeat an owned legendary. Ask
    // only its audited pure boolean API; never roll or read/export its seed.
    if(typeof bridge.nativeLegendaryShinyReady!=="function")return false;
    try{return bridge.nativeLegendaryShinyReady(id)===true;}catch{return false;}
  }
  try {
    const native = bridge.meta?.leagueReady?.() ?? bridge.leagueReady?.();
    if (Array.isArray(native)) return native.includes(id);
  } catch { /* Use the same public challenge counters when the helper is absent. */ }
  const roster = bridge.roster?.find((entry) => entry.id === id);
  const parts = Array.isArray(roster?.challenge) ? roster.challenge : [roster?.challenge].filter(Boolean);
  return parts.length > 0 && parts.every((part) => {
    const counter = part.counter || "";
    const value = counter === "league" ? (profile.league || []).filter((entry) => entry !== 151).length :
      counter === "birds" ? [144, 145, 146].filter((entry) => profile.league?.includes(entry)).length :
        counter.startsWith("tier_") ? shinyNumber(profile.biomes?.[counter.slice(5)], -1) :
          shinyNumber(profile.counters?.[counter]);
    return value >= shinyNumber(part.goal, Infinity);
  });
}

/** Reconstructs director.buildPool, capture.spawnShiny and Eclipse sources. */
export function nativeShinySources(bridge) {
  const pokemon = (bridge.data?.pokemon || []).filter((mon) => mon.id > 0 && mon.id <= 151);
  if (!pokemon.length) return [];
  const ordinary = pokemon.filter((mon) => !mon.legendary && !mon.mythical && shinyHas(bridge, "hasSprite", mon.id));
  const records = new Map(pokemon.map((mon) => [mon.id, { ...mon, sources: [] }]));
  const add = (id, source) => {
    if (!records.has(id)) records.set(id, { ...shinyMon(bridge, id), id, sources: [] });
    records.get(id).sources.push(source);
  };
  for (const biome of bridge.biomes || []) {
    for (let stage = 1; stage <= 3; stage++) {
      const maxEvolution = stage === 1 ? 0 : stage === 2 ? 1 : 2;
      const minEvolution = Number(stage === 3);
      const typesMatch = (mon) => (mon.types || []).some((type) => (biome.types || []).includes(type));
      let pool = ordinary.filter((mon) => typesMatch(mon) && mon.evoStage <= maxEvolution && mon.evoStage >= minEvolution);
      const animated = pool.filter((mon) => shinyHas(bridge, "hasAnimated", mon.id));
      if (animated.length >= 24) pool = animated;
      if (stage === 3) pool = pool.concat(ordinary.filter((mon) => {
        let evolves;
        try { evolves = bridge.data?.evolutionsOf?.(mon.id); } catch { evolves = null; }
        const hasEvolution = evolves ? evolves.length > 0 : pokemon.some((other) => other.evoFrom === mon.id);
        return typesMatch(mon) && mon.evoStage === 0 && !hasEvolution && mon.bst >= 420 && shinyHas(bridge, "hasAnimated", mon.id);
      }));
      for (const id of new Set(pool.filter((mon) => shinyHas(bridge, "hasAnimated", mon.id)).map((mon) => mon.id)))
        add(id, { kind: "wild", biome: biome.id, stage });
      // Current native spawnShiny has an ordinary-only missing-base-family
      // fallback once its nonempty regional pool has no missing family left.
      // A runtime/native-source capability is required; an old catalogue alone
      // must not claim this rule after an unknown game update.
      if (bridge.captureFeatures?.ordinaryMissingBaseFallback === true && pool.length > 0)
        for (const mon of ordinary.filter(mon => mon.evoStage === 0 && shinyHas(bridge, "hasAnimated", mon.id)))
          add(mon.id, {kind:"missing-base-family",biome:biome.id,stage,ordinaryOnly:true,
            requiresUncollectedFamily:true,requiresNonemptyRegionalPool:true,requiresRegionalMissingFamiliesExhausted:true});
      for (const id of shinyEclipsePools[stage - 1])
        if (shinyHas(bridge, "hasSprite", id) && shinyHas(bridge, "hasAnimated", id)) add(id, { kind: "eclipse", biome: biome.id, stage });
    }
    const legendary = biome.sanctuary?.legendaries || (!biome.sanctuary ? biome.legendaries : []) || [];
    for (const id of legendary) if (shinyHas(bridge, "hasSprite", id))
      add(id, { kind: "sanctuary", biome: biome.id, stage: biome.sanctuary ? 4 : 3 });
    add(150, { kind: "mewtwo-event", biome: biome.id, stage: 2 });
    for (const member of bridge.roster || []) {
      const mon = shinyMon(bridge, member.id);
      if (member.id !== 150 && (member.rank === "legendary" || mon.legendary || mon.mythical))
        add(member.id, { kind: "league-legendary", biome: biome.id, stage: 1 });
    }
  }
  return [...records.values()];
}

function shinyAvailableSource(profile, settings, bridge, source, id) {
  const biome = bridge.biomes?.find((map) => map.id === source.biome);
  if (source.live === false || !biome || biome.live === false || shinyNumber(profile.biomes?.[biome.id], -1) < 0) return false;
  try { if (bridge.biomeLive && !bridge.biomeLive(biome.id)) return false; } catch { return false; }
  if (settings.biome && settings.biome !== "auto" && settings.biome !== biome.id) return false;
  if (source.kind === "missing-base-family" && (bridge.captureFeatures?.ordinaryMissingBaseFallback !== true ||
      (profile.shinies || []).some(owned => shinyFamily(bridge, owned) === shinyFamily(bridge, id)))) return false;
  if (["league-legendary", "mewtwo-event"].includes(source.kind) && !shinyReady(profile, bridge, id)) return false;
  return true;
}

/**
 * Selects an ordinary run; never changes RNG, encounters, items or account data.
 * Optional bridge.shinyCatalog is the sourced, versioned public-game catalog.
 */
export function resolveShinySettings(settings = {}) {
  if (!Object.prototype.hasOwnProperty.call(settings.unlockTargets || {}, "shiny")) return settings;
  const match = /^shiny:([1-9][0-9]*)$/.exec(String(settings.unlockTargets.shiny));
  return { ...settings, shinyMode: match ? "target" : "missing",
    shinyTargetId: match ? Number(match[1]) : null };
}

function selectNormalShinyPlan(profile, settings = {}, bridge = {}) {
  settings = resolveShinySettings(settings);
  if (settings.mode !== "shiny") return null;
  profile = profile || {};
  const owned = [...new Set((profile?.shinies || []).map(Number).filter((id) => id > 0))];
  const records = bridge.shinyCatalog?.species || nativeShinySources(bridge);
  const shinyMode = settings.shinyMode === "target" ? "target" : "missing";
  const requestedId = shinyNumber(settings.shinyTargetId, 0);
  const targetRecord = records.find((entry) => entry.id === requestedId);
  const candidates = shinyMode === "target" ? (targetRecord ? [targetRecord] : []) : records;
  const ownedTarget = shinyMode === "target" && owned.includes(requestedId);
  const repeatTarget = ownedTarget && settings.shinyStopWhenDone === false;
  const remaining = candidates.filter((entry) => !owned.includes(entry.id) || repeatTarget);
  const eligible = remaining.flatMap((entry) => (entry.sources || []).filter((source) =>
    shinyAvailableSource(profile, settings, bridge, source, entry.id)).map((source) => ({ ...source, id: entry.id })));
  const eligibleTargets = [...new Set(eligible.map((source) => source.id))].sort((a, b) => a - b);
  const unavailableTargets = remaining.filter((entry) => !eligibleTargets.includes(entry.id)).map((entry) => entry.id);
  const availableTargets = candidates.filter((entry) => (entry.sources || []).some((source) =>
    shinyAvailableSource(profile, settings, bridge, source, entry.id))).map((entry) => entry.id);
  const rosterIds = new Set((bridge.roster || []).map((entry) => entry.id));
  const playable = (profile?.league || []).filter((id) => rosterIds.has(id));
  const fixedSpecies = shinyNumber(settings.characterId, 0);
  const species = fixedSpecies || (playable.includes(profile?.lastSpecies) ? profile.lastSpecies : playable[0]);
  let shinyStatus = remaining.length ? eligible.length ? "ready" : shinyMode === "missing" ? "complete" : "inaccessible" : "complete";
  const needs = [];
  if (!records.length) {
    shinyStatus = "inaccessible";
    needs.push("异色资料尚未加载，等待游戏数据就绪");
  } else if (shinyMode === "target" && !targetRecord) {
    shinyStatus = "inaccessible";
    needs.push("请先选择一个有效的异色目标");
  } else if (shinyStatus === "complete") needs.push(shinyMode === "target" ? "指定异色已收藏" :
    remaining.length ? `当前账号与地图限制内可遇异色已收齐；图鉴另有${unavailableTargets.length}种当前不可达，未宣称全图鉴完成` : "当前图鉴异色已全部收藏");
  else if (!eligible.length) {
    if (shinyMode === "target" && (targetRecord?.sources || []).some((source) => ["league-legendary", "mewtwo-event"].includes(source.kind)))
      needs.push(profile?.league?.includes(requestedId) ? "该目标已加入联盟；当前原生传说异色资格尚未开放或未核验，保留目标等待合法来源" : "该目标需要先完成联盟挑战，再按原生资格出现解锁遭遇");
    else needs.push("当前开放且已解锁的地图与所选限制中，没有已确认可遇到的目标来源");
  }
  if ((shinyStatus !== "complete" || !playable.length) && (!playable.length || (fixedSpecies && !playable.includes(fixedSpecies)))) {
    shinyStatus = "inaccessible";
    needs.push(fixedSpecies ? "所选出战角色尚未加入联盟" : "需要先选择初始角色");
  }
  const ownedFamilies = new Set(owned.map((id) => shinyFamily(bridge, id)));
  const missingFamily = (id) => !ownedFamilies.has(shinyFamily(bridge, id));
  const sourceBlockers = (source) => {
    if (source.kind === "missing-base-family") return [...new Set(records.filter(record => missingFamily(record.id) &&
      (record.sources || []).some(other => other.kind === "wild" && other.biome === source.biome && other.stage === source.stage))
      .map(record => shinyFamily(bridge, record.id)))];
    if (shinyMode !== "target" || missingFamily(requestedId) || !["wild", "eclipse"].includes(source.kind)) return [];
    return [...new Set(records.filter((record) => missingFamily(record.id) && (record.sources || []).some((other) =>
      other.kind === source.kind && other.biome === source.biome && other.stage === source.stage))
      .map((record) => shinyFamily(bridge, record.id)))];
  };
  const mapScores = new Map();
  for (const source of eligible) {
    const key = source.biome;
    const seen = mapScores.get(key) || { id: key, ids: new Set(), earliest: Infinity, score: 0 };
    if (!seen.ids.has(source.id)) {
      seen.ids.add(source.id);
      seen.score += source.kind === "wild" ? 12 : source.kind === "eclipse" ? 4 : source.kind === "sanctuary" ? 2 : 1;
      if (missingFamily(source.id)) seen.score += 6;
    }
    seen.earliest = Math.min(seen.earliest, source.stage || 1);
    if (shinyMode === "target" && source.kind === "wild") seen.score += 20 / Math.max(1, source.stage);
    mapScores.set(key, seen);
  }
  const preferredTargetSource = shinyMode === "target" ? eligible.slice().sort((a, b) =>
    sourceBlockers(a).length - sourceBlockers(b).length ||
    Number(b.kind === "wild") - Number(a.kind === "wild") || (a.stage || 1) - (b.stage || 1))[0] : null;
  const selectedMap = [...mapScores.values()].sort((a, b) => b.score - a.score || a.earliest - b.earliest ||
    Number(b.id === profile?.lastBiome) - Number(a.id === profile?.lastBiome))[0];
  const liveMaps = (bridge.biomes || []).filter((map) => map.live !== false && shinyNumber(profile?.biomes?.[map.id], -1) >= 0);
  const biome = preferredTargetSource?.biome || selectedMap?.id || (settings.biome && settings.biome !== "auto" ? settings.biome : liveMaps[0]?.id || "forest");
  const tier = settings.tier == null || settings.tier === "auto" ? 0 :
    Math.min(2, shinyNumber(profile?.biomes?.[biome]), Math.max(0, shinyNumber(settings.tier)));
  const sources = eligible.filter((source) => source.biome === biome);
  const targetSources = shinyMode === "target" ? sources.filter((source) => source.id === requestedId) : sources;
  const familyBlockers = preferredTargetSource ? sourceBlockers(preferredTargetSource) : [];
  const familySuppressed = familyBlockers.length > 0;
  if (familySuppressed) needs.push(preferredTargetSource?.kind === "missing-base-family"
    ? `该基础家族来源需先收齐当前区域池内其余${familyBlockers.length}个未收藏家族；之后才会尝试未收藏基础家族，出现仍由原生随机决定`
    : `游戏优先生成未收藏异色的家族；当前建议路线中需先收集同池另外${familyBlockers.length}个家族，才可能再遇目标同族的精确形态`);
  if (repeatTarget) needs.push("指定异色已收藏；已关闭找到后停止，继续正常遭遇并捕获重复异色以获取重复奖励");
  if (shinyStatus === "ready") needs.push("异色由游戏随机生成，不能保证每局遇到；遭遇后先削弱，再正常投球捕获");
  const name = targetRecord?.name || shinyMon(bridge, requestedId).name || `#${requestedId}`;
  return {
    priority: "刷异色", objective: "shiny", mode: "standard", species, biome, tier,
    stage: preferredTargetSource?.stage || (targetSources.length ? Math.min(...targetSources.map((source) => source.stage || 1)) : 1),
    shinyStatus, shinyMode, shinyTargetId: shinyMode === "target" ? requestedId || null : null,
    shinyStopWhenDone: settings.shinyStopWhenDone !== false,
    eligibleTargets, unavailableTargets, availableTargets, owned, ownedTarget, repeatTarget,
    ownedFamilies: [...ownedFamilies], targetCount: candidates.length,
    missingCount: candidates.filter((entry) => !owned.includes(entry.id)).length,
    completionScope: shinyMode === "target" ? "exact-species" : "currently-available",
    familySuppressed, familyBlockers, recommendedSource: preferredTargetSource, shinySources: sources,
    automatable: shinyStatus === "ready", metrics: ["shinies"], needs, need: needs.join("；"),
    description: `${shinyMode === "target" ? `寻找异色${name}` : `补齐未拥有异色（当前可遇${eligibleTargets.length}种）`} · ${needs.join("；")}`,
    buildPreferences: { preferredMoves: [], vitaminPriority: ["luck", "moveSpeed", "attackSpeed", "regen"],
      itemPriority: ["comet-shard", "star-piece", "lucky-punch", "white-flute", "leftovers"], preferStatuses: ["paralysis", "sleep", "freeze"], preferTypes: [] },
  };
}

function classicShinyPlan(profile,settings,bridge,normal) {
  const table=bridge.classicSpeciesEligibility || bridge.unlockCatalog?.rules?.classicSpeciesEligibility;
  if(!Array.isArray(table)||!table.length)return null;
  const eligibility=new Map(table.filter(row=>Number.isInteger(row?.species)&&Array.isArray(row.members)).map(row=>[row.species,row.members]));
  const owned=[...new Set((profile.classics||[]).filter(Number.isInteger))],covered=new Set(owned.flatMap(id=>eligibility.get(id)||[])),
    records=bridge.shinyCatalog?.species || nativeShinySources(bridge),target=settings.shinyMode==='target'?Number(settings.shinyTargetId):null,
    candidates=records.filter(row=>!target||row.id===target),exactOwned=target!=null&&owned.includes(target),
    available=row=>(row.sources||[]).filter(source=>source.kind==='wild'&&shinyAvailableSource(profile,settings,bridge,source,row.id)),
    missing=candidates.filter(row=>!owned.includes(row.id)),
    eligible=missing.filter(row=>eligibility.get(row.id)?.some(id=>!covered.has(id))).flatMap(row=>available(row).map(source=>({...source,kind:'classic',id:row.id}))),
    maps=new Map();
  for(const source of eligible){const map=maps.get(source.biome)||{id:source.biome,ids:new Set(),stage:Infinity};map.ids.add(source.id);map.stage=Math.min(map.stage,source.stage);maps.set(map.id,map);}
  const selected=[...maps.values()].sort((a,b)=>b.ids.size-a.ids.size||a.stage-b.stage||a.id.localeCompare(b.id))[0],
    biome=selected?.id||normal?.biome||settings.biome||'forest',sources=eligible.filter(row=>row.biome===biome),
    species=normal?.species,tier=settings.tier==null||settings.tier==='auto'?0:Math.max(0,Math.min(2,Number(settings.tier)||0,Number(profile.biomes?.[biome])||0)),
    actorValid=(profile.league||[]).includes(species)&&(bridge.roster||[]).some(row=>row.id===species),
    invalidTarget=settings.shinyMode==='target'&&(!Number.isInteger(target)||target<=0||!candidates.some(row=>row.id===target)),
    status=!records.length||invalidTarget?'inaccessible':exactOwned?'complete':!actorValid?'inaccessible':sources.length?'ready':target&&missing.length?'inaccessible':'complete',
    blocked=missing.filter(row=>!eligible.some(source=>source.id===row.id)).map(row=>row.id),
    need=!records.length?'经典异色物种资料尚未加载，不能将空目录视为收藏完成':invalidTarget?'请选择一个有效的经典异色物种目标':!actorValid&&!exactOwned?(normal?.need||'所选出战角色尚未加入联盟'):status==='ready'?'按原生经典异色池等待并正常削弱、投球；出现受随机判定影响':status==='complete'?missing.length?`当前开放地图已无可抽取的经典异色；另有${blocked.length}种精确物种未收藏或暂不可达，未宣称全图鉴完成`:'所选经典异色已收藏；原生经典池不会保证提供重复捕捉':
      '所选经典异色当前没有已确认可抽取的来源；可能地图未开放，或对应可玩成员已被 classics 收藏覆盖，不能把普通异色当成经典收藏';
  return {...normal,priority:'刷经典异色',objective:'shiny',mode:'standard',goalMode:'shiny',species,biome,tier,
    stage:sources.length?Math.min(...sources.map(row=>row.stage)):1,shinyStatus:status,shinyMode:settings.shinyMode==='target'?'target':'missing',
    shinyTargetId:target,owned,classicOwned:owned,ownedTarget:exactOwned,repeatTarget:false,eligibleTargets:[...new Set(eligible.map(row=>row.id))],
    availableTargets:[...new Set(candidates.filter(row=>available(row).length).map(row=>row.id))],unavailableTargets:blocked,
    classicTargetIds:[...new Set(sources.map(row=>row.id))],classicSources:sources,classicAllSources:eligible,shinySources:[],
    targetCount:candidates.length,missingCount:missing.length,automatable:status==='ready'&&Number.isInteger(species),metrics:['classics'],
    completionScope:'currently-available',need,needs:[need],description:`搜寻经典异色 · ${need}`,huntType:'classic'};
}

export function selectShinyPlan(profile,settings={},bridge={}) {
  settings=resolveShinySettings(settings);
  const normal=selectNormalShinyPlan(profile,settings,bridge);
  if(!normal)return normal;
  const types=normalizeShinyTypes(settings.shinyTypes),classic=types.includes('classic')?classicShinyPlan(profile||{},settings,bridge,normal):null;
  const classicSources=classic?.classicAllSources || [];
  if(classic)delete classic.classicAllSources;
  if(!types.includes('shiny'))return classic?{...classic,shinyTypes:types}:{...normal,shinyTypes:types,shinySources:[],classicTargetIds:[],
    automatable:false,shinyStatus:'inaccessible',need:'经典异色资格资料尚未就绪，等待当前官方资料，不以普通异色代替'};
  if(!classic)return Array.isArray(settings.shinyTypes)&&types.includes('classic')&&normal.shinyStatus==='complete'?
    {...normal,shinyTypes:types,automatable:false,shinyStatus:'inaccessible',need:'经典异色资格资料尚未就绪，普通异色已收集不代表所选类型全部完成'}:{...normal,shinyTypes:types};
  const useClassic=classic.shinyStatus==='ready'&&normal.shinyStatus!=='ready',chosen=useClassic?classic:normal,
    target=Number(settings.shinyTargetId),targetMode=normal.shinyMode==='target',
    bothOwned=normal.ownedTarget&&classic.ownedTarget,
    classicTargets=classicSources.filter(source=>source.biome===chosen.biome).map(source=>source.id);
  return {...chosen,goalMode:'shiny',shinyTypes:types,huntType:useClassic?'classic':'shiny',classicOwned:classic.owned,
    owned:normal.owned,
    classicTargetIds:[...new Set(classicTargets)],classicSources:classicSources.filter(source=>source.biome===chosen.biome),
    eligibleTargets:[...new Set([...normal.eligibleTargets,...classic.eligibleTargets])],
    ownedTarget:targetMode?bothOwned:normal.ownedTarget,
    shinyStatus:targetMode&&normal.shinyStatus==='complete'&&!classic.ownedTarget?classic.shinyStatus:chosen.shinyStatus,
    targetCount:normal.targetCount,metrics:['shinies','classics'],
    missingCount:targetMode?Number(!bothOwned):(bridge.shinyCatalog?.species||nativeShinySources(bridge)).filter(row=>!normal.owned.includes(row.id)||!classic.owned.includes(row.id)).length,
    need:targetMode&&normal.shinyStatus==='complete'&&!classic.ownedTarget?classic.need:chosen.need};
}

/** All exact-species choices, including unavailable ones, for the client UI. */
function describeNormalShinyTargets(profile = {}, settings = {}, bridge = {}) {
  const records = bridge.shinyCatalog?.species || nativeShinySources(bridge);
  const owned = new Set(profile.shinies || []);
  const mapById = new Map((bridge.biomes || []).map((biome) => [biome.id, biome]));
  const mapLive = (source) => {
    const map = mapById.get(source.biome);
    if (!map || source.live === false || map.live === false) return false;
    try { return !bridge.biomeLive || !!bridge.biomeLive(map.id); } catch { return false; }
  };
  return records.map((record) => {
    const sources = record.sources || [];
    const live = sources.filter(mapLive);
    const unlocked = live.filter((source) => shinyNumber(profile.biomes?.[source.biome], -1) >= 0);
    const chosen = unlocked.filter((source) => !settings.biome || settings.biome === "auto" || settings.biome === source.biome);
    const available = chosen.filter((source) => shinyAvailableSource(profile, settings, bridge, source, record.id));
    let availability = "available", reason = "按正常游戏随机遭遇，不能保证每局出现";
    if (!sources.length) { availability = "unavailable"; reason = "当前版本没有已确认的异色来源"; }
    else if (!live.length) { availability = "unreleased"; reason = "来源地图尚未开放"; }
    else if (!unlocked.length) { availability = "locked"; reason = "来源地图尚未解锁"; }
    else if (!chosen.length) { availability = "locked"; reason = "目标来源不在当前选择的地图，请改用自动地图或来源地图"; }
    else if (!available.length) {
      const conditionalOnly = chosen.every((source) => ["league-legendary", "mewtwo-event"].includes(source.kind));
      if (conditionalOnly && profile.league?.includes(record.id)) {
        availability = "unavailable";
        reason = "已加入联盟，当前版本不会再次生成该联盟/超梦解锁遭遇";
      } else {
        availability = "locked";
        reason = "先完成联盟挑战；未加入联盟时才可能遇到该解锁遭遇";
      }
    }
    const mon = shinyMon(bridge, record.id);
    return { id: record.id, name: record.name || mon.name || `#${record.id}`,
      nameEn: record.nameEn || mon.name || "", types: record.types || mon.types || [],
      family: record.family ?? shinyFamily(bridge, record.id),
      maps: [...new Set((available.length ? available : chosen.length ? chosen : sources).map((source) => source.biome))],
      availability, huntable: availability === "available", owned: owned.has(record.id), reason,
      sources: available };
  });
}

export function describeShinyTargets(profile={},settings={},bridge={}) {
  const rows=describeNormalShinyTargets(profile,settings,bridge),types=normalizeShinyTypes(settings.shinyTypes),
    table=bridge.classicSpeciesEligibility||bridge.unlockCatalog?.rules?.classicSpeciesEligibility;
  if(!types.includes('classic'))return rows;
  if(!Array.isArray(table)||!table.length)return !types.includes('shiny')?rows.map(row=>({...row,
    owned:(profile.classics||[]).includes(row.id),huntable:false,availability:'unavailable',maps:[],sources:[],
    reason:'经典异色资格资料尚未就绪，不能用普通异色收藏或来源替代'})):rows;
  const eligibility=new Map(table.map(row=>[row.species,row.members||[]])),owned=new Set(profile.classics||[]),
    covered=new Set([...owned].flatMap(id=>eligibility.get(id)||[])),normalOwned=new Set(profile.shinies||[]),
    records=new Map((bridge.shinyCatalog?.species||nativeShinySources(bridge)).map(row=>[row.id,row]));
  return rows.map(row=>{
    const raw=records.get(row.id),
      sources=(raw?.sources||[]).filter(source=>source.kind==='wild'&&shinyAvailableSource(profile,settings,bridge,source,row.id)),
      uncovered=eligibility.get(row.id)?.some(id=>!covered.has(id)),classicAvailable=owned.has(row.id)||sources.length>0&&uncovered,
      normalSelected=types.includes('shiny'),available=normalSelected&&row.huntable||classicAvailable,
      reason=normalSelected?row.reason:owned.has(row.id)?'经典异色已在 classics 精确收藏中；原生经典池不保证提供重复捕捉':
        classicAvailable?'按原生经典异色随机池正常遭遇，等待60—420秒的实际判定':
          !eligibility.has(row.id)?'当前经典异色资格资料尚未完整':!uncovered?'该物种对应的经典外观资格已被收藏覆盖，原生不再抽取该候选':
            '所选地图当前没有已确认的经典异色来源（神兽及日蚀专属来源不属于普通经典池）';
    return {...row,owned:types.every(type=>type==='classic'?owned.has(row.id):normalOwned.has(row.id)),
      ownedByType:{shiny:normalOwned.has(row.id),classic:owned.has(row.id)},huntable:!!available,
      availability:available?'available':row.availability==='unreleased'?'unreleased':'unavailable',reason,
      sources:normalSelected?row.sources:sources.map(source=>({...source,kind:'classic'})),
      maps:normalSelected?row.maps:[...new Set(sources.map(source=>source.biome))]};
  });
}

/** Finds all active shinies without an arbitrary distance cutoff. */
export function examineShinyTarget(run, plan = {}) {
  const enemies = run?.enemies;
  if (!enemies) return null;
  const capture = run.capture || {};
  const pos = run.player?.pos || { x: 0, z: 0 };
  const owned = new Set(plan.owned || run.meta?.profile?.shinies || []);
  const activeIndex = capture.index;
  const targets = [];
  const count = enemies.n ?? enemies.alive?.length ?? 0;
  for (let index = 0; index < count; index++) {
    if (!enemies.alive?.[index] || (enemies.dying?.[index] || 0) > 0) continue;
    const flags = enemies.flags?.[index] || 0;
    const activeCapture = index === activeIndex && ["roaming", "weakened", "throwing"].includes(capture.state);
    const classic = !!(flags & 131072) || activeCapture && capture.classic === true;
    const shiny = !!(flags & 2048) || activeCapture && capture.shiny === true;
    if (!shiny && !classic) continue;
    if (plan.shinyTypes && !normalizeShinyTypes(plan.shinyTypes).includes(classic?'classic':'shiny')) continue;
    const id = enemies.species?.[index];
    // Native classic captures have their own collection and never count toward
    // a normal shiny target. Both remain rare opportunities worth protecting.
    const collected = classic ? (run.meta?.profile?.classics || []).includes(id) : owned.has(id);
    const requested = classic ? (plan.classicTargetIds || []).includes(id) :
      (plan.shinyMode === "target" ? id === plan.shinyTargetId : !collected);
    const kind = activeCapture && ["weakened", "throwing"].includes(capture.state) ? "capture" :
        activeCapture || flags & 128 ? "roaming" : flags & 4 ? "boss" : "shiny";
    const distance = Math.hypot((enemies.x?.[index] || 0) - pos.x, (enemies.z?.[index] || 0) - pos.z);
    // Never abandon a weakened shiny while approaching a still-fighting one.
    const priority = (kind === "capture" ? 120000 : 80000) +
      (requested ? 30000 : !collected ? 10000 : 0);
    targets.push({ index, kind, priority, species: id, requested, owned: collected, shiny, classic,
      x: enemies.x?.[index], y: enemies.y?.[index], z: enemies.z?.[index], distance,
      sure: activeCapture && !!capture.sure, escapeT: activeCapture ? capture.escapeT : null,
      weakT: activeCapture ? capture.weakT : null, captureState: activeCapture ? capture.state : null, flags });
  }
  return targets.sort((a, b) => b.priority - a.priority || a.distance - b.distance)[0] || null;
}
