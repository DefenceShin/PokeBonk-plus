// Public native interaction rules plus local navigation memory. This module
// never changes game state, currency, damage, timers, or native availability.
import { reviewedStandardStageCount } from './game-library.mjs';
export const nativeInteractionKinds = Object.freeze([
  "chest", "freechest", "altar", "challenge", "cursed", "cursedchest", "greed",
  "meowth", "ditto", "hypno", "snorlax", "magnet", "berry", "boss", "shrine",
  "portal", "cage", "rock", "shroom", "slots",
  "bill", "fossil", "nest", "porygon", "rhydon", "tower",
]);

// Route searches may keep costs and diagnostics beside their chosen point.
// Only geometry crosses into a world objective: a route cost must never
// overwrite that objective's utility, identity or policy priority.
export function interactionApproachGeometry(point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) return null;
  const geometry = { x: point.x, z: point.z };
  if (Number.isFinite(point.y)) geometry.y = point.y;
  if (Number.isFinite(point.radius) && point.radius >= 0) geometry.radius = point.radius;
  for (const flag of ["nativeWalkUpStairs", "nativeStairInteraction"])
    if (point[flag] === true) geometry[flag] = true;
  return geometry;
}

export const COOP_INTERACTION_FLAGS = Object.freeze({
  chest:"doNotChest",freechest:"doNotFreeChest",altar:"doNotAltar",challenge:"doNotChallenge",
  cursed:"doNotCursed",cursedchest:"doNotCursedChest",greed:"doNotGreed",meowth:"doNotMeowth",
  ditto:"doNotDitto",hypno:"doNotHypno",snorlax:"doNotSnorlax",magnet:"doNotMagnet",berry:"doNotBerry",
  boss:"doNotBoss",shrine:"doNotShrine",portal:"doNotPortal",cage:"doNotCage",rock:"doNotRock",
  shroom:"doNotShroom",slots:"doNotSlots",bill:"doNotBill",fossil:"doNotFossil",nest:"doNotNest",
  porygon:"doNotPorygon",rhydon:"doNotRhydon",tower:"doNotTower",
});

export function normalizeCoopSettings(value = {}) {
  if(!value || typeof value!=="object" || Array.isArray(value))value={};
  return Object.fromEntries(["enabled","waitPortal",...Object.values(COOP_INTERACTION_FLAGS)]
    .map(key=>[key,value[key]===true]));
}

// A local player preference only. Never call a transport, toggle native ready,
// infer a teammate's NPC inventory, or change the game's availability rules.
export function cooperativeInteractionDecision(run, object, settings = {}) {
  if(!run?.coop || settings?.enabled!==true)return {allowed:true,active:false};
  const kind=object?.kind,flag=COOP_INTERACTION_FLAGS[kind];
  if(flag && settings[flag]===true)return {allowed:false,active:true,flag,
    reason:"cooperative-policy-do-not:"+kind};
  if(kind!=="portal" || settings.waitPortal!==true || run.coop.portalReady)
    return {allowed:true,active:true};
  // .847 portalTick already merges fresh position packets and heartbeat
  // fallbacks, excludes downed/out peers and owns the native 40s deadline.
  // Use those current counts rather than reinterpreting stale peer.last flags.
  const nativeInfo=run.coop.portalInfo;
  if(nativeInfo && [nativeInfo.inside,nativeInfo.need].every(Number.isFinite) &&
      nativeInfo.inside>=0 && nativeInfo.need>=nativeInfo.inside &&
      nativeInfo.need>=Number(run.player?.dead!==true) && Array.isArray(nativeInfo.wait)) {
    const localAlive=run.player?.dead!==true,
      activePeers=Math.max(0,nativeInfo.need-Number(localAlive)),
      readyPeers=Math.max(0,nativeInfo.inside-Number(localAlive&&run.coop.portalReady)),
      allowed=readyPeers>0;
    return {allowed,active:true,activePeers,readyPeers,source:"native-portal-info",
      reason:allowed?null:"cooperative-policy-wait-portal"};
  }
  let activePeers=0,readyPeers=0;
  if(typeof run.coop.active==="function")for(const peer of run.coop.active()){
    if(peer.gone || peer.stage!==run.stage || !peer.last || !Number.isFinite(peer.lastAt) ||
        !Number.isFinite(run.realTime) || !(run.realTime-peer.lastAt<12))continue;
    activePeers++;if(peer.last.flags&64)readyPeers++;
  }
  const allowed=readyPeers>0;
  return {allowed,active:true,activePeers,readyPeers,
    reason:allowed ? null : "cooperative-policy-wait-portal"};
}

