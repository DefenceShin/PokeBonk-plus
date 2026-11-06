// Author-defined rhythm: preserve during ordinary compatibility/critical-bug maintenance.
// See AUTHORSHIP.md and AI-MAINTENANCE.md. Delays reduce mechanical input but cannot guarantee no detection/bans.
// One weekly authorization model. It reads no game objects, starts no timers,
// and always uses fixed Beijing UTC+8 rather than the machine's time zone/DST.
export const ACTIVATION_SCHEDULE_DEFAULTS = Object.freeze({
  activationSchedule: false,
  activationStart: '00:00',
  activationEnd: '00:00',
  activationDays: Object.freeze([1, 2, 3, 4, 5, 6, 7]),
});

export function parseActivationClock(value) {
  if (typeof value !== 'string' || value.length !== 5 || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

export function validateActivationSchedule(raw = {}) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) raw = {};
  if (Object.hasOwn(raw, 'activationSchedule') && typeof raw.activationSchedule !== 'boolean')
    errors.push('脚本启用时间开关必须是布尔值。');
  for (const [key, label] of [['activationStart', '开始'], ['activationEnd', '结束']])
    if (Object.hasOwn(raw, key) && parseActivationClock(raw[key]) === null)
      errors.push(label + '时间须为北京时间24小时制 HH:mm（00:00—23:59）。');
  if (Object.hasOwn(raw, 'activationDays')) {
    const days = raw.activationDays;
    if (!Array.isArray(days) || days.length < 1 || days.length > 7 ||
        days.some(day => !Number.isInteger(day) || day < 1 || day > 7) || new Set(days).size !== days.length)
      errors.push('至少选择一个星期，周一至周日使用不重复的整数1—7。');
  }
  return { valid: errors.length === 0, errors };
}

// Missing fields are legacy/default preferences. Explicit malformed saved
// times/days keep an invalid sentinel so an enabled schedule cannot silently
// widen to all day. Strict UI/host patches reject these values before saving.
export function normalizeActivationSchedule(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) raw = {};
  const result = { activationSchedule: raw.activationSchedule === true };
  for (const key of ['activationStart', 'activationEnd'])
    result[key] = Object.hasOwn(raw, key)
      ? parseActivationClock(raw[key]) !== null ? raw[key] : ''
      : ACTIVATION_SCHEDULE_DEFAULTS[key];
  const days = Object.hasOwn(raw, 'activationDays') ? raw.activationDays : ACTIVATION_SCHEDULE_DEFAULTS.activationDays;
  result.activationDays = validateActivationSchedule({ activationDays: days }).valid ? [...days].sort((a, b) => a - b) : [];
  return result;
}

