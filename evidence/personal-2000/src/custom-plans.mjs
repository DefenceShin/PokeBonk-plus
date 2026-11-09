// Data-only strategies. These preferences never change native stats or rules.
import { getGameLibrary, reviewedStandardStageCount, reviewedEndlessAreaCount } from './game-library.mjs';

// Public recommendations have a bounded active history. User-authored plans
// are deliberately outside this policy. Re-reading one record updates it;
// it does not consume another history slot.
export function publicBuildObservedAt(build = {}) {
  const values=[build.publicObservation?.at,build.publicObservation?.collectionBatchAt,
    build.bestRecommendation?.observedAt,build.collectedAt,build.record?.date,build.date];
  return Math.max(0,...values.map(value=>typeof value==='number'?value:Date.parse(value)||0));
}
export function publicBuildCell(build = {}) {
  const row=build.record || build;
  let mode=build.mode || row.mode;
  // Mutation can finish victorious on the ordinary maps too. Only a direct
  // public mutation-board link establishes this inferred category; never write
  // a missing native record.mode or use a player's discovery leaderboard.
  if(!mode&&((build.publicObservation?.rankLinked===true&&build.publicObservation.query?.mode==='mutation')||
      (build.sources||build.provenance||[]).some(source=>source.kind==='native-public-board-run'&&
        (source.query||source.sourceQuery)?.mode==='mutation')))mode='mutation';
  if(!mode && row.victory===true && ['forest','desert','coast','glacier'].includes(row.biome))mode='standard';
  if(!mode){const modes=new Set((build.sources||build.provenance||[]).map(source=>source.query?.mode||source.sourceQuery?.mode)
    .map(value=>value==='endless'?'endless':['time','kills'].includes(value)?'standard':null).filter(Boolean));
    if(modes.size===1)mode=[...modes][0];}
  return JSON.stringify([Number(row.species),mode||'unknown',row.biome??null,row.tier!=null&&Number.isFinite(Number(row.tier))?Number(row.tier):null]);
}
export function retainRecentPublicBuilds(builds = [], maximum = 5) {
  const limit=Math.max(1,Math.min(5,Number(maximum)||5)), groups=new Map(),other=[];
  for(const build of builds){
    if(!build || build.sourceType && build.sourceType!=='leaderboard' || !build.record && build.sourceType!=='leaderboard'){
      other.push(build);continue;
    }
    const key=publicBuildCell(build),rows=groups.get(key)||[];rows.push(build);groups.set(key,rows);
  }
  const selected=[];
  const rank=row=>{
    const ranks=[row.rank,row.publicObservation?.rank,...(row.sources||row.provenance||[]).map(source=>source.rank)]
      .filter(value=>Number.isFinite(value)&&value>0);
    return ranks.length?Math.min(...ranks):Infinity;
  };
  for(const rows of groups.values()){
    rows.sort((a,b)=>publicBuildObservedAt(b)-publicBuildObservedAt(a)||
      Number(b.bestRecommendation?.selected===true)-Number(a.bestRecommendation?.selected===true)||
      rank(a)-rank(b)||String(b.id||b.record?.id||'').localeCompare(String(a.id||a.record?.id||'')));
    const seen=new Set();
    for(const row of rows){
      const record=row.record||row,detail=record.build;
      const signature=JSON.stringify([record.moves||detail?.moves?.map(move=>[move.k,move.l]),
        detail?.items||record.itemCounts||record.items,detail?.vits||record.vitamins,
        record.passive||detail?.passive]);
      if(seen.has(signature))continue;seen.add(signature);selected.push(row);
      if(seen.size>=limit)break;
    }
  }
  return [...other,...selected];
}
// One persistent four-slot destination. The runtime may project it into
// ordinary learning and native fusion work, but those are not separate goals.
// Reserved only in explicit final-slot preferences. A missing/null target keeps
// its historic "unspecified" meaning; it is never migrated into a deletion.
export const finalEmptySlot = "pb:empty-slot";
export function normalizeFinalMoveSection(entry = {}) {
  if(!entry||typeof entry!=="object"||Array.isArray(entry))entry={};
  const clean=raw=>{
    const seen=new Set(),targets=Array.from({length:4},(_,index)=>{
      const key=raw?.targets?.[index];
      if(typeof key!=="string"||!/^[A-Za-z0-9][A-Za-z0-9_.:+-]{0,99}$/.test(key)||key!=="pb:empty-slot"&&seen.has(key))return null;
      seen.add(key);return key;
    });
    return {enabled:raw?.enabled===true,level:typeof raw?.level==="number"&&Number.isFinite(raw.level)?Math.max(1,Math.min(999999,Math.trunc(raw.level))):30,targets,
      ...(Array.isArray(raw?.banishLevels)?{banishLevels:Array.from({length:4},(_,index)=>typeof raw.banishLevels[index]==='number'&&Number.isFinite(raw.banishLevels[index])?Math.max(0,Math.min(10,Math.trunc(raw.banishLevels[index]))):0)}:{})};
  };
  const archive=raw=>raw&&typeof raw==="object"&&raw.kind==="legacy-split"
    ?{kind:"legacy-split",moves:clean(raw.moves),fusion:clean(raw.fusion),acknowledged:raw.acknowledged===true}:null;
  if(entry.moves?.schemaVersion===2){
    const raw=entry.moves,normal=clean(raw),migration=archive(raw.migration);
    // Duplicated fusion instances are real destination slots. Only the native
    // planner knows their recipe/parent legality; never dedupe them by name.
    normal.targets=Array.from({length:4},(_,index)=>{
      const key=raw.targets?.[index];return typeof key==="string"&&/^[A-Za-z0-9][A-Za-z0-9_.:+-]{0,99}$/.test(key)?key:null;
    });
    return {schemaVersion:2,...normal,...(migration?{migration}:{})};
  }
  const moves=clean(entry.moves),fusion=clean(entry.fusion),enabled=moves.enabled||fusion.enabled,
    active=enabled?[...(fusion.enabled?[fusion]:[]),...(moves.enabled?[moves]:[])]:[fusion,moves],
    nonempty=active.filter(section=>section.targets.some(Boolean)),
    targets=active.length===1?active[0].targets:nonempty.length===1?nonempty[0].targets:[...new Set(active.flatMap(section=>section.targets.filter(Boolean)))],
    levels=active.filter(section=>enabled?section.enabled:section.targets.some(Boolean)).map(section=>section.level),
    migration=moves.enabled||fusion.enabled||moves.targets.some(Boolean)||fusion.targets.some(Boolean)
      ?{kind:"legacy-split",moves,fusion,acknowledged:false}:null;
  return {schemaVersion:2,enabled,level:levels.length?Math.max(...levels):30,
    targets:Array.from({length:4},(_,index)=>targets[index]||null),...(migration?{migration}:{})};
}

