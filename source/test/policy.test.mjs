import test from "node:test";
import assert from "node:assert/strict";
import { TerrainRecoveryTracker } from "../src/battle-tactics.mjs";
import {
  closestApproach,
  chooseMotion,
  chooseCampaign,
  combatRange,
  waveArrival,
  motionTrajectory,
  projectileApproach,
  ringContact,
  GridNavigator,
  MinHeap,
  ExplorationPlanner,
  configurePlan,
  scoreMods,
  scoreOffer,
} from "../src/policy.mjs";

function patrolRun() {
  return { state: "play", time: 0, stage: 1,
    player: { pos: { x: 0, y: 0, z: 0 }, radius: .55, stats: { moveSpeed: 1, extraJumps: 0 } },
    terrain: { play: 100, height: () => 0, waterAt: () => -1, hitProp: () => false,
      inBounds: (x, z, margin) => Math.abs(x) < 100 - margin && Math.abs(z) < 100 - margin } };
}

test("world patrol holds a far fixed destination and caches its grid despite speed, jump and nearby position changes", () => {
  const planner = new ExplorationPlanner(), run = patrolRun();
  const initial = planner.choose(run, { eligible: true, selected: true }), grid = planner.points;
  let heightReads = 0;
  run.terrain.height = () => { heightReads++; return 0; };
  assert.ok(Math.hypot(initial.x, initial.z) > 30);
  for (let step = 0; step < 20; step++) {
    run.time += .2; run.player.pos.x = Math.sin(step) * .2;
    run.player.stats.moveSpeed = 1 + step; run.player.stats.extraJumps = step;
    const before = heightReads;
    const next = planner.choose(run, { eligible: true, selected: true });
    assert.equal(next.id, initial.id); assert.equal(next.x, initial.x); assert.equal(next.z, initial.z);
    assert.equal(planner.points, grid, "late-game upgrades cannot rebuild player-centred patrol targets");
    assert.ok(heightReads - before <= 3, "a held patrol validates its one endpoint instead of rescanning the world grid each update");
  }
});

test("reaching patrol regions visits new world-space cells instead of regenerating a twenty-metre local circle", () => {
  const planner = new ExplorationPlanner(), run = patrolRun(), ids = new Set();
  for (let step = 0; step < 7; step++) {
    const point = planner.choose(run, { eligible: true, selected: true });
    ids.add(point.id);
    assert.ok(Math.hypot(point.x - run.player.pos.x, point.z - run.player.pos.z) > 30);
    Object.assign(run.player.pos, { x: point.x, z: point.z });
    run.time += 12;
  }
  assert.equal(ids.size, 7); assert.ok(planner.state.visitedCells >= 5);
  assert.ok(planner.revision <= planner.state.visitedCells,
    "returning through an old region is allowed, but cannot be reported as a new area");
});

test("900 seconds of successful fixed-goal revisits preserve both patrol and physical travel budgets", () => {
  const planner = new ExplorationPlanner(), recovery = new TerrainRecoveryTracker(), run = patrolRun();
  // Public tower geometry: layout radius31 -> arenaR30; terrain.play34.
  // The native arena margin is half the requested navigation margin.
  run.terrain.play = 34;
  run.terrain.inBounds = (x, z, margin = 0) => Math.hypot(x, z) < 30 - margin * .5;
  let goal, arrivals = 0, travelled = 0;
  const arrived = new Set();
  for (let frame = 0; frame < 9000; frame++) {
    run.time = frame * .1;
    if (goal) {
      const dx = goal.x - run.player.pos.x, dz = goal.z - run.player.pos.z,
        length = Math.hypot(dx, dz), step = Math.min(.63, length);
      if (length) {
        run.player.pos.x += dx / length * step;
        run.player.pos.z += dz / length * step;
        travelled += step;
      }
      if (Math.hypot(goal.x - run.player.pos.x, goal.z - run.player.pos.z) <= goal.radius) {
        arrivals++; arrived.add(goal.id);
      }
    }
    goal = planner.choose(run, { eligible: true, selected: true });
    recovery.completeGoal?.(run, planner.reachedGoal);
    const physical = recovery.observe(run, { eligible: true, target: goal });
    assert.equal(planner.state.exhausted, false,
      `healthy native-speed travel cannot exhaust after ${arrivals} fixed-goal arrivals at ${run.time}s`);
    assert.equal(physical.exhausted, false,
      `completed visits cannot poison a later legitimate trip to ${goal.id} at ${run.time}s`);
  }
  assert.ok(travelled > 900);
  assert.ok(arrivals >= 25 && arrived.size < arrivals, "successful visits include real revisits, not only new regions");
  assert.ok(planner.revision <= planner.visited.size, "arrival does not invent newly discovered regions");
});

test("arrival publishes a fresh nonexhausted patrol state immediately even when its tile was already credited", () => {
  const planner = new ExplorationPlanner(), run = patrolRun(), goal = planner.choose(run, { eligible: true, selected: true });
  const revision = planner.revision;
  planner.creditedRegions.add(planner.goal.tile);
  planner.activeSeconds = 44.9;
  run.time = .2;
  Object.assign(run.player.pos, { x: goal.x, z: goal.z });
  planner.choose(run, { eligible: true, selected: true });
  assert.equal(planner.revision, revision, "revisiting an old tile is not a new-region credit");
  assert.equal(planner.activeSeconds, 0);
  assert.equal(planner.state.activeSeconds, 0);
  assert.equal(planner.state.exhausted, false, "a macro in this same update must not consume the old exhausted result");
  assert.deepEqual(planner.reachedGoal, { id: goal.id, x: goal.x, z: goal.z, radius: goal.radius, exploration: true });
  planner.choose(run, { eligible: false, selected: false });
  assert.equal(planner.reachedGoal, null, "a later pause/release cannot publish the old completion again");
});

test("changing an unreached patrol goal cannot publish a completed journey", () => {
  const planner = new ExplorationPlanner(), run = patrolRun(), initial = planner.choose(run, { eligible: true, selected: true });
  run.time = 21;
  const alternate = planner.choose(run, { eligible: true, selected: true });
  assert.notEqual(alternate.id, initial.id);
  assert.equal(planner.reachedGoal, null);
});

test("patrol changes a stalled destination finitely while same-patch circles cannot replenish its global travel budget", () => {
  const planner = new ExplorationPlanner(), run = patrolRun(), ids = new Set();
  for (let step = 0; step < 104; step++) {
    run.time = step * .5;
    run.player.pos.x = Math.cos(step) * 2; run.player.pos.z = Math.sin(step) * 2;
    ids.add(planner.choose(run, { eligible: true, selected: true }).id);
  }
  assert.ok(ids.size >= 2); assert.ok(ids.size <= 5);
  assert.equal(planner.state.exhausted, true); assert.ok(planner.state.activeSeconds >= 45);
  assert.equal(planner.state.revision, 1);
});

test("even a large repeated circuit cannot repeatedly claim the same visited regions as new exploration progress", () => {
  const planner = new ExplorationPlanner(), run = patrolRun();
  for (let step = 0; step < 600; step++) {
    run.time = step * .5;
    run.player.pos.x = Math.cos(step * .07) * 35;
    run.player.pos.z = Math.sin(step * .07) * 35;
    planner.choose(run, { eligible: true, selected: true });
  }
  assert.equal(planner.state.exhausted, true);
  assert.ok(planner.revision <= planner.visited.size,
    "a previously credited region cannot refresh the travel budget on each lap");
});

