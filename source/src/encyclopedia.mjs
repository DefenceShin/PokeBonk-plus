// Public definition/search helpers. No account, browser state, network or Node API.
import { createGameLibrary } from './game-library.mjs';

export const encyclopediaCategories = [
  ["pokemon", "基础图鉴"], ["characters", "可玩角色"], ["moves", "技能招式"], ["items", "道具"],
  ["vitamins", "维生素"], ["abilities", "特性"], ["passives", "角色被动"], ["maps", "地图"],
  ["modes", "模式"], ["shiny", "异色"], ["lab", "研究所"], ["quests", "委托与成就"],
  ["guides", "攻略与机制"], ["builds", "参考配装"],
].map(([id, name]) => ({ id, name }));

export function normalizeEncyclopediaText(value) {
  return String(value ?? "").normalize("NFKC").normalize("NFD").replace(/\p{M}/gu, "")
    .toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, " ").trim();
}

const searchIndexes = new WeakMap();
function searchableText(value, seen = new Set()) {
  if (value == null || typeof value === "function") return "";
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "";
  seen.add(value);
  return Object.entries(value).map(([key, item]) => key + " " + searchableText(item, seen)).join(" ");
}

export function searchEncyclopedia(catalog, { query = "", category = "", offset = 0, limit = 40 } = {}) {
  const entries = Array.isArray(catalog?.entries) ? catalog.entries : [];
  let cached = catalog && searchIndexes.get(catalog);
  if (!cached || cached.entries !== entries || cached.length !== entries.length) {
    cached = { entries, length: entries.length, index: entries.map((entry) => normalizeEncyclopediaText(searchableText(entry))) };
    if (catalog && typeof catalog === "object") searchIndexes.set(catalog, cached);
  }
  const tokens = normalizeEncyclopediaText(query).split(" ").filter(Boolean);
  const filter = typeof category === "string" && !["", "all", "*"].includes(category) ? category : null;
  const pageOffset = Number.isFinite(Number(offset)) ? Math.max(0, Math.floor(Number(offset))) : 0;
  const pageLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(200, Math.floor(Number(limit)))) : 40;
  let total = 0;
  const page = [];
  for (let index = 0; index < entries.length; index++) {
    if (filter && entries[index]?.category !== filter) continue;
    if (!tokens.every((token) => cached.index[index].includes(token))) continue;
    if (total >= pageOffset && page.length < pageLimit) page.push(entries[index]);
    total++;
  }
  return { entries: page, total, offset: pageOffset, limit: pageLimit, hasMore: pageOffset + page.length < total };
}

export const encyclopediaStatNames = {
  damage: "伤害", physical: "物理伤害", special: "特殊伤害", attackSpeed: "攻击速度", projectiles: "投射物数量",
  area: "范围", duration: "持续时间", moveSpeed: "移动速度", projSpeed: "弹速", maxHp: "最大生命", hp: "生命",
  armor: "护甲", regen: "生命回复", healing: "治疗效果", shieldMax: "再生护盾", critChance: "暴击率", critDamage: "暴击伤害",
  statusChance: "异常状态概率", statusDamage: "异常状态伤害", pickupRange: "拾取范围", xpGain: "经验获取", gold: "金币获取",
  luck: "幸运", evasion: "闪避率", lifesteal: "吸血概率", thorns: "尖刺", knockback: "击退", ultimate: "终极技",
  dmg: "基础伤害", cd: "冷却秒数", count: "数量", speed: "速度", dur: "持续秒数", pierce: "穿透数", bounce: "反弹数",
};

