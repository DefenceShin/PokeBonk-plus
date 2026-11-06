// Character-only planning retained from the verified1.6.0 maintenance source.
// Native definitions, saved-account facts and all non-character planners remain
// supplied by the current game adapter. No historical catalog is bundled here.
// Original unlock-goals.mjs SHA256: b5194bf394a0de6b373ffaa92655ed7bff6760cc13f4dd649859af2b48727429
// Original objectives.mjs SHA256: fb247bf10e365db060341277b125a8a9c49976a729344c4a8c8fe7146b7af09f
import { getGameLibrary, reviewedChampionTimeLimit } from './game-library.mjs';

const characterUnlockLegacy160Engine = (() => {

// Verified1.6.0 goal selection and prerequisite resolution.
// Public goal graphs and read-only planning. The profile passed to selection
// must be a server-adopted snapshot (or the native run-start snap during a run).
// Local progress, a purchase submission or a kill is never a saved unlock.
const unlockGoalCategories = [
  ["maps", "地图与难度", ["map"]], ["dex", "图鉴", ["dex"]],
  ["characters", "联盟角色", ["characters"]], ["research", "家族研究", ["research"]],
  ["shiny", "异色", ["shiny"]], ["lab", "研究所", ["lab"]], ["items", "永久道具", ["items"]],
  ["achievements", "成就", ["achievements"]], ["appearance", "外观", ["appearance"]], ["events", "活动奖励", ["tower"]],
].map(([id, label, modes]) => ({ id, label, modes: [...modes, ...(["dex", "characters", "research", "shiny"].includes(id) ? ["auto"] : [])] }));

const goalNumber = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const goalId = (value) => typeof value === "string" && /^(?:maps|dex|characters|research|shiny|lab|items|achievements|appearance|events):[A-Za-z0-9_:.+-]{1,100}$/.test(value);
const goalList = (value) => Array.isArray(value) ? value : [];
const goalHas = (profile, field, value) => goalList(profile?.[field]).some(entry => String(entry) === String(value));
const goalClone = (value) => JSON.parse(JSON.stringify(value));
const goalLabel = (target) => target.name || target.id;
function rankingAwardMatches(qualification, award) {
  const rule=qualification?.award,board=award?.board,medal=Number(award?.medal);
  if(qualification?.kind!=="season"||!rule||typeof board!=="string"||!Number.isInteger(medal)||medal<qualification.minMedal||medal>6)return false;
  if(rule.kind==="exact")return board===rule.board;
  if(rule.kind==="pokemon")return /^e?mon:\d{1,4}$/.test(board);
  if(rule.kind==="region")return [0,1,2].some(tier=>board===`kills:${rule.biome}:${tier}`);
  return rule.kind==="non-clan"&&/^(?:kills|time|endless):(?:global|[a-z]+)(?::[0-2])?$/.test(board);
}
// Only native ranked, saved receipts supplied by the controller populate this
// bounded per-identity list. Participation orders work; it never owns a reward.
function rankingParticipationOrder(qualification, biome, tier, rows=[]) {
  const board=qualification?.board || qualification?.eventId;
  const row=goalList(rows).find(row=>row.kind===qualification?.kind&&row.board===board&&
    (biome==null||row.biome===biome)&&(tier==null||row.tier===tier));
  return row&&Number.isSafeInteger(row.order)&&row.order>0?row.order:0;
}
const goalForesightPermissionReason='败给胡地涉及主动承受指定敌人的致死攻击；仅明确选择“败给胡地”目标时启用，自动规划不会主动寻死。这是脚本的目标授权范围，不是游戏未解锁';
const goalForesightNeedsExplicit=(target,profile,catalog,options)=>target.id==='achievements:foresight' && options.targetId!=='achievements:foresight' &&
  goalList(target.requirements).some(condition=>condition.kind==='counter' && condition.counter==='diedAlakazam' && !goalPredicate(condition,profile,catalog).done);

// A mode's explicit route is a constraint, not permission to move a native
// requirement to another map. Keep the required route separate from the route
// that will actually be played when a goal cannot currently fit that choice.
function unlockRouteConflict(action = {}, selection = {}) {
  const biome = typeof selection.biome === "string" && selection.biome !== "auto" ? selection.biome : "auto";
  const tier = selection.tier !== null && selection.tier !== undefined && selection.tier !== "auto" &&
    Number.isInteger(Number(selection.tier)) && Number(selection.tier) >= 0 && Number(selection.tier) <= 2 ? Number(selection.tier) : "auto";
  const counter = String(action.counter || "").replace(/^best_/, "");
  const required = {};
  const nativeBiome = action.source?.biome || action.biome ||
    (counter.startsWith("tier_") ? counter.slice(5).replace(/_j$/, "") : counter === "win_forest" ? "forest" : ["kills_desert", "boss_desert"].includes(counter) ? "desert" : null);
  if (nativeBiome) required.biome = nativeBiome;
  const nativeTier = Number.isInteger(action.source?.tier) ? action.source.tier : Number.isInteger(action.tier) ? action.tier :
    counter.startsWith("tier_") ? Math.max(0, Number(action.goal) - 1) : ["endless", "tower"].includes(action.source?.mode || action.mode) ? 0 : undefined;
  // The saved tier_* predicate is a minimum. Its resolver normally supplies
  // the next legal win-map step, whose own source.tier is exact; do not extend
  // that exact-step interpretation to a bare future counter definition.
  const minimumTier = counter.startsWith("tier_") && !Number.isInteger(action.source?.tier) && !Number.isInteger(action.tier);
  if (nativeTier !== undefined) required.tier = nativeTier;
  if (action.source?.mode || action.mode) required.mode = action.source?.mode || action.mode;
  if (!(biome !== "auto" && required.biome && biome !== required.biome) &&
      !(tier !== "auto" && required.tier !== undefined && (minimumTier ? tier < required.tier : tier !== required.tier))) return null;
  const mapName = id => ({forest:"翠绿森林",desert:"岩石沙漠",coast:"风暴海岸",glacier:"天空冰川",graveyard:"紫苑塔"})[id] || id;
  const tierName = value => ["普通", "困难", "噩梦"][value] || String(value);
  const requested = {biome,tier};
  const chosen = [biome !== "auto" ? mapName(biome) : "自动地图", tier !== "auto" ? tierName(tier) : "自动难度"].join(" / ");
  const needed = [required.biome ? mapName(required.biome) : "当前地图", required.tier !== undefined ? tierName(required.tier) : "任意已开放难度"].join(" / ");
  return {requested,required,reason:`本模式已指定${chosen}，当前解锁步骤需要${needed}；不自动更改地图或难度，按本模式配置正常积累资源。将冲突项改为自动后可继续此前置`};
}

function normalizeUnlockTargets(value = {}, legacy = {}, options = {}) {
  const result = {};
  for (const category of ["all", ...unlockGoalCategories.map(entry => entry.id)]) {
    const target = value?.[category];
    result[category] = goalId(target) && (category === "all" || target.startsWith(category + ":")) ? target : "auto";
  }
  // An explicit new auto selection is authoritative. Only migrate profiles
  // which never contained the new shiny target key.
  if (!Object.prototype.hasOwnProperty.call(value || {}, "shiny") && options.migrateLegacy !== false && legacy.shinyMode === "target") {
    const id = Math.trunc(goalNumber(legacy.shinyTargetId));
    if (id > 0) result.shiny = "shiny:" + id;
  }
  return result;
}

function unlockCounterValue(profile, counter, catalog = {}) {
  if (/^lk:\d+:[12]$/.test(counter) && goalList(catalog.targets).some(target=>target.counter === counter && target.look?.rule?.kind === "bits")) {
    let mask = goalNumber(profile?.counters?.[counter]) >>> 0, count = 0;
    for (;mask;mask &= mask-1) count++;
    return count;
  }
  if (counter === "league") return new Set(goalList(profile?.league).filter(id => Number(id) !== 151).map(String)).size;
  if (counter === "birds") return [144, 145, 146].filter(id => goalHas(profile, "league", id)).length;
  if (counter === "beasts") return [243,244,245].filter(id=>goalHas(profile,"league",id)).length;
  if (["kantoLeague","johtoLeague"].includes(counter)) {
    const members=new Set(goalList(catalog.targets).filter(t=>t.category==='characters').map(t=>Number(t.nativeId ?? t.key)));
    return new Set(goalList(profile?.league).filter(id=>members.has(Number(id)) && (counter==='kantoLeague' ? Number(id)<151 : Number(id)>=152&&Number(id)<251)).map(Number)).size;
  }
  if (counter.startsWith("tier_") && !counter.endsWith("_j")) return goalNumber(profile?.biomes?.[counter.slice(5)], 0);
  if (counter.startsWith("@")) {
    const mapTargets = goalList(catalog.targets).filter(target => target.category === "maps" && /^maps:[^:]+$/.test(target.id) && !goalUnavailable(target)),
      maps=mapTargets.map(target=>target.key || target.id.slice(5));
    if (counter === "@hard" || counter === "@night") return maps.filter(id => goalNumber(profile?.biomes?.[id]) >= (counter === "@hard" ? 2 : 3)).length;
    if (counter === "@champ") return maps.filter(id => [0, 1, 2].some(tier => goalNumber(profile?.medals?.[id + "-" + tier]) >= 4)).length;
    if (counter === "@legs") return mapTargets.filter(target=>{
      const id=target.key || target.id.slice(5);
      return goalNumber(profile?.counters?.['leg_'+id])>0 || target.nativeStageCount === 4 && goalNumber(profile?.biomes?.[id])>=1;
    }).length;
    if (counter === "@fossils") return ["helix", "dome", "amber"].filter(id => goalNumber(profile?.counters?.["fossil_" + id]) > 0).length;
    if (counter === "@seen") return new Set(goalList(profile?.seen).filter(id => goalList(catalog.pokemonIds).length ? catalog.pokemonIds.includes(Number(id)) : Number(id) >= 1 && Number(id) <= 151).map(String)).size;
    if (counter === "@league") return new Set(goalList(profile?.league).map(String)).size;
    if (counter === "@shinies") return new Set(goalList(profile?.shinies).map(String)).size;
    if (counter === "@items") return new Set(goalList(profile?.itemsOwned).filter(key => goalList(catalog.targets).some(target => target.category === "items" && (target.key === key || target.id === "items:" + key)))).size;
    return NaN;
  }
  return goalNumber(profile?.counters?.[counter], 0);
}

function goalPredicate(condition, profile, catalog, visiting = new Set()) {
  if (!condition || typeof condition !== "object") return { done: false, known: false, value: 0, goal: 1 };
  const goal = Math.max(0, goalNumber(condition.goal, 1));
  let value = 0, known = true;
  switch (condition.kind) {
    case "owned": case "not-owned":
      if (!["league", "seen", "shinies", "classics", "itemsOwned", "forms", "cosmetics", "unlocked", "played"].includes(condition.field)) known = false;
      else value = Number(goalHas(profile, condition.field, condition.value));
      return { done: known && value === (condition.kind === "not-owned" ? 0 : 1), known, value, goal: 1 };
    case "counter": value = unlockCounterValue(profile, String(condition.counter || ""), catalog); known = Number.isFinite(value); break;
    case "classic-uncovered": {
      const eligibility=goalList(catalog.rules?.classicSpeciesEligibility), members=goalList(condition.members);
      const covered=new Set(goalList(profile?.classics).flatMap(id=>goalList(eligibility.find(entry=>Number(entry.species) === Number(id))?.members)));
      known=members.length>0 && eligibility.length>0; value=Number(members.some(member=>!covered.has(member))); break;
    }
    case "map-tier": value = goalNumber(profile?.biomes?.[condition.biome], -1); break;
    case "lab-level": value = goalNumber(profile?.lab?.[condition.key], 0); break;
    case "research": value = goalNumber(profile?.research?.[condition.family], 0); break;
    case "stardust": value = goalNumber(profile?.stardust, 0); break;
    case "quest-claimed":
      return { done: profile?.quests?.[condition.key] === true || profile?.quests?.[condition.key] === 1,
        known: true, value: Number(!!profile?.quests?.[condition.key]), goal: 1 };
    case "clan-cosmetics": {
      const keys=goalList(condition.keys),saved=profile.__pbVerifiedClanCosmetics;
      known=Array.isArray(saved)&&keys.length>0;value=known?keys.filter(key=>saved.includes(key)).length:0;
      return {done:known&&value===keys.length,known,value,goal:keys.length};
    }
    case "research-count": {
      const families = new Set();
      for (const target of goalList(catalog.targets)) {
        if (target.category !== "research" || target.completion?.kind !== "research") continue;
        if (condition.type && !goalList(target.types).includes(condition.type)) continue;
        if (goalPredicate(target.completion, profile, catalog).done) families.add(String(target.completion.family));
      }
      value = families.size; break;
    }
    case "target": {
      if (visiting.has(condition.targetId)) return { done: false, known: false, value: 0, goal: 1 };
      const target = goalList(catalog.targets).find(entry => entry.id === condition.targetId);
      if (!target) return { done: false, known: false, value: 0, goal: 1 };
      const next = new Set(visiting); next.add(target.id);
      return goalPredicate(target.completion, profile, catalog, next);
    }
    case "all": case "any": {
      const parts = goalList(condition.conditions);let completed=0,allKnown=true;
      for(const part of parts){const result=goalPredicate(part,profile,catalog,visiting);if(result.done)completed++;if(!result.known)allKnown=false;}
      const done=parts.length>0&&(condition.kind==="all"?completed===parts.length:completed>0);
      return {done,known:parts.length>0&&(done||allKnown),value:completed,goal:condition.kind==="any"?1:parts.length};
    }
    case "event-complete": {
      const event = profile?.events?.[condition.key];
      if (Number.isInteger(condition.track)) value = Number(goalList(event?.got).includes(condition.track));
      else if (condition.quest != null) value = Number(goalList(event?.quests).includes(condition.quest));
      else if (typeof event === "boolean" || typeof event === "number") value = Number(event);
      else if (event && ["best", "floor", "wins", "clears", "completed"].includes(condition.metric)) value = goalNumber(event[condition.metric]);
      else known = false;
      break;
    }
    case "event-points": value = goalNumber(profile?.events?.[condition.key]?.pts); break;
    case "event-counter": value = goalNumber(profile?.events?.[condition.key]?.c?.[condition.counter]); break;
    case "event-live": case "event-claimable": {
      const event = goalList(catalog.events).find(entry => (entry.id ?? entry.key) === condition.key);
      const field = condition.kind === "event-live" ? "live" : "claimable";
      known = !!event && typeof event[field] === "boolean"; value = Number(event?.[field] === true); break;
    }
    default: known = false;
  }
  return { done: known && value >= goal, known, value, goal };
}

function evaluateUnlockCondition(condition, profile = {}, catalog = {}) {
  return goalPredicate(condition, profile, catalog);
}

const conditionMetricNames = { birds:"三神鸟加入联盟", league:"不同联盟成员（不含梦幻）", "@league":"不同联盟成员", "@seen":"已见图鉴", "@shinies":"不同异色收藏", "@items":"永久道具收藏", "@hard":"困难通关地图", "@night":"噩梦通关地图", "@champ":"取得冠军奖牌的地图", "@legs":"遇到传说宝可梦的地图", "@fossils":"不同化石", runs:"完成对局", evolutions:"进化次数", kills:"击败敌人", runKills:"单局击败敌人", crits:"暴击次数", paralyzed:"施加麻痹", rainKills:"雨天击败敌人", dodges:"原生闪避判定次数", healed:"实际治疗量", alphas:"击败精英", ultimates:"施放终极技能", burned:"施加灼伤", slept:"施加睡眠", poisoned:"施加中毒", confused:"施加混乱", rocks:"击碎岩石", gold:"获得金币", soaked:"施加浸湿", bosses:"击败首领", maxLevel:"最高等级", level:"单局等级", maxTime:"最长存活秒数", time:"单局存活秒数", frozen:"施加冰冻", win_forest:"青翠森林通关次数", reactions:"属性反应次数", chests:"打开宝箱", berries:"拾取果实", boss_desert:"击败沙漠首领", speciesPlayed:"不同出战角色", alphaCaught:"捕获精英", kills_desert:"沙漠击败敌人", legendaries:"传说宝可梦次数", captures:"成功捕获次数", wins:"胜利次数", playtime:"累计游戏秒数", shinies:"异色捕获次数", tasks:"完成委托", mapsWon:"通关地图数量", stage:"单局区域" };
const conditionMapName = id => ({forest:"青翠森林",desert:"岩石沙漠",coast:"风暴海岸",glacier:"天空冰川",graveyard:"紫苑塔",volcano:"火山"})[id] || id;
const conditionTypeName = id => ({normal:"一般",fire:"火",water:"水",grass:"草",electric:"电",ice:"冰",fighting:"格斗",poison:"毒",ground:"地面",flying:"飞行",psychic:"超能力",bug:"虫",rock:"岩石",ghost:"幽灵",dragon:"龙",dark:"恶",steel:"钢",fairy:"妖精"})[id] || id;

/** A read-only explanation of the actual predicate, including unknown states. */
function describeUnlockCondition(condition, profile = {}, catalog = {}, options = {}, visiting = new Set()) {
  const byId = id => goalList(catalog.targets).find(target => target.id === id);
  const named = (category, id) => byId(category + ":" + id)?.name || (category === "characters" ? byId("dex:" + id)?.name : null) || String(id);
  const progress = goalPredicate(condition, profile, catalog);
  const known = options.confirmed !== false && progress.known;
  const count = label => `${label}：${known ? progress.done ? "已满足" : "未满足" : "尚未读取或确认进度"}${known ? `（已保存 ${Math.max(0, progress.value)}/${progress.goal}${!progress.done ? `，还差 ${Math.max(0, progress.goal-progress.value)}` : ""}）` : `（要求 ${progress.goal}）`}`;
  if (!condition || typeof condition !== "object") return "条件定义缺失，尚未确认具体要求；请在游戏内查看该目标说明";
  const label = condition.label || condition.description;
  switch (condition.kind) {
    case "clan-cosmetics":return count("当前真实战队已获得徽记/装饰 "+goalList(condition.keys).join("、"))+"；只认原生战队库存，不用个人外观或参赛成绩冒充";
    case "all": case "any": return `${condition.kind === "all" ? "以下条件须全部满足" : "以下条件满足任意一项即可"}：${goalList(condition.conditions).map(part => describeUnlockCondition(part,profile,catalog,options,visiting)).join("；") || "子条件尚未读取"}`;
    case "target": {
      const target = byId(condition.targetId);
      if (!target) return `前置目标 ${condition.targetId} 未进入当前目录，具体条件尚未读取`;
      if (visiting.has(target.id)) return `前置“${target.name}”依赖循环，需核对游戏内说明`;
      const next = new Set(visiting); next.add(target.id);
      const requirements = goalRequirements(target,profile);
      return `前置“${target.name}”：${describeUnlockCondition(target.completion,profile,catalog,options,next)}${target.acquisition ? `；获取方法：${target.acquisition}` : ""}${requirements.length ? `；此步骤要求：${requirements.map(part=>describeUnlockCondition(part,profile,catalog,options,next)).join("；")}` : ""}`;
    }
    case "owned": case "not-owned": {
      const names = {league:["加入联盟","characters"],seen:["记录图鉴","dex"],shinies:["收藏异色","shiny"],classics:["收藏经典异色","appearance:classic"],itemsOwned:["拥有永久道具","items"],forms:["取得进化形态","appearance:form"],cosmetics:["取得外观","appearance"],unlocked:["解锁形象","characters"],played:["使用角色出战","characters"]};
      const [verb,category] = names[condition.field] || [condition.field,"characters"];
      const text = `${condition.kind === "not-owned" ? "尚未" : "已"}${verb}“${named(category,condition.value)}”`;
      return `${text}：${known ? progress.done ? "已满足" : "未满足" : "尚未读取或确认进度"}`;
    }
    case "counter": {
      const key = String(condition.counter || ""), metric = key.replace(/^best_/,"");
      if (key.startsWith("tier_") && !key.endsWith("_j")) return describeUnlockCondition({kind:"map-tier",biome:key.slice(5),goal:condition.goal},profile,catalog,options,visiting);
      if (key === '@legs') return count(label || '传说区域达成地图数')+'；只计原生当前开放地图：有已保存 leg_地图 记录，或该地图原生为含圣地的四阶段地图且已保存至少一次通关。普通地图解锁、未开放地图、紫苑塔与无尽胜利都不能单独代替。';
      return count(label || `${key.startsWith("best_") ? "单局最高记录 · " : ""}${conditionMetricNames[metric] || `原生计数 ${key}（含义尚未进入目录）`}`);
    }
    case "classic-uncovered": return `当前经典异色候选至少有一名可玩成员尚未被 classics 收藏覆盖（${goalList(condition.members).map(id=>named("characters",id)).join("、") || "资格名单尚未读取"}）：${known ? progress.done ? "已满足" : "未满足；该候选已不在原生可抽取池，不能保证收齐同外观资格下每个精确物种" : "尚未读取或确认资格进度"}`;
    case "map-tier": {
      const goal = progress.goal, map = conditionMapName(condition.biome), tier = ["普通","困难","噩梦"][goal-1];
      return `${goal === 0 ? `开放“${map}”地图入口` : `通关“${map}”${tier || `第 ${goal} 档`}难度`}：${known ? progress.done ? "已满足" : "未满足" : "尚未读取或确认进度"}${known ? `（已保存${progress.value < 0 ? "：地图未解锁" : progress.value === 0 ? "：已开放普通，尚无通关记录" : `：已通关${["普通","困难","噩梦"][progress.value-1] || progress.value}` }）` : ""}`;
    }
    case "lab-level": return count(`研究所“${named("lab",condition.key)}”等级`);
    case "research": return count(`“${named("research",condition.family)}”研究点`);
    case "stardust": return count("可用星尘（本次原生购买价格）");
    case "research-count": return count(`完成${condition.type ? conditionTypeName(condition.type)+"系" : "不同"}家族研究数量`);
    case "quest-claimed": return `${label || `领取成就“${named("achievements",condition.key)}”并保存` }：${known ? progress.done ? "已满足" : "尚未保存领取回执" : "尚未读取或确认领取回执"}`;
    case "event-live": case "event-claimable": {
      const event = goalList(catalog.events).find(event => (event.id ?? event.key) === condition.key);
      const field = condition.kind === "event-live" ? "live" : "claimable";
      const requirement = condition.kind === "event-live" ? "活动入口开放且正在计分" : "活动领奖窗口开放";
      return `${requirement}（${event?.name || condition.key}）：${typeof event?.[field] !== "boolean" ? "当前服务器状态尚未读取" : event[field] ? "已满足" : "未满足，等待官方开放或返场"}`;
    }
    case "event-points": return count("已保存活动积分");
    case "event-counter": {
      const eventNames = {floor:"到达塔的楼层（要求到达，不是完成该层）",wins:"通关普通紫苑塔次数",marowak:"在第6层平息嘎啦嘎啦的幽灵",reveals:"揭示幽灵数量",tricks:"在耿鬼墓碑的捣蛋中存活次数",candles:"点亮蜡烛数量",dark4:"无光任务原生 dark4 标记（第4层不点蜡烛并突破，需正常保存）"};
      return count(label || eventNames[condition.counter] || `活动计数 ${condition.counter}（含义尚未进入目录）`);
    }
    case "event-complete": return `${Number.isInteger(condition.track) ? `活动第 ${condition.track+1} 档奖励` : condition.quest != null ? `活动任务 ${condition.quest}` : "活动目标"}领取并保存：${known ? progress.done ? "已满足" : "尚未保存领取回执" : "尚未读取或确认领取回执"}`;
    case "manual-verification": return "此目标须原生服务器结算或人工核对；当前个人存档不能确认完成";
    default: return `${label || `原生条件类型“${condition.kind || "未知"}”`}：具体判定或进度尚未确认，请查看游戏内该项目说明；不会冒充已满足`;
  }
}

function unlockNativeConditions(target, plan, profile, catalog, options) {
  if (!target) return [options.confirmed === false ? "尚未取得原生已保存进度；本局临时进度不作为解锁回执" : plan.message || "尚未选定具体目标，请在挂机模式中选择要查看的项目"];
  const details = [], add = text => { if (typeof text === "string" && text.trim() && !details.includes(text)) details.push(text); };
  if (target.acquisition || target.description) add("获取要求：" + (target.acquisition || target.description));
  const describe = condition => describeUnlockCondition(condition,profile,catalog,options,new Set([target.id]));
  for (const condition of goalRequirements(target,profile)) add((target.completion?.kind === "any" && condition.kind === "target" ? "可选自动获取路径（不替代上方任一条件规则）：" : "")+describe(condition));
  const earning = reviewedEventEarning(target);
  if (earning?.progress) add(describe(earning.progress));
  if (target.completion) add(describe(target.completion));
  const challengeTarget = target.automation?.earningSupported === false ? target : target.look?.questId
    ? goalList(catalog.targets).find(entry=>entry.id === "achievements:"+target.look.questId) : null;
  if (challengeTarget?.automation?.earningSupported === false && goalRequirements(challengeTarget,profile).some(condition => condition.kind === "counter" && !goalPredicate(condition,profile,catalog).done))
    add("脚本执行限制："+(challengeTarget.automation.reason || "此原生挑战的自动达成策略尚未验证，暂需手动完成；已保存达标后仍可自动领取")+"。这是脚本支持范围，不是游戏未解锁");
  if (target.look) add("外观类型：这是游戏原生衣橱奖励，按联盟资格及 cosmetics 保存回执判断；本机 PNG 皮肤不影响此解锁，也不会上传到原生衣橱");
  if (plan.action?.mastery) {
    const route=plan.action.mastery,c=route.constraints || {}, speciesName=id=>goalList(catalog.targets).find(entry=>entry.id === 'dex:'+id)?.name || '#'+id;
    add(`当前专属挑战：使用起始联盟角色 ${speciesName(route.member)}（#${route.member}），${route.mode === 'endless' ? '无尽生存' : '标准模式'}${route.metric === 'wins' ? '正常获胜' : '积累指定原生计数'}；仅保存的 ${plan.action.counter} 及其领取回执确认完成。`);
    if(c.damageShare)add(`伤害占比硬条件：${c.damageShare.key} 至少占结算时当前招式正伤害之和的 ${Math.round(c.damageShare.min*100)}%；不以全部来源总伤害为分母，同名多槽按原生第一条同名记录取分子，其他同名槽仍计入分母。`);
    if(c.finalSpecies?.length)add('结算形态硬条件：'+c.finalSpecies.map(id=>speciesName(id)+'（#'+id+'）').join('、')+'；进化后的实际 finalSpecies 为准，不以开局角色代替。');
    if(c.maxFinalSpecies!=null)add(`结算形态硬条件：原生最终物种编号必须 ≤ ${c.maxFinalSpecies}，按该挑战的实际数值判定，不用“没有超过某进化阶段”的文字猜测代替。`);
    if(c.minTime!=null)add(`结算游戏时间必须 ${c.minTimeInclusive ? '≥' : '>'} ${c.minTime} 秒；暂停或现实等待时间不计入游戏时间。`);
    if(c.maxTime!=null)add(`结算游戏时间必须 < ${c.maxTime} 秒，等于门槛不合格。`);
    if(c.maxHits!=null)add(`正常获胜时原生 end.hits 必须 ≤ ${c.maxHits} 次；按受攻击次数，不是承受伤害数值。`);
    if(c.minHits!=null)add(`正常获胜时原生 end.hits 必须 > ${c.minHits} 次，等于门槛不合格；尝试仍保留生存预算，不伪造受击。`);
    if(c.endHpMin!=null||c.endHpMax!=null)add(`正常获胜时结算生命比例须满足 ${c.endHpMin!=null ? c.endHpMin*100+'% < ' : ''}HP${c.endHpMax!=null ? ' < '+c.endHpMax*100+'%' : ''}；这是比例，不是剩余生命点数。`);
    if(route.requiredBit)add(`本次只推进尚未保存的原生位图项 ${route.requiredBit}（当前保存掩码 ${route.savedBits}）；不会重复把同一地图或同一进化形态当成不同进度。`);
  }
  if (plan.action?.challenge) {
    const challenge=plan.action.challenge;
    if(Number.isFinite(challenge.minTime))add(`游戏时间须 ${challenge.minTimeInclusive ? '≥' : '>'} ${challenge.minTime} 秒；达到时间只满足本次尝试节奏，不替代击败指定目标等其他原生要求，也不会强制结束健康对局。`);
    if(Number.isFinite(challenge.maxTime))add(`本次挑战须正常获胜，游戏时间 ${challenge.maxTimeInclusive ? '≤' : '<'} ${challenge.maxTime} 秒；保存的原生计数/奖牌才确认完成，不以开局或到达时限代替。`);
    if(Number.isFinite(challenge.maxItemCount))add(`道具数量上限：本局持有数量历史峰值不超过 ${challenge.maxItemCount}，同一道具多份分别计数，卖出或丢弃不会清除峰值。`);
    if(challenge.noVitamins)add('本次不主动获得或升级任何维生素；原生 vitTaken 是本局历史标记，遗忘维生素不能恢复未拾取资格。');
    if(Number.isFinite(challenge.maxHits))add(`正常获胜时 end.hits 须 ≤ ${challenge.maxHits}；按原生受攻击次数，不是生命损失。`);
    if(Number.isFinite(challenge.endHpMax))add(`正常获胜时结算生命比例须 < ${challenge.endHpMax*100}%；随机伤害与联机影响不能保证恰好达标，不伪造结算或强退。`);
  }
  if(plan.action?.goalInteraction?.kind === 'fossil')add(`本次只授权复活尚未保存的化石 ${plan.action.goalInteraction.key}，接受其原生本局最大生命代价；其他风险交易设置不因此放开。化石是否出现、琥珀支援是否招募成功及保存回执仍由原生决定。`);
  const qualification=target.action?.qualification;
  if(qualification) {
    if(qualification.member)add(describe({kind:"owned",field:"league",value:qualification.member}));
    add(`参赛范围：${qualification.board || qualification.boardFamily || qualification.eventId}；${qualification.mode==="endless"?"原生无尽生存":qualification.mode==="tower"?"原生紫苑塔持续挑战":"原生标准对局"}，只提交本局真实成绩，不修改分数或结算。`);
    add("原生合作对局不计这些个人/活动战队榜；保留正在进行的健康合作局，正常结束保存后再按原生允许的菜单或房间入口安排参赛，不自动离房或退出当前局。");
    if(qualification.kind==="clan-event")add("战队资格：需实际原生战队成员身份；先核实正常加入/申请状态。尚无成员资格不能用个人参赛冒充战队计分，也不自动发送聊天或邀请。");
    add("获奖条件：等待真实赛季/活动名次与服务器发奖；普通击杀、存活、通关、提交或一次保存均不等于已取得奖励。未获奖时继续合法参赛，已存在的免费获奖资格只通过原生领奖保存。");
  }
  if (options.collectionMode === true && plan.action?.mastery) {
    add("本次收藏挑战的原生要求临时优先于已保存的角色、招式、维生素、融合与配装偏好；只改变本次执行计划，不改写你的保存配置。达成仍须正常结束、服务器保存及领取回执。");
    const constraints=plan.action.mastery.constraints || {};
    if (constraints.finalSpecies || constraints.maxFinalSpecies)
      add("原生自动进化没有取消或禁进化按钮；需要保持形态时，通过正常避开经验、拒绝经验强化并及时推进尝试，随机掉落、吸附或联机队友仍可能影响结果。未达标不会中途退出健康对局，将在正常保存后重试。");
  }
  if (target.eventId || target.action?.eventId) {
    const eventId = target.eventId || target.action.eventId;
    if (earning?.progress && !goalPredicate(earning.progress,profile,catalog).done) add(describe({kind:"event-live",key:eventId}));
    add(describe({kind:"event-claimable",key:eventId}));
    if (eventId === "halloween26" && earning?.mode === "tower") {
      const beyond = earning.progress?.counter === "floor" && earning.progress.goal > 7,
        policy = options.collectionMode === true ? "continue" : options.towerSettings?.exitPolicy === "continue" ? "continue" : options.towerSettings?.exitPolicy === "clear" ? "clear" : beyond ? "continue" : "clear";
      add(`塔内退出设置：${policy === "continue" ? "持续挑战，塔顶出现原生彼世门后按正常交互继续，直到原生不能继续或角色死亡" : "7层通关后离开，不进入彼世门"}${beyond && policy === "clear" ? `；当前目标需到达第${earning.progress.goal}层，请改为持续挑战（设置冲突，不是游戏解锁限制）` : ""}`);
      if (options.collectionMode === true) add("收藏模式本次前置路线临时持续挑战紫苑塔，优先于其他模式保存的7层退出设置；不修改该保存设置。");
      add(options.towerSettings?.noCandles === true ? "蜡烛设置：已开启全程不点燃蜡烛，移动时避开原生自动点燃范围（水平2.4米、垂直1.5米内停留约1.1秒）；部分治疗或安抚事件可能无法触发" : earning.progress?.counter === "dark4" ? "蜡烛设置：本次无光目标要求第4层不点蜡烛，自动避开点燃范围；其他楼层按原生事件和安全收益判断" : "蜡烛设置：未开启全程禁点，按原生事件和安全收益处理；第6层纪念蜡烛可触发安抚及治疗。若要无光成就请选择该目标，或开启全程不点蜡烛");
      if (reviewedTowerTrick(target)) {
        add("捣蛋目标：等待原生耿鬼墓碑出现且尚未使用，正常交互后选择“捣蛋”；墓碑或该选项尚未出现时继续探索，不能把点击、领糖或取消算成捣蛋进度");
        add("目标对应操作：选择本目标（包括活动自动规划选中）即会选择该墓碑的原生捣蛋，可能触发随机埋伏、诅咒或损失局内金币；不需要开启全局永久代价交互，也不授权其他风险交易");
        add("完成确认：只读取原生塔内 tricks 实际计数；本局数值仍未保存，结算采用服务器活动进度后再核对累计10次，领取回执保存后才算取得奖励");
      }
    }
  }
  const selectedSource = plan.stepId === target.id ? plan.action?.source : null,
    sources = selectedSource ? [selectedSource] : goalList(target.sources);
  for (const source of sources) {
    const location = [source.biome ? conditionMapName(source.biome) : null, Number.isInteger(source.tier) ? ["普通","困难","噩梦"][source.tier] : null,
      source.stage ? `第${source.stage}区` : null, source.mode === "endless" ? "无尽生存" : source.mode === "tower" ? "紫苑塔活动" : null,
      Number.isFinite(source.atTime) ? `存活${source.atTime}秒` : null, Number.isFinite(source.earliestStageTime) ? `本区至少${source.earliestStageTime}秒后` : null].filter(Boolean).join(" · ");
    if (location) add(`${selectedSource ? "当前执行来源" : "可选来源"}：${location}${source.live === false ? "（当前未开放）" : ""}${source.reason ? "；"+source.reason : ""}`);
    for (const condition of goalSourceRequirements(source,target,catalog,options.routeConstraints)) add("来源条件："+describe(condition));
    if (source.biome && !goalSourceRequirements(source,target,catalog,options.routeConstraints).some(condition=>condition.kind === "map-tier"))
      add("来源条件："+describe({kind:"map-tier",biome:source.biome,goal:0}));
    if (source.top) add(`排名要求：${source.kind === "event-clan-ranking" ? "战队" : "个人"}活动榜前 ${source.top} 名；以服务器结算发奖为准，个人存档未提供实时排名时不能确认`);
  }
  if (earning?.supported === false) add(`脚本执行限制：${earning.reason || "该目标的自动积累路线尚未验证，需手动完成"}。这是当前脚本的支持范围，不代表游戏尚未解锁；已保存达标且领奖窗口开放后仍可领取`);
  else if (goalUnavailable(target) || target.action?.kind === "manual") add("执行或开放限制："+(goalUnavailable(target) || target.manualReason || "此项目尚无已验证的自动操作，请按上述原生要求手动完成"));
  if (plan.constraintConflict) add("配置冲突："+plan.constraintConflict.reason);
  return details;
}

const goalConditionPriority = condition => condition.kind === "counter" && condition.counter === "birds" ? 0 :
  condition.kind === "target" ? 1 : condition.kind === "counter" && condition.counter?.startsWith("tier_") ? 2 :
    condition.kind === "counter" && condition.counter === "league" ? 3 : 4;

function goalRequirements(target, profile) {
  const result = [...goalList(target.requirements), ...goalList(target.dependencies).map(dependency =>
    typeof dependency === "string" ? { kind: "target", targetId: dependency } : dependency)];
  if (profile && target.action?.kind === "buy-lab") {
    const cost = target.costs?.[Math.max(0, Math.trunc(goalNumber(profile.lab?.[target.action.key])))];
    if (Number.isFinite(cost)) result.push({ kind: "stardust", goal: cost });
  }
  if (profile && target.action?.kind === "buy-item" && Number.isFinite(target.action.price ?? target.price)) result.push({ kind: "stardust", goal: target.action.price ?? target.price });
  return result.sort((a, b) => goalConditionPriority(a) - goalConditionPriority(b));
}

function goalUnavailable(target) {
  const availability = target.availability;
  const state = typeof availability === "string" ? availability : availability?.state;
  if (target.executable === false || ["future", "unreleased", "expired", "manual", "unknown"].includes(state))
    return target.manualReason || availability?.reason || "当前目标未开放、需人工操作或获取机制尚未确认";
  return null;
}

function goalBlockerKind(target, eventStep, conflict, direct, profile, catalog, options) {
  if(goalForesightNeedsExplicit(target,profile,catalog,options))return 'config';
  if (conflict || eventStep?.code === "tower-exit-conflict") return "config";
  if (["event-not-live","event-claim-closed"].includes(eventStep?.code)) return "native";
  if (eventStep?.code === "event-earn-unsupported") return "script";
  if (eventStep?.code) return "unknown";
  const availability=typeof target.availability === "string" ? target.availability : target.availability?.state;
  if (["future","unreleased","expired"].includes(availability)) return "native";
  if (availability === "manual") return "manual";
  if (availability === "unknown") return "unknown";
  if (target.executable === false || target.automation?.supported === false) return "script";
  const requirements=goalRequirements(target,profile).map(condition=>goalPredicate(condition,profile,catalog));
  if (requirements.some(progress=>!progress.known)) return "unknown";
  if (target.automation?.earningSupported === false && goalList(target.requirements).some(condition =>
    condition.kind === "counter" && !goalPredicate(condition,profile,catalog).done) &&
    goalList(target.requirements).filter(condition => condition.kind !== "counter").every(condition=>goalPredicate(condition,profile,catalog).done)) return "script";
  if (requirements.some(progress=>!progress.done)) return "native";
  const sources=goalList(target.sources);
  if (sources.length && sources.every(source=>source.live === false || source.biome && goalNumber(profile.biomes?.[source.biome],-1)<0 ||
      goalSourceRequirements(source,target,catalog,options.routeConstraints).some(condition=>{const progress=goalPredicate(condition,profile,catalog);return progress.known && !progress.done;}))) return "native";
  if (target.action?.kind === "manual") return "manual";
  if (direct) return null;
  return "unknown";
}

function goalSourceRequirements(source, target, catalog, routeConstraints = {}) {
  const conditions = [...goalList(source.requirements)];
  const species = Number(source.species ?? target.nativeId ?? target.key);
  if (source.requiresLeagueReady) {
    const member = goalList(catalog.targets).find(entry => entry.id === "characters:" + species);
    conditions.push(...goalList(member?.requirements));
    if (!member) conditions.push({ kind: "unknown" });
  }
  if (source.requiresLeagueUnowned) conditions.push({ kind: "not-owned", field: "league", value: species });
  if (source.biome && Number.isInteger(source.tier) && source.tier >= 0 && source.tier <= 2)
    conditions.push({ kind: "map-tier", biome: source.biome, goal: source.tier });
  const requestedTier = routeConstraints.tier !== null && routeConstraints.tier !== undefined && routeConstraints.tier !== "auto" ? Number(routeConstraints.tier) : null;
  if (source.biome && Number.isInteger(requestedTier) && requestedTier >= 0 && requestedTier <= 2 &&
      (!Number.isInteger(source.tier) || source.tier === requestedTier))
    conditions.push({kind:"map-tier",biome:source.biome,goal:requestedTier});
  return conditions.sort((a, b) => goalConditionPriority(a) - goalConditionPriority(b));
}

function goalStepCost(target, profile, catalog) {
  const progress = goalPredicate(target.completion, profile, catalog);
  const fraction = progress.goal > 0 ? Math.max(0, Math.min(1, progress.value / progress.goal)) : 0;
  return (target.action?.kind === "capture" ? 1 : target.action?.kind?.startsWith("buy-") ? 0.5 : 2) + 1 - fraction;
}

function reviewedTowerTrick(target) {
  const earning=target.action?.earning, progress=earning?.progress;
  return target.id === "events:halloween26:quest:trick" && target.action?.eventId === "halloween26" && earning?.mode === "tower" &&
    progress?.kind === "event-counter" && progress.key === "halloween26" && progress.counter === "tricks" && progress.goal === 10;
}

function reviewedEventEarning(target) {
  const earning = target.action?.earning, progress = earning?.progress,
    id = target.id;
  const reviewed = target.action?.eventId === "halloween26" && earning?.mode === "tower" && progress?.kind === "event-counter" && progress.key === "halloween26" &&
    (id === "events:halloween26:quest:beyond" && progress.counter === "floor" && progress.goal === 15 ||
      id === "events:halloween26:quest:abyss" && progress.counter === "floor" && progress.goal === 25 ||
      id === "events:halloween26:quest:dark" && progress.counter === "dark4" && progress.goal === 1);
  return reviewedTowerTrick(target) ? {...earning,supported:true,reason:"围绕本活动目标正常交互耿鬼墓碑并选择原生捣蛋，接受该次随机结果；原生实际计数须正常保存后核对"} : reviewed ? {...earning,supported:true,reason:"通过原生彼世门继续登层；无光任务在第4层避开自动点燃蜡烛的范围"} : earning;
}

function goalEventStep(target, profile, catalog, options = {}) {
  const definition = target.action;
  if (!["event-reward", "event-quest", "claim-event-track", "claim-event-quest"].includes(definition?.kind)) return null;
  const eventId = definition.eventId, completion = target.completion;
  const track = definition.track ?? definition.step, quest = definition.quest ?? definition.questId;
  const isTrack = definition.kind === "event-reward" || definition.kind === "claim-event-track";
  const waiting = (code, message) => ({ ready: false, stepId: null, action: null, chain: [target.id], code, cost: Infinity, message });
  if (typeof eventId !== "string" || completion?.kind !== "event-complete" || completion.key !== eventId ||
      (isTrack ? !Number.isInteger(track) || track < 0 || completion.track !== track : typeof quest !== "string" || !quest || completion.quest !== quest))
    return waiting("event-contract-unknown", "活动奖励定义与已领取记录不一致，等待明确的原生规则");
  const earning = reviewedEventEarning(target), condition = earning?.progress;
  if (!condition || !["event-points", "event-counter"].includes(condition.kind) || condition.key !== eventId ||
      !Number.isFinite(condition.goal) || condition.goal < 0 || condition.kind === "event-counter" && typeof condition.counter !== "string")
    return waiting("event-progress-unknown", "活动奖励门槛尚未进入已核对目录，不猜测积分或任务完成");
  const progress = goalPredicate(condition, profile, catalog);
  const event = goalList(catalog.events).find(entry => (entry.id ?? entry.key) === eventId);
  const waitForEvent = (code, message) => ({ ...waiting(code, message), progressCondition: goalClone(condition) });
  if (progress.done) {
    if (event?.claimable !== true) return waitForEvent(typeof event?.claimable === "boolean" ? "event-claim-closed" : "event-state-unknown",
      "已保存进度达到领奖门槛，等待原生活动确认可领取；不会重复刷取已足够的进度");
    return { ready: true, stepId: target.id, action: isTrack ? { kind: "claim-event-track", eventId, step: track } :
      { kind: "claim-event-quest", eventId, questId: quest }, chain: [target.id], cost: 0.1,
      progressCondition: goalClone(condition), message: "已保存进度达到门槛，直接领取原生活动奖励；领取成功并采用服务器进度后才算完成" };
  }
  if (event?.live !== true) return waitForEvent(typeof event?.live === "boolean" ? "event-not-live" : "event-state-unknown",
    event?.claimable === true ? "活动已停止计分，当前已保存进度尚不足领奖；保留目标，不重复刷无效进度" : "等待原生活动开放，当前进度尚不足领奖");
  if (earning?.mode === "tower" && condition.counter === "floor" && condition.goal > 7 && options.towerSettings?.exitPolicy === "clear" && options.collectionMode !== true)
    return waitForEvent("tower-exit-conflict", `目标要求到达第${condition.goal}层，当前紫苑塔设置为“7层通关后离开”；请在本活动配置中改为“持续挑战”，这不是游戏未解锁`);
  if (earning.supported !== true || !["tower", "standard"].includes(earning.mode) || earning.mode === "tower" && event.mode !== "tower")
    return waitForEvent("event-earn-unsupported", earning.reason || "该活动任务的自动达成方式尚未验证；已达到门槛时仍可正常领奖");
  return { ready: true, stepId: target.id, action: { kind: "earn-event", eventId, mode: earning.mode,
    ...(earning.mode === "tower" ? {biome:event.biome || earning.biome || "graveyard",tier:0} : {}),
    ...(reviewedTowerTrick(target) ? {towerGoal:{trick:true}} : {}),
    ...(options.collectionMode === true && earning.mode === 'tower' ? {towerGoal:{...(reviewedTowerTrick(target) ? {trick:true} : {}),exitPolicy:'continue'}} : {}),
    progress: goalClone(condition), earning: goalClone(earning) }, chain: [target.id], cost: condition.kind === "event-points" ? 2.5 : 3,
    progressCondition: goalClone(condition), message: reviewedTowerTrick(target) ? "活动正在计分，按本目标交互耿鬼墓碑并选择捣蛋；可能出现埋伏、诅咒或金币损失，正常保存后核对累计10次并领奖" : "活动正在计分，先通过已核对的原生玩法推进目标；保存后再核对并领取奖励" };
}

function goalResolver(profile, catalog, options = {}) {
  const byId = new Map(goalList(catalog.targets).filter(target => goalId(target?.id)).map(target => [target.id, target]));
  const blocked = (message, chain = [], code = "prerequisite-unavailable", constraintConflict = null) =>
    ({ ready: false, message, chain, code, cost: Infinity, ...(constraintConflict ? {constraintConflict} : {}) });
  const best = values => values.filter(value => value?.ready).sort((a, b) => a.cost - b.cost || a.stepId.localeCompare(b.stepId))[0] ||
    values.find(value => value?.constraintConflict);
  const resolveCondition = (condition, path) => {
    const progress = goalPredicate(condition, profile, catalog);
    if (progress.done) return { ready: false, complete: true, cost: 0, chain: [] };
    if (condition.kind === "target") return resolve(condition.targetId, path);
    if (condition.kind === "owned") {
      const prefix = { league: "characters:", seen: "dex:", shinies: "shiny:", classics: "appearance:classic:", forms: "appearance:form:" }[condition.field];
      if (prefix) return resolve(prefix + condition.value, path);
      if (condition.field === "unlocked") return resolve("characters:" + condition.value, path);
      if (condition.field === "cosmetics" && /^look:\d+:[12]$/.test(String(condition.value))) {
        const [,member,level] = String(condition.value).split(":"), questId = `achievements:lk${member}_${level}`;
        if (goalPredicate(byId.get(questId)?.completion,profile,catalog).done)
          return blocked("原生专属挑战已领取，但尚未读取对应外观的 cosmetics 保存回执；请重新读取原生存档后核对，不以已装备 skins 代替拥有",[],"look-receipt-missing");
        return resolve(questId,path);
      }
      if (condition.field === "cosmetics" && byId.has("appearance:"+condition.value)) return resolve("appearance:"+condition.value,path);
    }
    if (condition.kind === "counter" && ["birds","beasts"].includes(condition.counter)) {
      return best((condition.counter === "birds" ? [144,145,146] : [243,244,245]).filter(id => !goalHas(profile, "league", id)).map(id => resolve("characters:" + id, path))) || blocked("尚未确认可推进的传说成员解锁路线");
    }
    if (condition.kind === "counter" && ["league", "@league", "kantoLeague", "johtoLeague"].includes(condition.counter)) {
      return best([...byId.values()].filter(target => target.category === "characters" &&
        (condition.counter!=="kantoLeague" || Number(target.nativeId ?? target.key)<151) &&
        (condition.counter!=="johtoLeague" || Number(target.nativeId ?? target.key)>=152 && Number(target.nativeId ?? target.key)<251) && (condition.counter === "@league" || Number(target.nativeId ?? target.key) !== 151) &&
        !goalPredicate(target.completion, profile, catalog).done && goalRequirements(target).filter(part => part.kind === "counter" && ["league", "birds", "kantoLeague", "johtoLeague", "beasts"].includes(part.counter))
          .every(part => goalPredicate(part, profile, catalog).done)).map(target => resolve(target.id, path))) || blocked("尚无可推进的其他联盟成员，需要等待已确认的前置条件");
    }
    if (condition.kind === "counter" && ["@seen", "@items", "@shinies"].includes(condition.counter)) {
      const category = condition.counter === "@seen" ? "dex" : condition.counter === "@items" ? "items" : "shiny";
      return best([...byId.values()].filter(target => target.category === category &&
        (condition.counter !== "@shinies" || target.completion?.kind === "owned" && target.completion.field === "shinies") &&
        !goalPredicate(target.completion, profile, catalog).done).map(target => resolve(target.id, path))) || blocked("当前没有可推进的" + category + "前置");
    }
    if (condition.kind === "counter" && ["@hard", "@night"].includes(condition.counter)) {
      const clear = condition.counter === "@hard" ? 2 : 3;
      return best([...byId.keys()].filter(id => id.startsWith("maps:") && id.endsWith(":clear:" + clear)).map(id => resolve(id, path))) || blocked("当前已开放地图的对应难度仍不可推进");
    }
    if (condition.kind === 'counter' && condition.counter === '@legs') {
      const maps=[...byId.values()].filter(target=>target.category === 'maps' && /^maps:[^:]+$/.test(target.id) && !goalUnavailable(target)),
        missing=maps.filter(target=>{const id=target.key || target.id.slice(5);return !(goalNumber(profile.counters?.['leg_'+id])>0 || target.nativeStageCount === 4 && goalNumber(profile.biomes?.[id])>=1);}),
        candidates=missing.filter(target=>target.nativeStageCount === 4).map(target=>resolve(target.id+':clear:1',path));
      return best(candidates) || candidates.find(candidate=>!candidate.complete) || blocked('原生传说区域达成条件：已开放地图须有 leg_地图 保存记录，或在原生带圣地的四阶段地图完成一次标准通关；当前缺项尚无已核对的开放自动路线');
    }
    if (condition.kind === 'counter' && condition.counter === 'mapsWon') {
      const regions=goalList(condition.regions),maps=[...byId.values()].filter(target=>target.category === 'maps' && /^maps:[^:]+$/.test(target.id) &&
        !goalUnavailable(target) && (!regions.length || regions.includes(target.key || target.id.slice(5)))),
        missing=maps.filter(target=>goalNumber(profile.biomes?.[target.key || target.id.slice(5)],0)<1),
        candidates=missing.map(target=>resolve(target.id+':clear:1',path));
      return best(candidates) || candidates.find(candidate=>!candidate.complete) ||
        blocked('当前已开放且目标要求的地图均有标准通关进度，但保存的 mapsWon 计数仍未达标；等待原生保存回执重新核对，不用塔或无尽替代');
    }
    if (condition.kind === 'counter' && ['@champ','@fossils'].includes(condition.counter)) {
      const requested=options.routeConstraints || {},requestedBiome=typeof requested.biome === 'string' && requested.biome !== 'auto' ? requested.biome : null,
        tier=Number.isInteger(requested.tier) && requested.tier>=0 && requested.tier<=2 ? requested.tier : 0,
        regions=goalList(condition.regions),maps=[...byId.values()].filter(target=>target.category === 'maps' && /^maps:[^:]+$/.test(target.id) &&
          !goalUnavailable(target) && (!requestedBiome || (target.key || target.id.slice(5)) === requestedBiome) && (!regions.length || regions.includes(target.key || target.id.slice(5)))),
        missing=condition.counter === '@champ' ? maps.filter(target=>![0,1,2].some(tier=>goalNumber(profile.medals?.[(target.key || target.id.slice(5))+'-'+tier])>=4)) : maps;
      const candidates=missing.map(target=>{
        const biome=target.key || target.id.slice(5),required=goalNumber(profile.biomes?.[biome],-1);
        if(required<tier)return resolve(target.id+(tier>0 ? ':clear:'+tier : ''),path);
        const key=['helix','dome','amber'].find(key=>goalNumber(profile.counters?.['fossil_'+key])<=0),maxTime=target.championTimeLimits?.[tier];
        if(condition.counter === '@champ' && !Number.isFinite(maxTime))return blocked('此地图当前没有已核对的原生冠军时间表；不能猜测限时要求');
        return {ready:true,stepId:'counter:'+condition.counter,action:{kind:'pursue-counter',counter:condition.counter,goal:condition.goal,
          mode:'standard',biome,tier,strategyCounter:'wins',strategyGoal:1,...(condition.counter === '@champ' ? {challenge:{maxTime,maxTimeInclusive:true}} : {goalInteraction:{kind:'fossil',key}})},
          progressCondition:goalClone(condition),chain:[target.id],cost:3,
          message:condition.counter === '@champ' ? `在${conditionMapName(biome)}${['普通','困难','噩梦'][tier]}标准模式获胜，游戏时间须 ≤ ${maxTime} 秒；仅服务器保存的冠军奖牌确认完成` :
            `等待原生化石遗迹出现并复活尚未保存的 ${key}；选择会消耗本局最大生命，琥珀还须原生支援招募成功；只以正常保存的 fossil_${key} 计数确认`};
      });
      return best(candidates) || candidates.find(candidate=>!candidate.complete) || blocked('当前选择范围没有可推进的已开放地图或所需保存回执；不会将随机遗迹/冠军奖牌冒认为已完成');
    }
    if (condition.kind === "research-count") {
      return best([...byId.values()].filter(target => target.category === "research" && (!condition.type || goalList(target.types).includes(condition.type)) &&
        !goalPredicate(target.completion, profile, catalog).done).map(target => resolve(target.id, path))) || blocked("当前没有已确认可推进的家族研究路线");
    }
    if (condition.kind === "all" || condition.kind === "any") {
      const candidates = goalList(condition.conditions).filter(part => !goalPredicate(part, profile, catalog).done).map(part => resolveCondition(part, path));
      return best(candidates) || candidates.find(candidate=>candidate?.code && candidate.code !== "prerequisite-unavailable") || blocked("复合条件当前没有可执行的已知步骤");
    }
    // Season 3 counters belong to the starting Johto actor, not the map's region.
    if (condition.kind === 'counter' && (condition.counter === 'johto' || condition.counter?.endsWith('_j'))) {
      const counter=condition.counter, metric=counter.replace(/^best_/, '').replace(/_j$/, ''),
        johtoActor=counter.endsWith('_j'), owned=goalList(profile.league).filter(id=>id>=152&&id<=251),
        fixed=Number(options.characterId || 0), constraints=options.routeConstraints || {},
        requestedMap=constraints.biome && constraints.biome!=='auto' ? constraints.biome : null;
      if (johtoActor && fixed>0 && (fixed<152 || fixed>251)) return blocked('此条件必须使用城都角色；请改用城都角色或自动选择',[], 'character-region-conflict');
      if (johtoActor && !owned.length) return best([152,155,158,161].map(id=>resolve('characters:'+id,path))) || blocked('先解锁一名城都角色');
      if (/^beast_/.test(metric)) return blocked('三圣兽追踪条件需先在圆朱市手动完成；保存后可继续自动挑战与捕获',[], 'character-tracking-manual');
      if (!/^(?:johto|runs|evolutions|kills|crits|paralyzed|rainKills|dodges|healed|alphas|ultimates|burned|slept|poisoned|confused|rocks|gold|soaked|bosses|frozen|chests|berries|speciesPlayed|electro|boss_iris|kills_encina|win_iris|kills_iris|tier_iris|tier_encina)$/.test(metric)) return blocked('当前城都挑战尚无已核验执行路线');
      const biome=metric==='johto' ? (['encina','iris'].includes(requestedMap)?requestedMap:'encina') : /_(iris|encina)$/.test(metric) ? metric.split('_').at(-1) : null,
        tier=metric.startsWith('tier_') ? Math.max(0,Number(condition.goal)-1) : null;
      if (biome && requestedMap && requestedMap!==biome) return blocked('当前固定地图与角色挑战要求的地图不符，请改用自动地图或 '+biome,[], 'route-conflict');
      if (tier!==null && constraints.tier!=null && constraints.tier!=='auto' && Number(constraints.tier)<tier) return blocked('当前固定难度低于角色挑战要求，请改用自动难度或更高难度',[], 'route-conflict');
      if (biome && goalNumber(profile.biomes?.[biome],-1)<(tier ?? 0)) return resolve('maps:'+biome+(tier>0 ? ':clear:'+tier : ''),path);
      return {ready:true,stepId:'counter:'+counter,action:{kind:'pursue-counter',counter,goal:condition.goal,mode:'standard',
        ...(biome?{biome}:{}),...(tier!==null?{tier:constraints.tier!=null&&constraints.tier!=='auto'?Number(constraints.tier):tier}:{}),singleRun:counter.startsWith('best_')},
        chain:[],cost:3-Math.min(1,progress.value/Math.max(1,progress.goal)),message:condition.label || '完成原生角色挑战'};
    }
    const biome = condition.kind === "map-tier" ? condition.biome : condition.kind === "counter" && condition.counter?.startsWith("tier_") ? condition.counter.slice(5) : null;
    if (biome) return resolve("maps:" + biome + (goalNumber(condition.goal) <= 0 ? "" : ":clear:" + Math.max(1, goalNumber(condition.goal))), path);
    if (condition.kind === "lab-level") return resolve("lab:" + condition.key, path);
    if (condition.kind === "research") return resolve("research:" + condition.family, path);
    if (condition.kind === "stardust") return { ready: true, stepId: "resource:stardust", action: { kind: "farm-resources", resource: "stardust", goal: condition.goal }, chain: [], cost: 3, message: "先正常刷取星尘，达到原生价格后再购买" };
    if (condition.kind === "classic-uncovered") return blocked(progress.known?
      "该候选对应的原生可玩外观资格已被现有 classics 覆盖，原生经典异色随机池不再提供此候选；精确物种收藏与可装备外观分别计算":
      "当前经典外观资格规则尚未读取完整，等待受审资料；未将未知资格判断为已经收藏覆盖",[],progress.known?"classic-already-covered":"classic-eligibility-unknown");
    if (condition.kind === "counter" && condition.mastery) {
      const definition=condition.mastery, mask=goalNumber(profile.counters?.[condition.counter]) >>> 0,
        pendingBits=goalList(definition.bitTargets).filter(entry=>!(mask & entry.bit)),
        nextBit=pendingBits.find(entry=>!entry.biome || goalNumber(profile.biomes?.[entry.biome],-1)>=(definition.minTier || 0)) || pendingBits[0],
        mastery={...definition,...(nextBit?.biome ? {biome:nextBit.biome} : {}),
          constraints:{...(definition.constraints || {}),...(nextBit?.finalSpecies ? {finalSpecies:[...nextBit.finalSpecies]} : {})}},
        constraints=options.collectionMode === true ? {} : options.routeConstraints || {},
        requestedBiome=constraints.biome && constraints.biome !== "auto" ? constraints.biome : null,
        requestedTier=constraints.tier != null && constraints.tier !== "auto" ? Number(constraints.tier) : null,
        tier=requestedTier ?? mastery.minTier ?? 0;
      if (!goalHas(profile,"league",mastery.member)) return resolve("characters:"+mastery.member,path);
      if (requestedBiome && mastery.biome && requestedBiome !== mastery.biome || requestedTier !== null && requestedTier < mastery.minTier) {
        const conflict={requested:{biome:requestedBiome || "auto",tier:requestedTier ?? "auto"},required:{...(mastery.biome ? {biome:mastery.biome} : {}),tier:mastery.minTier},
          reason:`此专属挑战要求${mastery.biome ? conditionMapName(mastery.biome)+" · " : ""}${["普通及以上","困难及以上","噩梦"][mastery.minTier]}，与本模式指定地图或难度冲突；请改为兼容设置，这是配置冲突，不是游戏未解锁`};
        return blocked(conflict.reason,[],"route-conflict",conflict);
      }
      const maps=[...byId.values()].filter(target=>target.category === "maps" && /^maps:[^:]+$/.test(target.id) && !goalUnavailable(target) &&
        (!mastery.biome || (target.key || target.id.slice(5)) === mastery.biome) && (!requestedBiome || (target.key || target.id.slice(5)) === requestedBiome));
      const map=maps.find(target=>goalNumber(profile.biomes?.[target.key || target.id.slice(5)],-1)>=tier);
      if (!map) {
        const candidates=maps.map(target=>resolve(target.id+(tier>0 ? ":clear:"+tier : ""),path));
        return best(candidates) || candidates.find(candidate=>!candidate.complete) || blocked("此专属挑战尚无可用地图；需要先按原生解锁所需地图与难度",[],"mastery-map-unavailable");
      }
      const route={member:mastery.member,metric:mastery.metric,mode:mastery.mode || "standard",tier:mastery.mode === 'endless' ? 0 : tier,
        biome:map.key || map.id.slice(5),singleRun:mastery.singleRun === true,
        ...(Object.keys(mastery.constraints).length ? {constraints:goalClone(mastery.constraints)} : {}),
        ...(nextBit ? {requiredBit:nextBit.bit,savedBits:mask} : {})};
      return {ready:true,stepId:"counter:"+condition.counter,action:{kind:"pursue-counter",counter:condition.counter,goal:condition.goal,
        mastery:route,mode:route.mode,biome:route.biome,tier:route.tier,label:condition.label},progressCondition:goalClone(condition),chain:[],cost:3,
        message:`使用指定联盟角色 #${mastery.member}，按原生要求积累：${condition.label || condition.description}；仅以已保存的专属挑战计数 ${progress.value}/${progress.goal} 确认进度，不用全局同类计数替代`};
    }
    if (condition.kind === "counter" && /^lk:\d+:[12]$/.test(String(condition.counter)))
      return {...blocked("脚本暂不支持自动达成此角色专属挑战，请按原生要求手动完成："+(condition.label || condition.description || condition.counter)+"；已保存达标后可自动领取。这不是游戏未解锁",[],"quest-earn-unsupported"),progressCondition:goalClone(condition)};
    if(condition.kind === 'counter') {
      if(condition.counter==='diedAlakazam') {
        if(options.targetId!=='achievements:foresight')return blocked(goalForesightPermissionReason,[],'explicit-goal-required');
        const requested=options.routeConstraints || {},tier=Number.isInteger(requested.tier) && requested.tier>=0 && requested.tier<=2 ? requested.tier : 0,
          requestedBiome=typeof requested.biome==='string' && requested.biome!=='auto' ? requested.biome : null,
          sources=goalList(byId.get('dex:65')?.sources).filter(source=>source.live===true && source.biome && Number.isInteger(source.stage) &&
            (!requestedBiome || source.biome===requestedBiome) && !goalUnavailable(byId.get('maps:'+source.biome)||{})),
          source=sources.find(source=>goalNumber(profile.biomes?.[source.biome],-1)>=tier) || sources[0];
        if(!source)return blocked('当前指定范围没有已核对且开放的胡地原生敌人来源；不会把加入联盟或编辑计数冒充败给胡地');
        if(goalNumber(profile.biomes?.[source.biome],-1)<tier)return resolve('maps:'+source.biome+(tier>0?':clear:'+tier:''),path);
        return {ready:true,stepId:'counter:diedAlakazam',action:{kind:'pursue-counter',counter:condition.counter,goal:condition.goal,
          strategyCounter:'wins',strategyGoal:1,mode:'standard',biome:source.biome,tier,goalStage:source.stage,goalInteraction:{kind:'foresight'}},
          chain:[],cost:3,progressCondition:goalClone(condition),message:'已明确选择败给胡地：只在当前目标与同身份同局内，正常寻找真实胡地并接受其致死；其他伤害仍避让。切换目标或停止即撤销，不伪造死亡或保存计数'};
      }
      const counter=condition.counter,goal=condition.goal,
        special={
          endlessTime:{strategyCounter:'maxTime',strategyGoal:goal,mode:'endless',challenge:{minTime:goal,minTimeInclusive:true}},
          endlessMewtwo:{strategyCounter:'maxTime',strategyGoal:2700,mode:'endless',challenge:{minTime:2700,minTimeInclusive:true}},
          featMinimal:{challenge:{maxItemCount:3}},featNightMinimal:{minTier:2,challenge:{maxItemCount:3}},
          featNoVit:{challenge:{noVitamins:true}},featLowHits:{challenge:{maxHits:20}},featClutch:{challenge:{endHpMax:.1}},
          best_zapdosDown:{biome:'coast',goalStage:4,goalInteraction:{kind:'zapdos-down',count:goal}},
          articunoSelf:{biome:'glacier',goalStage:4,goalInteraction:{kind:'articuno-mirror'}},
          featRoars:{goalInteraction:{kind:'rhydon',count:3}},
          fusions:{strategyCounter:'kills',goalInteraction:{kind:'fusion',count:goal,singleRun:false}},
          best_fusions:{strategyCounter:'kills',goalInteraction:{kind:'fusion',count:goal,singleRun:true}},
          fusionOwn:{strategyCounter:'kills',goalInteraction:{kind:'fusion',own:true,count:1}},
          fusionGlitch:{strategyCounter:'kills',goalInteraction:{kind:'fusion',glitch:true,count:1}},
          jackpot:{strategyCounter:'gold',goalInteraction:{kind:'slots',prize:'seven',count:1,singleRun:true}},
          best_gengar:{strategyCounter:'gold',goalInteraction:{kind:'slots',prize:'gengar',count:goal,singleRun:true}},
          bonkBoss:{item:'stick',goalInteraction:{kind:'bonk',count:1}},
          gyaradosRod:{item:'old-rod',strategyCounter:'maxTime',goalInteraction:{kind:'old-rod',count:1}},
        }[counter];
      if(special) {
        if(special.item && !goalHas(profile,'itemsOwned',special.item))return resolve('items:'+special.item,path);
        const requested=options.routeConstraints || {},requestedBiome=typeof requested.biome === 'string' && requested.biome !== 'auto' ? requested.biome : null,
          requestedTier=requested.tier!=null && requested.tier !== 'auto' ? Number(requested.tier) : null,
          tier=special.mode === 'endless' ? 0 : requestedTier ?? special.minTier ?? 0;
        if(requestedBiome && special.biome && requestedBiome!==special.biome || requestedTier!=null && requestedTier<(special.minTier || 0)){
          const conflict=unlockRouteConflict({biome:special.biome,tier:special.minTier || 0},{biome:requestedBiome,tier:requestedTier});
          return blocked(conflict?.reason || '当前指定路线与目标必要地图/难度不兼容',[],'route-conflict',conflict);
        }
        const maps=[...byId.values()].filter(target=>target.category === 'maps' && /^maps:[^:]+$/.test(target.id) && !goalUnavailable(target) &&
          (!special.biome || (target.key || target.id.slice(5))===special.biome) && (!requestedBiome || (target.key || target.id.slice(5))===requestedBiome)),
          map=maps.find(target=>goalNumber(profile.biomes?.[target.key || target.id.slice(5)],-1)>=tier);
        if(!map){const candidates=maps.map(target=>resolve(target.id+(tier>0 ? ':clear:'+tier : ''),path));
          return best(candidates) || candidates.find(candidate=>!candidate.complete) || blocked('此目标所需的原生地图或难度尚不可推进；保留目标，等待真实前置或开放状态');}
        const {minTier,item,...execution}=special,biome=map.key || map.id.slice(5);
        return {ready:true,stepId:'counter:'+counter,action:{kind:'pursue-counter',counter,goal,strategyCounter:'wins',strategyGoal:1,
          mode:'standard',biome,tier,...goalClone(execution)},chain:[],cost:3,progressCondition:goalClone(condition),
          message:`按原生目标要求尝试：${condition.description || condition.label || counter}；本次规划只安排正常原生操作，随机出现与是否达标不保证，完成仍只认保存的 ${counter} ${progress.value}/${progress.goal}`};
      }
    }
    if (condition.kind === "counter" && typeof condition.counter === "string" && /^(?:best_)?(?:runs|evolutions|kills|crits|paralyzed|rainKills|dodges|healed|alphas|ultimates|burned|slept|poisoned|confused|rocks|gold|soaked|bosses|maxLevel|maxTime|frozen|win_forest|reactions|chests|berries|boss_desert|speciesPlayed|alphaCaught|kills_desert|legendaries|captures|wins|playtime|shinies|tasks|mapsWon)$/.test(condition.counter)) {
      return { ready: true, stepId: "counter:" + condition.counter, action: { kind: "pursue-counter", counter: condition.counter, goal: condition.goal,
        singleRun: condition.counter.startsWith("best_") }, chain: [], cost: 3 - Math.min(1, progress.value / Math.max(1, progress.goal)), message: condition.label || "先完成原生条件 " + condition.counter + " " + progress.value + "/" + progress.goal };
    }
    return blocked("条件机制尚未确认，等待原生状态或人工处理");
  };
  const rankingStep=(target,path)=>{
    const q=target.action?.qualification;
    if(target.action?.kind!=="qualify-ranking")return null;
    if(!q||!["season","event","clan-event"].includes(q.kind)||!["standard","endless","tower"].includes(q.mode))
      return blocked("排名资格定义尚未核准，保留目标等待当前原生规则",[target.id],"ranking-contract-unknown");
    const preferred=Number(options.rankingMember),nextPath=new Set(path),member=q.member ||
      (q.boardFamily==="mon"?(goalHas(profile,'league',preferred)?preferred:Number(goalList(profile.league)[0])):null);nextPath.add(target.id);
    if(member&&!goalHas(profile,"league",member)) {
      const step=resolve("characters:"+member,nextPath);
      return {...step,chain:[target.id,...(step.chain || [])],message:"先取得本排名所需角色的真实出战资格；"+step.message};
    }
    if(q.boardFamily==="mon"&&!member)return blocked("等待原生联盟角色资料后选择真实可出战角色参赛",[target.id],"ranking-character-unknown");
    let biome=q.biome,tier=Number.isInteger(q.tier)?q.tier:q.mode==="endless"?0:undefined,event;
    if(q.eventId) {
      event=goalList(catalog.events).find(row=>(row.id ?? row.key)===q.eventId);
      if(event?.live!==true)return blocked(event?.live===false?"原生活动当前不再计分，等待服务器排名/发奖或实际再次开放；不会把未获奖当完成":"等待原生活动真实计分窗口，不按本机日期猜测",[target.id],event?.live===false?"event-not-live":"event-state-unknown");
      biome=event.biome || biome || (q.mode==="tower"?"graveyard":null);tier=0;
    }
    if(q.mode!=="tower") {
      const actualQ={...q,...(q.boardFamily==="mon"?{board:"mon:"+member}:{})},
        maps=[...byId.values()].filter(row=>row.category==="maps"&&/^maps:[^:]+$/.test(row.id)&&!goalUnavailable(row)&&(!biome||(row.key || row.id.slice(5))===biome)),
        order=row=>rankingParticipationOrder(actualQ,row.key || row.id.slice(5),tier ?? 0,options.rankingParticipation),
        available=maps.filter(row=>goalNumber(profile.biomes?.[row.key || row.id.slice(5)],-1)>=(tier ?? 0)).sort((a,b)=>order(a)-order(b)),
        map=available[0];
      if(!biome&&map&&order(map)>0) {
        const missing=maps.filter(row=>goalNumber(profile.biomes?.[row.key || row.id.slice(5)],-1)<(tier ?? 0)),
          prerequisite=best(missing.map(row=>resolve(row.id+((tier || 0)>0?":clear:"+tier:""),nextPath)));
        if(prerequisite)return {...prerequisite,chain:[target.id,...prerequisite.chain],message:"已有真实保存参赛成绩，先开放另一原生地区补充可计入的成绩；"+prerequisite.message};
      }
      if(!map) {
        const candidates=maps.map(row=>resolve(row.id+((tier || 0)>0?":clear:"+tier:""),nextPath));
        return best(candidates) || candidates.find(row=>!row.complete) || blocked("先按原生条件开放可参赛地图",[target.id],"ranking-map-unavailable");
      }
      biome=map.key || map.id.slice(5);tier=tier ?? 0;
    }
    const qualification={...goalClone(q),...(member?{member}:{}),...(q.boardFamily==="mon"?{board:"mon:"+member}:{}),externalCompletion:true},
      action={kind:"qualify-ranking",qualification,mode:q.mode,biome,tier,...(q.kind==="clan-event"&&options.clanMembership!==true?{needsClan:true}:{}),...(member?{characterId:member}:{}),
        ...(q.mode==="tower"?{eventId:q.eventId,towerGoal:{exitPolicy:"continue"}}:{})};
    return {ready:true,stepId:target.id,action,chain:[target.id],cost:10,progressCondition:goalClone(target.completion),
      message:`${action.needsClan?"先核实成员资格；未加入时按原生公开列表加入可立即入队的开放战队，已有申请则等待真实接受；不发聊天/邀请或新申请。":""}参赛资格已按原生条件安排：${qualification.board || q.eventId}；正常积累成绩并保存，名次和奖励只认服务器实际结算。未获奖时继续参赛，不用一次击杀、通关或保存冒充取得此外观`};
  };
  const resolveUnchecked = (id, path = new Set()) => {
    const target = byId.get(id);
    if (!target) return blocked("目标或前置尚未进入公开目录：" + id);
    if (path.has(id)) return blocked("依赖存在循环，未猜测或重复执行：" + id);
    if (goalPredicate(target.completion, profile, catalog).done) return { ready: false, complete: true, cost: 0, chain: [] };
    const unavailable = goalUnavailable(target);
    if (unavailable) return blocked(unavailable, [id]);
    const ranking=rankingStep(target,path);if(ranking)return ranking;
    const eventStep = goalEventStep(target, profile, catalog, options);
    if (eventStep) return eventStep;
    const nextPath = new Set(path); nextPath.add(id);
    if (["all", "any"].includes(target.completion?.kind) || target.action?.kind === "research-count") {
      const step = resolveCondition(target.completion, nextPath);
      if (step.ready) return { ...step, chain: [id, ...step.chain], cost: step.cost + 1 };
      return {...blocked(step.message, [id], step.code, step.constraintConflict),...(step.progressCondition ? {progressCondition:step.progressCondition} : {})};
    }
    let evolutionStart, evolutionPath;
    if (target.action?.kind === "evolve") {
      let ancestor = Number(target.action.from); evolutionPath = [Number(target.action.species)];
      const seen = new Set();
      while (ancestor && !seen.has(ancestor)) {
        seen.add(ancestor); evolutionPath.unshift(ancestor);
        if (byId.has("characters:" + ancestor)) { evolutionStart = ancestor; break; }
        ancestor = Number(byId.get("appearance:form:" + ancestor)?.action?.from);
      }
      if (!evolutionStart) return blocked("尚未确认该形态可从哪个原生可出战角色进化", [id]);
      if (!goalHas(profile, "league", evolutionStart)) {
        const step = resolve("characters:" + evolutionStart, nextPath);
        return step.ready ? { ...step, chain: [id, ...step.chain], cost: step.cost + 1 } : blocked(step.message, [id], step.code, step.constraintConflict);
      }
    }
    let unmet = false, lastBlocked;
    for (const condition of goalRequirements(target, profile)) {
      if (goalPredicate(condition, profile, catalog).done) continue;
      unmet = true;
      const step = resolveCondition(condition, nextPath);
      if (step.ready) return { ...step, chain: [id, ...step.chain], cost: step.cost + 1 };
      if (!lastBlocked?.constraintConflict || step.constraintConflict) lastBlocked = step;
    }
    if (unmet) return {...blocked(lastBlocked?.message || "前置条件尚未满足", [id], lastBlocked?.code, lastBlocked?.constraintConflict),
      ...(lastBlocked?.progressCondition ? {progressCondition:lastBlocked.progressCondition} : {})};
    const liveSources = goalList(target.sources).filter(source => source.live !== false && (!source.biome || !goalUnavailable(byId.get("maps:" + source.biome) || {})));
    const sources = liveSources.filter(source => goalSourceRequirements(source, target, catalog,options.routeConstraints).filter(condition => condition.kind === "not-owned").every(condition => goalPredicate(condition, profile, catalog).done));
    // Optional soft preferences still order legal public sources. A mode that
    // supplies explicit constraints may use only matching sources, including
    // when a different source happens to have cheaper prerequisites.
    if (typeof options.preferredBiome === "string" && options.preferredBiome !== "auto")
      sources.sort((a, b) => Number(b.biome === options.preferredBiome) - Number(a.biome === options.preferredBiome));
    if (goalList(target.sources).length && !sources.length) return blocked(liveSources.length ? "该目标已加入联盟，一次性解锁遭遇不再出现；当前没有已确认的开放重复来源，继续正常资源挂机" : "该目标已确认的来源当前未开放", [id], "no-current-source");
    const conflicts = sources.map(source => unlockRouteConflict({...target.action,source}, options.routeConstraints));
    if (sources.length && conflicts.every(Boolean)) return blocked(conflicts[0].reason, [id], "route-conflict", conflicts[0]);
    for (let index=sources.length-1;index>=0;index--) if (conflicts[index]) sources.splice(index,1);
    let source = sources.find(entry => goalSourceRequirements(entry, target, catalog,options.routeConstraints).every(condition => goalPredicate(condition, profile, catalog).done) &&
      (!entry.biome || goalNumber(profile.biomes?.[entry.biome], -1) >= 0));
    if (sources.length && !source) {
      let sourceBlocked = "已确认来源的原生条件尚未满足", sourceConflict = null;
      for (const candidate of sources) {
        let allowed = true;
        for (const condition of goalSourceRequirements(candidate, target, catalog,options.routeConstraints)) {
          if (goalPredicate(condition, profile, catalog).done) continue;
          const step = resolveCondition(condition, nextPath);
          if (step.ready) return { ...step, chain: [id, ...step.chain], cost: step.cost + 1 };
          sourceConflict ||= step.constraintConflict;
          allowed = false; sourceBlocked = candidate.reason || (condition.kind === "not-owned" ? "该目标已加入联盟，一次性解锁遭遇不再出现；等待可重复开放来源" : step.message);
        }
        if (!allowed) continue;
        if (candidate.biome && goalNumber(profile.biomes?.[candidate.biome], -1) < 0) {
          const step = resolve("maps:" + candidate.biome, nextPath);
          if (step.ready) return { ...step, chain: [id, ...step.chain], cost: step.cost + 1 };
          sourceConflict ||= step.constraintConflict;
          sourceBlocked = step.message; continue;
        }
        source = candidate; break;
      }
      if (!source) return blocked(sourceConflict?.reason || sourceBlocked, [id], sourceConflict ? "route-conflict" : undefined, sourceConflict);
    }
    const action = target.action;
    if (!action || action.kind === "manual") return blocked(target.manualReason || "已显示获取方法，当前没有已验证的自动操作", [id]);
    const hardTier = Number.isInteger(source?.tier) ? source.tier : Number.isInteger(action.tier) ? action.tier :
      source?.mode === "endless" || source?.mode === "tower" ? 0 : undefined;
    const tier = hardTier ?? (Number.isInteger(options.preferredTier) && options.preferredTier >= 0 && options.preferredTier <= 2 ? options.preferredTier : undefined);
    return { ready: true, stepId: id, action: { ...goalClone(action), ...(evolutionStart ? { startSpecies: evolutionStart, evolutionPath } : {}), ...(source ? { source: goalClone(source), sourceKind: source.kind } : {}),
      ...(tier !== undefined ? { tier } : {}),
      ...(target.category === "shiny" && Number(action.species) === 150 && source?.kind === "mewtwo-event" ? { protectNonShinyCapture: true } : {}),
      ...(source?.mode ? { mode: source.mode } : {}), ...(Number.isFinite(source?.atTime) ? { atTime: source.atTime } : {}),
      ...(action.kind === "buy-lab" ? { level: goalNumber(profile.lab?.[action.key]) + 1, price: target.costs?.[goalNumber(profile.lab?.[action.key])] } : {}), ...(source?.biome ? { biome: source.biome } : {}),
      ...(source?.stage ? { stage: source.stage } : {}) }, chain: [id], cost: goalStepCost(target, profile, catalog), message: target.acquisition || target.description || goalLabel(target) };
  };
  const resolve = (id, path = new Set()) => {
    const step = resolveUnchecked(id,path);
    const conflict = step.ready && unlockRouteConflict(step.action,options.routeConstraints);
    return conflict ? blocked(conflict.reason,step.chain,"route-conflict",conflict) : step;
  };
  return { byId, resolve };
}

/** Returns a plan, never sends requests, changes profile/settings, or starts a run. */
function selectUnlockGoalRaw(profile = {}, catalog = {}, options = {}, batch = null) {
  const category = unlockGoalCategories.some(entry => entry.id === options.category) ? options.category : "all";
  const requestedId = options.targetId === "auto" || !options.targetId ? "auto" : String(options.targetId);
  const base = { schemaVersion: 1, category, requestedId, targetId: null, stepId: null, action: null, chain: [],
    status: "waiting", counts: { total: 0, complete: 0, remaining: 0, available: 0, unknown: 0 }, targetStatuses: {}, message: "等待公开解锁目录" };
  if (options.confirmed === false) return { ...base, message: "等待本局原生保存确认后再更新目标，未将本地进度当作已解锁" };
  const allTargets = batch?.allTargets || goalList(catalog.targets).filter(target => goalId(target?.id) && target.selectable !== false);
  // Reward lists belong to one concrete activity. Keeping the complete graph
  // permits its normal prerequisites without mixing another event's rewards
  // into this activity's automatic selection, counts or explicit target.
  const eventId = typeof options.eventId === "string" && options.eventId ? options.eventId : null;
  if (eventId) base.eventId = eventId;
  const inScope = target => (category === "all" || target.category === category) &&
    (!eventId || target.category === "events" &&
      (target.eventId || target.action?.eventId || target.completion?.key) === eventId);
  const targets = allTargets.filter(inScope);
  const { byId, resolve } = batch?.resolver || goalResolver(profile, catalog, options);
  // A single committed-profile update refreshes every visible target label.
  // Selection and counts remain scoped to the requested category; no second
  // dependency resolution is performed just to populate other dropdowns.
  const scopeKey = JSON.stringify([category,eventId]);
  if (batch?.statuses) {
    let counts = batch.counts.get(scopeKey);
    if (!counts) {
      counts = {...base.counts};
      for (const target of targets) {
        const progress = batch.progress.get(target.id);
        counts.total++; counts.complete += Number(progress.done); counts.available += Number(batch.statuses[target.id].available); counts.unknown += Number(!progress.known);
      }
      counts.remaining = counts.total-counts.complete;
      batch.counts.set(scopeKey,counts);
    }
    base.counts = {...counts};
    base.targetStatuses = requestedId === 'auto' ? goalClone(batch.statuses) :
      batch.statuses[requestedId] ? {[requestedId]:goalClone(batch.statuses[requestedId])} : {};
  } else for (const target of allTargets) {
    const progress = goalPredicate(target.completion, profile, catalog);
    batch?.progress.set(target.id,progress);
    const eventStep = goalEventStep(target, profile, catalog, options),qualification=target.action?.qualification,
      qualificationEvent=qualification?.eventId?goalList(catalog.events).find(row=>(row.id ?? row.key)===qualification.eventId):null,
      qualificationReason=qualification?.eventId&&qualificationEvent?.live!==true?
        qualificationEvent?.live===false?"原生活动当前不计分，等待真实排名/发奖或再次开放":"原生活动计分窗口未知，等待原生状态":null;
    const direct = !qualificationReason && !goalUnavailable(target) && (eventStep ? eventStep.ready : goalRequirements(target, profile).every(condition => goalPredicate(condition, profile, catalog).done) &&
      (!goalList(target.sources).length || goalList(target.sources).some(source => source.live !== false && (!source.biome || goalNumber(profile.biomes?.[source.biome], -1) >= 0) &&
        goalSourceRequirements(source, target, catalog,options.routeConstraints).every(condition => goalPredicate(condition, profile, catalog).done))));
    const directRoutes = direct && options.routeConstraints ? eventStep ? [eventStep.action] : goalList(target.sources).length
      ? target.sources.filter(source => source.live !== false && (!source.biome || goalNumber(profile.biomes?.[source.biome], -1) >= 0) &&
        goalSourceRequirements(source,target,catalog,options.routeConstraints).every(condition => goalPredicate(condition,profile,catalog).done))
        .map(source => ({...target.action,source})) : [target.action || {}] : [];
    const routeConflicts = directRoutes.map(action => unlockRouteConflict(action,options.routeConstraints));
    const routeConflict = routeConflicts.length && routeConflicts.every(Boolean) ? routeConflicts[0] : null;
    const masteryQuest = target.look?.questId ? byId.get("achievements:"+target.look.questId) : target,
      masteryWaiting = masteryQuest?.automation?.earningSupported === false && goalList(masteryQuest.requirements).some(condition=>condition.kind === "counter" && !goalPredicate(condition,profile,catalog).done),
      masteryReady = masteryWaiting && goalList(masteryQuest.requirements).filter(condition=>condition.kind !== "counter").every(condition=>goalPredicate(condition,profile,catalog).done);
    base.targetStatuses[target.id] = { complete: progress.done, available: !progress.done && direct && !routeConflict && !!target.action && target.action.kind !== "manual",
      ...(routeConflict && !progress.done ? {constraintConflict:routeConflict} : {}),
      ...(!progress.done ? { blockerKind:qualificationReason ? qualification?.eventId&&qualificationEvent?.live==null?"unknown":"native":masteryReady && !routeConflict ? "script" : goalBlockerKind(target,eventStep,routeConflict,direct,profile,catalog,options),
        ...(eventStep?.code ? {blockerCode:eventStep.code} : {}),
        reason: routeConflict?.reason || goalUnavailable(target) || qualificationReason || eventStep?.message || (goalForesightNeedsExplicit(target,profile,catalog,options) ? goalForesightPermissionReason : null) ||
          (masteryWaiting ? "脚本暂需手动完成："+masteryQuest.automation.reason : direct ? "当前原生前置已满足" : "尚有前置条件，先推进依赖") } : {}) };
    if (inScope(target)) {
      base.counts.total++; base.counts.complete += Number(progress.done); base.counts.available += Number(base.targetStatuses[target.id].available); base.counts.unknown += Number(!progress.known);
    }
  }
  base.counts.remaining = base.counts.total - base.counts.complete;
  if (batch && !batch.statuses) {
    batch.statuses = base.targetStatuses;
    batch.counts.set(scopeKey,{...base.counts});
    base.targetStatuses = requestedId === 'auto' ? goalClone(batch.statuses) :
      batch.statuses[requestedId] ? {[requestedId]:goalClone(batch.statuses[requestedId])} : {};
  }
  if (!targets.length) return { ...base, status: "complete", message: eventId ?
    "此活动暂无已核对的奖励目标；保留活动入口，开放时仍可继续常规活动玩法" : "此类别暂时没有可自动推进的公开目标，仍可继续当前挂机模式" };
  let requestedComplete = false;
  if (requestedId !== "auto") {
    const target = byId.get(requestedId);
    if (!target || !inScope(target)) return { ...base, status: "unknown", message: "指定目标尚未进入当前活动或类别的公开目录；没有替换成其他任务" };
    requestedComplete = goalPredicate(target.completion, profile, catalog).done;
    if (!requestedComplete) {
      const step = resolve(requestedId);
      return { ...base, targetId: requestedId, ...step, status: step.ready ? "ready" : "waiting" };
    }
    if (options.advanceOnComplete === false) return { ...base, targetId: requestedId, requestedComplete, status: "complete", message: "所选目标已由原生已保存进度确认完成，仍可继续当前模式" };
  }
  const previousId = options.previous?.targetId;
  const pending = targets.filter(target => !goalPredicate(target.completion, profile, catalog).done);
  const evaluated = pending.map(target => ({ target, step: resolve(target.id) }));
  const candidates = evaluated.filter(candidate => candidate.step.ready);
  const rankingOrder=entry=>entry.step.action?.kind==="qualify-ranking"?
    rankingParticipationOrder(entry.step.action.qualification,entry.step.action.biome,entry.step.action.tier,options.rankingParticipation):0;
  candidates.sort((a, b) => Number(a.step.action?.kind==="qualify-ranking")-Number(b.step.action?.kind==="qualify-ranking") ||
    rankingOrder(a)-rankingOrder(b) || Number(b.target.id === previousId) - Number(a.target.id === previousId) || a.step.cost - b.step.cost || a.target.id.localeCompare(b.target.id));
  const conflict = evaluated.find(candidate => candidate.step.constraintConflict);
  if (!candidates.length && conflict) return {...base,requestedComplete,targetId:conflict.target.id,...conflict.step,status:"waiting"};
  if (!candidates.length) {
    const order=entry=>goalNumber(goalList(options.rankingRewardChecks).find(row=>row.targetId===entry.target.id)?.order),
      rewardChecks=evaluated.filter(entry=>entry.target.action?.kind==="qualify-ranking"&&
        ["event-not-live","event-state-unknown"].includes(entry.step.code)).sort((a,b)=>order(a)-order(b)||a.target.id.localeCompare(b.target.id));
    if(rewardChecks.length){
      const {target,step}=rewardChecks[0];
      return {...base,requestedComplete,targetId:target.id,...step,status:"waiting",action:null,
        message:step.message+"；保留此精确目标核对已有原生奖励，不为关闭或未知的活动计分或加入战队"};
    }
  }
  if (!candidates.length) return { ...base, requestedComplete, status: base.counts.remaining ? "waiting" : "complete", message: eventId ?
    base.counts.remaining ? "当前无可自动推进的本活动奖励；剩余奖励需要活动开放或人工条件，保留选择，开放时仍可继续常规活动玩法" :
      "本活动奖励已按原生保存进度全部领取，无可解锁内容；开放时仍可继续本活动" : base.counts.remaining ?
      "剩余目标需要前置、未开放来源或人工条件；没有禁止当前模式，可继续积累正常资源" : "该类别已保存的目标均已完成，可继续当前模式或选择其他目标" };
  const { target, step } = candidates[0];
  return { ...base, targetId: target.id, requestedComplete, ...step, status: "ready", message: (requestedComplete ? "指定目标已确认完成，继续下一个未解锁目标。" : "") + step.message };
}

function selectUnlockGoalInternal(profile = {}, catalog = {}, options = {}, batch = null) {
  if(Array.isArray(options.clanCosmetics)&&profile.__pbVerifiedClanCosmetics!==options.clanCosmetics)
    profile={...profile,__pbVerifiedClanCosmetics:options.clanCosmetics};
  if (options.collectionMode === true) options={...options,routeConstraints:undefined,preferredBiome:undefined,preferredTier:undefined};
  const plan = selectUnlockGoalRaw(profile, catalog, options,batch);
  const byId = batch?.byId || new Map(goalList(catalog.targets).map(target => [target.id, target]));
  const target = byId.get(plan.targetId) || (plan.requestedId !== "auto" ? byId.get(plan.requestedId) : null), step = byId.get(plan.stepId);
  const metricNames = { birds: "捕获三神鸟", league: "捕获联盟成员", runs: "完成对局", evolutions: "正常进化", kills: "击败宝可梦", frozen: "施加冰冻", burned: "施加灼伤", paralyzed: "施加麻痹", rainKills: "雨天击败", poisoned: "施加中毒", slept: "施加睡眠", healed: "实际治疗", alphas: "击败精英", gold: "获得金币", stardust: "积累星尘" };
  const counter = plan.action?.counter;
  const nativeCondition = batch ? batch.counterConditions.get(counter)?.get(plan.action?.goal) :
    goalList(catalog.targets).flatMap(entry => goalList(entry.requirements)).find(condition => condition.counter === counter && condition.goal === plan.action?.goal);
  const nativeStepName = plan.action?.kind==="qualify-ranking"?"原生参赛并等待服务器排名/发奖":step?.name || (counter ? nativeCondition?.description || metricNames[counter.replace(/^best_/, "")] || counter : plan.action?.kind === "farm-resources" ? "积累星尘" : plan.code === "tower-exit-conflict" ? "当前退出设置不执行高层目标" : plan.code === "event-earn-unsupported" ? "目标的自动积累路线暂未支持" : plan.status === "complete" ? "当前目标已完成" : "核对下列具体条件");
  const prerequisite = plan.chain.map(id => byId.get(id)).find(entry => entry && entry.id !== plan.targetId);
  const stepName = prerequisite && prerequisite.id !== plan.stepId ? "先完成“" + prerequisite.name + "”的前置：" + nativeStepName : nativeStepName;
  const progress = plan.progressCondition ? goalPredicate(plan.progressCondition, profile, catalog) : step ? goalPredicate(step.completion, profile, catalog) : plan.action?.kind === "farm-resources" ?
    { value: goalNumber(profile.stardust), goal: plan.action.goal, known: true } : counter ?
      { value: unlockCounterValue(profile, counter, catalog), goal: plan.action.goal, known: true } : null;
  const index = plan.chain.lastIndexOf(plan.stepId);
  const after = index > 0 ? byId.get(plan.chain[index - 1]) : index < 0 && plan.chain.length ? byId.get(plan.chain[plan.chain.length - 1]) : null;
  const confirmed = goalRequirements(target || {}).filter(condition => goalPredicate(condition, profile, catalog).done);
  const birdRelevant = plan.chain.some(id => /^characters:(144|145|146|150)$/.test(id)) || target?.category === "characters" && Number(target?.nativeId ?? target?.key) === 150 ||
    target?.category === "shiny" && Number(target?.nativeId ?? target?.key) === 150 && plan.action?.sourceKind === "mewtwo-event";
  const birdNames = [144, 145, 146].filter(id => goalHas(profile, "league", id)).map(id => byId.get("characters:" + id)?.name || "#" + id);
  plan.display = {
    targetName: target?.name || (plan.requestedId !== "auto" ? byId.get(plan.requestedId)?.name : null) || "自动未解锁目标",
    stepName, reason: plan.message,
    progressLabel: options.confirmed === false ? "等待原生保存确认" : progress?.known ? Math.min(progress.value, progress.goal) + "/" + progress.goal : "以原生已保存进度为准",
    completedLabel: options.confirmed === false ? "尚未将本局本地进度计为完成" : birdRelevant ? "三神鸟已入联盟 " + birdNames.length + "/3" + (birdNames.length ? "：" + birdNames.join("、") : "") :
      confirmed.length ? "已满足 " + confirmed.length + " 项原生前置" : "本类已确认 " + plan.counts.complete + "/" + plan.counts.total,
    nextStep: !["ready", "complete"].includes(plan.status) ? plan.code === "tower-exit-conflict" ? "在紫苑塔专属配置将“塔顶之后”改为“持续挑战”；保留7层退出则只执行常规通关" : plan.code === "event-earn-unsupported" ? "按下列要求手动完成该目标；保存达标后可自动领取，当前普通活动挂机可继续" : "按下列“原生条件”的欠缺项处理；保留当前目标，条件或已保存进度变化后重新核对" : after ? "完成当前步骤后，核对“" + after.name + "”的剩余条件" : plan.status === "complete" ? "当前目标已确认完成，按所选自动或指定策略继续" : "取得原生保存回执后重新核对目标",
    nativeConditions: unlockNativeConditions(target,plan,profile,catalog,options),
  };
  if (step && step.id !== target?.id) plan.display.nativeConditions.push("当前先执行的前置步骤：“"+step.name+"”",...unlockNativeConditions(step,plan,profile,catalog,options));
  if (!target && plan.status === "waiting" && options.confirmed !== false) {
    const waiting = goalList(catalog.targets).filter(entry => (plan.category === "all" || entry.category === plan.category) &&
      (!plan.eventId || (entry.eventId || entry.action?.eventId) === plan.eventId) && !goalPredicate(entry.completion,profile,catalog).done);
    plan.display.nativeConditions = waiting.slice(0, 22).flatMap(entry => ["待处理目标："+entry.name,...unlockNativeConditions(entry,plan,profile,catalog,options)]);
    if (waiting.length > 22) plan.display.nativeConditions.push(`另有 ${waiting.length-22} 个待处理目标，请在挂机模式中逐项选择查看具体条件`);
  }
  return plan;
}

function selectUnlockGoal(profile = {}, catalog = {}, options = {}) {
  return selectUnlockGoalInternal(profile,catalog,options);
}

/**
 * Reuse one immutable saved-profile/catalog snapshot during a synchronous
 * planning batch. Explicit selections return only their requested label;
 * counts and automatic selection still cover every in-scope target. Nothing
 * is retained globally or across planner calls. Dispose when the batch ends.
 */
function createUnlockGoalSelector(profile = {}, catalog = {}, sharedOptions = {}) {
  if(Array.isArray(sharedOptions.clanCosmetics))profile={...profile,__pbVerifiedClanCosmetics:sharedOptions.clanCosmetics};
  if (sharedOptions.collectionMode === true) sharedOptions={...sharedOptions,routeConstraints:undefined,preferredBiome:undefined,preferredTier:undefined};
  else sharedOptions={...sharedOptions};
  let batch = {
    allTargets:goalList(catalog.targets).filter(target=>goalId(target?.id) && target.selectable !== false),
    resolver:goalResolver(profile,catalog,sharedOptions),
    byId:new Map(goalList(catalog.targets).map(target=>[target.id,target])),
    counterConditions:new Map(),statuses:null,progress:new Map(),counts:new Map(),
  };
  for (const target of goalList(catalog.targets)) for (const condition of goalList(target.requirements)) {
    if (!batch.counterConditions.has(condition.counter)) batch.counterConditions.set(condition.counter,new Map());
    const conditions=batch.counterConditions.get(condition.counter);
    if (!conditions.has(condition.goal)) conditions.set(condition.goal,condition);
  }
  const selectionKeys=new Set(['targetId','previous','advanceOnComplete','category','eventId','confirmed']);
  const select = (selection = {}) => {
    if (!batch) throw new Error('Unlock goal selection batch has been disposed');
    const options={...sharedOptions,...selection};
    // A changed route policy needs a fresh resolver. Selection/scope changes
    // can safely share the same profile predicates and graph indexes.
    const changedPolicy=Object.keys(selection).some(key=>!selectionKeys.has(key) && selection[key] !== sharedOptions[key]);
    const plan=selectUnlockGoalInternal(profile,catalog,options,changedPolicy ? null : batch);
    if (changedPolicy && plan.requestedId !== 'auto') plan.targetStatuses=plan.targetStatuses[plan.requestedId] ?
      {[plan.requestedId]:plan.targetStatuses[plan.requestedId]} : {};
    return plan;
  };
  select.dispose = () => { batch=null; profile=null; catalog=null; sharedOptions=null; };
  return select;
}

function updateUnlockProgress(previous, profile, catalog, options = {}) {
  return selectUnlockGoal(profile, catalog, { ...options, previous });
}

// Verified1.6.0 per-counter character/map/build recommendations.
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
  if (counter.startsWith("tier_") && !counter.endsWith("_j")) return objectiveNumber(profile.biomes?.[counter.slice(5)]);
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
  const liveMaps = bridge.biomes.filter((map) => map.live !== false &&
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
  const johtoActor=counter.endsWith('_j');
  if (johtoActor) {
    const owned=ctx.owned.filter(id=>id>=152&&id<=251);
    if (!owned.length || ctx.fixedSpecies!=null&&!owned.includes(ctx.fixedSpecies)) return {...objectiveBase(ctx),automatable:false,needs:['此条件必须使用已解锁的城都角色']};
    ctx={...ctx,owned,defaultSpecies:owned.includes(ctx.defaultSpecies)?ctx.defaultSpecies:owned[0]};
  }
  const plan = objectiveBase(ctx);
  if (johtoActor) plan.characterCandidates=ctx.owned.map(id=>({id,score:1}));
  const rawMetric=counter.replace(/^best_/, '').replace(/_j$/, ''),
    requiredMap=/^(?:boss|kills|win|tier)_(iris|encina)$/.test(rawMetric)?rawMetric.split('_').at(-1):null;
  const metric=rawMetric==='johto'?'kills':requiredMap&&!rawMetric.startsWith('tier_')?({boss:'bosses',kills:'kills',win:'wins'})[rawMetric.split('_')[0]]:rawMetric;
  if (requiredMap) objectivePreferMap(ctx,plan,requiredMap);
  if (rawMetric==='johto') objectivePreferMap(ctx,plan,['encina','iris'].includes(ctx.defaultMap.id)?ctx.defaultMap.id:'encina');
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
  } else if (metric === "reactions" || metric === "electro") {
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
        statusKeys.has("paralysis") && types.has("psychic")].filter(Boolean).length;
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
      if(metric==='electro') {
        const pair=wet&&types.has('electric') ? {keys:[wetMove,first(move=>move.type==='electric')].filter(Boolean),needsRain:!wetMove}:null;
        return {possible:pair?1:0,rainSkill,naturalRain,types,statusKeys,pair};
      }
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
    } else if (ctx.settings.tier != null && ctx.settings.tier !== "auto" && (johtoActor ? Number(ctx.settings.tier) < requiredTier : Number(ctx.settings.tier) !== requiredTier)) {
      plan.automatable = false;
      plan.needs.push(`目标需${["普通", "困难", "噩梦"][requiredTier]}通关，当前固定难度不匹配`);
    } else if (ctx.maps.some((map) => map.id === id)) plan.tier = johtoActor && Number.isInteger(Number(ctx.settings.tier)) ? Math.max(requiredTier,Number(ctx.settings.tier)) : requiredTier;
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
      if(ctx.owned.includes(member.id)||johtoActor&&(member.id<152||member.id>251))continue;
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
function selectCounterObjective(meta, bridge, settings = {}) {
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
function selectObjective(meta, bridge, settings = {}) {
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
      const prerequisites = incomplete.filter((part) => ["league", "birds", "kantoLeague", "johtoLeague", "beasts"].includes(part.counter)).length;
      const score = (plan.automatable ? 1000 : 0) + progress.fraction * 400 +
        part.value / part.goal * 100 - Math.log1p(part.goal - part.value) * 5 - prerequisites * 45;
      candidates.push({ plan, score, target: { id: roster.id, name, counter: part.counter, goal: part.goal, progress: part.value } });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates.length ? objectiveFinalize(candidates[0].plan, candidates[0].target) : null;
}

  return Object.freeze({selectUnlockGoal,createUnlockGoalSelector,selectCounterObjective,selectObjective});
})();