test("important interruptions pause only patrol time and different native run, stage or terrain resets its memory", () => {
  const planner = new ExplorationPlanner(), run = patrolRun();
  Object.defineProperty(run, "account", { get() { throw Error("patrol must not read account identity"); } });
  for (let step = 0; step < 30; step++) { run.time += .5; planner.choose(run, { eligible: true, selected: true }); }
  planner.choose(run, { eligible: false, selected: false });
  const before = planner.state.activeSeconds;
  for (let step = 0; step < 100; step++) { run.time += 1; planner.choose(run, { eligible: false, selected: false }); }
  assert.equal(planner.state.activeSeconds, before);
  assert.equal(planner.state.exhausted, false);
  run.stage++;
  planner.choose(run, { eligible: true, selected: true });
  assert.equal(planner.state.activeSeconds, 0); assert.equal(planner.visited.size, 1);
  const previous = planner.goal; run.terrain = { ...run.terrain };
  planner.choose(run, { eligible: true, selected: true }); assert.notEqual(planner.goal, previous);
});

test("rings keep their hollow center safe instead of becoming solid circles", () => {
  const player = { x: 0, y: 0, z: 0, grounded: true };
  const hazard = {
    shape: "ring",
    x: 0,
    y: 0,
    z: 0,
    radius: 8,
    radialSpeed: 0,
    thickness: 1,
    maxHeight: 1.3,
    life: 2,
    persistent: true,
  };
  const motion = chooseMotion({
    player,
    target: { x: 0, z: 0 },
    hazards: [hazard],
  });
  assert.equal(motion.risk, 0);
  assert.equal(motion.x, 0);
  assert.equal(motion.z, 0);
});

test("continuous ring contact catches a fast front between trajectory samples", () => {
  const path = [
    { x: 10, z: 0, t: 0 },
    { x: 10, z: 0, t: 0.05 },
  ];
  const hazard = { x: 0, z: 0, radius: 1, radialSpeed: 400, thickness: 0.01 };
  const hit = ringContact(path, hazard, {});
  assert.ok(Math.abs(hit - (9 - 0.16) / 400) < 1e-8, hit);
  // A player crossing both edges also cannot tunnel through a static front.
  const crossing = [
    { x: 0, z: 0, t: 0 },
    { x: 20, z: 0, t: 0.05 },
  ];
  assert.ok(
    Number.isFinite(
      ringContact(crossing, { ...hazard, radius: 10, radialSpeed: 0 }, {}),
    ),
  );
});

test("shrinking fire rings stop at their native minimum radius", () => {
  const hazard = {
    x: 0,
    z: 0,
    radius: 9,
    radialSpeed: -9 / 1.6,
    minRadius: 1.2,
    thickness: 1,
    life: 1.6,
  };
  const stationary = (x) => [
    { x, z: 0, t: 0 },
    { x, z: 0, t: 1.6 },
  ];
  assert.equal(ringContact(stationary(0), hazard, {}, 1.6), Infinity);
  // After the clamp, the ring remains dangerous rather than shrinking away.
  const late = [
    { x: 1.5, z: 0, t: 1.5 },
    { x: 1.5, z: 0, t: 1.6 },
  ];
  assert.equal(ringContact(late, hazard, {}, 1.6), 1.5);
  assert.ok(ringContact(stationary(5), hazard, {}, 1.6) > 0);
});

test("ring fronts respect jumping, invulnerability, activation and expiry", () => {
  const path = [
    { x: 5, z: 0, t: 0 },
    { x: 5, z: 0, t: 1.2 },
  ];
  const hazard = {
    x: 0,
    y: 0,
    z: 0,
    radius: 1,
    radialSpeed: 10,
    thickness: 0.2,
    maxHeight: 1.3,
    life: 1.2,
  };
  const grounded = { y: 0, grounded: true };
  assert.ok(Number.isFinite(ringContact(path, hazard, grounded)));
  assert.equal(
    ringContact(path, hazard, { y: 0, height: 0, vy: 10, grounded: false }),
    Infinity,
  );
  assert.equal(
    ringContact(path, hazard, { ...grounded, invulnerableFor: 0.5 }),
    Infinity,
  );
  assert.ok(
    Number.isFinite(
      ringContact(
        path,
        { ...hazard, eta: 0.3 },
        { ...grounded, invulnerableFor: 0.5 },
      ),
    ),
  );
  assert.equal(ringContact(path, { ...hazard, life: 0.3 }, grounded), Infinity);
});

test("continuous collision prediction catches a fast projectile between frames", () => {
  const a = closestApproach(-10, 0, 1000, 0, 0.03);
  assert.ok(Math.abs(a.t - 0.01) < 1e-8);
  assert.ok(a.distance < 1e-8);
});
test("sidesteps an incoming projectile instead of following the target into it", () => {
  const m = chooseMotion({
    player: { x: 0, z: 0, speed: 6.3 },
    target: { x: 20, z: 0 },
    bullets: [{ x: 7, z: 0, vx: -20, vz: 0, radius: 0.5 }],
    walkable: () => true,
  });
  assert.ok(Math.abs(m.z) > 0.5, JSON.stringify(m));
  assert.equal(m.risk, 0);
});
test("escapes a telegraphed area before its impact", () => {
  const m = chooseMotion({
    player: { x: 0, z: 0, speed: 6.3 },
    target: { x: 0, z: 0 },
    hazards: [{ x: 0, z: 0, radius: 2, eta: 0.6 }],
  });
  assert.ok(Math.hypot(m.x, m.z) > 0.9);
  assert.equal(m.risk, 0);
});
test("movement cannot prefer a blocked cliff over a safe alternative", () => {
  const m = chooseMotion({
    player: { x: 0, z: 0 },
    target: { x: 10, z: 0 },
    walkable: (x) => x < 0.4,
  });
  assert.ok(m.x < 0.4);
  assert.equal(m.collision, false);
});

test("a descending player avoids a ledge that is clear only at its current jump height", () => {
  const player = {
      x: 0,
      y: 2,
      z: 0,
      height: 2,
      vy: -3,
      vx: 0,
      vz: 0,
      grounded: false,
      speed: 6.3,
    },
    target = { x: 10, z: 0 },
    samples = [];
  // Native Player.update blocks a 1.6 m ledge above feetY + 0.6.
  // Its near edge begins 1.2 m to the right, reachable during this descent.
  const clearsLedge = (dx, length, feetY) =>
    dx * length < 1.2 || 1.6 <= Math.min(player.y, feetY) + 0.6;
  const stale = chooseMotion({
    player,
    target,
    walkable: (dx, _dz, length) => clearsLedge(dx, length, player.y),
  });
  assert.ok(stale.x > 0.9, JSON.stringify(stale));
  const forecast = chooseMotion({
    player,
    target,
    walkable(dx, _dz, length, time, feetY) {
      samples.push({ time, feetY });
      return clearsLedge(dx, length, feetY);
    },
  });
  assert.equal(forecast.collision, false);
  assert.ok(forecast.x < 0.9, JSON.stringify(forecast));
  assert.ok(samples.some((s) => s.time > 0.25 && s.feetY < 0.5));
  for (const { time, feetY } of samples)
    assert.ok(
      Math.abs(feetY - Math.max(0, 2 - 3 * time - 15 * time ** 2)) < 1e-8,
    );
});

test("a committed slide cannot claim to clear a wall after descending into it", () => {
  const player = {
      x: 0,
      y: 2,
      z: 0,
      height: 2,
      vy: -3,
      vx: 8,
      vz: 0,
      slideT: 0.4,
      grounded: false,
      speed: 6.3,
    },
    walkable = (dx, _dz, length, _time, feetY) =>
      dx * length < 1.2 || 1.6 <= Math.min(player.y, feetY) + 0.6,
    state = { player, target: { x: 10, z: 0 }, walkable };
  assert.equal(
    chooseMotion(state).collision,
    true,
    "all inputs share the same locked slide path into the ledge",
  );
  assert.equal(
    chooseMotion({ ...state, player: { ...player, vy: 8 } }).collision,
    false,
    "the same horizontal slide really can clear that ledge while still rising",
  );
});