export function formatEncyclopediaMods(mods) {
  const percent = new Set(["critChance", "critDamage", "statusChance", "evasion", "lifesteal"]);
  const round = (value) => Number(value.toFixed(6));
  return (Array.isArray(mods) ? mods : []).map((mod) => {
    if (!mod || typeof mod !== "object") return "";
    const stat = encyclopediaStatNames[mod.stat] || mod.stat || mod.key || "属性";
    const parts = [];
    if (Number.isFinite(mod.add)) parts.push(`${mod.add >= 0 ? "+" : ""}${round(mod.add * (percent.has(mod.stat) ? 100 : 1))}${percent.has(mod.stat) ? "%" : ""}`);
    if (Number.isFinite(mod.mul)) parts.push(`${mod.mul >= 1 ? "+" : ""}${round((mod.mul - 1) * 100)}%（×${mod.mul}）`);
    if (Number.isFinite(mod.value)) parts.push(String(mod.value));
    return stat + (parts.length ? " " + parts.join("；") : "（数值见原生说明）");
  }).filter(Boolean).join("；");
}

// These explanations come from the reviewed native recipe.info table. Keep
// that public table as the single source; no combat function or DOM is run.
export function fusionEncyclopediaDetails(info) {
  if(!info||typeof info!=="object"||Array.isArray(info))return null;
  const parts=Array.isArray(info.parts)?info.parts.filter(p=>p&&typeof p.id==="string"):[],
    names=new Map(parts.map(p=>[p.id,typeof p.name==="string"?p.name:p.id])),
    name=id=>names.get(id)||String(id),details={};
  if(parts.length)details.攻击组成=parts.map(p=>name(p.id));
  for(const [key,label]of [["area","范围加成影响"],["dur","持续时间加成影响"]])
    if(Array.isArray(info[key])&&info[key].length)details[label]=info[key].map(name);
  if(Array.isArray(info.count)&&info.count.length)details.数量加成=info.count.map(row=>{
    if(typeof row?.text==="string")return row.text;
    if(!row||!Number.isFinite(row.per)||row.per<=0||!Number.isFinite(row.max)||row.max<0)
      return "数值见原生配方说明";
    const round=n=>Number(n.toFixed(6)),growth=row.per>=1?`每增加1数量，增加${round(row.per)}`:`每增加${round(1/row.per)}数量，增加1`,
      base=Number.isFinite(row.base)?`基础${row.base}；总上限${round(row.base+row.max)}`:`最多增加${row.max}`;
    return `${name(row.part)}：${growth}（${base}）`;
  });
  if(Array.isArray(info.fixed)&&info.fixed.length)details.固定机制=info.fixed.filter(v=>typeof v==="string");
  if(info.random===true)details.随机机制="按游戏原生随机结果决定效果。";
  return Object.keys(details).length?details:null;
}

// Only these fields may cross the runtime-public-data boundary. Unknown account
// fields on a future bridge are never spread or serialized into this catalog.
const definitionFields = ["id", "key", "name", "nameEn", "type", "types", "description", "desc", "flavor", "mods", "max", "stat", "per", "kind", "extra", "dice", "note",
  "power", "accuracy", "pp", "priority", "cls", "arch", "dmg", "cd", "count", "area", "speed", "dur", "pierce", "status", "statusChance", "drain",
  "critBonus", "flinch", "bounce", "spread", "pulses", "type2", "fusion", "recipe", "rarity", "cost", "price", "weather", "buff", "kit", "kitNames", "kitUnlockLevels", "role", "roleName", "passive", "challenge", "unlockRequirements",
  "live", "comingSoon", "unlock", "residents", "lowHp", "dmgTaken", "typeBoost", "contact", "fullHp", "nativeFallback", "repeats", "goal", "counter", "reward", "costs", "stats", "bst", "gen", "family", "evoFrom", "evoLevel", "evoItem",
  "member", "level", "look", "style", "palette", "questId", "cosmeticKey", "rule", "cat"];