// Altar charging and bounce mushrooms are proximity actions, not E actions.
// Avoid intentionally entering their native horizontal trigger disks. Native
// knockback, spawns, already-active launches and teammates remain native facts.
export function cooperativePassiveRouteAllowed(run, start, end, settings = {}) {
  if(!run?.coop || settings?.enabled!==true || !settings.doNotAltar && !settings.doNotShroom)return true;
  if(![start?.x,start?.z,end?.x,end?.z].every(Number.isFinite))return false;
  const dx=end.x-start.x,dz=end.z-start.z,length=dx*dx+dz*dz;
  for(const object of run.interactables?.list || []){
    if(object.kind==="altar" ? !settings.doNotAltar || object.used :
      object.kind!=="shroom" || !settings.doNotShroom)continue;
    if(![object.x,object.z,object.r].every(Number.isFinite) || !(object.r>0))continue;
    if(object.kind==="shroom" && [start.y,end.y,object.y].every(Number.isFinite) && Math.min(start.y,end.y)>object.y+1)continue;
    const radius=object.r+.2,sx=start.x-object.x,sz=start.z-object.z,from=Math.hypot(sx,sz),
      to=Math.hypot(end.x-object.x,end.z-object.z);
    if(from<radius){
      if(to>from+1e-7 && sx*dx+sz*dz>=-1e-7)continue;
      return false;
    }
    const t=length ? Math.max(0,Math.min(1,-(sx*dx+sz*dz)/length)) : 0;
    if(Math.hypot(sx+dx*t,sz+dz*t)<radius)return false;
  }
  return true;
}

// .832 clears an already entered cooperative portal only after the local
// player leaves its <9m disk. With a current stay/never-enter preference, use
// ordinary movement to leave; never forge native readiness or cancel go().
// The extra margin avoids repeatedly touching the native boundary. A player
// already inside may move outward, including through the enclosing disk.
export function cooperativeReadyPortalRouteAllowed(run, start, end, suppress = false) {
  if(!suppress || !run?.coop?.portalReady || run.coop.advancing)return true;
  if(![start?.x,start?.z,end?.x,end?.z].every(Number.isFinite))return false;
  const dx=end.x-start.x,dz=end.z-start.z,length=dx*dx+dz*dz;
  for(const object of run.interactables?.list || []) {
    if(object.kind!=="portal" || ![object.x,object.z].every(Number.isFinite))continue;
    const radius=9.4,sx=start.x-object.x,sz=start.z-object.z,
      from=Math.hypot(sx,sz),to=Math.hypot(end.x-object.x,end.z-object.z);
    if(from<radius) {
      if(to>from+1e-7 && sx*dx+sz*dz>=-1e-7)continue;
      return false;
    }
    const t=length?Math.max(0,Math.min(1,-(sx*dx+sz*dz)/length)):0;
    if(Math.hypot(sx+dx*t,sz+dz*t)<radius)return false;
  }
  return true;
}

export function cooperativeReadyPortalEscapeCandidates(run, suppress = false) {
  if(!suppress || !run?.coop?.portalReady || run.coop.advancing)return [];
  const pos=run.player?.pos;if(![pos?.x,pos?.z].every(Number.isFinite))return [];
  const portals=(run.interactables?.list || []).filter(object=>object.kind==="portal"&&[object.x,object.z].every(Number.isFinite)),
    enclosing=portals.filter(object=>Math.hypot(pos.x-object.x,pos.z-object.z)<9.4),candidates=[];
  for(const portal of enclosing) {
    const base=Math.atan2(pos.z-portal.z,pos.x-portal.x);
    for(let index=0;index<16;index++) {
      const angle=base+index*Math.PI/8,point={x:portal.x+Math.cos(angle)*9.8,z:portal.z+Math.sin(angle)*9.8};
      if(portals.some(other=>Math.hypot(point.x-other.x,point.z-other.z)<9.4)||
          !cooperativeReadyPortalRouteAllowed(run,pos,point,true))continue;
      candidates.push({...point,distance:Math.hypot(point.x-pos.x,point.z-pos.z)});
    }
  }
  return candidates.sort((a,b)=>a.distance-b.distance);
}
const navigationReusableKinds = new Set(["meowth", "hypno", "portal"]);
export function nativeInteractionRepeatable(object) {
  return navigationReusableKinds.has(object?.kind) || object?.kind === "tower" &&
    ["stairs", "portal", "leave"].includes(object.data?.sub);
}
// Closing a slots or copy page does not consume the native landmark. Remember
// the completed visit separately; this must not relax their native used rules.
const navigationVisitKinds = new Set([
  "meowth",
  "hypno",
  "slots",
  "ditto",
  "bill", "fossil", "porygon", "tower",
]);
const navigationFreeKinds = new Set([
  "freechest",
  "rock",
  "berry",
  "magnet",
  "ditto",
  "snorlax",
  "altar",
  "bill", "nest",
  "bonk",
]);

// .847 Bonkoin is a passive world object, deliberately absent from the E
// interaction/coop-avoidance flags. Native HS attracts it within 7m after
// data.age>=.9 and consumes it only within 1.5m; no interaction key is needed.
export function isNativePassivePickup(object) {
  return object?.kind === "bonk";
}

