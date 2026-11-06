// Optional, current-party statistics. No account, match history, persistence or
// upload API. The transport below uses only the game's existing party channel.
export const TEAM_OVERLAY_FIELD_DEFAULTS = Object.freeze(Object.fromEntries([
  'identity','totalDamage','averageDps','recentDps','damageShare','moveDamage','otherDamage',
  'kills','health','shield','level','revives','status','damageTaken','items','vitamins',
  'ultimate','rescue','area','distance','connection',
].map(key=>[key,false])));
const teamOverlayFields=Object.keys(TEAM_OVERLAY_FIELD_DEFAULTS);
const teamOverlaySharedFields=new Set(['totalDamage','averageDps','recentDps','damageShare','moveDamage','otherDamage',
  'shield','revives','damageTaken','items','vitamins','ultimate']);
const teamOverlayObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const teamOverlayFinite=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const teamOverlayPositive=value=>teamOverlayFinite(value)!==null&&value>=0?value:null;
const teamOverlayText=(value,fallback='—',max=64)=>typeof value==='string'&&value.trim()
  ? value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max):fallback;
const teamOverlayClamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const teamOverlayFormatter=new Intl.NumberFormat('zh-CN',{maximumFractionDigits:1});
export function overlayNumberText(value,compact=true) {
  if(teamOverlayFinite(value)===null)return '—';
  if(compact)for(const [size,suffix]of [[1e15,'Q'],[1e12,'T'],[1e9,'B'],[1e6,'M'],[1e3,'K']])
    if(Math.abs(value)>=size)return `${+(value/size).toFixed(2)}${suffix}`;
  return teamOverlayFormatter.format(value);
}
export function normalizeTeamOverlaySettings(input={}) {
  const raw=teamOverlayObject(input)?input:{},result={enabled:false,shareStats:false,includeSelf:false,sameAreaOnly:false,
    sort:'damage',recentSeconds:10,staleSeconds:8,fields:{...TEAM_OVERLAY_FIELD_DEFAULTS}};
  for(const key of ['enabled','shareStats','includeSelf','sameAreaOnly'])if(typeof raw[key]==='boolean')result[key]=raw[key];
  if(['damage','slot','name'].includes(raw.sort))result.sort=raw.sort;
  for(const key of ['recentSeconds','staleSeconds'])if(typeof raw[key]==='number'&&Number.isFinite(raw[key]))
    result[key]=Math.round(teamOverlayClamp(raw[key],3,30));
  if(teamOverlayObject(raw.fields))for(const key of teamOverlayFields)if(typeof raw.fields[key]==='boolean')result.fields[key]=raw.fields[key];
  return result;
}
export function teamOverlayActive(input) {
  return input?.enabled===true&&(input.shareStats===true||teamOverlayFields.some(key=>input.fields?.[key]===true));
}
function teamOverlayReader() {
  const seen=new WeakMap();
  return (owner,key)=>{
    if(!owner||!['object','function'].includes(typeof owner))return undefined;
    let entry=seen.get(owner);if(!entry)seen.set(owner,entry=new Map());
    if(!entry.has(key))entry.set(key,owner[key]);return entry.get(key);
  };
}
function teamOverlayMapEntries(value,read,limit=160) {
  if(!value)return [];
  const entries=read(value,'entries');if(typeof entries!=='function')return [];
  const result=[];for(const pair of entries.call(value)){if(result.length>=limit)break;if(Array.isArray(pair)&&pair.length===2)result.push(pair);}
  return result;
}
function teamOverlayDefinitionName(bridge,kind,key,read) {
  const map=read(bridge,kind),get=read(map,'get');
  return teamOverlayText(typeof get==='function'?read(get.call(map,key),'name'):null,key);
}
function teamOverlaySample(series,time,damage,seconds) {
  if(teamOverlayPositive(time)===null||teamOverlayPositive(damage)===null){series.length=0;return null;}
  const last=series.at(-1);
  if(last&&(time<last.time||damage<last.damage||time-last.time>Math.max(3,seconds)))series.length=0;
  if(!series.length||time>series.at(-1).time)series.push({time,damage});
  // The producer calls at most once per second; keep a boundary sample plus
  // thirty seconds. This cache contains two numbers per sample, never a run.
  while(series.length>32||series.length>2&&series[1].time<time-30)series.shift();
  const first=series.find(entry=>entry.time>=time-seconds)||series.at(-1);
  const span=time-first.time;
  return span>0?{value:Math.max(0,damage-first.damage)/span,seconds:span}:null;
}
// Only requested fields are read. Values are copied to a small scalar schema,
// so a remote request cannot make us serialize a native object or credential.
function teamOverlayLocalValues(context,wanted,read,series,timeWindow=10) {
  const run=read(context,'run'),player=()=>read(run,'player'),stats=()=>read(run,'stats'),bridge=()=>read(context,'bridge');
  const result={},has=key=>wanted.has(key),stat=key=>teamOverlayPositive(read(stats(),key));
  if(['totalDamage','averageDps','recentDps','damageShare'].some(has))result.totalDamage=stat('damage');
  if(has('averageDps')){const t=teamOverlayPositive(read(run,'time'));result.averageDps=t!==null&&t>0&&result.totalDamage!==null?result.totalDamage/t:null;}
  if(has('recentDps'))result.recentDps=series?teamOverlaySample(series,read(run,'time'),result.totalDamage,timeWindow):null;
  if(has('damageTaken'))result.damageTaken=stat('damageTaken');
  if(has('shield'))result.shield=teamOverlayPositive(read(player(),'shield'));
  if(has('health'))result.health={hp:teamOverlayPositive(read(player(),'hp')),maxHp:teamOverlayPositive(read(player(),'maxHp'))};
  if(has('level'))result.level=teamOverlayPositive(read(player(),'level'));
  if(has('kills'))result.kills=stat('kills');
  if(has('revives')){
    const items=read(player(),'items'),get=read(items,'get'),hasItem=read(items,'has');
    const ordinary=typeof get==='function'&&typeof hasItem==='function'?hasItem.call(items,'revive')?teamOverlayPositive(get.call(items,'revive')):0:null;
    result.revives={ordinary,maximum:teamOverlayPositive(read(player(),'revives'))};
  }
  if(has('moveDamage')){
    const moves=read(player(),'moves');result.moveDamage=Array.isArray(moves)?moves.slice(0,8).map((move,slot)=>{
      if(!move)return null;const def=read(move,'def');return {slot,key:teamOverlayText(read(def,'key'),'unknown',64),
        name:teamOverlayText(read(def,'name'),`招式${slot+1}`),level:teamOverlayPositive(read(move,'level')),damage:teamOverlayPositive(read(move,'damageDone'))};
    }).filter(Boolean):null;
  }
  if(has('otherDamage')){
    const ultimate=stat('ultDamage'),rows=[{key:'ultimate',name:'绝招',damage:ultimate}];
    const list=read(read(run,'allies'),'list'),support=Array.isArray(list)&&list.length<=32?list.reduce((sum,ally)=>{
      const value=teamOverlayPositive(read(ally,'damage'));return sum===null||value===null?null:sum+value;
    },0):null;
    rows.push({key:'support',name:'当前NPC支援',damage:support});
    // History and item attribution are native scalar tables, never a combat
    // event log. Keep leading sources plus an explicit remaining-source sum.
    const appendSources=(table,limit,maximum,prefix,label,decode)=>{
      if(!teamOverlayObject(table)){rows.push({key:prefix,name:label,damage:null});return null;}
      const entries=[];let sum=0,complete=true;
      for(const key in table){
        if(!Object.hasOwn(table,key))continue;
        if(entries.length>=maximum){complete=false;break;}
        const entry=decode(key,read(table,key)),damage=entry.damage;
        if(damage===null)sum=null;else if(sum!==null)sum+=damage;
        entries.push({...entry,key:`${prefix}-${entries.length}`});
      }
      entries.sort((a,b)=>(b.damage??-1)-(a.damage??-1));
      rows.push(...entries.slice(0,limit));
      const rest=entries.slice(limit);
      if(rest.length||!complete)rows.push({key:`${prefix}-remaining`,name:`${label} · 其余${complete?rest.length:'未展开'}项`,
        damage:complete?rest.reduce((value,entry)=>value===null||entry.damage===null?null:value+entry.damage,0):null});
      return complete?sum:null;
    };
    const forgotten=appendSources(read(stats(),'forgotten'),12,1024,'forgotten','遗忘历史',(key,entry)=>({
      name:teamOverlayText(`${teamOverlayText(read(entry,'name'),key)}（遗忘历史）`),damage:teamOverlayPositive(read(entry,'dmg'))}));
    const moves=read(player(),'moves'),moveSum=Array.isArray(moves)&&moves.length<=8?moves.reduce((sum,move)=>{
      if(!move)return sum;const value=teamOverlayPositive(read(move,'damageDone'));return sum===null||value===null?null:sum+value;
    },0):null,damage=stat('damage');
    rows.push({key:'residual',name:'被动 / 状态 / 其余',damage:[damage,moveSum,forgotten,ultimate,support].every(value=>value!==null)
      ?Math.max(0,damage-moveSum-forgotten-ultimate-support):null});
    appendSources(read(stats(),'itemDamage'),24,128,'item','道具归因（可重叠 / 限伤前）',(key,value)=>({
      name:teamOverlayText(`${teamOverlayDefinitionName(bridge(),'items',key,read)}（道具归因，可重叠）`),damage:teamOverlayPositive(value)}));
    result.otherDamage=rows;
  }
  for(const [field,kind]of [['items','items'],['vitamins','vitamins']])if(has(field)){
    const value=read(player(),field);
    result[field]=typeof read(value,'entries')==='function'?teamOverlayMapEntries(value,read,field==='items'?128:40).map(([key,entry])=>({
      key:teamOverlayText(key,'unknown'),name:teamOverlayDefinitionName(bridge(),kind,key,read),
      count:teamOverlayPositive(field==='items'?entry:read(entry,'lv')??read(entry,'level')),
    })):null;
  }
  if(has('ultimate')){const ult=read(run,'ult');result.ultimate={charge:teamOverlayPositive(read(ult,'charge')),active:teamOverlayPositive(read(ult,'active'))};}
  return result;
}
function teamOverlayPeers(run,read) {
  const coop=read(run,'coop');if(!coop||read(coop,'ended')===true)return null;
  const room=read(coop,'room');
  if(read(room,'alive')===false||read(room,'open')===false)return null;
  const members=read(read(room,'room'),'members');
  const peers=read(coop,'peers'),entries=teamOverlayMapEntries(peers,read,4);
  return {coop,peers:entries.filter(([id,peer])=>typeof id==='string'&&id.length<=160&&peer&&Number.isInteger(read(peer,'slot'))&&read(peer,'slot')>=0&&read(peer,'slot')<4&&
    (!Array.isArray(members)||members.some(member=>read(member,'id')===id&&read(member,'slot')===read(peer,'slot'))))};
}
function teamOverlaySharedRecord(shared,id,peer,now,staleSeconds,read) {
  const entry=shared?.get?.(id);
  if(!entry||entry.peer?.deref?.()!==peer||read(peer,'gone')===true||read(peer,'link')!=='open'||
    !Number.isInteger(entry.stage)||entry.stage!==read(peer,'stage')||teamOverlayFinite(entry.receivedAt)===null||now-entry.receivedAt<0||now-entry.receivedAt>staleSeconds*1000)return null;
  return entry;
}
// Stateless rows. Detailed output comes only from a current-party shared
// snapshot; native peer.last never contains damage and cannot supply DPS.
export function collectTeamOverlayRows(context,input={},internal={}) {
  const settings=normalizeTeamOverlaySettings(input),fields=settings.fields;
  if(!settings.enabled||!teamOverlayFields.some(key=>fields[key]))return [];
  const read=internal.read||teamOverlayReader(),run=read(context,'run');
  if(!run||read(run,'state')==='over')return [];
  const group=teamOverlayPeers(run,read);if(!group)return [];
  const rows=[],now=typeof internal.now==='number'?internal.now:globalThis.performance?.now?.()??Date.now(),
    num=value=>(internal.formatNumber||overlayNumberText)(value,internal.compactNumbers!==false),
    nativeNow=()=>teamOverlayFinite(read(run,'realTime')),stage=()=>teamOverlayFinite(read(run,'stage'));
  const actors=[];
  const needsShared=fields.connection||teamOverlayFields.some(key=>fields[key]&&teamOverlaySharedFields.has(key));
  const needsFresh=['identity','health','level','status','rescue','distance','connection'].some(key=>fields[key]),
    needsStage=settings.sameAreaOnly||fields.area||fields.distance;
  for(const [id,peer]of group.peers){
    const peerStage=needsStage?teamOverlayFinite(read(peer,'stage')):null;
    if(settings.sameAreaOnly&&(peerStage===null||peerStage!==stage()))continue;
    const lastAt=needsFresh?teamOverlayFinite(read(peer,'lastAt')):null,clock=needsFresh?nativeNow():null,age=lastAt!==null&&clock!==null?clock-lastAt:null,
      fresh=age!==null&&age>=0&&age<=settings.staleSeconds&&read(peer,'gone')!==true&&read(peer,'link')==='open',
      shared=needsShared?teamOverlaySharedRecord(internal.shared,id,peer,now,settings.staleSeconds,read):null;
    actors.push({id,slot:read(peer,'slot'),name:teamOverlayText(read(peer,'name'),`队友${read(peer,'slot')+1}`),peer,
      last:()=>fresh?read(peer,'last'):null,values:shared?.values||{},shared:!!shared,fresh,age,peerStage});
  }
  let self=null;
  if(settings.includeSelf||fields.damageShare){
    const wanted=new Set(Object.keys(fields).filter(key=>fields[key]));
    if(fields.damageShare)wanted.add('totalDamage');
    const values=internal.selfValues||teamOverlayLocalValues(context,wanted,read,null,settings.recentSeconds);
    if(settings.includeSelf){
      const player=()=>read(run,'player'),pos=()=>read(player(),'pos');
      const last={get species(){return read(player(),'speciesId');},get hpNow(){return read(player(),'hp');},get maxHp(){return read(player(),'maxHp');},
        get level(){return read(player(),'level');},get x(){return read(pos(),'x');},get y(){return read(pos(),'y');},get z(){return read(pos(),'z');},
        get revive(){const value=teamOverlayPositive(read(group.coop,'reviveK'));return value===null?null:value/3;},get bleed(){return read(group.coop,'bleed');},
        get flags(){
          const dead=read(player(),'dead'),out=read(group.coop,'out');let flags=out===true?2:dead===true?1:0;
          if(fields.status){
            const state=read(run,'state');if(['modal','paused'].includes(state)&&read(group.coop,'modalT')<8)flags|=4;
            if(read(player(),'iframes')>0&&!dead)flags|=8;
            if(read(group.coop,'portalReady'))flags|=64;
            if(read(player(),'attackT')>0||read(player(),'ultPoseT')>0)flags|=128;
          }
          return flags;
        }};
      self={id:'self',slot:read(group.coop,'mySlot')??0,name:'自己',values,shared:true,fresh:true,age:0,peerStage:stage(),self:true,
        peer:null,last:()=>last};
      actors.push(self);
    }
    internal={...internal,selfDamage:values.totalDamage};
  }
  let total=null;
  if(fields.damageShare){
    total=teamOverlayPositive(internal.selfDamage);
    const room=read(group.coop,'room'),me=read(room,'me'),members=read(read(room,'room'),'members');
    if(!Array.isArray(members)||members.length>4||!members.some(member=>read(member,'id')===me))total=null;
    else for(const member of members){
      const id=read(member,'id');if(id===me)continue;
      const peer=group.peers.find(([key])=>key===id)?.[1],
        entry=peer?teamOverlaySharedRecord(internal.shared,id,peer,now,settings.staleSeconds,read):null,
        value=teamOverlayPositive(entry?.values?.totalDamage);
      total=total===null||value===null?null:total+value;
    }
  }
  actors.sort(settings.sort==='name'?(a,b)=>a.name.localeCompare(b.name,'zh-CN'):settings.sort==='damage'?(a,b)=>{
    const av=teamOverlayPositive(a.values.totalDamage),bv=teamOverlayPositive(b.values.totalDamage);
    return av!==null&&bv!==null?bv-av||a.slot-b.slot:av!==null?-1:bv!==null?1:a.slot-b.slot;
  }:(a,b)=>a.slot-b.slot);
  const sourceNames={native:'原生同步',shared:'队友共享',self:'本机原生'};
  for(const actor of actors){
    const {slot,name,values,peer}=actor,base=`team-${actor.self?'self':slot}`,last=()=>actor.last(),
      add=(field,label,value,source='native')=>rows.push({id:`${base}-${field}`,label:`${name} · ${label}`,value,team:true,source:sourceNames[actor.self?'self':source]}),
      sharedValue=(field,label,format=num)=>{const value=values[field];add(field,label,actor.shared?format(value):'—（未共享或已过期）','shared');};
    if(fields.identity){
      const species=read(last(),'species')??read(peer,'species'),bridge=read(context,'bridge'),data=read(bridge,'data'),get=read(data,'get'),definition=typeof get==='function'?get.call(data,species):null;
      add('identity',`队伍位置 ${slot+1}`,teamOverlayText(read(definition,'name'),Number.isInteger(species)?`#${species}`:'角色未知'));
    }
    if(fields.totalDamage)sharedValue('totalDamage','累计伤害');
    if(fields.averageDps)sharedValue('averageDps','整局平均 DPS');
    if(fields.recentDps)sharedValue('recentDps',`近期 DPS（目标${settings.recentSeconds}秒）`,value=>value&&teamOverlayPositive(value.value)!==null&&teamOverlayPositive(value.seconds)!==null?`${num(value.value)} / 秒 · ${num(value.seconds)}秒样本`:'—（等待有效样本）');
    if(fields.damageShare)add('damageShare','当前队伍伤害占比',total!==null&&total>0&&teamOverlayPositive(values.totalDamage)!==null?`${+(values.totalDamage/total*100).toFixed(1)}%`:'—（队伍数据不完整）','shared');
    for(const [field,label]of [['moveDamage','招式'],['otherDamage','其他来源']])if(fields[field]){
      const list=values[field];if(!actor.shared||!Array.isArray(list))add(field,label,'—（未共享或已过期）','shared');
      else if(!list.length)add(field,label,'无','shared');
      else for(const [index,entry]of list.entries())add(`${field}-${index}`,`${label}${field==='moveDamage'?`${(entry.slot??index)+1} `:' · '}${teamOverlayText(entry.name,entry.key)}`,`${num(entry.damage)}${field==='moveDamage'&&teamOverlayPositive(entry.level)!==null?` · Lv.${num(entry.level)}`:''}`,'shared');
      if(field==='otherDamage'&&Array.isArray(list))add('otherDamage-note','归因说明','道具可重叠且为限伤前归因；不与总伤害重复相加','shared');
    }
    if(fields.kills)add('kills','击败数量',num(actor.self?values.kills:teamOverlayPositive(read(peer,'kills'))));
    if(fields.health){
      const hp=teamOverlayPositive(read(last(),'hpNow')),maximum=teamOverlayPositive(read(last(),'maxHp')),ratio=teamOverlayFinite(read(last(),'hp'));
      add('health','生命',hp!==null&&maximum!==null?`${num(hp)} / ${num(maximum)}`:ratio!==null&&ratio>=0&&ratio<=1?`${num(ratio*100)}% · 绝对值未知`:'—');
    }
    if(fields.shield)sharedValue('shield','护盾');
    if(fields.level)add('level','等级',num(teamOverlayPositive(read(last(),'level'))));
    if(fields.revives)sharedValue('revives','剩余复活',value=>value?`${num(teamOverlayPositive(value.ordinary)!==null&&teamOverlayPositive(value.maximum)!==null?value.ordinary+value.maximum:null)}（普通${num(value.ordinary)} / 全满${num(value.maximum)}）`:'—');
    if(fields.damageTaken)sharedValue('damageTaken','累计承受伤害');
    if(fields.status){
      const flags=read(last(),'flags'),labels=[];
      if(Number.isInteger(flags))for(const [mask,label]of [[1,'倒地'],[2,'暂时出局'],[4,'选择/暂停保护'],[8,'保护中'],[64,'传送门就绪'],[128,'攻击中']])if(flags&mask)labels.push(label);
      add('status','状态',read(peer,'gone')===true?'已离开':!actor.fresh?'未取得新鲜状态':Number.isInteger(flags)?labels.join(' · ')||'正常':'—');
    }
    for(const [field,label]of [['items','道具'],['vitamins','维生素']])if(fields[field]){
      const list=values[field];if(!actor.shared||!Array.isArray(list))add(field,label,'—（未共享或已过期）','shared');
      else if(!list.length)add(field,label,'无','shared');
      else for(const [index,entry]of list.entries()){
        const itemName=typeof entry.name==='string'&&entry.name.trim()?teamOverlayText(entry.name,entry.key):teamOverlayDefinitionName(read(context,'bridge'),field,entry.key,read);
        add(`${field}-${index}`,`${label} · ${itemName}`,`${field==='items'?'×':'Lv.'}${num(entry.count)}`,'shared');
      }
    }
    if(fields.ultimate)sharedValue('ultimate','绝招',value=>!value?'—':teamOverlayPositive(value.active)!==null&&value.active>0?`施放中 ${num(value.active)}秒`:teamOverlayPositive(value.charge)!==null?`蓄能 ${num(value.charge*100)}%`:'—');
    if(fields.rescue){
      const progress=teamOverlayFinite(read(last(),'revive')),bleed=teamOverlayPositive(read(last(),'bleed')),flags=read(last(),'flags');
      add('rescue','倒地救援',!actor.fresh||!Number.isInteger(flags)?'—':flags&2?'暂时出局':flags&1?`救援 ${num(progress!==null&&progress>=0&&progress<=1?progress*100:null)}% · 剩余${num(bleed)}秒`:'未倒地');
    }
    if(fields.area)add('area','所在关卡',actor.peerStage!==null?`第${num(actor.peerStage)}关${actor.peerStage===stage()?' · 同区域':' · 其他区域'}`:'—');
    if(fields.distance){const pos=read(read(run,'player'),'pos'),x=teamOverlayFinite(read(last(),'x')),y=teamOverlayFinite(read(last(),'y')),z=teamOverlayFinite(read(last(),'z')),
      px=teamOverlayFinite(read(pos,'x')),py=teamOverlayFinite(read(pos,'y')),pz=teamOverlayFinite(read(pos,'z'));
      add('distance','空间距离',actor.peerStage===stage()&&[x,y,z,px,py,pz].every(value=>value!==null)?`${num(Math.hypot(x-px,y-py,z-pz))} m`:'—（不同区域或位置未知）');}
    if(fields.connection){
      let latency=null;if(!actor.self){const mesh=read(read(group.coop,'room'),'mesh'),rtt=read(mesh,'rtt');if(typeof rtt==='function'){const value=teamOverlayPositive(rtt.call(mesh,actor.id));if(value>0)latency=value;}}
      const link=actor.self?'本机':read(peer,'gone')===true?'已离开':({open:'已连接',connecting:'连接中',closed:'已断开',failed:'连接失败'})[read(peer,'link')]||'连接未知';
      add('connection','连接与统计来源',`${link}${actor.self?'':` · RTT ${latency===null?'—':num(latency)+' ms'}`} · ${actor.shared?'共享数据已确认':'未收到有效共享'}`);
    }
  }
  return rows;
}

