import { createUnlockGoalSelector, evaluateUnlockCondition } from './unlock-goals.mjs';
// Plans goals using observed, native game progress. No account mutation or input.
const objectiveStatusMetrics = {
  burned: { status: "burn", label: "灼伤", types: ["fire"] },
  paralyzed: { status: "paralysis", label: "麻痹", types: ["electric"] },
  soaked: { status: "wet", label: "浸湿", types: ["water"] },
  frozen: { status: "freeze", label: "冰冻", types: ["ice"] },
  poisoned: { status: "poison", label: "中毒", types: ["poison"] },
  slept: { status: "sleep", label: "睡眠", types: ["grass", "psychic"] },
  confused: { status: "confusion", label: "混乱", types: ["psychic", "ghost"] },
};

function objectiveNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function objectiveData(bridge, id) {
  try {
    return bridge.data?.get?.(id) || {};
  } catch {
    return {};
  }
}

function objectiveCounter(profile, counter) {
  if (counter === "league") return (profile.league || []).filter((id) => id !== 151).length;
  if (counter === "birds") return [144, 145, 146].filter((id) => profile.league?.includes(id)).length;
  if (counter.startsWith("tier_")) return objectiveNumber(profile.biomes?.[counter.slice(5)]);
  return objectiveNumber(profile.counters?.[counter]);
}

function objectiveParts(meta, roster) {
  let native;
  try {
    native = meta.challengeProgress?.(roster.id);
  } catch {
    // An older adapter may not expose the helper; use the same public rules.
  }
  const definitions = Array.isArray(roster.challenge) ? roster.challenge : [roster.challenge];
  const parts = (native?.parts?.length ? native.parts : definitions.filter(Boolean)).map((part) => ({
    ...part,
    goal: Math.max(1, objectiveNumber(part.goal, 1)),
    value: Math.max(0, objectiveNumber(part.value ?? part.progress,
      objectiveCounter(meta.profile, part.counter || ""))),
  }));
  return {
    parts,
    done: native?.done ?? (parts.length > 0 && parts.every((part) => part.value >= part.goal)),
    fraction: parts.length ? parts.reduce((sum, part) => sum + Math.min(1, part.value / part.goal), 0) / parts.length : 0,
  };
}

function objectiveMoveInfo(bridge, species, owned) {
  const mon = objectiveData(bridge, species);
  const roster = bridge.roster.find((entry) => entry.id === species);
  let refs = [];
  try {
    const guide = bridge.moveGuide?.(species, roster, mon.types || [], (id) => owned.includes(id));
    if (guide) refs = [...(guide.kit || []), ...(guide.line || []),
      ...(guide.shared || []).filter((entry) => entry.open), ...(guide.any || [])]
      .filter(entry => entry.open !== false && entry.available !== false && entry.requiresEvolution !== true);
  } catch {
    // A character's own fixed kit is still known when a guide is unavailable.
  }
  const keys = new Set(roster?.kit || []), levels = new Map();
  for (const [index,key] of (roster?.kit || []).entries()) {
    const level=Number(roster.kitUnlockLevels?.[index]);
    if(Number.isFinite(level))levels.set(key,Math.max(1,level));
  }
  for (const ref of refs) {
    const raw = bridge.data?.moves?.get?.(ref.id);
    let derived;
    try { derived = bridge.moveDef?.(ref.id); } catch { derived = null; }
    if (derived?.key || raw?.key) {
      const key=derived?.key || raw.key,level=Number(ref.level ?? ref.minLevel);
      keys.add(key);
      if(Number.isFinite(level))levels.set(key,Math.min(levels.get(key) ?? Infinity,Math.max(1,level)));
    }
  }
  const moves = [...keys].map((key) => {
    const raw = bridge.data?.movesByKey?.get?.(key);
    let derived;
    try {
      derived = raw?.id == null ? null : bridge.moveDef?.(raw.id);
    } catch {
      derived = null;
    }
    return { ...(raw || {}), ...(derived || {}), key, availableLevel:levels.get(key) ?? null };
  });
  return { ...mon, roster, moves, types: mon.types || [] };
}

function objectiveContext(meta, bridge, settings) {
  const profile = meta?.profile;
  if (!profile || !Array.isArray(bridge?.roster) || !Array.isArray(bridge?.biomes)) return null;
  const rosterIds = new Set(bridge.roster.map((entry) => entry.id));
  const owned = (profile.league || []).filter((id) => rosterIds.has(id));
  if (!owned.length) return null;
  const requestedSpecies = Number(settings.characterId);
  const fixedSpecies = Number.isInteger(requestedSpecies) && requestedSpecies > 0 ? requestedSpecies : null;
  if (fixedSpecies != null && !owned.includes(fixedSpecies)) return null;
  const supportedMaps=bridge.compatibility?.maintenanceScope?.biomeIds;
  const liveMaps = bridge.biomes.filter((map) => (!supportedMaps||supportedMaps.includes(map.id)) && map.live !== false &&
    (!bridge.biomeLive || bridge.biomeLive(map.id)) &&
    objectiveNumber(profile.biomes?.[map.id], -1) >= 0);
  const fixedTier = settings.tier != null && settings.tier !== "auto" && Number.isInteger(Number(settings.tier)) ? Number(settings.tier) : null;
  const maps = settings.biome && settings.biome !== "auto"
    ? liveMaps.filter((map) => map.id === settings.biome) : liveMaps.filter(map => fixedTier === null ||
      objectiveNumber(profile.biomes?.[map.id],-1) >= fixedTier);
  if (!maps.length) return null;
  const defaultSpecies = fixedSpecies ?? (owned.includes(profile.lastSpecies) ? profile.lastSpecies : owned[0]);
  const moveInfo = new Map(owned.map((id) => [id, objectiveMoveInfo(bridge, id, owned)]));
  const defaultMap = maps.find((map) => map.id === profile.lastBiome) || maps[0];
  return { meta, bridge, settings, profile, owned, maps, defaultSpecies, fixedSpecies, moveInfo, defaultMap };
}