// stageTime is reset by native nextStage(), unlike run.time. Never accumulate
// a new timer from helper frames: reconnecting midway must retain real elapsed.
export function shinyStageDwell(run, settings = {}, plan = {}) {
  const requested = settings?.shinyStageWait === true &&
    (settings?.mode === "shiny" || plan?.goalMode === "shiny" || plan?.objective === "shiny") &&
    !run?.tower && !run?.endless && run?.state !== "over";
  const stageCount = reviewedStandardStageCount(run?.biome);
  const finalCleared = requested && run?.stageCleared === true && stageCount !== null &&
    Number.isInteger(run?.stage) && run.stage >= stageCount;
  // The ordinary per-stage timer is not an instruction to keep a completed
  // final arena open. Only the separate opt-in extends that timer past its
  // real final clear; native victory, saving and mandatory choices stay native.
  const skipFinal = finalCleared && settings?.shinyStayAfterFinalClear !== true;
  const enabled = requested && !skipFinal;
  const configured = Number(settings?.shinyStageWaitSeconds);
  const seconds = Number.isFinite(configured) && configured > 0 ? Math.min(86400, configured) : 600;
  const elapsed = Number.isFinite(run?.stageTime) && run.stageTime >= 0 ? run.stageTime : null;
  return { enabled, requested, finalCleared, skipFinal, seconds, elapsed, holding: enabled && elapsed != null && elapsed < seconds,
    remaining: enabled && elapsed != null ? Math.max(0, seconds - elapsed) : 0 };
}

// World.update chooses the closest usable landmark (cooperative portals get
// a native two-metre bias). A large arrival disk can otherwise stop on another
// landmark's side of that boundary, never deliver E to the intended reward,
// then incorrectly retire it as an unproductive visit. Refine geometry only;
// eligibility, utility and the actual native nearest/E owner remain unchanged.
export function nativeNearestApproach(run, object, proposal, options = {}) {
  if (!run?.player?.pos || !object || !proposal || proposal.nativeWalkUpStairs===true ||
      ["altar","shroom","bonk"].includes(object.kind)) return proposal;
  if(![run.player.pos.x,run.player.pos.z,object.x,object.z,object.r,proposal.x,proposal.z,proposal.radius].every(Number.isFinite)||
      object.r<=0||proposal.radius<0)return proposal;
  const usable = (Number(object.r) || 2.6) + .8,nearest=run.interactables?.nearest,pos=run.player.pos;
  // The real dispatcher already reports the selected landmark, or there is
  // not yet an E owner to resolve. Only inspect neighbours at an actual close
  // conflict; ordinary travel and successful approaches do no extra scan.
  if(!nearest||nearest===object||Math.hypot(pos.x-object.x,pos.z-object.z)>usable+1)return proposal;
  const reusable = row => !row.used || ["meowth","hypno","portal"].includes(row.kind) ||
    row.kind === "tower" && row.data?.sub !== "trick";
  const others = (run.interactables?.list || []).filter(row => row !== object && reusable(row) &&
    !["altar","shroom"].includes(row.kind) && [row.x,row.z,row.r].every(Number.isFinite) &&
    Math.hypot(row.x-object.x,row.z-object.z)<usable+row.r+.8);
  if (!others.length) return proposal;
  const bias = row => run.coop && row.kind === "portal" ? 2 : 0,
    owns = point => {
      const radius=Math.max(0,Number(point.radius)||0),d=Math.hypot(point.x-object.x,point.z-object.z);
      if(d+radius>=usable-.02)return false;
      return others.every(row=>{
        const other=Math.hypot(point.x-row.x,point.z-row.z);
        return other-radius>=row.r+.8 || other-bias(row)>d-bias(object)+radius*2+.04;
      });
    };
  if (owns(proposal)) return proposal;
  const valid = point => owns(point) && (!options.validPoint || options.validPoint(point)),
    candidates=[{x:object.x,z:object.z,radius:.15}];
  for(const scale of [.45,.8])for(let index=0;index<16;index++){
    const angle=index*Math.PI/8,ring=Math.max(0,usable-.3)*scale;
    candidates.push({x:object.x+Math.cos(angle)*ring,z:object.z+Math.sin(angle)*ring,radius:.15});
  }
  const winner=candidates.filter(valid).sort((a,b)=>
    Math.hypot(a.x-pos.x,a.z-pos.z)-Math.hypot(b.x-pos.x,b.z-pos.z))[0];
  // Overlapping identical landmarks or an inaccessible exclusive region must
  // retain the existing bounded retry/progression policy, never manufacture E.
  if(!winner)return proposal;
  const y=run.terrain?.height?.(winner.x,winner.z);
  if(Number.isFinite(proposal.y)&&!Number.isFinite(y))return proposal;
  return {...proposal,...winner,...(Number.isFinite(y)?{y}:{})};
}

