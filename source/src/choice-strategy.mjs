import { evaluateOfferBenefit, itemPriority, compareOfferCandidates, offerUtilityTier, conditionalItemBenefit, evaluateItemDecision, evaluateShopPurchases, canSpendGold, towerLuckTiming, itemExperiencePriority, offerExperiencePriority, scoreOffer, scoreMods, masteryOfferAllowed, decisionPlayer, costEffectCatalog,
  costDescriptor, costOfferDescriptor, nativeCostDescriptor, costPriorityRank,
  costPositiveScore, compareCostChoices, characterEvasionItemPriority } from "./policy.mjs";
import { normalizeFinalMoveSection, finalEmptySlot, resolveFinalReplacementEntry } from "./custom-plans.mjs";
import { sharedRandomMoveLimit } from "./game-library.mjs";
import { applyTowerStrategy } from "./tower-strategy.mjs";

export function normalizeCostSettings(raw = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) raw = {};
  const allowed = new Set(costEffectCatalog.map(effect => effect.id));
  return {
    forceCostInteractions: raw.forceCostInteractions === true,
    costEffectPriorities: Array.from({ length: 10 }, (_, index) => {
      const value = Array.isArray(raw.costEffectPriorities) ? raw.costEffectPriorities[index] : "";
      return typeof value === "string" && allowed.has(value) ? value : "";
    }),
  };
}

// Pure decisions over current native offers. The caller re-evaluates before an
// actual click, supplies native legality/counters, and commits nextHistory only
// after that action executes. No timers, game mutations, or invented drop odds.
function choiceDefinition(data, id) {
  const raw =
    data.moves?.get?.(id) ||
    data.data?.moves?.get?.(id) ||
    data.movesByKey?.get?.(id) ||
    data.data?.movesByKey?.get?.(id);
  // Native movesByKey contains ordinary moves only. Fusion names live in a
  // separate recipe table and moveDef resolves its bounded numeric IDs. Do
  // not insert aliases into the native map or mistake a real fusion target
  // for an unknown ordinary move merely because that map has no such key.
  if (!raw && typeof id === "string" && Array.isArray(data.fusionRecipes)) {
    for (let index = 0; index < Math.min(256, data.fusionRecipes.length); index++) {
      if (data.fusionRecipes[index]?.key !== id) continue;
      const numericId = 50000 + index;
      try {
        const definition = data.moveDef?.(numericId) || data.moves?.get?.(numericId) ||
          data.data?.moves?.get?.(numericId);
        return definition?.key === id && definition.arch === "fusion" && definition.id === numericId
          ? definition : {};
      } catch { return {}; }
    }
  }
  try {
    const definition=data.moveDef?.(raw?.id ?? id) || raw || {};
    // A string-only fallback cannot authorize an unregistered or out-of-range
    // fusion alias. The verified recipe/numeric path above owns that contract.
    return !raw&&typeof id==="string"&&definition.arch==="fusion"?{}:definition;
  } catch {
    return raw || {};
  }
}

export function characterUnlockMoveConstraints(stored={},build={},data={}) {
  const bannedMoveKeys=[...new Set((build.avoidMoves||[]).filter(key=>typeof key==='string'))];
  if(stored.strictMoves?.enabled!==true)return {allowedMoveKeys:build.sourceType==='custom'&&build.allowOffPlan===false?
    (build.moveRules||[]).filter(rule=>rule?.avoid!==true&&typeof rule?.key==='string').map(rule=>rule.key):null,bannedMoveKeys};
  const allowed=new Set(),defs=[...(data.data?.moves||data.moves||new Map()).values()]
    .filter(def=>def&&typeof def.key==='string'&&def.arch!=='fusion'),recipes=data.fusionRecipes||[];
  for(const key of stored.strictMoves.targets||[]){
    const def=choiceDefinition(data,key);
    if(!def.key)continue;
    if(def.arch!=='fusion'){allowed.add(def.key);continue;}
    const recipe=recipes.find(row=>row.key===key);
    for(const candidate of defs){
      const parent=recipe?.kind==='signature'?recipe.moves?.includes(candidate.key):
        recipe?.kind==='type'?candidate.type===recipe.type:recipe?.kind==='reaction'?
          recipe.pair?.some(types=>types.includes(candidate.type)):recipe?.kind==='glitch';
      if(parent)allowed.add(candidate.key);
    }
  }
  return {allowedMoveKeys:[...allowed],bannedMoveKeys:bannedMoveKeys.filter(key=>!allowed.has(key))};
}

function choiceMoveKey(move, data) {
  if (move == null) return null;
  if (typeof move === "object")
    return (
      move.def?.key ??
      move.key ??
      choiceDefinition(data, move.id).key ??
      move.id
    );
  return choiceDefinition(data, move).key ?? move;
}

// Every native vitamin stays in the automatic fallback ordering. A historical
// winning inventory is an observation, never a reason to ignore all others.
export const universalVitaminPriority = [
  "super-potion", "carbos", "iron", "hp-up", "ether", "protein", "calcium",
  "pp-up", "stardust", "max-potion", "zinc", "dire-hit", "x-defense",
  "x-attack", "exp-candy", "escape-rope", "elixir", "x-speed", "star-piece-v",
  "nugget", "sticky-barb", "enigma-berry", "poke-radar", "loaded-dice",
  "super-lure", "cursed",
];

export function completeVitaminPreferences(build = {}, data = {}) {
  const live = data.vitamins || data.data?.vitamins,
    definitions = live?.size ? [...live.entries()].map(([key,def])=>({...def,key:def.key || key})) : [],
    known = new Set(definitions.map(def => def.key)),
    observed = build.vitaminPriority || (build.vitamins || []).map(value =>
      typeof value === "string" ? value : value?.k || value?.key),
    preferred = Array.isArray(observed) ? observed : [],
    seen = new Set(), result = [];
  const append = key => {
    if (typeof key !== "string" || seen.has(key)) return;
    if (known.size && !known.has(key)) return;
    seen.add(key); result.push(key);
  };
  for (const key of preferred) {
    if (!known.size || known.has(key)) append(key);
    else for (const definition of definitions) if (definition.stat === key) append(definition.key);
  }
  for (const key of universalVitaminPriority) append(key);
  for (const definition of definitions) append(definition.key);
  return result;
}

export function choiceMovePreferences(build = {}) {
  const custom = build.sourceType === "custom";
  const rules = [...(Array.isArray(build.moveRules) ? build.moveRules : [])]
    .map((entry, index) => ({ ...entry, originalIndex: index }))
    .sort(
      (a, b) =>
        (Number(a.priority) || 0) - (Number(b.priority) || 0) ||
        a.originalIndex - b.originalIndex,
    );
  const avoid = new Set([
    ...(build.avoidMoves || []),
    ...rules.filter((entry) => entry.avoid).map((entry) => entry.key),
  ]);
  const order =
    custom && rules.length
      ? rules.filter((entry) => !entry.avoid).map((entry) => entry.key)
      : (build.moves || []).map((entry) => entry?.key ?? entry);
  const seen = new Set();
  const result = [];
  for (const key of order) {
    if (key == null || seen.has(key) || avoid.has(key)) continue;
    seen.add(key);
    const rule = rules.find((entry) => entry.key === key);
    result.push({
      key,
      rank: result.length,
      explicit: custom,
      priority: rule?.priority ?? result.length + 1,
      targetLevel: rule?.targetLevel ?? null,
    });
    if (!custom && result.length >= 4) break;
  }
  return result;
}

// Complete a strategy, never a historical battle record. Raw observed moves
// stay separate from inferred native alternatives and no result/stat flag is
// promoted to a new validation claim. Custom plans remain entirely user-owned.
export function completeMovePreferences(build = {}, data = {}, options = {}) {
  const cloneMove = (move) =>
    move && typeof move === "object" ? { ...move } : move;
  const originalMoves = Array.isArray(build.moves) ? build.moves : [];
  const observed = Array.isArray(build.observedMoves)
    ? build.observedMoves
    : originalMoves;
  const result = { ...build, moves: originalMoves.map(cloneMove) };
  if (build.sourceType === "custom") {
    if (Array.isArray(build.observedMoves))
      result.observedMoves = build.observedMoves.map(cloneMove);
    result.movePreferenceCompletion = {
      status: "custom-user-defined",
      recommendedCount: choiceMovePreferences(build).length,
      inferredCount: 0,
    };
    return result;
  }
  const observedKeys = new Set(
    observed.map((move) => choiceMoveKey(move, data)),
  );
  const avoid = new Set([
    ...(build.avoidMoves || []),
    ...(build.unavailableMoves || []),
    ...(build.moveRules || [])
      .filter((rule) => rule.avoid)
      .map((rule) => rule.key),
  ]);
  const preferences = [],
    sources = [],
    seen = new Set();
  const append = (rawKey, source, details = {}, native = false) => {
    if (preferences.length >= 4) return;
    const key = choiceMoveKey(rawKey, data);
    if (typeof key !== "string" || !key || seen.has(key) || avoid.has(key))
      return;
    const definition = choiceDefinition(data, key);
    if (native && definition.key !== key) return;
    seen.add(key);
    preferences.push(key);
    sources.push({
      key,
      source,
      observed: observedKeys.has(key),
      requiredLevel: null,
      ...details,
    });
  };
  for (const move of originalMoves) {
    const key = choiceMoveKey(move, data);
    const previous = build.moveRecommendationSources?.find(
      (entry) => entry.key === key,
    );
    append(
      move,
      observedKeys.has(key)
        ? "observed-build"
        : previous?.source || "inferred-existing-preference",
      previous ? { requiredLevel: previous.requiredLevel ?? null } : {},
    );
  }
  const species =
    typeof options.species === "object" ? options.species?.id : options.species;
  const suppliedRoster = options.roster;
  const roster =
    suppliedRoster &&
    (suppliedRoster.id == null || suppliedRoster.id === species)
      ? suppliedRoster
      : data.roster?.find?.((entry) => entry.id === species);
  for (const key of roster?.kit || [])
    append(key, "native-roster-kit", { requiredLevel: null }, true);
  const guide = options.guide;
  if (guide && (guide.speciesId == null || guide.speciesId === species)) {
    for (const group of ["kit", "line", "shared", "any"])
      for (const entry of guide[group] || []) {
        if (
          entry.open === false ||
          entry.available === false ||
          entry.locked === true ||
          (group === "shared" && entry.open !== true)
        )
          continue;
        const rawLevel = Number(
          entry.level ?? entry.requiredLevel ?? entry.minLevel,
        );
        append(
          entry.key ?? entry.id,
          `native-guide-${group}`,
          { requiredLevel: Number.isFinite(rawLevel) ? rawLevel : null },
          true,
        );
      }
  }
  result.moves = preferences;
  result.observedMoves = observed.map(cloneMove);
  result.moveRecommendationSources = sources;
  const inferredCount = sources.filter((entry) => !entry.observed).length;
  result.movePreferenceCompletion = {
    status:
      preferences.length < 4
        ? "partial-native-candidates"
        : inferredCount
          ? "observed-plus-native-supplement"
          : "observed-preferences",
    species: species ?? null,
    observedCount: observed.length,
    inferredCount,
    recommendedCount: preferences.length,
    claim:
      "strategy-preferences-only; inferred moves are not an observed victory loadout or a current unlock guarantee",
  };
  return result;
}

function choiceSlotState(player) {
  const native = Number(player.moveSlots);
  const slots = Number.isInteger(native) && native > 0 ? native : 3;
  const moves = (player.moves || []).slice(0, slots).filter(Boolean);
  return { slots, moves, freeSlots: Math.max(0, slots - moves.length) };
}

function finalFusionTargets(configured, held, maximum, additional) {
  const selected=[...new Set(configured.filter(Boolean))];
  if(!additional)return configured.filter(Boolean);
  // Legacy optional expansion helper. Current user-facing callers disable this
  // branch: explicit final-target multiplicity now determines the copy count.
  // Consumed parent IDs still constrain the original planner.
  const targets=held.filter(row=>row.move.def?.arch==="fusion"&&selected.includes(row.key)).map(row=>row.key);
  // Candidate instances are separate from coexistence capacity. In particular,
  // held A plus currently blocked B/C/D must still consider another legal A.
  const capacity=Math.max(0,maximum-targets.length);
  for(const key of selected)for(let index=0;index<capacity;index++)targets.push(key);
  for(const key of selected)if(!targets.includes(key))targets.push(key);
  return targets;
}
function finalFusionPlan(raw, player, nativeRun, data, held, slots, options = {}) {
  const seen = new Set(), configured = Array.from({length:4}, (_, index) => {
    const key = raw?.targets?.[index];
    if (typeof key !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:+-]{0,99}$/.test(key) || seen.has(key) && raw?.allowRepeated !== true) return null;
    seen.add(key); return key;
  }), maximum = raw?.unified===true?3:Math.max(0, slots - 1), targets = raw?.unified===true?configured.filter(Boolean):finalFusionTargets(configured,held,maximum,raw?.allowAdditional===true),
    level = typeof raw?.level === "number" && Number.isFinite(raw.level) ? Math.max(1,Math.min(999999,Math.trunc(raw.level))) : 30,
    enabled = raw?.enabled === true && targets.length > 0,
    active = enabled && Number(player.level) >= level,
    remaining = new Map(targets.map(key=>[key,targets.filter(value=>value===key).length])),
    completed = held.filter(row => {
      if(row.slot===raw?.goalRetireSlot)return false;
      if(row.move.def?.arch !== "fusion" || !(remaining.get(row.key)>0))return false;
      remaining.set(row.key,remaining.get(row.key)-1); return true;
    }),
    missing = targets.filter(key => {
      if(!(remaining.get(key)>0))return false;
      remaining.set(key,remaining.get(key)-1);return true;
    }),
    protectedSlots = held.filter(row=>row.move.def?.arch === "fusion" && targets.includes(row.key)).map(row=>row.slot),
    wrongFusions = held.filter(row=>row.move.def?.arch==="fusion" && !protectedSlots.includes(row.slot)),
    ordinaryRandom = held.filter(row=>row.move.def?.arch==="random"),
    base = {enabled,active,level,targets:raw?.allowAdditional===true?[...new Set(configured.filter(Boolean))]:targets,
      continuous:raw?.allowAdditional===true,configuredTargets:configured,maximum,
      ignoredTargets:[],completed:completed.map(row=>row.key),missing,
      protectedSlots,blocked:[],pending:null,assignments:[],reservedSlots:completed.length,
      search:{pairChecks:0,nodes:0,exhausted:false},phase:enabled?active?"complete":"threshold-wait":"disabled"};
  if (!active) return base;
  if(raw?.unified===true&&completed.length>=Math.max(0,slots-1)&&missing.length)
    return {...base,phase:"waiting-preparation-slots",blocked:missing.map(key=>({key,reason:"native-fusion-preparation-slots-unavailable"}))};
  if(missing.length&&completed.length>=maximum)
    return {...base,phase:"waiting-preparation-slots",blocked:missing.map(key=>({key,reason:"native-fusion-preparation-slots-unavailable"}))};
  if (!missing.length) return base;
  if (typeof data.fusionFor !== "function" || !Array.isArray(data.fusionRecipes))
    return {...base,phase:"blocked",blocked:missing.map(key=>({key,reason:"native-fusion-planning-unavailable"}))};
  const recipes = new Set(data.fusionRecipes.map(recipe=>recipe?.key).filter(Boolean)), definitions = new Map(),
    futureRows=[], nextEvo=nativeRun.nextEvo;
  // Only a verified next evolution can provide a future branch here. Do not
  // merge every global move or mutually exclusive evolution's learning pool.
  if(Number.isInteger(Number(nextEvo?.to)) && Number.isFinite(Number(nextEvo?.level)) && typeof data.moveGuide==="function") {
    try {
      const form=data.data?.get?.(Number(nextEvo.to)) || data.data?.byId?.get?.(Number(nextEvo.to)),
        guide=data.moveGuide(Number(nextEvo.to),player.roster,form?.types||player.types||[],id=>data.app?.meta?.inLeague?.(id)===true);
      for(const group of ["kit","line","shared","any"])for(const row of guide?.[group]||[])
        futureRows.push({...row,speciesId:Number(nextEvo.to),fusionRouteSource:group});
    } catch { /* Future metadata absence does not invent eligibility. */ }
  }
  const offers=nativeRun.tower ? (options.offers || []).filter(offer=>
    offer?.kind==="newMove" && offer.disabled!==true && offer.hidden!==true) : [],
    offeredKeys=new Set(offers.map(offer=>choiceMoveKey(offer.id,data))),
    guideRows=choiceGuideEntries({player},data,{moveAvailability:[...futureRows,
      ...offers.map(offer=>({id:offer.id,level:Number(player.level)||1,current:true}))]});
  for (const value of guideRows) {
    const def = choiceDefinition(data,value?.id ?? value?.key);
    if (typeof def.key==="string" && Number.isFinite(def.id) && typeof def.arch==="string" &&
        !["buff","weather","fusion"].includes(def.arch)) definitions.set(def.key,def);
  }
  for (const row of held) if (row.move.def?.key && !["buff","weather","fusion"].includes(row.move.def.arch)) definitions.set(row.key,row.move.def);
  const defs=[...definitions.values()], blocked=[...base.blocked];
  // Unwanted held fusions may legitimately be forgotten. Evaluate their
  // parents only after that removal, while retained desired fusions continue
  // to impose the native ownedMoveIds/parents exclusion. No native state is
  // changed by this speculative availability check.
  const virtualPlayer=Object.create(player);
  Object.defineProperties(virtualPlayer,{moves:{value:(player.moves||[]).map((move,slot)=>
    wrongFusions.some(row=>row.slot===slot)||ordinaryRandom.some(row=>row.slot===slot)?null:move)},
    moveSlots:{value:slots}});
  const readiness=analyzeMoveReadiness({player:virtualPlayer,nativeRun,
    build:{sourceType:"custom",moves:defs.map(def=>def.key)}},data,{moveAvailability:futureRows,offers}),
    byKey=new Map(readiness.map(row=>[row.key,row])),
    liveReadiness=analyzeMoveReadiness({player,nativeRun,build:{sourceType:"custom",moves:defs.map(def=>def.key)}},data,{moveAvailability:futureRows,offers}),
    liveByKey=new Map(liveReadiness.map(row=>[row.key,row])),
    candidates=new Map(missing.map(key=>[key,[]]));
  // Actual held random moves are still usable parents. Their speculative
  // unheld readiness remains available for any required forget/relearn order.
  for(const row of ordinaryRandom)byKey.set(row.key,{...byKey.get(row.key),key:row.key,state:"held",reason:"equipped-native-move"});
  const legalDefs=defs.filter(def=>["held","now","near","far"].includes(byKey.get(def.key)?.state)&&
    !(raw?.unified===true&&raw.preserveOrdinary?.includes(def.key))&&
    !raw.preserveCustom?.includes(def.key) &&
    !(raw.preserveOrdinary?.includes(def.key) &&
      (nativeRun.tower || completed.length>0&&held.some(row=>row.key===def.key))));
  const recipeByKey=new Map(data.fusionRecipes.map(recipe=>[recipe.key,recipe])),
    defByKey=new Map(legalDefs.map(def=>[def.key,def])),
    onlySharedRandom=def=> {
      if(def.arch!=="random")return false;
      const routes=guideRows.filter(row=>row.key===def.key&&row.open!==false&&row.available!==false&&row.locked!==true);
      return routes.length>0&&routes.every(row=>row.source==="native-guide-shared"||row.fusionRouteSource==="shared");
    };
  const typePair=(a,b)=>a<b?a+"|"+b:b+"|"+a,
    parentPair=(a,b)=>a<b?a+"\0"+b:b+"\0"+a,
    coveredTypes=new Set(),signaturePairs=new Set(),
    nativeTypes=[...new Set(legalDefs.map(def=>def.type))];
  for(const recipe of data.fusionRecipes)if(recipe.kind==="signature"&&Array.isArray(recipe.moves)&&recipe.moves.length===2)
    signaturePairs.add(parentPair(recipe.moves[0],recipe.moves[1]));
  for(let a=0;a<nativeTypes.length;a++)for(let b=a;b<nativeTypes.length;b++) {
    const left=nativeTypes[a],right=nativeTypes[b];
    if(data.fusionRecipes.some(recipe=>recipe.kind==="type"&&left===right&&recipe.type===left ||
      recipe.kind==="reaction"&&Array.isArray(recipe.pair?.[0])&&Array.isArray(recipe.pair?.[1])&&
        (recipe.pair[0].includes(left)&&recipe.pair[1].includes(right)||recipe.pair[0].includes(right)&&recipe.pair[1].includes(left))))
      coveredTypes.add(typePair(left,right));
  }
  const parentCost=def=>{
    const row=held.find(row=>row.key===def.key);
    return (["held","now"].includes(byKey.get(def.key)?.state)?0:1000)+
      (row?Math.max(0,8-(Number(row.move.level)||0)):16)+
      wrongFusions.filter(row=>row.move.parents?.includes(def.id)).length*30;
  },rankedParents=[...legalDefs].sort((a,b)=>parentCost(a)-parentCost(b)||a.id-b.id);
  function* possiblePairs(recipe) {
    if(recipe.kind==="signature" && Array.isArray(recipe.moves) && recipe.moves.length===2) {
      const a=defByKey.get(recipe.moves[0]),b=defByKey.get(recipe.moves[1]);
      if(a&&b&&a.id!==b.id)yield [a,b];
      return;
    }
    if(recipe.kind==="type" && typeof recipe.type==="string") {
      const pool=legalDefs.filter(def=>def.type===recipe.type);
      for(let a=0;a<pool.length;a++)for(let b=a+1;b<pool.length;b++)yield [pool[a],pool[b]];
      return;
    }
    if(recipe.kind==="reaction" && Array.isArray(recipe.pair?.[0]) && Array.isArray(recipe.pair?.[1])) {
      const left=legalDefs.filter(def=>recipe.pair[0].includes(def.type)),
        right=legalDefs.filter(def=>recipe.pair[1].includes(def.type)),seen=new Set();
      for(const a of left)for(const b of right)if(a.id!==b.id) {
        const key=a.id<b.id?a.id+":"+b.id:b.id+":"+a.id;
        if(!seen.has(key)){seen.add(key);yield [a,b];}
      }
      return;
    }
    if(recipe.kind==="glitch") {
      base.search.sparsifiedGlitch=true;
      const tested=new Map();
      // At most three desired fusions coexist. Other two assignments exclude
      // at most four parent IDs; retaining five VERIFIED neighbours per parent
      // preserves existence after any such exclusion. This bounds the dense
      // glitch graph without a greedy pair that can strand a later signature.
      for(const a of legalDefs) {
        let kept=0;
        for(const b of rankedParents) {
          if(a.id===b.id || coveredTypes.has(typePair(a.type,b.type)) ||
            signaturePairs.has(parentPair(a.key,b.key)))continue;
          const key=parentPair(a.id,b.id);
          let verified=tested.get(key);
          if(!tested.has(key)) {
            verified=(yield [a,b])===true;
            tested.set(key,verified);
          }
          if(verified&&++kept>=5)break;
        }
      }
      return;
    }
    // Unknown future metadata uses the original resolver under a hard budget,
    // never a guessed native recipe or unbounded traversal.
    for(let a=0;a<legalDefs.length;a++)for(let b=a+1;b<legalDefs.length;b++)yield [legalDefs[a],legalDefs[b]];
  }
  let matcherFailed=false;
  const considerPair=(goal,pair)=>{
    let [left,right]=pair;
    if(onlySharedRandom(left)&&onlySharedRandom(right)&&sharedRandomMoveLimit(data)<2&&
        ![left,right].every(def=>held.some(row=>row.key===def.key)))return false;
    // Learn shared parents before additional line/kit randoms when necessary;
    // the native generator's observed count decides how much room is needed.
    if(left.arch==="random"&&right.arch==="random"&&onlySharedRandom(right)&&!onlySharedRandom(left))
      [left,right]=[right,left];
    let recipe;try{recipe=data.fusionFor(left,right);}catch{matcherFailed=true;return false;}
    if(recipe?.key!==goal)return false;
    const states=[byKey.get(left.key),byKey.get(right.key)],
      parents=[left.key,right.key],parentIds=[left.id,right.id],
      parentRows=parents.map(key=>held.find(row=>row.key===key)),
      blockingFusionSlots=wrongFusions.filter(row=>parentIds.some(id=>row.move.parents?.includes(id))).map(row=>row.slot),
      sharedMissing=[left,right].some(def=>onlySharedRandom(def)&&!held.some(row=>row.key===def.key)),
      missingShared=[left,right].filter(def=>onlySharedRandom(def)&&!held.some(row=>row.key===def.key)).length,
      blockingMoveSlots=sharedMissing?[...ordinaryRandom].sort((a,b)=>
        Number(parents.includes(a.key))-Number(parents.includes(b.key)))
        .slice(0,Math.max(0,ordinaryRandom.length+missingShared-sharedRandomMoveLimit(data))).map(row=>row.slot):[],
      relearnSlots=blockingMoveSlots.filter(slot=>parentRows.some(row=>row?.slot===slot)),
      effectiveStates=states.map((row,index)=>parentRows[index]&&relearnSlots.includes(parentRows[index].slot)
        ?readiness.find(value=>value.key===row.key):row),
      future=effectiveStates.some(row=>!["held","now"].includes(row.state)),
      cost=(future?1000:0)+blockingFusionSlots.length*30+blockingMoveSlots.length*20+
        parentRows.reduce((sum,row)=>sum+(row&&!relearnSlots.includes(row.slot)?Math.max(0,8-(Number(row.move.level)||0)):16),0);
    if(parentRows.some(row=>row&&Number(row.move.level)<8&&nativeRun.banished?.has?.("m"+row.move.def.id)))return false;
    if(relearnSlots.some(slot=>{
      const key=held.find(row=>row.slot===slot)?.key;
      return !["now","near","far"].includes(readiness.find(row=>row.key===key)?.state);
    }))return false;
    candidates.get(goal).push({key:goal,parents,parentIds,blockingFusionSlots,blockingMoveSlots,relearnSlots,
      learningOrder:left.arch==="random"&&right.arch==="random"&&onlySharedRandom(left)?parents:null,
      readiness:effectiveStates.map(row=>({key:row.key,state:row.state,reason:row.reason,requiredLevel:row.requiredLevel})),cost});
    return true;
  };
  for(const goal of new Set(missing)) {
    const targetRecipe=recipeByKey.get(goal);if(!targetRecipe)continue;
    const iterator=possiblePairs(targetRecipe);
    for(let next=iterator.next();!next.done;) {
      base.search.pairChecks++;
      if(base.search.pairChecks>262144)return {...base,phase:"blocked",search:{...base.search,exhausted:true},
        blocked:missing.map(key=>({key,reason:"fusion-planning-budget-exhausted"}))};
      const matched=considerPair(goal,next.value);
      if(matcherFailed)return {...base,phase:"blocked",blocked:missing.map(key=>({key,reason:"native-fusion-planning-unavailable"}))};
      next=iterator.next(matched);
    }
  }
  const goals=[];
  for(const key of missing) {
    const list=candidates.get(key);
    const offeredCount=pair=>pair.parents.filter(key=>offeredKeys.has(key)&&!held.some(row=>row.key===key)).length;
    list.sort((a,b)=>a.cost-b.cost||offeredCount(b)-offeredCount(a)||a.parents.join("\0").localeCompare(b.parents.join("\0")));
    if(!recipes.has(key)) blocked.push({key,reason:"unknown-native-fusion-recipe"});
    else if(!list.length) blocked.push({key,reason:"no-currently-verified-parent-route"});
    else goals.push(key);
  }
  // At most slots-1 recipes. Forward checking reserves disjoint parent IDs for
  // all later targets before committing an earlier cheap pair. A first-fit
  // pair can permanently consume a later signature's unique parent.
  const disjoint=(pair,used)=>pair.parentIds.every(id=>!used.has(id));
  const pairReady=pair=>!pair.blockingFusionSlots.length&&!pair.blockingMoveSlots.length&&
    pair.parents.every(key=>{
      const row=held.find(value=>value.key===key);
      return row&&Number(row.move.level)>=8&&!pair.relearnSlots.includes(row.slot);
    });
  const pairAvailable=pair=>pair.readiness.every(row=>["held","now"].includes(row.state));
  let budget=false;
  const search=(keys,index,used,path)=>{
    if(index===keys.length)return path;
    for(const pair of candidates.get(keys[index])) {
      if(++base.search.nodes>4096){budget=true;return null;}
      if(!disjoint(pair,used))continue;
      const next=new Set([...used,...pair.parentIds]);
      if(keys.slice(index+1).some(key=>!candidates.get(key).some(other=>disjoint(other,next))))continue;
      const answer=search(keys,index+1,next,[...path,pair]);
      if(answer)return answer;
      if(budget)return null;
    }
    return null;
  };
  let assignments=[];
  goals.sort((a,b)=>Number(completed.some(row=>row.key===a))-Number(completed.some(row=>row.key===b))||
    candidates.get(a)[0].cost-candidates.get(b)[0].cost||targets.indexOf(a)-targets.indexOf(b));
  function* subsets(keys,length,start=0,path=[]){
    if(!length){yield path;return;}
    const seen=new Set();
    for(let index=start;index<=keys.length-length;index++){
      if(seen.has(keys[index]))continue;seen.add(keys[index]);
      yield* subsets(keys,length-1,index+1,[...path,keys[index]]);
    }
  }
  const capacity=Math.max(0,maximum-completed.length);
  for(let length=Math.min(goals.length,capacity);length>0&&!assignments.length;length--) {
    const selections=[...subsets(goals,length)],
      newKeys=keys=>new Set(keys.filter(key=>!completed.some(row=>row.key===key))).size;
    selections.sort((a,b)=>newKeys(b)-newKeys(a)||
      a.reduce((sum,key)=>sum+candidates.get(key)[0].cost,0)-b.reduce((sum,key)=>sum+candidates.get(key)[0].cost,0));
    for(const selected of selections){
      const answer=search(selected,0,new Set(),[]);
      if(budget)break;
      if(answer){
        assignments=answer;
        // A compatible destination is not an execution order. If its first
        // cheap partial recipe would force later goals onto future materials,
        // try a currently ready native pair as the global assignment anchor.
        // The original complete assignment remains a safe bounded fallback.
        if(!assignments.some(pairReady))for(const key of selected){
          for(const seed of candidates.get(key).filter(pairReady)){
            const remaining=[...selected];remaining.splice(remaining.indexOf(key),1);
            const readyAnswer=search(remaining,0,new Set(seed.parentIds),[seed]);
            if(readyAnswer){assignments=readyAnswer;break;}
            if(budget)break;
          }
          if(assignments.some(pairReady)||budget)break;
        }
        for(const key of goals.filter(key=>!selected.includes(key)))blocked.push({key,reason:"fusion-parent-conflict"});
        break;
      }
    }
    if(budget)break;
  }
  if(budget&&!assignments.length)return {...base,phase:"blocked",search:{...base.search,exhausted:true},blocked:[...blocked,
    ...goals.map(key=>({key,reason:"fusion-planning-budget-exhausted"}))]};
  if(!assignments.length)return {...base,phase:"blocked",blocked};
  if(budget)base.search.exhausted=true;
  assignments.sort((a,b)=>Number(pairReady(b))-Number(pairReady(a))||
    Number(pairAvailable(b))-Number(pairAvailable(a))||a.cost-b.cost||
    targets.indexOf(a.key)-targets.indexOf(b.key));
  // The disjoint plan reserves parents for every chosen goal, but its cheapest
  // recipe need not monopolize the next upgrade page. Take a compatible route
  // offered now when it fits, while a ready pair still goes to the machine.
  // Check the whole disjoint plan against actual slots after a pickup. Each
  // completed pair frees one slot; don't collect four unrelated half-pairs.
  const canCompleteAfter = extra => {
    const owned=new Set(held.map(row=>row.key));
    let occupied=held.length;
    if(extra&&!owned.has(extra)){owned.add(extra);occupied++;}
    if(occupied>slots)return false;
    const remaining=[...assignments];
    while(remaining.length) {
      const index=remaining.findIndex(pair=>!pair.blockingFusionSlots.length&&!pair.blockingMoveSlots.length&&
        pair.parents.filter(key=>!owned.has(key)).length<=slots-occupied);
      if(index<0)return false;
      const [pair]=remaining.splice(index,1);
      occupied+=1-pair.parents.filter(key=>owned.has(key)).length;
      for(const key of pair.parents)owned.delete(key);
    }
    return true;
  };
  const stageRank = pair => {
    const rows=pair.parents.map(key=>held.find(row=>row.key===key)),
      blockers=[...pair.blockingFusionSlots,...pair.blockingMoveSlots],
      ready=rows.every(row=>row&&Number(row.move.level)>=8)&&!blockers.length,
      missing=pair.parents.filter((key,index)=>!rows[index]||pair.relearnSlots.includes(rows[index].slot)),
      next=pair.learningOrder?.find(key=>missing.includes(key)),
      fits=held.length+missing.length<=slots && !blockers.length,
      offered=fits&&missing.some(key=>offeredKeys.has(key)&&(!next||next===key)&&canCompleteAfter(key));
    return ready?4:offered?(missing.length===1?3:2):rows.every(Boolean)&&!blockers.length?1:0;
  };
  if(nativeRun.tower)assignments.sort((a,b)=>stageRank(b)-stageRank(a));
  const collectableParents=nativeRun.tower?assignments.flatMap(pair=>{
    if(pair.blockingFusionSlots.length||pair.blockingMoveSlots.length)return [];
    const next=pair.learningOrder?.find(key=>!held.some(row=>row.key===key));
    return pair.parents.filter(key=>!held.some(row=>row.key===key)&&(!next||next===key)&&
      liveByKey.get(key)?.state==="now"&&canCompleteAfter(key));
  }):null;
  const first=assignments[0],parentRows=first.parents.map(key=>held.find(row=>row.key===key)),
    available=first.readiness.every(row=>["held","now"].includes(row.state)),
    needLearn=first.parents.filter((key,index)=>!parentRows[index]||first.relearnSlots.includes(parentRows[index].slot)),
    needUpgrade=parentRows.filter(row=>row && !first.relearnSlots.includes(row.slot) && Number(row.move.level)<8).map(row=>row.slot),
    nextParent=first.learningOrder?.find(key=>needLearn.includes(key)),
    currentlyLearnable=needLearn.filter(key=>liveByKey.get(key)?.state==="now"&&(!nextParent||key===nextParent)),
    blockers=[...first.blockingFusionSlots,...first.blockingMoveSlots],
    ready=!needLearn.length&&!needUpgrade.length&&!blockers.length,
    output=held.filter(row=>!["buff","weather"].includes(row.move.def?.arch)),
    blockingOutputs=blockers.filter(slot=>output.some(row=>row.slot===slot)),
    needsTemporaryOutput=available&&blockers.length>0&&(held.length<slots||output.length<=blockingOutputs.length)&&
      !currentlyLearnable.length,
    pending={...first,parentSlots:parentRows.map(row=>row?.slot??null),needLearn,needUpgrade,currentlyLearnable,
      available,ready,needsTemporaryOutput};
  return {...base,assignments,blocked,pending,collectableParents,reservedSlots:completed.length+assignments.length,
    phase:!available?"waiting-parent-availability":needsTemporaryOutput?"temporary-output-before-forget":
      blockers.length?first.blockingFusionSlots.length?"remove-blocking-fusion":"remove-blocking-random":
        needLearn.length?"learning-parents":needUpgrade.length?"upgrading-parents":"ready"};
}

