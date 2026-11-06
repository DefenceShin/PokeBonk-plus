import { nativeCompatSelector } from './native-adaptation.mjs';
import { scoreOffer, configurePlan } from './policy.mjs';

// Opt-in, current-document conveniences. These settings contain no measured
// game state. Each runtime collector is gated before reading its dependencies.
export const CONVENIENCE_DEFAULTS = {
  fusion: {enabled:false,fontSize:11,rowsPerCard:3,cycleSeconds:5,offsetX:0,gap:8,showLevels:true,showLocks:true,onlyHeldPartners:false},
  quantity: {enabled:false,fontSize:13,showLimit:true,showVitamins:false,compactNumbers:false},
  alerts: {enabled:false,tone:'chime',volume:50,cooldownSeconds:15,lowHealthPercent:25,
    events:{boss:true,rare:true,downed:true,revive:true,teammateDown:false,stage:false,ultimate:false,lowHealth:false,matchEnd:true,saveFailure:true,fusionReady:false}},
  coop: {enabled:false,waitPortal:false,doNotChest:false,doNotFreeChest:false,doNotAltar:false,doNotChallenge:false,doNotCursed:false,doNotCursedChest:false,doNotGreed:false,doNotMeowth:false,doNotDitto:false,doNotHypno:false,doNotSnorlax:false,doNotMagnet:false,doNotBerry:false,doNotBoss:false,doNotShrine:false,doNotPortal:false,doNotCage:false,doNotRock:false,doNotShroom:false,doNotSlots:false,doNotBill:false,doNotFossil:false,doNotNest:false,doNotPorygon:false,doNotRhydon:false,doNotTower:false},
  recommendations: {enabled:false,source:'recommended',fontSize:13,showReasons:true,showMoves:true,showVitamins:true,showItems:true,showOther:true,opacity:90,color:'#23795c'}
};
const convenienceObject = value => value && typeof value === 'object' && !Array.isArray(value);
const convenienceNumber = (v,lo,hi,fallback) => typeof v === 'number' && Number.isFinite(v) ? Math.max(lo,Math.min(hi,Math.round(v))) : fallback;
export function normalizeConvenienceSettings(raw = {}) {
  const result = {};
  const copy = value => JSON.parse(JSON.stringify(value));
  for (const [group,defaults] of Object.entries(CONVENIENCE_DEFAULTS)) {
    const input=convenienceObject(raw?.[group]) ? raw[group] : {};
    const target=result[group]=copy(defaults);
    for(const [key,fallback] of Object.entries(defaults))
      if(typeof fallback==='boolean' && typeof input[key]==='boolean')target[key]=input[key];
  }
  const ranges={fusion:{fontSize:[10,20],rowsPerCard:[1,12],cycleSeconds:[3,20],offsetX:[-240,240],gap:[0,48]},quantity:{fontSize:[10,24]},
    alerts:{volume:[0,100],cooldownSeconds:[3,120],lowHealthPercent:[5,75]},recommendations:{fontSize:[10,24],opacity:[20,100]}};
  for(const [group,fields]of Object.entries(ranges))for(const[key,[lo,hi]]of Object.entries(fields))
    result[group][key]=convenienceNumber(raw?.[group]?.[key],lo,hi,CONVENIENCE_DEFAULTS[group][key]);
  if(['chime','bell','soft','pulse'].includes(raw?.alerts?.tone))result.alerts.tone=raw.alerts.tone;
  for(const key of Object.keys(result.alerts.events))if(typeof raw?.alerts?.events?.[key]==='boolean')result.alerts.events[key]=raw.alerts.events[key];
  if(['recommended','currentPlan'].includes(raw?.recommendations?.source))result.recommendations.source=raw.recommendations.source;
  if(/^#[a-f0-9]{6}$/i.test(raw?.recommendations?.color||''))result.recommendations.color=raw.recommendations.color.toLowerCase();
  return result;
}

const convenienceOverlaps=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
export function placeConvenienceBadge(bounds,width,height,obstacles=[]) {
  const xs=[bounds.right-width-5,bounds.left+5],ys=[bounds.top+5];
  for(const box of obstacles){xs.push(box.left-width-5,box.right+5);ys.push(box.bottom+5);}
  for(const top of ys)for(const left of xs){const box={left,top,right:left+width,bottom:top+height};
    if(left>=bounds.left&&top>=bounds.top&&box.right<=bounds.right&&box.bottom<=bounds.bottom&&
      !obstacles.some(other=>convenienceOverlaps(box,other)))return box;}
  return null;
}
export function layoutConvenienceNotes(cards,actions,viewport,input={},startIndex=0) {
  const settings=normalizeConvenienceSettings({fusion:input}).fusion,w=viewport.width,h=viewport.height,
    valid=cards.filter(box=>box.width>0&&box.height>0&&box.right>0&&box.left<w&&box.bottom>0&&box.top<h);
  if(!valid.length)return cards.map(()=>null);
  // Move the complete row together. Per-card clamping would stack adjacent
  // reminders on each other near a screen edge.
  const minLeft=Math.min(...valid.map(box=>box.left)),maxRight=Math.max(...valid.map(box=>box.right)),
    shift=Math.max(-minLeft+2,Math.min(w-maxRight-2,settings.offsetX)),
    lineHeight=Math.ceil(settings.fontSize*1.3),minHeight=lineHeight+4,gap=settings.gap,
    desiredHeight=lineHeight*(settings.rowsPerCard+1)+4,placed=[],slots=cards.map(()=>null);
  const findBand=(boxes,start,end=h-2)=>{
    const ranges=boxes.filter(box=>box.width>0&&box.height>0).map(box=>[Math.max(0,box.top-gap),Math.min(end,box.bottom+gap)]).sort((a,b)=>a[0]-b[0]);
    let cursor=Math.max(2,Math.min(end,start));
    for(const[begin,finish]of ranges){if(finish<=cursor)continue;if(Math.min(end,begin)-cursor>=minHeight)return [cursor,Math.min(end,begin)];cursor=Math.max(cursor,finish);if(cursor>=end)return null;}
    return end-cursor>=minHeight?[cursor,end]:null;
  };
  const common=findBand([...cards,...actions],Math.max(...valid.map(box=>box.bottom))+gap);
  const first=((Math.trunc(startIndex)||0)%cards.length+cards.length)%cards.length;
  for(let step=0;step<cards.length;step++){
    const index=(first+step)%cards.length,card=cards[index];if(!valid.includes(card))continue;
    const left=Math.max(2,card.left+shift),right=Math.min(w-2,card.right+shift);if(right-left<40)continue;
    const blockers=[...cards,...actions,...placed].filter(box=>box.left<right&&box.right>left);
    // A common lower band keeps a single row aligned. Allocated notes are
    // obstacles too, so multi-row cards cannot reuse the same rectangle.
    const band=(common?findBand(blockers,common[0],common[1]):null)||findBand(blockers,card.bottom+gap)||findBand(blockers,2,card.top-gap);
    if(!band)continue;
    const height=Math.min(band[1]-band[0],desiredHeight),slot={left,top:band[0],width:right-left,height};
    slots[index]=slot;placed.push({...slot,right,bottom:slot.top+height});
  }
  return slots;
}

// Captured only on an explicit button press. No last-run monitor/history is
// installed. The host revalidates the private run/identity scope after awaits.
export function captureCurrentBuild(context = {}) {
  const run=context.run;
  if(!run || !['play','paused','modal','over'].includes(run.state) || run.transitioning || !run.player)
    return {ok:false,reason:'仅能收藏当前仍在游戏中可确认的最近一局；请在战斗、选择页、暂停页或结算页使用。'};
  const player=run.player,species=Number(run.startSpecies),biome=run.biome?.id;
  if(!Number.isInteger(species)||species<1||species>100000||typeof biome!=='string'||!biome||biome.length>100)
    return {ok:false,reason:'当前角色或地图尚未就绪，请待原生界面加载完成后再收藏。'};
  const key = v => typeof v==='string' && /^[a-zA-Z0-9:_-]{1,100}$/.test(v) ? v : null;
  const count = (v,max=9999) => typeof v==='number'&&Number.isFinite(v) ? Math.max(0,Math.min(max,Math.floor(v))) : 0;
  const moves=(Array.isArray(player.moves)?player.moves:[]).slice(0,16).map(move=>({key:key(move?.def?.key),id:count(move?.def?.id,100000),level:count(move?.level,999),
    parents:(Array.isArray(move?.parents)?move.parents:[]).filter(value=>Number.isInteger(value)&&value>=0&&value<=100000).slice(0,2)})).filter(v=>v.key&&v.level);
  const entries = (map,kind) => typeof map?.entries==='function' ? [...map.entries()].slice(0,256).map(([id,value])=>({key:key(String(id)),
    [kind]:count(typeof value==='number'?value:value?.level)})).filter(row=>row.key&&row[kind]) : [];
  const items=entries(player.items,'count'),vitamins=entries(player.vitamins,'level');
  if(!moves.length)return {ok:false,reason:'当前招式尚未加载，未保存空方案。'};
  const unique=new Map();for(const move of moves)unique.set(move.key,Math.max(unique.get(move.key)||0,move.level));
  return {ok:true,build:{name:'最近对局收藏',description:'由玩家点击收藏保存的实际配装；仅手动选择，不自动覆盖现用方案。',enabled:true,autoSelect:false,
    species,biome,tier:count(run.tier,2),mode:run.tower?'tower':run.endless?'endless':'standard',
    moveRules:[...unique].map(([key,targetLevel],index)=>({key,targetLevel,priority:index+1})),
    itemRules:items.map((row,index)=>({key:row.key,targetCount:row.count,priority:index+1})),
    vitaminRules:vitamins.map((row,index)=>({key:row.key,targetCount:row.level,priority:index+1})),
    replacementPolicy:'smart',allowOffPlan:true,capturedBuild:{version:1,currentSpecies:count(player.speciesId,100000),moves,items,vitamins}}};
}

function convenienceMove(offer,run,bridge) {
  if(offer?.kind==='upMove')return run.player?.moves?.[offer.slot]?.def;
  if(offer?.kind==='newMove') {
    try{return bridge.moveDef?.(offer.id)||bridge.data?.moves?.get?.(offer.id);}catch{return null;}
  }
  return null;
}
// Only pairs containing the offered move are enumerated. A page has a small
// number of offers; no all-pairs graph is built or polled during combat.
export function collectFusionReminders(offers,run,bridge={},input={}) {
  if(input.enabled!==true)return [];
  if(!Array.isArray(offers)||!offers.some(offer=>['newMove','upMove'].includes(offer?.kind)))return [];
  if(!run?.player||typeof bridge.fusionFor!=='function')return [];
  const settings=normalizeConvenienceSettings({fusion:input}).fusion;
  const held=(run.player.moves||[]).filter(Boolean),locked=new Set(held.flatMap(move=>Array.isArray(move.parents)?move.parents:[]));
  const byId=new Map();
  for(const raw of bridge.data?.moves?.values?.()||[]) {
    let def;try{def=bridge.moveDef?.(raw.id)||raw;}catch{continue;}
    if(def?.id!=null&&!['fusion','buff','weather'].includes(def.arch))byId.set(def.id,def);
  }
  for(const move of held)if(move.def&&!['fusion','buff','weather'].includes(move.def.arch))byId.set(move.def.id,move.def);
  const name=def=>String(def?.name||def?.key||def?.id||'未知招式').slice(0,100);
  return offers.map(offer=>{
    const def=convenienceMove(offer,run,bridge);if(!def)return [];
    if(def.arch==='fusion')return [{key:'already-fused',text:'融合成品不能再次作为融合原料。'}];
    if(['buff','weather'].includes(def.arch))return [];
    const current=held.find(move=>move.def?.id===def.id), groups=new Map();
    for(const partner of byId.values()) {
      if(!partner||partner.id===def.id)continue;
      const owned=held.find(move=>move.def?.id===partner.id);
      if(settings.onlyHeldPartners&&!owned)continue;
      let recipe;try{recipe=bridge.fusionFor(def,partner);}catch{continue;}
      if(!recipe?.key)continue;
      const needs=[];
      for(const [parent,equipped]of [[def,current],[partner,owned]]) {
        if(!equipped)needs.push(`学会${name(parent)}并升至Lv8`);
        else if(Number(equipped.level)<8)needs.push(settings.showLevels?`${name(parent)} Lv${Number(equipped.level)||1}→8`:`提升${name(parent)}至Lv8`);
        if(settings.showLocks&&locked.has(parent.id))needs.push(`${name(parent)}被已持有成品原料锁定`);
      }
      const cost=Number(!current)*20+Number(!owned)*20+Math.max(0,8-(current?.level||0))+Math.max(0,8-(owned?.level||0))+
        Number(locked.has(def.id)||locked.has(partner.id))*100;
      const row={key:recipe.key,name:String(recipe.name||recipe.key).slice(0,100),partner:name(partner),needs,cost,alternatives:1};
      const prior=groups.get(recipe.key);
      if(!prior)groups.set(recipe.key,row);
      else if(cost<prior.cost){row.alternatives=prior.alternatives+1;groups.set(recipe.key,row);}
      else prior.alternatives++;
    }
    return [...groups.values()].sort((a,b)=>a.cost-b.cost||a.key.localeCompare(b.key)).map(row=>({key:row.key,
      text:`${row.name}：${row.needs.length?row.needs.join('；'):'原料已就绪，需可用的原生融合机器'}${row.alternatives>1?`（另有${row.alternatives-1}条伙伴路线）`:''}`}));
  });
}
export function collectQuantityLabels(offers,run,bridge={},input={}) {
  if(input.enabled!==true)return [];
  return (Array.isArray(offers)?offers:[]).map(offer=>{
    if(offer?.kind==='item'||offer?.item) {
      const id=offer.id??offer.item,def=bridge.items?.get?.(id),max=Number(def?.max??10);
      if(max<=1)return null;
      const count=Number(run?.player?.items?.get?.(id)||0);
      const text=input.compactNumbers&&count>=1000?`${+(count/1000).toFixed(1)}K`:String(count);
      return `已有 ${text}${input.showLimit!==false&&Number.isFinite(max)?` / ${max}`:''}`;
    }
    if(input.showVitamins&&['newVit','upVit','forgetVit'].includes(offer?.kind)) {
      const held=run?.player?.vitamins?.get?.(offer.vit),level=typeof held==='number'?held:held?.level||0;
      return `已有 Lv${level}`;
    }
    return null;
  });
}
function convenienceCategory(offer){return ['newMove','upMove','forgetMove','fusion'].includes(offer?.kind)?'Moves':
  ['newVit','upVit','forgetVit'].includes(offer?.kind)?'Vitamins':offer?.kind==='item'?'Items':'Other';}
export function rateConvenienceChoices(offers,run,bridge={},build={},input={}) {
  if(input.enabled!==true)return [];
  return (Array.isArray(offers)?offers:[]).map(offer=>{
    const category=convenienceCategory(offer);
    if(input['show'+category]===false)return null;
    if(offer?.off||offer?.sold||offer?.ready===false)return {score:'0.0',reason:'原生当前不可选'};
    const forgetting=['forgetMove','forgetVit'].includes(offer?.kind),move=offer?.kind==='forgetMove'?run?.player?.moves?.[offer.slot]:null,
      key=move?.def?.key??offer?.vit;
    const desiredMove=move&&!build.avoidMoves?.includes(key)&&
      ((build.moves||[]).some(value=>(value?.key??value)===key)||(build.moveRules||[]).some(rule=>rule.key===key&&!rule.avoid));
    const desiredVitamin=offer?.kind==='forgetVit'&&!build.avoidVitamins?.includes(key)&&
      ((build.vitaminRules||[]).some(rule=>rule.key===key&&!rule.avoid)||(build.vitamins||[]).some(value=>(value?.key??value?.k??value)===key));
    if(desiredMove||desiredVitamin)return {score:'0.0',reason:'属于参考方案需要保留的配装；达到升级目标不代表应该遗忘'};
    // Unknown native transaction shapes receive an explicitly neutral score;
    // their label/rarity never becomes fabricated damage or success odds.
    const normalized=offer?.kind==='forgetMove'?{kind:'newMove',id:move?.def?.id}:
      offer?.kind==='forgetVit'?{kind:'newVit',vit:offer.vit}:offer;
    const quantitative=(!offer?.recovered||offer?.kind==='item')&&
      (['newMove','upMove','newVit','upVit','item'].includes(normalized?.kind)||Array.isArray(normalized?.mods));
    let raw=0;
    if(quantitative)try{
      let player=run?.player;
      if(forgetting){
        player=Object.create(player||null);
        if(move)Object.defineProperty(player,'moves',{value:run.player.moves.filter((_,slot)=>slot!==offer.slot)});
        else{const vitamins=new Map(run.player.vitamins);vitamins.delete(offer.vit);Object.defineProperty(player,'vitamins',{value:vitamins});}
      }
      raw=scoreOffer(normalized,{player,build,purpose:offer.purpose||'free'},bridge);
    }catch{return null;}
    let value=raw===-Infinity?0:!Number.isFinite(raw)?5:Math.max(0,Math.min(10,5+5*raw/(Math.abs(raw)+50)));
    if(['forgetMove','forgetVit'].includes(offer?.kind))value=10-value;
    return {score:value.toFixed(1),reason:!quantitative?'原生合法选项；当前没有可量化的配装差异':
      raw===-Infinity?'当前容量、禁选或方案规则不推荐':`按${build.name||'当前角色推荐'}及实际边际收益评分${['forgetMove','forgetVit'].includes(offer?.kind)?'；高分表示更适合遗忘':''}`};
  });
}

const convenienceMethods = {
  showLevelUp:'upgrade',showItemChoice:'itemChoice',showItem:'item',showBlessing:'blessing',showBranch:'branch',
  showParty:'party',showDitto:'ditto',showShinySwap:'shinySwap',showPact:'pact',showShop:'shop',showForget:'forget',
  showSlots:'slots',showFusion:'fusion',showTrade:'trade'
};
const convenienceHookKey=Symbol.for('pokebonk.convenience.ui-hooks');
function subscribeConvenienceUI(win,ui,listener,names=[...Object.keys(convenienceMethods),'modal','hideModal','saveFailed','reviveFlash','toast'],memberKey) {
  const registry=win[convenienceHookKey]||(win[convenienceHookKey]=new WeakMap());
  let entry=registry.get(ui);
  if(!entry){entry={listeners:new Map(),methods:new Map()};registry.set(ui,entry);}
  entry.listeners.set(listener,new Set(names));
  for(const name of names) {
    const key=typeof memberKey==='function'?memberKey(ui,name):name;
    if(entry.methods.has(name)||typeof ui[key]!=='function')continue;
    const descriptor=Object.getOwnPropertyDescriptor(ui,key),original=ui[key],wrapped=function(...args){
      for(const[callback,methods]of entry.listeners)if(methods.has(name))try{callback('before',name,args,this);}catch{}
      // Native errors and return values propagate unchanged.
      const result=original.apply(this,args);
      for(const[callback,methods]of entry.listeners)if(methods.has(name))try{callback('after',name,args,this);}catch{}
      return result;
    };
    if(original.__pbWrapped)wrapped.__pbWrapped=true;
    entry.methods.set(name,{key,descriptor,original,wrapped});ui[key]=wrapped;
  }
  return ()=>{
    entry.listeners.delete(listener);
    if(entry.listeners.size)return;
    for(const[name,pair]of entry.methods)if(ui[pair.key]===pair.wrapped){
      if(pair.descriptor)Object.defineProperty(ui,pair.key,pair.descriptor);else delete ui[pair.key];
      entry.methods.delete(name);
    }
    // If a controller wrapped our dispatcher, retain one inert dispatcher
    // with zero listeners. Re-enabling reuses it rather than growing chains.
    if(!entry.methods.size)registry.delete(ui);
  };
}

export function installPlayerConvenience(getContext,input={},options={}) {
  const win=options.window||globalThis.window||globalThis,doc=options.document||win.document;
  win.__PB_CONVENIENCE?.dispose?.();
  const interval=options.setInterval||win.setInterval?.bind(win)||globalThis.setInterval;
  const cancel=options.clearInterval||win.clearInterval?.bind(win)||globalThis.clearInterval;
  const now=options.now||(()=>win.performance?.now?.()??Date.now());
  let settings=normalizeConvenienceSettings(input),timer=null,disposed=false,currentRun=null,scope=null,
    page=null,ui=null,unsubscribe=null,root=null,models=[],previousAlert=null,cooldowns=new Map(),capture=null,
    sequence=0,runSequence=0,documentId=win.crypto?.randomUUID?.()||Math.random().toString(36).slice(2),
    fusionCache=null,buildCache=null,rebuild=null,showDepth=0,listening=false,idleSaveUi=null,idleSaveUnsubscribe=null,completionScope=null,
    recoveryRoot=null,measureContext=null;
  const ended=new WeakSet();
  const ratingsActive=()=>settings.recommendations.enabled&&['showMoves','showVitamins','showItems','showOther'].some(key=>settings.recommendations[key]);
  const visualActive=()=>settings.fusion.enabled||settings.quantity.enabled||ratingsActive();
  const alertsActive=()=>settings.alerts.enabled&&settings.alerts.volume>0&&Object.values(settings.alerts.events).some(Boolean);
  const active=()=>visualActive()||alertsActive();
  function post(value){try{if(options.notify)options.notify(value);else win.chrome?.webview?.postMessage?.(value);}catch{}}
  function clearView(){root?.remove();root=null;models=[];}
  function clearPage(){page=null;fusionCache=null;measureContext=null;clearView();}
  function reset(notify=true){clearPage();capture=null;currentRun=scope=previousAlert=buildCache=null;cooldowns.clear();rebuild=null;showDepth=0;
    unsubscribe?.();unsubscribe=null;ui=null;recoveryRoot=null;if(notify)post({kind:'convenienceReset'});}
  function stop(){if(timer!==null){cancel(timer);timer=null;}}
  function clearIdleSave(){idleSaveUnsubscribe?.();idleSaveUnsubscribe=null;idleSaveUi=null;completionScope=null;}
  const identity=context=>({app:context.bridge?.app,meta:context.bridge?.app?.meta,account:context.bridge?.app?.meta?.account});
  const sameIdentity=(context,prior)=>{const next=identity(context);return prior&&next.app===prior.app&&next.meta===prior.meta&&next.account===prior.account;};
  function emit(type){if(!alertsActive()||!settings.alerts.events[type])return;
    const at=now(),last=cooldowns.get(type);if(last!=null&&at-last<settings.alerts.cooldownSeconds*1000)return;
    cooldowns.set(type,at);post({kind:'convenienceAlert',eventId:`${documentId}:${runSequence}:${++sequence}`,type});}
  function establish(context){
    const run=context.run;
    clearIdleSave();
    if(run!==currentRun||!sameIdentity(context,scope)){reset(!!currentRun);currentRun=run;scope=identity(context);runSequence++;}
    if(ui!==run.ui){unsubscribe?.();ui=run.ui;unsubscribe=ui?subscribeConvenienceUI(win,ui,onUI,undefined,context.bridge?.nativeMemberKey):null;}
  }
  function offersFor(kind,value,run){
    if(kind==='recovered')return Array.isArray(value)?value:[];
    if(kind==='upgrade'||kind==='blessing')return Array.isArray(value)?value:[];
    if(kind==='itemChoice')return (Array.isArray(value)?value:[]).map(id=>({kind:'item',id}));
    if(kind==='item')return [{kind:'item',id:value}];
    if(kind==='shop')return (run.shop?.stock||[]).map(item=>({kind:'item',id:item.key,sold:item.sold,purpose:'shop'}));
    if(kind==='ditto')return [...(run.player.items?.keys?.()||[])].map(id=>({kind:'item',id,purpose:'copy'}));
    if(kind==='forget')return [...(run.player.moves||[]).flatMap((move,slot)=>move?[{kind:'forgetMove',slot,off:run.player.moves.filter(Boolean).length<=1}]:[]),
      ...[...(run.player.vitamins?.keys?.()||[])].map(vit=>({kind:'forgetVit',vit}))];
    if(kind==='trade')return (value?.offers||[]).map(offer=>({...offer,kind:offer.item?'item':'trade',id:offer.item}));
    if(kind==='fusion')return (Array.isArray(value)?value:[]).map(offer=>({...offer,kind:'fusion'}));
    if(kind==='branch')return (Array.isArray(value)?value:[]).map(id=>({kind:'branch',id}));
    if(kind==='party')return [...(run.allies?.list||[]).filter(ally=>ally&&!ally.shiny),...(value?[value]:[])].map(ally=>({...ally,kind:'party'}));
    if(kind==='shinySwap')return [{kind:'party'},{kind:'party'}];
    if(kind==='pact')return (Array.isArray(value)?value:[]).map(offer=>({...offer,kind:'pact'}));
    return [];
  }
  function setPage(kind,value,run,modal){
    clearPage();if(!visualActive()||!run||run!==currentRun||!modal?.isConnected)return;
    page={kind,value,run,stage:run.stage,terrain:run.terrain,root:modal,heading:modal.querySelector?.(nativeCompatSelector('h1'))?.textContent||'',born:now()};
    draw(getContext());
  }
  function onUI(phase,method,args,owner){
    if(disposed||!active())return;
    if(phase==='before') {
      if(convenienceMethods[method])showDepth++;
      if(method==='modal')rebuild=page&&['shop','forget'].includes(page.kind)?{...page}:null;
      return;
    }
    if(method==='saveFailed'){
      if(alertsActive()&&settings.alerts.events.saveFailure){const context=getContext()||{};
        if(args[0]===context.run&&sameIdentity(context,scope))emit('saveFailure');}
      return;
    }
    if(method==='reviveFlash'||method==='toast'){
      if(alertsActive()&&settings.alerts.events.revive&&(method==='reviveFlash'||args[1]==='rainbow-wing')){
        const context=getContext()||{};
        if(context.run===currentRun&&sameIdentity(context,scope)&&owner===currentRun?.ui&&
          (method==='reviveFlash'||currentRun.player?.rainbowUsed===true))emit('revive');
      }
      return;
    }
    if(method==='hideModal'){clearPage();return;}
    const kind=convenienceMethods[method];
    if(kind){showDepth=Math.max(0,showDepth-1);const context=getContext();
      if(args[0]!==context.run)return;establish(context);
      setPage(kind,kind==='blessing'?args[2]:args[1],args[0],owner.modalEl);rebuild=null;return;}
    if(method==='modal'){
      const prior=rebuild;rebuild=null;
      if(!showDepth&&prior&&prior.run===currentRun&&prior.stage===currentRun?.stage&&prior.terrain===currentRun?.terrain&&
        (prior.kind==='shop'?!!owner.modalEl?.querySelector?.(nativeCompatSelector('.shop-sell')):
          owner.modalEl?.querySelector?.(nativeCompatSelector('h1'))?.textContent===prior.heading))setPage(prior.kind,null,currentRun,owner.modalEl);
    }
  }
  function currentBuild(context){
    const run=context.run,requested=settings.recommendations.source;
    if(requested==='currentPlan'&&context.pilot?.run===run&&context.pilot.plan?.build)return context.pilot.plan.build;
    const builds=context.pilot?.builds||options.builds||[],key=`${run.startSpecies}:${run.biome?.id}:${run.tier}:${!!run.endless}:${!!run.tower}`;
    if(buildCache?.key===key&&buildCache.source===builds)return buildCache.build;
    const mode=run.endless?'endless':run.tower?'tower':'standard',base={species:run.startSpecies,biome:run.biome?.id,tier:run.tier||0,mode};
    let build={};
    try{build=configurePlan(base,{mode:'auto',biome:'auto',tier:'auto',build:'auto'},
      {league:[run.startSpecies],biomes:{[base.biome]:Math.max(0,base.tier)}},[{id:base.biome,live:true}],builds).build||{};}catch{}
    buildCache={key,source:builds,build};return build;
  }
  function recoverExistingPage(context){
    const run=context.run,modal=run.ui?.modalEl;
    if(page||!visualActive()||!modal?.isConnected||recoveryRoot===modal)return;
    recoveryRoot=modal;
    const observed=context.pilot?.modal;
    if(observed?.run===run&&observed.stage===run.stage&&observed.terrain===run.terrain&&observed.root===modal&&
      Object.values(convenienceMethods).includes(observed.kind)){
      setPage(observed.kind,observed.offers,run,modal);return;
    }
    if(modal.querySelector?.(nativeCompatSelector('.shop-sell'))){setPage('shop',null,run,modal);return;}
    if(modal.querySelector?.(nativeCompatSelector('.item-row'))&&modal.querySelector?.(nativeCompatSelector('.shop-exit'))){setPage('forget',null,run,modal);return;}
    let cards=[...(modal.querySelectorAll?.(nativeCompatSelector('.cards > .card'))||[])],selector='.cards > .card';
    if(!cards.length){cards=[...(modal.querySelectorAll?.(nativeCompatSelector('.card'))||[])];selector='.card';}
    if(!cards.length||cards.length>128)return;
    // Off means no historical observer. When enabled in an already-open page,
    // recover only identities explicitly and uniquely present in native text.
    // Upgrade modifiers/callbacks cannot be recovered from DOM and are never
    // manufactured: unresolved choices have an explicitly neutral rating.
    const itemNames=new Map(),moveNames=new Map();
    const add=(map,name,id)=>{if(typeof name!=='string'||!name.trim())return;name=name.trim();map.set(name,map.has(name)?null:id);};
    if(settings.quantity.enabled||ratingsActive()&&settings.recommendations.showItems)
      for(const[id,definition]of context.bridge?.items?.entries?.()||[])add(itemNames,definition?.name,id);
    if(settings.fusion.enabled)for(const raw of context.bridge?.data?.moves?.values?.()||[]){
      let definition;try{definition=context.bridge.moveDef?.(raw.id)||raw;}catch{continue;}add(moveNames,definition?.name,definition?.id);}
    const offers=cards.map(card=>{
      const title=card.querySelector?.(nativeCompatSelector('h3'))?.textContent?.trim()||'',item=itemNames.get(title),move=moveNames.get(title);
      return {...(item!=null?{kind:'item',id:item}:move!=null?{kind:'newMove',id:move}:{kind:'unknown'}),recovered:true,
        off:card.disabled===true||card.getAttribute?.('aria-disabled')==='true'||card.classList?.contains('locked')===true};
    });
    setPage('recovered',offers,run,modal);if(page)page.selector=selector;
  }
  function pageRows(){
    const selector=page.selector||(page.kind==='forget'?'.item-row':page.kind==='item'?'.card':'.cards > .card');
    return [...(page.root.querySelectorAll?.(nativeCompatSelector(selector))||[])].slice(0,128);
  }
  function style(node,values){for(const[key,value]of Object.entries(values))if(node.style[key]!==value)node.style[key]=value;}
  function element(tag){const node=doc.createElement(tag);node.style.pointerEvents='none';return node;}
  function draw(context){
    if(!page||!visualActive()||doc?.hidden||context.run!==page.run||page.stage!==context.run?.stage||page.terrain!==context.run?.terrain||
      !sameIdentity(context,scope)||!page.root.isConnected||page.run.ui?.modalEl!==page.root){clearPage();return;}
    const offers=offersFor(page.kind,page.value,page.run),cards=pageRows();
    if(!offers.length||offers.length!==cards.length){clearView();return;}
    let fusions=[],quantities=[],ratings=[];
    if(settings.fusion.enabled){
      const signature=(page.run.player.moves||[]).filter(Boolean).map(move=>`${move.def?.id}:${move.level}:${move.parents?.join(',')}`).join('|');
      if(!fusionCache||fusionCache.page!==page||fusionCache.signature!==signature||fusionCache.bridge!==context.bridge||
        fusionCache.moves!==context.bridge?.data?.moves||fusionCache.resolver!==context.bridge?.fusionFor)
        fusionCache={page,signature,bridge:context.bridge,moves:context.bridge?.data?.moves,resolver:context.bridge?.fusionFor,
          rows:collectFusionReminders(offers,page.run,context.bridge,settings.fusion)};
      fusions=fusionCache.rows;
    }
    if(settings.quantity.enabled)quantities=collectQuantityLabels(offers,page.run,context.bridge,settings.quantity);
    if(ratingsActive()&&offers.some(offer=>settings.recommendations['show'+convenienceCategory(offer)])){
      const needsBuild=offers.some(offer=>(!offer.recovered||offer.kind==='item')&&settings.recommendations['show'+convenienceCategory(offer)]);
      ratings=rateConvenienceChoices(offers,page.run,context.bridge,needsBuild?currentBuild(context):{},settings.recommendations);
    }
    if(!fusions.some(rows=>rows.length)&&!quantities.some(Boolean)&&!ratings.some(Boolean)){clearView();return;}
    if(!root&&doc?.body){root=element('aside');root.id='pb-convenience-choices';root.setAttribute('aria-hidden','true');
      style(root,{position:'fixed',inset:'0',zIndex:'2147483100',pointerEvents:'none',overflow:'hidden',fontFamily:'sans-serif',contain:'layout style paint'});doc.body.append(root);}
    if(!root)return;
    while(models.length>cards.length)models.pop().node.remove();
    const viewportW=Number(win.innerWidth)||1920,viewportH=Number(win.innerHeight)||1080;
    const boxes=cards.map(card=>card.getBoundingClientRect()),actionBoxes=[];
    // Only the active native modal is inspected, and only while annotations are
    // enabled. Native cards, footer actions and form controls are all reserved.
    if(settings.fusion.enabled||ratings.some(row=>row&&settings.recommendations.showReasons))
      for(const selector of ['button','input','select','textarea','.shop-exit','h1','h2','h3','p','.sub','label'])
        for(const node of page.root.querySelectorAll?.(nativeCompatSelector(selector))||[]){const box=node.getBoundingClientRect();if(box.width>0&&box.height>0)actionBoxes.push(box);}
    const drawAt=now(),noteSlots=layoutConvenienceNotes(boxes,actionBoxes,{width:viewportW,height:viewportH},settings.fusion,
      Math.floor((drawAt-page.born)/(settings.fusion.cycleSeconds*1000)));
    for(let index=0;index<cards.length;index++){
      let model=models[index];if(!model){const node=element('div'),rating=element('span'),quantity=element('span'),fusion=element('div');
        node.append(rating,quantity,fusion);root.append(node);model={node,rating,quantity,fusion};models.push(model);}
      const box=boxes[index],clipKey=`${viewportW}:${viewportH}`;
      if(model.clipKey!==clipKey||model.card!==cards[index]){
        model.card=cards[index];
        model.clipKey=clipKey;model.clips=[];
        for(let ancestor=cards[index].parentElement;ancestor&&ancestor!==doc.body;ancestor=ancestor.parentElement){
          const computed=win.getComputedStyle?.(ancestor),fallback=ancestor.classList?.contains('scroll');
          const x=computed?/(auto|scroll|hidden|clip)/.test(computed.overflowX):!!fallback,
            y=computed?/(auto|scroll|hidden|clip)/.test(computed.overflowY):!!fallback;
          if(x||y)model.clips.push({node:ancestor,x,y});
        }
      }
      let left=Math.max(0,box.left),top=Math.max(0,box.top),right=Math.min(viewportW,box.right),bottom=Math.min(viewportH,box.bottom);
      for(const clip of model.clips||[]){const bounds=clip.node.getBoundingClientRect();
        if(clip.x){left=Math.max(left,bounds.left);right=Math.min(right,bounds.right);}
        if(clip.y){top=Math.max(top,bounds.top);bottom=Math.min(bottom,bounds.bottom);}}
      const visible=box.width>0&&box.height>0&&right>left&&bottom>top;
      style(model.node,{display:visible?'block':'none',position:'absolute',inset:'0',overflow:'visible'});
      const rating=ratings[index],quantity=quantities[index],rows=fusions[index]||[];
      const visibleWidth=Math.max(1,right-left),visibleHeight=Math.max(1,bottom-top),measure=(value,font)=>{
        if(measureContext===null)measureContext=doc.createElement('canvas').getContext?.('2d')||false;
        if(measureContext){measureContext.font=`${font}px sans-serif`;return measureContext.measureText(value).width;}
        return Array.from(value).length*font;
      };
      let quantityFont=settings.quantity.fontSize,quantityWidth=0,quantityLines=0;
      if(quantity){quantityWidth=measure(quantity,quantityFont);const allowed=Math.max(1,visibleWidth-22);
        if(quantityWidth>allowed)quantityFont=Math.max(8,Math.floor(quantityFont*allowed/quantityWidth));
        quantityWidth=measure(quantity,quantityFont);quantityLines=Math.max(1,Math.ceil(quantityWidth/allowed));}
      const quantityHeight=quantity?Math.ceil(quantityFont*1.3)*quantityLines+6:0,
        showQuantity=!!quantity&&visibleHeight>=quantityHeight+10&&visibleWidth>=30,
        ratingSize=Math.min(settings.recommendations.fontSize*2.7,Math.max(20,visibleWidth-10)),
        showRating=!!rating&&visibleWidth>=ratingSize+10&&visibleHeight>=ratingSize+10+(showQuantity?quantityHeight+10:0);
      const reserved=[];
      for(const selector of ['.bd','.rar','.kind','.key','img'])
        for(const node of cards[index].querySelectorAll?.(nativeCompatSelector(selector))||[]){const rect=node.getBoundingClientRect();if(rect.width>0&&rect.height>0)reserved.push(rect);}
      const badgeBounds={left,top,right,bottom};
      const ratingBox=showRating?placeConvenienceBadge(badgeBounds,ratingSize,ratingSize,reserved):null;
      if(ratingBox)reserved.push(ratingBox);
      const quantityBox=showQuantity?placeConvenienceBadge(badgeBounds,Math.max(1,Math.min(visibleWidth-10,Math.ceil(quantityWidth)+12)),quantityHeight,reserved):null;
      style(model.rating,{display:ratingBox?'flex':'none',position:'absolute',left:`${ratingBox?.left||0}px`,top:`${ratingBox?.top||0}px`,width:`${ratingSize}px`,height:`${ratingSize}px`,borderRadius:'50%',alignItems:'center',justifyContent:'center',fontWeight:'700',color:'#fff',background:settings.recommendations.color,fontSize:`${Math.min(settings.recommendations.fontSize,ratingSize/2)}px`,opacity:String(settings.recommendations.opacity/100),boxShadow:'0 1px 5px #0008'});
      if(rating&&model.rating.textContent!==rating.score)model.rating.textContent=rating.score;
      const reason=rating&&settings.recommendations.showReasons?rating.reason:'';
      const slot=noteSlots[index],font=settings.fusion.fontSize,lineHeight=Math.ceil(font*1.3),
        maxHeight=slot?.height||0,totalLines=Math.max(0,Math.floor((maxHeight-4)/lineHeight)),
        inline=totalLines===1,capacity=inline?1:Math.max(0,totalLines-1),
        // A one-line free band still exposes every route via inline paging.
        contentWidth=Math.max(1,(slot?.width||0)-8-(inline?measure('99999/99999 ',font):0));
      const wrap=value=>{const lines=[];let line='',used=0;
        if(measureContext===null){measureContext=doc.createElement('canvas').getContext?.('2d')||false;}
        if(measureContext)measureContext.font=`${font}px sans-serif`;
        for(const ch of String(value)){
          const units=measureContext?measureContext.measureText(ch).width:font;
          if(ch==='\n'||used+units>contentWidth&&line){lines.push(line);line='';used=0;if(ch==='\n')continue;}
          line+=ch;used+=units;}if(line)lines.push(line);return lines;};
      // Split oversized routes themselves, rather than clipping the back half
      // of every page forever. Every native output/missing-ingredient line is
      // reachable even in a legal small viewport.
      let groups=model.pagination?.rows===rows&&model.pagination.reason===reason&&model.pagination.font===font&&
        model.pagination.width===contentWidth&&model.pagination.capacity===capacity&&model.pagination.inline===inline&&model.pagination.limit===settings.fusion.rowsPerCard?model.pagination.groups:null;
      if(!groups){groups=[];let lines=[],routeCount=0;
        for(const value of capacity?[...(reason?[reason]:[]),...rows.map(row=>row.text)]:[]){
          if(lines.length&&routeCount>=settings.fusion.rowsPerCard){groups.push(lines);lines=[];routeCount=0;}
          for(const line of wrap(value)){if(lines.length>=capacity){groups.push(lines);lines=[];routeCount=0;}lines.push(line);}routeCount++;
        }
        if(lines.length)groups.push(lines);
        model.pagination={rows,reason,font,width:contentWidth,capacity,inline,limit:settings.fusion.rowsPerCard,groups};
        // Geometry changes affect wrapping, not how much of this card has
        // actually been shown. Hidden turns must not advance its page cursor.
        if(model.contentRows!==rows||model.contentReason!==reason){model.presentedMs=0;model.contentRows=rows;model.contentReason=reason;}
      }
      if(slot){if(model.presentedAt!=null)model.presentedMs=(model.presentedMs||0)+Math.max(0,Math.min(1000,drawAt-model.presentedAt));model.presentedAt=drawAt;}else model.presentedAt=null;
      const pageCount=groups.length,currentPage=pageCount?Math.floor((model.presentedMs||0)/(settings.fusion.cycleSeconds*1000))%pageCount:0;
      const text=pageCount?(inline?`${currentPage+1}/${pageCount} ${groups[currentPage][0]}`:
        [...groups[currentPage],...(pageCount>1?[`${currentPage+1}/${pageCount} · 自动翻页`]:[])].join('\n')):'';
      style(model.fusion,{display:text?'block':'none',position:'absolute',left:`${slot?.left||0}px`,top:`${slot?.top||0}px`,width:`${slot?.width||0}px`,height:text?`${Math.min(maxHeight,(groups[currentPage]?.length+(!inline&&pageCount>1?1:0))*lineHeight+4)}px`:'0',overflow:'hidden',whiteSpace:'pre',fontSize:`${font}px`,lineHeight:`${lineHeight}px`,padding:'2px 4px',boxSizing:'border-box',borderRadius:'4px',color:'#fff',background:'rgba(10,30,24,.91)'});
      if(model.fusion.textContent!==text)model.fusion.textContent=text;
      style(model.quantity,{display:quantityBox?'block':'none',position:'absolute',left:`${quantityBox?.left||0}px`,top:`${quantityBox?.top||0}px`,width:`${Math.max(1,Math.min(visibleWidth-10,Math.ceil(quantityWidth)+12))}px`,height:`${quantityHeight}px`,boxSizing:'border-box',fontSize:`${quantityFont}px`,lineHeight:`${Math.ceil(quantityFont*1.3)}px`,whiteSpace:'normal',overflowWrap:'anywhere',padding:'3px 6px',borderRadius:'5px',color:'#fff',background:'rgba(10,30,24,.9)'});
      if(quantity&&model.quantity.textContent!==quantity)model.quantity.textContent=quantity;
    }
  }
  function sampleAlerts(context){
    if(!alertsActive())return;
    const r=context.run,e=settings.alerts.events,point={};
    if(e.boss)point.boss=!!r.boss?.alive;
    if(e.rare){const cap=r.capture;point.rare=!!cap&&(cap.shiny||cap.classic)&&!['idle','done'].includes(cap.state);}
    if(e.downed||e.revive)point.downed=!!r.player?.dead;
    if(e.stage)point.stage=r.stage;
    if(e.ultimate)point.ultimate=Number(r.ult?.charge)>=1;
    if(e.lowHealth)point.lowHealth=Number(r.player?.hp)>0&&Number(r.player?.hp)/Math.max(1,Number(r.player?.stats?.maxHp)||1)*100<=settings.alerts.lowHealthPercent;
    if(e.teammateDown)point.teammateDown=r.coop?[...(r.coop.active?.()||[])].filter(peer=>(peer.last?.flags&1)&&!(peer.last?.flags&2)).length:0;
    if(e.fusionReady){const moves=(r.player?.moves||[]).filter(move=>move&&!['fusion','buff','weather'].includes(move.def?.arch)&&Number(move.level)>=8);
      const locked=new Set((r.player?.moves||[]).flatMap(move=>move?.parents||[]));point.fusionReady=moves.some((move,i)=>moves.slice(i+1).some(other=>
        !locked.has(move.def.id)&&!locked.has(other.def.id)&&!!context.bridge?.fusionFor?.(move.def,other.def)));}
    if(previousAlert){
      for(const type of ['boss','rare','downed','ultimate','lowHealth','fusionReady'])if(point[type]&&!previousAlert[type])emit(type);
      if(e.stage&&point.stage!==previousAlert.stage)emit('stage');
      if(e.teammateDown&&point.teammateDown>previousAlert.teammateDown)emit('teammateDown');
      if(e.revive&&previousAlert.downed&&!point.downed)emit('revive');
    }
    previousAlert=point;
  }
  function weak(value){return value&&(typeof value==='object'||typeof value==='function')?new WeakRef(value):null;}
  function terminalSaveHook(context){
    if(!settings.alerts.enabled||settings.alerts.volume<=0||!settings.alerts.events.saveFailure){clearIdleSave();return;}
    const nextUi=context.bridge?.app?.ui||context.run?.ui;
    if(idleSaveUi===nextUi&&(!context.run||completionScope?.run?.deref()===context.run))return;
    clearIdleSave();if(!nextUi)return;idleSaveUi=nextUi;
    idleSaveUnsubscribe=subscribeConvenienceUI(win,nextUi,(phase,method,args,owner)=>{
      if(phase!=='after'||method!=='saveFailed'||disposed||!alertsActive())return;
      const fresh=getContext()||{},run=fresh.run,app=fresh.bridge?.app;
      if(args[0]!==run||owner!==run?.ui||app&&app.run!==run||run.meta&&app?.meta&&run.meta!==app.meta)return;
      if(completionScope&&Object.entries(completionScope).some(([key,ref])=>ref&&ref.deref()!==({run,app,meta:app?.meta,account:app?.meta?.account})[key]))return;
      emit('saveFailure');
    },['saveFailed'],context.bridge?.nativeMemberKey);
    if(context.run){const origin=identity(context);completionScope={run:weak(context.run),app:weak(origin.app),meta:weak(origin.meta),account:weak(origin.account)};}
  }
  function tick(){
    if(disposed||!active())return;
    try{const context=getContext()||{},run=context.run;
      if(!run||run.state==='over'){
        const completed=!!currentRun&&currentRun===run&&sameIdentity(context,scope)&&run?.state==='over'&&!ended.has(run);
        const pending=completed?{run:weak(run),app:weak(scope?.app),meta:weak(scope?.meta),account:weak(scope?.account)}:
          completionScope?.run?.deref()===run?completionScope:null;
        if(run)ended.add(run);reset(!!currentRun);terminalSaveHook(context);if(pending)completionScope=pending;if(completed)emit('matchEnd');return;
      }
      if(ended.has(run))return;
      establish(context);sampleAlerts(context);
      if(!doc?.hidden&&visualActive()){recoverExistingPage(context);draw(context);}else clearView();
    }catch{reset(!!currentRun);}
  }
  function schedule(){if(!disposed&&active()&&timer===null)timer=interval(tick,500);}
  function unload(){instance.dispose();}
  function listen(value){if(value===listening)return;listening=value;
    for(const name of ['pagehide','unload'])(value?win.addEventListener?.bind(win):win.removeEventListener?.bind(win))?.(name,unload);}
  const instance={
    get settings(){return normalizeConvenienceSettings(settings);},tick,
    configure(next={}){
      if(disposed)return;
      const merged={};for(const key of Object.keys(CONVENIENCE_DEFAULTS))merged[key]={...settings[key],...(convenienceObject(next[key])?next[key]:{})};
      merged.alerts.events={...settings.alerts.events,...(next.alerts?.events||{})};
      const wasActive=active(),priorPage=page,priorScope=scope;settings=normalizeConvenienceSettings(merged);stop();reset(wasActive);listen(active());
      clearIdleSave();
      if(active()){
        tick();
        if(priorPage&&visualActive()){const context=getContext()||{};
          if(context.run===priorPage.run&&sameIdentity(context,priorScope)&&context.run.stage===priorPage.stage&&context.run.terrain===priorPage.terrain&&
            priorPage.root?.isConnected&&context.run.ui?.modalEl===priorPage.root){page=priorPage;draw(context);}}
        schedule();
      }
    },
    captureCurrentBuild(){
      capture=null;if(disposed)return {ok:false,reason:'当前页面已经关闭。'};
      const context=getContext()||{},result=captureCurrentBuild(context);if(!result.ok)return result;
      const ticket=`capture-${++sequence}`;capture={ticket,run:context.run,scope:identity(context),stage:context.run.stage,terrain:context.run.terrain};
      return {...result,ticket};
    },
    isCaptureCurrent(ticket){if(disposed||capture?.ticket!==ticket)return false;
      const context=getContext()||{};return context.run===capture.run&&sameIdentity(context,capture.scope)&&context.run.stage===capture.stage&&context.run.terrain===capture.terrain&&
        ['play','paused','modal','over'].includes(context.run.state)&&!context.run.transitioning;},
    clearCapture(ticket){if(capture?.ticket===ticket)capture=null;},
    dispose(){if(disposed)return;disposed=true;stop();reset(active());clearIdleSave();listen(false);if(win.__PB_CONVENIENCE===instance)delete win.__PB_CONVENIENCE;}
  };
  win.__PB_CONVENIENCE=instance;listen(active());if(active()){tick();schedule();}
  return instance;
}