test("even overwhelming contact risk cannot make an impossible wall route preferable", () => {
  const m = chooseMotion({
    player: { x: 0, z: 0, speed: 6.3 },
    target: { x: 20, z: 0 },
    enemies: Array.from({ length: 100 }, () => ({ x: -1, z: 0, radius: 1.2 })),
    walkable: (x) => x < -0.9,
    canDash: true,
  });
  assert.ok(m.risk > 100000, JSON.stringify(m));
  assert.equal(m.collision, false);
  assert.ok(m.x <= 0, JSON.stringify(m));
});
test("stays still after reaching a safe pickup or altar", () => {
  const m = chooseMotion({ player: { x: 1, z: 1 }, target: { x: 1, z: 1 } });
  assert.deepEqual([m.x, m.z], [0, 0]);
});
test("uses slide only when its predicted trajectory improves safety", () => {
  const state = {
    player: { x: 0, z: 0, speed: 6.3 },
    target: { x: 0, z: 0 },
    hazards: [{ x: 0, z: 0, radius: 4, eta: 0.6 }],
    canDash: true,
  };
  assert.equal(chooseMotion(state).dash, true);
  assert.equal(chooseMotion({ ...state, walkable: () => false }).dash, false);
  // A slide loses speed during its locked animation; it cannot clear this large
  // impact even though a fictitious constant 1.6x-speed path would clear it.
  assert.ok(chooseMotion(state).risk > 100);
});

test("slide prediction preserves its locked direction and decaying velocity", () => {
  const path = motionTrajectory(
    { x: 0, z: 0, speed: 6.3, vx: 9, vz: 0, grounded: true, slideT: 0.4 },
    { x: -1, z: 0 },
    false,
    0.4,
  );
  const end = path.at(-1);
  assert.ok(end.x > 2.3 && end.x < 2.5, JSON.stringify(end));
  assert.equal(end.z, 0);
  const dash = motionTrajectory(
    { x: 0, z: 0, speed: 6.3 },
    { x: 1, z: 0 },
    true,
    0.6,
  );
  assert.ok(dash.at(-1).x < 4.2, JSON.stringify(dash.at(-1)));
});

test("airborne movement cannot brake or reverse existing momentum instantly", () => {
  const player = {
      x: 0,
      z: 0,
      speed: 6.3,
      vx: 6.3,
      vz: 0,
      grounded: false,
      height: 2,
      vy: 0,
    },
    reverse = motionTrajectory(player, { x: -1, z: 0 }, false, 0.1),
    release = motionTrajectory(player, { x: 0, z: 0 }, false, 0.1);
  assert.ok(reverse.at(-1).x > 0.45);
  assert.ok(release.at(-1).x > 0.62);
});

test("escapes existing body overlap instead of stopping on the nearest-distance tie", () => {
  const m = chooseMotion({
    player: { x: 0, z: 0, speed: 6.3 },
    target: { x: 10, z: 0 },
    enemies: [{ x: 1, z: 0, radius: 1.2 }],
  });
  assert.ok(m.x < -0.4, JSON.stringify(m));
});

test("native knockback contributes decaying displacement separately from the requested velocity", () => {
  const player = {
      x: 0,
      z: 0,
      speed: 6.3,
      vx: 0,
      vz: 0,
      grounded: true,
      kx: 12,
      kz: -6,
      frameDt: 1 / 60,
    },
    path = motionTrajectory(player, { x: 0, z: 0 }, false, 0.5),
    first = path[1],
    end = path.at(-1);
  assert.ok(Math.abs(first.t - 1 / 60) < 1e-8);
  assert.ok(Math.abs(first.x - (12 * Math.exp(-0.15)) / 60) < 1e-8);
  // Independently step the native 60 Hz force ordering for 30 frames.
  let kx = 12,
    kz = -6,
    x = 0,
    z = 0;
  for (let frame = 0; frame < 30; frame++) {
    kx *= Math.exp(-9 / 60);
    kz *= Math.exp(-9 / 60);
    x += kx / 60;
    z += kz / 60;
  }
  assert.ok(Math.abs(end.x - x) < 1e-8);
  assert.ok(Math.abs(end.z - z) < 1e-8);
  assert.ok(end.x < 1.3, JSON.stringify(end));
  const reverse = motionTrajectory(player, { x: -1, z: 0 }, false, 0.5);
  assert.ok(
    reverse[1].x > 0,
    "reversing input cannot erase the pending impulse instantly",
  );
  assert.ok(reverse.at(-1).x < end.x);
});

test("crowd push is capped as a one-frame displacement and anchor resistance precedes the cap", () => {
  const player = {
      x: 0,
      z: 0,
      grounded: true,
      vx: 0,
      vz: 0,
      crowdX: 1,
      crowdZ: 0,
      frameDt: 1 / 60,
    },
    path = motionTrajectory(player, { x: 0, z: 0 }, false, 0.5);
  assert.ok(Math.abs(path[1].x - 5.5 / 60) < 1e-8);
  assert.ok(
    Math.abs(path.at(-1).x - path[1].x) < 1e-8,
    "a consumed crowd push is not added every future frame",
  );
  const anchored = motionTrajectory(
    { ...player, crowdX: 0.12, anchorT: 0.2 },
    { x: 0, z: 0 },
    false,
    0.5,
  );
  assert.ok(Math.abs(anchored.at(-1).x - 0.12 * 0.35) < 1e-8);
  const expired = motionTrajectory(
    { ...player, crowdX: 0.12, anchorT: 0.01 },
    { x: 0, z: 0 },
    false,
    0.5,
  );
  assert.ok(
    Math.abs(expired.at(-1).x - 5.5 / 60) < 1e-8,
    "an anchor expiring before movement no longer resists the push",
  );
});

test("sustained boss gusts inject after movement and stop at their native lifetime", () => {
  const player = {
      x: 0,
      z: 0,
      grounded: true,
      vx: 0,
      vz: 0,
      kx: 0.5,
      kz: -0.25,
      forceX: 30,
      forceZ: -15,
      forceFor: 0.2,
      frameDt: 1 / 60,
    },
    path = motionTrajectory(player, { x: 0, z: 0 }, false, 1.2);
  assert.ok(
    Math.abs(path[1].x - (0.5 * Math.exp(-0.15)) / 60) < 1e-8,
    "the upcoming gust injection cannot displace the player before that frame's movement",
  );
  let kx = 0.5,
    kz = -0.25,
    x = 0,
    z = 0;
  for (let frame = 0; frame < 72; frame++) {
    kx *= Math.exp(-9 / 60);
    kz *= Math.exp(-9 / 60);
    x += kx / 60;
    z += kz / 60;
    if (frame < 12) {
      kx += 30 / 60;
      kz -= 15 / 60;
    }
  }
  assert.ok(Math.abs(path.at(-1).x - x) < 1e-8);
  assert.ok(Math.abs(path.at(-1).z - z) < 1e-8);
  const steady = motionTrajectory(
    { ...player, forceFor: 1.2 },
    { x: 0, z: 0 },
  ).at(-1);
  assert.ok(steady.x > 3, JSON.stringify(steady));
  const noForce = { ...player, forceFor: 0 };
  assert.deepEqual(
    motionTrajectory(noForce, { x: 0, z: 0 }),
    motionTrajectory({ ...noForce, forceX: 0, forceZ: 0 }, { x: 0, z: 0 }),
  );
});