function finalMoveRandomPlan(targets, slots, player, nativeRun, data, held, readiness, protectedFusionSlots=[]) {
  const rows=choiceGuideEntries({player},data,{}), onlyShared=key=>{
    if(choiceDefinition(data,key).arch!=="random")return false;
    const routes=rows.filter(row=>row.key===key&&row.open!==false&&row.available!==false&&row.locked!==true);
    return routes.length>0&&routes.every(row=>row.source==="native-guide-shared"||row.fusionRouteSource==="shared");
  }, sharedTargets=targets.slice(0,slots).filter(onlyShared).slice(0,sharedRandomMoveLimit(data)),
    primary=sharedTargets.find(key=>!held.some(row=>row.key===key))||sharedTargets[0],
    conflicting=targets.filter(key=>onlyShared(key)&&!sharedTargets.includes(key)),
    selected=targets.filter(key=>!conflicting.includes(key)).slice(0,slots),
    revised=readiness.map(row=>conflicting.includes(row.key)?{...row,state:"unavailable",reason:"native-shared-random-conflict"}:row),
    heldPrimary=primary&&held.some(row=>row.key===primary),
    randomRows=held.filter(row=>row.move.def?.arch==="random"),
    missingShared=sharedTargets.filter(key=>!held.some(row=>row.key===key)),
    blockingMoveSlots=missingShared.length?[...randomRows].filter(row=>!sharedTargets.includes(row.key))
      .sort((a,b)=>Number(selected.includes(a.key))-Number(selected.includes(b.key)))
      .slice(0,Math.max(0,randomRows.length+missingShared.length-sharedRandomMoveLimit(data))).map(row=>row.slot):[],
    relearnSlots=blockingMoveSlots.filter(slot=>held.some(row=>row.slot===slot&&selected.includes(row.key))),
    learningOrder=missingShared.length?[...sharedTargets,...selected.filter(key=>!sharedTargets.includes(key)&&choiceDefinition(data,key).arch==="random")]:[],
    consumed=selected.filter(key=>!held.some(row=>row.key===key)&&
      revised.some(row=>row.key===key&&row.reason==="native-fusion-parent-consumed")),
    removableFusions=held.filter(row=>row.move.def?.arch==="fusion"&&!protectedFusionSlots.includes(row.slot));
  if(!primary&&!consumed.length)return {targets:selected,readiness:revised,plan:null};
  const virtual=Object.create(player);
  Object.defineProperties(virtual,{moves:{value:(player.moves||[]).map((move,slot)=>
    move?.def?.arch==="random"||removableFusions.some(row=>row.slot===slot)?null:move)},moveSlots:{value:choiceSlotState(player).slots}});
  const after=analyzeMoveReadiness({player:virtual,nativeRun,build:{sourceType:"custom",moves:selected}},data),
    afterByKey=new Map(after.map(row=>[row.key,row])),
    fusionHolders=removableFusions.filter(row=>consumed.some(key=>
      ["now","near","far"].includes(afterByKey.get(key)?.state)&&row.move.parents?.includes(choiceDefinition(data,key).id))),
    blockingFusionSlots=fusionHolders.map(row=>row.slot),
    required=[...new Set([...consumed,...missingShared,
      ...held.filter(row=>relearnSlots.includes(row.slot)).map(row=>row.key)])],
    requiredRows=required.map(key=>afterByKey.get(key)),
    available=requiredRows.every(row=>row?.state==="now"),
    irrecoverable=requiredRows.some(row=>!row||["unavailable","unknown"].includes(row.state)),
    waitState=irrecoverable?"unavailable":requiredRows.some(row=>row?.state==="near")?"near":"far",
    blockers=[...blockingFusionSlots,...blockingMoveSlots],
    output=held.filter(row=>!["buff","weather"].includes(row.move.def?.arch)),
    needsTemporaryOutput=available&&blockers.length>0&&(held.length<choiceSlotState(player).slots||output.every(row=>blockers.includes(row.slot))),
    conditional=new Set([...consumed,...missingShared]),
    adjusted=revised.map(row=>conditional.has(row.key)?{...row,...afterByKey.get(row.key),state:available?"now":waitState,
      reason:available?consumed.includes(row.key)?"native-fusion-parent-after-forget":"native-shared-random-after-forget":
        irrecoverable?"native-blocker-not-relearnable":"native-relearning-not-ready"}:row);
  return {targets:selected,readiness:adjusted,plan:{primary:primary||null,blockingFusionSlots,blockingMoveSlots,relearnSlots,learningOrder,
    available,needsTemporaryOutput,phase:!available?irrecoverable?"blocked":"waiting-parent-availability":
      needsTemporaryOutput?"temporary-output-before-forget":blockingFusionSlots.length?"remove-blocking-fusion":
        blockingMoveSlots.length?"remove-blocking-random":primary&&!heldPrimary?"learning-parents":null}};
}

// Final loadouts are bound to the native starting character, never the preview
// selection or its later evolution. Empty slots retain their original indices.
function strictReplacementState(settings, nativeRun, data, stored, species, options = {}) {
  const player=nativeRun.player||{}, moveStrict=stored.strictMoves?.enabled===true,
    vitaminStrict=stored.strictVitamins?.enabled===true,
    keys=raw=>Array.from({length:4},(_,index)=>{
      const key=raw?.targets?.[index];
      return typeof key==="string"&&/^[A-Za-z0-9][A-Za-z0-9_.:+-]{0,99}$/.test(key)?key:null;
    }), configuredMoves=keys(stored.strictMoves), configuredVitamins=keys(stored.strictVitamins),
    validMoves=[...new Set(configuredMoves.filter(key=>key&&choiceDefinition(data,key).key===key))],
    ordinary=validMoves.filter(key=>choiceDefinition(data,key).arch!=="fusion"),
    fusionTargets=validMoves.filter(key=>choiceDefinition(data,key).arch==="fusion").flatMap(key=>
      Array(Math.max(1,stored.fusion?.enabled===true?keys(stored.fusion).filter(value=>value===key).length:0)).fill(key)),
    vitamins=[...new Set(configuredVitamins.filter(key=>key&&(data.vitamins?.get?.(key)||data.data?.vitamins?.get?.(key))))],
    projected={...stored,strictMoves:{enabled:false},strictVitamins:{enabled:false},
      ...(moveStrict?{moves:{enabled:true,level:1,targets:ordinary},
        fusion:{enabled:fusionTargets.length>0,level:1,targets:fusionTargets,allowRepeated:true,allowAdditional:true,preserveOrdinary:ordinary}}:{}),
      ...(vitaminStrict?{vitamins:{enabled:true,level:1,targets:vitamins}}:{})},
    base=finalReplacementState({...settings,finalReplacements:{...settings.finalReplacements,[species]:projected}},nativeRun,data,options),
    held=(player.moves||[]).slice(0,base.moves.actualSlots).map((move,slot)=>({move,slot,key:choiceMoveKey(move,data)})).filter(row=>row.move),
    pending=base.fusion.active?base.fusion.pending:null,
    parents=[...new Set((base.fusion.assignments||[]).flatMap(pair=>pair.parents))],
    allowedMoves=[...new Set([...ordinary,...parents])],
    wrongMoves=held.filter(row=>row.move.def?.arch==="fusion"
      ?!base.fusion.protectedSlots.includes(row.slot):!allowedMoves.includes(row.key)),
    strictComplete=validMoves.length>0&&validMoves.every(key=>held.some(row=>row.key===key)),
    forgetMoves=moveStrict?[]:[...base.moves.forget];
  if(moveStrict && validMoves.length>0 && (held.length>=base.moves.actualSlots||strictComplete))for(const row of wrongMoves){
    if(forgetMoves.includes(row.slot)||held.length-forgetMoves.length<=1)continue;
    forgetMoves.push(row.slot);
    break;
  }
  if(moveStrict){
    const prep=pending?.available?pending:base.moves.randomPreparation?.available?base.moves.randomPreparation:null,
      blockers=prep?[...prep.blockingFusionSlots,...prep.blockingMoveSlots]:[],
      protectedSlots=new Set([...base.fusion.protectedSlots,...held.filter(row=>ordinary.includes(row.key)).map(row=>row.slot),...(pending?.parentSlots||[]).filter(slot=>
        slot!=null&&!pending.relearnSlots.includes(slot))]),
      required=prep?Math.max(blockers.length,(pending?pending.needLearn.length:base.moves.readyMissing.length)-
        Math.max(0,base.moves.actualSlots-held.length)):0,
      candidates=held.filter(row=>!protectedSlots.has(row.slot)).sort((a,b)=>
        Number(blockers.includes(b.slot))-Number(blockers.includes(a.slot))||(Number(a.move.level)||0)-(Number(b.move.level)||0));
    for(const row of candidates){
      if(held.length<base.moves.actualSlots||forgetMoves.length>=1||held.length-forgetMoves.length<=1)break;
      if(forgetMoves.includes(row.slot)||!blockers.includes(row.slot)&&forgetMoves.length>=required)continue;
      forgetMoves.push(row.slot);
    }
  }
  const heldVitamins=[...(player.vitamins?.keys?.()||[])],
    forgetVitamins=vitaminStrict&&vitamins.length>0&&(heldVitamins.length>=base.vitamins.slots||vitamins.every(key=>heldVitamins.includes(key)))
      ?heldVitamins.filter(key=>!vitamins.includes(key)).slice(0,1):base.vitamins.forget,
    strictMoves={enabled:moveStrict,targets:validMoves,configuredTargets:configuredMoves,
      allowed:allowedMoves,parents,unwanted:wrongMoves.map(row=>row.key),
      completed:held.filter(row=>validMoves.includes(row.key)).map(row=>row.key),
      pending:{forget:forgetMoves.map(slot=>held.find(row=>row.slot===slot)?.key),fusion:pending?.key||null,parents},
      reason:parents.length?"只为指定融合准备其合法父招式；非目标强制保底等待原生遗忘NPC清理，已持有指定成品不会为重复融合被拆掉":
        "仅获取指定招式；原生强制且无跳过时可暂持非目标，待原生遗忘NPC清理，最低一招限制仍由原生决定",
      blocked:[...base.fusion.blocked,...base.moves.blocked,
        ...configuredMoves.filter(key=>key&&!validMoves.includes(key)).map(key=>({key,reason:"unknown-native-move"})),
        ...fusionTargets.filter(key=>!base.fusion.targets.includes(key)).map(key=>({key,reason:"native-fusion-preparation-slots-unavailable"})),
        ...(wrongMoves.some(row=>!forgetMoves.includes(row.slot))?[{reason:"native-minimum-one-move"}]:[])],
      phase:!validMoves.length?"waiting-configured-targets":pending?base.fusion.phase:
        wrongMoves.length?"remove-nontarget-moves":"strict-targets-only"},
    strictVitamins={enabled:vitaminStrict,targets:vitamins,configuredTargets:configuredVitamins,
      completed:heldVitamins.filter(key=>vitamins.includes(key)),pending:{forget:forgetVitamins},
      reason:"仅获取指定维生素；原生强制且无跳过时可暂持非目标，待原生遗忘NPC清理",
      unwanted:heldVitamins.filter(key=>!vitamins.includes(key)),phase:!vitamins.length?"waiting-configured-targets":"strict-targets-only"};
  if(moveStrict&&pending?.available&&pending.needLearn.length>base.moves.actualSlots-held.length+forgetMoves.length){
    strictMoves.phase="waiting-preparation-slots";
    strictMoves.reason="保留已指定的招式成品，当前没有足够空位准备该融合的两招原料；等待原生可行机会，不主动退局";
    strictMoves.blocked.push({key:pending.key,reason:"strict-preserve-requested-moves-no-preparation-slot"});
  }
  const nativeAutoSingleChoice=nativeRun.meta?.profile?.settings?.skipEmptyLevelUp ?? data.app?.meta?.profile?.settings?.skipEmptyLevelUp;
  for(const strict of [strictMoves,strictVitamins]){
    strict.nativeAutoSingleChoice=typeof nativeAutoSingleChoice==="boolean"?nativeAutoSingleChoice:null;
    if(strict.enabled&&nativeAutoSingleChoice===true){
      strict.reason+="；原生已开启单张强化自动选择，可能先于严格筛选取得非指定强化；可在游戏原生设置关闭，本辅助不会擅改";
      strict.blocked ||= [];strict.blocked.push({reason:"native-auto-single-offer-before-controller"});
    }
  }
  return {...base,strictMoves,strictVitamins,
    moves:{...base.moves,...(moveStrict?{enabled:true,active:true,level:1}:{}),forget:forgetMoves},
    vitamins:{...base.vitamins,...(vitaminStrict?{enabled:true,active:true,level:1}:{}),forget:forgetVitamins},
    needsTutor:forgetMoves.length>0||forgetVitamins.length>0,
    conditionKey:JSON.stringify([base.conditionKey,strictMoves,strictVitamins])};
}