export const TEAM_OVERLAY_PROTOCOL='pb-pilot:team-stats';
const teamOverlayWireFields=new Set([...teamOverlaySharedFields].filter(key=>key!=='damageShare'));
const teamOverlayNonce=value=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);
const teamOverlayMatch=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const teamOverlayLimit=12*1024;
const teamOverlayRandomNonce=crypto=>Array.from(crypto.getRandomValues(new Uint8Array(16)),value=>value.toString(16).padStart(2,'0')).join('');
function teamOverlayPeerRecord(peer) {
  return {peer:new WeakRef(peer),request:null,lastRequest:-Infinity,lastSend:-Infinity,sequence:0,lastSequence:0,
    remoteNonce:null,outgoingNonce:null,retired:new Set(),attempts:0};
}
function teamOverlayWireValues(input,wanted) {
  if(!teamOverlayObject(input))return null;
  const output={};let count=0;
  for(const key in input){
    if(!Object.hasOwn(input,key))continue;
    if(++count>16||!teamOverlayWireFields.has(key)||!wanted.has(key))return null;
    const value=input[key];
    if(['totalDamage','averageDps','damageTaken','shield'].includes(key)){
      if(value!==null&&teamOverlayPositive(value)===null)return null;output[key]=value;
    }else if(key==='recentDps'){
      if(value===null){output[key]=null;continue;}
      if(!teamOverlayObject(value)||teamOverlayPositive(value.value)===null||teamOverlayPositive(value.seconds)===null||value.seconds>30)return null;
      output[key]={value:value.value,seconds:value.seconds};
    }else if(key==='revives'){
      if(!teamOverlayObject(value))return null;
      if([value.ordinary,value.maximum].some(v=>v!==null&&(teamOverlayPositive(v)===null||v>1e6)))return null;
      output[key]={ordinary:value.ordinary,maximum:value.maximum};
    }else if(key==='ultimate'){
      if(!teamOverlayObject(value)||[value.charge,value.active].some(v=>v!==null&&teamOverlayPositive(v)===null)||value.charge>1e6||value.active>1e6)return null;
      output[key]={charge:value.charge,active:value.active};
    }else{
      if(value===null){output[key]=null;continue;}
      const maximum=key==='items'?128:key==='vitamins'?40:key==='moveDamage'?8:48;
      if(!Array.isArray(value)||value.length>maximum)return null;
      const list=[];
      for(const row of value){
        if(!teamOverlayObject(row)||typeof row.key!=='string'||row.key.length<1||row.key.length>64||['__proto__','constructor','prototype'].includes(row.key))return null;
        const item={key:row.key};
        if(key==='items'||key==='vitamins'){
          if(row.count!==null&&teamOverlayPositive(row.count)===null)return null;item.count=row.count;
        }else{
          if(typeof row.name!=='string'||row.name.length>64||row.damage!==null&&teamOverlayPositive(row.damage)===null)return null;
          item.name=teamOverlayText(row.name,row.key);item.damage=row.damage;
          if(key==='moveDamage'){
            if(!Number.isInteger(row.slot)||row.slot<0||row.slot>7||row.level!==null&&teamOverlayPositive(row.level)===null)return null;
            item.slot=row.slot;item.level=row.level;
          }
        }
        list.push(item);
      }
      output[key]=list;
    }
  }
  return output;
}
function teamOverlayRequestedFields(settings) {
  const wanted=new Set(teamOverlayFields.filter(key=>settings.fields[key]&&teamOverlayWireFields.has(key)));
  if(settings.fields.damageShare)wanted.add('totalDamage');
  return wanted;
}
export function teamOverlayNeedsSession(settings) {
  return settings?.enabled===true&&(settings.shareStats===true||teamOverlayRequestedFields(settings).size>0);
}
// One controller per overlay installation. No timer of its own. Incoming data
// is handled only after explicit opt-in, copied to bounded scalars and fenced
// by native room/run/peer identities, a shared match hash and fresh nonces.
export function createTeamOverlaySession(options={}) {
  const clock=options.now||(()=>globalThis.performance?.now?.()??Date.now()),crypto=options.crypto||globalThis.crypto;
  let state=null,disposed=false,sent=0,errors=0;
  function clear(){
    if(!state)return;const old=state;state=null;old.active=false;
    if(old.wrapper&&old.coop.onCtl===old.wrapper)old.coop.onCtl=old.original;
    old.shared.clear();old.peers.clear();old.samples.length=0;old.selfValues=null;
    old.context=null;old.app=old.meta=old.account=old.room=old.coop=old.run=null;
    old.me=old.nonce=old.match=old.settings=old.original=old.wrapper=null;
  }
  function current(scope){
    if(state!==scope||!scope.active||disposed)return false;
    try{
      const context=scope.context,run=context?.run,bridge=context?.bridge,app=bridge?.app,meta=app?.meta;
      return run===scope.run&&run?.coop===scope.coop&&scope.coop.room===scope.room&&scope.room.me===scope.me&&
        (!app||app.run===run)&&app===scope.app&&meta===scope.meta&&meta?.account===scope.account&&
        run.state!=='over'&&run.state!=='paused'&&scope.coop.ended!==true&&scope.room.alive!==false&&scope.room.open!==false;
    }catch{return false;}
  }
  function peerCurrent(scope,id,record=null){
    if(!current(scope))return null;
    const peer=scope.coop.peers?.get?.(id),members=scope.room.room?.members;
    if(!peer||peer.gone===true||peer.link!=='open'||!Number.isInteger(peer.slot)||peer.slot<0||peer.slot>3||
      record&&record.peer.deref()!==peer||!Array.isArray(members)||!members.some(member=>member.id===id&&member.slot===peer.slot))return null;
    return peer;
  }
  function send(scope,id,packet){
    if(!current(scope)||!peerCurrent(scope,id))return false;
    try{
      const mesh=scope.room.mesh,link=mesh?.links?.get?.(id),ctl=link?.ctl;
      if(!ctl||ctl.readyState!=='open'||!Number.isFinite(ctl.bufferedAmount)||ctl.bufferedAmount>8192||typeof mesh.sendCtl!=='function')return false;
      const raw=JSON.stringify(packet);
      if(raw.length>teamOverlayLimit||new TextEncoder().encode(raw).length>teamOverlayLimit)return false;
      if(!current(scope)||mesh.sendCtl(id,packet)!==true)return false;
      sent++;return true;
    }catch{errors++;return false;}
  }
  function onPacket(scope,id,packet){
    if(!current(scope)||!scope.match||!teamOverlayObject(packet)||packet.t!==TEAM_OVERLAY_PROTOCOL||packet.v!==1||packet.match!==scope.match||
      !teamOverlayNonce(packet.nonce)||!['request','snapshot'].includes(packet.kind))return;
    const peer=peerCurrent(scope,id);if(!peer)return;
    const now=clock();let record=scope.peers.get(id);
    if(!record||record.peer.deref()!==peer){scope.shared.delete(id);scope.peers.set(id,record=teamOverlayPeerRecord(peer));}
    if(packet.kind==='request'){
      if(!scope.settings.shareStats||!Array.isArray(packet.fields)||packet.fields.length>12||!Number.isInteger(packet.window)||packet.window<3||packet.window>30)return;
      const fields=new Set();for(const key of packet.fields){if(typeof key!=='string'||!teamOverlayWireFields.has(key)||fields.has(key))return;fields.add(key);}
      if(!fields.size)return;
      record.request={fields,window:packet.window,nonce:packet.nonce,at:now};
    }else{
      const wanted=teamOverlayRequestedFields(scope.settings);
      if(!wanted.size||!record.outgoingNonce||packet.to!==record.outgoingNonce||!Number.isSafeInteger(packet.seq)||packet.seq<1||
        !Number.isInteger(packet.stage)||packet.stage<1||packet.stage>100000)return;
      if(record.retired.has(packet.nonce)||record.remoteNonce===packet.nonce&&packet.seq<=record.lastSequence)return;
      const values=teamOverlayWireValues(packet.values,wanted);if(!values)return;
      if(JSON.stringify(values).length>teamOverlayLimit||new TextEncoder().encode(JSON.stringify(values)).length>teamOverlayLimit)return;
      if(record.remoteNonce&&record.remoteNonce!==packet.nonce){
        if(record.retired.size>=16)return;
        record.retired.add(record.remoteNonce);
      }
      record.remoteNonce=packet.nonce;record.lastSequence=packet.seq;record.attempts=0;
      scope.shared.set(id,{peer:new WeakRef(peer),receivedAt:now,stage:packet.stage,values});
    }
  }
  function start(context,settings){
    const run=context?.run,coop=run?.coop,room=coop?.room,app=context?.bridge?.app,meta=app?.meta;
    if(!run||!coop||!room||!teamOverlayObject(room)||coop.ended===true||run.state==='over'||run.state==='paused'||
      room.alive===false||room.open===false||!crypto?.getRandomValues||!crypto?.subtle?.digest||typeof WeakRef!=='function'||
      !(typeof coop.party==='string'&&coop.party.trim()&&coop.party.length<=256||Number.isSafeInteger(coop.party)&&coop.party!==0)||
      !Number.isFinite(run.seed)||!Number.isInteger(run.tier))return;
    const nonce=teamOverlayRandomNonce(crypto);
    const scope={active:true,context,run,coop,room,me:room.me,app,meta,account:meta?.account,nonce,match:null,settings,
      shared:new Map(),peers:new Map(),samples:[],selfValues:null,lastSample:-Infinity,lastNow:clock(),original:null,wrapper:null};
    state=scope;
    // Never put the native party value or raw seed on the wire. This digest is
    // computed once, and a late completion cannot bind to a replacement run.
    const material=JSON.stringify(['pb-pilot-team-v1',coop.party,run.seed,run.biome?.id??null,run.tier]);
    Promise.resolve(crypto.subtle.digest('SHA-256',new TextEncoder().encode(material))).then(buffer=>{
      if(!current(scope))return;
      scope.match=Array.from(new Uint8Array(buffer),value=>value.toString(16).padStart(2,'0')).join('');
      if(!teamOverlayMatch(scope.match)){clear();return;}
    },()=>{if(state===scope){errors++;clear();}});
  }
  function hook(scope){
    if(scope.wrapper||!scope.match||typeof scope.coop.onCtl!=='function')return;
    scope.original=scope.coop.onCtl;
    const original=scope.original;
    scope.wrapper=function(...args){
      const result=original.apply(this,args);
      try{if(args[1]?.t===TEAM_OVERLAY_PROTOCOL)onPacket(scope,args[0],args[1]);}catch{errors++;}
      return result;
    };
    scope.coop.onCtl=scope.wrapper;
  }
  function update(context,input={},internal={}){
    const settings=normalizeTeamOverlaySettings(input);
    if(disposed||!teamOverlayNeedsSession(settings)){clear();return {shared:null,selfValues:null};}
    if(state){state.context=context;if(!current(state))clear();}
    if(!state)try{start(context,settings);}catch{errors++;clear();}
    const scope=state;if(!scope)return {shared:null,selfValues:null};
    scope.settings=settings;
    if(!scope.match)return {shared:scope.shared,selfValues:null};
    hook(scope);
    const read=internal.read||teamOverlayReader(),now=clock(),wanted=teamOverlayRequestedFields(settings),valid=new Set();
    if(!Number.isFinite(now)||now<scope.lastNow){clear();return {shared:null,selfValues:null};}
    scope.lastNow=now;
    const signature=[...wanted].join('|'),peers=teamOverlayPeers(scope.run,read)?.peers||[];
    for(const [id,peer]of peers){
      if(!peerCurrent(scope,id))continue;valid.add(id);
      let record=scope.peers.get(id);
      if(!record||record.peer.deref()!==peer){scope.shared.delete(id);scope.peers.set(id,record=teamOverlayPeerRecord(peer));}
      const visible=!settings.sameAreaOnly||read(peer,'stage')===read(scope.run,'stage');
      if(record.signature!==signature||!visible){
        scope.shared.delete(id);record.signature=signature;record.outgoingNonce=record.remoteNonce=null;
        record.retired.clear();record.lastSequence=0;record.lastRequest=-Infinity;record.attempts=0;
      }
      if(record.request&&(!settings.shareStats||now-record.request.at>3500))record.request=null;
      const shared=scope.shared.get(id);if(shared&&now-shared.receivedAt>settings.staleSeconds*1000)scope.shared.delete(id);
      if(visible&&wanted.size&&now-record.lastRequest>=(record.attempts>2&&!scope.shared.has(id)?10000:2000)){
        record.lastRequest=now;record.attempts++;
        const previous=record.outgoingNonce;record.outgoingNonce=teamOverlayRandomNonce(crypto);
        if(send(scope,id,{t:TEAM_OVERLAY_PROTOCOL,v:1,kind:'request',match:scope.match,nonce:record.outgoingNonce,fields:[...wanted],window:settings.recentSeconds}))record.retired.clear();
        else record.outgoingNonce=previous;
      }
    }
    for(const id of scope.peers.keys())if(!valid.has(id)){scope.peers.delete(id);scope.shared.delete(id);}
    const subscribers=[...scope.peers.entries()].filter(([,record])=>settings.shareStats&&record.request&&now-record.request.at<=3500&&now-record.lastSend>=1000),
      union=new Set(subscribers.flatMap(([,record])=>[...record.request.fields]));
    const selfWanted=settings.includeSelf?new Set(teamOverlayFields.filter(key=>settings.fields[key])):new Set();
    for(const key of selfWanted)union.add(key);
    if(settings.fields.damageShare)union.add('totalDamage');
    const needsSample=union.has('recentDps');
    if(!needsSample)scope.samples.length=0;
    // Local presentation may refresh faster; history receives at most one
    // sample/second. Shared collection only starts for a live subscription.
    const history=needsSample&&now-scope.lastSample>=1000?scope.samples:null;
    if(history)scope.lastSample=now;
    const values=union.size?teamOverlayLocalValues(context,union,read,history,settings.recentSeconds):{};
    if(needsSample&&!history&&Object.hasOwn(scope.selfValues||{},'recentDps'))values.recentDps=scope.selfValues.recentDps;
    scope.selfValues=values;
    for(const [id,record]of subscribers){
      const request=record.request,projection={};
      for(const key of request.fields)if(Object.hasOwn(values,key))projection[key]=values[key];
      if(request.fields.has('recentDps'))projection.recentDps=scope.samples.length?teamOverlaySample(scope.samples,scope.run.time,values.totalDamage,request.window):null;
      const safe=teamOverlayWireValues(projection,request.fields);if(!safe)continue;
      // Reserve the attempt slot even on backpressure; never fill a reliable
      // RTC queue with retries or interfere with native revival/portal traffic.
      record.lastSend=now;
      const packet={t:TEAM_OVERLAY_PROTOCOL,v:1,kind:'snapshot',match:scope.match,nonce:scope.nonce,to:request.nonce,
        seq:++record.sequence,stage:scope.run.stage,values:safe};
      // A large inventory must not suppress cumulative damage and other small
      // requested fields. Mark the largest optional arrays unknown until the
      // whole packet fits; never queue fragments or silently return partial lists.
      const arrays=['items','vitamins','otherDamage','moveDamage'].filter(key=>Array.isArray(safe[key]))
        .sort((a,b)=>JSON.stringify(safe[b]).length-JSON.stringify(safe[a]).length);
      for(const key of arrays){if(new TextEncoder().encode(JSON.stringify(packet)).length<=teamOverlayLimit)break;safe[key]=null;}
      send(scope,id,packet);
    }
    return {shared:scope.shared,selfValues:settings.includeSelf?scope.selfValues:null};
  }
  function readCachedPush(fields=[]){
    const scope=state;if(!scope||!current(scope)||!Array.isArray(fields))return [];
    const wanted=fields.filter(key=>teamOverlayWireFields.has(key)),now=clock(),rows=[];
    if(!wanted.length)return rows;
    // Read an existing, fresh voluntary cache only. This does not call update,
    // create a session, request fields, collect local history or send packets.
    for(const [id,entry]of scope.shared){
      if(rows.length>=4)break;
      const peer=peerCurrent(scope,id);
      if(!peer||entry.peer?.deref()!==peer||entry.stage!==peer.stage||!Number.isFinite(entry.receivedAt)||
        now<entry.receivedAt||now-entry.receivedAt>scope.settings.staleSeconds*1000)continue;
      const values={};for(const key of wanted)if(Object.hasOwn(entry.values,key))values[key]=entry.values[key];
      rows.push({slot:peer.slot,values});
    }
    return rows;
  }
  return {update,clear,readCachedPush,dispose(){if(disposed)return;clear();disposed=true;},
    get diagnostics(){return {active:!!state,hooked:!!state?.wrapper,peers:state?.peers.size??0,received:state?.shared.size??0,samples:state?.samples.length??0,sent,errors};}};
}