test("native invulnerability allows leaving current body overlap but retains threats after expiry", () => {
  const player = { x: 0, z: 0, speed: 6.3, invulnerableFor: 0.45 },
    escape = chooseMotion({
      player,
      target: { x: 20, z: 0 },
      enemies: [{ x: 0.7, z: 0, radius: 0.7 }],
    });
  assert.ok(escape.x > 0.9, JSON.stringify(escape));
  assert.equal(escape.risk, 0);
  const future = chooseMotion({
    player,
    target: { x: 20, z: 0 },
    enemies: [{ x: 4.5, z: 0, radius: 0.7 }],
  });
  assert.ok(Math.abs(future.z) > 0.3, JSON.stringify(future));
  assert.equal(future.risk, 0);
  const wall = chooseMotion({
    player,
    target: { x: 20, z: 0 },
    enemies: [{ x: 0.7, z: 0, radius: 0.7 }],
    walkable: (x) => x < 0.4,
  });
  assert.equal(wall.collision, false);
  assert.ok(wall.x < 0.4, JSON.stringify(wall));
});

test("does not cross an active beam between its current and future endpoints", () => {
  const state = {
    player: { x: 0, z: 0, speed: 6.3 },
    target: { x: 20, z: 0 },
    hazards: [{ x: 2, z: -20, x2: 2, z2: 20, radius: 0.15, eta: 0 }],
  };
  const m = chooseMotion(state);
  assert.ok(m.x < 0.15, JSON.stringify(m));
  assert.equal(m.risk, 0);
  // An announced strike is assessed at impact, so an early crossing is allowed.
  const before = chooseMotion({
    ...state,
    hazards: [{ ...state.hazards[0], eta: 1 }],
  });
  assert.ok(before.x > 0.9, JSON.stringify(before));
});

test("native body contact retains the enemy's old position as immunity ends this frame", () => {
  const player = {
      x: 0,
      z: 0,
      speed: 6.3,
      invulnerableFor: 0.01,
      frameDt: 1 / 60,
    },
    enemy = { x: 1.3, z: 0, radius: 0.7, vx: 50, vz: 0 },
    state = { player, target: { x: 0, z: 0 }, enemies: [enemy] },
    simultaneous = chooseMotion(state),
    native = chooseMotion({
      ...state,
      enemies: [{ ...enemy, frameLag: 1 / 60 }],
    });
  assert.equal(simultaneous.risk, 0);
  assert.ok(native.risk > 100, JSON.stringify(native));
  assert.ok(native.x < -0.4, JSON.stringify(native));
  assert.deepEqual(
    chooseMotion({ ...state, enemies: [{ ...enemy, frameLag: 0 }] }),
    simultaneous,
  );
  // Protection through the next frame still permits walking out of that body.
  assert.equal(
    chooseMotion({
      ...state,
      player: { ...player, invulnerableFor: 0.1 },
      enemies: [{ ...enemy, frameLag: 1 / 60 }],
    }).risk,
    0,
  );
});

test("hostile homing shots can bend into a path that is safe for a straight shot", () => {
  const player = { x: 0, y: 0, z: 0, speed: 6.3, grounded: true },
    path = motionTrajectory(player, { x: 1, z: 0 }),
    shot = {
      x: -4,
      y: 0.8,
      z: -4,
      vx: 12,
      vy: 0,
      vz: 0,
      speed: 12,
      life: 2,
      flags: 1,
    };
  assert.ok(projectileApproach(path, shot, player).distance > 3.9);
  assert.ok(
    projectileApproach(path, { ...shot, flags: 3 }, player).distance < 0.9,
  );
  assert.deepEqual(
    projectileApproach(path, { ...shot, flags: 2 }, player),
    projectileApproach(path, shot, player),
  );
  const straight = chooseMotion({
      player,
      target: { x: 20, z: 0 },
      bullets: [shot],
    }),
    homing = chooseMotion({
      player,
      target: { x: 20, z: 0 },
      bullets: [{ ...shot, flags: 3 }],
    });
  assert.equal(straight.z, 0);
  assert.ok(homing.z > 0.2, JSON.stringify(homing));
  assert.equal(homing.risk, 0);
});

test("projectile collision uses the vertical overlap window rather than only the horizontal minimum", () => {
  const player = { x: 0, y: 0, z: 0, speed: 6.3 },
    path = motionTrajectory(player, { x: 0, z: 0 }),
    falling = { x: -2, y: 5, z: 0, vx: 10, vy: -10, vz: 0, flags: 1 };
  const near = projectileApproach(path, falling, player);
  assert.ok(Math.abs(near.t - 0.24) < 1e-8, JSON.stringify(near));
  assert.ok(near.distance < 0.5);
  assert.equal(
    projectileApproach(path, { ...falling, y: 10, vy: 0 }, player).distance,
    Infinity,
  );
});

test("projectiles are ignored only during the remaining native invulnerability window", () => {
  const player = { x: 0, y: 0, z: 0, speed: 6.3, invulnerableFor: 0.45 },
    path = motionTrajectory(player, { x: 0, z: 0 }),
    shot = { x: 3, y: 0.8, z: 0, vx: -20, vy: 0, vz: 0, flags: 1 };
  assert.ok(projectileApproach(path, shot, player).distance >= 5.9);
  assert.ok(
    projectileApproach(path, { ...shot, x: 12 }, player).distance < 0.01,
  );
  assert.equal(
    projectileApproach(path, { ...shot, life: 0.3 }, player).distance,
    Infinity,
  );
});

test("ongoing pools remain dangerous after invulnerability expires while exhausted beams do not", () => {
  const pool = { x: 2, z: 0, radius: 1.5, persistent: true, eta: 0, life: 2 },
    player = { x: 0, z: 0, speed: 6.3, invulnerableFor: 0.45 },
    target = { x: 20, z: 0 },
    exposed = chooseMotion({ player, target, hazards: [pool] });
  assert.ok(Math.abs(exposed.z) > 0.3, JSON.stringify(exposed));
  const delayedPool = chooseMotion({
    player,
    target,
    hazards: [{ ...pool, eta: 0.2 }],
  });
  assert.ok(Math.abs(delayedPool.z) > 0.3, JSON.stringify(delayedPool));
  const protectedExit = chooseMotion({
    player: { ...player, invulnerableFor: 0.8 },
    target,
    hazards: [pool],
  });
  assert.ok(protectedExit.x > 0.9, JSON.stringify(protectedExit));
  assert.equal(protectedExit.risk, 0);
  const beam = {
      x: 3.5,
      z: -20,
      x2: 3.5,
      z2: 20,
      radius: 0.15,
      eta: 0,
      life: 0.3,
    },
    exhausted = chooseMotion({ player, target, hazards: [beam] }),
    stillActive = chooseMotion({
      player,
      target,
      hazards: [{ ...beam, life: 1 }],
    });
  assert.ok(exhausted.x > 0.9, JSON.stringify(exhausted));
  assert.equal(exhausted.risk, 0);
  assert.ok(stillActive.x < 0.9, JSON.stringify(stillActive));
});

test("one-shot telegraphs use invulnerability at impact rather than throughout their visual lifetime", () => {
  const player = { x: 0, z: 0, speed: 6.3, invulnerableFor: 0.45 },
    target = { x: 20, z: 0 },
    circle = { x: 2, z: 0, radius: 2, eta: 0.2 },
    protectedImpact = chooseMotion({ player, target, hazards: [circle] }),
    laterImpact = chooseMotion({
      player,
      target,
      hazards: [{ ...circle, x: 3.8, eta: 0.6 }],
    });
  assert.ok(protectedImpact.x > 0.9, JSON.stringify(protectedImpact));
  assert.equal(protectedImpact.risk, 0);
  assert.ok(laterImpact.x < 0.9, JSON.stringify(laterImpact));
});

