import { nativeCompatSelector } from './native-adaptation.mjs';
import { normalizeCustomPlan, planEditorSchema } from './custom-plans.mjs';

// A manual read of the one native, already open run-build dialog. No watcher,
// network request, player-history scan or persisted player/run identifier.
const importKey = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:+-]{0,99}$/.test(value) ? value : null;
const importText = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
const importNumber = (value, maximum) => Number.isInteger(Number(value)) && Number(value) > 0 && Number(value) <= maximum ? Number(value) : null;
const importValues = value => Array.isArray(value) ? value : typeof value?.values === 'function' ? [...value.values()] : [];
const importLabel = node => importText(node?.textContent);
const importFail = reason => ({ ok:false, reason });

function importDefinitions(bridge, catalog = {}) {
  const definitions = { moves:[], items:[], vitamins:[], characters:[], maps:[] };
  const source = {
    moves:importValues(bridge?.data?.moves), items:importValues(bridge?.items),
    vitamins:importValues(bridge?.vitamins), characters:importValues(bridge?.roster),
    maps:importValues(bridge?.biomes)
  };
  for (const group of Object.keys(definitions)) {
    const byKey = new Map();
    const add = raw => {
      if (!raw || typeof raw !== 'object') return;
      const key = importKey(String(raw.key ?? raw.id ?? ''));
      if (!key) return;
      const old = byKey.get(key), names = new Set(old?.names || []);
      for (const name of [raw.name, raw.label, raw.key]) if (typeof name === 'string' && name.trim()) names.add(importText(name));
      byKey.set(key, { ...old, ...raw, key, names:[...names] });
    };
    for (const raw of source[group]) add(raw);
    // The host supplies the current public, localized editor definitions only.
    // Those names are not read from, or tied to, any account/profile.
    for (const raw of importValues(catalog[group])) add(raw);
    definitions[group] = [...byKey.values()];
  }
  if (typeof bridge?.moveDef === 'function') {
    const known = new Set(definitions.moves.map(row => row.key));
    for (let id=50000; id<=50255; id++) {
      let raw; try { raw=bridge.moveDef(id); } catch { continue; }
      if (!raw || raw.id!==id || raw.arch!=='fusion' || !importKey(raw.key) || known.has(raw.key)) continue;
      definitions.moves.push({ ...raw, key:raw.key, names:[importText(raw.name),raw.key].filter(Boolean) });known.add(raw.key);
    }
  }
  return definitions;
}

function importLookup(entries) {
  const names=new Map(), keys=new Map();
  for (const entry of entries) {
    keys.set(entry.key,entry);
    for (const name of entry.names) {
      const rows=names.get(name)||[]; rows.push(entry); names.set(name,rows);
    }
  }
  return { keys, named(value) { const rows=names.get(importText(value))||[];return rows.length===1?rows[0]:null; } };
}

function importVisible(panel, document) {
  if (!panel || panel.isConnected===false || panel.hidden || panel.getAttribute?.('aria-hidden')==='true') return false;
  for (let node=panel; node && node!==document; node=node.parentElement) {
    if (node.hidden || node.getAttribute?.('aria-hidden')==='true') return false;
    const style=document.defaultView?.getComputedStyle?.(node);
    if (style && (style.display==='none' || style.visibility==='hidden')) return false;
  }
  return typeof panel.getClientRects!=='function' || panel.getClientRects().length>0;
}

function importObservedSpecies(bridge, definitions, head, document) {
  try {
    const publicMons=[...definitions.characters,...importValues(bridge?.data?.byId)],
      icon=head.querySelector(nativeCompatSelector('.bv-mon img')),src=icon?.getAttribute('src'),
      path=typeof src==='string'?new URL(src,document.baseURI||'https://pokebonk.com/').pathname:'',
      id=importNumber(path.match(/\/(?:icons|portraits)\/(\d+)\.png$/)?.[1],100000);
    if(id&&publicMons.some(row=>Number(row.id??row.key)===id))return id;
    // This is the native public species/level line, never the user-name title.
    const label=importLabel(head.querySelector(nativeCompatSelector('small'))).split(/[·•]/,1)[0].trim(),
      matches=publicMons.filter(row=>[row.name,...(row.names||[])].some(name=>typeof name==='string'&&importText(name)===label)),
      ids=[...new Set(matches.map(row=>Number(row.id??row.key)).filter(id=>importNumber(id,100000)))];
    return ids.length===1?ids[0]:0;
  } catch { return 0; }
}

