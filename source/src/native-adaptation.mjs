import { parsePublicNativeModule } from './native-parser.mjs';
import { nativeSelectorCatalog } from './native-selector-catalog.mjs';

// Public-source syntax and explicit, typed overrides. This module never runs a
// fetched program, reads credentials, or treats a guessed method as a valid API.
export const nativeRoleDescriptions = {
  data:['游戏公开数据','精灵、招式和图片等原生公开目录'],roster:['可玩角色目录','判断角色与原生解锁条件'],
  biomes:['地图目录','选择真实存在的地图'],biomeLive:['地图开放判断','核对地图入口是否可用'],
  quests:['角色委托目录','读取委托条件与目标'],lab:['研究所目录','读取强化项目与价格'],
  items:['道具目录','道具选择和购买评分'],vitamins:['维生素目录','维生素选择和升级评分'],
  rarityMultipliers:['稀有度目录','读取实际稀有度加成'],moveDef:['招式定义','读取普通和融合招式'],
  moveGuide:['角色招式指南','判断角色可以学习的招式'],fusionFor:['融合配方匹配','匹配两项原料的真实融合结果'],
  fusionRecipes:['融合配方目录','最终招式与融合原料规划'],mutationToday:['每日模式日程','读取游戏原生每日模式'],
  mutationDefinition:['每日模式定义','核对每日模式的真实配置'],
};
export const nativeOwnerIds=['damage','player','director','enemies','run','ui'];
export const nativeRuntimeOwners={app:'app',meta:'app.meta',backend:'app.meta.backend',input:'app.input',run:'app.run',damage:'app.run.combat',director:'app.run.director',
  player:'app.run.player',ui:'app.run.ui',world:'app.run.interactables',terrain:'app.run.terrain',
  capture:'app.run.capture',boss:'app.run.boss',vfx:'app.run.vfx',enemies:'app.run.enemies',projectiles:'app.run.projectiles'};
const runtimeMembers={app:['boot','startRun','toMenu','menu','openResearch','openDex','openAchievements','offerRecover','resumeSaved','savedCard'],
  backend:['req','loadProfile','saveProfile','startRun','endRun'],
  meta:['endRun','hasPending','inLeague','leagueReady','biomeTier','lab','buyLab','claimQuest','questProgress','task','claimTask','loadProfile','resync','now'],
  input:['update','endFrame'],run:['update','later','finish','pause','resume','act','enterPortal','openShop','openDitto','openForget','fuse'],
  player:['addMove','forgetMove','addVitamin','removeVitamin','canHold','addItem','heal','hurt'],
  ui:['showLevelUp','showFusion','showForget','showDitto','showShop','showPause','hasModal','hideModal','showBlessing','showItemChoice'],
  world:['interact','label','nearest','spawnPortal'],terrain:['walkClear','heightAt'],capture:['throw','update'],
  boss:['lineStrike','strike'],vfx:['telegraph'],enemies:['update'],projectiles:['update']};
const nativeRuntimeFields={app:['meta','input','run'],meta:['account','profile','backend'],
  run:['state','player','ui','biome','stats','enemies','projectiles','terrain','interactables','boss','capture','vfx','camYaw','stage','time'],
  player:['pos','moves','items','vitamins','stats','hp','maxHp','speciesId'],
  input:['stickX','stickY','dragLook','pressed','held'],ui:['modalEl','modal'],
  enemies:['alive','species','x','y','z','flags','gen'],projectiles:['flags','x','y','z']};
const nativeNames={boot:'启动游戏',startRun:'开始一局',endRun:'保存结算',req:'原生网络请求',loadProfile:'读取已保存进度',saveProfile:'保存原生进度',
  inLeague:'角色拥有状态',leagueReady:'可用角色列表',biomeTier:'地图难度开放状态',hasPending:'待保存记录',resync:'同步进度',
  lab:'研究等级',buyLab:'购买研究',claimQuest:'领取角色委托',questProgress:'角色委托进度',task:'日常委托进度',claimTask:'领取日常委托',
  forgetMove:'遗忘招式',rescue:'救援友方',vitCap:'维生素槽位',capOf:'招式等级上限',canHold:'道具容量判断',
  addMove:'学习招式',addVitamin:'选择维生素',removeVitamin:'遗忘维生素',addItem:'获取道具',buildPool:'敌群候选池',
  enterPortal:'下一关入口',openMap:'地图窗口',openShop:'商店窗口',openDitto:'复制道具窗口',openForget:'遗忘窗口',
  showFusion:'融合选择窗口',showPause:'暂停窗口',showLevelUp:'升级选择窗口',showForget:'遗忘招式窗口',showDitto:'复制道具选择',
  showShop:'商店选择',showBlessing:'祝福选择',showItemChoice:'道具选择',hideModal:'关闭原生窗口',hasModal:'原生窗口状态',
  pause:'暂停',resume:'继续',finish:'正常结束并结算',update:'原生逐帧更新',endFrame:'原生帧末输入处理',act:'原生交互输入',
  interact:'地图交互',label:'交互提示',nearest:'当前最近交互',spawnPortal:'下一关入口生成',walkClear:'可行走路线判断',
  heightAt:'地形高度',throw:'原生投球',lineStrike:'首领直线攻击',strike:'首领攻击',telegraph:'攻击预警',
  toMenu:'返回原生菜单',menu:'原生菜单',openResearch:'研究所页面',openDex:'图鉴页面',openAchievements:'成就页面',
  offerRecover:'原生恢复选择',resumeSaved:'继续原生存档',savedCard:'已保存提示',now:'原生时间',fuse:'原生融合',
  addGold:'拾取金币',aimTarget:'原生瞄准目标',rollChestItem:'精灵球道具候选',rerollCost:'商店刷新费用',rerollShop:'商店刷新',
  offerBlessing:'祝福候选',rageBonus:'伤害加成读取',rebirth:'原生复活',reviveFlash:'复活界面效果',eliteBurst:'头目攻击效果'};