test("a native timer expiring this frame strikes before any requested slide movement", () => {
  const player = {
      x: 1.5,
      z: 0,
      speed: 6.3,
      vx: 11.97,
      vz: 0,
      grounded: true,
      slideT: 0.4,
      frameDt: 1 / 60,
    },
    line = { x: 0, z: -20, x2: 0, z2: 20, radius: 1, eta: 0.01, oneShot: true },
    now = chooseMotion({ player, target: { x: 20, z: 0 }, hazards: [line] });
  // Native lineStrike hits inside radius + player.radius. This player is still
  // inside when run.later fires; Player.update has not advanced the slide yet.
  assert.ok(player.x < line.radius + 0.55);
  assert.ok(now.risk > 100, JSON.stringify(now));
  const later = chooseMotion({
    player,
    target: { x: 20, z: 0 },
    hazards: [{ ...line, eta: 0.1 }],
  });
  assert.equal(later.risk, 0);
});

test("a fast slide cannot escape a circle before the upcoming timer callback", () => {
  const player = {
      x: 3.59,
      z: 0,
      speed: 12.6,
      vx: 23.94,
      vz: 0,
      grounded: true,
      slideT: 0.4,
      frameDt: 1 / 60,
    },
    circle = { x: 0, z: 0, radius: 3.6, eta: 0.01, oneShot: true },
    motion = chooseMotion({
      player,
      target: { x: 20, z: 0 },
      hazards: [circle],
    });
  assert.ok(player.x < circle.radius);
  assert.ok(motion.risk > 100, JSON.stringify(motion));
});

test("timer callbacks also precede this frame's invulnerability countdown", () => {
  const player = {
      x: 0,
      z: 0,
      speed: 6.3,
      grounded: true,
      frameDt: 1 / 60,
      invulnerableFor: 0.01,
    },
    circle = { x: 0, z: 0, radius: 4, eta: 0.015, oneShot: true },
    beforeUpdate = chooseMotion({
      player,
      target: { x: 0, z: 0 },
      hazards: [circle],
    }),
    laterFrame = chooseMotion({
      player,
      target: { x: 0, z: 0 },
      hazards: [{ ...circle, eta: 0.04 }],
    });
  assert.equal(beforeUpdate.risk, 0);
  assert.ok(laterFrame.risk > 100, JSON.stringify(laterFrame));
});

test("expired one-shot circles and lines do not turn their visual remnants into persistent damage", () => {
  const player = { x: 0, z: 0, speed: 6.3 },
    target = { x: 0, z: 0 },
    circle = { x: 0, z: 0, radius: 1, eta: -0.1, life: 0.3, oneShot: true },
    line = { ...circle, x: -20, x2: 20, z2: 0 };
  for (const hazard of [circle, line]) {
    const motion = chooseMotion({ player, target, hazards: [hazard] });
    assert.equal(motion.risk, 0);
    assert.deepEqual([motion.x, motion.z], [0, 0]);
  }
  const pool = chooseMotion({
    player,
    target,
    hazards: [{ ...circle, oneShot: false, persistent: true }],
  });
  assert.ok(Math.hypot(pool.x, pool.z) > 0.9);
  const previewBeam = chooseMotion({
    player,
    target,
    hazards: [{ ...line, oneShot: false }],
  });
  assert.ok(previewBeam.risk > 100);
});

test("an imminent map-wide attack sends the player behind cover instead of toward a pickup", () => {
  const player = { x: 0, y: 0, z: 0, speed: 6.3 },
    cover = { eta: 0.6, isHidden: (x) => x < -2 },
    motion = chooseMotion({ player, target: { x: 20, z: 0 }, cover });
  assert.ok(motion.x < -0.5, JSON.stringify(motion));
  assert.equal(motion.risk, 0);
});

test("stays in existing cover rather than leaving to collect a safe-looking pickup", () => {
  const player = { x: 0, y: 0, z: 0, speed: 6.3 },
    cover = { eta: 0.6, isHidden: (x, y, z) => Math.hypot(x, z) < 0.8 },
    motion = chooseMotion({ player, target: { x: 20, z: 0 }, cover });
  assert.deepEqual([motion.x, motion.z], [0, 0]);
  assert.equal(motion.risk, 0);
});

test("cover takes priority over a single contact threat while walls remain physically impossible", () => {
  const player = { x: 0, y: 0, z: 0, speed: 6.3 },
    cover = { eta: 0.35, isHidden: (x, y, z) => Math.hypot(x + 2.1, z) < 0.2 },
    state = {
      player,
      target: { x: 20, z: 0 },
      cover,
      enemies: [{ x: -1, z: 0, radius: 0.7 }],
    },
    protectedPath = chooseMotion(state);
  assert.ok(protectedPath.x < -0.9, JSON.stringify(protectedPath));
  assert.ok(protectedPath.risk > 100 && protectedPath.risk < 500000);
  const wall = chooseMotion({ ...state, walkable: (x) => x > -0.9 });
  assert.equal(wall.collision, false);
  assert.ok(wall.risk >= 500000);
});

test("cover checks future player height and the native callback's position before movement", () => {
  const falling = {
      x: 0,
      y: 3,
      z: 0,
      speed: 6.3,
      vx: 0,
      vz: 0,
      grounded: false,
      height: 3,
      vy: -6,
      frameDt: 1 / 60,
    },
    heights = [],
    cover = {
      eta: 0.25,
      isHidden: (x, y) => {
        heights.push(y);
        return y < 1;
      },
    },
    landing = chooseMotion({ player: falling, target: { x: 20, z: 0 }, cover });
  assert.equal(landing.risk, 0);
  assert.ok(heights.length >= 25 && heights.every((y) => y > 0.7 && y < 0.9));
  const sliding = {
      x: 1.5,
      y: 0,
      z: 0,
      speed: 6.3,
      vx: 11.97,
      vz: 0,
      grounded: true,
      slideT: 0.4,
      frameDt: 1 / 60,
    },
    immediate = chooseMotion({
      player: sliding,
      target: { x: 20, z: 0 },
      cover: { eta: 0.01, isHidden: (x) => x < 1.6 },
    });
  assert.equal(immediate.risk, 0);
  const normal = chooseMotion({ player: sliding, target: { x: 20, z: 0 } }),
    expired = chooseMotion({
      player: sliding,
      target: { x: 20, z: 0 },
      cover: { eta: -0.01, isHidden: () => false },
    });
  assert.deepEqual(expired, normal);
});