function importPositiveScore(definition, weights) {
  let score=0;
  for (const mod of [...(definition.mods||[]),...(definition.extra||[])]) {
    const weight=weights[mod?.stat]??0.35;
    if (Number.isFinite(mod?.mul)) score+=(mod.mul-1)*100*weight;
    if (Number.isFinite(mod?.add)) score+=mod.add*weight;
  }
  if (typeof definition.stat==='string' && Number.isFinite(definition.per)) score+=definition.per*100*(weights[definition.stat]??0.35);
  return score;
}

export function visibleBuildImportPriorities(snapshot, definitions) {
  const moves=new Map(definitions.moves.map(row=>[row.key,row])),items=new Map(definitions.items.map(row=>[row.key,row])),
    vitamins=new Map(definitions.vitamins.map(row=>[row.key,row]));
  const active=snapshot.moves.map(row=>moves.get(row.key)).filter(Boolean),physical=active.some(row=>row.cls==='physical'),
    special=active.some(row=>row.cls==='special'),status=active.some(row=>row.status||row.arch==='aura'||row.arch==='dot');
  const weights=Object.fromEntries(planEditorSchema.stats.map(stat=>[stat,0.5]));
  Object.assign(weights,{damage:1.4,physical:physical?1.25:0.45,special:special?1.25:0.45,attackSpeed:1.15,
    projectiles:1.2,area:1.05,duration:0.85,moveSpeed:0.9,projSpeed:0.6,maxHp:0.55,armor:0.45,regen:0.45,
    healing:0.4,critChance:1.05,critDamage:1.05,statusChance:status?1.2:0.6,statusDamage:status?1.25:0.5,
    lifesteal:0.6,shieldMax:0.5,shieldRegen:0.45,pickupRange:0.65,xpGain:0.85,goldGain:0.55,luck:0.8,evasion:1});
  const order=(rows,score)=>rows.map((row,index)=>({row,index,score:score(row)}))
    .sort((a,b)=>b.score-a.score||a.index-b.index).map(({row},index)=>({...row,priority:index+1-Math.max(0,rows.length-100),avoid:false}));
  const suggestedItems=definitions.items.filter(def=>importPositiveScore(def,weights)>0)
    .sort((a,b)=>importPositiveScore(b,weights)-importPositiveScore(a,weights)||a.key.localeCompare(b.key)).slice(0,12)
    .map(def=>({key:def.key,count:1}));
  const suggestedVitamins=definitions.vitamins.filter(def=>!def.dice&&importPositiveScore(def,weights)>0)
    .sort((a,b)=>importPositiveScore(b,weights)-importPositiveScore(a,weights)||a.key.localeCompare(b.key)).slice(0,5)
    .map(def=>({key:def.key,level:importNumber(def.max,999)||8}));
  const unique=new Map();for (const row of snapshot.moves) {
    const old=unique.get(row.key);if(!old||old.targetLevel<row.level)unique.set(row.key,{key:row.key,targetLevel:row.level});
  }
  return {
    moveRules:order([...unique.values()],row=>{
      const def=moves.get(row.key)||{},damage=Number(def.dmg)||0,cooldown=Math.max(0.1,Number(def.cd)||1),count=Math.max(1,Number(def.count)||1);
      return Math.min(10000,damage*count/cooldown)*(def.cls==='physical'?weights.physical:weights.special)+
        (def.arch==='fusion'?300:0)+(def.status?60:0)+row.targetLevel;
    }),
    itemRules:order((snapshot.items.length?snapshot.items:suggestedItems).map(row=>({key:row.key,targetCount:row.count,copy:true,shop:true})),row=>{
      const def=items.get(row.key)||{};return importPositiveScore(def,weights)+Math.max(0,Number(def.rarity)||0)*3+Math.log2(row.targetCount+1);
    }),
    vitaminRules:order((snapshot.vitamins.length?snapshot.vitamins:suggestedVitamins).map(row=>({key:row.key,targetCount:row.level})),row=>{
      const def=vitamins.get(row.key)||{};return importPositiveScore(def,weights)+(weights[def.stat]??0.35)*10;
    }),statWeights:weights
  };
}