export function normalizeFinalStageProfiles(value={}) {
  const result={};if(!value||typeof value!=="object"||Array.isArray(value))return result;
  for(const [map,stages]of Object.entries(value).slice(0,32)){
    if(["__proto__","prototype","constructor"].includes(map)||map!=="default"&&!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(map)||!stages||typeof stages!=="object"||Array.isArray(stages))continue;
    const rows={};for(const stage of ["1","2","3"]){const entry=stages[stage];if(!entry||typeof entry!=="object"||Array.isArray(entry))continue;
      const row={};if(entry.moves&&typeof entry.moves==="object"&&!Array.isArray(entry.moves))row.moves=normalizeFinalMoveSection({moves:entry.moves});
      if(entry.vitamins&&typeof entry.vitamins==="object"&&!Array.isArray(entry.vitamins)){
        const raw=entry.vitamins,seen=new Set();row.vitamins={enabled:raw.enabled===true,
          level:typeof raw.level==='number'&&Number.isFinite(raw.level)?Math.max(1,Math.min(999999,Math.trunc(raw.level))):30,
          targets:Array.from({length:6},(_,index)=>{const key=raw.targets?.[index];if(typeof key!=="string"||!/^[A-Za-z0-9][A-Za-z0-9_.:+-]{0,99}$/.test(key)||key!==finalEmptySlot&&seen.has(key))return null;seen.add(key);return key;}),
          ...(Array.isArray(raw.banishLevels)?{banishLevels:Array.from({length:6},(_,index)=>typeof raw.banishLevels[index]==='number'&&Number.isFinite(raw.banishLevels[index])?Math.max(0,Math.min(12,Math.trunc(raw.banishLevels[index]))):0)}:{})};
      }
      if(Object.keys(row).length)rows[stage]=row;
    }if(Object.keys(rows).length)result[map]=rows;
  }return result;
}

export function mergeFinalStageProfiles(current={},patch={}) {
  const result=normalizeFinalStageProfiles(current);if(!patch||typeof patch!=="object"||Array.isArray(patch))return result;
  for(const [map,stages]of Object.entries(patch).slice(0,32)){
    if(["__proto__","prototype","constructor"].includes(map)||map!=="default"&&!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(map))continue;
    if(stages===null){delete result[map];continue;}
    if(!stages||typeof stages!=="object"||Array.isArray(stages))continue;
    for(const stage of ["1","2","3"]){if(!Object.hasOwn(stages,stage))continue;const entry=stages[stage];
      if(entry===null){if(result[map])delete result[map][stage];continue;}
      if(!entry||typeof entry!=="object"||Array.isArray(entry))continue;
      const previous=result[map]?.[stage]||{},row={...previous};
      for(const kind of ['moves','vitamins'])if(Object.hasOwn(entry,kind)){
        if(entry[kind]===null)delete row[kind];else if(typeof entry[kind]==='object'&&!Array.isArray(entry[kind]))row[kind]={...(previous[kind]||{}),...entry[kind]};
      }
      (result[map]||={})[stage]=row;
    }
  }return normalizeFinalStageProfiles(result);
}

