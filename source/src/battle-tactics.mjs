import { chooseMotion, compareMotionSafety, combatRange, nativeFootprintWalkClear } from "./policy.mjs";

// Tactical decisions use observed native state. They never change game rules,
// rewards, timers, stats or unlocks. Loadout preferences are intentionally absent.
const tacticNumber = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const tacticClamp = (value, low, high) => Math.min(high, Math.max(low, value));
const tacticDistance = (a, b) => Math.hypot((a?.x || 0) - (b?.x || 0), (a?.z || 0) - (b?.z || 0));

export function normalizeTimedMovementSettings(raw={}) {
  if(!raw||typeof raw!=="object"||Array.isArray(raw))raw={};
  const seconds=value=>typeof value==="number"&&Number.isInteger(value)&&value>=0&&value<=604800?Math.max(0,value):600;
  return {noInteractionsAfter:raw.noInteractionsAfter===true,noInteractionsAfterSeconds:seconds(raw.noInteractionsAfterSeconds),
    fullMapOrbit:raw.fullMapOrbit===true,fullMapOrbitAfterSeconds:seconds(raw.fullMapOrbitAfterSeconds)};
}

export function normalizeFlightSettings(raw={},patch=null) {
  if(!raw||typeof raw!=="object"||Array.isArray(raw))raw={};
  const count=typeof raw.flightJumpItemCount==="number"?raw.flightJumpItemCount:NaN;
  let noInteractions=raw.flightNoInteractions===true,
    keepInteractions=Object.hasOwn(raw,"flightKeepInteractions")?raw.flightKeepInteractions===true:!noInteractions;
  if(patch?.flightNoInteractions===true)keepInteractions=false;
  else if(patch?.flightKeepInteractions===true)noInteractions=false;
  else if(noInteractions)keepInteractions=false;
  return {flightMove:raw.flightMove===true,flightNoInteractions:noInteractions,flightKeepInteractions:keepInteractions,
    flightJumpItemCount:Number.isFinite(count)?tacticClamp(Math.round(count),1,99):5};
}

// Reviewed055 air-balloon grants +1 extra jump and x1.15 jump height. Other
// native abilities/modifiers do not count as owning the requested item.
export function nativeFlightState(run,settings={}) {
  const config=normalizeFlightSettings(settings),timed=normalizeTimedMovementSettings(settings),
    elapsed=Number(run?.time),valid=!!run?.player&&Number.isFinite(elapsed)&&elapsed>=0,
    orbitActive=valid&&timed.fullMapOrbit&&elapsed>=timed.fullMapOrbitAfterSeconds,
    timedNoInteractions=valid&&timed.noInteractionsAfter&&elapsed>=timed.noInteractionsAfterSeconds,
    count=Number(run?.player?.items?.get?.("air-balloon")),
    itemCount=Number.isFinite(count)?Math.max(0,Math.floor(count)):0,
    nativeActive=!!run?.player&&config.flightMove&&itemCount>=config.flightJumpItemCount,
    active=nativeActive||orbitActive,noInteractions=timedNoInteractions||active&&config.flightNoInteractions;
  return {active,nativeActive,orbitActive,timedNoInteractions,noInteractions,
    keepInteractions:active&&!noInteractions&&(orbitActive||config.flightKeepInteractions===true),
    itemCount,threshold:config.flightJumpItemCount,
    reason:timedNoInteractions?"timed-no-interactions":orbitActive?"timed-map-orbit":
      nativeActive?"native-air-balloon-threshold":config.flightMove?"items-below-threshold":"disabled"};
}

export function flightLandingPlan(player,target,terrain,speed=6.3) {
  const height=Math.max(0,tacticNumber(player?.pos?.y)-tacticNumber(terrain?.height?.(player?.pos?.x,player?.pos?.z))),
    vy=tacticNumber(player?.vel?.y),horizontal=Math.hypot(tacticNumber(player?.vel?.x),tacticNumber(player?.vel?.z)),
    fallSeconds=player?.grounded===true?0:Math.max(0,(vy+Math.sqrt(vy*vy+60*height))/30),
    acceleration=Math.max(5,5*Math.max(1,speed)),brakeDistance=horizontal*horizontal/(2*acceleration),
    distance=tacticDistance(player?.pos,target),radius=Math.max(.5,tacticNumber(target?.radius,1.5));
  return {fallSeconds,brakeDistance,height,distance,
    begin:distance<=Math.max(8,radius+4+horizontal*fallSeconds+brakeDistance),
    radius};
}

function flightMotionChoice(state,current) {
  const flight=state.flight,p=state.player;
  if(!flight?.active||state.terrainRecovery?.active||state.terrainHop?.active||state.crowdEscape?.active||
      state.objective?.kind==="altar"||p.anchorT>0||p.slideT>0)return null;
  if(flight.landing&&p.grounded===false){
    const time=Math.max(.2,flight.fallSeconds||0),dx=state.target.x-p.x,dz=state.target.z-p.z,
      desiredX=dx/time,desiredZ=dz/time,desiredLength=Math.hypot(desiredX,desiredZ),
      factor=desiredLength>p.speed*.85?p.speed*.85/desiredLength:1,
      ax=desiredX*factor-(p.vx||0),az=desiredZ*factor-(p.vz||0),a=Math.hypot(ax,az),
      steering=a>.35?{x:ax/a,z:az/a}:{x:0,z:0},
      braking=chooseMotion({...state,canDash:false,predictDash:false,predictJump:false,committedDirection:steering});
    if(!braking.collision&&compareMotionSafety({...braking,score:0,risk:0},{...current,score:0,risk:0})<=0)
      return {...braking,dash:false,jump:false,jumpMove:false,slideMove:false,flightMove:true,
        flightLanding:true,action:"flight-landing"};
    return {...current,dash:false,jump:false,flightMove:true,flightLanding:true};
  }
  if(flight.keepInteractions&&flight.landing&&flight.holdPosition&&p.grounded===true){
    // Real nearest/throw/rescue eligibility has been observed. Brake through
    // native ground friction before E; safety can still choose a real dodge.
    const hold=chooseMotion({...state,target:{x:p.x,z:p.z},canDash:false,predictDash:false,
      predictJump:false,committedDirection:{x:0,z:0}});
    if(!hold.collision&&compareMotionSafety({...hold,score:0,risk:0},{...current,score:0,risk:0})<=0)
      return {...hold,dash:false,jump:false,jumpMove:false,slideMove:false,flightMove:true,
        flightLanding:true,action:"flight-interaction-hold"};
    return {...current,dash:false,jump:false,flightMove:true,flightLanding:true};
  }
  if(!flight.cruising)return null;
  const jump=state.canJump===true&&(state.nativeGroundJumpAllowed===true||p.grounded===true||
      p.jumpsLeft>0&&tacticNumber(p.vy)<=1),
    airborne=chooseMotion({...state,canDash:false,predictDash:false,predictJump:jump});
  if(!airborne.collision&&compareMotionSafety({...airborne,score:0,risk:0},{...current,score:0,risk:0})<=0)
    return {...airborne,dash:false,jump,jumpMove:false,slideMove:false,flightMove:true,
      flightLanding:false,action:jump?"flight-jump":"flight-cruise"};
  return null;
}

// Native Mewtwo Jx.hold starts counter-force at 21.2m around cx/cz and clamps
// at 22.6m. It is not the origin-centred sanctuary ring. These are navigation
// constraints only; never move a circle, player or native collision boundary.
export function nativeMovementCircles(run, margin = 0) {
  const circles = [], inset = Math.max(0, tacticNumber(margin));
  // Player.update clamps every finite arena to arenaR-.3, including ordinary
  // sanctuaries whose Terrain.inBounds still describes the large square world.
  // Keep that physical circle in all route/patrol/flight consumers. Tower's
  // own spawn check uses half the requested margin; retain that same inset.
  const physicalRadius = Number(run?.terrain?.arenaR);
  if (Number.isFinite(physicalRadius) && physicalRadius > .3)
    circles.push({ x: 0, z: 0, radius: Math.max(.05, physicalRadius - Math.max(.3, inset * .5)),
      source: "native-player-arena" });
  const mewtwo = run?.mewtwo;
  if (mewtwo?.active && [mewtwo.cx, mewtwo.cz].every(Number.isFinite))
    circles.push({ x: mewtwo.cx, z: mewtwo.cz, radius: Math.max(.5, 21.2 - inset), source: "mewtwo-confinement" });
  const arena = run?.sanctuary;
  if (arena && arena.phase !== 4 && Number.isFinite(arena.ringR) && arena.ringR > 0)
    circles.push({ x: 0, z: 0, radius: Math.max(.5, arena.ringR - inset), source: "sanctuary-ring" });
  return circles;
}

export function nativeCircleRouteAllowed(run, x, z, margin = 0) {
  if (![x, z].every(Number.isFinite)) return false;
  const pos = run?.player?.pos;
  return nativeMovementCircles(run, margin).every(circle => {
    const after = Math.hypot(x - circle.x, z - circle.z);
    if (after < circle.radius) return true;
    const before = Math.hypot(pos?.x - circle.x, pos?.z - circle.z);
    // Native knockback/shrinking can leave us outside the planning margin.
    // Requiring an immediate endpoint inside would reject every short inward
    // frame and create another permanent edge lock. Permit monotonic recovery.
    return Number.isFinite(before) && before >= circle.radius && after < before - 1e-5;
  });
}

export function confineMovementGoal(run, goal, margin = 2) {
  if (!goal || ![goal.x, goal.z].every(Number.isFinite)) return goal;
  let result = goal;
  for (const circle of nativeMovementCircles(run, margin)) {
    const dx = result.x - circle.x, dz = result.z - circle.z, distance = Math.hypot(dx, dz);
    if (distance <= circle.radius || distance < .001) continue;
    const length = Math.max(.1, circle.radius - .1);
    result = { ...result, x: circle.x + dx / distance * length, z: circle.z + dz / distance * length };
  }
  return result;
}

export function nativePlayerMotionInputs(run) {
  const player=run?.player || {}, hard=run?.coop?.hard===true;
  return { types:player.types, floats:player.floats===true, diving:player.diving===true,
    jumpHeldFor:run?.input?.down?.("Space")===true?1.2:0,
    kx:hard?0:player.kx, kz:hard?0:player.kz,
    crowdX:hard?0:player.crowdX, crowdZ:hard?0:player.crowdZ,
    ...(hard?{externalForces:[],forceX:0,forceZ:0,forceFor:0}:{}) };
}

// The native player reverses movement while charmed, after decrementing its
// status timer for this frame. Counter-steer the input only; the planned world
// direction, status, duration and native movement rules are unchanged.
export function nativeMovementInput(run, direction, frameDt = 0) {
  const dt = Math.max(0, tacticNumber(frameDt));
  const inverted = tacticNumber(run?.player?.pstat?.charm) > dt;
  const sign = inverted ? -1 : 1;
  return { x: tacticNumber(direction?.x) * sign,
    z: tacticNumber(direction?.z) * sign, inverted };
}

// Native .834 ground slide entry. Do not send the same key while airborne:
// native Player.update treats it as a downward dive in that different state.
export function nativeRoutineSlideReady(run) {
  const player=run?.player,status=player?.pstat;
  return run?.state==="play"&&player?.dead!==true&&player?.grounded===true&&
    Number.isFinite(player.slideCd)&&player.slideCd<=0&&!(player.anchorT>0)&&
    !(status?.sleep>0)&&!(status?.frozen>0)&&!(status?.bound>0)&&!run.coop?.inputBlocked;
}
function routineSlideChoice(state,current) {
  if(state.slideMoveAllowed!==true||state.canDash!==true||state.player.grounded!==true||
      current.dash||state.objective?.kind==="altar"||
      !(Math.hypot(current.x||0,current.z||0)>.1))return null;
  const sliding=chooseMotion({...state,predictDash:true,canDash:false});
  return !sliding.collision&&Math.hypot(sliding.x||0,sliding.z||0)>.1&&
    compareMotionSafety({...sliding,score:0,risk:0},{...current,score:0,risk:0})<=0
    ? {...sliding,dash:true,jump:false,jumpMove:false,slideMove:true,action:"slide"}:null;
}

// Enemies.update ticks these three statuses before checking whether ordinary
// steering is suppressed. A status ending on the upcoming simulation step is
// not a stationary body for that step. Native boss/totem/summoner CC immunity
// and the two-second break-out also restore steering in that same update.
// This is a next-step control predicate, not a forecast of future enemy AI.
export function nativeEnemyControlActive(run, index, frameDt = 0) {
  const en = run?.enemies, dt = Math.max(0, tacticNumber(frameDt));
  if (!en) return false;
  const remaining = Math.max(0, tacticNumber(en.sleep?.[index]),
    tacticNumber(en.frozen?.[index]), tacticNumber(en.stun?.[index]));
  if (!(remaining > dt)) return false;
  if ((tacticNumber(en.flags?.[index]) & 12292) &&
      (tacticNumber(en.ccImmune?.[index]) > 0 ||
       tacticNumber(en.ccT?.[index]) + dt >= 2)) return false;
  return true;
}

// Tower continuation is a player choice, not a native risky-interaction gate.
// The native roof portal and every Beyond stair accept a declined curse and
// still climb. Older configs without this choice may follow an explicit depth
// goal; a saved clear choice always wins over an incompatible reward target.
export function resolveTowerPolicy(run, settings = {}, plan = {}) {
  const stored = settings.modeSettings?.tower || {},
    conditions = [plan.eventGoal?.progress, plan.unlockAction?.progress,
      plan.goalProgress?.progressCondition, plan.goalProgress?.action?.progress],
    condition = conditions.find(entry => entry?.key === "halloween26" && entry.kind === "event-counter"),
    selected = settings.eventTargets?.halloween26,
    target = [plan.goalProgress?.requestedId, plan.goalProgress?.targetId, selected]
      .find(id => typeof id === "string" && /^events:halloween26:quest:(?:beyond|abyss|dark)$/.test(id)),
    requiredFloor = condition?.counter === "floor" ? Number(condition.goal) :
      target?.endsWith(":abyss") ? 25 : target?.endsWith(":beyond") ? 15 : null,
    needsContinue = requiredFloor > 7,
    explicitExit = stored.exitPolicy === "clear" || stored.exitPolicy === "continue",
    exitPolicy = explicitExit ? stored.exitPolicy : needsContinue ? "continue" : "clear",
    noCandles = stored.noCandles === true,
    dark4Goal = condition?.counter === "dark4" || target?.endsWith(":dark") === true;
  return { exitPolicy, noCandles, requiredFloor, needsContinue,
    constraintConflict: needsContinue && exitPolicy === "clear",
    avoidCandles: noCandles || dark4Goal && run?.tower?.floor === 4 && !run.tower.beyond,
    candleGoal: condition?.counter === "candles" ? Number(condition.goal) : null,
    dark4Goal };
}

// Candles are automatic proximity charges, not E landmarks. Keep the planned
// segment outside their native <2.4m trigger (with a small planning margin).
// If native knockback already put the player inside, permit a monotonic escape
// rather than trapping them there. This only rejects proposed inputs/routes;
// it never changes a native collider, charge, timer or position.
export function towerCandleRouteAllowed(run, start, end, avoidCandles = false) {
  if (!avoidCandles || !run?.tower || !Array.isArray(run.tower.candles)) return true;
  if (![start?.x, start?.z, end?.x, end?.z].every(Number.isFinite)) return false;
  const dx = end.x - start.x, dz = end.z - start.z, length2 = dx * dx + dz * dz;
  for (const candle of run.tower.candles) {
    if (![candle?.x, candle?.z].every(Number.isFinite)) continue;
    const before = Math.hypot(start.x - candle.x, start.z - candle.z),
      fraction = length2 > 0 ? tacticClamp(((candle.x - start.x) * dx + (candle.z - start.z) * dz) / length2, 0, 1) : 0,
      nearest = Math.hypot(start.x + dx * fraction - candle.x, start.z + dz * fraction - candle.z);
    if (nearest >= 2.55) continue;
    const after = Math.hypot(end.x - candle.x, end.z - candle.z);
    if (!(before < 2.55 && nearest >= before - 1e-7 && after > before + 1e-7)) return false;
  }
  return true;
}

export function towerCandleGoalAllowed(run, goal, radius, avoidCandles = false) {
  if (!avoidCandles || !run?.tower) return true;
  const arrivalRadius = Math.max(0, Number(radius) || 0);
  return !(run.tower.candles || []).some(candle =>
    [candle?.x, candle?.z].every(Number.isFinite) && tacticDistance(goal, candle) + arrivalRadius < 2.55);
}

// Read the current native arena only. These are movement proposals; native
// beam reflection/rod charging and all counters remain owned by the game.
export function achievementMechanicTarget(run,goal) {
  const p=run?.player,kit=run?.boss?.kit,en=run?.enemies,index=run?.boss?.bossIndex,
    species=en?.species?.[index],arena=run?.sanctuary;
  if(!p?.pos||p.dead||run.state!=="play"||!run.boss.alive||!kit||kit.dead||!arena)return null;
  const profile=run.meta?.profile,snap=run.meta?.snap,
    amount=counter=>Math.max(0,tacticNumber(profile?.counters?.[counter])-tacticNumber(snap?.counters?.[counter]));
  const valid=point=>{
    const y=run.terrain?.height?.(point.x,point.z);
    return Number.isFinite(y)&&run.terrain.inBounds?.(point.x,point.z,1)!==false&&
      !run.terrain.hitProp?.(point.x,y+.3,point.z,p.radius || .55)?{...point,y,radius:.45}:null;
  };
  const candidates=[];
  if(goal?.kind==="zapdos-down"&&species===145&&amount("zapdosDown")<(Number(goal.count)||3)) {
    for(const rod of arena.rods || []) {
      if(!rod.active||![rod.x,rod.z].every(Number.isFinite))continue;
      const base=Math.atan2(p.pos.z-rod.z,p.pos.x-rod.x);
      for(let turn=0;turn<8;turn++) {
        const angle=base+turn*Math.PI/4,point=valid({x:rod.x+Math.cos(angle)*2.6,z:rod.z+Math.sin(angle)*2.6});
        if(point)candidates.push({...point,id:"achievement-zapdos-rod",label:"成就目标：靠近原生活跃避雷针，引导闪电鸟自己的雷电"});
      }
    }
  } else if(goal?.kind==="articuno-mirror"&&species===144&&amount("articunoSelf")<1&&
      typeof kit.tracePath==="function"&&!(kit.beam&&kit.beam.t<=0)) {
    for(const column of arena.covers || []) {
      if(!column.alive||column.kind!=="column"||![column.x,column.z,kit.bx,kit.bz].every(Number.isFinite))continue;
      const dx=column.x-kit.bx,dz=column.z-kit.bz,length=Math.hypot(dx,dz);if(length<.1)continue;
      const point=valid({x:column.x+dx/length*2.2,z:column.z+dz/length*2.2});if(!point)continue;
      let trace;try{trace=kit.tracePath(point.x,point.z);}catch{continue;}
      if(trace?.self===true)candidates.push({...point,id:"achievement-articuno-mirror",label:"成就目标：站到真实冰柱后方，引导原生冰冻光束反射"});
    }
  }
  candidates.sort((a,b)=>tacticDistance(p.pos,a)-tacticDistance(p.pos,b));
  return candidates[0] || null;
}

export function towerCandleTarget(run, policy, options = {}) {
  const tower = run?.tower, p = run?.player;
  if (!tower || !p?.pos || policy?.avoidCandles || tower.roof ||
      run.state !== "play" || tower.state === "clear" || tower.floorCurse === "dark") return null;
  const candles = (tower.candles || []).filter(candle =>
    [candle?.x, candle?.y, candle?.z, candle?.lit, candle?.charge].every(Number.isFinite));
  const memorial = tower.def?.memorial && !tower.beyond && tower.state === "guard" && run.boss?.alive &&
      candles.filter(candle => candle.memorial && candle.lit > 0).length < 3,
    lightingGoal = Number.isFinite(policy?.candleGoal) && policy.candleGoal > tacticNumber(tower.candlesLit),
    healing = tower.floorCurse !== "hunger" && p.hp < p.maxHp * .65 &&
      !candles.some(candle => candle.lit > 0 && tacticDistance(p.pos, candle) < 7.2);
  if (!memorial && !lightingGoal && !healing) return null;
  const candidates = candles.map((candle, index) => ({ candle, index }))
    .filter(({ candle, index }) => candle.lit <= 0 && (!memorial || candle.memorial) &&
      (typeof options.eligible !== "function" || options.eligible(candle, index)))
    .sort((a, b) => tacticDistance(p.pos, a.candle) - tacticDistance(p.pos, b.candle));
  for (const { candle, index } of candidates) {
    const d = tacticDistance(p.pos, candle), ux = d > .01 ? (p.pos.x - candle.x) / d : 1,
      uz = d > .01 ? (p.pos.z - candle.z) / d : 0,
      x = candle.x + ux * 1.5, z = candle.z + uz * 1.5,
      y = run.terrain?.height?.(x, z);
    if (!Number.isFinite(y) || Math.abs(y - candle.y) >= 1.5 ||
        run.terrain?.inBounds?.(x, z, 2) === false || run.terrain?.hitProp?.(x, y + .3, z, p.radius || .55)) continue;
    return { x, y, z, radius: .25, id: `tower-candle:${index}`, towerCandle: candle,
      candlePriority: memorial ? 3.5 : 3.2,
      score: memorial ? 12000 : lightingGoal ? 1500 : 1800,
      label: memorial ? "点亮纪念蜡烛，按原生机制平息嘎啦嘎啦" : lightingGoal ? "按活动目标点亮蜡烛" : "点亮原生蜡烛以回复生命" };
  }
  return null;
}

