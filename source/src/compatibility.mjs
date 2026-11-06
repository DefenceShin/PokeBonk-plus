import { buildCompatibilityEditorCatalog, normalizeEditorOverrides, describeEditorOverrides, nativeSyntaxIndex, nativeMethodFeatures, matchNativeMethodFeatures, nativeOwnerIds, createNativeRuntimeEditor, absolutizeNativeModuleImports, discoverPublicModuleReferences, discoverNativeCaptureFeatures, nativeRoleOverrideVerified, nativeCompatSelector, prepareNativeHoOhObservations, inspectSeason3Mechanics } from './native-adaptation.mjs';
import { reviewedPublicSemanticProfiles } from './native-semantic-profiles.mjs';
// Shared by the Node runner and WebView2 host. No Node APIs, eval or account data.
// Asset hashes identify evidence; compatibility is decided by observed interfaces.
export function discoverPublicModules(source, baseURL) { return discoverPublicModuleReferences(source, baseURL); }
export function compatibilityEditorCatalog() {return buildCompatibilityEditorCatalog(reviewedNativeAliasOwners,reviewedNativeMemberProfiles);}
export function normalizeCompatibilityOverrides(value) {return normalizeEditorOverrides(value,compatibilityEditorCatalog());}
export function describeCompatibilityEditor(config,report=null,kind=null) {return describeEditorOverrides(config,report,kind,compatibilityEditorCatalog());}

export function checkLegacyBridgeContract(bridge, options = {}) {
  const missing = [];
  const optionalMissing = [];
  const warnings = [];
  const need = (ok, name) => { if (!ok) missing.push(name); };
  const fn = (value) => typeof value === "function";
  const object = (value) => value !== null && typeof value === "object";
  const list = (value, test) => Array.isArray(value) && value.length > 0 && value.every(test);
  const number = (value) => Number.isFinite(value);
  const capabilities = {};
  if (options.phase === "run") {
    const run = options.run ?? bridge?.app?.run;
    need(object(run), "run");
    need(typeof run?.state === "string", "run.state");
    need(fn(run?.update), "run.update");
    need(fn(run?.later), "run.later");
    need(fn(run?.finish), "run.finish");
    need(object(run?.stats), "run.stats");
    need(typeof run?.biome?.id === "string", "run.biome.id");
    need(object(run?.ui), "run.ui");
    need(number(run?.player?.pos?.x) && number(run?.player?.pos?.z), "run.player.pos");
    need(Array.isArray(run?.player?.moves), "run.player.moves");
    need(run?.enemies?.alive != null && typeof run.enemies.alive.length === "number", "run.enemies.alive");
    need(run?.projectiles?.flags != null && typeof run.projectiles.flags.length === "number", "run.projectiles.flags");
    need(fn(run?.terrain?.walkClear), "run.terrain.walkClear");
    need(fn(run?.vfx?.telegraph), "run.vfx.telegraph");
    need(fn(run?.vfx?.beams?.spawn), "run.vfx.beams.spawn");
    need(fn(run?.boss?.lineStrike), "run.boss.lineStrike");
    need(fn(run?.boss?.strike), "run.boss.strike");
    capabilities.combat = missing.length === 0;
    return { ok: missing.length === 0, level: missing.length ? "blocked" : "full", missing, optionalMissing, warnings, disabledFeatures: missing.length ? ["combat"] : [], capabilities };
  }
  const app = bridge?.app;
  need(object(app), "app");
  need(object(app?.meta), "app.meta");
  need(fn(app?.startRun), "app.startRun");
  need(fn(app?.meta?.endRun), "app.meta.endRun");
  need(fn(app?.meta?.hasPending), "app.meta.hasPending");
  need(object(app?.input), "app.input");
  need(fn(bridge?.data?.get), "data.get");
  need(fn(bridge?.data?.root), "data.root");
  need(list(bridge?.data?.pokemon, (entry) => Number.isInteger(entry?.id) && Array.isArray(entry.types)), "data.pokemon");
  need(fn(bridge?.data?.moves?.get) && fn(bridge?.data?.movesByKey?.get), "data.moves");
  need(list(bridge?.roster, (entry) => Number.isInteger(entry?.id) && Array.isArray(entry.kit)), "roster");
  need(list(bridge?.biomes, (entry) => typeof entry?.id === "string" && Array.isArray(entry.types)), "biomes");
  need(fn(bridge?.biomeLive), "biomeLive");
  const sourceMissing = bridge?.compatibility?.sourceOptionalMissing || [];
  const optional = (ok, name, feature, reason) => {
    if (ok && !sourceMissing.includes(name)) return true;
    optionalMissing.push(name);
    warnings.push({ code: "optional-interface-unavailable", feature, reason, missing: [name] });
    return false;
  };
  const lab = optional(list(bridge?.lab, (entry) => typeof entry?.id === "string" && number(entry.max) && fn(entry.cost)), "lab", "lab", "研究所定义未识别，已停用自动购买");
  const quests = optional(list(bridge?.quests, (entry) => entry?.id != null && typeof entry.counter === "string" && number(entry.goal)), "quests", "quests", "角色委托定义未识别，已停用对应自动领取");
  const labApi = optional(fn(app?.meta?.lab) && fn(app?.meta?.buyLab), "app.meta.lab", "lab", "研究所购买接口未识别，已停用自动购买");
  const questsApi = optional(fn(app?.meta?.questProgress) && fn(app?.meta?.claimQuest), "app.meta.quests", "quests", "角色委托进度或领取接口未识别，已停用对应自动领取");
  const tasks = optional(fn(app?.meta?.task) && fn(app?.meta?.claimTask), "app.meta.tasks", "tasks", "日常委托接口未识别，已停用对应自动规划和领取");
  const moveDef = optional(fn(bridge?.moveDef), "moveDef", "moveGuide", "招式目录解析未就绪，专属招式规划待适配");
  const moveGuide = optional(fn(bridge?.moveGuide), "moveGuide", "moveGuide", "招式指南接口未识别，专属招式规划待适配");
  const leagueApi = optional(fn(app?.meta?.inLeague), "app.meta.inLeague", "moveGuide", "角色拥有状态接口未识别，专属招式规划待适配");
  const fusionFor = optional(fn(bridge?.fusionFor), "fusionFor", "fusionPlanning", "原生融合匹配接口未识别，已停用最终融合规划");
  const fusionRecipes = optional(list(bridge?.fusionRecipes, entry => typeof entry?.key === "string" && ["signature", "reaction", "type", "glitch"].includes(entry.kind)), "fusionRecipes", "fusionPlanning", "原生融合配方目录未识别，已停用最终融合规划");
  const vitamins = optional(fn(bridge?.vitamins?.get) && fn(bridge?.vitamins?.values), "vitamins", "vitaminCatalog", "维生素目录未识别，实时数值评分不可用");
  const items = optional(fn(bridge?.items?.get) && fn(bridge?.items?.values), "items", "itemCatalog", "道具目录未识别，实时数值评分不可用");
  const rarity = optional(Array.isArray(bridge?.rarityMultipliers) && bridge.rarityMultipliers.length >= 5 && bridge.rarityMultipliers.every(number), "rarityMultipliers", "rarity", "稀有度数值未识别，实时稀有度评分不可用");
  if (bridge?.compatibility?.hasNativeMutation === true) {
    capabilities.mutation = optional(fn(bridge?.mutationToday) && fn(bridge?.mutationDefinition), "mutationToday", "mutation", "每日变异日程接口未识别，已停用该模式自动开局");
  }
  capabilities.catalog = !missing.some((name) => /^(data|roster|biomes)/.test(name));
  const objectiveApi = optional(fn(app?.meta?.leagueReady) && fn(app?.meta?.biomeTier), "app.meta.objectives", "objectives", "解锁目标接口未识别，角色和条件委托规划不可用");
  const shinyApi = optional(fn(bridge?.data?.hasSprite) && fn(bridge?.data?.hasAnimated), "data.shinySprites", "shiny", "异色资源接口未识别，异色目标模式不可用");
  Object.assign(capabilities, { lab: lab && labApi, quests: quests && questsApi, tasks, moveGuide: moveDef && moveGuide && leagueApi, fusionPlanning: moveDef && fusionFor && fusionRecipes, itemCatalog: items, vitaminCatalog: vitamins, rarity });
  capabilities.objectives = capabilities.catalog && objectiveApi;
  capabilities.shiny = capabilities.catalog && shinyApi;
  capabilities.control = missing.length === 0;
  const disabledFeatures = [...new Set(warnings.map((entry) => entry.feature))];
  return { ok: missing.length === 0, level: missing.length ? "blocked" : optionalMissing.length ? "degraded" : "full", missing, optionalMissing, warnings, disabledFeatures, capabilities };
}

export function checkBridgeContract(bridge, options = {}) {
  if(options.strict===true)return checkLegacyBridgeContract(bridge,options);
  let checked;try{checked=checkLegacyBridgeContract(bridge,options);}catch{checked={ok:false,missing:['interface-read-failed'],optionalMissing:[],warnings:[{code:'interface-read-failed',reason:'部分接口读取失败，按能力继续'}],capabilities:{}};}
  const read=(operation,fallback=null)=>{try{return operation();}catch{return fallback;}},
    fn=value=>typeof value==='function',object=value=>value!==null&&typeof value==='object',
    app=read(()=>bridge?.app),meta=read(()=>app?.meta),input=read(()=>app?.input),caps={...(checked.capabilities||{})};
  if(options.phase==='run'){
    const r=read(()=>options.run??app?.run),p=read(()=>r?.player),pos=read(()=>p?.pos),moves=read(()=>p?.moves);
    caps.movement=!!r&&read(()=>Number.isFinite(pos?.x)&&Number.isFinite(pos?.z),false)&&object(input);
    caps.choices=read(()=>object(r?.ui)&&Array.isArray(moves),false);
    caps.combat=read(()=>!!r&&fn(r.update)&&caps.movement&&Array.isArray(moves)&&
      r?.enemies?.alive!=null&&r?.projectiles?.flags!=null&&fn(r?.terrain?.walkClear)&&object(r.stats)&&typeof r?.biome?.id==='string',false);
    caps.interactions=read(()=>caps.combat&&!!r?.interactables,false);
    caps.settlement=read(()=>fn(r?.finish)&&fn(meta?.endRun)&&fn(meta?.hasPending),false);
    caps.control=read(()=>!!r&&fn(r.update)&&(caps.movement||caps.choices),false);
  }else{
    caps.control=object(app);caps.input=object(input);
    caps.catalog=read(()=>Array.isArray(bridge?.roster)&&bridge.roster.some(row=>Number.isInteger(row?.id))&&
      Array.isArray(bridge?.biomes)&&bridge.biomes.some(row=>typeof row?.id==='string')&&
      fn(bridge?.data?.get)&&fn(bridge?.data?.root)&&fn(bridge?.biomeLive),false);
    caps.menu=read(()=>object(meta)&&fn(app?.startRun)&&fn(meta?.endRun)&&fn(meta?.hasPending)&&caps.catalog===true,false);
    caps.saving=read(()=>fn(meta?.endRun)&&fn(meta?.hasPending),false);
  }
  const ok=caps.control===true,missing=[...(checked.missing||[])],optionalMissing=[...new Set([...(checked.optionalMissing||[]),...missing])];
  return {...checked,ok,missing,optionalMissing,capabilities:caps,level:ok?(optionalMissing.length?'degraded':'full'):'pending',
    disabledFeatures:[...new Set([...(checked.disabledFeatures||[]).filter(key=>caps[key]!==true),...Object.entries(caps).filter(([,v])=>v===false).map(([k])=>k)])],
    reason:optionalMissing.length?'部分接口尚未就绪，已启用的其他功能仍独立运行':null};
}

/**
 * Discover references through native, stable property names rather than emitted
 * identifier spelling. A single candidate is required for each semantic anchor.
 * This deliberately declines real API changes instead of guessing replacements.
 */
export function observeGameBoot(app, document = globalThis.document) {
  // Native boot exposes a loading bar, then creates input after data, fonts and
  // WebGL. Only observe those public boundaries; never inspect account/profile.
  let retry = false, progress = null;
  try {
    retry = !!document?.querySelector?.(nativeCompatSelector(".loading button.btn.big.red"));
    const transform = document?.querySelector?.(nativeCompatSelector(".loading .bar i"))?.style?.transform;
    const match = typeof transform === "string" && /^scaleX\(\s*(\d*\.?\d+)\s*\)$/.exec(transform);
    if (match && Number.isFinite(Number(match[1]))) progress = Math.max(0, Math.min(1, Number(match[1])));
  } catch { /* A DOM observation must not alter or reject the native boot. */ }
  return { stage: retry ? "native-retry" : app?.input ? "auth-loading" :
    app?.r || progress === 1 ? "graphics-wait" : "data-loading", progress };
}