// One filter is shared by acquisition pages. Native mandatory upgrades may
// use its rejected set only after their real skip/refresh options are absent.
export function strictOfferAllowed(offer, run = {}, data = {}) {
  const final=run.finalReplacement||run.build?.finalReplacement;
  if(!offer)return false;
  if(!emptyFinalSlotOfferAllowed(offer,run,data))return false;
  if(characterEvasionItemPriority(offer,run,data)>0)return true;
  if(["newMove","upMove"].includes(offer.kind)&&final?.strictMoves?.enabled){
    const key=choiceMoveKey(offer.kind==="upMove"?run.player?.moves?.[offer.slot]:offer.id,data);
    return final.strictMoves.allowed.includes(key)||final.strictMoves.targets.includes(key);
  }
  if(["newVit","upVit"].includes(offer.kind)&&final?.strictVitamins?.enabled)
    return final.strictVitamins.targets.includes(offer.vit);
  return true;
}

// Explicit vacancies constrain capacity, rather than physical native indices:
// fusion and native forgetting can compact/reassign slots. Unknown/unconfigured
// nulls retain useful free capacity. Only a chosen reserved marker removes it.
export function emptyFinalSlotOfferAllowed(offer, run = {}, data = {}) {
  const final=run.finalReplacement||run.build?.finalReplacement;
  if(!offer)return false;
  if(['upMove','upVit'].includes(offer.kind)&&final?.banishSlots?.active){
    const kind=offer.kind==='upMove'?'move':'vitamin',key=kind==='move'?choiceMoveKey(run.player?.moves?.[offer.slot],data):offer.vit;
    if(final.banishSlots.rows.some(row=>row.kind===kind&&row.key===key&&row.ready&&!row.done))return false;
  }
  if(["newMove","upMove"].includes(offer.kind)&&final?.emptySlots?.moves?.active){
    const rule=final.emptySlots.moves,key=choiceMoveKey(offer.kind==="upMove"?run.player?.moves?.[offer.slot]:offer.id,data);
    if(offer.kind==='upMove'&&final.banishSlots?.rows.some(row=>row.kind==='move'&&row.key===key&&row.blank&&row.level<row.threshold))return true;
    if(rule.allowed.includes(key))return true;
    if(rule.preparing&&final.fusion?.pending?.needsTemporaryOutput&&offer.kind==="newMove"&&
        !["buff","weather","fusion","random"].includes(choiceDefinition(data,offer.id).arch))return true;
    if(offer.kind==="upMove")return rule.unconfigured>0&&rule.keepSlots.includes(offer.slot);
    return rule.unconfigured>0&&rule.heldCount<rule.capacity;
  }
  if(["newVit","upVit"].includes(offer.kind)&&final?.emptySlots?.vitamins?.active){
    const rule=final.emptySlots.vitamins;
    if(offer.kind==='upVit'&&final.banishSlots?.rows.some(row=>row.kind==='vitamin'&&row.key===offer.vit&&row.blank&&row.level<row.threshold))return true;
    if(rule.allowed.includes(offer.vit))return true;
    if(offer.kind==="upVit")return rule.unconfigured>0&&rule.keepKeys.includes(offer.vit);
    return rule.unconfigured>0&&rule.heldCount<rule.capacity;
  }
  return true;
}

// A small, helper-owned per-run queue remembers a genuinely observed threshold
// after native forgetting. It contains no profile/identity and cannot change
// the game's banished set. Off/default allocates no entry and starts no work.
const finalBanishPending = new WeakMap();
function finalBanishState(entry,scope,nativeRun,data,state) {
  const player=nativeRun.player||{},requests=[['move',entry.moves,Math.min(4,choiceSlotState(player).slots)],['vitamin',entry.vitamins,Math.max(1,Math.min(6,Number(player.vitaminSlots)||3))]],rows=[],
    configured=requests.some(([,section])=>section?.enabled===true&&section.banishLevels?.some(level=>Number.isInteger(level)&&level>0));
  if(!configured){finalBanishPending.delete(nativeRun);return {active:false,rows:[],pending:[],scopeKey:scope.key};}
  let owner;try{owner=data.app?.meta?.account||nativeRun.meta;}catch{/* Unknown identity does not publish or manufacture one. */}
  const signature=JSON.stringify([scope.key,entry.moves,entry.vitamins]),
    prior=finalBanishPending.get(nativeRun),group=prior?.signature===signature&&prior.owner===owner?prior:
      {signature,owner,pending:new Map(),blankBindings:new Map()};
  finalBanishPending.set(nativeRun,group);
  for(const [kind,section,maximum]of requests){
    if(section?.enabled!==true)continue;
    const targets=Array.from({length:maximum},(_,index)=>section.targets?.[index]??null),
      held=kind==='move'?(player.moves||[]).map((move,slot)=>move?{slot,key:choiceMoveKey(move,data),id:move.def?.id,level:Number(move.level)||0,move}:null).filter(Boolean):
        [...(player.vitamins||[])].map(([key,value],slot)=>({slot,key,id:key,level:Number(value?.level??value)||0})),
      named=new Set(targets.filter(key=>key&&key!==finalEmptySlot)),assigned=new Set();
    for(let index=0;index<maximum;index++){
      const target=targets[index],threshold=Number.isInteger(section.banishLevels?.[index])?Math.max(0,Math.min(kind==='move'?10:12,section.banishLevels[index])):0;
      if(!target||!threshold)continue;
      const blank=target===finalEmptySlot,binding=group.blankBindings.get(kind+':'+index),holder=blank?
        binding?held.find(row=>row.slot===binding.slot&&!named.has(row.key)&&!assigned.has(row.slot)):
          held.find(row=>row.slot===index&&!named.has(row.key)&&!assigned.has(row.slot))||held.find(row=>!named.has(row.key)&&!assigned.has(row.slot)):
        held.find(row=>row.key===target&&!assigned.has(row.slot));
      if(!holder)continue;
      if(kind==='move'&&blank&&state.fusion?.missing?.length&&
          (state.fusion.protectedSlots.includes(holder.slot)||(state.fusion.assignments||[]).some(pair=>pair.parents.includes(holder.key))))continue;
      if(blank)group.blankBindings.set(kind+':'+index,{slot:holder.slot,key:holder.key});
      assigned.add(holder.slot);
      let cap=kind==='move'?NaN:Number(player.vitCap);
      if(kind==='move')try{cap=Number(player.capOf?.(holder.move));}catch{}
      const nativeKey=kind==='move'?'m'+holder.id:'v'+holder.key,done=nativeRun.banished?.has?.(nativeKey)===true,
        row={kind,index,key:holder.key,id:holder.id,slot:holder.slot,threshold,level:holder.level,blank,nativeKey,done,
          ready:holder.level>=threshold&&!done,atNativeCap:Number.isFinite(cap)&&holder.level>=cap,cap:Number.isFinite(cap)?cap:null};
      rows.push(row);
      if(row.ready&&group.pending.size<64)group.pending.set(kind+':'+index+':'+holder.key,{...row});
    }
  }
  for(const [key,row]of group.pending)if(nativeRun.banished?.has?.(row.nativeKey))group.pending.delete(key);
  return {active:true,rows,pending:[...group.pending.values()],scopeKey:scope.key};
}

export function chooseFinalBanishAction(offers=[],run={},data={},options={}) {
  const state=run.finalReplacement||run.build?.finalReplacement,slots=state?.banishSlots;
  if(!slots?.active||!(Number(options.banishes??run.nativeRun?.banishes??run.banishes)>0)||options.banishLegal!==true)return null;
  const native=run.nativeRun||run,player=run.player||native.player||{};
  for(const pending of slots.pending){
    if(native.banished?.has?.(pending.nativeKey))continue;
    for(let index=0;index<offers.length;index++){
      const offer=offers[index];if(options.legal&&options.legal(index)!==true)continue;
      const category=['newMove','upMove'].includes(offer?.kind)?'move':['newVit','upVit'].includes(offer?.kind)?'vitamin':null;
      if(category!==pending.kind)continue;
      const key=category==='move'?choiceMoveKey(offer.kind==='upMove'?player.moves?.[offer.slot]:offer.id,data):offer.vit;
      if(key!==pending.key||offer.key!==pending.nativeKey)continue;
      return {action:'banish',index,key,nativeKey:pending.nativeKey,threshold:pending.threshold,scopeKey:slots.scopeKey,
        reason:'configured-final-slot-native-banish',blank:pending.blank};
    }
  }return null;
}

export function recommendedFinalLoadout(build = {}, data = {}) {
  if(!['leaderboard','guide','custom'].includes(build.sourceType)||build.replacementPolicy==='never'||build.masteryConstraints)return null;
  const raw=build.sourceType==='custom'?choiceMovePreferences(build).map(row=>row.key):build.observedMoves||build.moves||[],
    keys=[...new Set(raw.map(row=>typeof row==='string'?row:row?.key??row?.k).filter(key=>
      typeof key==='string'&&choiceDefinition(data,key).key===key&&!build.avoidMoves?.includes(key)))],
    ordinary=keys.filter(key=>choiceDefinition(data,key).arch!=='fusion'),
    fusion=keys.filter(key=>choiceDefinition(data,key).arch==='fusion');
  if(!keys.length)return null;
  // Records describe a destination; native early growth and availability stay
  // in charge. No stored plan or native move is rewritten by this projection.
  return {derivedFromBuild:build.id||null,moves:{schemaVersion:2,enabled:true,level:30,targets:keys.slice(0,4)},
    vitamins:{enabled:false}};
}

export function fusionPreservedMoves(build = {}) {
  return build.sourceType === "custom"
    ? (build.configuredMovePreferences || choiceMovePreferences(build)).filter(row=>!row.avoid).map(row=>row.key) : [];
}

function unifiedFinalMoveProjection(entry,data) {
  const section=normalizeFinalMoveSection(entry),targets=section.targets.filter(key=>key&&key!==finalEmptySlot),
    ordinary=targets.filter(key=>choiceDefinition(data,key).key===key&&choiceDefinition(data,key).arch!=="fusion"),
    fusions=targets.filter(key=>choiceDefinition(data,key).key===key&&choiceDefinition(data,key).arch==="fusion");
  return {...entry,moves:{enabled:section.enabled&&ordinary.length>0,level:section.level,
      targets:section.targets.map(key=>ordinary.includes(key)?key:null)},
    fusion:{enabled:section.enabled&&fusions.length>0,level:section.level,targets:fusions,
      allowAdditional:false,allowRepeated:true,unified:true,preserveOrdinary:ordinary},
    unified:{...section,ordinaryTargets:ordinary,fusionTargets:fusions,
      unknown:targets.filter(key=>choiceDefinition(data,key).key!==key),
      capacityLimited:fusions.length>3}};
}

export function finalReplacementState(settings = {}, nativeRun = {}, data = {}, options = {}) {
  const player=nativeRun.player||{},species=String(nativeRun.startSpecies||player.speciesId),raw=settings.finalReplacements?.[species]||{},
    featureActive=Object.keys(raw.stageProfiles||{}).length>0||['moves','vitamins'].some(kind=>raw[kind]?.enabled===true&&
      (raw[kind].targets?.includes(finalEmptySlot)||raw[kind].banishLevels?.some(level=>Number.isInteger(level)&&level>0)));
  if(!featureActive){finalBanishPending.delete(nativeRun);return finalReplacementStateBase(settings,nativeRun,data,options);}
  const resolved=resolveFinalReplacementEntry(raw,nativeRun),entry=resolved.entry,
    moveSection=normalizeFinalMoveSection(entry),vitaminSection=entry.vitamins||{},
    moveBlank=moveSection.enabled&&moveSection.targets.slice(0,Math.min(4,choiceSlotState(player).slots)).includes(finalEmptySlot),
    vitaminBlank=vitaminSection.enabled===true&&vitaminSection.targets?.slice(0,Math.max(1,Math.min(6,Number(player.vitaminSlots)||3))).includes(finalEmptySlot);
  // A deliberately selected vacancy takes effect immediately. This does not
  // migrate old nulls or change their former replacement threshold semantics.
  const effective={...settings,finalReplacements:{...settings.finalReplacements,[species]:{...entry,
    ...(moveBlank?{moves:{...moveSection,level:1},strictMoves:{enabled:false}}:{}),
    ...(vitaminBlank?{vitamins:{...vitaminSection,level:1},strictVitamins:{enabled:false}}:{})}}},
    state=finalReplacementStateBase(effective,nativeRun,data,options),emptySlots={},banishSlots=finalBanishState({...entry,moves:moveSection},resolved.scope,nativeRun,data,state);
  let moveForget=[...state.moves.forget],vitaminForget=[...state.vitamins.forget];
  if(moveBlank){
    const configured=moveSection.targets.slice(0,state.moves.actualSlots),reserved=configured.filter(key=>key===finalEmptySlot).length,
      unconfigured=configured.filter(key=>key==null).length,capacity=Math.max(0,state.moves.actualSlots-reserved),
      held=(player.moves||[]).slice(0,state.moves.actualSlots).map((move,slot)=>({move,slot,key:choiceMoveKey(move,data)})).filter(row=>row.move),
      wanted=moveSection.targets.filter(key=>key&&key!==finalEmptySlot&&choiceDefinition(data,key).key===key),
      preparing=!!(state.fusion?.enabled&&state.fusion?.missing?.length),
      parents=preparing?[...new Set((state.fusion.assignments||[]).flatMap(pair=>pair.parents))]:[],
      allowed=[...new Set([...wanted,...parents])],
      nativeProtected=new Set(preparing?[...state.fusion.protectedSlots,...(state.fusion.pending?.parentSlots||[]).filter(slot=>slot!=null)]:[]),
      requestedCounts=new Map(wanted.map(key=>[key,wanted.filter(value=>value===key).length])),keep=new Set(),
      pendingBlank=new Set(banishSlots.rows.filter(row=>row.kind==='move'&&row.blank&&!row.done&&!(row.ready&&row.atNativeCap)).map(row=>row.slot)),
      effectiveCapacity=preparing?state.moves.actualSlots:Math.min(state.moves.actualSlots,capacity+pendingBlank.size);
    // Retain the requested number of each final instance. An extra same-key
    // fusion is not another configured slot and must not block a vacancy.
    for(const row of held)if(nativeProtected.has(row.slot)||(requestedCounts.get(row.key)||0)>0){
      keep.add(row.slot);requestedCounts.set(row.key,Math.max(0,(requestedCounts.get(row.key)||0)-1));
    }
    for(const slot of pendingBlank)keep.add(slot);
    moveForget=moveForget.filter(slot=>!pendingBlank.has(slot));
    const releasedBlank=new Set(banishSlots.rows.filter(row=>row.kind==='move'&&row.blank&&(row.done||row.ready&&row.atNativeCap)).map(row=>row.slot));
    for(const row of held.filter(row=>!keep.has(row.slot)&&!releasedBlank.has(row.slot)).sort((a,b)=>(Number(b.move.level)||0)-(Number(a.move.level)||0)))
      if(keep.size<effectiveCapacity)keep.add(row.slot);
    const excess=Math.max(0,held.length-effectiveCapacity),removable=held.filter(row=>!keep.has(row.slot))
      .sort((a,b)=>(Number(a.move.level)||0)-(Number(b.move.level)||0)),
      extra=excess>0&&held.length>1?removable[0]?.slot:undefined;
    if(extra!==undefined)moveForget=[extra];
    emptySlots.moves={active:reserved>0,reserved,capacity,unconfigured,allowed,preparing,heldCount:held.length,
      keepSlots:[...keep],nativeMinimumBlocked:capacity===0&&held.length===1,requestedLevel:moveSection.level};
    // A pure vacancy-only rule has no ordinary learning target, but its active
    // cleanup and acquisition guard must still reach the real tutor consumer.
    if(reserved>0)state.moves={...state.moves,enabled:true,active:true};
  }
  if(vitaminBlank){
    const slots=state.vitamins.slots,configured=Array.from({length:slots},(_,index)=>vitaminSection.targets?.[index]??null),
      reserved=configured.filter(key=>key===finalEmptySlot).length,unconfigured=configured.filter(key=>key==null).length,
      capacity=Math.max(0,slots-reserved),held=[...(player.vitamins?.keys?.()||[])],
      allowed=[...new Set(configured.filter(key=>key&&key!==finalEmptySlot&&
        (data.vitamins?.get?.(key)||data.data?.vitamins?.get?.(key))))],
      keep=new Set(held.filter(key=>allowed.includes(key))),
      pendingBlank=new Set(banishSlots.rows.filter(row=>row.kind==='vitamin'&&row.blank&&!row.done&&!(row.ready&&row.atNativeCap)).map(row=>row.key)),
      effectiveCapacity=Math.min(slots,capacity+pendingBlank.size);
    for(const key of pendingBlank)keep.add(key);
    vitaminForget=vitaminForget.filter(key=>!pendingBlank.has(key));
    const releasedBlank=new Set(banishSlots.rows.filter(row=>row.kind==='vitamin'&&row.blank&&(row.done||row.ready&&row.atNativeCap)).map(row=>row.key));
    for(const key of held)if(keep.size<effectiveCapacity&&!releasedBlank.has(key))keep.add(key);
    const extra=held.length>effectiveCapacity?held.find(key=>!keep.has(key)):undefined;
    if(extra!==undefined)vitaminForget=[extra];
    emptySlots.vitamins={active:reserved>0,reserved,capacity,unconfigured,allowed,heldCount:held.length,keepKeys:[...keep],requestedLevel:vitaminSection.level};
    if(reserved>0)state.vitamins={...state.vitamins,enabled:true,active:true};
  }
  return {...state,moves:{...state.moves,forget:moveForget},vitamins:{...state.vitamins,forget:vitaminForget},emptySlots,banishSlots,stageScope:resolved.scope,
    needsTutor:moveForget.length>0||vitaminForget.length>0,
    conditionKey:JSON.stringify([state.conditionKey,resolved.scope,emptySlots,banishSlots,moveForget,vitaminForget])};
}

function finalReplacementStateBase(settings = {}, nativeRun = {}, data = {}, options = {}) {
  const player = nativeRun.player || {}, species = Number(nativeRun.startSpecies || player.speciesId),
    actualSlots = Math.min(4,choiceSlotState(player).slots),
    rawStored = settings.finalReplacements?.[String(species)] || {},
    stored = rawStored.moves?.schemaVersion===2?unifiedFinalMoveProjection(rawStored,data):rawStored;
  if(stored.strictMoves?.enabled===true||stored.strictVitamins?.enabled===true)
    return strictReplacementState(settings,nativeRun,data,stored,species,options);
  const normalize = (raw, maximum, slots, lookup) => {
    const seen = new Set(), targets = Array.from({length:maximum}, (_, index) => {
      const value = raw?.targets?.[index];
      if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:+-]{0,99}$/.test(value) || seen.has(value)) return null;
      seen.add(value); return value;
    }).slice(0, slots).filter(key => key && lookup(key));
    const number = raw?.level, level = typeof number === "number" && Number.isFinite(number)
      ? Math.max(1, Math.min(999999, Math.trunc(number))) : 30;
    return {enabled:raw?.enabled === true && targets.length > 0, level, targets,
      active:raw?.enabled === true && targets.length > 0 && Number(player.level) >= level, slots};
  };
  let moveState = normalize(stored.moves,4,actualSlots,
    key=>choiceDefinition(data,key).key===key && choiceDefinition(data,key).arch!=="fusion");
  const vitaminState=normalize(stored.vitamins,6,Math.max(1,Math.min(6,Number(player.vitaminSlots)||3)),
    key=>!!(data.vitamins?.get?.(key)||data.data?.vitamins?.get?.(key))),
    held=(player.moves||[]).slice(0,actualSlots).map((move,slot)=>({move,slot,key:choiceMoveKey(move,data)})).filter(row=>row.move),
    fusion=finalFusionPlan(stored.fusion?.enabled===true?{...stored.fusion,allowRepeated:true,allowAdditional:false,
      preserveOrdinary:stored.unified?.ordinaryTargets||(moveState.enabled?moveState.targets:[]),
      preserveCustom:fusionPreservedMoves(options.build).filter(key=>choiceDefinition(data,key).arch!=="fusion")}:stored.fusion,player,nativeRun,data,held,actualSlots,options),
    configuredTargets=[...moveState.targets],
    normalSlots=fusion.enabled?Math.max(0,actualSlots-fusion.reservedSlots):actualSlots;
  let initialReadiness=moveState.enabled?analyzeMoveReadiness({player,build:{moves:configuredTargets},nativeRun},data):[];
  const candidateTargets=fusion.enabled?configuredTargets.filter(key=>!initialReadiness.some(row=>row.key===key&&
      row.state==="unavailable"&&row.reason!=="native-shared-random-already-held"&&!(row.reason==="native-fusion-parent-consumed"&&
        !held.some(holder=>fusion.protectedSlots.includes(holder.slot)&&holder.move.parents?.includes(choiceDefinition(data,key).id))))):configuredTargets,
    normalRandom=moveState.enabled&&!(fusion.active&&fusion.pending)
      ?finalMoveRandomPlan(candidateTargets,normalSlots,player,nativeRun,data,held,initialReadiness,fusion.enabled?fusion.protectedSlots:[])
      :{targets:candidateTargets.slice(0,normalSlots),readiness:initialReadiness,plan:null};
  initialReadiness=normalRandom.readiness;
  moveState={...moveState,slots:normalSlots,targets:normalRandom.targets,
    ...(stored.unified&&fusion.active&&fusion.pending?{active:false,deferredForFusion:true}:{})};
  const blockedMoves=initialReadiness.filter(row=>row.state==="unavailable");
  const readiness=initialReadiness.filter(row=>moveState.targets.includes(row.key)),
    missing=moveState.targets.filter(key=>!held.some(row=>row.key===key)),
    readyMissing=missing.filter(key=>readiness.some(row=>row.key===key&&row.state==="now")),
    pending=fusion.active?fusion.pending:null,
    preparing=!!pending,
    protectedSlots=new Set(fusion.enabled?fusion.protectedSlots:[]),
    parentKeys=preparing?pending.parents:[],
    parentSlots=preparing?held.filter(row=>parentKeys.includes(row.key)&&!pending.relearnSlots.includes(row.slot)).map(row=>row.slot):[];
  for(const slot of parentSlots)protectedSlots.add(slot);
  if(fusion.completed.length)for(const row of held)
    if(moveState.enabled&&configuredTargets.includes(row.key))protectedSlots.add(row.slot);
  const output=held.filter(row=>!["buff","weather"].includes(row.move.def?.arch)),
    forgetMoves=[], freeSlots=Math.max(0,actualSlots-held.length);
  let wantedForget=0,removable=[];
  if(preparing) {
    if(pending.available) {
      const blockers=[...pending.blockingFusionSlots,...pending.blockingMoveSlots],
        laterParents=new Set(fusion.assignments.slice(1).flatMap(pair=>pair.parents));
      wantedForget=blockers.length+Math.max(0,pending.needLearn.length-freeSlots-blockers.length);
      removable=held.filter(row=>!protectedSlots.has(row.slot)).sort((a,b)=>
        Number(blockers.includes(b.slot))-Number(blockers.includes(a.slot)) ||
        Number(laterParents.has(a.key))-Number(laterParents.has(b.key)) ||
        (Number(a.move.level)||0)-(Number(b.move.level)||0));
    }
  } else if(moveState.active&&normalRandom.plan?.available&&
      (normalRandom.plan.blockingMoveSlots.length||normalRandom.plan.blockingFusionSlots.length)) {
    const blockers=[...normalRandom.plan.blockingFusionSlots,...normalRandom.plan.blockingMoveSlots];
    wantedForget=blockers.length+Math.max(0,readyMissing.length-freeSlots-blockers.length);
    removable=held.filter(row=>!protectedSlots.has(row.slot)&&
      (blockers.includes(row.slot)||!moveState.targets.includes(row.key)))
      .sort((a,b)=>Number(blockers.includes(b.slot))-Number(blockers.includes(a.slot))||
        (Number(a.move.level)||0)-(Number(b.move.level)||0));
  } else if(moveState.active&&readyMissing.length&&!normalRandom.plan?.blockingMoveSlots.length&&
      !normalRandom.plan?.blockingFusionSlots.length) {
    wantedForget=Math.max(0,held.length+readyMissing.length-actualSlots);
    removable=held.filter(row=>!moveState.targets.includes(row.key)&&!protectedSlots.has(row.slot))
      .sort((a,b)=>(Number(a.move.level)||0)-(Number(b.move.level)||0));
  }
  for(const row of removable) {
    if(freeSlots>0||forgetMoves.length>=Math.min(1,wantedForget)||held.length-forgetMoves.length<=1)break;
    if(output.includes(row)&&output.filter(value=>!forgetMoves.includes(value.slot)).length<=1)continue;
    forgetMoves.push(row.slot);
  }
  const vitamins=[...(player.vitamins?.keys?.()||[])],
    missingVitamins=vitaminState.targets.filter(key=>!vitamins.includes(key)),
    vitaminReadiness=vitaminState.targets.map(key=>({key,
      state:vitamins.includes(key)?"held":nativeRun.banished?.has?.("v"+key)?"unavailable":"now",
      reason:vitamins.includes(key)?"equipped-native-vitamin":nativeRun.banished?.has?.("v"+key)?"native-banish":"native-vitamin-pool"})),
    readyMissingVitamins=missingVitamins.filter(key=>vitaminReadiness.some(row=>row.key===key&&row.state==="now")),
    wrongVitamins=vitamins.filter(key=>!vitaminState.targets.includes(key)),
    vitForgetCount=Math.max(0,vitamins.length+readyMissingVitamins.length-vitaminState.slots),
    forgetVitamins=vitaminState.active&&readyMissingVitamins.length&&vitamins.length>=vitaminState.slots
      ?wrongVitamins.slice(0,Math.min(1,vitForgetCount,Math.max(0,vitamins.length-1))):[];
  const learningTargets=preparing?(pending.available?pending.parents:[]):normalRandom.plan?.learningOrder?.length
    ?[...normalRandom.plan.learningOrder,...moveState.targets.filter(key=>!normalRandom.plan.learningOrder.includes(key))]:moveState.targets;
  return {species,...(stored.unified?{unified:stored.unified}:{}),
    moves:{...moveState,actualSlots,configuredTargets,missing,readyMissing,readiness,blocked:blockedMoves,
      learningTargets,forget:forgetMoves,refillBeforeForget:freeSlots>0,randomPreparation:normalRandom.plan,
      phase:moveState.active?normalRandom.plan?.phase:null},
    vitamins:{...vitaminState,missing:missingVitamins,readyMissing:readyMissingVitamins,readiness:vitaminReadiness,forget:forgetVitamins},
    fusion,needsTutor:forgetMoves.length>0||forgetVitamins.length>0,
    needsFusion:!!(pending?.ready),fusionReadyKey:pending?.ready?pending.key:null,
    conditionKey:JSON.stringify([species,moveState,vitaminState,fusion,held.map(row=>[row.slot,row.key,row.move.level,row.move.parents||[]]),vitamins,readyMissing])};
}

