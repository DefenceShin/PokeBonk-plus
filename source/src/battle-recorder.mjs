// Independent local audit stream. No native RNG, scoring, inputs or account data.
// Persist transport batches before sending; the host's durable ACK is the only
// operation that removes them. A new document can replay the previous backlog.
export class BattleRecordOutbox {
  constructor(indexedDB = globalThis.indexedDB) { this.indexedDB = indexedDB; this.connection = null; }
  open() {
    if (!this.connection) this.connection = new Promise((resolve, reject) => {
      const request = this.indexedDB.open('pokebonk-battle-outbox-v1', 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('batches', { keyPath: 'order', autoIncrement: true });
        store.createIndex('batchId', 'batchId', { unique: true });
      };
      request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); this.connection = null; }; resolve(db); };
      request.onerror = () => { this.connection = null; reject(request.error); };
      request.onblocked = () => { this.connection = null; reject(Error('outbox-open-blocked')); };
    });
    return this.connection;
  }
  async transaction(mode, action) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('batches', mode, mode === 'readwrite' ? { durability: 'strict' } : undefined);
      let value; tx.oncomplete = () => resolve(value); tx.onabort = tx.onerror = () => reject(tx.error || Error('outbox-transaction-failed'));
      action(tx.objectStore('batches'), result => { value = result; });
    });
  }
  async put(batch) {
    // Raw native tickets are transport-only and never enter persistent storage.
    const durable = { ...batch }; delete durable.reportTicket;
    if (!durable.reportId) {
      const ticket = batch.reportTicket;
      const input = ticket ? `pokebonk-report:${ticket}` : batch.runId;
      const hash = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
      durable.reportId = `${ticket ? 'run' : 'observation'}-${Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('').slice(0, 24)}`;
    }
    await this.transaction('readwrite', store => {
      const find = store.index('batchId').getKey(durable.batchId);
      find.onsuccess = () => { if (find.result === undefined) store.add({ batchId: durable.batchId, batch: durable }); };
    });
  }
  first() { return this.transaction('readonly', (store, done) => { const r = store.openCursor(); r.onsuccess = () => done(r.result?.value.batch ?? null); }); }
  remove(id) { return this.transaction('readwrite', store => { const r = store.index('batchId').getKey(id); r.onsuccess = () => { if (r.result !== undefined) store.delete(r.result); }; }); }
}