const unsafeKey = /token|cookie|password|secret|credential|authorization|session|email|account|profile|localstorage|^(?:app|player|run|private)$/i;
function publicValue(value, depth = 0) {
  if (depth > 8 || value == null || typeof value === "function") return null;
  if (["string", "number", "boolean"].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.slice(0, 2000).map((entry) => publicValue(entry, depth + 1));
  if (typeof value !== "object") return null;
  return Object.fromEntries(Object.keys(value).filter((key) => !unsafeKey.test(key)).map((key) => [key, value[key]])
    .filter(([, item]) => typeof item !== "function").map(([key, item]) => [key, publicValue(item, depth + 1)]));
}

// Source fingerprints can change while every public effect stays equal. Keep
// genuine historical differences, but do not recursively duplicate a whole
// current table merely because the deployment/version changed. Raw reviewed
// snapshots and original public build provenance are preserved separately.
const historicalDetailKey = key => /^(?:上版公开详情|离线原生派生参考|离线本作定义参考)（/.test(key);
function samePublicDetail(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object" ||
      Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left)) return left.length === right.length && left.every((value, index) => samePublicDetail(value, right[index]));
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && samePublicDetail(left[key], right[key]));
}
export function compactHistoricalDetails(details) {
  if (!details || typeof details !== "object" || Array.isArray(details)) return details;
  const historical = Object.keys(details).filter(historicalDetailKey);
  if (!historical.length) return details;
  const current = Object.fromEntries(Object.entries(details).filter(([key]) => !historicalDetailKey(key)));
  const distinct = record => {
    if (!record || typeof record !== "object" || Array.isArray(record)) return record;
    const result = {};
    for (const [key, value] of Object.entries(record)) {
      if (historicalDetailKey(key)) {
        const nested = distinct(value);
        if (nested && (typeof nested !== "object" || Object.keys(nested).length)) result[key] = nested;
      } else if (!Object.hasOwn(current, key) || !samePublicDetail(value, current[key])) result[key] = value;
    }
    return result;
  };
  const output = { ...current };
  for (const key of historical) {
    const previous = distinct(details[key]);
    if (previous && (typeof previous !== "object" || Object.keys(previous).length)) output[key] = previous;
  }
  return output;
}