function objectiveBase(ctx) {
  const maximum = Math.min(2, objectiveNumber(ctx.profile.biomes[ctx.defaultMap.id]));
  const requested = ctx.settings.tier;
  const tier = requested == null || requested === "auto" ? 0 :
    Math.min(maximum, Math.max(0, objectiveNumber(requested)));
  return { species: ctx.defaultSpecies, biome: ctx.defaultMap.id, tier, mode: "standard", metrics: [],
    runThresholds: {}, buildPreferences: { preferredMoves: [], vitaminPriority: [], itemPriority: [], preferStatuses: [], preferTypes: [] },
    needs: [], automatable: true };
}

function objectivePreferMap(ctx, plan, id) {
  if (ctx.maps.some((map) => map.id === id)) {
    plan.biome = id;
    plan.tier = Math.min(plan.tier, objectiveNumber(ctx.profile.biomes[id]));
    return true;
  }
  plan.needs.push(`目标需要${id === "forest" ? "翠绿森林" : id === "desert" ? "岩石沙漠" : id}；该地图未解锁或被当前地图选择限制`);
  plan.automatable = false;
  return false;
}

function objectiveChooseSpecies(ctx, plan, score) {
  const choices = ctx.fixedSpecies == null ? ctx.owned : [ctx.fixedSpecies];
  let best = choices[0], bestScore = -Infinity;
  const candidates=[];
  for (const id of choices) {
    const value = score(ctx.moveInfo.get(id), id);
    candidates.push({id,score:Number.isFinite(value)?value:0});
    if (value > bestScore) { best = id; bestScore = value; }
  }
  // These are executable actors for this objective, not the enemy/capture
  // target. Final selection may compare combat quality within the same goal
  // score, but cannot replace a status/evolution prerequisite with an incapable
  // stronger role or override the player's fixed actor.
  plan.characterCandidates=candidates;
  plan.species = best;
  return bestScore;
}

function objectiveStatusPotential(move) {
  const chance=Math.max(0,Math.min(1,objectiveNumber(move.statusChance,1))),
    count=Math.max(1,objectiveNumber(move.count,1)),cooldown=Math.max(.2,objectiveNumber(move.cd,1)),
    // Bounded coverage is a planning estimate, not invented native damage or
    // a promised counter rate. Prefer broad/repeated application and nearer
    // legal learning over merely counting every move in a character's list.
    broad=["nova","cone","beam","wave","zone","aura","orbit","trap","vortex"].includes(move.arch),
    coverage=broad?Math.max(1,Math.min(5,Math.sqrt(Math.max(1,objectiveNumber(move.area,1))))):1,
    delay=1+Math.max(0,objectiveNumber(move.availableLevel,1)-1)/30;
  return chance*count*coverage/cooldown/delay;
}

function objectiveRainMap(ctx, plan) {
  const map = ctx.maps.slice().sort((a, b) =>
    (b.weather || []).filter((weather) => weather === "rain").length / Math.max(1, b.weather?.length || 0) -
    (a.weather || []).filter((weather) => weather === "rain").length / Math.max(1, a.weather?.length || 0))[0];
  if (map) { plan.biome = map.id; plan.tier = Math.min(plan.tier, objectiveNumber(ctx.profile.biomes[map.id])); }
}

