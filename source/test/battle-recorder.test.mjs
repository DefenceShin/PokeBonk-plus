import test from 'node:test';
import assert from 'node:assert/strict';
import { BattleRecorder } from '../src/battle-recorder.mjs';
import { fixture } from './battle-recorder-fixture.mjs';

const records = r => r.queue.map(e => e.record);
test('report routing captures the original run ticket and keeps it outside persisted records',()=>{
  let wall=100000;const sent=[];
  const recorder=new BattleRecorder({wall:()=>wall,send:message=>sent.push(message)}),
    pilot={app:{meta:{ticket:{id:'original-ticket'}}}},
    first={time:1,state:'play',player:{moves:[],items:new Map(),vitamins:new Map(),stats:{}}};
  recorder.observe(first,pilot);pilot.app.meta.ticket.id='next-ticket';
  recorder.observe({...first,time:0},pilot);wall+=5000;recorder.pump();
  assert.equal(sent[0].batch.reportTicket,'original-ticket');
  assert.ok(!JSON.stringify(sent[0].batch.records).includes('original-ticket'));
  assert.ok(!JSON.stringify(recorder.status()).includes('original-ticket'));
});
function harness(options = {}) {
  let wall = 100000; const sent = [];
  const r = new BattleRecorder({ detail: 'full', outbox: null, wall: () => wall, send: b => sent.push(structuredClone(b)), ...options });
  const run = { time: 0, state: 'play', tower: { floor: 1, wave: 1, state: 'wave' }, gold: 10,
    stats: { kills: 0, damageTaken: 0 }, player: { hp: 100, maxHp: 100, level: 1,
      moves: [], vitamins: new Map(), items: new Map(), stats: {}, pos: { x: 0, y: 0, z: 0 } }, enemies: { count: 2 } };
  const pilot = { settings: { mode: 'tower' }, plan: { build: { moves: ['x'] } }, blocked: new Map() };
  r.observe(run, pilot); return { r, run, pilot, sent, advance(seconds = 1) { wall += seconds * 1000; run.time += seconds; r.observe(run, pilot); } };
}