// The purified tower's safe circle moves even while the player is standing
// still. Its mist tests horizontal position (jumping does not avoid it).
// Forecast only this observed native mechanic; never move the native circle.
export function towerHolyHazards(run, frameDt = 1 / 60) {
  const tower = run?.tower, holy = tower?.holy, p = run?.player;
  if (!tower?.def?.purified || tower.beyond || tower.roof ||
      !["wave", "guard"].includes(tower.state) || !holy || !p ||
      ![holy.x, holy.z, holy.k, p.maxHp].every(Number.isFinite) ||
      p.maxHp <= 0 || p.ability === "magic-guard") return [];
  const armor = Number(p.stats?.armor);
  const damage = Number.isFinite(armor) && armor > -45
    ? p.maxHp * 0.012 * 0.5 * 1.6 * Math.max(.00001,45 / (45 + armor)) : null;
  const centerPath = [{ t: 0, x: holy.x, z: holy.z }];
  let x = holy.x, z = holy.z, k = holy.k, elapsed = 0, nextSample = 0.1;
  const step = Math.max(1 / 240, Math.min(0.05, tacticNumber(frameDt, 1 / 60)));
  while (elapsed < 1.2 - 1e-9) {
    const dt = Math.min(step, 1.2 - elapsed);
    k += dt / 16;
    const angle = k * Math.PI * 0.5, blend = Math.min(1, dt * 0.6);
    x += (Math.cos(angle) * 12 - x) * blend;
    z += (Math.sin(angle) * 12 - z) * blend;
    elapsed += dt;
    if (elapsed + 1e-9 >= nextSample || elapsed + 1e-9 >= 1.2) {
      centerPath.push({ t: elapsed, x, z }); nextSample += 0.1;
    }
  }
  return [{ shape: "outside-circle", x: holy.x, z: holy.z,
    // A small boundary margin covers interpolation and frame-time variation.
    radius: 6.35, centerPath, owner: "enemy", persistent: true, life: 1.2,
    damage, source: "tower-holy-mist" }];
}

const nativeContactEnvelopeCache=new WeakMap(),nativeContactEnvelopeBudgets=new WeakMap();
// Native ordinary contact uses feet-to-feet vertical distance. Grant a finite
// envelope only when the observed actor's predicted contact corridor remains
// on the same ground; slopes/steps, air/flying actors and charges stay 2D.
export function clearNativeContactEnvelopes(run) {
  if(run&&typeof run==="object"){nativeContactEnvelopeCache.delete(run);nativeContactEnvelopeBudgets.delete(run);}
}
export function nativeGroundContactEnvelope(run,index) {
  const en=run?.enemies,t=run?.terrain,flags=en?.flags?.[index]||0,
    x=en?.x?.[index],z=en?.z?.[index],y=en?.y?.[index],hgt=en?.hgt?.[index],radius=Number(en?.radius?.[index])||.7,
    vx=(Number(en?.vx?.[index])||0)+(Number(en?.kx?.[index])||0),
    vz=(Number(en?.vz?.[index])||0)+(Number(en?.kz?.[index])||0),speed=Math.hypot(vx,vz),now=Number(run?.time);
  if(!en||!t||typeof t.height!=="function"){
    if(run&&typeof run==="object"){nativeContactEnvelopeCache.delete(run);nativeContactEnvelopeBudgets.delete(run);}return null;
  }
  let scope=nativeContactEnvelopeCache.get(run);
  if(!scope||scope.terrainRef.deref()!==t||scope.stage!==run.stage||scope.heightRef.deref()!==t.height||
      scope.surfaceRef?.deref()!==t.surface||scope.frozen!==t.frozen){
    // Weak identities and numeric-only bounded rows cannot retain an old map
    // scene when the same native run advances without revisiting old indices.
    scope={terrainRef:new WeakRef(t),stage:run.stage,heightRef:new WeakRef(t.height),
      surfaceRef:typeof t.surface==="function"?new WeakRef(t.surface):null,frozen:t.frozen,rows:new Map()};
    nativeContactEnvelopeCache.set(run,scope);
  }
  if(flags&(2|4|16|256|12288)||en.air?.[index]||
      ![x,z,y,hgt,now].every(Number.isFinite)||hgt<=0||speed>10)return null;
  const rows=scope.rows,old=rows.get(index),generation=en.gen?.[index];
  if(old&&old.generation===generation&&now>=old.at&&now-old.at<.12&&radius===old.radius&&
      Math.hypot(x-old.x,z-old.z)<=.01&&Math.abs(y-old.y)<.01&&hgt===old.hgt&&Math.hypot(vx-old.vx,vz-old.vz)<.1){
    rows.delete(index);rows.set(index,old);return old.value;
  }
  const margin=radius+.5+speed*.12,length=speed*1.32,
    steps=Math.max(1,Math.ceil(length/.08)),offsets=[[0,0],[margin,0],[-margin,0],[0,margin],[0,-margin]],
    surface=(x,z)=>typeof t.surface==="function"?t.surface(x,z):t.height(x,z);
  let budget=nativeContactEnvelopeBudgets.get(run);
  if(!budget||budget.at!==now||budget.terrainRef.deref()!==t||budget.stage!==run.stage){
    budget={at:now,terrainRef:new WeakRef(t),stage:run.stage,remaining:2048};nativeContactEnvelopeBudgets.set(run,budget);
  }
  const queries=(steps+1)*offsets.length;
  if(queries>1024||queries>budget.remaining)return null;
  let flat=true;
  for(let step=0;step<=steps&&flat;step++)for(const [ox,oz]of offsets){
    budget.remaining--;
    const at=step/steps*1.32,height=surface(x+vx*at+ox,z+vz*at+oz);
    if(!Number.isFinite(height)||Math.abs(height-y)>.12){flat=false;break;}
  }
  const value=flat?{contactY:y,contactHeight:hgt+.8+.15}:null;
  if(!rows.has(index)&&rows.size>=128)rows.delete(rows.keys().next().value);
  rows.set(index,{generation,at:now,x,z,y,hgt,radius,vx,vz,value});
  return value;
}

export function nativeContactDamageUpperBound(run, index) {
  const raw = Number(run?.enemies?.dmg?.[index]);
  if (!Number.isFinite(raw) || raw < 0) return null;
  // Native caps apply AFTER floors and mitigation. A capped contact is an
  // upper bound for one hit, never an immunity or a cap on a whole slide.
  if ((run.enemies.flags?.[index] || 0) & (2 | 4 | 12288))
    return run.player?.maxHp > 0 ? run.player.maxHp * 0.25 : null;
  const armor = Number(run.player?.stats?.armor);
  if (!Number.isFinite(armor) || armor <= -45) return null;
  return raw * Math.max(0, tacticNumber(run.diff?.enemyDamage, 1)) * 1.6 * Math.max(.00001,45 / (45 + armor));
}

export function nativeProjectileDamageUpperBound(run, index) {
  // Native051 Ghost overrides other projectile bits and never hits actors.
  if (run.projectiles?.flags?.[index] & 4096) return 0;
  const raw = Number(run.projectiles?.dmg?.[index]);
  if (!Number.isFinite(raw) || raw < 0) return null;
  const flags = run.projectiles.flags?.[index] || 0;
  // Hostile capped shots include a floor before the cap; use the cap itself as
  // their conservative per-hit ceiling. Alpha shots have at most a 25% cap.
  if (flags & (1024 | 2048)) return run.player?.maxHp > 0
    ? run.player.maxHp * (flags & 1024 ? 0.15 : 0.25) : null;
  const armor = Number(run.player?.stats?.armor);
  if (!Number.isFinite(armor) || armor <= -45) return null;
  // The factory already applied its own shot multiplier; do not apply it twice.
  return raw * Math.max(0, tacticNumber(run.diff?.enemyDamage, 1)) * 1.6 * Math.max(.00001,45 / (45 + armor));
}

export function assessTacticalState(run, damageLog = []) {
  const p = run.player, maxHp = Math.max(1, tacticNumber(p.maxHp, 100));
  const hp = tacticClamp(tacticNumber(p.hp, maxHp), 0, maxHp);
  const endlessHealing = run.endless ? Math.max(0.3, 1 - 0.025 * Math.max(0, run.time / 60 - 30)) : 1;
  const healingMultiplier = Math.max(0, tacticNumber(p.stats?.healing, 1)) * (p.woundT > 0 ? 0.5 : 1) * endlessHealing;
  const regen = Math.max(0, tacticNumber(p.stats?.regen)) * healingMultiplier;
  const recentLoss = damageLog.filter(hit => hit.stage === run.stage && run.time - hit.time <= 8)
    .reduce((sum, hit) => sum + Math.max(0, tacticNumber(hit.lost)), 0);
  const en = run.enemies || {}, pos = p.pos;
  let close = 0, nearby = 0, unknownClose = 0, contact = 0;
  for (let i = 0; i < (en.n || 0); i++) {
    if (!en.alive?.[i] || en.dying?.[i] > 0 || (en.flags?.[i] || 0) & 16512) continue;
    if (Math.abs(tacticNumber(en.y?.[i]) - tacticNumber(pos.y)) > tacticNumber(en.hgt?.[i], 2) + 1) continue;
    const d = Math.hypot(en.x[i] - pos.x, en.z[i] - pos.z);
    if (d < 13) nearby++;
    if (d < 5 + tacticNumber(en.radius?.[i], 0.7)) {
      close++;
      const damage = nativeContactDamageUpperBound(run, i);
      if (damage == null) unknownClose++;
      else contact = Math.max(contact, damage);
    }
  }
  let nearBullets = 0;
  const pr = run.projectiles || {};
  for (let i = 0; i < (pr.n || 0); i++)
    if (pr.alive?.[i] && (pr.flags?.[i] || 0) & 1 && Math.hypot(pr.x[i] - pos.x, pr.z[i] - pos.z) < 10) nearBullets++;
  const moves = (p.moves || []).filter(Boolean);
  const activeMoves = moves.filter(move => !["buff", "weather"].includes((move.def || move).arch));
  const moveLevels = activeMoves.reduce((sum, move) => sum + Math.max(1, tacticNumber(move.level, 1)), 0);
  const pressure = close * 0.8 + nearby * 0.08 + nearBullets * 0.2 + unknownClose * 0.8;
  const incomingRate = Math.max(recentLoss / 8, contact * Math.min(1.5, close * 0.22));
  return { hp, maxHp, hpRatio: hp / maxHp, regen, healingMultiplier, recentLoss, close, nearby,
    unknownClose, nearBullets, pressure, incomingRate, activeMoves: activeMoves.length, moveLevels,
    damageTaken: Math.max(0, tacticNumber(run.stats?.damageTaken)),
    protectedFor: Math.max(0, tacticNumber(p.iframes), tacticNumber(p.invisT)),
    ultimateReady: run.ult?.ready === true && !(run.ult?.active > 0) };
}

// This requests an ordinary grounded encounter, never a fabricated dodge/hit.
// The motion solver still rejects unknown damage, hard AOE and lethal routes.
export function characterUnlockPracticePlan(run,practice,state=assessTacticalState(run),options={}) {
  const p=run?.player,en=run?.enemies,kind=practice?.source?.key;
  const inactive=reason=>({active:false,reason});
  if(!p||!en||en.n>4096||!practice?.known||practice.met||!['dodges','healed'].includes(kind)||run.state!=='play'||
      p.dead||run.regionCleared||run.boss?.alive||run.mewtwo?.active)return inactive('not-current-safe-practice');
  if(!(state.hpRatio>=.94)||state.pressure>1.8||state.unknownClose>0||state.nearBullets>0||
      state.recentLoss>state.maxHp*.04||Math.max(p.iframes||0,p.invisT||0)>0||p.slideT>0)
    return inactive('preserve-high-hp');
  const nativeDodge=Number(p.stats?.evasion)>0||Number(p.items?.get?.('guard-spec'))>0&&Number(p.guardT)<=0,
    nativeRecovery=state.regen>0||Number(p.stats?.lifesteal)>0||(p.moves||[]).some(move=>Number(move?.def?.drain)>0);
  if(kind==='dodges'&&!nativeDodge||kind==='healed'&&!nativeRecovery)
    return inactive('no-observed-native-capability');
  const budget=Math.min(state.maxHp*.06,Math.max(0,p.hp-state.maxHp*.86));
  let best=null;
  for(let i=0;i<Math.min(4096,en.n||0);i++){
    const flags=Number(en.flags?.[i])||0;
    if(en.alive?.[i]&&!(en.dying?.[i]>0)&&flags&(4|8192|4096)&&
        Math.hypot(p.pos.x-en.x[i],p.pos.z-en.z[i])<35)return inactive('nearby-boss-pressure');
    if(!en.alive?.[i]||en.dying?.[i]>0||flags&(4|8192|4096|16512)||
        i===run.capture?.index&&['weakened','throwing'].includes(run.capture.state)||
        i===run.allies?.down&&['down','throwing'].includes(run.allies.state)||
        options.blocked?.(i,en.gen?.[i])||nativeEnemyControlActive(run,i,.2))continue;
    const damage=nativeContactDamageUpperBound(run,i),distance=Math.hypot(p.pos.x-en.x[i],p.pos.z-en.z[i]);
    if(!Number.isFinite(damage)||!(damage>0)||damage>budget/2||distance>20||
        !Number.isFinite(en.y?.[i])||Math.abs(en.y[i]-run.terrain.height(en.x[i],en.z[i]))>.4)continue;
    if(!best||damage<best.damage||damage===best.damage&&distance<best.distance)best={index:i,gen:en.gen?.[i],damage,distance};
  }
  if(!best)return inactive('no-bounded-ground-contact');
  const grounded=p.grounded===true;
  return {active:true,phase:grounded?'contact':'landing',...best,kind,
    x:grounded?en.x[best.index]:p.pos.x,z:grounded?en.z[best.index]:p.pos.z,
    radius:grounded?Math.max(.4,Number(en.radius?.[best.index])||.5):1,
    healthBudget:budget,reserveHp:state.maxHp*.86,reason:'bounded-native-character-condition'};
}

export function healingResourceDecision(run, object, state = assessTacticalState(run)) {
  const amount = state.maxHp * (object?.kind === "berry" ? 0.5 : 0.25) * state.healingMultiplier;
  const missing = state.maxHp - state.hp;
  if (missing < state.maxHp * 0.05 || amount <= 0) return { use: false, reason: "save-healing", gain: 0 };
  const travel = tacticDistance(run.player.pos, object) / Math.max(2, 6.3 * tacticNumber(run.player.stats?.moveSpeed, 1));
  const useful = Math.min(missing, amount);
  const netRate = state.regen - state.incomingRate;
  const safeRecovery = netRate > 0 && (state.maxHp * 0.8 - state.hp) / netRate <= 8 && state.pressure < 1;
  const threatened = state.pressure >= 1 || state.recentLoss > state.maxHp * 0.08 ||
    state.hp - state.incomingRate * (travel + 3) < state.maxHp * 0.35;
  const use = (!safeRecovery && state.hpRatio < 0.32) || (!safeRecovery && (state.hpRatio <= 0.55 ||
    threatened && state.hpRatio <= 0.78 && useful >= state.maxHp * 0.15));
  return { use, gain: useful, threatened, safeRecovery, travel, reason: use ? "needed-recovery" : "recover-without-consuming" };
}

// A free reward can still cost positioning and life. Compare the arrival area
// and the first part of the approach, without claiming a straight corridor is
// the final navigated route or treating sleeping bodies as permanently harmless.
export function resourceApproachDecision(run, object, state = assessTacticalState(run)) {
  const p = run.player, pos = p.pos, en = run.enemies || {};
  const dx = object.x - pos.x, dz = object.z - pos.z, d = Math.hypot(dx, dz);
  const length = Math.min(14, d), ux = d > 0 ? dx / d : 0, uz = d > 0 ? dz / d : 0;
  let arrival = 0, corridor = 0, immediateBurst = 0, bodies = 0;
  const pointY = Number.isFinite(object.y) ? object.y : run.terrain?.height?.(object.x, object.z);
  for (let i = 0; i < (en.n || 0); i++) {
    if (!en.alive?.[i] || en.dying?.[i] > 0 || (en.flags?.[i] || 0) & 16512) continue;
    const ex = en.x[i], ez = en.z[i], radius = tacticNumber(en.radius?.[i], 0.7);
    const gap = Math.hypot(ex - object.x, ez - object.z);
    const along = (ex - pos.x) * ux + (ez - pos.z) * uz;
    const onCorridor = along > 2 && along < length && Math.abs((ex - pos.x) * uz - (ez - pos.z) * ux) < radius + 2;
    if (gap >= 6 + radius && !onCorridor) continue;
    const threat = nativeContactDamageUpperBound(run, i);
    const weight = threat == null ? 1 : Math.min(2, Math.max(0.1, threat / state.maxHp * 4));
    const pointLevel = !Number.isFinite(pointY) || Math.abs(tacticNumber(en.y?.[i]) - pointY) < tacticNumber(en.hgt?.[i], 2) + 2;
    if (pointLevel && gap < 6 + radius) {
      arrival += weight * (1 - gap / (7 + radius)); bodies++;
      if (gap < 2.5 + radius) immediateBurst += threat == null ? state.maxHp * 0.4 : threat;
    }
    if (onCorridor) corridor += weight;
  }
  const healing = object.kind === "berry" || object.healingPickup === true;
  const actionableNow = d <= Math.max(1.5, tacticNumber(object.r, 2.6)) + 0.6;
  const reckless = !healing && !actionableNow && state.hpRatio < 0.5 && bodies >= 3 && immediateBurst > state.hp * 0.65;
  return { eligible: !reckless, utilityFactor: Math.max(0.06, 1 / (1 + arrival * 0.65 + corridor * 0.12)),
    arrivalPressure: arrival, corridorPressure: corridor, immediateBurst, healing,
    reason: reckless ? "resource-arrival-too-dangerous" : arrival > 0 || corridor > 0 ? "priced-approach-risk" : "clear-approach" };
}

// The short motion horizon cannot decide which side of an entire pursuing
// crowd to kite around. Price macro combat destinations and their first
// approach segment using the same observed bodies. This is a positioning
// preference, not a promise that a straight corridor is a traversable path or
// that current enemy velocity predicts its future AI.
export function scoreCombatPosition(run, targetIndex, point) {
  const p = run.player, pos = p.pos, en = run.enemies || {};
  const maxHp = Math.max(1, tacticNumber(p.maxHp, 100));
  const dx = point.x - pos.x, dz = point.z - pos.z, distance = Math.hypot(dx, dz);
  const ux = distance > 0 ? dx / distance : 0, uz = distance > 0 ? dz / distance : 0;
  const corridorLength = Math.min(16, distance);
  const arrivalTime = Math.min(1.5, distance / Math.max(2, 6.3 * tacticNumber(p.stats?.moveSpeed, 1)));
  const pointY = Number.isFinite(point.y) ? point.y : run.terrain?.height?.(point.x, point.z);
  let destinationPressure = 0, corridorPressure = 0, close = 0, contact = 0;
  for (let i = 0; i < (en.n || 0); i++) {
    if (!en.alive?.[i] || en.dying?.[i] > 0 || (en.flags?.[i] || 0) & 16512) continue;
    const x = en.x?.[i], z = en.z?.[i];
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    const radius = Math.max(0, tacticNumber(en.radius?.[i], 0.7));
    const flying = Boolean((en.flags?.[i] || 0) & 16 || en.air?.[i]);
    const y = tacticNumber(en.y?.[i]), hgt = Math.max(0.5, tacticNumber(en.hgt?.[i], 2));
    const currentGap = Math.hypot(x - pos.x, z - pos.z);
    if ((flying || Math.abs(y - tacticNumber(pos.y)) <= hgt + 2) && currentGap < 8 + radius) close++;
    // Keep the combat target's attack range handled by the original positioning
    // and immediate motion layers; surrounding escorts must not disappear with it.
    if (i === targetIndex) continue;
    const damage = nativeContactDamageUpperBound(run, i);
    const weight = damage == null ? 1.5 : tacticClamp(damage / maxHp * 5, 0.1, 3);
    const vx = tacticClamp(tacticNumber(en.vx?.[i]) + tacticNumber(en.kx?.[i]), -30, 30);
    const vz = tacticClamp(tacticNumber(en.vz?.[i]) + tacticNumber(en.kz?.[i]), -30, 30);
    const gap = Math.min(Math.hypot(x - point.x, z - point.z),
      Math.hypot(x + vx * arrivalTime - point.x, z + vz * arrivalTime - point.z));
    const arrivalLevel = flying || !Number.isFinite(pointY) || Math.abs(y - pointY) <= hgt + 2;
    if (arrivalLevel && gap < 12 + radius) {
      destinationPressure += weight * (1 - gap / (12 + radius));
      if (gap < radius + 2) contact += weight;
    }
    const along = (x - pos.x) * ux + (z - pos.z) * uz;
    const lateral = Math.abs((x - pos.x) * uz - (z - pos.z) * ux);
    const routeLevel = flying || Math.abs(y - tacticNumber(pos.y)) <= hgt + 3;
    if (routeLevel && along > 1 && along < corridorLength && lateral < radius + 3)
      corridorPressure += weight * (1 - lateral / (radius + 3));
  }
  const lowHealth = tacticNumber(p.hp, maxHp) < maxHp * 0.45;
  return { cost: destinationPressure * 8 + corridorPressure * 2 + contact * 10,
    destinationPressure, corridorPressure, close,
    retreatNeeded: close >= 10 || lowHealth && close >= 3 };
}