// These exact public native helper fragments were audited as a read-only
// eligibility chain. They are comparison text only, never a copied RNG engine.
// An unknown chain exposes no menu getter until it has been reviewed again.
function reviewedNativeLegendaryHuntGate(source) {
  const contracts=[{"gate": "bC", "fragments": ["mC=[144,145,146,150,151]", "hC=e=>mC.includes(e)", "gC=.025", "_C=(e,t)=>{let n=e.hunt?.[t];return{k:Number.isFinite(n?.k)?Math.max(0,Math.floor(n.k)):0,m:Number.isFinite(n?.m)?Math.max(0,Math.floor(n.m)):0}}", "vC=e=>e>=45?1:Math.min(1,fn+gC*Math.max(0,e-12))", "function yC(e,t,n){let r=2166136261,i=`hunt|${e}|${t}|${n}`;for(let e=0;e<i.length;e++)r^=i.charCodeAt(e),r=Math.imul(r,16777619);return r^=r>>>15,r=Math.imul(r,739982445),r^=r>>>12,r=Math.imul(r,695872825),r^=r>>>15,(r>>>0)/4294967296}", "function bC(e,t,n){if(!t||!hC(n))return!1;let r=_C(e,n);return yC(t,n,r.k)<vC(r.m)}"]}, {"gate": "xC", "fragments": ["hC=[144,145,146,150,151]", "gC=e=>hC.includes(e)", "_C=.025", "vC=(e,t)=>{let n=e.hunt?.[t];return{k:Number.isFinite(n?.k)?Math.max(0,Math.floor(n.k)):0,m:Number.isFinite(n?.m)?Math.max(0,Math.floor(n.m)):0}}", "yC=e=>e>=45?1:Math.min(1,pn+_C*Math.max(0,e-12))", "function bC(e,t,n){let r=2166136261,i=`hunt|${e}|${t}|${n}`;for(let e=0;e<i.length;e++)r^=i.charCodeAt(e),r=Math.imul(r,16777619);return r^=r>>>15,r=Math.imul(r,739982445),r^=r>>>12,r=Math.imul(r,695872825),r^=r>>>15,(r>>>0)/4294967296}", "function xC(e,t,n){if(!t||!gC(n))return!1;let r=vC(e,n);return bC(t,n,r.k)<yC(r.m)}"]}];
  contracts.push({"gate":"LC","fragments":["jC=[144,145,146,150,151]","MC=e=>jC.includes(e)","NC=.025","PC=(e,t)=>{let n=e.hunt?.[t];return{k:Number.isFinite(n?.k)?Math.max(0,Math.floor(n.k)):0,m:Number.isFinite(n?.m)?Math.max(0,Math.floor(n.m)):0}}","FC=e=>e>=45?1:Math.min(1,mn+NC*Math.max(0,e-12))","function IC(e,t,n){let r=2166136261,i=`hunt|${e}|${t}|${n}`;for(let e=0;e<i.length;e++)r^=i.charCodeAt(e),r=Math.imul(r,16777619);return r^=r>>>15,r=Math.imul(r,739982445),r^=r>>>12,r=Math.imul(r,695872825),r^=r>>>15,(r>>>0)/4294967296}","function LC(e,t,n){if(!t||!MC(n))return!1;let r=PC(e,n);return IC(t,n,r.k)<FC(r.m)}"]});
  contracts.push({"gate": "UC", "fragments": ["LC=[144,145,146,150,151]", "zC=.025", "function UC(e,t,n){if(!t||!RC(n))return!1;let r=BC(e,n);return HC(t,n,r.k)<VC(r.m)}", "RC=e=>LC.includes(e)", "BC=(e,t)=>{let n=e.hunt?.[t];return{k:Number.isFinite(n?.k)?Math.max(0,Math.floor(n.k)):0,m:Number.isFinite(n?.m)?Math.max(0,Math.floor(n.m)):0}}", "function HC(e,t,n){let r=2166136261,i=`hunt|${e}|${t}|${n}`;for(let e=0;e<i.length;e++)r^=i.charCodeAt(e),r=Math.imul(r,16777619);return r^=r>>>15,r=Math.imul(r,739982445),r^=r>>>12,r=Math.imul(r,695872825),r^=r>>>15,(r>>>0)/4294967296}", "VC=e=>e>=45?1:Math.min(1,mn+zC*Math.max(0,e-12))"]});
  return contracts.find(contract=>contract.fragments.every(fragment=>source.includes(fragment)))?.gate??null;
}

