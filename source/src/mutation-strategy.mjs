// Read-only native daily-mode projection. Native methods retain all generation,
// rewards and start authority; this module never creates a seed or save proof.
export function normalizeMutationSettings(value={},previous=null) {
  return {target:['daily-rewards','leaderboard'].includes(value?.target)?value.target:
    previous?.target==='leaderboard'?'leaderboard':'daily-rewards',
    afterDailyRewards:['wait-next-day','stop'].includes(value?.afterDailyRewards)?value.afterDailyRewards:
      previous?.afterDailyRewards==='stop'?'stop':'wait-next-day'};
}

export function mutationTodaySnapshot(bridge,meta) {
  if(typeof bridge?.mutationToday!=='function'||typeof meta?.now!=='function')return null;
  try {
    const now=meta.now();if(!Number.isFinite(now))return null;
    const raw=bridge.mutationToday(now),def=raw?.mutation;
    if(!Number.isSafeInteger(raw?.day)||raw.day<0||!Number.isFinite(raw.ends)||raw.ends<=now||
        typeof raw.biome!=='string'||!/^[a-z][a-z0-9-]{0,39}$/.test(raw.biome)||
        typeof def?.id!=='string'||!/^[a-z][a-z0-9-]{0,39}$/.test(def.id)||
        !Number.isInteger(def.tier)||def.tier<0||def.tier>2)return null;
    return {day:raw.day,ends:raw.ends,now,variant:def.id,biome:raw.biome,tier:def.tier,
      name:typeof def.name==='string'?def.name:def.id,
      description:typeof def.desc==='string'?def.desc:'',
      rules:Array.isArray(def.rules)?def.rules.filter(x=>typeof x==='string').slice(0,12):[],
      swapSeconds:Number.isFinite(def.swap)&&def.swap>0?def.swap:0,
      hpMultiplier:Number.isFinite(def.hp)&&def.hp>0?def.hp:1,
      damageMultiplier:Number.isFinite(def.dmg)&&def.dmg>0?def.dmg:1};
  } catch {return null;}
}

export function mutationSavedProgress(profile,today,verified=false) {
  const unknown={known:false,paid:null,complete:false};
  if(!verified||!today||!profile||typeof profile!=='object'||Array.isArray(profile))return unknown;
  const state=profile.mutation;
  if(state==null)return {known:true,paid:0,complete:false};
  if(typeof state!=='object'||Array.isArray(state)||!Number.isSafeInteger(state.day))return unknown;
  if(state.day!==today.day)return {known:true,paid:0,complete:false};
  if(!Number.isInteger(state.paid)||state.paid<0||state.paid>5)return unknown;
  return {known:true,paid:state.paid,complete:state.paid>=5};
}

export function mutationPublicPlan(today,settings,progress) {
  if(!today)return null;
  const options=normalizeMutationSettings(settings);
  return {day:today.day,ends:today.ends,variant:today.variant,name:today.name,biome:today.biome,
    tier:today.tier,rules:today.rules,description:today.description,...options,
    rewards:{known:progress?.known===true,paid:progress?.known?progress.paid:null,
      complete:progress?.known===true&&progress.complete===true}};
}

export function mutationAdaptiveBuild(build,run) {
  const def=run?.mutation?.def;
  if(!def)return build;
  // Exact native values (including quarter HP) remain in the player state;
  // this is only a modest preference for automatic recommendations.
  if(build?.sourceType==='custom')return build;
  const statWeights={...(build?.statWeights||{})};
  if(Number.isFinite(def.hp)&&def.hp<1)for(const key of ['maxHp','armor','evasion','shieldMax'])
    statWeights[key]=(Number.isFinite(statWeights[key])?statWeights[key]:1)*1.2;
  return {...build,statWeights,mutationVariant:def.id};
}

// Metronome replaces ordinary slots after the first on its own schedule.
// Keep normal learning/upgrading preferences, but do not repeatedly pay a
// tutor to chase an unstable ordinary slot. Fusion preparation stays intact.
export function mutationReplacementState(replacement,run) {
  if(!(run?.mutation?.def?.swap>0)||replacement?.fusion?.pending||!replacement?.moves)return replacement;
  const forget=(replacement.moves.forget||[]).filter(slot=>slot===0),
    vitamins=replacement.vitamins?.forget||[];
  return {...replacement,moves:{...replacement.moves,forget,nativePeriodicReplacement:true},
    needsTutor:forget.length>0||vitamins.length>0};
}