/** Only returns normalized, public gameplay choices. The actual DOM element is
 * a non-enumerable ownership token for the caller's in-memory save guard. */
export function captureVisibleBuildImport(bridge, document, options = {}) {
  try {
    const panels=[...(document?.querySelectorAll?.(nativeCompatSelector('.mp-panel.bv-panel[role="dialog"]'))||[])].filter(panel=>importVisible(panel,document));
    if (panels.length!==1) return importFail('请先在游戏内打开某一局的“配置”窗口；主页列表、普通暂停面板或多个配置窗口不能直接导入。');
    const panel=panels[0],body=panel.querySelector(nativeCompatSelector('.mp-body.bv-body')),head=panel.querySelector(nativeCompatSelector('.mp-head'));
    if (!body || !head || body.querySelectorAll(nativeCompatSelector('section.mp-sec')).length<2) return importFail('当前配置窗口尚未完整加载，请稍候重试。');
    const defs=importDefinitions(bridge,options.catalog),role=importNumber(options.species,100000),character=defs.characters.find(row=>Number(row.id??row.key)===role);
    if (!character) return importFail('请从当前角色目录选择要保存方案的角色。');
    const lookups=Object.fromEntries(['moves','items','vitamins'].map(group=>[group,importLookup(defs[group])])),
      legacy=!!body.querySelector(nativeCompatSelector('.mp-slots')),warnings=[],observedSpecies=importObservedSpecies(bridge,defs,head,document),
      snapshot={version:1,currentSpecies:observedSpecies,moves:[],items:[],vitamins:[]};
    if (legacy && options.allowLegacy!==true) return importFail('此旧记录未保存完整等级和维生素；如需导入，请明确开启“允许旧记录”，缺项会标为未知并使用通用建议。');
    const moveCards=[...body.querySelectorAll(nativeCompatSelector('.mp-move'))];
    if (!moveCards.length || moveCards.length>4) return importFail('当前招式数据为空或槽位数量异常，未导入不完整方案。');
    for (const card of moveCards) {
      const label=importLabel(card.querySelector(nativeCompatSelector('.mp-top > b'))),def=lookups.moves.named(label);
      if (!def) return importFail('有招式尚未在当前公开目录中确认，未丢弃该招式；请等待目录加载后重试。');
      const tag=[...card.querySelectorAll(nativeCompatSelector('.mp-tag'))].map(importLabel).find(value=>/^(?:Lv\.?|Nv\.?|等级|★)\s*\d+$/i.test(value)),
        parsed=tag&&importNumber(tag.match(/\d+/)?.[0],999),level=parsed||(legacy?(def.arch==='fusion'?5:8):null);
      if (!level) return importFail('某个招式的实际等级尚未确认，未把未知等级当作已读取数据。');
      snapshot.moves.push({key:def.key,id:Number.isInteger(Number(def.id))?Number(def.id):0,level,parents:[]});
    }
    for (const card of body.querySelectorAll(nativeCompatSelector('.bv-item'))) {
      const def=lookups.items.named(importLabel(card.querySelector(nativeCompatSelector(':scope > span'))));
      if (!def) return importFail('有道具未在当前公开目录中确认，未保存缺项方案。');
      const countText=importLabel(card.querySelector(nativeCompatSelector(':scope > b'))),
        amount=countText?importNumber(countText.match(/^[×x]\s*(\d+)$/i)?.[1],9999):1;
      if (!amount || snapshot.items.some(row=>row.key===def.key)) return importFail('道具数量或重复记录异常，请重新打开该局配置后重试。');
      snapshot.items.push({key:def.key,count:amount});
    }
    const sections=[...body.querySelectorAll(nativeCompatSelector('section.mp-sec'))];
    if (!legacy && sections.length<4) return importFail('完整记录的维生素或最终数据区域尚未加载，未保存缺项方案。');
    for (const card of body.querySelectorAll(nativeCompatSelector('.bv-vit'))) {
      const def=lookups.vitamins.named(importLabel(card.querySelector(nativeCompatSelector('div > b')))),
        text=importLabel(card.querySelector(nativeCompatSelector('small'))),level=importNumber(text.match(/(?:Lv\.?|Nv\.?|等级)\s*(\d+)/i)?.[1],999);
      if (!def || !level || snapshot.vitamins.some(row=>row.key===def.key)) return importFail('维生素名称或等级尚未确认，请等待配置加载完成后重试。');
      snapshot.vitamins.push({key:def.key,level});
    }
    if (snapshot.items.length>256 || snapshot.vitamins.length>5) return importFail('当前配装数量超出原生可确认范围，未导入。');
    if (legacy) warnings.push('旧记录缺少实际等级、数量和维生素；所列目标等级使用基础建议，不能冒称原记录已持有。');
    if(!observedSpecies)warnings.push('原记录最终形态尚未确认，未用所选保存角色冒充原记录形态。');
    else if(observedSpecies!==role)warnings.push('已按所选角色保存；原记录形态不同，招式学习与融合资格仍由本局原生规则决定。');
    if (!snapshot.items.length) warnings.push('页面未列出已持有道具，方案补入通用有益道具建议；实际记录仍保留为空。');
    if (!snapshot.vitamins.length) warnings.push('页面未列出维生素，方案补入通用维生素优先级；这些是建议，不是原记录观测。');
    const prioritized=visibleBuildImportPriorities(snapshot,defs),requestedName=importText(options.name),note=importText(options.description),
      name=requestedName||`${character.name||'角色'}·导入配装`,summary={moves:snapshot.moves.length,items:snapshot.items.length,
        itemCount:snapshot.items.reduce((sum,row)=>sum+row.count,0),vitamins:snapshot.vitamins.length,
        prioritySource:'generic-public-definition',levelsKnown:!legacy,scope:'any'};
    const description=[note,'玩家按键导入当前原生具体配置窗口；仅保存公开配装，不保存原玩家身份或对局链接。',
      '原生页面没有方案优先级：按已选招式的公开效果、伤害类型和道具增益补齐通用排序与全部属性权重；这是脚本建议，不是原玩家配置。',
      '保留原生等级和道具数量作为目标，受本局原生可学资格、持有上限及融合配方限制；未显示的同行、天赋或原料锁不编造。',...warnings].filter(Boolean).join('\n');
    const build=normalizeCustomPlan({name,description,species:role,enabled:true,autoSelect:options.autoSelect===true,
      mode:'any',biome:null,tier:null,...prioritized,interactions:{free:true,paid:true,copy:true,shop:true,roulette:true,tutor:true,shrine:true,healing:true,goldReserve:0},
      replacementPolicy:'smart',allowOffPlan:true,reserveUntilLevel:20,...(!legacy?{capturedBuild:snapshot}:{})});
    // Old records only establish their named moves/items. Do not invent a
    // capturedBuild with zero vitamins or inferred levels as native facts.
    if (legacy) summary.levelsKnown=false;
    const result={ok:true,build,summary,warnings,signature:JSON.stringify({snapshot,legacy})};
    Object.defineProperty(result,'panel',{value:panel,enumerable:false});return result;
  } catch { return importFail('当前配置或公开目录读取失败，未保存部分数据；重新打开配置后可重试。'); }
}
