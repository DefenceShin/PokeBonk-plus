// Shared public definitions, never a profile/ownership cache. Native dynamic
// eligibility is delegated on each call; null means unknown, not permitted.
const GAME_LIBRARY_EMPTY = Object.freeze([]);
const gameLibraryCache = new WeakMap();
const gameLibrarySpeciesFields = ['id','key','name','types','family','evoFrom','evoLevel','evoItem','evoStage','bst','legendary','mythical','baby','nativeFallback'];
const gameLibraryMemberFields = ['id','key','name','types','kit','kitUnlockLevels','role','roleName','passive','branch'];
const gameLibraryLearningFields = ['id','key','name','level','minLevel','requiredLevel','from','open','available','locked'];
const gameLibraryRows = value => Array.isArray(value) ? value : GAME_LIBRARY_EMPTY;
// Current reviewed news.at(map,tier). Only this shared rule owns the numeric
// formula; catalog consumers receive its generated per-map table. A source
// change is checked against the actual native function in game-library tests.
export function reviewedChampionTimeLimit(stageCount,tier) {
  if(![3,4].includes(stageCount) || !Number.isInteger(tier) || tier<0 || tier>2)return null;
  return Math.round((630+(stageCount===4?180:0))*(1+tier*.05));
}
// Reviewed native Run.enterPortal/onBossKilled: a sanctuary map ends at4;
// ordinary maps without one end at3. No catalog/UI consumer owns a copy.
export function reviewedStandardStageCount(biome) {
  return biome&&typeof biome==="object"?biome.sanctuary?4:3:null;
}
// Reviewed native Run.migrate uses zone = zoneAt(biome, 1 + migrations % 3).
// These are terrain migration variants, independent of time-driven endless
// combat phases and the standard sanctuary stage. Never count the sanctuary.
export function reviewedEndlessAreaCount(biome) {
  return biome && typeof biome === "object" ? 3 : null;
}
// The source adapter observes the native shared-random exclusion expression
// without executing its generator. Missing/ambiguous rules retain the older
// conservative limit; visible native offers remain their own legality proof.
export function sharedRandomMoveLimit(bridge = {}) {
  const limit=bridge?.compatibility?.learningRules?.sharedRandomMoveLimit;
  return limit===2?2:1;
}
export function rankingCampRoute(routeKey) {
  return routeKey === "leaderboard-kills" ? "kills" :
    ["endless", "leaderboard-survival"].includes(routeKey) ? "endless" : null;
}
export function normalizedRankingCampStage(value, routeKey) {
  if (value === "auto") return "auto";
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 1000 ? value :
    rankingCampRoute(routeKey) === "kills" ? 3 : "auto";
}
// Per-account planning uses public learning routes; no account-dependent result
// is cached with the shared definitions. This does not replace native canLearn.
export function characterUnlockActorCapabilities(rules, ownedIds = []) {
  if(rules?.schemaVersion!==1 || !Array.isArray(rules.actors))return [];
  const owned=new Set((Array.isArray(ownedIds)?ownedIds:[]).filter(id=>Number.isInteger(id)&&id>0));
  const routeAllowed=route=>['kit','line','shared','any'].includes(route?.kind) &&
    (!route.requiresSharedUnlock || Array.isArray(route.from)&&route.from.some(id=>owned.has(id)));
  return rules.actors.filter(actor=>actor&&owned.has(actor.id)&&Array.isArray(actor.moves)).map(actor=>{
    const moves=actor.moves.flatMap(move=>{
      if(!move||!Array.isArray(move.routes))return [];
      const routes=move.routes.filter(routeAllowed);if(!routes.length)return [];
      return [{...move,availableLevel:Math.min(...routes.map(route=>Math.max(1,Number(route.minLevel)||1)))}];
    });
    const mods=Array.isArray(actor.passive?.mods)?actor.passive.mods:[],
      add=stat=>mods.filter(mod=>mod?.stat===stat).reduce((sum,mod)=>sum+(Number.isFinite(mod.add)?mod.add:0),0),
      mul=stat=>mods.filter(mod=>mod?.stat===stat).reduce((product,mod)=>product*(Number.isFinite(mod.mul)?mod.mul:1),1),
      evasion=Math.max(0,add('evasion')),regen=Math.max(0,add('regen')),healing=Math.max(0,mul('healing')),lifesteal=Math.max(0,add('lifesteal')),critChance=Math.max(0,add('critChance')),
      contactSafety=(1+evasion*2)*(1+Math.min(1,regen/5+lifesteal*4))/(actor.passive?.dmgTaken>0?actor.passive.dmgTaken:1),
      combatPotential=Math.max(1,Number(actor.evolutionBstPotential ?? actor.bst)||1)/100*Math.max(.1,mul('damage'))*Math.max(.1,mul('attackSpeed'))*Math.sqrt(contactSafety);
    return {id:actor.id,name:actor.name,types:[...(actor.types || [])],moves,evasion,regen,healing,lifesteal,critChance,combatPotential,
      healPotential:(regen*healing+lifesteal*combatPotential*10+moves.reduce((sum,move)=>sum+Math.max(0,move.drain || 0),0)),
      sourceHash:rules.provenance?.sourceHash || null};
  });
}
const gameLibraryId = value => Number.isInteger(Number(value)) && Number(value)>0 ? Number(value) : null;
const gameLibraryRead = (read,fallback=null) => { try { return read() ?? fallback; } catch { return fallback; } };
function gameLibraryPublicValue(value,depth=0) {
  if (depth>4 || value==null) return null;
  if (['string','boolean'].includes(typeof value) || typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.slice(0,512).map(item=>gameLibraryPublicValue(item,depth+1)));
  return null;
}
function gameLibraryProject(row,fields) {
  if (!row || typeof row!=='object') return null;
  return Object.freeze(Object.fromEntries(fields.filter(key=>Object.hasOwn(row,key)).map(key=>[key,gameLibraryPublicValue(row[key])])));
}