test('real controller records complete candidates, score context, actual attempt and native receipt', () => {
  const h = fixture(); h.open('itemChoice', ['choice-band', 'leftovers']); h.tick();
  const es = records(h.pilot.battleRecorder);
  assert.equal(es.find(e => e.type === 'decision_candidates').offers.length, 2);
  assert.equal(es.find(e => e.type === 'decision_evaluated').offers.length, 2);
  assert.ok(es.some(e => e.type === 'decision_intent'));
  const a = es.find(e => e.type === 'decision_attempt'), receipt = es.find(e => e.type === 'decision_receipt');
  assert.equal(receipt.decisionId, a.decisionId); assert.equal(receipt.status, 'success');
  assert.equal(receipt.resourceAttribution, 'unknown'); assert.deepEqual(h.chosen, ['leftovers']);
});
test('real controller failure retries keep one decision identity and never invent rewards', () => {
  const h = fixture(); h.open('itemChoice', ['leftovers'], { noProgress: true });
  h.tick(); h.tick(701); h.tick(701);
  const es = records(h.pilot.battleRecorder), receipts = es.filter(e => e.type === 'decision_receipt');
  assert.ok(receipts.length >= 2); assert.equal(new Set(receipts.map(e => e.decisionId)).size, 1);
  assert.ok(receipts.every(e => e.status === 'unknown' && e.effectConfirmed === false));
});
test('recording disabled and observation failure leave actual decisions unchanged', () => {
  const enabled = fixture(), disabled = fixture({}, {}, { battleRecorder: false });
  enabled.pilot.battleRecorder.offer = () => { throw Error('broken-observer'); };
  for (const h of [enabled, disabled]) { h.open('itemChoice', ['leftovers', 'choice-band']); h.tick(); }
  assert.deepEqual(enabled.chosen, disabled.chosen); assert.equal(disabled.pilot.battleRecorder, null);
});
test('native callback false, Promise and no-op are not successful reward receipts', () => {
  for (const result of [false, Promise.resolve(true), undefined]) {
    const h = harness(), modal = { run: h.run, kind: 'trade', offers: ['x'] };
    const a = h.r.attempt(modal, 'trade');
    assert.equal(h.r.nativeCallback(modal, ['x'], () => result), result);
    h.r.receipt(a, h.run);
    assert.equal(records(h.r).at(-1).status, result === false ? 'failed' : 'unknown');
  }
});
test('native callback keeps exact invoke count, identity and exception when recorder throws', () => {
  const h = harness(), modal = { run: h.run, kind: 'trade', offers: [] }, identity = {};
  h.r.offer = () => { throw Error('observer'); }; let called = 0;
  assert.equal(h.r.nativeCallback(modal, ['x'], () => { called++; return identity; }), identity);
  const error = Error('native'); assert.throws(() => h.r.nativeCallback(modal, ['x'], () => { called++; throw error; }), e => e === error);
  assert.equal(called, 2);
});
test('receipts do not fabricate empty settings, phase or loadout revisions', () => {
  const h = harness(); const n = records(h.r).filter(e => e.type === 'configuration').length;
  const a = h.r.attempt({ run: h.run, kind: 'trade' }); h.r.receipt(a, h.run); h.advance();
  assert.equal(records(h.r).filter(e => e.type === 'configuration').length, n);
  assert.equal(records(h.r).at(-1).phase, 'wave-active');
});
test('unacknowledged immutable batch is retransmitted; mismatched/negative ACK cannot discard records', () => {
  const h = harness(); const first = h.sent[0].batch; h.advance(3);
  assert.deepEqual(h.sent.at(-1).batch, first);
  assert.equal(h.r.acknowledge({ ...first, ok: true, lastSeq: 999999 }), false);
  assert.equal(h.r.acknowledge({ ...first, ok: false, error: 'disk-full' }), false);
  assert.equal(h.r.status().writerError, 'disk-full');
  assert.equal(h.r.acknowledge({ runId: first.runId, batchId: first.batchId, lastSeq: first.lastSeq, ok: true }), true);
  assert.ok(records(h.r).every(e => e.seq > first.lastSeq));
});
test('paused game seconds, crossing floor and long gaps reconcile with unknown intervals', () => {
  const h = harness(); h.advance(); h.run.state = 'paused'; h.r.observe(h.run, h.pilot);
  h.run.state = 'play'; h.r.observe(h.run, h.pilot); h.advance();
  h.run.tower.floor = 2; h.advance(); h.advance(8);
  const samples = records(h.r).filter(e => e.type === 'combat_summary');
  assert.equal(samples.reduce((sum, s) => sum + s.seconds, 0), h.run.time);
  assert.ok(samples.some(s => s.intervalFloor === null && s.phase === 'unknown'));
  assert.ok(samples.some(s => s.coverage === 'gap' && s.seconds === 8));
});
test('clock and counters resetting start segment; replacing native run starts separate run', () => {
  const h = harness(); h.advance(5); h.run.time = 1; h.r.observe(h.run, h.pilot);
  assert.equal(h.r.segment, 2); const old = h.r.runId;
  h.r.observe({ ...h.run, time: 0 }, h.pilot); assert.notEqual(h.r.runId, old);
  assert.ok(records(h.r).some(e => e.type === 'segment_start'));
});
test('simultaneous gold/inventory changes stay unknown and missing values stay null', () => {
  const h = harness(); h.run.gold += 20; h.run.player.items.set('x', 1); delete h.run.stats.damageTaken; h.advance();
  const delta = records(h.r).find(e => e.type === 'resource_delta'); assert.equal(delta.goldDelta, 20); assert.equal(delta.attribution, 'unknown');
  assert.equal(records(h.r).at(-1).damageTakenDelta, null);
});
test('queue overflow favors events, reports original lost run/segment and stays bounded', () => {
  const h = harness({ maxRecords: 12, maxBytes: 100000 }); const old = h.r.runId;
  for (let i = 0; i < 25; i++) h.advance();
  h.r.observe({ ...h.run, time: 0 }, h.pilot); for (let i = 0; i < 20; i++) h.r.event('important');
  assert.ok(h.r.queue.length <= 12); assert.ok(h.r.bytes <= h.r.maxBytes);
  assert.ok([...h.r.losses.values()].some(l => l.runId === old));
  assert.ok(h.r.metrics.droppedSamples > 0);
});
test('settlement then empty state retains last battle and full equipment', () => {
  const h = harness(); h.run.player.moves.push({ def: { key: 'fusion' }, level: 8 }); h.advance();
  h.run.state = 'over'; h.r.observe(h.run, h.pilot); h.r.observe(null, h.pilot);
  const end = records(h.r).find(e => e.type === 'run_ended');
  assert.equal(end.lastBattle.loadout.moves[0].key, 'fusion'); assert.equal(h.r.lastBattle.state, 'play');
});
test('shipped heartbeat, actual bridge provenance, hot reload and ACK listener share a single channel', () => {
  const h = fixture({}, {}, { revision:'test-rev-a' });
  h.bridge.compatibility = { sourceHash: 'a'.repeat(64) }; h.open('itemChoice', ['leftovers']); h.pulse();
  const recorder = h.pilot.battleRecorder, first = h.messages.find(m => m.kind === 'battleRecords').batch;
  assert.equal(recorder.sourceHash, 'a'.repeat(64));
  h.reload({ revision:'test-rev-b' }); assert.equal(h.pilot.battleRecorder, recorder);
  assert.equal(recorder.revision, 'test-rev-b'); assert.deepEqual(h.channelCounts(), { ackListeners:1, heartbeats:1 });
  h.ack({ runId:first.runId, batchId:first.batchId, lastSeq:first.lastSeq, ok:true });
  assert.equal(recorder.metrics.ackedSeq, first.lastSeq);
  h.reload({ battleRecorder:false }); const count = recorder.seq; h.pulse(); assert.equal(recorder.seq, count);
  h.reload({ battleRecorder:true, revision:'test-rev-c' }); h.pulse(); assert.equal(recorder.revision, 'test-rev-c');
});
test('disabled legacy installation can enable recorder on existing run without starting or replacing run', () => {
  const h = fixture({}, {}, { battleRecorder:false }); h.app.run = h.run;
  h.reload({ battleRecorder:true, revision:'enabled-later' }); h.pulse();
  assert.equal(h.app.run, h.run); assert.equal(h.pilot.battleRecorder.run, h.run);
  assert.deepEqual(h.channelCounts(), { ackListeners:1, heartbeats:1 });
});
test('trade packet preserves every native tombstone candidate, actual choice and explicit unknown random outcome', () => {
  const h = harness(); const modal = { run:h.run, kind:'trade', offers:{ title:'tombstone', offers:[{key:'treat', item:'rare-candy'}, {key:'trick'}] } };
  h.r.page(modal); h.r.evaluated(modal, {action:'choose',index:1}, () => true);
  const a = h.r.attempt(modal, 'trade'); h.r.nativeCallback(modal, ['trick'], () => {}); h.r.receipt(a, h.run);
  assert.equal(records(h.r).find(e => e.type === 'decision_candidates').offers.length, 2);
  assert.equal(records(h.r).find(e => e.type === 'native_choice_return').outcome, 'unknown-random-outcome-not-in-callback-return');
});
test('oversized core event becomes a visible loss marker instead of poisoning batch retransmission forever', () => {
  const h = harness(); h.r.event('oversized', { candidateText:'x'.repeat(300000) });
  assert.equal(h.r.metrics.droppedEvents, 1); h.r.event('important-after-oversize');
  assert.ok(records(h.r).some(r => r.type === 'important-after-oversize'));
  assert.ok([...h.r.losses.values()].some(l => l.events === 1));
});
test('disk failure then recovery remain in persistent event stream', () => {
  const h = harness(), batch = h.sent[0].batch;
  h.r.acknowledge({ runId:batch.runId, batchId:batch.batchId, lastSeq:batch.lastSeq, ok:false, error:'record-write-failed' });
  h.r.acknowledge({ runId:batch.runId, batchId:batch.batchId, lastSeq:batch.lastSeq, ok:true });
  assert.ok(records(h.r).some(e => e.type === 'storage_error')); assert.ok(records(h.r).some(e => e.type === 'storage_recovered'));
});
test('actual world interaction hook records altar before/after and preserves return, call count and native errors', () => {
  const h = fixture(); h.app.run = h.run; const identity = {}, error = Error('native-altar'); let calls = 0;
  h.run.interactables = { interact(entity, value) { calls++; h.run.gold -= 3; return value; },
    altarDone(entity) { calls++; h.run.player.hp -= 5; if (entity.fail) throw error; return identity; } };
  h.pilot.observeWorldInteractions(h.run);
  assert.equal(h.run.interactables.interact({ kind:'chest' }, identity), identity);
  assert.equal(h.run.interactables.altarDone({ kind:'altar' }), identity);
  assert.throws(() => h.run.interactables.altarDone({ kind:'altar', fail:true }), e => e === error);
  const events = records(h.pilot.battleRecorder).filter(e => e.type === 'world_interaction');
  assert.equal(calls, 3); assert.equal(events.length, 3); assert.equal(events[1].after.hp - events[1].before.hp, -5);
  assert.equal(events[0].resourceAttribution, 'unknown');
});