export function finalReplacementBuild(build = {}, replacement) {
  if(!replacement) return build;
  const moves = replacement.moves, vitamins = replacement.vitamins,
    fusion = replacement.fusion, preparing=!!(fusion?.active && fusion.pending),
    targets=moves?.learningTargets||moves?.targets||[];
  return {...build,
    configuredMovePreferences:build.configuredMovePreferences || choiceMovePreferences(build),
    ...(moves?.active || preparing ? {moves:[...targets],moveRules:[],avoidMoves:(build.avoidMoves||[]).filter(key=>!targets.includes(key)),
      unavailableMoves:(build.unavailableMoves||[]).filter(key=>!targets.includes(key)),
      reserveUntilLevel:Math.max(Number(build.reserveUntilLevel)||20,moves?.level||fusion?.level||1)} : {}),
    ...(vitamins?.active ? {vitaminPriority:[...vitamins.targets]} : {}),
    finalReplacement:replacement};
}

// Achievement projections share the requested per-recipe copy limit. They
// cannot expand it or dismantle a completed fusion to manufacture extra counts.
// Native history stays intact.
export function fusionGoalReplacementState(goal,nativeRun={},data={},settings={}) {
  const player=nativeRun.player || {},species=Number(nativeRun.startSpecies || player.speciesId),
    recipes=Array.isArray(data.fusionRecipes)?data.fusionRecipes:[],recipeByKey=new Map(recipes.map(row=>[row.key,row])),
    matches=key=>{const recipe=recipeByKey.get(key);return !!recipe&&(!goal.own||recipe.member===species)&&(!goal.glitch||recipe.kind==="glitch");},
    made=(nativeRun.fusions || []).filter(matches).length,
    saved=goal.singleRun?0:Math.max(0,Number(goal.saved)||0),remaining=Math.max(0,(Number(goal.count)||1)-saved-made);
  if(!remaining)return null;
  // A count achievement cannot enlarge the user's final loadout.
  if(settings.finalReplacements?.[species]?.fusion?.enabled===true)
    return finalReplacementState(settings,nativeRun,data);
  const held=(player.moves || []).map((move,slot)=>({move,slot})).filter(row=>row.move),
    retire=[null,...held.filter(row=>row.move.def?.arch==="fusion").map(row=>row.slot)],
    proposals=[];
  for(const retired of retire) {
    const projected=Object.create(player);
    Object.defineProperty(projected,"moves",{value:(player.moves || []).map((move,slot)=>slot===retired?null:move)});
    const projectedRun=Object.create(nativeRun),defs=new Map();
    Object.defineProperty(projectedRun,"player",{value:projected});
    for(const row of choiceGuideEntries({player:projected,nativeRun:projectedRun},data,{})) {
      const def=choiceDefinition(data,row.id ?? row.key);
      if(def.key&&Number.isFinite(def.id)&&!["buff","weather","fusion"].includes(def.arch))defs.set(def.key,def);
    }
    for(const row of held)if(row.slot!==retired&&row.move.def?.key&&!["buff","weather","fusion"].includes(row.move.def.arch))defs.set(row.move.def.key,row.move.def);
    const readiness=analyzeMoveReadiness({player:projected,nativeRun:projectedRun,build:{moves:[...defs.keys()]}},data),
      states=new Map(readiness.map(row=>[row.key,row])),ordinary=[...defs.values()].filter(def=>["held","now","near","far"].includes(states.get(def.key)?.state)),
      cost=def=>{const row=held.find(row=>row.slot!==retired&&row.move.def?.key===def.key);return row?Math.max(0,8-(Number(row.move.level)||0)):16+(["near","far"].includes(states.get(def.key)?.state)?1000:0);},
      choices=new Map();
    if(typeof data.fusionFor!=="function")continue;
    for(let a=0;a<ordinary.length;a++)for(let b=a+1;b<ordinary.length;b++) {
      let recipe;try{recipe=data.fusionFor(ordinary[a],ordinary[b]);}catch{continue;}
      if(!recipe?.key||!matches(recipe.key)||nativeRun.fusions?.includes(recipe.key)||
          held.some(row=>row.move.def?.key===recipe.key))continue;
      const value=cost(ordinary[a])+cost(ordinary[b])+(retired==null?0:50);
      if(!choices.has(recipe.key)||value<choices.get(recipe.key))choices.set(recipe.key,value);
    }
    for(const [key,cost]of [...choices].sort((a,b)=>a[1]-b[1])) {
      const retained=held.filter(row=>row.slot!==retired&&row.move.def?.key===key).length,
        settings={finalReplacements:{[species]:{fusion:{enabled:true,level:1,targets:Array(retained+1).fill(key),
          allowRepeated:true,goalOnly:true,...(retired==null?{}:{goalRetireSlot:retired})}}}},
        value=finalReplacementState(settings,nativeRun,data);
      if(value.fusion?.pending?.available) {
        proposals.push({value,cost});break;
      }
    }
    if(proposals.some(row=>row.value.fusion.pending.ready))break;
  }
  proposals.sort((a,b)=>a.cost-b.cost);
  return proposals[0]?.value || null;
}

function choiceGuideEntries(run, data, options) {
  const entries = [],
    player = run.player || {};
  const add = (value, source, current = false) => {
    if (value == null) return;
    const row = typeof value === "object" ? { ...value } : { id: value };
    const key = row.key ?? choiceDefinition(data, row.id).key ?? row.id;
    if (key == null) return;
    entries.push({
      ...row,
      key,
      source,
      current: row.current === true || current,
    });
  };
  for (const row of options.moveAvailability || run.moveAvailability || [])
    add(row, "explicit-native-metadata");
  for (const key of run.currentMoveKeys || [])
    add({ key }, "current-native-keys", true);
  // Recognize an explicit native pool. Numeric Map values are deliberately not
  // guessed to be required levels: different game versions may use weights.
  const pool = player.learnPool;
  if (
    Array.isArray(pool) ||
    (pool &&
      typeof pool.values === "function" &&
      typeof pool.get !== "function")
  )
    for (const row of pool) add(row, "native-learn-pool", true);
  else if (
    pool &&
    typeof pool.entries === "function" &&
    typeof pool.get === "function"
  )
    for (const [id, value] of pool) {
      if (value && typeof value === "object")
        add({ id, ...value }, "native-learn-pool", true);
      else add({ id, unverifiedPoolValue: true }, "unverified-learn-pool");
    }
  if (typeof data.moveGuide === "function" && player.speciesId != null) {
    try {
      const league =
        options.inLeague || ((id) => data.app?.meta?.inLeague?.(id) === true);
      const guide = data.moveGuide(
        player.speciesId,
        player.roster,
        player.types || [],
        league,
      );
      for (const key of ["kit", "line", "shared", "any"])
        for (const row of guide?.[key] || []) add(row, `native-guide-${key}`);
    } catch {
      /* Missing optional guide metadata cannot block native offers. */
    }
  }
  return entries;
}

export function analyzeMoveReadiness(run, data = {}, options = {}) {
  const player = run?.player || {},
    level = Number(player.level) || 1;
  const slots = choiceSlotState(player);
  const held = new Set(slots.moves.map((move) => choiceMoveKey(move, data)));
  const offered = new Set(
    (options.offers || [])
      .filter((offer) => offer?.kind === "newMove")
      .map((offer) => choiceMoveKey(offer.id, data)),
  );
  const unavailable = new Set(run?.build?.unavailableMoves || []);
  const available =
    run.availableMoveKeys == null ? null : new Set(run.availableMoveKeys);
  const rows = choiceGuideEntries(run, data, options);
  const nearLevels = Math.min(6, Math.max(1, Number(options.nearLevels) || 3));
  const nextEvo = run.nativeRun?.nextEvo ?? run.nextEvo;
  const banished = run.nativeRun?.banished ?? run.banished;
  return choiceMovePreferences(run.build).map((preference) => {
    const { key } = preference;
    const result = {
      ...preference,
      state: "unknown",
      requiredLevel: null,
      reason: "availability-not-verified",
    };
    if (held.has(key))
      return { ...result, state: "held", reason: "equipped-native-move" };
    if (offered.has(key))
      return {
        ...result,
        state: "now",
        requiredLevel: level,
        reason: "currently-offered-by-native-game",
      };
    const def = choiceDefinition(data, key);
    if (unavailable.has(key) || banished?.has?.(`m${def.id}`))
      return {
        ...result,
        state: "unavailable",
        reason: unavailable.has(key) ? "plan-unavailable" : "native-banish",
      };
    if (slots.moves.some(move => Array.isArray(move.parents) && move.parents.includes(def.id)))
      return { ...result, state:"unavailable", reason:"native-fusion-parent-consumed" };
    if (def.arch === "fusion")
      return { ...result, state:"unavailable", reason:"native-fusion-recipe-required" };
    try {
      if (
        typeof data.canLearnMove === "function" &&
        data.canLearnMove(key, player) === false
      )
        return {
          ...result,
          state: "unavailable",
          reason: "native-cannot-learn",
        };
    } catch {
      /* An optional lookup failure is unknown, not a made-up unlock. */
    }
    const matches = rows.filter((row) => row.key === key);
    const usable = matches.filter(
      (row) =>
        row.open !== false && row.available !== false && row.locked !== true,
    );
    if (def.arch === "random" && slots.moves.filter(move=>move.def?.arch==="random").length>=sharedRandomMoveLimit(data) && usable.length &&
        usable.every(row=>row.source==="native-guide-shared"||row.fusionRouteSource==="shared"))
      return {...result,state:"unavailable",reason:"native-shared-random-already-held"};
    if (matches.length && !usable.length)
      return {
        ...result,
        state: "unavailable",
        reason: "native-unlock-closed",
      };
    const possibilities = usable.map((row) => {
      let required = Number(row.level ?? row.requiredLevel ?? row.minLevel);
      const otherSpecies =
        row.speciesId != null && row.speciesId !== player.speciesId;
      if (otherSpecies) {
        if (
          nextEvo?.to !== row.speciesId ||
          !Number.isFinite(Number(nextEvo.level))
        )
          return {
            state: "far",
            requiredLevel: Number.isFinite(required) ? required : null,
            reason: "evolution-not-verified-nearby",
          };
        required = Math.max(
          Number.isFinite(required) ? required : 1,
          Number(nextEvo.level),
        );
        return {state:required<=level+nearLevels?"near":"far",requiredLevel:required,reason:"evolution-still-required"};
      }
      if (Number.isFinite(required))
        return {
          state:
            required <= level
              ? "now"
              : required <= level + nearLevels
                ? "near"
                : "far",
          requiredLevel: required,
          reason: row.source,
        };
      if (row.current && !row.unverifiedPoolValue && !otherSpecies)
        return { state: "now", requiredLevel: level, reason: row.source };
      return { state: "unknown", requiredLevel: null, reason: row.source };
    });
    const rank = { now: 0, near: 1, unknown: 2, far: 3 };
    possibilities.sort((a, b) => rank[a.state] - rank[b.state]);
    if (possibilities[0]) return { ...result, ...possibilities[0] };
    if (available && !available.has(key))
      return {
        ...result,
        state: "unavailable",
        reason: "not-in-native-available-directory",
      };
    if (available?.has(key))
      result.reason = "eventual-directory-does-not-prove-current-availability";
    return result;
  });
}

// This is a first-acquisition preference on upgrade pages, not a global score
// bonus. Only the caller's permitted candidates may participate. Capture the
// configured build before automatic vitamin completion: fallback entries are
// not evidence that a card belongs to the user's plan.
function starPiecePlanned(run, build = run.build || {}) {
  const final = run.finalReplacement?.towerPursuit || run.finalReplacement || build.finalReplacement;
  const targets = [final?.vitamins, final?.strictVitamins].filter(rule => rule?.enabled);
  if (targets.some(rule => !rule.targets.includes("star-piece-v"))) return false;
  if (targets.some(rule => rule.targets.includes("star-piece-v"))) return true;
  if (build.avoidVitamins?.includes("star-piece-v") ||
      build.vitaminRules?.some(rule => rule.key === "star-piece-v" && rule.avoid)) return false;
  return (build.vitaminRules || []).some(rule => rule.key === "star-piece-v" && !rule.avoid) ||
    (build.vitaminPriority || build.vitamins || []).some(value =>
      (typeof value === "string" ? value : value?.key || value?.k) === "star-piece-v");
}

function firstStarPieceChoice(candidates, offers, run, configuredBuild) {
  if(towerLuckTiming(run))return null;
  if (!starPiecePlanned(run, configuredBuild)) return null;
  if (run.player.vitamins?.has?.("star-piece-v")) return null;
  const permitted = candidates.filter(entry => entry.strictAllowed &&
    Number.isFinite(entry.rawScore) && entry.rawScore >= 0),
    star = permitted.find(entry => entry.kind === "newVit" && entry.key === "star-piece-v");
  if (!star) return null;
  const final = run.finalReplacement?.towerPursuit || run.finalReplacement || run.build?.finalReplacement;
  if (final?.vitamins?.enabled && !final.vitamins.targets.includes("star-piece-v") ||
      final?.strictVitamins?.enabled && !final.strictVitamins.targets.includes("star-piece-v")) return null;
  const keys = values => (values || []).map(value => typeof value === "string" ? value : value?.key || value?.k),
    moves = new Set([...(configuredBuild.configuredMovePreferences || choiceMovePreferences(configuredBuild)).map(row => row.key),
      ...(final?.strictMoves?.enabled ? final.strictMoves.targets : []),
      ...(final?.moves?.enabled ? final.moves.targets : []),
      ...(final?.fusion?.enabled ? final.fusion.targets : []),
      ...(final?.fusion?.enabled ? final.fusion.pending?.parents || [] : [])]),
    vitamins = new Set([...(configuredBuild.vitaminRules || []).filter(row => !row.avoid).map(row => row.key),
      ...keys(configuredBuild.vitaminPriority || configuredBuild.vitamins),
      ...(final?.strictVitamins?.enabled ? final.strictVitamins.targets : []),
      ...(final?.vitamins?.enabled ? final.vitamins.targets : [])]),
    items = new Set([...(configuredBuild.itemRules || []).filter(row => !row.avoid).map(row => row.key),
      ...keys(configuredBuild.items)]);
  if (!moves.size && !vitamins.size && !items.size &&
      !["custom", "guide", "leaderboard"].includes(configuredBuild.sourceType)) return null;
  const planned = entry => ["newMove", "upMove"].includes(entry.kind) ? moves.has(entry.key)
    : ["newVit", "upVit"].includes(entry.kind) ? vitamins.has(entry.key)
    : entry.kind === "item" && items.has(entry.key);
  // Native rarity 0..4: common, uncommon, rare (blue), epic, legendary.
  // Preserve the existing ordering among qualifying higher-rarity plan cards.
  return permitted.find(entry => planned(entry) && offers[entry.index].rarity >= 2 &&
    offers[entry.index].rarity > offers[star.index].rarity) || star;
}

function choiceNormalizeOffer(raw, kind, data) {
  const offer =
    kind === "itemChoice" &&
    (typeof raw === "string" || typeof raw === "number")
      ? { kind: "item", id: raw }
      : raw;
  if (!offer || typeof offer !== "object") return null;
  const maximumRarity = Math.max(4, (data.rarityMultipliers?.length || 0) - 1);
  return {
    ...offer,
    rarity: Math.min(maximumRarity, Math.max(0, Number(offer.rarity) || 0)),
  };
}

function choiceNativeLegal(raw, offer, index, run, data, options, slots) {
  if (!offer || raw?.disabled === true || raw?.hidden === true) return false;
  if (Array.isArray(options.legal) && options.legal[index] !== true)
    return false;
  try {
    if (
      typeof options.legal === "function" &&
      options.legal(index, raw) !== true
    )
      return false;
  } catch {
    return false;
  }
  if (
    Array.isArray(options.legalIndices) &&
    !options.legalIndices.includes(index)
  )
    return false;
  const player = run.player;
  if (offer.kind === "newMove") {
    const key = choiceMoveKey(offer.id, data);
    if (
      slots.freeSlots === 0 ||
      slots.moves.some((move) => choiceMoveKey(move, data) === key)
    )
      return false;
  }
  if (offer.kind === "upMove" && !player.moves?.[offer.slot]) return false;
  if(offer.kind==="upMove"&&typeof player.capOf==="function"){
    try{const cap=Number(player.capOf(player.moves[offer.slot]));
      if(Number.isFinite(cap)&&Number(player.moves[offer.slot].level)>=cap)return false;
    }catch{return false;}
  }
  if (offer.kind === "item") {
    const key = offer.id ?? offer.key;
    try {
      if (typeof player.canHold === "function" && !player.canHold(key))
        return false;
    } catch {
      return false;
    }
    const max = data.items?.get?.(key)?.max;
    if (Number.isFinite(max) && (player.items?.get?.(key) || 0) >= max)
      return false;
  }
  if (
    offer.kind === "newVit" &&
    Number.isFinite(player.vitaminSlots) &&
    !player.vitamins?.has?.(offer.vit) &&
    (player.vitamins?.size || 0) >= player.vitaminSlots
  )
    return false;
  if(offer.kind==="upVit"&&Number.isFinite(player.vitCap)){
    const held=player.vitamins?.get?.(offer.vit),level=typeof held==="number"?held:held?.level;
    if(!held||Number(level)>=player.vitCap)return false;
  }
  return true;
}

function choiceRawScore(offer, run, data, options = {}) {
  try {
    const final = run.finalReplacement || run.build?.finalReplacement,
      category = ["newMove", "upMove"].includes(offer.kind) && final?.strictMoves?.enabled ? "move"
        : ["newVit", "upVit"].includes(offer.kind) && final?.strictVitamins?.enabled ? "vitamin" : null;
    if (category && strictOfferAllowed(offer, run, data)) {
      // A current strict permission outranks an older custom plan's bans or
      // target counts in this category. Score only this offer against a derived
      // view: do not loosen another category or mutate the saved custom plan.
      run = {...run, build: {...run.build, [`${category}Rules`]: [],
        [category === "move" ? "avoidMoves" : "avoidVitamins"]: [],
        ...(category === "vitamin" ? {itemCounts: {}} : {}), allowOffPlan: true}};
    } else if (["newMove", "upMove"].includes(offer.kind) &&
        (final?.moves?.active || final?.fusion?.active && final.fusion.pending)) {
      // Final move preparation replaces move preferences only. It must not
      // silently permit unlisted vitamins, shop purchases or copied items.
      run = {...run, build: {...run.build, allowOffPlan: true}};
    }
    const score = scoreOffer(offer, run, data, options);
    // Unknown future offer kinds remain eligible fallback cards, but rarity
    // alone is no evidence that their unknown effect improves combat.
    if (
      !["newMove", "upMove", "newVit", "upVit", "item"].includes(offer.kind) &&
      !Array.isArray(offer.mods)
    )
      return 0;
    return Number.isNaN(score) ? -Infinity : score;
  } catch {
    return -Infinity;
  }
}

function choiceRecoveryValue(offer, run, data, actualScore) {
  if (
    !(actualScore > 20) ||
    !(run.player.maxHp > 0) ||
    run.player.hp / run.player.maxHp >= 0.3
  )
    return 0;
  const stats = new Set([
    "regen",
    "healing",
    "lifesteal",
    "heal",
    "maxHp",
    "shieldMax",
    "armor",
    "evasion",
  ]);
  const vitamin = data.vitamins?.get?.(offer.vit);
  const knownRecoveryVitamin = [
    "super-potion",
    "hp-up",
    "iron",
    "zinc",
    "max-potion",
    "x-defense",
  ].includes(offer.vit);
  const item = data.items?.get?.(offer.id ?? offer.key);
  const mods = [
    ...(Array.isArray(offer.mods) ? offer.mods : []),
    ...(Array.isArray(item?.mods) ? item.mods : []),
  ];
  const recovering =
    knownRecoveryVitamin ||
    stats.has(vitamin?.stat) ||
    mods.some(
      (mod) =>
        stats.has(mod.stat) &&
        ((Number(mod.add) || 0) > 0 || Number(mod.mul) > 1),
    ) ||
    (offer.kind === "newMove" &&
      Number(choiceDefinition(data, offer.id).drain) > 0);
  return recovering ? Math.min(32, actualScore * 0.35) : 0;
}