/**
 * One public-definition view. Caller-owned tables remain untouched. Optional
 * reviewed tables are ignored when their supplied hash contradicts native.
 * Missing definitions/families return null/[]; neither implies unlockability.
 */
export function createGameLibrary(options={}) {
  const bridge=options.bridge || null,data=bridge?.data || null,
    nativeHash=bridge?.compatibility?.sourceHash || null,reviewedHash=options.sourceHash || null,
    reviewedCompatible=!nativeHash || !reviewedHash || nativeHash===reviewedHash,
    pokemon=gameLibraryRows(reviewedCompatible ? options.pokemon : null),
    nativePokemon=gameLibraryRows(data?.pokemon),
    roster=Array.isArray(bridge?.roster) ? bridge.roster : gameLibraryRows(reviewedCompatible ? options.roster : null),
    families=gameLibraryRows(reviewedCompatible ? options.families : null),
    localization=reviewedCompatible ? options.localization || {} : {},
    speciesIndex=new Map([...pokemon,...nativePokemon].map(row=>[Number(row.id),row])),
    memberIndex=new Map(roster.map(row=>[Number(row.id),row])),
    lookMemberIds=new Set(gameLibraryRows(reviewedCompatible ? options.lookMemberIds : null).length ? options.lookMemberIds.map(Number) : memberIndex.keys()),
    familyIndex=new Map(),familyBySpecies=new Map();
  for (const row of families) {
    const id=gameLibraryId(row?.id);if(id==null)continue;
    const family=Object.freeze({id,species:Object.freeze([...new Set(gameLibraryRows(row.species).map(gameLibraryId).filter(id=>id!=null))]),
      types:Object.freeze(gameLibraryRows(row.types).filter(type=>typeof type==='string')),
      ...(Number.isFinite(row.goal)?{goal:row.goal}:{})});
    familyIndex.set(id,family);for(const member of family.species)familyBySpecies.set(member,family);
  }
  const rawSpecies=id=>{
    id=gameLibraryId(id);if(id==null)return null;
    // A native authoritative lookup returning no record is not replaced with
    // an old offline species. A missing API can use reviewed static tables.
    if(typeof data?.get==='function')return gameLibraryRead(()=>data.get(id));
    if(typeof data?.byId?.get==='function')return gameLibraryRead(()=>data.byId.get(id));
    return speciesIndex.get(id) || null;
  };
  const species=id=>gameLibraryProject(rawSpecies(id),gameLibrarySpeciesFields);
  const member=id=>{
    const raw=memberIndex.get(gameLibraryId(id)),projected=gameLibraryProject(raw,gameLibraryMemberFields);
    if(!projected)return null;
    return Object.freeze({...projected,...(raw.challenge ? {challenge:Object.freeze((Array.isArray(raw.challenge)?raw.challenge:[raw.challenge])
      .map(condition=>gameLibraryProject(condition,['counter','goal','desc'])))}:{})});
  };
  const familyOf=id=>{
    id=gameLibraryId(id);if(id==null)return null;
    if(familyBySpecies.has(id))return familyBySpecies.get(id);
    const familyId=gameLibraryId(rawSpecies(id)?.family);if(familyId==null)return null;
    if(familyIndex.has(familyId))return familyIndex.get(familyId);
    const members=[...speciesIndex.values()].filter(row=>Number(row.family)===familyId).map(row=>gameLibraryId(row.id)).filter(id=>id!=null);
    if(!members.length)return null;
    const family=Object.freeze({id:familyId,species:Object.freeze([...new Set(members)]),types:Object.freeze([...new Set(members.flatMap(id=>gameLibraryRows(rawSpecies(id)?.types)))])});
    familyIndex.set(familyId,family);for(const id of family.species)familyBySpecies.set(id,family);
    return family;
  };
  const speciesName=(id,fallback='#'+id)=>{
    const label=localization?.pokemon?.[id],raw=rawSpecies(id),playable=memberIndex.get(gameLibraryId(id));
    return typeof label==='string' && label ? label : typeof label?.name==='string' && label.name ? label.name :
      typeof raw?.name==='string' && raw.name ? raw.name : typeof playable?.name==='string' && playable.name ? playable.name : String(fallback);
  };
  const nativeBoolean=(method,...args)=>{
    return gameLibraryRead(()=>{const fn=method();if(typeof fn!=='function')return null;
      const result=fn(...args);return typeof result==='boolean' ? result : null;});
  };
  return Object.freeze({
    source:Object.freeze({sourceHash:nativeHash || reviewedHash,gameVersion:bridge?.compatibility?.gameVersion || options.gameVersion || null,reviewedCompatible}),
    species,member,speciesName,familyOf,
    familySpecies:id=>familyOf(id)?.species || GAME_LIBRARY_EMPTY,
    lookSpecies:id=>{
      const family=familyOf(id),memberId=gameLibraryId(id);
      return family ? Object.freeze(family.species.filter(speciesId=>speciesId===memberId || !lookMemberIds.has(speciesId))) : GAME_LIBRARY_EMPTY;
    },
    // Do not cache these results: caller supplies the current player/unlock
    // predicate, and native functions can change independently of static data.
    learningGuide:(id,roster,types,isUnlocked)=>{
      if(typeof bridge?.moveGuide!=='function')return null;
      const guide=gameLibraryRead(()=>bridge.moveGuide(id,roster,types,isUnlocked));
      if(!guide || typeof guide!=='object')return null;
      return gameLibraryRead(()=>{
        const groups=['kit','line','shared','any'].filter(group=>Array.isArray(guide[group]));
        if(!groups.length)return null;
        return Object.freeze({...gameLibraryProject(guide,['speciesId']),...Object.fromEntries(groups
          .map(group=>[group,Object.freeze(guide[group].map(ref=>gameLibraryProject(ref,gameLibraryLearningFields)).filter(Boolean))]))});
      });
    },
    canLearnMove:(key,player)=>nativeBoolean(()=>typeof bridge?.canLearnMove==='function' ? bridge.canLearnMove.bind(bridge) : null,key,player),
    hasSprite:id=>nativeBoolean(()=>typeof bridge?.data?.hasSprite==='function' ? bridge.data.hasSprite.bind(bridge.data) : null,id),
    hasAnimated:id=>nativeBoolean(()=>typeof bridge?.data?.hasAnimated==='function' ? bridge.data.hasAnimated.bind(bridge.data) : null,id),
  });
}

/** Cache indexes by real public definition identities/hash, never by account. */
export function getGameLibrary(bridge,options={}) {
  if(!bridge || typeof bridge!=='object')return createGameLibrary(options);
  const data=bridge.data,identity=[data,data?.pokemon,data?.pokemon?.length,data?.byId,data?.get,bridge.roster,bridge.roster?.length,
    bridge.compatibility?.sourceHash,bridge.compatibility?.gameVersion,options.sourceHash,options.pokemon,options.pokemon?.length,options.roster,options.roster?.length,
    options.families,options.families?.length,options.lookMemberIds,options.lookMemberIds?.length,options.localization,options.gameVersion];
  const cached=gameLibraryCache.get(bridge);
  if(cached && cached.identity.length===identity.length && identity.every((value,index)=>value===cached.identity[index]))return cached.library;
  const library=createGameLibrary({...options,bridge});gameLibraryCache.set(bridge,{identity,library});return library;
}
