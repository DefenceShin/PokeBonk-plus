import { resolveCustomPlan, retainRecentPublicBuilds, publicBuildObservedAt } from "./custom-plans.mjs";
import { reviewedStandardStageCount } from "./game-library.mjs";
import { towerOfferPriority } from "./tower-strategy.mjs";

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// This is a travel preference over the native terrain, not a change to its
// size or collision rules. Fixed, widely separated destinations avoid a new
// player-centred circle every tick and retain progress across local avoidance.
export class FlightTravelPlanner {
  choose(run, options = {}) {
    if(options.orbit===true)return this.chooseOrbit(run,options);
    const p=run?.player,pos=p?.pos,terrain=run?.terrain,now=Number(run?.time);
    if(this.run!==run||this.stage!==run?.stage||this.terrain!==terrain){
      this.run=run;this.stage=run?.stage;this.terrain=terrain;this.goal=null;
      this.visits=new Map();this.failed=new Map();this.revision=0;
    }
    if(options.eligible===false||run?.state!=="play"||!pos||
        ![pos.x,pos.z,now].every(Number.isFinite)||typeof terrain?.height!=="function"||
        typeof terrain?.inBounds!=="function")return null;
    const valid=point=>terrain.inBounds(point.x,point.z,4)!==false&&
      (typeof options.withinBounds!=="function"||options.withinBounds(point.x,point.z,4))&&
      Number.isFinite(terrain.height(point.x,point.z))&&
      !terrain.hitProp?.(point.x,terrain.height(point.x,point.z)+.3,point.z,p.radius||.55)&&
      (typeof options.pointAllowed!=="function"||options.pointAllowed(point));
    for(const [id,until]of this.failed)if(until<=now)this.failed.delete(id);
    if(this.goal){
      const remaining=distance(pos,this.goal);
      if(remaining<this.goal.bestDistance-.7){this.goal.bestDistance=remaining;this.goal.progressAt=now;}
      if(remaining<=this.goal.radius||!valid(this.goal)||now-this.goal.progressAt>=16){
        this.visits.set(this.goal.id,(this.visits.get(this.goal.id)||0)+1);
        this.failed.set(this.goal.id,now+20);this.goal=null;
      }
    }
    if(!this.goal){
      const span=clamp(Number(terrain.play)||Number(terrain.arenaR)||100,12,512),
        circle=Array.isArray(options.circles)?options.circles.reduce((best,c)=>
          !best||c.radius<best.radius?c:best,null):null,
        center=circle||{x:0,z:0},radius=circle?Math.max(2,circle.radius*.78):span*.8,points=[];
      const add=(x,z,id)=>{const point={x,z};if(!valid(point)||(this.failed.get(id)||0)>now)return;
        const d=distance(pos,point);if(d<Math.min(8,radius*.35))return;
        points.push({...point,id,radius:Math.max(2,Math.min(5,radius*.05)),
          bestDistance:d,progressAt:now,score:d-Math.min(20,this.visits.get(id)||0)*radius*.35-
            Math.max(0,Number(options.routeCost?.(pos,point))||0)});};
      for(let index=0;index<24;index++){
        const angle=index*Math.PI/12;
        add(center.x+Math.cos(angle)*radius,center.z+Math.sin(angle)*radius,`flight:${index}`);
      }
      // Irregular maps can exclude a ring. The inner grid is still anchored
      // to world coordinates and only uses currently valid native cells.
      if(!points.length)for(let x=-2;x<=2;x++)for(let z=-2;z<=2;z++)
        add(center.x+x*radius*.3,center.z+z*radius*.3,`flight:${x}:${z}`);
      points.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
      this.goal=points[0]||null;if(this.goal)this.revision++;
    }
    return this.goal?{x:this.goal.x,z:this.goal.z,y:terrain.height(this.goal.x,this.goal.z),
      id:this.goal.id,radius:this.goal.radius,exploration:true,flightTravel:true,
      label:"飞行巡航 · 前往地图远端",patrolRevision:this.revision}:null;
  }
  pause(run){if(this.run===run&&!Number.isFinite(this.pausedAt))this.pausedAt=run.time;}
  chooseOrbit(run,options={}){
    const p=run?.player,pos=p?.pos,t=run?.terrain,now=Number(run?.time);
    if(this.run!==run||this.stage!==run?.stage||this.terrain!==t){
      this.run=run;this.stage=run?.stage;this.terrain=t;this.goal=null;this.phase=null;this.revision=0;this.pausedAt=null;
    }
    if(!pos||run.state!=="play"||options.eligible===false||typeof t?.height!=="function"||typeof t?.inBounds!=="function"){
      this.pause(run);return null;
    }
    if(Number.isFinite(this.pausedAt)){if(this.goal)this.goal.progressAt+=Math.max(0,now-this.pausedAt);this.pausedAt=null;}
    const spans=[Number(t.walkLim),Number(t.play),Number(t.arenaR)].filter(v=>Number.isFinite(v)&&v>0),
      span=spans.length?Math.min(...spans):100,
      circle=(options.circles||[]).reduce((best,row)=>!best||row.radius<best.radius?row:best,null),
      center=circle||{x:0,z:0},radius=Math.max(1,(circle?Math.min(span,circle.radius):span)*2/3),
      geometry=`${center.x}:${center.z}:${radius}`,
      valid=point=>t.inBounds(point.x,point.z,2)!==false&&
        options.withinBounds?.(point.x,point.z,2)!==false&&Number.isFinite(t.height(point.x,point.z))&&
        !t.hitProp?.(point.x,t.height(point.x,point.z)+.3,point.z,p.radius||.55)&&
        options.pointAllowed?.(point)!==false;
    if(this.geometry!==geometry){this.geometry=geometry;this.goal=null;}
    if(!Number.isFinite(this.phase))this.phase=Math.atan2(pos.z-center.z,pos.x-center.x)+Math.PI/8;
    if(this.goal){
      const remaining=distance(pos,this.goal);
      if(remaining<this.goal.bestDistance-.35){this.goal.bestDistance=remaining;this.goal.progressAt=now;}
      if(remaining<this.goal.radius||!valid(this.goal)||now-this.goal.progressAt>14){
        this.phase+=Math.PI/8;this.goal=null;
      }
    }
    if(!this.goal)for(let step=0;step<32&&!this.goal;step++){
      const phase=this.phase+step*Math.PI/8;
      for(const scale of [1,.8,.55]){
        const point={x:center.x+Math.cos(phase)*radius*scale,z:center.z+Math.sin(phase)*radius*scale};
        if(!valid(point)||distance(pos,point)<Math.max(1,radius*.07))continue;
        this.phase=phase;this.revision++;this.goal={...point,id:`orbit:${this.revision}`,
          radius:Math.max(1,Math.min(4,radius*.07)),bestDistance:distance(pos,point),progressAt:now};break;
      }
    }
    return this.goal?{...this.goal,y:t.height(this.goal.x,this.goal.z),exploration:true,flightTravel:true,
      orbitTravel:true,orbitPhase:this.phase,orbitRadius:radius,label:"全图环飞 · 沿地图环线移动"}:null;
  }
}

// Count genuine horizontal coverage, not path length or time spent paused or
// completing an interaction. The fixed macro goal outlives local dodge choices.
export class TravelProgressTracker {
  observe(run,options={}){
    const pos=run?.player?.pos,now=Number(run?.time);
    if(this.run!==run||this.stage!==run?.stage||this.terrain!==run?.terrain){
      this.run=run;this.stage=run?.stage;this.terrain=run?.terrain;this.at=now;this.clock=0;this.samples=[];this.commit=null;this.trappedAt=null;this.revision=0;
    }
    const dt=Number.isFinite(now)?clamp(now-this.at,0,.25):0;this.at=now;
    if(run?.state!=="play"||options.eligible!==true||!pos){
      this.samples=[];this.clock=0;this.commit=null;this.trappedAt=null;return this.state={active:false,reason:"interaction-or-paused"};
    }
    this.clock+=dt;
    if(!this.samples.length||this.clock-this.samples.at(-1).at>=.24)this.samples.push({x:pos.x,z:pos.z,at:this.clock});
    while(this.samples.length>1&&this.samples[0].at<this.clock-8)this.samples.shift();
    const first=this.samples[0],xs=this.samples.map(row=>row.x),zs=this.samples.map(row=>row.z),
      spread=Math.hypot(Math.max(...xs)-Math.min(...xs),Math.max(...zs)-Math.min(...zs)),
      net=first?distance(pos,first):0,age=first?this.clock-first.at:0,
      trapped=age>=4.5&&spread<3||age>=7&&spread<18&&net<9;
    if(trapped){if(!Number.isFinite(this.trappedAt))this.trappedAt=this.clock;}else this.trappedAt=null;
    if(this.commit&&(distance(pos,this.commit)>14||this.clock>=this.commit.until))this.commit=null;
    if(!this.commit&&trapped){this.commit={x:pos.x,z:pos.z,until:this.clock+7};this.revision++;}
    return this.state={active:!!this.commit,urgent:!!this.commit&&Number.isFinite(this.trappedAt)&&this.clock-this.trappedAt>=3,
      spread,net,age,revision:this.revision,
      reason:this.commit?"real-horizontal-breakout":"broad-native-travel"};
  }
}

// Stable world-space patrol goals and actual visited-area memory. A fresh
// player-centred ring on every decision cannot prove that a region was left.
// This planner reads terrain only; native movement still owns every position.
export class ExplorationPlanner {
  constructor() { this.run = null; this.stage = null; this.terrain = null; }
  choose(run, options = {}) {
    this.reachedGoal = null;
    const pos = run?.player?.pos, terrain = run?.terrain, now = Number(run?.time);
    if (this.run !== run || this.stage !== run?.stage || this.terrain !== terrain) {
      this.run = run; this.stage = run?.stage; this.terrain = terrain;
      this.goal = null; this.visited = new Map(); this.failed = new Map();
      this.creditedRegions = new Set();
      this.points = null; this.pointSpan = null;
      this.anchor = null; this.at = now; this.selectedLast = false;
      this.activeSeconds = 0; this.revision = 0;
    }
    if (!pos || ![now, pos.x, pos.z].every(Number.isFinite) ||
        typeof terrain?.height !== "function" || typeof terrain?.inBounds !== "function") return null;
    const span = clamp(Number(terrain.play) || 100, 12, 512),
      cell = clamp(span / 6, 12, 32), patchRadius = Math.max(18, Math.min(40, span * .24)),
      elapsed = clamp(now - this.at, 0, .5);
    if (this.selectedLast) this.activeSeconds += elapsed;
    this.at = now; this.selectedLast = run.state === "play" && options.eligible !== false && options.selected === true;
    const tile = `${Math.floor(pos.x / cell)},${Math.floor(pos.z / cell)}`;
    if (!this.anchor || distance(pos, this.anchor) >= patchRadius && !this.creditedRegions.has(tile)) {
      this.anchor = { x: pos.x, z: pos.z, at: now };
      this.creditedRegions.add(tile);
      this.activeSeconds = 0; this.revision++;
    }
    this.visited.set(tile, (this.visited.get(tile) || 0) + elapsed);
    this.state = { patchAge: Math.max(0, now - this.anchor.at), activeSeconds: this.activeSeconds,
      exhausted: this.activeSeconds >= 45, revision: this.revision,
      visitedCells: this.visited.size, reason: "world-space-patrol" };
    if (options.eligible === false || run.state !== "play") return null;
    const valid = point => terrain.inBounds?.(point.x, point.z, 5) !== false &&
      (typeof options.withinBounds !== "function" || options.withinBounds(point.x, point.z, 5)) &&
      Number.isFinite(terrain.height?.(point.x, point.z)) &&
      !terrain.hitProp?.(point.x, terrain.height(point.x, point.z) + .3, point.z,
        run.player.radius || .55);
    if (this.goal) {
      const remaining = distance(pos, this.goal);
      if (remaining < this.goal.bestDistance - .7) {
        this.goal.bestDistance = remaining; this.goal.progressAt = now;
      }
      if (remaining <= this.goal.radius) {
        // Reaching the fixed destination is real travel even in a previously
        // visited region. Publish it before a macro can consume stale failure.
        this.activeSeconds = 0;
        this.state = { ...this.state, activeSeconds: 0, exhausted: false };
        this.reachedGoal = { id: this.goal.id, x: this.goal.x, z: this.goal.z,
          radius: this.goal.radius, exploration: true };
        this.visited.set(this.goal.tile, (this.visited.get(this.goal.tile) || 0) + 20);
        this.failed.set(this.goal.id, now + 35); this.goal = null;
      } else if (!valid(this.goal) || now - this.goal.progressAt >= 20) {
        this.failed.set(this.goal.id, now + 45); this.goal = null;
      }
    }
    if (!this.goal) {
      const points = [], minimum = Math.min(patchRadius + 8, span * .55),
        speed = Math.max(1, 6.3 * (Number(run.player.stats?.moveSpeed) || 1)),
        budget = clamp(speed * 12, 35, 160);
      const add = (x, z) => {
        const point = { x, z }, d = distance(pos, point);
        if (d < Math.max(8, minimum) || !valid(point)) return;
        const id = `explore:${x.toFixed(2)}:${z.toFixed(2)}`;
        if ((this.failed.get(id) || 0) > now) return;
        const key = `${Math.floor(x / cell)},${Math.floor(z / cell)}`,
          height = terrain.height(x, z), water = terrain.waterAt?.(x, z),
          wet = !terrain.frozen && !terrain.isLava && Number.isFinite(water) && height < water - .55,
          score = 80 + Math.min(d, budget) * .35 - Math.max(0, d - budget) * 1.5 -
            Math.min(40, this.visited.get(key) || 0) * 4 - (wet ? 30 : 0) -
            Math.max(0,Number(options.routeCost?.(pos,point))||0);
        points.push({ ...point, y: height, id, tile: key, radius: Math.min(6, Math.max(2, span * .025)),
          score, bestDistance: d, progressAt: now });
      };
      if (!this.points || this.pointSpan !== span) {
        this.points = []; this.pointSpan = span;
        for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++)
          this.points.push({ x: x * span * .24, z: z * span * .24 });
        for (let step = 0; step < 16; step++)
          this.points.push({ x: Math.cos(step * Math.PI / 8) * span * .84,
            z: Math.sin(step * Math.PI / 8) * span * .84 });
      }
      for (const point of this.points) add(point.x, point.z);
      if (!points.length) for (let step = 0; step < 16; step++)
        add(pos.x + Math.cos(step * Math.PI / 8) * Math.min(30, span * .5),
          pos.z + Math.sin(step * Math.PI / 8) * Math.min(30, span * .5));
      points.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
      this.goal = points[0] || null;
    }
    return this.goal ? { x: this.goal.x, y: this.goal.y, z: this.goal.z, id: this.goal.id,
      radius: this.goal.radius, exploration: true, explorationPriority: this.state.patchAge >= 12 ? 2.1 : 1.9,
      label: "前往新的地图区域", patrolRevision: this.revision } : null;
  }
}

const terrainReadCacheViews = new WeakSet();
// An explicit diagnostic adapter, never enabled on the production motion or
// navigation paths: measured Map overhead outweighed its saved native reads.
// Exact
// coordinates retain the original height result; no rounding, stale-frame TTL,
// collision relaxation or game mutation is involved. Native walkClear uses
// this adapter's height() when invoked on it, sharing the same reads across
// trajectory prefixes, escape probes and local/A* proposals in one decision.
export function createTerrainReadCache(terrain, maxEntries = 8192) {
  if (!terrain || typeof terrain.height !== "function" || terrainReadCacheViews.has(terrain)) return terrain;
  const heights = new Map(), view = Object.create(terrain), negativeZero = Symbol("negative-zero"),
    capacity = Number.isFinite(maxEntries) ? Math.max(0, Math.min(8192, Math.floor(maxEntries))) : 8192;
  let entries = 0;
  Object.defineProperty(view, "height", { value(x, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return terrain.height(x, z);
    const xKey = Object.is(x, -0) ? negativeZero : x, zKey = Object.is(z, -0) ? negativeZero : z;
    let row = heights.get(xKey);
    if (row?.has(zKey)) return row.get(zKey);
    const value = terrain.height(x, z);
    // A large A* slice or many exact trajectory points may have little reuse.
    // Keep existing hits, but stop allocating at the decision-local cap; an
    // uncached query always executes the native function with its original
    // receiver and exact arguments, never a guessed or rounded height.
    if (entries < capacity) {
      if (!row) heights.set(xKey, row = new Map());
      row.set(zKey, value); entries++;
    }
    return value;
  } });
  terrainReadCacheViews.add(view);
  return view;
}

// Native walkClear is a sparse centre-line test. Player.update additionally
// tests the leading foot edge before applying vertical motion; a narrow ridge,
// the unsampled final half-metre, or a steep pit rim can therefore pass
// walkClear while stopping the actual player. Use small real-footprint steps
// for local walking proposals. This is geometry checking, never a teleport or
// an assertion that every jump-capable slope is walkable.
export function nativeFootprintWalkClear(terrain, start, direction, length, radius = 0.55, withinBounds) {
  if (!terrain || typeof terrain.walkClear !== "function" || typeof terrain.height !== "function" ||
      ![start?.x, start?.z, direction?.x, direction?.z, length, radius].every(Number.isFinite) || length < 0 || length > 24)
    return false;
  if (!terrain.walkClear(start.x, start.z, direction.x, direction.z, length, radius)) return false;
  const edge = Math.max(0, radius) * 0.8, count = Math.max(1, Math.ceil(length / 0.08));
  let x = start.x, z = start.z, feet = terrain.height(x, z);
  if (!Number.isFinite(feet)) return false;
  for (let step = 1; step <= count; step++) {
    // Anchor the .08m samples at the same origin for route prefixes. Dividing
    // each requested length into a different phase produced near-identical
    // yet uncached height queries for every trajectory point and escape probe.
    // Keep the exact requested endpoint and never increase the maximum gap.
    const travelled = Math.min(length, step * .08),
      nextX = start.x + direction.x * travelled,
      nextZ = start.z + direction.z * travelled;
    if (typeof withinBounds === "function" && !withinBounds(nextX, nextZ, 2)) return false;
    const xFloor = terrain.height(nextX, z), xEdge = terrain.height(nextX + Math.sign(nextX - x) * edge, z),
      zFloor = terrain.height(nextX, nextZ), zEdge = terrain.height(nextX, nextZ + Math.sign(nextZ - z) * edge);
    if (![xFloor, xEdge, zFloor, zEdge].every(Number.isFinite) ||
        Math.max(xFloor, xEdge, zFloor, zEdge) > feet + 0.6 ||
        terrain.hitProp?.(nextX, feet, nextZ, Math.max(0, radius))) return false;
    x = nextX; z = nextZ; feet = zFloor;
  }
  return true;
}

export function waveArrival(player, wave) {
  const dx = player.x - wave.x,
    dz = player.z - wave.z;
  const d = Math.hypot(dx, dz) || 0.001,
    vx = player.vx || 0,
    vz = player.vz || 0,
    radius = wave.r + 0.6,
    radialSpeed = (vx * dx + vz * dz) / d;
  if (wave.r > (wave.max ?? Infinity)) return Infinity;
  if (d <= radius) return (d - radius) / Math.max(0.1, 13 - radialSpeed);
  if (Array.isArray(player.trajectory) && player.trajectory.length > 1) {
    const path = player.trajectory,
      expires = ((wave.max ?? Infinity) - wave.r) / 13;
    for (let i = 1; i < path.length && path[i - 1].t < expires; i++) {
      const a = path[i - 1],
        b = path[i],
        dt = b.t - a.t;
      if (dt <= 0) continue;
      const duration = Math.min(dt, expires - a.t),
        x = a.x - wave.x,
        z = a.z - wave.z,
        localRadius = radius + 13 * a.t;
      if (Math.hypot(x, z) <= localRadius) return a.t;
      const entry = expandingRingEntry(
        x,
        z,
        (b.x - a.x) / dt,
        (b.z - a.z) / dt,
        localRadius,
      );
      if (entry <= duration) return a.t + entry;
    }
    // The forecast is deliberately bounded. Later decisions will use a fresh
    // path instead of pretending the slide/air velocity stays constant forever.
    return Infinity;
  }
  // Solve the expanding ring against the moving player, including tangential
  // motion. The ring is removed before collision once it exceeds its maximum.
  const t = expandingRingEntry(dx, dz, vx, vz, radius);
  return wave.r + t * 13 > (wave.max ?? Infinity) ? Infinity : t;
}

function expandingRingEntry(dx, dz, vx, vz, radius) {
  const a = vx * vx + vz * vz - 13 * 13,
    b = 2 * (dx * vx + dz * vz - radius * 13),
    c = dx * dx + dz * dz - radius * radius,
    discriminant = b * b - 4 * a * c;
  let t = Infinity;
  if (Math.abs(a) < 1e-8) {
    if (b < 0) t = -c / b;
  } else if (discriminant >= 0) {
    const root = Math.sqrt(discriminant);
    for (const candidate of [(-b - root) / (2 * a), (-b + root) / (2 * a)])
      if (candidate >= 0) t = Math.min(t, candidate);
  }
  return t;
}

export function combatRange(moves, enemyRadius = 0, stats = {}) {
  let range = 2.7;
  for (const move of moves.filter(Boolean)) {
    const m = move.def || move;
    const area = (m.area || 3) * (move.mods?.area || 1) * (stats.area || 1),
      speed = (m.speed || 0) * (move.mods?.speed || 1) * (stats.projSpeed || 1),
      duration = (m.dur || 0) * (move.mods?.dur || 1) * (stats.duration || 1);
    const r =
      /^(projectile|bolt|drain|orb|boomerang|barrage|homing|bomb)$/.test(m.arch)
        ? speed * duration * 0.65
        : /^(beam|smite|meteor|lob)$/.test(m.arch)
          ? 10
          : m.arch === "chain"
            ? 10
            : /cone|nova|aura|orbit/.test(m.arch)
              ? area * 0.7
              : /^(wave|vortex)$/.test(m.arch)
                ? speed * duration * 0.65
                : area * 0.8;
    range = Math.max(range, r);
  }
  return Math.max(enemyRadius + 1.3, Math.min(11, range));
}

// Continuous relative motion avoids stepping over fast projectiles between samples.
export function closestApproach(px, pz, vx, vz, horizon) {
  const speed2 = vx * vx + vz * vz;
  const t =
    speed2 > 1e-8 ? clamp(-(px * vx + pz * vz) / speed2, 0, horizon) : 0;
  return { t, distance: Math.hypot(px + vx * t, pz + vz * t) };
}

// Player.update keeps momentum while airborne and locks the slide velocity for
// 0.55 seconds. Predict those normal controls instead of assuming instant turns.
function hasExternalForces(player) {
  return Array.isArray(player.externalForces) && player.externalForces.some(force =>
    Number.isFinite(force.duration) && force.duration > 0);
}

const glideForecastCache = new WeakMap();
// Native flying/float glide only exists while the real jump key is held. A
// tap is not a held key. Keep this rare forecast bounded and weakly owned by
// the current player observation, without allocating a new path per hazard.
export function nativeGlideForecast(player, horizon = 1.2) {
  const held = Math.max(0, Number(player?.jumpHeldFor) || 0),
    flying = player?.floats === true || player?.types?.includes?.("flying");
  if (!player || !flying || player.diving || !held ||
      player.grounded !== false && !player.predictJump || !Number.isFinite(player.y)) return null;
  const firstFrame = Number.isFinite(player.frameDt) && player.frameDt > 1e-6 ? Math.min(.05,player.frameDt) : 1/60,
    frame = Math.max(1/120,firstFrame), limit=Math.max(0,Math.min(1.2,horizon)),
    key = [player.y,player.vy,player.height,player.grounded,player.predictJump,
      player.jumpVelocity,held,firstFrame,frame,limit].join(":"), cached = glideForecastCache.get(player);
  if (cached?.key === key) return cached.path;
  let y=player.y, vy=player.predictJump ? Math.max(0,Number(player.jumpVelocity)||11) : Number(player.vy)||0;
  const floor=y-Math.max(0,Number(player.height)||0), path=[{t:0,y,vy,grounded:false}];
  for(let t=0;t<limit-1e-9;) {
    const dt=Math.min(t===0?firstFrame:frame,limit-t,t<held?held-t:Infinity);
    if(t<held && vy < -2)vy=-2;
    vy-=30*dt;y+=vy*dt;t+=dt;
    const grounded=y<=floor;if(grounded){y=floor;vy=0;}
    path.push({t,y,vy,grounded});
    if(grounded)break;
  }
  glideForecastCache.set(player,{key,path});return path;
}

export function motionTrajectory(
  player,
  direction,
  dash = false,
  horizon = 1.2,
) {
  const speed = player.speed || 6.3,
    moving = !!(direction.x || direction.z),
    physical = dash || player.grounded != null || Number.isFinite(player.vx),
    step = 0.05,
    frameDt =
      Number.isFinite(player.frameDt) && player.frameDt > 1e-6
        ? Math.min(0.05, player.frameDt)
        : 1 / 60,
    // Player.update damps knockback before applying its displacement. Retain
    // that frame ordering while integrating the exponentially decaying force.
    knockStep = frameDt / Math.expm1(9 * frameDt),
    forceFor = Math.max(0, player.forceFor || 0),
    forceX = player.forceX || 0,
    forceZ = player.forceZ || 0,
    externalForces = (Array.isArray(player.externalForces) ? player.externalForces : []).slice(0, 8)
      .filter(force => Number.isFinite(force.duration) && force.duration > 0 &&
        (force.radial ? [force.originX, force.originZ, force.angle, force.halfAngle, force.range, force.strength].every(Number.isFinite)
          : [force.x, force.z].every(Number.isFinite))),
    forced = forceFor > 0 && !!(forceX || forceZ) || externalForces.length > 0,
    slip = clamp(Number(player.slip) || 0, 0, 1),
    icy = physical && slip > 0.5,
    initialSkate = clamp(Number(player.skateT) || 0, 0, 1.5),
    iceBaseSpeed = speed / (1 + 0.2 * slip + 0.3 * initialSkate / 1.5 * slip);
  let x = player.x,
    z = player.z,
    vx = physical ? player.vx || 0 : direction.x * speed,
    vz = physical ? player.vz || 0 : direction.z * speed,
    sliding = dash ? (icy ? 0.9 : 0.55) : Math.max(0, player.slideT || 0),
    skate = initialSkate,
    landBuffer = player.landBuffer || 0,
    kx = player.kx || 0,
    kz = player.kz || 0,
    crowdX = player.crowdX || 0,
    crowdZ = player.crowdZ || 0,
    airTime = 0,
    nextForceFrame = frameDt;
  // A nonzero native stick always means full speed. Only an explicit future
  // zero-input segment can brake; it cannot cancel a slide, jump or impulse.
  const stopAfter = Number.isFinite(direction.brakeCommitFor) && !dash &&
    player.grounded === true && !player.predictJump && !(player.slideT > 0) &&
    !(player.forceFor > 0) && !hasExternalForces(player) && Math.hypot(player.kx || 0, player.kz || 0) <= 0.00001
    ? Math.max(frameDt, direction.brakeCommitFor) : Infinity;
  // Crowd fields are a displacement consumed on the next frame, not velocity.
  // The anchor timer is reduced before its resistance and the displacement cap.
  if ((player.anchorT || 0) > frameDt) {
    crowdX *= 0.35;
    crowdZ *= 0.35;
  }
  const crowdLength = Math.hypot(crowdX, crowdZ),
    crowdLimit = 5.5 * frameDt;
  if (crowdLength > crowdLimit) {
    crowdX *= crowdLimit / crowdLength;
    crowdZ *= crowdLimit / crowdLength;
  }
  const glidePath = nativeGlideForecast(player, horizon);
  if (glidePath) {
    airTime = glidePath.find(point=>point.grounded)?.t ?? Infinity;
  } else if (player.predictJump) {
    const jump = Math.max(0, Number(player.jumpVelocity) || 11) - 15 * frameDt;
    airTime = Math.max(0, (jump + Math.sqrt(jump ** 2 + 60 * Math.max(0, player.height || 0))) / 30);
  } else if (player.grounded === false) {
    airTime =
      Number.isFinite(player.height) && Number.isFinite(player.vy)
        ? Math.max(
            0,
            (player.vy +
              Math.sqrt(player.vy ** 2 + 60 * Math.max(0, player.height))) /
              30,
          )
        : Infinity;
  }
  if (dash) {
    vx = direction.x * speed * (icy ? 2.3 : 1.9);
    vz = direction.z * speed * (icy ? 2.3 : 1.9);
  }
  const points = [{ x, z, t: 0 }];
  for (let t = 0; t < horizon - 1e-8;) {
    let dt = Math.min(step, horizon - t);
    // Ice steering is a discrete acceleration/turn process. Use native frame
    // steps instead of ordinary-ground exponential braking on this surface.
    if (icy || externalForces.length) dt = Math.min(dt, frameDt);
    else if(glidePath)dt=Math.min(dt,Math.max(1/120,frameDt));
    if (t === 0) dt = Math.min(dt, frameDt);
    if (t < stopAfter) dt = Math.min(dt, stopAfter - t);
    const steering = moving && t < stopAfter,
      inputX = steering ? direction.x : 0, inputZ = steering ? direction.z : 0;
    if (sliding > 0) {
      dt = Math.min(dt, sliding);
      const rate = icy ? 0.7 : 2.2, decay = Math.exp(-dt * rate);
      x += icy ? vx * decay * dt : (vx * (1 - decay)) / rate;
      z += icy ? vz * decay * dt : (vz * (1 - decay)) / rate;
      vx *= decay;
      vz *= decay;
      sliding = Math.max(0, sliding - dt);
    } else if (t < airTime && !(player.predictJump && player.grounded !== false && t === 0)) {
      dt = Math.min(dt, airTime - t);
      const glideVelocity = glidePath?.find(point=>point.t >= t-1e-9)?.vy,
        gliding = glidePath && t < player.jumpHeldFor && glideVelocity < -1.5 && steering;
      if(gliding) {
        const blend=Math.min(1,6*dt);
        vx+=(inputX*speed-vx)*blend;vz+=(inputZ*speed-vz)*blend;
        x+=vx*dt;z+=vz*dt;
      } else {
      const oldX = vx,
        oldZ = vz,
        along = vx * direction.x + vz * direction.z,
        gain = Math.max(0, Math.min(speed * 0.9 - along, speed * 5 * dt));
      vx += direction.x * gain;
      vz += direction.z * gain;
      const magnitude = Math.hypot(vx, vz),
        maximum = speed * 1.7;
      if (magnitude > maximum) {
        vx *= maximum / magnitude;
        vz *= maximum / magnitude;
      }
      x += (oldX + vx) * 0.5 * dt;
      z += (oldZ + vz) * 0.5 * dt;
      }
    } else if (icy) {
      const before = Math.hypot(vx, vz), steeringFactor = 1 - 1.2 * (slip - 0.5);
      if (steering) {
        const alignment = before > 0.5 ? (vx * inputX + vz * inputZ) / before : 1;
        skate = alignment > 0.7 ? Math.min(1.5, skate + dt) : Math.max(0, skate - dt * 3);
        const gain = 22 * steeringFactor * dt + (before < 1.5 ? 2.2 : 0);
        vx += inputX * gain;
        vz += inputZ * gain;
        if (before > 1) {
          const turn = Math.min(1, dt * (1.6 + 2.4 * steeringFactor)),
            tx = vx + (inputX * before - vx) * turn,
            tz = vz + (inputZ * before - vz) * turn,
            length = Math.hypot(tx, tz) || 1, magnitude = Math.hypot(vx, vz);
          vx = tx / length * magnitude;
          vz = tz / length * magnitude;
        }
      } else {
        skate = Math.max(0, skate - dt * 0.6);
        const decay = Math.exp(-dt * 0.35);
        vx *= decay;
        vz *= decay;
      }
      if (player.iceSurface !== true) {
        vx += (Number(player.slopeX) || 0) * 28 * dt;
        vz += (Number(player.slopeZ) || 0) * 28 * dt;
      }
      const currentSpeed = iceBaseSpeed * (1 + 0.2 * slip + 0.3 * skate / 1.5 * slip),
        magnitude = Math.hypot(vx, vz);
      if (magnitude > currentSpeed) {
        const factor = Math.min(currentSpeed * 1.7, Math.max(currentSpeed, magnitude - dt * 2.5)) / magnitude;
        vx *= factor;
        vz *= factor;
      }
      x += vx * dt;
      z += vz * dt;
    } else if (landBuffer > 0 && Math.hypot(vx, vz) > speed) {
      // Land buffer preserves overspeed, applying 0.97 friction per 60 Hz frame.
      const rate = -Math.log(0.97) * 60,
        decay = Math.exp(-rate * dt);
      x += (vx * (1 - decay)) / rate;
      z += (vz * (1 - decay)) / rate;
      vx *= decay;
      vz *= decay;
    } else if (physical) {
      const tx = inputX * speed,
        tz = inputZ * speed,
        rate = (steering ? 280 : 160) / Math.max(1, speed),
        decay = Math.exp(-rate * dt);
      x += tx * dt + ((vx - tx) * (1 - decay)) / rate;
      z += tz * dt + ((vz - tz) * (1 - decay)) / rate;
      vx = tx + (vx - tx) * decay;
      vz = tz + (vz - tz) * decay;
    } else {
      x += vx * dt;
      z += vz * dt;
    }
    if (forced) {
      // Boss gusts inject acceleration after Player.update. Current kx/kz
      // already contain the previous frame's gust; the next injection must
      // not move the player until the following frame. Split only the force
      // integral at native frame boundaries, leaving normal steering intact.
      let from = t;
      while (from < t + dt - 1e-10) {
        const to = Math.min(t + dt, nextForceFrame),
          knockDecay = Math.exp(-9 * (to - from));
        x += kx * (1 - knockDecay) * knockStep;
        z += kz * (1 - knockDecay) * knockStep;
        kx *= knockDecay;
        kz *= knockDecay;
        from = to;
        if (from >= nextForceFrame - 1e-10) {
          if (nextForceFrame - frameDt < forceFor - 1e-10) {
            kx += forceX * frameDt;
            kz += forceZ * frameDt;
          }
          const elapsed = nextForceFrame - frameDt;
          for (const force of externalForces) {
            const delay = Math.max(0, force.delay || 0);
            if (elapsed < delay - 1e-10 || elapsed >= delay + force.duration - 1e-10) continue;
            if (!force.radial) {
              kx += force.x * frameDt; kz += force.z * frameDt; continue;
            }
            const dx = x - force.originX, dz = z - force.originZ, distance = Math.hypot(dx, dz),
              angle = Math.atan2(dz, dx) - force.angle;
            if (distance > 1e-8 && distance < force.range &&
                Math.abs(Math.atan2(Math.sin(angle), Math.cos(angle))) < force.halfAngle) {
              kx += dx / distance * force.strength * frameDt;
              kz += dz / distance * force.strength * frameDt;
            }
          }
          nextForceFrame += frameDt;
        }
      }
    } else {
      const knockDecay = Math.exp(-9 * dt);
      x += kx * (1 - knockDecay) * knockStep;
      z += kz * (1 - knockDecay) * knockStep;
      kx *= knockDecay;
      kz *= knockDecay;
    }
    if (t === 0) {
      x += crowdX;
      z += crowdZ;
    }
    t += dt;
    landBuffer -= dt;
    points.push({ x, z, t });
  }
  return points;
}

function trajectoryPoint(path, t) {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1],
      b = path[i];
    if (b.t >= t) {
      const fraction = clamp((t - a.t) / (b.t - a.t), 0, 1);
      return {
        x: a.x + (b.x - a.x) * fraction,
        z: a.z + (b.z - a.z) * fraction,
      };
    }
  }
  return path[path.length - 1];
}

function trajectoryApproach(path, body, horizon, notBefore = 0) {
  let best = { t: 0, distance: Infinity };
  const lag = Math.max(0, body.frameLag || 0);
  for (let i = 1; i < path.length && path[i - 1].t < horizon; i++) {
    const raw = path[i - 1],
      b = path[i];
    if (b.t <= notBefore) continue;
    const start = Math.max(raw.t, notBefore),
      end = Math.min(b.t, horizon),
      cuts = lag > start && lag < end ? [start, lag, end] : [start, end],
      playerVX = (b.x - raw.x) / (b.t - raw.t),
      playerVZ = (b.z - raw.z) / (b.t - raw.t);
    for (let j = 1; j < cuts.length; j++) {
      const t = cuts[j - 1],
        dt = cuts[j] - t,
        moving = cuts[j] > lag,
        bodyTime = Math.max(0, t - lag),
        near = closestApproach(
          body.x + (body.vx || 0) * bodyTime - raw.x - playerVX * (t - raw.t),
          body.z + (body.vz || 0) * bodyTime - raw.z - playerVZ * (t - raw.t),
          (moving ? body.vx || 0 : 0) - playerVX,
          (moving ? body.vz || 0 : 0) - playerVZ,
          dt,
        );
      // Enemy.update measures horizontal contact before moving that enemy,
      // after Player.update has already moved and decremented invulnerability.
      if (near.distance < best.distance)
        best = { t: t + near.t, distance: near.distance };
    }
  }
  return best;
}

function playerYAt(player, time) {
  const verticalPath = player.trajectoryY || nativeGlideForecast(player);
  if (Array.isArray(verticalPath) && verticalPath.length > 1) {
    for (let index = 1; index < verticalPath.length; index++) {
      const a = verticalPath[index - 1], b = verticalPath[index];
      if (b.t >= time && Number.isFinite(a.y) && Number.isFinite(b.y))
        return a.y + (b.y - a.y) * clamp((time - a.t) / Math.max(1e-9, b.t - a.t), 0, 1);
    }
    const last = verticalPath.at(-1);
    if (Number.isFinite(last.y)) return last.y;
  }
  if (!Number.isFinite(player.y)) return undefined;
  if (player.predictJump) {
    const frame = Number.isFinite(player.frameDt) && player.frameDt > 0 ? Math.min(0.05, player.frameDt) : 1 / 60,
      steps = Math.floor((time + 1e-10) / frame), rest = Math.max(0, time - steps * frame),
      jump = Math.max(0, Number(player.jumpVelocity) || 11);
    return Math.max(player.y - Math.max(0, player.height || 0),
      player.y + jump * time - 15 * time ** 2 - 15 * (steps * frame ** 2 + rest ** 2));
  }
  if (player.grounded !== false || !Number.isFinite(player.vy)) return player.y;
  return Math.max(
    player.y - Math.max(0, player.height || 0),
    player.y + player.vy * time - 15 * time ** 2,
  );
}

function projectileSegmentApproach(player, a, b, from, to) {
  const dt = b.t - a.t,
    vx = (to.x - from.x - b.x + a.x) / dt,
    vz = (to.z - from.z - b.z + a.z) / dt;
  let start = Math.max(0, (player.invulnerableFor || 0) - a.t),
    end = dt;
  if (start >= end) return { t: a.t, distance: Infinity };
  const py0 = playerYAt(player, a.t),
    py1 = playerYAt(player, b.t);
  if (Number.isFinite(from.y) && Number.isFinite(py0) && Number.isFinite(py1)) {
    const y0 = from.y - py0 - 0.8,
      yv = (to.y - from.y - py1 + py0) / dt;
    // Native hostile shots use a horizontal cylinder and |vertical gap| < 1.5.
    // A small margin includes discrete-frame contacts and forecast error.
    if (Math.abs(yv) < 1e-8) {
      if (Math.abs(y0) > 1.8) return { t: a.t, distance: Infinity };
    } else {
      const first = (-1.8 - y0) / yv,
        last = (1.8 - y0) / yv;
      start = Math.max(start, Math.min(first, last));
      end = Math.min(dt, Math.max(first, last));
      if (end < start) return { t: a.t, distance: Infinity };
    }
  }
  const near = closestApproach(
    from.x - a.x + vx * start,
    from.z - a.z + vz * start,
    vx,
    vz,
    end - start,
  );
  return { t: a.t + start + near.t, distance: near.distance };
}

export function projectileApproach(path, projectile, player, horizon = 0.85) {
  horizon = Math.min(horizon, projectile.life ?? horizon);
  let best = { t: 0, distance: Infinity };
  if (projectile.flags & 4096) return best; // Native051 teammate visual, no hit contacts.
  if (horizon <= 0) return best;
  const homing = (projectile.flags & 3) === 3;
  if (!homing) {
    // Keep ordinary shots on their measured straight trajectory. The Homing
    // bit on a friendly projectile must never invent a hostile tracking shot.
    for (let i = 1; i < path.length && path[i - 1].t < horizon; i++) {
      const a = path[i - 1],
        raw = path[i],
        b =
          raw.t <= horizon
            ? raw
            : { ...trajectoryPoint(path, horizon), t: horizon },
        from = {
          x: projectile.x + (projectile.vx || 0) * a.t,
          z: projectile.z + (projectile.vz || 0) * a.t,
          y:
            projectile.y == null
              ? undefined
              : projectile.y + (projectile.vy || 0) * a.t,
        },
        to = {
          x: projectile.x + (projectile.vx || 0) * b.t,
          z: projectile.z + (projectile.vz || 0) * b.t,
          y:
            projectile.y == null
              ? undefined
              : projectile.y + (projectile.vy || 0) * b.t,
        },
        near = projectileSegmentApproach(player, a, b, from, to);
      if (near.distance < best.distance) best = near;
    }
    return best;
  }
  let x = projectile.x,
    z = projectile.z,
    y = projectile.y,
    vx = projectile.vx || 0,
    vz = projectile.vz || 0,
    vy = projectile.vy || 0;
  const speed = projectile.speed ?? Math.hypot(vx, vy, vz);
  let a = { ...path[0], t: 0 };
  // Projectiles.step applies this steering once per normal 60 Hz simulation
  // step: horizontal blend 1.7/s, vertical target velocity multiplied by 0.4.
  for (let t = 0; t < horizon - 1e-8;) {
    const dt = Math.min(1 / 60, horizon - t),
      b = { ...trajectoryPoint(path, t + dt), t: t + dt },
      targetY = playerYAt(player, b.t),
      dx = b.x - x,
      dz = b.z - z,
      dy =
        Number.isFinite(y) && Number.isFinite(targetY) ? targetY + 0.8 - y : 0,
      distance = Math.hypot(dx, dy, dz) || 1,
      turn = Math.min(1, dt * 1.7);
    vx += ((dx / distance) * speed - vx) * turn;
    vz += ((dz / distance) * speed - vz) * turn;
    vy += ((dy / distance) * speed * 0.4 - vy) * turn;
    const from = { x, y, z },
      to = {
        x: x + vx * dt,
        y: y == null ? undefined : y + vy * dt,
        z: z + vz * dt,
      },
      near = projectileSegmentApproach(player, a, b, from, to);
    if (near.distance < best.distance) best = near;
    x = to.x;
    y = to.y;
    z = to.z;
    a = b;
    t += dt;
  }
  return best;
}

function pointLineDistance(p, line) {
  const dx = line.x2 - line.x,
    dz = line.z2 - line.z,
    u = clamp(
      ((p.x - line.x) * dx + (p.z - line.z) * dz) /
        Math.max(1e-8, dx * dx + dz * dz),
      0,
      1,
    );
  return Math.hypot(p.x - line.x - dx * u, p.z - line.z - dz * u);
}

function segmentLineDistance(a, b, line) {
  const dx = b.x - a.x,
    dz = b.z - a.z,
    lx = line.x2 - line.x,
    lz = line.z2 - line.z,
    denominator = dx * lz - dz * lx;
  if (Math.abs(denominator) > 1e-8) {
    const qx = line.x - a.x,
      qz = line.z - a.z,
      t = (qx * lz - qz * lx) / denominator,
      u = (qx * dz - qz * dx) / denominator;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
  }
  const movingLine = { x: a.x, z: a.z, x2: b.x, z2: b.z };
  return Math.min(
    pointLineDistance(a, line),
    pointLineDistance(b, line),
    pointLineDistance({ x: line.x, z: line.z }, movingLine),
    pointLineDistance({ x: line.x2, z: line.z2 }, movingLine),
  );
}

function hazardAffects(player, hazard, time) {
  const y = playerYAt(player, time);
  if (
    hazard.groundedOnly &&
    (player.grounded === false || player.predictJump) &&
    Number.isFinite(y) &&
    Number.isFinite(player.height) &&
    y > player.y - Math.max(0, player.height) + 0.05
  )
    return false;
  return (
    !Number.isFinite(hazard.maxHeight) ||
    !Number.isFinite(hazard.y) ||
    !Number.isFinite(y) ||
    y - hazard.y < hazard.maxHeight
  );
}

function hazardTrajectoryDistance(
  path,
  hazard,
  player,
  horizon,
  notBefore = 0,
) {
  let distance = Infinity;
  for (let i = 1; i < path.length && path[i - 1].t < horizon; i++) {
    const rawStart = path[i - 1],
      raw = path[i];
    if (raw.t <= notBefore) continue;
    const a =
        rawStart.t < notBefore
          ? { ...trajectoryPoint(path, notBefore), t: notBefore }
          : rawStart,
      b =
        raw.t <= horizon
          ? raw
          : { ...trajectoryPoint(path, horizon), t: horizon };
    if (
      !hazardAffects(player, hazard, a.t) &&
      !hazardAffects(player, hazard, b.t)
    )
      continue;
    if (hazard.x2 != null)
      distance = Math.min(distance, segmentLineDistance(a, b, hazard));
    else {
      const dt = b.t - a.t,
        near = closestApproach(
          hazard.x - a.x,
          hazard.z - a.z,
          -(b.x - a.x) / dt,
          -(b.z - a.z) / dt,
          dt,
        );
      distance = Math.min(distance, near.distance);
    }
  }
  return distance;
}

function radialCrossings(dx, dz, vx, vz, radius, rate, duration) {
  const a = vx * vx + vz * vz - rate * rate,
    b = 2 * (dx * vx + dz * vz - radius * rate),
    c = dx * dx + dz * dz - radius * radius;
  let roots = [];
  if (Math.abs(a) < 1e-9) {
    if (Math.abs(b) > 1e-9) roots = [-c / b];
  } else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant >= 0) {
      const d = Math.sqrt(discriminant);
      roots = [(-b - d) / (2 * a), (-b + d) / (2 * a)];
    }
  }
  return roots
    .filter(
      (t) => t >= -1e-8 && t <= duration + 1e-8 && radius + rate * t >= -1e-8,
    )
    .map((t) => Math.max(0, Math.min(duration, t)));
}

// Unlike a damage pool, this shape hurts OUTSIDE a moving safe circle. Solve
// every piecewise-linear crossing, including an excursion between samples.
// Native mist uses the player's center and ignores jump height.
function outsideSingleCircleWindows(path, hazard, player = {}, horizon = 1.2, notBefore = 0) {
  const centers = hazard.centerPath?.length ? hazard.centerPath :
    [{ t: 0, x: hazard.x, z: hazard.z }, { t: horizon, x: hazard.x, z: hazard.z }];
  const start = Math.max(0, notBefore, hazard.eta || 0, player.invulnerableFor || 0),
    end = Math.min(horizon, hazard.life ?? horizon, path.at(-1)?.t ?? 0),
    radius = Number(hazard.radius);
  if (!(end > start) || !(radius > 0)) return [];
  const times = [...new Set([start, end, ...path.map(point => point.t), ...centers.map(point => point.t)]
    .filter(time => time >= start && time <= end))].sort((a, b) => a - b), windows = [];
  for (let index = 1; index < times.length; index++) {
    const from = times[index - 1], to = times[index], duration = to - from;
    if (duration <= 0) continue;
    const a = trajectoryPoint(path, from), b = trajectoryPoint(path, to),
      ca = trajectoryPoint(centers, from), cb = trajectoryPoint(centers, to),
      dx = a.x - ca.x, dz = a.z - ca.z,
      vx = (b.x - cb.x - dx) / duration, vz = (b.z - cb.z - dz) / duration,
      cuts = [0, ...radialCrossings(dx, dz, vx, vz, radius, 0, duration), duration].sort((a, b) => a - b);
    for (let part = 1; part < cuts.length; part++) {
      const left = cuts[part - 1], right = cuts[part], mid = (left + right) / 2;
      if (right - left <= 1e-9 || Math.hypot(dx + vx * mid, dz + vz * mid) < radius) continue;
      const last = windows.at(-1);
      if (last && Math.abs(last.end - (from + left)) < 1e-8) last.end = from + right;
      else windows.push({ start: from + left, end: from + right });
    }
  }
  return windows;
}

function safeCircleAt(hazard, time, point) {
  const circles = Array.isArray(hazard.safeCircles) ? hazard.safeCircles : [hazard];
  return circles.some(circle => {
    const center = circle.centerPath?.length ? trajectoryPoint(circle.centerPath, time) : circle;
    return Number.isFinite(circle.radius) && circle.radius > 0 &&
      Math.hypot(point.x - center.x, point.z - center.z) < circle.radius;
  });
}

export function outsideCircleWindows(path, hazard, player = {}, horizon = 1.2, notBefore = 0) {
  if (hazard.oneShot) {
    const eta = hazard.eta || 0, impact = Math.max(0, eta - (player.frameDt || 1 / 60));
    return eta < 0 || impact < Math.max(notBefore, player.invulnerableFor || 0) || impact > horizon ||
      (hazard.life ?? Infinity) < impact || safeCircleAt(hazard, impact, trajectoryPoint(path, impact))
      ? [] : [{ start: impact, end: impact }];
  }
  if (!Array.isArray(hazard.safeCircles)) return outsideSingleCircleWindows(path, hazard, player, horizon, notBefore);
  let windows = [{ start: Math.max(0, notBefore, hazard.eta || 0, player.invulnerableFor || 0),
    end: Math.min(horizon, hazard.life ?? horizon, path.at(-1)?.t ?? 0) }].filter(window => window.end > window.start);
  for (const circle of hazard.safeCircles) {
    if (!Number.isFinite(circle.radius) || circle.radius <= 0) continue;
    const outside = outsideSingleCircleWindows(path, { ...hazard, ...circle }, player, horizon, notBefore), next = [];
    for (const first of windows) for (const second of outside) {
      const start = Math.max(first.start, second.start), end = Math.min(first.end, second.end);
      if (end > start) next.push({ start, end });
    }
    windows = next;
  }
  return windows;
}

export function sectorHazardContact(path, hazard, player = {}, horizon = 1.2, notBefore = 0) {
  if(hazard.shape === "sweeping-cone") {
    // Native Hypno accumulates sleep while in either moving cone. It checks
    // XZ centers even in the air/during damage immunity, unlike damage pools.
    if(!path?.length || ![hazard.x,hazard.z,hazard.radius,hazard.halfAngle,
      hazard.baseAngle,hazard.amplitude,hazard.period,hazard.phaseTime,hazard.trackingRate,hazard.life].every(Number.isFinite) ||
      hazard.radius<=0 || hazard.period<=0 || hazard.life<=0)return Infinity;
    const end=Math.min(horizon,hazard.life,path.at(-1).t);
    let base=hazard.baseAngle,previous=0;
    for(let time=0;time<=end+1e-8;time=Math.min(end,time+1/60)) {
      const point=trajectoryPoint(path,time),dx=point.x-hazard.x,dz=point.z-hazard.z,
        aim=Math.atan2(dz,dx),difference=Math.atan2(Math.sin(aim-base),Math.cos(aim-base)),
        turn=hazard.trackingRate*(time-previous);
      base+=clamp(difference,-turn,turn);
      const swing=Math.sin((hazard.phaseTime+time)*Math.PI*2/hazard.period)*hazard.amplitude;
      for(const sign of hazard.mirrored ? [1,-1] : [1]) {
        const delta=aim-base-sign*swing;
        if(time+1e-8>=Math.max(notBefore,path[0].t) && Math.hypot(dx,dz)<hazard.radius &&
            Math.abs(Math.atan2(Math.sin(delta),Math.cos(delta)))<hazard.halfAngle)return time;
      }
      if(time>=end)break;
      previous=time;
    }
    return Infinity;
  }
  const eta = hazard.eta || 0, impact = Math.max(0, eta - (player.frameDt || 1 / 60));
  if (eta < 0 || impact < (player.invulnerableFor || 0) || impact > horizon ||
      (hazard.life ?? Infinity) < impact) return Infinity;
  const point = trajectoryPoint(path, impact), dx = point.x - hazard.x, dz = point.z - hazard.z,
    count = hazard.sectorCount || 8,
    sector = Math.hypot(dx, dz) < hazard.innerRadius ? count :
      Math.floor((Math.atan2(dz, dx) + Math.PI) / (Math.PI * 2 / count)) % count;
  return hazard.safeSectors?.includes(sector) ? Infinity : impact;
}

// A ring only hurts along its moving front. Solve both edges continuously on
// each trajectory segment: fast quake fronts can pass between all samples.
export function ringContact(path, hazard, player, horizon = 1.2) {
  const activation = Math.max(0, hazard.eta || 0),
    start = Math.max(activation, player.invulnerableFor || 0),
    end = Math.min(horizon, hazard.life ?? horizon, path.at(-1)?.t ?? 0),
    rate = hazard.radialSpeed || 0,
    minimum = hazard.minRadius ?? 0,
    maximum = hazard.maxRadius ?? Infinity,
    width = Math.max(0, hazard.thickness || 0) + 0.15,
    radiusAt = (t) =>
      Math.max(
        minimum,
        Math.min(maximum, hazard.radius + rate * Math.max(0, t - activation)),
      );
  if (end < start) return Infinity;
  const transitions = [start, end];
  const hasGap = Number.isFinite(hazard.safeGapAngle) && hazard.safeGapHalfAngle > 0,
    inGap = (x, z) => hasGap && Math.abs(Math.atan2(Math.sin(Math.atan2(z, x) - hazard.safeGapAngle),
      Math.cos(Math.atan2(z, x) - hazard.safeGapAngle))) < hazard.safeGapHalfAngle;
  if (hasGap) for (let index = 1; index < path.length; index++) {
    const a = path[index - 1], b = path[index];
    for (const angle of [hazard.safeGapAngle - hazard.safeGapHalfAngle, hazard.safeGapAngle + hazard.safeGapHalfAngle]) {
      const ux = Math.cos(angle), uz = Math.sin(angle), ax = a.x - hazard.x, az = a.z - hazard.z,
        dx = b.x - a.x, dz = b.z - a.z, denominator = dx * uz - dz * ux;
      if (Math.abs(denominator) < 1e-10) continue;
      const fraction = -(ax * uz - az * ux) / denominator, t = a.t + fraction * (b.t - a.t);
      if (fraction > 0 && fraction < 1 && t > start && t < end &&
          (ax + dx * fraction) * ux + (az + dz * fraction) * uz >= 0) transitions.push(t);
    }
  }
  if (rate) {
    for (const bound of [minimum, maximum]) {
      const t = activation + (bound - hazard.radius) / rate;
      if (Number.isFinite(t) && t > start && t < end) transitions.push(t);
    }
  }
  // Split at actual jump-height crossings as well as radial clamp times. This
  // keeps a front passing underneath a jump from being treated as grounded.
  if (Array.isArray(player.trajectoryY)) {
    const levels = [];
    if (Number.isFinite(hazard.y) && Number.isFinite(hazard.maxHeight)) levels.push(hazard.y + hazard.maxHeight);
    if (hazard.groundedOnly && Number.isFinite(player.height)) levels.push(player.y - Math.max(0, player.height) + 0.05);
    for (let index = 1; index < player.trajectoryY.length; index++) {
      const a = player.trajectoryY[index - 1], b = player.trajectoryY[index];
      if (!Number.isFinite(a.y) || !Number.isFinite(b.y) || a.y === b.y) continue;
      for (const level of levels) {
        const part = (level - a.y) / (b.y - a.y), t = a.t + (b.t - a.t) * part;
        if (part > 0 && part < 1 && t > start && t < end) transitions.push(t);
      }
    }
  }
  if (
    !player.trajectoryY &&
    (player.grounded === false || player.predictJump) &&
    Number.isFinite(player.y) &&
    Number.isFinite(player.vy)
  ) {
    const heights = [];
    if (Number.isFinite(hazard.y) && Number.isFinite(hazard.maxHeight))
      heights.push(hazard.y + hazard.maxHeight);
    if (hazard.groundedOnly && Number.isFinite(player.height))
      heights.push(player.y - Math.max(0, player.height) + 0.05);
    for (const height of heights) {
      const velocity = player.predictJump ? (Number(player.jumpVelocity) || 11) - 15 *
        (Number.isFinite(player.frameDt) && player.frameDt > 0 ? Math.min(0.05, player.frameDt) : 1 / 60) : player.vy,
        discriminant = velocity ** 2 + 60 * (player.y - height);
      if (discriminant < 0) continue;
      const root = Math.sqrt(discriminant);
      for (const t of [(velocity - root) / 30, (velocity + root) / 30])
        if (t > start && t < end) transitions.push(t);
    }
  }
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1],
      b = path[i];
    if (b.t < start || a.t > end) continue;
    const from = Math.max(a.t, start),
      to = Math.min(b.t, end),
      cuts = [from, ...transitions.filter((t) => t > from && t < to), to].sort(
        (x, y) => x - y,
      ),
      vx = (b.x - a.x) / (b.t - a.t),
      vz = (b.z - a.z) / (b.t - a.t);
    for (let j = 1; j < cuts.length; j++) {
      const t = cuts[j - 1],
        duration = cuts[j] - t;
      if (!hazardAffects(player, hazard, t + duration / 2)) continue;
      const dx = a.x + vx * (t - a.t) - hazard.x,
        dz = a.z + vz * (t - a.t) - hazard.z,
        radius = radiusAt(t),
        radialVelocity =
          duration > 0 ? (radiusAt(t + duration) - radius) / duration : 0;
      if (Math.abs(Math.hypot(dx, dz) - radius) <= width &&
          !inGap(dx + vx * duration / 2, dz + vz * duration / 2)) return t;
      const crossings = [
        ...radialCrossings(
          dx,
          dz,
          vx,
          vz,
          radius + width,
          radialVelocity,
          duration,
        ),
        ...radialCrossings(
          dx,
          dz,
          vx,
          vz,
          radius - width,
          radialVelocity,
          duration,
        ),
      ].sort((x, y) => x - y);
      for (const dt of crossings)
        if (
          Math.abs(Math.hypot(dx + vx * dt, dz + vz * dt) - radiusAt(t + dt)) <=
          width + 1e-7 && !inGap(dx + vx * dt, dz + vz * dt)
        )
          return t + dt;
    }
  }
  return Infinity;
}

// Damage is a conservative, post-mitigation upper bound supplied by the native
// adapter, before the currently measured shield. Missing damage is never zero.
function motionObjective(state) {
  const objective = state.objective, p = state.player;
  if (!["altar", "candle", "revive", "mastery","character-practice"].includes(objective?.kind) || objective.available === false ||
      !Number.isFinite(objective.center?.x) || !Number.isFinite(objective.center?.z) ||
      !Number.isFinite(objective.radius) || !(objective.radius > 0) ||
      !Number.isFinite(p.hp) || !Number.isFinite(p.maxHp) || !(p.maxHp > 0) ||
      objective.progress >= 1) return null;
  // Only an explicitly selected native mastery predicate can request measured
  // non-lethal contact. Unknown/lethal/hard-danger forecasts remain forbidden.
  const mastery=objective.kind==="mastery"||objective.kind==='character-practice';
  const reserve = mastery&&Number.isFinite(objective.reserveHp)?Math.max(1,objective.reserveHp):p.maxHp * (state.safeMode === true ? 0.65 : 0.4);
  const regen = Number.isFinite(p.regen) ? Math.max(0, p.regen) : 0;
  const cap = p.maxHp * (mastery?0.08:state.safeMode === true ? 0.025 : 0.08);
  const budget = Number.isFinite(objective.healthBudget)
    ? Math.max(0, objective.healthBudget) : cap;
  return { ...objective, reserve, regen, budget: Math.min(cap, budget) };
}

// A nearby waypoint otherwise loses to standing still because uninterrupted
// walking overshoots it at the old .55s progress sample. Price a few real
// full-speed-then-zero paths, keeping the complete danger/collision horizon.
// The next native frame is replanned from its actual velocity and position.
function nearGoalCommits(player, target, frameDt) {
  const speed = player.speed || 6.3, dx = target.x - player.x, dz = target.z - player.z,
    distance = Math.hypot(dx, dz);
  if (player.grounded !== true || player.predictJump || player.slideT > 0 ||
      player.forceFor > 0 || hasExternalForces(player) || player.landBuffer > 0 && Math.hypot(player.vx || 0, player.vz || 0) > speed ||
      Math.hypot(player.kx || 0, player.kz || 0, player.crowdX || 0, player.crowdZ || 0) > 0.00001 ||
      distance <= 0.05 || distance > speed * 0.6) return [];
  const direction = { x: dx / distance, z: dz / distance },
    along = (player.vx || 0) * direction.x + (player.vz || 0) * direction.z,
    acceleration = 280 / Math.max(1, speed), braking = 160 / Math.max(1, speed),
    stoppedDistance = commit => {
      const decay = Math.exp(-acceleration * commit), end = speed + (along - speed) * decay;
      return speed * commit + (along - speed) * (1 - decay) / acceleration + end / braking;
    };
  let low = frameDt, high = Math.max(frameDt, Math.min(0.35, distance / speed + 0.12));
  for (let step = 0; step < 10; step++) {
    const middle = (low + high) / 2;
    if (stoppedDistance(middle) < distance) low = middle; else high = middle;
  }
  const commit = (low + high) / 2, result = [];
  for (const scale of [0.8, 1, 1.2]) {
    const brakeCommitFor = clamp(commit * scale, frameDt, 0.35);
    if (!result.some(choice => Math.abs(choice.brakeCommitFor - brakeCommitFor) < frameDt * 0.5))
      result.push({ ...direction, brakeCommitFor });
  }
  return result;
}

function motionCandidatePath(player, direction, dash, objective) {
  if (Number.isFinite(direction.brakeCommitFor)) return motionTrajectory(player, direction, dash);
  // Nonzero native sticks are normalized: do not invent slow analog walking.
  // A grounded altar manoeuvre commits a short full-speed segment, then plans
  // to brake. Receding-frame decisions may choose a different safe continuation.
  if (!objective || dash || player.predictJump || player.grounded === false || player.slideT > 0 ||
      player.forceFor > 0 || hasExternalForces(player) || Math.hypot(player.kx || 0, player.kz || 0) > 0.00001)
    return motionTrajectory(player, direction, dash);
  const commit = clamp(objective.radius / (player.speed || 6.3) * 0.45, 0.12, 0.28);
  const path = motionTrajectory(player, direction, false, commit);
  const end = path.at(-1), before = path.at(-2), dt = end.t - before.t;
  const rest = motionTrajectory({ ...player, x: end.x, z: end.z,
    vx: (end.x - before.x) / dt, vz: (end.z - before.z) / dt,
    grounded: true, crowdX: 0, crowdZ: 0,
    landBuffer: Math.max(0, (player.landBuffer || 0) - commit),
  }, { x: 0, z: 0 }, false, 1.2 - commit);
  return path.concat(rest.slice(1).map(point => ({ ...point, t: point.t + commit })));
}

function motionContactWindow(a, b, from, to, player, radius, vertical, notBefore = a.t, playerOffset = .8) {
  const dt = b.t - a.t;
  if (!(dt > 0)) return null;
  const x = from.x - a.x, z = from.z - a.z,
    vx = (to.x - from.x - b.x + a.x) / dt,
    vz = (to.z - from.z - b.z + a.z) / dt,
    aa = vx * vx + vz * vz, bb = 2 * (x * vx + z * vz),
    cc = x * x + z * z - radius * radius;
  let low = Math.max(0, notBefore - a.t), high = dt;
  if (aa < 1e-12) { if (cc >= 0) return null; }
  else {
    const discriminant = bb * bb - 4 * aa * cc;
    if (discriminant <= 0) return null;
    const root = Math.sqrt(discriminant);
    low = Math.max(low, (-bb - root) / (2 * aa));
    high = Math.min(high, (-bb + root) / (2 * aa));
  }
  const py0 = playerYAt(player, a.t), py1 = playerYAt(player, b.t);
  if (Number.isFinite(from.y) && Number.isFinite(to.y) &&
      Number.isFinite(py0) && Number.isFinite(py1)) {
    const y = from.y - py0 - playerOffset, vy = (to.y - from.y - py1 + py0) / dt;
    if (Math.abs(vy) < 1e-10) { if (Math.abs(y) >= vertical) return null; }
    else {
      const first = (-vertical - y) / vy, last = (vertical - y) / vy;
      low = Math.max(low, Math.min(first, last)); high = Math.min(high, Math.max(first, last));
    }
  } else if (vertical === 1.5) return null; // Unknown height cannot prove a shot was consumed.
  return low < high && high > 0 ? { start: a.t + Math.max(0, low), end: a.t + high } : null;
}

function motionProjectileContact(...args) {
  return motionContactWindow(...args)?.start ?? Infinity;
}

function motionEscapeShot(path, bullet, player, start, end, seed, riskHorizon = 0) {
  let shot = seed ? { ...seed } : { x: bullet.x, y: bullet.y, z: bullet.z,
    vx: bullet.vx || 0, vy: bullet.vy || 0, vz: bullet.vz || 0, t: 0 };
  const homing = (bullet.flags & 3) === 3,
    speed = bullet.speed ?? Math.hypot(shot.vx, shot.vy, shot.vz),
    radius = (bullet.radius || 0.5) + (player.radius || 0.55),
    until = Math.min(end, bullet.life ?? end);
  let riskNear = { t: 0, distance: Infinity }, prefix;
  const outcome = result => ({ ...result, near: riskNear, prefix });
  const riskSegment = (a, b, from, to) => {
    if (!(riskHorizon > a.t)) return;
    let last = b, endPoint = to;
    if (last.t > riskHorizon) {
      const part = (riskHorizon - a.t) / (b.t - a.t);
      last = { x: a.x + (b.x - a.x) * part, z: a.z + (b.z - a.z) * part, t: riskHorizon };
      endPoint = { x: from.x + (to.x - from.x) * part, z: from.z + (to.z - from.z) * part,
        y: from.y == null ? undefined : from.y + (to.y - from.y) * part };
    }
    const near = projectileSegmentApproach(player, a, last, from, endPoint);
    if (near.distance < riskNear.distance) riskNear = near;
  };
  if (!homing) {
    for (let index = 1; index < path.length; index++) {
      const first = path[index - 1], last = path[index];
      if (last.t <= shot.t || first.t >= until) continue;
      const a = first.t < shot.t ? { ...trajectoryPoint(path, shot.t), t: shot.t } : first,
        b = last.t > until ? { ...trajectoryPoint(path, until), t: until } : last,
        from = { x: bullet.x + shot.vx * a.t, z: bullet.z + shot.vz * a.t,
          y: bullet.y == null ? undefined : bullet.y + shot.vy * a.t },
        to = { x: bullet.x + shot.vx * b.t, z: bullet.z + shot.vz * b.t,
          y: bullet.y == null ? undefined : bullet.y + shot.vy * b.t },
        consumed = motionProjectileContact(a, b, from, to, player, radius, 1.5),
        danger = motionProjectileContact(a, b, from, to, player, radius + 0.3, 1.8,
          Math.max(start, player.invulnerableFor || 0));
      riskSegment(a, b, from, to);
      if (Number.isFinite(danger) && danger <= consumed) return outcome({ blocked: true, contactTime: danger });
      if (Number.isFinite(consumed)) return outcome({ consumed: true });
    }
    return outcome({ ...shot, x: bullet.x + shot.vx * until, z: bullet.z + shot.vz * until,
      y: bullet.y == null ? undefined : bullet.y + shot.vy * until, t: until });
  }
  let segment = 1;
  while (segment < path.length && path[segment].t <= shot.t + 1e-9) segment++;
  while (shot.t < until - 1e-9) {
    while (segment < path.length && path[segment].t <= shot.t + 1e-9) segment++;
    const next = path[segment],
      dt = Math.min(1 / 60, until - shot.t, shot.t < 0.6 ? 0.6 - shot.t : Infinity),
      a = path[segment - 1]?.t === shot.t ? path[segment - 1] : { ...trajectoryPoint(path, shot.t), t: shot.t },
      b = next?.t === shot.t + dt ? next : { ...trajectoryPoint(path, shot.t + dt), t: shot.t + dt };
    if (homing) {
      const y = playerYAt(player, b.t), dx = b.x - shot.x, dz = b.z - shot.z,
        dy = Number.isFinite(shot.y) && Number.isFinite(y) ? y + 0.8 - shot.y : 0,
        length = Math.hypot(dx, dy, dz) || 1, blend = Math.min(1, dt * 1.7);
      shot.vx += (dx / length * speed - shot.vx) * blend;
      shot.vy += (dy / length * speed * 0.4 - shot.vy) * blend;
      shot.vz += (dz / length * speed - shot.vz) * blend;
    }
    const to = { x: shot.x + shot.vx * dt, z: shot.z + shot.vz * dt,
      y: shot.y == null ? undefined : shot.y + shot.vy * dt },
      consumed = motionProjectileContact(a, b, shot, to, player, radius, 1.5),
      danger = motionProjectileContact(a, b, shot, to, player, radius + 0.3, 1.8,
        Math.max(start, player.invulnerableFor || 0));
    riskSegment(a, b, shot, to);
    if (Number.isFinite(danger) && danger <= consumed) return outcome({ blocked: true, contactTime: danger });
    // Native hostile shots disappear on contact even when hurt() rejects it
    // during real iframes. Do not invent a second hit on the continuation.
    if (Number.isFinite(consumed)) return outcome({ consumed: true });
    Object.assign(shot, to, { t: b.t });
    if (Math.abs(shot.t - 0.6) < 1e-9) prefix = { ...shot };
  }
  return outcome(shot);
}

export function motionEscapeRoutes(path, player, enemies, walkable, bullets = [], hazards = [], forecasts) {
  const from = 0.6, until = 0.95, start = trajectoryPoint(path, from), speed = player.speed || 6.3,
    reach = speed * (until - from), frameDt = Number.isFinite(player.frameDt) && player.frameDt > 0
      ? Math.min(0.05, player.frameDt) : 1 / 60,
    immuneUntil = Math.max(from, player.invulnerableFor || 0),
    prefix = path.filter(point => point.t < from).concat({ ...start, t: from });
  const shots = bullets.filter(bullet => {
    if (bullet.flags & 4096 || bullet.flags != null && !(bullet.flags & 1) || (bullet.life ?? Infinity) <= from) return false;
    const radius = reach + (bullet.radius || 0.5) + (player.radius || 0.55) + 0.3;
    if ((bullet.flags & 3) === 3)
      return distance(bullet, start) <= radius + (bullet.speed ?? Math.hypot(bullet.vx || 0, bullet.vy || 0, bullet.vz || 0)) * until;
    return closestApproach(bullet.x + (bullet.vx || 0) * from - start.x,
      bullet.z + (bullet.vz || 0) * from - start.z, bullet.vx || 0, bullet.vz || 0,
      until - from).distance < radius;
  });
  const warnings = hazards.filter(hazard => {
    if (["friendly", "unknown"].includes(hazard.owner) || (hazard.life ?? Infinity) <= from) return false;
    if (["outside-circle", "unsafe-sectors", "sweeping-cone"].includes(hazard.shape)) return true;
    if (hazard.shape === "ring") return Math.max(0, hazard.eta || 0) <= until;
    const oneShot = hazard.oneShot === true || (!hazard.persistent && (hazard.x2 == null || (hazard.eta || 0) > 0));
    const impact = Math.max(0, (hazard.eta || 0) - (oneShot ? frameDt : 0));
    if (oneShot ? (hazard.eta || 0) < 0 || impact < (hazard.ignoresInvulnerability ? from : immuneUntil) || impact > until : impact > until) return false;
    return (hazard.x2 != null ? pointLineDistance(start, hazard) : distance(start, hazard)) <
      reach + (hazard.radius || 0) + (player.radius || 0.55) + 0.35;
  });
  // Bounded work at extreme density. An unexamined threat cannot certify an
  // open exit; the main trajectory risk still evaluates the complete field.
  if (shots.length > 20 || shots.filter(bullet => (bullet.flags & 3) === 3).length > 8 || warnings.length > 16) return 0;
  const seededShots = shots.map(bullet => ({ bullet,
    seed: forecasts?.get(bullet)?.prefix || motionEscapeShot(prefix, bullet, player, Infinity, from) }))
    .filter(({ seed }) => !seed.consumed);
  let open = 0;
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4, vx = Math.cos(angle) * speed,
      vz = Math.sin(angle) * speed, end = { x: start.x + vx * 0.35, z: start.z + vz * 0.35 };
    const dx = end.x - player.x, dz = end.z - player.z, length = Math.hypot(dx, dz);
    if (walkable && length > 0.01 &&
        !walkable(dx / length, dz / length, length, 0.95, playerYAt(player, 0.95))) continue;
    if (enemies.some(enemy => {
      const lag = Math.max(0, enemy.frameLag || 0);
      const near = closestApproach(enemy.x + (enemy.vx || 0) * Math.max(0, 0.6 - lag) - start.x,
        enemy.z + (enemy.vz || 0) * Math.max(0, 0.6 - lag) - start.z,
        (enemy.vx || 0) - vx, (enemy.vz || 0) - vz, 0.35);
      return near.distance < (enemy.radius || 0.7) + (player.radius || 0.55) + 0.3;
    })) continue;
    const continuation = [{ ...start, t: from }, { ...end, t: until }],
      fullPath = prefix.concat({ ...end, t: until });
    if (seededShots.some(({ bullet, seed }) =>
      motionEscapeShot(fullPath, bullet, player, from, until, seed).blocked)) continue;
    if (warnings.some(hazard => {
      if (["unsafe-sectors","sweeping-cone"].includes(hazard.shape)) return Number.isFinite(sectorHazardContact(
        hazard.shape==="sweeping-cone"?fullPath:continuation, hazard,
        { ...player, invulnerableFor: immuneUntil }, until, from));
      if (hazard.shape === "outside-circle") return outsideCircleWindows(continuation, hazard,
        { ...player, invulnerableFor: immuneUntil }, until, from).length > 0;
      if (hazard.shape === "ring") return Number.isFinite(ringContact(continuation, hazard,
        { ...player, invulnerableFor: immuneUntil }, until));
      const eta = hazard.eta || 0,
        oneShot = hazard.oneShot === true || (!hazard.persistent && (hazard.x2 == null || eta > 0)),
        impact = Math.max(0, eta - (oneShot ? frameDt : 0)),
        radius = (hazard.radius || 0) + (player.radius || 0.55) + 0.35;
      if (oneShot) {
        if (!hazardAffects(player, hazard, impact)) return false;
        const point = trajectoryPoint(continuation, impact);
        return (hazard.x2 != null ? pointLineDistance(point, hazard) : distance(point, hazard)) < radius;
      }
      return hazardTrajectoryDistance(continuation, hazard, player,
        Math.min(until, hazard.life ?? until), Math.max(immuneUntil, impact)) < radius;
    })) continue;
    open++;
  }
  return open;
}

// The same body windows feed both the coarse avoidance utility and the final
// damage upper bound. A proven air gap must not remain an infinite-height
// penalty in one layer after the damage layer has already ruled contact out.
function nativeBodyContactWindows(path,player,enemy,starts=0) {
  const lag=Math.max(0,enemy.frameLag||0),radius=(enemy.radius||.7)+(player.radius||.55)+.25,
    vertical=Number.isFinite(enemy.contactY)&&Number.isFinite(enemy.contactHeight)&&enemy.contactHeight>0?
      enemy.contactHeight:Infinity,windows=[];
  for(let index=1;index<path.length;index++){
    const first=path[index-1],last=path[index];if(last.t<=starts||first.t>1.2)continue;
    const cuts=lag>first.t&&lag<last.t?[first.t,lag,last.t]:[first.t,last.t];
    for(let cut=1;cut<cuts.length;cut++){
      const a=cuts[cut-1]===first.t?first:{...trajectoryPoint(path,cuts[cut-1]),t:cuts[cut-1]},
        b=cuts[cut]===last.t?last:{...trajectoryPoint(path,cuts[cut]),t:cuts[cut]},
        from={x:enemy.x+(enemy.vx||0)*Math.max(0,a.t-lag),z:enemy.z+(enemy.vz||0)*Math.max(0,a.t-lag),y:enemy.contactY},
        to={x:enemy.x+(enemy.vx||0)*Math.max(0,b.t-lag),z:enemy.z+(enemy.vz||0)*Math.max(0,b.t-lag),y:enemy.contactY},
        contact=motionContactWindow(a,b,from,to,player,radius,vertical,starts,0);
      if(contact&&contact.start<=1.2)windows.push(contact);
    }
  }
  return windows;
}

function motionDamageEstimate(path, player, enemies, bullets, hazards, frameDt, forecasts, bodyForecasts) {
  const horizon = 1.2, interval = 0.025, size = Math.round(horizon / interval) + 1,
    starts = Math.max(0, player.invulnerableFor || 0),
    amounts = new Float64Array(size), unknown = new Uint8Array(size), bodies = new Uint8Array(size),
    any = new Uint8Array(size);
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const point of path) {
    minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z); maxZ = Math.max(maxZ, point.z);
  }
  const overlaps = (x, z, vx, vz, radius, duration = horizon) =>
    Math.max(x, x + vx * duration) + radius >= minX && Math.min(x, x + vx * duration) - radius <= maxX &&
    Math.max(z, z + vz * duration) + radius >= minZ && Math.min(z, z + vz * duration) - radius <= maxZ;
  const record = (threat, start, end = start, body = false) => {
    start = Math.max(threat.ignoresInvulnerability ? 0 : starts, start); end = Math.min(horizon, end);
    if (start > end || end < 0 || !Number.isFinite(start)) return;
    const known = Number.isFinite(threat.damage) && threat.damage >= 0,
      damage = threat.lethal === true && Number.isFinite(player.hp)
        ? Math.max(known ? threat.damage : 0, player.hp + Math.max(0, player.shield || 0)) : known ? threat.damage : 0;
    // Rounding both endpoints down cannot miss two hits >=.45s apart. It may
    // include a borderline extra hit, so this is an upper-bound forecast.
    for (let index = Math.max(0, Math.floor(start / interval)); index <= Math.min(size - 1, Math.floor((end + 1e-9) / interval)); index++) {
      amounts[index] = Math.max(amounts[index], damage);
      unknown[index] ||= !known && threat.lethal !== true ? 1 : 0;
      any[index] ||= damage > 0 || !known ? 1 : 0;
      bodies[index] ||= body && (damage > 0 || !known) ? 1 : 0;
    }
  };
  if (starts <= horizon || hazards.some(h=>h.ignoresInvulnerability)) {
    for (const enemy of enemies) {
      const radius=(enemy.radius||.7)+(player.radius||.55)+.25;
      if(!overlaps(enemy.x,enemy.z,enemy.vx||0,enemy.vz||0,radius))continue;
      const contacts=bodyForecasts?.get(enemy)||nativeBodyContactWindows(path,player,enemy,starts);
      for(const contact of contacts)record(enemy,contact.start,contact.end,true);
    }
    for (const bullet of bullets) {
      if (bullet.flags & 4096 || bullet.flags != null && !(bullet.flags & 1) || !(bullet.life == null || bullet.life > 0)) continue;
      if ((bullet.flags & 3) !== 3 && !overlaps(bullet.x, bullet.z, bullet.vx || 0, bullet.vz || 0,
          (bullet.radius || 0.5) + (player.radius || 0.55) + 0.3, Math.min(horizon, bullet.life ?? horizon))) continue;
      const hit = forecasts?.get(bullet) || motionEscapeShot(path, bullet, player, starts, horizon);
      if (hit.blocked) record(bullet, hit.contactTime);
    }
    for (const hazard of hazards) {
      if (["friendly", "unknown"].includes(hazard.owner)) continue;
      if (["unsafe-sectors","sweeping-cone"].includes(hazard.shape)) {
        const hit = sectorHazardContact(path, hazard, player, horizon);
        if (Number.isFinite(hit)) record(hazard, hit);
        continue;
      }
      if (hazard.shape === "outside-circle") {
        for (const window of outsideCircleWindows(path, hazard, player, horizon))
          record(hazard, window.start, window.end);
        continue;
      }
      if (hazard.shape === "ring") {
        const hit = ringContact(path, hazard, player, horizon);
        if (Number.isFinite(hit)) record(hazard, hit);
        continue;
      }
      const eta = hazard.eta || 0,
        oneShot = hazard.oneShot === true || (!hazard.persistent && (hazard.x2 == null || eta > 0)),
        impact = Math.max(0, eta - (oneShot ? frameDt : 0)),
        radius = (hazard.radius || 0) + (player.radius || 0.55) + 0.35;
      if (oneShot) {
        if (eta < 0 || impact < (hazard.ignoresInvulnerability ? 0 : starts) || impact > horizon || !hazardAffects(player, hazard, impact)) continue;
        const point = trajectoryPoint(path, impact);
        if ((hazard.x2 != null ? pointLineDistance(point, hazard) : distance(point, hazard)) < radius)
          record(hazard, impact);
        continue;
      }
      const active = Math.max(starts, impact), end = Math.min(horizon, hazard.life ?? horizon);
      for (let index = 1; index < path.length; index++) {
        const from = Math.max(active, path[index - 1].t), to = Math.min(end, path[index].t);
        if (to <= from || ![from, (from + to) / 2, to].some(time => hazardAffects(player, hazard, time))) continue;
        const a = { ...trajectoryPoint(path, from), t: from }, b = { ...trajectoryPoint(path, to), t: to };
        if (hazard.x2 != null) {
          if (segmentLineDistance(a, b, hazard) < radius) record(hazard, from, to);
        } else {
          const contact = motionContactWindow(a, b, hazard, hazard, player, radius, Infinity, active);
          if (contact) record(hazard, contact.start, contact.end);
        }
      }
    }
  }
  const cooldown = Math.round(0.45 / interval), damage = new Float64Array(size),
    hits = new Uint8Array(size), bodyHits = new Uint8Array(size), unknownHits = new Uint8Array(size);
  for (let index = 0; index < size; index++) {
    const previous = index ? index - 1 : -1, beforeHit = index - cooldown;
    damage[index] = Math.max(previous < 0 ? 0 : damage[previous], amounts[index] + (beforeHit < 0 ? 0 : damage[beforeHit]));
    hits[index] = Math.max(previous < 0 ? 0 : hits[previous], any[index] + (beforeHit < 0 ? 0 : hits[beforeHit]));
    bodyHits[index] = Math.max(previous < 0 ? 0 : bodyHits[previous], bodies[index] + (beforeHit < 0 ? 0 : bodyHits[beforeHit]));
    unknownHits[index] = Math.max(previous < 0 ? 0 : unknownHits[previous], unknown[index] + (beforeHit < 0 ? 0 : unknownHits[beforeHit]));
  }
  const knownDamage = damage.at(-1), shield = Number.isFinite(player.shield) ? Math.max(0, player.shield) : 0,
    healthDamage = Math.max(0, knownDamage - shield), uncertain = unknownHits.at(-1) > 0;
  return { knownDamage, healthDamage, unknownDamage: uncertain, unknownHits: unknownHits.at(-1),
    hitCount: hits.at(-1), bodyHits: bodyHits.at(-1), repeatContacts: Math.max(0, bodyHits.at(-1) - 1),
    lethal: Number.isFinite(player.hp) && player.hp > 0 && healthDamage >= player.hp };
}

function motionSafetyDifference(a, b) {
  if (!!a.collision !== !!b.collision) return a.collision ? 1 : -1;
  const first = a.safety, second = b.safety;
  if (!first || !second) return 0;
  if (!!first.hardDanger !== !!second.hardDanger) return first.hardDanger ? 1 : -1;
  const rank = safety => safety.lethal ? 3 : safety.unknownDamage ? 2 : 0,
    difference = rank(first) - rank(second);
  if (difference) return difference;
  if (first.unknownDamage && first.unknownHits !== second.unknownHits) return first.unknownHits - second.unknownHits;
  const firstCost = a.budgetedDamage ? 0 : first.healthDamage,
    secondCost = b.budgetedDamage ? 0 : second.healthDamage;
  if (Math.abs(firstCost - secondCost) > 0.25) return firstCost - secondCost;
  const repeats = (a.budgetedDamage ? 0 : first.repeatContacts) - (b.budgetedDamage ? 0 : second.repeatContacts);
  return repeats || (a.budgetedDamage ? 0 : first.hitCount) - (b.budgetedDamage ? 0 : second.hitCount);
}

export function compareMotionSafety(a, b) {
  const safety=motionSafetyDifference(a,b);
  if(safety)return safety;
  const approach=a.bossRetreat===true&&b.bossRetreat===true
    ?(a.bossApproach||0)-(b.bossApproach||0):0;
  if(Math.abs(approach)>.025)return approach;
  return (a.score ?? a.risk ?? 0) - (b.score ?? b.risk ?? 0) ||
    (a.risk || 0) - (b.risk || 0);
}

// A strategy for an exact reviewed native predicate; never a completion flag.
// Native saved lk counters/bitmaps are the only source of completed mastery.
export function masteryExecutionState(run,plan={},data={}) {
  const route=plan?.mastery || (plan?.challenge?{mode:plan.mode,...plan.challengeScope,constraints:plan.challenge}:null),
    constraints=route?.constraints;
  if(!constraints||!run?.player)return {active:false,avoidXp:false,holdFinish:false,hurry:false};
  // Older reviewed contexts remain solo. Current explicitly reviewed routes
  // carry their own cooperative permission; maxHits stays native solo-only.
  if(run.coop&&plan.mastery&&(route.allowCoop!==true||Number.isFinite(route.constraints?.maxHits)))return {active:false,avoidXp:false,holdFinish:false,hurry:false,
    reason:"此专属挑战尚无当前合作计数许可或要求单人受击上限；本合作对局正常推进，保留目标供兼容对局完成"};
  const mode=typeof run.mode==="string"?run.mode:run.tower?"tower":run.endless?"endless":"standard";
  if(route.member&&Number(run.startSpecies)!==route.member||route.mode&&route.mode!==mode||
      route.biome&&run.biome?.id!==route.biome||Number.isInteger(route.tier)&&Number(run.tier)<route.tier)
    return {active:false,avoidXp:false,holdFinish:false,hurry:false,reason:"当前原生对局与下一项专属挑战的角色/模式/地图/难度不同；保留本局正常完成，保存后执行目标"};
  const p=run.player,next=run.nextEvo,species=Number(p.speciesId),stageCount=reviewedStandardStageCount(run.biome),
    finalCleared=mode==="standard"&&Number.isInteger(stageCount)&&Number.isInteger(run.stage)&&run.stage>=stageCount&&
      run.stageCleared===true&&run.regionCleared===true&&!run.boss?.alive&&(run.state!=="over"||run.victory===true),
    clearSpecies=finalCleared&&constraints.finalSpeciesAtClear===true&&Number.isInteger(run.clearSpecies)&&run.clearSpecies>0?run.clearSpecies:null,
    finalSpecies=clearSpecies??species,
    clearHp=finalCleared&&typeof run.clearHp==="number"&&Number.isFinite(run.clearHp)&&run.clearHp>=0&&run.clearHp<=1?run.clearHp:null,
    liveHp=p.maxHp>0?p.hp/p.maxHp:NaN,
    //059 endInfo(won) takes the minimum of BOTH live rounded HP and the
    //recorded Boss-clear HP. The snapshot is a ceiling, never frozen HP.
    endHp=clearHp!==null?Math.min(Math.round(Math.max(0,liveHp)*100)/100,clearHp):liveHp,
    initialHold=constraints.initialSpeciesHold,
    initialHoldRequired=initialHold&&Number.isInteger(initialHold.species)&&Number.isFinite(initialHold.seconds)&&initialHold.seconds>0,
    elapsed=Math.max(0,Number(run.time)||0),firstEvolution=typeof run.firstEvoAt==='number'&&Number.isFinite(run.firstEvoAt)&&run.firstEvoAt>=0?run.firstEvoAt:null,
    initialHoldSeconds=initialHoldRequired?firstEvolution!==null?Math.min(elapsed,firstEvolution):species===initialHold.species?elapsed:0:null,
    initialHoldFailed=!!initialHoldRequired&&(Number(run.startSpecies)!==initialHold.species||species!==initialHold.species&&initialHoldSeconds<initialHold.seconds),
    initialHoldPending=!!initialHoldRequired&&!initialHoldFailed&&initialHoldSeconds<initialHold.seconds,
    ids=initialHoldPending?[initialHold.species]:Array.isArray(constraints.finalSpecies)?constraints.finalSpecies:[],
    maximum=Number(constraints.maxFinalSpecies),allowed=id=>ids.length?ids.includes(id):Number.isFinite(maximum)&&maximum>0?id<=maximum:true;
  const leadsToAllowed=id=>ids.some(target=>{const seen=new Set();for(let at=target;Number.isInteger(at)&&!seen.has(at);at=data.data?.get?.(at)?.evoFrom){if(at===id)return true;seen.add(at);}return false;});
  const nextForms=next?.to===-1?(p.roster?.branch || []):next?[next.to]:[],
    invalidFinal=initialHoldFailed||!allowed(finalSpecies)&&!leadsToAllowed(finalSpecies),
    blocksNext=clearSpecies===null&&nextForms.length>0&&!nextForms.some(id=>allowed(id)||leadsToAllowed(id)),
    avoidXp=!invalidFinal&&blocksNext&&Number(p.level)>=Math.max(1,Number(next.level)-2),
    minTime=Number(constraints.minTime)||0,maxTime=Number(constraints.maxTime)||0,
    hits=Number(run.stats?.hits),minHits=Number(constraints.minHits),maxHits=Number(constraints.maxHits),
    needsHits=Number.isFinite(minHits)&&!(hits>minHits),hpFloor=typeof constraints.endHpMin==="number"?constraints.endHpMin:NaN,
    hpCeiling=Number(constraints.endHpMax),hpConditionImpossible=clearHp!==null&&Number.isFinite(hpFloor)&&clearHp<=hpFloor,
    endHpProtectedByClear=clearHp!==null&&Number.isFinite(hpCeiling)&&hpCeiling>0&&clearHp<hpCeiling&&
      (!Number.isFinite(hpFloor)||clearHp>hpFloor),
    avoidHealing=!invalidFinal&&!hpConditionImpossible&&!endHpProtectedByClear&&(run.regionCleared||Number(run.stage)>=3)&&Number.isFinite(hpCeiling)&&hpCeiling>0,
    needsLowHp=!invalidFinal&&!hpConditionImpossible&&(run.regionCleared||Number(run.stage)>=3)&&Number.isFinite(hpCeiling)&&hpCeiling>0&&
      !(endHp<hpCeiling-(clearHp===null?.005:0)),
    needsHighHp=!invalidFinal&&!hpConditionImpossible&&Number.isFinite(hpFloor)&&!(endHp>hpFloor),
    moves=(p.moves||[]).filter(Boolean),
    nativeShareDamage=move=>constraints.damageShare?.includeFusionParents===true?
      Math.max(0,Math.round(Math.min(1e300,Number.isFinite(move.damageDone)?move.damageDone:0))):Math.max(0,Number(move.damageDone)||0),
    denominator=moves.reduce((sum,move)=>sum+nativeShareDamage(move),0),
    shareKey=constraints.damageShare?.key,first=moves.find(move=>move.def?.key===shareKey),
    numerator=constraints.damageShare?.includeFusionParents===true?moves.reduce((sum,move)=>sum+(
      move.def?.key===shareKey||(move.parents||[]).some(id=>(data.moveDef?.(id)||data.data?.moves?.get?.(id))?.key===shareKey)
        ?nativeShareDamage(move):0),0):Math.max(0,Number(first?.damageDone)||0),
    damageShare=denominator>0?numerator/denominator:0;
  return {active:true,constraints,avoidXp,blocksNext,levelLimit:blocksNext?Number(next.level)-1:null,
    holdFinish:!invalidFinal&&!hpConditionImpossible&&!!run.regionCleared&&(minTime>0&&(constraints.minTimeInclusive===true?(Number(run.time)||0)<minTime:(Number(run.time)||0)<=minTime)||needsHits||needsLowHp||needsHighHp),
    hurry:maxTime>0||Number.isFinite(maxHits),needsHits,needsLowHp,needsHighHp,avoidHealing,endHp,clearHp,clearSpecies,endHpProtectedByClear,hpConditionImpossible,damageShare,shareKey,
    invalidFinal,initialHoldSeconds,initialHoldPending,initialHoldFailed,
    exposure:!invalidFinal&&(needsHits||needsLowHp)?{reserveHp:needsLowHp?Math.max(1,p.maxHp*.015):p.maxHp*.6,
      healthBudget:Math.max(0,Math.min(p.maxHp*.08,p.hp-(needsLowHp?Math.max(1,p.maxHp*.015):p.maxHp*.6)))}:null};
}

export function masteryXpRouteAllowed(start,end,circles=[]) {
  for(const circle of circles) {
    const before=Math.hypot(start.x-circle.x,start.z-circle.z),after=Math.hypot(end.x-circle.x,end.z-circle.z);
    if(before<circle.radius){if(after<before+.01)return false;continue;}
    const dx=end.x-start.x,dz=end.z-start.z,length=dx*dx+dz*dz,
      at=length?Math.max(0,Math.min(1,((circle.x-start.x)*dx+(circle.z-start.z)*dz)/length)):0;
    if(Math.hypot(start.x+at*dx-circle.x,start.z+at*dz-circle.z)<circle.radius)return false;
  }
  return true;
}

function motionHazardExposure(path, hazard, player, start, end, radius) {
  let duration = 0;
  for (let index = 1; index < path.length; index++) {
    const a = path[index - 1], b = path[index];
    const from = Math.max(start, a.t), to = Math.min(end, b.t);
    if (to <= from) continue;
    const time = (from + to) / 2, point = trajectoryPoint(path, time);
    if (hazardAffects(player, hazard, time) &&
        (hazard.x2 != null ? pointLineDistance(point, hazard) : distance(point, hazard)) < radius)
      duration += to - from;
  }
  return duration;
}

function bossEscapeTarget(player,bosses) {
  const angles=bosses.map(enemy=>Math.atan2(enemy.z-player.z,enemy.x-player.x)).sort((a,b)=>a-b);
  let heading=angles[0]+Math.PI,gap=-1;
  for(let index=0;index<angles.length;index++){
    const next=index+1<angles.length?angles[index+1]:angles[0]+Math.PI*2,
      width=next-angles[index];
    if(width>gap){gap=width;heading=angles[index]+width/2;}
  }
  // This is only an input intention through the widest observed angular gap.
  // The full native body/shot/wall forecast still decides whether it is usable.
  return {x:player.x+Math.cos(heading)*8,z:player.z+Math.sin(heading)*8};
}

export function chooseMotion(state) {
  const { enemies = [], bullets: observedBullets = [], hazards = [] } = state;
  const bullets = observedBullets.some(bullet => bullet.flags & 4096)
    ? observedBullets.filter(bullet => !(bullet.flags & 4096)) : observedBullets;
  let p = state.traversal?.path ? { ...state.player, trajectoryY: state.traversal.path, predictJump: true } :
    state.predictJump ? { ...state.player, predictJump: true,
      jumpVelocity: state.jumpVelocity ?? state.player.jumpVelocity } : state.player;
  const glideVertical = !p.trajectoryY && nativeGlideForecast(p);
  if(glideVertical)p={...p,trajectoryY:glideVertical};
  const objective = motionObjective({ ...state, player: p });
  const bosses=state.bossRetreat===true?enemies.filter(enemy=>enemy.boss===true):[],
    bossObjective=state.bossApproachAllowed===true,
    circleReturn=hazards.some(hazard=>hazard.shape==="outside-circle"&&(hazard.eta||0)<=1.2&&
      !(hazard.life<=0)&&(hazard.safeCircles||[hazard]).every(circle=>{
        const center=circle.centerPath?.length?trajectoryPoint(circle.centerPath,Math.max(0,hazard.eta||0)):circle;
        return Number.isFinite(circle.radius)&&Math.hypot(p.x-center.x,p.z-center.z)>circle.radius-.3;
      })),
    constrainBossApproach=bosses.length>0&&!bossObjective&&!state.bossBoundaryDetour&&!state.bossEscapeDetour&&!circleReturn;
  const target=bosses.length&&!bossObjective&&Math.hypot(state.target.x-p.x,state.target.z-p.z)<=1
    ?bossEscapeTarget(p,bosses):state.target;
  const travel=state.travelCommitment?.active===true&&!objective,
    urgentTravel=travel&&state.travelCommitment.urgent===true,
    travelBudget=travel&&Number.isFinite(p.hp)&&Number.isFinite(p.maxHp)&&(urgentTravel||p.hp>p.maxHp*.42)?
      {reserve:urgentTravel?1:Math.max(1,p.maxHp*.15),regen:0,
        budget:urgentTravel?Math.max(0,p.hp-1):Math.min(p.hp*.55,p.hp-Math.max(1,p.maxHp*.15))}:null;
  const crowdEscape = state.crowdEscape?.active === true ? state.crowdEscape : null,
    escapeBudget = crowdEscape && state.safeMode === false && Number.isFinite(p.hp) && Number.isFinite(p.maxHp) &&
      Number.isFinite(crowdEscape.healthBudget) && crowdEscape.healthBudget > 0 ? {
        reserve: Math.max(p.maxHp * .6, Number(crowdEscape.reserveHp) || 0), regen: 0,
        budget: Math.min(p.maxHp * .06, crowdEscape.healthBudget),
      } : null,
    damageBudget = objective || travelBudget || escapeBudget,
    crowdBodies = crowdEscape && Array.isArray(crowdEscape.bodies) ? crowdEscape.bodies.slice(0, 48) : [];
  const nearbyEnemies = enemies.filter(e => distance(p, e) < 16)
    .sort((a, b) => distance(p, a) - distance(p, b)).slice(0, 8);
  const speed = p.speed || 6.3,
    damageStarts = Math.max(0, p.invulnerableFor || 0),
    frameDt =
      Number.isFinite(p.frameDt) && p.frameDt > 1e-6
        ? Math.min(0.05, p.frameDt)
        : 1 / 60,
    dx = target.x - p.x,
    dz = target.z - p.z,
    goalAngle = Math.atan2(dz, dx),
    candidates = [{ x: 0, z: 0 }];
  for (let i = 0; i < 24; i++) {
    const angle = goalAngle + (i * Math.PI) / 12;
    candidates.push({ x: Math.cos(angle), z: Math.sin(angle) });
  }
  const addAngle = angle => {
    const direction = { x: Math.cos(angle), z: Math.sin(angle) };
    if (!candidates.some(dir => Math.hypot(dir.x - direction.x, dir.z - direction.z) < 0.0001))
      candidates.push(direction);
  };
  addAngle(goalAngle - Math.PI / 48);
  addAngle(goalAngle + Math.PI / 48);
  if (state.previous && Math.hypot(state.previous.x, state.previous.z) > 0.1) {
    const angle = Math.atan2(state.previous.z, state.previous.x);
    addAngle(angle); addAngle(angle - Math.PI / 36); addAngle(angle + Math.PI / 36);
  }
  for (const enemy of nearbyEnemies.slice(0, 2)) {
    const angle = Math.atan2(enemy.z - p.z, enemy.x - p.x);
    addAngle(angle - Math.PI / 2); addAngle(angle + Math.PI / 2);
  }
  let best = null, previousChoice = null;
  const planningCandidates = state.traversal?.path ? [state.traversal.direction] :
    state.committedDirection ? [state.committedDirection] :
    objective && !state.predictDash && !p.predictJump && p.grounded !== false &&
    !(p.slideT > 0) && !(p.forceFor > 0) && !hasExternalForces(p) && Math.hypot(p.kx || 0, p.kz || 0) <= 0.00001
    ? candidates.flatMap(dir => dir.x || dir.z ? [dir, { ...dir, brake: true }] : [dir])
    : candidates;
  if (!objective && !state.traversal?.path && !state.committedDirection && !state.predictDash && !p.predictJump)
    planningCandidates.push(...nearGoalCommits(p, target, frameDt));
  for (const dir of planningCandidates) {
    if (state.predictDash && !dir.x && !dir.z) continue;
    const path = state.traversal?.path || motionCandidatePath(p, dir, !!state.predictDash, dir.brake ? objective : null);
    let risk = 0,
      collision = false, incomingDamage = 0, unknownDamage = false, hardDanger = false;
    const shotForecasts = new Map(),bodyForecasts=new Map();
    const contactDamage = (threat, duration = 0) => {
    if (!damageBudget) return;
      if (threat.lethal === true || !Number.isFinite(threat.damage) || threat.damage < 0)
        unknownDamage = true;
      else incomingDamage += threat.damage * Math.max(1,
        Math.ceil(duration / Math.max(0.05, Number(threat.damageInterval) || 0.45)));
    };
    if (typeof state.pathAllowed === "function" && !state.pathAllowed(path)) {
      // Explicit route constraints (for example not lighting a Tower candle)
      // are separate from damage estimates and never invent native hazards.
      risk += 100000; collision = true;
    }
    if (state.walkable && !collision) {
      // Check the committed slide / airborne path too, not only the requested
      // stick direction, which cannot cancel the current momentum.
      for (const point of path) {
        if (
          point.t < 0.1 ||
          point.t > (state.predictDash || p.slideT > 0 ? 0.6 : 0.4)
        )
          continue;
        const qx = point.x - p.x,
          qz = point.z - p.z,
          length = Math.hypot(qx, qz);
        if (
          length > 0.01 &&
          !state.walkable(
            qx / length,
            qz / length,
            length,
            point.t,
            playerYAt(p, point.t),
          )
        ) {
          risk += 100000;
          collision = true;
          break;
        }
      }
    }
    if (collision && best && !best.collision) continue;
    for (const e of enemies) {
      if(Number.isFinite(e.contactY)&&Number.isFinite(e.contactHeight)){
        const contacts=nativeBodyContactWindows(path,p,e,damageStarts);bodyForecasts.set(e,contacts);
        if(!contacts.length)continue;
      }
      const radius = (e.radius || 0.7) + (p.radius || 0.55) + 0.25,
        near = trajectoryApproach(
          path,
          e,
          Math.min(1.2, Math.max(0.65, damageStarts + 0.3)),
          damageStarts,
        ),
        currentDistance = Math.hypot(e.x - p.x, e.z - p.z);
      if (damageStarts <= 0 && currentDistance < radius)
        // The present overlap is identical for every input. Applying the
        // time-to-hit discount to its future minimum used to reward going
        // deeper into a body because that minimum happened a little later.
        risk +=
          (1000 * (1 + (radius - currentDistance) * 2)) / 0.2 +
          Math.max(0, currentDistance - near.distance) * 10000;
      else if (near.distance < radius)
        risk += (1000 * (1 + (radius - near.distance) * 2)) / (0.2 + near.t);
      else if (damageStarts <= 0 && near.distance < radius + 1.4)
        risk += 8 / Math.max(0.15, near.distance - radius);
      if (damageStarts <= 0 && currentDistance < radius) {
        const future = trajectoryPoint(path, 0.3),
          clearance = Math.hypot(
            e.x + (e.vx || 0) * Math.max(0, 0.3 - (e.frameLag || 0)) - future.x,
            e.z + (e.vz || 0) * Math.max(0, 0.3 - (e.frameLag || 0)) - future.z,
          );
        risk += Math.max(0, radius + 0.5 - clearance) * 1200;
      }
      if (near.distance < radius || damageStarts <= 0 && currentDistance < radius)
        contactDamage(e, Math.max(0, 0.65 - Math.max(damageStarts, near.t)));
    }
    for (const b of bullets) {
      const horizon = Math.min(0.85, b.life ?? 0.85);
      if (horizon <= 0) continue;
      const forecast = shotForecasts.get(b) || motionEscapeShot(path, b, p, damageStarts, 1.2, undefined, horizon),
        near = forecast.near;
      shotForecasts.set(b, forecast);
      const radius = (b.radius || 0.5) + (p.radius || 0.55) + 0.3;
      if (near.distance < radius) {
        risk += (4000 * (1 + radius - near.distance)) / (0.12 + near.t);
        contactDamage(b);
      }
    }
    for (const h of hazards) {
      if (["unsafe-sectors","sweeping-cone"].includes(h.shape)) {
        const hit = sectorHazardContact(path, h, p);
        if (Number.isFinite(hit)) { risk += 12000 / (0.2 + hit); contactDamage(h); }
        continue;
      }
      if (h.shape === "outside-circle") {
        const windows = outsideCircleWindows(path, h, p),
          exposure = windows.reduce((sum, window) => sum + window.end - window.start, 0),
          futureTime = Math.min(0.65, h.life ?? 0.65),
          future = trajectoryPoint(path, futureTime),
          circles = Array.isArray(h.safeCircles) ? h.safeCircles : [h],
          outside = circles.length ? Math.min(...circles.map(circle => {
            const center = circle.centerPath?.length ? trajectoryPoint(circle.centerPath, futureTime) : circle;
            return Math.max(0, distance(future, center) - circle.radius);
          })) : 0;
        // Price time spent in the mist and progress back toward the circle.
        // Known lethal attacks still win the safety comparison over this chip.
        risk += h.oneShot ? windows.length ? 12000 / (0.2 + windows[0].start) : 0 : exposure * 120 + outside * 25;
        if (windows.length) contactDamage(h, exposure);
        continue;
      }
      if (h.shape === "ring") {
        const contact = ringContact(path, h, p);
        if (Number.isFinite(contact)) { risk += 12000 / (0.2 + contact); contactDamage(h); }
        continue;
      }
      const eta = h.eta || 0,
        oneShot =
          h.oneShot === true || (!h.persistent && (h.x2 == null || eta > 0));
      // Native simulate() executes run.later callbacks before Player.update.
      // A warning expiring during the upcoming frame hits the current position;
      // later warnings have one fewer frame of player movement before impact.
      // Their remaining VFX are not another damaging attack after that callback.
      if (oneShot && eta < 0) continue;
      const impactTime = oneShot
        ? Math.max(0, eta - frameDt)
        : Math.max(0, eta);
      if (impactTime > 1.2) continue;
      if (oneShot && !h.ignoresInvulnerability && impactTime < damageStarts) continue;
      const t = Math.min(1.2, impactTime),
        radius = h.radius + (p.radius || 0.55) + 0.35,
        activeStart = Math.max(
          damageStarts,
          h.persistent ? Math.max(0, h.eta || 0) : 0,
        ),
        activeHorizon = Math.min(
          1.2,
          Math.max(0.65, activeStart + 0.3),
          h.life ?? Infinity,
        );
      let d;
      if (h.x2 != null) {
        if (oneShot)
          d = hazardAffects(p, h, t)
            ? pointLineDistance(trajectoryPoint(path, t), h)
            : Infinity;
        else if (
          activeStart <= 0 &&
          h.persistent &&
          pointLineDistance(p, h) < radius &&
          hazardAffects(p, h, 0)
        ) {
          const escapeTime = Math.min(0.5, h.life ?? 0.5);
          d = hazardAffects(p, h, escapeTime)
            ? pointLineDistance(trajectoryPoint(path, escapeTime), h)
            : Infinity;
        } else
          d = hazardTrajectoryDistance(path, h, p, activeHorizon, activeStart);
      } else if (h.persistent) {
        if (
          activeStart <= 0 &&
          Math.hypot(p.x - h.x, p.z - h.z) < radius &&
          hazardAffects(p, h, 0)
        ) {
          const future = trajectoryPoint(path, Math.min(0.5, h.life || 0.5));
          d = Math.hypot(future.x - h.x, future.z - h.z);
        } else
          d = hazardTrajectoryDistance(path, h, p, activeHorizon, activeStart);
      } else {
        const future = trajectoryPoint(path, t);
        d = hazardAffects(p, h, t)
          ? Math.hypot(future.x - h.x, future.z - h.z)
          : Infinity;
      }
      const currentContact = h.persistent && activeStart <= 0 && hazardAffects(p, h, 0) &&
        (h.x2 != null ? pointLineDistance(p, h) : Math.hypot(p.x - h.x, p.z - h.z)) < radius;
      if (d < radius) {
        risk += (5000 * (1 + radius - d)) / (0.25 + t);
      }
      if (d < radius || currentContact)
        contactDamage(h, h.persistent && objective
          ? motionHazardExposure(path, h, p, activeStart, activeHorizon, radius) + frameDt : 0);
    }
    const cover = state.cover;
    if (
      cover &&
      Number.isFinite(cover.eta) &&
      cover.eta >= 0 &&
      cover.eta <= 1.2 &&
      typeof cover.isHidden === "function"
    ) {
      const impactTime = Math.max(0, cover.eta - frameDt),
        impact = trajectoryPoint(path, impactTime),
        y = playerYAt(p, impactTime) ?? 0;
      if (!cover.isHidden(impact.x, y, impact.z)) { risk += 500000; hardDanger = true; }
    }
    let physicalBodyCost = 0;
    if (crowdEscape) for (const time of [.35, .65]) {
      const point = trajectoryPoint(path, time), feet = playerYAt(p, time);
      for (const body of crowdBodies) {
        if (Number.isFinite(feet) && !(feet < body.y + body.hgt * .8 && feet > body.y - 1)) continue;
        const radius = ((body.radius || .7) + (p.radius || .55)) * .8,
          overlap = radius - Math.hypot(body.x + (body.vx || 0) * time - point.x,
            body.z + (body.vz || 0) * time - point.z);
        physicalBodyCost += Math.max(0, overlap) * 45 * Math.max(1, body.weight || 1);
      }
    }
    const rawRisk = risk,
      future = trajectoryPoint(path, 0.55),
      progress = Math.hypot(dx, dz) - Math.hypot(target.x - future.x, target.z - future.z),
      turn = state.previous ? (dir.x * state.previous.x + dir.z * state.previous.z) * 0.8 : 0,
      // Measure our own closing against the observed body, separately from a
      // Boss chasing us. Native motion/contact forecasting still ranks actual
      // damage first; attack reach cannot buy permission to approach.
      bossDistances=bosses.map(enemy=>({enemy,before:Math.hypot(p.x-enemy.x,p.z-enemy.z),
        after:Math.hypot(future.x-enemy.x,future.z-enemy.z)})),
      bossApproach=constrainBossApproach?Math.max(0,...bossDistances.map(row=>row.before-row.after)):0,
      bossUtility=bossObjective||state.bossBoundaryDetour||state.bossEscapeDetour||circleReturn?0:bossDistances.reduce((sum,row)=>sum-
        (row.after-row.before)*(Math.max(row.enemy.nativeSpeed||0,Math.hypot(row.enemy.vx||0,row.enemy.vz||0))>=speed?10:6),0)/Math.max(1,bossDistances.length),
      cheapUtility = -progress * (travel ? 24 : crowdEscape ? 8 : 3) - turn + physicalBodyCost+bossUtility;
    // Escape-room cost is nonnegative. If this lower bound already loses to a
    // fully examined zero-hit choice, the old full escape scan would reject it
    // too. Prune before repeating eight expensive footprint paths, never by
    // omitting a threat or shortening its safety horizon.
    if (!damageBudget && best && !best.collision && !best.safety.unknownDamage &&
        best.safety.hitCount === 0 && best.safety.healthDamage === 0 &&
        bossApproach>=(best.bossApproach||0)-.025 && risk + cheapUtility > best.score + 0.2) continue;
    const occupiedField = enemies.length || bullets.length || hazards.length,
      escapeRoutes = occupiedField
        ? motionEscapeRoutes(path, p, nearbyEnemies, state.walkable, bullets, hazards, shotForecasts) : 0,
      trapPenalty = nearbyEnemies.length || bullets.length || hazards.length
        ? (escapeRoutes ? (8 - escapeRoutes) * 2 : 300) : 0,
      utility = trapPenalty + cheapUtility;
    // A proven zero-hit route cannot lose the safety comparison to any
    // candidate, and a worse utility cannot improve it. Keep the tiny previous
    // heading tie window for continuity; do not prune risky alternatives.
    if (!damageBudget && best && !best.collision && !best.safety.unknownDamage &&
        best.safety.hitCount === 0 && best.safety.healthDamage === 0 &&
        bossApproach>=(best.bossApproach||0)-.025 && risk + utility > best.score + 0.2) continue;
    const safety = motionDamageEstimate(path, p, enemies, bullets, hazards, frameDt, shotForecasts,bodyForecasts);
    safety.hardDanger = hardDanger;
    const hpDamage = safety.healthDamage;
    // Regeneration is credited only over this short horizon, never to survive
    // a lethal hit. A ready Ultimate is not immunity and adds no health budget.
    const netDamage = Math.max(0, hpDamage - (damageBudget?.regen || 0) * 0.35);
    const acceptsDamage = !!damageBudget && !safety.unknownDamage && !unknownDamage && !hardDanger && !collision &&
      hpDamage < p.hp && p.hp - hpDamage >= damageBudget.reserve && hpDamage <= damageBudget.budget&&
      (!travel||safety.hitCount<=safety.bodyHits);
    if (acceptsDamage) risk = hpDamage > 0 ? netDamage * (travel ? .25 : 12) : Math.min(risk, 32);
    else if (objective && (incomingDamage > 0 || unknownDamage)) risk = Math.max(risk, 500);
    let objectivePenalty = 0, objectiveHeld = false;
    if (objective) {
      const radius = Math.max(0.1, objective.radius - 0.15);
      let outside = 0;
      for (const point of path) if (point.t <= 0.8)
        outside += Math.max(0, distance(point, objective.center) - radius);
      objectiveHeld = path.every(point => point.t > 0.8 || distance(point, objective.center) <= radius);
      objectivePenalty = outside * (140 + clamp(Number(objective.progress) || 0, 0, 1) * 80);
      // Unknown or damaging emergencies retain their full avoidance score.
      if (!acceptsDamage && (rawRisk > 100 || incomingDamage > 0 || unknownDamage))
        objectivePenalty = Math.min(60, objectivePenalty);
    }
    const score = risk + objectivePenalty + utility;
    // An obstructed trajectory is not a possible escape. A crowd can easily
    // exceed the old 100000 wall penalty and otherwise make walking through a
    // cliff look safer than a real, dangerous route along it.
    const choice = { ...dir, risk, score, collision, rawRisk,
      expectedDamage: safety.unknownDamage ? null : hpDamage,
      unknownDamage: safety.unknownDamage, lethal: safety.lethal, safety,
      budgetedDamage: acceptsDamage, acceptedDamage: acceptsDamage && hpDamage > 0, objectiveHeld, escapeRoutes,
      ...(travel?{travelProgress:progress,travelExit:acceptsDamage&&progress>.15}:{}),
      ...(bosses.length?{bossRetreat:true,bossApproach,bossAvoidance:!bossObjective,
        bossConstraintReturn:circleReturn||state.bossBoundaryDetour===true||state.bossEscapeDetour===true}:{} ) };
    const previousLength = state.previous ? Math.hypot(state.previous.x, state.previous.z) : 0;
    if (previousLength > 0.1 &&
        (dir.x * state.previous.x + dir.z * state.previous.z) / previousLength > 0.99999 &&
        (!previousChoice || choice.score < previousChoice.score)) previousChoice = choice;
    if (
      !best ||
      (urgentTravel&&choice.travelExit!==best.travelExit?choice.travelExit===true:
        urgentTravel&&choice.travelExit&&best.travelExit&&Math.abs(choice.safety.healthDamage-best.safety.healthDamage)>.25?
          choice.safety.healthDamage<best.safety.healthDamage:compareMotionSafety(choice,best)<0)
    )
      best = choice;
  }
  // Keep a genuinely equivalent safe heading through tiny target/float changes.
  // Hysteresis cannot override collision, a materially safer dodge or charging.
  if (previousChoice && (!urgentTravel||!best.travelExit||previousChoice.travelExit)&&!previousChoice.collision && previousChoice.risk <= best.risk + 0.25 &&
      previousChoice.score <= best.score + 0.2 &&
      (previousChoice.bossApproach||0)<=(best.bossApproach||0)+.025 &&
      motionSafetyDifference(previousChoice, best) <= 0 &&
      (!best.objectiveHeld || previousChoice.objectiveHeld)) best = previousChoice;
  // Several native guardians can surround the player with no common outward
  // heading. Remaining motionless forever is not an escape. Make one bounded
  // geometric detour proposal, retaining every native collision/damage check;
  // an attack's reach/coverage never authorizes this exception.
  if(bosses.length>1&&!bossObjective&&!state.bossBoundaryDetour&&!state.bossEscapeDetour&&
      Math.hypot(best.x,best.z)<.1){
    const exit=chooseMotion({...state,target:bossEscapeTarget(p,bosses),bossEscapeDetour:true,canDash:false});
    if(Math.hypot(exit.x,exit.z)>.1&&motionSafetyDifference(exit,best)<=0)
      return {...exit,bossEscapeDetour:true};
  }
  if ((best.risk > 100 || best.safety.hitCount > 0) && state.canDash && !(p.slideT > 0)) {
    const fast = chooseMotion({ ...state, predictDash: true, canDash: false });
    if (!fast.collision && compareMotionSafety(fast, best) < 0)
      return { ...fast, danger: true, dash: true };
  }
  // With no bodies, shots or warnings escape room cannot affect candidate
  // ranking. Still examine the winning route's actual eight exits, instead of
  // falsely returning eight verified exits or evaluating them for every input.
  const escapeRoutes = enemies.length || bullets.length || hazards.length ? best.escapeRoutes :
    motionEscapeRoutes(state.traversal?.path || motionCandidatePath(p, best, !!state.predictDash,
      best.brake ? objective : null), p, nearbyEnemies, state.walkable, bullets, hazards);
  return { ...best, escapeRoutes, danger: best.risk > 100 || best.safety.hitCount > 0, dash: false };
}

export function chooseCampaign(profile, biomes, tasks, dex) {
  const live = biomes.filter((b) => b.live !== false);
  const league = profile.league || [profile.starter || 1];
  // Retain the tested starter until a different character has demonstrated a
  // complete clear. Native healing alone does not establish crowd-clear rate
  // or survival: early drain builds can fall far behind in experience.
  let species = league.includes(1) ? 1 : league[0];
  for (let i = 0; i < live.length; i++) {
    const b = live[i];
    if (
      (profile.biomes?.[b.id] ?? -1) < 1 &&
      (i === 0 || (profile.biomes?.[live[i - 1].id] ?? -1) >= 1)
    ) {
      return {
        priority: "开新图",
        biome: b.id,
        species,
        tier: 0,
        mode: "standard",
        metrics: [],
      };
    }
  }
  const pending = tasks.filter((t) => !t.claimed && t.progress < t.goal);
  if (pending.length) {
    const metrics = pending.map((t) => t.metric);
    const desiredType = metrics.includes("burned")
      ? "fire"
      : metrics.includes("paralyzed")
        ? "electric"
        : metrics.includes("soaked")
          ? "water"
          : null;
    if (desiredType)
      species =
        league.find((id) => dex?.(id)?.types?.includes(desiredType)) || species;
    return {
      priority: "做委托",
      biome: live[0].id,
      species,
      tier: 0,
      mode: "standard",
      metrics,
    };
  }
  const unseenScores = live.map((b) => ({
    biome: b.id,
    n: [...(b.residents || []), ...(b.encounters || [])].filter(
      (id) => !profile.seen?.includes(id),
    ).length,
  }));
  unseenScores.sort((a, b) => b.n - a.n);
  const dexIncomplete =
    (profile.seen?.length || 0) < 151 ||
    league.length < (profile.leagueTarget || 79);
  if (dexIncomplete) {
    const novelty = league
      .map((id) => {
        const info = dex?.(id);
        const forms = info?.evolutionIds || [id];
        return {
          id,
          score:
            forms.filter((form) => !profile.seen?.includes(form)).length * 10 +
            (!profile.played?.includes(id) ? 5 : 0),
        };
      })
      .sort((a, b) => b.score - a.score);
    species = novelty[0]?.id || species;
  }
  return {
    priority: dexIncomplete ? "开图鉴" : "刷资源",
    biome: unseenScores[0]?.biome || live[0].id,
    species,
    tier: 0,
    mode: "standard",
    metrics: [],
  };
}

// The game's architecture table determines which stats affect an equipped move.
// A move may have default area/duration values without using those upgrades.
export const moveArchitectureStats = {
  bolt: ["count", "speed"],
  orb: ["count", "area", "speed", "status"],
  lob: ["count", "area", "status"],
  barrage: ["count", "speed"],
  homing: ["count", "speed"],
  beam: ["area", "dur", "count"],
  cone: ["area", "dur", "status"],
  nova: ["area", "status"],
  aura: ["area", "status"],
  orbit: ["count", "area", "dur", "speed"],
  strike: ["area", "count"],
  dash: ["area", "count", "speed"],
  chain: ["count", "area", "status"],
  smite: ["count", "area"],
  meteor: ["count", "area", "status"],
  boomerang: ["count", "area", "speed"],
  trap: ["count", "area", "dur"],
  vortex: ["area", "dur", "count"],
  wave: ["area", "speed", "count", "status"],
  trail: ["area", "dur", "status"],
  drain: ["count", "speed"],
  spin: ["area"],
  weather: ["dur"],
  buff: ["dur"],
  random: ["count", "area", "dur", "status"],
};

function modApplicability(stat, moves) {
  if (moves == null) return 1;
  const defs = moves.filter(Boolean).map((m) => m.def || m);
  const attackStat = [
    "damage",
    "physical",
    "special",
    "crit",
    "critChance",
    "critDamage",
    "eliteDamage",
    "superEffective",
    "lifesteal",
    "flinch",
    "knockback",
    "bounces",
    "statusChance",
    "statusDamage",
  ].includes(stat);
  // Native buff moves only refresh the same fixed-strength player buff. Their
  // nominal special class/status never deals a hit or scales that buff.
  const applicable = attackStat ? defs.filter((m) => m.arch !== "buff") : defs;
  const archStat = {
    projectiles: "count",
    projSpeed: "speed",
    area: "area",
    duration: "dur",
  }[stat];
  const restricted = archStat || attackStat;
  if (!restricted) return 1;
  if (!applicable.length) return 0;
  return (
    applicable.filter((m) => {
      if (stat === "physical" || stat === "special") return moveClassFraction(m,stat)>0;
      // Trigger availability is a user assumption, not a skill-status gate.
      // Item procs/fusion zones can supply status even when def.status is null.
      // The score remains a channel proxy; it does not assert 100% status DPS.
      if (stat === "statusChance" || stat === "statusDamage") return true;
      if (archStat && (m.arch==="fusion" || m.fusion)) {
        const profile=fusionBenefitProfile(m);
        if (!profile) return false; // fractional unknown estimate added below
        return archStat==="area"?profile.area:archStat==="dur"?profile.duration:archStat==="count"?!!(profile.counts.length||profile.repeats):false;
      }
      return !archStat || globalMoveStats055[m.arch]?.includes(archStat);
    }).length / applicable.length + (archStat && ["area","dur","count"].includes(archStat) ?
      .35*applicable.filter(m=>(m.arch==="fusion" || m.fusion) && !fusionBenefitProfile(m)).length/applicable.length : 0)
  );
}

function estimatedHitRate(player) {
  const stats = player?.stats || {};
  return Math.min(
    20,
    (player?.moves || []).filter(Boolean).reduce((n, move) => {
      const def = move.def || move,
        mods = move.mods || {};
      if (["weather", "buff"].includes(def.arch)) return n;
      let hits = Math.max(
        1,
        (def.count || 1) + (mods.count || 0) + (stats.projectiles || 0),
      );
      if (["beam", "cone"].includes(def.arch))
        hits *= Math.max(1, (def.dur || 0.5) * 6);
      if (
        ["aura", "nova", "wave", "spin", "chain", "strike", "orbit"].includes(
          def.arch,
        )
      )
        hits *= 2;
      return (
        n +
        (hits * (stats.attackSpeed || 1)) /
          Math.max(0.2, (def.cd || 1.5) * (mods.cd || 1))
      );
    }, 0),
  );
}

// A planner-issued intent only. Native live counters guide this run; they are
// never written back or treated as a saved unlock/ownership receipt.
export function characterUnlockExecutionState(run, execution) {
  const inactive=reason=>({active:false,reason,pending:[],conditions:[],practice:null,statWeights:{},allLiveMet:false,naturalEnd:false});
  if(!run?.player||!execution||execution.schemaVersion!==1||
      !['character-batch','character-focus','character-route'].includes(execution.kind)||!Array.isArray(execution.conditions)||
      !execution.conditions.length&&execution.kind!=='character-route'||execution.conditions.length>256)return inactive('no-character-execution');
  const mode=run.tower?'tower':run.endless?'endless':'standard';
  if(execution.mode!==mode||execution.biome!==run.biome?.id||
      !Number.isInteger(execution.tier)||execution.tier!==Number(run.tier??0))return inactive('native-route-mismatch');
  if(run.state==='over'||run.player.dead)return inactive('native-run-ended');
  const finite=value=>typeof value==='number'&&Number.isFinite(value)?value:null,
    counterRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&
      Object.prototype.toString.call(value)==='[object Object]'&&
      (Object.getPrototypeOf(value)===null||Object.getPrototypeOf(Object.getPrototypeOf(value))===null),
    conditions=execution.conditions.map(condition=>{
      const source=condition?.liveSource,goal=finite(condition?.goal),saved=finite(condition?.saved),
        key=source?.key,valid=typeof key==='string'&&/^[A-Za-z0-9_:+-]{1,128}$/.test(key)&&goal!==null&&goal>0;
      let current=null,observed=null;
      if(valid&&source.owner==='runStats')current=finite(run.stats?.[key]);
      else if(valid&&source.owner==='run')current=finite(run[key]);
      else if(valid&&source.owner==='player')current=finite(run.player[key]);
      else if(valid&&source.owner==='metaCounter'){
        const table=run.meta?.profile?.counters;
        if(counterRecord(table))current=Object.hasOwn(table,key)?finite(table[key]):0;
      }
      if(current!==null){
        if(source.aggregation==='live-total')observed=current;
        else if(source.aggregation==='run-total')observed=condition.singleRun===true?current:saved!==null?saved+current:null;
        else if(source.aggregation==='run-delta'){
          const table=run.meta?.snap?.counters,baseline=counterRecord(table)?
            Object.hasOwn(table,key)?finite(table[key]):0:null;
          if(baseline!==null)observed=condition.singleRun===true?Math.max(0,current-baseline):saved!==null?saved+Math.max(0,current-baseline):null;
        }
      }
      const known=observed!==null;
      return {counter:condition?.counter,goal,saved,current,value:known?Math.max(0,observed):null,known,
        met:known&&observed>=goal,source,targetIds:condition?.targetIds||[],preferenceHints:condition?.preferenceHints||{},
        canProgressBeforeFinalBoss:condition?.canProgressBeforeFinalBoss===true};
    }),pending=conditions.filter(row=>!row.met),focus=Array.isArray(execution.focusCounters)?execution.focusCounters:[],
    practices=pending.filter(row=>row.known&&['dodges','healed'].includes(row.source?.key))
      .sort((a,b)=>(focus.includes(a.counter)?focus.indexOf(a.counter):999)-(focus.includes(b.counter)?focus.indexOf(b.counter):999)),
    practice=practices[0]||null,statWeights={},preferenceHints={preferredMoves:[],preferStatuses:[],vitaminPriority:[],itemPriority:[],statWeights};
  // Once a condition is live-complete its special recovery/status preference
  // must yield to the remaining work. Old DTOs have only the aggregate hint.
  const hints=execution.conditions.some(row=>row?.preferenceHints)?pending.map(row=>row.preferenceHints):
    pending.length||execution.kind==='character-route'&&!execution.conditions.length?[execution.preferenceHints||{}]:[];
  for(const hint of hints){
    for(const key of ['preferredMoves','preferStatuses','vitaminPriority','itemPriority'])
      for(const value of Array.isArray(hint[key])?hint[key]:[])
        if(typeof value==='string'&&/^[A-Za-z0-9_.:+-]{1,100}$/.test(value)&&!preferenceHints[key].includes(value))preferenceHints[key].push(value);
    for(const [key,value]of Object.entries(hint.statWeights||{}))
      if(/^[A-Za-z][A-Za-z0-9]*$/.test(key)&&finite(value)!==null&&value>0)statWeights[key]=Math.max(statWeights[key]||0,Math.min(8,value));
  }
  return {active:true,conditions,pending,practice,statWeights,allLiveMet:pending.length===0,
    preferenceHints,naturalEnd:execution.naturalEnd===true,reason:pending.length?'native-condition-pending':'live-goals-met-await-native-save'};
}

// Every tower role shares this timing policy. Explicit item exclusions disable
// the Cleanse Tag expectation, not the common blessing/star scoring correction.
// This changes choice value, never native stats or drop rules.
export function towerLuckTiming(run = {}) {
  const p=run.player || {}, native=run.nativeRun || p.run || {}, build=run.build || {},
    key='cleanse-tag',
    rule=build.itemRules?.find(row=>row.key===key),
    expected=!(rule?.avoid || build.avoidItems?.includes(key) ||
      Number(rule?.targetCount ?? build.itemCounts?.[key] ?? 10)<=0 ||
      build.sourceType==='custom' && build.allowOffPlan===false && !rule);
  if(!isTowerRun(run)) return null;
  const floor=Number(native.tower?.floor ?? run.tower?.floor), count=Number(p.items?.get?.(key)) || 0;
  if(!Number.isFinite(floor) || floor<1) return null;
  return {target:run.luckOnlyExperience===true?100:125, count,floor,expected,
    factor:!expected || count>=5 || floor>=30?1:count>=3 || floor>=20?.5:.1,
    protectCleanse:expected && count<3 && floor<20};
}

export function decisionPlayer(run = {}) {
  const player=run.player||{},native=run.nativeRun||player.run||{},build=run.build||{},
    execution=run.unlockExecution||build.unlockExecution,
    unlock=execution?characterUnlockExecutionState(native,execution):null,
    objective=String(run.objective||run.goalMode||run.objectiveMetric||''),
    scoring=!!native.endless||/endless|survival|kills|击杀|击败/.test(objective),
    elapsed=Math.max(0,Number(native.time)||0),weights={...(unlock?.active?unlock.statWeights:{}),...(build.statWeights||{})},
    tank=build.playstyle==='tank'||build.strategy==='tank'||['armor','maxHp','regen','healing'].filter(key=>Number(weights[key])>=2).length>=2,
    late=scoring&&!tank&&elapsed>=1800,oneHit=scoring&&!tank&&run.oneShotThreat===true,
    offensive=scoring&&!tank&&Number(player.hp)/Number(player.maxHp)>=.6;
  const strategic=late||oneHit||offensive?{damage:1.35,physical:1.2,special:1.2,attackSpeed:1.3,projectiles:1.25,
    regen:oneHit?.08:.35,healing:oneHit?.08:.35,lifesteal:oneHit?.08:.35,armor:oneHit?.2:.55,
    maxHp:oneHit?.2:.55,shieldMax:oneHit?.2:.55,xpGain:.55,gold:.5}:{},
    decisionWeights={...strategic,...weights};
  // Future work is only a small multiplier after this run's strategy has been
  // decided. It cannot replace late-survival recovery .35/.08 with a raw 1.15.
  for(const [key,value]of Object.entries(build.characterForesightWeights||{}))
    if(typeof value==='number'&&value>=1&&value<=1.15&&
        !Object.hasOwn(build.statWeights||{},key)&&!Object.hasOwn(unlock?.statWeights||{},key))
      decisionWeights[key]=(decisionWeights[key]??1)*value;
  return Object.assign(Object.create(player),{luckTiming:towerLuckTiming(run),decisionWeights,
    decisionProfile:{scoring,tank,late,oneHit,elapsed,objective,
      conditionRecovery:unlock?.active&&unlock.pending.some(row=>['healed','dodges'].includes(row.source?.key))||false}});
}

// Soft objective preferences are evaluated from actual pending counters. A
// player's independent avoid/strict/final settings are not removed or rewritten.
export function characterUnlockDecisionBuild(build={},run,execution) {
  const state=characterUnlockExecutionState(run,execution);
  if(!state.active)return build;
  const hints=state.preferenceHints,future=execution.foresight,
    futureState=future?.schemaVersion===1&&future.practice===false&&future.blocksCompletion===false&&
      Array.isArray(future.conditions)&&future.conditions.length<=12?
      characterUnlockExecutionState(run,{...execution,kind:'character-route',foresight:null,
        conditions:future.conditions.filter(row=>row?.futureOnly===true),preferenceHints:{}}):null,
    futureRows=futureState?.active?futureState.pending.filter(row=>row.known):[],
    futureItems=[...new Set(futureRows.flatMap(row=>row.preferenceHints?.itemPriority||[]))],
    futureVitamins=[...new Set(futureRows.flatMap(row=>row.preferenceHints?.vitaminPriority||[]))],
    futureWeights={};
  for(const row of futureRows)for(const [key,value]of Object.entries(row.preferenceHints?.statWeights||{}))
    if(/^[A-Za-z][A-Za-z0-9]*$/.test(key)&&typeof value==='number'&&Number.isFinite(value)&&value>1)
      futureWeights[key]=Math.max(futureWeights[key]||1,Math.min(1.15,value));
  const publicHint=value=>typeof value==='string'&&/^[A-Za-z0-9_.:+-]{1,100}$/.test(value);
  return {...build,unlockExecution:execution,
    moves:[...new Set([...hints.preferredMoves,...(build.moves||[])])],
    items:[...new Set([...hints.itemPriority,...(build.items||[]),...futureItems.filter(publicHint)])],
    vitaminPriority:[...new Set([...hints.vitaminPriority,...(build.vitaminPriority||[]),...futureVitamins.filter(publicHint)])],
    characterForesightVitaminKeys:futureVitamins.filter(publicHint),
    characterForesightWeights:futureWeights,
    statWeights:{...state.statWeights,...(build.statWeights||{})}};
}

// Native055 capability metadata; 43e519cba77e5c2e3d2ee5f5db47d952f62eb741e0c8096dc468929ca4c7a149.
// Part shares are ranking estimates, not measured hit rates or total DPS.
// BEGIN audited native055 mechanics
const fusionProfiles055 = {"fu-1":{"cls":"special","type":"grass","area":true,"duration":true,"repeats":true,"counts":[{"base":10,"per":4,"max":12,"share":1}],"channels":[{"status":"root","probability":0.15,"kind":"scaled"},{"status":"root","probability":0.5,"kind":"scaled"}],"critKinds":["plain","inherited"]},"fu-4":{"cls":"special","type":"fire","area":true,"duration":true,"repeats":false,"counts":[{"base":0,"per":1,"max":2,"share":1}],"channels":[{"status":"burn","probability":0.25,"kind":"scaled"},{"status":"burn","probability":0.3,"kind":"scaled"},{"status":"burn","probability":0.8,"kind":"scaled"},{"status":"burn","probability":0.5,"kind":"scaled"},{"status":"burn","probability":0.15,"kind":"scaled"}],"critKinds":["plain","inherited"]},"fu-7":{"cls":"special","type":"water","area":true,"duration":true,"repeats":false,"counts":[{"base":2,"per":1,"max":2,"share":1}],"channels":[{"status":"wet","probability":0.4,"kind":"scaled"},{"status":"wet","probability":1,"kind":"scaled"}],"critKinds":["inherited"]},"fu-25":{"cls":"special","type":"electric","area":true,"duration":true,"repeats":false,"counts":[{"base":3,"per":1,"max":4,"share":1}],"channels":[{"status":"paralysis","probability":0.3,"kind":"scaled"},{"status":"paralysis","probability":0.6,"kind":"scaled"}],"critKinds":["inherited"]},"fu-10":{"cls":"special","type":"bug","area":true,"duration":false,"repeats":false,"counts":[{"base":5,"per":1,"max":3,"share":1}],"channels":[{"status":"root","probability":0.9,"kind":"scaled"},{"status":"poison","probability":0.15,"kind":"scaled"}],"critKinds":["inherited"]},"fu-13":{"cls":"physical","type":"poison","area":true,"duration":true,"repeats":false,"counts":[{"base":3,"per":1,"max":3,"share":1}],"channels":[{"status":"poison","probability":0.6,"kind":"scaled"},{"status":"poison","probability":0.4,"kind":"scaled"}],"critKinds":["plain","inherited"]},"fu-16":{"cls":"special","type":"flying","area":true,"duration":true,"repeats":false,"counts":[{"base":0,"per":0.5,"max":2,"share":1}],"channels":[],"critKinds":["plain"]},"fu-19":{"cls":"physical","type":"normal","area":true,"duration":false,"repeats":false,"counts":[{"base":6,"per":2,"max":6,"share":1}],"channels":[],"critKinds":["inherited"]},"fu-21":{"cls":"physical","type":"flying","area":true,"duration":false,"repeats":false,"counts":[{"base":3,"per":1,"max":3,"share":1}],"channels":[{"status":"stun","probability":0.3,"kind":"scaled"}],"critKinds":["inherited"]},"fu-23":{"cls":"physical","type":"poison","area":true,"duration":true,"repeats":true,"counts":[],"channels":[{"status":"poison","probability":0.9,"kind":"scaled"},{"status":"curse","probability":0.5,"kind":"scaled"}],"critKinds":["plain","inherited"]},"fu-27":{"cls":"physical","type":"ground","area":true,"duration":true,"repeats":false,"counts":[{"base":5,"per":1,"max":3,"share":1}],"channels":[{"status":"stun","probability":0.4,"kind":"scaled"},{"status":"stun","probability":0.15,"kind":"scaled"}],"critKinds":["inherited"]},"fu-29":{"cls":"special","type":"poison","area":true,"duration":false,"repeats":true,"counts":[],"channels":[{"status":"poison","probability":0.9,"kind":"scaled"},{"status":"poison","probability":1,"kind":"scaled"}],"critKinds":["inherited"]},"fu-32":{"cls":"special","type":"ground","area":true,"duration":false,"repeats":false,"counts":[{"base":1,"per":1,"max":2,"share":1}],"channels":[{"status":"stun","probability":0.15,"kind":"scaled"}],"critKinds":["inherited"]},"fu-35":{"cls":"special","type":"fairy","area":true,"duration":true,"repeats":true,"counts":[],"channels":[{"status":"charm","probability":0.5,"kind":"scaled"}],"critKinds":["inherited"]},"fu-37":{"cls":"special","type":"fire","area":true,"duration":false,"repeats":false,"counts":[{"base":9,"per":1,"max":3,"share":1}],"channels":[{"status":"burn","probability":0.4,"kind":"scaled"},{"status":"burn","probability":0.3,"kind":"scaled"},{"status":"confusion","probability":0.3,"kind":"scaled"}],"critKinds":["inherited"]},"fu-39":{"cls":"special","type":"normal","area":true,"duration":false,"repeats":true,"counts":[],"channels":[{"status":"sleep","probability":0.85,"kind":"scaled"}],"critKinds":["inherited"]},"fu-41":{"cls":"special","type":"flying","area":true,"duration":false,"repeats":false,"counts":[{"base":6,"per":2,"max":6,"share":1}],"channels":[{"status":"confusion","probability":0.15,"kind":"scaled"}],"critKinds":["plain","inherited"]},"fu-43":{"cls":"special","type":"grass","area":true,"duration":true,"repeats":false,"counts":[{"base":10,"per":2,"max":6,"share":1}],"channels":[{"status":"poison","probability":0.45,"kind":"scaled"}],"critKinds":["plain","inherited"]},"fu-46":{"cls":"special","type":"grass","area":true,"duration":true,"repeats":false,"counts":[{"base":3,"per":1,"max":3,"share":1}],"channels":[{"status":"sleep","probability":0.35,"kind":"scaled"},{"status":"sleep","probability":0.2,"kind":"scaled"}],"critKinds":["inherited"]},"fu-48":{"cls":"special","type":"bug","area":true,"duration":true,"repeats":false,"counts":[{"base":5,"per":1,"max":2,"share":1}],"channels":[{"status":"confusion","probability":0.3,"kind":"scaled"},{"status":"confusion","probability":0.08,"kind":"scaled"}],"critKinds":["inherited"]},"fu-50":{"cls":"physical","type":"ground","area":true,"duration":false,"repeats":false,"counts":[{"base":2,"per":0.5,"max":1,"share":1}],"channels":[{"status":"stun","probability":0.15,"kind":"scaled"},{"status":"root","probability":0.3,"kind":"scaled"}],"critKinds":["plain","inherited"]},"fu-52":{"cls":"physical","type":"normal","area":true,"duration":true,"repeats":false,"counts":[{"base":12,"per":3,"max":9,"share":1}],"channels":[{"status":"charm","probability":0.12,"kind":"scaled"}],"critKinds":["inherited"]},"fu-54":{"cls":"special","type":"water","area":true,"duration":false,"repeats":false,"counts":[{"base":6,"per":2,"max":6,"share":1}],"channels":[{"status":"wet","probability":1,"kind":"scaled"},{"status":"confusion","probability":0.2,"kind":"scaled"}],"critKinds":["inherited"]},"fu-56":{"cls":"physical","type":"ground","area":true,"duration":false,"repeats":false,"counts":[{"base":5,"per":1,"max":5,"share":1}],"channels":[{"status":"stun","probability":0.1,"kind":"scaled"}],"critKinds":["inherited"]},"fu-58":{"cls":"physical","type":"fire","area":true,"duration":true,"repeats":false,"counts":[{"base":4,"per":1,"max":3,"share":1}],"channels":[{"status":"burn","probability":0.7,"kind":"scaled"},{"status":"burn","probability":0.35,"kind":"scaled"},{"status":"burn","probability":0.3,"kind":"scaled"}],"critKinds":["plain","inherited"]},"fu-60":{"cls":"special","type":"water","area":true,"duration":true,"repeats":false,"counts":[{"base":3,"per":1,"max":2,"share":1}],"channels":[{"status":"sleep","probability":0.35,"kind":"scaled"},{"status":"wet","probability":0.3,"kind":"scaled"}],"critKinds":["plain","inherited"]},"fu-63":{"cls":"special","type":"psychic","area":true,"duration":false,"repeats":false,"counts":[{"base":3,"per":1,"max":3,"share":1}],"channels":[{"status":"confusion","probability":0.35,"kind":"scaled"}],"critKinds":["inherited"]},"fu-66":{"cls":"physical","type":"fighting","area":true,"duration":false,"repeats":false,"counts":[{"base":4,"per":1,"max":4,"share":1}],"channels":[{"status":"confusion","probability":0.5,"kind":"scaled"}],"critKinds":["inherited"]},"fu-69":{"cls":"physical","type":"grass","area":true,"duration":false,"repeats":false,"counts":[{"base":3,"per":1,"max":3,"share":1}],"channels":[{"status":"root","probability":0.5,"kind":"scaled"},{"status":"poison","probability":0.6,"kind":"scaled"}],"critKinds":["inherited"]},"fu-72":{"cls":"special","type":"water","area":true,"duration":true,"repeats":false,"counts":[{"base":5,"per":1,"max":3,"share":1}],"channels":[{"status":"wet","probability":0.4,"kind":"scaled"},{"status":"poison","probability":0.4,"kind":"scaled"},{"status":"poison","probability":0.6,"kind":"scaled"}],"critKinds":["inherited"]},"fu-74":{"cls":"physical","type":"ground","area":true,"duration":false,"repeats":false,"counts":[{"base":0,"per":1,"max":3,"share":1}],"channels":[{"status":"stun","probability":0.32,"kind":"scaled"},{"status":"stun","probability":0.4,"kind":"scaled"},{"status":"stun","probability":0.48,"kind":"scaled"},{"status":"stun","probability":0.56,"kind":"scaled"},{"status":"stun","probability":0.64,"kind":"scaled"},{"status":"stun","probability":0.72,"kind":"scaled"},{"status":"stun","probability":0.8,"kind":"scaled"}],"critKinds":["inherited"]},"fu-92":{"cls":"special","type":"ghost","area":true,"duration":false,"repeats":false,"counts":[{"base":5,"per":1,"max":5,"share":1}],"channels":[{"status":"curse","probability":0.8,"kind":"scaled"},{"status":"curse","probability":0.3,"kind":"scaled"}],"critKinds":["inherited"]},"fu-104":{"cls":"physical","type":"ground","area":true,"duration":true,"repeats":false,"counts":[{"base":2,"per":1,"max":2,"share":1}],"channels":[{"status":"curse","probability":0.25,"kind":"scaled"}],"critKinds":["inherited"]},"fu-123":{"cls":"physical","type":"bug","area":true,"duration":false,"repeats":false,"counts":[{"base":1,"per":0.5,"max":2,"share":1}],"channels":[],"critKinds":["inherited"]},"fu-129":{"cls":"special","type":"water","area":true,"duration":true,"repeats":true,"counts":[],"channels":[{"status":"wet","probability":1,"kind":"scaled"}],"critKinds":["inherited"]},"fu-131":{"cls":"special","type":"water","area":true,"duration":false,"repeats":true,"counts":[],"channels":[{"status":"wet","probability":1,"kind":"scaled"},{"status":"freeze","probability":0.3,"kind":"scaled"}],"critKinds":["inherited"]},"fu-133":{"cls":"physical","type":"normal","area":true,"duration":false,"repeats":false,"counts":[{"base":5,"per":1,"max":4,"share":1}],"channels":[{"status":"burn","probability":0.6,"kind":"scaled","condition":"player-first-type"},{"status":"wet","probability":0.6,"kind":"scaled","condition":"player-first-type"},{"status":"paralysis","probability":0.6,"kind":"scaled","condition":"player-first-type"}],"critKinds":["plain","inherited"]},"fu-143":{"cls":"physical","type":"normal","area":true,"duration":false,"repeats":true,"counts":[],"channels":[{"status":"stun","probability":0.4,"kind":"scaled"}],"critKinds":["inherited"]},"fu-147":{"cls":"special","type":"dragon","area":true,"duration":true,"repeats":false,"counts":[{"base":6,"per":2,"max":6,"share":1}],"channels":[],"critKinds":["plain","inherited"]},"fu-151":{"cls":"special","type":"psychic","area":true,"duration":true,"repeats":true,"counts":[],"channels":[{"status":"root","probability":0.5,"kind":"scaled"},{"status":"confusion","probability":0.4,"kind":"scaled"},{"status":"charm","probability":0.3,"kind":"scaled"}],"critKinds":["inherited"]},"fu-77":{"cls":"physical","type":"fire","area":true,"duration":true,"repeats":false,"counts":[{"base":3,"per":1,"max":3,"share":1}],"channels":[{"status":"burn","probability":0.5,"kind":"scaled"},{"status":"burn","probability":0.4,"kind":"scaled"},{"status":"burn","probability":0.6,"kind":"scaled"}],"critKinds":["plain","inherited"]},"fu-79":{"cls":"special","type":"water","area":true,"duration":true,"repeats":true,"counts":[],"channels":[{"status":"confusion","probability":0.25,"kind":"scaled"},{"status":"burn","probability":0.3,"kind":"scaled"},{"status":"burn","probability":0.2,"kind":"scaled"}],"critKinds":["plain","inherited"]},"fu-81":{"cls":"special","type":"steel","area":true,"duration":true,"repeats":false,"counts":[{"base":4,"per":1,"max":4,"share":1}],"channels":[{"status":"paralysis","probability":0.2,"kind":"scaled"}],"critKinds":["inherited"]},"fu-83":{"cls":"physical","type":"flying","area":true,"duration":false,"repeats":true,"counts":[{"base":6,"per":2,"max":6,"share":1}],"channels":[],"critKinds":["plain","inherited"]},"fu-84":{"cls":"special","type":"flying","area":true,"duration":false,"repeats":false,"counts":[{"base":3,"per":1,"max":2,"share":1}],"channels":[{"status":"confusion","probability":0.15,"kind":"scaled"}],"critKinds":["inherited"]},"fu-86":{"cls":"special","type":"ice","area":true,"duration":true,"repeats":false,"counts":[{"base":5,"per":1,"max":3,"share":1}],"channels":[{"status":"freeze","probability":0.25,"kind":"scaled"},{"status":"freeze","probability":0.35,"kind":"scaled"}],"critKinds":["inherited"]},"fu-88":{"cls":"special","type":"poison","area":true,"duration":true,"repeats":false,"counts":[{"base":3,"per":1,"max":2,"share":1}],"channels":[{"status":"poison","probability":0.25,"kind":"scaled"},{"status":"poison","probability":0.4,"kind":"scaled"},{"status":"poison","probability":0.5,"kind":"scaled"}],"critKinds":["plain","inherited"]},"fu-90":{"cls":"physical","type":"ice","area":true,"duration":false,"repeats":false,"counts":[{"base":10,"per":2,"max":8,"share":1}],"channels":[{"status":"freeze","probability":0.15,"kind":"scaled"},{"status":"stun","probability":0.3,"kind":"scaled"}],"critKinds":["inherited"]},"fu-95":{"cls":"physical","type":"rock","area":true,"duration":true,"repeats":false,"counts":[{"base":3,"per":1,"max":3,"share":1}],"channels":[{"status":"stun","probability":0.15,"kind":"scaled"},{"status":"stun","probability":0.35,"kind":"scaled"},{"status":"stun","probability":0.1,"kind":"scaled"}],"critKinds":["plain","inherited"]},"fu-96":{"cls":"special","type":"psychic","area":true,"duration":false,"repeats":false,"counts":[{"base":6,"per":2,"max":6,"share":1}],"channels":[{"status":"sleep","probability":0.8,"kind":"scaled"},{"status":"curse","probability":0.25,"kind":"scaled"}],"critKinds":["inherited"]},"fu-98":{"cls":"physical","type":"water","area":true,"duration":false,"repeats":false,"counts":[{"base":3,"per":0.6,"max":2,"share":1}],"channels":[{"status":"wet","probability":1,"kind":"scaled"}],"critKinds":["inherited"]},"fu-100":{"cls":"special","type":"electric","area":true,"duration":false,"repeats":false,"counts":[{"base":5,"per":1,"max":4,"share":1}],"channels":[{"status":"paralysis","probability":0.35,"kind":"scaled"}],"critKinds":["inherited"]},"fu-102":{"cls":"physical","type":"grass","area":true,"duration":false,"repeats":false,"counts":[{"base":3,"per":1,"max":3,"share":1}],"channels":[{"status":"root","probability":0.3,"kind":"scaled"}],"critKinds":["inherited"]},"fu-106":{"cls":"physical","type":"fighting","area":true,"duration":false,"repeats":true,"counts":[],"channels":[{"status":"stun","probability":0.4,"kind":"scaled"}],"critKinds":["inherited"]},"fu-107":{"cls":"physical","type":"fighting","area":true,"duration":false,"repeats":true,"counts":[],"channels":[{"status":"freeze","probability":0.9,"kind":"scaled"}],"critKinds":["inherited"]},"fu-108":{"cls":"physical","type":"normal","area":true,"duration":false,"repeats":false,"counts":[{"base":8,"per":2,"max":6,"share":1}],"channels":[{"status":"stun","probability":0.5,"kind":"scaled"}],"critKinds":["inherited"]},"fu-109":{"cls":"special","type":"poison","area":true,"duration":false,"repeats":false,"counts":[{"base":4,"per":1,"max":3,"share":1}],"channels":[{"status":"poison","probability":0.9,"kind":"scaled"}],"critKinds":["inherited"]},"fu-111":{"cls":"physical","type":"ground","area":true,"duration":false,"repeats":true,"counts":[],"channels":[{"status":"stun","probability":0.4,"kind":"scaled"}],"critKinds":["inherited"]},"fu-113":{"cls":"special","type":"normal","area":true,"duration":false,"repeats":false,"counts":[{"base":3,"per":1,"max":3,"share":1}],"channels":[],"critKinds":["inherited"]},"fu-114":{"cls":"physical","type":"grass","area":true,"duration":false,"repeats":false,"counts":[{"base":6,"per":2,"max":6,"share":1}],"channels":[{"status":"root","probability":0.9,"kind":"scaled"}],"critKinds":["inherited"]},"fu-115":{"cls":"physical","type":"normal","area":true,"duration":false,"repeats":false,"counts":[{"base":2,"per":0.5,"max":2,"share":1}],"channels":[{"status":"stun","probability":0.2,"kind":"scaled"}],"critKinds":["inherited"]},"fu-116":{"cls":"special","type":"water","area":true,"duration":false,"repeats":false,"counts":[{"base":3,"per":1,"max":3,"share":1}],"channels":[{"status":"stun","probability":0.6,"kind":"scaled"},{"status":"wet","probability":1,"kind":"scaled"}],"critKinds":["inherited"]},"fu-118":{"cls":"physical","type":"water","area":true,"duration":false,"repeats":false,"counts":[{"base":4,"per":1,"max":4,"share":1}],"channels":[{"status":"wet","probability":1,"kind":"scaled"}],"critKinds":["inherited"]},"fu-120":{"cls":"special","type":"water","area":true,"duration":true,"repeats":false,"counts":[{"base":4,"per":1,"max":2,"share":1}],"channels":[{"status":"wet","probability":0.2,"kind":"scaled"}],"critKinds":["inherited"]},"fu-122":{"cls":"special","type":"fairy","area":true,"duration":false,"repeats":true,"counts":[],"channels":[{"status":"confusion","probability":0.15,"kind":"scaled"},{"status":"charm","probability":0.5,"kind":"scaled"}],"critKinds":["inherited"]},"fu-124":{"cls":"special","type":"ice","area":true,"duration":true,"repeats":false,"counts":[{"base":6,"per":1,"max":4,"share":1}],"channels":[{"status":"sleep","probability":0.8,"kind":"scaled"},{"status":"charm","probability":0.8,"kind":"scaled"},{"status":"freeze","probability":0.35,"kind":"scaled"},{"status":"freeze","probability":0.12,"kind":"scaled"}],"critKinds":["inherited"]},"fu-125":{"cls":"physical","type":"electric","area":true,"duration":false,"repeats":true,"counts":[],"channels":[{"status":"paralysis","probability":0.3,"kind":"scaled"},{"status":"paralysis","probability":0.6,"kind":"scaled"}],"critKinds":["inherited"]},"fu-126":{"cls":"special","type":"fire","area":true,"duration":true,"repeats":false,"counts":[{"base":9,"per":2,"max":8,"share":1}],"channels":[{"status":"burn","probability":0.5,"kind":"scaled"},{"status":"burn","probability":0.4,"kind":"scaled"},{"status":"burn","probability":0.7,"kind":"scaled"}],"critKinds":["plain","inherited"]},"fu-127":{"cls":"physical","type":"fighting","area":true,"duration":false,"repeats":true,"counts":[],"channels":[{"status":"stun","probability":0.8,"kind":"scaled"},{"status":"stun","probability":0.3,"kind":"scaled"}],"critKinds":["inherited"]},"fu-128":{"cls":"physical","type":"normal","area":true,"duration":true,"repeats":false,"counts":[{"base":3,"per":1,"max":3,"share":1}],"channels":[{"status":"stun","probability":0.2,"kind":"scaled"}],"critKinds":["inherited"]},"fu-132":{"cls":"special","type":"normal","area":false,"duration":false,"repeats":true,"counts":[],"channels":[],"critKinds":[],"copy":["fu-1","fu-4","fu-7","fu-25","fu-10","fu-13","fu-16","fu-19","fu-21","fu-23","fu-27","fu-29","fu-32","fu-35","fu-37","fu-39","fu-41","fu-43","fu-46","fu-48","fu-50","fu-52","fu-54","fu-56","fu-58","fu-60","fu-63","fu-66","fu-69","fu-72","fu-74","fu-92","fu-104","fu-123","fu-129","fu-131","fu-133","fu-143","fu-147","fu-151","fu-77","fu-79","fu-81","fu-83","fu-84","fu-86","fu-88","fu-90","fu-95","fu-96","fu-98","fu-100","fu-102","fu-106","fu-107","fu-108","fu-109","fu-111","fu-113","fu-114","fu-115","fu-116","fu-118","fu-120","fu-122","fu-124","fu-125","fu-126","fu-127","fu-128","fu-137","fu-138","fu-140","fu-142","fu-144","fu-145","fu-146","fu-150"]},"fu-137":{"cls":"special","type":"electric","area":true,"duration":true,"repeats":false,"counts":[{"base":3,"per":1,"max":2,"share":1}],"channels":[{"status":"paralysis","probability":0.15,"kind":"scaled"},{"status":"paralysis","probability":0.4,"kind":"scaled"}],"critKinds":["inherited"]},"fu-138":{"cls":"special","type":"water","area":true,"duration":false,"repeats":false,"counts":[{"base":6,"per":2,"max":6,"share":1}],"channels":[{"status":"wet","probability":1,"kind":"scaled"}],"critKinds":["inherited"]},"fu-140":{"cls":"physical","type":"fighting","area":true,"duration":false,"repeats":false,"counts":[{"base":6,"per":2,"max":6,"share":1}],"channels":[],"critKinds":["plain","inherited"]},"fu-142":{"cls":"physical","type":"flying","area":true,"duration":false,"repeats":false,"counts":[{"base":2,"per":1,"max":2,"share":1}],"channels":[{"status":"paralysis","probability":0.6,"kind":"scaled"},{"status":"paralysis","probability":0.5,"kind":"scaled"}],"critKinds":["inherited"]},"fu-144":{"cls":"special","type":"ice","area":true,"duration":true,"repeats":true,"counts":[],"channels":[{"status":"freeze","probability":0.45,"kind":"scaled"}],"critKinds":["inherited"]},"fu-145":{"cls":"special","type":"electric","area":true,"duration":false,"repeats":true,"counts":[{"base":7,"per":2,"max":6,"share":1}],"channels":[{"status":"paralysis","probability":0.2,"kind":"scaled"},{"status":"paralysis","probability":0.4,"kind":"scaled"}],"critKinds":["inherited"]},"fu-146":{"cls":"special","type":"fire","area":true,"duration":true,"repeats":true,"counts":[],"channels":[{"status":"burn","probability":0.3,"kind":"scaled"},{"status":"burn","probability":0.8,"kind":"scaled"}],"critKinds":["inherited"]},"fu-150":{"cls":"special","type":"psychic","area":true,"duration":false,"repeats":true,"counts":[{"base":6,"per":2,"max":6,"share":0.5},{"base":3,"per":1,"max":2,"share":0.5}],"channels":[{"status":"confusion","probability":0.2,"kind":"scaled"},{"status":"confusion","probability":0.5,"kind":"scaled"}],"critKinds":["plain","inherited"]},"fu-t-normal":{"cls":"physical","type":"normal","area":true,"duration":false,"repeats":false,"counts":[{"base":8,"per":2,"max":6,"share":1}],"channels":[],"critKinds":["plain","inherited"]},"fu-t-fire":{"cls":"special","type":"fire","area":true,"duration":true,"repeats":true,"counts":[],"channels":[{"status":"burn","probability":0.3,"kind":"scaled"},{"status":"burn","probability":0.8,"kind":"scaled"}],"critKinds":["inherited"]},"fu-t-water":{"cls":"special","type":"water","area":true,"duration":false,"repeats":false,"counts":[{"base":5,"per":1,"max":4,"share":1}],"channels":[{"status":"wet","probability":1,"kind":"scaled"}],"critKinds":["inherited"]},"fu-t-grass":{"cls":"physical","type":"grass","area":true,"duration":false,"repeats":false,"counts":[{"base":6,"per":1,"max":3,"share":1}],"channels":[{"status":"root","probability":0.6,"kind":"scaled"}],"critKinds":["inherited"]},"fu-t-electric":{"cls":"special","type":"electric","area":true,"duration":true,"repeats":true,"counts":[],"channels":[{"status":"paralysis","probability":0.5,"kind":"scaled"}],"critKinds":["inherited"]},"fu-t-ice":{"cls":"special","type":"ice","area":true,"duration":true,"repeats":false,"counts":[{"base":6,"per":1,"max":4,"share":1}],"channels":[{"status":"freeze","probability":0.18,"kind":"scaled"},{"status":"freeze","probability":0.4,"kind":"scaled"}],"critKinds":["inherited"]},"fu-t-fighting":{"cls":"physical","type":"fighting","area":true,"duration":false,"repeats":false,"counts":[{"base":10,"per":3,"max":9,"share":1}],"channels":[{"status":"stun","probability":0.3,"kind":"scaled"}],"critKinds":["inherited"]},"fu-t-poison":{"cls":"special","type":"poison","area":true,"duration":true,"repeats":false,"counts":[{"base":4,"per":1,"max":3,"share":1}],"channels":[{"status":"poison","probability":0.8,"kind":"scaled"},{"status":"poison","probability":0.5,"kind":"scaled"}],"critKinds":["plain"]},"fu-t-ground":{"cls":"physical","type":"ground","area":true,"duration":false,"repeats":false,"counts":[{"base":3,"per":1,"max":3,"share":1}],"channels":[{"status":"stun","probability":0.2,"kind":"scaled"}],"critKinds":["inherited"]},"fu-t-flying":{"cls":"special","type":"flying","area":true,"duration":true,"repeats":false,"counts":[{"base":2,"per":0.3,"max":1,"share":0.3333333333333333},{"base":0,"per":0.5,"max":3,"share":0.3333333333333333},{"base":8,"per":2,"max":8,"share":0.3333333333333333}],"channels":[],"critKinds":["plain"]},"fu-t-psychic":{"cls":"special","type":"psychic","area":true,"duration":false,"repeats":true,"counts":[],"channels":[{"status":"confusion","probability":0.6,"kind":"scaled"}],"critKinds":["inherited"]},"fu-t-bug":{"cls":"physical","type":"bug","area":true,"duration":false,"repeats":false,"counts":[{"base":10,"per":3,"max":10,"share":1}],"channels":[{"status":"poison","probability":0.3,"kind":"scaled"}],"critKinds":["plain"]},"fu-t-rock":{"cls":"physical","type":"rock","area":true,"duration":false,"repeats":false,"counts":[{"base":7,"per":2,"max":6,"share":1}],"channels":[{"status":"stun","probability":0.2,"kind":"scaled"}],"critKinds":["inherited"]},"fu-t-ghost":{"cls":"special","type":"ghost","area":true,"duration":false,"repeats":false,"counts":[{"base":8,"per":2,"max":6,"share":1}],"channels":[{"status":"curse","probability":0.4,"kind":"scaled"}],"critKinds":["inherited"]},"fu-t-dragon":{"cls":"special","type":"dragon","area":true,"duration":true,"repeats":false,"counts":[{"base":6,"per":2,"max":6,"share":1}],"channels":[],"critKinds":["plain","inherited"]},"fu-t-dark":{"cls":"physical","type":"dark","area":true,"duration":false,"repeats":false,"counts":[{"base":8,"per":2,"max":8,"share":1}],"channels":[{"status":"healblock","probability":0.3,"kind":"scaled"}],"critKinds":["inherited"]},"fu-t-steel":{"cls":"physical","type":"steel","area":true,"duration":true,"repeats":false,"counts":[{"base":6,"per":1,"max":6,"share":1}],"channels":[],"critKinds":["plain","inherited"]},"fu-t-fairy":{"cls":"special","type":"fairy","area":true,"duration":false,"repeats":false,"counts":[],"channels":[{"status":"charm","probability":0.3,"kind":"scaled"}],"critKinds":["inherited"]},"fu-r-conduct":{"cls":"special","type":"water","area":true,"duration":false,"repeats":false,"counts":[{"base":10,"per":2,"max":8,"share":1}],"channels":[{"status":"wet","probability":1,"kind":"scaled"},{"status":"paralysis","probability":0.3,"kind":"scaled"}],"critKinds":["inherited"]},"fu-r-steam":{"cls":"special","type":"fire","area":true,"duration":true,"repeats":false,"counts":[{"base":5,"per":1,"max":4,"share":1}],"channels":[{"status":"burn","probability":0.5,"kind":"scaled"},{"status":"wet","probability":1,"kind":"scaled"},{"status":"confusion","probability":0.25,"kind":"scaled"}],"critKinds":["plain","inherited"]},"fu-r-wildfire":{"cls":"special","type":"fire","area":true,"duration":true,"repeats":false,"counts":[],"channels":[{"status":"burn","probability":0.3,"kind":"scaled"},{"status":"burn","probability":0.4,"kind":"scaled"}],"critKinds":["plain","inherited"]},"fu-r-shatter":{"cls":"physical","type":"ice","area":true,"duration":false,"repeats":false,"counts":[],"channels":[{"status":"freeze","probability":0.9,"kind":"scaled"}],"critKinds":["inherited"]},"fu-r-toxicfire":{"cls":"special","type":"poison","area":true,"duration":false,"repeats":false,"counts":[],"channels":[{"status":"poison","probability":1,"kind":"scaled"},{"status":"burn","probability":0.7,"kind":"scaled"}],"critKinds":["inherited"]},"fu-r-nightmare":{"cls":"special","type":"psychic","area":true,"duration":false,"repeats":false,"counts":[{"base":8,"per":2,"max":8,"share":1}],"channels":[{"status":"sleep","probability":0.85,"kind":"scaled"},{"status":"curse","probability":0.3,"kind":"scaled"}],"critKinds":["inherited"]},"fu-r-psyspark":{"cls":"special","type":"electric","area":true,"duration":true,"repeats":false,"counts":[{"base":4,"per":1,"max":2,"share":1}],"channels":[{"status":"confusion","probability":0.15,"kind":"scaled"},{"status":"paralysis","probability":0.15,"kind":"scaled"},{"status":"paralysis","probability":0.2,"kind":"scaled"}],"critKinds":["inherited"]},"fu-r-charmbreath":{"cls":"special","type":"dragon","area":true,"duration":true,"repeats":false,"counts":[],"channels":[{"status":"charm","probability":0.9,"kind":"scaled"}],"critKinds":["inherited"]},"fu-missingno":{"cls":"special","type":"normal","area":false,"duration":false,"repeats":true,"counts":[],"channels":[],"critKinds":[],"copy":["fu-t-normal","fu-t-fire","fu-t-water","fu-t-grass","fu-t-electric","fu-t-ice","fu-t-fighting","fu-t-poison","fu-t-ground","fu-t-flying","fu-t-psychic","fu-t-bug","fu-t-rock","fu-t-ghost","fu-t-dragon","fu-t-dark","fu-t-steel","fu-t-fairy"]}};
const abilityProfiles055 = {"photosynthesis":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"torrent-shell":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"phantom":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"persevere":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"vampire":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"steadfast-aura":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"mew":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"loyal-guard":{"channels":[{"status":"charm","probability":1,"kind":"direct"}],"hooks":[],"callbacks":["tick"],"inputs":["enemy-position","trigger-frequency"],"criticalClasses":[]},"beacon":{"channels":[{"status":"paralysis","probability":0.7,"kind":"scaled"}],"hooks":[],"callbacks":["tick"],"inputs":["enemy-position","trigger-frequency"],"criticalClasses":["special"]},"mud-trail":{"channels":[{"status":"root","probability":0.3,"kind":"scaled"}],"hooks":[],"callbacks":[],"inputs":["enemy-position","trigger-frequency"],"criticalClasses":["special"]},"bone-keeper":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"blessing":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"gem-hoarder":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"horn-pride":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"presage":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"dragon-dream":{"channels":[{"status":"stun","probability":0.5,"kind":"scaled","condition":"landing-vertical-speed-below-minus15"}],"hooks":[],"callbacks":[],"inputs":["enemy-position","trigger-frequency","landing-vertical-speed"],"criticalClasses":["physical"]},"iron-body":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"metamorph":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"venom-sting":{"channels":[{"status":"poison","probability":1,"kind":"direct"}],"hooks":[],"callbacks":[],"inputs":["enemy-position","trigger-frequency"],"criticalClasses":[]},"tailwind":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"serpent-glare":{"channels":[{"status":"paralysis","probability":1,"kind":"direct"}],"hooks":[],"callbacks":["tick"],"inputs":["enemy-position","trigger-frequency"],"criticalClasses":[]},"sand-rush":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"lunar-blessing":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"chlorophyll":{"channels":[{"status":"poison","probability":1,"kind":"scaled"}],"hooks":[],"callbacks":["tick"],"inputs":["enemy-position","trigger-frequency"],"criticalClasses":["special"]},"effect-spore":{"channels":[{"status":"sleep","probability":1,"kind":"direct"},{"status":"poison","probability":1,"kind":"direct"},{"status":"paralysis","probability":1,"kind":"direct"}],"hooks":[],"callbacks":[],"inputs":["enemy-position","trigger-frequency"],"criticalClasses":[]},"compound-eyes":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"arena-trap":{"channels":[{"status":"root","probability":0.8,"kind":"scaled"}],"hooks":[],"callbacks":["tick"],"inputs":["enemy-position","trigger-frequency"],"criticalClasses":["physical"]},"pickup":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"headache":{"channels":[{"status":"confusion","probability":1,"kind":"scaled"}],"hooks":[],"callbacks":["tick"],"inputs":["enemy-position","trigger-frequency"],"criticalClasses":["special"]},"anger-point":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"swift-swim":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"carnivore":{"channels":[{"status":"root","probability":1,"kind":"direct"}],"hooks":[],"callbacks":[],"inputs":["enemy-position","trigger-frequency"],"criticalClasses":[]},"tentacles":{"channels":[{"status":"poison","probability":0.8,"kind":"scaled"}],"hooks":[],"callbacks":["tick"],"inputs":["enemy-position","trigger-frequency"],"criticalClasses":["physical"]},"overgrow":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"blaze":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"torrent":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"swarm":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"levitate":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"keen-eye":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"intimidate":{"channels":[{"status":"charm","probability":1,"kind":"direct"}],"hooks":[],"callbacks":["tick"],"inputs":["enemy-position","trigger-frequency"],"criticalClasses":[]},"pressure":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"sturdy":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"run-away":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"thick-fat":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"poison-point":{"channels":[{"status":"poison","probability":1,"kind":"direct"}],"hooks":[],"callbacks":[],"inputs":["enemy-position","trigger-frequency"],"criticalClasses":[]},"shed-skin":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"static":{"channels":[{"status":"paralysis","probability":1,"kind":"scaled"},{"status":"paralysis","probability":1,"kind":"direct"}],"hooks":[],"callbacks":["tick"],"inputs":["enemy-position","trigger-frequency"],"criticalClasses":["special"]},"cute-charm":{"channels":[{"status":"charm","probability":1,"kind":"direct"}],"hooks":[],"callbacks":[],"inputs":["enemy-position","trigger-frequency"],"criticalClasses":[]},"inner-focus":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"guts":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"clear-body":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"flash-fire":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"water-absorb":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"volt-absorb":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"synchronize":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"oblivious":{"channels":[{"status":"sleep","probability":1,"kind":"direct"}],"hooks":["extraMods"],"callbacks":["tick"],"inputs":["enemy-position","trigger-frequency"],"criticalClasses":[]},"natural-cure":{"channels":[],"hooks":["frame"],"callbacks":["tick"],"inputs":["movement-or-frame-state"],"criticalClasses":[]},"hyper-cutter":{"channels":[{"status":"stun","probability":1,"kind":"direct"}],"hooks":["hitMul"],"callbacks":[],"inputs":["enemy-position","trigger-frequency"],"criticalClasses":[]},"beast-boost":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"rock-head":{"channels":[{"status":"stun","probability":0.5,"kind":"scaled"}],"hooks":["hitMul"],"callbacks":["tick"],"inputs":["enemy-position","trigger-frequency"],"criticalClasses":["physical"]},"insomnia":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"own-tempo":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"protosynthesis":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"quark-drive":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"shield-dust":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"sand-veil":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"snow-cloak":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"limber":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"hustle":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"rivalry":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"leaf-guard":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"prankster":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"soundproof":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"flame-body":{"channels":[{"status":"burn","probability":1,"kind":"scaled"},{"status":"burn","probability":1,"kind":"direct"}],"hooks":["onKill"],"callbacks":[],"inputs":["enemy-position","trigger-frequency"],"criticalClasses":["special"]},"battle-armor":{"channels":[],"hooks":["hurtMod","hitMul"],"callbacks":[],"inputs":[],"criticalClasses":[]},"shell-armor":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"gluttony":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"big-pecks":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"healer":{"channels":[],"hooks":[],"callbacks":["tick"],"inputs":[],"criticalClasses":[]},"vital-spirit":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"stench":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"lightning-rod":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"illuminate":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"mold-breaker":{"channels":[],"hooks":["breakShields","hitMul","critAdd"],"callbacks":[],"inputs":[],"criticalClasses":[]},"early-bird":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"frisk":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"overcoat":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"iron-fist":{"channels":[],"hooks":["hitMul"],"callbacks":["tick"],"inputs":[],"criticalClasses":["physical"]},"sap-sipper":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"strong-jaw":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"magnet-pull":{"channels":[{"status":"paralysis","probability":1,"kind":"direct"}],"hooks":[],"callbacks":["tick"],"inputs":["enemy-position","trigger-frequency"],"criticalClasses":["special"]},"serene-grace":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"speed-boost":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"sand-stream":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"drizzle":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"drought":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"snow-warning":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"rough-skin":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"iron-barbs":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"sheer-force":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"huge-power":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"pure-power":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"technician":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"adaptability":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"skill-link":{"channels":[],"hooks":["extraMods"],"callbacks":[],"inputs":[],"criticalClasses":[]},"multiscale":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"magic-guard":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"moxie":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"super-luck":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"sniper":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"shadow-tag":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"tough-claws":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"pixilate":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"water-veil":{"channels":[],"hooks":["onDodge","extraMods"],"callbacks":[],"inputs":[],"criticalClasses":[]},"magma-armor":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"ice-body":{"channels":[{"status":"freeze","probability":1,"kind":"scaled"}],"hooks":[],"callbacks":["tick"],"inputs":["enemy-position","trigger-frequency"],"criticalClasses":["special"]},"suction-cups":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"honey-gather":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"cheek-pouch":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"reckless":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"steam-engine":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"fluffy":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"unaware":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"defiant":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"justified":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"steadfast":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"hydration":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"anticipation":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"plus":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"minus":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"flower-veil":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"sweet-veil":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"damp":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"bulletproof":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"blazing-hooves":{"channels":[{"status":"burn","probability":0.4,"kind":"scaled"}],"hooks":["frame","extraMods"],"callbacks":[],"inputs":["enemy-position","trigger-frequency","movement-or-frame-state"],"criticalClasses":["special"]},"leek-master":{"channels":[],"hooks":["hitMul"],"callbacks":[],"inputs":[],"criticalClasses":[]},"twin-heads":{"channels":[],"hooks":["onMoveFired"],"callbacks":[],"inputs":[],"criticalClasses":[]},"sludge-body":{"channels":[{"status":"poison","probability":0.6,"kind":"scaled"},{"status":"root","probability":1,"kind":"direct"}],"hooks":["onHurt"],"callbacks":[],"inputs":["enemy-position","trigger-frequency"],"criticalClasses":["special"]},"pendulum":{"channels":[{"status":"sleep","probability":1,"kind":"direct"}],"hooks":[],"callbacks":["tick"],"inputs":["enemy-position","trigger-frequency"],"criticalClasses":[]},"aftermath":{"channels":[{"status":"paralysis","probability":0.6,"kind":"scaled"}],"hooks":["onKill"],"callbacks":[],"inputs":["enemy-position","trigger-frequency"],"criticalClasses":["special"]},"harvest":{"channels":[],"hooks":["extraMods"],"callbacks":["tick"],"inputs":[],"criticalClasses":[]},"limber-kicks":{"channels":[],"hooks":["hitMul"],"callbacks":[],"inputs":[],"criticalClasses":[]},"long-tongue":{"channels":[{"status":"paralysis","probability":1,"kind":"scaled"}],"hooks":[],"callbacks":["tick"],"inputs":["enemy-position","trigger-frequency"],"criticalClasses":["physical"]},"toxic-cloud":{"channels":[{"status":"poison","probability":0.7,"kind":"scaled"}],"hooks":["floats"],"callbacks":["tick"],"inputs":["enemy-position","trigger-frequency"],"criticalClasses":["special"]},"rhino-charge":{"channels":[{"status":"stun","probability":0.3,"kind":"scaled"}],"hooks":["frame"],"callbacks":[],"inputs":["enemy-position","trigger-frequency","movement-or-frame-state"],"criticalClasses":["physical"]},"regenerator":{"channels":[{"status":"root","probability":1,"kind":"scaled"}],"hooks":[],"callbacks":["tick"],"inputs":["enemy-position","trigger-frequency"],"criticalClasses":["physical"]},"parental-bond":{"channels":[],"hooks":["afterHit"],"callbacks":[],"inputs":[],"criticalClasses":[]},"ink-sniper":{"channels":[{"status":"charm","probability":1,"kind":"direct"}],"hooks":["afterHit"],"callbacks":[],"inputs":["enemy-position","trigger-frequency"],"criticalClasses":[]},"star-core":{"channels":[],"hooks":["extraMods"],"callbacks":["tick"],"inputs":[],"criticalClasses":[]},"barrier-wall":{"channels":[],"hooks":[],"callbacks":["tick"],"inputs":[],"criticalClasses":[]},"frost-kiss":{"channels":[{"status":"freeze","probability":1,"kind":"direct"},{"status":"charm","probability":1,"kind":"direct"}],"hooks":["afterHit"],"callbacks":[],"inputs":["enemy-position","trigger-frequency"],"criticalClasses":[]},"motor-drive":{"channels":[],"hooks":["onStatus","frame","damageMul"],"callbacks":[],"inputs":["movement-or-frame-state"],"criticalClasses":[]},"stampede":{"channels":[],"hooks":["frame"],"callbacks":[],"inputs":["movement-or-frame-state"],"criticalClasses":["physical"]},"imposter":{"channels":[],"hooks":["onMoveFired"],"callbacks":["tick"],"inputs":[],"criticalClasses":[]},"download":{"channels":[],"hooks":["critAdd"],"callbacks":["tick"],"inputs":["native-private-critical-charge-counter"],"criticalClasses":[]},"spiral-shell":{"channels":[],"hooks":["hitMul"],"callbacks":["tick"],"inputs":[],"criticalClasses":["physical"]},"ancient-wings":{"channels":[],"hooks":["hitMul"],"callbacks":[],"inputs":[],"criticalClasses":[]},"ice-pressure":{"channels":[{"status":"freeze","probability":1,"kind":"direct"}],"hooks":[],"callbacks":["tick"],"inputs":["enemy-position","trigger-frequency"],"criticalClasses":[]},"volt-pressure":{"channels":[{"status":"paralysis","probability":0.8,"kind":"scaled"}],"hooks":[],"callbacks":["tick"],"inputs":["enemy-position","trigger-frequency"],"criticalClasses":["special"]},"flame-pressure":{"channels":[{"status":"burn","probability":0.9,"kind":"scaled"}],"hooks":[],"callbacks":["tick"],"inputs":["enemy-position","trigger-frequency"],"criticalClasses":["special"]},"genome":{"channels":[{"status":"stun","probability":1,"kind":"direct"}],"hooks":["afterHit"],"callbacks":["tick"],"inputs":["enemy-position","trigger-frequency"],"criticalClasses":[]},"cloud-nine":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"color-change":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"immunity":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"wonder-guard":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"trace":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"rain-dish":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"truant":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"forecast":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"sticky-hold":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"marvel-scale":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"liquid-ooze":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"white-smoke":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"air-lock":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"tangled-feet":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"unburden":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"heatproof":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"simple":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"dry-skin":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"poison-heal":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"solar-power":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"quick-feet":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"normalize":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"no-guard":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"stall":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"klutz":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"forewarn":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"tinted-lens":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"filter":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"slow-start":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"scrappy":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"storm-drain":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"solid-rock":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"multitype":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"flower-gift":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"bad-dreams":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"pickpocket":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"contrary":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"unnerve":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"defeatist":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"cursed-body":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"friend-guard":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"weak-armor":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"heavy-metal":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"light-metal":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"toxic-boost":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"flare-boost":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"telepathy":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"moody":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"poison-touch":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"wonder-skin":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"analytic":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"illusion":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"infiltrator":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"mummy":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"rattled":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"magic-bounce":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"sand-force":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"zen-mode":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"victory-star":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"turboblaze":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"teravolt":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"aroma-veil":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"protean":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"fur-coat":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"magician":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"competitive":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"refrigerate":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"stance-change":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"gale-wings":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"mega-launcher":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"grass-pelt":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"symbiosis":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"gooey":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"aerilate":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"dark-aura":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"fairy-aura":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"aura-break":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"primordial-sea":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"desolate-land":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"delta-stream":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"stamina":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"wimp-out":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"emergency-exit":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"water-compaction":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"merciless":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"shields-down":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"stakeout":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"water-bubble":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"steelworker":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"berserk":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"slush-rush":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"long-reach":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"liquid-voice":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"triage":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"galvanize":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"surge-surfer":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"schooling":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"disguise":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"battle-bond":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"power-construct":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"corrosion":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"comatose":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"queenly-majesty":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"innards-out":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"dancer":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"battery":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"dazzling":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"soul-heart":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"tangling-hair":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"receiver":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"power-of-alchemy":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"rks-system":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"electric-surge":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"psychic-surge":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"misty-surge":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"grassy-surge":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"full-metal-body":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"shadow-shield":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"prism-armor":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"neuroforce":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"intrepid-sword":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"dauntless-shield":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"libero":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"ball-fetch":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"cotton-down":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"propeller-tail":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"mirror-armor":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"gulp-missile":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"stalwart":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"punk-rock":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"sand-spit":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"ice-scales":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"ripen":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"ice-face":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"power-spot":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"mimicry":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"screen-cleaner":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"steely-spirit":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"perish-body":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"wandering-spirit":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"gorilla-tactics":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"neutralizing-gas":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"pastel-veil":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"hunger-switch":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"quick-draw":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"unseen-fist":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"curious-medicine":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"transistor":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"dragons-maw":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"chilling-neigh":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"grim-neigh":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"as-one-glastrier":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"as-one-spectrier":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"lingering-aroma":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"seed-sower":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"thermal-exchange":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"anger-shell":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"purifying-salt":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"well-baked-body":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"wind-rider":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"guard-dog":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"rocky-payload":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"wind-power":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"zero-to-hero":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"commander":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"electromorphosis":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"good-as-gold":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"vessel-of-ruin":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"sword-of-ruin":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"tablets-of-ruin":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"beads-of-ruin":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"orichalcum-pulse":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"hadron-engine":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"opportunist":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"cud-chew":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"sharpness":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"supreme-overlord":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"costar":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"toxic-debris":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"armor-tail":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"earth-eater":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"mycelium-might":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"minds-eye":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"supersweet-syrup":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"hospitality":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"toxic-chain":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"embody-aspect":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"tera-shift":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"tera-shell":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"teraform-zero":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"poison-puppeteer":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"piercing-drill":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"dragonize":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"mega-sol":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"spicy-spray":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"eelevate":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"fire-mane":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]},"aura-guard":{"channels":[],"hooks":[],"callbacks":[],"inputs":[],"criticalClasses":[]}};
const independentItems055 = {"rainbow-wing":{"criticalClasses":["special"],"channels":[{"status":"burn","probability":1,"kind":"scaled"}]},"sun-stone":{"criticalClasses":["special"],"channels":[{"status":"burn","probability":0.7,"kind":"scaled"}]},"silver-wing":{"criticalClasses":["special"],"channels":[]},"electirizer":{"criticalClasses":["special"],"channels":[{"status":"paralysis","probability":0.35,"kind":"scaled"}]},"lustrous-orb":{"criticalClasses":["special"],"channels":[]},"fresh-water":{"criticalClasses":["special"],"channels":[{"status":"wet","probability":1,"kind":"scaled"}]},"old-rod":{"criticalClasses":["physical"],"channels":[{"status":"stun","probability":0.6,"kind":"scaled"},{"status":"wet","probability":1,"kind":"scaled"}]},"iron-ball":{"criticalClasses":["physical"],"channels":[{"status":"stun","probability":0.25,"kind":"scaled"}]},"soda-pop":{"criticalClasses":["special"],"channels":[{"status":"wet","probability":1,"kind":"scaled"}]},"fire-stone":{"criticalClasses":["special"],"channels":[{"status":"burn","probability":0.5,"kind":"scaled"}]},"griseous-orb":{"criticalClasses":["special"],"channels":[{"status":"curse","probability":0.6,"kind":"scaled"}]},"ice-stone":{"criticalClasses":["special"],"channels":[{"status":"freeze","probability":1,"kind":"scaled"}]},"leaf-stone":{"criticalClasses":["physical"],"channels":[]},"thunder-stone":{"criticalClasses":["special"],"channels":[{"status":"paralysis","probability":0.3,"kind":"scaled"}]}};
const randomMovePool055 = [{"key":"pound","type":"normal","cls":"physical","arch":"strike","dmg":14.855384615384615,"cd":0.8075,"count":1,"area":3.3,"speed":0,"dur":0,"status":null,"statusChance":0.12,"critBonus":0,"power":40},{"key":"karate-chop","type":"fighting","cls":"physical","arch":"strike","dmg":15.509230769230768,"cd":0.817,"count":1,"area":3.3,"speed":0,"dur":0,"status":"knock","statusChance":0.12,"critBonus":0.15,"power":50},{"key":"comet-punch","type":"normal","cls":"physical","arch":"barrage","dmg":3.4000000000000004,"cd":0.9774999999999999,"count":5,"area":0.35,"speed":30,"dur":0.6,"status":null,"statusChance":0.12,"critBonus":0,"power":18},{"key":"mega-punch","type":"normal","cls":"physical","arch":"meteor","dmg":46.246153846153845,"cd":3.68,"count":1,"area":4.2,"speed":0,"dur":0.7,"status":null,"statusChance":0.12,"critBonus":0,"power":80},{"key":"pay-day","type":"normal","cls":"physical","arch":"barrage","dmg":3.4953846153846153,"cd":0.9774999999999999,"count":5,"area":0.35,"speed":30,"dur":0.6,"status":null,"statusChance":0.12,"critBonus":0,"power":40},{"key":"fire-punch","type":"fire","cls":"physical","arch":"strike","dmg":17.143846153846155,"cd":0.8644999999999999,"count":1,"area":3.3,"speed":0,"dur":0,"status":"burn","statusChance":0.16000000000000003,"critBonus":0,"power":75},{"key":"ice-punch","type":"ice","cls":"physical","arch":"strike","dmg":17.143846153846155,"cd":0.8644999999999999,"count":1,"area":3.3,"speed":0,"dur":0,"status":"freeze","statusChance":0.16000000000000003,"critBonus":0,"power":75},{"key":"thunder-punch","type":"electric","cls":"physical","arch":"strike","dmg":17.143846153846155,"cd":0.8644999999999999,"count":1,"area":3.3,"speed":0,"dur":0,"status":"paralysis","statusChance":0.16000000000000003,"critBonus":0,"power":75},{"key":"scratch","type":"normal","cls":"physical","arch":"strike","dmg":14.855384615384615,"cd":0.8075,"count":1,"area":3.3,"speed":0,"dur":0,"status":null,"statusChance":0.12,"critBonus":0,"power":40},{"key":"vice-grip","type":"normal","cls":"physical","arch":"strike","dmg":15.836153846153847,"cd":0.8265,"count":1,"area":3.3,"speed":0,"dur":0,"status":"root","statusChance":0.3,"critBonus":0,"power":55},{"key":"guillotine","type":"normal","cls":"physical","arch":"meteor","dmg":57.87,"cd":3.6,"count":1,"area":4.2,"speed":0,"dur":0.7,"status":"stun","statusChance":0.6,"critBonus":0,"power":70},{"key":"cut","type":"normal","cls":"physical","arch":"strike","dmg":15.509230769230768,"cd":0.817,"count":1,"area":3.3,"speed":0,"dur":0,"status":null,"statusChance":0.12,"critBonus":0,"power":50},{"key":"gust","type":"flying","cls":"special","arch":"vortex","dmg":29.71076923076923,"cd":3.06,"count":1,"area":5,"speed":7,"dur":2.2,"status":"knock","statusChance":0.12,"critBonus":0,"power":40},{"key":"wing-attack","type":"flying","cls":"physical","arch":"boomerang","dmg":13.310769230769232,"cd":1.496,"count":1,"area":0.8,"speed":17,"dur":1.3,"status":"knock","statusChance":0.12,"critBonus":0,"power":60},{"key":"fly","type":"flying","cls":"physical","arch":"dash","dmg":23.455384615384613,"cd":2.162,"count":1,"area":1.8,"speed":13,"dur":0,"status":"knock","statusChance":0.12,"critBonus":0,"power":90},{"key":"bind","type":"normal","cls":"physical","arch":"strike","dmg":14.45,"cd":0.8075,"count":1,"area":3.3,"speed":0,"dur":0,"status":"root","statusChance":0.35,"critBonus":0,"power":15},{"key":"slam","type":"normal","cls":"physical","arch":"strike","dmg":17.470769230769232,"cd":0.874,"count":1,"area":3.3,"speed":0,"dur":0,"status":null,"statusChance":0.12,"critBonus":0,"power":80},{"key":"vine-whip","type":"grass","cls":"physical","arch":"strike","dmg":15.182307692307692,"cd":0.8075,"count":1,"area":3.3,"speed":0,"dur":0,"status":"root","statusChance":0.12,"critBonus":0,"power":45},{"key":"stomp","type":"normal","cls":"physical","arch":"nova","dmg":21.34,"cd":2.314,"count":1,"area":6.5,"speed":0,"dur":0,"status":null,"statusChance":0.12,"critBonus":0,"power":65},{"key":"double-kick","type":"fighting","cls":"physical","arch":"barrage","dmg":7.65,"cd":0.9774999999999999,"count":2,"area":0.35,"speed":30,"dur":0.6,"status":"knock","statusChance":0.12,"critBonus":0,"power":30},{"key":"mega-kick","type":"normal","cls":"physical","arch":"dash","dmg":23.63076923076923,"cd":2.3,"count":1,"area":1.8,"speed":13,"dur":0,"status":null,"statusChance":0.12,"critBonus":0,"power":120},{"key":"jump-kick","type":"fighting","cls":"physical","arch":"dash","dmg":22.092307692307692,"cd":2.2079999999999997,"count":1,"area":1.8,"speed":13,"dur":0,"status":"knock","statusChance":0.12,"critBonus":0,"power":100},{"key":"rolling-kick","type":"fighting","cls":"physical","arch":"spin","dmg":8.556923076923077,"cd":0.7040000000000001,"count":1,"area":3.2,"speed":0,"dur":0,"status":"stun","statusChance":0.3,"critBonus":0,"power":60},{"key":"horn-attack","type":"normal","cls":"physical","arch":"strike","dmg":16.49,"cd":0.8454999999999999,"count":1,"area":3.3,"speed":0,"dur":0,"status":null,"statusChance":0.12,"critBonus":0,"power":65},{"key":"fury-attack","type":"normal","cls":"physical","arch":"barrage","dmg":4.25,"cd":0.9774999999999999,"count":4,"area":0.35,"speed":30,"dur":0.6,"status":null,"statusChance":0.12,"critBonus":0,"power":15},{"key":"horn-drill","type":"normal","cls":"physical","arch":"dash","dmg":24.730769230769226,"cd":2.07,"count":1,"area":1.8,"speed":13,"dur":0,"status":null,"statusChance":0.12,"critBonus":0,"power":70},{"key":"tackle","type":"normal","cls":"physical","arch":"dash","dmg":17.476923076923075,"cd":1.9549999999999998,"count":1,"area":1.8,"speed":13,"dur":0,"status":null,"statusChance":0.12,"critBonus":0,"power":40},{"key":"body-slam","type":"normal","cls":"physical","arch":"nova","dmg":23.03230769230769,"cd":2.418,"count":1,"area":6.5,"speed":0,"dur":0,"status":"paralysis","statusChance":0.48,"critBonus":0,"power":85},{"key":"wrap","type":"normal","cls":"physical","arch":"spin","dmg":7.6499999999999995,"cd":0.68,"count":1,"area":3.2,"speed":0,"dur":0,"status":"root","statusChance":0.3,"critBonus":0,"power":15},{"key":"thrash","type":"normal","cls":"physical","arch":"spin","dmg":10.633846153846154,"cd":0.8,"count":1,"area":3.2,"speed":0,"dur":0,"status":null,"statusChance":0.12,"critBonus":0,"power":120},{"key":"double-edge","type":"normal","cls":"physical","arch":"dash","dmg":23.63076923076923,"cd":2.3,"count":1,"area":1.8,"speed":13,"dur":0,"status":null,"statusChance":0.12,"critBonus":0,"power":120},{"key":"poison-sting","type":"poison","cls":"physical","arch":"bolt","dmg":11.049999999999999,"cd":0.85,"count":1,"area":0.5,"speed":24,"dur":0.8,"status":"poison","statusChance":0.48,"critBonus":0,"power":15},{"key":"twineedle","type":"bug","cls":"physical","arch":"barrage","dmg":4.25,"cd":0.9774999999999999,"count":4,"area":0.35,"speed":30,"dur":0.6,"status":"poison","statusChance":0.32000000000000006,"critBonus":0,"power":25},{"key":"bite","type":"dark","cls":"physical","arch":"strike","dmg":16.163076923076925,"cd":0.836,"count":1,"area":3.3,"speed":0,"dur":0,"status":"healblock","statusChance":0.12,"critBonus":0,"power":60},{"key":"sing","type":"normal","cls":"special","arch":"nova","dmg":21.76307692307692,"cd":2.3400000000000003,"count":1,"area":6.5,"speed":0,"dur":0,"status":"sleep","statusChance":0.8,"critBonus":0,"power":70},{"key":"supersonic","type":"normal","cls":"special","arch":"homing","dmg":8.903076923076922,"cd":1.125,"count":2,"area":0.5,"speed":15,"dur":1.6,"status":"confusion","statusChance":0.4,"critBonus":0,"power":70},{"key":"acid","type":"poison","cls":"special","arch":"cone","dmg":2.7963076923076926,"cd":1.7,"count":1,"area":7,"speed":0,"dur":1,"status":"poison","statusChance":0.12,"critBonus":0,"power":40},{"key":"ember","type":"fire","cls":"special","arch":"bolt","dmg":11.36,"cd":0.85,"count":1,"area":0.5,"speed":24,"dur":0.8,"status":"burn","statusChance":0.16000000000000003,"critBonus":0,"power":40},{"key":"flamethrower","type":"fire","cls":"special","arch":"cone","dmg":3.4116923076923076,"cd":1.88,"count":1,"area":7,"speed":0,"dur":1,"status":"burn","statusChance":0.16000000000000003,"critBonus":0,"power":90},{"key":"mist","type":"ice","cls":"special","arch":"aura","dmg":4.451538461538461,"cd":0.405,"count":1,"area":3.6,"speed":0,"dur":0,"status":"freeze","statusChance":0.35,"critBonus":0,"power":70},{"key":"water-gun","type":"water","cls":"special","arch":"bolt","dmg":11.36,"cd":0.85,"count":1,"area":0.5,"speed":24,"dur":0.8,"status":"wet","statusChance":0.12,"critBonus":0,"power":40},{"key":"hydro-pump","type":"water","cls":"special","arch":"beam","dmg":8.001538461538463,"cd":2.156,"count":1,"area":1.1,"speed":18,"dur":0.45,"status":"wet","statusChance":0.12,"critBonus":0,"power":110},{"key":"surf","type":"water","cls":"special","arch":"wave","dmg":15.99230769230769,"cd":2.256,"count":1,"area":4,"speed":13,"dur":1.1,"status":"wet","statusChance":0.12,"critBonus":0,"power":90},{"key":"ice-beam","type":"ice","cls":"special","arch":"beam","dmg":7.4630769230769225,"cd":2.068,"count":1,"area":1.1,"speed":18,"dur":0.45,"status":"freeze","statusChance":0.16000000000000003,"critBonus":0,"power":90},{"key":"blizzard","type":"ice","cls":"special","arch":"cone","dmg":3.657846153846154,"cd":1.96,"count":1,"area":7,"speed":0,"dur":1,"status":"freeze","statusChance":0.16000000000000003,"critBonus":0,"power":110},{"key":"psybeam","type":"psychic","cls":"special","arch":"beam","dmg":6.79,"cd":1.9580000000000002,"count":1,"area":1.1,"speed":18,"dur":0.45,"status":"confusion","statusChance":0.16000000000000003,"critBonus":0,"power":65},{"key":"bubble-beam","type":"water","cls":"special","arch":"barrage","dmg":4.85,"cd":1.0234999999999999,"count":4,"area":0.35,"speed":30,"dur":0.6,"status":"wet","statusChance":0.12,"critBonus":0,"power":65},{"key":"aurora-beam","type":"ice","cls":"special","arch":"beam","dmg":6.79,"cd":1.9580000000000002,"count":1,"area":1.1,"speed":18,"dur":0.45,"status":"freeze","statusChance":0.25,"critBonus":0,"power":65},{"key":"hyper-beam","type":"normal","cls":"special","arch":"beam","dmg":9.078461538461537,"cd":2.3320000000000003,"count":1,"area":1.1,"speed":18,"dur":0.45,"status":null,"statusChance":0.12,"critBonus":0,"power":150},{"key":"peck","type":"flying","cls":"physical","arch":"strike","dmg":14.528461538461537,"cd":0.8075,"count":1,"area":3.3,"speed":0,"dur":0,"status":"knock","statusChance":0.12,"critBonus":0,"power":35},{"key":"drill-peck","type":"flying","cls":"physical","arch":"smite","dmg":24.664615384615384,"cd":1.564,"count":2,"area":1.9,"speed":0,"dur":0,"status":"knock","statusChance":0.12,"critBonus":0,"power":80},{"key":"submission","type":"fighting","cls":"physical","arch":"dash","dmg":20.553846153846152,"cd":2.116,"count":1,"area":1.8,"speed":13,"dur":0,"status":"knock","statusChance":0.12,"critBonus":0,"power":80},{"key":"low-kick","type":"fighting","cls":"physical","arch":"spin","dmg":8.903076923076922,"cd":0.7200000000000001,"count":1,"area":3.2,"speed":0,"dur":0,"status":"knock","statusChance":0.12,"critBonus":0,"power":70},{"key":"seismic-toss","type":"fighting","cls":"physical","arch":"smite","dmg":23.74153846153846,"cd":1.53,"count":2,"area":1.9,"speed":0,"dur":0,"status":"stun","statusChance":0.5,"critBonus":0,"power":70},{"key":"strength","type":"normal","cls":"physical","arch":"dash","dmg":20.553846153846152,"cd":2.116,"count":1,"area":1.8,"speed":13,"dur":0,"status":null,"statusChance":0.12,"critBonus":0,"power":80},{"key":"mega-drain","type":"grass","cls":"special","arch":"drain","dmg":8.738461538461538,"cd":1.105,"count":1,"area":0.5,"speed":18,"dur":1.1,"status":"root","statusChance":0.12,"critBonus":0,"power":40},{"key":"leech-seed","type":"grass","cls":"special","arch":"drain","dmg":9.892307692307691,"cd":1.1700000000000002,"count":1,"area":0.5,"speed":18,"dur":1.1,"status":"root","statusChance":0.25,"critBonus":0,"power":70},{"key":"razor-leaf","type":"grass","cls":"physical","arch":"barrage","dmg":4.657692307692308,"cd":1.0005,"count":4,"area":0.35,"speed":30,"dur":0.6,"status":"root","statusChance":0.12,"critBonus":0.15,"power":55},{"key":"solar-beam","type":"grass","cls":"special","arch":"beam","dmg":8.270769230769229,"cd":2.2,"count":1,"area":1.1,"speed":18,"dur":0.45,"status":"root","statusChance":0.12,"critBonus":0,"power":120},{"key":"poison-powder","type":"poison","cls":"special","arch":"cone","dmg":3.1655384615384614,"cd":1.8,"count":1,"area":7,"speed":0,"dur":1,"status":"poison","statusChance":0.8,"critBonus":0,"power":70},{"key":"stun-spore","type":"grass","cls":"special","arch":"cone","dmg":3.1655384615384614,"cd":1.8,"count":1,"area":7,"speed":0,"dur":1,"status":"paralysis","statusChance":0.35,"critBonus":0,"power":70},{"key":"sleep-powder","type":"grass","cls":"special","arch":"cone","dmg":3.1655384615384614,"cd":1.8,"count":1,"area":7,"speed":0,"dur":1,"status":"sleep","statusChance":0.8,"critBonus":0,"power":70},{"key":"petal-dance","type":"grass","cls":"special","arch":"orbit","dmg":10.633846153846154,"cd":5.5,"count":3,"area":3.2,"speed":3.2,"dur":4,"status":"root","statusChance":0.12,"critBonus":0,"power":120},{"key":"string-shot","type":"bug","cls":"special","arch":"cone","dmg":3.1655384615384614,"cd":1.8,"count":1,"area":7,"speed":0,"dur":1,"status":"root","statusChance":0.35,"critBonus":0,"power":70},{"key":"dragon-rage","type":"dragon","cls":"special","arch":"homing","dmg":8.903076923076922,"cd":1.125,"count":2,"area":0.5,"speed":15,"dur":1.6,"status":null,"statusChance":0.12,"critBonus":0,"power":70},{"key":"fire-spin","type":"fire","cls":"special","arch":"vortex","dmg":29.056923076923074,"cd":3.06,"count":1,"area":5,"speed":7,"dur":2.2,"status":"root","statusChance":0.8,"critBonus":0,"power":35},{"key":"thunder-shock","type":"electric","cls":"special","arch":"bolt","dmg":11.36,"cd":0.85,"count":1,"area":0.5,"speed":24,"dur":0.8,"status":"paralysis","statusChance":0.16000000000000003,"critBonus":0,"power":40},{"key":"thunderbolt","type":"electric","cls":"special","arch":"chain","dmg":13.859999999999998,"cd":1.3159999999999998,"count":3,"area":8,"speed":0,"dur":0,"status":"paralysis","statusChance":0.16000000000000003,"critBonus":0,"power":90},{"key":"thunder-wave","type":"electric","cls":"special","arch":"chain","dmg":10.288,"cd":1.26,"count":3,"area":8,"speed":0,"dur":0,"status":"paralysis","statusChance":0.6,"critBonus":0,"power":70},{"key":"thunder","type":"electric","cls":"special","arch":"smite","dmg":27.433846153846154,"cd":1.666,"count":2,"area":1.9,"speed":0,"dur":0,"status":"paralysis","statusChance":0.48,"critBonus":0,"power":110},{"key":"rock-throw","type":"rock","cls":"physical","arch":"lob","dmg":18.246153846153845,"cd":1.634,"count":1,"area":3.2,"speed":15,"dur":3,"status":"stun","statusChance":0.12,"critBonus":0,"power":50},{"key":"fissure","type":"ground","cls":"physical","arch":"wave","dmg":19.29,"cd":2.16,"count":1,"area":4,"speed":13,"dur":1.1,"status":"stun","statusChance":0.35,"critBonus":0,"power":70},{"key":"toxic","type":"poison","cls":"special","arch":"homing","dmg":8.903076923076922,"cd":1.125,"count":2,"area":0.5,"speed":15,"dur":1.6,"status":"poison","statusChance":0.8,"critBonus":0,"power":70},{"key":"confusion","type":"psychic","cls":"special","arch":"bolt","dmg":11.86,"cd":0.86,"count":1,"area":0.5,"speed":24,"dur":0.8,"status":"confusion","statusChance":0.16000000000000003,"critBonus":0,"power":50},{"key":"psychic","type":"psychic","cls":"special","arch":"nova","dmg":23.455384615384613,"cd":2.444,"count":1,"area":6.5,"speed":0,"dur":0,"status":"confusion","statusChance":0.12,"critBonus":0,"power":90},{"key":"hypnosis","type":"psychic","cls":"special","arch":"homing","dmg":8.903076923076922,"cd":1.125,"count":2,"area":0.5,"speed":15,"dur":1.6,"status":"sleep","statusChance":0.45,"critBonus":0,"power":70},{"key":"quick-attack","type":"normal","cls":"physical","arch":"dash","dmg":17.476923076923075,"cd":1.6617499999999996,"count":1,"area":1.8,"speed":13,"dur":0,"status":null,"statusChance":0.12,"critBonus":0,"power":40},{"key":"night-shade","type":"ghost","cls":"special","arch":"homing","dmg":8.903076923076922,"cd":1.125,"count":2,"area":0.5,"speed":15,"dur":1.6,"status":"curse","statusChance":0.12,"critBonus":0,"power":70},{"key":"confuse-ray","type":"ghost","cls":"special","arch":"homing","dmg":8.903076923076922,"cd":1.125,"count":2,"area":0.5,"speed":15,"dur":1.6,"status":"confusion","statusChance":0.45,"critBonus":0,"power":70},{"key":"barrier","type":"psychic","cls":"special","arch":"orbit","dmg":8.903076923076922,"cd":4.95,"count":3,"area":3.2,"speed":3.2,"dur":4,"status":"confusion","statusChance":0.8,"critBonus":0,"power":70},{"key":"light-screen","type":"psychic","cls":"special","arch":"wave","dmg":14.838461538461537,"cd":2.16,"count":1,"area":4,"speed":13,"dur":1.1,"status":"knock","statusChance":1,"critBonus":0,"power":70},{"key":"self-destruct","type":"normal","cls":"physical","arch":"nova","dmg":34.32,"cd":2.9899999999999998,"count":1,"area":6.5,"speed":0,"dur":0,"status":null,"statusChance":0.12,"critBonus":0,"power":200},{"key":"egg-bomb","type":"normal","cls":"physical","arch":"lob","dmg":22.092307692307692,"cd":1.8239999999999998,"count":1,"area":3.2,"speed":15,"dur":3,"status":null,"statusChance":0.12,"critBonus":0,"power":100},{"key":"lick","type":"ghost","cls":"physical","arch":"strike","dmg":14.45,"cd":0.8075,"count":1,"area":3.3,"speed":0,"dur":0,"status":"paralysis","statusChance":0.48,"critBonus":0,"power":30},{"key":"smog","type":"poison","cls":"special","arch":"cone","dmg":2.72,"cd":1.7,"count":1,"area":7,"speed":0,"dur":1,"status":"poison","statusChance":0.6400000000000001,"critBonus":0,"power":30},{"key":"sludge","type":"poison","cls":"special","arch":"orb","dmg":14.549999999999999,"cd":1.335,"count":1,"area":2.6,"speed":17,"dur":1.05,"status":"poison","statusChance":0.48,"critBonus":0,"power":65},{"key":"bone-club","type":"ground","cls":"physical","arch":"strike","dmg":16.49,"cd":0.8454999999999999,"count":1,"area":3.3,"speed":0,"dur":0,"status":"stun","statusChance":0.12,"critBonus":0,"power":65},{"key":"fire-blast","type":"fire","cls":"special","arch":"orb","dmg":17.146153846153847,"cd":1.47,"count":1,"area":2.6,"speed":17,"dur":1.05,"status":"burn","statusChance":0.16000000000000003,"critBonus":0,"power":110},{"key":"waterfall","type":"water","cls":"physical","arch":"dash","dmg":20.553846153846152,"cd":2.116,"count":1,"area":1.8,"speed":13,"dur":0,"status":"wet","statusChance":0.12,"critBonus":0,"power":80},{"key":"clamp","type":"water","cls":"physical","arch":"strike","dmg":14.528461538461537,"cd":0.8075,"count":1,"area":3.3,"speed":0,"dur":0,"status":"root","statusChance":0.5,"critBonus":0,"power":35},{"key":"swift","type":"normal","cls":"special","arch":"homing","dmg":8.556923076923077,"cd":1.1,"count":2,"area":0.5,"speed":15,"dur":1.6,"status":null,"statusChance":0.12,"critBonus":0,"power":60},{"key":"spike-cannon","type":"normal","cls":"physical","arch":"barrage","dmg":3.6125,"cd":0.9774999999999999,"count":5,"area":0.35,"speed":30,"dur":0.6,"status":null,"statusChance":0.12,"critBonus":0,"power":20},{"key":"constrict","type":"normal","cls":"physical","arch":"spin","dmg":7.6499999999999995,"cd":0.68,"count":1,"area":3.2,"speed":0,"dur":0,"status":"root","statusChance":0.3,"critBonus":0,"power":10},{"key":"high-jump-kick","type":"fighting","cls":"physical","arch":"smite","dmg":39.528000000000006,"cd":1.734,"count":1,"area":1.9,"speed":0,"dur":0,"status":"knock","statusChance":0.12,"critBonus":0,"power":130},{"key":"dream-eater","type":"psychic","cls":"special","arch":"drain","dmg":13.255384615384616,"cd":1.248,"count":1,"area":0.5,"speed":18,"dur":1.1,"status":"confusion","statusChance":0.12,"critBonus":0,"power":100},{"key":"poison-gas","type":"poison","cls":"special","arch":"trail","dmg":5.935384615384615,"cd":0.25200000000000006,"count":1,"area":1.7,"speed":0,"dur":3,"status":"poison","statusChance":0.7,"critBonus":0,"power":70},{"key":"barrage","type":"normal","cls":"physical","arch":"barrage","dmg":4.25,"cd":0.9774999999999999,"count":4,"area":0.35,"speed":30,"dur":0.6,"status":null,"statusChance":0.12,"critBonus":0,"power":15},{"key":"leech-life","type":"bug","cls":"physical","arch":"drain","dmg":10.276923076923076,"cd":1.1960000000000002,"count":1,"area":0.5,"speed":18,"dur":1.1,"status":"poison","statusChance":0.12,"critBonus":0,"power":80},{"key":"lovely-kiss","type":"normal","cls":"special","arch":"homing","dmg":8.903076923076922,"cd":1.125,"count":2,"area":0.5,"speed":15,"dur":1.6,"status":"sleep","statusChance":0.5,"critBonus":0,"power":70},{"key":"bubble","type":"water","cls":"special","arch":"barrage","dmg":4.369230769230769,"cd":0.9774999999999999,"count":4,"area":0.35,"speed":30,"dur":0.6,"status":"wet","statusChance":0.12,"critBonus":0,"power":40},{"key":"dizzy-punch","type":"normal","cls":"physical","arch":"strike","dmg":16.816923076923075,"cd":0.855,"count":1,"area":3.3,"speed":0,"dur":0,"status":"confusion","statusChance":0.32000000000000006,"critBonus":0,"power":70},{"key":"spore","type":"grass","cls":"special","arch":"trap","dmg":27,"cd":2.3400000000000003,"count":2,"area":3,"speed":0,"dur":14,"status":"sleep","statusChance":1,"critBonus":0,"power":70},{"key":"psywave","type":"psychic","cls":"special","arch":"wave","dmg":14.838461538461537,"cd":2.16,"count":1,"area":4,"speed":13,"dur":1.1,"status":"confusion","statusChance":0.3,"critBonus":0,"power":70},{"key":"crabhammer","type":"water","cls":"physical","arch":"smite","dmg":26.510769230769228,"cd":1.632,"count":2,"area":1.9,"speed":0,"dur":0,"status":"wet","statusChance":0.12,"critBonus":0.15,"power":100},{"key":"explosion","type":"normal","cls":"physical","arch":"meteor","dmg":76.05,"cd":4.6,"count":1,"area":4.2,"speed":0,"dur":0.7,"status":null,"statusChance":0.12,"critBonus":0,"power":250},{"key":"fury-swipes","type":"normal","cls":"physical","arch":"barrage","dmg":4.25,"cd":0.9774999999999999,"count":4,"area":0.35,"speed":30,"dur":0.6,"status":null,"statusChance":0.12,"critBonus":0,"power":18},{"key":"bonemerang","type":"ground","cls":"physical","arch":"boomerang","dmg":12.772307692307692,"cd":1.462,"count":1,"area":0.8,"speed":17,"dur":1.3,"status":"stun","statusChance":0.12,"critBonus":0,"power":50},{"key":"rock-slide","type":"rock","cls":"physical","arch":"smite","dmg":24.203076923076924,"cd":1.547,"count":2,"area":1.9,"speed":0,"dur":0,"status":"stun","statusChance":0.12,"critBonus":0,"power":75},{"key":"hyper-fang","type":"normal","cls":"physical","arch":"strike","dmg":17.470769230769232,"cd":0.874,"count":1,"area":3.3,"speed":0,"dur":0,"status":null,"statusChance":0.12,"critBonus":0,"power":80},{"key":"tri-attack","type":"normal","cls":"special","arch":"chain","dmg":13.36,"cd":1.288,"count":3,"area":8,"speed":0,"dur":0,"status":null,"statusChance":0.12,"critBonus":0,"power":80},{"key":"super-fang","type":"normal","cls":"physical","arch":"chain","dmg":12.86,"cd":1.26,"count":3,"area":8,"speed":0,"dur":0,"status":null,"statusChance":0.12,"critBonus":0,"power":70},{"key":"slash","type":"normal","cls":"physical","arch":"strike","dmg":16.816923076923075,"cd":0.855,"count":1,"area":3.3,"speed":0,"dur":0,"status":null,"statusChance":0.12,"critBonus":0.15,"power":70},{"key":"nightmare","type":"ghost","cls":"special","arch":"homing","dmg":8.903076923076922,"cd":1.125,"count":2,"area":0.5,"speed":15,"dur":1.6,"status":"curse","statusChance":0.6,"critBonus":0,"power":70},{"key":"flame-wheel","type":"fire","cls":"physical","arch":"trail","dmg":5.704615384615385,"cd":0.24640000000000004,"count":1,"area":1.7,"speed":0,"dur":3,"status":"burn","statusChance":0.16000000000000003,"critBonus":0,"power":60},{"key":"snore","type":"normal","cls":"special","arch":"nova","dmg":20.07076923076923,"cd":2.236,"count":1,"area":6.5,"speed":0,"dur":0,"status":"stun","statusChance":0.3,"critBonus":0,"power":50},{"key":"flail","type":"normal","cls":"physical","arch":"strike","dmg":16.816923076923075,"cd":0.855,"count":1,"area":3.3,"speed":0,"dur":0,"status":null,"statusChance":0.12,"critBonus":0,"power":70},{"key":"reversal","type":"fighting","cls":"physical","arch":"nova","dmg":23.939384615384615,"cd":2.3400000000000003,"count":1,"area":6.5,"speed":0,"dur":0,"status":"knock","statusChance":0.12,"critBonus":0,"power":70},{"key":"sweet-kiss","type":"fairy","cls":"special","arch":"homing","dmg":8.903076923076922,"cd":1.125,"count":2,"area":0.5,"speed":15,"dur":1.6,"status":"confusion","statusChance":0.45,"critBonus":0,"power":70},{"key":"sludge-bomb","type":"poison","cls":"special","arch":"lob","dmg":21.32307692307692,"cd":1.7859999999999998,"count":1,"area":3.2,"speed":15,"dur":3,"status":"poison","statusChance":0.48,"critBonus":0,"power":90},{"key":"octazooka","type":"water","cls":"special","arch":"orb","dmg":14.549999999999999,"cd":1.335,"count":1,"area":2.6,"speed":17,"dur":1.05,"status":"charm","statusChance":0.3,"critBonus":0,"power":65},{"key":"perish-song","type":"normal","cls":"special","arch":"meteor","dmg":62.32153846153845,"cd":3.6,"count":1,"area":4.2,"speed":0,"dur":0.7,"status":"curse","statusChance":1,"critBonus":0,"power":70},{"key":"icy-wind","type":"ice","cls":"special","arch":"cone","dmg":2.980923076923077,"cd":1.74,"count":1,"area":7,"speed":0,"dur":1,"status":"freeze","statusChance":0.4,"critBonus":0,"power":55},{"key":"bone-rush","type":"ground","cls":"physical","arch":"orbit","dmg":7.6499999999999995,"cd":4.675,"count":2,"area":3.2,"speed":3.2,"dur":4,"status":"stun","statusChance":0.12,"critBonus":0,"power":25},{"key":"lock-on","type":"normal","cls":"special","arch":"homing","dmg":8.903076923076922,"cd":1.125,"count":3,"area":0.5,"speed":15,"dur":1.6,"status":"curse","statusChance":0.5,"critBonus":0,"power":70},{"key":"giga-drain","type":"grass","cls":"special","arch":"drain","dmg":10.084615384615386,"cd":1.183,"count":1,"area":0.5,"speed":18,"dur":1.1,"status":"root","statusChance":0.12,"critBonus":0,"power":75},{"key":"rollout","type":"rock","cls":"physical","arch":"boomerang","dmg":11.9,"cd":1.4449999999999998,"count":1,"area":0.8,"speed":17,"dur":1.3,"status":"stun","statusChance":0.12,"critBonus":0,"power":30},{"key":"false-swipe","type":"normal","cls":"physical","arch":"boomerang","dmg":12.233846153846153,"cd":1.4449999999999998,"count":2,"area":0.8,"speed":17,"dur":1.3,"status":null,"statusChance":0.12,"critBonus":0,"power":40},{"key":"spark","type":"electric","cls":"physical","arch":"dash","dmg":19.4,"cd":2.0469999999999997,"count":1,"area":1.8,"speed":13,"dur":0,"status":"paralysis","statusChance":0.48,"critBonus":0,"power":65},{"key":"fury-cutter","type":"bug","cls":"physical","arch":"strike","dmg":14.855384615384615,"cd":0.8075,"count":1,"area":3.3,"speed":0,"dur":0,"status":"poison","statusChance":0.12,"critBonus":0,"power":40},{"key":"sacred-fire","type":"fire","cls":"physical","arch":"meteor","dmg":49.707692307692305,"cd":3.84,"count":1,"area":4.2,"speed":0,"dur":0.7,"status":"burn","statusChance":0.8,"critBonus":0,"power":100},{"key":"magnitude","type":"ground","cls":"physical","arch":"nova","dmg":21.76307692307692,"cd":2.3400000000000003,"count":1,"area":6.5,"speed":0,"dur":0,"status":"stun","statusChance":0.12,"critBonus":0,"power":70},{"key":"dynamic-punch","type":"fighting","cls":"physical","arch":"nova","dmg":24.30153846153846,"cd":2.496,"count":1,"area":6.5,"speed":0,"dur":0,"status":"confusion","statusChance":0.8,"critBonus":0,"power":100},{"key":"pursuit","type":"dark","cls":"physical","arch":"homing","dmg":7.864615384615385,"cd":1.0625,"count":2,"area":0.5,"speed":15,"dur":1.6,"status":"healblock","statusChance":0.12,"critBonus":0,"power":40},{"key":"rapid-spin","type":"normal","cls":"physical","arch":"spin","dmg":8.21076923076923,"cd":0.6880000000000001,"count":1,"area":3.2,"speed":0,"dur":0,"status":null,"statusChance":0.12,"critBonus":0,"power":50},{"key":"iron-tail","type":"steel","cls":"physical","arch":"strike","dmg":18.77846153846154,"cd":0.9119999999999999,"count":1,"area":3.3,"speed":0,"dur":0,"status":"knock","statusChance":0.12,"critBonus":0,"power":100},{"key":"vital-throw","type":"fighting","cls":"physical","arch":"spin","dmg":8.903076923076922,"cd":0.7200000000000001,"count":1,"area":3.2,"speed":0,"dur":0,"status":"knock","statusChance":1,"critBonus":0,"power":70},{"key":"cross-chop","type":"fighting","cls":"physical","arch":"strike","dmg":18.77846153846154,"cd":0.9119999999999999,"count":1,"area":3.3,"speed":0,"dur":0,"status":"knock","statusChance":0.12,"critBonus":0.15,"power":100},{"key":"twister","type":"dragon","cls":"special","arch":"vortex","dmg":29.71076923076923,"cd":3.06,"count":1,"area":5,"speed":7,"dur":2.2,"status":null,"statusChance":0.12,"critBonus":0,"power":40},{"key":"extreme-speed","type":"normal","cls":"physical","arch":"dash","dmg":20.553846153846152,"cd":1.7986,"count":1,"area":1.8,"speed":13,"dur":0,"status":null,"statusChance":0.12,"critBonus":0,"power":80},{"key":"ancient-power","type":"rock","cls":"special","arch":"orbit","dmg":8.556923076923077,"cd":4.84,"count":2,"area":3.2,"speed":3.2,"dur":4,"status":"stun","statusChance":0.12,"critBonus":0,"power":60},{"key":"shadow-ball","type":"ghost","cls":"special","arch":"orb","dmg":15.415384615384616,"cd":1.3800000000000001,"count":1,"area":2.6,"speed":17,"dur":1.05,"status":"curse","statusChance":0.12,"critBonus":0,"power":80},{"key":"future-sight","type":"psychic","cls":"special","arch":"meteor","dmg":53.169230769230765,"cd":4,"count":1,"area":4.2,"speed":0,"dur":0.7,"status":"confusion","statusChance":0.12,"critBonus":0,"power":120},{"key":"whirlpool","type":"water","cls":"special","arch":"vortex","dmg":29.056923076923074,"cd":3.06,"count":1,"area":5,"speed":7,"dur":2.2,"status":"root","statusChance":0.8,"critBonus":0,"power":35},{"key":"fake-out","type":"normal","cls":"physical","arch":"strike","dmg":14.855384615384615,"cd":0.6863749999999998,"count":1,"area":3.3,"speed":0,"dur":0,"status":"stun","statusChance":0.6,"critBonus":0,"power":40},{"key":"uproar","type":"normal","cls":"special","arch":"nova","dmg":23.455384615384613,"cd":2.444,"count":1,"area":6.5,"speed":0,"dur":0,"status":"confusion","statusChance":0.25,"critBonus":0,"power":90},{"key":"heat-wave","type":"fire","cls":"special","arch":"cone","dmg":3.4732307692307693,"cd":1.9,"count":1,"area":7,"speed":0,"dur":1,"status":"burn","statusChance":0.16000000000000003,"critBonus":0,"power":95},{"key":"will-o-wisp","type":"fire","cls":"special","arch":"homing","dmg":8.903076923076922,"cd":1.125,"count":2,"area":0.5,"speed":15,"dur":1.6,"status":"burn","statusChance":0.8,"critBonus":0,"power":70},{"key":"focus-punch","type":"fighting","cls":"physical","arch":"meteor","dmg":72.95192307692307,"cd":4.24,"count":1,"area":4.2,"speed":0,"dur":0.7,"status":"stun","statusChance":0.7,"critBonus":0,"power":150},{"key":"superpower","type":"fighting","cls":"physical","arch":"nova","dmg":25.99384615384615,"cd":2.6,"count":1,"area":6.5,"speed":0,"dur":0,"status":"stun","statusChance":0.4,"critBonus":0,"power":120},{"key":"yawn","type":"normal","cls":"special","arch":"homing","dmg":8.903076923076922,"cd":1.125,"count":2,"area":0.5,"speed":15,"dur":1.6,"status":"sleep","statusChance":0.5,"critBonus":0,"power":70},{"key":"knock-off","type":"dark","cls":"physical","arch":"boomerang","dmg":13.58,"cd":1.513,"count":1,"area":0.8,"speed":17,"dur":1.3,"status":"knock","statusChance":0.5,"critBonus":0,"power":65},{"key":"eruption","type":"fire","cls":"special","arch":"meteor","dmg":64.19769230769231,"cd":4.24,"count":1,"area":4.2,"speed":0,"dur":0.7,"status":"burn","statusChance":0.8,"critBonus":0,"power":150},{"key":"dive","type":"water","cls":"physical","arch":"dash","dmg":20.553846153846152,"cd":2.116,"count":1,"area":1.8,"speed":13,"dur":0,"status":"wet","statusChance":0.12,"critBonus":0,"power":80},{"key":"feather-dance","type":"flying","cls":"special","arch":"homing","dmg":8.903076923076922,"cd":1.125,"count":3,"area":0.5,"speed":15,"dur":1.6,"status":"charm","statusChance":0.3,"critBonus":0,"power":70},{"key":"blaze-kick","type":"fire","cls":"physical","arch":"strike","dmg":17.797692307692305,"cd":0.8835,"count":1,"area":3.3,"speed":0,"dur":0,"status":"burn","statusChance":0.16000000000000003,"critBonus":0.15,"power":85},{"key":"hyper-voice","type":"normal","cls":"special","arch":"nova","dmg":23.455384615384613,"cd":2.444,"count":1,"area":6.5,"speed":0,"dur":0,"status":null,"statusChance":0.12,"critBonus":0,"power":90},{"key":"poison-fang","type":"poison","cls":"physical","arch":"strike","dmg":15.509230769230768,"cd":0.817,"count":1,"area":3.3,"speed":0,"dur":0,"status":"poison","statusChance":0.8,"critBonus":0,"power":50},{"key":"crush-claw","type":"normal","cls":"physical","arch":"strike","dmg":17.143846153846155,"cd":0.8644999999999999,"count":1,"area":3.3,"speed":0,"dur":0,"status":null,"statusChance":0.12,"critBonus":0,"power":75},{"key":"hydro-cannon","type":"water","cls":"special","arch":"beam","dmg":9.078461538461537,"cd":2.3320000000000003,"count":1,"area":1.1,"speed":18,"dur":0.45,"status":"wet","statusChance":0.12,"critBonus":0,"power":150},{"key":"air-cutter","type":"flying","cls":"special","arch":"barrage","dmg":4.753846153846154,"cd":1.012,"count":4,"area":0.35,"speed":30,"dur":0.6,"status":"knock","statusChance":0.12,"critBonus":0.15,"power":60},{"key":"overheat","type":"fire","cls":"special","arch":"meteor","dmg":54.9,"cd":4.08,"count":1,"area":4.2,"speed":0,"dur":0.7,"status":"burn","statusChance":0.6,"critBonus":0,"power":130},{"key":"rock-tomb","type":"rock","cls":"physical","arch":"smite","dmg":22.81846153846154,"cd":1.496,"count":2,"area":1.9,"speed":0,"dur":0,"status":"root","statusChance":0.4,"critBonus":0,"power":60},{"key":"silver-wind","type":"bug","cls":"special","arch":"cone","dmg":3.0424615384615388,"cd":1.76,"count":1,"area":7,"speed":0,"dur":1,"status":"poison","statusChance":0.12,"critBonus":0,"power":60},{"key":"water-spout","type":"water","cls":"special","arch":"nova","dmg":28.53230769230769,"cd":2.7560000000000002,"count":1,"area":6.5,"speed":0,"dur":0,"status":"wet","statusChance":0.6,"critBonus":0,"power":150},{"key":"signal-beam","type":"bug","cls":"special","arch":"beam","dmg":7.059230769230769,"cd":2.0020000000000002,"count":1,"area":1.1,"speed":18,"dur":0.45,"status":"confusion","statusChance":0.16000000000000003,"critBonus":0,"power":75},{"key":"extrasensory","type":"psychic","cls":"special","arch":"homing","dmg":9.249230769230769,"cd":1.1500000000000001,"count":2,"area":0.5,"speed":15,"dur":1.6,"status":"confusion","statusChance":0.12,"critBonus":0,"power":80},{"key":"sheer-cold","type":"ice","cls":"special","arch":"nova","dmg":25.027538461538455,"cd":2.3400000000000003,"count":1,"area":6.5,"speed":0,"dur":0,"status":"freeze","statusChance":0.9,"critBonus":0,"power":70},{"key":"aerial-ace","type":"flying","cls":"physical","arch":"homing","dmg":8.556923076923077,"cd":1.1,"count":2,"area":0.5,"speed":15,"dur":1.6,"status":"knock","statusChance":0.12,"critBonus":0,"power":60},{"key":"icicle-spear","type":"ice","cls":"physical","arch":"barrage","dmg":3.6125,"cd":0.9774999999999999,"count":5,"area":0.35,"speed":30,"dur":0.6,"status":"freeze","statusChance":0.12,"critBonus":0,"power":25},{"key":"bounce","type":"flying","cls":"physical","arch":"smite","dmg":25.126153846153844,"cd":1.581,"count":2,"area":1.9,"speed":0,"dur":0,"status":"paralysis","statusChance":0.48,"critBonus":0,"power":85},{"key":"mud-shot","type":"ground","cls":"special","arch":"bolt","dmg":12.11,"cd":0.87,"count":1,"area":0.5,"speed":24,"dur":0.8,"status":"root","statusChance":0.25,"critBonus":0,"power":55},{"key":"rock-blast","type":"rock","cls":"physical","arch":"barrage","dmg":4.25,"cd":0.9774999999999999,"count":4,"area":0.35,"speed":30,"dur":0.6,"status":"stun","statusChance":0.12,"critBonus":0,"power":25},{"key":"water-pulse","type":"water","cls":"special","arch":"orb","dmg":14.261538461538462,"cd":1.32,"count":1,"area":2.6,"speed":17,"dur":1.05,"status":"confusion","statusChance":0.32000000000000006,"critBonus":0,"power":60},{"key":"psycho-boost","type":"psychic","cls":"special","arch":"meteor","dmg":65.12538461538462,"cd":4.16,"count":1,"area":4.2,"speed":0,"dur":0.7,"status":"confusion","statusChance":0.12,"critBonus":0,"power":140},{"key":"gravity","type":"psychic","cls":"special","arch":"vortex","dmg":33.63384615384615,"cd":3.24,"count":1,"area":5,"speed":7,"dur":2.2,"status":"stun","statusChance":0.4,"critBonus":0,"power":70},{"key":"gyro-ball","type":"steel","cls":"physical","arch":"spin","dmg":10.683692307692306,"cd":0.7200000000000001,"count":1,"area":3.2,"speed":0,"dur":0,"status":"knock","statusChance":0.12,"critBonus":0,"power":70},{"key":"brine","type":"water","cls":"special","arch":"orb","dmg":14.549999999999999,"cd":1.335,"count":1,"area":2.6,"speed":17,"dur":1.05,"status":"wet","statusChance":0.12,"critBonus":0,"power":65},{"key":"pluck","type":"flying","cls":"physical","arch":"strike","dmg":16.163076923076925,"cd":0.836,"count":1,"area":3.3,"speed":0,"dur":0,"status":"knock","statusChance":0.12,"critBonus":0,"power":60},{"key":"u-turn","type":"bug","cls":"physical","arch":"boomerang","dmg":13.849230769230768,"cd":1.53,"count":1,"area":0.8,"speed":17,"dur":1.3,"status":"poison","statusChance":0.12,"critBonus":0,"power":70},{"key":"payback","type":"dark","cls":"physical","arch":"strike","dmg":15.509230769230768,"cd":0.817,"count":1,"area":3.3,"speed":0,"dur":0,"status":"healblock","statusChance":0.12,"critBonus":0,"power":50},{"key":"assurance","type":"dark","cls":"physical","arch":"dash","dmg":19.015384615384615,"cd":2.024,"count":1,"area":1.8,"speed":13,"dur":0,"status":"healblock","statusChance":0.12,"critBonus":0,"power":60},{"key":"wring-out","type":"normal","cls":"special","arch":"strike","dmg":16.816923076923075,"cd":0.855,"count":1,"area":3.3,"speed":0,"dur":0,"status":"paralysis","statusChance":0.4,"critBonus":0,"power":70},{"key":"gastro-acid","type":"poison","cls":"special","arch":"lob","dmg":19.784615384615382,"cd":1.71,"count":1,"area":3.2,"speed":15,"dur":3,"status":"curse","statusChance":0.8,"critBonus":0,"power":70},{"key":"last-resort","type":"normal","cls":"physical","arch":"meteor","dmg":56.63076923076923,"cd":4.16,"count":1,"area":4.2,"speed":0,"dur":0.7,"status":null,"statusChance":0.12,"critBonus":0,"power":140},{"key":"toxic-spikes","type":"poison","cls":"special","arch":"trap","dmg":27,"cd":2.3400000000000003,"count":2,"area":3,"speed":0,"dur":14,"status":"poison","statusChance":0.8,"critBonus":0,"power":70},{"key":"flare-blitz","type":"fire","cls":"physical","arch":"dash","dmg":23.63076923076923,"cd":2.3,"count":1,"area":1.8,"speed":13,"dur":0,"status":"burn","statusChance":0.16000000000000003,"critBonus":0,"power":120},{"key":"aura-sphere","type":"fighting","cls":"special","arch":"homing","dmg":9.249230769230769,"cd":1.1500000000000001,"count":2,"area":0.5,"speed":15,"dur":1.6,"status":"knock","statusChance":0.12,"critBonus":0,"power":80},{"key":"poison-jab","type":"poison","cls":"physical","arch":"strike","dmg":13.103076923076923,"cd":0.874,"count":2,"area":3.3,"speed":0,"dur":0,"status":"poison","statusChance":0.48,"critBonus":0,"power":80},{"key":"aqua-tail","type":"water","cls":"physical","arch":"strike","dmg":18.12461538461538,"cd":0.8929999999999999,"count":1,"area":3.3,"speed":0,"dur":0,"status":"wet","statusChance":0.12,"critBonus":0,"power":90},{"key":"seed-bomb","type":"grass","cls":"physical","arch":"lob","dmg":20.553846153846152,"cd":1.748,"count":1,"area":3.2,"speed":15,"dur":3,"status":"root","statusChance":0.12,"critBonus":0,"power":80},{"key":"air-slash","type":"flying","cls":"special","arch":"boomerang","dmg":14.118461538461538,"cd":1.547,"count":1,"area":0.8,"speed":17,"dur":1.3,"status":"knock","statusChance":0.12,"critBonus":0,"power":75},{"key":"x-scissor","type":"bug","cls":"physical","arch":"boomerang","dmg":14.387692307692308,"cd":1.564,"count":1,"area":0.8,"speed":17,"dur":1.3,"status":"poison","statusChance":0.12,"critBonus":0,"power":80},{"key":"bug-buzz","type":"bug","cls":"special","arch":"nova","dmg":23.455384615384613,"cd":2.444,"count":1,"area":6.5,"speed":0,"dur":0,"status":"poison","statusChance":0.12,"critBonus":0,"power":90},{"key":"dragon-pulse","type":"dragon","cls":"special","arch":"beam","dmg":7.3284615384615375,"cd":2.0460000000000003,"count":1,"area":1.1,"speed":18,"dur":0.45,"status":null,"statusChance":0.12,"critBonus":0,"power":85},{"key":"drain-punch","type":"fighting","cls":"physical","arch":"strike","dmg":17.143846153846155,"cd":0.8644999999999999,"count":1,"area":3.3,"speed":0,"dur":0,"status":"knock","statusChance":0.12,"critBonus":0,"power":75},{"key":"focus-blast","type":"fighting","cls":"special","arch":"orb","dmg":17.72307692307692,"cd":1.5,"count":1,"area":2.6,"speed":17,"dur":1.05,"status":"knock","statusChance":0.12,"critBonus":0,"power":120},{"key":"energy-ball","type":"grass","cls":"special","arch":"orb","dmg":15.99230769230769,"cd":1.41,"count":1,"area":2.6,"speed":17,"dur":1.05,"status":"root","statusChance":0.12,"critBonus":0,"power":90},{"key":"brave-bird","type":"flying","cls":"physical","arch":"dash","dmg":23.63076923076923,"cd":2.3,"count":1,"area":1.8,"speed":13,"dur":0,"status":"knock","statusChance":0.12,"critBonus":0,"power":120},{"key":"earth-power","type":"ground","cls":"special","arch":"smite","dmg":25.587692307692304,"cd":1.5979999999999999,"count":2,"area":1.9,"speed":0,"dur":0,"status":"stun","statusChance":0.12,"critBonus":0,"power":90},{"key":"giga-impact","type":"normal","cls":"physical","arch":"meteor","dmg":58.36153846153846,"cd":4.24,"count":1,"area":4.2,"speed":0,"dur":0.7,"status":null,"statusChance":0.12,"critBonus":0,"power":150},{"key":"thunder-fang","type":"electric","cls":"physical","arch":"strike","dmg":16.49,"cd":0.8454999999999999,"count":1,"area":3.3,"speed":0,"dur":0,"status":"paralysis","statusChance":0.35,"critBonus":0,"power":65},{"key":"fire-fang","type":"fire","cls":"physical","arch":"strike","dmg":16.49,"cd":0.8454999999999999,"count":1,"area":3.3,"speed":0,"dur":0,"status":"burn","statusChance":0.16000000000000003,"critBonus":0,"power":65},{"key":"shadow-sneak","type":"ghost","cls":"physical","arch":"dash","dmg":17.476923076923075,"cd":1.6617499999999996,"count":1,"area":1.8,"speed":13,"dur":0,"status":"curse","statusChance":0.35,"critBonus":0,"power":40},{"key":"psycho-cut","type":"psychic","cls":"physical","arch":"boomerang","dmg":9.694461538461537,"cd":1.53,"count":2,"area":0.8,"speed":17,"dur":1.3,"status":"confusion","statusChance":0.12,"critBonus":0.15,"power":70},{"key":"zen-headbutt","type":"psychic","cls":"physical","arch":"dash","dmg":20.553846153846152,"cd":2.116,"count":1,"area":1.8,"speed":13,"dur":0,"status":"confusion","statusChance":0.12,"critBonus":0,"power":80},{"key":"mirror-shot","type":"steel","cls":"special","arch":"orb","dmg":14.549999999999999,"cd":1.335,"count":1,"area":2.6,"speed":17,"dur":1.05,"status":"charm","statusChance":0.25,"critBonus":0,"power":65},{"key":"flash-cannon","type":"steel","cls":"special","arch":"beam","dmg":7.193846153846154,"cd":2.0240000000000005,"count":1,"area":1.1,"speed":18,"dur":0.45,"status":"knock","statusChance":0.12,"critBonus":0,"power":80},{"key":"rock-climb","type":"normal","cls":"physical","arch":"spin","dmg":9.595384615384614,"cd":0.752,"count":1,"area":3.2,"speed":0,"dur":0,"status":"confusion","statusChance":0.3,"critBonus":0,"power":90},{"key":"trick-room","type":"psychic","cls":"special","arch":"vortex","dmg":33.63384615384615,"cd":3.24,"count":1,"area":5,"speed":7,"dur":2.2,"status":"stun","statusChance":0.5,"critBonus":0,"power":70},{"key":"draco-meteor","type":"dragon","cls":"special","arch":"meteor","dmg":54.9,"cd":4.08,"count":1,"area":4.2,"speed":0,"dur":0.7,"status":null,"statusChance":0.12,"critBonus":0,"power":130},{"key":"discharge","type":"electric","cls":"special","arch":"nova","dmg":22.60923076923077,"cd":2.3920000000000003,"count":1,"area":6.5,"speed":0,"dur":0,"status":"paralysis","statusChance":0.48,"critBonus":0,"power":80},{"key":"lava-plume","type":"fire","cls":"special","arch":"nova","dmg":22.60923076923077,"cd":2.3920000000000003,"count":1,"area":6.5,"speed":0,"dur":0,"status":"burn","statusChance":0.48,"critBonus":0,"power":80},{"key":"power-whip","type":"grass","cls":"physical","arch":"spin","dmg":10.633846153846154,"cd":0.8,"count":1,"area":3.2,"speed":0,"dur":0,"status":"root","statusChance":0.12,"critBonus":0,"power":120},{"key":"rock-wrecker","type":"rock","cls":"physical","arch":"meteor","dmg":58.36153846153846,"cd":4.24,"count":1,"area":4.2,"speed":0,"dur":0.7,"status":"stun","statusChance":0.12,"critBonus":0,"power":150},{"key":"gunk-shot","type":"poison","cls":"physical","arch":"meteor","dmg":53.169230769230765,"cd":4,"count":1,"area":4.2,"speed":0,"dur":0.7,"status":"poison","statusChance":0.48,"critBonus":0,"power":120},{"key":"iron-head","type":"steel","cls":"physical","arch":"dash","dmg":20.553846153846152,"cd":2.116,"count":1,"area":1.8,"speed":13,"dur":0,"status":"stun","statusChance":0.3,"critBonus":0,"power":80},{"key":"magnet-bomb","type":"steel","cls":"physical","arch":"homing","dmg":8.556923076923077,"cd":1.1,"count":2,"area":0.5,"speed":15,"dur":1.6,"status":"knock","statusChance":0.12,"critBonus":0,"power":60},{"key":"stealth-rock","type":"rock","cls":"special","arch":"trap","dmg":27,"cd":2.3400000000000003,"count":3,"area":3,"speed":0,"dur":14,"status":"stun","statusChance":0.8,"critBonus":0,"power":70},{"key":"grass-knot","type":"grass","cls":"special","arch":"smite","dmg":23.74153846153846,"cd":1.53,"count":2,"area":1.9,"speed":0,"dur":0,"status":"stun","statusChance":0.3,"critBonus":0,"power":70},{"key":"bug-bite","type":"bug","cls":"physical","arch":"strike","dmg":16.163076923076925,"cd":0.836,"count":1,"area":3.3,"speed":0,"dur":0,"status":"poison","statusChance":0.12,"critBonus":0,"power":60},{"key":"wood-hammer","type":"grass","cls":"physical","arch":"strike","dmg":20.086153846153845,"cd":0.95,"count":1,"area":3.3,"speed":0,"dur":0,"status":"root","statusChance":0.12,"critBonus":0,"power":120},{"key":"aqua-jet","type":"water","cls":"physical","arch":"dash","dmg":17.476923076923075,"cd":1.6617499999999996,"count":1,"area":1.8,"speed":13,"dur":0,"status":"wet","statusChance":0.12,"critBonus":0,"power":40},{"key":"head-smash","type":"rock","cls":"physical","arch":"dash","dmg":33.72,"cd":2.4379999999999997,"count":1,"area":1.8,"speed":13,"dur":0,"status":"stun","statusChance":0.12,"critBonus":0,"power":150},{"key":"double-hit","type":"normal","cls":"physical","arch":"barrage","dmg":6.836923076923077,"cd":0.9774999999999999,"count":2,"area":0.35,"speed":30,"dur":0.6,"status":null,"statusChance":0.12,"critBonus":0,"power":35},{"key":"psyshock","type":"psychic","cls":"special","arch":"orb","dmg":15.415384615384616,"cd":1.3800000000000001,"count":1,"area":2.6,"speed":17,"dur":1.05,"status":"confusion","statusChance":0.12,"critBonus":0,"power":80},{"key":"venoshock","type":"poison","cls":"special","arch":"chain","dmg":12.61,"cd":1.246,"count":3,"area":8,"speed":0,"dur":0,"status":"poison","statusChance":0.35,"critBonus":0,"power":65},{"key":"smack-down","type":"rock","cls":"physical","arch":"bolt","dmg":11.86,"cd":0.86,"count":1,"area":0.5,"speed":24,"dur":0.8,"status":"stun","statusChance":0.25,"critBonus":0,"power":50},{"key":"storm-throw","type":"fighting","cls":"physical","arch":"strike","dmg":16.163076923076925,"cd":0.836,"count":1,"area":3.3,"speed":0,"dur":0,"status":"knock","statusChance":0.12,"critBonus":0.15,"power":60},{"key":"flame-burst","type":"fire","cls":"special","arch":"orb","dmg":14.838461538461537,"cd":1.35,"count":1,"area":2.6,"speed":17,"dur":1.05,"status":"burn","statusChance":0.12,"critBonus":0,"power":70},{"key":"sludge-wave","type":"poison","cls":"special","arch":"wave","dmg":16.28076923076923,"cd":2.28,"count":1,"area":4,"speed":13,"dur":1.1,"status":"poison","statusChance":0.16000000000000003,"critBonus":0,"power":95},{"key":"heavy-slam","type":"steel","cls":"physical","arch":"smite","dmg":30.864,"cd":1.53,"count":1,"area":1.9,"speed":0,"dur":0,"status":"stun","statusChance":0.5,"critBonus":0,"power":70},{"key":"electro-ball","type":"electric","cls":"special","arch":"orb","dmg":14.838461538461537,"cd":1.35,"count":1,"area":2.6,"speed":17,"dur":1.05,"status":"paralysis","statusChance":0.12,"critBonus":0,"power":70},{"key":"soak","type":"water","cls":"special","arch":"cone","dmg":3.7986461538461533,"cd":1.8,"count":1,"area":7,"speed":0,"dur":1,"status":"wet","statusChance":1,"critBonus":0,"power":70},{"key":"flame-charge","type":"fire","cls":"physical","arch":"dash","dmg":18.246153846153845,"cd":1.9779999999999998,"count":1,"area":1.8,"speed":13,"dur":0,"status":"burn","statusChance":0.12,"critBonus":0,"power":50},{"key":"acid-spray","type":"poison","cls":"special","arch":"lob","dmg":17.476923076923075,"cd":1.615,"count":1,"area":3.2,"speed":15,"dur":3,"status":"poison","statusChance":0.12,"critBonus":0,"power":40},{"key":"round","type":"normal","cls":"special","arch":"homing","dmg":8.556923076923077,"cd":1.1,"count":2,"area":0.5,"speed":15,"dur":1.6,"status":null,"statusChance":0.12,"critBonus":0,"power":60},{"key":"echoed-voice","type":"normal","cls":"special","arch":"wave","dmg":13.107692307692307,"cd":2.04,"count":1,"area":4,"speed":13,"dur":1.1,"status":null,"statusChance":0.12,"critBonus":0,"power":40},{"key":"clear-smog","type":"poison","cls":"special","arch":"orb","dmg":13.684615384615384,"cd":1.29,"count":1,"area":2.6,"speed":17,"dur":1.05,"status":"poison","statusChance":0.12,"critBonus":0,"power":50},{"key":"stored-power","type":"psychic","cls":"special","arch":"homing","dmg":7.6499999999999995,"cd":1.0625,"count":2,"area":0.5,"speed":15,"dur":1.6,"status":"confusion","statusChance":0.12,"critBonus":0,"power":20},{"key":"scald","type":"water","cls":"special","arch":"cone","dmg":3.288615384615385,"cd":1.84,"count":1,"area":7,"speed":0,"dur":1,"status":"burn","statusChance":0.3,"critBonus":0,"power":80},{"key":"hex","type":"ghost","cls":"special","arch":"chain","dmg":12.61,"cd":1.246,"count":3,"area":8,"speed":0,"dur":0,"status":"curse","statusChance":0.12,"critBonus":0,"power":65},{"key":"circle-throw","type":"fighting","cls":"physical","arch":"spin","dmg":8.556923076923077,"cd":0.7040000000000001,"count":1,"area":3.2,"speed":0,"dur":0,"status":"knock","statusChance":1,"critBonus":0,"power":60},{"key":"incinerate","type":"fire","cls":"special","arch":"cone","dmg":3.0424615384615388,"cd":1.76,"count":1,"area":7,"speed":0,"dur":1,"status":"burn","statusChance":0.4,"critBonus":0,"power":60},{"key":"acrobatics","type":"flying","cls":"physical","arch":"dash","dmg":18.630769230769232,"cd":2.001,"count":1,"area":1.8,"speed":13,"dur":0,"status":"knock","statusChance":0.12,"critBonus":0,"power":55},{"key":"final-gambit","type":"fighting","cls":"special","arch":"meteor","dmg":51.1926923076923,"cd":3.6,"count":1,"area":4.2,"speed":0,"dur":0.7,"status":"knock","statusChance":0.12,"critBonus":0,"power":70},{"key":"inferno","type":"fire","cls":"special","arch":"orb","dmg":16.569230769230767,"cd":1.44,"count":1,"area":2.6,"speed":17,"dur":1.05,"status":"burn","statusChance":1,"critBonus":0,"power":100},{"key":"bulldoze","type":"ground","cls":"physical","arch":"nova","dmg":20.916923076923077,"cd":2.2880000000000003,"count":1,"area":6.5,"speed":0,"dur":0,"status":"stun","statusChance":0.12,"critBonus":0,"power":60},{"key":"frost-breath","type":"ice","cls":"special","arch":"cone","dmg":3.0424615384615388,"cd":1.76,"count":1,"area":7,"speed":0,"dur":1,"status":"freeze","statusChance":0.6,"critBonus":0.15,"power":60},{"key":"electroweb","type":"electric","cls":"special","arch":"cone","dmg":2.980923076923077,"cd":1.74,"count":1,"area":7,"speed":0,"dur":1,"status":"root","statusChance":0.3,"critBonus":0,"power":55},{"key":"wild-charge","type":"electric","cls":"physical","arch":"dash","dmg":21.32307692307692,"cd":2.162,"count":1,"area":1.8,"speed":13,"dur":0,"status":"paralysis","statusChance":0.12,"critBonus":0,"power":90},{"key":"drill-run","type":"ground","cls":"physical","arch":"dash","dmg":20.553846153846152,"cd":2.116,"count":1,"area":1.8,"speed":13,"dur":0,"status":"stun","statusChance":0.12,"critBonus":0.15,"power":80},{"key":"heart-stamp","type":"psychic","cls":"physical","arch":"strike","dmg":16.163076923076925,"cd":0.836,"count":1,"area":3.3,"speed":0,"dur":0,"status":"stun","statusChance":0.3,"critBonus":0,"power":60},{"key":"horn-leech","type":"grass","cls":"physical","arch":"dash","dmg":20.169230769230772,"cd":2.093,"count":1,"area":1.8,"speed":13,"dur":0,"status":"root","statusChance":0.12,"critBonus":0,"power":75},{"key":"sacred-sword","type":"fighting","cls":"physical","arch":"boomerang","dmg":10.44830769230769,"cd":1.5979999999999999,"count":2,"area":0.8,"speed":17,"dur":1.3,"status":"knock","statusChance":0.12,"critBonus":0,"power":90},{"key":"razor-shell","type":"water","cls":"physical","arch":"strike","dmg":12.857884615384616,"cd":0.8644999999999999,"count":2,"area":3.3,"speed":0,"dur":0,"status":"wet","statusChance":0.12,"critBonus":0,"power":75},{"key":"psystrike","type":"psychic","cls":"special","arch":"orb","dmg":16.569230769230767,"cd":1.44,"count":1,"area":2.6,"speed":17,"dur":1.05,"status":"confusion","statusChance":0.3,"critBonus":0,"power":100},{"key":"hurricane","type":"flying","cls":"special","arch":"vortex","dmg":38.864615384615384,"cd":3.528,"count":1,"area":5,"speed":7,"dur":2.2,"status":"confusion","statusChance":0.48,"critBonus":0,"power":110},{"key":"searing-shot","type":"fire","cls":"special","arch":"orb","dmg":16.569230769230767,"cd":1.44,"count":1,"area":2.6,"speed":17,"dur":1.05,"status":"burn","statusChance":0.5,"critBonus":0,"power":100},{"key":"techno-blast","type":"normal","cls":"special","arch":"beam","dmg":8.270769230769229,"cd":2.2,"count":1,"area":1.1,"speed":18,"dur":0.45,"status":null,"statusChance":0.12,"critBonus":0,"power":120},{"key":"glaciate","type":"ice","cls":"special","arch":"wave","dmg":14.549999999999999,"cd":2.136,"count":1,"area":4,"speed":13,"dur":1.1,"status":"freeze","statusChance":0.6,"critBonus":0,"power":65},{"key":"bolt-strike","type":"electric","cls":"physical","arch":"meteor","dmg":54.9,"cd":4.08,"count":1,"area":4.2,"speed":0,"dur":0.7,"status":"paralysis","statusChance":0.6,"critBonus":0,"power":130},{"key":"icicle-crash","type":"ice","cls":"physical","arch":"smite","dmg":16.332,"cd":1.581,"count":3,"area":1.9,"speed":0,"dur":0,"status":"stun","statusChance":0.3,"critBonus":0,"power":85},{"key":"fusion-bolt","type":"electric","cls":"physical","arch":"chain","dmg":14.36,"cd":1.3439999999999999,"count":3,"area":8,"speed":0,"dur":0,"status":"paralysis","statusChance":0.3,"critBonus":0,"power":100},{"key":"belch","type":"poison","cls":"special","arch":"cone","dmg":4.348061538461538,"cd":2,"count":1,"area":7,"speed":0,"dur":1,"status":"poison","statusChance":0.5,"critBonus":0,"power":120},{"key":"parabolic-charge","type":"electric","cls":"special","arch":"aura","dmg":4.365,"cd":0.4005,"count":1,"area":3.6,"speed":0,"dur":0,"status":"paralysis","statusChance":0.12,"critBonus":0,"power":65},{"key":"petal-blizzard","type":"grass","cls":"physical","arch":"nova","dmg":23.455384615384613,"cd":2.444,"count":1,"area":6.5,"speed":0,"dur":0,"status":"root","statusChance":0.12,"critBonus":0,"power":90},{"key":"freeze-dry","type":"ice","cls":"special","arch":"orb","dmg":14.838461538461537,"cd":1.35,"count":1,"area":2.6,"speed":17,"dur":1.05,"status":"freeze","statusChance":0.4,"critBonus":0,"power":70},{"key":"draining-kiss","type":"fairy","cls":"special","arch":"drain","dmg":9.123076923076923,"cd":1.118,"count":1,"area":0.5,"speed":18,"dur":1.1,"status":"charm","statusChance":0.12,"critBonus":0,"power":50},{"key":"play-rough","type":"fairy","cls":"physical","arch":"spin","dmg":9.595384615384614,"cd":0.752,"count":1,"area":3.2,"speed":0,"dur":0,"status":"charm","statusChance":0.12,"critBonus":0,"power":90},{"key":"moonblast","type":"fairy","cls":"special","arch":"orb","dmg":16.28076923076923,"cd":1.4249999999999998,"count":1,"area":2.6,"speed":17,"dur":1.05,"status":"charm","statusChance":0.12,"critBonus":0,"power":95},{"key":"boomburst","type":"normal","cls":"special","arch":"nova","dmg":27.686153846153847,"cd":2.704,"count":1,"area":6.5,"speed":0,"dur":0,"status":null,"statusChance":0.12,"critBonus":0,"power":140},{"key":"water-shuriken","type":"water","cls":"special","arch":"barrage","dmg":4.25,"cd":0.8308749999999998,"count":4,"area":0.35,"speed":30,"dur":0.6,"status":"wet","statusChance":0.12,"critBonus":0,"power":15},{"key":"mystical-fire","type":"fire","cls":"special","arch":"homing","dmg":9.076153846153847,"cd":1.1375,"count":2,"area":0.5,"speed":15,"dur":1.6,"status":"burn","statusChance":0.12,"critBonus":0,"power":75},{"key":"dragon-ascent","type":"flying","cls":"physical","arch":"meteor","dmg":58.48615384615385,"cd":4,"count":1,"area":4.2,"speed":0,"dur":0.7,"status":"knock","statusChance":0.12,"critBonus":0,"power":120},{"key":"high-horsepower","type":"ground","cls":"physical","arch":"dash","dmg":21.70769230769231,"cd":2.1849999999999996,"count":1,"area":1.8,"speed":13,"dur":0,"status":"stun","statusChance":0.12,"critBonus":0,"power":95},{"key":"solar-blade","type":"grass","cls":"physical","arch":"beam","dmg":8.405384615384616,"cd":2.2220000000000004,"count":1,"area":1.1,"speed":18,"dur":0.45,"status":"root","statusChance":0.12,"critBonus":0,"power":125},{"key":"lunge","type":"bug","cls":"physical","arch":"dash","dmg":20.553846153846152,"cd":2.116,"count":1,"area":1.8,"speed":13,"dur":0,"status":"poison","statusChance":0.12,"critBonus":0,"power":80},{"key":"smart-strike","type":"steel","cls":"physical","arch":"homing","dmg":8.903076923076922,"cd":1.125,"count":2,"area":0.5,"speed":15,"dur":1.6,"status":"knock","statusChance":0.12,"critBonus":0,"power":70},{"key":"stomping-tantrum","type":"ground","cls":"physical","arch":"nova","dmg":22.186153846153847,"cd":2.366,"count":1,"area":6.5,"speed":0,"dur":0,"status":"stun","statusChance":0.12,"critBonus":0,"power":75},{"key":"shadow-bone","type":"ghost","cls":"physical","arch":"boomerang","dmg":10.259846153846151,"cd":1.581,"count":3,"area":0.8,"speed":17,"dur":1.3,"status":"curse","statusChance":0.12,"critBonus":0,"power":85},{"key":"liquidation","type":"water","cls":"physical","arch":"dash","dmg":20.93846153846154,"cd":2.139,"count":1,"area":1.8,"speed":13,"dur":0,"status":"wet","statusChance":0.12,"critBonus":0,"power":85},{"key":"prismatic-laser","type":"psychic","cls":"special","arch":"beam","dmg":9.1,"cd":2.3760000000000003,"count":1,"area":1.1,"speed":18,"dur":0.45,"status":"confusion","statusChance":0.12,"critBonus":0,"power":160},{"key":"photon-geyser","type":"psychic","cls":"special","arch":"beam","dmg":7.732307692307692,"cd":2.112,"count":1,"area":1.1,"speed":18,"dur":0.45,"status":"confusion","statusChance":0.12,"critBonus":0,"power":100},{"key":"snipe-shot","type":"water","cls":"special","arch":"bolt","dmg":13.36,"cd":0.92,"count":1,"area":0.5,"speed":24,"dur":0.8,"status":"wet","statusChance":0.12,"critBonus":0.15,"power":80},{"key":"bolt-beak","type":"electric","cls":"physical","arch":"dash","dmg":20.93846153846154,"cd":2.139,"count":1,"area":1.8,"speed":13,"dur":0,"status":"paralysis","statusChance":0.25,"critBonus":0,"power":85},{"key":"fishious-rend","type":"water","cls":"physical","arch":"strike","dmg":17.797692307692305,"cd":0.8835,"count":1,"area":3.3,"speed":0,"dur":0,"status":"wet","statusChance":0.12,"critBonus":0,"power":85},{"key":"body-press","type":"fighting","cls":"physical","arch":"nova","dmg":22.60923076923077,"cd":2.3920000000000003,"count":1,"area":6.5,"speed":0,"dur":0,"status":"knock","statusChance":0.12,"critBonus":0,"power":80},{"key":"meteor-assault","type":"fighting","cls":"physical","arch":"meteor","dmg":70.03384615384614,"cd":4.24,"count":1,"area":4.2,"speed":0,"dur":0.7,"status":"knock","statusChance":0.12,"critBonus":0,"power":150},{"key":"expanding-force","type":"psychic","cls":"special","arch":"nova","dmg":22.60923076923077,"cd":2.3920000000000003,"count":1,"area":6.5,"speed":0,"dur":0,"status":"confusion","statusChance":0.12,"critBonus":0,"power":80},{"key":"scale-shot","type":"dragon","cls":"physical","arch":"barrage","dmg":3.6125,"cd":0.9774999999999999,"count":5,"area":0.35,"speed":30,"dur":0.6,"status":null,"statusChance":0.12,"critBonus":0,"power":25},{"key":"meteor-beam","type":"rock","cls":"special","arch":"beam","dmg":8.270769230769229,"cd":2.2,"count":1,"area":1.1,"speed":18,"dur":0.45,"status":"stun","statusChance":0.12,"critBonus":0,"power":120},{"key":"misty-explosion","type":"fairy","cls":"special","arch":"nova","dmg":29.16184615384615,"cd":2.496,"count":1,"area":6.5,"speed":0,"dur":0,"status":"charm","statusChance":0.35,"critBonus":0,"power":100},{"key":"rising-voltage","type":"electric","cls":"special","arch":"smite","dmg":23.74153846153846,"cd":1.53,"count":2,"area":1.9,"speed":0,"dur":0,"status":"paralysis","statusChance":0.12,"critBonus":0,"power":70},{"key":"dual-wingbeat","type":"flying","cls":"physical","arch":"barrage","dmg":7.864615384615384,"cd":0.9774999999999999,"count":2,"area":0.35,"speed":30,"dur":0.6,"status":"knock","statusChance":0.12,"critBonus":0,"power":40},{"key":"thunder-cage","type":"electric","cls":"special","arch":"vortex","dmg":34.941538461538464,"cd":3.3120000000000003,"count":1,"area":5,"speed":7,"dur":2.2,"status":"root","statusChance":0.8,"critBonus":0,"power":80},{"key":"stone-axe","type":"rock","cls":"physical","arch":"trap","dmg":29.099999999999998,"cd":2.314,"count":2,"area":3,"speed":0,"dur":14,"status":"stun","statusChance":0.12,"critBonus":0,"power":65},{"key":"headlong-rush","type":"ground","cls":"physical","arch":"meteor","dmg":63.803076923076915,"cd":4,"count":1,"area":4.2,"speed":0,"dur":0.7,"status":"stun","statusChance":0.5,"critBonus":0,"power":120},{"key":"bleakwind-storm","type":"flying","cls":"special","arch":"cone","dmg":3.5347692307692307,"cd":1.92,"count":1,"area":7,"speed":0,"dur":1,"status":"freeze","statusChance":0.3,"critBonus":0,"power":100},{"key":"wildbolt-storm","type":"electric","cls":"special","arch":"cone","dmg":3.5347692307692307,"cd":1.92,"count":1,"area":7,"speed":0,"dur":1,"status":"paralysis","statusChance":0.35,"critBonus":0,"power":100},{"key":"ice-spinner","type":"ice","cls":"physical","arch":"spin","dmg":9.249230769230769,"cd":0.7360000000000001,"count":1,"area":3.2,"speed":0,"dur":0,"status":"freeze","statusChance":0.3,"critBonus":0,"power":80},{"key":"raging-bull","type":"normal","cls":"physical","arch":"dash","dmg":24.521538461538455,"cd":2.162,"count":1,"area":1.8,"speed":13,"dur":0,"status":null,"statusChance":0.12,"critBonus":0,"power":90},{"key":"rage-fist","type":"ghost","cls":"physical","arch":"homing","dmg":8.21076923076923,"cd":1.075,"count":2,"area":0.5,"speed":15,"dur":1.6,"status":"curse","statusChance":0.12,"critBonus":0,"power":50},{"key":"aqua-cutter","type":"water","cls":"physical","arch":"boomerang","dmg":13.849230769230768,"cd":1.53,"count":1,"area":0.8,"speed":17,"dur":1.3,"status":"wet","statusChance":0.12,"critBonus":0,"power":70},{"key":"electro-shot","type":"electric","cls":"special","arch":"beam","dmg":8.54,"cd":2.244,"count":1,"area":1.1,"speed":18,"dur":0.45,"status":"paralysis","statusChance":0.25,"critBonus":0,"power":130},{"key":"thunderclap","type":"electric","cls":"special","arch":"smite","dmg":15.432,"cd":1.3005,"count":3,"area":1.9,"speed":0,"dur":0,"status":"paralysis","statusChance":0.5,"critBonus":0,"power":70},{"key":"psychic-noise","type":"psychic","cls":"special","arch":"wave","dmg":15.126923076923077,"cd":2.184,"count":1,"area":4,"speed":13,"dur":1.1,"status":"healblock","statusChance":0.5,"critBonus":0,"power":75}];
const globalMoveStats055 = {"bolt":["count","area","dur","speed"],"orb":["count","area","dur","speed"],"lob":["count","area"],"barrage":["count","area","dur","speed"],"homing":["count","area","dur","speed"],"beam":["count","area","dur"],"cone":["area","dur"],"nova":["area"],"aura":["area"],"orbit":["count","area","dur","speed"],"strike":["area","count"],"dash":["area","count","speed"],"chain":["count","area"],"smite":["count","area"],"meteor":["count","area"],"boomerang":["count","area","dur","speed"],"trap":["count","area","dur"],"vortex":["count","area","dur","speed"],"wave":["count","area","dur","speed"],"trail":["area","dur"],"drain":["count","area","dur","speed"],"spin":["area"],"weather":["dur"],"buff":["dur"],"random":["count","area","dur","speed"]};
// END audited native055 mechanics
function fusionBenefitProfile(move) {
  const d=move.def || move;
  if(d.arch!=='fusion'&&!d.fusion)return null;
  const p=fusionProfiles055[d.key];
  if(!p?.copy)return p||null;
  const choices=p.copy.map(key=>fusionProfiles055[key]);
  return {...p,area:choices.some(c=>c.area),duration:choices.some(c=>c.duration),
    counts:choices.flatMap(c=>c.counts.map(n=>({...n,share:n.share/choices.length})))};
}

function fusionVariants(move) {
  const d=move.def||move,p=fusionProfiles055[d.key];
  return p?.copy?p.copy.map(key=>({key,profile:{...fusionProfiles055[key],repeats:p.repeats},weight:1/p.copy.length})):
    p?[{key:d.key,profile:p,weight:1}]:[];
}

function moveClassFraction(move,cls) {
  const d=move.def||move,p=fusionProfiles055[d.key];
  if(d.arch==='random')return randomMovePool055.filter(m=>m.cls===cls).length/randomMovePool055.length;
  if(p?.copy)return p.copy.filter(k=>fusionProfiles055[k].cls===cls).length/p.copy.length;
  return +(d.cls===cls);
}

function effectiveBenefitMoves(moves) {
  return moves.flatMap(move=>{
    const d=move.def||move,p=fusionProfiles055[d.key];
    if(d.arch==='random')return randomMovePool055.map(def=>({...move,def,ownerDef:d,
      choiceWeight:1/randomMovePool055.length,randomOwner:d.key||'random'}));
    if(p?.copy)return p.copy.map(key=>({...move,def:{...d,cls:fusionProfiles055[key].cls,type:fusionProfiles055[key].type},
      ownerDef:d,benefitRecipeKey:key,choiceWeight:1/p.copy.length}));
    return [move];
  });
}

const plainCriticalArchitectures055=new Set(['bolt','drain','homing','orb','boomerang','lob','barrage','trap','vortex','wave','trail']);
const nativeStatuses055=new Set(['burn','poison','paralysis','freeze','sleep','confusion','wet','curse','healblock','charm','root','stun']);

function moveCriticalBonuses(move,player) {
  const d=move.def||move,owner=move.ownerDef||d,
    inherited=(Number(d.critBonus)||0)+(Number(move.mods?.crit)||0),
    extra=player.ability==='pickup'?Math.min(.15,Math.max(0,Number(player.run?.stats?.gold)||0)/1e4):
      player.ability==='mold-breaker'&&owner.key==='storm-throw'?1:0,
    profile=fusionProfiles055[move.benefitRecipeKey||d.key],
    kinds=profile?.critKinds?.length?profile.critKinds:plainCriticalArchitectures055.has(d.arch)?['plain']:['inherited'];
  return kinds.map(kind=>extra+(kind==='inherited'?inherited:0));
}

function independentCriticalSources(player) {
  const sources=[];
  for(const [key,profile]of Object.entries(independentItems055))
    if((player.items?.get?.(key)||0)>0&&profile.criticalClasses.length)sources.push('item:'+key);
  if(abilityProfiles055[player.ability]?.criticalClasses.length)sources.push('ability:'+player.ability);
  // The native landing attack has no skill slot or inherited move crit bonus.
  // Its availability is observed from the native player, never invoked here.
  if(typeof player.slam==='function')sources.push('player:ground-slam');
  return sources;
}

function independentDamageClasses(player) {
  return [
    ...(abilityProfiles055[player.ability]?.criticalClasses||[]),
    ...Object.entries(independentItems055).flatMap(([key,p])=>(player.items?.get?.(key)||0)>0?p.criticalClasses:[]),
    ...(typeof player.slam==='function'?['physical']:[]),
  ];
}

// All channels below are defined by native055. A probability is conditional on
// the source hitting/triggering; it is not an enemy uptime or total-DPS share.
export function playerStatusChannels(player={}) {
  const channels=[],unknown=[],add=(rows,source,weight=1,statusMod=1)=>{
    for(const row of rows||[]) {
      if(!nativeStatuses055.has(row.status))continue;
      if(row.condition==='player-first-type'&&({water:'wet',electric:'paralysis',fire:'burn'}[player.types?.[0]])!==row.status)continue;
      channels.push({...row,source,weight,probability:row.probability*(row.kind==='scaled'?statusMod:1)});
    }
  };
  for(const move of (player.moves||[]).filter(Boolean)) {
    const d=move.def||move;
    if(d.arch==='fusion'||d.fusion) {
      const variants=fusionVariants(move);
      if(!variants.length)unknown.push('fusion:'+d.key);
      for(const v of variants)add(v.profile.channels,d.key,v.weight);
    } else if(d.arch==='random') {
      for(const sub of randomMovePool055)if(sub.status)add([{status:sub.status,probability:sub.statusChance??.15,kind:'scaled'}],d.key,1/randomMovePool055.length,move.mods?.status??1);
    } else if(!globalMoveStats055[d.arch])unknown.push('architecture:'+(d.arch||'missing'));
    else if(!['buff','weather'].includes(d.arch)&&d.status)
      add([{status:d.status,probability:d.statusChance??.15,kind:'scaled'}],d.key,1,move.mods?.status??1);
  }
  for(const [key,chance,status]of [['flame-orb',.05,'burn'],['toxic-orb',.06,'poison'],['snowball',.06,'freeze'],['grip-claw',.04,'root'],['awakening',.025,'sleep']]) {
    const count=player.items?.get?.(key)||0;if(count)add([{status,probability:chance*count,kind:'scaled'}],key);
  }
  // These item attacks share Combat.strike's probability multiplier even when
  // their clocks/critical/kill triggers themselves do not scale with it.
  for(const [key,profile]of Object.entries(independentItems055))if((player.items?.get?.(key)||0)>0)
    add(profile.channels,key);
  const ability=abilityProfiles055[player.ability];
  if(ability) {
    let rows=ability.channels;
    if(player.ability==='hyper-cutter'&&!player.moves?.some(m=>(m?.def||m)?.arch==='strike'))rows=[];
    if(player.ability==='carnivore'&&!player.moves?.some(m=>['strike','spin'].includes((m?.def||m)?.arch)))rows=[];
    add(rows,'ability:'+player.ability);
  } else if(player.ability)unknown.push('ability:'+player.ability);
  if(typeof player.onMoveFired==='function')unknown.push('external-player-callback');
  return {channels,unknown,mechanismsKnown:unknown.length===0,
    interpretation:'conditional-source-probabilities;not-trigger-rate-or-DPS'};
}

export function inspectPlayerMechanics(player={}) {
  const status=playerStatusChannels(player),moves=(player.moves||[]).filter(Boolean).map(move=>{
    const d=move.def||move,f=fusionBenefitProfile(move),known=d.arch==='fusion'||d.fusion?!!f:!!globalMoveStats055[d.arch];
    return {key:d.key,architecture:d.arch,mechanismKnown:known,globalStats:f?['area',...(f.duration?['dur']:[]),...(f.counts.length||f.repeats?['count']:[])]:globalMoveStats055[d.arch]||[],
      inputs:known?['enemy-position','hit-coverage',...(d.arch==='random'?['random-submove','swap-phase','frame-delta']:[]),...(d.arch==='barrage'?['queue-length','timer-phase','frame-delta']:[]),...(fusionProfiles055[d.key]?.copy?['random-recipe-outcome']:[])]:['unrecognized-native-definition']};
  });
  return {nativeVersion:'0.8.55',moves,ability:{key:player.ability||null,mechanismKnown:!player.ability||!!abilityProfiles055[player.ability],
    hooks:abilityProfiles055[player.ability]?.hooks||[],inputs:abilityProfiles055[player.ability]?.inputs||[]},status};
}

function benefitShadow(player, nativeRun, mods, stable = false, application = {}) {
  if (typeof player?.recompute !== "function" || !nativeRun || !Array.isArray(nativeRun.tempMods)) return null;
  try {
    const shadow = Object.assign(Object.create(Object.getPrototypeOf(player)), player),
      run = Object.assign(Object.create(Object.getPrototypeOf(nativeRun)), nativeRun);
    shadow.run = run; run.player = shadow;
    shadow.stats = {...player.stats, typeBoost:{...player.stats?.typeBoost}};
    shadow.items = new Map(player.items || []);
    shadow.vitamins = new Map([...(player.vitamins || [])].map(([k,v])=>[k,typeof v === "object" ? {...v} : v]));
    shadow.buffs = new Map(player.buffs || []);
    if (stable) {
      // Only the native generic move buff can be maintained by the held kit.
      // A temporary flute/agility/metal/adrenaline cap must not prove permanent zero.
      const maintained = (player.moves || []).filter(Boolean).some(move => {
        const d=move.def || move, m=move.mods || {};
        return d.arch === "buff" && Number(d.dur)*(m.dur ?? 1)*(player.stats?.duration ?? 1) >=
          Math.max(.12,Number(d.cd)*(m.cd ?? 1)/(player.stats?.attackSpeed || 1));
      });
      shadow.buffs = new Map([...shadow.buffs].filter(([key])=>key === "move-buff" && maintained));
    }
    run.tempMods = application.group === "vitamin" || application.group === "item" ? [...nativeRun.tempMods] : [...nativeRun.tempMods, ...mods];
    if (application.group === "vitamin") {
      const held=shadow.vitamins.get(application.key) || {level:0,acc:0};
      shadow.vitamins.set(application.key,{...held,level:held.level+1,acc:(held.acc || 0)+application.multiplier});
    }
    if (application.group === "item") shadow.items.set(application.key,(shadow.items.get(application.key) || 0)+1);
    shadow.recompute();
    if (stable && shadow.buffs.has("move-buff") && !(shadow.moves || []).filter(Boolean).some(move=>{
      const d=move.def || move,m=move.mods || {};
      return d.arch === "buff" && d.dur*(m.dur ?? 1)*(shadow.stats.duration || 1)>=Math.max(.12,d.cd*(m.cd ?? 1)/shadow.stats.attackSpeed);
    })) {shadow.buffs.delete("move-buff");shadow.recompute();}
    return {...shadow.stats};
  } catch { return null; }
}

function benefitStats(player, run, mods, stable = false, application = {}) {
  const native = benefitShadow(player,run,mods,stable,application);
  if (native) return {stats:native, confidence:"native-shadow"};
  if (stable && player.buffs?.size) return null;
  // Multipliers >=1 accumulate within tempMods (native rv). Other groups cancel
  // in this ratio; additive changes need the native base and cannot use it.
  const stats={...player.stats}, group=application.group === "vitamin" ? application.existing || [] : Array.isArray(run?.tempMods) ? run.tempMods : [];
  for (const stat of new Set(mods.map(m=>m.stat))) {
    const existing=group.filter(m=>m.stat===stat), incoming=mods.filter(m=>m.stat===stat);
    if (incoming.some(m=>m.add)) return null;
    const sum=rows=>rows.reduce((n,m)=>n+(m.mul>=1 ? m.mul-1 : 0),0),
      loss=rows=>rows.reduce((n,m)=>n*(m.mul>0 && m.mul<1 ? m.mul : 1),1);
    if (!Number.isFinite(stats[stat])) return null;
    stats[stat] *= (1+sum([...existing,...incoming]))/(1+sum(existing))*loss(incoming);
  }
  return {stats,confidence:Array.isArray(run?.tempMods)?"native-group-ratio":"unknown-group"};
}

function benefitCycle(move, stats, player) {
  const d=move.def || move,m=move.mods || {}, speed=Number(stats?.attackSpeed);
  if (!(d.cd>0) || !(speed>0) || !(m.cd == null || m.cd>0)) return null;
  const arch=d.arch, duration=Number(d.dur)*(m.dur ?? 1)*(stats.duration ?? 1),
    cooldown=Math.max(d.fusion || arch==="fusion" ? .6 : .12,d.cd*(m.cd ?? 1)/speed);
  if (["buff","weather"].includes(arch)) {
    if (!(duration>=0)) return null;
    return {kind:arch, value:Math.min(1,duration/cooldown), cooldown};
  }
  // Random includes submove cadence and swap deferral. A swap cap alone cannot
  // prove zero; unknown future architectures likewise remain explicitly unknown.
  if (arch==="random") return null;
  const known=["bolt","drain","homing","orb","boomerang","lob","barrage","beam","cone","orbit","aura","trail","nova","wave","spin","chain","strike","smite","meteor","dash","trap","vortex","fusion"];
  if (!known.includes(arch)) return null;
  let cycle=cooldown;
  if (arch==="orbit") cycle=cooldown+Math.max(0,duration || 0);
  const chargedBeam=arch==="beam"&&d.power>=110,
    activeDuration=Math.max(0,duration || 0)*(chargedBeam?1.3:1);
  // Native055 gy pauses its timer while a beam/cone is active. Charged beams
  // overwrite the passive's timer and add both .55s and 1.3x active duration.
  if (["beam","cone"].includes(arch)) cycle=cooldown+(chargedBeam?.55:0)+activeDuration;
  if (player.ability === "twin-heads" && !["orbit","aura","trail"].includes(arch) && !chargedBeam) {
    const chance=player.speciesId===85?.35:.25;
    cycle=(1-chance)*cycle+chance*((["beam","cone"].includes(arch)?activeDuration:0)+Math.min(cooldown,.12));
  }
  // Each native barrage cast resets the emitter tick. Once its queue saturates,
  // .06s alone cannot predict throughput: cast/frame alignment also matters.
  // Keep this case uncertain rather than rejecting speed as confirmed useless.
  if(arch==="barrage" && cycle<.06*Math.max(1,Math.floor((d.count || 1)+(m.count || 0)+(stats.projectiles || 0))))return null;
  return {kind:"attack",value:1/Math.max(.001,cycle),cooldown};
}

export function isTowerRun(run = {}) {
  return !!(run.nativeRun?.tower || run.player?.run?.tower || run.tower ||
    run.mode === "tower" || run.objective === "tower");
}

export function towerLuckFactor(level = 1) {
  const points = [[1,2],[50,2],[100,1],[200,.25],[300,.05]], n = Math.max(1,Number(level)||1);
  for(let i=1;i<points.length;i++) if(n<=points[i][0]) {
    const [x,a]=points[i-1],[y,b]=points[i]; return a+(b-a)*(n-x)/(y-x);
  }
  return .05;
}

const towerDefenseStats = new Set(["armor","maxHp","shieldMax","shieldRegen","regen","healing","heal","lifesteal","evasion"]);

const towerDefenseItems = new Set(["shell-bell","berry-juice","focus-band","focus-sash","shed-shell","revive","max-revive","sitrus-berry","lum-berry","smoke-ball","rainbow-wing","guard-spec"]);

// Retained as a compatibility helper for old diagnostics; numeric priority no
// longer changes acquisition order or makes a zero-value purchase eligible.
export function itemPriority(key, build = {}) { return null; }

export function compareOfferCandidates(a,b) {
  return (b.experiencePriority ?? 0)-(a.experiencePriority ?? 0) ||
    (b.utilityTier ?? 0)-(a.utilityTier ?? 0) ||
    b.score-a.score || (a.price ?? 0)-(b.price ?? 0) ||
    String(a.key ?? "").localeCompare(String(b.key ?? "")) || (a.index ?? 0)-(b.index ?? 0);
}

export function offerUtilityTier(offer,run={},data={}) {
  if(!isTowerRun(run)) return 0;
  const timing=towerLuckTiming(run);
  if(timing && run.choiceKind==='blessing')return 0;
  const key=offer?.id || offer?.key, def=offer?.kind==="item"?data.items?.get?.(key):null;
  if(timing?.protectCleanse && offer?.kind==='item' &&
      ['revive','max-revive','rainbow-wing','focus-sash','shed-shell'].includes(key))return 2;
  if(timing?.protectCleanse && offer?.kind==='item' && key==='cleanse-tag')return 1;
  let mods=def?.mods || offer?.mods;
  if(["newVit","upVit"].includes(offer?.kind)) {
    const v=vitaminDefinition(data,offer.vit);
    mods=v?[{stat:v.stat},...(v.extra || [])]:mods;
  }
  const defensive=mods?.length && mods.every(m=>towerDefenseStats.has(m.stat));
  if(offer?.kind==="item" && ["snowball","fresh-water","rage-candy-bar"].includes(key)) return 0;
  if(mods?.some(m=>m.stat==="armor") && (run.player?.items?.get?.("thick-club") || 0)>0 &&
    (benefitStats(run.player,run.nativeRun || run.player?.run || run,[],true)?.stats?.armor ?? run.player?.stats?.armor ?? 0)<100 && run.player?.moves?.some(m=>(m?.def || m)?.cls==="physical")) return 0;
  return defensive || towerDefenseItems.has(key) ? -1 : 0;
}

export function itemExperiencePriority(key,run={},data={}) {
  if(run.experienceBlessingPriority!==true || !isTowerRun(run))return 0;
  // Rare Candy grants levels directly; the other experience items expose their
  // positive XP modifiers in the reviewed catalog. Pickup range alone is not XP.
  return key==="rare-candy" || (data.items?.get?.(key)?.mods || []).some(mod=>
    ["xpGain","xpMult"].includes(mod.stat) && ((mod.add || 0)>0 || (mod.mul || 0)>1)) ? 1 : 0;
}

export function evaluateItemDecision(key, run={}, data={}) {
  const offer={kind:"item",id:key},priority=itemPriority(key,run.build),score=scoreOffer(offer,run,data);
  return {key,kind:"item",priority,score,utilityTier:offerUtilityTier(offer,run,data),
    experiencePriority:itemExperiencePriority(key,run,data),
    assessment:deferredItemValue(key,run,data),
    eligible:Number.isFinite(score) && ((run.purpose || 'free')==='free' || score>0)};
}

// Strategy units, never measured DPS. Keep non-stat benefits distinct from
// native immediate stat deltas. Free acquisition does not require a positive
// score; unknown passives stay unpriced rather than getting an invented bonus.
function deferredItemValue(key,run={},data={}) {
  const player=run.player || {},native=run.nativeRun || player.run || run,
    stats=player.stats || {},count=player.items?.get?.(key)||0,
    def=data.items?.get?.(key),moves=(player.moves || []).filter(Boolean),
    tower=isTowerRun(run),context=playerBenefitContext(run,data),
    output=context.weights.output,growth=context.weights.growth,
    finish=(score,reason,confidence='estimated')=>({score:Math.max(0,Number.isFinite(score)?score:0),reason,confidence,
      interpretation:'bounded-strategy-value-not-DPS'}),
    marginal=(base,step=1)=>base/(1+step*count),
    unknown=reason=>finish(0,reason,'unknown');
  if(!def)return finish(0,'missing-catalog','unknown');
  if(count>=(def.max??10))return finish(0,'native-count-cap','known');
  if(key==='tm-case') {
    if(count)return finish(0,'cap-already-unlocked','known');
    const targets=moves.map(m=>({level:Number(m.level)||1,cap:(m.def||m).fusion||(m.def||m).arch==='fusion'?5:8}));
    const proximity=targets.length?targets.reduce((n,m)=>n+clamp(m.level/m.cap,0,1),0)/targets.length:.2;
    return finish(8*growth+28*proximity,'future-move-levels');
  }
  if(key==='max-ether') {
    if(count)return finish(0,'cap-already-unlocked','known');
    const held=[...(player.vitamins?.values?.()||[])];
    if(!held.length&&player.vitaminSlots===0)return finish(0,'no-vitamin-capacity','known');
    const proximity=held.length?held.reduce((n,v)=>n+clamp(Number(typeof v==='number'?v:v.level)/10||0,0,1),0)/held.length:.2;
    return finish(6*growth+24*proximity,'future-vitamin-levels');
  }
  if(key==='poke-flute') {
    if(native.ult===null || native.ult?.enabled===false)return finish(0,'ultimate-disabled','known');
    // The 25% charging channel survives saturated attack speed. Reset/buff
    // estimates are deliberately discounted for unobserved ultimate uptime.
    const relevant=moves.filter(m=>!['buff','weather'].includes((m.def||m).arch)),
      reset=relevant.length?Math.min(6,relevant.length*1.5):0,
      speed=scoreMods([{stat:'attackSpeed',mul:1.3}],1,Object.assign(Object.create(player),{decisionBenefit:undefined}))*.1;
    return finish((18+reset)*output+Math.max(0,speed),'ultimate-charge-reset-and-buff');
  }
  if(key==='old-rod')return finish(marginal(14,.8)*output,'periodic-independent-attack');
  if(key==='soda-pop')return finish(marginal(5,.8)*output,'slide-attack-discounted-uptime');
  if(key==='guard-spec')return finish((count?9:28)*(tower?.01:1),'periodic-hit-block');
  if(key==='gold-teeth') {
    const rules=interactionOptions({},run.build);
    if(rules.paid===false || rules.shop===false&&rules.roulette===false || rules.totalBudget===0 || rules.maxSpend===0)
      return finish(0,'paid-channels-disabled','known');
    return finish(marginal(10,.3)*growth,'future-paid-cost-discount');
  }
  if(key==='full-heal'||key==='ice-heal') {
    const channels=playerStatusChannels(player).channels,coverage=new Map();
    for(const c of channels) {
      const probability=clamp(c.probability*(c.kind==='scaled'?(stats.statusChance??1):1)*(c.weight??1),0,1);
      coverage.set(c.status,1-(1-(coverage.get(c.status)||0))*(1-probability));
    }
    const gain=key==='full-heal'?.06*Math.min(5,[...coverage.values()].reduce((a,b)=>a+b,0)):
      .6*(coverage.get('freeze')||0);
    return finish(90*gain/(1+gain*count)*output,key==='full-heal'?'observed-status-source-proxy':'observed-freeze-source-proxy');
  }
  if(key==='metal-powder') {
    const uptime=player.buffs?.has?.('metal')||player.stillT>=.8?.5:.1,
      value=scoreMods([{stat:'attackSpeed',mul:1+.08/(1+.08*count)},
        {stat:'armor',mul:1+.3/(1+.3*count)}],1,Object.assign(Object.create(player),{decisionBenefit:undefined}));
    return finish(Math.max(0,value)*uptime,'stationary-buff-discounted-uptime');
  }
  if(['lemonade','poke-doll','ss-ticket'].includes(key)) {
    const allies=native.allies;
    if(!allies || !Array.isArray(allies.list))return unknown('support-state-unobserved');
    if(key==='ss-ticket')return finish((allies.list.length?10:3)*growth,'future-support-slot');
    if(!allies.list.length)return finish(0,'no-current-support','known');
    if(key==='poke-doll') {
      // Native recompute already includes support mods; do not count again.
      if(typeof player.recompute==='function'&&typeof allies.mods==='function')return finish(0,'support-mods-in-native-delta','known');
      return finish(marginal(8,.5)*Math.min(3,allies.list.length),'support-passive-estimate');
    }
    const gain=(1+.25*(count+1))/(1+.25*count)*(1+.15*(count+1))/(1+.15*count)-1;
    return finish(30*gain*Math.min(3,allies.list.length)*output,'support-attack-share-estimate');
  }
  if(key==='dowsing-machine') {
    if(tower||native.coop)return finish(0,'map-generation-not-applicable','known');
    return finish(marginal(12,.6)*growth,'future-map-rewards');
  }
  if(key==='secret-key') {
    if(tower)return finish(0,'no-tower-altar','known');
    return finish(marginal(5,.3)*growth,'altar-time-saving');
  }
  const covered=new Set(['grip-claw','berry-juice','shell-bell','metronome','binding-band','adrenaline-orb',
    'awakening','focus-band','eviolite','stick','razor-fang','shed-shell','cell-battery','focus-sash',
    'fire-stone','griseous-orb','reaper-cloth','electirizer','leaf-stone','revive','thick-club','silph-scope','max-revive']);
  if((def.mods||[]).length||covered.has(key))return finish(0,'handled-by-stat-or-existing-passive-model','known');
  return unknown('unmodelled-passive-free-acquisition-only');
}

export function evaluateShopPurchases(stock = [], run = {}, data = {}, options = {}) {
  const native=run.nativeRun || run.player?.run || run,player=run.player || native.player || {},
    build=run.build || {},rules=options.rules || interactionOptions({},build),spent=options.spent || 0,
    context={...run,player,build,nativeRun:native,purpose:"shop"},
    // The bounded curse forecast supplies its existing fixed-value snapshot;
    // live world/modal callers always calculate current marginal decisions.
    decisions=new Map(options.itemDecisions || []),decision=key=>{
      if(!decisions.has(key))decisions.set(key,evaluateItemDecision(key,context,data));
      return decisions.get(key);
    },rows=stock.map((entry,index)=>{
      const value=decision(entry.key),price=Number(entry.price),reasons=[];
      if(rules.shop===false)reasons.push("shop-disabled");
      if(entry.sold)reasons.push("sold");
      if(!value.eligible)reasons.push("no-permitted-marginal-benefit");
      if(!canSpendGold(price,Number(native.gold),rules,spent))reasons.push("budget");
      if(options.legal && !options.legal(index))reasons.push("native-control-ineligible");
      return {...value,index,price,reasons,eligible:!reasons.length,futureHeatCost:0,coreReserve:0,
        netScore:value.score,valuePerGold:value.score/Math.max(1,price)};
    });
  if(options.spendAll===true) {
    const candidates=rows.filter(row=>row.eligible).sort((a,b)=>
      compareOfferCandidates({...a,score:a.valuePerGold},{...b,score:b.valuePerGold}));
    return {index:candidates[0]?.index ?? null,candidates,evaluations:rows,pricing:null,
      model:"current-stock-spend-all",heuristic:true};
  }
  // Prices in this visit are frozen by native showShop. A paid purchase can
  // increase prices at a later visit. Forecast only from observed native
  // counters, never from another run's price or a guessed future inventory.
  const factors=[1.15,1.25,1.4,1.6,2],bases=[80,130,220,400,750],
    pricing=!native.endless&&Number.isInteger(native.chestsBought)&&native.chestsBought>=0&&
      Array.isArray(native.shopBuys)&&native.shopBuys.every(n=>Number.isInteger(n)&&n>=0&&n<5)&&
      Number.isFinite(native.stage),
    grace=pricing?2+Math.floor(native.chestsBought/3):0,
    heat=pricing?native.shopBuys.slice(grace).reduce((n,r)=>n*factors[r],1):null,
    discount=1-.08*Math.min(3,player.items?.get?.("gold-teeth") || 0),
    priceFor=def=>pricing&&Number.isInteger(def?.rarity)&&bases[def.rarity]!=null?
      Math.round(bases[def.rarity]*2.2**(Math.min(4,Math.max(1,native.stage))-1)*heat*discount):null,
    matureTower=isTowerRun(context)&&playerBenefitContext(context,data).completion>=.8,
    references=[];
  if(rows.some(row=>row.eligible)&&pricing)for(const [key,def] of data.items || []) {
    const visible=rows.find(row=>row.key===key&&!stock[row.index].sold&&!(options.legal&&!options.legal(row.index))),
      held=(player.items?.get?.(key)||0)>0;
    let inPool=visible || held;
    if(typeof native.meta?.itemInPool==="function") {
      try {inPool=native.meta.itemInPool(key);} catch {inPool=visible || held;}
    }
    if(!inPool || native.banished?.has?.("i"+key))continue;
    const value=decision(key),price=visible?.price ?? priceFor(def);
    if(!value.eligible || !(value.score>0) || value.utilityTier<0 || !(price>0) ||
      !canSpendGold(price,price+Math.max(0,Number(rules.goldReserve)||0),rules,spent))continue;
    references.push({...value,price,visible:!!visible,valuePerGold:value.score/price});
  }
  for(const row of rows) {
    if(!row.eligible || row.price===0)continue;
    const def=data.items?.get?.(row.key),factor=pricing&&native.shopBuys.length>=grace?(factors[def?.rarity] || 1):1,
      candidates=references.filter(ref=>ref.key!==row.key &&
        (ref.experiencePriority ?? 0)>=(row.experiencePriority ?? 0) &&
        (ref.priority ?? Infinity)<=(row.priority ?? Infinity) && ref.score>Math.max(0,row.score) &&
        (ref.priority!=null && (ref.priority ?? Infinity)<(row.priority ?? Infinity) || ref.valuePerGold>row.valuePerGold))
        .sort((a,b)=>compareOfferCandidates({...a,score:a.valuePerGold},{...b,score:b.valuePerGold})),
      target=candidates[0];
    if(target) {
      const targetPrice=target.visible?target.price:Math.round(target.price*factor),
        heatCost=Math.max(0,targetPrice-target.price),
        heatPenalty=target.score*heatCost/target.price;
      row.coreKey=target.key;row.coreReserve=targetPrice;row.futureHeatCost=heatCost;
      // A numeric player priority is an explicit ordering override. The new
      // automatic cost gate must not silently reverse that preference.
      if(row.priority==null) {
        row.netScore=row.score-heatPenalty;
        if(row.netScore<=0)row.reasons.push("future-shop-heat-exceeds-benefit");
        if((matureTower || target.visible&&canSpendGold(target.price,Number(native.gold),rules,spent)) &&
          !canSpendGold(targetPrice,Number(native.gold)-row.price,rules,spent+row.price))
          row.reasons.push("reserve-higher-value-item");
      }
    }
    row.valuePerGold=row.netScore/Math.max(1,row.price+row.futureHeatCost);
    row.eligible=!row.reasons.length;
  }
  const candidates=rows.filter(row=>row.eligible).sort((a,b)=>
    compareOfferCandidates({...a,score:a.valuePerGold},{...b,score:b.valuePerGold}));
  return {index:candidates[0]?.index ?? null,candidates,evaluations:rows,
    pricing:pricing?{heat,grace,matureTower}:null,
    model:"next-copy-value-and-one-item-reserve",heuristic:true};
}

export function playerBenefitContext(run = {}, data = {}) {
  const p=run.player || {}, moves=(p.moves || []).filter(Boolean),
    cap=move=>{try{return Number(p.capOf?.(move));}catch{return NaN;}},
    moveDebt=moves.reduce((n,m)=>n+(Number.isFinite(cap(m))?Math.max(0,cap(m)-(Number(m.level)||1))/Math.max(1,cap(m)):1),0),
    slots=Number(p.moveSlots)||Math.max(1,moves.length),
    vitDebt=[...(p.vitamins?.values?.() || [])].reduce((n,v)=>n+(Number.isFinite(p.vitCap)?Math.max(0,p.vitCap-(Number(v?.level ?? v)||1))/Math.max(1,p.vitCap):1),0),
    vitaminMissing=Math.max(0,(Number(p.vitaminSlots)||0)-(p.vitamins?.size || 0));
  let evolution=null;
  try { const fn=data.data?.evolutionsOf || data.evolutionsOf; if(fn) evolution=fn.call(data.data || data,p.speciesId)?.length>0; } catch {}
  const final=run.finalReplacement || run.build?.finalReplacement,
    explicitMoveMissing=final?.moves?.active ? (final.moves.missing || []).length : 0,
    explicitVitaminMissing=final?.vitamins?.active ? (final.vitamins.missing || []).length : 0,
    pendingFusion=final?.fusion?.active && final.fusion.pending ? 1 : 0,
    missingMoves=Math.max(0,slots-moves.length),
    debt=explicitMoveMissing+explicitVitaminMissing+pendingFusion+moveDebt+vitDebt+missingMoves+vitaminMissing+(evolution===true?2:0),
    completion=moves.length && moves.every(m=>Number.isFinite(cap(m)))?1/(1+debt):0, hp=p.maxHp>0?p.hp/p.maxHp:1;
  // Observations must carry combat seconds, freshness and player-only evidence.
  const observation=run.benefitObservation, native=run.nativeRun || p.run || run,
    reliable=observation?.playerOnly===true && observation.combatSeconds>=10 &&
      Number.isFinite(native.time) && native.time-observation.gameTime>=0 && native.time-observation.gameTime<=20 &&
      observation.stage===native.stage && observation.floor===native.tower?.floor;
  const risk=Math.max(hp<.3?2:hp<.6?1:0,reliable?Math.min(2,Math.max(0,observation.damageTakenPerSecond || 0)/(p.maxHp || 100)*20):0),
    xpObjective=/xp|experience|level|evol/i.test(run.objectiveMetric || ""),
    objective=String(run.objective || ""), tower=isTowerRun(run), timed=tower || /time|boss|elite|damage/i.test(run.objectiveMetric || "") || /tower|endless/.test(objective);
  return {completion,tower,luckFactor:tower?towerLuckFactor(p.level):1, debt:{moveDebt,vitDebt,missingMoves,vitaminMissing,explicitMoveMissing,explicitVitaminMissing,pendingFusion,evolution,itemsExcluded:true},
    weights:{output:(1+.8*completion)*(timed?1.15:1)*(reliable && observation.clearSlow===true?1.15:1),
      survival:tower?.01:1+risk*.6,growth:xpObjective?1.5:Math.max(evolution===true?.8:.15,1-.85*completion)},
    observation:reliable?"recent-player-combat":"unavailable", calibration:"heuristic-not-validated-win-rate"};
}

export function evaluatePlayerMods(mods = [], run = {}, data = {}, application = {}) {
  const p=run.player || {}, native=run.nativeRun || p.run || run, context=playerBenefitContext(run,data),
    active=(Array.isArray(mods)?mods:[]).filter(m=>m && ((m.add || 0)!==0 || (m.mul ?? 1)!==1)),
    before={stats:{...p.stats},confidence:"observed"}, after=benefitStats(p,native,active,false,application),
    stableBefore=benefitStats(p,native,[],true), stableAfter=benefitStats(p,native,active,true,application),
    moves=(p.moves || []).filter(Boolean), mechanisms=[], unknown=[],audit=inspectPlayerMechanics(p),
    independentSources=independentCriticalSources(p),globalCritBonus=p.ability==='pickup'?Math.min(.15,Math.max(0,Number(p.run?.stats?.gold)||0)/1e4):0;
  let speedGain=0,totalWeight=0,outputBefore=0,outputAfter=0;
  const crit=(stats,bonus=0)=>{
    const chance=Math.max(0,(stats.critChance || 0)+(stats.megaCrit || 0)+bonus), damage=stats.critDamage || 1.75;
    // Native Kg=.5; above 100% the second roll multiplies an existing crit.
    return chance<=1 ? 1+chance*(damage-1) : damage*(1+Math.min(1,chance-1)*.5*(damage-1));
  };
  const expectedCrit=(stats,bonuses)=>bonuses.reduce((sum,bonus)=>sum+crit(stats,bonus),0)/bonuses.length;
  for (const move of effectiveBenefitMoves(moves)) {
    const d=move.def || move;
    let b=benefitCycle(move,before.stats,p),a=after && benefitCycle(move,after.stats,p),
      sb=stableBefore && benefitCycle(move,stableBefore.stats,p),sa=stableAfter && benefitCycle(move,stableAfter.stats,p);
    const cadenceAvailable=!!(b && a && sb && sa),cadenceKnown=cadenceAvailable&&!move.randomOwner;
    if(move.randomOwner)unknown.push('random-submove-scheduling:'+move.randomOwner);
    if (!cadenceAvailable) {
      unknown.push(d.key || d.arch || "missing-move-metadata");
      if (!after || !stableBefore || !stableAfter || ["buff","weather"].includes(d.arch)) continue;
      const baseSpeed=before.stats.attackSpeed,stableSpeed=stableBefore.stats.attackSpeed;
      if (!(baseSpeed>0) || !(stableSpeed>0) || !(after.stats.attackSpeed>0) || !(stableAfter.stats.attackSpeed>0)) continue;
      // Preserve known damage/critical modifiers. Estimate only the unknown
      // cadence, using reconstructed speed changes (including source dilution).
      // Unknown still prevents a confirmed-zero hard rejection.
      const rate=1/Math.max(.12,(Number(d.cd)||1)*(move.mods?.cd || 1)/baseSpeed);
      b={kind:"attack",value:rate,cooldown:null};sb={...b};
      a={...b,value:rate*Math.max(.01,1+.35*(after.stats.attackSpeed/baseSpeed-1))};
      sa={...b,value:rate*Math.max(.01,1+.35*(stableAfter.stats.attackSpeed/stableSpeed-1))};
    }
    // Damage/cooldown is a weighting proxy only: never weight a tiny skill as
    // much as the primary attack merely because both consume attackSpeed.
    const weight=(b.kind==="attack" ? Math.max(.01,(d.dmg || 0)*(move.mods?.dmg || 1)*(before.stats[d.cls] || 1)*b.value) : 8)*(move.choiceWeight??1),
      gain=b.kind==="attack"?a.value/b.value-1:a.value-b.value,
      stableGain=sb.kind==="attack"?sa.value/sb.value-1:sa.value-sb.value;
    const critBonuses=moveCriticalBonuses(move,p),critBonus=Math.min(...critBonuses);
    mechanisms.push({key:move.ownerDef?.key||d.key || d.arch,borrowedKey:move.randomOwner?d.key:move.benefitRecipeKey||null,cls:d.cls,critBonus,critBonuses,kind:b.kind,cadenceKnown,before:b,after:a,stableBefore:sb,stableAfter:sa,gain,stableGain,weight});
    speedGain+=weight*(gain*.5+stableGain*.5); totalWeight+=weight;
    if (b.kind === "attack") {
      const beforePower=(before.stats.damage || 1)*(before.stats[d.cls] || 1)*expectedCrit(before.stats,critBonuses),
        afterPower=(after.stats.damage || 1)*(after.stats[d.cls] || 1)*expectedCrit(after.stats,critBonuses);
      outputBefore+=weight*beforePower/(before.stats[d.cls] || 1);
      outputAfter+=weight*afterPower/(before.stats[d.cls] || 1)*(1+(gain+stableGain)*.5);
    }
  }
  const contributions={};
  if (after && outputBefore>0) {
    const ratio=stat=>(after.stats[stat] ?? 1)/(before.stats[stat] ?? 1)-1,
      attacks=mechanisms.filter(m=>m.kind==="attack"),total=attacks.reduce((n,m)=>n+m.weight,0);
    contributions.damage=ratio("damage");
    for(const cls of ["physical","special"]) contributions[cls]=ratio(cls)*attacks.reduce((n,m)=>{
      return n+(m.cls===cls?m.weight:0);
    },0)/Math.max(.001,total);
    contributions.attackSpeed=attacks.reduce((n,m)=>n+m.weight*(m.gain+m.stableGain)*.5,0)/Math.max(.001,total);
    // Per-move crit bonuses can reach the second-roll cap before the panel does.
    const critRatio=overrides=>{
      const base=attacks.reduce((n,m)=>n+m.weight*expectedCrit(before.stats,m.critBonuses),0);
      return attacks.reduce((n,m)=>n+m.weight*expectedCrit({...before.stats,...overrides},m.critBonuses),0)/Math.max(.001,base)-1;
    };
    contributions.critChance=critRatio({critChance:after.stats.critChance,megaCrit:after.stats.megaCrit});
    contributions.critDamage=critRatio({critDamage:after.stats.critDamage});
  }
  const coverage=mechanisms.filter(m=>m.kind!=="attack").reduce((n,m)=>n+(m.gain+m.stableGain)*.5*(m.kind==="buff"?.25:.15),0);
  const independentCritRatio=(before,after)=>crit({...before,critChance:after.critChance,megaCrit:after.megaCrit},globalCritBonus)/crit(before,globalCritBonus)-1,
    independentCritical={sources:independentSources,gain:independentSources.length&&after&&stableBefore&&stableAfter&&
      active.some(m=>m.stat==='critChance')&&Math.abs(contributions.critChance||0)<1e-10?
      (independentCritRatio(before.stats,after.stats)+independentCritRatio(stableBefore.stats,stableAfter.stats))/2:0,
      interpretation:'available-independent-hit-channel;trigger-frequency-and-damage-share-unmeasured'};
  if (!Array.isArray(mods)) unknown.push("malformed-modifiers");
  if (!moves.length) unknown.push("no-player-moves");
  if (!after) unknown.push("stat-reconstruction-unavailable");
  if (after?.confidence==="unknown-group") unknown.push("native-modifier-group-unavailable");
  if (typeof p.onMoveFired === "function" || data.unknownPlayerMechanics) unknown.push("unaudited-player-callback");
  if (active.some(m=>["duration","area","projectiles"].includes(m.stat)))
    for(const move of moves) if(((move.def || move).arch==="fusion" || (move.def || move).fusion) && !fusionBenefitProfile(move))
      unknown.push("fusion-capabilities:"+((move.def || move).key || "unknown"));
  // At full generic-buff/weather coverage, twin-heads still shortens the
  // owning buff timer only; it does not manufacture another damaging cast.
  const pureSpeed=active.length>0 && active.every(m=>m.stat==="attackSpeed"),
    pureCrit=active.length>0 && active.every(m=>m.stat==="critChance" && (m.add || 0)>=0 && (m.mul ?? 1)>=1),
    critCapped=pureCrit && stableBefore && (independentSources.length?
      (stableBefore.stats.critChance||0)+(stableBefore.stats.megaCrit||0)+globalCritBonus>=2:
      mechanisms.length>0 && mechanisms.every(m=>m.kind==="attack" &&
      (stableBefore.stats.critChance || 0)+(stableBefore.stats.megaCrit || 0)+m.critBonus>=2)),
    hardRejected=!unknown.length && (critCapped || pureSpeed && mechanisms.length>0 &&
      mechanisms.every(m=>Math.abs(m.gain)<1e-10 && Math.abs(m.stableGain)<1e-10)),
    gain=totalWeight?speedGain/totalWeight:0,
    output=outputBefore>0?outputAfter/outputBefore-1:0,
    changed=after && active.some(m=>Math.abs((after.stats[m.stat] || 0)-(before.stats[m.stat] || 0))>1e-10),
    net=output || gain || independentCritical.gain || (changed ? .001 : 0);
  return {state:hardRejected?"zero":unknown.length?"unknown":net>1e-10?"positive":net< -1e-10?"negative":"zero",
    hardRejected, reason:hardRejected?(pureCrit?"player-crit-chance-confirmed-zero":"player-attack-speed-confirmed-zero;companion-output-excluded"):null,
    before:before.stats,after:after?.stats || null,stableBefore:stableBefore?.stats || null,stableAfter:stableAfter?.stats || null,
    confidence:after?.confidence || "unknown",unknown:[...new Set(unknown)],mechanisms,audit,context,components:{speed:gain,output,outputBefore,outputAfter,contributions,coverage,independentCritical,
      assumptions:active.some(m=>["statusChance","statusDamage"].includes(m.stat))?["status-trigger-availability-assumed;channel-share-not-measured"]:[],
      interpretation:"relative-capability-proxy-not-DPS"},mods:active,companionOutputIncluded:false};
}

export function evaluateOfferBenefit(offer,run={},data={}) {
  let mods=offer?.mods, application={};
  if (offer?.kind==="item") {mods=data.items?.get?.(offer.id || offer.key)?.mods;application={group:"item",key:offer.id || offer.key};}
  if (["newVit","upVit"].includes(offer?.kind)) {
    const d=vitaminDefinition(data,offer.vit), mult=data.rarityMultipliers?.[offer.rarity || 0] ?? [1,1.2,1.45,1.75,2.1][offer.rarity || 0] ?? 1;
    application={group:"vitamin",key:offer.vit,multiplier:mult,existing:[]};
    for(const [key,held] of run.player?.vitamins || []) {
      const def=vitaminDefinition(data,key),acc=held?.acc;
      if(def && Number.isFinite(acc) && !def.dice) application.existing.push({stat:def.stat,
        [def.kind==="add"?"add":"mul"]:def.kind==="add"?def.per*acc:1+def.per*acc});
    }
    if(d && !d.dice) mods=[{stat:d.stat,[d.kind==="add"?"add":"mul"]:d.kind==="add"?d.per*mult:1+d.per*mult},...(d.extra || []).map(e=>({stat:e.stat,mul:1+e.mul*mult}))];
  }
  const result=evaluatePlayerMods(mods || [],run,data,application);
  // Item passives and move upgrades are not exhaustively represented by mods.
  // A pure attack-speed item must not reject a hidden native passive.
  const auditedStatOnlyItem=offer?.kind === "item" && ["quick-claw","max-elixir","scope-lens","razor-claw"].includes(offer.id || offer.key);
  if (offer?.kind==="item" && !auditedStatOnlyItem || ["newMove","upMove"].includes(offer?.kind)) {
    result.hardRejected=false;result.state="unknown";
    result.unknown.push(offer.kind === "item"?"item-passive-uses-existing-native-aware-score":"move-change-uses-existing-upgrade-and-control-proxies");
  }
  return result;
}

// Native055 Combat.itemProcs: copies multiply the chance before the random
// roll. Additional copies cannot improve a probability already at one.
const itemStatusProbabilities = {"flame-orb":.05,"toxic-orb":.06,"snowball":.06,"grip-claw":.04,"awakening":.025};

function statusProbabilityGain(player, before, after) {
  const profile=playerStatusChannels(player),probabilities=profile.channels.filter(c=>c.kind==='scaled'),unknown=profile.unknown;
  const relative=before>0?after/before-1:after,
    prior=probabilities.reduce((n,p)=>n+p.weight*Math.min(1,Math.max(0,p.probability*before)),0),
    next=probabilities.reduce((n,p)=>n+p.weight*Math.min(1,Math.max(0,p.probability*after)),0),
    measured=prior>0?next/prior-1:next/Math.max(1,probabilities.length);
  // Preserve the user's available-trigger assumption when there is no known
  // source. Unknown mechanics never become a claimed confirmed zero.
  return !probabilities.length?(profile.channels.length&&!unknown.length?0:relative):unknown.length?
    (measured*probabilities.length+.35*relative*unknown.length)/(probabilities.length+unknown.length):measured;
}

function towerAreaRadiusCap(move, player) {
  const run=player?.run, radius=Number(run?.terrain?.arenaR),d=move.def || move;
  if(!run?.tower || !(radius>0))return Infinity;
  // Conservative bounds for the native circular tower. Strike centers lie
  // between player and target (or its 2.5-unit fallback); meteor adds <=.5
  // jitter on each axis. Target acquisition remains a separate mechanism.
  if(d.arch==="strike")return (2*radius+3)/.75;
  if(d.arch==="meteor" || d.arch==="smite")return 2*radius+Math.SQRT1_2;
  if(["nova","spin","aura"].includes(d.arch))return 2*radius;
  return Infinity;
}

export function conditionalItemBenefit(key, player = {}, data = {}) {
  const count=player.items?.get?.(key) || 0, held=(player.moves || []).filter(Boolean),stats=player.stats || {};
  if(itemStatusProbabilities[key]!=null) {
    const chance=itemStatusProbabilities[key],status=Math.max(0,stats.statusChance ?? 1),
      afterStatus=Math.max(0,player.decisionBenefit?.after?.statusChance ?? status),
      before=Math.min(1,chance*count*afterStatus),after=Math.min(1,chance*(count+1)*afterStatus);
    const retentionBefore=key==="awakening"&&count>0?Math.min(.7,.25+.15*count):0,
      retentionAfter=key==="awakening"?Math.min(.7,.25+.15*(count+1)):0;
    return {gain:after-before+after*(retentionAfter-retentionBefore),source:"native-next-copy-probability",before,after,
      ...(key==="awakening"?{retentionBefore,retentionAfter}:{}),
      interpretation:"status-channel-proxy-not-DPS"};
  }
  const types=(data.items?.get?.(key)?.tags || []).filter(t=>t.startsWith("type:")).map(t=>t.slice(5));
  if(types.length) {
    const attacks=held.filter(m=>!['buff','weather'].includes((m.def || m).arch)),
      shares=attacks.map(move=>{
        const d=move.def || move,random=d.key==="fu-missingno";
        return {share:random?types.length/18:types.includes(d.type)?1:0,
          gain:random?types.reduce((n,type)=>n+.3/(stats.typeBoost?.[type] ?? 1),0)/types.length:
            .3/(stats.typeBoost?.[d.type] ?? 1)};
      });
    return {gain:shares.reduce((n,row)=>n+row.share*row.gain,0)/Math.max(1,attacks.length),
      source:"native-type-bucket;estimated-move-share",interpretation:"type-channel-proxy-not-DPS"};
  }
  if(key==="silph-scope") {
    // Native scopeMul is 1 + .4 * copies on the marked target. The missing
    // damage-weighted marked share is explicitly estimated, never assumed 100%.
    const share=.5;
    return {gain:.4*share/(1+.4*share*count),channelGain:.4/(1+.4*count),
      source:"estimated-marked-damage-share",share,range:[0,.4/(1+.4*count)]};
  }
  if(key==="thick-club") {
    const share=held.filter(m=>(m.def || m).cls==="physical").length/Math.max(1,held.filter(m=>!['buff','weather'].includes((m.def || m).arch)).length),
      per=Math.min(.5,Math.max(0,stats.armor || 0)/200);
    return {gain:share*per/(1+per*count),source:"native-armor-cap-100"};
  }
  if(key==="metronome") {
    // A live no-hit timer is observable; it is not a claim of future uptime.
    // Missing telemetry keeps a conservative 50% uptime estimate, labelled.
    const known=Number.isFinite(player.noHitT),per=known?Math.min(.4,Math.max(0,player.noHitT)*.02):.2;
    return {gain:per/(1+per*count),source:known?"observed-no-hit-timer":"estimated-half-uptime",noHitT:known?player.noHitT:null};
  }
  if(key==="binding-band") {
    const sources=[],status=Math.max(0,stats.statusChance ?? 1);
    for(const channel of playerStatusChannels(player).channels) {
      if(!/^(sleep|freeze|root|paralysis|stun)$/.test(channel.status))continue;
      let probability=channel.kind==='scaled'?Math.min(1,channel.probability*status):channel.probability;
      if(channel.source==='ability:genome')probability=Math.min(1,Math.max(0,(stats.critChance||0)+(stats.megaCrit||0)));
      if(channel.source==='ability:hyper-cutter')probability=player.speciesId===99?.25:.2;
      if(channel.source==='ability:carnivore')probability=.2;
      if(channel.source==='ability:frost-kiss')probability=.5;
      if(channel.status==='freeze')probability/=3;
      sources.push({source:channel.source,status:channel.status,probability:probability*channel.weight});
    }
    // A bounded encounter proxy: individual hit targets/resistance are unknown.
    const chance=1-sources.reduce((n,s)=>n*(1-s.probability),1),
      coverage=Math.min(.9,1-Math.exp(-chance*Math.max(1,Math.min(4,estimatedHitRate(player)))));
    return {gain:.2*coverage/(1+.2*count*coverage),source:"estimated-control-coverage",coverage,sources};
  }
  return null;
}

export function scoreMods(mods, hpRatio = 1, context) {
  const player = Array.isArray(context) ? { moves: context } : context;
  const moves = player?.moves;
  const stats = player?.stats || {};
  const benefit = player?.decisionBenefit || evaluatePlayerMods(mods || [], {player:player || {}, nativeRun:player?.run}, {});
  const decisionWeight = (stat) => {
    const aliases = {
      xpGain: "xp",
      xpMult: "xp",
      evasion: "dodge",
      pickupRange: "pickup",
    };
    const value =
      player?.decisionWeights?.[stat] ??
      player?.decisionWeights?.[aliases[stat]];
    return Number.isFinite(Number(value)) ? clamp(Number(value), 0, 5) : 1;
  };
  const maxHp = player?.maxHp || stats.maxHp || 110;
  const hurt = hpRatio < 0.5;
  const urgency = benefit.context.tower ? 1 : hpRatio < 0.3 ? 2 : hurt ? 1.6 : 1;
  const healing = stats.healing || 1;
  const hitRate = estimatedHitRate(player);
  // All leech sources share a replenishing 5%-max-HP-per-second budget.
  // Treat native grass healing/drain as recovery already present, so a strong
  // healer does not endlessly take redundant leech instead of damage/control.
  const nativeLeech = player?.ability === "photosynthesis" ? maxHp * 0.012 : 0;
  const drainLeech = (moves || [])
    .filter(Boolean)
    .some((m) => (m.def || m).drain > 0)
    ? maxHp * 0.01
    : 0;
  const leech = Math.min(
    maxHp * 0.05,
    hitRate * (stats.lifesteal || 0) * (1 + maxHp * 0.005) +
      nativeLeech +
      drainLeech,
  );
  const recovery = ((stats.regen || 0) + leech) * healing;
  const recoveryNeed = 1 / (1 + Math.max(0, recovery / maxHp - 0.025) * 30);
  // Guaranteed passive regeneration already replacing 8% of max HP each
  // second cannot prevent a burst of body hits. Diminish further sustain
  // gains using that observed stat, not assumed drain or on-kill healing.
  const passiveRecovery = (Math.max(0, stats.regen || 0) * healing) / maxHp;
  const sustainGain = 1 / (1 + Math.max(0, passiveRecovery - 0.08) * 100);
  const weights = {
    damage: 90,
    physical: 75,
    special: 75,
    attackSpeed: 110,
    area: 85,
    projectiles: 120,
    regen: 65 * urgency * healing * recoveryNeed,
    armor: (170 * urgency) / (45 + Math.max(0, stats.armor || 0)),
    maxHp: (90 * urgency) / maxHp,
    shieldMax: (75 * urgency) / maxHp,
    moveSpeed: 65,
    thorns: 0.15,
    flinch: 110,
    bounces: 18,
    knockback: 30,
    pickup: 35,
    pickupRange: 7,
    xpMult: 80,
    xpGain: 80,
    luck: 0.3,
    crit: 70,
    critChance: 85,
    critDamage: 35,
    evasion: (170 * urgency) / Math.max(0.4, 1 - (stats.evasion || 0)),
    duration: 50,
    projSpeed: 35,
    heal: 30,
    healing: Math.max(15, recovery * 65) * urgency * recoveryNeed,
    lifesteal:
      Math.max(100, hitRate * (1 + maxHp * 0.005) * healing * 45) *
      urgency *
      recoveryNeed,
    statusChance: 35,
    statusDamage: 45,
    eliteDamage: 65,
    superEffective: 40,
    gold: 35,
    extraJumps: 8,
    jumpHeight: 15,
    difficulty: -100,
    enemyAmount: -140,
    cooldown: -100,
  };
  const flatStats = new Set([
    "maxHp",
    "shieldMax",
    "armor",
    "regen",
    "pickupRange",
    "luck",
    "extraJumps",
    "thorns",
    "critChance",
    "evasion",
    "lifesteal",
    "projectiles",
  ]);
  const outputStats=["damage","physical","special","attackSpeed","critChance","critDamage"];
  let outputScored=false;
  const independentCriticalScore=90*(benefit.components.independentCritical?.gain||0)*decisionWeight('critChance')*benefit.context.weights.output;
  return (mods || []).reduce((n, m) => {
    // A flat-stat multiplier must be converted to that stat's units. Previously
    // +10% maximum HP was worth 0.1 HP and lost to almost any offensive card.
    const current = m.stat === "maxHp" ? maxHp : stats[m.stat] || 0;
    let amount =
      (m.add || 0) + ((m.mul ?? 1) - 1) * (flatStats.has(m.stat) ? current : 1);
    if (!Number.isFinite(amount)) return n;
    // Unknown cadence/passives affect their own estimate/eligibility. They must
    // not discard the known modifier contribution already computed above.
    if (outputStats.includes(m.stat) && benefit.after && benefit.components.outputBefore>0) {
      if (outputScored) return n;
      outputScored=true;
      const contribution=benefit.components.contributions,
        entries=Object.entries(contribution).filter(([stat])=>(mods || []).some(v=>v.stat===stat)),
        sum=entries.reduce((n,[,value])=>n+value,0),
        magnitude=entries.reduce((n,[,value])=>n+Math.abs(value),0),
        interaction=benefit.components.output-sum,
        weighted=entries.reduce((n,[stat,value])=>n+(value+(magnitude?interaction*Math.abs(value)/magnitude:0))*decisionWeight(stat),0),
        coverageWeight=(mods || []).some(v=>v.stat==="attackSpeed")?decisionWeight("attackSpeed"):decisionWeight("duration");
      return n+(90*weighted+110*benefit.components.coverage*coverageWeight)*benefit.context.weights.output;
    }
    if (m.stat === "attackSpeed") {
      if (benefit.hardRejected) return n;
      const actual=benefit.before.attackSpeed>0 && benefit.after?.attackSpeed>0 ?
        benefit.after.attackSpeed/benefit.before.attackSpeed-1 : amount;
      const gain = benefit.unknown.length ? actual * .35 : benefit.components.speed;
      // Evaluate the whole card speed delta once, including duration interaction.
      return n + (m === (mods || []).find(v=>v.stat==="attackSpeed") ? 110*gain*benefit.context.weights.output*decisionWeight(m.stat) : 0);
    }
    const group=(player?.run?.tempMods || []).filter(v=>v.stat===m.stat && v.mul>=1)
      .reduce((sum,v)=>sum+v.mul-1,0);
    if (m.mul>=1 && !flatStats.has(m.stat)) amount=(m.add || 0)+(m.mul-1)/(1+group);
    if (benefit.confidence === "native-shadow" && Number.isFinite(benefit.before[m.stat]) && Number.isFinite(benefit.after?.[m.stat])) {
      // Same-group addition and cross-group multiplication are already resolved
      // by native recompute. Score the card's total change to each stat once.
      if (m !== (mods || []).find(v=>v.stat===m.stat)) return n;
      amount=flatStats.has(m.stat)?benefit.after[m.stat]-benefit.before[m.stat]:
        benefit.before[m.stat]!==0?benefit.after[m.stat]/benefit.before[m.stat]-1:benefit.after[m.stat];
    }
    if (
      m.stat === "critChance" &&
      amount > 0 &&
      player?.stats?.critChance != null
    )
      amount = Math.min(amount, Math.max(0, 2 - player.stats.critChance - (player.stats.megaCrit || 0)));
    if (m.stat === "evasion" && amount > 0)
      amount = Math.min(amount, Math.max(0, 0.6 - (stats.evasion || 0)));
    if (m.stat === "lifesteal" && amount > 0 && hitRate > 0)
      amount = Math.min(
        amount,
        Math.max(0, maxHp * 0.05 - leech) / (hitRate * (1 + maxHp * 0.005)),
      );
    if (m.stat === "projectiles" && moves) {
      const active = moves
        .filter(Boolean)
        .filter((move) => (move.def || move).arch !== "buff");
      const gain = active.reduce((sum, move) => {
        const def = move.def || move;
        if (def.arch==="fusion" || def.fusion) {
          const profile=fusionBenefitProfile(move),count=Math.max(0,Math.floor((move.mods?.count || 0)+(stats.projectiles || 0))),
            next=Math.max(0,Math.floor((move.mods?.count || 0)+(stats.projectiles || 0)+amount));
          if (!profile) return sum+.35*amount/Math.max(1,count+1);
          const channelGain=profile.counts.reduce((total,c)=>{
            const before=c.base+Math.min(c.max,Math.floor(count*c.per)),after=c.base+Math.min(c.max,Math.floor(next*c.per));
            return total+c.share*(before>0?after/before-1:after>0?after/(c.base+c.max||1):0);
          },0), repeat=n=>1+(profile.repeats?.7*Math.min(2,n):0);
          const immediate=(1+channelGain)*repeat(next)/repeat(count)-1;
          // Fractional progress can unlock a later integer step. Give only a
          // small investment, and none if every count/repeat channel is capped.
          const canGrow=profile.counts.some(c=>Math.floor(count*c.per)<c.max)||profile.repeats&&count<2,
            investment=amount>0&&next===count&&canGrow?Math.min(.02,amount*.02):0;
          return sum+immediate+investment;
        }
        if (!moveArchitectureStats[def.arch]?.includes("count")) return sum;
        const count =
          (def.count ?? 1) + (move.mods?.count || 0) + (stats.projectiles || 0);
        const cap=def.arch==='wave'?12:Infinity,
          before = Math.min(cap,Math.max(1, Math.floor(count))),
          after = Math.min(cap,Math.max(1, Math.floor(count + amount)));
        // The native cast floors this sum. A half step that adds no shot is
        // only a small investment in a later card, never half a full volley.
        const investment =
          after === before && before<cap ? clamp(amount, -0.5, 0.5) * 0.08 : 0;
        return sum + (after - before + investment) / before;
      }, 0);
      return (
        n + (90 * decisionWeight(m.stat) * gain) / Math.max(1, active.length)
      );
    }
    if(m.stat==="area" && moves?.length) {
      const defs=moves.filter(Boolean),base=benefit.before?.area ?? stats.area ?? 1,
        next=benefit.after?.area ?? base*(1+amount),radius=value=>Math.min(3.4,1.25*Math.max(.3,value)**.9),
        gain=defs.reduce((total,move)=>{
          const d=move.def||move,profile=fusionBenefitProfile(move);
          if(d.arch!=="fusion"&&!d.fusion) {
            if(!globalMoveStats055[d.arch]?.includes("area"))return total;
            const cap=towerAreaRadiusCap(move,player),factor=Number(d.area)*(move.mods?.area ?? 1);
            return total+(Number.isFinite(cap)&&factor>0&&base>0?
              Math.min(cap,next*factor)/Math.min(cap,base*factor)-1:amount);
          }
          const factor=move.mods?.area ?? 1;
          if(!profile)return total+.35*(radius(next*factor)/radius(base*factor)-1);
          return total+(profile.area?radius(next*factor)/radius(base*factor)-1:0);
        },0)/Math.max(1,defs.length);
      return n+(weights.area ?? 10)*decisionWeight("area")*gain;
    }
    if(m.stat==="statusChance" && moves?.length) {
      const before=benefit.before.statusChance ?? stats.statusChance ?? 1,
        after=benefit.after?.statusChance ?? before*(1+amount),
        stableBefore=benefit.stableBefore?.statusChance ?? before,
        stableAfter=benefit.stableAfter?.statusChance ?? after,
        gain=(statusProbabilityGain(player,before,after)+statusProbabilityGain(player,stableBefore,stableAfter))/2;
      const hasAttack=playerStatusChannels(player).channels.length>0 || moves.some(m=>!['buff','weather'].includes((m.def||m).arch));
      return n+weights.statusChance*decisionWeight("statusChance")*gain*+hasAttack;
    }
    if(m.stat==='duration'&&moves?.length) {
      const base=benefit.before.duration??stats.duration??1,next=benefit.after?.duration??base*(1+amount),
        gain=moves.filter(Boolean).reduce((total,move)=>{
          const d=move.def||move;
          if(d.arch==='fusion'||d.fusion){const variants=fusionVariants(move);return total+(variants.length?variants.reduce((sum,v)=>sum+v.weight*+v.profile.duration*amount,0):.35*amount);}
          if(!globalMoveStats055[d.arch]?.includes('dur'))return total;
          if(d.arch==='vortex'){
            const factor=(d.dur||0)*(move.mods?.dur??1),cap=30/Math.max(1,(d.speed||0)*(move.mods?.speed??1)*(stats.projSpeed||1));
            return total+(factor*base>0?Math.min(cap,factor*next)/Math.min(cap,factor*base)-1:0);
          }
          return total+amount;
        },0)/Math.max(1,moves.filter(Boolean).length),
        statusGain=playerStatusChannels(player).channels.some(c=>c.status!=='stun')?.25*amount:0;
      // Extended status lifetime is a separate coverage proxy, not another
      // full damage multiplier. Avoid double-counting a maintained zone.
      return n+weights.duration*decisionWeight('duration')*(Math.abs(gain)>=Math.abs(statusGain)?gain:statusGain);
    }
    if(m.stat==="armor" && benefit.context.tower) {
      const armor=benefit.stableBefore?.armor ?? stats.armor ?? 0,
        club=player?.items?.get?.("thick-club") || 0,
        physical=(moves || []).filter(Boolean).filter(move=>(move.def || move).cls==="physical").length,
        attacks=(moves || []).filter(Boolean).filter(move=>!['buff','weather'].includes((move.def || move).arch)).length,
        gain=(1+Math.min(.5,Math.max(0,armor+amount)/200)*club)/(1+Math.min(.5,Math.max(0,armor)/200)*club)-1;
      n+=90*gain*physical/Math.max(1,attacks)*benefit.context.weights.output*decisionWeight("armor");
    }
    // Keep the below-target part of a crossing card at full value. Mixed
    // cards retain their independent non-luck contributions.
    if(m.stat==='luck' && amount>0 && player?.luckTiming) {
      const timing=player.luckTiming, full=Math.min(amount,Math.max(0,timing.target-(stats.luck || 0)));
      amount=full+(amount-full)*timing.factor;
    }
    let weight = weights[m.stat] ?? 10;
    if(m.stat==="luck" && benefit.context.tower)
      weight*=benefit.context.luckFactor/(1+Math.max(0,stats.luck || 0)/100);
    if (["damage","physical","special","critChance","critDamage","statusDamage","eliteDamage","superEffective"].includes(m.stat)) weight *= benefit.context.weights.output;
    if (["xpGain","xpMult"].includes(m.stat)) weight *= benefit.context.weights.growth;
    if (towerDefenseStats.has(m.stat)) weight *= benefit.context.weights.survival;
    if (amount > 0 && ["regen", "healing", "lifesteal"].includes(m.stat))
      weight *= sustainGain;
    // A move-speed loss at ordinary or already reduced speed is a commitment
    // the navigator cannot undo. Large XP bonuses must not conceal that risk.
    if (m.stat === "moveSpeed" && amount < 0)
      weight =
        Math.max(weight, (stats.moveSpeed || 1) <= 1.1 ? 450 : 180) * urgency;
    let applicability=modApplicability(m.stat,moves);
    if(!applicability&&['damage','physical','special','critDamage','eliteDamage','superEffective'].includes(m.stat)) {
      const classes=independentDamageClasses(player);
      applicability=['physical','special'].includes(m.stat)?classes.filter(c=>c===m.stat).length/Math.max(1,classes.length):+!!classes.length;
    }
    if(!applicability&&m.stat==='statusDamage')
      applicability=+playerStatusChannels(player).channels.some(c=>['burn','poison'].includes(c.status));
    return (
      n +
      weight *
        (amount < 0
          ? Math.max(1, decisionWeight(m.stat))
          : decisionWeight(m.stat)) *
        amount *
        applicability
    );
  }, independentCriticalScore);
}

const vitaminDefinitions = {
  protein: ["physical", 0.1, "mul"],
  calcium: ["special", 0.1, "mul"],
  iron: ["armor", 5, "add"],
  zinc: ["shieldMax", 12, "add"],
  carbos: ["moveSpeed", 0.07, "mul"],
  "hp-up": ["maxHp", 18, "add"],
  "pp-up": ["projectiles", 0.5, "add"],
  ether: ["attackSpeed", 0.08, "mul"],
  "dire-hit": ["critChance", 0.05, "add"],
  "x-speed": ["projSpeed", 0.12, "mul"],
  "x-defense": ["evasion", 0.035, "add"],
  "x-attack": ["statusChance", 0.15, "mul"],
  stardust: ["area", 0.1, "mul"],
  elixir: ["duration", 0.1, "mul"],
  "super-potion": ["regen", 0.7, "add"],
  nugget: ["gold", 0.15, "mul"],
  "exp-candy": ["xpGain", 0.1, "mul"],
  "star-piece-v": ["luck", 10, "add"],
  "max-potion": ["lifesteal", 0.02, "add"],
  "escape-rope": ["pickupRange", 1.2, "add"],
  cursed: ["difficulty", 0.12, "mul"],
  "sticky-barb": ["thorns", 10, "add"],
  "enigma-berry": ["overheal", 0.05, "add"],
  "super-lure": ["eliteSpawn", 0.18, "mul"],
  "poke-radar": ["powerup", 0.15, "mul"],
  "loaded-dice": ["luck", 0, "add"],
};

const vitaminSpecialDefinitions = {
  cursed: { extra: [{ stat: "xpGain", mul: 0.06 }, { stat: "gold", mul: 0.06 }] },
  "super-lure": { extra: [{ stat: "eliteDamage", mul: 0.05 }] },
  "loaded-dice": { dice: true },
};

function vitaminDefinition(data, key) {
  const live = data.vitamins?.get?.(key) || data.data?.vitamins?.get?.(key),
    fallback = vitaminDefinitions[key];
  return live || (fallback && { key, stat: fallback[0], per: fallback[1],
    kind: fallback[2], ...vitaminSpecialDefinitions[key] });
}

function vitaminEffectValue(def, multiplier, hp, player, data) {
  if (def.dice) {
    const live = data.vitamins || data.data?.vitamins,
      definitions = live?.size ? [...live.values()] :
        Object.keys(vitaminDefinitions).map(key => vitaminDefinition({}, key)),
      // Public native de(): uniform pick from non-dice, no-extra vitamins,
      // excluding overheal and powerup. Evaluate every possible roll without
      // calling native RNG or presenting an expected value as a guaranteed roll.
      pool = definitions.filter(entry => entry && !entry.dice && !entry.extra &&
        !["overheal", "powerup"].includes(entry.stat) && Number.isFinite(entry.per));
    return pool.length ? pool.reduce((sum, entry) => sum +
      vitaminEffectValue(entry, multiplier * 1.5, hp, player, {}), 0) / pool.length : 0;
  }
  const amount = def.per * multiplier;
  return scoreMods([{ stat: def.stat,
    [def.kind === "add" ? "add" : "mul"]: def.kind === "add" ? amount : 1 + amount },
    ...(def.extra || []).map(extra => ({ stat: extra.stat, mul: 1 + extra.mul * multiplier }))], hp, player);
}

function moveDefinition(data, id) {
  const raw =
    data.moves?.get?.(id) ||
    data.data?.moves?.get?.(id) ||
    data.movesByKey?.get?.(id) ||
    data.data?.movesByKey?.get?.(id);
  return data.moveDef?.(raw?.id ?? id) || raw || {};
}

function baseOfferScore(offer, run, data) {
  if (!offer) return -Infinity;
  const p = Object.assign(Object.create(run.player), {decisionBenefit:evaluateOfferBenefit(offer,run,data)});
  const hp = p.maxHp > 0 ? p.hp / p.maxHp : 1;
  const preferred = (run.build?.moves || []).map((m) =>
    typeof m === "object" ? m.key : m,
  );
  const keyFor = (m) => m?.def?.key ?? m?.def?.id ?? m?.key ?? m?.id;
  const owned = p.moves.filter(Boolean).map(keyFor);
  if (offer.kind === "item") {
    const key = offer.id || offer.key,
      def = data.items?.get?.(key);
    if (!def) return -Infinity;
    const count = p.items?.get?.(key) || 0;
    if (count >= (def.max ?? 10)) return -Infinity;
    let score = scoreMods(def.mods, hp, p);
    const held = p.moves.filter(Boolean).map((m) => m.def || m);
    // The native type-item mapping adds a type multiplier outside item.mods.
    // Every such item still has +3% global damage; unrelated types are modest
    // benefits, not a reason to manufacture a nonexistent zero-effect item.
    const first = count === 0;
    const passive = {
      "shell-bell": 28,
      "berry-juice": 14,
      "adrenaline-orb": 12,
      "focus-band": 22,
      "focus-sash": 65,
      "shed-shell": 60,
      stick: 18,
      "razor-fang": 16,
      "cell-battery": 16,
      "fire-stone":
        held.some((m) => m.status === "burn") || p.items?.has?.("flame-orb")
          ? 18
          : 0,
      "griseous-orb": 22,
      "reaper-cloth": 15,
      electirizer: 30,
      "leaf-stone": 35,
      revive: 75,
      "max-revive": 90,
      "rare-candy": 35,
      "rainbow-wing": 85,
    };
    const defenseScale=isTowerRun(run)?.01:1,conditional=conditionalItemBenefit(key,p,data);
    score += (passive[key] || 0) * (first ? 1 : 0.6) * (towerDefenseItems.has(key)?defenseScale:1);
    if(conditional) score+=90*conditional.gain*p.decisionBenefit.context.weights.output;
    if (key === "smoke-ball" && first) score += 25*defenseScale;
    if (key === "sitrus-berry" && first) score += 45*defenseScale;
    if (key === "lum-berry") score += (first ? 25 : 12)*defenseScale;
    if (key === "eviolite" && data.data?.evolutionsOf?.(p.speciesId)?.length)
      score += scoreMods(
        [
          { stat: "armor", mul: 1.5 },
          { stat: "maxHp", mul: 1.25 },
        ],
        hp,
        p,
      );
    // Never turn an actual downside into an attractive card with its rarity or
    // presence in someone else's final inventory. Re-evaluate its live costs.
    if (key === "life-orb" && hp < 0.6 && !isTowerRun(run)) score -= 30;
    return score+deferredItemValue(key,{...run,player:p},data).score;
  }
  if (offer.kind === "newMove") {
    const m = moveDefinition(data, offer.id);
    const key = m.key || offer.id;
    const index = preferred.indexOf(key);
    const available =
      run.availableMoveKeys == null ? null : new Set(run.availableMoveKeys);
    const unavailable = new Set(run.build?.unavailableMoves || []);
    const missing = preferred.filter(
      (v) =>
        !owned.includes(v) &&
        !unavailable.has(v) &&
        (available == null || available.has(v)) &&
        data.canLearnMove?.(v, p) !== false,
    );
    const free = (p.moveSlots || run.moveSlots || 3) - owned.length;
    // Keep the final slot available when a later signature move is part of the build.
    // Availability does not guarantee a random offer. Stop waiting at the same
    // level even when an old leaderboard move remains technically learnable.
    const reserve =
      index < 0 &&
      missing.length &&
      free <= missing.length &&
      (p.level == null || p.level <= (run.build?.reserveUntilLevel ?? 20));
    const wanted = { burned: "burn", paralyzed: "paralysis", soaked: "wet" };
    const helpsTask = Object.entries(wanted).some(
      ([metric, status]) =>
        (run.objectiveMetric || "").includes(metric) && m.status === status,
    );
    const held = p.moves.filter(Boolean).map((v) => v.def || v);
    const controlQuality = (move) => {
      const def = move.def || move,
        mod = move.mods || {},
        stats = p.stats || {};
      if (["buff", "weather"].includes(def.arch)) return { hard: 0, slow: 0 };
      const chance = clamp(
        (def.statusChance ?? 0.15) *
          (mod.status ?? 1) *
          (stats.statusChance ?? 1),
        0,
        1,
      );
      const cd = Math.max(
        0.12,
        ((def.cd ?? 1.5) * (mod.cd ?? 1)) /
          Math.max(0.01, stats.attackSpeed ?? 1),
      );
      const duration = Math.max(0, stats.duration ?? 1);
      let attempts = moveArchitectureStats[def.arch]?.includes("count")
        ? Math.min(
            2,
            Math.max(
              1,
              Math.floor(
                (def.count ?? 1) + (mod.count || 0) + (stats.projectiles || 0),
              ),
            ),
          )
        : 1;
      if (["beam", "cone"].includes(def.arch))
        attempts = Math.min(
          3,
          Math.max(
            0,
            Math.ceil(
              ((def.dur ?? 0.1) * (mod.dur ?? 1) * duration) /
                (def.arch === "beam" ? 0.09 : 0.1),
            ),
          ),
        );
      // Estimate a few chances on one target, never area times enemy count.
      // Sleep wakes on another hit; value only a short interrupt, not its
      // nominal three seconds of guaranteed body-contact protection.
      const proc = 1 - (1 - chance) ** attempts;
      let hard = 0,
        slow = 0;
      if (def.status === "sleep")
        hard = proc * Math.min(1, Math.min(0.5, 3 * duration) / cd);
      if (def.status === "stun") hard = (proc * 0.5) / Math.max(1.5, cd);
      // Freeze needs three procs before chill expires. Bound the opportunities
      // in its three-second window and use the probability of three successes,
      // rather than awarding a freeze for one cold projectile.
      if (def.status === "freeze") {
        const trials = Math.min(6, attempts * Math.ceil(3 / cd));
        if (trials >= 3) {
          const miss = 1 - chance;
          const belowThree =
            miss ** trials +
            trials * chance * miss ** (trials - 1) +
            ((trials * (trials - 1)) / 2) * chance ** 2 * miss ** (trials - 2);
          hard =
            (1 - clamp(belowThree, 0, 1)) * Math.min(1, (1.6 * duration) / cd);
        }
      }
      if (def.status === "root")
        slow = 0.65 * proc * Math.min(1, (2 * duration) / cd);
      if (def.status === "paralysis")
        slow = 0.5 * proc * Math.min(1, (3 * duration) / cd);
      if (def.status === "confusion")
        slow = 0.25 * proc * Math.min(1, (3 * duration) / cd);
      return { hard, slow };
    };
    // Drain is proportional to damage actually delivered. A weak single homing
    // shot must not outweigh clearing a horde just because it can heal.
    const drainRate =
      ((m.dmg || 0) * (m.drain || 0) * Math.max(1, m.count || 1)) /
      Math.max(0.2, m.cd || 1.5);
    const recoveryBonus =
      m.drain > 0 && !held.some((v) => v.drain > 0)
        ? Math.min(18, drainRate * 6) * (hp < 0.5 ? 1.5 : 1)
        : 0;
    const candidateControl = controlQuality(m);
    const existingControl = p.moves.filter(Boolean).map(controlQuality);
    const controlBonus =
      24 *
        Math.max(
          0,
          candidateControl.hard -
            Math.max(0, ...existingControl.map((v) => v.hard)),
        ) +
      6 *
        Math.max(
          0,
          candidateControl.slow -
            Math.max(0, ...existingControl.map((v) => v.slow)),
        );
    return (
      (reserve ? -150 : 70) +
      // The final loadout is a preference, not a reason to reject lifesaving
      // recovery or a strong upgrade while reproducing a different account.
      (index >= 0 ? 75 - Math.min(index, 6) * 5 : 0) +
      (m.count || 1) * 3 +
      (m.type && p.types?.includes(m.type) ? 12 : 0) +
      (/^(barrage|beam|chain|orbit|aura|nova|wave|vortex)$/.test(m.arch || "")
        ? 18
        : 0) +
      (helpsTask ? 60 : 0) +
      recoveryBonus +
      controlBonus
    );
  }
  if (offer.kind === "upMove") {
    const move = p.moves[offer.slot];
    const preferredIndex = preferred.indexOf(keyFor(move));
    const def = move?.def || move || {},
      mod = move?.mods || {};
    if (def.arch === "buff") {
      const next = { cd: mod.cd ?? 1, dur: mod.dur ?? 1 };
      for (const u of offer.ups || []) {
        if (u.key === "cd") next.cd *= 1 - u.value;
        if (u.key === "dur") next.dur += u.value;
      }
      const coverage = (m) =>
        Math.min(
          1,
          ((def.dur ?? 6) * (m.dur ?? 1) * (p.stats?.duration ?? 1)) /
            Math.max(
              0.12,
              ((def.cd ?? 14) * (m.cd ?? 1)) /
                Math.max(0.01, p.stats?.attackSpeed ?? 1),
            ),
        );
      // Native Up also adds damage and a move level, but neither scales the
      // fixed move-buff nor grants player XP/evolution progress. Only closing
      // gaps in its coverage helps; rarity alone cannot strengthen that buff.
      const marginalCoverage = coverage(next) - coverage(mod);
      return (
        2 +
        marginalCoverage *
          (110 +
            (preferredIndex >= 0 ? 35 - Math.min(preferredIndex, 5) * 2 : 0)) +
        // Keep actual immediate player modifiers, when present, even if the
        // buff itself is already permanent. A harmless upgrade remains a
        // modest fallback when every other available card is worse.
        scoreMods(offer.mods, hp, p)
      );
    }
    const upgradeWeights = {
      dmg: 90,
      cd: 110,
      count: 24,
      area: 60,
      speed: 35,
      dur: 50,
      pierce: 7,
      crit: 80,
      status: 30,
      bounce: 9,
    };
    const gain = (offer.ups || []).reduce((n, u) => {
      let value = u.value || 0;
      if (u.key === "count")
        return (
          n +
          (90 * value) /
            Math.max(
              1,
              (def.count || 1) + (mod.count || 0) + (p.stats?.projectiles || 0),
            )
        );
      if (u.key === "cd") value = 1 / Math.max(0.1, 1 - value) - 1;
      else if (["dmg", "area", "speed", "dur", "status"].includes(u.key))
        value /= mod[u.key] || 1;
      return n + (upgradeWeights[u.key] ?? 0) * value;
    }, 0);
    return (
      28 +
      (preferredIndex >= 0 ? 35 - Math.min(preferredIndex, 5) * 2 : 0) +
      (offer.rarity || 0) * 6 +
      gain +
      scoreMods(offer.mods, hp, Object.assign(Object.create(p), { moves: move ? [move] : [] }))
    );
  }
  if (offer.kind === "newVit" || offer.kind === "upVit") {
    const def = vitaminDefinition(data, offer.vit);
    if (!def) return -10;
    const multiplier =
      data.rarityMultipliers?.[offer.rarity || 0] ??
      [1, 1.2, 1.45, 1.75, 2.1][offer.rarity || 0] ??
      1;
    const value = vitaminEffectValue(def, multiplier, hp, p, data);
    const vitaminPriority =
      run.build?.vitaminPriority ||
      (run.build?.vitamins || []).map((v) =>
        typeof v === "string" ? v : v.k || v.key,
      );
    const priority = vitaminPriority.findIndex(
      (v) => v === offer.vit || v === def.stat,
    );
    // No card-rarity bonus can turn an unused vitamin into a useful choice.
    if (value <= 0) return value - 12;
    // Flat novelty/rank bonuses must not resurrect late luck or pure defense.
    if(isTowerRun(run) && (def.stat==="luck" || offerUtilityTier(offer,run,data)<0)) return value;
    const futurePreferred=run.build?.sourceType!=='custom'&&!run.build?.finalReplacement?.vitamins?.active&&
      !(run.build?.towerStrategy?.vitaminFocus&&run.build.towerStrategy.vitaminFocus!=='inherit')&&
      !(run.build?.towerStrategy?.vitaminPriorities||[]).some(Boolean)&&
      (run.build?.characterForesightVitaminKeys||[]).some(key=>key===offer.vit||key===def.stat);
    return (
      15 +
      value +
      (offer.rarity || 0) * 2 +
      (priority >= 0 ? Math.max(2, 12 - priority * 2) : 0)+
      // A full generic 26-key fallback is not a user's explicit hard order.
      // Keep its score intact and add only a small positive tie preference.
      (futurePreferred?Math.min(2,(15+value)*.05):0)
    );
  }
  if (offer.mods) return scoreMods(offer.mods, hp, p);
  return 15 + (offer.rarity || 0) * 5;
}

// Preferences only rank choices. Mandatory native pages still get a legal
// fallback in the controller when every preference is exhausted or avoided.
// Current native item effects, not item names or future unlock hints. The one
// conditional effect below is the reviewed Allies.mods -> Sg(ghost) multiplier.
export function nativeEvasionItemGain(key, nativeRun = {}, data = {}, potential = false) {
  const def=data.items?.get?.(key)||data.data?.items?.get?.(key);
  if(!def)return 0;
  let gain=0;
  for(const mod of def.mods||[])if(mod?.stat==="evasion"){
    if(Number.isFinite(mod.add)&&mod.add>0)gain+=mod.add;
    if(Number.isFinite(mod.mul)&&mod.mul>1)gain+=mod.mul-1;
  }
  if(key==="poke-doll"&&potential)return Math.max(gain,.015);
  if(key==="poke-doll")for(const ally of nativeRun.allies?.list||[])
    if(ally?.types?.[0]==="ghost")gain+=.015*(ally.shiny?2:1);
  return gain;
}
export function characterEvasionItemPriority(offer, run = {}, data = {}) {
  if(run.build?.characterUnlockItemPriority!==true)return 0;
  if(offer?.kind==="item")return nativeEvasionItemGain(offer.id||offer.key,run.nativeRun||run.player?.run||{},data);
  if(["newVit","upVit"].includes(offer?.kind)){
    const def=data.vitamins?.get?.(offer.vit)||data.data?.vitamins?.get?.(offer.vit);
    return def?.stat==="evasion"&&Number.isFinite(def.per)&&def.per>0?def.per:0;
  }
  return 0;
}

export function scoreOffer(offer, run, data = {}, options = {}) {
  const value=scoreNativeOffer(offer,run,data,options);
  return Number.isFinite(value)&&value>0?value+towerOfferPriority(offer,run,data):value;
}
// A missing definition is not evidence that a native reward is harmful. This
// check is only used for an already-open item page, not a catalogue scan. Keep
// explicit exclusions/capacity limits authoritative while the current bridge
// can be refreshed; never sell an unknown reward merely because scoring failed.
export function unresolvedNativeItemOffer(raw, context = {}, data = {}) {
  const key = typeof raw === "string" ? raw : raw?.kind === "item" ? raw.id || raw.key : null;
  if (!key || data.items?.get?.(key)) return false;
  const player = context.player, build = context.build || {},
    rule = build.itemRules?.find(entry => entry.key === key),
    count = Number(player?.items?.get?.(key)) || 0,
    target = rule?.targetCount ?? build.itemCounts?.[key];
  if (rule?.avoid || build.avoidItems?.includes(key) ||
      target != null && count >= target ||
      build.sourceType === "custom" && build.allowOffPlan === false && !rule ||
      typeof player?.canHold === "function" && player.canHold(key) === false) return false;
  return true;
}
function scoreNativeOffer(offer, run, data = {}, options = {}) {
  if (!offer || !run?.player) return -Infinity;
  const build = run.build || {};
  const player = decisionPlayer(run);
  const descriptor=costOfferDescriptor(offer,data),costPolicy=run.costPolicy,
    forcedCost=costPolicy?.forceCostInteractions===true&&descriptor.cost&&descriptor.positiveEffects.length>0;
  if(descriptor.cost&&costPolicy&&!forcedCost&&run.costMandatory!==true&&
      (costPolicy.riskyInteractions!==true||costPolicy.allowAutomatic===false))return -Infinity;
  if(!forcedCost&&run.costMandatory!==true&&!masteryOfferAllowed(offer,run,data))return -Infinity;
  const freeItem=offer.kind==="item" && (run.purpose || 'free')==='free';
  if(!forcedCost && run.costMandatory!==true && !characterEvasionItemPriority(offer,run,data) &&
      evaluateOfferBenefit(offer,run,data).hardRejected && !freeItem && !options.allowZeroBenefit)return -Infinity;
  let category,
    key,
    count = 0;
  if (offer.kind === "item") {
    category = "item";
    key = offer.id || offer.key;
    count = player.items?.get?.(key) || 0;
    if (typeof player.canHold === "function" && !player.canHold(key))
      return -Infinity;
  } else if (["newMove", "upMove"].includes(offer.kind)) {
    category = "move";
    const move = offer.kind === "upMove" ? player.moves?.[offer.slot] : null;
    key =
      move?.def?.key ||
      move?.def?.id ||
      moveDefinition(data, offer.id).key ||
      offer.id;
    count = move?.level || 0;
  } else if (["newVit", "upVit"].includes(offer.kind)) {
    category = "vitamin";
    key = offer.vit;
    const held = player.vitamins?.get?.(key);
    count = typeof held === "number" ? held : held?.level || 0;
  }
  if(forcedCost){
    const def=category==="item"?(data.items?.get?.(key)||data.data?.items?.get?.(key)):
      category==="vitamin"?vitaminDefinition(data,key):null;
    if(category==="item"&&def&&count>=(def.max??10))return -Infinity;
    if(category==="vitamin"&&Number.isFinite(player.vitCap)&&count>=player.vitCap)return -Infinity;
    return costPositiveScore(descriptor,run)+(Number(offer.rarity)||0)*2;
  }
  const evasionPriority=characterEvasionItemPriority(offer,run,data);
  const rules = build[`${category}Rules`] || [];
  const rule = rules.find((entry) => entry.key === key);
  const avoid =
    build[
      { item: "avoidItems", move: "avoidMoves", vitamin: "avoidVitamins" }[
        category
      ]
    ] || [];
  if (!evasionPriority&&(rule?.avoid || avoid.includes(key))) return -Infinity;
  if (!evasionPriority&&run.purpose === "copy" && rule?.copy === false) return -Infinity;
  if (!evasionPriority&&run.purpose === "shop" && rule?.shop === false) return -Infinity;
  const target =
    category === "move"
      ? rule?.targetLevel
      : (rule?.targetCount ?? build.itemCounts?.[key]);
  if (!evasionPriority&&target != null && count >= target) return -Infinity;
  if (
    !evasionPriority&&build.sourceType === "custom" &&
    build.allowOffPlan === false &&
    category &&
    !rule
  )
    return -Infinity;
  if(evasionPriority){
    const def=category==="item"?(data.items?.get?.(key)||data.data?.items?.get?.(key)):null;
    if(category==="item"&&count>=(def?.max??10)||category==="vitamin"&&Number.isFinite(player.vitCap)&&count>=player.vitCap)return -Infinity;
    return 1000000+evasionPriority*1000;
  }
  let score = baseOfferScore(offer, { ...run, player }, data);
  if (
    category === "vitamin" &&
    data.compatibility?.capabilities?.vitaminCatalog === false
  )
    score = 0;
  if (
    !Number.isFinite(score) &&
    category === "item" &&
    run.purpose === "free" &&
    typeof player.canHold === "function" &&
    player.canHold(key) &&
    !data.items?.get?.(key)
  )
    score = 0;
  if (!Number.isFinite(score)) return score;
  // Item priorities are compared lexicographically by every selection channel.
  // List order is not another hidden weight for equal numeric priorities.
  if (category !== "item" && rule && score > 0) {
    const bonus=Math.max(2,35-rules.indexOf(rule)*2);
    const diminished=isTowerRun(run) && (offerUtilityTier(offer,run,data)<0 || category==="vitamin" && vitaminDefinition(data,offer.vit)?.stat==="luck");
    score+=diminished?Math.min(score*.25,bonus):bonus;
  } else if (category === "vitamin" && (offer.kind === "newVit" || key === "cursed") && rule && score <= 0) {
    // An explicit plan vitamin is the player's accepted cost, e.g. Cursed Incense.
    score=Math.max(2,35-rules.indexOf(rule)*2);
  }
  return score;
}

export function masteryOfferAllowed(offer,run={},data={}) {
  const constraints=run.build?.masteryConstraints;if(!constraints)return true;
  const nativeRun=run.nativeRun || run.player?.run || run;
  if(nativeRun.coop&&run.build?.sourceType==="mastery"&&run.build.masteryAllowCoop!==true)return true;
  const state=masteryExecutionState(nativeRun,run.build?.sourceType==="mastery"?{mastery:{constraints,allowCoop:run.build.masteryAllowCoop===true}}:{challenge:constraints},data),
    item=offer?.kind==="item"?offer.id || offer.key:null,
    definition=item?data.items?.get?.(item):["newVit","upVit"].includes(offer?.kind)?data.vitamins?.get?.(offer.vit):null,
    stats=[definition?.stat,...(definition?.mods || []),...(offer?.mods || [])].map(mod=>typeof mod==="string"?mod:mod?.stat);
  if(constraints.noVitamins===true&&["newVit","upVit"].includes(offer?.kind))return false;
  if(item&&Number.isFinite(constraints.maxItemCount)) {
    let count=0;for(const value of run.player?.items?.values?.() || [])count+=Math.max(0,Number(value)||0);
    if(count+1>constraints.maxItemCount)return false;
  }
  if(state.avoidXp&&(item==="rare-candy"||stats.some(stat=>["xpGain","pickupRange"].includes(stat))))return false;
  if(Number(constraints.endHpMax)>0&&!state.endHpProtectedByClear&&!state.hpConditionImpossible&&(stats.some(stat=>["regen","healing","lifesteal"].includes(stat))||
      ["leftovers","shell-bell","big-root","black-sludge"].includes(item)))return false;
  return true;
}

export function interactionOptions(settings = {}, build = {}) {
  return {
    free: true,
    paid: true,
    copy: true,
    shop: true,
    roulette: true,
    tutor: true,
    shrine: true,
    healing: true,
    goldReserve: 0,
    maxSpend: null,
    totalBudget: null,
    ...(settings.interactions || {}),
    ...(build.interactions || {}),
  };
}

export function canSpendGold(cost, gold, rules = {}, spent = 0) {
  if (!Number.isFinite(cost) || cost < 0 || !Number.isFinite(gold))
    return false;
  if (cost === 0) return rules.free !== false;
  return (
    rules.paid !== false &&
    gold - cost >= Math.max(0, Number(rules.goldReserve) || 0) &&
    (rules.maxSpend == null ||
      cost <= Math.max(0, Number(rules.maxSpend) || 0)) &&
    (rules.totalBudget == null ||
      spent + cost <= Math.max(0, Number(rules.totalBudget) || 0))
  );
}

export function selectCopyItem(player, build = {}, data = {}, options = {}) {
  const run=options || {}, costPolicy=run.costPolicy || (Object.hasOwn(run,"forceCostInteractions") || Object.hasOwn(run,"riskyInteractions") ? run : null);
  const choices=[];
  for (const [key, count] of player.items || []) {
    const descriptor=costOfferDescriptor({kind:"item",id:key},data),forcedCost=costPolicy?.forceCostInteractions===true&&descriptor.cost&&descriptor.positiveEffects.length>0;
    if(!forcedCost&&!masteryOfferAllowed({kind:'item',id:key},{player,build,nativeRun:player.run},data))continue;
    if (
      typeof player.canHold === "function"
        ? !player.canHold(key)
        : count >= (data.items?.get?.(key)?.max ?? 10)
    )
      continue;
    const score = scoreOffer(
      { kind: "item", id: key },
      { ...run,player, build, purpose: "copy",costPolicy,nativeRun:run.nativeRun || player.run },
      data,
    );
    // An optional catalog can be absent while native canHold still proves that
    // this already-owned item is a legal copy. Explicit avoid/target rules win.
    const rule = build.itemRules?.find((entry) => entry.key === key),
      evasionPriority=characterEvasionItemPriority({kind:"item",id:key},{player,build},data);
    if (!evasionPriority&&( 
      !forcedCost&&rule?.avoid ||
      rule?.copy === false ||
      !forcedCost&&(build.avoidItems?.includes(key) ||
      (rule?.targetCount != null && count >= rule.targetCount) ||
      (build.itemCounts?.[key] != null && count >= build.itemCounts[key]) ||
      (build.allowOffPlan === false && build.sourceType === "custom" && !rule))
    ))
      continue;
    const value=Number.isFinite(score) ? score : 0;
    const context={...run,player,build,purpose:"copy",nativeRun:run.nativeRun || player.run};
    if(!Number.isFinite(score)&&(descriptor.cost||data.items?.get?.(key)||data.data?.items?.get?.(key)||
        typeof player.canHold!=="function"))continue;
    choices.push({key,score:value,experiencePriority:itemExperiencePriority(key,context,data),utilityTier:offerUtilityTier({kind:"item",id:key},context,data),cost:descriptor.cost,forcedCost,costRank:costPriorityRank(descriptor,costPolicy||{})});
  }
  const evasion=choices.filter(row=>characterEvasionItemPriority({kind:"item",id:row.key},{player,build},data)>0)
    .sort((a,b)=>b.score-a.score)[0];
  if(evasion)return evasion.key;
  const costs=choices.filter(row=>row.cost&&row.score>0).sort(compareCostChoices);
  if(costPolicy?.forceCostInteractions===true&&costs.length)return costs[0].key;
  return choices.filter(row=>(!row.cost||row===costs[0]) && (row.score>0 || !data.items?.get?.(row.key))).sort(compareOfferCandidates)[0]?.key??null;
}

export function offensiveRiskAllowed(run = {}, options = {}) {
  const p=run.player||{},hp=Number(p.hp),maximum=Number(p.maxHp);
  if(!(hp>0)||!(maximum>0)||p.dead)return false;
  if(options.forceCostInteractions===true)return true;
  if(options.risky!==true||options.safeMode===true)return false;
  return !(hp/maximum<.2&&Number(options.pressure)>1);
}

export const costEffectCatalog = Object.freeze([
  {
    "id": "damage",
    "label": "总伤害",
    "kind": "stat",
    "description": "总伤害的原生正面提升；负向变化不能命中此优先项。",
    "nativeFields": [
      "player.stats.damage"
    ],
    "sources": [
      {
        "path": "research/update-1.5.1-055-main.min.js",
        "symbol": "pb",
        "start": 872958,
        "end": 874753
      },
      {
        "path": "research/update-1.5.1-055-main.min.js",
        "symbol": "rD",
        "start": 1377589,
        "end": 1379750
      },
      {
        "path": "research/update-1.5.1-055-main.min.js",
        "symbol": "HD",
        "start": 1392643,
        "end": 1393775
      },
      {
        "path": "research/update-1.5.1-055-runtime-definitions.json",
        "symbol": "items",
        "pointer": "/items/67"
      },
      {
        "path": "research/update-1.5.1-055-runtime-definitions.json",
        "symbol": "items",
        "pointer": "/items/111"
      },
      {
        "path": "research/update-1.5.1-055-main.min.js",
        "symbol": "rageBonus",
        "start": 822220,
        "end": 822277
      }
    ]
  },
  {
    "id": "attackSpeed",
    "label": "攻击速度",
    "kind": "stat",
    "description": "攻击速度的原生正面提升；负向变化不能命中此优先项。",
    "nativeFields": [
      "player.stats.attackSpeed"
    ],
    "sources": [
      {
        "path": "research/update-1.5.1-055-main.min.js",
        "symbol": "pb",
        "start": 872958,
        "end": 874753
      }
    ]
  },
  {
    "id": "maxHp",
    "label": "最大生命",
    "kind": "stat",
    "description": "最大生命的原生正面提升；负向变化不能命中此优先项。",
    "nativeFields": [
      "player.stats.maxHp"
    ],
    "sources": [
      {
        "path": "research/update-1.5.1-055-main.min.js",
        "symbol": "pb",
        "start": 872958,
        "end": 874753
      },
      {
        "path": "research/update-1.5.1-055-runtime-definitions.json",
        "symbol": "items",
        "pointer": "/items/101"
      }
    ]
  },
  {
    "id": "moveSpeed",
    "label": "移动速度",
    "kind": "stat",
    "description": "移动速度的原生正面提升；负向变化不能命中此优先项。",
    "nativeFields": [
      "player.stats.moveSpeed"
    ],
    "sources": [
      {
        "path": "research/update-1.5.1-055-main.min.js",
        "symbol": "pb",
        "start": 872958,
        "end": 874753
      },
      {
        "path": "research/update-1.5.1-055-main.min.js",
        "symbol": "rD",
        "start": 1377589,
        "end": 1379750
      },
      {
        "path": "research/update-1.5.1-055-main.min.js",
        "symbol": "HD",
        "start": 1392643,
        "end": 1393775
      }
    ]
  },
  {
    "id": "critChance",
    "label": "暴击率",
    "kind": "stat",
    "description": "暴击率的原生正面提升；负向变化不能命中此优先项。",
    "nativeFields": [
      "player.stats.critChance"
    ],
    "sources": [
      {
        "path": "research/update-1.5.1-055-main.min.js",
        "symbol": "pb",
        "start": 872958,
        "end": 874753
      },
      {
        "path": "research/update-1.5.1-055-main.min.js",
        "symbol": "rD",
        "start": 1377589,
        "end": 1379750
      }
    ]
  },
  {
    "id": "area",
    "label": "效果范围",
    "kind": "stat",
    "description": "效果范围的原生正面提升；负向变化不能命中此优先项。",
    "nativeFields": [
      "player.stats.area"
    ],
    "sources": [
      {
        "path": "research/update-1.5.1-055-main.min.js",
        "symbol": "pb",
        "start": 872958,
        "end": 874753
      }
    ]
  },
  {
    "id": "xpGain",
    "label": "经验获取",
    "kind": "stat",
    "description": "经验获取的原生正面提升；负向变化不能命中此优先项。",
    "nativeFields": [
      "player.stats.xpGain"
    ],
    "sources": [
      {
        "path": "research/update-1.5.1-055-main.min.js",
        "symbol": "pb",
        "start": 872958,
        "end": 874753
      },
      {
        "path": "research/update-1.5.1-055-main.min.js",
        "symbol": "rD",
        "start": 1377589,
        "end": 1379750
      },
      {
        "path": "research/update-1.5.1-055-main.min.js",
        "symbol": "HD",
        "start": 1392643,
        "end": 1393775
      },
      {
        "path": "research/update-1.5.1-055-runtime-definitions.json",
        "symbol": "items",
        "pointer": "/items/56"
      },
      {
        "path": "research/update-1.5.1-055-runtime-definitions.json",
        "symbol": "items",
        "pointer": "/items/77"
      },
      {
        "path": "research/update-1.5.1-055-runtime-definitions.json",
        "symbol": "vitamins",
        "pointer": "/vitamins/20"
      }
    ]
  },
  {
    "id": "regen",
    "label": "生命再生",
    "kind": "stat",
    "description": "生命再生的原生正面提升；负向变化不能命中此优先项。",
    "nativeFields": [
      "player.stats.regen"
    ],
    "sources": [
      {
        "path": "research/update-1.5.1-055-main.min.js",
        "symbol": "pb",
        "start": 872958,
        "end": 874753
      }
    ]
  },
  {
    "id": "armor",
    "label": "护甲",
    "kind": "stat",
    "description": "护甲的原生正面提升；负向变化不能命中此优先项。",
    "nativeFields": [
      "player.stats.armor"
    ],
    "sources": [
      {
        "path": "research/update-1.5.1-055-main.min.js",
        "symbol": "pb",
        "start": 872958,
        "end": 874753
      },
      {
        "path": "research/update-1.5.1-055-runtime-definitions.json",
        "symbol": "items",
        "pointer": "/items/88"
      },
      {
        "path": "research/update-1.5.1-055-runtime-definitions.json",
        "symbol": "items",
        "pointer": "/items/101"
      }
    ]
  },
  {
    "id": "duration",
    "label": "效果持续时间",
    "kind": "stat",
    "description": "效果持续时间的原生正面提升；负向变化不能命中此优先项。",
    "nativeFields": [
      "player.stats.duration"
    ],
    "sources": [
      {
        "path": "research/update-1.5.1-055-main.min.js",
        "symbol": "pb",
        "start": 872958,
        "end": 874753
      }
    ]
  },
  {
    "id": "statusChance",
    "label": "异常状态几率",
    "kind": "stat",
    "description": "异常状态几率的原生正面提升；负向变化不能命中此优先项。",
    "nativeFields": [
      "player.stats.statusChance"
    ],
    "sources": [
      {
        "path": "research/update-1.5.1-055-main.min.js",
        "symbol": "pb",
        "start": 872958,
        "end": 874753
      }
    ]
  },
  {
    "id": "luck",
    "label": "幸运",
    "kind": "stat",
    "description": "幸运的原生正面提升；负向变化不能命中此优先项。",
    "nativeFields": [
      "player.stats.luck"
    ],
    "sources": [
      {
        "path": "research/update-1.5.1-055-main.min.js",
        "symbol": "pb",
        "start": 872958,
        "end": 874753
      },
      {
        "path": "research/update-1.5.1-055-main.min.js",
        "symbol": "rD",
        "start": 1377589,
        "end": 1379750
      },
      {
        "path": "research/update-1.5.1-055-runtime-definitions.json",
        "symbol": "items",
        "pointer": "/items/56"
      }
    ]
  },
  {
    "id": "critDamage",
    "label": "暴击伤害",
    "kind": "stat",
    "description": "暴击伤害的原生正面提升；负向变化不能命中此优先项。",
    "nativeFields": [
      "player.stats.critDamage"
    ],
    "sources": [
      {
        "path": "research/update-1.5.1-055-main.min.js",
        "symbol": "rD",
        "start": 1377589,
        "end": 1379750
      }
    ]
  },
  {
    "id": "extraJumps",
    "label": "额外跳跃",
    "kind": "stat",
    "description": "额外跳跃的原生正面提升；负向变化不能命中此优先项。",
    "nativeFields": [
      "player.stats.extraJumps"
    ],
    "sources": [
      {
        "path": "research/update-1.5.1-055-main.min.js",
        "symbol": "rD",
        "start": 1377589,
        "end": 1379750
      }
    ]
  },
  {
    "id": "gold",
    "label": "金币获取倍率",
    "kind": "stat",
    "description": "金币获取倍率的原生正面提升；负向变化不能命中此优先项。",
    "nativeFields": [
      "player.stats.gold"
    ],
    "sources": [
      {
        "path": "research/update-1.5.1-055-main.min.js",
        "symbol": "rD",
        "start": 1377589,
        "end": 1379750
      },
      {
        "path": "research/update-1.5.1-055-runtime-definitions.json",
        "symbol": "vitamins",
        "pointer": "/vitamins/20"
      }
    ]
  },
  {
    "id": "physical",
    "label": "物理伤害",
    "kind": "stat",
    "description": "物理伤害的原生正面提升；负向变化不能命中此优先项。",
    "nativeFields": [
      "player.stats.physical"
    ],
    "sources": [
      {
        "path": "research/update-1.5.1-055-runtime-definitions.json",
        "symbol": "items",
        "pointer": "/items/68"
      }
    ]
  },
  {
    "id": "special",
    "label": "特殊伤害",
    "kind": "stat",
    "description": "特殊伤害的原生正面提升；负向变化不能命中此优先项。",
    "nativeFields": [
      "player.stats.special"
    ],
    "sources": [
      {
        "path": "research/update-1.5.1-055-runtime-definitions.json",
        "symbol": "items",
        "pointer": "/items/69"
      }
    ]
  },
  {
    "id": "thorns",
    "label": "尖刺伤害",
    "kind": "stat",
    "description": "尖刺伤害的原生正面提升；负向变化不能命中此优先项。",
    "nativeFields": [
      "player.stats.thorns"
    ],
    "sources": [
      {
        "path": "research/update-1.5.1-055-runtime-definitions.json",
        "symbol": "items",
        "pointer": "/items/101"
      }
    ]
  },
  {
    "id": "eliteDamage",
    "label": "对精英和首领伤害",
    "kind": "stat",
    "description": "对精英和首领伤害的原生正面提升；负向变化不能命中此优先项。",
    "nativeFields": [
      "player.stats.eliteDamage"
    ],
    "sources": [
      {
        "path": "research/update-1.5.1-055-runtime-definitions.json",
        "symbol": "vitamins",
        "pointer": "/vitamins/23"
      }
    ]
  },
  {
    "id": "vitaminSlots",
    "label": "维生素槽位",
    "kind": "reward",
    "description": "原生契约增加维生素可用槽位；不改变槽位上限或绕过资格。",
    "nativeFields": [
      "player.vitaminSlots"
    ],
    "sources": [
      {
        "path": "research/update-1.5.1-055-main.min.js",
        "symbol": "rD",
        "start": 1377589,
        "end": 1379750
      }
    ]
  },
  {
    "id": "levels",
    "label": "立即提升等级",
    "kind": "reward",
    "description": "月亮契约立即提高3级并增加原生待选强化；不伪造等级。",
    "nativeFields": [
      "player.level",
      "run.pendingLevels"
    ],
    "sources": [
      {
        "path": "research/update-1.5.1-055-main.min.js",
        "symbol": "rD",
        "start": 1377589,
        "end": 1379750
      }
    ]
  },
  {
    "id": "goldImmediate",
    "label": "立即获得金币",
    "kind": "reward",
    "description": "原生立即给予的本局金币，不是账号邦币。",
    "nativeFields": [
      "run.addGold"
    ],
    "sources": [
      {
        "path": "research/update-1.5.1-055-main.min.js",
        "symbol": "rD",
        "start": 1377589,
        "end": 1379750
      },
      {
        "path": "research/update-1.5.1-055-main.min.js",
        "symbol": "HD",
        "start": 1392643,
        "end": 1393775
      }
    ]
  },
  {
    "id": "itemReward",
    "label": "获得道具奖励",
    "kind": "reward",
    "description": "原生明确承诺的道具/道具球奖励；随机结果只按已知最低品质，追加首领奖励仍须真实击败首领。",
    "nativeFields": [
      "run.rollChestItem",
      "tower.arrivalBall",
      "tower.afterClimb",
      "run.roars"
    ],
    "sources": [
      {
        "path": "research/update-1.5.1-055-main.min.js",
        "symbol": "rD",
        "start": 1377589,
        "end": 1379750
      },
      {
        "path": "research/update-1.5.1-055-main.min.js",
        "symbol": "HD",
        "start": 1392643,
        "end": 1393775
      },
      {
        "path": "research/update-1.5.1-055-main.min.js",
        "symbol": "cb",
        "start": 870870,
        "end": 871765
      },
      {
        "path": "research/update-1.5.1-055-main.min.js",
        "symbol": "fb",
        "start": 871897,
        "end": 872954
      },
      {
        "path": "research/update-1.5.1-055-main.min.js",
        "symbol": "World.interact",
        "start": 1279590,
        "end": 1283461
      }
    ]
  },
  {
    "id": "blessingReward",
    "label": "获得祝福奖励",
    "kind": "reward",
    "description": "原生化石祭坛提供的祝福选择奖励；具体属性以随后可见的原生选项为准。",
    "nativeFields": [
      "run.offerBlessing"
    ],
    "sources": [
      {
        "path": "research/update-1.5.1-055-main.min.js",
        "symbol": "cb",
        "start": 870870,
        "end": 871765
      }
    ]
  },
  {
    "id": "companionReward",
    "label": "获得支援伙伴",
    "kind": "reward",
    "description": "原生化石复活化石翼龙支援；是否招募成功仍由原生伙伴选择确认。",
    "nativeFields": [
      "run.allies.recruit"
    ],
    "sources": [
      {
        "path": "research/update-1.5.1-055-main.min.js",
        "symbol": "cb",
        "start": 870870,
        "end": 871765
      }
    ]
  },
  {
    "id": "landingShockwave",
    "label": "获得落地冲击波",
    "kind": "reward",
    "description": "黑色铁球在符合原生落地条件时产生随护甲/等级增强的地面冲击波。",
    "nativeFields": [
      "Player.quake",
      "player.items.iron-ball"
    ],
    "sources": [
      {
        "path": "research/update-1.5.1-055-main.min.js",
        "symbol": "quake",
        "start": 836255,
        "end": 836707
      }
    ]
  }
]);

const reviewedCostDefinitions = {
  "pact": {
    "horde": {
      "cost": true,
      "mods": [],
      "positiveEffects": [
        "itemReward"
      ],
      "rewardScore": 25
    },
    "iron": {
      "cost": true,
      "mods": [],
      "positiveEffects": [
        "itemReward"
      ],
      "rewardScore": 25
    },
    "fury": {
      "cost": true,
      "mods": [
        {
          "stat": "damage",
          "mul": 1.25
        }
      ],
      "positiveEffects": [
        "damage"
      ],
      "rewardScore": 0
    },
    "wind": {
      "cost": true,
      "mods": [
        {
          "stat": "moveSpeed",
          "mul": 1.15
        },
        {
          "stat": "extraJumps",
          "add": 1
        }
      ],
      "positiveEffects": [
        "moveSpeed",
        "extraJumps"
      ],
      "rewardScore": 0
    },
    "elite": {
      "cost": true,
      "mods": [
        {
          "stat": "xpGain",
          "mul": 1.3
        },
        {
          "stat": "luck",
          "add": 20
        }
      ],
      "positiveEffects": [
        "xpGain",
        "luck"
      ],
      "rewardScore": 0
    },
    "moon": {
      "cost": true,
      "mods": [],
      "positiveEffects": [
        "levels"
      ],
      "rewardScore": 25
    },
    "greed": {
      "cost": true,
      "mods": [
        {
          "stat": "gold",
          "mul": 1.3
        }
      ],
      "positiveEffects": [
        "goldImmediate",
        "gold"
      ],
      "rewardScore": 25
    },
    "glass": {
      "cost": true,
      "mods": [
        {
          "stat": "critDamage",
          "mul": 1.4
        },
        {
          "stat": "critChance",
          "add": 0.1
        },
        {
          "stat": "maxHp",
          "mul": 0.8
        }
      ],
      "positiveEffects": [
        "critDamage",
        "critChance"
      ],
      "rewardScore": 0
    },
    "thorn": {
      "cost": true,
      "mods": [
        {
          "stat": "healing",
          "mul": 0.7
        }
      ],
      "positiveEffects": [
        "vitaminSlots"
      ],
      "rewardScore": 25
    }
  },
  "towerPact": {
    "dark": {
      "cost": true,
      "mods": [],
      "positiveEffects": [
        "itemReward"
      ],
      "rewardScore": 25
    },
    "twin": {
      "cost": true,
      "mods": [
        {
          "stat": "xpGain",
          "mul": 1.2
        }
      ],
      "positiveEffects": [
        "xpGain"
      ],
      "rewardScore": 0
    },
    "graves": {
      "cost": true,
      "mods": [],
      "positiveEffects": [
        "goldImmediate"
      ],
      "rewardScore": 25
    },
    "swift": {
      "cost": true,
      "mods": [
        {
          "stat": "moveSpeed",
          "mul": 1.1
        }
      ],
      "positiveEffects": [
        "moveSpeed"
      ],
      "rewardScore": 0
    },
    "iron": {
      "cost": true,
      "mods": [],
      "positiveEffects": [
        "itemReward"
      ],
      "rewardScore": 25
    },
    "hunger": {
      "cost": true,
      "mods": [
        {
          "stat": "damage",
          "mul": 1.2
        }
      ],
      "positiveEffects": [
        "damage"
      ],
      "rewardScore": 0
    }
  },
  "fossil": {
    "helix": {
      "cost": true,
      "mods": [
        {
          "stat": "maxHp",
          "mul": 0.85
        }
      ],
      "positiveEffects": [
        "itemReward"
      ],
      "rewardScore": 35
    },
    "dome": {
      "cost": true,
      "mods": [
        {
          "stat": "maxHp",
          "mul": 0.8
        }
      ],
      "positiveEffects": [
        "blessingReward"
      ],
      "rewardScore": 30
    },
    "amber": {
      "cost": true,
      "mods": [
        {
          "stat": "maxHp",
          "mul": 0.75
        }
      ],
      "positiveEffects": [
        "companionReward"
      ],
      "rewardScore": 25
    }
  },
  "world": {
    "cursed": {
      "cost": true,
      "mods": [
        {
          "stat": "enemyAmount",
          "mul": 1.15
        },
        {
          "stat": "difficulty",
          "mul": 1.1
        }
      ],
      "positiveEffects": [
        "itemReward"
      ],
      "rewardScore": 25
    },
    "cursedchest": {
      "cost": true,
      "mods": [
        {
          "stat": "difficulty",
          "mul": 1.05
        }
      ],
      "positiveEffects": [
        "itemReward"
      ],
      "rewardScore": 25
    },
    "greed": {
      "cost": true,
      "mods": [
        {
          "stat": "xpGain",
          "mul": 1.25
        },
        {
          "stat": "gold",
          "mul": 1.25
        },
        {
          "stat": "difficulty",
          "mul": 1.2
        }
      ],
      "positiveEffects": [
        "xpGain",
        "gold"
      ],
      "rewardScore": 0
    },
    "rhydon": {
      "cost": true,
      "mods": [],
      "positiveEffects": [
        "itemReward"
      ],
      "rewardScore": 25
    }
  },
  "items": {
    "white-flute": {
      "cost": true,
      "mods": [
        {
          "stat": "xpGain",
          "mul": 1.1
        },
        {
          "stat": "luck",
          "add": 5
        },
        {
          "stat": "enemyAmount",
          "mul": 1.12
        }
      ],
      "positiveEffects": [
        "xpGain",
        "luck"
      ],
      "rewardScore": 0
    },
    "life-orb": {
      "cost": true,
      "mods": [
        {
          "stat": "damage",
          "mul": 1.3
        },
        {
          "stat": "maxHp",
          "mul": 0.9
        }
      ],
      "positiveEffects": [
        "damage"
      ],
      "rewardScore": 0
    },
    "choice-band": {
      "cost": true,
      "mods": [
        {
          "stat": "physical",
          "mul": 1.35
        },
        {
          "stat": "attackSpeed",
          "mul": 0.92
        }
      ],
      "positiveEffects": [
        "physical"
      ],
      "rewardScore": 0
    },
    "choice-specs": {
      "cost": true,
      "mods": [
        {
          "stat": "special",
          "mul": 1.35
        },
        {
          "stat": "attackSpeed",
          "mul": 0.92
        }
      ],
      "positiveEffects": [
        "special"
      ],
      "rewardScore": 0
    },
    "macho-brace": {
      "cost": true,
      "mods": [
        {
          "stat": "xpGain",
          "mul": 1.5
        },
        {
          "stat": "moveSpeed",
          "mul": 0.9
        }
      ],
      "positiveEffects": [
        "xpGain"
      ],
      "rewardScore": 0
    },
    "iron-ball": {
      "cost": true,
      "mods": [
        {
          "stat": "armor",
          "add": 8
        },
        {
          "stat": "moveSpeed",
          "mul": 0.93
        }
      ],
      "positiveEffects": [
        "armor",
        "landingShockwave"
      ],
      "rewardScore": 25
    },
    "protector": {
      "cost": true,
      "mods": [
        {
          "stat": "armor",
          "add": 20
        },
        {
          "stat": "maxHp",
          "mul": 1.15
        },
        {
          "stat": "thorns",
          "add": 40
        },
        {
          "stat": "moveSpeed",
          "mul": 0.95
        }
      ],
      "positiveEffects": [
        "armor",
        "maxHp",
        "thorns"
      ],
      "rewardScore": 0
    },
    "rage-candy-bar": {
      "cost": true,
      "mods": [
        {
          "stat": "healing",
          "mul": 0.75
        }
      ],
      "positiveEffects": [
        "damage"
      ],
      "rewardScore": 0
    }
  }
};

// The cost catalog below contains reviewed native benefits only. Enemy amount,
// difficulty and cooldown are inverse stats; a smaller value is never treated
// as a payment merely because its multiplier is below one.
const costInverseStats = new Set(["enemyAmount","difficulty","cooldown","eliteSpawn"]);
const costKnownPaymentStats = new Set(["healing","shieldMax","evasion","lifesteal","pickupRange","projSpeed","jumpHeight"]);
const costEffectMatchesStat = (effect,stat) => effect.kind==="stat"&&
  (effect.id===stat||effect.nativeFields.some(field=>String(field).split('.').at(-1)===stat));
export function costModPolarity(mod) {
  if(!mod||typeof mod.stat!=="string")return 0;
  const known=costEffectCatalog.some(effect=>costEffectMatchesStat(effect,mod.stat))||
    costInverseStats.has(mod.stat)||costKnownPaymentStats.has(mod.stat);
  if(!known)return 0;
  const amount=(typeof mod.add==="number"&&Number.isFinite(mod.add)?mod.add:0)+
    (typeof mod.mul==="number"&&Number.isFinite(mod.mul)?mod.mul-1:0);
  return Math.sign(amount)*(costInverseStats.has(mod.stat)?-1:1);
}
export function costDescriptor(mods=[],extraEffects=[],knownCost=false,rewardScore=0) {
  const nativeMods=Array.isArray(mods)?mods.filter(mod=>mod&&typeof mod.stat==="string"):[],
    positiveMods=nativeMods.filter(mod=>costModPolarity(mod)>0),
    ids=new Set(Array.isArray(extraEffects)?extraEffects:[]);
  for(const mod of positiveMods)for(const effect of costEffectCatalog)
    if(costEffectMatchesStat(effect,mod.stat))ids.add(effect.id);
  const positiveEffects=[...ids].filter(id=>costEffectCatalog.some(effect=>effect.id===id));
  return {cost:knownCost===true||nativeMods.some(mod=>costModPolarity(mod)<0),mods:nativeMods,
    positiveMods,positiveEffects,rewardScore:Math.max(0,Number(rewardScore)||0)};
}
export function costOfferDescriptor(offer={},data={}) {
  const kind=offer?.kind,key=offer?.vit??offer?.id??offer?.key;
  if(["newVit","upVit"].includes(kind)){
    const def=vitaminDefinition(data,key);
    if(!def)return costDescriptor([],[],["cursed","super-lure"].includes(key));
    const multiplier=1,mods=[{stat:def.stat,[def.kind==="add"?"add":"mul"]:
      def.kind==="add"?def.per*multiplier:1+def.per*multiplier},
      ...(def.extra||[]).map(mod=>({stat:mod.stat,mul:1+mod.mul*multiplier}))];
    return costDescriptor(mods);
  }
  if(kind==="item"){
    const def=data.items?.get?.(key)||data.data?.items?.get?.(key),extra=reviewedCostDefinitions.items?.[key];
    // A briefly missing bridge definition cannot turn an audited mixed-cost
    // key into an ordinary harmless item. Its current positive effect remains
    // unproven until the real definition is available again.
    if(!def)return costDescriptor([],[],extra?.cost===true);
    return costDescriptor(def.mods,extra?.positiveEffects,extra?.cost,extra?.rewardScore);
  }
  return costDescriptor(offer?.mods);
}
export function nativeCostDescriptor(kind,key) {
  const row=reviewedCostDefinitions[kind]?.[key];
  return row?costDescriptor(row.mods,row.positiveEffects,row.cost,row.rewardScore):costDescriptor();
}
export function costPriorityRank(descriptor,settings={}) {
  const priorities=Array.isArray(settings.costEffectPriorities)?settings.costEffectPriorities:[];
  for(let index=0;index<Math.min(10,priorities.length);index++)
    if(typeof priorities[index]==="string"&&priorities[index]&&descriptor.positiveEffects.includes(priorities[index]))return index;
  return Infinity;
}
export function costPositiveScore(descriptor,run={}) {
  const p=run.player||{},hp=p.maxHp>0?p.hp/p.maxHp:1;
  return Math.max(.001,scoreMods(descriptor.positiveMods,hp,decisionPlayer(run))+descriptor.rewardScore);
}
export function compareCostChoices(left,right) {
  const l=left?.costRank??Infinity,r=right?.costRank??Infinity;
  return l-r||(Number(right?.score)||0)-(Number(left?.score)||0)||(left?.index??0)-(right?.index??0);
}

export function selectAutomaticCharacter(plan, profile, builds = [], data = {}) {
  const permitted=Array.isArray(plan.characterCandidates)?new Map(plan.characterCandidates
    .filter(row=>Number.isInteger(Number(row?.id))&&Number.isFinite(Number(row.score)))
    .map(row=>[Number(row.id),Number(row.score)])):null,
    league=[...new Set((profile.league||[]).map(Number))].filter(id=>Number.isInteger(id)&&id>0&&(!permitted||permitted.has(id)));
  const rows=retainRecentPublicBuilds(builds),objective=String(plan.objective||''),scoring=plan.mode==='endless'||/survival|endless/.test(objective);
  const candidates=league.map(id=>{
    const matching=rows.filter(row=>row.sourceType==='leaderboard'&&Number(row.species)===id&&row.mode===plan.mode&&
      row.biome===plan.biome&&Number(row.tier)===Number(plan.tier)&&row.hasDetailedBuild===true&&
      (row.victory===true||plan.mode==='endless'&&Number(row.time)>0)).sort((a,b)=>publicBuildObservedAt(b)-publicBuildObservedAt(a));
    const best=matching[0],info=data.get?.(id)||{},stats=info.stats||{},bst=Number(info.bst)||Object.values(stats).reduce((n,v)=>n+(Number(v)||0),0),
      output=Math.max(Number(stats.atk)||0,Number(stats.spa)||0),speed=Number(stats.spe)||0,
      fallback=bst+output*1.5+speed*.35,
      metric=best?(scoring?Number(best.time)||0:/kills/.test(objective)?Number(best.kills)||0:
        Number(best.kills)>0&&Number(best.time)>0?Number(best.kills)/Number(best.time):Number(best.time)||0):0;
    return {id,goalScore:permitted?.get(id)??0,metric,verified:!!best,fallback,build:best?.id||null};
  });
  candidates.sort((a,b)=>b.goalScore-a.goalScore||Number(b.verified)-Number(a.verified)||b.metric-a.metric||b.fallback-a.fallback||a.id-b.id);
  return {species:candidates[0]?.id||Number(plan.species)||Number(profile.starter)||1,
    reason:(permitted?'先按当前原生目标的可用能力与学习条件选择；':'')+
      (candidates[0]?.verified?'比较当前模式地图难度的最新公开有效成绩':'公开成绩不足，按已解锁角色的原生输出与种族能力回退'),candidates};
}

export function chooseSupportReplacement(run, incoming, build = {}, objective = '') {
  const allies=run.allies,list=allies?.list||[],player=decisionPlayer({player:run.player,nativeRun:run,build,objective});
  if(!player.decisionProfile.tank&&!player.decisionProfile.conditionRecovery&&run.player.hp/run.player.maxHp>=.5){
    player.decisionWeights={...player.decisionWeights,regen:(player.decisionWeights.regen??1)*.1,
      healing:(player.decisionWeights.healing??1)*.15};
  }
  const effects=ally=>{
    if(!ally||typeof allies?.mods!=='function')return null;
    try{const view=Object.create(allies);Object.defineProperty(view,'list',{value:[ally]});
      const rows=allies.mods.call(view);return Array.isArray(rows)&&rows.every(row=>typeof row?.stat==='string')?rows:null;
    }catch{return null;}
  };
  const next=effects(incoming);if(!next)return {slot:-1,reason:'unknown-native-support-effect'};
  if(!masteryOfferAllowed({mods:next},{player:run.player,nativeRun:run,build},{}))
    return {slot:-1,reason:'support-effect-conflicts-with-current-native-challenge'};
  const signature=mods=>JSON.stringify(mods.map(mod=>[mod.stat,mod.add??0,mod.mul??1]).sort()),
    hp=run.player.maxHp>0?run.player.hp/run.player.maxHp:1,
    value=mods=>scoreMods(mods,hp,player),nextValue=value(next);
  let best={slot:-1,score:0,reason:'keep-established-companions'};
  for(const [slot,current] of list.entries()){
    if(!!current.shiny!==!!incoming.shiny)continue;const prior=effects(current);if(!prior||signature(prior)===signature(next))continue;
    const old=value(prior),bond=Math.max(0,Number(current.bond)||0),
      growthCost=bond*.35,delta=nextValue-old-growthCost,
      threshold=Math.max(.5,Math.abs(old)*.08);
    if(Number.isFinite(delta)&&delta>threshold&&delta>best.score)
      best={slot,score:delta,reason:'better-native-support-effect-after-growth-cost',previousValue:old,nextValue,growthCost};
  }
  return best;
}

export function configurePlan(base, settings, profile, biomes, builds = []) {
  builds=retainRecentPublicBuilds(builds);
  const plan = { ...base };
  const modes = {
    map: "开新图",
    resources: "刷资源",
    dex: "开图鉴",
    characters: "开角色",
    quests: "做委托",
    leaderboard: "刷排行榜",
    endless: "生存挑战",
  };
  const mode = settings.mode || "auto";
  if (mode !== "auto") {
    plan.priority = modes[mode] || base.priority;
    plan.mode =
      mode === "endless" ||
      (mode === "leaderboard" && ["endless","survival"].includes(settings.leaderboardGoal))
        ? "endless"
        : "standard";
    if (mode !== "quests") plan.metrics = [];
    plan.objective =
      mode === "leaderboard" ? settings.leaderboardGoal || "kills" : mode;
  }
  const available = biomes.filter(
    (v) => v.live !== false && (profile.biomes?.[v.id] ?? -1) >= 0,
  );
  const selectedTier = settings.tier != null && settings.tier !== "auto" ? Number(settings.tier) : null;
  const validFixedTier = selectedTier !== null && Number.isInteger(selectedTier) && selectedTier >= 0 && selectedTier <= 2;
  if (settings.biome && settings.biome !== "auto") {
    if (!available.some((v) => v.id === settings.biome))
      throw Error("所选地图尚未解锁，请选择自动地图或先通关前一张地图");
    plan.biome = settings.biome;
  } else if (!available.some((v) => v.id === plan.biome))
    plan.biome = available[0]?.id || "forest";
  if ((!settings.biome || settings.biome === "auto") && validFixedTier && plan.mode !== "endless" &&
      (profile.biomes?.[plan.biome] ?? -1) < selectedTier) {
    const matchingMap = available.find(map => (profile.biomes?.[map.id] ?? -1) >= selectedTier);
    if (!matchingMap) throw Error("当前已开放地图的所选难度尚未解锁，请选择自动难度；未自动降低难度");
    plan.biome=matchingMap.id;
  }
  if (settings.characterId) {
    if (!profile.league?.includes(Number(settings.characterId)))
      throw Error("所选角色尚未加入联盟，请先解锁或改用自动选择");
    plan.species = Number(settings.characterId);
  }
  if (settings.tier != null && settings.tier !== "auto" && plan.mode !== "endless") {
    if (!Number.isInteger(selectedTier) || selectedTier < 0 || selectedTier > 2)
      throw Error("所选难度无效，请选择自动或游戏已开放的难度");
    if (selectedTier > Math.min(2, Number(profile.biomes?.[plan.biome]) || 0))
      throw Error("所选地图的该难度尚未解锁，请选择自动难度或先通关前一难度；未自动降低难度");
    plan.tier = selectedTier;
  } else if (plan.mode !== "endless") {
    plan.tier = Math.max(0,Math.min(2,Number(plan.tier) || 0,Number(profile.biomes?.[plan.biome]) || 0));
  }
  if (plan.mode === "endless") plan.tier = 0;
  const transferable = (b) => {
    const stats = b.stats || {},
      details = b.moveDetails || [];
    const damage = details.reduce(
      (n, v) => n + Math.max(0, Number(v.dmg) || 0),
      0,
    );
    const baseDamage =
      stats.damage != null &&
      stats.damage <= 1.5 &&
      (stats.attackSpeed || 1) <= 1.5 &&
      Math.max(stats.physical || 1, stats.special || 1) <= 1.5 &&
      (stats.projectiles || 0) <= 1;
    // Public ranked records are not an integrity check. Implausible damage
    // with base stats and saturated/capped records should not drive a fresh
    // account's automatic loadout. An explicit compatible choice is preserved.
    if (details.some((v) => Number(v.dmg) >= 1e12)) return 0;
    if (baseDamage && b.time > 0 && damage / b.time > 10000) return 0;
    const fixedFive = [
      "area",
      "duration",
      "moveSpeed",
      "projSpeed",
      "attackSpeed",
    ].filter((k) => stats[k] === 5).length;
    return fixedFive >= 4 ? 0 : 1;
  };
  const quality = (b) => [
    Number(b.biome === plan.biome && Number(b.tier) === plan.tier),
    Number(b.biome === plan.biome),
    Number(Number(b.tier) === plan.tier),
    transferable(b),
    Number(b.hasDetailedBuild === true),
    Number(b.victory === true || b.mode==='endless'&&Number(b.time)>0),
    Number(b.ranked === true),
    publicBuildObservedAt(b),
    Number(b.bestRecommendation?.selected === true && b.victory === true &&
      Number(b.bestRecommendation.character) === plan.species &&
      b.bestRecommendation.biome === plan.biome && b.biome === plan.biome &&
      Number(b.bestRecommendation.tier) === Number(b.tier)),
    (typeof b.date === "number" ? b.date : Date.parse(b.date)) || 0,
  ];
  const dedicated = builds
    .filter(
      (b) =>
        b.sourceType !== "guide" && Number(b.species) === plan.species && (!b.mode || b.mode === plan.mode) &&
        (b.sourceType!=='leaderboard'||b.hasDetailedBuild!==false) &&
        (plan.mode!=='mutation'||!b.mutationVariant||b.mutationVariant===plan.mutation),
    )
    .sort((a, b) => {
      const aa = quality(a),
        bb = quality(b);
      for (let i = 0; i < aa.length; i++)
        if (aa[i] !== bb[i]) return bb[i] - aa[i];
      return 0;
    });
  const generic =
    builds.find(
      (b) => b.sourceType === "generic" && (!b.mode || b.mode === plan.mode),
    ) || null;
  const selected = builds.find(
    (b) =>
      b.id === settings.build &&
      (!b.mode || b.mode === plan.mode) &&
      (plan.mode!=='mutation'||!b.mutationVariant||b.mutationVariant===plan.mutation) &&
      (Number(b.species) === plan.species || b.sourceType === "generic"),
  );
  plan.build =
    settings.build === "generic"
      ? generic
      : selected || dedicated[0] || generic;
  const custom = resolveCustomPlan(
    settings.customPlans || [],
    {
      species: plan.species,
      biome: plan.biome,
      tier: plan.tier,
      mode: plan.mode,
    },
    settings.build || "auto",
  );
  if (custom) plan.build = custom;
  else if (String(settings.build || "").startsWith("custom-"))
    throw Error(
      "所选自定义方案不适用于当前角色、地图、难度或模式，请更换方案或使用自动匹配",
    );
  return plan;
}

export class MinHeap {
  constructor() {
    this.items = [];
  }
  push(v) {
    const a = this.items;
    a.push(v);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= v.f) break;
      a[i] = a[p];
      i = p;
    }
    a[i] = v;
  }
  pop() {
    const a = this.items;
    if (!a.length) return null;
    const out = a[0],
      last = a.pop();
    if (a.length) {
      let i = 0;
      while (i * 2 + 1 < a.length) {
        let c = i * 2 + 1;
        if (c + 1 < a.length && a[c + 1].f < a[c].f) c++;
        if (a[c].f >= last.f) break;
        a[i] = a[c];
        i = c;
      }
      a[i] = last;
    }
    return out;
  }
}

// A* is expanded in bounded slices so a long route never stalls combat control.
export class GridNavigator {
  constructor(terrain, step = 2, edgeAllowed = null) {
    this.terrain = terrain;
    this.step = step;
    this.edgeAllowed = edgeAllowed;
    this.reset();
  }
  reset() {
    this.open = new MinHeap();
    this.nodes = new Map();
    this.path = [];
    this.done = false;
    this.failed = false;
  }
  key(x, z) {
    return `${x},${z}`;
  }
  begin(start, goal, radius = 2) {
    this.reset();
    this.goal = goal;
    this.radius = radius;
    this.origin = { x: start.x, z: start.z };
    const x = 0,
      z = 0;
    const n = {
      x,
      z,
      g: 0,
      f: distance(start, goal),
      parent: null,
    };
    this.nodes.set(this.key(x, z), n);
    this.open.push(n);
  }
  edge(a, b) {
    const t = this.terrain,
      dx = b.x - a.x,
      dz = b.z - a.z,
      d = Math.hypot(dx, dz);
    if (!t.inBounds(b.x, b.z, 2) || this.edgeAllowed && !this.edgeAllowed(a, b)) return false;
    if (
      t.height &&
      t.height(a.x, a.z) - t.height(b.x, b.z) > 1.5 &&
      !t.walkClear(b.x, b.z, -dx / d, -dz / d, d, 0.65)
    )
      return false;
    return typeof t.height === "function"
      ? nativeFootprintWalkClear(t, a, { x: dx / d, z: dz / d }, d, 0.65)
      : t.walkClear(a.x, a.z, dx / d, dz / d, d, 0.65);
  }
  goalEdge(a) {
    const b = this.goal, terrain = this.terrain;
    if (!this.edge(a, b)) return false;
    if (typeof terrain.height !== "function") return true;
    const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
    if (!(length > 0)) return true;
    // Native walkClear samples every .5m and omits a short remaining tail.
    // Validate its actual endpoint instead of certifying an unchecked ledge.
    const last = Math.max(0, Math.ceil(length / .5) - 1) * .5,
      previous = terrain.height(a.x + dx / length * last, a.z + dz / length * last),
      height = terrain.height(b.x, b.z);
    return Number.isFinite(previous) && Number.isFinite(height) && height <= previous + .6 &&
      !terrain.hitProp?.(b.x, height + .3, b.z, .65 * .8);
  }
  advance(limit = 100) {
    return this.advanceNodes(limit);
  }
  advanceNodes(limit) {
    if (this.done || this.failed || !this.goal) return;
    for (let count = 0; count < limit; count++) {
      const n = this.open.pop();
      if (!n || this.nodes.size > 24000) {
        this.failed = true;
        return;
      }
      if (n.closed) continue;
      n.closed = true;
      const a = {
        x: this.origin.x + n.x * this.step,
        z: this.origin.z + n.z * this.step,
      };
      const remaining = distance(a, this.goal), inside = remaining <= this.radius;
      // A coarse cell near a small interaction target is not arrival. Connect
      // its real endpoint through the same native geometry, or keep searching.
      const connectGoal = !inside && remaining <= this.step * 0.8 && this.goalEdge(a);
      if (inside || connectGoal) {
        const path = [];
        let p = n;
        while (p) {
          path.push({
            x: this.origin.x + p.x * this.step,
            z: this.origin.z + p.z * this.step,
          });
          p = p.parent;
        }
        this.path = path.reverse();
        if (connectGoal) this.path.push({ x: this.goal.x, z: this.goal.z });
        this.done = true;
        return;
      }
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++) {
          if (!dx && !dz) continue;
          const x = n.x + dx,
            z = n.z + dz,
            key = this.key(x, z),
            old = this.nodes.get(key);
          if (old?.closed) continue;
          const b = {
            x: this.origin.x + x * this.step,
            z: this.origin.z + z * this.step,
          };
          if (!this.edge(a, b)) continue;
          const g = n.g + Math.hypot(dx, dz) * this.step;
          if (!old || g < old.g) {
            const v = { x, z, g, f: g + distance(b, this.goal), parent: n };
            this.nodes.set(key, v);
            this.open.push(v);
          }
        }
    }
  }
  waypoint(pos) {
    return this.routeWaypoint(pos);
  }
  routeWaypoint(pos) {
    // Avoid walking back to an old node after combat avoidance or overshooting
    // a corner. Only shortcut verified, nearby forward edges of this path.
    let visible = -1;
    for (let i = 0; i < Math.min(this.path.length, 16); i++) {
      const d = distance(pos, this.path[i]);
      if (d <= 12 && (d < 0.1 || this.edge(pos, this.path[i]))) visible = i;
    }
    if (visible > 0) this.path.splice(0, visible);
    while (this.path.length > 1 && distance(pos, this.path[0]) < 1.5) {
      if (!this.edge(pos, this.path[1])) break;
      this.path.shift();
    }
    return this.path[0] || this.goal;
  }
}