export class TacticalDirector {
  constructor() { this.run = null; this.stage = null; this.terrain = null; this.entries = new Map(); this.finiteResources = new Map(); }
  sync(run) {
    if (this.run !== run || this.stage !== run.stage || this.terrain !== run.terrain) {
      this.run = run; this.stage = run.stage; this.terrain = run.terrain;
      this.entries.clear(); this.finiteResources.clear(); this.active = null; this.clearedAt = null; this.questDeadline = null; this.bossIntentAt = null; this.firstSurgeAt = null;
    }
    if (run.stageCleared && this.clearedAt == null) this.clearedAt = run.stageTime;
  }
  finiteResourcePhase(run) {
    return !!run.tower && (run.stageCleared && run.tower.state === "clear" ||
      run.tower.roof && run.tower.won && run.tower.state === "roof");
  }
  finiteCleanup(run, resources, options = {}) {
    this.sync(run);
    // Native Tower.clearFloor stops spawning its finite waves. Its existing
    // rewards must not inherit the normal map's continuously spawning deadline.
    // Failures are local to this real object/condition and stage, never a
    // permanent blacklist or a resettable whole-floor stopwatch.
    const active = this.finiteResourcePhase(run);
    if (!active) { this.finiteResources.clear(); return { active:false, holding:false, ids:[] }; }
    const seen = new Set(), ids = [];
    for (const resource of resources) {
      seen.add(resource.id);
      let memory = this.finiteResources.get(resource.id);
      if (!memory || memory.condition !== resource.condition || memory.source !== resource.source ||
          Number.isFinite(resource.age) && Number.isFinite(memory.age) && resource.age < memory.age-.001) {
        memory = { condition:resource.condition, source:resource.source, deferred:false };
        this.finiteResources.set(resource.id,memory);
      }
      if (resource.blocked) memory.deferred = true;
      memory.age=resource.age;
      if(resource.inTransit){
        const remaining=Number(resource.distance),speed=Math.max(1,Number(resource.speed)||16),now=tacticNumber(run.time);
        if(!Number.isFinite(remaining))memory.deferred=true;
        else {
          if(!Number.isFinite(memory.bestDistance)||remaining<memory.bestDistance-.25){
            memory.bestDistance=remaining;memory.progressAt=now;memory.deferred=false;
            // The native attraction accelerates toward16+age*6. Give that
            // actual travel distance a conservative no-progress allowance,
            // renewed only by physical approach, never by repeated selection.
            memory.progressBudget=tacticClamp(remaining/speed*2+2,4,20);
          }
          if(now-memory.progressAt>memory.progressBudget)memory.deferred=true;
        }
      }
      if (resource.eligible && !memory.deferred) ids.push(resource.id);
    }
    for (const id of this.finiteResources.keys()) if (!seen.has(id)) this.finiteResources.delete(id);
    return { active:true, holding:!options.danger && ids.length>0, ids,
      deferred:this.finiteResources.size-ids.length, emergency:options.danger===true };
  }
  entry(run, object) {
    this.sync(run);
    const id = `${object.kind}:${object.x}:${object.z}`;
    if (!this.entries.has(id)) this.entries.set(id, { id, attempts: 0, activeTime: 0,
      spentTime: 0, bestCharge: 0, exits: 0, outside: 0, blockedUntil: 0, wasInside: false });
    return this.entries.get(id);
  }
  altarPolicy(run, object, state, safeMode = true) {
    const entry = this.entry(run, object), tier = tacticClamp(tacticNumber(object.data?.tier), 0, 4);
    const chargeSeconds = [8, 14, 22, 35, 10][tier] * (1 + 0.25 * (Math.min(3, run.stage) - 1));
    const progress = tacticClamp(tacticNumber(object.charge), 0, 1), remaining = (1 - progress) * chargeSeconds;
    const powerKey = `${Math.floor((run.player.level || 1) / 3)}:${state.hpRatio >= 0.8}:${state.activeMoves}`;
    if (entry.blockedPower && entry.blockedPower !== powerKey && entry.spentTime < 150) {
      entry.blockedUntil = 0; entry.blockedPower = null; entry.restartAttempt = true;
      entry.attempts = Math.max(0, entry.attempts - 1);
    }
    const reserve = state.maxHp * (safeMode ? 0.6 : 0.35);
    const allocated = Math.min(state.maxHp * (safeMode ? 0.07 : 0.16), Math.max(0, state.hp - reserve));
    const spent = entry.startDamage == null ? 0 : Math.max(0, state.damageTaken - entry.startDamage);
    const healthBudget = Math.max(0, allocated - spent);
    const protectedFinish = state.protectedFor >= remaining + 0.15;
    const cooldown = entry.blockedUntil > run.time || entry.attempts >= 3 || entry.spentTime >= 150;
    const risk = state.hpRatio < (safeMode ? 0.4 : 0.25) ||
      (state.unknownClose > 0 && !protectedFinish && state.hpRatio < 0.65) ||
      (state.incomingRate > state.regen && state.hp - (state.incomingRate - state.regen) * Math.min(remaining, 5) < reserve);
    return { allowed: !object.used && !object.data?.sealed && !cooldown && !risk,
      reason: cooldown ? "altar-deferred" : risk ? "altar-cost-too-high" : "altar-opportunity",
      kind: "altar", center: { x: object.x, z: object.z }, radius: Math.max(0.5, object.r || 4),
      progress, remaining, chargeSeconds, healthBudget, reserveHp: reserve, safeMode,
      protectedFinish, powerKey, spent, entry };
  }
  observe(run, target, state, safeMode = true) {
    this.sync(run);
    const previous = this.entries.get(this.active);
    if (previous) {
      const elapsed = tacticClamp(run.time - (previous.lastAt ?? run.time), 0, 0.5);
      previous.activeTime += elapsed; previous.spentTime += elapsed; previous.lastAt = run.time;
    }
    const object = target?.entity;
    if (run.state !== "play" || object?.kind !== "altar" || object.used) { this.active = null; return null; }
    let policy = this.altarPolicy(run, object, state, safeMode);
    const entry = policy.entry;
    const continuing = this.active === entry.id;
    if (entry.startDamage == null || entry.restartAttempt || entry.blockedUntil > 0 && entry.blockedUntil <= run.time) {
      entry.startDamage = state.damageTaken; entry.activeTime = 0; entry.exits = 0; entry.outside = 0;
      entry.blockedUntil = 0; entry.restartAttempt = false;
      policy = this.altarPolicy(run, object, state, safeMode);
    }
    const dt = continuing && previous ? tacticClamp(run.time - (entry.lastInsideAt ?? run.time), 0, 0.5) : 0;
    const inside = tacticDistance(run.player.pos, object) < policy.radius - 0.1;
    if (continuing && entry.wasInside && !inside) entry.exits++;
    entry.outside += inside ? 0 : dt;
    entry.bestCharge = Math.max(entry.bestCharge, policy.progress);
    entry.wasInside = inside; entry.lastAt = run.time; entry.lastInsideAt = run.time; this.active = entry.id;
    const exhausted = entry.activeTime > policy.chargeSeconds * 1.65 + 18 ||
      entry.exits >= 4 && entry.outside > 5 && policy.progress < 0.85 ||
      policy.spent > Math.max(state.maxHp * 0.06, policy.healthBudget) && !policy.protectedFinish;
    if (!policy.allowed || exhausted) {
      if (entry.blockedUntil <= run.time) {
        entry.attempts++; entry.blockedUntil = run.time + 35; entry.blockedPower = policy.powerKey;
      }
      this.active = null;
      return { ...policy, allowed: false, reason: exhausted ? "altar-attempt-budget" : policy.reason };
    }
    return policy;
  }
  progression(run, state, options = {}) {
    this.sync(run);
    const time = Math.max(0, tacticNumber(run.stageTime)), safe = options.safeMode !== false;
    // Boss HP is scaled from observed combat output in the native game. Waiting
    // indefinitely for a perfect build does not create a free advantage.
    const nativeSlots = Math.max(1, tacticNumber(run.player.moveSlots, 3));
    const armed = state.activeMoves >= Math.min(2, nativeSlots) && state.moveLevels >= (run.stage > 1 ? 7 : 4);
    const ready = time >= 65 && armed && state.hpRatio >= (safe ? 0.72 : 0.6) && state.pressure < (safe ? 1.5 : 2.5);
    // The first native swarm/stampede (normally 200/235 seconds) is already a
    // major escalation. Do not use the later ten-minute final swarm as the only
    // clock, or wait for low crowd pressure that a growing horde cannot offer.
    const surges = (run.director?.timeline || []).filter(event =>
      ["swarm", "stampede", "elitewave", "totem"].includes(event.kind) && Number.isFinite(event.t) && event.t > 0);
    const firstSurge = surges.length ? Math.min(...surges.map(event => event.t)) : Infinity;
    if (Number.isFinite(firstSurge)) this.firstSurgeAt = Math.min(this.firstSurgeAt ?? Infinity, firstSurge);
    const beforeSurge = Math.max(90, (this.firstSurgeAt ?? Infinity) - 60);
    const bossDeadline = run.endless ? (safe ? 300 : 240) : Math.min(safe ? 300 : 240, beforeSurge);
    if (options.questHold && this.questDeadline == null)
      this.questDeadline = Math.min(1800, Math.max(bossDeadline, time + Math.max(0, tacticNumber(options.minTime) - run.time) + 60));
    const hardBoss = Math.max(bossDeadline, this.questDeadline || 0);
    const mayPrepare = !options.questHold && !options.shinyHold;
    if (ready && mayPrepare && !run.bossSpawned && !run.stageCleared && this.bossIntentAt == null)
      this.bossIntentAt = time;
    const summonBoss = !run.bossSpawned && !run.boss?.alive && !run.stageCleared &&
      !(run.mewtwo?.active) && (time >= hardBoss || mayPrepare && (ready || this.bossIntentAt != null));
    // Readiness is an intent, not a per-frame permission that is lost whenever
    // crowds reach the player during travel. Recovery may interrupt briefly;
    // repeatedly replacing that route with another chest must not restart it.
    const forceBoss = summonBoss && (time >= hardBoss + 20 || this.bossIntentAt != null &&
      (state.hpRatio >= 0.45 || time - this.bossIntentAt >= 20));
    const sinceClear = this.clearedAt == null ? 0 : time - this.clearedAt;
    const leaveDeadline = (safe ? 45 : 32);
    // A late victory still has its own finite collection window. Absolute
    // pre-boss escalation clocks must not discard rewards the instant a
    // 10-minute boss finally dies; actual health/pressure still permits escape.
    const danger = state.hpRatio < 0.4 || state.pressure > 3;
    const valuable = options.nearbyValuable === true && !danger;
    const settlingDrops = run.stageCleared && options.collectBonkoin === true && !danger && sinceClear < 1.2;
    const ordinaryLeave = run.stageCleared && !settlingDrops && (danger || sinceClear >= leaveDeadline || !valuable);
    // Intentional finite shiny/time waits keep their native goal, with a final
    // bounded escape before the ten-minute final swarm where applicable.
    const held = options.shinyHold && sinceClear < 120 && time < 570 && !danger;
    return { summonBoss, forceBoss, bossCommittedAt: this.bossIntentAt, bossDeadline: hardBoss, leaveStage: ordinaryLeave && !held,
      forceLeave: run.stageCleared && sinceClear >= (held ? 120 : leaveDeadline),
      sinceClear, leaveDeadline, firstSurge: this.firstSurgeAt, settlingDrops, danger,
      reason: summonBoss ? time >= hardBoss ? beforeSurge <= hardBoss && !options.questHold ? "before-native-escalation" : "boss-deadline" : "combat-ready"
        : ordinaryLeave ? "leave-window" : "bounded-prepare" };
  }
}

// Jump is another native control candidate, never an immunity window or a way
// to cancel an existing slide. The caller supplies the current native gate and
// impulse; policy predicts its first grounded/slide frame and subsequent air
// trajectory on the same damage and geometry model as walking and sliding.
function traversalInBounds(state, x, z, margin = 2) {
  return state.terrain.inBounds(x, z, margin) &&
    (typeof state.withinBounds !== "function" || state.withinBounds(x, z, margin));
}

// The native player collides against raw terrain, but lands on the local water
// surface in deep water (or on frozen water). Treating the seabed as the landing
// floor forecast a long fall and hid legitimate repeated shore-jump inputs.
function traversalSupport(state, x, z, y) {
  const terrain = state.terrain, p = state.player, floor = terrain.height(x, z),
    water = terrain.isLava ? -99 : typeof terrain.waterAt === "function" ? terrain.waterAt(x, z) :
      p.deepWater === true && Number.isFinite(p.waterLevel) ? p.waterLevel : -99,
    ice = terrain.frozen === true && floor < water,
    deep = !ice && floor < water - .55,
    surfing = p.surfing === true || p.types?.includes?.("water") === true;
  return { floor, water, ice, deep, support: deep ? water - (surfing ? .15 : .5) : ice ? water : floor,
    waterJump: deep && Number.isFinite(y) && y <= water + .35 };
}

export function terrainEscapeIntent(state) {
  const p = state.player, terrain = state.terrain;
  if (!p || !terrain || typeof terrain.height !== "function" || typeof terrain.inBounds !== "function" ||
      ![p.x, p.y, p.z].every(Number.isFinite)) return null;
  const surface = traversalSupport(state, p.x, p.z, p.y), delta = .5,
    gx = terrain.height(p.x + delta, p.z) - terrain.height(p.x - delta, p.z),
    gz = terrain.height(p.x, p.z + delta) - terrain.height(p.x, p.z - delta),
    gradient = Math.hypot(gx, gz);
  if (surface.deep) {
    // A bounded radial shore probe runs only when traversal is requested. The
    // first ring with dry land is the nearest sampled exit, so a target along
    // the bank cannot keep the player skating sideways around the same pool.
    for (const radius of [.8, 1.6, 3.2, 6.4, 12.8, 24]) {
      let shore = null;
      for (let index = 0; index < 16; index++) {
        const angle = index * Math.PI / 8, x = p.x + Math.cos(angle) * radius,
          z = p.z + Math.sin(angle) * radius;
        if (!traversalInBounds(state, x, z)) continue;
        const next = traversalSupport(state, x, z, p.y);
        if (!Number.isFinite(next.floor) || next.ice || next.floor < next.water - .04 ||
            terrain.hitProp?.(x, next.floor + .3, z, p.radius || .55)) continue;
        const uphillDot = gradient > .15 ? (Math.cos(angle) * gx + Math.sin(angle) * gz) / gradient : 0,
          goalDot = state.target ? ((state.target.x - p.x) * Math.cos(angle) +
            (state.target.z - p.z) * Math.sin(angle)) / Math.max(1, tacticDistance(p, state.target)) : 0,
          cost = Math.max(0, next.floor - surface.water) * .03 - uphillDot * .8 - goalDot * .02;
        if (!shore || cost < shore.cost) shore = { x, z, cost };
      }
      if (shore) {
        const length = tacticDistance(p, shore);
        return { kind: "water", direction: { x: (shore.x - p.x) / length, z: (shore.z - p.z) / length },
          escapeGoal: { x: shore.x, z: shore.z }, surface };
      }
    }
  }
  return gradient >= .65 ? { kind: "slope", direction: { x: gx / gradient, z: gz / gradient },
    surface } : null;
}

// Repeated hopping and a zero-input motion choice both prevent the game's own
// grounded stuck timer from reaching its native rescue check. Observe real
// travel independently of selected targets, then provide a finite landing /
// pushing window. Only native movement and native freeSpot may move a player.
// The caller must stop/reset observation during menus, interaction waits and
// intentionally stationary combat. Exhausted is diagnostic only: a live run
// keeps finite recovery/repath attempts and is never quit for stalled travel.
function nativeTravelEnemyIdentity(run, target) {
  const index = target?.enemyIndex;
  return Number.isInteger(index) && index >= 0
    ? { index, generation: run?.enemies?.gen?.[index] } : null;
}

function nativeTravelEnemyRetired(run, identity) {
  if (!identity) return false;
  const enemies = run?.enemies, index = identity.index, generation = enemies?.gen?.[index];
  return enemies?.alive?.[index] === false || enemies?.alive?.[index] === 0 ||
    Number.isInteger(enemies?.n) && index >= enemies.n ||
    Number.isFinite(identity.generation) && Number.isFinite(generation) && identity.generation !== generation;
}

function nativeTravelLandmark(target) {
  const entity = target?.entity;
  return target?.exploration !== true && entity && typeof entity.kind === "string" &&
    typeof entity.used === "boolean" ? entity : null;
}

export class TerrainRecoveryTracker {
  constructor() { this.run = null; this.stage = null; this.terrain = null; this.reset(); }
  reset() { this.entries = new Map(); this.interactionEntries = new Set(); this.candleEntries = new Set(); this.enemyEntries = new Set(); this.active = null; this.legacyKey = {}; }
  retireEntry(entry) {
    if (this.active === entry) { entry.observedAt = null; entry.phaseUntil = 0; this.active = null; }
    if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
    this.interactionEntries.delete(entry); this.candleEntries.delete(entry); this.enemyEntries.delete(entry);
  }
  observe(run, options = {}) {
    if (this.run !== run || this.stage !== run?.stage || this.terrain !== run?.terrain) {
      this.run = run; this.stage = run?.stage; this.terrain = run?.terrain; this.reset();
    }
    const now = Number(run?.time), pos = run?.player?.pos, terrain = run?.terrain,
      target = options.target, goal = target?.entity || target,
      landmark = nativeTravelLandmark(target), enemyIdentity = nativeTravelEnemyIdentity(run, target),
      nativeInteractions = (landmark || this.interactionEntries.size) && Array.isArray(run?.interactables?.list)
        ? new Set(run.interactables.list) : null,
      observable = run?.state === "play" && pos && [now, pos.x, pos.z].every(Number.isFinite);
    // Native endless regen reuses a completed landmark object. Its real
    // used=false -> true transition settles only that completed journey,
    // including a modal's paused entry, before the same entity returns later.
    const completedInteraction = target?.entity?.used === true ||
      landmark && nativeInteractions && !nativeInteractions.has(landmark) ||
      nativeTravelEnemyRetired(run, enemyIdentity) ||
      target?.towerCandle && run.tower?.candles?.includes(target.towerCandle) && target.towerCandle.lit > 0;
    // Only observed native retirement releases a generation's ledger. Merely
    // switching A/B or rebuilding a target leaves both full budgets intact.
    for (const entry of this.enemyEntries)
      if (nativeTravelEnemyRetired(run, entry.nativeEnemy)) this.retireEntry(entry);
    for (const entry of this.interactionEntries) {
      const entity = entry.interactionEntity;
      if (entity.used !== true && !(nativeInteractions && !nativeInteractions.has(entity))) continue;
      this.retireEntry(entry);
    }
    // A real proximity charge completes a candle journey. It can extinguish
    // and be lit again, so only the entry first observed unlit is settled by
    // that same native candle becoming lit; another candle cannot clear it.
    for (const entry of this.candleEntries) {
      if (!(entry.candleEntity.lit > 0)) continue;
      if (this.active === entry) { entry.observedAt = null; entry.phaseUntil = 0; this.active = null; }
      if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
      this.candleEntries.delete(entry);
    }
    const eligible = options.eligible === true && observable && !completedInteraction,
      combatProgress = options.combatProgress === true && observable && !!target && !completedInteraction;
    // Charge the last selected interval before switching targets. Rebuilding
    // target objects or alternating A/B must not turn every elapsed dt into0.
    if (this.active?.observedAt != null && Number.isFinite(now)) {
      const elapsed = tacticClamp(now - this.active.observedAt, 0, .5);
      this.active.noProgress += elapsed; this.active.total += elapsed;
      this.active.observedAt = now;
    }
    if (!eligible && !combatProgress) {
      if (this.active) { this.active.observedAt = null; this.active.phaseUntil = 0; }
      this.active = null;
      if (!target) this.reset();
      return { active: false, exhausted: false, reason: "no-travel-intent" };
    }
    const key = options.targetKey ?? (Number.isInteger(target?.enemyIndex)
      ? `${String(target.id)}:${target.enemyIndex}:${run.enemies?.gen?.[target.enemyIndex] ?? ""}`
      : target?.id ?? target?.entity ?? target ?? this.legacyKey);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { key, nativeEnemy: enemyIdentity, anchor: null, bestDistance: Infinity, routeProgress: null, observedAt: null,
        bestFloor: -Infinity, noProgress: 0, phaseUntil: 0, attempts: 0, total: 0,
        interactionEntity: landmark?.used === false ? landmark : null,
        explorationGoal: target?.exploration === true && target.id === key &&
          [goal?.x, goal?.z, target.radius].every(Number.isFinite) && target.radius > 0
          ? { x: goal.x, z: goal.z, radius: target.radius } : null,
        candleEntity: target?.towerCandle && run.tower?.candles?.includes(target.towerCandle) &&
          target.towerCandle.lit <= 0 ? target.towerCandle : null };
      this.entries.set(key, entry);
      if (entry.nativeEnemy) this.enemyEntries.add(entry);
      if (entry.interactionEntity) this.interactionEntries.add(entry);
      if (entry.candleEntity) this.candleEntries.add(entry);
    }
    if (this.active !== entry && this.active) this.active.observedAt = null;
    this.active = entry; entry.observedAt = now;
    const floor = typeof terrain?.height === "function" ?
        traversalSupport({ terrain, player: run.player }, pos.x, pos.z, pos.y).support : undefined,
      hasGoal = [goal?.x, goal?.z].every(Number.isFinite),
      remaining = hasGoal ? tacticDistance(pos, goal) : Infinity,
      routeProgress = Number.isInteger(options.verifiedRouteProgressCount) ? options.verifiedRouteProgressCount : null,
      moved = entry.anchor ? Math.hypot(pos.x - entry.anchor.x, pos.z - entry.anchor.z) : Infinity,
      closer = hasGoal && remaining < entry.bestDistance - .7,
      routeAdvanced = routeProgress != null && entry.routeProgress != null && routeProgress > entry.routeProgress,
      grounded = run.player.grounded !== false && Number.isFinite(floor) &&
        Math.abs(tacticNumber(pos.y) - floor) < .12,
      groundAdvanced = entry.anchor && grounded && Number.isFinite(floor) &&
        floor - entry.bestFloor >= .45 && (!hasGoal ||
          (Number.isFinite(goal.y) ? goal.y : terrain?.height?.(goal.x, goal.z)) >= floor - .6);
    // The caller certifies an actual same-generation target HP decrease in
    // current native range/line of sight. This is useful stationary combat,
    // unlike a grace timer, held skill or unrelated nearby AoE; reset only its
    // scoped target ledger, including when travel is intentionally excluded.
    if (combatProgress) {
      entry.anchor = { x: pos.x, z: pos.z, floor };
      if (grounded && Number.isFinite(floor)) entry.bestFloor = Math.max(entry.bestFloor, floor);
      entry.bestDistance = Math.min(entry.bestDistance, remaining);
      entry.routeProgress = routeProgress;
      entry.noProgress = 0; entry.phaseUntil = 0; entry.attempts = 0; entry.total = 0;
      entry.observedAt = null; this.active = null;
      return { active: false, exhausted: false, reason: "productive-target-progress" };
    }
    // With an explicit goal, arbitrary sideways/backward motion is not route
    // progress. Detours may use ONLY the interaction tracker's monotonic count
    // of actual movement toward an already verified, non-repeated route cell.
    // Merely supplying a freshly replanned waypoint does not grant credit.
    const progressed = !entry.anchor || groundAdvanced || moved >= .7 &&
      (hasGoal ? closer || routeAdvanced : moved >= 1.2);
    if (progressed) {
      entry.anchor = { x: pos.x, z: pos.z, floor };
      if (grounded && Number.isFinite(floor)) entry.bestFloor = Math.max(entry.bestFloor, floor);
      entry.bestDistance = Math.min(entry.bestDistance, remaining);
      entry.routeProgress = routeProgress;
      entry.noProgress = 0; entry.phaseUntil = 0; entry.attempts = 0; entry.total = 0;
      return { active: false, exhausted: false, reason: "physical-travel-progress" };
    }
    if (entry.routeProgress == null && routeProgress != null) entry.routeProgress = routeProgress;
    const exhausted = entry.total >= 38;
    if (!exhausted && now >= entry.phaseUntil && entry.noProgress >= 6) {
      entry.phaseUntil = now + 4.8; entry.noProgress = 0; entry.attempts++;
    }
    const active = !exhausted && now < entry.phaseUntil;
    return { active, exhausted, attempts: entry.attempts, noProgressFor: entry.total,
      until: active ? entry.phaseUntil : null,
      reason: exhausted ? "native-terrain-recovery-exhausted" : active ? "allow-native-grounded-rescue" : "bounded-traversal-attempt" };
  }
  completeGoal(run, goal) {
    const pos = run?.player?.pos, entry = this.entries.get(goal?.id), original = entry?.explorationGoal;
    if (run !== this.run || run?.stage !== this.stage || run?.terrain !== this.terrain ||
        run?.state !== "play" || goal?.exploration !== true || !original ||
        ![pos?.x, pos?.z, goal.x, goal.z, goal.radius].every(Number.isFinite) ||
        goal.radius !== original.radius || !(goal.radius > 0) ||
        tacticDistance(pos, goal) > goal.radius || tacticDistance(pos, original) > original.radius) return null;
    const active = this.active === entry;
    if (active) { entry.observedAt = null; entry.phaseUntil = 0; this.active = null; }
    this.entries.delete(goal.id);
    return { completed: true, active };
  }
  retryStalledTravel(run, options = {}) {
    const target = options.target, entry = this.active,
      key = options.targetKey ?? (Number.isInteger(target?.enemyIndex)
        ? `${String(target.id)}:${target.enemyIndex}:${run?.enemies?.gen?.[target.enemyIndex] ?? ""}`
        : target?.id ?? target?.entity ?? target);
    if (!target || run !== this.run || run?.stage !== this.stage || run?.terrain !== this.terrain ||
        run?.state !== "play" || !entry || entry.key !== key || entry.total < 38)
      return { active: false, exhausted: !!entry && entry.total >= 38, reason: "no-stalled-travel-retry" };
    const now = Number(run.time);
    entry.travelRetryAt ??= now;
    const elapsed = Math.max(0, now - entry.travelRetryAt), cycle = Math.floor(elapsed / 10.8),
      active = elapsed - cycle * 10.8 < 4.8;
    // Keep the spent ledger visible. Each grounded input window is finite;
    // the following backoff permits ordinary legal navigation and new routes.
    return { active, exhausted: true, retryCycle: cycle + 1,
      attempts: entry.attempts + cycle + 1, noProgressFor: entry.total,
      until: active ? entry.travelRetryAt + cycle * 10.8 + 4.8 : null,
      reason: active ? "stalled-travel-native-grounded-retry" : "stalled-travel-retry-backoff" };
  }
  retryActiveCapture(run, options = {}) {
    const target = options.target, index = target?.enemyIndex, en = run?.enemies,
      capture = run?.capture, allies = run?.allies,
      nativeOpportunity = Number.isInteger(index) && index >= 0 && en?.alive?.[index] && !(en.dying?.[index] > 0) &&
        (capture?.index === index && ["roaming", "weakened", "throwing"].includes(capture.state) ||
         allies?.down === index && ["down", "throwing"].includes(allies.state) ||
         !!((en.flags?.[index] || 0) & 2) ||
         index === run?.boss?.bossIndex && !!((en.flags?.[index] || 0) & 2048)),
      entry = this.active;
    if (!nativeOpportunity || run !== this.run || run.stage !== this.stage || run.terrain !== this.terrain ||
        run.state !== "play" || !entry || entry.total < 38)
      return { active: false, exhausted: !!entry && entry.total >= 38, reason: "no-active-capture-retry" };
    const now = Number(run.time);
    entry.captureRetryAt ??= now;
    const elapsed = Math.max(0, now - entry.captureRetryAt), cycle = Math.floor(elapsed / 10.8),
      active = elapsed - cycle * 10.8 < 4.8;
    // The failure ledger is preserved. This is another finite native pushing
    // window for a still-existing capture, never fabricated physical progress.
    return { active, exhausted: true, captureRetry: true, retryCycle: cycle + 1,
      attempts: entry.attempts + cycle + 1, noProgressFor: entry.total,
      until: active ? entry.captureRetryAt + cycle * 10.8 + 4.8 : null,
      reason: active ? "active-capture-native-grounded-retry" : "active-capture-retry-backoff" };
  }
}