const unsafeKeys=new Set(['__proto__','prototype','constructor']);
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const identifier=value=>typeof value==='string'&&/^[A-Za-z_$][\w$]{0,127}$/.test(value)&&!unsafeKeys.has(value);
const keyName=value=>typeof value==='string'&&/^[A-Za-z_$][\w$]{0,127}$/.test(value)&&!unsafeKeys.has(value);
export function publicStaticURL(value) {
  if(typeof value!=='string'||value.length>2048)return false;
  try{const u=new URL(value,'https://pokebonk.com/');return u.protocol==='https:'&&u.hostname==='pokebonk.com'&&
    !u.username&&!u.password&&!u.port&&!u.hash&&!/(?:token|auth|cookie|account|password|secret|key)=/i.test(u.search)&&
    (u.pathname==='/'||/\.(?:m?js|json|css|woff2?|png|webp|svg)$/i.test(u.pathname));}catch{return false;}
}
export function buildCompatibilityEditorCatalog(aliasOwners=[],memberProfiles=[]) {
  const row=(id,name,purpose,type='string',extra={})=>({id,name,purpose,type,kind:'interfaces',group:'原生模块符号',defaultValue:'',...extra});
  const rows=Object.entries(nativeRoleDescriptions).map(([key,[name,purpose]])=>row('symbols.'+key,name,purpose,'symbol',
    {help:'填写当前游戏模块中的变量或函数名，不是网站网址。自动获取只填写唯一匹配的原生符号。'}));
  aliasOwners.forEach((owner,i)=>owner.members.forEach(name=>rows.push(row(`members.${nativeOwnerIds[i]}.${name}`,
    `${nativeNames[name]||name}（${nativeOwnerIds[i]}）`,`${nativeNames[name]||name}所使用的原生方法名称；不修改游戏数值`,'member',{group:'原生方法映射',owner:nativeOwnerIds[i],logical:name,
      memberKind:memberProfiles.find(row=>row.name===name)?.kind||'method'}))));
  for(const[owner,names]of Object.entries(runtimeMembers))for(const name of names)if(!rows.some(row=>row.id===`members.${owner}.${name}`))
    rows.push(row(`members.${owner}.${name}`,`${nativeNames[name]||name}（${owner}）`,`${nativeNames[name]||name}的原生入口；不存在时仅相关动作等待`,'member',
      {group:'原生方法映射',owner,logical:name,memberKind:name==='nearest'?'field':'method'}));
  for(const[owner,names]of Object.entries(nativeRuntimeFields))for(const name of names)
    rows.push(row(`fields.${owner}.${name}`,`${owner} · ${name} 数据名称`,'读取这个原生数据字段的名称；只映射已有字段，不填数据值、不修改伤害生命或坐标','member',
      {group:'原生数据字段名称',owner,logical:name,memberKind:'field',writableInput:owner==='input'&&['stickX','stickY','dragLook'].includes(name)}));
  for(const[id,name]of [['gamePage','游戏主页'],['mainModule','游戏主模块'],['newsModule','游戏新闻模块']])
    rows.push(row(`resources.${id}`,name,'官方公开资源地址；仅允许游戏官网的公开静态资源','url',
      {group:'公开资源地址',defaultValue:id==='gamePage'?'https://pokebonk.com/':''}));
  for(const id of ["pokemon", "moves", "abilities", "items", "learnsets", "types", "sprites", "i18n.en", "i18n.fr", "i18n.ja", "i18n.ko", "i18n.pt", "i18n.ru", "i18n.zh", "i18n.zht"])
    rows.push(row(`resources.data.${id}`,`${id} 公开数据`,'原生公开 JSON 资源请求使用的地址；仅适配链接，不改变数据内容','url',{group:'公开资源地址'}));
  for(const id of ["coast", "common", "desert", "forest", "frostlake", "glacier", "graveyard", "ruins", "sanctum", "stormcape", "tower", "volcano"])
    rows.push(row(`resources.assets.env.${id}.atlas`,`${id} 场景资源索引`,'原生场景公开 JSON 索引地址','url',{group:'公开资源地址'}));
  rows.push(row('resources.versionManifest','游戏版本清单','读取公开部署版本的地址','url',{group:'公开资源地址',defaultValue:'https://pokebonk.com/version.json'}));
  const other=(id,name,purpose,type,defaultValue,extra={})=>({id,name,purpose,type,defaultValue,kind:'other',group:'其他适配配置',...extra});
  rows.push(other('appExport','App 导出名称','原生主模块导出的启动类名称','member','App'),
    other('bootMethod','原生启动方法','调用原生启动流程的方法名','member','boot'),
    other('sourceMaxBytes','脚本资源大小上限','主模块增长时可提高上限；不改变游戏内容','integer',12000000,{min:1000000,max:30000000}),
    other('probeIntervalMs','接口重试间隔（毫秒）','启用状态下重试未就绪接口，不重启健康对局','integer',3000,{min:1000,max:30000}),
    other('bootGraceSeconds','资源加载等待（秒）','原生冷启动加载的宽限时间','integer',120,{min:30,max:600}),
    other('sharedRandomMoveLimit','随机类招式同时持有限制','以原生升级生成器为准；自动获取无法证明时保持未知','integer',0,{min:0,max:8}),
    other('shinySwapSelection','异色替换卡片含义','保留/释放的原生回调含义，不按翻译猜测','enum','auto',{choices:['auto','keep','release']}),
    other('selector.loadingRetry','加载重试按钮','原生加载失败时显示的按钮 CSS 选择器','selector','.loading button.btn.big.red'),
    other('selector.loadingProgress','加载进度','原生加载进度条 CSS 选择器','selector','.loading .bar i'),
    other('selector.pauseContinue','暂停继续按钮','仅在当前真实暂停面板内查找','selector','button.green.big'),
    other('selector.savedNotice','原生保存通知','定位保存提示；还需验证本次原生调用与身份','selector','.season-modal'),
    other('selector.modalButtons','选择按钮','只在当前原生选择窗口内查找','selector','button'));
  const generatedDefaults=new Set(nativeSelectorCatalog.map(row=>row.defaultValue));
  return {schemaVersion:1,entries:[...rows.filter(row=>row.type!=='selector'||!generatedDefaults.has(row.defaultValue)),...nativeSelectorCatalog]};
}