// Reviewed public083 native member contracts. Original game definitions are
// not rewritten: aliases only preserve helper-facing names and receiver identity.
const reviewedNativeMemberProfiles = [{"name":"hasType","kind":"method","shape":"5c254371:ef83e661:109"},{"name":"typesOf","kind":"method","shape":"b403e2c3:94f901b3:114"},{"name":"addWeight","kind":"method","shape":"73e7e702:7f7e6128:151"},{"name":"spawnProxy","kind":"method","shape":"54af7c32:7a275078:1465"},{"name":"isAlive","kind":"method","shape":"c3e3f8d8:93ee03ac:53"},{"name":"updateProxy","kind":"method","shape":"abdf6615:97df5531:1164"},{"name":"parked","kind":"method","shape":"dcfabe45:c61eaeb7:131"},{"name":"enemyShot","kind":"method","shape":"6f74e5e5:8538a219:310"},{"name":"fromBody","kind":"method","shape":"231e9bf:5f84ba47:173"},{"name":"clearHostile","kind":"method","shape":"6e90cda8:8930db16:159"},{"name":"boomFx","kind":"method","shape":"66db9927:be5f1cfb:278"},{"name":"nextBounce","kind":"method","shape":"5c343841:c5b6103b:204"},{"name":"alreadyHit","kind":"method","shape":"bb91efcc:4668902e:99"},{"name":"markHit","kind":"method","shape":"9660903f:6e820273:54"},{"name":"spawnXp","kind":"method","shape":"89cf47cc:f6bb9212:29"},{"name":"spawnCoin","kind":"method","shape":"ca8b346b:b71996d3:29"},{"name":"spawnMerged","kind":"method","shape":"9945b8a:9d3a7ce6:546"},{"name":"consolidate","kind":"method","shape":"3f35796a:96fa60fe:469"},{"name":"capHit","kind":"method","shape":"4c33d338:e7df5b7e:159"},{"name":"itemProcs","kind":"method","shape":"a315ac1:5fe0edcf:789"},{"name":"statusCount","kind":"method","shape":"5001550f:78c9115:190"},{"name":"resist","kind":"method","shape":"1d9595c7:d48c8bed:68"},{"name":"countOnce","kind":"method","shape":"59634d71:8d04c97:90"},{"name":"applyStatus","kind":"method","shape":"fb240768:156696e0:1323"},{"name":"fxFrame","kind":"method","shape":"496e271:84a45def:92"},{"name":"statusFx","kind":"method","shape":"496a5c52:99029c08:155"},{"name":"tickStatus","kind":"method","shape":"b7c18dbe:5b32edc4:2235"},{"name":"enemySupport","kind":"method","shape":"61ea3f6d:a8bfed45:647"},{"name":"killEnemy","kind":"method","shape":"13a602d6:210a6138:685"},{"name":"takeHp","kind":"method","shape":"2285a01c:156580c4:218"},{"name":"remoteHit","kind":"method","shape":"b6cbf5c9:3533c2bb:704"},{"name":"eliteBurst","kind":"method","shape":"ee259bd7:8f3600b:551"},{"name":"creditRemote","kind":"method","shape":"3f9d9368:19345b38:343"},{"name":"deathFx","kind":"method","shape":"ca581b56:6777c578:163"},{"name":"growthStage","kind":"method","shape":"4fd0203c:7b298204:65"},{"name":"checkGrowth","kind":"method","shape":"3e2a9e68:92fdf376:356"},{"name":"baseBlock","kind":"method","shape":"e355db3d:acbda935:71"},{"name":"refreshScaling","kind":"method","shape":"f8d2efac:7a2313d2:214"},{"name":"abilityName","kind":"get","shape":"1ded3556:902745dc:99"},{"name":"setSpecies","kind":"method","shape":"4c39a174:5b904bf2:188"},{"name":"rescue","kind":"method","shape":"1d6db6ab:2d4ae0bf:709"},{"name":"addMove","kind":"method","shape":"a4a34cc3:e6feed:125"},{"name":"forgetMove","kind":"method","shape":"b51f2ea:3838a724:170"},{"name":"hasMove","kind":"method","shape":"5977cc20:5ad2b652:45"},{"name":"ownedMoveIds","kind":"method","shape":"cbb3d4d7:bcc04abd:94"},{"name":"addVitamin","kind":"method","shape":"deba5c91:16e98557:600"},{"name":"moveCap","kind":"get","shape":"480c35f8:a584adf0:47"},{"name":"capOf","kind":"method","shape":"e0474736:20831a84:62"},{"name":"vitCap","kind":"get","shape":"2824d6a8:385b6e3e:50"},{"name":"canHold","kind":"method","shape":"d9f4dfae:b88a264e:54"},{"name":"addItem","kind":"method","shape":"492acc8:f2cb89fe:343"},{"name":"addBuff","kind":"method","shape":"94856ba8:36a5b93c:62"},{"name":"bonusDamageMult","kind":"method","shape":"4f63e472:8de5bec:27"},{"name":"eachDamagePart","kind":"method","shape":"53622e62:9b663c2:822"},{"name":"bikeBonus","kind":"method","shape":"d1265b11:f5a70b67:71"},{"name":"rageBonus","kind":"method","shape":"48349aeb:90fc5e5f:47"},{"name":"coinBonus","kind":"method","shape":"e26c9560:36298d42:43"},{"name":"addHeadache","kind":"method","shape":"413276c0:4a4a3ea:623"},{"name":"xpFor","kind":"method","shape":"52bc01a3:b3515c93:51"},{"name":"gainLevel","kind":"method","shape":"f76dde9b:a5e17a21:109"},{"name":"leech","kind":"method","shape":"e9f525cb:823fd80d:92"},{"name":"stopTime","kind":"method","shape":"b326ac5:e2b36b5:410"},{"name":"rebirth","kind":"method","shape":"476be7b0:71f5dcdc:521"},{"name":"sunbeam","kind":"method","shape":"47c38e97:69ec77cd:564"},{"name":"buildItems","kind":"method","shape":"a2e1358f:5b529ad9:1705"},{"name":"scopeMul","kind":"method","shape":"d7aeea81:57fbf28b:86"},{"name":"onUltimate","kind":"method","shape":"3698c278:955106a4:126"},{"name":"statusFx","kind":"method","shape":"cfb3fa23:a708f4cd:699"},{"name":"iceSpray","kind":"method","shape":"6691fadb:71c4be91:395"},{"name":"waterFx","kind":"method","shape":"899eaced:17f4b14b:962"},{"name":"iceFx","kind":"method","shape":"e08cc184:30151fd4:871"},{"name":"dragonDive","kind":"method","shape":"87bd486f:24c57349:526"},{"name":"attackAnim","kind":"method","shape":"e8e0007c:3b39d852:39"},{"name":"hordeWeight","kind":"get","shape":"84b8d479:129a3673:34"},{"name":"buildPool","kind":"method","shape":"37d61d82:30e4ae02:719"},{"name":"onPhase","kind":"method","shape":"54a4f715:e4d6fd8b:31"},{"name":"addCard","kind":"method","shape":"eac19538:ff0af6c8:585"},{"name":"effTime","kind":"method","shape":"141b6230:1cc941e0:174"},{"name":"curveMin","kind":"method","shape":"9f9dee77:f4670f29:58"},{"name":"hpCurve","kind":"method","shape":"73f3cc01:c3700347:121"},{"name":"swarmMult","kind":"method","shape":"bbfce791:3f44de13:76"},{"name":"toughness","kind":"method","shape":"6ee82d1b:30acd96b:44"},{"name":"speedMult","kind":"method","shape":"aff9203e:d7edb918:252"},{"name":"spawnPoint","kind":"method","shape":"389249ee:5ff985f8:369"},{"name":"spend","kind":"method","shape":"c67ba45b:c950b4f7:239"},{"name":"spawnCard","kind":"method","shape":"3647c717:3d331e47:475"},{"name":"updateEndless","kind":"method","shape":"bc469101:17dea5eb:708"},{"name":"rockRain","kind":"method","shape":"ae3101e5:3db6b479:965"},{"name":"startFinalSwarm","kind":"method","shape":"9743c794:bd9070a4:186"},{"name":"onPhase","kind":"method","shape":"7e4adf46:4d6a7868:219"},{"name":"onPhase","kind":"method","shape":"cb5de579:55779be7:106"},{"name":"onPhase","kind":"method","shape":"53af1d2f:6dfecf1b:106"},{"name":"onPhase","kind":"method","shape":"226985e6:ea65910c:161"},{"name":"onPhase","kind":"method","shape":"a24dbc2f:23ef2981:325"},{"name":"onPhase","kind":"method","shape":"8cafd4d3:dba5fdf9:433"},{"name":"onPhase","kind":"method","shape":"992ef879:98723581:477"},{"name":"onPhase","kind":"method","shape":"ae61c63a:21ffc27a:402"},{"name":"onPhase","kind":"method","shape":"1449d1a3:491a90e9:403"},{"name":"onPhase","kind":"method","shape":"3f07611:69f1f615:131"},{"name":"onPhase","kind":"method","shape":"a0bdb53a:189e9d22:120"},{"name":"keepLive","kind":"method","shape":"49a5d2c4:e84b367e:729"},{"name":"onMilestoneKilled","kind":"method","shape":"de13a3e0:322d8562:120"},{"name":"spawnPoint","kind":"method","shape":"5f3741:30b76fcf:379"},{"name":"enemyNear","kind":"method","shape":"829d6b82:90e93ed2:89"},{"name":"onHurt","kind":"method","shape":"ff0741c:d19bbee8:21"},{"name":"enterPortal","kind":"method","shape":"a2f14ea2:12030c5c:354"},{"name":"wallSecs","kind":"method","shape":"d2366189:8bed8779:36"},{"name":"shopHeat","kind":"get","shape":"ed874158:e64d150c:119"},{"name":"whereLabel","kind":"method","shape":"287f5b17:cad12dd7:169"},{"name":"logAltar","kind":"method","shape":"cc31a0b2:cb24d16a:167"},{"name":"enemyCap","kind":"get","shape":"5ae284cf:1bb2bc25:75"},{"name":"musicFor","kind":"method","shape":"d63b8ba5:8139a6d1:81"},{"name":"openResumed","kind":"method","shape":"6b43bdde:ce64c712:499"},{"name":"saveBlock","kind":"method","shape":"dfe3bea5:5a0eaaaf:18"},{"name":"saveAndQuit","kind":"method","shape":"58814cfe:51784624:685"},{"name":"openStage","kind":"method","shape":"833e9b8:5111170:363"},{"name":"stageSprites","kind":"method","shape":"9b33ed5:cc359e41:741"},{"name":"bossPools","kind":"method","shape":"3fbc3ba3:58925351:280"},{"name":"applyBoosts","kind":"method","shape":"3aaf1e95:427f4f1:462"},{"name":"useMasterBall","kind":"method","shape":"23e29162:ad9428c8:87"},{"name":"planEvolution","kind":"method","shape":"62f79af:8a97898f:344"},{"name":"whenFree","kind":"method","shape":"c73f471e:e917d066:119"},{"name":"stepAnims","kind":"method","shape":"4ead748a:72ba8140:219"},{"name":"hitstop","kind":"method","shape":"585d6d6a:7daba2c8:42"},{"name":"addGold","kind":"method","shape":"93e7b108:e646aa00:84"},{"name":"spawnChestAt","kind":"method","shape":"1c0d9725:f6021bb:83"},{"name":"queueLevelUp","kind":"method","shape":"114f6f89:abfdc2b9:46"},{"name":"queueBlessing","kind":"method","shape":"d06560aa:bd566eb4:74"},{"name":"auraRing","kind":"method","shape":"7cb1b3cc:93a2e89a:47"},{"name":"altarRing","kind":"method","shape":"98c11e7e:2367da42:248"},{"name":"ghostDash","kind":"method","shape":"828b5edd:c37214a7:425"},{"name":"setCine","kind":"method","shape":"b9fe88a3:b163ee23:46"},{"name":"endCine","kind":"method","shape":"e101c5b0:efec6ba4:21"},{"name":"captureCam","kind":"method","shape":"51727514:d002af74:71"},{"name":"captureZoom","kind":"method","shape":"2d326344:d3d479b2:22"},{"name":"captureFocus","kind":"method","shape":"16981d67:64231499:49"},{"name":"endCaptureCam","kind":"method","shape":"21333f75:fd8c03dd:67"},{"name":"beginCapture","kind":"method","shape":"6f40130f:a612486d:274"},{"name":"endCapture","kind":"method","shape":"8deb3b10:fee3a7e6:272"},{"name":"clearCaptureView","kind":"method","shape":"58cbc362:b1850f28:378"},{"name":"introBoss","kind":"method","shape":"93b7c015:88708c7d:799"},{"name":"setBaseWeather","kind":"method","shape":"89a9049c:17f1232a:68"},{"name":"setWeather","kind":"method","shape":"c2a373f0:b470df14:245"},{"name":"applyWeatherLook","kind":"method","shape":"43c9ec76:d8b2126c:639"},{"name":"ultLook","kind":"method","shape":"cd0dc778:91cf28d4:63"},{"name":"ultAtmos","kind":"method","shape":"3a845b44:2943f686:184"},{"name":"revived","kind":"method","shape":"aa935101:6dad7e0b:758"},{"name":"reborn","kind":"method","shape":"32b60db4:d3ed50bc:267"},{"name":"aimTarget","kind":"method","shape":"ae962a35:2059678b:791"},{"name":"aimDir","kind":"method","shape":"b0478263:355dd8f:589"},{"name":"toggleLock","kind":"method","shape":"339a83d4:7dcbce68:595"},{"name":"spawnLegendary","kind":"method","shape":"a60c3ce1:3040b69b:340"},{"name":"unstick","kind":"method","shape":"feb3e2ea:eea10b54:357"},{"name":"debugMewtwo","kind":"method","shape":"b87868ab:1ce2959b:91"},{"name":"warpSanctuary","kind":"method","shape":"61611b3:1651422d:101"},{"name":"rollBonk","kind":"method","shape":"f74bbeaa:75571a1a:213"},{"name":"onMilestoneKilled","kind":"method","shape":"809489b6:c4899536:759"},{"name":"enterPortal","kind":"method","shape":"aac673e5:b1cbf0d1:1117"},{"name":"coopAdvance","kind":"method","shape":"df60f616:fc2ccc20:571"},{"name":"changeZone","kind":"method","shape":"168cab84:f67372a:845"},{"name":"onPlayerDeath","kind":"method","shape":"db088b9d:521ce267:413"},{"name":"keepLive","kind":"method","shape":"a1048a46:c49fcd80:179"},{"name":"evoReady","kind":"method","shape":"1fd7d192:22758564:92"},{"name":"tryEvolve","kind":"method","shape":"f2058295:30a93949:277"},{"name":"train","kind":"method","shape":"a839c0d:63793615:474"},{"name":"startEvolution","kind":"method","shape":"1ef5d1a8:481cda18:2825"},{"name":"openMap","kind":"method","shape":"e85f1bfb:eeb2fe45:111"},{"name":"rollChestItem","kind":"method","shape":"d348a146:5a13d79e:916"},{"name":"openShop","kind":"method","shape":"71df239c:af5d2a6c:233"},{"name":"rerollCost","kind":"method","shape":"fbcc0440:776f92da:116"},{"name":"rerollShop","kind":"method","shape":"9bbb0465:df153b99:168"},{"name":"buyShopItem","kind":"method","shape":"d2c0794d:bf352a19:210"},{"name":"openDitto","kind":"method","shape":"2f3cd3ba:41b80e50:188"},{"name":"openFossil","kind":"method","shape":"fb1829e6:f1c7d688:260"},{"name":"openPorygon","kind":"method","shape":"e7f6f861:d18fed5b:288"},{"name":"openSlots","kind":"method","shape":"afce976a:b2f35b14:216"},{"name":"openForget","kind":"method","shape":"2b68cd6e:2f25e96a:66"},{"name":"offerBlessing","kind":"method","shape":"d5aba259:b94ffedf:382"},{"name":"setHordeQuality","kind":"method","shape":"f5f24a25:44d23611:149"},{"name":"governHorde","kind":"method","shape":"84d8b524:9186e6d0:605"},{"name":"weatherFx","kind":"method","shape":"17260131:ef0a26e5:1304"},{"name":"zoneMotes","kind":"method","shape":"6671db17:a8eee2e5:1855"},{"name":"renderWorld","kind":"method","shape":"2db48289:a71f5e7:705"},{"name":"keepLive","kind":"method","shape":"aa14da5c:894b91da:105"},{"name":"shinyFlash","kind":"method","shape":"bb42526a:b1ce314c:173"},{"name":"reviveFlash","kind":"method","shape":"94ab9cf0:15b5e8e4:153"},{"name":"ultCutIn","kind":"method","shape":"14ed4df9:7f3856ef:332"},{"name":"captureStart","kind":"method","shape":"5c8507b4:9de09378:741"},{"name":"captureShake","kind":"method","shape":"6a0bf30e:af6b0594:77"},{"name":"captureResult","kind":"method","shape":"f1462135:126967c1:175"},{"name":"captureEnd","kind":"method","shape":"f387ab65:17228915:127"},{"name":"stageIntro","kind":"method","shape":"6832ad5d:987fc661:1307"},{"name":"damageFlash","kind":"method","shape":"5220f719:51d5bc09:87"},{"name":"setPrompt","kind":"method","shape":"2931c207:7cf674f:271"},{"name":"hideModal","kind":"method","shape":"6ee66a92:22614088:69"},{"name":"hasModal","kind":"method","shape":"dba50084:1781a9b6:38"},{"name":"showEvolution","kind":"method","shape":"470aa22a:38930e36:341"},{"name":"bossIntro","kind":"method","shape":"276b41df:db1272cb:559"},{"name":"endCinematic","kind":"method","shape":"eaf55292:eaec86a4:94"},{"name":"evolutionReveal","kind":"method","shape":"f085e21:96ffbabd:643"},{"name":"pauseEsc","kind":"method","shape":"73eebcf4:4a7057aa:44"},{"name":"showSummary","kind":"method","shape":"cf98df43:f3b1847b:7240"},{"name":"showFusion","kind":"method","shape":"ac981f9d:cd41c481:2071"},{"name":"showPause","kind":"method","shape":"7393b999:22813a31:11286"}];
const reviewedNativeAliasOwners = [{"markers":["hit","groupHit","flushGroup","hit0","strike","itemDmg","canReact","react"],"members":["eliteBurst"]},{"markers":["recompute","removeItem","damageParts","addXp","heal","wound","shove","hurt"],"members":["rescue","forgetMove","capOf","vitCap","canHold","rageBonus","rebirth"]},{"markers":["upcoming","everyone","hpMult","danger","dmgMult","caps","full","update"],"members":["buildPool"]},{"markers":["isBossMirror","isProxy","active","tick","bubbleTick","bubbled","auditBubbles","bubbleFx"],"members":["enterPortal"]},{"markers":["itemInPool","buildStage","asGhost","later","animate","cry","shake","slash"],"members":["addGold","aimTarget","enterPortal","openMap","rollChestItem","rerollCost","rerollShop","offerBlessing"]},{"markers":["destroy","hpText","look","project","popup","streakHud","trained","placeToasts"],"members":["reviveFlash","hideModal","showFusion","showPause"]}];

// Source-only token fingerprint: preserve literals/operators/control flow while
// ignoring emitted identifier spelling. It never executes native simulation.
// Reviewed 0.9.8 damageParts collector and Bill modal delegate.
// 0.9.13 preserves the native multiplier collector; accumulator spelling no longer equals keyword 'of'.
reviewedNativeMemberProfiles.push({name:'rageBonus',kind:'method',shape:'385a68ba:8dda85c:27'},
  {name:'rageBonus',kind:'method',shape:'fd137985:a29f61ad:28'},
  {name:'showFusion',kind:'method',shape:'19c7636a:a71a572c:212'},
  {name:'buildPool',kind:'method',shape:'49d727f1:4e8be2f7:893'});
export function nativeMemberShape(source) {
  const keywords = new Set('return throw if else let const var new this super typeof instanceof in of for while do switch case default break continue try catch finally function async await yield delete void true false null undefined get set static'.split(' '));
  source=String(source);const ranges=[];nativeLiteralMask(source,ranges);
  const tokens=[];let rangeIndex=0;
  for(const match of source.matchAll(/[A-Za-z_$][\w$]*|0x[\da-f]+|\d*\.?\d+(?:e[+-]?\d+)?|\s+|./gi)){
    while(ranges[rangeIndex]?.end<=match.index)rangeIndex++;
    const range=ranges[rangeIndex];if(range&&range.start<=match.index&&match.index<range.end){if(match.index===range.start&&range.kind==='literal')tokens.push(source.slice(range.start,range.end));continue;}
    if(!/^\s+$/.test(match[0]))tokens.push(match[0]);
  }
  let a=2166136261,b=5381,length=0,previous=null;
  for (let index=0;index<tokens.length;index++) {let token=tokens[index];
    if (/^\s+$/.test(token)||token.startsWith('/*')||token.startsWith('//')) continue;
    const next=tokens.slice(index+1).find(value=>!/^\s+$/.test(value));
    if (/^[A-Za-z_$][\w$]*$/.test(token) && !keywords.has(token) &&
      (token.startsWith('$') || previous!=='.' && !([':',',','}'].includes(next)&&['{',','].includes(previous)))) token='@';
    for(let i=0;i<token.length;i++){const c=token.charCodeAt(i);a=Math.imul(a^c,16777619);b=Math.imul(b,33)^c;length++;}
    previous=tokens[index];
  }
  return (a>>>0).toString(16)+':'+(b>>>0).toString(16)+':'+length;
}