// Enemy overlap pushes the native player physically even during invulnerability
// (Enemies.update, 0.8.13). Short damage-only paths and useful stationary boss
// damage therefore do not prove that a wall-pinned character can really move.
export class CrowdEscapeTracker {
  constructor() { this.run = null; this.stage = null; this.terrain = null; }
  observe(run, options = {}) {
    const p = run?.player, pos = p?.pos, now = Number(run?.time), terrain = run?.terrain,
      inactive = reason => ({ active: false, reason, until: null });
    if (this.run !== run || this.stage !== run?.stage || this.terrain !== terrain) {
      this.run = run; this.stage = run?.stage; this.terrain = terrain;
      this.anchor = null; this.at = now; this.stalled = 0; this.direction = null;
      this.until = 0; this.failed = []; this.attempts = 0; this.cooldownUntil = 0;
      this.sampleAt = -Infinity; this.field = null; this.damageStart = null;
    }
    if (options.eligible !== true || run?.state !== "play" ||
        ![now, pos?.x, pos?.y, pos?.z].every(Number.isFinite) ||
        typeof terrain?.height !== "function" || typeof terrain?.inBounds !== "function") {
      this.at = now; this.direction = null; this.until = 0; this.stalled = 0;
      return inactive("crowd-escape-gated");
    }
    const dt = tacticClamp(now - this.at, 0, .5); this.at = now;
    if (!this.anchor || tacticDistance(pos, this.anchor) >= 3) {
      this.anchor = { x: pos.x, z: pos.z }; this.stalled = 0; this.direction = null;
      this.failed = []; this.attempts = 0; this.damageStart = tacticNumber(run.stats?.damageTaken);
    }
    const inBounds = (x, z) => terrain.inBounds(x, z, 2) &&
      (typeof options.withinBounds !== "function" || options.withinBounds(x, z, 2));
    if (now >= this.sampleAt + .25 || !this.field) {
      const en = run.enemies || {}, bodies = [];
      let overlaps = 0, heavyOverlaps = 0, close = 0, blocked = 0;
      for (let i = 0; i < (en.n || 0); i++) {
        if (!en.alive?.[i] || en.dying?.[i] > 0 || (en.flags?.[i] || 0) & 16512) continue;
        const x = en.x?.[i], z = en.z?.[i], y = tacticNumber(en.y?.[i]),
          hgt = Math.max(.4, tacticNumber(en.hgt?.[i], 2)), radius = Math.max(.1, tacticNumber(en.radius?.[i], .7)),
          distance = Math.hypot(x - pos.x, z - pos.z);
        if (!Number.isFinite(distance) || distance > 12 || !(pos.y < y + hgt * .8 && pos.y > y - 1)) continue;
        const nativeRadius = (radius + tacticNumber(p.radius, .55)) * .8;
        if (distance < nativeRadius) { overlaps++; if ((en.flags?.[i] || 0) & 8196) heavyOverlaps++; }
        if (distance < nativeRadius + 2) close++;
        bodies.push({ x, y, z, hgt, radius, vx: tacticNumber(en.vx?.[i]), vz: tacticNumber(en.vz?.[i]),
          weight: (en.flags?.[i] || 0) & 8196 ? 2.5 : 1, distance });
      }
      bodies.sort((a, b) => a.distance - b.distance);
      for (let i = 0; i < 16; i++) {
        const angle = i * Math.PI / 8, x = pos.x + Math.cos(angle) * 3, z = pos.z + Math.sin(angle) * 3;
        if (!inBounds(x, z) || terrain.height(x, z) > pos.y + .6 || terrain.hitProp?.(x, pos.y, z, p.radius || .55)) blocked++;
      }
      this.field = { bodies: bodies.slice(0, 48), overlaps, heavyOverlaps, close, blocked };
      this.sampleAt = now;
    }
    const field = this.field,
      trapped = field.overlaps >= 2 || field.blocked >= 3 && (field.close >= 3 || field.heavyOverlaps >= 1);
    if (!trapped && !(this.direction && now < this.until)) {
      this.stalled = 0; this.direction = null; this.until = 0;
      return inactive("no-observed-wall-and-body-trap");
    }
    if (trapped) this.stalled += dt;
    if (this.stalled < 1.2 || now < this.cooldownUntil) return inactive("observe-physical-crowd-progress");
    if (this.direction && now >= this.until) {
      this.failed.push(this.direction); this.direction = null;
      if (this.attempts >= 3) { this.cooldownUntil = now + 2.5; this.failed = []; this.attempts = 0;
        return inactive("bounded-crowd-escape-backoff"); }
    }
    if (!this.direction && this.attempts >= 3) {
      this.cooldownUntil = now + 2.5; this.failed = []; this.attempts = 0;
      return inactive("bounded-crowd-escape-backoff");
    }
    const reach = Math.min(8, Math.max(4, 6.3 * tacticNumber(p.stats?.moveSpeed, 1) * .75));
    if (!this.direction) {
      let best = null;
      for (let index = 0; index < 16; index++) {
        const angle = index * Math.PI / 8, direction = { x: Math.cos(angle), z: Math.sin(angle) };
        if (this.failed.some(old => old.x * direction.x + old.z * direction.z > .9)) continue;
        let clear = true;
        for (const fraction of [.33, .66, 1]) {
          const x = pos.x + direction.x * reach * fraction, z = pos.z + direction.z * reach * fraction;
          if (!inBounds(x, z) || terrain.height(x, z) > pos.y + .6 ||
              terrain.hitProp?.(x, pos.y, z, p.radius || .55)) { clear = false; break; }
        }
        if (!clear) continue;
        let corridor = 0, arrival = 0;
        const x = pos.x + direction.x * reach, z = pos.z + direction.z * reach;
        for (const body of field.bodies) {
          const along = (body.x - pos.x) * direction.x + (body.z - pos.z) * direction.z,
            lateral = Math.abs((body.x - pos.x) * direction.z - (body.z - pos.z) * direction.x),
            radius = (body.radius + tacticNumber(p.radius, .55)) * .8 + .35;
          if (along > -.1 && along < reach + radius && lateral < radius)
            corridor += (radius - lateral) * body.weight * (1 - Math.max(0, along) / (reach + radius));
          arrival += Math.max(0, 3 + radius - Math.hypot(body.x + body.vx * .6 - x, body.z + body.vz * .6 - z)) * body.weight;
        }
        const score = corridor * 7 + arrival * 4;
        if (!best || score < best.score) best = { direction, score };
      }
      if (!best) return inactive("no-native-geometric-crowd-exit");
      const remaining = Number(options.captureRemaining), commit = Number.isFinite(remaining) && remaining > 0 && remaining < 4
        ? tacticClamp(remaining * .25, .25, 1) : 1;
      this.direction = best.direction; this.until = now + commit; this.attempts++;
    }
    const maxHp = tacticNumber(p.maxHp), hp = tacticNumber(p.hp), spent = Math.max(0,
      tacticNumber(run.stats?.damageTaken) - tacticNumber(this.damageStart)),
      healthBudget = options.safeMode === false ? Math.max(0, Math.min(maxHp * .06 - spent, hp - maxHp * .6)) : 0;
    return { active: true, direction: { ...this.direction }, target: {
      x: pos.x + this.direction.x * reach, z: pos.z + this.direction.z * reach }, until: this.until,
      attempts: this.attempts, healthBudget, reserveHp: maxHp * .6, bodies: field.bodies,
      close: field.close, overlaps: field.overlaps, blockedDirections: field.blocked,
      reason: "bounded-native-crowd-unpin" };
  }
}

// A ledge search is a proposal for native input, not a teleport to its endpoint.
// Retain a useful uphill direction across real landings, rather than replanning
// a different side-step on every airborne frame. This memory is deliberately
// separate from the optional routine jump-movement preference.
export class TerrainHopTracker {
  constructor() { this.run = null; this.stage = null; this.terrain = null; this.entries = new Map(); this.enemyEntries = new Set(); this.interactionEntries = new Set(); this.key = null; }
  retireEntry(entry) {
    if (this.key === entry.key) this.key = null;
    if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
    this.enemyEntries.delete(entry); this.interactionEntries.delete(entry);
  }
  observe(run, options = {}) {
    if (this.run !== run || this.stage !== run?.stage || this.terrain !== run?.terrain) {
      this.run = run; this.stage = run?.stage; this.terrain = run?.terrain;
      this.entries.clear(); this.enemyEntries.clear(); this.interactionEntries.clear(); this.key = null;
    }
    const p = run?.player, pos = p?.pos, now = Number(run?.time), target = options.target,
      goal = target?.entity || target,
      landmark = nativeTravelLandmark(target), enemyIdentity = nativeTravelEnemyIdentity(run, target),
      nativeInteractions = (landmark || this.interactionEntries.size) && Array.isArray(run?.interactables?.list)
        ? new Set(run.interactables.list) : null,
      valid = options.eligible === true && run?.state === "play" &&
        !nativeTravelEnemyRetired(run, enemyIdentity) &&
        !(landmark && (landmark.used || nativeInteractions && !nativeInteractions.has(landmark))) &&
        [now, pos?.x, pos?.y, pos?.z, goal?.x, goal?.z].every(Number.isFinite),
      key = options.targetKey ?? target?.id ?? target?.entity ?? target;
    for (const entry of this.enemyEntries)
      if (nativeTravelEnemyRetired(run, entry.nativeEnemy)) this.retireEntry(entry);
    for (const entry of this.interactionEntries)
      if (entry.interactionEntity.used || nativeInteractions && !nativeInteractions.has(entry.interactionEntity))
        this.retireEntry(entry);
    const none = reason => ({ active: false, direction: null, until: null, attempts: 0, reason });
    if (!valid || key == null) {
      const previous = this.entries.get(this.key);
      if (previous) { previous.direction = null; previous.until = 0; }
      this.key = null; return none("hop-intent-gated");
    }
    if (this.key !== key) {
      const previous = this.entries.get(this.key);
      if (previous) { previous.direction = null; previous.until = 0; }
      this.key = key;
    }
    const floor = typeof run.terrain?.height === "function" ?
        traversalSupport({ terrain: run.terrain, player: p }, pos.x, pos.z, pos.y).support : undefined,
      distance = tacticDistance(pos, goal),
      grounded = p.grounded !== false && Number.isFinite(floor) && Math.abs(pos.y - floor) < .12;
    if (distance < .8) {
      const previous = this.entries.get(key);
      if (previous) { previous.direction = null; previous.until = 0; }
      return none("hop-destination-reached");
    }
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { key, nativeEnemy: enemyIdentity, interactionEntity: landmark,
        direction: null, until: 0, bestDistance: distance, bestFloor: grounded ? floor : -Infinity,
        escapeGoal: null, bestEscapeDistance: Infinity,
        failed: [], attempts: 0, blockedUntil: 0 };
      this.entries.set(key, entry);
      if (entry.nativeEnemy) this.enemyEntries.add(entry);
      if (entry.interactionEntity) this.interactionEntries.add(entry);
    }
    const escapeDistance = entry.escapeGoal ? tacticDistance(pos, entry.escapeGoal) : Infinity,
      closerToExit = escapeDistance < entry.bestEscapeDistance - .7,
      closer = distance < entry.bestDistance - .7,
      climbed = grounded && Number.isFinite(floor) && floor >= entry.bestFloor + .45;
    // Standing on a new, higher native floor counts; airborne altitude and
    // revisiting the same low/high shelf never renew this ledger.
    if (closer || climbed || closerToExit) {
      entry.bestDistance = Math.min(entry.bestDistance, distance);
      if (grounded && Number.isFinite(floor)) entry.bestFloor = Math.max(entry.bestFloor, floor);
      entry.bestEscapeDistance = Math.min(entry.bestEscapeDistance, escapeDistance);
      entry.failed = []; entry.attempts = 0; entry.blockedUntil = 0;
      if (entry.direction) entry.until = now + 2.4;
    }
    if (entry.direction && now >= entry.until) {
      entry.failed.push(entry.direction); entry.direction = null;
      if (entry.attempts >= 3) entry.blockedUntil = now + 5.2;
    }
    if (now < entry.blockedUntil) return { ...none("hop-attempt-budget"), attempts: entry.attempts };
    if (entry.blockedUntil > 0) { entry.blockedUntil = 0; entry.failed = []; entry.attempts = 0; }
    if (!entry.direction && entry.attempts >= 3) {
      entry.blockedUntil = now + 5.2;
      return { ...none("hop-attempt-budget"), attempts: entry.attempts };
    }
    if (!entry.direction) {
      const proposal = options.candidate,
        choices = proposal?.kind === "jump" ? [proposal, ...(proposal.alternatives || [])] : [],
        next = choices.find(choice => {
          const direction = choice?.direction, length = Math.hypot(direction?.x || 0, direction?.z || 0);
          return length > .9 && !entry.failed.some(old =>
            (old.x * direction.x + old.z * direction.z) / length > .94);
        });
      if (next) {
        const length = Math.hypot(next.direction.x, next.direction.z);
        entry.direction = { x: next.direction.x / length, z: next.direction.z / length };
        if ([proposal.escapeGoal?.x, proposal.escapeGoal?.z].every(Number.isFinite) && !entry.escapeGoal) {
          entry.escapeGoal = { x: proposal.escapeGoal.x, z: proposal.escapeGoal.z };
          entry.bestEscapeDistance = tacticDistance(pos, entry.escapeGoal);
        }
        entry.until = now + 2.4; entry.attempts++;
      }
    }
    return entry.direction ? { active: true, direction: { ...entry.direction }, until: entry.until,
      attempts: entry.attempts, reason: "committed-native-uphill-hops" } :
      { ...none("no-new-native-hop-direction"), attempts: entry.attempts };
  }
}

function traversalArc(state, direction, jumpNow) {
  const terrain = state.terrain, p = state.player, firstFrame = Math.min(0.05,
    Number.isFinite(p.frameDt) && p.frameDt > 0 ? p.frameDt : 1 / 60),
    // Preserve the upcoming frame. Future hit-stop microsteps must not turn a
    // bounded local search into tens of thousands of geometry queries.
    frame = Math.max(1 / 120, firstFrame), speed = p.speed || 6.3,
    radius = p.radius || 0.55, impulse = state.jumpVelocity ?? p.jumpVelocity,
    extraImpulse = state.extraJumpVelocity ?? (p.grounded !== false || state.nativeGroundJumpAllowed === true ||
      traversalSupport(state, p.x, p.z, p.y).waterJump ? impulse * 0.92 : impulse),
    limit = 1.2;
  let x = p.x, y = p.y, z = p.z, vx = p.vx || 0, vy = p.vy || 0, vz = p.vz || 0,
    grounded = p.grounded !== false, slide = Math.max(0, p.slideT || 0),
    landBuffer = p.landBuffer || 0,
    kx = p.kx || 0, kz = p.kz || 0,
    extra = state.canJump !== true ? 0 : grounded || traversalSupport(state, x, z, y).waterJump ? Math.max(0, Math.floor(state.extraJumps ?? p.extraJumps ?? 0))
      : Math.max(0, Math.floor(p.jumpsLeft || 0)), jumps = 0, blockedBefore = false,
    nextJumpAt = null, landedAt = null, boundary = false,
    lastJumpAt = -Infinity,
    highestGround = grounded ? traversalSupport(state, x, z, y).support : -Infinity;
  const path = [{ x, y, z, t: 0 }];
  for (let time = 0; time < limit - 1e-9;) {
    const dt = Math.min(time === 0 ? firstFrame : frame, limit - time);
    const surface = traversalSupport(state, x, z, y);
    if (slide > 0) { slide -= dt; vx *= Math.exp(-dt * 2.2); vz *= Math.exp(-dt * 2.2); }
    else if (grounded) {
      const gain = Math.min(1, 280 * dt / Math.max(1, speed));
      if (landBuffer > 0 && Math.hypot(vx, vz) > speed) { vx *= 0.97; vz *= 0.97; }
      else { vx += (direction.x * speed - vx) * gain; vz += (direction.z * speed - vz) * gain; }
    } else if ((p.floats === true || p.types?.includes?.("flying")) && !p.diving &&
        time < (p.jumpHeldFor || 0) && vy < -1.5 && (direction.x || direction.z)) {
      const blend=Math.min(1,6*dt);
      vx+=(direction.x*speed-vx)*blend;vz+=(direction.z*speed-vz)*blend;
    } else {
      const along = vx * direction.x + vz * direction.z,
        gain = Math.max(0, Math.min(speed * 0.9 - along, speed * 5 * dt));
      vx += direction.x * gain; vz += direction.z * gain;
      const length = Math.hypot(vx, vz);
      if (length > speed * 1.7) { vx *= speed * 1.7 / length; vz *= speed * 1.7 / length; }
    }
    const relaunch = (grounded || surface.waterJump) && blockedBefore && jumps > 0 && time - lastJumpAt >= .2 &&
      slide <= 0 && Number.isFinite(impulse) && impulse > 0 &&
      state.repeatTerrainHops !== false && time > 0;
    if (time === 0 && jumpNow || relaunch || !grounded && blockedBefore && vy <= 0.5 && extra > 0) {
      const first = time === 0 && jumpNow;
      if (grounded || surface.waterJump || extra > 0 || first && state.canJump === true) {
        const fromGround = grounded || surface.waterJump;
        vy = first || fromGround ? impulse : extraImpulse;
        if (!grounded && extra > 0) extra--;
        if (fromGround) extra = Math.max(0, Math.floor(state.extraJumps ?? p.extraJumps ?? 0));
        grounded = false; jumps++; lastJumpAt = time; nextJumpAt ??= time;
      }
    }
    if (!grounded && (p.floats === true || p.types?.includes?.("flying")) && !p.diving &&
        time < (p.jumpHeldFor || 0) && vy < -2)vy=-2;
    vy -= 30 * dt;
    landBuffer -= dt;
    kx *= Math.exp(-9 * dt); kz *= Math.exp(-9 * dt);
    let crowdX = time === 0 ? p.crowdX || 0 : 0, crowdZ = time === 0 ? p.crowdZ || 0 : 0;
    if ((p.anchorT || 0) > time + dt) { crowdX *= 0.35; crowdZ *= 0.35; }
    const crowdLength = Math.hypot(crowdX, crowdZ), crowdLimit = 5.5 * dt;
    if (crowdLength > crowdLimit) { crowdX *= crowdLimit / crowdLength; crowdZ *= crowdLimit / crowdLength; }
    const dx = vx * dt + kx * dt + crowdX, dz = vz * dt + kz * dt + crowdZ, edge = radius * 0.8;
    const blocked = (tx, tz, mx, mz) => {
      if (!traversalInBounds(state, tx, tz)) { boundary = true; return true; }
      const a = terrain.height(tx, tz), b = terrain.height(tx + Math.sign(mx) * edge,
        tz + Math.sign(mz) * edge);
      return !Number.isFinite(a) || !Number.isFinite(b) || Math.max(a, b) > y + 0.6 ||
        !!terrain.hitProp?.(tx, y, tz, radius);
    };
    blockedBefore = false;
    if (blocked(x + dx, z, dx, 0)) { vx = 0; kx = 0; blockedBefore = true; } else x += dx;
    if (blocked(x, z + dz, 0, dz)) { vz = 0; kz = 0; blockedBefore = true; } else z += dz;
    y += vy * dt;
    const floor = surface.deep || surface.ice ? surface.support : terrain.height(x, z);
    if (!Number.isFinite(floor)) return null;
    const wasGrounded = grounded;
    if (y <= floor || grounded && vy <= 0 && y - floor < 0.9) {
      if (!grounded && jumps > 0) landedAt ??= time + dt;
      if (!grounded && vy < -8) landBuffer = 0.12;
      y = floor; if (vy < 0) vy = 0; grounded = true;
    } else if (y > floor + 0.25) grounded = false;
    else if (vy <= 0) { y = floor; grounded = true; }
    if (!wasGrounded && grounded && jumps > 0) landedAt ??= time + dt;
    if (grounded) highestGround = Math.max(highestGround, floor);
    if (time < (p.forceFor || 0)) { kx += (p.forceX || 0) * dt; kz += (p.forceZ || 0) * dt; }
    time += dt; path.push({ x, y, z, t: time });
  }
  return { path, x, y, z, grounded, jumps, nextJumpAt, landedAt, boundary, highestGround };
}

