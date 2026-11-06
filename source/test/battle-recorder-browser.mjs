// Real IndexedDB, private headless browser profile, synthetic combat only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const output = path.resolve(process.argv[2] || '../validation/browser-outbox');
await fs.mkdir(output, { recursive: true });
const profile = path.join(output, `profile-${Date.now()}`);
const server = http.createServer((_, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Isolated recorder test</title>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const source = (await fs.readFile(new URL('../src/battle-recorder.mjs', import.meta.url), 'utf8')).replace(/^export /gm, '') + '\nglobalThis.BattleRecorder=BattleRecorder;globalThis.BattleRecordOutbox=BattleRecordOutbox;';
let browser;
async function open() {
  const executablePath = process.env.RECORDER_TEST_BROWSER || path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe');
  browser = await chromium.launchPersistentContext(profile, { executablePath, headless: true, args: ['--disable-gpu'] });
  const page = await browser.newPage(); await page.goto(url); await page.addScriptTag({ content: source }); return page;
}
try {
  let page = await open();
  const expectedId = 'run-' + createHash('sha256').update('pokebonk-report:synthetic-private-ticket').digest('hex').slice(0, 24);
  const storage = await page.evaluate(async () => {
    const box = new BattleRecordOutbox();
    const b = { schemaVersion: 1, runId: 'outbox-unit', reportTicket: 'synthetic-private-ticket', batchId: 'once', firstSeq: 1, lastSeq: 1, records: [{ seq: 1 }] };
    await box.put(b); await box.put(b);
    const all = await box.transaction('readonly', (store, done) => { const r = store.getAll(); r.onsuccess = () => done(r.result); });
    const first = await box.first(); await box.remove('once');
    return { count: all.length, reportId: first.reportId, rawTicketPersisted: JSON.stringify(all).includes('synthetic-private-ticket'), empty: await box.first() === null };
  });
  assert.equal(storage.count, 1); assert.equal(storage.reportId, expectedId); assert.equal(storage.rawTicketPersisted, false); assert.equal(storage.empty, true);
  const capture = await page.evaluate(async () => {
    let now = 100000;
    const run = { time: 0, state: 'play', gold: 100, meta: { ticket: { id: 'synthetic-private-ticket' } },
      tower: { floor: 1, wave: 1, state: 'wave' }, stats: { kills: 0, damageTaken: 0 },
      player: { hp: 1000, maxHp: 1000, shield: 0, dead: false, moves: [], items: new Map(), vitamins: new Map(), stats: {},
        hurt() { this.hp -= 1; run.stats.damageTaken++; return true; },
        die() { this.dead = true; this.hp = 0; }, revive() { this.dead = false; this.hp = 1000; } } };
    const r = new BattleRecorder({ wall: () => now, maxRecords: 12, maxBytes: 16000, send() {} });
    globalThis.recorder = r; r.observe(run, {});
    for (let i = 0; i < 1000; i++) {
      run.time += .1; now += 100; run.gold++;
      const modal = { run, kind: 'upgrade', offers: ['a', 'b'] };
      for (let j = 0; j < 20; j++) r.evaluated(modal, { action: 'choose', index: i % 2, candidates: [{ index: 0, score: 12 }, { index: 1, score: 10 }] }, () => true);
      r.event('decision_receipt', { decisionId: r.page(modal).decisionId, status: 'success' });
      if (i % 10 === 0) run.player.hurt();
      if (i === 500) { run.player.die(); run.player.revive(); }
      r.observe(run, {});
      if (i % 10 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    run.state = 'over'; r.observe(run, {}, true);
    for (let i = 0; i < 3000 && (r.queue.length || r.spooling); i++) { r.pump(); await new Promise(resolve => setTimeout(resolve, 2)); }
    const saved = await r.outbox.transaction('readonly', (store, done) => { const q = store.getAll(); q.onsuccess = () => done(q.result); });
    return { status: r.status(), rows: saved.length, records: saved.flatMap(s => s.batch.records).length,
      reportIds: [...new Set(saved.map(s => s.batch.reportId))], rawTicketPersisted: JSON.stringify(saved).includes('synthetic-private-ticket') };
  });
  assert.equal(capture.status.queued, 0); assert.equal(capture.status.droppedEvents, 0); assert.equal(capture.status.droppedSamples, 0);
  assert.equal(capture.status.suppressedDuplicates, 19000); assert.equal(capture.rawTicketPersisted, false); assert.deepEqual(capture.reportIds, [expectedId]);
  await browser.close(); browser = null;
  page = await open();
  const replay = await page.evaluate(async () => {
    let now = 1000000, failures = 0; const received = [];
    const r = new BattleRecorder({ wall: () => now, send({ batch }) {
      if (!failures) { failures++; r.acknowledge({ ...batch, ok: false, error: 'synthetic-disk-full' }); return; }
      received.push(structuredClone(batch)); r.acknowledge({ runId: batch.runId, batchId: batch.batchId, lastSeq: batch.lastSeq, ok: true });
    } });
    for (let i = 0; i < 3000; i++) {
      now += 2100; r.pump(); await new Promise(resolve => setTimeout(resolve, 2));
      if (!r.inflight && !r.removing && !r.delivering && await r.outbox.first() === null) break;
    }
    return { batches: received, empty: await r.outbox.first() === null, failures, status: r.status() };
  });
  const records = replay.batches.flatMap(b => b.records), types = records.reduce((a, r) => (a[r.type] = (a[r.type] || 0) + 1, a), {});
  assert.equal(replay.empty, true); assert.equal(replay.failures, 1); assert.equal(records.length, capture.records);
  assert.equal(new Set(records.map(r => r.seq)).size, records.length);
  assert.equal(types.decision_evaluated, 1000); assert.equal(types.decision_receipt, 1000);
  assert.equal(types.player_died, 1); assert.equal(types.player_revived, 1);
  assert.ok(types.damage_taken >= 100); assert.equal(types.combat_summary, undefined);
  assert.equal(records.filter((r, i) => i && r.seq !== records[i - 1].seq + 1).length, 0);
  await fs.writeFile(path.join(output, 'recovered-batches.jsonl'), replay.batches.map(b => JSON.stringify(b)).join('\n') + '\n');
  const report = { passed: true, isLiveGame: false, nativeIndexedDB: true, browserRestartRecovery: true, negativeAckRetainsBatch: true,
    rawTicketPersisted: false, capture, batchCount: replay.batches.length, recordCount: records.length, types };
  await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
