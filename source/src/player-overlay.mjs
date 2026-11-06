import { collectTeamOverlayRows, createTeamOverlaySession, normalizeTeamOverlaySettings,
  overlayNumberText, teamOverlayActive, teamOverlayNeedsSession } from './team-overlay.mjs';
// Read-only presentation. Optional party sharing has its own explicit opt-in;
// it uses this display's timer and never drives native input or persistence.
export const OVERLAY_FIELD_DEFAULTS = Object.freeze(Object.fromEntries([
  "totalDamage", "moveDamage", "otherDamage", "revives", "averageDps", "damageShare",
  "elapsed", "kills", "damageTaken", "health", "shield", "experience", "gold", "ultimate",
  "armor", "critChance", "critDamage", "physical", "special", "damageMultiplier",
  "attackSpeed", "moveSpeed", "luck", "xpGain", "healingMultiplier", "regen", "itemTriggers", "rebirth",
].map(key => [key, ["totalDamage", "moveDamage", "otherDamage", "revives"].includes(key)])));
const DEFAULTS = { enabled:true, fields:OVERLAY_FIELD_DEFAULTS, compactNumbers:true, fontSize:12,
  fontColor:"#ffffff", backgroundColor:"#10251e", opacity:45, width:220, height:260,
  x:1.5, y:46, rowGap:4, refreshMs:500, hidePaused:true, autoPage:true, pageSeconds:6, page:1 };
const RANGES = {fontSize:[10,26],opacity:[0,95],width:[160,560],height:[120,800],
  x:[0,100],y:[0,100],rowGap:[0,12],refreshMs:[250,2000],pageSeconds:[3,20],page:[1,9999]};