// A bounded local traversal proposal, independent of loadout preferences. It
// simulates the native axis collision BEFORE vertical displacement, allowing a
// player to rise against a finite ledge instead of inventing a path through it.
export function planTerrainTraversal(state) {
  const terrain = state.terrain, p = state.player, goal = state.target;
  const none = reason => ({ kind: "none", reason, jump: false });
  if (!terrain || !p || !goal || typeof terrain.height !== "function" ||
      typeof terrain.inBounds !== "function" || typeof terrain.walkClear !== "function" ||
      ![p.x, p.y, p.z, goal.x, goal.z].every(Number.isFinite)) return none("missing-terrain-contract");
  const geometry = terrainEscapeIntent(state), planningGoal = geometry?.escapeGoal || goal,
    distance = tacticDistance(p, planningGoal), angle = Math.atan2(planningGoal.z - p.z, planningGoal.x - p.x),
    probe = Math.min(5, distance), forward = { x: Math.cos(angle), z: Math.sin(angle) };
  if (distance < 0.8) return none("destination-reached");
  const walkClear = (from, direction, length) => nativeFootprintWalkClear(terrain, from, direction,
    length, p.radius || 0.55, (x, z, margin) => traversalInBounds(state, x, z, margin));
  if (walkClear(p, forward, probe) && !(p.stuckT > 0.5) && geometry?.kind !== "water")
    return none("ground-route-clear");
  const impulse = state.jumpVelocity ?? p.jumpVelocity,
    canLaunch = state.canJump === true && Number.isFinite(impulse) && impulse > 0,
    jumpNow = canLaunch && (state.nativeGroundJumpAllowed === true ||
      p.grounded !== false || traversalSupport(state, p.x, p.z, p.y).waterJump || (p.vy || 0) <= 1);
  let bestJump = null, bestWalk = null; const jumpChoices = [], waterProbes = [], slopeProbes = [];
  const originFloor = traversalSupport(state, p.x, p.z, p.y).support, maxSamples = 16,
    preferredAngle = geometry ? Math.atan2(geometry.direction.z, geometry.direction.x) : angle;
  for (let index = 0; index < maxSamples; index++) {
    const directionAngle = preferredAngle + index * Math.PI / 8,
      direction = { x: Math.cos(directionAngle), z: Math.sin(directionAngle) };
    for (const length of [3, 6]) {
      const x = p.x + direction.x * length, z = p.z + direction.z * length;
      if (!traversalInBounds(state, x, z) || !walkClear(p, direction, length)) continue;
      const floor = terrain.height(x, z);
      if (!Number.isFinite(floor) || floor < originFloor - 1.5 &&
          !terrain.walkClear(x, z, -direction.x, -direction.z, length, p.radius || 0.55)) continue;
      const cost = Math.hypot(x - planningGoal.x, z - planningGoal.z) + length * 0.12;
      if (!bestWalk || cost < bestWalk.cost) bestWalk = { kind: "walk", target: { x, z }, direction, cost,
        reason: "local-walk-detour", jump: false };
    }
    if (!canLaunch && p.grounded !== false) continue;
    const arc = traversalArc(state, direction, jumpNow);
    if (!arc || arc.boundary) continue;
    if (geometry?.kind === "water" && canLaunch && arc.jumps > 0 &&
        direction.x * geometry.direction.x + direction.z * geometry.direction.z > .5) {
      // When current jump power cannot prove a complete shore crossing, still
      // permit one bounded, physically simulated push normal to that shore.
      // It does not claim a landing or a traversable wall. The hop ledger then
      // yields to grounded native rescue instead of circling forever.
      waterProbes.push({ kind: "jump", direction, path: arc.path, target: { x: arc.x, z: arc.z },
        jump: jumpNow, plannedJumps: arc.jumps, rise: arc.highestGround - originFloor,
        escapeGoal: geometry.escapeGoal, cost: Math.hypot(arc.x - planningGoal.x, arc.z - planningGoal.z),
        reachable: false, reason: "bounded-native-water-shore-probe" });
    }
    if (geometry?.kind === "slope" && canLaunch && arc.jumps > 0 &&
        direction.x * geometry.direction.x + direction.z * geometry.direction.z > .995) {
      const foot = (p.radius || .55) * .8 + .08,
        fx = p.x + direction.x * foot, fz = p.z + direction.z * foot;
      if (traversalInBounds(state, fx, fz) && terrain.height(fx, fz) > p.y + .6 &&
          !terrain.hitProp?.(fx, p.y, fz, p.radius || .55))
        slopeProbes.push({ kind: "jump", direction, path: arc.path, target: { x: arc.x, z: arc.z },
          jump: jumpNow, plannedJumps: arc.jumps, rise: arc.highestGround - originFloor,
          cost: Math.hypot(arc.x - planningGoal.x, arc.z - planningGoal.z),
          reachable: false, reason: "bounded-native-uphill-probe" });
    }
    if (arc.landedAt == null) continue;
    const displacement = Math.hypot(arc.x - p.x, arc.z - p.z), rise = arc.highestGround - originFloor,
      progress = distance - Math.hypot(planningGoal.x - arc.x, planningGoal.z - arc.z);
    // A real intermediate landing on a higher shelf can be the first half of
    // a long ramp. Requiring the entire 1.2s horizon to finish grounded threw
    // these valid repeated-hop approaches away, inducing sideways circles.
    const partial = !arc.grounded && rise >= .45;
    if ((displacement < (rise >= .45 ? .02 : 1)) ||
        rise < -1.5 || progress < 0.4 && rise < 0.5 || !arc.grounded && !partial) continue;
    const uphillAligned = geometry?.kind === "slope" && rise >= .45 &&
        direction.x * geometry.direction.x + direction.z * geometry.direction.z > .995,
      cost = Math.hypot(arc.x - planningGoal.x, arc.z - planningGoal.z) - Math.max(0, rise) * 0.6 + arc.jumps * 0.15;
    const choice = { kind: "jump", direction, path: arc.path,
      target: { x: arc.x, z: arc.z }, jump: jumpNow, nextJumpAt: arc.nextJumpAt,
      plannedJumps: arc.jumps, rise, cost, partial, uphillAligned, escapeGoal: geometry?.escapeGoal,
      reason: geometry?.kind === "water" ? "native-water-shore-exit" :
        uphillAligned ? "perpendicular-native-uphill-hops" : partial ? "partial-native-uphill-hop" :
          rise > 0.5 ? "reachable-native-ledge" : "bounded-obstacle-jump" };
    jumpChoices.push(choice);
    if (!bestJump || uphillAligned && !bestJump.uphillAligned || uphillAligned === bestJump.uphillAligned && cost < bestJump.cost)
      bestJump = choice;
  }
  if (slopeProbes.length && !bestJump?.uphillAligned) return { ...slopeProbes[0], alternatives: [] };
  if (bestJump && (bestJump.uphillAligned || geometry?.kind === "water" || !bestWalk || bestJump.cost + 0.25 < bestWalk.cost)) return { ...bestJump,
    alternatives: jumpChoices.sort((a, b) => a.cost - b.cost).slice(0, 8).map(choice => ({ direction: choice.direction })) };
  if (waterProbes.length) {
    waterProbes.sort((a, b) => (b.direction.x * geometry.direction.x + b.direction.z * geometry.direction.z) -
      (a.direction.x * geometry.direction.x + a.direction.z * geometry.direction.z) || a.cost - b.cost);
    return { ...waterProbes[0], alternatives: waterProbes.slice(0, 8).map(choice => ({ direction: choice.direction })) };
  }
  return bestWalk || none("no-reachable-local-exit");
}

// Native Boss/Totem/Summoner flags and live director identities cover ordinary,
// endless and Tower guardians without a species list that drifts after updates.
export function isNativeBoss(run,index) {
  const en=run?.enemies;
  return Number.isInteger(index)&&index>=0&&!!en?.alive?.[index]&&!(en.dying?.[index]>0)&&
    (!!((en.flags?.[index]||0)&12292)||run?.boss?.alive===true&&run.boss.bossIndex===index||
      run?.tower?.guardian?.[0]===index&&Number.isInteger(en.gen?.[index])&&run.tower.guardian[1]===en.gen[index]);
}

export function combatDistanceOptions(run, index, fallbackRange = 11, intent = {}) {
  const player = run?.player, enemies = run?.enemies;
  if (!player || !enemies) return [];
  if(intent.bossRetreat===true&&isNativeBoss(run,index)&&intent.requiredCapture!==true){
    const current=Math.hypot(player.pos.x-enemies.x[index],player.pos.z-enemies.z[index]);
    return [{range:Math.max(16,current,tacticNumber(enemies.radius?.[index])+
      tacticNumber(player.radius,.55)+8),coverage:0,reason:"boss-separation"}];
  }
  // Default movement retains useful attack distances. Only the explicit Boss
  // retreat preference removes coverage from positioning; verified capture
  // still keeps its required weaken/throw distance when that preference is on.
  const radius = Math.max(0, tacticNumber(enemies.radius?.[index], 0.7)),
    minimum = Math.max(2.7, radius + tacticNumber(player.radius, 0.55) + 0.75),
    maximum = Math.max(minimum, 11), stats = player.stats || {},
    far = tacticClamp(tacticNumber(fallbackRange, 11), minimum, maximum),
    moves = (player.moves || []).flatMap(move => {
      const def = move?.def;
      if (!def || !(def.dmg > 0) || ["buff", "weather", "random", "trail"].includes(def.arch)) return [];
      const area = tacticNumber(def.area, 3) * tacticNumber(move.mods?.area, 1) * tacticNumber(stats.area, 1),
        count = Math.max(1, tacticNumber(def.count, 1) + tacticNumber(move.mods?.count)),
        proxy = def.dmg * tacticNumber(move.mods?.dmg, 1) *
          (1 + (Math.max(1, tacticNumber(move.level, 1)) - 1) * 0.04) * count /
          Math.max(0.12, tacticNumber(def.cd, 1) * tacticNumber(move.mods?.cd, 1)),
        // Native strike places the hit center at min(distance, area*.6), then
        // Enemies.within adds enemy.radius to the area*.75 hit radius.
        reach = def.arch === "strike" ? area * 1.35 + radius :
          combatRange([move], radius, stats);
      return [{ reach: Math.max(0, reach), proxy: Math.max(0, proxy),
        observed: Math.max(0, tacticNumber(move.damageDone)) }];
    }), totalObserved = moves.reduce((sum, move) => sum + move.observed, 0),
    totalProxy = moves.reduce((sum, move) => sum + move.proxy, 0);
  if (!moves.length || !(totalProxy > 0)) return [{ range: far, coverage: 0, reason: "ranged-fallback" }];
  for (const move of moves) move.weight = totalObserved > 0 ?
    0.75 * move.observed / totalObserved + 0.25 * move.proxy / totalProxy : move.proxy / totalProxy;
  const ordered = [...moves].sort((a, b) => a.reach - b.reach);
  let cumulative = 0, mainReach = ordered.at(-1).reach;
  for (const move of ordered) {
    cumulative += move.weight;
    if (cumulative >= 0.5) { mainReach = move.reach; break; }
  }
  const options = [];
  for (const [range, reason] of [[minimum, "body-gap"],
    [tacticClamp(mainReach - 0.25, minimum, maximum), "weighted-native-coverage"],
    [far, "ranged-fallback"]]) {
    if (options.some(option => Math.abs(option.range - range) < 0.15)) continue;
    options.push({ range, coverage: moves.reduce((sum, move) =>
      sum + (range <= move.reach ? move.weight : 0), 0), reason });
  }
  return options;
}

// Reviewed native 0.8.59 cast bodies. A different native implementation falls
// back to ordinary combat; names/localization and species evolution are not IDs.
// Radius means acquisition/full-area opportunity, not guaranteed delayed damage.
const towerUltimateProfiles = {
  "1556:2895153670":{"family":74,"radius":[0,16,16],"cap":14,"area":1},
  "1849:2298134432":{"family":77,"radius":9,"cap":0,"area":1},
  "1711:3877738121":{"family":79,"radius":14,"cap":10,"area":1},
  "1328:2077132926":{"family":81,"radius":12,"cap":16,"area":1},
  "898:191816362":{"family":83,"radius":[0,15,15],"cap":10,"area":1},
  "1109:868456154":{"family":84,"radius":14,"cap":9,"area":0},
  "1892:1348867615":{"family":86,"radius":[13,15,15],"cap":0,"area":1},
  "2151:1686221743":{"family":88,"radius":[14,9,9],"cap":0,"area":1},
  "1365:2675792890":{"family":90,"radius":[0,16,16],"cap":18,"area":1},
  "2008:1159538816":{"family":92,"radius":[12,16,16],"cap":[0,14,12],"area":1},
  "1147:93960061":{"family":95,"radius":[0,0,15],"cap":10,"area":1},
  "1794:4196193972":{"family":96,"radius":[14,16,16],"cap":0,"area":1},
  "1540:32890510":{"family":98,"radius":[10,15,15],"cap":[0,8,8],"area":1},
  "1579:3892038900":{"family":100,"radius":[15,15,15],"cap":[8,0,0],"area":[0,1,1]},
  "1187:2914723244":{"family":102,"radius":15,"cap":[14,12,16],"area":1},
  "1277:1055390001":{"family":104,"radius":[0,15,15],"cap":[0,10,14],"area":1},
  "948:3314201552":{"family":106,"radius":14,"cap":6,"area":0},
  "1460:2127421284":{"family":107,"radius":15,"cap":9,"area":1},
  "884:3914783963":{"family":108,"radius":12,"cap":0,"area":1},
  "498:4224984988":{"family":109,"radius":[9,10,11],"cap":0,"area":1},
  "1650:1111617349":{"family":111,"radius":[0,16,16],"cap":12,"area":1},
  "537:1371580906":{"family":113,"radius":15,"cap":[6,8,10],"area":1},
  "858:1983469028":{"family":114,"radius":[13,15,17],"cap":[14,20,26],"area":1},
  "967:76039204":{"family":115,"radius":14,"cap":[8,10,12],"area":0},
  "1675:1200039427":{"family":116,"radius":12,"cap":0,"area":1},
  "1281:257973826":{"family":118,"radius":16,"cap":[8,10,10],"area":1},
  "959:1576648830":{"family":120,"radius":16,"cap":[10,14,14],"area":0},
  "808:699269294":{"family":123,"radius":15,"cap":[8,11,14],"area":0},
  "1745:1367644466":{"family":122,"radius":[10,12,14],"cap":0,"area":1},
  "1615:3989720483":{"family":124,"radius":16,"cap":12,"area":1},
  "1185:2672980133":{"family":125,"radius":15,"cap":6,"area":0},
  "1439:2219114978":{"family":126,"radius":15,"cap":[10,14,18],"area":1},
  "1271:3199258672":{"family":127,"radius":15,"cap":[3,4,5],"area":1},
  "1645:654167340":{"family":137,"radius":14,"cap":10,"area":1},
  "2287:3569393695":{"family":129,"radius":11,"cap":0,"area":1},
  "1551:2509955956":{"family":131,"radius":[12,14,16],"cap":0,"area":1},
  "1276:4149318500":{"family":138,"radius":9,"cap":0,"area":1},
  "1475:2459327835":{"family":140,"radius":[8,15,15],"cap":[0,6,6],"area":[1,0,0]},
  "856:3179056551":{"family":142,"radius":9,"cap":0,"area":1},
  "1389:621957276":{"family":144,"radius":17,"cap":18,"area":1},
  "1118:3611795665":{"family":145,"radius":18,"cap":6,"area":1},
  "1392:1199612875":{"family":146,"radius":17,"cap":16,"area":1},
  "1659:2445427586":{"family":150,"radius":22,"cap":16,"area":1},
  "1768:42451724":{"family":133,"radius":15,"cap":12,"area":1},
  "949:2666568540":{"family":143,"radius":12,"cap":0,"area":1},
  "1535:953008202":{"family":147,"radius":[0,13,17],"cap":[0,0,12],"area":1},
  "1208:4132418491":{"family":1,"radius":[0,9,15],"cap":0,"area":1},
  "2001:2006277975":{"family":4,"radius":[8,14,14],"cap":0,"area":1},
  "1802:472150352":{"family":7,"radius":[9,16,12],"cap":0,"area":1},
  "2071:3181756653":{"family":10,"radius":[0,0,14],"cap":0,"area":1},
  "1332:294877408":{"family":13,"radius":[0,0,18],"cap":8,"area":0},
  "767:142409927":{"family":16,"radius":[0,0,18],"cap":8,"area":0},
  "1227:1471278929":{"family":19,"radius":14,"cap":[7,12,12],"area":0},
  "999:19787554":{"family":21,"radius":[0,18,18],"cap":5,"area":0},
  "1756:3034879424":{"family":23,"radius":[5.5,20,20],"cap":0,"area":1},
  "1265:2856681024":{"family":25,"radius":15,"cap":6,"area":1},
  "1142:562616546":{"family":27,"radius":[9,0,0],"cap":0,"area":1},
  "1721:26998457":{"family":29,"radius":[0,0,16],"cap":12,"area":1},
  "1871:3926083048":{"family":32,"radius":[0,0,14],"cap":0,"area":1},
  "1369:1187287588":{"family":35,"radius":16,"cap":8,"area":1},
  "1376:3277783281":{"family":37,"radius":16,"cap":[9,18,18],"area":1},
  "1210:625452078":{"family":39,"radius":15,"cap":0,"area":1},
  "967:4147703973":{"family":41,"radius":18,"cap":8,"area":0},
  "2394:2290218512":{"family":43,"radius":[12,10,16],"cap":[0,0,14],"area":1},
  "1109:663811014":{"family":46,"radius":[0,16,16],"cap":16,"area":1},
  "1536:2211389257":{"family":48,"radius":[16,18,18],"cap":[12,6,6],"area":[1,0,0]},
  "993:453780162":{"family":50,"radius":16,"cap":[10,20,20],"area":1},
  "1224:1619968796":{"family":52,"radius":15,"cap":16,"area":1},
  "1148:2434742535":{"family":54,"radius":15,"cap":0,"area":1},
  "1081:914119803":{"family":56,"radius":14,"cap":[8,12,12],"area":0},
  "1430:1466078357":{"family":58,"radius":16,"cap":[6,10,10],"area":0},
  "1795:2107578197":{"family":60,"radius":13,"cap":0,"area":1},
  "1780:3848557190":{"family":63,"radius":[16,15,16],"cap":[5,14,14],"area":[0,1,1]},
  "1403:2808158321":{"family":66,"radius":[0,11,12],"cap":0,"area":1},
  "2165:4103399143":{"family":69,"radius":[0,15,0],"cap":12,"area":1},
  "1231:4172503369":{"family":72,"radius":16,"cap":[10,16,16],"area":1}
};
const towerUltimateProfileCache = new WeakMap();
function reviewedUltimateProfile(run) {
  const cast=run?.ult?.def?.cast;
  if(typeof cast!=="function"||!run.player)return null;
  let entry=towerUltimateProfileCache.get(cast);
  if(entry===undefined){
    const text=Function.prototype.toString.call(cast),body=text.slice(text.indexOf("{")).replace(/\s+/g,"");
    let hash=2166136261;for(let i=0;i<body.length;i++)hash=Math.imul(hash^body.charCodeAt(i),16777619)>>>0;
    entry=towerUltimateProfiles[body.length+":"+hash]||null;towerUltimateProfileCache.set(cast,entry);
  }
  if(!entry)return null;
  const tier=Number(run.ult.tier);
  if(!Number.isInteger(tier)||tier<0||tier>2)return null;
  const at=value=>Array.isArray(value)?value[tier]:value;
  let radius=at(entry.radius),cap=at(entry.cap),area=at(entry.area);
  // Magikarp's evolved beam form is directional; Eevee's branches replace cast
  // geometry by current species, while sharing the same definition function.
  if(entry.family===129&&run.ult.form!==0)return null;
  if(entry.family===133){
    if(run.player.speciesId===134){radius=16;cap=0;}
    if(run.player.speciesId===135){radius=15;cap=6;}
    if(run.player.speciesId===136){radius=11;cap=0;}
  }
  if(!(radius>0))return null;
  const nativeArea=Number(run.player.stats?.area);
  if(area&&(!Number.isFinite(nativeArea)||nativeArea<=0))return null;
  const scale=area?Math.sqrt(nativeArea):1;
  // Leave a small edge margin and keep at least one native aim target in 18m.
  const nativeRadius=radius*scale;
  radius=Math.min(17.25,nativeRadius-.75);
  return radius>.5?{family:entry.family,radius,nativeRadius,cap:cap||Infinity}:null;
}
function ultimateClusterEnemies(run, radius=Infinity) {
  const en=run.enemies||{},pos=run.player.pos,result=[];
  for(let i=0;i<(en.n||0);i++){
    if(!en.alive?.[i]||en.dying?.[i]>0||(en.flags?.[i]||0)&(16512|49152))continue;
    if(run.capture?.index===i&&["weakened","throwing"].includes(run.capture.state)||
       run.allies?.down===i&&["down","throwing"].includes(run.allies.state))continue;
    const x=en.x?.[i],z=en.z?.[i];
    if(Number.isFinite(x)&&Number.isFinite(z)&&Math.hypot(x-pos.x,z-pos.z)<=radius)
      result.push({index:i,x,z,radius:tacticNumber(en.radius?.[i],.7)});
  }
  return result;
}
function ultimateClusterCount(enemies,point,profile) {
  let count=0;for(const enemy of enemies)if(Math.hypot(enemy.x-point.x,enemy.z-point.z)<profile.radius&&++count>=profile.cap)break;
  return count;
}
function ultimateBossOpportunity(run,point=run.player.pos,profile=reviewedUltimateProfile(run),hypothetical=false) {
  const en=run.enemies||{},index=run.boss?.bossIndex;
  if(!run.boss?.alive||!Number.isInteger(index)||!en.alive?.[index]||en.dying?.[index]>0||
      (en.flags?.[index]||0)&49152||![en.x?.[index],en.z?.[index]].every(Number.isFinite))return null;
  const distance=Math.hypot(en.x[index]-point.x,en.z[index]-point.z),radius=profile?.radius??17.25;
  let aim=-1;try{aim=run.aimTarget?.(18)??-1;}catch{}
  const aimSensitive=!profile||[16,21,32,74,84,98,111,129,147].includes(profile.family);
  let competitors=0;
  if(Number.isFinite(profile?.cap))for(let i=0;i<(en.n||0);i++){
    if(i===index||!en.alive?.[i]||en.dying?.[i]>0)continue;
    const gap=Math.hypot(en.x[i]-point.x,en.z[i]-point.z);
    // Native x_ jitters ranking distances by 0.8..1.2. This conservative
    // margin stops a capped acquisition from counting a crowd but losing boss.
    if(gap<profile.nativeRadius&&gap<=distance*1.5)competitors++;
  }
  return {index,distance,radius,known:!!profile,aimSensitive,competitors,
    covered:distance<radius&&(!aimSensitive||hypothetical||aim===index)&&
      (!Number.isFinite(profile?.cap)||competitors<profile.cap)};
}
function planTowerUltimateBoss(run,options,profile) {
  const boss=ultimateBossOpportunity(run,run.player.pos,profile),pos=run.player.pos,
    base={phase:boss?.covered?"cast":"wait",reason:boss?.covered?"boss-in-ultimate-coverage":"wait-for-boss-coverage",
      run,profile,boss,currentCount:0,bestCount:0,nextHistory:options.history||null};
  if(!boss)return {...base,phase:"off",reason:"ordinary-ultimate-policy"};
  if(boss.covered||!profile||run.player.hp<run.player.maxHp*.45)return base;
  const en=run.enemies,speed=Math.max(.3,6.3*tacticNumber(run.player.stats?.moveSpeed,1)),
    angle=Math.atan2(pos.z-en.z[boss.index],pos.x-en.x[boss.index]),
    gap=tacticNumber(en.radius?.[boss.index],.7)+tacticNumber(run.player.radius,.55)+1,
    enemies=ultimateClusterEnemies(run),candidates=[];
  for(const scale of [.88,.65,.4])for(const offset of [0,.4,-.4,.85,-.85,1.4,-1.4,Math.PI]){
    const range=Math.max(gap,profile.radius*scale);
    if(range>=profile.radius)continue;
    const point={x:en.x[boss.index]+Math.cos(angle+offset)*range,z:en.z[boss.index]+Math.sin(angle+offset)*range},
      distance=tacticDistance(pos,point),future=ultimateBossOpportunity(run,point,profile,true);
    if(distance/speed>3||!future?.covered||typeof options.routeAllowed!=="function"||options.routeAllowed(point)!==true)continue;
    const pressure=scoreCombatPosition(run,boss.index,point);
    if(pressure.destinationPressure>3||pressure.corridorPressure>1)continue;
    const dx=point.x-pos.x,dz=point.z-pos.z,length2=dx*dx+dz*dz;
    if(length2>.01&&enemies.some(enemy=>{
      const along=tacticClamp(((enemy.x-pos.x)*dx+(enemy.z-pos.z)*dz)/length2,0,1);
      return Math.hypot(enemy.x-pos.x-dx*along,enemy.z-pos.z-dz*along)<enemy.radius+tacticNumber(run.player.radius,.55)+.8;
    }))continue;
    candidates.push({...point,count:ultimateClusterCount(enemies,point,profile),distance,cost:pressure.cost});
  }
  candidates.sort((a,b)=>b.count-a.count||a.cost-b.cost||a.distance-b.distance);
  const target=candidates[0];
  return target?{...base,phase:"approach",reason:"approach-boss-ultimate-coverage",bestCount:target.count,
    target:{x:target.x,z:target.z,radius:.6}}:base;
}
export function planTowerUltimateCluster(run,options={}) {
  const p=run?.player,ult=run?.ult,now=Number(run?.time),profile=reviewedUltimateProfile(run),
    off=reason=>({phase:"off",reason,currentCount:0,bestCount:0,nextHistory:options.history||null});
  if(!options.enabled||!run?.tower||["clear","roof"].includes(run.tower.state)||
     run.state!=="play"||p?.dead||!p?.pos||ult?.ready!==true||ult.active>0||
     run.meta?.profile?.settings?.autoUlt===true||options.autoUlt===true||!Number.isFinite(now))return off("ordinary-ultimate-policy");
  if(run.boss?.alive)return planTowerUltimateBoss(run,options,profile);
  if(!profile)return off("ordinary-ultimate-policy");
  const pos=p.pos,speed=Math.max(.3,6.3*tacticNumber(p.stats?.moveSpeed,1)),reach=speed*3,
    enemies=ultimateClusterEnemies(run,profile.radius+reach+1),
    currentCount=ultimateClusterCount(enemies,pos,profile),old=options.history,
    same=old?.run===run&&old.terrain===run.terrain&&old.floor===run.tower.floor&&old.uses===ult.uses&&
      old.cast===ult.def.cast&&now>=old.startedAt,
    history=same?old:null,
    result={phase:currentCount>=2?"cast":"off",reason:currentCount>=2?"use-current-cluster":"no-useful-cluster",
      run,profile,currentCount,bestCount:currentCount,nextHistory:history};
  if(p.hp<p.maxHp*.45||history&&(history.cancelled||now-history.startedAt>=3))return result;
  const cellSize=Math.max(4,profile.radius*.8),cells=new Map();
  for(const enemy of enemies){
    const key=Math.floor(enemy.x/cellSize)+":"+Math.floor(enemy.z/cellSize),cell=cells.get(key)||{x:0,z:0,n:0};
    cell.x+=enemy.x;cell.z+=enemy.z;cell.n++;cells.set(key,cell);
  }
  const seeds=[...cells.values()].map(c=>({x:c.x/c.n,z:c.z/c.n,n:c.n})).sort((a,b)=>b.n-a.n||tacticDistance(a,pos)-tacticDistance(b,pos)).slice(0,16),
    candidates=[],seen=new Set(),remaining=history?Math.max(0,3-(now-history.startedAt)):3;
  for(const seed of seeds){
    const angle=Math.atan2(pos.z-seed.z,pos.x-seed.x);
    for(const [offset,scale] of [[0,.88],[.55,.8],[-.55,.8],[0,.6],[1.1,.7],[-1.1,.7],[0,0]]){
      const point={x:seed.x+Math.cos(angle+offset)*profile.radius*scale,z:seed.z+Math.sin(angle+offset)*profile.radius*scale},
        distance=tacticDistance(point,pos),key=Math.round(point.x*2)+":"+Math.round(point.z*2);
      if(seen.has(key)||distance<.5||distance/speed>remaining)continue;seen.add(key);
      const count=ultimateClusterCount(enemies,point,profile);
      if(count<2||currentCount>=2&&count<currentCount+2)continue;
      candidates.push({...point,count,distance});
    }
  }
  candidates.sort((a,b)=>b.count-a.count||a.distance-b.distance);
  for(const point of candidates){
    if(typeof options.routeAllowed!=="function"||options.routeAllowed(point)!==true)continue;
    const dx=point.x-pos.x,dz=point.z-pos.z,length2=dx*dx+dz*dz;
    // Do not use native cast invulnerability as permission to walk through bodies.
    const contact=enemies.some(enemy=>{
      const along=tacticClamp(((enemy.x-pos.x)*dx+(enemy.z-pos.z)*dz)/length2,0,1);
      return Math.hypot(enemy.x-pos.x-dx*along,enemy.z-pos.z-dz*along)<enemy.radius+tacticNumber(p.radius,.55)+.8;
    });
    if(contact)continue;
    const pressure=scoreCombatPosition(run,-1,point);
    if(pressure.destinationPressure>3||pressure.corridorPressure>1)continue;
    return {...result,phase:"approach",reason:"larger-reachable-cluster",bestCount:point.count,
      target:{x:point.x,z:point.z,radius:.6},
      nextHistory:history||{run,terrain:run.terrain,floor:run.tower.floor,uses:ult.uses,cast:ult.def.cast,startedAt:now}};
  }
  return result;
}