export function finalReplacementStageScope(run={}) {
  const biome=typeof run.biome==='string'?run.biome:run.biome?.id,
    mode=run.mode==='tower'||run.tower?'tower':run.mode==='endless'||run.endless?'endless':run.mode||'standard';let stage=null;
  if(mode==='endless'){
    const migrations=Number(run.migrations),count=reviewedEndlessAreaCount(run.biome);
    if(Number.isSafeInteger(migrations)&&migrations>=0&&count===3)stage=migrations%count+1;
  }else if(mode!=='tower'&&!run.tower&&Number.isInteger(run.stage)&&run.stage>=1&&run.stage<=3)stage=run.stage;
  return {biome:typeof biome==='string'?biome:null,stage,mode,
    key:JSON.stringify([mode,typeof biome==='string'?biome:null,stage,mode==='endless'?run.migrations:null])};
}

export function resolveFinalReplacementEntry(entry={},run={}) {
  const scope=finalReplacementStageScope(run),profiles=normalizeFinalStageProfiles(entry.stageProfiles),{stageProfiles,...base}=entry,
    defaults=scope.stage?profiles.default?.[String(scope.stage)]:null,
    specific=scope.stage&&scope.biome?profiles[scope.biome]?.[String(scope.stage)]:null,
    resolved={...base};
  for(const row of [defaults,specific])if(row)for(const kind of ['moves','vitamins'])if(row[kind])resolved[kind]={...(resolved[kind]||{}),...row[kind]};
  return {entry:resolved,scope:{...scope,source:specific?'map-stage':defaults?'default-stage':'base'}};
}

export function normalizeFinalReplacementEntries(value = {}) {
  const result={};
  if(!value||typeof value!=="object"||Array.isArray(value))return result;
  for(const [id,entry]of Object.entries(value).slice(0,999)){
    if(!/^[1-9]\d{0,5}$/.test(id)||!entry||typeof entry!=="object"||Array.isArray(entry))continue;
    const {fusion,...rest}=entry;result[id]={...rest,moves:normalizeFinalMoveSection(entry),
      ...(entry.stageProfiles?{stageProfiles:normalizeFinalStageProfiles(entry.stageProfiles)}:{})};
  }
  return result;
}

export function mergeFinalReplacementEntries(current = {}, patch = {}) {
  const merged=normalizeFinalReplacementEntries(current);
  if(!patch||typeof patch!=="object"||Array.isArray(patch))return merged;
  for(const [id,entry]of Object.entries(patch)){
    if(!/^[1-9]\d{0,5}$/.test(id)||!entry||typeof entry!=="object"||Array.isArray(entry))continue;
    const old=merged[id]||{},next={...old};
    for(const kind of ["moves","vitamins","strictMoves","strictVitamins"])
      if(entry[kind]&&typeof entry[kind]==="object"&&!Array.isArray(entry[kind]))next[kind]={...(old[kind]||{}),...entry[kind]};
    if(Object.hasOwn(entry,'stageProfiles'))next.stageProfiles=mergeFinalStageProfiles(old.stageProfiles,entry.stageProfiles);
    if(entry.fusion&&typeof entry.fusion==="object"&&entry.moves?.schemaVersion!==2){
      // An old sender's patch is merged against its saved split archive, then
      // migrated as a whole. It cannot silently reactivate a fifth live goal.
      const prior=old.moves?.migration;
      next.moves={...(prior?.moves||{}),...(entry.moves||{})};
      next.fusion={...(prior?.fusion||{}),...entry.fusion};
    }
    merged[id]={...next,moves:normalizeFinalMoveSection(next)};delete merged[id].fusion;
  }
  return merged;
}

export const planEditorSchema = {
  schemaVersion: 1,
  modes: [{value:'any',label:'全部模式'},{value:'standard',label:'闯关'},{value:'endless',label:'无尽生存'},{value:'tower',label:'紫苑塔活动'},{value:'mutation',label:'每日变异'}],
  replacementPolicies: [{value:'smart',label:'智能替换'},{value:'weakest',label:'替换较弱技能'},{value:'never',label:'优先保留已有技能'}],
  stats: ['damage','physical','special','attackSpeed','projectiles','area','duration','moveSpeed','projSpeed','maxHp','armor','regen','healing','critChance','critDamage','statusChance','statusDamage','lifesteal','shieldMax','shieldRegen','pickupRange','xpGain','goldGain','luck','evasion'],
  limits: {plans:200,rulesPerCategory:1000,priorityMin:-100,priorityMax:100,weightMin:0,weightMax:5},
  fallback: 'best-legal',
  fallbackExplanation:'推荐项不可选时选择可用项；全部不能选时使用游戏原生离开按钮。禁选和目标数量不会阻塞必选页面。',
};

