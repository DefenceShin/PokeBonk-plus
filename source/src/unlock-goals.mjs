// Public goal graphs and read-only planning. The profile passed to selection
// must be a server-adopted snapshot (or the native run-start snap during a run).
// Local progress, a purchase submission or a kill is never a saved unlock.
import { getGameLibrary, reviewedChampionTimeLimit, characterUnlockActorCapabilities } from './game-library.mjs';
export const unlockGoalCategories = [
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
export function rankingAwardMatches(qualification, award) {
  const rule=qualification?.award,board=award?.board,medal=Number(award?.medal);
  if(qualification?.kind!=="season"||!rule||typeof board!=="string"||!Number.isInteger(medal)||medal<qualification.minMedal||medal>6)return false;
  if(rule.kind==="exact")return board===rule.board;
  if(rule.kind==="pokemon")return /^e?mon:\d{1,4}$/.test(board);
  if(rule.kind==="region")return [0,1,2].some(tier=>board===`kills:${rule.biome}:${tier}`);
  return rule.kind==="non-clan"&&/^(?:kills|time|endless):(?:global|[a-z]+)(?::[0-2])?$/.test(board);
}
// Only native ranked, saved receipts supplied by the controller populate this
// bounded per-identity list. Participation orders work; it never owns a reward.
export function rankingParticipationOrder(qualification, biome, tier, rows=[]) {
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
export function unlockRouteConflict(action = {}, selection = {}) {
  const biome = typeof selection.biome === "string" && selection.biome !== "auto" ? selection.biome : "auto";
  const tier = selection.tier !== null && selection.tier !== undefined && selection.tier !== "auto" &&
    Number.isInteger(Number(selection.tier)) && Number(selection.tier) >= 0 && Number(selection.tier) <= 2 ? Number(selection.tier) : "auto";
  const counter = String(action.counter || "").replace(/^best_/, "");
  const required = {};
  const nativeBiome = action.source?.biome || action.biome ||
    (counter.startsWith("tier_") ? counter.slice(5) : counter === "win_forest" ? "forest" : ["kills_desert", "boss_desert"].includes(counter) ? "desert" : null);
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

export function normalizeUnlockTargets(value = {}, legacy = {}, options = {}) {
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

export function unlockCounterValue(profile, counter, catalog = {}) {
  if (/^lk:\d+:[12567]$/.test(counter) && goalList(catalog.targets).some(target=>target.counter === counter && target.look?.rule?.kind === "bits")) {
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

const characterStatusCounter={burned:'burn',paralyzed:'paralysis',soaked:'wet',frozen:'freeze',poisoned:'poison',slept:'sleep',confused:'confusion'};
const characterRunStat={kills:'kills',dodges:'dodges',reactions:'reactions',alphas:'alphas',bosses:'bosses',ultimates:'ultimates',gold:'gold'};
const characterDensityBenefit=(actor,metrics)=>metrics.some(metric=>['kills','kills_desert'].includes(metric)||metric==='rainKills'&&actor.moves.some(move=>move.key==='rain-dance'));
// These public counters can progress through ordinary enemies, native player
// growth or existing pickups/NPCs before the final guardian is summoned. Boss
// and legendary deaths themselves are deliberately absent from this hold set.
const characterPreBossCounters=new Set(['crits','paralyzed','dodges','healed','alphas','ultimates','burned','slept','poisoned','confused','rocks','gold','soaked','maxLevel','maxTime','frozen','reactions','chests','berries','alphaCaught']);
const characterBulkCounters=new Set(['kills','crits','paralyzed','rainKills','dodges','healed','alphas','ultimates','burned','slept','poisoned','confused','rocks','gold','soaked','bosses','maxLevel','maxTime','frozen','reactions','chests','berries','boss_desert','alphaCaught','kills_desert','legendaries']);
const characterStatusPotential=move=>(Number.isFinite(move.statusChance)?Math.max(0,move.statusChance):1)*Math.max(.01,Number(move.count)||1)*Math.max(.1,Math.min(4,Math.sqrt(Math.max(1,Number(move.area)||1))))/
  Math.max(.2,Number(move.cd)||1)/(1+Math.max(0,(move.availableLevel || 1)-1)/30);
function characterCounterCapability(actor,counter,map) {
  const metric=counter.replace(/^best_/,''),status=characterStatusCounter[metric],moves=actor.moves;
  if(status){const matches=moves.filter(move=>move.status===status);return {possible:matches.length>0,value:matches.reduce((sum,move)=>sum+characterStatusPotential(move),0),moves:matches.sort((a,b)=>characterStatusPotential(b)-characterStatusPotential(a)).slice(0,2).map(move=>move.key),statuses:[status]};}
  if(metric==='kills_desert'||metric==='boss_desert')return {possible:map.id==='desert',value:actor.combatPotential,moves:[]};
  if(metric==='rainKills'){const rain=moves.find(move=>move.key==='rain-dance'),weather=map.weather || [];return {possible:!!rain||weather.includes('rain'),value:rain?2:weather.filter(value=>value==='rain').length/Math.max(1,weather.length),moves:rain?[rain.key]:[]};}
  if(metric==='reactions'){
    const status=new Set(moves.map(move=>move.status).filter(Boolean)),types=new Set(moves.map(move=>move.type)),wet=status.has('wet')||moves.some(move=>move.key==='rain-dance')||map.weather?.includes('rain'),
      pairs=[[wet&&types.has('electric'),move=>move.status==='wet'||move.key==='rain-dance',move=>move.type==='electric'],
        [status.has('burn')&&['water','grass','flying'].some(type=>types.has(type)),move=>move.status==='burn',move=>['water','grass','flying'].includes(move.type)],
        [status.has('poison')&&types.has('fire'),move=>move.status==='poison',move=>move.type==='fire'],
        [status.has('freeze')&&['fighting','rock','steel'].some(type=>types.has(type)),move=>move.status==='freeze',move=>['fighting','rock','steel'].includes(move.type)],
        [status.has('paralysis')&&types.has('psychic'),move=>move.status==='paralysis',move=>move.type==='psychic'],
        [status.has('charm')&&types.has('dragon'),move=>move.status==='charm',move=>move.type==='dragon']].filter(row=>row[0]);
    return {possible:pairs.length>0,value:pairs.length,moves:pairs.length?[moves.find(pairs[0][1])?.key,moves.find(pairs[0][2])?.key].filter(Boolean):[]};
  }
  if(metric==='crits'){
    const candidates=moves.filter(move=>!['weather','buff','random','meta','fusion'].includes(move.arch)),potential=move=>(.05+actor.critChance+Math.max(0,Number(move.critBonus)||0))*Math.max(1,Number(move.count)||1)/Math.max(.2,Number(move.cd)||1)*Math.max(1,Math.min(3,Math.sqrt(Number(move.area)||1)));
    candidates.sort((a,b)=>potential(b)-potential(a));return {possible:candidates.length>0,value:candidates.slice(0,2).reduce((sum,move)=>sum+potential(move),0),moves:candidates.slice(0,2).map(move=>move.key)};
  }
  if(metric==='healed')return {possible:true,value:1+actor.healPotential,moves:moves.filter(move=>move.drain>0).slice(0,2).map(move=>move.key)};
  if(metric==='dodges')return {possible:true,value:1+actor.evasion*30,moves:[]}; // Native items/vitamins give every actor a legal fallback.
  return {possible:characterBulkCounters.has(metric),value:actor.combatPotential,moves:[]};
}
function characterLiveCondition(condition,profile,targetIds) {
  const counter=condition.counter,metric=counter.replace(/^best_/,''),singleRun=counter.startsWith('best_')||['maxTime','maxLevel'].includes(metric),key=characterRunStat[metric];
  return {counter,goal:condition.goal,saved:unlockCounterValue(profile,counter),singleRun,targetIds,
    canProgressBeforeFinalBoss:characterPreBossCounters.has(metric),
    liveSource:metric==='maxTime'?{owner:'run',key:'time',aggregation:'run-total'}:metric==='maxLevel'?{owner:'player',key:'level',aggregation:'run-total'}:key?{owner:'runStats',key,aggregation:'run-total'}:
      {owner:'metaCounter',key:metric,aggregation:singleRun?'run-delta':'live-total'}};
}
const normalFinishMasteryMetrics=new Set(['soaked','evolutions','poisoned','paralyzed','burned','slept','crits','gold','confused','frozen','alphas','kills','maxLevel','maxTime','healed','ultimates','electro','dodges','rainKills','rocks','berries','chests']);
// This preference belongs to appearance collection only. It is not a native
// mode override: victory, exact-mode and additional predicate constraints stay
// authoritative. Unknown future predicates keep their reviewed default route.
export function normalizeAppearanceSettings(value = {},previous = {}) {
  const record=entry=>entry&&typeof entry==='object'&&!Array.isArray(entry)?entry:{},source=record(value),old=record(previous),
    validators={countMode:entry=>['auto','standard','endless'].includes(entry),settleOnGoal:entry=>typeof entry==='boolean',
      countCampStage:entry=>entry==='auto'||typeof entry==='number'&&Number.isInteger(entry)&&entry>=1&&entry<=3},
    defaults={countMode:'auto',settleOnGoal:true,countCampStage:'auto'};
  return Object.fromEntries(Object.keys(defaults).map(key=>[key,validators[key](source[key])?source[key]:
    validators[key](old[key])?old[key]:defaults[key]]));
}
function appearanceMasteryRoute(mastery,options,requestedTier) {
  if(options.appearanceOptions===undefined)return null;
  const settings=normalizeAppearanceSettings(options.appearanceOptions),constraints=mastery.constraints,
    plain=constraints==null||typeof constraints==='object'&&!Array.isArray(constraints),
    // The reviewed non-victory factories all produce these exact metrics.
    // Evolutions have a finite species chain: long endless runs cannot supply
    // another evolution after the final form, so they need normal repeat runs.
    eligible=normalFinishMasteryMetrics.has(mastery.metric)&&!['maxTime','evolutions','rocks','berries','chests'].includes(mastery.metric)&&
      (mastery.mode||'standard')==='standard'&&(mastery.minTier??0)===0&&!mastery.biome&&
      !goalList(mastery.bitTargets).length&&plain&&!Object.keys(constraints||{}).length,
    compatible=eligible&&(requestedTier==null||requestedTier===0),
    mode=compatible&&settings.countMode!=='standard'?'endless':mastery.mode||'standard',
    reason=mode==='endless'&&eligible?'此数量条件不要求胜利；使用普通无尽持续积累，达标后按设置正常结算，未达标继续至自然结束':
      mastery.metric==='evolutions'?'进化次数受本局形态链限制，按经典模式多局积累，不在终形无尽中空等':
      eligible&&requestedTier>0?'当前模式指定了困难或噩梦，保留该经典难度，不以无尽固定普通难度覆盖':
      eligible?'按已选经典模式积累此数量条件':
      '此目标保留原生通关、指定模式或其它完整条件；数量模式偏好不改变这些要求';
  return {...settings,mode,eligible,reason};
}
// Complete projection of the reviewed non-victory mastery predicates. Never
// call Run.result(), whose holdSecs update is a native save-side mutation.
export function masteryNormalSettlementState(run,goal,sourceHash=null) {
  const inactive=reason=>({active:false,known:false,met:false,reason}),record=value=>{try{if(!value||Object.prototype.toString.call(value)!=='[object Object]')return false;const proto=Object.getPrototypeOf(value);return proto===null||Object.getPrototypeOf(proto)===null;}catch{return false;}};
  if(!record(goal)||goal.schemaVersion!==1||goal.kind!=='reviewed-mastery'||goal.requiresVictory!==false||
      !normalFinishMasteryMetrics.has(goal.metric)||!Number.isInteger(goal.member)||goal.member<=0||
      goal.counter!==`lk:${goal.member}:${goal.level}`||![1,2,6].includes(goal.level)||
      typeof goal.sourceHash!=='string'||!/^[a-f0-9]{64}$/.test(goal.sourceHash)||sourceHash&&goal.sourceHash!==sourceHash)return inactive('unreviewed-mastery-goal');
  const finite=value=>typeof value==='number'&&Number.isFinite(value)?value:null,
    mode=typeof run?.mode==='string'?run.mode:run?.tower?'tower':run?.endless?'endless':'standard',start=finite(run?.startSpecies),time=finite(run?.time),
    saved=finite(goal.saved),limit=finite(goal.goal),constraints=goal.constraints??{};
  if(!run?.player||run.coop&&goal.allowCoop!==true||run.player.dead||run.state==='over'||start!==goal.member||mode!==goal.mode||
      run.biome?.id!==goal.biome||Number(run.tier??0)!==goal.tier||time===null||time<0||saved===null||saved<0||limit===null||limit<=0||
      !record(constraints)||Object.keys(constraints).some(key=>!['initialSpeciesHold','minTime','minTimeInclusive'].includes(key)))return inactive('mastery-current-context-or-constraint-mismatch');
  let value=null;
  if(goal.metric==='maxTime'&&goal.level===6&&goal.goal===2400&&goal.mode==='endless'&&goal.singleRun===true&&goal.allowCoop===false&&!Object.keys(constraints).length){
    value=Math.floor(time);
  }else if(goal.metric==='maxTime'){
    const hold=constraints.initialSpeciesHold,first=run.firstEvoAt==null?null:finite(run.firstEvoAt),current=finite(run.player.speciesId),counted=finite(run.holdCounted),
      before=run.meta?.snap?.counters,after=run.meta?.profile?.counters,
      counter=(table,key)=>record(table)?(Object.hasOwn(table,key)?finite(table[key]):0):null,
      old=counter(before,'holdSecs'),now=counter(after,'holdSecs');
    if(!record(hold)||goal.member!==129||goal.mode!=='endless'||goal.singleRun!==true||hold?.species!==129||hold.seconds!==600||
        constraints.minTime!==600||constraints.minTimeInclusive!==true||current===null||counted===null||counted<0||
        old===null||now===null||run.firstEvoAt!=null&&first===null||first!==null&&(first<0||first>time)||current!==129&&first===null)
      return inactive('unknown-exact-initial-form-hold');
    const projectedDelta=Math.max(0,now-old)+Math.max(0,Math.floor(first??time)-counted);
    value=Math.floor(current===129?time:Math.min(time,projectedDelta));
  }else if(Object.keys(constraints).length)return inactive('unreviewed-extra-mastery-constraint');
  else if(goal.metric==='maxLevel')value=finite(run.player.level);
  else if(['alphas','kills','evolutions'].includes(goal.metric))value=record(run.stats)?finite(run.stats[goal.metric]):null;
  else {
    const before=run.meta?.snap?.counters,after=run.meta?.profile?.counters,
      read=table=>record(table)?(Object.hasOwn(table,goal.metric)?finite(table[goal.metric]):0):null,
      a=read(after),b=read(before);if(a!==null&&b!==null)value=Math.max(0,Math.floor(a-b));
  }
  if(value===null||value<0)return inactive('unknown-native-mastery-value');
  const total=goal.singleRun===true?value:saved+value;
  return {active:true,known:true,met:total>=limit,value,total,goal:limit,saved,requiresVictory:false,
    reason:total>=limit?'complete-reviewed-non-victory-mastery':'pending-reviewed-non-victory-mastery'};
}
function characterPreferenceHints(counter,capability={}) {
  const metric=counter.replace(/^best_/,''),status=characterStatusCounter[metric];
  return {preferredMoves:[...(capability.moves || [])],preferStatuses:status?[status]:[],
    vitaminPriority:status?['statusChance','attackSpeed']:metric==='dodges'?['evasion','maxHp','regen']:metric==='healed'?['regen','healing','lifesteal','maxHp']:metric==='crits'?['critChance','attackSpeed','damage']:['damage','attackSpeed','area'],
    itemPriority:metric==='dodges'?['bright-powder','lax-incense']:metric==='healed'?['leftovers','shell-bell']:metric==='crits'?['scope-lens','razor-claw']:[],
    statWeights:metric==='dodges'?{evasion:2}:metric==='healed'?{regen:2,healing:2,lifesteal:2}:metric==='crits'?{critChance:2,attackSpeed:1.2}:{}};
}
// Future work is a bounded soft preference, never a current completion or
// controlled-contact objective. All thresholds still come from the live catalog.
function characterForesight(profile,catalog,actor,map,excludedIds=[]) {
  const excluded=new Set(excludedIds),rows=new Map(),rank={dodges:0,healed:1,crits:2,paralyzed:3,frozen:4,burned:5,slept:6,poisoned:7,confused:8,soaked:9,gold:10};
  for(const target of goalList(catalog.targets)){
    if(target.category!=='characters'||excluded.has(target.id)||goalPredicate(target.completion,profile,catalog).done)continue;
    for(const condition of goalList(target.requirements)){
      const metric=String(condition.counter||'').replace(/^best_/, '');
      if(condition.kind!=='counter'||!Object.hasOwn(rank,metric)||goalPredicate(condition,profile,catalog).done)continue;
      const capability=characterCounterCapability(actor,condition.counter,map);if(!capability.possible)continue;
      const old=rows.get(condition.counter),entry=old||{condition,metric,capability,targetIds:[]};
      if(old&&condition.goal>entry.condition.goal)entry.condition=condition;
      if(!entry.targetIds.includes(target.id))entry.targetIds.push(target.id);rows.set(condition.counter,entry);
    }
  }
  const entries=[...rows.values()].sort((a,b)=>rank[a.metric]-rank[b.metric]||a.condition.counter.localeCompare(b.condition.counter)).slice(0,12),
    preferenceHints={preferredMoves:[],preferStatuses:[],vitaminPriority:[],itemPriority:[],statWeights:{}},conditions=[];
  for(const row of entries){
    const hint=characterPreferenceHints(row.condition.counter,row.capability),weights=row.metric==='gold'?{gold:1.1}:
      row.metric==='dodges'?{evasion:1.15,maxHp:1.05}:row.metric==='healed'?{regen:1.1,healing:1.1,lifesteal:1.1}:
      row.metric==='crits'?{critChance:1.15,attackSpeed:1.05}:{statusChance:1.1,attackSpeed:1.05};
    // Future status work may use only the primary actor's already-compatible
    // attack kit. Do not request new moves or alter the primary/fixed stage.
    const soft={preferredMoves:[],preferStatuses:[],vitaminPriority:[...hint.vitaminPriority].filter(key=>Object.hasOwn(weights,key)),itemPriority:[...hint.itemPriority],statWeights:weights};
    for(const key of ['vitaminPriority','itemPriority'])for(const value of soft[key])if(!preferenceHints[key].includes(value))preferenceHints[key].push(value);
    for(const[key,value]of Object.entries(weights))preferenceHints.statWeights[key]=Math.max(preferenceHints.statWeights[key]||1,value);
    conditions.push({...characterLiveCondition(row.condition,profile,row.targetIds),canProgressBeforeFinalBoss:false,preferenceHints:soft,futureOnly:true});
  }
  const score=entries.reduce((value,row)=>value+(row.metric==='dodges'?Math.min(.6,actor.evasion)/.6:row.metric==='healed'?Math.min(.5,actor.healPotential*.03):row.metric==='crits'?Math.min(.5,actor.critChance*5):Math.min(.15,row.capability.value*.01)),0);
  return {schemaVersion:1,conditions,preferenceHints,benefitTargetIds:[...new Set(entries.flatMap(row=>row.targetIds))],score,practice:false,blocksCompletion:false,
    reason:'仅提前获取有用成长；不变更当前/固定主线，不为未来条件承伤、拖局或阻止当前全部目标完成后的结算'};
}
function characterConstrainedActor(actor,options) {
  const local=options.moveConstraintsBySpecies?.[String(actor.id)] || {},banned=new Set([...goalList(options.bannedMoveKeys),...goalList(local.bannedMoveKeys)]),
    allow=Array.isArray(local.allowedMoveKeys)?new Set(local.allowedMoveKeys):Array.isArray(options.allowedMoveKeys)?new Set(options.allowedMoveKeys):null;
  return {...actor,moves:actor.moves.filter(move=>!banned.has(move.key)&&(!allow||allow.has(move.key)))};
}
function characterBatchMoveSet(actor,entries,map) {
  const potential=entries.map(entry=>({...entry,capability:characterCounterCapability(actor,entry.condition.counter,map)})).filter(entry=>entry.capability.possible),
    keys=[...new Set(potential.flatMap(entry=>entry.capability.moves || []))].slice(0,20),
    score=selected=>potential.reduce((sum,entry)=>{const required=entry.capability.moves || [],metric=entry.condition.counter.replace(/^best_/,'');
      const possible=!required.length||metric==='reactions'?required.every(key=>selected.includes(key)):required.some(key=>selected.includes(key));
      return sum+(possible?1+entry.targetIds.length*.3:0);},0),
    seeds=[[],...potential.filter(entry=>entry.capability.moves?.length).sort((a,b)=>b.targetIds.length-a.targetIds.length).slice(0,3).map(entry=>entry.capability.moves.slice(0,4))];
  let best=[],bestScore=-Infinity;
  for(const seed of seeds){let selected=[...seed],current=score(selected);
    while(selected.length<4){let choice=null,gain=0;
      for(const key of keys){if(selected.includes(key))continue;const value=score([...selected,key])-current;
        if(value>gain){gain=value;choice=key;}}
      if(!choice)break;selected.push(choice);current+=gain;
    }
    if(current>bestScore){best=selected;bestScore=current;}
  }
  return {...actor,moves:actor.moves.filter(move=>best.length?best.includes(move.key):
      move.routes?.some(route=>route.kind==='kit'&&route.speciesId===actor.id)),recommendedMoves:best};
}

/** Pure, account-specific opportunity model. Scores express comparative known
 * coverage, not a promised number of kills per second or a global fastest time. */
export function planCharacterUnlockBatch(profile={},catalog={},options={}) {
  const rules=catalog.rules?.characterUnlock;
  if(rules?.schemaVersion!==1||!Array.isArray(rules.maps)||!Array.isArray(rules.actors)||rules.provenance?.sourceHash!==catalog.sourceHash||rules.provenance?.gameVersion!==catalog.gameVersion||
    !(goalNumber(profile.lab?.[rules.fourthMoveLab])>0))return null;
  const owned=goalList(profile.league).map(Number),fixed=Number(options.characterId),
    actors=characterUnlockActorCapabilities(rules,owned).filter(actor=>!(fixed>0)||actor.id===fixed)
      .map(actor=>characterConstrainedActor(actor,options));
  if(!actors.length)return null;
  const scope=Array.isArray(options.targetIds)?new Set(options.targetIds):null,
    pending=goalList(catalog.targets).filter(target=>target.category==='characters'&&(!scope||scope.has(target.id))&&!goalPredicate(target.completion,profile,catalog).done),
    conditions=new Map();
  for(const target of pending)for(const condition of goalList(target.requirements)){
    if(condition.kind!=='counter'||!characterBulkCounters.has(String(condition.counter).replace(/^best_/,''))||goalPredicate(condition,profile,catalog).done)continue;
    const key=condition.counter+':'+condition.goal;if(!conditions.has(key))conditions.set(key,{condition,targetIds:[]});conditions.get(key).targetIds.push(target.id);
  }
  for(const condition of goalList(options.counterTargets)){
    if(condition.kind!=='counter'||!characterBulkCounters.has(String(condition.counter).replace(/^best_/,''))||goalPredicate(condition,profile,catalog).done)continue;
    const source=goalList(catalog.targets).find(target=>target.category==='characters'&&goalList(target.requirements).some(row=>row.kind==='counter'&&row.counter===condition.counter&&row.goal===condition.goal));
    if(source&&!goalPredicate(source.completion,profile,catalog).done)conditions.set(condition.counter+':'+condition.goal,{condition,targetIds:[source.id]});
  }
  if(!conditions.size)return null;
  const requested=options.routeConstraints || {},maps=rules.maps.filter(map=>(requested.biome==null||requested.biome==='auto'||requested.biome===map.id)&&
    (requested.tier==null||requested.tier==='auto'||Number(requested.tier)===0)),candidates=[];
  for(const map of maps)for(const availableActor of actors){
    const actor=characterBatchMoveSet(availableActor,[...conditions.values()],map),
      applicable=[...conditions.values()].map(entry=>({...entry,capability:characterCounterCapability(actor,entry.condition.counter,map)})).filter(entry=>entry.capability.possible);
    if(!applicable.length)continue;
    const unique=new Set(applicable.map(entry=>entry.condition.counter)),targets=new Set(applicable.flatMap(entry=>entry.targetIds)),
      // A nearly prepared role has greater immediate value; all still-useful
      // conditions receive a finite opportunity, including later league gates.
      score=applicable.reduce((sum,entry)=>sum+1+entry.targetIds.length*.3+Math.min(1,unlockCounterValue(profile,entry.condition.counter)/entry.condition.goal)*.5+
        (entry.condition.counter.replace(/^best_/,'')==='dodges'?Math.min(3,actor.evasion*15):entry.condition.counter.replace(/^best_/,'')==='healed'?Math.min(3,actor.healPotential*.15):0),0)+
        Math.min(4,actor.combatPotential*.12)+unique.size*.15,
      immediate=entry=>entry.targetIds.some(id=>{const target=pending.find(row=>row.id===id);return goalList(target?.requirements).every(condition=>
        condition.kind==='counter'&&characterBulkCounters.has(String(condition.counter).replace(/^best_/,''))||goalPredicate(condition,profile,catalog).done);}),
      focus=applicable.slice().sort((a,b)=>Number(immediate(b))-Number(immediate(a))||b.targetIds.length-a.targetIds.length||
        Number(!a.condition.counter.startsWith('best_'))-Number(!b.condition.counter.startsWith('best_'))||a.condition.counter.localeCompare(b.condition.counter)),
      first=focus[0],primary={...first,targetIds:first.targetIds.slice().sort((a,b)=>{
        const ready=id=>goalList(pending.find(row=>row.id===id)?.requirements).every(condition=>condition.kind==='counter'&&characterBulkCounters.has(String(condition.counter).replace(/^best_/,''))||goalPredicate(condition,profile,catalog).done);
        return Number(ready(b))-Number(ready(a))||a.localeCompare(b);})},focusMetrics=[...new Set(focus.map(entry=>entry.condition.counter.replace(/^best_/,'')))],
      preferredMoves=[...actor.recommendedMoves],
      preferenceHints={preferredMoves,preferStatuses:[...new Set(focus.flatMap(entry=>entry.capability.statuses || []))],
        vitaminPriority:[...(focusMetrics.some(metric=>characterStatusCounter[metric])?['statusChance']:[]),...(focusMetrics.includes('dodges')?['evasion']:[]),...(focusMetrics.includes('healed')?['regen','healing']:[]),...(focusMetrics.includes('crits')?['critChance']:[]),'damage','attackSpeed'],
        itemPriority:[...(focusMetrics.includes('dodges')?['bright-powder','lax-incense']:[]),...(focusMetrics.includes('healed')?['leftovers','shell-bell']:[]),...(focusMetrics.includes('crits')?['scope-lens','razor-claw']:[])],
        statWeights:{...(focusMetrics.includes('dodges')?{evasion:2}:{}),...(focusMetrics.includes('healed')?{regen:2,healing:2,lifesteal:2}:{}),...(focusMetrics.includes('crits')?{critChance:2,attackSpeed:1.2}:{})}};
    candidates.push({score,actor,map,targets:[...targets],primary,applicable,focusMetrics,preferenceHints,unlocked:goalNumber(profile.biomes?.[map.id],-1)>=0});
  }
  candidates.sort((a,b)=>b.score-a.score||Number(b.unlocked)-Number(a.unlocked)||a.map.id.localeCompare(b.map.id)||a.actor.id-b.actor.id);
  if(!candidates.length)return null;
  const open=candidates.find(row=>row.unlocked),best=candidates[0];let chosen=!best.unlocked&&open&&best.score<=open.score+1?open:best;
  if(!chosen.unlocked)return {prerequisiteTargetId:'maps:'+chosen.map.id,biome:chosen.map.id,
    reason:`${chosen.map.name}生存的当前可推进条件较多；先正常解锁地图，再按保存进度重算批量收益`,benefitTargetIds:chosen.targets};
  const tied=candidates.filter(row=>row.unlocked&&row.map.id===chosen.map.id&&row.targets.length===chosen.targets.length&&
    row.primary.condition.counter===chosen.primary.condition.counter&&row.score>=chosen.score-Math.max(.05,Math.abs(chosen.score)*.03));
  for(const row of candidates.filter(row=>row.unlocked&&row.map.id===chosen.map.id))row.foresight=characterForesight(profile,catalog,row.actor,row.map,row.targets);
  if(!(Number(options.characterId)>0)&&tied.length>1)chosen=tied.slice().sort((a,b)=>b.foresight.score-a.foresight.score||b.score-a.score||a.actor.id-b.actor.id)[0];
  const mode=characterDensityBenefit(chosen.actor,chosen.focusMetrics)?'endless':'standard',
    same=candidates.filter(row=>row.unlocked&&row.map.id===chosen.map.id).sort((a,b)=>Number(b===chosen)-Number(a===chosen)||b.score-a.score),execution={schemaVersion:1,kind:'character-batch',completionPolicy:'finish-when-live-goals-met',mode,biome:chosen.map.id,tier:0,naturalEnd:mode==='endless',
    finishPolicy:mode==='endless'?'natural-end':chosen.applicable.some(entry=>characterPreBossCounters.has(entry.condition.counter.replace(/^best_/,'')))?'conditions-before-final-boss':undefined,
    conditions:chosen.applicable.map(entry=>({...characterLiveCondition(entry.condition,profile,entry.targetIds),preferenceHints:characterPreferenceHints(entry.condition.counter,entry.capability)})),focusCounters:chosen.focusMetrics,
    actorCandidates:same.map(row=>({id:row.actor.id,score:row===chosen?Math.max(...same.map(entry=>entry.score))+.001:row.score,primaryScore:row.score,reason:`已拥有角色；公开战力潜力 ${row.actor.combatPotential.toFixed(2)}，可推进 ${row.targets.length} 个尚未拥有角色的条件`,
      conditions:row.applicable.map(entry=>({...characterLiveCondition(entry.condition,profile,entry.targetIds),preferenceHints:characterPreferenceHints(entry.condition.counter,entry.capability)})),
      preferenceHints:row.preferenceHints,focusCounters:row.focusMetrics,benefitTargetIds:row.targets,foresight:row.foresight})),
    preferenceHints:chosen.preferenceHints,benefitTargetIds:chosen.targets,foresight:chosen.foresight,sourceHash:catalog.sourceHash,
    reason:mode==='endless'?`第四招式栏已解锁；${chosen.map.name}普通生存可同时推进${chosen.targets.length}个未拥有角色的条件，仍有击杀密度收益。未达本局条件时正常继续；全部已知本局目标完成后立即原生放弃结算并核对保存，再换图或进入下一步骤`:
      `当前只剩机制条件；${chosen.map.name}普通经典可同时推进${chosen.targets.length}个角色，先完成本局有效条件，全部本局目标完成后立即原生放弃结算；仍需通关或当前捕捉时继续正常完成，长期无进展则正常通关重试`};
  return {targetId:chosen.primary.targetIds[0],stepId:'counter:'+chosen.primary.condition.counter,progressCondition:goalClone(chosen.primary.condition),
    action:{kind:'pursue-counter',counter:chosen.primary.condition.counter,goal:chosen.primary.condition.goal,mode,biome:chosen.map.id,tier:0,unlockExecution:execution},
    chain:[],cost:1,message:execution.reason,ready:true};
}
function characterFocusExecution(profile,catalog,options,plan) {
  const target=goalList(catalog.targets).find(target=>target.id===plan.targetId),action=plan.action,rules=catalog.rules?.characterUnlock;
  if(target?.category!=='characters'||action?.kind!=='pursue-counter'||action.unlockExecution||!Array.isArray(rules?.maps)||rules?.provenance?.sourceHash!==catalog.sourceHash)return null;
  const metric=String(action.counter).replace(/^best_/,''),condition=goalList(target.requirements).find(row=>row.counter===action.counter);
  if(!condition||!characterBulkCounters.has(metric))return null;
  const constraints=options.routeConstraints || {},requestedTier=constraints.tier!=null&&constraints.tier!=='auto'?Number(constraints.tier):Number(action.tier ?? 0),
    tier=Number.isInteger(requestedTier)&&requestedTier>=0&&requestedTier<=2?requestedTier:0,
    fixed=Number(options.characterId),
    actors=characterUnlockActorCapabilities(rules,goalList(profile.league).map(Number)).filter(actor=>!(fixed>0)||actor.id===fixed)
      .map(actor=>characterConstrainedActor(actor,options)),
    maps=rules.maps.filter(map=>goalNumber(profile.biomes?.[map.id],-1)>=tier&&(!action.biome||map.id===action.biome)&&
      (!constraints.biome||constraints.biome==='auto'||map.id===constraints.biome)),rows=[];
  for(const actor of actors)for(const map of maps){const capability=characterCounterCapability(actor,condition.counter,map);if(!capability.possible)continue;
    const value=metric==='dodges'?actor.evasion*100:metric==='healed'?actor.healPotential*10:characterStatusCounter[metric]?capability.value*10:0;
    rows.push({actor,map,capability,score:value+actor.combatPotential});}
  rows.sort((a,b)=>b.score-a.score||a.map.id.localeCompare(b.map.id)||a.actor.id-b.actor.id);if(!rows.length)return null;
  let chosen=rows[0];for(const row of rows.filter(row=>row.map.id===chosen.map.id))row.foresight=characterForesight(profile,catalog,row.actor,row.map,[target.id]);
  if(!(fixed>0))chosen=rows.filter(row=>row.map.id===chosen.map.id&&row.score>=chosen.score-Math.max(.05,Math.abs(chosen.score)*.03)).sort((a,b)=>b.foresight.score-a.foresight.score||b.score-a.score||a.actor.id-b.actor.id)[0];
  const mode=tier===0&&goalNumber(profile.lab?.[rules.fourthMoveLab])>0&&characterDensityBenefit(chosen.actor,[metric])?'endless':'standard',naturalEnd=mode==='endless',
    hints=characterPreferenceHints(condition.counter,chosen.capability);
  return {schemaVersion:1,kind:'character-focus',completionPolicy:'finish-when-live-goals-met',mode,biome:chosen.map.id,tier,naturalEnd,finishPolicy:naturalEnd?'natural-end':characterPreBossCounters.has(metric)?'conditions-before-final-boss':undefined,
    conditions:[{...characterLiveCondition(condition,profile,[target.id]),preferenceHints:hints}],focusCounters:[metric],preferenceHints:hints,foresight:chosen.foresight,
    actorCandidates:rows.filter(row=>row.map.id===chosen.map.id).sort((a,b)=>Number(b===chosen)-Number(a===chosen)||b.score-a.score).map(row=>({id:row.actor.id,score:row===chosen?Math.max(...rows.filter(entry=>entry.map.id===chosen.map.id).map(entry=>entry.score))+.001:row.score,primaryScore:row.score,reason:'已拥有且具备当前原生条件所需能力；按条件收益后比较公开战力潜力',
      conditions:[{...characterLiveCondition(condition,profile,[target.id]),preferenceHints:characterPreferenceHints(condition.counter,row.capability)}],
      preferenceHints:characterPreferenceHints(condition.counter,row.capability),focusCounters:[metric],benefitTargetIds:[target.id],foresight:row.foresight})),
    benefitTargetIds:[target.id],sourceHash:catalog.sourceHash,
    reason:metric==='dodges'?'优先原生闪避能力与闪避成长，在安全生命预算下接受普通接触；达到本局条件后停止练习，不把实际掉血当闪避次数':
      metric==='healed'?'优先真实回复能力；在安全生命预算下制造可治疗缺口，只认原生实际治疗量，不将再生面板当计数':
        naturalEnd?'普通难度正常积累条件；全部已知本局目标达成后立即通过原生放弃结算保存，不等健康角色自然死亡':'按该角色的原生条件选择可学习招式与配装，保持必要交互与正常推进'};
}
function characterCapabilityPrerequisite(profile,catalog,options,plan) {
  if(Number(options.characterId)>0||plan.action?.unlockExecution||plan.action?.kind!=='pursue-counter')return null;
  const target=goalList(catalog.targets).find(target=>target.id===plan.targetId),rules=catalog.rules?.characterUnlock,
    metric=String(plan.action.counter || '').replace(/^best_/,'');
  if(target?.category!=='characters'||!characterBulkCounters.has(metric)||!Array.isArray(rules?.maps)||!Array.isArray(rules?.actors)||rules?.provenance?.sourceHash!==catalog.sourceHash)return null;
  const maps=rules.maps.filter(map=>goalNumber(profile.biomes?.[map.id],-1)>=0&&
    (!options.routeConstraints?.biome||options.routeConstraints.biome==='auto'||map.id===options.routeConstraints.biome)),owned=goalList(profile.league).map(Number),candidates=[],resolve=goalResolver(profile,catalog,options).resolve;
  for(const actor of rules.actors){
    if(owned.includes(actor.id)||target.id==='characters:'+actor.id)continue;
    const provider=goalList(catalog.targets).find(target=>target.id==='characters:'+actor.id);if(!provider)continue;
    // A provider which itself needs this effect is not a cold-start solution,
    // even when its numeric threshold is smaller than the original target.
    if(goalList(provider.requirements).some(condition=>condition.kind==='counter'&&String(condition.counter).replace(/^best_/,'')===metric))continue;
    const available=characterUnlockActorCapabilities(rules,[...owned,actor.id]).find(row=>row.id===actor.id),projected=available?characterConstrainedActor(available,options):null;
    if(!projected||!maps.some(map=>characterCounterCapability(projected,plan.action.counter,map).possible))continue;
    const step=resolve(provider.id);if(!step.ready||step.chain?.includes(target.id)||step.action?.kind==='pursue-counter'&&String(step.action.counter).replace(/^best_/,'')===metric)continue;
    const missing=goalList(provider.requirements).filter(condition=>!goalPredicate(condition,profile,catalog).done),gates=missing.filter(condition=>condition.counter==='league'||condition.counter==='birds'||condition.counter?.startsWith('tier_')).length;
    candidates.push({provider,step,gates,start:actor.start,missing:missing.length});
  }
  candidates.sort((a,b)=>a.gates-b.gates||Number(b.start)-Number(a.start)||a.missing-b.missing||a.step.cost-b.step.cost||Number(a.provider.key)-Number(b.provider.key));
  const candidate=candidates[0];if(!candidate)return null;
  return {...plan,...candidate.step,targetId:target.id,chain:[...new Set([...(plan.chain || []),target.id,candidate.provider.id,...(candidate.step.chain || [])])],status:'ready',
    message:`当前已拥有角色尚无已核对的${metric}合法能力组合；先按真实前置获取${candidate.provider.name}，其正常进化/学习路线可提供所需能力，不使用尚未拥有的角色开局。`+candidate.step.message};
}

/** Fixed milestones are recovered exclusively from adopted saved progress.
 * There is no process cursor and unrelated owned roles never rerank stages. */
export function planFixedCharacterUnlockRoute(profile={},catalog={},options={}) {
  if(options.characterRoute!=='bulbasaur')return null;
  const rules=catalog.rules?.characterUnlock,definition=rules?.fixedRoutes?.bulbasaur,targets=goalList(catalog.targets).filter(target=>target.category==='characters'),
    counts={total:targets.length,complete:targets.filter(target=>goalPredicate(target.completion,profile,catalog).done).length};counts.remaining=counts.total-counts.complete;
  const base={schemaVersion:1,category:'characters',requestedId:'auto',targetId:null,stepId:null,action:null,chain:[],counts,targetStatuses:{}};
  if(!definition||definition.sourceHash!==catalog.sourceHash||definition.gameVersion!==catalog.gameVersion||!Array.isArray(rules.actors)||!Array.isArray(rules.maps)||!Array.isArray(definition.stages)||
    definition.stages.some(stage=>!Array.isArray(stage?.targetIds)||!Array.isArray(stage.steps)||!stage.steps.length||stage.steps.some(step=>!Array.isArray(step?.targetIds))))
    return {...base,status:'waiting',code:'character-route-definition-unavailable',message:'妙蛙种子固定路线缺少与当前官方来源匹配的受审阶段表；保留选择，不改为动态路线'};
  const stageIds=definition.stages.flatMap(stage=>stage.targetIds),targetIds=targets.map(target=>target.id);
  if(new Set(stageIds).size!==stageIds.length||new Set(targetIds).size!==targetIds.length||stageIds.length!==targetIds.length||
      stageIds.some(id=>!targetIds.includes(id)))
    return {...base,status:'waiting',code:'character-route-target-set-mismatch',message:'固定路线阶段与当前完整角色目录不一致；缺失、重复或新增目标均需重新审阅，不能按残存目录判定完成'};
  if(options.confirmed===false)return {...base,status:'waiting',message:'等待原生已保存进度，不能用局内估计推进固定阶段'};
  if(!counts.remaining)return {...base,status:'complete',route:{id:'bulbasaur',complete:true,stageId:null,stageIndex:definition.stages.length,stageCount:definition.stages.length},message:'79个可玩角色均已由原生已保存联盟记录确认，固定路线完成'};
  const stage=definition.stages.find(stage=>!goalPredicate(stage.completion,profile,catalog).done);
  if(!stage)return {...base,status:'waiting',message:'阶段表与尚未拥有的角色不一致，等待重新审阅，未按残存子集判定完成'};
  const byId=new Map(goalList(catalog.targets).map(target=>[target.id,target])),owned=id=>goalHas(profile,'league',id),
    counterNeeded=condition=>{const source=targets.find(target=>goalList(target.requirements).some(row=>row.kind==='counter'&&row.counter===condition.counter&&row.goal===condition.goal));
      return !source||!goalPredicate(source.completion,profile,catalog).done&&!goalPredicate(condition,profile,catalog).done;},
    incomplete=step=>step.targetIds.some(id=>!byId.has(id)||!goalPredicate(byId.get(id).completion,profile,catalog).done)||goalList(step.counterTargets).some(counterNeeded),
    step=stage.steps.find(incomplete)||stage.steps[0],remaining=stage.targetIds.filter(id=>!byId.has(id)||!goalPredicate(byId.get(id).completion,profile,catalog).done),
    route={id:'bulbasaur',name:definition.name,stageId:stage.id,stageName:stage.name,substepId:step.id,stageIndex:definition.stages.indexOf(stage),stageCount:definition.stages.length,
      stageTargetIds:[...stage.targetIds],remainingTargetIds:remaining,completionPredicates:goalClone(stage.completion),sourceHash:definition.sourceHash};
  base.route=route;
  let actor=step.actor;
  if(step.captureActor&&step.targetIds.every(id=>byId.has(id)&&goalRequirements(byId.get(id),profile).every(condition=>goalPredicate(condition,profile,catalog).done)))actor=step.captureActor;
  if(!owned(actor))actor=goalList(step.fallbackActors).find(owned);
  if(!actor)return {...base,status:'waiting',code:'character-route-actor-prerequisite',message:`阶段${stage.id}所需的固定角色尚未由保存记录确认；保留同阶段，不借额外角色改变主线`};
  if(step.rotationCounter&&!goalPredicate({kind:'counter',...step.rotationCounter},profile,catalog).done){
    if(!Array.isArray(profile.played))return {...base,status:'waiting',code:'character-route-played-unknown',message:'固定轮换阶段尚未读取已保存出战角色列表；不靠局内或进程顺序重复计数'};
    actor=goalList(step.rotationActors).find(id=>owned(id)&&!goalHas(profile,'played',id));
    if(!actor)return {...base,status:'waiting',code:'character-route-played-receipt',message:'固定轮换名单均已游玩，但原生保存的不同出战角色数仍未达标；等待保存同步，不重复刷同一角色冒充新种类'};
  }
  const routeOptions={...options,characterRoute:'auto',characterUnlockMode:false,characterId:actor,
    // Choosing this complete fixed route authorizes runtime role/build setup;
    // it never rewrites saved preferences or relaxes native/input permissions.
    bannedMoveKeys:undefined,allowedMoveKeys:undefined,moveConstraintsBySpecies:undefined,
    routeConstraints:{biome:step.biome,tier:step.tier}},resolve=goalResolver(profile,catalog,routeOptions).resolve,
    pendingCounter=goalList(step.counterTargets).find(counterNeeded),hints=actor===step.actor?goalClone(step.buildHints):
      {preferredMoves:rules.actors.find(row=>row.id===actor)?.moves.filter(move=>move.routes.some(route=>route.kind==='kit'&&route.speciesId===actor)).map(move=>move.key).slice(0,4)||[]};
  const decorate=(plan,mode='standard',selectedActor=actor)=>{
    const result={...base,...plan,route,status:plan.ready?'ready':plan.status || 'waiting'};if(!result.action)return result;
    const a=result.action;if(!['pursue-counter','capture','encounter','win-map','farm-resources'].includes(a.kind))return result;
    const selectedHints=selectedActor===actor?hints:{preferredMoves:rules.actors.find(row=>row.id===selectedActor)?.moves.filter(move=>move.routes.some(route=>route.kind==='kit'&&route.speciesId===selectedActor)).map(move=>move.key).slice(0,4)||[]};
    let execution=a.unlockExecution || characterFocusExecution(profile,catalog,{...routeOptions,characterId:selectedActor},{...result,targetId:result.targetId});
    if(!execution)execution={schemaVersion:1,conditions:[],focusCounters:[],preferenceHints:selectedHints,naturalEnd:false};
    const candidate=execution.actorCandidates?.find(row=>row.id===selectedActor),preferred={...execution.preferenceHints,...selectedHints},
      actorCapability=characterUnlockActorCapabilities(rules,goalList(profile.league).map(Number)).find(row=>row.id===selectedActor),
      map=rules.maps.find(row=>row.id===(a.biome || execution.biome || step.biome)),
      foresight=actorCapability&&map?characterForesight(profile,catalog,{...actorCapability,moves:actorCapability.moves.filter(move=>preferred.preferredMoves?.includes(move.key))},map,remaining):null;
    execution={...execution,...(candidate?{conditions:candidate.conditions,focusCounters:candidate.focusCounters,preferenceHints:{...candidate.preferenceHints,...selectedHints}}:{}),
      kind:'character-route',route,mode,foresight,completionPolicy:a.kind==='pursue-counter'&&(candidate?.conditions || execution.conditions)?.length?'finish-when-live-goals-met':undefined,biome:a.biome || execution.biome || step.biome,tier:a.tier ?? execution.tier ?? step.tier,
      actorCandidates:[{id:selectedActor,score:1,reason:`固定路线${stage.id}/${step.id}指定角色；额外已有角色不改变主线`,conditions:candidate?.conditions || execution.conditions,
        preferenceHints:preferred,focusCounters:candidate?.focusCounters || execution.focusCounters,benefitTargetIds:remaining,foresight}],preferenceHints:preferred,
      reason:`${stage.name}：${step.operation}`,naturalEnd:mode==='endless',
      finishPolicy:mode==='endless'?'natural-end':(candidate?.conditions || execution.conditions)?.some(condition=>condition.canProgressBeforeFinalBoss===true)?'conditions-before-final-boss':undefined};
    result.action={...a,mode,biome:execution.biome,tier:execution.tier,characterId:selectedActor,unlockExecution:execution};result.message=execution.reason+(plan.message?'；'+plan.message:'');return result;
  };
  for(const id of [...goalList(stage.prerequisiteTargetIds),...goalList(step.prerequisiteTargetIds)]){
    const target=byId.get(id);if(!target)return {...base,status:'waiting',message:'固定路线前置定义缺失：'+id};if(goalPredicate(target.completion,profile,catalog).done)continue;
    const plan=goalResolver(profile,catalog,{...routeOptions,routeConstraints:undefined}).resolve(id);
    const prerequisiteActor=step.prerequisiteActor || stage.prerequisiteActor;
    return decorate({...plan,targetId:id},'standard',owned(prerequisiteActor)?prerequisiteActor:actor);
  }
  const scope=step.targetIds.filter(id=>byId.has(id)),counterTargets=goalList(step.counterTargets).filter(counterNeeded);
  if(step.modePolicy!=='standard'){
    const batch=planCharacterUnlockBatch(profile,catalog,{...routeOptions,targetIds:scope,counterTargets});
    if(batch?.action)return decorate(batch,batch.action.mode);
  }
  if(step.rotationCounter&&!goalPredicate({kind:'counter',...step.rotationCounter},profile,catalog).done)return decorate({ready:true,targetId:scope[0],stepId:'counter:'+step.rotationCounter.counter,
    action:{kind:'pursue-counter',counter:step.rotationCounter.counter,goal:step.rotationCounter.goal},chain:[],message:'按固定名单完成下一名尚未游玩角色，真实保存后重新检查'},'standard');
  if(pendingCounter)return decorate({ready:true,targetId:targets.find(target=>goalList(target.requirements).some(row=>row.counter===pendingCounter.counter&&row.goal===pendingCounter.goal))?.id,
    stepId:'counter:'+pendingCounter.counter,action:{kind:'pursue-counter',counter:pendingCounter.counter,goal:pendingCounter.goal,singleRun:pendingCounter.counter.startsWith('best_')},chain:[],message:'补足后续神鸟所需的真实单局计数，保存后仍回到本固定阶段检查'},'standard');
  const targetId=scope.find(id=>!goalPredicate(byId.get(id).completion,profile,catalog).done);
  if(!targetId)return {...base,status:'waiting',message:'本阶段仍有未满足的保存条件，等待同步；没有猜测阶段已完成'};
  const plan=resolve(targetId);return decorate({...plan,targetId},'standard');
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

export function evaluateUnlockCondition(condition, profile = {}, catalog = {}) {
  return goalPredicate(condition, profile, catalog);
}

const conditionMetricNames = { birds:"三神鸟加入联盟", league:"不同联盟成员（不含梦幻）", "@league":"不同联盟成员", "@seen":"已见图鉴", "@shinies":"不同异色收藏", "@items":"永久道具收藏", "@hard":"困难通关地图", "@night":"噩梦通关地图", "@champ":"取得冠军奖牌的地图", "@legs":"遇到传说宝可梦的地图", "@fossils":"不同化石", runs:"完成对局", evolutions:"进化次数", kills:"击败敌人", runKills:"单局击败敌人", crits:"暴击次数", paralyzed:"施加麻痹", rainKills:"雨天击败敌人", dodges:"原生闪避判定次数", healed:"实际治疗量", alphas:"击败精英", ultimates:"施放终极技能", burned:"施加灼伤", slept:"施加睡眠", poisoned:"施加中毒", confused:"施加混乱", rocks:"击碎岩石", gold:"获得金币", soaked:"施加浸湿", bosses:"击败首领", maxLevel:"最高等级", level:"单局等级", maxTime:"最长存活秒数", time:"单局存活秒数", frozen:"施加冰冻", win_forest:"青翠森林通关次数", reactions:"属性反应次数", chests:"打开宝箱", berries:"拾取果实", boss_desert:"击败沙漠首领", speciesPlayed:"不同出战角色", alphaCaught:"捕获精英", kills_desert:"沙漠击败敌人", legendaries:"传说宝可梦次数", captures:"成功捕获次数", wins:"胜利次数", playtime:"累计游戏秒数", shinies:"异色捕获次数", tasks:"完成委托", mapsWon:"通关地图数量", stage:"单局区域" };
const conditionMapName = id => ({forest:"青翠森林",desert:"岩石沙漠",coast:"风暴海岸",glacier:"天空冰川",graveyard:"紫苑塔",volcano:"火山"})[id] || id;
const conditionTypeName = id => ({normal:"一般",fire:"火",water:"水",grass:"草",electric:"电",ice:"冰",fighting:"格斗",poison:"毒",ground:"地面",flying:"飞行",psychic:"超能力",bug:"虫",rock:"岩石",ghost:"幽灵",dragon:"龙",dark:"恶",steel:"钢",fairy:"妖精"})[id] || id;

/** A read-only explanation of the actual predicate, including unknown states. */
export function describeUnlockCondition(condition, profile = {}, catalog = {}, options = {}, visiting = new Set()) {
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
    if(c.damageShare)add(`伤害占比硬条件：${c.damageShare.key} 至少占结算时当前招式正伤害之和的 ${Math.round(c.damageShare.min*100)}%；不以全部来源总伤害为分母，${c.damageShare.includeFusionParents===true?"当前原生规则将同名招式和包含该原料的融合招式正伤害合并计入分子，每个融合招式只计一次":"同名多槽按原生第一条同名记录取分子，其他同名槽仍计入分母"}。`);
    if(c.finalSpecies?.length)add('结算形态硬条件：'+c.finalSpecies.map(id=>speciesName(id)+'（#'+id+'）').join('、')+'；进化后的实际 finalSpecies 为准，不以开局角色代替。');
    if(c.maxFinalSpecies!=null)add(c.finalSpeciesAtClear===true?
      `击败最终首领瞬间的物种编号必须 ≤ ${c.maxFinalSpecies}；缺少该记录时沿用原生结算形态。首领经验造成的后续进化不会推翻当时已满足的条件。`:
      `结算形态硬条件：原生最终物种编号必须 ≤ ${c.maxFinalSpecies}，按该挑战的实际数值判定，不用“没有超过某进化阶段”的文字猜测代替。`);
    if(c.minTime!=null)add(`结算游戏时间必须 ${c.minTimeInclusive ? '≥' : '>'} ${c.minTime} 秒；暂停或现实等待时间不计入游戏时间。`);
    if(c.initialSpeciesHold)add(`起始角色须为 ${speciesName(c.initialSpeciesHold.species)}（#${c.initialSpeciesHold.species}），首次进化前须保留至少 ${c.initialSpeciesHold.seconds} 秒；达到后可正常进化，按原生本局保形时长及保存计数确认。提前进化后不会强退健康对局，正常保存后再尝试。`);
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
    if (constraints.finalSpecies || constraints.maxFinalSpecies || constraints.initialSpeciesHold)
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
  if (["event-not-live","event-claim-closed","mutation-wait-next-day","mutation-native-grant-pending","mutation-native-entry-blocked"].includes(eventStep?.code)) return "native";
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

function goalMutationStep(target, profile, catalog, options = {}) {
  const action=target.action;if(!['play-mutation','derive-mutation-title'].includes(action?.kind))return null;
  const waiting=(code,message)=>({ready:false,action:null,stepId:null,chain:[target.id],code,message,cost:Infinity}),
    rules=catalog.rules?.mutation;
  if(rules?.schemaVersion!==1||rules.nativeAuthority!==true||rules.sourceHash!==catalog.sourceHash)
    return waiting('mutation-contract-unknown','每日变异奖励尚未绑定当前受审原生定义，保留目标等待资料');
  if(action.kind==='derive-mutation-title'){
    const banners=goalList(rules.allBannerIds);
    if(banners.length&&banners.every(key=>goalHas(profile,'cosmetics',key)))
      return waiting('mutation-native-grant-pending','四种变异通关奖励已经保存；等待原生自动发放并核验总称号，不调用不存在的领奖接口');
    return null; // The ordinary dependency resolver selects today's missing banner.
  }
  const goal=action.mutationGoal,definition=goalList(rules.rewards).find(row=>row.id===goal?.cosmetic),
    variant=goalList(rules.variants).find(row=>row.id===goal?.variantId);
  if(goal?.schemaVersion!==1||goal.sourceHash!==catalog.sourceHash||!definition||!variant||
      definition.variantId!==goal.variantId||definition.progress!==goal.progress||
      target.completion?.kind!=='owned'||target.completion.field!=='cosmetics'||target.completion.value!==goal.cosmetic)
    return waiting('mutation-contract-unknown','每日变异目标与原生奖励门槛不一致，不猜测已拥有或可领取');
  const state=options.mutation??catalog.mutation,currentVariant=state?.variantId??state?.mutation?.id,
    tier=state?.tier??state?.mutation?.tier;
  if(state?.nativeAuthority!==true||state.sourceHash!==catalog.sourceHash||!Number.isInteger(state.day)||
      !goalList(rules.variants).some(row=>row.id===currentVariant)||!Number.isInteger(tier)||![0,1,2].includes(tier)||
      !Number.isFinite(state.ends)||typeof state.biome!=='string'||!goalList(catalog.targets).some(row=>row.id==='maps:'+state.biome))
    return waiting('mutation-state-unknown','等待当前原生每日变异日程；不按本机日期、旧局数据或普通模式伪造变种');
  if(currentVariant!==goal.variantId)return waiting('mutation-wait-next-day','目标是“'+variant.name+'”，当前原生轮换为其它变种；保留目标，下一次日程变化后重新核对');
  if(tier!==variant.tier)return waiting('mutation-state-unknown','当前原生变种难度与受审规则不一致，等待日程重新核验');
  if(state.allowed===false)return waiting('mutation-native-entry-blocked','当前原生每日变异入口暂不可用，保留目标等待正常资格');
  return {ready:true,stepId:target.id,chain:[target.id],cost:2,action:{...goalClone(action),mode:'mutation',biome:state.biome,tier,
      mutationGoal:{...goalClone(goal),day:state.day,ends:state.ends}},
    message:target.acquisition+' 当前原生变种与目标相符；只在正常保存的 cosmetics 返回后判断完成。'};
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
      if (condition.field === "cosmetics" && /^look:\d+:[12567]$/.test(String(condition.value))) {
        const [,member,level] = String(condition.value).split(":"), questId = `achievements:lk${member}_${level}`;
        if (goalPredicate(byId.get(questId)?.completion,profile,catalog).done)
          return blocked("原生专属挑战已领取，但尚未读取对应外观的 cosmetics 保存回执；请重新读取原生存档后核对，不以已装备 skins 代替拥有",[],"look-receipt-missing");
        return resolve(questId,path);
      }
      if (condition.field === "cosmetics" && byId.has("appearance:"+condition.value)) return resolve("appearance:"+condition.value,path);
    }
    if (condition.kind === "counter" && condition.counter === "birds") {
      return best([144, 145, 146].filter(id => !goalHas(profile, "league", id)).map(id => resolve("characters:" + id, path))) || blocked("尚未确认可推进的三鸟解锁路线");
    }
    if (condition.kind === "counter" && ["league", "@league"].includes(condition.counter)) {
      return best([...byId.values()].filter(target => target.category === "characters" && (condition.counter === "@league" || Number(target.nativeId ?? target.key) !== 151) &&
        !goalPredicate(target.completion, profile, catalog).done && goalRequirements(target).filter(part => part.kind === "counter" && ["league", "birds"].includes(part.counter))
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
      const appearanceCounting=appearanceMasteryRoute(mastery,options,requestedTier),selectedMode=appearanceCounting?.mode||mastery.mode||'standard',
        route={member:mastery.member,metric:mastery.metric,mode:selectedMode,tier:selectedMode === 'endless' ? 0 : tier,
        biome:map.key || map.id.slice(5),singleRun:mastery.singleRun === true,
        ...(typeof mastery.allowCoop==='boolean'?{allowCoop:mastery.allowCoop}:{}),
        ...(Object.keys(mastery.constraints).length ? {constraints:goalClone(mastery.constraints)} : {}),
        ...(nextBit ? {requiredBit:nextBit.bit,savedBits:mask} : {})};
      return {ready:true,stepId:"counter:"+condition.counter,action:{kind:"pursue-counter",counter:condition.counter,goal:condition.goal,
        mastery:route,...(appearanceCounting?{appearanceCounting}:{}),
        ...(normalFinishMasteryMetrics.has(route.metric)&&!definition.bitTargets&&appearanceCounting?.settleOnGoal!==false?{normalFinishGoal:{schemaVersion:1,kind:'reviewed-mastery',requiresVictory:false,
          member:route.member,level:Number(condition.counter.split(':')[2]),counter:condition.counter,goal:condition.goal,saved:unlockCounterValue(profile,condition.counter),metric:route.metric,singleRun:route.singleRun,
          mode:route.mode,biome:route.biome,tier:route.tier,...(typeof route.allowCoop==='boolean'?{allowCoop:route.allowCoop}:{}),constraints:goalClone(route.constraints||{}),sourceHash:catalog.sourceHash}}:{}),
        mode:route.mode,biome:route.biome,tier:route.tier,label:condition.label},progressCondition:goalClone(condition),chain:[],cost:3,
        message:`使用指定联盟角色 #${mastery.member}，按原生要求积累：${condition.label || condition.description}；仅以已保存的专属挑战计数 ${progress.value}/${progress.goal} 确认进度，不用全局同类计数替代`+
          (appearanceCounting?'；'+appearanceCounting.reason+(appearanceCounting.settleOnGoal?'；已知本局数量目标达标后正常放弃结算，成功保存后再领取或切换目标':'；已关闭数量达标提前结算，继续正常游玩至自然结束或死亡'):'')};
    }
    if (condition.kind === "counter" && /^lk:\d+:[12567]$/.test(String(condition.counter)))
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
    const eventStep = goalEventStep(target, profile, catalog, options)||goalMutationStep(target,profile,catalog,options);
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
    const eventStep = goalEventStep(target, profile, catalog, options)||goalMutationStep(target,profile,catalog,options),qualification=target.action?.qualification,
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
  if(requestedId==='auto'&&(category==='characters'||options.characterUnlockMode===true)){
    const batchPlan=planCharacterUnlockBatch(profile,catalog,options);
    if(batchPlan?.prerequisiteTargetId){const step=resolve(batchPlan.prerequisiteTargetId);
      if(step.ready)return {...base,requestedComplete,targetId:batchPlan.benefitTargetIds[0],...step,status:'ready',message:batchPlan.reason+'；'+step.message};
    }else if(batchPlan)return {...base,requestedComplete,...batchPlan,status:'ready'};
  }
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
  const fixedPlan=(options.category==='characters'||options.characterUnlockMode===true)&&options.characterRoute==='bulbasaur'?
    planFixedCharacterUnlockRoute(profile,catalog,options):null,
    initialPlan = fixedPlan || selectUnlockGoalRaw(profile, catalog, options,batch),initialExecution=characterFocusExecution(profile,catalog,options,initialPlan),
    rawPlan = !fixedPlan&&!initialExecution?characterCapabilityPrerequisite(profile,catalog,options,initialPlan)||initialPlan:initialPlan,
    execution=rawPlan===initialPlan?initialExecution:characterFocusExecution(profile,catalog,options,rawPlan),
    plan=execution?{...rawPlan,action:{...rawPlan.action,mode:execution.mode,biome:execution.biome,tier:execution.tier,unlockExecution:execution}}:rawPlan;
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

export function selectUnlockGoal(profile = {}, catalog = {}, options = {}) {
  return selectUnlockGoalInternal(profile,catalog,options);
}

/**
 * Reuse one immutable saved-profile/catalog snapshot during a synchronous
 * planning batch. Explicit selections return only their requested label;
 * counts and automatic selection still cover every in-scope target. Nothing
 * is retained globally or across planner calls. Dispose when the batch ends.
 */
export function createUnlockGoalSelector(profile = {}, catalog = {}, sharedOptions = {}) {
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

export function updateUnlockProgress(previous, profile, catalog, options = {}) {
  return selectUnlockGoal(profile, catalog, { ...options, previous });
}

/** Merge the offline audited graph with changing public definitions only. */
export function buildUnlockCatalog(bridge = {}, offline = {}, options = {}) {
  const targets = new Map(goalList(offline.targets).filter(target => goalId(target?.id)).map(target => [target.id, goalClone(target)]));
  const library=getGameLibrary(bridge);
  const name = id => library.speciesName(id);
  const put = target => targets.set(target.id, { ...(targets.get(target.id) || {}), ...target });
  for (const member of goalList(bridge.roster)) {
    const challenge = goalList(Array.isArray(member.challenge) ? member.challenge : member.challenge ? [member.challenge] : []);
    put({ id: "characters:" + member.id, category: "characters", key: String(member.id), nativeId: member.id, name: name(member.id),
      acquisition: "完成全部原生挑战后，正常削弱并捕获联盟遭遇；遭遇具有随机性。", completion: { kind: "owned", field: "league", value: member.id },
      requirements: challenge.map(part => ({ kind: "counter", counter: part.counter, goal: part.goal, label: part.desc })),
      action: { kind: "capture", species: member.id, sourceKind: member.id === 150 ? "mewtwo-event" : "league-encounter", mode: "standard" },
      sources: goalList(targets.get("characters:" + member.id)?.sources).length ? targets.get("characters:" + member.id).sources :
        [{ kind: member.id === 150 ? "mewtwo-event" : "league-encounter", requiresLeagueReady: true, requiresLeagueUnowned: true,
          ...(member.id === 150 ? { stage: 2 } : {}) }], executable: challenge.length > 0 });
  }
  for (const [index, biome] of goalList(bridge.biomes).entries()) {
    let live = biome.live !== false;
    try { if (typeof bridge.biomeLive === "function") live &&= !!bridge.biomeLive(biome.id); } catch { live = false; }
    const previous = bridge.biomes[index - 1];
    const stageCount=Object.hasOwn(biome,'sanctuary') ? biome.sanctuary ? 4 : 3 : targets.get('maps:'+biome.id)?.nativeStageCount ?? null;
    put({ id: "maps:" + biome.id, category: "maps", key: biome.id, name: biome.name || biome.id,
      nativeStageCount:stageCount,championTimeLimits:[0,1,2].map(tier=>reviewedChampionTimeLimit(stageCount,tier)),
      completion: { kind: "map-tier", biome: biome.id, goal: 0 }, requirements: previous ? [{ kind: "map-tier", biome: previous.id, goal: 1 }] : [],
      action: previous ? { kind: "win-map", biome: previous.id, tier: 0 } : { kind: "manual" },
      availability: { state: live ? "available" : "future", reason: live ? "原生已开放，仍需账号解锁" : "目录存在但原生当前未开放" }, executable: live });
    for (let clear = 1; clear <= 3; clear++) put({ id: "maps:" + biome.id + ":clear:" + clear, category: "maps", key: biome.id + ":clear:" + clear,
      name: (biome.name || biome.id) + " · " + ["普通", "困难", "噩梦"][clear - 1] + "通关", completion: { kind: "map-tier", biome: biome.id, goal: clear },
      requirements: [{ kind: "map-tier", biome: biome.id, goal: clear - 1 }], action: { kind: "win-map", biome: biome.id, tier: clear - 1 },
      availability: { state: live ? "available" : "future" }, executable: live });
  }
  for (const lab of goalList(bridge.lab)) {
    const costs = Array.from({ length: Math.max(0, Math.trunc(lab.max || 0)) }, (_, level) => {
      try { return typeof lab.cost === "function" ? lab.cost(level) : lab.costs?.[level]; } catch { return null; }
    });
    put({ id: "lab:" + lab.id, category: "lab", key: lab.id, name: lab.name || lab.id, costs,
      completion: { kind: "lab-level", key: lab.id, goal: lab.max }, requirements: [], action: { kind: "buy-lab", key: lab.id }, executable: costs.every(cost => Number.isFinite(cost) && cost >= 0) });
  }
  return { schemaVersion: 1, gameVersion: offline.gameVersion || null, sourceHash: bridge.compatibility?.sourceHash || offline.sourceHash || "",
    categories: goalClone(unlockGoalCategories).map(category => category.id === "events" ? {...category,internal:true,
      modes:goalList(offline.eventModes).filter(mode => typeof mode?.id === "string" && mode.id !== "events").map(mode => mode.id)
        .filter((id,index,ids) => ids.indexOf(id) === index).concat(goalList(offline.eventModes).length ? [] : ["tower"])} : category),
    targets: [...targets.values()], provenance: offline.provenance || null,rules:goalClone(offline.rules || {}),
    pokemonIds: goalList(bridge.data?.pokemon).map(entry => entry.id).filter(Number.isInteger).length ? goalList(bridge.data?.pokemon).map(entry => entry.id).filter(Number.isInteger) : goalList(offline.pokemonIds),
    eventModes: goalClone(goalList(offline.eventModes)),
    events: goalList(options.events).map(event => ({ id: event.id ?? event.key, mode: event.mode,
      live: typeof event.live === "boolean" ? event.live : null, claimable: typeof event.claimable === "boolean" ? event.claimable : null })) };
}