function characterUnlockLegacy160Options(options = {}) {
  const {characterRoute,characterUnlockMode,moveConstraintsBySpecies,unlockExecution,...existing} = options;
  return {...existing,category:'characters'};
}

export function selectCharacterUnlockLegacy160(profile = {},catalog = {},options = {}) {
  return characterUnlockLegacy160Engine.selectUnlockGoal(profile,catalog,characterUnlockLegacy160Options(options));
}

export function createCharacterUnlockLegacy160Selector(profile = {},catalog = {},sharedOptions = {}) {
  const select=characterUnlockLegacy160Engine.createUnlockGoalSelector(profile,catalog,characterUnlockLegacy160Options(sharedOptions));
  const bound=selection=>select(characterUnlockLegacy160Options(selection));
  bound.dispose=()=>select.dispose();
  return bound;
}

export function selectCounterObjectiveLegacy160(meta,bridge,settings = {}) {
  const {unlockExecution,...existing}=settings;
  return characterUnlockLegacy160Engine.selectCounterObjective(meta,bridge,existing);
}

export function selectCharacterObjectiveLegacy160(meta,bridge,settings = {}) {
  const {unlockExecution,...existing}=settings;
  return characterUnlockLegacy160Engine.selectObjective(meta,bridge,{...existing,mode:'characters'});
}