function nativeLiteralMask(source,ranges=null) {
  const mask=new Uint8Array(source.length),parentheses=[];let previous='';
  const mark=(start,end,kind)=>{mask.fill(1,start,end);ranges?.push({start,end,kind});};
  const quoteEnd=(at,quote)=>{for(let i=at+1;i<source.length;i++){if(source[i]==='\\'){i++;continue;}if(source[i]===quote)return i+1;if(quote==='`'&&source[i]==='$'&&source[i+1]==='{'){const end=coverageBraceEnd(source,i+1);if(end<0)return source.length;i=end-1;}}return source.length;};
  for(let i=0;i<source.length;){const start=i,c=source[i],next=source[i+1];
    // An arrow may return a regexp directly. Its escaped slash and closing
    // delimiter must be consumed as part of the regexp, not as a // comment.
    if(c==='='&&next==='>'){previous='arrow';i+=2;continue;}
    if(c==='"'||c==="'"||c==='`'){i=quoteEnd(i,c);mark(start,i,'literal');previous='literal';continue;}
    if(c==='/'&&next==='/'){const end=source.indexOf('\n',i+2);i=end<0?source.length:end+1;mark(start,i,'comment');continue;}
    if(c==='/'&&next==='*'){const end=source.indexOf('*/',i+2);i=end<0?source.length:end+2;mark(start,i,'comment');continue;}
    if(c==='/'&&(!previous||/^[=(:,[!&|?;{}]$/.test(previous)||['return','throw','case','yield','else','do','control-close','arrow'].includes(previous))){let inClass=false;i++;for(;i<source.length;i++){if(source[i]==='\\'){i++;continue;}if(source[i]==='[')inClass=true;else if(source[i]===']')inClass=false;else if(source[i]==='/'&&!inClass){i++;while(/[a-z]/i.test(source[i]||'')&&i<source.length)i++;break;}}mark(start,i,'literal');previous='literal';continue;}
    if(/[A-Za-z_$]/.test(c)){let end=i+1;while(/[\w$]/.test(source[end]||'')&&end<source.length)end++;previous=source.slice(i,end);i=end;continue;}
    if(c==='(')parentheses.push(['if','while','for','with','switch','catch'].includes(previous));
    if(c===')')previous=parentheses.pop()?'control-close':')';else if(!/\s/.test(c))previous=c;i++;
  }
  return mask;
}
export function prepareNativeMemberAliases(source, profiles = reviewedNativeMemberProfiles, options = {}) {
  const literalMask=nativeLiteralMask(source);
  const shapes=new Map(), proof=[];
  for(const profile of profiles) {
    const list=shapes.get(profile.shape)||[];list.push(profile);shapes.set(profile.shape,list);
  }
  const aliases=new Map(), definitions=[];
  for(const head of source.matchAll(/(?<![\w$])(?:async\s+)?(?:(get|set)\s+)?(\$[A-Za-z0-9_$]+)\s*\([^)]*\)\s*\{/g)) {
    if(literalMask[head.index])continue;
    const end=coverageBraceEnd(source,head.index+head[0].lastIndexOf('{'));if(end<0)continue;
    const shape=nativeMemberShape(source.slice(head.index,end)),matches=(shapes.get(shape)||[]).filter(row=>row.kind===(head[1]||'method'));
    const names=[...new Set(matches.map(row=>row.name))];if(names.length!==1)continue;
    const logical=names[0],actual=head[2];
    if(aliases.has(actual)&&aliases.get(actual)!==logical){if(options.partial)continue;throw Error('Ambiguous native member semantic role');}
    aliases.set(actual,logical);definitions.push({logical,actual,kind:head[1]||'method',start:head.index,end,shape});
  }
  const unresolved=[],directNativeMembers=[],optionalUnavailable=[];
  let syntax=null;
  if(options.partial){
    try{syntax=nativeSyntaxIndex(source);}catch(error){unresolved.push({code:'source-syntax-unrecognized',reason:String(error.message).slice(0,160)});}
    if(syntax)for(const profile of reviewedPublicSemanticProfiles){
      if(definitions.some(row=>row.logical===profile.name&&row.shape===profile.shape))continue;
      const ownerCandidates=syntax.classes.filter(owner=>{const names=new Set(owner.methods.map(m=>m.key.name));
        const matches=profile.ownerMarkers.filter(name=>names.has(name)).length;
        return profile.ownerMarkers.length>=3&&matches>=Math.min(profile.ownerMarkers.length,4)&&matches/profile.ownerMarkers.length>=.75;});
      if(ownerCandidates.length!==1)continue;
      const possible=syntax.methods.filter(row=>row.owner===ownerCandidates[0].symbol&&row.kind===profile.kind&&row.name.startsWith('$')&&!aliases.has(row.name)),
        candidate=matchNativeMethodFeatures(profile.features,possible);
      if(!candidate)continue;
      aliases.set(candidate.name,profile.name);definitions.push({logical:profile.name,actual:candidate.name,kind:profile.kind,start:candidate.start,end:candidate.end,
        shape:nativeMemberShape(source.slice(candidate.start,candidate.end)),match:'ast-semantic',confidence:candidate.score});
    }
  }
  const groups=[];
  for(const [ownerIndex,spec] of reviewedNativeAliasOwners.entries()) {
    const candidates=[];
    for(const match of source.matchAll(/\bclass(?:\s+[A-Za-z_$][\w$]*)?(?:\s+extends\s+[A-Za-z_$][\w$.]*)?\s*\{/g)) {
      if(literalMask[match.index])continue;
      const opening=match.index+match[0].lastIndexOf('{'),end=coverageBraceEnd(source,opening);if(end<0)continue;
      const prefix=source.slice(Math.max(0,match.index-100),match.index),symbol=/([A-Za-z_$][\w$]*)\s*=\s*$/.exec(prefix)?.[1];
      if(!symbol)continue;const body=source.slice(opening,end);
      if(!spec.markers.every(key=>new RegExp('(?<![\\w$])'+key+'\\s*\\([^)]*\\)\\s*\\{').test(body)))continue;
      const members=spec.members.map(name=>definitions.filter(row=>row.logical===name&&row.start>opening&&row.end<=end));
      if(options.partial){
        const selected=[];
        for(let i=0;i<spec.members.length;i++){
          const name=spec.members[i],override=options.overrides?.interfaces?.[`members.${nativeOwnerIds[ownerIndex]}.${name}`],
            method=override&&syntax?.methods.filter(row=>row.owner===symbol&&row.name===override);
          if(override&&method?.length===1&&method[0].kind===(profiles.find(row=>row.name===name)?.kind||'method')){const row=method[0];selected.push({logical:name,actual:override,kind:row.kind,start:row.start,end:row.end,match:'manual'});aliases.set(override,name);}
          else if(members[i].length===1)selected.push(members[i][0]);
          else {
            // Older native releases already expose these logical names. An
            // owner-local, kind-matching real method/getter needs no alias.
            // Recording it as missing would falsely degrade a complete old
            // source; installing a self-alias would recurse into its getter.
            const kind=profiles.find(row=>row.name===name)?.kind||'method',
              direct=syntax?.methods.filter(row=>row.owner===symbol&&row.name===name&&row.kind===kind)||[];
            if(direct.length===1){const row=direct[0];directNativeMembers.push({ownerId:nativeOwnerIds[ownerIndex],owner:symbol,
              logical:name,actual:name,kind,start:row.start,end:row.end,match:'direct-native',aliasInstalled:false});}
            else {
              const owner=syntax?.classes.find(row=>row.symbol===symbol),
                plainOwner=owner&&!owner.methods.some(method=>method.key.name.startsWith('$')),
                ownName=owner?.node.body.body.some(member=>!member.computed&&member.key?.name===name),
                sourceName=syntax?.methods.some(method=>method.name===name&&method.kind===kind);
              if(plainOwner&&!ownName&&!sourceName)optionalUnavailable.push({code:'direct-not-present',ownerId:nativeOwnerIds[ownerIndex],
                owner:symbol,logical:name,kind,id:`members.${nativeOwnerIds[ownerIndex]}.${name}`,aliasInstalled:false,
                reason:'此原名版本未提供该后续可选成员；没有伪造方法或能力，运行时仍按实际成员单独核验'});
              else unresolved.push({code:'native-member-unavailable',id:`members.${nativeOwnerIds[ownerIndex]}.${name}`,reason:'未找到唯一的原生方法；其余已确认方法保持可用'});
            }
          }
        }
        candidates.push({symbol,members:selected});
      }else if(members.every(rows=>rows.length===1))candidates.push({symbol,members:members.map(rows=>rows[0])});
    }
    if(candidates.length>1){if(options.partial){unresolved.push({code:'native-owner-ambiguous',owner:nativeOwnerIds[ownerIndex]});continue;}throw Error('Ambiguous native class semantic role');}
    // Historical non-obfuscated sources need no compatibility descriptors.
    if(candidates.length===1)groups.push(options.partial?{...candidates[0],ownerId:nativeOwnerIds[ownerIndex]}:candidates[0]);
    else if(options.partial&&candidates.length===0){
      if(syntax?.methods.some(method=>method.name.startsWith('$')))unresolved.push({code:'native-owner-unavailable',owner:nativeOwnerIds[ownerIndex],
        reason:'当前混淆成员仍需映射，但未找到唯一的原生所属类；仅保留其余已确认类，不声称完整识别'});
      else optionalUnavailable.push({code:'direct-owner-not-required',ownerId:nativeOwnerIds[ownerIndex],aliasInstalled:false,
        reason:'此原名版本无需该混淆类映射；没有推断额外成员或能力'});
    }
  }
  if(!options.partial&&aliases.size && groups.length!==reviewedNativeAliasOwners.length)throw Error('Required native alias owner contract is incomplete');
  // This is an analysis view only. Returned executable game text remains
  // byte-for-byte unchanged outside the original single bootstrap expression.
  const analysis=source.replace(/\$[A-Za-z0-9_$]+/g,(token,index)=>literalMask[index]?token:(aliases.get(token)||token));
  return {analysis,groups,aliases:Object.fromEntries(aliases),proof:definitions,unresolved,directNativeMembers,optionalUnavailable,syntax};
}

export function installNativeMemberAliases(groups) {
  const owners=new WeakMap(),pending=[];
  for(const [ctor,rows] of groups) {
    if(typeof ctor!=='function'||!ctor.prototype||!Object.isExtensible(ctor.prototype))throw Error('Native alias owner unavailable');
    const proto=ctor.prototype,map=new Map();
    if(owners.has(proto))throw Error('Duplicate native alias owner');
    for(const [name,actual,kind] of rows) {
      const original=Object.getOwnPropertyDescriptor(proto,actual);
      if(!original||map.has(name)||Object.getOwnPropertyDescriptor(proto,name)||!['method','get','set'].includes(kind))throw Error('Native alias descriptor conflict');
      if(kind==='method'&&typeof original.value!=='function'||kind==='get'&&typeof original.get!=='function'||kind==='set'&&typeof original.set!=='function')throw Error('Native alias descriptor contract changed');
      map.set(name,actual);
      const descriptor=kind==='method'?{enumerable:false,configurable:true,get(){return this[actual];}}:
        {enumerable:false,configurable:true,get:original.get,set:original.set};
      pending.push({proto,name,descriptor});
    }
    owners.set(proto,map);
  }
  const installed=[];
  try{for(const entry of pending){Object.defineProperty(entry.proto,entry.name,entry.descriptor);installed.push(entry);}}
  catch(error){for(const entry of installed.reverse())delete entry.proto[entry.name];throw error;}
  return (target,name)=>{if(target==null)return name;for(let proto=Object.getPrototypeOf(target);proto;proto=Object.getPrototypeOf(proto)){const key=owners.get(proto)?.get(name);if(key)return key;}return name;};
}

// Each definition is recognized within its owning lexical module. Import/export
// edges below are the only way a foreign local becomes accessible in App.
export function discoverGameDefinitions(originalSource, nativeAliases, syntax, overrides) {
  const source=nativeAliases.analysis, id="[A-Za-z_$][\\w$]*", sourceMask=nativeLiteralMask(source);
  const capture=(pattern,group=1)=>{
    const values=[...new Set([...source.matchAll(new RegExp(pattern,"g"))].filter(m=>!sourceMask[m.index]).map(m=>m[group]))];
    return values.length===1?values[0]:null;
  };
  const symbols = {
    data: capture(`\\bawait\\b\\s*(?:\\(\\s*)*(${id})(?:\\s*\\))*\\s*\\.\\s*load\\s*\\(`),
    roster: capture(`\\bleagueReady\\s*\\(\\s*\\)\\s*\\{\\s*return\\b\\s*(?:\\(\\s*)*(${id})(?:\\s*\\))*\\s*\\.\\s*filter\\s*\\(`),
    biomes: capture(`\\bbiomeUnlockedByChain\\s*\\(\\s*${id}\\s*\\)\\s*\\{\\s*(?:let|const|var)\\s+${id}\\s*=\\s*(?:\\(\\s*)*(${id})(?:\\s*\\))*\\s*\\.\\s*findIndex\\s*\\(`),
    biomeLive: capture(`\\bbiomeTier\\s*\\(\\s*${id}\\s*\\)\\s*\\{\\s*return\\s+(?:\\(\\s*)*(${id})(?:\\s*\\))*\\s*\\(\\s*${id}\\s*\\)(?:\\s*\\))*\\s*\\?\\s*(?:\\(\\s*)*this\\.profile\\.biomes`),
    quests: capture(`\\bclaimable\\s*\\(\\s*\\)\\s*\\{\\s*return\\b\\s*(?:\\(\\s*)*(${id})(?:\\s*\\))*\\s*\\.\\s*filter\\s*\\(`),
    lab: capture(`\\bfunction\\s+${id}\\s*\\(\\s*${id}\\s*,\\s*${id}\\s*\\)\\s*\\{\\s*(?:let|const|var)\\s+${id}\\s*=\\s*(${id})\\.find\\s*\\(\\s*(?:${id}|\\(\\s*${id}\\s*\\))\\s*=>\\s*(?:\\(\\s*)*${id}\\.id\\s*===\\s*${id}(?:\\s*\\))*\\s*\\)\\s*;\\s*if\\s*\\(\\s*!\\s*${id}\\s*\\)\\s*return\\s*(?:!\\s*1|false)\\s*;\\s*(?:let|const|var)\\s+${id}\\s*=\\s*${id}\\.lab`),
    items: capture(`\\bcanHold\\s*\\(\\s*${id}\\s*\\)\\s*\\{\\s*return[^{}]{0,160}?\\(\\s*(${id})\\.get\\s*\\([^{}]{0,40}?\\?\\.max`),
    vitamins: capture(`\\bfor\\s*\\(\\s*(?:let|const|var)\\s*\\[\\s*${id}\\s*,\\s*${id}\\s*\\]\\s*of\\s+this\\.vitamins\\s*\\)\\s*\\{\\s*(?:let|const|var)\\s+${id}\\s*=\\s*(${id})\\.get\\s*\\(`),
    rarityMultipliers: capture(`\\b${id}\\.per\\s*\\*\\s*(${id})\\s*\\[\\s*${id}\\.rarity\\s*\\]`),
    moveDef: capture(`\\baddMove\\s*\\(\\s*${id}\\s*\\)\\s*\\{\\s*(?:let|const|var)\\s+${id}\\s*=\\s*(${id})\\s*\\(\\s*${id}\\s*\\)\\s*;\\s*if\\s*\\(\\s*!${id}`),
    moveGuide: null,
    fusionFor: null,
    fusionRecipes: null,
  };
  // The guide returns these named categories; minified parameters and locals may
  // all change. Keep its body bounded to its own named function declaration.
  const functionHeads = [...source.matchAll(new RegExp(`\\bfunction\\s+(${id})\\s*\\([^)]*\\)\\s*\\{`, "g"))].filter(match=>!sourceMask[match.index]);
  const guides = [];
  const fusionResolvers = [];
  const sharedRandomLimits = [];
  for (let index = 0; index < functionHeads.length; index++) {
    const head = functionHeads[index];
    const end = Math.min(functionHeads[index + 1]?.index ?? source.length, head.index + 6500);
    const body = source.slice(head.index, end);
    // Read only the bounded native upgrade generator. This is an observed
    // rule, never a version/hash guess or a call that consumes native RNG.
    if (/\.ownedMoveIds\s*\(\s*\)/.test(body) && /kind\s*:\s*[`"']newMove[`"']/.test(body) &&
        /kind\s*:\s*[`"']upMove[`"']/.test(body) && /kind\s*:\s*[`"']newVit[`"']/.test(body)) {
      const single = new RegExp(`\\.moves\\.some\\(\\s*\\(?(${id})\\)?\\s*=>\\s*\\1\\?\\.def\\.arch\\s*===\\s*[\x60"']random[\x60"']\\s*\\)`).test(body),
        counted = [...body.matchAll(new RegExp(`\\.moves\\.filter\\(\\s*\\(?(${id})\\)?\\s*=>\\s*\\1\\?\\.def\\.arch\\s*===\\s*[\x60"']random[\x60"']\\s*\\)\\.length\\s*>=\\s*([12])(?=[^0-9]|$)`,"g"))];
      if (single && !counted.length) sharedRandomLimits.push(1);
      else if (!single && counted.length === 1) sharedRandomLimits.push(Number(counted[0][2]));
    }
    if (/\.kit\.forEach\s*\(/.test(body) && /return\s*\{\s*kit\s*:/.test(body) && /\bline\s*:/.test(body) && /\bshared\s*:/.test(body) && /\bany\s*:/.test(body) && /\broster\s*:/.test(body)) guides.push(head[1]);
    // Native precedence is exact signature keys, reaction type pairs, same-type,
    // then glitch. Bind the real resolver and its table; never duplicate those
    // rules or expose the state-changing fusion executor.
    if (/\.moves\s*\[\s*0\s*\]/.test(body) && /\.moves\s*\[\s*1\s*\]/.test(body) && /\.pair\s*\[\s*0\s*\]\s*\.includes\s*\(/.test(body) && /\.pair\s*\[\s*1\s*\]\s*\.includes\s*\(/.test(body) && /kind\s*===\s*[`"']signature[`"']/.test(body) && /kind\s*===\s*[`"']reaction[`"']/.test(body) && /kind\s*===\s*[`"']type[`"']/.test(body)) {
      const table = [...body.matchAll(new RegExp(`return\\s+(${id})\\s*\\.\\s*find\\s*\\([^;]{0,200}?kind\\s*===\\s*[\x60"']glitch[\x60"']`, "g"))];
      if (table.length === 1) fusionResolvers.push({ resolver: head[1], table: table[0][1] });
    }
  }
  if (guides.length === 1) symbols.moveGuide = guides[0];
  if (fusionResolvers.length === 1) { symbols.fusionFor = fusionResolvers[0].resolver; symbols.fusionRecipes = fusionResolvers[0].table; }
  const learningRules = sharedRandomLimits.length === 1 ? { sharedRandomMoveLimit: sharedRandomLimits[0] } : {};
  if(Number.isSafeInteger(overrides.other.sharedRandomMoveLimit)&&overrides.other.sharedRandomMoveLimit>0)learningRules.sharedRandomMoveLimit=overrides.other.sharedRandomMoveLimit;
  const captureFeatures=discoverNativeCaptureFeatures(originalSource,syntax,nativeMemberShape);
  // The same card order retained a different callback meaning in a native
  // update. Observe the actual card flag and handler, not a release number or
  // translated title. An unknown form must never guess which ally to release.
  learningRules.shinySwapSelection = ["keep","release"].includes(overrides.other.shinySwapSelection)?overrides.other.shinySwapSelection:nativeShinySwapSelection(source);
  const hasNativeMutation = /\bthis\.mode\s*===\s*[`"']mutation[`"']/.test(source);
  if (hasNativeMutation) {
    const anchors = [...source.matchAll(new RegExp(`\\bthis\\.mode\\s*===\\s*[\x60"']mutation[\x60"']\\s*\\?\\s*(\\()?\\s*(${id})\\s*\\(\\s*${id}\\.mutation\\s*\\?\\?\\s*[\x60"'][\x60"']\\s*\\)\\s*\\?\\?\\s*(${id})\\s*\\(\\s*${id}\\.now\\s*\\(\\s*\\)\\s*\\)\\.mutation\\s*(\\))?\\s*:\\s*null`, "g"))].filter(match => !!match[1] === !!match[4]);
    const anchor = anchors.length === 1 ? anchors[0] : null;
    // Cross-check the menu's native meta clock. The bound helper itself owns
    // epoch, rotation, map and seed; none of those rules are reimplemented.
    const today = anchor?.[3], menuClock = today && new RegExp(`\\b${id}\\s*=\\s*\\(?\\s*(${id})\\s*\\)?\\s*=>\\s*${today.replace(/[$]/g, "\\$")}\\s*\\(\\s*\\1\\.meta\\.now\\s*\\(\\s*\\)\\s*\\)`, "g");
    const clocks = menuClock ? [...source.matchAll(menuClock)] : [];
    symbols.mutationToday = clocks.length === 1 ? today : null;
    symbols.mutationDefinition = clocks.length === 1 ? anchor[2] : null;
  }
  const nativeLegendaryHuntGate=reviewedNativeLegendaryHuntGate(source),
    hasNativeLegendaryHunt=/\blegendShinyPending\s*\(/.test(source);
  return {symbols,learningRules,sharedRandomLimits,captureFeatures,hasNativeMutation,nativeLegendaryHuntGate,hasNativeLegendaryHunt};
}

function resolveModuleDefinitions(originalSource, options, nativeAliases, syntax, overrides) {
  const own=discoverGameDefinitions(originalSource,nativeAliases,syntax,overrides), moduleBindings=[], imports=[];
  const byURL=new Map((options.moduleSources||[]).filter(r=>typeof r.url==='string'&&typeof r.source==='string').map(r=>[r.url,r]));
  const resolved=new Map(), foreignGroups=[], patchExports=new Map(), boundReferences=new Map();
  for(const node of syntax?.ast.body||[]){
    if(node.type!=='ImportDeclaration'||!options.moduleURL)continue;
    const url=new URL(node.source.value,options.moduleURL).href,row=byURL.get(url);
    if(!row||resolved.has(url))continue;resolved.set(url,true);
    const aliases=prepareNativeMemberAliases(row.source,reviewedNativeMemberProfiles,{partial:true,overrides});
    const index=aliases.syntax||nativeSyntaxIndex(row.source),defs=discoverGameDefinitions(row.source,aliases,index,overrides);
    const bind=(local,ownerIndex=index,ownerURL=url,visited=new Set())=>{
      const identity=ownerURL+'#'+local;if(visited.has(identity))return null;visited.add(identity);
      const imported=ownerIndex.ast.body.filter(n=>n.type==='ImportDeclaration').flatMap(n=>n.specifiers.map(s=>({node:n,spec:s}))).find(r=>r.spec.local.name===local);
      if(imported){
        if(imported.spec.type!=='ImportSpecifier')return null;
        const targetURL=new URL(imported.node.source.value,ownerURL).href,target=byURL.get(targetURL);
        if(!target)return null;
        const targetIndex=nativeSyntaxIndex(target.source),exported=imported.spec.imported.name||imported.spec.imported.value;
        const targetLocal=targetIndex.exports.get(exported);if(!targetLocal)return null;
        return bind(targetLocal,targetIndex,targetURL,visited);
      }
      const exports=[...ownerIndex.exports].filter(([,name])=>name===local);
      if(exports.length>1||!ownerIndex.bindings.has(local))return null;
      let exported=exports[0]?.[0];
      if(!exported){
        const rows=patchExports.get(ownerURL)||new Map();
        exported=rows.get(local)||'__pb_export_'+rows.size;
        if(ownerIndex.bindings.has(exported)||ownerIndex.exports.has(exported))return null;
        rows.set(local,exported);patchExports.set(ownerURL,rows);
      }
      const mainImport=syntax.ast.body.find(n=>n.type==='ImportDeclaration'&&new URL(n.source.value,options.moduleURL).href===ownerURL),existing=mainImport?.specifiers.find(s=>s.type==='ImportSpecifier'&&(s.imported.name||s.imported.value)===exported);
      if(existing){boundReferences.set(existing.local.name,{targetURL:ownerURL,exported});return existing.local.name;}
      const alias='__pb_module_'+imports.length;
      imports.push({url:ownerURL,exported,alias});boundReferences.set(alias,{targetURL:ownerURL,exported});return alias;
    };
    for(const [role,local]of Object.entries(defs.symbols))if(!own.symbols[role]&&local){
      const binding=bind(local);if(binding){own.symbols[role]=binding;moduleBindings.push({role,url,local,binding,...boundReferences.get(binding)});}
    }
    for(const group of aliases.groups)if(!nativeAliases.groups.some(g=>g.ownerId===group.ownerId)){
      const binding=bind(group.symbol);if(binding){foreignGroups.push({...group,symbol:binding});moduleBindings.push({owner:group.ownerId,url,local:group.symbol,binding});
        nativeAliases.unresolved.push(...aliases.unresolved.filter(r=>r.id?.startsWith('members.'+group.ownerId+'.')));}
    }
  }
  if(foreignGroups.length){
    nativeAliases.groups.push(...foreignGroups);
    nativeAliases.unresolved=nativeAliases.unresolved.filter(r=>!foreignGroups.some(g=>g.ownerId===r.owner));
  }
  const modulePatches=[...patchExports].map(([url,rows])=>({url,sourceHash:byURL.get(url).sha256||byURL.get(url).sourceHash||'',code:byURL.get(url).source+'\nexport {'+[...rows].map(([local,exported])=>local+' as '+exported).join(',')+'};\n'}));
  return {...own,moduleBindings,imports,modulePatches};
}

function prepareImportedGameSource(source, options) {
  if(!options.moduleURL||!Array.isArray(options.moduleSources))return null;
  const rows=new Map(options.moduleSources.map(row=>[row.url,row])),seen=new Set([options.moduleURL]),queue=discoverPublicModules(source,options.moduleURL),apps=[];
  while(queue.length){
    const url=queue.shift();if(seen.has(url))continue;seen.add(url);
    const row=rows.get(url);if(!row||typeof row.source!=='string')continue;
    const index=nativeSyntaxIndex(row.source);
    if(index.exports.has('App')&&index.boots.length){apps.push(row);continue;}
    queue.push(...discoverPublicModules(row.source,url));
  }
  if(apps.length!==1)return null;
  const row=apps[0],prepared=prepareGameSource(row.source,{...options,moduleURL:row.url,originalModuleURL:row.url,sourceHash:row.sha256||row.sourceHash||''});
  if(!prepared.ok)return null;
  const entryCode=options.originalModuleURL&&options.originalModuleURL!==options.moduleURL?absolutizeNativeModuleImports(source,options.moduleURL):source;
  return {...prepared,code:entryCode,originalGameModuleURL:row.url,originalGameSource:row.source,
    modulePatches:[{url:row.url,sourceHash:row.sha256||row.sourceHash||'',code:prepared.code},...prepared.modulePatches],
    report:{...prepared.report,entryModuleURL:options.moduleURL}};
}

export function prepareGameSource(source, options = {}) {
  const originalSource=source;
  const normalizedOverrides=normalizeCompatibilityOverrides(options.compatibilityOverrides||{}),overrides=normalizedOverrides.config;
  let nativeAliases,aliasError=null;
  try{nativeAliases=typeof source==="string"?prepareNativeMemberAliases(source,reviewedNativeMemberProfiles,{partial:true,overrides}):{analysis:source,groups:[],aliases:{},proof:[],unresolved:[]};}
  catch(error){aliasError=error;nativeAliases={analysis:source,groups:[],aliases:{},proof:[]};}
  source=nativeAliases.analysis;
  const strategy = "semantic-contract-v2";
  const versions = typeof source === "string" ? [...new Set([...source.matchAll(/\bversion\s*===?\s*[`"'](\d+\.\d+\.\d+)[`"']/g)].map((entry) => entry[1]))] : [];
  const publicModules=(options.moduleSources||[]).filter(r=>typeof r.url==='string'&&
    /^[a-f0-9]{64}$/i.test(r.sha256||r.sourceHash||'')).map(r=>({url:r.url,sha256:r.sha256||r.sourceHash})).sort((a,b)=>a.url.localeCompare(b.url));
  const base = { adapterVersion: "2", strategy, sourceHash: String(options.sourceHash || ""), publicModules, gameVersion: versions.length === 1 ? versions[0] : null, missing: [], optionalMissing: [], warnings: [], capabilities: {} };
  const fail = (code, reason, missing = []) => ({ ok: false, isGame: true, code: originalSource,
    report: { ...base, state: "blocked", level: "blocked", code, reason, missing } });
  if (typeof source !== "string") return fail("invalid-source", "游戏模块不是可读取的脚本文本", ["source"]);
  const id = "[A-Za-z_$][\\w$]*";
  const sourceMask=nativeLiteralMask(source);
  const capture = (pattern, group = 1) => {
    const matches = [...source.matchAll(new RegExp(pattern, "g"))].filter(match=>!sourceMask[match.index]);
    const values = [...new Set(matches.map((match) => match[group]))];
    return values.length === 1 ? values[0] : null;
  };
  let syntax=null;try{syntax=nativeAliases.syntax||nativeSyntaxIndex(originalSource);}catch{}
  const appNames=syntax?[...syntax.exports].filter(([name])=>name==='App').map(([,local])=>local):[];
  if(!syntax){const exports=[...source.matchAll(/\bexport\s*\{([^}]+)\}\s*;?/g)].filter(row=>!sourceMask[row.index]);
    for(const entry of exports)for(const match of entry[1].matchAll(new RegExp(`(?:^|,)\\s*(?:(${id})\\s+as\\s+App|(App))\\s*(?=,|$)`,'g')))appNames.push(match[1]||match[2]);
    if(/\bexport\s+class\s+App\b/.test(source))appNames.push('App');}
  if(overrides.other.appExport){const manual=syntax?.exports.get(overrides.other.appExport);if(manual&&syntax?.boots.some(row=>row.app===manual)){appNames.splice(0,appNames.length,manual);}}
  if(!appNames.length&&syntax){const candidates=syntax.boots.filter(row=>{const c=syntax.classes.find(c=>c.symbol===row.app);return c&&c.methods.filter(m=>['startRun','menu','setScreen','boot'].includes(m.key.name)).length>=2;});if(candidates.length===1)appNames.push(candidates[0].app);}
  if(!appNames.length){const imported=prepareImportedGameSource(originalSource,options);if(imported)return imported;}
  if (!appNames.length) return { ok: false, isGame: false, code: originalSource,
    report: { ...base, state: "ignored", code: "not-game-module", reason: "非游戏 App 模块" } };
  if (appNames.length !== 1) return fail("ambiguous-app", "发现多个游戏 App 导出，未接入自动控制", ["App.export"]);
  if(aliasError)base.warnings.push({code:'native-alias-partial',reason:'部分方法尚未识别，其余能力仍独立检查'});
  const app = appNames[0];
  const configuredBoot=overrides.other.bootMethod||'boot';
  const boot = new RegExp(`\\bnew\\s+${app.replace(/[$]/g, "\\$")}\\s*\\(\\s*\\)\\s*\\.\\s*boot\\s*\\(\\s*\\)`, "g");
  const originalMask=nativeLiteralMask(originalSource);
  const bootMatches = [...originalSource.matchAll(boot)].filter(match=>!originalMask[match.index]);
  if(bootMatches.length!==1&&syntax){
    const all=syntax.boots.filter(row=>row.app===app),preferred=all.filter(row=>row.method===configuredBoot),
      actual=preferred.length===1?preferred:all;
    if(actual.length===1)bootMatches.splice(0,bootMatches.length,Object.assign([originalSource.slice(actual[0].start,actual[0].end)],{index:actual[0].start}));
  }
  if (bootMatches.length !== 1) return fail("app-bootstrap-changed", "未找到唯一原生启动位置；已启用的其余本地功能保持可用，可手动修复映射", ["App.bootstrap"]);
  const {symbols,learningRules,sharedRandomLimits,captureFeatures,hasNativeMutation,nativeLegendaryHuntGate,hasNativeLegendaryHunt,moduleBindings,imports:moduleImports,modulePatches}=resolveModuleDefinitions(originalSource,options,nativeAliases,syntax,overrides);
  const automaticSymbols={...symbols};
  if(syntax)for(const[key,value]of Object.entries(overrides.interfaces)){
    if(key.startsWith('symbols.')&&Object.hasOwn(symbols,key.slice(8))&&syntax.bindings.has(value)&&
      nativeRoleOverrideVerified(key.slice(8),syntax.bindings.get(value),originalSource,value===automaticSymbols[key.slice(8)]))symbols[key.slice(8)]=value;
  }
  const hoOhObservations=[];
  for(const row of options.moduleSources||[]){
    if(typeof row.source!=='string'||!row.source.includes('rainbow('))continue;
    const existing=modulePatches.find(p=>p.url===row.url),observed=prepareNativeHoOhObservations(existing?.code||row.source,nativeMemberShape);
    if(!observed.present&&!observed.missing.length)continue;
    hoOhObservations.push({ready:observed.ready,moduleURL:row.url,sourceHash:row.sha256||row.sourceHash||'',methods:observed.methods,missing:observed.missing});
    if(observed.ready){if(existing)existing.code=observed.code;else modulePatches.push({url:row.url,sourceHash:row.sha256||row.sourceHash||'',code:observed.code});}
  }
  const nativeBossObservations={hoOh:hoOhObservations.length===1?hoOhObservations[0]:{ready:false,methods:[],missing:[hoOhObservations.length?'ho-oh-observation-module-ambiguous':'ho-oh-observation-owner']}};
  const coreSymbols = ["data", "roster", "biomes", "biomeLive"];
  const missing = coreSymbols.filter((key) => !symbols[key]);
  // A missing catalog is a capability warning, not a blanket startup prohibition.
  const sourceOptionalMissing = Object.keys(symbols).filter((key) => !symbols[key]);
  if(hasNativeLegendaryHunt&&!nativeLegendaryHuntGate)sourceOptionalMissing.push("nativeLegendaryShinyReady");
  const level = sourceOptionalMissing.length || nativeAliases.unresolved?.length || normalizedOverrides.errors.length ? "degraded" : "full";
  const interactionCoverage = analyzeNativeInteractionCoverage(source);
  const nativeSeason3Mechanics=inspectSeason3Mechanics(options.moduleSources||[],nativeMemberShape);
  const report = { ...base, nativeBossObservations,nativeSeason3Mechanics, captureFeatures, missing, unresolvedMembers:nativeAliases.unresolved||[], directNativeMembers:nativeAliases.directNativeMembers||[], optionalUnavailable:nativeAliases.optionalUnavailable||[], overrideErrors:normalizedOverrides.errors, nativeMemberAliases:Object.keys(nativeAliases.aliases).length, nativeAliasOwners:nativeAliases.groups.length, learningRules, hasNativeMutation, hasNativeLegendaryHunt, nativeLegendaryHuntReadOnly:!!nativeLegendaryHuntGate, state: "prepared", level, code: "source-prepared", reason: sourceOptionalMissing.length ? `核心启动接口已识别，部分可选目录待适配（${sourceOptionalMissing.join("、")}），等待运行时检查` : "游戏启动与目录接口已识别，等待运行时检查", optionalMissing: sourceOptionalMissing, sourceOptionalMissing, appSymbol: app, symbols, interactionCoverage };
  // Replace the bootstrap plus explicitly reviewed observation-only spans in
  // dependency modules. Native numeric rules, RNG calls, damage and timing stay intact.
  // Empty collections represent unavailable optional definitions only. The
  // sourceOptionalMissing marker keeps them disabled; no gameplay value,
  // function implementation, price or random result is invented.
  const empty = {data:"null",roster:"[]",biomes:"[]",biomeLive:"null",mutationToday:"null",mutationDefinition:"null", quests: "[]", lab: "[]", items: "new Map()", vitamins: "new Map()", rarityMultipliers: "[]", moveDef: "null", moveGuide: "null", fusionFor: "null", fusionRecipes: "[]" };
  const bridgeEntries = Object.entries(symbols).map(([key, value]) => `${key}:${value || empty[key]}`).join(",");
  const nativeHuntEntry=nativeLegendaryHuntGate?`,nativeLegendaryShinyReady:(species)=>{
    if(!Number.isInteger(species)||![144,145,146,150,151].includes(species))return false;
    const meta=app?.meta;if(!meta?.profile||!meta?.account?.id)return null;
    const run=app.run;
    try{
      if(run&&run.state!=="over")return typeof run.capture?.legendShinyPending==="function"?!!run.capture.legendShinyPending(species):null;
      if(app.starting||meta.queued||meta.hasPending?.())return null;
      return !!${nativeLegendaryHuntGate}(meta.profile,meta.account.id,species);
    }catch{return null;}
  }`:"";
  const discoveredConfig={},effectiveConfig={},entryStatus={},entryReasons={};
  for(const[key,value]of Object.entries(automaticSymbols))if(value){discoveredConfig['symbols.'+key]=value;entryStatus['symbols.'+key]='discovered';}
  for(const[key,value]of Object.entries(symbols))if(value)effectiveConfig['symbols.'+key]=value;
  for(const [ownerIndex,spec]of reviewedNativeAliasOwners.entries())for(const logical of spec.members){
    const group=nativeAliases.groups.find(group=>group.ownerId===nativeOwnerIds[ownerIndex]);
    const match=group?.members.filter(row=>row.logical===logical);
    if(match?.length===1){const key=`members.${nativeOwnerIds[ownerIndex]}.${logical}`;effectiveConfig[key]=match[0].actual;
      if(match[0].match!=='manual')discoveredConfig[key]=match[0].actual;entryStatus[key]='discovered';}
  }
  for(const spec of compatibilityEditorCatalog().entries.filter(row=>row.kind==='other'))effectiveConfig[spec.id]=overrides.other[spec.id]??spec.defaultValue;
  effectiveConfig.appExport=[...syntax?.exports||[]].find(([,symbol])=>symbol===app)?.[0]||'App';
  effectiveConfig.bootMethod=syntax?.boots.find(row=>row.start===bootMatches[0].index)?.method||'boot';
  discoveredConfig.appExport=effectiveConfig.appExport;discoveredConfig.bootMethod=effectiveConfig.bootMethod;
  if(sharedRandomLimits.length===1)discoveredConfig.sharedRandomMoveLimit=sharedRandomLimits[0];
  const nativeSwap=nativeShinySwapSelection(source);if(nativeSwap)discoveredConfig.shinySwapSelection=nativeSwap;
  if(options.moduleURL){discoveredConfig['resources.mainModule']=options.moduleURL;effectiveConfig['resources.mainModule']=options.moduleURL;entryStatus['resources.mainModule']='valid';}
  if(options.moduleURL&&syntax){
    const candidates=new Set();
    // Several independently identified definition roles must prove the same
    // static module. A filename containing "news" is not role evidence.
    for(const node of syntax.ast.body.filter(node=>node.type==='ImportDeclaration')){
      const roles=Object.entries(automaticSymbols).filter(([key,value])=>['roster','biomes','lab','quests','fusionRecipes'].includes(key)&&
        node.specifiers.some(spec=>spec.local?.name===value));
      if(roles.length>=3){try{const u=new URL(node.source.value,options.moduleURL);if(u.origin==='https://pokebonk.com'&&!u.search&&!u.hash)candidates.add(u.href);}catch{}}
    }
    const visit=node=>{if(!node||typeof node.type!=='string')return;
      if(node.type==='ImportExpression'&&node.source?.type==='Literal'&&typeof node.source.value==='string'){
        let enclosing=null;for(const method of syntax.methods)if(method.start<=node.start&&method.end>=node.end){enclosing=method;break;}
        if(enclosing&&/news|announcement/i.test(enclosing.name)){
          try{const url=new URL(node.source.value,options.moduleURL);if(url.origin==='https://pokebonk.com'&&!url.search&&!url.hash)candidates.add(url.href);}catch{}
        }
      }
      for(const[key,value]of Object.entries(node))if(!['start','end','loc'].includes(key)){
        if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);
      }};visit(syntax.ast);
    if(candidates.size===1){discoveredConfig['resources.newsModule']=[...candidates][0];effectiveConfig['resources.newsModule']=[...candidates][0];entryStatus['resources.newsModule']='discovered';}
  }
  const candidateSources=Object.fromEntries(Object.keys(discoveredConfig).map(id=>[id,'current-public-source'])),
    candidateVerified=Object.fromEntries(Object.keys(discoveredConfig).map(id=>[id,true]));
  const verifiedRoleBindings=Object.fromEntries(Object.keys(symbols).map(key=>[key,[...new Set([automaticSymbols[key],symbols[key]].filter(Boolean))]]));
  Object.assign(report,{moduleBindings,symbols,effectiveConfig,discoveredConfig,entryStatus,entryReasons,candidateSources,candidateVerified,verifiedRoleBindings});
  if(moduleBindings.length)report.maintenanceScope={stage:'M3',automaticPlay:true,validation:'offline-only',autoStart:false,
    reason:'第三阶段离线候选，实战待验',modeIds:['resources','map','autoManage','characters','shiny','appearance','wardrobe'],
    nativeModes:['standard','endless'],endlessModeIds:['appearance','wardrobe'],biomeIds:['forest','desert','coast','glacier',...['canela','cave','encina','iris'].filter(id=>nativeSeason3Mechanics.biomes[id]&&(id!=='iris'||nativeBossObservations.hoOh.ready))],tiers:[0,1,2],allowRifts:nativeSeason3Mechanics.biomes.rifts};
  const metadata = JSON.stringify({ ...report, nativeMemberAliases:Object.keys(nativeAliases.aliases).length, nativeAliasOwners:nativeAliases.groups.length, learningRules, hasNativeMutation, hasNativeLegendaryHunt, nativeLegendaryHuntReadOnly:!!nativeLegendaryHuntGate, sourceOptionalMissing, interactionCoverage, state: "pending", code: "boot-pending", reason: "正在加载游戏并检查接口" });
  const actualBootMethod=syntax?.boots.find(row=>row.start===bootMatches[0].index)?.method||'boot';
  const nativeAliasGroups="["+nativeAliases.groups.map(group=>"[()=>"+group.symbol+","+JSON.stringify(group.members.map(row=>[row.logical,row.actual,row.kind]))+","+JSON.stringify(group.ownerId||'unknown')+"]").join(",")+"]";
  const replacement = `(()=>{
const state=${metadata};globalThis.__PB_COMPATIBILITY=state;
const now=Date.now(),boot={schemaVersion:1,phase:'loading',stage:'data-loading',startedAt:now,lastProgressAt:now,observedAt:now,progress:null,code:'native-boot-loading'};globalThis.__PB_GAME_BOOT=boot;
const nativeCompatSelector=${nativeCompatSelector.toString()},checkLegacyBridgeContract=${checkLegacyBridgeContract.toString()},check=${checkBridgeContract.toString()},observe=${observeGameBoot.toString()};let app,monitor=null;
const stopMonitor=()=>{if(monitor!==null&&typeof globalThis.clearInterval==='function')globalThis.clearInterval(monitor);monitor=null};
const sample=()=>{if(boot.phase!=='loading'||globalThis.__PB_GAME_BOOT!==boot){stopMonitor();return}let next;try{next=observe(app)}catch{return}const at=Date.now();if(next.stage!==boot.stage||next.progress!==boot.progress)boot.lastProgressAt=at;Object.assign(boot,next,{observedAt:at})};
const failed=(code,reason)=>{stopMonitor();Object.assign(boot,{phase:'failed',code,observedAt:Date.now()});Object.assign(state,{state:'blocked',level:'blocked',code,reason})};
try{app=new ${app}()}catch(error){failed('app-create-failed','游戏初始化失败，自动控制未接入');throw error}
const installAliases=${installNativeMemberAliases.toString()},aliasResolvers=[];
for(const [owner,members,ownerId]of ${nativeAliasGroups}){try{aliasResolvers.push(installAliases([[owner(),members]]))}
catch(error){state.warnings.push({code:'native-alias-install-partial',owner:ownerId,reason:'个别原生映射未安装；独立核验仍可用功能'});(state.unresolvedMembers||=[]).push({ownerId,reason:'native-alias-install-partial'})}}
const memberKey=(target,name)=>{for(const resolve of aliasResolvers){const key=resolve(target,name);if(key!==name)return key}return name};
const bridge={app,nativeMemberKey:memberKey,${bridgeEntries}${nativeHuntEntry},captureFeatures:${JSON.stringify(captureFeatures)},compatibility:state};
const registry={${[...new Set([...syntax?.bindings.keys()||[],...moduleImports.map(row=>row.alias)])].map(name=>JSON.stringify(name)+':()=>'+name).join(',')}};
globalThis.__PB_BRIDGE=bridge;globalThis.__PB_RUNTIME_COMPAT=(${createNativeRuntimeEditor.toString()})(bridge,registry,${JSON.stringify(overrides)},${JSON.stringify(compatibilityEditorCatalog())},state);let result;
try{result=app[${JSON.stringify(actualBootMethod)}]();sample();if(typeof globalThis.setInterval==='function')monitor=globalThis.setInterval(sample,500)}catch(error){failed('app-boot-failed','游戏启动失败，自动控制未接入');throw error}
return Promise.resolve(result).then(value=>{
sample();stopMonitor();try{globalThis.__PB_RUNTIME_COMPAT?.refresh(true)}catch{state.warnings.push({code:"runtime-inspection-partial",reason:"部分字段待核验，原生游戏仍正常启动"})}
if(!app.input&&boot.stage==='native-retry'){failed('native-boot-incomplete','游戏资源尚未加载完成，原生页面正在等待重试');return value}
boot.stage='contract-check';let contract;try{contract=check(bridge)}catch(error){failed('runtime-contract-check-failed','游戏接口检查未完成，自动控制未接入');throw error}
const warnings=[...(state.warnings||[]),...(contract.warnings||[])],partialSource=state.level==='degraded'||warnings.some(row=>row.code==='native-alias-install-partial'||row.code==='runtime-inspection-partial'),level=partialSource?'degraded':contract.level;
Object.assign(state,{...contract,warnings,level,state:contract.ok?'ready':'partial',code:contract.ok?(level==='degraded'?'contract-degraded':'contract-ready'):'runtime-contract-changed',reason:contract.ok?(level==='degraded'?'核心游戏接口可用，部分功能待适配':'游戏接口检查通过'):('游戏运行接口不兼容（'+contract.missing.join('、')+'）')});
Object.assign(boot,{phase:contract.ok?'ready':'loading',stage:contract.ok?'complete':'contract-check',code:contract.ok?'native-boot-ready':'runtime-contract-changed',observedAt:Date.now()});
globalThis.__PB_BRIDGE=bridge;return value
},error=>{failed('app-boot-failed','游戏启动失败，自动控制未接入');throw error})})()`;
  const hit = bootMatches[0];
  let code=originalSource.slice(0,hit.index)+replacement+originalSource.slice(hit.index+hit[0].length);
  if(moduleImports.length)code=moduleImports.map(row=>`import {${row.exported} as ${row.alias}} from ${JSON.stringify(row.url)};`).join('\n')+'\n'+code;
  if(options.moduleURL&&options.originalModuleURL&&options.moduleURL!==options.originalModuleURL)code=absolutizeNativeModuleImports(code,options.moduleURL);
  return {ok:true,isGame:true,code,report,modulePatches};
}

// This snapshot deliberately has no account, profile, run or arbitrary object
// serialization. Counts and public definition IDs let the host identify a new
// catalog without importing an announcement as playable content.
export function createCatalogSnapshot(bridge, options = {}) {
  const ids = (entries) => [...new Set((Array.isArray(entries) ? entries : [])
    .map((entry) => entry?.id).filter((id) => typeof id === "string" || Number.isInteger(id)).map(String))].sort();
  const keys = (map) => {
    try { return typeof map?.keys === "function" ? [...map.keys()].filter((id) => typeof id === "string" || Number.isInteger(id)).map(String).sort() : []; }
    catch { return []; }
  };
  const groups = {
    pokemon: ids(bridge?.data?.pokemon), characters: ids(bridge?.roster), biomes: ids(bridge?.biomes),
    items: keys(bridge?.items), vitamins: keys(bridge?.vitamins), moves: keys(bridge?.data?.moves),
    lab: ids(bridge?.lab), quests: ids(bridge?.quests),
  };
  return { schemaVersion: 1, gameVersion: options.gameVersion || bridge?.compatibility?.gameVersion || null,
    sourceHash: String(options.sourceHash || bridge?.compatibility?.sourceHash || ""),
    counts: Object.fromEntries(Object.entries(groups).map(([key, values]) => [key, values.length])), ids: groups,
    // Only pass actual native availability here. An omitted list means unknown,
    // and a catalog definition alone never makes a new map supported or live.
    liveBiomes: Array.isArray(options.liveBiomes) ? [...new Set(options.liveBiomes.filter((id) => typeof id === "string"))].sort() : null };
}

// Pure comparison: a changed hash or filename is evidence of a deployment, not
// a reason to block compatible old gameplay. The runtime contract decides that.
export function analyzeDeployment(previous = null, current = {}) {
  const catalog = (entry) => entry?.catalog || entry || {};
  const sourceHash = (entry) => String(entry?.sourceHash || entry?.gameHash || entry?.catalog?.sourceHash || "");
  const version = (entry) => entry?.gameVersion || entry?.catalog?.gameVersion || entry?.version || null;
  const now = catalog(current), before = catalog(previous);
  const changes = {};
  for (const key of previous ? new Set([...Object.keys(before.ids || {}), ...Object.keys(now.ids || {})]) : []) {
    const oldIds = Array.isArray(before.ids?.[key]) ? before.ids[key].map(String) : [];
    const newIds = Array.isArray(now.ids?.[key]) ? now.ids[key].map(String) : [];
    const oldSet = new Set(oldIds), newSet = new Set(newIds);
    const added = newIds.filter((id) => !oldSet.has(id)), removed = oldIds.filter((id) => !newSet.has(id));
    if (added.length || removed.length) changes[key] = { added, removed, previousCount: oldIds.length, currentCount: newIds.length };
  }
  const countChanges = {};
  for (const key of previous ? new Set([...Object.keys(before.counts || {}), ...Object.keys(now.counts || {})]) : []) {
    const oldCount = before.counts?.[key], newCount = now.counts?.[key];
    if (Number.isFinite(oldCount) && Number.isFinite(newCount) && oldCount !== newCount) countChanges[key] = { previous: oldCount, current: newCount, delta: newCount - oldCount };
  }
  const contract = current.contract || current.compatibility || {};
  const capabilities = contract.capabilities || current.capabilities || {};
  const previousCapabilities = previous?.contract?.capabilities || previous?.compatibility?.capabilities || previous?.capabilities || {};
  const lostCapabilities = Object.keys(previousCapabilities).filter((key) => previousCapabilities[key] === true && capabilities[key] === false);
  const gainedCapabilities = Object.keys(capabilities).filter((key) => capabilities[key] === true && previousCapabilities[key] === false);
  const comparable = !!previous && !!sourceHash(previous) && !!sourceHash(current);
  const hashChanged = comparable ? sourceHash(previous) !== sourceHash(current) : null;
  const versionChanged = previous && version(previous) && version(current) ? version(previous) !== version(current) : null;
  const coreCompatible = typeof capabilities.control === "boolean" ? capabilities.control : typeof contract.ok === "boolean" ? contract.ok : null;
  const level = contract.level || (coreCompatible === false ? "blocked" : coreCompatible === true ? "full" : "pending");
  const contentChanged = Object.keys(changes).length > 0 || Object.keys(countChanges).length > 0;
  return { schemaVersion: 1, state: !previous ? "first-observation" : hashChanged === true || versionChanged === true || contentChanged || lostCapabilities.length || gainedCapabilities.length ? "changed" : comparable ? "same" : "unverified",
    previousHash: sourceHash(previous), sourceHash: sourceHash(current), previousVersion: version(previous), gameVersion: version(current),
    hashChanged, versionChanged, coreCompatible, level, catalogChanges: changes, countChanges, lostCapabilities, gainedCapabilities,
    requiresCoreAdaptation: coreCompatible === false,
    requiresFeatureReview: Object.keys(changes).length > 0 || Object.keys(countChanges).length > 0 || lostCapabilities.length > 0 || versionChanged === true,
    // No deployment comparison certifies a new boss, map mechanic or victory.
    newMechanicsValidated: false,
    reason: coreCompatible === false ? "核心接口变化，已暂停自动控制并列出缺失能力" : level === "degraded" ? "核心接口可用，部分功能已降级；可查看具体原因" : hashChanged === true ? "检测到游戏资源更新，当前核心接口检查通过；新增机制仍需验证" : "已记录当前公开资源与能力检查结果" };
}

// A server may permanently reject a settlement and drop its pending record.
// Absence of pending work therefore does not prove that this run was saved.
// This read-only gate requires a receipt explicitly associated with this run.
export function deploymentReloadDecision(input = {}) {
  const decide = (canReload, code, reason) => ({ canReload, code, reason });
  if (input.savePending || input.pendingSave) return decide(false, "save-pending", "等待游戏保存与待同步记录完成");
  if (typeof input.hasRun !== "boolean") return decide(false, "run-state-unknown", "尚未确认当前对局状态");
  if (!input.hasRun) return decide(true, "no-run", "当前没有对局或待保存记录，可以重新接入");
  if (input.state !== "over") return decide(false, "run-active", "当前对局尚未正常结束，继续保留对局");
  const identity = (value) => typeof value === "number" && Number.isFinite(value) && value > 0 ? String(value)
    : typeof value === "string" && /^\d+$/.test(value) && Number(value) > 0 ? String(Number(value)) : null;
  const runAt = identity(input.runAt);
  if (!runAt) return decide(false, "run-identity-missing", "未能关联本局保存回执，保持当前页面");
  let latest = null;
  for (const event of Array.isArray(input.events) ? input.events : []) {
    if (!event || identity(event.runAt) !== runAt) continue;
    if (event.kind !== "settlement" && !(event.kind === "resynced" && event.saved === true)) continue;
    // Events are normally appended in time order. Timestamp comparison also
    // handles a caller passing a reordered copy; equal/unknown times use order.
    const hasTimes = Number.isFinite(event.at) && Number.isFinite(latest?.at);
    if (!latest || !hasTimes || event.at >= latest.at) latest = event;
  }
  if (!latest) return decide(false, "run-receipt-missing", "尚未收到明确属于本局的服务器保存成功回执");
  if (latest.saved !== true) return decide(false, "settlement-rejected", "本局结算未确认保存，保留失败提示并等待处理");
  return decide(true, latest.kind === "resynced" ? "run-resync-confirmed" : "run-save-confirmed", "本局已收到保存成功回执，可以重新接入");
}

// Removed feature: retain harmless exports for older diagnostic callers only.
// Neither argument is inspected. Legacy options cannot read or change native
// preferences, request input, save settings, or prevent current control startup.
export function planNativeExpertSettings(_app, _options) {
  return { ok: true, enabled: false, removed: true, code: "expert-removed",
    changes: [], missing: [], saveRequested: false, nativeSaveCompleted: false,
    serverConfirmed: false, reason: "高玩模式已移除，保留玩家全部原生设置与瞄准控制" };
}

export async function applyNativeExpertSettings(_app, _options) {
  return planNativeExpertSettings();
}

// Current native Bonkoin uses its own mature/attract/pickup loop, not an E choice.
const coverageWorldKinds = ["bonk", "chest", "freechest", "altar", "challenge", "cursed", "cursedchest", "greed",
  "meowth", "ditto", "hypno", "snorlax", "magnet", "berry", "boss", "shrine", "portal", "cage", "rock", "shroom", "slots",
  "bill", "fossil", "nest", "porygon", "rhydon", "tower"];
const coverageModalMethods = ["showLevelUp", "showBlessing", "showItemChoice", "showItem", "showBranch", "showParty",
  "showDitto", "showShinySwap", "showPact", "showShop", "showForget", "showSlots", "showPause", "showMap",
  "showPauseSettings", "showMoveGuide", "showFusionGuide", "showMapLegend", "showFusion", "showTrade"];
// Altar history is a native read-only pause panel; recognizing it does not close it.
const coveragePassiveMethods = ["showEvolution", "showSummary", "showAltarLog"];
function nativeShinySwapSelection(source) {
  const heads = [...source.matchAll(/\bshowShinySwap\s*\(([^)]*)\)\s*\{/g)];
  if (heads.length !== 1) return null;
  const head = heads[0], params = head[1].split(",").map(value => value.trim());
  if (params.length !== 5 || !params.every(value => /^[A-Za-z_$][\w$]*$/.test(value)) || new Set(params).size !== 5) return null;
  const end = coverageBraceEnd(source, head.index + head[0].lastIndexOf("{"));
  if (end < 0) return null;
  const body = source.slice(head.index, end), id = "[A-Za-z_$][\\w$]*",
    helpers = [...body.matchAll(new RegExp(`(?:let|const|var)\\s+(${id})\\s*=\\s*\\(\\s*(${id})\\s*,\\s*(${id})\\s*\\)\\s*=>\\s*\\{`, "g"))];
  if (helpers.length !== 1) return null;
  const helper = helpers[0], helperEnd = coverageBraceEnd(body, helper.index + helper[0].lastIndexOf("{"));
  if (helperEnd < 0) return null;
  const escape = value => value.replace(/[$]/g, "\\$"), card = body.slice(helper.index, helperEnd),
    callbacks = [...card.matchAll(new RegExp(`\\bonclick\\s*:\\s*\\(\\s*\\)\\s*=>\\s*${escape(params[4])}\\s*\\(\\s*(!?)\\s*${escape(helper[3])}\\s*\\)`, "g"))],
    cards = new RegExp(`${escape(helper[1])}\\s*\\(\\s*${escape(params[1])}\\s*,\\s*(?:!\\s*1|false)\\s*\\)\\s*,\\s*${escape(helper[1])}\\s*\\(\\s*${escape(params[2])}\\s*,\\s*(?:!\\s*0|true)\\s*\\)`);
  if (callbacks.length !== 1 || !cards.test(body.slice(helperEnd))) return null;
  return callbacks[0][1] === "!" ? "release" : "keep";
}
function coverageBraceEnd(source, start) {
  // Templates can nest inside ${expressions}; treating a template as a flat
  // quote truncates the current Run class before its shop/portal methods.
  const quoted=(at,quote)=>{for(let i=at+1;i<source.length;i++){if(source[i]==="\\"){i++;continue;}if(source[i]===quote)return i+1;}return -1;};
  const template=at=>{for(let i=at+1;i<source.length;i++){if(source[i]==="\\"){i++;continue;}if(source[i]==="`")return i+1;if(source[i]==="$"&&source[i+1]==="{"){const end=block(i+1);if(end<0)return -1;i=end-1;}}return -1;};
  const block=at=>{let depth=0;for(let i=at;i<source.length;i++){const c=source[i],next=source[i+1];
    if(c==="'"||c==='"'){const end=quoted(i,c);if(end<0)return -1;i=end-1;continue;}
    if(c==='`'){const end=template(i);if(end<0)return -1;i=end-1;continue;}
    if(c==='/'&&next==='/'){const end=source.indexOf('\n',i+2);if(end<0)return -1;i=end;continue;}
    if(c==='/'&&next==='*'){const end=source.indexOf('*/',i+2);if(end<0)return -1;i=end+1;continue;}
    if(c==='{')depth++;else if(c==='}'&&--depth===0)return i+1;
  }return -1;};
  return block(start);
}
function coverageNativeClass(source, anchor, markers) {
  const method = new RegExp(`\\b${anchor}\\s*\\([^)]*\\)\\s*\\{`).exec(source);
  if (!method) return null;
  const classes = [...source.slice(0, method.index).matchAll(/\bclass(?:\s+[\w$]+)?(?:\s+extends\s+[\w$.]+)?\s*\{/g)];
  for (let i = classes.length - 1; i >= 0; i--) {
    const start = classes[i].index + classes[i][0].lastIndexOf("{");
    const end = coverageBraceEnd(source, start);
    if (end <= method.index) continue;
    const body = source.slice(start, end);
    if (markers.every(marker => new RegExp(`\\b${marker}\\s*\\(`).test(body))) return body;
  }
  return null;
}
export function analyzeNativeInteractionCoverage(source, options = {}) {
  // Static public-source inspection only. An unknown type requests review; it
  // neither executes remote code nor authorizes clicking a new paid/risky UI.
  if (typeof source !== "string") source = "";
  const world = coverageNativeClass(source, "label", ["cageCost", "spawnPortal", "altarUpdate", "interact"]);
  const ui = coverageNativeClass(source, "showLevelUp", ["showForget", "showMapLegend", "showPause"]);
  const worldTypes = world ? [...new Set([
    ...[...world.matchAll(/\bcase\s*(["'`])([a-z][a-z0-9-]*)\1\s*:/g)].map(m => m[2]),
    ...[...world.matchAll(/\bthis\s*\.\s*add\s*\(\s*(["'`])([a-z][a-z0-9-]*)\1/g)].map(m => m[2]),
  ])].sort() : [];
  const modalMethods = ui ? [...new Set([...ui.matchAll(/\b(show[A-Z][\w$]*)\s*\([^)]*\)\s*\{/g)].map(m => m[1]))].sort() : [];
  const supportedWorld = new Set(options.supportedWorldTypes || coverageWorldKinds);
  const supportedModal = new Set(options.supportedModalMethods || coverageModalMethods);
  const passive = new Set(options.passiveModalMethods || coveragePassiveMethods);
  const unknownWorldTypes = worldTypes.filter(kind => !supportedWorld.has(kind));
  const unknownModalMethods = modalMethods.filter(method => !supportedModal.has(method) && !passive.has(method));
  const missing = [...(!world || !worldTypes.length ? ["public-world-type-enumeration"] : []),
    ...(!ui || !modalMethods.length ? ["public-modal-type-enumeration"] : [])];
  const reviewRequired = missing.length > 0 || unknownWorldTypes.length > 0 || unknownModalMethods.length > 0;
  return { schemaVersion: 1, state: reviewRequired ? "review-required" : "known", reviewRequired,
    worldTypes, modalMethods, passiveModalMethods: modalMethods.filter(method => passive.has(method)),
    unknownWorldTypes, unknownModalMethods, missing, blocksKnownFeatures: false,
    reason: missing.length ? "公开交互枚举结构变化，已列为待核对；保留已支持功能" : reviewRequired
      ? "发现尚未适配的交互或页面：" + [...unknownWorldTypes, ...unknownModalMethods].join("、")
      : "公开交互与页面类型已逐项匹配支持清单；不代表全部机制已经实战验收" };
}