function choiceNominalDamage(move, player) {
  const def = move?.def || move || {},
    mods = move?.mods || {};
  if (
    ["buff", "weather", "random"].includes(def.arch) ||
    !(def.dmg > 0) ||
    !(def.cd > 0)
  )
    return null;
  const cls = ["physical", "special"].includes(def.cls)
    ? Number(player.stats?.[def.cls]) || 1
    : 1;
  return (
    (Number(def.dmg) *
      (Number(mods.dmg) || 1) *
      Math.max(
        1,
        Math.floor((Number(def.count) || 1) + (Number(mods.count) || 0)),
      ) *
      cls) /
    Math.max(0.12, Number(def.cd) * (Number(mods.cd) || 1))
  );
}

function choiceDamageClue(offer, run, data) {
  if (offer.kind !== "newMove") return 0;
  const nominal = choiceNominalDamage(
    choiceDefinition(data, offer.id),
    run.player,
  );
  const current = (run.player.moves || [])
    .filter(Boolean)
    .map((move) => choiceNominalDamage(move, run.player))
    .filter((value) => value > 0);
  if (!(nominal > 0) || !current.length) return 0;
  // Nominal damage per cooldown is only a bounded comparison clue. Actual hit
  // counts, area coverage and enemy resistances are not known from an offer.
  const baseline =
    current.reduce((sum, value) => sum + value, 0) / current.length;
  return Math.min(
    18,
    Math.max(-12, Math.log2(Math.max(0.1, nominal / baseline)) * 8),
  );
}

/**
 * options.kind defaults to upgrade. Reroll/skip require BOTH native remaining
 * counters and explicit legal-button confirmation. nextHistory is committed by
 * the host after the native action, never while a random delay is still waiting.
 */
export function chooseOfferAction(
  offers = [], run = {}, data = {}, options = {},
) {
  const decision=chooseOfferActionBase(offers,run,data,options);
  if(decision.reason==='experience-first' || towerLuckTiming(run))return decision;
  if(["tower-fusion-material","tower-first-plan-acquisition"].includes(decision.reason))return decision;
  // Keep the first-acquisition rule and all non-choice/search decisions intact.
  // For an already held vitamin, prefer a legal Star Piece of equal or higher
  // rarity. Orange choices and lower-rarity Star Pieces keep ordinary scoring.
  if((options.kind || "upgrade")!=="upgrade" || decision.action!=="choose" ||
      !run.player?.vitamins?.has?.("star-piece-v") || !starPiecePlanned(run) || decision.index==null)return decision;
  const chosen=choiceNormalizeOffer(offers[decision.index],"upgrade",data);
  if(chosen?.rarity===4 && chosen.vit!=="star-piece-v")return decision;
  const star=decision.candidates?.find(entry=>entry.kind==="upVit" && entry.key==="star-piece-v" &&
      entry.strictAllowed && Number.isFinite(entry.rawScore) && entry.rawScore>=0 &&
      choiceNormalizeOffer(offers[entry.index],"upgrade",data)?.rarity>=chosen?.rarity);
  if(!star)return decision;
  const nextHistory={...decision.nextHistory};
  for(const [key,opportunities] of [["vitaminDeferrals","vitaminOpportunities"],["moveDeferrals","moveOpportunities"]])
    if(Object.hasOwn(nextHistory,key))nextHistory[key]=Math.min(6,(decision.history?.[key] || 0)+
      (decision.growth?.[opportunities]>0 ? 1 : 0));
  const reason=choiceNormalizeOffer(offers[star.index],"upgrade",data)?.rarity>chosen?.rarity
    ? "higher-rarity-star-piece-priority" : "same-rarity-star-piece-priority";
  return {...decision,index:star.index,score:star.score,reason,
    candidates:[star,...decision.candidates.filter(entry=>entry!==star)],nextHistory};
}

function chooseOfferActionBase(
  offers = [],
  run = {},
  data = {},
  options = {},
) {
  run={...run,experienceBlessingPriority:(options.kind || "upgrade")!=="upgrade" && (options.experienceBlessingPriority ?? run.experienceBlessingPriority)};
  const rawCost=options.costSettings||run.costPolicy,
    costPolicy=rawCost?{...rawCost,...normalizeCostSettings(rawCost)}:null;
  if(costPolicy)run={...run,costPolicy};
  const configuredBuild = run.build || {};
  if (run.finalReplacement) run = {...run,build:finalReplacementBuild(run.build,run.finalReplacement)};
  if(run.build?.towerStrategy)run={...run,build:applyTowerStrategy(run.build,run.build.towerStrategy,run.nativeRun,data)};
  run = {...run,build:{...run.build,vitaminPriority:completeVitaminPreferences(run.build,data)}};
  const player = run.player || { moves: [] },
    build = run.build || {},
    kind = options.kind || "upgrade";
  run = { ...run, player };
  const towerGoals = towerLoadoutProgress(run, data);
  const slots = choiceSlotState(player),
    preferences = choiceMovePreferences(build);
  const normalized = (Array.isArray(offers) ? offers : []).map((offer) =>
    choiceNormalizeOffer(offer, kind, data),
  );
  const soleUpgrade = kind === "upgrade" && normalized.length === 1;
  const readiness = analyzeMoveReadiness(run, data, {
    ...options,
    offers: normalized,
  });
  const history = {
    unplannedRounds: Math.max(0, Number(options.history?.unplannedRounds) || 0),
    rerollsThisPage: Math.max(0, Number(options.history?.rerollsThisPage) || 0),
    ...(Number(options.history?.vitaminDeferrals)>0 ? {vitaminDeferrals:Math.min(6,Number(options.history.vitaminDeferrals))} : {}),
    ...(Number(options.history?.moveDeferrals)>0 ? {moveDeferrals:Math.min(6,Number(options.history.moveDeferrals))} : {}),
  };
  const maximumRounds = Math.min(
    8,
    Math.max(1, Number(options.maxUnplannedRounds) || 3),
  );
  const reserveUntil = Math.max(1, Number(build.reserveUntilLevel) || 20);
  const missing = readiness.filter(
    (entry) => !["held", "unavailable"].includes(entry.state),
  );
  const nearMissing = missing.filter((entry) =>
    ["now", "near"].includes(entry.state),
  );
  const waitingForPlan =
    slots.freeSlots > 0 &&
    nearMissing.length > 0 &&
    (Number(player.level) || 1) <= reserveUntil &&
    history.unplannedRounds < maximumRounds;
  const neutralBuild = { ...build, moves: [], reserveUntilLevel: 0 };
  if (build.sourceType === "custom" && Array.isArray(build.moveRules))
    neutralBuild.moveRules = [...build.moveRules].sort(
      (a, b) => (Number(a.priority) || 0) - (Number(b.priority) || 0),
    );
  const context = {
    ...run,
    choiceKind:kind,
    build: neutralBuild,
    ...(kind === "itemChoice" ? { purpose: run.purpose || "free" } : {}),
  };
  const fallbackContext = {
    ...context,
    build: build.statWeights ? { statWeights: build.statWeights } : {},
  };
  const candidates = [], benefitEvaluations = [],costRejected=[];
  const vitaminFinal = run.finalReplacement?.towerPursuit || run.finalReplacement || build.finalReplacement;
  for (let index = 0; index < normalized.length; index++) {
    const offer = normalized[index];
    if (
      !choiceNativeLegal(offers[index], offer, index, run, data, options, slots)
    )
      continue;
    // Exact challenge constraints are not optional build preferences. A
    // mandatory fallback cannot silently select a vitamin/item that fails
    // the selected native achievement; use real skip/reroll or await input.
    const descriptor=costOfferDescriptor(offer,data),forcedCost=costPolicy?.forceCostInteractions===true&&
      descriptor.cost&&descriptor.positiveEffects.length>0,
      costDenied=descriptor.cost&&costPolicy&&!forcedCost&&
        (costPolicy.riskyInteractions!==true||costPolicy.allowAutomatic===false||!masteryOfferAllowed(offer,context,data));
    if(!forcedCost&&!costDenied&&!masteryOfferAllowed(offer,context,data))continue;
    const benefit=evaluateOfferBenefit(offer,run,data),
      priority=offer.kind==="item"?itemPriority(offer.id || offer.key,build):null;
    benefitEvaluations.push({index,nativeLegal:true,...benefit});
    const freeItem=offer.kind==='item'&&(context.purpose || 'free')==='free';
    if(!forcedCost&&!characterEvasionItemPriority(offer,context,data)&&benefit.hardRejected&&!soleUpgrade&&!freeItem)continue;
    const key = ["newMove", "upMove"].includes(offer.kind)
      ? choiceMoveKey(
          offer.kind === "upMove" ? player.moves[offer.slot] : offer.id,
          data,
        )
      : (offer.vit ?? offer.id ?? offer.key);
    const vitaminSlotReserved = offer.kind === "newVit" && !player.vitamins?.has?.(key) &&
        Number.isFinite(player.vitaminSlots) && towerGoals.vitamins?.size > 0 &&
        !towerGoals.vitamins.has(key) && player.vitaminSlots - (player.vitamins?.size || 0) <=
          [...towerGoals.vitamins].filter(wanted => !player.vitamins?.has?.(wanted)).length;
    if ((run.nativeRun || run).tower && ["newVit","upVit"].includes(offer.kind) &&
        (build.avoidVitamins?.includes(key) || build.vitaminRules?.some(rule=>rule.key===key && rule.avoid)))continue;
    const preferred = preferences.find((entry) => entry.key === key);
    const finalVitaminTarget = offer.kind === "newVit" && vitaminFinal?.vitamins?.active && vitaminFinal.vitamins.targets.includes(key);
    let rawScore = choiceRawScore(offer, context, data, {allowZeroBenefit:soleUpgrade}),
      actualScore = choiceRawScore(offer, fallbackContext, data, {allowZeroBenefit:soleUpgrade});
    if(offerExperiencePriority(offer,run,data)>0&&!Number.isFinite(rawScore))continue;
    if (finalVitaminTarget && Number.isFinite(rawScore)) rawScore = Math.max(0, rawScore);
    if(costDenied||descriptor.cost&&costPolicy&&!forcedCost&&!(rawScore>0)&&!offerExperiencePriority(offer,run,data)){
      if(vitaminSlotReserved)continue;
      costRejected.push({index,key,kind:offer.kind,score:costPositiveScore(descriptor,run),
        actualScore:costPositiveScore(descriptor,run),rawScore,legal:true,strictAllowed:emptyFinalSlotOfferAllowed(offer,run,data),cost:true,
        costRank:costPriorityRank(descriptor,costPolicy),positiveEffects:descriptor.positiveEffects});
      continue;
    }
    if(offer.kind==="item"&&(!Number.isFinite(rawScore)||!freeItem&&rawScore<=0&&!offerExperiencePriority(offer,run,data)))continue;
    let score = rawScore,
      preferenceBonus = 0,
      heldUpgradeBonus = 0,
      reservationPenalty = 0,
      damageClue = 0;
    if (Number.isFinite(rawScore) && rawScore > 0) {
      if (offer.kind === "newMove" && preferred)
        preferenceBonus = Math.min(
          Math.max(12, 44 - preferred.rank * 3),
          rawScore * 0.4,
        );
      if (offer.kind === "upMove") {
        // A near-permanent fixed-strength buff still has almost no marginal
        // value: useful upgrade preference never manufactures a flat bonus.
        const useful = Math.max(0, rawScore - 5);
        heldUpgradeBonus = Math.min(18, useful * 0.4);
        if (preferred)
          preferenceBonus = Math.min(
            Math.max(8, 24 - preferred.rank * 2),
            useful * 0.3,
          );
      }
      if (offer.kind === "newMove" && !preferred && preferences.length)
        reservationPenalty = waitingForPlan
          ? 44
          : missing.length && history.unplannedRounds < maximumRounds
            ? 20
            : 0;
      damageClue = choiceDamageClue(offer, run, data);
      score +=
        preferenceBonus +
        heldUpgradeBonus -
        reservationPenalty +
        damageClue +
        choiceRecoveryValue(offer, run, data, actualScore);
    }
    const final = run.finalReplacement || build.finalReplacement,
      fusionPending=final?.fusion?.active?final.fusion.pending:null;
    let fusionPriority=false,fusionCompletionBonus=0;
    if(fusionPending?.available) {
      const parent=fusionPending.parents.includes(key), current=offer.kind==="upMove"?player.moves?.[offer.slot]:null,
        nextParent=fusionPending.learningOrder?.find(wanted=>!player.moves?.some(move=>choiceMoveKey(move,data)===wanted));
      if(offer.kind==="newMove" && parent && (!nextParent||key===nextParent)) {score=Math.max(0,score)+200000;fusionPriority=true;}
      else if(offer.kind==="upMove" && parent && !fusionPending.relearnSlots.includes(offer.slot) && Number(current?.level)===7 &&
        fusionPending.parents.every(wanted=>wanted===key || player.moves?.some(move=>choiceMoveKey(move,data)===wanted && Number(move.level)>=8))) {
        fusionCompletionBonus=8;score+=fusionCompletionBonus;
      }
      else if(offer.kind==="newMove" && fusionPending.needsTemporaryOutput &&
          !["buff","weather","fusion","random"].includes(choiceDefinition(data,offer.id).arch)) {
        score=Math.max(0,score)+190000;fusionPriority=true;
      }
    }
    let temporaryOutputPriority=false;
    if (!fusionPending && final?.moves?.active && final.moves.missing?.length) {
      const prep=final.moves.randomPreparation,
        nextRandom=prep?.learningOrder?.find(wanted=>!player.moves?.some(move=>choiceMoveKey(move,data)===wanted)),
        wrongRandomOrder=offer.kind==="newMove"&&choiceDefinition(data,offer.id).arch==="random"&&nextRandom&&key!==nextRandom;
      if (offer.kind === "newMove" && final.moves.targets.includes(key) && !wrongRandomOrder) score = Math.max(0,score) + 100000;
      else if (offer.kind === "newMove" && final.moves.readyMissing?.length) score -= 1000;
      if(prep?.available&&prep.needsTemporaryOutput&&offer.kind==="newMove"&&
        !["buff","weather","fusion","random"].includes(choiceDefinition(data,offer.id).arch)) {
        score=Math.max(0,score)+190000;temporaryOutputPriority=true;
      }
    }
    if (final?.vitamins?.active && final.vitamins.missing?.length) {
      if (offer.kind === "newVit" && final.vitamins.targets.includes(key)) score = Math.max(0,score) + 90000;
      else if (offer.kind === "newVit" && (final.vitamins.readyMissing || final.vitamins.missing)?.length) score -= 1000;
    }
    if(['upMove','upVit'].includes(offer.kind)&&final?.banishSlots?.rows.some(row=>row.blank&&!row.done&&row.level<row.threshold&&
        row.kind===(offer.kind==='upMove'?'move':'vitamin')&&row.key===key))score=Math.max(0,score)+80000;
    candidates.push({
      index,
      key,
      kind: offer.kind,
      score,
      rawScore,
      actualScore,
      benefit,priority,utilityTier:offerUtilityTier(offer,context,data),
      experiencePriority:Number.isFinite(rawScore)?offerExperiencePriority(offer,run,data,kind):0,
      conditionalBenefit:offer.kind==="item"?conditionalItemBenefit(key,player,data):null,
      recommended: !!preferred,
      preferenceRank: preferred?.rank ?? null,
      preferenceBonus,
      heldUpgradeBonus,
      reservationPenalty,
      damageClue,
      legal: true,
      fusionPriority,
      fusionCompletionBonus,
      temporaryOutputPriority,
      // Reservation blocks acquisition, not native banishment of an unwanted card.
      vitaminSlotReserved,
      strictAllowed: emptyFinalSlotOfferAllowed(offer,run,data)&&(forcedCost||strictOfferAllowed(offer, run, data)),
      cost:descriptor.cost,forcedCost,costRank:costPriorityRank(descriptor,costPolicy||{}),positiveEffects:descriptor.positiveEffects,
    });
  }
  const nativeCandidates=[...candidates];
  const strictRejected=candidates.filter(entry=>!entry.strictAllowed && !entry.vitaminSlotReserved);
  for(let index=candidates.length-1;index>=0;index--)if(!candidates[index].strictAllowed || candidates[index].vitaminSlotReserved)candidates.splice(index,1);
  candidates.sort(compareOfferCandidates);
  if(costPolicy){
    const costChoices=candidates.filter(entry=>entry.cost).sort((a,b)=>b.experiencePriority-a.experiencePriority || compareCostChoices(a,b)),preferredCost=costChoices[0];
    // Priority ranks compare cost choices with each other. Keep normal upgrades
    // in their existing score order; they are not part of the ten-rank list.
    if(costChoices.length>1)for(let index=candidates.length-1;index>=0;index--)
      if(candidates[index].cost&&candidates[index]!==preferredCost)candidates.splice(index,1);
  }
  const native = run.nativeRun || run;
  const rerolls = Math.max(0, Number(options.rerolls ?? native.rerolls) || 0),
    skips = Math.max(0, Number(options.skips ?? native.skips) || 0);
  const strictActive=!!((run.finalReplacement||build.finalReplacement)?.strictMoves?.enabled||
    (run.finalReplacement||build.finalReplacement)?.strictVitamins?.enabled||
    (run.finalReplacement||build.finalReplacement)?.emptySlots?.moves?.active||
    (run.finalReplacement||build.finalReplacement)?.emptySlots?.vitamins?.active||
    (run.finalReplacement||build.finalReplacement)?.banishSlots?.active);
  const canReroll =
    kind === "upgrade" &&
    options.rerollLegal === true &&
    rerolls > 0;
  const canSkip = kind === "upgrade" && options.skipLegal === true && skips > 0;
  if(!candidates.length&&costRejected.length&&!canReroll&&!canSkip&&options.nativeMandatory===true)
    candidates.push(...costRejected.sort(compareCostChoices));
  const strictForced=strictActive&&kind==="upgrade"&&!candidates.length&&strictRejected.length>0&&!canReroll&&!canSkip;
  if(strictForced)candidates.push(...strictRejected.sort((a,b)=>b.actualScore-a.actualScore||a.index-b.index));
  const allUnrecommendedNew =
    candidates.length > 0 &&
    candidates.every((entry) => entry.kind === "newMove" && !entry.recommended);
  const boundedUnknownSearch =
    slots.freeSlots > 0 &&
    missing.some((entry) => entry.state === "unknown") &&
    history.unplannedRounds === 0 &&
    history.rerollsThisPage === 0 &&
    (Number(player.level) || 1) <= reserveUntil;
  const onlyBad =
    !Number.isFinite(candidates[0]?.score) || candidates[0]?.priority==null && candidates[0]?.score <= 0;
  const unknownEffectOnly=candidates.length>0&&candidates.every(entry=>
    !['newMove','upMove','newVit','upVit','item'].includes(entry.kind)&&!Array.isArray(normalized[entry.index]?.mods));
  const searchPlan =
    allUnrecommendedNew && (waitingForPlan || boundedUnknownSearch ||
      run.finalReplacement?.moves?.active && run.finalReplacement.moves.readyMissing?.length>0 && history.unplannedRounds<maximumRounds) ||
    run.finalReplacement?.vitamins?.active && (run.finalReplacement.vitamins.readyMissing || run.finalReplacement.vitamins.missing)?.length>0 &&
      history.unplannedRounds<maximumRounds && candidates.length>0 &&
      candidates.every(entry=>entry.kind==="newVit" && !run.finalReplacement.vitamins.targets.includes(entry.key));
  const fusionPending=run.finalReplacement?.fusion?.active?run.finalReplacement.fusion.pending:null,
    searchFusion=!!fusionPending?.available &&
      (fusionPending.needLearn.length>0||fusionPending.needsTemporaryOutput) &&
      history.unplannedRounds<maximumRounds && candidates.length>0 && !candidates.some(entry=>entry.fusionPriority ||
        entry.rawScore>0 && ["upMove","newVit","upVit"].includes(entry.kind)),
    searchTemporaryOutput=!fusionPending&&run.finalReplacement?.moves?.active&&
      run.finalReplacement.moves.randomPreparation?.available&&run.finalReplacement.moves.randomPreparation.needsTemporaryOutput&&
      history.unplannedRounds<maximumRounds&&candidates.length>0&&!candidates.some(entry=>entry.temporaryOutputPriority),
    searchDesired=(searchPlan||searchFusion||searchTemporaryOutput)&&
      !candidates.some(entry=>entry.fusionPriority||entry.temporaryOutputPriority);
  const emergency = candidates.some(
    (entry) =>
      choiceRecoveryValue(
        normalized[entry.index],
        run,
        data,
        entry.actualScore,
      ) > 0,
  );
  const final = run.finalReplacement || build.finalReplacement,
    preparingFinal = final?.fusion?.active && final.fusion.pending?.available,
    usefulVitamins = kind === "upgrade" && !final?.strictVitamins?.enabled && (!preparingFinal || towerGoals.strict && !towerGoals.vitaminsRestricted) &&
      Number.isFinite(player.vitaminSlots) && (player.vitamins?.size || 0) < player.vitaminSlots
      ? candidates.filter(entry => entry.kind === "newVit" && entry.rawScore > 0 && entry.actualScore > (towerGoals.strict ? 0 : 15)) : [],
    // Final destinations are preferences, not permission to leave productive
    // capacity empty while only old-move upgrades keep winning. A compatible
    // temporary attack can occupy one vacancy after bounded real opportunities
    // and later be replaced normally. Native legality and explicit strict
    // choices were filtered above; random/weather/buff/fusion acquisitions
    // cannot serve as this temporary output fallback.
    usefulMoves = kind === "upgrade" && slots.freeSlots > 0 && !final?.strictMoves?.enabled
      ? candidates.filter(entry => entry.kind === "newMove" && entry.rawScore > 0 && entry.actualScore > 20 &&
          Number(choiceDefinition(data, normalized[entry.index].id).dmg) > 0 &&
          !["buff","weather","random","fusion"].includes(choiceDefinition(data, normalized[entry.index].id).arch) &&
          !(preparingFinal&&final.unified?.ordinaryTargets?.includes(entry.key))) : [],
    dueVitamins = (history.vitaminDeferrals || 0) >= 2 ? usefulVitamins : [],
    dueMoves = (history.moveDeferrals || 0) >= 3 ? usefulMoves : [],
    growthDue = [...dueVitamins,...dueMoves].sort((a,b) => b.score-a.score || a.index-b.index),
    // An exceptional early attack may win one extra page, but cannot keep an
    // empty category waiting forever. Counts advance only in nextHistory;
    // the host commits that object after a real native click/choice succeeds.
    exceptionalEarly = Number(player.level) <= 8 && candidates[0]?.kind !== "newVit" &&
      Number(normalized[candidates[0]?.index]?.rarity) >= 3 &&
      candidates[0]?.actualScore > (growthDue[0]?.actualScore || Infinity) * 2 &&
      (dueVitamins.length ? (history.vitaminDeferrals || 0) < 3 : (history.moveDeferrals || 0) < 4),
    growthChoice = !emergency && !exceptionalEarly &&
      !candidates.some(entry=>entry.fusionPriority||entry.temporaryOutputPriority) ? growthDue[0] : null;
  const growthHistory = chosen => ({
    ...(history.vitaminDeferrals != null || usefulVitamins.length ?
      {vitaminDeferrals:chosen?.kind === "newVit" ? 0 :
        Math.min(6,(history.vitaminDeferrals || 0)+(usefulVitamins.length ? 1 : 0))} : {}),
    ...(history.moveDeferrals != null || usefulMoves.length ?
      {moveDeferrals:chosen?.kind === "newMove" ? 0 :
        Math.min(6,(history.moveDeferrals || 0)+(usefulMoves.length ? 1 : 0))} : {}),
  });
  const metadata = {
    readiness,
    candidates,
    benefitEvaluations,
    slots: { actual: slots.slots, free: slots.freeSlots },
    waitingForPlan,
    history,
    growth: {vitaminOpportunities:usefulVitamins.length,moveOpportunities:usefulMoves.length,
      due:growthChoice?.kind || null},
    strictForced,
  };
  const experience=candidates.find(entry=>entry.experiencePriority>0 && Number.isFinite(entry.rawScore));
  if(experience)return {...metadata,action:'choose',index:experience.index,score:experience.score,
    reason:experience.experiencePriority===2?'blessing-damage-first':'experience-first',fallback:false,nextHistory:{...history,rerollsThisPage:0,...growthHistory(experience)}};
  const evasionChoice=candidates.find(entry=>entry.score>0&&characterEvasionItemPriority(normalized[entry.index],run,data)>0);
  if(evasionChoice)return {...metadata,action:"choose",index:evasionChoice.index,score:evasionChoice.score,
    reason:"character-evasion-priority",fallback:false,nextHistory:{...history,rerollsThisPage:0,...growthHistory(evasionChoice)}};
  const forcedCosts=candidates.filter(entry=>entry.forcedCost).sort(compareCostChoices);
  if(forcedCosts.length){const best=forcedCosts[0];return {...metadata,action:"choose",index:best.index,
    score:best.score,reason:"forced-native-positive-cost",fallback:false,
    nextHistory:{...history,rerollsThisPage:0,...growthHistory(best)}};}
  if (kind === "upgrade" && towerGoals.strict && !towerGoals.complete) {
    const impossibility=towerLoadoutImpossibility(run,data,{offers:normalized.filter((offer,index)=>
      choiceNativeLegal(offers[index],offer,index,run,data,options,slots))});
    if(impossibility.confirmed)return {...metadata,action:"restart",index:null,score:null,
      reason:"tower-target-confirmed-impossible",impossibility,fallback:false,strictTower:true,
      nextHistory:{...history}};
  }
  // With one native option, spending skips/rerolls cannot improve the choice.
  // Preserve native legality, explicit exclusions and challenge restrictions;
  // a zero/negative combat valuation alone must never strand the level-up page.
  const sole = soleUpgrade && candidates.length === 1 ? candidates[0] : null;
  if (sole?.strictAllowed && Number.isFinite(sole.rawScore) && (sole.rawScore <= 0 || sole.benefit?.hardRejected) &&
      (!towerGoals.vitaminsRestricted || !["newVit","upVit"].includes(sole.kind) || towerGoals.vitamins.has(sole.key)))
    return {...metadata,action:"choose",index:sole.index,score:sole.score,
      reason:"sole-native-upgrade",fallback:false,strictTower:!!towerGoals.strict,
      nextHistory:{...history,...growthHistory(sole),unplannedRounds:0,rerollsThisPage:0}};
  if (kind === "upgrade" && towerGoals.strict && !towerGoals.complete) {
    const towerFinal = run.finalReplacement?.towerPursuit || final,
      allowFirstStar = starPiecePlanned(run,configuredBuild) && !player.vitamins?.has?.("star-piece-v") &&
        !towerFinal?.vitamins?.enabled && !towerFinal?.strictVitamins?.enabled;
    const wanted = candidates.filter(entry =>
      entry.strictAllowed && Number.isFinite(entry.rawScore) && entry.rawScore >= 0 &&
      (["newMove", "upMove"].includes(entry.kind)
        ? towerGoals.wantedMoves.has(entry.key) && (entry.kind !== "newMove" ||
          towerGoals.materials.has(entry.key) || slots.freeSlots > towerGoals.reservedMaterialSlots)
        : ["newVit", "upVit"].includes(entry.kind) && (towerGoals.vitamins.has(entry.key) ||
          allowFirstStar && entry.kind === "newVit" && entry.key === "star-piece-v" ||
          !towerGoals.vitaminsRestricted && entry.rawScore > 0)));
    const materialPriority = entry => {
      if(entry.kind!=="newMove" || !towerGoals.urgentMaterials.has(entry.key))return 0;
      const pairs=towerFinal?.fusion?.assignments || [];
      return 1+Math.max(0,...pairs.filter(pair=>pair.parents.includes(entry.key)).map(pair=>
        pair.parents.filter(key=>player.moves?.some(move=>choiceMoveKey(move,data)===key)).length));
    };
    wanted.sort((a,b)=>materialPriority(b)-materialPriority(a) || compareOfferCandidates(a,b));
    const result = (action, entry, reason, choices=wanted) => ({...metadata, candidates:action === "choose" ? choices : candidates,
      action,index:entry?.index ?? null,score:entry?.score ?? null,reason,fallback:false,strictTower:true,
      towerProgress:{readyFusion:towerGoals.readyFusion,waitingForFusion:towerGoals.waitingForFusion,
        conflicts:towerGoals.conflicts,vitaminsRestricted:towerGoals.vitaminsRestricted},
      nextHistory:{...history,...(action === "choose" ? growthHistory(entry) : {}),
        unplannedRounds:action === "choose" ? 0 : ["skip","banish"].includes(action) ? history.unplannedRounds+1 : history.unplannedRounds,
        rerollsThisPage:action === "reroll" ? history.rerollsThisPage+1 : 0}});
    const newMaterial=wanted.find(entry=>entry.kind==="newMove" && towerGoals.urgentMaterials.has(entry.key));
    if(newMaterial) return result("choose",newMaterial,"tower-fusion-material",
      wanted.filter(entry=>entry.kind==="newMove"&&towerGoals.urgentMaterials.has(entry.key)));
    const needsMaterials=towerGoals.urgentMaterials.size>0&&!towerGoals.waitingForFusion;
    const moveGrowth=wanted.filter(entry=>["newMove","upMove"].includes(entry.kind));
    if (wanted.length && (!needsMaterials || moveGrowth.length)) {
      // Material acquisition cannot be displaced by vitamin growth. Existing
      // skill upgrades still progress a pair when no new parent is offered.
      if(needsMaterials && moveGrowth.length)return result("choose",moveGrowth[0],"tower-requested-loadout",moveGrowth);
      const firstTargets = wanted.filter(entry =>
        entry.kind === "newVit" && towerGoals.vitamins.has(entry.key) && !player.vitamins?.has?.(entry.key) ||
        entry.kind === "newMove" && towerGoals.wantedMoves.has(entry.key) &&
          !player.moves?.some(move => choiceMoveKey(move,data) === entry.key));
      if (firstTargets.length) return result("choose",
        firstStarPieceChoice(firstTargets,normalized,run,configuredBuild) || firstTargets[0],
        "tower-first-plan-acquisition",firstTargets);
      const firstStar = firstStarPieceChoice(wanted,normalized,run,configuredBuild);
      if (firstStar) return result("choose",firstStar,firstStar.key === "star-piece-v"
        ? "first-star-piece-acquisition" : "higher-rarity-planned-choice-before-first-star-piece");
      const growth = growthChoice && wanted.find(entry=>entry.index===growthChoice.index);
      return result("choose",growth || wanted[0],growth ? "tower-useful-vitamin-growth" : "tower-requested-loadout");
    }
    // Use remaining native searches first; never fill this page with off-plan growth.
    const fallback = () => ({...result("restart",null,"tower-target-search-exhausted"),
      searchExhausted:true});
    const unwanted = [...nativeCandidates].sort((a,b)=>a.score-b.score||a.index-b.index).find(entry =>
      typeof offers[entry.index]?.key === "string" &&
      (["newMove","upMove"].includes(entry.kind) && !towerGoals.protectedMoves.has(entry.key) &&
        offers[entry.index].key.startsWith("m") ||
       entry.kind==="newVit" && !player.vitamins?.has?.(entry.key) &&
        !towerGoals.protectedVitamins.has(entry.key) && offers[entry.index].key.startsWith("v")));
    if ([options.skips ?? native.skips,options.rerolls ?? native.rerolls,
        ...(unwanted ? [options.banishes ?? native.banishes] : [])]
        .some(value=>value == null || !Number.isFinite(Number(value)) || Number(value)<0))
      return result("wait",null,"tower-search-counts-unconfirmed");
    if (unwanted && Number(options.banishes ?? native.banishes) > 0) {
      if (options.banishLegal === true) return result("banish",unwanted,unwanted.kind==="newVit"
        ?"tower-banish-unwanted-vitamin":"tower-banish-unwanted-skill");
      return result("wait",null,"tower-banish-button-not-ready");
    }
    if (skips > 0) return result(options.skipLegal === true ? "skip" : "wait",null,"tower-skip-unwanted-offers");
    if (rerolls > 0) return result(options.rerollLegal === true ? "reroll" : "wait",null,"tower-reroll-for-targets");
    if(wanted.length) {
      const firstStar=firstStarPieceChoice(wanted,normalized,run,configuredBuild);
      return result("choose",firstStar||wanted[0],firstStar?.key==="star-piece-v"?"first-star-piece-acquisition":"tower-search-exhausted-growth");
    }
    return fallback();
  }
  const firstStar = kind === "upgrade" ? firstStarPieceChoice(candidates,normalized,run,configuredBuild) : null;
  if (firstStar) return {...metadata,action:"choose",index:firstStar.index,score:firstStar.score,
    reason:firstStar.key === "star-piece-v" ? "first-star-piece-acquisition" : "higher-rarity-planned-choice-before-first-star-piece",
    fallback:false,nextHistory:{...history,unplannedRounds:0,rerollsThisPage:0,...growthHistory(firstStar)}};
  if(!candidates.length&&benefitEvaluations.some(entry=>entry.hardRejected)) {
    const action=kind==="upgrade"&&options.rerollLegal===true&&rerolls>0?"reroll":canSkip?"skip":"wait";
    return {...metadata,action,index:null,blocked:action==="wait",hardBlocked:true,
      reason:"player-benefit-hard-rejection-"+action,
      nextHistory:{...history,rerollsThisPage:action==="reroll"?history.rerollsThisPage+1:0}};
  }
  if (!unknownEffectOnly && !emergency && !growthChoice && !usefulVitamins.length && (searchDesired || onlyBad) && canReroll)
    return {
      ...metadata,
      action: "reroll",
      index: null,
      score: null,
      reason: searchDesired
        ? "bounded-search-for-recommended-move"
        : "bounded-refresh-of-unhelpful-offers",
      fallback: false,
      nextHistory: { ...history, rerollsThisPage: history.rerollsThisPage + 1 },
    };
  if (
    !unknownEffectOnly && !emergency &&
    !growthChoice && !usefulVitamins.length &&
    (onlyBad || searchDesired) &&
    canSkip
  )
    return {
      ...metadata,
      action: "skip",
      index: null,
      score: null,
      reason: onlyBad
        ? "native-skip-of-unhelpful-offers"
        : "bounded-reservation-for-nearby-recommended-move",
      fallback: false,
      nextHistory: {
        unplannedRounds: history.unplannedRounds + 1,
        rerollsThisPage: 0,
        ...growthHistory(null),
      },
    };
  if (!candidates.length)
    return {
      ...metadata,
      action: "choose",
      index: null,
      score: null,
      reason: "no-native-legal-choice-or-exit-confirmed",
      blocked: true,
      fallback: true,
      nextHistory: { ...history },
    };
  let best = candidates[0];
  const restrictedFallback = best.priority==null && !best.experiencePriority && (!Number.isFinite(best.score) || best.score < 0);
  const fallback =
    restrictedFallback ||
    (allUnrecommendedNew && preferences.length > 0 && missing.length > 0);
  if (restrictedFallback)
    best = [...candidates].sort(
      (a, b) => b.actualScore - a.actualScore || a.index - b.index,
    )[0];
  if (growthChoice) best = growthChoice;
  const unplanned =
    missing.length > 0 && !(best.kind === "newMove" && best.recommended);
  return {
    ...metadata,
    action: "choose",
    index: best.index,
    score: Number.isFinite(best.score)
      ? best.score
      : Number.isFinite(best.actualScore)
        ? best.actualScore
        : 0,
    reason: strictForced ? "mandatory-native-strict-exception-awaiting-tutor" : growthChoice ? (best.kind === "newVit" ? "bounded-useful-vitamin-growth" : "bounded-useful-move-growth") : fallback
      ? "mandatory-native-legal-fallback"
      : best.recommended
        ? "recommended-move-with-bounded-preference"
        : best.kind === "upMove"
          ? "useful-held-move-upgrade"
          : "best-current-marginal-benefit",
    fallback,
    nextHistory: {
      unplannedRounds: unplanned ? history.unplannedRounds + 1 : 0,
      rerollsThisPage: 0,
      ...growthHistory(best),
    },
  };
}