function objectiveStrategy(ctx, counter, goal, progress, singleRun = false) {
  const plan = objectiveBase(ctx);
  const metric = counter.replace(/^best_/, "");
  const single = singleRun || counter.startsWith("best_");
  plan.metrics = [metric];
  if (single && !["time", "maxTime", "level", "maxLevel", "stage", "runKills", "kills", "evolutions"].includes(metric))
    plan.runThresholds.counters = { [metric]: goal };
  const status = objectiveStatusMetrics[metric];
  if (metric === "mapsWon") {
    const missing=ctx.maps.find(map=>objectiveNumber(ctx.profile.biomes?.[map.id],-1)<1);
    plan.metrics=["wins"];
    if(missing){plan.biome=missing.id;plan.tier=0;}
    else {
      plan.automatable=false;
      plan.needs.push("当前允许的已开放地图均已有通关记录；需按原生前置解锁下一地图，或等待保存同步，不重复同图冒充不同地图通关");
    }
  } else if (metric === "tasks") {
    let ready;
    for(const period of ["daily","weekly"]) {
      const state=ctx.profile[period];
      if(!state||typeof ctx.meta.task!=="function")continue;
      const count=Array.isArray(state.ids)?state.ids.length:3;
      for(let index=0;index<count;index++) {
        let task;try{task=ctx.meta.task(period,index);}catch{continue;}
        if(task&&!state.claimed?.[index]&&objectiveNumber(state.prog?.[index])>=task.goal) {
          ready={period,index,id:task.id,periodIndex:state.idx};break;
        }
      }
      if(ready)break;
    }
    if(ready) {
      plan.metrics=[];plan.taskClaimTarget=ready;
      plan.needs.push("此委托已达到原生要求，返回菜单后正常领取才增加完成委托数；不为领奖结束当前对局");
    } else {
      const pending=selectObjective(ctx.meta,ctx.bridge,{...ctx.settings,mode:"quests"});
      if(pending)Object.assign(plan,pending);
      else {
        plan.automatable=false;
        plan.needs.push("当前每日和每周委托均已领取或尚无可执行项，等待原生委托轮换后继续；不会虚构新的委托或领取次数");
      }
    }
  } else if (status) {
    const matches=move=>move.status === status.status || (metric === "soaked" && move.key === "rain-dance"),
      potential=mon=>mon.moves.filter(matches).map(objectiveStatusPotential).sort((a,b)=>b-a).slice(0,2)
        .reduce((sum,value,index)=>sum+value*(index===0?1:.35),0);
    objectiveChooseSpecies(ctx, plan, mon => potential(mon));
    const mon = ctx.moveInfo.get(plan.species);
    const preferred = mon.moves.filter(matches).sort((a,b)=>objectiveStatusPotential(b)-objectiveStatusPotential(a));
    plan.buildPreferences.preferredMoves = preferred.slice(0, 2).map((move) => move.key);
    plan.buildPreferences.preferStatuses = [status.status];
    plan.buildPreferences.preferTypes = status.types;
    plan.buildPreferences.vitaminPriority = ["statusChance", "statusDamage", "attackSpeed"];
    if (!preferred.length) {
      plan.needs.push(`当前可选角色未确认有施加${status.label}的可学习技能；需先解锁对应技能或更换角色`);
      plan.automatable = false;
    }
    if (metric === "soaked") objectiveRainMap(ctx, plan);
  } else if (metric === "electro") {
    objectiveRainMap(ctx, plan);
    objectiveChooseSpecies(ctx, plan, mon => mon.moves.filter(move=>move.type==='electric').length*100+
      mon.moves.filter(move=>move.status==='wet'||move.key==='rain-dance').length*30);
    const moves=ctx.moveInfo.get(plan.species).moves,
      electric=moves.filter(move=>move.type==='electric').sort((a,b)=>objectiveStatusPotential(b)-objectiveStatusPotential(a)),
      wet=moves.find(move=>move.status==='wet'||move.key==='rain-dance'),
      rain=ctx.maps.find(map=>map.id===plan.biome)?.weather?.includes('rain');
    plan.buildPreferences.preferredMoves=[wet?.key,electric[0]?.key].filter(Boolean);
    plan.buildPreferences.preferTypes=['electric','water'];
    plan.buildPreferences.vitaminPriority=['statusChance','attackSpeed','area'];
    if(!electric.length||!wet&&!rain){plan.automatable=false;plan.needs.push('感电需要浸湿目标受到电招式攻击；当前角色或地图未提供所需组合');}
  } else if (metric === "reactions") {
    objectiveRainMap(ctx, plan);
    const combos = (mon) => {
      const statusKeys = new Set(mon.moves.map((move) => move.status).filter(Boolean));
      const types = new Set(mon.moves.map((move) => move.type).filter(Boolean));
      const rainSkill = mon.moves.some((move) => move.key === "rain-dance");
      const map = ctx.maps.find((map) => map.id === plan.biome);
      const naturalRain = map?.weather?.includes("rain");
      const wet = statusKeys.has("wet") || rainSkill || naturalRain;
      const possible = [wet && types.has("electric"), statusKeys.has("burn") &&
        ["water", "grass", "flying"].some((type) => types.has(type)),
        statusKeys.has("poison") && types.has("fire"),
        statusKeys.has("freeze") && ["fighting", "rock", "steel"].some((type) => types.has(type)),
        statusKeys.has("paralysis") && types.has("psychic"),statusKeys.has('charm')&&types.has('dragon')].filter(Boolean).length;
      const first = (test) => mon.moves.find(test)?.key;
      const pairs = [];
      const add = (condition, keys, needsRain = false) => { if (condition) pairs.push({ keys: [...new Set(keys.filter(Boolean))], needsRain }); };
      const wetMove = first((move) => move.status === "wet" || move.key === "rain-dance");
      add(wet && types.has("electric"), [wetMove, first((move) => move.type === "electric")], !wetMove);
      add(statusKeys.has("burn") && ["water", "grass", "flying"].some((type) => types.has(type)),
        [first((move) => move.status === "burn"), first((move) => ["water", "grass", "flying"].includes(move.type))]);
      add(statusKeys.has("poison") && types.has("fire"),
        [first((move) => move.status === "poison"), first((move) => move.type === "fire")]);
      add(statusKeys.has("freeze") && ["fighting", "rock", "steel"].some((type) => types.has(type)),
        [first((move) => move.status === "freeze"), first((move) => ["fighting", "rock", "steel"].includes(move.type))]);
      add(statusKeys.has("paralysis") && types.has("psychic"),
        [first((move) => move.status === "paralysis"), first((move) => move.type === "psychic")]);
      add(statusKeys.has('charm')&&types.has('dragon'),
        [first(move=>move.status==='charm'),first(move=>move.type==='dragon')]);
      pairs.sort((a, b) => Number(a.needsRain) - Number(b.needsRain));
      return { possible, rainSkill, naturalRain, types, statusKeys, pair: pairs[0] };
    };
    objectiveChooseSpecies(ctx, plan, (mon) => combos(mon).possible * 100 +
      (combos(mon).rainSkill ? 30 : 0) + mon.moves.filter((move) => move.status).length);
    const mon = ctx.moveInfo.get(plan.species), combo = combos(mon);
    plan.buildPreferences.preferredMoves = combo.pair?.keys || [];
    plan.buildPreferences.preferTypes = ["electric", "water", "fire", "grass"];
    plan.buildPreferences.vitaminPriority = ["statusChance", "attackSpeed", "area"];
    if (!combo.possible) {
      plan.automatable = false;
      plan.needs.push("当前角色未确认拥有可组合的元素反应；需解锁浸湿＋电、灼伤＋水/草等互补技能");
    } else if (combo.pair?.needsRain) {
      plan.needs.push("优先在森林雨天使用电招式触发反应；自然天气随机，不能保证每局下雨");
    }
  } else if (metric === "rainKills") {
    objectiveRainMap(ctx, plan);
    objectiveChooseSpecies(ctx, plan, (mon) => mon.moves.some((move) => move.key === "rain-dance") ? 100 :
      mon.types.some((type) => ["water", "electric"].includes(type)) ? 20 : 0);
    plan.buildPreferences.preferredMoves = ctx.moveInfo.get(plan.species).moves.filter((move) => move.key === "rain-dance").map((move) => move.key);
    if (!plan.buildPreferences.preferredMoves.length) plan.needs.push("雨天击败数依赖实际雨天，森林也可能随机出现晴天；可用雨舞时优先学习");
  } else if (metric === "speciesPlayed") {
    const unplayed = ctx.owned.filter((id) => !ctx.profile.played?.includes(id));
    if (ctx.fixedSpecies == null && unplayed.length) {
      plan.species = unplayed[0];plan.characterCandidates=unplayed.map(id=>({id,score:1}));
    }
    else if (ctx.profile.played?.includes(plan.species)) {
      plan.automatable = false;
      plan.needs.push(unplayed.length ? "固定角色已经游玩过；切换自动角色或选择未游玩角色才能增加种类" : "已拥有角色都游玩过；需先捕获新联盟成员");
    }
  } else if (metric === "evolutions") {
    const score = objectiveChooseSpecies(ctx, plan, (mon) => {
      const evolutions = ctx.bridge.data?.evolutionsOf?.(mon.id || 0) || [];
      return (mon.roster?.evoLevels?.length || 0) * 20 + (mon.roster?.branch?.length ? 10 : 0) + evolutions.length * 10;
    });
    // Data may expose runEvolution rather than evolutionsOf; neither is invented.
    const selected = ctx.moveInfo.get(plan.species);
    let canEvolve = score > 0 || selected.roster?.branch?.length;
    try { canEvolve ||= !!ctx.bridge.data?.runEvolution?.(plan.species); } catch { /* unavailable */ }
    if (!canEvolve) { plan.automatable = false; plan.needs.push("当前角色未确认有可用进化路线，需选择可进化角色"); }
    if (single) plan.runThresholds.minEvolutions = goal;
  } else if (metric.startsWith("tier_")) {
    const id = metric.slice(5), requiredTier = Math.max(0, goal - 1);
    objectivePreferMap(ctx, plan, id);
    plan.metrics = ["wins"];
    const maximum = Math.min(2, objectiveNumber(ctx.profile.biomes[id], -1));
    if (maximum < requiredTier) {
      plan.automatable = false;
      plan.needs.push(`目标需要${["普通", "困难", "噩梦"][requiredTier] || requiredTier}通关，需先通过前一难度解锁`);
    } else if (ctx.settings.tier != null && ctx.settings.tier !== "auto" && Number(ctx.settings.tier) !== requiredTier) {
      plan.automatable = false;
      plan.needs.push(`目标需${["普通", "困难", "噩梦"][requiredTier]}通关，当前固定难度不匹配`);
    } else if (ctx.maps.some((map) => map.id === id)) plan.tier = requiredTier;
  } else if (metric === "win_forest" || metric === "kills_desert" || metric === "boss_desert") {
    objectivePreferMap(ctx, plan, metric.endsWith("forest") ? "forest" : "desert");
    plan.metrics = [metric.startsWith("win_") ? "wins" : metric.startsWith("boss_") ? "bosses" : "kills"];
  } else if (["league", "birds"].includes(metric)) {
    plan.metrics = ["captures"];
    plan.automatable = false;
    plan.needs.push(metric === "league" ? `先捕获其他联盟成员，当前${progress}/${goal}；该条件不能靠重复击败同一种角色替代` : "先分别解锁并捕获急冻鸟、闪电鸟、火焰鸟；不能直接解锁超梦");
  } else if (["time", "maxTime"].includes(metric)) {
    plan.runThresholds.minTime = goal;
  } else if (["runKills", "kills"].includes(metric)) {
    if (single || metric === "runKills") plan.runThresholds.minKills = goal;
  } else if (["level", "maxLevel"].includes(metric)) {
    plan.runThresholds.minLevel = goal;
  } else if (metric === "stage") {
    plan.runThresholds.minStage = goal;
  } else if (metric === "healed") {
    objectiveChooseSpecies(ctx, plan, (mon) => /photosynthesis|regenerator|natural-cure|triage/.test(mon.roster?.passive || "") ? 100 :
      mon.moves.filter((move) => /drain|recover|synthesis|heal|soft-boiled|roost/.test(move.key)).length * 30);
    plan.buildPreferences.vitaminPriority = ["regen", "healing", "maxHp"];
    plan.needs.push("回复只按实际损失生命后的治疗累计；保持安全，不主动承受攻击刷治疗");
  } else if (metric === "crits") {
    plan.buildPreferences.vitaminPriority = ["dire-hit", "critChance", "attackSpeed"];
  } else if (metric === "dodges") {
    plan.buildPreferences.itemPriority = ["bright-powder", "lax-incense"];
    plan.needs.push("闪避按游戏内部闪避判定累计，单纯走位避开攻击不一定计数");
  } else if (metric === "shinies") {
    plan.needs.push("异色遭遇具有随机性，不能保证某一局出现；出现后正常捕获");
  } else if (!["runs", "alphas", "alphaCaught", "ultimates", "rocks", "gold", "bosses", "chests", "berries", "legendaries", "playtime", "wins", "stage", "captures"].includes(metric)) {
    plan.automatable = false;
    plan.needs.push(`尚无针对${metric}的可靠自动策略，需观察游戏内条件后处理`);
  }
  if(plan.automatable===false&&ctx.fixedSpecies==null&&
      (status||["reactions","evolutions","speciesPlayed"].includes(metric))) {
    // A prospective member may use its own kit after legitimate capture.
    // This is only a read-only planning projection, never an ownership grant.
    plan.prerequisiteMembers=[];
    for(const member of ctx.bridge.roster) {
      if(ctx.owned.includes(member.id))continue;
      const owned=[...ctx.owned,member.id],candidate={...ctx,owned,fixedSpecies:member.id,defaultSpecies:member.id,
        moveInfo:new Map([[member.id,objectiveMoveInfo(ctx.bridge,member.id,owned)]])};
      if(objectiveStrategy(candidate,counter,goal,progress,singleRun).automatable!==false)
        plan.prerequisiteMembers.push(member.id);
    }
  }
  return plan;
}