export function buildRuntimeEncyclopedia(publicDefinitions = {}, base = {}) {
  // A missing optional offline base is different from an invalid native
  // definition payload. Do not turn a previous null result into a second,
  // unrelated `.entries` exception or label absent live definitions verified.
  if (!publicDefinitions || typeof publicDefinitions !== "object" || Array.isArray(publicDefinitions))
    throw new TypeError("公开运行时定义必须为对象");
  base = base && typeof base === "object" && !Array.isArray(base) ? base : {};
  const result = new Map((Array.isArray(base.entries) ? base.entries : [])
    .filter((entry) => entry && typeof entry === "object" && typeof entry.id === "string").map((entry) => [entry.id, entry]));
  if (publicDefinitions.sourceHash) for (const [id, entry] of result) {
    if (entry.source?.sourceHash && entry.source.sourceHash !== publicDefinitions.sourceHash &&
      !["historical", "base-data", "unknown"].includes(entry.availability?.state))
      result.set(id, { ...entry, availability: { state: "historical", label: "上版公开定义，当前版本尚未重新核对" } });
  }
  const fields = { pokemon: "pokemon", characters: "characters", roster: "characters", moves: "moves", fusionMoves: "moves", items: "items", vitamins: "vitamins",
    abilities: "abilities", passives: "passives", maps: "maps", biomes: "maps", modes: "modes", lab: "lab", quests: "quests", masteryLooks: "guides", treasureLooks:"guides" };
  const values = (collection) => Array.isArray(collection) ? collection : collection instanceof Map ? [...collection.values()] : [];
  for (const [field, category] of Object.entries(fields)) for (const raw of values(publicDefinitions[field])) {
    const mastery = field === "masteryLooks" && Number.isInteger(raw?.member) && [1,2].includes(raw.level),
      treasure=field==='treasureLooks'&&Number.isInteger(raw?.member)&&[3,4].includes(raw.level),nativeLook=mastery||treasure;
    if (!raw || typeof raw !== "object" || (!nativeLook && raw.key == null && raw.id == null)) continue;
    const key = nativeLook ? `look:${raw.member}:${raw.level}` : String(category === "characters" && raw.id != null ? raw.id : raw.key ?? raw.id), id = `${category}:${key}`;
    const previous = result.get(id);
    const liveDetails = Object.fromEntries(definitionFields.filter((name) => raw[name] !== undefined).map((name) => [name, publicValue(raw[name])]));
    const changedSource = previous?.source?.sourceHash && publicDefinitions.sourceHash && previous.source.sourceHash !== publicDefinitions.sourceHash;
    const retained = changedSource ? { [`上版公开详情（${previous.source.gameVersion || "版本未知"}）`]: publicValue(previous.details || {}) } : previous?.details || {};
    let details = { ...retained, ...liveDetails };
    if (field === "fusionMoves" && publicDefinitions.fusionInheritance)
      details.升级继承规则 = publicValue(publicDefinitions.fusionInheritance);
    if(field==="fusionMoves"){
      const explanation=fusionEncyclopediaDetails(raw.recipe?.info);
      if(explanation)details.官方融合说明=explanation;
    }
    if (category === "moves" && ["dmg", "cd", "count", "area", "speed", "dur", "pierce"].some((key) => Number.isFinite(raw[key]))) details.当前原生派生 = publicValue(liveDetails);
    details = compactHistoricalDetails(details);
    const activeMap = category === "maps" && raw.live === true;
    const inactiveMap = category === "maps" && (raw.live === false || raw.comingSoon === true);
    const availability = inactiveMap ? { state: "future", label: "原生目录定义，当前未开放" }
      : activeMap ? { state: "live", label: "原生开放地图；仍需账号解锁" }
      : category === "pokemon" ? { state: "base-data", label: "基础图鉴；不表示可作为开局角色" }
      : { state: "current", label: "当前原生公开定义；资格和机制以游戏为准" };
    const effectText = formatEncyclopediaMods(raw.mods);
    const nativeDescription = String(raw.desc || raw.description || previous?.description || "暂无公开效果说明，请以原生游戏提示为准。");
    const description = nativeDescription + (mastery ? " 此为游戏原生衣橱外观；需要本人加入联盟，达成专属成就后领取并保存对应 cosmetics 奖励，再在游戏联盟衣橱装备。本机导入 PNG 外观独立，不解锁原生衣橱；已装备 skins 不代替奖励拥有回执。" : treasure ? " 此为原生宝藏外观；正常对局获得 Bonkoin 后通过对应宝藏奖池抽取，保存收藏后且拥有该联盟角色才可使用。每个奖品不会重复抽出，抽奖结果由游戏服务器决定。" : "") + (effectText ? " 本作属性：" + effectText : "") +
      (typeof raw.note === "string" && raw.note ? " " + raw.note : "");
    result.set(id, { id, category, name: String(raw.name || previous?.name || key),
      subtitle: nativeLook ? `原生衣橱 · #${raw.member} · ${raw.look}${mastery?' · '+raw.questId:''}` : String(raw.nameEn || raw.key || raw.id), description,
      keywords: [key, String(raw.id ?? ""), String(raw.key ?? ""), String(raw.nameEn || ""), ...(Array.isArray(raw.types) ? raw.types : [])], details,
      source: { url: "https://pokebonk.com/", label: "当前游戏公开定义（运行时同步）", gameVersion: publicDefinitions.gameVersion || base.gameVersion || null,
        verifiedAt: publicDefinitions.verifiedAt || base.verifiedAt || null, sourceHash: typeof publicDefinitions.sourceHash === "string" ? publicDefinitions.sourceHash : null }, availability });
  }
  return { schemaVersion: 1, categories: encyclopediaCategories, entries: [...result.values()],
    gameVersion: typeof publicDefinitions.gameVersion === "string" ? publicDefinitions.gameVersion : base.gameVersion,
    verifiedAt: publicDefinitions.verifiedAt || base.verifiedAt || null,
    notes: [...(Array.isArray(base.notes) ? base.notes : []), "运行时仅合并公开定义；没有读取账号解锁或私人会话。新增定义不等于新增机制已验证。"] };
}