test("explicit hazard height permits a safe jump but still avoids the pool before landing", () => {
  const pool = {
      x: 2,
      y: 0,
      z: 0,
      radius: 2,
      persistent: true,
      maxHeight: 1,
      eta: 0,
    },
    airborne = {
      x: 0,
      y: 6,
      z: 0,
      speed: 6.3,
      vx: 6.3,
      vz: 0,
      grounded: false,
      height: 6,
      vy: 5,
    };
  const high = chooseMotion({
    player: airborne,
    target: { x: 10, z: 0 },
    hazards: [pool],
  });
  const clear = chooseMotion({ player: airborne, target: { x: 10, z: 0 } });
  assert.equal(high.risk, 0);
  assert.ok(high.escapeRoutes > 0, "an airborne-safe path retains a safe route after its upcoming landing");
  const sustainedJump = { ...airborne, vy: 20 };
  const above = chooseMotion({ player: sustainedJump, target: { x: 10, z: 0 }, hazards: [pool] });
  const aboveClear = chooseMotion({ player: sustainedJump, target: { x: 10, z: 0 } });
  assert.deepEqual([above.x, above.z], [aboveClear.x, aboveClear.z]);
  const landing = chooseMotion({
    player: { ...airborne, y: 1.5, height: 1.5, vy: -3 },
    target: { x: 10, z: 0 },
    hazards: [pool],
  });
  assert.ok(
    landing.risk > 0 || Math.abs(landing.z) > 0.4,
    JSON.stringify(landing),
  );
  const impact = chooseMotion({
    player: airborne,
    target: { x: 0, z: 0 },
    hazards: [
      { ...pool, persistent: false, radius: 5, eta: 0.2, maxHeight: 2.2 },
    ],
  });
  assert.equal(impact.risk, 0);
});
test("campaign honours map, tasks, dex, resource order", () => {
  const maps = [
    { id: "forest" },
    { id: "desert" },
    { id: "future", live: false },
  ];
  const p = { league: [1, 4], biomes: { forest: 0 }, seen: [] };
  const tasks = [{ metric: "burned", goal: 10, progress: 0 }];
  assert.equal(chooseCampaign(p, maps, tasks).priority, "开新图");
  p.biomes = { forest: 1, desert: 1 };
  const taskPlan = chooseCampaign(p, maps, tasks, (id) => ({
    types: [id === 4 ? "fire" : "grass"],
  }));
  assert.equal(taskPlan.priority, "做委托");
  assert.equal(taskPlan.species, 4);
  assert.equal(chooseCampaign(p, maps, []).priority, "开图鉴");
  p.seen = Array.from({ length: 151 }, (_, i) => i + 1);
  assert.equal(chooseCampaign(p, maps, []).priority, "开图鉴");
  p.league = Array.from({ length: 79 }, (_, i) => i + 1);
  assert.equal(chooseCampaign(p, maps, []).priority, "刷资源");
});
test("a ranged build kites using its effective range rather than its shortest move", () => {
  assert.equal(combatRange([{ arch: "melee", area: 3.3 }]), 2.7);
  assert.equal(
    combatRange([
      { arch: "melee", area: 3.3 },
      { arch: "barrage", speed: 30, dur: 0.6 },
    ]),
    11,
  );
  assert.equal(combatRange([{ arch: "beam" }], 3), 10);
  assert.equal(combatRange([{ arch: "drain", speed: 20, dur: 1.5 }]), 11);
});
test("shockwave timing accounts for radial movement and the actual expanding ring", () => {
  const wave = { x: 0, z: 0, r: 5 };
  assert.ok(Math.abs(waveArrival({ x: 10, z: 0 }, wave) - 4.4 / 13) < 1e-8);
  assert.ok(
    waveArrival({ x: 10, z: 0, vx: 6, vz: 0 }, wave) >
      waveArrival({ x: 10, z: 0, vx: -6, vz: 0 }, wave),
  );
  const crossing = waveArrival({ x: 10, z: 0, vx: 0, vz: 8 }, wave);
  assert.ok(crossing > 4.4 / 13);
  assert.ok(
    Math.abs(Math.hypot(10, 8 * crossing) - (5.6 + 13 * crossing)) < 1e-8,
  );
  assert.equal(waveArrival({ x: 30, z: 0 }, { ...wave, max: 26 }), Infinity);
  assert.equal(waveArrival({ x: 10, z: 0, vx: 15, vz: 0 }, wave), Infinity);
});

test("shockwave arrival follows committed slide deceleration instead of its requested turn", () => {
  const player = {
      x: 10,
      z: 0,
      speed: 6.3,
      vx: 11.97,
      vz: 0,
      grounded: true,
      slideT: 0.5,
    },
    trajectory = motionTrajectory(player, { x: -1, z: 0 }),
    wave = { x: 0, z: 0, r: 5, max: 26 },
    actual = waveArrival({ ...player, trajectory }, wave),
    instantTurn = waveArrival({ x: 10, z: 0, vx: -6.3, vz: 0 }, wave);
  assert.ok(actual > 0.5 && actual < 0.65, String(actual));
  assert.ok(actual > instantTurn + 0.25);
  const a = trajectory.findLast((point) => point.t < actual),
    b = trajectory.find((point) => point.t >= actual),
    fraction = (actual - a.t) / (b.t - a.t),
    x = a.x + (b.x - a.x) * fraction,
    z = a.z + (b.z - a.z) * fraction;
  assert.ok(Math.abs(Math.hypot(x, z) - (5.6 + 13 * actual)) < 1e-8);
  assert.equal(
    waveArrival({ ...player, trajectory }, { ...wave, max: 10 }),
    Infinity,
  );
});

test("travelling wave and vortex attacks kite at their real projectile range", () => {
  assert.equal(
    combatRange([{ arch: "wave", speed: 30, dur: 0.6, area: 2 }]),
    11,
  );
  assert.equal(
    combatRange([{ arch: "vortex", speed: 10, dur: 1.5, area: 2 }]),
    9.75,
  );
  assert.equal(combatRange([{ arch: "chain", area: 2 }]), 10);
  assert.equal(combatRange([{ arch: "lob", area: 2 }]), 10);
  assert.ok(Number.isFinite(combatRange([{ arch: "bolt" }])));
  assert.equal(
    combatRange([{ def: { arch: "aura", area: 4 }, mods: { area: 1.5 } }], 0, {
      area: 1.5,
    }),
    6.3,
  );
});
test("persistent damaging pools are avoided before entering their area", () => {
  const m = chooseMotion({
    player: { x: 0, z: 0 },
    target: { x: 10, z: 0 },
    hazards: [{ x: 4, z: 0, radius: 1.5, persistent: true, life: 2, eta: 0 }],
  });
  assert.ok(Math.abs(m.z) > 0.5, JSON.stringify(m));
});

test("leaves a persistent fissure sideways instead of running along its damaging center", () => {
  const m = chooseMotion({
    player: { x: 0, y: 0, z: 0, speed: 6.3, grounded: true },
    target: { x: 20, z: 0 },
    hazards: [
      {
        x: -20,
        y: 0,
        z: 0,
        x2: 20,
        z2: 0,
        radius: 1,
        eta: 0,
        persistent: true,
        maxHeight: 0.6,
      },
    ],
  });
  assert.ok(Math.abs(m.z) > 0.5, JSON.stringify(m));
  assert.equal(m.risk, 0);
});
test("A* finds a gap around a wall while processing bounded work slices", () => {
  const terrain = {
    inBounds: (x, z) => Math.abs(x) < 15 && Math.abs(z) < 15,
    walkClear: (x, z, dx, dz, d) => {
      for (let t = 0; t <= d; t += 0.2)
        if (Math.abs(x + dx * t - 4) < 0.6 && Math.abs(z + dz * t) < 4)
          return false;
      return true;
    },
  };
  const nav = new GridNavigator(terrain);
  nav.begin({ x: 0, z: 0 }, { x: 10, z: 0 }, 1);
  let steps = 0;
  while (!nav.done && !nav.failed && steps++ < 1000) nav.advance(10);
  assert.ok(nav.done);
  assert.ok(nav.path.some((p) => Math.abs(p.z) >= 4));
  assert.ok(nav.path.every((p, i, a) => i === 0 || nav.edge(a[i - 1], p)));
});
test("heap retains priority under insertion and removal", () => {
  const h = new MinHeap();
  for (const f of [9, 2, 1, 6, 0, 20, 3]) h.push({ f });
  assert.deepEqual(
    Array.from({ length: 7 }, () => h.pop().f),
    [0, 1, 2, 3, 6, 9, 20],
  );
});
test("navigation starts at the real position rather than rounding into a cliff", () => {
  const start = { x: 1.1, z: 0.7 },
    goal = { x: 8.2, z: 0.7 };
  const terrain = {
    inBounds: (x, z) => Math.abs(x) < 15 && Math.abs(z) < 15,
    walkClear: (x, z, dx, dz, d) => {
      for (let t = 0; t <= d; t += 0.1)
        if (x + dx * t > 1.5 && x + dx * t < 2.5 && Math.abs(z + dz * t) < 4)
          return false;
      return true;
    },
  };
  const nav = new GridNavigator(terrain);
  nav.begin(start, goal, 1);
  for (let i = 0; i < 100 && !nav.done && !nav.failed; i++) nav.advance(50);
  assert.ok(nav.done);
  assert.deepEqual(nav.path[0], start);
  assert.ok(nav.path.every((p, i, a) => !i || nav.edge(a[i - 1], p)));
});