const object = value => value && typeof value === "object" && !Array.isArray(value);
const finite = value => typeof value === "number" && Number.isFinite(value) ? value : null;
const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
const hasFields = fields => Object.keys(fields).some(key=>key!=="damageShare"&&fields[key]);
export function normalizeOverlaySettings(input = {}) {
  const raw = object(input) ? input : {}, settings = {...DEFAULTS,fields:{...OVERLAY_FIELD_DEFAULTS}};
  for (const key of ["enabled","compactNumbers","hidePaused","autoPage"])
    if (typeof raw[key] === "boolean") settings[key] = raw[key];
  for (const [key,[min,max]] of Object.entries(RANGES)) {
    const value = raw[key];
    if (["number","string"].includes(typeof value) && String(value).trim()!=="" && Number.isFinite(Number(value)))
      settings[key] = clamp(Number(value),min,max);
    if (!["x","y"].includes(key)) settings[key]=Math.round(settings[key]/(key==="refreshMs"?250:1))*(key==="refreshMs"?250:1);
  }
  for (const key of ["fontColor","backgroundColor"])
    if (typeof raw[key] === "string" && /^#[0-9a-f]{6}$/i.test(raw[key])) settings[key] = raw[key].toLowerCase();
  if (object(raw.fields)) for (const key of Object.keys(OVERLAY_FIELD_DEFAULTS))
    if (typeof raw.fields[key] === "boolean") settings.fields[key] = raw.fields[key];
  settings.team=normalizeTeamOverlaySettings(raw.team);
  return settings;
}
function reader() {
  const properties = new WeakMap(), entries = new WeakMap();
  const read = (owner,key) => {
    if (!owner || typeof owner !== "object" && typeof owner !== "function") return undefined;
    let cache = properties.get(owner); if (!cache) properties.set(owner,cache=new Map());
    if (!cache.has(key)) cache.set(key,owner[key]);
    return cache.get(key);
  };
  const mapRead = (owner,key) => {
    const get=read(owner,"get"), has=read(owner,"has");
    if (typeof get !== "function" || typeof has !== "function") return undefined;
    let cache = entries.get(owner); if (!cache) entries.set(owner,cache=new Map());
    if (!cache.has(key)) cache.set(key,has.call(owner,key) ? get.call(owner,key) : 0);
    return cache.get(key);
  };
  return {read,mapRead};
}
const textName = (value,fallback) => typeof value === "string" && value.trim() ? value : fallback;
function clock(value) {
  if (finite(value) === null || value<0) return "—";
  const seconds=Math.floor(value), minutes=Math.floor(seconds/60);
  return `${Math.floor(minutes/60)}:${String(minutes%60).padStart(2,"0")}:${String(seconds%60).padStart(2,"0")}`;
}
// Returned rows contain strings/numbers only, never native objects. A context
// overload is useful to callers already holding the provider's {run,bridge}.
export function collectOverlayRows(run, settings = {}, bridge = {}) {
  if (settings?.enabled === false) return [];
  const normalized=normalizeOverlaySettings(settings);
  if(!normalized.enabled || !hasFields(normalized.fields)&&!teamOverlayActive(normalized.team))return [];
  const context=run && typeof run==="object" && "run" in run && !("state" in run) ? run : {run,bridge};
  return collectRows(context,normalized,{normalized:true});
}
function collectRows(context, input = {}, internal = {}) {
  if (input?.enabled === false) return [];
  const settings = internal.normalized ? input : normalizeOverlaySettings(input), fields=settings.fields;
  if (!settings.enabled || !hasFields(fields)&&!teamOverlayActive(settings.team)) return [];
  const {read,mapRead}=internal.reader || reader(), run=read(context,"run"), state=read(run,"state");
  if (!run || state === "over" || settings.hidePaused && state === "paused") return [];
  const rows=[], num=value=>overlayNumberText(value,settings.compactNumbers);
  const row=(id,label,value,extra={})=>rows.push({id,label,value,...extra});
  const player=()=>read(run,"player"), stats=()=>read(run,"stats"), actor=()=>read(player(),"stats");
  const stat=key=>finite(read(stats(),key)), attr=key=>finite(read(actor(),key));
  const total=()=>stat("damage"), time=()=>finite(read(run,"time"));
  const withShare=value=>{
    const display=num(value); if (!fields.damageShare) return display;
    const damage=total();
    return `${display} · ${finite(value)===null || damage===null ? "—" : `${+(value/Math.max(1,damage)*100).toFixed(1)}%`}`;
  };
  if (fields.totalDamage) row("total","原生累计伤害",num(total()),{fixed:true});
  if (fields.revives) {
    const ordinary=finite(mapRead(read(player(),"items"),"revive")), maximum=finite(read(player(),"revives"));
    row("revives","剩余复活",num(ordinary===null || maximum===null ? null : ordinary+maximum),{fixed:true});
    row("revive-normal","普通复活",num(ordinary));row("revive-max","全满复活",num(maximum));
  }
  let moveSum=0, movesKnown=false;
  if (fields.moveDamage) {
    const moves=read(player(),"moves"); movesKnown=Array.isArray(moves);
    if (!movesKnown) row("move-unknown","招式伤害","—");
    else for (let slot=0;slot<moves.length;slot++) {
      const move=moves[slot]; if (!move) continue;
      const def=read(move,"def"), key=read(def,"key"), damage=finite(read(move,"damageDone"));
      if (damage===null) movesKnown=false; else moveSum+=damage;
      row(`move-${slot}`,`招式${slot+1} · ${textName(read(def,"name"),textName(key,"未知招式"))}`,withShare(damage));
    }
  }
  if (fields.otherDamage) {
    const ultimate=stat("ultDamage"); row("ult-damage","绝招伤害",withShare(ultimate));
    const forgotten=read(stats(),"forgotten"); let forgottenSum=0, forgottenKnown=!!object(forgotten);
    if (!forgottenKnown) row("forgotten-unknown","遗忘招式历史","—");
    else for (const key of Object.keys(forgotten)) {
      const entry=read(forgotten,key), damage=finite(read(entry,"dmg"));
      if (damage===null) forgottenKnown=false; else forgottenSum+=damage;
      row(`forgotten-${key}`,`${textName(read(entry,"name"),key)}（遗忘历史）`,withShare(damage));
    }
    const list=read(read(run,"allies"),"list"); let allySum=0, alliesKnown=Array.isArray(list);
    if (!alliesKnown) row("allies-unknown","当前支援伤害","—");
    else for (let index=0;index<list.length;index++) {
      const ally=list[index], damage=finite(read(ally,"damage"));
      if (damage===null) alliesKnown=false; else allySum+=damage;
      row(`ally-${index}`,`支援 · ${textName(read(ally,"name"),`#${read(ally,"species") ?? "?"}`)}`,withShare(damage));
    }
    if (!fields.moveDamage) row("residual-note","其余分解","需开启招式伤害");
    else {
      const damage=total(), known=movesKnown&&forgottenKnown&&alliesKnown&&ultimate!==null&&damage!==null;
      row("residual","被动 / 状态 / 其余",withShare(known ? Math.max(0,damage-moveSum-forgottenSum-ultimate-allySum) : null));
    }
  }
  if (fields.averageDps) {
    const damage=total(), seconds=time();
    row("average-dps","整局平均伤害 / 秒",num(damage!==null&&seconds!==null&&seconds>0 ? damage/seconds : null));
  }
  if (fields.elapsed) row("elapsed","游戏时间",clock(time()));
  if (fields.kills) row("kills","击败数量",num(stat("kills")));
  if (fields.damageTaken) row("damage-taken","累计承受伤害",num(stat("damageTaken")));
  if (fields.health) row("health","生命",`${num(finite(read(player(),"hp")))} / ${num(finite(read(player(),"maxHp")))}`);
  if (fields.shield) row("shield","护盾",`${num(finite(read(player(),"shield")))} / ${num(attr("shieldMax"))}`);
  if (fields.experience) row("experience",`等级 ${num(finite(read(player(),"level")))}`,`${num(finite(read(player(),"xp")))} / ${num(finite(read(player(),"xpNext")))} EXP`);
  if (fields.gold) row("gold","持有金币",num(finite(read(run,"gold"))));
  if (fields.ultimate) {
    const ult=read(run,"ult"), charge=finite(read(ult,"charge")), active=finite(read(ult,"active"));
    row("ultimate","绝招状态",active!==null&&active>0 ? `施放中 ${num(active)} 秒` : charge===null ? "—" : charge>=1 ? "蓄能就绪" : `蓄能 ${num(charge*100)}%`);
  }
  if (fields.armor) row("armor","护甲属性",num(attr("armor")));
  if (fields.critChance) {
    const ordinary=attr("critChance"), mega=attr("megaCrit");
    row("crit","暴击 / 超级暴击",`${num(ordinary===null ? null : ordinary*100)}% / ${num(mega===null ? null : mega*100)}%`);
  }
  for (const [key,native,label] of [
    ["critDamage","critDamage","暴击伤害倍率"],["physical","physical","物理伤害倍率"],
    ["special","special","特殊伤害倍率"],["damageMultiplier","damage","伤害属性倍率"],
    ["attackSpeed","attackSpeed","攻速属性"],["moveSpeed","moveSpeed","移速属性"],
    ["xpGain","xpGain","经验属性倍率"],["healingMultiplier","healing","治疗属性倍率"],
  ]) if (fields[key]) row(key,label,`×${num(attr(native))}`);
  if (fields.luck) row("luck","幸运属性",num(attr("luck")));
  if (fields.regen) row("regen","基础每秒回复属性",num(attr("regen")));
  if (fields.itemTriggers) {
    row("item-note","道具触发归因","可重叠 / 限伤前，不加总");
    const damage=read(stats(),"itemDamage");
    if (!object(damage)) row("item-unknown","道具触发统计","—");
    else for (const key of Object.keys(damage)) {
      const definition=mapRead(read(read(context,"bridge"),"items"),key);
      row(`item-${key}`,textName(read(definition,"name"),key),num(finite(read(damage,key))));
    }
  }
  if (fields.rebirth) {
    const held=mapRead(read(player(),"items"),"rainbow-wing"), used=read(player(),"rainbowUsed");
    row("rebirth","虹翼本层重生",held===undefined ? "—" : !held ? "未持有" : typeof used!=="boolean" ? "—" : used ? "本层已使用" : "本层可用");
  }
  if(settings.team.enabled)rows.push(...collectTeamOverlayRows(context,settings.team,{...internal.team,read,
    compactNumbers:settings.compactNumbers,formatNumber:overlayNumberText}));
  return rows;
}
export function installPlayerOverlay(getContext, input = {}, options = {}) {
  const win=options.window || globalThis.window || globalThis, doc=options.document || win.document;
  win.__PB_OVERLAY?.dispose?.();
  const interval=options.setInterval || win.setInterval?.bind(win) || globalThis.setInterval;
  const cancel=options.clearInterval || win.clearInterval?.bind(win) || globalThis.clearInterval;
  const now=options.now || (()=>win.performance?.now?.() ?? Date.now());
  let settings=normalizeOverlaySettings(input), timer=null, disposed=false, root=null, fixedEl=null,
    bodyEl=null, footer=null, currentRun=null, pageBorn=0, pageIndex=0, rowNodes=[], fixedNodes=[], teamSession=null;
  const active=()=>settings.enabled&&(hasFields(settings.fields)||teamOverlayActive(settings.team));
  function stopTimer(){if(timer!==null){cancel(timer);timer=null;}}
  function clearView(clearTeam=true){
    if(clearTeam)teamSession?.clear();
    root?.remove();root=fixedEl=bodyEl=footer=null;rowNodes=[];fixedNodes=[];
    if(clearTeam){currentRun=null;pageBorn=0;pageIndex=0;}
  }
  function element(tag){const el=doc.createElement(tag);el.style.pointerEvents="none";return el;}
  function styles(el,values){for(const [key,value]of Object.entries(values))if(el.style[key]!==value)el.style[key]=value;}
  function layout(font=settings.fontSize){
    const width=Math.min(settings.width,Math.max(1,Number(win.innerWidth)||settings.width));
    const height=Math.min(settings.height,Math.max(1,Number(win.innerHeight)||settings.height));
    const viewportWidth=Math.max(width,Number(win.innerWidth)||width), viewportHeight=Math.max(height,Number(win.innerHeight)||height);
    if(root) styles(root,{width:`${width}px`,height:`${height}px`,
      left:`${clamp(viewportWidth*settings.x/100,0,viewportWidth-width)}px`,
      top:`${clamp(viewportHeight*settings.y/100,0,viewportHeight-height)}px`,fontSize:`${font}px`,
      color:settings.fontColor,backgroundColor:`rgba(${parseInt(settings.backgroundColor.slice(1,3),16)}, ${parseInt(settings.backgroundColor.slice(3,5),16)}, ${parseInt(settings.backgroundColor.slice(5,7),16)}, ${settings.opacity/100})`});
    return {width,height};
  }
  function createView(){
    if(root?.isConnected===false){root=fixedEl=bodyEl=footer=null;rowNodes=[];fixedNodes=[];}
    if(root || !doc?.body)return;
    root=element("aside");root.id="pb-player-overlay";root.setAttribute("aria-hidden","true");
    Object.assign(root.style,{position:"fixed",zIndex:"2147483000",boxSizing:"border-box",padding:"6px",
      borderRadius:"7px",overflow:"hidden",fontFamily:"sans-serif",lineHeight:"1.35",userSelect:"none",contain:"layout paint style"});
    fixedEl=element("div");bodyEl=element("div");footer=element("div");
    Object.assign(footer.style,{fontSize:"10px",height:"14px",lineHeight:"14px",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",opacity:"0.75"});
    root.append(fixedEl,bodyEl,footer);doc.body.append(root);layout();
  }
  const textUnits=value=>Array.from(String(value)).reduce((sum,ch)=>sum+(ch.codePointAt(0)>255?1:0.72),0);
  function rowLayout(row,width,font){
    const labelWidth=textUnits(row.label)*font,valueWidth=textUnits(row.value)*font;
    const stacked=labelWidth+valueWidth+5>width;
    const labelLines=stacked?Math.min(2,Math.max(1,Math.ceil(labelWidth/width))):1;
    const valueLines=stacked?Math.max(1,Math.ceil(valueWidth/width)):1;
    return {stacked,height:Math.ceil(font*1.35*(stacked?labelLines+valueLines:1))};
  }
  function updateRows(container,nodes,rows,width,font){
    while(nodes.length>rows.length) nodes.pop().el.remove();
    for(let index=0;index<rows.length;index++){
      let node=nodes[index];
      if(!node){const el=element("div"),label=element("span"),value=element("span");
        Object.assign(el.style,{display:"flex",alignItems:"center",gap:"5px",overflow:"hidden"});
        Object.assign(label.style,{flex:"1",minWidth:"0",overflow:"hidden",display:"-webkit-box",WebkitBoxOrient:"vertical"});
        Object.assign(value.style,{flex:"0 0 auto",overflowWrap:"anywhere",wordBreak:"break-all",whiteSpace:"normal"});
        el.append(label,value);container.append(el);node={el,label,value};nodes.push(node);}
      const metrics=rowLayout(rows[index],width,font);
      styles(node.el,{height:`${metrics.height}px`,marginBottom:`${settings.rowGap}px`,display:metrics.stacked?"block":"flex"});
      styles(node.value,{maxWidth:metrics.stacked?"100%":"70%",display:metrics.stacked?"block":"inline"});
      if(node.label.style.WebkitLineClamp!=="2")node.label.style.WebkitLineClamp="2";
      if(node.label.textContent!==rows[index].label)node.label.textContent=rows[index].label;
      if(node.value.textContent!==rows[index].value)node.value.textContent=rows[index].value;
    }
  }
  function tick(){
    try { refresh(); } catch { clearView(); }
  }
  function refresh(){
    if(disposed || !active())return;
    if(doc?.hidden){stopTimer();clearView();return;}
    const context=getContext(), memo=reader(), run=memo.read(context,"run"), state=memo.read(run,"state");
    if(!run || state==="over" || settings.hidePaused&&state==="paused"){clearView();return;}
    if(currentRun!==run){clearView();currentRun=run;pageBorn=now();}
    let team=null;
    if(teamOverlayNeedsSession(settings.team)){
      if(!teamSession)teamSession=createTeamOverlaySession({now,crypto:options.crypto||win.crypto});
      team=teamSession.update(context,settings.team,{read:memo.read});
    }else{teamSession?.dispose();teamSession=null;}
    const rows=collectRows(context,settings,{reader:memo,normalized:true,team:{...team,now:now()}});
    if(!rows.length){clearView(false);return;}
    createView();if(!root)return;
    const {height,width}=layout(),contentWidth=Math.max(1,width-12),available=Math.max(1,height-12-14);
    let font=settings.fontSize;
    // Legal minimum windows must still reach every row. Keep the requested
    // font unless even one wrapped row cannot fit; never truncate a full value.
    while(font>8&&rows.some(row=>rowLayout(row,contentWidth,font).height+settings.rowGap>available))font--;
    layout(font);
    let fixed=rows.filter(row=>row.fixed),details=rows.filter(row=>!row.fixed);
    let fixedHeight=fixed.reduce((sum,row)=>sum+rowLayout(row,contentWidth,font).height+settings.rowGap,0);
    if(details.length&&fixedHeight+Math.min(...details.map(row=>rowLayout(row,contentWidth,font).height+settings.rowGap))>available){fixed=[];details=rows;fixedHeight=0;}
    const budget=Math.max(1,available-fixedHeight),groups=[];let group=[],used=0;
    for(const row of details){const cost=rowLayout(row,contentWidth,font).height+settings.rowGap;
      if(group.length&&used+cost>budget){groups.push(group);group=[];used=0;}
      group.push(row);used+=cost;}
    if(group.length||!groups.length)groups.push(group);
    const pages=groups.length;
    pageIndex=settings.autoPage?Math.floor(Math.max(0,now()-pageBorn)/(settings.pageSeconds*1000))%pages:clamp(settings.page-1,0,pages-1);
    updateRows(fixedEl,fixedNodes,fixed,contentWidth,font);updateRows(bodyEl,rowNodes,groups[pageIndex],contentWidth,font);
    const note=pages>1?`${pageIndex+1} / ${pages} 页${settings.autoPage?" · 自动翻页":" · 设置中可选页码"}`:font<settings.fontSize?"适配小窗口字号":rows.some(row=>row.team)?"原生同步 / 队友自报统计":"只读原生统计";
    if(footer.textContent!==note)footer.textContent=note;
  }
  function schedule(){
    if(disposed || !active() || doc?.hidden)return;
    if(timer===null)timer=interval(tick,settings.refreshMs);
  }
  function visibility(){if(doc?.hidden){stopTimer();clearView();}else{tick();schedule();}}
  function resize(){if(root)layout();}
  const instance={
    get settings(){return normalizeOverlaySettings(settings);},tick,
    readPushTeam(fields=[]){return disposed?[]:teamSession?.readCachedPush(fields)||[];},
    configure(next={}){
      if(disposed)return;
      const patch=object(next)?next:{};
      const teamPatch=object(patch.team)?patch.team:{};
      settings=normalizeOverlaySettings({...settings,...patch,fields:{...settings.fields,...(object(patch.fields)?patch.fields:{})},
        team:{...settings.team,...teamPatch,fields:{...settings.team.fields,...(object(teamPatch.fields)?teamPatch.fields:{})}}});
      stopTimer();clearView();if(active()&&!doc?.hidden){tick();schedule();}
    },
    dispose(){if(disposed)return;disposed=true;stopTimer();clearView();teamSession?.dispose();teamSession=null;
      doc?.removeEventListener?.("visibilitychange",visibility);win.removeEventListener?.("resize",resize);
      win.removeEventListener?.("pagehide",unload);win.removeEventListener?.("unload",unload);
      if(win.__PB_OVERLAY===instance)delete win.__PB_OVERLAY;},
  };
  function unload(){instance.dispose();}
  win.__PB_OVERLAY=instance;
  doc?.addEventListener?.("visibilitychange",visibility);win.addEventListener?.("resize",resize);
  win.addEventListener?.("pagehide",unload);win.addEventListener?.("unload",unload);
  if(active()&&!doc?.hidden){tick();schedule();}
  return instance;
}