export function towerLoadoutProgress(run = {}, data = {}) {
  if (!(run.nativeRun || run).tower || run.preserveLoadout || run.build?.masteryConstraints) return {strict:false,complete:false};
  const p=run.player || run.nativeRun?.player || {}, build=run.build || {},
    final=run.finalReplacement?.towerPursuit || run.finalReplacement || build.finalReplacement,
    custom=build.sourceType === "custom",
    fusions=final?.fusion?.enabled ? final.fusion.targets : [],
    moves=new Set(final?.strictMoves?.enabled ? final.strictMoves.targets.filter(key=>choiceDefinition(data,key).arch!=="fusion") : final?.moves?.enabled ? final.moves.targets : custom ?
      (build.configuredMovePreferences || choiceMovePreferences(build)).filter(row=>!fusions.includes(row.key))
        .slice(0,Math.max(0,choiceSlotState(p).slots-fusions.length)).map(row=>row.key) : []),
    vitamins=new Set(final?.strictVitamins?.enabled ? final.strictVitamins.targets : final?.vitamins?.enabled ? final.vitamins.targets : custom ?
      (build.vitaminRules || []).filter(row=>!row.avoid).slice(0,Number(p.vitaminSlots)||3).map(row=>row.key) : []),
    vitaminsRestricted=!!(final?.strictVitamins?.enabled || final?.vitamins?.enabled || vitamins.size),
    protectedVitamins=new Set([...vitamins,"star-piece-v",...(p.vitamins?.keys?.() || []),
      ...(build.vitaminRules || []).filter(row=>!row.avoid).map(row=>row.key)]),
    strict=moves.size+vitamins.size+fusions.length>0,
    held=(p.moves || []).filter(Boolean),
    cap=move=> {
      try { return Number(typeof p.capOf === "function" ? p.capOf(move) :
        move.def?.fusion || move.def?.arch === "fusion" ? NaN : p.moveCap); }
      catch { return NaN; }
    },
    maxed=move=>Number.isFinite(cap(move)) && cap(move)>0 && Number(move.level)>=cap(move),
    allMoves=[...moves,...fusions],
    vitMaxed=key=>Number.isFinite(Number(p.vitCap)) && Number(p.vitCap)>0 &&
      Number(p.vitamins?.get?.(key)?.level ?? p.vitamins?.get?.(key))>=Number(p.vitCap),
    complete=strict ? allMoves.every((key,index)=>held.filter(move=>choiceMoveKey(move,data)===key && maxed(move)).length>=allMoves.slice(0,index+1).filter(wanted=>wanted===key).length) &&
      [...vitamins].every(vitMaxed) : held.length>=Number(p.moveSlots) &&
      (p.vitamins?.size || 0)>=Number(p.vitaminSlots) && held.every(maxed) && [...(p.vitamins?.keys?.() || [])].every(vitMaxed),
    parents=new Set((final?.fusion?.assignments || []).flatMap(pair=>pair.parents || [])),
    pending=final?.fusion?.pending,
    nextParent=pending?.learningOrder?.find(key=>!held.some(move=>choiceMoveKey(move,data)===key)),
    assignments=final?.fusion?.assignments || [],
    flexible=Array.isArray(final?.fusion?.collectableParents),
    materials=new Set(flexible?assignments.flatMap(pair=>pair.parents):pending?.parents || assignments[0]?.parents || []),
    urgentMaterials=new Set(),
    // Reserve absent ingredients even while a parent is waiting for a level or
    // an evolution unlock. Finishing a fusion releases its extra slot naturally.
    reservedMaterialSlots=[...(pending?.parents || materials)].filter(key=>!held.some(move=>choiceMoveKey(move,data)===key)).length +
      Math.max(0,assignments.length-1),
    wantedMoves=new Set([...moves,...fusions]),
    missingMoveSlots=[...moves].filter(key=>!held.some(move=>choiceMoveKey(move,data)===key)).length,
    readiness=analyzeMoveReadiness({...run,build:{sourceType:"custom",moves:[...moves]}},data),
    conflicts=readiness.filter(row=>row.state==="unavailable").map(row=>({key:row.key,reason:row.reason})),
    readyFusion=!!run.finalReplacement?.fusion?.pending?.ready,
    waitingForFusion=!!pending?.ready;
  for (const key of materials) {
    const move=held.find(move=>choiceMoveKey(move,data)===key);
    const collectable=flexible?final.fusion.collectableParents.includes(key):!nextParent||key===nextParent;
    if (move || collectable) wantedMoves.add(key);
    if (!move && collectable) urgentMaterials.add(key);
  }
  return {strict,complete,wantedMoves,requestedMoves:moves,vitamins,vitaminsRestricted,protectedVitamins,materials,urgentMaterials,reservedMaterialSlots,
    missingMoveSlots,readyFusion,waitingForFusion,conflicts,
    protectedMoves:new Set([...moves,...fusions,...parents])};
}

// Only durable, directly observed native exclusions constitute proof. Missing
// offers, an exhausted search, planner budgets, unknown guides, evolution gates
// and consumed parents with possible forget/replan routes are NOT proof.
// The host must call this again against the current run before ending it.
export function towerLoadoutImpossibility(run = {}, data = {}, options = {}) {
  const goals=towerLoadoutProgress(run,data), evidence=[], unconfirmed={confirmed:false,evidence};
  if(!goals.strict||goals.complete)return unconfirmed;
  const native=run.nativeRun || run, player=run.player || native.player || {},
    final=run.finalReplacement?.towerPursuit || run.finalReplacement || run.build?.finalReplacement;
  if(typeof native.banished?.has!=="function")return unconfirmed;
  const offers=(options.offers || []).filter(offer=>offer&&offer.disabled!==true&&offer.hidden!==true),
    held=key=>(player.moves || []).find(move=>choiceMoveKey(move,data)===key),
    moveOffered=key=>offers.some(offer=>["newMove","upMove"].includes(offer.kind)&&
      choiceMoveKey(offer.kind==="upMove"?player.moves?.[offer.slot]:offer.id,data)===key),
    bannedMove=key=>{
      const def=choiceDefinition(data,key);
      return Number.isFinite(def.id)&&native.banished.has("m"+def.id)&&!moveOffered(key)?"m"+def.id:null;
    };
  for(const key of goals.requestedMoves || []) {
    const nativeKey=bannedMove(key);
    if(!held(key)&&nativeKey)evidence.push({category:"move",key,reason:"native-banish",nativeKey});
  }
  for(const key of goals.vitamins || [])if(!player.vitamins?.has?.(key)&&native.banished.has("v"+key)&&
      !offers.some(offer=>["newVit","upVit"].includes(offer.kind)&&offer.vit===key))
    evidence.push({category:"vitamin",key,reason:"native-banish",nativeKey:"v"+key});
  const fusion=final?.fusion, remaining=new Map();
  if(fusion?.enabled)for(const key of fusion.targets || [])remaining.set(key,(remaining.get(key)||0)+1);
  for(const move of player.moves || []) {
    const key=choiceMoveKey(move,data);if(remaining.get(key)>0)remaining.set(key,remaining.get(key)-1);
  }
  for(const [goal,count] of remaining)if(count>0) {
    const recipe=data.fusionRecipes?.find(row=>row.key===goal);
    if(recipe?.kind!=="signature"||recipe.moves?.length!==2)continue;
    try {
      if(typeof data.fusionFor!=="function" ||
          data.fusionFor(...recipe.moves.map(key=>choiceDefinition(data,key)))?.key!==goal)continue;
    } catch { continue; }
    // A signature's exact native parents are mandatory; type/reaction/glitch
    // recipes can have alternatives and may not use this shortcut.
    for(const key of recipe.moves) {
      const nativeKey=bannedMove(key), move=held(key);
      if(nativeKey&&(!move||Number(move.level)<8))
        evidence.push({category:"fusion-parent",goal,key,reason:"native-banish",nativeKey});
    }
  }
  return evidence.length?{confirmed:true,evidence,reason:"native-required-target-banished",
    signature:JSON.stringify([[...(goals.requestedMoves||[])],[...goals.vitamins],fusion?.targets||[],evidence])}:unconfirmed;
}

// Audited 0.8.46 XC/ZC/uS/Xx/tS and tower floor plans. Only the prices and
// sampling rules are native formulas; future purchases and their utility are
// a bounded forecast, never measured DPS or knowledge of future native rolls.
export function towerChestBasePrice(bought) {
  let growth=35*bought;
  for(const [threshold,rate,origin] of [[10,300,10],[20,550,20],[30,1200,30],[40,2400,30],[50,4500,30]])
    if(bought>threshold)growth+=rate*(bought-origin);
  return 18*((1.22**bought+growth/30)*1.12**Math.max(0,bought-12));
}