const planFixture = () => ({
  base: {
    priority: "开新图",
    species: 1,
    biome: "forest",
    tier: 0,
    mode: "standard",
    metrics: ["burned"],
  },
  profile: { league: [1, 4], biomes: { forest: 1 } },
  biomes: [
    { id: "forest", live: true },
    { id: "desert", live: true },
    { id: "future", live: false },
  ],
});

test("configured modes preserve the automatic plan or select the requested run objective", () => {
  const { base, profile, biomes } = planFixture();
  const modes = {
    auto: ["开新图", "standard"],
    map: ["开新图", "standard"],
    resources: ["刷资源", "standard"],
    dex: ["开图鉴", "standard"],
    characters: ["开角色", "standard"],
    quests: ["做委托", "standard"],
    leaderboard: ["刷排行榜", "standard"],
    endless: ["生存挑战", "endless"],
  };
  for (const [mode, [priority, gameMode]] of Object.entries(modes)) {
    const result = configurePlan(base, { mode }, profile, biomes);
    assert.equal(result.priority, priority, mode);
    assert.equal(result.mode, gameMode, mode);
    assert.deepEqual(
      result.metrics,
      mode === "auto" || mode === "quests" ? ["burned"] : [],
      mode,
    );
  }
  const survivalBoard = configurePlan(
    base,
    { mode: "leaderboard", leaderboardGoal: "endless", tier: 2 },
    profile,
    biomes,
  );
  assert.equal(survivalBoard.mode, "endless");
  assert.equal(survivalBoard.objective, "endless");
  assert.equal(survivalBoard.tier, 0);
  assert.equal(base.priority, "开新图");
});

test("unavailable characters and maps are rejected before a run starts", () => {
  const { base, profile, biomes } = planFixture();
  assert.throws(
    () => configurePlan(base, { characterId: 25 }, profile, biomes),
    /角色尚未/,
  );
  assert.throws(
    () => configurePlan(base, { biome: "desert" }, profile, biomes),
    /地图尚未/,
  );
  assert.throws(
    () =>
      configurePlan(
        base,
        { biome: "future" },
        { ...profile, biomes: { forest: 1, future: 0 } },
        biomes,
      ),
    /地图尚未/,
  );
  assert.throws(() => configurePlan(base, {characterId:"4",tier:2},profile,biomes), /难度尚未解锁/);
  const unlocked = configurePlan(
    base,
    { characterId: "4", tier: 1 },
    profile,
    biomes,
  );
  assert.equal(unlocked.species, 4);
  assert.equal(unlocked.tier, 1);
  assert.equal(configurePlan({...base,tier:2},{biome:"forest",tier:"auto"},profile,biomes).tier,1,
    "automatic difficulty is bounded by the selected map's actual unlocks");
  assert.equal(
    configurePlan({ ...base, biome: "desert" }, {}, profile, biomes).biome,
    "forest",
  );
});

test("build selection falls back by character and mode and can force a generic plan", () => {
  const { base, profile, biomes } = planFixture();
  const generic = {
    id: "universal-safe",
    species: null,
    sourceType: "generic",
    mode: "standard",
    items: ["leftovers"],
  };
  const own = { id: "bulbasaur-clear", species: 1, mode: "standard" };
  const other = { id: "charmander-clear", species: 4, mode: "standard" };
  const survival = { id: "bulbasaur-endless", species: 1, mode: "endless" };
  const builds = [generic, survival, other, own];
  assert.equal(configurePlan(base, {}, profile, biomes, builds).build, own);
  assert.equal(
    configurePlan(base, { build: "generic" }, profile, biomes, builds).build,
    generic,
  );
  assert.equal(
    configurePlan(base, { build: "universal-safe" }, profile, biomes, builds)
      .build,
    generic,
  );
  assert.equal(
    configurePlan(base, { build: "charmander-clear" }, profile, biomes, builds)
      .build,
    own,
  );
  assert.equal(
    configurePlan(
      base,
      { mode: "endless", build: own.id },
      profile,
      biomes,
      builds,
    ).build,
    survival,
  );
  assert.equal(
    configurePlan(base, {}, profile, biomes, [generic, other]).build,
    generic,
  );
  assert.equal(configurePlan(base, {}, profile, biomes, []).build, null);
});

test("automatic build selection prefers matching map and difficulty then credible recent records", () => {
  const { base, profile, biomes } = planFixture();
  const old = {
    id: "old",
    species: 1,
    biome: "forest",
    tier: 0,
    mode: "standard",
    hasDetailedBuild: true,
    victory: true,
    ranked: true,
    date: "2026-10-17T00:00:00Z",
  };
  const recent = { ...old, id: "recent", date: "2026-10-20T00:00:00Z" };
  const wrongTier = {
    ...recent,
    id: "wrong-tier",
    tier: 2,
    date: "2026-10-21T00:00:00Z",
  };
  const wrongMap = {
    ...recent,
    id: "wrong-map",
    biome: "desert",
    date: "2026-10-21T00:00:00Z",
  };
  const summaryOnly = {
    ...recent,
    id: "summary",
    hasDetailedBuild: false,
    date: "2026-10-21T00:00:00Z",
  };
  const noWin = {
    ...recent,
    id: "no-win",
    victory: false,
    date: "2026-10-21T00:00:00Z",
  };
  const unranked = {
    ...recent,
    id: "unranked",
    ranked: false,
    date: "2026-10-21T00:00:00Z",
  };
  const builds = [
    wrongTier,
    wrongMap,
    summaryOnly,
    noWin,
    unranked,
    old,
    recent,
  ];
  assert.equal(configurePlan(base, {}, profile, biomes, builds).build, recent);
  assert.equal(
    configurePlan(
      base,
      { tier: 2 },
      { ...profile, biomes: { forest: 2 } },
      biomes,
      builds,
    ).build,
    wrongTier,
  );
  // An explicit compatible choice remains under the player's control.
  assert.equal(
    configurePlan(base, { build: old.id }, profile, biomes, builds).build,
    old,
  );
  assert.equal(builds[0], wrongTier);
});

const makeScoringRun = (moves) => ({
  player: {
    hp: 100,
    maxHp: 100,
    level: 5,
    moveSlots: 3,
    types: ["grass", "poison"],
    moves,
    stats: {},
  },
});

test("mod benefits follow actual move categories and architecture support", () => {
  const barrage = {
    def: {
      key: "razor-leaf",
      arch: "barrage",
      cls: "physical",
      count: 4,
      area: 0.35,
    },
  };
  const cone = {
    def: {
      key: "sleep-powder",
      arch: "cone",
      cls: "special",
      area: 7,
      status: "sleep",
    },
  };
  const physical = [{ stat: "physical", mul: 1.35 }];
  const area = [{ stat: "area", mul: 1.1 }];
  const projectiles = [{ stat: "projectiles", add: 1 }];
  assert.ok(scoreMods(physical, 1, [barrage]) > scoreMods(physical, 1, [cone]));
  assert.ok(scoreMods(area, 1, [barrage]) > 0);
  assert.ok(scoreMods(area, 1, [cone]) > 0);
  assert.equal(scoreMods(projectiles, 1, [cone]), 0);
  assert.ok(scoreMods(projectiles, 1, [{ def: { arch: "strike" } }]) > 0);
  assert.ok(scoreMods(projectiles, 1, [{ def: { arch: "beam" } }]) > 0);
  assert.ok(scoreMods([{ stat: "duration", mul: 1.2 }], 1, [barrage]) > 0);
  const mixed = scoreMods(physical, 1, [barrage, cone]);
  assert.equal(mixed, scoreMods(physical, 1, [barrage]) / 2);
  assert.ok(scoreMods([{ stat: "attackSpeed", mul: 0.92 }], 1, [barrage]) < 0);
});