function objectiveConditionText(part) {
  const metric = String(part.counter || part.metric || "").replace(/^best_/, "");
  const label = part.desc || part.description || objectiveStatusMetrics[metric]?.label ||
    ({league:"不同联盟成员",birds:"急冻鸟、闪电鸟、火焰鸟分别加入联盟",speciesPlayed:"不同出战角色",runs:"完成对局",kills:"击败敌人",runKills:"单局击败敌人",time:"单局存活秒数",maxTime:"最长存活秒数",level:"单局等级",maxLevel:"最高等级",stage:"单局到达区域",evolutions:"进化次数",crits:"暴击次数",rainKills:"雨天击败敌人",dodges:"原生闪避判定",healed:"实际治疗量",alphas:"击败精英",ultimates:"施放终极技能",rocks:"击碎岩石",gold:"获得金币",bosses:"击败首领",captures:"成功捕获",wins:"胜利次数",chests:"打开宝箱",berries:"拾取果实",legendaries:"传说宝可梦次数",playtime:"累计游戏秒数",shinies:"捕获异色",tasks:"完成委托",mapsWon:"通关地图数量",alphaCaught:"捕获精英",boss_desert:"击败沙漠首领",kills_desert:"沙漠击败敌人",win_forest:"青翠森林通关次数"})[metric] || `原生计数 ${metric}（具体含义待游戏说明确认）`;
  const value = objectiveNumber(part.value ?? part.progress), goal = objectiveNumber(part.goal,1);
  if (metric.startsWith("tier_")) return `${metric.slice(5) === "forest" ? "青翠森林" : metric.slice(5) === "desert" ? "岩石沙漠" : metric.slice(5)}通关${["普通","困难","噩梦"][goal-1] || goal}：${value >= goal ? "已满足" : "未满足"}（已保存难度进度 ${value}/${goal}）`;
  return `${String(part.counter || "").startsWith("best_") || part.singleRun ? "单局要求 · " : ""}${label}：${value >= goal ? "已满足" : "未满足"}（已记录 ${value}/${goal}${value < goal ? `，还差 ${goal-value}` : ""}）`;
}

