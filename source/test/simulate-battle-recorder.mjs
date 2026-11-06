// 360 game-minute telemetry workload. Synthetic fields; never starts a game/account.
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { BattleRecorder } from '../src/battle-recorder.mjs';
import { readControllerPackage } from '../scripts/controller-sources.mjs';
const output = path.resolve(process.argv[2] || 'validation/simulation-360'); fs.mkdirSync(output, { recursive: true });
const file = fs.openSync(path.join(output, 'input-batches.jsonl'), 'w');
const pkg = await readControllerPackage(); let wall = 100000, batches = 0, serializedBytes = 0, serializeMs = 0;
const times = [], tinyTimes = [], startMemory = process.memoryUsage(); let recorder;
recorder = new BattleRecorder({ revision: pkg.revision, sourceHash: 'synthetic-not-a-native-source-hash', wall: () => wall,
  send(message) { const start = performance.now(); const line = JSON.stringify(message.batch) + '\n'; serializeMs += performance.now() - start;
    fs.writeSync(file, line); serializedBytes += Buffer.byteLength(line); batches++;
    recorder.acknowledge({ runId: message.batch.runId, batchId: message.batch.batchId, lastSeq: message.batch.lastSeq, ok: true }); } });
const run = { time: 0, state: 'play', tower: { floor: 1, wave: 1, state: 'wave' }, gold: 0,
  stats: { kills: 0, damageTaken: 0 }, player: { level: 1, hp: 1000, maxHp: 1000,
    pos: { x: 0, y: 0, z: 0 }, stats: { luck: 100 }, moves: [], items: new Map(), vitamins: new Map() }, enemies: { count: 10 } };
const pilot = { settings: { mode: 'tower', pickup: true }, plan: { build: { moves: ['test-fusion'] } } };
const started = performance.now();
for (let tenth = 0; tenth <= 216000; tenth++) {
  wall = 100000 + tenth * 100; run.time = tenth / 10;
  const floor = Math.min(72, Math.floor(run.time / 300) + 1), local = run.time % 300;
  run.tower.floor = floor; run.tower.wave = Math.min(5, Math.floor(local / 50) + 1); run.tower.state = local >= 275 ? 'clear' : 'wave';
  pilot.towerCleanupState = local >= 275 ? { floor, phase: local < 285 ? 'rewards' : local < 295 ? 'experience' : 'complete', elapsed: local - 275 } : null;
  if (tenth % 10 === 0 && tenth) {
    run.stats.kills++; run.player.pos.x = (run.time % 30) / 2;
    if (run.time % 90 === 0) { run.gold += 10; run.player.items.set('synthetic-item', (run.player.items.get('synthetic-item') || 0) + 1); }
    if (run.time === 120) run.player.moves.push({ def: { key: 'test-fusion', fusion: true }, level: 8 });
    if (run.time % 120 === 0) {
      const modal = { run, kind: 'blessing', offers: [{ key: 'damage', mods: [{ stat: 'damage', mul: 1.1 }] }, { key: 'xp', mods: [{ stat: 'xp', add: 2 }] }] };
      recorder.page(modal); recorder.evaluated(modal, { action: 'choose', index: 0, candidates: [{ index: 0, score: 2 }, { index: 1, score: 1 }], benefitEvaluations: [{ index: 0, known: true }] }, () => true);
      const a = recorder.attempt(modal, 'blessing'); recorder.nativeCallback(modal, [modal.offers[0]], () => { run.player.level++; }); recorder.receipt(a, run);
    }
  }
  const start = performance.now(); recorder.observe(run, pilot); const elapsed = performance.now() - start;
  (tenth % 10 === 0 ? times : tinyTimes).push(elapsed);
}
run.state = 'over'; wall += 1000; recorder.observe(run, pilot, true); recorder.observe(null, pilot);
while (recorder.queue.length) { wall += 3000; recorder.pump(); }
fs.closeSync(file); times.sort((a,b) => a-b); tinyTimes.sort((a,b) => a-b);
const report = { isLiveGame: false, description: '360 minute synthetic telemetry, 10 Hz observation, immediate synthetic durable ACK replaced by real C# writer replay in next step',
  revision: pkg.revision, gameSeconds: 21600, observeCalls: 216001, batches, serializedBytes, serializeMs,
  fullObserveP50Ms: times[Math.floor(times.length*.5)], fullObserveP95Ms: times[Math.floor(times.length*.95)], fullObserveMaxMs: times.at(-1),
  gatedObserveP95Ms: tinyTimes[Math.floor(tinyTimes.length*.95)], elapsedMs: performance.now()-started,
  startMemory, endMemory: process.memoryUsage(), collector: recorder.status(), nonzeroOverhead: true };
fs.writeFileSync(path.join(output, 'collector-performance.json'), JSON.stringify(report, null, 2)); console.log(report);