// Only the native R action is planned here. Ordinary attacks, camera direction,
// locks and automatic/manual aim remain entirely under the game's controls.
export function planUltimateCombat(run, options = {}) {
  const p=run?.player,en=run?.enemies,pos=p?.pos,ult=run?.ult,
    auto=options.autoUlt===true || run?.meta?.profile?.settings?.autoUlt===true,
    history=options.history||{},now=Number(run?.time),uses=Number(ult?.uses),
    nativeUses=Number.isFinite(uses)?uses:null,
    inactive=reason=>({press:false,reason,nextHistory:history,close:0,targetIndex:null,
      rapidRecharge:{confirmed:false,seconds:null,cycles:0}});
  if(!run || run.state!=="play" || p?.dead || !pos || !en)return inactive("native-not-playing");
  if(auto&&options.countGoal!==true)return inactive("native-auto-ultimate-active");
  if(ult?.ready!==true || ult.active>0)return inactive("native-not-ready");
  const dt=tacticClamp(tacticNumber(options.frameDt,1/60),1/240,.05),
    maxHp=Math.max(1,tacticNumber(p.maxHp,100));
  let close=0,near=0;
  for(let index=0;index<(en.n||0);index++) {
    if(!en.alive?.[index] || en.dying?.[index]>0 || (en.flags?.[index]||0)&16512)continue;
    const distance=Math.hypot(en.x[index]-pos.x,en.z[index]-pos.z),
      sameLevel=Math.abs(tacticNumber(en.y?.[index])-pos.y)<tacticNumber(en.hgt?.[index],2)+2;
    if(!sameLevel)continue;
    if(distance<5+tacticNumber(en.radius?.[index],.7))close++;
    if(distance<10)near++;
  }
  let targetIndex=-1;
  // aimTarget is the original read-only resolver used by Ultimate.fire(18),
  // not a request to rotate, create a lock or choose a script-preferred target.
  try {if(typeof run.aimTarget==="function")targetIndex=run.aimTarget(18);}catch{}
  const alive=Number.isInteger(targetIndex)&&targetIndex>=0&&en.alive?.[targetIndex]&&!(en.dying?.[targetIndex]>0),
    distance=alive?Math.hypot(en.x[targetIndex]-pos.x,en.z[targetIndex]-pos.z):Infinity,
    parked=alive&&(run.capture?.index===targetIndex&&["weakened","throwing"].includes(run.capture.state) ||
      run.allies?.down===targetIndex&&["down","throwing"].includes(run.allies.state)),
    targetUsable=alive&&!parked&&distance<=18&&!((en.flags?.[targetIndex]||0)&49152),
    flags=alive?en.flags?.[targetIndex]||0:0,
    capture=targetUsable&&run.capture?.state==="roaming"&&run.capture.index===targetIndex,
    last=Number(history.lastPressAt),validLast=Number.isFinite(last)&&Number.isFinite(now)&&now>=last,
    elapsed=validLast?now-last:Infinity,
    acknowledged=validLast&&nativeUses!==null&&Number.isFinite(history.nativeUsesAtPress)&&
      nativeUses>history.nativeUsesAtPress,
    fastCycle=acknowledged&&elapsed<=6,
    cycles=fastCycle?Math.min(8,(Number(history.fastCycles)||0)+1):0,
    safety=options.motion?.safety,
    // Route penalties (walls, bounds, candle exclusions) also set danger.
    // Only the collision forecast's actual hostile hits can justify R.
    incomingHit=safety?.lethal===true || tacticNumber(safety?.healthDamage)>0 || tacticNumber(safety?.unknownHits)>0,
    emergency=safety?.lethal===true || p.hp<maxHp*.45&&(safety?.healthDamage>0||close>=3) ||
      options.imminentImpact===true&&incomingHit&&tacticNumber(p.iframes)<=dt,
    offensive=targetUsable&&(capture || !!(flags&(4|12290)) || close>=5 || near>=5),
    usefulFast=fastCycle&&targetUsable,
    cluster=options.clusterPlan,clusterProfile=cluster?.run===run?reviewedUltimateProfile(run):null,
    clusterCount=clusterProfile?ultimateClusterCount(ultimateClusterEnemies(run),pos,clusterProfile):0,
    clusterMoving=clusterProfile&&cluster.phase==="approach",
    clusterOffensive=clusterProfile&&targetUsable&&clusterCount>=2,
    bossPriority=options.bossPriority===true&&!!run.tower&&run.boss?.alive===true,
    bossWindow=bossPriority?ultimateBossOpportunity(run):null,
    sameAttempt=validLast&&!acknowledged&&history.nativeUsesAtPress===nativeUses,
    attempts=sameAttempt?Math.max(1,Number(history.attempts)||1):0,
    // Native input can temporarily be rejected while ready remains true. Keep
    // each batch bounded, then permit a fresh useful attempt after native game
    // time advances; an unacknowledged batch must never permanently disable R.
    retryBatchExpired=sameAttempt&&attempts>=3&&elapsed>=1.8,
    waiting=validLast&&(elapsed<.12 || sameAttempt&&(elapsed<.35||attempts>=3&&!retryBatchExpired)),
    press=!waiting&&(options.countGoal===true||emergency||(bossPriority?bossWindow?.covered:!clusterMoving&&(clusterProfile?
      targetUsable&&clusterCount>0&&(clusterOffensive||offensive||usefulFast):offensive||usefulFast))),
    reason=waiting?"wait-for-native-fire-confirmation":options.countGoal===true?"pending-native-ultimate-counter":emergency?"protect-before-imminent-hit":
      bossPriority?(bossWindow?.covered?"boss-in-ultimate-coverage":"wait-for-boss-coverage"):
      clusterMoving?"approach-larger-ultimate-cluster":clusterOffensive?"useful-tower-ultimate-cluster":
      offensive?"useful-current-native-target":usefulFast?"observed-fast-native-recharge":"wait-for-useful-native-window";
  return {press:!!press,reason,close,targetIndex:alive?targetIndex:null,
    rapidRecharge:{confirmed:fastCycle,seconds:fastCycle?elapsed:null,cycles},
    nextHistory:press?{lastPressAt:Number.isFinite(now)?now:null,nativeUsesAtPress:nativeUses,
      attempts:retryBatchExpired?1:attempts+1,
      retryBatch:sameAttempt?Math.min(1000000,(Number(history.retryBatch)||0)+(retryBatchExpired?1:0)):0,
      fastCycles:cycles}:history};
}

// Kept as a no-aim adapter for older read-only diagnostic callers. Legacy
// expert/manual options cannot restore removed camera or lock controls.
export function planExpertCombat(run, options = {}) {
  const ultimate=planUltimateCombat(run,options);
  return {enabled:ultimate.press,aim:null,fireWindows:[],ultimate,reason:"native-aim-untouched"};
}

export function chooseCombatMotion(state) {
  // Explicit active flight/orbit is a route preference, not invulnerability.
  // Native physics/hits remain untouched; only these movement risk inputs are
  // omitted. Static terrain, circles, route permissions and real forces stay.
  if(state.flight?.active===true)state={...state,enemies:[],bullets:[],hazards:[],cover:undefined,
    crowdEscape:null,bossRetreat:false};
  if(['character-practice','character-practice-landing'].includes(state.objective?.kind)){
    const ordinary=chooseMotion({...state,canDash:false,predictDash:false,predictJump:false});
    return {...ordinary,jump:false,jumpMove:false,action:'walk'};
  }
  const recovering = state.terrainRecovery?.active === true,
    hop = state.terrainHop?.active === true && state.terrainHop.direction && state.objective?.kind !== "altar",
    escape = state.crowdEscape?.active === true && state.crowdEscape.direction &&
      [state.crowdEscape.target?.x, state.crowdEscape.target?.z].every(Number.isFinite) && state.objective?.kind !== "altar";
  const baseline = escape ? { ...state, crowdEscape: null, committedDirection: null } : state;
  const ordinary = chooseMotion(recovering || hop ? { ...baseline, canDash: false } : baseline);
  const current = {
    ...ordinary,
    jump: false,
    jumpMove: false,
    action: ordinary.dash || state.player.slideT > 0 ? "slide" : "walk",
  };
  const flightChoice=flightMotionChoice(state,current);
  if(flightChoice)return flightChoice;
  if(state.travelCommitment?.active&&state.canJump===true&&state.nativeGroundJumpAllowed===true&&
      !hop&&!state.objective&&!(state.player.slideT>0)&&state.jumpVelocity>0){
    const jump=chooseMotion({...state,canDash:false,predictDash:false,predictJump:true});
    if(!jump.collision&&compareMotionSafety(jump,current)<0)
      return {...jump,jump:true,jumpMove:false,action:"travel-breakout-jump"};
  }
  if (escape && !(state.player.slideT > 0)) {
    const routeState = { ...state, target: state.crowdEscape.target,
      previous: state.crowdEscape.direction, committedDirection: state.crowdEscape.direction,
      canDash: recovering ? false : state.canDash },
      ground = chooseMotion(routeState);
    let choice = { ...ground, jump: false, jumpMove: false,
      action: ground.dash ? "slide" : "walk" };
    const impulse = state.jumpVelocity ?? state.player.jumpVelocity,
      legalJump = !recovering && state.canJump === true && Number.isFinite(impulse) && impulse > 0 &&
        (state.nativeGroundJumpAllowed === true || state.player.grounded === true ||
          state.player.jumpsLeft > 0 && tacticNumber(state.player.vy) <= 1);
    if (legalJump) {
      const airborne = chooseMotion({ ...routeState, predictJump: true, predictDash: false,
        canDash: false, jumpVelocity: impulse }),
        jump = { ...airborne, score: airborne.score + .75, dash: false, jump: true, jumpMove: false, action: "jump" };
      if (compareMotionSafety(jump, choice) < 0) choice = jump;
    }
    // The original objective remains owned by the pilot. This is one second of
    // repositioning through an observed lower-density side, never a boss/catch
    // cancellation or permission to cross a lethal shot, wall or arena border.
    if (!choice.collision && !choice.safety?.hardDanger && !choice.safety?.unknownDamage &&
        !choice.safety?.lethal && Math.hypot(choice.x || 0, choice.z || 0) > .1 &&
        compareMotionSafety({ ...choice, score: current.score, risk: current.risk }, current) <= 0)
      return { ...choice, crowdEscape: { reason: "bounded-native-crowd-unpin",
        attempts: state.crowdEscape.attempts, until: state.crowdEscape.until } };
  }
  if (hop && state.terrain && Number.isFinite(state.player.y) && !(state.player.slideT > 0)) {
    const direction = state.terrainHop.direction, impulse = state.jumpVelocity ?? state.player.jumpVelocity,
      support = traversalSupport(state, state.player.x, state.player.z, state.player.y),
      groundJumpAllowed = state.nativeGroundJumpAllowed ?? (state.player.grounded === true || support.waterJump),
      edge = (state.player.radius || .55) * .8,
      probe = Math.min(.6, (state.player.speed || 6.3) * Math.min(.05, state.player.frameDt || 1 / 60)) + edge,
      // A committed route must execute the real extra jump it forecasts. Use
      // only an actually remaining native jump, near the apex and still facing
      // a higher foot collision; clear airborne travel does not spend it.
      extraNeeded = state.player.grounded === false && state.player.jumpsLeft > 0 &&
        tacticNumber(state.player.vy) <= 1 &&
        state.terrain.height(state.player.x + direction.x * probe,
          state.player.z + direction.z * probe) > state.player.y + .6,
      jump = state.canJump === true && (groundJumpAllowed || extraNeeded) &&
        Number.isFinite(impulse) && impulse > 0,
      arc = traversalArc(state, direction, jump);
    if (arc && !arc.boundary) {
      const route = chooseMotion({ ...state, canDash: false, traversal: { direction, path: arc.path },
        walkable: (dx, dz, length, _time, feetY) => {
          const x = state.player.x + dx * length, z = state.player.z + dz * length;
          return traversalInBounds(state, x, z) && state.terrain.height(x, z) <= feetY + .6 &&
            !state.terrain.hitProp?.(x, feetY, z, state.player.radius || .55);
        } }), candidate = { ...route, dash: false, jump, jumpMove: false,
          action: jump ? "jump" : "walk", terrainHop: { reason: "committed-native-uphill-hops",
            attempts: state.terrainHop.attempts || 1 },
          traversal: { reason: "committed-native-uphill-hops", plannedJumps: arc.jumps } };
      // Commitment wins only among equivalent safe native routes. A lethal,
      // unknown or more damaging approach immediately yields to ordinary
      // evasion; stable input must never mean walking blindly into an attack.
      if (Math.hypot(candidate.x || 0, candidate.z || 0) > .9 &&
          compareMotionSafety({ ...candidate, score: current.score, risk: current.risk }, current) <= 0)
        return candidate;
    }
  }
  if (recovering && state.terrain && Number.isFinite(state.player.y)) {
    const angle = Math.atan2(state.target.z - state.player.z, state.target.x - state.player.x);
    let recovery = null;
    for (let index = 0; index < 16; index++) {
      const direction = { x: Math.cos(angle + index * Math.PI / 8), z: Math.sin(angle + index * Math.PI / 8) },
        arc = traversalArc({ ...state, canJump: false }, direction, false);
      if (!arc || arc.boundary) continue;
      // The path stops at native axis collisions. Keeping a nonzero *input*
      // there lets the original grounded stuck timer run; no blocked motion
      // is pretended to reach its requested destination.
      const choice = chooseMotion({ ...state, canDash: false,
        traversal: { path: arc.path, direction },
        walkable: (dx, dz, length, _time, feetY) => {
          const x = state.player.x + dx * length, z = state.player.z + dz * length;
          return traversalInBounds(state, x, z) && state.terrain.height(x, z) <= feetY + 0.6 &&
            !state.terrain.hitProp?.(x, feetY, z, state.player.radius || 0.55);
        } });
      if (!recovery || compareMotionSafety(choice, recovery) < 0) recovery = choice;
    }
    if (recovery && compareMotionSafety({ ...recovery, score: current.score, risk: current.risk }, current) <= 0)
      return { ...recovery, dash: false, jump: false, jumpMove: false, action: "walk",
        terrainRecovery: { reason: "allow-native-grounded-rescue", attempts: state.terrainRecovery.attempts || 1 } };
    return { ...current, terrainRecovery: { reason: "rescue-input-unsafe", attempts: state.terrainRecovery.attempts || 1 } };
  }
  const impulse = state.jumpVelocity ?? state.player.jumpVelocity;
  if (state.canJump !== true || !Number.isFinite(impulse) || impulse <= 0 ||
      !Number.isFinite(state.player.y) ||
      state.player.grounded === false && !Number.isFinite(state.player.height))
    return routineSlideChoice(state,current)||current;
  // The caller gates native play, interaction/throw windows and input cooldown.
  // Routine hopping never spends an airborne extra jump or cancels a slide.
  const jumpMove = state.jumpMoveAllowed === true && state.player.grounded === true &&
    !(state.player.slideT > 0) && state.objective?.kind !== "altar" &&
    Math.hypot(current.x || 0, current.z || 0) > .1;
  const traversal = planTerrainTraversal(state);
  if (traversal.kind === "jump") {
    const route = chooseMotion({ ...state, traversal, canDash: false,
      walkable: (dx, dz, length, _time, feetY) => {
        const x = state.player.x + dx * length, z = state.player.z + dz * length;
        return traversalInBounds(state, x, z) &&
          state.terrain.height(x, z) <= feetY + 0.6 &&
          !state.terrain.hitProp?.(x, feetY, z, state.player.radius || 0.55);
      } });
    const candidate = { ...route, score: route.score + 0.1, dash: false,
      jump: traversal.jump, action: traversal.jump ? "jump" : "walk", traversal: {
        reason: traversal.reason, rise: traversal.rise, plannedJumps: traversal.plannedJumps } };
    // Compare with the original destination so a vertical lift is not rewarded
    // solely because the local landing target happens to be closer.
    if (compareMotionSafety(candidate, current) < 0) return candidate;
  }
  // Required traversal and the finite recovery branches above precede this
  // preference. Routine hopping can never starve a legal ground slide.
  const preferredSlide=routineSlideChoice(state,current);
  if(preferredSlide)return preferredSlide;
  // A fully examined, unobstructed route with no predicted contact already
  // wins the safety comparison. Avoid a second complete threat scan merely to
  // spend a jump on an otherwise equivalent safe trip.
  if (!jumpMove && !ordinary.collision && !ordinary.danger && ordinary.safety &&
      ordinary.safety.hitCount === 0 && !ordinary.safety.unknownDamage &&
      ordinary.safety.healthDamage === 0)
    return current;

  const airborne = chooseMotion({
    ...state,
    predictDash: false,
    predictJump: true,
    jumpVelocity: impulse,
    canDash: false,
  });
  const jumping = {
    ...airborne,
    // Keep an equivalent safe grounded route instead of spending an air action
    // for an insignificant progress or floating-point score difference. Safety
    // categories and actual expected damage still precede this small cost.
    score: airborne.score + 0.75,
    dash: false,
    jump: true,
    jumpMove: false,
    action: "jump",
  };
  // A movement preference may choose an equally safe native jump in an open
  // route. It cannot trade a known zero-hit route for an unknown/real hit,
  // reduced escape room, geometry collision or a higher immediate risk.
  const zeroHit = choice => !choice.collision && choice.safety &&
    !choice.safety.hardDanger && !choice.safety.unknownDamage &&
    choice.safety.hitCount === 0 && choice.safety.healthDamage === 0;
  if (jumpMove && Math.hypot(jumping.x || 0, jumping.z || 0) > .1 &&
      zeroHit(current) && zeroHit(jumping) && jumping.risk <= current.risk + .25 &&
      jumping.escapeRoutes >= current.escapeRoutes)
    return { ...jumping, jumpMove: true };
  return compareMotionSafety(jumping, current) < 0 ? jumping : current;
}