export function towerCurseEconomy(nativeRun={}, options={}) {
  const result={model:"0.8.46-two-floor-paired-forecast",gravesFirst:false,
    reason:"economy-data-unavailable",samples:0,heuristic:true};
  try {
    const p=nativeRun.player, data=options.data || {}, build=options.build || {},
      rules=options.rules || {}, catalog=data.items, meta=nativeRun.meta || data.app?.meta,
      floor=nativeRun.tower?.floor, bought=nativeRun.chestsBought, gold=nativeRun.gold,
      spent=options.spent ?? 0, luck=p?.stats?.luck, level=p?.level;
    if(!Number.isInteger(floor)||floor<1||!Number.isInteger(bought)||bought<0||
      !Number.isFinite(gold)||gold<0||!Number.isFinite(spent)||spent<0||
      !Number.isFinite(luck)||!Number.isFinite(level)||!p?.items?.get||
      !catalog?.size||typeof meta?.itemInPool!=="function"||
      typeof nativeRun.banished?.has!=="function"||!Array.isArray(nativeRun.shopBuys)||
      nativeRun.shopBuys.some(r=>!Number.isInteger(r)||r<0||r>4)) return result;
    const base=towerChestBasePrice(bought), reward=Math.round(Math.max(80,.6*base)),
      chestPrice=n=>Math.round(towerChestBasePrice(n)*(1-Math.min(.25,Math.max(0,luck)/400))*
        (1-Math.min(.4,.08*(p.items.get("big-nugget") || 0)))),
      priceFactors=[1.15,1.25,1.4,1.6,2], shopBases=[80,130,220,400,750],
      heat=(buys,n)=>buys.slice(2+Math.floor(n/3)).reduce((a,r)=>a*priceFactors[r],1),
      initialHeat=heat(nativeRun.shopBuys,bought);
    Object.assign(result,{gold,chestsBought:bought,gravesGold:reward,paidBallPrice:chestPrice(bought),
      shopHeat:initialHeat,goldReserve:rules.goldReserve ?? 0,spent});
    if(!Number.isFinite(reward)||!Number.isFinite(initialHeat)||!Number.isFinite(chestPrice(bought)))return result;
    // Detect changed native pricing without invoking RNG, a purchase, or a roll.
    if(Number.isFinite(nativeRun.shopHeat)&&Math.abs(initialHeat-nativeRun.shopHeat)>1e-6*Math.max(1,initialHeat))
      return {...result,reason:"native-shop-formula-mismatch"};
    if(typeof nativeRun.interactables?.chestCost==="function" &&
      nativeRun.interactables.chestCost()!==chestPrice(bought))return {...result,reason:"native-ball-formula-mismatch"};
    if(rules.paid===false)return {...result,reason:"paid-interactions-disabled"};
    const rows=[];
    for(const [key,def] of catalog) {
      if(!meta.itemInPool(key)||key==="dowsing-machine"||(p.items.get(key)||0)>=(def.max ?? 10))continue;
      if(!Number.isInteger(def.rarity)||def.rarity<0||def.rarity>4)return result;
      const context={player:p,build,nativeRun}, normal=evaluateItemDecision(key,{...context,purpose:"free"},data),
        shop=evaluateItemDecision(key,{...context,purpose:"shop"},data),
        rule=build.itemRules?.find(row=>row.key===key),
        cap=Math.min(def.max ?? 10,rule?.targetCount ?? build.itemCounts?.[key] ?? Infinity);
      rows.push({key,rarity:def.rarity,max:def.max ?? 10,cap,normal,shop,
        banished:nativeRun.banished.has("i"+key),
        weight:def.tags?.some(tag=>(p.types || []).includes(tag.slice(5)))?4:(def.tags ? 0.35 : 1)});
    }
    if(!rows.length)return {...result,reason:"native-item-pool-empty"};
    if(!rows.some(row=>row.normal.eligible||row.shop.eligible))return {...result,reason:"no-useful-item-purchases"};
    // Explicit priorities remain lexicographic. At equal priority the existing
    // benefit score breaks ties; automatic defense remains the last category.
    const priorities=[...new Set(rows.flatMap(row=>row.normal.priority==null?[]:[row.normal.priority]))].sort((a,b)=>a-b),
      dimensions=priorities.flatMap(priority=>["priority:"+priority+":count","priority:"+priority+":benefit"])
        .concat(["automatic:benefit","automatic:defense"]), size=dimensions.length,
      zero=()=>Array(size).fill(0), value=(row,channel)=>{
        const decision=row[channel], vector=zero();
        if(decision.priority!=null) {
          const at=2*priorities.indexOf(decision.priority);vector[at]=1;vector[at+1]=decision.score;
        } else vector[size-(decision.utilityTier<0?1:2)]=Math.max(0,decision.score);
        return vector;
      };
    const planAt=n=>{const index=n>=8?(n-8)%7:n-1;return {
      floor:n,stage:n>=8?4:[1,1,2,2,3,3,3][index],
      balls:index===2?3:2,shop:[1,4,6].includes(index)&&(n<8||n%2===0)};};
    const horizon=[planAt(floor+1),planAt(floor+2)];
    // A visible change to the reviewed layout makes the future schedule unknown.
    const currentPlan=nativeRun.tower?.def?.plan, expected=planAt(floor);
    if(currentPlan && (currentPlan.chests?.length!==expected.balls ||
      (!!currentPlan.meowth && (floor<8||floor%2===0))!==expected.shop))
      return {...result,reason:"native-floor-layout-mismatch"};
    Object.assign(result,{horizon,dimensions,poolSize:rows.length,
      assumptions:["current-marginal-item-values","next-two-floors","shop-before-balls",
        "no-shop-rerolls-or-future-combat-income","current-luck-level-and-discounts","shared-shop-value-and-reserve-policy"]});
    // Private repeatable random stream for integration ONLY. Does not inspect,
    // seed, consume or modify the game's RNG. Paired branches share event seeds.
    const random=seed=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    const draw=(state,min,stage,rng)=>{
      const pool=rows.filter(row=>(state.counts.get(row.key)||0)<row.max);
      if(!pool.length)return null;
      const available=[0,1,2,3,4].map(r=>pool.some(row=>row.rarity===r&&!row.banished)),
        i=Math.max(0,luck+10),a=i/100,o=level+i/8+(stage-1)*12,
        ramp=(lo,hi)=>Math.max(0,Math.min(1,(o-lo)/(hi-lo))),
        weights=[70/(1+a),24*(1+.5*a),5*(1+a)**2*ramp(3,10),.9*(1+a)**3*ramp(8,18),.12*(1+a)**4*ramp(14,26)]
          .map((w,r)=>w*(r<min?1e-4:1)*(available[r]?1:0));
      let rarity=min,total=weights.reduce((a,b)=>a+b,0),roll=rng()*total;
      if(total>1e-6)for(let r=0;r<5;r++){roll-=weights[r];if(roll<=0){rarity=Math.max(min,r);break;}}
      let candidates=[];
      for(let r=rarity;r>=0&&!candidates.length;r--)candidates=pool.filter(row=>row.rarity===r&&!row.banished);
      if(!candidates.length)candidates=pool; // native exhausted-tier fallback
      roll=rng()*candidates.reduce((a,row)=>a+row.weight,0);
      for(const row of candidates){roll-=row.weight;if(roll<=0)return row;}
      return candidates.at(-1);
    };
    const offers=(state,count,min,stage,rng,fill)=>{
      const selected=[],add=row=>{if(row&&!selected.includes(row))selected.push(row);};
      if(fill)add(draw(state,min,stage,rng));
      for(let attempt=0;attempt<16&&selected.length<count;attempt++)add(draw(state,min,stage,rng));
      if(fill&&selected.length<count)for(const row of rows)
        if(!row.banished&&(state.counts.get(row.key)||0)<row.max){add(row);if(selected.length===count)break;}
      return selected;
    };
    const allowed=(row,state,channel)=>row[channel].eligible&&(state.counts.get(row.key)||0)<row.cap,
      grant=(state,row,channel)=>{
        state.counts.set(row.key,(state.counts.get(row.key)||0)+1);
        const v=value(row,channel);v.forEach((n,i)=>state.value[i]+=n);state.items++;
      }, sale=(rarity,stage,n)=>Math.round(Math.max([10,18,30,50,90][rarity]*stage,
        Math.min(.5*shopBases[rarity]*2.2**(stage-1),[.3,.45,.65,1,1.5][rarity]*towerChestBasePrice(n)))),
      select=(list,state,channel)=>list.filter(row=>allowed(row,state,channel))
        .sort((a,b)=>compareOfferCandidates({...a[channel],price:a.price},{...b[channel],price:b.price}))[0],
      redeem=(state,list,stage)=>{
        const pick=rules.free===false?null:select(list,state,"normal");
        if(pick)grant(state,pick,"normal");
        else state.cash+=list.length?Math.min(...list.map(row=>sale(row.rarity,stage,state.bought))):sale(2,stage,state.bought);
      };
    const project=(branch,sample)=>{
      const state={cash:gold+(branch==="graves"?reward:0),spent,bought,buys:[...nativeRun.shopBuys],
        counts:new Map(p.items),value:zero(),items:0,purchases:0};
      if(branch==="dark")redeem(state,offers(state,1,1,horizon[0].stage,random(sample*7919+17),true),horizon[0].stage);
      for(const next of horizon) {
        const seed=sample*7919+next.floor*104729;
        if(next.shop&&rules.shop!==false) {
          const stock=offers(state,4,0,next.stage,random(seed+31),false).map(row=>({...row,
            price:Math.round(shopBases[row.rarity]*2.2**(next.stage-1)*heat(state.buys,state.bought)*
              (1-.08*Math.min(3,p.items.get("gold-teeth")||0)))}));
          while(true) {
            const player=Object.assign(Object.create(p),{items:state.counts}),
              projected=Object.assign(Object.create(nativeRun),{player,gold:state.cash,stage:next.stage,
                shopBuys:state.buys,chestsBought:state.bought,tower:{...nativeRun.tower,floor:next.floor}}),
              purchase=evaluateShopPurchases(stock,{player,build,nativeRun:projected},data,{rules,spent:state.spent,
                itemDecisions:rows.map(row=>[row.key,{...row.shop,eligible:allowed(row,state,"shop")}])}),
              pick=purchase.index==null?null:stock[purchase.index];
            if(!pick)break;
            state.cash-=pick.price;state.spent+=pick.price;state.buys.push(pick.rarity);pick.sold=true;
            grant(state,pick,"shop");state.purchases++;
          }
        }
        for(let ball=0;ball<next.balls;ball++) {
          const price=chestPrice(state.bought);
          if(!canSpendGold(price,state.cash,rules,state.spent)||!rows.some(row=>allowed(row,state,"normal")))break;
          state.cash-=price;state.spent+=price;state.bought++;state.purchases++;
          redeem(state,offers(state,3,0,next.stage,random(seed+101+ball*3571),true),next.stage);
        }
      }
      return state;
    };
    const samples=96,sums={baseline:zero(),graves:zero(),dark:zero()},diffSquares=zero(),
      purchases={baseline:0,graves:0,dark:0},remaining={baseline:0,graves:0,dark:0};
    for(let sample=1;sample<=samples;sample++) {
      const branches={};
      for(const branch of ["baseline","graves","dark"]) {
        const state=project(branch,sample);branches[branch]=state.value;
        state.value.forEach((n,i)=>sums[branch][i]+=n/samples);
        purchases[branch]+=state.purchases/samples;remaining[branch]+=state.cash/samples;
      }
      diffSquares.forEach((_,i)=>{diffSquares[i]+=(branches.graves[i]-branches.dark[i])**2;});
    }
    const difference=sums.graves.map((n,i)=>n-sums.dark[i]),
      standardError=difference.map((n,i)=>Math.sqrt(Math.max(0,diffSquares[i]/samples-n*n)/(samples-1))),
      dimension=difference.findIndex(n=>Math.abs(n)>1e-8),
      first=dimension>=0&&difference[dimension]>2*standardError[dimension]+1e-8;
    return {...result,samples,gravesFirst:first,reason:first?"extra-gold-buys-more-useful-items":
      dimension>=0&&difference[dimension]>0?"forecast-too-close-prefer-free-ball":"free-ball-at-least-as-useful",
      decidingDimension:dimensions[dimension] ?? null,
      extraGoldBenefit:sums.graves.map((n,i)=>n-sums.baseline[i]),
      freeBallBenefit:sums.dark.map((n,i)=>n-sums.baseline[i]),difference,standardError,
      expectedPurchases:purchases,expectedRemainingGold:remaining};
  } catch {
    // Optional native data may change with a game update. Keep the pact usable
    // and make uncertainty visible; never invent a reward from missing fields.
    return {...result,reason:"economy-evaluation-unavailable"};
  }
}

// Reviewed 0.8.55 qD / Qt / Enemy.spawn / Qb / $b. These are combat-work
// scenarios, not a full movement/AI simulator or guaranteed elapsed-time bounds.
// The native meter already reflects the current kit; it is also the game's own
// guardian HP budget. Never extrapolate from previous-floor elapsed time.
export function projectTowerFloor(run={},data={},{hp=1,output=1}={}) {
  const targetFloor=run.tower?.floor+1, p=run.player, s=p?.stats,
    unknown=reason=>({known:false,targetFloor,reason});
  try {
    if(!Number.isInteger(targetFloor)||targetFloor<8)return unknown("target-floor-unavailable");
    const dps=run.combat?.meter?.dps, difficulty=s?.difficulty, amount=run.diff?.enemyAmount*s?.enemyAmount,
      elite=Math.min(1,Math.max(0,(.07+.012*targetFloor)*s?.eliteSpawn));
    if(!(dps>0)||!Number.isFinite(dps))return unknown("current-output-unavailable");
    if(![difficulty,amount,elite,run.tier,hp,output].every(Number.isFinite)||
      difficulty<=0||amount<=0||hp<=0||output<=0)return unknown("current-stats-unavailable");
    const species=data.data, pool=[94,93,92,105,110,89,42,97,124,122,24,49];
    if(typeof species?.get!=="function"||typeof species.hasSprite!=="function")return unknown("target-species-unavailable");
    const available=pool.filter(id=>species.hasSprite(id)), bst=id=>species.get(id)?.bst;
    if(!available.length||available.some(id=>!Number.isFinite(bst(id))))return unknown("target-species-unavailable");
    const boss=(targetFloor-7)%5===0,index=(targetFloor-8)%7,
      id=boss?[94,105,97][Math.floor((targetFloor-8)/5)%3]:[93,110,42,89,97,105,94][index],
      kind=boss?"boss":index===1?"summoner":"totem";
    if(!species.hasSprite(id)||!Number.isFinite(bst(id)))return unknown("target-species-unavailable");
    const curve=v=>(1+.3*v+.12*Math.max(0,v-1.5)**2+.0025*v**3)*1.06**Math.max(0,v-20)*1.15**Math.max(0,v-45),
      scale=(wave,ramp)=>curve(21+(targetFloor-8)*2+Math.min(wave,2)*.6+ramp)*difficulty*hp,
      meanHp=(wave,ramp)=>available.reduce((sum,id)=>{
        const base=(12+.055*bst(id))*scale(wave,ramp)*1.35;
        return sum+(1-elite)*Math.min(1e30,base)+elite*Math.min(1e30,base*4.5);
      },0)/available.length,
      waves=[0,1,2].map(wave=>{
        const count=wave===2&&boss?0:Math.round(Math.min(120,46+(targetFloor-8)*3+wave*6)*amount),
          burst=Math.max(2,Math.ceil(count/14)),spawn=count?.4+.75*(Math.ceil(count/burst)-1):0;
        return {count,meanHp:meanHp(wave,0),lateMeanHp:meanHp(wave,.5),spawnSeconds:spawn};
      }),
      capSeconds={boss:35,totem:14,summoner:8}[kind], budgetSeconds={boss:48,totem:26,summoner:14}[kind],
      guardianHp=ramp=>{
        const base=Math.min(1e30,(12+.055*bst(id))*scale(2,ramp)*{boss:35,totem:30,summoner:14}[kind]),
          budget=dps*output*budgetSeconds*(1+.15*run.tier)*difficulty;
        return Math.min(1e30,Math.max(base,Math.min(base*4,budget)));
      }, guardianTime=ramp=>Math.max(capSeconds-3,guardianHp(ramp)/(dps*output)),
      // 4s intro, two 6s breaks. Wave-three guardian starts after 2.2s;
      // its work and ordinary enemies can overlap in the parallel scenario.
      parallel=16+waves.reduce((sum,w,i)=>sum+(i===2?
        Math.max(w.spawnSeconds+(w.count?w.meanHp/(dps*output):0),2.2+guardianTime(0)):
        w.spawnSeconds+(w.count?w.meanHp/(dps*output):0)),0),
      serial=16+waves.reduce((sum,w)=>sum+w.spawnSeconds+w.count*w.lateMeanHp/(dps*output),0)+2.2+guardianTime(.5);
    if(![parallel,serial].every(Number.isFinite))return unknown("projection-out-of-range");
    return {known:true,model:"native055-current-output-floor-work",targetFloor,outputBasis:dps,
      outputBasisKind:"native-meter-per-target-p85",eliteProbability:elite,waves,
      guardian:{id,kind,capSeconds,hp:guardianHp(.5),seconds:guardianTime(.5)},seconds:{parallel,serial},
      previousFloorTimeUsed:false,assumptions:["current-kit-output-held-constant","mean-species-health",
        "parallel-versus-serial-target-work","native-wave-ramp-0-to-half","no-travel-or-boss-phase-simulation"]};
  } catch {return unknown("floor-projection-unavailable");}
}

// Native sS keeps 20 cumulative snapshots. Read those rows without calling
// rates(), which mutates born. Only observed current-move damage is attributed
// to the move capability reward; proc/status/allied/unknown damage gets no gain.
// Aggregate shares applied to the per-target meter are still a scenario, not
// an exact decomposition of that meter's 85th percentile.
function towerOutputAttribution(run) {
  const unknown=reason=>({known:false,playerMoveShare:0,reason}), log=run.dpsLog;
  if(!Array.isArray(log?.times)||!Array.isArray(log.rows)||log.times.length!==log.rows.length||log.times.length<2)
    return unknown("output-shares-unavailable");
  const times=log.times.slice(-20),rows=log.rows.slice(-20),last=times.length-1,
    start=times.findIndex(t=>t>=times[last]-15);
  if(!Number.isFinite(run.time)||!times.every(Number.isFinite)||
    times.some((t,i)=>i>0&&t<=times[i-1])||run.time-times[last]<0||run.time-times[last]>5||
    start<0||times[last]-times[start]<3)return unknown("output-shares-stale-or-too-short");
  const a=rows[start],b=rows[last];
  if(!a||!b)return unknown("output-shares-unavailable");
  const keys=new Set([...Object.keys(a),...Object.keys(b)]),moves=new Set((run.player?.moves || [])
    .filter(Boolean).map(m=>(m.def || m).key).filter(Boolean));
  let total=0,player=0;
  for(const key of keys) {
    if(key==="#ult")continue; // native meter excludes the ultimate's slot 8
    const before=a[key] ?? 0,after=b[key] ?? 0,delta=after-before;
    if(!Number.isFinite(before)||!Number.isFinite(after)||before<0||delta<0)return unknown("output-counters-reset-or-unknown");
    total+=delta;if(moves.has(key))player+=delta;
  }
  if(!(total>0)||!Number.isFinite(total))return unknown("output-shares-no-recent-damage");
  return {known:true,playerMoveShare:Math.max(0,Math.min(1,player/total)),seconds:times[last]-times[start],
    reason:"native-recent-current-move-damage-share",unpricedShare:Math.max(0,1-player/total)};
}

// One random epic-or-better item: enumerate native pS/vS probabilities.
// Disallowed outcomes retain their probability and receive zero value.
export function towerIronReward(run={},options={}) {
  const result={known:false,reason:"reward-data-unavailable",expectedGain:0,outcomes:[],attribution:towerOutputAttribution(run)};
  try {
    const p=run.player,data=options.data || {},build=options.build || {},meta=run.meta || data.app?.meta,
      luck=p?.stats?.luck,level=p?.level;
    if(!Number.isFinite(luck)||!Number.isFinite(level)||!p?.items?.get||!data.items?.size||
      typeof meta?.itemInPool!=="function"||typeof run.banished?.has!=="function")return result;
    const pool=[...data.items].filter(([key,d])=>key!=="dowsing-machine"&&meta.itemInPool(key)&&
      (p.items.get(key)||0)<(d.max ?? 10)).map(([key,d])=>({key,def:d,rarity:d.rarity,
        banned:run.banished.has("i"+key),weight:d.tags?.some(tag=>(p.types || []).includes(tag.slice(5)))?4:d.tags?.35:1}));
    if(pool.some(row=>!Number.isInteger(row.rarity)||row.rarity<0||row.rarity>4))return result;
    const available=[0,1,2,3,4].map(r=>pool.some(row=>row.rarity===r&&!row.banned));
    if(!available.slice(3).some(Boolean))return {...result,known:true,reason:"epic-pool-exhausted-gold-unpriced"};
    const i=Math.max(0,luck+10),a=i/100,o=level+i/8+36,
      ramp=(lo,hi)=>Math.max(0,Math.min(1,(o-lo)/(hi-lo))),
      weights=[70/(1+a),24*(1+.5*a),5*(1+a)**2*ramp(3,10),.9*(1+a)**3*ramp(8,18),.12*(1+a)**4*ramp(14,26)]
        .map((w,r)=>w*(r<3?1e-4:1)*(available[r]?1:0)),total=weights.reduce((a,b)=>a+b,0),probabilities=new Map();
    for(let raw=0;raw<5;raw++) {
      const chance=total>1e-6?weights[raw]/total:raw===3?1:0;if(!chance)continue;
      let candidates=[];
      for(let r=Math.max(3,raw);r>=0&&!candidates.length;r--)candidates=pool.filter(row=>row.rarity===r&&!row.banned);
      if(!candidates.length)candidates=pool;
      const sum=candidates.reduce((n,row)=>n+row.weight,0);
      for(const row of candidates)probabilities.set(row.key,(probabilities.get(row.key)||0)+chance*row.weight/sum);
    }
    const outcomes=[...probabilities].map(([key,probability])=>{
      const def=data.items.get(key),decision=evaluateItemDecision(key,{player:p,nativeRun:run,build,purpose:"free"},data),
        benefit=evaluateOfferBenefit({kind:"item",id:key},{player:p,nativeRun:run,build},data),
        direct=(def.mods || []).some(m=>["damage","physical","special","critChance","critDamage","attackSpeed"].includes(m.stat)),
        // Only direct output capability is priced here. Conditional channels,
        // growth and utility retain their existing scores elsewhere, but have
        // no measured total-DPS share with which to buy extra enemy HP.
        gain=decision.eligible&&options.rules?.free!==false&&direct?
          Math.max(0,benefit.components?.output || 0)*result.attribution.playerMoveShare:0;
      return {key,probability,gain,eligible:decision.eligible,unpricedPassive:true};
    });
    return {...result,known:true,reason:"one-native-epic-item",outcomes,
      expectedGain:outcomes.reduce((n,row)=>n+row.probability*row.gain,0),
      interpretation:"observed-move-share-times-capability-proxy;other-output-passives-growth-and-sale-gold-unpriced"};
  } catch {return result;}
}

export function towerCursePayback(run={},options={}) {
  const baseline=projectTowerFloor(run,options.data),reward=towerIronReward(run,options),
    result={accept:false,targetFloor:baseline.targetFloor,previousFloorTimeUsed:false,baseline,reward};
  if(!baseline.known)return {...result,reason:baseline.reason};
  if(!reward.known)return {...result,reason:reward.reason};
  if(!Number.isFinite(run.time)||run.time<0)return {...result,reason:"remaining-window-unavailable"};
  const remaining=Math.max(0,21600-run.time), scenarios=reward.outcomes.map(row=>{
    const after=projectTowerFloor(run,options.data,{hp:1.4,output:1+row.gain});
    if(!after.known)return null;
    const extra=Math.max(0,after.seconds.serial-baseline.seconds.serial),
      future=Math.max(0,remaining-after.seconds.serial),
      // Fixed waves/spawns and native guardian rate caps do not shrink with
      // damage. Charge the serial scenario and discount the future benefit.
      damageSeconds=baseline.waves.reduce((n,w)=>n+w.count*w.lateMeanHp/baseline.outputBasis,0),
      combatShare=Math.min(1,damageSeconds/baseline.seconds.serial),
      saving=future*row.gain/(1+row.gain)*combatShare;
    return {key:row.key,probability:row.probability,seconds:after.seconds,extraSeconds:extra,futureSavingSeconds:saving};
  });
  if(scenarios.some(row=>!row))return {...result,remaining,reason:"reward-projection-unavailable"};
  const cost=scenarios.reduce((n,row)=>n+row.probability*row.extraSeconds,0),
    saving=scenarios.reduce((n,row)=>n+row.probability*row.futureSavingSeconds,0),
    accept=reward.expectedGain>0&&remaining>baseline.seconds.serial&&saving>=cost;
  return {...result,remaining,scenarios,expectedExtraSeconds:cost,expectedFutureSavingSeconds:saving,accept,
    reason:accept?"expected-reward-repays-target-floor-work":"reward-does-not-repay-target-floor-work",
    heuristic:true};
}