export function normalizeCustomPlan(input = {}) {
  if(!input || typeof input!=='object' || Array.isArray(input)) throw Error('方案必须是 JSON 对象');
  const text=(v,max=120)=>String(v??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').slice(0,max).trim();
  const num=(v,lo,hi,fallback)=>v===null||v===''||v===undefined?fallback:Math.max(lo,Math.min(hi,Number.isFinite(Number(v))?Math.round(Number(v)):fallback));
  const nullable=(v,lo,hi)=>v===null||v===''||v===undefined?null:num(v,lo,hi,null);
  const key=v=>text(v,100);
  const list=(entries,category)=>{
    if(entries!=null&&!Array.isArray(entries))throw Error(category+'规则必须是数组');
    if((entries?.length||0)>1000)throw Error('单类规则最多 1000 条');
    const seen=new Set();
    return (entries||[]).map((entry,index)=>{
      const r=typeof entry==='string'?{key:entry}:entry;
      if(!r||typeof r!=='object')throw Error('无效规则');
      const id=key(r.key);
      if(!id||seen.has(id))return null;
      seen.add(id);
      const result={key:id,priority:num(r.priority,-100,100,index+1),avoid:r.avoid===true};
      if(category==='move')result.targetLevel=nullable(r.targetLevel,1,999);
      else result.targetCount=nullable(r.targetCount,1,9999);
      if(category==='item'){result.copy=r.copy!==false;result.shop=r.shop!==false;}
      return result;
    }).filter(Boolean).sort((a,b)=>a.priority-b.priority);
  };
  const moveRules=list(input.moveRules??input.moves,'move');
  const itemRules=list(input.itemRules??input.items,'item');
  const vitaminRules=list(input.vitaminRules??input.vitaminPriority,'vitamin');
  const interactionInput=input.interactions&&typeof input.interactions==='object'?input.interactions:{};
  const interactions=Object.fromEntries(['free','paid','copy','shop','roulette','tutor','shrine','healing'].map(k=>[k,interactionInput[k]!==false]));
  // Omission preserves the global default for old plans; explicit refusal is
  // retained through import/export and wins over a global risk permission.
  if(typeof interactionInput.risky==='boolean')interactions.risky=interactionInput.risky;
  interactions.goldReserve=num(interactionInput.goldReserve,0,1000000000,0);
  interactions.maxSpend=nullable(interactionInput.maxSpend,0,1000000000);
  interactions.totalBudget=nullable(interactionInput.totalBudget,0,1000000000);
  const statWeights=Object.create(null);
  for(const [stat,raw] of Object.entries(input.statWeights||{}))if(/^[a-zA-Z][a-zA-Z0-9_:-]{0,60}$/.test(stat)&&!['constructor','prototype'].includes(stat)&&raw!=null){const value=Number(raw);if(Number.isFinite(value))statWeights[stat]=Math.max(0,Math.min(5,value));}
  const id=text(input.id,100);
  if(id&&!/^custom-[a-zA-Z0-9_-]{1,90}$/.test(id))throw Error('自定义方案编号格式无效');
  const name=text(input.name);
  if(!name)throw Error('请填写方案名称');
  const plan={schemaVersion:1,id:id||'custom-'+(globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)),
    name,description:text(input.description,3000),enabled:input.enabled!==false,autoSelect:input.autoSelect!==false,priority:num(input.priority,-100,100,0),
    species:nullable(input.species,1,100000),biome:input.biome&&input.biome!=='any'&&input.biome!=='auto'?key(input.biome):null,
    tier:nullable(input.tier,0,2),mode:['standard','endless','tower','mutation'].includes(input.mode)?input.mode:'any',
    moveRules,itemRules,vitaminRules,interactions,
    reserveUntilLevel:num(input.reserveUntilLevel,1,999,20),
    replacementPolicy:['smart','weakest','never'].includes(input.replacementPolicy)?input.replacementPolicy:'smart',
    allowOffPlan:input.allowOffPlan!==false,statWeights,fallback:'best-legal',sourceType:'custom',
    moves:moveRules.filter(r=>!r.avoid).map(r=>r.key),items:itemRules.filter(r=>!r.avoid).map(r=>r.key),
    vitaminPriority:vitaminRules.filter(r=>!r.avoid).map(r=>r.key),copyPriority:itemRules.filter(r=>!r.avoid&&r.copy).map(r=>r.key),
    itemCounts:Object.fromEntries(itemRules.filter(r=>!r.avoid&&r.targetCount!=null).map(r=>[r.key,r.targetCount])),
    avoidMoves:moveRules.filter(r=>r.avoid).map(r=>r.key),avoidItems:itemRules.filter(r=>r.avoid).map(r=>r.key),avoidVitamins:vitaminRules.filter(r=>r.avoid).map(r=>r.key),
  };
  const captured=input.capturedBuild;
  if(captured && typeof captured==='object' && !Array.isArray(captured) && captured.version===1) {
    const safeKey=value=>typeof value==='string' && /^[a-zA-Z0-9:_-]{1,100}$/.test(value) ? value : null;
    const amount=(value,max)=>typeof value==='number'&&Number.isFinite(value)?Math.max(0,Math.min(max,Math.floor(value))):0;
    const rows=(value,count,fields)=>Array.isArray(value)?value.slice(0,count).filter(row=>row&&typeof row==='object'&&safeKey(row.key)).map(row=>fields(row)).filter(row=>row.key):[];
    plan.capturedBuild={version:1,currentSpecies:amount(captured.currentSpecies,100000),
      // This is an observation, not four deduplicated desired slots. Separate
      // same-key fusion instances, native levels and parent locks survive.
      moves:rows(captured.moves,16,row=>({key:row.key,id:amount(row.id,100000),level:amount(row.level,999),
        parents:Array.isArray(row.parents)?row.parents.filter(value=>Number.isInteger(value)&&value>=0&&value<=100000).slice(0,2):[]})),
      items:rows(captured.items,256,row=>({key:row.key,count:amount(row.count,9999)})),
      vitamins:rows(captured.vitamins,256,row=>({key:row.key,level:amount(row.level,999)}))};
  }
  return plan;
}