export function nativeRoleOverrideVerified(role,node,source,automatic) {
  if(automatic)return true;
  if(!node)return false;
  const functions=new Set(['biomeLive','moveDef','moveGuide','fusionFor','mutationToday','mutationDefinition']);
  if(!functions.has(role))return !['ClassDeclaration','ClassExpression','FunctionDeclaration','ArrowFunctionExpression','FunctionExpression','ImportSpecifier'].includes(node.type);
  if(!['FunctionDeclaration','ArrowFunctionExpression','FunctionExpression'].includes(node.type))return false;
  // A new native name is not proof that its implementation is a read helper.
  // Calls to unknown helpers, identifier writes (including outer module state),
  // iteration, construction and accessors are not approved by a deny-list.
  // Keep the automatic reviewed binding when this small pure subset cannot
  // establish a role; never execute a downloaded function to discover it.
  if(node.async||node.generator||(node.params||[]).some(param=>param.type!=='Identifier'))return false;
  const allowed=new Set(['Identifier','Literal','StringLiteral','NumericLiteral','BooleanLiteral','NullLiteral',
    'BlockStatement','ReturnStatement','IfStatement','EmptyStatement','VariableDeclaration','VariableDeclarator',
    'MemberExpression','OptionalMemberExpression','ChainExpression','UnaryExpression','BinaryExpression','LogicalExpression',
    'ConditionalExpression','ArrayExpression','ObjectExpression','Property','ObjectProperty','TemplateLiteral','TemplateElement','ThisExpression']);
  let unsafe=false;const properties=new Set(),identifiers=new Set(),types=new Set();
  const visit=(n,root=false)=>{if(!n||typeof n.type!=='string')return;
    types.add(n.type);if(!root&&!allowed.has(n.type))unsafe=true;
    if(n.type==='VariableDeclaration'&&n.kind!=='const'||n.type==='VariableDeclarator'&&n.id?.type!=='Identifier'||
      n.type==='UnaryExpression'&&n.operator==='delete')unsafe=true;
    if(n.type==='Identifier')identifiers.add(n.name);
    if(['MemberExpression','OptionalMemberExpression'].includes(n.type)&&!n.computed&&n.property?.type==='Identifier')properties.add(n.property.name);
    for(const[key,value]of Object.entries(n))if(!['start','end','loc'].includes(key)){
      if(Array.isArray(value))value.forEach(item=>visit(item));else if(value&&typeof value==='object')visit(value);
    }};visit(node,true);
  if(unsafe)return false;
  if(role==='fusionFor')return ['signature','reaction','pair'].every(name=>properties.has(name));
  if(role==='moveGuide')return properties.has('kit')&&identifiers.has('shared')&&identifiers.has('roster');
  // Unknown Map/get calls require separate semantic review. A matching word in
  // a comment/string or an arbitrary callee with an innocent name is not proof.
  if(role==='moveDef')return false;
  if(role==='biomeLive')return ['disabled','enabled','live'].some(name=>properties.has(name))&&
    (types.has('UnaryExpression')||types.has('BinaryExpression')||types.has('LogicalExpression'));
  if(role==='mutationToday')return properties.has('mutation')&&properties.has('id');
  if(role==='mutationDefinition')return properties.has('mutation')&&properties.has('id');
  return false;
}
export function normalizeEditorOverrides(value,catalog) {
  const out={schemaVersion:1,revision:Number.isSafeInteger(value?.revision)&&value.revision>=0?value.revision:0,interfaces:{},other:{}},errors=[];
  if(!plain(value))return {config:out,errors};
  for(const kind of ['interfaces','other']){
    if(value[kind]!=null&&!plain(value[kind])){errors.push({id:kind,reason:'配置必须是对象'});continue;}
    for(const[id,input]of Object.entries(value[kind]||{})){
      const spec=catalog.entries.find(row=>row.id===id&&row.kind===kind);
      if(!spec){errors.push({id,reason:'当前客户端没有这个适配项'});continue;}
      const v=typeof input==='string'?input.trim():input;
      if(kind==='interfaces'&&v==='')continue;
      const valid=spec.type==='integer'?Number.isSafeInteger(v)&&v>=spec.min&&v<=spec.max:
        spec.type==='enum'?spec.choices.includes(v):spec.type==='symbol'?identifier(v):spec.type==='member'?keyName(v):
        spec.type==='url'?publicStaticURL(v):spec.type==='selector'?typeof v==='string'&&v.length>0&&v.length<=256&&
          !/[\x00-\x1f]/.test(v)&&(()=>{try{globalThis.document?.createElement?.('div')?.querySelector?.(v);return true;}catch{return false;}})():typeof v==='string'&&v.length<=512;
      if(valid)out[kind][id]=v;else errors.push({id,reason:'格式或允许范围不正确；没有应用此项'});
    }
  }
  return {config:out,errors};
}
export function describeEditorOverrides(config,report,kind,catalog) {
  const normalized=normalizeEditorOverrides(config,catalog),effective=report?.effectiveConfig||{},discovered=report?.discoveredConfig||{};
  return {schemaVersion:1,revision:normalized.config.revision,kind,errors:normalized.errors,
    entries:catalog.entries.filter(row=>!kind||row.kind===kind).map(row=>{
      const effectiveValue=effective[row.id]??(row.kind==='other'?row.defaultValue:''),
        value=normalized.config[row.kind][row.id]??(row.kind==='interfaces'?effectiveValue||row.defaultValue:row.defaultValue),candidate=discovered[row.id];
      return {...row,value,effectiveValue,status:report?.entryStatus?.[row.id]||
        (candidate!=null?'discovered':value!==row.defaultValue?'pending-current-document':'unknown'),
        reason:report?.entryReasons?.[row.id]||'有效性由当前游戏模块与实际运行对象核验；未核验不表示有效',
        candidate:candidate??null,candidateSource:report?.candidateSources?.[row.id]||(candidate!=null?'current-public-source':null),
        candidateVerified:report?.candidateVerified?.[row.id]??(candidate!=null),source:candidate!=null?'current-public-source':value!==row.defaultValue?'manual':'default',
        applyState:value!==effectiveValue?'pending-current-document':'applied'};
    })};
}
export function nativeSyntaxIndex(source) {
  const ast=parsePublicNativeModule(source),bindings=new Map(),classes=[],functions=[],methods=[],exports=new Map(),boots=[];
  const put=(name,node)=>{if(identifier(name)&&!bindings.has(name))bindings.set(name,node);};
  const visit=(node,owner=null)=>{
    if(!node||typeof node.type!=='string')return;
    if(node.type==='ClassDeclaration'||node.type==='ClassExpression'){
      const spec={symbol:owner||node.id?.name,node,methods:node.body.body.filter(n=>n.type==='MethodDefinition'&&!n.computed&&n.key?.type==='Identifier')};classes.push(spec);
      for(const method of spec.methods)methods.push({owner:spec.symbol,name:method.key.name,kind:method.kind==='get'||method.kind==='set'?method.kind:'method',node:method,start:method.start,end:method.end});
    }
  };
  const topExpression=node=>{
    if(!node)return;
    if(node.type==='SequenceExpression'){node.expressions.forEach(topExpression);return;}
    if(node.type==='AwaitExpression'||node.type==='ChainExpression'||node.type==='UnaryExpression'&&node.operator==='void'){
      topExpression(node.argument||node.expression);return;
    }
    if(node.type!=='CallExpression')return;
    const member=node.callee;
    if(member?.type==='MemberExpression'){
      const method=!member.computed?member.property?.name:member.property?.type==='Literal'?member.property.value:null;
      if(member.object?.type==='NewExpression'&&member.object.callee?.type==='Identifier'&&member.object.arguments.length===0&&node.arguments.length===0&&keyName(method))
        boots.push({app:member.object.callee.name,method,start:node.start,end:node.end});
      else topExpression(member.object);
    }
  };
  for(const statement of ast.body){
    const s=statement.type==='ExportNamedDeclaration'||statement.type==='ExportDefaultDeclaration'?statement.declaration:statement;
    if(s?.type==='VariableDeclaration')for(const d of s.declarations)if(d.id.type==='Identifier'){put(d.id.name,d.init);visit(d.init,d.id.name);if(/FunctionExpression$/.test(d.init?.type||''))functions.push({name:d.id.name,node:d.init});}
    if(s?.type==='FunctionDeclaration'){put(s.id?.name,s);functions.push({name:s.id?.name,node:s});}
    if(s?.type==='ClassDeclaration'){put(s.id?.name,s);visit(s,s.id?.name);}
    if(statement.type==='ImportDeclaration')for(const spec of statement.specifiers)put(spec.local.name,spec);
    if(statement.type==='ExportNamedDeclaration'){
      for(const spec of statement.specifiers||[])exports.set(spec.exported.name||spec.exported.value,spec.local.name);
      if(statement.declaration?.id)exports.set(statement.declaration.id.name,statement.declaration.id.name);
    }
    if(s?.type==='ExpressionStatement')topExpression(s.expression);
  }
  return {ast,bindings,classes,functions,methods,exports,boots};
}
export function absolutizeNativeModuleImports(source,moduleURL) {
  if(!publicStaticURL(moduleURL))throw Error('Module import base must be an official static URL');
  const ast=parsePublicNativeModule(source),edits=[];
  const visit=node=>{if(!node||typeof node.type!=='string')return;
    if(node.type==='MemberExpression'&&!node.computed&&node.property?.name==='url'&&node.object?.type==='MetaProperty'&&node.object.meta?.name==='import'){edits.push({start:node.start,end:node.end,value:JSON.stringify(new URL(moduleURL).href)});return;}
    const literal=['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration','ImportExpression'].includes(node.type)?node.source:null;
    if(literal?.type==='Literal'&&typeof literal.value==='string'&&/^(?:\.\.?\/|\/)/.test(literal.value)){
      const next=new URL(literal.value,moduleURL);if(next.origin!=='https://pokebonk.com')throw Error('Import must stay on official origin');
      edits.push({start:literal.start,end:literal.end,value:JSON.stringify(next.href)});
    }
    for(const[key,value]of Object.entries(node))if(!['start','end','loc'].includes(key)){
      if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);
    }};visit(ast);
  for(const edit of edits.sort((a,b)=>b.start-a.start))source=source.slice(0,edit.start)+edit.value+source.slice(edit.end);
  return source;
}
export function discoverPublicModuleReferences(source,baseURL) {
  if(!publicStaticURL(baseURL))return [];
  const ast=parsePublicNativeModule(source),urls=new Set();
  const add=value=>{if(typeof value!=='string'||!/^\.{0,2}\/?[A-Za-z0-9_./@-]+\.m?js(?:\?[A-Za-z0-9_=&.-]*)?$/.test(value))return;
    try{const u=new URL(value,baseURL);if(u.origin==='https://pokebonk.com'&&!u.username&&!u.password&&!u.hash)urls.add(u.href);}catch{}};
  const visit=node=>{if(!node||typeof node.type!=='string')return;
    if(['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration','ImportExpression'].includes(node.type))add(node.source?.value);
    if(node.type==='Literal'&&typeof node.value==='string'&&/^(?:\.\.?\/|\/|assets\/)/.test(node.value))add(node.value);
    for(const[key,value]of Object.entries(node))if(!['start','end','loc'].includes(key)){
      if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);
    }};visit(ast);return [...urls].slice(0,64);
}
export function nativeMethodFeatures(node) {
  const tokens=new Set();let nodes=0;
  const visit=n=>{if(!n||typeof n.type!=='string')return;nodes++;
    if(n.type==='MemberExpression'&&!n.computed&&n.property?.type==='Identifier'&&!n.property.name.startsWith('$'))tokens.add('p:'+n.property.name);
    if((n.type==='Property'||n.type==='MethodDefinition')&&!n.computed&&n.key?.type==='Identifier'&&!n.key.name.startsWith('$'))tokens.add('k:'+n.key.name);
    if(n.type==='Literal'&&typeof n.value==='string'&&n.value.length>0&&n.value.length<=100)tokens.add('s:'+n.value);
    for(const[key,value]of Object.entries(n))if(!['start','end','loc','range'].includes(key)){
      if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);
    }};
  visit(node.value||node);return {tokens:[...tokens].sort(),nodes,arity:(node.value||node).params?.length??0};
}
export function discoverNativeCaptureFeatures(source,index,shape) {
  const result={ordinaryMissingBaseFallback:false},pattern='!i.length&&n.length&&(i=j.pokemon.filter(e=>e.id<=151&&!e.legendary&&!e.mythical&&e.evoStage===0&&j.hasAnimated(e.id)&&!r.has(t.meta.family(e.id))))';
  if(!index||typeof shape!=='function')return result;
  const reviewed=index.methods.filter(row=>row.name==='spawnShiny'&&shape(source.slice(row.start,row.end))==='e9c10179:baf1fff9:1297');
  if(reviewed.length===1)return {ordinaryMissingBaseFallback:true,ordinaryMissingBaseFallbackMaxDex:251,ordinaryBiomeSpecials:true};
  const expected=shape(pattern);
  for(const method of index.methods.filter(row=>row.name==='spawnShiny')){
    const sets=new Set(),candidates=[];
    const visit=node=>{if(!node||typeof node.type!=='string')return;
      if(node.type==='VariableDeclarator'&&node.id?.type==='Identifier'&&node.init?.type==='NewExpression'&&node.init.callee?.name==='Set'&&
        /\.meta\.profile\.shinies\.map\(/.test(source.slice(node.init.start,node.init.end)))sets.add(node.id.name);
      if(node.type==='LogicalExpression'&&node.operator==='&&'&&shape(source.slice(node.start,node.end))===expected)candidates.push(node);
      for(const[key,value]of Object.entries(node))if(!['start','end','loc'].includes(key)){
        if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);
      }};visit(method.node);
    for(const node of candidates){const fragment=source.slice(node.start,node.end),set=/!([A-Za-z_$][\w$]*)\.has\([^)]*\.meta\.family\(/.exec(fragment)?.[1];
      if(set&&sets.has(set))result.ordinaryMissingBaseFallback=true;
    }
  }
  return result;
}
export function matchNativeMethodFeatures(features,candidates) {
  if(!features?.tokens||features.tokens.length<4)return null;
  const wanted=new Set(features.tokens),scored=[];
  for(const row of candidates){
    const got=nativeMethodFeatures(row.node);if(got.arity!==features.arity||got.nodes<features.nodes*.55||got.nodes>features.nodes*1.7)continue;
    const overlap=got.tokens.filter(token=>wanted.has(token)).length,union=new Set([...features.tokens,...got.tokens]).size,
      score=union?overlap/union:0;
    if(score>=.88&&overlap>=4)scored.push({...row,score});
  }
  scored.sort((a,b)=>b.score-a.score);
  return scored.length===1||scored[0]?.score-(scored[1]?.score||0)>=.12?scored[0]||null:null;
}

export function nativeCompatSelector(value) {
  try{return globalThis.__PB_RUNTIME_COMPAT?.resolveSelector(value)||value;}catch{return value;}
}
export function nativeCompatSelectorTemplate(template,values={}) {
  const selected=nativeCompatSelector(template),escape=value=>typeof globalThis.CSS?.escape==='function'?globalThis.CSS.escape(String(value)):
    String(value).replace(/[\\"\n\r\f]/g,char=>'\\'+char.codePointAt(0).toString(16)+' ');
  return selected.replace(/\{([A-Za-z][\w]*)\}/g,(placeholder,key)=>Object.hasOwn(values,key)?escape(values[key]):placeholder);
}

// Serialized into the original native bootstrap's lexical scope. All registry
// values are lazy references to already existing native definitions, not eval.
export function createNativeRuntimeEditor(bridge,registry,initialConfig,catalog,sourceReport) {
  let config=initialConfig,report=sourceReport;
  const paths={app:'app',meta:'app.meta',backend:'app.meta.backend',input:'app.input',run:'app.run',damage:'app.run.combat',director:'app.run.director',
    player:'app.run.player',ui:'app.run.ui',world:'app.run.interactables',terrain:'app.run.terrain',capture:'app.run.capture',boss:'app.run.boss',
    vfx:'app.run.vfx',enemies:'app.run.enemies',projectiles:'app.run.projectiles'},memberKeys=new WeakMap(),
    originalKey=bridge.nativeMemberKey||((_object,key)=>key),ownedGetters=new WeakMap();
  bridge.nativeMemberKey=(object,key)=>memberKeys.get(object)?.get(key)||originalKey(object,key);
  let observedRun=Symbol('not-observed'),observedRevision=-1;
  const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k),
    safeId=s=>typeof s==='string'&&/^[A-Za-z_$][\w$]{0,127}$/.test(s)&&!['__proto__','prototype','constructor'].includes(s),
    shape=(id,v)=>{
      if(['roster','biomes','quests','lab','rarityMultipliers','fusionRecipes'].includes(id))return Array.isArray(v)&&v.length>0;
      if(['items','vitamins'].includes(id))return v&&typeof v.get==='function'&&typeof v.values==='function';
      if(id==='data')return v&&typeof v.get==='function'&&typeof v.root==='function'&&Array.isArray(v.pokemon);
      return typeof v==='function';
    },
    normalize=input=>{
      const out={schemaVersion:1,revision:Number.isSafeInteger(input?.revision)?input.revision:0,interfaces:{},other:{}};
      for(const spec of catalog.entries){
        const v=input?.[spec.kind]?.[spec.id];if(v==null||v==='')continue;
        if(spec.type==='integer'&&Number.isSafeInteger(v)&&v>=spec.min&&v<=spec.max||
          spec.type==='enum'&&spec.choices.includes(v)||['member','symbol'].includes(spec.type)&&safeId(v)||
          spec.type==='selector'&&typeof v==='string'&&v.length>0&&v.length<=256&&!/[\x00-\x1f]/.test(v)&&
            (()=>{try{globalThis.document?.createElement?.('div')?.querySelector?.(v);return true;}catch{return false;}})()||
          spec.type==='url'&&typeof v==='string'&&v.length<=2048&&(()=>{try{const u=new URL(v,'https://pokebonk.com/');return u.origin==='https://pokebonk.com'&&!u.username&&!u.password&&!u.hash&&!/(token|auth|cookie|account|password|secret|key)=/i.test(u.search);}catch{return false;}})())out[spec.kind][spec.id]=v;
      }
      return out;
    };
  config=normalize(config);
  let activeMemberConfig={...config.interfaces};
  const refresh=(force=false)=>{
    let currentRun;try{currentRun=bridge.app?.run;}catch{currentRun=null;}
    if(!force&&observedRun===currentRun&&observedRevision===config.revision)return;
    observedRun=currentRun;observedRevision=config.revision;
    report.effectiveConfig||={};report.discoveredConfig||={};report.entryStatus||={};report.entryReasons||={};
    report.candidateSources||={};report.candidateVerified||={};
    try{for(const entry of globalThis.performance?.getEntriesByType?.('resource')||[]){
      const u=new URL(entry.name);if(u.origin!=='https://pokebonk.com'||u.username||u.password||u.hash||[...u.searchParams.keys()].some(key=>key!=='v'))continue;
      const id=u.pathname==='/version.json'?'resources.versionManifest':/^\/(?:data\/|assets\/env\/).+\.json$/.test(u.pathname)?
        'resources.'+u.pathname.slice(1,-5).replaceAll('/','.'):null;
      if(id&&catalog.entries.some(row=>row.id===id)){
        report.discoveredConfig[id]=u.href;
        report.candidateSources[id]='native-public-resource';report.candidateVerified[id]=true;
        if(!config.interfaces[id]||config.interfaces[id]===u.href){report.effectiveConfig[id]=u.href;report.entryStatus[id]='discovered';}
      }
    }}catch{/* Public resource timings are optional and contain no account snapshots. */}
    for(const spec of catalog.entries.filter(row=>row.kind==='interfaces'&&row.owner&&row.logical)
      .sort((a,b)=>Number(b.id.startsWith('fields.'))-Number(a.id.startsWith('fields.')))){
      let target=bridge;try{for(const name of (paths[spec.owner]||'').split('.'))target=target?.[name];}catch{target=null;}
      if(!target||typeof target!=='object'){
        if(report.candidateSources[spec.id]==='native-runtime'){
          delete report.discoveredConfig[spec.id];delete report.candidateVerified[spec.id];delete report.effectiveConfig[spec.id];
        }
        report.entryStatus[spec.id]='unknown';continue;
      }
      const logical=spec.logical,manual=activeMemberConfig[spec.id];
      const descriptorAt=(key,skipOwned=false)=>{let raw;
        for(let p=target;p&&!raw;p=Object.getPrototypeOf(p)){
          const next=Object.getOwnPropertyDescriptor(p,key);
          if(skipOwned&&p===target&&next?.get===ownedGetters.get(target)?.get(logical))continue;
          raw=next;
        }return raw;
      },kindOK=raw=>spec.memberKind==='field'?!!raw&&typeof raw.value!=='function':spec.memberKind==='get'?typeof raw?.get==='function':
        spec.memberKind==='set'?typeof raw?.set==='function':typeof raw?.value==='function';
      // Auto-acquire is independent of the user's override. Never echo a manual
      // name as a newly discovered address, or retain a prior run's field name.
      let automatic=originalKey(target,logical),automaticRaw=descriptorAt(automatic,true);
      const sourceCandidate=report.discoveredConfig[spec.id];
      if(!kindOK(automaticRaw)&&report.candidateSources[spec.id]==='current-public-source'&&safeId(sourceCandidate)){
        const raw=descriptorAt(sourceCandidate,true);if(kindOK(raw)){automatic=sourceCandidate;automaticRaw=raw;}
      }
      if(kindOK(automaticRaw)){
        report.discoveredConfig[spec.id]=automatic;report.candidateSources[spec.id]='native-runtime';report.candidateVerified[spec.id]=true;
      }else {
        delete report.discoveredConfig[spec.id];delete report.candidateVerified[spec.id];
      }
      if(!manual&&memberKeys.get(target)?.has(logical)){
        const descriptor=Object.getOwnPropertyDescriptor(target,logical),getter=ownedGetters.get(target)?.get(logical);
        if(descriptor?.get===getter)delete target[logical];
        memberKeys.get(target).delete(logical);ownedGetters.get(target)?.delete(logical);
      }
      if(manual&&safeId(manual)&&manual!==logical){
        let raw;for(let p=target;p&&!raw;p=Object.getPrototypeOf(p))raw=Object.getOwnPropertyDescriptor(p,manual);
        const validKind=spec.memberKind==='field'?!!raw&&typeof raw.value!=='function':spec.memberKind==='get'?typeof raw?.get==='function':
          spec.memberKind==='set'?typeof raw?.set==='function':typeof raw?.value==='function';
        if(raw&&!validKind){report.entryStatus[spec.id]='invalid';report.entryReasons[spec.id]='成员类型不符：不能把普通数据字段当成方法调用';continue;}
        const prior=memberKeys.get(target)?.get(logical);
        if(raw&&(!(logical in target)||prior||originalKey(target,logical)!==logical)){
          const map=memberKeys.get(target)||new Map();map.set(logical,manual);memberKeys.set(target,map);
          try{const getter=function(){return this[manual];},descriptor={configurable:true,enumerable:false,get:getter};
            if(spec.writableInput)descriptor.set=function(value){if(logical==='dragLook'&&typeof value==='boolean'||logical!=='dragLook'&&typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=1)this[manual]=value;};
            Object.defineProperty(target,logical,descriptor);
            const getters=ownedGetters.get(target)||new Map();getters.set(logical,getter);ownedGetters.set(target,getters);}
          catch{map.delete(logical);report.entryStatus[spec.id]='invalid';report.entryReasons[spec.id]='原生对象不允许安装只读名称映射';continue;}
        }else if(!raw){report.entryStatus[spec.id]='invalid';report.entryReasons[spec.id]='当前实际对象不存在这个成员，未调用或猜测替代方法';continue;}
        else if(originalKey(target,logical)!==manual){report.entryStatus[spec.id]='pending-current-document';report.entryReasons[spec.id]='不会覆盖仍存在的原生方法；需核对用途或在下一次页面载入时重新匹配';continue;}
      }
      if(logical in target){const key=bridge.nativeMemberKey(target,logical);
        let raw;for(let p=target;p&&!raw;p=Object.getPrototypeOf(p))raw=Object.getOwnPropertyDescriptor(p,key);
        const validKind=spec.memberKind==='field'?!!raw&&typeof raw.value!=='function':spec.memberKind==='get'?typeof raw?.get==='function':
          spec.memberKind==='set'?typeof raw?.set==='function':typeof raw?.value==='function';
        if(!validKind){delete report.discoveredConfig[spec.id];report.entryStatus[spec.id]='invalid';report.entryReasons[spec.id]='现有同名成员类型不符，未把它当成可用方法';continue;}
        report.effectiveConfig[spec.id]=key;report.entryStatus[spec.id]='valid';
        if(!manual){report.discoveredConfig[spec.id]=key;report.candidateSources[spec.id]='native-runtime';report.candidateVerified[spec.id]=true;}
      }else{delete report.effectiveConfig[spec.id];report.entryStatus[spec.id]='unknown';report.entryReasons[spec.id]='当前原生对象未提供此成员，相关功能等待修复';}
    }
    for(const spec of catalog.entries.filter(row=>row.kind==='interfaces'&&row.owner&&row.logical))
      if(config.interfaces[spec.id]!==activeMemberConfig[spec.id]){
        report.entryStatus[spec.id]='pending-current-document';
        report.entryReasons[spec.id]='正在保留当前对局与已绑定回调；在安全菜单重新应用或下一次载入时生效';
      }
  };
  const selectorIDs=new Map(catalog.entries.filter(row=>row.kind==='other'&&row.type==='selector').map(row=>[row.defaultValue,row.id]));
  const describe=kind=>({schemaVersion:1,revision:config.revision,kind,entries:catalog.entries.filter(s=>!kind||s.kind===kind).map(spec=>{
    const effectiveValue=report.effectiveConfig?.[spec.id]??(spec.kind==='other'?spec.defaultValue:''),
      value=config[spec.kind][spec.id]??(spec.kind==='interfaces'?effectiveValue||spec.defaultValue:spec.defaultValue),candidate=report.discoveredConfig?.[spec.id]??null;
    return {...spec,value,effectiveValue,candidate,candidateSource:report.candidateSources?.[spec.id]||null,
      candidateVerified:report.candidateVerified?.[spec.id]===true,status:report.entryStatus?.[spec.id]||'unknown',
      reason:report.entryReasons?.[spec.id]||'等待当前模块或实际运行对象核验',
      source:own(config[spec.kind],spec.id)?'manual':'current-public-source',
      applyState:report.entryStatus?.[spec.id]==='pending-current-document'||value!==effectiveValue?'pending-current-document':'applied'};
  })});
  const api={
    describe(kind){refresh();return describe(kind);},refresh,
    probe(kind,id){refresh(true);
      for(const spec of catalog.entries.filter(s=>(!kind||s.kind===kind)&&(!id||s.id===id))){
        if(spec.type==='selector'){
          let found=false;try{found=!!globalThis.document?.querySelector?.(spec.defaultValue);}catch{}
          if(found){report.discoveredConfig[spec.id]=spec.defaultValue;report.candidateSources[spec.id]='native-visible-dom';report.candidateVerified[spec.id]=true;}
          else {delete report.discoveredConfig[spec.id];delete report.candidateVerified[spec.id];}
          if(!own(config.other,spec.id))report.entryStatus[spec.id]=found?'valid':'unknown';
        }else if(spec.kind==='other'&&['sourceMaxBytes','probeIntervalMs','bootGraceSeconds'].includes(spec.id)){
          report.discoveredConfig[spec.id]=spec.defaultValue;report.candidateSources[spec.id]='client-supported-default';report.candidateVerified[spec.id]=true;
        }
      }
      const entries=describe(kind).entries.filter(s=>!id||s.id===id),patch={};
      for(const row of entries)if(row.candidateVerified&&row.candidate!=null&&row.candidate!=='')patch[row.id]=row.candidate;
      return {patch,entries,report,applyStatus:'verified'};
    },
    apply(input){
      const previous=config,next=normalize(input);let pending=false;const effective={...(report.effectiveConfig||{})},status={...(report.entryStatus||{})};
      let canApplyMembers=false;try{canApplyMembers=!bridge.app?.run&&bridge.app?.starting!==true&&
        (typeof bridge.app?.meta?.hasPending!=='function'||bridge.app.meta.hasPending()===false);}catch{}
      if(canApplyMembers)activeMemberConfig={...next.interfaces};
      for(const spec of catalog.entries){
        const value=next[spec.kind][spec.id]??spec.defaultValue,prior=effective[spec.id]??spec.defaultValue;
        if(value===prior)continue;
        if(spec.kind==='other'&&(spec.type==='selector'||['probeIntervalMs','bootGraceSeconds'].includes(spec.id))){
          effective[spec.id]=value;status[spec.id]=spec.type==='selector'?'configured':'valid';continue;
        }
        if(spec.id.startsWith('symbols.')){
          const name=spec.id.slice(8),raw=value||report.discoveredConfig?.[spec.id],getter=registry[raw];
          let v;try{v=typeof getter==='function'?getter():null;}catch{}
          let busy=true,valid=false;try{busy=!!bridge.app?.run&&bridge.app.run.state!=='over'||bridge.app?.starting===true;valid=shape(name,v);}catch{}
          const proven=Array.isArray(report.verifiedRoleBindings?.[name])&&report.verifiedRoleBindings[name].includes(raw);
          if(!busy&&valid&&proven){bridge[name]=v;effective[spec.id]=raw;status[spec.id]='valid';
            report.sourceOptionalMissing=(report.sourceOptionalMissing||[]).filter(id=>id!==name);continue;}
        }
        pending=true;status[spec.id]='pending-current-document';
      }
      config=next;report=Object.assign(report,{effectiveConfig:effective,entryStatus:status});
      refresh(true);
      let deferredMembers=false;
      if(!canApplyMembers)for(const spec of catalog.entries.filter(row=>row.kind==='interfaces'&&row.owner&&row.logical))
        if(config.interfaces[spec.id]!==activeMemberConfig[spec.id]){deferredMembers=true;report.entryStatus[spec.id]='pending-current-document';report.entryReasons[spec.id]='正在保留当前对局与已绑定回调；在安全菜单重新应用或下一次载入时生效';}
      pending=deferredMembers||catalog.entries.some(spec=>{
        if(own(config[spec.kind],spec.id))return config[spec.kind][spec.id]!==report.effectiveConfig?.[spec.id];
        // Removing a manual override is also a real change. A busy document
        // must not claim that a deferred return to automatic has already applied.
        if(own(previous[spec.kind],spec.id))return (report.discoveredConfig?.[spec.id]??spec.defaultValue)!==report.effectiveConfig?.[spec.id];
        return false;
      });
      bridge.compatibilityConfig=config;bridge.compatibility=Object.assign(bridge.compatibility||{},report);globalThis.__PB_COMPATIBILITY=bridge.compatibility;
      return {report,entries:describe().entries,applyStatus:pending?'pending-current-document':'applied'};
    },
    resolveSelector(original){const id=selectorIDs.get(original);return id?(config.other[id]??original):original;},
    other(id,fallback){return config.other[id]??fallback;},
  };
  bridge.compatibilityConfig=config;
  return api;
}
// Reviewed 0.9.13 HoOh closures expose observations only. No native callback is
// executed by this transform or by the observation getters.
export function prepareNativeHoOhObservations(source,shape) {
  const base={code:source,present:false,ready:false,methods:[],missing:[]};
  if(typeof source!=='string'||typeof shape!=='function')return base;
  const index=nativeSyntaxIndex(source),owners=index.classes.filter(c=>
    ['rainbow','sunnyDay','sacredFire'].every(name=>index.methods.some(m=>m.owner===c.symbol&&m.name===name)));
  if(owners.length!==1)return {...base,missing:owners.length?['ho-oh-observation-owner']:[]};
  const owner=owners[0].symbol,methods=index.methods.filter(m=>m.owner===owner),edits=[],missing=[];
  const scope=(kind,until)=>`const __pbAttack={kind:${JSON.stringify(kind)},run:e,kit:this,index:this.i,generation:this.E.gen[this.i],begin:e.time,until:${until},rows:[]};this.__pbBossAttacks=(this.__pbBossAttacks||[]).filter(a=>a.run===e&&a.generation===this.E.gen[this.i]&&a.until>=e.time);this.__pbBossAttacks.push(__pbAttack);`;
  const specs=[{name:'rainbow',shape:'be10e478:d288991c:998',steps:[
    ['let e=this.run,t=k.range(0,Math.PI*2),n=Math.cos(t),r=Math.sin(t);',s=>s+scope('rainbow','e.time+.8+6*.55+96/13')],
    ['let i=k.range(-26,26),a=AP[t],o=.8+t*.55,s=-48,c=!1;',s=>s+'__pbAttack.rows.push({normalX:n,normalZ:r,gap:i,begin:e.time+o,until:e.time+o+96/13,speed:13,get front(){return s},get hit(){return c},groundAt:(x,z)=>this.groundY(x,z)});']
  ]},{name:'ultimate',shape:'9226b69e:3431ef2a:1722',steps:[
    ['return 1});e.animate(2,',s=>'return 1});let __pbProgress=0,__pbWindup=0,__pbHits=null,__pbActive=false,__pbDone=false;'+scope('spiral','e.time+4.6')+'Object.assign(__pbAttack,{activation:e.time+2,duration:2.6,pointAt:o,cutoffAt:index=>s[index],hitAt:index=>!!__pbHits?.[index],groundAt:(x,z)=>this.groundY(x,z),getProgress:()=>__pbProgress,getWindupProgress:()=>__pbWindup,isActive:()=>__pbActive,isDone:()=>__pbDone});e.animate(2,'],
    ['e.animate(2,r=>{if(!this.dead){',s=>'e.animate(2,r=>{__pbWindup=r;if(!this.dead){'],
    ['let t=Array(7).fill(!1);e.animate(2.6,n=>{',s=>'let t=Array(7).fill(!1);__pbHits=t;__pbActive=true;e.animate(2.6,n=>{__pbProgress=n;'],
    ['()=>{this.ultBusy=!1,this.fly()}',s=>'()=>{__pbActive=false;__pbDone=true;this.ultBusy=!1,this.fly()}']
  ]},{name:'hurricane',shape:'82f20464:488f511e:526',steps:[
    ['let e=this.run,t=this.target(),n=this.aimAt(t.x,t.z),r=Math.atan2(n.z,n.x);',s=>s+'let __pbTriggered=false;'+scope('gust-windup','e.time+2.1')+'Object.assign(__pbAttack,{activation:e.time+.8,angle:r,isTriggered:()=>__pbTriggered});'],
    ['e.later(.8,()=>{!this.dead',s=>'e.later(.8,()=>{__pbTriggered=true;!this.dead']
  ]},{name:'tick',shape:'3fffb29b:f282dd8f:4348',steps:[]}];
  // 0.9.22 changes the banner channel, RNG binding and rainbow palette only;
  // closure scheduling/geometry are unchanged (see native-0922-method-audit).
  const currentShapes={rainbow:'205e24df:c79e3031:1002',ultimate:'5d6ccef5:2821c8c7:1726',tick:'a5a8214f:c81f435b:4348'};
  const current=methods.some(m=>m.name==='rainbow'&&shape(source.slice(m.start,m.end))===currentShapes.rainbow);
  for(const spec of specs){const matches=methods.filter(m=>m.name===spec.name),method=matches[0];
    const expected=current?(currentShapes[spec.name]||spec.shape):spec.shape;
    let code=method&&source.slice(method.start,method.end),ok=matches.length===1&&shape(code)===expected;
    if(ok)for(const [original,replacement]of spec.steps){const needle=current?original.replaceAll('k.range','A.range').replaceAll('AP[t]','LP[t]'):original;const at=code.indexOf(needle);if(at<0||at!==code.lastIndexOf(needle)){ok=false;break;}code=code.slice(0,at)+replacement(needle)+code.slice(at+needle.length);}
    if(!ok)missing.push('ho-oh-'+spec.name+'-observation');else edits.push({start:method.start,end:method.end,code,name:spec.name,shape:expected});
  }
  if(missing.length)return {...base,present:true,missing};
  let code=source;for(const edit of edits.sort((a,b)=>b.start-a.start))code=code.slice(0,edit.start)+edit.code+code.slice(edit.end);
  return {code,present:true,ready:true,owner,methods:edits.map(({name,shape})=>({name,shape})),missing:[]};
}

// Reviewed 0.9.13 method contracts for the added maps and native rift flow.
const reviewedSeason3Mechanics=[{"biome":"canela","anchors":["tickLava","tickEruption"],"methods":{"tickLava":"7b603b24:e063110e:973","tickEruption":"d61a112b:44956c75:2193"}},{"biome":"canela","anchors":["skyDive","starArms"],"methods":{"tick":["d580e28c:ebd0a24a:4590","80462574:e8ee1bca:4590"],"land":["ac66fd40:dcbc7e42:899","9e123fc:301c6402:899"],"starSlam":"5b89b537:375f96e9:1831","starArms":"a8e1026c:513fa944:110"}},{"biome":"canela","anchors":["inLava","distToFissure"],"methods":{"inLava":"76be69be:d179cc6:127","tickArena":["eb4c20b1:5ddd9f0d:4498","622a70dc:ba692140:4502"]}},{"biome":"cave","anchors":["tickCollapse","tickCrystals"],"methods":{"tickCollapse":["ad8570dd:721284df:1634","32e2b2d7:3444d63f:1632"]}},{"biome":"cave","anchors":["tickBall","tickBlades"],"methods":{"tickBall":["7af8a023:ee755e1f:3242","dbbdde2e:d50b0dda:3242"],"tickBlades":["5da238bc:40836758:1067","b44e969a:2497a1a:1067"],"tickUlt":["cfdc988e:1e505fec:2575","871c073c:3a3204ae:2575"]}},{"biome":"cave","anchors":["raisePylons","dropOrb"],"methods":{"raisePylons":["68f1e09a:bad669ae:894","79118100:4dac961a:893"],"tickArena":["1d7b64a6:94ec29ba:3701","ba610f6d:ade74d59:3699"]}},{"biome":"encina","anchors":["enterPast","spawnClock"],"methods":{"openRift":["9c514813:6ccd7481:571","a91fbbb9:bb64b77:575"],"tickRift":["49f5a07a:8d222f24:798","5f488872:c3a563a4:798"],"enterPast":["8812fa43:c5565195:567","7f1fff51:8ab93ce3:571"],"spawnClock":["1aaf34db:d2dd9f75:613","bae7136a:717addee:613"],"clockAlive":"355f70d8:8962fee0:88","strand":["c181f11e:1eedd59e:743","c1f14995:d7e708dd:747"],"tick":["c549841e:1b8f999c:2729","358b2c04:730a6c92:2729"],"tickUlt":["1d620fff:1e2f10bb:896","3d73781a:c29002e0:896"]}},{"biome":"iris","anchors":["tickFlight","tickWake"],"methods":{"tickFlight":"85b90c45:d6372117:1528","tickBeast":["736e5a9d:631534e7:1355","d33a2de5:5c85fb85:1505"]}},{"biome":"iris","anchors":["rainbow","sunnyDay"],"methods":{"tick":["3fffb29b:f282dd8f:4348","a5a8214f:c81f435b:4348"]}},{"biome":"rifts","anchors":["nearEntrance","callAlpha","updatePulses"],"methods":{"enter":["65fe0680:2616d064:882","860921e4:e488a0a2:952"],"update":["5595d691:5a094f4b:1025","26e397e:1501026e:1170"],"updatePulses":"d1706a0d:e3982555:693","onAlphaDown":"585e1d76:396b0570:1178","fail":"6689640f:6779d607:361","enterBlock":["57f60586:5977611c:447","4e449536:f27e6f3c:520"],"spawnWave":["46cd8f46:b5306778:1216","ead8ec04:dfb1d0fe:1381"]}}];
export function inspectSeason3Mechanics(moduleSources,shape){
 const rows=(moduleSources||[]).filter(r=>typeof r.source==='string').map(r=>({...r,index:nativeSyntaxIndex(r.source)})),proofs=[];
 for(const profile of reviewedSeason3Mechanics){
  const owners=rows.flatMap(row=>row.index.classes.filter(c=>profile.anchors.every(name=>row.index.methods.some(m=>m.owner===c.symbol&&m.name===name))).map(c=>({row,owner:c.symbol})));
  const missing=[];
  if(owners.length!==1)missing.push('native-owner');
  else {
   const {row,owner}=owners[0],required={...profile.methods};
   // Wave-count rifts add a living-enemy scan and a different E dispatcher.
   // These methods are part of the new flow, not optional old-alpha aliases.
   if(profile.biome==='rifts'&&row.index.methods.some(m=>m.owner===owner&&m.name==='enter'&&shape(row.source.slice(m.start,m.end))==='860921e4:e488a0a2:952'))Object.assign(required,{scan:'66411303:22a29cb1:244',canCallWave:'da94b822:d80a0c56:110',callWaveNow:'266cbc98:8fac8970:87'});
   for(const [name,expected]of Object.entries(required)){const matches=row.index.methods.filter(m=>m.owner===owner&&m.name===name);if(matches.length!==1||![].concat(expected).includes(shape(row.source.slice(matches[0].start,matches[0].end))))missing.push(name);}
  }
  proofs.push({biome:profile.biome,ready:!missing.length,missing,moduleURL:owners.length===1?owners[0].row.url:null});
 }
 return {ready:proofs.every(p=>p.ready),proofs,biomes:Object.fromEntries(['canela','cave','encina','iris','rifts'].map(id=>[id,proofs.filter(p=>p.biome===id).every(p=>p.ready)]))};
}