test('identical scoring is recorded once per decision; changed scores and eligibility are retained', () => {
  const h = harness(), modal = { run: h.run, kind: 'upgrade', offers: ['a', 'b'] };
  const decision = { action: 'choose', index: 0, candidates: [{ index: 0, score: 12 }] };
  for (let i = 0; i < 100; i++) h.r.evaluated(modal, decision, () => true);
  assert.equal(records(h.r).filter(r => r.type === 'decision_evaluated').length, 1);
  h.r.evaluated(modal, { ...decision, candidates: [{ index: 0, score: 13 }] }, () => true);
  h.r.evaluated(modal, decision, i => i === 1);
  assert.equal(records(h.r).filter(r => r.type === 'decision_evaluated').length, 3);
  h.r.evaluated({ ...modal }, decision, () => true);
  assert.equal(records(h.r).filter(r => r.type === 'decision_evaluated').length, 4);
});

test('event recording omits idle samples but keeps floor transitions, equipment and batched gold', () => {
  const h = harness({ detail: 'events' });
  for (let i = 0; i < 20; i++) { h.run.gold++; h.run.player.pos.x++; h.advance(.1); }
  assert.equal(records(h.r).filter(r => r.type === 'combat_summary').length, 0);
  assert.equal(records(h.r).filter(r => r.type === 'resource_delta').length, 0);
  h.advance(4);
  const gold = records(h.r).filter(r => r.type === 'gold_changed');
  assert.equal(gold.length, 1); assert.equal(gold[0].delta, 20);
  h.run.tower.floor = 2; h.advance(.1);
  assert.ok(records(h.r).some(r => r.type === 'floor_changed' && r.floor === 2));
  h.run.player.items.set('mystic-water', 1); h.advance(1);
  assert.ok(records(h.r).filter(r => r.type === 'loadout').length >= 2);
});