// Public 0.8.1 L_/R_/Kb/vx/Tx fields. This adapter reads current native
// attacks only; no native method, timer, RNG, renderer or account API is run.
// Tracking attacks are deliberately not presented as locked future positions.
export function riftPulseHazards(run) {
  const inside=run?.rifts?.inside,player=run?.player;
  if(!inside||!player?.pos)return [];
  const terrain=run.terrain;
  const floor=terrain?.height?.(player.pos.x,player.pos.z);
  if(!Number.isFinite(floor))return [];
  const hazards=[];
  for(const pulse of inside.pulses||[]){
    if(pulse.hit||![pulse.x,pulse.z,pulse.t,pulse.life,pulse.R].every(Number.isFinite)||
        !(pulse.life>0)||!(pulse.R>0)||pulse.t<0||pulse.t>=pulse.life)continue;
    hazards.push({shape:'ring',owner:'enemy',source:'rift-alpha-pulse',x:pulse.x,z:pulse.z,y:floor,
      radius:pulse.R*pulse.t/pulse.life,radialSpeed:pulse.R/pulse.life,
      thickness:1.1,maxRadius:pulse.R,maxHeight:.8,maxHeightInclusive:true,
      floorAt:(x,z)=>terrain.height(x,z),
      life:pulse.life-pulse.t,oneShot:true,
      damage:Number.isFinite(pulse.dmg)&&Number.isFinite(run.diff?.enemyDamage)?pulse.dmg*run.diff.enemyDamage:null});
  }
  return hazards;
}

export function legendaryArenaHazards(run, observed = {}) {
  const hazards = [], limitations = [], boss = run?.boss, kit = boss?.kit,
    en = run?.enemies, player = run?.player, index = boss?.bossIndex,
    species = en?.species?.[index] ?? kit?.species, arena = run?.sanctuary,
    finite = (...values) => values.every(Number.isFinite), now = run?.time;
  if (!boss?.alive || !kit || kit.dead || !player?.pos || ![144, 145].includes(species))
    return { hazards, force: null, limitations };
  const height = (x, z) => {
    const value = run.terrain?.height?.(x, z);
    return Number.isFinite(value) ? value : undefined;
  }, floor = height(player.pos.x, player.pos.z), hp = player.maxHp,
    kitDamage = finite(hp) && hp > 0 ? hp * .34 : null,
    capDamage = ratio => finite(hp) && hp > 0 ? hp * ratio : null,
    add = hazard => { if (hazards.length < 128) hazards.push({ owner: "enemy", ...hazard }); },
    scope = warning => warning && warning.run === run && warning.kit === kit &&
      warning.index === index && Number.isInteger(warning.gen) && warning.gen === en?.gen?.[index] &&
      finite(now, warning.impact, warning.until) && warning.until >= now && warning.impact >= now,
    rods = radius => (arena?.rods || []).filter(rod => rod.active && finite(rod.x, rod.z))
      .map(rod => ({ x: rod.x, z: rod.z, radius }));

  // Kb.update hurts outside ringR-.8 every .5s and pulls inward, independent
  // of jump height. During shrinking, use the smallest known radius in the
  // short horizon: conservative, rather than claiming the wall is stationary.
  if (arena && arena.phase !== 4 && arena.ringT >= 0 && finite(arena.ringR) && arena.ringR > .8) {
    let radius = arena.ringR - .8;
    if (arena.ringT < 1 && finite(arena.ringFrom, arena.ringEnd)) {
      const t = Math.min(1, arena.ringT + 1.2 / 9), smooth = t * t * (3 - 2 * t);
      radius = Math.min(radius, arena.ringFrom + (arena.ringEnd - arena.ringFrom) * smooth - .8);
    }
    add({ shape: "outside-circle", x: 0, z: 0, radius: Math.max(.1, radius),
      persistent: true, life: 1.2, damage: null, source: "legendary-arena-boundary" });
  }

  if (species === 145) {
    const drill = kit.drill;
    if (drill && finite(drill.x, drill.z, drill.t, drill.lock)) {
      if (drill.t <= 0 && drill.lock >= 0) add({ x: drill.x, z: drill.z,
        y: height(drill.x, drill.z), radius: 3.2, maxHeight: 1.6,
        eta: drill.lock, life: drill.lock + .05, oneShot: true,
        damage: kitDamage, source: "zapdos-drill-locked" });
      else if (drill.t > 0) limitations.push("zapdos-drill-still-tracking");
    }
    for (const ring of (kit.rings || []).slice(0, 16)) {
      if (ring.hit || !finite(ring.x, ring.z, ring.r, ring.gap) || ring.r >= 30) continue;
      const speed = ring.gap < -9 ? 14 : 8;
      add({ shape: "ring", x: ring.x, z: ring.z, y: floor,
        radius: ring.r, radialSpeed: speed, thickness: .5, maxRadius: 30,
        maxHeight: 1.3, life: (30 - ring.r) / speed, damage: kitDamage,
        ...(ring.gap < -9 ? {} : { safeGapAngle: ring.gap, safeGapHalfAngle: .36 }),
        source: "zapdos-thunder-wave" });
    }
    // An orb's next destination depends on the candidate player's path. The
    // envelope contains all of its possible 5.2m/s movement in this horizon,
    // including the 4.5m explosion; it is not a claim of immediate damage.
    for (const orb of (kit.orbs || []).slice(0, 4)) {
      if (!finite(orb.x, orb.z, orb.t) || orb.t <= 0) continue;
      if (rods(3).some(rod => Math.hypot(rod.x - orb.x, rod.z - orb.z) < rod.radius)) continue;
      const horizon = Math.min(1.2, orb.t);
      add({ x: orb.x, z: orb.z, y: floor, radius: 4.5 + 5.2 * horizon,
        maxHeight: 2.2, persistent: true, life: horizon, damage: kitDamage,
        source: "zapdos-orb-motion-envelope", conservativeEnvelope: true });
    }
    if (kit.markT > 0) for (const mark of (kit.marked || []).slice(0, 6)) {
      const j = mark.j;
      if (en.gen?.[j] !== mark.g || !en.alive?.[j] || !finite(en.x?.[j], en.z?.[j])) continue;
      // Native marked bodies may move before detonation; expand by their
      // bounded current native movement speed, then re-read every decision.
      const speed = Number(en.speed?.[j]);
      if (!Number.isFinite(speed) || speed < 0) {
        limitations.push("zapdos-chain-marker-speed-unavailable"); continue;
      }
      add({ x: en.x[j], z: en.z[j], radius: 5 + speed * kit.markT,
        eta: kit.markT, life: kit.markT + .05, oneShot: true,
        damage: kitDamage, source: "zapdos-chain-motion-envelope", conservativeEnvelope: true });
    }
    if (scope(observed.zapdosUltimate)) {
      const warning = observed.zapdosUltimate, eta = warning.impact - now,
        safeCircles = rods(4.5);
      // The eye turns randomly; only the disk remaining safe under every
      // bounded 2.4m/s displacement is guaranteed over the short horizon.
      if (arena?.eye?.on && finite(arena.eye.x, arena.eye.z, arena.eye.r)) {
        const radius = arena.eye.r - 2.4 * eta;
        if (radius > 0) safeCircles.push({ x: arena.eye.x, z: arena.eye.z, radius });
      }
      if (arena) add({ shape: "outside-circle", safeCircles, x: 0, z: 0, radius: 0,
        eta, life: eta + .05, oneShot: true, damage: capDamage(.6), source: "zapdos-ultimate" });
      else if (finite(kit.hx, kit.hz)) add({ x: kit.hx, z: kit.hz, radius: 26,
        eta, life: eta + .05, oneShot: true, damage: capDamage(.6), source: "zapdos-ultimate-no-arena" });
    }
    // dry() uses future feet height AND the terrain under that future point.
    // A flat damage circle would invent hits on safe plateaus. Keep this
    // limitation explicit until a terrain-aware shape is supported.
    if (scope(observed.zapdosSea) || arena?.charge > 0 && arena.charge < 1)
      limitations.push("zapdos-electric-sea-needs-terrain-aware-dry-predicate");
    if (kit.reticle) limitations.push("zapdos-reticle-waits-for-native-bolt-warning");
    return { hazards, force: null, limitations };
  }

  const beam = kit.beam;
  if (beam && !beam.hit && finite(beam.t, beam.lock, beam.fire) && beam.fire > 0) {
    if (beam.t <= 0) {
      const eta = Math.max(0, beam.lock), points = (beam.path || []).slice(0, 5);
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        if (!finite(a.x, a.z, b.x, b.z)) continue;
        add({ x: a.x, z: a.z, x2: b.x, z2: b.z, y: floor, radius: 1,
          maxHeight: 1.8, eta, life: eta + beam.fire, persistent: true,
          damage: kitDamage, singleHit: true, source: "articuno-locked-beam" });
      }
    } else limitations.push("articuno-beam-still-tracking");
  }
  if (arena?.phase < 4 && finite(arena.floorY)) {
    for (const spot of (arena.spots || []).slice(0, 16)) {
      if (!spot.hole || !finite(spot.x, spot.z, spot.r, spot.open, spot.t) || spot.t <= 0) continue;
      const radius = spot.r * Math.min(1, spot.open + 1.2 * 3) * .85;
      if (radius <= 0 || player.ability === "magic-guard") continue;
      add({ x: spot.x, z: spot.z, y: floor, radius, maxHeight: .4,
        eta: Math.max(0, (.5 - spot.open) / 3), life: Math.min(1.2, spot.t),
        persistent: true, damage: null, source: "articuno-ice-hole",
        conservativeEnvelope: true });
    }
    for (const crystal of (arena.crystals || []).slice(0, 16)) {
      if (!crystal.o || crystal.hit || !(crystal.ring > 0) || crystal.ring >= 8 ||
          !finite(crystal.x, crystal.z, crystal.ring)) continue;
      const j = crystal.o.j;
      if (en.gen?.[j] !== crystal.o.g || !en.alive?.[j]) continue;
      add({ shape: "ring", x: crystal.x, z: crystal.z, y: floor,
        radius: crystal.ring, radialSpeed: 8, thickness: .5,
        maxRadius: 8, life: (8 - crystal.ring) / 8, maxHeight: .4,
        damage: capDamage(.15), source: "articuno-crystal-ring" });
    }
    const uniforms = arena.sectorMat?.uniforms, on = uniforms?.uOn?.value,
      progress = uniforms?.uK?.value, burst = uniforms?.uBurst?.value,
      safe = uniforms?.uSafe?.value;
    if (on === 1 && burst === 0 && finite(progress) && progress >= 0 && progress < 1 &&
        safe?.length === 9 && Array.from(safe).every(value => value === 0 || value === 1)) {
      const safeSectors = Array.from(safe, (value, i) => value ? i : -1).filter(i => i >= 0);
      if (safeSectors.length === 3) {
        const eta = 1.5 * (1 - progress);
        add({ shape: "unsafe-sectors", x: 0, z: 0, innerRadius: 8,
          sectorCount: 8, safeSectors, eta, life: eta + .05,
          oneShot: true, damage: capDamage(.6), source: "articuno-absolute-zero" });
      }
    }
  }
  let force = null;
  if (arena?.phase >= 2 && arena.phase < 4 && finite(arena.windA, arena.windT) && arena.windT > 0)
    force = { x: Math.cos(arena.windA) * 16, z: Math.sin(arena.windA) * 16,
      duration: Math.min(1.2, arena.windT) };
  if (arena?.frost > .6) limitations.push("articuno-frost-requires-continued-native-speed");
  return { hazards, force, limitations };
}

// Some enemy-owned VFX depict safety, healing or an already-adapted attack.
// Require the actual synchronous native owner as well as its exact signature;
// matching a coordinate/color alone must never erase another enemy's attack.
export function isLegendaryVisualWarning(run, kind, args, ownerSource) {
  const boss = run?.boss, kit = boss?.kit || boss?.mech, arena = run?.sanctuary, en = run?.enemies,
    index = boss?.bossIndex, species = en?.species?.[index] ?? kit?.species,
    close = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-6,
    bossOwned = ownerSource === boss || ownerSource === kit,
    arenaOwned = !!arena && ownerSource === arena;
  if (!boss?.alive || !kit || kit.dead || kit.disposed || !Array.isArray(args) || (!bossOwned && !arenaOwned)) return false;
  if(species===105&&bossOwned&&kind==="telegraph"&&Array.isArray(kit.waves)) {
    const [x,y,z,radius,color,duration]=args,floor=run.terrain?.height?.(kit.bx,kit.bz);
    if(radius===3.5&&color===12577023&&duration===.5&&close(x,kit.bx)&&close(z,kit.bz)&&close(y,floor))
      return "marowak-wail-ring-delegated";
  }
  if (species === 145 && kind === "telegraph") {
    const [x, y, z, radius, color] = args;
    if (radius === 2 && color === 16769594 && (arena?.rods || []).some(rod =>
      rod.active && close(x, rod.x) && close(y, rod.y) && close(z, rod.z)))
      return "zapdos-active-rod-safe-warning";
  }
  if(species===250&&bossOwned&&kind==='telegraph'){
    const [x,y,z,radius,color,duration]=args;
    if(radius===2.2&&duration===.9&&(kit.pillars||[]).some(row=>!row.hit&&row.rise>0&&
        close(row.x,x)&&close(row.z,z)&&row.col===color&&close(kit.groundY(x,z),y)))return 'ho-oh-native-pillar-delegated';
  }
  if (species !== 144) return false;
  if (kind === "beam") {
    const [x, y, z, x2, y2, z2, width, color, life] = args;
    if (bossOwned && life === .06 && (width === 1.8 && color === 9103615 || width === .6 && color === 16777215)) {
      const beam = kit.beam, path = beam?.path;
      if (beam && beam.t <= 0 && beam.lock <= 0 && beam.fire > 0 && Array.isArray(path))
        for (let i = 1; i < Math.min(path.length, 5); i++) {
          const a = path[i - 1], b = path[i],
            startY = i === 1 ? en.y?.[index] + 1.2 : run.terrain?.height?.(a.x, a.z) + 1.2,
            endY = run.terrain?.height?.(b.x, b.z) + 1.2;
          if (close(x, a.x) && close(z, a.z) && close(x2, b.x) && close(z2, b.z) &&
              close(y, startY) && close(y2, endY)) return "articuno-native-beam-delegated";
        }
    }
    if (arenaOwned && width === .35 && color === 9103615 && life === .06 &&
        close(x2, en.x?.[index]) && close(y2, en.y?.[index] + 1.5) && close(z2, en.z?.[index]) &&
        close(y, arena.floorY + 3) && (arena.crystals || []).some(crystal =>
          crystal.o && en.gen?.[crystal.o.j] === crystal.o.g && en.alive?.[crystal.o.j] &&
          !(en.dying?.[crystal.o.j] > 0) && close(x, crystal.x) && close(z, crystal.z)))
      return "articuno-crystal-decoration";
  }
  if (arenaOwned && kind === "telegraph") {
    const [x, y, z, radius, color, duration] = args;
    if (radius === 2 && color === 9103615 && duration === .5 && close(y, arena.floorY) &&
        (arena.crystals || []).some(crystal => crystal.o && !crystal.hit && close(crystal.ring, 1.4) &&
          en.gen?.[crystal.o.j] === crystal.o.g && en.alive?.[crystal.o.j] &&
          close(x, crystal.x) && close(z, crystal.z)))
      return "articuno-crystal-ring-delegated";
  }
  return false;
}

// Read active native event objects; main-map fields remain present in a rift stash.
// Percentages are native hurt inputs, not final HP loss: affinity/armor/abilities/relics
// still modify them. Keep final damage unknown rather than authorize a false health budget.
export function newMapEventHazards(run) {
  if(run?.rifts?.inside||run?.sanctuary||!run?.player)return [];
  const hazards=[],hp=run.player.maxHp;
  const add=(row,source,maxHeight,percent,persistent=false)=>{
    if(![row.x,row.y,row.z,row.r,row.t].every(Number.isFinite)||row.t<=0||row.r<=0)return;
    hazards.push({x:row.x,y:row.y,z:row.z,radius:row.r,owner:'enemy',source,maxHeight,
      eta:persistent?0:row.t,life:persistent?row.t:row.t+.25,
      oneShot:!persistent,persistent,rawDamage:Number.isFinite(hp)?hp*percent:null,damage:null});
  };
  if(run.biome?.id==='canela'){
    if(typeof run.terrain?.lavaAt==='function'&&typeof run.terrain?.height==='function'&&!(run.player.types||[]).includes('fire')&&run.player.ability!=='magic-guard')
      hazards.push({shape:'terrain-region',source:'canela-ground-lava',owner:'enemy',
        containsPoint:(x,z)=>run.terrain.lavaAt(x,z)>.9,floorAt:(x,z)=>run.terrain.height(x,z),
        maxHeight:.4,eta:Math.max(0,run.canela?.lavaHurtT||0),life:1.2,persistent:true,rawDamage:hp*.06,damage:null});
    for(const row of run.canela?.bombs||[])add(row,'canela-eruption-bomb',2,.1);
    if(run.player.ability!=='magic-guard')for(const row of run.canela?.pools||[])add(row,'canela-eruption-pool',1,.03,true);
  }
  if(run.biome?.id==='cave')for(const row of run.cave?.rocks||[])add(row,'cave-collapse-rock',2.4,.1);
  if(run.biome?.id==='iris')for(const pass of run.iris?.passes||[]){
    if(![pass.x0,pass.z0,pass.x1,pass.z1,pass.t].every(Number.isFinite)||pass.t>1.6)continue;
    for(let index=0;index<=16;index++){
      const fraction=index/16,x=pass.x0+(pass.x1-pass.x0)*fraction,z=pass.z0+(pass.z1-pass.z0)*fraction,
        eta=pass.t+fraction*.5;
      if(eta<0||!run.terrain?.inBounds?.(x,z,2))continue;
      add({x,z,y:run.terrain.height(x,z),r:2.4,t:Math.max(1e-6,eta)},'iris-ho-oh-flight',2.2,.1);
    }
  }

  return hazards;
}

export function isMapEventVisualWarning(run,kind,args,owner) {
  if(kind!=='telegraph'||!owner||!Array.isArray(args))return false;
  const color=args[4],duration=args[5];
  return owner===run.canela&&color===16734746&&duration===1.5 ||
    owner===run.cave&&color===11569919&&duration===1.4 ||
    owner===run.iris&&color===16747050&&duration===1.6;
}

