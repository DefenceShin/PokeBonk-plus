// Reproducible synthetic projectile-only stress test. This is not a game win test.
import { chooseMotion, closestApproach } from "../src/policy.mjs";
import { writeFile } from "node:fs/promises";

function rng(seed) {
  return () => {
    seed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    seed ^= seed + Math.imul(seed ^ (seed >>> 7), 61 | seed);
    return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
  };
}
function scenario(seed, automatic) {
  const random = rng(seed + 1234),
    dt = 1 / 60;
  let x = 0,
    z = 0,
    vx = 0,
    vz = 0,
    hits = 0,
    previous = { x: 0, z: 0 },
    projectiles = [];
  for (let frame = 0; frame < 420; frame++) {
    if (frame % 15 === 0) {
      const angle = random() * Math.PI * 2,
        speed = 15 + random() * 14;
      projectiles.push({
        x: x + Math.cos(angle) * 18,
        z: z + Math.sin(angle) * 18,
        vx: -Math.cos(angle) * speed,
        vz: -Math.sin(angle) * speed,
        radius: 0.4,
        life: 2,
      });
    }
    const motion = automatic
      ? chooseMotion({
          player: { x, z, speed: 6.3, radius: 0.55 },
          target: { x: 100, z: 100 },
          previous,
          bullets: projectiles,
        })
      : { x: Math.SQRT1_2, z: Math.SQRT1_2 };
    previous = motion;
    vx += (motion.x * 6.3 - vx) * Math.min(1, (280 * dt) / 6.3);
    vz += (motion.z * 6.3 - vz) * Math.min(1, (280 * dt) / 6.3);
    for (const b of projectiles) {
      if (
        closestApproach(b.x - x, b.z - z, b.vx - vx, b.vz - vz, dt).distance <
        0.95
      ) {
        hits++;
        b.life = 0;
      }
      b.x += b.vx * dt;
      b.z += b.vz * dt;
      b.life -= dt;
    }
    projectiles = projectiles.filter((b) => b.life > 0);
    x += vx * dt;
    z += vz * dt;
  }
  return hits;
}
const started = performance.now();
let baselineHits = 0,
  controllerHits = 0;
for (let seed = 1; seed <= 100; seed++) {
  baselineHits += scenario(seed, false);
  controllerHits += scenario(seed, true);
}
const result = {
  scenarios: 100,
  secondsPerScenario: 7,
  projectileModel:
    "linear aimed shots with varying speeds; includes player horizontal acceleration; excludes vertical motion",
  baselineHits,
  controllerHits,
  reduction: 1 - controllerHits / baselineHits,
  wallTimeMs: performance.now() - started,
  scope:
    "synthetic projectile model only; excludes terrain, bosses, contact and game rendering",
};
await writeFile(
  new URL("../research/projectile-simulation.json", import.meta.url),
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