export function interactionTargetId(object) {
  if (!object || typeof object !== "object") return null;
  const kind = String(object.kind || "unknown");
  if (!Number.isFinite(object.x) || !Number.isFinite(object.z)) return null;
  const nativeId = object.id ?? object.uid;
  if (["string", "number"].includes(typeof nativeId))
    return `interaction:${kind}:id:${String(nativeId)}`;
  // Native landmark coordinates remain stable through a stage. Four decimal
  // places also retain identity when the caller reconstructs a public snapshot.
  return `interaction:${kind}:${object.x.toFixed(4)}:${object.z.toFixed(4)}`;
}

export function nativeWorldInteractionCost(run, object) {
  if (!run || !object) return NaN;
  if (object.kind === "chest") {
    if (object.data?.gift) return 0;
    return typeof run.interactables?.chestCost === "function"
      ? Number(run.interactables.chestCost())
      : NaN;
  }
  if (object.kind === "cage")
    return typeof run.interactables?.cageCost === "function"
      ? Number(run.interactables.cageCost())
      : NaN;
  if (object.kind === "slots") {
    const chest =
      typeof run.interactables?.chestCost === "function"
        ? Number(run.interactables.chestCost())
        : NaN;
    if (!Number.isFinite(chest)) return NaN;
    return Math.max(
      5,
      Math.round(0.4 * chest * 1.08 ** (Number(run.slotSpins) || 0)),
    );
  }
  const explicit = Number(object.cost ?? 0);
  return Number.isFinite(explicit) && explicit >= 0 ? explicit : NaN;
}

function navigationSpendingAllowed(cost, run, options) {
  if (typeof options.canSpend === "function")
    return options.canSpend(cost) === true;
  const rules = options.rules || {},
    gold = Number(run.gold),
    spent = Math.max(0, Number(options.spent) || 0);
  return (
    Number.isFinite(cost) &&
    cost >= 0 &&
    Number.isFinite(gold) &&
    (cost === 0
      ? rules.free !== false
      : rules.paid !== false &&
        gold - cost >= Math.max(0, Number(rules.goldReserve) || 0) &&
        (rules.maxSpend == null ||
          cost <= Math.max(0, Number(rules.maxSpend) || 0)) &&
        (rules.totalBudget == null ||
          spent + cost <= Math.max(0, Number(rules.totalBudget) || 0)))
  );
}

function navigationShopStock(run, options) {
  if (!Array.isArray(run.shop?.stock)) return null;
  const nativeShopStage = run.endless
    ? 100 + (Number(run.endless.shopVisit) || 0)
    : run.tower ? 200 + Number(run.tower.floor) : run.stage;
  if (run.shop.stage != null && run.shop.stage !== nativeShopStage) return null;
  return run.shop.stock.filter((entry) => {
    if (!entry || entry.sold || !Number.isFinite(Number(entry.price)))
      return false;
    if (
      typeof run.player?.canHold === "function" &&
      !run.player.canHold(entry.key)
    )
      return false;
    if (
      typeof options.shopItemAllowed === "function" &&
      !options.shopItemAllowed(entry)
    )
      return false;
    return true;
  });
}

function navigationHeldItems(player) {
  if (player.items instanceof Map || Array.isArray(player.items))
    return [...player.items];
  return [];
}