test('native hurt records shield loss and damage even if healing occurs before next heartbeat', () => {
  const h = harness({ detail: 'events' }), identity = {};
  h.run.player.shield = 10; h.run.player.dead = false;
  h.run.player.hurt = function () { this.hp -= 8; this.shield -= 3; h.run.stats.damageTaken += 8; return identity; };
  h.r.observe(h.run, h.pilot);
  assert.equal(h.run.player.hurt(), identity);
  h.run.player.hp = 100; h.advance(.1);
  const hurt = records(h.r).filter(r => r.type === 'damage_taken');
  assert.equal(hurt.length, 1); assert.equal(hurt[0].hpLost, 8); assert.equal(hurt[0].shieldLost, 3);
});

test('death and revival are separate events and spending is flushed at the decision boundary', () => {
  const h = harness({ detail: 'events' }); h.run.player.dead = false; h.r.observe(h.run, h.pilot);
  h.run.player.dead = true; h.run.player.hp = 0; h.advance(.1);
  h.run.player.dead = false; h.run.player.hp = 50; h.advance(.1);
  assert.equal(records(h.r).filter(r => r.type === 'player_died').length, 1);
  assert.equal(records(h.r).filter(r => r.type === 'player_revived').length, 1);
  const modal = { run: h.run, kind: 'shop', offers: ['x'] }, a = h.r.attempt(modal, 'buy');
  h.run.gold -= 7; h.r.receipt(a, h.run);
  assert.ok(records(h.r).some(r => r.type === 'gold_changed' && r.delta === -7));
});