function objectiveFinalize(plan, target) {
  plan.unlockTarget = target;
  plan.need = [...new Set(plan.needs)].join("；");
  plan.description = `${plan.priority} · ${target.name} ${Math.min(target.progress, target.goal)}/${target.goal}${plan.need ? " · " + plan.need : ""}`;
  plan.nativeConditions = [...new Set([...(plan.nativeConditions || [objectiveConditionText(target)]),
    ...(plan.needs.length ? [(plan.automatable === false ? "脚本当前执行限制：" : "执行说明：")+plan.need] : []),
    "实际解锁以原生正常保存后的进度为准；本局临时数值不作为已保存完成回执"] )];
  return plan;
}

/** Reuse native status/character scoring for a resolved public prerequisite. */
export function selectCounterObjective(meta, bridge, settings = {}) {
  if (typeof settings.counter !== "string") return null;
  const metric = settings.counter.replace(/^best_/, ""),
    hardTier = metric.startsWith("tier_"), preference = settings.modePreference || {},
    effective = { ...settings,
      // Explicit mode choices constrain even hard native prerequisites. A
      // conflict is described as unavailable; it cannot be fixed by farming
      // the wrong map or silently replacing the user's selected map.
      biome: (!settings.biome || settings.biome === "auto")
        ? preference.biome || settings.biome : settings.biome,
      tier: (settings.tier == null || settings.tier === "auto")
        ? preference.tier ?? settings.tier : settings.tier,
    },
    ctx = objectiveContext(meta, bridge, effective);
  if (!ctx) return null;
  const goal = Math.max(1, objectiveNumber(settings.goal, 1)),
    progress = objectiveCounter(ctx.profile, settings.counter);
  const execution=settings.unlockExecution;
  if(execution?.schemaVersion===1&&['character-batch','character-focus','character-route'].includes(execution.kind)&&
      Array.isArray(execution.conditions)&&execution.conditions.length&&execution.tier===0&&
      ['standard','endless'].includes(execution.mode)&&ctx.maps.some(map=>map.id===execution.biome)){
    const candidates=(execution.actorCandidates||[]).filter(row=>ctx.owned.includes(row.id)&&
      (ctx.fixedSpecies==null||row.id===ctx.fixedSpecies)),selected=candidates.slice().sort((a,b)=>b.score-a.score)[0];
    if(selected){
      const plan=objectiveBase(ctx),hints=execution.preferenceHints||{};
      Object.assign(plan,{species:selected.id,characterCandidates:candidates,mode:execution.mode,biome:execution.biome,
        tier:0,metrics:execution.conditions.map(row=>row.counter),priority:'开角色',objective:'unlock',
        unlockExecution:execution,buildPreferences:{...plan.buildPreferences,...hints},
        // Survival is never finished by pretending a live counter was saved.
        runThresholds:{},needs:[execution.reason||'按当前地图并行推进可执行的角色条件',
          execution.naturalEnd?'普通难度生存持续正常游玩至原生自然结束；保存确认后再评估剩余条件':'按原生流程完成并保存后再评估条件']});
      return objectiveFinalize(plan,{id:'counter:'+settings.counter,name:settings.label||settings.counter,
        counter:settings.counter,goal,progress});
    }
  }
  const plan = objectiveStrategy(ctx, settings.counter, goal, progress, settings.singleRun === true);
  if (!hardTier && effective.tier != null && effective.tier !== "auto" &&
      Number.isInteger(Number(effective.tier)))
    plan.tier = Math.max(0, Math.min(2, Number(effective.tier), objectiveNumber(ctx.profile.biomes[plan.biome])));
  plan.priority = "解锁目标"; plan.objective = "unlock";
  return objectiveFinalize(plan, { id: "counter:" + settings.counter,
    name: settings.label || settings.counter, counter: settings.counter, goal, progress });
}

/**
 * Explicit character/quest goal planner. Uses native progress and known pools.
 * runThresholds.counters contains per-run targets: compare current profile
 * counters against meta.snap.counters, not against the all-time counter total.
 */