// Mutable official JSON can update without a new App bundle. Refresh base
// references first; buildRuntimeEncyclopedia then overlays actual game effects.
export function buildPublicResourceEncyclopedia(resources = {}, localization = {}, base = {}) {
  if (!resources || typeof resources !== "object" || Array.isArray(resources))
    throw new TypeError("公开基础资源必须为对象");
  base = base && typeof base === "object" && !Array.isArray(base) ? base : {};
  const entries = new Map((Array.isArray(base.entries) ? base.entries : [])
    .filter((entry) => entry && typeof entry === "object" && typeof entry.id === "string").map((entry) => [entry.id, entry]));
  const names = localization && typeof localization === "object" ? localization : {};
  const library=createGameLibrary({pokemon:resources.pokemon,localization:names,sourceHash:resources.sourceHash,gameVersion:resources.gameVersion});
  const translated = (group, id, fallback) => {
    const value = names[group]?.[id];
    return typeof value === "string" ? value : typeof value?.name === "string" ? value.name : fallback;
  };
  const localizedDescription = (group, id, fallback) => typeof names[group]?.[id]?.desc === "string" ? names[group][id].desc : fallback;
  const types = (value) => (Array.isArray(value) ? value : []).map((type) => `${translated("types", type, type)} (${type})`);
  const metadata = { gameVersion: typeof resources.gameVersion === "string" ? resources.gameVersion : base.gameVersion || null,
    verifiedAt: typeof resources.verifiedAt === "string" ? resources.verifiedAt : base.verifiedAt || null };
  const baseState = { state: "base-data", label: "官方基础资料，不代表本作当前可玩或实际战斗效果" };
  const add = (category, raw, key, name, subtitle, description, details, url) => {
    if (key == null || typeof raw !== "object") return;
    const id = `${category}:${key}`;
    const previous = entries.get(id);
    const changedVersion = previous?.source?.sourceHash && metadata.gameVersion && previous.source.gameVersion && previous.source.gameVersion !== metadata.gameVersion;
    const retained = changedVersion ? { [`上版公开详情（${previous.source.gameVersion}）`]: publicValue(previous.details || {}) } : { ...(previous?.details || {}) };
    if (retained.本作原生派生) {
      retained[`离线原生派生参考（${previous?.source?.gameVersion || base.gameVersion || "版本未知"}）`] = retained.本作原生派生;
      delete retained.本作原生派生;
    }
    if (retained.本作完整定义) {
      retained[`离线本作定义参考（${previous?.source?.gameVersion || base.gameVersion || "版本未知"}）`] = retained.本作完整定义;
      delete retained.本作完整定义;
    }
    entries.set(id, { id, category, name: String(name || key), subtitle: String(subtitle || key), description: String(description || "暂无公开基础描述。"),
      keywords: [String(key), String(raw.id ?? ""), String(raw.name || ""), ...(Array.isArray(raw.types) ? raw.types : [])],
      details: compactHistoricalDetails({ ...retained, ...publicValue(details) }), source: { url, label: "最新官方基础 JSON；非本作实战效果认证", ...metadata }, availability: baseState });
  };
  for (const mon of Array.isArray(resources.pokemon) ? resources.pokemon : []) {
    if (!mon || !Number.isInteger(mon.id)) continue;
    const key = mon.key || String(mon.id);
    add("pokemon", mon, key, library.speciesName(mon.id,mon.name || key), `#${String(mon.id).padStart(3, "0")} · ${mon.name || key} · ${types(mon.types).join(" / ")}`,
      names.flavor?.[mon.id] || mon.flavor || "暂无公开图鉴描述。", { 编号: mon.id, key, 世代: mon.gen, 属性: types(mon.types), 基础种族值: mon.stats,
        种族值总和: mon.bst, family: mon.family, evoFrom: mon.evoFrom, evoLevel: mon.evoLevel, evoStage: mon.evoStage,
        特性编号: mon.abilities || [], 隐藏特性编号: mon.hidden, 捕获率基础: mon.captureRate, 学习表基础: resources.learnsets?.[mon.id] ?? entries.get(`pokemon:${key}`)?.details?.学习表基础 ?? [],
        说明: "基础物种和学习表，不表示能作为开局角色、当前赛季可遇、或已经由辅助验证。" }, "https://pokebonk.com/data/pokemon.json");
  }
  for (const move of Array.isArray(resources.moves) ? resources.moves : []) {
    if (!move || !Number.isInteger(move.id)) continue;
    const key = move.key || String(move.id), kind = { physical: "物理", special: "特殊", status: "变化" }[move.cls] || move.cls || "未知";
    add("moves", move, key, translated("moves", move.id, move.name || key), `#${move.id} · ${key} · ${types([move.type]).join("")}`,
      `基础招式资料：${kind}，威力 ${move.power ?? "未知"}，命中 ${move.accuracy ?? "未提供"}，PP ${move.pp ?? "未知"}。本作实际效果以原生派生为准。`,
      { 编号: move.id, key, 属性: types([move.type]), 类别: kind, 原始基础库: Object.fromEntries(["power", "accuracy", "pp", "priority", "cls", "ailment", "ailmentChance", "drain", "healing", "crit", "flinch", "minHits", "maxHits", "flavor"].filter((field) => move[field] !== undefined).map((field) => [field, move[field]])),
        说明: "原作基础数值，不是本作当前伤害、冷却或招式资格；当前原生定义可覆盖。" }, "https://pokebonk.com/data/moves.json");
  }
  for (const [key, item] of Object.entries(resources.items && typeof resources.items === "object" && !Array.isArray(resources.items) ? resources.items : {})) {
    if (!item || typeof item !== "object") continue;
    add("items", item, key, translated("items", key, item.name || key), `${key} · 原作编号 ${item.id ?? "未知"}`,
      localizedDescription("items", key, item.desc || "暂无原作基础说明。"), { key, 原作编号: item.id, 基础说明: localizedDescription("items", key, item.desc),
        说明: "这是原作基础道具说明，不能当成本作战斗效果；原生玩法定义同步后优先显示本作效果。" }, "https://pokebonk.com/data/items.json");
  }
  for (const [id, ability] of Object.entries(resources.abilities && typeof resources.abilities === "object" && !Array.isArray(resources.abilities) ? resources.abilities : {})) {
    if (!ability || typeof ability !== "object") continue;
    const key = ability.key || id;
    add("abilities", { id, name: ability.name }, key, translated("abilities", id, ability.name || key), `#${id} · ${key}`,
      localizedDescription("abilities", id, ability.desc || "暂无原作基础特性说明。"), { 编号: id, key, 说明: "原作基础特性，不能替代本作角色被动说明。" }, "https://pokebonk.com/data/abilities.json");
  }
  // A learnset-only refresh still updates existing species without requiring the
  // caller to repeat the pokemon resource or revealing any player learned moves.
  if (resources.learnsets && typeof resources.learnsets === "object") for (const [id, entry] of entries) {
    if (entry.category !== "pokemon") continue;
    const dexId = entry.details?.编号;
    if (resources.learnsets[dexId] !== undefined) entries.set(id, { ...entry, details: { ...entry.details, 学习表基础: publicValue(resources.learnsets[dexId]) } });
  }
  return { schemaVersion: 1, categories: encyclopediaCategories, entries: [...entries.values()], ...metadata,
    notes: [...(Array.isArray(base.notes) ? base.notes : []), "公共 JSON 基础资料与当前原生实战定义分别显示；没有读取玩家拥有、解锁或私人状态。"] };
}