test('critical events survive queue pressure, a failed write and later retransmission', () => {
  const h = harness({ detail: 'events', maxRecords: 6, maxBytes: 10000 });
  for (let i = 0; i < 100; i++) h.r.event('decision_receipt', { decisionId: 'choice-' + i, status: 'success' });
  assert.equal(records(h.r).filter(r => r.type === 'decision_receipt').length, 100);
  assert.equal(h.r.metrics.droppedEvents, 0);
  const first = h.sent[0].batch;
  h.r.acknowledge({ runId: first.runId, batchId: first.batchId, lastSeq: first.lastSeq, ok: false, error: 'disk-full' });
  let saved = 0;
  for (let i = 0; i < 1000 && h.r.queue.length; i++) {
    h.advance(3); const b = h.r.inflight;
    if (!b) continue;
    saved += b.records.filter(r => r.type === 'decision_receipt').length;
    h.r.acknowledge({ runId: b.runId, batchId: b.batchId, lastSeq: b.lastSeq, ok: true });
  }
  assert.equal(saved, 100); assert.equal(h.r.queue.length, 0);
});

test('durable outbox replays after recorder replacement and removes only a matching positive host ACK', async () => {
  // Substitute only browser storage; recording, ordering and ACK logic stay real.
  const stored = [];
  const outbox = { async put(batch) { if (!stored.some(b => b.batchId === batch.batchId)) stored.push(structuredClone(batch)); },
    async first() { return stored.length ? structuredClone(stored[0]) : null; },
    async remove(id) { const i = stored.findIndex(b => b.batchId === id); if (i >= 0) stored.splice(i, 1); } };
  const h = harness({ detail: 'events', outbox });
  for (let i = 0; i < 100; i++) h.r.event('decision_receipt', { decisionId: 'saved-' + i, status: 'success' });
  for (let i = 0; i < 30; i++) { h.r.pump(); await new Promise(resolve => setImmediate(resolve)); }
  assert.ok(stored.length > 0, 'batches must be durable before transport');
  const sent = [], replacement = new BattleRecorder({ outbox, send: m => sent.push(structuredClone(m)) });
  replacement.pump(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent[0].batch.batchId, stored[0].batchId);
  const first = sent[0].batch, n = stored.length;
  replacement.acknowledge({ runId: first.runId, batchId: first.batchId, lastSeq: first.lastSeq, ok: false, error: 'disk-full' });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(stored.length, n);
  let recovered = 0;
  for (let i = 0; i < 100 && stored.length; i++) {
    const b = replacement.inflight;
    if (b) {
      recovered += b.records.filter(r => r.type === 'decision_receipt').length;
      replacement.acknowledge({ runId: b.runId, batchId: b.batchId, lastSeq: b.lastSeq, ok: true });
    }
    replacement.pump(); await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(recovered, 100); assert.equal(stored.length, 0);
});

test('failed outbox transaction retains critical records in memory and retries with unchanged event identity', async () => {
  let failed = true; const stored = [], outbox = {
    async put(b) { if (failed) throw Error('quota'); stored.push(structuredClone(b)); },
    async first() { return null; }, async remove() {} };
  const h = harness({ detail: 'events', outbox });
  h.r.event('player_died', { hp: 0 });
  const deathSeq = records(h.r).find(r => r.type === 'player_died').seq;
  h.r.pump(); await new Promise(resolve => setImmediate(resolve));
  assert.ok(records(h.r).some(r => r.seq === deathSeq)); assert.equal(h.r.metrics.droppedEvents, 0);
  failed = false;
  for (let i = 0; i < 30; i++) { h.r.pump(); await new Promise(resolve => setImmediate(resolve)); }
  assert.ok(stored.some(b => b.records.some(r => r.seq === deathSeq && r.type === 'player_died')));
});

test('nested native UI wrappers record each actual callback once without changing the selected value', () => {
  const h = fixture(); h.open('itemChoice', ['leftovers']); h.tick();
  const es = records(h.pilot.battleRecorder);
  assert.equal(es.filter(r => r.type === 'native_choice').length, 1);
  assert.equal(es.filter(r => r.type === 'native_choice_return').length, 1);
  assert.deepEqual(h.chosen, ['leftovers']);
});

test('oversized diagnostic context cannot discard the selected action or poison critical transport', () => {
  const h = harness({ detail: 'events', maxBytes: 10000 });
  h.r.event('decision_evaluated', { decisionId: 'large', decision: { action: 'choose', index: 2, score: 7, reason: 'better' }, diagnostic: 'x'.repeat(300000) });
  const e = records(h.r).find(r => r.type === 'decision_evaluated');
  assert.ok(e); assert.equal(e.decision.index, 2); assert.equal(e.decision.action, 'choose');
  assert.equal(e.diagnosticTruncated, true); assert.equal(h.r.metrics.droppedEvents, 0);
});

test('native item revival inside hurt is captured without requiring a transient dead flag or inventing a death', () => {
  const h = harness({ detail: 'events' }), identity = {}; let calls = 0;
  // The reviewed native hurt path sets HP then calls run.revived(item).
  h.run.revived = function (item) { calls++; assert.equal(this, h.run); assert.equal(item, 'max-revive'); return identity; };
  h.run.player.dead = false;
  h.run.player.hurt = function () { this.hp = 60; h.run.stats.damageTaken += 120; assert.equal(h.run.revived('max-revive'), identity); return true; };
  h.r.observe(h.run, h.pilot); assert.equal(h.run.player.hurt(), true);
  assert.equal(calls, 1);
  const es = records(h.r); assert.equal(es.filter(e => e.type === 'player_died').length, 0);
  const revives = es.filter(e => e.type === 'player_revived'); assert.equal(revives.length, 1); assert.equal(revives[0].source, 'max-revive');
});

test('health hooks follow a reused player into the next native run', () => {
  const h = harness({ detail: 'events' });
  h.run.player.hurt = function () { this.hp -= 3; return true; }; h.r.observe(h.run, h.pilot);
  const next = { ...h.run, time: 0 }; h.r.observe(next, h.pilot);
  next.player.hurt(); next.player.hp += 3;
  assert.ok(records(h.r).some(e => e.runId === h.r.runId && e.type === 'damage_taken' && e.hpLost === 3));
});