export function selectObjective(meta, bridge, settings = {}) {
  if (!["characters", "quests"].includes(settings.mode)) return null;
  const ctx = objectiveContext(meta, bridge, settings);
  if (!ctx) return null;
  if (settings.mode === "quests") {
    const tasks = [];
    for (const period of ["daily", "weekly"]) {
      const state = ctx.profile[period];
      if (!state || !meta.task) continue;
      const count = Array.isArray(state.ids) ? state.ids.length : 3;
      for (let index = 0; index < count; index++) {
        let task;
        try { task = meta.task(period, index); } catch { continue; }
        const progress = objectiveNumber(state.prog?.[index]);
        if (!task || state.claimed?.[index] || progress >= task.goal) continue;
        const single = ["time", "runKills", "level", "stage"].includes(task.metric);
        const plan = objectiveStrategy(ctx, task.metric, task.goal, progress, single);
        plan.priority = "做委托";
        plan.taskTarget = { period, index, id: task.id, metric: task.metric, goal: task.goal, progress, remaining: task.goal - progress, singleRun: single };
        const score = (plan.automatable ? 1000 : 0) + progress / task.goal * 200 + (period === "daily" ? 35 : 0);
        plan.nativeConditions = ["委托要求："+(task.desc || task.description || task.name || task.id),objectiveConditionText({counter:task.metric,goal:task.goal,progress,singleRun:single}),
          `${period === "daily" ? "每日" : "每周"}委托第${index+1}项：尚未领取，达标后须在任务有效期内正常领取`];
        tasks.push({ plan, score, target: { id: task.id, name: task.name || task.id, counter: task.metric, goal: task.goal, progress } });
      }
    }
    tasks.sort((a, b) => b.score - a.score);
    return tasks.length ? objectiveFinalize(tasks[0].plan, tasks[0].target) : null;
  }
  let ready;
  try { ready = new Set(meta.leagueReady?.() || []); } catch { ready = new Set(); }
  const candidates = [];
  for (const roster of bridge.roster) {
    if (ctx.owned.includes(roster.id) || !roster.challenge) continue;
    const progress = objectiveParts(meta, roster);
    const name = objectiveData(bridge, roster.id).name || roster.name || `#${roster.id}`;
    if (ready.has(roster.id) || progress.done) {
      const plan = objectiveBase(ctx);
      plan.priority = "开角色";
      plan.metrics = ["captures"];
      plan.captureSpecies = roster.id;
      plan.nativeConditions = [...progress.parts.map(objectiveConditionText),"全部原生挑战完成后仍须等待该联盟角色的随机遭遇，正常削弱并成功捕获；挑战完成不等于已经加入联盟"];
      plan.needs.push("挑战已完成，等待该角色随机遭遇；追击削弱后正常捕获，不能保证本局出现");
      candidates.push({ plan, score: 3000, target: { id: roster.id, name, counter: "capture", goal: 1, progress: 0 } });
      continue;
    }
    const incomplete = progress.parts.filter((part) => part.value < part.goal);
    for (const part of incomplete) {
      const plan = objectiveStrategy(ctx, part.counter, part.goal, part.value);
      plan.priority = "开角色";
      plan.remainingConditions = incomplete.map((part) => ({ counter: part.counter, goal: part.goal, progress: part.value }));
      plan.nativeConditions = progress.parts.map(objectiveConditionText);
      const others = incomplete.filter((other) => other !== part);
      if (others.length) {
        const label = (counter) => objectiveStatusMetrics[counter.replace(/^best_/, "")]?.label ||
          ({ league: "联盟成员", birds: "传说三鸟", speciesPlayed: "使用角色种类", runs: "对局次数", tier_forest: "森林通关难度", tier_desert: "沙漠通关难度" })[counter] || counter;
        plan.needs.push(`该角色还有其他未完成条件：${others.map((other) => `${label(other.counter)} ${other.value}/${other.goal}`).join("、")}`);
      }
      const prerequisites = incomplete.filter((part) => ["league", "birds"].includes(part.counter)).length;
      const score = (plan.automatable ? 1000 : 0) + progress.fraction * 400 +
        part.value / part.goal * 100 - Math.log1p(part.goal - part.value) * 5 - prerequisites * 45;
      candidates.push({ plan, score, target: { id: roster.id, name, counter: part.counter, goal: part.goal, progress: part.value } });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates.length ? objectiveFinalize(candidates[0].plan, candidates[0].target) : null;
}

const collectionLooks=['shiny','spectral','classic','m1','m2'];
const collectionTierNames=['普通','困难','噩梦'];
function collectionMapTier(profile,id){const value=profile.biomes?.[id];return typeof value==='number'&&Number.isInteger(value)&&value>=0?value:-1;}
function collectionMemberName(bridge,id){try{return bridge.data?.get?.(id)?.name||bridge.roster?.find(entry=>entry.id===id)?.name||`#${id}`;}catch{return `#${id}`;}}
const collectionTupleKey=row=>`${row.species}:${row.biome}:${row.tier}`;

// Native wins[member] and map medals each omit the other dimension. Only real
// saved standard results, or the host's account-bound verified tuple ledger,
// can prove one particular member/map/difficulty cell. Never cross-multiply.
export function collectVerifiedClearKeys(profile={},verifiedClears=[],roster=[],maps=[]) {
  const members=new Set(roster.map(row=>row.id)),biomes=new Set(maps.map(row=>row.id)),keys=new Set();
  const add=row=>{
    if(!row||typeof row.species!=='number'||!Number.isInteger(row.species)||!members.has(row.species)||
      typeof row.biome!=='string'||!biomes.has(row.biome)||typeof row.tier!=='number'||!Number.isInteger(row.tier)||row.tier<0||row.tier>2)return;
    keys.add(collectionTupleKey(row));
  };
  for(const row of Array.isArray(verifiedClears)?verifiedClears:[])add(row);
  for(const row of Array.isArray(profile.runs)?profile.runs:[]){
    if(row?.mode!=='standard'||row.victory!==true||row.saved===false)continue;
    if(Object.hasOwn(row,'end')&&(!row.end||typeof row.end!=='object'||Array.isArray(row.end)||
      Object.hasOwn(row.end,'how')&&typeof row.end.how!=='string'))continue;
    const how=row.end?.how??row.endHow;
    if(how!=null&&how!=='won'||row.playerDead===true&&row.cooperative!==true)continue;
    add(row);
  }
  return keys;
}
function collectionBase(mode){return {schemaVersion:1,mode,category:mode==='wardrobe'?'appearance':'characters',requestedId:'auto',
  targetId:null,stepId:null,status:'waiting',action:null,chain:[],message:'等待当前原生已保存进度和完整目录',
  counts:{total:0,complete:0,remaining:0,available:0,unknown:0},collection:{mode},
  display:{targetName:mode==='wardrobe'?'解锁更衣室':'角色全通关',stepName:'读取当前进度',reason:'等待已保存的账号进度',
    progressLabel:'—',completedLabel:'—',nextStep:'原生账号与目录就绪后自动规划',nativeConditions:[]}};}
function collectionDescribe(base,extra={}){
  const total=`${base.counts.complete}/${base.counts.total}`;
  base.display={...base.display,...extra,totalProgress:total,finalTarget:extra.finalTarget||base.display.targetName,
    currentProgress:extra.currentProgress||extra.progressLabel||base.display.progressLabel,why:extra.why||extra.reason||base.message};
  base.collection={...base.collection,total:base.counts.total,complete:base.counts.complete,remaining:base.counts.remaining};
  return base;
}
function collectionResolve(select,id){return select({targetId:id});}
function collectionDependency(base,step,finalName,why){
  const progress={...base,targetId:base.targetId,stepId:step.stepId,status:step.status==='complete'?'waiting':step.status,
    action:step.status==='ready'?step.action:null,chain:[base.targetId,...(step.chain||[])].filter((id,index,array)=>id&&array.indexOf(id)===index),
    message:why+'；'+step.message,collection:{...base.collection,dependencyTarget:step.targetId}};
  const display={...step.display,targetName:finalName,finalTarget:finalName,reason:progress.message,why:progress.message,
    completedLabel:`总体已确认 ${base.counts.complete}/${base.counts.total}`,
    nextStep:step.status==='ready'?`当前前置取得原生保存确认后，返回“${finalName}”继续`:
      '保留最终目标；继续核对真实开放条件，不将缺失前置视为已经完成',
    nativeConditions:[`最终目标：${finalName}`,`当前先做前置：${why}`,...(step.display?.nativeConditions||[])]};
  return collectionDescribe(progress,display);
}

/**
 * Pure multi-run scheduler. The caller binds profile/verifiedClears to the
 * current account, executes only the returned real native action, and calls
 * again after a genuine saved receipt. No input, finish, RNG or profile writes.
 */
export function planCollectionMode(meta,bridge={},catalog={},settings={},verifiedClears=[],context={}) {
  const mode=settings.mode;
  if(!['wardrobe','allClears'].includes(mode))return null;
  const base=collectionBase(mode),profile=meta?.profile,raw=settings.modeSettings?.[mode]||{},roster=Array.isArray(bridge.roster)?bridge.roster:[];
  if(!profile||!roster.length||!Array.isArray(catalog.targets)||!catalog.targets.length)return collectionDescribe(base);
  // A planning pass can inspect many blocked looks. Share only this synchronous
  // pass's graph evaluation; release it on every return and exceptional path.
  let selector=null;
  const select=patch=>(selector??=createUnlockGoalSelector(profile,catalog,{category:'all',confirmed:true,advanceOnComplete:false,
    clanMembership:typeof context.clanMembership==='boolean'?context.clanMembership:undefined,
    clanCosmetics:Array.isArray(context.clanCosmetics)?context.clanCosmetics:undefined,
    rankingParticipation:Array.isArray(context.rankingParticipation)?context.rankingParticipation:[],mutation:context.mutation,
    preferredBiome:'auto',routeConstraints:{biome:'auto',tier:'auto'},collectionMode:true,
    ...(mode==='wardrobe'?{appearanceOptions:raw}:{}),towerSettings:settings.modeSettings?.tower||{}}))(patch);
  try {
  const fixedSpecies=raw.species==null||raw.species==='auto'?null:Number(raw.species),
    members=fixedSpecies==null?roster:roster.filter(row=>row.id===fixedSpecies);
  if(!members.length||fixedSpecies!==null&&(!Number.isInteger(fixedSpecies)||fixedSpecies<1))return collectionDescribe({...base,message:'所选精灵不在当前原生可玩目录，保留设置等待目录核对'},
    {stepName:'核对当前角色目录',reason:'未把未知角色当成已完成，也未改选另一只角色'});
  const owned=new Set(Array.isArray(profile.league)?profile.league:[]),targets=catalog.targets;
  if(mode==='wardrobe'){
    const look=raw.look==null?'auto':raw.look,
      nativeKinds=Array.isArray(catalog.wardrobeLookKinds)?catalog.wardrobeLookKinds:[],
      extraKinds=nativeKinds.filter(row=>['t1','t2','l1','l2','l3'].includes(row?.key)&&Array.isArray(row.members)),
      lookOrder=[...collectionLooks,...extraKinds.map(row=>row.key)],
      applicable=(member,key)=>collectionLooks.includes(key)||extraKinds.some(row=>row.key===key&&row.members.some(id=>Number(id)===Number(member.id)));
    if(look!=='auto'&&!lookOrder.includes(look))return collectionDescribe({...base,message:'所选外观类型尚未在当前原生目录确认'},
      {stepName:'核对外观类型',reason:'不会把本机 PNG 或未知外观当作原生更衣室奖励'});
    const expectedLooks=look==='auto'?lookOrder:[look],expectedIds=new Set(members.flatMap(member=>
      expectedLooks.filter(key=>applicable(member,key)).map(key=>`appearance:skin-${key}:${member.id}`)));
    if(!expectedIds.size)return collectionDescribe({...base,message:'所选角色没有此原生宝藏外观，保留选择供玩家调整'},
      {stepName:'外观不适用于当前角色',reason:'没有把不适用的角色强刷，也没有将其它角色的外观算到此角色'});
    const looks=targets.filter(target=>{
      const match=/^appearance:skin-(shiny|spectral|classic|m1|m2|t1|t2|l1|l2|l3):(\d+)$/.exec(target.id||'');
      return match&&expectedIds.has(target.id);
    }).sort((a,b)=>{
      const left=/^appearance:skin-([^:]+):(\d+)$/.exec(a.id),right=/^appearance:skin-([^:]+):(\d+)$/.exec(b.id);
      return roster.findIndex(row=>row.id===Number(left[2]))-roster.findIndex(row=>row.id===Number(right[2]))||lookOrder.indexOf(left[1])-lookOrder.indexOf(right[1]);
    });
    const knownIds=new Set(looks.map(target=>target.id)),missing=[...expectedIds].filter(id=>!knownIds.has(id));
    const rows=looks.map(target=>({target,progress:evaluateUnlockCondition(target.completion,profile,catalog)}));
    const expired=row=>!row.progress.done&&look==='auto'&&['expired','retired'].includes(row.target.availability?.state),
      excluded=rows.filter(expired),selected=rows.filter(row=>!expired(row));
    base.counts={total:selected.length+missing.length,complete:selected.filter(row=>row.progress.done).length,remaining:selected.filter(row=>!row.progress.done).length+missing.length,
      available:0,unknown:selected.filter(row=>!row.progress.known).length+missing.length};
    base.collection={mode,species:fixedSpecies??'auto',look,excludedExpired:excluded.length,missingDefinitions:missing.length};
    const name=`${fixedSpecies?collectionMemberName(bridge,fixedSpecies):'所有精灵'} · ${look==='auto'?'全部原生外观':({shiny:'异色',spectral:'幽灵',classic:'经典异色',m1:'专属外观一',m2:'专属外观二',t1:'宝藏外观一',t2:'宝藏外观二',l1:'传说外观一',l2:'传说外观二',l3:'传说外观三'})[look]}`;
    base.display.targetName=name;
    if(!base.counts.remaining){base.status='complete';base.message='选定范围内所有可获取的外观均已按原生保存确认'+(excluded.length?`；另有${excluded.length}项已过期，未按拥有计`:'');
      return collectionDescribe(base,{stepName:'目标范围已完成',reason:base.message,progressLabel:`${base.counts.complete}/${base.counts.total}`,completedLabel:base.message,nextStep:'不会为已拥有外观重复开局'});}
    let firstWaiting=null;
    for(const row of selected){
      if(row.progress.done)continue;
      const step=collectionResolve(select,row.target.id);
      if(step.status==='ready'){
        base.counts.available++;
        const why=step.stepId!==row.target.id?`为解锁“${row.target.name}”，先完成“${step.display?.stepName||step.stepId}”`:`正在获取“${row.target.name}”`;
        return collectionDependency({...base,targetId:row.target.id},step,name,why);
      }
      firstWaiting||={row,step};
    }
    base.targetId=firstWaiting?.row.target.id||null;
    base.message='尚有未拥有外观；当前已核对路线等待原生开放或条件刷新，继续保留最终目标';
    return firstWaiting?collectionDependency(base,firstWaiting.step,name,`正在核对“${firstWaiting.row.target.name}”的真实获取前置`):collectionDescribe(base,
      {stepName:'等待完整外观目录',reason:`还有${missing.length}项原生外观条件未读取完整，未按现存子集判定全部完成`,
        progressLabel:`已确认 ${base.counts.complete}/${base.counts.total}`,nextStep:'资料完整后继续尚未完成的外观，保留所选目标',
        nativeConditions:missing.map(id=>'待核对原生条件：'+id)});
  }
  const fixedBiome=raw.biome==null||raw.biome==='auto'?null:String(raw.biome),
    fixedTier=raw.tier==null||raw.tier==='auto'?null:Number(raw.tier);
  if(fixedTier!==null&&(!Number.isInteger(fixedTier)||fixedTier<0||fixedTier>2))return collectionDescribe({...base,message:'难度设置无效；未自动降低指定难度'});
  const maps=(Array.isArray(bridge.biomes)?bridge.biomes:[]).filter(map=>{
    if(map.live===false||fixedBiome&&map.id!==fixedBiome)return false;
    try{return typeof bridge.biomeLive!=='function'||bridge.biomeLive(map.id)!==false;}catch{return false;}
  });
  if(!maps.length)return collectionDescribe({...base,message:'所选标准地图当前未开放或目录尚未就绪'},
    {stepName:'等待标准地图入口',reason:'未将紫苑塔、无尽或未发布地图冒充标准通关地图'});
  const tiers=fixedTier===null?[0,1,2]:[fixedTier],cleared=collectVerifiedClearKeys(profile,verifiedClears,roster,maps),cells=[];
  for(const member of members)for(const map of maps)for(const tier of tiers)cells.push({species:member.id,biome:map.id,tier});
  base.counts={total:cells.length,complete:cells.filter(row=>cleared.has(collectionTupleKey(row))).length,remaining:cells.filter(row=>!cleared.has(collectionTupleKey(row))).length,available:0,unknown:0};
  base.collection={mode,species:fixedSpecies??'auto',biome:fixedBiome??'auto',tier:fixedTier??'auto',members:members.length,maps:maps.length,tiers:tiers.length};
  const name=`${fixedSpecies?collectionMemberName(bridge,fixedSpecies):'所有角色'} · ${fixedBiome?maps[0].name||fixedBiome:'全部标准地图'} · ${fixedTier===null?'全部难度':collectionTierNames[fixedTier]}`;
  base.display.targetName=name;
  if(!base.counts.remaining){base.status='complete';base.message='选定角色、地图和难度的每一格均已有真实保存的标准胜利记录';return collectionDescribe(base,
    {stepName:'所选通关范围已完成',reason:base.message,progressLabel:`${base.counts.complete}/${base.counts.total}`,completedLabel:base.message,nextStep:'不会因总览有三个圈就推断缺失地图，也不重复已确认的格子'});}
  const pending=cells.filter(row=>!cleared.has(collectionTupleKey(row))).sort((a,b)=>Number(owned.has(b.species))-Number(owned.has(a.species)));
  let waiting=null;
  for(const cell of pending){
    const memberName=collectionMemberName(bridge,cell.species),map=maps.find(row=>row.id===cell.biome),
      targetId=`clear:${collectionTupleKey(cell)}`,targetName=`${memberName} · ${map.name||map.id} · ${collectionTierNames[cell.tier]}`;
    base.targetId=targetId;base.collection.cell=cell;
    if(!owned.has(cell.species)){
      const step=collectionResolve(select,'characters:'+cell.species);
      const dependency=collectionDependency(base,step,name,`已拥有角色的所选通关格已完成，先解锁${memberName}，随后逐格通关`);
      if(step.status==='ready')return dependency;waiting||=dependency;continue;
    }
    const openTier=collectionMapTier(profile,cell.biome);
    if(openTier<cell.tier){
      const requirement=openTier<0?'maps:'+cell.biome:`maps:${cell.biome}:clear:${cell.tier}`,
        step=collectionResolve(select,requirement);
      if(step.action?.kind==='win-map')step.action={...step.action,species:cell.species};
      const dependency=collectionDependency(base,step,name,`为完成“${targetName}”，先打通所需地图或前一难度`);
      if(step.status==='ready')return dependency;waiting||=dependency;continue;
    }
    base.status='ready';base.stepId=targetId;base.action={kind:'win-map',species:cell.species,characterId:cell.species,biome:cell.biome,tier:cell.tier,mode:'standard'};
    base.chain=[targetId];base.counts.available=1;base.message=`正在补齐“${targetName}”的标准胜利；失败后保留此格，真实保存成功后再推进下一格`;
    return collectionDescribe(base,{stepName:targetName,reason:base.message,progressLabel:'本格 0/1',currentProgress:'本格 0/1（尚未确认标准胜利）',
      completedLabel:`总体已确认 ${base.counts.complete}/${base.counts.total}`,nextStep:'通关并正常保存后继续下一格；现有角色完成后自动解锁下一位角色',
      nativeConditions:[`使用起始角色：${memberName}，当前已加入联盟`,`标准地图：${map.name||map.id}，指定难度：${collectionTierNames[cell.tier]}`,
        '只认真实已保存的标准模式胜利，不把无尽、紫苑塔胜利、退出或死亡记为本格完成','三色圈只有角色与难度，地图奖牌只有地图与难度，均不能代替这一个具体通关格']});
  }
  return waiting||collectionDescribe({...base,message:'仍有通关格未完成，保留目标并核对下一项可自动执行的前置'});
  } finally {selector?.dispose();}
}
