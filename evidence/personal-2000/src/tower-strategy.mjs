// Tower-only preferences over normal native decisions. No game mutation,
// RNG, native calls, timers, storage or relaxed affordability/legality.
export const towerStrategyFields = ['trickPolicy','rewardFocus','vitaminFocus','supportFocus','itemPriorities','vitaminPriorities','pactPolicy','pactPriorities','shopPolicy'];
const choices = {
  trickPolicy:['inherit','treat','trick'], rewardFocus:['inherit','damage','survival','growth','control'],
  vitaminFocus:['inherit','damage','survival','growth','dodge'], supportFocus:['inherit','damage','status','survival'],
  pactPolicy:['inherit','avoid','auto'], shopPolicy:['inherit','useful','preferred'],
};
const keyPattern=/^[A-Za-z][A-Za-z0-9_-]{0,99}$/;
function keys(raw,count,known){const used=new Set();return Array.from({length:count},(_,i)=>{
  const key=Array.isArray(raw)?raw[i]:null;
  if(typeof key!=='string'||!keyPattern.test(key)||used.has(key)||known?.size&&!known.has(key))return '';
  used.add(key);return key;
});}
function knownKeys(data,category){const defs=data?.[category]||data?.data?.[category];
  return defs?.keys ? new Set([...defs.keys()].filter(v=>typeof v==='string')) : null;
}
export function normalizeTowerStrategy(raw={},data={}) {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))raw={};const result={};
  for(const [field,allowed] of Object.entries(choices))result[field]=allowed.includes(raw[field])?raw[field]:'inherit';
  result.itemPriorities=keys(raw.itemPriorities,10,Array.isArray(raw.itemPriorities)&&raw.itemPriorities.some(Boolean)?knownKeys(data,'items'):null);
  result.vitaminPriorities=keys(raw.vitaminPriorities,5,Array.isArray(raw.vitaminPriorities)&&raw.vitaminPriorities.some(Boolean)?knownKeys(data,'vitamins'):null);
  result.pactPriorities=keys(raw.pactPriorities,10);
  return result;
}
const focusWeights={
  damage:{damage:3,physical:2.5,special:2.5,attackSpeed:2.7,projectiles:3,area:2},
  survival:{regen:3,healing:3,lifesteal:3,maxHp:2.5,armor:2.5,dodge:2.5,shieldMax:2},
  growth:{xp:3,xpGain:3,gold:2,luck:2,pickup:2},
  control:{statusChance:3,statusDamage:2,duration:2,area:2,flinch:2.5},
  status:{statusChance:3,statusDamage:3,duration:2},
  dodge:{dodge:4,moveSpeed:1.5,maxHp:1.8,regen:1.8},
};
const vitaminStats={
  damage:['attackSpeed','projectiles','physical','special','critChance','area','statusChance'],
  survival:['regen','maxHp','armor','evasion','lifesteal','shieldMax','overheal'],
  growth:['xpGain','gold','luck','powerup','pickupRange'],
  dodge:['evasion','maxHp','regen','moveSpeed'],
};
function focusedVitamins(focus,data){const order=vitaminStats[focus];if(!order)return [];
  const defs=data?.vitamins||data?.data?.vitamins;
  return defs?.entries?[...defs.entries()].filter(([,def])=>order.includes(def?.stat))
    .sort((a,b)=>order.indexOf(a[1].stat)-order.indexOf(b[1].stat)||String(a[0]).localeCompare(String(b[0])))
    .map(([key])=>key):[];
}
export function applyTowerStrategy(build={},raw={},nativeRun,data={},purpose='choice') {
  if(!nativeRun?.tower)return build;
  const strategy=normalizeTowerStrategy(raw,data), active=Object.keys(choices).some(field=>strategy[field]!=='inherit')||
    ['itemPriorities','vitaminPriorities','pactPriorities'].some(k=>strategy[k].some(Boolean));
  if(!active)return build;
  const focus=purpose==='support'&&strategy.supportFocus!=='inherit'?strategy.supportFocus:strategy.rewardFocus;
  const result={...build,towerStrategy:strategy,statWeights:{...(build.statWeights||{}),...(focusWeights[focus]||{})}};
  const itemKeys=purpose==='shop'&&strategy.shopPolicy==='useful'?[]:strategy.itemPriorities.filter(Boolean);
  if(itemKeys.length)result.items=[...itemKeys,...(build.items||[]).filter(v=>!itemKeys.includes(v?.key||v))];
  const vitaminKeys=[...strategy.vitaminPriorities.filter(Boolean),...focusedVitamins(strategy.vitaminFocus,data)];
  if(vitaminKeys.length)result.vitaminPriority=[...new Set([...vitaminKeys,...(build.vitaminPriority||[]),...(build.vitamins||[]).map(v=>v?.key||v?.k||v)])];
  return result;
}
// Apply only AFTER the caller establishes an offer's finite positive utility.
// A preference cannot make forbidden/full/unaffordable/negative offers legal.
export function towerOfferPriority(offer,run={},data={}) {
  if(!run.nativeRun?.tower||!run.build?.towerStrategy)return 0;
  const s=run.build.towerStrategy,kind=offer?.kind;
  if(run.purpose==='shop'&&s.shopPolicy==='useful')return 0;
  let list,key;
  if(kind==='item'){list=s.itemPriorities;key=offer.id||offer.key;}
  else if(kind==='newVit'||kind==='upVit'){list=s.vitaminPriorities;key=offer.vit;}
  else return 0;
  const rank=Array.isArray(list)?list.indexOf(key):-1;
  return rank>=0?100000-rank*1000:0;
}
export function towerTradePreference(raw,nativeRun,fallbackTrick=false) {
  if(!nativeRun?.tower)return fallbackTrick===true;
  const policy=normalizeTowerStrategy(raw).trickPolicy;
  return policy==='trick'?true:policy==='treat'?false:fallbackTrick===true;
}
export function towerCostSettings(base={},raw={},nativeRun) {
  if(!nativeRun?.tower)return base;
  const strategy=normalizeTowerStrategy(raw),priorities=strategy.pactPriorities;
  if(strategy.pactPolicy==='inherit'&&!priorities.some(Boolean))return base;
  return {...base,...(priorities.some(Boolean)?{costEffectPriorities:priorities}:{}),
    ...(strategy.pactPolicy==='avoid'?{forceCostInteractions:false,riskyInteractions:false,allowAutomatic:false}:{})};
}