export function activationScheduleState(settings = {}, nowOrClock) {
  const detection = settings?.convenience?.rhythm ?? settings?.convenience?.detection;
  const raw = detection && typeof detection === 'object' && !Array.isArray(detection) ? detection : {};
  const configured = raw.activationSchedule === true, master = raw.enabled !== false;
  const base = { configured, enabled: configured && master, timezone: 'UTC+8', utcOffsetMinutes: 480,
    nextChangeAt: null, nextStartAt: null, windowStartAt: null, windowEndAt: null,
    ownerDate: null, ownerWeekday: null };
  // Off means no clock/calendar work. The caller may pass a lazy Date.now.
  if (!master) return { ...base, allowed: true, state: 'master-disabled', reason: 'rhythm-disabled',
    message: '运行节奏已关闭，脚本启用时间不限制操作。' };
  if (!configured) return { ...base, allowed: true, state: 'disabled', reason: 'schedule-disabled',
    message: '脚本启用时间未开启，不限制操作时段。' };
  const normalized = normalizeActivationSchedule(raw), validation = validateActivationSchedule(normalized);
  if (!validation.valid) return { ...base, allowed: false, state: 'invalid', reason: 'invalid-settings',
    errors: validation.errors, message: '脚本已待命：启用时间配置无效，请修正时间与星期。' };
  let now;
  try { now = typeof nowOrClock === 'function' ? nowOrClock() : nowOrClock === undefined ? Date.now() : nowOrClock; }
  catch { now = NaN; }
  const dayMs = 86400000, offsetMs = 28800000, minuteMs = 60000;
  const local = typeof now === 'number' && Number.isFinite(now) ? new Date(now + offsetMs) : null;
  if (!local || !Number.isFinite(local.getTime())) return { ...base, allowed: false, state: 'invalid',
    reason: 'invalid-clock', message: '脚本已待命：无法确认当前北京时间。' };
  const pad = number => String(number).padStart(2, '0'),
    dateText = value => { const date = new Date(value + offsetMs); return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`; },
    clockText = value => { const date = new Date(value + offsetMs); return `${dateText(value)} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`; },
    start = parseActivationClock(normalized.activationStart), end = parseActivationClock(normalized.activationEnd),
    duration = (end > start ? end - start : end + 1440 - start) * minuteMs,
    today = Math.floor((now + offsetMs) / dayMs) * dayMs - offsetMs,
    weekday = local.getUTCDay() || 7, days = new Set(normalized.activationDays),
    crossesMidnight = end < start, allDay = start === end,
    description = (days.size === 7 ? '每天' : [...days].map(day => '周' + '一二三四五六日'[day - 1]).join('、')) +
      (allDay ? ` 全天（${normalized.activationStart}起24小时）` : ` ${normalized.activationStart}—${normalized.activationEnd}${crossesMidnight ? '（结束于次日）' : ''}`),
    details = { ...base, nowAt: now, nowBeijing: clockText(now), description,
      activationStart: normalized.activationStart, activationEnd: normalized.activationEnd,
      activationDays: normalized.activationDays, crossesMidnight, allDay };
  if (days.size === 7 && allDay) return { ...details, allowed: true, state: 'active', reason: 'within-window',
    message: '脚本启用时间：每天全天，可以操作。' };
  // At most ten local days, independent of elapsed gameplay or queue sizes.
  // Each selected weekday owns the complete interval beginning on that day.
  const windows = [];
  for (let delta = -1; delta <= 8; delta++) {
    const ownerWeekday = ((weekday - 1 + delta) % 7 + 7) % 7 + 1;
    if (!days.has(ownerWeekday)) continue;
    const ownerStart = today + delta * dayMs, from = ownerStart + start * minuteMs;
    windows.push({ from, until: from + duration, ownerDate: dateText(ownerStart), ownerWeekday });
  }
  const current = windows.find(window => window.from <= now && now < window.until);
  if (current) {
    let until = current.until;
    for (const window of windows) if (window.from <= until && window.until > until) until = window.until;
    return { ...details, allowed: true, state: 'active', reason: 'within-window',
      windowStartAt: current.from, windowEndAt: until, nextChangeAt: until,
      ownerDate: current.ownerDate, ownerWeekday: current.ownerWeekday,
      message: `脚本启用时间：可操作至北京时间${clockText(until)}。` };
  }
  const next = windows.find(window => window.from > now);
  return { ...details, allowed: false, state: 'waiting', reason: 'outside-window',
    nextChangeAt: next?.from ?? null, nextStartAt: next?.from ?? null,
    nextStartBeijing: next ? clockText(next.from) : null,
    message: next ? `脚本已待命，等待北京时间${clockText(next.from)}启用。` : '脚本已待命，等待配置的北京时间时段。' };
}


export const AUTOMATION_RHYTHM_DEFAULTS = Object.freeze({
  enabled: true, randomDelay: true, randomDelayMinMs: 600, randomDelayMaxMs: 1800,
  betweenRunWait: true, betweenRunWaitMinSeconds: 5, betweenRunWaitMaxSeconds: 15,
  inspectPanel: true, ...ACTIVATION_SCHEDULE_DEFAULTS,
});

export function normalizeAutomationRhythm(settings = {}) {
  const value = settings?.convenience?.rhythm ?? settings?.convenience?.detection;
  const group = value && typeof value === 'object' && !Array.isArray(value) ? value : settings;
  const raw = group && typeof group === 'object' && !Array.isArray(group) ? group : {};
  const result = { ...AUTOMATION_RHYTHM_DEFAULTS, ...normalizeActivationSchedule(raw) };
  for (const key of ['enabled', 'randomDelay', 'betweenRunWait', 'inspectPanel'])
    if (typeof raw[key] === 'boolean') result[key] = raw[key];
  for (const [minimum, maximum, limit] of [['randomDelayMinMs', 'randomDelayMaxMs', 30000],
      ['betweenRunWaitMinSeconds', 'betweenRunWaitMaxSeconds', 86400]]) {
    for (const key of [minimum, maximum]) if (typeof raw[key] === 'number' && Number.isFinite(raw[key]))
      result[key] = Math.max(0, Math.min(limit, Math.round(raw[key])));
    if (result[minimum] > result[maximum]) [result[minimum], result[maximum]] = [result[maximum], result[minimum]];
  }
  return result;
}

export function effectiveAutomationRhythm(settings = {}) {
  const group = normalizeAutomationRhythm(settings);
  return { ...group, randomDelay: group.enabled && group.randomDelay,
    betweenRunWait: group.enabled && group.betweenRunWait, inspectPanel: group.enabled && group.inspectPanel };
}

// Delays only actions explicitly confirmed safe by the caller. Combat input
// never enters a timer, and no delayed callback retains an old game action.
export const ACTION_CADENCE_DEFAULTS = Object.freeze({
  randomDelay: true,
  randomDelayMinMs: 600,
  randomDelayMaxMs: 1800,
});

function delayMilliseconds(value, fallback) {
  if (value == null || value === "" || typeof value === "boolean")
    return fallback;
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(30000, Math.max(0, Math.round(number)))
    : fallback;
}

export function normalizeCadenceSettings(settings = {}) {
  if (!settings || typeof settings !== "object") settings = {};
  const group = settings?.convenience?.rhythm ?? settings?.convenience?.detection;
  if (group && typeof group === 'object' && !Array.isArray(group)) {
    const rhythm = effectiveAutomationRhythm(settings);
    return { randomDelay: rhythm.randomDelay, randomDelayMinMs: rhythm.randomDelayMinMs,
      randomDelayMaxMs: rhythm.randomDelayMaxMs };
  }
  let minimum = delayMilliseconds(
      settings.randomDelayMinMs,
      ACTION_CADENCE_DEFAULTS.randomDelayMinMs,
    ),
    maximum = delayMilliseconds(
      settings.randomDelayMaxMs,
      ACTION_CADENCE_DEFAULTS.randomDelayMaxMs,
    );
  if (minimum > maximum) [minimum, maximum] = [maximum, minimum];
  return {
    randomDelay:
      settings.randomDelay !== false && settings.randomDelay !== "false",
    randomDelayMinMs: minimum,
    randomDelayMaxMs: maximum,
  };
}

/**
 * One safe action at a time. Call allow on each tick while re-evaluating the
 * current page and legal candidates; call complete only after attempting the
 * native action. An allowed action stays ready until complete, so callers must
 * never queue its closure or treat an old ready result as authorization later.
 *
 * stateScope must be a stable primitive or object for the same account/run/page.
 * A different key or scope abandons the prior timer; pause and teardown should
 * additionally call reset. Scope identities are deliberately absent from logs.
 */
export class ActionCadence {
  constructor({ settings = {}, random = Math.random, clock } = {}) {
    this.settings = normalizeCadenceSettings(settings);
    this.random = typeof random === "function" ? random : Math.random;
    this.clock =
      typeof clock === "function"
        ? clock
        : () => globalThis.performance?.now?.() ?? Date.now();
    this.pending = null;
    this.completed = 0;
    this.cancelled = 0;
    this.lastResetReason = null;
    this.lastNow = null;
  }

  now(value) {
    let current = value;
    if (!Number.isFinite(current)) current = Number(this.clock());
    if (!Number.isFinite(current)) current = this.lastNow ?? 0;
    // performance.now is monotonic; also contain malformed/test clocks so a
    // backwards clock adjustment cannot extend a waiting action indefinitely.
    this.lastNow = Math.max(this.lastNow ?? current, current);
    return this.lastNow;
  }

  setSettings(settings = {}) {
    const next = normalizeCadenceSettings(settings);
    if (
      next.randomDelay !== this.settings.randomDelay ||
      next.randomDelayMinMs !== this.settings.randomDelayMinMs ||
      next.randomDelayMaxMs !== this.settings.randomDelayMaxMs
    ) {
      this.reset("settings-changed");
      this.settings = next;
    }
    return { ...this.settings };
  }

  reset(reason = "reset") {
    if (this.pending) this.cancelled++;
    this.pending = null;
    this.lastResetReason = String(reason);
  }

  allow(key, { now, safe = false, stateScope = null, settings, enabled } = {}) {
    if (settings !== undefined) this.setSettings(settings);
    const current = this.now(now);
    // enabled is the delay override, not permission to run a stopped pilot.
    // The caller must independently check its own enabled/account/run state.
    if (!safe || enabled === false || !this.settings.randomDelay) {
      this.reset(!safe ? "live-action" : "delay-disabled");
      return true;
    }
    const actionKey = String(key ?? "");
    if (!actionKey) {
      this.reset("missing-key");
      return false;
    }
    if (
      this.pending &&
      (this.pending.key !== actionKey || this.pending.stateScope !== stateScope)
    )
      this.reset("action-context-changed");
    if (!this.pending) {
      let sample;
      try {
        sample = Number(this.random());
      } catch {
        sample = 0.5;
      }
      if (!Number.isFinite(sample)) sample = 0.5;
      sample = Math.max(0, Math.min(1, sample));
      const { randomDelayMinMs: minimum, randomDelayMaxMs: maximum } =
        this.settings;
      const sampledDelayMs = Math.round(minimum + sample * (maximum - minimum));
      this.pending = {
        key: actionKey,
        stateScope,
        sampledDelayMs,
        startedAt: current,
        deadline: current + sampledDelayMs,
      };
      this.lastResetReason = null;
    }
    return current >= this.pending.deadline;
  }

  complete(key, { stateScope } = {}) {
    if (
      !this.pending ||
      this.pending.key !== String(key ?? "") ||
      (stateScope !== undefined && this.pending.stateScope !== stateScope)
    )
      return false;
    this.pending = null;
    this.completed++;
    this.lastResetReason = "action-completed";
    return true;
  }

  snapshot(options = {}) {
    const requestedNow =
      typeof options === "number" ? options : options?.now;
    const current = this.now(requestedNow),
      pending = this.pending,
      remainingMs = pending ? Math.max(0, Math.ceil(pending.deadline - current)) : 0;
    return {
      state: !this.settings.randomDelay
        ? "disabled"
        : pending
          ? remainingMs > 0
            ? "waiting"
            : "ready"
          : "idle",
      key: pending?.key ?? null,
      remainingMs,
      sampledDelayMs: pending?.sampledDelayMs ?? 0,
      startedAt: pending?.startedAt ?? null,
      deadline: pending?.deadline ?? null,
      completed: this.completed,
      cancelled: this.cancelled,
      lastResetReason: this.lastResetReason,
      settings: { ...this.settings },
    };
  }
}