// Geometry comes from the actual native closures, never a re-roll or callback replay.
function hoOhNativeContext(run) {
  const boss=run?.boss,kit=boss?.kit||boss?.mech,en=run?.enemies,index=boss?.bossIndex,now=run?.time;
  if(!boss?.alive||!kit||kit.dead||kit.disposed||en?.species?.[index]!==250||!en.alive?.[index]||
      en.dying?.[index]>0||kit.i!==index||kit.run!==run||!Number.isFinite(now)||
      Number.isInteger(boss.bossGen)&&boss.bossGen!==en.gen?.[index])return null;
  return {boss,kit,en,index,now};
}
export function hoOhObservedHazards(run,frameDt=1/60) {
  const context=hoOhNativeContext(run);if(!context)return [];
  const {boss,kit,en,index,now}=context;
  const frame=Number.isFinite(frameDt)&&frameDt>0?Math.min(.05,frameDt):1/60,
    align=delay=>Math.max(0,Math.ceil(delay/frame))*frame,
    hazards=[],playerFloorAt=(x,z)=>run.terrain?.height?.(x,z),low=(y,floor,height)=>
    !Number.isFinite(y)||!Number.isFinite(floor)||y-floor<height;
  const gust=kit.gust;
  if(gust&&[gust.t,gust.dx,gust.dz,kit.bx,kit.bz].every(Number.isFinite)&&gust.t>0)
    hazards.push({shape:'terrain-region',source:'ho-oh-hurricane',owner:'enemy',damage:gust.hit?0:null,
      persistent:true,life:gust.t,displacementHazard:true,containsPoint:(x,z,time)=>{
        const dx=x-kit.bx,dz=z-kit.bz,d=Math.hypot(dx,dz)||1;
        return time<=gust.t&&d<23&&(dx*gust.dx+dz*gust.dz)/d>Math.cos(.6);
      }});
  for(const pillar of kit.pillars||[]){
    if(pillar.hit||![pillar.x,pillar.z,pillar.t,pillar.rise].every(Number.isFinite)||pillar.t<=0)continue;
    const rise=Math.max(0,pillar.rise),speed=5.2+kit.phase*.5;
    // Like the existing Zapdos orb envelope, this bounds all candidate-dependent
    // homing positions. Unknown future support height cannot certify a jump clear.
    hazards.push({shape:'terrain-region',source:'ho-oh-sacred-fire-pillar',owner:'enemy',damage:null,
      persistent:true,eta:rise,life:rise+pillar.t,conservativeEnvelope:true,nativeMaxHeight:3,
      containsPoint:(x,z,time)=>time>=rise&&time<=rise+pillar.t&&
        Math.hypot(x-pillar.x,z-pillar.z)<2.1+speed*Math.max(0,time-rise)});
  }
  for(const wave of kit.waves||[]){
    if(wave.hit||![wave.x,wave.z,wave.r,wave.speed,wave.max].every(Number.isFinite)||wave.speed<=0||wave.r>=wave.max)continue;
    hazards.push({shape:'ring',source:'ho-oh-extrasensory-wave',owner:'enemy',damage:null,
      x:wave.x,z:wave.z,y:kit.groundY(wave.x,wave.z),radius:wave.r,radialSpeed:wave.speed,
      maxRadius:wave.max,thickness:.9,maxHeight:1.2,floorAt:(x,z)=>kit.groundY(x,z),playerFloorAt,
      life:(wave.max-wave.r)/wave.speed,oneShot:true});
  }
  for(const attack of kit.__pbBossAttacks||[]){
    if(attack.run!==run||attack.kit!==kit||attack.index!==index||attack.generation!==en.gen?.[index]||
        !Number.isFinite(attack.until)||attack.until<=now)continue;
    if(attack.kind==='gust-windup'&&typeof attack.isTriggered==='function'&&!attack.isTriggered()&&
        !(kit.down>0)&&Number.isFinite(attack.angle)&&Number.isFinite(attack.activation)){
      // Start one simulation frame early: pending timers can fall between frames.
      // This is a warning envelope, never permission to spend an exact HP budget.
      const lead=Math.max(0,attack.activation-now-frame),dx=Math.cos(attack.angle),dz=Math.sin(attack.angle);
      hazards.push({shape:'terrain-region',source:'ho-oh-hurricane-windup',owner:'enemy',damage:null,
        persistent:true,eta:lead,life:attack.until-now,conservativeEnvelope:true,containsPoint:(x,z,time)=>{
          if(attack.isTriggered()||time<lead||now+time>attack.until)return false;
          const x0=x-kit.bx,z0=z-kit.bz,d=Math.hypot(x0,z0)||1;
          return d<23&&(x0*dx+z0*dz)/d>Math.cos(.6);
        }});
    }
    if(attack.kind==='rainbow')for(const row of attack.rows||[]){
      if(row.hit||row.front>=48||![row.normalX,row.normalZ,row.gap,row.front,row.speed,row.begin,row.until].every(Number.isFinite)||row.until<=now)continue;
      hazards.push({shape:'terrain-region',source:'ho-oh-rainbow-wall',owner:'enemy',damage:null,persistent:true,
        eta:Math.max(0,row.begin-now),life:row.until-now,playerFloorAt,
        containsPoint:(x,z,time,y)=>{
          if(row.hit||now+time<row.begin||now+time>row.until)return false;
          const delay=align(row.begin-now),unstarted=row.front===-48,
            front=row.front+row.speed*(unstarted?Math.max(0,time-delay+frame):time),
            along=x*row.normalX+z*row.normalZ,across=-x*row.normalZ+z*row.normalX;
          return Math.abs(along-front)<1&&Math.abs(across-row.gap)>2.2&&low(y,row.groundAt(x,z),1.3);
        }});
    }
    if(attack.kind==='spiral'&&typeof attack.isDone==='function'&&!attack.isDone()&&
        ['pointAt','cutoffAt','hitAt','groundAt','getProgress','getWindupProgress','isActive'].every(k=>typeof attack[k]==='function')){
      hazards.push({shape:'terrain-region',source:'ho-oh-rainbow-spiral',owner:'enemy',damage:null,persistent:true,
        eta:Math.max(0,attack.activation-now),life:attack.until-now,playerFloorAt,
        containsPoint:(x,z,time,y)=>{
          if(attack.isDone()||now+time>attack.until)return false;
          const active=attack.isActive(),delay=active?0:align(2*(1-attack.getWindupProgress()));
          if(!active&&time<=delay)return false;
          const progress=(active?attack.getProgress():0)+Math.max(0,time-delay)/attack.duration;
          if(progress<0||progress>1)return false;
          for(let arm=0;arm<7;arm++){
            if(attack.hitAt(arm)||progress>attack.cutoffAt(arm))continue;
            const center=attack.pointAt(arm,progress);
            if((x-center.x)**2+(z-center.z)**2<2.8**2&&low(y,attack.groundAt(center.x,center.z),3.4))return true;
          }
          return false;
        }});
    }
  }
  return hazards;
}

export function hoOhObservedForces(run,frameDt=1/60) {
 const context=hoOhNativeContext(run);if(!context)return [];
 const {kit}=context,gust=kit.gust;
 if(!gust||![gust.dx,gust.dz,gust.t,kit.bx,kit.bz].every(Number.isFinite)||gust.t<=0)return [];
 return [{radial:true,constantDirection:true,originX:kit.bx,originZ:kit.bz,
   angle:Math.atan2(gust.dz,gust.dx),halfAngle:.6,range:23,strength:34,duration:gust.t,
   // Native boss.tick adds the impulse after this frame's Player.update.
   delay:Number.isFinite(frameDt)&&frameDt>0?Math.min(.05,frameDt):1/60}];
}

// Actual Ilex arena factory HP. Its time portal is entered by proximity;
// the flower clock is an ordinary native Object enemy in the past epoch.
export function celebiMechanicTarget(run) {
  const boss=run?.boss,kit=boss?.kit,en=run?.enemies,index=boss?.bossIndex;
  if(run?.biome?.sanctuary?.arena!=='ilex'||!boss?.alive||!kit||kit.run!==run||kit.i!==index||
      kit.dead||kit.disposed||en?.species?.[index]!==251||!en.alive?.[index]||en.dying?.[index]>0||
      en.gen?.[index]!==boss.bossGen||kit.down>0||typeof run.sanctuary?.setEpoch!=='function')return null;
  if(run.sanctuary.epoch==='past'){
    const clock=kit.clock,j=clock?.j;
    if(!Number.isInteger(j)||en.gen[j]!==clock.g||!en.alive[j]||en.dying[j]>0)return null;
    return {x:en.x[j],z:en.z[j],radius:.6,id:clock,enemyIndex:j,moving:true,
      celebiPhase:'clock',label:'击破花钟'};
  }
  const rift=kit.rift;
  return rift?.t>0&&Number.isFinite(rift.x)&&Number.isFinite(rift.z)?
    {x:rift.x,z:rift.z,radius:1,id:rift,celebiPhase:'rift',label:'穿过时空裂隙'}:null;
}

export function celebiArenaHazards(run,frameDt=1/60) {
  const boss=run?.boss,kit=boss?.kit,en=run?.enemies,i=boss?.bossIndex,S=run?.sanctuary;
  if(run?.biome?.sanctuary?.arena!=='ilex'||!boss?.alive||kit?.run!==run||kit.i!==i||kit.dead||
      en?.species?.[i]!==251||!en.alive?.[i]||en.dying?.[i]>0||en.gen?.[i]!==boss.bossGen)return [];
  const hazards=[],playerFloorAt=(x,z)=>run.terrain.surface?.(x,z)??run.terrain.height(x,z);
  for(const drain of kit.drains||[])if(drain.t>0){
    const x=drain.real?kit.bx:drain.x,z=drain.real?kit.bz:drain.z;
    hazards.push({shape:'terrain-region',source:'celebi-giga-drain',owner:'enemy',damage:null,
      persistent:true,eta:Math.max(0,drain.hitT),life:drain.t,playerFloorAt,
      conservativeEnvelope:!!drain.real,containsPoint:(px,pz,time)=>time<=drain.t&&
        Math.hypot(px-x,pz-z)<9+(drain.real?5.6*time:0)});
  }
  const ult=kit.ult,clock=S?.clock;
  if(ult&&clock){
    const frame=Number.isFinite(frameDt)&&frameDt>0?Math.min(.05,frameDt):1/60;
    hazards.push({shape:'terrain-region',source:'celebi-forest-clock',owner:'enemy',damage:null,
      persistent:true,eta:Math.max(0,2.1-ult.t),life:Math.max(0,7.7-ult.t),playerFloorAt,
      containsPoint:(x,z,time,y)=>{
        const elapsed=ult.t+time;
        if(elapsed<2.1||elapsed>=7.7||Math.hypot(x,z)<4||
            !(y-kit.groundY(x,z)<1.3))return false;
        const active=ult.t>=2.1?time:Math.min(time,Math.max(0,time-(2.1-ult.t))+frame);
        for(const [angle,width,cooldown]of [[clock.hour-ult.dir*.42*active,2.4,ult.hitH],
          [clock.minute+ult.dir*1.25*active,1.4,ult.hitM]]){
          if(cooldown>time)continue;
          const nx=Math.cos(angle),nz=Math.sin(angle);
          if(x*nx+z*nz>=0&&Math.abs(x*nz-z*nx)<=width+run.player.radius&&
              !S.blocked(0,kit.groundY(0,0)+1,0,x,y+.9,z))return true;
        }
        return false;
      }});
  }
  return hazards;
}

function season3ArenaContext(run,species,arena) {
  const b=run?.boss,k=b?.kit,e=run?.enemies,i=b?.bossIndex;
  return run?.biome?.sanctuary?.arena===arena&&b?.alive&&k?.run===run&&k.i===i&&!k.dead&&
    !k.disposed&&e?.species?.[i]===species&&e.alive?.[i]&&!e.dying?.[i]&&e.gen?.[i]===b.bossGen?k:null;
}
export function mewtwoMechanicTarget(run) {
  const kit=season3ArenaContext(run,150,'cave');if(!kit)return null;
  const en=run.enemies,live=o=>o&&en.gen[o.j]===o.g&&en.alive[o.j]&&!(en.dying[o.j]>0),
    pylons=run.sanctuary?.shield?.on?(run.sanctuary.pylons||[]).map(p=>p.o).filter(live):[],
    candidates=pylons.length?pylons:(kit.clones||[]).filter(live);
  candidates.sort((a,b)=>tacticDistance(run.player.pos,{x:en.x[a.j],z:en.z[a.j]})-
    tacticDistance(run.player.pos,{x:en.x[b.j],z:en.z[b.j]}));
  const o=candidates[0];return o?{x:en.x[o.j],z:en.z[o.j],radius:2,id:o,enemyIndex:o.j,
    moving:true,mewtwoObjective:true,pylonObjective:pylons.length>0,label:pylons.length?'击破护盾水晶':'击破分身'}:null;
}

export function mewtwoBallDeflectReady(run,frameDt=1/60) {
  const ball=season3ArenaContext(run,150,'cave')?.ball,p=run?.player;
  return !!(ball?.st==='toPlayer'&&p?.grounded&&!p.dead&&p.slideCd<=0&&
    Math.abs(p.pos.y+1-ball.y)<2.6&&Math.hypot(p.pos.x-ball.x,p.pos.z-ball.z)<3.4+ball.speed*frameDt);
}
export function mewtwoBallGroundWindow(run) {
  const ball=season3ArenaContext(run,150,'cave')?.ball,p=run?.player;
  return !!(ball?.st==='toPlayer'&&p?.grounded&&
    Math.hypot(p.pos.x-ball.x,p.pos.z-ball.z)<6.5);
}

// starArms and firstBlock are deterministic native geometry queries. Observe
// parameters of the attack already invoked, without replaying its animation.
export function charizardStarWarning(kit,angle,windup) {
  if(!Number.isFinite(angle)||!Number.isFinite(windup))return null;
  const x=kit.hx,z=kit.hz,y=kit.groundY(x,z)+1,S=kit.S;
  const segments=kit.starArms(angle).map(a=>{
    const nx=Math.cos(a.a),nz=Math.sin(a.a),sx=x+nx*3.6,sz=z+nz*3.6,
      f=S?S.firstBlock(sx,y,sz,x+nx*a.len,y,z+nz*a.len):1;
    return {x:sx,z:sz,nx,nz,reach:(a.len-3.6)*f};
  });
  return {impact:kit.run.time+windup,until:kit.run.time+windup+.1,segments};
}

export function season3ArenaHazards(run,observation={},frameDt=1/60) {
  const dragon=season3ArenaContext(run,6,'volcano'),psychic=season3ArenaContext(run,150,'cave'),
    kit=dragon||psychic,S=run?.sanctuary;
  if(!kit||!S)return [];
  const out=[],ground=(x,z)=>run.terrain.height(x,z),floor=(x,z)=>run.terrain.surface?.(x,z)??ground(x,z),
    low=(x,z,y,h)=>y-ground(x,z)<h,immune=run.player.ability==='magic-guard',
    add=(source,eta,life,containsPoint,extra={})=>out.push({shape:'terrain-region',owner:'enemy',source,
      damage:null,persistent:true,eta:Math.max(0,eta),life:Math.max(.01,life),playerFloorAt:floor,containsPoint,...extra});
  if(dragon){
    const dive=kit.dive;
    if(dive)add('charizard-sky-dive',Math.max(0,dive.t)+dive.lock,Math.max(0,dive.t)+dive.lock+.1,
      (x,z,t,y)=>t>=Math.max(0,dive.t)+dive.lock&&Math.hypot(x-dive.x,z-dive.z)<3.3+
        (dive.t>0?9.5*Math.min(t,dive.t):0)&&y-kit.groundY(dive.x,dive.z)<1.6,
      {conservativeEnvelope:dive.t>0});
    if(!immune)for(const pool of kit.pools||[])if(pool.t>0)add('charizard-lava-pool',Math.max(0,kit.poolHurtT),pool.t,
      (x,z,t,y)=>t<=pool.t&&Math.hypot(x-pool.x,z-pool.z)<pool.r&&y-pool.y<1);
    for(const twister of kit.twisters||[])if(twister.t>0)add('charizard-fire-tornado',Math.max(0,twister.hitT),twister.t,
      (x,z,t,y)=>t<=twister.t&&Math.hypot(x-twister.x,z-twister.z)<2.3+2.8*t&&low(x,z,y,4.5),
      {conservativeEnvelope:true});
    if(observation.kit===kit)for(const star of observation.starSlams||[])if(star.until>run.time)
      add('charizard-star-slam',star.impact-run.time,star.until-run.time,(x,z,t,y)=>{
        if(run.time+t<star.impact||run.time+t>star.until||!low(x,z,y,3.4))return false;
        return star.segments.some(s=>{const u=tacticClamp((x-s.x)*s.nx+(z-s.z)*s.nz,0,s.reach);
          return Math.hypot(s.x+s.nx*u-x,s.z+s.nz*u-z)<2.4+run.player.radius*.5;});
      });
    if(!immune){
      if(!run.player.types.includes('fire')&&S.phase<4&&S.phase===3)
        add('volcano-arena-flood',0,2,(x,z,t,y)=>{
          let target=S.tideTo;
          const rise=S.floodState==='warn'?Math.max(0,t-S.floodT):t;
          if(S.floodState==='warn'&&t>=S.floodT)target=.78;
          const tide=S.tide+tacticClamp(target-S.tide,-t*(.78/2.2),rise*(.78/1.9));
          return tide>=.14&&Math.hypot(x,z)>=7.8&&ground(x,z)<S.floorY+tide-.03&&low(x,z,y,.9);
        });
      for(const fissure of S.fissures||[]){
        const eta=Math.max(0,fissure.delay-fissure.t),life=fissure.delay+fissure.life-fissure.t;
        if(life<=0)continue;
        add('volcano-arena-fissure',eta,life,(x,z,t,y)=>{
          if(t<eta||t>life)return false;
          const opening=!fissure.opened&&t<=eta+frameDt;
          return S.distToFissure(fissure,x,z)<(opening?1.6:1.15)&&low(x,z,y,opening?1.4:1.2);
        });
      }
    }
  }
  if(psychic){
    const ball=kit.ball;
    if(ball?.st==='toPlayer')add('mewtwo-shadow-ball',0,Math.max(.1,9-ball.life),(x,z,t)=>{
      const speed=ball.speed,angle=Math.atan2(ball.vz,ball.vx),wanted=Math.atan2(z-ball.z,x-ball.x),
        delta=Math.atan2(Math.sin(wanted-angle),Math.cos(wanted-angle)),turn=tacticClamp(delta,-ball.turn*t,ball.turn*t),
        a=angle+turn*.5,px=ball.x+Math.cos(a)*speed*t,pz=ball.z+Math.sin(a)*speed*t;
      return Math.hypot(x-px,z-pz)<1.2+run.player.radius+speed*t*Math.abs(Math.sin(turn*.5));
    },{conservativeEnvelope:true});
    for(const blade of kit.blades||[])if(blade.t>=0){
      const prediction=t=>{
        const b={...blade};let remaining=t;
        while(remaining>1e-9){
          const dt=Math.min(frameDt,remaining);remaining-=dt;b.t+=dt;
          if(b.st==='out'){
            b.x+=b.dx*21*dt;b.z+=b.dz*21*dt;b.dist+=21*dt;
            if(b.dist>=b.range){b.st='hold';b.t=0;b.hit=false;}
          }else if(b.st==='hold'){
            if(b.t>.28){b.st='back';b.t=0;b.hit=false;}
          }else{
            const dx=kit.bx-b.x,dz=kit.bz-b.z,d=Math.hypot(dx,dz)||1,s=Math.min(d,(24+b.t*12)*dt);
            b.x+=dx/d*s;b.z+=dz/d*s;if(d<1.8)return null;
          }
          if(Math.hypot(b.x,b.z)>47){b.st='back';b.hit=false;}
        }
        return b;
      };
      add('mewtwo-psycho-cut',0,2,(x,z,t,y)=>{const p=prediction(t);return p&&!p.hit&&
        Math.hypot(x-p.x,z-p.z)<1.2+run.player.radius&&low(x,z,y,1.7);});
    }
    const ult=kit.ult;
    if(ult?.stage==='star')add('mewtwo-star-rays',Math.max(0,ult.hitCd),5.2-ult.t,(x,z,t,y)=>{
      if(t>5.2-ult.t||!low(x,z,y,1.7))return false;
      for(let j=0;j<6;j++){const a=S.spirePos(j).a+.5*ult.dir*t;
        if(x*Math.cos(a)+z*Math.sin(a)>-.5&&Math.abs(-x*Math.sin(a)+z*Math.cos(a))<1.3+run.player.radius)return true;}
      return false;
    });
    if(ult?.stage==='wave'&&!ult.waveHit)add('mewtwo-ultimate-wave',0,(48-ult.wave)/17,(x,z,t,y)=>
      Math.abs(Math.hypot(x,z)-(ult.wave+17*t))<=.8+17*frameDt&&low(x,z,y,1.2));
    for(const pylon of S.pylons||[])if(pylon.o&&run.enemies.gen[pylon.o.j]===pylon.o.g&&
        run.enemies.alive[pylon.o.j]&&!run.enemies.dying[pylon.o.j]&&pylon.ring>0&&!pylon.hit)
      add('mewtwo-pylon-pulse',0,(9-pylon.ring)/9,(x,z,t,y)=>Math.abs(Math.hypot(x-pylon.x,z-pylon.z)-
        (pylon.ring+9*t))<=.5+9*frameDt&&Math.abs(y-pylon.y)<2.6&&low(x,z,y,.5));
    for(const orb of S.orbs||[])if(orb.fall){const f=orb.fall,eta=1.2-f.t;
      add('mewtwo-falling-orb',eta,eta+.1,(x,z,t,y)=>t>=eta&&Math.hypot(x-f.x,z-f.z)<2.9&&y-ground(f.x,f.z)<2.2);
    }
  }
  return out;
}

export function charizardArenaForces(run,frameDt=1/60) {
  const kit=season3ArenaContext(run,6,'volcano');if(!kit)return [];
  return (kit.twisters||[]).filter(t=>t.t>0).map(t=>{
    const dx=run.player.pos.x-t.x,dz=run.player.pos.z-t.z,d=Math.hypot(dx,dz)||1;
    return {radial:true,originX:t.x,originZ:t.z,originVx:dx/d*2.8,originVz:dz/d*2.8,
      angle:0,halfAngle:Math.PI+.01,range:14,minRange:.3,strength:-28,strengthSlope:22/14,
      duration:t.t,delay:frameDt};
  });
}