export function normalizeCustomPlans(value) {
  const plans=Array.isArray(value)?value:value?.plans;
  if(!Array.isArray(plans))throw Error('请导入包含 plans 数组的方案文件');
  if(plans.length>200)throw Error('最多保存 200 个自定义方案');
  const normalized=plans.map(normalizeCustomPlan),ids=new Set();
  for(const p of normalized){if(ids.has(p.id))throw Error('方案编号重复：'+p.id);ids.add(p.id);}
  return normalized;
}

export function resolveCustomPlan(plans, context, selected='auto') {
  if(selected&&selected!=='auto'&&!String(selected).startsWith('custom-'))return null;
  const matches=(plans||[]).filter(p=>p.enabled!==false&&(!p.species||Number(p.species)===Number(context.species))&&
    (!p.biome||p.biome===context.biome)&&(p.tier==null||Number(p.tier)===Number(context.tier))&&(!p.mode||p.mode==='any'||p.mode===context.mode));
  if(selected&&selected!=='auto')return matches.find(p=>p.id===selected)||null;
  const specificity=p=>Number(!!p.species)*8+Number(!!p.biome)*4+Number(p.tier!=null)*2+Number(p.mode&&p.mode!=='any');
  return matches.filter(plan=>plan.autoSelect!==false).sort((a,b)=>specificity(b)-specificity(a)||(b.priority||0)-(a.priority||0)||String(a.id).localeCompare(String(b.id)))[0]||null;
}