// The native pact page opens before climb(): floor is still the cleared floor.
export function chooseTowerCurseAction(offers = [], nativeRun = {}, options = {}) {
  const floor = nativeRun.tower?.floor;
  const targetFloor = Number.isInteger(floor) && floor >= 1 ? floor + 1 : null;
  const leave = {action:"leave",index:null,id:null,targetFloor};
  if (targetFloor == null) return {...leave,reason:"curse-destination-unknown"};
  const economy=offers?.some?.(offer=>offer?.id==="graves")?towerCurseEconomy(nativeRun,options):null;
  const payback=offers?.some?.(offer=>offer?.id==="iron")?towerCursePayback(nativeRun,options):null,
    damageBucket=Array.isArray(nativeRun.tempMods)?1+nativeRun.tempMods.reduce((n,m)=>n+(m.stat==="damage"&&Number.isFinite(m.mul)?m.mul-1:0),0):null,
    hunger={hpPenalty:1,relativeDamageGain:damageBucket>0?.2/damageBucket:null,penalty:"next-floor-healing-disabled"};
  // Graves ghosts are cleared at wave end, not mandatory extra wave targets.
  // The two curses only exchange adjacent positions; no new survival veto.
  const weights = {hunger:100,iron:80,dark:60,graves:economy?.gravesFirst?65:55,swift:40,twin:20};
  const known = Object.keys(weights), preferred = Array.isArray(options.cursePriority)
    ? [...new Set(options.cursePriority.filter(id => typeof id === "string" && known.includes(id)))] : [];
  // Manual order changes ranking only. Native legality and iron payback below
  // remain mandatory, including when iron is the user's first preference.
  if (preferred.length) [...preferred,...known.filter(id=>!preferred.includes(id))]
    .forEach((id,index)=>{weights[id]=(known.length-index)*20;});
  const candidates = (Array.isArray(offers) ? offers : []).map((offer,index) =>
    ({id:offer?.id,index,score:weights[offer?.id],experiencePriority:options.experienceBlessingPriority===true&&offer?.id==='twin'?1:0}))
    .filter(row => Number.isFinite(row.score) && offers[row.index]?.disabled!==true && offers[row.index]?.hidden!==true &&
      (row.id!=="iron"||payback?.accept) &&
      (!options.legal || options.legal(row.index)))
    .sort((a,b) => b.experiencePriority-a.experiencePriority || b.score-a.score || a.index-b.index);
  return candidates.length ? {action:"choose",...candidates[0],targetFloor,candidates,economy,payback,hunger,reason:"curse-benefit-and-target-floor-work"} : {...leave,candidates,economy,payback,hunger};
}

export const tacticalChoice = chooseOfferAction;

// Season 2 paused pages expose their own legal offers. These helpers never
// execute recipes, spend stats, or synthesize an offer absent from that page.
export function chooseFusionAction(offers = [], run = {}, data = {}) {
  const player = run.player || {}, build = run.build || {};
  const final=run.finalReplacement||build.finalReplacement, fusion=final?.fusion;
  if(final?.unified?.enabled && !fusion?.enabled)
    return {action:"leave",index:null,key:null,candidates:[],reason:"unified-destination-has-no-requested-fusion"};
  if(final?.strictMoves?.enabled&&!fusion?.pending?.ready)
    return {action:"leave",index:null,key:null,candidates:[],reason:"strict-fusion-no-ready-requested-recipe"};
  if(fusion?.enabled && (!fusion.active || !fusion.pending?.ready))
    return {action:"leave",index:null,key:null,candidates:[],reason:!fusion.active?"final-fusion-threshold-wait":"final-fusion-not-ready"};
  const preferences = choiceMovePreferences(build), avoid = new Set(build.avoidMoves || []);
  const candidates = [];
  for (const [index, offer] of (Array.isArray(offers) ? offers : []).entries()) {
    const recipe = offer?.r, a = player.moves?.[offer?.a], b = player.moves?.[offer?.b];
    const requested=fusion?.enabled?Math.max(1,(fusion.targets||[]).filter(key=>key===recipe?.key).length):1,
      made=Math.max((player.moves||[]).filter(move=>move?.def?.key===recipe?.key).length,
        (run.nativeRun?.fusions||player.run?.fusions||[]).filter(key=>key===recipe?.key).length);
    if(made>=requested)continue;
    const parentKeys=[a?.def?.key,b?.def?.key], planned=!!(fusion?.enabled && fusion.active && fusion.pending?.ready &&
      recipe?.key===fusion.pending.key && parentKeys.every(key=>fusion.pending.parents.includes(key)));
    if(fusion?.enabled && !planned)continue;
    if (!offer?.ready || !recipe?.key || !a || !b || offer.a === offer.b ||
        Number(a.level) < 8 || Number(b.level) < 8 ||
        [a, b].some(move => ["buff", "weather", "fusion"].includes(move.def?.arch)) ||
        avoid.has(recipe.key)&&!planned) continue;
    if(parentKeys.some(key=>fusionPreservedMoves(build).includes(key)))continue;
    const explicit = preferences.find(entry => entry.key === recipe.key);
    if (final?.moves?.enabled && parentKeys.some(key=>
      (final.moves.configuredTargets || final.moves.targets).includes(key)) &&
      ((run.nativeRun || player.run)?.tower || !explicit && !planned)) continue;
    if (build.sourceType === "custom" && !explicit && !planned &&
        (build.allowOffPlan === false || build.replacementPolicy === "never" ||
         parentKeys.some(key => preferences.some(entry => entry.key === key)))) continue;
    // Recipes describe different native multi-hit geometries. Power/cooldown
    // is a bounded clue only, not a prediction of hit rate or resulting DPS.
    const clue = Number(recipe.power) > 0 && Number(recipe.cd) > 0
      ? Math.min(12, Math.max(0, Number(recipe.power) / Number(recipe.cd) * 3)) : 0;
    const classWeight = Math.max(0, Math.min(5, Number(build.statWeights?.[recipe.cls] ?? 1)));
    const score = 20 + ({signature:18,reaction:9,type:6,glitch:0}[recipe.kind] ?? 0) + clue * classWeight +
      (explicit ? Math.max(20, 48 - explicit.rank * 3) : 0)+(planned?100000:0);
    candidates.push({index,key:recipe.key,score,explicit:!!explicit,parentKeys});
  }
  candidates.sort((a,b)=>b.score-a.score||a.index-b.index);
  return candidates.length ? {action:"choose",...candidates[0],candidates,reason:"native-ready-fusion"}
    : {action:"leave",index:null,key:null,candidates,reason:"no-legal-useful-fusion"};
}

const nativeRecompileStats = {
  damage:[{stat:"damage",mul:1.3},{stat:"damage",mul:.85}],
  attackSpeed:[{stat:"attackSpeed",mul:1.25},{stat:"attackSpeed",mul:.88}],
  maxHp:[{stat:"maxHp",mul:1.25},{stat:"maxHp",mul:.85}],
  moveSpeed:[{stat:"moveSpeed",mul:1.2},{stat:"moveSpeed",mul:.9}],
  critChance:[{stat:"critChance",add:.15},{stat:"critChance",add:-.08}],
  area:[{stat:"area",mul:1.3},{stat:"area",mul:.85}],
  xpGain:[{stat:"xpGain",mul:1.4},{stat:"xpGain",mul:.8}],
  regen:[{stat:"regen",add:2.5},{stat:"regen",mul:.6}],
  armor:[{stat:"armor",add:20},{stat:"armor",mul:.75}],
  duration:[{stat:"duration",mul:1.4},{stat:"duration",mul:.8}],
  statusChance:[{stat:"statusChance",mul:1.4},{stat:"statusChance",mul:.8}],
  luck:[{stat:"luck",add:40},null],
};
export function chooseNativeTrade(page = {}, run = {}, data = {}, options = {}) {
  const player = run.player || {}, build = run.build || {}, kind = options.kind;
  const hpRatio = Number(player.maxHp)>0 ? Number(player.hp)/Number(player.maxHp) : 1;
  const context = decisionPlayer(run),costSettings=normalizeCostSettings(options.costSettings||options),
    forced=costSettings.forceCostInteractions,approved=forced||options.risky===true&&options.allowRisky===true;
  const towerTrick=typeof options.resolvedTowerTrick==="boolean" ? options.resolvedTowerTrick : !(run.experienceBlessingPriority===true && (run.nativeRun || player.run || run).tower) && options.onlyExperience!==true && (typeof options.towerTrick==="boolean"?options.towerTrick:Number(player.stats?.luck)>=125);
  const candidates=[];
  for(const [index,offer] of (Array.isArray(page.offers)?page.offers:[]).entries()) {
    if(!offer || offer.off || offer.disabled || typeof offer.key!=="string"||
        typeof options.legal==="function"&&options.legal(index)!==true)continue;
    let score=-Infinity,descriptor=costDescriptor();
    if(kind==="tower" && towerTrick && offer.key==="trick")score=100;
    else if(kind==="tower" && !towerTrick && offer.key==="treat")score=20+(hpRatio<.9?20:0);
    else if(kind==="fossil"&&approved&&["helix","dome","amber"].includes(options.fossilKey)) {
      descriptor=nativeCostDescriptor("fossil",offer.key);
      if(offer.key===options.fossilKey&&options.allowRisky===true)score=100000;
    }
    else if(approved && hpRatio>0) {
      if(kind==="porygon") {
        const [up,down,...extra]=offer.key.split(">");
        const gain=nativeRecompileStats[up]?.[0],loss=nativeRecompileStats[down]?.[1];
        if(!extra.length&&gain&&loss&&up!==down&&(forced||masteryOfferAllowed({mods:[gain]},run,data))) {
          descriptor=costDescriptor([gain,loss],[],true);
          const speed=Number(player.stats?.moveSpeed)||1,maxHp=Number(player.maxHp)||0;
          const fatal=loss.stat==='moveSpeed'&&speed*(loss.mul??1)+(loss.add||0)<.65 ||
            loss.stat==='maxHp'&&maxHp*(loss.mul??1)+(loss.add||0)<1;
          if(forced||!fatal)score=forced?costPositiveScore(descriptor,run):scoreMods([gain,loss],hpRatio,context);
        }
      } else if(kind==="fossil" && ["helix","dome","amber"].includes(offer.key)) {
        descriptor=nativeCostDescriptor("fossil",offer.key);
        const loss={helix:.85,dome:.8,amber:.75}[offer.key];
        const reward={helix:35,dome:30,amber:25}[offer.key];
        score=reward+scoreMods([{stat:"maxHp",mul:loss}],hpRatio,context);
        if(offer.key==="amber" && run.nativeRun?.allies?.team?.length>=run.nativeRun?.allies?.cap)score-=15;
      }
    }
    if(forced&&descriptor.cost&&descriptor.positiveEffects.length)score=costPositiveScore(descriptor,run);
    if(Number.isFinite(score)&&score>0)candidates.push({index,key:offer.key,score,
      cost:descriptor.cost,costRank:costPriorityRank(descriptor,costSettings),positiveEffects:descriptor.positiveEffects});
  }
  candidates.sort(compareCostChoices);
  return candidates.length ? {action:"choose",...candidates[0],candidates,reason:"native-benefit-with-accepted-cost"}
    : {action:"leave",index:null,key:null,candidates,reason:"no-approved-beneficial-trade"};
}

export function choosePactAction(offers = [], run = {}, options = {}) {
  const player=run.player||{},context=decisionPlayer(run),hp=player.maxHp>0?player.hp/player.maxHp:1,
    costSettings=normalizeCostSettings(options.costSettings||options),forced=costSettings.forceCostInteractions,
    approved=forced||options.risky===true&&options.allowRisky===true,
    native=run.nativeRun||player.run||{},candidates=[];
  for(const [index,offer] of offers.entries()){
    const key=offer?.id;if(typeof key!=='string'||offer.off||offer.disabled)continue;
    if(typeof options.legal==='function'&&!options.legal(index))continue;
    const descriptor=nativeCostDescriptor(native.tower?"towerPact":"pact",key);
    if(!approved&&!options.mandatory)continue;
    if(key==='thorn'&&options.expandVitaminSlots===true&&approved&&
        (forced||run.build?.masteryConstraints?.noVitamins!==true)){
      candidates.push({index,key,score:100000,cost:true,costRank:costPriorityRank(descriptor,costSettings),
        positiveEffects:descriptor.positiveEffects,reason:'requested-native-vitamin-slot'});continue;
    }
    if(!descriptor.positiveEffects.length||key==='thorn'&&!forced&&!options.mandatory||
        !forced&&!options.mandatory&&!masteryOfferAllowed({mods:descriptor.mods},run,{}))continue;
    if(!forced&&!options.mandatory&&hp<.35&&!context.decisionProfile.oneHit&&['fury','glass','elite'].includes(key))continue;
    let score=scoreMods(descriptor.mods,hp,context)+descriptor.rewardScore;
    if(key==='fury')score-=context.decisionProfile.late||context.decisionProfile.oneHit?3:12;
    if(key==='wind')score-=5;
    if(key==='elite')score-=12;
    if(key==='greed')score-=6;
    if(forced||options.mandatory)score=costPositiveScore(descriptor,run);
    if(score>0&&Number.isFinite(score))candidates.push({index,key,score,cost:true,
      costRank:costPriorityRank(descriptor,costSettings),positiveEffects:descriptor.positiveEffects,
      reason:'beneficial-native-pact-with-accepted-cost'});
  }
  if(!candidates.length&&options.mandatory===true)for(const [index,offer]of offers.entries())
    if(offer&&!offer.off&&!offer.disabled&&(typeof options.legal!=="function"||options.legal(index)===true))
      candidates.push({index,key:offer.id,score:0,cost:true,costRank:Infinity,positiveEffects:[],reason:'mandatory-native-cost-fallback'});
  candidates.sort(compareCostChoices);
  return candidates.length?{action:'choose',...candidates[0],candidates}:{action:'leave',index:null,candidates,reason:'no-beneficial-approved-pact'};
}

// Reviewed 0.9.8 relic channels. These are bounded utility estimates over
// observed triggers, not total DPS or a globally optimal relic combination.
const relicEnemyFlags = Object.freeze({Elite:1,Alpha:2,Boss:4,Totem:4096,Summoner:8192});
const relicAlphaFamily = relicEnemyFlags.Alpha|relicEnemyFlags.Totem|relicEnemyFlags.Summoner;
const relicBossFamily = relicEnemyFlags.Boss|relicAlphaFamily;
const reviewedRelicKeys = new Set(['c-fang','c-shell','c-feather','c-coin','c-ember','c-amber','c-crystal','c-lodestone','c-seed','u-claw','u-scale','u-storm','u-heart','u-hourglass','u-horn','u-clover','u-dew','r-bell','r-meteor','r-conch','r-crimson','r-aegis','r-lantern','r-comet','e-crown','e-prism','e-clock','e-volcano','e-swarm','l-heart','l-star','l-dragon']);
export function evaluateRelicOffer(def, nativeRun, options = {}) {
  const p=nativeRun?.player,zero={key:def?.key,known:false,score:0,base:0,passive:0,conditional:0,explanation:['unreviewed-relic'],unit:'bounded-utility-not-dps'};
  if(!p||!reviewedRelicKeys.has(def?.key))return zero;
  const finite=(n,f=0)=>Number.isFinite(Number(n))?Number(n):f,v=def.v||{},en=nativeRun.enemies||{},pos=p.pos||{},alive=[];
  for(let i=0;i<finite(en.n,en.alive?.length||0);i++)if(en.alive?.[i]&&!(en.dying?.[i]>0))alive.push(i);
  const near=(radius)=>alive.filter(i=>[en.x?.[i],en.z?.[i],pos.x,pos.z].every(Number.isFinite)&&Math.hypot(en.x[i]-pos.x,en.z[i]-pos.z)<=radius);
  const hp=Math.max(1,finite(p.maxHp,100)),ratio=Math.max(0,Math.min(1,finite(p.hp,hp)/hp)),missing=1-ratio,urgency=ratio<.35?2:ratio<.65?1.4:1;
  const killRate=Math.max(0,finite(nativeRun.stats?.kills)/Math.max(1,finite(nativeRun.realTime,nativeRun.time))),crit=Math.max(0,Math.min(1,finite(p.stats?.critChance))),evasion=Math.max(0,finite(p.stats?.evasion));
  const flagged=mask=>alive.some(i=>(finite(en.flags?.[i])&mask)!==0),status=alive.some(i=>['burn','poison','para','wet','chill','frozen','sleep','confuse','curse','root'].some(k=>finite(en[k]?.[i])>0));
  const levelDamage=amount=>finite(amount)*(1+Math.max(0,finite(p.level))* .1),area=Math.max(.1,finite(p.stats?.area,1)),healUtility=fraction=>Math.min(missing,Math.max(0,finite(fraction)))*90*urgency;
  const pulseUtility=(amount,seconds,radius)=>near(radius).length?Math.min(18,levelDamage(amount)/Math.max(1,seconds)*Math.min(3,near(radius).length)/12):0;
  const explanation=['native-base-mods',`native-three-slots; unique-key; ${def.key}`];let passive=0,conditional=0;
  switch(def.key){
    case 'c-fang': passive=flagged(relicEnemyFlags.Elite)?finite(v.elite)*90:0;explanation.push('elite-target-present');break;
    case 'c-shell':passive=p.xpNext>0||nativeRun.pendingLevels>0?healUtility(v.heal):0;explanation.push('level-up-heal; only-missing-hp');break;
    case 'c-feather':passive=evasion>0&&alive.length?finite(v.speed)*Math.min(1,evasion)*20:0;explanation.push('native-dodge-trigger-required');break;
    case 'c-coin':passive=options.rules?.paid===false?0:Math.min(10,killRate/Math.max(1,v.every)*v.piles*20);explanation.push('observed-kill-cadence; economy');break;
    case 'c-ember':passive=status?finite(v.status)*90:0;explanation.push('observed-status-required');break;
    case 'c-amber':passive=ratio>finite(v.above,1)?finite(v.dmg)*90:0;explanation.push('current-hp-above-native-threshold');break;
    case 'c-crystal':passive=flagged(relicBossFamily)?finite(v.big)*90:0;explanation.push('boss-alpha-totem-summoner-present');break;
    case 'c-lodestone':passive=nativeRun.pickups?.n>0?Math.min(5,40/Math.max(1,v.every)):0;explanation.push('existing-pickups; no-invented-drops');break;
    case 'c-seed':passive=nativeRun.interactables?.list?.some(o=>o.kind==='berry'&&!o.used)?healUtility(Math.max(0,finite(v.berry,1)-1)*.1):0;explanation.push('available-native-berry');break;
    case 'u-claw':passive=Math.min(finite(v.max),Math.floor(Math.max(0,finite(nativeRun.relics?.clawKills))/Math.max(1,v.kills))*finite(v.step))*90;explanation.push('observed-unhit-kills; reset-on-hurt');break;
    case 'u-scale':passive=alive.length&&!(nativeRun.relics?.t?.scale>0)?(1-finite(v.cut,1))*10*urgency:0;explanation.push('next-hit-ready; native-cooldown');break;
    case 'u-storm':passive=pulseUtility(v.dmg,v.every,v.range);explanation.push('nearby-target; native-five-second-cadence');break;
    case 'u-heart':passive=ratio<finite(v.below)&&!(nativeRun.relics?.t?.heart>0)?finite(v.shield)*40*urgency:0;explanation.push('low-hp-shield-trigger; native-cooldown');break;
    case 'u-hourglass':passive=nativeRun.ult?finite(v.ult)*25:0;explanation.push('native-ultimate-charge-channel');break;
    case 'u-horn':passive=flagged(relicEnemyFlags.Elite)&&killRate>0?pulseUtility(v.dmg,Math.max(1,1/killRate),finite(v.r)*area):0;explanation.push('elite-kill-trigger; observed-kill-rate');break;
    case 'u-clover':passive=options.rules?.paid===false?0:nativeRun.interactables?.list?.some(o=>o.kind==='chest'&&!o.used)?finite(v.chest)*25:0;explanation.push('available-paid-ball; no-extra-spend-authorization');break;
    case 'u-dew':passive=flagged(relicAlphaFamily)?healUtility(v.heal):0;explanation.push('alpha-totem-summoner-kill-heal');break;
    case 'r-bell':passive=pulseUtility(v.dmg,v.every,finite(v.r)*area);explanation.push('native-periodic-wave');break;
    case 'r-meteor':passive=killRate>0?pulseUtility(v.dmg,finite(v.every)/killRate,v.r):0;explanation.push('observed-kill-cadence; nearby-meteor');break;
    case 'r-conch':conditional=alive.some(i=>finite(en.wet?.[i])>0)?finite(v.wet)*90:0;passive=pulseUtility(v.dmg,v.every,finite(v.r)*area)+conditional;explanation.push('periodic-wet-wave; wet-damage-only-on-observed-wet');break;
    case 'r-crimson':passive=crit>0&&!(nativeRun.relics?.t?.crimson>0)?healUtility(v.heal):0;explanation.push('single-native-critical-heal; cooldown-ready; missing-hp; not-rate');break;
    case 'r-aegis':passive=alive.length?finite(v.shield)*35*urgency:0;explanation.push('native-twelve-second-shield-refresh');break;
    case 'r-lantern':passive=killRate>0?pulseUtility(v.dmg,1/(killRate*Math.max(.001,v.chance)),v.r):0;explanation.push('observed-kill-rate; native-probability');break;
    case 'r-comet':passive=nativeRun.pendingLevels>0&&near(16).length?Math.min(12,levelDamage(v.dmg)*finite(v.stars)/120):0;explanation.push('pending-level-star-burst; single-trigger-utility-not-rate');break;
    case 'e-crown':conditional=flagged(relicBossFamily)?finite(v.big)*90:0;passive=conditional+(nativeRun.relics?.crownStage===nativeRun.stage?Math.min(finite(v.max),finite(nativeRun.relics?.crownStacks))*90:0);explanation.push('native-boss-family; observed-current-zone-stacks');break;
    case 'e-prism':passive=crit>0&&!(nativeRun.relics?.t?.prism>0)&&near(v.r).length>1?Math.min(20,crit*finite(v.share)*Math.min(finite(v.n),near(v.r).length-1)*40):0;explanation.push('critical-chain; distinct-nearby-secondary-targets');break;
    case 'e-clock':passive=near(v.r).some(i=>!(finite(en.flags?.[i])&relicEnemyFlags.Boss))?finite(v.secs)/Math.max(1,v.every)*25:0;explanation.push('nearby-nonboss-stun; native-duty-cycle');break;
    case 'e-volcano':passive=killRate>0&&alive.some(i=>finite(en.burn?.[i])>0)?pulseUtility(v.dmg,Math.max(1,1/killRate),v.r):0;explanation.push('observed-burning-kill-trigger');break;
    case 'e-swarm':passive=Math.min(finite(v.max),Math.floor(near(v.r).length/Math.max(1,v.per))*.01)*90;explanation.push('observed-nearby-count; native-cap');break;
    case 'l-heart':passive=nativeRun.stage<4&&!nativeRun.sanctuary?3:0;explanation.push('future-legal-rift-card-count; no-invented-current-reward');break;
    case 'l-star':passive=pulseUtility(v.dmg,v.every,18);explanation.push('nearby-star-strike; native-ten-second-cadence');break;
    case 'l-dragon':passive=nativeRun.relicDragonStage!==nativeRun.stage?20*urgency:0;explanation.push('native-once-per-zone-revival; unavailable-after-use');break;
  }
  const base=Math.max(0,scoreMods(def.mods||[],ratio,p));
  return {key:def.key,known:true,base,passive:Math.max(0,passive),conditional,score:base+Math.max(0,passive),explanation,unit:'bounded-utility-not-dps'};
}
export function chooseRelicAction(offers, nativeRun, options = {}) {
  const keys=nativeRun?.relicKeys||[],held=nativeRun?.relics?.list?.()||[];
  if(keys.length>3||held.length!==keys.length)return {action:'leave',reason:'unverified-native-capacity',candidates:[]};
  const previous=held.map(d=>evaluateRelicOffer(d,nativeRun,options));
  const candidates=[];
  for(const [index,offer]of (offers||[]).entries()){
    if(!offer||offer.disabled||offer.off||keys.includes(offer.key)||options.legal?.(index)===false)continue;
    const score=evaluateRelicOffer(offer,nativeRun,options);if(!score.known||!(score.score>0))continue;
    const weakest=keys.length>=3?previous.reduce((a,b,i)=>a===null||b.score<previous[a].score?i:a,null):null;
    const gain=score.score-(weakest===null?0:previous[weakest].score);
    if(gain>.05)candidates.push({index,key:offer.key,replaceIndex:weakest,gain,evaluation:score,replaced:weakest===null?null:previous[weakest]});
  }
  candidates.sort((a,b)=>b.gain-a.gain||a.index-b.index);
  return candidates.length?{action:'choose',...candidates[0],candidates}:{action:'leave',reason:'no-reviewed-improvement',candidates};
}