// Eligibility describes only facts visible in the current native run. Caller
// specific plan/arena checks can additionally deny an otherwise useful target.
export function describeWorldInteraction(run, object, options = {}) {
  const kind = object?.kind,
    rules = options.rules || {},
    player = run?.player || {};
  const hpRatio =
    Number(player.maxHp) > 0 ? Number(player.hp) / Number(player.maxHp) : 1;
  const cost = nativeWorldInteractionCost(run, object);
  const paid =
    kind === "meowth" ||
    kind === "slots" ||
    (Number.isFinite(cost) && cost > 0);
  const free =
    !paid &&
    (navigationFreeKinds.has(kind) || (kind === "chest" && object?.data?.gift));
  const result = {
    id: interactionTargetId(object),
    kind,
    cost,
    paid,
    free,
    // This is an ordering group, not an arbitrary score bonus. The caller keeps
    // mandatory boss/portal/capture objectives outside the optional loot group.
    priorityBand: free ? 2 : paid ? 1 : 0,
    eligible: true,
    reason: null,
    conditionKey: "",
    progress: Number(object?.charge) || 0,
  };
  const deny = (reason) => {
    result.eligible = false;
    result.reason = reason;
    return result;
  };
  if (!run || !object || !result.id) return deny("invalid-target");
  if (!nativeInteractionKinds.includes(kind) && !isNativePassivePickup(object)) return deny("unknown-native-interaction");
  if (isNativePassivePickup(object) && options.pickupBonkoin !== true) return deny("bonkoin-pickup-disabled");
  if (object.used && !nativeInteractionRepeatable(object)) return deny("used");
  if (
    Array.isArray(run.interactables?.list) &&
    (options.nativeObjects ? !options.nativeObjects.has(object) : !run.interactables.list.some(
      (entry) => entry === object || interactionTargetId(entry) === result.id,
    ))
  )
    return deny("missing");
  if (options.available === false) return deny("unavailable");
  if (
    Number.isFinite(options.readyAt) &&
    Number(run.stageTime) < options.readyAt
  )
    return deny("not-ready");
  if (kind === "altar" && object.data?.sealed) return deny("sealed");
  if (kind === "nest" && run.egg) return deny("already-carrying-egg");
  if (kind === "bill" && options.canFuse !== true) return deny("no-ready-fusion");
  if (kind === "rhydon" && (run.bossSpawned || Number(run.roars) >= 3)) return deny("roar-unavailable");
  if (["fossil", "porygon", "rhydon"].includes(kind) &&
      (rules.risky !== true || options.allowRisky !== true)) return deny("permanent-cost-not-approved");
  if (["fossil", "porygon"].includes(kind) && options.tradeUseful === false) return deny("no-useful-trade");
  if (kind === "tower") {
    const sub = object.data?.sub, tower = run.tower;
    if (!tower || !["stairs", "altar", "trick", "portal", "leave"].includes(sub)) return deny("unknown-tower-action");
    if (["stairs", "altar"].includes(sub) && tower.state !== "clear") return deny("tower-floor-not-cleared");
    if (sub === "portal" && (!tower.roof || !tower.won || options.allowBeyond !== true)) return deny("beyond-not-approved");
    if (sub === "leave" && (!tower.roof || !tower.won || options.allowBeyond === true ||
        run.interactables?.list?.some(entry => entry.kind === "tower" && entry.data?.sub === "stairs"))) return deny("tower-goal-not-finished");
    if (["altar", "trick"].includes(sub)) {
      if (rules.free === false && !(sub === "trick" && options.allowTowerTrick === true) ||
          sub === "altar" && rules.shrine === false) return deny("free-disabled");
      result.free = true; result.priorityBand = 2;
    }
  }
  if (object.data?.comet && Number(object.data.life) <= 0)
    return deny("expired");
  if (
    kind === "shroom" ||
    (["cursed", "cursedchest", "greed"].includes(kind) &&
      (rules.risky !== true || options.allowRisky !== true)) ||
    (kind === "challenge" && options.allowChallenge !== true)
  )
    return deny("optional-risk");
  if (free && rules.free === false) return deny("free-disabled");
  if (paid && rules.paid === false && !(kind==="meowth"&&options.previewShop===true)) return deny("paid-disabled");
  if (
    Number.isFinite(cost) &&
    cost > 0 &&
    !navigationSpendingAllowed(cost, run, options)
  )
    return deny("unaffordable");
  if (["chest", "cage", "slots"].includes(kind) && !Number.isFinite(cost))
    return deny("unknown-cost");
  if (kind === "berry" && (rules.healing === false || hpRatio >= 0.95&&options.berryCounterPending!==true))
    return deny(
      rules.healing === false ? "healing-disabled" : "healing-not-needed",
    );
  if (kind === "altar" && rules.shrine === false)
    return deny("shrine-disabled");
  if (
    kind === "ditto" &&
    (rules.copy === false ||
      options.canCopy === false ||
      (options.canCopy == null && !player.items?.size))
  )
    return deny(rules.copy === false ? "copy-disabled" : "nothing-copyable");
  if (kind === "hypno" && (rules.tutor === false || options.canTutor === false))
    return deny("tutor-disabled");
  if (
    kind === "slots" &&
    (rules.roulette === false ||
      options.safeMode !== false ||
      hpRatio < 0.75 ||
      run.boss?.alive)
  )
    return deny("roulette-risk");
  const pickupCount = Math.max(0, Number(run.pickups?.count) || 0);
  if (
    kind === "magnet" &&
    ((Number(run.pickups?.magnetAll) || 0) > 0 ||
      pickupCount < (options.minimumMagnetPickups ?? 10))
  )
    return deny("magnet-not-needed");
  const stock = kind === "meowth" ? navigationShopStock(run, options) : null;
  if (kind === "meowth") {
    if (rules.shop === false && options.previewShop !== true) return deny("shop-disabled");
    if (
      stock && options.shopRerollAllowed !== true && options.canRefreshShop !== true && options.previewShop !== true &&
      !stock.some((entry) =>
        navigationSpendingAllowed(Number(entry.price), run, options),
      )
    )
      return deny(stock.length ? "unaffordable-stock" : "no-useful-stock");
    if (
      !stock && options.previewShop !== true &&
      (Number(run.gold) <= Math.max(0, Number(rules.goldReserve) || 0) ||
        (rules.totalBudget != null &&
          Math.max(0, Number(options.spent) || 0) >=
            Math.max(0, Number(rules.totalBudget) || 0)) ||
        (rules.maxSpend != null && Number(rules.maxSpend) <= 0))
    )
      return deny("no-shop-budget");
  }
  const enemies = run.enemies || {},
    alive = enemies.alive || [];
  let bodies = 0;
  for (let index = 0; options.ignoreEnemyThreats!==true&&index < (enemies.n ?? alive.length); index++)
    if (
      alive[index] &&
      Number.isFinite(enemies.x?.[index]) &&
      Math.hypot(enemies.x[index] - object.x, enemies.z[index] - object.z) <
        4 + (enemies.radius?.[index] || 0)
    )
      bodies++;
  if (hpRatio < 0.18 && bodies > 0 && kind !== "berry")
    return deny("critical-danger");
  if (
    options.safeMode !== false &&
    (bodies >= 5 || (hpRatio < 0.45 && bodies > 0)) &&
    kind !== "berry"
  )
    return deny("survival-detour");
  // Do not include the clock or every incremental gold pickup here. Failed
  // affordable targets only retry when their relevant native conditions change.
  result.conditionKey = JSON.stringify({
    kind,
    cost,
    paid: rules.paid !== false,
    free: rules.free !== false,
    affordable:
      !paid ||
      (kind === "meowth"
        ? (stock?.map((entry) => [
            entry.key,
            entry.price,
            navigationSpendingAllowed(Number(entry.price), run, options),
          ]) ?? Number(run.gold) > Math.max(0, Number(rules.goldReserve) || 0))
        : navigationSpendingAllowed(cost, run, options)),
    copy:
      kind === "ditto"
        ? (options.copyKey ?? navigationHeldItems(player))
        : undefined,
    tutor:
      kind === "hypno"
        ? (options.tutorKey ??
          (player.moves || [])
            .filter(Boolean)
            .map((move) => move.def?.key ?? move.key ?? move.id))
        : undefined,
    healed: kind === "berry" ? hpRatio >= 0.95 : undefined,
    available: options.available !== false,
    shopReroll: kind === "meowth" && options.shopRerollAllowed === true ? options.shopRerollKey : undefined,
    sealed: !!object.data?.sealed,
    egg: kind === "nest" ? !!run.egg : undefined,
    fusion: kind === "bill" ? options.fusionKey : undefined,
    risky: ["cursed","cursedchest","greed","fossil", "porygon", "rhydon"].includes(kind) ?
      [rules.risky === true, options.allowRisky === true,options.forceCostInteractions===true,
        options.costEffectPriorities,Number(run.roars) || 0] : undefined,
    trade: kind === "porygon" ? object.data?.offers?.map(offer => [offer.key, !!offer.off]) : undefined,
    tower: kind === "tower" ? [object.data?.sub, run.tower?.floor, run.tower?.state, !!run.tower?.beyond,
      options.allowTowerTrick === true] : undefined,
    magnet:
      kind === "magnet"
        ? pickupCount >= (options.minimumMagnetPickups ?? 10) &&
          !(run.pickups?.magnetAll > 0)
        : undefined,
  });
  return result;
}