test("vitamin cards use their real stat definitions and do not reward unused rare cards", () => {
  const run = makeScoringRun([
    { def: { key: "razor-leaf", arch: "barrage", cls: "physical" } },
  ]);
  const protein = scoreOffer(
    { kind: "newVit", vit: "protein", rarity: 0 },
    run,
    {},
  );
  const calcium = scoreOffer(
    { kind: "newVit", vit: "calcium", rarity: 4 },
    run,
    {},
  );
  const area = scoreOffer(
    { kind: "newVit", vit: "stardust", rarity: 4 },
    run,
    {},
  );
  assert.ok(protein > calcium);
  assert.ok(calcium < 0);
  assert.ok(area > 0);
  assert.ok(
    scoreOffer({ kind: "newVit", vit: "ether", rarity: 0 }, run, {}) > 0,
  );
  run.player.stats.critChance = 2;
  assert.ok(
    scoreOffer({ kind: "upVit", vit: "dire-hit", rarity: 4 }, run, {}) < 0,
  );
  const liveDefinitions = {
    vitamins: new Map([
      ["future-vitamin", { stat: "regen", per: 1, kind: "add" }],
    ]),
    rarityMultipliers: [1, 2],
  };
  assert.ok(
    scoreOffer(
      { kind: "newVit", vit: "future-vitamin", rarity: 1 },
      run,
      liveDefinitions,
    ) >
      scoreOffer(
        { kind: "newVit", vit: "future-vitamin", rarity: 0 },
        run,
        liveDefinitions,
      ),
  );
});

test("loaded dice evaluates the native legal uniform pool without drawing or pretending its zero per is worthless",()=>{
  const player={hp:100,maxHp:100,moves:[{def:{arch:'bolt',cls:'physical',dmg:10,cd:1}}],
    items:new Map(),vitamins:new Map(),stats:{physical:1,armor:0,moveSpeed:1}};
  const pool=[{key:'protein',stat:'physical',per:.1,kind:'mul'},
    {key:'calcium',stat:'special',per:.1,kind:'mul'},
    {key:'iron',stat:'armor',per:5,kind:'add'},
    {key:'loaded-dice',stat:'luck',per:0,kind:'add',dice:true},
    {key:'cursed',stat:'difficulty',per:.12,kind:'mul',extra:[{stat:'xpGain',mul:.06}]},
    {key:'super-lure',stat:'eliteSpawn',per:.18,kind:'mul',extra:[{stat:'eliteDamage',mul:.05}]},
    {key:'enigma-berry',stat:'overheal',per:.05,kind:'add'},
    {key:'poke-radar',stat:'powerup',per:.15,kind:'mul'}];
  const data={vitamins:new Map(pool.map(def=>[def.key,def])),rarityMultipliers:[1,1.2,1.45,1.75,2.1]},
    before=JSON.stringify(pool),run={player,build:{}};
  const expected=15+(
    scoreMods([{stat:'physical',mul:1.15}],1,player)+
    scoreMods([{stat:'special',mul:1.15}],1,player)+
    scoreMods([{stat:'armor',add:7.5}],1,player))/3;
  const actual=scoreOffer({kind:'newVit',vit:'loaded-dice',rarity:0},run,data);
  assert.ok(actual>15);assert.ok(Math.abs(actual-expected)<1e-9);
  assert.equal(JSON.stringify(pool),before);assert.equal(player.vitamins.size,0);
});

test("vitamin extra benefits accompany their real difficulty downside and do not erase it",()=>{
  const player={hp:100,maxHp:100,moves:[{def:{arch:'bolt',cls:'physical',dmg:10,cd:1}}],
    items:new Map(),vitamins:new Map(),stats:{physical:1,armor:0,moveSpeed:1}},run={player,build:{}};
  const cursed={key:'cursed',stat:'difficulty',per:.12,kind:'mul',
    extra:[{stat:'xpGain',mul:.06},{stat:'gold',mul:.06}]};
  const lure={key:'super-lure',stat:'eliteSpawn',per:.18,kind:'mul',extra:[{stat:'eliteDamage',mul:.05}]};
  const data={vitamins:new Map([['cursed',cursed],['super-lure',lure]])};
  const cursedScore=scoreOffer({kind:'newVit',vit:'cursed',rarity:0},run,data);
  const baseCursed=scoreOffer({kind:'newVit',vit:'cursed',rarity:0},run,
    {vitamins:new Map([['cursed',{...cursed,extra:[]}]])});
  assert.ok(cursedScore>baseCursed);assert.ok(cursedScore<0);
  const full=scoreOffer({kind:'newVit',vit:'super-lure',rarity:0},run,data),
    base=scoreOffer({kind:'newVit',vit:'super-lure',rarity:0},run,
      {vitamins:new Map([['super-lure',{...lure,extra:[]}]])});
  assert.ok(full>base);
  for(const key of ['sticky-barb','enigma-berry','super-lure','poke-radar','loaded-dice'])
    assert.ok(Number.isFinite(scoreOffer({kind:'newVit',vit:key,rarity:0},run,{})));
});

test("a build reserves its final slot while useful upgrades to its held moves remain attractive", () => {
  const vine = {
    id: 22,
    key: "vine-whip",
    arch: "strike",
    cls: "physical",
    type: "grass",
    count: 1,
  };
  const razor = {
    id: 75,
    key: "razor-leaf",
    arch: "barrage",
    cls: "physical",
    type: "grass",
    count: 4,
  };
  const sleep = {
    id: 79,
    key: "sleep-powder",
    arch: "cone",
    cls: "special",
    type: "grass",
    count: 1,
  };
  const beam = {
    id: 76,
    key: "solar-beam",
    arch: "beam",
    cls: "special",
    type: "grass",
    count: 1,
  };
  const data = {
    moves: new Map([vine, razor, sleep, beam].map((m) => [m.id, m])),
  };
  const run = makeScoringRun([{ def: vine }, { def: razor }]);
  run.build = { moves: ["vine-whip", "razor-leaf", "solar-beam"] };
  const nonPlan = scoreOffer({ kind: "newMove", id: sleep.id }, run, data);
  const upgrade = scoreOffer(
    {
      kind: "upMove",
      slot: 1,
      rarity: 0,
      ups: [
        { key: "count", value: 1 },
        { key: "dmg", value: 0.22 },
      ],
    },
    run,
    data,
  );
  const target = scoreOffer({ kind: "newMove", id: beam.id }, run, data);
  assert.ok(nonPlan < 0);
  assert.ok(upgrade > nonPlan);
  assert.ok(target > upgrade);
  assert.ok(
    upgrade >
      scoreOffer({ kind: "upMove", slot: 1, rarity: 0, ups: [] }, run, data),
  );
});

test("an unavailable shared move cannot hold the final slot forever", () => {
  const run = makeScoringRun([
    { def: { key: "vine-whip", arch: "strike" } },
    { def: { key: "razor-leaf", arch: "barrage" } },
  ]);
  run.build = { moves: ["vine-whip", "locked-donor-move"] };
  const data = {
    moves: new Map([
      [79, { id: 79, key: "sleep-powder", arch: "cone", type: "grass" }],
    ]),
  };
  const offer = { kind: "newMove", id: 79 };
  assert.ok(scoreOffer(offer, run, data) < 0);
  run.availableMoveKeys = ["vine-whip", "razor-leaf", "sleep-powder"];
  assert.ok(scoreOffer(offer, run, data) > 0);
  delete run.availableMoveKeys;
  run.player.level = 21;
  assert.ok(scoreOffer(offer, run, data) > 0);
  run.availableMoveKeys = new Set(["locked-donor-move"]);
  assert.ok(
    scoreOffer(offer, run, data) > 0,
    "a known but unoffered move cannot reserve a slot past the configured deadline",
  );
});
