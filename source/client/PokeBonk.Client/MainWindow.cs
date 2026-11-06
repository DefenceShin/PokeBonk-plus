using System;
using System.CodeDom.Compiler;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Media;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Markup;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using Microsoft.Win32;

namespace PokeBonk.Client;

public class MainWindow : Window, IComponentConnector
{
	private sealed record RecoveryLoginRecord(string Name, string Password, string? IdentityHash, string SavedAt)
	{
		public bool Complete
		{
			get
			{
				if (!string.IsNullOrWhiteSpace(Name))
				{
					return Password.Length > 0;
				}
				return false;
			}
		}

		public bool HasDraft
		{
			get
			{
				if (Name.Length <= 0)
				{
					return Password.Length > 0;
				}
				return true;
			}
		}
	}

	private struct RecoveryDataBlob
	{
		public int Length;

		public nint Data;
	}

	private CoreWebView2Environment? browserEnvironment;

	private BrowserOptimizationPolicy? browserOptimization;

	private readonly HostPerformance hostPerformance = new HostPerformance();

	private readonly BrowserExecutionPower browserExecutionPower = new BrowserExecutionPower();

	private const string BrowserDiagnosticScript = "(()=>{\n  const app=globalThis.__PB_BRIDGE?.app,r=app?.run;\n  const result={activeRun:!!r&&r.state!=='over',runState:r?.state??null,\n    gpu:{available:false,hardwareAcceleration:'unknown',reason:'等待游戏渲染器；不会新建WebGL上下文'},\n    visibility:document.visibilityState,hasFocus:document.hasFocus(),devicePixelRatio:devicePixelRatio};\n  try {\n    const renderer=app?.r?.renderer,gl=typeof renderer?.getContext==='function'?renderer.getContext():null;\n    if(!gl)return result;\n    const clean=v=>typeof v==='string'?v.replace(/[\\r\\n\\0]/g,' ').slice(0,256):null;\n    const ext=gl.getExtension('WEBGL_debug_renderer_info');\n    const reportedRenderer=clean(gl.getParameter(ext?ext.UNMASKED_RENDERER_WEBGL:gl.RENDERER));\n    result.gpu={available:true,contextLost:gl.isContextLost(),version:clean(gl.getParameter(gl.VERSION)),\n      vendor:clean(gl.getParameter(ext?ext.UNMASKED_VENDOR_WEBGL:gl.VENDOR)),renderer:reportedRenderer,\n      hardwareAcceleration:/swiftshader|llvmpipe|software rasterizer|microsoft basic render/i.test(reportedRenderer||'')?'software-reported':'runtime-managed',\n      reason:'读取当前游戏已有WebGL上下文；renderer字符串和GPU进程均不等于硬件性能保证'};\n  } catch {result.gpu.reason='当前渲染器暂不提供安全诊断，未修改游戏状态';}\n  return result;\n})()";

	private CompatibilityOverridesStore? compatibilityOverrides;

	private readonly SemaphoreSlim compatibilityEditorLock = new SemaphoreSlim(1, 1);

	private JsonObject? latestPreparedCompatibility;

	private string? cachedCompatibilitySource;

	private string? cachedCompatibilitySourceHash;

	private string? cachedCompatibilitySourceUrl;

	private static readonly HttpClient compatibilityPublicHttp = new HttpClient(new HttpClientHandler
	{
		UseCookies = false,
		AllowAutoRedirect = false,
		UseDefaultCredentials = false
	})
	{
		Timeout = TimeSpan.FromSeconds(25.0)
	};

	private string? observedCompatibilityMainUrl;

	private string? observedCompatibilityNewsUrl;

	private readonly Dictionary<string, (long Page, long Revision, string Uri)> compatibilityResourceReceipts = new Dictionary<string, (long, long, string)>(StringComparer.Ordinal);

	private SoundPlayer? convenienceSound;

	private MemoryStream? convenienceSoundData;

	private DispatcherTimer? convenienceSoundTimer;

	private HashSet<string>? convenienceAlertIds;

	private Queue<string>? convenienceAlertOrder;

	private Dictionary<string, long>? convenienceAlertTimes;

	private bool convenienceSoundUnavailable;

	private JsonArray customPlans = new JsonArray();

	private int catalogRevision = 1;

	private const string LocalFunctionEnvelopeScript = "(work)=>{try{const value=work();return value===undefined?{ok:false,code:'local-result-undefined',errorType:'Undefined'}:{ok:true,value}}catch(error){return {ok:false,code:'local-function-threw',errorType:typeof error?.name==='string'?error.name:'Error'}}}";

	private JsonObject connectionDiagnostics = new JsonObject
	{
		["strategy"] = "browser-response-v1",
		["stage"] = "starting"
	};

	private readonly Queue<JsonObject> connectionEvents = new Queue<JsonObject>();

	private JsonObject? nativeBootObservation;

	private DateTimeOffset? nativeBootLoadingAt;

	private CancellationTokenSource connectionNavigationCancellation = new CancellationTokenSource();

	private const int MaximumScriptBytes = 12000000;

	private const string BrowserFeatureProbeScript = "(()=>{var missing=[];if(typeof Object.hasOwn!=='function')missing.push('Object.hasOwn');if(typeof Array.prototype.at!=='function')missing.push('Array.at');if(typeof structuredClone!=='function')missing.push('structuredClone');return {ok:missing.length===0,missing:missing}})()";

	private JsonObject updateStatus = new JsonObject
	{
		["state"] = "pending",
		["reason"] = "启动后自动检查官网部署及当前接口，新增机制需另行验证。"
	};

	private JsonObject? lastCatalogSnapshot;

	private JsonObject localization = new JsonObject();

	private JsonObject resourceHashes = new JsonObject();

	private readonly JsonObject publicWikiResources = new JsonObject();

	private readonly Dictionary<string, string> publicOverlayHashes = new Dictionary<string, string>(StringComparer.Ordinal);

	private string preparedDeploymentHash = "";

	private string preparedDeploymentModuleUrl = "";

	private long preparedDeploymentCompatibilityRevision = -1L;

	private JsonObject? preparedDeploymentSummary;

	private const string DeploymentPreparationSummaryFunction = "((source,options)=>{const {code,modulePatches,...summary}=prepareGameSource(source,options);return summary;})";

	private string synchronizedCatalogHash = "";

	private string pendingDeploymentHash = "";

	private bool checkingUpdates;

	private bool resumeAfterDeployment;

	private bool waitingDeploymentReload;

	private bool deploymentNavigationFinished;

	private long pendingDeploymentIntentGeneration = -1L;

	private bool pendingDeploymentManualStart;

	private const string DeploymentIntentScript = "(()=>{const p=globalThis.__PB_PILOT;if(!p)return null;const a=p.app,r=a?.run;p.deploymentWait=true;return {resume:p.enabled===true&&p.settings.autoRestart!==false&&r?.state!=='paused',manual:!!a&&a.starting!==true&&p.enabled===true&&p.nextRunIntent==='manual'&&(!r||r.state==='over'&&p.manualStartRequested===true)}})()";

	private const string DeploymentDecisionScript = "(()=>{const p=globalThis.__PB_PILOT,a=globalThis.__PB_BRIDGE?.app;if(!a||!p)return {canReload:false};if(a.starting===true)return {canReload:false,code:'native-start-pending',reason:'等待原生开局完成'};return {...deploymentReloadDecision({hasRun:!!a.run,state:a.run?.state,savePending:p.savePending,pendingSave:a.meta.hasPending(),runAt:p.runStartedAt,events:p.events}),running:p.enabled===true};})()";

	private bool synchronizingRuntimeCatalog;

	private long publicCatalogGeneration;

	private DateTimeOffset catalogRetryAfter = DateTimeOffset.MinValue;

	private DateTimeOffset lastUpdateCheck = DateTimeOffset.MinValue;

	private readonly PortableStorage portable;
	private readonly BattleReportArchive battleReportArchive;
	private readonly BattleRecordWriter battleRecordWriter;

	private readonly PrerequisiteService prerequisites;

	private readonly string[] launchArguments;

	private const string CheckedGameHash = "55eace003608cfe31c027dca07b2b9a5edfe94a67313085807298347bd2226a8";

	private const string CheckedGameVersion = "0.8.87";

	private static readonly string ClientVersion = "2.0.1+S3-M3-offline";

	private DisclaimerWindow? clientUpdatesWindow;

	private readonly HttpClient http = new HttpClient
	{
		Timeout = TimeSpan.FromSeconds(45.0)
	};

	private readonly DispatcherTimer timer = new DispatcherTimer
	{
		Interval = TimeSpan.FromSeconds(1.0)
	};

	private readonly List<JsonObject> logs = new List<JsonObject>();

	private readonly ClientObservationIds observedRuns = new ClientObservationIds();

	private readonly ClientObservationIds observedResults = new ClientObservationIds();

	private readonly ClientObservationIds observedEvents = new ClientObservationIds();

	private readonly ClientAccountObservation observedAccount = new ClientAccountObservation();

	private readonly SemaphoreSlim commandLock = new SemaphoreSlim(1, 1);

	private readonly BrowserStartupState browserStartup = new BrowserStartupState();

	private ulong? activePanelNavigationId;

	private string panelNavigationError = "";

	private readonly bool smoke;

	private readonly bool autoGuestEntry;

	private readonly bool diagnostics;

	private readonly string storage;

	private JsonObject config = Defaults();

	private JsonObject catalog = new JsonObject
	{
		["characters"] = new JsonArray(),
		["builds"] = new JsonArray()
	};

	private JsonObject shinyCatalog = new JsonObject();

	private JsonObject? game;

	private JsonObject? baseline;

	private JsonObject? lastProfile;

	private string status = "正在打开游戏，选择游客或登录账号后点击开始挂机";

	private string runKey = "";

	private string compatibility = "";

	private string? operationStatus;

	private string storageError = "";

	private string initScriptId = "";

	private CoreWebView2? initScriptOwner;

	private long initScriptRevision;

	private JsonObject? compatibilityReport;

	private DateTimeOffset gameNavigationAt = DateTimeOffset.Now;

	private bool gameModuleObserved;

	private bool ready;

	private bool ticking;

	private bool closing;

	private bool mayClose;

	private bool uiReady;

	private bool gameProcessFailed;

	private bool needsProfileRefresh;

	private bool panelHidden;

	private bool panelExpanded;

	private double panelRestoreHeight = 320.0;

	private string browserFailureReports = "";

	private Window? logDocumentWindow;

	private TextBox? logDocumentText;

	private JsonObject? commandResult;

	private long elapsedMs;

	private long journalWrites;

	private readonly HostSnapshotWriteBudget statusWriteBudget = new HostSnapshotWriteBudget();

	private double journalWriteMilliseconds;

	private readonly ClientRegionProgress regionProgress = new ClientRegionProgress();

	private int runs;

	private int completedRuns;

	private int wins;

	private int kills;

	private int grossStardust;

	private int spentStardust;

	private int newSeen;

	private int newLeague;

	private int shiniesFound;

	private int capturedShinies;

	private int newShinies;

	private HashSet<int>? confirmedShinies;

	private long lastTick = Stopwatch.GetTimestamp();

	private static readonly JsonSerializerOptions JsonOptions = new JsonSerializerOptions
	{
		WriteIndented = true
	};

	private static readonly string[] UnlockCategories = new string[10] { "maps", "dex", "characters", "research", "shiny", "lab", "items", "achievements", "appearance", "events" };

	private static readonly string[] ModeIds = new string[20]
	{
		"auto", "map", "resources", "dex", "characters", "quests", "leaderboard", "endless", "mutation", "shiny",
		"tower", "research", "lab", "items", "achievements", "appearance", "wardrobe", "allClears", "events", "autoManage"
	};

	private static readonly string[] LeaderboardRouteIds = new string[3] { "leaderboard-kills", "leaderboard-time", "leaderboard-survival" };

	private bool unlockTargetsMigrated;

	private static bool disclaimerShownThisLaunch;

	private string? ProcessStart;

	private static readonly string[] HotkeyFields = new string[3] { "hotkeyToggle", "hotkeyStop", "hotkeyReleaseMouse" };

	private const string BridgeScript = "(()=>{if(location.hostname!=='pilot.local')return;const pending=new Map(),handlers={state:new Set(),log:new Set()};let sequence=0,keys={hotkeyToggle:'F8',hotkeyStop:'F9',hotkeyReleaseMouse:'F10'};\r\nchrome.webview.addEventListener('message',({data:m})=>{if(m.event){if(m.event==='state'&&m.data?.config)keys={...keys,...m.data.config};for(const f of handlers[m.event]||[])f(m.data);return}const p=pending.get(m.id);if(!p)return;clearTimeout(p.timer);pending.delete(m.id);m.ok?p.resolve(m.data):p.reject(Error(m.error))});\r\nconst request=(action,payload={})=>new Promise((resolve,reject)=>{const id=++sequence;const interactive=action==='installPrerequisites'||action==='importCustomPlanFile'||action==='exportCustomPlans'&&payload.chooseFile||['importSkin','exportSkin','saveSkinPrompt'].includes(action);const timer=interactive?null:setTimeout(()=>{pending.delete(id);reject(Error('客户端响应超时，请重试'))},action==='exportLogs'?120000:action==='wecomTest'||action==='probeCompatibility'?90000:35000);pending.set(id,{resolve,reject,timer});chrome.webview.postMessage({id,action,payload})});\r\nwindow.desktop=Object.freeze({getState:()=>request('getState'),getCatalog:()=>request('getCatalog'),command:request,onState:f=>{handlers.state.add(f);return()=>handlers.state.delete(f)},onLog:f=>{handlers.log.add(f);return()=>handlers.log.delete(f)}});\r\naddEventListener('keydown',e=>{if(e.isTrusted!==true||e.isComposing||e.target?.closest?.('input,textarea,select,[contenteditable=\"true\"],[data-hotkey-capture]'))return;const chord=[e.ctrlKey?'Ctrl':null,e.altKey?'Alt':null,e.shiftKey?'Shift':null,e.code].filter(Boolean).join('+');const action=chord===keys.hotkeyToggle?'toggle':chord===keys.hotkeyStop?'pause':chord===keys.hotkeyReleaseMouse?'releaseMouse':null;if(!action)return;e.preventDefault();e.stopImmediatePropagation();if(!e.repeat)request(action).catch(()=>{})},true);\r\n})()";

	private readonly ClientSavedRewardTracker savedRewards = new ClientSavedRewardTracker();

	private string? logRunGroup;

	private string? logRunStartedAt;

	private long logRevision;

	private PublicReloadBoundary? publicReloadProof;

	private PublicReloadPermit? publicReloadPermit;

	private string? publicDialogObservedIdentity;

	private readonly HashSet<PublicScriptDialogWindow> publicGameDialogs = new HashSet<PublicScriptDialogWindow>();

	private bool wantedRunIntent;

	private bool recoveryRequested;

	private bool recoveryReloadGame;

	private bool recoveryRebuildBrowser;

	private bool recoveryReloadPanel;

	private bool currentRunOnlyIntent;

	private bool interruptedSaveUnconfirmed;

	private bool recoveryRequiresLogin;

	private bool guestFallbackAuthorized;

	private bool temporaryGuest;

	private string? temporaryGuestIdentity;

	private long recoveryGeneration;

	private long pageGeneration;

	private long panelGeneration;

	private long intentGeneration;

	private ulong? activeGameNavigationId;

	private long controlEpoch = -1L;

	private long hostIntentArmedAt;

	private long lastHostCancellationAt;

	private string? expectedRecoveryIdentity;

	private string? controlInstance;

	private string? recoveryJavaScriptEpoch;

	private string? lastControlTransition;

	private readonly HashSet<string> retiredControlInstances = new HashSet<string>();

	private string recoveryPhase = "idle";

	private string recoveryReason = "";

	private string lastHealthPhase = "";

	private DateTimeOffset? nextRecoveryRetry;

	private DateTimeOffset healthSince = DateTimeOffset.Now;

	private int recoveryAttempts;

	private long lastUnresponsiveNoticeAt = -60000L;

	private long unresponsiveNoticePage = -1L;

	private Task? recoveryTask;

	private CancellationTokenSource recoveryCancellation = new CancellationTokenSource();

	private Func<string?, CancellationToken, Task<bool>>? recoveryLoginHandler;

	private static readonly int[] RecoveryDelays = new int[5] { 2, 5, 10, 30, 60 };

	private const string RecoveryInfoScript = "(()=>{const p=globalThis.__PB_PILOT,a=globalThis.__PB_BRIDGE?.app;return {contract:globalThis.__PB_COMPATIBILITY,control:p?.controlSnapshot?.(),authentication:p?.authenticationSnapshot?.(),runState:a?.run?.state??null,hasAccount:!!a?.meta?.account,hasProfile:!!a?.meta?.profile,hasPending:a?.meta?.hasPending?.()===true,savePending:p?.savePending===true,enabled:p?.enabled===true}})()";

	private const string HealthyNativeBridgeScript = "(()=>{const b=globalThis.__PB_BRIDGE,p=globalThis.__PB_PILOT,c=globalThis.__PB_COMPATIBILITY;return !!b?.app?.meta&&p?.app===b.app&&['ready','partial','degraded'].includes(p.compatibility?.state)&&['ready','partial','degraded'].includes(c?.state)})()";

	private const string RecoveryReloadSafetyScript = "(()=>{const a=globalThis.__PB_BRIDGE?.app,p=globalThis.__PB_PILOT;if(!a)return {canReload:globalThis.__PB_GAME_BOOT?.phase==='failed',code:'native-app-unavailable',reason:'未能确认原生对局状态，保留游戏页面'};if(a.starting===true)return {canReload:false,code:'native-start-pending',reason:'原生开局仍在进行，保留游戏页面'};return deploymentReloadDecision({hasRun:!!a.run,state:a.run?.state,savePending:p?.savePending,pendingSave:a.meta?.hasPending?.()!==false,runAt:p?.runStartedAt,events:p?.events});})()";

	private readonly BrowserScriptQueue browserScriptQueue = new BrowserScriptQueue();

	private const string CaptureRunStartScopeScript = "(ticket,activeRunOnly=false)=>{\r\n  globalThis.__PB_HOST_START_SCOPE=null;\r\n  const p=globalThis.__PB_PILOT,a=globalThis.__PB_BRIDGE?.app,m=a?.meta,c=m?.account;\r\n  if(!p||p.app!==a||!c||!['string','number'].includes(typeof c.id)||!String(c.id)||typeof c.id==='number'&&!Number.isFinite(c.id)||typeof c.guest!=='boolean')return null;\r\n  if(activeRunOnly&&(!a.run||a.run.state==='over'))return null;\r\n  const id=String(c.id),type=c.guest?'guest':'registered';\r\n  globalThis.__PB_HOST_START_SCOPE={ticket,pilot:p,app:a,meta:m,account:c,id,type,activeRunOnly,run:activeRunOnly?a.run:null};\r\n  return {id,type};\r\n}";

	private const string RunStartScopeCurrentScript = "(scope)=>{\r\n  const p=globalThis.__PB_PILOT,a=globalThis.__PB_BRIDGE?.app,m=a?.meta,c=m?.account;\r\n  return !!scope&&globalThis.__PB_HOST_START_SCOPE===scope&&scope.pilot===p&&scope.app===a&&scope.meta===m&&scope.account===c&&p?.app===a&&String(c?.id)===scope.id&&(c?.guest===true?'guest':c?.guest===false?'registered':null)===scope.type&&(!scope.activeRunOnly||a.run===scope.run&&a.run?.state!=='over');\r\n}";

	private bool recoveryLoginBlocked;

	private bool recoveryLoginComplete;

	private bool recoveryLoginHasDraft;

	private bool recoveryLoginKnown = true;

	private bool recoveryLoginBound;

	private long recoveryVaultRevision;

	private string? recoveryLoginUpdatedAt;

	private string recoveryLoginMessage = "正常恢复使用游戏已有登录状态；可选保存当前账号，用于会话失效后自动重登。";

	private DateTimeOffset lastRecoveryLoginAttempt = DateTimeOffset.MinValue;

	private readonly SemaphoreSlim recoveryVaultLock = new SemaphoreSlim(1, 1);

	private const string RecoveryLoginIdentityScript = "(name)=>{\n  const a=globalThis.__PB_BRIDGE?.app?.meta?.account;\n  if(a?.guest!==false||String(a.name||'').trim().toLocaleLowerCase()!==name.toLocaleLowerCase()||!['string','number'].includes(typeof a.id)||!String(a.id)||typeof a.id==='number'&&!Number.isFinite(a.id))return null;\n  return {id:String(a.id),type:'registered'};\n}";

	private const string GuestInspectScript = "(v)=>{\n  if(location.origin!=='https://pokebonk.com'||!v.epoch||globalThis.__PB_HOST_RECOVERY_EPOCH!==v.epoch||globalThis.__PB_HOST_VAULT_REVISION!==v.revision)return {code:'cancelled'};\n  const a=globalThis.__PB_BRIDGE?.app;if(!a||a.meta?.account||a.run)return {code:'account-or-run'};\n  try{if(localStorage.getItem('pb.session')!==null)return {code:'cached-session'}}catch{return {code:'storage-unavailable'}}\n  const cards=[...document.querySelectorAll('.auth-card')];if(cards.length!==1)return {code:'not-welcome'};\n  const c=cards[0];if(c.matches('.mt-card')||c.querySelector('.mt-ribbon,.ban-ribbon')||document.querySelector('.captcha-box,.cf-turnstile,iframe[src*=\"challenges.cloudflare.com\"]'))return {code:'restricted'};\n  if(c.querySelector('.err')?.textContent?.trim())return {code:'native-error'};\n  if([...c.querySelectorAll('input')].some(i=>!!i.value))return {code:'native-input'};\n  const buttons=[...c.querySelectorAll('.auth-body > button.btn.big.red')].filter(b=>/^(?:¡?Jugar como invitado!?|以游客身份游玩[！!]?|Play as guest[！!]?)$/i.test(b.textContent.trim()));\n  if(buttons.length===1&&!buttons[0].disabled&&!c.querySelector('input[autocomplete=\"current-password\"],input[autocomplete=\"new-password\"]'))return {code:'ready'};\n  const tabs=[...c.querySelectorAll('.auth-tabs button')].filter(b=>/^(?:Invitado|游客|Guest)$/i.test(b.textContent.trim()));\n  if(tabs.length!==1||tabs[0].disabled)return {code:'no-guest-entry'};\n  tabs[0].click();return {code:'selected'};\n}";

	private const string GuestSubmitScript = "(v)=>{\n  if(location.origin!=='https://pokebonk.com'||!v.epoch||globalThis.__PB_HOST_RECOVERY_EPOCH!==v.epoch||globalThis.__PB_HOST_VAULT_REVISION!==v.revision)return {code:'cancelled'};\n  const a=globalThis.__PB_BRIDGE?.app;if(!a?.meta||a.meta.account||a.run)return {code:'account-or-run'};\n  let hadGuestCache;try{if(localStorage.getItem('pb.session')!==null)return {code:'cached-session'};hadGuestCache=localStorage.getItem('pb.guest')!==null}catch{return {code:'storage-unavailable'}}\n  const cards=[...document.querySelectorAll('.auth-card')];if(cards.length!==1)return {code:'not-welcome'};\n  const c=cards[0];if(c.matches('.mt-card')||c.querySelector('.mt-ribbon,.ban-ribbon')||document.querySelector('.captcha-box,.cf-turnstile,iframe[src*=\"challenges.cloudflare.com\"]'))return {code:'restricted'};\n  if(c.querySelector('.err')?.textContent?.trim())return {code:'native-error'};\n  if([...c.querySelectorAll('input')].some(i=>!!i.value)||c.querySelector('input[autocomplete=\"current-password\"],input[autocomplete=\"new-password\"]'))return {code:'native-input'};\n  const buttons=[...c.querySelectorAll('.auth-body > button.btn.big.red')].filter(b=>/^(?:¡?Jugar como invitado!?|以游客身份游玩[！!]?|Play as guest[！!]?)$/i.test(b.textContent.trim()));\n  if(buttons.length!==1||buttons[0].disabled)return {code:'no-guest-entry'};\n  globalThis.__PB_TEMP_GUEST_REQUEST={ticket:v.ticket,epoch:v.epoch,revision:v.revision,app:a,meta:a.meta,hadGuestCache,account:null};\n  buttons[0].click();return {code:'submitted',hadGuestCache};\n}";

	private const string GuestStarterScript = "(v)=>{\n  if(location.origin!=='https://pokebonk.com'||!v.epoch||globalThis.__PB_HOST_RECOVERY_EPOCH!==v.epoch||globalThis.__PB_HOST_VAULT_REVISION!==v.revision)return {code:'cancelled'};\n  const x=globalThis.__PB_TEMP_GUEST_REQUEST,a=globalThis.__PB_BRIDGE?.app;\n  if(!x||x.ticket!==v.ticket||x.epoch!==v.epoch||x.revision!==v.revision||x.app!==a||x.meta!==a?.meta||a.run||a.meta.account?.guest!==true)return {code:'not-owned-guest'};\n  if(x.account&&x.account!==a.meta.account)return {code:'account-changed'};\n  x.account??=a.meta.account;\n  if(document.querySelector('.mt-card,.mt-ribbon,.ban-ribbon,.captcha-box,.cf-turnstile,iframe[src*=\"challenges.cloudflare.com\"]')||[...document.querySelectorAll('.err')].some(e=>e.textContent?.trim()))return {code:'restricted'};\n  if(!a.meta.profile)return {code:'profile-wait'};\n  if(a.meta.profile.starter)return {code:'ready'};\n  if(x.hadGuestCache)return {code:'existing-guest-starter'};\n  if(x.starterClicked)return {code:'starter-wait'};\n  const screens=[...document.querySelectorAll('.screen.sp')];if(screens.length!==1)return {code:'starter-wait'};\n  const cards=[...screens[0].querySelectorAll('button.sp-card')],chosen=cards.filter(b=>b.classList.contains('on'));\n  const buttons=[...screens[0].querySelectorAll('button.btn.big.red.sp-go')];\n  if(cards.length!==3||chosen.length!==1||buttons.length!==1||buttons[0].disabled)return {code:'starter-wait'};\n  x.starterClicked=true;buttons[0].click();return {code:'starter-submitted'};\n}";

	private string? pendingTemporaryGuestTicket;

	private DateTimeOffset lastGuestFallbackAttempt = DateTimeOffset.MinValue;

	private RestReminderWindow? restReminderWindow;

	private string? restReminderToken;

	private string? restReminderDismissedToken;

	private string? restReminderAcknowledgingToken;

	private string? restReminderOperationStatus;

	private long restReminderPage;

	private long restReminderIntent;

	private object? restReminderView;

	private JsonObject? scheduledStartPayload;

	private long scheduledStartIntent;

	private SkinFileStore? skinFiles;

	private JsonObject? skinRuntimeStatus;

	private JsonObject? lastSkinOperation;

	private readonly SemaphoreSlim skinApplyLock = new SemaphoreSlim(1, 1);

	private long skinAppliedPageGeneration = -1L;

	private bool skinApplying;

	private DateTimeOffset skinNextRetryAt = DateTimeOffset.MinValue;

	private ClientVerifiedClears? verifiedClears;

	private string? verifiedClearsIdentity;

	private bool verifiedClearsPublished;

	private bool verifiedClearsHistoryLoaded;

	private long verifiedClearsPage = -1L;

	private bool verifiedClearReceiptSignal;

	private readonly SemaphoreSlim verifiedClearScopeLock = new SemaphoreSlim(1, 1);

	private const string CaptureVerifiedClearScopeScript = "(ticket,readHistory)=>{\n  const p=globalThis.__PB_PILOT,a=globalThis.__PB_BRIDGE?.app,m=a?.meta,c=m?.account;\n  if(!p||p.app!==a||typeof p.setVerifiedClears!=='function'||typeof WeakRef!=='function'||!m?.profile||!c||typeof c.guest!=='boolean'||\n    !['string','number'].includes(typeof c.id)||!String(c.id)||typeof c.id==='number'&&!Number.isFinite(c.id))return null;\n  const prior=globalThis.__PB_HOST_CLEAR_PUBLISHED;\n  globalThis.__PB_HOST_CLEAR_SCOPE={ticket,pilot:new WeakRef(p),app:new WeakRef(a),meta:new WeakRef(m),account:new WeakRef(c)};\n  return {id:String(c.id),type:c.guest?'guest':'registered',\n    published:prior&&prior.pilot?.deref()===p&&prior.app?.deref()===a&&prior.meta?.deref()===m&&prior.account?.deref()===c?prior.version:null,\n    historyCurrent:p.isVerifiedClearProfileCurrent?.()===true,\n    receipts:p.readVerifiedClearReceipts?.()??[],\n    runs:readHistory&&p.isVerifiedClearProfileCurrent?.()===true?(Array.isArray(m.profile.runs)?m.profile.runs:[]).slice(0,2048)\n      .filter(r=>r?.mode==='standard'&&r.victory===true).map(r=>({species:r.species,biome:r.biome,tier:r.tier,mode:'standard',victory:true,\n        ...(r.end===undefined?{}:{end:r.end&&typeof r.end==='object'?{how:typeof r.end.how==='string'?r.end.how:null}:null})})):[]};\n}";

	private const string VerifiedClearScopeCurrentScript = "(ticket)=>{\n  const s=globalThis.__PB_HOST_CLEAR_SCOPE,p=globalThis.__PB_PILOT,a=globalThis.__PB_BRIDGE?.app,m=a?.meta;\n  return !!s&&s.ticket===ticket&&s.pilot?.deref()===p&&p?.app===a&&s.app?.deref()===a&&s.meta?.deref()===m&&s.account?.deref()===m?.account;\n}";

	private bool verifiedClearsWarningShown;

	private WecomPushService? wecomService;

	private WecomStorage? wecomStorage;

	private long wecomRevision;

	private string wecomSignature = "";

	private string wecomCollectorGeneration = "";

	private string wecomStatus = "企微推送已关闭；不运行后台采集或发送";

	private long wecomConfiguredPage = -1L;

	private string wecomConfiguredController = "";

	private object? wecomConfiguredCore;

	private CancellationTokenSource wecomActionCancellation = new CancellationTokenSource();

	private JsonArray wecomTargets = new JsonArray();

	private JsonObject? wecomLastRuntime;

	internal Func<JsonObject, IWecomTransport>? WecomTransportFactory;

	internal IWecomClock? WecomTestClock;

	internal bool WecomStartWorker = true;

	private string wecomIdentityScope = "";

	private string wecomSavedScope = "";

	private string wecomClientState = "";

	private bool wecomFailureScope;

	private bool wecomObservedRunning;

	private long wecomHostSequence;

	private readonly Dictionary<string, HashSet<string>> wecomSavedSets = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);

	private readonly Dictionary<string, Dictionary<string, double>> wecomSavedLevels = new Dictionary<string, Dictionary<string, double>>(StringComparer.Ordinal);

	private readonly Dictionary<string, double> wecomSavedNumbers = new Dictionary<string, double>(StringComparer.Ordinal);

	internal Grid MainLayout;

	internal RowDefinition GameRow;

	internal RowDefinition SplitterRow;

	internal RowDefinition ControlRow;

	internal Border GameHost;

	internal WebView2 GameView;

	internal GridSplitter PanelSplitter;

	internal WebView2 PanelView;

	private bool _contentLoaded;

	private BrowserOptimizationPolicy OptimizationPolicy
	{
		get
		{
			if (browserOptimization == null)
			{
				browserOptimization = new BrowserOptimizationPolicy(portable);
				browserOptimization.Load();
			}
			return browserOptimization;
		}
	}

	private CompatibilityOverridesStore CompatibilityOverrides => compatibilityOverrides ?? (compatibilityOverrides = new CompatibilityOverridesStore(portable));

	private int CompatibilitySourceLimit => CompatibilityOverrides.Integer("sourceMaxBytes", 12000000, 1000000, 30000000);

	private int CompatibilityBootGrace => CompatibilityOverrides.Integer("bootGraceSeconds", 120, 30, 600);

	private Uri CompatibilityGamePage => CompatibilityGamePageFor(CompatibilityConfiguration());

	private string CustomPlansPath => portable.DataPath("custom-plans.json");

	private bool NativeBootLoadingGrace
	{
		get
		{
			string text = Str(nativeBootObservation?["phase"]);
			bool flag = ((text == "ready" || text == "failed") ? true : false);
			if (flag || CompatibilityMayOperate(compatibilityReport) || HardCompatibilityBlocked)
			{
				return false;
			}
			if (text == "loading")
			{
				return DateTimeOffset.UtcNow - (nativeBootLoadingAt ?? gameNavigationAt) < TimeSpan.FromSeconds(CompatibilityBootGrace);
			}
			if (DateTimeOffset.Now - gameNavigationAt < TimeSpan.FromSeconds(CompatibilityBootGrace))
			{
				return true;
			}
			if (Str(connectionDiagnostics["stage"]) == "prepare" && DateTimeOffset.TryParse(Str(connectionDiagnostics["lastActivityAt"]), out var result))
			{
				return DateTimeOffset.UtcNow - result < TimeSpan.FromSeconds(30.0);
			}
			return false;
		}
	}

	private string DataRoot => portable.DataDirectory;

	private bool RecoveryBusy
	{
		get
		{
			if (!recoveryRequested)
			{
				return recoveryPhase != "idle";
			}
			return true;
		}
	}

	private bool HardCompatibilityBlocked => false;

	private bool CanRetryRecovery
	{
		get
		{
			bool flag = storageError.Length == 0 && !HardCompatibilityBlocked;
			if (flag)
			{
				bool flag2 = gameProcessFailed || recoveryRequested;
				if (!flag2)
				{
					bool flag3;
					switch (Str(compatibilityReport?["code"]))
					{
					case "browser-process-exited":
					case "navigation-failed":
					case "startup-timeout":
					case "adapter-error":
						flag3 = true;
						break;
					default:
						flag3 = false;
						break;
					}
					flag2 = flag3;
				}
				flag = flag2;
			}
			return flag;
		}
	}

	private string RecoveryLoginPath => portable.DataPath("recovery-login.dpapi");

	private bool HostScheduleAllowed => ActivationCalendar.Allowed(config["convenience"], DateTimeOffset.UtcNow);

	private bool ScheduledStartPending
	{
		get
		{
			if (scheduledStartPayload != null && wantedRunIntent)
			{
				return scheduledStartIntent == intentGeneration;
			}
			return false;
		}
	}

	private SkinFileStore SkinFiles => skinFiles ?? (skinFiles = new SkinFileStore(portable));

	private WecomStorage WecomStore => wecomStorage ?? (wecomStorage = new WecomStorage(portable));

	private string WecomControllerMarker => (Str(game?["control"]?["instance"]) ?? controlInstance ?? "") + ":" + Str(game?["controllerVersion"]);

	private void ShowLaunchBrowserOptimization()
	{
		if (!closing && base.IsVisible && OptimizationPolicy.ShouldOfferAtLaunch)
		{
			new BrowserOptimizationWindow(this, ReadBrowserOptimizationAsync, ApplyBrowserOptimizationAsync).ShowDialog();
		}
	}

	private void UpdateBrowserExecutionPower()
	{
		browserExecutionPower.Update(BrowserExecutionPower.ShouldHold(OptimizationPolicy.PreventAutomaticSleep, wantedRunIntent, ready, gameProcessFailed, closing, HostScheduleAllowed, Flag(game?["enabled"]), Str(game?["state"])));
	}

	private string BrowserMemoryTarget()
	{
		try
		{
			return GameView.CoreWebView2?.MemoryUsageTargetLevel.ToString() ?? "unavailable";
		}
		catch (Exception ex) when (((ex is NotImplementedException || ex is COMException || ex is InvalidOperationException) ? 1 : 0) != 0)
		{
			return "unsupported";
		}
	}

	private bool ApplyBrowserMemoryTarget()
	{
		if (GameView.CoreWebView2 == null)
		{
			return false;
		}
		try
		{
			if (GameView.CoreWebView2.IsSuspended)
			{
				return false;
			}
			GameView.CoreWebView2.MemoryUsageTargetLevel = CoreWebView2MemoryUsageTargetLevel.Normal;
			return GameView.CoreWebView2.MemoryUsageTargetLevel == CoreWebView2MemoryUsageTargetLevel.Normal;
		}
		catch (Exception ex) when (((ex is NotImplementedException || ex is COMException || ex is InvalidOperationException) ? 1 : 0) != 0)
		{
			return false;
		}
	}

	private JsonObject BrowserResourceSnapshot()
	{
		Dictionary<string, int> dictionary = new Dictionary<string, int>();
		long num = 0L;
		long num2 = 0L;
		int num3 = 0;
		int num4 = 0;
		try
		{
			foreach (CoreWebView2ProcessInfo item in browserEnvironment?.GetProcessInfos() ?? Array.Empty<CoreWebView2ProcessInfo>())
			{
				string key = item.Kind.ToString();
				dictionary[key] = dictionary.GetValueOrDefault(key) + 1;
				try
				{
					using Process process = Process.GetProcessById(item.ProcessId);
					num += process.WorkingSet64;
					num2 += process.PrivateMemorySize64;
					num3++;
				}
				catch (Exception ex) when (((ex is ArgumentException || ex is InvalidOperationException || ex is Win32Exception) ? 1 : 0) != 0)
				{
					num4++;
				}
			}
		}
		catch (Exception ex2) when (((ex2 is NotImplementedException || ex2 is COMException || ex2 is InvalidOperationException) ? 1 : 0) != 0)
		{
			num4++;
		}
		using Process process2 = Process.GetCurrentProcess();
		return new JsonObject
		{
			["scope"] = "本客户端WebView2环境进程的瞬时内存合计（含游戏和控制面板，非GPU显存）",
			["processes"] = new JsonObject(dictionary.Select((KeyValuePair<string, int> item) => KeyValuePair.Create(item.Key, (JsonNode)JsonValue.Create(item.Value)))),
			["sampledProcesses"] = num3,
			["unavailableProcesses"] = num4,
			["workingSetBytes"] = num,
			["privateMemoryBytes"] = num2,
			["hostWorkingSetBytes"] = process2.WorkingSet64
		};
	}

	private async Task<JsonObject> ReadBrowserOptimizationAsync()
	{
		JsonNode page = null;
		if (ready && !gameProcessFailed)
		{
			try
			{
				MainWindow mainWindow = this;
				TimeSpan? timeout = TimeSpan.FromSeconds(3.0);
				page = JsonNode.Parse(await mainWindow.GameScriptAsync("(()=>{\n  const app=globalThis.__PB_BRIDGE?.app,r=app?.run;\n  const result={activeRun:!!r&&r.state!=='over',runState:r?.state??null,\n    gpu:{available:false,hardwareAcceleration:'unknown',reason:'等待游戏渲染器；不会新建WebGL上下文'},\n    visibility:document.visibilityState,hasFocus:document.hasFocus(),devicePixelRatio:devicePixelRatio};\n  try {\n    const renderer=app?.r?.renderer,gl=typeof renderer?.getContext==='function'?renderer.getContext():null;\n    if(!gl)return result;\n    const clean=v=>typeof v==='string'?v.replace(/[\\r\\n\\0]/g,' ').slice(0,256):null;\n    const ext=gl.getExtension('WEBGL_debug_renderer_info');\n    const reportedRenderer=clean(gl.getParameter(ext?ext.UNMASKED_RENDERER_WEBGL:gl.RENDERER));\n    result.gpu={available:true,contextLost:gl.isContextLost(),version:clean(gl.getParameter(gl.VERSION)),\n      vendor:clean(gl.getParameter(ext?ext.UNMASKED_VENDOR_WEBGL:gl.VENDOR)),renderer:reportedRenderer,\n      hardwareAcceleration:/swiftshader|llvmpipe|software rasterizer|microsoft basic render/i.test(reportedRenderer||'')?'software-reported':'runtime-managed',\n      reason:'读取当前游戏已有WebGL上下文；renderer字符串和GPU进程均不等于硬件性能保证'};\n  } catch {result.gpu.reason='当前渲染器暂不提供安全诊断，未修改游戏状态';}\n  return result;\n})()", default(CancellationToken), timeout));
			}
			catch (Exception ex) when (!(ex is OutOfMemoryException))
			{
			}
		}
		string text = BrowserMemoryTarget();
		bool enabled = OptimizationPolicy.Enabled;
		bool flag = enabled != Program.BrowserOptimizationEnabledAtLaunch;
		bool? flag2 = page?["activeRun"]?.GetValue<bool>();
		bool flag3;
		if (flag2.HasValue)
		{
			flag3 = flag2 == true;
		}
		else
		{
			bool flag4 = game != null;
			if (flag4)
			{
				string text2 = Str(game["state"]);
				bool flag5 = ((text2 == null || text2 == "over") ? true : false);
				flag4 = !flag5;
			}
			flag3 = flag4;
		}
		bool flag6 = flag3;
		JsonObject jsonObject = new JsonObject();
		jsonObject["schemaVersion"] = 1;
		jsonObject["profileScope"] = "仅此客户端的独立WebView2与程序目录内数据；不读取或修改日常Edge设置";
		jsonObject["enabled"] = enabled;
		jsonObject["optimizedBefore"] = enabled;
		jsonObject["appliedAtLaunch"] = Program.BrowserOptimizationEnabledAtLaunch;
		jsonObject["needsReload"] = flag;
		jsonObject["needsRestart"] = flag;
		jsonObject["reloadKind"] = (flag ? "client-restart" : null);
		jsonObject["activeRun"] = flag6;
		jsonObject["runState"] = page?["runState"]?.DeepClone() ?? game?["state"]?.DeepClone();
		JsonObject jsonObject2 = jsonObject;
		JsonObject jsonObject3 = new JsonObject();
		jsonObject3["id"] = "normal-memory";
		jsonObject3["label"] = "游戏使用正常内存目标";
		jsonObject3["description"] = "使用正式WebView2 API设为Normal，避免主动采用Low内存目标。已为Normal则保持原值；不会挂起、刷新或暂停游戏，也不等同Edge的游戏省CPU开关。";
		JsonObject jsonObject4 = jsonObject3;
		flag3 = ((text == "unsupported" || text == "unavailable") ? true : false);
		jsonObject4["supported"] = !flag3;
		jsonObject3["modifiable"] = true;
		jsonObject3["current"] = text;
		jsonObject3["requested"] = "Normal";
		jsonObject3["requiresRestart"] = false;
		jsonObject2["changes"] = new JsonArray(jsonObject3, new JsonObject
		{
			["id"] = "shader-disk-cache",
			["label"] = "恢复本地GPU着色器缓存",
			["description"] = "移除客户端原有的禁用着色器磁盘缓存参数，恢复运行时默认缓存；缓存保存在程序data/browser用户数据目录。下次完整关闭并重新打开客户端后生效；不会强制中断当前对局。",
			["supported"] = true,
			["modifiable"] = true,
			["current"] = Program.BrowserOptimizationEnabledAtLaunch,
			["requested"] = true,
			["requiresRestart"] = !Program.BrowserOptimizationEnabledAtLaunch
		}, new JsonObject
		{
			["id"] = "active-system-request",
			["label"] = "挂机时请求防止自动睡眠",
			["description"] = "使用Windows正式电源请求，仅在已启用的脚本实际运行且位于允许时段时生效；停止、暂停、连接失效或关闭后释放。不改电源方案，不强制屏幕常亮，也不阻止手动睡眠或合盖；部分省电设备可能忽略此请求。旧优化记录不会自动开启此新增项，重新同意优化后才开启。",
			["supported"] = OperatingSystem.IsWindows(),
			["modifiable"] = true,
			["current"] = OptimizationPolicy.PreventAutomaticSleep,
			["requested"] = true,
			["requiresRestart"] = false
		}, new JsonObject
		{
			["id"] = "background-running",
			["label"] = "已内置后台持续运行设置",
			["description"] = "客户端已有后台防节流配置，且不主动挂起游戏。此项继续保留，不需重复修改；浏览器版本和系统策略仍可能影响后台运行。",
			["supported"] = true,
			["modifiable"] = false,
			["current"] = true,
			["requested"] = true,
			["requiresRestart"] = false
		}, new JsonObject
		{
			["id"] = "default-gpu",
			["label"] = "GPU硬件加速由运行时自动选择",
			["description"] = "WebView2默认使用GPU；客户端不禁用GPU，也不绕过驱动安全名单。没有安全的正式API可以复制日常Edge的硬件加速/游戏省CPU设置，不能保证所有显卡都启用硬件。",
			["supported"] = false,
			["modifiable"] = false,
			["current"] = page?["gpu"]?["hardwareAcceleration"]?.DeepClone() ?? JsonValue.Create("unknown"),
			["requested"] = "运行时安全默认",
			["requiresRestart"] = false
		});
		jsonObject["diagnostics"] = new JsonObject
		{
			["runtimeVersion"] = browserEnvironment?.BrowserVersionString,
			["gpu"] = page?["gpu"]?.DeepClone() ?? new JsonObject
			{
				["available"] = false,
				["reason"] = "游戏页面暂不可用"
			},
			["resources"] = BrowserResourceSnapshot(),
			["host"] = hostPerformance.Snapshot(),
			["memoryTarget"] = text,
			["profileIsLocal"] = true,
			["automaticSuspensionUsed"] = false,
			["gpuDisableArgumentUsed"] = false,
			["shaderCacheDisabledAtLaunch"] = !Program.BrowserOptimizationEnabledAtLaunch,
			["automaticSleepRequestActive"] = browserExecutionPower.Active
		};
		jsonObject["warning"] = OptimizationPolicy.ReadWarning;
		jsonObject["message"] = (flag ? "已保存优化配置。当前对局继续；请正常结算后关闭并重新打开客户端，使缓存设置生效。刷新游戏网页不能替代重启客户端。" : "可检查本客户端的实际设置与资源。优化不能保证消除游戏代码、网络或驱动引起的卡顿。");
		return jsonObject;
	}

	private async Task<JsonObject> ApplyBrowserOptimizationAsync(JsonObject payload)
	{
		bool value = default(bool);
		bool confirmed = payload["confirmed"] is JsonValue jsonValue && jsonValue.TryGetValue<bool>(out value) && value;
		OptimizationPolicy.Enable(confirmed);
		UpdateBrowserExecutionPower();
		bool memoryApplied = ApplyBrowserMemoryTarget();
		JsonObject jsonObject = await ReadBrowserOptimizationAsync();
		jsonObject["memoryTargetApplied"] = memoryApplied;
		Log("info", "浏览器优化设置已保存", Str(jsonObject["message"]) ?? "配置仅保存在本客户端目录。");
		return jsonObject;
	}

	private async Task<JsonObject> ImportVisibleBuild(JsonObject payload)
	{
		if (!ready || closing || gameProcessFailed)
		{
			throw new InvalidOperationException("请先进入游戏并打开某一局的具体配置窗口。");
		}
		if (!(payload["species"] is JsonValue jsonValue) || !jsonValue.TryGetValue<int>(out var species) || species < 1 || species > 100000)
		{
			throw new InvalidOperationException("请从角色下拉框选择要保存方案的角色。");
		}
		string text = Str(payload["name"]) ?? "";
		string text2 = Str(payload["description"]) ?? "";
		if (text.Length > 120 || text.Any(char.IsControl) || text2.Length > 2000 || text2.Any((char c) => char.IsControl(c) && c != '\n' && c != '\r' && c != '\t'))
		{
			throw new InvalidOperationException("名称最多120字、备注最多2000字，不得包含控制字符。");
		}
		WebView2 view = GameView;
		long generation = pageGeneration;
		string value = "import-" + Guid.NewGuid().ToString("N");
		JsonObject jsonObject = new JsonObject();
		string[] array = new string[4] { "characters", "moves", "items", "vitamins" };
		foreach (string propertyName in array)
		{
			jsonObject[propertyName] = catalog[propertyName]?.DeepClone() ?? new JsonArray();
		}
		JsonObject jsonObject2 = new JsonObject
		{
			["species"] = species,
			["name"] = text,
			["description"] = text2,
			["autoSelect"] = Flag(payload["autoSelect"]),
			["allowLegacy"] = Flag(payload["allowLegacy"]),
			["catalog"] = jsonObject
		};
		string literal = JsonSerializer.Serialize(value);
		JsonObject result;
		try
		{
			JsonNode capture = JsonNode.Parse(await GameScriptAsync("globalThis.__PB_PILOT?.beginVisibleBuildImport(" + literal + "," + jsonObject2.ToJsonString() + ")??{ok:false,reason:'导入接口尚未就绪，请稍后重试。'}"));
			if (!Flag(capture?["ok"]) || !(capture?["build"] is JsonObject jsonObject3))
			{
				throw new InvalidOperationException(Str(capture?["reason"]) ?? "当前没有完整可确认的具体配置。");
			}
			jsonObject3["id"] = "custom-" + Guid.NewGuid().ToString("N");
			JsonObject plan = (await LocalFunction("payload.custom-plans.mjs", "normalizeCustomPlan", jsonObject3))?.AsObject() ?? throw new InvalidOperationException("方案结构校验失败，未保存。");
			await RequireCurrent();
			string fingerprint = ImportedBuildFingerprint(plan);
			JsonObject jsonObject4 = ((!payload.ContainsKey("skipDuplicates") || Flag(payload["skipDuplicates"])) ? customPlans.OfType<JsonObject>().FirstOrDefault((JsonObject old) => old["species"]?.ToJsonString() == plan["species"]?.ToJsonString() && ImportedBuildFingerprint(old) == fingerprint) : null);
			if (jsonObject4 != null)
			{
				result = new JsonObject
				{
					["saved"] = false,
					["duplicate"] = true,
					["id"] = jsonObject4["id"]?.DeepClone(),
					["name"] = jsonObject4["name"]?.DeepClone(),
					["summary"] = capture["summary"]?.DeepClone()
				};
			}
			else
			{
				if (customPlans.Count >= 200)
				{
					throw new InvalidOperationException("方案库已达200个上限，请先整理不再需要的方案。");
				}
				JsonArray jsonArray = customPlans.DeepClone().AsArray();
				jsonArray.Add(plan.DeepClone());
				await SavePlans(jsonArray, applyLive: false, RequireCurrent);
				catalogRevision++;
				result = new JsonObject
				{
					["saved"] = true,
					["duplicate"] = false,
					["id"] = plan["id"]?.DeepClone(),
					["name"] = plan["name"]?.DeepClone(),
					["species"] = species,
					["customPlans"] = customPlans.DeepClone(),
					["summary"] = capture["summary"]?.DeepClone(),
					["warnings"] = capture["warnings"]?.DeepClone()
				};
			}
		}
		finally
		{
			if (view == GameView && generation == pageGeneration && !gameProcessFailed)
			{
				try
				{
					MainWindow mainWindow = this;
					string script = "globalThis.__PB_PILOT?.clearVisibleBuildImport(" + literal + ")";
					TimeSpan? timeout = TimeSpan.FromSeconds(2.0);
					await mainWindow.GameScriptAsync(script, default(CancellationToken), timeout);
				}
				catch
				{
				}
			}
		}
		return result;
		async Task RequireCurrent()
		{
			bool flag = closing || view != GameView || generation != pageGeneration || gameProcessFailed;
			if (!flag)
			{
				flag = await GameScriptAsync("globalThis.__PB_PILOT?.visibleBuildImportCurrent(" + literal + ")===true") != "true";
			}
			if (flag)
			{
				throw new OperationCanceledException("配置窗口、页面或账号已变化，未保存过期内容；请重新打开目标配置后再导入。");
			}
		}
	}

	private static string ImportedBuildFingerprint(JsonObject plan)
	{
		return plan["capturedBuild"]?.ToJsonString() ?? new JsonObject
		{
			["moves"] = plan["moveRules"]?.DeepClone(),
			["items"] = plan["itemRules"]?.DeepClone(),
			["vitamins"] = plan["vitaminRules"]?.DeepClone()
		}.ToJsonString();
	}

	private static bool CompatibilityMayOperate(JsonNode? report)
	{
		switch (Str(report?["state"]))
		{
		case "ready":
		case "partial":
		case "degraded":
			return true;
		default:
			return false;
		}
	}

	private JsonObject CompatibilityConfiguration()
	{
		return CompatibilityOverrides.Read();
	}

	private static Uri CompatibilityGamePageFor(JsonObject configuration)
	{
		string text = Str(configuration["interfaces"]?["resources.gamePage"]);
		if (text == null || !Uri.TryCreate(new Uri("https://pokebonk.com/"), text, out Uri result) || !ValidCompatibilityGamePage(result))
		{
			return new Uri("https://pokebonk.com/?lang=zh");
		}
		return result;
	}

	private static bool ValidCompatibilityGamePage(Uri uri)
	{
		if (uri.Scheme == "https" && uri.IdnHost == "pokebonk.com" && uri.IsDefaultPort && uri.UserInfo.Length == 0 && uri.AbsolutePath == "/" && uri.Fragment.Length == 0)
		{
			if (uri.Query.Length != 0)
			{
				return Regex.IsMatch(uri.Query, "^\\?lang=[a-z]{2,4}$", RegexOptions.CultureInvariant);
			}
			return true;
		}
		return false;
	}

	private static bool IsCompatibilityEditorAction(string action)
	{
		switch (action)
		{
		case "applyCompatibility":
		case "probeCompatibility":
		case "resetCompatibility":
		case "exportCompatibility":
		case "importCompatibility":
		case "readCompatibility":
		case "getCompatibilityPrompt":
			return true;
		default:
			return false;
		}
	}

	private string CompatibilityAdapterExpression(string expression, bool includeParser = false)
	{
		return "(()=>{\n" + ControllerSources.ServiceSource(Resource, BrowserSource, "payload.compatibility.mjs") + "\nreturn " + expression + ";})()";
	}

	private async Task<JsonObject> CompatibilityDescriptionAsync(string kind, JsonObject? configuration = null, bool includeRuntime = true, CancellationToken token = default(CancellationToken))
	{
		JsonObject saved = configuration ?? CompatibilityConfiguration();
		JsonObject jsonObject = latestPreparedCompatibility ?? compatibilityReport;
		JsonObject pure = JsonNode.Parse(await PanelScriptAsync(CompatibilityAdapterExpression("describeCompatibilityEditor(" + saved.ToJsonString() + "," + (jsonObject?.ToJsonString() ?? "null") + "," + JsonSerializer.Serialize(kind) + ")"), token))?.AsObject() ?? throw new InvalidOperationException("兼容配置目录正在加载，请稍后重试。");
		pure["schemaVersion"] = 1;
		pure["revision"] = CompatibilityOverridesStore.Revision(saved);
		pure["kind"] = kind;
		pure["config"] = saved.DeepClone();
		if (CompatibilityOverrides.ReadWarning != null)
		{
			pure["storageWarning"] = CompatibilityOverrides.ReadWarning;
		}
		if (pure["entries"] is JsonArray source)
		{
			foreach (JsonObject item in source.OfType<JsonObject>())
			{
				if (!(Str(item["kind"]) != "interfaces"))
				{
					item["effectiveValue"] = "";
					bool flag;
					switch (Str(item["status"]))
					{
					case "valid":
					case "verified":
					case "applied":
						flag = true;
						break;
					default:
						flag = false;
						break;
					}
					if (flag)
					{
						item["status"] = ((item["candidate"] != null) ? "discovered" : "unknown");
						item["reason"] = "公开源码已定位；尚未证明当前游戏页面已经采用。";
						item["applyState"] = "pending-current-document";
					}
				}
			}
		}
		pure["officialUrl"] = "https://pokebonk.com/";
		pure["tutorial"] = CompatibilityTutorial(kind);
		pure["prompt"] = CompatibilityPrompt(pure, kind);
		if (includeRuntime && ready && !gameProcessFailed && GameView.CoreWebView2 != null)
		{
			try
			{
				JsonObject jsonObject2 = JsonNode.Parse(await GameScriptAsync("globalThis.__PB_RUNTIME_COMPAT?.describe(" + JsonSerializer.Serialize(kind) + ")??null", token, TimeSpan.FromSeconds(3.0)))?.AsObject();
				if (jsonObject2?["entries"] is JsonArray source2 && pure["entries"] is JsonArray source3)
				{
					Dictionary<string, JsonObject> dictionary = (from row in source2.OfType<JsonObject>()
						where Str(row["id"]) != null
						select row).ToDictionary<JsonObject, string>((JsonObject row) => Str(row["id"]), StringComparer.Ordinal);
					foreach (JsonObject item2 in source3.OfType<JsonObject>())
					{
						if (!dictionary.TryGetValue(Str(item2["id"]) ?? "", out var value))
						{
							continue;
						}
						string[] array = new string[6] { "effectiveValue", "status", "reason", "source", "applyState", "restartRequired" };
						foreach (string propertyName in array)
						{
							if (value.ContainsKey(propertyName))
							{
								item2[propertyName] = value[propertyName]?.DeepClone();
							}
						}
						if (item2["candidate"] != null && Flag(item2["candidateVerified"]))
						{
							continue;
						}
						array = new string[4] { "candidate", "candidateSource", "candidateVerified", "proposedValue" };
						foreach (string propertyName2 in array)
						{
							if (value.ContainsKey(propertyName2))
							{
								item2[propertyName2] = value[propertyName2]?.DeepClone();
							}
						}
					}
					if (jsonObject2["applyStatus"] != null)
					{
						pure["applyStatus"] = jsonObject2["applyStatus"].DeepClone();
					}
				}
			}
			catch
			{
				pure["runtimeAvailable"] = false;
			}
		}
		OverlayCompatibilityResourceReceipts(pure, saved);
		if (pure["entries"] is JsonArray source4)
		{
			foreach (JsonObject item3 in source4.OfType<JsonObject>())
			{
				string text = Str(item3["id"]);
				item3["mode"] = ((text != null && saved[kind] is JsonObject jsonObject3 && jsonObject3.ContainsKey(text)) ? "manual" : "automatic");
			}
		}
		return pure;
	}

	private async Task<JsonObject> NormalizeCompatibilityConfigurationAsync(JsonObject candidate, CancellationToken token = default(CancellationToken))
	{
		JsonObject jsonObject = CompatibilityOverridesStore.Normalize(candidate);
		JsonNode jsonNode = JsonNode.Parse(await PanelScriptAsync(CompatibilityAdapterExpression("normalizeCompatibilityOverrides(" + jsonObject.ToJsonString() + ")"), token)) ?? throw new InvalidOperationException("兼容配置校验器尚未就绪，本次未保存。");
		if (jsonNode["errors"] is JsonArray { Count: >0 } jsonArray)
		{
			throw new InvalidOperationException("兼容配置未保存：" + string.Join("；", from error in jsonArray.Take(5)
				select Str(error?["id"]) + " · " + Str(error?["reason"])));
		}
		JsonObject jsonObject2 = CompatibilityOverridesStore.Normalize(jsonNode["config"] ?? jsonNode);
		KeyValuePair<string, JsonNode>[] array = (from entry in jsonObject2["interfaces"].AsObject()
			where entry.Key.StartsWith("resources.", StringComparison.Ordinal)
			select entry).ToArray();
		for (int num = 0; num < array.Length; num++)
		{
			KeyValuePair<string, JsonNode> keyValuePair = array[num];
			if (!Uri.TryCreate(new Uri("https://pokebonk.com/"), Str(keyValuePair.Value), out Uri result))
			{
				throw new InvalidOperationException("公开资源地址无法识别：" + keyValuePair.Key);
			}
			bool flag = keyValuePair.Key.StartsWith("resources.data.", StringComparison.Ordinal) || keyValuePair.Key.StartsWith("resources.assets.", StringComparison.Ordinal) || keyValuePair.Key == "resources.versionManifest";
			if (!((keyValuePair.Key == "resources.gamePage") ? ValidCompatibilityGamePage(result) : (PublicCompatibilityResourceUri(result) && (flag ? result.AbsolutePath.EndsWith(".json", StringComparison.OrdinalIgnoreCase) : PublicCompatibilityResourceUri(result, scriptOnly: true)))))
			{
				throw new InvalidOperationException("公开资源地址不在该项目支持的范围：" + keyValuePair.Key + "。请使用游戏官网同域公开页面、对应JS或JSON静态文件；不要填写登录接口或含凭据的网址。");
			}
			jsonObject2["interfaces"][keyValuePair.Key] = result.AbsoluteUri;
		}
		return jsonObject2;
	}

	private async Task<JsonObject> ApplyCompatibilityRuntimeAsync(JsonObject saved, long expectedPage)
	{
		try
		{
			await RefreshInitializationScriptAsync();
		}
		catch
		{
		}
		try
		{
			await RefreshCompatibilityInterceptionAsync();
		}
		catch
		{
		}
		if (!ready || gameProcessFailed || expectedPage != pageGeneration || GameView.CoreWebView2 == null)
		{
			return new JsonObject
			{
				["applyStatus"] = "pending-current-document",
				["message"] = "配置已保存；当前游戏尚未连接，将在下一次正常加载时使用。"
			};
		}
		try
		{
			MainWindow mainWindow = this;
			string script = "globalThis.__PB_RUNTIME_COMPAT?.apply(" + saved.ToJsonString() + ")??null";
			TimeSpan? timeout = TimeSpan.FromSeconds(8.0);
			JsonObject jsonObject = JsonNode.Parse(await mainWindow.GameScriptAsync(script, default(CancellationToken), timeout))?.AsObject();
			if (expectedPage != pageGeneration || jsonObject == null)
			{
				return new JsonObject
				{
					["applyStatus"] = "pending-current-document",
					["message"] = "配置已保存，将在当前页面可验证或下次正常加载时使用。"
				};
			}
			bool flag;
			switch (Str(jsonObject["applyStatus"]))
			{
			case "applied":
			case "verified":
			case "pending-current-document":
			case "invalid":
				flag = true;
				break;
			default:
				flag = false;
				break;
			}
			if (!flag)
			{
				jsonObject["applyStatus"] = "pending-current-document";
			}
			return jsonObject;
		}
		catch
		{
			return new JsonObject
			{
				["applyStatus"] = "pending-current-document",
				["message"] = "配置已保存，当前页面暂不能确认生效；请先结束或保存本局，再正常刷新游戏，勿关闭健康对局。"
			};
		}
	}

	private async Task<JsonObject> CompatibilityEditorActionAsync(string action, JsonObject payload)
	{
		await compatibilityEditorLock.WaitAsync();
		long expectedRevision;
		CancellationTokenSource probeDeadline;
		WebView2 probeView;
		long probePage;
		long probeIntent;
		long probePanel;
		try
		{
			string kind = Str(payload["kind"]) ?? "interfaces";
			string text = kind;
			if ((!(text == "interfaces") && !(text == "other")) || 1 == 0)
			{
				throw new InvalidOperationException("请选择接口配置或其他兼容配置。");
			}
			switch (action)
			{
			case "readCompatibility":
			case "getCompatibilityPrompt":
			case "exportCompatibility":
			{
				CompatibilityOverrides.Reload();
				JsonObject jsonObject6 = await CompatibilityDescriptionAsync(kind);
				if (action == "exportCompatibility")
				{
					jsonObject6["text"] = CompatibilityConfiguration().ToJsonString(JsonOptions);
				}
				if (action == "getCompatibilityPrompt")
				{
					jsonObject6["text"] = jsonObject6["prompt"]?.DeepClone();
				}
				return jsonObject6;
			}
			default:
			{
				JsonObject jsonObject = CompatibilityConfiguration();
				if (!CompatibilityOverridesStore.TryRevision(payload["expectedRevision"], out expectedRevision) || expectedRevision != CompatibilityOverridesStore.Revision(jsonObject))
				{
					throw new InvalidOperationException("兼容配置版本已变化，请重新打开窗口再修改；本次没有覆盖新配置。");
				}
				JsonObject candidate = jsonObject.DeepClone().AsObject();
				JsonArray acquiredIds = new JsonArray();
				JsonObject automaticCandidates = new JsonObject();
				probeDeadline = new CancellationTokenSource(TimeSpan.FromSeconds(24.0));
				try
				{
					probeView = GameView;
					probePage = pageGeneration;
					probeIntent = intentGeneration;
					probePanel = panelGeneration;
					switch (action)
					{
					case "probeCompatibility":
					{
						string id = Str(payload["id"]);
						RequireProbeCurrent();
						JsonObject acquired = new JsonObject();
						JsonObject runtime = null;
						if (ready && !gameProcessFailed && GameView.CoreWebView2 != null)
						{
							try
							{
								runtime = JsonNode.Parse(await GameScriptAsync("globalThis.__PB_RUNTIME_COMPAT?.probe(" + JsonSerializer.Serialize(kind) + "," + JsonSerializer.Serialize(id) + ")??null", probeDeadline.Token, TimeSpan.FromSeconds(4.0)))?.AsObject();
							}
							catch (OperationCanceledException)
							{
								throw;
							}
							catch
							{
							}
							RequireProbeCurrent();
						}
						JsonObject obj2 = await CompatibilityDescriptionAsync(kind, CompatibilityOverridesStore.Empty(), includeRuntime: false, probeDeadline.Token);
						RequireProbeCurrent();
						if (!(obj2["entries"] is JsonArray source))
						{
							throw new InvalidOperationException("暂时不能取得公开配置目录；已有配置保持不变。");
						}
						JsonObject[] selected = (from row in source.OfType<JsonObject>()
							where id == null || Str(row["id"]) == id
							select row).ToArray();
						if (id != null && selected.Length != 1)
						{
							throw new InvalidOperationException("该配置项目不在当前兼容目录中。");
						}
						if (runtime?["entries"] is JsonArray source2 && runtime["patch"] is JsonObject jsonObject2)
						{
							foreach (JsonObject item in selected.Where((JsonObject entry) => !Flag(entry["readOnly"])))
							{
								string key = Str(item["id"]);
								JsonObject jsonObject3 = source2.OfType<JsonObject>().FirstOrDefault((JsonObject row) => Str(row["id"]) == key);
								JsonNode jsonNode = jsonObject3?["candidate"] ?? jsonObject3?["proposedValue"];
								bool flag = jsonNode == null || !Flag(jsonObject3?["candidateVerified"]) || jsonObject2[key] == null || !JsonNode.DeepEquals(jsonNode, jsonObject2[key]);
								if (!flag)
								{
									bool flag2;
									switch (Str(jsonObject3?["candidateSource"]))
									{
									case "current-public-source":
									case "native-runtime":
									case "native-visible-dom":
									case "native-public-resource":
									case "client-supported-default":
										flag2 = true;
										break;
									default:
										flag2 = false;
										break;
									}
									flag = !flag2;
								}
								if (!flag)
								{
									acquired[key] = jsonNode.DeepClone();
								}
							}
						}
						JsonObject freshReport;
						if (kind == "other" && id != null && acquired.ContainsKey(id))
						{
							freshReport = new JsonObject
							{
								["source"] = "current-document-probe",
								["gameExecuted"] = false,
								["accountRead"] = false
							};
						}
						else
						{
							freshReport = await ProbePublicCompatibilityAsync(probeDeadline.Token, RequireProbeCurrent);
							RequireProbeCurrent();
							if (kind == "interfaces")
							{
								string text2 = Str(runtime?["report"]?["sourceHash"]);
								if (text2 == null || text2.Length == 0 || text2 != Str(freshReport["sourceHash"]))
								{
									acquired.Clear();
								}
							}
							JsonObject obj3 = await CompatibilityDescriptionAsync(kind, CompatibilityOverridesStore.Empty(), includeRuntime: false, probeDeadline.Token);
							RequireProbeCurrent();
							foreach (JsonObject item2 in ((obj3["entries"] as JsonArray) ?? new JsonArray()).OfType<JsonObject>())
							{
								string key2 = Str(item2["id"]);
								if (key2 == null || !selected.Any((JsonObject row) => Str(row["id"]) == key2) || Flag(item2["readOnly"]))
								{
									continue;
								}
								JsonNode jsonNode2 = item2["candidate"] ?? item2["proposedValue"];
								if (jsonNode2 != null && (!(jsonNode2 is JsonValue jsonValue2) || !jsonValue2.TryGetValue<string>(out string value2) || !string.IsNullOrWhiteSpace(value2)))
								{
									bool flag = !Flag(item2["candidateVerified"]) || Str(item2["source"]) != "current-public-source";
									if (!flag)
									{
										text = Str(item2["status"]);
										bool flag2 = ((text == "invalid" || text == "unsupported") ? true : false);
										flag = flag2;
									}
									if (!flag)
									{
										acquired[key2] = jsonNode2.DeepClone();
									}
								}
							}
						}
						if (acquired.Count == 0)
						{
							JsonObject obj4 = await CompatibilityDescriptionAsync(kind, null, includeRuntime: true, probeDeadline.Token);
							RequireProbeCurrent();
							obj4["applyStatus"] = "unresolved";
							obj4["message"] = "自动获取未能证明该配置的新位置，未改动已保存值。请使用上方提示词，取得有来源依据的新值后再粘贴。";
							obj4["discovery"] = freshReport;
							return obj4;
						}
						JsonObject jsonObject4 = candidate.DeepClone().AsObject();
						foreach (KeyValuePair<string, JsonNode> item3 in acquired)
						{
							jsonObject4[kind][item3.Key] = item3.Value?.DeepClone();
						}
						await NormalizeCompatibilityConfigurationAsync(jsonObject4, probeDeadline.Token);
						RequireProbeCurrent();
						foreach (KeyValuePair<string, JsonNode> item4 in acquired)
						{
							candidate[kind].AsObject().Remove(item4.Key);
							automaticCandidates[item4.Key] = item4.Value?.DeepClone();
							acquiredIds.Add(item4.Key);
						}
						break;
					}
					case "resetCompatibility":
						if (payload["id"] is JsonValue)
						{
							string text3 = Str(payload["id"]) ?? "";
							if (!CompatibilityOverridesStore.ValidId(text3))
							{
								throw new InvalidOperationException("配置项目名称无效。");
							}
							candidate[kind].AsObject().Remove(text3);
						}
						else
						{
							candidate[kind] = new JsonObject();
						}
						break;
					case "importCompatibility":
					{
						JsonNode jsonNode3 = payload["config"];
						if (jsonNode3 == null)
						{
							string text4 = Str(payload["text"]);
							if (text4 != null)
							{
								if (Encoding.UTF8.GetByteCount(text4) > 262144)
								{
									throw new InvalidOperationException("导入内容过大。");
								}
								JsonDocumentOptions documentOptions = new JsonDocumentOptions
								{
									MaxDepth = 16
								};
								jsonNode3 = JsonNode.Parse(text4, null, documentOptions);
							}
						}
						candidate = CompatibilityOverridesStore.Normalize(jsonNode3);
						break;
					}
					case "applyCompatibility":
						foreach (KeyValuePair<string, JsonNode> item5 in (payload["patch"] as JsonObject) ?? throw new InvalidOperationException("没有需要保存的配置项目。"))
						{
							if (!CompatibilityOverridesStore.ValidId(item5.Key))
							{
								throw new InvalidOperationException("兼容配置项目名称无效。");
							}
							if (item5.Value == null || (item5.Value is JsonValue jsonValue && jsonValue.TryGetValue<string>(out string value) && string.IsNullOrWhiteSpace(value)))
							{
								candidate[kind].AsObject().Remove(item5.Key);
							}
							else
							{
								candidate[kind][item5.Key] = item5.Value.DeepClone();
							}
						}
						break;
					default:
						throw new InvalidOperationException("兼容配置操作不受支持。");
					}
					JsonObject value3 = await NormalizeCompatibilityConfigurationAsync(candidate, (action == "probeCompatibility") ? probeDeadline.Token : default(CancellationToken));
					if (action == "probeCompatibility")
					{
						RequireProbeCurrent();
					}
					JsonObject committed = CompatibilityOverrides.Save(value3, expectedRevision, action == "resetCompatibility" && payload["id"] == null);
					JsonObject applied = await ApplyCompatibilityRuntimeAsync(committed, pageGeneration);
					JsonObject jsonObject5 = await CompatibilityDescriptionAsync(kind, committed);
					jsonObject5["applyStatus"] = applied["applyStatus"]?.DeepClone() ?? JsonValue.Create("pending-current-document");
					jsonObject5["applyState"] = jsonObject5["applyStatus"]?.DeepClone();
					if (applied["message"] != null)
					{
						jsonObject5["message"] = applied["message"].DeepClone();
					}
					if (acquiredIds.Count > 0)
					{
						jsonObject5["acquiredIds"] = acquiredIds;
						bool flag3 = false;
						bool flag;
						if (jsonObject5["entries"] is JsonArray source3)
						{
							foreach (JsonObject item6 in source3.OfType<JsonObject>())
							{
								string text5 = Str(item6["id"]);
								if (text5 != null && automaticCandidates[text5] != null)
								{
									item6["candidate"] = automaticCandidates[text5].DeepClone();
									item6["candidateVerified"] = true;
									item6["value"] = automaticCandidates[text5].DeepClone();
									item6["mode"] = "automatic";
									flag = !JsonNode.DeepEquals(item6["effectiveValue"], automaticCandidates[text5]);
									if (!flag)
									{
										text = Str(item6["status"]);
										bool flag2 = ((text == "valid" || text == "verified") ? true : false);
										flag = !flag2;
									}
									if (flag)
									{
										flag3 = true;
										item6["applyState"] = "pending-current-document";
									}
								}
							}
						}
						flag = flag3;
						if (flag)
						{
							text = Str(jsonObject5["applyStatus"]);
							bool flag2 = ((text == "applied" || text == "verified") ? true : false);
							flag = flag2;
						}
						if (flag)
						{
							jsonObject5["applyStatus"] = "pending-current-document";
						}
						jsonObject5["applyState"] = jsonObject5["applyStatus"]?.DeepClone();
						jsonObject5["message"] = "已将成功获取的项目切换为自动跟随，并应用正常自动解析；不会把这次发现的地址或名称固定保存。" + ((Str(jsonObject5["applyStatus"]) == "pending-current-document") ? "当前页面尚不能确认的新位置会在下次正常加载时重新发现；请先结束或保存本局，不会强制刷新健康对局。" : "请查看每行当前实际采用值。") + "未能获取的项目及其他手填配置保持不变。需要固定某个值时，请编辑后点保存并应用。";
					}
					return jsonObject5;
				}
				finally
				{
					if (probeDeadline != null)
					{
						((IDisposable)probeDeadline).Dispose();
					}
				}
			}
			}
		}
		finally
		{
			compatibilityEditorLock.Release();
		}
		void RequireProbeCurrent()
		{
			probeDeadline.Token.ThrowIfCancellationRequested();
			if (closing || probeView != GameView || probePage != pageGeneration || probeIntent != intentGeneration || probePanel != panelGeneration || expectedRevision != CompatibilityOverridesStore.Revision(CompatibilityConfiguration()))
			{
				throw new OperationCanceledException("自动获取期间页面、控制意图或配置已变化，未保存过期结果，请重试。");
			}
		}
	}

	private readonly Dictionary<string, (string Hash, string Code, long Page, long Revision)> nativeModulePatches = new(StringComparer.Ordinal);
	private async Task<JsonArray> PublicModuleSourcesAsync(string source, Uri uri, CancellationToken token)
	{
		var result = new JsonArray();
		// Only App preparation needs its dependency definitions. Non-App requests
		// retain their native text, except explicit patches produced for this page.
		if (!Regex.IsMatch(source, @"\bas\s+App\b|export\s+class\s+App\b") && !source.Contains("__vite__mapDeps", StringComparison.Ordinal)) return result;
		var pending = new Queue<(Uri Url, string Source)>(); pending.Enqueue((uri, source));
		var seen = new HashSet<string>(StringComparer.Ordinal) { uri.AbsoluteUri };
		long bytes = Encoding.UTF8.GetByteCount(source);
		while (pending.Count > 0)
		{
			var item = pending.Dequeue();
			foreach (var reference in await PublicCompatibilityModuleReferencesAsync(item.Source, item.Url, token))
			{
				if (!Uri.TryCreate(item.Url, Str(reference), out var dependency) || !PublicCompatibilityResourceUri(dependency, scriptOnly: true) || !seen.Add(dependency.AbsoluteUri)) continue;
				if (seen.Count > 32) throw new InvalidDataException("原生模块图超过现有32模块范围");
				string body = await ReadPublicCompatibilityResourceAsync(dependency, CompatibilitySourceLimit, token);
				bytes += Encoding.UTF8.GetByteCount(body);
				if (bytes > 25165824) throw new InvalidDataException("原生模块图超过现有24MiB范围");
				result.Add(new JsonObject { ["url"] = dependency.AbsoluteUri, ["source"] = body, ["sha256"] = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(body))).ToLowerInvariant() });
				pending.Enqueue((dependency, body));
			}
		}
		return result;
	}

	private void RegisterNativeModulePatches(JsonObject prepared)
	{
		nativeModulePatches.Clear();
		if (prepared["modulePatches"] is not JsonArray patches) return;
		long revision = CompatibilityOverridesStore.Revision(CompatibilityConfiguration());
		foreach (var patch in patches.OfType<JsonObject>())
		{
			string? url = Str(patch["url"]), hash = Str(patch["sourceHash"]), code = Str(patch["code"]);
			if (Uri.TryCreate(url, UriKind.Absolute, out var uri) && PublicCompatibilityResourceUri(uri, scriptOnly: true) && hash?.Length == 64 && code != null)
				nativeModulePatches[url] = (hash, code, pageGeneration, revision);
		}
	}

	private async Task<bool> TryFulfillNativeModulePatchAsync(CoreWebView2 core, string requestId, Uri uri, string source, CancellationToken token)
	{
		if (!nativeModulePatches.TryGetValue(uri.AbsoluteUri, out var patch) || patch.Page != pageGeneration || patch.Revision != CompatibilityOverridesStore.Revision(CompatibilityConfiguration())) return false;
		string hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(source))).ToLowerInvariant();
		if (hash != patch.Hash) throw new InvalidDataException("模块依赖在准备后变化，未应用旧导出绑定");
		await core.CallDevToolsProtocolMethodAsync("Fetch.fulfillRequest", new JsonObject {
			["requestId"] = requestId, ["responseCode"] = 200,
			["responseHeaders"] = new JsonArray(new JsonObject { ["name"] = "Content-Type", ["value"] = "application/javascript; charset=utf-8" }, new JsonObject { ["name"] = "Cache-Control", ["value"] = "no-store" }),
			["body"] = Convert.ToBase64String(Encoding.UTF8.GetBytes(patch.Code))
		}.ToJsonString()).WaitAsync(TimeSpan.FromSeconds(8), token);
		return true;
	}

	private async Task<JsonArray> PublicCompatibilityModuleReferencesAsync(string source, Uri baseUri, CancellationToken token)
	{
		return (JsonNode.Parse(await PanelScriptAsync(CompatibilityAdapterExpression("discoverPublicModuleReferences(" + JsonSerializer.Serialize(source) + "," + JsonSerializer.Serialize(baseUri.AbsoluteUri) + ")", includeParser: true), token, TimeSpan.FromSeconds(10.0))) as JsonArray) ?? new JsonArray();
	}

	private async Task<JsonObject> ProbePublicCompatibilityAsync(CancellationToken token = default(CancellationToken), Action? requireCurrent = null)
	{
		Uri origin = CompatibilityGamePageFor(CompatibilityOverridesStore.Empty());
		string text = await ReadPublicCompatibilityResourceAsync(origin, 524288, token);
		requireCurrent?.Invoke();
		Queue<Uri> queue = CompatibilityModuleQueue(text, origin, CompatibilityOverridesStore.Empty());
		HashSet<string> seen = new HashSet<string>(StringComparer.Ordinal);
		long bytes = Encoding.UTF8.GetByteCount(text);
		while (queue.Count > 0 && seen.Count < 32)
		{
			token.ThrowIfCancellationRequested();
			requireCurrent?.Invoke();
			Uri uri = queue.Dequeue();
			if (!seen.Add(uri.AbsoluteUri) || !PublicCompatibilityResourceUri(uri, scriptOnly: true))
			{
				continue;
			}
			string source;
			try
			{
				source = await ReadPublicCompatibilityResourceAsync(uri, Math.Min(CompatibilitySourceLimit, (int)Math.Max(0L, 25165824 - bytes)), token);
			}
			catch (Exception ex) when (((ex is HttpRequestException || ex is InvalidOperationException) ? 1 : 0) != 0)
			{
				requireCurrent?.Invoke();
				continue;
			}
			requireCurrent?.Invoke();
			bytes += Encoding.UTF8.GetByteCount(source);
			if (bytes > 25165824)
			{
				throw new InvalidOperationException("本次官网依赖检查已达24MiB安全范围，现有配置未改变。");
			}
			string hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(source))).ToLowerInvariant();
			JsonObject jsonObject = JsonNode.Parse(await PanelScriptAsync(CompatibilityAdapterExpression("prepareGameSource(" + JsonSerializer.Serialize(source) + "," + new JsonObject
			{
				["sourceHash"] = hash,
				["compatibilityOverrides"] = CompatibilityOverridesStore.Empty(),
				["moduleURL"] = uri.AbsoluteUri,
				["moduleSources"] = await PublicModuleSourcesAsync(source, uri, token),
						["originalModuleURL"] = uri.AbsoluteUri
			}.ToJsonString() + ")", includeParser: true), token, TimeSpan.FromSeconds(10.0)))?.AsObject();
			requireCurrent?.Invoke();
			if (Flag(jsonObject?["isGame"]) && jsonObject?["report"] is JsonObject jsonObject2)
			{
				JsonObject jsonObject3 = jsonObject2.DeepClone().AsObject();
				JsonObject jsonObject4 = (jsonObject3["discoveredConfig"] as JsonObject) ?? new JsonObject();
				if (jsonObject3["discoveredConfig"] == null)
				{
					jsonObject3["discoveredConfig"] = jsonObject4;
				}
				jsonObject4["resources.gamePage"] = origin.AbsoluteUri;
				jsonObject4["resources.mainModule"] = uri.AbsoluteUri;
				cachedCompatibilitySource = source;
				cachedCompatibilitySourceHash = hash;
				cachedCompatibilitySourceUrl = uri.AbsoluteUri;
				latestPreparedCompatibility = jsonObject3;
				return new JsonObject
				{
					["source"] = "official-public-source",
					["url"] = uri.AbsoluteUri,
					["sourceHash"] = hash,
					["modulesRead"] = seen.Count,
					["bytesRead"] = bytes,
					["ok"] = Flag(jsonObject["ok"]),
					["gameExecuted"] = false,
					["accountRead"] = false,
					["credentialsSent"] = false
				};
			}
			JsonArray obj = await PublicCompatibilityModuleReferencesAsync(source, uri, token);
			requireCurrent?.Invoke();
			foreach (JsonNode item in obj)
			{
				string text2 = Str(item);
				if (text2 != null && Uri.TryCreate(uri, text2, out Uri result) && PublicCompatibilityResourceUri(result, scriptOnly: true) && !seen.Contains(result.AbsoluteUri) && queue.Count < 128)
				{
					queue.Enqueue(result);
				}
			}
		}
		throw new InvalidOperationException("官网公开依赖图暂未提供可识别的游戏入口（单次最多32模块、24MiB），已保留原配置；可稍后重试或复制提示词求助。");
	}

	private static bool PublicCompatibilityResourceUri(Uri uri, bool scriptOnly = false)
	{
		if (uri.Scheme != "https" || uri.IdnHost != "pokebonk.com" || !uri.IsDefaultPort || uri.UserInfo.Length != 0 || uri.Fragment.Length != 0)
		{
			return false;
		}
		if (uri.Query.Length > 0 && !Regex.IsMatch(uri.Query, "^\\?v=[A-Za-z0-9._-]{1,80}$", RegexOptions.CultureInvariant) && !ValidCompatibilityGamePage(uri))
		{
			return false;
		}
		if (uri.AbsolutePath.Contains("%", StringComparison.Ordinal) || uri.AbsolutePath.Contains("..", StringComparison.Ordinal) || uri.AbsolutePath.Contains('\\'))
		{
			return false;
		}
		if (new string[3] { "/api/", "/auth/", "/account/" }.Any((string prefix) => uri.AbsolutePath.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)))
		{
			return false;
		}
		if (!scriptOnly)
		{
			if (!(uri.AbsolutePath == "/") && !(uri.AbsolutePath == "/version.json"))
			{
				return Regex.IsMatch(uri.AbsolutePath, "^/[A-Za-z0-9_./-]+\\.(?:m?js|json)$", RegexOptions.CultureInvariant);
			}
			return true;
		}
		return Regex.IsMatch(uri.AbsolutePath, "^/[A-Za-z0-9_./-]+\\.m?js$", RegexOptions.CultureInvariant);
	}

	private static async Task<string> ReadPublicCompatibilityResourceAsync(Uri uri, int limit, CancellationToken token = default(CancellationToken))
	{
		if (!PublicCompatibilityResourceUri(uri))
		{
			throw new InvalidOperationException("只允许读取游戏官网的公开页面和静态脚本。");
		}
		using CancellationTokenSource deadline = CancellationTokenSource.CreateLinkedTokenSource(token);
		deadline.CancelAfter(TimeSpan.FromSeconds(10.0));
		token = deadline.Token;
		using HttpRequestMessage request = new HttpRequestMessage(HttpMethod.Get, uri);
		request.Headers.CacheControl = new CacheControlHeaderValue
		{
			NoCache = true
		};
		using HttpResponseMessage response = await compatibilityPublicHttp.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token);
		if (response.StatusCode != HttpStatusCode.OK)
		{
			throw new InvalidOperationException("游戏官网公开资源暂时无法读取，未改动现有配置；请稍后重试。");
		}
		if (response.Content.Headers.ContentLength > limit)
		{
			throw new InvalidOperationException("游戏官网资源超过本次安全读取范围，未修改现有配置。");
		}
		string result;
		await using (Stream input = await response.Content.ReadAsStreamAsync(token))
		{
			using MemoryStream output = new MemoryStream();
			byte[] buffer = new byte[32768];
			int num;
			while ((num = await input.ReadAsync(buffer, token)) > 0)
			{
				if (output.Length + num > limit)
				{
					throw new InvalidOperationException("游戏官网资源超过本次安全读取范围。");
				}
				output.Write(buffer, 0, num);
			}
			result = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true).GetString(output.ToArray());
		}
		return result;
	}

	private static JsonArray CompatibilityTutorial(string kind)
	{
		return new JsonArray(JsonValue.Create("1. 先点“自动获取”。成功项目会切回自动跟随，清除该项原来的固定覆盖；脚本实际使用当前原生自动发现路径，后续游戏改名或换地址不会被这次获取值钉住。不登录账号、不上传脚本、不修改游戏数值。"), JsonValue.Create("2. 每一行左侧显示名字、作用和状态。接口不一定是网址：游戏内部接口常是类名、函数名或属性名，应按该行的格式填写。"), JsonValue.Create("3. 自动获取失败时，点“一键获取提示词”并复制给支持联网或读取网页代码的AI；不需要发送本客户端，更不要发送账号密码、Cookie或存档。"), JsonValue.Create("4. 让AI按项目ID返回有当前官网来源依据的值。只知道游戏网址时，AI不一定能读取浏览器内部接口；没有证据就应写“无法确认”，不要猜地址。"), JsonValue.Create("5. 编辑输入框后点保存并应用，或导入配置，表示明确手填固定；后续会按该值校验使用。自动获取表示自动跟随，两者不同。只有当前已验证/实际采用值才表示本页已使用；候选或等待下次正常加载不能当成已生效。"), JsonValue.Create("6. 需要重新加载时，先正常结束或保存本局再刷新；此窗口不会为了修改配置强行退出健康游戏。填错可单项恢复自动识别，或重置本类配置。"), JsonValue.Create((kind == "interfaces") ? "7. 接口配置正确仍无法使用时，关闭此窗口并点旁边“手动修改其他配置”，核对选择器、字段、ID及能力参数。" : "7. 这里只修改游戏更新引起的兼容参数，不修改伤害、生命、冷却、掉落、奖励或账号数据；找不到的能力会单独提示。"));
	}

	private static string CompatibilityPrompt(JsonObject view, string kind)
	{
		IEnumerable<JsonObject> source = from row in ((view["entries"] as JsonArray) ?? new JsonArray()).OfType<JsonObject>()
			select new JsonObject
			{
				["id"] = row["id"]?.DeepClone(),
				["name"] = row["name"]?.DeepClone(),
				["purpose"] = row["purpose"]?.DeepClone(),
				["type"] = row["type"]?.DeepClone(),
				["help"] = row["help"]?.DeepClone(),
				["choices"] = row["choices"]?.DeepClone()
			};
		return "请只分析当前游戏官网 https://pokebonk.com/ 的公开页面和静态JavaScript，帮助核对PokéBonk旅伴的" + ((kind == "interfaces") ? "游戏接口映射" : "其他游戏兼容参数") + "。不需要客户端源码，不登录账号、不提交游戏操作、不读取个人资料。下面是客户端支持的配置目录（ID不可更名）：\n" + new JsonArray(source.Select((Func<JsonObject, JsonNode>)((JsonObject row) => row)).ToArray()).ToJsonString() + "\n请逐项返回：id、建议值、当前公开源码URL、定位依据和是否已确认。接口可能是模块内符号/成员而不是HTTP网址；只返回真实可核实的符号/成员/公开资源位置，不编造服务器接口、访问令牌或接口签名。选择器和字段按目录类型返回纯数据，不给可执行代码。无法联网或无法证明的项目明确写无法确认。用户会将单项值复制回输入框并由本客户端校验；不要建议绕过保存、身份、付费、能力和数值规则。";
	}

	private void RecordCompatibilityResourceReceipt(string id, Uri actual, long? revision = null, long? document = null)
	{
		compatibilityResourceReceipts[id] = (document ?? pageGeneration, revision ?? CompatibilityOverridesStore.Revision(CompatibilityConfiguration()), actual.AbsoluteUri);
	}

	private void OverlayCompatibilityResourceReceipts(JsonObject view, JsonObject configuration)
	{
		if (!(view["entries"] is JsonArray source))
		{
			return;
		}
		long num = CompatibilityOverridesStore.Revision(configuration);
		foreach (JsonObject item in source.OfType<JsonObject>())
		{
			string text = Str(item["id"]) ?? "";
			if (compatibilityResourceReceipts.TryGetValue(text, out (long, long, string) value) && value.Item1 == pageGeneration && value.Item2 == num)
			{
				string text2 = Str(configuration["interfaces"]?[text]);
				Uri result;
				bool flag = string.IsNullOrWhiteSpace(text2) || (Uri.TryCreate(new Uri("https://pokebonk.com/"), text2, out result) && result.AbsoluteUri == value.Item3);
				item["effectiveValue"] = value.Item3;
				item["status"] = (flag ? "valid" : "invalid");
				item["applyState"] = (flag ? "applied" : "pending-current-document");
				item["source"] = "verified-active-public-response";
				item["reason"] = (flag ? "当前页面已实际采用该公开资源，并通过对应内容检查。" : "当前仍使用已验证的自动资源；填写的替代地址尚未被当前页面采用。");
			}
		}
	}

	private JsonObject CompatibilityFetchPatterns()
	{
		JsonArray jsonArray = new JsonArray(new JsonObject
		{
			["urlPattern"] = "https://pokebonk.com/*",
			["resourceType"] = "Script",
			["requestStage"] = "Response"
		});
		if (CompatibilityConfiguration()["interfaces"] is JsonObject jsonObject)
		{
			List<string> list = new List<string>();
			if (jsonObject.Any<KeyValuePair<string, JsonNode>>((KeyValuePair<string, JsonNode> entry) => entry.Key.StartsWith("resources.data.", StringComparison.Ordinal)))
			{
				list.Add("https://pokebonk.com/data/*.json*");
			}
			if (jsonObject.Any<KeyValuePair<string, JsonNode>>((KeyValuePair<string, JsonNode> entry) => entry.Key.StartsWith("resources.assets.env.", StringComparison.Ordinal)))
			{
				list.Add("https://pokebonk.com/assets/env/*.json*");
			}
			if (jsonObject.ContainsKey("resources.versionManifest"))
			{
				list.Add("https://pokebonk.com/version.json*");
			}
			string[] array = new string[2] { "XHR", "Fetch" };
			foreach (string text in array)
			{
				foreach (string item in list)
				{
					jsonArray.Add(new JsonObject
					{
						["urlPattern"] = item,
						["resourceType"] = text,
						["requestStage"] = "Response"
					});
				}
			}
		}
		return new JsonObject { ["patterns"] = jsonArray };
	}

	private async Task RefreshCompatibilityInterceptionAsync()
	{
		WebView2 view = GameView;
		CoreWebView2 coreWebView = view.CoreWebView2;
		long page = pageGeneration;
		if (coreWebView != null && !closing && !gameProcessFailed)
		{
			await coreWebView.CallDevToolsProtocolMethodAsync("Fetch.enable", CompatibilityFetchPatterns().ToJsonString()).WaitAsync(TimeSpan.FromSeconds(8.0));
			if (view == GameView)
			{
				_ = page;
				_ = pageGeneration;
			}
		}
	}

	private static string? PublicDataCompatibilityId(Uri uri)
	{
		if (uri.Scheme != "https" || uri.IdnHost != "pokebonk.com" || !uri.IsDefaultPort || uri.UserInfo.Length != 0 || uri.Fragment.Length != 0 || (uri.Query.Length != 0 && !Regex.IsMatch(uri.Query, "^\\?v=[A-Za-z0-9._-]{1,80}$", RegexOptions.CultureInvariant)))
		{
			return null;
		}
		if (uri.AbsolutePath == "/version.json")
		{
			return "resources.versionManifest";
		}
		Match match = Regex.Match(uri.AbsolutePath, "^/(?<id>(?:data|assets/env)/[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*)\\.json$", RegexOptions.CultureInvariant);
		if (!match.Success)
		{
			return null;
		}
		return "resources." + match.Groups["id"].Value.Replace('/', '.');
	}

	private Uri? CompatibilityResourceTarget(string id, Uri original)
	{
		return CompatibilityResourceTargetFor(CompatibilityConfiguration(), id, original);
	}

	private static Uri? CompatibilityResourceTargetFor(JsonObject configuration, string id, Uri original)
	{
		string text = Str(configuration["interfaces"]?[id]);
		if (text == null || !Uri.TryCreate(new Uri("https://pokebonk.com/"), text, out Uri result) || !PublicCompatibilityResourceUri(result) || result.AbsoluteUri == original.AbsoluteUri)
		{
			return null;
		}
		return result;
	}

	private static Queue<Uri> CompatibilityModuleQueue(string html, Uri origin, JsonObject configuration)
	{
		Uri result;
		List<Uri> list = (from uri2 in (from match in Regex.Matches(html, "(?:src|href)=[\"']([^\"']+\\.m?js(?:\\?[^\"']*)?)[\"']")
				select (!Uri.TryCreate(origin, match.Groups[1].Value, out result)) ? null : result into uri2
				where uri2 != null && PublicCompatibilityResourceUri(uri2, scriptOnly: true)
				select uri2).Cast<Uri>().Distinct()
			orderby uri2.AbsolutePath.Contains("main-", StringComparison.Ordinal) descending
			select uri2).ToList();
		Uri uri = CompatibilityResourceTargetFor(configuration, "resources.mainModule", origin);
		if (uri != null && PublicCompatibilityResourceUri(uri, scriptOnly: true))
		{
			list.Insert(0, uri);
		}
		return new Queue<Uri>(list.DistinctBy((Uri uri2) => uri2.AbsoluteUri));
	}

	private async Task<bool> TryOverrideMissingEntryResponseAsync(CoreWebView2 core, JsonNode paused, Uri original, CancellationToken token)
	{
		if (Num(paused["responseStatusCode"]) == 404 && !(Str(paused["request"]?["method"]) != "GET"))
		{
			string requestId = Str(paused["requestId"]);
			if (requestId != null && PublicScriptUri(original.AbsoluteUri, out Uri _))
			{
				JsonObject configuration = CompatibilityConfiguration();
				long revision = CompatibilityOverridesStore.Revision(configuration);
				Uri target = CompatibilityResourceTargetFor(configuration, "resources.mainModule", original);
				if (target == null || !PublicCompatibilityResourceUri(target, scriptOnly: true))
				{
					return false;
				}
				WebView2 view = GameView;
				long page = pageGeneration;
				if (!(JsonNode.Parse(await GameScriptAsync("(()=>[...document.querySelectorAll('script[type=module][src]')].map(node=>node.src))()", token, TimeSpan.FromSeconds(3.0))) is JsonArray { Count: 1 } jsonArray) || Str(jsonArray[0]) != original.AbsoluteUri)
				{
					return false;
				}
				string source = await ReadPublicCompatibilityResourceAsync(target, CompatibilitySourceLimit, token);
				if (revision != CompatibilityOverridesStore.Revision(CompatibilityConfiguration()))
				{
					return false;
				}
				string hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(source))).ToLowerInvariant();
				JsonObject prepared = JsonNode.Parse(await PanelScriptAsync(CompatibilityAdapterExpression("prepareGameSource(" + JsonSerializer.Serialize(source) + "," + new JsonObject
				{
					["sourceHash"] = hash,
					["compatibilityOverrides"] = configuration,
					["moduleURL"] = target.AbsoluteUri,
					["moduleSources"] = await PublicModuleSourcesAsync(source, target, token),
						["originalModuleURL"] = original.AbsoluteUri
				}.ToJsonString() + ")", includeParser: true), token, TimeSpan.FromSeconds(30.0)))?.AsObject();
				if (Flag(prepared?["isGame"]) && Flag(prepared?["ok"]))
				{
					RegisterNativeModulePatches(prepared!);
					string text = Str(prepared?["code"]);
					if (text != null)
					{
						token.ThrowIfCancellationRequested();
						if (view != GameView || core != GameView.CoreWebView2 || page != pageGeneration || closing || revision != CompatibilityOverridesStore.Revision(CompatibilityConfiguration()))
						{
							return false;
						}
						await core.CallDevToolsProtocolMethodAsync("Fetch.fulfillRequest", new JsonObject
						{
							["requestId"] = requestId,
							["responseCode"] = 200,
							["responseHeaders"] = new JsonArray(new JsonObject
							{
								["name"] = "Content-Type",
								["value"] = "application/javascript; charset=utf-8"
							}, new JsonObject
							{
								["name"] = "Cache-Control",
								["value"] = "no-store"
							}),
							["body"] = Convert.ToBase64String(Encoding.UTF8.GetBytes(text))
						}.ToJsonString()).WaitAsync(TimeSpan.FromSeconds(8.0), token);
						RecordCompatibilityResourceReceipt("resources.mainModule", target, revision, page);
						if (revision != CompatibilityOverridesStore.Revision(CompatibilityConfiguration()))
						{
							return true;
						}
						cachedCompatibilitySource = Str(prepared["originalGameSource"]) ?? source;
						cachedCompatibilitySourceHash = Str(prepared["report"]?["sourceHash"]) ?? hash;
						cachedCompatibilitySourceUrl = Str(prepared["originalGameModuleURL"]) ?? target.AbsoluteUri;
						latestPreparedCompatibility = prepared["report"]?.DeepClone().AsObject();
						compatibilityReport = latestPreparedCompatibility?.DeepClone().AsObject();
						observedCompatibilityMainUrl = original.AbsoluteUri;
						string text2 = Str(prepared["report"]?["discoveredConfig"]?["resources.newsModule"]);
						if (text2 != null && Uri.TryCreate(target, text2, out Uri result) && PublicCompatibilityResourceUri(result, scriptOnly: true))
						{
							observedCompatibilityNewsUrl = result.AbsoluteUri;
						}
						gameModuleObserved = true;
						compatibility = "";
						RecordConnection("manual-resource", "verified-missing-entry-replaced", target, 200);
						return true;
					}
				}
				return false;
			}
		}
		return false;
	}

	private async Task<bool> TryOverridePublicDataResponseAsync(CoreWebView2 core, JsonNode paused, Uri original, CancellationToken token)
	{
		string id = PublicDataCompatibilityId(original);
		if (id != null && !(Str(paused["request"]?["method"]) != "GET"))
		{
			string requestId = Str(paused["requestId"]);
			if (requestId != null)
			{
				int num = Num(paused["responseStatusCode"]);
				bool flag = ((num == 401 || num == 403 || num == 429) ? true : false);
				if (flag || (num >= 300 && num < 400))
				{
					return false;
				}
				JsonObject jsonObject = CompatibilityConfiguration();
				long revision = CompatibilityOverridesStore.Revision(jsonObject);
				Uri target = CompatibilityResourceTargetFor(jsonObject, id, original);
				if (target == null || !target.AbsolutePath.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
				{
					return false;
				}
				WebView2 view = GameView;
				long page = pageGeneration;
				string text = await ReadPublicCompatibilityResourceAsync(target, CompatibilitySourceLimit, token);
				if (revision != CompatibilityOverridesStore.Revision(CompatibilityConfiguration()))
				{
					return false;
				}
				using JsonDocument document = JsonDocument.Parse(text, new JsonDocumentOptions
				{
					MaxDepth = 128
				});
				JsonValueKind valueKind = document.RootElement.ValueKind;
				if (valueKind - 1 > JsonValueKind.Object)
				{
					return false;
				}
				token.ThrowIfCancellationRequested();
				if (view != GameView || core != GameView.CoreWebView2 || page != pageGeneration || closing || revision != CompatibilityOverridesStore.Revision(CompatibilityConfiguration()))
				{
					return false;
				}
				await core.CallDevToolsProtocolMethodAsync("Fetch.fulfillRequest", new JsonObject
				{
					["requestId"] = requestId,
					["responseCode"] = 200,
					["responseHeaders"] = new JsonArray(new JsonObject
					{
						["name"] = "Content-Type",
						["value"] = "application/json; charset=utf-8"
					}, new JsonObject
					{
						["name"] = "Cache-Control",
						["value"] = "no-store"
					}),
					["body"] = Convert.ToBase64String(Encoding.UTF8.GetBytes(text))
				}.ToJsonString()).WaitAsync(TimeSpan.FromSeconds(8.0), token);
				RecordConnection("manual-resource", "verified-public-json-response", target, 200);
				RecordCompatibilityResourceReceipt(id, target, revision, page);
				return true;
			}
		}
		return false;
	}

	private async Task<bool> TryOverrideNewsResponseAsync(CoreWebView2 core, JsonNode paused, Uri original, CancellationToken token)
	{
		if (observedCompatibilityNewsUrl != null && !(original.AbsoluteUri != observedCompatibilityNewsUrl) && !(Str(paused["request"]?["method"]) != "GET"))
		{
			string requestId = Str(paused["requestId"]);
			if (requestId != null)
			{
				int num = Num(paused["responseStatusCode"]);
				bool flag = ((num == 401 || num == 403 || num == 429) ? true : false);
				if (flag || (num >= 300 && num < 400))
				{
					return false;
				}
				JsonObject jsonObject = CompatibilityConfiguration();
				long revision = CompatibilityOverridesStore.Revision(jsonObject);
				Uri target = CompatibilityResourceTargetFor(jsonObject, "resources.newsModule", original);
				if (target == null || !PublicCompatibilityResourceUri(target, scriptOnly: true))
				{
					return false;
				}
				WebView2 view = GameView;
				long page = pageGeneration;
				string value = await ReadPublicCompatibilityResourceAsync(target, CompatibilitySourceLimit, token);
				if (revision != CompatibilityOverridesStore.Revision(CompatibilityConfiguration()))
				{
					return false;
				}
				string text = Str(JsonNode.Parse(await PanelScriptAsync(CompatibilityAdapterExpression("absolutizeNativeModuleImports(" + JsonSerializer.Serialize(value) + "," + JsonSerializer.Serialize(target.AbsoluteUri) + ")", includeParser: true), token, TimeSpan.FromSeconds(30.0))));
				if (text == null)
				{
					throw new InvalidOperationException("公开模块相对依赖尚不能确认，已保留原生响应。");
				}
				token.ThrowIfCancellationRequested();
				if (view != GameView || core != GameView.CoreWebView2 || page != pageGeneration || closing || revision != CompatibilityOverridesStore.Revision(CompatibilityConfiguration()))
				{
					return false;
				}
				await core.CallDevToolsProtocolMethodAsync("Fetch.fulfillRequest", new JsonObject
				{
					["requestId"] = requestId,
					["responseCode"] = 200,
					["responseHeaders"] = new JsonArray(new JsonObject
					{
						["name"] = "Content-Type",
						["value"] = "application/javascript; charset=utf-8"
					}, new JsonObject
					{
						["name"] = "Cache-Control",
						["value"] = "no-store"
					}),
					["body"] = Convert.ToBase64String(Encoding.UTF8.GetBytes(text))
				}.ToJsonString()).WaitAsync(TimeSpan.FromSeconds(8.0), token);
				RecordConnection("manual-resource", "verified-public-news-response", target, 200);
				RecordCompatibilityResourceReceipt("resources.newsModule", target, revision, page);
				return true;
			}
		}
		return false;
	}

	private void StopConvenienceSound(bool clearEvents = false)
	{
		convenienceSoundTimer?.Stop();
		convenienceSoundTimer = null;
		try
		{
			convenienceSound?.Stop();
		}
		catch
		{
		}
		convenienceSound?.Dispose();
		convenienceSound = null;
		convenienceSoundData?.Dispose();
		convenienceSoundData = null;
		if (clearEvents)
		{
			convenienceAlertIds = null;
			convenienceAlertOrder = null;
			convenienceAlertTimes = null;
		}
	}

	private void PlayConvenienceSound(string tone, int volume)
	{
		byte[] buffer = ConvenienceAudio.Wave(tone, volume);
		StopConvenienceSound();
		if (volume == 0 || closing)
		{
			return;
		}
		try
		{
			convenienceSoundData = new MemoryStream(buffer, writable: false);
			convenienceSound = new SoundPlayer(convenienceSoundData);
			convenienceSound.Load();
			convenienceSound.Play();
			DispatcherTimer soundTimer = new DispatcherTimer
			{
				Interval = TimeSpan.FromMilliseconds(600.0)
			};
			soundTimer.Tick += delegate
			{
				if (convenienceSoundTimer == soundTimer)
				{
					StopConvenienceSound();
				}
				else
				{
					soundTimer.Stop();
				}
			};
			convenienceSoundTimer = soundTimer;
			soundTimer.Start();
		}
		catch
		{
			StopConvenienceSound();
			if (!convenienceSoundUnavailable)
			{
				convenienceSoundUnavailable = true;
				Log("warning", "提醒音暂不可用", "声音设备无法播放；挂机与游戏继续运行。");
			}
		}
	}

	private void ObserveConvenienceMessage(JsonNode? message)
	{
		if (Str(message?["kind"]) == "convenienceReset")
		{
			StopConvenienceSound(clearEvents: true);
		}
		else
		{
			if (closing || !ready || gameProcessFailed || Str(message?["kind"]) != "convenienceAlert")
			{
				return;
			}
			JsonNode jsonNode = config["convenience"]?["alerts"];
			string text = Str(message?["type"]);
			string text2 = Str(message?["eventId"]);
			if (!Flag(jsonNode?["enabled"]) || text == null || !ConvenienceSettings.AlertEvents.Contains(text) || !Flag(jsonNode?["events"]?[text]) || text2 == null || text2.Length > 128 || !Regex.IsMatch(text2, "^[A-Za-z0-9_-]{1,80}:[0-9]{1,12}:[0-9]{1,12}$", RegexOptions.CultureInvariant))
			{
				return;
			}
			int valueOrDefault = (jsonNode?["volume"]?.GetValue<int>()).GetValueOrDefault();
			if (valueOrDefault <= 0)
			{
				return;
			}
			if (convenienceAlertIds == null)
			{
				convenienceAlertIds = new HashSet<string>(StringComparer.Ordinal);
			}
			if (convenienceAlertOrder == null)
			{
				convenienceAlertOrder = new Queue<string>();
			}
			if (convenienceAlertIds.Add(text2))
			{
				convenienceAlertOrder.Enqueue(text2);
				while (convenienceAlertOrder.Count > 256)
				{
					convenienceAlertIds.Remove(convenienceAlertOrder.Dequeue());
				}
				if (convenienceAlertTimes == null)
				{
					convenienceAlertTimes = new Dictionary<string, long>(StringComparer.Ordinal);
				}
				if (!convenienceAlertTimes.TryGetValue(text, out var value) || !(Stopwatch.GetElapsedTime(value).TotalSeconds < (double)(jsonNode?["cooldownSeconds"]?.GetValue<int>() ?? 15)))
				{
					convenienceAlertTimes[text] = Stopwatch.GetTimestamp();
					PlayConvenienceSound(Str(jsonNode?["tone"]) ?? "chime", valueOrDefault);
				}
			}
		}
	}

	private JsonObject TestConvenienceSound(JsonObject payload)
	{
		string text = Str(payload["tone"]);
		int value = default(int);
		bool flag = text == null || !ConvenienceSettings.Tones.Contains(text) || !(payload["volume"] is JsonValue jsonValue) || jsonValue.GetValueKind() != JsonValueKind.Number || !jsonValue.TryGetValue<int>(out value);
		if (!flag)
		{
			bool flag2 = ((value < 0 || value > 100) ? true : false);
			flag = flag2;
		}
		if (flag)
		{
			throw new InvalidOperationException("请选择有效提醒音及 0–100 的整数音量。");
		}
		PlayConvenienceSound(text, value);
		return new JsonObject
		{
			["played"] = value > 0 && !convenienceSoundUnavailable,
			["volume"] = value
		};
	}

	private async Task<JsonObject> FavoriteCurrentBuild(JsonObject payload)
	{
		if (!ready || closing || gameProcessFailed)
		{
			throw new InvalidOperationException("请先进入游戏，再收藏当前实际配装。");
		}
		WebView2 view = GameView;
		long generation = pageGeneration;
		string ticket = null;
		string requestedName = Str(payload["name"]);
		if (requestedName != null && (requestedName.Length > 120 || requestedName.Any(char.IsControl)))
		{
			throw new InvalidOperationException("收藏名称最多 120 个字符，不能包含控制字符。");
		}
		JsonObject result;
		try
		{
			JsonNode jsonNode = JsonNode.Parse(await GameScriptAsync("globalThis.__PB_CONVENIENCE?.captureCurrentBuild()??{ok:false,reason:'便利功能尚未就绪，请稍候重试。'}"));
			if (!Flag(jsonNode?["ok"]) || !(jsonNode?["build"] is JsonObject jsonObject))
			{
				throw new InvalidOperationException(Str(jsonNode?["reason"]) ?? "当前没有可确认的对局，请在游戏内或尚未关闭的结算页收藏。");
			}
			ticket = Str(jsonNode["ticket"]);
			if (ticket == null || !Regex.IsMatch(ticket, "^capture-[0-9]{1,16}$"))
			{
				throw new InvalidOperationException("收藏确认票据无效，请重试。");
			}
			int species = jsonObject["species"]?.GetValue<int>() ?? 0;
			JsonObject jsonObject2 = catalog["characters"]?.AsArray().OfType<JsonObject>().FirstOrDefault((JsonObject entry) => entry["id"]?.ToJsonString() == species.ToString(CultureInfo.InvariantCulture));
			jsonObject["id"] = "custom-" + Guid.NewGuid().ToString("N");
			jsonObject["name"] = (string.IsNullOrWhiteSpace(requestedName) ? ((Str(jsonObject2?["name"]) ?? "角色") + "配装收藏") : requestedName.Trim());
			jsonObject["enabled"] = true;
			jsonObject["autoSelect"] = false;
			JsonObject normalized = (await LocalFunction("payload.custom-plans.mjs", "normalizeCustomPlan", jsonObject))?.AsObject() ?? throw new InvalidOperationException("收藏方案校验失败。");
			JsonArray jsonArray = customPlans.DeepClone().AsArray();
			jsonArray.Add(normalized.DeepClone());
			await SavePlans(jsonArray, applyLive: false, RequireCurrent);
			result = new JsonObject
			{
				["saved"] = true,
				["id"] = normalized["id"]?.DeepClone(),
				["name"] = normalized["name"]?.DeepClone(),
				["species"] = species,
				["count"] = customPlans.Count
			};
		}
		finally
		{
			if (ticket != null && view == GameView && generation == pageGeneration && !gameProcessFailed)
			{
				try
				{
					MainWindow mainWindow = this;
					string script = "globalThis.__PB_CONVENIENCE?.clearCapture(" + JsonSerializer.Serialize(ticket) + ")";
					TimeSpan? timeout = TimeSpan.FromSeconds(2.0);
					await mainWindow.GameScriptAsync(script, default(CancellationToken), timeout);
				}
				catch
				{
				}
			}
		}
		return result;
		async Task RequireCurrent()
		{
			bool flag = closing || view != GameView || generation != pageGeneration || gameProcessFailed;
			if (!flag)
			{
				flag = await GameScriptAsync("globalThis.__PB_CONVENIENCE?.isCaptureCurrent(" + JsonSerializer.Serialize(ticket) + ")===true") != "true";
			}
			if (flag)
			{
				throw new OperationCanceledException("当前局、账号或页面已变化，未保存过期配装；请在当前游戏中重新收藏。");
			}
		}
	}

	private static JsonObject NormalizeFinalReplacements(JsonNode? value)
	{
		JsonObject jsonObject = new JsonObject();
		if (!(value is JsonObject source))
		{
			return jsonObject;
		}
		foreach (KeyValuePair<string, JsonNode> item in source.Take(999))
		{
			if (!int.TryParse(item.Key, out var result) || result < 1 || result > 999999 || item.Key != result.ToString(CultureInfo.InvariantCulture) || !(item.Value is JsonObject jsonObject2))
			{
				continue;
			}
			JsonObject jsonObject3 = new JsonObject();
			string[] array = new string[4] { "moves", "vitamins", "strictMoves", "strictVitamins" };
			foreach (string text in array)
			{
				bool flag;
				switch (text)
				{
				case "moves":
					jsonObject3[text] = FinalMoveSettings.Normalize(jsonObject2);
					continue;
				case "strictMoves":
				case "strictVitamins":
					flag = true;
					break;
				default:
					flag = false;
					break;
				}
				bool flag2 = flag;
				JsonObject jsonObject4 = jsonObject2[text] as JsonObject;
				int num = 30;
				if (jsonObject4 != null && jsonObject4["level"]?.GetValueKind() == JsonValueKind.Number && double.TryParse(jsonObject4["level"].ToJsonString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var result2) && double.IsFinite(result2))
				{
					num = (int)Math.Clamp(Math.Truncate(result2), 1.0, 999999.0);
				}
				JsonArray jsonArray = new JsonArray();
				HashSet<string> hashSet = new HashSet<string>(StringComparer.Ordinal);
				object obj;
				string text2;
				for (int j = 0; j < ((text == "vitamins") ? 6 : 4); text2 = (string)obj, jsonArray.Add((text2 != null && Regex.IsMatch(text2, "^[A-Za-z0-9][A-Za-z0-9_.:+-]{0,99}$") && (text2 == "pb:empty-slot" || flag2 || hashSet.Add(text2))) ? JsonValue.Create(text2) : null), j++)
				{
					if (jsonObject4?["targets"] is JsonArray jsonArray2 && j < jsonArray2.Count)
					{
						JsonNode? jsonNode = jsonArray2[j];
						if (jsonNode != null && jsonNode.GetValueKind() == JsonValueKind.String)
						{
							obj = jsonArray2[j].GetValue<string>();
							continue;
						}
					}
					obj = null;
				}
				JsonObject jsonObject5 = new JsonObject
				{
					["enabled"] = jsonObject4 != null && jsonObject4["enabled"]?.GetValueKind() == JsonValueKind.True,
					["targets"] = jsonArray
				};
				if (!flag2)
				{
					jsonObject5["level"] = num;
				}
				if (!flag2 && jsonObject4?["banishLevels"] is JsonArray jsonArray3)
				{
					JsonArray jsonArray4 = new JsonArray();
					int num2;
					int value2;
					for (int k = 0; k < 6; value2 = num2, jsonArray4.Add(value2), k++)
					{
						if (k < jsonArray3.Count)
						{
							JsonNode? jsonNode2 = jsonArray3[k];
							if (jsonNode2 != null && jsonNode2.GetValueKind() == JsonValueKind.Number && double.TryParse(jsonArray3[k].ToJsonString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var result3) && double.IsFinite(result3))
							{
								num2 = (int)Math.Clamp(Math.Truncate(result3), 0.0, 12.0);
								continue;
							}
						}
						num2 = 0;
					}
					jsonObject5["banishLevels"] = jsonArray4;
				}
				jsonObject3[text] = jsonObject5;
			}
			if (jsonObject2["stageProfiles"] is JsonObject value3)
			{
				jsonObject3["stageProfiles"] = NormalizeFinalStageProfiles(value3);
			}
			jsonObject[item.Key] = jsonObject3;
		}
		return jsonObject;
	}

	private static JsonObject NormalizeFinalStageProfiles(JsonNode? value)
	{
		JsonObject jsonObject = new JsonObject();
		if (!(value is JsonObject source))
		{
			return jsonObject;
		}
		foreach (KeyValuePair<string, JsonNode> item in source.Take(32))
		{
			bool flag;
			switch (item.Key)
			{
			case "__proto__":
			case "prototype":
			case "constructor":
				flag = true;
				break;
			default:
				flag = false;
				break;
			}
			if (flag || (item.Key != "default" && !Regex.IsMatch(item.Key, "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")) || !(item.Value is JsonObject jsonObject2))
			{
				continue;
			}
			JsonObject jsonObject3 = new JsonObject();
			string[] array = new string[3] { "1", "2", "3" };
			foreach (string propertyName in array)
			{
				if (!(jsonObject2[propertyName] is JsonObject jsonObject4))
				{
					continue;
				}
				JsonObject jsonObject5 = new JsonObject();
				string[] array2 = new string[2] { "moves", "vitamins" };
				foreach (string propertyName2 in array2)
				{
					if (jsonObject4[propertyName2] is JsonObject jsonObject6)
					{
						jsonObject5[propertyName2] = jsonObject6.DeepClone();
					}
				}
				if (jsonObject5.Count == 0)
				{
					continue;
				}
				JsonObject jsonObject7 = NormalizeFinalReplacements(new JsonObject { ["1"] = jsonObject5 })["1"].AsObject();
				JsonObject jsonObject8 = new JsonObject();
				array2 = new string[2] { "moves", "vitamins" };
				foreach (string propertyName3 in array2)
				{
					if (jsonObject5.ContainsKey(propertyName3))
					{
						jsonObject8[propertyName3] = jsonObject7[propertyName3].DeepClone();
					}
				}
				jsonObject3[propertyName] = jsonObject8;
			}
			if (jsonObject3.Count > 0)
			{
				jsonObject[item.Key] = jsonObject3;
			}
		}
		return jsonObject;
	}

	private static JsonObject MergeFinalStageProfiles(JsonNode? current, JsonNode? patch)
	{
		JsonObject jsonObject = NormalizeFinalStageProfiles(current);
		if (!(patch is JsonObject source))
		{
			return jsonObject;
		}
		foreach (KeyValuePair<string, JsonNode> item in source.Take(32))
		{
			bool flag;
			switch (item.Key)
			{
			case "__proto__":
			case "prototype":
			case "constructor":
				flag = true;
				break;
			default:
				flag = false;
				break;
			}
			if (flag || (item.Key != "default" && !Regex.IsMatch(item.Key, "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")))
			{
				continue;
			}
			if (item.Value == null)
			{
				jsonObject.Remove(item.Key);
			}
			else
			{
				if (!(item.Value is JsonObject jsonObject2))
				{
					continue;
				}
				JsonObject jsonObject3 = (jsonObject[item.Key] as JsonObject) ?? new JsonObject();
				string[] array = new string[3] { "1", "2", "3" };
				foreach (string propertyName in array)
				{
					if (!jsonObject2.ContainsKey(propertyName))
					{
						continue;
					}
					if (jsonObject2[propertyName] == null)
					{
						jsonObject3.Remove(propertyName);
					}
					else
					{
						if (!(jsonObject2[propertyName] is JsonObject jsonObject4))
						{
							continue;
						}
						JsonObject jsonObject5 = (jsonObject3[propertyName] as JsonObject) ?? new JsonObject();
						string[] array2 = new string[2] { "moves", "vitamins" };
						foreach (string propertyName2 in array2)
						{
							if (!jsonObject4.ContainsKey(propertyName2))
							{
								continue;
							}
							if (jsonObject4[propertyName2] == null)
							{
								jsonObject5.Remove(propertyName2);
							}
							else
							{
								if (!(jsonObject4[propertyName2] is JsonObject jsonObject6))
								{
									continue;
								}
								JsonObject jsonObject7 = (jsonObject5[propertyName2] as JsonObject) ?? new JsonObject();
								foreach (KeyValuePair<string, JsonNode> item2 in jsonObject6)
								{
									jsonObject7[item2.Key] = item2.Value?.DeepClone();
								}
								if (jsonObject5[propertyName2] == null)
								{
									jsonObject5[propertyName2] = jsonObject7;
								}
							}
						}
						if (jsonObject3[propertyName] == null)
						{
							jsonObject3[propertyName] = jsonObject5;
						}
					}
				}
				if (jsonObject[item.Key] == null)
				{
					jsonObject[item.Key] = jsonObject3;
				}
			}
		}
		return NormalizeFinalStageProfiles(jsonObject);
	}

	private static JsonObject MergeFinalReplacements(JsonNode? current, JsonObject patch)
	{
		JsonObject jsonObject = NormalizeFinalReplacements(current);
		foreach (KeyValuePair<string, JsonNode> item in patch)
		{
			if (!(item.Value is JsonObject jsonObject2) || !int.TryParse(item.Key, out var result) || result < 1 || result > 999999 || item.Key != result.ToString(CultureInfo.InvariantCulture))
			{
				continue;
			}
			JsonObject jsonObject3 = jsonObject[item.Key]?.AsObject() ?? new JsonObject();
			if (jsonObject2["fusion"] is JsonObject && !FinalMoveSettings.IsUnified(jsonObject2["moves"]))
			{
				JsonNode jsonNode = jsonObject3["moves"]?["migration"];
				jsonObject3["moves"] = jsonNode?["moves"]?.DeepClone() ?? new JsonObject();
				jsonObject3["fusion"] = jsonNode?["fusion"]?.DeepClone() ?? new JsonObject();
			}
			string[] array = new string[5] { "moves", "fusion", "vitamins", "strictMoves", "strictVitamins" };
			foreach (string text in array)
			{
				if (!(jsonObject2[text] is JsonObject jsonObject4))
				{
					continue;
				}
				JsonObject jsonObject5 = jsonObject3[text]?.AsObject() ?? new JsonObject();
				bool flag = ((text == "strictMoves" || text == "strictVitamins") ? true : false);
				string[] array2 = ((!flag) ? ((!(text == "moves")) ? new string[4] { "enabled", "level", "targets", "banishLevels" } : new string[6] { "schemaVersion", "enabled", "level", "targets", "migration", "banishLevels" }) : new string[2] { "enabled", "targets" });
				foreach (string propertyName in array2)
				{
					if (jsonObject4.ContainsKey(propertyName))
					{
						jsonObject5[propertyName] = jsonObject4[propertyName]?.DeepClone();
					}
				}
				if (jsonObject3[text] == null)
				{
					jsonObject3[text] = jsonObject5;
				}
			}
			if (jsonObject2.ContainsKey("stageProfiles"))
			{
				jsonObject3["stageProfiles"] = MergeFinalStageProfiles(jsonObject3["stageProfiles"], jsonObject2["stageProfiles"]);
			}
			if (jsonObject[item.Key] == null)
			{
				jsonObject[item.Key] = jsonObject3;
			}
		}
		return NormalizeFinalReplacements(jsonObject);
	}

	private static string BrowserSource(string source)
	{
		return Regex.Replace(Regex.Replace(source, "^import[^;]*;\\s*", "", RegexOptions.Multiline), "^export ", "", RegexOptions.Multiline);
	}

	private JsonObject PilotSettings()
	{
		JsonObject jsonObject = config.DeepClone().AsObject();
		jsonObject.Remove("wecomPush");
		jsonObject["customPlans"] = customPlans.DeepClone();
		jsonObject["finalReplacements"] = NormalizeFinalReplacements(jsonObject["finalReplacements"]);
		if (currentRunOnlyIntent || Str(jsonObject["mode"]) == "autoManage")
		{
			jsonObject["mode"] = "autoManage";
			jsonObject["autoRestart"] = false;
			jsonObject["autoClaim"] = false;
		}
		else if (temporaryGuest)
		{
			jsonObject["mode"] = "resources";
			jsonObject["characterId"] = null;
			jsonObject["biome"] = "auto";
			jsonObject["tier"] = 0;
			jsonObject["build"] = "generic";
			jsonObject["customPlans"] = new JsonArray();
			jsonObject["modeSettings"]["resources"] = new JsonObject
			{
				["biome"] = "auto",
				["tier"] = "auto"
			};
		}
		return jsonObject;
	}

	private void ReadCustomPlans()
	{
		string text = portable.ValidatePath(CustomPlansPath);
		if (!File.Exists(text))
		{
			return;
		}
		try
		{
			if (new FileInfo(text).Length > 8000000)
			{
				throw new JsonException("方案文件超过大小限制");
			}
			JsonNode jsonNode = JsonNode.Parse(File.ReadAllText(text));
			customPlans = ((jsonNode is JsonArray jsonArray) ? jsonArray : jsonNode?["plans"]?.AsArray()) ?? throw new JsonException("方案格式无效");
		}
		catch (Exception ex) when (((ex is JsonException || ex is InvalidOperationException) ? 1 : 0) != 0)
		{
			customPlans = new JsonArray();
			Log("error", "自定义方案格式无效", "原文件保留，请从自定义方案页重新导入有效 JSON。");
		}
	}

	private async Task<JsonNode?> LocalFunction(string resource, string function, params JsonNode?[] args)
	{
		string script = "((work)=>{try{const value=work();return value===undefined?{ok:false,code:'local-result-undefined',errorType:'Undefined'}:{ok:true,value}}catch(error){return {ok:false,code:'local-function-threw',errorType:typeof error?.name==='string'?error.name:'Error'}}})(()=>{\n" + ControllerSources.ServiceSource(Resource, BrowserSource, resource) + "\nreturn " + function + "(" + string.Join(",", args.Select((JsonNode n) => n?.ToJsonString() ?? "null")) + ");})";
		JsonNode jsonNode = JsonNode.Parse(await PanelScriptAsync(script));
		if (!(jsonNode is JsonObject jsonObject) || !Flag(jsonObject["ok"]))
		{
			string text = Str(jsonNode?["code"]) ?? "local-result-unserializable";
			string text2 = Str(jsonNode?["errorType"]) ?? "Unknown";
			throw new InvalidOperationException("本地处理失败：" + resource + " / " + function + " / " + text + " / " + text2);
		}
		JsonNode? result = jsonObject["value"];
		jsonObject.Remove("value");
		return result;
	}

	private async Task InitializeCustomization()
	{
		JsonObject jsonObject = catalog;
		jsonObject["planEditorSchema"] = await LocalFunction("payload.custom-plans.mjs", "(()=>planEditorSchema)");
		try
		{
			customPlans = (await LocalFunction("payload.custom-plans.mjs", "normalizeCustomPlans", customPlans))?.AsArray() ?? throw new InvalidOperationException("方案结构不合法");
		}
		catch (Exception ex)
		{
			customPlans = new JsonArray();
			Log("error", "自定义方案验证失败", "原文件保留：" + ex.Message);
		}
		catalogRevision++;
	}

	private async Task SavePlans(JsonArray next, bool applyLive = true, Func<Task>? beforeCommit = null)
	{
		JsonArray normalized = (await LocalFunction("payload.custom-plans.mjs", "normalizeCustomPlans", next))?.AsArray() ?? throw new InvalidOperationException("方案校验没有返回结果");
		string contents = new JsonObject
		{
			["schemaVersion"] = 1,
			["plans"] = normalized.DeepClone()
		}.ToJsonString(JsonOptions);
		if (Encoding.UTF8.GetByteCount(contents) > 8000000)
		{
			throw new InvalidOperationException("方案库超过8MB，请先整理不再需要的方案；原文件保持不变。");
		}
		string pending = portable.ValidatePath(CustomPlansPath + ".pending");
		if (beforeCommit != null)
		{
			await beforeCommit();
		}
		try
		{
			await File.WriteAllTextAsync(pending, contents);
			if (beforeCommit != null)
			{
				await beforeCommit();
			}
			File.Move(portable.ValidatePath(pending), portable.ValidatePath(CustomPlansPath), overwrite: true);
		}
		catch
		{
			if (beforeCommit != null && File.Exists(portable.ValidatePath(pending)))
			{
				File.Delete(portable.ValidatePath(pending));
			}
			throw;
		}
		customPlans = normalized;
		if (ready && applyLive)
		{
			await GameScriptAsync("globalThis.__PB_PILOT?.setSettings(" + PilotSettings().ToJsonString() + ")");
			await RefreshInitializationScriptAsync();
		}
	}

	private async Task<JsonObject> CustomPlanCommand(string action, JsonObject payload)
	{
		if (action == "exportCustomPlans")
		{
			string folder = portable.EnsureDirectory(portable.DataPath("exports"));
			JsonArray selected = customPlans.DeepClone().AsArray();
			if (payload["ids"] is JsonArray source)
			{
				HashSet<string> keys = source.Select(Str).ToHashSet();
				selected = new JsonArray((from p in customPlans.OfType<JsonObject>()
					where keys.Contains(Str(p["id"]))
					select p.DeepClone()).ToArray());
				if (selected.Count != keys.Count)
				{
					throw new InvalidOperationException("请先保存要导出的方案，再重新选择");
				}
			}
			if (selected.Count == 0)
			{
				throw new InvalidOperationException("还没有可导出的方案，请先保存一个方案");
			}
			string path = portable.ValidatePath(Path.Combine(folder, "custom-plans-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".pokebonk-plan.json"));
			if (Flag(payload["chooseFile"]))
			{
				await PauseForPlanFileDialog();
				SaveFileDialog saveFileDialog = new SaveFileDialog
				{
					Title = "导出方案（请保存在客户端目录内）",
					InitialDirectory = folder,
					FileName = Path.GetFileName(path),
					Filter = "PokéBonk 方案文件 (*.pokebonk-plan.json)|*.pokebonk-plan.json",
					DefaultExt = ".pokebonk-plan.json",
					AddExtension = true,
					OverwritePrompt = true,
					AddToRecent = false
				};
				if (saveFileDialog.ShowDialog(this) != true)
				{
					return new JsonObject { ["cancelled"] = true };
				}
				try
				{
					path = portable.ValidatePath(saveFileDialog.FileName);
				}
				catch (IOException)
				{
					throw new InvalidOperationException("请将方案导出到客户端文件夹内（建议 data/exports），再手动分享该文件。");
				}
			}
			new PlanFileStore(portable).Write(path, selected);
			Log("info", "方案文件已导出", selected.Count + " 个方案 · " + path);
			return new JsonObject
			{
				["plans"] = selected,
				["path"] = path,
				["cancelled"] = false
			};
		}
		if (action == "importCustomPlanFile")
		{
			await PauseForPlanFileDialog();
			OpenFileDialog openFileDialog = new OpenFileDialog
			{
				Title = "导入其他玩家分享的方案",
				Filter = "PokéBonk / JSON 方案文件 (*.json)|*.json|所有文件 (*.*)|*.*",
				InitialDirectory = portable.EnsureDirectory(portable.DataPath("exports")),
				Multiselect = false,
				CheckFileExists = true,
				AddToRecent = false
			};
			if (openFileDialog.ShowDialog(this) != true)
			{
				return new JsonObject { ["cancelled"] = true };
			}
			JsonArray jsonArray = new PlanFileStore(portable).Read(openFileDialog.FileName);
			JsonArray imported = (await LocalFunction("payload.custom-plans.mjs", "normalizeCustomPlans", jsonArray))?.AsArray() ?? throw new InvalidOperationException("导入方案无效");
			(JsonArray Plans, int Added, int Duplicates, int Renamed) merged = PlanFileStore.Merge(customPlans, imported);
			if (merged.Added > 0)
			{
				await SavePlans(merged.Plans);
			}
			Log("info", "方案文件已导入", $"新增 {merged.Added} 个，重复跳过 {merged.Duplicates} 个，编号冲突另存 {merged.Renamed} 个；原方案保留。");
			return new JsonObject
			{
				["cancelled"] = false,
				["customPlans"] = customPlans.DeepClone(),
				["added"] = merged.Added,
				["duplicates"] = merged.Duplicates,
				["renamed"] = merged.Renamed
			};
		}
		JsonArray next = customPlans.DeepClone().AsArray();
		if (action == "saveCustomPlan")
		{
			JsonObject plan = (await LocalFunction("payload.custom-plans.mjs", "normalizeCustomPlan", payload["plan"]))?.AsObject() ?? throw new InvalidOperationException("方案无效");
			JsonObject jsonObject = next.OfType<JsonObject>().FirstOrDefault((JsonObject p) => Str(p["id"]) == Str(plan["id"]));
			if (jsonObject != null)
			{
				next.Remove(jsonObject);
			}
			next.Add(plan.DeepClone());
			await SavePlans(next);
			Log("info", "自定义方案已保存", Str(plan["name"]) + " · 下局按角色、地图、难度和模式匹配。");
			return new JsonObject
			{
				["plan"] = plan,
				["customPlans"] = customPlans.DeepClone()
			};
		}
		if (action == "deleteCustomPlan")
		{
			JsonObject jsonObject2 = next.OfType<JsonObject>().FirstOrDefault((JsonObject p) => Str(p["id"]) == Str(payload["id"]));
			if (jsonObject2 != null)
			{
				next.Remove(jsonObject2);
			}
			await SavePlans(next);
			if (Str(config["build"]) == Str(payload["id"]))
			{
				config["build"] = "auto";
				await File.WriteAllTextAsync(portable.ValidatePath(portable.SettingsPath), config.ToJsonString(JsonOptions));
				if (ready)
				{
					await GameScriptAsync("globalThis.__PB_PILOT?.setSettings(" + PilotSettings().ToJsonString() + ")");
					await RefreshInitializationScriptAsync();
				}
			}
		}
		else
		{
			JsonArray selected = (await LocalFunction("payload.custom-plans.mjs", "normalizeCustomPlans", payload["plans"]))?.AsArray() ?? throw new InvalidOperationException("导入方案无效");
			foreach (JsonObject plan2 in selected.OfType<JsonObject>())
			{
				JsonObject jsonObject3 = next.OfType<JsonObject>().FirstOrDefault((JsonObject p) => Str(p["id"]) == Str(plan2["id"]));
				if (jsonObject3 != null)
				{
					next.Remove(jsonObject3);
				}
				next.Add(plan2.DeepClone());
			}
			await SavePlans(next);
			Log("info", "自定义方案已导入", "导入 " + selected.Count + " 个方案；同编号替换，其余方案保留。");
		}
		return new JsonObject { ["customPlans"] = customPlans.DeepClone() };
	}

	private async Task PauseForPlanFileDialog(bool authorizedDiagnostic = false)
	{
		CancelRecoveryIntent("正在选择方案文件");
		if (!ready || gameProcessFailed)
		{
			return;
		}
		string text = (authorizedDiagnostic ? "const a=globalThis.__PB_BRIDGE?.app,x=globalThis.__PB_NATIVE_DIAGNOSTIC_AUTH;if(!x||x.app!==a||x.meta!==a?.meta||x.account!==a.meta.account)throw Error('测试身份已变化');" : "");
		if (await GameScriptAsync("(()=>{" + text + "const p=globalThis.__PB_PILOT;if(!p||!p.enabled&&p.app?.run?.state!=='play')return false;p.stop('正在选择方案文件',{pauseGame:true});return true})()") != "true")
		{
			return;
		}
		resumeAfterDeployment = false;
		for (int attempt = 0; attempt < 20; attempt++)
		{
			if (await GameScriptAsync("globalThis.__PB_BRIDGE?.app?.run?.state==='play'") != "true")
			{
				break;
			}
			if (attempt == 19)
			{
				throw new InvalidOperationException("游戏尚未确认暂停，请稍候再次选择方案文件");
			}
			await Task.Delay(50);
		}
		game = JsonNode.Parse(await GameScriptAsync("globalThis.__PB_PILOT?.snapshot() ?? null"))?.AsObject();
		status = "已暂停，选择方案文件后可点击继续";
		Log("info", "已暂停以选择方案文件", "当前对局保留。文件窗口关闭后，点击继续即可恢复挂机。");
		await SendState();
	}

	private async Task<string> MaintenancePrompt(string kind)
	{
		JsonObject jsonObject = new JsonObject
		{
			["clientVersion"] = ClientVersion,
			["gameVersion"] = updateStatus["gameVersion"]?.DeepClone() ?? catalog["gameVersion"]?.DeepClone(),
			["gameHash"] = compatibilityReport?["sourceHash"]?.DeepClone(),
			["checkedAt"] = updateStatus["checkedAt"]?.DeepClone(),
			["compatibilityLevel"] = compatibilityReport?["level"]?.DeepClone(),
			["missing"] = compatibilityReport?["missing"]?.DeepClone(),
			["warnings"] = compatibilityReport?["warnings"]?.DeepClone(),
			["catalogCounts"] = lastCatalogSnapshot?["counts"]?.DeepClone()
		};
		return Str(await LocalFunction("payload.maintenance-prompts.mjs", "generateMaintenancePrompt", JsonValue.Create(kind), jsonObject)) ?? throw new InvalidOperationException("话术生成失败");
	}

	private void ObserveNativeBoot(JsonNode? boot)
	{
		if (Str(boot?["phase"]) == "loading" && !nativeBootLoadingAt.HasValue)
		{
			nativeBootLoadingAt = DateTimeOffset.UtcNow;
		}
		nativeBootObservation = boot as JsonObject;
		connectionDiagnostics["nativeBoot"] = nativeBootObservation?.DeepClone();
	}

	private JsonObject ConnectionState()
	{
		JsonObject jsonObject = connectionDiagnostics.DeepClone().AsObject();
		if (Str(nativeBootObservation?["phase"]) == "ready" && CompatibilityMayOperate(compatibilityReport))
		{
			jsonObject["stage"] = ((Str(compatibilityReport?["state"]) == "ready") ? "ready" : "partial");
		}
		if (Str(nativeBootObservation?["phase"]) != "ready")
		{
			jsonObject["bootElapsedMs"] = Math.Max(0.0, (DateTimeOffset.Now - gameNavigationAt).TotalMilliseconds);
		}
		return jsonObject;
	}

	private string NativeBootStatus()
	{
		return Str(nativeBootObservation?["stage"]) switch
		{
			"data-loading" => "游戏正在下载公开数据，冷启动中", 
			"graphics-wait" => "游戏正在等待显卡初始化，原生页面仍在重试", 
			"auth-loading" => "游戏正在检查原有会话和存档", 
			"native-retry" => "游戏原生加载尚未完成，等待自动重连", 
			_ => "游戏正在启动并检查接口", 
		};
	}

	private static string SafePublicResource(Uri uri)
	{
		return uri.GetComponents(UriComponents.SchemeAndServer, UriFormat.UriEscaped) + uri.AbsolutePath;
	}

	private static bool PublicScriptUri(string? value, out Uri uri)
	{
		if (Uri.TryCreate(value, UriKind.Absolute, out Uri result) && result.Scheme == "https" && result.Host == "pokebonk.com" && (result.AbsolutePath.EndsWith(".js", StringComparison.OrdinalIgnoreCase) || result.AbsolutePath.EndsWith(".mjs", StringComparison.OrdinalIgnoreCase)))
		{
			uri = result;
			return true;
		}
		uri = null;
		return false;
	}

	private void RecordConnection(string phase, string code, Uri? uri = null, int? responseStatus = null, Exception? error = null)
	{
		JsonObject jsonObject = new JsonObject
		{
			["at"] = DateTimeOffset.UtcNow.ToString("O"),
			["phase"] = phase,
			["code"] = code,
			["resource"] = ((uri == null) ? null : SafePublicResource(uri)),
			["httpStatus"] = responseStatus,
			["exceptionType"] = error?.GetType().Name,
			["hresult"] = error?.HResult
		};
		connectionDiagnostics["stage"] = phase;
		connectionDiagnostics["lastEvent"] = jsonObject.DeepClone();
		connectionDiagnostics["lastActivityAt"] = jsonObject["at"]?.DeepClone();
		connectionEvents.Enqueue(jsonObject);
		while (connectionEvents.Count > 20)
		{
			connectionEvents.Dequeue();
		}
		connectionDiagnostics["events"] = new JsonArray(connectionEvents.Select((JsonObject entry) => entry.DeepClone()).ToArray());
	}

	private async Task ConfigureGameConnectionAsync(WebView2 view, CancellationToken token)
	{
		CoreWebView2 core = view.CoreWebView2;
		connectionDiagnostics["runtimeVersion"] = core.Environment.BrowserVersionString;
		JsonNode jsonNode = JsonNode.Parse(await PanelScriptAsync("(()=>{var missing=[];if(typeof Object.hasOwn!=='function')missing.push('Object.hasOwn');if(typeof Array.prototype.at!=='function')missing.push('Array.at');if(typeof structuredClone!=='function')missing.push('structuredClone');return {ok:missing.length===0,missing:missing}})()", token));
		connectionDiagnostics["javascriptFeatures"] = jsonNode?.DeepClone();
		if (!Flag(jsonNode?["ok"]))
		{
			RecordConnection("runtime-unsupported", "javascript-features-missing");
			throw new InvalidOperationException("当前WebView2缺少客户端所需JavaScript功能，请使用内置前置升级Runtime。缺失：" + string.Join("、", jsonNode?["missing"]?.AsArray().Select(Str) ?? Array.Empty<string>()));
		}
		core.GetDevToolsProtocolEventReceiver("Fetch.requestPaused").DevToolsProtocolEventReceived += async delegate(object? _, CoreWebView2DevToolsProtocolEventReceivedEventArgs args)
		{
			await InterceptBrowserResponseAsync(view, core, args.ParameterObjectAsJson);
		};
		core.WebResourceResponseReceived += delegate(object? _, CoreWebView2WebResourceResponseReceivedEventArgs args)
		{
			try
			{
				if (view == GameView && !closing && Uri.TryCreate(args.Request.Uri, UriKind.Absolute, out Uri result) && !(result.Scheme != "https") && !(result.Host != "pokebonk.com") && result.AbsolutePath.StartsWith("/data/", StringComparison.Ordinal) && result.AbsolutePath.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
				{
					RecordConnection("native-data", (args.Response.StatusCode >= 400) ? "public-data-http-error" : "public-data-response", result, args.Response.StatusCode);
				}
			}
			catch
			{
			}
		};
		try
		{
			token.ThrowIfCancellationRequested();
			await core.CallDevToolsProtocolMethodAsync("Fetch.enable", CompatibilityFetchPatterns().ToJsonString()).WaitAsync(TimeSpan.FromSeconds(8.0), token);
			RecordConnection("waiting", "browser-response-hook-ready");
		}
		catch (Exception ex)
		{
			MainWindow mainWindow = this;
			Exception error = ex;
			mainWindow.RecordConnection("connection-error", "browser-response-hook-unavailable", null, null, error);
			throw new InvalidOperationException("浏览器脚本响应接口不可用，请更新内置前置；详情含当前Runtime版本及失败阶段。", ex);
		}
	}

	private async Task InterceptBrowserResponseAsync(WebView2 view, CoreWebView2 core, string eventJson)
	{
		string requestId = null;
		Uri uri = null;
		long generation = pageGeneration;
		CancellationToken navigationToken = connectionNavigationCancellation.Token;
		bool completed = false;
		string phase = "response";
		int? responseStatus = null;
		try
		{
			_ = 7;
			try
			{
				JsonNode paused = JsonNode.Parse(eventJson);
				requestId = Str(paused?["requestId"]);
				if (requestId == null || view != GameView || closing || !Uri.TryCreate(Str(paused?["request"]?["url"]), UriKind.Absolute, out uri))
				{
					return;
				}
				string hash;
				long preparationRevision;
				JsonObject prepared;
				Uri actualSourceUri;
				string source;
				if (PublicDataCompatibilityId(uri) != null)
				{
					completed = await TryOverridePublicDataResponseAsync(core, paused, uri, navigationToken);
				}
				else
				{
					if (!PublicScriptUri(uri.AbsoluteUri, out uri))
					{
						return;
					}
					if (await TryOverrideMissingEntryResponseAsync(core, paused, uri, navigationToken))
					{
						completed = true;
						return;
					}
					if (await TryOverrideNewsResponseAsync(core, paused, uri, navigationToken))
					{
						completed = true;
						return;
					}
					responseStatus = ((paused?["responseStatusCode"] is JsonValue jsonValue && jsonValue.TryGetValue<int>(out var value)) ? new int?(value) : ((int?)null));
					if (responseStatus != 200 || paused?["responseErrorReason"] != null)
					{
						string code = ((paused?["responseErrorReason"] != null || !responseStatus.HasValue || responseStatus >= 400) ? "public-script-network-error" : ((responseStatus == 304) ? "public-script-cache-pass" : ((responseStatus >= 300) ? "public-script-redirect" : "public-script-non-content")));
						RecordConnection("native-script", code, uri, responseStatus);
						return;
					}
					RecordConnection(phase, "public-script-response", uri, responseStatus);
					phase = "read-body";
					RecordConnection(phase, "public-script-body", uri, responseStatus);
					JsonNode jsonNode = JsonNode.Parse(await core.CallDevToolsProtocolMethodAsync("Fetch.getResponseBody", new JsonObject { ["requestId"] = requestId }.ToJsonString()).WaitAsync(TimeSpan.FromSeconds(CompatibilityBootGrace), navigationToken));
					if (view != GameView || generation != pageGeneration || closing)
					{
						return;
					}
					string text = Str(jsonNode?["body"]) ?? throw new InvalidDataException("脚本响应没有文本");
					if (text.Length > CompatibilitySourceLimit * 4 / 3 + 8)
					{
						throw new InvalidDataException("脚本响应超过大小限制");
					}
					byte[] array = (Flag(jsonNode?["base64Encoded"]) ? Convert.FromBase64String(text) : Encoding.UTF8.GetBytes(text));
					if (array.Length > CompatibilitySourceLimit)
					{
						throw new InvalidDataException("脚本响应超过大小限制");
					}
					source = Encoding.UTF8.GetString(array);
					if (await TryFulfillNativeModulePatchAsync(core, requestId, uri, source, navigationToken)) { completed = true; return; }
					// The public Vite preload entry imports App without exporting it.
					// It must prepare the verified graph before dependency responses run.
					// The adapter still requires one reachable App; unrelated scripts pass through.
					if (!source.Contains("export", StringComparison.Ordinal) && !source.Contains("__vite__mapDeps", StringComparison.Ordinal))
					{
						return;
					}
					phase = "prepare";
					RecordConnection(phase, "shared-adapter-prepare", uri, responseStatus);
					hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(source))).ToLowerInvariant();
					JsonObject preparationConfiguration = CompatibilityConfiguration();
					preparationRevision = CompatibilityOverridesStore.Revision(preparationConfiguration);
					string adapter = ControllerSources.ServiceSource(Resource, BrowserSource, "payload.compatibility.mjs");
					prepared = JsonNode.Parse(await PanelScriptAsync("(()=>{\n" + adapter + "\nreturn prepareGameSource(" + JsonSerializer.Serialize(source) + "," + new JsonObject
					{
						["sourceHash"] = hash,
						["compatibilityOverrides"] = preparationConfiguration,
						["moduleURL"] = uri.AbsoluteUri,
						["moduleSources"] = await PublicModuleSourcesAsync(source, uri, navigationToken),
						["originalModuleURL"] = uri.AbsoluteUri
					}.ToJsonString() + ");})()", navigationToken, TimeSpan.FromSeconds(30.0)))?.AsObject();
					if (view != GameView || generation != pageGeneration || closing || preparationRevision != CompatibilityOverridesStore.Revision(CompatibilityConfiguration()))
					{
						return;
					}
					if (prepared == null)
					{
						throw new InvalidDataException("兼容检测未返回结果");
					}
					if (!Flag(prepared["isGame"]))
					{
						return;
					}
					observedCompatibilityMainUrl = uri.AbsoluteUri;
					string text2 = Str(prepared["report"]?["discoveredConfig"]?["resources.newsModule"]);
					if (text2 != null && Uri.TryCreate(uri, text2, out Uri result) && PublicCompatibilityResourceUri(result, scriptOnly: true))
					{
						observedCompatibilityNewsUrl = result.AbsoluteUri;
					}
					actualSourceUri = uri;
					Uri manualModule = CompatibilityResourceTargetFor(preparationConfiguration, "resources.mainModule", uri);
					if (!(manualModule != null) || !PublicCompatibilityResourceUri(manualModule, scriptOnly: true))
					{
						goto IL_0c99;
					}
					try
					{
						string replacementSource = await ReadPublicCompatibilityResourceAsync(manualModule, CompatibilitySourceLimit, navigationToken);
						if (preparationRevision != CompatibilityOverridesStore.Revision(CompatibilityConfiguration()))
						{
							return;
						}
						string replacementHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(replacementSource))).ToLowerInvariant();
						JsonObject jsonObject = JsonNode.Parse(await PanelScriptAsync("(()=>{\n" + adapter + "\nreturn prepareGameSource(" + JsonSerializer.Serialize(replacementSource) + "," + new JsonObject
						{
							["sourceHash"] = replacementHash,
							["compatibilityOverrides"] = preparationConfiguration,
							["moduleURL"] = manualModule.AbsoluteUri,
							["moduleSources"] = await PublicModuleSourcesAsync(replacementSource, manualModule, navigationToken),
						["originalModuleURL"] = uri.AbsoluteUri
						}.ToJsonString() + ");})()", navigationToken, TimeSpan.FromSeconds(30.0)))?.AsObject();
						if (Flag(jsonObject?["isGame"]) && Flag(jsonObject?["ok"]) && Str(jsonObject?["code"]) != null)
						{
							source = replacementSource;
							hash = replacementHash;
							prepared = jsonObject;
							actualSourceUri = manualModule;
							RecordConnection("manual-resource", "verified-public-main-response", manualModule, 200);
						}
						else
						{
							RecordConnection("manual-resource", "unverified-public-main-preserved-original", manualModule);
						}
						goto IL_0c99;
					}
					catch (Exception ex) when (!(ex is OperationCanceledException))
					{
						RecordConnection("manual-resource", "public-main-unavailable-preserved-original", manualModule, null, ex);
						goto IL_0c99;
					}
				}
				goto end_IL_009c;
				IL_0c99:
				if (view != GameView || generation != pageGeneration || closing || preparationRevision != CompatibilityOverridesStore.Revision(CompatibilityConfiguration()))
				{
					goto end_IL_009c;
				}
				string text3 = Str(prepared["report"]?["discoveredConfig"]?["resources.newsModule"]);
				if (text3 != null && Uri.TryCreate(actualSourceUri, text3, out Uri result2) && PublicCompatibilityResourceUri(result2, scriptOnly: true))
				{
					observedCompatibilityNewsUrl = result2.AbsoluteUri;
				}
				gameModuleObserved = true;
				if (Str(prepared["originalGameSource"]) is string appSource && Uri.TryCreate(Str(prepared["originalGameModuleURL"]), UriKind.Absolute, out var appUri))
				{
					source = appSource; actualSourceUri = appUri;
					hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(source))).ToLowerInvariant();
					observedCompatibilityMainUrl = appUri.AbsoluteUri;
				}
				cachedCompatibilitySource = source;
				cachedCompatibilitySourceHash = hash;
				cachedCompatibilitySourceUrl = actualSourceUri.AbsoluteUri;
				latestPreparedCompatibility = prepared["report"]?.DeepClone().AsObject();
				compatibilityReport = prepared["report"]?.DeepClone().AsObject();
				connectionDiagnostics["sourceHash"] = hash;
				if (!Flag(prepared["ok"]))
				{
					RecordConnection("contract-blocked", Str(prepared["report"]?["code"]) ?? "adapter-blocked", uri, responseStatus);
					SetCompatibilityError(Str(prepared["report"]?["reason"]) ?? "游戏接口发生变化，自动控制已暂停。", Str(prepared["report"]?["code"]) ?? "adapter-blocked");
					goto end_IL_009c;
				}
				RegisterNativeModulePatches(prepared);
					source = Str(prepared["code"]) ?? throw new InvalidDataException("兼容处理未返回游戏模块");
				phase = "fulfill";
				await core.CallDevToolsProtocolMethodAsync("Fetch.fulfillRequest", new JsonObject
				{
					["requestId"] = requestId,
					["responseCode"] = 200,
					["responseHeaders"] = new JsonArray(new JsonObject
					{
						["name"] = "Content-Type",
						["value"] = "application/javascript; charset=utf-8"
					}, new JsonObject
					{
						["name"] = "Cache-Control",
						["value"] = "no-store"
					}),
					["body"] = Convert.ToBase64String(Encoding.UTF8.GetBytes(source))
				}.ToJsonString()).WaitAsync(TimeSpan.FromSeconds(8.0), navigationToken);
				completed = true;
				if (view != GameView || generation != pageGeneration || closing || preparationRevision != CompatibilityOverridesStore.Revision(CompatibilityConfiguration()))
				{
					goto end_IL_009c;
				}
				compatibility = "";
				RecordCompatibilityResourceReceipt("resources.mainModule", actualSourceUri, preparationRevision);
				RecordConnection("prepared", "game-module-transformed", uri, responseStatus);
				Log("info", "游戏接口已识别", "浏览器原响应结构检测通过，正在检查运行接口 · " + hash.Substring(0, 12));
				goto end_IL_0071;
				end_IL_009c:;
			}
			catch (Exception ex2)
			{
				if (view == GameView && generation == pageGeneration && !closing)
				{
					RecordConnection("connection-error", "script-" + phase + "-failed", uri, responseStatus, ex2);
					updateStatus["resourceWarning"] = "浏览器脚本处理未完成（" + phase + "），原生响应保留；详情见连接诊断。";
					try
					{
						MainWindow mainWindow = this;
						string[] obj = new string[10]
						{
							"阶段 ",
							phase,
							" · ",
							(uri == null) ? "公开脚本" : SafePublicResource(uri),
							" · HTTP ",
							null,
							null,
							null,
							null,
							null
						};
						int? num = responseStatus;
						obj[5] = num.ToString();
						obj[6] = " · ";
						obj[7] = ex2.GetType().Name;
						obj[8] = " · Runtime ";
						obj[9] = Str(connectionDiagnostics["runtimeVersion"]);
						mainWindow.Log("error", "脚本接入暂未完成", string.Concat(obj));
					}
					catch
					{
					}
				}
				goto end_IL_0071;
			}
			end_IL_0071:;
		}
		finally
		{
			if (!completed && requestId != null)
			{
				try
				{
					await core.CallDevToolsProtocolMethodAsync("Fetch.continueRequest", new JsonObject { ["requestId"] = requestId }.ToJsonString()).WaitAsync(TimeSpan.FromSeconds(3.0));
				}
				catch
				{
				}
			}
		}
	}

	private void OnGameHostSizeChanged(object sender, SizeChangedEventArgs e)
	{
		ApplyGameViewport();
	}

	private void OnMainLayoutSizeChanged(object sender, SizeChangedEventArgs e)
	{
		if (ControlRow != null && MainLayout != null && GameRow != null && SplitterRow != null)
		{
			double height = LayoutInformation.GetLayoutSlot(MainLayout).Height;
			ControlRow.MaxHeight = DisplaySettings.PanelMaximum((height > 0.0) ? height : MainLayout.ActualHeight, GameRow.MinHeight, SplitterRow.Height.Value, ControlRow.MinHeight);
			ApplyGameViewport();
		}
	}

	private void ApplyGameViewport()
	{
		if (GameHost == null || GameView == null)
		{
			return;
		}
		(double, double) tuple = DisplaySettings.Fit(GameHost.ActualWidth, GameHost.ActualHeight, Str(DisplaySettings.Normalize(config["display"])["mode"]));
		if (!(tuple.Item1 <= 0.0) && !(tuple.Item2 <= 0.0))
		{
			GameView.HorizontalAlignment = HorizontalAlignment.Center;
			GameView.VerticalAlignment = VerticalAlignment.Center;
			if (!double.IsFinite(GameView.Width) || Math.Abs(GameView.Width - tuple.Item1) > 0.01)
			{
				GameView.Width = tuple.Item1;
			}
			if (!double.IsFinite(GameView.Height) || Math.Abs(GameView.Height - tuple.Item2) > 0.01)
			{
				GameView.Height = tuple.Item2;
			}
		}
	}

	private void ReadUpdateCache()
	{
		try
		{
			string path = portable.DataPath("update-state.json");
			if (File.Exists(path))
			{
				lastCatalogSnapshot = JsonNode.Parse(File.ReadAllText(portable.ValidatePath(path)))?.AsObject();
			}
			resourceHashes = lastCatalogSnapshot?["resourceHashes"]?.DeepClone().AsObject() ?? new JsonObject();
			localization = JsonNode.Parse(Resource("payload.localization.json"))?.AsObject() ?? new JsonObject();
		}
		catch (Exception ex) when (((ex is JsonException || ex is InvalidOperationException) ? 1 : 0) != 0)
		{
			lastCatalogSnapshot = null;
			localization = JsonNode.Parse(Resource("payload.localization.json"))?.AsObject() ?? new JsonObject();
		}
	}

	private Task<string> PublicText(Uri uri, CancellationToken token)
	{
		return ReadPublicCompatibilityResourceAsync(uri, CompatibilitySourceLimit, token);
	}

	private async Task<(string? Version, string Source)> PublicDeploymentVersion(Uri origin, Uri actual, JsonObject prepared, CancellationToken token, JsonObject? compatibilitySettings = null)
	{
		try
		{
			using CancellationTokenSource versionTimeout = CancellationTokenSource.CreateLinkedTokenSource(token);
			versionTimeout.CancelAfter(TimeSpan.FromSeconds(3.0));
			JsonObject versionSettings = compatibilitySettings ?? CompatibilityConfiguration();
			Uri uri = new Uri(origin, "version.json");
			Uri versionUri = CompatibilityResourceTargetFor(versionSettings, "resources.versionManifest", uri) ?? uri;
			JsonObject obj = JsonNode.Parse(await ReadPublicCompatibilityResourceAsync(versionUri, CompatibilitySourceLimit, versionTimeout.Token)) as JsonObject;
			string value;
			string text = ((obj?["version"] is JsonValue jsonValue && jsonValue.TryGetValue<string>(out value)) ? value : null);
			string value2;
			string text2 = ((obj?["build"] is JsonValue jsonValue2 && jsonValue2.TryGetValue<string>(out value2)) ? value2 : null);
			if (text != null && Regex.IsMatch(text, "^\\d{1,4}\\.\\d{1,4}\\.\\d{1,4}(?:[-+][A-Za-z0-9.-]{1,64})?$") && text2 != null && Regex.IsMatch(text2, "^[A-Za-z0-9_-]{1,80}$") && Regex.IsMatch(actual.AbsolutePath, "-" + Regex.Escape(text2) + "\\.m?js$"))
			{
				if (CompatibilityOverridesStore.Revision(versionSettings) == CompatibilityOverridesStore.Revision(CompatibilityConfiguration()))
				{
					RecordCompatibilityResourceReceipt("resources.versionManifest", versionUri);
				}
				return (Version: text, Source: "official-version-matching-module-build");
			}
		}
		catch (Exception ex) when (((ex is HttpRequestException || ex is OperationCanceledException || ex is JsonException || ex is InvalidOperationException) ? 1 : 0) != 0)
		{
		}
		if (prepared["report"]?["gameVersion"] is JsonValue jsonValue3 && jsonValue3.TryGetValue<string>(out string value3) && Regex.IsMatch(value3 ?? "", "^\\d{1,4}\\.\\d{1,4}\\.\\d{1,4}$"))
		{
			return (Version: value3, Source: "prepared-module-version");
		}
		return (Version: null, Source: "unknown");
	}

	private async Task CheckForUpdatesAsync(bool manual)
	{
		if (checkingUpdates || closing)
		{
			return;
		}
		JsonObject compatibilitySettings = CompatibilityConfiguration();
		long compatibilityRevision = CompatibilityOverridesStore.Revision(compatibilitySettings);
		checkingUpdates = true;
		lastUpdateCheck = DateTimeOffset.Now;
		updateStatus["state"] = "checking";
		updateStatus["reason"] = "正在检查官网入口、实际游戏模块及接口能力；当前对局继续。";
		await SendState();
		try
		{
			try
			{
				CancellationTokenSource cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(24.0));
				try
				{
					Uri origin = CompatibilityGamePageFor(compatibilitySettings);
					string text = await PublicText(origin, cancellation.Token);
					Queue<Uri> queue = CompatibilityModuleQueue(text, origin, compatibilitySettings);
					HashSet<string> seen = new HashSet<string>();
					Uri configuredMain = CompatibilityResourceTargetFor(compatibilitySettings, "resources.mainModule", origin);
					JsonObject prepared = null;
					string hash = "";
					Uri actual = null;
					long checkedBytes = Encoding.UTF8.GetByteCount(text);
					bool flag = default(bool);
					while (true)
					{
						if (queue.Count > 0 && seen.Count < 32)
						{
							Uri uri = queue.Dequeue();
							if (!seen.Add(uri.AbsoluteUri))
							{
								continue;
							}
							string source;
							try
							{
								source = await PublicText(uri, cancellation.Token);
							}
							catch (Exception ex) when (((Func<bool>)delegate
							{
								// Could not convert BlockContainer to single expression
								flag = configuredMain?.AbsoluteUri == uri.AbsoluteUri;
								if (flag)
								{
									flag = ((ex is HttpRequestException || ex is InvalidOperationException) ? true : false);
								}
								return flag;
							}).Invoke())
							{
								updateStatus["manualResourceWarning"] = "手动主模块地址暂不可用，保留当前游戏并继续核对原生公开入口。";
								continue;
							}
							if (!ConfigurationCurrent())
							{
								updateStatus["reason"] = "兼容配置刚刚更新，本次旧配置检查结果已丢弃，将按新配置重新核对。";
								break;
							}
							checkedBytes += Encoding.UTF8.GetByteCount(source);
							if (checkedBytes > 25165824)
							{
								throw new InvalidOperationException("本次部署检查已达24MiB安全范围，保留已加载游戏。");
							}
							hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(source))).ToLowerInvariant();
							JsonObject jsonObject = (await LocalFunction("payload.compatibility.mjs", "((source,options)=>{const {code,modulePatches,...summary}=prepareGameSource(source,options);return summary;})", JsonValue.Create(source), new JsonObject
							{
								["sourceHash"] = hash,
								["compatibilityOverrides"] = compatibilitySettings.DeepClone(),
								["moduleURL"] = uri.AbsoluteUri,
								["moduleSources"] = await PublicModuleSourcesAsync(source, uri, cancellation.Token),
						["originalModuleURL"] = uri.AbsoluteUri
							}))?.AsObject();
							prepared = jsonObject;
							if (!Flag(prepared?["isGame"]))
							{
								JsonArray jsonArray = await PublicCompatibilityModuleReferencesAsync(source, uri, cancellation.Token);
								if (!ConfigurationCurrent())
								{
									updateStatus["reason"] = "兼容配置刚刚更新，本次旧配置检查结果已丢弃，将按新配置重新核对。";
									break;
								}
								foreach (JsonNode item in jsonArray)
								{
									string text2 = Str(item);
									if (text2 != null && Uri.TryCreate(uri, text2, out Uri result) && PublicCompatibilityResourceUri(result, scriptOnly: true) && !seen.Contains(result.AbsoluteUri) && queue.Count < 128)
									{
										queue.Enqueue(result);
									}
								}
								continue;
							}
							hash = Str(prepared["report"]?["sourceHash"]) ?? hash;
							preparedDeploymentHash = hash;
							preparedDeploymentCompatibilityRevision = compatibilityRevision;
							preparedDeploymentModuleUrl = uri.AbsoluteUri;
							preparedDeploymentSummary = prepared.DeepClone().AsObject();
							actual = Uri.TryCreate(Str(prepared["originalGameModuleURL"]), UriKind.Absolute, out var originalApp) ? originalApp : uri;
						}
						if (actual == null || prepared == null)
						{
							throw new InvalidOperationException("官网入口结构尚未识别；当前已连接的游戏不受此检查中断。");
						}
						(string? Version, string Source) deploymentVersion = await PublicDeploymentVersion(origin, actual, prepared, cancellation.Token, compatibilitySettings);
						string runningHash = Str(compatibilityReport?["sourceHash"]) ?? "";
						JsonObject nextResources = resourceHashes.DeepClone().AsObject();
						(string name, string body, string error)[] source2 = await Task.WhenAll(new string[6] { "pokemon", "moves", "items", "abilities", "learnsets", "i18n/zh" }.Select(async delegate(string name)
						{
							try
							{
								Uri uri2 = new Uri(origin, "data/" + name + ".json");
								Uri uri3 = CompatibilityResourceTargetFor(compatibilitySettings, "resources.data." + name.Replace('/', '.'), uri2) ?? uri2;
								return ((string name, string body, string error))(name: name, body: await PublicText(uri3, cancellation.Token), error: null);
							}
							catch (Exception ex4) when (((ex4 is HttpRequestException || ex4 is TaskCanceledException || ex4 is InvalidOperationException) ? 1 : 0) != 0)
							{
								return (name: name, body: "", error: ex4.Message);
							}
						}));
						if (!ConfigurationCurrent())
						{
							updateStatus["reason"] = "兼容配置刚刚更新，本次旧配置检查结果已丢弃，将按新配置重新核对。";
							break;
						}
						bool flag2 = false;
						bool catalogInputsChanged = false;
						foreach (var item2 in source2.Where(((string name, string body, string error) r) => r.error == null))
						{
							string text3 = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(item2.body))).ToLowerInvariant();
							nextResources[item2.name] = text3;
							if (publicOverlayHashes.TryGetValue(item2.name, out string value) && value == text3)
							{
								continue;
							}
							try
							{
								JsonNode jsonNode = JsonNode.Parse(item2.body) ?? throw new JsonException("公开资源为空");
								if (item2.name == "i18n/zh")
								{
									localization = jsonNode.AsObject();
								}
								else
								{
									publicWikiResources[item2.name] = jsonNode;
								}
								publicOverlayHashes[item2.name] = text3;
								catalogInputsChanged = true;
							}
							catch (Exception ex2) when (((ex2 is JsonException || ex2 is InvalidOperationException) ? 1 : 0) != 0)
							{
								flag2 = true;
							}
						}
						bool flag3 = nextResources.Any<KeyValuePair<string, JsonNode>>((KeyValuePair<string, JsonNode> entry) => resourceHashes[entry.Key] != null && Str(resourceHashes[entry.Key]) != Str(entry.Value));
						bool flag4 = runningHash.Length > 0 && (runningHash != hash || flag3);
						resourceHashes = nextResources;
						updateStatus["state"] = ((!Flag(prepared["ok"])) ? "blocked" : (flag4 ? "changed" : "ready"));
						updateStatus["checkedAt"] = DateTimeOffset.Now.ToString("O");
						updateStatus["sourceHash"] = hash;
						updateStatus["sourceUrl"] = actual.AbsoluteUri;
						updateStatus["resourceHashes"] = resourceHashes.DeepClone();
						updateStatus["gameVersion"] = deploymentVersion.Version;
						updateStatus["versionSource"] = deploymentVersion.Source;
						catalogInputsChanged |= Str(publicWikiResources["gameVersion"]) != deploymentVersion.Version;
						if (catalogInputsChanged)
						{
							publicWikiResources["gameVersion"] = updateStatus["gameVersion"]?.DeepClone();
							publicWikiResources["verifiedAt"] = updateStatus["checkedAt"]?.DeepClone();
							publicCatalogGeneration++;
						}
						updateStatus["reason"] = ((!Flag(prepared["ok"])) ? ("官网新部署的核心接口需要适配，现有已加载对局可继续；详情：" + Str(prepared["report"]?["reason"])) : (flag4 ? "发现新部署，将在当前对局结算保存后重新接入并检查能力；新增机制仍待验证。" : "官网部署与当前连接一致。按实际接口继续使用，新增机制不自动视为已验证。"));
						updateStatus["newMechanicsValidated"] = false;
						if (source2.Any(((string name, string body, string error) r) => r.error != null) || flag2)
						{
							updateStatus["resourceWarning"] = "部分公开 JSON 检查未完成或格式变化，保留此前数据；下次继续检查。";
						}
						else
						{
							updateStatus.Remove("resourceWarning");
						}
						if (waitingDeploymentReload && Flag(prepared["ok"]))
						{
							pendingDeploymentHash = hash;
						}
						if (flag4 && Flag(prepared["ok"]) && !waitingDeploymentReload)
						{
							pendingDeploymentHash = hash;
							waitingDeploymentReload = true;
							pendingDeploymentIntentGeneration = intentGeneration;
							pendingDeploymentManualStart = false;
							JsonNode jsonNode2 = JsonNode.Parse(await GameScriptAsync("(()=>{const p=globalThis.__PB_PILOT;if(!p)return null;const a=p.app,r=a?.run;p.deploymentWait=true;return {resume:p.enabled===true&&p.settings.autoRestart!==false&&r?.state!=='paused',manual:!!a&&a.starting!==true&&p.enabled===true&&p.nextRunIntent==='manual'&&(!r||r.state==='over'&&p.manualStartRequested===true)}})()"));
							resumeAfterDeployment = wantedRunIntent && Flag(jsonNode2?["resume"]);
							pendingDeploymentManualStart = Flag(jsonNode2?["manual"]);
							Log("info", "检测到游戏部署更新", "当前对局继续，保存完成后自动重新检查 · " + hash.Substring(0, 12));
						}
						else if (manual)
						{
							Log("info", "更新检测完成", Str(updateStatus["reason"]) ?? "");
						}
						if (catalogInputsChanged)
						{
							synchronizedCatalogHash = "";
						}
						goto end_IL_0141;
					}
				}
				finally
				{
					if (cancellation != null)
					{
						((IDisposable)cancellation).Dispose();
					}
				}
			}
			catch (Exception ex3)
			{
				updateStatus["state"] = "offline";
				updateStatus["checkedAt"] = DateTimeOffset.Now.ToString("O");
				updateStatus["reason"] = "本次官网检查未完成，保留已加载游戏与本地方案：" + ex3.Message;
				if (manual)
				{
					Log("info", "更新检测暂未完成", Str(updateStatus["reason"]) ?? "");
				}
				goto end_IL_0141;
			}
			end_IL_0141:;
		}
		finally
		{
			checkingUpdates = false;
			await SendState();
		}
		bool ConfigurationCurrent()
		{
			return compatibilityRevision == CompatibilityOverridesStore.Revision(CompatibilityConfiguration());
		}
	}

	private async Task UpdateRuntimeCatalogAsync()
	{
		if (synchronizingRuntimeCatalog || DateTimeOffset.UtcNow < catalogRetryAfter || !CompatibilityMayOperate(compatibilityReport))
		{
			return;
		}
		string hash = Str(compatibilityReport?["sourceHash"]) ?? "";
		if (hash == synchronizedCatalogHash)
		{
			return;
		}
		long navigation = pageGeneration;
		long panel = panelGeneration;
		long resourcesGeneration = publicCatalogGeneration;
		WebView2 view = GameView;
		WebView2 controlView = PanelView;
		synchronizingRuntimeCatalog = true;
		try
		{
			JsonObject nextCatalog = new JsonObject(from entry in catalog
				where entry.Key != "encyclopedia"
				select KeyValuePair.Create(entry.Key, entry.Value?.DeepClone()));
			string script = "(()=>{const b=globalThis.__PB_BRIDGE;if(!b)return null;\n" + ControllerSources.ServiceSource(Resource, BrowserSource, "payload.custom-plans.mjs", "payload.compatibility.mjs", "payload.unlock-goals.mjs") + "\nconst definitions=createPlanEditorCatalog(b," + localization.ToJsonString() + ");definitions.unlockGoals=buildUnlockCatalog(b," + Resource("payload.unlock-catalog.json") + ");for(const move of definitions.moves){try{const v=b.moveDef?.(move.id);if(v)for(const k of ['dmg','cd','count','area','speed','dur','pierce','bounce','status','statusChance','drain','critBonus','flinch','weather','buff'])if(v[k]!==undefined)move[k]=v[k]}catch{}}for(const field of ['items','vitamins'])for(const item of definitions[field]){try{const v=b[field]?.get?.(item.key);if(v){for(const k of ['rarity','max','cost','price','stat','per','kind','dice','note'])if(['number','string','boolean'].includes(typeof v[k]))item[k]=v[k];if(typeof v.desc==='string'&&v.desc)item.description=v.desc+(typeof v.note==='string'&&v.note?' '+v.note:'')}}catch{}}const catalog=createCatalogSnapshot(b,{liveBiomes:definitions.maps.filter(m=>m.live).map(m=>m.id)});return {definitions,snapshot:{...catalog,capabilities:b.compatibility.capabilities},contract:b.compatibility};})()";
			JsonObject jsonObject = JsonNode.Parse(await GameScriptAsync(script))?.AsObject();
			JsonNode jsonNode = jsonObject?["definitions"];
			if (jsonNode is JsonObject definitions)
			{
				jsonNode = jsonObject["snapshot"];
				if (jsonNode is JsonObject snapshot)
				{
					string[] array = new string[5] { "moves", "items", "vitamins", "maps", "characters" };
					foreach (string text in array)
					{
						if (!(definitions[text] is JsonArray))
						{
							throw new InvalidOperationException("当前公开目录字段无效：" + text);
						}
					}
					if (!(definitions["planEditorSchema"] is JsonObject) || definitions["maps"].AsArray().Count == 0 || definitions["characters"].AsArray().Count == 0)
					{
						throw new InvalidOperationException("当前公开目录的核心列表或编辑规则未就绪");
					}
					if (!(definitions["unlockGoals"] is JsonObject jsonObject2) || !(jsonObject2["targets"] is JsonArray) || !(jsonObject2["categories"] is JsonArray))
					{
						throw new InvalidOperationException("解锁目标公开目录未就绪，保留此前目录");
					}
					nextCatalog["unlockGoals"] = jsonObject2.DeepClone();
					array = new string[5] { "moves", "items", "vitamins", "maps", "planEditorSchema" };
					foreach (string propertyName in array)
					{
						nextCatalog[propertyName] = definitions[propertyName]?.DeepClone();
					}
					JsonObject[] source = nextCatalog["characters"]?.AsArray().OfType<JsonObject>().ToArray() ?? Array.Empty<JsonObject>();
					JsonArray jsonArray = new JsonArray();
					foreach (JsonObject character in definitions["characters"]?.AsArray().OfType<JsonObject>() ?? Array.Empty<JsonObject>())
					{
						JsonObject jsonObject3 = source.FirstOrDefault((JsonObject c) => Num(c["id"]) == Num(character["id"]))?.DeepClone().AsObject() ?? new JsonObject();
						foreach (KeyValuePair<string, JsonNode> item in character)
						{
							jsonObject3[item.Key] = item.Value?.DeepClone();
						}
						jsonArray.Add(jsonObject3);
					}
					nextCatalog["characters"] = jsonArray;
					nextCatalog["moveNames"] = new JsonObject(from m in definitions["moves"]?.AsArray().OfType<JsonObject>() ?? Array.Empty<JsonObject>()
						where Str(m["key"]) != null
						select KeyValuePair.Create(Str(m["key"]), m["name"]?.DeepClone()));
					nextCatalog["itemNames"] = new JsonObject(from m in definitions["items"]?.AsArray().OfType<JsonObject>() ?? Array.Empty<JsonObject>()
						where Str(m["key"]) != null
						select KeyValuePair.Create(Str(m["key"]), m["name"]?.DeepClone()));
					nextCatalog["currentVerification"] = new JsonObject
					{
						["sourceHash"] = hash,
						["at"] = DateTimeOffset.Now.ToString("O"),
						["newMechanicsValidated"] = false
					};
					bool flag = Str(updateStatus["sourceHash"]) == hash;
					nextCatalog["gameVersion"] = snapshot["gameVersion"]?.DeepClone() ?? ((!flag) ? null : updateStatus["gameVersion"]?.DeepClone());
					snapshot["gameVersion"] = nextCatalog["gameVersion"]?.DeepClone();
					snapshot["versionSource"] = ((!flag) ? null : updateStatus["versionSource"]?.DeepClone());
					nextCatalog["currentVerification"]["gameVersion"] = snapshot["gameVersion"]?.DeepClone();
					definitions["gameVersion"] = nextCatalog["gameVersion"]?.DeepClone();
					definitions["verifiedAt"] = DateTimeOffset.Now.ToString("O");
					definitions["sourceHash"] = hash;
					JsonNode jsonNode2 = JsonNode.Parse(Resource("payload.encyclopedia.json"));
					int minimumEntries = jsonNode2["entries"].AsArray().Count;
					JsonObject jsonObject4 = RequireEncyclopedia(await LocalFunction("payload.encyclopedia.mjs", "buildPublicResourceEncyclopedia", publicWikiResources, localization, jsonNode2), minimumEntries, "公开百科合并");
					JsonObject jsonObject5 = nextCatalog;
					jsonObject5["encyclopedia"] = RequireEncyclopedia(await LocalFunction("payload.encyclopedia.mjs", "buildRuntimeEncyclopedia", definitions, jsonObject4), minimumEntries, "原生百科合并");
					JsonNode comparison = await LocalFunction("payload.compatibility.mjs", "analyzeDeployment", lastCatalogSnapshot, snapshot);
					RequireCurrentCatalog();
					snapshot["resourceHashes"] = resourceHashes.DeepClone();
					string pending = portable.ValidatePath(portable.DataPath("update-state.json.pending"));
					await File.WriteAllTextAsync(pending, snapshot.ToJsonString(JsonOptions));
					RequireCurrentCatalog();
					File.Move(pending, portable.ValidatePath(portable.DataPath("update-state.json")), overwrite: true);
					catalog = nextCatalog;
					updateStatus["catalogWarnings"] = definitions["warnings"]?.DeepClone();
					updateStatus["comparison"] = comparison?.DeepClone();
					updateStatus["features"] = new JsonArray((compatibilityReport?["capabilities"]?.AsObject() ?? new JsonObject()).Select<KeyValuePair<string, JsonNode>, JsonNode>((KeyValuePair<string, JsonNode> entry) => new JsonObject
					{
						["id"] = entry.Key,
						["name"] = FeatureName(entry.Key),
						["state"] = (Flag(entry.Value) ? "ready" : "blocked"),
						["label"] = (Flag(entry.Value) ? "接口可用" : "待适配")
					}).ToArray());
					updateStatus["warnings"] = compatibilityReport?["warnings"]?.DeepClone();
					lastCatalogSnapshot = snapshot.DeepClone().AsObject();
					updateStatus.Remove("catalogWarning");
					catalogRetryAfter = DateTimeOffset.MinValue;
					synchronizedCatalogHash = hash;
					catalogRevision++;
					return;
				}
			}
			throw new InvalidOperationException("当前公开目录没有返回完整定义");
		}
		catch
		{
			catalogRetryAfter = DateTimeOffset.UtcNow.AddSeconds(10.0);
			throw;
		}
		finally
		{
			synchronizingRuntimeCatalog = false;
		}
		void RequireCurrentCatalog()
		{
			if (view != GameView || controlView != PanelView || navigation != pageGeneration || panel != panelGeneration || resourcesGeneration != publicCatalogGeneration || hash != Str(compatibilityReport?["sourceHash"]))
			{
				throw new OperationCanceledException("目录同步期间页面或公开资源已更新，保留已有目录后重试");
			}
		}
	}

	private static JsonObject RequireEncyclopedia(JsonNode? value, int minimumEntries, string phase)
	{
		if (!(value is JsonObject jsonObject) || Num(jsonObject["schemaVersion"]) != 1 || !(jsonObject["entries"] is JsonArray jsonArray) || jsonArray.Count < minimumEntries || !(jsonObject["categories"] is JsonArray { Count: not 0 } jsonArray2) || jsonArray.Any((JsonNode entry) => !(entry is JsonObject) || string.IsNullOrEmpty(Str(entry["id"])) || string.IsNullOrEmpty(Str(entry["category"])) || string.IsNullOrEmpty(Str(entry["name"]))) || jsonArray2.Any((JsonNode entry) => !(entry is JsonObject) || string.IsNullOrEmpty(Str(entry["id"])) || string.IsNullOrEmpty(Str(entry["name"]))))
		{
			throw new InvalidOperationException(phase + "没有返回完整有效百科，已有内容保留，10秒后重试");
		}
		return jsonObject;
	}

	private static string FeatureName(string key)
	{
		return key switch
		{
			"catalog" => "实时目录", 
			"control" => "自动控制", 
			"combat" => "战斗", 
			"objectives" => "目标规划", 
			"quests" => "角色委托", 
			"tasks" => "日常委托", 
			"lab" => "研究所", 
			"itemCatalog" => "道具评分", 
			"vitaminCatalog" => "维生素评分", 
			"moveGuide" => "招式指南", 
			"shiny" => "异色搜寻", 
			"rarity" => "稀有度", 
			_ => key, 
		};
	}

	private async Task ProcessPendingDeploymentAsync()
	{
		if (waitingDeploymentReload)
		{
			string text = Str(game?["state"]);
			if (!wantedRunIntent || text == "paused" || !Flag(config["autoRestart"]))
			{
				resumeAfterDeployment = false;
			}
			if (text != null && text != "over")
			{
				return;
			}
			long decisionIntent = intentGeneration;
			string script = "(()=>{\n" + BrowserSource(Resource("payload.compatibility.mjs")) + "\nreturn (()=>{const p=globalThis.__PB_PILOT,a=globalThis.__PB_BRIDGE?.app;if(!a||!p)return {canReload:false};if(a.starting===true)return {canReload:false,code:'native-start-pending',reason:'等待原生开局完成'};return {...deploymentReloadDecision({hasRun:!!a.run,state:a.run?.state,savePending:p.savePending,pendingSave:a.meta.hasPending(),runAt:p.runStartedAt,events:p.events}),running:p.enabled===true};})();})()";
			JsonNode jsonNode = JsonNode.Parse(await GameScriptAsync(script));
			if (closing || decisionIntent != intentGeneration)
			{
				return;
			}
			if (!Flag(jsonNode?["canReload"]))
			{
				updateStatus["reloadWaitReason"] = jsonNode?["reason"]?.DeepClone();
				return;
			}
			bool num = wantedRunIntent && (intentGeneration != pendingDeploymentIntentGeneration || (pendingDeploymentManualStart && intentGeneration == pendingDeploymentIntentGeneration) || (Flag(config["autoRestart"]) && Flag(jsonNode?["running"])));
			waitingDeploymentReload = false;
			synchronizedCatalogHash = "";
			deploymentNavigationFinished = false;
			updateStatus.Remove("reloadWaitReason");
			if (!num)
			{
				CancelRecoveryIntent("部署更新已就绪，自动连局意图已取消", notifyPage: false);
			}
			RequestRecovery("deployment-update", rebuild: false, reloadGame: true);
		}
		else if (resumeAfterDeployment && deploymentNavigationFinished && pendingDeploymentHash.Length > 0 && CompatibilityMayOperate(compatibilityReport) && Str(compatibilityReport?["sourceHash"]) == pendingDeploymentHash && game?["profile"] != null)
		{
			resumeAfterDeployment = false;
			pendingDeploymentHash = "";
			updateStatus.Remove("reloadWaitReason");
			if (wantedRunIntent)
			{
				RequestRecovery("deployment-ready");
			}
			Log("info", "更新后接口已重新接入", "核心接口检查通过；继续与否由客户端保留的运行意图决定，新增地图和机制仍需单独验证。");
		}
	}

	internal static IEnumerable<string> PortablePublicSettingsKeys()
	{
		return from entry in Defaults()
			select entry.Key into key
			where key != "wecomPush"
			select key;
	}

	private static JsonObject DefaultUnlockTargets()
	{
		return new JsonObject(from key in new string[1] { "all" }.Concat(UnlockCategories)
			select KeyValuePair.Create(key, (JsonNode)JsonValue.Create("auto")));
	}

	private static bool ValidEventId(string? eventId)
	{
		if (eventId != null)
		{
			return Regex.IsMatch(eventId, "^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$", RegexOptions.CultureInvariant);
		}
		return false;
	}

	private static bool EventModeId(string? mode)
	{
		if (mode != null && mode.StartsWith("event:", StringComparison.Ordinal))
		{
			return ValidEventId(mode.Substring(6));
		}
		return false;
	}

	private static string NormalizeMode(string? mode, string? legacyCategory)
	{
		if (mode == "unlocks")
		{
			mode = ((legacyCategory == "maps") ? "map" : (UnlockCategories.Contains<string>(legacyCategory ?? "") ? legacyCategory : "auto"));
		}
		if (mode == "events")
		{
			return "tower";
		}
		if (!ModeIds.Contains<string>(mode) && !EventModeId(mode))
		{
			return "auto";
		}
		return mode;
	}

	private static JsonObject NormalizeEventTargets(JsonNode? value, JsonNode? legacyTarget = null)
	{
		JsonObject jsonObject = new JsonObject();
		if (value is JsonObject jsonObject2)
		{
			foreach (KeyValuePair<string, JsonNode> item in jsonObject2)
			{
				if (ValidEventId(item.Key))
				{
					JsonNode value2 = item.Value;
					string text = ((value2 != null && value2.GetValueKind() == JsonValueKind.String) ? Str(item.Value) : null);
					jsonObject[item.Key] = ((text == "auto" || (text != null && text.Length <= 256 && text.StartsWith("events:" + item.Key + ":", StringComparison.Ordinal) && Regex.IsMatch(text, "^events:[A-Za-z0-9_:.+-]+$", RegexOptions.CultureInvariant))) ? text : "auto");
				}
			}
		}
		string text2 = ((legacyTarget != null && legacyTarget.GetValueKind() == JsonValueKind.String) ? Str(legacyTarget) : null);
		string[] array = text2?.Split(':');
		if (array != null && array.Length >= 3 && array[0] == "events" && ValidEventId(array[1]) && !jsonObject.ContainsKey(array[1]) && text2.Length <= 256 && Regex.IsMatch(text2, "^events:[A-Za-z0-9_:.+-]+$", RegexOptions.CultureInvariant))
		{
			jsonObject[array[1]] = text2;
		}
		return jsonObject;
	}

	private static string ModeRouteKey(string mode, string? leaderboardGoal)
	{
		if (mode == "leaderboard")
		{
			string result;
			bool flag;
			switch (leaderboardGoal)
			{
			case "time":
				result = "leaderboard-time";
				break;
			case "endless":
			case "survival":
				flag = true;
				goto IL_0042;
			default:
				{
					flag = false;
					goto IL_0042;
				}
				IL_0042:
				result = (flag ? "leaderboard-survival" : "leaderboard-kills");
				break;
			}
			return result;
		}
		return mode;
	}

	private static string[] ModeRouteFields(string mode)
	{
		string[] result;
		string[] array2;
		string[] array3;
		string[] array;
		bool flag;
		switch (mode)
		{
		case "tower":
			return new string[4] { "biome", "tier", "exitPolicy", "noCandles" }.Concat(TowerSettings.StrategyFields).ToArray();
		case "mutation":
			result = new string[2] { "target", "afterDailyRewards" };
			break;
		case "wardrobe":
			array2 = new string[5] { "species", "look", "countMode", "countCampStage", "settleOnGoal" };
			goto IL_0192;
		case "appearance":
			array3 = new string[5] { "biome", "tier", "countMode", "countCampStage", "settleOnGoal" };
			goto IL_0190;
		case "allClears":
			array = new string[3] { "species", "biome", "tier" };
			goto IL_018d;
		case "leaderboard-kills":
		case "leaderboard-survival":
		case "endless":
			flag = true;
			goto IL_0151;
		default:
			{
				flag = false;
				goto IL_0151;
			}
			IL_0151:
			array = ((!flag) ? new string[2] { "biome", "tier" } : new string[3] { "biome", "tier", "campStage" });
			goto IL_018d;
			IL_0192:
			result = array2;
			break;
			IL_018d:
			array3 = array;
			goto IL_0190;
			IL_0190:
			array2 = array3;
			goto IL_0192;
		}
		return result;
	}

	private static JsonObject DefaultModeSettings()
	{
		return new JsonObject(ModeIds.Concat(LeaderboardRouteIds).Select(delegate(string mode)
		{
			JsonObject value;
			if (mode == "tower")
			{
				value = TowerSettings.Defaults();
			}
			else
			{
				JsonObject jsonObject2;
				JsonObject jsonObject3;
				JsonObject jsonObject5;
				JsonObject jsonObject4;
				JsonObject jsonObject;
				bool flag;
				switch (mode)
				{
				case "mutation":
					jsonObject2 = new JsonObject
					{
						["target"] = "daily-rewards",
						["afterDailyRewards"] = "wait-next-day"
					};
					break;
				case "wardrobe":
					jsonObject3 = new JsonObject
					{
						["species"] = "auto",
						["look"] = "auto",
						["countMode"] = "auto",
						["countCampStage"] = "auto",
						["settleOnGoal"] = true
					};
					goto IL_02ec;
				case "appearance":
					jsonObject5 = new JsonObject
					{
						["biome"] = "auto",
						["tier"] = "auto",
						["countMode"] = "auto",
						["countCampStage"] = "auto",
						["settleOnGoal"] = true
					};
					goto IL_02e8;
				case "allClears":
					jsonObject4 = new JsonObject
					{
						["species"] = "auto",
						["biome"] = "auto",
						["tier"] = "auto"
					};
					goto IL_02e4;
				case "leaderboard-kills":
					jsonObject = new JsonObject
					{
						["biome"] = "auto",
						["tier"] = "auto",
						["campStage"] = 3
					};
					goto IL_02e0;
				case "leaderboard-survival":
				case "endless":
					flag = true;
					goto IL_0253;
				default:
					{
						flag = false;
						goto IL_0253;
					}
					IL_0253:
					jsonObject = (flag ? new JsonObject
					{
						["biome"] = "auto",
						["tier"] = "auto",
						["campStage"] = "auto"
					} : new JsonObject
					{
						["biome"] = "auto",
						["tier"] = "auto"
					});
					goto IL_02e0;
					IL_02ec:
					jsonObject2 = jsonObject3;
					break;
					IL_02e0:
					jsonObject4 = jsonObject;
					goto IL_02e4;
					IL_02e4:
					jsonObject5 = jsonObject4;
					goto IL_02e8;
					IL_02e8:
					jsonObject3 = jsonObject5;
					goto IL_02ec;
				}
				value = jsonObject2;
			}
			return KeyValuePair.Create(mode, (JsonNode)value);
		}));
	}

	private static void SetModeRouteField(JsonObject route, string field, JsonNode? value)
	{
		if (TowerSettings.StrategyFields.Contains(field))
		{
			TowerSettings.Assign(route, field, value);
			return;
		}
		bool flag = field == "target" && value != null && value.GetValueKind() == JsonValueKind.String;
		bool flag2;
		if (flag)
		{
			string value2 = value.GetValue<string>();
			flag2 = ((value2 == "daily-rewards" || value2 == "leaderboard") ? true : false);
			flag = flag2;
		}
		if (flag)
		{
			route[field] = value.DeepClone();
		}
		flag = field == "afterDailyRewards" && value != null && value.GetValueKind() == JsonValueKind.String;
		if (flag)
		{
			string value2 = value.GetValue<string>();
			flag2 = ((value2 == "wait-next-day" || value2 == "stop") ? true : false);
			flag = flag2;
		}
		if (flag)
		{
			route[field] = value.DeepClone();
		}
		flag = field == "countMode" && value != null && value.GetValueKind() == JsonValueKind.String;
		if (flag)
		{
			switch (value.GetValue<string>())
			{
			case "auto":
			case "standard":
			case "endless":
				flag2 = true;
				break;
			default:
				flag2 = false;
				break;
			}
			flag = flag2;
		}
		if (flag)
		{
			route[field] = value.DeepClone();
		}
		flag = field == "settleOnGoal";
		if (flag)
		{
			JsonValueKind? jsonValueKind = value?.GetValueKind();
			if (jsonValueKind.HasValue)
			{
				JsonValueKind valueOrDefault = jsonValueKind.GetValueOrDefault();
				if (valueOrDefault - 5 <= JsonValueKind.Object)
				{
					flag2 = true;
					goto IL_0180;
				}
			}
			flag2 = false;
			goto IL_0180;
		}
		goto IL_0182;
		IL_0180:
		flag = flag2;
		goto IL_0182;
		IL_0182:
		if (flag)
		{
			route[field] = value.DeepClone();
		}
		if (field == "countCampStage")
		{
			int value3;
			if (value != null && value.GetValueKind() == JsonValueKind.String && value.GetValue<string>() == "auto")
			{
				route[field] = "auto";
			}
			else if (value is JsonValue jsonValue && jsonValue.TryGetValue<int>(out value3) && value3 >= 1 && value3 <= 3)
			{
				route[field] = value3;
			}
		}
		if (field == "species")
		{
			int value4;
			if (value != null && value.GetValueKind() == JsonValueKind.String && value.GetValue<string>() == "auto")
			{
				route[field] = "auto";
			}
			else if (value is JsonValue jsonValue2 && jsonValue2.TryGetValue<int>(out value4) && value4 >= 1 && value4 <= 100000)
			{
				route[field] = value4;
			}
		}
		flag = field == "look" && value != null && value.GetValueKind() == JsonValueKind.String;
		if (flag)
		{
			switch (value.GetValue<string>())
			{
			case "m1":
			case "m2":
			case "l1":
			case "l2":
			case "l3":
			case "t1":
			case "t2":
			case "auto":
			case "shiny":
			case "spectral":
			case "classic":
				flag2 = true;
				break;
			default:
				flag2 = false;
				break;
			}
			flag = flag2;
		}
		if (flag)
		{
			route[field] = value.DeepClone();
		}
		if (field == "biome" && value != null && value.GetValueKind() == JsonValueKind.String && Regex.IsMatch(value.GetValue<string>(), "^(auto|[a-z][a-z0-9_-]{0,47})$"))
		{
			route[field] = value.DeepClone();
		}
		flag = field == "exitPolicy" && value != null && value.GetValueKind() == JsonValueKind.String;
		if (flag)
		{
			string value2 = value.GetValue<string>();
			flag2 = ((value2 == "clear" || value2 == "continue") ? true : false);
			flag = flag2;
		}
		if (flag)
		{
			route[field] = value.DeepClone();
		}
		flag = field == "noCandles";
		if (flag)
		{
			JsonValueKind? jsonValueKind = value?.GetValueKind();
			if (jsonValueKind.HasValue)
			{
				JsonValueKind valueOrDefault = jsonValueKind.GetValueOrDefault();
				if (valueOrDefault - 5 <= JsonValueKind.Object)
				{
					flag2 = true;
					goto IL_0453;
				}
			}
			flag2 = false;
			goto IL_0453;
		}
		goto IL_0455;
		IL_0453:
		flag = flag2;
		goto IL_0455;
		IL_0455:
		if (flag)
		{
			route[field] = value.DeepClone();
		}
		if (field == "campStage")
		{
			int value5;
			if (value != null && value.GetValueKind() == JsonValueKind.String && value.GetValue<string>() == "auto")
			{
				route[field] = "auto";
			}
			else if (value is JsonValue jsonValue3 && jsonValue3.TryGetValue<int>(out value5) && value5 >= 1 && value5 <= 1000)
			{
				route[field] = value5;
			}
		}
		if (!(field != "tier") && value != null)
		{
			double result;
			if (value.GetValueKind() == JsonValueKind.String && value.GetValue<string>() == "auto")
			{
				route[field] = "auto";
			}
			else if (value.GetValueKind() == JsonValueKind.Number && double.TryParse(value.ToJsonString(), NumberStyles.Float, CultureInfo.InvariantCulture, out result) && double.IsFinite(result) && result >= 0.0 && result <= 2.0 && result == Math.Truncate(result))
			{
				route[field] = (int)result;
			}
		}
	}

	private static JsonObject NormalizeModeSettings(JsonNode? value, string? legacyMode = null, JsonNode? legacyBiome = null, JsonNode? legacyTier = null, bool migrateLegacy = false, string? legacyLeaderboardGoal = null, JsonNode? towerTarget = null)
	{
		JsonObject jsonObject = DefaultModeSettings();
		JsonObject stored = value as JsonObject;
		if (stored != null)
		{
			foreach (string item in ModeIds.Concat(LeaderboardRouteIds).Concat(stored.Select<KeyValuePair<string, JsonNode>, string>((KeyValuePair<string, JsonNode> entry) => entry.Key).Where(EventModeId)).Distinct())
			{
				if (stored[item] is JsonObject jsonObject2)
				{
					if (!(jsonObject[item] is JsonObject))
					{
						jsonObject[item] = new JsonObject
						{
							["biome"] = "auto",
							["tier"] = "auto"
						};
					}
					string[] array = ModeRouteFields(item);
					foreach (string text in array)
					{
						SetModeRouteField(jsonObject[item].AsObject(), text, jsonObject2[text]);
					}
				}
			}
			if (!LeaderboardRouteIds.Any((string key) => stored[key] is JsonObject) && stored["leaderboard"] is JsonObject jsonObject3)
			{
				string[] array = new string[2] { "biome", "tier" };
				foreach (string text2 in array)
				{
					SetModeRouteField(jsonObject[ModeRouteKey("leaderboard", legacyLeaderboardGoal)].AsObject(), text2, jsonObject3[text2]);
				}
			}
		}
		else if (migrateLegacy && (ModeIds.Contains<string>(legacyMode) || EventModeId(legacyMode)))
		{
			string[] array = ((!(legacyMode == "leaderboard")) ? new string[1] { legacyMode } : new string[2]
			{
				"leaderboard",
				ModeRouteKey("leaderboard", legacyLeaderboardGoal)
			});
			foreach (string text3 in array)
			{
				if (!(jsonObject[text3] is JsonObject))
				{
					jsonObject[text3] = new JsonObject
					{
						["biome"] = "auto",
						["tier"] = "auto"
					};
				}
				foreach (string item2 in from field in ModeRouteFields(text3)
					where (field == "biome" || field == "tier") ? true : false
					select field)
				{
					SetModeRouteField(jsonObject[text3].AsObject(), item2, (item2 == "biome") ? legacyBiome : legacyTier);
				}
			}
		}
		JsonObject obj = (value as JsonObject)?["tower"] as JsonObject;
		bool flag = (obj == null || !obj.ContainsKey("exitPolicy")) && towerTarget != null && towerTarget.GetValueKind() == JsonValueKind.String;
		if (flag)
		{
			string value2 = towerTarget.GetValue<string>();
			bool flag2 = ((value2 == "events:halloween26:quest:beyond" || value2 == "events:halloween26:quest:abyss") ? true : false);
			flag = flag2;
		}
		if (flag)
		{
			jsonObject["tower"]["exitPolicy"] = "continue";
		}
		return jsonObject;
	}

	private static JsonObject MergeModeSettings(JsonNode? current, JsonObject patch, string? leaderboardGoal = null)
	{
		JsonObject jsonObject = NormalizeModeSettings(current, null, null, null, migrateLegacy: false, leaderboardGoal);
		foreach (string item in ModeIds.Concat(LeaderboardRouteIds).Concat(patch.Select<KeyValuePair<string, JsonNode>, string>((KeyValuePair<string, JsonNode> entry) => entry.Key).Where(EventModeId)).Distinct())
		{
			if (!(patch[item] is JsonObject jsonObject2))
			{
				continue;
			}
			if (!(jsonObject[item] is JsonObject))
			{
				jsonObject[item] = new JsonObject
				{
					["biome"] = "auto",
					["tier"] = "auto"
				};
			}
			string[] array = ModeRouteFields(item);
			foreach (string text in array)
			{
				if (jsonObject2.ContainsKey(text))
				{
					bool flag;
					switch (item)
					{
					case "mutation":
					case "wardrobe":
					case "appearance":
						flag = true;
						break;
					default:
						flag = false;
						break;
					}
					if (flag)
					{
						SetModeRouteField(jsonObject[item].AsObject(), text, jsonObject2[text]);
					}
					else
					{
						jsonObject[item][text] = jsonObject2[text]?.DeepClone();
					}
				}
			}
		}
		return NormalizeModeSettings(jsonObject);
	}

	private static void NormalizeFlightInteractionSettings(JsonObject value, JsonObject? patch = null)
	{
		JsonNode? jsonNode = value["flightNoInteractions"];
		bool flag = jsonNode != null && jsonNode.GetValueKind() == JsonValueKind.True;
		int num;
		if (!value.ContainsKey("flightKeepInteractions"))
		{
			num = ((!flag) ? 1 : 0);
		}
		else
		{
			JsonNode? jsonNode2 = value["flightKeepInteractions"];
			num = ((jsonNode2 != null && jsonNode2.GetValueKind() == JsonValueKind.True) ? 1 : 0);
		}
		bool flag2 = (byte)num != 0;
		if (patch != null && patch["flightNoInteractions"]?.GetValueKind() == JsonValueKind.True)
		{
			flag2 = false;
		}
		else if (patch != null && patch["flightKeepInteractions"]?.GetValueKind() == JsonValueKind.True)
		{
			flag = false;
		}
		else if (flag)
		{
			flag2 = false;
		}
		value["flightNoInteractions"] = flag;
		value["flightKeepInteractions"] = flag2;
	}

	private static JsonObject Defaults()
	{
		JsonObject jsonObject = new JsonObject();
		jsonObject["mode"] = "auto";
		jsonObject["characterId"] = null;
		jsonObject["biome"] = "auto";
		jsonObject["tier"] = 0;
		jsonObject["build"] = "auto";
		jsonObject["autoUpgrade"] = false;
		jsonObject["autoUnlockItems"] = false;
		jsonObject["pickup"] = true;
		jsonObject["autoClaim"] = false;
		jsonObject["safeMode"] = false;
		jsonObject["bossPriority"] = false;
		jsonObject["portalPriority"] = false;
		jsonObject["shopPriority"] = false;
		jsonObject["shinyPriority"] = true;
		jsonObject["capturePriority"] = true;
		jsonObject["jumpMove"] = false;
		jsonObject["slideMove"] = false;
		jsonObject["bossRetreat"] = false;
		jsonObject["flightMove"] = false;
		jsonObject["flightJumpItemCount"] = 5;
		jsonObject["flightNoInteractions"] = false;
		jsonObject["flightKeepInteractions"] = true;
		jsonObject["riskyInteractions"] = true;
		jsonObject["forceCostInteractions"] = false;
		jsonObject["costEffectPriorities"] = CostSettings.EmptyPriorities();
		jsonObject["noInteractionsAfter"] = false;
		jsonObject["noInteractionsAfterSeconds"] = 600;
		jsonObject["fullMapOrbit"] = false;
		jsonObject["fullMapOrbitAfterSeconds"] = 600;
		jsonObject["hotkeyToggle"] = "F8";
		jsonObject["hotkeyStop"] = "F9";
		jsonObject["hotkeyReleaseMouse"] = "F10";
		jsonObject["autoRestart"] = true;
		jsonObject["reserveMoveSlot"] = false;
		jsonObject["fps"] = 60;
		jsonObject["leaderboardGoal"] = "kills";
		jsonObject["autoManageBuildPriority"] = false;
		jsonObject["logRetentionRuns"] = 100;
		jsonObject["convenience"] = ConvenienceSettings.Defaults();
		jsonObject["display"] = DisplaySettings.Defaults();
		jsonObject["randomDelay"] = true;
		jsonObject["randomDelayMinMs"] = 600;
		jsonObject["randomDelayMaxMs"] = 1800;
		jsonObject["shinyMode"] = "missing";
		jsonObject["shinyTypes"] = new JsonArray("shiny", "classic");
		jsonObject["shinyTargetId"] = null;
		jsonObject["shinyStopWhenDone"] = true;
		jsonObject["shinyUseStone"] = false;
		jsonObject["shinyStageWait"] = false;
		jsonObject["shinyStageWaitSeconds"] = 600;
		jsonObject["shinyStayAfterFinalClear"] = false;
		jsonObject["pickupBonkoin"] = true;
		jsonObject["expandVitaminSlots"] = true;
		jsonObject["unlockCategory"] = "all";
		jsonObject["unlockTargets"] = DefaultUnlockTargets();
		jsonObject["eventTargets"] = new JsonObject();
		jsonObject["modeSettings"] = DefaultModeSettings();
		jsonObject["finalReplacements"] = new JsonObject();
		jsonObject["wecomPush"] = new JsonObject
		{
			["schemaVersion"] = 1,
			["enabled"] = false,
			["items"] = new JsonObject()
		};
		jsonObject["overlay"] = OverlaySettings.Defaults();
		return jsonObject;
	}

	public MainWindow(string[] args, PortableStorage storagePaths, PrerequisiteService prerequisiteService)
	{
		InitializeComponent();
		base.Title = $"PokéBonk 旅伴 V{ClientVersion} · 旧常规地图离线候选 · 游戏快照 0.9.8 · 实战待验";
		base.Width = Math.Max(base.MinWidth, Math.Min(1600.0, SystemParameters.WorkArea.Width));
		base.Height = Math.Max(base.MinHeight, Math.Min(1080.0, SystemParameters.WorkArea.Height));
		prerequisites = prerequisiteService;
		launchArguments = args;
		prerequisites.Changed += OnPrerequisitesChanged;
		base.Closed += delegate
		{
			prerequisites.Changed -= OnPrerequisitesChanged;
			StopConvenienceSound(clearEvents: true);
			CloseRestReminderWindow();
		};
		smoke = args.Contains("--smoke");
		autoGuestEntry = smoke && args.Contains("--guest");
		diagnostics = smoke || args.Contains("--diagnostics");
		portable = storagePaths;
		battleReportArchive = new BattleReportArchive(portable);
		battleRecordWriter = new BattleRecordWriter(portable);
		storage = portable.DataDirectory;
		ReadCustomPlans();
		ReadUpdateCache();
		try
		{
			if (File.Exists(portable.ValidatePath(portable.SettingsPath)))
			{
				JsonObject jsonObject = (JsonNode.Parse(File.ReadAllText(portable.ValidatePath(portable.SettingsPath))) as JsonObject) ?? throw new JsonException("设置不是JSON对象");
				foreach (KeyValuePair<string, JsonNode> item in jsonObject)
				{
					if (!config.ContainsKey(item.Key))
					{
						continue;
					}
					if (item.Key == "unlockTargets" && item.Value is JsonObject jsonObject2)
					{
						unlockTargetsMigrated = jsonObject2.ContainsKey("shiny");
					}
					JsonNode jsonNode = config[item.Key];
					JsonValueKind? jsonValueKind = jsonNode?.GetValueKind();
					bool flag;
					if (jsonValueKind.HasValue)
					{
						JsonValueKind valueOrDefault = jsonValueKind.GetValueOrDefault();
						if (valueOrDefault - 5 <= JsonValueKind.Object)
						{
							flag = true;
							goto IL_0716;
						}
					}
					flag = false;
					goto IL_0716;
					IL_0716:
					bool flag2 = flag;
					if (jsonNode == null)
					{
						flag = item.Value == null || int.TryParse(item.Value.ToJsonString(), out var _);
						goto IL_07d4;
					}
					bool flag3;
					if (flag2)
					{
						jsonValueKind = item.Value?.GetValueKind();
						if (jsonValueKind.HasValue)
						{
							JsonValueKind valueOrDefault = jsonValueKind.GetValueOrDefault();
							if (valueOrDefault - 5 <= JsonValueKind.Object)
							{
								flag3 = true;
								goto IL_078d;
							}
						}
						flag3 = false;
						goto IL_078d;
					}
					bool flag4 = jsonNode.GetValueKind() == item.Value?.GetValueKind();
					goto IL_07d0;
					IL_07d4:
					if (flag)
					{
						config[item.Key] = item.Value?.DeepClone();
					}
					continue;
					IL_078d:
					flag4 = flag3;
					goto IL_07d0;
					IL_07d0:
					flag = flag4;
					goto IL_07d4;
				}
				if (jsonObject.ContainsKey("flightKeepInteractions"))
				{
					config["flightKeepInteractions"] = jsonObject["flightKeepInteractions"]?.DeepClone();
				}
				else
				{
					config.Remove("flightKeepInteractions");
				}
				JsonNode? jsonNode2 = jsonObject["mode"];
				string text = ((jsonNode2 != null && jsonNode2.GetValueKind() == JsonValueKind.String) ? Str(jsonObject["mode"]) : null);
				object obj;
				if (!(text == "events"))
				{
					JsonNode? jsonNode3 = jsonObject["unlockCategory"];
					obj = NormalizeMode(text, (jsonNode3 != null && jsonNode3.GetValueKind() == JsonValueKind.String) ? Str(jsonObject["unlockCategory"]) : null);
				}
				else
				{
					obj = "events";
				}
				string legacyMode = (string)obj;
				JsonObject jsonObject3 = config;
				JsonNode? value = jsonObject["modeSettings"];
				JsonNode? legacyBiome = jsonObject["biome"];
				JsonNode? legacyTier = jsonObject["tier"];
				bool migrateLegacy = !jsonObject.ContainsKey("modeSettings");
				JsonNode? jsonNode4 = jsonObject["leaderboardGoal"];
				jsonObject3["modeSettings"] = NormalizeModeSettings(value, legacyMode, legacyBiome, legacyTier, migrateLegacy, (jsonNode4 != null && jsonNode4.GetValueKind() == JsonValueKind.String) ? Str(jsonObject["leaderboardGoal"]) : null, (jsonObject["eventTargets"] as JsonObject)?["halloween26"] ?? (jsonObject["unlockTargets"] as JsonObject)?["events"]);
				config["convenience"] = ConvenienceSettings.Normalize(jsonObject["convenience"], jsonObject);
			}
			ValidateConfig();
			config["wecomPush"] = WecomSettings.Normalize(config["wecomPush"]);
		}
		catch (JsonException)
		{
			Log("error", "设置格式无效", "已使用默认设置；原设置文件保留在程序的 data 目录。");
		}
		LoadLogHistory();
		ConfigureRecoveryLogin();
		base.Loaded += async delegate
		{
			await Initialize();
		};
		base.ContentRendered += delegate
		{
			ShowLaunchDisclaimer();
		};
		base.Closed += delegate
		{
			browserExecutionPower.Dispose();
		};
		timer.Tick += async delegate
		{
			await Tick();
		};
		base.Closing += async delegate(object? _, CancelEventArgs e)
		{
			if (!mayClose)
			{
				e.Cancel = true;
				if (!closing)
				{
					CloseRestReminderWindow();
					CancelRecoveryIntent("客户端关闭");
					StopConvenienceSound(clearEvents: true);
					StopWecom("客户端关闭，已取消未提交推送");
					closing = true;
					status = "正在结算并保存对局，请稍候…";
					await SendState();
					try
					{
						if (ready && !gameProcessFailed)
						{
							await GameScriptAsync("globalThis.__PB_START_TICKET=null;globalThis.__PB_CLOSING_DONE=false;(async()=>{try{const p=globalThis.__PB_PILOT,a=globalThis.__PB_BRIDGE?.app;p?.stop('客户端关闭');if(!a?.meta?.account){globalThis.__PB_CLOSE_SAVED=true;return}const r=a.run;if(r&&r.state!=='over')await r.finish(false,true);if(p?.savePromise)await p.savePromise;globalThis.__PB_CLOSE_SAVED=!p?.savePending&&!a.meta.hasPending();}catch(e){globalThis.__PB_CLOSE_SAVED=false}finally{globalThis.__PB_CLOSING_DONE=true}})()");
							for (int i = 0; i < 24; i++)
							{
								if (await GameScriptAsync("globalThis.__PB_CLOSING_DONE") == "true")
								{
									break;
								}
								await Task.Delay(500);
							}
							string saved = await GameScriptAsync("globalThis.__PB_CLOSE_SAVED===true");
							ObserveLogSnapshotAtClose(JsonNode.Parse(await GameScriptAsync("globalThis.__PB_PILOT?.snapshot() ?? null"))?.AsObject());
							await UpdateVerifiedClearsAsync(allowClosing: true);
							Log((saved == "true") ? "info" : "error", (saved == "true") ? "客户端关闭" : "关闭时未确认同步完成", (saved == "true") ? "游戏结算流程已结束。" : "服务器未确认保存，重新打开客户端后请检查游戏待同步记录。");
						}
						else if (gameProcessFailed)
						{
							Log("error", "关闭时未确认同步完成", "游戏浏览器进程已经退出，跳过无法响应的保存脚本。未取得新的服务器保存确认，重新打开后请检查游戏待同步记录。");
						}
					}
					catch (Exception ex2)
					{
						try
						{
							Log("error", "关闭时未确认同步完成", "游戏进程或连接不可用，未取得服务器保存确认。重新打开后请检查游戏待同步记录。" + ex2.Message);
						}
						catch
						{
						}
					}
					timer.Stop();
					mayClose = true;
					_ = base.Dispatcher.BeginInvoke(new Action(base.Close), DispatcherPriority.ContextIdle);
				}
			}
		};
	}

	private void ShowLaunchDisclaimer()
	{
		if (!disclaimerShownThisLaunch && !closing && base.IsVisible)
		{
			disclaimerShownThisLaunch = true;
			new DisclaimerWindow(this).ShowDialog();
			ShowLaunchBrowserOptimization();
		}
	}

	private static string Resource(string name)
	{
		using Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(name) ?? throw new FileNotFoundException("缺少客户端资源：" + name);
		using StreamReader streamReader = new StreamReader(stream);
		return streamReader.ReadToEnd();
	}

	private string Bundle(bool reload = false)
	{
		IReadOnlyList<ControllerSource> readOnlyList = ControllerSources.Read(Resource);
		string text = readOnlyList.Single((ControllerSource s) => s.Name == "player-overlay").Text;
		string text2 = readOnlyList.Single((ControllerSource s) => s.Name == "player-convenience").Text;
		JsonObject jsonObject = new JsonObject
		{
			["autoStart"] = false,
			["embedded"] = true,
			["compatibilityOverrides"] = CompatibilityConfiguration(),
			["characterUnlockImplementation"] = "legacy160",
			["hotReload"] = reload,
			["settings"] = PilotSettings(),
			["builds"] = catalog["builds"]?.DeepClone() ?? new JsonArray(),
			["shinyCatalog"] = shinyCatalog.DeepClone(),
			["unlockCatalog"] = catalog["unlockGoals"]?.DeepClone() ?? JsonNode.Parse(Resource("payload.unlock-catalog.json")),
			["revision"] = ControllerSources.Revision(readOnlyList, Resource("payload.controller-sources.json"))
		};
		return "(()=>{if(location.hostname!=='pokebonk.com')return;\nglobalThis.__PB_COMPAT_CONFIG=" + CompatibilityConfiguration().ToJsonString() + ";\n" + ControllerSources.SharedSource(readOnlyList, BrowserSource) + "\n" + BrowserSource(Resource("payload.player-skins.mjs")) + "\ninstallPilot(" + jsonObject.ToJsonString() + ");installPlayerSkins({hotReload:" + (reload ? "true" : "false") + "});(()=>{\n" + BrowserSource(text) + "\ninstallPlayerOverlay(()=>({run:globalThis.__PB_BRIDGE?.app?.run,bridge:globalThis.__PB_BRIDGE})," + OverlaySettings.Normalize(config["overlay"]).ToJsonString() + ");})();(()=>{\n" + BrowserSource(text2) + "\ninstallPlayerConvenience(()=>({run:globalThis.__PB_BRIDGE?.app?.run,bridge:globalThis.__PB_BRIDGE,pilot:globalThis.__PB_PILOT})," + ConvenienceSettings.Normalize(config["convenience"]).ToJsonString() + ",{builds:globalThis.__PB_PILOT?.builds??[]});})();})();";
	}

	private async Task Initialize(bool recovering = false, CancellationToken cancellation = default(CancellationToken))
	{
		WebView2 gameView = GameView;
		WebView2 panelView = PanelView;
		long startupRevision = browserStartup.Begin(gameView, panelView, pageGeneration);
		try
		{
			try
			{
				catalog = JsonNode.Parse(Resource("payload.catalog.json")).AsObject();
			}
			catch
			{
			}
			shinyCatalog = JsonNode.Parse(Resource("payload.shiny-catalog.json")).AsObject();
			catalog["encyclopedia"] = JsonNode.Parse(Resource("payload.encyclopedia.json"));
			catalog["unlockGoals"] = JsonNode.Parse(Resource("payload.unlock-catalog.json"));
			catalog["costEffects"] = CostSettings.Catalog();
			catalog["shinyTargets"] = new JsonArray(shinyCatalog["species"].AsArray().OfType<JsonObject>().Select((Func<JsonObject, JsonNode>)delegate(JsonObject entry)
			{
				JsonObject jsonObject = entry.DeepClone().AsObject();
				JsonObject[] array = entry["sources"].AsArray().OfType<JsonObject>().ToArray();
				JsonNode[] items = (from id in array.Select((JsonObject s) => Str(s["biome"])).Distinct()
					select JsonValue.Create(id)).ToArray();
				jsonObject["maps"] = new JsonArray(items);
				jsonObject["availability"] = (Flag(entry["reachable"]) ? "available" : ((array.Length != 0) ? "unreleased" : "unavailable"));
				jsonObject["huntable"] = Flag(entry["reachable"]);
				jsonObject["reason"] = entry["note"]?.DeepClone();
				return jsonObject;
			})
				.ToArray());
			string assetDir = portable.EnsureDirectory(Path.Combine(portable.UiDirectory, ClientVersion));
			foreach (string item in from n in Assembly.GetExecutingAssembly().GetManifestResourceNames()
				where n.Contains(".ui.")
				select n)
			{
				string path = item.Substring(item.IndexOf(".ui.", StringComparison.Ordinal) + 4);
				File.WriteAllText(portable.ValidatePath(Path.Combine(assetDir, path)), Resource(item));
			}
			Stage("创建浏览器环境");
			CoreWebView2EnvironmentOptions options = new CoreWebView2EnvironmentOptions(Program.BrowserArguments)
			{
				ExclusiveUserDataFolderAccess = true
			};
			CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, portable.ValidatePath(portable.BrowserDirectory), options).WaitAsync(TimeSpan.FromSeconds(25.0), cancellation);
			RequireCurrent();
			browserEnvironment = env;
			portable.RequireBrowserDirectory(env.UserDataFolder);
			browserFailureReports = env.FailureReportFolderPath;
			if (!string.IsNullOrWhiteSpace(browserFailureReports))
			{
				portable.ValidatePath(browserFailureReports);
			}
			Stage("初始化游戏浏览器");
			await gameView.EnsureCoreWebView2Async(env).WaitAsync(TimeSpan.FromSeconds(25.0), cancellation);
			RequireCurrent();
			Stage("初始化控制面板浏览器");
			await panelView.EnsureCoreWebView2Async(env).WaitAsync(TimeSpan.FromSeconds(25.0), cancellation);
			RequireCurrent();
			gameView.CoreWebView2.ProcessFailed += delegate(object? _, CoreWebView2ProcessFailedEventArgs e)
			{
				if (gameView == GameView)
				{
					RetirePublicGameDialogs();
					HandleBrowserFailure(e, panel: false);
				}
			};
			panelView.CoreWebView2.ProcessFailed += delegate(object? _, CoreWebView2ProcessFailedEventArgs e)
			{
				if (panelView == PanelView)
				{
					HandleBrowserFailure(e, panel: true);
				}
			};
			BindPortableDownloads(gameView.CoreWebView2);
			BindPortableDownloads(panelView.CoreWebView2);
			gameView.CoreWebView2.WebMessageReceived += delegate(object? _, CoreWebView2WebMessageReceivedEventArgs e)
			{
				if (gameView != GameView || !e.Source.StartsWith("https://pokebonk.com/", StringComparison.OrdinalIgnoreCase))
				{
					return;
				}
				try
				{
					JsonNode jsonNode = JsonNode.Parse(e.WebMessageAsJson);
					if (Str(jsonNode?["kind"]) == "battleRecords" && jsonNode?["batch"] is JsonObject batch)
						_ = PersistBattleRecordsAsync(batch, gameView);
					if (Str(jsonNode?["kind"]) == "pilotControl" && jsonNode?["control"] is JsonObject control)
					{
						ObservePilotControlMessage(control);
					}
					if (Str(jsonNode?["kind"]) == "pilotHotkey")
					{
						string text = HotkeyAction(Str(jsonNode?["key"]));
						if (text != null)
						{
							QueueHotkey(text);
						}
					}
					ObserveConvenienceMessage(jsonNode);
				}
				catch
				{
				}
			};
			RegisterPublicGameDialogs(gameView.CoreWebView2);
			gameView.CoreWebView2.Settings.IsStatusBarEnabled = false;
			gameView.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = false;
			gameView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
			gameView.CoreWebView2.Settings.IsGeneralAutofillEnabled = false;
			gameView.CoreWebView2.Settings.IsPasswordAutosaveEnabled = false;
			panelView.CoreWebView2.Settings.IsStatusBarEnabled = false;
			panelView.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = false;
			panelView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
			if (Program.BrowserOptimizationEnabledAtLaunch)
			{
				ApplyBrowserMemoryTarget();
			}
			panelView.CoreWebView2.NewWindowRequested += delegate(object? _, CoreWebView2NewWindowRequestedEventArgs e)
			{
				e.Handled = true;
			};
			panelView.CoreWebView2.SetVirtualHostNameToFolderMapping("pilot.local", assetDir, CoreWebView2HostResourceAccessKind.DenyCors);
			Stage("注册控制面板接口");
			await panelView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync("(()=>{if(location.hostname!=='pilot.local')return;const pending=new Map(),handlers={state:new Set(),log:new Set()};let sequence=0,keys={hotkeyToggle:'F8',hotkeyStop:'F9',hotkeyReleaseMouse:'F10'};\r\nchrome.webview.addEventListener('message',({data:m})=>{if(m.event){if(m.event==='state'&&m.data?.config)keys={...keys,...m.data.config};for(const f of handlers[m.event]||[])f(m.data);return}const p=pending.get(m.id);if(!p)return;clearTimeout(p.timer);pending.delete(m.id);m.ok?p.resolve(m.data):p.reject(Error(m.error))});\r\nconst request=(action,payload={})=>new Promise((resolve,reject)=>{const id=++sequence;const interactive=action==='installPrerequisites'||action==='importCustomPlanFile'||action==='exportCustomPlans'&&payload.chooseFile||['importSkin','exportSkin','saveSkinPrompt'].includes(action);const timer=interactive?null:setTimeout(()=>{pending.delete(id);reject(Error('客户端响应超时，请重试'))},action==='exportLogs'?120000:action==='wecomTest'||action==='probeCompatibility'?90000:35000);pending.set(id,{resolve,reject,timer});chrome.webview.postMessage({id,action,payload})});\r\nwindow.desktop=Object.freeze({getState:()=>request('getState'),getCatalog:()=>request('getCatalog'),command:request,onState:f=>{handlers.state.add(f);return()=>handlers.state.delete(f)},onLog:f=>{handlers.log.add(f);return()=>handlers.log.delete(f)}});\r\naddEventListener('keydown',e=>{if(e.isTrusted!==true||e.isComposing||e.target?.closest?.('input,textarea,select,[contenteditable=\"true\"],[data-hotkey-capture]'))return;const chord=[e.ctrlKey?'Ctrl':null,e.altKey?'Alt':null,e.shiftKey?'Shift':null,e.code].filter(Boolean).join('+');const action=chord===keys.hotkeyToggle?'toggle':chord===keys.hotkeyStop?'pause':chord===keys.hotkeyReleaseMouse?'releaseMouse':null;if(!action)return;e.preventDefault();e.stopImmediatePropagation();if(!e.repeat)request(action).catch(()=>{})},true);\r\n})()").WaitAsync(TimeSpan.FromSeconds(8.0), cancellation);
			RequireCurrent();
			panelView.CoreWebView2.WebMessageReceived += OnMessage;
			panelView.CoreWebView2.NavigationStarting += delegate(object? _, CoreWebView2NavigationStartingEventArgs e)
			{
				if (!e.Uri.StartsWith("https://pilot.local/", StringComparison.OrdinalIgnoreCase))
				{
					e.Cancel = true;
				}
				else if (panelView == PanelView && !closing)
				{
					panelGeneration++;
					uiReady = false;
					activePanelNavigationId = e.NavigationId;
					panelNavigationError = "";
				}
			};
			panelView.CoreWebView2.NavigationCompleted += async delegate(object? _, CoreWebView2NavigationCompletedEventArgs e)
			{
				if (panelView == PanelView && !closing && IsCurrentGameNavigation(activePanelNavigationId, e.NavigationId))
				{
					uiReady = e.IsSuccess;
					panelNavigationError = (e.IsSuccess ? "" : ("控制面板加载失败：" + e.WebErrorStatus));
					await SendState();
				}
			};
			gameView.CoreWebView2.NavigationStarting += delegate(object? _, CoreWebView2NavigationStartingEventArgs e)
			{
				if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out Uri result) || result.Scheme != "https" || (!(result.Host == "pokebonk.com") && !result.Host.EndsWith(".pokebonk.com")))
				{
					e.Cancel = true;
				}
				else if (gameView == GameView)
				{
					ObservePublicReloadNavigation(gameView.CoreWebView2, e);
					browserStartup.Navigating(gameView);
					BeginGameNavigation(e.NavigationId);
					WecomOnPageChanged();
					gameProcessFailed = false;
					gameNavigationAt = DateTimeOffset.Now;
					gameModuleObserved = false;
					compatibility = "";
					compatibilityReport = null;
					latestPreparedCompatibility = null;
					observedCompatibilityMainUrl = (observedCompatibilityNewsUrl = null);
				}
			};
			gameView.CoreWebView2.NavigationCompleted += delegate(object? _, CoreWebView2NavigationCompletedEventArgs e)
			{
				if (gameView == GameView && !gameProcessFailed && !closing && IsCurrentGameNavigation(activeGameNavigationId, e.NavigationId))
				{
					RetirePublicGameDialogs();
					if (pendingDeploymentHash.Length > 0 && !waitingDeploymentReload)
					{
						deploymentNavigationFinished = e.IsSuccess;
					}
					if (e.IsSuccess && Uri.TryCreate(gameView.CoreWebView2.Source, UriKind.Absolute, out Uri result) && ValidCompatibilityGamePage(result))
					{
						RecordCompatibilityResourceReceipt("resources.gamePage", result);
					}
					if (!e.IsSuccess)
					{
						SetCompatibilityError("游戏页面加载失败，正在等待自动重连。", "navigation-failed");
						RequestRecovery("navigation-failed", rebuild: false, reloadGame: true);
					}
				}
			};
			gameView.CoreWebView2.NewWindowRequested += delegate(object? _, CoreWebView2NewWindowRequestedEventArgs e)
			{
				e.Handled = true;
			};
			Stage("注册游戏控制器");
			await RefreshInitializationScriptAsync(cancellation);
			RequireCurrent();
			uiReady = false;
			activePanelNavigationId = null;
			panelNavigationError = "";
			Stage("加载控制面板");
			panelView.Source = new Uri("https://pilot.local/index.html");
			await WaitForPanelReadyAsync(panelView, cancellation);
			Stage("准备方案与本地目录");
			await InitializeCustomization();
			RequireCurrent();
			Stage("配置游戏接入");
			await ConfigureGameConnectionAsync(gameView, cancellation);
			RequireCurrent();
			Stage("打开游戏网页");
			browserStartup.Navigating(gameView);
			gameView.Source = CompatibilityGamePage;
			browserStartup.Complete(gameView, panelView, startupRevision);
			ready = true;
			timer.Start();
			RefreshWecomRuntimeAsync();
			CheckForUpdatesAsync(manual: false);
			if (!recovering)
			{
				Log("info", "客户端已就绪", "在上方选择游客或登录账号，然后在下方选择模式和角色，点击开始挂机。");
			}
		}
		catch (WebView2RuntimeNotFoundException)
		{
			if (recovering)
			{
				throw;
			}
			await prerequisites.InspectAsync();
			((App)Application.Current).ShowPrerequisites(launchArguments, prerequisites);
		}
		catch (OperationCanceledException) when (cancellation.IsCancellationRequested || closing || gameView != GameView || panelView != PanelView || !browserStartup.Current(gameView, panelView, startupRevision))
		{
			if (recovering)
			{
				throw;
			}
		}
		catch (Exception ex3)
		{
			if (!browserStartup.Current(gameView, panelView, startupRevision))
			{
				if (recovering)
				{
					throw;
				}
				return;
			}
			browserStartup.Fail(gameView, panelView, startupRevision);
			Exception ex4 = ((ex3 is TimeoutException) ? new TimeoutException("启动阶段“" + browserStartup.Stage + "”超时；将按当前阶段安全重试。", ex3) : ex3);
			if (recovering)
			{
				throw ex4;
			}
			ReportOperationError(ex4, "启动暂未完成");
			ready = true;
			timer.Start();
			RefreshWecomRuntimeAsync();
			RequestRecovery("startup-failed", rebuild: true, reloadGame: true);
		}
		void RequireCurrent()
		{
			cancellation.ThrowIfCancellationRequested();
			if (closing || gameView != GameView || panelView != PanelView || !browserStartup.Current(gameView, panelView, startupRevision))
			{
				throw new OperationCanceledException("浏览器初始化实例已变化");
			}
		}
		void Stage(string name)
		{
			RequireCurrent();
			browserStartup.At(gameView, panelView, startupRevision, name);
		}
	}

	private void SetCompatibilityError(string message, string code)
	{
		if (!(compatibility == message))
		{
			compatibility = (status = message);
			if (compatibilityReport == null)
			{
				compatibilityReport = new JsonObject();
			}
			compatibilityReport["state"] = "blocked";
			compatibilityReport["code"] = code;
			compatibilityReport["reason"] = message;
			Log("error", "游戏接入未完成", message);
		}
	}

	private async Task RefreshInitializationScriptAsync(CancellationToken token = default(CancellationToken))
	{
		token.ThrowIfCancellationRequested();
		WebView2 view = GameView;
		CoreWebView2 core = view.CoreWebView2 ?? throw new InvalidOperationException("游戏浏览器尚未就绪");
		long revision = ++initScriptRevision;
		Task<string> pending = core.AddScriptToExecuteOnDocumentCreatedAsync(Bundle());
		string id;
		try
		{
			id = await pending.WaitAsync(TimeSpan.FromSeconds(8.0), token);
		}
		catch
		{
			RemoveLateInitializationScriptAsync(core, pending);
			throw;
		}
		if (closing || token.IsCancellationRequested || view != GameView || core != GameView.CoreWebView2 || revision != initScriptRevision)
		{
			try
			{
				core.RemoveScriptToExecuteOnDocumentCreated(id);
			}
			catch
			{
			}
			throw new OperationCanceledException("游戏浏览器或设置准备已变化，已丢弃旧初始化脚本");
		}
		string text = ((initScriptOwner == core) ? initScriptId : "");
		initScriptOwner = core;
		initScriptId = id;
		if (text.Length > 0)
		{
			core.RemoveScriptToExecuteOnDocumentCreated(text);
		}
	}

	private static async Task RemoveLateInitializationScriptAsync(CoreWebView2 core, Task<string> pending)
	{
		try
		{
			core.RemoveScriptToExecuteOnDocumentCreated(await pending);
		}
		catch
		{
		}
	}

	private void BindPortableDownloads(CoreWebView2 webView)
	{
		webView.DownloadStarting += delegate(object? _, CoreWebView2DownloadStartingEventArgs e)
		{
			try
			{
				string path = portable.EnsureDirectory(portable.DataPath("downloads"));
				string text = Path.GetFileName(e.ResultFilePath);
				if (string.IsNullOrWhiteSpace(text))
				{
					text = "download.bin";
				}
				e.ResultFilePath = portable.ValidatePath(Path.Combine(path, text));
				e.Handled = true;
				Log("info", "下载已安排", "文件将保存在程序的 data/downloads 目录：" + text);
			}
			catch (Exception ex)
			{
				e.Cancel = true;
				e.Handled = true;
				Log("error", "下载未开始", ex.Message);
			}
		};
	}

	private void ShowLogDocument()
	{
		string text = File.ReadAllText(portable.ValidatePath(portable.ReadableLogPath), Encoding.UTF8);
		if (logDocumentWindow == null)
		{
			logDocumentText = new TextBox
			{
				IsReadOnly = true,
				AcceptsReturn = true,
				TextWrapping = TextWrapping.Wrap,
				VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
				Margin = new Thickness(16.0),
				FontSize = 14.0,
				Text = text
			};
			logDocumentWindow = new Window
			{
				Title = Path.GetFileName(portable.ReadableLogPath) + " · 程序同目录日志",
				Owner = this,
				Width = 880.0,
				Height = 640.0,
				MinWidth = 500.0,
				MinHeight = 350.0,
				ShowActivated = base.ShowActivated,
				WindowStartupLocation = WindowStartupLocation.CenterOwner,
				Content = logDocumentText
			};
			logDocumentWindow.Closed += delegate
			{
				logDocumentWindow = null;
				logDocumentText = null;
			};
			logDocumentWindow.Show();
		}
		else
		{
			logDocumentText.Text = text;
			if (base.ShowActivated)
			{
				logDocumentWindow.Activate();
			}
		}
	}

	private static string? Str(JsonNode? node)
	{
		return node?.GetValue<string>();
	}

	private static int Num(JsonNode? node)
	{
		if (node != null)
		{
			if (!double.TryParse(node.ToJsonString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var result))
			{
				return 0;
			}
			return (int)result;
		}
		return 0;
	}

	private static bool Flag(JsonNode? node)
	{
		return node?.GetValue<bool>() ?? false;
	}

	private async Task Tick()
	{
		if (!ready || ticking || closing)
		{
			return;
		}
		ticking = true;
		long tickStarted = Stopwatch.GetTimestamp();
		Dictionary<string, double> tickCosts = new Dictionary<string, double>();
		long writesBefore = journalWrites;
		double writeMsBefore = journalWriteMilliseconds;
		try
		{
			ObserveWecomClientFacts();
			if (await TickScheduledStartAsync())
			{
				return;
			}
			if (gameProcessFailed)
			{
				ObserveWecomClientFacts();
				lastTick = Stopwatch.GetTimestamp();
				if (game != null)
				{
					game["enabled"] = false;
				}
				EnsureRecoveryLoop();
				await SendState();
				return;
			}
			long timestamp = Stopwatch.GetTimestamp();
			if (Flag(game?["enabled"]) && Str(game?["state"]) != "paused")
			{
				elapsedMs += Math.Max(0L, (long)Stopwatch.GetElapsedTime(lastTick, timestamp).TotalMilliseconds);
			}
			lastTick = timestamp;
			if (autoGuestEntry)
			{
				await GameScriptAsync("(()=>{const a=globalThis.__PB_BRIDGE?.app;if(!a)return;if(!a.meta.account&&!globalThis.__PB_GUEST_ENTRY_ATTEMPTED){const b=[...document.querySelectorAll('button')].find(b=>/以游客身份游玩|Play as guest|Jugar como invitado/i.test(b.textContent));if(b&&!b.disabled){globalThis.__PB_GUEST_ENTRY_ATTEMPTED=true;b.click();}}if(a.meta.account?.guest&&a.meta.profile&&!a.meta.profile.starter&&!a.__choosing){a.__choosing=true;a.meta.chooseStarter(1).then(()=>a.toMenu());}})()");
			}
			long phaseStarted = Stopwatch.GetTimestamp();
			long snapshotIntent = intentGeneration;
			string text = await GameScriptAsync("(()=>{const p=globalThis.__PB_PILOT,s=p?.snapshot()??null;if(s){s.__reportTicket=p.app?.meta?.ticket?.id??null;s.__reportRunAt=p.runStartedAt??null;}return s;})()");
			tickCosts["snapshotIpcMs"] = Stopwatch.GetElapsedTime(phaseStarted).TotalMilliseconds;
			tickCosts["snapshotBytes"] = Encoding.UTF8.GetByteCount(text);
			phaseStarted = Stopwatch.GetTimestamp();
			game = JsonNode.Parse(text)?.AsObject();
            var reportTicket = Str(game?["__reportTicket"]); var reportRunAt = game?["__reportRunAt"]?.ToJsonString();
            game?.Remove("__reportTicket"); game?.Remove("__reportRunAt");
            var previousReportError = battleReportArchive.Error;
            await battleReportArchive.ObserveAsync(game, reportTicket, reportRunAt);
            if (battleReportArchive.Error is { } reportError && reportError != previousReportError)
                Log("warn", "战报写入失败", reportError);
			if (observedAccount.Observe(game, observedRuns, observedResults, observedEvents))
			{
				ResetRecoveryAccountBaseline();
				ResetLogIdentity();
				runKey = "";
				if (snapshotIntent == intentGeneration && !wantedRunIntent)
				{
					CancelRecoveryIntent("游戏身份已变化，请为当前账号重新点击开始", notifyPage: false);
				}
				Log("info", "进度已重新同步", "游戏身份已变化，当前账号的收益与图鉴基线已重置；切换前记录保留，不把旧历史计为新账号收益。");
			}
			ObserveRestReminderSnapshot();
			tickCosts["snapshotParseMs"] = Stopwatch.GetElapsedTime(phaseStarted).TotalMilliseconds;
			phaseStarted = Stopwatch.GetTimestamp();
			JsonNode jsonNode = JsonNode.Parse(await GameScriptAsync("({compatibility:globalThis.__PB_COMPATIBILITY??null,boot:globalThis.__PB_GAME_BOOT??null,skinRuntime:globalThis.__PB_PLAYER_SKINS?.getStatus?.()??null})"));
			skinRuntimeStatus = jsonNode?["skinRuntime"]?.DeepClone().AsObject();
			tickCosts["connectionProbeIpcMs"] = Stopwatch.GetElapsedTime(phaseStarted).TotalMilliseconds;
			JsonObject observedCompatibility = jsonNode?["compatibility"]?.AsObject();
			ObserveNativeBoot(jsonNode?["boot"]);
			if (await TickScheduledStartAsync())
			{
				return;
			}
			if (gameProcessFailed)
			{
				ObserveWecomClientFacts();
				lastTick = Stopwatch.GetTimestamp();
				if (game != null)
				{
					game["enabled"] = false;
				}
				EnsureRecoveryLoop();
				await SendState();
				return;
			}
			ObserveRecoverySnapshot();
			string text2 = Str(observedCompatibility?["state"]);
			bool flag = ((text2 == "pending" || text2 == "blocked") ? true : false);
			JsonObject jsonObject = (flag ? observedCompatibility : (game?["compatibility"]?.DeepClone().AsObject() ?? observedCompatibility));
			if (jsonObject != null)
			{
				compatibilityReport = jsonObject.DeepClone().AsObject();
				if (Str(jsonObject["state"]) == "blocked")
				{
					SetCompatibilityError(Str(jsonObject["reason"]) ?? "游戏运行接口检查未通过，自动控制已暂停。", Str(jsonObject["code"]) ?? "runtime-blocked");
				}
				else if (CompatibilityMayOperate(jsonObject))
				{
					compatibility = "";
				}
			}
			await EnsureSkinForCurrentPageAsync();
			await CheckRecoveryHealthAsync();
			try
			{
				await UpdateRuntimeCatalogAsync();
			}
			catch (Exception ex) when (!(ex is IOException) && !(ex is UnauthorizedAccessException) && !(ex is SecurityException))
			{
				updateStatus["catalogWarning"] = "部分公开目录暂未同步，保留既有目录与当前对局：" + ex.Message;
			}
			await ProcessPendingDeploymentAsync();
			if (!checkingUpdates && DateTimeOffset.Now - lastUpdateCheck > TimeSpan.FromMinutes(10.0))
			{
				CheckForUpdatesAsync(manual: false);
			}
			if (game?["profile"] == null && !NativeBootLoadingGrace && (DateTimeOffset.Now - gameNavigationAt).TotalSeconds > 45.0 && observedCompatibility == null && string.IsNullOrEmpty(compatibility))
			{
				SetCompatibilityError(gameModuleObserved ? "游戏接口连接超时，请检查网络后重新打开；详情见收获日志。" : "没有识别到游戏入口，可能是加载失败或入口结构变化；详情见收获日志。", "startup-timeout");
			}
			if (RecoveryBusy)
			{
				status = RecoveryStatus();
			}
			else if (!string.IsNullOrEmpty(compatibility))
			{
				status = compatibility;
			}
			else if (Str(nativeBootObservation?["phase"]) == "loading")
			{
				status = NativeBootStatus();
			}
			else
			{
				status = operationStatus ?? Str(game?["status"]) ?? "等待游戏加载";
			}
			if (status == "等待登录" && game?["profile"] != null)
			{
				status = "账号已连接，选择目标后点击开始挂机";
			}
			JsonObject jsonObject2 = ((!observedAccount.HasIdentity) ? null : game?["profile"]?.AsObject());
			if (jsonObject2 != null)
			{
				if (baseline == null)
				{
					baseline = jsonObject2.DeepClone().AsObject();
				}
				if (confirmedShinies == null)
				{
					confirmedShinies = jsonObject2["shinies"]?.AsArray().Select(Num).ToHashSet() ?? new HashSet<int>();
				}
				if (lastProfile != null)
				{
					int num = Num(jsonObject2["stardust"]) - Num(lastProfile["stardust"]);
					int num2 = ((jsonObject2["totalStardust"] != null && lastProfile["totalStardust"] != null) ? (Num(jsonObject2["totalStardust"]) - Num(lastProfile["totalStardust"])) : Math.Max(0, num));
					int num3 = Math.Max(0, num2);
					int num4 = ((num2 >= 0) ? Math.Max(0, num3 - num) : 0);
					if (num2 < 0)
					{
						grossStardust = Math.Max(0, grossStardust + num2);
						Log("info", "进度已重新同步", "未确认收入已按游戏保存结果校正。");
					}
					if (num3 > 0)
					{
						grossStardust += num3;
					}
					if (num4 > 0)
					{
						spentStardust += num4;
					}
				}
				lastProfile = jsonObject2.DeepClone().AsObject();
			}
			if (!savedRewards.Initialized && observedAccount.HasIdentity && game?["rewardsProfile"] is JsonObject savedProfile)
			{
				ObserveSavedRewards(savedProfile);
			}
			JsonArray jsonArray = ((!observedAccount.HasIdentity) ? null : game?["history"]?.AsArray());
			JsonArray jsonArray2 = ((!observedAccount.HasIdentity) ? null : game?["events"]?.AsArray());
			foreach (JsonObject item in (from v in jsonArray2?.OfType<JsonObject>()
				where Str(v["kind"]) != "settlement"
				select v) ?? Array.Empty<JsonObject>())
			{
				string id = Str(item["id"]) ?? "";
				if (observedEvents.Add(id))
				{
					flag = Str(item["kind"]) == "choice";
					if (flag)
					{
						text2 = Str(item["type"]);
						bool flag2 = ((text2 == "terrainRecoveryContinuing" || text2 == "explorationRecoveryContinuing") ? true : false);
						flag = flag2;
					}
					if (flag)
					{
						Log("warning", "持续脱困未取得进展，保留当前对局", Str(item["message"]) ?? "继续尝试脱困，不结束或重开当前对局。");
					}
					if (Str(item["kind"]) == "shinyEncounter")
					{
						shiniesFound++;
						Log("reward", "发现异色", Str(item["message"]) ?? "");
					}
					if (Str(item["kind"]) == "shinyCapture")
					{
						capturedShinies++;
						Log("reward", "本局已捕获异色", Str(item["message"]) ?? "等待结算确认");
					}
					if (Str(item["kind"]) == "resynced")
					{
						ObserveRecoveredRewards(item);
					}
				}
			}
			if (jsonArray != null)
			{
				foreach (JsonObject item2 in jsonArray.OfType<JsonObject>())
				{
					if (!(Str(item2["event"]) != "run"))
					{
						string text3 = item2["at"]?.ToJsonString() ?? "";
						if (observedRuns.Add(text3))
						{
							runKey = text3;
							BindLogRun(text3);
							runs++;
							Log("run", "开始第 " + runs + " 局", (Str(game?["priority"]) ?? "自动推进") + " · " + DescribeRun(item2, item2["species"]));
						}
					}
				}
			}
			ObserveSettlements(jsonArray2);
			if (observedAccount.HasIdentity && game?["rewardsProfile"] is JsonObject savedProfile2)
			{
				ObserveSavedRewards(savedProfile2);
			}
			await UpdateVerifiedClearsAsync();
			ObserveRegionProgress();
			await PollWecomAsync();
			phaseStarted = Stopwatch.GetTimestamp();
			string statusText = State().ToJsonString();
			tickCosts["statusBuildAndSerializeMs"] = Stopwatch.GetElapsedTime(phaseStarted).TotalMilliseconds;
			tickCosts["statusBytes"] = Encoding.UTF8.GetByteCount(statusText);
			phaseStarted = Stopwatch.GetTimestamp();
			await SendState(statusText);
			tickCosts["stateBuildAndPostMs"] = Stopwatch.GetElapsedTime(phaseStarted).TotalMilliseconds;
			phaseStarted = Stopwatch.GetTimestamp();
			string text4 = Str(game?["state"]);
			text2 = pageGeneration.ToString();
			string text5 = runs.ToString();
			string text6 = completedRuns.ToString();
			string text7 = Flag(game?["enabled"]).ToString();
			flag = ((text4 == "over" || text4 == "paused") ? true : false);
			string currentBoundary = text2 + ":" + text5 + ":" + text6 + ":" + text7 + ":" + (flag ? text4 : "live") + ":" + storageError;
			if (statusWriteBudget.Take(Environment.TickCount64, currentBoundary))
			{
				await File.WriteAllTextAsync(portable.ValidatePath(portable.StatusPath), statusText);
				tickCosts["statusWrites"] = 1.0;
			}
			else
			{
				tickCosts["statusWrites"] = 0.0;
			}
			tickCosts["statusWriteMs"] = Stopwatch.GetElapsedTime(phaseStarted).TotalMilliseconds;
			if (!smoke || File.Exists(Path.Combine(storage, "smoke-game.png")) || game?["profile"] == null)
			{
				return;
			}
			await using FileStream image = File.Create(portable.DataPath("smoke-game.png"));
			await GameView.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, image);
			await using FileStream uiImage = File.Create(portable.DataPath("smoke-panel.png"));
			await PanelView.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, uiImage);
		}
		catch (Exception ex2)
		{
			if ((ex2 is IOException || ex2 is UnauthorizedAccessException || ex2 is SecurityException) ? true : false)
			{
				await HandleStorageFailureAsync(ex2);
			}
			else if (!(ex2 is OperationCanceledException))
			{
				status = "等待连接恢复：" + ex2.Message;
				RequestRecovery("script-unavailable", rebuild: false, reloadGame: true);
				await SendState();
			}
		}
		finally
		{
			tickCosts["tickTotalMs"] = Stopwatch.GetElapsedTime(tickStarted).TotalMilliseconds;
			tickCosts["journalWrites"] = journalWrites - writesBefore;
			tickCosts["journalWriteMs"] = journalWriteMilliseconds - writeMsBefore;
			hostPerformance.Add(tickCosts);
			ticking = false;
		}
	}

	private string CharacterName(int id)
	{
		string text = Str(catalog["characters"]?.AsArray().OfType<JsonObject>().FirstOrDefault((JsonObject c) => Num(c["id"]) == id)?["name"]);
		if (text == null)
		{
			if (id <= 0)
			{
				return "自动角色";
			}
			text = "#" + id;
		}
		return text;
	}

	private JsonObject State()
	{
		return new JsonObject
		{
			["panelHidden"] = panelHidden,
			["expanded"] = panelExpanded,
			["running"] = ScheduledStartPending || (!gameProcessFailed && Flag(game?["enabled"]) && Str(game?["state"]) != "paused"),
			["paused"] = Str(game?["state"]) == "paused" || (!Flag(game?["enabled"]) && game?["state"] != null && Str(game?["state"]) != "over"),
			["status"] = status,
			["profile"] = game?["profile"]?.DeepClone(),
			["game"] = game?.DeepClone(),
			["config"] = config.DeepClone(),
			["session"] = new JsonObject
			{
				["startedAt"] = ProcessStart,
				["elapsedMs"] = elapsedMs,
				["elapsedSeconds"] = elapsedMs / 1000,
				["duration"] = elapsedMs / 1000,
				["runs"] = runs,
				["completedRuns"] = completedRuns,
				["wins"] = wins,
				["kills"] = kills + ((!(Str(game?["state"]) == "over")) ? Num(game?["kills"]) : 0),
				["stardust"] = grossStardust,
				["stardustEarned"] = grossStardust,
				["spentStardust"] = spentStardust,
				["newDex"] = newSeen,
				["seen"] = newSeen,
				["characters"] = newLeague,
				["shiniesFound"] = shiniesFound,
				["capturedShinies"] = capturedShinies,
				["newShinies"] = newShinies
			},
			["logs"] = new JsonArray((from l in logs.TakeLast(200)
				select l.DeepClone()).ToArray()),
			["logRevision"] = logRevision,
			["version"] = ClientVersion,
			["compatibility"] = compatibility,
			["compatibilityReport"] = compatibilityReport?.DeepClone(),
			["error"] = ((storageError.Length > 0) ? storageError : ((compatibility.Length > 0) ? compatibility : null)),
			["storage"] = new JsonObject
			{
				["root"] = portable.RootDirectory,
				["data"] = portable.DataDirectory,
				["log"] = portable.ReadableLogPath,
				["journal"] = portable.JournalPath,
				["browser"] = portable.BrowserDirectory,
				["temporary"] = portable.TemporaryDirectory,
				["failureReports"] = browserFailureReports
			},
			["diagnostics"] = (diagnostics ? new JsonObject
			{
				["isolatedStorage"] = smoke,
				["automaticGuestEntry"] = autoGuestEntry,
				["processTemporary"] = Environment.GetEnvironmentVariable("TEMP"),
				["browserUserDataOverride"] = Environment.GetEnvironmentVariable("WEBVIEW2_USER_DATA_FOLDER")
			} : null),
			["recovery"] = RecoveryState(),
			["recoveryLogin"] = RecoveryLoginState(),
			["connection"] = ConnectionState(),
			["customPlans"] = customPlans.DeepClone(),
			["catalogRevision"] = catalogRevision,
			["updateStatus"] = updateStatus.DeepClone(),
			["prerequisites"] = prerequisites.Current.ToJson(),
			["skinRuntime"] = skinRuntimeStatus?.DeepClone()
		};
	}

	private void SetPanelHidden(bool hidden)
	{
		if (panelHidden != hidden)
		{
			if (hidden)
			{
				panelRestoreHeight = Math.Clamp((ControlRow.ActualHeight > 0.0) ? ControlRow.ActualHeight : ControlRow.Height.Value, 250.0, 850.0);
				ControlRow.MinHeight = 32.0;
				ControlRow.Height = new GridLength(32.0);
				SplitterRow.Height = new GridLength(0.0);
				PanelSplitter.IsEnabled = false;
				PanelSplitter.Visibility = Visibility.Collapsed;
			}
			else
			{
				ControlRow.MinHeight = 250.0;
				ControlRow.Height = new GridLength(Math.Clamp(panelRestoreHeight, 250.0, Math.Max(250.0, Math.Min(850.0, base.ActualHeight - 345.0))));
				SplitterRow.Height = new GridLength(5.0);
				PanelSplitter.IsEnabled = true;
				PanelSplitter.Visibility = Visibility.Visible;
			}
			panelHidden = hidden;
		}
	}

	private Task SendState(string? serializedState = null)
	{
		UpdateBrowserExecutionPower();
		if (serializedState == null)
		{
			PostPanelMessage(new JsonObject
			{
				["event"] = "state",
				["data"] = State()
			});
		}
		else
		{
			PostPanelMessageText("{\"event\":\"state\",\"data\":" + serializedState + "}");
		}
		return Task.CompletedTask;
	}

	private void ReportOperationError(Exception error, string title = "操作未完成")
	{
		status = error.Message;
		try
		{
			Log("error", title, error.Message);
		}
		catch (Exception ex)
		{
			storageError = (status = "程序目录无法写入，请恢复可写空间后重新打开客户端：" + ex.Message);
		}
	}

	internal async Task HandleStorageFailureAsync(Exception error)
	{
		storageError = (status = "程序目录无法写入，请恢复可写空间后重新打开客户端：" + error.Message);
		RequestRecovery("storage-unavailable");
		if (ready)
		{
			try
			{
				await GameScriptAsync("globalThis.__PB_PILOT?.stop('程序目录无法写入',{recoverable:true,source:'controller-error',code:'storage-unavailable'})");
			}
			catch
			{
			}
		}
		await SendState();
	}

    private async Task PersistBattleRecordsAsync(JsonObject batch, Microsoft.Web.WebView2.Wpf.WebView2 sourceView)
    {
        try {
            var ack = await battleRecordWriter.AcceptAsync(batch);
            if (GameView != sourceView || sourceView.CoreWebView2 is null) return;
            sourceView.CoreWebView2.PostWebMessageAsJson(new JsonObject { ["kind"] = "battleRecordsAck", ["ack"] = ack }.ToJsonString());
        } catch { /* Audit failure never stops or pauses gameplay. Browser retains unacknowledged batch. */ }
    }


	private async void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
	{
		if (sender != PanelView.CoreWebView2 || !e.Source.StartsWith("https://pilot.local/", StringComparison.OrdinalIgnoreCase))
		{
			return;
		}
		WebView2 responseView = PanelView;
		long responseGeneration = panelGeneration;
		JsonObject req = null;
		JsonObject requestPayload = null;
		long? preparedIntent = null;
		try
		{
			try
			{
				req = JsonNode.Parse(e.WebMessageAsJson)?.AsObject();
				if (req == null)
				{
					return;
				}
				JsonObject payload = req["payload"]?.AsObject() ?? new JsonObject();
				requestPayload = payload;
				string action = Str(req["action"]) ?? "";
				RequireExpectedRunIntent(action, payload);
				action = await PrepareAuthorizedHostActionAsync(action, payload);
				if (action == "importCustomPlanFile" || (action == "exportCustomPlans" && Flag(payload["chooseFile"])))
				{
					CancelRecoveryIntent("正在选择方案文件");
				}
				bool flag;
				switch (action)
				{
				case "importSkin":
				case "exportSkin":
				case "saveSkinPrompt":
					flag = true;
					break;
				default:
					flag = false;
					break;
				}
				if (flag)
				{
					CancelRecoveryIntent("正在选择皮肤文件");
				}
				long queuedIntent = intentGeneration;
				preparedIntent = queuedIntent;
				JsonNode value;
				if (action == "getState")
				{
					value = State();
					goto IL_065a;
				}
				if (action == "getCatalog")
				{
					value = catalog.DeepClone();
					goto IL_065a;
				}
				if (IsCompatibilityEditorAction(action))
				{
					value = await CompatibilityEditorActionAsync(action, payload);
					goto IL_065a;
				}
				if (action == "checkUpdates")
				{
					await CheckForUpdatesAsync(manual: true);
					value = updateStatus.DeepClone();
					goto IL_065a;
				}
				if (action.StartsWith("wecom", StringComparison.Ordinal))
				{
					value = await WecomActionAsync(action, payload);
					goto IL_065a;
				}
				if (action == "panelVisibility")
				{
					if (closing || responseView != PanelView || responseGeneration != panelGeneration)
					{
						return;
					}
					JsonValueKind? jsonValueKind = payload["hidden"]?.GetValueKind();
					if (jsonValueKind.HasValue)
					{
						JsonValueKind valueOrDefault = jsonValueKind.GetValueOrDefault();
						if (valueOrDefault - 5 <= JsonValueKind.Object)
						{
							flag = true;
							goto IL_04e3;
						}
					}
					flag = false;
					goto IL_04e3;
				}
				await commandLock.WaitAsync();
				try
				{
					if (closing || responseView != PanelView || responseGeneration != panelGeneration)
					{
						throw new OperationCanceledException("控制面板已更新，已丢弃旧页面排队操作");
					}
					commandResult = null;
					await Command(action, payload, queuedIntent);
					value = commandResult ?? State();
				}
				finally
				{
					operationStatus = null;
					commandLock.Release();
				}
				goto IL_065a;
				IL_04e3:
				if (!flag)
				{
					throw new InvalidOperationException("面板显示开关格式无效");
				}
				SetPanelHidden(Flag(payload["hidden"]));
				value = State();
				goto IL_065a;
				IL_065a:
				if (responseView == PanelView && responseGeneration == panelGeneration)
				{
					PostPanelMessage(new JsonObject
					{
						["id"] = req["id"]?.DeepClone(),
						["ok"] = true,
						["data"] = value
					});
				}
				goto end_IL_0095;
			}
			catch (Exception ex)
			{
				if (IsCompatibilityEditorAction(Str(req?["action"]) ?? ""))
				{
					if (responseView == PanelView && responseGeneration == panelGeneration)
					{
						PostPanelMessage(new JsonObject
						{
							["id"] = req?["id"]?.DeepClone(),
							["ok"] = false,
							["error"] = ((ex is InvalidOperationException) ? ex.Message : "兼容配置操作未完成，已有设置和游戏页面保持不变；请稍后重试。")
						});
					}
					goto end_IL_0701;
				}
				if (Str(req?["action"])?.StartsWith("wecom", StringComparison.Ordinal) ?? false)
				{
					goto IL_0892;
				}
				if (Str(req?["action"]) == "config")
				{
					JsonObject jsonObject = (requestPayload?["config"] as JsonObject) ?? requestPayload;
					if (jsonObject != null && jsonObject.Count == 1 && jsonObject.ContainsKey("wecomPush"))
					{
						goto IL_0892;
					}
				}
				bool flag = preparedIntent == intentGeneration && wantedRunIntent;
				if (flag)
				{
					bool flag2;
					switch (Str(req?["action"]))
					{
					case "start":
					case "resume":
					case "toggle":
						flag2 = true;
						break;
					default:
						flag2 = false;
						break;
					}
					flag = flag2;
				}
				if (flag && (Str(config["mode"]) == "autoManage" || Str(requestPayload?["__hostAutoManageScopeTicket"]) != null))
				{
					CancelRecoveryIntent("自动托管启动未完成，请为当前局重新点击开始", notifyPage: false);
				}
				if (ex is OperationCanceledException && (closing || responseView != PanelView || responseGeneration != panelGeneration))
				{
					goto end_IL_0701;
				}
				ReportOperationError(ex);
				flag = wantedRunIntent;
				if (flag)
				{
					bool flag2;
					switch (Str(req?["action"]))
					{
					case "start":
					case "resume":
					case "toggle":
						flag2 = true;
						break;
					default:
						flag2 = false;
						break;
					}
					flag = flag2;
				}
				if (flag && !(ex is OperationCanceledException))
				{
					RequestRecovery("start-interrupted");
				}
				if (storageError.Length > 0)
				{
					await HandleStorageFailureAsync(ex);
				}
				if (responseView == PanelView && responseGeneration == panelGeneration)
				{
					PostPanelMessage(new JsonObject
					{
						["id"] = req?["id"]?.DeepClone(),
						["ok"] = false,
						["error"] = ex.Message
					});
				}
				goto end_IL_0095;
				IL_0892:
				if (responseView == PanelView && responseGeneration == panelGeneration)
				{
					PostPanelMessage(new JsonObject
					{
						["id"] = req?["id"]?.DeepClone(),
						["ok"] = false,
						["error"] = ((ex is InvalidOperationException) ? ex.Message : "企微推送操作未完成，请检查本机目录、目标配置或网络；游戏不受影响")
					});
				}
				end_IL_0701:;
			}
			end_IL_0095:;
		}
		finally
		{
			string text = Str(requestPayload?["__hostAutoManageScopeTicket"]);
			if (text != null)
			{
				await DiscardRunStartScopeAsync(text);
			}
			if (Str(req?["action"]) == "readRecoveryLogin")
			{
				commandResult?.Remove("password");
				commandResult?.Remove("name");
				commandResult = null;
			}
		}
	}

	private async Task<bool> AuthorizedTestAccountAsync(bool requireFinished)
	{
		if (!diagnostics || !launchArguments.Contains("--authorized-test-account") || !ready || gameProcessFailed)
		{
			return false;
		}
		try
		{
			string text = portable.ValidatePath(portable.DataPath("pilot-test-authorization.json"));
			FileInfo fileInfo = new FileInfo(text);
			if (!fileInfo.Exists || fileInfo.Length > 4096 || (fileInfo.Attributes & FileAttributes.ReparsePoint) != FileAttributes.None)
			{
				return false;
			}
			JsonNode jsonNode = JsonNode.Parse(await File.ReadAllTextAsync(text, Encoding.UTF8));
			string expected = Str(jsonNode?["identityHash"]);
			if (Str(jsonNode?["purpose"]) != "user-authorized-dedicated-test" || !(jsonNode?["registered"] is JsonValue jsonValue) || !jsonValue.TryGetValue<bool>(out var value) || !value || expected == null || !Regex.IsMatch(expected, "^[a-f0-9]{64}$"))
			{
				return false;
			}
			JsonNode jsonNode2 = JsonNode.Parse(await GameScriptAsync("(()=>{const app=globalThis.__PB_BRIDGE?.app,a=app?.meta?.account;globalThis.__PB_NATIVE_DIAGNOSTIC_AUTH=null;if(!a||a.guest!==false||!['string','number'].includes(typeof a.id)||!String(a.id)||typeof a.id==='number'&&!Number.isFinite(a.id))return null;globalThis.__PB_NATIVE_DIAGNOSTIC_AUTH={app,meta:app.meta,account:a};return {id:String(a.id),finished:!app.run||app.run.state==='over'}})()"));
			if (jsonNode2 == null || (requireFinished && !Flag(jsonNode2["finished"])))
			{
				return false;
			}
			string text2 = Str(jsonNode2["id"]);
			if (text2 == null)
			{
				return false;
			}
			string text3 = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes("pokebonk-dedicated-test:" + text2))).ToLowerInvariant();
			string text4 = (requireFinished ? "&&(!a.run||a.run.state==='over')" : "");
			bool flag = text3 == expected;
			if (flag)
			{
				flag = await GameScriptAsync("(()=>{const x=globalThis.__PB_NATIVE_DIAGNOSTIC_AUTH,a=globalThis.__PB_BRIDGE?.app;return !!x&&x.app===a&&x.meta===a?.meta&&x.account===a.meta.account" + text4 + "})()") == "true";
			}
			return flag;
		}
		catch
		{
			return false;
		}
	}

	private async Task Command(string action, JsonObject payload, long? queuedIntent = null)
	{
		bool flag;
		switch (action)
		{
		case "favoriteCurrentBuild":
			commandResult = await FavoriteCurrentBuild(payload);
			break;
		case "testConvenienceSound":
			commandResult = TestConvenienceSound(payload);
			break;
		case "getSkins":
		case "saveSkinPrompt":
		case "getSkinPreview":
		case "getSkinPrompt":
		case "importSkin":
		case "renameSkin":
		case "selectSkin":
		case "deleteSkin":
		case "exportSkin":
		case "restoreBuiltinSkins":
			commandResult = await SkinCommand(action, payload);
			break;
		case "readBrowserOptimization":
			commandResult = await ReadBrowserOptimizationAsync();
			break;
		case "applyBrowserOptimization":
			commandResult = await ApplyBrowserOptimizationAsync(payload);
			break;
		case "getHostPerformance":
			commandResult = hostPerformance.Snapshot();
			break;
		case "toggle":
		{
			JsonNode jsonNode = JsonNode.Parse(await GameScriptAsync("(()=>{const p=globalThis.__PB_PILOT;return {enabled:p?.enabled===true,state:p?.app?.run?.state??globalThis.__PB_BRIDGE?.app?.run?.state??null}})()"));
			await Command((Flag(jsonNode?["enabled"]) && Str(jsonNode?["state"]) != "paused") ? "pause" : "resume", payload);
			return;
		}
		case "config":
		{
			JsonObject incoming = (payload["config"]?.AsObject() ?? payload).DeepClone().AsObject();
			MergeWecomPatch(incoming);
			JsonObject settingsBeforeConfig = config.DeepClone().AsObject();
			bool settingsBeforeMigration = unlockTargetsMigrated;
			JsonObject jsonObject3 = (incoming.ContainsKey("logRetentionRuns") ? config.DeepClone().AsObject() : null);
			JsonObject[] collection = ((jsonObject3 != null) ? logs.Select((JsonObject row) => row.DeepClone().AsObject()).ToArray() : null);
			string text4 = ((jsonObject3 == null) ? null : logDocumentText?.Text);
			bool flag2 = unlockTargetsMigrated;
			bool convenienceCoopChanged = false;
			bool rhythmChanged = false;
			try
			{
				ValidateIncomingHotkeys(incoming);
				if (incoming.ContainsKey("overlay"))
				{
					OverlaySettings.ValidatePatch(incoming["overlay"]);
				}
				if (incoming.ContainsKey("convenience"))
				{
					ConvenienceSettings.ValidatePatch(incoming["convenience"]);
				}
				JsonObject jsonObject4 = (incoming.ContainsKey("display") ? DisplaySettings.Merge(config["display"], incoming["display"]) : null);
				foreach (KeyValuePair<string, JsonNode> item in incoming)
				{
					bool flag3;
					switch (item.Key)
					{
					case "eventTargets":
					case "modeSettings":
					case "display":
					case "overlay":
					case "unlockTargets":
					case "finalReplacements":
					case "convenience":
						flag3 = true;
						break;
					default:
						flag3 = false;
						break;
					}
					flag = !flag3 && config.ContainsKey(item.Key);
					bool flag5;
					bool flag6;
					if (flag)
					{
						string text = item.Key;
						bool flag4 = ((text is "autoUnlockItems" or "autoClaim" or "autoUpgrade" or "reserveMoveSlot" or "shopPriority") ? true : false);
						flag5 = !flag4;
						if (!flag5)
						{
							JsonValueKind? jsonValueKind = item.Value?.GetValueKind();
							if (jsonValueKind.HasValue)
							{
								JsonValueKind valueOrDefault = jsonValueKind.GetValueOrDefault();
								if (valueOrDefault - 5 <= JsonValueKind.Object)
								{
									flag6 = true;
									goto IL_0e7d;
								}
							}
							flag6 = false;
							goto IL_0e7d;
						}
						goto IL_0e81;
					}
					goto IL_0e85;
					IL_0e7d:
					flag5 = flag6;
					goto IL_0e81;
					IL_0e81:
					flag = flag5;
					goto IL_0e85;
					IL_0e85:
					if (flag)
					{
						config[item.Key] = item.Value?.DeepClone();
					}
				}
				NormalizeFlightInteractionSettings(config, incoming);
				if (jsonObject4 != null)
				{
					config["display"] = jsonObject4;
				}
				if (incoming["overlay"] is JsonObject patch)
				{
					config["overlay"] = OverlaySettings.Merge(config["overlay"], patch);
				}
				if (incoming["convenience"] is JsonObject patch2)
				{
					JsonObject jsonObject5 = ConvenienceSettings.Merge(config["convenience"], patch2);
					convenienceCoopChanged = !JsonNode.DeepEquals(config["convenience"]?["coop"], jsonObject5["coop"]);
					rhythmChanged = !JsonNode.DeepEquals(config["convenience"]?["rhythm"], jsonObject5["rhythm"]);
					config["convenience"] = jsonObject5;
				}
				if (incoming.ContainsKey("convenience"))
				{
					StopConvenienceSound(clearEvents: true);
				}
				if (incoming["eventTargets"] is JsonObject jsonObject6)
				{
					JsonObject jsonObject7 = (config["eventTargets"]?.DeepClone() as JsonObject) ?? new JsonObject();
					foreach (KeyValuePair<string, JsonNode> item2 in jsonObject6)
					{
						if (ValidEventId(item2.Key))
						{
							jsonObject7[item2.Key] = item2.Value?.DeepClone();
						}
					}
					config["eventTargets"] = jsonObject7;
				}
				if (incoming["finalReplacements"] is JsonObject patch3)
				{
					config["finalReplacements"] = MergeFinalReplacements(config["finalReplacements"], patch3);
				}
				if (incoming["modeSettings"] is JsonObject patch4)
				{
					JsonObject jsonObject8 = config;
					JsonNode? current3 = config["modeSettings"];
					JsonNode? jsonNode5 = config["leaderboardGoal"];
					jsonObject8["modeSettings"] = MergeModeSettings(current3, patch4, (jsonNode5 != null && jsonNode5.GetValueKind() == JsonValueKind.String) ? Str(config["leaderboardGoal"]) : null);
				}
				if (incoming["unlockTargets"] is JsonObject jsonObject9)
				{
					JsonObject jsonObject10 = config["unlockTargets"]?.DeepClone().AsObject() ?? DefaultUnlockTargets();
					foreach (KeyValuePair<string, JsonNode> item3 in jsonObject9)
					{
						if (jsonObject10.ContainsKey(item3.Key))
						{
							jsonObject10[item3.Key] = item3.Value?.DeepClone();
						}
					}
					config["unlockTargets"] = jsonObject10;
					if (jsonObject9.ContainsKey("shiny"))
					{
						unlockTargetsMigrated = true;
					}
				}
				if ((!(incoming["unlockTargets"] is JsonObject jsonObject11) || !jsonObject11.ContainsKey("shiny")) && (incoming.ContainsKey("shinyMode") || incoming.ContainsKey("shinyTargetId")))
				{
					JsonObject jsonObject12 = (config["unlockTargets"] as JsonObject) ?? DefaultUnlockTargets();
					jsonObject12["shiny"] = ((Str(config["shinyMode"]) == "target" && Num(config["shinyTargetId"]) > 0) ? ("shiny:" + Num(config["shinyTargetId"])) : "auto");
					config["unlockTargets"] = jsonObject12;
					unlockTargetsMigrated = true;
				}
				ValidateConfig();
				if (jsonObject3 == null)
				{
					await PersistConfigAsync(settingsBeforeConfig, settingsBeforeMigration);
				}
				else
				{
					try
					{
						if (!ClientLogRetentionTransaction.Commit(portable, config.ToJsonString(JsonOptions), ApplyLogRetention).TemporaryFilesCleaned)
						{
							status = "日志范围已保存；临时备份清理未完成，请检查客户端数据目录。";
						}
					}
					catch
					{
						config = jsonObject3;
						unlockTargetsMigrated = flag2;
						logs.Clear();
						logs.AddRange(collection);
						logRevision++;
						if (logDocumentText != null && text4 != null)
						{
							logDocumentText.Text = text4;
						}
						throw;
					}
				}
			}
			catch
			{
				config = settingsBeforeConfig;
				unlockTargetsMigrated = settingsBeforeMigration;
				throw;
			}
			if (incoming.ContainsKey("wecomPush"))
			{
				await RefreshWecomRuntimeAsync();
			}
			ObserveWecomHostEvent("configSaved", new JsonObject
			{
				["count"] = incoming.Count,
				["changedKeys"] = string.Join(",", (from entry in incoming
					select entry.Key into key
					where key != "wecomPush"
					select key).Take(40))
			});
			if (incoming.ContainsKey("display"))
			{
				ApplyGameViewport();
			}
			if (!Flag(config["autoRestart"]))
			{
				resumeAfterDeployment = false;
			}
			if (ready && incoming.Any<KeyValuePair<string, JsonNode>>((KeyValuePair<string, JsonNode> entry) => entry.Key != "wecomPush") && !ClientLogRetentionTransaction.IsOnlyRangePatch(incoming))
			{
				await UpdateVerifiedClearsAsync();
				string text5 = ((incoming.Any<KeyValuePair<string, JsonNode>>(delegate(KeyValuePair<string, JsonNode> entry)
				{
					bool flag7;
					switch (entry.Key)
					{
					case "overlay":
					case "convenience":
					case "display":
					case "logRetentionRuns":
					case "wecomPush":
						flag7 = true;
						break;
					default:
						flag7 = false;
						break;
					}
					return !flag7;
				}) || convenienceCoopChanged || rhythmChanged) ? ("globalThis.__PB_PILOT?.setSettings(" + PilotSettings().ToJsonString() + ");") : "");
				if (incoming.ContainsKey("overlay"))
				{
					text5 = text5 + "globalThis.__PB_OVERLAY?.configure(" + config["overlay"].ToJsonString() + ");";
				}
				if (incoming.ContainsKey("convenience"))
				{
					text5 = text5 + "globalThis.__PB_CONVENIENCE?.configure(" + config["convenience"].ToJsonString() + ");";
				}
				if (text5.Length > 0)
				{
					await GameScriptAsync(text5);
				}
				await RefreshInitializationScriptAsync();
			}
			Log("info", "挂机设置已保存", "模式、角色、地图和配装在下一局生效；拾取与连局开关即时生效。");
			break;
		}
		case "resume":
		case "start":
		{
			try
			{
				await UpdateVerifiedClearsAsync();
			}
			catch (Exception ex) when (!(ex is IOException) && !(ex is UnauthorizedAccessException) && !(ex is SecurityException))
			{
				updateStatus["catalogWarning"] = "部分本地通关格接口暂未同步，当前可用功能仍可启动；不会虚报已通关。";
			}
			bool autoManage = currentRunOnlyIntent || Str(config["mode"]) == "autoManage";
			string autoManageTicket = Str(payload["__hostAutoManageScopeTicket"]);
			if (autoManageTicket != null && !autoManage)
			{
				throw new OperationCanceledException("接管模式已变化，请重新开始");
			}
			if (autoManage && autoManageTicket == null)
			{
				throw new OperationCanceledException("自动托管需要重新确认当前对局，请手动开局后点击开始托管");
			}
			long requestedIntent = queuedIntent ?? ArmRunIntent();
			RequireRunIntent(requestedIntent);
			if (!HostScheduleAllowed && !autoManage)
			{
				PreserveScheduledStart(payload, requestedIntent);
				break;
			}
			long requestedPage = pageGeneration;
			if (gameProcessFailed)
			{
				RequestRecovery("user-start-after-failure", rebuild: false, reloadGame: true);
				break;
			}
			string liveIdentityHash = await LiveAccountIdentityHashAsync(CancellationToken.None);
			RequireRunIntent(requestedIntent);
			if (liveIdentityHash != null)
			{
				PinExplicitRecoveryIdentity(liveIdentityHash);
			}
			if (storageError.Length > 0)
			{
				throw new IOException(storageError);
			}
			JsonNode jsonNode2 = JsonNode.Parse(await GameScriptAsync("(()=>{const p=globalThis.__PB_PILOT;p?.setSettings(" + PilotSettings().ToJsonString() + ");if(!p?.app?.meta)return '__compatibility_wait__';if(!p.app.meta.account)return '请先在上方选择游客或登录账号';if(!p.app.meta.profile)return '游戏存档正在加载，请稍候';" + (autoManage ? "if(!p.app.run||p.app.run.state==='over')return '自动托管等待手动开局，请在游戏内开局后再点击开始';return null" : "if(!p.app.meta.profile.starter||!p.app.meta.profile.league?.length)return '请先在游戏中选择初始宝可梦';return null") + "})()"));
			if (Str(jsonNode2) == "__compatibility_wait__")
			{
				status = "挂机已开启，可用接口将分别运行；核心连接尚未就绪，正在继续自动识别，可使用底部手动兼容配置。";
				RequestRecovery("capability-wait");
				break;
			}
			if (jsonNode2 != null)
			{
				throw new Exception(Str(jsonNode2));
			}
			operationStatus = "正在准备挂机";
			JsonNode jsonNode3 = JsonNode.Parse(await GameScriptAsync("(()=>{const s=globalThis.__PB_PILOT?.snapshot();return {id:s?.accountId??null,type:s?.accountType??null}})()"));
			if (!autoManage && Str(jsonNode3?["type"]) == "registered")
			{
				JsonNode currentAccount = jsonNode3?["id"];
				bool transferred = await LegacyHandoff.TryCompleteAsync(DataRoot, Str(currentAccount), delegate(string message)
				{
					status = (operationStatus = message);
					Log("info", "正在交接旧脚本", message);
					SendState();
				}, delegate(string path2)
				{
					portable.ValidatePath(path2);
				});
				string path = portable.DataPath("legacy-runner.json");
				if (!transferred && File.Exists(path))
				{
					JsonNode jsonNode4 = JsonNode.Parse(await File.ReadAllTextAsync(portable.ValidatePath(path)));
					if (Str(jsonNode4?["accountId"]) == Str(currentAccount))
					{
						try
						{
							using Process process = Process.GetProcessById(Num(jsonNode4?["pid"]));
							if (!process.HasExited && process.ProcessName == "node")
							{
								throw new InvalidOperationException("旧脚本仍在运行，但状态尚未满足接管条件。请稍候重试，客户端没有开始新局。");
							}
						}
						catch (ArgumentException)
						{
						}
					}
				}
				needsProfileRefresh |= transferred;
				if (needsProfileRefresh)
				{
					await GameScriptAsync("globalThis.__PB_RESYNC_DONE=false;globalThis.__PB_RESYNC_ERROR=null;(async()=>{try{await __PB_BRIDGE.app.meta.resync()}catch(e){globalThis.__PB_RESYNC_ERROR=String(e.message||e)}finally{globalThis.__PB_RESYNC_DONE=true}})()");
					for (int i = 0; i < 20; i++)
					{
						if (await GameScriptAsync("globalThis.__PB_RESYNC_DONE") == "true")
						{
							break;
						}
						await Task.Delay(200);
					}
					if (await GameScriptAsync("globalThis.__PB_RESYNC_DONE && !globalThis.__PB_RESYNC_ERROR") != "true")
					{
						throw new Exception("账号同步尚未完成，请稍候再次点击开始；旧脚本已退出。");
					}
					needsProfileRefresh = false;
				}
			}
			RequireRunIntent(requestedIntent);
			string startTicket = autoManageTicket ?? Guid.NewGuid().ToString("N");
			try
			{
				if (requestedPage != pageGeneration)
				{
					throw new OperationCanceledException("游戏页面已变化，请在当前页面重新开始");
				}
				string text2;
				if (autoManage)
				{
					string text = ((autoManageTicket != null) ? (await CurrentRunStartScopeIdentityAsync(startTicket)) : null);
					text2 = text;
				}
				else
				{
					text2 = await CaptureRunStartScopeAsync(startTicket, CancellationToken.None);
				}
				string text3 = text2;
				RequireRunIntent(requestedIntent);
				if (text3 == null || text3 != liveIdentityHash)
				{
					throw new OperationCanceledException("启动准备期间账号已变化，请为当前账号重新点击开始");
				}
				await GameScriptAsync("globalThis.__PB_START_RESULT=null;globalThis.__PB_START_TICKET=" + JsonSerializer.Serialize(startTicket) + ";(async()=>{try{const p=globalThis.__PB_PILOT,scope=globalThis.__PB_HOST_START_SCOPE,isCurrent=()=>globalThis.__PB_START_TICKET===" + JsonSerializer.Serialize(startTicket) + "&&scope?.ticket===" + JsonSerializer.Serialize(startTicket) + "&&((scope)=>{\r\n  const p=globalThis.__PB_PILOT,a=globalThis.__PB_BRIDGE?.app,m=a?.meta,c=m?.account;\r\n  return !!scope&&globalThis.__PB_HOST_START_SCOPE===scope&&scope.pilot===p&&scope.app===a&&scope.meta===m&&scope.account===c&&p?.app===a&&String(c?.id)===scope.id&&(c?.guest===true?'guest':c?.guest===false?'registered':null)===scope.type&&(!scope.activeRunOnly||a.run===scope.run&&a.run?.state!=='over');\r\n})(scope);if(!p?.requestStart)throw Error('游戏控制器尚未连接');if(!isCurrent())throw Error('启动提交身份或页面已变化，未接管');const ok=await p.requestStart({isCurrent});if(globalThis.__PB_START_TICKET!==" + JsonSerializer.Serialize(startTicket) + ")return;globalThis.__PB_START_RESULT={ok:ok===true,reason:p.status}}catch(e){if(globalThis.__PB_START_TICKET===" + JsonSerializer.Serialize(startTicket) + ")globalThis.__PB_START_RESULT={ok:false,reason:String(e.message||e)}}finally{if(globalThis.__PB_HOST_START_SCOPE?.ticket===" + JsonSerializer.Serialize(startTicket) + ")globalThis.__PB_HOST_START_SCOPE=null}})()");
				JsonNode currentAccount = null;
				for (int i2 = 0; i2 < 100; i2++)
				{
					RequireRunIntent(requestedIntent);
					currentAccount = JsonNode.Parse(await GameScriptAsync("globalThis.__PB_START_RESULT??null"));
					if (currentAccount != null)
					{
						break;
					}
					await Task.Delay(200);
				}
				RequireRunIntent(requestedIntent);
				if (currentAccount == null)
				{
					await GameScriptAsync("if(globalThis.__PB_START_TICKET===" + JsonSerializer.Serialize(startTicket) + ")globalThis.__PB_START_TICKET=null");
					throw new InvalidOperationException("游戏操作设置准备超时，未开始挂机。请检查连接后重试。");
				}
				if (!Flag(currentAccount?["ok"]))
				{
					throw new InvalidOperationException(Str(currentAccount?["reason"]) ?? "游戏接口检查未通过，尚未开始挂机");
				}
				if (ProcessStart == null)
				{
					ProcessStart = DateTimeOffset.Now.ToString("O");
				}
				Log("info", autoManage ? "开始自动托管" : "开始挂机", (autoManage ? "仅接管当前原生对局，本局结束后停止；" : "自动控制已接管，") + Str(config["hotkeyToggle"]) + " 暂停/继续，" + Str(config["hotkeyReleaseMouse"]) + " 释放鼠标。快捷键可在设置中修改。");
			}
			finally
			{
				await DiscardRunStartScopeAsync(startTicket);
			}
			break;
		}
		case "releaseMouse":
		{
			if (!ready)
			{
				throw new InvalidOperationException("游戏窗口正在加载，请稍后再释放鼠标。");
			}
			JsonNode jsonNode6 = JsonNode.Parse(await GameScriptAsync("(()=>{const p=globalThis.__PB_PILOT;if(typeof p?.releaseMouse==='function')p.releaseMouse();else document.exitPointerLock?.();return {enabled:p?.enabled===true,state:p?.app?.run?.state??null}})()"));
			PanelView.Focus();
			Log("info", "鼠标已释放", ((Flag(jsonNode6?["enabled"]) && Str(jsonNode6?["state"]) == "play") ? "挂机继续运行。" : "当前暂停或未开始状态保持不变。") + "可操作下方界面或其他窗口；点击游戏可重新进入原生鼠标控制。");
			break;
		}
		case "pause":
			if (queuedIntent.HasValue && queuedIntent.Value != intentGeneration)
			{
				break;
			}
			if (!queuedIntent.HasValue)
			{
				CancelRecoveryIntent("用户暂停");
			}
			if (!gameProcessFailed)
			{
				try
				{
					await GameScriptAsync("globalThis.__PB_PILOT?.stop('用户暂停')");
				}
				catch
				{
				}
			}
			Log("info", "已停止脚本操作", "已释放移动、瞄准和技能操作，游戏可继续由你操作；自动恢复和待启动请求已取消。点击继续将接管当前对局。");
			break;
		case "saveRecoveryLogin":
			await SaveRecoveryLoginAsync(payload);
			commandResult = RecoveryLoginState();
			break;
		case "readRecoveryLogin":
			commandResult = await ReadRecoveryLoginAsync();
			break;
		case "clearRecoveryLogin":
			await ClearRecoveryLoginAsync();
			commandResult = RecoveryLoginState();
			break;
		case "importVisibleBuild":
			commandResult = await ImportVisibleBuild(payload);
			break;
		case "importCustomPlanFile":
		case "saveCustomPlan":
		case "importCustomPlans":
		case "exportCustomPlans":
		case "deleteCustomPlan":
			commandResult = await CustomPlanCommand(action, payload);
			break;
		case "getPrerequisites":
			commandResult = (await prerequisites.InspectAsync()).ToJson();
			break;
		case "installPrerequisites":
			commandResult = (await prerequisites.InstallMissingAsync()).ToJson();
			Log(prerequisites.Current.Ready ? "info" : "error", "前置检查结果", prerequisites.Current.ToJson()["reason"]?.ToString() ?? "检查完成");
			break;
		case "showPrerequisiteLicense":
			ReleaseNotes.Show(this, "Microsoft WebView2 Runtime 许可条款", prerequisites.ReadLicenseText());
			commandResult = new JsonObject { ["shown"] = true };
			break;
		case "showChangelog":
		{
			string text6 = ReleaseNotes.Ensure(portable);
			ReleaseNotes.Show(this, "PokéBonk 旅伴 · 更新日志", File.ReadAllText(text6, Encoding.UTF8));
			commandResult = new JsonObject { ["path"] = text6 };
			break;
		}
		case "showClientUpdates":
			if (clientUpdatesWindow == null)
			{
				DisclaimerWindow updatesWindow = new DisclaimerWindow(this, updatesOnly: true);
				clientUpdatesWindow = updatesWindow;
				updatesWindow.Closed += delegate
				{
					if (clientUpdatesWindow == updatesWindow)
					{
						clientUpdatesWindow = null;
					}
				};
				updatesWindow.Show();
			}
			else
			{
				clientUpdatesWindow.Activate();
			}
			commandResult = new JsonObject { ["shown"] = true };
			break;
		case "generateUpdatePrompt":
		{
			JsonObject jsonObject = new JsonObject();
			JsonObject jsonObject2 = jsonObject;
			jsonObject2["text"] = await MaintenancePrompt(Str(payload["kind"]) ?? "full");
			commandResult = jsonObject;
			break;
		}
		case "copyText":
		{
			string? obj = Str(payload["text"]) ?? "";
			if (obj.Length > 2000000)
			{
				throw new InvalidOperationException("文本过长");
			}
			await SetClipboardTextWithRetryAsync(obj, Clipboard.SetText, (int milliseconds) => Task.Delay(milliseconds));
			commandResult = new JsonObject { ["copied"] = true };
			break;
		}
		case "checkUpdates":
			await CheckForUpdatesAsync(manual: true);
			commandResult = updateStatus.DeepClone().AsObject();
			break;
		case "testArmRecoveryIntent":
			flag = !diagnostics;
			if (!flag)
			{
				flag = await GameScriptAsync("(()=>{const a=globalThis.__PB_BRIDGE?.app;return !!a&&!a.meta?.account&&!a.run})()") != "true";
			}
			if (flag)
			{
				throw new InvalidOperationException("该人工恢复意图入口仅限无账号、无对局的隔离诊断窗口");
			}
			ArmRunIntent(allowGuestFallback: false);
			expectedRecoveryIdentity = null;
			RequestRecovery("diagnostic-no-account-intent");
			commandResult = new JsonObject
			{
				["armed"] = true,
				["scope"] = "no-account-no-run-host-fixture"
			};
			break;
		case "testClose":
			if (!diagnostics)
			{
				throw new InvalidOperationException("该操作仅供隔离测试使用");
			}
			if (gameProcessFailed)
			{
				if (game == null || game["accountType"] != null || game["profile"] != null || game["state"] != null)
				{
					throw new InvalidOperationException("无法确认是无账号、无对局的隔离测试窗口；请手动关闭客户端");
				}
			}
			else if (await GameScriptAsync("(()=>{const a=globalThis.__PB_BRIDGE?.app;return (!a?.meta?.account||a.meta.account.guest===true)&&(!a?.run||a.run.state==='over')})()") != "true")
			{
				if (!(await AuthorizedTestAccountAsync(requireFinished: true)))
				{
					throw new InvalidOperationException("仅无活动对局的隔离窗口或本机授权测试身份可关闭");
				}
				commandResult = new JsonObject { ["accepted"] = true };
				base.Dispatcher.BeginInvoke((Action)async delegate
				{
					if (await AuthorizedTestAccountAsync(requireFinished: true))
					{
						Close();
					}
				}, DispatcherPriority.ContextIdle);
				break;
			}
			commandResult = new JsonObject { ["accepted"] = true };
			base.Dispatcher.BeginInvoke(new Action(base.Close), DispatcherPriority.ContextIdle);
			break;
		case "testPauseForPlanFileDialog":
		{
			if (!diagnostics)
			{
				throw new InvalidOperationException("此入口仅供隔离测试使用");
			}
			bool authorizedPause = false;
			if (await GameScriptAsync("(()=>{const a=globalThis.__PB_BRIDGE?.app?.meta?.account;return !a||a.guest===true})()") != "true")
			{
				authorizedPause = await AuthorizedTestAccountAsync(requireFinished: false);
				if (!authorizedPause)
				{
					throw new InvalidOperationException("此入口只允许隔离窗口或本机授权测试身份");
				}
			}
			await PauseForPlanFileDialog(authorizedPause);
			commandResult = new JsonObject { ["paused"] = !Flag(game?["enabled"]) };
			break;
		}
		case "expand":
			SetPanelHidden(hidden: false);
			panelExpanded = Flag(payload["expanded"]);
			if (Flag(payload["encyclopedia"]) && Flag(payload["expanded"]))
			{
				base.WindowState = WindowState.Maximized;
			}
			ControlRow.Height = new GridLength(Flag(payload["expanded"]) ? Math.Max(250.0, Math.Min(Flag(payload["encyclopedia"]) ? 780 : 600, base.ActualHeight - 345.0)) : 320.0);
			break;
		case "panelVisibility":
		{
			JsonValueKind? jsonValueKind = payload["hidden"]?.GetValueKind();
			if (jsonValueKind.HasValue)
			{
				JsonValueKind valueOrDefault = jsonValueKind.GetValueOrDefault();
				if (valueOrDefault - 5 <= JsonValueKind.Object)
				{
					flag = true;
					goto IL_3605;
				}
			}
			flag = false;
			goto IL_3605;
		}
		case "getLogEntries":
			commandResult = ReadLogPage(Str(payload["filter"]) ?? "all");
			break;
		case "openLogs":
			ShowLogDocument();
			commandResult = new JsonObject { ["path"] = portable.ReadableLogPath };
			break;
		case "clearLogs":
			portable.Clear();
			storageError = "";
			logs.Clear();
			logRevision++;
			logDocumentText?.Clear();
			commandResult = new JsonObject { ["cleared"] = true };
			break;
		case "openData":
			Process.Start(new ProcessStartInfo(storage)
			{
				UseShellExecute = true
			});
			break;
		case "login":
			GameView.Focus();
			break;
		case "openLink":
		{
			if (Uri.TryCreate(Str(payload["url"]), UriKind.Absolute, out Uri result) && result.Scheme == "https" && (result.Host == "pokebonk.com" || result.Host == "api.pokebonk.com" || result.Host == "www.youtube.com" || result.Host == "poke-bonk.com"))
			{
				Process.Start(new ProcessStartInfo(result.AbsoluteUri)
				{
					UseShellExecute = true
				});
				break;
			}
			throw new Exception("该链接不在已收录的攻略来源中");
		}
		default:
			{
				throw new Exception("不支持的操作：" + action);
			}
			IL_3605:
			if (!flag)
			{
				throw new InvalidOperationException("面板显示开关格式无效");
			}
			SetPanelHidden(Flag(payload["hidden"]));
			break;
		}
		flag = ready && !gameProcessFailed;
		if (flag)
		{
			bool flag3;
			switch (action)
			{
			case "start":
			case "resume":
			case "pause":
				flag3 = true;
				break;
			default:
				flag3 = false;
				break;
			}
			flag = flag3;
		}
		if (flag)
		{
			game = JsonNode.Parse(await GameScriptAsync("globalThis.__PB_PILOT?.snapshot() ?? null"))?.AsObject();
			status = Str(game?["status"]) ?? status;
		}
		await SendState();
	}

	private async Task PersistConfigAsync(JsonObject before, bool beforeMigration)
	{
		try
		{
			await portable.WriteSettingsAtomicAsync(config.ToJsonString(JsonOptions));
		}
		catch
		{
			config = before;
			unlockTargetsMigrated = beforeMigration;
			throw;
		}
	}

	private void OnPrerequisitesChanged(PrerequisiteSnapshot snapshot)
	{
		base.Dispatcher.BeginInvoke((Action)delegate
		{
			if (!closing)
			{
				SendState();
			}
		});
	}

	internal void CloseForPrerequisiteRecovery()
	{
		CancelRecoveryIntent("前置安装重开窗口");
		timer.Stop();
		mayClose = true;
		Close();
	}

	private void ValidateConfig()
	{
		JsonNode? jsonNode = config["mode"];
		string text = ((jsonNode != null && jsonNode.GetValueKind() == JsonValueKind.String) ? Str(config["mode"]) : null);
		JsonNode? jsonNode2 = config["unlockCategory"];
		string text2 = ((jsonNode2 != null && jsonNode2.GetValueKind() == JsonValueKind.String) ? Str(config["unlockCategory"]) : null);
		bool flag = text == "events" || (text == "unlocks" && text2 == "events");
		config["logRetentionRuns"] = ClientLogRetention.Normalize(config["logRetentionRuns"]);
		config.Remove("expertMode");
		CostSettings.Normalize(config);
		TimedBehaviorSettings.Normalize(config);
		NormalizeFlightInteractionSettings(config);
		string[] array = new string[]
		{
			"autoUpgrade", "autoClaim", "reserveMoveSlot", "safeMode", "bossPriority", "portalPriority", "shopPriority", "shinyPriority", "capturePriority", "jumpMove", "slideMove", "bossRetreat", "flightMove",
			"flightNoInteractions", "riskyInteractions", "autoManageBuildPriority", "pickupBonkoin", "expandVitaminSlots", "shinyStageWait", "shinyStayAfterFinalClear", "autoUnlockItems"
		};
		JsonObject jsonObject;
		JsonValueKind? jsonValueKind;
		bool flag2;
		foreach (string text3 in array)
		{
			jsonValueKind = config[text3]?.GetValueKind();
			if (jsonValueKind.HasValue)
			{
				JsonValueKind valueOrDefault = jsonValueKind.GetValueOrDefault();
				if (valueOrDefault - 5 <= JsonValueKind.Object)
				{
					flag2 = true;
					goto IL_0205;
				}
			}
			flag2 = false;
			goto IL_0205;
			IL_0271:
			string propertyName;
			jsonObject[propertyName] = flag2;
			continue;
			IL_0205:
			if (flag2)
			{
				continue;
			}
			jsonObject = config;
			propertyName = text3;
			if (!(text3 == "shinyPriority"))
			{
				switch (text3)
				{
				case "capturePriority":
				case "riskyInteractions":
				case "pickupBonkoin":
				case "expandVitaminSlots":
					break;
				default:
					goto IL_026e;
				}
			}
			flag2 = true;
			goto IL_0271;
			IL_026e:
			flag2 = false;
			goto IL_0271;
		}
		JsonNode jsonNode3 = config["flightJumpItemCount"];
		config["flightJumpItemCount"] = ((jsonNode3 != null && jsonNode3.GetValueKind() == JsonValueKind.Number && double.TryParse(jsonNode3.ToJsonString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var result) && double.IsFinite(result)) ? ((int)Math.Floor(Math.Clamp(result, 1.0, 99.0) + 0.5)) : 5);
		string[] array2 = HotkeyFields.Select((string field) => Str(config[field]) ?? "").ToArray();
		if (array2.Any((string key) => !ValidHotkey(key)) || array2.Distinct<string>(StringComparer.Ordinal).Count() != array2.Length)
		{
			array = HotkeyFields;
			foreach (string propertyName2 in array)
			{
				config[propertyName2] = Defaults()[propertyName2]?.DeepClone();
			}
		}
		JsonObject jsonObject2 = config;
		JsonNode? jsonNode4 = config["mode"];
		string? mode = ((jsonNode4 != null && jsonNode4.GetValueKind() == JsonValueKind.String) ? Str(config["mode"]) : null);
		JsonNode? jsonNode5 = config["unlockCategory"];
		jsonObject2["mode"] = NormalizeMode(mode, (jsonNode5 != null && jsonNode5.GetValueKind() == JsonValueKind.String) ? Str(config["unlockCategory"]) : null);
		JsonNode? jsonNode6 = config["leaderboardGoal"];
		string text4 = ((jsonNode6 != null && jsonNode6.GetValueKind() == JsonValueKind.String) ? Str(config["leaderboardGoal"]) : null);
		jsonObject = config;
		flag2 = ((text4 == "endless" || text4 == "survival") ? true : false);
		jsonObject["leaderboardGoal"] = (flag2 ? "endless" : ((text4 == "time") ? "time" : "kills"));
		config["modeSettings"] = NormalizeModeSettings(config["modeSettings"], null, null, null, migrateLegacy: false, Str(config["leaderboardGoal"]));
		config["finalReplacements"] = NormalizeFinalReplacements(config["finalReplacements"]);
		config["overlay"] = OverlaySettings.Normalize(config["overlay"]);
		config["convenience"] = ConvenienceSettings.Normalize(config["convenience"], config);
		config["shinyStageWaitSeconds"] = Math.Clamp((config["shinyStageWaitSeconds"] == null) ? 600 : Num(config["shinyStageWaitSeconds"]), 1, 86400);
		config["display"] = DisplaySettings.Normalize(config["display"]);
		if (!new string[2] { "missing", "target" }.Contains<string>(Str(config["shinyMode"])))
		{
			config["shinyMode"] = "missing";
		}
		JsonArray selectedShinyTypes = config["shinyTypes"] as JsonArray;
		string[] array3 = new string[2] { "shiny", "classic" }.Where((string type) => selectedShinyTypes?.Any((JsonNode node) => node != null && node.GetValueKind() == JsonValueKind.String && node.GetValue<string>() == type) ?? false).ToArray();
		config["shinyTypes"] = new JsonArray(((IEnumerable<string>)((array3.Length != 0) ? array3 : new string[2] { "shiny", "classic" })).Select((Func<string, JsonNode>)((string type) => JsonValue.Create(type))).ToArray());
		if (config["shinyTargetId"] != null && (Num(config["shinyTargetId"]) < 1 || Num(config["shinyTargetId"]) > 100000))
		{
			config["shinyTargetId"] = null;
		}
		JsonObject jsonObject3 = (config["unlockTargets"] as JsonObject) ?? DefaultUnlockTargets();
		if (!unlockTargetsMigrated && Str(config["shinyMode"]) == "target" && Num(config["shinyTargetId"]) > 0)
		{
			jsonObject3["shiny"] = "shiny:" + Num(config["shinyTargetId"]);
		}
		JsonObject jsonObject4 = DefaultUnlockTargets();
		foreach (string item3 in new string[1] { "all" }.Concat(UnlockCategories))
		{
			JsonNode? jsonNode7 = jsonObject3[item3];
			string text5 = ((jsonNode7 != null && jsonNode7.GetValueKind() == JsonValueKind.String) ? Str(jsonObject3[item3]) : null);
			if (text5 != null && Regex.IsMatch(text5, "^(maps|dex|characters|research|shiny|lab|items|achievements|appearance|events):[A-Za-z0-9_:.+-]{1,100}$") && (item3 == "all" || text5.StartsWith(item3 + ":", StringComparison.Ordinal)))
			{
				jsonObject4[item3] = text5;
			}
		}
		config["unlockTargets"] = jsonObject4;
		unlockTargetsMigrated = true;
		config["eventTargets"] = NormalizeEventTargets(config["eventTargets"], jsonObject4["events"]);
		if (flag)
		{
			string text6 = Str(jsonObject4["events"]);
			if (text6 != null)
			{
				string[] array4 = text6.Split(':');
				if (array4 != null && array4.Length >= 3 && array4[0] == "events" && ValidEventId(array4[1]))
				{
					config["mode"] = ((array4[1] == "halloween26") ? "tower" : ("event:" + array4[1]));
				}
			}
		}
		JsonNode? jsonNode8 = config["unlockCategory"];
		if (jsonNode8 == null || jsonNode8.GetValueKind() != JsonValueKind.String || (Str(config["unlockCategory"]) != "all" && !UnlockCategories.Contains<string>(Str(config["unlockCategory"]))))
		{
			config["unlockCategory"] = "all";
		}
		string text7 = Str(jsonObject4["shiny"]) ?? "auto";
		config["shinyMode"] = ((text7 == "auto") ? "missing" : "target");
		config["shinyTargetId"] = ((text7.StartsWith("shiny:", StringComparison.Ordinal) && int.TryParse(text7.Substring(6), out var result2) && result2 > 0) ? JsonValue.Create(result2) : null);
		array = new string[2] { "shinyStopWhenDone", "shinyUseStone" };
		foreach (string text8 in array)
		{
			jsonValueKind = config[text8]?.GetValueKind();
			if (jsonValueKind.HasValue)
			{
				JsonValueKind valueOrDefault = jsonValueKind.GetValueOrDefault();
				if (valueOrDefault - 5 <= JsonValueKind.Object)
				{
					flag2 = true;
					goto IL_0aff;
				}
			}
			flag2 = false;
			goto IL_0aff;
			IL_0aff:
			if (!flag2)
			{
				config[text8] = text8 == "shinyStopWhenDone";
			}
		}
		jsonValueKind = config["randomDelay"]?.GetValueKind();
		if (jsonValueKind.HasValue)
		{
			JsonValueKind valueOrDefault = jsonValueKind.GetValueOrDefault();
			if (valueOrDefault - 5 <= JsonValueKind.Object)
			{
				flag2 = true;
				goto IL_0b7f;
			}
		}
		flag2 = false;
		goto IL_0b7f;
		IL_0b7f:
		if (!flag2)
		{
			config["randomDelay"] = true;
		}
		(string, int)[] array5 = new(string, int)[2]
		{
			("randomDelayMinMs", 600),
			("randomDelayMaxMs", 1800)
		};
		for (int i = 0; i < array5.Length; i++)
		{
			(string, int) tuple = array5[i];
			string item = tuple.Item1;
			int item2 = tuple.Item2;
			JsonNode jsonNode9 = config[item];
			config[item] = ((jsonNode9 != null && jsonNode9.GetValueKind() == JsonValueKind.Number && double.TryParse(jsonNode9.ToJsonString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var result3) && double.IsFinite(result3)) ? ((int)Math.Clamp(Math.Round(result3, MidpointRounding.AwayFromZero), 0.0, 30000.0)) : item2);
		}
		if (Num(config["randomDelayMinMs"]) > Num(config["randomDelayMaxMs"]))
		{
			int num = Num(config["randomDelayMinMs"]);
			config["randomDelayMinMs"] = Num(config["randomDelayMaxMs"]);
			config["randomDelayMaxMs"] = num;
		}
		config["fps"] = Math.Clamp(Num(config["fps"]), 30, 144);
		config["tier"] = Math.Clamp(Num(config["tier"]), 0, 2);
	}

	private static async Task SetClipboardTextWithRetryAsync(string text, Action<string> write, Func<int, Task> delay)
	{
		int attempt = 0;
		while (true)
		{
			try
			{
				write(text);
				break;
			}
			catch (COMException ex) when (ex.HResult == -2147221040 && attempt < 4)
			{
				await delay(50 * (attempt + 1));
			}
			attempt++;
		}
	}

	private static bool ValidHotkey(string value)
	{
		return Regex.IsMatch(value, "^(Ctrl\\+)?(Alt\\+)?(Shift\\+)?(F([1-9]|1[0-2])|Key[A-Z]|Digit[0-9]|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Space|Enter|Tab|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|PageUp|PageDown|Insert|Delete)$", RegexOptions.CultureInvariant);
	}

	private string? HotkeyAction(string? chord)
	{
		if (!string.IsNullOrWhiteSpace(chord))
		{
			if (!(chord == Str(config["hotkeyToggle"])))
			{
				if (!(chord == Str(config["hotkeyStop"])))
				{
					if (!(chord == Str(config["hotkeyReleaseMouse"])))
					{
						return null;
					}
					return "releaseMouse";
				}
				return "pause";
			}
			return "toggle";
		}
		return null;
	}

	private void ValidateIncomingHotkeys(JsonObject incoming)
	{
		if (HotkeyFields.Any(incoming.ContainsKey))
		{
			string[] array = HotkeyFields.Select((string field) => Str(incoming.ContainsKey(field) ? incoming[field] : config[field]) ?? "").ToArray();
			if (array.Any((string key) => !ValidHotkey(key)))
			{
				throw new InvalidOperationException("快捷键格式无效，请在设置中点击输入框并按下需要的按键组合。");
			}
			if (array.Distinct<string>(StringComparer.Ordinal).Count() != array.Length)
			{
				throw new InvalidOperationException("三个快捷键不能相同，请分别设置。");
			}
		}
	}

	private async void QueueHotkey(string action)
	{
		JsonObject payload = new JsonObject();
		bool locked = false;
		long? preparedIntent = null;
		try
		{
			action = await PrepareAuthorizedHostActionAsync(action, payload);
			long queuedIntent = intentGeneration;
			preparedIntent = queuedIntent;
			await commandLock.WaitAsync();
			locked = true;
			await Command(action, payload, queuedIntent);
		}
		catch (Exception ex)
		{
			bool flag = preparedIntent == intentGeneration && wantedRunIntent;
			if (flag)
			{
				string text = action;
				bool flag2 = ((text == "start" || text == "resume") ? true : false);
				flag = flag2;
			}
			if (flag && (Str(config["mode"]) == "autoManage" || Str(payload["__hostAutoManageScopeTicket"]) != null))
			{
				CancelRecoveryIntent("自动托管启动未完成，请为当前局重新点击开始", notifyPage: false);
			}
			ReportOperationError(ex);
			flag = wantedRunIntent;
			if (flag)
			{
				string text = action;
				bool flag2 = ((text == "start" || text == "resume") ? true : false);
				flag = flag2;
			}
			if (flag && !(ex is OperationCanceledException))
			{
				RequestRecovery("start-interrupted");
			}
			if (storageError.Length <= 0)
			{
				await SendState();
			}
			else
			{
				await HandleStorageFailureAsync(ex);
			}
		}
		finally
		{
			string text2 = Str(payload["__hostAutoManageScopeTicket"]);
			if (text2 != null)
			{
				await DiscardRunStartScopeAsync(text2);
			}
			if (locked)
			{
				operationStatus = null;
				commandLock.Release();
			}
		}
	}

	private string MapName(string? id)
	{
		return Str(catalog["maps"]?.AsArray().OfType<JsonObject>().FirstOrDefault((JsonObject map) => Str(map["id"]) == id)?["name"]) ?? id ?? "地图待确认";
	}

	private string DifficultyName(JsonNode? tier)
	{
		if (tier == null || tier.GetValueKind() != JsonValueKind.Number)
		{
			return "难度待原生确认";
		}
		return Num(tier) switch
		{
			0 => "普通", 
			1 => "困难", 
			2 => "噩梦", 
			_ => "原生难度 " + Num(tier), 
		};
	}

	private string DescribeRun(JsonNode record, JsonNode? species)
	{
		return MapName(Str(record["biome"])) + " · " + DifficultyName(record["tier"]) + " · " + CharacterName(Num(species));
	}

	private void BindLogRun(string marker)
	{
		logRunGroup = ClientLogRetention.Group(observedAccount.IdentityHash, marker);
		logRunStartedAt = ClientLogRetention.StartedAt(marker);
	}

	private void ResetLogIdentity()
	{
		savedRewards.Reset();
		logRunGroup = (logRunStartedAt = null);
	}

	private void LoadLogHistory()
	{
		int limit = ClientLogRetention.Normalize(config["logRetentionRuns"]);
		IReadOnlyList<JsonObject> readOnlyList;
		if (limit == 0)
		{
			readOnlyList = portable.ReadEntries();
		}
		else
		{
			readOnlyList = portable.ReadSelectedEntries((IEnumerable<JsonObject> rows) => ClientLogRetention.Select(rows.Where(KeepJournalEntry), limit));
			portable.RewriteEntries(readOnlyList);
		}
		logs.Clear();
		logs.AddRange(readOnlyList.TakeLast(2000));
		logRevision++;
	}

	private static bool KeepJournalEntry(JsonObject row)
	{
		return ClientLogPolicy.Keep(Str(row["type"]) ?? Str(row["kind"]) ?? "info", Str(row["title"]) ?? Str(row["message"]) ?? "");
	}

	private void ApplyLogRetention()
	{
		int limit = ClientLogRetention.Normalize(config["logRetentionRuns"]);
		if (limit != 0)
		{
			string text = Str(game?["state"]);
			bool flag = ((text == null || text == "over") ? true : false);
			string active = ((!flag) ? logRunGroup : null);
			IReadOnlyList<JsonObject> readOnlyList = portable.ReadSelectedEntries((IEnumerable<JsonObject> rows) => ClientLogRetention.Select(rows.Where(KeepJournalEntry), limit, active));
			portable.RewriteEntries(readOnlyList);
			logs.Clear();
			logs.AddRange(readOnlyList.TakeLast(2000));
			if (logDocumentText != null)
			{
				logDocumentText.Text = File.ReadAllText(portable.ValidatePath(portable.ReadableLogPath));
			}
		}
		logRevision++;
	}

	private JsonObject ReadLogPage(string filter)
	{
		if (!ClientLogPolicy.Filters.Contains(filter))
		{
			throw new InvalidOperationException("日志分类无效");
		}
		long matches = 0L;
		long total = 0L;
		IReadOnlyList<JsonObject> source = portable.ReadSelectedEntries(delegate(IEnumerable<JsonObject> rows)
		{
			Queue<JsonObject> queue = new Queue<JsonObject>();
			foreach (JsonObject row in rows)
			{
				if (KeepJournalEntry(row))
				{
					total++;
					if (ClientLogPolicy.Matches(row, filter))
					{
						matches++;
						JsonObject jsonObject = row;
						if (jsonObject["category"] == null)
						{
							JsonNode jsonNode = (jsonObject["category"] = ClientLogPolicy.Category(row));
						}
						queue.Enqueue(row);
						if (queue.Count > 500)
						{
							queue.Dequeue();
						}
					}
				}
			}
			return queue.ToArray();
		});
		return new JsonObject
		{
			["logs"] = new JsonArray(source.Select((JsonObject row) => row.DeepClone()).ToArray()),
			["matches"] = matches,
			["total"] = total,
			["retentionRuns"] = ClientLogRetention.Normalize(config["logRetentionRuns"]),
			["revision"] = logRevision,
			["previewLimit"] = 500
		};
	}

	private void ObserveSavedRewards(JsonObject savedProfile, string? group = null, string? startedAt = null)
	{
		foreach (ClientSavedReward reward in savedRewards.Observe(savedProfile))
		{
			string detail;
			if (reward.Category == "map")
			{
				detail = MapName(reward.Key) + " · " + ((reward.After == 0) ? "可进入" : ("已通过" + DifficultyName(JsonValue.Create(reward.After - 1)))) + " · 游戏已确认的存档进度";
			}
			else if (reward.Category == "research")
			{
				string text = Str(catalog["encyclopedia"]?["entries"]?.AsArray().OfType<JsonObject>().FirstOrDefault((JsonObject entry) => Str(entry["id"]) == "lab:" + reward.Key)?["name"]) ?? reward.Key;
				detail = text + " · " + reward.Before + " → " + reward.After + " · 游戏已确认的研究等级";
			}
			else
			{
				string category = reward.Category;
				if ((category == "bonkoin" || category == "stardust") ? true : false)
				{
					detail = "+" + reward.Amount + " · 按原生累计获得数确认，消费不重复计算为收入";
				}
				else
				{
					bool flag;
					switch (reward.Category)
					{
					case "dex":
					case "character":
					case "shiny":
						flag = true;
						break;
					default:
						flag = false;
						break;
					}
					if (flag)
					{
						detail = (int.TryParse(reward.Key, out var result) ? CharacterName(result) : reward.Key);
						detail += " · 游戏已确认保存";
						if (reward.Category == "dex")
						{
							newSeen++;
						}
						else if (reward.Category == "character")
						{
							newLeague++;
						}
						else
						{
							newShinies++;
						}
					}
					else
					{
						JsonObject jsonObject = catalog["unlockGoals"]?["targets"]?.AsArray().OfType<JsonObject>().FirstOrDefault((JsonObject row) => Str(row["key"]) == reward.Key || Str(row["id"]) == reward.Key || Str(row["id"]) == "appearance:" + reward.Key);
						detail = (Str(jsonObject?["name"]) ?? Str(jsonObject?["title"]) ?? reward.Key) + " · 游戏已确认保存";
					}
				}
			}
			Log("reward", reward.Title, detail, group, reward.Category, startedAt, isRunResult: false, group != null);
		}
	}

	private void ObserveRecoveredRewards(JsonObject entry)
	{
		if (entry["kind"] is JsonValue jsonValue && jsonValue.TryGetValue<string>(out string value) && !(value != "resynced") && entry["profileVerified"] is JsonValue jsonValue2 && jsonValue2.TryGetValue<bool>(out var value2) && value2 && entry["profileSource"] is JsonValue jsonValue3 && jsonValue3.TryGetValue<string>(out string value3) && !(value3 != "native-profile-load") && entry["profile"] is JsonObject savedProfile)
		{
			verifiedClearsHistoryLoaded = false;
			Log("info", "前局补存成功", "游戏补存及当前账号资料读取均已确认，按真实保存结果更新收获。");
			ObserveSavedRewards(savedProfile);
		}
	}

	private void ObserveLogSnapshotAtClose(JsonObject? snapshot)
	{
		if (observedAccount.Observe(snapshot, observedRuns, observedResults, observedEvents))
		{
			ResetRecoveryAccountBaseline();
			ResetLogIdentity();
			runKey = "";
		}
		if (observedAccount.HasIdentity)
		{
			ObserveSettlements(snapshot?["events"] as JsonArray);
		}
	}

	private void ObserveSettlements(JsonArray? events)
	{
		foreach (JsonObject item in (from v in events?.OfType<JsonObject>()
			where Str(v["kind"]) == "settlement"
			select v) ?? Array.Empty<JsonObject>())
		{
			string text = Str(item["id"]) ?? item["runAt"]?.ToJsonString() ?? "";
			if (observedResults.Add(text))
			{
				QueueVerifiedClearReceipt(item);
				string marker = item["runAt"]?.ToJsonString() ?? text;
				string text2 = ClientLogRetention.Group(observedAccount.IdentityHash, marker);
				string text3 = ClientLogRetention.StartedAt(marker);
				completedRuns++;
				ClientRunOutcome clientRunOutcome = ClientProgressChanges.SettlementOutcome(item);
				kills += Num(item["kills"]);
				if (clientRunOutcome.NormalClear)
				{
					wins++;
				}
				Log(Flag(item["saved"]) ? "result" : "error", clientRunOutcome.Title, DescribeRun(item, item["species"]) + " · 用时 " + TimeSpan.FromSeconds(Num(item["time"])).ToString("hh\\:mm\\:ss") + " · 击败 " + Num(item["kills"]) + " 个敌人 · " + clientRunOutcome.Detail + (Flag(item["saved"]) ? (" · 对局星尘 +" + Num(item["stardust"])) : (" · " + Str(item["error"]))), text2, null, text3, isRunResult: true);
				if (Flag(item["saved"]) && item["profile"] is JsonObject savedProfile)
				{
					ObserveSavedRewards(savedProfile, text2, text3);
				}
				ApplyLogRetention();
			}
		}
	}

	private void Log(string kind, string title, string detail, string? resultRun = null, string? category = null, string? resultStartedAt = null, bool isRunResult = false, bool associateCurrentRun = true)
	{
		if (ClientLogPolicy.Keep(kind, title))
		{
			JsonObject jsonObject = new JsonObject
			{
				["id"] = Guid.NewGuid().ToString("N"),
				["at"] = DateTimeOffset.Now.ToString("O"),
				["time"] = DateTimeOffset.Now.ToString("O"),
				["type"] = kind,
				["level"] = ((kind == "error") ? "error" : "info"),
				["title"] = title,
				["message"] = title,
				["detail"] = detail
			};
			jsonObject["journalSchema"] = 2;
			jsonObject["category"] = category ?? ClientLogPolicy.Category(kind, title);
			string text = resultRun ?? (associateCurrentRun ? logRunGroup : null);
			if (text != null)
			{
				jsonObject["runGroup"] = text;
				jsonObject["runStartedAt"] = resultStartedAt ?? logRunStartedAt;
			}
			if (isRunResult)
			{
				jsonObject["isRunResult"] = true;
			}
			long timestamp = Stopwatch.GetTimestamp();
			portable.Append(jsonObject);
			journalWriteMilliseconds += Stopwatch.GetElapsedTime(timestamp).TotalMilliseconds;
			journalWrites++;
			storageError = "";
			logs.Add(jsonObject);
			if (logs.Count > 2000)
			{
				logs.RemoveRange(0, 500);
			}
			logRevision++;
			PostPanelMessage(new JsonObject
			{
				["event"] = "log",
				["data"] = jsonObject.DeepClone()
			});
		}
	}

	private void ObserveRegionProgress()
	{
		string text = Str(game?["state"]);
		bool flag = ((text == null || text == "over") ? true : false);
		if (flag || game == null)
		{
			return;
		}
		string text2 = ClientProgressChanges.RegionLabel(game.AsObject());
		if (text2 != null)
		{
			string regionKey = runKey + ":" + Str(game?["biome"]) + ":" + Str(game?["nativeMode"]) + ":" + text2;
			if (regionProgress.Advance(runKey, regionKey, Num(game?["time"])))
			{
				Log("region", "区域推进", MapName(Str(game?["biome"])) + " · " + text2);
			}
		}
	}

	private PublicReloadBoundary? PublicDialogBoundary(CoreWebView2 core)
	{
		if (GameView.CoreWebView2 != core || !Uri.TryCreate(core.Source, UriKind.Absolute, out Uri result) || result.Scheme != "https" || result.IdnHost != "pokebonk.com" || !result.IsDefaultPort || result.UserInfo.Length != 0)
		{
			return null;
		}
		return new PublicReloadBoundary(core, result.AbsoluteUri, pageGeneration, intentGeneration, recoveryGeneration, expectedRecoveryIdentity, publicDialogObservedIdentity, wantedRunIntent, recoveryRequested, HostScheduleAllowed, closing);
	}

	private void RegisterPublicGameDialogs(CoreWebView2 core)
	{
		core.Settings.AreDefaultScriptDialogsEnabled = false;
		core.ScriptDialogOpening += OnPublicGameDialog;
	}

	private void RetirePublicGameDialogs()
	{
		publicReloadProof = null;
		publicReloadPermit?.Retire();
		publicReloadPermit = null;
		PublicScriptDialogWindow[] array = publicGameDialogs.ToArray();
		foreach (PublicScriptDialogWindow publicScriptDialogWindow in array)
		{
			try
			{
				publicScriptDialogWindow.CancelOwned();
			}
			catch (InvalidOperationException)
			{
			}
		}
		publicGameDialogs.Clear();
	}

	private void ObservePublicReloadNavigation(CoreWebView2 core, CoreWebView2NavigationStartingEventArgs args)
	{
		PublicReloadPermit publicReloadPermit = this.publicReloadPermit;
		if (publicReloadPermit != null && publicReloadPermit.Available)
		{
			bool knownReload;
			try
			{
				knownReload = args.NavigationKind == CoreWebView2NavigationKind.Reload;
			}
			catch (Exception ex) when (((ex is NotImplementedException || ex is InvalidCastException || ex is COMException || ex is InvalidOperationException) ? 1 : 0) != 0)
			{
				publicReloadPermit.Retire();
				status = "本次刷新请手动确认；当前浏览器前置不支持刷新来源校验，可通过“下载前置”更新后重启。";
				return;
			}
			PublicReloadBoundary publicReloadBoundary = PublicDialogBoundary(core);
			if (publicReloadBoundary == null || !publicReloadPermit.Navigation(publicReloadBoundary, args.Uri, args.NavigationId, knownReload))
			{
				this.publicReloadPermit = null;
			}
		}
	}

	private void OnPublicGameDialog(object? sender, CoreWebView2ScriptDialogOpeningEventArgs args)
	{
		CoreWebView2 core = sender as CoreWebView2;
		if (core == null || GameView.CoreWebView2 != core || closing)
		{
			return;
		}
		long manualPage;
		string manualSource;
		CoreWebView2Deferral deferral;
		bool finished;
		PublicScriptDialogWindow window;
		try
		{
			PublicReloadBoundary publicReloadBoundary = PublicDialogBoundary(core);
			if (publicReloadBoundary != null)
			{
				PublicReloadPermit? obj = publicReloadPermit;
				if (obj != null && obj.Consume(publicReloadBoundary, args.Uri, args.Kind == CoreWebView2ScriptDialogKind.Beforeunload))
				{
					args.Accept();
					publicReloadPermit = null;
					return;
				}
			}
			manualPage = pageGeneration;
			manualSource = core.Source;
			deferral = args.GetDeferral();
			finished = false;
			window = null;
			try
			{
				window = new PublicScriptDialogWindow(this, args.Message, args.DefaultText, args.Kind == CoreWebView2ScriptDialogKind.Prompt, args.Kind == CoreWebView2ScriptDialogKind.Alert, args.Kind == CoreWebView2ScriptDialogKind.Beforeunload, Complete);
				publicGameDialogs.Add(window);
				window.Show();
			}
			catch (Exception ex) when (((ex is COMException || ex is InvalidOperationException) ? 1 : 0) != 0)
			{
				Complete(accept: false, "");
				if (window != null)
				{
					try
					{
						window.CancelOwned();
						return;
					}
					catch (InvalidOperationException)
					{
						return;
					}
				}
			}
		}
		catch (Exception ex3) when (((ex3 is COMException || ex3 is InvalidOperationException) ? 1 : 0) != 0)
		{
			publicReloadPermit?.Retire();
			publicReloadPermit = null;
		}
		void Complete(bool accept, string text)
		{
			if (finished)
			{
				return;
			}
			finished = true;
			try
			{
				bool flag = !closing && GameView.CoreWebView2 == core && pageGeneration == manualPage && core.Source == manualSource;
				if (accept && flag)
				{
					if (args.Kind == CoreWebView2ScriptDialogKind.Prompt)
					{
						args.ResultText = text;
					}
					args.Accept();
				}
			}
			catch (Exception ex4) when (((ex4 is COMException || ex4 is InvalidOperationException) ? 1 : 0) != 0)
			{
			}
			finally
			{
				if (window != null)
				{
					publicGameDialogs.Remove(window);
				}
				try
				{
					deferral.Complete();
				}
				catch (Exception ex5) when (((ex5 is COMException || ex5 is InvalidOperationException) ? 1 : 0) != 0)
				{
				}
			}
		}
	}

	private static string? PublicReloadIdentity(JsonNode? identity)
	{
		string text = Str(identity?["type"]);
		if ((text == "guest" || text == "registered") ? true : false)
		{
			string text2 = Str(identity?["id"]);
			if (text2 != null && text2.Length != 0)
			{
				return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes("pokebonk-client-account:" + Str(identity?["type"]) + ":" + text2))).ToLowerInvariant();
			}
		}
		return null;
	}

	private void ReloadWithPublicConfirmation(WebView2 view, CancellationToken token)
	{
		token.ThrowIfCancellationRequested();
		CoreWebView2 coreWebView = view.CoreWebView2;
		PublicReloadBoundary publicReloadBoundary = publicReloadProof;
		publicReloadProof = null;
		publicReloadPermit?.Retire();
		publicReloadPermit = null;
		if (coreWebView != null && publicReloadBoundary != null)
		{
			publicDialogObservedIdentity = publicReloadBoundary.ObservedIdentity;
			PublicReloadBoundary publicReloadBoundary2 = PublicDialogBoundary(coreWebView);
			if (publicReloadBoundary2 != null && publicReloadBoundary == publicReloadBoundary2 && (publicReloadBoundary.ExpectedIdentity == null || publicReloadBoundary.ExpectedIdentity == publicReloadBoundary.ObservedIdentity))
			{
				publicReloadPermit = new PublicReloadPermit(publicReloadBoundary, token, null, 0L);
			}
		}
		try
		{
			view.Reload();
		}
		catch
		{
			publicReloadPermit?.Retire();
			publicReloadPermit = null;
			throw;
		}
	}

	private void ConfigureRecoveryLogin()
	{
		recoveryLoginHandler = TryRecoveryLoginAsync;
		try
		{
			if (File.Exists(portable.ValidatePath(RecoveryLoginPath)))
			{
				ApplyRecoveryLoginMetadata(ReadRecoveryLoginRecord());
			}
		}
		catch
		{
			recoveryLoginKnown = false;
			recoveryLoginBlocked = true;
			recoveryLoginMessage = "本机加密登录信息暂不可读，请重新填写或清除；不会改用游客。";
		}
	}

	private JsonObject RecoveryState()
	{
		return new JsonObject
		{
			["wantedRun"] = wantedRunIntent,
			["status"] = RecoveryStatus(),
			["phase"] = recoveryPhase,
			["attempts"] = recoveryAttempts,
			["nextRetryAt"] = nextRecoveryRetry?.ToString("O"),
			["lastReason"] = recoveryReason,
			["requiresLogin"] = recoveryRequiresLogin,
			["generation"] = recoveryGeneration,
			["interruptedSaveUnconfirmed"] = interruptedSaveUnconfirmed,
			["intentGeneration"] = intentGeneration,
			["canRetry"] = CanRetryRecovery,
			["temporaryGuest"] = temporaryGuest,
			["guestFallbackAuthorized"] = (diagnostics ? ((JsonNode)guestFallbackAuthorized) : null),
			["statisticsScope"] = (temporaryGuest ? "临时游客收益基线；总时长和局数包含切换前记录" : "当前账号")
		};
	}

	private string RecoveryStatus()
	{
		return recoveryPhase switch
		{
			"waiting" => "连接中断，等待自动重试（第 " + (recoveryAttempts + 1) + " 次）", 
			"reloading" => "正在重新加载游戏，保留原本地登录缓存", 
			"rebuilding" => "正在重建浏览器窗口，保留原本地登录缓存", 
			"checking" => "正在核对游戏接口、账号和原生待同步记录", 
			"resuming" => "正在恢复挂机，等待原生同步后继续", 
			"login" => "等待原账号登录恢复；自动恢复请求仍保留", 
			"blocked" => (recoveryReason.Length > 0) ? recoveryReason : "接口或账号状态尚未允许恢复，稍后继续检查", 
			_ => wantedRunIntent ? "挂机运行请求已保留" : "自动恢复待命", 
		};
	}

	private async Task<string> GameScriptAsync(string script, CancellationToken token = default(CancellationToken), TimeSpan? timeout = null)
	{
		token.ThrowIfCancellationRequested();
		WebView2 view = GameView;
		long generation = pageGeneration;
		long intent = intentGeneration;
		if (view.CoreWebView2 == null || gameProcessFailed)
		{
			throw new InvalidOperationException("游戏页面暂不可用");
		}
		string result = await browserScriptQueue.RunAsync(view, delegate
		{
			token.ThrowIfCancellationRequested();
			if (view != GameView || generation != pageGeneration || intent != intentGeneration || view.CoreWebView2 == null || gameProcessFailed)
			{
				throw new OperationCanceledException("游戏页面或控制请求已变化，未提交旧脚本请求");
			}
			return view.ExecuteScriptAsync(script);
		}, timeout ?? TimeSpan.FromSeconds(6.0), token);
		token.ThrowIfCancellationRequested();
		if (view != GameView || generation != pageGeneration || intent != intentGeneration || view.CoreWebView2 == null || gameProcessFailed)
		{
			throw new OperationCanceledException("已丢弃过期的游戏页面或控制请求响应");
		}
		return result;
	}

	private Task<string> RecoveryScriptAsync(string script, CancellationToken token, TimeSpan? timeout = null)
	{
		if (!HostScheduleAllowed)
		{
			throw new OperationCanceledException("等待北京时间启用时段");
		}
		return GameScriptAsync(script, token, timeout);
	}

	private async Task<string> PanelScriptAsync(string script, CancellationToken token = default(CancellationToken), TimeSpan? timeout = null)
	{
		token.ThrowIfCancellationRequested();
		WebView2 view = PanelView;
		long generation = panelGeneration;
		if (view.CoreWebView2 == null || !uiReady)
		{
			throw new InvalidOperationException("控制面板暂不可用");
		}
		string result = await browserScriptQueue.RunAsync(view, delegate
		{
			token.ThrowIfCancellationRequested();
			if (view != PanelView || generation != panelGeneration || view.CoreWebView2 == null || !uiReady)
			{
				throw new OperationCanceledException("控制面板已变化，未提交旧脚本请求");
			}
			return view.ExecuteScriptAsync(script);
		}, timeout ?? TimeSpan.FromSeconds(12.0), token);
		token.ThrowIfCancellationRequested();
		if (view != PanelView || generation != panelGeneration || view.CoreWebView2 == null || !uiReady)
		{
			throw new OperationCanceledException("已丢弃旧控制面板的响应");
		}
		return result;
	}

	private async Task<string?> LiveAccountIdentityHashAsync(CancellationToken token)
	{
		JsonNode jsonNode = JsonNode.Parse(await GameScriptAsync("(()=>{const a=globalThis.__PB_BRIDGE?.app?.meta?.account;if(!a||!['string','number'].includes(typeof a.id)||!String(a.id)||typeof a.id==='number'&&!Number.isFinite(a.id))return null;return {id:String(a.id),type:a.guest===true?'guest':a.guest===false?'registered':null}})()", token));
		bool flag = jsonNode == null;
		if (!flag)
		{
			string text = Str(jsonNode["type"]);
			bool flag2 = ((text == "guest" || text == "registered") ? true : false);
			flag = !flag2;
		}
		if (flag)
		{
			return null;
		}
		return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes("pokebonk-client-account:" + Str(jsonNode["type"]) + ":" + Str(jsonNode["id"])))).ToLowerInvariant();
	}

	private async Task<string?> CaptureRunStartScopeAsync(string ticket, CancellationToken token, bool activeRunOnly = false)
	{
		JsonNode jsonNode = JsonNode.Parse(await GameScriptAsync("((ticket,activeRunOnly=false)=>{\r\n  globalThis.__PB_HOST_START_SCOPE=null;\r\n  const p=globalThis.__PB_PILOT,a=globalThis.__PB_BRIDGE?.app,m=a?.meta,c=m?.account;\r\n  if(!p||p.app!==a||!c||!['string','number'].includes(typeof c.id)||!String(c.id)||typeof c.id==='number'&&!Number.isFinite(c.id)||typeof c.guest!=='boolean')return null;\r\n  if(activeRunOnly&&(!a.run||a.run.state==='over'))return null;\r\n  const id=String(c.id),type=c.guest?'guest':'registered';\r\n  globalThis.__PB_HOST_START_SCOPE={ticket,pilot:p,app:a,meta:m,account:c,id,type,activeRunOnly,run:activeRunOnly?a.run:null};\r\n  return {id,type};\r\n})(" + JsonSerializer.Serialize(ticket) + "," + (activeRunOnly ? "true" : "false") + ")", token));
		bool flag = jsonNode == null;
		if (!flag)
		{
			string text = Str(jsonNode["type"]);
			bool flag2 = ((text == "guest" || text == "registered") ? true : false);
			flag = !flag2;
		}
		if (flag)
		{
			return null;
		}
		return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes("pokebonk-client-account:" + Str(jsonNode["type"]) + ":" + Str(jsonNode["id"])))).ToLowerInvariant();
	}

	private async Task<string?> CurrentRunStartScopeIdentityAsync(string ticket)
	{
		JsonNode jsonNode = JsonNode.Parse(await GameScriptAsync("(()=>{const s=globalThis.__PB_HOST_START_SCOPE;return s?.ticket===" + JsonSerializer.Serialize(ticket) + "&&((scope)=>{\r\n  const p=globalThis.__PB_PILOT,a=globalThis.__PB_BRIDGE?.app,m=a?.meta,c=m?.account;\r\n  return !!scope&&globalThis.__PB_HOST_START_SCOPE===scope&&scope.pilot===p&&scope.app===a&&scope.meta===m&&scope.account===c&&p?.app===a&&String(c?.id)===scope.id&&(c?.guest===true?'guest':c?.guest===false?'registered':null)===scope.type&&(!scope.activeRunOnly||a.run===scope.run&&a.run?.state!=='over');\r\n})(s)?{id:s.id,type:s.type}:null})()"));
		bool flag = jsonNode == null;
		if (!flag)
		{
			string text = Str(jsonNode["type"]);
			bool flag2 = ((text == "guest" || text == "registered") ? true : false);
			flag = !flag2;
		}
		if (flag)
		{
			return null;
		}
		return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes("pokebonk-client-account:" + Str(jsonNode["type"]) + ":" + Str(jsonNode["id"])))).ToLowerInvariant();
	}

	private async Task DiscardRunStartScopeAsync(string ticket)
	{
		if (!ready || gameProcessFailed)
		{
			return;
		}
		try
		{
			MainWindow mainWindow = this;
			string script = "if(globalThis.__PB_HOST_START_SCOPE?.ticket===" + JsonSerializer.Serialize(ticket) + ")globalThis.__PB_HOST_START_SCOPE=null";
			TimeSpan? timeout = TimeSpan.FromSeconds(2.0);
			await mainWindow.GameScriptAsync(script, default(CancellationToken), timeout);
		}
		catch
		{
		}
	}

	private void BeginGameNavigation(ulong? navigationId = null)
	{
		StopConvenienceSound(clearEvents: true);
		if (wantedRunIntent && currentRunOnlyIntent)
		{
			CancelRecoveryIntent("自动托管的原生页面已变化，请为当前局重新点击开始", notifyPage: false);
		}
		activeGameNavigationId = navigationId;
		pageGeneration++;
		connectionNavigationCancellation.Cancel();
		connectionNavigationCancellation.Dispose();
		connectionNavigationCancellation = new CancellationTokenSource();
		if (controlInstance != null)
		{
			retiredControlInstances.Add(controlInstance);
		}
		controlInstance = null;
		controlEpoch = -1L;
		lastControlTransition = null;
		recoveryJavaScriptEpoch = null;
		pendingTemporaryGuestTicket = null;
		nativeBootObservation = null;
		nativeBootLoadingAt = null;
		connectionDiagnostics.Remove("nativeBoot");
		lastHealthPhase = "";
		healthSince = DateTimeOffset.Now;
		game = null;
		lastTick = Stopwatch.GetTimestamp();
		if (wantedRunIntent && !closing)
		{
			RequestRecovery("page-navigation");
		}
	}

	private static bool IsCurrentGameNavigation(ulong? activeId, ulong completedId)
	{
		return activeId == completedId;
	}

	private bool IsRetiredRecoveryDocument(JsonNode? control)
	{
		string text = Str(control?["instance"]) ?? Str(control?["documentId"]);
		if (text != null)
		{
			return retiredControlInstances.Contains(text);
		}
		return false;
	}

	private long ArmRunIntent(bool allowGuestFallback = true)
	{
		currentRunOnlyIntent |= Str(config["mode"]) == "autoManage";
		wantedRunIntent = true;
		intentGeneration++;
		hostIntentArmedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
		guestFallbackAuthorized = allowGuestFallback;
		recoveryRequiresLogin = false;
		string text = Str(game?["accountType"]);
		JsonNode jsonNode = game?["accountId"];
		bool flag = ((text == "guest" || text == "registered") ? true : false);
		if (flag && jsonNode is JsonValue jsonValue)
		{
			string value;
			string text2 = (jsonValue.TryGetValue<string>(out value) ? value : ((jsonValue.GetValueKind() == JsonValueKind.Number) ? jsonValue.ToJsonString() : null));
			if (!string.IsNullOrEmpty(text2))
			{
				string hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes("pokebonk-client-account:" + text + ":" + text2))).ToLowerInvariant();
				PinExplicitRecoveryIdentity(hash);
			}
		}
		return intentGeneration;
	}

	private void RequireRunIntent(long expected)
	{
		if (closing || !wantedRunIntent || expected != intentGeneration)
		{
			throw new OperationCanceledException("挂机启动已取消");
		}
	}

	private string PrepareHostAction(string action)
	{
		if (action == "pause" || (action == "toggle" && (wantedRunIntent || Flag(game?["enabled"]))))
		{
			CancelRecoveryIntent("用户暂停");
			return "pause";
		}
		bool flag = ((action == "start" || action == "resume") ? true : false);
		if (flag || action == "toggle")
		{
			if (compatibilityReport?["maintenanceScope"]?["automaticPlay"] is JsonValue automatic && automatic.TryGetValue<bool>(out var allowed) && !allowed)
				throw new InvalidOperationException("第三赛季接口尚待核验；目录与方案编辑可用。");
			if (compatibilityReport?["maintenanceScope"] is JsonObject scope && scope["biomeIds"] is JsonArray maps)
			{
				string mode = Str(config["mode"]) ?? "";
				string biome = Str(config["modeSettings"]?[mode]?["biome"]) ?? Str(config["biome"]) ?? "auto";
				if (scope["modeIds"] is not JsonArray modes || !modes.Any(n => Str(n) == mode) || biome != "auto" && !maps.Any(n => Str(n) == biome))
					throw new InvalidOperationException("当前模式或地图尚未核验，未开始自动控制。");
			}
			ArmRunIntent();
			if (!(action == "toggle"))
			{
				return action;
			}
			return "resume";
		}
		return action;
	}

	private async Task<string> PrepareAuthorizedHostActionAsync(string action, JsonObject payload)
	{
		bool flag = ((action == "start" || action == "resume") ? true : false);
		if ((flag || (action == "toggle" && !wantedRunIntent && !Flag(game?["enabled"]))) && (currentRunOnlyIntent || Str(config["mode"]) == "autoManage"))
		{
			long before = intentGeneration;
			string ticket = Guid.NewGuid().ToString("N");
			try
			{
				string obj = await CaptureRunStartScopeAsync(ticket, CancellationToken.None, activeRunOnly: true);
				if (closing || before != intentGeneration || (!currentRunOnlyIntent && Str(config["mode"]) != "autoManage"))
				{
					throw new OperationCanceledException("自动托管接管准备已取消");
				}
				if (obj == null)
				{
					CancelRecoveryIntent("自动托管等待玩家手动开局", notifyPage: false);
					throw new InvalidOperationException("自动托管仅接管当前对局。请先在游戏内手动开局，再点击开始托管。");
				}
				payload["__hostAutoManageScopeTicket"] = ticket;
			}
			catch
			{
				await DiscardRunStartScopeAsync(ticket);
				throw;
			}
		}
		RequireExpectedRunIntent(action, payload);
		return PrepareHostAction(action);
	}

	private void RequireExpectedRunIntent(string action, JsonObject payload)
	{
		ClientRunIntent.RequireCurrent(action, payload, intentGeneration);
	}

	private void CancelRecoveryIntent(string reason, bool notifyPage = true)
	{
		RetirePublicGameDialogs();
		wantedRunIntent = false;
		currentRunOnlyIntent = false;
		intentGeneration++;
		browserExecutionPower.Dispose();
		guestFallbackAuthorized = false;
		pendingTemporaryGuestTicket = null;
		lastHostCancellationAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
		recoveryGeneration++;
		recoveryCancellation.Cancel();
		recoveryCancellation.Dispose();
		recoveryCancellation = new CancellationTokenSource();
		recoveryRequested = false;
		recoveryPhase = "idle";
		nextRecoveryRetry = null;
		recoveryRequiresLogin = false;
		recoveryReason = reason;
		resumeAfterDeployment = false;
		recoveryJavaScriptEpoch = null;
		if (notifyPage && !gameProcessFailed && GameView.CoreWebView2 != null)
		{
			StopObsoleteStartAsync(reason);
		}
	}

	private async Task StopObsoleteStartAsync(string reason)
	{
		try
		{
			MainWindow mainWindow = this;
			string script = "globalThis.__PB_START_TICKET=null;globalThis.__PB_RECOVERY_TICKET=null;globalThis.__PB_HOST_START_SCOPE=null;globalThis.__PB_HOST_RECOVERY_EPOCH=null;globalThis.__PB_HOST_VAULT_REVISION=null;globalThis.__PB_PILOT?.stop(" + JsonSerializer.Serialize(reason) + ")";
			TimeSpan? timeout = TimeSpan.FromSeconds(2.0);
			await mainWindow.GameScriptAsync(script, default(CancellationToken), timeout);
		}
		catch
		{
		}
	}

	private async void ObservePilotControlMessage(JsonObject control)
	{
		string instance = Str(control["instance"]) ?? Str(control["documentId"]);
		if (instance == null || retiredControlInstances.Contains(instance) || closing)
		{
			return;
		}
		long generation = pageGeneration;
		if (controlInstance == null)
		{
			try
			{
				MainWindow mainWindow = this;
				TimeSpan? timeout = TimeSpan.FromSeconds(2.0);
				JsonNode jsonNode = JsonNode.Parse(await mainWindow.GameScriptAsync("globalThis.__PB_PILOT?.controlSnapshot?.()??null", default(CancellationToken), timeout));
				if (generation != pageGeneration || instance != (Str(jsonNode?["instance"]) ?? Str(jsonNode?["documentId"])))
				{
					return;
				}
			}
			catch
			{
				return;
			}
		}
		ApplyPilotControl(control);
	}

	private void ApplyPilotControl(JsonObject control)
	{
		string text = Str(control["instance"]) ?? Str(control["documentId"]);
		if (text == null || retiredControlInstances.Contains(text) || (controlInstance != null && controlInstance != text))
		{
			return;
		}
		int num = Num(control["epoch"]);
		if (controlInstance == text && num < controlEpoch)
		{
			return;
		}
		controlInstance = text;
		controlEpoch = num;
		if (wantedRunIntent && Flag(game?["enabled"]) && Str(game?["plan"]?["goalMode"]) == "autoManage" && (Str(game?["control"]?["instance"]) ?? Str(game?["control"]?["documentId"])) == text && Num(game?["control"]?["epoch"]) == num && long.TryParse(control["changedAt"]?.ToJsonString(), out var result) && result >= hostIntentArmedAt)
		{
			currentRunOnlyIntent = true;
		}
		string text2 = Str(control["source"]);
		string text3 = num + ":" + Str(control["desired"]) + ":" + text2 + ":" + Str(control["code"]) + ":" + control["changedAt"]?.ToJsonString();
		if (text3 == lastControlTransition)
		{
			return;
		}
		lastControlTransition = text3;
		bool flag = Str(control["desired"]) == "stopped";
		if (flag)
		{
			bool flag2;
			switch (text2)
			{
			case "auto-manage-wait":
			case "identity-changed":
			case "user-stop":
			case "native-pause":
			case "task-complete":
			case "auto-restart-disabled":
			case "policy-stop":
			case "auto-manage-ended":
			case "auto-manage-recovery-wait":
				flag2 = true;
				break;
			default:
				flag2 = false;
				break;
			}
			flag = flag2;
		}
		long result3;
		if (flag)
		{
			if (!wantedRunIntent || !long.TryParse(control["changedAt"]?.ToJsonString(), out var result2) || result2 >= hostIntentArmedAt)
			{
				CancelRecoveryIntent(Str(control["reason"]) ?? "玩家或任务已停止", notifyPage: false);
			}
		}
		else if (text2 == "user-start" && Str(control["desired"]) == "running" && (!long.TryParse(control["changedAt"]?.ToJsonString(), out result3) || result3 > lastHostCancellationAt) && !wantedRunIntent)
		{
			ArmRunIntent();
			CaptureRunIdentityAsync(pageGeneration);
		}
	}

	private async Task CaptureRunIdentityAsync(long navigation)
	{
		long intent = intentGeneration;
		try
		{
			string text = await LiveAccountIdentityHashAsync(CancellationToken.None);
			if (navigation == pageGeneration && intent == intentGeneration && wantedRunIntent && text != null)
			{
				PinExplicitRecoveryIdentity(text);
			}
		}
		catch
		{
		}
	}

	private bool RecoveryIdentityMatches(string? actual)
	{
		if (actual != null)
		{
			return actual == (temporaryGuest ? temporaryGuestIdentity : expectedRecoveryIdentity);
		}
		return false;
	}

	private void ResetRecoveryAccountBaseline()
	{
		baseline = (lastProfile = null);
		confirmedShinies = null;
		grossStardust = (spentStardust = (newSeen = (newLeague = (shiniesFound = (capturedShinies = (newShinies = 0))))));
		kills = (wins = 0);
	}

	private void PinExplicitRecoveryIdentity(string hash)
	{
		if (!temporaryGuest || !(hash == temporaryGuestIdentity))
		{
			if (temporaryGuest)
			{
				temporaryGuest = false;
				temporaryGuestIdentity = null;
				ResetRecoveryAccountBaseline();
			}
			expectedRecoveryIdentity = hash;
		}
	}

	private void AdoptTemporaryGuest(string hash)
	{
		if (!temporaryGuest || !(hash == temporaryGuestIdentity))
		{
			temporaryGuest = true;
			temporaryGuestIdentity = hash;
			ResetRecoveryAccountBaseline();
			Log("info", "已使用临时游客会话", "原账号尚未恢复；原账号待补存记录未删除、未确认。游客暂按可用角色和地图刷资源，原账号配置保留。收益与图鉴基线已重置，总时长和局数包含切换前记录。");
		}
	}

	private void ObserveRecoverySnapshot()
	{
		if (game?["control"] is JsonObject control)
		{
			ApplyPilotControl(control);
		}
	}

	private void PostPanelMessage(JsonObject message)
	{
		PostPanelMessageText(message.ToJsonString(), message["id"] != null);
	}

	private void PostPanelMessageText(string message, bool isReply = false)
	{
		if ((!uiReady && !isReply) || (closing && mayClose))
		{
			return;
		}
		try
		{
			PanelView.CoreWebView2.PostWebMessageAsJson(message);
		}
		catch
		{
			uiReady = false;
			if (!closing)
			{
				RequestRecovery("panel-unavailable", rebuild: false, reloadGame: false, reloadPanel: true);
			}
		}
	}

	internal async Task HandleUnexpectedClientFailureAsync(Exception error, bool logRecorded = false)
	{
		if (closing)
		{
			return;
		}
		try
		{
			if ((error is IOException || error is UnauthorizedAccessException || error is SecurityException) ? true : false)
			{
				await HandleStorageFailureAsync(error);
				return;
			}
			if (!logRecorded)
			{
				Log("error", "客户端操作异常，继续尝试恢复", "宿主仍在运行；已保留玩家运行意图，正在检查连接。异常类型：" + error.GetType().Name);
			}
			RequestRecovery("desktop-operation-error", GameView.CoreWebView2 == null || PanelView.CoreWebView2 == null);
			await SendState();
		}
		catch (Exception ex)
		{
			try
			{
				if ((ex is IOException || ex is UnauthorizedAccessException || ex is SecurityException) ? true : false)
				{
					await HandleStorageFailureAsync(ex);
				}
				else
				{
					RequestRecovery("desktop-operation-error");
				}
			}
			catch
			{
			}
			try
			{
				await SendState();
			}
			catch
			{
			}
		}
	}

	private void HandleBrowserFailure(CoreWebView2ProcessFailedEventArgs e, bool panel)
	{
		bool flag = closing;
		if (!flag)
		{
			CoreWebView2ProcessFailedKind processFailedKind = e.ProcessFailedKind;
			bool flag2 = (uint)processFailedKind <= 2u;
			flag = !flag2;
		}
		if (flag)
		{
			return;
		}
		if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessUnresponsive)
		{
			long tickCount = Environment.TickCount64;
			if (unresponsiveNoticePage == pageGeneration && tickCount - lastUnresponsiveNoticeAt < 60000)
			{
				return;
			}
			unresponsiveNoticePage = pageGeneration;
			lastUnresponsiveNoticeAt = tickCount;
			try
			{
				Log("warning", panel ? "控制面板暂时无响应" : "游戏页面暂时无响应，保留当前对局", "正在等待原页面恢复；没有关闭、刷新或重新开始游戏。进程事件：" + e.ProcessFailedKind);
				return;
			}
			catch (Exception ex)
			{
				storageError = "无响应诊断未写入：" + ex.Message;
				return;
			}
		}
		bool flag3 = e.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited;
		if (panel || flag3)
		{
			uiReady = false;
		}
		if (!panel || flag3)
		{
			gameProcessFailed = true;
			if (game != null)
			{
				game["enabled"] = false;
			}
			if (wantedRunIntent && currentRunOnlyIntent)
			{
				CancelRecoveryIntent("本局页面进程已退出，自动托管结束；恢复页面后请手动开局并重新开始托管", notifyPage: false);
			}
			interruptedSaveUnconfirmed = true;
			lastTick = Stopwatch.GetTimestamp();
			string text = "游戏浏览器进程异常（" + e.ProcessFailedKind.ToString() + " / " + e.Reason.ToString() + "，退出码 " + e.ExitCode + "）。本次中断未取得结算或服务器保存确认，正在自动恢复；不能计为死亡或通关。";
			compatibility = (status = text);
			compatibilityReport = new JsonObject
			{
				["state"] = "blocked",
				["code"] = "browser-process-exited",
				["reason"] = text
			};
			try
			{
				Log("error", "游戏进程异常，自动恢复中", text);
			}
			catch (Exception ex2)
			{
				storageError = "进程错误日志未写入：" + ex2.Message;
			}
		}
		RequestRecovery(flag3 ? "browser-process-exited" : (panel ? "panel-renderer-exited" : "game-renderer-exited"), flag3, !panel || flag3, panel);
	}

	private void RequestRecovery(string reason, bool rebuild = false, bool reloadGame = false, bool reloadPanel = false)
	{
		if (closing)
		{
			return;
		}
		recoveryReason = reason;
		recoveryRequested = true;
		recoveryRebuildBrowser |= rebuild;
		recoveryReloadGame |= reloadGame;
		recoveryReloadPanel |= reloadPanel;
		if (rebuild || reloadGame)
		{
			if (game != null)
			{
				game["enabled"] = false;
			}
			lastTick = Stopwatch.GetTimestamp();
		}
		EnsureRecoveryLoop();
	}

	private void EnsureRecoveryLoop()
	{
		if (!closing && recoveryRequested)
		{
			Task task = recoveryTask;
			if (task == null || task.IsCompleted)
			{
				long generation = recoveryGeneration;
				CancellationToken token = recoveryCancellation.Token;
				recoveryTask = RunRecoveryAsync(generation, token);
			}
		}
	}

	private async Task RunRecoveryAsync(long generation, CancellationToken token)
	{
		try
		{
			_ = 28;
			try
			{
				while (!closing && recoveryRequested && generation == recoveryGeneration)
				{
					int seconds = RecoveryDelays[Math.Min(recoveryAttempts, RecoveryDelays.Length - 1)];
					recoveryPhase = "waiting";
					nextRecoveryRetry = DateTimeOffset.Now.AddSeconds(seconds);
					await SendState();
					await Task.Delay(TimeSpan.FromSeconds(seconds), token);
					if (!HostScheduleAllowed)
					{
						recoveryPhase = "schedule-wait";
						continue;
					}
					recoveryAttempts++;
					nextRecoveryRetry = null;
					token.ThrowIfCancellationRequested();
					try
					{
						if (storageError.Length > 0 && !TryRestoreRecoveryStorage())
						{
							recoveryPhase = "blocked";
							recoveryReason = "程序目录暂不可写，恢复写入后继续重试";
							recoveryAttempts = Math.Max(recoveryAttempts, 4);
							continue;
						}
						if (!browserStartup.Completed && browserStartup.CanRetryFresh(GameView, pageGeneration, GameView.CoreWebView2?.Source, game != null))
						{
							recoveryRebuildBrowser = true;
						}
						bool flag = recoveryRebuildBrowser || recoveryReloadGame;
						if (flag)
						{
							flag = !(await CanRecreateGameForRecoveryAsync(token));
						}
						if (flag)
						{
							recoveryRebuildBrowser = (recoveryReloadGame = false);
							if (!uiReady)
							{
								recoveryReloadPanel = true;
							}
						}
						if (recoveryRebuildBrowser)
						{
							recoveryPhase = "rebuilding";
							await SendState();
							if (!(await CanRecreateGameForRecoveryAsync(token)))
							{
								recoveryRebuildBrowser = (recoveryReloadGame = false);
								if (!uiReady)
								{
									recoveryReloadPanel = true;
								}
								continue;
							}
							recoveryRebuildBrowser = (recoveryReloadGame = (recoveryReloadPanel = false));
							ReplaceBrowserControls();
							try
							{
								await Initialize(recovering: true, token);
							}
							catch
							{
								recoveryRebuildBrowser = true;
								throw;
							}
							goto IL_0725;
						}
						if (recoveryReloadPanel)
						{
							recoveryPhase = "reloading";
							recoveryReloadPanel = false;
							WebView2 panelView = PanelView;
							uiReady = false;
							activePanelNavigationId = null;
							panelNavigationError = "";
							panelGeneration++;
							panelView.Reload();
							try
							{
								await WaitForPanelReadyAsync(panelView, token);
							}
							catch
							{
								recoveryRebuildBrowser = true;
								throw;
							}
						}
						if (!recoveryReloadGame)
						{
							goto IL_0725;
						}
						if (!(await CanRecreateGameForRecoveryAsync(token)))
						{
							recoveryReloadGame = false;
							continue;
						}
						long previousPageGeneration = pageGeneration;
						WebView2 gameView = GameView;
						recoveryPhase = "reloading";
						recoveryReloadGame = false;
						gameProcessFailed = false;
						ReloadWithPublicConfirmation(gameView, token);
						await WaitForGameNavigationAsync(gameView, previousPageGeneration, token);
						goto IL_0725;
						IL_0725:
						recoveryPhase = "checking";
						await SendState();
						bool num = await WaitForRecoveryBridgeAsync(token);
						token.ThrowIfCancellationRequested();
						if (!num)
						{
							recoveryReloadGame = true;
							throw new TimeoutException("游戏接口连接尚未恢复");
						}
						if (!wantedRunIntent)
						{
							CompleteRecovery(resumed: false);
							return;
						}
						JsonNode info = JsonNode.Parse(await RecoveryScriptAsync("(()=>{const p=globalThis.__PB_PILOT,a=globalThis.__PB_BRIDGE?.app;return {contract:globalThis.__PB_COMPATIBILITY,control:p?.controlSnapshot?.(),authentication:p?.authenticationSnapshot?.(),runState:a?.run?.state??null,hasAccount:!!a?.meta?.account,hasProfile:!!a?.meta?.profile,hasPending:a?.meta?.hasPending?.()===true,savePending:p?.savePending===true,enabled:p?.enabled===true}})()", token));
						flag = currentRunOnlyIntent;
						if (flag)
						{
							string text = Str(info?["runState"]);
							bool flag2 = ((text == null || text == "over") ? true : false);
							flag = flag2;
						}
						if (flag)
						{
							CancelRecoveryIntent("自动托管的本局已结束；请手动开局后重新开始托管", notifyPage: false);
							CompleteRecovery(resumed: false);
							return;
						}
						string text2 = Str(info?["authentication"]?["state"]);
						if ((text2 == "maintenance" || text2 == "banned") ? true : false)
						{
							recoveryPhase = "blocked";
							recoveryReason = ((text2 == "maintenance") ? "游戏正在维护，等待原生服务恢复" : "原生页面显示账号受限，等待玩家处理");
							recoveryAttempts = Math.Max(recoveryAttempts, 4);
							continue;
						}
						flag = text2 == "offline-screen";
						if (flag)
						{
							string text = Str(info?["runState"]);
							bool flag2 = ((text == null || text == "over") ? true : false);
							flag = flag2;
						}
						if (flag)
						{
							recoveryReason = "原生页面仍离线，等待网络恢复后重新连接";
							recoveryReloadGame = true;
							continue;
						}
						flag = Str(info?["contract"]?["state"]) == "blocked";
						if (flag)
						{
							bool flag2;
							switch (Str(info?["contract"]?["code"]))
							{
							case "native-boot-incomplete":
							case "app-create-failed":
							case "app-boot-failed":
								flag2 = true;
								break;
							default:
								flag2 = false;
								break;
							}
							flag = flag2;
						}
						if (flag)
						{
							recoveryReason = "原生启动尚未完成，按已知故障阶段重新连接";
							recoveryReloadGame = true;
							continue;
						}
						if ((Str(info?["contract"]?["state"]) == "blocked" || Str(info?["control"]?["recoveryBlocked"]) == "compatibility") && !(await RecoveryScriptAsync("(()=>{const p=globalThis.__PB_PILOT,a=globalThis.__PB_BRIDGE?.app;return !!p&&p.app===a&&!!a?.meta})()", token, TimeSpan.FromSeconds(3.0)) == "true"))
						{
							recoveryPhase = "connecting";
							recoveryReason = "挂机请求已保留，继续识别核心连接；其他可用界面和手动兼容配置仍可使用";
							recoveryAttempts = Math.Max(recoveryAttempts, 3);
							continue;
						}
						if (recoveryJavaScriptEpoch == null)
						{
							recoveryJavaScriptEpoch = Guid.NewGuid().ToString("N");
						}
						await RecoveryScriptAsync("globalThis.__PB_HOST_RECOVERY_EPOCH=" + JsonSerializer.Serialize(recoveryJavaScriptEpoch) + ";globalThis.__PB_HOST_VAULT_REVISION=" + recoveryVaultRevision, token);
						string actual = await LiveAccountIdentityHashAsync(token);
						if (currentRunOnlyIntent && !RecoveryIdentityMatches(actual))
						{
							CancelRecoveryIntent("自动托管的原生身份已变化；未登录、切换游客或接管其他对局", notifyPage: false);
							CompleteRecovery(resumed: false);
							return;
						}
						if (actual == null)
						{
							recoveryPhase = "login";
							recoveryRequiresLogin = true;
							if (recoveryLoginComplete && recoveryLoginKnown && !recoveryLoginBlocked && recoveryLoginHandler != null)
							{
								await recoveryLoginHandler(expectedRecoveryIdentity, token);
							}
							else if (!recoveryLoginHasDraft && recoveryLoginKnown && !recoveryLoginBlocked)
							{
								await TryGuestFallbackAsync(token);
							}
							actual = await LiveAccountIdentityHashAsync(token);
							if (RecoveryIdentityMatches(actual))
							{
								string epoch = recoveryJavaScriptEpoch;
								DateTimeOffset until = DateTimeOffset.UtcNow.AddSeconds(10.0);
								do
								{
									token.ThrowIfCancellationRequested();
									if (!wantedRunIntent || generation != recoveryGeneration || epoch == null || epoch != recoveryJavaScriptEpoch)
									{
										throw new OperationCanceledException("恢复登录准备已取消");
									}
									info = JsonNode.Parse(await RecoveryScriptAsync("(()=>{const p=globalThis.__PB_PILOT,a=globalThis.__PB_BRIDGE?.app;return {contract:globalThis.__PB_COMPATIBILITY,control:p?.controlSnapshot?.(),authentication:p?.authenticationSnapshot?.(),runState:a?.run?.state??null,hasAccount:!!a?.meta?.account,hasProfile:!!a?.meta?.profile,hasPending:a?.meta?.hasPending?.()===true,savePending:p?.savePending===true,enabled:p?.enabled===true}})()", token, TimeSpan.FromSeconds(3.0)));
									actual = await LiveAccountIdentityHashAsync(token);
									if (!RecoveryIdentityMatches(actual) || Flag(info?["hasProfile"]) || DateTimeOffset.UtcNow >= until)
									{
										break;
									}
									await Task.Delay(250, token);
								}
								while (DateTimeOffset.UtcNow < until);
							}
						}
						else if (pendingTemporaryGuestTicket != null && !recoveryLoginComplete && !recoveryLoginHasDraft && recoveryLoginKnown && !recoveryLoginBlocked)
						{
							await TryGuestFallbackAsync(token);
							actual = await LiveAccountIdentityHashAsync(token);
						}
						if (temporaryGuest && actual != null && actual == expectedRecoveryIdentity)
						{
							PinExplicitRecoveryIdentity(actual);
						}
						if (!RecoveryIdentityMatches(actual))
						{
							recoveryPhase = ((actual == null) ? "login" : "blocked");
							recoveryRequiresLogin = true;
							recoveryReason = ((actual != null) ? "当前账号与本次恢复身份不同，未切走或接管；可由玩家点击继续确认当前账号" : ((recoveryLoginHasDraft && !recoveryLoginComplete) ? "登录信息尚未填齐，请补齐；不会改用游客" : recoveryLoginMessage));
							recoveryAttempts = Math.Max(recoveryAttempts, 4);
							continue;
						}
						recoveryRequiresLogin = false;
						if (!Flag(JsonNode.Parse(await RecoveryScriptAsync("(()=>{const p=globalThis.__PB_PILOT,a=globalThis.__PB_BRIDGE?.app;return {contract:globalThis.__PB_COMPATIBILITY,control:p?.controlSnapshot?.(),authentication:p?.authenticationSnapshot?.(),runState:a?.run?.state??null,hasAccount:!!a?.meta?.account,hasProfile:!!a?.meta?.profile,hasPending:a?.meta?.hasPending?.()===true,savePending:p?.savePending===true,enabled:p?.enabled===true}})()", token))?["hasProfile"]))
						{
							recoveryReason = "原账号存档正在加载";
							continue;
						}
						recoveryPhase = "resuming";
						await SendState();
						await commandLock.WaitAsync(token);
						try
						{
							token.ThrowIfCancellationRequested();
							if (!wantedRunIntent || generation != recoveryGeneration)
							{
								return;
							}
							if (!RecoveryIdentityMatches(await LiveAccountIdentityHashAsync(token)))
							{
								throw new InvalidOperationException("恢复前账号状态发生变化，未接管");
							}
							if (await RecoveryScriptAsync("globalThis.__PB_PILOT?.enabled===true&&globalThis.__PB_PILOT?.controlSnapshot?.().desired==='running'", token) != "true")
							{
								await ResumeRecoveredPilotAsync(token, generation);
							}
							goto IL_165c;
						}
						finally
						{
							commandLock.Release();
						}
						IL_165c:
						CompleteRecovery(resumed: true);
						return;
					}
					catch (OperationCanceledException) when (token.IsCancellationRequested || generation != recoveryGeneration)
					{
						return;
					}
					catch (Exception ex2)
					{
						recoveryReason = "自动恢复尚未完成：" + ex2.Message;
						try
						{
							Log("info", "自动恢复将继续重试", recoveryReason);
						}
						catch
						{
						}
					}
				}
			}
			catch (OperationCanceledException)
			{
			}
		}
		finally
		{
			if (generation == recoveryGeneration)
			{
				nextRecoveryRetry = null;
				await SendState();
			}
			base.Dispatcher.BeginInvoke(new Action(EnsureRecoveryLoop), DispatcherPriority.Background);
		}
	}

	private async Task<bool> CanRecreateGameForRecoveryAsync(CancellationToken token)
	{
		token.ThrowIfCancellationRequested();
		publicReloadProof = null;
		if (closing)
		{
			return false;
		}
		if (gameProcessFailed || GameView.CoreWebView2 == null)
		{
			return true;
		}
		if (browserStartup.CanRetryFresh(GameView, pageGeneration, GameView.CoreWebView2.Source, game != null))
		{
			return true;
		}
		long navigation = pageGeneration;
		long intent = intentGeneration;
		WebView2 view = GameView;
		try
		{
			string script = "(()=>{\n" + ControllerSources.ServiceSource(Resource, BrowserSource, "payload.compatibility.mjs") + "\nconst decision=((()=>{const a=globalThis.__PB_BRIDGE?.app,p=globalThis.__PB_PILOT;if(!a)return {canReload:globalThis.__PB_GAME_BOOT?.phase==='failed',code:'native-app-unavailable',reason:'未能确认原生对局状态，保留游戏页面'};if(a.starting===true)return {canReload:false,code:'native-start-pending',reason:'原生开局仍在进行，保留游戏页面'};return deploymentReloadDecision({hasRun:!!a.run,state:a.run?.state,savePending:p?.savePending,pendingSave:a.meta?.hasPending?.()!==false,runAt:p?.runStartedAt,events:p?.events});})());const a=globalThis.__PB_BRIDGE?.app?.meta?.account;const identity=a&&['string','number'].includes(typeof a.id)&&String(a.id)&&!(typeof a.id==='number'&&!Number.isFinite(a.id))?{id:String(a.id),type:a.guest===true?'guest':a.guest===false?'registered':null}:null;return {...decision,identity};})()";
			JsonNode jsonNode = JsonNode.Parse(await RecoveryScriptAsync(script, token, TimeSpan.FromSeconds(3.0)));
			if (closing || navigation != pageGeneration || intent != intentGeneration || view != GameView)
			{
				return false;
			}
			string text = Str(game?["state"]);
			bool flag = ((text == null || text == "over") ? true : false);
			bool flag2 = !flag;
			if (Flag(jsonNode?["canReload"]) && (!flag2 || !(Str(jsonNode?["code"]) == "native-app-unavailable")))
			{
				publicDialogObservedIdentity = PublicReloadIdentity(jsonNode?["identity"]);
				if (view.CoreWebView2 != null)
				{
					publicReloadProof = PublicDialogBoundary(view.CoreWebView2);
				}
				return true;
			}
			recoveryReason = Str(jsonNode?["reason"]) ?? "当前对局或保存状态尚未确认，保留游戏页面";
		}
		catch (OperationCanceledException)
		{
			throw;
		}
		catch
		{
			recoveryReason = "游戏状态读取暂未完成，保留当前页面并继续重连，不自动重开对局";
		}
		return false;
	}

	private async Task WaitForGameNavigationAsync(WebView2 view, long previousPageGeneration, CancellationToken token)
	{
		DateTimeOffset until = DateTimeOffset.UtcNow.AddSeconds(15.0);
		while (view == GameView && pageGeneration <= previousPageGeneration)
		{
			token.ThrowIfCancellationRequested();
			if (closing)
			{
				throw new OperationCanceledException("客户端正在关闭");
			}
			if (DateTimeOffset.UtcNow >= until)
			{
				throw new TimeoutException("游戏重新加载尚未开始");
			}
			await Task.Delay(50, token);
		}
		token.ThrowIfCancellationRequested();
		if (view != GameView)
		{
			throw new OperationCanceledException("浏览器实例已更换");
		}
	}

	private async Task WaitForPanelReadyAsync(WebView2 view, CancellationToken token)
	{
		DateTimeOffset until = DateTimeOffset.UtcNow.AddSeconds(20.0);
		while (true)
		{
			token.ThrowIfCancellationRequested();
			if (closing || view != PanelView)
			{
				throw new OperationCanceledException("控制面板实例已更换");
			}
			if (panelNavigationError.Length > 0)
			{
				throw new InvalidOperationException(panelNavigationError);
			}
			if (uiReady && activePanelNavigationId.HasValue)
			{
				return;
			}
			if (DateTimeOffset.UtcNow >= until)
			{
				break;
			}
			await Task.Delay(50, token);
		}
		throw new TimeoutException("控制面板加载超时；等待本次导航完成后继续初始化");
	}

	private async Task<bool> WaitForRecoveryBridgeAsync(CancellationToken token)
	{
		DateTimeOffset until = DateTimeOffset.Now.AddSeconds(45.0);
		while (DateTimeOffset.Now < until || NativeBootLoadingGrace)
		{
			token.ThrowIfCancellationRequested();
			long navigation = pageGeneration;
			try
			{
				JsonNode jsonNode = JsonNode.Parse(await RecoveryScriptAsync("(()=>{const p=globalThis.__PB_PILOT,c=globalThis.__PB_COMPATIBILITY;return {present:!!p&&!!globalThis.__PB_BRIDGE?.app,contract:c?.state,control:p?.controlSnapshot?.(),boot:globalThis.__PB_GAME_BOOT??null}})()", token, TimeSpan.FromSeconds(3.0)));
				if (IsRetiredRecoveryDocument(jsonNode?["control"]))
				{
					await Task.Delay(500, token);
					continue;
				}
				ObserveNativeBoot(jsonNode?["boot"]);
				if (jsonNode?["control"] is JsonObject control)
				{
					ApplyPilotControl(control);
				}
				bool flag = Flag(jsonNode?["present"]);
				if (flag)
				{
					bool flag2;
					switch (Str(jsonNode?["contract"]))
					{
					case "ready":
					case "partial":
					case "degraded":
					case "blocked":
						flag2 = true;
						break;
					default:
						flag2 = false;
						break;
					}
					flag = flag2;
				}
				if (flag)
				{
					return true;
				}
				if (Str(jsonNode?["contract"]) == "blocked")
				{
					return true;
				}
			}
			catch (OperationCanceledException) when (!token.IsCancellationRequested && !closing && navigation != pageGeneration)
			{
				continue;
			}
			catch (OperationCanceledException)
			{
				throw;
			}
			catch
			{
			}
			await Task.Delay(500, token);
		}
		return false;
	}

	private async Task ResumeRecoveredPilotAsync(CancellationToken token, long generation)
	{
		if (!wantedRunIntent || generation != recoveryGeneration)
		{
			throw new OperationCanceledException();
		}
		string ticket = Guid.NewGuid().ToString("N");
		try
		{
			if (!RecoveryIdentityMatches(await CaptureRunStartScopeAsync(ticket, token, currentRunOnlyIntent)))
			{
				throw new InvalidOperationException("恢复提交前账号状态发生变化，未接管");
			}
			token.ThrowIfCancellationRequested();
			if (!wantedRunIntent || generation != recoveryGeneration)
			{
				throw new OperationCanceledException();
			}
			await RecoveryScriptAsync("globalThis.__PB_RECOVERY_RESULT=null;globalThis.__PB_RECOVERY_TICKET=" + JsonSerializer.Serialize(ticket) + ";(async()=>{try{const p=globalThis.__PB_PILOT,scope=globalThis.__PB_HOST_START_SCOPE,isCurrent=()=>globalThis.__PB_RECOVERY_TICKET===" + JsonSerializer.Serialize(ticket) + "&&scope?.ticket===" + JsonSerializer.Serialize(ticket) + "&&((scope)=>{\r\n  const p=globalThis.__PB_PILOT,a=globalThis.__PB_BRIDGE?.app,m=a?.meta,c=m?.account;\r\n  return !!scope&&globalThis.__PB_HOST_START_SCOPE===scope&&scope.pilot===p&&scope.app===a&&scope.meta===m&&scope.account===c&&p?.app===a&&String(c?.id)===scope.id&&(c?.guest===true?'guest':c?.guest===false?'registered':null)===scope.type&&(!scope.activeRunOnly||a.run===scope.run&&a.run?.state!=='over');\r\n})(scope);if(!p?.requestStart)throw Error('控制器恢复接口尚未就绪');if(!isCurrent())throw Error('恢复提交身份或页面已变化，未接管');p.setSettings(" + PilotSettings().ToJsonString() + ");const ok=await p.requestStart({source:'host-recovery',isCurrent});if(globalThis.__PB_RECOVERY_TICKET===" + JsonSerializer.Serialize(ticket) + ")globalThis.__PB_RECOVERY_RESULT={ok:ok===true,reason:p.status}}catch(e){if(globalThis.__PB_RECOVERY_TICKET===" + JsonSerializer.Serialize(ticket) + ")globalThis.__PB_RECOVERY_RESULT={ok:false,reason:String(e.message||e)}}finally{if(globalThis.__PB_HOST_START_SCOPE?.ticket===" + JsonSerializer.Serialize(ticket) + ")globalThis.__PB_HOST_START_SCOPE=null}})()", token);
			for (int n = 0; n < 100; n++)
			{
				token.ThrowIfCancellationRequested();
				if (!wantedRunIntent || generation != recoveryGeneration)
				{
					throw new OperationCanceledException();
				}
				JsonNode jsonNode = JsonNode.Parse(await RecoveryScriptAsync("globalThis.__PB_RECOVERY_RESULT??null", token));
				if (jsonNode != null)
				{
					if (!Flag(jsonNode["ok"]))
					{
						throw new InvalidOperationException(Str(jsonNode["reason"]) ?? "原生检查尚未允许继续");
					}
					return;
				}
				await Task.Delay(200, token);
			}
			await RecoveryScriptAsync("globalThis.__PB_RECOVERY_TICKET=null;globalThis.__PB_PILOT?.release?.()", token);
			throw new TimeoutException("恢复启动准备仍未完成");
		}
		finally
		{
			await DiscardRunStartScopeAsync(ticket);
		}
	}

	private void CompleteRecovery(bool resumed)
	{
		recoveryRequested = false;
		recoveryPhase = "idle";
		recoveryAttempts = 0;
		nextRecoveryRetry = null;
		recoveryRequiresLogin = false;
		lastTick = Stopwatch.GetTimestamp();
		if (compatibilityReport?["code"]?.GetValue<string>() == "browser-process-exited")
		{
			compatibility = "";
			compatibilityReport = null;
		}
		try
		{
			Log("info", (!resumed) ? "游戏页面已恢复" : (temporaryGuest ? "临时游客挂机已运行" : "已恢复自动挂机"), (!resumed) ? "页面连接已恢复；玩家未要求运行，没有自动开局。" : (temporaryGuest ? "这是独立游客会话，暂按资源模式运行；原账号配置及待补存记录保留，未宣称原账号恢复。" : "已核对为原账号，沿用原设置继续；原局结算以游戏原生同步回执为准。"));
		}
		catch
		{
		}
	}

	private bool TryRestoreRecoveryStorage()
	{
		try
		{
			string path = portable.DataPath("recovery-write-check.tmp");
			using (FileStream fileStream = new FileStream(portable.ValidatePath(path), FileMode.Create, FileAccess.Write, FileShare.None))
			{
				fileStream.WriteByte(0);
				fileStream.Flush(flushToDisk: true);
			}
			File.Delete(portable.ValidatePath(path));
			storageError = "";
			return true;
		}
		catch (Exception ex) when (((ex is IOException || ex is UnauthorizedAccessException || ex is SecurityException) ? 1 : 0) != 0)
		{
			return false;
		}
	}

	private void ReplaceBrowserControls()
	{
		browserStartup.Invalidate();
		ready = false;
		uiReady = false;
		gameProcessFailed = true;
		RetirePublicGameDialogs();
		BeginGameNavigation();
		panelGeneration++;
		Grid mainLayout = MainLayout;
		WebView2 gameView = GameView;
		WebView2 panelView = PanelView;
		GameHost.Child = null;
		mainLayout.Children.Remove(panelView);
		gameView.Dispose();
		panelView.Dispose();
		GameView = new WebView2
		{
			DefaultBackgroundColor = Color.FromArgb(16, 32, 27)
		};
		PanelView = new WebView2
		{
			DefaultBackgroundColor = Color.FromArgb(245, 247, 248)
		};
		Grid.SetRow(PanelView, 2);
		GameHost.Child = GameView;
		mainLayout.Children.Add(PanelView);
		ApplyGameViewport();
		activePanelNavigationId = null;
		panelNavigationError = "";
		gameProcessFailed = false;
		initScriptId = "";
	}

	private async Task CheckRecoveryHealthAsync()
	{
		if (NativeBootLoadingGrace)
		{
			return;
		}
		bool flag = Str(nativeBootObservation?["phase"]) == "failed";
		if (flag)
		{
			bool flag2;
			switch (Str(nativeBootObservation?["code"]))
			{
			case "native-boot-incomplete":
			case "app-create-failed":
			case "app-boot-failed":
				flag2 = true;
				break;
			default:
				flag2 = false;
				break;
			}
			flag = flag2;
		}
		if (flag)
		{
			RequestRecovery("native-boot-failed", rebuild: false, reloadGame: true);
			return;
		}
		if (game == null)
		{
			if ((DateTimeOffset.Now - gameNavigationAt).TotalSeconds > 45.0)
			{
				RequestRecovery("bridge-timeout", rebuild: false, !HardCompatibilityBlocked);
			}
			return;
		}
		string phase = Str(game["health"]?["phase"]) ?? "healthy";
		flag = phase == "bridge-wait";
		if (flag)
		{
			flag = await GameScriptAsync("(()=>{const b=globalThis.__PB_BRIDGE,p=globalThis.__PB_PILOT,c=globalThis.__PB_COMPATIBILITY;return !!b?.app?.meta&&p?.app===b.app&&['ready','partial','degraded'].includes(p.compatibility?.state)&&['ready','partial','degraded'].includes(c?.state)})()") == "true";
		}
		if (flag)
		{
			phase = "healthy";
		}
		if (phase != lastHealthPhase)
		{
			lastHealthPhase = phase;
			healthSince = DateTimeOffset.Now;
		}
		JsonObject jsonObject = game["control"] as JsonObject;
		flag = jsonObject != null;
		if (flag)
		{
			string text = Str(jsonObject["recoveryBlocked"]);
			bool flag2 = ((text == "native-maintenance" || text == "native-banned") ? true : false);
			flag = flag2;
		}
		if (flag)
		{
			if (wantedRunIntent)
			{
				RequestRecovery("native-service-unavailable");
			}
		}
		else if (phase == "bridge-wait" && !recoveryRequested && (DateTimeOffset.Now - healthSince).TotalSeconds > 45.0)
		{
			RequestRecovery("bridge-timeout", rebuild: false, !HardCompatibilityBlocked);
		}
		else
		{
			if (!wantedRunIntent || recoveryRequested)
			{
				return;
			}
			if (phase == "controller-error")
			{
				RequestRecovery("controller-error");
				return;
			}
			string text = phase;
			flag = ((text == "bridge-wait" || text == "account-wait") ? true : false);
			if (flag && (DateTimeOffset.Now - healthSince).TotalSeconds > 45.0)
			{
				RequestRecovery(phase, rebuild: false, reloadGame: true);
				return;
			}
			text = phase;
			flag = ((text == "server-wait" || text == "save-wait") ? true : false);
			if (flag && (DateTimeOffset.Now - healthSince).TotalSeconds > 90.0 && Str(game["authentication"]?["state"]) == "offline-screen")
			{
				RequestRecovery("native-offline-screen", rebuild: false, reloadGame: true);
			}
			else if (phase == "graphics-wait" && (DateTimeOffset.Now - healthSince).TotalSeconds > 90.0)
			{
				RequestRecovery("graphics-unavailable", rebuild: false, reloadGame: true);
			}
			else if (Flag(game["enabled"]) && expectedRecoveryIdentity == null)
			{
				await CaptureRunIdentityAsync(pageGeneration);
			}
		}
	}

	private JsonObject RecoveryLoginState()
	{
		return new JsonObject
		{
			["saved"] = File.Exists(portable.ValidatePath(RecoveryLoginPath)),
			["complete"] = recoveryLoginComplete,
			["hasDraft"] = recoveryLoginHasDraft,
			["bound"] = recoveryLoginBound,
			["updatedAt"] = recoveryLoginUpdatedAt,
			["blocked"] = recoveryLoginBlocked,
			["message"] = recoveryLoginMessage
		};
	}

	private RecoveryLoginRecord ReadRecoveryLoginRecord()
	{
		long length = new FileInfo(portable.ValidatePath(RecoveryLoginPath)).Length;
		if ((length < 1 || length > 65536) ? true : false)
		{
			throw new CryptographicException();
		}
		byte[] array = File.ReadAllBytes(portable.ValidatePath(RecoveryLoginPath));
		byte[] array2 = null;
		try
		{
			array2 = ProtectRecoveryLogin(array, decrypt: true);
			using JsonDocument jsonDocument = JsonDocument.Parse(array2);
			JsonElement rootElement = jsonDocument.RootElement;
			int @int = rootElement.GetProperty("schemaVersion").GetInt32();
			if ((uint)(@int - 1) > 1u)
			{
				throw new CryptographicException();
			}
			string? obj = rootElement.GetProperty("name").GetString() ?? "";
			string text = rootElement.GetProperty("password").GetString() ?? "";
			JsonElement value;
			string text2 = (rootElement.TryGetProperty("identityHash", out value) ? value.GetString() : null);
			if (obj.Length > 100 || text.Length > 1024 || (text2 != null && !Regex.IsMatch(text2, "^[a-f0-9]{64}$")))
			{
				throw new CryptographicException();
			}
			JsonElement value2;
			return new RecoveryLoginRecord(obj, text, text2, rootElement.TryGetProperty("savedAt", out value2) ? (value2.GetString() ?? "") : "");
		}
		finally
		{
			CryptographicOperations.ZeroMemory(array);
			if (array2 != null)
			{
				CryptographicOperations.ZeroMemory(array2);
			}
		}
	}

	private void ApplyRecoveryLoginMetadata(RecoveryLoginRecord record)
	{
		recoveryLoginKnown = true;
		recoveryLoginComplete = record.Complete;
		recoveryLoginHasDraft = record.HasDraft;
		recoveryLoginBound = record.IdentityHash != null;
		recoveryLoginUpdatedAt = record.SavedAt;
	}

	private async Task WriteRecoveryLoginRecordAsync(RecoveryLoginRecord record, long revision, CancellationToken token)
	{
		byte[] clear = Encoding.UTF8.GetBytes(new JsonObject
		{
			["schemaVersion"] = 2,
			["identityHash"] = record.IdentityHash,
			["name"] = record.Name,
			["password"] = record.Password,
			["savedAt"] = record.SavedAt
		}.ToJsonString());
		byte[] encrypted = null;
		bool locked = false;
		try
		{
			await recoveryVaultLock.WaitAsync(token);
			locked = true;
			token.ThrowIfCancellationRequested();
			if (revision != recoveryVaultRevision)
			{
				throw new OperationCanceledException("本机登录信息已更改");
			}
			encrypted = ProtectRecoveryLogin(clear, decrypt: false);
			string pending = portable.ValidatePath(RecoveryLoginPath + ".pending");
			await File.WriteAllBytesAsync(pending, encrypted, token);
			token.ThrowIfCancellationRequested();
			if (revision != recoveryVaultRevision)
			{
				File.Delete(portable.ValidatePath(pending));
				throw new OperationCanceledException("本机登录信息已更改");
			}
			File.Move(portable.ValidatePath(pending), portable.ValidatePath(RecoveryLoginPath), overwrite: true);
			ApplyRecoveryLoginMetadata(record);
		}
		finally
		{
			if (locked)
			{
				recoveryVaultLock.Release();
			}
			CryptographicOperations.ZeroMemory(clear);
			if (encrypted != null)
			{
				CryptographicOperations.ZeroMemory(encrypted);
			}
		}
	}

	private bool InvalidateRecoveryLoginAttempt()
	{
		recoveryVaultRevision++;
		string previous = recoveryJavaScriptEpoch;
		recoveryJavaScriptEpoch = null;
		ClearRecoveryLoginEpochAsync(previous);
		int num;
		if (wantedRunIntent)
		{
			num = (RecoveryBusy ? 1 : 0);
			if (num != 0)
			{
				recoveryGeneration++;
				recoveryCancellation.Cancel();
				recoveryCancellation.Dispose();
				recoveryCancellation = new CancellationTokenSource();
				recoveryRequested = false;
				recoveryPhase = "login";
				recoveryAttempts = 0;
				nextRecoveryRetry = null;
			}
		}
		else
		{
			num = 0;
		}
		return (byte)num != 0;
	}

	private async Task ClearRecoveryLoginEpochAsync(string? previous)
	{
		if (previous == null || !ready || gameProcessFailed)
		{
			return;
		}
		try
		{
			MainWindow mainWindow = this;
			string script = "if(globalThis.__PB_HOST_RECOVERY_EPOCH===" + JsonSerializer.Serialize(previous) + "){globalThis.__PB_HOST_RECOVERY_EPOCH=null;globalThis.__PB_HOST_VAULT_REVISION=null;globalThis.__PB_RECOVERY_TICKET=null}";
			TimeSpan? timeout = TimeSpan.FromSeconds(2.0);
			await mainWindow.GameScriptAsync(script, default(CancellationToken), timeout);
		}
		catch
		{
		}
	}

	private Task<JsonObject> ReadRecoveryLoginAsync()
	{
		try
		{
			if (!File.Exists(portable.ValidatePath(RecoveryLoginPath)))
			{
				return Task.FromResult(new JsonObject
				{
					["name"] = "",
					["password"] = ""
				});
			}
			RecoveryLoginRecord recoveryLoginRecord = ReadRecoveryLoginRecord();
			return Task.FromResult(new JsonObject
			{
				["name"] = recoveryLoginRecord.Name,
				["password"] = recoveryLoginRecord.Password
			});
		}
		catch
		{
			throw new InvalidOperationException("无法显示本机加密信息，请重新填写或清除。");
		}
	}

	private async Task<string?> MatchingRecoveryLoginIdentityHashAsync(string name, CancellationToken token)
	{
		JsonNode jsonNode = JsonNode.Parse(await RecoveryScriptAsync("((name)=>{\n  const a=globalThis.__PB_BRIDGE?.app?.meta?.account;\n  if(a?.guest!==false||String(a.name||'').trim().toLocaleLowerCase()!==name.toLocaleLowerCase()||!['string','number'].includes(typeof a.id)||!String(a.id)||typeof a.id==='number'&&!Number.isFinite(a.id))return null;\n  return {id:String(a.id),type:'registered'};\n})(" + JsonSerializer.Serialize(name) + ")", token));
		if (jsonNode == null || Str(jsonNode["type"]) != "registered")
		{
			return null;
		}
		return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes("pokebonk-client-account:registered:" + Str(jsonNode["id"])))).ToLowerInvariant();
	}

	private async Task SaveRecoveryLoginAsync(JsonObject payload)
	{
		string name = Str(payload["name"])?.Trim() ?? "";
		string password = Str(payload["password"]) ?? "";
		if (name.Length > 100 || password.Length > 1024)
		{
			throw new InvalidOperationException("账号最多100字，密码最多1024字。");
		}
		bool retry = InvalidateRecoveryLoginAttempt();
		long revision = recoveryVaultRevision;
		try
		{
			string identity = null;
			RecoveryLoginRecord recoveryLoginRecord = null;
			if (File.Exists(portable.ValidatePath(RecoveryLoginPath)))
			{
				try
				{
					recoveryLoginRecord = ReadRecoveryLoginRecord();
				}
				catch
				{
					if (Flag(payload["preserveName"]) || Flag(payload["preservePassword"]))
					{
						throw new InvalidOperationException("旧加密信息不可读，请重新填写两个字段或清除。");
					}
				}
			}
			if (Flag(payload["preserveName"]))
			{
				name = recoveryLoginRecord?.Name ?? "";
			}
			if (Flag(payload["preservePassword"]))
			{
				password = recoveryLoginRecord?.Password ?? "";
			}
			if (recoveryLoginRecord != null && string.Equals(recoveryLoginRecord.Name.Trim(), name, StringComparison.OrdinalIgnoreCase))
			{
				identity = recoveryLoginRecord.IdentityHash;
			}
			if (name.Length == 0 && password.Length == 0)
			{
				await ClearRecoveryLoginAsync();
				return;
			}
			if (ready && !gameProcessFailed)
			{
				try
				{
					identity = (await MatchingRecoveryLoginIdentityHashAsync(name, CancellationToken.None)) ?? identity;
				}
				catch
				{
				}
			}
			await WriteRecoveryLoginRecordAsync(new RecoveryLoginRecord(name, password, identity, DateTimeOffset.UtcNow.ToString("O")), revision, CancellationToken.None);
			recoveryLoginBlocked = false;
			lastRecoveryLoginAttempt = DateTimeOffset.MinValue;
			recoveryLoginMessage = (recoveryLoginComplete ? "已加密保存；已有会话优先，必要时通过原生登录并核对身份。" : "已加密保存输入草稿，请补齐账号和密码；未填齐时不会改用游客。");
		}
		finally
		{
			payload.Remove("password");
			payload.Remove("name");
			if (retry && wantedRunIntent)
			{
				RequestRecovery("local-login-information-changed");
			}
		}
	}

	private Task ClearRecoveryLoginAsync()
	{
		bool num = InvalidateRecoveryLoginAttempt();
		string path = portable.ValidatePath(RecoveryLoginPath);
		if (File.Exists(path))
		{
			File.Delete(portable.ValidatePath(path));
		}
		string path2 = portable.ValidatePath(RecoveryLoginPath + ".pending");
		if (File.Exists(path2))
		{
			File.Delete(portable.ValidatePath(path2));
		}
		recoveryLoginBlocked = false;
		recoveryLoginComplete = (recoveryLoginHasDraft = (recoveryLoginBound = false));
		recoveryLoginKnown = true;
		recoveryLoginUpdatedAt = null;
		recoveryLoginMessage = "已清除本机自动重登信息。已有游戏登录不受影响；完全无会话时可按授权使用临时游客。";
		Log("info", "本机自动重登已清除", "已删除客户端保存的加密登录信息。");
		if (num && wantedRunIntent)
		{
			RequestRecovery("local-login-information-cleared");
		}
		return Task.CompletedTask;
	}

	private async Task<bool> TryRecoveryLoginAsync(string? expectedHash, CancellationToken token)
	{
		token.ThrowIfCancellationRequested();
		string epoch = recoveryJavaScriptEpoch;
		long revision = recoveryVaultRevision;
		long intent = intentGeneration;
		long generation = recoveryGeneration;
		if (epoch == null)
		{
			return false;
		}
		if (recoveryLoginBlocked || !File.Exists(portable.ValidatePath(RecoveryLoginPath)))
		{
			return false;
		}
		if (DateTimeOffset.UtcNow - lastRecoveryLoginAttempt < TimeSpan.FromSeconds(60.0))
		{
			return false;
		}
		string formTicket = null;
		bool recordValidated = false;
		bool result;
		try
		{
			_ = 7;
			try
			{
				RecoveryLoginRecord record = ReadRecoveryLoginRecord();
				ApplyRecoveryLoginMetadata(record);
				if (!record.Complete)
				{
					result = false;
				}
				else
				{
					string requiredHash = expectedHash ?? record.IdentityHash;
					if (expectedHash != null && record.IdentityHash != null && record.IdentityHash != expectedHash)
					{
						recoveryLoginMessage = "保存的登录信息不属于本次续挂账号。请在上方登录原账号，或为当前账号重新保存。";
						result = false;
					}
					else
					{
						string name = record.Name;
						string password = record.Password;
						recordValidated = true;
						string inspect = "(()=>{if(globalThis.__PB_HOST_RECOVERY_EPOCH!==" + JsonSerializer.Serialize(epoch) + "||globalThis.__PB_HOST_VAULT_REVISION!==" + revision + "||globalThis.__PB_BRIDGE?.app?.meta?.account||globalThis.__PB_BRIDGE?.app?.run)return 'cancelled';const c=document.querySelector('.auth-card');if(!c||c.matches('.mt-card')||c.querySelector('.mt-ribbon,.ban-ribbon'))return 'blocked';if(c.querySelector('input[autocomplete=\"current-password\"]'))return 'login';const b=[...c.querySelectorAll('.auth-tabs button')].find(x=>/^(进入|Entrar|Log in|Sign in|Login)$/i.test(x.textContent.trim()));if(b&&!b.disabled){b.click();return 'selected'}return 'blocked'})()";
						string text = JsonNode.Parse(await RecoveryScriptAsync(inspect, token))?.GetValue<string>();
						if (text == "selected")
						{
							text = JsonNode.Parse(await RecoveryScriptAsync(inspect, token))?.GetValue<string>();
						}
						if (text != "login")
						{
							result = false;
						}
						else
						{
							token.ThrowIfCancellationRequested();
							lastRecoveryLoginAttempt = DateTimeOffset.UtcNow;
							formTicket = Guid.NewGuid().ToString("N");
							string text2 = new JsonObject
							{
								["name"] = name,
								["password"] = password,
								["ticket"] = formTicket,
								["epoch"] = epoch,
								["revision"] = revision
							}.ToJsonString();
							if (await RecoveryScriptAsync("((v)=>{if(location.origin!=='https://pokebonk.com'||globalThis.__PB_HOST_RECOVERY_EPOCH!==v.epoch||globalThis.__PB_HOST_VAULT_REVISION!==v.revision||globalThis.__PB_BRIDGE?.app?.meta?.account||globalThis.__PB_BRIDGE?.app?.run)return false;const c=document.querySelector('.auth-card');if(!c||c.matches('.mt-card')||c.querySelector('.mt-ribbon,.ban-ribbon'))return false;const u=c.querySelector('input[autocomplete=\"username\"]'),p=c.querySelector('input[autocomplete=\"current-password\"]'),b=c.querySelector('button.btn.big.blue');if(!u||!p||!b)return false;const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(u,v.name);u.dispatchEvent(new Event('input',{bubbles:true}));set.call(p,v.password);p.dispatchEvent(new Event('input',{bubbles:true}));if(b.disabled||globalThis.__PB_HOST_RECOVERY_EPOCH!==v.epoch||globalThis.__PB_HOST_VAULT_REVISION!==v.revision){set.call(p,'');return false}const f={ticket:v.ticket,input:p,userEdited:false,onInput:()=>{f.userEdited=true}};p.addEventListener('input',f.onInput,{once:true});globalThis.__PB_RECOVERY_LOGIN_FORM=f;b.click();return true}) (" + text2 + ")", token) != "true")
							{
								result = false;
							}
							else
							{
								recoveryLoginMessage = "正在通过游戏原生登录界面重登；只有确认是原账号后才会继续挂机。";
								int index = 0;
								while (true)
								{
									if (index < 100)
									{
										token.ThrowIfCancellationRequested();
										if (revision != recoveryVaultRevision || epoch != recoveryJavaScriptEpoch || intent != intentGeneration || generation != recoveryGeneration)
										{
											throw new OperationCanceledException("登录信息或运行意图已改变");
										}
										string liveHash = await LiveAccountIdentityHashAsync(token);
										if (liveHash != null)
										{
											if (requiredHash == null || liveHash == requiredHash)
											{
												if (await MatchingRecoveryLoginIdentityHashAsync(name, token) != liveHash)
												{
													recoveryLoginBlocked = true;
													recoveryLoginMessage = "原生登录身份尚未与填写账号相符，未自动接管。";
													result = false;
													break;
												}
												token.ThrowIfCancellationRequested();
												if (revision != recoveryVaultRevision || epoch != recoveryJavaScriptEpoch || intent != intentGeneration || generation != recoveryGeneration)
												{
													throw new OperationCanceledException("登录准备已取消");
												}
												if (record.IdentityHash == null)
												{
													await WriteRecoveryLoginRecordAsync(record with
													{
														IdentityHash = liveHash
													}, revision, token);
												}
												token.ThrowIfCancellationRequested();
												if (revision != recoveryVaultRevision || epoch != recoveryJavaScriptEpoch || intent != intentGeneration || generation != recoveryGeneration)
												{
													throw new OperationCanceledException("登录准备已取消");
												}
												if (expectedRecoveryIdentity == null)
												{
													expectedRecoveryIdentity = liveHash;
												}
												recoveryLoginMessage = "原账号已重新登录，等待原生补存完成后自动继续。";
												Log("info", "自动重登成功", "已核对为原续挂账号，等待游戏进度同步。");
												result = true;
												break;
											}
											recoveryLoginBlocked = true;
											recoveryLoginMessage = "登录结果与原续挂账号不一致，已停止自动提交。请检查登录信息。";
											result = false;
											break;
										}
										string text3 = JsonNode.Parse(await RecoveryScriptAsync("(()=>{const c=document.querySelector('.auth-card');if(c?.matches('.mt-card')||c?.querySelector('.mt-ribbon,.ban-ribbon'))return 'restricted';const e=c?.querySelector('.err')?.textContent?.trim()||'';if(!e)return '';if(/密码.*(?:错误|不正确)|incorrect|invalid|wrong|incorrectos|inválid|captcha|验证码|封禁|banned|suspendid/i.test(e))return 'rejected';if(/(?:error|http)\\s*:?\\s*(?:408|429|5\\d\\d)\\b/i.test(e)||/^\\s*(?:408|429|5\\d\\d)\\s*$/.test(e)||/network|fetch|offline|connection|timeout|temporar|网络|连接|超时|稍后|稍候|尝试过多|too many|rate limit|sin conexión|espera/i.test(e))return 'retryable';return 'rejected'})()", token))?.GetValue<string>();
										if ((text3 == "restricted" || text3 == "rejected") ? true : false)
										{
											recoveryLoginBlocked = true;
											recoveryLoginMessage = "游戏未接受保存的登录信息，或要求人工验证。已停止自动提交，请更新本机登录信息或在上方完成登录；任务仍等待续接。";
											Log("error", "自动重登需要处理", "游戏未接受登录或要求人工验证；未记录账号、密码或原始错误内容。");
											result = false;
											break;
										}
										await Task.Delay(200, token);
										index++;
										continue;
									}
									recoveryLoginMessage = "自动重登尚未完成，将等待连接恢复后按退避间隔重试。";
									result = false;
									break;
								}
							}
						}
					}
				}
			}
			catch (OperationCanceledException)
			{
				throw;
			}
			catch (Exception ex2) when (((ex2 is CryptographicException || ex2 is JsonException || ex2 is KeyNotFoundException || ex2 is InvalidOperationException || ex2 is Win32Exception) ? 1 : 0) != 0)
			{
				if (recordValidated)
				{
					throw;
				}
				recoveryLoginBlocked = true;
				recoveryLoginMessage = "无法读取本机加密登录信息。它只能由保存时的Windows用户使用，请重新保存。";
				result = false;
			}
		}
		finally
		{
			if (formTicket != null && !gameProcessFailed && ready)
			{
				try
				{
					await RecoveryScriptAsync("(()=>{const f=globalThis.__PB_RECOVERY_LOGIN_FORM;if(f?.ticket!==" + JsonSerializer.Serialize(formTicket) + ")return;f.input?.removeEventListener('input',f.onInput);if(f.input?.isConnected&&!f.userEdited)f.input.value='';delete globalThis.__PB_RECOVERY_LOGIN_FORM})()", CancellationToken.None, TimeSpan.FromSeconds(2.0));
				}
				catch
				{
				}
			}
		}
		return result;
	}

	private async Task<bool> TryGuestFallbackAsync(CancellationToken token)
	{
		if (!guestFallbackAuthorized || !wantedRunIntent || !recoveryLoginKnown || recoveryLoginComplete || recoveryLoginHasDraft || recoveryLoginBlocked)
		{
			return false;
		}
		string epoch = recoveryJavaScriptEpoch;
		long revision = recoveryVaultRevision;
		long generation = recoveryGeneration;
		if (epoch == null)
		{
			return false;
		}
		if (pendingTemporaryGuestTicket == null)
		{
			if (DateTimeOffset.UtcNow - lastGuestFallbackAttempt < TimeSpan.FromSeconds(60.0))
			{
				return false;
			}
			JsonObject values = new JsonObject
			{
				["epoch"] = epoch,
				["revision"] = revision,
				["ticket"] = Guid.NewGuid().ToString("N")
			};
			JsonNode jsonNode = JsonNode.Parse(await RecoveryScriptAsync("((v)=>{\n  if(location.origin!=='https://pokebonk.com'||!v.epoch||globalThis.__PB_HOST_RECOVERY_EPOCH!==v.epoch||globalThis.__PB_HOST_VAULT_REVISION!==v.revision)return {code:'cancelled'};\n  const a=globalThis.__PB_BRIDGE?.app;if(!a||a.meta?.account||a.run)return {code:'account-or-run'};\n  try{if(localStorage.getItem('pb.session')!==null)return {code:'cached-session'}}catch{return {code:'storage-unavailable'}}\n  const cards=[...document.querySelectorAll('.auth-card')];if(cards.length!==1)return {code:'not-welcome'};\n  const c=cards[0];if(c.matches('.mt-card')||c.querySelector('.mt-ribbon,.ban-ribbon')||document.querySelector('.captcha-box,.cf-turnstile,iframe[src*=\"challenges.cloudflare.com\"]'))return {code:'restricted'};\n  if(c.querySelector('.err')?.textContent?.trim())return {code:'native-error'};\n  if([...c.querySelectorAll('input')].some(i=>!!i.value))return {code:'native-input'};\n  const buttons=[...c.querySelectorAll('.auth-body > button.btn.big.red')].filter(b=>/^(?:¡?Jugar como invitado!?|以游客身份游玩[！!]?|Play as guest[！!]?)$/i.test(b.textContent.trim()));\n  if(buttons.length===1&&!buttons[0].disabled&&!c.querySelector('input[autocomplete=\"current-password\"],input[autocomplete=\"new-password\"]'))return {code:'ready'};\n  const tabs=[...c.querySelectorAll('.auth-tabs button')].filter(b=>/^(?:Invitado|游客|Guest)$/i.test(b.textContent.trim()));\n  if(tabs.length!==1||tabs[0].disabled)return {code:'no-guest-entry'};\n  tabs[0].click();return {code:'selected'};\n})(" + values.ToJsonString() + ")", token));
			if (Str(jsonNode?["code"]) == "selected")
			{
				jsonNode = JsonNode.Parse(await RecoveryScriptAsync("((v)=>{\n  if(location.origin!=='https://pokebonk.com'||!v.epoch||globalThis.__PB_HOST_RECOVERY_EPOCH!==v.epoch||globalThis.__PB_HOST_VAULT_REVISION!==v.revision)return {code:'cancelled'};\n  const a=globalThis.__PB_BRIDGE?.app;if(!a||a.meta?.account||a.run)return {code:'account-or-run'};\n  try{if(localStorage.getItem('pb.session')!==null)return {code:'cached-session'}}catch{return {code:'storage-unavailable'}}\n  const cards=[...document.querySelectorAll('.auth-card')];if(cards.length!==1)return {code:'not-welcome'};\n  const c=cards[0];if(c.matches('.mt-card')||c.querySelector('.mt-ribbon,.ban-ribbon')||document.querySelector('.captcha-box,.cf-turnstile,iframe[src*=\"challenges.cloudflare.com\"]'))return {code:'restricted'};\n  if(c.querySelector('.err')?.textContent?.trim())return {code:'native-error'};\n  if([...c.querySelectorAll('input')].some(i=>!!i.value))return {code:'native-input'};\n  const buttons=[...c.querySelectorAll('.auth-body > button.btn.big.red')].filter(b=>/^(?:¡?Jugar como invitado!?|以游客身份游玩[！!]?|Play as guest[！!]?)$/i.test(b.textContent.trim()));\n  if(buttons.length===1&&!buttons[0].disabled&&!c.querySelector('input[autocomplete=\"current-password\"],input[autocomplete=\"new-password\"]'))return {code:'ready'};\n  const tabs=[...c.querySelectorAll('.auth-tabs button')].filter(b=>/^(?:Invitado|游客|Guest)$/i.test(b.textContent.trim()));\n  if(tabs.length!==1||tabs[0].disabled)return {code:'no-guest-entry'};\n  tabs[0].click();return {code:'selected'};\n})(" + values.ToJsonString() + ")", token));
			}
			if (Str(jsonNode?["code"]) != "ready")
			{
				recoveryLoginMessage = "原生游客入口尚未允许自动使用（" + Str(jsonNode?["code"]) + "），等待玩家或连接恢复。";
				return false;
			}
			token.ThrowIfCancellationRequested();
			if (revision != recoveryVaultRevision || !guestFallbackAuthorized || !wantedRunIntent)
			{
				return false;
			}
			if (Str(JsonNode.Parse(await RecoveryScriptAsync("((v)=>{\n  if(location.origin!=='https://pokebonk.com'||!v.epoch||globalThis.__PB_HOST_RECOVERY_EPOCH!==v.epoch||globalThis.__PB_HOST_VAULT_REVISION!==v.revision)return {code:'cancelled'};\n  const a=globalThis.__PB_BRIDGE?.app;if(!a?.meta||a.meta.account||a.run)return {code:'account-or-run'};\n  let hadGuestCache;try{if(localStorage.getItem('pb.session')!==null)return {code:'cached-session'};hadGuestCache=localStorage.getItem('pb.guest')!==null}catch{return {code:'storage-unavailable'}}\n  const cards=[...document.querySelectorAll('.auth-card')];if(cards.length!==1)return {code:'not-welcome'};\n  const c=cards[0];if(c.matches('.mt-card')||c.querySelector('.mt-ribbon,.ban-ribbon')||document.querySelector('.captcha-box,.cf-turnstile,iframe[src*=\"challenges.cloudflare.com\"]'))return {code:'restricted'};\n  if(c.querySelector('.err')?.textContent?.trim())return {code:'native-error'};\n  if([...c.querySelectorAll('input')].some(i=>!!i.value)||c.querySelector('input[autocomplete=\"current-password\"],input[autocomplete=\"new-password\"]'))return {code:'native-input'};\n  const buttons=[...c.querySelectorAll('.auth-body > button.btn.big.red')].filter(b=>/^(?:¡?Jugar como invitado!?|以游客身份游玩[！!]?|Play as guest[！!]?)$/i.test(b.textContent.trim()));\n  if(buttons.length!==1||buttons[0].disabled)return {code:'no-guest-entry'};\n  globalThis.__PB_TEMP_GUEST_REQUEST={ticket:v.ticket,epoch:v.epoch,revision:v.revision,app:a,meta:a.meta,hadGuestCache,account:null};\n  buttons[0].click();return {code:'submitted',hadGuestCache};\n})(" + values.ToJsonString() + ")", token))?["code"]) != "submitted")
			{
				return false;
			}
			pendingTemporaryGuestTicket = Str(values["ticket"]);
			lastGuestFallbackAttempt = DateTimeOffset.UtcNow;
			recoveryLoginMessage = "没有填写登录信息且没有原生会话，正在通过游戏原生入口连接临时游客；不代表原账号已恢复。";
			Log("info", "正在连接临时游客", "使用原生游客入口；原注册账号待补存记录保留，不会冒认为已保存。");
		}
		for (int index = 0; index < 100; index++)
		{
			token.ThrowIfCancellationRequested();
			if (revision != recoveryVaultRevision || epoch != recoveryJavaScriptEpoch || generation != recoveryGeneration || !guestFallbackAuthorized || !wantedRunIntent)
			{
				throw new OperationCanceledException("临时游客准备已取消");
			}
			JsonObject jsonObject = new JsonObject
			{
				["epoch"] = epoch,
				["revision"] = revision,
				["ticket"] = pendingTemporaryGuestTicket
			};
			string text = Str(JsonNode.Parse(await RecoveryScriptAsync("((v)=>{\n  if(location.origin!=='https://pokebonk.com'||!v.epoch||globalThis.__PB_HOST_RECOVERY_EPOCH!==v.epoch||globalThis.__PB_HOST_VAULT_REVISION!==v.revision)return {code:'cancelled'};\n  const x=globalThis.__PB_TEMP_GUEST_REQUEST,a=globalThis.__PB_BRIDGE?.app;\n  if(!x||x.ticket!==v.ticket||x.epoch!==v.epoch||x.revision!==v.revision||x.app!==a||x.meta!==a?.meta||a.run||a.meta.account?.guest!==true)return {code:'not-owned-guest'};\n  if(x.account&&x.account!==a.meta.account)return {code:'account-changed'};\n  x.account??=a.meta.account;\n  if(document.querySelector('.mt-card,.mt-ribbon,.ban-ribbon,.captcha-box,.cf-turnstile,iframe[src*=\"challenges.cloudflare.com\"]')||[...document.querySelectorAll('.err')].some(e=>e.textContent?.trim()))return {code:'restricted'};\n  if(!a.meta.profile)return {code:'profile-wait'};\n  if(a.meta.profile.starter)return {code:'ready'};\n  if(x.hadGuestCache)return {code:'existing-guest-starter'};\n  if(x.starterClicked)return {code:'starter-wait'};\n  const screens=[...document.querySelectorAll('.screen.sp')];if(screens.length!==1)return {code:'starter-wait'};\n  const cards=[...screens[0].querySelectorAll('button.sp-card')],chosen=cards.filter(b=>b.classList.contains('on'));\n  const buttons=[...screens[0].querySelectorAll('button.btn.big.red.sp-go')];\n  if(cards.length!==3||chosen.length!==1||buttons.length!==1||buttons[0].disabled)return {code:'starter-wait'};\n  x.starterClicked=true;buttons[0].click();return {code:'starter-submitted'};\n})(" + jsonObject.ToJsonString() + ")", token))?["code"]);
			bool flag;
			switch (text)
			{
			case "ready":
			{
				string text2 = await LiveAccountIdentityHashAsync(token);
				if (text2 == null)
				{
					return false;
				}
				if (revision != recoveryVaultRevision || epoch != recoveryJavaScriptEpoch || generation != recoveryGeneration || !guestFallbackAuthorized || !wantedRunIntent)
				{
					throw new OperationCanceledException();
				}
				AdoptTemporaryGuest(text2);
				pendingTemporaryGuestTicket = null;
				return true;
			}
			case "cancelled":
			case "account-changed":
			case "existing-guest-starter":
			case "restricted":
				flag = true;
				break;
			default:
				flag = false;
				break;
			}
			if (flag)
			{
				recoveryLoginMessage = ((text == "existing-guest-starter") ? "恢复到已有游客，但初始精灵仍需玩家在原生界面选择。" : "原生页面需要处理或准备已取消，未继续创建或接管游客。");
				return false;
			}
			await Task.Delay(250, token);
		}
		return false;
	}

	[DllImport("crypt32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
	[return: MarshalAs(UnmanagedType.Bool)]
	private static extern bool CryptProtectData(ref RecoveryDataBlob input, string? description, nint entropy, nint reserved, nint prompt, int flags, out RecoveryDataBlob output);

	[DllImport("crypt32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
	[return: MarshalAs(UnmanagedType.Bool)]
	private static extern bool CryptUnprotectData(ref RecoveryDataBlob input, nint description, nint entropy, nint reserved, nint prompt, int flags, out RecoveryDataBlob output);

	[DllImport("kernel32.dll")]
	private static extern nint LocalFree(nint pointer);

	private static byte[] ProtectRecoveryLogin(byte[] bytes, bool decrypt)
	{
		RecoveryDataBlob input = new RecoveryDataBlob
		{
			Length = bytes.Length,
			Data = Marshal.AllocHGlobal(bytes.Length)
		};
		RecoveryDataBlob output = default(RecoveryDataBlob);
		try
		{
			Marshal.Copy(bytes, 0, input.Data, bytes.Length);
			bool flag = !(decrypt ? CryptUnprotectData(ref input, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 1, out output) : CryptProtectData(ref input, "PokeBonk Pilot local recovery login", IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 1, out output));
			if (!flag)
			{
				int length = output.Length;
				bool flag2 = ((length < 1 || length > 65536) ? true : false);
				flag = flag2;
			}
			if (flag)
			{
				throw new CryptographicException("本机加密登录信息不可用。");
			}
			byte[] array = new byte[output.Length];
			Marshal.Copy(output.Data, array, 0, array.Length);
			return array;
		}
		finally
		{
			for (int i = 0; i < input.Length; i++)
			{
				Marshal.WriteByte(input.Data, i, 0);
			}
			Marshal.FreeHGlobal(input.Data);
			if (output.Data != IntPtr.Zero)
			{
				for (int j = 0; j < output.Length; j++)
				{
					Marshal.WriteByte(output.Data, j, 0);
				}
				LocalFree(output.Data);
			}
		}
	}

	private bool RestReminderHostCurrent(string token)
	{
		if (!closing && ready && !gameProcessFailed && restReminderToken == token && restReminderPage == pageGeneration && restReminderIntent == intentGeneration)
		{
			return restReminderView == GameView;
		}
		return false;
	}

	private void ObserveRestReminderSnapshot()
	{
		if (closing || !ready || gameProcessFailed || !Flag(game?["enabled"]) || !RestReminderState.TryRead(game?["restReminder"], out var state))
		{
			CloseRestReminderWindow();
			ClearRestReminderOperationStatus();
			restReminderToken = null;
			restReminderDismissedToken = null;
			return;
		}
		if (restReminderToken != state.Token || restReminderPage != pageGeneration || restReminderIntent != intentGeneration || restReminderView != GameView)
		{
			CloseRestReminderWindow();
			ClearRestReminderOperationStatus();
			restReminderToken = state.Token;
			restReminderDismissedToken = null;
			restReminderPage = pageGeneration;
			restReminderIntent = intentGeneration;
			restReminderView = GameView;
		}
		if (restReminderDismissedToken == state.Token)
		{
			return;
		}
		if (restReminderWindow == null)
		{
			string token = state.Token;
			RestReminderWindow popup = new RestReminderWindow(state, () => RestReminderHostCurrent(token), delegate
			{
				restReminderDismissedToken = token;
				AcknowledgeRestReminderAsync(token);
			});
			restReminderWindow = popup;
			popup.Owner = this;
			popup.Closed += delegate
			{
				if (restReminderWindow == popup)
				{
					restReminderWindow = null;
				}
			};
			popup.Show();
		}
		else
		{
			restReminderWindow.Observe(state.RemainingMilliseconds);
		}
	}

	private void CloseRestReminderWindow()
	{
		RestReminderWindow? obj = restReminderWindow;
		restReminderWindow = null;
		obj?.CloseWithoutAcknowledgement();
	}

	private void ClearRestReminderOperationStatus()
	{
		if (restReminderOperationStatus != null && operationStatus == restReminderOperationStatus)
		{
			operationStatus = null;
		}
		restReminderOperationStatus = null;
	}

	private void RestReminderNotice(string message)
	{
		restReminderOperationStatus = (operationStatus = message);
	}

	private async Task AcknowledgeRestReminderAsync(string token)
	{
		if (!RestReminderHostCurrent(token) || restReminderAcknowledgingToken == token)
		{
			return;
		}
		restReminderAcknowledgingToken = token;
		try
		{
			string text = await GameScriptAsync("globalThis.__PB_PILOT?.acknowledgeRestReminder(" + JsonSerializer.Serialize(token) + ") === true");
			if (RestReminderHostCurrent(token) && text != "true")
			{
				RestReminderNotice("休息提醒已关闭；当前条件尚未允许继续，辅助将按启用时段与当前游戏状态处理。");
			}
		}
		catch (OperationCanceledException)
		{
		}
		catch (Exception)
		{
			if (RestReminderHostCurrent(token))
			{
				RestReminderNotice("休息提醒确认尚未完成，请稍后重试；未强制继续游戏。");
			}
		}
		finally
		{
			if (restReminderAcknowledgingToken == token)
			{
				restReminderAcknowledgingToken = null;
			}
		}
	}

	private void PreserveScheduledStart(JsonObject payload, long intent)
	{
		scheduledStartPayload = payload.DeepClone().AsObject();
		scheduledStartIntent = intent;
		status = (operationStatus = "脚本已待命，等待配置的北京时间启用时段。");
		if (ProcessStart == null)
		{
			ProcessStart = DateTimeOffset.Now.ToString("O");
		}
	}

	private async Task<bool> TickScheduledStartAsync()
	{
		if (!ScheduledStartPending)
		{
			scheduledStartPayload = null;
			return false;
		}
		if (!HostScheduleAllowed)
		{
			status = "脚本已待命，等待配置的北京时间启用时段。";
			lastTick = Stopwatch.GetTimestamp();
			await SendState();
			return true;
		}
		long intent = scheduledStartIntent;
		await commandLock.WaitAsync();
		try
		{
			if (!ScheduledStartPending || scheduledStartIntent != intent || !HostScheduleAllowed)
			{
				return true;
			}
			JsonObject payload = scheduledStartPayload;
			scheduledStartPayload = null;
			await Command("start", payload, intent);
		}
		finally
		{
			operationStatus = null;
			commandLock.Release();
		}
		return true;
	}

	private JsonObject GetSkinState()
	{
		return SkinFiles.State();
	}

	private JsonObject? SelectedSkinPayload()
	{
		return SkinFiles.Selection();
	}

	private async Task<JsonObject> SkinStateWithRuntimeAsync(JsonObject? state = null)
	{
		if (state == null)
		{
			state = GetSkinState();
		}
		state["runtime"] = new JsonObject
		{
			["phase"] = "unavailable",
			["reason"] = "皮肤选择已保存在本机；游戏加载完成后应用"
		};
		if (ready && !gameProcessFailed)
		{
			try
			{
				JsonObject jsonObject = state;
				jsonObject["runtime"] = (JsonNode.Parse(await GameScriptAsync("globalThis.__PB_PLAYER_SKINS?.getStatus()??null")) as JsonObject) ?? state["runtime"]?.DeepClone();
			}
			catch (Exception ex) when (!(ex is OutOfMemoryException))
			{
			}
		}
		if (lastSkinOperation?["phase"]?.GetValue<string>() == "error")
		{
			state["runtime"] = lastSkinOperation.DeepClone();
		}
		return state;
	}

	private async Task ApplySelectedSkinAsync()
	{
		await skinApplyLock.WaitAsync();
		skinApplying = true;
		try
		{
			await ApplySelectedSkinCoreAsync();
		}
		finally
		{
			skinApplying = false;
			skinNextRetryAt = DateTimeOffset.UtcNow.AddSeconds(2.0);
			skinApplyLock.Release();
		}
	}

	private async Task EnsureSkinForCurrentPageAsync()
	{
		if (!ready || gameProcessFailed || closing || skinApplying || skinAppliedPageGeneration == pageGeneration || DateTimeOffset.UtcNow < skinNextRetryAt)
		{
			return;
		}
		skinNextRetryAt = DateTimeOffset.UtcNow.AddSeconds(2.0);
		try
		{
			if (!(await GameScriptAsync("(()=>{const s=globalThis.__PB_PLAYER_SKINS,r=globalThis.__PB_PLAYER_SKIN_HOST_REQUEST;return !!s&&!(r?.failed&&r.runtime===s)})()") != "true"))
			{
				await ApplySelectedSkinAsync();
			}
		}
		catch (Exception ex) when (!(ex is OutOfMemoryException))
		{
			lastSkinOperation = new JsonObject
			{
				["phase"] = "unavailable",
				["reason"] = "皮肤选择已保留；等待游戏页面恢复后应用"
			};
		}
	}

	private async Task ApplySelectedSkinCoreAsync()
	{
		lastSkinOperation = null;
		if (!ready || gameProcessFailed)
		{
			return;
		}
		long generation = pageGeneration;
		JsonObject jsonObject = SelectedSkinPayload();
		string selectionId = jsonObject?["id"]?.GetValue<string>();
		string nonce = Guid.NewGuid().ToString("N");
		string text = ((jsonObject == null) ? "skins.clearSkin()" : ("skins.setSkin(" + jsonObject.ToJsonString() + ")"));
		string script = "(()=>{const skins=globalThis.__PB_PLAYER_SKINS;if(!skins)return false;const request={nonce:'" + nonce + "',runtime:skins,done:false,error:null,failed:false,accepted:false};globalThis.__PB_PLAYER_SKIN_HOST_REQUEST=request;try{Promise.resolve(" + text + ").then(result=>{request.accepted=result?.ok!==false;if(result?.ok===false&&!result.superseded){request.failed=true;request.error=String(result.reason||'皮肤渲染失败').slice(0,280)}request.done=true},error=>{request.failed=true;request.error=String(error?.message||'皮肤渲染失败').slice(0,280);request.done=true})}catch(error){request.failed=true;request.error=String(error?.message||'皮肤渲染失败').slice(0,280);request.done=true}return true})()";
		if (await GameScriptAsync(script) != "true")
		{
			lastSkinOperation = new JsonObject
			{
				["phase"] = "unavailable",
				["reason"] = "皮肤选择已保存；游戏皮肤渲染器尚未就绪，加载后自动应用"
			};
			return;
		}
		DateTimeOffset deadline = DateTimeOffset.UtcNow.AddSeconds(12.0);
		while (DateTimeOffset.UtcNow < deadline)
		{
			JsonNode jsonNode = JsonNode.Parse(await GameScriptAsync("(()=>{const r=globalThis.__PB_PLAYER_SKIN_HOST_REQUEST;return r?.nonce==='" + nonce + "'?{done:r.done,error:r.error,accepted:r.accepted}:null})()"));
			if (jsonNode == null)
			{
				lastSkinOperation = new JsonObject
				{
					["phase"] = "unavailable",
					["reason"] = "皮肤选择已保存；游戏页面已变化，加载后自动应用"
				};
				return;
			}
			JsonNode? jsonNode2 = jsonNode["done"];
			if (jsonNode2 != null && jsonNode2.GetValueKind() == JsonValueKind.True)
			{
				JsonNode? jsonNode3 = jsonNode["error"];
				if (jsonNode3 != null && jsonNode3.GetValueKind() == JsonValueKind.String)
				{
					lastSkinOperation = new JsonObject
					{
						["phase"] = "error",
						["reason"] = jsonNode["error"].GetValue<string>()
					};
					return;
				}
				JsonNode? jsonNode4 = jsonNode["accepted"];
				if (jsonNode4 != null && jsonNode4.GetValueKind() == JsonValueKind.True && generation == pageGeneration && selectionId == SkinFiles.SelectedId)
				{
					skinAppliedPageGeneration = generation;
				}
				return;
			}
			await Task.Delay(100);
		}
		await GameScriptAsync("(()=>{const r=globalThis.__PB_PLAYER_SKIN_HOST_REQUEST;if(r?.nonce==='" + nonce + "')r.failed=true})()");
		lastSkinOperation = new JsonObject
		{
			["phase"] = "error",
			["reason"] = "皮肤选择已保存；图片加载超时，请等待游戏就绪后重试"
		};
	}

	private async Task PauseForSkinFileDialog()
	{
		CancelRecoveryIntent("正在选择皮肤文件");
		if (!ready || gameProcessFailed || await GameScriptAsync("(()=>{const p=globalThis.__PB_PILOT;if(!p||!p.enabled&&p.app?.run?.state!=='play')return false;p.stop('正在选择皮肤文件',{pauseGame:true});return true})()") != "true")
		{
			return;
		}
		resumeAfterDeployment = false;
		for (int attempt = 0; attempt < 20; attempt++)
		{
			if (await GameScriptAsync("globalThis.__PB_BRIDGE?.app?.run?.state==='play'") != "true")
			{
				break;
			}
			if (attempt == 19)
			{
				throw new InvalidOperationException("游戏尚未确认暂停，请稍候再次选择皮肤文件");
			}
			await Task.Delay(50);
		}
		game = JsonNode.Parse(await GameScriptAsync("globalThis.__PB_PILOT?.snapshot() ?? null"))?.AsObject();
		status = "已暂停，选择皮肤文件后可点击继续";
		await SendState();
	}

	private static string SkinText(JsonObject payload, string field)
	{
		JsonNode? jsonNode = payload[field];
		if (jsonNode == null || jsonNode.GetValueKind() != JsonValueKind.String)
		{
			throw new InvalidOperationException("皮肤操作缺少有效的" + ((field == "name") ? "名称" : "编号"));
		}
		return payload[field].GetValue<string>();
	}

	private async Task<JsonObject> SkinCommand(string action, JsonObject payload)
	{
		switch (action)
		{
		case "getSkins":
			return await SkinStateWithRuntimeAsync();
		case "getSkinPreview":
		{
			JsonObject jsonObject = SkinFiles.Preview(SkinText(payload, "id"));
			jsonObject.Remove("pngDataUrl");
			return jsonObject;
		}
		case "getSkinPrompt":
			return new JsonObject { ["prompt"] = SkinFiles.Prompt };
		case "selectSkin":
		{
			JsonValueKind? jsonValueKind = payload["id"]?.GetValueKind();
			bool flag = ((!jsonValueKind.HasValue || jsonValueKind == JsonValueKind.Null) ? true : false);
			string id = (flag ? null : SkinText(payload, "id"));
			JsonObject state = SkinFiles.Select(id);
			await ApplySelectedSkinAsync();
			return await SkinStateWithRuntimeAsync(state);
		}
		case "renameSkin":
			return SkinFiles.Rename(SkinText(payload, "id"), SkinText(payload, "name"));
		case "deleteSkin":
		{
			string? selectedId = SkinFiles.SelectedId;
			string text3 = SkinText(payload, "id");
			JsonObject state = SkinFiles.Delete(text3);
			if (selectedId == text3)
			{
				await ApplySelectedSkinAsync();
			}
			return state;
		}
		case "restoreBuiltinSkins":
			return SkinFiles.RestoreBuiltin();
		case "importSkin":
		{
			await PauseForSkinFileDialog();
			OpenFileDialog dialog = new OpenFileDialog
			{
				Title = "导入皮肤：PNG 4×4 动作图集 / 皮肤包",
				Filter = "皮肤图集与皮肤包 (*.png;*.pbskin.json)|*.png;*.pbskin.json|PNG 图集 (*.png)|*.png|PokéBonk 皮肤包 (*.pbskin.json)|*.pbskin.json",
				InitialDirectory = portable.EnsureDirectory(portable.DataPath("skins")),
				Multiselect = false,
				CheckFileExists = true,
				AddToRecent = false
			};
			if (dialog.ShowDialog(this) != true)
			{
				return new JsonObject { ["cancelled"] = true };
			}
			JsonObject result = await Task.Run(() => SkinFiles.Import(dialog.FileName));
			Log("info", "皮肤已导入", "仅保存在当前客户端；点击使用后替换自己的角色外观。");
			return result;
		}
		case "exportSkin":
		{
			string id2 = SkinText(payload, "id");
			JsonNode? jsonNode = payload["format"];
			bool png = jsonNode != null && jsonNode.GetValueKind() == JsonValueKind.String && payload["format"].GetValue<string>() == "png";
			string name = SkinFiles.SuggestedExportName(id2, png);
			await PauseForSkinFileDialog();
			string initialDirectory2 = portable.EnsureDirectory(portable.DataPath("exports"));
			SaveFileDialog saveFileDialog2 = new SaveFileDialog
			{
				Title = "导出皮肤（请保存在 data/exports 内）",
				InitialDirectory = initialDirectory2,
				FileName = name,
				Filter = (png ? "PNG 动作图集 (*.png)|*.png" : "PokéBonk 皮肤包 (*.pbskin.json)|*.pbskin.json"),
				DefaultExt = (png ? ".png" : ".pbskin.json"),
				AddExtension = true,
				OverwritePrompt = true,
				AddToRecent = false
			};
			if (saveFileDialog2.ShowDialog(this) != true)
			{
				return new JsonObject { ["cancelled"] = true };
			}
			string text2 = SkinExportPath(saveFileDialog2.FileName);
			SkinFiles.Export(id2, text2, png);
			return new JsonObject
			{
				["cancelled"] = false,
				["fileName"] = Path.GetFileName(text2),
				["path"] = text2
			};
		}
		case "saveSkinPrompt":
		{
			await PauseForSkinFileDialog();
			string initialDirectory = portable.EnsureDirectory(portable.DataPath("exports"));
			SaveFileDialog saveFileDialog = new SaveFileDialog
			{
				Title = "保存皮肤生成提示词（请保存在 data/exports 内）",
				InitialDirectory = initialDirectory,
				FileName = "皮肤生成提示词.txt",
				Filter = "文本文件 (*.txt)|*.txt",
				DefaultExt = ".txt",
				AddExtension = true,
				OverwritePrompt = true,
				AddToRecent = false
			};
			if (saveFileDialog.ShowDialog(this) != true)
			{
				return new JsonObject { ["cancelled"] = true };
			}
			string text = SkinExportPath(saveFileDialog.FileName);
			SkinFiles.SavePrompt(text);
			return new JsonObject
			{
				["cancelled"] = false,
				["fileName"] = Path.GetFileName(text),
				["path"] = text
			};
		}
		default:
			throw new InvalidOperationException("未知的皮肤操作");
		}
	}

	private string SkinExportPath(string path)
	{
		try
		{
			return portable.ValidatePath(path);
		}
		catch (IOException)
		{
			throw new InvalidOperationException("请保存到客户端文件夹内（建议 data/exports），再手动复制或分享文件。");
		}
	}

	private void QueueVerifiedClearReceipt(JsonObject receipt)
	{
		if (!observedAccount.HasIdentity || observedAccount.IdentityHash == null)
		{
			return;
		}
		JsonNode? jsonNode = receipt["saved"];
		if (jsonNode != null && jsonNode.GetValueKind() == JsonValueKind.True)
		{
			JsonNode? jsonNode2 = receipt["victory"];
			if (jsonNode2 != null && jsonNode2.GetValueKind() == JsonValueKind.True && !(Str(receipt["nativeMode"]) != "standard") && !(Str(receipt["endHow"]) != "won"))
			{
				verifiedClearReceiptSignal = true;
			}
		}
	}

	private async Task UpdateVerifiedClearsAsync(bool allowClosing = false)
	{
		await verifiedClearScopeLock.WaitAsync();
		try
		{
			await UpdateVerifiedClearsCoreAsync(allowClosing);
		}
		finally
		{
			verifiedClearScopeLock.Release();
		}
	}

	private async Task UpdateVerifiedClearsCoreAsync(bool allowClosing)
	{
		bool active = Str(config["mode"]) == "allClears";
		string identity;
		long page;
		WebView2 view;
		string ticket;
		if (observedAccount.HasIdentity)
		{
			identity = observedAccount.IdentityHash;
			if (identity != null)
			{
				if (!active && !verifiedClearsPublished && !verifiedClearReceiptSignal)
				{
					verifiedClearsHistoryLoaded = false;
				}
				else
				{
					if (!ready || gameProcessFailed || (closing && !allowClosing))
					{
						return;
					}
					page = pageGeneration;
					view = GameView;
					ticket = Guid.NewGuid().ToString("N");
					if (verifiedClearsIdentity != identity)
					{
						verifiedClears = null;
						verifiedClearsIdentity = identity;
						verifiedClearsHistoryLoaded = (verifiedClearsPublished = false);
					}
					if (verifiedClearsPage != page)
					{
						verifiedClearsPage = page;
						verifiedClearsHistoryLoaded = (verifiedClearsPublished = false);
					}
					bool readHistory = active && !verifiedClearsHistoryLoaded;
					try
					{
						JsonNode captured = JsonNode.Parse(await GameScriptAsync("((ticket,readHistory)=>{\n  const p=globalThis.__PB_PILOT,a=globalThis.__PB_BRIDGE?.app,m=a?.meta,c=m?.account;\n  if(!p||p.app!==a||typeof p.setVerifiedClears!=='function'||typeof WeakRef!=='function'||!m?.profile||!c||typeof c.guest!=='boolean'||\n    !['string','number'].includes(typeof c.id)||!String(c.id)||typeof c.id==='number'&&!Number.isFinite(c.id))return null;\n  const prior=globalThis.__PB_HOST_CLEAR_PUBLISHED;\n  globalThis.__PB_HOST_CLEAR_SCOPE={ticket,pilot:new WeakRef(p),app:new WeakRef(a),meta:new WeakRef(m),account:new WeakRef(c)};\n  return {id:String(c.id),type:c.guest?'guest':'registered',\n    published:prior&&prior.pilot?.deref()===p&&prior.app?.deref()===a&&prior.meta?.deref()===m&&prior.account?.deref()===c?prior.version:null,\n    historyCurrent:p.isVerifiedClearProfileCurrent?.()===true,\n    receipts:p.readVerifiedClearReceipts?.()??[],\n    runs:readHistory&&p.isVerifiedClearProfileCurrent?.()===true?(Array.isArray(m.profile.runs)?m.profile.runs:[]).slice(0,2048)\n      .filter(r=>r?.mode==='standard'&&r.victory===true).map(r=>({species:r.species,biome:r.biome,tier:r.tier,mode:'standard',victory:true,\n        ...(r.end===undefined?{}:{end:r.end&&typeof r.end==='object'?{how:typeof r.end.how==='string'?r.end.how:null}:null})})):[]};\n})(" + JsonSerializer.Serialize(ticket) + "," + (readHistory ? "true" : "false") + ")"));
						bool flag = !(captured is JsonObject);
						if (!flag)
						{
							string text = Str(captured["type"]);
							bool flag2 = ((text == "guest" || text == "registered") ? true : false);
							flag = !flag2;
						}
						if (flag)
						{
							return;
						}
						string text2 = Str(captured["id"]);
						if (text2 == null || ClientAccountObservation.HashIdentity(Str(captured["type"]), text2) != identity)
						{
							return;
						}
						await RequireCurrent();
						if (verifiedClears == null)
						{
							verifiedClears = new ClientVerifiedClears(portable, identity, from character in catalog["characters"].AsArray().OfType<JsonObject>()
								select Num(character["id"]), from map in catalog["maps"].AsArray().OfType<JsonObject>()
								where Flag(map["live"])
								select Str(map["id"]) into map
								where map != null
								select map);
						}
						ClientVerifiedClears ledger = verifiedClears;
						ledger.Load();
						if (readHistory && Flag(captured["historyCurrent"]) && captured["runs"] is JsonArray rows)
						{
							ledger.ImportHistory(rows);
							verifiedClearsHistoryLoaded = true;
						}
						if (captured["receipts"] is JsonArray rows2)
						{
							ledger.ImportScopedReceipts(rows2);
						}
						verifiedClearReceiptSignal = false;
						await ledger.SaveAsync(RequireCurrent);
						if (ledger.ReadWarning != null && !verifiedClearsWarningShown)
						{
							verifiedClearsWarningShown = true;
							Log("warning", "本地通关格暂未持久保存", ledger.ReadWarning);
						}
						string version = page + ":" + ledger.Revision + ":" + (active ? "1" : "0");
						if (Str(captured["published"]) != version)
						{
							JsonArray rows3 = (active ? ledger.Snapshot() : new JsonArray());
							await RequireCurrent();
							if (await GameScriptAsync("(()=>{if(!((ticket)=>{\n  const s=globalThis.__PB_HOST_CLEAR_SCOPE,p=globalThis.__PB_PILOT,a=globalThis.__PB_BRIDGE?.app,m=a?.meta;\n  return !!s&&s.ticket===ticket&&s.pilot?.deref()===p&&p?.app===a&&s.app?.deref()===a&&s.meta?.deref()===m&&s.account?.deref()===m?.account;\n})(" + JsonSerializer.Serialize(ticket) + "))return false;const s=globalThis.__PB_HOST_CLEAR_SCOPE;if(s.pilot.deref().setVerifiedClears(" + rows3.ToJsonString() + ")!==true)return false;globalThis.__PB_HOST_CLEAR_PUBLISHED={...s,version:" + JsonSerializer.Serialize(version) + "};return true})()") == "true")
							{
								verifiedClearsPublished = active;
							}
						}
						return;
					}
					finally
					{
						if (page == pageGeneration && view == GameView && !gameProcessFailed)
						{
							try
							{
								MainWindow mainWindow = this;
								string script = "if(globalThis.__PB_HOST_CLEAR_SCOPE?.ticket===" + JsonSerializer.Serialize(ticket) + ")globalThis.__PB_HOST_CLEAR_SCOPE=null";
								TimeSpan? timeout = TimeSpan.FromSeconds(2.0);
								await mainWindow.GameScriptAsync(script, default(CancellationToken), timeout);
							}
							catch
							{
							}
						}
					}
				}
				return;
			}
		}
		verifiedClears = null;
		verifiedClearsIdentity = null;
		verifiedClearsPublished = (verifiedClearsHistoryLoaded = false);
		verifiedClearReceiptSignal = false;
		bool HostCurrent()
		{
			if (page == pageGeneration && view == GameView && !gameProcessFailed && (!closing || allowClosing) && observedAccount.HasIdentity && observedAccount.IdentityHash == identity)
			{
				return active == (Str(config["mode"]) == "allClears");
			}
			return false;
		}
		async Task RequireCurrent()
		{
			bool flag3 = !HostCurrent();
			if (!flag3)
			{
				flag3 = await GameScriptAsync("((ticket)=>{\n  const s=globalThis.__PB_HOST_CLEAR_SCOPE,p=globalThis.__PB_PILOT,a=globalThis.__PB_BRIDGE?.app,m=a?.meta;\n  return !!s&&s.ticket===ticket&&s.pilot?.deref()===p&&p?.app===a&&s.app?.deref()===a&&s.meta?.deref()===m&&s.account?.deref()===m?.account;\n})(" + JsonSerializer.Serialize(ticket) + ")") != "true";
			}
			if (flag3 || !HostCurrent())
			{
				throw new OperationCanceledException("通关进度同步的账号、模式或页面已变化，已丢弃旧操作。");
			}
		}
	}

	private void MergeWecomPatch(JsonObject incoming)
	{
		if (incoming["wecomPush"] is JsonObject patch)
		{
			incoming["wecomPush"] = WecomSettings.Merge(config["wecomPush"], patch);
		}
		else if (incoming.ContainsKey("wecomPush"))
		{
			incoming["wecomPush"] = WecomSettings.Defaults();
		}
	}

	private void StopWecom(string reason)
	{
		WecomPushService? wecomPushService = wecomService;
		string text = ((wecomPushService != null && wecomPushService.RequiresGameObservation) ? wecomService.Generation : wecomCollectorGeneration);
		long page = pageGeneration;
		WebView2 gameView = GameView;
		CoreWebView2 coreWebView = GameView.CoreWebView2;
		wecomRevision++;
		if (wecomService != null)
		{
			wecomService.Dispose();
			wecomLastRuntime = wecomService.Status();
			wecomLastRuntime["lastStatus"] = reason;
		}
		wecomService = null;
		wecomCollectorGeneration = "";
		wecomStatus = reason;
		wecomConfiguredPage = -1L;
		wecomConfiguredController = "";
		wecomConfiguredCore = null;
		wecomIdentityScope = (wecomSavedScope = (wecomClientState = ""));
		wecomFailureScope = (wecomObservedRunning = false);
		wecomSavedSets.Clear();
		wecomSavedLevels.Clear();
		wecomSavedNumbers.Clear();
		wecomActionCancellation.Cancel();
		wecomActionCancellation.Dispose();
		wecomActionCancellation = new CancellationTokenSource();
		if (text.Length > 0 && !gameProcessFailed && ready)
		{
			ClearWecomCollectorAsync(text, page, gameView, coreWebView);
		}
	}

	private void WecomOnPageChanged()
	{
		if (wecomService != null || WecomSettings.Yes(config["wecomPush"]?["enabled"]))
		{
			StopWecom("游戏页面变化，旧页面待发已取消");
			wecomSignature = "";
			RefreshWecomRuntimeAsync();
		}
	}

	private bool WecomPageCurrent(long page, object view, object? core)
	{
		if (!closing && !gameProcessFailed && page == pageGeneration && view == GameView)
		{
			return core == GameView.CoreWebView2;
		}
		return false;
	}

	private async Task ClearWecomCollectorAsync(string generation, long page, object view, object? core)
	{
		if (!WecomPageCurrent(page, view, core))
		{
			return;
		}
		try
		{
			await GameScriptAsync("globalThis.__PB_PILOT?.configureWecomPush?.(null," + JsonSerializer.Serialize(generation) + ")");
		}
		catch
		{
		}
	}

	private async Task RefreshWecomRuntimeAsync(bool force = false)
	{
		JsonObject settings = WecomSettings.Normalize(config["wecomPush"]);
		string text = settings.ToJsonString();
		if (!force && text == wecomSignature)
		{
			return;
		}
		wecomSignature = text;
		StopWecom("正在更新企微配置，旧代次待发已取消");
		long revision = wecomRevision;
		if (!WecomSettings.Yes(settings["enabled"]) || WecomSettings.Selected(settings).Count == 0)
		{
			wecomStatus = "企微推送未开启或没有勾选项目；不运行后台采集或发送";
			return;
		}
		string[] array = WecomSettings.Selected(settings).Values.Select((JsonObject x) => WecomSettings.Text(x["targetId"], WecomSettings.Text(settings["targetId"]))).Where(WecomSettings.ValidId).Distinct()
			.ToArray();
		if (array.Length == 0)
		{
			wecomStatus = "请先配置并选择接收目标；未启动采集或发送";
			return;
		}
		try
		{
			Dictionary<string, WecomTarget> targets = new Dictionary<string, WecomTarget>(StringComparer.Ordinal);
			string[] array2 = array;
			foreach (string id in array2)
			{
				WecomTarget wecomTarget = await WecomStore.ResolveAsync(id);
				if (wecomTarget != null)
				{
					targets[id] = wecomTarget;
				}
			}
			if (revision == wecomRevision && !closing)
			{
				if (targets.Count == 0)
				{
					wecomStatus = "没有可用接收目标，请重新配置；未启动采集或发送";
					return;
				}
				string generation = Guid.NewGuid().ToString("N");
				wecomService = new WecomPushService(settings, targets, WecomStore, generation, WecomTransportFactory?.Invoke(settings["network"].AsObject()), WecomTestClock, null, WecomStartWorker);
				wecomStatus = "推送已开启，等待已选择项目的事实";
				await ConfigureWecomCollectorAsync();
			}
		}
		catch
		{
			if (revision == wecomRevision)
			{
				wecomStatus = "推送配置或密钥无法读取，请检查本机权限并重新配置；游戏不受影响";
			}
		}
	}

	private async Task ConfigureWecomCollectorAsync()
	{
		WecomPushService service = wecomService;
		if (service == null || !ready || gameProcessFailed)
		{
			return;
		}
		if (!service.RequiresGameObservation)
		{
			wecomCollectorGeneration = service.Generation;
			return;
		}
		long page = pageGeneration;
		WebView2 view = GameView;
		CoreWebView2 core = GameView.CoreWebView2;
		string marker = WecomControllerMarker;
		if (wecomCollectorGeneration == service.Generation && wecomConfiguredPage == page && wecomConfiguredCore == core && wecomConfiguredController == marker)
		{
			return;
		}
		try
		{
			string text = await GameScriptAsync("(()=>{const p=globalThis.__PB_PILOT;if(typeof p?.configureWecomPush!=='function')return false;p.configureWecomPush(" + service.CollectorConfiguration().ToJsonString() + ");return true})()");
			if (service != wecomService || !WecomPageCurrent(page, view, core) || !(marker == WecomControllerMarker) || !(text == "true"))
			{
				await ClearWecomCollectorAsync(service.Generation, page, view, core);
				return;
			}
			wecomCollectorGeneration = service.Generation;
			wecomConfiguredPage = page;
			wecomConfiguredController = marker;
			wecomConfiguredCore = core;
		}
		catch
		{
			wecomStatus = "游戏通知接入暂不可用；本地测试和历史仍可用";
		}
	}

	private async Task PollWecomAsync()
	{
		if (wecomService == null)
		{
			return;
		}
		ObserveWecomClientFacts();
		WecomPushService service = wecomService;
		if (!service.RequiresGameObservation)
		{
			return;
		}
		long page = pageGeneration;
		WebView2 view = GameView;
		CoreWebView2 core = GameView.CoreWebView2;
		string marker = WecomControllerMarker;
		if (wecomCollectorGeneration.Length <= 0 || (wecomConfiguredPage == page && wecomConfiguredCore == core && !(wecomConfiguredController != marker)))
		{
			try
			{
				await ConfigureWecomCollectorAsync();
				if (service == wecomService && !(wecomCollectorGeneration != service.Generation))
				{
					string text = await GameScriptAsync("globalThis.__PB_PILOT?.drainWecomPush?.()??null");
					if (service == wecomService && WecomPageCurrent(page, view, core) && marker == WecomControllerMarker && text.Length <= 2000000 && JsonNode.Parse(text) is JsonObject jsonObject)
					{
						service.AcceptBatch(jsonObject);
						string text2 = WecomSettings.Text(jsonObject["identityScope"]);
						if (wecomIdentityScope != text2)
						{
							wecomObservedRunning = false;
						}
						wecomIdentityScope = text2;
						if (wecomIdentityScope.Length > 0 && WecomSettings.Text(game?["wecomIdentityScope"]) == wecomIdentityScope && WecomSettings.Text(game?["wecomGeneration"]) == service.Generation && game?["rewardsProfile"] is JsonObject profile)
						{
							ObserveWecomSavedProfile(profile);
						}
					}
				}
				return;
			}
			catch
			{
				wecomStatus = "当前通知批次未确认，等待下次正常观察；不影响游戏操作";
				return;
			}
		}
		await RefreshWecomRuntimeAsync(force: true);
	}

	private void SubmitWecomHostFacts(JsonArray facts)
	{
		WecomPushService wecomPushService = wecomService;
		if (wecomPushService != null && wecomIdentityScope.Length != 0 && facts.Count != 0)
		{
			wecomPushService.AcceptBatch(new JsonObject
			{
				["generation"] = wecomPushService.Generation,
				["identityScope"] = wecomIdentityScope,
				["facts"] = facts
			});
		}
	}

	private JsonObject WecomHostFact(string itemId, JsonObject data, string? objectId = null, string novelty = "unknown", string phase = "saved")
	{
		JsonObject jsonObject = new JsonObject();
		long num = ++wecomHostSequence;
		jsonObject["eventId"] = "host-" + num;
		jsonObject["itemId"] = itemId;
		jsonObject["identityScope"] = wecomIdentityScope;
		jsonObject["phase"] = phase;
		jsonObject["observedAt"] = DateTimeOffset.UtcNow.ToString("O");
		jsonObject["objectId"] = objectId;
		jsonObject["novelty"] = novelty;
		jsonObject["data"] = data;
		return jsonObject;
	}

	private JsonObject WecomNamedData(JsonObject item, string field, string id, JsonObject data)
	{
		data["id"] = id;
		if (((item["fields"] as JsonArray) ?? new JsonArray()).Any((JsonNode x) => WecomSettings.Text(x) == "name"))
		{
			bool flag;
			switch (field)
			{
			case "seen":
			case "league":
			case "shinies":
			case "classics":
			case "forms":
				flag = true;
				break;
			default:
				flag = false;
				break;
			}
			if (flag && int.TryParse(id, out var result))
			{
				data["name"] = CharacterName(result);
			}
			else if (field == "biomes")
			{
				data["name"] = MapName(id);
			}
			else
			{
				data["name"] = Str(((catalog["encyclopedia"]?["entries"] as JsonArray) ?? new JsonArray()).OfType<JsonObject>().FirstOrDefault((JsonObject x) => Str(x["id"]) == id || Str(x["id"]) == "lab:" + id)?["name"]) ?? id;
			}
		}
		return data;
	}

	private void ObserveWecomSavedProfile(JsonObject profile)
	{
		if (wecomService == null || wecomIdentityScope.Length == 0)
		{
			return;
		}
		if (Flag(game?["enabled"]))
		{
			wecomObservedRunning = true;
		}
		if (!WecomSettings.Yes(config["wecomPush"]?["observeManual"]) && !Flag(game?["enabled"]) && (!wecomObservedRunning || !(Str(game?["state"]) == "over")))
		{
			wecomObservedRunning = false;
			wecomSavedScope = "";
			wecomSavedSets.Clear();
			wecomSavedLevels.Clear();
			wecomSavedNumbers.Clear();
			return;
		}
		if (wecomSavedScope != wecomIdentityScope)
		{
			wecomSavedSets.Clear();
			wecomSavedLevels.Clear();
			wecomSavedNumbers.Clear();
			wecomSavedScope = wecomIdentityScope;
		}
		JsonArray jsonArray = new JsonArray();
		foreach (KeyValuePair<string, JsonObject> item in WecomSettings.Selected(WecomSettings.Normalize(config["wecomPush"])))
		{
			JsonObject jsonObject = WecomSettings.Items[item.Key];
			JsonObject jsonObject2 = jsonObject["source"] as JsonObject;
			string text = WecomSettings.Text(jsonObject2?["adapter"]);
			string text2 = WecomSettings.Text(jsonObject2?["field"]);
			if (text == "host-saved-set" && new string[8] { "seen", "league", "shinies", "classics", "forms", "cosmetics", "quests", "itemsOwned" }.Contains(text2))
			{
				double value5;
				IEnumerable<string> enumerable = ((profile[text2] is JsonArray source) ? (from x in source.OfType<JsonValue>().Take(20000)
					select (x.GetValueKind() != JsonValueKind.String) ? x.ToJsonString() : WecomSettings.Text(x)) : ((text2 == "quests" && profile[text2] is JsonObject source2) ? (from x in source2
					where WecomSettings.Yes(x.Value) || (WecomSettings.Real(x.Value, out value5) && value5 > 0.0)
					select x.Key) : null));
				if (enumerable == null)
				{
					continue;
				}
				HashSet<string> knownIds = (jsonObject2?["knownIds"] as JsonArray)?.Select((JsonNode x) => (!(x is JsonValue jsonValue) || jsonValue.GetValueKind() != JsonValueKind.Number) ? WecomSettings.Text(x) : x.ToJsonString()).ToHashSet();
				HashSet<string> hashSet = enumerable.Where((string x) => Regex.IsMatch(x, "^[A-Za-z0-9_.:+-]{1,100}$") && (knownIds == null || knownIds.Contains(x))).ToHashSet<string>(StringComparer.Ordinal);
				if (wecomSavedSets.TryGetValue(item.Key, out HashSet<string> value))
				{
					foreach (string item2 in hashSet.Except(value))
					{
						jsonArray.Add(WecomHostFact(item.Key, WecomNamedData(item.Value, text2, item2, new JsonObject
						{
							["before"] = 0,
							["after"] = 1,
							["delta"] = 1,
							["count"] = hashSet.Count,
							["novelty"] = "new"
						}), item2, "new"));
					}
				}
				wecomSavedSets[item.Key] = hashSet;
				continue;
			}
			bool flag = text == "host-saved-level";
			if (flag)
			{
				bool flag2 = ((text2 == "biomes" || text2 == "lab") ? true : false);
				flag = flag2;
			}
			if (flag)
			{
				JsonNode jsonNode = profile[text2];
				JsonObject levels = jsonNode as JsonObject;
				if (levels != null)
				{
					if (!(jsonObject2?["knownIds"] is JsonArray source3))
					{
						continue;
					}
					double value5;
					Dictionary<string, double> dictionary = (from key in (from x in source3
							select WecomSettings.Text(x) into x
							where x.Length > 0
							select x).Distinct().Take(1000)
						where WecomSettings.Real(levels[key], out value5) && value5 >= 0.0
						select key).ToDictionary<string, string, double>((string key) => key, delegate(string key)
					{
						WecomSettings.Real(levels[key], out value5);
						return value5;
					}, StringComparer.Ordinal);
					if (wecomSavedLevels.TryGetValue(item.Key, out Dictionary<string, double> value2))
					{
						foreach (KeyValuePair<string, double> item3 in dictionary)
						{
							double valueOrDefault = value2.GetValueOrDefault(item3.Key, (text2 == "biomes") ? (-1) : 0);
							if (!(item3.Value <= valueOrDefault))
							{
								jsonArray.Add(WecomHostFact(item.Key, WecomNamedData(item.Value, text2, item3.Key, new JsonObject
								{
									["before"] = valueOrDefault,
									["after"] = item3.Value,
									["delta"] = item3.Value - valueOrDefault,
									["count"] = item3.Value,
									["novelty"] = ((valueOrDefault > 0.0) ? "repeat" : "new")
								}), item3.Key, (valueOrDefault > 0.0) ? "repeat" : "new"));
							}
						}
					}
					wecomSavedLevels[item.Key] = dictionary;
					continue;
				}
			}
			flag = text == "host-saved-currency";
			if (flag)
			{
				bool flag2;
				switch (text2)
				{
				case "bonk":
				case "totalBonk":
				case "stardust":
				case "totalStardust":
					flag2 = true;
					break;
				default:
					flag2 = false;
					break;
				}
				flag = flag2;
			}
			if (!flag || !WecomSettings.Real(profile[text2], out var value3) || !(value3 >= 0.0))
			{
				continue;
			}
			if (wecomSavedNumbers.TryGetValue(item.Key, out var value4) && value3 != value4)
			{
				JsonObject jsonObject3 = new JsonObject
				{
					["id"] = text2,
					["before"] = value4,
					["after"] = value3,
					["delta"] = value3 - value4,
					["count"] = value3
				};
				if (((item.Value["fields"] as JsonArray) ?? new JsonArray()).Any((JsonNode x) => WecomSettings.Text(x) == "name"))
				{
					jsonObject3["name"] = WecomSettings.Text(jsonObject["label"], text2);
				}
				jsonArray.Add(WecomHostFact(item.Key, jsonObject3, text2));
			}
			wecomSavedNumbers[item.Key] = value3;
		}
		SubmitWecomHostFacts(jsonArray);
	}

	private void ObserveWecomHostEvent(string eventName, JsonObject data)
	{
		if (wecomService == null || wecomIdentityScope.Length == 0)
		{
			return;
		}
		JsonArray jsonArray = new JsonArray();
		foreach (KeyValuePair<string, JsonObject> item in WecomSettings.Selected(WecomSettings.Normalize(config["wecomPush"])))
		{
			JsonObject jsonObject = WecomSettings.Items[item.Key]["source"] as JsonObject;
			if (WecomSettings.Text(jsonObject?["adapter"]) == "host-event" && WecomSettings.Text(jsonObject?["event"]) == eventName)
			{
				jsonArray.Add(WecomHostFact(item.Key, data.DeepClone().AsObject(), null, "unknown", "observed"));
			}
		}
		SubmitWecomHostFacts(jsonArray);
	}

	private void ObserveWecomClientFacts()
	{
		if (wecomService == null)
		{
			return;
		}
		if (gameProcessFailed && !wecomFailureScope)
		{
			wecomFailureScope = true;
			wecomIdentityScope = "client-failure-" + wecomService.Generation;
			wecomService.AcceptBatch(new JsonObject
			{
				["generation"] = wecomService.Generation,
				["identityScope"] = wecomIdentityScope,
				["facts"] = new JsonArray()
			});
			wecomSavedScope = "";
			wecomSavedSets.Clear();
			wecomSavedLevels.Clear();
			wecomSavedNumbers.Clear();
		}
		if (!gameProcessFailed)
		{
			wecomFailureScope = false;
		}
		if (wecomIdentityScope.Length == 0)
		{
			wecomIdentityScope = "client-" + wecomService.Generation;
			wecomService.AcceptBatch(new JsonObject
			{
				["generation"] = wecomService.Generation,
				["identityScope"] = wecomIdentityScope,
				["facts"] = new JsonArray()
			});
		}
		bool flag = ready && !gameProcessFailed && GameView.CoreWebView2 != null;
		string text = ((!flag) ? "disconnected" : (Flag(game?["enabled"]) ? "running" : ((game?["state"] != null) ? "stopped" : "ready")));
		if (text != wecomClientState)
		{
			wecomClientState = text;
			ObserveWecomHostEvent("clientStatus", new JsonObject
			{
				["state"] = text,
				["enabled"] = Flag(game?["enabled"]),
				["connection"] = flag
			});
		}
		IReadOnlyDictionary<string, JsonObject> source = WecomSettings.Selected(WecomSettings.Normalize(config["wecomPush"]));
		if ((!Flag(game?["enabled"]) && !WecomSettings.Yes(config["wecomPush"]?["observeManual"])) || !source.Any((KeyValuePair<string, JsonObject> x) => WecomSettings.Text(WecomSettings.Items[x.Key]["source"]?["event"]) == "performance"))
		{
			return;
		}
		HashSet<string> hashSet = source.Where((KeyValuePair<string, JsonObject> x) => WecomSettings.Text(WecomSettings.Items[x.Key]["source"]?["event"]) == "performance").SelectMany((KeyValuePair<string, JsonObject> x) => ((x.Value["fields"] as JsonArray) ?? new JsonArray()).Select((JsonNode v) => WecomSettings.Text(v))).ToHashSet();
		JsonObject jsonObject = new JsonObject();
		if (hashSet.Contains("hostWorkingSetBytes"))
		{
			jsonObject["hostWorkingSetBytes"] = Environment.WorkingSet;
		}
		if (hashSet.Contains("fps") && WecomSettings.Real(game?["gameFps"], out var value))
		{
			jsonObject["fps"] = value;
		}
		if (hashSet.Contains("decisionMs") && WecomSettings.Real(game?["p95DecisionMs"], out var value2))
		{
			jsonObject["decisionMs"] = value2;
		}
		ObserveWecomHostEvent("performance", jsonObject);
	}

	private async Task<JsonObject> WecomStatusAsync()
	{
		try
		{
			wecomTargets = await WecomStore.TargetsAsync();
		}
		catch
		{
			wecomTargets = new JsonArray();
			wecomStatus = "本地接收目标读取失败，请检查客户端目录权限";
		}
		JsonObject jsonObject = wecomService?.Status() ?? wecomLastRuntime?.DeepClone().AsObject() ?? new JsonObject
		{
			["active"] = false,
			["queue"] = 0,
			["textOnly"] = true,
			["queuePersistence"] = false
		};
		if (wecomService == null)
		{
			jsonObject["lastStatus"] = wecomStatus;
		}
		return new JsonObject
		{
			["catalog"] = WecomSettings.Registry.DeepClone(),
			["config"] = WecomSettings.Normalize(config["wecomPush"]),
			["targets"] = wecomTargets.DeepClone(),
			["runtime"] = jsonObject
		};
	}

	private async Task<JsonNode?> WecomActionAsync(string action, JsonObject payload)
	{
		switch (action)
		{
		case "wecomStatus":
			return await WecomStatusAsync();
		case "wecomSaveTarget":
		{
			string id = await WecomStore.SaveTargetAsync(Str(payload["id"]), Str(payload["name"]) ?? "", Str(payload["webhook"]) ?? "");
			payload.Remove("webhook");
			await RefreshWecomRuntimeAsync(force: true);
			JsonObject obj2 = await WecomStatusAsync();
			obj2["savedTargetId"] = id;
			return obj2;
		}
		case "wecomDeleteTarget":
			await WecomStore.DeleteTargetAsync(Str(payload["id"]) ?? "");
			await RefreshWecomRuntimeAsync(force: true);
			return await WecomStatusAsync();
		case "wecomTest":
		{
			CancellationToken token = wecomActionCancellation.Token;
			WecomTarget obj = await WecomStore.ResolveAsync(Str(payload["id"]) ?? "");
			if (obj == null)
			{
				throw new InvalidOperationException("请先保存接收目标");
			}
			JsonObject jsonObject = WecomSettings.Normalize(config["wecomPush"]);
			return await WecomPushService.TestAsync(obj, jsonObject, WecomStore, WecomTransportFactory?.Invoke(jsonObject["network"].AsObject()), WecomTestClock, null, token);
		}
		case "wecomHistory":
			return await WecomStore.HistoryAsync(WecomSettings.Number(payload["offset"], 0, 0, 100000), WecomSettings.Number(payload["limit"], 50, 1, 100), Str(payload["filters"]?["state"]));
		case "wecomClearHistory":
			await WecomStore.ClearHistoryAsync();
			return new JsonObject
			{
				["ok"] = true,
				["message"] = "已清理本机推送历史；待发和去重未清除，不会删除群消息"
			};
		case "wecomClearQueue":
			wecomService?.ClearQueue();
			return await WecomStatusAsync();
		case "wecomExportHistory":
		{
			JsonObject jsonObject2 = new JsonObject();
			JsonObject jsonObject3 = jsonObject2;
			jsonObject3["path"] = await WecomStore.ExportHistoryAsync(Str(payload["filters"]?["state"]));
			jsonObject2["limit"] = 10000;
			jsonObject2["message"] = "已导出当前筛选最多最近10000条本机记录，不包含推送密钥";
			return jsonObject2;
		}
		case "wecomOpenDirectory":
			portable.EnsureDirectory(WecomStore.DirectoryPath);
			Process.Start(new ProcessStartInfo(WecomStore.DirectoryPath)
			{
				UseShellExecute = true
			});
			return new JsonObject { ["ok"] = true };
		case "wecomOpenHelp":
		{
			string text = Str(payload["url"]) ?? "";
			if (!new string[6] { "https://open.work.weixin.qq.com/help2/pc/15422?person_id=1", "https://open.work.weixin.qq.com/help2/pc/14931?person_id=1", "https://work.weixin.qq.com/", "https://developer.work.weixin.qq.com/document/path/91770", "https://open.work.weixin.qq.com/help2/pc/14905?person_id=1", "https://open.work.weixin.qq.com/help2/pc/21059?person_id=1" }.Contains(text))
			{
				throw new InvalidOperationException("教程链接不在官方白名单中");
			}
			Process.Start(new ProcessStartInfo(text)
			{
				UseShellExecute = true
			});
			return new JsonObject { ["ok"] = true };
		}
		default:
			throw new InvalidOperationException("不支持的企微推送操作");
		}
	}

	[DebuggerNonUserCode]
	[GeneratedCode("PresentationBuildTasks", "10.0.9.0")]
	public void InitializeComponent()
	{
		if (!_contentLoaded)
		{
			_contentLoaded = true;
			Uri resourceLocator = new Uri("/PokeBonk Pilot;component/mainwindow.xaml", UriKind.Relative);
			Application.LoadComponent(this, resourceLocator);
		}
	}

	[DebuggerNonUserCode]
	[GeneratedCode("PresentationBuildTasks", "10.0.9.0")]
	[EditorBrowsable(EditorBrowsableState.Never)]
	void IComponentConnector.Connect(int connectionId, object target)
	{
		switch (connectionId)
		{
		case 1:
			MainLayout = (Grid)target;
			MainLayout.SizeChanged += OnMainLayoutSizeChanged;
			break;
		case 2:
			GameRow = (RowDefinition)target;
			break;
		case 3:
			SplitterRow = (RowDefinition)target;
			break;
		case 4:
			ControlRow = (RowDefinition)target;
			break;
		case 5:
			GameHost = (Border)target;
			GameHost.SizeChanged += OnGameHostSizeChanged;
			break;
		case 6:
			GameView = (WebView2)target;
			break;
		case 7:
			PanelSplitter = (GridSplitter)target;
			break;
		case 8:
			PanelView = (WebView2)target;
			break;
		default:
			_contentLoaded = true;
			break;
		}
	}
}