export class BattleRecorder {
  constructor({ revision = null, sourceHash = null, send = null, wall = () => Date.now(),
    maxRecords = 2048, maxBytes = 4 * 1024 * 1024, sampleSeconds = 1, detail = 'events',
    outbox = globalThis.indexedDB ? new BattleRecordOutbox() : null } = {}) {
    this.revision = revision; this.sourceHash = sourceHash; this.send = send; this.enabled = true;
    this.publicModules=[];this.publicModuleFingerprint=null;
    this.uiBindings = new WeakMap();
    this.healthBindings = new WeakMap(); this.detail = detail; this.outbox = outbox;
    this.spooling = null; this.delivering = null; this.removing = null; this.pendingSpool = null;
    this.eventSignatures = new Map(); this.healthState = null; this.goldState = null; this.goldPending = null;
    this.wall = wall; this.maxRecords = maxRecords; this.maxBytes = maxBytes;
    this.sampleSeconds = sampleSeconds; this.queue = []; this.bytes = 0;
    this.seq = 0; this.serial = 0; this.batchSerial = 0; this.decisionSerial = 0;
    this.documentId = globalThis.crypto?.randomUUID?.() || `local-${wall()}-${performance.now()}`;
    this.run = null; this.runId = null; this.segment = 0; this.pages = new WeakMap();
    this.reportTickets = new Map();
    this.pending = null; this.losses = new Map(); this.inflight = null; this.lastSent = -Infinity;
    this.last = null; this.lastBattle = null; this.ended = false; this.loadoutRevision = 0;
    this.metrics = { droppedSamples: 0, droppedEvents: 0, errors: 0, transportErrors: 0, storageFailureAcks: 0,
      peakRecords: 0, peakBytes: 0, ackedSeq: 0, writerError: null, suppressedDuplicates: 0,
      durableBatches: 0, outboxErrors: 0, outboxError: null };
  }
  safe(action) { try { return action(); } catch { this.metrics.errors++; return null; } }
  setProvenance(revision, sourceHash, publicModules=this.publicModules) {
    this.safe(() => {
      const modules=this.plain(publicModules)||[],moduleKey=JSON.stringify(modules),
        changed = this.revision !== revision || this.sourceHash !== sourceHash||moduleKey!==JSON.stringify(this.publicModules);
      if (!changed) return;
      const previous = { controllerRevision: this.revision, sourceHash: this.sourceHash };
      if (this.last && this.run?.time > this.last.gameSeconds) this.event('combat_summary', {
        from: this.last.gameSeconds, to: this.run.time, seconds: this.run.time - this.last.gameSeconds,
        intervalFloor: this.last.floor === this.run.tower?.floor ? this.last.floor : null,
        phase: 'unknown', coverage: 'gap', killsDelta: null, damageTakenDelta: null,
        hpMinimumSampled: null, reason: 'provenance-change-boundary' }, 'sample');
      this.revision = revision; this.sourceHash = sourceHash;
      this.publicModules=modules;this.publicModuleFingerprint=this.fingerprint(moduleKey);
      if (this.runId) { this.segment++; this.last = null; this.event('segment_start', { reason: 'provenance-change', previous,publicModules:this.publicModules }); }
    });
  }
  bindUi(pilot) {
    const ui = pilot.app?.run?.ui; if (!ui) return;
    this.uiBindings ||= new WeakMap();
    let bound = this.uiBindings.get(ui); if (!bound) this.uiBindings.set(ui, bound = new Map());
    const methods = [['showLevelUp', 'upgrade', 1, 2], ['showBlessing', 'blessing', 2, 3],
      ['showItemChoice', 'itemChoice', 1, 2], ['showItem', 'item', 1, 2], ['showPact', 'pact', 1, 2],
      ['showTrade', 'trade', 1, 2], ['showFusion', 'fusion', 1, 2], ['showShop', 'shop', -1, 1],
      ['showDitto', 'ditto', -1, 1], ['showBranch', 'branch', 1, 2], ['showParty', 'party', 1, 2],
      ['showForget', 'forget', -1, 1], ['showSlots', 'slots', 1, 2],['relicChoice','relic',1,2]];
    for (const [method, kind, index, callbackIndex] of methods) {
      if (typeof ui[method] !== 'function' || bound.get(method) === ui[method]) continue;
      const original = ui[method], recorder = this;
      const wrapped = function (...args) {
        let modal = null;
        recorder.safe(() => {
          if (!recorder.enabled || args[0] !== pilot.app?.run) return;
          recorder.observe(args[0], pilot, true);
          modal = { kind, run: args[0], offers: kind === 'shop' ? args[0].shop?.stock :
            kind === 'ditto' ? [...(args[0].player?.items?.keys?.() || [])] : args[index],
            entity: pilot.currentWorldInteractionScope?.(args[0])?.entity || null };
          recorder.page(modal);
        });
        if (modal && typeof args[callbackIndex] === 'function') {
          const native = args[callbackIndex];
          args[callbackIndex] = function (...values) {
            return recorder.nativeCallback(modal, values, () => native.apply(this, values));
          };
        }
        const result = original.apply(this, args);
        recorder.safe(() => { if (modal && pilot.modal?.run === args[0]) recorder.pages.set(pilot.modal, recorder.pages.get(modal)); });
        return result;
      };
      // The existing pilot UI hook marker must survive so attachRun does not nest it.
      if (original.__pbWrapped) wrapped.__pbWrapped = true;
      ui[pilot.nativeMemberKey?.(ui,method)??method] = wrapped; bound.set(method, wrapped);
    }
  }
  // Narrow DTO: reject functions, objects with cycles, and unbounded graph traversal.
  plain(value, depth = 0, seen = new Set()) {
    if (value == null || ['string', 'boolean'].includes(typeof value)) return value ?? null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'object' || depth > 8 || seen.has(value)) return null;
    seen.add(value);
    let out;
    if (value instanceof Map || typeof value.entries === 'function' && !Array.isArray(value) && !ArrayBuffer.isView(value))
      out = [...value.entries()].map(([key, v]) => [String(key), this.plain(v, depth + 1, seen)]);
    else if (Array.isArray(value) || ArrayBuffer.isView(value)) out = Array.from(value, v => this.plain(v, depth + 1, seen));
    else out = Object.fromEntries(Object.keys(value).filter(k => !['run', 'app', 'meta', 'account', 'profile', 'root', 'terrain', 'entity'].includes(k))
      .map(k => [k, this.plain(value[k], depth + 1, seen)]));
    seen.delete(value); return out;
  }
  number(v) { return typeof v === 'number' && Number.isFinite(v) ? v : null; }
  nativeContext(run=this.run){
    const inside=run?.rifts?.inside;
    return {mapId:run?.biome?.id??null,nativeMode:run?.mode??null,epoch:run?.sanctuary?.epoch??null,
      rift:inside?{phase:inside.phase??null,type:inside.type??null,tier:this.number(inside.tier),
        wave:this.number(inside.wave),alphaId:this.number(inside.alphaId),alpha:this.plain(inside.alpha)}:null};
  }
  header(type, payload, stream = 'event') {
    return { schemaVersion: 1, classifierVersion: 1, controllerRevision: this.revision,
      sourceHash: this.sourceHash, runId: this.runId, segmentId: this.segment,
      seq: ++this.seq, gameSeconds: this.number(this.run?.time), wallTime: new Date(this.wall()).toISOString(),
      floor: this.number(this.run?.tower?.floor), wave: this.number(this.run?.tower?.wave),
      towerBeyond: typeof this.run?.tower?.beyond === 'boolean' ? this.run.tower.beyond : null,
      nativeStage: this.number(this.run?.stage),
      ...this.nativeContext(),publicModuleFingerprint:this.publicModuleFingerprint,
      type, stream, ...payload };
  }
  drop(record) {
    const key = record.stream === 'sample' ? 'droppedSamples' : 'droppedEvents'; this.metrics[key]++;
    const scope = `${record.runId}:${record.segmentId}`;
    if (!this.losses.has(scope)) this.losses.set(scope, { runId: record.runId, segmentId: record.segmentId,
      fromSeq: record.seq, toSeq: record.seq, samples: 0, events: 0,
      fromGameSeconds: record.gameSeconds, toGameSeconds: record.gameSeconds });
    const lost = this.losses.get(scope);
    lost.toSeq = Math.max(lost.toSeq, record.seq); lost.fromSeq = Math.min(lost.fromSeq, record.seq);
    lost.toGameSeconds = record.gameSeconds; lost[record.stream === 'sample' ? 'samples' : 'events']++;
  }
  critical(type) {
    return /^(decision_|native_choice|player_|damage_taken$|gold_changed$|run_|observation_|segment_|integrity_|storage_|outbox_|loadout$|configuration$|floor_changed$|world_interaction$|item_evaluation$|shop_evaluation$|copy_evaluation$)/.test(type);
  }
  compactCritical(record) {
    const scalar = object => Object.fromEntries(Object.entries(object || {}).filter(([, v]) => v == null || ['boolean', 'number'].includes(typeof v) || typeof v === 'string' && v.length <= 512));
    const result = scalar(record);
    for (const key of ['decision', 'before', 'after', 'finalObserved', 'lastBattle', 'loss'])
      if (record[key] && typeof record[key] === 'object') result[key] = scalar(record[key]);
    result.diagnosticTruncated = true;
    result.diagnosticLimit = 'oversized-context-omitted; essential-event-and-action-retained';
    this.metrics.compactedCritical = (this.metrics.compactedCritical || 0) + 1;
    return result;
  }
  event(type, payload = {}, stream = 'event') {
    return this.safe(() => {
      if (!this.runId || !this.enabled) return null;
      const data = this.plain(payload);
      // Deduplicate observational output only. Policy evaluation still runs at
      // its original cadence and no action/callback/retry is suppressed.
      let signatureKey = null, signature = null;
      if (['decision_evaluated', 'item_evaluation', 'shop_evaluation', 'copy_evaluation'].includes(type) && data?.decisionId) {
        this.eventSignatures ||= new Map();
        signatureKey = `${type}:${data.decisionId}`; signature = JSON.stringify(data);
        if (this.eventSignatures.get(signatureKey) === signature) { this.metrics.suppressedDuplicates++; return null; }
      }
      let record = this.header(type, data, stream), bytes = JSON.stringify(record).length * 2;
      if (this.critical(type) && bytes > 240 * 1024) { record = this.compactCritical(record); bytes = JSON.stringify(record).length * 2; }
      if (!this.critical(type) && bytes > Math.min(this.maxBytes, 240 * 1024)) { this.drop(record); return record; }
      while (this.queue.length >= this.maxRecords || this.bytes + bytes > this.maxBytes) {
        const protectedSeq = Math.max(this.outbox ? 0 : this.inflight?.lastSeq ?? 0, this.pendingSpool?.lastSeq ?? 0);
        let index = this.queue.findIndex(e => e.record.seq > protectedSeq && e.record.stream === 'sample');
        if (index < 0 && stream !== 'sample') index = this.queue.findIndex(e => e.record.seq > protectedSeq && !this.critical(e.record.type));
        if (index < 0) {
          // Never evict unacknowledged critical events. During an outbox write
          // failure they stay in memory, with a visible storage failure status.
          if (this.critical(type)) break;
          this.drop(record); return record;
        }
        const [removed] = this.queue.splice(index, 1); this.bytes -= removed.bytes; this.drop(removed.record);
      }
      this.queue.push({ record, bytes, reportTicket: this.reportTickets?.get(record.runId) ?? null }); this.bytes += bytes;
      if (signatureKey) { this.eventSignatures.set(signatureKey, signature); if (this.eventSignatures.size > 128) this.eventSignatures.delete(this.eventSignatures.keys().next().value); }
      this.metrics.peakRecords = Math.max(this.metrics.peakRecords, this.queue.length);
      this.metrics.peakBytes = Math.max(this.metrics.peakBytes, this.bytes);
      if (this.outbox && (this.queue.length >= this.maxRecords || this.bytes >= this.maxBytes)) this.pump();
      return record;
    });
  }
  status() { return { enabled: this.enabled, runId: this.runId, segmentId: this.segment, queued: this.queue.length, queuedBytes: this.bytes,
    pendingBatch: this.inflight?.batchId ?? null, detail: this.detail ?? 'full', durableOutbox: !!this.outbox,
    lossPending: [...this.losses.values()], ...this.metrics }; }
  batch() {
    if (!this.queue.length) return null;
    const records = [], runId = this.queue[0].record.runId; let bytes = 0;
    for (const entry of this.queue) {
      if (entry.record.runId !== runId || records.length >= 64 || bytes + entry.bytes > 240 * 1024 && records.length) break;
      records.push(entry.record); bytes += entry.bytes;
    }
    return { schemaVersion: 1, runId, reportTicket: this.queue[0].reportTicket ?? null,
      batchId: `${runId}-${++this.batchSerial}`, firstSeq: records[0].seq, lastSeq: records.at(-1).seq, records };
  }
  removeQueued(lastSeq) {
    while (this.queue.length && this.queue[0].record.seq <= lastSeq) this.bytes -= this.queue.shift().bytes;
  }
  outboxFailure(operation) {
    this.metrics.outboxErrors++;
    const error = `local-outbox-${operation}-failed`;
    if (this.metrics.outboxError !== error) this.event('outbox_error', { operation, error, unconfirmedEventsRetained: true });
    this.metrics.outboxError = error;
  }
  pumpOutbox() {
    if (!this.spooling && this.queue.length) {
      const batch = this.pendingSpool ||= this.batch();
      this.spooling = Promise.resolve().then(() => this.outbox.put(batch)).then(() => {
        this.removeQueued(batch.lastSeq); this.pendingSpool = null; this.metrics.durableBatches++;
        if (this.metrics.outboxError) this.event('outbox_recovered', { previousError: this.metrics.outboxError });
        this.metrics.outboxError = null;
      }).catch(() => { this.outboxFailure('write'); })
        .finally(() => { this.spooling = null; });
    }
    if (!this.send || this.removing || this.delivering) return;
    this.delivering = Promise.resolve().then(async () => {
      if (!this.inflight) this.inflight = await this.outbox.first();
      if (!this.inflight || this.wall() - this.lastSent < 2000) return;
      this.lastSent = this.wall();
      try { this.send({ kind: 'battleRecords', batch: this.inflight }); }
      catch { this.metrics.transportErrors++; }
    }).catch(() => { this.outboxFailure('read'); })
      .finally(() => { this.delivering = null; });
  }
  pump() {
    return this.safe(() => {
      if (this.losses.size && this.queue.length < this.maxRecords - 2 && this.bytes < this.maxBytes / 2) {
        const [scope, loss] = this.losses.entries().next().value; this.losses.delete(scope);
        // Marker is emitted in the current run but names the original lost run/segment.
        this.event('integrity_gap', { runId: loss.runId, segmentId: loss.segmentId,
          reason: 'queue-overflow', affectedRunId: loss.runId, affectedSegmentId: loss.segmentId, loss });
      }
      if (this.outbox) { this.pumpOutbox(); return; }
      const now = this.wall(); if (!this.send || now - this.lastSent < (this.inflight ? 2000 : 100)) return;
      if (!this.inflight) {
        if (!this.queue.length) return;
        this.inflight = this.batch();
      }
      this.lastSent = now;
      try { this.send({ kind: 'battleRecords', batch: this.inflight }); }
      catch { this.metrics.transportErrors++; }
    });
  }
  acknowledge(ack) {
    const batch = this.inflight;
    if (!batch || ack?.batchId !== batch.batchId || ack.runId !== batch.runId || ack.lastSeq !== batch.lastSeq) return false;
    if (ack.ok !== true) {
      this.metrics.storageFailureAcks++;
      const error = ack.error || 'write-failed';
      if (this.metrics.writerError !== error) this.event('storage_error', { affectedRunId: ack.runId,
        affectedBatchId: ack.batchId, error, pendingDurableSeq: ack.lastSeq });
      this.metrics.writerError = error; return false;
    }
    if (this.metrics.writerError) this.event('storage_recovered', { affectedRunId: ack.runId,
      affectedBatchId: ack.batchId, previousError: this.metrics.writerError, failureAcks: this.metrics.storageFailureAcks });
    this.metrics.ackedSeq = batch.lastSeq; this.metrics.writerError = null;
    if (this.outbox) {
      if (!this.removing) this.removing = Promise.resolve().then(() => this.outbox.remove(batch.batchId)).then(() => {
        if (this.inflight === batch) this.inflight = null;
        this.lastSent = -Infinity;
      }).catch(() => { this.outboxFailure('delete'); })
        .finally(() => { this.removing = null; });
    } else { this.removeQueued(batch.lastSeq); this.inflight = null; this.lastSent = -Infinity; }
    return true;
  }
  loadout(run) {
    const p = run.player;
    return { moves: (p.moves || []).map((m, slot) => m ? { slot, key: m.def?.key || m.key || null,
      level: this.number(m.level), stars: this.number(m.stars), parents: this.plain(m.parents),
      arch: m.def?.arch ?? null,
      fusion: m.def?.arch === 'fusion' ? true : typeof m.def?.fusion === 'boolean' ? m.def.fusion : null,
      link:m.link?{key:m.link.def?.key??m.link.key??null,level:this.number(m.link.level),
        stars:this.number(m.link.stars),parents:this.plain(m.link.parents),arch:m.link.def?.arch??null}:null } : null),
      vitamins: [...(p.vitamins?.entries?.() || [])].map(([key, v]) => ({ key,
        level: this.number(typeof v === 'object' ? v?.level : v), acc: this.number(v?.acc) })),
      items: [...(p.items?.entries?.() || [])].map(([key, v]) => ({ key, count: this.number(typeof v === 'object' ? v?.count : v) })),
      relicKeys:this.plain(run.relicKeys||[]),stats: this.plain(p.stats), level: this.number(p.level) };
  }
  phase(run, pilot) {
    if (run.state !== 'play') return 'other';
    if (run.tower && !['clear', 'roof'].includes(run.tower.state)) return 'wave-active';
    if (pilot.towerCleanupState && run.tower && pilot.towerCleanupState.floor === run.tower.floor) {
      if (pilot.towerCleanupState.phase === 'rewards') return 'cleared-rewards';
      if (pilot.towerCleanupState.phase === 'experience') return 'experience-cleanup';
      if (['complete', 'timed-out'].includes(pilot.towerCleanupState.phase)) return 'stairs-wait';
    }
    return 'unknown';
  }
  observeHealth(run, source = null) {
    const p = run.player, current = { hp: this.number(p.hp), shield: this.number(p.shield),
      dead: typeof p.dead === 'boolean' ? p.dead : Number.isFinite(p.hp) ? p.hp <= 0 : null,
      damage: this.number(run.stats?.damageTaken) }, before = this.healthState;
    this.healthState = current;
    if (!before) return;
    const hpLost = before.hp == null || current.hp == null ? null : Math.max(0, before.hp - current.hp);
    const shieldLost = before.shield == null || current.shield == null ? null : Math.max(0, before.shield - current.shield);
    const damageDelta = before.damage == null || current.damage == null || current.damage < before.damage ? null : current.damage - before.damage;
    if (hpLost > 0 || shieldLost > 0 || damageDelta > 0) this.event('damage_taken', {
      hpBefore: before.hp, hpAfter: current.hp, hpLost, shieldBefore: before.shield, shieldAfter: current.shield,
      shieldLost, damageDelta, source, sourceAttribution: source ? 'native-hurt-argument' : 'unknown',
      observation: source ? 'native-hurt-return' : 'state-delta', loadoutRevision: this.loadoutRevision });
    if (current.dead === true && before.dead === false) this.event('player_died', { hp: current.hp, loadoutRevision: this.loadoutRevision });
    if (current.dead === false && before.dead === true) this.event('player_revived', { hp: current.hp, loadoutRevision: this.loadoutRevision });
    return { revived: current.dead === false && before.dead === true };
  }
  bindHealth(run,pilot={}) {
    this.healthBindings ||= new WeakMap();
    const owners = [[run.player, 'player', ['hurt', 'die', 'revive', 'rebirth']], [run, 'run', ['revived', 'onPlayerDeath']], [run.coop, 'coop', ['revive']]];
    for (const [owner, scope, names] of owners) {
      if (!owner || !['object', 'function'].includes(typeof owner)) continue;
      let methods = this.healthBindings.get(owner); if (!methods) this.healthBindings.set(owner, methods = new Map());
      for (const method of names) {
      let native = owner[method]; const bound = methods.get(method);
      if (typeof native !== 'function' || bound?.wrapped === native && bound.run === run) continue;
      if (bound?.wrapped === native) native = bound.original;
      const recorder = this;
      const wrapped = function (...args) {
        // Observer failures must never skip, repeat or replace the native call.
        recorder.safe(() => { if (recorder.run === run && recorder.enabled) recorder.observeHealth(run); });
        let completed = false;
        try { const result = native.apply(this, args); completed = true; return result; }
        finally { recorder.safe(() => {
          if (recorder.run !== run || !recorder.enabled) return;
          const source = method === 'hurt' && args[7] && typeof args[7] === 'object'
            ? { kind: args[7].kind ?? null, species: args[7].species ?? null } : null;
          const transition = recorder.observeHealth(run, source);
          if (completed && ['revived', 'revive', 'rebirth'].includes(method) && !transition?.revived)
            recorder.event('player_revived', { hp: recorder.number(run.player.hp), nativeMethod: `${scope}.${method}`,
              source: method === 'revived' && ['revive', 'max-revive'].includes(args[0]) ? args[0] : method === 'rebirth' ? 'rainbow-wing' : null,
              evidence: 'native-revival-returned', loadoutRevision: recorder.loadoutRevision });
          recorder.pump();
        }); }
      };
      if (native.__pbCombat) wrapped.__pbCombat = true;
      owner[pilot.nativeMemberKey?.(owner,method)??method] = wrapped; methods.set(method, { wrapped, original: native, run });
      }
    }
  }
  observeGold(run, force = false, reason = 'interval') {
    const gold = this.number(run?.gold); if (gold == null) return;
    const previous = this.goldState;
    if (!previous) { this.goldState = { value: gold, time: run.time, floor: run.tower?.floor ?? null }; return; }
    if (previous.value !== gold) {
      this.goldPending ||= { from: previous.time, goldBefore: previous.value, gained: 0, spent: 0, floor: previous.floor };
      const delta = gold - previous.value;
      this.goldPending.gained += Math.max(0, delta); this.goldPending.spent += Math.max(0, -delta);
    }
    this.goldState = { value: gold, time: run.time, floor: run.tower?.floor ?? null };
    const pending = this.goldPending;
    if (!pending || !(force || gold < previous.value || pending.floor !== this.goldState.floor || run.time - pending.from >= 5)) return;
    this.event('gold_changed', { from: pending.from, to: run.time, goldBefore: pending.goldBefore, goldAfter: gold,
      intervalFloor: pending.floor === this.goldState.floor ? pending.floor : null,
      delta: gold - pending.goldBefore, gainedObserved: pending.gained, spentObserved: pending.spent,
      reason, attribution: 'unknown-unless-native-receipt-proves-source' });
    this.goldPending = null;
  }
  frame(run, pilot = {}, includeLoadout = false) {
    const p = run.player, pos = p.pos || {}, target = pilot.target;
    const frame = { gameSeconds: this.number(run.time), floor: this.number(run.tower?.floor),
      wave: this.number(run.tower?.wave), towerState: run.tower?.state ?? null, state: run.state ?? null,
      ...this.nativeContext(run),phase: this.phase(run, pilot), gold: this.number(run.gold), hp: this.number(p.hp), maxHp: this.number(p.maxHp),
      kills: this.number(run.stats?.kills), damageTaken: this.number(run.stats?.damageTaken),
      position: { x: this.number(pos.x), y: this.number(pos.y), z: this.number(pos.z) },
      target: target ? { id: target.id ?? null, kind: target.entity?.kind ?? null,
        distance: [pos.x, pos.z, target.x, target.z].every(Number.isFinite) ? Math.hypot(pos.x - target.x, pos.z - target.z) : null } : null,
      cleanup: this.plain(pilot.towerCleanupState), navigation: { reason: pilot.tacticalReason ?? null,
        blockedCount: this.number(pilot.blocked?.size) },
      loadoutRevision: this.loadoutRevision, ...(includeLoadout ? { loadout: this.loadout(run) } : {}) };
    if (this.detail === 'events') for (const key of ['position', 'target', 'cleanup', 'navigation']) delete frame[key];
    return frame;
  }
  observe(run, pilot = {}, force = false) {
    return this.safe(() => {
      if (!this.enabled) { this.pump(); return; }
      const actualHash = pilot.bridge?.compatibility?.sourceHash ?? pilot.compatibility?.sourceHash;
      if (typeof actualHash === 'string') this.setProvenance(this.revision, actualHash,
        pilot.bridge?.compatibility?.publicModules??pilot.compatibility?.publicModules??this.publicModules);
      this.bindUi(pilot);
      if (!run?.player || !Number.isFinite(run.time)) {
        if (this.run && !this.detached) {
          if (this.detail === 'events') this.observeGold(this.run, true, 'observation-end');
          this.event('observation_detached', { continuation: 'unknown', lastBattle: this.lastBattle }); this.detached = true;
        }
        this.pump(); return;
      }
      if (run !== this.run) {
        if (this.run && this.detail === 'events') this.observeGold(this.run, true, 'run-replaced');
        if (this.run && !this.ended) this.event('observation_end', { result: 'unknown', reason: 'run-replaced', lastBattle: this.lastBattle });
        this.run = run; this.runId = `${this.documentId}-${++this.serial}`.replace(/[^a-zA-Z0-9_-]/g, '-');
        // Transport-only correlation. The host hashes this before any write;
        // capture now so a delayed batch cannot use the following run's ticket.
        this.reportTickets ||= new Map();
        const ticket=run.meta?.ticket?.id ?? pilot.app?.meta?.ticket?.id;
        this.reportTickets.set(this.runId,typeof ticket==='string'&&ticket.length<=256?ticket:null);
        if(this.reportTickets.size>512)this.reportTickets.delete(this.reportTickets.keys().next().value);
        this.segment = 1; this.last = null; this.lastBattle = null; this.ended = false; this.detached = false;
        this.lastLoadout = null; this.lastInventory = null; this.lastConfig = null; this.lastBoundary = null;
        this.loadoutRevision = 0; this.pending = null;
        this.healthState = null; this.goldState = null; this.goldPending = null;
        this.event('run_observed', { publicModules:this.publicModules,observationStart: run.time, startsAtZero: run.time === 0,
          priorGameSeconds: run.time > 0 ? { from: 0, to: run.time, attribution: 'unknown' } : null,
          continuation: 'unknown', nativeIdentityPersisted: false, capabilities: {
            actualDamageBySkill: 'unknown', enemyVisibility: 'unknown', tombstoneRandomResult: 'unknown',
            selectionReceipt: 'native-callback-and-observed-delta', hpMinimum: 'sampled-only',
            recordingDetail: this.detail ?? 'full', routinePositionSamples: this.detail === 'events' ? false : true } });
      }
      this.bindHealth(run,pilot); this.observeHealth(run);
      if (this.detail === 'events') this.observeGold(run, run.state === 'over', run.state === 'over' ? 'run-ended' : 'interval');
      if (this.detached) { this.event('integrity_gap', { reason: 'observation-resumed', from: this.last?.gameSeconds ?? null, to: run.time }); this.detached = false; this.resumedGap = true; }
      const prev = this.last;
      if (prev && (run.time < prev.gameSeconds ||
        Number.isFinite(run.stats?.kills) && prev.kills != null && run.stats.kills < prev.kills ||
        Number.isFinite(run.stats?.damageTaken) && prev.damageTaken != null && run.stats.damageTaken < prev.damageTaken)) {
        this.segment++; this.event('segment_start', { reason: 'clock-or-counter-reset', previousGameSeconds: prev.gameSeconds }); this.last = null;
      }
      const boundary = JSON.stringify([run.state,run.stage,this.nativeContext(run),run.relicKeys,
        (run.player.moves||[]).map(m=>m?.link?[m.link.def?.key??m.link.key,m.link.level,m.link.stars]:null),
        run.tower?.floor, run.tower?.wave, run.tower?.state, pilot.towerCleanupState?.phase]);
      const changed = boundary !== this.lastBoundary;
      if (!force && !changed && this.last && run.time - this.last.gameSeconds < this.sampleSeconds - 1e-9) { this.pump(); return; }
      const current = this.frame(run, pilot), before = this.last;
      const loadout = this.loadout(run), loadoutKey = JSON.stringify(loadout);
      // A compact signature prevents repeating full equipment in samples.
      const inventory = JSON.stringify([loadout.items,loadout.relicKeys]), skills = JSON.stringify([loadout.moves, loadout.vitamins]);
      if (skills !== this.lastSkills || inventory !== this.lastInventory || !before || changed && current.floor !== before.floor) {
        this.loadoutRevision++; current.loadoutRevision = this.loadoutRevision;
        this.event('loadout', { loadoutRevision: this.loadoutRevision, loadout,
          changes: this.lastLoadout ? { before: this.lastLoadout, after: loadout } : null,
          milestones: loadout.moves.filter(m => m && m.level >= 8).map(m => ({ key: m.key, level: m.level, threshold: 8 })),
          coreCompletion: 'unknown-without-plan-rule-evaluation' });
        if (this.lastLoadout) for (const move of loadout.moves.filter(Boolean)) {
          const prior = this.lastLoadout.moves.find(m => m?.slot === move.slot && m.key === move.key);
          if (!prior) this.event('move_learned', { move, fusion: move.fusion === true ? 'observed' : 'unknown', loadoutRevision: this.loadoutRevision });
          if (!prior && move.fusion === true) this.event('fusion_observed', { move, loadoutRevision: this.loadoutRevision });
          if (prior && move.fusion === true && move.level !== prior.level) this.event('fusion_level_changed', { before: prior, after: move });
          if (move.level >= 8 && (!prior || prior.level < 8)) this.event('move_level8', { move, loadoutRevision: this.loadoutRevision });
          if (prior && prior.stars !== move.stars) this.event('move_stars_changed', { before: prior, after: move });
        }
        if (this.lastLoadout && JSON.stringify(this.lastLoadout.vitamins) !== JSON.stringify(loadout.vitamins))
          this.event('vitamins_changed', { before: this.lastLoadout.vitamins, after: loadout.vitamins, coreCompletion: 'unknown' });
      }
      this.lastSkills = skills;
      const config = JSON.stringify({ settings: pilot.settings ?? null, build: pilot.plan?.build ?? null });
      if (this.lastConfig !== config) {
        const build=pilot.plan?.build,selected=pilot.settings?.build,
          selectedId=typeof selected==='string'?selected:selected?.id ?? null,
          id=build?.id ?? null;
        this.event('configuration', { fingerprint: this.fingerprint(config),
        previousFingerprint: this.lastConfig ? this.fingerprint(this.lastConfig) : null,
        activePlan:this.plain({id,name:build?.name ?? null,selectedId,
          selectionMatches:id && selectedId ? id===selectedId:null,
          itemRuleCount:Array.isArray(build?.itemRules)?build.itemRules.length:0,
          moves:(build?.moves || []).map(move=>typeof move==='string'?move:move?.key).filter(Boolean),
          status:build?'resolved-active-plan':'not-resolved'}),
        actual: this.plain({ settings: pilot.settings, build: pilot.plan?.build }), hashAlgorithm: 'fnv1a32-noncryptographic' }); this.lastConfig = config; }
      if (this.detail !== 'events' && before && (before.gold !== current.gold || inventory !== this.lastInventory)) {
        this.event('resource_delta', { from: before.gameSeconds, to: current.gameSeconds,
          intervalFloor: before.floor === current.floor ? current.floor : null,
          fromFloor: before.floor, toFloor: current.floor,
          goldBefore: before.gold, goldAfter: current.gold,
          goldDelta: before.gold == null || current.gold == null ? null : current.gold - before.gold,
          itemsBefore: this.lastLoadout?.items ?? null, itemsAfter: loadout.items,
          attribution: 'unknown', reason: 'interval-observation-may-contain-multiple-sources' });
      }
      if (this.detail === 'events' && before && before.floor !== current.floor)
        this.event('floor_changed', { previousFloor: before.floor, gold: current.gold, hp: current.hp, level: loadout.level, loadoutRevision: this.loadoutRevision });
      if (this.detail !== 'events' && changed) this.event('boundary', { previous: before ? { floor: before.floor, wave: before.wave,
        towerState: before.towerState, phase: before.phase, state: before.state, gameSeconds: before.gameSeconds } : null, current });
      if (this.detail !== 'events' && before && before.gameSeconds <= current.gameSeconds) {
        const dt = current.gameSeconds - before.gameSeconds, continuous = dt <= this.sampleSeconds * 2.5 && !this.resumedGap;
        // Sample crossings cannot prove where the boundary fell: charge them to unknown.
        const samePhase = continuous && current.phase === before.phase && current.floor === before.floor && current.state === before.state;
        const difference = key => before[key] == null || current[key] == null || current[key] < before[key] ? null : current[key] - before[key];
        this.event('combat_summary', { from: before.gameSeconds, to: current.gameSeconds, seconds: dt,
          intervalFloor: current.floor === before.floor ? current.floor : null,
          phase: samePhase ? current.phase : 'unknown', coverage: continuous ? 'sampled' : 'gap',
          killsDelta: difference('kills'), damageTakenDelta: difference('damageTaken'),
          hpMinimumSampled: before.hp == null || current.hp == null ? null : Math.min(before.hp, current.hp),
          hpEnd: current.hp, position: current.position, target: current.target,
          displacement: [before.position.x, before.position.z, current.position.x, current.position.z].every(Number.isFinite)
            ? Math.hypot(before.position.x - current.position.x, before.position.z - current.position.z) : null,
          tags: current.target?.kind ? [current.target.kind] : [], tagsAreOverlapping: true,
          nativeEnemyCount: this.number(run.enemies?.count), aliveEnemies: null, visibleEnemies: null, attackableEnemies: null,
          navigation: current.navigation, cleanup: current.cleanup, loadoutRevision: this.loadoutRevision }, 'sample');
        if (!continuous) this.event('integrity_gap', { reason: 'sample-interval', from: before.gameSeconds, to: current.gameSeconds });
      }
      this.resumedGap = false;
      this.lastLoadout = loadout; this.lastInventory = inventory; this.lastBoundary = boundary; this.last = current;
      if (run.state !== 'over') this.lastBattle = { ...current, loadout };
      if (run.state === 'over' && !this.ended) { this.event('run_ended', { lastBattle: this.lastBattle,
        finalObserved: { ...current, loadout }, result: 'native-over', saveResult: 'unknown' }); this.ended = true; }
      this.pump(); return current;
    });
  }
  fingerprint(text) { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return (h >>> 0).toString(16).padStart(8, '0'); }
  offer(offer) {
    if (typeof offer !== 'object' || !offer) return offer ?? null;
    return this.plain(Object.fromEntries(['kind', 'id', 'key', 'slot', 'rarity', 'vit', 'mods', 'name', 'ups', 'cost', 'price', 'count', 'level', 'parents', 'item', 'boon', 'bane', 'tag', 'sold']
      .filter(k => k in offer).map(k => [k, offer[k]])));
  }
  offers(modal) {
    const values = modal.offers;
    return Array.isArray(values) ? values : Array.isArray(values?.offers) ? values.offers : values == null ? [] : [values];
  }
  page(modal) {
    return this.safe(() => {
      if (!modal || !this.runId) return null;
      let page = this.pages.get(modal);
      if (!page) {
        page = { decisionId: `${this.runId}-d${++this.decisionSerial}`, attempts: 0, receipt: false };
        this.pages.set(modal, page);
        this.event('decision_candidates', { decisionId: page.decisionId, kind: modal.kind,
          offers: this.offers(modal).map(o => this.offer(o)),
          source: modal.entity ? { kind: modal.entity.kind, sub: modal.entity.data?.sub ?? null } : null,
          eligibility: 'unknown-until-decision', result: 'pending' });
      }
      return page;
    });
  }
  evaluated(modal, decision, legal) {
    this.safe(() => { const page = this.page(modal); if (!page) return;
      this.event('decision_evaluated', { decisionId: page.decisionId, kind: modal.kind,
        offers: this.offers(modal).map((o, i) => ({ index: i, offer: this.offer(o), nativeEligible: legal ? !!legal(i) : null })),
        decision: this.plain(decision), scoringUnknown: decision?.benefitEvaluations ? null : 'not-exposed-by-this-policy' }); });
  }
  attempt(modal, type, message) {
    return this.safe(() => {
      const page = this.page(modal); if (!page) return null;
      if (this.detail === 'events') this.observeGold(modal.run || this.run, true, 'before-decision');
      const attempt = { decisionId: page.decisionId, attempt: ++page.attempts, actionType: type ?? null, message: message ?? null,
        before: this.frame(modal.run || this.run, {}, true), callback: false };
      this.event('decision_attempt', attempt); this.pending = attempt; return attempt;
    });
  }
  receipt(attempt, run, error = null) {
    this.safe(() => {
      if (!attempt) return;
      this.observeHealth(run);
      if (this.detail === 'events') this.observeGold(run, true, 'decision-result');
      const after = this.frame(run, {}, true), before = attempt.before;
      const resourceChanged = JSON.stringify(before.loadout) !== JSON.stringify(after.loadout) || before.gold !== after.gold;
      const changed = resourceChanged || before.state !== after.state;
      this.event('decision_receipt', { decisionId: attempt.decisionId, attempt: attempt.attempt,
        status: error || attempt.nativeResult === false ? 'failed' : attempt.callback && changed && !attempt.promiseReturned ? 'success' : 'unknown',
        evidence: error ? 'native-exception' : attempt.callback ? 'native-callback-returned' : changed ? 'state-or-resource-changed-without-callback-proof' : 'no-synchronous-proof',
        effectConfirmed: resourceChanged, pageAdvanced: before.state !== after.state,
        nativeResult: attempt.nativeResult ?? null, before, after,
        resourceAttribution: 'unknown', error: error ? String(error?.name || 'Error') : null });
      if (this.pending === attempt) this.pending = null;
    });
  }
  nativeCallback(modal, values, invoke) {
    const page = this.safe(() => this.page(modal)), attempt = this.pending;
    this.safe(() => this.event('native_choice', { decisionId: page?.decisionId ?? null, values: values.map(v => this.offer(v)), kind: modal.kind }));
    const result = invoke(); // Exceptions and return identity stay native.
    this.safe(() => { if (attempt && attempt.decisionId === page?.decisionId) { attempt.callback = true; attempt.nativeResult = this.offer(result); attempt.promiseReturned = !!result && typeof result.then === 'function'; } });
    this.safe(() => this.event('native_choice_return', { decisionId: page?.decisionId ?? null, kind: modal.kind,
      outcome: ['pact', 'trade'].includes(modal.kind) ? 'unknown-random-outcome-not-in-callback-return' : 'callback-returned',
      value: this.offer(result) }));
    return result;
  }
}
