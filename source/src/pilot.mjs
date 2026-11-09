import { nativeCompatSelector, nativeCompatSelectorTemplate } from './native-adaptation.mjs';
// Bundled with policy.mjs by runner.mjs; executes entirely inside the game tab.
export function installPilot(options = {}) {
  const previousPilot = globalThis.__PB_PILOT;
  if (previousPilot && !options.hotReload) return;
  const config = {
    autoStart: false,
    buyUpgrades: false,
    embedded: false,
    settings: {},
    builds: [],
    ...options,
  };
  function normalizeStageAndSlotSettings(settings = {}) {
    return {
      modeSettings:{...(settings.modeSettings&&typeof settings.modeSettings==='object'&&!Array.isArray(settings.modeSettings)?settings.modeSettings:{}),
        mutation:normalizeMutationSettings(settings.modeSettings?.mutation),
        ...Object.fromEntries(['appearance','wardrobe'].map(mode=>[mode,{
          ...(settings.modeSettings?.[mode]&&typeof settings.modeSettings[mode]==='object'&&!Array.isArray(settings.modeSettings[mode])?settings.modeSettings[mode]:{}),
          ...normalizeAppearanceSettings(settings.modeSettings?.[mode])}]))},
      autoUnlockItems: settings.autoUnlockItems === true,
      autoClaim: settings.autoClaim === true,
      autoUpgrade: settings.autoUpgrade === true,
      reserveMoveSlot: settings.reserveMoveSlot === true,
      bossRetreat: settings.bossRetreat === true,
      shopPriority: settings.shopPriority === true,
      expandVitaminSlots: typeof settings.expandVitaminSlots === "boolean" ? settings.expandVitaminSlots : true,
      shinyStayAfterFinalClear: settings.shinyStayAfterFinalClear === true,
    };
  }
  function mergePilotPartialSettings(current={},patch={}) {
    const plain=value=>value&&typeof value==='object'&&!Array.isArray(value),next={...current,...patch};
    if(Object.hasOwn(patch,'modeSettings')&&!plain(patch.modeSettings))next.modeSettings=current.modeSettings;
    for(const key of ['autoUpgrade','autoUnlockItems','autoClaim','reserveMoveSlot'])if(Object.hasOwn(patch,key)&&typeof patch[key]!=='boolean')next[key]=current[key];
    if(Object.hasOwn(patch,'shopPriority')&&typeof patch.shopPriority!=='boolean')next.shopPriority=current.shopPriority;
    for(const group of ['modeSettings','convenience','unlockTargets','eventTargets'])if(plain(patch[group])){
      next[group]={...current[group],...patch[group]};
      const nested=group==='modeSettings'?Object.keys(patch[group]):group==='convenience'?['coop','rhythm']:[];
      for(const key of nested)if(plain(patch[group][key]))next[group][key]={...current[group]?.[key],...patch[group][key]};
    }
    if(plain(patch.modeSettings)&&Object.hasOwn(patch.modeSettings,'mutation'))
      next.modeSettings.mutation=normalizeMutationSettings(plain(patch.modeSettings.mutation)?next.modeSettings.mutation:{},current.modeSettings?.mutation);
    for(const mode of ['appearance','wardrobe'])if(plain(patch.modeSettings)&&Object.hasOwn(patch.modeSettings,mode))
      next.modeSettings[mode]={...(plain(patch.modeSettings[mode])?next.modeSettings[mode]:current.modeSettings?.[mode]),
        ...normalizeAppearanceSettings(plain(patch.modeSettings[mode])?next.modeSettings[mode]:{},current.modeSettings?.[mode])};
    if(Object.hasOwn(patch,'finalReplacements'))next.finalReplacements=mergeFinalReplacementEntries(current.finalReplacements,patch.finalReplacements);
    return next;
  }
  const recorderInstance = previousPilot?.battleRecorder || (config.battleRecorder === false ? null : new BattleRecorder({
    revision: config.revision ?? null, sourceHash: config.sourceHash ?? null,
    send: message => globalThis.chrome?.webview?.postMessage?.(message),
  }));
  if (recorderInstance) {
    Object.setPrototypeOf(recorderInstance, BattleRecorder.prototype);
    recorderInstance.enabled = config.battleRecorder !== false;
    recorderInstance.setProvenance(config.revision ?? null, config.sourceHash ?? null);
  }
  const recording = () => (globalThis.__PB_PILOT || previousPilot || pilot).battleRecorder;
  const pilot = {
    battleRecorder: recorderInstance,

    settings: {
      mode: "auto",
      autoClaim: false,
      autoUpgrade: config.buyUpgrades,
      autoUnlockItems: false,
      pickup: true,
      jumpMove: false,
      slideMove: false,
      bossRetreat: false,
      flightMove: false,
      flightJumpItemCount: 5,
      flightNoInteractions: false,
      flightKeepInteractions: true,
      noInteractionsAfter: false,
      noInteractionsAfterSeconds: 600,
      fullMapOrbit: false,
      fullMapOrbitAfterSeconds: 600,
      pickupBonkoin: true,
      expandVitaminSlots: true,
      safeMode: false,
      bossPriority: false,
      portalPriority: false,
      shinyPriority: true,
      capturePriority: true,
      riskyInteractions: true,
      forceCostInteractions: false,
      costEffectPriorities: Array(10).fill(""),
      hotkeyToggle: "F8",
      hotkeyStop: "F9",
      hotkeyReleaseMouse: "F10",
      autoRestart: true,
      randomDelay: true,
      randomDelayMinMs: 600,
      randomDelayMaxMs: 1800,
      shinyMode: "missing",
      shinyTypes: ["shiny", "classic"],
      shinyTargetId: null,
      shinyStopWhenDone: true,
      shinyUseStone: false,
      shinyStageWait: false,
      shinyStageWaitSeconds: 600,
      shinyStayAfterFinalClear: false,
      unlockTargets: {},
      eventTargets: {},
      unlockCategory: "all",
      finalReplacements: {},
      autoManageBuildPriority: false,
      ...config.settings,
      ...normalizeFlightSettings(config.settings),
      ...normalizeTimedMovementSettings(config.settings),
      ...normalizeStageAndSlotSettings({autoUpgrade:config.buyUpgrades,...config.settings}),
      ...normalizeCostSettings(config.settings),
      finalReplacements: normalizeFinalReplacementEntries(config.settings.finalReplacements),
    },
    builds: config.builds,
    characterUnlockImplementation: previousPilot?.characterUnlockImplementation==='legacy160'||config.characterUnlockImplementation==='legacy160'?'legacy160':'current',
    enabled: config.autoStart && config.settings.mode !== "autoManage",
    app: null,
    compatibility: { state: "pending", missing: [], reason: "等待游戏接口" },
    compatibilityWaitSince: performance.now(),
    run: null,
    plan: null,
    target: null,
    status: "等待游戏加载",
    errors: [],
    held: new Set(),
    hazards: [],
    owner: "unknown",
    ownerSource: null,
    frames: 0,
    totalMs: 0,
    maxMs: 0,
    timings: [],
    lastMacro: 0,
    lastWorld: 0,
    lastModal: 0,
    modal: null,
    starting: false,
    startingAttempt: null,
    blocked: new Map(),
    visits: new Map(),
    nextStartAt: 0,
    retryDelay: 2000,
    previous: { x: 0, z: 0 },
    navigation: null,
    navTarget: null,
    navAt: 0,
    lastTap: new Map(),
    pendingTapCodes: new Set(),
    history: [],
    events: [],
    shinyEncounters: 0,
    shinyCaptures: 0,
    interactionSpent: 0,
    riskyVisits: new Set(),
    pendingInteractionSpend: null,
    interactionTracker: createInteractionTracker(),
    tacticalDirector: new TacticalDirector(),
    terrainRecoveryTracker: new TerrainRecoveryTracker(),
    terrainHopTracker: typeof TerrainHopTracker === "function" ? new TerrainHopTracker() : null,
    crowdEscapeTracker: typeof CrowdEscapeTracker === "function" ? new CrowdEscapeTracker() : null,
    explorationPlanner: typeof ExplorationPlanner === "function" ? new ExplorationPlanner() : null,
    tacticalAssessment: null,
    routeObservation: null,
    flightInteractionScope: null,
    choiceHistory: { unplannedRounds: 0, rerollsThisPage: 0 },
    pendingWorldAttempt: null,
    damageLog: [],
    savePending: false,
    clanRewardChecks: new WeakMap(),
    clanRewardBusy: null,
    stopReason: null,
    controlEpoch: previousPilot?.controlEpoch || 0,
    controlIdentityScope: null,
    autoManageScope: null,
    controlIntent: previousPilot?.controlIntent || {
      version: 1,
      documentId: globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${performance.now().toString(36)}`,
      desired: (previousPilot ? previousPilot.enabled : config.autoStart && config.settings.mode !== "autoManage") ? "running" : "stopped",
      source: "startup",
      code: "initial",
      reason: "等待客户端运行指令",
      changedAt: Date.now(),
    },
    health: { phase: "boot", since: Date.now(), reason: "等待游戏加载", retryAt: null },
    pauseRequested: false,
    documentLeaving: null,
    documentLifecycleObserved: false,
    deploymentWait: false,
    nextRunIntent: null,
    cadence: new ActionCadence({ settings: config.settings }),
    cadenceAccount: null,
    authenticationSnapshot() {
      // Read only native form structure. Never inspect input values, session
      // storage, account names, or credentials for recovery diagnostics.
      const card = document.querySelector?.(nativeCompatSelector(".auth-card"));
      const banned = !!card?.querySelector?.(nativeCompatSelector(".ban-ribbon"));
      const maintenance = !banned && !!card?.querySelector?.(nativeCompatSelector(".mt-ribbon"));
      const submit = card?.querySelector?.(nativeCompatSelector("button.btn.big.blue"));
      const loginForm = !!(card?.querySelector?.(nativeCompatSelector('input[autocomplete="username"]')) &&
        card?.querySelector?.(nativeCompatSelector('input[autocomplete="current-password"]')) && submit);
      const offlineScreen = !!document.querySelector?.(nativeCompatSelector(".loading .panel button.btn.big.red"));
      return { state: banned ? "banned" : maintenance ? "maintenance" : loginForm ? "native-login" :
        offlineScreen ? "offline-screen" : this.app?.meta?.account ? "signed-in" :
          card ? "sign-in-required" : "unknown", loginForm,
        canSubmit: loginForm && !submit.disabled };
    },
    observeMenuAvailability() {
      const app = this.app, backend = app?.backend;
      if (!backend) return null;
      let state = this.menuAvailability;
      if (state?.app !== app || state.backend !== backend)
        state = this.menuAvailability = {app,backend,maintenance:false,maintenanceRevision:0,bannedAccount:null,
          statusPending:0,nextReviewAt:0};
      const current = () => this.app === app && app.backend === backend && this.menuAvailability === state;
      if (typeof backend.status === "function" && backend.status.__pbMenuAvailability !== state) {
        const original = backend.status;
        const wrapped = function (...args) {
          const watching = this === backend && current(), revision=state.maintenanceRevision;
          if (watching) { state.statusPending++;state.nextReviewAt=performance.now()+30000; }
          let result;
          try { result=original.apply(this,args); }
          catch (error) { if (watching) state.statusPending--;throw error; }
          const settled = value => {
            if (watching) state.statusPending--;
            if (watching && current() && backend.status === wrapped &&
                typeof value?.maintenance?.on === "boolean") {
              if (value.maintenance.on && !value.bypass) {
                state.maintenance=true;state.maintenanceRevision++;
              } else if (state.maintenanceRevision === revision) state.maintenance=false;
            }
          };
          // Keep the native receiver, arguments, Promise identity and rejection.
          // Observe existing public status traffic; never manufacture openness.
          if (result && typeof result.then === "function") result.then(settled,()=>{
            if (watching) state.statusPending--;
          });
          else settled(result);
          return result;
        };
        wrapped.__pbMenuAvailability=state;backend.status=wrapped;
      }
      if (typeof backend.onMaintenance === "function" && backend.onMaintenance.__pbMenuAvailability !== state) {
        const original = backend.onMaintenance;
        const wrapped = function (...args) {
          if (this === backend && current() && backend.onMaintenance === wrapped) {
            state.maintenance=true;state.maintenanceRevision++;state.nextReviewAt=performance.now()+30000;
          }
          return original.apply(this,args);
        };
        wrapped.__pbMenuAvailability=state;backend.onMaintenance=wrapped;
      }
      return state;
    },
    observeMenuFailure(error, app = this.app, account = app?.meta?.account, backend = app?.backend) {
      if (this.app !== app || app.backend !== backend) return;
      const state = this.observeMenuAvailability();
      if (!state) return;
      if (error?.maintenance) { state.maintenance=true;state.maintenanceRevision++;state.nextReviewAt=performance.now()+30000; }
      if (error?.banned && app.meta?.account === account) state.bannedAccount=account;
    },
    menuRestriction() {
      const state = this.observeMenuAvailability(), run = this.app?.run;
      // Maintenance must not pause or terminate a healthy, already accepted run.
      if (run && run.state !== "over") return null;
      const authentication = this.authenticationSnapshot().state;
      if (authentication === "banned" || state?.bannedAccount && state.bannedAccount === this.app?.meta?.account)
        return "banned";
      return authentication === "maintenance" || state?.maintenance ? "maintenance" : null;
    },
    reviewMenuMaintenance() {
      const state = this.observeMenuAvailability(), run = this.app?.run;
      if (!state?.maintenance || run && run.state !== "over" ||
          this.authenticationSnapshot().state === "maintenance" || state.statusPending ||
          performance.now() < state.nextReviewAt || typeof state.backend.status !== "function") return;
      // Native maintenance cards/watchers normally poll status themselves. An
      // over/unsaved run can suppress that UI; use only its same public method,
      // at most once per 30 seconds, to avoid an irreversible error-only latch.
      state.nextReviewAt=performance.now()+30000;
      try {
        const result=state.backend.status();
        if (result && typeof result.catch === "function") result.catch(()=>{});
      } catch { /* A failed public check never means maintenance has ended. */ }
    },
    menuOperationsAllowed() {
      if (!this.automationAllowed()) return false;
      if(this.nativePauseTransferPending?.()){
        this.status="等待原生暂停保存或恢复请求完成";this.setHealth("save-wait",this.status);return false;
      }
      if(this.nativeSavedGamePresent?.()){
        this.status="游戏已有暂停保存的对局，请在原生页面选择继续或结束保存";
        this.setHealth("save-wait",this.status);return false;
      }
      const restriction = this.menuRestriction();
      if (!restriction) return true;
      this.cadence.reset("native-menu-restricted");
      this.status=restriction === "banned" ? "原生账号限制尚未解除，保持等待" : "游戏仍在维护，等待原生开放";
      this.setHealth("authentication-wait",this.status);
      return false;
    },
    controlSnapshot() {
      const authentication = this.authenticationSnapshot();
      const recoveryBlocked = authentication.state === "banned" ? "native-banned" :
          authentication.state === "maintenance" ? "native-maintenance" : null;
      return { ...this.controlIntent, instance: this.controlIntent.documentId,
        epoch: this.controlEpoch || 0, recoveryBlocked,
        recoveryAllowed: this.controlIntent.desired === "running" && !recoveryBlocked && !this.deploymentWait };
    },
    publishControl() {
      try { globalThis.chrome?.webview?.postMessage?.({ kind: "pilotControl", control: this.controlSnapshot() }); }
      catch { /* A lost host transport cannot change the user's running intent. */ }
    },
    setControlIntent(desired, source, code, reason) {
      const previous = this.controlIntent;
      if (previous.desired === desired && previous.source === source && previous.code === code && previous.reason === reason)
        return;
      this.controlIntent = { ...previous, desired, source, code, reason, changedAt: Date.now() };
      this.publishControl();
    },
    controlIdentityCurrent() {
      const app = this.app, meta = app?.meta, account = meta?.account;
      const scope = this.controlIdentityScope;
      if (!scope) {
        // Startup may precede the bridge or the first native login. Bind once
        // an account exists; profile resyncs and later runs keep that identity.
        if (app && meta && account) this.controlIdentityScope = { app, meta, account };
        return true;
      }
      if (scope.app === app && scope.meta === meta && scope.account === account) return true;
      this.stop("账号上下文已改变，辅助已停止；请确认当前账号后重新启动", {
        source: "identity-changed", code: "identity-changed",
      });
      return false;
    },
    autoManageSelected() {
      return this.settings?.mode === "autoManage" || !!(this.enabled && this.autoManageScope);
    },
    autoManageRunAvailable(r) {
      return !!r && r.state!=="over" && (!!r.coop || r.state!=="dead" && !r.player?.dead);
    },
    cooperativeRevivalWaiting(r = this.app?.run) {
      if (!r?.coop || !r.player?.dead || r.state==="over") return false;
      // Local downed/out is not a run result. Native nearby revival or the
      // team's next-zone transition can restore this same player and run.
      this.release(true);this.target=null;this.navTarget=null;this.lastWorld=-Infinity;
      this.status=r.coop.out ? "联机暂时出局，等待队伍进入下一区域后的原生复活" :
        "联机已倒下，等待队友原生复活或团队原生结束";
      this.setHealth("cooperative-revive-wait",this.status);
      return true;
    },
    autoManageScopeMatches(r = this.app?.run) {
      const scope=this.autoManageScope;
      return !!scope && scope.app===this.app && scope.meta===this.app?.meta &&
        scope.account===this.app?.meta?.account && scope.run===r;
    },
    bindAutoManage(r) {
      if(this.autoManageScopeMatches(r))return this.autoManageScope;
      const moves=(r.player.moves || []).map(move=>move?.def?.key || null);
      return this.autoManageScope={app:this.app,meta:this.app.meta,account:this.app.meta.account,run:r,
        moves,moveKeys:new Set(moves.filter(Boolean)),vitaminKeys:new Set(r.player.vitamins?.keys?.() || [])};
    },
    autoManageCurrent(r = this.app?.run) {
      if(!this.autoManageSelected())return !this.cooperativeRevivalWaiting(r);
      const scope=this.autoManageScope;
      if(scope && (!this.autoManageScopeMatches(r) || r!==this.app?.run ||
          !r || r.state==="over")) {
        this.stop("自动托管本局已结束或已切换，等待原生保存；不会自动接管下一局",{
          source:"auto-manage-ended",code:"auto-manage-ended"});
        this.autoManageScope=null;
        return false;
      }
      if(!scope && !this.autoManageRunAvailable(r)) {
        const reason="自动托管：请先手动开始原生对局，再启动自动托管；不会自动开局";
        if(this.enabled)this.stop(reason,{source:"auto-manage-wait",code:"auto-manage-wait"});
        this.status=reason;
        this.setHealth("takeover-wait",this.status);
        return false;
      }
      if(!scope){
        this.bindAutoManage(r);
        this.plan=this.makePlan(r);this.planRun=r;
      }
      return !this.cooperativeRevivalWaiting(r);
    },
    autoManagePreserving(r = this.app?.run) {
      return this.autoManageSelected() && this.settings.autoManageBuildPriority !== true && this.autoManageScopeMatches(r);
    },
    autoManageUpgradeAllowed(r, offer) {
      const scope=this.autoManageScope;
      if(!this.autoManagePreserving(r))return true;
      if(offer?.kind==="upMove") {
        const move=r.player.moves?.[offer.slot],key=move?.def?.key;
        return !!key && scope.moveKeys.has(key);
      }
      if(offer?.kind==="upVit")return scope.vitaminKeys.has(offer.vit) && r.player.vitamins?.has?.(offer.vit)===true;
      return false;
    },
    autoManageCanUpgrade(r) {
      const scope=this.autoManageScope,p=r.player;let unknown=false;
      for(const move of p.moves || [])if(move && scope.moveKeys.has(move.def?.key) && !r.banished?.has?.("m"+move.def?.id)){
        const cap=typeof p.capOf==="function"?p.capOf(move):NaN;
        if(!Number.isFinite(cap)||!Number.isFinite(move.level))unknown=true;
        else if(move.level<cap)return true;
      }
      for(const [key,vitamin]of p.vitamins || [])if(scope.vitaminKeys.has(key) && !r.banished?.has?.("v"+key)){
        if(!Number.isFinite(p.vitCap)||!Number.isFinite(vitamin.level))unknown=true;
        else if(vitamin.level<p.vitCap)return true;
      }
      return unknown?null:false;
    },
    observeDocumentLifecycle() {
      if (this.documentLifecycleObserved) return;
      this.documentLifecycleObserved = true;
      const leaving = event => {
        if (event.isTrusted === false) return;
        if(event.type==='pagehide')try{this.configureWecomPush?.(null);}catch{}
        this.documentLeaving = { app: this.app, run: this.app?.run,
          account: this.app?.meta?.account, epoch: this.controlEpoch || 0 };
      };
      const clear = () => { this.documentLeaving = null; };
      addEventListener("beforeunload", leaving, true);
      addEventListener("pagehide", leaving, true);
      addEventListener("pageshow", clear, true);
      // A cancelled beforeunload has no dedicated browser event. The next
      // real input restores normal pause attribution; focus alone may only
      // mean the navigation confirmation closed, before its unlock arrives.
      const input = event => { if (event.isTrusted === true) clear(); };
      addEventListener("keydown", input, true);
      document.addEventListener("pointerdown", input, true);
    },
    observePauseInputs() {
      if(this.pauseInputsObserved)return;
      this.pauseInputsObserved=true;
      const scope=event=>({event,app:this.app,run:this.app?.run,account:this.app?.meta?.account,
        epoch:this.controlEpoch||0,enabled:this.enabled});
      const loss=event=>{if(event.isTrusted!==false)this.nativeSystemPauseEvent=scope(event);};
      for(const type of ["pointerlockchange","fullscreenchange","visibilitychange"])
        document.addEventListener(type,loss,true);
      addEventListener("blur",loss,true);
    },
    setHealth(phase, reason, retryAt = null) {
      if (this.health.phase !== phase) this.health = { phase, since: Date.now(), reason, retryAt };
      else Object.assign(this.health, { reason, retryAt });
    },
    nativeMenuClick(button, key, label, valid) {
      if (!button || button.disabled || button.isConnected === false || !valid() || !this.automationAllowed()) return false;
      const scope = this.app?.meta?.account;
      if (!this.safeAction(key, scope, label, 'menu')) return false;
      if (!valid() || button.disabled || button.isConnected === false) return false;
      button.click(); this.completeSafeAction(key, scope);
      this.status = label; return true;
    },
    deferVisibleMenu(key, label) {
      const account = this.app?.meta?.account, epoch = this.controlEpoch, now = performance.now();
      // Author-defined visible-menu rhythm. Preserve identity/cancel guards; this wait is not a guarantee against bans.
      if (this.visibleMenuWait?.key !== key || this.visibleMenuWait.account !== account || this.visibleMenuWait.epoch !== epoch)
        this.visibleMenuWait = { key, account, epoch, since:now };
      this.status = label;
      return now - this.visibleMenuWait.since < 8000 ? {waiting:true} : null;
    },
    visibleResearchStep(id, valid) {
      const research = document.querySelector?.(nativeCompatSelector('.lab-wrap'));
      if (research) {
        const labMode = research.querySelector?.(nativeCompatSelector('button.lab-mode[data-mode="lab"]'));
        if (labMode && !labMode.classList.contains('on')) {
          this.nativeMenuClick(labMode, 'research-tab', '打开原生研究页面', valid); return { waiting:true };
        }
        const cards = [...(research.querySelectorAll?.(nativeCompatSelector('.lab-card[data-u]')) || [])];
        const card = cards.find(card => card.getAttribute('data-u') === id);
        return card ? { button:card.querySelector?.(nativeCompatSelector('button.lab-buy')) } : null;
      }
      const home = document.querySelector?.(nativeCompatSelector('button.mm-item.play'));
      if (home) {
        const tiles = [...document.querySelectorAll(nativeCompatSelector('.mm-tiles button.mm-item.tile'))];
        const button = tiles.find(tile => tile.querySelector?.(nativeCompatSelector('img[src*="rare-candy"]'))) || (tiles.length === 5 ? tiles[1] : null);
        if (!button) return null; // Unknown future DOM: original 111 API remains available.
        this.nativeMenuClick(button, 'open-research', '打开原生研究所', valid); return { waiting:true };
      }
      if (document.querySelector?.(nativeCompatSelector('.ls-grid,.rg-regions'))) {
        const back = document.querySelector(nativeCompatSelector('button.back-btn'));
        if (!back) return null;
        this.nativeMenuClick(back, 'research-back', '返回主菜单准备研究', valid); return { waiting:true };
      }
      return null;
    },
    visibleStartStep(plan, boosts, valid) {
      if (!['standard','endless','mutation'].includes(plan.mode)) return null;
      const click = (button,key,label) => {
        if (!button) return this.deferVisibleMenu(key,label);
        this.nativeMenuClick(button,key,label,valid); return { waiting:true };
      };
      const home = document.querySelector?.(nativeCompatSelector('button.mm-item.play'));
      if (home) {
        const button = plan.mode === 'mutation'?document.querySelector(nativeCompatSelector('button.mm-item.mutation')):
          plan.mode === 'endless' ? document.querySelector(nativeCompatSelector('button.mm-item.endless:not(.coop)')) : home;
        return button ? click(button,'open-character-menu','打开原生角色选择') : null;
      }
      const mutationPoster=document.querySelector?.(nativeCompatSelector('.mu-scr'));
      if(mutationPoster){
        if(plan.mode!=='mutation')return click(document.querySelector(nativeCompatSelector('button.back-btn')),'leave-mutation-poster','返回当前模式的原生入口');
        const button=document.querySelector(nativeCompatSelector('.mu-go button.mu-play'));
        if(button&&this.nativeMenuClick(button,'open-mutation-characters','打开每日变异的原生角色选择',valid))
          this.mutationMenuScope={app:this.app,meta:this.app.meta,account:this.app.meta.account,
            epoch:this.controlEpoch,day:plan.mutationPlan?.day,variant:plan.mutationPlan?.variant};
        return {waiting:true};
      }
      const league = document.querySelector?.(nativeCompatSelector('.ls-grid'));
      if (league) {
        if(plan.mode==='mutation'){
          const scope=this.mutationMenuScope,title=document.querySelector?.(nativeCompatSelector('.scr-title span'))?.textContent||'',
            matching=scope?.app===this.app&&scope.meta===this.app.meta&&scope.account===this.app.meta.account&&
              scope.epoch===this.controlEpoch&&scope.day===plan.mutationPlan?.day&&scope.variant===plan.mutationPlan?.variant;
          if(!matching&&!(title.includes('每日变异')&&title.includes(plan.mutationPlan?.name||'\u0000')))
            return click(document.querySelector(nativeCompatSelector('button.back-btn')),'correct-mutation-menu','重新打开当日变异的原生入口');
        }
        const name = this.bridge.data.get(plan.species)?.name;
        const matches = [...league.querySelectorAll(nativeCompatSelector('button.ls-tile'))]
          .filter(tile => tile.getAttribute('aria-label') === name && !tile.classList.contains('locked'));
        if (matches.length !== 1) return this.deferVisibleMenu('native-character-list','等待原生角色目录或当前筛选结果');
        const tile = matches[0];
        if (!tile.classList.contains('on')) return click(tile,'choose-native-character','选择本局出战角色');
        if(plan.mode==='mutation'){
          const button=document.querySelector(nativeCompatSelector('button.ls-go'));
          return button?{button}:this.deferVisibleMenu('native-mutation-start','等待原生每日变异开局按钮');
        }
        return click(document.querySelector(nativeCompatSelector('button.ls-go')),'confirm-native-character','确认原生角色选择');
      }
      const regions = document.querySelector?.(nativeCompatSelector('.rg-regions'));
      if (regions) {
        if(plan.mode==='mutation')return click(document.querySelector(nativeCompatSelector('button.back-btn')),'leave-standard-route','返回每日变异的原生入口');
        if (this.app.meta.profile.lastSpecies !== plan.species) {
          return click(document.querySelector(nativeCompatSelector('button.back-btn')),'correct-native-character','重新确认原生出战角色');
        }
        const maps = this.bridge.biomes || [], index = maps.findIndex(map => map.id === plan.biome);
        const tiles = [...regions.querySelectorAll(nativeCompatSelector('button.rg-item'))], tile = tiles[index];
        if (index < 0 || tiles.length !== maps.length || !tile || tile.querySelector?.(nativeCompatSelector('.rg-tx b'))?.textContent?.trim() !== maps[index].name ||
            tile.classList.contains('locked') || tile.classList.contains('soon')) {
          return this.deferVisibleMenu('native-map-list','等待原生地图可用条件');
        }
        if (!tile.classList.contains('on')) return click(tile,'choose-native-map','选择本局原生地图');
        const modes = [...document.querySelectorAll(nativeCompatSelector('.rg-modes button.rg-mode'))], mode = modes[plan.mode === 'endless' ? 1 : 0];
        if (modes.length !== 2) return null;
        if (mode && !mode.classList.contains('on')) return click(mode,'choose-native-mode','选择本局原生模式');
        if (plan.mode !== 'endless') {
          const tiers = [...document.querySelectorAll(nativeCompatSelector('button.rg-tier'))], tier = tiers[plan.tier];
          if (tiers.length !== 3 || !tier || tier.classList.contains('locked')) return this.deferVisibleMenu('native-tier-list','等待原生难度可用条件');
          if (!tier.classList.contains('on')) return click(tier,'choose-native-tier','选择本局原生难度');
        }
        const bag = [...document.querySelectorAll(nativeCompatSelector('button.rg-boost'))];
        for (const button of bag) {
          const src = button.querySelector?.(nativeCompatSelector('img'))?.getAttribute?.('src') || '';
          const wanted = boosts.some(key => src.includes('/' + key + '.') || src.includes('/' + key + '-'));
          if (button.classList.contains('on') !== wanted) return click(button,'choose-native-boost','确认本局背包道具');
        }
        if (boosts.length && !boosts.every(key => bag.some(button => {
          const src = button.querySelector?.(nativeCompatSelector('img'))?.getAttribute?.('src') || '';
          return src.includes('/' + key + '.') || src.includes('/' + key + '-');
        }))) return null; // Keep the original boost-capable start call if icons changed.
        const button = document.querySelector(nativeCompatSelector('.rg-go > button.btn.big.red'));
        return button ? { button } : this.deferVisibleMenu('native-start-button','等待原生开局按钮');
      }
      if (document.querySelector?.(nativeCompatSelector('.lab-wrap'))) return click(document.querySelector(nativeCompatSelector('button.back-btn')),'leave-native-research','研究完成，返回原生选关');
      return null;
    },
    activationScheduleSnapshot() {
      const state = activationScheduleState(this.settings, Date.now);
      const key = state.enabled ? `${state.allowed}:${state.windowStartAt}:${state.windowEndAt}` : 'off';
      if (this.activationWindowKey !== undefined && this.activationWindowKey !== key) {
        // Invalidate every original-111 async menu lease at the time boundary.
        const oldEpoch = this.controlEpoch || 0, inspection = this.panelInspection;
        const ownPanel = inspection && inspection.epoch === oldEpoch && this.enabled &&
          inspection.app === this.app && inspection.meta === this.app?.meta &&
          inspection.run === this.app?.run && inspection.account === this.app?.meta?.account &&
          inspection.run.state === 'paused' && inspection.root === inspection.run.ui?.modalEl;
        this.controlEpoch = (this.controlEpoch || 0) + 1;
        // A calendar boundary cancels actions, but does not turn our own still
        // untouched information page into a permanent manual pause. Transfer
        // this exact ownership only; Stop and real input clear it separately.
        if (ownPanel) inspection.epoch = this.controlEpoch;
        const rest=this.restReminder;
        if(rest&&rest.epoch===oldEpoch&&rest.app===this.app&&rest.meta===this.app?.meta&&
            rest.account===this.app?.meta?.account&&rest.run===this.app?.run&&
            (!rest.ownedPause||rest.run?.state==='paused'&&rest.run.ui?.modalEl===rest.root))rest.epoch=this.controlEpoch;
        this.startingAttempt = null; this.starting = false;
        this.cadence.reset('activation-window-changed');
      }
      this.activationWindowKey = key;
      return state;
    },
    automationAllowed() {
      const scope=this.compatibility?.maintenanceScope,run=this.app?.run;
      if(scope?.biomeIds) {
        const live=run&&run.state!=="over",mode=this.plan?.goalMode||this.settings.mode;
        const supported=scope.modeIds.includes(mode)&&(!live || scope.nativeModes.includes(run.mode)&&
          scope.biomeIds.includes(run.biome?.id)&&scope.tiers.includes(run.tier)&&
          !run.coop&&!run.tower&&(!run.endless||run.mode==='endless'&&scope.endlessModeIds?.includes(mode))&&!run.expedition&&!run.duel&&(!run.rifts?.isInside||scope.allowRifts===true));
        if(!supported) {
          this.stop("当前模式或地图不在已核验范围，辅助已停止；保留原生对局",{source:"unsupported-native-route",code:"m2-route-unavailable"});return false;
        }
        const biome=live?run.biome?.id:this.plan?.biome||this.settings.modeSettings?.[mode]?.biome;
        if(scope.stage==='M3'&&biome==='iris'&&this.compatibility?.nativeBossObservations?.hoOh?.ready!==true){
          this.stop("凤王危险接口未核验，辅助已停止；保留原生对局",{source:"unsupported-native-route",code:"ho-oh-hazards-unavailable"});return false;
        }
      }
      const state = this.activationScheduleSnapshot();
      if (state.allowed) return true;
      if(!this.restReminder)this.restReminderClock=null;
      this.release(true);
      this.cadence.reset('activation-schedule-wait');
      this.status = state.message;
      this.setHealth('activation-schedule-wait', state.message);
      return false;
    },
    // Author-defined rhythm; see AUTHORSHIP.md. Preserve cancellation and real save boundaries; no anti-ban guarantee.
    betweenRunWaitReady() {
      const options = effectiveAutomationRhythm(this.settings), run = this.app?.run;
      // The character-only visible-menu interval replaces the editable idle
      // wait; do not stack two independent inter-run timers.
      if(run?.state==='over'&&this.plan?.goalMode==='characters'){
        this.betweenRunWaitScope=null;return true;
      }
      if (!this.enabled || !options.betweenRunWait || this.settings.autoRestart === false || this.autoManageSelected()) {
        this.betweenRunWaitScope = null; return true;
      }
      if (!run || run.state !== 'over' || run.sent !== true) return true;
      this.betweenRunWaitLedger ||= new WeakMap();
      let scope = this.betweenRunWaitLedger.get(run);
      if (!scope) {
        const min = options.betweenRunWaitMinSeconds, max = options.betweenRunWaitMaxSeconds;
        const seconds = min + Math.floor(Math.min(1 - Number.EPSILON, Math.max(0, Math.random())) * (max - min + 1));
        scope = { app: this.app, account: this.app?.meta?.account, run, seconds,
          deadline: performance.now() + seconds * 1000 };
        this.betweenRunWaitLedger.set(run, scope);
      }
      if (scope.app !== this.app || scope.account !== this.app?.meta?.account) return false;
      this.betweenRunWaitScope = scope;
      const remaining = Math.max(0, scope.deadline - performance.now());
      if (remaining <= 0) return true;
      this.status = `局间等待 · ${Math.ceil(remaining / 1000)} 秒后继续下一局`;
      this.setHealth('between-run-wait', this.status);
      return false;
    },
    beginCharacterInterRunMenu(run) {
      // Author-defined operation rhythm for character unlocking. Only normal
      // visible menu navigation is used, after the existing real-save gates.
      // It does not guarantee avoidance of automation detection or account bans.
      if(!this.enabled||this.plan?.goalMode!=='characters'||!run||run.state!=='over'||run.sent!==true||
          this.app?.run||this.settings.autoRestart===false||this.app?.coopRoom?.open)return;
      this.characterInterRunLedger ||= new WeakMap();
      const prior=this.characterInterRunLedger.get(run);
      if(prior&&prior.app===this.app&&prior.account===this.app.meta.account&&prior.epoch===(this.controlEpoch||0)){
        if(!prior.completed)this.characterInterRunMenu=prior;
        return;
      }
      const now=performance.now(),sample=Math.min(1-Number.EPSILON,Math.max(0,Number(Math.random())||0));
      const seconds=30+Math.floor(sample*31);
      this.characterInterRunMenu={app:this.app,meta:this.app.meta,account:this.app.meta.account,
        epoch:this.controlEpoch||0,seconds,deadline:now+seconds*1000,nextAt:now,step:0,page:null,interrupted:false};
      this.characterInterRunLedger.set(run,this.characterInterRunMenu);
    },
    characterInterRunMenuReady(valid) {
      const scope=this.characterInterRunMenu;
      if(!scope)return true;
      const app=this.app,now=performance.now();
      if(!this.enabled||app!==scope.app||app?.meta!==scope.meta||app?.meta?.account!==scope.account||
          (this.controlEpoch||0)!==scope.epoch||app.run||app.coopRoom?.open||this.settings.autoRestart===false||this.settings.mode!=='characters'){
        scope.completed=true;this.characterInterRunMenu=null;return true;
      }
      if(!valid()||!this.automationAllowed()||!this.menuOperationsAllowed()||app.meta.queued||app.meta.hasPending())return false;
      const remaining=Math.max(0,scope.deadline-now);
      this.status=`角色解锁局间浏览 · ${Math.ceil(remaining/1000)} 秒后继续下一局`;
      this.setHealth('between-run-wait',this.status);
      const click=button=>{
        if(!button||button.disabled||button.isConnected===false||!valid()||!this.automationAllowed())return false;
        button.click();return true;
      };
      // A page we did not open is never ours to navigate or dismiss.
      if(scope.page&&(scope.page.isConnected===false||document.querySelector?.(nativeCompatSelector(scope.selector))!==scope.page)){
        scope.page=null;scope.interrupted=true;
      }
      if(remaining===0){
        if(scope.page?.isConnected!==false&&scope.page){
          const back=scope.page.querySelector?.(nativeCompatSelector('.scr-head button.back-btn'));
          if(click(back)){scope.page=null;return false;}
          scope.returnSince ??= now;
          if(now-scope.returnSince<2000)return false;
          // An exact page we opened can recover through the same native menu
          // reset used immediately before this interval. Never reset an active
          // run or an unknown/player-replaced page; no gameplay values change.
          if(document.querySelector?.(nativeCompatSelector(scope.selector))===scope.page&&typeof app.toMenu==='function'&&valid()&&
              !app.run&&!app.coopRoom?.open&&!app.meta.queued&&!app.meta.hasPending()){
            app.toMenu();scope.page=null;this.status='局间浏览结束，正常返回主菜单';return false;
          }
        }
        scope.completed=true;this.characterInterRunMenu=null;return true;
      }
      if(scope.interrupted||now<scope.nextAt)return false;
      if(scope.page){
        // Only dismiss a native tour covering our own read-only page. Never
        // click lab purchases, achievement rewards, account or external links.
        const tour=scope.selector==='.sec.lab'?document.querySelector?.(nativeCompatSelector('.tour-skip')):null;
        if(tour){if(click(tour))scope.nextAt=now+1000;return false;}
        if(click(scope.page.querySelector?.(nativeCompatSelector('.scr-head button.back-btn')))){scope.page=null;scope.step++;scope.nextAt=now+1500;}
        else {scope.interrupted=true;}
        return false;
      }
      const home=document.querySelector?.(nativeCompatSelector('button.mm-item.play'));
      if(!home){scope.interrupted=true;return false;}
      const choices=[['rare-candy','.sec.lab'],['ultra-ball','.sec.dx'],['star-piece','.sec.qs']];
      const [icon,selector]=choices[scope.step%choices.length];
      const button=[...(document.querySelectorAll?.(nativeCompatSelector('.mm-tiles button.mm-item.tile'))||[])]
        .find(tile=>tile.querySelector?.(nativeCompatSelectorTemplate("img[src*=\"{icon}\"]", {icon: (icon)})));
      if(click(button)){
        scope.selector=selector;
        scope.page=document.querySelector?.(nativeCompatSelector(selector))||null;
        if(!scope.page)scope.interrupted=true;
        scope.nextAt=now+7000+Math.floor(Math.min(1,Math.max(0,Number(Math.random())||0))*3000);
      }else {scope.interrupted=true;}
      return false;
    },
    betweenRunWaitSnapshot() {
      const menu=this.characterInterRunMenu;
      if(menu&&menu.app===this.app&&menu.meta===this.app?.meta&&menu.account===this.app?.meta?.account&&
          menu.epoch===(this.controlEpoch||0)&&!this.app?.run){
        const remainingMs=Math.max(0,menu.deadline-performance.now());
        return {enabled:true,required:true,waiting:remainingMs>0,remainingMs,selectedSeconds:menu.seconds};
      }
      const options = effectiveAutomationRhythm(this.settings), scope = this.betweenRunWaitScope;
      const current = scope && scope.run === this.app?.run && scope.account === this.app?.meta?.account;
      const remainingMs = current ? Math.max(0, scope.deadline - performance.now()) : 0;
      return { enabled: options.betweenRunWait, waiting: remainingMs > 0, remainingMs,
        selectedSeconds: current ? scope.seconds : null };
    },
    restReminderCurrent(scope=this.restReminder) {
      return !!scope&&this.enabled&&scope.app===this.app&&scope.meta===this.app?.meta&&
        scope.account===this.app?.meta?.account&&scope.epoch===(this.controlEpoch||0)&&
        scope.run===this.app?.run&&(!scope.ownedPause||scope.run?.state==='paused'&&
          scope.run.ui?.modalEl===scope.root&&!this.pauseRequested);
    },
    restReminderSnapshot() {
      const scope=this.restReminder;
      return this.restReminderCurrent(scope)?{active:true,token:scope.token,
        remainingMs:Math.max(0,scope.deadline-performance.now())}:{active:false};
    },
    acknowledgeRestReminder(token) {
      const scope=this.restReminder;
      if(!scope||scope.token!==token||!this.restReminderCurrent(scope)||
          !this.controlIdentityCurrent()||!this.automationAllowed())return false;
      this.restReminder=null;
      const now=performance.now();
      this.restReminderClock={app:this.app,meta:this.app.meta,account:this.app.meta.account,
        epoch:this.controlEpoch||0,lastAt:now,elapsedMs:0};
      if(scope.ownedPause){
        // Resume only the exact native page this reminder paused. Stop, a
        // replacement page, real player pause or another account never resumes.
        if(scope.run===this.app.run&&scope.run.state==='paused'&&scope.run.ui?.modalEl===scope.root&&
            !this.pauseRequested&&typeof scope.run.resume==='function')scope.run.resume();
      }
      this.status='休息提醒已结束，按当前设置继续挂机';return true;
    },
    restReminderTick(now=performance.now()) {
      const scope=this.restReminder;
      if(scope){
        if(!this.restReminderCurrent(scope)){
          if(scope.ownedPause&&this.enabled&&scope.app===this.app&&scope.meta===this.app?.meta&&
              scope.account===this.app?.meta?.account&&scope.epoch===(this.controlEpoch||0)&&scope.run===this.app?.run){
            this.stop('休息提醒期间玩家已接管游戏，已交还控制',{source:'native-pause',code:'rest-reminder-takeover'});
            return true;
          }
          this.restReminder=null;this.restReminderClock=null;return false;
        }
        this.release(true);
        if(now>=scope.deadline)return !this.acknowledgeRestReminder(scope.token);
        this.status='连续挂机五小时，休息提醒中';this.setHealth('rest-reminder',this.status);return true;
      }
      const app=this.app,r=app?.run,mode=r&&this.planRun===r?this.plan?.goalMode:this.settings.mode;
      if(!this.enabled||!app?.meta?.account||!['characters','auto'].includes(mode)){
        this.restReminderClock=null;return false;
      }
      let clock=this.restReminderClock;
      if(!clock||clock.app!==app||clock.meta!==app.meta||clock.account!==app.meta.account||clock.epoch!==(this.controlEpoch||0))
        this.restReminderClock=clock={app,meta:app.meta,account:app.meta.account,epoch:this.controlEpoch||0,lastAt:now,elapsedMs:0};
      clock.elapsedMs+=Math.max(0,now-clock.lastAt);clock.lastAt=now;
      if(clock.elapsedMs<5*60*60*1000)return false;
      // Finish native mandatory choices/captures/saves first; never discard an
      // interaction or adopt a manually paused page as our own reminder pause.
      if(this.starting||this.deploymentWait||this.pauseRequested||app.coopRoom?.open||r?.coop||
          app.meta.queued||app.meta.hasPending()||r?.ui?.savingEl||r&&r.state!=='play'&&r.state!=='over'||
          r?.state==='over'&&r.sent!==true||r?.capture?.throwing||r?.capture?.state==='throwing')return false;
      if(r?.state==='play'&&(typeof r.pause!=='function'||typeof r.resume!=='function'))return false;
      this.release(true);
      let ownedPause=false,root=null;
      if(r?.state==='play'){
        this.scriptPauseRun=r;
        try{r.pause();}finally{this.scriptPauseRun=null;}
        if(r.state!=='paused')return false;
        ownedPause=true;root=r.ui?.modalEl;
      }
      this.restReminderSequence=(this.restReminderSequence||0)+1;
      this.restReminder={app,meta:app.meta,account:app.meta.account,epoch:this.controlEpoch||0,run:r,
        ownedPause,root,token:`rest-${this.restReminderSequence}-${Math.floor(now)}`,deadline:now+30*60*1000};
      this.panelInspection=null;this.panelInspectionRun=null;
      this.status='连续挂机五小时，休息提醒中';this.setHealth('rest-reminder',this.status);return true;
    },
    inspectPanelTick() {
      const run = this.app?.run, now = performance.now(), options = effectiveAutomationRhythm(this.settings);
      const scope = this.panelInspection;
      if (scope) {
        if (scope.run !== run || scope.account !== this.app?.meta?.account || scope.epoch !== this.controlEpoch ||
            !this.enabled || run.state !== 'paused' || run.ui?.modalEl !== scope.root) {
          this.panelInspection = null; return false;
        }
        if (now < scope.until) { this.status = '短暂查看本局面板'; return true; }
        this.panelInspection = null;
        this.panelInspectionClosing = true;
        try { run.resume(); } finally { this.panelInspectionClosing = false; }
        this.nextPanelInspectionAt = now + (900 + Math.random() * 900) * 1000;
        return run.state === 'paused';
      }
      if (!this.enabled || !options.inspectPanel || !run || run.state !== 'play' || this.flightState(run).noInteractions) return false;
      if (this.panelInspectionRun !== run) {
        this.panelInspectionRun = run;
        this.nextPanelInspectionAt = now + (900 + Math.random() * 900) * 1000;
      }
      if (now < this.nextPanelInspectionAt || run.coop || this.pauseRequested || this.documentLeaving ||
          (run.boss?.active || run.boss?.alive) || run.legendary?.active || this.priorityCapturePending(run) ||
          this.hazards.some(h => h.until >= run.time) || this.pendingWorldAttempt ||
          run.capture?.throwing || typeof run.pause !== 'function' || typeof run.resume !== 'function') return false;
      // Only our own normal information page may be closed automatically.
      this.release(true);
      this.scriptPauseRun = run;
      try { run.pause(); } finally { this.scriptPauseRun = null; }
      if (run.state !== 'paused' || !run.ui?.modalEl) {
        this.nextPanelInspectionAt = now + 60000; return false;
      }
      this.panelInspection = { app:this.app, meta:this.app?.meta, run, account: this.app?.meta?.account, epoch: this.controlEpoch,
        root: run.ui.modalEl, until: now + 2000 + Math.random() * 2000 };
      this.status = '短暂查看本局面板'; return true;
    },
    // These optional panel-inspection pauses are rhythm behavior, not evidence of undetectability.
    observeInspectionInput() {
      if (this.inspectionInputObserved) return;
      this.inspectionInputObserved = true;
      const handoff = event => {
        if (event.isTrusted !== true || !this.panelInspection) return;
        // Let helper chords retain their own meaning. A modifier key arrives
        // before Ctrl/Alt/Shift combinations and is not panel takeover itself.
        if (event.type === 'keydown') {
          if (/^(?:Control|Alt|Shift|Meta)(?:Left|Right)$/.test(event.code || '')) return;
          const chord = [event.ctrlKey?'Ctrl':null,event.altKey?'Alt':null,event.shiftKey?'Shift':null,event.code].filter(Boolean).join('+');
          if (['hotkeyToggle','hotkeyStop','hotkeyReleaseMouse'].some(key=>this.settings[key]===chord)) return;
        }
        this.panelInspection = null;
        this.stop('玩家正在操作游戏面板，已交还控制', { source: 'native-pause', code: 'inspection-takeover' });
      };
      document.addEventListener('pointerdown', handoff, true);
      document.addEventListener('keydown', handoff, true);
    },
    // Author-defined operation rhythm (AUTHORSHIP.md / AI-MAINTENANCE.md).
    // Paused choices use the author's fixed 3–10s dwell in character unlocking
    // and automatic progression. Editable cadence does not override it. Preserve
    // this rule during compatibility/critical-bug maintenance. It reduces rapid
    // repetitive input; no delay can guarantee freedom from detection or bans.
    beginVisibleBuildImport(token, options = {}) {
      if(typeof token!=="string"||!/^import-[a-f0-9]{32}$/.test(token))return {ok:false,reason:"导入请求无效，请重试。"};
      const result=captureVisibleBuildImport(this.bridge,document,options);
      if(!result.ok)return result;
      const app=this.app,meta=app?.meta,account=meta?.account;
      if(!app||!meta||!account)return {ok:false,reason:"游戏资料尚未就绪，未保存方案。"};
      this.visibleBuildImportTicket={token,app,meta,account,panel:result.panel,signature:result.signature,options};
      // Only whitelisted gameplay data crosses the host boundary. DOM, account
      // references and the raw signature remain private to this one document.
      return {ok:true,build:result.build,summary:result.summary,warnings:result.warnings};
    },
    visibleBuildImportCurrent(token) {
      const ticket=this.visibleBuildImportTicket,app=this.app;
      if(!ticket||ticket.token!==token||ticket.app!==app||ticket.meta!==app?.meta||ticket.account!==app?.meta?.account)return false;
      const current=captureVisibleBuildImport(this.bridge,document,ticket.options);
      return current.ok===true&&current.panel===ticket.panel&&current.signature===ticket.signature;
    },
    clearVisibleBuildImport(token) {
      if(this.visibleBuildImportTicket?.token===token)this.visibleBuildImportTicket=null;
    },
    requiredSelectionWait(modal, now = performance.now()) {
      const run=this.app?.run,root=run?.ui?.modalEl;
      if(!run||!modal||modal.run!==run||!["modal","paused"].includes(run.state)||
          !root||root.isConnected===false||modal.kind==="pause"||run.coop)return null;
      let cohort=this.requiredSelectionCohort;
      if(!cohort||cohort.run!==run||!Number.isFinite(cohort.minMs)||!Number.isFinite(cohort.maxMs)||
          cohort.required&&(cohort.minMs!==3000||cohort.maxMs!==10000)){
        const mode=cohort?.run===run&&typeof cohort.mode==="string"?cohort.mode:this.plan?.goalMode||this.settings.mode;
        this.requiredSelectionCohort=cohort={run,mode,required:["characters","auto"].includes(mode),
          minMs:3000,maxMs:10000};
      }
      if(!cohort.required)return null;
      const account=this.app?.meta?.account,epoch=this.controlEpoch||0;
      let wait=this.requiredSelectionPause;
      if(!wait||wait.run!==run||wait.modal!==modal||wait.root!==root||wait.stage!==run.stage||
          wait.terrain!==run.terrain||wait.app!==this.app||wait.account!==account||wait.epoch!==epoch||
          wait.minMs!==cohort.minMs||wait.maxMs!==cohort.maxMs){
        const sample=Math.min(1,Math.max(0,Number(Math.random())||0));
        this.requiredSelectionPause=wait={run,modal,root,app:this.app,account,epoch,stage:run.stage,
          terrain:run.terrain,minMs:cohort.minMs,maxMs:cohort.maxMs,
          startedAt:now,deadline:now+cohort.minMs+Math.floor(sample*(cohort.maxMs-cohort.minMs))};
      }
      return wait;
    },
    safeAction(key, scope, label, category = "menu") {
      if (!this.automationAllowed()) return false;
      if (!this.enabled || !this.controlIdentityCurrent() || !this.autoManageCurrent()) return false;
      const account = this.app?.meta?.account;
      if (this.cadenceAccount !== account) {
        this.cadence.reset("account-changed");
        this.cadenceAccount = account;
      }
      const required=category==="selection"&&this.requiredSelectionWait(scope);
      if(required){
        this.cadenceAction=label;this.cadenceCategory=category;
        const remaining=Math.max(0,required.deadline-performance.now());
        if(remaining>0)this.status=`选择等待 · ${label}（${Math.ceil(remaining/1000)} 秒）`;
        // Higher-priority dwell replaces, rather than adds to, the configurable
        // cadence. Revalidation and native commit guards still run at dispatch.
        return remaining===0;
      }
      const state = this.app?.run?.state;
      const safe = !this.app?.run || ["modal", "paused", "over"].includes(state);
      const allowed = this.cadence.allow(key, { safe, stateScope: scope, settings: this.settings });
      this.cadenceAction = label;
      this.cadenceCategory = category;
      if (!allowed) this.status = `随机等待 · ${label}（${(this.cadence.snapshot().remainingMs / 1000).toFixed(1)} 秒）`;
      return allowed;
    },
    completeSafeAction(key, scope) {
      this.cadence.complete(key, { stateScope: scope });
      if(this.requiredSelectionPause?.modal===scope)this.requiredSelectionPause=null;
      this.cadenceAction = null;
      this.cadenceCategory = null;
    },
    cadenceSnapshot() {
      const state = this.cadence.snapshot();
      const wait=this.requiredSelectionPause;
      if(wait&&wait.run===this.app?.run&&wait.root===wait.run.ui?.modalEl&&
          wait.epoch===(this.controlEpoch||0)&&wait.app===this.app&&wait.account===this.app?.meta?.account&&this.enabled&&["modal","paused"].includes(wait.run.state)){
        const remainingMs=Math.max(0,wait.deadline-performance.now());
        return {...state,state:remainingMs>0?"waiting":"ready",waiting:remainingMs>0,remainingMs,
          action:this.cadenceAction||"处理暂停选择",category:"selection",until:wait.deadline,
          minMs:wait.minMs,maxMs:wait.maxMs,required:true};
      }
      return { ...state, waiting: state.state === "waiting", action: this.cadenceAction || state.key,
        category: this.cadenceCategory, until: state.deadline,
        minMs: state.settings.randomDelayMinMs, maxMs: state.settings.randomDelayMaxMs };
    },
    setSettings(next) {
      const priorRhythm = JSON.stringify(normalizeAutomationRhythm(this.settings));
      const priorBossRetreat = this.settings.bossRetreat === true;
      const priorForceCost = this.settings.forceCostInteractions === true;
      const priorTimedMovement = JSON.stringify(normalizeTimedMovementSettings(this.settings));
      const priorFlight = JSON.stringify([this.settings.flightMove,this.settings.flightNoInteractions,this.settings.flightKeepInteractions,this.settings.flightJumpItemCount]);
      const priorMode=this.settings.mode,priorBuildPriority=this.settings.autoManageBuildPriority;
      const boundTakeover=!!(this.enabled && this.autoManageScope);
      next = { ...next };
      if(Object.hasOwn(next,'modeSettings')&&(!next.modeSettings||typeof next.modeSettings!=='object'||Array.isArray(next.modeSettings)))
        delete next.modeSettings;
      for(const key of ['autoUpgrade','autoUnlockItems','autoClaim','reserveMoveSlot'])if(Object.hasOwn(next,key)&&typeof next[key]!=='boolean')delete next[key];
      if(Object.hasOwn(next,"shopPriority")&&typeof next.shopPriority!=="boolean")delete next.shopPriority;
      if(Object.hasOwn(next,"finalReplacements"))next.finalReplacements=mergeFinalReplacementEntries(this.settings.finalReplacements,next.finalReplacements);
      delete next.expertMode;
      const modeSettings = next.modeSettings && typeof next.modeSettings === "object" && !Array.isArray(next.modeSettings)
        ? Object.fromEntries(Object.entries(next.modeSettings).map(([mode,route]) => [mode,
          route && typeof route === "object" && !Array.isArray(route) ? {...this.settings.modeSettings?.[mode],...route} :
            ['appearance','wardrobe'].includes(mode)?{...this.settings.modeSettings?.[mode]}:route])) : null;
      if(modeSettings&&Object.hasOwn(modeSettings,'mutation'))modeSettings.mutation=normalizeMutationSettings(modeSettings.mutation,this.settings.modeSettings?.mutation);
      for(const mode of ['appearance','wardrobe'])if(modeSettings&&Object.hasOwn(modeSettings,mode))
        modeSettings[mode]={...(modeSettings[mode]&&typeof modeSettings[mode]==='object'&&!Array.isArray(modeSettings[mode])?modeSettings[mode]:{}),
          ...normalizeAppearanceSettings(modeSettings[mode],this.settings.modeSettings?.[mode])};
      const convenience=next.convenience && typeof next.convenience==="object" && !Array.isArray(next.convenience)
        ? {...this.settings.convenience,...next.convenience,...(next.convenience.coop && typeof next.convenience.coop==="object" && !Array.isArray(next.convenience.coop)
          ? {coop:{...this.settings.convenience?.coop,...next.convenience.coop}} : {})} : null;
      if (convenience && next.convenience?.rhythm && typeof next.convenience.rhythm === 'object' && !Array.isArray(next.convenience.rhythm))
        convenience.rhythm = {...this.settings.convenience?.rhythm, ...next.convenience.rhythm};
      this.settings = { ...this.settings, ...next,
        ...(convenience ? {convenience} : {}),
        ...(modeSettings ? {modeSettings:{...this.settings.modeSettings,...modeSettings}} : {}),
        ...(next.unlockTargets && typeof next.unlockTargets === "object" && !Array.isArray(next.unlockTargets)
          ? {unlockTargets:{...this.settings.unlockTargets,...next.unlockTargets}} : {}),
        ...(next.eventTargets && typeof next.eventTargets === "object" && !Array.isArray(next.eventTargets)
          ? {eventTargets:{...this.settings.eventTargets,...next.eventTargets}} : {}) };
      Object.assign(this.settings,normalizeFlightSettings(this.settings,next));
      Object.assign(this.settings,normalizeStageAndSlotSettings(this.settings));
      Object.assign(this.settings,normalizeCostSettings(this.settings));
      Object.assign(this.settings,normalizeTimedMovementSettings(this.settings));
      if(this.settings.shopPriority!==true)this.priorityShopScope=null;
      // Mode-card edits are next-run preferences. They must not cancel the
      // reminder's ownership of the currently paused, already-bound run.
      if(priorMode!==this.settings.mode&&!this.app?.run&&!this.restReminder)this.restReminderClock=null;
      if (priorTimedMovement !== JSON.stringify(normalizeTimedMovementSettings(this.settings))) this.invalidateTravelModeMotion();
      if (!priorForceCost && Object.hasOwn(next,"forceCostInteractions") && next.forceCostInteractions === true && this.settings.forceCostInteractions === true)
        this.costPriorityScope = null;
      if (priorBossRetreat !== this.settings.bossRetreat) this.invalidateBossRetreatMotion();
      if (priorFlight !== JSON.stringify([this.settings.flightMove,this.settings.flightNoInteractions,this.settings.flightKeepInteractions,this.settings.flightJumpItemCount]))
        this.invalidateFlightInteractionMotion();
      if(!this.settings.flightMove){
        this.flightTravelPlanner=null;this.flightControlScope=null;this.flightLandingScope=null;this.flightCollectionScope=null;
      }
      this.cadence.setSettings(this.settings);
      if (priorRhythm !== JSON.stringify(normalizeAutomationRhythm(this.settings))) {
        this.betweenRunWaitScope = null; this.betweenRunWaitLedger = new WeakMap();
        if (!effectiveAutomationRhythm(this.settings).inspectPanel && !this.panelInspection) this.panelInspectionRun = null;
        this.activationScheduleSnapshot();
      }
      if((priorMode==="autoManage" || this.autoManageSelected()) &&
          (priorMode!==this.settings.mode || priorBuildPriority!==this.settings.autoManageBuildPriority)) {
        this.controlEpoch=(this.controlEpoch||0)+1;this.startingAttempt=null;this.starting=false;
        this.cadence.reset("auto-manage-settings");
        if(this.enabled && this.autoManageSelected()) {
          if(!this.controlIdentityCurrent() || !this.autoManageCurrent())return;
          if(!boundTakeover || priorBuildPriority!==this.settings.autoManageBuildPriority) {
            this.plan=this.makePlan(this.app.run);this.planRun=this.app.run;
          }
        }
      }
      if (this.nextRunIntent === "automatic" && this.settings.autoRestart === false && !this.app?.run) {
        this.stop("自动连局已关闭，已取消下一局", { source: "auto-restart-disabled", code: "auto-restart-disabled" });
        return;
      }
      if (this.compatibility.state !== "blocked")
        this.status = "设置已保存，下局采用新的模式、角色和配装";
    },
    // Retain the old host command as a zero-write compatibility entry point.
    // Native aim, camera, graphics and automatic ultimate remain player settings.
    async prepareOperationSettings() {
      return { ok: true, state: "unchanged", reason: "保留玩家原生设置" };
    },
    async requestStart(request = {}) {
      const epoch = this.controlEpoch || 0, app = this.app,
        meta = app?.meta, account = meta?.account,
        takeoverRun=this.autoManageSelected()?app?.run:null, takeover=this.autoManageSelected();
      const current = () => (this.controlEpoch || 0) === epoch && this.app === app &&
        app?.meta === meta && meta?.account === account &&
        (!takeover || this.autoManageSelected() && app?.run===takeoverRun) &&
        (typeof request.isCurrent !== "function" || request.isCurrent());
      if (!current()) return false;
      if (!this.menuOperationsAllowed()) return this.start(request);
      await this.prepareOperationSettings();
      if (!current()) return false;
      if (!this.menuOperationsAllowed()) return this.start(request);
      return this.start(request);
    },
    releaseMouse() {
      this.mouseReleased = true;
      this.syncReleasedMouseAudio();
      this.observePointerLockInput();
      if (this.panelInspection?.run === this.app?.run) {
        const run = this.panelInspection.run;
        this.panelInspection = null;
        if (run.state === 'paused' && this.enabled && this.automationAllowed()) run.resume();
      }
      if (document.pointerLockElement && typeof document.exitPointerLock === "function") {
        this.mouseReleaseTicket = { run: this.app?.run, account: this.app?.meta?.account,
          epoch: this.controlEpoch || 0, enabled: this.enabled, until: performance.now() + 1500 };
        document.exitPointerLock();
      }
      return true;
    },
    start(request = {}) {
      if (request.source === 'host-recovery' && ['M2','M3'].includes(this.compatibility?.maintenanceScope?.stage) &&
          (!this.app?.run || this.app.run.state === 'over')) {
        this.stop('离线候选重连后请手动开始，未自动开新局',{source:'m2-manual-start-required',code:'m2-manual-start-required'});
        return false;
      }
      this.towerChoiceRestart = null;
      const priorDesired=this.controlIntent.desired;
      this.controlEpoch = (this.controlEpoch || 0) + 1;
      this.controlIdentityScope = null;
      this.startingAttempt = null;
      this.starting = false;
      this.documentLeaving = null;
      const source = request.source === "host-recovery" ? "host-recovery" : "user-start";
      this.setControlIntent("running", source, "start-request", "正在检查原生接口与账号状态");
      if (!this.syncCompatibility()) {
        this.enabled=true;this.pauseRequested=false;this.stopReason=null;
        this.status='挂机已启用：部分接口待连接，已保留启动请求；可用功能继续运行';
        this.setHealth('capability-wait',this.status);return true;
      }
      this.controlIdentityScope = this.app?.meta?.account ? {
        app: this.app, meta: this.app.meta, account: this.app.meta.account,
      } : null;
      if(this.autoManageSelected() && !this.autoManageRunAvailable(this.app.run)) {
        this.stop("自动托管：请先手动开始原生对局，再启动自动托管；不会自动开局",{
          source:"auto-manage-wait",code:"auto-manage-wait"});
        this.setHealth("takeover-wait",this.status);return false;
      }
      if (!this.activationScheduleSnapshot().allowed) {
        if (this.autoManageSelected()) this.bindAutoManage(this.app.run);
        this.enabled = true; this.pauseRequested = false; this.stopReason = null;
        this.manualStartRequested = this.app?.run?.state === 'over'; this.nextRunIntent = 'manual';
        this.automationAllowed(); return true;
      }
      if (!this.menuOperationsAllowed()) {
        if (this.controlIntent.code === 'm2-route-unavailable') return false;
        this.enabled=true;this.pauseRequested=false;this.stopReason=null;
        this.manualStartRequested=this.app?.run?.state === "over";this.nextRunIntent="manual";
        return false;
      }
      if(!this.app.run&&this.compatibility.capabilities?.menu===false){
        this.enabled=true;this.pauseRequested=false;this.stopReason=null;
        this.status='挂机已启用：开局所需的地图、角色或保存接口待修复';return true;
      }
      const waiting = this.accountWaitReason();
      if (waiting) {
        this.enabled = true;
        if(this.autoManageSelected())this.stop(waiting,{source:"auto-manage-wait",code:"auto-manage-wait"});
        this.status = waiting;
        this.setHealth("account-wait", waiting);
        return false;
      }
      if(this.autoManageSelected()) {
        const r=this.app.run, active=this.autoManageRunAvailable(r);
        if(request.source==="host-recovery" && (priorDesired!=="running" || !active || !this.autoManageScopeMatches(r))) {
          this.stop("自动托管不会在恢复后自行接管新对局，请确认当前原生对局后手动启动",{
            source:"auto-manage-recovery-wait",code:"auto-manage-recovery-wait"});return false;
        }
        if(!this.autoManageScopeMatches(r))this.autoManageScope=null;
        this.bindAutoManage(r);
      } else this.autoManageScope=null;
      if (
        this.app.run &&
        this.run !== this.app.run &&
        !this.attachRun(this.app.run)
      )
        return false;
      if(this.partialRunScope?.run===this.app.run){
        this.enabled=true;this.pauseRequested=false;this.stopReason=null;return true;
      }
      if (this.app.run && this.app.run.state !== "over")
        { this.plan = this.makePlan(this.app.run); this.planRun = this.app.run; }
      this.manualStartRequested = this.app?.run?.state === "over";
      this.nextRunIntent = "manual";
      this.cadence.reset("user-started");
      this.enabled = true;
      this.pauseRequested = false;
      this.stopReason = null;
      this.status = "运行中";
      this.setHealth("healthy", this.status);
      this.setControlIntent("running", source, "running", source === "host-recovery" ?
        "异常恢复后已重新接管；中断局按原生补存后再开局" : "用户已启动挂机");
      this.resumeRequested = this.app?.run?.state === "paused";
      this.resumeUntil = performance.now() + 1200;
      if (this.resumeRequested) this.resumeGame();
      this.cooperativeRevivalWaiting();
      return true;
    },
    accountWaitReason() {
      const meta = this.app?.meta;
      if (!meta?.account) return "请先在游戏中登录或选择游客";
      if (!meta.profile) return "等待游戏账号数据加载";
      if (!meta.profile.starter || !meta.profile.league?.length)
        return "请在游戏中选择初始宝可梦";
      return null;
    },
    resumeGame() {
      if (!this.automationAllowed()) return;
      const r = this.app?.run;
      if (r?.state !== "paused") return;
      // The game's own Continue button also works during the pointer-unlock
      // cooldown that intentionally ignores an immediate P/Escape key.
      const button = r.ui?.modalEl?.querySelector(nativeCompatSelector("button.green.big"));
      if (button && !button.disabled) button.click();
      else this.tap("pause", 400);
    },
    stop(reason = "用户停止", details = {}) {
      this.towerChoiceRestart = null;
      this.controlEpoch = (this.controlEpoch || 0) + 1;
      this.requiredSelectionPause=null;
      this.restReminder=null;this.restReminderClock=null;
      this.savedProfileRecovery=null;
      this.startingAttempt = null;
      this.starting = false;
      this.manualStartRequested = false;
      this.nextRunIntent = null;
      this.goalExposureScope = null;
      this.characterPracticeScope = null;
      this.characterFinishScope = null;
      this.finiteSettlementScope = null;
      this.priorityShopScope = null;
      if(details.source==="identity-changed"){this.autoManageScope=null;this.verifiedClearsScope=null;this.verifiedClears=[];}
      this.documentLeaving = null;
      this.panelInspection = null;
      this.panelInspectionRun = null;
      this.visibleMenuWait = null;
      this.characterInterRunMenu = null;
      this.betweenRunWaitScope = null;
      this.cadence.reset("user-paused");
      this.enabled = false;
      this.syncReleasedMouseAudio();
      this.pauseRequested = details.pauseGame === true ||
        details.source === "native-pause" && this.app?.run?.state === "paused";
      this.resumeRequested = false;
      this.stopReason = reason;
      const recoverable = details.recoverable === true && this.controlIntent.desired === "running";
      this.setControlIntent(recoverable ? "running" : "stopped", details.source || "user-stop",
        details.code || "user-stop", reason);
      this.setHealth(recoverable ? "controller-error" : "stopped", reason);
      this.interactionTracker.release();
      this.routeObservation = null;
      this.release(true);
      if (this.app?.input) this.app.input.dragLook = false;
      if (details.pauseGame === true && this.app?.run?.state === "play") {
        if (typeof this.app.run.pause === "function") this.app.run.pause();
        else this.tap("pause", 1);
      }
      this.status = reason;
    },
    recordEvent(event, settlementContext=null) {
      this.recordFiniteSettlementEvent(event);
      try { this.observeSettlementRetryEvent(event,settlementContext); } catch { /* Receipt observation cannot alter a native result. */ }
      this.events.push(event);
      if(this.events.length>300)this.events.splice(0,this.events.length-300);
      try { this.wecomPushObserver?.record(this,event); } catch { /* Optional notification observation preserves native results. */ }
    },
    configureWecomPush(value,expectedGeneration) {
      if(value===null&&typeof expectedGeneration==='string'&&this.wecomPushObserver?.config.generation!==expectedGeneration)return false;
      this.wecomPushObserver?.dispose();this.wecomPushObserver=null;
      if(value!==null)this.wecomPushObserver=createWecomPushObserver(value);
      return !!this.wecomPushObserver;
    },
    drainWecomPush() {
      return this.wecomPushObserver?.drain(this)||{generation:null,identityScope:null,facts:[],overflow:0};
    },
    recordHistory(entry) {
      this.history.push(entry);
      if(this.history.length>100)this.history.splice(0,this.history.length-100);
    },
    savedRewardsSnapshot() {
      const profile=this.savedUnlockProfileCurrent();
      if(!profile)return null;
      const result={};
      for(const field of ["seen","league","shinies","classics","forms","cosmetics","quests","itemsOwned","bonk","totalBonk","stardust","totalStardust","biomes","lab"])
        if(profile[field]!==undefined){const value=profile[field];result[field]=Array.isArray(value)?value.slice():value&&typeof value==="object"?{...value}:value;}
      return result;
    },
    snapshot() {
      this.currentVerifiedClears();
      const r =
          this.compatibility?.state === "blocked" &&
          this.compatibility?.phase === "run"
            ? null
            : this.app?.run,
        p = r?.player;
      const times = [...this.timings].sort((a, b) => a - b);
      let pushScope=null;
      try{if(this.wecomPushObserver)pushScope={wecomIdentityScope:this.wecomPushObserver.scope(this),
        wecomGeneration:this.wecomPushObserver.config.generation};}catch{}
      return {
        enabled: this.enabled,
        ...(pushScope||{}),
        control: this.controlSnapshot(),
        controlEpoch: this.controlEpoch || 0,
        activationSchedule: this.activationScheduleSnapshot(),
        betweenRunWait: this.betweenRunWaitSnapshot(),
        restReminder: this.restReminderSnapshot(),
        stopReason: this.stopReason,
        authentication: this.authenticationSnapshot(),
        health: { ...this.health,
          retryAt: this.health.retryAt == null ? null : Date.now() + Math.max(0, this.health.retryAt - performance.now()),
          retryInMs: this.health.retryAt == null ? null : Math.max(0, this.health.retryAt - performance.now()),
          nativeNoticeAcknowledgedAt: this.nativeNoticeAcknowledgedAt || null,
          saveObservationFailures: this.saveObservationFailureCount || 0,
          nativeSavedCard: this.nativeSavedNotice ? {
            observedAt: this.nativeSavedNotice.observedAt,
            acknowledgedAt: this.nativeSavedNotice.acknowledgedAt || null,
            rescued: this.nativeSavedNotice.rescued,
          } : null,
          online: typeof globalThis.navigator?.onLine === "boolean" ?
          globalThis.navigator.onLine : null, lastMacroAt: this.lastMacroAt || null,
          lastNativeUpdateAt: this.lastNativeUpdateAt || null },
        deploymentWait: this.deploymentWait,
        cadence: this.cadenceSnapshot(),
        tactics: {
          mastery:this.masteryState(r),
          assessment: this.tacticalAssessment?.assessment ? { ...this.tacticalAssessment.assessment } : null,
          progression: this.progressionDecision,
          reason: this.tacticalReason,
          altar: this.tacticalObjective ? {
            progress: this.tacticalObjective.progress, remaining: this.tacticalObjective.remaining,
            healthBudget: this.tacticalObjective.healthBudget,
          } : null,
          preferredMoves: this.plan?.build?.moves?.slice(0, 4),
          observedMoves: this.plan?.build?.observedMoves,
          choiceReason: this.lastChoiceReason,
          choiceTrace: (this.choiceTrace || []).slice(-12),
          battleRecords: recording()?.status() ?? { enabled: false },
          towerCleanup: this.towerCleanupState || null,
          finalReplacement: r?.player ? this.finalReplacement(r) : null,
          terrainRecovery: this.terrainRecoveryState || null,
          terrainHop: this.terrainHopState || null,
          crowdEscape: this.crowdEscapeState ? {
            active: this.crowdEscapeState.active, direction: this.crowdEscapeState.direction,
            target: this.crowdEscapeState.target, until: this.crowdEscapeState.until,
            attempts: this.crowdEscapeState.attempts, reason: this.crowdEscapeState.reason,
            healthBudget: this.crowdEscapeState.healthBudget, reserveHp: this.crowdEscapeState.reserveHp,
            close: this.crowdEscapeState.close, overlaps: this.crowdEscapeState.overlaps,
            blockedDirections: this.crowdEscapeState.blockedDirections,
            bodyCount: this.crowdEscapeState.bodies?.length || 0,
          } : null,
          exploration: this.explorationState || null,
          capturePursuit: r ? this.capturePursuitSnapshot(r) : null,
        },
        controllerVersion: config.revision,
        compatibility: { ...this.compatibility },
        accountType: this.app?.meta?.account
          ? this.app.meta.account.guest
            ? "guest"
            : "registered"
          : null,
        accountId: this.app?.meta?.account?.id || null,
        status: this.status,
        priority: this.plan?.priority,
        state: r?.state,
        nativeMode: r ? r.mutation ? "mutation" : r.tower ? "tower" : r.endless ? "endless" : "standard" : null,
        tower: r?.tower ? {floor:Number.isFinite(r.tower.floor) ? r.tower.floor : null,
          roof:r.tower.roof === true,beyond:r.tower.beyond === true,
          state:typeof r.tower.state === "string" ? r.tower.state : null,
          wave:Number.isFinite(r.tower.wave) ? r.tower.wave : null,
          tricks:Number.isFinite(r.tower.tricks) ? r.tower.tricks : null,
          trickRequested:this.towerTrickRequested(r),
          trickStatus:!r.interactables?.list?.some(object => object.kind === "tower" && object.data?.sub === "trick")
            ? "not-spawned" : r.interactables.list.some(object => object.kind === "tower" && object.data?.sub === "trick" && !object.used)
              ? "available" : "used"} : null,
        biome: r?.biome?.id,
        tier: r?.tier,
        stage: r?.stage,
        leaderboardCamp: this.leaderboardCampState(r),
        level: p?.level,
        hp: p?.hp,
        maxHp: p?.maxHp,
        time: r?.time,
        kills: r?.stats?.kills,
        damageTaken: r?.stats?.damageTaken,
        hits: r?.stats?.hits,
        lastHit: p?.lastHit,
        bossMechanics: r?.boss?.kit
          ? {
              phase: r.boss.kit.phase,
              cataclysm: this.coverWarning
                ? {
                    x: this.coverWarning.x,
                    y: this.coverWarning.y,
                    z: this.coverWarning.z,
                    impact: this.coverWarning.impact,
                    eta: this.coverWarning.impact - r.time,
                    hidden: this.cataclysmHidden(r, p.pos),
                  }
                : null,
              lastCover: this.lastCoverResult,
            }
          : null,
        recentDamage: this.damageLog.slice(-12),
        combat: p
          ? {
              species: p.speciesId,
              stats: { ...p.stats },
              items: [...(p.items?.entries?.() || [])],
              moves: p.moves.filter(Boolean).map((m) => ({
                key: m.def.key,
                arch: m.def.arch,
                level: m.level,
                mods: m.mods,
              })),
              velocity: p.vel ? { x: p.vel.x, y: p.vel.y, z: p.vel.z } : null,
              slideT: p.slideT,
              grounded: p.grounded,
              boss: r?.boss?.alive
                ? {
                    species: r.enemies.species[r.boss.bossIndex],
                    pattern: r.boss.last,
                    chargeT: r.boss.chargeT,
                    hold: r.boss.hold,
                  }
                : null,
            }
          : null,
        lastBossAttack: this.lastBossAttack,
        bosses: r?.stats?.bosses,
        bossHp: r?.boss?.alive ? r.enemies.hp[r.boss.bossIndex] : null,
        bossMaxHp: r?.boss?.alive ? r.enemies.maxHp[r.boss.bossIndex] : null,
        lockTarget: r?.lockTarget,
        bossTarget: r?.boss?.bossIndex,
        waves: r?.boss?.waves?.length,
        moves: p?.moves?.filter(Boolean).map((m) => m.def.key),
        gold: r?.gold,
        target: this.target?.label,
        frames: this.frames,
        position: p ? { x: p.pos.x, y: p.pos.y, z: p.pos.z } : null,
        unknownInteractions: this.unknownInteractions || [],
        interactionCoverage: {
          ...(this.bridge?.compatibility?.interactionCoverage || {}),
          unknownWorldTypes: [...new Set([
            ...(this.bridge?.compatibility?.interactionCoverage?.unknownWorldTypes || []),
            ...(this.unknownInteractions || []),
          ])],
          runtimeUnknownModal: this.modal?.kind === "unknown",
        },
        towerActivity: this.liveTowerEvent(),
        eventModes: this.activityModeStates(),
        unlockProgress: this.unlockProgressSnapshot(),
        profileVerification: this.profileVerificationSnapshot(),
        rewardsProfile: this.savedRewardsSnapshot(),
        operation: this.lastOperation || null,
        mouseReleased: !!this.mouseReleased,
        targetHeight: this.target?.y,
        targetDistance: p && this.target ? distance(p.pos, this.target) : null,
        navigation: this.navigation
          ? {
              done: this.navigation.done,
              failed: this.navigation.failed,
              nodes: this.navigation.nodes.size,
              waypoints: this.navigation.path.length,
            }
          : null,
        meanDecisionMs: this.frames ? this.totalMs / this.frames : 0,
        p95DecisionMs: times[Math.floor(times.length * 0.95)] || 0,
        maxDecisionMs: this.maxMs,
        gameFps: r?.playFps,
        stardust: this.app?.meta?.profile?.stardust,
        seen: this.app?.meta?.profile?.seen?.length,
        league: this.app?.meta?.profile?.league?.length,
        profile: this.app?.meta?.profile
          ? {
              league: this.app.meta.profile.league,
              seen: this.app.meta.profile.seen,
              biomes: this.app.meta.profile.biomes,
              stardust: this.app.meta.profile.stardust,
              totalStardust: this.app.meta.profile.totalStardust,
              lab: this.app.meta.profile.lab,
              played: this.app.meta.profile.played,
              shinies: (this.app.meta.profile.shinies || []).slice(),
              shinyOwnedIds: (this.app.meta.profile.shinies || []).slice(),
              classics: (this.app.meta.profile.classics || []).slice(),
              shinyStones: this.app.meta.profile.bag?.["shiny-stone"] || 0,
              tasks: this.tasks(),
            }
          : null,
        characterId: this.plan?.species,
        buildId: this.plan?.build?.id || "generic",
        unlockTarget: this.plan?.unlockTarget,
        objectiveNeeds: this.plan?.needs,
        shiny: this.shinySnapshot(),
        savePending: this.savePending,
        events: this.events.slice(-40),
        settings: this.settings,
        plan: this.plan
          ? {
              priority: this.plan.priority,
              objective: this.plan.objective,
              species: this.plan.species,
              unlockTarget: this.plan.unlockTarget,
              need: this.plan.need,
              needs: this.plan.needs,
              nativeConditions: this.plan.nativeConditions,
              adoptedRun: this.plan.adoptedRun === true,
              currentLoadout: this.plan.currentLoadout,
              goalMode: this.plan.goalMode,
              mutationPlan: this.plan.mutationPlan?{...this.plan.mutationPlan,rules:[...(this.plan.mutationPlan.rules||[])],
                rewards:{...this.plan.mutationPlan.rewards}}:null,
              towerGoal: this.plan.towerGoal ? { ...this.plan.towerGoal } : null,
              mastery:this.plan.mastery ? {...this.plan.mastery} : null,
              mode: this.plan.mode,
              biome: this.plan.biome, tier: this.plan.tier,
              modePreference: this.plan.modePreference,
              difficultyReason: this.plan.difficultyReason,
              preferenceOverride: this.plan.preferenceOverride,
              nextTargetWait: this.plan.nextTargetWait,
            }
          : null,
        errors: this.errors.slice(-4),
        history: this.history.slice(-5),
      };
    },
    shinyName(id) {
      return (
        config.shinyCatalog?.species?.find((v) => v.id === id)?.name ||
        this.bridge?.data?.get?.(id)?.name ||
        `#${id}`
      );
    },
    shinySnapshot() {
      const profile = this.app?.meta?.profile;
      if (!profile) return null;
      let plan;
      try {
        plan =
          typeof selectShinyPlan === "function"
            ? selectShinyPlan(
                profile,
                { ...this.settings, mode: "shiny" },
                {
                  ...this.bridge,
                  meta: this.app.meta,
                  shinyCatalog: config.shinyCatalog,
                  classicSpeciesEligibility: config.unlockCatalog?.rules?.classicSpeciesEligibility,
                },
              )
            : null;
      } catch {}
      return {
        mode: this.settings.shinyMode,
        types: normalizeShinyTypes(this.settings.shinyTypes),
        targetId: this.settings.shinyTargetId,
        targetName: this.settings.shinyTargetId
          ? this.shinyName(this.settings.shinyTargetId)
          : null,
        owned: shinyOwnedForTypes(profile,this.settings.shinyTypes).length,
        ownedIds: shinyOwnedForTypes(profile,this.settings.shinyTypes),
        classicOwnedIds: (profile.classics || []).slice(),
        total: 151,
        huntableMissing: plan?.eligibleTargets?.length || 0,
        encounters: this.shinyEncounters,
        captures: this.shinyCaptures,
        runCaptures: (this.app?.run?.stats?.shinies?.length || 0)+(this.app?.run?.stats?.classics?.length || 0),
        complete:
          plan?.shinyStatus === "complete" &&
          (!this.shinyFinishReason || this.shinyFinishSaved),
        status: plan?.shinyStatus,
        pendingSave: !!this.shinyFinishReason && !this.shinyFinishSaved,
        message:
          this.shinyFinishReason && !this.shinyFinishSaved
            ? "目标已在本局捕获，等待游戏结算保存确认"
            : plan?.need,
        targets:
          typeof describeShinyTargets === "function"
            ? describeShinyTargets(profile, this.settings, {
                ...this.bridge,
                meta: this.app.meta,
                shinyCatalog: config.shinyCatalog,
                classicSpeciesEligibility: config.unlockCatalog?.rules?.classicSpeciesEligibility,
              })
            : undefined,
        familySuppressed: plan?.familySuppressed,
        sources: plan?.shinySources,
        stones: profile.bag?.["shiny-stone"] || 0,
      };
    },
    observeShinies(r) {
      const capture = r?.capture;
      if (!capture) return;
      const self = this;
      if (typeof capture.caught === "function" && !capture.caught.__pbShiny) {
        const original = capture.caught;
        capture[this.nativeMemberKey(capture,"caught")] = function (...args) {
          let pushBefore=null;try{pushBefore=self.wecomPushObserver?.captureBefore(self,r,this);}catch{}
          const before = (r.stats?.shinies?.length || 0)+(r.stats?.classics?.length || 0),
            species = this.species, shinyType=this.classic?'classic':'shiny';
          const result = original.apply(this, args);
          try{self.wecomPushObserver?.captureAfter(self,r,this,pushBefore);}catch{}
          if ((r.stats?.shinies?.length || 0)+(r.stats?.classics?.length || 0) > before) {
            self.shinyCaptures++;
            self.recordEvent({
              id: `shiny-caught-${self.runStartedAt}-${shinyType}-${species}-${before}`,
              kind: "shinyCapture",
              at: Date.now(),
              species,
              shinyType,
              message: `本局捕获${shinyType==='classic'?'经典异色':'异色'}${self.shinyName(species)}，等待结算保存`,
            });
            if (
              (self.plan?.goalMode || self.selectedGoalMode()) === "shiny" &&
              self.explicitShinyTarget() && self.settings.shinyStopWhenDone !== false
            ) {
              const next = selectShinyPlan(
                self.app.meta.profile,
                self.settings,
                {
                  ...self.bridge,
                  meta: self.app.meta,
                  shinyCatalog: config.shinyCatalog,
                  classicSpeciesEligibility: config.unlockCatalog?.rules?.classicSpeciesEligibility,
                },
              );
              if (next?.shinyStatus === "complete")
                self.shinyFinishReason = "异色目标已完成";
            }
          }
          return result;
        };
        capture.caught.__pbShiny = true;
      }
      if (
        !["roaming", "weakened", "throwing"].includes(capture.state) ||
        !(capture.shiny || capture.classic)
      )
        return;
      const shinyType=capture.classic?'classic':'shiny';
      const key = `${this.runStartedAt}-${r.stage}-${shinyType}-${r.enemies?.gen?.[capture.index]??''}-${capture.index}-${capture.species}`;
      this.shinySeenKeys ||= new Set();
      if (this.shinySeenKeys.has(key)) return;
      this.shinySeenKeys.add(key);
      this.shinyEncounters++;
      this.recordEvent({
        id: `shiny-seen-${key}`,
        kind: "shinyEncounter",
        at: Date.now(),
        species: capture.species,
        shinyType,
        message: `发现${shinyType==='classic'?'经典异色':'异色'}${this.shinyName(capture.species)}，按当前捕捉设置处理`,
      });
      if(!this.shinyHuntCaptureAllowed(r,capture))return;
      this.target = null;
      this.routeObservation = null;
      this.lastWorld = -Infinity;
    },
    preserveShinyOpportunity(r) {
      // Explicit catch priority means catching the encounter that actually
      // exists, including ordinary legendaries. The older shiny-only route
      // protection remains available when that priority is disabled.
      if (this.settings.capturePriority !== false) return false;
      const c = r?.capture, executedMode = this.plan?.goalMode || this.selectedGoalMode();
      const protectedGoal = this.plan?.goalProgress
        ? c?.species === 150 && (executedMode === "shiny" || this.plan.objective === "shiny" &&
          (this.plan.shinyTargetId === 150 || this.plan.unlockAction?.protectNonShinyCapture === true))
        : executedMode === "shiny" && [144, 145, 150].includes(c?.species);
      return (
        protectedGoal &&
        c &&
        !c.shiny &&
        !c.classic &&
        ["roaming", "weakened", "throwing"].includes(c.state) &&
        !(this.app.meta.profile.shinies || []).includes(c.species) &&
        !(this.app.meta.profile.league || []).includes(c.species)
      );
    },
    captureOpportunity(r, index) {
      const en = r?.enemies, capture = r?.capture, allies = r?.allies;
      if (!Number.isInteger(index) || index < 0 || !en?.alive?.[index] || (en.dying?.[index] || 0) > 0) return null;
      const species = en.species?.[index], gen = en.gen?.[index], flags = en.flags?.[index] || 0,
        activeCapture = capture?.index === index && capture.species === species &&
          ["roaming", "weakened", "throwing"].includes(capture.state),
        activeAlly = allies?.down === index && (allies.gen == null || gen == null || allies.gen === gen) &&
          ["down", "throwing"].includes(allies.state),
        shiny = !!(flags & 2048) || activeCapture && capture.shiny === true,
        classic = !!(flags & 131072) || activeCapture && capture.classic === true,
        source = activeCapture ? "capture" : activeAlly ? "ally" : shiny || classic ? "shiny" : flags & 2 ? "ally" : null;
      if (!source) return null;
      const state = activeCapture ? capture.state : activeAlly ? allies.state : "roaming",
        timer = activeCapture && state === "roaming" ? capture.escapeT :
          activeCapture && state === "weakened" && !capture.sure ? capture.weakT :
          activeAlly && state === "down" ? allies.downT : null,
        remaining = typeof timer === "number" && Number.isFinite(timer) ? Math.max(0, timer) : null;
      return { index, gen, species, flags, source, state, shiny, classic, remaining,
        deadlineAt: remaining == null ? null : r.time + remaining,
        deadlineKind: activeCapture && state === "roaming" ? "native-capture-escape" :
          activeCapture && state === "weakened" ? capture.sure ? "native-guaranteed-capture" : "native-weakened-window" :
          activeAlly && state === "down" ? "native-alpha-down-window" : null,
        key: `${index}:${gen ?? species}:${species}` };
    },
    shinyHuntCaptureAllowed(r,opportunity) {
      const type=opportunity?.classic?'classic':opportunity?.shiny?'shiny':null;
      return !type || shinyHuntTypeAllowed(type,this.settings,this.plan || {});
    },
    executedShinyTypes() {
      return (this.plan?.goalMode || this.settings.mode)==='shiny'?normalizeShinyTypes(this.settings.shinyTypes):null;
    },
    priorityCapturePending(r) {
      const en = r?.enemies;
      const classicTargets = this.executedShinyTypes() ? [] : this.plan?.classicTargetIds || [];
      if (!en || this.settings.capturePriority === false && this.settings.shinyPriority === false && !classicTargets.length) return false;
      for (let index = 0, count = en.n ?? en.alive?.length ?? 0; index < count; index++) {
        const opportunity = this.captureOpportunity(r, index);
        if (opportunity && this.shinyHuntCaptureAllowed(r,opportunity) && (opportunity.classic && classicTargets.includes(opportunity.species) ||
            (opportunity.shiny || opportunity.classic) && this.settings.shinyPriority !== false ||
            this.settings.capturePriority !== false && (opportunity.source === "capture" || opportunity.source === "ally" || opportunity.flags & 2))) return true;
      }
      return false;
    },
    capturePursuitSnapshot(r) {
      const opportunity = this.captureOpportunity(r, this.target?.enemyIndex);
      if (!opportunity) return null;
      const entry = this.capturePursuitScope === r && this.capturePursuitStage === r.stage &&
        this.capturePursuitTerrain === r.terrain ? this.capturePursuits?.get(opportunity.key) : null;
      return { ...opportunity, repaths:entry?.repaths || 0, noProgressFor:entry?.noProgress || 0,
        stalls:entry?.stalls || 0, retryUntil:entry?.until || null, retryReason:entry?.retryReason || null,
        nativeAttempts:entry?.nativeAttempts || 0 };
    },
    minibossEntryCurrent(scope, entry) {
      if(!entry||typeof entry!=="object")return false;
      let observed=scope.entries.get(entry);
      if(!observed||observed.gen!==entry.gen){
        observed={token:scope.token,gen:entry.gen};scope.entries.set(entry,observed);
      }
      return observed.token===scope.token;
    },
    observeCombat(r) {
      this.wrapOwner(r?.combat, "eliteBurst", "enemy");
      for (const method of ["update", "tick"])
        this.wrapOwner(r?.director, method, "enemy");
      const minibosses = r?.minibosses;
      if (r && (!this.minibossChargeObservation ||
          this.minibossChargeObservation.run !== r || this.minibossChargeObservation.stage !== r.stage ||
          this.minibossChargeObservation.terrain !== r.terrain || this.minibossChargeObservation.owner !== minibosses ||
          !this.minibossChargeObservation.entries)) {
        const previous = this.minibossChargeObservation;
        const invalid = previous?.run === r ? previous.invalid : new WeakSet();
        if (previous?.run === r && previous.stage!==r.stage)
          for (const entry of previous.seen || []) invalid.add(entry);
        // Weak keys preserve rejection of a surviving old-stage actor without
        // retaining every native miniboss removed during a long stage/run.
        const entries=previous?.run===r&&previous.entries||new WeakMap(),token={};
        const scope=this.minibossChargeObservation = { run: r, stage: r.stage, terrain:r.terrain,owner:minibosses,warnings: new Map(),
          entries,token,invalid };
        for(const entry of minibosses?.list||[])this.minibossEntryCurrent(scope,entry);
      }
      if (typeof minibosses?.charge === "function" && !minibosses.charge.__pbMinibossCharge) {
        const originalCharge = minibosses.charge, self = this;
        minibosses[this.nativeMemberKey(minibosses,"charge")] = function (entry, ...rest) {
          const en = r.enemies, p = r.player?.pos, index = entry?.i;
          const dx = p?.x - en?.x?.[index], dz = p?.z - en?.z?.[index];
          const length = Math.hypot(dx, dz), scale = length || 1;
          const observed = Number.isFinite(length) && Number.isFinite(r.time)
            ? { run: r, stage: r.stage, gen: entry?.gen, start: r.time + 0.95,
                dx: dx / scale, dz: dz / scale, distance: Math.min(24, scale + 6) } : null;
          // Observe an attack that native code has actually started. Preserve
          // its receiver, arguments, callback scheduling, RNG and return value.
          const result = originalCharge.call(this, entry, ...rest);
          const scope = self.minibossChargeObservation;
          if (observed && scope?.run === r && scope.stage === r.stage &&
              scope.terrain===r.terrain&&scope.owner===this&&r.minibosses===this&&
              self.run === r && this.list?.includes(entry) && !scope.invalid.has(entry) && self.minibossEntryCurrent(scope,entry) &&
              entry?.kind === "totem" && entry.phys === "charge" &&
              Number.isInteger(index) && index >= 0 && Number.isInteger(entry.gen) &&
              en?.alive?.[index] && en.gen?.[index] === entry.gen) {
            scope.warnings.set(entry, observed);
          }
          return result;
        };
        minibosses.charge.__pbMinibossCharge = true;
      }
      const guardian = r?.boss;
      if (r && (!this.guardianChargeObservation || this.guardianChargeObservation.run !== r ||
          this.guardianChargeObservation.stage !== r.stage || this.guardianChargeObservation.boss !== guardian)) {
        const previous = this.guardianChargeObservation;
        const invalid = previous?.run === r ? previous.invalid : new Set();
        if (previous?.run === r) for (const key of previous.seen) invalid.add(key);
        if (previous?.run === r && previous.boss === guardian && guardian?.alive && previous.stage !== r.stage)
          invalid.add(`${guardian.bossIndex}:${r.enemies?.gen?.[guardian.bossIndex]}`);
        this.guardianChargeObservation = { run: r, stage: r.stage, boss: guardian,
          warning: null, actor: null, seen: new Set(), invalid };
      }
      if (guardian && !guardian.alive && this.guardianChargeObservation)
        this.guardianChargeObservation.actor = null;
      for (const method of ["charge", "sigCharge", "sigCross"]) {
        if (typeof guardian?.[method] !== "function" || guardian[method].__pbGuardianCharge) continue;
        const original = guardian[method], self = this;
        guardian[this.nativeMemberKey(guardian,method)] = function (...args) {
          const index = args[0], en = r.enemies, pos = r.player?.pos,
            dx = pos?.x - en?.x?.[index], dz = pos?.z - en?.z?.[index],
            length = Math.hypot(dx, dz), scale = length || 1,
            tk = this.tk, start = r.time + tk * (method === "charge" ? 0.75 :
              method === "sigCharge" ? 0.8 : 1.2 + (this.enraged ? 0.2 : 0)),
            observed = [length, tk, start, pos?.x, pos?.z].every(Number.isFinite) && tk >= 0
              ? { stage: r.stage, index, gen: en?.gen?.[index], method, start,
                  dx: dx / scale, dz: dz / scale, targetX: pos.x, targetZ: pos.z,
                  speed: method === "charge" ? 30 : method === "sigCharge" ? 42 : 34,
                  duration: method === "charge" ? 0.75 : method === "sigCharge"
                    ? Math.min(30, scale + 8) / 42 : 0.7 } : null;
          // Only observe a native method that was actually invoked. In
          // particular sigCross keeps its own random line angles and callbacks.
          const result = original.apply(this, args);
          const scope = self.guardianChargeObservation;
          if (observed && scope?.run === r && scope.boss === this && scope.stage === r.stage &&
              self.run === r && r.boss === this && this.alive && !this.kit &&
              index === this.bossIndex && Number.isInteger(index) && index >= 0 &&
              Number.isInteger(observed.gen) && en?.alive?.[index] && !en.dying?.[index] &&
              en.gen[index] === observed.gen && !scope.invalid.has(`${index}:${observed.gen}`) &&
              (!scope.actor || scope.actor.index === index && scope.actor.gen === observed.gen)) {
            scope.actor = { index, gen: observed.gen };
            scope.seen.add(`${index}:${observed.gen}`);
            scope.warning = observed;
          }
          return result;
        };
        guardian[method].__pbGuardianCharge = true;
      }
      const kit = r?.boss?.kit;
      const index = r?.boss?.bossIndex, gen = r?.enemies?.gen?.[index];
      const priorLegendary = this.legendaryObservation;
      if (!priorLegendary || priorLegendary.run !== r || priorLegendary.stage !== r?.stage ||
          priorLegendary.kit !== kit || priorLegendary.index !== index || priorLegendary.gen !== gen ||
          !r?.boss?.alive || kit?.dead || r?.state === "over")
        this.legendaryObservation = {run:r,stage:r?.stage,kit,index,gen};
      if(r?.biome?.sanctuary?.arena==='volcano'&&r.enemies?.species?.[index]===6&&
          typeof kit?.starSlam==='function'&&!kit.starSlam.__pbStarSlam){
        const original=kit.starSlam,self=this;
        kit[this.nativeMemberKey(kit,'starSlam')]=function(angle,windup,...rest){
          const warning=charizardStarWarning(this,angle,windup),scope=self.legendaryObservation;
          if(warning&&scope?.run===r&&scope.kit===this&&scope.gen===r.enemies.gen[index]&&r.boss.alive){
            scope.starSlams=(scope.starSlams||[]).filter(w=>w.until>r.time);scope.starSlams.push(warning);
          }
          return original.call(this,angle,windup,...rest);
        };
        kit.starSlam.__pbStarSlam=true;
      }
      for (const [method,key,delay] of [["ultimate","zapdosUltimate",4.4],["electricSea","zapdosSea",1.9]]) {
        if (r?.enemies?.species?.[index] !== 145 || typeof kit?.[method] !== "function" || kit[method].__pbLegendary) continue;
        const original = kit[method], self = this;
        kit[this.nativeMemberKey(kit,method)] = function (...args) {
          const at = r.time, stage = r.stage, generation = r.enemies?.gen?.[index],
            validSea = method !== "electricSea" || !!this.S,
            previousOwner = self.owner, previousSource = self.ownerSource;
          self.owner = "enemy"; self.ownerSource = this;
          let result;
          try { result = original.apply(this,args); }
          finally { self.owner = previousOwner; self.ownerSource = previousSource; }
          const scope = self.legendaryObservation;
          if (validSea && scope?.run === r && scope.stage === stage && r.stage === stage &&
              self.run === r && r.boss?.alive && r.boss.kit === this && scope.kit === this &&
              scope.index === index && scope.gen === generation && Number.isInteger(generation) &&
              r.enemies?.alive?.[index] && r.enemies.gen[index] === generation && !this.dead && Number.isFinite(at))
            scope[key] = {run:r,kit:this,index,gen:generation,impact:at+delay,until:at+delay+.2};
          return result;
        };
        kit[method].__pbLegendary = true;
      }
      if (kit?.quake && !kit.quake.__pbQuake) {
        const original = kit.quake,
          self = this;
        kit[this.nativeMemberKey(kit,"quake")] = function (...args) {
          self.quakeWarning = {
            x: this.bx,
            z: this.bz,
            start: r.time + 0.7,
            end: r.time + 1.9,
            kit: this,
            locked: false,
          };
          return original.apply(this, args);
        };
        kit.quake.__pbQuake = true;
      }
      if (kit?.cataclysm && !kit.cataclysm.__pbCover) {
        const original = kit.cataclysm,
          self = this;
        kit[this.nativeMemberKey(kit,"cataclysm")] = function (x, y, z, windup, ...rest) {
          self.coverWarning = {
            x,
            y,
            z,
            impact: r.time + windup,
            until: r.time + windup + 0.15,
          };
          self.lastWorld = -Infinity;
          return original.call(this, x, y, z, windup, ...rest);
        };
        kit.cataclysm.__pbCover = true;
      }
      if (kit?.line && !kit.line.__pbWarning) {
        const originalLine = kit.line,
          self = this;
        kit[this.nativeMemberKey(kit,"line")] = function (x, z, x2, z2, radius, delay, damage, ...rest) {
          if (this.species === 146 && this.last === "dive" && damage === 0)
            self.hazards.push({
              x,
              z,
              x2,
              z2,
              radius: 2.6,
              y: r.terrain.height?.(x, z),
              maxHeight: 1.6,
              persistent: true,
              impact: r.time + delay,
              until: r.time + delay + 0.5,
              owner: "enemy",
            });
          if (damage > 0)
            self.hazards.push({
              x,
              z,
              x2,
              z2,
              radius,
              y: r.terrain.height?.(x, z),
              maxHeight: 1.3,
              oneShot: true,
              impact: r.time + delay,
              until: r.time + delay + 0.1,
              owner: "enemy",
            });
          return originalLine.call(
            this,
            x,
            z,
            x2,
            z2,
            radius,
            delay,
            damage,
            ...rest,
          );
        };
        kit.line.__pbWarning = true;
      }
      if (
        !r?.player ||
        typeof r.player.hurt !== "function" ||
        r.player.hurt.__pbCombat
      )
        return;
      const self = this,
        original = r.player.hurt;
      r.player[this.nativeMemberKey(r.player,"hurt")] = function (...args) {
        const before = this.hp,
          shield = this.shield,
          preHurtIframes = this.iframes,
          preHurtInvisT = this.invisT;
        const result = original.apply(this, args);
        if (this.hp < before || this.shield < shield) {
          const en = r.enemies,
            pos = this.pos,
            nearby = [];
          for (let i = 0; i < (en.n || 0); i++) {
            if (!en.alive[i] || en.dying[i] > 0) continue;
            const d = Math.hypot(en.x[i] - pos.x, en.z[i] - pos.z);
            if (d < 10)
              nearby.push({
                species: en.species[i],
                d: +d.toFixed(2),
                flags: en.flags[i],
                hp: en.hp[i],
              });
          }
          self.damageLog.push({
            time: r.time,
            stage: r.stage,
            hp: this.hp,
            lost: before - this.hp,
            shieldLost: Math.max(0, shield - this.shield),
            source:
              args[7] && typeof args[7] === "object"
                ? { kind: args[7].kind, species: args[7].species }
                : null,
            raw: args[0],
            type: args[1],
            enemyIndex: args[2],
            preHurtIframes,
            preHurtInvisT,
            enemy:
              args[2] >= 0 && en.alive[args[2]]
                ? {
                    x: en.x[args[2]],
                    y: en.y[args[2]],
                    z: en.z[args[2]],
                    hgt: en.hgt[args[2]],
                    vx: en.vx[args[2]],
                    vz: en.vz[args[2]],
                    atk: en.atk[args[2]],
                    gen: en.gen?.[args[2]],
                  }
                : null,
            lastHit: this.lastHit
              ? { kind: this.lastHit.kind, species: this.lastHit.species }
              : null,
            pos: { x: pos.x, y: pos.y, z: pos.z },
            vel: { x: this.vel.x, y: this.vel.y, z: this.vel.z },
            grounded: this.grounded,
            slideT: this.slideT,
            target: self.target?.label,
            motion: self.lastMotion,
            boss: r.boss?.alive
              ? {
                  last: r.boss.last,
                  chargeT: r.boss.chargeT,
                  hold: r.boss.hold,
                }
              : null,
            nearby: nearby.sort((a, b) => a.d - b.d).slice(0, 5),
          });
          if (self.damageLog.length > 80) self.damageLog.shift();
        }
        return result;
      };
      r.player.hurt.__pbCombat = true;
    },
    withinArena(r, x, z, margin = 2) {
      if (!r.terrain.inBounds(x, z, margin)) {
        // Tower.inBounds uses a spawning inset, but the real Player can stand
        // as far out as arenaR-.3. Once there, rejecting every small inward
        // frame would make the inset itself an impassable wall. Recover only
        // monotonically inward through a native non-solid point; real terrain
        // footprints/collisions still decide the submitted movement.
        const physicalRadius=Number(r.terrain.arenaR),pos=r.player?.pos,
          before=Math.hypot(pos?.x,pos?.z),after=Math.hypot(x,z),
          inward=r.terrain.arena?.tower&&Number.isFinite(physicalRadius)&&physicalRadius>.3&&
            Number.isFinite(before)&&before>=physicalRadius-Math.max(.3,Math.max(0,margin)*.5)&&
            after<before-1e-5&&typeof r.terrain.inSolid==='function'&&r.terrain.inSolid(x,z)===false;
        if(inward)return nativeCircleRouteAllowed(r,x,z,margin);
        // Current native inBounds is also a spawn exclusion: it rejects the
        // open stair ramp's solidBox although Player still walks its physical
        // height/colliders. If already on that ramp, allow only a bounded walk
        // back towards its real E landmark. Other solids and entry stairs stay
        // excluded; no native geometry or collision flag is changed.
        const stairs=r.terrain.arena?.tower?.stairs,
          onRamp=point=>stairs&&[stairs.x,stairs.z,stairs.w,stairs.len,point?.x,point?.z].every(Number.isFinite)&&
            Math.abs(point.x-stairs.x)<stairs.w/2 && point.z<stairs.z && point.z>stairs.z-stairs.len;
        if(r.tower?.state!=="clear"||r.tower.roof||!onRamp(pos)||!onRamp({x,z})||
          !r.terrain.inSolid?.(pos.x,pos.z)||!r.terrain.inSolid?.(x,z)||
          Math.hypot(x,z)>=r.terrain.arenaR-margin*.5||
          Math.hypot(x-stairs.x,z-stairs.z)>Math.hypot(pos.x-stairs.x,pos.z-stairs.z)+.01)return false;
      }
      return nativeCircleRouteAllowed(r, x, z, margin);
    },
    towerPolicy(r = this.app?.run) {
      const policy=resolveTowerPolicy(r, this.settings, this.plan || {});
      if(r?.tower&&this.plan?.unlockAction?.kind==="qualify-ranking"&&this.plan.qualification?.mode==="tower")
        return {...policy,exitPolicy:"continue",constraintConflict:false};
      if(r?.tower&&["wardrobe","allClears"].includes(this.plan?.goalMode))return {...policy,exitPolicy:"continue",constraintConflict:false,
        ...(this.plan.towerGoal?.noCandles===true?{noCandles:true,avoidCandles:true}:{})};
      return this.autoManageSelected()?{...policy,exitPolicy:"continue"}:policy;
    },
    towerTrickRequested(r = this.app?.run) {
      if (!r?.tower) return false;
      const start=this.settings.modeSettings?.tower?.tombExperienceFloor;
      if(Number.isInteger(start) && start>=1 && start<=100)
        return r.tower.floor<start && Number.isFinite(r.player?.stats?.luck) && r.player.stats.luck>=125;
      if (this.settings.modeSettings?.tower?.onlyExperience === true || this.settings.modeSettings?.tower?.experienceBlessingPriority === true) return false;
      const explicit=this.settings.modeSettings?.tower?.trickPolicy;
      if(explicit==='treat'||explicit==='trick')return towerTradePreference(this.settings.modeSettings.tower,r,false);
      return Number.isFinite(r.player?.stats?.luck) && r.player.stats.luck >= 125;
    },
    towerMoneyPolicy(r = this.app?.run) {
      const floor=Number(r?.tower?.floor), enabled=!!r?.tower && Number.isInteger(floor) &&
        this.settings.modeSettings?.tower?.saveMoneyAfter50===true;
      return {active:enabled&&floor>=50&&floor<=68,spend:enabled&&[58,68].includes(floor),
        preview:enabled&&floor>=20&&floor<50};
    },
    towerShopPreviewPending(r) {
      const visit=this.towerShopPreviewVisit;
      return this.towerMoneyPolicy(r).preview && !(visit?.run===r && visit.terrain===r.terrain && visit.floor===r.tower.floor);
    },
    towerShopPreviewTarget(r, nativeObjects) {
      if(!this.towerShopPreviewPending(r))return null;
      const ledger=this.towerCleanupLedger,current=ledger?.run===r&&ledger.terrain===r.terrain&&ledger.floor===r.tower.floor;
      return (r.interactables?.list || []).find(object=>object.kind==="meowth" &&
        !(current&&(ledger.entries.get(object)?.reason || Number(r.time)-ledger.startedAt>=120)) &&
        this.worldInteractionDescription(r,object,nativeObjects).eligible &&
        resourceApproachDecision(r,object,this.tacticalState(r)).eligible) || null;
    },
    towerShopRules(r, rules = this.interactionRules()) {
      return this.towerMoneyPolicy(r).spend ? {...rules,paid:true,shop:true,goldReserve:0,maxSpend:null,totalBudget:null} : rules;
    },
    towerExperienceShopAccess(r, inspect=false) {
      if(!r?.tower || this.settings.modeSettings?.tower?.experienceBlessingPriority!==true)return false;
      const rules=this.interactionRules();
      if(rules.shop===false || rules.paid===false)return false;
      if(r.shop?.stage!==200+Number(r.tower.floor) || !Array.isArray(r.shop?.stock))return inspect;
      const context={player:r.player,nativeRun:r,build:this.decisionBuild(r,'shop'),
        experienceBlessingPriority:true,purpose:'shop',costPolicy:this.costStrategySettings(r)};
      return r.shop.stock.some(entry=>!entry.sold && itemExperiencePriority(entry.key,context,this.bridge)>0 &&
        evaluateItemDecision(entry.key,context,this.bridge).eligible &&
        (typeof r.player.canHold!=='function'||r.player.canHold(entry.key)) &&
        this.canSpend(r,Number(entry.price),rules));
    },
    towerShopDecision(r, build, rules, legal) {
      const decision=evaluateShopPurchases(r.shop?.stock || [],{player:r.player,build,costPolicy:this.costStrategySettings(r),nativeRun:r,luckOnlyExperience:this.settings.modeSettings?.tower?.onlyExperience === true,experienceBlessingPriority:this.settings.modeSettings?.tower?.experienceBlessingPriority === true,objective:this.plan?.objective},this.bridge,
        {rules:this.towerShopRules(r,rules),spent:this.interactionSpent,spendAll:this.towerMoneyPolicy(r).spend,
          legal:index=>(!legal || legal(index)) && (typeof r.player.canHold!=="function" || r.player.canHold(r.shop.stock[index].key))});
      const ledger=this.towerShopRefreshLedger(r),pending=ledger?.pending;
      if(pending&&(pending.rerolls!==r.shopRerolls||pending.stock!==r.shop?.stock)){
        // Button animation/temporary disabled cards do not make good stock bad.
        const economic=legal?evaluateShopPurchases(r.shop?.stock||[],{player:r.player,build,costPolicy:this.costStrategySettings(r),nativeRun:r,luckOnlyExperience:this.settings.modeSettings?.tower?.onlyExperience === true,experienceBlessingPriority:this.settings.modeSettings?.tower?.experienceBlessingPriority === true,objective:this.plan?.objective},this.bridge,
          {rules:this.towerShopRules(r,rules),spent:this.interactionSpent,spendAll:true,
            legal:index=>typeof r.player.canHold!=="function"||r.player.canHold(r.shop.stock[index].key)}):decision;
        ledger.pending=null;if(economic.index===null)ledger.useless++;
      }
      if(this.towerMoneyPolicy(r).active&&!this.towerMoneyPolicy(r).spend) {
        decision.candidates=decision.candidates.filter(row=>row.experiencePriority>0);
        decision.index=decision.candidates[0]?.index ?? null;
      }
      return decision;
    },
    towerShopRefreshLedger(r) {
      if(!this.towerMoneyPolicy(r).spend)return null;
      let ledger=this.towerShopRefreshStreak;
      if(!ledger||ledger.run!==r||ledger.terrain!==r.terrain||ledger.floor!==r.tower.floor)
        ledger=this.towerShopRefreshStreak={run:r,terrain:r.terrain,floor:r.tower.floor,useless:0,pending:null};
      return ledger;
    },
    towerShopCanRefresh(r) {
      const blocked=this.towerShopRefreshBlocked;
      if(!this.towerMoneyPolicy(r).spend || blocked?.run===r&&blocked.terrain===r.terrain&&
          blocked.floor===r.tower.floor&&blocked.gold===r.gold&&blocked.rerolls===r.shopRerolls)return false;
      this.towerShopDecision(r,this.decisionBuild(r,"shop"),this.interactionRules());
      if(this.towerShopRefreshLedger(r)?.useless>=2)return false;
      const cost=typeof r.rerollCost==="function"?Number(r.rerollCost()):NaN;
      return cost>0 && this.canSpend(r,cost,this.towerShopRules(r));
    },
    towerFloorCleanup(r, nativeObjects) {
      const tower = r.tower;
      if (!tower || !["clear", "roof"].includes(tower.state)) {
        this.towerCleanupLedger = null; this.towerCleanupState = null;
        return null;
      }
      const now = Number(r.time) || 0;
      let ledger = this.towerCleanupLedger;
      if (!ledger || ledger.run !== r || ledger.terrain !== r.terrain ||
          ledger.floor !== tower.floor || ledger.beyond !== !!tower.beyond || ledger.seed !== r.seed) {
        ledger = this.towerCleanupLedger = { run:r, terrain:r.terrain, seed:r.seed,
          floor:tower.floor, beyond:!!tower.beyond, startedAt:now, entries:new Map() };
      }
      // Native play time stops in upgrade/item modals. Neither target changes
      // nor route cooldown expiry replenishes this floor's finite sweep budget.
      const timedOut = now - ledger.startedAt >= 120,
        rewards = new Set(), xp = new Map(), skipped = new Set(),
        tactical = this.tacticalState(r), mastery = this.masteryState(r),
        avoidCandles = this.towerPolicy(r).avoidCandles;
      const available = (key, object, label) => {
        let entry = ledger.entries.get(key);
        if (!entry) ledger.entries.set(key, entry = { label, failures:0, lastBlock:0 });
        const tracked = object ? this.interactionTracker.inspect(r, object) : null,
          until = Math.max(this.blocked.get(key) || 0, tracked?.blockedUntil || 0);
        if (until > now && until > entry.lastBlock) { entry.failures++; entry.lastBlock = until; }
        if (entry.failures >= 2 || timedOut) {
          entry.reason = entry.failures >= 2 ? "route-retries-exhausted" : "floor-time-budget";
          skipped.add(key); return false;
        }
        return true;
      };
      for (const object of r.interactables.list) {
        const shopping=object.kind==="meowth"&&(this.towerMoneyPolicy(r).spend || this.towerShopPreviewPending(r));
        if (object.used && !shopping || !(shopping || object.kind === "freechest" || object.kind === "chest" ||
            object.kind === "tower" && object.data?.sub === "altar")) continue;
        if (!this.worldInteractionDescription(r, object, nativeObjects).eligible ||
            !resourceApproachDecision(r, object, tactical).eligible) continue;
        if (available(object, object, `${object.kind}:${object.data?.sub || ""}@${object.x},${object.z}`))
          rewards.add(object);
      }
      const loot = r.pickups, p = r.player;
      for (let i = 0; this.settings.pickup !== false && !mastery.avoidXp && i < (loot?.n || 0); i++) {
        if (!loot.alive[i] || ![0,3].includes(loot.kind[i])) continue;
        const point = { x:loot.x[i], y:loot.y[i], z:loot.z[i], loot:true, xpPickup:true, routinePickup:true };
        if (![point.x, point.y, point.z].every(Number.isFinite)) continue;
        // Distant XP belongs to its own floor height, not the player's current
        // landing height. Actual routes still use native navigation and safety.
        const ground = r.terrain.height?.(point.x, point.z) ?? p.pos.y;
        if (Math.min(Math.abs(point.y - ground - .7), Math.abs(point.y - p.pos.y - .7)) >
            Math.max(3.2, (p.stats.pickupRange || 6) - .5) ||
            r.terrain.inBounds?.(point.x, point.z) === false ||
            !towerCandleGoalAllowed(r, point, .6, avoidCandles) ||
            !resourceApproachDecision(r, point, tactical).eligible) continue;
        // Attracted XP remains pending until the native alive flag clears.
        // Merely starting attraction is not evidence that experience arrived.
        if (available(`loot${i}`, null, `xp:${i}`)) xp.set(i, point);
      }
      this.towerCleanupState = { floor:tower.floor, beyond:!!tower.beyond,
        phase:timedOut ? "timed-out" : rewards.size ? "rewards" : xp.size ? "experience" : "complete",
        rewards:rewards.size, experience:xp.size, elapsed:Math.max(0, now - ledger.startedAt),
        limit:120, skipped:[...ledger.entries.values()].filter(entry => entry.reason)
          .slice(-12).map(({label, failures, reason}) => ({label, failures, reason})) };
      return { rewards, xp, skipped, pending:rewards.size > 0 || xp.size > 0 };
    },
    candleRouteAllowed(r, start, end) {
      const stairs=r.terrain?.arena?.tower?.stairs;
      if (this.progressionDecision?.finiteCleanup?.holding && stairs &&
          [stairs.x,stairs.z,stairs.len,start?.x,start?.z,end?.x,end?.z].every(Number.isFinite)) {
        // Tower.update can climb at the upper ramp without E. Keep resource
        // detours out of that real trigger, while allowing a player already
        // there to retreat toward the floor instead of trapping them in place.
        const edge=stairs.z-stairs.len+4.5,half=3.5,
          inside=p=>Math.abs(p.x-stairs.x)<half&&p.z<edge;
        if(inside(start)) {
          if(end.z<start.z-.001&&Math.abs(end.x-stairs.x)<=Math.abs(start.x-stairs.x))return false;
        } else {
          const dx=end.x-start.x,dz=end.z-start.z;
          let low=0,high=1;
          for(const [value,delta,min,max] of [[start.x,dx,stairs.x-half,stairs.x+half],[start.z,dz,-Infinity,edge]]){
            if(Math.abs(delta)<1e-9){if(value<min||value>max){low=1;high=0;break;}}
            else {let a=(min-value)/delta,b=(max-value)/delta;if(a>b)[a,b]=[b,a];low=Math.max(low,a);high=Math.min(high,b);}
          }
          if(low<high)return false;
        }
      }
      return cooperativePassiveRouteAllowed(r,start,end,this.settings?.convenience?.coop) &&
        cooperativeReadyPortalRouteAllowed(r,start,end,this.cooperativePortalAvoidance(r)) &&
        (!r.tower || towerCandleRouteAllowed(r, start, end, this.towerPolicy(r).avoidCandles)) &&
        (typeof masteryXpRouteAllowed!=="function"||masteryXpRouteAllowed(start,end,this.masteryXpCircles(r)));
    },
    masteryState(r) {
      return typeof masteryExecutionState==="function"?masteryExecutionState(r,this.plan,this.bridge):{active:false,avoidXp:false,holdFinish:false,hurry:false};
    },
    completionGoalState(r,mastery=this.masteryState(r)) {
      const stageCount=reviewedStandardStageCount(r?.biome),
        finalCleared=!!r&&!r.tower&&!r.endless&&r.state!=="over"&&Number.isInteger(stageCount)&&
          Number.isInteger(r.stage)&&r.stage>=stageCount&&r.stageCleared===true&&
          r.regionCleared===true&&!r.boss?.alive,
        // Reviewed055 Player.hurt rejects body, shot and hazard damage once
        // regionCleared. The completion predicate remains unmet, but waiting
        // for a contact that native code now rejects cannot finish this attempt.
        retryNextRun=finalCleared&&mastery.active===true&&(mastery.needsHits===true||mastery.needsLowHp===true||mastery.hpConditionImpossible===true),
        waitTime=!retryNextRun&&!!r?.regionCleared&&Number(r.time)<Number(this.plan?.runThresholds?.minTime||0)&&
          this.settings.portalPriority===false;
      return {finalCleared,holdFinish:!retryNextRun&&mastery.holdFinish===true,waitTime,retryNextRun,
        reason:retryNextRun?"native-final-damage-window-closed":waitTime?"pending-native-run-time":null};
    },
    finalRewardCleanupState(r) {
      if(!r||r.state!=="play"||r.player?.dead||r.tower||r.endless||
          !this.completionGoalState(r).finalCleared||this.flightState(r).noInteractions)
        return {holding:false,objects:[]};
      this.tacticalDirector.sync(r);
      const clearSplit=r.splits?.[r.stage-1],nativeAge=Number.isFinite(clearSplit)&&Number.isFinite(r.time)&&r.time>=clearSplit?r.time-clearSplit:0,
        elapsed=Math.max(0,nativeAge,Number(r.stageTime)-Number(this.tacticalDirector.clearedAt)),
        window=this.settings.safeMode===false?32:45,tactical=this.tacticalState(r);
      if(!Number.isFinite(elapsed)||elapsed>=window||!this.flightState(r).active&&(tactical.hpRatio<.4||tactical.pressure>3))
        return {holding:false,objects:[],elapsed,window};
      // Native final onBossKilled marks its fixed free balls with data.lead.
      // The shared director anchors this window to the first real clear; a
      // new object, preference update or retry never renews that stage clock.
      const objects=(r.interactables?.list||[]).filter(object=>object.kind==="freechest"&&
        object.data?.lead===true&&!object.used&&this.worldInteractionAllowed(r,object));
      return {holding:objects.length>0,objects,elapsed,window};
    },
    bonkCleanupState(r,arm=false) {
      const none={holding:false,objects:[]},prior=this.bonkCleanupScope;
      if(!r||!this.enabled||this.app?.run!==r||this.run!==r||this.settings.pickupBonkoin!==true||r.player?.dead||r.tower||r.endless||
          !r.stageCleared||r.boss?.alive||this.flightState(r).noInteractions){if(prior)prior.closed=true;return none;}
      if(r.state!=='play'||!arm&&!prior)return none;
      const account=this.app?.meta?.account,
        same=prior?.run===r&&prior.stage===r?.stage&&prior.terrain===r?.terrain&&
          prior.account===account&&prior.epoch===(this.controlEpoch||0);
      if(!same)this.bonkCleanupScope=null;
      const scope=same?prior:null;
      if(scope?.closed)return none;
      const tactical=this.tacticalState(r);
      if(!this.flightState(r).active&&(tactical.hpRatio<.4||tactical.pressure>3)){if(scope)scope.closed=true;return none;}
      // Native062 qC attracts mature Bonkoin below7m/12m height and collects
      // below1.5m without E. Only this already executable finite pickup gets a
      // short final chance; new drops never restart the stage's extra budget.
      const pos=r.player.pos,objects=(r.interactables?.list||[]).filter(o=>{
        if(o.kind!=='bonk'||o.used||!Number.isFinite(o.data?.age)||o.data.age<.9)return false;
        const d=Math.hypot(pos.x-o.x,pos.z-o.z);
        return (d<1.5||d<7&&o.data.pulled===true&&Number.isFinite(o.y)&&Math.abs(pos.y-o.y)<12)&&
          this.worldInteractionAllowed(r,o);
      });
      let current=scope;
      if(!current){
        if(!arm||!objects.length)return none;
        current=this.bonkCleanupScope={run:r,stage:r.stage,terrain:r.terrain,account,epoch:this.controlEpoch||0,
          until:r.time+2.5,progressAt:r.time,closed:false,distances:new Map(objects.map(o=>[o,Math.hypot(pos.x-o.x,pos.z-o.z)]))};
      }
      for(const o of objects){const d=Math.hypot(pos.x-o.x,pos.z-o.z),before=current.distances.get(o);
        if(Number.isFinite(before)&&d<before-.05){current.progressAt=r.time;current.distances.set(o,d);}
        else if(before===undefined)current.distances.set(o,d);
      }
      if(!objects.length||r.time>=current.until||r.time-current.progressAt>=.75){current.closed=true;current.distances.clear();return none;}
      return {holding:true,objects,remaining:Math.max(0,current.until-r.time)};
    },
    characterPractice(r,tactical=this.tacticalState(r)) {
      const execution=this.characterUnlockState(r),now=Number(r.time),prior=this.characterPracticeScope,
        same=prior?.run===r&&prior.stage===r.stage&&prior.terrain===r.terrain&&prior.epoch===this.controlEpoch&&
          prior.account===this.app?.meta?.account&&prior.execution===this.plan?.unlockExecution;
      if(!same)this.characterPracticeScope=null;
      if(this.flightState(r).active){
        if(execution.practice)this.tacticalReason='飞行/环飞已生效，接触类角色条件暂缓；保留目标，关闭后继续练习';
        if(same)prior.at=now;
        return null;
      }
      if(!execution.active||!execution.practice||!this.enabled||this.app?.run!==r||this.run!==r||
          this.flightState(r).noInteractions||this.autoManagePreserving(r))return null;
      const scope=same?prior:this.characterPracticeScope={run:r,stage:r.stage,terrain:r.terrain,epoch:this.controlEpoch,
        account:this.app?.meta?.account,execution:this.plan.unlockExecution,blocked:new Map(),at:now,activeSeconds:0,
        counter:execution.practice.counter,value:execution.practice.value,hp:r.player.hp,phase:'contact',until:0};
      if(scope.counter!==execution.practice.counter){scope.counter=execution.practice.counter;scope.value=execution.practice.value;
        scope.blocked.clear();scope.activeSeconds=0;scope.until=0;scope.recoveryHp=r.player.hp;scope.recoveryValue=execution.practice.value;
        scope.phase=r.player.hp/r.player.maxHp>=.98?'contact':'recover';}
      if(r.player.hp<scope.hp){scope.until=now+.75;scope.activeSeconds=0;scope.phase='recover';
        scope.recoveryHp=r.player.hp;scope.recoveryValue=execution.practice.value;}
      else if(execution.practice.source.key==='dodges'&&execution.practice.value>scope.value){scope.until=now+.4;scope.activeSeconds=0;}
      scope.value=execution.practice.value;scope.hp=r.player.hp;
      if(scope.phase==='recover'){
        scope.at=now;
        if(r.player.hp/r.player.maxHp<.98||scope.until>now||
            execution.practice.source.key==='healed'&&execution.practice.value<=scope.recoveryValue||
            execution.practice.source.key==='dodges'&&r.player.hp<=scope.recoveryHp&&r.player.hp<r.player.maxHp)return null;
        scope.phase='contact';
      }
      if(this.target?.characterPractice)scope.activeSeconds+=Math.max(0,Math.min(.5,now-scope.at));
      scope.at=now;
      if(scope.activeSeconds>=8){
        const selected=this.target.characterPractice;scope.blocked.set(`${selected.index}:${selected.gen}`,now+30);
        if(scope.blocked.size>32)scope.blocked.delete(scope.blocked.keys().next().value);
        scope.activeSeconds=0;scope.until=now+5;
      }
      if(scope.until>now)return null;
      const result=characterUnlockPracticePlan(r,execution.practice,tactical,
        {blocked:(index,gen)=>scope.blocked.get(`${index}:${gen}`)>now});
      return result.active?result:null;
    },
    characterMechanicFinishHold(r) {
      const execution=this.plan?.unlockExecution,state=this.characterUnlockState(r),now=Number(r?.time),
        stageCount=reviewedStandardStageCount(r?.biome),prior=this.characterFinishScope,
        pending=state.pending.filter(row=>row.canProgressBeforeFinalBoss===true);
      if(prior?.run===r&&['modal','paused'].includes(r?.state)&&!Number.isFinite(prior.suspendedAt))prior.suspendedAt=now;
      if(!state.active||execution.finishPolicy!=='conditions-before-final-boss'||r.endless||r.tower||
          r.state!=='play'||r.regionCleared||r.stageCleared||r.bossSpawned||r.boss?.alive||
          !Number.isInteger(stageCount)||r.stage!==stageCount||!Number.isFinite(now)||
          this.app?.run!==r||this.run!==r||!this.enabled||this.flightState(r).noInteractions||
          state.allLiveMet||!pending.length||pending.some(row=>!row.known)||
          this.controlIdentityScope&&this.controlIdentityScope.account!==this.app?.meta?.account)
        return {holding:false,reason:state.allLiveMet?'native-live-conditions-met':'not-current-final-mechanic'};
      const hintKeys=key=>new Set(pending.flatMap(row=>row.preferenceHints?.[key]||[])),keys=hintKeys('preferredMoves'),
        growth=(r.player.moves||[]).filter(move=>move&&keys.has(move.def?.key)).map(move=>[move.def.key,move.level]),
        inventory=[...hintKeys('itemPriority')].map(key=>[key,r.player.items?.get?.(key)||0]),
        vitaminKeys=hintKeys('vitaminPriority'),vitamins=[...(r.player.vitamins||[])].filter(([key])=>
          vitaminKeys.has(key)||vitaminKeys.has(this.bridge.vitamins?.get?.(key)?.stat)).map(([key,value])=>[key,typeof value==='number'?value:value?.level]),
        values=[...state.conditions.filter(row=>row.canProgressBeforeFinalBoss===true).map(row=>['counter:'+row.counter,Math.min(row.goal,row.value)]),
          ...growth.map(([key,value])=>['move:'+key,value]),...inventory.map(([key,value])=>['item:'+key,value]),
          ...vitamins.map(([key,value])=>['vitamin:'+key,value])].filter(([,value])=>Number.isFinite(value)),
        same=prior?.run===r&&prior.stage===r.stage&&prior.terrain===r.terrain&&prior.account===this.app?.meta?.account&&
          prior.epoch===this.controlEpoch&&prior.execution===execution&&prior.progressValues instanceof Map,
        scope=same?prior:this.characterFinishScope={run:r,stage:r.stage,terrain:r.terrain,account:this.app?.meta?.account,
          epoch:this.controlEpoch,execution,progressValues:new Map(values),progressAt:now,released:false};
      if(Number.isFinite(scope.suspendedAt)){scope.progressAt+=Math.max(0,now-scope.suspendedAt);scope.suspendedAt=null;}
      if(!scope.released)for(const [key,value]of values)if(value>(scope.progressValues.get(key)||0)){
        scope.progressValues.set(key,value);scope.progressAt=now;
      }
      if(now-scope.progressAt>=180)scope.released=true;
      return {holding:!scope.released,reason:scope.released?'native-mechanic-no-progress-normal-finish':'pending-native-character-mechanic',
        remaining:Math.max(0,180-(now-scope.progressAt)),pending:pending.map(row=>row.counter)};
    },
    goalExposureAllowed(r,contact,mastery,tactical) {
      if(this.flightState(r).active)return false;
      const previous=this.goalExposureScope,now=Number(r.time),p=r.player,
        same=previous?.run===r&&previous.stage===r.stage&&previous.terrain===r.terrain&&previous.plan===this.plan&&
          previous.account===this.app?.meta?.account&&previous.constraints===mastery.constraints;
      if(previous&&!same)this.goalExposureScope=null;
      if(!mastery.active||!mastery.exposure||r.regionCleared||r.state==="over"){this.goalExposureScope=null;return false;}
      let scope=same?previous:null;
      const hits=Number(r.stats?.hits)||0,ratio=p.maxHp>0?p.hp/p.maxHp:1,
        progress=scope&&(mastery.needsHits&&hits>scope.hits||mastery.needsLowHp&&ratio<scope.bestRatio);
      if(scope){
        if(progress){scope.noProgress=0;scope.until=0;}
        scope.bestRatio=Math.min(scope.bestRatio,ratio);
        scope.hits=hits;scope.ratio=ratio;
      }
      const eligible=this.enabled&&this.app?.run===r&&this.run===r&&
        (!this.controlIdentityScope||this.controlIdentityScope.account===this.app?.meta?.account)&&
        !!contact&&r.state==="play"&&!r.regionCleared&&mastery.active===true&&
        tactical.pressure<=3&&!(tactical.unknownClose>0);
      if(!eligible){if(scope){scope.at=now;scope.eligible=false;}return false;}
      if(!scope){
        scope=this.goalExposureScope={run:r,stage:r.stage,terrain:r.terrain,account:this.app?.meta?.account,plan:this.plan,
          constraints:mastery.constraints,hits,ratio,bestRatio:ratio,at:now,noProgress:0,until:0,eligible:true,
          index:contact.i,gen:r.enemies.gen?.[contact.i],bestDistance:contact.distance,arrived:false};
      }
      const selected=this.target?.masteryExposure;
      if(!scope.eligible){scope.at=now;scope.eligible=true;}
      if(selected&&!progress)scope.noProgress+=Math.max(0,Math.min(.5,now-scope.at));
      scope.at=now;
      scope.index=contact.i;scope.gen=r.enemies.gen?.[contact.i];
      const arrival=(Number(r.enemies.radius?.[contact.i])||.5)+(Number(p.radius)||.55)+.6;
      if(!scope.arrived&&contact.distance<scope.bestDistance-.7){scope.noProgress=0;scope.bestDistance=contact.distance;}
      if(contact.distance<=arrival)scope.arrived=true;
      if(scope.noProgress>=12){scope.noProgress=0;scope.until=now+20;}
      // A genuine hit or requested HP decrease renews any number of useful
      // attempts. Target flips and walking away after arrival cannot do so.
      return !(scope.until>now);
    },
    masteryXpCircles(r) {
      const state=this.masteryState(r);
      if(!state.avoidXp&&!state.avoidHealing){this.masteryXpField=null;return [];}
      const bucket=Math.floor((Number(r.time)||0)*5),prior=this.masteryXpField,loot=r.pickups,
        radius=Math.max(.9,Number(r.player.stats?.pickupRange)||0)+.4;
      if(prior?.run===r&&prior.terrain===r.terrain&&prior.bucket===bucket&&prior.loot===loot&&prior.count===loot?.count&&prior.n===loot?.n&&
          prior.radius===radius&&prior.avoidXp===state.avoidXp&&prior.avoidHealing===state.avoidHealing)return prior.circles;
      const circles=[];
      for(let i=0;i<(loot?.n||0);i++)if(loot.alive[i]&&!loot.attract[i]&&
          (state.avoidXp&&(loot.kind[i]===0||loot.kind[i]===3)||state.avoidHealing&&loot.kind[i]===2))
        circles.push({x:loot.x[i],z:loot.z[i],radius});
      this.masteryXpField={run:r,terrain:r.terrain,bucket,loot,count:loot?.count,n:loot?.n,radius,
        avoidXp:state.avoidXp,avoidHealing:state.avoidHealing,circles};return circles;
    },
    navigationFor(r) {
      return new GridNavigator(r.terrain, 2, (start, end) => this.candleRouteAllowed(r, start, end));
    },
    walkRoute(r, pos, dx, dz, length, margin = 2, futureFeetY = pos.y) {
      if (
        !this.withinArena(r, pos.x + dx * length, pos.z + dz * length, margin) ||
        !this.candleRouteAllowed(r, pos, { x: pos.x + dx * length, z: pos.z + dz * length })
      )
        return false;
      const p = r.player;
      const terrain = r.terrain;
      // A downward cliff can pass native walkClear while leaving no way back.
      // Keep escape routes for future rings and crowds rather than entering pits.
      if (terrain.height) {
        const x = pos.x + dx * length,
          z = pos.z + dz * length;
        if (
          terrain.height(pos.x, pos.z) - terrain.height(x, z) > 1.5 &&
          !terrain.walkClear(x, z, -dx, -dz, length, p.radius)
        )
          return false;
      }
      if (
        p.grounded ||
        !terrain.height ||
        pos.y - terrain.height(pos.x, pos.z) < 0.65
      )
        return nativeFootprintWalkClear(terrain,pos,{x:dx,z:dz},length,p.radius,
          (x,z,edge)=>this.withinArena(r,x,z,Math.min(margin,edge)));
      // A ledge must remain below the feet when the trajectory reaches it.
      // Current jump height alone incorrectly permitted slides into a wall
      // during the landing, where native movement immediately sets vx to zero.
      const feetY = Math.min(pos.y, futureFeetY);
      for (let d = 0.5; d <= length; d += 0.5) {
        const x = pos.x + dx * d,
          z = pos.z + dz * d;
        if (
          terrain.height(x, z) > feetY + 0.45 ||
          terrain.hitProp?.(x, feetY + 0.3, z, p.radius * 0.8)
        )
          return false;
      }
      return true;
    },
    invalidateBossRetreatMotion() {
      // A preference toggle invalidates movement intent, never game progress,
      // a capture attempt, an interaction ledger or the controller's run state.
      this.previous = { x: 0, z: 0 };
      this.lastMotion = null;
      const target = this.target, worldTarget = target?.entity &&
        (target.interaction || typeof target.entity.kind === "string" || this.run?.interactables?.list?.includes(target.entity));
      if (target && !target.captureSource && !target.cooperativeRescue && !worldTarget &&
          !target.loot && !target.achievementMechanic && !target.goalForesight &&
          (target.id === "bossfight" || String(target.combatDistanceReason || "").startsWith("boss-separation") ||
            Number.isInteger(target.enemyIndex) && isNativeBoss(this.run,target.enemyIndex))) {
        this.target = null;
        this.navTarget = null;
        this.navAt = -Infinity;
        this.routeObservation = null;
        this.lastWorld = -Infinity;
      }
    },
    combatPoint(r, index, range, purpose = null) {
      const en = r.enemies,
        pos = r.player.pos,
        ex = en.x[index],
        ez = en.z[index];
      const uninterrupted=this.flightState(r).active,requiredCapture=purpose==="capture"&&
        (r.capture?.index===index&&["roaming","weakened","throwing"].includes(r.capture.state)||
          r.allies?.down===index&&["down","throwing"].includes(r.allies.state));
      if(!uninterrupted&&this.settings.bossRetreat===true&&isNativeBoss(r,index)&&!requiredCapture){
        // Player-centred exits keep opening distance even with melee-only or
        // no moves. A legal tangential route beats pushing at the arena edge;
        // an inward detour is permitted only when no outward route is usable.
        const length=Math.hypot(pos.x-ex,pos.z-ez),angle=Math.atan2(pos.z-ez,pos.x-ex),
          offsets=[0,.35,-.35,.8,-.8,Math.PI/2,-Math.PI/2,2.2,-2.2,Math.PI],rows=[];
        for(const radii of [[8,14],[4,2,.75]]){
          for(const radius of radii)for(const offset of offsets){
          const x=pos.x+Math.cos(angle+offset)*radius,z=pos.z+Math.sin(angle+offset)*radius;
          if(!this.withinArena(r,x,z,4)||!this.candleRouteAllowed(r,{x,z},{x,z})||
              !this.walkRoute(r,pos,(x-pos.x)/radius,(z-pos.z)/radius,radius))continue;
          const separation=Math.hypot(x-ex,z-ez),pressure=scoreCombatPosition(r,index,{x,z}),
            score=(separation-length)*10-radius*.05-(pressure?.cost||0);
          rows.push({x,z,score,range:separation,coverage:0,
            rangeReason:"boss-separation",bossBoundaryDetour:separation<length-.05});
          }
          if(rows.length)break;
        }
        const outward=rows.filter(point=>!point.bossBoundaryDetour),choices=outward.length?outward:rows;
        choices.sort((a,b)=>b.score-a.score);
        return choices[0]||{x:pos.x,z:pos.z,range:length,coverage:0,
          rangeReason:"boss-separation-blocked",bossBoundaryDetour:true};
      }
      const angle = Math.atan2(pos.z - ez, pos.x - ex),
        limit = r.terrain.play || 170,
        boundaryCircles = nativeMovementCircles(r);
      // The square world span is not the active arena's radius. Tower rooms
      // and temporary offset rings can be an order of magnitude smaller.
      // Use the same native circles that constrain routes, without changing
      // collision geometry or the ordinary versus retreat movement policy.
      let best, bestRouteClear = false;
      const offsets = [
        0,
        0.35,
        -0.35,
        0.8,
        -0.8,
        1.4,
        -1.4,
        2.2,
        -2.2,
        Math.PI,
      ];
      const rangeOptions = purpose==='pylon'?[{range,coverage:0,reason:'native-pylon-high-ground'}]:typeof combatDistanceOptions === "function"
        ? combatDistanceOptions(r, index, range,{requiredCapture,bossRetreat:!uninterrupted&&this.settings.bossRetreat===true}) : [{ range, coverage: 0, reason: "legacy-distance" }];
      const candidates = rangeOptions.slice(0, 3).flatMap(option => offsets.map(offset => ({
        x: ex + Math.cos(angle + offset) * option.range,
        z: ez + Math.sin(angle + offset) * option.range,
        coverage: option.coverage, rangeReason: option.reason,
      })));
      const danger = !uninterrupted&&typeof scoreCombatPosition === "function" ? scoreCombatPosition(r, index, pos) : null;
      if (danger?.retreatNeeded) for (const radius of [8, 14]) for (let i = 0; i < 8; i++)
        candidates.push({ x: pos.x + Math.cos(i * Math.PI / 4) * radius,
          z: pos.z + Math.sin(i * Math.PI / 4) * radius, retreat: true });
      for (const { x, z, retreat, coverage = 0, rangeReason } of candidates) {
        if (!this.withinArena(r, x, z, 4) || !this.candleRouteAllowed(r, { x, z }, { x, z })) continue;
        const d = Math.hypot(x - pos.x, z - pos.z) || 1;
        const clear = this.walkRoute(
          r,
          pos,
          (x - pos.x) / d,
          (z - pos.z) / d,
          retreat ? d : Math.min(d, 10),
        );
        if (retreat && !clear) continue;
        let room = 0;
        for (const [dx, dz] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ])
          if (
            this.withinArena(r, x + dx * 5, z + dz * 5, 4) &&
            r.terrain.walkClear(x, z, dx, dz, 5, r.player.radius) &&
            r.terrain.walkClear(
              x + dx * 5,
              z + dz * 5,
              -dx,
              -dz,
              5,
              r.player.radius,
            )
          )
            room++;
        const edge = Math.max(Math.max(Math.abs(x), Math.abs(z)) / limit,
          ...boundaryCircles.map(circle=>Math.hypot(x-circle.x,z-circle.z)/circle.radius));
        const pressure = !uninterrupted&&typeof scoreCombatPosition === "function" ? scoreCombatPosition(r, index, { x, z }) : null;
        const score = (clear ? 12 : 0) + room * 2 + clamp(coverage, 0, 1) * 8 -
          d * 0.15 - Math.max(0, edge - 0.6) * 60 - (pressure?.cost || 0);
        if (!best || score > best.score) {
          bestRouteClear = clear;
          best = { x, z, score,
          range: Math.hypot(x - ex, z - ez), coverage,
          rangeReason: retreat ? "pressure-retreat" : rangeReason };
        }
      }
      if (isNativeBoss(r,index) && !requiredCapture && !bestRouteClear) {
        // Keep the short-route fix when retreat is disabled too. The route
        // advances the ordinary combat goal; it has no separation reward.
        const goal = best || { x: ex, z: ez }, before = distance(pos,goal);
        let short;
        for (const radius of [4,2,.75]) {
          for (let i=0;i<24;i++) {
            const dx=Math.cos(i*Math.PI/12),dz=Math.sin(i*Math.PI/12),
              x=pos.x+dx*radius,z=pos.z+dz*radius;
            if (!this.withinArena(r,x,z,4) || !this.candleRouteAllowed(r,pos,{x,z}) ||
                !this.walkRoute(r,pos,dx,dz,radius)) continue;
            const pressure=!uninterrupted&&typeof scoreCombatPosition==="function"?scoreCombatPosition(r,index,{x,z}):null,
              score=(before-distance({x,z},goal))*2-(pressure?.cost||0)-radius*.05;
            if (!short || score>short.score) short={x,z,score,range:Math.hypot(x-ex,z-ez),
              coverage:best?.coverage||0,rangeReason:"combat-short-detour"};
          }
          if(short)break;
        }
        if(short)return short;
      }
      return best || { x: ex * 0.8, z: ez * 0.8 };
    },
    progressionReady(r) {
      if (
        this.settings.safeMode === false ||
        this.plan?.objective === "time" ||
        this.plan?.objective === "shiny" ||
        r.endless ||
        r.sanctuary ||
        r.regionCleared
      )
        return true;
      // Native ordinary-enemy HP jumps 5.5x and 13x in later regions. Clear the
      // guardian, then collect its free loot and finish the main moves first.
      // Do not camp into the native ten-minute final swarm while waiting.
      if (
        r.stageTime >= 510 ||
        (r.stageCleared && r.player.hp < r.player.maxHp * 0.45)
      )
        return true;
      const moves = r.player.moves
        .filter(Boolean)
        .map((m) => m.level || 1)
        .sort((a, b) => b - a);
      return (
        r.player.level >= ([0, 24, 36, 42][r.stage] || 42) &&
        moves.length >= Math.min(3, r.player.moveSlots || 3) &&
        (moves[1] || 0) >= (r.stage === 1 ? 6 : 8)
      );
    },
    cataclysmHidden(r, point, warning = this.coverWarning) {
      if (!warning) return true;
      const arena = r.sanctuary;
      if (!arena)
        return (
          distance(point, warning) > 26 ||
          !r.terrain.lineClear(
            warning.x,
            warning.y,
            warning.z,
            point.x,
            point.y + 1,
            point.z,
          )
        );
      if (
        !arena.blocked(
          warning.x,
          warning.y,
          warning.z,
          point.x,
          point.y + 0.9,
          point.z,
        )
      )
        return false;
      const dx = point.x - warning.x,
        dz = point.z - warning.z,
        d2 = dx * dx + dz * dz || 1e-6;
      // The blast damages nearby columns BEFORE its visibility test. A column
      // with 30 HP or less must not be the only predicted shield.
      for (const c of arena.covers || []) {
        if (
          !c.alive ||
          (c.breakable && c.hp <= 30 && distance(c, warning) < 22 + c.r)
        )
          continue;
        const u = clamp(
          ((c.x - warning.x) * dx + (c.z - warning.z) * dz) / d2,
          0,
          1,
        );
        const gap2 =
          (warning.x + dx * u - c.x) ** 2 + (warning.z + dz * u - c.z) ** 2;
        if (gap2 > c.r * c.r) continue;
        const entry = Math.max(
          0,
          u - Math.sqrt(c.r * c.r - gap2) / Math.sqrt(d2),
        );
        if (
          entry < 0.999 &&
          warning.y + (point.y + 0.9 - warning.y) * entry < c.top
        )
          return true;
      }
      const steps = Math.ceil(Math.sqrt(d2) / 1.1);
      for (let i = 1; i < steps; i++) {
        const u = i / steps;
        if (
          r.terrain.height(warning.x + dx * u, warning.z + dz * u) >
          warning.y + (point.y + 0.9 - warning.y) * u + 0.15
        )
          return true;
      }
      return false;
    },
    cataclysmTarget(r) {
      const warning = this.coverWarning;
      if (!warning || warning.until < r.time || !r.boss.alive) return null;
      const pos = r.player.pos;
      if (this.cataclysmHidden(r, pos, warning))
        return {
          x: pos.x,
          z: pos.z,
          y: pos.y,
          radius: 0.2,
          id: "cataclysm-cover",
          label: "保持掩体，躲避全场攻击",
        };
      let best;
      for (const c of r.sanctuary?.covers || []) {
        if (
          !c.alive ||
          (c.breakable && c.hp <= 30 && distance(c, warning) < 22 + c.r)
        )
          continue;
        const angle = Math.atan2(c.z - warning.z, c.x - warning.x);
        for (const offset of [0, 0.25, -0.25, 0.5, -0.5]) {
          const radius = c.r + (r.player.radius || 0.55) + 0.8;
          const x = c.x + Math.cos(angle + offset) * radius,
            z = c.z + Math.sin(angle + offset) * radius;
          if (!this.withinArena(r, x, z, 2)) continue;
          const q = { x, z, y: r.terrain.height(x, z) };
          if (!this.cataclysmHidden(r, q, warning)) continue;
          const d = distance(pos, q),
            clear =
              d < 0.1 ||
              this.walkRoute(r, pos, (x - pos.x) / d, (z - pos.z) / d, d);
          const score = d + (clear ? 0 : 10) + (c.breakable ? 3 : 0);
          if (!best || score < best.score)
            best = {
              ...q,
              score,
              radius: 0.4,
              id: "cataclysm-cover",
              label: "寻找掩体，躲避全场攻击",
            };
        }
      }
      return best;
    },
    arenaHazards(r) {
      const arena = r.sanctuary,
        pos = r.player.pos,
        out = [];
      if (!arena) return out;
      for (const h of arena.spores || [])
        if (h.t > 0 && distance(pos, h) < 18)
          out.push({
            x: h.x,
            y: h.y,
            z: h.z,
            radius: h.r,
            eta: Math.max(0, h.t - 6.5),
            persistent: h.t < 6.5,
            maxHeight: 2.5,
            life: h.t,
          });
      const addFissure = (f, radius, eta, maxHeight, life) => {
        for (let i = 1; i < (f?.pts?.length || 0); i++) {
          const a = f.pts[i - 1],
            b = f.pts[i];
          if (Math.min(distance(pos, a), distance(pos, b)) > 12) continue;
          out.push({
            x: a.x,
            z: a.z,
            x2: b.x,
            z2: b.z,
            y: r.terrain.height(pos.x, pos.z),
            radius,
            eta,
            maxHeight,
            life,
            persistent: eta <= 0,
          });
        }
      };
      if (arena.phase < 4 && arena.open > 0.3 && arena.heat > 0.2)
        for (const f of arena.fissures || [])
          addFissure(f, 1.05 * arena.open, 0, 0.6, 1);
      if (arena.eruption && arena.eruption.t < 2.5)
        addFissure(
          arena.eruption.f,
          2.4,
          Math.max(0, 1.2 - arena.eruption.t),
          3.4,
          2.5 - arena.eruption.t,
        );
      return out;
    },
    shinyHoldStage(r) {
      if (this.plan?.objective !== "shiny" || r.sanctuary || r.endless)
        return false;
      const types=this.executedShinyTypes();
      if(types?.includes('classic')&&this.classicHoldStage(r))return true;
      if(types&&!types.includes('shiny'))return false;
      if (
        r.capture?.shiny &&
        ["roaming", "weakened", "throwing"].includes(r.capture.state)
      )
        return true;
      // The separate final no-stay choice also ends speculative encounter
      // waits. A creature already present above still retains its capture
      // window; other goal modes never qualify for this shiny-only override.
      if (shinyStageDwell(r,this.settings,this.plan).skipFinal) return false;
      const sources = (this.plan.shinySources || []).filter(
        (v) => v.stage === r.stage,
      );
      if (
        sources.some((v) => v.kind === "wild") &&
        (r.capture?.shinyStage !== r.stage ||
          Number.isFinite(r.capture?.shinyAt))
      )
        return true;
      if (r.events?.kind === "eclipse" && !r.events.shinyRolled) return true;
      return (
        sources.some((v) => v.kind === "eclipse") &&
        (r.director?.timeline || []).some(
          (v) => v.kind === "event" && v.t >= r.stageTime,
        )
      );
    },
    classicHoldStage(r) {
      const targets=this.plan?.classicTargetIds, capture=r?.capture;
      if(!this.shinyHuntCaptureAllowed(r,{classic:true}))return false;
      if (!targets?.length || !capture || r.coop || r.tower || r.endless || r.sanctuary || r.mewtwo?.active) return false;
      if (capture.classic && targets.includes(capture.species) &&
          ["roaming","weakened","throwing"].includes(capture.state) &&
          r.enemies?.alive?.[capture.index] && !(r.enemies.dying?.[capture.index]>0)) return true;
      if (shinyStageDwell(r,this.settings,this.plan).skipFinal) return false;
      if (capture.shinyStage===r.stage && !Number.isFinite(capture.classicAt)) return false;
      if (typeof capture.classicPool!=="function") return false;
      // Native addClassic only appends; profile adoption or phase changes replace
      // the corresponding reference. Keep one weakly owned current-pool result,
      // rather than rebuilding the native family coverage filter every decision.
      const profile=r.meta?.profile || this.app.meta.profile, classics=profile.classics;
      this.classicSourceCache ||= new WeakMap();
      let cached=this.classicSourceCache.get(capture);
      if (!cached || cached.pool!==r.director?.pool || cached.profile!==profile || cached.classics!==classics ||
          cached.count!==(classics?.length || 0) || cached.targets!==targets || cached.stage!==r.stage) {
        cached={pool:r.director?.pool,profile,classics,count:classics?.length || 0,targets,stage:r.stage,
          eligible:capture.classicPool().some(mon=>targets.includes(mon.id))};
        this.classicSourceCache.set(capture,cached);
      }
      return cached.eligible;
    },
    code(action) {
      const defaults = {
        up: "KeyW",
        down: "KeyS",
        left: "KeyA",
        right: "KeyD",
        jump: "Space",
        dash: "ShiftLeft",
        interact: "KeyE",
        incense: "KeyC",
        ult: "KeyR",
        pause: "KeyP",
      };
      return (
        this.app?.meta?.profile?.settings?.keyBinds?.[action] ||
        defaults[action] ||
        action
      );
    },
    key(code, down) {
      if (down && !this.activationScheduleSnapshot().allowed) return;
      if (down === this.held.has(code)) return;
      if (down) this.held.add(code);
      else this.held.delete(code);
      if (/^Mouse\d$/.test(code)) {
        const button = Number(code.slice(5));
        (down ? document.querySelector(nativeCompatSelector("#game")) : window)?.dispatchEvent(
          new MouseEvent(down ? "mousedown" : "mouseup", {
            button,
            bubbles: true,
            cancelable: true,
          }),
        );
        return;
      }
      const key = code.startsWith("Key")
        ? code.slice(3).toLowerCase()
        : code === "Space"
          ? " "
          : code;
      window.dispatchEvent(
        new KeyboardEvent(down ? "keydown" : "keyup", {
          code,
          key,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    tap(action, cooldown = 250) {
      const run=this.app?.run;
      if(action==="interact" && run?.state==="play" && this.compatibility?.maintenanceScope && !this.compatibility.maintenanceScope.allowRifts &&
          (run.rifts?.nearEntrance?.() || run.rifts?.isInside)) {
        this.status="当前裂隙接口未核验；离开入口范围后继续普通交互";return false;
      }
      if(action==='interact'&&run?.rifts?.canCallAlpha?.()&&this.nativeInteractionAction(run)==='rift-alpha')return false;
      if(action==='interact'&&run?.rifts?.canCallWave?.()&&this.nativeInteractionAction(run)==='rift-wave')return false;
      if(run?.state==="play"&&this.flightState(run).noInteractions&&["interact","ult"].includes(action))return false;
      if(action==="interact"&&run?.state==="play"&&["cursed","cursedchest","greed","fossil","porygon","rhydon"].includes(run.interactables?.nearest?.kind)&&
          this.nativeInteractionAction(run)==="world"&&(!this.enabled||!this.worldInteractionAllowed(run,run.interactables.nearest)))return false;
      if(action==="interact"&&run?.state==="play"&&this.flightState(run).noInteractions)return false;
      if(action==="interact"&&run?.state==="play"&&this.flightState(run).keepInteractions&&
          !this.flightInteractionGroundReady(run))return false;
      if(action==="interact"&&run?.state==="play"&&(this.nativeCooperativeRescuePeer(run)||run.capture?.throwing===true||run.capture?.state==="throwing"||
          this.leaderboardCampBlocks(run,run.interactables?.nearest)&&this.nativeInteractionAction(run)!=="capture"))return false;
      const code = this.code(action),
        now = performance.now();
      if (now - (this.lastTap.get(code) ?? -Infinity) < cooldown) return false;
      this.lastTap.set(code, now);
      this.key(code, true);
      this.key(code, false);
      this.pendingTapCodes.add(code);
      return true;
    },
    release(cancelPending = false) {
      // installPilot invokes the OLD release before replacing methods. Delete
      // that module's private run cache here, without touching native input.
      clearNativeContactEnvelopes(this.run||this.app?.run);
      this.characterPracticeScope=null;
      if(this.cooperativeRescueCode)this.releaseCooperativeRescueInput();
      this.flightLandingScope=null;
      const run = this.app?.run;
      if(this.characterFinishScope?.run===run&&['modal','paused'].includes(run?.state)&&
          !Number.isFinite(this.characterFinishScope.suspendedAt))this.characterFinishScope.suspendedAt=Number(run.time);
      if(!this.enabled||!run||run.state==="over"||run.state==="transition"||this.documentLeaving||
          this.run!==run||!this.flightState(run).keepInteractions||this.flightInteractionScope&&
          (this.flightInteractionScope.stage!==run.stage||this.flightInteractionScope.terrain!==run.terrain))
        this.flightInteractionScope=null;
      if(!this.enabled||!run||run.state==="over"||this.documentLeaving||this.run!==run||!this.flightState(run).active){
        this.flightTravelPlanner=null;this.flightControlScope=null;this.flightCollectionScope=null;
      }
      if(!this.enabled||!run||run.state==="over"||run.state==="transition"||this.documentLeaving||this.run!==run){
        this.characterFinishScope=null;
        this.tacticalDirector?.finiteResources?.clear();
        if(this.progressionDecision?.finiteCleanup)this.progressionDecision.finiteCleanup={active:false,holding:false,pending:0};
      }
      this.orbitTravelPlanner?.pause(run);
      if(run)this.travelProgressTracker?.observe(run,{eligible:false});
      if(!this.enabled||!run||run.state==="over"||run.state==="transition"||this.documentLeaving||this.run!==run){
        clearNativeContactEnvelopes(this.run||run);
        this.broadTravelPlanner=null;this.orbitTravelPlanner=null;this.travelProgressTracker=null;this.travelBreakoutState=null;this.travelModeScope=null;this.growthTravelScope=null;
      }
      this.masteryXpField=null;
      // Publish the inactive observation as well as preserving its ledger. A
      // native floor transition can resume play before the next pilot step.
      this.terrainRecoveryState = run
        ? this.terrainRecoveryTracker?.observe(run,{eligible:false,target:this.target}) || null : null;
      if(run) this.terrainHopTracker?.observe(run,{eligible:false,target:this.target});
      if(run) this.crowdEscapeTracker?.observe(run,{eligible:false,target:this.target});
      if(run) this.explorationPlanner?.choose(run,{eligible:false,selected:false});
      this.explorationState = run ? this.explorationPlanner?.state || null : null;
      this.terrainHopState = null;
      this.crowdEscapeState = null;
      const pending = cancelPending ? new Set([...this.held, ...this.pendingTapCodes]) : null;
      for (const code of [...this.held]) this.key(code, false);
      if (this.app?.input) this.app.input.stickX = this.app.input.stickY = 0;
      if (cancelPending) {
        for (const code of pending) this.app?.input?.pressed?.delete?.(code);
        this.pendingTapCodes.clear();
      }
    },
    move(x, z, yaw) {
      const lateral = Math.cos(yaw) * x - Math.sin(yaw) * z;
      const forward = -Math.sin(yaw) * x - Math.cos(yaw) * z;
      // The same analog axes used by the game's gamepad layer preserve the
      // exact direction evaluated by the predictor, rather than rounding to WASD.
      this.app.input.stickX = lateral;
      this.app.input.stickY = forward;
    },
    fail(error) {
      this.errors.push(String(error?.message || error));
      if(this.errors.length>32)this.errors.splice(0,this.errors.length-32);
      // A rejection from an old request must not overwrite a later explicit
      // stop (or make that stopped document eligible for recovery again).
      if (!this.enabled && this.controlIntent.desired === "stopped") {
        console.error("[PB autopilot]", error);
        return;
      }
      this.stop("脚本异常，已暂停并等待客户端恢复", {
        source: "controller-error", code: "controller-error", recoverable: true,
      });
      console.error("[PB autopilot]", error);
    },
    blockCompatibility(report) {
      this.compatibility={...this.compatibility,...report,state:'partial',level:'degraded',missing:[...(report?.missing||[])]};
      this.status='部分接口待修复：'+(report?.reason||report?.missing?.join('、')||'可使用手动修改接口');
      this.setHealth('capability-wait',this.status);
      return false;
    },
    syncCompatibility(throttle=false) {
      const revision=globalThis.__PB_BRIDGE?.compatibilityConfig?.revision??0,
        interval=globalThis.__PB_RUNTIME_COMPAT?.other?.('probeIntervalMs',3000)??3000,now=Date.now();
      if(throttle&&this.lastCompatibilityProbeRevision===revision&&this.lastCompatibilityProbeRun===globalThis.__PB_BRIDGE?.app?.run&&
        now-(this.lastCompatibilityProbeAt||0)<Math.max(1000,Math.min(30000,Number(interval)||3000)))return !!this.app;
      this.lastCompatibilityProbeAt=now;this.lastCompatibilityProbeRevision=revision;this.lastCompatibilityProbeRun=globalThis.__PB_BRIDGE?.app?.run;
      try{globalThis.__PB_RUNTIME_COMPAT?.refresh?.(this.compatibility?.level!=='full');}catch{/* A failed optional inspection never stops the native game. */}
      const bridge=globalThis.__PB_BRIDGE,observed=bridge?.compatibility||globalThis.__PB_COMPATIBILITY;
      if(!this.app&&bridge?.app&&!this.attach(bridge))return false;
      if(this.app){
        const contract=checkBridgeContract(bridge||this.bridge,{phase:'boot'});
        this.compatibility={...this.compatibility,...(observed||{}),...contract,state:contract.ok?'ready':'partial',
          warnings:[...new Map([...(observed?.warnings||[]),...(contract.warnings||[])].map(row=>[JSON.stringify(row),row])).values()],
          level:observed?.level==='degraded'?'degraded':contract.level,
          reason:contract.reason||observed?.reason||null,capabilities:{...(observed?.capabilities||{}),...contract.capabilities}};
        if(this.partialRunScope?.run===this.app.run){
          const current=checkBridgeContract(this.bridge,{phase:'run',run:this.app.run});
          if(current.capabilities?.combat){const scope=this.partialRunScope;
            if(scope.run[scope.key]===scope.wrapper)scope.run[scope.key]=scope.original;
            this.partialRunScope=null;this.run=null;this.attachRun(scope.run);
          }
        }
        return contract.ok;
      }
      this.compatibility={...(observed||{}),state:'partial',level:'degraded',phase:'boot',code:'bridge-wait',
        missing:[...(observed?.missing||['game.bridge'])],reason:observed?.reason||'正在重试游戏接口；本地配置、教程与修复窗口仍可使用'};
      this.status=this.enabled?'挂机已启用：'+this.compatibility.reason:this.compatibility.reason;
      this.setHealth('bridge-wait',this.status);return false;
    },
    attach(bridge) {
      if (this.app) return this.app === bridge?.app;
      if (!bridge?.app) return false;
      const contract =
        typeof checkBridgeContract === "function"
          ? checkBridgeContract(bridge, { phase: "boot" })
          : { ok: false, missing: ["adapter.checkBridgeContract"] };
      if (!contract.ok)
        return this.blockCompatibility({
          ...(bridge.compatibility || {}),
          phase: "boot",
          code: "boot-contract-changed",
          ...contract,
          reason: "游戏接口缺少必要能力：" + contract.missing.join("、"),
        });
      this.bridge = bridge;
      this.app = bridge.app;
      if (['M2','M3'].includes(bridge.compatibility?.maintenanceScope?.stage) && this.nextRunIntent !== 'manual') {
        this.enabled = false;
        this.setControlIntent('stopped','m2-manual-start-required','m2-manual-start-required','离线候选已连接，请手动开始已支持的常规地图');
      }
      if (this.enabled && !this.controlIdentityCurrent()) return false;
      this.observeMenuAvailability();
      if (typeof this.app.contextLost === "function" && !this.app.contextLost.__pbRecoveryOrigin) {
        const nativeContextLost = this.app.contextLost, self = this;
        this.app[this.nativeMemberKey(this.app,"contextLost")] = function (...args) {
          const previous = self.graphicsPauseRun;
          if (args[0] === true && this === self.app) {
            self.graphicsPauseRun = this.run;
            self.setHealth("graphics-wait", "原生图形上下文丢失，等待原生恢复选项");
          }
          try { return nativeContextLost.apply(this, args); }
          finally { self.graphicsPauseRun = previous; }
        };
        this.app.contextLost.__pbRecoveryOrigin = true;
      }
      if (typeof this.app.savedCard === "function" && !this.app.savedCard.__pbRecoveryNotice) {
        const nativeSavedCard = this.app.savedCard, self = this;
        this.app[this.nativeMemberKey(this.app,"savedCard")] = function (...args) {
          const result = nativeSavedCard.apply(this, args);
          if (this === self.app) self.nativeSavedNotice = {
            root: [...document.querySelectorAll(nativeCompatSelector(".season-modal"))].at(-1) || null,
            observedAt: Date.now(), acknowledgedAt: null, rescued: args[1] === true,
          };
          return result;
        };
        this.app.savedCard.__pbRecoveryNotice = true;
      }
      this.compatibility = {
        ...(bridge.compatibility || {}),
        ...contract,
        warnings:[...new Map([...(bridge.compatibility?.warnings||[]),...(contract.warnings||[])].map(row=>[JSON.stringify(row),row])).values()],
        level:bridge.compatibility?.level==='degraded'?'degraded':contract.level,
        state: "ready",
        reason:
          contract.level === "degraded"
            ? bridge.compatibility?.reason ||
              "部分可选接口暂不可用，基础挂机仍可使用"
            : null,
      };
      this.status = "等待登录";
      this.observeProfileLoads();
      this.refreshUnlockProfile();
      this.observeSaves();
      return true;
    },
    settlementRetryScopeCurrent(scope=this.settlementRetryScope) {
      const app=scope?.app?.deref(),meta=scope?.meta?.deref(),account=scope?.account?.deref(),run=scope?.run?.deref();
      const current=!!scope&&this.settlementRetryScope===scope&&!!app&&!!meta&&!!account&&!!run&&
        this.app===app&&app.meta===meta&&meta.account===account&&app.run===run&&this.run===run&&
        run.state==='over'&&app.starting!==true&&this.runStartedAt===scope.runAt&&
        (this.controlEpoch||0)===scope.epoch&&meta.backend===scope.backend?.deref();
      if(!current&&this.settlementRetryScope===scope){
        this.settlementRetryScope=null;
        const backend=scope?.backend?.deref(),wrapped=backend?.req;
        if(wrapped?.__pbSettlementRetryOwner?.deref()===this&&typeof wrapped.__pbSettlementRetryOriginal==='function')backend[this.nativeMemberKey(backend,"req")]=wrapped.__pbSettlementRetryOriginal;
      }
      return current;
    },
    settlementRetryResultKey(value) {
      return JSON.stringify([value?.biome??null,value?.tier??null,value?.species??null,
        value?.time??null,value?.kills??null,value?.victory===true,value?.endHow??value?.end?.how??null]);
    },
    observeSettlementRetryEvent(event,context=null) {
      const prior=this.settlementRetryScope;
      if(event?.kind!=='settlement'||event.runAt!==this.runStartedAt||event.detached===true)return;
      if(event.saved===true){if(prior&&event.id===prior.ticketId){this.settlementRetryScope=null;this.observeSettlementRetries();}return;}
      const app=this.app,meta=app?.meta,account=meta?.account,run=app?.run,backend=meta?.backend;
      if(event.saved!==false||typeof WeakRef!=='function'||!run||run!==this.run||run.state!=='over'||
          !context||context.app!==app||context.meta!==meta||context.account!==account||context.run!==run||
          context.backend!==backend||context.runAt!==event.runAt||context.ticketId!==event.id||
          context.epoch!==(this.controlEpoch||0)||
          !account||typeof account!=='object'||!backend||typeof backend.req!=='function'||
          typeof event.id!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(event.id))return;
      if(this.settlementRetryScopeCurrent(prior)&&prior.ticketId===event.id)return;
      this.settlementRetryScope={app:new WeakRef(app),meta:new WeakRef(meta),account:new WeakRef(account),
        run:new WeakRef(run),backend:new WeakRef(backend),runAt:event.runAt,epoch:this.controlEpoch||0,
        ticketId:event.id,resultKey:this.settlementRetryResultKey(event),requestSaved:false,readRevision:this.profileReadRevision||0};
      this.observeSettlementRetries();
    },
    observeSettlementRetries() {
      const backend=this.app?.meta?.backend,current=this.settlementRetryScopeCurrent();
      if(typeof backend?.req!=='function'||typeof WeakRef!=='function')return;
      const prior=backend.req,owned=prior.__pbSettlementRetryOwner?.deref()===this;
      if(!current){if(owned&&typeof prior.__pbSettlementRetryOriginal==='function')backend[this.nativeMemberKey(backend,"req")]=prior.__pbSettlementRetryOriginal;return;}
      if(owned)return;
      const native=prior.__pbSettlementRetryReceipt&&typeof prior.__pbSettlementRetryOriginal==='function'
        ?prior.__pbSettlementRetryOriginal:prior,owner=new WeakRef(this),wrapped=function(path,method,...args){
        const self=owner.deref();
        if(!self)return native.call(this,path,method,...args);
        const scope=self.settlementRetryScope;let matching=false;
        try{matching=this===backend&&method==='POST'&&self.settlementRetryScopeCurrent(scope)&&path===`/runs/${scope.ticketId}/finish`&&
            self.settlementRetryResultKey(args[0]?.result)===scope.resultKey;
          if(!self.settlementRetryScope)self.observeSettlementRetries();}catch{}
        const result=native.call(this,path,method,...args);
        if(matching&&result&&typeof result.then==='function'){
          const accepted=()=>{try{if(self.settlementRetryScopeCurrent(scope)){
            scope.requestSaved=true;scope.readRevision=self.profileReadRevision||0;
          }}catch{}};
          // Observe exactly the native submitted request. A 409 is the native
          // already-saved path in flushNow; no helper request/retry is created.
          result.then(accepted,error=>{if(error?.status===409)accepted();});
        }
        return result;
      };
      wrapped.__pbSettlementRetryReceipt=true;wrapped.__pbSettlementRetryOwner=owner;
      wrapped.__pbSettlementRetryOriginal=native;backend[this.nativeMemberKey(backend,"req")]=wrapped;
    },
    observeNativePauseTransfers() {
      // Native 0.8.63+ suspend/resume is not ordinary endRun settlement.
      // Observe the original Promise only; never save, resume or discard here.
      const app=this.app,meta=app?.meta,self=this;
      if(!meta)return;
      for(const method of ["suspendRun","resumeRun"]){
        const original=meta[method];
        if(typeof original!=="function"||original.__pbNativePauseReceipt)continue;
        const wrapped=function(...args){
          const account=this.account,nativeEpoch=this.epoch,scope={app,meta:this,account,nativeEpoch},
            current=()=>self.app===app&&app?.meta===this&&this.account===account&&this.epoch===nativeEpoch,
            invalidate=()=>{if(!current())return;
              const proof=self.verifiedProfileObservation;
              if(proof?.app?.deref()===app&&proof.meta?.deref()===this&&proof.account?.deref()===account)proof.profile=null;
              // resumeRun merges an unsubmitted delta into the same profile.
              // Keep the separately cloned saved projection, not this proof.
              self.profileScopeObserved=true;self.unlockSelectionKey=null;
            },
            finish=()=>{try{invalidate();}catch{}finally{self.nativePauseTransfers?.delete(scope);}};
          try{invalidate();}catch{}
          self.nativePauseTransfers ||= new Set();self.nativePauseTransfers.add(scope);
          let result;
          try{result=original.apply(this,args);}catch(error){finish();throw error;}
          if(result&&typeof result.then==="function")result.then(finish,finish);else finish();
          return result;
        };
        wrapped.__pbNativePauseReceipt=true;meta[this.nativeMemberKey(meta,method)]=wrapped;
      }
    },
    nativePauseTransferPending() {
      const app=this.app,meta=app?.meta;
      let pending=false;
      for(const scope of this.nativePauseTransfers||[]){
        if(scope.app===app&&scope.meta===meta&&scope.account===meta?.account&&scope.nativeEpoch===meta?.epoch)pending=true;
        else this.nativePauseTransfers.delete(scope);
      }
      return pending;
    },
    nativeSavedGamePresent() {
      const app=this.app;
      if(app?.run&&app.run.state!=="over"||typeof app?.saved!=="function")return false;
      try{
        // The reviewed native getter is synchronous and account-keyed. Unknown
        // getter shapes/thenables are not evidence of a saved native game.
        const saved=app.saved();
        return !!saved&&typeof saved==="object"&&typeof saved.then!=="function"&&
          !!saved.ticket&&typeof saved.ticket==="object"&&!!saved.save&&typeof saved.save==="object";
      }catch{return false;}
    },
    observeSaves() {
      this.observeNativePauseTransfers?.();
      this.observeSettlementRetries();
      const meta = this.app?.meta,
        self = this;
      if (!meta?.endRun || meta.endRun.__pbSave) return;
      const original = meta.endRun;
      const wrapped = function (result, progress) {
        const id = this.ticket?.id || `run-${self.runStartedAt}`, savedAccount = this.account;
        // Settlement may return after the next run is already attached. Capture
        // actual native metadata now; never label a prior result with new settings.
        const app = self.app, endingRun = app?.run,
          rankingQualification=self.planRun===endingRun&&self.plan?.unlockAction?.kind==="qualify-ranking"?
            {...self.plan.qualification}:null,
          shinyFinishReason = self.shinyFinishReason;
        const runAt = self.runStartedAt;
        const settlementContext={app,meta:this,account:savedAccount,run:endingRun,
          backend:this.backend,runAt,ticketId:id,epoch:self.controlEpoch||0};
        const sameIdentity = () => self.app === app && app?.meta === this && this.account === savedAccount;
        const currentReceipt = () => sameIdentity() && self.savePromise === promise &&
          (app?.run === endingRun || !app?.run && self.run === endingRun);
        const runDescription = { biome: result.biome ?? endingRun?.biome?.id ?? null,
          endedAt: Date.now(), reportSpecies: endingRun?.player?.speciesId ?? result.species ?? endingRun?.startSpecies ?? null,
          tier: result.tier ?? endingRun?.tier ?? null,
          species: result.species ?? endingRun?.startSpecies ?? null,
          nativeMode: ["tower", "endless", "standard", "mutation"].includes(result.mode) ? result.mode :
            endingRun ? endingRun.mutation ? "mutation" : endingRun.tower ? "tower" : endingRun.endless ? "endless" : "standard" : null,
          endHow: typeof result.end?.how === "string" ? result.end.how : null,
          playerDead: typeof endingRun?.player?.dead === "boolean" ? endingRun.player.dead : null,
          cooperative: !!endingRun?.coop,
          towerFloor: Number.isInteger(result.tower?.floor) ? result.tower.floor : null,
          towerClearedFloor: result.tower && Array.isArray(result.splits) ? result.splits.length : null,
          towerWon: typeof result.tower?.won === "boolean" ? result.tower.won : null,
          towerRoof: typeof result.tower?.roof === "boolean" ? result.tower.roof :
            typeof endingRun?.tower?.roof === "boolean" ? endingRun.tower.roof : null,
          towerBeyond: typeof result.tower?.beyond === "boolean" ? result.tower.beyond :
            typeof endingRun?.tower?.beyond === "boolean" ? endingRun.tower.beyond : null };
        const observationFailed = (phase) => {
          try {
            self.saveObservationFailureCount = Math.min(1000000, (self.saveObservationFailureCount || 0) + 1);
            self.recordEvent({id:`save-observation-${runAt}-${self.saveObservationFailureCount}`,
              kind:"diagnostic",type:"saveObservationFailed",at:Date.now(),runAt,phase,
              message:"原生保存请求已返回，辅助回执记录未完成；保留原生结果并在安全菜单重新核验资料"});
          } catch { /* Optional helper diagnostics cannot replace a native result or rejection. */ }
        };
        const pendingBefore = self.savePending, previousPromise = self.savePromise;
        self.savePending = true;
        let request;
        try { request = original.call(this, result, progress); }
        catch (error) {
          if (self.savePromise === previousPromise) self.savePending = pendingBefore;
          throw error;
        }
        const promise = Promise.resolve(request).then(
          (response) => {
            // The native receipt is authoritative even if optional projection
            // or journaling fails. Such an observer fault must neither turn a
            // successful native finish into an error nor strand savePending.
            let observationPhase = "receipt-scope";
            try {
            const receiptCurrent = currentReceipt();
            if (receiptCurrent && shinyFinishReason && self.shinyFinishReason === shinyFinishReason)
              self.shinyFinishSaved = true;
            observationPhase = "profile-origin";
            const profile = this.profile, identityCurrent = sameIdentity();
            if(identityCurrent&&response?.profile===profile)self.confirmNativeProfileOrigin(profile,app,this,savedAccount);
            const liveReceipt = receiptCurrent&&self.menuProfileScopeCurrent();
            observationPhase = "clear-receipt";
            self.rememberVerifiedClearReceipt(result,{app,meta:this,account:savedAccount});
            observationPhase = "ranking-receipt";
            if(identityCurrent&&rankingQualification)self.rememberRankingParticipation(rankingQualification,result,response,
              {...runDescription,app,meta:this,account:savedAccount});
            observationPhase = "profile-projection";
            if (liveReceipt)
              self.commitUnlockProfile(profile, "native-end-run");
            observationPhase = "settlement-log";
            self.recordEvent({
              id,
              kind: identityCurrent ? "settlement" : "diagnostic",
              ...(!identityCurrent ? {type:"lateSettlement",message:"先前账号上下文的原生保存已返回，未计入当前对局或账号进度"} : {}),
              ...(!liveReceipt ? {detached:true} : {}),
              saved: true,
              at: Date.now(),
              runAt,
              victory: result.victory,
              time: result.time,
              kills: result.kills,
              ...runDescription,
              ...(identityCurrent ? {stardust:response.stardust,tasks:response.tasks} : {}),
              wallSeconds: (Date.now() - runAt) / 1000,
              shinies: (progress?.shinies || []).slice(),
              ...(liveReceipt ? {profile: {
                seen: profile.seen.slice(),
                league: profile.league.slice(),
                shinies: (profile.shinies || []).slice(),
                biomes: { ...profile.biomes },
                stardust: profile.stardust,
                totalStardust: profile.totalStardust,
                bonk: profile.bonk, totalBonk: profile.totalBonk,
                classics: (profile.classics || []).slice(), forms: (profile.forms || []).slice(),
                cosmetics: (profile.cosmetics || []).slice(),
                quests: { ...(profile.quests || {}) }, itemsOwned: (profile.itemsOwned || []).slice(),
                lab: { ...(profile.lab || {}) },
              }} : {}),
            });
            // A successful native ending confirms this run was saved even if
            // another native profile read is still pending. Goal completion
            // still uses the separately verified profile; tying this receipt
            // flag to that read could otherwise strand the summary forever.
            if (self.events.length > 300)
              self.events.splice(0, self.events.length - 300);
            } catch { observationFailed(observationPhase); }
            return response;
          },
          (error) => {
            let observationPhase = "rejection-scope";
            try {
            const identityCurrent = sameIdentity(), liveReceipt = currentReceipt();
            if (liveReceipt && self.shinyFinishReason === shinyFinishReason) self.shinyFinishSaved = false;
            observationPhase = "rejection-log";
            self.recordEvent({
              id,
              kind: identityCurrent ? "settlement" : "diagnostic",
              ...(!identityCurrent ? {type:"lateSettlement",message:"先前账号上下文的原生保存未成功，未改写当前对局或账号进度"} : {}),
              ...(!liveReceipt ? {detached:true} : {}),
              saved: false,
              at: Date.now(),
              runAt,
              ...runDescription,
              error: String(error?.message ?? error),
              time: result.time,
              kills: result.kills,
              victory: result.victory,
            },settlementContext);
            } catch { observationFailed(observationPhase); }
            throw error;
          },
        ).finally(() => {
          if (self.savePromise === promise) self.savePending = false;
        });
        self.savePromise = promise;
        return promise;
      };
      wrapped.__pbSave = true;
      meta.endRun = wrapped;
    },
    minibossThreats(r) {
      const hazards = [], enemies = [], scope = this.minibossChargeObservation;
      if (!r || this.run !== r || scope?.run !== r || scope.stage !== r.stage ||
          scope.terrain!==r.terrain||scope.owner!==r.minibosses||
          !["play", "paused", "modal"].includes(r.state) || r.regionCleared || r.player?.dead) {
        scope?.warnings.clear();
        return { hazards, enemies };
      }
      const en = r.enemies, now = r.time, list = r.minibosses?.list;
      if (!Number.isFinite(now) || !Array.isArray(list)) return { hazards, enemies };
      for (const entry of [...scope.warnings.keys()])
        if (!list.includes(entry)) scope.warnings.delete(entry);
      for (const entry of list) {
        const index = entry?.i, warning = scope.warnings.get(entry);
        if (!entry || entry.kind !== "totem" || entry.phys !== "charge" ||
            !Number.isInteger(index) || index < 0 || !Number.isInteger(entry.gen) ||
            scope.invalid.has(entry) || !this.minibossEntryCurrent(scope,entry) ||
            !en?.alive?.[index] || en.dying?.[index] > 0 ||
            en.gen?.[index] !== entry.gen || (warning && warning.gen !== entry.gen)) {
          scope.warnings.delete(entry);
          continue;
        }
        const active = Number.isFinite(entry.chargeT) && entry.chargeT > 0;
        const pending = warning && warning.stage === r.stage && now <= warning.start + 0.05;
        if ((active && entry.chargeHit) || (!active && !pending)) {
          scope.warnings.delete(entry);
          continue;
        }
        const dx = active ? entry.cdx : warning.dx, dz = active ? entry.cdz : warning.dz;
        const eta = active ? 0 : Math.max(0, warning.start - now);
        const duration = active ? entry.chargeT : warning.distance / 34;
        const x = en.x?.[index], y = en.y?.[index], z = en.z?.[index], radius = en.radius?.[index];
        const speed = en.speed?.[index], vx = en.vx?.[index], vz = en.vz?.[index];
        const kx = en.kx?.[index], kz = en.kz?.[index];
        if (![dx, dz, x, y, z, radius, speed, vx, vz, kx, kz, eta, duration].every(Number.isFinite) ||
            radius < 0 || speed < 0 || duration <= 0 || duration > 24 / 34 + 0.05) continue;
        // Native keeps ordinary movement during the .95 s tell and adds its
        // charge impulse to that movement. Bound origin drift rather than
        // pretending the decorative ground marks fix the launch position.
        const walk = Math.max(speed, Math.hypot(vx, vz));
        const drift = active ? (walk + Math.hypot(kx - dx * 34, kz - dz * 34)) * duration
          : (walk + Math.hypot(kx, kz)) * eta + walk * duration;
        const hp = r.player?.maxHp;
        hazards.push({ shape: "line", source: "miniboss-charge", index, gen: entry.gen,
          owner: "enemy", x, y, z, x2: x + dx * 34 * duration, z2: z + dz * 34 * duration,
          radius: radius + 1.2 + drift, maxHeight: 2, eta, life: eta + duration,
          persistent: true, oneShot: false, damageInterval: 1e9,
          damage: Number.isFinite(hp) && hp > 0 ? hp * 0.34 : null,
          phase: active ? "active" : "windup" });
      }
      return { hazards, enemies };
    },
    guardianChargeThreats(r) {
      const hazards = [], enemies = [], scope = this.guardianChargeObservation, boss = r?.boss;
      const clear = () => { if (scope) scope.warning = null; return { hazards, enemies }; };
      if (!r || this.run !== r || scope?.run !== r || scope.stage !== r.stage || scope.boss !== boss ||
          !["play", "paused", "modal"].includes(r.state) || r.regionCleared || r.player?.dead ||
          !boss?.alive || boss.kit) return clear();
      const en = r.enemies, index = boss.bossIndex, gen = en?.gen?.[index],
        key = `${index}:${gen}`, now = r.time;
      if (!Number.isInteger(index) || index < 0 || !Number.isInteger(gen) ||
          !en?.alive?.[index] || en.dying?.[index] > 0 || !(en.flags?.[index] & 4) ||
          scope.invalid.has(key) || !Number.isFinite(now)) return clear();
      if (scope.actor && (scope.actor.index !== index || scope.actor.gen !== gen)) return clear();
      scope.actor = { index, gen };
      scope.seen.add(key);
      const warning = scope.warning;
      if (warning && (warning.index !== index || warning.gen !== gen || warning.stage !== r.stage))
        scope.warning = null;
      const active = Number.isFinite(boss.chargeT) && boss.chargeT > 0,
        pending = scope.warning && now <= scope.warning.start + 0.05;
      if ((active && boss.chargeHit) || (!active && !pending)) return clear();
      const x = en.x?.[index], y = en.y?.[index], z = en.z?.[index], radius = en.radius?.[index],
        speed = en.speed?.[index], vx = en.vx?.[index], vz = en.vz?.[index],
        kx = en.kx?.[index], kz = en.kz?.[index];
      if (![x, y, z, radius, speed, vx, vz, kx, kz].every(Number.isFinite) || radius < 0 || speed < 0)
        return { hazards, enemies: [{ index, damage: null }] };
      const tell = scope.warning, eta = active ? 0 : Math.max(0, tell.start - now),
        duration = active ? boss.chargeT : tell.duration,
        chargeSpeed = active ? boss.chargeSpeed : tell.speed,
        dx = active ? boss.cdx : tell.dx, dz = active ? boss.cdz : tell.dz;
      if (![eta, duration, chargeSpeed, dx, dz].every(Number.isFinite) || duration <= 0 ||
          duration > 0.8 || chargeSpeed <= 0)
        return { hazards, enemies: [{ index, damage: null }] };
      const walk = Math.max(speed, Math.hypot(vx, vz)),
        drift = active ? (walk + Math.hypot(kx - dx * chargeSpeed, kz - dz * chargeSpeed)) * duration
          : (walk + Math.hypot(kx, kz)) * eta + walk * duration,
        cross = !active && tell.method === "sigCross", hp = r.player?.maxHp;
      // Cross fixes the target now but computes its direction at launch. Its
      // complete path lies within the origin-to-target capsule plus at most
      // four metres beyond that target; never guess its unrelated random lines.
      hazards.push({ shape: "line", source: "guardian-charge", index, gen, owner: "enemy",
        x, y, z, x2: cross ? tell.targetX : x + dx * chargeSpeed * duration,
        z2: cross ? tell.targetZ : z + dz * chargeSpeed * duration,
        radius: radius + 1.3 + drift + (cross ? 4 : 0), maxHeight: 2,
        eta, life: eta + duration, persistent: true, oneShot: false, damageInterval: 1e9,
        damage: Number.isFinite(hp) && hp > 0 ? hp * 0.34 : null,
        phase: active ? "active" : "windup", method: active ? "native-active" : tell.method });
      return { hazards, enemies };
    },
    nativeMemberKey(object, method) {
      // The reviewed bridge exposes logical names without changing native
      // call sites. Existing observers must wrap the actual current property,
      // otherwise native calls bypass a logical shadow (or a readonly alias).
      return this.bridge?.nativeMemberKey?.(object,method) || method;
    },
    wrapOwner(object, method, owner) {
      const original = object?.[method];
      if (typeof original !== "function" || original.__pbOwner) return;
      const self = this;
      object[this.nativeMemberKey(object,method)] = function (...args) {
        const prior = self.owner, priorSource = self.ownerSource;
        self.owner = owner; self.ownerSource = object;
        try {
          return original.apply(this, args);
        } finally {
          self.owner = prior; self.ownerSource = priorSource;
        }
      };
      object[method].__pbOwner = true;
    },
    attachPartialRun(run,contract) {
      if(this.partialRunScope?.run===run)return true;
      if(typeof run?.update!=='function'){this.blockCompatibility({...contract,reason:'对局更新入口暂未识别；已保留启动请求'});return false;}
      const key=this.nativeMemberKey(run,'update'),original=run.update,self=this;
      const scope={run,key,original,wrapper:null,epoch:this.controlEpoch||0};
      scope.wrapper=function(...args){
        if(self.enabled&&self.app?.run===run&&self.controlIdentityCurrent()&&self.automationAllowed()){
          try{self.partialStep(run,contract);}catch{self.status='基础接口仍在核验；其他已确认功能保持启用';}
        }
        return original.apply(this,args);
      };
      run[key]=scope.wrapper;this.partialRunScope=scope;this.run=run;this.planRun=null;
      this.compatibility={...this.compatibility,...contract,state:'partial',level:'degraded'};
      this.status='基础托管已启用，以下能力待修复：'+contract.missing.join('、');return true;
    },
    partialStep(run,contract) {
      if(run.state!=='play'||contract.capabilities?.movement!==true){this.release(true);return;}
      const p=run.player?.pos;if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.z))return;
      const radius=Number(run.terrain?.arenaR)||Number(run.terrain?.play)||40,
        center=run.terrain?.center||{x:0,z:0},cx=Number(center.x)||0,cz=Number(center.z)||0,
        angle=Math.atan2(p.z-cz,p.x-cx),r=Math.max(3,Math.min(30,radius*.55)),
        target={x:cx+Math.cos(angle+.45)*r,z:cz+Math.sin(angle+.45)*r},
        dx=target.x-p.x,dz=target.z-p.z,length=Math.hypot(dx,dz),yaw=Number(run.camYaw)||0;
      if(length>.1)this.move(dx/length,dz/length,yaw);
      this.status='基础移动中；未确认的弹幕、选择或交互接口单独等待修复';
    },
    attachRun(run) {
      const contract =
        typeof checkBridgeContract === "function"
          ? checkBridgeContract(this.bridge, { phase: "run", run })
          : { ok: false, missing: ["adapter.checkBridgeContract"] };
      if (!contract.ok) {
        this.incompatibleRun = run;
        return this.blockCompatibility({
          ...this.compatibility,
          ...contract,
          phase: "run",
          code: "run-contract-changed",
          reason: "当前对局缺少必要能力：" + contract.missing.join("、"),
        });
      }
      if(contract.capabilities?.combat===false)return this.attachPartialRun(run,contract);
      const p = run.player;
      this.incompatibleRun = null;
      this.compatibility = {
        ...this.compatibility,
        ...contract,
        level:
          this.compatibility.level === "degraded" ? "degraded" : contract.level,
        optionalMissing: [
          ...new Set([
            ...(this.compatibility.optionalMissing || []),
            ...(contract.optionalMissing || []),
          ]),
        ],
        warnings: [
          ...(this.compatibility.warnings || []),
          ...(contract.warnings || []),
        ],
        disabledFeatures: [
          ...new Set([
            ...(this.compatibility.disabledFeatures || []),
            ...(contract.disabledFeatures || []),
          ]),
        ],
        state: "ready",
        phase: "run",
        missing: [],
        reason:
          this.compatibility.level === "degraded"
            ? this.compatibility.reason
            : null,
        capabilities: {
          ...(this.compatibility.capabilities || {}),
          ...(contract.capabilities || {}),
        },
      };
      if (this.run !== run) {
        if(this.cooperativeRescueCode)this.releaseCooperativeRescueInput();
        this.documentLeaving = null;
      }
      this.betweenRunWaitScope = null;
      this.characterInterRunMenu = null;
      this.panelInspection = null;
      this.panelInspectionRun = null;
      if(this.finiteSettlementScope?.run!==run)this.finiteSettlementScope=null;
      this.run = run;
      this.goalExposureScope = null;
      this.characterPracticeScope = null;
      this.characterFinishScope=null;
      this.towerShopRefreshBlocked = null;
      this.towerShopPreviewVisit = null;
      this.towerChoiceRestart = null;
      this.unlockRunAccount = this.app?.meta?.account;
      this.routeObservation = null;
      this.interactionApproachScope = null;
      this.interactionApproachPoints = null;
      for (const method of ["pause", "openMap"]) {
        const nativePause = run[method];
        if (typeof nativePause !== "function" || nativePause.__pbPauseIntent) continue;
        const self = this, pauseApp = this.app;
        run[this.nativeMemberKey(run,method)] = function (...args) {
          const release = self.pointerReleaseEvent;
          const leaving=self.documentLeaving,
            leavingScope=leaving&&leaving.app===self.app&&leaving.run===this&&
              leaving.account===self.app?.meta?.account&&leaving.epoch===(self.controlEpoch||0),
            matches=scope=>scope&&scope.app===self.app&&self.app===pauseApp&&self.unlockRunAccount===self.app?.meta?.account&&
              scope.run===this&&self.run===this&&self.app?.run===this&&
              scope.account===self.app?.meta?.account&&scope.epoch===(self.controlEpoch||0)&&scope.enabled===self.enabled,
            currentEvent=window.event,
            manualInput=currentEvent?.isTrusted===true&&(
              currentEvent.type==="keydown"&&["Escape",self.code("pause")].includes(currentEvent.code)||
              ["click","pointerup"].includes(currentEvent.type)),
            systemEvent=self.nativeSystemPauseEvent,
            systemLoss=matches(systemEvent)&&systemEvent.event===window.event&&
              ["pointerlockchange","fullscreenchange","visibilitychange","blur"].includes(currentEvent?.type)&&
              (currentEvent.type==="blur"||document.hidden===true||document.hasFocus?.()===false);
          // Suppress only an exact scoped loss dispatch with current system
          // focus/visibility evidence. A bare unlock may be WebView2 consuming
          // Escape before DOM keydown; preserve that native pause as unknown.
          // No timed input window may swallow a later player pause.
          if(method==="pause"&&this.state==="play"&&self.enabled&&systemLoss&&!manualInput&&!leavingScope&&
              self.scriptPauseRun!==this&&self.graphicsPauseRun!==this){
            const type=window.event.type,notice=self.nativeAutoPauseNotice;
            if(!notice||notice.run!==this||notice.type!==type){
              self.nativeAutoPauseNotice={run:this,type};
              self.recordEvent({id:`native-auto-pause-${self.runStartedAt}-${Date.now()}`,kind:"diagnostic",
                type:"nativeAutomaticPauseSuppressed",at:Date.now(),source:type,
                message:"已观测系统失焦或页面隐藏，保留当前挂机；未记为玩家手动暂停"});
              if(self.events.length>300)self.events.splice(0,self.events.length-300);
            }
            return;
          }
          // Chromium can run microtasks between listeners of the same native
          // event. Bind this exemption to that exact dispatch, never a timed
          // window in which a subsequent Escape or pause button could be lost.
          if (method === "pause" && !manualInput && release && release.event === window.event &&
              release.event?.type === "pointerlockchange" && !document.pointerLockElement &&
              release.run === this && self.app?.run === this &&
              release.account === self.app?.meta?.account &&
              release.epoch === (self.controlEpoch || 0) &&
              release.enabled === self.enabled && !self.pauseRequested)
            return;
          const before = this.state;
          const result = nativePause.apply(this, args);
          const lifecyclePause = method === "pause" && leaving &&
            ["pointerlockchange", "fullscreenchange", "visibilitychange"].includes(window.event?.type) &&
            leaving.app === self.app && leaving.run === this &&
            leaving.account === self.app?.meta?.account && leaving.epoch === (self.controlEpoch || 0);
          // Keep the native pause, return value and exceptions. An unloading
          // document losing browser controls is not a new player stop request.
          if (self.enabled && self.app?.run === this && before !== "paused" &&
              this.state === "paused" && self.scriptPauseRun !== this && self.graphicsPauseRun !== this && !lifecyclePause)
            self.stop(manualInput
              ?`游戏已手动暂停，点击继续挂机或按${self.settings.hotkeyToggle}继续`
              :"游戏已暂停，来源未确认，等待玩家继续", {
              source: "native-pause", code: method === "openMap" ? "native-map" : "native-pause",
            });
          return result;
        };
        run[method].__pbPauseIntent = true;
        run[method].__pbPointerRelease = true;
      }
      this.observePointerLockInput();
      this.ultimateHistory = null;
      this.cadence.reset("run-changed");
      this.requiredSelectionCohort={run,required:["characters","auto"].includes(this.settings.mode)};
      this.requiredSelectionPause=null;
      this.target = null;
      this.modal = null;
      this.clearNotice = null;
      this.coverWarning = null;
      this.quakeWarning = null;
      this.lastCoverResult = null;
      this.hazards = [];
      this.navigation = this.navigationFor(run);
      this.navTarget = null;
      this.blocked.clear();
      this.visits.clear();
      this.runStartedAt = Date.now();
      this.damageLog = [];
      this.observeCombat(run);
      this.shinySeenKeys = new Set();
      this.shinyFinishReason = null;
      this.shinyFinishSaved = false;
      this.shinyFinishing = false;
      this.objectiveFinishing = false;
      this.terrainRecoveryFinishing = false;
      this.terrainRecoveryState = null;
      this.terrainHopState = null;
      this.terrainHopScope = null;
      this.crowdEscapeState = null;
      this.crowdEscapeScope = null;
      this.flightControlScope=null;
      this.flightLandingScope=null;
      this.flightTravelPlanner=null;
      this.flightCollectionScope=null;
      this.flightInteractionScope=null;
      this.explorationState = null;
      this.finalReplacementCache = null;
      this.finalForgetAttempts = new Map();
      this.finalFusionAttempts = new Map();
      this.replacementRetryRun = null;
      this.replacementRetryBucket = null;
      this.nativeSystemPauseEvent = null;
      this.nativeAutoPauseNotice = null;
      this.liveRecoveryNotice = null;
      this.interactionSpent = 0;
      this.priorityShopScope = null;
      this.riskyVisits = new Set();
      this.pendingInteractionSpend = null;
      this.pendingWorldAttempt = null;
      this.lastWorldInteraction = null;
      this.worldInteractionScope = null;
      this.interactionTracker = createInteractionTracker();
      this.tacticalDirector = new TacticalDirector();
      this.tacticalAssessment = null;
      this.choiceHistory = { unplannedRounds: 0, rerollsThisPage: 0 };
      this.observeWorldInteractions(run);
      this.observeShinies(run);
      this.recordHistory({
        event: "run",
        biome: run.biome.id,
        tier: run.tier,
        species: run.startSpecies ?? run.player?.speciesId,
        nativeMode: run.mutation ? "mutation" : run.tower ? "tower" : run.endless ? "endless" : "standard",
        at: this.runStartedAt,
      });
      const self = this,
        original = run.update;
      run[this.nativeMemberKey(run,"update")] = function (dt) {
        self.lastNativeUpdateAt = Date.now();
        if (self.enabled) {
          const active = this.state === "play";
          const started = performance.now();
          try {
            self.step(this, dt);
          } catch (error) {
            self.fail(error);
          }
          const elapsed = performance.now() - started;
          if (active) {
            self.frames++;
            self.totalMs += elapsed;
            self.maxMs = Math.max(self.maxMs, elapsed);
            self.timings.push(elapsed);
            if (self.timings.length > 1800) self.timings.shift();
          }
        }
        try { return original.call(this, dt); }
        finally { self.pendingTapCodes.clear(); }
      };
      for (const name of [
        "enemies",
        "boss",
        "minibosses",
        "director",
        "events",
        "mewtwo",
        "sanctuary",
        "endless",
        "tower",
        "tide",
        "mapEvents",
        "canela", "cave", "encina", "iris",
      ]) {
        for (const method of ["update", "tick"])
          this.wrapOwner(run[name], method, "enemy");
      }
      this.wrapOwner(run.allies, "update", "friendly");
      this.wrapOwner(run.combat, "eliteBurst", "enemy");
      const later = run.later;
      run[this.nativeMemberKey(run,"later")] = function (seconds, callback) {
        const owner = run.ghostDepth > 0 ? "friendly" : self.owner, ownerSource = self.ownerSource,
          worldSource=self.currentWorldInteractionScope(run);
        return later.call(this, seconds, function (...args) {
          const prev = self.owner, previousSource = self.ownerSource,previousWorld=self.worldInteractionScope;
          self.owner = owner; self.ownerSource = ownerSource;
          self.worldInteractionScope=self.currentWorldInteractionScope(run,worldSource);
          try {
            return callback.apply(this, args);
          } finally {
            self.owner = prev; self.ownerSource = previousSource;
            self.worldInteractionScope=previousWorld;
          }
        });
      };
      const warn = run.vfx.telegraph;
      run.vfx[this.nativeMemberKey(run.vfx,"telegraph")] = function (x, y, z, radius, color, duration) {
        if (!(run.ghostDepth > 0) && self.owner === "enemy" &&
            !(typeof isMapEventVisualWarning === "function" && isMapEventVisualWarning(run,"telegraph",Array.from(arguments),self.ownerSource)) && !(typeof isLegendaryVisualWarning === "function" &&
            isLegendaryVisualWarning(run,"telegraph",Array.from(arguments),self.ownerSource)))
          self.hazards.push({
            x,
            y,
            z,
            radius,
            until: run.time + duration + 0.25,
            impact: run.time + duration,
            owner: self.owner,
            maxHeight: 2.2,
            oneShot: true,
          });
        return warn.apply(this, arguments);
      };
      const beam = run.vfx.beams.spawn;
      run.vfx.beams[this.nativeMemberKey(run.vfx.beams,"spawn")] = function (x, y, z, x2, y2, z2, width, color, life) {
        if (!(run.ghostDepth > 0) && self.owner === "enemy" && !(typeof isLegendaryVisualWarning === "function" &&
            isLegendaryVisualWarning(run,"beam",Array.from(arguments),self.ownerSource)))
          self.hazards.push({
            x,
            y,
            z,
            x2,
            z2,
            radius: width + 0.2,
            until: run.time + (life || 0.3),
            impact: run.time,
          });
        return beam.apply(this, arguments);
      };
      const lineStrike = run.boss.lineStrike;
      run.boss[this.nativeMemberKey(run.boss,"lineStrike")] = function (x, z, x2, z2, radius, delay) {
        self.hazards.push({
          x,
          z,
          x2,
          z2,
          radius,
          y: run.terrain.height?.(x, z),
          maxHeight: 1.8,
          oneShot: true,
          impact: run.time + delay,
          until: run.time + delay + 0.3,
          owner: "enemy",
        });
        return lineStrike.apply(this, arguments);
      };
      const strike = run.boss.strike;
      run.boss[this.nativeMemberKey(run.boss,"strike")] = function () {
        const hp = run.player.hp;
        const result = strike.apply(this, arguments);
        if (run.player.hp < hp)
          self.lastBossAttack = {
            time: run.time,
            pattern: this.last,
            move: this.moveName,
            charging: this.chargeT,
            waves: this.waves.length,
          };
        return result;
      };
      this.observeNativeModals(run.ui);
      return true;
    },
    // App input/HUD outlive a run. Build their wrappers outside attachRun so
    // the shared closure context cannot retain the first run and its renderer graph.
    syncReleasedMouseAudio() {
      const run = this.app?.run, audio = run?.audio;
      const keep = this.enabled && this.mouseReleased && run?.state === 'play';
      const previous = this.releasedMouseAudio;
      if (previous && (!keep || previous.audio !== audio || previous.account !== this.app?.meta?.account)) {
        const settings = previous.app?.meta?.profile?.settings;
        previous.audio.setHiddenMute?.((document.hidden === true || document.hasFocus?.() === false) && (settings?.muteHidden ?? true));
        this.releasedMouseAudio = null;
      }
      if (!keep || typeof audio?.setHiddenMute !== 'function') return;
      this.releasedMouseAudio = { audio, app: this.app, account: this.app?.meta?.account };
      // Use the original mixer, leave master/music/sfx/cries and game data alone.
      if (audio.hiddenMute !== false) audio.setHiddenMute(false);
      if (audio.ctx?.state === 'suspended') audio.wake?.();
    },
    observePointerLockInput() {
      const input = this.app?.input;
      if (typeof input?.requestLock === "function" && !input.requestLock.__pbPointerRelease) {
        const original = input.requestLock, self = this;
        input[this.nativeMemberKey(input,"requestLock")] = function (...args) {
          if (self.panelInspectionClosing || self.mouseReleased && self.enabled) return;
          return original.apply(this, args);
        };
        input.requestLock.__pbPointerRelease = true;
      }
    },
    observeNativeModals(ui) {
      const self=this;
      for (const [method, kind, index, callback] of [
        ["showLevelUp", "upgrade", 1, 2],
        ["showBlessing", "blessing", 2, 3],
        ["showItemChoice", "itemChoice", 1, 2],
        ["showItem", "item", 1, 2],
        ["showBranch", "branch", 1, 2],
        ["showParty", "party", 1, 2],
        ["showDitto", "ditto", -1, 1],
        ["showShinySwap", "shinySwap", 1, 4],
        ["showPact", "pact", 1, 2],
        ["showShop", "shop", -1, 1],
        ["showForget", "forget", -1, 1],
        ["showSlots", "slots", 1, 2],
        ["showFusion", "fusion", 1, 2],
        ["showTrade", "trade", 1, 2],
        ["showDojo", "dojo", 1, 3],
        ["relicChoice", "relic", 1, 2],
        ["showPause", "pause", -1],
        ["showMap", "map", -1],
        ["showPauseSettings", "pauseSettings", -1],
        ["showMoveGuide", "moveGuide", -1],
        ["showFusionGuide", "fusionGuide", -1],
        ["showMapLegend", "mapLegend", -1],
      ]) {
        const fn = ui[method];
        if (!fn || fn.__pbWrapped) continue;
        const wrapped = function (...args) {
          // Fan out only through the existing owned page wrapper. No new native
          // hooks, requests or behavior changes are installed for notifications.
          try{const observer=self.wecomPushObserver;
          if(observer?.wantsModal(kind)&&typeof args[callback]==='function'){
            const nativeChoose=args[callback],run=args[0],scope=observer.scope(self),stage=run?.stage,terrain=run?.terrain,
              openedOffers=kind==='shinySwap'?[args[1],args[2]]:args[index];
            args[callback]=function(...values){
              let before=null,readGold=false;
              try{readGold=observer.needsModalGold(kind);if(readGold)before=run?.gold;}catch{}
              const result=nativeChoose.apply(this,values);
              try{if(self.wecomPushObserver===observer&&observer.scope(self)===scope&&self.app?.run===run&&run.stage===stage&&run.terrain===terrain)
                observer.modal(self,{kind,offers:openedOffers},{action:['reroll','skip','banish'].includes(values[1])?values[1]:
                  kind==='item'&&typeof values[0]==='boolean'?(values[0]?'take':'sell'):values[0]==null?'return':'choose',
                  selection:values[0],goldDelta:readGold&&Number.isFinite(before)&&Number.isFinite(run.gold)?run.gold-before:null});}catch{}
              return result;
            };
          }}catch{}
          const slotObservation = kind === "slots" ? { paid: false } : null;
          if (slotObservation && typeof args[1]?.pay === "function") {
            const native = args[1];
            args[1] = {
              ...native,
              pay(...values) {
                const result = native.pay.apply(native, values);
                slotObservation.paid = true;
                return result;
              },
            };
          }
          const out = fn.apply(this, args);
          if (args[0] !== self.app?.run) return out;
          self.modal = {
            kind,
            offers: kind === "shinySwap" ? [args[1], args[2]] : args[index],
            choose:
              typeof args[callback] === "function" ? args[callback] : null,
            slotObservation,
            branchOptions: kind === "branch" && args[3] && typeof args[3] === "object" ? args[3] : null,
            // Accept a synchronous native interaction, or its explicitly
            // scoped native later/whenFree callback. A prior E target alone
            // is never evidence that an unrelated XP/item page came from it.
            entity: !["pause","map","pauseSettings","moveGuide","fusionGuide","mapLegend"].includes(kind)
              ? self.currentWorldInteractionScope(args[0])?.entity || null : null,
            at: performance.now(),
            run: args[0],
            stage:args[0]?.stage,terrain:args[0]?.terrain,root:this.modalEl || null,
          };
          try{self.wecomPushObserver?.modal(self,self.modal);}catch{}
          return out;
        };
        wrapped.__pbWrapped = true;
        ui[this.nativeMemberKey(ui,method)] = wrapped;
      }
    },
    observeWorldInteractions(run) {
      const owner=run.interactables,self=this;
      // Native altar rewards are proximity-driven, so no E/interact scope
      // exists when altarDone opens its mandatory blessing page.
      for(const method of ["interact","altarDone"]){
        const native=owner?.[method];if(typeof native!=="function" || native.__pbWorldSource)continue;
        owner[this.nativeMemberKey(owner,method)]=function(entity,...args){
          const previous=self.worldInteractionScope;
          const auditBefore=self.battleRecorder?.safe(()=>{
            self.battleRecorder.observe(run,self,true); return self.battleRecorder.frame(run,self,true);
          });
          self.worldInteractionScope=this===run.interactables && self.app?.run===run
            ? {run,owner:this,entity,stage:run.stage,terrain:run.terrain,
              app:self.app,meta:self.app.meta,account:self.app.meta.account} : null;
          try{return native.call(this,entity,...args);}
          finally{
            self.worldInteractionScope=previous;
            self.battleRecorder?.safe(()=>self.battleRecorder.event("world_interaction", {
              nativeMethod:method, kind:entity?.kind ?? null, sub:entity?.data?.sub ?? null,
              before:auditBefore, after:self.battleRecorder.frame(run,self,true),
              used:typeof entity?.used === "boolean" ? entity.used : null,
              resourceAttribution:"unknown", evidence:"observed-native-call-scope" }));
          }
        };
        owner[method].__pbWorldSource=true;
      }
    },
    currentWorldInteractionScope(run,scope=this.worldInteractionScope) {
      return scope && scope.run===run && this.app?.run===run && scope.owner===run.interactables &&
        scope.stage===run.stage && scope.terrain===run.terrain && scope.app===this.app &&
        scope.meta===this.app.meta && scope.account===this.app.meta.account ? scope : null;
    },
    tasks() {
      if (
        this.compatibility.capabilities?.tasks === false ||
        typeof this.app?.meta?.task !== "function"
      )
        return [];
      const meta = this.app.meta,
        out = [];
      for (const period of ["daily", "weekly"]) {
        const p = meta.profile[period];
        if (!p) continue;
        const count = Array.isArray(p.ids) ? p.ids.length : 3;
        for (let i = 0; i < count; i++) {
          const task = meta.task(period, i);
          if (task)
            out.push({
              ...task,
              period,
              index: i,
              progress: p.prog[i] || 0,
              claimed: !!p.claimed[i],
            });
        }
      }
      return out;
    },
    activityModeDefinition(settings = this.settings, mode = this.selectedGoalMode(settings)) {
      const defined = (config.unlockCatalog?.eventModes || []).find(entry =>
        entry && entry.id === mode && typeof entry.eventId === "string" && entry.eventId);
      if (defined) return defined;
      // Keep legacy hosts and saved selections compatible without assigning a
      // newly observed event to the wrong native entrance.
      if (mode === "tower") return {id:"tower",eventId:"halloween26",engineMode:"tower",name:"紫苑塔活动"};
      if (/^event:[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(mode))
        return {id:mode,eventId:mode.slice(6),engineMode:"unknown",name:mode.slice(6),strategySupported:false};
      return null;
    },
    activityModeStates() {
      const definitions = config.unlockCatalog?.eventModes?.length ? config.unlockCatalog.eventModes :
        [{id:"tower",eventId:"halloween26"}], native = this.publicEventState();
      // The native backend initializes skew to zero and only replaces it when
      // it adopts a server profile timestamp. Without that synchronization we
      // do not turn the computer's local calendar into an activity status.
      let serverNow = null;
      try {
        if (Number.isFinite(this.app?.backend?.clockSkew) && this.app.backend.clockSkew !== 0 &&
            typeof this.app?.meta?.now === "function") {
          const now = this.app.meta.now();
          if (Number.isFinite(now)) serverNow=now;
        }
      } catch { /* Native live/claimable remains authoritative without a clock. */ }
      return definitions.filter(entry => typeof entry?.id === "string" && typeof entry.eventId === "string")
        .map(entry => {
          const state = native.find(event => event.id === entry.eventId), live = state?.live ?? null,
            claimable = state?.claimable ?? null, startsAt=Date.parse(entry.startsAt),endsAt=Date.parse(entry.endsAt),
            eventStatus = live === true ? "active" : ["expired","upcoming"].includes(state?.eventStatus) ? state.eventStatus :
              live === false && serverNow !== null && Number.isFinite(endsAt) && serverNow >= endsAt ? "expired" :
              live === false && serverNow !== null && Number.isFinite(startsAt) && serverNow < startsAt ? "upcoming" :
              live === false ? "inactive" : "unknown";
          return {id:entry.id,eventId:entry.eventId,live,claimable,eventStatus};
        });
    },
    modePlanningSettings(settings = this.settings, mode = this.selectedGoalMode(settings)) {
      const dictionary = settings.modeSettings && typeof settings.modeSettings === "object" && !Array.isArray(settings.modeSettings)
        ? settings.modeSettings : null;
      const routeKey = mode === "leaderboard" ? `leaderboard-${["endless","survival"].includes(settings.leaderboardGoal) ? "survival" : settings.leaderboardGoal === "time" ? "time" : "kills"}` : mode;
      const entry = dictionary?.[routeKey];
      const stored = dictionary ? entry && typeof entry === "object" && !Array.isArray(entry) ? entry : {} : settings;
      // Activity rewards may require either ordinary matches or their own
      // special entrance. Legacy global/event routes cannot change that rule.
      const nativeEventRoute = !!this.activityModeDefinition(settings,mode);
      const biome = !nativeEventRoute && typeof stored.biome === "string" && stored.biome ? stored.biome : "auto";
      const tier = !nativeEventRoute && stored.tier !== "auto" && stored.tier !== null && stored.tier !== undefined &&
        (typeof stored.tier === "number" || typeof stored.tier === "string" && /^[012]$/.test(stored.tier)) &&
        Number.isInteger(Number(stored.tier)) && Number(stored.tier) >= 0 && Number(stored.tier) <= 2 ? Number(stored.tier) : undefined;
      const campStage=normalizedRankingCampStage(stored.campStage,routeKey),campRoute=rankingCampRoute(routeKey);
      return {...settings,mode,biome,tier,...(campRoute?{campStage}:{}),
        modePreference:{mode,routeKey,biome,tier:tier ?? "auto",...(campRoute?{campStage}:{}),...(nativeEventRoute ? {nativeEventRoute:true} : {})}};
    },
    leaderboardCampState(r) {
      const plan=this.plan,preference=plan?.modePreference,kind=rankingCampRoute(preference?.routeKey);
      // Quantity-only outfit work can dwell in the requested real endless area.
      // This marker belongs to the executed plan, not next-run UI preferences.
      const counting=plan?.appearanceCounting;
      if(r&&this.app?.run===r&&this.planRun===r&&!r.tower&&!plan?.autoManage&&r.endless&&
          ['appearance','wardrobe'].includes(plan?.goalMode)&&counting?.eligible===true&&counting.mode==='endless'){
        const finalStage=reviewedEndlessAreaCount(r.biome),migrations=Number(r.migrations),
          requestedStage=counting.countCampStage,automatic=requestedStage==='auto',
          targetStage=Math.min(finalStage,automatic?1:Number(requestedStage)),progressStage=migrations+1;
        if(!Number.isInteger(finalStage)||!Number.isSafeInteger(migrations)||migrations<0||
            !Number.isInteger(targetStage)||targetStage<1)return null;
        return {kind:'endless',appearanceCounting:true,requestedStage,automatic,targetStage,finalStage,
          stage:(progressStage-1)%finalStage+1,progressStage,holding:progressStage>=targetStage,
          reason:automatic?'数量目标自动驻留首个无尽区域，达标或自然结束后核验保存':'按外观数量目标的指定无尽区域驻留'};
      }
      if(!r||this.app?.run!==r||this.planRun!==r||r.tower||plan?.autoManage||plan?.unlockAction||plan?.goalProgress||
          !kind||kind==="kills"&&(r.endless||plan.objective!=="kills")||
          kind==="endless"&&(!r.endless||!["endless","survival"].includes(plan.objective)))return null;
      const requestedStage=normalizedRankingCampStage(preference.campStage,preference.routeKey),automatic=requestedStage==="auto",
        finalStage=kind==="endless"?reviewedEndlessAreaCount(r.biome):reviewedStandardStageCount(r.biome),
        targetStage=Math.min(finalStage,automatic?(kind==="endless"?1:3):requestedStage),
        migrations=Number(r.migrations),progressStage=kind==="endless"?
          Number.isSafeInteger(migrations)&&migrations>=0?migrations+1:null:Number(r.stage);
      if(!Number.isInteger(finalStage)||!Number.isFinite(progressStage))return null;
      const stage=kind==="endless"?(progressStage-1)%finalStage+1:progressStage,
        reason=automatic?(kind==="endless"?"自动选择初始区域，减少非必要迁移；并非所有配装的最优层":
          "自动沿用第3关驻留策略，按本图实际关卡数收敛"):"使用本模式保存的挂机区域";
      return {kind,requestedStage,automatic,targetStage,finalStage,stage,progressStage,
        holding:progressStage>=targetStage,reason};
    },
    leaderboardCampBlocks(r,object) {
      const camp=this.leaderboardCampState(r);
      return camp?.holding===true&&!!object&&(object.kind==="portal"||
        camp.kind==="kills"&&["boss","shrine"].includes(object.kind));
    },
    leaderboardCampTargetAllowed(r,target) {
      const camp=this.leaderboardCampState(r);
      if(!camp?.holding)return true;
      if(this.leaderboardCampBlocks(r,target?.entity))return false;
      return camp.kind!=="kills"||!(target?.id==="bossfight"||Number.isInteger(target?.enemyIndex)&&target.enemyIndex===r.boss?.bossIndex&&
        !target.captureSource&&!target.captureWindow);
    },
    cooperativePortalAvoidance(r) {
      return !!r?.coop?.portalReady&&!r.coop.advancing && (this.leaderboardCampState(r)?.holding===true ||
        shinyStageDwell(r,this.settings,this.plan).holding ||
        this.finalRewardCleanupState(r).holding ||
        this.bonkCleanupState(r).holding ||
        this.settings.convenience?.coop?.enabled===true&&this.settings.convenience.coop.doNotPortal===true);
    },
    cooperativePortalEscapeTarget(r) {
      if(!this.cooperativePortalAvoidance(r))return null;
      const pos=r.player.pos;
      for(const point of cooperativeReadyPortalEscapeCandidates(r,true)) {
        const y=r.terrain.height?.(point.x,point.z);
        if(!Number.isFinite(y)||!this.withinArena(r,point.x,point.z,1))continue;
        if(point.distance>.1&&!this.walkRoute(r,pos,(point.x-pos.x)/point.distance,(point.z-pos.z)/point.distance,point.distance,1))continue;
        return {x:point.x,y,z:point.z,radius:.35,id:"cooperative-portal-leave",cooperativePortalEscape:true,
          label:"退出已准备的传送门，保留当前关卡"};
      }
      return null;
    },
    autoDifficulty(plan, settings, profile) {
      if (plan.mode === "endless" || plan.mode === "tower") return {tier:0,reason:"原生无尽或活动模式使用固定难度"};
      if (plan.unlockAction?.kind === "win-map") return {tier:plan.tier,reason:"本模式配置与当前原生地图前置相符，使用该前置要求的难度"};
      if (settings.tier !== undefined && settings.tier !== "auto") return {tier:plan.tier,reason:"使用本模式保存的难度选择"};
      if (["resources","leaderboard"].includes(settings.mode)) {
        const maximum = Math.min(2,Number(profile.biomes?.[plan.biome]) || 0), candidates=[];
        for (let tier=0;tier<=maximum;tier++) {
          const records=this.events.filter(event=>event.kind === "settlement" && event.saved && event.biome === plan.biome && event.tier === tier).slice(-8);
          if(records.length<3 || records.filter(event=>event.victory).length/records.length<2/3) continue;
          candidates.push({tier,rate:records.reduce((sum,event)=>sum+(event.stardust || 0),0)/
            Math.max(1,records.reduce((sum,event)=>sum+(event.wallSeconds || event.time || 0),0))});
        }
        candidates.sort((a,b)=>b.rate-a.rate || a.tier-b.tier);
        if(candidates.length)return {tier:candidates[0].tier,reason:"自动比较本会话已保存的难度收益样本（至少3局且胜率达标）"};
        return {tier:0,reason:"尚无足够的更高难度已保存收益样本，自动从普通难度积累"};
      }
      return {tier:plan.tier ?? 0,reason:"按当前目标及已解锁状态选择难度，普通遭遇优先降低风险"};
    },
    selectedGoalMode(settings = this.settings) {
      if (settings.mode === "maps") return "map";
      if (settings.mode === "events" || settings.mode === "unlocks" && settings.unlockCategory === "events") {
        const legacy = settings.unlockTargets?.events,
          eventId = typeof legacy === "string" && /^events:([A-Za-z0-9][A-Za-z0-9_-]{0,99}):/.exec(legacy)?.[1];
        return eventId && eventId !== "halloween26" ? "event:"+eventId : "tower";
      }
      if (settings.mode !== "unlocks") return settings.mode || "auto";
      const category = settings.unlockCategory || "all";
      return category === "all" ? "auto" : category === "maps" ? "map" : category === "events" ? "tower" : category;
    },
    explicitShinyTarget(settings = this.settings) {
      if (Object.prototype.hasOwnProperty.call(settings.unlockTargets || {},"shiny")) {
        const target = settings.unlockTargets.shiny;
        return typeof target === "string" && target.trim().length > 0 && target !== "auto";
      }
      const value = typeof resolveShinySettings === "function" ? resolveShinySettings(settings) : settings;
      return value.shinyMode === "target" && Number(value.shinyTargetId) > 0;
    },
    goalWaitSnapshot(r) {
      const source = this.plan?.goalSource;
      const classic=this.plan?.classicTargetIds?.length>0,
        deadline = classic ? Number.isFinite(r.capture?.classicAt) ? r.capture.classicAt : null : source?.kind === "mewtwo-event"
        ? (Number.isFinite(r.mewtwo?.at) && r.mewtwo.at >= 70 && r.mewtwo.at <= 150 ? r.mewtwo.at : 150) + 45
        : Math.min(300,Number(source?.earliestStageTime)+30);
      return {reason:classic ? r.capture?.classic ? "追踪当前原生经典异色，正常削弱并捕获" : deadline==null ? "等待原生初始化本阶段经典异色判定，不重掷随机数" : "等待本阶段已判定的原生经典异色机会；随机物种不保证命中指定目标" : source?.kind === "mewtwo-event" ? "等待原生超梦事件窗口，暂缓普通首领；超时即继续推进" : "等待已确认的原生后期敌池，超时即继续推进",
        waitUntilStageTime:deadline,waitUntilGameTime:deadline==null ? null : r.time-r.stageTime+deadline,
        remainingSeconds:deadline==null ? null : Math.max(0,deadline-r.stageTime),sourceKind:classic ? "classic" : source?.kind};
    },
    goalStageHold(r) {
      const source = this.plan?.goalSource;
      if (this.plan?.classicTargetIds?.length) return this.classicHoldStage(r);
      if (!source || r.endless || r.sanctuary || r.bossSpawned || r.boss?.alive || r.stageCleared) return false;
      if (source.kind === "mewtwo-event" && [2,3].includes(r.stage) && !r.mewtwoFought && r.mewtwo?.state === "wait") {
        const at = Number.isFinite(r.mewtwo.at) && r.mewtwo.at >= 70 && r.mewtwo.at <= 150 ? r.mewtwo.at : 150;
        return r.stageTime < at + 45;
      }
      return source.kind === "late-wild" && source.stage === r.stage &&
        Number.isFinite(source.earliestStageTime) && r.stageTime < Math.min(300,source.earliestStageTime+30);
    },
    async prepareUnlockMenuAction(plan, valid) {
      if (!this.menuOperationsAllowed()||!this.menuProfileScopeCurrent(true)) return true;
      const action = plan?.unlockAction, meta = this.app.meta,account=meta.account;
      if(action?.kind==="qualify-ranking")return this.prepareRankingMenu(plan,valid);
      if(!action&&plan?.goalProgress?.status!=="complete") {
        const target=this.getUnlockCatalog()?.targets?.find(row=>row.id===plan?.goalProgress?.targetId);
        if(target?.action?.kind==="qualify-ranking")return this.prepareRankingMenu({...plan,unlockAction:target.action,rankingRewardOnly:true},valid);
      }
      if(this.requiredGoalItem(plan)) {
        if(await this.prepareGoalItemPool(plan,valid)||this.app?.meta!==meta||meta.account!==account||!valid()||!this.menuProfileScopeCurrent(true))return true;
      }
      if(action?.kind==="pursue-counter"&&action.counter==="tasks"&&plan.taskClaimTarget)
        return this.prepareTaskGoalClaim(plan,valid);
      if (["claim-event-track","claim-event-quest"].includes(action?.kind))
        return this.prepareEventMenuClaim(plan,valid);
      if (!action || !["buy-lab","buy-item","claim-quest"].includes(action.kind)) return false;
      const permitted = action.kind === "claim-quest" ? this.settings.autoClaim === true : action.kind === "buy-item" ? this.settings.autoUnlockItems === true : this.settings.autoUpgrade === true;
      if (!permitted) {
        plan.goalProgress.message += action.kind === "claim-quest" ? "；自动领奖已关闭，等待玩家允许或手动领取" : "；自动研究/购买已关闭，保留目标并继续正常资源积累";
        return false;
      }
      if (!valid() || !this.menuProfileScopeCurrent(true) || meta.queued || meta.hasPending?.()) return true;
      const id = action.key, key = `unlock-${action.kind}-${id}`;
      if (this.unlockMenuCooldown?.key === key && performance.now() < this.unlockMenuCooldown.until) return false;
      let perform;
      if (action.kind === "buy-lab") {
        const def = this.bridge.lab?.find(entry => entry.id === id), level = meta.lab?.(id);
        const cost = typeof def?.cost === "function" ? def.cost(level) : def?.costs?.[level];
        if (!def || !Number.isFinite(level) || level >= def.max || !Number.isFinite(cost) || cost < 0 ||
            meta.profile.stardust < cost || typeof meta.buyLab !== "function") return false;
        perform = () => meta.buyLab(id);
      } else if (action.kind === "buy-item") {
        if (typeof meta.buyItem !== "function" || meta.profile.itemsOwned?.includes(id) ||
            !Number.isFinite(action.price) || action.price < 0 || meta.profile.stardust < action.price) return false;
        perform = () => meta.buyItem(id);
      } else {
        const quest = this.bridge.quests?.find(entry => entry.id === id);
        if (!quest || meta.profile.quests?.[id] || typeof meta.questProgress !== "function" ||
            meta.questProgress(quest) < quest.goal || typeof meta.claimQuest !== "function") return false;
        perform = () => meta.claimQuest(quest);
      }
      if (!this.safeAction(key,meta.account,action.kind === "claim-quest" ? "领取解锁目标奖励" : "购买解锁目标", "research")) return true;
      if (!valid() || !this.menuOperationsAllowed() || !this.menuProfileScopeCurrent(true)) return true;
      perform(); this.completeSafeAction(key,meta.account);
      await meta.queue;
      if (!valid() || !this.menuOperationsAllowed() || !this.menuProfileScopeCurrent(true)) return true;
      this.unlockMenuCooldown = {key,until:performance.now()+10000};
      if (!meta.queued && !meta.hasPending?.()) this.commitUnlockProfile(meta.profile,"native-menu-action-adopted");
      return true;
    },
    requiredGoalItem(plan) {
      if(plan?.goalProgress?.status!=="ready"||plan.goalMode==="autoManage"||this.autoManageSelected())return null;
      return ({"old-rod":"old-rod",bonk:"stick"})[plan.goalInteraction?.kind] || null;
    },
    currentRankingClanMembership() {
      const state=this.rankingClanState,app=this.app,meta=app?.meta,account=meta?.account;
      if(!state||state.app.deref()!==app||state.meta.deref()!==meta||state.account.deref()!==account){this.rankingClanState=null;return undefined;}
      return performance.now()-state.at<30000?state.member:undefined;
    },
    currentRankingClanCosmetics() {
      return this.currentRankingClanMembership()===true&&Array.isArray(this.rankingClanState.cosmetics)?this.rankingClanState.cosmetics:undefined;
    },
    currentRankingRewardChecks() {
      const state=this.rankingRewardCheckState,app=this.app,meta=app?.meta;
      if(!state||state.app.deref()!==app||state.meta.deref()!==meta||state.account.deref()!==meta?.account){this.rankingRewardCheckState=null;return [];}
      return state.rows;
    },
    rememberRankingRewardCheck(plan,scope) {
      const {app,meta,account,epoch}=scope,id=plan.goalProgress?.targetId;
      if(!plan.rankingRewardOnly||plan.goalSelection?.targetId!=="auto"||!this.enabled||this.app!==app||app.meta!==meta||meta.account!==account||
          (this.controlEpoch || 0)!==epoch||typeof id!=="string"||typeof WeakRef!=="function"||
          this.goalSelection(this.settings,plan)?.configurationKey!==plan.goalSelection.configurationKey)return false;
      this.currentRankingRewardChecks();let state=this.rankingRewardCheckState;
      if(!state)this.rankingRewardCheckState=state={app:new WeakRef(app),meta:new WeakRef(meta),account:new WeakRef(account),rows:[],order:0};
      const prior=state.rows.findIndex(row=>row.targetId===id);if(prior>=0)state.rows.splice(prior,1);
      state.rows.push({targetId:id,order:++state.order,at:performance.now()});
      if(state.rows.length>512)state.rows.splice(0,state.rows.length-512);
      this.unlockSelectionKey=null;return true;
    },
    currentRankingParticipation() {
      const state=this.rankingParticipationState,app=this.app,meta=app?.meta;
      if(!state||state.app.deref()!==app||state.meta.deref()!==meta||state.account.deref()!==meta?.account){this.rankingParticipationState=null;return [];}
      return state.rows;
    },
    rememberRankingParticipation(q,result,response,scope) {
      const {app,meta,account}=scope;
      if(this.app!==app||app?.meta!==meta||meta.account!==account||scope.cooperative||response?.ranked!==true||
          !q||scope.nativeMode!==q.mode||!account||typeof WeakRef!=="function")return false;
      let receipt,board=q.board || q.eventId;
      if(q.kind==="season") {
        if(/^e?mon:/.test(board || "")) {
          const mon=response.mon;
          if(!mon||mon.week==null||Number(mon.species)!==scope.species||!!mon.endless!==(q.mode==="endless"))return false;
          receipt={rank:mon.week,best:q.mode==="endless"?mon.time:mon.kills};
        } else if(q.timed) {
          if(result.victory!==true||result.end?.how!=="won"||!Number.isFinite(result.time))return false;
          receipt={rank:response.time?.week,best:result.time};
        } else {
          const ranked=q.mode==="endless"?response.endless:response.kills;
          if(!ranked||ranked.week==null||ranked.live===false)return false;
          receipt={rank:ranked.week,best:q.mode==="endless"?result.time:result.kills};
        }
      } else if(q.kind==="event"&&response.event?.id===q.eventId&&Number.isFinite(response.event.best))
        receipt={rank:response.event.rank,best:response.event.best};
      // A personal tower receipt does not prove a clan score was accepted.
      if(!receipt||typeof board!=="string")return false;
      return this.storeRankingParticipation(q,scope,receipt);
    },
    storeRankingParticipation(q,scope,receipt) {
      const {app,meta,account}=scope,board=q.board || q.eventId;
      if(this.app!==app||app?.meta!==meta||meta.account!==account||!account||typeof WeakRef!=="function"||typeof board!=="string")return false;
      const rows=this.currentRankingParticipation();let state=this.rankingParticipationState;
      if(!state)this.rankingParticipationState=state={app:new WeakRef(app),meta:new WeakRef(meta),account:new WeakRef(account),rows:[],order:0};
      const key=row=>row.kind===q.kind&&row.board===board&&row.biome===scope.biome&&row.tier===scope.tier,
        prior=rows.findIndex(key);
      if(prior>=0)state.rows.splice(prior,1);
      state.rows.push({kind:q.kind,board,biome:scope.biome,tier:scope.tier,order:++state.order,
        ...(Number.isFinite(receipt.rank)?{rank:receipt.rank}:{}),...(Number.isFinite(receipt.best)?{best:receipt.best}:{})});
      if(state.rows.length>1024)state.rows.splice(0,state.rows.length-1024);
      this.unlockSelectionKey=null;return true;
    },
    async prepareRankingMenu(plan,valid) {
      const q=plan.unlockAction?.qualification,app=this.app,meta=app?.meta,account=meta?.account,backend=app?.backend,
        epoch=this.controlEpoch || 0,selection=plan.goalSelection?.configurationKey;
      if(!q||this.autoManageSelected())return false;
      const current=()=>this.enabled&&this.app===app&&app.meta===meta&&meta.account===account&&app.backend===backend&&
        (this.controlEpoch || 0)===epoch&&valid()&&this.menuOperationsAllowed()&&
        (!app.run||app.run.state==="over"&&app.run.sent===true)&&
        (!selection||this.goalSelection(this.settings,plan)?.configurationKey===selection);
      if(!current())return true;
      if(account?.guest===true){this.status="原生排名只接受注册账号；保留目标等待玩家完成账号注册，不创建或切换账号";return true;}
      if(plan.rankingRewardOnly&&plan.goalSelection?.targetId==="auto") {
        const prior=this.currentRankingRewardChecks().find(row=>row.targetId===plan.goalProgress?.targetId);
        if(prior&&performance.now()-prior.at<30000){this.status="当前已核对的活动奖励等待原生更新；限频轮换精确目标，不重复请求或开启关闭的活动";return true;}
      }
      const observed=()=>{if(current())this.rememberRankingRewardCheck(plan,{app,meta,account,epoch});};
      const busy=this.rankingMenuBusy;
      if(busy?.app.deref()===app&&busy.meta.deref()===meta&&busy.account.deref()===account&&busy.epoch===epoch)return true;
      const token={app:new WeakRef(app),meta:new WeakRef(meta),account:new WeakRef(account),epoch};this.rankingMenuBusy=token;
      try {
        await meta.queue;if(!current()||!this.menuProfileScopeCurrent(true)||meta.queued||meta.hasPending?.())return true;
        if(q.eventId) {
          if(await this.prepareRankingMail(plan,current))return true;
        }
        if(q.kind==="clan-event") {
          const member=this.currentRankingClanMembership();
          if(member===true) {
            const state=this.rankingClanState;
            if(!Array.isArray(state.cosmetics)&&state.clanId!=null&&typeof backend.clan==="function"&&!(performance.now()<state.stockUntil)) {
              state.stockUntil=performance.now()+10000;
              const profile=meta.profile,nativeEpoch=meta.epoch,clan=await backend.clan(account,state.clanId);
              if(!current()||!this.menuProfileScopeCurrent()||meta.profile!==profile||meta.epoch!==nativeEpoch||this.rankingClanState!==state)return true;
              if(clan?.id===state.clanId&&Array.isArray(clan.cosmetics)){state.cosmetics=clan.cosmetics.filter(key=>typeof key==="string");this.unlockSelectionKey=null;observed();return true;}
            }
            if(typeof backend.eventView==="function"&&!(performance.now()<state.scoreUntil)) {
              state.scoreUntil=performance.now()+30000;
              const profile=meta.profile,nativeEpoch=meta.epoch,view=await backend.eventView(account,q.eventId);
              if(!current()||!this.menuProfileScopeCurrent()||meta.profile!==profile||meta.epoch!==nativeEpoch||this.rankingClanState!==state)return true;
              const saved=view?.clans?.me;
              if(saved?.id===state.clanId&&Number.isFinite(saved.floors)&&saved.floors>0&&Number.isFinite(saved.rank)&&saved.rank>0) {
                this.storeRankingParticipation(q,{app,meta,account,biome:plan.biome || "graveyard",tier:0},{rank:saved.rank,best:saved.floors});
                this.status="服务器已确认当前战队有真实活动榜成绩；自动规划轮换其它待取奖励，仍不把参赛成绩当已获装饰";observed();return true;
              }
            }
            if(this.publicEventState().find(row=>row.id===q.eventId)?.live!==true){this.status="原生活动已停止计分，已核对当前战队库存，等待真实发奖；不重开或加入关闭的计分活动";observed();return true;}
            return false;
          }
          if(member===false){
            if(this.publicEventState().find(row=>row.id===q.eventId)?.live!==true){this.status="原生活动当前未计分，保留目标，不为关闭的计分活动新加入战队";observed();return true;}
            return this.prepareRankingClanJoin(plan,current);
          }
          if(typeof backend?.clanStatus!=="function"){this.status="原生战队资格接口尚未识别，等待实际成员状态";observed();return true;}
          const probe=this.rankingClanProbe;
          if(probe?.app.deref()===app&&probe.meta.deref()===meta&&probe.account.deref()===account&&performance.now()<probe.until){
            this.status="等待原生战队资格查询回执/重查间隔，不制造成员资格";return true;
          }
          this.rankingClanProbe={app:new WeakRef(app),meta:new WeakRef(meta),account:new WeakRef(account),until:performance.now()+10000};
          const profile=meta.profile,nativeEpoch=meta.epoch,response=await backend.clanStatus(account);
          if(!current()||!this.menuProfileScopeCurrent()||meta.profile!==profile||meta.epoch!==nativeEpoch)return true;
          if(!response||!Object.hasOwn(response,"clan")){this.status="原生尚未返回可确认的战队资格";return true;}
          this.rankingClanState={app:new WeakRef(app),meta:new WeakRef(meta),account:new WeakRef(account),at:performance.now(),member:!!response.clan,
            pending:Array.isArray(response.pending)&&response.pending.length>0,
            ...(response.clan?{clanId:response.clan.id,...(Array.isArray(response.clan.cosmetics)?{cosmetics:response.clan.cosmetics.filter(key=>typeof key==="string")}: {})}: {})};
          this.unlockSelectionKey=null;
          this.status=response.clan?"已核实原生战队成员资格，下次正常参赛计分":"当前没有原生战队成员资格，继续核对真实公开加入/申请条件";
          if(!response.clan||Array.isArray(response.clan.cosmetics))observed();
          return true;
        }
        if(q.eventId&&this.publicEventState().find(row=>row.id===q.eventId)?.live!==true){
          this.status="原生活动当前未计分；已核对精确奖励邮箱，等待服务器发奖或再次开放，不提交关闭的活动对局";observed();return true;
        }
        if(q.kind!=="season"||typeof backend?.seasonAwards!=="function"||typeof backend.claimSeasonAwards!=="function"||typeof meta.adopt!=="function")return false;
        const cache=this.rankingAwardCheck,matching=cache?.app.deref()===app&&cache.meta.deref()===meta&&cache.account.deref()===account,
          key=plan.goalProgress?.targetId || plan.goalProgress?.requestedId || q.board;
        if(matching&&cache.key===key&&performance.now()<cache.until)return false;
        const profile=meta.profile,nativeEpoch=meta.epoch,fresh=()=>current()&&meta.profile===profile&&meta.epoch===nativeEpoch&&!meta.queued&&!meta.hasPending?.(),
          remember=extra=>{this.rankingAwardCheck={app:new WeakRef(app),meta:new WeakRef(meta),account:new WeakRef(account),key,until:performance.now()+30000,...extra};};
        if(matching&&cache.uncertain) {
          if(typeof backend.loadProfile!=="function"){this.status="上次赛季领奖回执尚未确认，等待原生资料同步；不重复提交";return true;}
          const saved=await backend.loadProfile(account);if(!fresh()||!this.profileLoadResponseCurrent(saved))return true;
          if(!saved||!Array.isArray(saved.league)||!Array.isArray(saved.cosmetics)||!saved.biomes){this.status="赛季领奖资料仍未确认，等待原生保存状态";remember({uncertain:true});return true;}
          meta.adopt(saved);this.confirmNativeProfileOrigin(meta.profile,app,meta,account);this.commitUnlockProfile(meta.profile,"native-ranking-receipt-resync");remember({uncertain:false});return true;
        }
        const awards=await backend.seasonAwards(account);if(!fresh()||!this.menuProfileScopeCurrent())return true;
        remember({uncertain:false});
        if(!Array.isArray(awards)||!awards.some(award=>rankingAwardMatches(q,award)))return false;
        const permitted=()=>this.settings.autoClaim===true;
        if(!permitted()){this.status="当前目标已有原生赛季奖励，但自动领奖已关闭；可手动领取，仍可正常参赛";return false;}
        const actionKey="unlock-ranking-award-"+key;
        if(!this.safeAction(actionKey,account,"当前目标已达标，按原生批量保存已获赛季奖励","reward"))return true;
        if(!fresh()||!this.menuProfileScopeCurrent()||!permitted())return true;
        let response;try{const request=backend.claimSeasonAwards(account);this.completeSafeAction(actionKey,account);response=await request;}catch(error){if(current())remember({uncertain:true});throw error;}
        if(!fresh()||!this.menuProfileScopeCurrent())return true;
        if(!response||!Array.isArray(response.league)||!Array.isArray(response.cosmetics)||!response.biomes){remember({uncertain:true});this.status="原生赛季领奖回执形状未确认，等待真实资料同步";return true;}
        meta.adopt(response);this.confirmNativeProfileOrigin(meta.profile,app,meta,account);this.commitUnlockProfile(meta.profile,"native-ranking-award-adopted");
        this.unlockSelectionKey=null;this.status="已采用原生批量赛季领奖保存回执；只有服务器实际授予的奖励计为完成";return true;
      } catch(error) {
        if(current()){this.status="原生排名资格/领奖暂未返回，保持目标与正常对局；"+String(error?.message || error);if(this.menuProfileScopeCurrent())observed();}
        return true;
      } finally {if(this.rankingMenuBusy===token)this.rankingMenuBusy=null;}
    },
    async prepareRankingClanJoin(plan,current) {
      const app=this.app,meta=app.meta,account=meta.account,backend=app.backend,state=this.rankingClanState;
      if(state?.pending){this.status="已有原生战队申请，等待真实接受；不重复申请、发聊天/邀请或改换成员关系";return true;}
      if(typeof backend.searchClans!=="function"||typeof backend.clan!=="function"||typeof backend.joinClan!=="function"){
        this.status="当前未取得战队资格，原生公开加入入口尚未识别；等待真实可加入战队";return true;
      }
      const prior=this.rankingClanJoinCheck,same=prior?.app.deref()===app&&prior.meta.deref()===meta&&prior.account.deref()===account,
        now=performance.now();
      if(same&&now<prior.until){this.status="等待原生公开战队加入结果/列表重查，不以个人成绩冒充战队计分";return true;}
      const check={app:new WeakRef(app),meta:new WeakRef(meta),account:new WeakRef(account),page:same?(prior.page+1)%1024:0,until:now+30000};
      this.rankingClanJoinCheck=check;
      const profile=meta.profile,epoch=meta.epoch,fresh=()=>current()&&this.menuProfileScopeCurrent()&&meta.profile===profile&&meta.epoch===epoch&&!meta.queued&&!meta.hasPending?.()&&
        this.publicEventState().find(row=>row.id===plan.unlockAction?.qualification?.eventId)?.live===true;
      const rows=await backend.searchClans(account,"",check.page);if(!fresh())return true;
      const candidate=Array.isArray(rows)?rows.find(row=>row.access==="open"&&["number","string"].includes(typeof row.id)&&
        Number.isFinite(row.members)&&row.members<(row.max ?? 30)):null;
      if(!candidate){this.status="本次原生公开列表没有可立即加入的开放战队，将限频核对其它列表；申请/邀请需真实外部接受，不伪造成员资格";return true;}
      const clan=await backend.clan(account,candidate.id);if(!fresh())return true;
      if(clan?.id!==candidate.id||clan.access!=="open"||!Array.isArray(clan.members)||!Number.isFinite(clan.max)||clan.members.length>=clan.max||clan.mine?.request||clan.mine?.invite){
        this.status="原生战队当前状态变化，暂不提交加入；继续核对真实可立即加入的开放战队";return true;
      }
      const key="unlock-ranking-open-clan";
      if(!this.safeAction(key,account,"为当前战队排名目标加入原生开放战队","research"))return true;
      if(!fresh())return true;
      const request=backend.joinClan(account,clan.id);this.completeSafeAction(key,account);
      const response=await request;if(!fresh())return true;
      // No request text, chat, invite, create, leave or fabricated membership.
      if(response?.joined===true&&response.clan?.id===clan.id){
        this.rankingClanState={app:new WeakRef(app),meta:new WeakRef(meta),account:new WeakRef(account),at:-Infinity,member:undefined};
        this.rankingClanProbe=null;
        this.unlockSelectionKey=null;this.status="原生已返回立即加入成功，下一步重新核实实际战队成员/库存后再计分";
      } else this.status="原生尚未确认立即加入；保留目标，等真实成员状态，不把申请/提交当成功";
      return true;
    },
    async prepareRankingMail(plan,current) {
      const app=this.app,meta=app.meta,account=meta.account,backend=app.backend,
        target=this.getUnlockCatalog()?.targets?.find(row=>row.id===plan.goalProgress?.targetId),keys=new Set(target?.reward?.cosmetics || []);
      const visit=condition=>{if(condition?.kind==="owned"&&condition.field==="cosmetics")keys.add(condition.value);
        for(const part of condition?.conditions || [])visit(part);};visit(target?.completion);
      if(!keys.size||typeof backend?.mail!=="function"||typeof backend.claimMail!=="function"||typeof meta.adopt!=="function")return false;
      const cache=this.rankingMailCheck,key=target.id,matching=cache?.app.deref()===app&&cache.meta.deref()===meta&&cache.account.deref()===account,
        remember=extra=>{this.rankingMailCheck={app:new WeakRef(app),meta:new WeakRef(meta),account:new WeakRef(account),key,until:performance.now()+30000,...extra};},
        profile=meta.profile,epoch=meta.epoch,fresh=()=>current()&&meta.profile===profile&&meta.epoch===epoch&&!meta.queued&&!meta.hasPending?.(),
        normalized=value=>value&&Array.isArray(value.league)&&Array.isArray(value.cosmetics)&&value.biomes;
      if(matching&&cache.key===key&&performance.now()<cache.until)return false;
      if(matching&&cache.uncertain) {
        if(typeof backend.loadProfile!=="function"){this.status="活动排名邮件领奖回执待核实，暂不重复提交";return true;}
        const response=await backend.loadProfile(account);
        if(!fresh()||!this.profileLoadResponseCurrent(response))return true;
        if(!normalized(response)){remember({uncertain:true});return true;}
        meta.adopt(response);this.confirmNativeProfileOrigin(meta.profile,app,meta,account);this.commitUnlockProfile(meta.profile,"native-ranking-mail-resync");remember({uncertain:false});return true;
      }
      const mails=await backend.mail(account);if(!fresh()||!this.menuProfileScopeCurrent())return true;
      remember({uncertain:false});
      const delivered=Array.isArray(mails)&&mails.some(row=>row.kind==="event"&&row.event?.event===plan.unlockAction?.qualification?.eventId&&
        Array.isArray(row.event?.place?.cosmetics)&&row.event.place.cosmetics.some(key=>keys.has(key)));
      if(delivered&&typeof backend.loadProfile==="function") {
        const response=await backend.loadProfile(account);
        if(!fresh()||!this.profileLoadResponseCurrent(response))return true;
        if(normalized(response)){meta.adopt(response);this.confirmNativeProfileOrigin(meta.profile,app,meta,account);this.commitUnlockProfile(meta.profile,"native-delivered-event-ranking-resync");}
        return true;
      }
      const mail=Array.isArray(mails)?mails.find(row=>row.kind==="admin"&&row.state==="open"&&["string","number"].includes(typeof row.id)&&
        Array.isArray(row.notice?.cosmetics)&&row.notice.cosmetics.some(key=>keys.has(key))):null;
      if(!mail)return false;
      const permitted=()=>this.settings.autoClaim===true;
      if(!permitted()){this.status="当前目标有已获得的原生赠礼，但自动领奖已关闭；可手动领取，不代为提交";return false;}
      const actionKey="unlock-ranking-mail-"+key;
      if(!this.safeAction(actionKey,account,"领取当前目标已获得的原生排名邮件奖励","reward"))return true;
      if(!fresh()||!this.menuProfileScopeCurrent()||!permitted())return true;
      let response;try{const request=backend.claimMail(account,mail.id);this.completeSafeAction(actionKey,account);response=await request;}catch(error){if(current())remember({uncertain:true});throw error;}
      if(!fresh()||!this.menuProfileScopeCurrent())return true;
      if(!normalized(response?.profile)){remember({uncertain:true});this.status="排名邮件原生保存回执尚未确认";return true;}
      meta.adopt(response.profile);this.confirmNativeProfileOrigin(meta.profile,app,meta,account);this.commitUnlockProfile(meta.profile,"native-ranking-mail-adopted");
      this.unlockSelectionKey=null;this.status="已采用当前目标原生排名邮件的真实领奖回执";return true;
    },
    async prepareGoalItemPool(plan,valid) {
      const key=this.requiredGoalItem(plan);if(!key)return false;
      const app=this.app,meta=app?.meta,account=meta?.account,epoch=this.controlEpoch || 0,
        selection=plan.goalSelection?.configurationKey,
        current=()=>this.enabled&&this.app===app&&app.meta===meta&&meta.account===account&&
          (this.controlEpoch || 0)===epoch&&valid()&&this.menuOperationsAllowed()&&this.menuProfileScopeCurrent()&&
          (!app.run||app.run.state==="over"&&app.run.sent===true)&&
          (!selection||this.goalSelection(this.settings,plan)?.configurationKey===selection);
      if(!current()||typeof meta.archiveItem!=="function"||!meta.profile.itemsOwned?.includes(key))return false;
      await meta.queue;
      if(!current()||meta.queued||meta.hasPending?.())return false;
      if(!meta.profile.itemsOff?.includes(key)) {
        const pending=this.goalItemPoolPending;
        if(pending?.app.deref()===app&&pending.meta.deref()===meta&&pending.account.deref()===account&&pending.key===key) {
          this.commitUnlockProfile(meta.profile,"native-goal-item-enabled");this.goalItemPoolPending=null;
        }
        return false;
      }
      const actionKey="unlock-enable-item-"+key;
      if(!this.safeAction(actionKey,account,"为当前解锁目标启用道具："+key,"research"))return true;
      if(!current())return false;
      const changed=meta.archiveItem(key,false);
      this.completeSafeAction(actionKey,account);
      if(changed&&typeof WeakRef==="function")this.goalItemPoolPending={key,app:new WeakRef(app),meta:new WeakRef(meta),account:new WeakRef(account)};
      this.status="为当前目标通过原生解除单件道具归档："+key+"；等待真实保存确认，其他归档保持";
      await meta.queue;
      if(current()&&!meta.queued&&!meta.hasPending?.()&&!meta.profile.itemsOff?.includes(key)) {
        this.commitUnlockProfile(meta.profile,"native-goal-item-enabled");this.goalItemPoolPending=null;
      }
      return true;
    },
    async prepareTaskGoalClaim(plan,valid) {
      const app=this.app,meta=app?.meta,account=meta?.account,epoch=this.controlEpoch || 0,
        target=plan.taskClaimTarget,selection=plan.goalSelection?.configurationKey,
        permitted=()=>this.settings.autoClaim===true,
        current=()=>this.enabled&&this.app===app&&app.meta===meta&&meta.account===account&&
          (this.controlEpoch || 0)===epoch&&valid()&&permitted()&&this.menuOperationsAllowed()&&this.menuProfileScopeCurrent()&&
          (!app.run||app.run.state==="over"&&app.run.sent===true)&&
          (!selection||this.goalSelection(this.settings,plan)?.configurationKey===selection);
      if(!target||!current()||typeof meta.claimTask!=="function"||typeof meta.task!=="function")return false;
      await meta.queue;
      if(!current()||meta.queued||meta.hasPending?.())return false;
      const state=meta.profile[target.period],task=state&&meta.task(target.period,target.index);
      if(!state||state.idx!==target.periodIndex||state.ids?.[target.index]!==target.id||!task||task.id!==target.id||
          state.claimed?.[target.index]||!(state.prog?.[target.index]>=task.goal))return false;
      const key=`unlock-task-${target.period}-${target.periodIndex}-${target.index}-${target.id}`;
      if(!this.safeAction(key,account,"领取当前解锁前置委托","reward"))return true;
      if(!current())return false;
      meta.claimTask(target.period,target.index);this.completeSafeAction(key,account);
      await meta.queue;
      if(current()&&!meta.queued&&!meta.hasPending?.())this.commitUnlockProfile(meta.profile,"native-task-goal-claim");
      return true;
    },
    publicEventState() {
      try {
        const entries = this.app?.backend?.events?.();
        return Array.isArray(entries) ? entries.filter(event=>typeof event?.id === "string").slice(0,64)
          .map(event=>({id:event.id,mode:typeof event.mode === "string" ? event.mode : null,
            biome:typeof event.biome === "string" && event.biome ? event.biome : null,
            live:typeof event.live === "boolean" ? event.live : null,
            claimable:typeof event.claimable === "boolean" ? event.claimable : null,
            ...(["expired","upcoming"].includes(event.eventStatus || event.status)
              ? {eventStatus:event.eventStatus || event.status} : {})})) : [];
      } catch { return []; }
    },
    async prepareEventMenuClaim(plan, valid) {
      const action = plan.unlockAction, app = this.app, meta = app?.meta, backend = app?.backend,
        account = meta?.account, epoch = this.controlEpoch || 0, nativeEpoch = meta?.epoch,
        priorProfile = meta?.profile, selectionKey = plan.goalSelection?.configurationKey,
        current = () => this.enabled && valid() && this.app === app && app.meta === meta &&
          app.backend === backend && meta.account === account && !!account && (this.controlEpoch || 0) === epoch &&
          (!selectionKey || this.goalSelection(this.settings,plan)?.configurationKey === selectionKey) &&
          meta.epoch === nativeEpoch && meta.profile === priorProfile &&
          (!app.run || app.run.state === "over" && app.run.sent === true) &&
          !this.savePending && !app.run?.ui?.savingEl && !this.nativeSavedNotice?.root?.isConnected &&
          performance.now() >= (this.savedNoticeWaitUntil || 0) && !meta.queued && !meta.hasPending?.() &&
          this.menuOperationsAllowed();
      if (this.settings.autoClaim !== true || !current() || !this.menuProfileScopeCurrent(true)) return false;
      if (this.eventClaimAccount !== account) {
        this.eventClaimAccount=account;this.eventClaimCooldown=new Map();this.eventClaimUncertain=new Set();
      }
      const track = action.kind === "claim-event-track", eventId = action.eventId,
        index = track ? action.step : action.questId,
        method = track ? "claimEventTrack" : "claimEventQuest",
        event = this.publicEventState().find(entry=>entry.id === eventId),
        target = this.getUnlockCatalog()?.targets.find(entry=>entry.category === "events" &&
          entry.action?.eventId === eventId && (track ? entry.action.track === index : entry.action.quest === index)),
        progress = target?.action?.earning?.progress || target?.requirements?.find(condition=>
          condition.kind === (track ? "event-points" : "event-counter")),
        saved = priorProfile.events?.[eventId],
        amount = track ? saved?.pts : saved?.c?.[progress?.counter];
      if (!target || event?.claimable !== true || typeof backend?.[method] !== "function" ||
          typeof meta.adopt !== "function" || !Number.isFinite(progress?.goal) || progress.goal < 0 ||
          !Number.isFinite(amount) || amount < progress.goal ||
          (track ? !Number.isInteger(index) || index < 0 || saved?.got?.includes(index)
            : typeof index !== "string" || !index || saved?.quests?.includes(index))) return false;
      const key = `event-claim-${eventId}-${track ? "track" : "quest"}-${index}`;
      const logId = () => `${key}-${Date.now()}-${this.eventClaimLogSequence=(this.eventClaimLogSequence||0)+1}`,
        publicLabel = `活动领奖：${target.name || eventId}（${eventId} / ${track ? "第"+(index+1)+"档" : "任务 "+index}）`;
      this.eventClaimCooldown ||= new Map();
      this.eventClaimUncertain ||= new Set();
      const uncertain = () => { if (this.eventClaimAccount === account) this.eventClaimUncertain.add(key); };
      for (const [entry,until] of this.eventClaimCooldown) if (until <= performance.now()) this.eventClaimCooldown.delete(entry);
      if (this.eventClaimBusy || this.eventClaimCooldown.has(key)) {
        this.status=this.eventClaimBusy ? "等待原生活动领奖资料返回" : "活动领奖暂缓重试，稍后核对原生回执";
        return true;
      }
      const normalized = response => {
        const receipt = response?.events?.[eventId];
        return !!response && typeof response === "object" && Array.isArray(response.league) &&
          Array.isArray(response.seen) && response.biomes && typeof response.biomes === "object" &&
          !!receipt && Array.isArray(receipt.got) && Array.isArray(receipt.quests);
      };
      if (this.eventClaimUncertain.has(key)) {
        // A lost response may already have granted the reward. Read the normal
        // native profile before any retry; never infer failure and double-send.
        if (typeof backend.loadProfile !== "function") {
          this.status="活动领奖回执未确认，等待原生资料同步后再重试";return true;
        }
        if (!this.safeAction(key+"-resync",account,"核对上次活动领奖回执","research")) return true;
        if (!current() || !this.menuProfileScopeCurrent()) return true;
        this.eventClaimBusy=true;this.eventClaimCooldown.set(key,performance.now()+10000);
        try {
          const request=backend.loadProfile(account);this.completeSafeAction(key+"-resync",account);
          const response=await request;
          if (!current() || !this.profileLoadResponseCurrent(response) || !normalized(response)) return true;
          meta.adopt(response);
          this.confirmNativeProfileOrigin(meta.profile,app,meta,account);
          if (this.app === app && app.meta === meta && meta.account === account &&
              (this.controlEpoch || 0) === epoch && this.menuOperationsAllowed()) {
            this.commitUnlockProfile(meta.profile,"native-event-resync");
            this.eventClaimUncertain.delete(key);
          }
        } catch (error) { this.observeMenuFailure(error,app,account,backend); /* Keep receipt uncertainty. */ }
        finally { this.eventClaimBusy=false; }
        return true;
      }
      if (!this.safeAction(key,account,"领取原生活动奖励","research")) return true;
      if (this.settings.autoClaim !== true || !current() || !this.menuProfileScopeCurrent() || this.publicEventState().find(entry=>entry.id === eventId)?.claimable !== true) return true;
      this.eventClaimBusy = true;
      this.eventClaimCooldown.set(key,performance.now()+10000);
      try {
        // Same native method and adoption path as the game's Event UI. Never
        // construct a request, read credentials or adopt a stale identity reply.
        const request = backend[method](account,eventId,index);
        this.completeSafeAction(key,account);
        const response = await request;
        if (!current() || !this.menuProfileScopeCurrent()) { uncertain();return true; }
        if (!normalized(response)) { uncertain();return true; }
        meta.adopt(response);
        this.confirmNativeProfileOrigin(meta.profile,app,meta,account);
        if (this.app !== app || app.meta !== meta || meta.account !== account ||
            (this.controlEpoch || 0) !== epoch || !this.menuOperationsAllowed()) return true;
        this.commitUnlockProfile(meta.profile,"native-event-claim");
        const confirmed = track ? meta.profile.events?.[eventId]?.got?.includes(index)
          : meta.profile.events?.[eventId]?.quests?.includes(index);
        this.recordEvent({id:logId(),kind:"choice",type:"eventClaim",at:Date.now(),confirmed:confirmed === true,
          eventId,targetId:target.id,step:track ? index : null,questId:track ? null : index,
          message:publicLabel+"；"+(confirmed ? "原生回执已采用，重新核对目标" : "原生已返回资料，尚未确认该奖励领取")});
      } catch (error) {
        this.observeMenuFailure(error,app,account,backend);
        uncertain();
        if (current()) this.recordEvent({id:logId(),kind:"choice",type:"eventClaim",at:Date.now(),confirmed:false,
          eventId,targetId:target.id,step:track ? index : null,questId:track ? null : index,
          message:publicLabel+"；尚未完成，保留目标并稍后核对"});
      } finally { this.eventClaimBusy = false; }
      return true;
    },
    observeProfileLoads() {
      const meta=this.app?.meta,backend=meta?.backend,self=this;
      if(typeof backend?.loadProfile!=="function")return;
      if(backend.loadProfile.__pbProfileObservation) {
        if(backend.loadProfile.__pbProfileObserved)this.profileScopeObserved=true;
        if(backend.loadProfile.__pbProfileState)this.verifiedProfileObservation=backend.loadProfile.__pbProfileState;
        if(!backend.loadProfile.__pbProfileReadRevisionObserved) {
          const observed=backend.loadProfile;
          const upgraded=function(account,...args) {
            const app=self.app,meta=app?.meta,priorState=self.verifiedProfileObservation,priorProof=priorState?.profile,
              current=()=>self.app===app&&app?.meta===meta&&meta?.backend===this&&meta.account===account,
              completed=profile=>{if(current()&&profile&&typeof profile==="object")self.profileReadRevision=(self.profileReadRevision || 0)+1;},
              failed=()=>{if(current()&&self.verifiedProfileObservation===priorState&&priorState?.profile===priorProof)priorState.profile=null;};
            let result;
            try {result=observed.call(this,account,...args);}catch(error){failed();throw error;}
            if(result&&typeof result.then==="function")result.then(completed,failed);
            else completed(result);
            return result;
          };
          upgraded.__pbProfileObservation=true;upgraded.__pbProfileReadRevisionObserved=true;
          for(const key of ["__pbProfileObserved","__pbProfileState"])
            Object.defineProperty(upgraded,key,{get:()=>observed[key],set:value=>{observed[key]=value;}});
          backend.loadProfile=upgraded;
        }
        return;
      }
      const native=backend.loadProfile;
      const wrapped=function(account,...args) {
        const app=self.app,currentMeta=app?.meta,
          current=()=>self.app===app&&app?.meta===currentMeta&&currentMeta?.backend===this&&currentMeta.account===account;
        let observation=null,priorProof=null;
        if(current()&&account&&typeof account==="object"&&typeof WeakRef==="function") {
          self.profileScopeObserved=true;wrapped.__pbProfileObserved=true;
          observation=self.verifiedProfileObservation;
          if(!observation||observation.app.deref()!==app||observation.meta.deref()!==currentMeta||observation.account.deref()!==account)
            self.verifiedProfileObservation=observation={app:new WeakRef(app),meta:new WeakRef(currentMeta),account:new WeakRef(account),profile:null,pending:0};
          priorProof=observation.profile;observation.pending++;
          wrapped.__pbProfileState=observation;
        }
        const completed=profile=>{
          if(!observation)return;
          observation.pending--;
          if(current()&&self.verifiedProfileObservation===observation) {
            if(profile&&typeof profile==="object") {
              observation.profile=new WeakRef(profile);
              self.profileReadRevision=(self.profileReadRevision || 0)+1;
            } else if(observation.profile===priorProof)observation.profile=null;
          }
        };
        let result;
        try { result=native.call(this,account,...args); }
        catch(error){completed(null);throw error;}
        // Return the original native result/promise and preserve its rejection.
        // This side observer never adopts, edits or serializes the response.
        if(result&&typeof result.then==="function")result.then(completed,()=>completed(null));
        else completed(result);
        return result;
      };
      wrapped.__pbProfileObservation=true;wrapped.__pbProfileReadRevisionObserved=true;backend.loadProfile=wrapped;
    },
    savedProfileRecoveryCurrent(state) {
      const app=state?.app.deref(),meta=state?.meta.deref(),account=state?.account.deref(),
        run=state?.hadRun?state.run?.deref():state?.emptyRun;
      return !!state&&!!app&&!!meta&&!!account&&(!state.hadRun||!!run)&&this.savedProfileRecovery===state&&this.app===app&&app?.meta===meta&&
        meta?.account===account&&app.starting!==true&&app.run===run&&(!run||run.state==="over")&&
        (this.controlEpoch || 0)===state.epoch&&meta.epoch===state.nativeEpoch&&
        this.runStartedAt===state.runAt;
    },
    completeSavedProfileRecovery(state) {
      if(!this.savedProfileRecoveryCurrent(state))return false;
      const meta=this.app.meta;
      // A resolve from native resync is not proof: it deliberately catches a
      // failed load. Require an actual successful backend read after pb-saved.
      if(this.savePending||meta.queued||meta.hasPending?.()) {
        state.waitedNativePending=true;state.readRevision=this.profileReadRevision || 0;return false;
      }
      if(state.waitedNativePending) {
        // A successful read before the last pending result was drained may be
        // incomplete. Advance the baseline once and require one post-drain read.
        state.waitedNativePending=false;state.readRevision=this.profileReadRevision || 0;
        state.retryAt=performance.now();return false;
      }
      if((this.profileReadRevision || 0)<=state.readRevision||
          !this.profileLoadResponseCurrent(meta.profile)||!this.commitUnlockProfile(meta.profile,"native-resync"))return false;
      const profile=this.savedRewardsSnapshot();if(!profile)return false;
      if(state.shinyFinishReason&&this.shinyFinishReason===state.shinyFinishReason)this.shinyFinishSaved=true;
      const retry=this.settlementRetryScope,
        retrySaved=this.settlementRetryScopeCurrent(retry)&&retry.requestSaved===true&&
          retry.runAt===state.runAt&&(this.profileReadRevision||0)>retry.readRevision;
      if(retrySaved){
        const finite=this.finiteSettlementScope;
        if(finite?.settlementId===retry.ticketId)this.recordFiniteSettlementReceipt(retry.run.deref(),true,finite);
      }
      this.savedProfileRecovery=null;
      this.recordEvent({id:state.id,kind:"resynced",at:Date.now(),profile,
        ...(retrySaved?{runAt:state.runAt,saved:true}:{}),
        profileVerified:true,profileSource:"native-profile-load",profileReadRevision:this.profileReadRevision});
      if(retrySaved&&this.settlementRetryScope===retry){this.settlementRetryScope=null;this.observeSettlementRetries();}
      return true;
    },
    async reviewSavedProfileRecovery() {
      const state=this.savedProfileRecovery;
      if(!state)return false;
      if(!this.savedProfileRecoveryCurrent(state)) { if(this.savedProfileRecovery===state)this.savedProfileRecovery=null;return false; }
      if(this.completeSavedProfileRecovery(state))return true;
      const meta=this.app.meta;
      if(state.pending||performance.now()<state.retryAt||meta.queued||this.savePending||state.readStarted&&meta.hasPending?.()||typeof meta.resync!=="function")return false;
      state.pending=true;state.readStarted=true;
      try { await meta.resync(); }
      catch { /* Native implementations may reject or swallow; neither proves a read. */ }
      finally { state.pending=false; }
      if(!this.savedProfileRecoveryCurrent(state)) { if(this.savedProfileRecovery===state)this.savedProfileRecovery=null;return false; }
      if(this.completeSavedProfileRecovery(state))return true;
      const waits=[5000,10000,20000,30000];
      state.retryAt=performance.now()+waits[state.retryStep];state.retryStep=Math.min(3,state.retryStep+1);
      this.status="补存回执已收到，账号资料尚未核验；保留当前页面并稍后重读";
      return false;
    },
    beginSavedProfileRecovery() {
      const app=this.app,meta=app?.meta,account=meta?.account,run=app?.run;
      if(!app||!meta||!account||typeof account!=="object"||app.starting===true||run&&run.state!=="over"||typeof WeakRef!=="function")return;
      this.observeProfileLoads();
      if(!run)this.savedNoticeWaitUntil=performance.now()+1800;
      // Multiple native receipts can arrive together. Reuse this scope's one
      // pending read/backoff instead of creating one helper request per event.
      if(this.savedProfileRecoveryCurrent(this.savedProfileRecovery))return this.reviewSavedProfileRecovery();
      const state={app:new WeakRef(app),meta:new WeakRef(meta),account:new WeakRef(account),hadRun:!!run,
        run:run?new WeakRef(run):null,emptyRun:run?null:run,runAt:this.runStartedAt,epoch:this.controlEpoch || 0,nativeEpoch:meta.epoch,
        shinyFinishReason:this.shinyFinishReason,readRevision:this.profileReadRevision || 0,
        pending:false,retryAt:performance.now(),retryStep:0,
        id:`resync-${Date.now()}-${this.savedProfileRecoverySequence=((this.savedProfileRecoverySequence || 0)+1)%1000000}`};
      this.savedProfileRecovery=state;
      // The independent visible savedCard acknowledgement still gates macro.
      return this.reviewSavedProfileRecovery();
    },
    menuProfileScopeCurrent(resync=false) {
      this.observeProfileLoads();
      // A late attachment has missed signedIn/load. A real native backend can
      // prove it through one safe menu resync; absence of observed history is
      // not proof that the mutable profile belongs to the current account.
      if(!this.profileScopeObserved&&!(typeof this.app?.meta?.backend?.loadProfile==="function"&&typeof this.app.meta.resync==="function"))return true;
      if(this.isVerifiedClearProfileCurrent())return true;
      if(resync)this.ensureVerifiedClearProfile();
      const verification=this.profileVerificationSnapshot();
      this.status=verification.message+"；"+verification.nextStep;
      return false;
    },
    profileLoadResponseCurrent(profile) {
      this.observeProfileLoads();if(!this.profileScopeObserved)return true;
      const state=this.verifiedProfileObservation,app=this.app,meta=app?.meta;
      return !!state&&state.app.deref()===app&&state.meta.deref()===meta&&state.account.deref()===meta?.account&&
        state.pending===0&&state.profile?.deref()===profile;
    },
    confirmNativeProfileOrigin(profile,app,meta,account) {
      if(this.app!==app||app?.meta!==meta||meta.account!==account||meta.profile!==profile||
          !profile||typeof profile!=="object"||typeof WeakRef!=="function")return false;
      const old=this.verifiedProfileObservation;
      if(old?.app.deref()===app&&old.meta.deref()===meta&&old.account.deref()===account&&old.pending>0)return false;
      const state={app:new WeakRef(app),meta:new WeakRef(meta),account:new WeakRef(account),profile:new WeakRef(profile),pending:0};
      this.verifiedProfileObservation=state;this.profileScopeObserved=true;
      if(meta.backend?.loadProfile?.__pbProfileObservation){meta.backend.loadProfile.__pbProfileState=state;meta.backend.loadProfile.__pbProfileObserved=true;}
      return true;
    },
    isVerifiedClearProfileCurrent() {
      this.observeProfileLoads();
      const app=this.app,meta=app?.meta,account=meta?.account,state=this.verifiedProfileObservation;
      if(!state)return false;
      if(state.app.deref()!==app||state.meta.deref()!==meta||state.account.deref()!==account){
        this.verifiedProfileObservation=null;return false;
      }
      return state.pending===0&&!!meta?.profile&&state.profile?.deref()===meta.profile;
    },
    ensureVerifiedClearProfile() {
      if(this.isVerifiedClearProfileCurrent())return true;
      const app=this.app,meta=app?.meta,account=meta?.account,run=app?.run;
      // Never resync an active or still displayed run. Native save owns its
      // optimistic profile; the next menu can verify history independently.
      if(!account||typeof account!=="object"||typeof WeakRef!=="function"||run||app.starting===true||this.savePending||meta.queued||meta.hasPending?.()||
          this.verifiedProfileObservation?.pending>0||typeof meta.resync!=="function")return false;
      const prior=this.verifiedProfileRequest,now=performance.now();
      const same=prior&&prior.app.deref()===app&&prior.meta.deref()===meta&&prior.account.deref()===account;
      if(same&&(prior.pending||now-prior.at<5000))return false;
      const request={app:new WeakRef(app),meta:new WeakRef(meta),account:new WeakRef(account),at:now,pending:true};
      this.verifiedProfileRequest=request;
      try {
        const result=meta.resync();
        Promise.resolve(result).then(()=>{
          request.pending=false;
          if(this.verifiedProfileRequest===request&&this.isVerifiedClearProfileCurrent())this.unlockSelectionKey=null;
        },()=>{request.pending=false;});
      } catch {request.pending=false;}
      return false;
    },
    savedUnlockProfileCurrent() {
      const scope=this.unlockCommittedScope,app=this.app,meta=app?.meta;
      return scope?.app.deref()===app&&scope.meta.deref()===meta&&scope.account.deref()===meta?.account
        ? this.unlockCommittedProfile || null : null;
    },
    profileVerificationSnapshot() {
      const app=this.app,meta=app?.meta,account=meta?.account,run=app?.run,
        current=this.isVerifiedClearProfileCurrent(),saved=!!this.savedUnlockProfileCurrent(),
        state=this.verifiedProfileObservation,request=this.verifiedProfileRequest,
        sameRequest=request?.app.deref()===app&&request.meta.deref()===meta&&request.account.deref()===account;
      const result={currentProfileConfirmed:current,usingSavedSnapshot:!current&&saved,
        lastConfirmedAt:saved?this.unlockProfileConfirmedAt || null:null};
      const status=(code,message,nextStep)=>({...result,code,message,nextStep});
      if(!app||!meta)return status("bridge-wait","尚未连接原生存档接口","游戏加载完成后自动连接并核验存档");
      if(!account)return status("account-wait","原生账号尚未就绪","等待当前登录完成后自动核验，不切换账号");
      if(app.starting===true&&!current)return status("native-starting","原生正在开局并准备本局存档，尚未进入安全同步窗口","等待原生开局完成；保留本局，正常结束返回菜单后自动核验");
      if(sameRequest&&request.pending)return status("native-sync","正在通过原生同步核验当前账号存档","同步返回后自动更新目标与具体解锁条件");
      if(state?.pending>0)return status("native-loading","原生正在读取当前账号的存档，返回前不采用页面上残留的资料","读取结束后自动核对账号归属与保存进度");
      if(current)return status("current","已核验当前账号的原生存档","按真实已保存进度继续当前目标");
      if(this.savePending||meta.queued||meta.hasPending?.())return status("native-saving","原生仍在保存或处理存档队列","保存完成并返回安全菜单后自动同步，不打断当前对局");
      if(run)return status(run.state==="over"?"summary-wait":saved?"saved-active":"active-wait",
        saved?"采用上次已确认的存档进度；当前页面的新资料尚未核验":run.state==="over"?"结算页仍持有本局存档，尚未确认最新保存资料":"当前对局尚无可确认的已保存进度，本局临时计数不作解锁回执",
        "保留当前对局；正常结束并返回菜单后自动原生同步");
      if(typeof WeakRef!=="function"||typeof meta.resync!=="function")return status("interface-unavailable","当前原生存档核验接口暂不可用","保留目标并等待游戏接口恢复，不采用未知资料执行菜单操作");
      const retryInMs=sameRequest?Math.max(0,Math.ceil(5000-(performance.now()-request.at))):0;
      return {...status("sync-wait","当前资料对象尚无对应的原生读取回执",retryInMs?`将在 ${Math.ceil(retryInMs/1000)} 秒内自动重试原生同步` : "处于安全菜单，将自动发起原生同步并核验保存进度"),retryInMs};
    },
    commitUnlockProfile(profile, source = "native-menu") {
      if (!profile || !this.app?.meta) return false;
      if(typeof WeakRef!=="function"||!this.app.meta.account||typeof this.app.meta.account!=="object")return false;
      if(!this.menuProfileScopeCurrent())return false;
      // Deliberately exclude identity, credentials, settings and session fields.
      const projected = {};
      for (const key of ["league", "seen", "shinies", "classics", "biomes", "stardust", "lab", "played", "research",
        "quests", "counters", "itemsOwned", "itemsOff", "forms", "cosmetics", "bonk", "totalBonk", "totalStardust", "unlocked", "medals", "events", "daily", "weekly", "mutation"])
        if (profile[key] !== undefined) projected[key] = JSON.parse(JSON.stringify(profile[key]));
      // Only the selected push source needs this additional narrow projection.
      // It follows an already verified normal commit, never triggers a fetch.
      try{this.wecomPushObserver?.captureVerifiedBag(this,profile);}catch{ /* Optional projection cannot change a verified native result. */ }
      const fingerprint = JSON.stringify(projected), account = this.app.meta.account;
      if (!this.savedUnlockProfileCurrent() || this.unlockProfileAccount !== account || this.unlockProfileFingerprint !== fingerprint) {
        this.unlockProfileAccount = account; this.unlockProfileFingerprint = fingerprint;
        this.unlockCommittedProfile = projected; this.unlockProfileRevision = (this.unlockProfileRevision || 0) + 1;
        this.unlockCommittedScope={app:new WeakRef(this.app),meta:new WeakRef(this.app.meta),account:new WeakRef(account)};
        this.unlockProfileConfirmedAt = Date.now(); this.unlockProfileSource = source;
        this.unlockSelectionKey = null;
      }
      return true;
    },
    refreshUnlockProfile() {
      const app = this.app, meta = app?.meta;
      if (!meta?.profile) return null;
      if (!this.savedUnlockProfileCurrent()) {
        this.unlockProgress = null; this.unlockOverviewPlan = null; this.unlockSelectionKey = null;
      }
      // An observed native load may have switched account before awaiting its
      // profile. Do not attach the preceding account's profile to that scope.
      if(!this.menuProfileScopeCurrent(!app.run))return app.run ? this.savedUnlockProfileCurrent() : null;
      const active = app.run && app.run.state !== "over";
      if (!active && !this.savePending && !meta.queued && !meta.hasPending?.())
        this.commitUnlockProfile(meta.profile, "native-menu");
      else if (!this.savedUnlockProfileCurrent() && meta.snap && !this.savePending &&
          (this.run !== app.run || this.unlockRunAccount === meta.account))
        this.commitUnlockProfile(meta.snap, "native-run-start-snapshot");
      return this.savedUnlockProfileCurrent();
    },
    getUnlockCatalog() {
      if (typeof buildUnlockCatalog !== "function" || !this.bridge) return null;
      const events = this.publicEventState(),
        key = JSON.stringify([this.bridge.compatibility?.sourceHash || this.compatibility?.sourceHash || "current",this.bridge.compatibilityConfig?.revision||0,events]);
      if (this.unlockCatalogBridge !== this.bridge || this.unlockCatalogKey !== key) {
        this.unlockCatalogBridge = this.bridge; this.unlockCatalogKey = key;
        this.unlockCatalog = buildUnlockCatalog(this.bridge, config.unlockCatalog || {},{events});
      }
      return this.unlockCatalog;
    },
    setVerifiedClears(rows) {
      const app=this.app,meta=app?.meta,account=meta?.account;
      if(!app||!meta||!account)return false;
      const maps=new Set((this.bridge?.biomes || []).map(map=>map.id)),seen=new Set(),values=[];
      for(const row of Array.isArray(rows)?rows.slice(0,10000):[]) {
        if(!Number.isInteger(row?.species)||row.species<=0||!Number.isInteger(row?.tier)||row.tier<0||row.tier>2||
          typeof row.biome!=="string"||!maps.has(row.biome))continue;
        const key=`${row.species}:${row.biome}:${row.tier}`;if(seen.has(key))continue;seen.add(key);
        values.push({species:row.species,biome:row.biome,tier:row.tier});
      }
      this.verifiedClearsScope=values.length?{app,meta,account}:null;this.verifiedClears=values;
      this.verifiedClearsRevision=(this.verifiedClearsRevision || 0)+1;this.unlockSelectionKey=null;return true;
    },
    rememberVerifiedClearReceipt(result,scope) {
      if(result?.mode!=="standard"||result.victory!==true||result.end?.how!=="won"||
        !Number.isInteger(result.species)||!Number.isInteger(result.tier)||result.tier<0||result.tier>2||
        typeof result.biome!=="string"||typeof WeakRef!=="function"||!scope?.app||!scope.meta||!scope.account)return;
      this.verifiedClearReceipts ||= [];
      this.verifiedClearReceipts.push({tuple:{species:result.species,biome:result.biome,tier:result.tier},
        app:new WeakRef(scope.app),meta:new WeakRef(scope.meta),account:new WeakRef(scope.account)});
      if(this.verifiedClearReceipts.length>64)this.verifiedClearReceipts.splice(0,this.verifiedClearReceipts.length-64);
    },
    readVerifiedClearReceipts() {
      const app=this.app,meta=app?.meta,account=meta?.account;
      this.verifiedClearReceipts=(this.verifiedClearReceipts || []).filter(row=>row.app.deref()&&row.meta.deref()&&row.account.deref());
      return this.verifiedClearReceipts.filter(row=>row.app.deref()===app&&row.meta.deref()===meta&&row.account.deref()===account)
        .map(row=>({...row.tuple}));
    },
    currentVerifiedClears() {
      const scope=this.verifiedClearsScope;
      if(!scope||scope.app!==this.app||scope.meta!==this.app?.meta||scope.account!==this.app?.meta?.account){
        this.verifiedClearsScope=null;this.verifiedClears=[];return [];
      }
      return this.verifiedClears || [];
    },
    goalSelection(settings = this.settings, base = {}) {
      if (typeof normalizeUnlockTargets !== "function") return null;
      const targets = normalizeUnlockTargets(settings.unlockTargets || {}, settings), mode = this.selectedGoalMode(settings),
        activity = this.activityModeDefinition(settings,mode);
      if(["wardrobe","allClears"].includes(mode))return {mode,category:"all",targetId:"auto",targets,
        configurationKey:JSON.stringify([mode,settings.modeSettings?.[mode],this.verifiedClearsRevision || 0])};
      let category = ({map:"maps",maps:"maps",dex:"dex",characters:"characters",research:"research",shiny:"shiny",
        lab:"lab",items:"items",achievements:"achievements",appearance:"appearance",events:"events"})[mode];
      if (activity) category="events";
      if (mode === "auto") {
        const explicit = ["dex", "characters", "research", "shiny"].find(key => targets[key] !== "auto");
        category = explicit || (base.priority === "开新图" ? "maps" : base.priority === "做委托" ? null : "all");
      }
      if (!category) return null;
      const savedEventTargets = settings.eventTargets && typeof settings.eventTargets === "object" && !Array.isArray(settings.eventTargets)
        ? settings.eventTargets : {}, hasEventTarget = activity && Object.prototype.hasOwnProperty.call(savedEventTargets,activity.eventId),
        candidate = activity ? hasEventTarget ? savedEventTargets[activity.eventId] : targets.events : null,
        eventTarget = activity && typeof candidate === "string" && candidate.startsWith("events:"+activity.eventId+":")
          ? candidate : "auto";
      return { category, targetId: activity ? eventTarget : targets[category] || "auto", targets, mode,
        ...(activity ? {eventId:activity.eventId} : {}),
        configurationKey:JSON.stringify([mode,settings.unlockCategory || "all",targets,activity?.eventId,eventTarget,
          this.modePlanningSettings(settings,mode).modePreference, settings.modeSettings?.tower,
          ...(mode==='appearance'?[normalizeAppearanceSettings(settings.modeSettings?.appearance)]:[])]) };
    },
    legacyCharacterUnlockApplies(settings=this.settings,base=null,selection=null) {
      return this.characterUnlockImplementation==='legacy160' &&
        (settings.mode==='characters'||selection?.category==='characters'||
          settings.mode==='auto'&&base?.priority==='开图鉴'&&(!selection||['all','characters'].includes(selection.category)));
    },
    legacyCharacterUnlockPlan(plan=this.plan) {
      return this.characterUnlockImplementation==='legacy160'&&plan?.legacyCharacterUnlock160===true;
    },
    legacyCharacterCachedPlan(plan) {
      return this.characterUnlockImplementation==='legacy160'&&!!plan&&
        (plan.goalMode==='characters'||plan.goalSelection?.category==='characters'||
          plan.goalMode==='auto'&&plan.goalSelection?.category==='all'&&
          (String(plan.goalProgress?.targetId||'').startsWith('characters:')||
            ['character-batch','character-focus','character-route'].includes(plan.unlockExecution?.kind)));
    },
    characterCounterObjective(meta,bridge,settings,plan=this.plan) {
      return (this.legacyCharacterUnlockPlan(plan)?selectCounterObjectiveLegacy160:selectCounterObjective)(meta,bridge,settings);
    },
    counterPrerequisiteRoute(action,settings,profile,catalog,nativeMeta,legacy=false) {
      if(action?.kind!=="pursue-counter"||action.mastery||Number(settings.characterId)>0)return null;
      const key=JSON.stringify([legacy,this.unlockSelectionKey,action.counter,action.goal,settings.characterId,settings.biome,settings.tier]),
        cached=this.counterPrerequisiteCache;
      if(cached?.key===key&&cached.catalog===catalog&&cached.bridge===this.bridge)return cached.value;
      const selector=(legacy?createCharacterUnlockLegacy160Selector:createUnlockGoalSelector)(profile,catalog,{confirmed:!!profile,
        preferredBiome:settings.biome,preferredTier:settings.tier ?? "auto",
        routeConstraints:settings.modePreference || {biome:settings.biome || "auto",tier:settings.tier ?? "auto"},
        collectionMode:["wardrobe","allClears"].includes(settings.mode),towerSettings:settings.modeSettings?.tower || {}}),
        examined=new Set(),counterSelector=legacy?selectCounterObjectiveLegacy160:selectCounterObjective;
      const find=current=>{
        if(current?.kind!=="pursue-counter"||current.mastery)return null;
        const route=counterSelector(nativeMeta,this.bridge,{...settings,...current});
        if(!route||route.automatable!==false)return null;
        for(const member of route.prerequisiteMembers || []) {
          if(examined.has(member))continue;examined.add(member);
          const step=selector({targetId:"characters:"+member,advanceOnComplete:false});
          if(step.status!=="ready"||!step.action)continue;
          const candidate=step.action.kind==="pursue-counter"&&!step.action.mastery
            ? counterSelector(nativeMeta,this.bridge,{...settings,...step.action}):null;
          if(candidate?.automatable===false) {
            const nested=find(step.action);if(nested)return {...nested,chain:[...(step.chain || []),...(nested.chain || [])]};
          } else return step;
        }
        return null;
      };
      let value;try{value=find(action);}finally{selector.dispose();}
      this.counterPrerequisiteCache={key,catalog,bridge:this.bridge,value};return value;
    },
    characterUnlockPlannerOptions(settings,base,profile) {
      const characterUnlockMode=settings.mode==='characters'||settings.mode==='auto'&&base.priority==='开图鉴';
      if(!characterUnlockMode)return {};
      if(settings.modeSettings?.characters?.route==='bulbasaur')return {characterUnlockMode,characterRoute:'bulbasaur'};
      const moveConstraintsBySpecies={};
      for(const id of profile?.league||[]){
        let build={};
        try{build=configurePlan({...base,species:id},{...settings,mode:'auto',characterId:id},profile,
          this.bridge.biomes,this.builds).build||{};}catch{/* Missing optional build evidence grants no new preference. */}
        moveConstraintsBySpecies[String(id)]=characterUnlockMoveConstraints(settings.finalReplacements?.[String(id)]||{},build,this.bridge);
      }
      return {characterRoute:'auto',characterUnlockMode,
        characterId:settings.characterId,moveConstraintsBySpecies};
    },
    resolveUnlockPlan(settings, base) {
      if(settings.mode==='shiny'&&Array.isArray(settings.shinyTypes)&&typeof selectShinyPlan==='function'&&normalizeShinyTypes(settings.shinyTypes).includes('classic')){
        const hunt=selectShinyPlan(this.app.meta.profile,settings,{...this.bridge,meta:this.app.meta,shinyCatalog:config.shinyCatalog,
          classicSpeciesEligibility:config.unlockCatalog?.rules?.classicSpeciesEligibility});
        // The existing shiny graph describes normal shinies only. A classic
        // hunt must not silently become that normal collection or its route.
        if(!normalizeShinyTypes(settings.shinyTypes).includes('shiny')||hunt?.huntType==='classic')return null;
      }
      const collectionMode=["wardrobe","allClears"].includes(settings.mode),
        selection = this.goalSelection(settings, base), catalog = this.getUnlockCatalog();
      if (!selection || !catalog || typeof selectUnlockGoal !== "function") return null;
      // An older embedded host can lack the optional graph for this category.
      // Retain its existing native planner rather than inventing an empty goal set.
      if (selection.category !== "all" && !catalog.targets.some(target => target.category === selection.category)) return null;
      const legacyCharacters=this.legacyCharacterUnlockApplies(settings,base,selection),
        goalSelector=legacyCharacters?selectCharacterUnlockLegacy160:selectUnlockGoal,
        counterSelector=legacyCharacters?selectCounterObjectiveLegacy160:selectCounterObjective;
      const profileCurrent=!collectionMode||this.ensureVerifiedClearProfile(),clanMembership=this.currentRankingClanMembership(),clanCosmetics=this.currentRankingClanCosmetics(),rankingParticipation=this.currentRankingParticipation(),rankingRewardChecks=this.currentRankingRewardChecks(),
        mutationNeeded=!collectionMode&&['all','appearance'].includes(selection.category),
        mutationToday=mutationNeeded?mutationTodaySnapshot(this.bridge,this.app.meta):null,
        mutation=mutationToday?{...mutationToday,variantId:mutationToday.variant,mutation:{id:mutationToday.variant,tier:mutationToday.tier},
          nativeAuthority:true,sourceHash:catalog.sourceHash}:null,
        profile = this.refreshUnlockProfile(),rankingMember=Number(settings.characterId)>0?Number(settings.characterId):profile&&
          selectAutomaticCharacter({...base,mode:'standard',objective:'kills'},profile,this.builds,this.bridge.data).species,
        signature = JSON.stringify([this.unlockProfileRevision,
        legacyCharacters,selection, catalog.sourceHash, catalog.targets.length,catalog.events,profileCurrent,!!profile,clanMembership,clanCosmetics,rankingMember,this.rankingParticipationState?.order || 0,this.rankingRewardCheckState?.order || 0,
        settings.characterId,settings.build,settings.finalReplacements,settings.customPlans,settings.modeSettings?.characters?.route,mutation?.day,mutation?.variantId]);
      if (signature !== this.unlockSelectionKey) {
        this.unlockSelectionKey = signature;
        const collectionMeta=Object.create(this.app.meta);collectionMeta.profile=profile || {};
        this.unlockProgress = {...(collectionMode&&!profileCurrent&&!(this.app.run&&profile)?{status:"waiting",action:null,chain:[],message:"等待原生资料加载与账号归属核验，保留当前对局",
          display:{targetName:settings.mode==="wardrobe"?"解锁更衣室":"角色全通关",reason:"原生账号资料尚未核验，待正常保存返回菜单后读取",nativeConditions:["资料加载中或归属未确认，不采用先前账号的通关历史"]}}:
          collectionMode&&typeof planCollectionMode==="function"?
          planCollectionMode(collectionMeta,this.bridge,catalog,settings,this.currentVerifiedClears(),{clanMembership,clanCosmetics,rankingParticipation,mutation}):goalSelector(profile || {}, catalog, {
          ...selection,...(legacyCharacters?{characterId:settings.characterId}:this.characterUnlockPlannerOptions(settings,base,profile)), preferredBiome:settings.biome, preferredTier:settings.tier ?? "auto",
          routeConstraints:settings.modePreference || {biome:settings.biome || "auto",tier:settings.tier ?? "auto"},
          ...(selection.mode==='appearance'?{appearanceOptions:normalizeAppearanceSettings(settings.modeSettings?.appearance)}:{}),
          towerSettings:settings.modeSettings?.tower || {},clanMembership,clanCosmetics,rankingParticipation,rankingRewardChecks,rankingMember,mutation,
          confirmed: !!profile, previous: this.unlockProgress,
          advanceOnComplete: selection.targetId === "auto",
        })),mode:selection.mode};
      }
      const progress = { ...this.unlockProgress, ...(this.unlockProgress.display ? {display:{...this.unlockProgress.display}} : {}), mode:selection.mode,
        confirmedAt:this.unlockProfileConfirmedAt || null, confirmationSource:this.unlockProfileSource || null };
      let action = progress.status === "ready" ? progress.action : null;
      const activity = this.activityModeDefinition(settings,selection.mode),
        towerEvent = activity?.engineMode === "tower" ? this.liveTowerEvent(activity.eventId) : null,
        fallback = { ...base, mode:activity?.engineMode === "tower" ? "tower" : "standard", metrics:[],
        objective:activity ? "event" : collectionMode?"collection":"resources", priority:activity?.name || (collectionMode?settings.mode==="wardrobe"?"解锁更衣室":"角色全通关":"刷资源"),
        goalMode:selection.mode, goalSelection:selection, goalProgress:progress, unlockAction:action,
        ...(legacyCharacters?{legacyCharacterUnlock160:true}:{}),
        need:progress.message, needs:[progress.message], automatable:activity ? !!towerEvent : true,
        ...(activity ? {activityId:activity.eventId,towerEvent,...(towerEvent ? {biome:towerEvent.biome,tier:0} : {})} : {}),
        ...(progress.constraintConflict ? {constraintConflict:progress.constraintConflict} : {}) };
      const waitingRanking=!action&&progress.status!=="complete"&&catalog.targets.find(row=>row.id===progress.targetId)?.action?.qualification;
      if(waitingRanking?.mode==="tower")Object.assign(fallback,{mode:"tower",automatable:false,qualification:{...waitingRanking}});
      const fixedCharacterRoute=progress.route?.id==='bulbasaur'&&settings.modeSettings?.characters?.route==='bulbasaur',
        planSettings = { ...settings, mode:"auto",...(collectionMode||fixedCharacterRoute?{characterId:null,biome:"auto",tier:undefined,build:"auto"}: {}) };
      if (action && (action.kind==="buy-lab" && settings.autoUpgrade === false ||
          action.kind==="buy-item" && settings.autoUnlockItems === false ||
          ["claim-quest","claim-event-track","claim-event-quest"].includes(action.kind) && settings.autoClaim === false)) {
        progress.status="waiting";
        progress.message += action.kind.startsWith("claim-") ? "；自动领奖已关闭，可手动领取或开启许可" : "；自动研究/购买已关闭，可手动购买或开启许可";
        if (progress.display) progress.display={...progress.display,reason:progress.message,nextStep:"保留目标并正常积累资源，许可或已保存进度变化后重新核对"};
      }
      if(!action&&catalog.targets.find(row=>row.id===progress.stepId||row.id===progress.targetId)?.action?.kind==='play-mutation')
        Object.assign(fallback,{mode:'mutation',automatable:false});
      if (!action) return { plan:fallback, settings:planSettings, progress };
      const nativeMeta = Object.create(this.app.meta); nativeMeta.profile = profile;
      const prerequisite=action.unlockExecution?.schemaVersion===1?null:this.counterPrerequisiteRoute(action,settings,profile,catalog,nativeMeta,legacyCharacters);
      if(prerequisite) {
        const originalCounter=action.counter;action=prerequisite.action;
        Object.assign(progress,{action,stepId:prerequisite.stepId,
          chain:[...new Set([...(progress.chain || []),...(prerequisite.chain || [])])],
          message:`当前角色尚无执行${originalCounter}的已知能力，先按原生前置解锁可用角色；${prerequisite.message}`});
        if(progress.display)progress.display={...progress.display,stepName:prerequisite.display?.stepName || prerequisite.display?.targetName,
          reason:progress.message,nextStep:prerequisite.display?.nextStep || prerequisite.message};
      }
      let route = {};
      if(action.kind==="qualify-ranking") {
        const q=action.qualification;
        if(q.mode==="tower") {
          const event=this.liveTowerEvent(q.eventId);
          route={mode:"tower",biome:event?.biome || action.biome,tier:0,metrics:[],objective:"event",towerEvent:event,
            automatable:!!event,rankingNeedsClan:q.kind==="clan-event"&&clanMembership!==true,towerGoal:{exitPolicy:"continue"}};
        } else if(!collectionMode&&Number(settings.characterId)>0&&q.member&&Number(settings.characterId)!==q.member)
          route={automatable:false,need:`当前固定角色与本原生榜单所需角色${q.member}不同；选择自动角色或该角色后继续参赛`};
        else route=counterSelector(nativeMeta,this.bridge,{...settings,...action,counter:q.metric || "wins",goal:1,
          ...(q.member?{characterId:q.member}:{}),singleRun:true}) || {};
        Object.assign(route,{qualification:{...q},nativeConditions:[...(progress.display?.nativeConditions || []),
          "此步骤只正常参赛并保存成绩；当前名次与获奖由服务器结算，未收到原生奖励就继续参赛"]});
      }
      if (action.kind === "pursue-counter" && typeof selectCounterObjective === "function") {
        const mastery=action.mastery;
        if (mastery && !collectionMode && Number(settings.characterId)>0 && Number(settings.characterId)!==mastery.member)
          route={automatable:false,need:`当前固定角色与原生专属挑战角色${mastery.member}不符，请选择该角色或自动角色`};
        else {
          route=counterSelector(nativeMeta,this.bridge,{...settings,...action,
            ...(action.strategyCounter?{counter:action.strategyCounter}:{}),
            ...(Number.isFinite(action.strategyGoal)?{goal:action.strategyGoal}:{}),...(mastery ? {
            counter:mastery.metric,characterId:mastery.member,biome:mastery.biome,tier:mastery.tier,
            singleRun:mastery.singleRun===true,...(collectionMode?{modePreference:{biome:mastery.biome || "auto",tier:mastery.tier ?? "auto"}}:{})} : {})}) || {};
          if (mastery) Object.assign(route,{mastery:{...mastery,constraints:{...(mastery.constraints || {})}},strategyCounter:mastery.metric,
            ...(['standard','endless'].includes(mastery.mode)?{mode:mastery.mode,...(mastery.mode==='endless'?{tier:0}:{})}:{}),
            ...(action.appearanceCounting?{appearanceCounting:{...action.appearanceCounting}}:{}),
            ...(mastery.constraints?.finalSpecies?.length===1?{evolutionTarget:mastery.constraints.finalSpecies[0]}:{}),
            nativeConditions:[...(progress.display?.nativeConditions || []),
              `固定原生挑战角色${mastery.member}；${mastery.metric}仅用于策略，完成仅认正常保存后的${action.counter}及原生领取回执`]});
          if(route.taskClaimTarget&&settings.autoClaim===false)
            Object.assign(route,{automatable:false,need:"当前委托已达标，但自动领奖已关闭；开启许可或手动领取后才能增加原生完成委托数"});
        }
      }
      if(action.kind==='play-mutation')route={mode:'mutation',biome:mutation?.biome,tier:mutation?.tier,
        mutationGoal:action.mutationGoal,automatable:!!mutation,metrics:[],objective:'mutation'};
      if (action.kind === "win-map") route = {biome:action.biome,tier:action.tier,metrics:["wins"],objective:"unlock",
        ...(Number.isInteger(action.species || action.characterId)?{species:action.species || action.characterId}: {})};
      if(action.challenge)Object.assign(route,{challenge:{...action.challenge},
        challengeScope:{mode:action.mode || "standard",biome:route.biome,tier:route.tier},
        ...(action.mode?{mode:action.mode}: {})});
      if(action.strategyCounter)route.strategyCounter=action.strategyCounter;
      if(Number.isInteger(action.goalStage)&&action.goalStage>0)route.goalStage=action.goalStage;
      if(action.goalInteraction)Object.assign(route,{goalInteraction:{...action.goalInteraction},
        goalInteractionScope:{mode:action.mode || route.mode || "standard",biome:route.biome || action.biome,tier:route.tier ?? action.tier}});
      if (["capture", "encounter", "research", "shiny-family"].includes(action.kind)) {
        const target = catalog.targets.find(entry => entry.id === progress.stepId),
          shinyGoal = target?.category === "shiny" || action.kind === "shiny-family",
          classicGoal=action.sourceKind==="classic" || action.source?.kind==="classic";
        const species = action.kind === "shiny-family" ? [...new Set([action.source?.species,...(action.species || [])])]
          .find(id => Number.isInteger(id) && !(profile.shinies || []).includes(id)) : action.species;
        if (classicGoal) route={metrics:["classics"],objective:"classic",classicTargetIds:[species]};
        else if (shinyGoal && species && typeof selectShinyPlan === "function") {
          const shiny = selectShinyPlan(profile, {...settings,mode:"shiny",biome:action.biome || "auto",
            unlockTargets:{...selection.targets,shiny:"shiny:"+species},shinyMode:"target",shinyTargetId:species},
            {...this.bridge,meta:nativeMeta,shinyCatalog:config.shinyCatalog});
          if (shiny?.shinyStatus === "ready") route = shiny;
          else progress.message += "；" + (shiny?.need || "等待已确认的异色来源，继续正常积累资源");
        } else route = {metrics:[action.kind === "research" ? "research" : "captures"],objective:"unlock",
          captureSpecies:action.kind === "capture" ? action.species : null,
          desiredSpecies:action.species || action.source?.species || null,
          researchFamily:action.kind === "research" ? action.family : null};
        if (action.biome) route.biome = action.biome;
        if (Number.isInteger(action.tier)) route.tier = action.tier;
        if (action.stage) route.goalStage = action.stage;
        route.goalSource = action.source || {kind:action.sourceKind,biome:action.biome,stage:action.stage};
        if (action.mode === "endless" || action.source?.mode === "endless") {
          route.mode="endless";route.tier=0;route.goalTime=action.atTime || action.source?.atTime;
          progress.message += "；按原生无尽里程碑等待，当前途径不能捕获或刷异色";
        }
      }
      if (action.kind === "evolve") {
        const root = this.bridge.data.root?.(action.from)?.id || action.from,
          owned = (profile.league || []).find(id => id === action.startSpecies || id === action.from || (this.bridge.data.root?.(id)?.id || id) === root);
        if (owned) route = {species:owned,metrics:["evolutions"],objective:"unlock",evolutionTarget:action.species,
          evolutionPath:action.evolutionPath || [action.species]};
        else progress.message += "；尚无可出战的原生进化起点，先继续正常积累";
      }
      if (action.kind === "earn-event") {
        route = {mode:action.mode === "tower" ? "tower" : "standard",objective:"event",
          metrics:action.mode === "tower" ? [] : ["kills"],eventGoal:{eventId:action.eventId,progress:action.progress},
          ...(action.towerGoal ? {towerGoal:{...action.towerGoal}} : {}),
          ...(action.mode === "standard" ? {biome:base.biome,tier:base.tier ?? 0,towerEvent:null,automatable:true} : {})};
        if (action.mode === "tower") {
          const event = this.liveTowerEvent(action.eventId);
          route = {...route,tier:0,biome:event?.biome || "graveyard",towerEvent:event,automatable:!!event};
          if (!event) progress.message += "；原生塔活动当前未开放，等待活动状态重新确认";
        }
      }
      if (!["win-map","pursue-counter","qualify-ranking","capture","encounter","research","shiny-family","evolve","farm-resources","buy-lab","buy-item","claim-quest","claim-event-track","claim-event-quest","earn-event","play-mutation"].includes(action.kind)) {
        progress.status="waiting";progress.message+="；当前没有已验证的自动操作，继续资源模式并在保存后重新核对";
      }
      if (route.automatable === false) {
        progress.status="waiting";progress.action=null;
        progress.message += "；" + (route.need || route.needs?.join("；") || "当前模式配置下该步骤不能执行，保留目标并正常积累资源");
        if (progress.display) progress.display={...progress.display,reason:progress.message};
        return {plan:{...fallback,unlockAction:null,need:progress.message,needs:[progress.message]},settings:planSettings,progress};
      }
      const constraintConflict = action.unlockExecution?.kind!=='character-route' && !collectionMode && typeof unlockRouteConflict === "function" &&
        unlockRouteConflict(route,settings.modePreference || settings);
      if (constraintConflict) {
        progress.status="waiting";progress.action=null;progress.code="route-conflict";
        progress.constraintConflict=constraintConflict;progress.message=constraintConflict.reason;
        if (progress.display) progress.display={...progress.display,reason:progress.message,
          nextStep:"按本模式明确地图/难度正常积累资源；改为自动后再执行所需前置"};
        return {plan:{...fallback,unlockAction:null,constraintConflict,need:progress.message,needs:[progress.message]},settings:planSettings,progress};
      }
      const plan = {...fallback,...route,priority:"解锁目标",goalProgress:progress,need:progress.message,
        needs:[...(route.needs || []),progress.message],goalMode:selection.mode,goalSelection:selection,unlockAction:action};
      if(action.unlockExecution){
        plan.unlockExecution=action.unlockExecution;
        plan.buildPreferences=action.unlockExecution.preferenceHints;
        if(!plan.characterCandidates?.length)plan.characterCandidates=action.unlockExecution.actorCandidates;
        const actor=action.unlockExecution.actorCandidates?.[0];
        if(action.unlockExecution.kind==='character-route'&&actor){Object.assign(plan,{mode:action.unlockExecution.mode,
            biome:action.unlockExecution.biome,tier:action.unlockExecution.tier});
          plan.species=actor.id;planSettings.characterId=actor.id;
          planSettings.build='auto';planSettings.modePreference={biome:plan.biome,tier:plan.tier};}
      }
      if (route.biome) planSettings.biome=route.biome;
      if (route.tier !== undefined) planSettings.tier=route.tier;
      if (route.species && !settings.characterId) planSettings.characterId=route.species;
      return {plan,settings:planSettings,progress};
    },
    unlockProgressSnapshot() {
      this.refreshUnlockProfile();
      const active = this.app?.run && this.app.run.state !== "over";
      if (active && this.run === this.app.run && this.unlockRunAccount !== this.app.meta.account) return null;
      if (!active && this.app?.meta?.profile && this.bridge && !this.starting) {
        try { this.unlockOverviewPlan = this.makePlan(); } catch { /* A next-run setting cannot break current account/status display. */ }
      }
      const displayedPlan = active ? this.plan : this.unlockOverviewPlan;
      const progress = displayedPlan?.goalProgress;
      if (!progress) return null;
      const verification=this.profileVerificationSnapshot(),knownSaved=!!this.savedUnlockProfileCurrent(),
        staleUnconfirmed=active&&knownSaved&&!progress.confirmationSource&&
          /等待.*原生.*保存|等待原生资料加载|等待当前原生已保存/.test(progress.message || ""),
        checkedProgress=staleUnconfirmed?{...progress,
          message:"已取得同一身份的已保存进度；本局继续原定目标，正常保存后自动更新目标路线",
          confirmedAt:this.unlockProfileConfirmedAt,confirmationSource:this.unlockProfileSource,
          display:{...(progress.display || {}),reason:verification.message,nextStep:verification.nextStep,
            nativeConditions:(progress.display?.nativeConditions || []).filter(text=>
              !/尚未取得原生已保存进度|尚未核验|归属未确认/.test(text)).concat(verification.message+"；"+verification.nextStep)}}:progress;
      const current = this.goalSelection(this.settings, this.plan || {}), executed = this.plan?.goalSelection;
      const preserving150 = active && this.app.run.capture?.species === 150 && this.preserveShinyOpportunity(this.app.run);
      const protectionReason = "暂不捕捉普通超梦，以保留当前版本异色遭遇资格";
      const profile = this.app?.meta?.profile || {}, capture = this.app?.run?.capture,
        wantsShiny150 = Number(this.plan?.shinyTargetId) === 150 ||
          [progress.requestedId, progress.targetId, progress.stepId].includes("shiny:150"),
        ordinary150 = capture?.species === 150 && !capture.shiny &&
          ["roaming", "weakened", "throwing"].includes(capture.state),
        sourceWarning150 = active && wantsShiny150 && this.settings.capturePriority !== false &&
          !(profile.shinies || []).includes(150) && (ordinary150 || (profile.league || []).includes(150)),
        sourceWarningReason = (ordinary150 ? "捕捉优先已开启，将捕获当前普通超梦；" : "") +
          "捕普通超梦入盟后，当前开放版本暂无可重复异色150来源，保留目标等待新来源",
        sourceWarningNext = ordinary150 ? "若需保留当前一次性超梦刷闪资格，请先关闭捕捉优先；保持开启则正常捕获，保存后重新核对来源" :
          "当前不重复刷已失效的超梦解锁遭遇；保留指定异色目标，正常积累资源并等待官方开放新来源";
      return {...checkedProgress,mode:active ? this.plan?.goalMode || progress.mode : progress.mode,
        ...(preserving150 ? {message:progress.message+"；"+protectionReason,captureProtection:{species:150,reason:protectionReason},
          display:{...(progress.display || {}),reason:protectionReason,nextStep:"正常结算保存后重试原生异色遭遇，不将普通超梦加入联盟"}} : {}),
        ...(sourceWarning150 ? {message:progress.message+"；"+sourceWarningReason,
          captureSourceWarning:{species:150,reason:sourceWarningReason,nextStep:sourceWarningNext},
          display:{...(progress.display || {}),reason:sourceWarningReason,nextStep:sourceWarningNext}} : {}),
        ...(active && current?.configurationKey !== executed?.configurationKey ? {pendingSelection:current} : {}),
        ...(active && this.goalStageHold(this.app.run) ? {wait:this.goalWaitSnapshot(this.app.run)} : {}),
        pendingSave:!!this.savePending || !!this.app?.meta?.hasPending?.()};
    },
    liveTowerEvent(eventId = "halloween26") {
      try {
        const events = this.app?.backend?.events?.();
        const event = Array.isArray(events) ? events.find(entry => entry?.mode === "tower" && entry.live === true &&
          (!eventId || entry.id === eventId)) : null;
        if (!event) return null;
        return { live:true,id:typeof event.id === "string" ? event.id : null,
          name:String(event.name || event.title || "紫苑塔活动"),
          biome:typeof event.biome === "string" && event.biome ? event.biome : "graveyard" };
      } catch { return null; }
    },
    selectPlanCharacter(plan,requestedSettings,executionSettings,profile,biomes) {
      const action=plan.unlockAction,requiredActor=plan.mastery?.member || action?.mastery?.member ||
        (action?.kind==='win-map'&&(action.species || action.characterId)) ||
        (action?.kind==='evolve'&&plan.species) || action?.qualification?.member;
      if(!requiredActor&&plan.automatable!==false&&!requestedSettings.characterId&&
          (!requestedSettings.build||['auto','generic'].includes(requestedSettings.build))){
        const selection=selectAutomaticCharacter(plan,profile,this.builds,this.bridge.data);
        if(selection.species!==plan.species&&Array.isArray(plan.characterCandidates)&&!plan.unlockExecution) {
          const counter=plan.taskTarget?.metric || plan.strategyCounter || plan.unlockTarget?.counter || action?.strategyCounter || action?.counter,
            goal=plan.taskTarget?.goal || action?.strategyGoal || plan.unlockTarget?.goal || action?.goal,
            meta=Object.create(this.app.meta);meta.profile=profile;
          const selected=typeof counter==='string'&&this.characterCounterObjective(meta,this.bridge,{...executionSettings,
            characterId:selection.species,biome:plan.biome,tier:plan.tier,counter,goal,
            singleRun:plan.taskTarget?.singleRun===true || action?.singleRun===true},plan);
          // Equal goal scores can use different native skills. Recompute the
          // chosen actor's preferences rather than carrying the previous
          // candidate's unlearnable moves into the new build.
          if(selected?.automatable===false)return plan;
          if(selected)Object.assign(plan,{buildPreferences:selected.buildPreferences,runThresholds:selected.runThresholds});
        }
        Object.assign(plan,configurePlan({...plan,species:selection.species},{...executionSettings,mode:'auto',characterId:selection.species},profile,biomes,this.builds));
        if(plan.unlockExecution){
          const actor=plan.unlockExecution.actorCandidates?.find(row=>row.id===selection.species);
          if(actor?.conditions)plan.unlockExecution={...plan.unlockExecution,conditions:actor.conditions,
            preferenceHints:actor.preferenceHints,focusCounters:actor.focusCounters,benefitTargetIds:actor.benefitTargetIds,
            foresight:actor.foresight};
          plan.buildPreferences=plan.unlockExecution.preferenceHints;
        }
        plan.characterSelection={reason:selection.reason,candidates:selection.candidates.slice(0,8)};
      }
      return plan;
    },
    makeMutationPlan(settings,currentRun=null) {
      const meta=this.app.meta,day=mutationTodaySnapshot(this.bridge,meta),active=!!currentRun?.mutation,
        previous=active&&this.planRun===currentRun?this.plan:null,
        options=normalizeMutationSettings(settings.modeSettings?.mutation),
        profile=this.savedUnlockProfileCurrent()||meta.profile,
        saved=mutationSavedProgress(profile,day,!!this.savedUnlockProfileCurrent());
      if(!day&&!active)return {mode:'mutation',goalMode:'mutation',priority:'每日变异',objective:'mutation',metrics:[],
        automatable:false,need:'原生每日变异日程尚未就绪，等待游戏定义与服务器时间正常加载',build:{id:'generic',sourceType:'generic',moves:[]}};
      const def=currentRun?.mutation?.def,today=active?{...day,day:previous?.mutationPlan?.day??day?.day??null,
        ends:previous?.mutationPlan?.ends??day?.ends??null,variant:def.id,name:def.name,description:def.desc,
        rules:Array.isArray(def.rules)?def.rules:[],biome:currentRun.biome.id,tier:currentRun.tier}:day,
        biome=today.biome,tier=today.tier,
        league=Array.isArray(profile?.league)?profile.league:[],
        species=active?currentRun.startSpecies:league.includes(Number(settings.characterId))?Number(settings.characterId):league[0];
      if(!Number.isInteger(species)||species<=0)return {mode:'mutation',goalMode:'mutation',priority:'每日变异',objective:'mutation',metrics:[],
        automatable:false,need:'请先通过游戏原生入口选择起始角色并加入联盟',build:{id:'generic',sourceType:'generic',moves:[]}};
      const routeProfile={...profile,biomes:{...profile.biomes,[biome]:tier}},
        maps=this.bridge.biomes.map(row=>({...row,live:row.id===biome||this.bridge.biomeLive(row.id)})),
        execution={...settings,mode:'auto',biome,tier,...(active?{characterId:species}:{}),modeSettings:null},
        modeGoal=settings.mode==='mutation'?options:previous?.mutationPlan||{target:'leaderboard',afterDailyRewards:'wait-next-day'},
        base={species,biome,tier,mode:'mutation',goalMode:'mutation',priority:'每日变异',objective:'mutation',metrics:['kills'],
          automatable:true,mutation:today.variant,mutationPlan:mutationPublicPlan(today,modeGoal,saved),
          need:'按原生当日固定规则挑战；地图、难度与种子以游戏和服务器回执为准，不使用背包或合作入口'};
      let plan=configurePlan(base,execution,routeProfile,maps,this.builds);
      if(!active)this.selectPlanCharacter(plan,settings,execution,routeProfile,maps);
      plan={...plan,mode:'mutation',goalMode:'mutation',objective:'mutation',mutation:today.variant,
        mutationPlan:base.mutationPlan,...(active?{adoptedRun:true,currentSpecies:currentRun.player.speciesId}:{})};
      if(active)plan.build=mutationAdaptiveBuild(plan.build,currentRun);
      return this.completePlan(plan);
    },
    mutationMenuReady(plan,valid=()=>true) {
      if(plan?.mode!=='mutation')return true;
      if(!valid()||this.app.coopRoom?.open||this.app.run&&this.app.run.state!=='over')return false;
      const today=mutationTodaySnapshot(this.bridge,this.app.meta);
      if(!today||today.day!==plan.mutationPlan?.day||today.variant!==plan.mutationPlan?.variant||
          today.biome!==plan.biome||today.tier!==plan.tier){
        this.status='每日变异日程已刷新，重新核对原生当日规则后再开始';return false;
      }
      if(plan.mutationPlan.target!=='daily-rewards')return true;
      const progress=mutationSavedProgress(this.savedUnlockProfileCurrent(),today,!!this.savedUnlockProfileCurrent());
      if(!progress.complete)return true;
      if(plan.mutationPlan.afterDailyRewards==='stop'||this.settings.autoRestart===false)this.stop('每日变异当日奖励已完成并保存',
        {source:'task-complete',code:'mutation-daily-complete'});
      else {this.status='每日变异当日奖励已完成，等待游戏原生下一次每日刷新';this.setHealth('daily-wait',this.status);}
      return false;
    },
    makePlan(currentRun = null, settingsOverride = null) {
      const inputSettings = settingsOverride || this.settings;
      if(inputSettings.mode==="autoManage" || !settingsOverride && this.enabled && this.autoManageScope) {
        const active=currentRun && currentRun===this.app?.run && this.autoManageRunAvailable(currentRun);
        if(!active)return {mode:"standard",goalMode:"autoManage",priority:"自动托管",objective:"resources",metrics:[],
          automatable:false,need:"等待玩家手动开始原生对局，不会自动开局",build:{id:"auto-manage-held",sourceType:"generic",moves:[]}};
        if(inputSettings.autoManageBuildPriority===true) {
          const plan=this.makePlan(currentRun,{...inputSettings,mode:"resources",modeSettings:null});
          return {...plan,goalMode:"autoManage",priority:"自动托管",autoManage:true,
            need:"仅接管当前原生对局；配装方案最高优先级已开启，原生结束后停止"};
        }
        const p=currentRun.player,scope=this.autoManageScopeMatches(currentRun)?this.autoManageScope:null,
          moves=(p.moves || []).filter(Boolean).map(move=>({key:move.def?.key,level:move.level}));
        return {mode:currentRun.mutation?'mutation':currentRun.tower?"tower":currentRun.endless?"endless":"standard",goalMode:"autoManage",
          species:currentRun.startSpecies || p.speciesId,currentSpecies:p.speciesId,biome:currentRun.biome.id,
          tier:currentRun.tier || 0,priority:"自动托管",objective:"resources",metrics:[],automatable:true,autoManage:true,
          adoptedRun:true,need:"保留接管时搭配，只升级当时已有招式与维生素；本局原生结束后停止",
          currentLoadout:{level:p.level,moves,vitamins:[...(p.vitamins?.keys?.() || [])].map(key=>({key}))},
          build:{id:"auto-manage-held",sourceType:"generic",moves:[...(scope?.moveKeys || [])],
            vitaminPriority:[...(scope?.vitaminKeys || [])],replacementPolicy:"never"}};
      }
      const requestedSettings = this.modePlanningSettings(inputSettings);
      if(currentRun?.mutation&&currentRun===this.app?.run&&currentRun.state!=='over')return this.makeMutationPlan(requestedSettings,currentRun);
      if(!currentRun&&requestedSettings.mode==='mutation')return this.makeMutationPlan(requestedSettings);
      if (currentRun && currentRun === this.app?.run && currentRun.state !== "over") {
        const player = currentRun.player, biome = currentRun.biome.id,
          currentSpecies = Number(player.speciesId || currentRun.startSpecies || this.app.meta.profile.starter),
          species = Number(currentRun.startSpecies || currentSpecies),
          tier = Math.max(0, Number(currentRun.tier) || 0),
          mode = currentRun.tower || currentRun.mode === "tower" ? "tower" : currentRun.endless ? "endless" : "standard";
        // These copies describe the native match already in progress. They do
        // not unlock maps, replace its character or change the next-run settings.
        const profile = { ...this.app.meta.profile,
          biomes: { ...this.app.meta.profile.biomes, [biome]: tier } };
        const biomes = this.bridge.biomes.map(entry => ({ ...entry, live: entry.id === biome || this.bridge.biomeLive(entry.id) }));
        if (!biomes.some(entry => entry.id === biome)) biomes.push({ ...currentRun.biome, live: true });
        const settings = { ...requestedSettings, characterId: null, biome, tier,
          mode: mode === "endless" ? "endless" : requestedSettings.mode === "endless" ||
            requestedSettings.mode === "leaderboard" && ["endless","survival"].includes(requestedSettings.leaderboardGoal)
            ? "resources" : requestedSettings.mode };
        if (String(settings.build || "").startsWith("custom-") && !resolveCustomPlan(settings.customPlans || [],
          { species, biome, tier, mode }, settings.build)) settings.build = "auto";
        const prior = this.planRun === currentRun && !(this.plan?.autoManage && !this.autoManageSelected()) ? this.plan : null;
        const priorRoot = prior && this.bridge.data.root?.(prior.species)?.id;
        const currentRoot = this.bridge.data.root?.(species)?.id;
        const sameRunPlan = prior && !(this.legacyCharacterCachedPlan(prior)&&!prior.legacyCharacterUnlock160) && prior.biome === biome && Number(prior.tier || 0) === tier &&
          (prior.species === species || prior.species === currentRun.startSpecies ||
            priorRoot != null && priorRoot === currentRoot) ? prior : null;
        // The seed supplies objective metadata, not a next-run character's
        // build. Match explicit/current custom plans only against native data.
        const seedSettings = { ...settings, modeSettings:null, build: "auto", ...(mode === "tower" ? {mode:"resources",biome:"auto",tier:0} : settings.mode==='mutation'?{mode:'resources'}:{}) };
        const unavailableGoal = seedSettings.mode === "shiny" && this.compatibility.capabilities?.shiny === false ||
          ["quests", "characters"].includes(seedSettings.mode) && this.compatibility.capabilities?.objectives === false;
        if (unavailableGoal) seedSettings.mode = "resources";
        const seed = sameRunPlan || this.makePlan(null, seedSettings);
        const matched = configurePlan({ ...seed, species, biome, tier, mode },
          mode === "tower" ? {...settings,mode:"auto"} : settings, profile, biomes, this.builds);
        const plan = { ...matched, ...(sameRunPlan || {}), build: matched.build,
          // Native engine adoption cannot invent a ranking objective. Keep the
          // executed player's route intent, even when the seed uses endless.
          modePreference:sameRunPlan?.modePreference || requestedSettings.modePreference,
          species, currentSpecies, biome, tier, mode, adoptedRun: true };
        if(plan.unlockExecution){
          const execution=plan.unlockExecution,actor=execution.actorCandidates?.find(row=>row.id===species),
            eligible=execution.mode===mode&&execution.biome===biome&&execution.tier===tier&&actor?.conditions;
          if(eligible){plan.unlockExecution={...execution,conditions:actor.conditions,preferenceHints:actor.preferenceHints,
            focusCounters:actor.focusCounters,benefitTargetIds:actor.benefitTargetIds,foresight:actor.foresight};plan.buildPreferences=actor.preferenceHints;plan.runThresholds={};}
          else {delete plan.unlockExecution;delete plan.buildPreferences;delete plan.runThresholds;
            plan.nextTargetWait='保留当前健康对局正常完成；保存后再按已拥有角色与普通生存路线并行推进角色条件';}
        }
        if(!sameRunPlan&&!plan.mastery&&!seed.unlockExecution&&Array.isArray(plan.characterCandidates)&&seed.species!==species) {
          const action=plan.unlockAction,counter=plan.taskTarget?.metric || plan.strategyCounter || plan.unlockTarget?.counter || action?.strategyCounter || action?.counter,
            meta=Object.create(this.app.meta);meta.profile=profile;
          const current=typeof counter==='string'&&this.characterCounterObjective(meta,this.bridge,{...settings,
            characterId:species,counter,goal:plan.taskTarget?.goal || action?.strategyGoal || plan.unlockTarget?.goal || action?.goal,
            singleRun:plan.taskTarget?.singleRun===true || action?.singleRun===true},plan);
          if(current&&current.automatable!==false)Object.assign(plan,{buildPreferences:current.buildPreferences,runThresholds:current.runThresholds});
          else {
            delete plan.buildPreferences;delete plan.runThresholds;
            plan.nextTargetWait="当前原生角色暂不具备下一项目标的已核对能力，保留本局正常完成；保存后再用合适角色继续，不沿用其他角色的招式偏好";
          }
          delete plan.characterCandidates;
        }
        if(plan.mastery&&(currentRun.coop&&plan.mastery.allowCoop!==true||plan.mastery.member!==species||plan.mastery.mode&&plan.mastery.mode!==mode||
            plan.mastery.biome&&plan.mastery.biome!==biome||Number(plan.mastery.tier)>tier)) {
          plan.nextTargetWait=currentRun.coop&&plan.mastery.allowCoop!==true?
            "该专属外观条件要求单人完成；当前合作对局正常推进，保存后再处理目标":
            "当前原生对局与下一项专属挑战不同，保留本局正常完成；保存后再用目标角色/条件开局";
          delete plan.mastery;delete plan.evolutionTarget;delete plan.evolutionPath;delete plan.buildPreferences;delete plan.runThresholds;
          // configurePlan above normally replaces the temporary mastery build.
          // Re-resolve an inherited legacy mastery build rather than leave its
          // strict/stat/acquisition fields after removing only plan.mastery.
          if(plan.build?.sourceType==="mastery")plan.build=configurePlan(plan,
            mode==="tower"?{...settings,mode:"auto"}:settings,profile,biomes,this.builds).build;
        }
        if(plan.challenge&&(plan.challengeScope?.mode&&plan.challengeScope.mode!==mode||
            plan.challengeScope?.biome&&plan.challengeScope.biome!==biome||Number(plan.challengeScope?.tier)>tier)) {
          plan.nextTargetWait="当前原生对局与下一项成就所需模式/地图/难度不同，保留本局正常完成后再执行";
          delete plan.challenge;delete plan.challengeScope;delete plan.goalInteraction;
        }
        if(plan.goalInteraction&&(plan.goalInteractionScope?.mode&&plan.goalInteractionScope.mode!==mode||
            plan.goalInteractionScope?.biome&&plan.goalInteractionScope.biome!==biome||Number(plan.goalInteractionScope?.tier)>tier)) {
          plan.nextTargetWait="当前原生对局与下一项目标交互路线不同，保留本局正常完成后再执行";
          delete plan.goalInteraction;delete plan.goalInteractionScope;
        }
        if (!sameRunPlan && (unavailableGoal || plan.automatable === false ||
            plan.objective === "shiny" && plan.shinyStatus !== "ready")) {
          plan.nextTargetWait = unavailableGoal ? "所选后续目标接口暂不可用，当前原生对局仍可托管" : plan.need;
          plan.automatable = true;
        }
        plan.currentLoadout = {
          observedAtGameTime: currentRun.time,
          startSpecies: species, species: currentSpecies,
          level: player.level, moves: (player.moves || []).filter(Boolean).map(move =>
            ({ key: move.def?.key, level: move.level })).filter(move => move.key),
          items: [...(player.items?.entries?.() || [])],
          vitamins: [...(player.vitamins?.entries?.() || [])].map(([key, vitamin]) =>
            ({ key, level: vitamin.level })),
        };
        if (plan.build?.sourceType !== "custom") plan.build = { ...(plan.build || {}),
          observedMoves:plan.build?.observedMoves || [...(plan.build?.moves || [])],
          id: plan.build?.id || "generic", moves: [...new Set([
            ...plan.currentLoadout.moves.map(move => move.key), ...(plan.build?.moves || []),
          ])].slice(0, 4) };
        return this.completePlan(plan);
      }
      const b = this.bridge;
      if (
        requestedSettings.mode === "shiny" &&
        this.compatibility.capabilities?.shiny === false
      )
        throw Error(
          "异色目标接口暂不可用，请先使用开图或资源模式；基础挂机仍可使用",
        );
      if (
        ["quests", "characters"].includes(requestedSettings.mode) &&
        this.compatibility.capabilities?.objectives === false
      )
        throw Error(
          "目标条件接口暂不可用，请先使用开图或资源模式；基础挂机仍可使用",
        );
      const profile = {
        ...this.app.meta.profile,
        leagueTarget: b.roster.length,
      };
      const biomes = b.biomes.map((v) => ({ ...v, live: b.biomeLive(v.id) }));
      const base = chooseCampaign(profile, biomes, this.tasks(), (id) => ({
        ...b.data.get(id),
        evolutionIds: b.data.pokemon
          .filter((p) => b.data.root(p.id).id === b.data.root(id).id)
          .map((p) => p.id),
      }));
      const planningSettings = requestedSettings;
      const resolvedGoal = this.resolveUnlockPlan(planningSettings, base);
      const activity = this.activityModeDefinition(planningSettings);
      if (activity && !resolvedGoal) {
        const event = activity.engineMode === "tower" ? this.liveTowerEvent(activity.eventId) : null,
          map = event && b.biomes.find(entry => entry.id === event.biome);
        if (!event || !map) return this.completePlan({ ...base, mode:"tower",priority:activity.name,objective:"event",
          activityId:activity.eventId,goalMode:requestedSettings.mode,automatable:false,
          need:event ? "活动地图的原生定义尚未就绪，等待正常加载" : activity.name+"当前没有可执行的原生入口，保留选择并等待官方开放",
          towerEvent:event,build:{id:"generic",sourceType:"generic",moves:[]} });
        const constraintConflict = typeof unlockRouteConflict === "function" &&
          unlockRouteConflict({biome:event.biome,tier:0,mode:"tower"},requestedSettings.modePreference);
        if (constraintConflict) {
          const plan=configurePlan({...base,mode:"standard",objective:"resources",priority:"刷资源",metrics:[],
            automatable:true,constraintConflict,need:constraintConflict.reason,needs:[constraintConflict.reason]},
            {...requestedSettings,mode:"auto"},profile,biomes,this.builds);
          plan.goalMode="tower";plan.modePreference=requestedSettings.modePreference;
          plan.goalProgress={mode:"tower",status:"waiting",targetId:null,stepId:null,action:null,chain:[],
            constraintConflict,message:constraintConflict.reason,counts:{total:1,complete:0,remaining:1,available:0,unknown:0},
            display:{targetName:event.name,stepName:"活动入口与当前模式配置不符",reason:constraintConflict.reason,
              nextStep:"按所选地图正常积累资源，将地图/难度改为自动后进入原生活动"},
            route:{biome:plan.biome,tier:plan.tier,nativeMode:plan.mode,reason:constraintConflict.reason}};
          return this.completePlan(plan);
        }
        const settings = {...requestedSettings,mode:"auto",biome:event.biome,tier:0};
        // The event's native start path accepts its own map independently of
        // ordinary campaign unlocks. Only these local planning copies change.
        const eventProfile = {...profile,biomes:{...profile.biomes,[event.biome]:0}};
        const eventMaps = biomes.map(entry=>({...entry,live:entry.id===event.biome || entry.live}));
        const plan = configurePlan({...base,biome:event.biome,tier:0,mode:"tower",priority:"紫苑塔活动",objective:"tower",metrics:[],automatable:true},
          settings,eventProfile,eventMaps,this.builds);
        plan.mode="tower";plan.towerEvent=event;
        this.selectPlanCharacter(plan,requestedSettings,settings,eventProfile,eventMaps);
        return this.completePlan(plan);
      }
      if (resolvedGoal) Object.assign(base, resolvedGoal.plan);
      const executionSettings = resolvedGoal?.settings || planningSettings;
      if(resolvedGoal?.plan.mode==='mutation'){
        if(resolvedGoal.plan.automatable===false)return this.completePlan({...resolvedGoal.plan,build:{id:'generic',sourceType:'generic',moves:[]}});
        const native=this.makeMutationPlan({...executionSettings,mode:'mutation',modeSettings:{...executionSettings.modeSettings,
          mutation:{target:'leaderboard',afterDailyRewards:'wait-next-day'}}});
        return {...native,goalMode:resolvedGoal.plan.goalMode,goalSelection:resolvedGoal.plan.goalSelection,
          unlockAction:resolvedGoal.plan.unlockAction,mutationGoal:resolvedGoal.plan.mutationGoal,
          goalProgress:resolvedGoal.progress,priority:resolvedGoal.plan.priority,need:resolvedGoal.plan.need};
      }
      if (resolvedGoal?.plan.mode === "tower") {
        const event = resolvedGoal.plan.towerEvent, map = event && b.biomes.find(entry=>entry.id === event.biome);
        if (!event || !map) return this.completePlan({...resolvedGoal.plan,automatable:false,
          modePreference:planningSettings.modePreference,need:resolvedGoal.progress.message+"；"+
            (event ? "活动地图定义尚未加载完成" : "当前原生活动入口未开放，保留活动和奖励选择，不启动无效对局"),
          build:{id:"generic",sourceType:"generic",moves:[]}});
        // The activity itself authorizes this map; never write it to the profile
        // or confuse a tower activity with an ordinary campaign-map unlock.
        const eventProfile = {...profile,biomes:{...profile.biomes,[event.biome]:0}},
          eventMaps = biomes.map(entry=>({...entry,live:entry.id === event.biome || entry.live})),
          plan = configurePlan(resolvedGoal.plan,{...executionSettings,mode:"auto",biome:event.biome,tier:0},eventProfile,eventMaps,this.builds);
        plan.mode="tower";plan.towerEvent=event;plan.modePreference=planningSettings.modePreference;
        this.selectPlanCharacter(plan,requestedSettings,executionSettings,eventProfile,eventMaps);
        plan.goalProgress={...resolvedGoal.progress,route:{biome:event.biome,tier:0,nativeMode:"tower",
          reason:"当前活动目标使用已开放的原生紫苑塔入口，地图/难度由活动决定"}};
        return this.completePlan(plan);
      }
      const objectiveMode = resolvedGoal ? null :
        requestedSettings.mode === "auto" || !requestedSettings.mode
          ? base.priority === "做委托"
            ? "quests"
            : base.priority === "开图鉴"
              ? "characters"
              : null
          : requestedSettings.mode;
      const objective =
        typeof selectObjective === "function" &&
        this.compatibility.capabilities?.objectives !== false &&
        ["quests", "characters"].includes(objectiveMode)
          ? (objectiveMode==='characters'&&this.characterUnlockImplementation==='legacy160'?selectCharacterObjectiveLegacy160:selectObjective)(this.app.meta, b, {
              ...planningSettings,
              mode: objectiveMode,
            })
          : null;
      const shiny =
        !resolvedGoal && typeof selectShinyPlan === "function" && requestedSettings.mode === "shiny"
          ? selectShinyPlan(profile, planningSettings, {
              ...b,
              meta: this.app.meta,
              shinyCatalog: config.shinyCatalog,
              classicSpeciesEligibility: config.unlockCatalog?.rules?.classicSpeciesEligibility,
            })
          : null;
      if (objective)
        Object.assign(base, objective, {
          priority:
            requestedSettings.mode === "auto" ? base.priority : objective.priority,
          ...(objectiveMode==='characters'&&this.characterUnlockImplementation==='legacy160'?{legacyCharacterUnlock160:true}:{}),
        });
      if (shiny) Object.assign(base, shiny);
      if (shiny && shiny.shinyStatus !== "ready" && !this.explicitShinyTarget(requestedSettings))
        Object.assign(base,{objective:"resources",mode:"standard",automatable:true});
      // Explicit task mode must still get task-specific status preferences.
      if (requestedSettings.mode === "quests")
        base.metrics = this.tasks()
          .filter((v) => !v.claimed && v.progress < v.goal)
          .map((v) => v.metric);
      const plan = configurePlan(
        base,
        executionSettings,
        profile,
        biomes,
        this.builds,
      );
      if (resolvedGoal) Object.assign(plan, {goalProgress:resolvedGoal.progress,
        goalSelection:resolvedGoal.plan.goalSelection,goalMode:requestedSettings.mode || "auto",
        unlockAction:resolvedGoal.plan.unlockAction});
      if (shiny) Object.assign(plan, shiny,
        shiny.shinyStatus !== "ready" && !this.explicitShinyTarget(requestedSettings)
          ? {objective:"resources",mode:"standard",automatable:true} : {});
      if (objective) plan.metrics = objective.metrics;
      if (
        (!requestedSettings.biome || requestedSettings.biome === "auto") &&
        ["resources", "leaderboard"].includes(requestedSettings.mode)
      ) {
        const maps = biomes.filter(
          (m) => m.live && (profile.biomes[m.id] ?? -1) >= 0,
        );
        const samples = (id) =>
          this.events.filter(
            (e) => e.kind === "settlement" && e.saved && e.biome === id,
          );
        maps.sort((a, c) => {
          const aa = samples(a.id),
            cc = samples(c.id);
          if (
            aa.length < 3 ||
            cc.length < 3 ||
            requestedSettings.mode === "leaderboard"
          )
            return aa.length - cc.length;
          const rate = (list) =>
            list.reduce((n, e) => n + (e.stardust || 0), 0) /
            Math.max(
              1,
              list.reduce((n, e) => n + (e.wallSeconds || e.time || 0), 0),
            );
          return rate(cc) - rate(aa);
        });
        if (maps[0] && maps[0].id !== plan.biome) {
          Object.assign(
            plan,
            configurePlan(
              { ...base, biome: maps[0].id },
              requestedSettings,
              profile,
              biomes,
              this.builds,
            ),
          );
        }
      }
      if (!plan.build?.moves?.length) {
        const kit = b.roster.find((v) => v.id === plan.species)?.kit || [];
        plan.build = {
          ...plan.build,
          id: plan.build?.id || "generic",
          moves: kit.length ? [kit[0], kit[kit.length - 1]] : [],
        };
      }
      const difficulty = this.autoDifficulty(plan,executionSettings,profile);
      plan.tier=difficulty.tier;plan.difficultyReason=difficulty.reason;
      this.selectPlanCharacter(plan,requestedSettings,executionSettings,profile,biomes);
      plan.modePreference=planningSettings.modePreference;
      if (resolvedGoal) {
        const preferenceOverride = (planningSettings.biome !== "auto" && plan.biome !== planningSettings.biome) ||
          (planningSettings.tier !== undefined && plan.tier !== planningSettings.tier);
        // The graph must resolve only executable steps compatible with explicit
        // mode choices. Fail closed at this last boundary if an optional/older
        // route adapter attempted to silently replace those choices.
        if(preferenceOverride && plan.unlockExecution?.kind!=='character-route' && !["wardrobe","allClears"].includes(requestedSettings.mode)) throw Error("解锁路线与本模式明确选择的地图或难度冲突，未提交不同地图的开局；请检查模式配置或改为自动");
        plan.goalProgress={...plan.goalProgress,route:{biome:plan.biome,tier:plan.tier,nativeMode:plan.mode,
          reason:plan.constraintConflict?.reason || plan.difficultyReason}};
      }
      if(requestedSettings.mode==='shiny'){
        const intent=selectShinyPlan(profile,planningSettings,{...b,meta:this.app.meta,shinyCatalog:config.shinyCatalog,
          classicSpeciesEligibility:config.unlockCatalog?.rules?.classicSpeciesEligibility});
        plan.shinyTypes=normalizeShinyTypes(requestedSettings.shinyTypes);
        if(intent){plan.classicTargetIds=intent.classicTargetIds||[];plan.classicSources=intent.classicSources||[];}
        plan.goalMode='shiny';
      }
      return this.completePlan(plan);
    },
    completePlan(plan) {
      const b = this.bridge;
      plan.build ||= {id:"generic",sourceType:"generic",moves:[]};
      if (
        typeof b.moveGuide === "function" &&
        typeof b.moveDef === "function" &&
        this.compatibility.capabilities?.moveGuide !== false
      ) {
        const currentSpecies = plan.currentSpecies || plan.species,
          species = b.data.get(currentSpecies),
          roster = b.roster.find((v) => v.id === currentSpecies) || b.roster.find((v) => v.id === plan.species);
        const guide = b.moveGuide(currentSpecies, roster, species.types, (id) =>
          this.app.meta.inLeague(id),
        );
        const available = [
          ...guide.kit,
          ...guide.line,
          ...guide.shared.filter((v) => v.open),
        ];
        plan.availableMoveKeys = available
          .map((v) => b.moveDef(v.id)?.key)
          .filter(Boolean);
        plan.moveAvailability = available.map(ref => ({ ...ref, key: b.moveDef(ref.id)?.key })).filter(ref => ref.key);
        plan.nativeGuide = guide;
      }
      if (plan.buildPreferences) {
        const wanted = plan.buildPreferences.preferredMoves || [];
        plan.build = {
          ...plan.build,
          moves: [...new Set([...wanted, ...plan.build.moves])],
          items: [
            ...new Set([
              ...(plan.buildPreferences.itemPriority || []),
              ...(plan.build.items || []),
            ]),
          ],
          vitaminPriority: plan.buildPreferences.vitaminPriority?.length
            ? plan.buildPreferences.vitaminPriority
            : plan.build.vitaminPriority,
        };
      }
      if (typeof completeMovePreferences === "function")
        plan.build = completeMovePreferences(plan.build, b, {
          species: plan.currentSpecies || plan.species,
          roster: b.roster.find(entry => entry.id === (plan.currentSpecies || plan.species)) || b.roster.find(entry => entry.id === plan.species),
          guide: plan.nativeGuide,
        });
      const requiredItem=({"old-rod":"old-rod",bonk:"stick"})[plan.goalInteraction?.kind];
      if(requiredItem) {
        plan.build={...plan.build,items:[requiredItem,...(plan.build.items || []).filter(key=>key!==requiredItem)],
          copyPriority:[requiredItem,...(plan.build.copyPriority || []).filter(key=>key!==requiredItem)],
          avoidItems:(plan.build.avoidItems || []).filter(key=>key!==requiredItem),
          itemRules:[{key:requiredItem,priority:0,targetCount:1},...(plan.build.itemRules || []).filter(rule=>rule.key!==requiredItem)],
          itemCounts:{...(plan.build.itemCounts || {}),[requiredItem]:1}};
        plan.nativeConditions=[...(plan.nativeConditions || []),"本目标仅临时优先获取必要道具 "+requiredItem+"；若已归档，在菜单通过原生单件解除归档并等待保存，不改其他道具"];
      }
      if(plan.mastery||plan.challenge) {
        const constraints=plan.mastery?.constraints || plan.challenge || {};
        if(plan.mastery)plan.mastery={...plan.mastery,constraints};
        plan.build={...plan.build,sourceType:plan.mastery?"mastery":"challenge",masteryConstraints:constraints,
          masteryAllowCoop:plan.mastery?.allowCoop===true,allowOffPlan:true,
          moveRules:[],vitaminRules:[],itemRules:[],avoidMoves:[],avoidVitamins:[],avoidItems:[],
          ...(constraints.damageShare?.key?{moves:[constraints.damageShare.key]}:{})};
        if(Number(constraints.minHits)>0&&!Number(constraints.endHpMax))plan.build={...plan.build,
          vitaminPriority:["super-potion","iron","hp-up","max-potion",...(plan.build.vitaminPriority || [])],
          itemPriority:["leftovers","black-sludge",...(plan.build.itemPriority || [])]};
        if(Number(constraints.minTime)>0)plan.runThresholds={...plan.runThresholds,minTime:Number(constraints.minTime)};
        plan.nativeConditions=[...(plan.nativeConditions || []),"当前挑战临时优先于旧配装；原方案保持保存。按真实招式/形态/时间与承伤要求操作，完成仅认原生保存回执"];
      }
      return plan;
    },
    growthRecovery(r) {
      if(this.masteryState(r).avoidXp)return false;
      if (this.settings.safeMode !== false || (Number(r.stageTime) || 0) < 25) return false;
      const stage = Math.min(4, Math.max(1, Number(r.stage) || 1));
      const goal = [0, 14, 26, 36, 36][stage];
      const minimum = Math.min(goal, [0, 3, 15, 27, 36][stage] +
        Math.max(0, Math.floor(((Number(r.stageTime) || 0) - 30) / 30)));
      return (Number(r.player.level) || 1) < minimum;
    },
    tacticalState(r) {
      const cached = this.tacticalAssessment;
      if (!cached || cached.run !== r || cached.stage !== r.stage ||
          cached.terrain !== r.terrain ||
          r.time - cached.at >= 0.2 || cached.hp !== r.player.hp) {
        const assessment = assessTacticalState(r, this.damageLog);
        this.tacticalAssessment = { run: r, stage: r.stage, terrain: r.terrain, at: r.time, hp: r.player.hp, assessment };
      }
      return this.tacticalAssessment.assessment;
    },
    interactionApproach(r, object) {
      const approach=point=>nativeNearestApproach(r,object,point,{validPoint:candidate=>{
        const y=r.terrain.height?.(candidate.x,candidate.z);
        return Number.isFinite(y)&&this.withinArena(r,candidate.x,candidate.z,2)&&
          !r.terrain.hitProp?.(candidate.x,y+.3,candidate.z,r.player.radius||.55);
      }});
      if (object.kind === "altar") return { x: object.x, z: object.z, radius: object.r * 0.45 };
      // Passive Bonkoin collection is <1.5m. Its native r=1.2 is a landmark
      // label radius, not the ordinary E disk (r+.8); never overwrite this
      // stopping distance with a generic interactable approach.
      if (isNativePassivePickup(object)) return { x:object.x, z:object.z, radius:1.15 };
      // The native landmark at the foot accepts E after clear. Older terrain
      // also permits the raised automatic-climb route; newer spawn bounds
      // exclude that ramp, so use the real landmark from its open front side.
      const stairs = r.terrain?.arena?.tower?.stairs;
      if (object.kind === "tower" && object.data?.sub === "stairs" &&
          r.tower?.state === "clear" && !r.tower.roof && stairs &&
          [stairs.x, stairs.z, stairs.len, stairs.rise].every(Number.isFinite) &&
          stairs.len > 0 && stairs.rise > 0) {
        // The native ramp ends on the arena's strict navigation margin.
        // Stand just before it: the entire stopping disk still enters the
        // native raised-end climb gate without making the route out of bounds.
        const raised={x:stairs.x,z:stairs.z-stairs.len+Math.min(1.25,stairs.len/4)};
        if(r.terrain.inBounds(raised.x,raised.z,2)===false&&r.terrain.inSolid?.(raised.x,raised.z)===true) {
          const dx=object.x-raised.x,dz=object.z-raised.z,length=Math.hypot(dx,dz),
            offset=Math.min(1.8,Math.max(.5,(Number(object.r)||3.6)*.5)),
            foot={x:object.x+dx/length*offset,z:object.z+dz/length*offset,radius:.25,nativeStairInteraction:true};
          const y=r.terrain.height(foot.x,foot.z);
          if(length>0&&r.terrain.inBounds(foot.x,foot.z,2)&&Number.isFinite(y)&&
              !r.terrain.hitProp?.(foot.x,y+.3,foot.z,r.player.radius||.55))return approach(foot);
        }
        return approach({ ...raised, radius: 0.15, nativeWalkUpStairs: true });
      }
      const usable = Math.max(0.3, (Number(object.r) || 2.6) + 0.6);
      const progression = object.kind === "boss" || object.kind === "portal";
      const entrance=this.compatibility?.maintenanceScope && !r.rifts?.busy && r.rifts?.entrance;
      const riftNearby=entrance && [entrance.x,entrance.z].every(Number.isFinite) && distance(entrance,object)<usable+3.4;
      if ((progression || riftNearby) && distance(r.player.pos, object) <= 12) {
        if (this.interactionApproachScope?.run !== r ||
            this.interactionApproachScope.stage !== r.stage ||
            this.interactionApproachScope.terrain !== r.terrain) {
          this.interactionApproachScope = { run: r, stage: r.stage, terrain: r.terrain };
          this.interactionApproachPoints = new WeakMap();
        }
        const revision = this.interactionTracker.inspect(r, object)?.approachRevision || 0;
        const pos = r.player.pos, tolerance = 0.15;
        const ring = Math.min(object.kind === "boss" ? 4.5 : 3.9,
          Math.max(0.1, (Number(object.r) || 2.6) + 0.8 - tolerance - 0.15));
        const valid = point => {
          const y = r.terrain.height?.(point.x, point.z);
          return Number.isFinite(y) &&
            (!riftNearby || distance(point,entrance)-point.radius>3.4) &&
            distance(point, object) + point.radius < (Number(object.r) || 2.6) + 0.8 &&
            this.withinArena(r, point.x, point.z, 2) &&
            !r.terrain.hitProp?.(point.x, y + 0.3, point.z, r.player.radius || 0.55);
        };
        const cached = this.interactionApproachPoints.get(object);
        if (cached?.revision === revision && valid(cached.point)) return approach(cached.point);
        const base = Math.atan2(pos.z - object.z, pos.x - object.x) + revision * Math.PI / 4;
        let best = null;
        let detour = null;
        for (let index = 0; index < 16; index++) {
          const offset = index === 0 ? 0 : Math.ceil(index / 2) * (index % 2 ? 1 : -1);
          const angle = base + offset * Math.PI / 8;
          const point = { x: object.x + Math.cos(angle) * ring,
            z: object.z + Math.sin(angle) * ring, radius: tolerance };
          if (!valid(point)) continue;
          point.y = r.terrain.height(point.x, point.z);
          const d = distance(pos, point);
          const detourCost=d + Math.max(0,point.y-r.terrain.height(pos.x,pos.z)-0.6)*20;
          if(!detour || detourCost < detour.cost) detour={point,cost:detourCost};
          if (d >= 0.1 && !this.walkRoute(r, pos, (point.x - pos.x) / d,
            (point.z - pos.z) / d, d)) continue;
          if (!best || d < best.distance) best = { point, distance: d };
        }
        if (best) {
          this.interactionApproachPoints.set(object, { revision, point: best.point });
          return approach(best.point);
        }
        if(detour) {
          this.interactionApproachPoints.set(object,{revision,point:detour.point});
          return approach(detour.point);
        }
        if(riftNearby) {
          this.stop('当前交互与裂隙入口重叠，未找到安全交互点，请手动处理后继续辅助',{source:'native-route-required',code:'rift-world-overlap'});
          return {x:r.player.pos.x,z:r.player.pos.z,radius:.15};
        }
      }
      // Native shrine art is an unbreakable r=3 collider. Its E disk is r+0.8;
      // reaching the centre is neither necessary nor physically possible.
      if (object.kind !== "shrine") return approach({ x: object.x, z: object.z, radius: usable });
      const pos = r.player.pos, memory = this.interactionTracker.inspect(r, object);
      const turn = (memory?.approachRevision || 0) * Math.PI / 4;
      const base = Math.atan2(pos.z - object.z, pos.x - object.x) + turn;
      const radius = Math.max(3.8, Math.min(4.7, usable - 0.8));
      let best = null;
      for (let index = 0; index < 16; index++) {
        const angle = base + index * Math.PI / 8;
        const x = object.x + Math.cos(angle) * radius, z = object.z + Math.sin(angle) * radius;
        const y = r.terrain.height?.(x, z);
        if (!Number.isFinite(y) || !this.withinArena(r, x, z, 1) ||
            r.terrain.hitProp?.(x, y + 0.3, z, r.player.radius || 0.55)) continue;
        const d = Math.hypot(x - pos.x, z - pos.z);
        const clear = d < 0.1 || this.walkRoute(r, pos, (x - pos.x) / d, (z - pos.z) / d, d, 1);
        const score = d + (clear ? 0 : 15) + index * 2;
        if (!best || score < best.score) best = { x, y, z, radius: 0.65, score };
      }
      return approach(best || { x: object.x, z: object.z, radius: usable });
    },
    nativeInteractionAction(r) {
      if (r?.state !== "play" || r.player?.dead) return null;
      if(this.flightState(r).noInteractions)return null;
      if(this.flightState(r).keepInteractions&&!this.flightInteractionGroundReady(r))return null;
      // .831 gives a native nearby downed peer the held E branch first.
      if(this.nativeCooperativeRescuePeer(r))return "rescue";
      if(r.rifts?.nearEntrance?.())return "rift";
      if(r.capture?.throwing===true || r.capture?.state==="throwing")return null;
      // Match the remaining native dispatcher: a capture owns E first;
      // a companion can use it only when there is no native nearest landmark.
      // A protected ordinary Mewtwo must not fall through to a different E use.
      if (r.capture?.canThrow?.())
        return this.preserveShinyOpportunity(r)||!this.shinyHuntCaptureAllowed(r,this.captureOpportunity(r,r.capture.index)||r.capture) ? null : "capture";
      if (!r.interactables?.nearest && r.allies?.canThrow?.()) return this.shinyHuntCaptureAllowed(r,this.captureOpportunity(r,r.allies.down))?'ally':null;
      if(r.rifts?.canCallAlpha?.())return 'rift-alpha';
      if(r.rifts?.canCallWave?.())return 'rift-wave';
      if(this.leaderboardCampBlocks(r,r.interactables?.nearest))return null;
      if (r.coop?.portalReady && r.interactables?.nearest?.kind==="portal") return null;
      if(r.interactables?.nearest && !this.cooperativeInteractionPolicy(r,r.interactables.nearest).allowed)return null;
      return r.interactables?.nearest ? "world" : null;
    },
    nativeCooperativeRescuePeer(r) {
      return r?.state==="play"&&!r.player?.dead&&typeof r.coop?.downedNear==="function"?r.coop.downedNear():null;
    },
    releaseCooperativeRescueInput() {
      const code=this.cooperativeRescueCode,input=this.cooperativeRescueInputRef?.deref(),logical=this.cooperativeRescueLogicalCode,ownStroke=this.cooperativeRescueOwnsPressed;
      this.cooperativeRescueCode=null;this.cooperativeRescueInputRef=null;this.cooperativeRescueLogicalCode=null;this.cooperativeRescueOwnsPressed=false;
      if(!code)return;
      const owned=this.held.has(code);this.key(code,false);
      if(owned&&ownStroke&&logical)input?.pressed?.delete?.(logical);
      this.pendingTapCodes.delete(code);
    },
    cooperativeRescueInput(r,target,tactical) {
      if(this.app?.run!==r||this.run!==r)return false;
      const peer=this.nativeCooperativeRescuePeer(r),code=this.code("interact"),
        allowed=this.enabled&&this.app?.run===r&&this.run===r&&this.controlIdentityCurrent()&&!this.flightState(r).noInteractions&&
          (!this.flightState(r).keepInteractions||this.flightInteractionGroundReady(r))&&
          target?.cooperativeRescue&&peer&&peer.slot===target.cooperativeRescueSlot&&!peer.gone&&
          peer.stage===r.stage&&Number.isFinite(peer.lastAt)&&r.realTime-peer.lastAt<12&&
          (peer.last?.flags&1)&&!(peer.last.flags&2)&&tactical?.hpRatio>=.45&&tactical.pressure<=3;
      if(this.cooperativeRescueCode&&(!allowed||this.cooperativeRescueCode!==code))this.releaseCooperativeRescueInput();
      if(!allowed)return false;
      // Native focus/blur and repeat-key guards can clear keys independently.
      // Reassert our own physical binding only after the native logical receipt
      // says it is no longer held; ordinary held frames dispatch no new event.
      if(typeof r.input?.down==="function"&&!r.input.down("KeyE"))this.held.delete(code);
      this.cooperativeRescueCode=code;
      if(this.cooperativeRescueInputRef?.deref()!==r.input&&r.input)this.cooperativeRescueInputRef=new WeakRef(r.input);
      const press=!this.held.has(code);
      if(press)this.cooperativeRescueLogicalCode=typeof r.input?.canon==="function"?r.input.canon(code):code;
      if(press)this.cooperativeRescueOwnsPressed=!!this.cooperativeRescueLogicalCode&&!r.input?.pressed?.has?.(this.cooperativeRescueLogicalCode);
      this.key(code,true);
      // Rescue uses native down(), never hit(). Withdraw only our new stroke
      // so a peer expiring before the native E block cannot tap a world action.
      if(press&&this.cooperativeRescueOwnsPressed)r.input?.pressed?.delete?.(this.cooperativeRescueLogicalCode);
      this.cooperativeRescueOwnsPressed=false;
      return true;
    },
    cooperativeInteractionPolicy(r,object) {
      return cooperativeInteractionDecision(r,object,this.settings.convenience?.coop);
    },
    cooperativeModalPolicy(r,modal) {
      const kind=modal?.entity?.kind || ({shop:"meowth",forget:"hypno",ditto:"ditto",slots:"slots",fusion:"bill"})[modal?.kind];
      return this.cooperativeInteractionPolicy(r,{kind});
    },
    cooperativePolicyMessage(decision) {
      return decision.reason==="cooperative-policy-wait-portal" ?
        `联机便利：等待至少一名同区域在线队友先进入原生传送门（当前${decision.readyPeers}/${decision.activePeers}已准备）` :
        "联机便利：已设置不主动使用此类交互，保留当前对局";
    },
    cooperativeRescueTargets(r, tactical) {
      if (!r.coop || typeof r.coop.active!=="function" || r.player.dead || r.state!=="play" ||
          tactical.hpRatio<.45 || tactical.pressure>3) return [];
      const targets=[];
      for (const peer of r.coop.active()) {
        // Mirror native active()/downedTick eligibility. 'out' peers return on
        // the next native stage and cannot be revived. Native .831 requires
        // staying in range while holding the actual remapped interact key.
        if (peer.gone || peer.stage!==r.stage || !Number.isFinite(peer.lastAt) ||
            !(r.realTime-peer.lastAt<12) || !(peer.last?.flags&1) || peer.last.flags&2 ||
            ![peer.x,peer.z].every(Number.isFinite) || !Number.isInteger(peer.slot) ||
            !this.withinArena(r,peer.x,peer.z,2)) continue;
        targets.push({x:peer.x,z:peer.z,y:r.terrain.height?.(peer.x,peer.z),moving:true,
          cooperativeRescue:true,cooperativeRescueSlot:peer.slot,radius:2.3,id:`coop-rescue:${peer.slot}`});
      }
      return targets;
    },
    allyThrowApproach(r, index, capture = false) {
      const pos = r.player.pos, en = r.enemies;
      const center = { x: en.x[index], z: en.z[index] };
      if (!Number.isFinite(center.x) || !Number.isFinite(center.z)) return center;
      // Native E gives every usable landmark precedence over a support ball.
      // Move into the <9m throw disk while staying outside those E disks. Do
      // not "unblock" E by spending gold or accepting a forbidden interaction.
      const landmarks = [...(r.interactables.list || [])];
      if (r.interactables.nearest && !landmarks.includes(r.interactables.nearest))
        landmarks.push(r.interactables.nearest);
      const active = capture?[]:landmarks.filter(object => object.kind !== "altar" && object.kind !== "shroom" &&
        (!object.used || ["meowth", "hypno", "portal"].includes(object.kind) ||
          object.kind === "tower" && object.data?.sub !== "trick"));
      if (r.capture?.state === "weakened" && this.preserveShinyOpportunity(r)) {
        const protectedIndex = r.capture.index;
        if (Number.isFinite(en.x[protectedIndex]) && Number.isFinite(en.z[protectedIndex]))
          active.push({ x: en.x[protectedIndex], z: en.z[protectedIndex], r: 8.2 });
      }
      const rescuePeers=typeof r.coop?.downedNear==="function"&&typeof r.coop.active==="function"
        ?[...r.coop.active()].filter(peer=>peer.last?.flags&1&&Number.isFinite(peer.x)&&Number.isFinite(peer.z)):[];
      const tolerance = 0.25;
      const legal = point => Math.hypot(point.x - center.x, point.z - center.z) + tolerance < 9 &&
        // Native .831 downedNear owns E within3.5m, even ahead of capture.
        // Move outside that real disk rather than repeatedly tapping at a peer.
        rescuePeers.every(peer=>Math.hypot(point.x-peer.x,point.z-peer.z)>=3.5+tolerance) &&
        active.every(object => Math.hypot(point.x - object.x, point.z - object.z) - tolerance >=
          (Number(object.r) || 0) + 0.8) && this.withinArena(r, point.x, point.z, 1) &&
        Number.isFinite(r.terrain.height?.(point.x, point.z)) &&
        !r.terrain.hitProp?.(point.x, r.terrain.height(point.x, point.z) + 0.3,
          point.z, r.player.radius || 0.55);
      if (legal(pos)) return { ...pos, radius: tolerance, captureApproach: "native-ally-throw" };
      const base = Math.atan2(pos.z - center.z, pos.x - center.x);
      const points = [];
      for (const radius of [4, 7.8]) for (let step = 0; step < 16; step++) {
        const angle = base + step * Math.PI / 8;
        const point = { x: center.x + Math.cos(angle) * radius,
          z: center.z + Math.sin(angle) * radius, radius: tolerance,
          captureApproach: "outside-landmark-E" };
        if (legal(point)) points.push(point);
      }
      points.sort((a, b) => distance(pos, a) - distance(pos, b));
      // A non-direct but legal endpoint remains available to native navigation.
      // Only a few nearest candidates need expensive strict route checks.
      for (const point of points.slice(0, 4)) {
        const d = distance(pos, point);
        if (d < 0.1 || this.walkRoute(r, pos, (point.x - pos.x) / d,
          (point.z - pos.z) / d, d, 1)) return point;
      }
      return points[0] || { ...center, radius: 5, captureApproach: "no-free-native-E-position" };
    },
    syncCapturePursuits(r) {
      if (this.capturePursuitScope !== r || this.capturePursuitStage !== r.stage || this.capturePursuitTerrain !== r.terrain) {
        this.capturePursuitScope = r; this.capturePursuitStage = r.stage;
        this.capturePursuitTerrain = r.terrain;
        this.capturePursuits = new Map();
      }
      const en = r.enemies;
      for (const [key, entry] of this.capturePursuits) {
        if (!Number.isInteger(entry.index) || !en.alive?.[entry.index] || (en.dying?.[entry.index] || 0) > 0 ||
            en.species?.[entry.index] !== entry.species || en.gen?.[entry.index] !== entry.gen)
          this.capturePursuits.delete(key);
      }
    },
    requestCaptureRepath(r, entry, opportunity, reason) {
      entry.repaths++; entry.lastRetryAt = r.time; entry.retryReason = reason;
      entry.until = r.time + Math.min(1.2, opportunity.remaining == null ? 1.2 : Math.max(.2, opportunity.remaining * .08));
      entry.reposition = null;
      this.navTarget = null; this.navAt = -Infinity; this.routeObservation = null;
      if (this.target?.enemyIndex === entry.index) this.blocked.delete(this.target.id);
      const pos = r.player.pos, en = r.enemies,
        base = Math.atan2(pos.z - en.z[entry.index], pos.x - en.x[entry.index]) +
          (entry.repaths % 2 ? 1 : -1) * Math.PI / 2;
      // A brief real side-step changes the approach before another native
      // route search. Endpoints are checked; this never moves the player or
      // pretends an unchecked route/throw succeeded.
      for (const offset of [0, Math.PI / 3, -Math.PI / 3, Math.PI]) {
        const length = Math.min(4, Math.max(2, (r.player.stats.moveSpeed || 1) * 2)),
          point = { x: pos.x + Math.cos(base + offset) * length, z: pos.z + Math.sin(base + offset) * length };
        if (!this.withinArena(r, point.x, point.z, 2)) continue;
        const floor = r.terrain.height(point.x, point.z);
        if (!Number.isFinite(floor) || r.terrain.hitProp?.(point.x, floor + .3, point.z, r.player.radius || .55)) continue;
        if (this.walkRoute(r, pos, (point.x - pos.x) / length, (point.z - pos.z) / length, length)) {
          entry.reposition = { ...point, y: floor, radius: .4 }; break;
        }
      }
      this.tacticalReason = "捕捉机会仍在，短暂换位并重新寻路后继续削弱或投球";
    },
    capturePursuitAllowed(r, target) {
      const opportunity = this.captureOpportunity(r, target?.index);
      if (!opportunity) return false;
      // Native Jx.start banishes other actors beyond its physical ring. Keep
      // this encounter visible for later scans, but do not let an unreachable
      // alpha outside that wall starve the boss that actually releases it.
      const circle=r.mewtwo,index=opportunity.index;
      if(circle?.active && [circle.cx,circle.cz,r.enemies.x[index],r.enemies.z[index]].every(Number.isFinite) &&
          Math.hypot(r.enemies.x[index]-circle.cx,r.enemies.z[index]-circle.cz)>22.6+9)return false;
      this.syncCapturePursuits(r);
      const en = r.enemies, hp = Number(en.hp?.[index]),
        distanceToEnemy = Number.isFinite(target.distance) ? target.distance : Math.hypot(r.player.pos.x - en.x[index], r.player.pos.z - en.z[index]),
        nativeAttempts = opportunity.source === "capture" ? Number(r.capture.attempts) || 0 :
          Number(r.allies?.attempts?.get?.(opportunity.gen)) || 0;
      let entry = this.capturePursuits.get(opportunity.key);
      if (!entry) {
        entry = { index, gen: opportunity.gen, species: opportunity.species, firstSeenAt: r.time,
          bestDistance: distanceToEnemy, hp, noProgress: 0, at: r.time, until: 0,
          state: opportunity.state, source: opportunity.source, stalls: 0, repaths: 0,
          nativeAttempts, reposition: null, retryReason: null };
        this.capturePursuits.set(opportunity.key, entry);
      }
      const changed = opportunity.state !== entry.state,
        failed = nativeAttempts > entry.nativeAttempts || changed && opportunity.state === "roaming" &&
          ["weakened", "down", "throwing"].includes(entry.state);
      if (failed) this.requestCaptureRepath(r, entry, opportunity, "native-capture-retry");
      if (changed || Number.isFinite(hp) && hp < entry.hp - .1 || distanceToEnemy < entry.bestDistance - .7) {
        entry.noProgress = 0; entry.bestDistance = distanceToEnemy;
        if (Number.isFinite(hp)) entry.hp = hp;
        if (!failed) { entry.until = 0; entry.reposition = null; }
      }
      entry.state = opportunity.state; entry.source = opportunity.source; entry.nativeAttempts = nativeAttempts;
      entry.remaining = opportunity.remaining; entry.deadlineAt = opportunity.deadlineAt;
      const selected = this.target?.enemyIndex === index && /^(shiny-|capture|ally|alpha-)/.test(String(this.target?.id)) &&
        (this.target.captureGen == null || this.target.captureGen === opportunity.gen);
      if (selected && entry.until <= r.time) entry.noProgress += Math.max(0, Math.min(0.5, r.time - entry.at));
      entry.at = r.time;
      const nativeAction = this.nativeInteractionAction(r),
        throwable = opportunity.source === "capture" && nativeAction === "capture" ||
          opportunity.source === "ally" && r.allies.down === index && nativeAction === "ally";
      if (throwable) { entry.until = 0; entry.reposition = null; return true; }
      if (entry.noProgress >= 16 && entry.until <= r.time) {
        entry.noProgress = 0; entry.stalls++;
        this.requestCaptureRepath(r, entry, opportunity, "no-target-progress");
      }
      // Retry phases retain the same entity and its priority; only the native
      // lifecycle (success, fleeing, expiry/death or generation change) ends it.
      return true;
    },
    companionPower(r, ally) {
      if (!ally) return 0;
      const nativePower = r.allies?.power?.(ally), nativeCooldown = r.allies?.cooldown?.(ally);
      if (Number.isFinite(nativePower) && Number.isFinite(nativeCooldown) && nativeCooldown > 0)
        return nativePower / nativeCooldown;
      // Same checked public native formula when optional power helpers are absent.
      const attackSpeed = Math.max(0.01, Number(r.player.stats.attackSpeed) || 1);
      const power = (12 + 1.1 * r.player.level) * (0.75 + (Number(ally.bst) || 0) / 800) *
        (1 + 0.25 * (Math.min(3, r.stage) - 1)) * (1 + 0.1 * (Number(ally.bond) || 0));
      return power * Math.sqrt(attackSpeed) / (ally.physical ? 1.8 : 1.6);
    },
    maybeOpenRift(r) {
      if(this.compatibility?.maintenanceScope?.allowRifts!==true||r.mode!=='standard'||r.state!=='play'||
          this.flightState(r).noInteractions||this.interactionRules().free===false||r.stageCleared||r.bossSpawned||
          !(r.incense>0)||!r.rifts?.enabled||r.rifts.entrance||r.rifts.isInside||r.rifts.busy||r.rifts.useBlock()!==null)return false;
      this.m3RiftTerrains ||= new WeakSet();
      if(this.m3RiftTerrains.has(r.terrain))return false;
      if(this.tap('incense',800)){
        this.m3RiftTerrains.add(r.terrain);
        this.status='通过原生熏香入口开启本关裂隙';return true;
      }
      return false;
    },
    chooseWorldTarget(r) {
      const timeObjective=typeof celebiMechanicTarget==='function'&&celebiMechanicTarget(r);
      if(timeObjective)return timeObjective;
      const shieldObjective=typeof mewtwoMechanicTarget==='function'&&mewtwoMechanicTarget(r);
      if(shieldObjective){
        const range=Math.min(shieldObjective.pylonObjective?3:Infinity,
            combatRange(r.player.moves,r.enemies.radius[shieldObjective.enemyIndex],r.player.stats)),
          point=this.combatPoint(r,shieldObjective.enemyIndex,range,shieldObjective.pylonObjective?'pylon':null);
        return {...shieldObjective,x:point.x,z:point.z,radius:.75,combatDistance:point.range,
          combatCoverage:point.coverage,bossBoundaryDetour:point.bossBoundaryDetour===true};
      }
      if(this.compatibility?.maintenanceScope?.allowRifts===true&&!this.flightState(r).noInteractions){
        const gate=r.rifts?.entrance;
        if(gate&&!r.rifts.busy&&r.rifts.enterBlock()===null&&this.interactionRules().free!==false)
          return {x:gate.x,z:gate.z,radius:1,id:gate,riftEntrance:true,label:'进入原生裂隙'};
        if(r.rifts?.inside?.phase==='won'){
          const reward=r.interactables.list.find(o=>o.kind==='freechest'&&!o.used&&this.worldInteractionAllowed(r,o));
          const entity=reward||r.interactables.list.find(o=>o.kind==='portal');
          if(entity)return {...this.interactionApproach(r,entity),id:entity,entity,
            interaction:this.worldInteractionDescription(r,entity),label:reward?'领取裂隙原生奖励':'返回原主地图'};
        }
      }
      if(this.compatibility?.maintenanceScope && !this.compatibility.maintenanceScope.allowRifts && r.rifts?.nearEntrance?.()) {
        const gate=r.rifts.entrance,pos=r.player.pos;
        if(Number.isFinite(gate?.x)&&Number.isFinite(gate?.z)) {
          const heading=Math.atan2(pos.z-gate.z,pos.x-gate.x);
          // Reviewed native nearEntrance radius is 3.4. Move outside it
          // through the existing terrain navigation, without pressing E.
          for(const offset of [0,Math.PI/2,-Math.PI/2,Math.PI]) {
            const x=gate.x+Math.cos(heading+offset)*5.4,z=gate.z+Math.sin(heading+offset)*5.4;
            const length=Math.hypot(x-pos.x,z-pos.z);
            if(!length || !this.walkRoute(r,pos,(x-pos.x)/length,(z-pos.z)/length,length))continue;
            return {x,z,radius:.5,id:"rift-entrance-exit",riftAvoidance:true,label:"绕开可选裂隙入口"};
          }
        }
        this.stop("裂隙入口暂时没有已确认的离开路线，请在原生地图移动后继续辅助",{source:"native-route-required",code:"rift-entrance-blocked"});
        return {x:pos.x,z:pos.z,radius:1,id:"rift-entrance-wait",riftAvoidance:true,label:"等待离开裂隙入口"};
      }
      const flight=this.flightState(r);
      this.ultimateClusterPlan=null;
      if(flight.noInteractions)return (!flight.active&&this.cataclysmTarget(r))||
        (flight.active?this.flightTravelTarget(r):this.broadTravelTarget(r))||{x:r.player.pos.x,z:r.player.pos.z,
          radius:1,id:"travel-wait",broadTravel:true,flightTravel:flight.active,exploration:true,label:"移动巡航 · 等待合法路线"};
      let target=this.interactionTracker.withSynchronized(r,()=>this.chooseSynchronizedWorldTarget(r));
      if(flight.keepInteractions)target=this.chooseFlightInteractionTarget(r,target);
      else this.flightInteractionScope=null;
      const clustered=this.towerUltimateTarget(r,target);
      if(clustered?.ultimateCluster||this.ultimateClusterPlan?.phase==="cast")return clustered;
      const growthAllowed=this.growthTravelAllowed(r,target);
      if(flight.active&&target?.routinePickup){
        const collection=this.flightCollectionState(r);
        if(target.flightCollectionRequested&&(!flight.orbitActive||target.flightCollectionImportant)&&
            (!this.growthRecovery(r)||growthAllowed||target.flightCollectionImportant)){
          if(!target.flightCollectionImportant&&(!collection.commit||collection.commit.id!==target.id)){
            const speed=Math.max(.3,6.3*(Number(r.player.stats?.moveSpeed)||1)),
              landing=flightLandingPlan(r.player,target,r.terrain,speed),remaining=distance(r.player.pos,target);
            collection.commit={id:target.id,index:target.pickupIndex,kind:target.pickupKind,x:target.x,z:target.z,
              bestDistance:remaining,progressAt:r.time,deadline:r.time+Math.min(60,Math.max(12,remaining/speed*2+landing.fallSeconds+4))};
          }
          return target;
        }
      }
      if(!flight.orbitActive&&growthAllowed&&(target?.routinePickup||/^enemy\d+$/.test(String(target?.id))))
        return {...target,travelGrowth:true};
      const important=target&&(target.entity&&r.interactables.list.includes(target.entity)||target.captureSource||target.cooperativeRescue||target.timedCombat||
        target.goalForesight||target.achievementMechanic||target.masteryExposure||target.characterPractice||target.towerCandle||
        target.id==="quest-time"||/^cataclysm-/.test(String(target.id))||
        target.pickupKind===6&&this.settings.pickupBonkoin===true||target.pickupKind===2&&r.player.hp/r.player.maxHp<.8),
        routine=target&&!important&&(target.exploration||target.routinePickup||/^enemy\d+$/.test(String(target.id))||
          ["idle","bossfight"].includes(target.id));
      if(!routine){this.orbitTravelPlanner?.pause(r);return target;}
      return (flight.active?this.flightTravelTarget(r):this.broadTravelTarget(r))||target;
    },
    towerUltimateTarget(r,target) {
      const enabled=this.settings.modeSettings?.tower?.aggressiveUltimate===true,
        critical=target?.interaction||r.interactables?.list?.includes(target?.entity)||target?.captureSource||target?.timedCombat||target?.cooperativeRescue||
          target?.healingPickup||["cataclysm-cover","cooperative-portal-escape"].includes(target?.id);
      if(critical||typeof planTowerUltimateCluster!=="function")return target;
      const plan=planTowerUltimateCluster(r,{enabled,history:this.ultimateClusterHistory,
        autoUlt:this.app.meta.profile.settings.autoUlt,
        routeAllowed:point=>{
          if(!this.withinArena(r,point.x,point.z,4)||!this.candleRouteAllowed(r,r.player.pos,point))return false;
          const d=distance(r.player.pos,point);
          return d<.1||this.walkRoute(r,r.player.pos,(point.x-r.player.pos.x)/d,(point.z-r.player.pos.z)/d,d);
        }});
      this.ultimateClusterHistory=plan.nextHistory;
      this.ultimateClusterPlan=plan.phase==="off"&&plan.reason==="ordinary-ultimate-policy"?null:plan;
      if(plan.phase!=="approach")return target;
      return {...(plan.boss?target:{}),...plan.target,id:plan.boss?"bossfight":"ultimate-cluster",ultimateCluster:true,enemyIndex:plan.boss?.index??null,
        flightTravel:this.flightState(r).active,label:"终结技择位",moving:true};
    },
    flightState(r=this.app?.run) {
      return nativeFlightState(r,this.settings);
    },
    invalidateTravelModeMotion() {
      clearNativeContactEnvelopes(this.run||this.app?.run);
      this.broadTravelPlanner=null;this.orbitTravelPlanner=null;this.travelProgressTracker=null;
      this.travelBreakoutState=null;this.travelModeScope=null;this.growthTravelScope=null;this.target=null;this.navTarget=null;this.routeObservation=null;
      this.invalidateFlightInteractionMotion();this.withdrawTravelInteractionInput();
      this.cadence?.reset("timed-movement-settings-changed");this.previous={x:0,z:0};
    },
    withdrawTravelInteractionInput() {
      this.releaseCooperativeRescueInput();
      const code=this.code("interact"),input=this.run?.input||this.app?.run?.input;
      if(this.held.has(code))this.key(code,false);
      if(this.pendingTapCodes.has(code)){
        const logical=typeof input?.canon==="function"?input.canon(code):code;
        input?.pressed?.delete?.(logical);this.pendingTapCodes.delete(code);
      }
    },
    syncTravelModeMotion(r) {
      const flight=this.flightState(r),previous=this.travelModeScope,account=this.app?.meta?.account,
        same=previous?.run===r&&previous.stage===r.stage&&previous.terrain===r.terrain&&previous.account===account&&previous.epoch===this.controlEpoch;
      if(previous&&!same||same&&(previous.active!==flight.active||previous.noInteractions!==flight.noInteractions||previous.orbitActive!==flight.orbitActive)||
          !previous&&(flight.timedNoInteractions||flight.orbitActive)){
        this.target=null;this.navTarget=null;this.routeObservation=null;this.lastWorld=-Infinity;
        this.invalidateFlightInteractionMotion();this.withdrawTravelInteractionInput();
        this.cadence?.reset("native-timed-movement-boundary");
        if(previous&&!same){clearNativeContactEnvelopes(previous.run);this.broadTravelPlanner=null;this.orbitTravelPlanner=null;this.travelProgressTracker=null;}
      }
      this.travelModeScope={run:r,stage:r.stage,terrain:r.terrain,account,epoch:this.controlEpoch,
        active:flight.active,noInteractions:flight.noInteractions,orbitActive:flight.orbitActive};
      return flight;
    },
    growthTravelAllowed(r,target) {
      const eligible=!this.flightState(r).orbitActive&&!!target&&(target.routinePickup||/^enemy\d+$/.test(String(target.id)))&&
        this.growthRecovery(r),scope=this.growthTravelScope;
      if(!scope||scope.run!==r||scope.stage!==r.stage||scope.terrain!==r.terrain)
        this.growthTravelScope={run:r,stage:r.stage,terrain:r.terrain,at:r.time,spent:0};
      const current=this.growthTravelScope,elapsed=Math.max(0,Math.min(.25,r.time-current.at));current.at=r.time;
      if(eligible&&r.state==="play")current.spent+=elapsed;
      return eligible&&current.spent<10&&this.travelBreakoutState?.active!==true;
    },
    travelRouteCost(r,from,to) {
      if(this.flightState(r).active)return 0;
      const en=r.enemies,dx=to.x-from.x,dz=to.z-from.z,length=Math.hypot(dx,dz)||1,reach=Math.min(length,36);
      let cost=0;for(let index=0;index<(en?.n||0);index++)if(en.alive[index]){
        const ox=en.x[index]-from.x,oz=en.z[index]-from.z,along=(ox*dx+oz*dz)/length;
        if(along<0||along>reach||Math.abs((en.y?.[index]||0)-from.y)>5)continue;
        const side=Math.abs(ox*dz-oz*dx)/length;cost+=Math.max(0,7-side)*.65;
      }return cost;
    },
    broadTravelTarget(r) {
      const planner=this.explorationPlanner,circles=nativeMovementCircles(r,4),
        bounded=circles.length>0;
      // A sanctuary can replace the arena on the SAME native Terrain object.
      // Revalidate ordinary stored goals instead of trusting the old world
      // waypoint, and use a circle-sized patrol while physically confined.
      // This retains broad movement; it does not enable the Boss-retreat mode.
      // chooseWorldTarget already observes a patrol once this native tick.
      // Re-observing it here would erase its just-published reachedGoal receipt
      // before the controller's recovery/macro diagnostics can see it.
      const observed=planner?.run===r&&planner.stage===r.stage&&planner.terrain===r.terrain&&planner.at===r.time,
        reusable=!bounded&&observed&&(planner.goal||planner.reachedGoal)&&
          (!planner.goal||this.withinArena(r,planner.goal.x,planner.goal.z,5));
      let target=reusable?planner.goal:planner?.choose(r,{eligible:!bounded,
        selected:this.target?.exploration===true&&this.target.id===planner?.goal?.id,
        withinBounds:(x,z,margin)=>this.withinArena(r,x,z,margin),routeCost:(from,to)=>this.travelRouteCost(r,from,to)});
      this.explorationState=planner?.state||null;
      if(!target){
        this.broadTravelPlanner ||=new FlightTravelPlanner();
        target=this.broadTravelPlanner.choose(r,{eligible:true,circles,
          withinBounds:(x,z,margin)=>this.withinArena(r,x,z,margin),
          pointAllowed:point=>this.flightRouteAllowed(r,[r.player.pos,point])&&this.candleRouteAllowed(r,r.player.pos,point),
          routeCost:(from,to)=>this.travelRouteCost(r,from,to)});
      }
      return target?{...target,flightTravel:false,broadTravel:true,exploration:true,label:"广域移动 · 前往地图远端"}:null;
    },
    invalidateFlightInteractionMotion() {
      this.flightInteractionScope=null;
      this.flightLandingScope=null;
      this.lastWorld=-Infinity;
    },
    flightInteractionGroundReady(r) {
      const p=r?.player,scope=this.flightInteractionScope;
      if(!p||p.grounded!==true||Math.abs(Number(p.vel?.y)||0)>.35)return false;
      const horizontal=Math.hypot(Number(p.vel?.x)||0,Number(p.vel?.z)||0),
        limit=Math.max(.8,6.3*(Number(p.stats?.moveSpeed)||1)*.25);
      return horizontal<=limit&&!!scope&&Number.isFinite(scope.groundedAt)&&r.time-scope.groundedAt>=.08;
    },
    flightInteractionInReach(r,target) {
      if(target?.cooperativeRescue)return this.nativeCooperativeRescuePeer(r)?.slot===target.cooperativeRescueSlot;
      if(target?.captureSource)return r.capture?.index===target.enemyIndex&&r.capture?.canThrow?.()===true||
        r.allies?.down===target.enemyIndex&&r.allies?.canThrow?.()===true&&!r.interactables.nearest;
      return !!target?.entity&&r.interactables.nearest===target.entity;
    },
    flightInteractionTargetValid(r,target) {
      if(!target)return false;
      if(target.cooperativeRescue)return this.cooperativeRescueTargets(r,this.tacticalState(r)).some(t=>
        t.cooperativeRescueSlot===target.cooperativeRescueSlot);
      if(target.captureSource){
        const opportunity=this.captureOpportunity(r,target.enemyIndex);
        return !!opportunity&&(target.captureGen==null||target.captureGen===opportunity.gen)&&
          this.capturePursuitAllowed(r,{index:target.enemyIndex,distance:distance(r.player.pos,target)});
      }
      return !!target.entity&&r.interactables.list.includes(target.entity)&&
        !isNativePassivePickup(target.entity)&&this.worldInteractionAllowed(r,target.entity);
    },
    chooseFlightInteractionTarget(r,candidate) {
      let scope=this.flightInteractionScope;
      const pos=r.player.pos,account=this.app?.meta?.account;
      if(scope&&(scope.run!==r||scope.stage!==r.stage||scope.terrain!==r.terrain||
          scope.epoch!==this.controlEpoch||scope.account!==account||
          !this.flightInteractionTargetValid(r,scope.target))){this.flightInteractionScope=null;scope=null;}
      if(scope){
        const remaining=distance(pos,scope.target),height=pos.y-r.terrain.height(pos.x,pos.z);
        if(remaining<scope.bestDistance-.2||height<scope.height-.25){scope.progressAt=r.time;scope.bestDistance=remaining;scope.height=height;}
        const expired=r.time>scope.deadline||r.time-scope.progressAt>Math.max(16,scope.fallSeconds+5);
        if(expired){
          if(scope.target.entity)this.interactionTracker.suppress(r,scope.target.entity,{seconds:8,reason:"flight-interaction-no-progress"});
          this.flightInteractionScope=null;scope=null;
        }
      }
      const emergency=candidate&&(/^cataclysm-/.test(String(candidate.id))||
        candidate.cooperativePortalEscape===true||candidate.emergency===true),
        higher=scope&&candidate&&Number(candidate.priorityBand)>Number(scope.target.priorityBand),
        executable=this.flightInteractionTargetValid(r,candidate);
      if(emergency)return candidate;
      if(scope&&higher&&!executable)return candidate;
      if(executable&&(!scope||higher)){
        const speed=Math.max(.3,6.3*(Number(r.player.stats?.moveSpeed)||1)),
          landing=flightLandingPlan(r.player,candidate,r.terrain,speed),remaining=distance(pos,candidate);
        scope=this.flightInteractionScope={run:r,stage:r.stage,terrain:r.terrain,epoch:this.controlEpoch,account,
          target:candidate,bestDistance:remaining,height:landing.height,progressAt:r.time,
          fallSeconds:landing.fallSeconds,deadline:r.time+Math.min(180,Math.max(20,remaining/speed*2+landing.fallSeconds*2+12))};
      }
      if(!scope)return candidate;
      if(candidate?.id===scope.target.id)scope.target=candidate;
      let target={...scope.target,flightInteraction:true};
      if(target.entity&&r.interactables.list.includes(target.entity))
        Object.assign(target,interactionApproachGeometry(this.interactionApproach(r,target.entity)));
      else if(Number.isInteger(target.enemyIndex)){
        const index=target.enemyIndex;
        if(this.flightInteractionInReach(r,target))Object.assign(target,{x:r.enemies.x[index],z:r.enemies.z[index]});
      }
      if(r.player.grounded===true){if(!Number.isFinite(scope.groundedAt))scope.groundedAt=r.time;}
      else scope.groundedAt=null;
      scope.target=target;
      return target;
    },
    flightCollectionState(r) {
      const scope=this.flightCollectionScope;
      if(!scope||scope.run!==r||scope.stage!==r.stage||scope.terrain!==r.terrain)
        this.flightCollectionScope={run:r,stage:r.stage,terrain:r.terrain,at:r.time};
      const current=this.flightCollectionScope,commit=current.commit,loot=r.pickups;
      if(commit){
        const remaining=distance(r.player.pos,commit);
        if(remaining<commit.bestDistance-.25){commit.bestDistance=remaining;commit.progressAt=r.time;}
        if(!loot?.alive?.[commit.index]||loot.attract?.[commit.index]||loot.kind?.[commit.index]!==commit.kind||
            Math.hypot(loot.x?.[commit.index]-commit.x,loot.z?.[commit.index]-commit.z)>.5||
            r.time>=commit.deadline||r.time-commit.progressAt>12)current.commit=null;
      }
      current.window=Math.max(0,r.time-current.at)%28>=20;
      return current;
    },
    flightTravelTarget(r) {
      const flight=this.flightState(r);
      if(flight.orbitActive)this.orbitTravelPlanner ||= new FlightTravelPlanner();
      else this.flightTravelPlanner ||= new FlightTravelPlanner();
      return (flight.orbitActive?this.orbitTravelPlanner:this.flightTravelPlanner).choose(r,{eligible:flight.active,orbit:flight.orbitActive,
        circles:nativeMovementCircles(r,4),
        withinBounds:(x,z,margin)=>this.withinArena(r,x,z,margin),
        pointAllowed:point=>this.flightRouteAllowed(r,[r.player.pos,point])});
    },
    flightRouteAllowed(r,path) {
      const flight=this.flightState(r);
      if(!flight.noInteractions&&!flight.keepInteractions)return true;
      // Walking into a cooperative portal or the top of a native stair ramp
      // can advance without E. Avoid those automatic triggers as well.
      const objects=(r.interactables?.list||[]).filter(o=>o.kind==="portal"||
        o.kind==="tower"&&["stairs","portal","leave"].includes(o.data?.sub)).filter(object=>
          flight.noInteractions||this.flightInteractionScope?.target?.entity!==object||r.player.grounded!==true);
      return path.every((point,index)=>index===0||objects.every(object=>{
        const from=path[index-1],dx=point.x-from.x,dz=point.z-from.z,
          ox=from.x-object.x,oz=from.z-object.z,before=Math.hypot(ox,oz),
          after=distance(point,object),radius=(Number(object.r)||2.6)+3,
          length2=dx*dx+dz*dz,projection=length2?Math.max(0,Math.min(1,-(ox*dx+oz*dz)/length2)):0,
          closest=Math.hypot(ox+dx*projection,oz+dz*projection);
        if(before<radius)return after>before+.001&&ox*dx+oz*dz>=-.00001;
        return closest>=radius;
      }));
    },
    chooseSynchronizedWorldTarget(r) {
      this.syncCapturePursuits(r);
      const coverTarget = !this.flightState(r).active&&this.cataclysmTarget(r);
      if (coverTarget) return coverTarget;
      const portalEscape=this.cooperativePortalEscapeTarget(r);
      if(portalEscape)return portalEscape;
      const p = r.player,
        pos = p.pos,
        worldEntities = new Set(r.interactables.list),
        candidates = [],
        now = r.time,
        finiteTowerClear = !!r.tower && this.tacticalDirector.finiteResourcePhase(r),
        growthNeeded = this.growthRecovery(r),mastery=this.masteryState(r),completion=this.completionGoalState(r,mastery),
        camp=this.leaderboardCampState(r),campHolding=camp?.kind==="kills"&&camp.holding;
      // Expired route cooldowns already permit reselection. Drop their keys as
      // well, so removed native landmarks cannot remain rooted for an entire run.
      for(const [id,until] of this.blocked)if(!(until>now))this.blocked.delete(id);
      const tactical = this.tacticalState(r);
      const cleanup = this.towerFloorCleanup(r, worldEntities);
      const flight=this.flightState(r),flightCollection=flight.active&&!flight.noInteractions?this.flightCollectionState(r):null,
        flightFunding=flightCollection&&this.interactionRules().paid!==false&&(r.interactables?.list||[]).some(object=>!object.used&&
          ["chest","cage","meowth"].includes(object.kind)&&Number(this.worldInteractionCost(r,object))>Number(r.gold));
      this.unknownInteractions = [...new Set(r.interactables.list.flatMap(object =>
        !nativeInteractionKinds.includes(object.kind) && !isNativePassivePickup(object) ? [object.kind] : object.kind === "tower" &&
          !["stairs","altar","trick","portal","leave"].includes(object.data?.sub) ? ["tower:"+String(object.data?.sub||"unknown")] : []))];
      const add = (entity, score, label, radius = 1.5, id = entity) => {
        const collectionImportant=!!flightCollection&&entity.routinePickup&&
          (entity.pickupKind===4||entity.xpPickup&&growthNeeded||entity.pickupKind===1&&flightFunding),
          collectionRequested=!!flightCollection&&entity.routinePickup&&
            (collectionImportant||flightCollection.window||flightCollection.commit?.id===id);
        if(collectionRequested)score+=700+(flightCollection.commit?.id===id?100:0);
        const pursuit = Number.isInteger(entity.enemyIndex) && entity.captureSource
          ? this.captureOpportunity(r, entity.enemyIndex) : null;
        if (
          id !== "bossfight" &&
          !pursuit &&
          !entity.timedCombat &&
          this.blocked.get(id) > now
        )
          return;
        const d = distance(pos, entity);
        const interaction = worldEntities.has(entity)
          ? this.worldInteractionDescription(r, entity, worldEntities) : null;
        const towerExit = entity.kind === "tower" && ["stairs", "leave", "portal"].includes(entity.data?.sub);
        const trickGoal = entity.kind === "tower" && entity.data?.sub === "trick" && this.towerTrickRequested(r);
        const mandatory = ["portal", "boss", "shrine"].includes(entity.kind) || towerExit || trickGoal || entity.cooperativeRescue ||
          ["bossfight", "capture", "captureRoam", "ally", "endless-relocate"].includes(id) ||
          /^(shiny-|alpha-)/.test(String(id));
        // A stationary pickup whose entire arrival disk lies inside a no-light
        // trigger is unavailable under that explicit preference. Do not feed
        // an impossible centre to A* or downgrade a required capture/exit.
        if (r.tower && entity.loot && !mandatory && !entity.moving &&
            !towerCandleGoalAllowed(r, entity, radius, this.towerPolicy(r).avoidCandles)) return;
        const emergencyHeal = p.hp / p.maxHp < 0.45 &&
          (entity.kind === "berry" || entity.healingPickup);
        const nearFree = interaction?.free && (d < 4 ||
          entity.kind === "altar" && entity.charge > 0);
        const growthBand = growthNeeded
          ? entity.xpPickup ? 2.6 : String(id).startsWith("enemy") ? 2.5 : 0
          : 0;
        const approach = !flight.active&&!mandatory && (interaction || entity.loot)
          ? resourceApproachDecision(r, entity, tactical) : null;
        if (approach?.eligible === false) return;
        const usableApproach = worldEntities.has(entity)
          ? interactionApproachGeometry(this.interactionApproach(r, entity)) : null;
        const captureCandidate=["capture","captureRoam","ally"].includes(id) || String(id).startsWith("alpha-");
        const missingCapture=captureCandidate && Number.isInteger(entity.enemyIndex) &&
          !this.app.meta.inLeague(r.enemies.species[entity.enemyIndex]);
        const collectionWindow = r.stageCleared && this.progressionDecision &&
          !this.progressionDecision.leaveStage && !this.progressionDecision.forceLeave,
          usefulPaid = interaction?.paid && ["chest","cage","meowth"].includes(entity.kind),
          wealthy = Number(r.gold) >= Math.max(50, (Number(interaction?.cost) || 0) * 3),
          availableSince = usefulPaid ? this.interactionTracker.inspect(r,entity)?.eligibleSince : null,
          waited = Number.isFinite(availableSince) && r.time - availableSince >= 12,
          resourceBand = interaction && !growthNeeded && (flight.active||tactical.hpRatio >= .45 && tactical.pressure < 3)
            ? collectionWindow && (interaction.free || usefulPaid) ? interaction.free ? 2.9 : 2.85
              : usefulPaid && (wealthy || waited) ? 2.65
                : interaction.free && wealthy ? 2.7 : 0 : 0;
        candidates.push({
          ...entity,
          entity,
          ...(entity.routinePickup?{flightCollectionRequested:collectionRequested,flightCollectionImportant:collectionImportant}:{}),
          score: score * (approach?.utilityFactor ?? 1) / (1 + d * 0.08),
          label,
          radius,
          ...usableApproach,
          id,
          interaction,
          approach,
          ...(pursuit ? { captureGen:pursuit.gen, captureState:pursuit.state,
            captureRemaining:pursuit.remaining, captureDeadlineAt:pursuit.deadlineAt,
            captureDeadlineKind:pursuit.deadlineKind } : {}),
        priorityBand: String(id).startsWith("shiny-") && (this.settings.shinyPriority !== false ||
            !this.executedShinyTypes() && entity.captureClassic && this.plan?.classicTargetIds?.includes(pursuit?.species)) ? 5 :
            captureCandidate && !entity.captureShiny &&
              this.settings.capturePriority !== false ? entity.captureWindow ? 4.975 :
                pursuit?.remaining != null ? 4.96 : missingCapture ? 4.95 : 4.9 :
            entity.goalForesight ? 4.87 :
            cleanup?.pending && emergencyHeal ? 4.86 :
            r.tower && entity.kind === "bill" && this.finalReplacement(r).needsFusion ? 4.855 :
            entity.achievementMechanic ? 4.7 :
            interaction?.cost&&interaction.forceCostInteractions===true ? this.costWorldPriority(r) :
            entity.masteryExposure ? 3.65 :
            entity.characterPractice ? 2.8 :
            entity.towerCandle ? entity.candlePriority :
            entity.kind === "tower" && entity.data?.sub === "altar" ? 4.85 :
            trickGoal ? 4.84 :
            cleanup?.rewards.has(entity) ? (interaction?.free ? 4.83 : 4.82) :
            cleanup?.pending && entity.xpPickup ? 4.81 :
            entity.cooperativeRescue ? 4.86 :
            (entity.kind === "portal" || towerExit) && this.progressionDecision?.forceLeave ? 4.855 :
            entity.kind === "bonk" && this.settings.pickupBonkoin === true ? this.progressionDecision?.forceLeave ? 2.9 : 4.82 :
            (entity.kind === "portal" || towerExit) && this.settings.portalPriority !== false ? 4.8 :
            ["boss", "shrine"].includes(entity.kind) && this.settings.bossPriority !== false ? 4.6 :
            entity.kind === "hypno" && this.finalReplacement(r).needsTutor ? 4.55 :
            entity.kind === "bill" && this.finalReplacement(r).needsFusion ? 4.55 :
            entity.kind === "meowth" && this.settings.shopPriority === true && this.priorityShopState(r)?.active ? 4.4 :
            entity.kind === "portal" && this.progressionDecision?.forceLeave ? 4 :
            ["boss", "shrine"].includes(entity.kind) && (this.progressionDecision?.forceBoss || r.stageTime >= (this.progressionDecision?.bossDeadline ?? Infinity) + 20) ? 3.6 :
            entity.timedCombat ? 3.4 : emergencyHeal ? 3.2 : mandatory ? 3 : nearFree ? 2.7 :
            entity.exploration ? entity.explorationPriority :
            Math.max(growthBand, resourceBand, collectionRequested?2.75:0, interaction?.priorityBand ?? (entity.loot ? 2 : 0)),
        });
      };
      const en = r.enemies;
      const observedShiny =
        typeof examineShinyTarget === "function"
          ? examineShinyTarget(r, {
              ...this.plan,
              owned: this.app.meta.profile.shinies || [],
              shinyTypes:this.executedShinyTypes(),
            })
          : null;
      const shinySource = observedShiny && r.capture?.index === observedShiny.index &&
        ["roaming", "weakened", "throwing"].includes(r.capture.state) ? "capture" :
        observedShiny && r.allies?.state === "down" && r.allies.down === observedShiny.index ? "ally" : "shiny";
      const shiny = observedShiny ? { ...observedShiny, source: shinySource,
        ...(shinySource === "ally" ? { kind: "capture", captureState: "down" } : {}) } : null;
      if (shiny && shiny.captureState !== "throwing" && this.capturePursuitAllowed(r, shiny)) {
        // An expiring capture always outranks portals and ordinary encounters.
        // The target is not distance-discounted, so distant shinies stay visible.
        const range = Math.min(7, combatRange(p.moves, en.radius[shiny.index], p.stats));
        const d = shiny.distance || 1;
        const point = shiny.kind === "capture" ?
          shiny.source === "ally" ? this.allyThrowApproach(r, shiny.index) :
            this.nativeCooperativeRescuePeer(r)?this.allyThrowApproach(r,shiny.index,true):
              { x: shiny.x, z: shiny.z, radius: 5 } :
          { x: shiny.x + ((pos.x - shiny.x) / d) * range,
            z: shiny.z + ((pos.z - shiny.z) / d) * range };
        add({
          ...point,
          y: shiny.y,
          moving: true,
          enemyIndex: shiny.index,
          captureSource: shiny.source,
          captureShiny: shiny.shiny === true,
          captureClassic: shiny.classic === true,
          captureWindow: shiny.kind === "capture",
          ...(shiny.kind !== "capture" ? { captureCombatRange: range } : {}),
        }, shiny.priority, `${shiny.kind === "capture" ? "投球捕获" : "追踪削弱"}${shiny.classic ? "经典异色" : "异色"}${this.shinyName(shiny.species)}`,
          shiny.kind === "capture" ? point.radius || 5 : 0.6, `shiny-${shiny.index}`);
      }
      if (
        !this.preserveShinyOpportunity(r) && this.shinyHuntCaptureAllowed(r,this.captureOpportunity(r,r.capture.index)||r.capture) &&
        r.capture.state === "roaming" &&
        en.alive[r.capture.index] &&
        this.capturePursuitAllowed(r, { source: "capture", index: r.capture.index,
          species: en.species[r.capture.index], captureState: r.capture.state,
          distance: Math.hypot(pos.x - en.x[r.capture.index], pos.z - en.z[r.capture.index]) })
      ) {
        const i = r.capture.index, d = Math.hypot(pos.x - en.x[i], pos.z - en.z[i]) || 1;
        const range = Math.min(8, combatRange(p.moves, 0, p.stats));
        add(
          {
            x: en.x[i] + ((pos.x - en.x[i]) / d) * range,
            y: en.y[i],
            z: en.z[i] + ((pos.z - en.z[i]) / d) * range,
            moving: true,
            enemyIndex: i,
            captureSource: "capture",
            captureShiny: !!r.capture.shiny || !!(en.flags[i] & 2048),
            captureCombatRange: range,
          },
          this.plan?.priority === "开图鉴"
            ? 50000
            : this.plan?.priority === "开新图"
              ? 300
              : 8500,
          "追踪可加入联盟的宝可梦",
          0.6,
          "captureRoam",
        );
      }
      if (!this.preserveShinyOpportunity(r) && this.shinyHuntCaptureAllowed(r,this.captureOpportunity(r,r.capture.index)||r.capture) && r.capture.state === "weakened" &&
          this.capturePursuitAllowed(r, { source: "capture", index: r.capture.index,
            species: en.species[r.capture.index], captureState: r.capture.state,
            distance: Math.hypot(pos.x - en.x[r.capture.index], pos.z - en.z[r.capture.index]) })) {
        const i = r.capture.index,point=this.nativeCooperativeRescuePeer(r)?this.allyThrowApproach(r,i,true):{x:en.x[i],z:en.z[i],radius:5};
        add(
          { ...point, moving: true, enemyIndex: i, captureSource: "capture", captureWindow: true,
            captureShiny: !!r.capture.shiny || !!(en.flags[i] & 2048) },
          20000,
          "捕捉宝可梦",
          point.radius || 5,
          "capture",
        );
      }
      if (r.allies.state === "down" && this.shinyHuntCaptureAllowed(r,this.captureOpportunity(r,r.allies.down)) && this.capturePursuitAllowed(r, { source: "ally", index: r.allies.down,
          species: en.species[r.allies.down], captureState: "down",
          distance: Math.hypot(pos.x - en.x[r.allies.down], pos.z - en.z[r.allies.down]) })) {
        const i = r.allies.down;
        const point = this.allyThrowApproach(r, i);
        add(
          { ...point, moving: true, enemyIndex: i, captureSource: "ally", captureWindow: true,
            captureShiny: !!(en.flags[i] & 2048) },
          15000,
          "捕捉支援阿尔法",
          point.radius || 5,
          "ally",
        );
      }
      if (r.boss.alive&&!campHolding) {
        const i = r.boss.bossIndex;
        const range = this.settings.bossRetreat===true ? 0 : Math.max(
          combatRange(p.moves, en.radius[i], p.stats),
          en.radius[i] + (p.radius || 0.55) + 2,
        );
        const point = this.combatPoint(r, i, range);
        add(
          {
            x: point.x,
            z: point.z,
            moving: true,
            enemyIndex: i,
            combatDistance: point.range,
            combatCoverage: point.coverage,
            combatDistanceReason: point.rangeReason,
            bossBoundaryDetour:point.bossBoundaryDetour===true,
          },
          12000,
          this.settings.bossRetreat===true ? "保持距离避让守护者" : "守护者战斗",
          1,
          "bossfight",
        );
      }
      const mechanic=!flight.active&&typeof achievementMechanicTarget==="function"&&this.goalInteractionScopeCurrent(r)?achievementMechanicTarget(r,this.plan?.goalInteraction):null;
      if(mechanic)add({...mechanic,achievementMechanic:true},16500,mechanic.label,mechanic.radius,mechanic.id);
      const foresight=flight.active?null:this.foresightEnemy(r);
      if(foresight!==null)add({x:en.x[foresight],z:en.z[foresight],moving:true,enemyIndex:foresight,
        goalForesight:true,foresightGen:en.gen?.[foresight]},28000,
        "明确成就目标：靠近真实胡地承受其原生攻击，等待游戏自然判定；其他敌人仍正常避让",.2,`foresight:${foresight}`);
      for (const rescue of this.cooperativeRescueTargets(r,tactical))
        add(rescue,40000,"靠近并持续交互救起队友",rescue.radius,rescue.id);
      {
        let contact=null;
        for(let i=0;!flight.active&&mastery.exposure?.healthBudget>0&&!mastery.invalidFinal&&!completion.retryNextRun&&i<en.n;i++) {
          if(!en.alive[i]||en.dying[i]>0||en.flags[i]&4||i===r.capture.index&&["weakened","throwing"].includes(r.capture.state)||
            i===r.allies.down&&["down","throwing"].includes(r.allies.state))continue;
          const damage=typeof nativeContactDamageUpperBound==="function"?nativeContactDamageUpperBound(r,i):null,
            distanceTo=Math.hypot(pos.x-en.x[i],pos.z-en.z[i]);
          if(!Number.isFinite(damage)||damage<=0||damage>mastery.exposure.healthBudget||distanceTo>35||
            typeof nativeEnemyControlActive==="function"&&nativeEnemyControlActive(r,i,.2))continue;
          if(!contact||damage<contact.damage||damage===contact.damage&&distanceTo<contact.distance)
            contact={i,damage,distance:distanceTo};
        }
        if(this.goalExposureAllowed(r,contact,mastery,tactical))add({x:en.x[contact.i],z:en.z[contact.i],moving:true,enemyIndex:contact.i,
          masteryExposure:{...mastery.exposure},radius:Math.max(.3,Number(en.radius[contact.i])||.5)},18000,
          mastery.needsLowHp?"专属挑战：以已知非致命接触接近要求的终局生命，随后恢复避伤":"专属挑战：累积原生受击次数，保持生命储备",.3,`mastery-contact:${contact.i}:${en.gen?.[contact.i]??0}`);
      }
      const levelGoal = [0, 14, 26, 36, 36][r.stage] || 36;
      const speedrun = this.plan?.objective === "time" || mastery.hurry;
      const killsRun = this.plan?.objective === "kills";
      const goalWaiting = this.goalStageHold(r);
      const shinyWaiting = this.shinyHoldStage(r);
      const classicWaiting = !!this.plan?.classicTargetIds?.length && goalWaiting;
      const limits = this.plan?.runThresholds || {};
      const thresholdPending =
        this.plan?.automatable !== false &&
        r.stage >= 3 &&
        r.time < Math.max(1800, (limits.minTime || 0) * 1.1) &&
        (r.stats.kills < (limits.minKills || 0) ||
          p.level < (limits.minLevel || 0) ||
          (r.stats.evolutions || 0) < (limits.minEvolutions || 0) ||
          Object.entries(limits.counters || {}).some(
            ([key, goal]) =>
              (r.stats[key] ??
                (this.app.meta.profile.counters[key] || 0) -
                  (this.app.meta.snap?.counters?.[key] || 0)) < goal,
          ));
      if (r.regionCleared && (completion.waitTime || completion.holdFinish && !mastery.exposure) &&
          !this.priorityCapturePending(r) && !this.finalRewardCleanupState(r).holding)
        return {
          x: pos.x,
          z: pos.z,
          radius: 1,
          id: "quest-time",
          label: "终局已击败，安全等待委托时间",
        };
      if (r.stageCleared && this.clearNotice?.stage !== r.stage)
        this.clearNotice = { stage: r.stage, time: r.stageTime };
      const nearbyValuableLoot = r.interactables.list.some(
        (o) =>
          ["freechest", "ditto", "snorlax", "chest", "cage", "meowth", "bonk"].includes(o.kind) &&
          (!o.used || nativeInteractionRepeatable(o)) &&
          distance(pos, o) < 80 &&
          this.worldInteractionAllowed(r, o, worldEntities),
      );
      const progression = this.tacticalDirector.progression(r, tactical, {
        safeMode: this.settings.safeMode, nearbyValuable: nearbyValuableLoot,
        shinyHold: shinyWaiting || classicWaiting, questHold: thresholdPending, minTime: limits.minTime,
        collectBonkoin: this.settings.pickupBonkoin === true,
      });
      this.progressionDecision = progression;
      if(completion.retryNextRun)progression.goalCompletion={retryNextRun:true,reason:completion.reason};
      const readyBoss = mastery.hurry || this.settings.bossPriority !== false || progression.summonBoss || !!r.sanctuary;
      const readyToLeave = !completion.holdFinish && !progression.settlingDrops &&
        (mastery.hurry || this.settings.portalPriority !== false || progression.leaveStage || progression.forceLeave);
      const capturePending = this.priorityCapturePending(r);
      for (const obj of r.interactables.list) {
        if (cleanup?.skipped.has(obj)) continue;
        if (obj.used && !nativeInteractionRepeatable(obj)) continue;
        if (!this.worldInteractionAllowed(r, obj, worldEntities)) continue;
        // The native complete list is already available; opening M adds no
        // information and unnecessarily pauses the match.
        const d = distance(pos, obj);
        if (capturePending && (obj.kind === "portal" || obj.kind === "tower" &&
            ["stairs", "portal", "leave"].includes(obj.data?.sub))) continue;
        let score = 0;
        if (
          obj.kind === "portal" &&
          !classicWaiting &&
          (!shinyWaiting || progression.forceLeave || this.settings.portalPriority !== false) &&
          (r.endless || readyToLeave) &&
          (r.endless
            ? r.endless.portal === obj && r.endless.portalLeft > 0
            : r.stageCleared)
        )
          score = 50000;
        else if (
          ["boss", "shrine"].includes(obj.kind) &&
          !r.bossSpawned && !goalWaiting &&
          readyBoss &&
          (!shinyWaiting || r.stageTime >= progression.bossDeadline || this.settings.bossPriority !== false) &&
          (!thresholdPending || r.stageTime >= progression.bossDeadline || this.settings.bossPriority !== false)
        )
          score = 5000;
        else if (obj.kind === "altar" && !obj.data?.sealed)
          score =
            obj.charge > 0
              ? 1200
              : obj.data?.comet && obj.data.life > distance(pos, obj) / 5
                ? 1800
                : 280;
        else if (obj.kind === "challenge" && this.challengeReady(r, tactical)) score = 420;
        else if (["cursed", "cursedchest", "greed"].includes(obj.kind)) score = obj.kind === "greed" ? 200 : 650;
        else if (obj.kind === "freechest")
          score = r.boss.alive && d < 7 ? 17000 : 1000;
        else if (
          obj.kind === "chest" &&
          (obj.data?.gift || r.gold >= r.interactables.chestCost())
        )
          score = obj.data?.gift ? 950 : 650;
        else if (obj.kind === "ditto")
          score = r.boss.alive && d < 6 ? 17500 : 1400;
        else if (obj.kind === "snorlax")
          score = r.boss.alive && d < 6 ? 16500 : 1100;
        else if (obj.kind === "meowth") score = 600;
        else if (obj.kind === "bonk" && this.settings.pickupBonkoin === true) score = 22000;
        else if (obj.kind === "slots") score = this.goalWorldInteraction(r,"slots")?2400:280;
        else if (obj.kind === "hypno") score = this.finalReplacement(r).needsTutor ? 1600 : 420;
        else if (obj.kind === "nest") score = 950;
        else if (obj.kind === "bill") score = this.finalReplacement(r).needsFusion ? 1800 : 1200;
        else if (["fossil", "porygon"].includes(obj.kind)) score = 450;
        else if (obj.kind === "rhydon") score = this.goalWorldInteraction(r,"rhydon")?18000:200;
        else if (obj.kind === "tower") score = ({stairs:50000,altar:1800,trick:850,portal:50000,leave:45000})[obj.data?.sub] || 0;
        else if (obj.kind === "berry" && (this.goalMetricPending(r,'berries')||!mastery.avoidHealing && p.hp / p.maxHp < 0.95))
          score = this.goalMetricPending(r,'berries')?1100:p.hp / p.maxHp < 0.63 ? 1800 : 380;
        else if (obj.kind === "rock")
          score = this.goalMetricPending(r,'rocks') ? 800 : 220;
        else if (obj.kind === "cage" && r.gold >= r.interactables.cageCost())
          score = this.plan?.priority === "开图鉴" ? 950 : 650;
        else if (obj.kind === "magnet" && r.pickups.count > 30) score = 500;
        if (score)
          if (
            this.settings.safeMode !== false &&
            p.hp / p.maxHp < 0.3 &&
            ["altar", "boss", "shrine"].includes(obj.kind) &&
            !((progression.forceBoss || this.settings.bossPriority !== false) && ["boss", "shrine"].includes(obj.kind))
          )
            continue;
        if (score)
          add(
            obj,
            score,
            {
              altar: "祭坛祝福",
              chest: "打开道具球",
              freechest: "免费道具球",
              boss: "挑战守护者",
              shrine: "圣地首领",
              portal: "进入下一地区",
              rock: "获取金币",
              cage: "救援与图鉴研究",
              bonk: "优先拾取邦币",
              berry: "回复生命",
              magnet: "收集经验",
              ditto: "百变怪免费复制道具",
              snorlax: "获取卡比兽奖励",
              meowth: "购买合适的道具",
              slots: "评估原生抽奖",
              hypno: this.finalReplacement(r).needsTutor ? "最终配装：前往原生遗忘NPC调整招式与维生素" : "调整招式空位",
              nest: "获取原生孵化蛋",
              bill: this.finalReplacement(r).needsFusion ? "最终融合招式：前往正辉的机器" : "评估原生招式融合",
              fossil: "已授权：评估化石永久生命代价",
              porygon: "已授权：评估多边兽属性交换",
              rhydon: "已授权：强化守护者换额外奖励",
              tower: ({stairs:"进入下一塔层",altar:"领取通关塔层祝福",trick:this.towerTrickRequested(r) ? "墓碑：选择捣蛋" : "墓碑：领取糖果经验奖励",portal:"按继续设置穿过彼世之门",leave:"按7层退出设置，从原生出口离塔"})[obj.data?.sub],
              challenge: "开启挑战并获取奖励",
              cursed: "已授权：以本局永久诅咒换稀有道具",
              cursedchest: "已授权：开启带诅咒的道具球",
              greed: "已授权：提升本局难度与经验金币收益",
            }[obj.kind],
            // Native nearest() accepts a portal at horizontal distance < r+.8,
            // with no height requirement. End routes inside that usable disk:
            // forcing the center can send the player onto an unnecessary cliff.
            obj.kind === "bonk" ? 1.15 : obj.kind === "portal"
              ? Math.max(0.2, (Number.isFinite(obj.r) ? obj.r : 3.4) + 0.6)
              : obj.kind === "altar"
                ? obj.r * 0.45
                : 1.6,
          );
      }
      const towerPolicy = this.towerPolicy(r),
        candle = this.interactionRules().free !== false || towerPolicy.candleGoal
          ? towerCandleTarget(r, towerPolicy, { eligible: (_candle, index) =>
            !(this.blocked.get(`tower-candle:${index}`) > now) }) : null;
      if (candle) add(candle, candle.score, candle.label, candle.radius, candle.id);
      const loot = r.pickups;
      if (
        r.endless?.siegeOn &&
        !r.interactables.list.some(
          (o) => o.kind === "altar" && !o.used && o.charge > 0,
        )
      ) {
        const dx = pos.x - r.endless.ax,
          dz = pos.z - r.endless.az,
          length = Math.hypot(dx, dz) || 1;
        add(
          {
            x: r.endless.ax + ((dx || 1) / length) * 28,
            z: r.endless.az + (dz / length) * 28,
          },
          5000,
          "离开驻守区域",
          3,
          "endless-relocate",
        );
      }
      for (let i = 0; this.settings.pickup !== false && i < loot.n; i++) {
        if (!loot.alive[i]) continue;
        if(finiteTowerClear){
          const id=`loot${i}`,memory=this.tacticalDirector.finiteResources.get(id),age=loot.age?.[i],
            condition=Number.isFinite(age)||loot.attract[i]?`${loot.kind[i]}:${loot.value[i]}:${+!!loot.attract[i]}`:`${loot.kind[i]}:${loot.x[i]}:${loot.z[i]}:${loot.value[i]}:0`;
          if(memory&&(memory.condition!==condition||Number.isFinite(age)&&Number.isFinite(memory.age)&&age<memory.age-.001)){
            this.blocked.delete(id);this.tacticalDirector.finiteResources.delete(id);
          }
        }
        const kind = loot.kind[i], sweepPoint = cleanup?.xp.get(i);
        if (loot.attract[i] && !sweepPoint || cleanup && (kind === 0 || kind === 3) && !sweepPoint) continue;
        const d = Math.hypot(loot.x[i] - pos.x, loot.z[i] - pos.z);
        if (d > 24 && !finiteTowerClear && !sweepPoint) continue;
        const landingY = r.terrain.height?.(pos.x, pos.z) ?? pos.y;
        const verticalGap = Math.min(
          Math.abs(loot.y[i] - pos.y - 0.7),
          Math.abs(loot.y[i] - landingY - 0.7),
        );
        if (!sweepPoint && verticalGap > Math.max(3.2, (p.stats.pickupRange || 6) - 0.5))
          continue;
        if(mastery.avoidXp&&(kind===0||kind===3)||mastery.avoidHealing&&kind===2)continue;
        let score =
          kind === 0
            ? 100 + Math.min(100, loot.value[i] * 4)
            : kind === 1
              ? 90
              : kind === 2 && p.hp < p.maxHp * 0.8
                ? 900
                : kind === 3 && !(loot.magnetAll > 0)
                  ? 1600
                  : kind === 6
                    ? 2400
                    : kind === 4
                      ? 50
                      : 160;
        if (kind === 2 && !this.goalMetricPending(r,'berries') &&
            !healingResourceDecision(r, { x: loot.x[i], z: loot.z[i] }, tactical).use) continue;
        add(
          { x: loot.x[i], y: loot.y[i], z: loot.z[i], loot: true,
            xpPickup: kind === 0 || kind === 3, healingPickup: kind === 2,
            routinePickup: kind === 0 || kind === 1 || kind === 4,pickupKind:kind,pickupIndex:i },
          score,
          sweepPoint ? kind === 3 ? "上楼前拾取神奇糖果" : "上楼前收集剩余经验" : kind === 0 ? "收集经验" : kind === 2 ? "拾取回复" : "收集掉落",
          0.6,
          `loot${i}`,
        );
      }
      const timedSummoners = new Map((r.minibosses?.list || []).filter(entry => entry.kind === "summoner" &&
        en.alive[entry.i] && en.gen?.[entry.i] === entry.gen && Number.isFinite(entry.life) && entry.life > 0)
        .map(entry => [entry.i, entry]));
      // Maintain the short-range starter's attack distance without colliding.
      for (let i = 0; i < en.n; i++) {
        if (!en.alive[i] || en.dying[i] > 0 || en.flags[i] & 4) continue;
        if(campHolding&&i===r.boss.bossIndex)continue;
        if (r.allies.down === i && ["down", "throwing"].includes(r.allies.state) ||
            r.capture.index === i && ["weakened", "throwing"].includes(r.capture.state)) continue;
        const d = Math.hypot(en.x[i] - pos.x, en.z[i] - pos.z);
        const alpha = !!(en.flags[i] & 2), timedSummoner = timedSummoners.get(i),
          bossActor=this.settings.bossRetreat===true&&isNativeBoss(r,i);
        if (!alpha && !timedSummoner && !bossActor && d > (growthNeeded ? 65 : 22)) continue;
        if(alpha && !this.capturePursuitAllowed(r,{source:"ally",index:i,species:en.species[i],captureState:"roaming",distance:d})) continue;
        if (!alpha && !timedSummoner && Math.abs(en.y[i] - pos.y) > 2.8) continue;
        if (
          !alpha && !timedSummoner && !(growthNeeded && d > 12) && !r.terrain.lineClear(
            pos.x,
            pos.y + 0.8,
            pos.z,
            en.x[i],
            en.y[i] + en.hgt[i] * 0.5,
            en.z[i],
          )
        )
          continue;
        const range = bossActor ? 0 :
          en.flags[i] & (2 | 4096 | 8192) || p.moves.filter(Boolean).length < 2
            ? combatRange(p.moves, en.radius[i], p.stats)
            : Math.min(7, combatRange(p.moves, en.radius[i], p.stats));
        const ux = (pos.x - en.x[i]) / Math.max(0.01, d),
          uz = (pos.z - en.z[i]) / Math.max(0.01, d);
        const rare = en.flags[i] & (2 | 4096 | 8192);
        add(
          {
            x: en.x[i] + ux * range,
            y: en.y[i],
            z: en.z[i] + uz * range,
            moving: true,
            ...(alpha ? {captureSource:"ally",captureShiny:!!(en.flags[i]&2048),
              captureCombatRange:range} : {}),
            ...(timedSummoner ? { timedCombat:true, combatEnemyKind:"native-summoner",
              combatRemaining:timedSummoner.life, combatDeadlineAt:r.time+timedSummoner.life,
              combatPositionRange:range } : {}),
            ...(bossActor ? {combatPositionRange:0} : {}),
            ...(alpha || timedSummoner || bossActor || growthNeeded && d > 22 ? { enemyIndex: i } : {}),
          },
          alpha ? 17000 : timedSummoner ? 5000 : p.level < 3 ? 650 : rare ? 260 : 65,
          alpha ? "削弱并捕捉支援阿尔法（满队仍比较替换）" : timedSummoner ? "追击限时召唤者（击杀奖励与研究，原生不可投球）" : rare ? "击败精英与研究" : "获取经验",
          0.6,
          alpha ? `alpha-${i}` : `enemy${i}`,
        );
      }
      const routineOnly = candidates.every(candidate =>
        candidate.routinePickup || /^enemy\d+$/.test(String(candidate.id))&&
          !(this.settings.bossRetreat===true&&isNativeBoss(r,candidate.enemyIndex)));
      const patrol = this.explorationPlanner?.choose(r, {
        eligible: routineOnly, selected: this.target?.exploration === true&&this.target.id===this.explorationPlanner?.goal?.id,
        withinBounds: (x, z, margin) => this.withinArena(r, x, z, margin),
        routeCost:(from,to)=>this.travelRouteCost(r,from,to),
      });
      const completedPatrol = this.terrainRecoveryTracker?.completeGoal?.(r, this.explorationPlanner?.reachedGoal);
      if (completedPatrol?.active) this.terrainRecoveryState = null;
      this.explorationState = this.explorationPlanner?.state || null;
      if (patrol) add(patrol, 400, patrol.label, patrol.radius, patrol.id);
      const finalRewards=this.finalRewardCleanupState(r);
      if(finalRewards.holding){
        progression.leaveStage=false;progression.forceLeave=false;progression.reason="final-boss-reward-cleanup";
        progression.finalRewardCleanup={holding:true,pending:finalRewards.objects.length,
          elapsed:finalRewards.elapsed,window:finalRewards.window};
        for(let index=candidates.length-1;index>=0;index--){
          const candidate=candidates[index];
          if(candidate.entity?.kind==="portal")candidates.splice(index,1);
          else if(finalRewards.objects.includes(candidate.entity))candidate.priorityBand=Math.max(candidate.priorityBand||0,4.83);
        }
      }
      const bonkCleanup=this.bonkCleanupState(r,progression.forceLeave&&candidates.some(c=>c.entity?.kind==='portal'));
      if(bonkCleanup.holding){
        progression.leaveStage=false;progression.forceLeave=false;progression.reason='finite-bonk-cleanup';
        for(let index=candidates.length-1;index>=0;index--){const candidate=candidates[index];
          if(candidate.entity?.kind==='portal')candidates.splice(index,1);
          else if(bonkCleanup.objects.includes(candidate.entity))candidate.priorityBand=Math.max(candidate.priorityBand||0,4.83);
        }
      }
      if (finiteTowerClear) {
        // Only exhaustible rewards belong here. Repeatable planning NPCs and
        // another slots wager must never hold a floor open indefinitely. One
        // currently executable final-loadout operation is different: leaving
        // now can permanently waste this floor's unused fusion/tutor machine.
        const finiteKinds = new Set(["freechest","chest","cage","meowth","ditto","snorlax","nest",
          "berry","magnet","bonk","rock","cursed","cursedchest","fossil","porygon"]),
          byEntity = new Map(candidates.filter(c=>c.entity).map(c=>[c.entity,c])),
          byId = new Map(candidates.map(c=>[c.id,c])),resources=[],finalNPC=this.finalReplacement(r);
        for(const object of r.interactables.list) {
          const plannedNPC=object.kind==="bill"&&finalNPC.needsFusion===true||
            object.kind==="hypno"&&finalNPC.needsTutor===true;
          if(!finiteKinds.has(object.kind) && !plannedNPC && !(object.kind==="tower"&&["altar","trick"].includes(object.data?.sub)))continue;
          const candidate=byEntity.get(object),description=candidate?.interaction||this.worldInteractionDescription(r,object,worldEntities);
          if(!description.eligible)continue;
          const tracking=this.interactionTracker.inspect(r,object),
            failed=["approach-no-progress","interaction-no-progress","repeated-no-effect","visit-finished"].includes(tracking?.reason),
            blocked=failed&&(tracking?.blockedUntil>now||tracking?.blockedCondition!=null)||this.blocked.get(object)>now,
            temporary=tracking?.blockedUntil>now&&!failed;
          resources.push({id:description.id,source:object,
            // Retry-clock buckets are not new gameplay progress and must not
            // renew finite-floor cleanup forever after a failed NPC action.
            condition:plannedNPC?JSON.stringify([object.kind,!!object.used,finalNPC.conditionKey]):description.conditionKey,
            eligible:!!candidate||temporary,blocked});
        }
        for(let index=0;this.settings.pickup!==false&&index<(loot?.n||0);index++) {
          if(!loot.alive[index])continue;
          const id=`loot${index}`,candidate=byId.get(id),kind=loot.kind[index];
          if(mastery.avoidXp&&(kind===0||kind===3)||mastery.avoidHealing&&kind===2)continue;
          const age=loot.age?.[index],inTransit=!!loot.attract[index];
          resources.push({id,age,inTransit,
            distance:inTransit?Math.hypot(pos.x-loot.x[index],(pos.y+.7)-loot.y[index],pos.z-loot.z[index]):null,
            speed:inTransit?16+Math.max(0,Number(age)||0)*6:null,
            condition:Number.isFinite(age)||inTransit?`${kind}:${loot.value[index]}:${+inTransit}`:`${kind}:${loot.x[index]}:${loot.z[index]}:${loot.value[index]}:0`,
            eligible:!!candidate||inTransit,blocked:!inTransit&&this.blocked.get(id)>now});
        }
        const finiteDanger=!flight.active&&(tactical.pressure>3||tactical.hpRatio<.4&&
          (tactical.close>0||tactical.unknownClose>0||tactical.nearBullets>0||r.boss?.alive));
        const {ids:cleanupIds,...cleanup}=this.tacticalDirector.finiteCleanup(r,resources,{danger:finiteDanger});
        progression.finiteCleanup={...cleanup,pending:cleanupIds.length};
        if(cleanup.holding) {
          progression.leaveStage=false;progression.forceLeave=false;progression.reason="finite-stage-cleanup";
          const ids=new Set(cleanupIds);
          for(let i=candidates.length-1;i>=0;i--) {
            const candidate=candidates[i],object=candidate.entity;
            if(object?.kind==="tower"&&["stairs","portal","leave"].includes(object.data?.sub))candidates.splice(i,1);
            else if(ids.has(object?interactionTargetId(object):candidate.id))candidate.priorityBand=Math.max(candidate.priorityBand||0,4.83);
          }
        } else if(cleanup.emergency) {
          progression.forceLeave=true;
          for(const candidate of candidates)if(candidate.entity?.kind==="tower"&&["stairs","portal","leave"].includes(candidate.entity.data?.sub))candidate.priorityBand=4.855;
        }
      }
      // Survival retains its utility ranking; resource mode ranks useful free
      // resources above optional paid visits without blocking progression.
      // Brief commitment suppresses utility jitter, but never masks a higher
      // priority healing/capture/forced progression objective.
      for (const candidate of candidates)
        if (candidate.id === this.target?.id) candidate.score *= 1.12;
      const costCandidates=candidates.filter(candidate=>candidate.interaction?.cost).sort((a,b)=>
        (a.interaction.costRank??Infinity)-(b.interaction.costRank??Infinity)||b.score-a.score),
        preferredCost=costCandidates[0];
      if(costCandidates.length>1)for(let index=candidates.length-1;index>=0;index--)
        if(candidates[index].interaction?.cost&&candidates[index]!==preferredCost)candidates.splice(index,1);
      // A condition drill never pre-empts a real world interaction, capture,
      // rescue, reward, boss/exit or required special mechanic.
      if(!candidates.some(row=>worldEntities.has(row.entity)||row.captureSource||row.cooperativeRescue||
          row.timedCombat||row.goalForesight||row.achievementMechanic||(row.priorityBand||0)>=3)){
        const practice=this.characterPractice(r,tactical);
        if(practice)add({x:practice.x,z:practice.z,moving:practice.phase==='contact',
          ...(practice.phase==='contact'?{enemyIndex:practice.index}:{}),characterPractice:practice},19000,
          practice.phase==='landing'?'角色条件：先安全落地，再进行受控原生判定':
            practice.kind==='dodges'?'角色条件：高生命储备下接近低威胁敌人，等待原生闪避':'角色条件：小量承伤后恢复，累积实际治疗',
          practice.radius,`character-practice:${practice.index}:${practice.gen}`);
      }
      candidates.sort((a, b) => {
        // Expired progression deadlines apply in both modes. Survival keeps
        // its ordinary utility ranking only below the forced-progression bands.
        if ((a.priorityBand || 0) >= 3.6 || (b.priorityBand || 0) >= 3.6) {
          const forcedOrder = (b.priorityBand || 0) - (a.priorityBand || 0);
          if (forcedOrder) return forcedOrder;
        }
        if (a.captureSource && b.captureSource) {
          const aDeadline = a.captureDeadlineAt ?? Infinity, bDeadline = b.captureDeadlineAt ?? Infinity;
          if (aDeadline !== bDeadline) return aDeadline - bDeadline;
        }
        if (a.timedCombat && b.timedCombat && a.combatDeadlineAt !== b.combatDeadlineAt)
          return a.combatDeadlineAt - b.combatDeadlineAt;
        return this.settings.safeMode === false
          ? compareInteractionCandidates(a, b) : b.score - a.score;
      });
      const best = candidates[0];
      // Only the chosen encounter needs the bounded terrain/pressure search;
      // scanning every living alpha's combat ring would multiply frame cost.
      const opportunity = best?.captureSource ? this.captureOpportunity(r, best.enemyIndex) : null,
        retry = opportunity ? this.capturePursuits.get(opportunity.key) : null,
        nativeAction = this.nativeInteractionAction(r),
        readyThrow = opportunity?.source === "capture" && nativeAction === "capture" ||
          opportunity?.source === "ally" && r.allies.down === best?.enemyIndex && nativeAction === "ally";
      if (retry?.until > r.time && retry.reposition && !readyThrow) {
        Object.assign(best, retry.reposition, {captureRetryUntil:retry.until,captureRetryReason:retry.retryReason});
      } else if (best && Number.isFinite(best.captureCombatRange ?? best.combatPositionRange) && Number.isInteger(best.enemyIndex)) {
        const point = this.combatPoint(r, best.enemyIndex, best.captureCombatRange ?? best.combatPositionRange,
          best.captureSource?"capture":null);
        Object.assign(best, { x: point.x, z: point.z, combatDistance: point.range,
          combatCoverage: point.coverage, combatDistanceReason: point.rangeReason,
          bossBoundaryDetour:point.bossBoundaryDetour===true });
      }
      return (
        best || { x: pos.x, z: pos.z, radius: 1, label: "等待目标", id: "idle" }
      );
    },
    step(r, dt) {
      this.syncReleasedMouseAudio();
      if(!this.enabled){this.release(true);return;}
      if(this.restReminderCurrent()){this.release(true);return;}
      if (!this.automationAllowed()) return;
      if (this.enabled && (!this.controlIdentityCurrent() || !this.autoManageCurrent(r))) return;
      if(this.maybeOpenRift(r))return;
      if (this.pendingWorldAttempt) {
        const pending = this.pendingWorldAttempt;
        // Native enterPortal can acknowledge an unclaimed-ball/capture warning
        // without opening a modal. Both guards can require four E presses in
        // total. Its real warning transition is progress, not a failed click.
        const portalAcknowledged=pending.entity.kind==='portal'&&pending.stage===r.stage&&pending.terrain===r.terrain&&
          ['rewardWarnAt','leaveWarnAt'].some(key=>Number.isFinite(r[key])&&r[key]!==pending[key]&&
            Number.isFinite(r.realTime)&&r.realTime-r[key]>=0&&r.realTime-r[key]<.75),
          changed = portalAcknowledged || !!pending.entity.used !== pending.used ||
          pending.entity.kind === "rhydon" && Number(r.roars) !== pending.roars ||
          (r.state !== pending.state && this.modal?.entity === pending.entity);
        if (changed) {
          if ((pending.entity.used || pending.entity.kind === "rhydon" && Number(r.roars) !== pending.roars) && ["cursed", "cursedchest", "greed", "fossil", "porygon", "rhydon"].includes(pending.entity.kind))
            this.riskyVisits.add(pending.entity.kind);
          this.interactionTracker.recordOutcome(r, pending.entity, { changed: true });
          this.pendingWorldAttempt = null;
        } else if (r.time - pending.at > 1.5) this.pendingWorldAttempt = null;
      }
      if (this.pendingInteractionSpend) {
        const pending = this.pendingInteractionSpend;
        if (pending.entity.used) {
          this.interactionSpent += pending.cost;
          this.pendingInteractionSpend = null;
        } else if (r.time - pending.at > 1.5)
          this.pendingInteractionSpend = null;
      }
      this.observeShinies(r);
      this.observeCombat(r);
      // Ilex setEpoch toggles tree collider.off in place. Discard paths built
      // for the other epoch before the next native movement decision.
      const epoch=r.sanctuary?.epoch;
      if(this.navigationEpoch!==epoch){
        this.navigationEpoch=epoch;this.navigation=this.navigationFor(r);this.navTarget=null;this.target=null;
      }
      if (
        this.coverWarning &&
        r.time >= this.coverWarning.impact &&
        this.lastCoverResult?.impact !== this.coverWarning.impact
      )
        this.lastCoverResult = {
          impact: this.coverWarning.impact,
          time: r.time,
          hidden: this.cataclysmHidden(r, r.player.pos),
          hp: r.player.hp,
        };
      if (r.state !== "play") {
        this.routeObservation = null;
        this.tacticalDirector.observe(r, null, null);
        this.interactionTracker.release();
        this.release();
        return;
      }
      this.cadence.reset("live-combat");
      if(this.target&&!this.leaderboardCampTargetAllowed(r,this.target)){
        this.target=null;this.navTarget=null;this.routeObservation=null;this.lastWorld=-Infinity;
      }
      if(this.target?.goalForesight&&(this.foresightEnemy(r)!==this.target.enemyIndex||
          r.enemies.gen?.[this.target.enemyIndex]!==this.target.foresightGen))this.target=null;
      if (this.navigation.terrain !== r.terrain) {
        this.navigation = this.navigationFor(r);
        this.navTarget = null;
        this.target = null;
        this.hazards = [];
        this.blocked.clear();
        this.visits.clear();
        this.lastWorld = -Infinity;
        this.observeWorldInteractions(r);
        for (const name of [
          "enemies",
          "boss",
          "minibosses",
          "director",
          "events",
          "mewtwo",
          "sanctuary",
          "endless",
          "tower",
          "tide",
          "mapEvents",
          "canela", "cave", "encina", "iris",
        ]) {
          for (const method of ["update", "tick"])
            this.wrapOwner(r[name], method, "enemy");
        }
        this.wrapOwner(r.allies, "update", "friendly");
        this.wrapOwner(r.combat, "eliteBurst", "enemy");
      }
      const p = r.player,
        pos = p.pos;
      const flight=this.syncTravelModeMotion(r),priorFlight=this.flightControlScope;
      if(priorFlight&&(priorFlight.run!==r||priorFlight.stage!==r.stage||priorFlight.terrain!==r.terrain||
          priorFlight.active!==flight.active||priorFlight.noInteractions!==flight.noInteractions||priorFlight.keepInteractions!==flight.keepInteractions)||
          flight.noInteractions&&this.target&&!this.target.flightTravel&&!this.target.broadTravel||!flight.active&&this.target?.flightTravel){
        this.target=null;this.navTarget=null;this.routeObservation=null;this.lastWorld=-Infinity;
        this.flightLandingScope=null;
        this.flightCollectionScope=null;
        this.flightInteractionScope=null;
      }
      this.flightControlScope=flight.active||flight.noInteractions?{run:r,stage:r.stage,terrain:r.terrain,active:true,noInteractions:flight.noInteractions,
        keepInteractions:flight.keepInteractions}:null;
      if(!flight.active){this.flightTravelPlanner=null;this.flightCollectionScope=null;this.flightInteractionScope=null;}
      if(this.settings.modeSettings?.tower?.aggressiveUltimate!==true){
        this.ultimateClusterPlan=null;this.ultimateClusterHistory=null;
      }
      if(this.target?.ultimateCluster&&(!this.settings.modeSettings?.tower?.aggressiveUltimate||
          r.ult?.ready!==true||r.ult.active>0||this.app.meta.profile.settings.autoUlt)){
        this.target=null;this.ultimateClusterPlan=null;this.lastWorld=-Infinity;
      }
      const jumpInputReady = performance.now() -
        (this.lastTap.get(this.code("jump")) ?? -Infinity) >= 200;
      const tactical = this.tacticalState(r);
      this.tacticalObjective = null;
      if (this.target?.entity?.kind === "altar") {
        const policy = this.tacticalDirector.observe(r, this.target, tactical, this.settings.safeMode !== false);
        if (policy?.allowed) this.tacticalObjective = policy;
        else if (policy) {
          this.interactionTracker.suppress(r, this.target.entity, { seconds: 35, reason: policy.reason });
          this.tacticalReason = policy.reason;
          this.target = null;
        }
      }
      const simulationDt =
        Math.min(dt, 0.05) *
        (r.timeScale || 1) *
        ((r.hitstopT || 0) > dt ? 0.08 : 1);
      if (!Number.isFinite(pos.x) || !Number.isFinite(pos.z))
        throw Error("位置数据无效");
      const worldEntity = this.target?.entity;
      const trackedWorld = worldEntity && (this.target.interaction || r.interactables.list.includes(worldEntity));
      if (trackedWorld) {
        const observedRoute = this.routeObservation;
        let route = null;
        if (observedRoute?.run === r && observedRoute.terrain === r.terrain && observedRoute.stage === r.stage &&
            observedRoute.object === worldEntity && r.time - observedRoute.at <= 0.35) {
          const endpoint = observedRoute.waypoint;
          const remaining = distance(pos, endpoint);
          route = { waypoint: endpoint, verified: remaining < 0.1 ||
            this.walkRoute(r, pos, (endpoint.x - pos.x) / remaining,
              (endpoint.z - pos.z) / remaining, remaining) };
        }
        if (!this.worldInteractionAllowed(r, worldEntity) ||
          this.interactionTracker.observeTarget(r, worldEntity, {
            // Reselecting an edge approach is not physical progress toward the
            // native landmark. Verified detour motion has its own bounded credit.
            distance: distance(pos, worldEntity),
            inRange: r.interactables.nearest === worldEntity || distance(pos, this.target) <= (this.target.radius || 1.6),
            progress: worldEntity.charge,
            route,
          }).blocked) this.target = null;
      } else this.interactionTracker.release();
      if (
        !this.lastProgress ||
        this.lastProgress.target !== this.target?.id ||
        distance(pos, this.target || pos) < this.lastProgress.distance - 0.7
      ) {
        this.lastProgress = {
          x: pos.x,
          z: pos.z,
          time: r.time,
          target: this.target?.id,
          distance: distance(pos, this.target || pos),
        };
      } else if (
        this.target &&
        !trackedWorld &&
        // Patrol owns a scoped 20s goal/45s area ledger. A legacy 3s block
        // would turn it into idle and stop charging its bounded travel time.
        !this.target.exploration &&
        this.target.enemyIndex == null &&
        distance(pos, this.target) > this.target.radius + 1 &&
        r.time - this.lastProgress.time > 3
      ) {
        this.blocked.set(this.target.id, r.time + 20);
        this.target = null;
      }
      if (r.time - this.lastWorld > 0.2 || !this.target) {
        this.lastWorld = r.time;
        this.target = this.chooseWorldTarget(r);
        const cell = `${Math.round(pos.x / 12)},${Math.round(pos.z / 12)}`;
        this.visits.set(cell, (this.visits.get(cell) || 0) + 0.05);
      }
      const finalPolicy = this.tacticalDirector.observe(r, this.target, tactical, this.settings.safeMode !== false);
      this.tacticalObjective = finalPolicy?.allowed ? finalPolicy : null;
      let target = this.target;
      if (target?.towerCandle) this.tacticalObjective = {
        kind: "candle", center: target.towerCandle, radius: 2.2,
        progress: Math.max(0, Math.min(1, target.towerCandle.charge || 0)), healthBudget: 0,
      };
      if (target?.cooperativeRescue) this.tacticalObjective={kind:"revive",center:target,radius:target.radius,
        progress:0,healthBudget:0,available:true};
      if(target?.masteryExposure)this.tacticalObjective={kind:"mastery",center:target,radius:Math.max(.4,target.radius),
        progress:0,healthBudget:target.masteryExposure.healthBudget,reserveHp:target.masteryExposure.reserveHp,available:true};
      if(target?.characterPractice){
        const pending=this.characterUnlockState(r).practice,
          current=characterUnlockPracticePlan(r,pending,tactical);
        if(current.active&&current.index===target.characterPractice.index&&current.gen===target.characterPractice.gen)
          this.tacticalObjective={kind:current.phase==='contact'?'character-practice':'character-practice-landing',center:target,
            radius:Math.max(.4,target.radius),progress:0,healthBudget:current.healthBudget,reserveHp:current.reserveHp,available:true};
        else {target=this.target=this.chooseWorldTarget(r);this.lastWorld=r.time;}
      }
      const targetCapture = target?.captureSource ? this.captureOpportunity(r, target.enemyIndex) : null,
        protectCapture = !!targetCapture &&
          (target.captureGen == null || target.captureGen === targetCapture.gen) &&
          (this.settings.capturePriority !== false || (targetCapture.shiny || targetCapture.classic) && this.settings.shinyPriority !== false);
      let waypoint = target;
      const d = distance(pos, target),
        dx = target.x - pos.x,
        dz = target.z - pos.z;
      const direct =
        d < 0.2 || this.walkRoute(r, pos, dx / d, dz / d, Math.min(d, 12));
      let moveSpeed = 6.3 * p.stats.moveSpeed * (1 + Math.min(0.3, (p.speedBoostT || 0) * 0.01));
      const weatherSpeed = {"swift-swim":"rain",chlorophyll:"sun","sand-rush":"sand","slush-rush":"hail"};
      if (weatherSpeed[p.ability] === r.weather) moveSpeed *= 1.3;
      const ground = r.terrain.height(pos.x,pos.z), water = r.terrain.isLava ? -99 : r.terrain.waterAt(pos.x,pos.z);
      const iceSurface = !!r.terrain.frozen && ground < water;
      const deepWater = !iceSurface && ground < water - .55;
      const nativeGroundJumpAllowed = p.grounded === true || deepWater && pos.y <= water + .35;
      const slip = Math.max(0,Math.min(1,Number(p.slip)||0));
      moveSpeed *= 1 + .2 * slip + .3 * ((Number(p.skateT)||0) / 1.5) * slip;
      if (Number(p.pstat?.para) > simulationDt) moveSpeed *= .55;
      moveSpeed *= p.arenaSlow ?? 1;
      if (deepWater) moveSpeed *= p.types.includes("water") ? 1.35 : .7;
      else if (!iceSurface && ground < water - .04 && !p.types.includes("water")) moveSpeed *= .85;
      moveSpeed *= p.hazardSlow ?? 1;
      const surfaceNormal = slip > .5 && !iceSurface ? r.terrain.normal?.(pos.x,pos.z) : null;
      const slopeX = Number(surfaceNormal?.x)||0,slopeZ = Number(surfaceNormal?.z)||0;
      // Advance the stable global route even when a local walk proposal exists.
      // A new short detour every frame must not starve A* for a distant NPC.
      let globalWaypoint=null;
      const needsNavigation=(!target.moving || target.enemyIndex!=null) && !direct && d>target.radius;
      if(needsNavigation) {
        if(this.navTarget!==target.id ||
          ((this.navigation.done || this.navigation.failed) && r.time-this.navAt>(target.enemyIndex!=null?.75:6))) {
          this.navigation.begin(pos,target,target.radius);this.navTarget=target.id;this.navAt=r.time;
        }
        this.navigation.advance(45);
        if(this.navigation.done) {globalWaypoint=this.navigation.waypoint(pos);waypoint=globalWaypoint;}
      }
      let localTraversal = null;
      const terrainHopKey = Number.isInteger(target.enemyIndex)
        ? `${String(target.id)}:${target.enemyIndex}:${r.enemies.gen?.[target.enemyIndex] ?? ""}` : target.id;
      const continuingTerrainHop = this.terrainHopState?.active && r.time < this.terrainHopState.until &&
        this.terrainHopScope?.run === r && this.terrainHopScope.stage === r.stage &&
        this.terrainHopScope.terrain === r.terrain && this.terrainHopScope.key === terrainHopKey;
      const continuingCrowdEscape = this.crowdEscapeState?.active && r.time < this.crowdEscapeState.until &&
        this.crowdEscapeScope?.run === r && this.crowdEscapeScope.stage === r.stage &&
        this.crowdEscapeScope.terrain === r.terrain,
        continuingGroundedRescue = this.terrainRecoveryState?.active && r.time < this.terrainRecoveryState.until &&
          this.terrainHopScope?.run === r && this.terrainHopScope.stage === r.stage &&
          this.terrainHopScope.terrain === r.terrain && this.terrainHopScope.key === terrainHopKey;
      if (!continuingTerrainHop && !continuingCrowdEscape && !continuingGroundedRescue &&
          (!direct && !globalWaypoint || p.stuckT > 0.5 || deepWater) && d > target.radius && typeof planTerrainTraversal === "function") {
        localTraversal = planTerrainTraversal({ terrain: r.terrain, target:globalWaypoint || target,
          withinBounds: (x, z, margin) => this.withinArena(r, x, z, margin),
          nativeGroundJumpAllowed,
          canJump: jumpInputReady && (nativeGroundJumpAllowed || p.jumpsLeft > 0),
          jumpVelocity: 11 * Math.sqrt(Math.max(0, Number(p.stats.jumpHeight) || 0)) * (nativeGroundJumpAllowed ? 1 : 0.92),
          extraJumps: Number(p.stats.extraJumps) || 0,
          player: { ...pos, speed: moveSpeed, radius: p.radius,slip,skateT:p.skateT||0,iceSurface,slopeX,slopeZ,
            deepWater, waterLevel: water, types: p.types,
            vx: p.vel.x, vy: p.vel.y, vz: p.vel.z, grounded: p.grounded,
            slideT: p.slideT, stuckT: p.stuckT, jumpsLeft: p.jumpsLeft,
            frameDt: simulationDt, ...nativePlayerMotionInputs(r) },
        });
        if (localTraversal.kind === "walk" && !globalWaypoint) waypoint = localTraversal.target;
      }
      // Patrol retains its ledger while native terrain recovery or a later
      // finite goal change handles a failed route; ordinary targets keep their
      // existing short retry suppression.
      if (needsNavigation && !target.exploration && !target.captureSource && !target.timedCombat && this.navigation.failed && !continuingTerrainHop && localTraversal?.kind !== "walk" && localTraversal?.kind !== "jump") {
          this.blocked.set(target.id, r.time + 25);
          this.target = null;
      }
      if (d <= target.radius) waypoint = pos;
      this.routeObservation = null;
      if (target.entity && r.interactables.list.includes(target.entity) && d > target.radius && waypoint && (direct || globalWaypoint)) {
        const remaining = distance(pos, waypoint);
        const length = Math.min(12, remaining);
        if (remaining > 0.1 && this.walkRoute(r, pos, (waypoint.x - pos.x) / remaining,
            (waypoint.z - pos.z) / remaining, length))
          this.routeObservation = { run: r, terrain: r.terrain, stage: r.stage, object: target.entity, at: r.time,
            waypoint: { x: pos.x + (waypoint.x - pos.x) / remaining * length,
              z: pos.z + (waypoint.z - pos.z) / remaining * length } };
      }
      const enemies = [],
        bullets = [],
        chargeWarnings = [];
      const en = r.enemies;
      const foresight=this.foresightEnemy(r);
      for (let i = 0; i < en.n; i++) {
        if (!en.alive[i] || en.dying[i] > 0 || en.flags[i] & 16512) continue;
        if(i===foresight)continue; // Only this explicitly selected native contact is accepted.
        if (
          p.grounded &&
          !(en.flags[i] & 16) &&
          !en.air?.[i] &&
          Math.abs(en.y[i] - pos.y) > en.hgt[i] + 1
        )
          continue;
        const ex = en.x[i],
          ez = en.z[i],
          dist = Math.hypot(ex - pos.x, ez - pos.z);
        if (!isNativeBoss(r,i)&&dist > (en.flags[i] & 256 ? 30 : 13))
          continue;
        if (
          (r.capture.index === i && r.capture.state === "weakened") ||
          (r.allies.down === i && r.allies.state === "down")
        )
          continue;
        const stationary = typeof nativeEnemyControlActive === "function"
          ? nativeEnemyControlActive(r, i, simulationDt)
          : Math.max(en.sleep[i] || 0, en.frozen[i] || 0, en.stun[i] || 0) > simulationDt;
        const charging =
          en.flags[i] & 256 &&
          en.atk[i] > 0 &&
          en.atk[i] <= 0.6 &&
          (en.dirX[i] || en.dirZ[i]);
        const bossCharging = i === r.boss.bossIndex && r.boss.chargeT > 0;
        if (
          !stationary &&
          i !== r.boss.bossIndex &&
          en.flags[i] & 256 &&
          en.atk[i] > 0.6 &&
          en.atk[i] <= 1 &&
          (en.dirX[i] || en.dirZ[i])
        ) {
          chargeWarnings.push({
            x: ex,
            z: ez,
            x2: ex + en.dirX[i] * en.speed[i] * 2.4 * 0.6,
            z2: ez + en.dirZ[i] * en.speed[i] * 2.4 * 0.6,
            radius: en.radius[i],
            eta: en.atk[i] - 0.6,
            persistent: true,
            life: en.atk[i],
            y: en.y[i],
            maxHeight: en.hgt[i] + 0.8,
          });
        }
        enemies.push({
          index: i,
          boss:isNativeBoss(r,i),
          nativeSpeed:Number(en.speed?.[i])||0,
          frameLag: simulationDt,
          x: ex,
          z: ez,
          y:en.y[i],hgt:en.hgt[i],
          ...((this.travelBreakoutState?.active||flight.active||this.settings.jumpMove===true||p.grounded===false&&pos.y>ground+.15)&&!isNativeBoss(r,i)?
            nativeGroundContactEnvelope(r,i)||{}:{}),
          radius: en.radius[i] + (bossCharging ? 0.8 : 0),
          damage: nativeContactDamageUpperBound(r, i),
          vx: stationary
            ? 0
            : bossCharging
              ? r.boss.cdx * r.boss.chargeSpeed + en.vx[i]
              : charging
                ? en.dirX[i] * en.speed[i] * 2.4
                : en.vx[i] + en.kx[i],
          vz: stationary
            ? 0
            : bossCharging
              ? r.boss.cdz * r.boss.chargeSpeed + en.vz[i]
              : charging
                ? en.dirZ[i] * en.speed[i] * 2.4
                : en.vz[i] + en.kz[i],
        });
      }
      const pr = r.projectiles;
      for (let i = 0; i < pr.n; i++) {
        // Native051 Ghost shots are visual only, including mixed Enemy/Ghost
        // flags. Their step skips damage contacts before ordinary shot logic.
        if (!pr.alive[i] || !(pr.flags[i] & 1) || (pr.flags[i] & 4096)) continue;
        if (Math.hypot(pr.x[i] - pos.x, pr.z[i] - pos.z) > 36) continue;
        bullets.push({
          x: pr.x[i],
          y: pr.y[i],
          z: pr.z[i],
          vx: pr.vx[i],
          vy: pr.vy[i],
          vz: pr.vz[i],
          radius: pr.rad[i],
          damage: nativeProjectileDamageUpperBound(r, i),
          life: pr.life[i],
          flags: pr.flags[i],
          speed: pr.speed?.[i],
        });
      }
      const bossExtra =
        typeof extraBossHazards === "function"
          ? extraBossHazards(r,simulationDt)
          : { hazards: [], enemies: [] };
      const miniExtra = this.minibossThreats(r);
      const chargeExtra = this.guardianChargeThreats(r);
      const legendaryExtra = typeof legendaryArenaHazards === "function"
        ? legendaryArenaHazards(r,this.legendaryObservation || {}) : {hazards:[],force:null,limitations:[]};
      const extra = { hazards: [...(bossExtra.hazards || []), ...(miniExtra.hazards || []), ...chargeExtra.hazards,
          ...legendaryExtra.hazards,
          ...(typeof towerHolyHazards === "function" ? towerHolyHazards(r,simulationDt) : []),
          ...(typeof riftPulseHazards === "function" ? riftPulseHazards(r) : []),
          ...(typeof newMapEventHazards === "function" ? newMapEventHazards(r) : []),
          ...(typeof hoOhObservedHazards === "function" ? hoOhObservedHazards(r,simulationDt) : []),
          ...(typeof celebiArenaHazards === "function" ? celebiArenaHazards(r,simulationDt) : []),
          ...(typeof season3ArenaHazards === "function" ? season3ArenaHazards(r,this.legendaryObservation,simulationDt) : [])],
        enemies: [...(bossExtra.enemies || []), ...(miniExtra.enemies || []), ...chargeExtra.enemies] };
      for (const forecast of extra.enemies || []) {
        const index = forecast.index;
        const existing = enemies.find((e) => e.index === index);
        if (existing) Object.assign(existing, forecast);
        else enemies.push(forecast);
      }
      this.hazards = this.hazards.filter(
        (h) =>
          h.until > r.time &&
          h.owner !== "unknown" &&
          h.owner !== "friendly" &&
          h.owner !== null,
      );
      const hazards = this.hazards.map((h) => ({
        ...h,
        oneShot: h.oneShot || (h.maxHeight != null && !h.persistent),
        eta: h.impact - r.time,
        life: h.life ?? Math.max(0, h.until - r.time),
        ...(h.x2 != null && Number.isFinite(h.maxHeight)
          ? { y: r.terrain.height(pos.x, pos.z) }
          : {}),
      }));
      hazards.push(...(extra.hazards || []));
      hazards.push(...chargeWarnings);
      const quake = this.quakeWarning;
      if (quake && r.time <= quake.end) {
        if (!quake.locked) {
          quake.x = quake.kit.bx;
          quake.z = quake.kit.bz;
          if (r.time >= quake.start) quake.locked = true;
        }
        hazards.push({
          shape: "ring",
          x: quake.x,
          z: quake.z,
          y: r.terrain.height(pos.x, pos.z),
          radius: 1 + (Math.max(0, r.time - quake.start) * 26) / 1.2,
          radialSpeed: 26 / 1.2,
          thickness: 0.2,
          eta: Math.max(0, quake.start - r.time),
          life: quake.end - r.time,
          maxHeight: 1.3,
          maxRadius: 27,
        });
      }
      hazards.push(...this.arenaHazards(r));
      for (const h of r.endless?.hazards.list || [])
        hazards.push({
          x: h.x,
          z: h.z,
          radius: h.r,
          eta: Math.max(0, 2 - h.age),
          persistent: h.age >= 2,
          groundedOnly: true,
        });
      for (const h of r.boss.pools || [])
        hazards.push({
          x: h.x,
          z: h.z,
          radius: h.r,
          eta: 0,
          persistent: true,
          life: h.t,
          y: h.y,
          maxHeight: 1,
        });
      for (const h of r.boss.kit?.pools || [])
        hazards.push({
          x: h.x,
          y: h.y,
          z: h.z,
          radius: h.r,
          eta: 0,
          persistent: true,
          life: h.t,
          maxHeight: 2.5,
        });
      for (const wave of r.boss.waves || []) {
        if (!r.boss.alive || wave.hit || ![wave.x, wave.z, wave.r, wave.max].every(Number.isFinite) || wave.r > wave.max) continue;
        hazards.push({ shape: "ring", source: "guardian-wave", owner: "enemy",
          x: wave.x, z: wave.z, y: r.terrain.height(pos.x, pos.z),
          radius: wave.r, radialSpeed: 13, thickness: 0.6 + 13 * simulationDt,
          eta: 0, life: Math.max(0, (wave.max - wave.r) / 13), maxRadius: wave.max,
          maxHeight: 1.3, damage: p.maxHp * 0.34 });
      }
      if (
        !flight.active&&r.boss.alive &&
        (r.boss.waves.some((w) => !w.hit) ||
          (r.boss.last === "wave" && r.boss.hold > 0))
      ) {
        const wave = r.boss.waves.find((w) => !w.hit);
        const ox = wave?.x ?? en.x[r.boss.bossIndex],
          oz = wave?.z ?? en.z[r.boss.bossIndex];
        const dx = pos.x - ox,
          dz = pos.z - oz,
          d = Math.hypot(dx, dz) || 1;
        waypoint = { x: pos.x + (dx / d) * 9, z: pos.z + (dz / d) * 9 };
      }
      const windKit = r.boss.kit, windIndex = r.boss.bossIndex,
        externalForces = [...(legendaryExtra.force?[{...legendaryExtra.force}]:[]),
          ...(typeof hoOhObservedForces==="function"?hoOhObservedForces(r,simulationDt):[]),
          ...(typeof charizardArenaForces==="function"?charizardArenaForces(r,simulationDt):[])];
      waypoint = confineMovementGoal(r, waypoint, Math.max(.8, p.radius || .55));
      // Native wind mechanics add kx/kz impulses, not a position
      // teleport. The shared predictor rechecks the gust cone every frame.
      if (r.boss.alive && !windKit?.dead && en.species?.[windIndex] === 144 &&
          windKit.gust > 0 && [windKit.bx,windKit.bz,windKit.gustA,windKit.gust].every(Number.isFinite))
        externalForces.push({radial:true,originX:windKit.bx,originZ:windKit.bz,
          angle:windKit.gustA,halfAngle:.5,range:24,strength:34,duration:windKit.gust,
          delay:Math.max(0,(Number(windKit.frozen)||0)-simulationDt)});
      const nearForJump = r.interactables.nearest;
      const nativeActionForJump = this.nativeInteractionAction(r);
      // Native E depends on the actual horizontal nearest landmark, not
      // grounded state or an extra approach margin outside its usable disk.
      const readyInteraction = nativeActionForJump === "world" && nearForJump &&
        !target.cooperativeRescue &&
        this.worldInteractionAllowed(r, nearForJump) &&
        !(nearForJump === target.entity && target.nativeWalkUpStairs);
      const holdingCandle = this.tacticalObjective?.kind === "candle" &&
        distance(pos, this.tacticalObjective.center) < 2.4 &&
        Math.abs(pos.y - this.tacticalObjective.center.y) < 1.5 &&
        r.tower?.floorCurse !== "dark" && !p.dead;
      const holdingRescue=target.cooperativeRescue && distance(pos,target)<2.6;
      const holdingAltar = this.tacticalObjective?.kind === "altar" &&
        distance(pos, this.tacticalObjective.center) <= this.tacticalObjective.radius + 0.5 || holdingCandle || holdingRescue;
      let productiveAttack=false, combatProgress=false;
      if(Number.isInteger(target?.enemyIndex) && en.alive[target.enemyIndex]) {
        const index=target.enemyIndex, hp=Number(en.hp?.[index]), previous=this.stationaryAttackProgress;
        const same=previous?.run===r && previous.stage===r.stage && previous.index===index && previous.gen===en.gen?.[index];
        const at=same && Number.isFinite(hp) && hp<previous.hp-.01 ? r.time : same?previous.at:-Infinity;
        this.stationaryAttackProgress={run:r,stage:r.stage,index,gen:en.gen?.[index],hp,at};
        const reachableAttack=Math.hypot(pos.x-en.x[index],pos.z-en.z[index])<=
          combatRange(p.moves,en.radius[index],p.stats) &&
          r.terrain.lineClear?.(pos.x,pos.y+.8,pos.z,en.x[index],en.y[index]+.8,en.z[index])!==false;
        productiveAttack=r.time-at<2 && reachableAttack;
        combatProgress=same && Number.isFinite(hp) && hp<previous.hp-.01 && reachableAttack;
      }
      this.terrainRecoveryState = this.terrainRecoveryTracker.observe(r, {target,
        combatProgress,
        verifiedRouteProgressCount:target.entity ? this.interactionTracker.inspect(r,target.entity)?.routeProgressCount : undefined,
        eligible:
        !readyInteraction && !holdingAltar && !["capture","ally"].includes(nativeActionForJump) &&
        !!target && (target.towerCandle ? !holdingCandle : distance(pos,target) > Math.max(1.6,Number(target.radius)||0)) &&
        target.id !== "quest-time" && !productiveAttack && !(p.anchorT>0)});
      const movementInteractionGate = !readyInteraction && !holdingAltar &&
        !["capture", "ally"].includes(nativeActionForJump) && !(p.anchorT > 0);
      const landingPlan=flight.active&&!target.flightTravel?flightLandingPlan(p,target,r.terrain,moveSpeed):null,
        landingScope=this.flightLandingScope,
        landingEntity=target.entity&&r.interactables.list.includes(target.entity)?target.entity:null,
        landingGeneration=target.enemyIndex!=null?r.enemies.gen?.[target.enemyIndex]:target.pickupIndex!=null?
          `${target.pickupKind}:${target.x}:${target.z}`:null,
        sameLanding=landingScope?.run===r&&landingScope.stage===r.stage&&landingScope.terrain===r.terrain&&
          landingScope.id===target.id&&landingScope.entity===landingEntity&&landingScope.gen===landingGeneration;
      if(!flight.active||target.flightTravel||landingScope&&!sameLanding)this.flightLandingScope=null;
      if((landingPlan?.begin||target.flightInteraction)&&!sameLanding)this.flightLandingScope={run:r,stage:r.stage,terrain:r.terrain,
        id:target.id,entity:landingEntity,gen:landingGeneration};
      const flightLanding=flight.active&&!target.flightTravel&&(target.flightInteraction||sameLanding||landingPlan?.begin||!movementInteractionGate),
        flightCruising=flight.active&&!flightLanding&&movementInteractionGate&&nativeActionForJump!=="rescue"&&
          !target.cooperativeRescue&&!target.nativeWalkUpStairs&&!(r.capture?.throwing===true||r.capture?.state==="throwing");
      const routineSlideGate=!flight.active&&this.settings.slideMove===true&&movementInteractionGate&&
        nativeActionForJump!=="rescue"&&!target.cooperativeRescue&&target.entity?.kind!=="altar"&&
        !target.nativeWalkUpStairs&&!this.cooperativePortalAvoidance(r)&&
        !(r.capture?.throwing===true||r.capture?.state==="throwing");
      if (protectCapture && movementInteractionGate && this.terrainRecoveryState.exhausted &&
          typeof this.terrainRecoveryTracker.retryActiveCapture === "function")
        this.terrainRecoveryState = this.terrainRecoveryTracker.retryActiveCapture(r, { target });
      else if (movementInteractionGate && this.terrainRecoveryState.exhausted &&
          typeof this.terrainRecoveryTracker.retryStalledTravel === "function")
        this.terrainRecoveryState = this.terrainRecoveryTracker.retryStalledTravel(r, { target });
      // Body pressure can pin the player despite real outgoing boss damage.
      // Only legal native E/holding/anchor windows suppress this finite escape;
      // preserving the capture target does not mean standing in its crowd.
      this.crowdEscapeState = this.crowdEscapeTracker?.observe(r, {
        target, eligible: !flight.active&&movementInteractionGate,
        withinBounds: (x, z, margin) => this.withinArena(r, x, z, margin),
        safeMode: this.settings.safeMode !== false,
        captureRemaining: targetCapture?.remaining,
      }) || null;
      this.crowdEscapeScope = { run: r, stage: r.stage, terrain: r.terrain };
      this.terrainHopState = this.terrainHopTracker?.observe(r, { target, targetKey: terrainHopKey,
        candidate: localTraversal,
        eligible: movementInteractionGate && !this.terrainRecoveryState.active &&
          !this.crowdEscapeState?.active && !productiveAttack &&
          distance(pos, target) > Math.max(1.6, Number(target.radius) || 0) &&
          // The original goal can run along a shore while the committed exit
          // crosses it. Landing on its first dry shelf must not replace that
          // finite uphill direction with the unrelated clear shoreline route.
          (!direct || p.stuckT > 0.5 || deepWater || continuingTerrainHop),
      }) || null;
      this.terrainHopScope = { run: r, stage: r.stage, terrain: r.terrain, key: terrainHopKey };
      this.travelProgressTracker ||= new TravelProgressTracker();
      this.travelBreakoutState=this.travelProgressTracker.observe(r,{eligible:movementInteractionGate&&
        !flightLanding&&(target.broadTravel===true||target.orbitTravel===true||target.flightTravel===true||target.travelGrowth===true)});
      const ballGroundWindow=typeof mewtwoBallGroundWindow==='function'&&mewtwoBallGroundWindow(r);
      const motion = chooseCombatMotion({
        travelCommitment:this.travelBreakoutState,
        flight:{...flight,landing:flightLanding,cruising:flightCruising,fallSeconds:landingPlan?.fallSeconds,
          holdPosition:target.flightInteraction===true&&this.flightInteractionInReach(r,target)},
        terrainRecovery: this.terrainRecoveryState,
        terrainHop: ballGroundWindow?null:this.terrainHopState,
        crowdEscape: this.crowdEscapeState,
        nativeGroundJumpAllowed,
        terrain: r.terrain,
        withinBounds: (x, z, margin) => this.withinArena(r, x, z, margin),
        extraJumps: Number(p.stats.extraJumps) || 0,
        canJump: !ballGroundWindow&&jumpInputReady && (nativeGroundJumpAllowed || p.jumpsLeft > 0),
        slideMoveAllowed: routineSlideGate&&nativeRoutineSlideReady(r),
        jumpMoveAllowed: !ballGroundWindow&&!flight.active && this.settings.jumpMove === true && !routineSlideGate &&
          !readyInteraction && !holdingAltar &&
          !target.nativeWalkUpStairs &&
          nativeActionForJump !== "capture" && nativeActionForJump !== "ally",
        jumpVelocity: 11 * Math.sqrt(Math.max(0, Number(p.stats.jumpHeight) || 0)) *
          (nativeGroundJumpAllowed ? 1 : 0.92),
        safeMode: this.settings.safeMode !== false,
        player: {
          ...pos,
          deepWater, waterLevel: water, types: p.types,
          radius: p.radius,
          speed: moveSpeed,slip,skateT:p.skateT||0,iceSurface,slopeX,slopeZ,
          vx: p.vel.x,
          vy: p.vel.y,
          vz: p.vel.z,
          height: pos.y - ground,
          grounded: p.grounded,
          slideT: p.slideT,
          jumpsLeft: p.jumpsLeft,
          stuckT: p.stuckT,
          landBuffer: p.landBuffer,
          kx: p.kx,
          kz: p.kz,
          crowdX: p.crowdX,
          crowdZ: p.crowdZ,
          anchorT: p.anchorT,
          externalForces,forceX:0,forceZ:0,forceFor:0,
          frameDt: simulationDt,
          invulnerableFor: Math.max(p.iframes || 0, p.invisT || 0),
          hp: p.hp, maxHp: p.maxHp, shield: p.shield || 0, regen: tactical.regen,
          ...nativePlayerMotionInputs(r),
        },
        objective: this.tacticalObjective,
        bossRetreat:this.settings.bossRetreat===true,
        bossApproachAllowed:!!this.tacticalObjective||!!targetCapture||target.cooperativeRescue===true||target.loot===true||
          !!target.achievementMechanic||!!target.goalForesight||
          !!(target.entity&&r.interactables.list.includes(target.entity)&&this.worldInteractionAllowed(r,target.entity)),
        bossBoundaryDetour:target.bossBoundaryDetour===true,
        target: waypoint,
        previous: this.previous,
        enemies,
        bullets,
        hazards,
        pathAllowed: flight.noInteractions || flight.keepInteractions || this.progressionDecision?.finiteCleanup?.holding || this.cooperativePortalAvoidance(r) || this.masteryState(r).avoidXp || this.masteryState(r).avoidHealing || r.tower && this.towerPolicy(r).avoidCandles || r.coop && this.settings.convenience?.coop?.enabled===true &&
          (this.settings.convenience.coop.doNotAltar || this.settings.convenience.coop.doNotShroom) ? path =>
          this.flightRouteAllowed(r,path)&&path.every((point, index) => index === 0 || this.candleRouteAllowed(r,path[index-1],point)) : undefined,
        canDash: !ballGroundWindow&&!flight.active && p.grounded && p.slideCd <= 0,
        walkable: (x, z, length, _time, feetY) =>
          this.walkRoute(r, pos, x, z, length, 2, feetY),
        cover:
          this.coverWarning && this.coverWarning.until >= r.time
            ? {
                eta: this.coverWarning.impact - r.time,
                isHidden: (x, y, z) =>
                  this.cataclysmHidden(r, {
                    x,
                    y: Math.max(y ?? pos.y, r.terrain.height(x, z)),
                    z,
                  }),
              }
            : undefined,
      });
      this.lastMotion = {
        computedAtGameTime: r.time,
        computedPosition: { x: pos.x, y: pos.y, z: pos.z }, computedHp: p.hp,
        observedBodyIndices: enemies.slice(0, 128).map(enemy => enemy.index),
        observedBodyCount: enemies.length, observedBodiesTruncated: enemies.length > 128,
        x: motion.x,
        z: motion.z,
        dash: motion.dash,
        risk: motion.risk,
        waypoint: { x: waypoint.x, z: waypoint.z },
        target:
          typeof target.id === "object"
            ? target.entity?.kind || target.label
            : target.id,
        objectiveHeld: motion.objectiveHeld, acceptedDamage: motion.acceptedDamage,
        expectedDamage: motion.expectedDamage, escapeRoutes: motion.escapeRoutes,
        action: motion.action, jump: motion.jump, jumpMove: motion.jumpMove === true, slideMove: motion.slideMove===true, safety: motion.safety,
        ignoreEnemyThreats:flight.active===true,
        flightMove:flight.active,flightPhase:flightLanding?"landing":flightCruising?"cruising":"yielding",
        flightItemCount:flight.itemCount,flightThreshold:flight.threshold,flightNoInteractions:flight.noInteractions,
        arenaLimitations: legendaryExtra.limitations.slice(0,8),
        brakeCommitFor: motion.brakeCommitFor ?? null,
        combatDistance: target.combatDistance,
        combatCoverage: target.combatCoverage,
        combatDistanceReason: target.combatDistanceReason,
        bossRetreat:this.settings.bossRetreat===true,
        bossAvoidance:motion.bossAvoidance===true,bossApproach:motion.bossApproach??null,
        bossConstraintReturn:motion.bossConstraintReturn===true,bossEscapeDetour:motion.bossEscapeDetour===true,
        captureRemaining: target.captureRemaining, captureDeadlineAt: target.captureDeadlineAt,
        captureDeadlineKind: target.captureDeadlineKind, captureRetryUntil: target.captureRetryUntil,
        combatEnemyKind: target.combatEnemyKind, combatRemaining: target.combatRemaining,
        crowdEscape: motion.crowdEscape || null,
        traversal: (motion.traversal || localTraversal) ? {
          kind: motion.traversal?.kind || (motion.traversal ? "jump" : localTraversal?.kind),
          reason: motion.traversal?.reason || localTraversal?.reason,
          rise: motion.traversal?.rise ?? localTraversal?.rise,
          plannedJumps: motion.traversal?.plannedJumps ?? localTraversal?.plannedJumps,
          jump: motion.jump, nextJumpAt: localTraversal?.nextJumpAt,
          target: localTraversal?.target,
        } : null,
      };
      if(target.ultimateCluster&&(motion.danger||motion.safety?.hardDanger||motion.safety?.healthDamage>0||motion.safety?.unknownHits>0)){
        if(this.ultimateClusterHistory)this.ultimateClusterHistory={...this.ultimateClusterHistory,cancelled:true};
        if(this.ultimateClusterPlan)this.ultimateClusterPlan={...this.ultimateClusterPlan,phase:"cast",reason:"unsafe-approach-cancelled"};
        this.target=null;this.lastWorld=-Infinity;
      }
      this.lastMotion.ultimateCluster=this.ultimateClusterPlan?{phase:this.ultimateClusterPlan.phase,
        currentCount:this.ultimateClusterPlan.currentCount,bestCount:this.ultimateClusterPlan.bestCount,
        reason:this.ultimateClusterPlan.reason}:null;
      const operation = typeof planUltimateCombat === "function" ? planUltimateCombat(r, {
        autoUlt: this.app.meta.profile.settings.autoUlt,
        countGoal:!flight.noInteractions&&!readyInteraction&&!holdingAltar&&!target.cooperativeRescue&&
          nativeActionForJump!=='rescue'&&!this.priorityCapturePending(r)&&this.goalMetricPending(r,'ultimates'),
        history: this.ultimateHistory, frameDt: simulationDt,
        clusterPlan:this.ultimateClusterPlan,
        bossPriority:this.settings.modeSettings?.tower?.aggressiveUltimate===true,
        imminentImpact: motion.safety?.lethal===true || motion.safety?.healthDamage>0 || motion.safety?.unknownHits>0, motion,
      }) : null;
      this.lastOperation = { ultimate: operation };
      this.previous = motion;
      const portalMotionAllowed=cooperativeReadyPortalRouteAllowed(r,pos,
        {x:pos.x+motion.x,z:pos.z+motion.z},this.cooperativePortalAvoidance(r));
      const nativeInput = typeof nativeMovementInput === "function" ? nativeMovementInput(r,motion,simulationDt) : motion;
      this.lastMotion.charmCompensated = nativeInput.inverted === true;
      this.move(portalMotionAllowed?nativeInput.x:0,portalMotionAllowed?nativeInput.z:0,r.camYaw);
      const nativeBallDeflect=typeof mewtwoBallDeflectReady==='function'&&mewtwoBallDeflectReady(r,simulationDt);
      if(nativeBallDeflect&&portalMotionAllowed){
        const ball=r.boss.kit.ball,dx=ball.x-pos.x,dz=ball.z-pos.z,d=Math.hypot(dx,dz)||1,
          input=nativeMovementInput(r,{x:dx/d,z:dz/d},simulationDt);
        this.move(input.x,input.z,r.camYaw);this.tap('dash',1);
      }
      if (motion.jump&&portalMotionAllowed&&!nativeBallDeflect) this.tap("jump", 200);
      const wavePath =
        r.boss.waves?.some((w) => !w.hit) &&
        typeof motionTrajectory === "function"
          ? motionTrajectory(
              {
                ...pos,
                speed: moveSpeed,slip,skateT:p.skateT||0,iceSurface,slopeX,slopeZ,
                vx: p.vel.x,
                vy: p.vel.y,
                vz: p.vel.z,
                height: pos.y - ground,
                grounded: p.grounded,
                slideT: p.slideT,
                landBuffer: p.landBuffer,
                kx: p.kx,
                kz: p.kz,
                crowdX: p.crowdX,
                crowdZ: p.crowdZ,
                anchorT: p.anchorT,
                frameDt: simulationDt,
                externalForces,forceX:0,forceZ:0,forceFor:0,
                ...nativePlayerMotionInputs(r),
              },
              motion,
              motion.dash,
            )
          : null;
      let imminentWave = false,emergencyJumpIssued=false;
      for (const h of hazards)
        if (h.shape === "ring") {
          const dx = pos.x - h.x,
            dz = pos.z - h.z,
            d = Math.hypot(dx, dz) || 0.001;
          const radial = (p.vel.x * dx + p.vel.z * dz) / d;
          const eta = (h.eta || 0) + (d - h.radius) / (h.radialSpeed - radial);
          if (eta >= 0 && eta < 0.9) imminentWave = true;
          if (
            eta >= 0 &&
            eta < 0.32 &&
            !motion.safety &&
            !(this.coverWarning?.until >= r.time) &&
            (p.grounded || (p.jumpsLeft > 0 && p.vel.y < 0))
          )
            emergencyJumpIssued=this.tap("jump", 200)||emergencyJumpIssued;
        }
      for (const wave of r.boss.waves || []) {
        if (wave.hit) continue;
        const eta = waveArrival(
          {
            x: pos.x,
            z: pos.z,
            vx: p.vel.x,
            vz: p.vel.z,
            trajectory: wavePath,
          },
          wave,
        );
        if (eta >= 0 && eta < 0.9) imminentWave = true;
        if (
          eta > -0.03 &&
          eta < 0.42 &&
          !motion.safety &&
          (p.grounded || (p.jumpsLeft > 0 && p.vel.y < 0))
        )
          emergencyJumpIssued=this.tap("jump", 200)||emergencyJumpIssued;
      }
      if (motion.dash && !ballGroundWindow && portalMotionAllowed && p.grounded && p.slideCd <= 0 &&
          (motion.slideMove!==true||!emergencyJumpIssued&&routineSlideGate&&nativeRoutineSlideReady(r))) this.tap("dash", 1);
      if (
        !imminentWave &&
        !(this.coverWarning?.until >= r.time) &&
        !motion.dash &&
        !motion.safety &&
        !(p.slideT > 0) &&
        p.grounded &&
        !this.terrainRecoveryState?.active &&
        (p.stuckT > 0.5 || motion.risk > 30000)
      )
        this.tap("jump", 200);
      if (operation?.press && this.tap("ult", 100))
        this.ultimateHistory = operation.nextHistory;
      const near = r.interactables.nearest;
      const nativeAction = this.nativeInteractionAction(r);
      this.cooperativeRescueInput(r,target,tactical);
      if(nativeAction==='rift'&&target.riftEntrance&&this.compatibility?.maintenanceScope?.allowRifts===true&&r.rifts.enterBlock()===null)
        this.tap('interact',400);
      else if (nativeAction === "capture" || nativeAction === "ally")
        this.tap("interact", 400);
      else if (
        nativeAction === "world" &&
        near &&
        !isNativePassivePickup(near) &&
        !target.cooperativeRescue &&
        near.kind !== "shroom" && near.kind !== "altar"
      ) {
        const isTarget = near === target.entity;
        const beneficial =
          ["freechest", "rock", "berry", "magnet", "ditto", "snorlax"].includes(
            near.kind,
          ) ||
          (near.kind === "chest" &&
            (near.data?.gift || r.gold >= r.interactables.chestCost()));
        if ((isTarget || beneficial) && this.worldInteractionAllowed(r, near)) {
          const cost = this.worldInteractionCost(r, near);
          const before = { entity: near, used: !!near.used, gold: Number(r.gold), roars: Number(r.roars) || 0,
            state: r.state, at: r.time,...(near.kind==='portal'?{stage:r.stage,terrain:r.terrain,
              rewardWarnAt:r.rewardWarnAt,leaveWarnAt:r.leaveWarnAt}:{}) };
          if (this.tap("interact", 500)) {
            this.lastWorldInteraction = near;
            // Entering a shop/roulette is free. Actual modal purchases account
            // their gold delta separately; reserve only native entry charges.
            if (["chest", "cage"].includes(near.kind) && cost > 0)
              this.pendingInteractionSpend = { entity: near, cost, at: r.time };
            this.pendingWorldAttempt = before;
            this.interactionTracker.recordAttempt(r, near, {
              conditionKey: this.worldInteractionDescription(r, near).conditionKey,
            });
          }
        }
      }
      const camp=this.leaderboardCampState(r);
      this.status = `${camp?`${camp.kind==="endless"?"生存排行":"击败数排行"} · ${camp.holding?"驻留":"前往"}第${camp.stage}关（${camp.automatic?"自动 · ":""}目标第${camp.targetStage}关）`:this.plan?.priority || "推进"} · ${target.label}`;
      if(flight.active&&this.characterUnlockState(r).practice)
        this.status+=' · 飞行/环飞期间暂缓接触类条件，保留未完成目标';
      if(this.completionGoalState(r).retryNextRun)this.status+=" · 终局补条件动作已结束，保留目标下局重试";
    },
    interactionRules() {
      const rules=interactionOptions({ ...this.settings,
        interactions: { risky: this.settings.riskyInteractions === true, ...(this.settings.interactions || {}) },
      }, this.plan?.build || {});
      rules.forceCostInteractions=this.settings.forceCostInteractions===true;
      rules.risky=rules.forceCostInteractions||this.settings.riskyInteractions===true&&rules.risky===true;
      return rules;
    },
    costStrategySettings(r=this.app?.run) {
      const settings=normalizeCostSettings(this.settings),rules=this.interactionRules(),
        tactical=r?.player?this.tacticalState(r):null;
      return towerCostSettings({...settings,riskyInteractions:rules.risky===true,
        allowAutomatic:!!r?.player&&offensiveRiskAllowed({player:r.player,nativeRun:r,luckOnlyExperience:this.settings.modeSettings?.tower?.onlyExperience === true,experienceBlessingPriority:this.settings.modeSettings?.tower?.experienceBlessingPriority === true,build:this.plan?.build,
          objective:this.plan?.objective},{risky:rules.risky,safeMode:this.settings.safeMode,pressure:tactical?.pressure})},this.settings.modeSettings?.tower||{},r);
    },
    costWorldPriority(r) {
      if(this.settings.forceCostInteractions!==true)return 0;
      const previous=this.costPriorityScope,account=this.app?.meta?.account;
      if(!previous||previous.run!==r||previous.stage!==r.stage||previous.terrain!==r.terrain||previous.account!==account||previous.epoch!==this.controlEpoch)
        this.costPriorityScope={run:r,stage:r.stage,terrain:r.terrain,account,epoch:this.controlEpoch,until:r.time+60};
      // Fresh optional landmarks cannot renew the same stage's useful visit
      // window. After it, normal mandatory progression wins again.
      return r.time<this.costPriorityScope.until?4.65:2.7;
    },
    priorityShopState(r) {
      if(this.settings.shopPriority!==true){this.priorityShopScope=null;return null;}
      if(!r||this.app?.run!==r||this.run!==r||!["play","modal"].includes(r.state)||!this.enabled||
          !this.controlIdentityCurrent()||this.flightState(r).noInteractions)return null;
      const account=this.app?.meta?.account,previous=this.priorityShopScope,
        nativeStage=r.endless?100+Number(r.endless.shopVisit||0):r.tower?200+Number(r.tower.floor):r.stage;
      if(!previous||previous.run!==r||previous.stage!==r.stage||previous.terrain!==r.terrain||
          previous.nativeStage!==nativeStage||previous.account!==account||previous.epoch!==this.controlEpoch)
        this.priorityShopScope={run:r,stage:r.stage,nativeStage,terrain:r.terrain,account,epoch:this.controlEpoch,
          until:r.time+60,rerolls:0,purchases:0,emptyRerolls:0,failed:false};
      const state=this.priorityShopScope;
      if(state.failed&&state.failedStock!==r.shop?.stock){state.failed=false;state.failedStock=null;}
      state.active=r.time<state.until&&!state.failed&&state.purchases<64;
      return state;
    },
    priorityShopReroll(r,root=null) {
      if(this.settings.shopPriority!==true)return null;
      const state=this.priorityShopState(r),rules=this.interactionRules(),shop=r?.shop,
        stage=r?.endless?100+Number(r.endless.shopVisit||0):r?.tower?200+Number(r.tower.floor):r?.stage;
      if(!state?.active||state.rerolls>=8||state.emptyRerolls>=3||rules.shop===false||rules.paid===false||
          !shop||shop.stage!==stage||!Array.isArray(shop.stock)||!shop.stock.length||
          typeof r.rerollCost!=="function"||typeof r.rerollShop!=="function")return null;
      const cost=Number(r.rerollCost());
      if(!Number.isFinite(cost)||cost<=0||!this.canSpend(r,cost,rules))return null;
      const button=root?.querySelector?.(nativeCompatSelector(".shop-reroll"));
      if(root&&(!button||button.disabled||button.hidden===true||button.getAttribute?.("aria-disabled")==="true"))return null;
      // Do not buy unknown rolls when every known item is full, forbidden or
      // useless to this actual build. This scan only runs with the option on.
      const build=this.decisionBuild(r,"shop"),costSettings=this.costStrategySettings(r),
        useful=[...(this.bridge.items?.entries?.()||[])].some(([key])=>
          (typeof r.player.canHold!=="function"||r.player.canHold(key))&&
          scoreOffer({kind:"item",id:key},{player:r.player,build,purpose:"shop",nativeRun:r,luckOnlyExperience:this.settings.modeSettings?.tower?.onlyExperience === true,experienceBlessingPriority:this.settings.modeSettings?.tower?.experienceBlessingPriority === true,costPolicy:costSettings},this.bridge)>0);
      return useful?{state,cost,button,stock:shop.stock,rerolls:Number(shop.rerolls)||0}:null;
    },
    nativeCostMandatory(modal,root) {
      if(!root||!["pact","upgrade","blessing"].includes(modal.kind))return false;
      const legal=button=>button&&!button.disabled&&button.hidden!==true&&button.getAttribute?.("aria-disabled")!=="true",
        exit=root.querySelector?.(nativeCompatSelector(".actions button.ghost")),reroll=root.querySelector?.(nativeCompatSelector(".actions button.blue")),r=this.app.run;
      if(modal.kind==="upgrade"&&(Number(r.skips)>0&&legal(exit)||Number(r.rerolls)>0&&legal(reroll)))return false;
      return !legal(exit);
    },
    costModalDecision(modal,root) {
      const r=this.app.run,costSettings=this.costStrategySettings(r),rules=modal.kind==="shop"?this.towerShopRules(r):this.interactionRules(),
        build=this.decisionBuild(r,modal.kind==='shop'?'shop':'choice'),
        cards=[...(root?.querySelectorAll?.(nativeCompatSelector(".cards button.card"))||[])],
        legal=index=>!!cards[index]&&!cards[index].disabled&&cards[index].hidden!==true&&
          cards[index].getAttribute?.("aria-disabled")!=="true",
        context={player:r.player,nativeRun:r,luckOnlyExperience:this.settings.modeSettings?.tower?.onlyExperience === true,experienceBlessingPriority:this.settings.modeSettings?.tower?.experienceBlessingPriority === true,build,objective:this.plan?.objective,costPolicy:costSettings};
      if(modal.kind==="pact")return choosePactAction(modal.offers,context,{costSettings,
        expandVitaminSlots:this.settings.expandVitaminSlots===true,risky:rules.risky,
        allowRisky:costSettings.allowAutomatic,mandatory:this.nativeCostMandatory(modal,root),legal});
      if(modal.kind==="trade"&&modal.entity){
        const goal=this.goalWorldInteraction(r,modal.entity.kind);
        return chooseNativeTrade(modal.offers,context,this.bridge,{kind:modal.entity.kind,costSettings,
          risky:rules.risky,allowRisky:costSettings.allowAutomatic||!!goal&&rules.risky===true&&r.player.hp/r.player.maxHp>=.6&&!r.boss?.alive,
          resolvedTowerTrick:modal.entity.kind==="tower"?this.towerTrickRequested(r):undefined,fossilKey:goal?.kind==="fossil"?goal.key:null,legal});
      }
      if(["upgrade","blessing","itemChoice"].includes(modal.kind)){
        const pageKey=`${r.player.level}:${r.pendingUps??"native"}`,history={...this.choiceHistory,
          rerollsThisPage:this.choiceHistory.pageKey===pageKey?this.choiceHistory.rerollsThisPage:0},
          preserving=this.autoManagePreserving(r);
        return chooseOfferAction(modal.offers,{...context,moveSlots:r.player.moveSlots,
          objectiveMetric:this.plan?.metrics?.join(",")||"",finalReplacement:this.finalReplacement(r,{offers:modal.kind==="upgrade"?modal.offers.filter((offer,index)=>offer?.kind==="newMove"&&(!cards[index]||legal(index))):[]}),
          availableMoveKeys:this.plan?.availableMoveKeys},this.bridge,
          {kind:modal.kind,costSettings,experienceBlessingPriority:this.settings.modeSettings?.tower?.experienceBlessingPriority===true,legal:index=>(!cards[index]||legal(index))&&
              (!preserving||modal.kind!=="upgrade"||this.autoManageUpgradeAllowed(r,modal.offers[index])),
            nativeMandatory:this.nativeCostMandatory(modal,root),
            rerollLegal:!!root?.querySelector?.(nativeCompatSelector(".actions button.blue"))&&!root.querySelector(nativeCompatSelector(".actions button.blue")).disabled,
            skipLegal:!!root?.querySelector?.(nativeCompatSelector(".actions button.ghost"))&&!root.querySelector(nativeCompatSelector(".actions button.ghost")).disabled,
            rerolls:r.rerolls,skips:r.skips,history,moveAvailability:this.plan?.moveAvailability});
      }
      if(modal.kind==="shop"){
        const stock=r.shop?.stock||[],evaluation=chooseOfferAction(stock.map(entry=>entry.key),
          {...context,purpose:"shop"},this.bridge,{kind:"itemChoice",costSettings,legal:index=>{
            const entry=stock[index];return !!entry&&!entry.sold&&rules.shop!==false&&
              this.canSpend(r,Number(entry.price),rules)&&legal(index)&&
              (typeof r.player.canHold!=="function"||r.player.canHold(entry.key));}}),
          choices=(evaluation.candidates||[]).filter(candidate=>(candidate.score>0||candidate.experiencePriority>0)&&
            (evaluation.reason!=="forced-native-positive-cost"||candidate.index===evaluation.index))
            .sort((a,b)=>b.score-a.score||Number(stock[a.index].price)-Number(stock[b.index].price)||a.index-b.index);
        if(!["forced-native-positive-cost","character-evasion-priority"].includes(evaluation.reason)){
          const procurement=this.towerShopDecision(r,build,rules,index=>legal(index)&&choices.some(row=>row.index===index));
          return {...evaluation,action:procurement.index===null?"leave":"choose",index:procurement.index,
            score:procurement.candidates[0]?.score??null,candidates:procurement.candidates,procurement,reason:"shop-benefit-per-gold"};
        }
        return choices.length?{...evaluation,action:"choose",...choices[0],candidates:choices}:
          {...evaluation,action:"leave",index:null,candidates:[]};
      }
      return null;
    },
    costModalSelectionAllowed(modal,root,index) {
      if(!this.enabled||!this.controlIdentityCurrent()||!this.nativeModalCurrent(modal,root))return false;
      if(modal.kind==="itemChoice"&&unresolvedNativeItemOffer(modal.offers?.[index],
          {player:this.app.run.player,build:this.decisionBuild(this.app.run)},this.bridge))return false;
      if(["upgrade","blessing","itemChoice"].includes(modal.kind)&&!this.characterItemPriorityActive(this.app.run)&&
          !modal.offers?.some(raw=>costOfferDescriptor(typeof raw==="string"?{kind:"item",id:raw}:raw,this.bridge).cost))return true;
      const decision=this.costModalDecision(modal,root);
      return !decision||decision.action==="choose"&&decision.index===index;
    },
    goalWorldInteraction(r,kind) {
      const goal=this.plan?.goalInteraction;
      if(this.app?.run!==r||!goal||goal.kind!==kind||!this.goalInteractionScopeCurrent(r))return null;
      if(kind==="fossil"&&["helix","dome","amber"].includes(goal.key)) {
        if((r.shrines?.fossil || []).includes(goal.key)||
            Number(this.unlockCommittedProfile?.counters?.["fossil_"+goal.key])>0)return null;
        return goal;
      }
      if(kind==="rhydon"&&!r.bossSpawned&&Number(r.shrines?.roars || 0)<(Number(goal.count)||3))return goal;
      if(kind==="slots"&&["seven","gengar"].includes(goal.prize)&&
          Number(r.slotPrizes?.[goal.prize] || 0)<(Number(goal.count)||1))return goal;
      return null;
    },
    goalInteractionScopeCurrent(r) {
      const scope=this.plan?.goalInteractionScope,mode=r?.tower?"tower":r?.endless?"endless":"standard";
      return !scope||(!scope.mode||scope.mode===mode)&&(!scope.biome||scope.biome===r?.biome?.id)&&
        (!Number.isInteger(scope.tier)||Number(r?.tier)>=scope.tier);
    },
    goalBlocksBoss(r) {
      // An adopted run may already have passed the stage containing this NPC.
      // Preserve its unlock goal for a later run, without trapping this healthy
      // run at a shrine where no remaining interaction can satisfy the step.
      return this.characterMechanicFinishHold(r).holding||this.interactionRules().risky===true&&!!this.goalWorldInteraction(r,"rhydon") &&
        (r.interactables?.list || []).some(object => object.kind === "rhydon" &&
          object.used !== true && this.cooperativeInteractionPolicy(r,object).allowed);
    },
    foresightEnemy(r) {
      const scope=this.controlIdentityScope,plan=this.plan,en=r?.enemies;
      if(!this.enabled||this.autoManageSelected()||this.app?.run!==r||this.run!==r||this.planRun!==r||
          r?.state!=="play"||r.player?.dead||!scope||scope.app!==this.app||scope.meta!==this.app.meta||scope.account!==this.app.meta.account||
          this.settings.mode!=="achievements"||this.settings.unlockTargets?.achievements!=="achievements:foresight"||
          plan?.goalProgress?.requestedId!=="achievements:foresight"||plan.goalInteraction?.kind!=="foresight"||!this.goalInteractionScopeCurrent(r)||
          Number(this.unlockCommittedProfile?.counters?.diedAlakazam)>0)return null;
      let found=null,best=Infinity;
      for(let index=0;index<(en?.n || 0);index++) {
        if(en.species?.[index]!==65||!en.alive?.[index]||en.dying?.[index]>0||en.flags?.[index]&16512)continue;
        const d=Math.hypot(en.x[index]-r.player.pos.x,en.z[index]-r.player.pos.z);
        if(d<best){best=d;found=index;}
      }
      return found;
    },
    worldInteractionCost(r, object) {
      return nativeWorldInteractionCost(r, object);
    },
    worldInteractionDescription(r, object, nativeObjects) {
      if(this.compatibility?.maintenanceScope?.allowRifts===true&&r.rifts?.isInside&&object.kind==='portal')
        return {id:interactionTargetId(object),kind:'portal',eligible:r.rifts.inside?.phase==='won',
          free:false,paid:false,cost:0,reason:'native-rift-return',conditionKey:JSON.stringify([r.rifts.count,r.rifts.inside?.phase])};
      if(this.flightState(r).noInteractions)return {id:interactionTargetId(object),kind:object.kind,
        eligible:false,free:false,paid:false,cost:0,reason:"flight-no-interactions",conditionKey:"flight-no-interactions"};
      const dwell = object.kind === "portal" ? shinyStageDwell(r,this.settings,this.plan) : null;
      if (dwell?.holding) return { id: interactionTargetId(object), kind: object.kind, eligible: false,
        free: false, paid: false, cost: 0, reason: "shiny-stage-dwell",
        conditionKey: JSON.stringify([r.stage, dwell.seconds, false]) };
      if(object.kind==="portal"&&this.finalRewardCleanupState(r).holding)return {
        id:interactionTargetId(object),kind:object.kind,eligible:false,free:false,paid:false,cost:0,
        reason:"final-boss-reward-cleanup",conditionKey:`final-boss-reward-cleanup:${r.stage}`};
      if(object.kind==='portal'&&this.bonkCleanupState(r).holding)return {
        id:interactionTargetId(object),kind:object.kind,eligible:false,free:false,paid:false,cost:0,
        reason:'finite-bonk-cleanup',conditionKey:`finite-bonk-cleanup:${r.stage}`};
      const completion=object.kind==="portal"?this.completionGoalState(r):null;
      if(completion?.holdFinish||completion?.waitTime)return {id:interactionTargetId(object),kind:object.kind,eligible:false,
        free:false,paid:false,cost:0,reason:"pending-legal-goal-completion",
        conditionKey:JSON.stringify([r.stage,completion.holdFinish,completion.waitTime])};
      if(this.leaderboardCampBlocks(r,object))return {id:interactionTargetId(object),kind:object.kind,eligible:false,free:false,paid:false,cost:0,
        reason:this.leaderboardCampState(r)?.kind==="endless"?"leaderboard-survival-camp":"leaderboard-kills-camp",
        conditionKey:`leaderboard-camp:${r.stage}:${r.migrations ?? 0}`};
      const coopPolicy=this.cooperativeInteractionPolicy(r,object);
      if(!coopPolicy.allowed)return {id:interactionTargetId(object),kind:object.kind,eligible:false,free:false,paid:false,cost:0,
        reason:coopPolicy.reason,conditionKey:coopPolicy.reason};
      const money=this.towerMoneyPolicy(r);
      if(money.active && (object.kind==="chest"&&this.worldInteractionCost(r,object)>0 || object.kind==="meowth"&&!money.spend&&!this.towerExperienceShopAccess(r,true)))
        return {id:interactionTargetId(object),kind:object.kind,eligible:false,free:false,paid:true,cost:0,
          reason:"tower-save-money-after-50",conditionKey:`tower-saving:${r.tower.floor}`};
      if(object.kind==="chest"&&this.worldInteractionCost(r,object)>0&&this.towerShopPreviewTarget(r,nativeObjects))
        return {id:interactionTargetId(object),kind:object.kind,eligible:false,free:false,paid:true,cost:0,
          reason:"tower-shop-before-balls",conditionKey:`tower-preview:${r.tower.floor}`};
      if(object.kind==="portal" && r.coop?.portalReady)return {
        id:interactionTargetId(object),kind:object.kind,eligible:false,free:false,paid:false,cost:0,
        reason:"native-cooperative-portal-ready",conditionKey:"native-cooperative-portal-ready"};
      if(this.autoManagePreserving(r) && ["bill","hypno"].includes(object.kind))return {
        id:interactionTargetId(object),kind:object.kind,eligible:false,free:false,paid:false,cost:0,
        reason:"auto-manage-preserves-loadout",conditionKey:"auto-manage-preserves-loadout"};
      if (["portal", "boss", "shrine"].includes(object.kind)) {
        const goalBlocked = object.kind !== "portal" && this.goalBlocksBoss(r);
        const eligible = goalBlocked?false:object.kind === "portal"
          ? r.endless ? r.endless.portal === object && r.endless.portalLeft > 0 : !!r.stageCleared
          : !object.used && !r.bossSpawned && !r.boss?.alive && !(object.kind === "boss" && r.mewtwo?.active);
        return { id: interactionTargetId(object), kind: object.kind, eligible,
          free: false, paid: false, cost: 0, priorityBand: 3,
          reason: eligible ? null : "native-progression-unavailable",
          conditionKey: JSON.stringify([object.kind, r.stage, !!r.bossSpawned, !!r.stageCleared,
            !!r.mewtwo?.active, !!r.endless?.portalLeft, goalBlocked]) };
      }
      const build = this.decisionBuild(r,'choice',false);
      const replacement = ["bill","hypno"].includes(object.kind) ? this.finalReplacement(r) : {};
      const customTutor = object.kind === "hypno" ? this.customTutorReplacement(r,replacement,build) : null;
      const tactical = this.tacticalState(r);
      const goalTrade=this.goalWorldInteraction(r,object.kind),
        rules = goalTrade ? {...this.interactionRules(),
          ...(goalTrade.kind==="slots"?{paid:true,roulette:true}:{})} : object.kind==="meowth"?this.towerShopRules(r):this.interactionRules();
      // The explicit roar goal strengthens the next boss without consuming
      // current HP. Reusing the HP-cost trade gate here can deadlock a run
      // with no healing source: it rejects both the NPC and the held boss.
      const costSettings=this.costStrategySettings(r),forcedCost=costSettings.forceCostInteractions,
        allowRisky = forcedCost ? true : goalTrade ? rules.risky===true&&(goalTrade.kind === "rhydon" || tactical.hpRatio>=.6)&&!r.boss?.alive :
        ["porygon","fossil","cursed","cursedchest","greed"].includes(object.kind)
          ? offensiveRiskAllowed({player:r.player,nativeRun:r,luckOnlyExperience:this.settings.modeSettings?.tower?.onlyExperience === true,experienceBlessingPriority:this.settings.modeSettings?.tower?.experienceBlessingPriority === true,build,objective:this.plan?.objective},
            {risky:rules.risky,safeMode:this.settings.safeMode,pressure:tactical.pressure,forceCostInteractions:forcedCost})
          : rules.risky === true && !this.riskyVisits?.size && this.challengeReady(r, tactical) &&
            (Number(r.curses) || 0) < 1 && (Number(r.greed) || 0) < 1;
      const trade=object.kind==="porygon"&&Array.isArray(object.data?.offers)?chooseNativeTrade({offers:object.data.offers},
        {player:r.player,build,costPolicy:this.costStrategySettings(r),nativeRun:r,luckOnlyExperience:this.settings.modeSettings?.tower?.onlyExperience === true,experienceBlessingPriority:this.settings.modeSettings?.tower?.experienceBlessingPriority === true,objective:this.plan?.objective},this.bridge,
        {kind:"porygon",risky:rules.risky,allowRisky,costSettings}):null;
      const fusionMoves = object.kind==="bill" ? (r.player.moves || []).filter(move => move && Number(move.level) >= 8 &&
        !["buff", "weather", "fusion"].includes(move.def?.arch)) : [];
      const shopReroll=object.kind==="meowth"&&this.settings.shopPriority===true?this.priorityShopReroll(r):null;
      let shopDecision;
      const description = describeWorldInteraction(r, object, {
        nativeObjects,
        pickupBonkoin: this.settings.pickupBonkoin === true,
        ignoreEnemyThreats:this.flightState(r).active,
        berryCounterPending:object.kind==='berry'&&this.goalMetricPending(r,'berries'),
        rules, safeMode: goalTrade?.kind==="slots"?false:this.settings.safeMode,
        allowChallenge: this.challengeReady(r, tactical),
        allowRisky,forceCostInteractions:forcedCost,costEffectPriorities:costSettings.costEffectPriorities,
        allowBeyond: object.kind==="tower" && this.towerPolicy(r).exitPolicy === "continue",
        allowTowerTrick: object.kind==="tower" && this.towerTrickRequested(r),
        canFuse: replacement.unified?.enabled || replacement.fusion?.enabled || replacement.strictMoves?.enabled
          ? replacement.needsFusion === true && (this.finalFusionAttempts?.get(this.replacementRetryKey(r,replacement)) || 0) < 3
          : fusionMoves.length >= 2,
        fusionKey: object.kind==="bill" ? [(r.player.moves || []).map(move => move ? [move.def?.key, move.level] : null),
          replacement.needsFusion ? this.replacementRetryKey(r,replacement) : null] : undefined,
        tradeUseful: trade?trade.action === "choose":undefined,
        canSpend: (cost) => this.canSpend(r, cost,rules), spent: this.interactionSpent,
        shopRerollAllowed:!!shopReroll,shopRerollKey:shopReroll?[shopReroll.rerolls,shopReroll.cost]:undefined,
        canCopy: object.kind==="ditto" ? !!selectCopyItem(r.player, build, this.bridge,{nativeRun:r,luckOnlyExperience:this.settings.modeSettings?.tower?.onlyExperience === true,experienceBlessingPriority:this.settings.modeSettings?.tower?.experienceBlessingPriority === true,costPolicy:costSettings}) : undefined,
        canTutor: replacement.needsTutor || !!customTutor,
        tutorKey: replacement.needsTutor ? this.replacementRetryKey(r,replacement) : customTutor?.conditionKey,
        copyKey: object.kind==="ditto" ? [...(r.player.items || [])].map(([key, count]) =>
          [key, count, typeof r.player.canHold !== "function" || r.player.canHold(key)]) : undefined,
        shopItemAllowed: (entry) => {
          shopDecision ||= this.towerShopDecision(r,build,rules);
          return shopDecision.candidates.some(row=>(r.shop?.stock || [])[row.index]===entry);
        },
        canRefreshShop: object.kind==="meowth" && this.towerShopCanRefresh(r),
        previewShop: object.kind==="meowth" && this.towerShopPreviewPending(r),
      });
      // Check live balls/XP at selection AND E dispatch. A stale exit target,
      // attraction flag or temporary cooldown is not proof of collection.
      if(description.eligible && r.tower && object.kind==="tower" &&
          ["stairs","portal","leave"].includes(object.data?.sub) &&
          this.towerFloorCleanup(r,nativeObjects)?.pending)
        return {...description,eligible:false,reason:"tower-rewards-pending"};
      if(["cursed","cursedchest","greed","fossil","porygon","rhydon"].includes(object.kind)){
        const descriptor=trade?.action==="choose"?{positiveEffects:trade.positiveEffects}:nativeCostDescriptor("world",object.kind);
        description.cost=true;description.positiveEffects=descriptor.positiveEffects||[];
        description.costRank=trade?.costRank??costPriorityRank(descriptor,costSettings);
        description.forceCostInteractions=forcedCost;
      }
      if (object.kind === "berry" && !this.goalMetricPending(r,'berries')&&
          !healingResourceDecision(r, object, tactical).use)
        return { ...description, eligible: false, reason: "preserve-berry-for-recovery" };
      if (object.kind === "altar") {
        const policy = this.tacticalDirector.altarPolicy(r, object, tactical, this.settings.safeMode !== false);
        if (!policy.allowed) return { ...description, eligible: false, reason: policy.reason };
      }
      return description;
    },
    characterUnlockState(r=this.app?.run) {
      return characterUnlockExecutionState(r,this.legacyCharacterUnlockPlan()?null:this.plan?.unlockExecution);
    },
    goalMetricPending(r,metric) {
      if(this.legacyCharacterUnlockPlan())return this.plan?.metrics?.includes(metric)===true;
      const state=this.characterUnlockState(r);
      if(state.active&&state.conditions.length)return state.pending.some(row=>row.known&&
        (row.source?.key===metric||row.counter?.replace(/^best_/,'')===metric));
      return !this.plan?.unlockExecution&&this.plan?.metrics?.includes(metric)===true;
    },
    characterItemPriorityActive(r=this.app?.run) {
      if(this.legacyCharacterUnlockPlan())return false;
      return !!r&&this.app?.run===r&&this.planRun===r&&(this.plan?.goalMode==="characters"||
        this.plan?.goalSelection?.category==="characters"||
        ["character-batch","character-focus","character-route"].includes(this.plan?.unlockExecution?.kind));
    },
    decisionBuild(r=this.app?.run,purpose='choice',includeFinal=true) {
      let build=characterUnlockDecisionBuild(this.plan?.build||{},r,this.legacyCharacterUnlockPlan()?null:this.plan?.unlockExecution);
      if(includeFinal&&r?.player)build=finalReplacementBuild(build,this.finalReplacement(r));
      // Bind to the executed plan, not a pending next-game settings selection.
      if(this.characterItemPriorityActive(r))build={...build,characterUnlockItemPriority:true};
      return applyTowerStrategy(build,this.settings.modeSettings?.tower||{},r,this.bridge,purpose);
    },
    finalReplacement(r = this.app?.run, options = {}) {
      options={...options,build:this.plan?.build};
      const inactive = this.inactiveFinalReplacement ||= {
        needsTutor:false, needsFusion:false,
        ...Object.fromEntries(["moves","vitamins","fusion"].map(kind => [kind, {
          enabled:false, active:false, targets:[], missing:[], readyMissing:[], forget:[],
        }])),
      };
      if(!r?.player || this.autoManagePreserving(r)) return inactive;
      const p=r.player,mastery=this.masteryState(r),species=String(r.startSpecies || p.speciesId),
        unlock=this.characterUnlockState(r),goalBuild=characterUnlockDecisionBuild(this.plan?.build||{},r,this.legacyCharacterUnlockPlan()?null:this.plan?.unlockExecution),
        autoGoal=unlock.active&&unlock.preferenceHints.preferredMoves.length?recommendedFinalLoadout({...goalBuild,sourceType:'custom',
          moves:[...new Set([...unlock.preferenceHints.preferredMoves,...(p.moves||[]).filter(Boolean).map(move=>move.def?.key),
            ...(goalBuild.moves||[])])].slice(0,4)},this.bridge):null,
        fusionGoal=this.plan?.goalInteraction?.kind==="fusion"&&this.goalInteractionScopeCurrent(r)?{...this.plan.goalInteraction,
          saved:Number(this.unlockCommittedProfile?.counters?.[this.plan.unlockAction?.counter]) || 0}:null,
        stored=mastery.active?mastery.shareKey?{strictMoves:{enabled:true,targets:[mastery.shareKey,null,null,null]},strictVitamins:{enabled:false},moves:{enabled:false},vitamins:{enabled:false},fusion:{enabled:false}}:null:
          (unlock.active&&this.plan.unlockExecution.kind==='character-route'?null:this.settings.finalReplacements?.[species]) || (!this.plan?.challenge&&!this.plan?.goalInteraction?
            autoGoal||recommendedFinalLoadout(goalBuild,this.bridge):null);
      const activeStored=stored?.stageProfiles&&Object.keys(stored.stageProfiles).length?resolveFinalReplacementEntry(stored,r).entry:stored;
      if(!fusionGoal&&(!activeStored || !["strictMoves","strictVitamins"].some(kind=>activeStored[kind]?.enabled===true) &&
          !["moves","vitamins","fusion"].some(kind=>activeStored[kind]?.enabled===true && activeStored[kind].targets?.some(key=>typeof key==='string'&&key)))
        )return inactive;
      const key=JSON.stringify([r.startSpecies,p.speciesId,p.level,p.moveSlots,p.vitaminSlots,p.types,r.nextEvo?.to,r.nextEvo?.level,
        r.mode,r.biome?.id,r.stage,r.migrations,
        (p.moves||[]).map(move=>move?[move.def?.key,move.level,move.parents]:null),
        [...(p.vitamins?.entries?.()||[])].map(([key,value])=>[key,Number(value?.level??value)||0]),
        p.moveCap,p.vitCap,[...(p.items?.keys?.()||[])],!!r.tower,
        [...(r.banished?.values?.()||[])],this.app?.meta?.profile?.league,stored,fusionGoal,fusionGoal?r.fusions:null,
        this.app?.meta?.profile?.settings?.skipEmptyLevelUp, fusionPreservedMoves(this.plan?.build),
        r.tower ? (options.offers || []).map(offer=>[offer.kind,offer.id,!!offer.disabled,!!offer.hidden]) : []]);
      const cached=this.finalReplacementCache;
      if(cached?.run===r && cached.settings===this.settings && cached.bridge===this.bridge && cached.key===key) return cached.value;
      const effective={...this.settings,finalReplacements:{...this.settings.finalReplacements,[species]:stored}},
        value=mutationReplacementState(stored?.fusion?.enabled===true?finalReplacementState(effective,r,this.bridge,options):
          fusionGoal?fusionGoalReplacementState(fusionGoal,r,this.bridge,effective) || inactive:finalReplacementState(effective,r,this.bridge,options),r);
      // Plan learning from the start of a Tower run; replacement/forgetting
      // and actual machine visits retain their configured level threshold.
      if(r.tower && stored && !mastery.active && !fusionGoal) {
        const early={...stored,...Object.fromEntries(["moves","fusion","vitamins"].map(kind=>
          [kind,{...stored[kind],level:1}]))};
        value.towerPursuit=finalReplacementState({...effective,finalReplacements:{[species]:early}},r,this.bridge,options);
      }
      this.finalReplacementCache={run:r,settings:this.settings,bridge:this.bridge,key,value};return value;
    },
    customTutorReplacement(r=this.app?.run,replacement=this.finalReplacement(r),build=this.decisionBuild(r,'choice',false)) {
      // The legacy custom-build fallback is one concrete replacement proposal,
      // not a reason to keep visiting Hypno. An enabled final rule owns its
      // threshold and preparation state even before it becomes active.
      const player=r?.player;
      if(!player||this.autoManagePreserving(r)||build.sourceType!=="custom"||build.replacementPolicy==="never"||
          replacement.unified?.enabled||replacement.fusion?.enabled||replacement.moves?.enabled||replacement.vitamins?.active||
          replacement.strictMoves?.enabled||replacement.strictVitamins?.enabled||replacement.emptySlots?.moves?.active||
          replacement.emptySlots?.vitamins?.active||this.interactionRules().tutor===false)return null;
      const slots=Number(player.moveSlots);
      if(!Number.isInteger(slots)||slots<1||slots>4)return null;
      const held=(player.moves||[]).slice(0,slots).map((move,slot)=>({move,slot})).filter(row=>row.move);
      if(held.length<slots||held.length<=1||this.settings.safeMode&&(r.boss?.alive||!(player.hp/player.maxHp>.7)))return null;
      const wanted=choiceMovePreferences(build).map(row=>row.key),
        missing=wanted.filter(key=>!held.some(({move})=>move.def?.key===key)&&this.plan?.availableMoveKeys?.includes(key)),
        readiness=missing.length?analyzeMoveReadiness({player,nativeRun:r,luckOnlyExperience:this.settings.modeSettings?.tower?.onlyExperience === true,experienceBlessingPriority:this.settings.modeSettings?.tower?.experienceBlessingPriority === true,build:{...build,moves:missing}},this.bridge):[],
        targets=missing.filter(key=>readiness.some(row=>row.key===key&&row.state==="now"));
      if(!targets.length)return null;
      const output=held.filter(row=>!["buff","weather"].includes(row.move.def?.arch)),
        eligible=held.filter(row=>(build.avoidMoves?.includes(row.move.def?.key)||build.replacementPolicy==="weakest"||
          !wanted.includes(row.move.def?.key))&&(!output.includes(row)||output.length>1))
          .sort((a,b)=>Number(build.avoidMoves?.includes(b.move.def?.key))-Number(build.avoidMoves?.includes(a.move.def?.key))||
            (Number(a.move.level)||0)-(Number(b.move.level)||0)||a.slot-b.slot),candidate=eligible[0];
      if(!candidate)return null;
      return {slot:candidate.slot,key:candidate.move.def?.key,targets,
        conditionKey:JSON.stringify([r.startSpecies,player.speciesId,player.level,slots,
          held.map(row=>[row.slot,row.move.def?.key,row.move.level]),targets,build.replacementPolicy,build.avoidMoves||[]])};
    },
    replacementRetryKey(r, replacement) {
      const bucket=Math.floor((Number(r?.time)||0)/30);
      if(this.replacementRetryRun!==r||this.replacementRetryBucket!==bucket){
        this.replacementRetryRun=r;this.finalFusionAttempts=new Map();this.finalForgetAttempts=new Map();
        this.replacementRetryBucket=bucket;
      }
      // Recheck real NPC opportunities during ordinary world-target scans.
      // Cache expensive recipe search by native loadout; time only releases a
      // finite failed-click/visit backoff, never grants new game availability.
      return JSON.stringify([replacement.conditionKey,bucket]);
    },
    challengeReady(r, tactical = this.tacticalState(r)) {
      return this.settings.safeMode === false && !r.boss?.alive && !r.bossSpawned &&
        r.stageTime < 180 && tactical.hpRatio >= 0.82 && tactical.pressure < 1 &&
        tactical.activeMoves >= 2 && tactical.moveLevels >= 8 &&
        !(r.interactables?.list || []).some(object => object.kind === "challenge" &&
          object.used && (object.data?.pending > 0 || object.data?.left > 0));
    },
    worldInteractionAllowed(r, object, nativeObjects) {
      const mastery=this.masteryState(r);
      if(mastery.avoidXp&&["magnet","cage","greed"].includes(object.kind)&&
          !(object.kind==="greed"&&this.settings.forceCostInteractions===true)||mastery.avoidHealing&&object.kind==="berry")return false;
      if (this.blocked.get(object) > r.time) return false;
      if (!["portal", "boss", "shrine"].includes(object.kind) && r.boss?.alive && typeof r.terrain.inBounds === "function" &&
          !this.withinArena(r, object.x, object.z, 6)) return false;
      return this.interactionTracker.canTarget(r, object,
        this.worldInteractionDescription(r, object, nativeObjects));
    },
    canSpend(r, cost, rules=this.interactionRules()) {
      return canSpendGold(
        cost,
        r.gold,
        rules,
        this.interactionSpent + (this.pendingInteractionSpend?.cost || 0),
      );
    },
    nativeModalCurrent(modal,root) {
      const r=this.app?.run,currentRoot=r?.ui?.modalEl?.isConnected ? r.ui.modalEl : null;
      return !!r && this.modal===modal && modal.run===r && ["modal","paused"].includes(r.state) &&
        currentRoot===root && root?.isConnected!==false &&
        (!root || !Object.hasOwn(modal,"root") || modal.root===root) &&
        (!Object.hasOwn(modal,"stage") || modal.stage===r.stage) &&
        (!Object.hasOwn(modal,"terrain") || modal.terrain===r.terrain);
    },
    discardStaleModal(modal) {
      if(this.requiredSelectionPause?.modal===modal)this.requiredSelectionPause=null;
      if(this.modal===modal){this.modal=null;this.cadence.reset("native-modal-replaced");}
    },
    flightOptionalModalExit(modal,root) {
      // Item's ghost action sells the reward; it is not Cancel. Only an
      // actual, enabled native exit on this still-current page is evidence
      // that an optional interaction can be declined. Forced/disabled-exit
      // pages keep normal choice handling rather than waiting forever.
      const selector=["shop","forget"].includes(modal?.kind)?".shop-exit":
        ["ditto","slots","fusion","trade","pact"].includes(modal?.kind)?".actions button.ghost":null,
        button=selector&&root?.querySelector?.(nativeCompatSelector(selector));
      return button&&!button.disabled&&button.hidden!==true&&button.getAttribute?.("aria-disabled")!=="true"&&
        !this.runEndingButton(button)?selector:null;
    },
    modalAction(modal, root, action, type, message, policyExit = false, commitGuard = null) {
      if(!this.nativeModalCurrent(modal,root)){this.discardStaleModal(modal);return false;}
      if(!policyExit&&this.flightState(this.app.run).noInteractions&&this.flightOptionalModalExit(modal,root))return false;
      if(!policyExit){const policy=this.cooperativeModalPolicy(this.app.run,modal);if(!policy.allowed){
        this.cadence.reset("cooperative-policy");this.status=this.cooperativePolicyMessage(policy);return false;}}
      const r = this.app.run,
        now = performance.now();
      if (modal.lastActionAt != null && now - modal.lastActionAt < 700)
        return true;
      if (!this.safeAction("modal", modal, message || type || "处理安全选择页面", "selection")) return true;
      if(!this.nativeModalCurrent(modal,root)){this.discardStaleModal(modal);return false;}
      if(!policyExit&&this.flightState(r).noInteractions&&this.flightOptionalModalExit(modal,root))return false;
      if(!policyExit){const policy=this.cooperativeModalPolicy(r,modal);if(!policy.allowed){
        this.cadence.reset("cooperative-policy");this.status=this.cooperativePolicyMessage(policy);return false;}}
      if(typeof commitGuard==="function"&&commitGuard()!==true){
        this.cadence.reset("cost-policy-rechecked");return false;
      }
      const before = Number(r.gold) || 0,
        initialState = r.state;
      modal.lastActionAt = now;
      modal.attempts = (modal.attempts || 0) + 1;
      this.modal = null;
      const auditAttempt = recording()?.attempt(modal, type, message);
      try {
        action();
        recording()?.receipt(auditAttempt, r);
      } catch (error) {
        this.completeSafeAction("modal", modal);
        this.modal = modal;
        recording()?.receipt(auditAttempt, r, error);
        this.status = "交互未完成，正在重试：" + String(error.message || error);
        return false;
      }
      this.completeSafeAction("modal", modal);
      this.interactionSpent += Math.max(0, before - (Number(r.gold) || 0));
      const visitKind = modal.kind === "trade" && ["fossil", "porygon", "tower"].includes(modal.entity?.kind)
        ? modal.entity.kind : { shop: "meowth", forget: "hypno", slots: "slots", ditto: "ditto", fusion:"bill" }[modal.kind];
      const entity = visitKind && modal.entity?.kind === visitKind ? modal.entity : null;
      if(modal.kind==="shop"&&initialState!==r.state&&r.state==="play"&&this.towerMoneyPolicy(r).preview)
        this.towerShopPreviewVisit={run:r,terrain:r.terrain,floor:r.tower.floor};
      if (entity && initialState !== r.state && r.state === "play") {
        if (entity.used && ["fossil", "porygon"].includes(entity.kind)) this.riskyVisits.add(entity.kind);
        this.interactionTracker.recordOutcome(r, entity, {
          visitFinished: true,
          changed: !!entity.used || before !== Number(r.gold),
          conditionKey: this.worldInteractionDescription(r, entity).conditionKey,
        });
        this.lastWorldInteraction = null;
      }
      if (
        !this.modal &&
        ["modal", "paused"].includes(r.state) &&
        r.ui.modalEl?.isConnected
      ) {
        // A successful native shop/tutor action can synchronously repaint its
        // own page. Adopt only that just-executed, still-same-phase repaint;
        // unrelated replacement pages remain fenced above on the next call.
        if (["shop","forget","ditto","slots"].includes(modal.kind) &&
            (!Object.hasOwn(modal,"stage") || modal.stage===r.stage) &&
            (!Object.hasOwn(modal,"terrain") || modal.terrain===r.terrain)) modal.root=r.ui.modalEl;
        this.modal = modal;
      }
      if (
        type &&
        (r.state !== initialState ||
          r.ui.modalEl !== root ||
          before > (Number(r.gold) || 0))
      ) {
        this.recordEvent({
          id: `choice-${Date.now()}-${this.frames}-${modal.attempts}`,
          kind: "choice",
          type,
          at: Date.now(),
          message,
        });
        if (this.events.length > 300)
          this.events.splice(0, this.events.length - 300);
      }
      return true;
    },
    runEndingButton(button) {
      const label = String(button?.innerText ?? button?.textContent ?? "");
      return /结束(?:本局|对局|游戏)|放弃(?:本局|对局|游戏)|退出(?:本局|对局|游戏)|重开|重新(?:开始|开局|挑战)|再来一局|restart|reiniciar|abandonar|\bquit\b|end (?:the )?(?:run|game)|give up|start over|new run|^\s*放弃\s*$/i.test(label);
    },
    modalExit(
      modal,
      root,
      selector = ".actions button.ghost",
      argument = null,
    ) {
      const button = root?.querySelector?.(nativeCompatSelector(selector));
      if (button?.disabled || modal.kind === "unknown" && this.runEndingButton(button)) return false;
      if (button && !button.disabled)
        return this.modalAction(modal, root, () => button.click(),undefined,undefined,true);
      if (
        modal.kind === "slots" &&
        modal.spun &&
        (!modal.slotObservation?.paid ||
          performance.now() - (modal.lastActionAt || modal.at) < 6000)
      )
        return false;
      if (
        performance.now() - modal.at > 2500 &&
        typeof modal.choose === "function"
      )
        return this.modalAction(modal, root, () => modal.choose(argument),undefined,undefined,true);
      return false;
    },
    handleModal() {
      const r = this.app?.run;
      if (!this.enabled || !r || !["modal", "paused"].includes(r.state)) return;
      if(!this.controlIdentityCurrent() || !this.autoManageCurrent(r))return;
      this.syncTravelModeMotion(r);
      const root = r.ui?.modalEl?.isConnected ? r.ui.modalEl : null;
      let modal = this.modal;
      if(modal && !this.nativeModalCurrent(modal,root)){this.discardStaleModal(modal);return;}
      if (!modal)
        this.modal = modal = {
          kind: r.state === "paused" ? "pause" : "unknown",
          at: performance.now(),
          run: r,
          stage:r.stage,terrain:r.terrain,root,
        };
      if(modal.kind === "unknown" && this.compatibility?.maintenanceScope) {
        this.stop("当前页面尚未适配，辅助已停止；游戏仍保持原生状态，请手动处理后继续",{source:"native-choice-required",code:"unknown-native-page"});return;
      }
      if(modal.kind === "relic") {
        const decide=()=>this.interactionRules().free===false?{action:'leave'}:
          chooseRelicAction(modal.offers,r,{rules:this.interactionRules()});
        const decision=decide();
        this.lastRelicDecision=decision;
        recording()?.safe(()=>recording().evaluated(modal,decision));
        if(decision.action==='choose'&&typeof modal.choose==='function'){
          const current=()=>{const next=decide();return next.action==='choose'&&next.key===decision.key&&
            next.index===decision.index&&next.replaceIndex===decision.replaceIndex;};
          this.modalAction(modal,root,()=>modal.choose(decision.key,decision.replaceIndex),'relic',
            '通过原生遗物页面'+(decision.replaceIndex==null?'装备':'替换')+'：'+decision.key,false,current);
        }else this.modalExit(modal,root,'.actions button.ghost');
        return;
      }
      if(modal.kind === "dojo") {
        // Current showDojo's fourth argument accepts null for "Ahora no".
        // M2 neither starts a trial nor spends/marks the optional dojo.
        this.modalExit(modal,root,".dj-acts button.ghost");return;
      }
      const coopPolicy=this.cooperativeModalPolicy(r,modal);
      const flightExit=this.flightState(r).noInteractions&&this.flightOptionalModalExit(modal,root);
      if(this.flightState(r).noInteractions&&modal.kind==="slots"&&modal.slotObservation?.paid&&root?.querySelector?.(nativeCompatSelector(".sl-cab.spinning"))){
        const exit=root?.querySelector?.(nativeCompatSelector(".actions button.ghost")),skip=root?.querySelector?.(nativeCompatSelector(".actions button.green"));
        if(exit?.disabled===true&&skip&&!skip.disabled&&!skip.hidden)
          this.modalAction(modal,root,()=>skip.click(),undefined,"完成已付款的原生抽奖动画",true);
        return;
      }
      if(flightExit){
        this.status="飞行移动：已达气球数量，离开可取消交互；原生必选强化照常处理";
        this.modalExit(modal,root,flightExit);
        return;
      }
      if(!coopPolicy.allowed){
        this.status=this.cooperativePolicyMessage(coopPolicy);
        if(modal.kind==="slots" && modal.slotObservation?.paid){
          const exit=root?.querySelector?.(nativeCompatSelector(".actions button.ghost")),skip=root?.querySelector?.(nativeCompatSelector(".actions button.green"));
          if(root?.querySelector?.(nativeCompatSelector(".sl-cab.spinning")) && exit?.disabled===true && skip && !skip.disabled && !skip.hidden)
            this.modalAction(modal,root,()=>skip.click(),undefined,"完成已付款的原生抽奖动画",true);
          else if(exit && !exit.disabled)this.modalExit(modal,root);
          return;
        }
        if(["shop","forget","ditto","slots","fusion","trade","itemChoice","item"].includes(modal.kind))
          this.modalExit(modal,root,["shop","forget"].includes(modal.kind)?".shop-exit":".actions button.ghost");
        else this.status+="；原生必选页面保留，请手动选择或关闭该类限制";
        return;
      }
      if (this.settings.randomDelay === false && performance.now() - modal.at < 500) return;
      const rules = this.interactionRules(),
        replacement = this.finalReplacement(r),
        build = this.decisionBuild(r);
      const preserving=this.autoManagePreserving(r);
      const legal = (button) =>
        button &&
        (modal.kind !== "unknown" || !this.runEndingButton(button)) &&
        !button.disabled &&
        button.hidden !== true &&
        button.getAttribute?.("aria-disabled") !== "true";
      const nativeCards = [...(root?.querySelectorAll?.(nativeCompatSelector(".cards button.card")) || [])];
      // Native 0.9.8 inserts the current-form/everstone card before the
      // evolution offers. Its callback is -1, never offers[0].
      const cards = modal.kind === "branch" && modal.branchOptions?.stay ? nativeCards.slice(1) : nativeCards;
      const liveItemAllowed = (key, purpose) => {
        const freshRules=this.interactionRules();
        if(purpose==="shop" ? this.towerShopRules(r,freshRules).shop===false : freshRules.free===false || purpose==="copy" && freshRules.copy===false)return false;
        return evaluateItemDecision(key,{player:r.player,nativeRun:r,luckOnlyExperience:this.settings.modeSettings?.tower?.onlyExperience === true,experienceBlessingPriority:this.settings.modeSettings?.tower?.experienceBlessingPriority === true,purpose,
          costPolicy:this.costStrategySettings(r),build:this.decisionBuild(r,purpose==="shop"?"shop":"choice"),objective:this.plan?.objective},this.bridge).eligible;
      };
      const actionStillAllowed = (button,type) => {
        const index=cards.indexOf(button);
        if(modal.kind==="shop" && type==="shopPurchase"){
          // modalAction clears its captured modal before invoking the native
          // callback; identity was checked by commitGuard immediately before it.
          const current=this.costModalDecision(modal,root);
          return current?.action==="choose"&&current.index===index;
        }
        if(modal.kind==="shop" && type==="shopReroll" && this.towerMoneyPolicy(r).spend)return this.towerShopCanRefresh(r) &&
          this.costModalDecision(modal,root)?.action!=="choose";
        if(modal.kind==="ditto" && type==="ditto")return liveItemAllowed([...r.player.items.keys()][index],"copy");
        if(modal.kind==="item" && ["item","itemSold"].includes(type))return (type==="item")===liveItemAllowed(modal.offers,"free");
        return true;
      };
      const action = (button, type, message, performed, beforeClick, commitGuard) =>
        legal(button) &&
        this.modalAction(
          modal,
          root,
          () => { if (legal(button) && actionStillAllowed(button,type)) { beforeClick?.(); button.click(); performed?.(); } },
          type,
          message ||
            (button.innerText ?? button.textContent)?.trim().replace(/\s+/g, " ").slice(0, 180),
          false,commitGuard,
        );
      if(preserving && modal.kind==="unknown" && cards.length) {
        this.lastChoiceReason="auto-manage-unobserved-page";
        this.status="自动托管：无法确认接管前已打开页面是否保留原有搭配，请手动选择或开启配装最高优先级";
        return;
      }
      if (modal.kind === "unknown" && (
          this.modalExit(modal, root, ".shop-exit") ||
          this.modalExit(modal, root, ".actions button.ghost") ||
          action(root?.querySelector?.(nativeCompatSelector(".back-btn, .close-btn, button[aria-label='Close']"))))) return;
      if (r.state === "paused") {
        const back = root?.querySelector?.(nativeCompatSelector(".back-btn"));
        if (
          ["map", "pauseSettings", "moveGuide", "fusionGuide", "mapLegend"].includes(
            modal.kind,
          )
        ) {
          if (back?.disabled) return;
          if (action(back)) return;
          if (typeof r.ui.pauseBack === "function") {
            this.modalAction(modal, root, () => r.ui.pauseBack());
            return;
          }
        }
        // Native detail/feedback overlays can sit above the pause screen.
        // Unwind their original back callback before using Continue beneath.
        if (typeof r.ui.pauseBack === "function") {
          this.modalAction(modal, root, () => r.ui.pauseBack());
          return;
        }
        if (action(root?.querySelector?.(nativeCompatSelector("button.green.big")))) return;
        if (
          performance.now() - modal.at > 2500 &&
          typeof r.resume === "function"
        )
          this.modalAction(modal, root, () => r.resume()); // Native Continue action, only in a paused information page.
        return;
      }
      if(preserving && ["fusion","forget"].includes(modal.kind)) {
        this.modalExit(modal,root,modal.kind==="forget"?".shop-exit":".actions button.ghost");return;
      }
      if(modal.kind === "branch" && modal.branchOptions) {
        const target=this.plan?.evolutionTarget, path=this.plan?.evolutionPath||[], options=modal.branchOptions;
        if(options.stay && Number(target)===Number(options.stay)) {
          if(options.stone!=="missing" && action(nativeCards[0],"branch","按原方案保持当前形态"))return;
          this.stop("当前形态需要已有不变之石；未自动购买，请确认原生分支",{source:"native-choice-required",code:"evolution-stay-unavailable"});return;
        }
        const requested=(modal.offers||[]).some(id=>Number(id)===Number(target)||path.includes(Number(id)));
        if(!requested && ((modal.offers||[]).length!==1 || options.stay)) {
          this.stop("当前进化分支没有已配置目标，原生没有默认选择，请在游戏中选择后继续辅助",{source:"native-choice-required",code:"evolution-target-required"});return;
        }
      }
      if (modal.kind === "pact") {
        if (r.tower) {
          const decision = chooseTowerCurseAction(modal.offers,r,
            {legal:index => !cards.length || !!legal(cards[index]),data:this.bridge,build,rules,
              cursePriority:this.settings.modeSettings?.tower?.cursePriority,
              experienceBlessingPriority:this.settings.modeSettings?.tower?.experienceBlessingPriority===true,
              spent:(this.interactionSpent || 0)+(this.pendingInteractionSpend?.cost || 0)});
          recording()?.safe(() => recording().evaluated(modal, decision, index => !cards[index] || legal(cards[index])));
          if (decision.action === "choose") {
            const message = "选择第"+decision.targetFloor+"层诅咒："+(modal.offers[decision.index]?.name || decision.id);
            if (action(cards[decision.index],"towerCurse",message)) return;
            // Only recover a missing DOM with the captured original callback;
            // never bypass a visible disabled card or invent an unoffered curse.
            if (!cards.length && performance.now()-modal.at > 2500 && typeof modal.choose === "function")
              this.modalAction(modal,root,()=>modal.choose(modal.offers[decision.index]),"towerCurse",message);
            return;
          }
          this.modalExit(modal, root);return;
        }

        if(modal.attempts>=3&&!this.nativeCostMandatory(modal,root)){this.modalExit(modal,root);return;}
        const decision=this.costModalDecision(modal,root),guard=()=>this.costModalSelectionAllowed(modal,root,decision.index);
        recording()?.safe(() => recording().evaluated(modal, decision, index => !cards[index] || legal(cards[index])));
        if(decision.action==='choose'){
          if(action(cards[decision.index],'pact',decision.reason==='requested-native-vitamin-slot'?'通过原生契约增加维生素槽位':'通过原生契约选择当前有益强化',undefined,undefined,guard))return;
          if(!guard())return;
          if(performance.now()-modal.at>2500&&typeof modal.choose==='function'){
            this.modalAction(modal,root,()=>modal.choose(modal.offers[decision.index]),'pact','通过原生契约回调完成选择',false,guard);return;
          }
        }
        this.modalExit(modal, root);
        return;
      }
      if (modal.kind === "fusion" || modal.kind === "trade") {
        const entity = modal.entity;
        const decision = modal.kind === "fusion" && rules.free !== false
          ? chooseFusionAction(modal.offers,{player:r.player,build},this.bridge)
          : modal.kind === "trade" && entity && (entity.kind !== "tower" || rules.free !== false || this.towerTrickRequested(r))
            ? this.costModalDecision(modal,root) : {action:"leave"};
        recording()?.safe(() => recording().evaluated(modal, decision, index => !cards[index] || legal(cards[index])));
        const plannedFusion = modal.kind === "fusion" && replacement.fusion?.enabled;
        const retryKey = plannedFusion ? this.replacementRetryKey(r,replacement) : null;
        this.finalFusionAttempts ||= new Map();
        const attempts = plannedFusion ? this.finalFusionAttempts.get(retryKey) || 0 : modal.attempts || 0;
        // The current Bill machine has pair rows plus a separate confirmation,
        // and its native callback receives (pairIndex, "fuse" | "link").
        // Submit the reviewed native fusion callback explicitly; never inherit
        // a user-selected link tab or mistake a pair preview for completion.
        if(modal.kind === "fusion" && root?.querySelector?.(".bm-go") && typeof modal.choose === "function") {
          if(attempts<3 && decision.action === "choose") {
            const current=()=>{const fresh=chooseFusionAction(modal.offers,{player:r.player,build:this.decisionBuild(r)},this.bridge);return fresh.action==="choose"&&fresh.index===decision.index;};
            if(this.modalAction(modal,root,()=>{
              if(plannedFusion)this.finalFusionAttempts.set(retryKey,attempts+1);
              modal.choose(decision.index,"fuse");
            },"fusion","通过原生正辉机器确认方案融合",false,current))return;
          }
          this.modalExit(modal,root);return;
        }
        if (attempts < 3 && decision.action === "choose" && action(cards[decision.index],modal.kind,
          (modal.kind === "fusion" ? "通过原生机器融合招式：" : "通过原生页面确认交换：")+decision.key,
          undefined, plannedFusion ? () => this.finalFusionAttempts.set(retryKey,attempts+1) : undefined,
          modal.kind==="trade"?()=>this.costModalSelectionAllowed(modal,root,decision.index):undefined)) return;
        if(modal.kind==="trade"&&decision.action==="choose"&&!this.costModalSelectionAllowed(modal,root,decision.index))return;
        // Never select a locked recipe or unknown permanent trade. The exact
        // native null callback is the same legitimate exit as its ghost button.
        this.modalExit(modal,root);
        return;
      }
      if (modal.kind === "shop") {
        if(this.towerMoneyPolicy(r).active&&!this.towerMoneyPolicy(r).spend&&!this.towerExperienceShopAccess(r)){this.modalExit(modal,root,".shop-exit");return;}
        if(this.settings.shopPriority===true&&(this.priorityShopState(r)?.failed||this.priorityCapturePending(r))){
          this.modalExit(modal,root,".shop-exit");return;
        }
        const decision=this.costModalDecision(modal,root),stock=r.shop?.stock||[],
          guard=()=>this.costModalSelectionAllowed(modal,root,decision.index);
        recording()?.safe(() => {recording().evaluated(modal,decision,index=>legal(cards[index]));
          recording().event("shop_evaluation",{decisionId:recording().page(modal)?.decisionId,selectedIndex:decision.index,
            candidates:recording().plain(decision.procurement?.evaluations||decision.candidates),evaluation:recording().plain(decision)});});
        if(decision.action==="choose"){

          const entry=stock[decision.index],count=Number(r.player.items?.get?.(entry.key))||0;
          if(action(cards[decision.index],"shopPurchase","已通过原生商店购买："+entry.key,
              ()=>{if(this.settings.shopPriority===true){const state=this.priorityShopState(r);
                if(state){if(entry.sold||Number(r.player.items?.get?.(entry.key))>count){state.purchases++;state.emptyRerolls=0;}
                  else {state.failed=true;state.failedStock=r.shop?.stock;}}}},undefined,guard))return;
          if(!guard())return;
        }
        if(this.settings.shopPriority===true){
          const reroll=this.priorityShopReroll(r,root);
          if(reroll){
            const current=()=>{const next=this.priorityShopReroll(r,root);return !!next&&next.state===reroll.state&&
              next.stock===reroll.stock&&next.rerolls===reroll.rerolls&&next.cost===reroll.cost&&
              this.costModalDecision(modal,root)?.action!=="choose";};
            if(action(reroll.button,"shopReroll","通过原生商店刷新货架",()=>{
                if(r.shop?.stock!==reroll.stock&&Number(r.shop?.rerolls)>reroll.rerolls){
                  reroll.state.rerolls++;reroll.state.emptyRerolls++;
                }else {reroll.state.failed=true;reroll.state.failedStock=r.shop?.stock;}
              },undefined,current))return;
          }
        }
        if(decision.action!=="choose" && this.towerShopCanRefresh(r)) {
          const refresh=root?.querySelector?.(nativeCompatSelector(".shop-reroll"));
          if(action(refresh,"shopReroll","50层后攒钱：刷新喵喵商店",()=>{
            const changed=r.gold!==modal.shopRefreshBefore.gold || r.shopRerolls!==modal.shopRefreshBefore.rerolls ||
              r.shop?.stock!==modal.shopRefreshBefore.stock;
            modal.shopRefreshFailures=changed?0:(modal.shopRefreshFailures || 0)+1;
            const ledger=this.towerShopRefreshLedger(r);
            if(changed&&ledger)ledger.pending={rerolls:modal.shopRefreshBefore.rerolls,stock:modal.shopRefreshBefore.stock};
            if(modal.shopRefreshFailures>=3)this.towerShopRefreshBlocked={run:r,terrain:r.terrain,
              floor:r.tower.floor,gold:r.gold,rerolls:r.shopRerolls};
          },()=>{modal.shopRefreshBefore={gold:r.gold,rerolls:r.shopRerolls,stock:r.shop?.stock};}))return;
        }
        this.modalExit(modal,root,".shop-exit");
        return;
      }
      if (modal.kind === "slots") {
        const slotGoal=this.goalWorldInteraction(r,"slots"),slotRules=slotGoal?{...rules,paid:true,roulette:true}:rules;
        // Native spin deducts its real cost and controls its own animation and
        // prize callback. One spin per visit prevents an unbounded gold sink.
        const cost =
          typeof modal.offers?.cost === "function"
            ? Number(modal.offers.cost())
            : NaN;
        const healthy = r.player.hp / r.player.maxHp >= 0.75 && !r.boss?.alive;
        // 0.8.14 offers a native skip action only while a paid spin is in
        // progress. Both the spinning cabinet and disabled Exit are required:
        // the same green button becomes another paid spin after settlement.
        const skip = root?.querySelector?.(nativeCompatSelector(".actions button.green"));
        const slotExit = root?.querySelector?.(nativeCompatSelector(".actions button.ghost"));
        if (modal.spun && root?.querySelector?.(nativeCompatSelector(".sl-cab.spinning")) &&
            slotExit?.disabled === true && legal(skip)) {
          action(skip);
          return;
        }
        if (
          (!modal.spun || slotGoal) &&
          slotRules.roulette !== false &&
          (this.settings.safeMode === false || slotGoal) &&
          healthy &&
          this.canSpend(r, cost,slotRules)
        ) {
          const spin = root?.querySelector?.(nativeCompatSelector(".actions button.green"));
          if (legal(spin)) {
            action(
              spin,
              "roulette",
              "原生抽奖一次，花费 " + cost + " 本局金币",
              () => { modal.spun = true; },
            );
            return;
          }
        }
        // Disabled Exit means native reels/prize processing is still active.
        this.modalExit(modal, root);
        return;
      }
      if (modal.kind === "forget") {
        // The original panel rebuilds after every click. Re-read the live rows
        // and native loadout; never call the unchecked forgetMove API directly.
        if (replacement.needsTutor && rules.tutor !== false) {
          const buttons = [...(root?.querySelectorAll?.(nativeCompatSelector(".item-row button")) || [])];
          const held = (r.player.moves || []).map((move,slot)=>({move,slot})).filter(row=>row.move);
          const moveSlot = replacement.moves.forget[0];
          const moveIndex = held.findIndex(row=>row.slot===moveSlot);
          const vitaminKey = replacement.vitamins.forget[0];
          const vitaminIndex = [...(r.player.vitamins?.keys?.() || [])].indexOf(vitaminKey);
          const index = moveIndex>=0 ? moveIndex : vitaminIndex>=0 ? held.length+vitaminIndex : -1;
          this.finalForgetAttempts ||= new Map();
          const retryKey=this.replacementRetryKey(r,replacement),attempts=this.finalForgetAttempts.get(retryKey)||0;
          const expectedCondition=replacement.conditionKey,expectedTerrain=r.terrain,expectedStage=finalReplacementStageScope(r).key,
            forgetGuard=()=>this.enabled&&this.controlIdentityCurrent()&&this.app?.run===r&&this.interactionRules().tutor!==false&&
              !this.autoManagePreserving(r)&&r.terrain===expectedTerrain&&finalReplacementStageScope(r).key===expectedStage&&
              this.finalReplacement(r).conditionKey===expectedCondition&&
              (moveIndex>=0?this.finalReplacement(r).moves.forget[0]===moveSlot:this.finalReplacement(r).vitamins.forget[0]===vitaminKey);
          if(index>=0 && attempts<3 && action(buttons[index],moveIndex>=0?"finalMoveForget":"finalVitaminForget",
                moveIndex>=0?"最终招式配置：通过原生NPC遗忘非目标招式，保留输出":"最终维生素替换：通过原生NPC腾出空位",
            undefined,()=>this.finalForgetAttempts.set(retryKey,attempts+1),forgetGuard)) return;
        }
        const customTutor=!modal.forgot?this.customTutorReplacement(r,replacement,build):null;
        if(customTutor){
          const held=(r.player.moves||[]).map((move,slot)=>({move,slot})).filter(row=>row.move),
            index=held.findIndex(row=>row.slot===customTutor.slot),
            buttons=[...(root?.querySelectorAll?.(nativeCompatSelector(".item-row button"))||[])],
            expectedTerrain=r.terrain,expectedStage=finalReplacementStageScope(r).key,
            guard=()=>this.enabled&&this.controlIdentityCurrent()&&this.app?.run===r&&r.terrain===expectedTerrain&&
              finalReplacementStageScope(r).key===expectedStage&&
              this.customTutorReplacement(r)?.conditionKey===customTutor.conditionKey;
          if(index>=0&&action(buttons[index],"replaceMove","为当前可学习的目标腾出一个招式位",
              ()=>{modal.forgot=true;},undefined,guard))return;
        }
        this.modalExit(modal, root, ".shop-exit");
        return;
      }
      if (modal.kind === "ditto") {
        const key =
          rules.free !== false && rules.copy !== false
            ? selectCopyItem(r.player, build, this.bridge, {costPolicy:this.costStrategySettings(r),nativeRun:r,luckOnlyExperience:this.settings.modeSettings?.tower?.onlyExperience === true,experienceBlessingPriority:this.settings.modeSettings?.tower?.experienceBlessingPriority === true})
            : null;
        recording()?.safe(() => recording().event("copy_evaluation", { decisionId: recording().page(modal)?.decisionId,
          selectedKey: key, candidates: [...r.player.items.keys()].map(candidate => ({ key: candidate,
            benefit: evaluateOfferBenefit({ kind: "item", id: candidate }, { player:r.player, build, purpose:"copy", nativeRun:r,luckOnlyExperience:this.settings.modeSettings?.tower?.onlyExperience === true,experienceBlessingPriority:this.settings.modeSettings?.tower?.experienceBlessingPriority === true }, this.bridge),
            ...evaluateItemDecision(candidate,{player:r.player,build,purpose:"copy",nativeRun:r,luckOnlyExperience:this.settings.modeSettings?.tower?.onlyExperience === true,experienceBlessingPriority:this.settings.modeSettings?.tower?.experienceBlessingPriority === true},this.bridge) })),
          freeEnabled: rules.free !== false, copyEnabled: rules.copy !== false }));
        if (key != null) {
          const index = [...r.player.items.keys()].indexOf(key);
          const guard=()=>this.enabled&&this.controlIdentityCurrent()&&this.interactionRules().copy!==false&&this.interactionRules().free!==false&&
            selectCopyItem(r.player,this.decisionBuild(r),this.bridge,this.costStrategySettings(r))===key;
          if (action(cards[index], "ditto", "百变怪复制：" + key,undefined,undefined,guard)) return;
          if (
            performance.now() - modal.at > 2500 &&
            !cards[index] && typeof modal.choose === "function"
          )
            this.modalAction(
              modal,
              root,
              () => { if(liveItemAllowed(key,"copy") && selectCopyItem(r.player,
                finalReplacementBuild(this.plan?.build || {},this.finalReplacement(r)),
                this.bridge,{nativeRun:r,luckOnlyExperience:this.settings.modeSettings?.tower?.onlyExperience === true,experienceBlessingPriority:this.settings.modeSettings?.tower?.experienceBlessingPriority === true})===key) modal.choose(key); },
              "ditto",
              "百变怪通过原生选择回调复制：" + key,
              false,guard,
            );
        } else this.modalExit(modal, root);
        return;
      }
      if (modal.kind === "item") {
        if (rules.free !== false && unresolvedNativeItemOffer(modal.offers,
            {player:r.player,build},this.bridge)) {
          this.status = "正在重新识别当前原生道具资料，保留奖励选择；不会自动卖出未识别道具";
          return;
        }
        const decision = evaluateItemDecision(modal.offers,{player:r.player,build,purpose:"free",costPolicy:this.costStrategySettings(r),nativeRun:r,luckOnlyExperience:this.settings.modeSettings?.tower?.onlyExperience === true,experienceBlessingPriority:this.settings.modeSettings?.tower?.experienceBlessingPriority === true},this.bridge),
          value = decision.score,
          selling = !decision.eligible || rules.free === false;
        recording()?.safe(() => recording().event("item_evaluation", { decisionId:recording().page(modal)?.decisionId,
          offer:recording().offer(modal.offers), score:value, selling, assessment:decision.assessment,
          benefit:evaluateOfferBenefit({kind:"item",id:modal.offers},{player:r.player,build,purpose:"free"},this.bridge) }));
        const guard=()=>this.enabled&&this.controlIdentityCurrent()&&
          (this.interactionRules().free===false||!unresolvedNativeItemOffer(modal.offers,
            {player:r.player,build:this.decisionBuild(r)},this.bridge))&&
          (!evaluateItemDecision(modal.offers,{player:r.player,
            build:this.decisionBuild(r),nativeRun:r,luckOnlyExperience:this.settings.modeSettings?.tower?.onlyExperience === true,experienceBlessingPriority:this.settings.modeSettings?.tower?.experienceBlessingPriority === true,purpose:"free",
            costPolicy:this.costStrategySettings(r)},this.bridge).eligible||this.interactionRules().free===false)===selling;
        const button = root?.querySelector?.(
          nativeCompatSelector(selling ? ".actions button.ghost" : ".actions button.green"),
        );
        if (
          action(
            button,
            selling ? "itemSold" : "item",
            selling ? "已通过游戏卖出道具" : "已通过游戏拾取道具",
            undefined,undefined,guard,
          )
        )
          return;
        if (
          performance.now() - modal.at > 2500 &&
          typeof modal.choose === "function"
        )
          this.modalAction(
            modal,
            root,
            () => { if((!button || legal(button)) && selling===!liveItemAllowed(modal.offers,"free"))modal.choose(!selling); },
            selling ? "itemSold" : "item",
            "原生道具选择回调恢复",
            false,guard,
          );
        return;
      }
      if (["upgrade", "blessing", "itemChoice"].includes(modal.kind) && Array.isArray(modal.offers)) {
        const pageKey = `${r.player.level}:${r.pendingUps ?? "native"}`;
        const history = { ...this.choiceHistory,
          rerollsThisPage: this.choiceHistory.pageKey === pageKey ? this.choiceHistory.rerollsThisPage : 0 };
        const reroll = root?.querySelector?.(nativeCompatSelector(".actions button.blue"));
        const skip = root?.querySelector?.(nativeCompatSelector(".actions button.ghost"));
        if(modal.kind==='upgrade'&&!preserving){
          const banish=root?.querySelector?.(nativeCompatSelector('.actions button.red')),expectedTerrain=r.terrain,expectedStage=finalReplacementStageScope(r).key,
            pick=()=>chooseFinalBanishAction(modal.offers,{player:r.player,nativeRun:r,luckOnlyExperience:this.settings.modeSettings?.tower?.onlyExperience === true,experienceBlessingPriority:this.settings.modeSettings?.tower?.experienceBlessingPriority === true,finalReplacement:this.finalReplacement(r)},this.bridge,
              {banishLegal:legal(banish),banishes:r.banishes,legal:index=>!!cards[index]&&legal(cards[index])}),
            selected=pick();
          if(selected){
            const guard=()=>this.enabled&&this.app?.run===r&&r.terrain===expectedTerrain&&finalReplacementStageScope(r).key===expectedStage&&
              this.modal===modal&&pick()?.index===selected.index&&pick()?.nativeKey===selected.nativeKey;
            this.modalAction(modal,root,()=>{
              // Native banning mode requires a real enabled action, then its
              // candidate selection and confirmation. Do not write banished,
              // spend counters, forget a move, or claim a save ourselves.
              const panel=root?.querySelector?.(nativeCompatSelector('.cards'));
              if(panel?.classList?.contains?.('banning')!==true)banish.click();
              if(this.app?.run!==r||r.ui?.modalEl!==root||root?.isConnected===false)return;
              cards[selected.index].click();
              if(this.app?.run===r&&r.ui?.modalEl===root&&root?.isConnected!==false)cards[selected.index].click();
            },'finalBanish','最终配装：通过原生候选与确认执行等级放逐',false,guard);
            return;
          }
        }
        const banish = root?.querySelector?.(nativeCompatSelector(".actions button.red"));
        const decide = () => chooseOfferAction(modal.offers, {
          player: r.player, build:this.decisionBuild(r),costPolicy:this.costStrategySettings(r), moveSlots: r.player.moveSlots, nativeRun: r, luckOnlyExperience:this.settings.modeSettings?.tower?.onlyExperience === true,experienceBlessingPriority:this.settings.modeSettings?.tower?.experienceBlessingPriority === true,
          finalReplacement: this.finalReplacement(r,{offers:modal.kind==="upgrade" ? modal.offers.filter((offer,index)=>
            offer?.kind==="newMove" && (!cards[index] || legal(cards[index]))) : []}), preserveLoadout: preserving,
          availableMoveKeys: this.plan?.availableMoveKeys,
          objectiveMetric: this.plan?.metrics?.join(",") || "", objective:this.plan?.objective, mode:this.plan?.mode,
          benefitObservation:this.benefitCombatObservation,
        }, this.bridge, {
          kind: modal.kind,costSettings:this.costStrategySettings(r),nativeMandatory:this.nativeCostMandatory(modal,root),legal: index => (!cards[index] || legal(cards[index])) &&
            (!preserving || modal.kind!=="upgrade" || this.autoManageUpgradeAllowed(r,modal.offers[index])),
          rerollLegal: legal(reroll), skipLegal: legal(skip), banishLegal: legal(banish),
          rerolls: r.rerolls, skips: r.skips, banishes: r.banishes,
          history, moveAvailability: this.plan?.moveAvailability,
          experienceBlessingPriority:this.settings.modeSettings?.tower?.experienceBlessingPriority === true,
        });
        const decision = decide();
        if(decision.reason==="forced-native-positive-cost")
          decision.candidates=decision.candidates.filter(candidate=>candidate.index===decision.index);
        if(preserving && modal.kind==="upgrade") {
          if(decision.candidates?.length) {
            decision.action="choose";decision.index=decision.candidates[0].index;
            decision.reason="auto-manage-held-upgrade";decision.nextHistory={...history,rerollsThisPage:0};
          } else if(this.autoManageCanUpgrade(r)!==false && r.rerolls>0 && legal(reroll)) {
            decision.action="reroll";decision.index=null;decision.reason="auto-manage-native-reroll";
            decision.nextHistory={...history,rerollsThisPage:(history.rerollsThisPage||0)+1};
          } else if(r.skips>0 && legal(skip)) {
            decision.action="skip";decision.index=null;decision.reason="auto-manage-native-skip";
            decision.nextHistory={...history,rerollsThisPage:0};
          } else {
            this.lastChoiceReason="auto-manage-manual-choice-required";
            this.status="自动托管：本次必须新增招式/维生素，无法保持当前搭配，请手动选择或开启配装最高优先级";
            return;
          }
        }
        if (modal.kind === "itemChoice") {
          // Take a permitted free item even at zero/negative estimated value.
          // Scores rank alternatives; exclusions and native caps still apply.
          decision.candidates = rules.free === false ? [] :
            (decision.candidates || []).filter(candidate => Number.isFinite(candidate.rawScore)).sort(compareOfferCandidates);
          if (!decision.candidates.length) {
            if (rules.free !== false && modal.offers.some(offer =>
                unresolvedNativeItemOffer(offer,{player:r.player,build},this.bridge))) {
              this.lastChoiceReason = "native-item-definition-pending";
              this.status = "正在重新识别当前原生道具资料，保留奖励选择；不会全部卖出未识别道具";
              return;
            }
            this.lastChoiceReason = rules.free === false ? "free-item-pickup-disabled" : "no-permitted-native-item";
            this.modalExit(modal, root);
            return;
          }
          decision.action = "choose";
          decision.index = decision.candidates[0].index;
          decision.score = decision.candidates[0].score;
          decision.reason = "permitted-free-item-choice";
          decision.fallback = false;
        }
        recording()?.safe(() => recording().evaluated(modal, decision, index => !cards[index] || legal(cards[index])));
        const plannedChoiceKind = decision.action === "choose" ? modal.offers[decision.index]?.kind : null;
        if (modal.kind!=="itemChoice" && decision.action === "choose" && modal.attempts > 0 && decision.candidates?.length &&
            !["same-rarity-star-piece-priority","higher-rarity-star-piece-priority","tower-fusion-material"].includes(decision.reason)) {
          // A native handler that did not advance must not monopolize retries.
          decision.index = decision.candidates[modal.attempts % decision.candidates.length].index;
        }
        this.lastChoiceReason = decision.reason;
        const loadoutStamp = () => JSON.stringify({
          moves: (r.player.moves || []).map(move => move ? [move.def?.key || move.key, move.level] : null),
          vitamins: [...(r.player.vitamins?.entries?.() || [])].map(([key, value]) =>
            [key, typeof value === "object" ? value?.level : value, value?.acc]),
        });
        const searching=["reroll","skip","banish"].includes(decision.action);
        const searchStamp=()=>searching?JSON.stringify([r.rerolls,r.skips,r.banishes,
          [...(r.banished || [])],modal.offers]):null;
        let beforeChoice;
        const commit = () => {
          const advanced = beforeChoice && (r.state !== beforeChoice.state ||
            r.ui.modalEl !== beforeChoice.root || beforeChoice.root?.isConnected === false ||
            this.modal?.offers && this.modal.offers !== modal.offers ||
            r.player.level !== beforeChoice.level || r.pendingUps !== beforeChoice.pendingUps ||
            loadoutStamp() !== beforeChoice.loadout);
          const next = { ...decision.nextHistory, pageKey };
          if(["reroll","skip","banish"].includes(decision.action)) {
            const progressed=advanced || beforeChoice?.search!==searchStamp();
            modal.searchNoProgress=progressed?0:(modal.searchNoProgress||0)+1;
            if(!progressed) {
              Object.assign(next,history);
              if(modal.searchNoProgress>=3)this.stop("原生搜索按钮连续点击未生效，已保留页面；请检查游戏响应",{code:"native-upgrade-no-progress"});
            }
          }
          // Growth opportunities are counted only after an observable native
          // selection/page/loadout change. A failed/no-op card is no opportunity
          // and cannot force an early fallback merely through repeated retries.
          if (!advanced) for (const key of ["vitaminDeferrals", "moveDeferrals"]) {
            if (Object.hasOwn(history, key)) next[key] = history[key];
            else delete next[key];
          }
          else if (decision.action === "choose") {
            const actualKind = modal.offers[decision.index]?.kind;
            for (const [kind, key] of [["newVit", "vitaminDeferrals"], ["newMove", "moveDeferrals"]]) {
              if (actualKind === kind) next[key] = 0;
              else if (plannedChoiceKind === kind)
                next[key] = Math.min(6, (Number(history[key]) || 0) + 1);
            }
          }
          this.choiceHistory = next;
        };
        const record = () => {
          beforeChoice = { state: r.state, root: r.ui.modalEl, level: r.player.level,
            pendingUps: r.pendingUps, loadout: loadoutStamp(),search:searchStamp() };
          const pick = (value, names) => Object.fromEntries(names.filter(name =>
            value?.[name] == null || ["string", "number", "boolean"].includes(typeof value[name]))
            .map(name => [name, value?.[name]]));
          recording()?.safe(() => recording().event("decision_intent", { decisionId: recording().page(modal)?.decisionId,
            decision: recording().plain(decision), target: this.plan?.objective ?? null, mode: this.plan?.mode ?? null }));
          const trace = { revision:config.revision, benefits:decision.benefitEvaluations, time: r.time, stage: r.stage, level: r.player.level, pageKey, kind: modal.kind,
            slots: r.player.moveSlots, held: (r.player.moves || []).filter(Boolean).slice(0, 12)
              .map(move => ({ key: move.def?.key || move.key, level: move.level })),
            offers: modal.offers.slice(0, 16).map((offer, index) => ({
              ...pick(offer, ["kind", "id", "key", "slot", "rarity", "vit"]),
              mods: offer?.mods, name: offer?.name,
              ups: Array.isArray(offer?.ups) ? offer.ups.slice(0, 8).map(up =>
                typeof up === "object" ? pick(up, ["stat", "add", "mul", "key"])
                  : ["string", "number", "boolean"].includes(typeof up) ? up : null) : undefined,
              legal: decision.candidates?.some(candidate => candidate.index === index) || false,
              disabled: !!cards[index]?.disabled, hidden: cards[index]?.hidden === true,
            })), offersTruncated: modal.offers.length > 16,
            rerolls: r.rerolls, skips: r.skips, banishes: r.banishes,
            rerollLegal: !!legal(reroll), skipLegal: !!legal(skip), banishLegal: !!legal(banish),
            decision: { action: decision.action, index: decision.index, reason: decision.reason,
              readiness: (decision.readiness || []).slice(0, 12).map(entry =>
                pick(entry, ["key", "state", "requiredLevel", "reason"])),
              scores: (decision.candidates || []).slice(0, 16).map(entry =>
                pick(entry, ["index", "key", "kind", "score", "rawScore", "actualScore", "reservationPenalty", "priority", "utilityTier", "fusionCompletionBonus"])),
              history: { ...history } } };
          this.choiceTrace ||= []; this.choiceTrace.push(trace);
          if (this.choiceTrace.length > 64) this.choiceTrace.splice(0, this.choiceTrace.length - 64);
        };
        const choiceStillAllowed = () => {
          if(decision.action!=="choose") {
            // Auto-manage owns a separate preserve-loadout search policy.
            // Do not re-interpret its explicit skip as a generic reroll.
            if(!decision.strictTower)return true;
            const fresh=decide();return fresh.action===decision.action && fresh.index===decision.index;
          }
          if(decision.strictTower) {
            const fresh=decide();
            if(fresh.action!=="choose" || !fresh.candidates?.some(entry=>entry.index===decision.index))return false;
            if(decision.reason==="tower-fusion-material" && fresh.index!==decision.index)return false;
          }
          if(decision.reason==="sole-native-upgrade") {
            const fresh=decide();
            return fresh.reason==="sole-native-upgrade" && fresh.index===decision.index;
          }
          if(modal.kind==="itemChoice") {
            if(this.interactionRules().free===false)return false;
            const fresh=decide(),candidates=(fresh.candidates || [])
              .filter(candidate=>Number.isFinite(candidate.rawScore)).sort(compareOfferCandidates);
            return candidates[0]?.index===decision.index;
          }
          return !evaluateOfferBenefit(modal.offers[decision.index],{player:r.player,nativeRun:r,luckOnlyExperience:this.settings.modeSettings?.tower?.onlyExperience === true,experienceBlessingPriority:this.settings.modeSettings?.tower?.experienceBlessingPriority === true,
            build:finalReplacementBuild(this.plan?.build || {},this.finalReplacement(r))},this.bridge).hardRejected;
        };
        const dispatch = (button, type, message) => legal(button) && this.modalAction(modal, root, () => {
          if (legal(button) && choiceStillAllowed()) { record(); button.click(); commit(); }
        }, type, message || (button.innerText ?? button.textContent)?.trim().replace(/\s+/g, " ").slice(0, 180),false,
          decision.action==="choose"?()=>this.costModalSelectionAllowed(modal,root,decision.index):null);
        if(decision.action === "restart" &&
            (decision.reason === "tower-target-search-exhausted" && decision.searchExhausted === true ||
             decision.reason === "tower-target-confirmed-impossible" && decision.impossibility?.confirmed === true &&
             decision.impossibility.signature && decision.impossibility.evidence?.length)) {
          if(!this.towerChoiceRestart) {
            record();this.towerChoiceRestart={run:r,app:this.app,meta:this.app.meta,account:this.app.meta?.account,
              settings:this.settings,plan:this.plan,epoch:this.controlEpoch || 0,modal,root,decide,
              proof:decision.impossibility,searchExhausted:decision.searchExhausted === true,started:false};
            this.status=decision.searchExhausted ? "搜索已耗尽，正在复核后退局" : "必需目标已被原生放逐，正在复核方案是否无法完成";
          }
          return;
        }
        if(decision.action === "suspend" || decision.action === "restart") {
          record();this.towerChoiceRestart=null;
          this.stop(decision.reason === "tower-target-route-conflict"
            ? "目标招式已不可学习，已停止辅助并保留本局；请调整目标或手动选择"
            : "当前强化没有不破坏目标的安全选项，已停止辅助并保留本局，请手动选择",{code:"tower-choice-needs-input"});
          return;
        }
        if (decision.hardBlocked && decision.action === "wait") {
          record();this.status="当前选项没有实际收益，也无法跳过或重掷，等待手动处理"; return;
        }
        if(decision.action === "wait" && decision.strictTower) return;
        if(decision.action === "banish") {
          if(legal(banish) && legal(cards[decision.index])) this.modalAction(modal,root,()=>{
            const app=this.app,meta=app?.meta,account=meta?.account,epoch=this.controlEpoch || 0;
            const live=()=>this.enabled && this.app===app && app.meta===meta && meta?.account===account &&
              this.controlIdentityCurrent() && (this.controlEpoch || 0)===epoch && this.app?.run===r &&
              (!Object.hasOwn(modal,"stage") || r.stage===modal.stage) &&
              (!Object.hasOwn(modal,"terrain") || r.terrain===modal.terrain) && r.ui.modalEl===root &&
              root?.isConnected && (!this.modal || this.modal===modal) && Number(r.banishes)>0;
            if(!live() || !choiceStillAllowed()) return;
            record();
            if(!root.querySelector?.(nativeCompatSelector(".cards"))?.classList?.contains("banning")) banish.click();
            if(live() && root.querySelector?.(nativeCompatSelector(".cards"))?.classList?.contains("banning")) {
              cards[decision.index].click();
              if(live()) cards[decision.index].click();
            }
            commit();
          },"upgradeBanish","通过原生确认放逐不需要的技能或维生素");
          return;
        }
        if (decision.action === "reroll" && dispatch(reroll, "upgradeReroll", "原生刷新：寻找当前可得的合适强化")) return;
        if (decision.action === "skip" && dispatch(skip, "upgradeSkip", "原生跳过：暂缓不合适的新技能")) return;
        if (decision.action === "choose" && decision.index != null) {
          if (dispatch(cards[decision.index], modal.kind, decision.strictForced ? "原生强制且无可用跳过：暂持非指定强化，等待真实遗忘NPC清理" : undefined)) return;
          if(!this.costModalSelectionAllowed(modal,root,decision.index))return;
          if (performance.now() - modal.at > 2500 && typeof modal.choose === "function") {
            this.modalAction(modal, root, () => { if(!choiceStillAllowed() || cards[decision.index] && !legal(cards[decision.index])) return;
              record(); modal.choose(modal.offers[decision.index]); commit(); },
              modal.kind, "通过原生回调完成强化选择");
            return;
          }
        }
        if (modal.kind === "itemChoice") { this.modalExit(modal, root); return; }
        if(decision.strictTower) return;
        if(decision.blocked&&build.masteryConstraints) {
          this.status="当前挑战没有符合条件的原生强化，且无可用跳过/刷新；保留原生选择页，等待手动处理或调整目标";
          return;
        }
        if(replacement.strictMoves?.enabled||replacement.strictVitamins?.enabled){
          this.status="严格选择等待原生允许的指定强化或跳过；保留当前对局";
          return;
        }
      }
      const supportBuild=this.decisionBuild(r,'support'),supportChoice=modal.kind==='party'?chooseSupportReplacement(r,modal.offers,supportBuild,this.plan?.objective):
        modal.kind==='shinySwap'?chooseSupportReplacement(r,modal.offers?.[1],
          this.plan?.objective==='shiny'&&(r.player.stats.luck||0)<80?
            {...supportBuild,statWeights:{...supportBuild.statWeights,luck:5}}:supportBuild,this.plan?.objective):null;
      if(supportChoice)recording()?.safe(() => recording().event("support_evaluation",{kind:modal.kind,decision:recording().plain(supportChoice)}));
      const count = Math.max(
        cards.length,
        modal.kind === "party"
          ? r.allies.list.filter((ally) => !ally.shiny).length + 1
          : Array.isArray(modal.offers)
            ? modal.offers.length
            : 0,
      );
      const choices = [];
      for (let i = 0; i < count; i++) {
        if (cards[i] && !legal(cards[i])) continue;
        if (
          modal.kind === "unknown" &&
          (cards[i]?.querySelector?.(nativeCompatSelector(".price, [data-cost]")) ||
            /诅咒|永久|贪婪|难度|curse|maldici|maldit|codicia|difficulty|dificultad/i.test(cards[i]?.textContent || ""))
        )
          continue;
        const offer = modal.offers?.[i];
        if (["upgrade","blessing"].includes(modal.kind) && evaluateOfferBenefit(offer,
          {player:r.player,nativeRun:r,luckOnlyExperience:this.settings.modeSettings?.tower?.onlyExperience === true,experienceBlessingPriority:this.settings.modeSettings?.tower?.experienceBlessingPriority === true,build},this.bridge).hardRejected) continue;
        let score = 0,
          value = offer;
        if (modal.kind === "upgrade")
          score = scoreOffer(
            offer,
            {
              player: r.player,
              costPolicy:this.costStrategySettings(r),
              objectiveMetric: this.plan?.metrics?.join(",") || "",
              build,
              moveSlots: r.player.moveSlots,
              availableMoveKeys: this.plan?.availableMoveKeys,
            },
            this.bridge,
          );
        else if (modal.kind === "blessing")
          score = scoreOffer(offer,{player:r.player,build,costPolicy:this.costStrategySettings(r),nativeRun:r,luckOnlyExperience:this.settings.modeSettings?.tower?.onlyExperience === true,experienceBlessingPriority:this.settings.modeSettings?.tower?.experienceBlessingPriority === true,costPolicy:this.costStrategySettings(r)},this.bridge);
        else if (modal.kind === "itemChoice")
          score =
            rules.free === false
              ? -Infinity
              : scoreOffer(
                  { kind: "item", id: offer },
                  { player: r.player, build, purpose: "free",nativeRun:r,luckOnlyExperience:this.settings.modeSettings?.tower?.onlyExperience === true,experienceBlessingPriority:this.settings.modeSettings?.tower?.experienceBlessingPriority === true,costPolicy:this.costStrategySettings(r) },
                  this.bridge,
                );
        else if (modal.kind === "branch")
          score = (Number(offer) === this.plan?.evolutionTarget || this.plan?.evolutionPath?.includes(Number(offer)) ? 100000 : 0) + (this.bridge.data.get(offer)?.bst || 0);
        else if (modal.kind === "party") {
          const list = [
            ...r.allies.list
              .map((ally, slot) => ({ ally, slot }))
              .filter(({ ally }) => !ally.shiny),
            { ally: modal.offers, slot: -1 },
          ];
          score=list[i]?.slot===supportChoice.slot?1:0;
          value = list[i]?.slot;
        } else if (modal.kind === "shinySwap") {
          const selection=this.compatibility.learningRules?.shinySwapSelection;
          if(!['keep','release'].includes(selection)){
            this.status='等待确认原生异色替换卡片含义，保留当前选择页面';return;
          }
          const keepNew=supportChoice.slot>=0,wanted=selection==='release'?(keepNew?0:1):(keepNew?1:0);
          score=i===wanted?1:0;
          value = selection==='release'?i===0:i===1;
        }
        if(modal.kind==='itemChoice'&&!Number.isFinite(score))continue;
        choices.push({
          index: i,
          score: Number.isNaN(score) ? -Infinity : score,
          value,
        });
      }
      choices.sort((a, b) => b.score - a.score || a.index - b.index);
      if (
        modal.kind === "itemChoice" &&
        !choices.length
      ) {
        if (this.modalExit(modal, root)) return;
      }
      if (
        modal.kind === "upgrade" &&
        Number.isFinite(choices[0]?.score) &&
        choices[0]?.score < 0 &&
        r.skips > 0
      ) {
        if (
          action(
            root?.querySelector?.(nativeCompatSelector(".actions button.ghost")),
            "upgradeSkip",
            "通过原生跳过次数离开不合适的强化",
          )
        )
          return;
      }
      // Even every custom target being complete, every score being -Infinity,
      // or a future offer kind still leaves the first enabled native card.
      const best = choices[0];
      if (best) {
        const retryIndex =
          (modal.attempts || 0) > 0
            ? (modal.attempts || 0) % choices.length
            : 0;
        const choice = choices[retryIndex];
        const stillAllowed=()=>modal.kind==='itemChoice'?liveItemAllowed(choice.value,'free'):
          !["upgrade","blessing"].includes(modal.kind) ||
          !evaluateOfferBenefit(modal.offers?.[choice.index],{player:r.player,nativeRun:r,luckOnlyExperience:this.settings.modeSettings?.tower?.onlyExperience === true,experienceBlessingPriority:this.settings.modeSettings?.tower?.experienceBlessingPriority === true,build},this.bridge).hardRejected;
        const guard=["upgrade","blessing","itemChoice"].includes(modal.kind)?()=>this.costModalSelectionAllowed(modal,root,choice.index):undefined;
        if (stillAllowed() && action(cards[choice.index], modal.kind,undefined,undefined,undefined,guard)) return;
        if (
          performance.now() - modal.at > 2500 &&
          typeof modal.choose === "function"
        ) {
          this.modalAction(
            modal,
            root,
            () => {if(stillAllowed()) modal.choose(choice.value);},
            modal.kind,
            "通过原生选择回调完成页面",
            false,guard,
          );
          return;
        }
      }
      if (modal.kind === "unknown") {
        if (
          this.modalExit(modal, root, ".shop-exit") ||
          this.modalExit(modal, root, ".actions button.ghost")
        )
          return;
        const exit = root?.querySelector?.(
          nativeCompatSelector(".back-btn, .close-btn, button[aria-label='Close']"),
        );
        if (action(exit)) return;
      }
      if (performance.now() - modal.at > 8000)
        this.status = "正在重试游戏交互：" + modal.kind + "，等待原生可用选项";
    },
    handleAppDialogs() {
      const lost = document.querySelector?.(nativeCompatSelector(".gl-lost"));
      if (lost?.isConnected) {
        this.setHealth("graphics-wait", "等待原生图形恢复或无画面继续选项");
        const lostButtons = [...lost.querySelectorAll(nativeCompatSelector("button"))];
        const resume = lostButtons.find(
          (button) =>
            !button.disabled &&
            !button.hidden &&
            (/无画面|无图像|without.*(?:image|picture)|Seguir sin imagen/i.test(
              button.textContent,
            ) ||
              (lostButtons.length === 2 &&
                button === lostButtons[0] &&
                button.classList?.contains("btn") &&
                !button.classList.contains("red"))),
        );
        if (
          resume &&
          this.app?.run &&
          !["over", "dead"].includes(this.app.run.state)
        )
          resume.click();
        else this.status = "等待游戏图形恢复及原生继续选项";
        return true;
      }
      const buttons = [
        ...document.querySelectorAll(nativeCompatSelector(".season-modal .cl-mbtns button")),
      ];
      const nativeOfflineShape =
        buttons.length === 3 &&
        buttons[0].classList?.contains("ghost") &&
        buttons[1].classList?.contains("ghost") &&
        buttons[2].classList?.contains("red");
      for (const button of buttons)
        if (
          !button.disabled &&
          /^(知道了|明白|Entendido|Got it|Understood|OK)$/i.test(
            button.textContent.trim(),
          )
        ) {
          if (this.safeAction("app-notice", button, "关闭游戏公告")) {
            const notice = this.nativeSavedNotice;
            const savedNoticeButton = !!notice?.root?.contains?.(button);
            button.click();
            this.completeSafeAction("app-notice", button);
            this.nativeNoticeAcknowledgedAt = Date.now();
            if (savedNoticeButton && !notice.root.isConnected)
              notice.acknowledgedAt = this.nativeNoticeAcknowledgedAt;
          }
          return true;
        }
      if (
        this.starting &&
        !this.app?.run &&
        (nativeOfflineShape ||
          buttons.some((button) =>
            /离线|不计|offline|sin que cuente|without.*count/i.test(
              button.textContent,
            ),
          ))
      ) {
        const cancel = buttons.find(
          (button) =>
            !button.disabled &&
            (/^(取消|Cancel|Cancelar)$/i.test(button.textContent.trim()) ||
              (nativeOfflineShape && button === buttons[0])),
        );
        if (cancel) {
          if (!this.safeAction("offline-cancel", cancel, "取消离线开局")) return true;
          cancel.click();
          this.completeSafeAction("offline-cancel", cancel);
          this.status = "开局未连接服务器，已取消离线游玩，稍后重试";
          this.setHealth("server-wait", this.status, this.nextStartAt || null);
        }
      }
      return false;
    },
    completedTaskReason(r) {
      const target = this.plan?.taskTarget;
      if (!target || this.plan?.priority !== "做委托" || !this.app?.meta?.task) return null;
      const task = this.app.meta.task(target.period, target.index);
      if (!task || task.id !== target.id || task.goal !== target.goal) return null;
      const progress = this.app.meta.profile[target.period]?.prog?.[target.index] || 0;
      const actual = target.metric === "time" ? r.time : target.metric === "runKills" ? r.stats.kills :
        target.metric === "level" ? r.player.level : null;
      if (progress >= target.goal || target.singleRun && actual != null && actual >= target.goal)
        return "本局委托目标已达成，继续当前对局并等待原生结束后保存";
      return null;
    },
    finiteRunCompletionState(r) {
      const plan=this.plan,decline=reason=>({ready:false,reason});
      if(!r?.player||this.planRun!==r||!plan||r.state!=='play'||r.player.dead||this.pauseRequested||
          this.autoManageSelected()||plan.autoManage)return decline('not-an-actionable-finite-run');
      const camp=this.leaderboardCampState(r);
      if(camp&&!camp.appearanceCounting)return decline('not-an-actionable-finite-run');
      if(plan.appearanceCounting?.eligible===true&&plan.appearanceCounting.settleOnGoal===false)
        return decline('appearance-natural-end-requested');
      if(this.flightState(r).noInteractions)return decline('explicit-no-interactions');
      if(this.legacyCharacterUnlockPlan(plan))return decline('legacy160-normal-native-settlement');
      if(plan.unlockAction?.kind==='win-map'||plan.objective==='wins')return decline('native-victory-still-required');
      const execution=plan.unlockExecution,state=this.characterUnlockState(r);
      let completion=null;
      const independentChallenge=!!(plan.mastery?.member||plan.challenge&&Object.keys(plan.challenge).length||
        plan.qualification&&Object.keys(plan.qualification).length);
      const normalGoal=plan.unlockAction?.normalFinishGoal,sourceHash=normalGoal&&this.getUnlockCatalog()?.sourceHash,
        normalState=normalGoal&&sourceHash&&plan.mastery?.member===normalGoal.member&&
          plan.unlockAction?.kind==='pursue-counter'&&plan.unlockAction.counter===normalGoal.counter&&
          !(plan.challenge&&Object.keys(plan.challenge).length)&&!(plan.qualification&&Object.keys(plan.qualification).length)&&
          typeof masteryNormalSettlementState==='function'?masteryNormalSettlementState(r,normalGoal,sourceHash):null;
      if(normalState?.active&&normalState.known&&normalState.met)
        completion={kind:'reviewed-complete-non-victory-mastery',conditionKey:JSON.stringify([normalGoal.counter,normalGoal.goal])};
      if(!independentChallenge&&execution?.completionPolicy==='finish-when-live-goals-met'&&execution.conditions?.length>0&&
          plan.unlockAction?.kind==='pursue-counter'&&state.active&&state.conditions.every(row=>row.known&&row.met))
        completion={kind:'native-live-conditions',conditionKey:JSON.stringify(state.conditions.map(row=>[row.counter,row.goal]))};
      if(!completion){
        const profile=this.savedUnlockProfileCurrent(),catalog=this.getUnlockCatalog(),progress=plan.goalProgress,
          targetId=progress?.requestedId&&progress.requestedId!=='auto'?progress.requestedId:progress?.targetId,
          target=profile&&catalog?.targets?.find(row=>row.id===targetId),
          result=target&&evaluateUnlockCondition(target.completion,profile,catalog);
        if(!independentChallenge&&['pursue-counter','capture','encounter','research','evolve'].includes(plan.unlockAction?.kind)&&result?.known&&result.done)
          completion={kind:'verified-saved-whole-target',conditionKey:targetId};
      }
      if(!completion&&!independentChallenge&&plan.priority==='做委托'&&plan.taskTarget&&this.completedTaskReason(r)){
        const target=plan.taskTarget,task=this.app.meta.task?.(target.period,target.index),
          profile=this.savedUnlockProfileCurrent(),period=profile?.[target.period],
          same=task?.id===target.id&&task.goal===target.goal&&task.metric===target.metric,
          liveSafe=['time','runKills','level'].includes(task?.metric),
          saved=period?.ids?.[target.index]===target.id&&Number.isFinite(period?.prog?.[target.index])&&period.prog[target.index]>=target.goal;
        if(same&&task.metric!=='wins'&&(liveSafe||saved))completion={kind:'complete-native-task',conditionKey:JSON.stringify([target.period,target.index,target.id,target.goal])};
      }
      if(!completion)return decline('finite-goal-not-completely-proven');
      if(r.ui?.modalEl?.isConnected||Number(r.pendingLevels)>0||this.modal&&this.nativeModalCurrent(this.modal,r.ui?.modalEl))
        return decline('mandatory-native-page-pending');
      if(['throwing'].includes(r.capture?.state)||r.capture?.throwing===true||r.allies?.state==='throwing'||
          this.priorityCapturePending(r))return decline('current-native-capture-pending');
      if(this.savePending||this.app?.meta?.hasPending?.()||this.app?.meta?.queued)return decline('native-save-already-pending');
      return {ready:true,...completion};
    },
    recordFiniteSettlementReceipt(r,saved,context) {
      const scope=this.finiteSettlementScope;
      if(!scope||scope.run!==r||scope.app!==context.app||scope.meta!==context.meta||scope.account!==context.account||
          scope.epoch!==this.controlEpoch||this.app!==scope.app||this.app?.meta!==scope.meta||scope.meta.account!==scope.account)return false;
      scope.phase=saved?'saved':'save-failed';return true;
    },
    recordFiniteSettlementEvent(event) {
      const scope=this.finiteSettlementScope;
      if(!scope||event?.kind!=='settlement'||typeof event.saved!=='boolean'||event.runAt!==scope.runAt||
          event.id!==scope.settlementId||this.app?.run!==scope.run&&this.run!==scope.run)return false;
      return this.recordFiniteSettlementReceipt(scope.run,event.saved,scope);
    },
    settleCompletedFiniteRun(r) {
      const prior=this.finiteSettlementScope;
      if(prior?.run===r)return prior.phase==='submitted';
      if(!this.enabled||this.app?.run!==r||this.run!==r||!this.automationAllowed()||!this.controlIdentityCurrent())return false;
      const complete=this.finiteRunCompletionState(r);
      if(!complete.ready||typeof r.finish!=='function')return false;
      const app=this.app,meta=app.meta,account=meta.account,epoch=this.controlEpoch;
      this.withdrawTravelInteractionInput();this.release();
      // Recheck after releasing our own keys: a Stop, account change or late
      // native capture callback must invalidate the still-uncommitted action.
      if(!this.enabled||this.app!==app||app.run!==r||app.meta!==meta||meta.account!==account||this.controlEpoch!==epoch||
          !this.finiteRunCompletionState(r).ready)return false;
      const scope=this.finiteSettlementScope={run:r,app,meta,account,epoch,phase:'submitted',completion:complete,
        runAt:this.runStartedAt,settlementId:meta.ticket?.id||`run-${this.runStartedAt}`};
      this.status='本局全部有限目标已真实满足，按原生放弃流程结算并等待保存';
      try{
        const result=r.finish(false);
        Promise.resolve(result).catch(()=>{if(this.finiteSettlementScope===scope&&this.controlEpoch===epoch)scope.phase='save-failed';});
      }catch{scope.phase='save-failed';this.status='原生结算尚未确认，保留目标与当前界面等待恢复';}
      return true;
    },
    observePlayerBenefits(r) {
      const previous=this.benefitCombatSample, count=()=>{
        if (typeof r?.enemies?.count === "number") return r.enemies.count;
        const alive=r?.enemies?.alive; return alive?.reduce?.((sum,value)=>sum+(value?1:0),0) || 0;
      }, combat=!!r && r.state === "play" && count()>0 && !["clear","roof"].includes(r.tower?.state);
      if (!r) {this.benefitCombatSample=null;this.benefitCombatObservation=null;return;}
      const same=previous?.run===r && previous.stage===r.stage && previous.floor===r.tower?.floor,
        dt=same?r.time-previous.time:0, damage=Number(r.stats?.damageTaken),
        usable=combat && previous?.combat && dt>0 && dt<=3 && damage>=previous.damage;
      let window=same?this.benefitCombatWindow:null;
      if (!window || window.seconds>30) window={seconds:0,damage:0};
      if (usable) {window.seconds+=dt;window.damage+=damage-previous.damage;}
      this.benefitCombatWindow=window;
      this.benefitCombatSample={run:r,stage:r.stage,floor:r.tower?.floor,time:r.time,damage,combat};
      if (!same) this.benefitCombatObservation=null;
      if (usable && window.seconds>=10) this.benefitCombatObservation={playerOnly:true,combatSeconds:window.seconds,
        gameTime:r.time,stage:r.stage,floor:r.tower?.floor,damageTakenPerSecond:window.damage/window.seconds};
    },
    async macro() {
      this.lastMacroAt = Date.now();
      this.currentVerifiedClears();
      this.observeSaves();
      this.observeMenuAvailability();
      if (!this.enabled || !this.app) return;
      if(this.partialRunScope?.run===this.app.run){this.status='基础托管中，完整交互能力待连接';return;}
      if(!this.app.run&&this.compatibility.capabilities?.menu===false){
        this.status='挂机已启用：开局所需目录或保存接口待修复；其他本地功能可用';return;
      }
      this.syncReleasedMouseAudio();
      if (!this.automationAllowed() || !this.controlIdentityCurrent()) return;
      if(this.savedProfileRecovery)await this.reviewSavedProfileRecovery();
      if (!this.autoManageCurrent()) return;
      if (this.restReminderTick()) return;
      if (this.inspectPanelTick()) return;
      this.reviewMenuMaintenance();
      if (this.handleAppDialogs() || this.starting) return;
      const waiting = this.accountWaitReason();
      if (waiting) {
        this.cadence.reset("account-unavailable");
        this.status = waiting;
        this.setHealth("account-wait", waiting);
        return;
      }
      const app = this.app,
        r = app.run;
      if (this.betweenRunWaitScope && this.betweenRunWaitScope.run !== r) this.betweenRunWaitScope = null;
      if (this.panelInspectionRun && this.panelInspectionRun !== r) this.panelInspectionRun = null;
      if (r) this.visibleMenuWait = null;
      if (r?.state === "play") this.setHealth("healthy", "原生对局仍在运行");
      if (this.resumeRequested && performance.now() > this.resumeUntil) {
        this.resumeRequested = false;
        if (r?.state === "paused")
          this.status = "游戏仍处于暂停，可点击继续重试";
      }
      if (this.resumeRequested && r?.state === "paused") {
        this.resumeGame();
        return;
      }
      if (r && this.run !== r && !this.attachRun(r)) return;
      if(this.partialRunScope?.run===r)return;
      if (r) this.observeShinies(r);
      this.observePlayerBenefits(r);
      // Recheck the same page/account/plan before an authorized exhausted-search
      // exit or an independently proven permanent target exclusion.
      const towerRestart=this.towerChoiceRestart;
      if(towerRestart) {
        const current=towerRestart.run===r && towerRestart.app===app && towerRestart.meta===app.meta &&
          towerRestart.account===app.meta?.account && towerRestart.epoch===(this.controlEpoch || 0) &&
          towerRestart.settings===this.settings && towerRestart.plan===this.plan,
          proof=towerRestart.proof;
        if(!current || r?.state==="over" || !towerRestart.searchExhausted && (!proof?.confirmed || !proof.signature || !proof.evidence?.length))
          this.towerChoiceRestart=null;
        else if(towerRestart.started)return;
        else if(!this.nativeModalCurrent(towerRestart.modal,towerRestart.root))this.towerChoiceRestart=null;
        else {
          const fresh=towerRestart.decide();
          const validExit = towerRestart.searchExhausted
            ? fresh.reason === "tower-target-search-exhausted" && fresh.searchExhausted === true
            : fresh.reason === "tower-target-confirmed-impossible" && fresh.impossibility?.confirmed === true &&
              fresh.impossibility.signature === proof.signature;
          if(fresh.action!=="restart" || !validExit) {
            this.towerChoiceRestart=null;
          } else {
            towerRestart.started=true;this.release();
            recording()?.safe(()=>recording().event(towerRestart.searchExhausted ? "tower_search_exhausted" : "tower_impossibility_confirmed",{proof:fresh.impossibility}));
            this.recordEvent({id:`tower-impossible-${this.runStartedAt}`,kind:"choice",type:"towerRestart",at:Date.now(),
              message:towerRestart.searchExhausted ? "搜索已耗尽且当前没有方案目标可选，通过原生放弃结算；保存后按自动重开设置执行" : "现场复核确认必需目标已被原生放逐、方案无法完成，通过原生放弃结算；保存后按自动重开设置执行"});
            try {await r.finish(false,true);}
            catch(error) {
              if(this.towerChoiceRestart===towerRestart && this.enabled && this.controlIdentityCurrent())
                this.stop("原生结算未完成，请在游戏中确认："+String(error?.message||error),{code:"tower-finish-failed"});
            }
            return;
          }
        }
      }

      // Native climb may finish between pilot frames; navigation still marks
      // the previous terrain until step observes the replacement.
      if (r && this.navigation?.terrain !== r.terrain) this.release();
      const capturePending = r?.state === "play" && this.priorityCapturePending(r);
      if (r?.state === "play" && (this.target?.exploration || capturePending) &&
          (this.terrainRecoveryState?.exhausted || this.explorationState?.exhausted)) {
        const leavingPatrol = this.target?.exploration === true;
        this.target = this.chooseWorldTarget(r);
        // A newly available capture/interaction must interrupt an exhausted
        // patrol. Preserve a current capture's grounded
        // retry window so repeated macro updates do not restart local planning.
        if (leavingPatrol && !this.target.exploration) this.terrainRecoveryState = null;
      }
      const patrolExhausted = this.target?.exploration && this.explorationState?.exhausted;
      if (r?.state === "play" && (this.terrainRecoveryState?.exhausted || patrolExhausted)) {
        // Exhaustion diagnoses stalled travel; it never authorizes ending a
        // live native run. Continue finite recovery/repath attempts until the
        // native game ends, including ordinary enemies and Tower Beyond.
        const type = patrolExhausted ? "explorationRecoveryContinuing" : "terrainRecoveryContinuing";
        const notice = this.liveRecoveryNotice;
        if (!notice || notice.run !== r || notice.terrain !== r.terrain || notice.type !== type) {
          const message = patrolExhausted ? "大范围巡游进展不足，保留当前对局继续探索" :
            "持续脱困未取得位移，保留当前对局继续尝试";
          this.liveRecoveryNotice = { run:r, terrain:r.terrain, type };
          this.recordEvent({id:`live-recovery-${this.runStartedAt}-${r.time}`,kind:"diagnostic",type,
            at:Date.now(),message});
        }
      }
      // Only an explicitly complete finite objective can invoke the native
      // quit-and-save path. Travel exhaustion and partial goals never can.
      if (r && !["over"].includes(r.state)) {
        if(this.settleCompletedFiniteRun(r))return;
        this.handleModal();
        return;
      }
      const finiteSettlement=this.finiteSettlementScope;
      if(finiteSettlement?.run===r&&finiteSettlement.epoch===this.controlEpoch&&
          finiteSettlement.account===this.app.meta.account&&finiteSettlement.phase!=='saved'){
        this.status=finiteSettlement.phase==='save-failed'?'本局原生保存未成功，等待真实补存回执后再评估下一阶段':'等待本局原生结算保存回执';
        this.setHealth('save-wait',this.status);return;
      }
      if (r && !r.sent) {
        this.status = "等待战绩保存";
        this.setHealth("save-wait", this.status);
        return;
      }
      if (r?.ui?.savingEl || app.meta.hasPending()) {
        this.status = "等待进度同步";
        this.setHealth("save-wait", this.status);
        return;
      }
      if (this.nativeSavedNotice?.root?.isConnected) {
        this.status = "等待原生上一局补存提示确认";
        this.setHealth("save-wait", this.status);
        return;
      }
      if (performance.now() < (this.savedNoticeWaitUntil || 0)) {
        this.status = "等待原生补存结果与上一局提示";
        this.setHealth("save-wait", this.status);
        return;
      }
      if (!this.menuOperationsAllowed()) return;
      if (this.deploymentWait) {
        this.status = "本局已保存，等待连接新版游戏";
        return;
      }
      if(app.coopRoom?.open) {
        this.cadence.reset("native-cooperative-lobby");
        this.status="保留当前联机房间，等待玩家通过原生页面选人、准备或开始；不会另开单人局";
        this.setHealth("cooperative-lobby-wait",this.status);return;
      }
      if (this.shinyFinishReason) {
        if (!this.shinyFinishSaved) {
          this.status = "异色结算尚未确认，请等待游戏补存成功";
          return;
        }
        const next = this.makePlan();
        if (this.explicitShinyTarget() && this.settings.shinyStopWhenDone !== false &&
            (next.shinyStatus === "complete" || next.goalProgress?.requestedComplete === true)) {
          this.stop("异色目标已完成并保存；" + next.need, { source: "task-complete", code: "shiny-complete" });
          return;
        }
        this.shinyFinishReason = null;
      }
      if (performance.now() < this.nextStartAt) {
        this.setHealth("server-wait", "等待服务器重试退避", this.nextStartAt);
        return;
      }
      if (!this.betweenRunWaitReady()) return;
      const attempt = { meta:app.meta, account:app.meta.account, epoch:this.controlEpoch || 0 };
      this.startingAttempt = attempt;
      this.starting = true;
      this.setHealth("starting", "等待原生开局及服务器确认");
      try {
        const meta = app.meta, account = meta.account, epoch = this.controlEpoch || 0;
        const valid = () => this.enabled && !this.deploymentWait && !app.coopRoom?.open && this.app === app && app.meta === meta &&
          meta.account === account && (this.controlEpoch || 0) === epoch &&
          (!app.run || app.run === r && app.run.state === "over") && this.menuOperationsAllowed() && this.menuProfileScopeCurrent(true);
        if (r) {
          if (!this.safeAction("return-menu", r, "返回游戏主菜单")) return;
          this.nextRunIntent = this.manualStartRequested ? "manual" : "automatic";
          this.recordHistory({
            event: "result", at: Date.now(), runAt: this.runStartedAt,
            victory: r.victory, time: r.time, kills: r.stats.kills,
            damageTaken: r.stats.damageTaken, level: r.player.level,
            recentDamage: this.damageLog.slice(-12),
          });
          app.toMenu();
          this.completeSafeAction("return-menu", r);
          if(valid())this.beginCharacterInterRunMenu(r);
          if (this.settings.autoRestart === false && !this.manualStartRequested) {
            this.stop("本局结束，自动连局已关闭", { source: "auto-restart-disabled", code: "auto-restart-disabled" });
            return;
          }
          this.manualStartRequested = false;
          if (this.settings.randomDelay !== false) return;
        }
        if (this.nextRunIntent === "automatic" && this.settings.autoRestart === false) {
          this.stop("自动连局已关闭，已取消下一局", { source: "auto-restart-disabled", code: "auto-restart-disabled" });
          return;
        }
        await meta.queue;
        if (!valid() || meta.queued || meta.hasPending()) return;
        if(!this.characterInterRunMenuReady(valid))return;
        if (await this.claimRewards(app, valid)) return;
        if (!valid()) return;
        const pendingPlan = this.makePlan();
        if (await this.prepareUnlockMenuAction(pendingPlan,valid)) return;
        const goalPurchase = (pendingPlan.goalProgress?.chain || []).some(id => /^(lab|items):/.test(id));
        if(!goalPurchase&&await this.prepareAutomaticItemUnlock(valid))return;
        if (!goalPurchase && this.settings.autoUpgrade !== false &&
            this.compatibility.capabilities?.lab !== false &&
            await this.prepareLab(valid)) return;
        await meta.queue;
        if (!valid() || meta.queued || meta.hasPending()) return;
        this.plan = this.makePlan();
        this.planRun = null;
        if(["wardrobe","allClears"].includes(this.plan.goalMode)&&this.plan.goalProgress?.status!=="ready") {
          this.status=this.plan.goalProgress?.message || this.plan.need;
          if(this.plan.goalProgress?.status==="complete")this.stop(this.status,{source:"task-complete",code:"collection-complete"});
          else this.setHealth("collection-wait",this.status);
          return;
        }
        if ((['tower','mutation'].includes(this.plan.mode) || this.plan.activityId) && this.plan.automatable === false) {
          this.status = this.plan.need; this.setHealth("activity-wait",this.status); return;
        }
        if ((this.plan.goalMode || this.selectedGoalMode()) === "shiny" && this.explicitShinyTarget() &&
            this.settings.shinyStopWhenDone !== false &&
            this.plan.goalProgress?.status === "complete" && this.plan.goalProgress?.requestedComplete === true) {
          this.stop(this.plan.goalProgress.message,{source:"task-complete",code:"shiny-complete"}); return;
        }
        if (
          this.plan.objective === "shiny" &&
          this.plan.shinyStatus !== "ready" && !this.plan.goalProgress
        ) {
          this.stop(this.plan.need, { source: this.plan.shinyStatus === "complete" ? "task-complete" : "policy-stop",
            code: this.plan.shinyStatus === "complete" ? "shiny-complete" : "shiny-unavailable" });
          return;
        }
        if (this.nextRunIntent === "automatic" && this.settings.autoRestart === false) {
          this.stop("自动连局已关闭，已取消下一局", { source: "auto-restart-disabled", code: "auto-restart-disabled" });
          return;
        }
        if(!this.mutationMenuReady(this.plan,valid))return;
        const boosts =
          (this.plan.goalMode || this.selectedGoalMode()) === "shiny" &&
          this.settings.shinyUseStone && normalizeShinyTypes(this.settings.shinyTypes).includes('shiny') &&
          (app.meta.profile.bag?.["shiny-stone"] || 0) > 0
            ? ["shiny-stone"]
            : [];
        const visibleStart = this.visibleStartStep(this.plan, boosts, valid);
        if (visibleStart?.waiting) return;
        if (!this.safeAction("start-run", meta.account, "开始下一局", "start")) return;
        const scope=this.compatibility?.maintenanceScope;
        if(scope?.biomeIds && (!scope.biomeIds.includes(this.plan.biome)||!scope.nativeModes.includes(this.plan.mode)||!scope.tiers.includes(this.plan.tier)||this.plan.mode==='endless'&&!scope.endlessModeIds?.includes(this.plan.goalMode||this.settings.mode))) {
          this.stop("当前开局方案超出已核验地图或模式，未提交开局",{source:"unsupported-native-route",code:"m2-start-route-unavailable"});return;
        }
        if (this.plan.mode === "tower") {
          const live = this.liveTowerEvent(this.plan.towerEvent?.id);
          if (!live || live.id !== this.plan.towerEvent?.id || live.biome !== this.plan.biome) {
            this.cadence.reset("tower-event-closed");
            this.status="紫苑塔活动状态已改变，等待重新确认原生入口";return;
          }
        }
        this.status = `${this.plan.priority} · 准备 ${this.plan.biome}`;

        if (!valid()) return;
        if(this.plan.mode==='mutation'&&!this.mutationMenuReady(this.plan,valid))return;
        if(this.plan.unlockAction?.kind==="qualify-ranking"&&this.plan.qualification?.kind==="clan-event"&&this.currentRankingClanMembership()!==true){
          this.status="当前战队成员资格尚未由原生确认，先完成原生加入/资格核对，不提交个人局冒充战队参赛";return;
        }
        // The visible native selectors above have confirmed the route. Submit
        // through the same native method as the final button, retaining 111's
        // Promise/Stop/save guards without its uncancellable 520ms UI wipe.
        const start = app.startRun({
          species: this.plan.species,
          biome: this.plan.biome,
          tier: this.plan.tier,
          mode: this.plan.mode,
          ...(this.plan.mode==='mutation'?{mutation:this.plan.mutationPlan.variant}:{}),
          boosts,
        });
        this.completeSafeAction("start-run", meta.account);
        const success = await start;
        if (!this.enabled || this.app !== app || meta.account !== account ||
            (this.controlEpoch || 0) !== epoch) {
          // A submitted native start cannot be withdrawn after the server has
          // accepted it. Leave the returned run to the player, with no helper
          // inputs or forced pause; never touch a replacement account.
          if (success && !this.enabled && this.app === app && app.meta === meta && meta.account === account)
            this.release(true);
          return;
        }
        if (!success) {
          this.status = "开局未成功，等待服务器";
          this.nextStartAt = performance.now() + this.retryDelay;
          this.retryDelay = Math.min(60000, this.retryDelay * 2);
          this.setHealth("server-wait", this.status, this.nextStartAt);
        } else {
          this.retryDelay = 2000;
          if (app.run && app.run !== r) this.planRun = app.run;
          this.setHealth("healthy", "原生开局成功");
        }
      } catch (error) {
        // A rejected native request can outlive Stop or a new explicit Start.
        // Only its still-current control attempt may report a controller error.
        if (this.startingAttempt === attempt && this.enabled &&
            this.controlIdentityCurrent() && (this.controlEpoch || 0) === attempt.epoch) throw error;
      } finally {
        if (this.startingAttempt === attempt) {
          this.starting = false;
          this.startingAttempt = null;
        }
      }
    },
    async claimClanRewards(app, valid) {
      const meta=app?.meta,backend=app?.backend,account=meta?.account,epoch=this.controlEpoch || 0;
      if(this.settings.autoClaim!==true||!account||typeof account!=="object"||account.guest||typeof WeakRef!=="function"||
          typeof valid!=="function"||typeof backend?.clanStatus!=="function"||typeof backend.clan!=="function"||
          typeof backend.clanClaim!=="function"||typeof meta.adopt!=="function")return false;
      const current=()=>this.enabled&&this.settings.autoClaim===true&&this.app===app&&app.meta===meta&&app.backend===backend&&
        meta.account===account&&(this.controlEpoch || 0)===epoch&&!app.run&&!app.starting&&!app.coopRoom?.open&&!this.deploymentWait&&
        !this.savePending&&!meta.queued&&!meta.hasPending?.()&&!this.nativeSavedNotice?.root?.isConnected&&
        performance.now()>=(this.savedNoticeWaitUntil || 0)&&this.menuOperationsAllowed();
      if(!current()||!valid()||!this.isVerifiedClearProfileCurrent())return false;
      const busy=this.clanRewardBusy;
      if(busy)return busy.app.deref()===app&&busy.meta.deref()===meta&&busy.account.deref()===account;
      this.clanRewardChecks ||= new WeakMap();
      let state=this.clanRewardChecks.get(account);
      if(!state||state.app.deref()!==app||state.meta.deref()!==meta||state.backend.deref()!==backend) {
        state={app:new WeakRef(app),meta:new WeakRef(meta),backend:new WeakRef(backend),until:0,failures:0,uncertain:state?.uncertain===true};
        this.clanRewardChecks.set(account,state);
      }
      if(performance.now()<state.until)return false;
      if(!this.safeAction("clan-rewards",account,state.uncertain?"核对战队领奖回执":"核对并领取战队奖励","reward"))return true;
      if(!current()||!valid()||!this.isVerifiedClearProfileCurrent())return true;
      const profile=meta.profile,nativeEpoch=meta.epoch,
        unchanged=()=>current()&&meta.profile===profile&&meta.epoch===nativeEpoch,
        fresh=()=>unchanged()&&valid()&&this.isVerifiedClearProfileCurrent(),
        normalized=value=>!!value&&typeof value==="object"&&!Array.isArray(value)&&Array.isArray(value.league)&&
          Array.isArray(value.seen)&&Array.isArray(value.cosmetics)&&!!value.biomes&&typeof value.biomes==="object"&&!Array.isArray(value.biomes)&&
          !!value.bag&&typeof value.bag==="object"&&!Array.isArray(value.bag)&&Number.isFinite(value.stardust)&&value.stardust>=0&&
          Number.isFinite(value.bonk)&&value.bonk>=0,
        earnedProfile=(value,receipt)=>normalized(value)&&["league","seen","cosmetics","itemsOwned"].every(key=>
          !Array.isArray(profile[key])||Array.isArray(value[key])&&profile[key].every(item=>value[key].includes(item)))&&
          ["stardust","bonk"].every(key=>!Number.isFinite(profile[key])||value[key]>=profile[key])&&
          Object.entries(profile.bag || {}).every(([key,count])=>!Number.isFinite(count)||Number(value.bag[key] || 0)>=count)&&
          Number.isFinite(receipt.dust)&&receipt.dust>=0&&(!Number.isFinite(profile.stardust)||value.stardust>=profile.stardust+receipt.dust)&&
          (receipt.bonk==null||Number.isFinite(receipt.bonk)&&receipt.bonk>=0&&(!Number.isFinite(profile.bonk)||value.bonk>=profile.bonk+receipt.bonk))&&
          (receipt.bag==null||typeof receipt.bag==="object"&&!Array.isArray(receipt.bag))&&
          (receipt.unlocks==null||Array.isArray(receipt.unlocks)),
        token={app:new WeakRef(app),meta:new WeakRef(meta),account:new WeakRef(account)};
      this.clanRewardBusy=token;state.until=performance.now()+30000;
      try {
        await meta.queue;if(!fresh())return true;
        if(state.uncertain) {
          // A lost POST may already have granted the batch. First use the
          // ordinary observed profile read; no duplicate claim is inferred.
          if(typeof backend.loadProfile!=="function")return false;
          const request=backend.loadProfile(account);this.completeSafeAction("clan-rewards",account);
          const saved=await request;
          if(!unchanged()||!this.profileLoadResponseCurrent(saved)||!normalized(saved))return true;
          meta.adopt(saved);
          if(!current()||meta.profile!==saved||!this.confirmNativeProfileOrigin(saved,app,meta,account))return true;
          if(!this.commitUnlockProfile(saved,"native-clan-reward-resync"))return true;
          state.uncertain=false;state.failures=0;
          this.status="已核对原生战队领奖资料；下次仅在服务器仍列有奖励时领取";
          return true;
        }
        const statusRequest=backend.clanStatus(account);this.completeSafeAction("clan-rewards",account);
        const status=await statusRequest;if(!fresh())return true;
        const id=status?.clan?.id,idValid=typeof id==="number"&&Number.isSafeInteger(id)&&id>0||typeof id==="string"&&id.length>0&&id.length<=128&&id.trim()===id;
        if(!idValid)return false;
        const clan=await backend.clan(account,id);if(!fresh())return true;
        // Same membership gate as native SL/AI: a public clan or pending join
        // is not permission to collect another clan's rewards.
        if(clan?.id!==id||!["leader","officer","member"].includes(clan.me)||!Array.isArray(clan.rewards)||!clan.rewards.length)return false;
        if(!fresh())return true;
        state.uncertain=true;
        const response=await backend.clanClaim(account);
        if(!fresh())return true;
        if(!earnedProfile(response?.profile,response)||response?.clan?.id!==id||!["leader","officer","member"].includes(response.clan.me)) {
          this.status="战队领奖回执尚未核验，稍后先核对原生资料，不重复领取";return true;
        }
        meta.adopt(response.profile);
        if(!current()||meta.profile!==response.profile||!this.confirmNativeProfileOrigin(meta.profile,app,meta,account)||
            !this.commitUnlockProfile(meta.profile,"native-clan-claim"))return true;
        state.uncertain=false;state.failures=0;state.until=performance.now()+30000;
        const bag=Object.fromEntries(Object.entries(response.bag || {}).slice(0,64).filter(([key,count])=>
          /^[A-Za-z0-9][A-Za-z0-9_.:+-]{0,99}$/.test(key)&&Number.isSafeInteger(count)&&count>0&&
          Object.hasOwn(meta.profile.bag,key)&&Number.isFinite(meta.profile.bag[key])&&meta.profile.bag[key]>(Number(profile.bag?.[key]) || 0))
          .map(([key,count])=>[key,Math.min(count,meta.profile.bag[key]-(Number(profile.bag?.[key]) || 0))])),
          unlocks=(Array.isArray(response.unlocks)?response.unlocks:[]).filter(key=>typeof key==="string"&&key.length<=128&&meta.profile.cosmetics.includes(key)&&!profile.cosmetics.includes(key)).slice(0,128),
          rewards={...(Number.isFinite(response.dust)&&response.dust>=0?{dust:response.dust}:{}),
            ...(Number.isFinite(response.bonk)&&response.bonk>=0?{bonk:response.bonk}:{}),bag,unlocks},
          granted=rewards.dust>0||rewards.bonk>0||Object.keys(bag).length>0||unlocks.length>0;
        this.recordEvent({id:`clan-claim-${Date.now()}-${this.clanRewardSequence=(this.clanRewardSequence || 0)+1}`,
          kind:"choice",type:"clanClaim",at:Date.now(),confirmed:granted,profileVerified:true,profileSource:"native-clan-claim",
          profile:this.savedRewardsSnapshot(),rewards,message:granted?"已采用原生战队奖励保存回执；仅记录服务器实际授予的奖励":"原生已返回战队资料，本次未确认新增奖励"});
        this.status=granted?"已领取并核验原生战队奖励":"已核对原生战队资料，本次没有新增奖励";return true;
      } catch(error) {
        state.failures=Math.min(4,state.failures+1);state.until=performance.now()+[30000,60000,120000,300000][state.failures-1];
        if(current()) {
          this.observeMenuFailure(error,app,account,backend);
          this.status="战队奖励查询/领取暂未确认，将限频核对原生回执，不影响正常对局";
        }
        return true;
      } finally {if(this.clanRewardBusy===token)this.clanRewardBusy=null;}
    },
    async claimRewards(app, valid) {
      const meta = app.meta;
      if (this.settings.autoClaim === false) return false;
      if(!this.menuProfileScopeCurrent(true))return true;
      const claim = async (key, label, action) => {
        if (!valid() || !this.menuOperationsAllowed() || !this.menuProfileScopeCurrent(true) || this.settings.autoClaim === false) return true;
        if (!this.safeAction(key, meta.account, label, "reward")) return true;
        if (!valid() || !this.menuOperationsAllowed() || !this.menuProfileScopeCurrent(true)) return true;
        action();
        this.completeSafeAction(key, meta.account);
        await meta.queue;
        return !valid() || meta.queued || meta.hasPending() ||
          this.settings.randomDelay !== false;
      };
      if (this.compatibility.capabilities?.tasks !== false &&
          typeof meta.claimTask === "function") {
        for (const task of this.tasks()) {
          if (!task.claimed && task.progress >= task.goal &&
              await claim(`task-${task.period}-${task.index}`, "领取委托奖励",
                () => meta.claimTask(task.period, task.index))) return true;
        }
        for (const period of ["daily", "weekly"]) {
          const periodData = meta.profile[period], claimed = periodData?.claimed;
          const count = Array.isArray(periodData?.ids) ? periodData.ids.length : 3;
          if (count > 0 && claimed?.length > count && claimed.slice(0, count).every(Boolean) && !claimed[count] &&
              await claim(`task-${period}-bonus`, "领取委托完成奖励",
                () => meta.claimTask(period, count))) return true;
        }
      }
      if (this.compatibility.capabilities?.quests !== false &&
          typeof meta.questProgress === "function" && typeof meta.claimQuest === "function") {
        for (const quest of this.bridge.quests || []) {
          if (!meta.profile.quests?.[quest.id] && meta.questProgress(quest) >= quest.goal &&
              await claim(`quest-${quest.id}`, "领取成就奖励",
                () => meta.claimQuest(quest))) return true;
        }
      }
      return this.claimClanRewards(app,valid);
    },
    async prepareAutomaticItemUnlock(menuValid = null) {
      if(this.settings.autoUnlockItems!==true)return false;
      const app=this.app,meta=app?.meta,account=meta?.account,epoch=this.controlEpoch||0,
        runAt=this.runStartedAt,valid=()=>this.enabled&&this.settings.autoUnlockItems===true&&
          this.app===app&&app?.meta===meta&&meta.account===account&&(this.controlEpoch||0)===epoch&&
          this.runStartedAt===runAt&&!app.starting&&!app.coopRoom?.open&&(!app.run||app.run.state==="over")&&
          !this.savePending&&(!menuValid||menuValid())&&this.menuOperationsAllowed()&&this.menuProfileScopeCurrent(true);
      if(!meta||typeof meta.buyItem!=="function"||!valid())return false;
      if(meta.queued||meta.hasPending?.())return true;
      let scope=this.automaticItemUnlockScope;
      if(!scope||scope.app.deref()!==app||scope.meta.deref()!==meta||scope.account.deref()!==account||scope.epoch!==epoch||scope.runAt!==runAt)
        this.automaticItemUnlockScope=scope={app:new WeakRef(app),meta:new WeakRef(meta),account:new WeakRef(account),epoch,runAt,failed:new Map(),pending:null};
      if(scope.pending){
        const pending=scope.pending;
        if(!this.profileLoadResponseCurrent(meta.profile)||meta.profile===pending.optimistic.deref())return true;
        if(meta.profile.itemsOwned?.includes(pending.key))this.commitUnlockProfile(meta.profile,"native-auto-item-confirmed");
        else scope.failed.set(pending.key,performance.now()+30000);
        scope.pending=null;
      }
      // The enabled fourth-move-slot prerequisite retains its existing reserve.
      // autoUpgrade=false must not freeze the independent item permission.
      if(this.settings.autoUpgrade!==false&&this.settings.reserveMoveSlot!==false&&this.compatibility.capabilities?.lab!==false){
        const slot=this.bridge.lab?.find(row=>row.id==="slot-move"),level=meta.lab?.("slot-move");
        if(slot&&Number.isFinite(level)&&level<slot.max)return false;
      }
      const catalog=this.getUnlockCatalog(),source=this.bridge.compatibility?.sourceHash||this.compatibility.sourceHash;
      if(!source||catalog?.sourceHash!==source)return false;
      const choices=(catalog.targets||[]).filter(row=>row.category==="items"&&row.action?.kind==="buy-item"&&
        typeof row.action.key==="string"&&Number.isFinite(row.action.price)&&row.action.price>0&&
        !(scope.failed.get(row.action.key)>performance.now())&&
        !meta.profile.itemsOwned?.includes(row.action.key)&&Number.isFinite(meta.profile.stardust)&&meta.profile.stardust>=row.action.price)
        .map(row=>({key:row.action.key,price:row.action.price,gain:nativeEvasionItemGain(row.action.key,{},this.bridge,true)}))
        .sort((a,b)=>b.gain-a.gain||a.price-b.price||a.key.localeCompare(b.key));
      const choice=choices[0];if(!choice)return false;
      const key="automatic-item-"+choice.key;
      if(!this.safeAction(key,account,"自动解锁永久道具","research"))return true;
      if(!valid()||meta.queued||meta.hasPending?.()||meta.profile.itemsOwned?.includes(choice.key)||meta.profile.stardust<choice.price)return true;
      // One native transaction per tick. Success must be confirmed by a fresh
      // adopted/loaded profile before the next candidate, never optimistic owned.
      const optimistic=meta.profile;
      let accepted=false;
      try{accepted=meta.buyItem(choice.key)===true;}
      catch{scope.failed.set(choice.key,performance.now()+30000);}
      finally{this.completeSafeAction(key,account);}
      if(!accepted){scope.failed.set(choice.key,performance.now()+30000);return true;}
      scope.pending={key:choice.key,optimistic:new WeakRef(optimistic)};
      // Existing safe-menu native verification will refresh this one origin.
      // It must not certify the very same object that native YM just mutated.
      if(this.verifiedProfileObservation?.profile?.deref()===optimistic)this.verifiedProfileObservation.profile=null;
      // A new mutation needs its own read proof; the previous successful menu
      // read's retry throttle must not suppress verification of a later purchase.
      if(!this.verifiedProfileRequest?.pending)this.verifiedProfileRequest=null;
      await meta.queue;
      return true;
    },
    async prepareLab(menuValid = null) {
      const app = this.app, meta = app.meta, account = meta.account,
        epoch = this.controlEpoch || 0;
      const valid = () => this.enabled && this.app === app && app.meta === meta &&
        meta.account === account && (this.controlEpoch || 0) === epoch &&
        this.settings.autoUpgrade !== false && (!menuValid || menuValid()) && this.menuOperationsAllowed() && this.menuProfileScopeCurrent(true);
      if (this.compatibility.capabilities?.lab === false ||
          typeof meta.lab !== "function" || typeof meta.buyLab !== "function") return false;
      await meta.queue;
      for (let i = 0; i < 40 && valid(); i++) {
        if (meta.queued || meta.hasPending?.()) return true;
        const id = this.selectLabUpgrade();
        if (!id) return false;
        const visible = this.visibleResearchStep(id, valid);
        if (visible?.waiting) return true;
        const key = `lab-${id}`;
        if (!this.safeAction(key, account, "解锁研究所升级", "research")) return true;
        if (!valid()) return true;
        const before = meta.lab(id);
        if (visible?.button) {
          if (visible.button.disabled) return true;
          visible.button.click();
        } else meta.buyLab(id);
        this.completeSafeAction(key, account);
        await meta.queue;
        if (!valid() || meta.hasPending?.()) return true;
        if (meta.lab(id) <= before) return false;
        if (this.settings.randomDelay !== false) return true;
      }
      return false;
    },
    buyLab() {
      if (this.settings.autoUpgrade !== true || !this.menuOperationsAllowed()) return false;
      const id = this.selectLabUpgrade();
      return id && this.app.meta.buyLab(id) ? id : false;
    },
    selectLabUpgrade() {
      const meta = this.app.meta;
      if (
        this.compatibility.capabilities?.lab === false ||
        !Array.isArray(this.bridge.lab)
      )
        return false;
      const slot = this.bridge.lab.find((u) => u.id === "slot-move");
      if (
        slot &&
        meta.lab(slot.id) < slot.max &&
        this.settings.reserveMoveSlot !== false
      ) {
        if (meta.profile.stardust >= slot.cost(meta.lab(slot.id)))
          return slot.id;
        return false;
      }
      const upgrades = this.bridge.lab.filter(
        (u) =>
          meta.lab(u.id) < u.max &&
          u.cost(meta.lab(u.id)) <= meta.profile.stardust,
      );
      const weights = {
        "slot-move": 300,
        regen: 80,
        armor: 60,
        damage: 70,
        attackSpeed: 90,
        moveSpeed: 40,
        maxHp: 70,
        pickupRange: 45,
        xpGain: 60,
        research: 35,
        revive: 100,
      };
      upgrades.sort(
        (a, b) =>
          (weights[b.id] || weights[b.stat] || 10) / (1 + meta.lab(b.id)) -
          (weights[a.id] || weights[a.stat] || 10) / (1 + meta.lab(a.id)),
      );
      return upgrades[0]?.id || false;
    },
  };
  const activePilot = previousPilot || pilot;
  activePilot.battleRecorder = recorderInstance;
  if (!activePilot.battleRecordChannelInstalled && globalThis.chrome?.webview) {
    activePilot.battleRecordChannelInstalled = true;
    globalThis.chrome.webview.addEventListener?.("message", event => {
      if (event.data?.kind === "battleRecordsAck") recording()?.safe(() => recording().acknowledge(event.data.ack));
    });
  }
  if (!activePilot.battleRecordHeartbeatInstalled) {
    activePilot.battleRecordHeartbeatInstalled = true;
    setInterval(() => {
      const p = globalThis.__PB_PILOT || activePilot;
      p.battleRecorder?.safe(() => {
        p.battleRecorder.setProvenance(p.battleRecorder.revision, p.bridge?.compatibility?.sourceHash ?? p.compatibility?.sourceHash ?? null);
        p.battleRecorder.observe(p.app?.run, p); p.battleRecorder.pump();
      });
    }, 100);
  }


  if (!activePilot.shinySaveListener) {
    activePilot.shinySaveListener = true;
    document.addEventListener("pb-saved", () => {
      const p=globalThis.__PB_PILOT || activePilot;
      return p.beginSavedProfileRecovery();
    });
  }
  if (previousPilot) {
    previousPilot.configureWecomPush?.(null);
    previousPilot.release();
    for (const [key, value] of Object.entries(pilot)) {
      if (typeof value === "function" || !(key in previousPilot))
        previousPilot[key] = value;
    }
    previousPilot.characterUnlockImplementation=pilot.characterUnlockImplementation;
    if(previousPilot.legacyCharacterCachedPlan(previousPilot.plan)&&
        previousPilot.plan&&!previousPilot.plan.legacyCharacterUnlock160){
      previousPilot.plan=null;previousPilot.planRun=null;previousPilot.unlockSelectionKey=null;
      previousPilot.unlockProgress=null;previousPilot.characterPracticeScope=null;
    }
    if (previousPilot.enabled) previousPilot.controlIdentityCurrent();
    if (previousPilot.run) {
      previousPilot.navigation = previousPilot.navigationFor(previousPilot.run);
      previousPilot.navTarget = null;
    }
    previousPilot.frames = previousPilot.totalMs = previousPilot.maxMs = 0;
    previousPilot.timings = [];
    previousPilot.observeSaves();
    const priorBossRetreat = previousPilot.settings.bossRetreat === true;
    const priorForceCost = previousPilot.settings.forceCostInteractions === true;
    const priorFlight = JSON.stringify([previousPilot.settings.flightMove,previousPilot.settings.flightNoInteractions,previousPilot.settings.flightKeepInteractions,previousPilot.settings.flightJumpItemCount]);
    const missingBossRetreatPreference = typeof previousPilot.settings.bossRetreat !== "boolean";
    previousPilot.settings = mergePilotPartialSettings(previousPilot.settings,config.settings);
    if(!Object.hasOwn(previousPilot.settings,"pickupBonkoin"))previousPilot.settings.pickupBonkoin=true;
    Object.assign(previousPilot.settings,normalizeFlightSettings(previousPilot.settings,config.settings));
    Object.assign(previousPilot.settings,normalizeStageAndSlotSettings(previousPilot.settings));
    Object.assign(previousPilot.settings,normalizeCostSettings(previousPilot.settings));
    Object.assign(previousPilot.settings,normalizeTimedMovementSettings(previousPilot.settings));
    // This is an actual code reload, not a repeated settings notification.
    // Drop travel instances that may still close over the previous class code.
    previousPilot.invalidateTravelModeMotion();
    if (!priorForceCost && Object.hasOwn(config.settings,"forceCostInteractions") && config.settings.forceCostInteractions === true && previousPilot.settings.forceCostInteractions === true)
      previousPilot.costPriorityScope = null;
    if (missingBossRetreatPreference || priorBossRetreat !== previousPilot.settings.bossRetreat)
      previousPilot.invalidateBossRetreatMotion();
    if (priorFlight !== JSON.stringify([previousPilot.settings.flightMove,previousPilot.settings.flightNoInteractions,previousPilot.settings.flightKeepInteractions,previousPilot.settings.flightJumpItemCount]))
      previousPilot.invalidateFlightInteractionMotion();
    previousPilot.settings.finalReplacements=normalizeFinalReplacementEntries(previousPilot.settings.finalReplacements);
    delete previousPilot.settings.expertMode;
    for (const key of ["captureAim", "captureAimAttempt", "operationSettingsPrepared",
      "operationSettingsReady", "operationSettingsPromise", "expertSettings"])
      delete previousPilot[key];
    previousPilot.lastOperation = null;
    previousPilot.cadence = new ActionCadence({ settings: previousPilot.settings });
    previousPilot.cadenceAccount = previousPilot.app?.meta?.account;
    previousPilot.interactionTracker = createInteractionTracker();
    previousPilot.tacticalDirector = new TacticalDirector();
    // A live update must install the new native-capture retry method too;
    // retaining an older class instance would leave only the no-quit guard.
    previousPilot.terrainRecoveryTracker = new TerrainRecoveryTracker();
    previousPilot.terrainRecoveryState = null;
    previousPilot.terrainHopTracker = typeof TerrainHopTracker === "function" ? new TerrainHopTracker() : null;
    previousPilot.terrainHopState = null;
    previousPilot.terrainHopScope = null;
    previousPilot.crowdEscapeTracker = typeof CrowdEscapeTracker === "function" ? new CrowdEscapeTracker() : null;
    previousPilot.crowdEscapeState = null;
    previousPilot.crowdEscapeScope = null;
    previousPilot.explorationPlanner = typeof ExplorationPlanner === "function" ? new ExplorationPlanner() : null;
    previousPilot.explorationState = null;
    previousPilot.flightControlScope=null;
    previousPilot.flightLandingScope=null;
    previousPilot.flightTravelPlanner=null;
    previousPilot.flightCollectionScope=null;
    previousPilot.flightInteractionScope=null;
    previousPilot.tacticalAssessment = null;
    previousPilot.pendingWorldAttempt = null;
    previousPilot.priorityShopScope = null;
    if (config.builds.length) previousPilot.builds = config.builds;
    previousPilot.observeDocumentLifecycle();
    previousPilot.observePauseInputs();
    previousPilot.observeInspectionInput();
    previousPilot.publishControl();
    return;
  }
  delete pilot.settings.expertMode;
  globalThis.__PB_PILOT = pilot;
  pilot.observeDocumentLifecycle();
  pilot.observePauseInputs();
  pilot.observeInspectionInput();
  pilot.publishControl();
  document.addEventListener("pointerlockchange", (event) => {
    pilot.pointerReleaseEvent = null;
    if (document.pointerLockElement) {
      pilot.mouseReleased = false; pilot.mouseReleaseTicket = null;
      return;
    }
    const ticket = pilot.mouseReleaseTicket;
    pilot.mouseReleaseTicket = null;
    if (!ticket || ticket.enabled !== pilot.enabled || pilot.pauseRequested || ticket.run !== pilot.app?.run ||
        ticket.account !== pilot.app?.meta?.account || ticket.epoch !== (pilot.controlEpoch || 0) ||
        ticket.until < performance.now() || ticket.run?.state !== "play") return;
    pilot.pointerReleaseEvent = { event, run: ticket.run, account: ticket.account, epoch: ticket.epoch,
      enabled: ticket.enabled };
  }, true);
  document.addEventListener("pointerdown", event => {
    if (event.isTrusted !== false && (event.target?.id === "game" || event.target?.closest?.(nativeCompatSelector("#game")))) {
      pilot.mouseReleased = false; pilot.mouseReleaseTicket = null;
    }
  }, true);
  let panel = null,
    output = null;
  function drawPanel() {
    if (config.embedded) return;
    if (!document.body) return;
    if (!panel) {
      panel = document.createElement("aside");
      panel.id = "pb-autopilot-panel";
      panel.style.cssText =
        "position:fixed;left:8px;bottom:8px;z-index:2147483647;background:#121927ed;color:#e8f5ff;padding:10px 12px;border:1px solid #52d6a0;border-radius:10px;font:12px/1.5 system-ui;max-width:300px;pointer-events:auto;box-shadow:0 4px 20px #0008";
      const title = document.createElement("strong");
      title.textContent = "PokéBonk 自动推进";
      const button = document.createElement("button");
      button.textContent = "启动 / 暂停";
      button.style.cssText = "margin-left:10px;cursor:pointer";
      button.onclick = () =>
        pilot.enabled ? pilot.stop("用户暂停") : pilot.requestStart().catch(error => pilot.fail(error));
      output = document.createElement("div");
      panel.append(title, button, output);
      document.body.append(panel);
    }
    const s = pilot.snapshot();
    output.textContent = `${s.status} | Lv.${s.level || "-"} HP ${Math.ceil(s.hp || 0)}/${s.maxHp || "-"} | 决策 P95 ${s.p95DecisionMs.toFixed(2)} ms | ${pilot.settings.hotkeyToggle} 启停 · ${pilot.settings.hotkeyStop} 暂停 · ${pilot.settings.hotkeyReleaseMouse} 释放鼠标`;
  }
  addEventListener(
    "keydown",
    (e) => {
      // Native key binds may overlap configurable helper chords. Our own
      // dispatchEvent inputs must reach the game without becoming a user
      // start/stop/release request in this listener.
      if (e.isTrusted === false || e.repeat || e.isComposing ||
          /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || "") ||
          e.target?.isContentEditable ||
          e.target?.closest?.(nativeCompatSelector('[contenteditable="true"], [data-hotkey-recording="true"]'))) return;
      const chord = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.code].filter(Boolean).join("+");
      const action = ["hotkeyToggle", "hotkeyStop", "hotkeyReleaseMouse"]
        .find(key => pilot.settings[key] === chord);
      if (!action) return;
      if (
        config.embedded &&
        globalThis.chrome?.webview
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        chrome.webview.postMessage({ kind: "pilotHotkey", key: chord });
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      if (action === "hotkeyToggle")
        pilot.enabled ? pilot.stop("用户暂停") : pilot.requestStart().catch(error => pilot.fail(error));
      else if (action === "hotkeyStop") pilot.stop();
      else pilot.releaseMouse();
    },
    true,
  );
  setInterval(() => {
    try {
      pilot.syncCompatibility(true);
      pilot.macro().catch((error) => pilot.fail(error));
    } catch (error) {
      pilot.fail(error);
    }
  }, 100);
  setInterval(drawPanel, 500);
}

// Pure geometry adapter for reviewed native boss kit and Tower mech fields. It reads
// only observed attacks; it never invokes attacks, changes timers, or supplies
// imagined pre-warning fields. Future dive points stop at the native endpoint.
export function extraBossHazards(run, frameDt = 1 / 60) {
  const hazards = [],
    enemies = [];
  const boss = run?.boss,
    kit = boss?.kit || boss?.mech,
    en = run?.enemies;
  if (!boss?.alive || !kit || kit.dead || kit.disposed) return { hazards, enemies };
  const index = boss.bossIndex;
  const species = en?.species?.[index] ?? kit.species;
  const pos = run.player?.pos;
  const groundAt = (x, z) => {
    const y = run.terrain?.height?.(x, z);
    return Number.isFinite(y) ? y : undefined;
  };
  // Native playerLow tests the ground under the player, rather than the
  // height of a remote wall/ring center. The next frame recomputes this floor.
  const playerGround = pos ? groundAt(pos.x, pos.z) : undefined;
  const finite = (...values) => values.every(Number.isFinite);
  const circle = (x, z, radius, eta, maxHeight, extra = {}) => ({
    shape: "circle",
    x,
    y: groundAt(x, z),
    z,
    radius,
    eta,
    maxHeight,
    ...extra,
  });
  // Audited native 0.8.55 Hypno: groundN particles are only visuals, so the
  // generic telegraph hook cannot see its hypnosis sweep. Read the live mech.
  // The native cone has no height/invulnerability gate; jumping is not cover.
  if(species===97 && kit.swing?.t>0 && finite(kit.bx,kit.bz,kit.swing.base,run.time)) {
    hazards.push({shape:"sweeping-cone",source:"hypno-pendulum",owner:"enemy",
      x:kit.bx,z:kit.bz,radius:16,halfAngle:.61,baseAngle:kit.swing.base,
      amplitude:.87,period:1.6,phaseTime:run.time,trackingRate:.4,
      mirrored:kit.swing.rage===true,life:kit.swing.t,eta:0,ignoresInvulnerability:true});
  }
  if(species===94 && kit.hyp && kit.hyp.t>=0 && finite(kit.hyp.t,kit.hyp.ax,kit.hyp.az,kit.hyp.bx,kit.hyp.bz)) {
    const h=kit.hyp;
    hazards.push({shape:"line",source:"gengar-hypnosis",owner:"enemy",x:h.ax,z:h.az,x2:h.bx,z2:h.bz,
      radius:1.8,y:playerGround,maxHeight:1.6,eta:h.t,life:h.t+.05,oneShot:true,ignoresInvulnerability:true});
  }
  if(species===105&&finite(kit.bx,kit.bz)) {
    // Tower Huesomerang lives in mech.bones/orbitals, not projectiles. Each
    // short-lived capsule covers one bounded segment, split at its turnaround.
    for(const bone of kit.bones || []) {
      if(bone.hit || !finite(bone.t,bone.tx,bone.tz) || bone.t<0 || bone.t>=1)continue;
      const remaining=Math.min(1.2,(1-bone.t)*1.7),turn=(.5-bone.t)*1.7,
        times=[0,remaining,...Array.from({length:12},(_,i)=>(i+1)*.1),turn]
          .filter(t=>t>=0&&t<=remaining).sort((a,b)=>a-b),
        point=t=>{const phase=bone.t+t/1.7,factor=phase<.5?phase*2:2-phase*2;
          return {x:kit.bx+(bone.tx-kit.bx)*factor,z:kit.bz+(bone.tz-kit.bz)*factor};};
      for(let i=1;i<times.length;i++) {
        const from=times[i-1],to=times[i];if(to-from<1e-8)continue;
        const a=point(from),b=point(to),
          drift=Math.max(0,Number(en?.speed?.[index])||0)*to;
        hazards.push({shape:"line",source:"marowak-bone",owner:"enemy",...a,x2:b.x,z2:b.z,
          radius:1.4+drift,y:playerGround,maxHeight:1.8,eta:from,life:to,persistent:true,oneShot:false});
      }
    }
    // Native Marowak keeps this front in kit.waves, separate from the generic
    // guardian's waves. Negative radius is its real warm-up; damage is gated
    // until r>=1, then travels at 12m/s and retires at r>=24.
    for(const wave of kit.waves || []) {
      if(wave.hit||!Number.isFinite(wave.r)||wave.r>=24)continue;
      hazards.push({shape:"ring",source:"marowak-wail",x:kit.bx,z:kit.bz,y:playerGround,
        radius:Math.max(1,wave.r),minRadius:1,maxRadius:24,radialSpeed:12,
        thickness:.6+12*Math.min(.05,Math.max(0,Number(frameDt)||1/60)),
        eta:Math.max(0,(1-wave.r)/12),life:Math.max(0,(24-wave.r)/12),maxHeight:1.3});
    }
  }
  if (species === 151) {
    for (const mine of kit.mines || []) {
      if (!finite(mine.x, mine.z, mine.t, mine.arm, mine.fuse)) continue;
      if (mine.fuse >= 0) {
        // Already triggered: the actual blast has radius 3 after fuse seconds.
        hazards.push(
          circle(mine.x, mine.z, 3, mine.fuse, 2.2, {
            oneShot: true,
            life: mine.fuse + 0.05,
          }),
        );
      } else if (mine.t > 0) {
        // Avoid crossing the native 2.6 m trigger boundary once armed. This is
        // a trigger exclusion region, not a claim of instant contact damage.
        // It gives the pilot time to route around a mine before its .45 s fuse.
        hazards.push(
          circle(mine.x, mine.z, 2.6, Math.max(0, mine.arm), undefined, {
            persistent: true,
            oneShot: false,
            life: mine.t,
          }),
        );
        const expiry = Math.max(0, mine.t, mine.arm) + 0.45;
        if (expiry <= 1.2)
          hazards.push(
            circle(mine.x, mine.z, 3, expiry, 2.2, {
              oneShot: true,
              life: expiry + 0.05,
            }),
          );
      }
    }
  }
  if (species !== 146) return { hazards, enemies };
  for (const wall of kit.walls || []) {
    if (
      wall.hit ||
      !finite(wall.ox, wall.oz, wall.dx, wall.dz, wall.s, wall.gap, wall.delay)
    )
      continue;
    if (wall.s > 28) continue;
    const delay = Math.max(0, wall.delay);
    if (delay > 1.2) continue;
    const segments = [
      [-15, Math.min(15, wall.gap - 2.2)],
      [Math.max(-15, wall.gap + 2.2), 15],
    ].filter(([a, b]) => b > a);
    // A wall has no damage during delay. Sample from activation onwards at
    // .1 s intervals, preserving its native gap and 9 m/s normal movement.
    for (let step = 0; step <= 12; step++) {
      const eta = delay + step * 0.1;
      if (eta > 1.2 + 1e-8) break;
      const progress = wall.s + 9 * Math.max(0, eta - delay);
      if (progress > 28) break;
      const cx = wall.ox + wall.dx * progress;
      const cz = wall.oz + wall.dz * progress;
      for (const [a, b] of segments)
        hazards.push({
          shape: "line",
          x: cx - wall.dz * a,
          z: cz + wall.dx * a,
          x2: cx - wall.dz * b,
          z2: cz + wall.dx * b,
          y: playerGround ?? groundAt(cx, cz),
          radius: 0.9,
          eta,
          maxHeight: 1.3,
          oneShot: true,
          life: eta + 0.1,
        });
    }
  }
  for (const ring of kit.rings || []) {
    if (!finite(ring.x, ring.z, ring.r, ring.t) || ring.t <= 0) continue;
    const radius = Math.max(1.2, (ring.r * ring.t) / 1.6);
    if (!ring.hit)
      hazards.push({
        shape: "ring",
        x: ring.x,
        y: playerGround ?? groundAt(ring.x, ring.z),
        z: ring.z,
        radius,
        minRadius: 1.2,
        radialSpeed: radius > 1.2 ? -ring.r / 1.6 : 0,
        thickness: 1,
        eta: 0,
        life: ring.t,
        maxHeight: 1.3,
        persistent: true,
        oneShot: false,
      });
    // Native tick schedules a separate center blast on expiration even when
    // this ring's sweeping edge has already hit the player.
    if (ring.t + 0.01 <= 1.2)
      hazards.push(
        circle(ring.x, ring.z, 2.2, ring.t + 0.01, 2.2, {
          oneShot: true,
          life: ring.t + 0.06,
        }),
      );
  }
  const dive = kit.dive;
  if (
    dive &&
    !dive.hit &&
    finite(dive.t, dive.dur, dive.x0, dive.z0, dive.x1, dive.z1) &&
    dive.dur > 0 &&
    dive.t >= 0 &&
    dive.t < dive.dur
  ) {
    const remaining = dive.dur - dive.t;
    const sample = (eta) => {
      const progress = Math.min(1, (dive.t + eta) / dive.dur);
      hazards.push(
        circle(
          dive.x0 + (dive.x1 - dive.x0) * progress,
          dive.z0 + (dive.z1 - dive.z0) * progress,
          2.6,
          eta,
          1.6,
          { y: playerGround, oneShot: true, life: eta + 0.05 },
        ),
      );
    };
    for (let step = 0; step * 0.05 < Math.min(1.2, remaining) - 1e-8; step++)
      sample(step * 0.05);
    sample(Math.min(1.2, remaining));
    // Velocity is deliberately not supplied as a persistent enemy override:
    // native dive ends after remaining seconds and then E.vx/E.vz stay zero.
    // An unbounded linear enemy predictor would invent movement past x1/z1.
  }
  return { hazards, enemies };
}