// Compare two OPTIONAL world-resource targets before applying their normal
// utility/distance score. Unaffordable/disabled targets must be removed first.
export function compareInteractionCandidates(left, right) {
  const leftBand = left.priorityBand ?? left.interaction?.priorityBand ?? 0;
  const rightBand = right.priorityBand ?? right.interaction?.priorityBand ?? 0;
  return (
    rightBand - leftBand ||
    (Number(right.score) || 0) - (Number(left.score) || 0)
  );
}

export function createInteractionTracker(config = {}) {
  const entries = new Map();
  let scopeRun = null,
    scopeStage = null,
    scopeTerrain = null,
    scopeSeed = null,
    scopeList = null,
    synchronizedScope = null,
    activeId = null;
  const progressSeconds = Math.max(1, Number(config.progressSeconds) || 6);
  const cooldownSeconds = Math.max(1, Number(config.cooldownSeconds) || 20);
  const maximumAttempts = Math.max(
    1,
    Math.floor(Number(config.maximumAttempts) || 3),
  );
  const minimumProgress = Math.max(0.05, Number(config.minimumProgress) || 0.7);
  const time = (run) => Math.max(0, Number(run?.time) || 0);
  const resetPursuit = (entry, object) => {
    entry.noProgressFor = 0;
    entry.observedAt = null;
    entry.bestDistance = Infinity;
    entry.lastProgress = Number(object?.charge) || 0;
    entry.routeAnchor = null;
    entry.routeWaypoint = null;
  };
  const routeProgress = (entry, run, observation) => {
    const route = observation.route, pos = run?.player?.pos;
    if (!route?.verified || !pos ||
        ![pos.x, pos.z, route.waypoint?.x, route.waypoint?.z].every(Number.isFinite)) {
      entry.routeAnchor = null; entry.routeWaypoint = null;
      return false;
    }
    let advanced = false;
    if (entry.routeAnchor && entry.routeWaypoint) {
      const dx = pos.x - entry.routeAnchor.x, dz = pos.z - entry.routeAnchor.z;
      const moved = Math.hypot(dx, dz);
      const before = Math.hypot(entry.routeAnchor.x - entry.routeWaypoint.x,
        entry.routeAnchor.z - entry.routeWaypoint.z);
      const after = Math.hypot(pos.x - entry.routeWaypoint.x, pos.z - entry.routeWaypoint.z);
      // Only physical travel toward a previously observed legal segment is
      // evidence. New paths, consumed node counters and target switches alone
      // cannot reset the timer. Position/direction memory survives retries so
      // walking the same loop or shaking across a grid boundary is finite.
      if (moved >= minimumProgress && before - after >= minimumProgress) {
        const heading = ((Math.round(Math.atan2(dz, dx) / (Math.PI / 4)) % 8) + 8) % 8;
        const key = `${Math.round(pos.x)},${Math.round(pos.z)}:${heading}`;
        if (!entry.routeVisited.has(key) && entry.routeVisited.size < 4096) {
          entry.routeVisited.add(key);
          entry.routeProgressCount++;
          advanced = true;
        }
        entry.routeAnchor = { x: pos.x, z: pos.z };
      }
    }
    // Replanning may move the endpoint, but never moves the physical anchor.
    // A moving local waypoint must still require real player displacement.
    if (!entry.routeAnchor || !entry.routeWaypoint) {
      entry.routeAnchor = { x: pos.x, z: pos.z };
    }
    entry.routeWaypoint = { x: route.waypoint.x, z: route.waypoint.z };
    return advanced;
  };
  // The previously observed target remains selected until another target is
  // observed or release() closes that interval. Charge only this selected time
  // to its entry; time spent pursuing another object or in a modal is absent.
  const settleActive = (now) => {
    const previous = entries.get(activeId);
    if (previous?.observedAt != null) {
      previous.noProgressFor += Math.max(
        0,
        Math.min(1, now - previous.observedAt),
      );
      previous.observedAt = now;
    }
  };
  const refreshObject = (object, id) => {
    let entry = entries.get(id);
    // Endless regen restores the same landmark object: previous attempts and
    // cooldown must not suppress its new native generation.
    if (
      !entry ||
      (entry.used &&
        !object.used &&
        !nativeInteractionRepeatable(object))
    ) {
      entry = {
        id,
        object,
        attempts: 0,
        blockedUntil: 0,
        blockedCondition: null,
        reason: null,
        eligibleSince: null,
        observedAt: null,
        bestDistance: Infinity,
        noProgressFor: 0,
        lastProgress: Number(object.charge) || 0,
        pursuitCondition: null,
        approachRevision: 0,
        routeAnchor: null,
        routeWaypoint: null,
        routeVisited: new Set(),
        routeProgressCount: 0,
      };
      entries.set(id, entry);
    }
    entry.object = object;
    entry.used = !!object.used;
    return entry;
  };
  const sync = (run, list = run?.interactables?.list || []) => {
    if (
      scopeRun !== run ||
      scopeStage !== run?.stage ||
      scopeTerrain !== run?.terrain ||
      scopeSeed !== run?.seed
    ) {
      entries.clear();
      activeId = null;
      scopeRun = run;
      scopeStage = run?.stage;
      scopeTerrain = run?.terrain;
      scopeSeed = run?.seed;
    }
    const ids = new Set();
    for (const object of list) {
      const id = interactionTargetId(object);
      if (!id) continue;
      ids.add(id);
      refreshObject(object, id);
    }
    for (const id of entries.keys()) if (!ids.has(id)) entries.delete(id);
    if (!ids.has(activeId)) activeId = null;
    scopeList = list;
    return entries.size;
  };
  // One synchronous candidate scan owns this short-lived membership snapshot.
  // Nothing is cached by time, array length, or across frames. Ordinary public
  // calls still fully synchronize; native used/regen state is read for every
  // requested current object even within a batch. No closure or facade escapes.
  const withSynchronized = (run, callback) => {
    if (typeof callback !== "function") throw new TypeError("A synchronous callback is required");
    const previous = synchronizedScope;
    sync(run);
    synchronizedScope = { run, stage: run?.stage, terrain: run?.terrain,
      seed: run?.seed, list: scopeList, valid: true };
    try { return callback(); }
    finally { synchronizedScope = previous; }
  };
  const get = (run, object) => {
    const batch = synchronizedScope;
    if (!batch?.valid || batch.run !== run || batch.stage !== run?.stage ||
        batch.terrain !== run?.terrain || batch.seed !== run?.seed ||
        batch.list !== run?.interactables?.list || scopeRun !== run ||
        scopeStage !== run?.stage || scopeTerrain !== run?.terrain ||
        scopeSeed !== run?.seed || scopeList !== batch.list) {
      if (batch) batch.valid = false;
      sync(run);
    }
    const id = interactionTargetId(object), entry = entries.get(id);
    // A caller holding an old object with a reused ID must not overwrite the
    // current native object installed by sync(). New/removed membership is
    // observed at the next full synchronous scan, before its candidate loop.
    return entry?.object === object ? refreshObject(object, id) : entry;
  };
  const canTarget = (
    run,
    object,
    description = describeWorldInteraction(run, object),
  ) => {
    const entry = get(run, object);
    if (!entry) return false;
    if (!description.eligible) { entry.eligibleSince = null; return false; }
    entry.eligibleSince ??= time(run);
    if (
      entry.pursuitCondition != null &&
      entry.pursuitCondition !== description.conditionKey
    )
      resetPursuit(entry, object);
    entry.pursuitCondition = description.conditionKey;
    if (
      entry.blockedCondition != null &&
      entry.blockedCondition !== description.conditionKey
    ) {
      entry.blockedCondition = null;
      entry.blockedUntil = 0;
      entry.attempts = 0;
      resetPursuit(entry, object);
    }
    if (entry.blockedCondition != null || entry.blockedUntil > time(run))
      return false;
    if (entry.blockedUntil > 0) {
      entry.blockedUntil = 0;
      entry.attempts = 0;
      resetPursuit(entry, object);
    }
    return true;
  };
  const suppress = (run, object, options = {}) => {
    const entry = get(run, object);
    if (!entry) return false;
    entry.blockedUntil =
      time(run) + Math.max(1, Number(options.seconds) || cooldownSeconds);
    entry.blockedCondition = options.untilChange
      ? String(options.conditionKey ?? "")
      : null;
    entry.reason = options.reason || "no-effect";
    entry.approachRevision++;
    entry.noProgressFor = 0;
    entry.observedAt = null;
    entry.routeAnchor = null;
    entry.routeWaypoint = null;
    if (activeId === entry.id) activeId = null;
    return true;
  };
  const observeTarget = (run, object, observation = {}) => {
    const entry = get(run, object);
    if (!entry) return { blocked: true, reason: "missing" };
    const now = time(run),
      distance = Math.max(0, Number(observation.distance) || 0);
    const progress = Number(observation.progress ?? object.charge) || 0;
    settleActive(now);
    if (activeId !== entry.id) {
      entry.routeAnchor = null;
      entry.routeWaypoint = null;
    }
    if (object.used && !nativeInteractionRepeatable(object))
      return { blocked: true, reason: "used" };
    const alongRoute = routeProgress(entry, run, observation);
    if (
      distance < entry.bestDistance - minimumProgress ||
      progress > entry.lastProgress + 0.003 || alongRoute
    ) {
      // Route progress may temporarily increase straight-line distance. Never
      // raise the global distance best, which would let a loop count it again.
      entry.bestDistance = Math.min(entry.bestDistance, distance);
      entry.noProgressFor = 0;
      entry.lastProgress = progress;
    }
    if (progress < entry.lastProgress - 0.003) entry.lastProgress = progress;
    entry.observedAt = now;
    activeId = entry.id;
    if (entry.noProgressFor >= progressSeconds) {
      const reason = observation.inRange
        ? "interaction-no-progress"
        : "approach-no-progress";
      suppress(run, object, { reason });
      return { blocked: true, reason };
    }
    return { blocked: false, reason: null, noProgressFor: entry.noProgressFor, routeProgress: alongRoute };
  };
  const recordAttempt = (run, object, options = {}) => {
    const entry = get(run, object);
    if (!entry) return false;
    if (
      options.conditionKey != null &&
      entry.attemptCondition !== options.conditionKey
    )
      entry.attempts = 0;
    entry.attemptCondition = options.conditionKey;
    entry.attempts++;
    if (entry.attempts >= maximumAttempts)
      suppress(run, object, { reason: "repeated-no-effect" });
    return true;
  };
  const recordOutcome = (run, object, options = {}) => {
    const entry = get(run, object);
    if (!entry) return false;
    // Only the caller's observed native state change can clear failed attempts.
    // A synthetic key press by itself never counts as a successful interaction.
    if (options.changed === true) {
      entry.attempts = 0;
      entry.blockedUntil = 0;
      entry.blockedCondition = null;
      resetPursuit(entry, object);
    }
    if (options.visitFinished && navigationVisitKinds.has(object.kind))
      suppress(run, object, {
        reason: "visit-finished",
        untilChange: true,
        conditionKey: options.conditionKey ?? "",
      });
    return true;
  };
  const release = () => {
    settleActive(time(scopeRun));
    const entry = entries.get(activeId);
    if (entry) { entry.routeAnchor = null; entry.routeWaypoint = null; }
    activeId = null;
  };
  const inspect = (run, object) => {
    const entry = get(run, object);
    if (!entry) return null;
    const { object: ignored, routeVisited, routeAnchor, routeWaypoint, ...publicEntry } = entry;
    return { ...publicEntry, routeVisitedCount: routeVisited.size,
      routeAnchor: routeAnchor ? { ...routeAnchor } : null,
      routeWaypoint: routeWaypoint ? { ...routeWaypoint } : null };
  };
  return {
    sync,
    withSynchronized,
    canTarget,
    observeTarget,
    recordAttempt,
    recordOutcome,
    suppress,
    release,
    inspect,
  };
}