// Snapshot only public definitions. No account/profile/player state is accessed.
export function createPlanEditorCatalog(bridge, localization={}) {
  const warnings=[];
  const library=getGameLibrary(bridge);
  const safely=(read,fallback,label)=>{try{return read();}catch{warnings.push({code:'catalog-entry-unavailable',reason:label});return fallback;}};
  const values=value=>safely(()=>value&&typeof value.values==='function'?[...value.values()]:Array.isArray(value)?value:[],[],'部分目录无法读取');
  const label=(group,k,fallback)=>{const v=localization?.[group]?.[k];return typeof v==='string'?v:v?.name||fallback||String(k);};
  const moves=values(bridge?.data?.moves).filter(raw=>raw&&raw.id!=null).map(raw=>{
    const v=safely(()=>bridge.moveDef?.(raw.id),null,'招式 '+raw.id+' 的解析待适配')||raw;
    return {key:String(v.key||raw.key||raw.id),id:raw.id,name:label('moves',raw.id,v.name||v.key),type:v.type||raw.type,description:v.desc||raw.desc||'',mods:v.mods||[],max:v.max??null,arch:v.arch||null};
  });
  // The current native fusion namespace is separate from the base move Map.
  // Probe a bounded range through its real public definition resolver; never
  // manufacture a recipe, an unlock or a learnable level-up offer.
  let fusionFailures=0,fusionCount=0;
  if(typeof bridge?.moveDef==='function')for(let id=50000;id<=50255;id++){
    let def;try{def=bridge.moveDef(id);}catch{fusionFailures++;continue;}
    if(!def||def.id!==id||def.arch!=='fusion'||typeof def.key!=='string'||!def.key||typeof def.name!=='string')continue;
    if(moves.some(move=>move.id===id||move.key===def.key))continue;
    moves.push({key:def.key,id,name:def.name,type:def.type,description:typeof def.desc==='string'?def.desc:'',mods:[],max:null,arch:'fusion',
      source:{kind:'native-fusion-definition',sourceHash:bridge.compatibility?.sourceHash||null,gameVersion:bridge.compatibility?.gameVersion||null},
      availability:'native-ready-pair-only'});fusionCount++;
  }
  const version=String(bridge?.compatibility?.gameVersion||'').split('.').map(Number);
  if(fusionFailures||!fusionCount&&(version[0]>0||version[0]===0&&version[1]>=8))
    warnings.push({code:'fusion-catalog-incomplete',reason:'融合目录未完整确认；仅展示实际读取到的原生定义，不推造配方或可学习资格。'});
  const entries=(collection,group)=>values(collection).filter(v=>v&&(v.id!=null||v.key!=null)).map(v=>({key:String(v.id??v.key),id:v.id??v.key,
    name:label(group,v.id??v.key,v.name||v.id||v.key),description:[localization?.[group]?.[v.id??v.key]?.desc||v.desc||'',
      group==='vitamins'&&typeof v.note==='string'?v.note:''].filter(Boolean).join(' '),mods:v.mods||[],max:v.max??null,
    ...(group==='vitamins'?{stat:v.stat,per:v.per,kind:v.kind,dice:v.dice===true,
      ...(typeof v.note==='string'?{note:v.note}:{}),
      ...(Array.isArray(v.extra)?{extra:v.extra.filter(mod=>typeof mod?.stat==='string'&&Number.isFinite(mod.mul))
        .map(mod=>({stat:mod.stat,mul:mod.mul}))}: {})}: {})}));
  // This is a public possibility catalog, not an account's current unlocks.
  // Asking the native guide with an always-closed donor predicate retains the
  // complete shared-skill list and its donor gates without reading meta/profile.
  // Future forms are kept as separate routes: an evolution-only skill must not
  // be mistaken for an immediately learnable starting-species upgrade.
  const moveById=new Map(moves.map(move=>[Number(move.id),move])),moveByKey=new Map(moves.map(move=>[move.key,move]));
  const publicSpecies=id=>library.species(id);
  const publicGuide=(id,roster,types,reason)=>{
    const guide=library.learningGuide(id,roster,types,()=>false);
    if(!guide)warnings.push({code:'catalog-entry-unavailable',reason});
    return guide;
  };
  const copiedTypeScenarios=[...new Map(values(bridge?.data?.pokemon||bridge?.data?.byId).filter(mon=>Array.isArray(mon?.types)&&mon.types.length&&mon.types.every(type=>typeof type==='string'&&/^[a-z][a-z0-9-]{0,30}$/.test(type)))
    .map(mon=>{const types=[...new Set(mon.types)].sort();return [types.join('|'),types];})).values()];
  const characterMoves=roster=>{
    const rows=new Map(),queue=[Number(roster.id)],seen=new Set();
    const add=(ref,kind,speciesId,requiredCopiedTypes=null)=>{
      const move=moveByKey.get(String(ref?.key??''))||moveById.get(Number(ref?.id));
      if(!move||move.arch==='fusion'||Number(move.id)>=50000)return;
      const providedLevel=ref.level??ref.minLevel??ref.requiredLevel,rawLevel=providedLevel==null||providedLevel===''?NaN:Number(providedLevel),minLevel=Number.isFinite(rawLevel)?Math.max(1,Math.ceil(rawLevel)):null;
      const path={speciesId,kind,minLevel,requiresEvolution:speciesId!==Number(roster.id),
        ...(requiredCopiedTypes?{requiredCopiedTypes:[...requiredCopiedTypes]}:{}),
        ...(kind==='shared'?{requiresSharedUnlock:true,from:(Array.isArray(ref.from)?ref.from:[]).filter(id=>Number.isInteger(Number(id))).map(Number)}:{})};
      let row=rows.get(move.key);
      if(!row)rows.set(move.key,(row={key:move.key,id:move.id,name:move.name,description:move.description||'',minLevel:null,speciesIds:[],availability:'native-level-up-conditional',routes:[]}));
      if(!row.speciesIds.includes(speciesId))row.speciesIds.push(speciesId);
      if(minLevel!==null)row.minLevel=row.minLevel===null?minLevel:Math.min(row.minLevel,minLevel);
      if(!row.routes.some(prior=>JSON.stringify(prior)===JSON.stringify(path)))row.routes.push(path);
    };
    while(queue.length&&seen.size<512){
      const id=queue.shift();if(!Number.isInteger(id)||seen.has(id))continue;seen.add(id);
      const mon=publicSpecies(id),types=Array.isArray(mon?.types)?mon.types:Array.isArray(roster.types)?roster.types:[];
      const guide=typeof bridge?.moveGuide==='function'?publicGuide(id,roster,types,'精灵 '+id+' 的原生学习指南待适配'):null;
      if(guide&&typeof guide==='object'){
        for(const kind of ['kit','line','shared','any'])for(const ref of Array.isArray(guide[kind])?guide[kind]:[])add(ref,kind,id);
      }else if(id===Number(roster.id)){
        for(const[key,index]of(roster.kit||[]).map((key,index)=>[key,index]))add({key,level:roster.kitUnlockLevels?.[index]},'kit',id);
      }
      // Native imposter periodically copies the nearest enemy's full types.
      // Shared learning checks both donor intersection and move type, so keep
      // actual public dual-type combinations instead of singleton guesses.
      // Learning persists after another copy; no account or enemy is spawned.
      if(roster.passive==='imposter'&&typeof bridge?.moveGuide==='function')for(const copiedTypes of copiedTypeScenarios){
        if(copiedTypes.join('|')===[...types].sort().join('|'))continue;
        const copiedGuide=publicGuide(id,roster,copiedTypes,'精灵 '+id+' 的变身共享学习目录待适配');
        for(const ref of Array.isArray(copiedGuide?.shared)?copiedGuide.shared:[])add(ref,'shared',id,copiedTypes);
      }
      const evolutions=safely(()=>bridge?.data?.evolutionsOf?.(id)||[],[],'精灵 '+id+' 的进化学习目录待适配');
      for(const evolution of Array.isArray(evolutions)?evolutions:[])queue.push(Number(evolution?.id??evolution));
    }
    if(queue.length)warnings.push({code:'learnable-move-catalog-bounded',reason:'精灵 '+roster.id+' 的进化分支异常，学习目录已限制遍历并等待适配。'});
    return [...rows.values()].map(row=>{
      const conditions=row.routes.map(path=>{
        const form=path.requiresEvolution?'进化为 '+label('pokemon',path.speciesId,publicSpecies(path.speciesId)?.name||path.speciesId)+' 后':'当前形态';
        const level=path.minLevel===null?'等级门槛待原生指南确认':path.minLevel+' 级起';
        const copied=path.requiredCopiedTypes?'；特性变身复制 '+path.requiredCopiedTypes.map(type=>label('types',type,type)).join(' / ')+' 属性组合后':'';
        const donors=path.requiresSharedUnlock?'；需已解锁共享角色 '+(path.from.length?path.from.map(id=>label('pokemon',id,publicSpecies(id)?.name||id)).join(' / '):'（见原生指南）'):'';
        return form+'，'+level+copied+donors;
      });
      return {...row,description:[row.description,...new Set(conditions),'由原生升级随机出现；禁选、当前形态、等级及共享角色解锁仍以当前对局为准。'].filter(Boolean).join('；')};
    });
  };
  // Fusion is not a level-up offer. Ask the native resolver for every distinct
  // ordinary pair, preserving its signature/reaction/type/glitch precedence.
  // Two moves from mutually exclusive evolution branches cannot coexist merely
  // because each appears in the union of future learnable moves.
  const fusionKeys=new Set(values(bridge?.fusionRecipes).map(recipe=>recipe?.key).filter(key=>typeof key==='string'));
  if([...fusionKeys].some(key=>moveByKey.get(key)?.arch!=='fusion'))warnings.push({code:'fusion-recipe-unresolved',reason:'部分原生融合配方没有对应的已确认招式定义，已保留其他目录并等待适配，不推造结果。'});
  const nativeDefs=new Map(),pairRecipes=new Map(),descendants=new Map();let fusionLookupFailed=false;
  const defOf=move=>{if(!nativeDefs.has(move.id))nativeDefs.set(move.id,safely(()=>bridge?.moveDef?.(move.id),null,'招式 '+move.id+' 的融合资格待适配'));return nativeDefs.get(move.id);};
  const reachable=(from,to)=>{
    if(from===to)return true;
    if(!descendants.has(from)){
      const found=new Set(),queue=[from];
      while(queue.length&&found.size<512){const id=queue.shift();if(found.has(id))continue;found.add(id);
        const nextForms=safely(()=>bridge?.data?.evolutionsOf?.(id)||[],[],'精灵 '+id+' 的融合进化路径待适配');
        for(const next of Array.isArray(nextForms)?nextForms:[])queue.push(Number(next?.id??next));}
      descendants.set(from,found);
    }
    return descendants.get(from).has(to);
  };
  const characterFusions=learnable=>{
    if(fusionLookupFailed)return null;
    if(typeof bridge?.fusionFor!=='function'||!fusionKeys.size)return [];
    const ordinary=learnable.filter(move=>{const def=defOf(move);return def&&!['weather','buff','fusion'].includes(def.arch)&&Number(def.id)<50000;}),rows=new Map();
    for(let a=0;a<ordinary.length;a++)for(let b=a+1;b<ordinary.length;b++){
      const left=ordinary[a],right=ordinary[b];
      if(!left.routes.some(ar=>right.routes.some(br=>{
        if(!reachable(ar.speciesId,br.speciesId)&&!reachable(br.speciesId,ar.speciesId))return false;
        // Native Qv blocks a second shared random-archetype move. A nonshared
        // route can still learn second, provided evolution permits that order.
        if(defOf(left).arch==='random'&&defOf(right).arch==='random'){
          if(ar.kind==='shared'&&br.kind==='shared')return false;
          if(ar.kind==='shared'&&!reachable(ar.speciesId,br.speciesId))return false;
          if(br.kind==='shared'&&!reachable(br.speciesId,ar.speciesId))return false;
        }
        return true;
      })))continue;
      const pairKey=[Number(left.id),Number(right.id)].sort((x,y)=>x-y).join(':');
      if(!pairRecipes.has(pairKey))try{pairRecipes.set(pairKey,bridge.fusionFor(defOf(left),defOf(right)));}catch{
        fusionLookupFailed=true;warnings.push({code:'fusion-planning-unavailable',reason:'原生融合匹配接口发生变化，已暂停融合目录并保留其他目录；本次不再反复尝试配方。'});return null;
      }
      const recipe=pairRecipes.get(pairKey),fusion=moveByKey.get(recipe?.key);
      if(!recipe||!fusionKeys.has(recipe.key)||!fusion||fusion.arch!=='fusion')continue;
      let row=rows.get(recipe.key);
      if(!row)rows.set(recipe.key,(row={key:recipe.key,id:fusion.id,name:fusion.name,description:fusion.description||'',kind:recipe.kind,
        availability:'native-fusion-conditional',minParentLevel:8,learningRoutes:'learnableMoves',parents:[],routes:[]}));
      for(const parent of [left,right])if(!row.parents.some(v=>v.key===parent.key))row.parents.push({key:parent.key,name:parent.name});
      // Parent keys reference this character's learnableMoves[key].routes.
      // Public level/donor/form gates live once there; real-time eligibility is
      // still checked by the native resolver and current player learning pool.
      row.routes.push({aKey:left.key,bKey:right.key});
    }
    return [...rows.values()].map(row=>({...row,description:[row.description,
      '原料：'+row.parents.map(v=>v.name).join(' / '),
      '两种不同的普通招式各升至 8 级，再使用正辉的机器；不接受天气、强化或融合招式作为原料。',
      '需先满足原料的进化、玩家等级及共享角色解锁条件；随机学习不保证出现。每台机器成功融合一次，融合占一槽并腾出另一槽；持有融合时不能重学其原料。'].filter(Boolean).join('；')}));
  };
  const characters=(bridge?.roster||[]).map(v=>{const learnableMoves=characterMoves(v);return {...v,name:label('pokemon',v.id,v.name),kitNames:(v.kit||[]).map(k=>moves.find(m=>m.key===k)?.name||k),learnableMoves,
    ...(typeof bridge?.fusionFor==='function'&&fusionKeys.size?{learnableFusions:characterFusions(learnableMoves)}:{})};});
  if(fusionLookupFailed)for(const character of characters)delete character.learnableFusions;
  const maps=(bridge?.biomes||[]).map(v=>({...v,standardStages:reviewedStandardStageCount(v),endlessAreas:reviewedEndlessAreaCount(v),name:localization?.biomes?.[v.id]?.name||localization?.biomes?.[v.id]||v.name||v.id,live:typeof bridge.biomeLive==='function'?safely(()=>bridge.biomeLive(v.id),false,'地图 '+v.id+' 开放状态待适配'):v.live!==false}));
  const items=entries(bridge?.items,'items'),vitamins=entries(bridge?.vitamins,'vitamins');
  const stats=[...new Set([...planEditorSchema.stats,...items.flatMap(i=>(i.mods||[]).map(m=>m.stat)),...values(bridge?.vitamins).map(v=>v.stat)])].filter(v=>typeof v==='string'&&/^[a-zA-Z][a-zA-Z0-9_:-]{0,60}$/.test(v));
  return {moves,items,vitamins,characters,maps,planEditorSchema:{...planEditorSchema,stats},warnings};
}
