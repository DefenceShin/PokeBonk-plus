/* PokéBonk 旅伴: local, dependency-free control surface. */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const SVG_NS = 'http://www.w3.org/2000/svg';
  // Author/free/source display. See AUTHORSHIP.md and AI-MAINTENANCE.md before
  // changing attribution; these notices do not override real authorization.
  const productSource = window.PokeBonkSource;
  const sourceNotice = $('product-source-notice');
  if (sourceNotice && productSource) {
    const title = document.createElement('strong'); title.textContent = productSource.freeNotice; sourceNotice.append(title);
    for (const text of ['作者及维护方：' + productSource.author, productSource.paidNotice,
        productSource.updateNotice, '百度网盘：' + productSource.baiduUrl,
        'B站视频教程：' + productSource.videoUrl, '夸克网盘：' + productSource.quarkUrl,
        productSource.maintenanceNotice, productSource.instanceNotice, productSource.rightsNotice]) {
      const line=document.createElement('p'); line.textContent=text; sourceNotice.append(line);
    }
    const button=document.createElement('button');button.type='button';button.className='button secondary small';
    button.textContent='查看官方来源与更新';button.addEventListener('click',()=>command('showClientUpdates').catch(error=>showToast(error.message,true)));sourceNotice.append(button);
  }
  const icons = {
    overview: [['rect', { x: 3, y: 3, width: 7, height: 7, rx: 1.5 }], ['rect', { x: 14, y: 3, width: 7, height: 7, rx: 1.5 }], ['rect', { x: 3, y: 14, width: 7, height: 7, rx: 1.5 }], ['rect', { x: 14, y: 14, width: 7, height: 7, rx: 1.5 }]],
    compass: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'm16 8-2.5 5.5L8 16l2.5-5.5Z' }]],
    character: [['path', { d: 'M7 5 4 2 3 9a9 9 0 0 0 18 0l-1-7-3 3M8 12h.01M16 12h.01M10 16q2 2 4 0' }]],
    skin: [['path', { d: 'm8 3 4 3 4-3 6 4-4 5-2-1v10H8V11l-2 1-4-5Z' }]],
    log: [['rect', { x: 5, y: 3, width: 14, height: 18, rx: 2 }], ['path', { d: 'M9 8h6M9 12h6M9 16h4' }]],
    settings: [['path', { d: 'M4 7h16M4 17h16' }], ['circle', { cx: 8, cy: 7, r: 3 }], ['circle', { cx: 16, cy: 17, r: 3 }]],
    expand: [['path', { d: 'm6 14 6-6 6 6M6 20h12' }]],
    collapse: [['path', { d: 'm6 10 6 6 6-6M6 4h12' }]],
    leaf: [['path', { d: 'M20 3c1 10-3 17-10 17-4 0-7-3-6-7C6 6 13 6 20 3ZM4 21l11-11' }]],
    play: [['path', { d: 'm8 5 11 7-11 7Z', fill: 'currentColor', 'stroke-width': 0 }]],
    pause: [['path', { d: 'M8 5v14M16 5v14', 'stroke-width': 3 }]],
    search: [['circle', { cx: 10.5, cy: 10.5, r: 6.5 }], ['path', { d: 'm16 16 5 5' }]],
    lock: [['rect', { x: 5, y: 10, width: 14, height: 11, rx: 2 }], ['path', { d: 'M8 10V7a4 4 0 0 1 8 0v3M12 14v3' }]],
    download: [['path', { d: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5' }]],
    folder: [['path', { d: 'M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v10H3Z' }]],
    trash: [['path', { d: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 10v7M14 10v7' }]],
    sliders: [['path', { d: 'M4 6h16M4 12h16M4 18h16' }], ['circle', { cx: 9, cy: 6, r: 2, fill: 'white' }], ['circle', { cx: 15, cy: 12, r: 2, fill: 'white' }], ['circle', { cx: 8, cy: 18, r: 2, fill: 'white' }]],
    refresh: [['path', { d: 'M20 8a8 8 0 1 0 1 7M20 3v5h-5' }]],
    copy: [['rect', { x: 8, y: 8, width: 12, height: 13, rx: 2 }], ['path', { d: 'M15 8V3H3v13h5' }]],
    book: [['path', { d: 'M12 5C9 3 5 3 2 4v16c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1ZM12 5v16' }]],
    login: [['path', { d: 'M14 4h6v16h-6M3 12h12m-5-5 5 5-5 5' }]],
    map: [['path', { d: 'm3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2ZM9 3v16M15 5v16' }]],
    resources: [['path', { d: 'm12 2 8 7-8 13L4 9ZM4 9h16M8 9l4 13 4-13M8 9l4-7 4 7' }]],
    dex: [['rect', { x: 4, y: 3, width: 16, height: 18, rx: 3 }], ['circle', { cx: 9, cy: 8, r: 1.5 }], ['path', { d: 'M8 14h8M8 17h5' }]],
    quests: [['rect', { x: 5, y: 4, width: 15, height: 17, rx: 2 }], ['path', { d: 'M9 4V2h6v2M9 12l2 2 5-5M9 18h6' }]],
    leaderboard: [['path', { d: 'M8 3h8v5a4 4 0 0 1-8 0ZM8 5H4v3a4 4 0 0 0 4 4M16 5h4v3a4 4 0 0 1-4 4M12 12v6M8 21h8M9 18h6v3' }]],
    endless: [['path', { d: 'M12 12c-3-8-10-5-10 0s7 8 10 0 10-5 10 0-7 8-10 0' }]],
    shiny: [['path', { d: 'm12 2 2.7 6.8L21 12l-6.3 3.2L12 22l-2.7-6.8L3 12l6.3-3.2ZM20 2v4m-2-2h4M3 18v4m-2-2h4' }]],
    auto: [['path', { d: 'm13 2-2 7H4l6 5-2 8 6-7 6-1-6-4Z' }]],
    gear: [['circle', { cx: 12, cy: 12, r: 3 }], ['path', { d: 'M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1' }]],
    user: [['circle', { cx: 12, cy: 8, r: 4 }], ['path', { d: 'M4 21a8 8 0 0 1 16 0' }]],
    layers: [['path', { d: 'm12 3 9 5-9 5-9-5ZM3 13l9 5 9-5' }]],
    wand: [['path', { d: 'm4 20 11-11M14 4v3M19 9h-3M17.5 5.5l-2 2M8 4l.8 1.7L10.5 6.5 8.8 7.3 8 9l-.8-1.7L5.5 6.5l1.7-.8Z' }]],
    plug: [['path', { d: 'M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0ZM12 17v4' }]],
    gauge: [['path', { d: 'M4 17a8 8 0 1 1 16 0M12 17l4-6' }], ['circle', { cx: 12, cy: 17, r: 1.5 }]],
    box: [['path', { d: 'm12 3 8 4v10l-8 4-8-4V7ZM4 7l8 4 8-4M12 11v10' }]],
  };

  function icon(name) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    for (const [tag, attributes] of icons[name] || icons.compass) {
      const shape = document.createElementNS(SVG_NS, tag);
      for (const [key, value] of Object.entries(attributes)) shape.setAttribute(key, String(value));
      svg.append(shape);
    }
    return svg;
  }
  function mountIcon(node, name) {
    if (!node || node.dataset.mountedIcon === name && node.firstElementChild) return;
    node.replaceChildren(icon(name)); node.dataset.mountedIcon = name;
  }
  document.querySelectorAll('[data-icon]').forEach((node) => mountIcon(node, node.dataset.icon));
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function setText(id, text) { const node = $(id); const value = String(text ?? '—'); if (node.textContent !== value) node.textContent = value; }
  function first(...values) { return values.find((value) => value !== undefined && value !== null); }
  function numeric(value) { return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null; }
  function nameOf(value, fallback = '') {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'object') return nameOf(first(value.zh, value['zh-CN'], value.name, value.label, value.title, value.en, value.id), fallback);
    return String(value);
  }
  function dateOf(value) {
    if (value === null || value === undefined || value === '') return null;
    const raw = typeof value === 'number' && value < 1e12 ? value * 1000 : value;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  function numberText(value, prefix = '') {
    const number = numeric(value);
    return number === null ? '—' : prefix + number.toLocaleString('zh-CN', { maximumFractionDigits: 1 });
  }
  function positiveText(value) { const num = numeric(value); return num === null ? '—' : (num > 0 ? '+' : '') + num.toLocaleString('zh-CN'); }
  function durationText(value) {
    const total = Math.max(0, Math.floor(Number(value) || 0));
    return [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60].map((part) => String(part).padStart(2, '0')).join(':');
  }
  function timeText(value, full = false) {
    const date = dateOf(value);
    if (!date) return '时间未记录';
    const clock = date.toLocaleTimeString('zh-CN', { hour12: false });
    return full ? `${date.getMonth() + 1}/${date.getDate()} ${clock}` : clock;
  }

  const DEFAULT_CONFIG = { mode: 'auto', characterId: null, biome: 'auto', tier: 0, build: 'auto', autoUpgrade: false, autoUnlockItems: false, pickup: true, autoClaim: false, safeMode: false, bossPriority: false, portalPriority: false, shinyPriority: true, capturePriority: true, jumpMove: false, slideMove: false, bossRetreat: false, riskyInteractions: true, pickupBonkoin: true, flightMove: false, flightJumpItemCount: 5, flightNoInteractions: false, flightKeepInteractions: true, logRetentionRuns: 100, expandVitaminSlots: true, shinyStayAfterFinalClear: false, shinyStageWait: false, shinyStageWaitSeconds: 600, hotkeyToggle: 'F8', hotkeyStop: 'F9', hotkeyReleaseMouse: 'F10', autoRestart: true, reserveMoveSlot: false, fps: 60, shinyMode: 'missing', shinyTypes: ['shiny','classic'], shinyTargetId: null, shinyStopWhenDone: true, shinyUseStone: false, randomDelay: true, randomDelayMinMs: 600, randomDelayMaxMs: 1800, finalReplacements: {} };
  const OVERLAY_FIELDS = [
    ['totalDamage', '原生累计伤害'], ['moveDamage', '各招式伤害', '逐槽位显示当前招式，另列历史遗忘招式；名字最多两行。'],
    ['otherDamage', '其他伤害来源', '显示绝招、历史遗忘与当前支援等原生分项；其余残差需开启招式项。'], ['revives', '剩余复活', '普通复活与全满复活分别显示。'],
  ];
  const OVERLAY_EXTRA_FIELDS = [
    ['averageDps', '整局平均伤害 / 秒', '总伤害除以游戏时间，不是近期 DPS。'],
    ['damageShare', '招式伤害占比', '与伤害分项一起显示，按总伤害计算。'],
    ['elapsed', '游戏时间'], ['kills', '击败数量'],
    ['damageTaken', '累计承受伤害', '原生累计伤害，不是净生命损失。'],
    ['health', '当前生命'], ['shield', '当前护盾'], ['experience', '等级与经验'], ['gold', '持有金币'],
    ['ultimate', '绝招蓄能与施放状态', '显示蓄能或施放状态，不是固定冷却时间。'],
    ['armor', '护甲属性'], ['critChance', '暴击 / 超级暴击属性', '显示角色属性，不是实测暴击率。'],
    ['critDamage', '暴击伤害倍率'], ['physical', '物理伤害倍率'], ['special', '特殊伤害倍率'],
    ['damageMultiplier', '伤害属性倍率'], ['attackSpeed', '攻速属性', '不是实际攻击频次。'],
    ['moveSpeed', '移速属性', '不是米 / 秒。'], ['luck', '幸运属性', '不是实际掉落概率。'],
    ['xpGain', '经验属性倍率', '实际经验还受难度修正。'],
    ['healingMultiplier', '治疗倍率', '显示属性，游戏未提供本局累计治疗量。'],
    ['regen', '基础每秒回复属性', '实际回复还受治疗倍率与伤势修正。'],
    ['itemTriggers', '道具触发归因', '与招式可能重叠，且可能是限伤前的值，不能加总。'],
    ['rebirth', '虹翼本层重生可用', '独立显示，不计入有限消耗品的剩余复活。'],
  ];
  const OVERLAY_TEAM_FIELDS = [
    ['identity', '队友名称与角色', '显示当前房间中的队友名称及所用角色。'],
    ['totalDamage', '累计输出', '队友共享的本局原生累计伤害；未共享或资料过期时不显示估算值。'],
    ['averageDps', '整局平均伤害 / 秒', '累计伤害除以该队友的游戏时间。'],
    ['recentDps', '近期伤害 / 秒', '按下方时间窗比较收到的累计伤害；样本不足时显示未知。'],
    ['damageShare', '队伍输出占比', '按当前可用的已共享成员伤害计算；成员数据不全时明确标记范围。'],
    ['moveDamage', '各招式名称与输出', '显示队友共享的当前招式伤害，并区分历史遗忘招式。'],
    ['otherDamage', '其他来源输出', '显示队友共享的绝招、支援等原生分项，不把重叠归因重复加总。'],
    ['kills', '击败数量'], ['health', '生命值与上限'], ['shield', '当前护盾', '需要该队友开启统计共享。'],
    ['level', '角色等级'], ['revives', '剩余复活', '显示共享的有限消耗品复活次数；救援进度另列。'],
    ['status', '战斗与倒地状态', '显示原生可读的倒地、离场和传送就绪等状态。'],
    ['damageTaken', '累计承受伤害', '需要共享；原生累计承伤，不是净生命损失。'],
    ['items', '持有道具与数量', '需要共享；只显示本局实际持有的道具。'],
    ['vitamins', '维生素与等级', '需要共享；只显示本局已持有的维生素。'],
    ['ultimate', '绝招蓄能与状态', '需要共享；不是固定冷却时间。'],
    ['rescue', '倒地倒计时与救援进度', '原生同步的倒地剩余时间及被救援进度。'],
    ['area', '当前区域'], ['distance', '与自己的距离', '按同区域原生位置计算，不把不同区域的坐标相减。'],
    ['connection', '连接与资料状态', '显示连接、共享及资料新鲜度；原生测得往返延迟时一并显示，未测量则为未知。'],
  ];
  const DEFAULT_OVERLAY_TEAM = { enabled: false, shareStats: false, includeSelf: false, sameAreaOnly: false,
    sort: 'damage', recentSeconds: 10, staleSeconds: 8,
    fields: Object.fromEntries(OVERLAY_TEAM_FIELDS.map(([key]) => [key, false])) };
  const OVERLAY_TEAM_NUMBERS = {
    recentSeconds: { label: '近期 DPS 时间窗', min: 3, max: 30, step: 1, unit: '秒' },
    staleSeconds: { label: '共享资料有效时间', min: 3, max: 30, step: 1, unit: '秒' },
  };
  const OVERLAY_NUMBERS = {
    fontSize: { label: '字体大小', min: 10, max: 26, step: 1, unit: 'px', group: 'appearance' },
    opacity: { label: '背景不透明度', min: 0, max: 95, step: 5, unit: '%', group: 'appearance' },
    rowGap: { label: '行间距', min: 0, max: 12, step: 1, unit: 'px', group: 'appearance' },
    refreshMs: { label: '信息刷新间隔', min: 250, max: 2000, step: 250, unit: 'ms', group: 'appearance' },
    pageSeconds: { label: '自动翻页间隔', min: 3, max: 20, step: 1, unit: '秒', group: 'appearance' },
    page: { label: '手动查看页码', min: 1, max: 9999, step: 1, unit: '页', group: 'appearance' },
    width: { label: '悬浮窗宽度', min: 160, max: 560, step: 10, unit: 'px', group: 'layout' },
    height: { label: '悬浮窗高度', min: 120, max: 800, step: 10, unit: 'px', group: 'layout' },
    x: { label: '水平位置 X', min: 0, max: 100, step: 1, unit: '%', group: 'layout' },
    y: { label: '垂直位置 Y', min: 0, max: 100, step: 1, unit: '%', group: 'layout' },
  };
  const DEFAULT_OVERLAY = { enabled: true, fields: { ...Object.fromEntries(OVERLAY_EXTRA_FIELDS.map(([key]) => [key, false])), totalDamage: true, moveDamage: true, otherDamage: true, revives: true },
    compactNumbers: true, fontSize: 12, fontColor: '#ffffff', backgroundColor: '#10251e', opacity: 45,
    width: 220, height: 260, x: 1.5, y: 46, rowGap: 4, refreshMs: 500, hidePaused: true, autoPage: true, pageSeconds: 6, page: 1,
    team: DEFAULT_OVERLAY_TEAM };
  DEFAULT_CONFIG.overlay = DEFAULT_OVERLAY;
  DEFAULT_CONFIG.autoManageBuildPriority = false;
  DEFAULT_CONFIG.shopPriority = false;
  DEFAULT_CONFIG.forceCostInteractions = false;
  DEFAULT_CONFIG.costEffectPriorities = Array(10).fill('');
  Object.assign(DEFAULT_CONFIG,{noInteractionsAfter:false,noInteractionsAfterSeconds:600,fullMapOrbit:false,fullMapOrbitAfterSeconds:600});
  const WECOM_DEFAULTS={schemaVersion:1,enabled:false,alias:'',observeManual:false,allowTeamDetails:false,targetId:null,items:{},format:'text',history:{mode:'count',count:100,days:30,maxMiB:50},network:{timeoutSeconds:10,retries:2,proxy:'system'}};
  DEFAULT_CONFIG.wecomPush=structuredClone(WECOM_DEFAULTS);
  const CONVENIENCE_COOP = [['waitPortal','等至少一名同区域队友就绪后再进入传送门'],['doNotChest','不主动开启普通宝箱'],['doNotFreeChest','不主动开启免费宝箱'],['doNotAltar','不主动使用祭坛'],['doNotChallenge','不主动开启挑战'],['doNotCursed','不主动触发诅咒交互'],['doNotCursedChest','不主动开启诅咒宝箱'],['doNotGreed','不主动使用贪婪交互'],['doNotMeowth','不主动进入喵喵商店'],['doNotDitto','不主动使用百变怪复制'],['doNotHypno','不主动使用引梦貘人遗忘'],['doNotSnorlax','不主动使用卡比兽交互'],['doNotMagnet','不主动拾取磁铁'],['doNotBerry','不主动拾取树果'],['doNotBoss','不主动触发区域首领'],['doNotShrine','不主动使用神龛'],['doNotPortal','不主动进入传送门'],['doNotCage','不主动开启笼子'],['doNotRock','不主动击碎岩石'],['doNotShroom','不主动使用蘑菇'],['doNotSlots','不主动使用老虎机'],['doNotBill','不主动使用正辉融合机器'],['doNotFossil','不主动使用化石交互'],['doNotNest','不主动使用巢穴'],['doNotPorygon','不主动使用多边兽交易'],['doNotRhydon','不主动使用钻角犀兽交互'],['doNotTower','不主动使用紫苑塔特殊事件']];
  const CONVENIENCE_EVENTS = [['boss','首领出现'],['rare','稀有捕捉目标出现'],['downed','自己倒地'],['revive','自己复活'],['teammateDown','队友倒地'],['stage','切换区域'],['ultimate','绝招就绪'],['lowHealth','低生命'],['matchEnd','本局结束'],['saveFailure','原生保存失败'],['fusionReady','融合原料就绪']];
  const DEFAULT_CONVENIENCE = {
    rhythm:{enabled:true,randomDelay:true,randomDelayMinMs:600,randomDelayMaxMs:1800,betweenRunWait:true,betweenRunWaitMinSeconds:5,betweenRunWaitMaxSeconds:15,inspectPanel:true,activationSchedule:false,activationStart:'00:00',activationEnd:'00:00',activationDays:[1,2,3,4,5,6,7]},
    fusion:{enabled:false,fontSize:11,rowsPerCard:3,cycleSeconds:5,offsetX:0,gap:8,showLevels:true,showLocks:true,onlyHeldPartners:false},
    quantity:{enabled:false,fontSize:13,showLimit:true,showVitamins:false,compactNumbers:false},
    alerts:{enabled:false,tone:'chime',volume:50,cooldownSeconds:15,lowHealthPercent:25,events:{boss:true,rare:true,downed:true,revive:true,teammateDown:false,stage:false,ultimate:false,lowHealth:false,matchEnd:true,saveFailure:true,fusionReady:false}},
    coop:{enabled:false,...Object.fromEntries(CONVENIENCE_COOP.map(([key])=>[key,false]))},
    recommendations:{enabled:false,source:'recommended',fontSize:13,showReasons:true,showMoves:true,showVitamins:true,showItems:true,showOther:true,opacity:90,color:'#23795c'}
  };
  DEFAULT_CONFIG.convenience = DEFAULT_CONVENIENCE;
  DEFAULT_CONFIG.display = {mode:'fit16x9'};
  const CONVENIENCE_FEATURES = [
    ['rhythm','运行节奏','设置选择延迟、局间等待、短暂查看面板和北京时间启用时段。','只调节可等待的动作。移动、避险和重要交互优先；启用时段外保持当前页面，不暂停或关闭游戏。'],
    ['movement','移动方案','选择跳跃、滑铲、飞行、全图环飞或首领走位偏好。','优先远离首领默认关闭；常规移动保留避险、脱困与交互。飞行达到道具门槛、环飞达到本局时间门槛后，不为敌方身体或攻击范围改道，仍遵守地图墙体与边界。允许交互时落地处理后继续；“不再交互”对生效中的飞行和环飞都有效，“后续不再交互”仅到设定时间生效。原生自动攻击与强制选择照常。'],
    ['outside','局外助手','自动处理实验室、永久道具解锁、奖励和第四招式栏位的准备。','四项默认关闭，分别保存。自动解锁道具独立于自动升级实验室；仅购买当前条件满足且可负担的道具，无可买闪避道具时继续解锁其它道具，不停等。'],
    ['strategy','局中策略','设置拾取、成长、首领、换关和捕捉等行动偏好。','保留各项独立开关和原生资格。优先拾取邦币默认开启，已保存的明确选择继续生效。'],
    ['cost','代价策略','选择永久代价交互的策略与正面效果顺序。','代价必选优先于自动评估，可能偏离当前方案；只影响代价决策，不改变原生资格、实际费用、联机禁项或严格招式等独立限制。两个开关都关闭时，不主动选择可选代价交互；原生无法退出的必选页仍正常处理。'],
    ['wecom','企微推送','把自己勾选的事件与状态发送到指定企业微信内部群。','总开关和所有项目默认关闭；只观察已选项目与字段。接口成功不代表手机弹窗或已读，不改变挂机行为、队友共享或游戏数据。'],
    ['favorite','一键收藏','把当前可确认的最近一局配装保存成自己的方案。','仅点击时读取当前对局；支持战斗、原生选择页、暂停和结算页。保存招式、维生素与道具的实际记录，不会自动切换或抢占现用方案。收藏默认“仅手动选择”，可在自定义方案里命名、修改或开启自动匹配。'],
    ['buildImport','导入方案','把游戏内已经打开的某局配置保存成所选角色的方案。','先在玩家主页找到一局，点击该局“配置”，保持窗口打开后再点一键导入。只按键读取这个窗口，不扫描玩家历史、不保存原玩家身份；默认仅供手动选择，不改变现用方案。'],
    ['fusion','融合提醒','在原生选择卡片旁显示可构成的融合与原料进度。','按配方目录展示所有可能的融合成品并自动轮换；每种成品展示一条所需准备最少的已核对原料路线，另列其他组合数量。目录里的潜在伙伴不代表当前角色一定能学到；本局仍受原生可学范围、等级、原料锁定、槽位与机器次数限制。提示不会赠送招式或执行融合。'],
    ['quantity','数量提醒','在相关原生卡片上补充已持有数量或等级。','按需显示道具数量、原生持有上限和维生素等级，帮助判断是否重复。没有读取到的数据不会当成零，也不改变原生可选资格。'],
    ['alerts','重要事件提醒','按选定事件播放本机提示音。','只监听你开启的事件，支持音色、音量和冷却；同类事件在冷却内不会反复响。声音来自本客户端，不影响原生音效；点击试听只播放一次。'],
    ['coop','联机优化','为原生联机单独选择不主动执行的交互。','总开关及每一项默认关闭，仅联机时生效；单人逻辑不受影响。勾选只约束脚本主动操作，不能阻止队友或原生事件。商店、复制、遗忘、融合等保留各自真实规则，不一概当作消耗队友资源。'],
    ['recommendations','推荐选择','给原生可选卡片显示推荐分数与理由。','评分是当前推荐策略或现用方案结合实时收益的参考，不是必胜保证、实际掉率或概率。只显示提示，由你决定；原生禁用、锁定和费用不被评分覆盖。']
  ];
  let convenienceFeature='rhythm', convenienceBusy=false, convenienceFavoriteName='', convenienceActionMessage='';
  let convenienceImportSpecies=null,convenienceImportName='',convenienceImportNote='',convenienceImportMessage='',convenienceImportBusy=false,
    convenienceImportAutoSelect=false,convenienceImportAllowLegacy=false,convenienceImportSkipDuplicates=true;
  let wecomView={catalog:{items:[]},targets:[],runtime:{}},wecomEpoch=0,wecomConfigRevision=0,wecomMetadataRevision=0,wecomTargetDraftRevision=0,wecomLoading=false,wecomBusy=new Set(),wecomTab='settings',wecomMessageText='',wecomSelectedItem=null,wecomSearch='',wecomCategory='',wecomOnlyEnabled=false,wecomOnlyModified=false,wecomListSignature='',wecomDetailSignature='',wecomTargetSignature='',wecomHistory={entries:[],total:0,offset:0,limit:50},wecomHistoryEpoch=0;
  let wecomConfigCache={raw:null,signature:null,value:null},wecomCatalogCache={raw:null,items:[],byId:new Map()},wecomFieldCache=new WeakMap(),wecomLastRender=null,wecomScopeSignature='',wecomHistoryRendered=null,wecomRuntimeRevision=-1,wecomRuntimeMetadata=-1;
  const FALLBACK_MODES = [
    { id: 'auto', label: '自动推进', description: '按优先级持续推进账号。' },
    { id: 'map', label: '开新地图', description: '优先挑战尚未通关的地图。' },
    { id: 'resources', label: '刷资源', description: '重复对局，积累星尘与研究进度。' },
    { id: 'quests', label: '做委托', description: '围绕未完成的每日、每周任务推进。' },
    { id: 'autoManage', label: '自动托管', description: '只接管当前对局；默认保留现有招式与维生素，仅升级已有项，本局结束后停止。' },
    { id: 'dex', label: '开图鉴', description: '发现尚未收录或指定的精灵。' },
    { id: 'characters', label: '解锁精灵', description: '按真实前置条件，捕获未解锁或指定的联盟成员。' },
    { id: 'shiny', label: '刷异色', description: '补全未拥有异色，或搜寻指定异色。' },
    { id: 'leaderboard-kills', label: '击败数排行', description: '按当前模式的地图与难度，尝试击败数成绩。' },
    { id: 'leaderboard-time', label: '竞速通关', description: '按当前模式的地图与难度，尝试通关时间成绩。' },
    { id: 'endless', label: '无尽生存', description: '在可用的生存模式中持续挑战。' },
    { id: 'mutation', label: '每日变异', category: 'permanent-event', activityKind: 'permanent', description: '挑战当天固定地图、难度与变体，获得当日奖励或重复冲榜。' },
    { id: 'research', label: '家族研究', description: '按已保存的研究进度，研究未完成家族或指定家族。' },
    { id: 'lab', label: '实验室升级', description: '积累并按条件购买未完成或指定的永久升级。' },
    { id: 'items', label: '解锁道具', description: '推进指定道具的原生解锁条件。' },
    { id: 'achievements', label: '刷成就', description: '选择未完成或指定成就；特殊条件会显示执行限制。' },
    { id: 'appearance', label: '解锁外观', description: '按已保存进度推进头像、形态等外观条件。' },
    { id: 'wardrobe', label: '解锁更衣室', description: '逐项解锁原生衣橱外观；自动推进角色、挑战、捕获与奖励前置。' },
    { id: 'allClears', label: '角色全通关', description: '按角色、地图、难度逐格完成标准通关；未拥有角色先自动推进解锁。' },
    { id: 'tower', label: '紫苑塔活动', category: 'limited-event', eventId: 'halloween26', rewardCategory: 'events', eventStatus: 'unknown', description: '选择本活动奖励或自动推进；活动结束后仍保留设置，等待返场。' },
  ];
  const SETTING_FIELDS = [
    ['autoUpgrade', '自动升级实验室', '使用可用星尘购买有帮助的升级。'],
    ['autoUnlockItems', '自动解锁道具', '默认关闭，仅控制局外永久道具购买。先解锁当前满足条件且可负担的加闪避道具；没有可买的闪避道具时，购买其它可解锁道具，逐步完成全部解锁，不停等。与自动升级实验室独立，不控制局内道具选择。'],
    ['pickup', '主动拾取资源', '将附近资源纳入移动目标。'],
    ['autoClaim', '自动领取奖励', '领取已完成的任务与成就奖励。'],
    ['safeMode', '优先生存', '默认关闭。开启后采用更保守的生命预算；关闭时以通关、局外奖励和资源成长为目标，付不起的交互先跳过，不等钱兜圈。'],
    ['jumpMove', '跳跃移动', '默认关闭，已保存的开启状态会保留。开启后移动时连续点按跳跃键，并按原生规则起跳；交互、投球、祭坛充能及选择页面会临时停跳。可帮助通过坡面，不能越过地图边界或超出原生跳跃能力。'],
    ['slideMove', '滑铲移动', '默认关闭。开启后移动中在原生落地、冷却及状态允许时尽量连续滑铲；交互、投球、救援、祭坛、楼梯及驻留门区优先。与跳跃移动同时开启时优先合法滑铲，必要避险和越障保留；美丽空壳仅提供原生短暂无敌，不能保证无缝无敌。'],
    ['bossRetreat', '优先远离首领', '默认关闭。开启后非必要时尽量远离首领；关闭恢复原走位，保留避险、脱困和交互。捕捉、救援、奖励及下一关等必要操作仍正常处理。'],
    ['fullMapOrbit', '全图环飞', '默认关闭。按当前对局游戏时间计时，达到下方秒数后在原生允许时连跳并沿全图巡航，不为敌方身体或攻击范围改道，仍遵守地图墙体与边界。允许交互时先落地完成，再继续环飞；“不再交互”或到时生效的“后续不再交互”优先。关闭后恢复原移动偏好，不能保证无伤或永久飞行。'],
    ['noInteractionsAfter', '后续不再交互', '默认关闭。开启后，仅当当前对局游戏时间达到下方秒数时，停止主动拾取、捕捉、购买、召唤、换关、终极技及目标完成退局；原生自动攻击不变，强制选择仍正常处理。未勾选不限制，0秒表示立即生效。'],
    ['flightKeepInteractions', '保持交互', '默认开启。允许交互时，飞行或环飞遇到可执行操作，先停止连跳、落地接近，完成后继续移动；已关闭或不符合条件的操作仍不会执行，“不再交互”优先。'],
    ['bossPriority', 'boss最高优先级', '默认关闭，仍保留有限准备后的首领推进保底。开启后优先前往合法召唤点，不等待配装成形；异色与优先捕捉保持到成功或原生消失，必要原生事件窗口仍按条件处理。'],
    ['portalPriority', '下一关最高优先级', '默认关闭，仍保留有限搜刮后的换关保底。开启后优先前往可用出口；标准末关已生成且符合当前设置的免费首领奖励仍先收尾，超时后正常离开。现场优先捕捉保持到成功或原生消失，短暂重寻路不会放弃目标。'],
    ['shopPriority', '优先交互商店', '默认关闭。开启后优先前往可执行的喵喵商店，先购买有用且付得起的现货，再按原生规则有限刷新购买；实际预算、道具上限、交互禁项、优先捕捉及首领和换关保底仍有效，不会为了商店无限停留。'],
    ['shinyPriority', '异色最高优先级', '默认开启。所有挂机模式都优先追踪并正常削弱、捕捉异色；关闭仅取消最高抢占，不限制为刷异色模式。'],
    ['capturePriority', '捕捉最高优先级', '默认开启。先处理真实弱化/倒地的有限捕捉窗口，再追踪未加入联盟的活目标，其次已有目标；异色最高优先保持，捕捉排在首领和出口之前。开启时已有也抓，不因图鉴已解锁跳过；击败或合法交互后才可捉的，按原生资格处理。同一现场目标失败只短暂侧移重寻路，不因次数或38秒卡住放弃，直到成功或原生消失。普通超梦入盟后，当前开放版本暂无可重复异色超梦来源，指定该异色会提示等待新来源，并非永久不可获得。满队仍捕捉后比较替换，已用状态、交互代价与玩家授权照旧，不改变投球资格；限时召唤者只给击杀/研究奖励，不能投球。'],
    ['riskyInteractions', '允许永久代价交互', '根据当前目标和方案评估净收益，允许有意义的永久代价强化；立即致命或破坏成形的代价仍受保护。关闭后停止这类自动评估；下方“代价必选”独立生效。'],
    ['forceCostInteractions', '代价必选', '默认关闭。开启后在原生允许的代价选项中按下方正面效果顺序选择，不再因当前方案偏好或常规收益评估放弃；原生费用、资格、独立禁项与实际可选范围仍须满足。'],
    ['autoRestart', '结束后继续', '结算完成后按当前模式开始下一局。'],
    ['reserveMoveSlot', '优先攒出第四招', '保留星尘，优先解锁第四个招式栏位。'],
    ['pickupBonkoin', '优先拾取邦币', '主动靠近并拾取邦币，关底在有限收尾时间内先收币再离开；捕捉、关键交互和避险仍优先。'],
    ['expandVitaminSlots', '开启维生素槽位', '优先考虑原生增加维生素槽位的交互，遵守实际代价与可执行条件。'],
  ];
  // These panels edit the existing flat settings. Moving a control does not
  // create another copy of its preference or change the controller contract.
  const BEHAVIOR_GROUPS = {
    movement:['jumpMove','slideMove','bossRetreat','fullMapOrbit','flightMove','flightKeepInteractions','flightNoInteractions'],
    outside:['autoUpgrade','autoUnlockItems','autoClaim','reserveMoveSlot'],
    strategy:['pickup','safeMode','bossPriority','portalPriority','shopPriority','shinyPriority','capturePriority','pickupBonkoin','expandVitaminSlots','noInteractionsAfter'],
    cost:['riskyInteractions','forceCostInteractions'],
  };
  let state = { running: false, paused: false, profile: null, game: {}, session: {}, config: { ...DEFAULT_CONFIG }, logs: [] };
  let catalog = { characters: [], builds: [], modes: FALLBACK_MODES, maps: [] };
  let logs = [];
  let activeTab = 'overview';
  let logFilter = 'all';
  let logPage = null, logPageRequestedKey = '', logPageFailedKey = '', logPagePending = false;
  let expanded = false;
  let panelHidden = false, panelVisibilityPending = null, panelLayoutBusy = false, panelCatalogDirty = false;
  let bridge = null;
  let busy = false;
  let recoveryCancelBusy = false;
  let recoveryLoginBusy = false;
  let recoveryLoginVisible = false;
  let recoveryLoginRevision = 0;
  let recoveryLoginSavedRevision = 0;
  let recoveryLoginTimer = null;
  let recoveryLoginTouched = { name: false, password: false };
  let recoveryLoginReadBusy = false;
  let recoveryLoginVisibilityEpoch = 0;
  let hotkeyDraft = null;
  let hotkeyDraftRevision = 0;
  const HOTKEY_FIELDS = [['hotkeyToggle', '暂停 / 继续'], ['hotkeyStop', '停止挂机'], ['hotkeyReleaseMouse', '释放鼠标（挂机继续）']];
  const validHotkey = value => /^(Ctrl\+)?(Alt\+)?(Shift\+)?(F([1-9]|1[0-2])|Key[A-Z]|Digit[0-9]|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Space|Enter|Tab|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|PageUp|PageDown|Insert|Delete)$/.test(value);
  const displayHotkey = value => String(value || '').replace(/Key([A-Z])$/, '$1').replace(/Digit([0-9])$/, '$1');
  let catalogLoaded = false;
  let stateLoaded = false;
  let pendingConnectionAction = '';
  let browserOptimizationBusy = false;
  let browserOptimizationReport = null;
  let subscribedBridge = null;
  let catalogRetryTimer = null, stateRetryTimer = null;
  let catalogRetryCount = 0, stateRetryCount = 0;
  let disposing = false;
  const syncRetryDelay = count => [1000, 2000, 5000, 10000, 30000][Math.min(4,count)];
  function retryCatalogSync() {
    if(disposing || catalogRetryTimer) return;
    catalogRetryTimer=setTimeout(()=>{catalogRetryTimer=null;refreshCatalog();},syncRetryDelay(catalogRetryCount++));
  }
  function retryStateSync() {
    if(disposing || stateRetryTimer) return;
    stateRetryTimer=setTimeout(async()=>{
      stateRetryTimer=null;
      try { const value=await bridge?.getState?.(); if(value && typeof value==='object')receiveState(value);else retryStateSync(); }
      catch { retryStateSync(); }
    },syncRetryDelay(stateRetryCount++));
  }
  let stateReceivedAt = Date.now();
  let elapsedAtReceive = null;
  let previewCharacterId = null;
  let characterSignature = '';
  let buildDetailsSignature = '';
  let buildSelectSignature = '';
  let finalReplacementSignature = '';
  let catalogGeneration = 0;
  let collectionCatalogIndex = null, collectionSettingsSignature = '';
  let buildIndex = null, mergedBuildCache = null;
  let shinySignature = '';
  let shinyPickerDraft = false;
  let unlockTargetsSignature = '';
  let modeCardsSignature = '', limitedEventsExpanded = false;
  const unlockSearchIndex = new Map();
  let logSignature = '';
  let recentSignature = '', unlockNoticeRowsSignature = '';
  let logActionBusy = false;
  let logsWereCleared = false;
  let planDraft = null;
  let planDirty = false;
  let planDraftRevision = 0;
  let planBusy = false;
  let planSection = 'basics';
  let customPlanSignature = '';
  let receivedCustomPlansSignature = null;
  let maintenanceBusy = false;
  let maintenancePromptKind = '';
  let catalogRevisionSeen = null;
  let catalogRefreshPending = false;
  let catalogRefreshQueued = false;
  let prerequisiteBusy = false;
  let changelogBusy = false;
  let encyclopediaIndex = [];
  let encyclopediaSelection = null;
  let encyclopediaPage = 0;
  let delayRangeDirty = false;
  let skins = [], skinsLoaded = false, skinsBusy = false, skinsLoading = false;
  let selectedSkinId = null, previewSkinId = null, skinNameDirty = false, skinsSignature = '', skinFormId = null;
  let skinRuntime = { phase: 'unavailable' };
  let skinPromptText = '', skinPreviewImage = null, skinPreviewPendingImage = null, skinPreviewKey = '', skinPreviewRequest = 0;
  let skinPreviewTimer = null, skinPreviewFrame = 0, skinDeleteId = null;
  const ENCYCLOPEDIA_PAGE_SIZE = 40;
  const RULE_GROUPS = { moves: { field: 'moveRules', label: '招式', target: 'targetLevel', targetLabel: '目标等级' }, vitamins: { field: 'vitaminRules', label: '维生素', target: 'targetCount', targetLabel: '目标数量' }, items: { field: 'itemRules', label: '道具', target: 'targetCount', targetLabel: '目标数量' } };
  const MAINTENANCE_KINDS = [
    { id: 'full', title: '适配游戏更新', purpose: '修复官方更新造成的接口不兼容；保持既有功能、解锁路线、等待与单实例规则。' },
    { id: 'fix', title: '修复致命故障', purpose: '修复崩溃、无法连接或功能无法运行的缺陷，不借维护改变已有策略和使用约束。' },
  ];
  let savedTimer = null;
  let toastTimer = null;
  let configSequence = 0;
  let confirmedConfig = null;
  const pendingConfigWrites = [];
  let configWriteTail = Promise.resolve(), configFailureCount = 0;
  let subscriptionCleanups = [];

  function timedMovementSettings(raw={}) {
    const seconds=value=>typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<=604800?Math.max(0,value):600;
    return {noInteractionsAfter:raw.noInteractionsAfter===true,noInteractionsAfterSeconds:seconds(raw.noInteractionsAfterSeconds),
      fullMapOrbit:raw.fullMapOrbit===true,fullMapOrbitAfterSeconds:seconds(raw.fullMapOrbitAfterSeconds)};
  }
  function costInteractionSettings(raw={}) {
    const effects=costEffects(),allowed=new Set(effects.map(effect=>effect.id));
    return {forceCostInteractions:raw.forceCostInteractions===true,costEffectPriorities:Array.from({length:10},(_,index)=>{
      const value=Array.isArray(raw.costEffectPriorities)?raw.costEffectPriorities[index]:'';
      return typeof value==='string'&&(allowed.has(value)||!effects.length&&/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(value))?value:'';
    })};
  }
  function flightInteractionSettings(raw={},patch=null) {
    let flightNoInteractions=raw.flightNoInteractions===true,
      flightKeepInteractions=Object.hasOwn(raw,'flightKeepInteractions')?raw.flightKeepInteractions===true:!flightNoInteractions;
    if(patch?.flightNoInteractions===true)flightKeepInteractions=false;
    else if(patch?.flightKeepInteractions===true)flightNoInteractions=false;
    else if(flightNoInteractions)flightKeepInteractions=false;
    return {flightNoInteractions,flightKeepInteractions};
  }
  function currentConfig() { return { ...DEFAULT_CONFIG, unlockCategory: 'all', ...(state.config || {}),
    ...flightInteractionSettings(state.config || {}),
    ...costInteractionSettings(state.config || {}),
    ...timedMovementSettings(state.config || {}),
    autoUpgrade: state.config?.autoUpgrade === true,
    autoUnlockItems: state.config?.autoUnlockItems === true,
    autoClaim: state.config?.autoClaim === true,
    reserveMoveSlot: state.config?.reserveMoveSlot === true,
    bossRetreat: state.config?.bossRetreat === true,
    shopPriority: state.config?.shopPriority === true,
    ...(state.config?.mode === 'events' ? { mode: 'tower' } : {}),
    unlockTargets: { ...(state.config?.unlockTargets || {}) }, eventTargets: { ...(state.config?.eventTargets || {}) } }; }
  function characterIdOf(char) { return first(char?.id, char?.species, char?.pokemonId); }
  function idKey(id) { return id === null || id === undefined || id === '' ? 'auto' : String(id); }
  function findCharacter(id) { return catalog.characters.find((char) => idKey(characterIdOf(char)) === idKey(id)); }
  function characterName(char) { return nameOf(first(char?.name, char?.nameZh, char?.label, char?.nameEn), char ? `角色 #${characterIdOf(char)}` : '自动选择角色'); }
  function profileLeague() {
    const league = first(state.profile?.league, state.profile?.characters, state.profile?.unlockedCharacters);
    return Array.isArray(league) ? league : null;
  }
  function unlockedIds() {
    const league = profileLeague();
    return league === null ? null : new Set(league.map((entry) => idKey(typeof entry === 'object' ? characterIdOf(entry) : entry)));
  }
  function isUnlocked(char) {
    const ids = unlockedIds();
    if (ids) return ids.has(idKey(characterIdOf(char)));
    if (typeof char?.unlocked === 'boolean') return char.unlocked;
    return null;
  }
  function modes() {
    const entries = Array.isArray(catalog.modes) && catalog.modes.length ? catalog.modes : FALLBACK_MODES;
    const sources = [...entries, ...(Array.isArray(catalog.unlockGoals?.eventModes) ? catalog.unlockGoals.eventModes : []),
      ...(Array.isArray(catalog.unlockCatalog?.eventModes) ? catalog.unlockCatalog.eventModes : [])];
    const visible = sources
      .filter((entry, index, all) => entry && !['unlocks', 'events'].includes(entry.id) && !entry.hidden && !entry.internal &&
        all.findIndex(other => entry.eventId ? other?.eventId === entry.eventId : other?.id === entry.id) === index)
      .map(entry => entry.eventId ? { ...entry, openingPeriods: displayEventPeriods(...sources.filter(other => other?.eventId === entry.eventId)) } : entry)
      .map(entry => entry.id === 'dex'
      ? { ...entry, label: '开图鉴', description: '发现尚未收录或指定的精灵。' } : ['tower','mutation'].includes(entry.id)
        ? { ...FALLBACK_MODES.find(mode => mode.id === entry.id), ...entry } : entry);
    const complete = [...visible, ...FALLBACK_MODES.filter(mode =>
      ['autoManage', 'shiny', 'tower', 'mutation', 'characters', 'research', 'lab', 'items', 'achievements', 'appearance', 'wardrobe', 'allClears'].includes(mode.id) &&
      !visible.some(entry => entry.id === mode.id))];
    const managed = complete.find(mode => mode.id === 'autoManage'), dex = complete.find(mode => mode.id === 'dex');
    if (managed) {
      const ordered = complete.filter(mode => !['autoManage', 'dex'].includes(mode.id));
      const quest = ordered.findIndex(mode => mode.id === 'quests');
      ordered.splice(quest >= 0 ? quest + 1 : Math.min(2, ordered.length), 0, managed, ...(dex ? [dex] : []));
      complete.splice(0, complete.length, ...ordered);
    }
    return complete.map((mode, index) => ({ ...mode, eventStatus: mode.eventId ? eventModeStatus(mode) : mode.eventStatus, index }))
      .sort((a, b) => modeSortGroup(a) - modeSortGroup(b) ||
        (modeSortGroup(a) >= 2 ? eventReleaseOrder(b) - eventReleaseOrder(a) : 0) || a.index - b.index);
  }
  function eventModeStatus(mode) {
    const native = Array.isArray(state.game?.eventModes) ? state.game.eventModes.find(entry => entry.eventId === mode.eventId || entry.id === mode.eventId) : null;
    if (native?.live === true) return 'active';
    if (['expired', 'upcoming', 'inactive'].includes(native?.eventStatus)) return native.eventStatus;
    if (native?.live === false) return 'inactive';
    // Static dates describe the event release, never prove current server availability.
    return 'unknown';
  }
  function modeSortGroup(mode) {
    if (mode.category === 'permanent-event' || mode.activityKind === 'permanent') return 1;
    if (mode.category === 'limited-event' || mode.activityKind === 'limited' || mode.eventId) return mode.eventStatus === 'expired' ? 4 : mode.eventStatus === 'active' ? 2 : 3;
    return 0;
  }
  function displayEventPeriods(...sources) {
    const periods = new Map();
    for (const source of sources) {
      for (const row of [...(Array.isArray(source?.openingPeriods) ? source.openingPeriods : []), source]) {
        const start = dateOf(row?.startsAt), end = dateOf(row?.endsAt);
        if (!start || !end || start >= end) continue;
        const startsAt = start.toISOString(), endsAt = end.toISOString();
        periods.set(startsAt + '|' + endsAt, { startsAt, endsAt });
      }
    }
    return [...periods.values()].sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt) || Date.parse(b.endsAt) - Date.parse(a.endsAt));
  }
  const eventDateFormatter = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
  function eventChinaDate(value) {
    const date = dateOf(value);
    if (!date) return null;
    const parts = Object.fromEntries(eventDateFormatter.formatToParts(date).map(part => [part.type, part.value]));
    return `${parts.year}.${parts.month}.${parts.day}`;
  }
  function eventPeriodText(period) { return `${eventChinaDate(period.startsAt)}–${eventChinaDate(period.endsAt)}`; }
  function eventReleaseOrder(mode) { return dateOf(displayEventPeriods(mode)[0]?.startsAt)?.getTime() ?? numeric(mode.releaseOrder) ?? 0; }
  function limitedEventMode(mode) { return Boolean(mode.eventId) && mode.category !== 'permanent-event' && mode.activityKind !== 'permanent'; }
  function uiModeId() { const config = currentConfig(); return config.mode === 'map' ? 'maps' : config.mode === 'leaderboard' ? ['endless', 'survival'].includes(config.leaderboardGoal) ? 'endless' : `leaderboard-${config.leaderboardGoal || 'kills'}` : config.mode; }
  function modeInfo(id) { const visibleId = id === 'events' ? 'tower' : id === 'leaderboard-survival' ? 'endless' : id;
    return modes().find((mode) => mode.id === visibleId) || FALLBACK_MODES.find((mode) => mode.id === visibleId) || FALLBACK_MODES[0]; }
  function modeConfig(id) { return id === 'maps' ? { mode: 'map' } : id.startsWith('leaderboard-') ? { mode: 'leaderboard', leaderboardGoal: id.slice('leaderboard-'.length) } : { mode: id }; }
  function modeRouteKey(config = currentConfig()) {
    return config.mode === 'leaderboard' ? `leaderboard-${['endless', 'survival'].includes(config.leaderboardGoal) ? 'survival' : config.leaderboardGoal === 'time' ? 'time' : 'kills'}` : config.mode;
  }
  function rankingCampKind(config = currentConfig()) {
    const key=modeRouteKey(config);
    return key==='leaderboard-kills'?'kills':['endless','leaderboard-survival'].includes(key)?'endless':null;
  }
  function currentModeSettings() {
    const config = currentConfig(), key=modeRouteKey(config), own = config.modeSettings?.[key], kind=rankingCampKind(config),
      campStage=own?.campStage==='auto'?'auto':Number.isInteger(own?.campStage)&&own.campStage>=1&&own.campStage<=1000?own.campStage:kind==='kills'?3:'auto',
      route=own ? { biome: own.biome || 'auto', tier: own.tier ?? 'auto' } :
        config.modeSettings ? { biome: 'auto', tier: 'auto' } : { biome: config.biome || 'auto', tier: config.tier ?? 'auto' };
    return {...route,...(kind?{campStage}:{})};
  }
  const TOWER_CURSES = [
    ['hunger','灵魂之饥','本局伤害加成 +20%；下一层地面不提供治疗、蜡烛不再治疗'],
    ['iron','灵质铠甲','抵达下一层获得史诗或更高品质道具；下一层怪物血量 +40%'],
    ['dark','无光','下一层出现超级球；下一层蜡烛无法点燃'],
    ['graves','躁动的墓碑','立即获得金币（当前宝箱基础价的 60%，至少 80）；下一层附近墓碑会爆炸'],
    ['swift','幽灵疾走','本局移速加成 +10%；下一层怪物速度 +25%'],
    ['twin','幽灵×2','本局经验加成 +20%；下一层隐藏幽灵出现概率翻倍（最高 95%）'],
  ];
  function towerCurseOrder(value) {
    const known=TOWER_CURSES.map(([id])=>id),preferred=Array.isArray(value)?[...new Set(value.filter(id=>known.includes(id)))]:[];
    return {custom:preferred.length>0,order:[...preferred,...known.filter(id=>!preferred.includes(id))]};
  }
  function renderTowerCursePriority() {
    const {custom,order}=towerCurseOrder(currentConfig().modeSettings?.tower?.cursePriority),list=$('tower-curse-list'),signature=JSON.stringify([custom,order]);
    $('tower-curse-reset').disabled=!custom;
    if(list.dataset.order===signature)return;
    list.dataset.order=signature;
    list.replaceChildren(...order.map((id,index)=>{
      const row=element('li','tower-curse-row');row.dataset.curseId=id;
      const [,name,effect]=TOWER_CURSES.find(([key])=>key===id);
      row.append(element('span','tower-curse-name',`${name}：${effect}`));
      for(const [direction,label,offset] of [['up','上移',-1],['down','下移',1]]) {
        const button=element('button','',direction==='up'?'↑':'↓');button.type='button';button.dataset.curseMove=direction;
        button.setAttribute('aria-label',label+TOWER_CURSES.find(([key])=>key===id)[1]);button.disabled=index+offset<0||index+offset>=order.length;
        row.append(button);
      }
      return row;
    }));
  }
  function mutationModeSettings(config=currentConfig()) {
    const raw=config.modeSettings?.mutation;
    return {target:raw?.target==='leaderboard'?'leaderboard':'daily-rewards',
      afterDailyRewards:raw?.afterDailyRewards==='stop'?'stop':'wait-next-day'};
  }
  function appearanceModeSettings(config=currentConfig()) {
    const raw=config.modeSettings?.[config.mode];
    return {countMode:['auto','standard','endless'].includes(raw?.countMode)?raw.countMode:'auto',
      countCampStage:raw?.countCampStage==='auto'?'auto':Number.isInteger(raw?.countCampStage)&&raw.countCampStage>=1&&raw.countCampStage<=3?raw.countCampStage:'auto',
      settleOnGoal:typeof raw?.settleOnGoal==='boolean'?raw.settleOnGoal:true};
  }
  function renderAppearanceConfiguration(config=currentConfig()) {
    const enabled=['appearance','wardrobe'].includes(config.mode),root=$('appearance-options');root.hidden=!enabled;if(!enabled)return;
    const options=appearanceModeSettings(config);
    syncBoundValue($('appearance-count-mode'),options.countMode);
    syncBoundValue($('appearance-count-camp-stage'),String(options.countCampStage));
    $('appearance-count-camp-stage').disabled=options.countMode==='standard';
    $('appearance-settle-on-goal').checked=options.settleOnGoal;
    setText('appearance-options-help',`${options.countMode==='standard'?'数量目标优先采用经典模式。':options.countMode==='endless'?'兼容长局累计的数量目标优先采用无尽模式。':'自动为适合长局累计的数量挑战选择无尽。'}通关、进化、指定模式等按目标实际条件安排；设置不会覆盖原生限制，也不会把角色前置或随机捕获当成已完成。无尽未达标时持续刷取，直到达标或死亡。驻留区域只用于本模式兼容的无尽数量局，不改其它模式的挂机区域。`);
  }
  const TOWER_CHOICES = [
    ['trickPolicy','糖果与捣蛋',[['inherit','继承原方案'],['treat','固定选择糖果'],['trick','固定选择捣蛋']]],
    ['rewardFocus','奖励倾向',[['inherit','继承原方案'],['damage','输出'],['survival','生存'],['growth','成长'],['control','控制']]],
    ['vitaminFocus','维生素倾向',[['inherit','继承原方案'],['damage','输出'],['survival','生存'],['growth','成长'],['dodge','闪避']]],
    ['supportFocus','随行支援倾向',[['inherit','继承原方案'],['damage','输出'],['status','异常状态'],['survival','生存']]],
    ['pactPolicy','代价取舍',[['inherit','继承原策略'],['avoid','避免主动接受代价'],['auto','按当前收益判断']]],
    ['shopPolicy','商店购买',[['inherit','继承原方案'],['useful','有用且可购买就买'],['preferred','优先配置顺序，未命中仍正常判断']]],
  ];
  const TOWER_PRIORITIES = [['itemPriorities',10,'item'],['vitaminPriorities',5,'vitamin'],['pactPriorities',10,'pact']];
  let towerRenderedState=null,towerCatalogCache=null;
  const towerPriorityViews=new Map();
  const renderedBoundValues=new WeakMap();
  function syncBoundValue(input,value) {
    // Preserve a focused search draft across unrelated state pushes, but show
    // the confirmed value immediately when an optimistic save is rolled back.
    if(document.activeElement!==input||renderedBoundValues.get(input)!==value){if(input.value!==value)input.value=value;}
    renderedBoundValues.set(input,value);
  }
  function towerStrategySettings(raw={}) {
    if(!raw||typeof raw!=='object'||Array.isArray(raw))raw={};const value={};
    for(const[field,,options]of TOWER_CHOICES)value[field]=options.some(([key])=>key===raw[field])?raw[field]:'inherit';
    for(const[field,count]of TOWER_PRIORITIES){const used=new Set();value[field]=Array.from({length:count},(_,index)=>{
      const key=Array.isArray(raw[field])?raw[field][index]:null;if(typeof key!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(key)||used.has(key))return '';used.add(key);return key;
    });}
    return value;
  }
  function towerModeSettings(config=currentConfig()) {
    const route = config.modeSettings?.tower || {}, selected = selectedEventTarget('halloween26');
    return {...towerStrategySettings(route),exitPolicy:['clear','continue'].includes(route.exitPolicy) ? route.exitPolicy : ['events:halloween26:quest:beyond','events:halloween26:quest:abyss'].includes(selected) ? 'continue' : 'clear',noCandles:route.noCandles === true,onlyExperience:route.onlyExperience === true,saveMoneyAfter50:route.saveMoneyAfter50 === true,aggressiveUltimate:route.aggressiveUltimate === true};
  }
  function towerPriorityCatalogs() {
    const refs=[catalog.towerItemNames,catalog.vitaminNames,catalog.costEffects];
    if(towerCatalogCache&&refs.every((value,index)=>value===towerCatalogCache.refs[index]))return towerCatalogCache.entries;
    const names=raw=>raw&&typeof raw==='object'&&!Array.isArray(raw)?Object.entries(raw).filter(([id])=>/^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(id)).map(([id,label])=>({id,label:nameOf(label,id)})):[];
    const entries={itemPriorities:names(refs[0]),vitaminPriorities:names(refs[1]),pactPriorities:costEffects().map(row=>({id:row.id,label:row.label}))};
    towerCatalogCache={refs,entries};return entries;
  }
  function saveTowerSettings(patch){return saveConfig({modeSettings:{tower:patch}});}
  function buildTowerPriority(root,field,count,prefix,entries) {
    root.replaceChildren();const views=[];
    if(!entries.length)root.append(element('p','replacement-error','当前目录暂未就绪，已保存顺序保留；可以清空，不能自行输入新值。其他功能可正常使用。'));
    const names=new Map(entries.map(row=>[row.id,row.label]));
    for(let index=0;index<count;index++){
      const row=element('div','replacement-field'),label=element('label','',`优先级 ${index+1}`),combo=element('div','replacement-combobox'),input=document.createElement('input'),open=element('button','replacement-dropdown','▾'),options=element('div','replacement-options'),error=element('p','replacement-error');
      const savedKey=()=>towerRenderedState?.[field]?.[index]||'',name=key=>names.get(key)||(key?'已保存（当前目录无此项）':'自动判断');
      input.type='search';input.id=`tower-${prefix}-priority-${index+1}`;input.autocomplete='off';input.placeholder='搜索当前游戏目录';input.setAttribute('role','combobox');input.setAttribute('aria-expanded','false');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-controls',`tower-${prefix}-options-${index+1}`);label.htmlFor=input.id;
      open.type='button';open.setAttribute('aria-label',`展开${prefix==='item'?'道具':prefix==='vitamin'?'维生素':'代价效果'}优先级${index+1}`);options.id=`tower-${prefix}-options-${index+1}`;options.hidden=true;options.setAttribute('role','listbox');
      let visible=[],active=-1,applying=false;
      const hide=()=>{options.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');};
      const commit=key=>{if(applying)return;const values=towerStrategySettings(currentConfig().modeSettings?.tower)[field];if(key&&values.some((value,position)=>position!==index&&value===key)){error.textContent='此项已在其它优先级中，请选择另一项或自动判断。';return;}applying=true;hide();error.textContent='';input.setAttribute('aria-invalid','false');if(values[index]!==key){values[index]=key;saveTowerSettings({[field]:values});}input.value=name(key);};
      const draw=all=>{active=-1;const term=all?'':searchText(input.value);visible=[{id:'',label:'自动判断'},...entries].filter(row=>!row.id||!term||searchText(`${row.label} ${row.id}`).includes(term));options.replaceChildren();for(const[position,item]of visible.entries()){const button=element('button','replacement-option');button.type='button';button.id=`${options.id}-${position}`;button.setAttribute('role','option');button.setAttribute('aria-selected',String(item.id===savedKey()));button.append(element('strong','',item.label));button.addEventListener('pointerdown',event=>event.preventDefault());button.addEventListener('click',()=>commit(item.id));options.append(button);}if(visible.length===1&&term)options.append(element('p','replacement-note','没有匹配项目，请从当前目录选择；留空为自动判断。'));options.hidden=false;input.setAttribute('aria-expanded','true');};
      input.addEventListener('focus',()=>{applying=false;draw(true);});input.addEventListener('input',()=>{applying=false;error.textContent='';input.setAttribute('aria-invalid','false');draw(false);});
      open.addEventListener('pointerdown',event=>event.preventDefault());open.addEventListener('click',()=>{if(options.hidden){input.focus();draw(true);}else hide();});
      const exact=()=>entries.filter(row=>row.id===input.value.trim()||row.label===input.value.trim());
      input.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();hide();input.value=name(savedKey());}else if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();if(options.hidden)draw(true);active=Math.max(0,Math.min(visible.length-1,active+(event.key==='ArrowDown'?1:-1)));options.querySelectorAll('button').forEach((button,position)=>button.classList.toggle('active',position===active));input.setAttribute('aria-activedescendant',`${options.id}-${active}`);options.children[active]?.scrollIntoView({block:'nearest'});}else if(event.key==='Enter'){event.preventDefault();if(active>=0)commit(visible[active].id);else if(!input.value.trim()||input.value==='自动判断')commit('');else if(exact().length===1)commit(exact()[0].id);}});
      input.addEventListener('blur',()=>setTimeout(()=>{if(applying||combo.contains(document.activeElement))return;hide();if(input.value===name(savedKey()))return;if(!input.value.trim()||input.value==='自动判断')commit('');else if(exact().length===1)commit(exact()[0].id);else{input.value=name(savedKey());input.setAttribute('aria-invalid','true');error.textContent='请从下拉结果选择；未匹配文字没有保存。';}},0));
      combo.append(input,open,options);row.append(label,combo,error);root.append(row);views.push({input,savedKey,name});
    }
    towerPriorityViews.set(field,{signature:JSON.stringify(entries),views});
  }
  function renderTowerConfiguration(config) {
    const active=config.mode==='tower'||modeInfo(uiModeId()).eventId==='halloween26';if(!active)return;
    towerRenderedState=towerModeSettings(config);const root=$('tower-power-controls');
    if(!root.dataset.built){for(const[field,label,options]of TOWER_CHOICES){const row=element('label','inline-field',label),select=document.createElement('select');select.id='tower-'+field.replace(/[A-Z]/g,letter=>'-'+letter.toLowerCase());select.setAttribute('aria-label',label);for(const[value,text]of options)select.add(new Option(text,value));select.addEventListener('change',()=>saveTowerSettings({[field]:select.value}));row.append(select);root.append(row);}root.dataset.built='true';}
    for(const[field]of TOWER_CHOICES)syncBoundValue($('tower-'+field.replace(/[A-Z]/g,letter=>'-'+letter.toLowerCase())),towerRenderedState[field]);
    const entries=towerPriorityCatalogs();for(const[field,count,prefix]of TOWER_PRIORITIES){const signature=JSON.stringify(entries[field]);if(towerPriorityViews.get(field)?.signature!==signature)buildTowerPriority($(`tower-${prefix}-priorities`),field,count,prefix,entries[field]);for(const view of towerPriorityViews.get(field).views)syncBoundValue(view.input,view.name(view.savedKey()));}
  }
  function saveModeSettings(patch) {
    const config = currentConfig();
    // Send only the field the player changed. A delayed status snapshot must
    // never put an older map back into a later difficulty-save command.
    return saveConfig({ modeSettings: { [modeRouteKey(config)]: patch } });
  }
  function renderLeaderboardCamp() {
    const config=currentConfig(), kind=rankingCampKind(config), section=$('leaderboard-camp-options');
    section.hidden=!kind;if(!kind)return;
    const route=currentModeSettings(), maps=route.biome==='auto' ? catalog.maps.filter(map=>map.live!==false && map.available!==false) : catalog.maps.filter(map=>String(map.id)===route.biome);
    // The reviewed projection owns engine-specific area counts. Endless
    // migration areas are independent of time phases and standard sanctuaries.
    const field=kind==='endless'?'endlessAreas':'standardStages',
      counts=maps.map(map=>map[field]).filter(count=>Number.isInteger(count)&&count>=1&&count<=1000),max=counts.length?Math.max(...counts):null,
      select=$('leaderboard-camp-stage'),selected=route.campStage,automatic=selected==='auto',
      target=max?Math.min(automatic?(kind==='endless'?1:3):selected,max):null,
      autoLabel=kind==='endless'?'自动选择（初始区域，保守驻留）':'自动选择（优先第3关，按本图收敛）';
    const entries=[{value:'auto',label:autoLabel},...(max?Array.from({length:max},(_,index)=>({value:String(index+1),label:`第${index+1}关${kind==='endless'?'（迁移区域）':''}`})):
      automatic?[]:[{value:String(selected),label:`第${selected}关（等待原生地图目录）`}])];
    const signature=JSON.stringify(entries);
    if(select.dataset.options!==signature){select.replaceChildren(...entries.map(entry=>{const option=document.createElement('option');option.value=entry.value;option.textContent=entry.label;return option;}));select.dataset.options=signature;}
    if(document.activeElement!==select)select.value=automatic?'auto':String(target??selected);
    select.disabled=!max;
    const detail=kind==='endless'?`到达第${target}迁移区域后驻留，不主动进入迁移门；第1关就是初始地图，第2/3关分别迁移1/2次。游戏时间阶段、强制首领照常推进。自动选择初始区域以减少非必要迁移，并非所有配装的最优区域。`:
      `到达第${target}关后驻留刷击败数，不主动召唤关底或进入下一关；自动沿用第3关驻留策略，按本图实际关卡数收敛。`;
    setText('leaderboard-camp-help',!max?'正在等待经过核验的地图区域数；已保存选择保留，目录到达后自动显示可选区域。':`${detail}已超过目标时留在当前区域，不退回重来。${route.biome==='auto'?'自动地图按各自实际区域数执行。':''}${!automatic&&selected>max?`已保存第${selected}区，本图实际共${max}区，执行第${max}区驻留；切回支持的地图时保留原选择。`:''}原生强制过渡仍按游戏规则。`);
  }
  function renderCollectionSettings() {
    const config=currentConfig(), wardrobe=config.mode === 'wardrobe', collection=wardrobe || config.mode === 'allClears';
    $('collection-species-field').hidden=!collection;$('wardrobe-look-field').hidden=!wardrobe;
    if (!collection) return;
    const settings=config.modeSettings?.[config.mode] || {}, species=settings.species ?? 'auto', look=settings.look || 'auto';
    const signature=JSON.stringify([catalogGeneration,config.mode,species,look,profileLeague()]);
    if (signature === collectionSettingsSignature) return;
    if (!collectionCatalogIndex || collectionCatalogIndex.generation !== catalogGeneration) {
      const targets=unlockCatalog().targets, members=new Set(targets.filter(target=>target.category === 'characters').map(target=>String(target.nativeId ?? target.key ?? target.id.slice(11)))), looks=new Map();
      for(const target of targets){const match=/^appearance:skin-(shiny|spectral|classic|m1|m2|t1|t2|l1|l2|l3):(\d+)$/.exec(target.id || '');if(!match)continue;
        const id=match[2];if(!looks.has(id))looks.set(id,new Map());looks.get(id).set(match[1],target);}
      collectionCatalogIndex={generation:catalogGeneration,looks,characters:catalog.characters.filter(character=>!members.size || members.has(String(characterIdOf(character))))};
    }
    const select=$('collection-species');select.replaceChildren(new Option('自动选择（包括尚未解锁角色）','auto'));
    for(const character of collectionCatalogIndex.characters){const id=characterIdOf(character), unlocked=isUnlocked(character);
      select.add(new Option(characterName(character)+(unlocked === false ? ' · 先自动解锁' : unlocked === null ? ' · 等待读取资格' : ''),id));}
    if(species !== 'auto' && ![...select.options].some(option=>option.value === String(species)))select.add(new Option(`#${species} · 当前目录尚未核对`,species));
    select.value=String(species);
    const looks=$('wardrobe-look');looks.replaceChildren(new Option('自动选择全部未拥有外观','auto'));
    for(const[key,label]of [['shiny','异色外观'],['spectral','幽灵外观'],['classic','经典异色外观'],['m1','专属外观一'],['m2','专属外观二'],['t1','宝藏外观一'],['t2','宝藏外观二'],['l1','传说外观一'],['l2','传说外观二'],['l3','传说外观三']]){
      const target=species === 'auto' ? null : collectionCatalogIndex.looks.get(String(species))?.get(key);
      looks.add(new Option(target?.name || label,key));
    }
    looks.value=look;collectionSettingsSignature=signature;
  }
  function isGenericBuild(build) { return !build || ['generic', 'universal-safe'].includes(build.id) || build.generic || build.type === 'generic' || build.sourceType === 'generic'; }
  function isGuideBuild(build) { return build?.sourceType === 'guide'; }
  function dedicatedBuild(char) {
    if (!char) return null;
    const index = indexedBuilds();
    if (char.dedicatedBuildId) {
      const found = index.byId.get(String(char.dedicatedBuildId));
      if (found && !isGuideBuild(found)) return found;
    }
    return index.dedicated.get(idKey(characterIdOf(char))) || null;
  }
  // Catalog definitions change only at receiveCatalog. Keep one bounded index,
  // rather than scan thousands of historical builds once per character card.
  function indexedBuilds() {
    if (buildIndex) return buildIndex;
    const byId = new Map(), dedicated = new Map(), applicable = new Map();
    for (const build of catalog.builds) {
      const key = String(build.id); if (!byId.has(key)) byId.set(key, build);
      const ids = new Set([first(build.characterId, build.species, build.pokemonId), ...(Array.isArray(build.characters) ? build.characters : [])].filter(id => id !== undefined && id !== null).map(idKey));
      for (const id of ids) {
        if (!isGuideBuild(build) && !dedicated.has(id)) dedicated.set(id, build);
        if (!isGenericBuild(build)) { if (!applicable.has(id)) applicable.set(id, []); applicable.get(id).push(build); }
      }
    }
    return buildIndex = { byId, dedicated, applicable };
  }
  function customPlans() { return Array.isArray(state.customPlans) ? state.customPlans : []; }
  function allBuilds() {
    if (!mergedBuildCache) { const custom = customPlans(), ids = new Set(custom.map(plan => plan.id)); mergedBuildCache = [...catalog.builds.filter(entry => !ids.has(entry.id)), ...custom]; }
    return mergedBuildCache;
  }
  function isCustomBuild(build) { return Boolean(build && (build.sourceType === 'custom' || String(build.id || '').startsWith('custom-'))); }
  function configuredNativeRoute() {
    const config = currentConfig();
    const preferences = currentModeSettings();
    const progress = state.game.unlockProgress;
    if ((progress?.mode === 'events' ? 'tower' : progress?.mode) === config.mode && progress.route)
      return { ...preferences, ...progress.route, nativeMode: progress.route.nativeMode || progress.route.mode || 'standard' };
    if (config.mode === 'tower') return { biome: 'graveyard', tier: 'auto', nativeMode: 'tower' };
    if (config.mode === 'mutation') {
      const daily=state.game.plan?.mutationPlan;
      return {biome:typeof daily?.biome==='string'?daily.biome:'auto',tier:Number.isInteger(daily?.tier)&&daily.tier>=0&&daily.tier<=2?daily.tier:'auto',nativeMode:'mutation'};
    }
    const eventMode = modeInfo(uiModeId());
    if (eventMode.eventId) return { biome: 'auto', tier: 'auto', nativeMode: eventMode.engineMode || 'unknown' };
    if (hasActiveNativeRun() && state.game.plan?.modePreference?.mode === config.mode)
      return { ...preferences, ...state.game.plan, nativeMode: state.game.nativeMode || state.game.plan?.mode || 'standard' };
    const endless = config.mode === 'endless' || config.mode === 'leaderboard' && ['endless', 'survival'].includes(config.leaderboardGoal);
    return { ...preferences, nativeMode: endless ? 'endless' : 'standard' };
  }
  function customPlanMatches(plan, char) {
    if (plan.enabled === false) return false;
    const preferences = configuredNativeRoute();
    if (plan.species != null && char && Number(plan.species) !== Number(characterIdOf(char))) return false;
    if (plan.biome && preferences.biome !== 'auto' && plan.biome !== preferences.biome) return false;
    if (plan.tier != null && preferences.tier !== 'auto' && Number(plan.tier) !== Number(preferences.tier)) return false;
    return !plan.mode || plan.mode === 'any' || plan.mode === preferences.nativeMode;
  }
  function currentBuild(char) {
    const selected = currentConfig().build;
    const active = (selected === 'auto' || !selected) && char && String(state.game.characterId) === String(characterIdOf(char)) ? allBuilds().find(build => build.id === state.game.buildId) : null;
    if (active) return active;
    if (selected && selected !== 'auto' && selected !== 'generic') return allBuilds().find((build) => String(build.id) === String(selected)) || null;
    if (currentConfig().mode === 'endless') return catalog.builds.find(build => isGenericBuild(build)) || null;
    return (selected !== 'generic' ? dedicatedBuild(char) : null) || catalog.builds.find((build) => isGenericBuild(build)) || null;
  }
  function typesOf(char) { return Array.isArray(char?.typeNames) ? char.typeNames : Array.isArray(char?.types) ? char.types.map((type) => nameOf(catalog.typeNames?.[type] || type)).filter(Boolean) : char?.type ? [nameOf(char.type)] : []; }
  function normalizedRunning() { return Boolean(first(state.running, state.enabled, state.game?.enabled, false)); }
  function normalizedPaused() { return Boolean(state.paused || (normalizedRunning() && ['pause', 'paused'].includes(state.game?.state))); }
  function hasActiveNativeRun() { return Boolean(state.game?.state && state.game.state !== 'over'); }
  function activeRecovery() { return state.recovery?.wantedRun === true && (state.recovery.phase !== 'idle' || !normalizedRunning()); }
  function recoveryDetail() {
    const recovery = state.recovery || {}, at = Date.parse(recovery.nextRetryAt || '');
    const seconds = Number.isFinite(at) ? Math.max(0, Math.ceil((at - Date.now()) / 1000)) : null;
    return [nameOf(recovery.status, '正在恢复游戏连接，原挂机任务已保留。'), recovery.attempts > 0 ? `已尝试 ${recovery.attempts} 次` : '', seconds !== null ? `${seconds} 秒后重试` : ''].filter(Boolean).join(' · ');
  }
  function selectedLocked() { const selected = findCharacter(currentConfig().characterId); return selected && isUnlocked(selected) === false; }
  function selectedShinyBlocked() {
    const config = currentConfig();
    if (config.mode !== 'shiny' || config.shinyMode !== 'target') return false;
    if (unlockCatalog().targets.some(target => target.category === 'shiny')) return false;
    const target = shinyTargets().find((entry) => idKey(characterIdOf(entry)) === idKey(config.shinyTargetId));
    return !target || !shinyAvailability(target).available;
  }
  function currentShinyProgress() {
    const config = currentConfig();
    const progress = state.game.shiny || {};
    const matches = (!progress.mode || progress.mode === config.shinyMode) &&
      (!progress.types || JSON.stringify(shinyTypes(progress.types)) === JSON.stringify(shinyTypes())) &&
      (config.shinyMode !== 'target' || !progress.targetId || idKey(progress.targetId) === idKey(config.shinyTargetId));
    return matches ? progress : { ...progress, owned: undefined, ownedIds: undefined, total: undefined,
      huntableMissing: undefined, targetId: null, targetName: null, complete: false, message: '' };
  }
  function executionMode() {
    if (state.recovery?.temporaryGuest) return 'resources';
    const game = state.game;
    if (game.unlockProgress?.mode) return game.unlockProgress.mode;
    const active = game.state && !['over', 'gameover', 'summary', 'ended', 'menu'].includes(game.state);
    return active && (game.plan?.modePreference?.routeKey || game.plan?.modePreference?.mode || game.plan?.goalMode) || currentConfig().mode;
  }

  function showToast(message, error = false) {
    $('toast').textContent = String(message);
    $('toast').classList.toggle('error', error);
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 5500 : 3000);
  }
  function showSaved(message = '已保存', error = false) {
    setText('saved-indicator', message);
    $('saved-indicator').classList.toggle('error', error);
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => setText('saved-indicator', ''), 2400);
  }
  function nativeStillLoading() {
    const stage = state.connection?.stage, boot = state.connection?.nativeBoot;
    return !stateLoaded || !catalogLoaded || catalogRefreshPending || boot?.phase === 'loading' ||
      ['starting','waiting','response','read-body','prepare','prepared','native-data'].includes(stage);
  }
  function showOperationError(error, action = '') {
    const message = nameOf(error?.message, '操作未能完成。');
    // A timed-out request can still finish in the host. Observe its public state
    // instead of issuing another start or reporting a late success as failure.
    if (['start','resume','checkUpdates'].includes(action) && /响应超时|连接超时|接入超时/.test(message)) {
      if ((action === 'start' || action === 'resume') && normalizedRunning() && !normalizedPaused()) {
        pendingConnectionAction = ''; showSaved('已接管当前对局'); renderClientStage(); return;
      }
      if (nativeStillLoading() || activeRecovery()) {
        pendingConnectionAction = action; retryStateSync();
        showSaved('仍在加载，等待状态同步'); renderClientStage(); return;
      }
    }
    pendingConnectionAction = ''; renderClientStage(); showToast(message, true);
  }
  function renderClientStage() {
    const connection = state.connection || {}, boot = connection.nativeBoot || {};
    const stages = { starting: '初载 · 浏览器初始化', waiting: '加载游戏页面', response: '接入 · 读取脚本', 'read-body': '接入 · 读取脚本',
      prepare: '接入 · 核对接口', prepared: '接入 · 等待游戏', 'native-data': '加载游戏资源', 'native-script': '重试游戏脚本',
      'contract-blocked': '接入需处理', 'connection-error': '接入 · 自动重试', 'runtime-unsupported': '需要更新浏览器组件' };
    const bootStages = { 'data-loading':'加载游戏数据', 'graphics-wait':'等待显卡初始化', 'auth-loading':'读取原有存档', 'native-retry':'等待游戏重连' };
    const ready = connection.stage === 'ready' || state.compatibilityReport?.state === 'ready';
    if (pendingConnectionAction === 'checkUpdates' && ready && !nativeStillLoading()) pendingConnectionAction = '';
    let label = !bridge ? '初载 · 连接客户端' : !stateLoaded ? '初载 · 同步状态' : boot.phase === 'loading'
      ? bootStages[boot.stage] || '加载游戏内容' : !catalogLoaded || catalogRefreshPending ? '读取角色与百科目录'
      : ready ? normalizedRunning() ? '就绪 · 挂机中' : '就绪' : stages[connection.stage] || (state.profile ? '就绪' : '等待游戏接入');
    let tone = ready && catalogLoaded ? '' : ' working';
    if (activeRecovery()) { label = state.recovery.requiresLogin ? '恢复 · 等待登录' : '恢复 · 自动重连'; tone = ' working'; }
    else if (['contract-blocked','runtime-unsupported'].includes(connection.stage) || state.error && !nativeStillLoading()) { label = '接入需处理'; tone = ' error'; }
    else if (pendingConnectionAction && !normalizedRunning()) { label = nativeStillLoading() ? '加载中 · 等待同步' : '等待挂机确认'; tone = ' working'; }
    const root = $('client-stage'); root.className = `client-stage${tone}`;
    setText('client-stage-label', label);
    $('client-stage-dot').className = `status-dot${tone.includes('error') ? ' error' : tone ? ' paused' : ''}`;
    const nativeFps = numeric(state.game.gameFps);
    const fps = first(nativeFps, numeric(first(state.game.performance?.fps, state.game.fps)));
    const ping = numeric(first(state.game.performance?.pingMs, state.game.pingMs));
    const metrics = [fps !== null && fps > 0 && fps <= 1000 ? `${nativeFps !== null ? '原生 ' : ''}${Math.round(fps)} FPS` : '', ping !== null && ping >= 0 && ping <= 60000 ? `${Math.round(ping)} ms` : ''].filter(Boolean);
    setText('client-performance', metrics.join(' · ')); $('client-performance').hidden = !metrics.length;
    root.title = [label, bootStages[boot.stage], state.error && !nativeStillLoading() ? nameOf(state.error) : '', ...metrics,
      nativeFps !== null ? '原生更新计数估算，不代表显示器实测帧率；超过100ms的长停顿可能被高估，需另看诊断。' : '',
      !metrics.length ? '当前没有可用的游戏FPS或网络延迟；帧率上限不等于实际帧率。' : '指标来自现有游戏状态采样，不额外发送网络探测。'].filter(Boolean).join(' · ');
  }
  async function command(action, payload = {}) {
    if (!bridge || typeof bridge.command !== 'function') {
      throw new Error('客户端连接尚未就绪，请稍候重试。');
    }
    const response = await bridge.command(action, payload);
    if (response?.ok === false || response?.error) throw new Error(nameOf(response.error || response.message, '操作未能完成。'));
    if (response?.state) receiveState(response.state);
    return response;
  }
  // Compatibility repair is an explicit, local editor. Opening it reads one
  // snapshot; closing it invalidates late UI results and starts no polling.
  // Text from an AI is data only and is never evaluated by this control page.
  let compatibilityKind = 'interfaces', compatibilityEpoch = 0, compatibilityBusy = false;
  let compatibilityView = null, compatibilityDrafts = new Map(), compatibilityInvalid = new Map();
  const compatibilityStatusNames = {valid:'有效',verified:'有效',invalid:'无效',unknown:'待核验',configured:'已保存·待核验',pending:'等待生效',discovered:'已获取·待采用',unsupported:'当前不可用',unavailable:'当前不可用',unresolved:'未解析',missing:'缺失',partial:'部分可用'};
  function compatibilitySnapshot(response) {
    const value=response?.compatibility || response?.editor || response;
    if (!value || typeof value!=='object' || !Array.isArray(value.entries) || value.kind!==compatibilityKind ||
      value.entries.some(row=>!row||typeof row.id!=='string'||!row.id||typeof row.name!=='string') ||
      new Set(value.entries.map(row=>row.id)).size!==value.entries.length) throw new Error('未取得完整的兼容配置目录。请重试；当前游戏和已有配置保持不变。');
    return {...value,applyState:value.applyState||value.applyStatus||response?.applyState||response?.applyStatus,
      acquiredIds:Array.isArray(value.acquiredIds)?value.acquiredIds:Array.isArray(response?.acquiredIds)?response.acquiredIds:[],
      entries:value.entries.map(row=>({...row,...(!Object.hasOwn(row,'effectiveValue')&&Object.hasOwn(row,'effectiveCurrent')?{effectiveValue:row.effectiveCurrent}:{}),
        ...(!Object.hasOwn(row,'value')&&Object.hasOwn(row,'configuredValue')?{value:row.configuredValue}:{})}))};
  }
  function compatibilityValueText(value) { return value===undefined||value===null?'':typeof value==='string'?value:JSON.stringify(value,null,2); }
  function compatibilityInputValue(entry,input) {
    if (entry.type==='boolean') return input.checked;
    if (Array.isArray(entry.choices)) {
      const choice=entry.choices.find(row=>String(row&&typeof row==='object'?row.value:row)===input.value);
      if(choice!==undefined)return choice&&typeof choice==='object'?choice.value:choice;
    }
    if (entry.type==='integer'||entry.type==='number') {
      const text=input.value.trim(),value=Number(text);
      if (!text||!Number.isFinite(value)||entry.type==='integer'&&!Number.isInteger(value)||
        Number.isFinite(entry.min)&&value<entry.min||Number.isFinite(entry.max)&&value>entry.max) throw new Error(`${entry.name}：请输入允许范围内的${entry.type==='integer'?'整数':'数字'}。`);
      return value;
    }
    if (entry.type==='json'||entry.type==='object'||entry.type==='array') {
      let value;try { value=JSON.parse(input.value); } catch { throw new Error(`${entry.name}：内容不是有效的 JSON。请粘贴完整内容，不要包含代码围栏。`); }
      if (entry.type==='array'&&!Array.isArray(value)||entry.type==='object'&&(!value||typeof value!=='object'||Array.isArray(value))) throw new Error(`${entry.name}：内容类型不匹配。`);
      return value;
    }
    return input.value.trim();
  }
  function setCompatibilityMessage(text,error=false) {
    const node=$('compatibility-result');node.textContent=String(text||'');node.classList.toggle('error',error);
  }
  function setCompatibilityBusy(value) {
    compatibilityBusy=value;$('compatibility-editor').setAttribute('aria-busy',String(value));
    for (const button of $('compatibility-editor').querySelectorAll('[data-compatibility-operation]')) button.disabled=value||button.dataset.compatibilityUnavailable==='true';
  }
  function compatibilityPayload(extra={}) { return {kind:compatibilityKind,...(compatibilityView?{expectedRevision:compatibilityView.revision}:{}),...extra}; }
  async function compatibilityOperation(action,payload={},success='') {
    if (compatibilityBusy) return;
    const epoch=compatibilityEpoch;setCompatibilityBusy(true);setCompatibilityMessage('正在处理，请稍候…');
    try {
      const response=await command(action,compatibilityPayload(payload));
      if (epoch!==compatibilityEpoch||!$('compatibility-editor').open) return;
      const next=compatibilitySnapshot(response);compatibilityView=next;
      // A response is the authoritative saved/effective state. Never show a
      // typed draft as effective before the host has acknowledged it.
      if(action==='applyCompatibility'||action==='importCompatibility'||action==='resetCompatibility') {
        if(next.applyState!=='invalid') {
          if(payload.id){compatibilityDrafts.delete(payload.id);compatibilityInvalid.delete(payload.id);}else {compatibilityDrafts.clear();compatibilityInvalid.clear();}
        }
      }
      if(action==='probeCompatibility')for(const entry of next.entries)if((!payload.id||entry.id===payload.id)&&
        (next.acquiredIds.includes(entry.id)||['valid','verified'].includes(entry.status)&&entry.applyState!=='invalid')) {
        compatibilityDrafts.delete(entry.id);compatibilityInvalid.delete(entry.id);
      }
      renderCompatibilityEditor();
      const pending=next.applyState==='pending-current-document'||next.applyState==='pending';
      const acquired=action==='probeCompatibility'?(pending?'重新获取已完成；部分项目等待当前页面安全采用。请核对配置方式和实际生效值。':'已完成重新查找；请逐项查看配置方式、状态和实际生效值。'):null;
      setCompatibilityMessage(next.message||next.reason||(next.applyState==='invalid'?'配置未通过核验，原有效配置未被替换。':acquired|| (pending?'配置已保存，等待当前页面可安全采用；下方仍显示实际生效值。':success||'目录与状态已更新。')),next.applyState==='invalid');
      return next;
    } catch(error) { if(epoch===compatibilityEpoch)setCompatibilityMessage(error.message,true); }
    finally { if(epoch===compatibilityEpoch)setCompatibilityBusy(false); }
  }
  async function openCompatibilityEditor(kind) {
    if(!['interfaces','other'].includes(kind))return;
    compatibilityKind=kind;compatibilityEpoch++;compatibilityView=null;compatibilityDrafts=new Map();compatibilityInvalid=new Map();compatibilityBusy=false;
    $('compatibility-prompt').value='';$('compatibility-json').value='';setCompatibilityMessage('');
    $('compatibility-search').value='';$('compatibility-only-issues').checked=false;
    const dialog=$('compatibility-editor');if(!dialog.open)dialog.showModal();
    renderCompatibilityEditor();await compatibilityOperation('readCompatibility',{},'已读取当前客户端实际配置；修改后请点击保存并应用。');
  }
  function compatibilityEntryInput(entry,value) {
    let input;
    if(entry.type==='boolean') { input=document.createElement('input');input.type='checkbox';input.checked=value===true; }
    else if((entry.type==='enum'||Array.isArray(entry.choices))&&Array.isArray(entry.choices)) {
      input=document.createElement('select');for(const choice of entry.choices) {
        const key=choice&&typeof choice==='object'?choice.value:choice,label=choice&&typeof choice==='object'?choice.label??choice.name??key:key;
        input.add(new Option(String(label),String(key)));
      }
      if(![...input.options].some(option=>option.value===String(value??'')))input.add(new Option(String(value??''),String(value??'')));
      input.value=String(value??'');
    } else if(['json','object','array','textarea'].includes(entry.type)) { input=document.createElement('textarea');input.rows=entry.type==='textarea'?3:5;input.maxLength=262144;input.value=compatibilityValueText(value); }
    else { input=document.createElement('input');input.type=entry.type==='integer'||entry.type==='number'?'number':'text';input.value=compatibilityValueText(value);input.maxLength=16384;
      if(Number.isFinite(entry.min))input.min=String(entry.min);if(Number.isFinite(entry.max))input.max=String(entry.max);if(input.type==='number')input.step=entry.type==='integer'?'1':'any'; }
    input.dataset.compatibilityId=entry.id;input.setAttribute('aria-label',entry.name+'配置值');input.autocomplete='off';input.spellcheck=false;input.disabled=entry.readOnly===true;
    const changed=()=>{try { const value=compatibilityInputValue(entry,input);compatibilityDrafts.set(entry.id,value);compatibilityInvalid.delete(entry.id);input.setAttribute('aria-invalid','false');
      const status=input.closest('.compatibility-row')?.querySelector('.compatibility-draft-status');if(status)status.textContent='有未应用修改；保存后将手动固定此项，以实际生效值和状态为准。';
    } catch(error) { compatibilityInvalid.set(entry.id,error.message);input.setAttribute('aria-invalid','true');setCompatibilityMessage(error.message,true); }};
    input.addEventListener(input.type==='checkbox'||input.tagName==='SELECT'?'change':'input',changed);
    return input;
  }
  function renderCompatibilityEditor() {
    const isInterfaces=compatibilityKind==='interfaces';setText('compatibility-title',isInterfaces?'手动修改接口':'手动修改其他配置');
    $('compatibility-switch-interfaces').classList.toggle('selected',isInterfaces);$('compatibility-switch-other').classList.toggle('selected',!isInterfaces);
    setText('compatibility-summary',compatibilityView?`配置版本 ${compatibilityView.revision??'待确认'} · ${compatibilityView.applyState==='pending-current-document'?'部分修改等待当前页面采用':'保存值和实际生效值分别展示'}`:'正在读取兼容配置目录…');
    const root=$('compatibility-entries');root.replaceChildren();
    const search=$('compatibility-search').value.trim().toLocaleLowerCase(),onlyIssues=$('compatibility-only-issues').checked;
    const all=compatibilityView?.entries||[],rows=all.filter(entry=>(!onlyIssues||!['valid','verified'].includes(entry.status))&&(!search||[entry.id,entry.name,entry.purpose,entry.group,entry.reason].filter(Boolean).join(' ').toLocaleLowerCase().includes(search)));
    setText('compatibility-count',`当前显示 ${rows.length} / ${all.length} 项`);
    for(const entry of rows) {
      const row=element('section','compatibility-row');row.dataset.compatibilityEntry=entry.id;
      const label=element('div','compatibility-label'),heading=element('div','compatibility-entry-heading'),status=element('span','compatibility-status',compatibilityStatusNames[entry.status]||'待核验');
      status.dataset.status=entry.status||'unknown';heading.append(status,element('strong','',entry.name));label.append(heading,element('p','',entry.purpose||'此项的可用范围以当前核验结果为准。'),element('code','',entry.id));
      // The host alone knows whether a saved override exists. Do not infer
      // automatic/manual mode from a URL, current value, status or provenance.
      const mode=element('small','compatibility-mode',entry.mode==='automatic'?'配置方式：自动跟随':entry.mode==='manual'?'配置方式：手动固定':'配置方式：待确认');
      mode.dataset.mode=['automatic','manual'].includes(entry.mode)?entry.mode:'unknown';label.append(mode);
      if(entry.group)label.append(element('small','',entry.group));if(entry.reason)label.append(element('p','compatibility-reason',entry.reason));
      const fields=element('div','compatibility-fields'),value=compatibilityDrafts.has(entry.id)?compatibilityDrafts.get(entry.id):entry.value,input=compatibilityEntryInput(entry,value);
      fields.append(input,element('small','compatibility-effective','实际生效值：'+(compatibilityValueText(entry.effectiveValue)||'尚未确认')));
      const draftStatus=element('small','compatibility-draft-status',compatibilityDrafts.has(entry.id)?'有未应用修改。':entry.applyState==='pending-current-document'?'已保存，等待当前页面采用。':'');fields.append(draftStatus);
      const source=typeof entry.source==='string'?entry.source:entry.source?.label||entry.source?.url||entry.source?.kind;
      if(source)fields.append(element('small','compatibility-source','来源：'+source));if(entry.help)fields.append(element('small','',entry.help));
      if(entry.readOnly)fields.append(element('small','compatibility-reason','此项由当前公开源码或原生资格决定，只展示核验结果；不能通过填写内容创造游戏未开放的能力。'));
      const actions=element('div','compatibility-row-actions'),probe=element('button','button secondary','自动获取'),apply=element('button','button secondary','保存并应用');
      for(const button of [probe,apply]){button.type='button';button.dataset.compatibilityOperation='true';}
      probe.dataset.compatibilityUnavailable=String(entry.canProbe===false);probe.disabled=compatibilityBusy||entry.canProbe===false;
      apply.dataset.compatibilityUnavailable=String(entry.readOnly===true);apply.disabled=compatibilityBusy||entry.readOnly===true;
      probe.addEventListener('click',()=>compatibilityOperation('probeCompatibility',{id:entry.id},'已重新获取并核验此项；请查看实际生效值。'));
      apply.addEventListener('click',()=>{try {compatibilityOperation('applyCompatibility',{id:entry.id,patch:{[entry.id]:compatibilityInputValue(entry,input)}},'配置已保存；请核对实际生效值。');}catch(error){input.setAttribute('aria-invalid','true');setCompatibilityMessage(error.message,true);}});
      actions.append(probe,apply);fields.append(actions);row.append(label,fields);root.append(row);
    }
    if(!rows.length)root.append(element('p','editor-note',compatibilityView?'没有符合筛选的项目。':'尚未取得目录。可以关闭窗口后重试，其他可用功能不会因本窗口而关闭。'));
    setCompatibilityBusy(compatibilityBusy);
  }
  async function copyCompatibilityPrompt() {
    if(compatibilityBusy)return;const epoch=compatibilityEpoch;setCompatibilityBusy(true);
    try {const response=await command('getCompatibilityPrompt',compatibilityPayload()),text=response?.prompt||response?.text||response?.compatibility?.prompt;
      if(epoch!==compatibilityEpoch)return;if(typeof text!=='string'||!text.trim())throw new Error('未取得可用提示词，请先重试读取目录。');
      $('compatibility-prompt').value=text;await command('copyText',{text});if(epoch===compatibilityEpoch)setCompatibilityMessage('提示词已复制，也显示在下方。发给能访问游戏官网的 AI；只取回配置数据，不需要提供脚本、账号或存档。');
    }catch(error){if(epoch===compatibilityEpoch)setCompatibilityMessage(error.message,true);}finally{if(epoch===compatibilityEpoch)setCompatibilityBusy(false);}
  }
  function collectCompatibilityPatch() {
    if(compatibilityInvalid.size)throw new Error(compatibilityInvalid.values().next().value);
    const patch={};for(const entry of compatibilityView?.entries||[])if(!entry.readOnly&&compatibilityDrafts.has(entry.id)) {
      const input=[...$('compatibility-entries').querySelectorAll('[data-compatibility-id]')].find(node=>node.dataset.compatibilityId===entry.id);
      patch[entry.id]=input?compatibilityInputValue(entry,input):compatibilityDrafts.get(entry.id);
    }return patch;
  }
  function mergeWecomConfig(current,patch) {
    const before=current&&typeof current==='object'&&!Array.isArray(current)?current:{},change=patch&&typeof patch==='object'&&!Array.isArray(patch)?patch:{};
    const result={...before,...change,items:{...before.items},history:{...WECOM_DEFAULTS.history,...before.history,...change.history},network:{...WECOM_DEFAULTS.network,...before.network,...change.network}};
    for(const[id,row]of Object.entries(change.items||{}))if(row&&typeof row==='object'&&!Array.isArray(row))result.items[id]={...before.items?.[id],...row};
    return result;
  }
  function wecomConfig(){const raw=state.config?.wecomPush||WECOM_DEFAULTS;if(raw!==wecomConfigCache.raw){const signature=JSON.stringify(raw);if(signature!==wecomConfigCache.signature)wecomConfigCache={raw,signature,value:mergeWecomConfig(WECOM_DEFAULTS,raw)};else wecomConfigCache.raw=raw;}return wecomConfigCache.value||WECOM_DEFAULTS;}
  function wecomDeliveries(item){const allowed=['instant','interval','fixed','both'];return Array.isArray(item?.delivery)&&item.delivery.some(value=>allowed.includes(value))?item.delivery.filter(value=>allowed.includes(value)):allowed;}
  function wecomItem(id){wecomCatalogItems();const descriptor=wecomCatalogCache.byId.get(id),modes=wecomDeliveries(descriptor),item={enabled:false,delivery:modes[0],intervalMinutes:30,at:'09:00',days:[1,2,3,4,5,6,7],targetId:null,fields:[],filter:'all',includeUnknown:true,minChange:0,direction:'any',objectIds:[],...wecomConfig().items[id]};for(const key of ['fields','days','objectIds'])if(!Array.isArray(item[key]))item[key]=[];if(!modes.includes(item.delivery))item.delivery=modes[0];return item;}
  function wecomSuggestedFields(item){const known=new Set(wecomFields(item).filter(field=>field.availability!==false&&field.availability!=='unavailable').map(field=>field.id));return Array.isArray(item.defaultFields)?[...new Set(item.defaultFields.filter(id=>known.has(id)))]:[];}
  function wecomEnablePatch(item,enabled){const patch={enabled},saved=wecomConfig().items[item.id]||{};if(enabled&&!Object.hasOwn(saved,'fields')&&Array.isArray(item.defaultFields))patch.fields=wecomSuggestedFields(item);if(enabled&&!wecomDeliveries(item).includes(saved.delivery))patch.delivery=wecomDeliveries(item)[0];return patch;}
  function wecomAvailable(item){const v=item?.availability;return v===true||v==='available'||v==='supported'||v?.available===true;}
  function wecomTeamItem(item){return ['teammate','team'].includes(item?.privacy);}
  function wecomSelectable(item){return wecomAvailable(item)&&(!wecomTeamItem(item)||wecomConfig().allowTeamDetails===true);}
  function wecomHasFields(item){const known=new Set(wecomFields(item).filter(field=>field.availability!==false&&field.availability!=='unavailable').map(field=>field.id));return wecomItem(item.id).fields.some(id=>known.has(id));}
  function wecomCatalogItems(){if(wecomCatalogCache.raw!==wecomView.catalog){const items=Array.isArray(wecomView.catalog?.items)?wecomView.catalog.items.filter(row=>row&&typeof row.id==='string'&&typeof row.label==='string'):[];wecomCatalogCache={raw:wecomView.catalog,items,byId:new Map(items.map(item=>[item.id,item]))};}return wecomCatalogCache.items;}
  function wecomFields(item){if(!item||typeof item!=='object')return [];if(!wecomFieldCache.has(item))wecomFieldCache.set(item,(Array.isArray(item.fields)?item.fields:[]).map(row=>typeof row==='string'?{id:row,label:row}:row).filter(row=>row&&typeof row.id==='string'&&typeof row.label==='string'));return wecomFieldCache.get(item);}
  function wecomRuntimeFresh(){return wecomRuntimeRevision===wecomConfigRevision&&wecomRuntimeMetadata===wecomMetadataRevision;}
  function wecomTargetConfigured(item){return wecomView.targets.some(target=>target.id===(wecomItem(item.id).targetId||wecomConfig().targetId)&&target.configured);}
  function wecomEnabledLabel(){const s=wecomConfig();if(s.enabled!==true)return '已关闭';const selected=wecomCatalogItems().filter(row=>wecomSelectable(row)&&wecomItem(row.id).enabled===true&&wecomHasFields(row));if(!selected.length)return '未启动 · 0项有效';const ready=selected.filter(wecomTargetConfigured);if(!ready.length)return '未启动 · 未配目标';if(wecomRuntimeFresh()&&wecomView.runtime.active===true){const count=wecomView.runtime.selectedItems;return `运行中 · ${Number.isInteger(count)&&count>=0&&count<=4096?count:ready.length}项`;}return `已开启 · ${ready.length}项`;}
  function safeWecomText(value){return String(value??'').replace(/https?:\/\/\S+/gi,'[地址已隐藏]').replace(/\bkey=[^\s&]+/gi,'key=[已隐藏]').slice(0,2000);}
  function wecomCount(value){return typeof value==='number'&&Number.isFinite(value)&&value>=0?String(value):'—';}
  function wecomTime(value){const time=dateOf(value);return time?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(time)+' 北京时间':safeWecomText(value||'时间未知');}
  function wecomResultMessage(action,response){if(response?.message)return response.message;if(action==='wecomTest'){const label={success:'企微接口调用成功',failed:'测试未成功',unknown:'测试结果未知',cancelled:'测试已取消',queued:'测试已排队',sending:'测试正在发送'}[response?.state]||'测试请求已处理';return `${label}。${response?.reason||''}${response?.state==='success'?'请到手机群核对；接口成功不代表手机弹窗或已读。':''}`;}return '操作已完成。';}
  function wecomVisible(){return !disposing&&!panelHidden&&activeTab==='convenience'&&convenienceFeature==='wecom';}
  function closeWecomView(){wecomEpoch++;wecomHistoryEpoch++;wecomLoading=false;const input=$('wecom-target-webhook');if(input)input.value='';}
  function applyWecomStatus(response,configRevision=wecomConfigRevision,metadataRevision=wecomMetadataRevision){
    const configCurrent=configRevision===wecomConfigRevision,metadataCurrent=metadataRevision===wecomMetadataRevision;
    if(response?.catalog&&Array.isArray(response.catalog.items))wecomView.catalog={...response.catalog,categories:Array.isArray(response.catalog.categories)?response.catalog.categories:[],items:response.catalog.items.slice(0,5000)};
    if(metadataCurrent&&Array.isArray(response?.targets))wecomView.targets=response.targets.filter(t=>t&&typeof t.id==='string').slice(0,100).map(t=>({id:t.id,name:String(t.name||'未命名目标').slice(0,48),configured:t.configured===true}));
    if(configCurrent&&response?.config&&typeof response.config==='object')receiveState({config:{wecomPush:response.config}});
    if(configCurrent&&metadataCurrent&&response?.runtime&&typeof response.runtime==='object'){wecomView.runtime=Object.fromEntries(['active','selectedItems','queue','lastStatus','sent','failed','unknown','cancelled','overflow','rateWaitSeconds','nextScheduledAt','storageWarning','textOnly','queuePersistence'].filter(key=>['string','number','boolean'].includes(typeof response.runtime[key])).map(key=>[key,response.runtime[key]]));wecomRuntimeRevision=wecomConfigRevision;wecomRuntimeMetadata=wecomMetadataRevision;}
  }
  async function refreshWecomStatus(){
    if(!wecomVisible()||wecomLoading)return;const epoch=wecomEpoch,revision=wecomConfigRevision,metadata=wecomMetadataRevision;wecomLoading=true;renderWecomSettings();
    try{const response=await command('wecomStatus');if(epoch!==wecomEpoch||!wecomVisible())return;applyWecomStatus(response,revision,metadata);}
    catch(error){if(epoch===wecomEpoch)wecomMessageText=safeWecomText(error.message||'推送设置暂不可用，其他功能可继续使用。');}
    finally{if(epoch===wecomEpoch){wecomLoading=false;renderConvenienceSettings();}}
  }
  function saveWecom(patch){wecomConfigRevision++;return saveConfig({wecomPush:patch});}
  function saveWecomItem(id,patch){return saveWecom({items:{[id]:patch}});}
  function wecomBind(input,read,save){input.dataset.wecomControl='';input.__wecomRead=read;input.addEventListener('change',()=>save(input.type==='checkbox'?input.checked:input.value));return input;}
  function wecomCheck(root,id,label,read,save,note=''){
    const row=element('label','wecom-check'),input=document.createElement('input');input.type='checkbox';input.id=id;input.setAttribute('aria-label',label);wecomBind(input,read,save);row.append(input,element('span','',label));root.append(row);if(note)root.append(element('p','editor-note',note));return input;
  }
  function wecomSelect(root,id,label,options,read,save){
    const row=element('label','wecom-input-label',label),input=document.createElement('select');input.id=id;input.setAttribute('aria-label',label);for(const[value,text]of options){const option=element('option','',text);option.value=value;input.append(option);}wecomBind(input,read,save);row.append(input);root.append(row);return input;
  }
  function wecomInput(root,id,label,read,save,{type='text',min,max,step=1,maxLength=100}={}){
    const row=element('label','wecom-input-label',label),input=document.createElement('input');input.id=id;input.type=type;input.maxLength=maxLength;if(min!==undefined)input.min=String(min);if(max!==undefined)input.max=String(max);if(type==='number')input.step=String(step);input.setAttribute('aria-label',label);
    wecomBind(input,read,value=>{if(type==='number'){const n=input.valueAsNumber;if(!Number.isFinite(n)||!Number.isInteger(n)||n<min||n>max){input.setAttribute('aria-invalid','true');showToast(`${label}请输入${min}—${max}之间的整数。`,true);return;}input.setAttribute('aria-invalid','false');save(n);}else save(value);});row.append(input);root.append(row);return input;
  }
  async function wecomAction(action,payload={},key=action){
    if(wecomBusy.has(key))return;const epoch=wecomEpoch,revision=wecomConfigRevision,metadata=['wecomSaveTarget','wecomDeleteTarget'].includes(action)?++wecomMetadataRevision:wecomMetadataRevision;wecomBusy.add(key);renderWecomSettings();
    try{const response=await command(action,payload);if(epoch!==wecomEpoch||!wecomVisible())return;applyWecomStatus(response,revision,metadata);wecomMessageText=safeWecomText(wecomResultMessage(action,response));return response;}
    catch(error){if(epoch===wecomEpoch)wecomMessageText=safeWecomText(error.message||'本次操作失败，请重试。');}
    finally{wecomBusy.delete(key);if(epoch===wecomEpoch)renderConvenienceSettings();}
  }
  function wecomTargetOptions(includeDefault=true){return [...(includeDefault?[['','沿用默认收件目标']]:[['','请选择收件目标']]),...wecomView.targets.map(t=>[t.id,`${t.name}${t.configured?'':' · 需重新配置密钥'}`])];}
  function buildWecomFields(root){
    root.append($('wecom-push-template').content.cloneNode(true));wecomListSignature='';wecomDetailSignature='';wecomTargetSignature='';wecomScopeSignature='';wecomLastRender=null;wecomHistoryRendered=null;
    for(const link of root.querySelectorAll('[data-wecom-official-link]')){link.target='_blank';link.rel='noopener noreferrer';link.addEventListener('click',async event=>{event.preventDefault();try{await command('wecomOpenHelp',{url:link.href});}catch(error){showToast(safeWecomText(error.message),true);}});}
    const global=$('wecom-global-controls');wecomCheck(global,'wecom-enabled','开启企微推送',()=>wecomConfig().enabled,value=>saveWecom({enabled:value}));
    wecomCheck(global,'wecom-observe-manual','手动游玩时也通知',()=>wecomConfig().observeManual,value=>saveWecom({observeManual:value}),'关闭时仅在辅助运行期间观察；停止挂机不等于关闭推送。');
    wecomCheck(global,'wecom-allow-team','允许把已授权的队友明细发送到收件群',()=>wecomConfig().allowTeamDetails,value=>saveWecom({allowTeamDetails:value}),'独立外发许可，默认关闭。不会自动开启队友共享；没有有效共享资料时不推算队友 DPS。');
    wecomInput(global,'wecom-alias','通知别名（可留空）',()=>wecomConfig().alias,value=>{if(/https?:|key=/i.test(value)){showToast('别名请勿填写地址或密钥。',true);return;}saveWecom({alias:value.trim().slice(0,48)});},{maxLength:48});
    wecomSelect(global,'wecom-default-target','默认收件目标',wecomTargetOptions(false),()=>wecomConfig().targetId||'',value=>saveWecom({targetId:value||null}));
    root.querySelectorAll('[data-wecom-tab]').forEach(button=>button.addEventListener('click',()=>{wecomTab=button.dataset.wecomTab;wecomHistoryEpoch++;renderWecomSettings();if(wecomTab==='history')loadWecomHistory(0);}));
    $('wecom-target-form').addEventListener('submit',event=>{
      event.preventDefault();if(wecomBusy.has('target-save'))return;const input=$('wecom-target-webhook'),webhook=input.value.trim(),name=$('wecom-target-name').value.trim(),id=$('wecom-target-id').value,revision=wecomTargetDraftRevision;input.value='';
      if(!name||/https?:|key=/i.test(name)){wecomMessageText='请填写自定义目标名称，不要填地址或密钥。';renderWecomSettings();return;}
      let url;try{url=new URL(webhook);}catch{}if(!url||url.protocol!=='https:'||url.hostname!=='qyapi.weixin.qq.com'||url.pathname!=='/cgi-bin/webhook/send'||url.port||url.hash||url.username||url.password||!url.searchParams.get('key')){wecomMessageText='请重新粘贴完整的企微官方 HTTPS Webhook 地址。输入框已清空。';renderWecomSettings();return;}
      wecomAction('wecomSaveTarget',{...(id?{id}:{}),name,webhook},'target-save').then(response=>{if(response&&revision===wecomTargetDraftRevision&&$('wecom-target-name')){$('wecom-target-id').value='';$('wecom-target-name').value='';}});
    });
    for(const id of ['wecom-target-name','wecom-target-webhook'])$(id).addEventListener('input',()=>wecomTargetDraftRevision++);
    $('wecom-cancel-target').addEventListener('click',()=>{wecomTargetDraftRevision++;for(const id of ['wecom-target-id','wecom-target-name','wecom-target-webhook'])$(id).value='';});
    $('wecom-item-search').value=wecomSearch;$('wecom-item-search').addEventListener('input',event=>{wecomSearch=event.target.value;renderWecomSettings();});
    $('wecom-category').addEventListener('change',event=>{wecomCategory=event.target.value;renderWecomSettings();});
    $('wecom-only-enabled').checked=wecomOnlyEnabled;$('wecom-only-enabled').addEventListener('change',event=>{wecomOnlyEnabled=event.target.checked;renderWecomSettings();});
    $('wecom-only-modified').checked=wecomOnlyModified;$('wecom-only-modified').addEventListener('change',event=>{wecomOnlyModified=event.target.checked;renderWecomSettings();});
    $('wecom-enable-visible').addEventListener('click',()=>{const entries=wecomFilteredItems().filter(wecomSelectable);if(entries.length)saveWecom({items:Object.fromEntries(entries.map(row=>[row.id,wecomEnablePatch(row,true)]))});});
    $('wecom-disable-all').addEventListener('click',()=>saveWecom({items:Object.fromEntries(Object.keys(wecomConfig().items).map(id=>[id,{enabled:false}]))}));
    const advanced=$('wecom-advanced-controls');
    wecomSelect(advanced,'wecom-history-mode','本地历史保留',[['count','最近 N 条'],['days','最近 N 天'],['both','条数与天数'],['permanent','永久保留（受容量上限约束）'],['summary','仅留摘要'],['none','不保留已结束历史']],()=>wecomConfig().history.mode,value=>saveWecom({history:{mode:value}}));
    for(const[key,label,min,max]of [['count','历史条数',1,100000],['days','历史天数',1,3650],['maxMiB','历史容量上限（MiB）',1,1024]])wecomInput(advanced,'wecom-history-'+key,label,()=>wecomConfig().history[key],value=>saveWecom({history:{[key]:value}}),{type:'number',min,max});
    wecomInput(advanced,'wecom-network-timeout','请求超时（秒）',()=>wecomConfig().network.timeoutSeconds,value=>saveWecom({network:{timeoutSeconds:value}}),{type:'number',min:3,max:60});
    wecomInput(advanced,'wecom-network-retries','明确临时失败最多重试次数',()=>wecomConfig().network.retries,value=>saveWecom({network:{retries:value}}),{type:'number',min:0,max:3});
    wecomSelect(advanced,'wecom-network-proxy','网络代理',[['system','沿用系统代理'],['direct','直连']],()=>wecomConfig().network.proxy,value=>saveWecom({network:{proxy:value}}));
    $('wecom-status-refresh').addEventListener('click',refreshWecomStatus);
    $('wecom-history-refresh').addEventListener('click',()=>loadWecomHistory(wecomHistory.offset));$('wecom-history-state').addEventListener('change',()=>loadWecomHistory(0));
    $('wecom-history-prev').addEventListener('click',()=>loadWecomHistory(Math.max(0,wecomHistory.offset-wecomHistory.limit)));$('wecom-history-next').addEventListener('click',()=>loadWecomHistory(wecomHistory.offset+wecomHistory.limit));
    $('wecom-history-export').addEventListener('click',()=>wecomAction('wecomExportHistory',{filters:wecomHistoryFilters()}));
    $('wecom-clear-history').addEventListener('click',()=>wecomAction('wecomClearHistory').then(response=>{if(response){wecomHistory={entries:[],total:0,offset:0,limit:50};renderWecomHistory();}}));
    $('wecom-clear-queue').addEventListener('click',()=>wecomAction('wecomClearQueue'));$('wecom-open-directory').addEventListener('click',()=>wecomAction('wecomOpenDirectory'));
    renderWecomSettings();
  }
  function wecomFilteredItems(){const needle=wecomSearch.trim().toLocaleLowerCase();return wecomCatalogItems().filter(row=>(!wecomCategory||String(row.category)===wecomCategory)&&(!wecomOnlyEnabled||wecomItem(row.id).enabled===true)&&(!wecomOnlyModified||Object.keys(wecomConfig().items[row.id]||{}).some(key=>key!=='enabled'||wecomConfig().items[row.id].enabled===true))&&(!needle||[row.label,row.categoryLabel,row.source,row.id,...wecomFields(row).map(field=>field.label)].join(' ').toLocaleLowerCase().includes(needle)));}
  function renderWecomItems(){
    const catalogItems=wecomCatalogItems(),categoryNames=new Map((wecomView.catalog.categories||[]).map(row=>[String(row.id),String(row.label)])),categories=new Map(catalogItems.map(row=>[String(row.category||'other'),String(row.categoryLabel||categoryNames.get(String(row.category))||row.category||'其他')])),$category=$('wecom-category');
    const categorySignature=JSON.stringify([...categories]);if($category.dataset.signature!==categorySignature){$category.replaceChildren(element('option','','全部分类'));$category.firstChild.value='';for(const[id,label]of categories){const node=element('option','',label);node.value=id;$category.append(node);}$category.dataset.signature=categorySignature;}$category.value=wecomCategory;
    const rows=wecomFilteredItems(),signature=JSON.stringify([rows,wecomSelectedItem,wecomConfig().allowTeamDetails,rows.map(row=>wecomItem(row.id).enabled)]);
    setText('wecom-selection-scope',`当前筛选 ${rows.length} 项；批量启用只影响这些项目，首次采用本版本建议字段，已有明确字段选择不改，也不会开启总开关。未来新增项目与字段不自动扩大外发范围。`);
    $('wecom-enable-visible').disabled=!rows.some(wecomSelectable);
    if(signature!==wecomListSignature){wecomListSignature=signature;const list=$('wecom-item-list');list.replaceChildren();for(const row of rows){const card=element('div','wecom-item-card'),toggle=document.createElement('input'),button=element('button','wecom-item-button',row.label);toggle.type='checkbox';toggle.checked=wecomItem(row.id).enabled===true;toggle.disabled=!wecomSelectable(row);toggle.setAttribute('aria-label','启用'+row.label);toggle.dataset.wecomItemId=row.id;toggle.addEventListener('change',()=>saveWecomItem(row.id,wecomEnablePatch(row,toggle.checked)));button.type='button';button.dataset.wecomItemId=row.id;button.classList.toggle('selected',wecomSelectedItem===row.id);button.addEventListener('click',()=>{wecomSelectedItem=row.id;wecomDetailSignature='';renderWecomSettings();});card.append(toggle,button,element('small','',wecomTeamItem(row)&&wecomConfig().allowTeamDetails!==true?'需独立允许队友明细外发':wecomAvailable(row)?String(row.categoryLabel||row.category||'可用'):safeWecomText(row.reason||row.availability?.reason||'当前来源不可用')));list.append(card);}if(!rows.length)list.append(element('p','editor-note',wecomLoading?'正在读取可选项目…':'没有符合筛选条件的项目；目录暂不可用时其他客户端功能仍可正常使用。'));}
    const selected=catalogItems.find(row=>row.id===wecomSelectedItem),detailSignature=JSON.stringify([selected,wecomView.targets,wecomConfig().allowTeamDetails]);
    if(detailSignature!==wecomDetailSignature){wecomDetailSignature=detailSignature;const root=$('wecom-item-detail');root.replaceChildren();if(selected)buildWecomItemDetail(root,selected);else root.append(element('p','editor-note help-note','点击左侧项目查看来源、字段及独立发送计划。勾选项目不会自动选择它的所有字段。'));}
  }
  function buildWecomItemDetail(root,item){
    const id=item.id,read=()=>wecomItem(id),save=patch=>saveWecomItem(id,patch),phase={saved:'存档保存已确认',observed:'当前已观察',run:'本局状态',receipt:'原生回执已确认',submitted:'已提交，尚未确认结果',candidate:'候选已出现'}[item.phase]||item.phase||'以每条通知中的确认状态为准',source=item.source?.label||(typeof item.source==='string'?item.source:item.producer==='host'?'客户端正常流程取得的可信资料或回执':item.producer==='game'?'原生对局已有的可读状态或事件':'已登记的可读来源');root.append(element('h4','',item.label));root.append(element('p','editor-note',`来源：${safeWecomText(source)}。事实阶段：${safeWecomText(phase)}。${safeWecomText(item.reason||'')}`));
    if(!wecomAvailable(item))root.append(element('p','wecom-notice',safeWecomText(item.reason||item.availability?.reason||'当前来源不可用，不会采集。')));
    if(wecomTeamItem(item))root.append(element('p','wecom-notice','这是队友明细外发项目。须另行勾选上方许可，且原生共享数据确实可用；不会自动开启共享。'));
    const enabled=wecomCheck(root,'wecom-item-enabled','开启此项目',()=>read().enabled,value=>save(wecomEnablePatch(item,value)));enabled.disabled=!wecomSelectable(item);
    const suggested=wecomSuggestedFields(item).map(id=>wecomFields(item).find(field=>field.id===id)?.label).filter(Boolean);if(suggested.length){root.append(element('p','editor-note',`尚无字段配置时，首次开启采用建议字段：${suggested.join('、')}。已有字段配置（包括全不选）不会被覆盖，也可主动点击下方按钮采用建议。`));const button=element('button','button secondary','采用建议字段');button.id='wecom-apply-suggested';button.type='button';button.addEventListener('click',()=>save({fields:wecomSuggestedFields(item)}));root.append(button);}
    wecomSelect(root,'wecom-item-delivery','发送方式',[['instant','有事件即时发送'],['interval','按间隔汇总'],['fixed','固定北京时间'],['both','即时并列入间隔汇总']].filter(([value])=>wecomDeliveries(item).includes(value)),()=>read().delivery,value=>save({delivery:value}));
    wecomInput(root,'wecom-item-interval','汇总间隔（分钟）',()=>read().intervalMinutes,value=>save({intervalMinutes:value}),{type:'number',min:1,max:10080}).parentElement.dataset.wecomSchedule='interval';
    const presets=element('div','wecom-actions');presets.dataset.wecomSchedule='interval';for(const n of [5,15,30,60,120]){const button=element('button','button secondary',`${n}分钟`);button.type='button';button.addEventListener('click',()=>save({intervalMinutes:n}));presets.append(button);}root.append(presets);
    wecomInput(root,'wecom-item-at','固定时刻（北京时间）',()=>read().at,value=>{if(/^([01]\d|2[0-3]):[0-5]\d$/.test(value))save({at:value});},{type:'time'}).parentElement.dataset.wecomSchedule='fixed';
    const dayNote=element('p','editor-note help-note','定时仅汇总观察到的变化，无变化不发送；星期仅用于固定北京时间，未勾选星期不发送，切换方式保留选择。');dayNote.dataset.wecomSchedule='fixed';root.append(dayNote);const days=element('div','wecom-weekdays');days.dataset.wecomSchedule='fixed';for(let day=1;day<=7;day++)wecomCheck(days,`wecom-item-day-${day}`,['周一','周二','周三','周四','周五','周六','周日'][day-1],()=>read().days.includes(day),on=>save({days:on?[...new Set([...read().days,day])].sort():read().days.filter(n=>n!==day)}));root.append(days);
    wecomSelect(root,'wecom-item-target','此项目收件目标',wecomTargetOptions(),()=>read().targetId||'',value=>save({targetId:value||null}));
    const fields=element('fieldset','wecom-field-list');fields.append(element('legend','','外发字段（未勾选不额外读取）'));
    for(const field of wecomFields(item)){const input=wecomCheck(fields,'wecom-field-'+fields.children.length,field.label,()=>read().fields.includes(field.id),on=>save({fields:on?[...new Set([...read().fields,field.id])]:read().fields.filter(key=>key!==field.id)}));input.dataset.wecomFieldId=field.id;if(field.availability===false||field.availability==='unavailable'){input.disabled=true;input.title=safeWecomText(field.reason||'当前字段不可用');}}
    root.append(fields);root.append(element('p','editor-note help-note','未选字段时，本项目不采集或发送。想知道捕获了谁，请保留公开物种字段，数量字段可说明次数。新、重复、未知和保存确认分开；缺资料不填零。'));
    const more=element('details','wecom-item-advanced');more.append(element('summary','','筛选与变化条件'));
    wecomSelect(more,'wecom-item-filter','新旧筛选',[['all','全部'],['new','仅新增或首次'],['repeat','仅重复'],['unknown','仅无法核实']],()=>read().filter,value=>save({filter:value}));
    wecomCheck(more,'wecom-item-include-unknown','筛选时也保留无法核实的记录',()=>read().includeUnknown,value=>save({includeUnknown:value}));
    wecomSelect(more,'wecom-item-direction','数值变化方向',[['any','任意变化'],['increase','增加'],['decrease','减少']],()=>read().direction,value=>save({direction:value}));
    wecomInput(more,'wecom-item-min-change','最小变化量（0表示不限制）',()=>read().minChange,value=>save({minChange:value}),{type:'number',min:0,max:1000000000});
    if(item.objectFilter!==false)wecomInput(more,'wecom-item-object-ids','仅这些公开对象ID（逗号分隔，留空为全部）',()=>read().objectIds.join(', '),value=>{const ids=value.split(/[,，\s]+/).filter(Boolean);if(ids.length>100||ids.some(key=>!/^[A-Za-z0-9_.:+-]{1,100}$/.test(key))){showToast('对象ID最多100个，只填目录中的稳定公开ID，不填账号信息。',true);return;}save({objectIds:[...new Set(ids)]});},{maxLength:2000});
    more.append(element('p','editor-note help-note','过滤按实际公开对象ID处理；不会为推送额外查榜或拉取云端资料。只能采样的项目可能错过采样之间的瞬时变化，精度以来源说明为准。'));root.append(more);
  }
  function renderWecomTargets(){
    const signature=JSON.stringify(wecomView.targets);if(signature===wecomTargetSignature)return;wecomTargetSignature=signature;
    const root=$('wecom-targets');root.replaceChildren();for(const target of wecomView.targets){const row=element('div','wecom-target-row');row.append(element('strong','',target.name),element('span','',target.configured?'密钥已配置':'需要重新配置密钥'));
      for(const[action,label]of [['edit','改名称 / 密钥'],['test','发送测试通知'],['delete','删除目标与密钥']]){const button=element('button','button secondary',label);button.type='button';button.dataset.wecomTargetAction=action;button.dataset.targetId=target.id;
        button.addEventListener('click',()=>{if(action==='edit'){wecomTargetDraftRevision++;$('wecom-target-id').value=target.id;$('wecom-target-name').value=target.name;$('wecom-target-webhook').value='';$('wecom-target-webhook').focus();}else if(action==='test')wecomAction('wecomTest',{id:target.id},'test:'+target.id);else wecomAction('wecomDeleteTarget',{id:target.id},'delete:'+target.id);});row.append(button);}root.append(row);}
    if(!wecomView.targets.length)root.append(element('p','editor-note','尚未配置收件目标。添加和试发均不要求登录游戏。'));
    const select=$('wecom-default-target'),current=wecomConfig().targetId||'';select.replaceChildren();for(const[value,text]of wecomTargetOptions(false)){const option=element('option','',text);option.value=value;select.append(option);}select.value=current;
  }
  function wecomHistoryFilters(){return {state:$('wecom-history-state')?.value||''};}
  async function loadWecomHistory(offset=0){
    if(!wecomVisible()||wecomTab!=='history')return;const epoch=wecomEpoch,historyEpoch=++wecomHistoryEpoch;setText('wecom-action-status','正在读取本机推送历史…');
    try{const response=await command('wecomHistory',{offset:Math.max(0,offset),limit:50,filters:wecomHistoryFilters()});if(epoch!==wecomEpoch||historyEpoch!==wecomHistoryEpoch||!wecomVisible()||wecomTab!=='history')return;
      wecomHistory={entries:Array.isArray(response?.entries)?response.entries.slice(0,50):[],total:Math.max(0,Number(response?.total)||0),offset:Math.max(0,Number(response?.offset)||0),limit:50};wecomMessageText=safeWecomText(response?.message||'');renderWecomHistory();setText('wecom-action-status',wecomMessageText);
    }catch(error){if(epoch===wecomEpoch&&historyEpoch===wecomHistoryEpoch){wecomMessageText=safeWecomText(error.message);setText('wecom-action-status',wecomMessageText);}}
  }
  function renderWecomHistory(){
    const root=$('wecom-history-list');if(!root||!wecomVisible()||wecomTab!=='history'||wecomHistoryRendered===wecomHistory)return;wecomHistoryRendered=wecomHistory;root.replaceChildren();const labels={queued:'等待发送',sending:'发送中',success:'接口调用成功',failed:'明确失败',unknown:'结果未知',cancelled:'已取消',merged:'已合并'};
    for(const row of wecomHistory.entries){const node=element('article','wecom-history-entry');node.append(element('strong','',`${labels[row.state]||'未知状态'} · ${String(row.targetName||'收件目标').slice(0,60)}`),element('p','editor-note',`${wecomTime(row.at)} · 通知组 ${safeWecomText(row.groupId||row.id||'')} · ${Number(row.part)||1}/${Number(row.parts)||1} · 尝试 ${Number(row.attempts)||0} 次`));if(row.body)node.append(element('pre','',safeWecomText(row.body)));if(row.reason)node.append(element('p','editor-note',safeWecomText(row.reason)));root.append(node);}
    if(!wecomHistory.entries.length)root.append(element('p','editor-note','当前筛选没有本机推送历史。接口成功不是手机送达或已读证明。'));
    setText('wecom-history-page-label',`${wecomHistory.total?Math.floor(wecomHistory.offset/50)+1:0} / ${Math.ceil(wecomHistory.total/50)} 页 · ${wecomHistory.total} 条`);$('wecom-history-prev').disabled=wecomHistory.offset<=0;$('wecom-history-next').disabled=wecomHistory.offset+50>=wecomHistory.total;
  }
  function renderWecomSettings(){
    if(!$('wecom-enabled')||!wecomVisible())return;const s=wecomConfig(),uiKey=JSON.stringify([wecomConfigRevision,wecomMetadataRevision,wecomRuntimeFresh(),wecomLoading,[...wecomBusy],wecomTab,wecomSelectedItem,wecomSearch,wecomCategory,wecomOnlyEnabled,wecomOnlyModified,wecomMessageText]),references=[s,wecomView.catalog,wecomView.targets,wecomView.runtime,wecomHistory];if(wecomLastRender?.key===uiKey&&references.every((value,index)=>value===wecomLastRender.references[index]))return;wecomLastRender={key:uiKey,references};const selected=wecomCatalogItems().filter(item=>wecomItem(item.id).enabled===true),targets=[...new Set(selected.map(item=>wecomItem(item.id).targetId||s.targetId))].map(id=>wecomView.targets.find(t=>t.id===id)?.name||'未配置目标');
    const effective=selected.filter(item=>wecomSelectable(item)&&wecomHasFields(item)&&wecomTargetConfigured(item)),emptyFields=selected.filter(item=>!wecomHasFields(item)).length;setText('wecom-startup-status',`${wecomLoading?'正在读取本机配置… ':''}${wecomEnabledLabel()}。已勾选 ${selected.length} 项，其中 ${effective.length} 项已选字段、具备许可且收件目标已配置；收件：${targets.length?targets.join('、'):'未选择'}。${emptyFields?`${emptyFields}项未选字段，不采集或发送。`:''}${s.enabled&&!effective.length?'目前不会启动自动采集或发送。':''}`);
    const scope=$('wecom-scope'),scopeRows=selected.map(item=>{const fields=wecomItem(item.id).fields.map(id=>wecomFields(item).find(field=>field.id===id)?.label||id);return `${item.label}：${fields.length?fields.join('、'):'未选字段，本项目不采集或发送'}`;}),scopeSignature=JSON.stringify(scopeRows);if(scope&&scopeSignature!==wecomScopeSignature){wecomScopeSignature=scopeSignature;scope.replaceChildren();for(const text of scopeRows)scope.append(element('li','',text));if(!scopeRows.length)scope.append(element('li','','尚未选择任何外发项目。'));}
    for(const tab of ['settings','history','diagnostics']){$('wecom-'+tab+'-page').hidden=wecomTab!==tab;document.querySelector(`[data-wecom-tab="${tab}"]`)?.setAttribute('aria-pressed',String(wecomTab===tab));}
    renderWecomTargets();if(wecomTab==='settings')renderWecomItems();
    for(const input of document.querySelectorAll('#convenience-fields [data-wecom-control]')){const value=input.__wecomRead?.();if(input.type==='checkbox')input.checked=value===true;else if(document.activeElement!==input)input.value=value??'';}
    const delivery=wecomSelectedItem?wecomItem(wecomSelectedItem).delivery:'instant';for(const row of document.querySelectorAll('[data-wecom-schedule]'))row.hidden=row.dataset.wecomSchedule==='fixed'?delivery!=='fixed':row.dataset.wecomSchedule==='interval'?!['interval','both'].includes(delivery):delivery==='instant';
    const r=wecomRuntimeFresh()?wecomView.runtime:{lastStatus:'设置已变化，运行状态待手动查询确认'},parts=[`自动状态：${wecomRuntimeFresh()?(r.active===true?'运行中':'未运行或等待条件'):'待确认'}`,`待发 ${wecomCount(r.queue)}`,`接口成功 ${wecomCount(r.sent)}`,`明确失败 ${wecomCount(r.failed)}`,`结果未知 ${wecomCount(r.unknown)}`,`已取消 ${wecomCount(r.cancelled)}`,`容量溢出 ${wecomCount(r.overflow)}`,r.nextScheduledAt?`下次计划：${wecomTime(r.nextScheduledAt)}`:'',Number(r.rateWaitSeconds)>0?`平台限频等待 ${r.rateWaitSeconds} 秒`:'',r.lastStatus?safeWecomText(r.lastStatus):'',r.storageWarning?safeWecomText(r.storageWarning):''].filter(Boolean);setText('wecom-diagnostics',parts.join('；')+'。仅文字推送；退出不重放队列。');
    $('wecom-save-target').disabled=wecomBusy.has('target-save');for(const button of document.querySelectorAll('[data-wecom-target-action]'))button.disabled=wecomBusy.has(button.dataset.wecomTargetAction+':'+button.dataset.targetId);
    setText('wecom-action-status',wecomMessageText);if(wecomTab==='history')renderWecomHistory();
  }
  function mergeConfigPatch(current, patch) {
    const before = current || {}, changes = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
    const result = { ...before, ...changes,
      unlockTargets: { ...before.unlockTargets, ...(changes.unlockTargets || {}) },
      eventTargets: { ...before.eventTargets, ...(changes.eventTargets || {}) },
      finalReplacements: mergeFinalReplacementPatch(before.finalReplacements, changes.finalReplacements) };
    Object.assign(result,flightInteractionSettings(result,changes));
    Object.assign(result,costInteractionSettings(result));
    Object.assign(result,timedMovementSettings(result));
    result.shopPriority = typeof changes.shopPriority === 'boolean' ? changes.shopPriority : before.shopPriority === true;
    if(Object.hasOwn(changes,'wecomPush'))result.wecomPush=mergeWecomConfig(before.wecomPush,changes.wecomPush);
    if (before.modeSettings || changes.modeSettings) result.modeSettings = { ...before.modeSettings,
      ...Object.fromEntries(Object.entries(changes.modeSettings || {}).filter(([,value]) => value && typeof value === 'object' && !Array.isArray(value))
        .map(([mode,value]) => [mode, { ...before.modeSettings?.[mode], ...value }])) };
    if (before.overlay || changes.overlay) {
      result.overlay = { ...before.overlay, ...changes.overlay, fields: { ...before.overlay?.fields, ...changes.overlay?.fields } };
      if (before.overlay?.team || changes.overlay?.team) result.overlay.team = { ...before.overlay?.team, ...changes.overlay?.team,
        fields: { ...before.overlay?.team?.fields, ...changes.overlay?.team?.fields } };
    }
    if (before.display || changes.display) result.display = {...before.display,...changes.display};
    if (before.convenience || changes.convenience) {
      result.convenience={...before.convenience,...changes.convenience};
      for(const [group,patch] of Object.entries(changes.convenience || {})) if(patch && typeof patch==='object' && !Array.isArray(patch)) {
        result.convenience[group]={...before.convenience?.[group],...patch};
        if(group==='alerts' && patch.events) result.convenience.alerts.events={...before.convenience?.alerts?.events,...patch.events};
      }
    }
    return result;
  }
  function configEntryPatch(config,entry) {
    if(!entry.costPriorityEdits&&!entry.wecomArrayEdits&&!entry.towerPriorityEdits)return entry.patch;
    const patch=structuredClone(entry.patch);
    if(entry.costPriorityEdits){const priorities=costInteractionSettings(config).costEffectPriorities;for(const [index,value] of Object.entries(entry.costPriorityEdits))priorities[Number(index)]=value;patch.costEffectPriorities=priorities;}
    if(entry.towerPriorityEdits){patch.modeSettings||={};patch.modeSettings.tower||={};const before=towerStrategySettings(config.modeSettings?.tower);for(const[field,edits]of Object.entries(entry.towerPriorityEdits)){const values=[...before[field]];for(const[index,value]of Object.entries(edits))values[Number(index)]=value;patch.modeSettings.tower[field]=values;}}
    for(const[id,fields]of Object.entries(entry.wecomArrayEdits||{}))for(const[key,edit]of Object.entries(fields)){const prior=config.wecomPush?.items?.[id]?.[key],values=(Array.isArray(prior)?prior:key==='days'?[1,2,3,4,5,6,7]:[]).filter(value=>!edit.remove.includes(value));patch.wecomPush.items[id][key]=[...new Set([...values,...edit.add])];}
    return patch;
  }
  function pendingConfig() { return pendingConfigWrites.reduce((config, entry) => mergeConfigPatch(config, configEntryPatch(config,entry)), confirmedConfig || currentConfig()); }
  async function flushConfigWrites() {
    const failures = configFailureCount;
    while (pendingConfigWrites.length) await configWriteTail;
    if (configFailureCount !== failures) throw new Error('设置保存未完成，尚未开始挂机。请核对当前设置后重试。');
  }
  async function saveConfig(patch) {
    const before = currentConfig();
    if(patch.flightNoInteractions===true)patch={...patch,flightKeepInteractions:false};
    else if(patch.flightKeepInteractions===true)patch={...patch,flightNoInteractions:false};
    if (patch.mode && patch.mode !== 'shiny') shinyPickerDraft = false;
    // New target selection is authoritative. Older shiny controls migrate
    // into that same selection rather than maintaining a second goal.
    if (Object.hasOwn(patch.unlockTargets || {}, 'shiny')) {
      shinyPickerDraft = false;
      const id = String(patch.unlockTargets.shiny || 'auto');
      patch = { ...patch, shinyMode: id === 'auto' ? 'missing' : 'target', shinyTargetId: /^shiny:\d+$/.test(id) ? Number(id.slice(6)) : null };
    } else if (Object.hasOwn(patch, 'shinyMode') || Object.hasOwn(patch, 'shinyTargetId')) {
      const mode = patch.shinyMode ?? before.shinyMode, id = patch.shinyTargetId ?? before.shinyTargetId;
      if (mode === 'missing' || Number(id) > 0) patch = { ...patch, shinyTargetId: mode === 'missing' ? null : Number(id), unlockTargets: { shiny: mode === 'missing' ? 'auto' : `shiny:${Number(id)}` } };
    }
    if (!pendingConfigWrites.length) confirmedConfig = before;
    const entry = { sequence: ++configSequence, patch: structuredClone(patch) };
    if(Object.hasOwn(patch,'costEffectPriorities'))entry.costPriorityEdits=Object.fromEntries(costInteractionSettings(patch).costEffectPriorities
      .flatMap((value,index)=>value!==before.costEffectPriorities[index]?[[index,value]]:[]));
    for(const[field]of TOWER_PRIORITIES)if(Array.isArray(patch.modeSettings?.tower?.[field])){const prior=towerStrategySettings(before.modeSettings?.tower)[field],next=towerStrategySettings(patch.modeSettings.tower)[field];entry.towerPriorityEdits||={};entry.towerPriorityEdits[field]=Object.fromEntries(next.flatMap((value,index)=>value!==prior[index]?[[index,value]]:[]));}
    for(const[id,row]of Object.entries(patch.wecomPush?.items||{}))for(const key of ['fields','days','objectIds'])if(Array.isArray(row?.[key])){const old=before.wecomPush?.items?.[id]?.[key],prior=Array.isArray(old)?old:key==='days'?[1,2,3,4,5,6,7]:[];entry.wecomArrayEdits||={};entry.wecomArrayEdits[id]||={};entry.wecomArrayEdits[id][key]={add:row[key].filter(value=>!prior.includes(value)),remove:prior.filter(value=>!row[key].includes(value))};}
    pendingConfigWrites.push(entry);
    state.config = pendingConfig();
    renderConfig();
    renderOverview();
    renderClientStage();
    renderFooter();
    if (patch.mode) requestAnimationFrame(() => $('mode-configuration').scrollIntoView({ block: 'start', behavior: 'smooth' }));
    showSaved('保存中…');
    // Keep transport ordered, while the whole pending patch list remains
    // visible over native status pushes and earlier acknowledgements. A failed
    // write removes only itself, rather than rolling back a newer edit.
    const save = configWriteTail.then(async () => {
      let saved = false;
      try {
        if (disposing) return false;
        const transportPatch=configEntryPatch(confirmedConfig,entry);
        const response = await command('config', transportPatch);
        confirmedConfig = mergeConfigPatch(confirmedConfig, response?.config || response?.state?.config || transportPatch);
        saved = true;
      } catch (error) {
        configFailureCount++; showToast(error.message, true);
      } finally {
        const index = pendingConfigWrites.indexOf(entry); if (index >= 0) pendingConfigWrites.splice(index, 1);
        state.config = pendingConfig();
        if (!disposing) { renderConfig(); renderOverview(); renderFooter(); showSaved(pendingConfigWrites.length ? '保存中…' : saved ? '已保存' : '保存失败', !saved && !pendingConfigWrites.length); }
      }
      return saved;
    });
    configWriteTail = save;
    return save;
  }

  function showTab(id) {
    if (!$( `page-${id}` )) return;
    if(activeTab==='convenience'&&id!=='convenience')closeWecomView();
    if (activeTab === 'account' && id !== 'account') {
      maskRecoveryLogin();
      if (recoveryLoginRevision !== recoveryLoginSavedRevision) flushRecoveryLogin();
      else clearRecoveryLoginInputs();
    }
    const enteringEncyclopedia = id === 'encyclopedia' && activeTab !== id;
    if (activeTab === 'skins' && id !== 'skins') { stopSkinPreview(); cancelPendingSkinPreview(true); }
    activeTab = id;
    document.querySelectorAll('.tab').forEach((node) => {
      const selected = node.dataset.tab === id;
      node.classList.toggle('active', selected);
      node.setAttribute('aria-selected', String(selected));
      node.tabIndex = selected ? 0 : -1;
    });
    document.querySelectorAll('.page').forEach((node) => {
      const selected = node.id === `page-${id}`;
      node.hidden = !selected;
      node.classList.toggle('active', selected);
    });
    if (id === 'logs') { retryFailedLogPage(); renderLogs(true); }
    if (id === 'modes') renderUnlockTargets(true);
    if (id === 'characters') renderCharacters(true);
    if (id === 'plans') renderCustomPlans(true);
    if (id === 'maintenance') renderMaintenance();
    if (id === 'account') renderRecoveryLogin();
    if (id === 'skins') { renderSkins(); if (!skinsLoaded && !skinsBusy) refreshSkins(); }
    if(id==='convenience'&&convenienceFeature==='wecom')refreshWecomStatus();
    if (id === 'encyclopedia') {
      renderEncyclopedia();
      if (enteringEncyclopedia) {
        const previous = expanded; setExpanded(true);
        command('expand', { expanded: true, encyclopedia: true }).catch((error) => { setExpanded(previous); showToast(error.message, true); });
      }
    }
  }

  function receiveCatalog(next) {
    if (!next || typeof next !== 'object' || Array.isArray(next) ||
      Object.hasOwn(next,'characters') && (!Array.isArray(next.characters)||!next.characters.length) ||
      Array.isArray(next.characters) && (!next.characters.every(char=>char && typeof char==='object' &&
        Number.isInteger(Number(characterIdOf(char))) && Number(characterIdOf(char))>0) ||
        new Set(next.characters.map(char=>String(characterIdOf(char)))).size!==next.characters.length) ||
      !catalogLoaded && !Array.isArray(next.characters) ||
      Object.hasOwn(next,'maps') && (!Array.isArray(next.maps)||!next.maps.length)) {
      retryCatalogSync();return false;
    }
    catalog = { ...catalog, ...next };
    catalog.characters = Array.isArray(catalog.characters) ? catalog.characters : [];
    catalog.builds = Array.isArray(catalog.builds) ? catalog.builds : [];
    catalog.maps = Array.isArray(catalog.maps) ? catalog.maps : [];
    catalogGeneration++; buildIndex = mergedBuildCache = null;
    shinySignature = '';
    unlockTargetsSignature = '';
    unlockSearchIndex.clear();
    catalogLoaded = true;
    catalogRetryCount=0;clearTimeout(catalogRetryTimer);catalogRetryTimer=null;
    if (panelHidden) { panelCatalogDirty = true; return true; }
    indexEncyclopedia();
    renderModes();
    renderMaps();
    if (Array.isArray(catalog.difficulties) && catalog.difficulties.length) {
      $('tier-select').replaceChildren(new Option('自动选择', 'auto'));
      for (const entry of catalog.difficulties) {
        const id = String(first(entry.tier, entry.id, 0));
        if (id !== 'auto') $('tier-select').add(new Option(nameOf(entry.name || entry.label, entry.id), id));
      }
    }
    renderCharacters(true);
    renderConfig();
    renderOverview();
    renderClientStage();
    if (activeTab === 'plans') renderCustomPlans(true);
    return true;
  }
  async function refreshCatalog() {
    if (typeof bridge?.getCatalog !== 'function') return;
    if (catalogRefreshPending) { catalogRefreshQueued = true; return; }
    catalogRefreshPending = true;
    renderClientStage();
    try { receiveCatalog(await bridge.getCatalog()); }
    catch { retryCatalogSync(); }
    finally { catalogRefreshPending = false; renderClientStage(); if (catalogRefreshQueued) { catalogRefreshQueued = false; refreshCatalog(); } }
  }
  function receiveState(next) {
    if (!next || typeof next !== 'object') return;
    const previousWecom=state.config?.wecomPush;
    let customPlansChanged=false;
    if(Array.isArray(next.customPlans)) {
      const signature=JSON.stringify(next.customPlans);
      customPlansChanged=signature!==receivedCustomPlansSignature;
      receivedCustomPlansSignature=signature;
      if(customPlansChanged) { characterSignature=''; buildDetailsSignature=''; mergedBuildCache=null; }
    }
    stateRetryCount=0;clearTimeout(stateRetryTimer);stateRetryTimer=null;
    stateLoaded = true;
    confirmedConfig = mergeConfigPatch(confirmedConfig || currentConfig(), next.config);
    state = { ...state, ...next, config: pendingConfig() };
    if(Object.hasOwn(next.config||{},'wecomPush')&&JSON.stringify(previousWecom)!==JSON.stringify(state.config.wecomPush))wecomConfigRevision++;
    if (Object.hasOwn(next, 'enabled') && !Object.hasOwn(next, 'running')) state.running = Boolean(next.enabled);
    state.game = state.game && typeof state.game === 'object' ? state.game : {};
    state.session = state.session && typeof state.session === 'object' ? state.session : {};
    if (Array.isArray(next.logs)) logs = next.logs.filter(isConciseLog).slice(-2000);
    if (normalizedRunning() && !normalizedPaused()) pendingConnectionAction = '';
    stateReceivedAt = Date.now();
    elapsedAtReceive = numeric(first(state.session.elapsedSeconds, state.session.durationSeconds, state.session.elapsed, state.session.duration));
    if (panelVisibilityPending === null && next.panelHidden !== undefined) setPanelHidden(Boolean(next.panelHidden));
    if (panelVisibilityPending === null && next.expanded !== undefined && expanded !== Boolean(next.expanded)) setExpanded(Boolean(next.expanded));
    if (panelHidden) { renderPanelStrip(); if (next.catalogRevision !== undefined && String(next.catalogRevision) !== catalogRevisionSeen) panelCatalogDirty = true; return; }
    if (next.skinRuntime && typeof next.skinRuntime === 'object' && JSON.stringify(next.skinRuntime) !== JSON.stringify(skinRuntime)) { skinRuntime = next.skinRuntime; renderSkinRuntime(); }
    renderAccount();
    renderClientStage();
    renderModes();
    renderConfig();
    renderOverview();
    renderFooter();
    renderRecent();
    if (activeTab === 'characters') { renderCharacters(); updateFinalReplacementRuntimeStatus(); }
    if (activeTab === 'logs') renderLogs();
    if (customPlansChanged) {
      if (activeTab === 'plans') renderCustomPlans();
    }
    if (activeTab === 'maintenance') renderMaintenance();
    renderPrerequisites();
    if (next.catalogRevision !== undefined) {
      const revision = String(next.catalogRevision);
      if (catalogRevisionSeen === null) { catalogRevisionSeen = revision; if (!catalogLoaded) refreshCatalog(); }
      else if (revision !== catalogRevisionSeen) { catalogRevisionSeen = revision; refreshCatalog(); }
    }
    setText('log-count', logs.length > 999 ? '999+' : logs.length);
    $('log-count').hidden = logs.length === 0;
  }
  function receiveLog(entry) {
    if (!entry || typeof entry !== 'object' || !isConciseLog(entry)) return;
    const entryId = first(entry.id, entry.sequence);
    if (entryId !== undefined && logs.some((existing) => first(existing.id, existing.sequence) === entryId)) return;
    logs.push(entry);
    if (logs.length > 2000) logs.shift();
    if (panelHidden) return;
    renderRecent();
    if (activeTab === 'logs' && !panelHidden) renderLogs(true);
    setText('log-count', logs.length > 999 ? '999+' : logs.length);
    $('log-count').hidden = false;
  }
  // Skin files are read only on entry or an explicit change, independently of
  // the frequently pushed game state. Only one opt-in local preview animates.
  const skinId = value => typeof value === 'string' && value.length <= 120 ? value : null;
  function skinImageUrl(value) { return typeof value === 'string' && value.length <= 8 * 1024 * 1024 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value) ? value : ''; }
  function skinWarnings(entry) { return Array.isArray(entry?.warnings) ? [...new Set(entry.warnings.filter(value => typeof value === 'string').map(value => value.trim().slice(0, 500)).filter(Boolean))].slice(0, 12) : []; }
  function previewSkin() { return skins.find(entry => entry.id === previewSkinId) || null; }
  function skinStatus(message, error = false) { setText('skin-status', message); $('skin-status').classList.toggle('error', error); }
  function setSkinBusy(value) { skinsBusy = value; $('page-skins').setAttribute('aria-busy', String(value)); renderSkinControls(); }
  function acceptSkins(response, preferredId = undefined) {
    const next = Array.isArray(response?.skins) ? response : Array.isArray(response?.state?.skins) ? response.state : null;
    if (!next) throw new Error('未收到有效的皮肤列表，请点击“刷新列表”重试。');
    skins = next.skins.filter(entry => entry && skinId(entry.id)).map(entry => ({ ...entry, name: String(entry.name || '未命名皮肤').slice(0, 40), thumbnailDataUrl: skinImageUrl(entry.thumbnailDataUrl), warnings: skinWarnings(entry) }));
    const previousSelection = selectedSkinId;
    selectedSkinId = skinId(next.selectedId);
    skinRuntime = next.runtime && typeof next.runtime === 'object' ? next.runtime : selectedSkinId && selectedSkinId === previousSelection ? skinRuntime : { phase: selectedSkinId ? 'waiting' : 'disabled' };
    if (!skins.some(entry => entry.id === selectedSkinId)) selectedSkinId = null;
    const wanted = preferredId === undefined ? previewSkinId || selectedSkinId : preferredId;
    previewSkinId = skins.some(entry => entry.id === wanted) ? wanted : selectedSkinId || skins[0]?.id || null;
    skinsLoaded = true;
    $('skin-restore-builtin').hidden = next.canRestoreBuiltin !== true;
    renderSkins();
  }
  async function refreshSkins() {
    if (skinsBusy) return;
    skinsLoading = true; setSkinBusy(true); skinStatus('正在读取本机皮肤…');
    try { acceptSkins(await command('getSkins')); skinStatus('已读取本机皮肤。选中卡片预览，点击“使用此皮肤”后生效。'); }
    catch (error) { skinStatus(error.message, true); }
    finally { skinsLoading = false; setSkinBusy(false); renderSkins(); }
  }
  function renderSkins() {
    const signature = JSON.stringify(skins.map(entry => [entry.id, entry.name, entry.builtin === true, entry.thumbnailDataUrl, skinWarnings(entry)]));
    if (signature !== skinsSignature) {
      skinsSignature = signature;
      const fragment = document.createDocumentFragment();
      for (const entry of skins) {
        const item = element('div', 'skin-list-item'); item.setAttribute('role', 'listitem');
        const button = element('button', 'skin-card'); button.type = 'button'; button.dataset.skinId = entry.id; button.setAttribute('aria-label', `预览皮肤：${entry.name}`);
        const imageBox = element('span', 'skin-thumbnail checkerboard');
        if (entry.thumbnailDataUrl) {
          const image = document.createElement('img'); image.alt = ''; image.loading = 'lazy'; image.decoding = 'async';
          image.addEventListener('load', () => image.classList.toggle('skin-pixel-art', image.naturalWidth <= 64), { once: true });
          image.src = entry.thumbnailDataUrl;
          image.addEventListener('error', () => { imageBox.replaceChildren(element('span', 'skin-thumbnail-error', '缩略图读取失败')); }, { once: true }); imageBox.append(image);
        } else imageBox.append(element('span', 'skin-thumbnail-error', '无缩略图'));
        const title = element('span', 'skin-card-title', entry.name);
        const detail = element('span', 'skin-card-detail', (entry.builtin ? '内置皮肤' : '本机导入') + (skinWarnings(entry).length ? ' · 有效果提示' : ''));
        const active = element('span', 'skin-card-active', '使用中'); active.hidden = true;
        button.append(imageBox, title, detail, active);
        button.addEventListener('click', () => {
          if (skinsBusy) return;
          skinNameDirty = false; previewSkinId = entry.id; renderSkins();
        });
        item.append(button); fragment.append(item);
      }
      $('skins-grid').replaceChildren(fragment);
    }
    $('skin-empty').hidden = skins.length > 0 || skinsLoading;
    setText('skin-count', skins.length);
    for (const button of $('skins-grid').querySelectorAll('[data-skin-id]')) {
      const isPreview = button.dataset.skinId === previewSkinId, isActive = button.dataset.skinId === selectedSkinId;
      button.classList.toggle('selected', isPreview); button.classList.toggle('in-use', isActive); button.setAttribute('aria-pressed', String(isPreview));
      button.querySelector('.skin-card-active').hidden = !isActive;
      button.querySelector('.skin-card-active').textContent = skinIsApplied() ? '使用中' : '已选择';
    }
    const entry = previewSkin();
    if (skinFormId !== (entry?.id || null)) {
      skinFormId = entry?.id || null; skinNameDirty = false;
      $('skin-name-error').hidden = true; $('skin-name').setAttribute('aria-invalid', 'false');
    }
    renderSkinRuntime();
    renderSkinWarnings();
    if (!skinNameDirty) $('skin-name').value = entry?.name || '';
    $('skin-name').placeholder = entry ? '为皮肤起个名字' : '先选择皮肤';
    const previewKey = entry ? `${entry.id}:${entry.thumbnailDataUrl}` : '';
    if (!panelHidden && activeTab === 'skins' && previewKey !== skinPreviewKey) { skinPreviewKey = previewKey; loadSkinPreview(entry); }
    renderSkinControls();
  }
  function renderSkinWarnings() {
    const warnings = skinWarnings(previewSkin());
    $('skin-warnings').hidden = warnings.length === 0;
    $('skin-warning-details').replaceChildren(...warnings.filter(value => value !== '文件不符合推荐标准，可能不达预期。').map(value => element('li', '', value)));
  }
  function skinIsApplied() { return Boolean(selectedSkinId && skinRuntime.phase === 'active' && skinRuntime.skinId === selectedSkinId); }
  function skinIsLoading() { return ['loading', 'applying'].includes(skinRuntime.phase); }
  function skinUseLabel(entry) { return !entry || entry.id !== selectedSkinId ? '使用此皮肤' : skinIsApplied() ? '正在使用此皮肤' : skinIsLoading() ? '正在应用皮肤…' : '重试应用皮肤'; }
  function renderSkinRuntime() {
    const current = skins.find(entry => entry.id === selectedSkinId), entry = previewSkin();
    const active = skinIsApplied();
    const unsupported = ['unsupported', 'error', 'failed'].includes(skinRuntime.phase);
    setText('skin-current', !current ? '当前：游戏原形象' : active ? `当前：${current.name}` : unsupported ? `原形象 · 所选皮肤暂不可用` : `已选择：${current.name} · 等待应用`);
    $('skin-current').title = typeof skinRuntime.reason === 'string' ? skinRuntime.reason : '';
    setText('skin-detail-badge', !entry ? '尚未选择' : entry.id === selectedSkinId ? active ? '使用中' : unsupported ? '暂不可用' : '已选择 · 待应用' : entry.builtin ? '内置 · 未启用' : '未启用');
    if (entry && entry.id === selectedSkinId) setText('skin-use', skinUseLabel(entry));
    $('skin-use').disabled = skinsBusy || !entry || entry.id === selectedSkinId && (active || skinIsLoading());
    for (const button of $('skins-grid').querySelectorAll('[data-skin-id]')) if (button.dataset.skinId === selectedSkinId) button.querySelector('.skin-card-active').textContent = active ? '使用中' : '已选择';
  }
  function renderSkinControls() {
    const entry = previewSkin();
    for (const id of ['skin-import', 'skin-refresh', 'skin-copy-prompt', 'skin-save-prompt', 'skin-restore-builtin']) $(id).disabled = skinsBusy;
    $('skin-native').disabled = skinsBusy || !selectedSkinId;
    for (const id of ['skin-name', 'skin-export', 'skin-delete', 'skin-export-format']) $(id).disabled = skinsBusy || !entry;
    $('skin-use').disabled = skinsBusy || !entry || entry.id === selectedSkinId && (skinIsApplied() || skinIsLoading());
    setText('skin-use', skinUseLabel(entry));
    $('skin-rename').disabled = skinsBusy || !entry || !skinNameDirty;
    for (const button of $('skins-grid').querySelectorAll('[data-skin-id]')) button.disabled = skinsBusy;
    $('skin-preview-action').disabled = skinsBusy || !skinPreviewImage;
    $('skin-preview-mirror').disabled = skinsBusy || !skinPreviewImage;
    $('skin-preview-play').disabled = skinsBusy || !skinPreviewImage;
    $('skin-delete-confirm').disabled = skinsBusy;
    $('skin-delete-cancel').disabled = skinsBusy;
  }
  function stopSkinPreview() {
    clearInterval(skinPreviewTimer); skinPreviewTimer = null;
    $('skin-preview-play').setAttribute('aria-pressed', 'false'); setText('skin-preview-play', '播放预览');
  }
  function cancelPendingSkinPreview(resetKey = false) {
    skinPreviewRequest++;
    if (skinPreviewPendingImage) { skinPreviewPendingImage.src = ''; skinPreviewPendingImage = null; }
    // The previous preview was cleared when this request started. Re-entry
    // must request it again instead of leaving a cancelled loading message.
    if (resetKey && !skinPreviewImage) skinPreviewKey = '';
  }
  function drawSkinPreview() {
    if (panelHidden) return;
    const canvas = $('skin-preview-canvas'), ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!skinPreviewImage) return;
    const row = Math.max(0, Math.min(3, Number($('skin-preview-action').value) || 0));
    ctx.imageSmoothingEnabled = canvas.width > 64; ctx.imageSmoothingQuality = 'high'; ctx.save();
    if ($('skin-preview-mirror').checked) { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
    const cell = skinPreviewImage.width / 4;
    ctx.drawImage(skinPreviewImage, skinPreviewFrame * cell, row * cell, cell, cell, 0, 0, canvas.width, canvas.height); ctx.restore();
  }
  async function loadSkinPreview(entry) {
    $('skin-preview-note').classList.remove('error');
    stopSkinPreview(); cancelPendingSkinPreview(); const request = ++skinPreviewRequest;
    skinPreviewImage = null; skinPreviewFrame = 0; $('skin-preview-action').value = '0'; $('skin-preview-mirror').checked = false;
    $('skin-preview-canvas').hidden = true; $('skin-preview-placeholder').hidden = false;
    setText('skin-preview-placeholder', entry ? '正在读取动作图集…' : '选择一个皮肤查看'); renderSkinControls();
    if (!entry) return;
    try {
      const response = await command('getSkinPreview', { id: entry.id });
      if (request !== skinPreviewRequest || disposing || panelHidden || activeTab !== 'skins') return;
      const url = skinImageUrl(response?.atlasDataUrl);
      if (!url || response.id !== entry.id) throw new Error('动作图集读取失败，请刷新列表后重试。');
      const image = new Image(); skinPreviewPendingImage = image; image.src = url; await image.decode();
      if (request !== skinPreviewRequest || disposing || panelHidden || activeTab !== 'skins') { image.src = ''; return; }
      if (Array.isArray(response.warnings)) { entry.warnings = skinWarnings({ warnings: [...skinWarnings(entry), ...response.warnings] }); renderSkinWarnings(); }
      if (image.width !== image.height || ![256, 1024].includes(image.width)) throw new Error('动作图集规格异常，请重新导入。');
      const canvas = $('skin-preview-canvas');
      canvas.width = canvas.height = image.width / 4;
      canvas.classList.toggle('skin-pixel-art', canvas.width <= 64);
      skinPreviewImage = image; $('skin-preview-canvas').hidden = false; $('skin-preview-placeholder').hidden = true;
      setText('skin-preview-note', `选择四种动作检查画面；“向左”检查翻转。${image.width > 256 ? '高清预览保留原图细节，游戏中仍按原角色大小显示，极细纹理可能难以辨认。' : '这是旧版低分辨率皮肤，重新导入原始 PNG 可保留更多细节；放大无法找回已丢失细节。'}`); drawSkinPreview();
    } catch (error) {
      if (request !== skinPreviewRequest) return;
      setText('skin-preview-placeholder', '动作预览未能加载'); setText('skin-preview-note', error.message);
      $('skin-preview-note').classList.add('error');
    } finally { if (request === skinPreviewRequest) { skinPreviewPendingImage = null; renderSkinControls(); } }
  }
  async function skinMutation(action, payload, working, done, preferredId) {
    if (skinsBusy) return null;
    stopSkinPreview(); setSkinBusy(true); skinStatus(working);
    try {
      const response = await command(action, payload || {});
      if (response?.cancelled) { skinStatus('已取消，当前皮肤和文件保持原样。'); return response; }
      if (Array.isArray(response?.skins) || Array.isArray(response?.state?.skins)) acceptSkins(response, preferredId === 'imported' ? response.importedId : preferredId);
      skinStatus(typeof done === 'function' ? done(response) : done, action === 'selectSkin' && Boolean(selectedSkinId) && ['unsupported', 'error', 'failed'].includes(skinRuntime.phase)); return response;
    } catch (error) { skinStatus(error.message, true); showToast(error.message, true); return null; }
    finally { setSkinBusy(false); }
  }
  async function obtainSkinPrompt() {
    if (!skinPromptText) {
      const response = await command('getSkinPrompt');
      if (typeof response?.prompt !== 'string' || !response.prompt.trim()) throw new Error('未收到皮肤提示词，请稍后重试。');
      skinPromptText = response.prompt; $('skin-prompt').value = skinPromptText;
    }
    return skinPromptText;
  }

  function renderAccount() {
    const profile = state.profile;
    const registered = first(profile?.name, profile?.username, profile?.displayName, profile?.nickname);
    const accountType = first(profile?.accountType, state.game.accountType);
    const name = registered ? nameOf(registered) : profile ? (accountType === 'guest' ? '游客账号' : '账号已连接') : '等待进入游戏';
    setText('account-name', name);
    $('account').title = name;
    $('account-dot').className = `status-dot${profile ? '' : ' idle'}`;
  }
  function sessionSeconds() {
    if (elapsedAtReceive !== null) return elapsedAtReceive + (normalizedRunning() && !normalizedPaused() ? (Date.now() - stateReceivedAt) / 1000 : 0);
    const start = dateOf(first(state.session.startedAt, state.session.startTime, state.session.start));
    if (!start) return 0;
    const end = dateOf(first(state.session.endedAt, state.session.endTime));
    return Math.max(0, ((end || new Date()).getTime() - start.getTime()) / 1000 - Number(state.session.pausedSeconds || 0));
  }
  function mapName(id) { return nameOf(catalog.maps.find((map) => String(first(map.id, map.key)) === String(id))?.name, ({ forest: '常青森林', desert: '灼热沙漠', auto: '自动选择' })[id] || id || '等待地图'); }
  function difficultyName(tier) {
    if (tier === 'auto' || tier == null) return '自动难度';
    return nameOf(catalog.difficulties?.find(entry => String(first(entry.tier, entry.id)) === String(tier))?.name,
      ['普通', '困难', '噩梦'][Number(tier)] || `难度 ${tier}`);
  }
  function currentActivity() {
    const game = state.game;
    const running = normalizedRunning();
    if (state.compatibilityReport?.maintenanceScope?.automaticPlay === false) return ['第三赛季接口候选', '目录与方案编辑可用，游玩接口待核验。'];
    if (activeRecovery()) return [state.recovery.requiresLogin ? '等待原账号登录，随后自动续挂' : '正在自动恢复，挂机任务已保留', recoveryDetail()];
    if (!state.profile && !game.accountType) return ['游客或账号，都能开始冒险', '在上方登录账号或选择游客，选好初始宝可梦后开始挂机。'];
    if (!running && hasActiveNativeRun()) return ['辅助已停，可自行操作本局', '游戏保持原生运行或暂停状态。点击继续挂机，会读取本局角色、地图、招式与道具重新接管；下局设置不会重开当前对局。'];
    if (!state.recovery?.temporaryGuest && executionMode() === 'shiny' && game.shiny?.complete) return ['异色搜寻目标已完成', nameOf(game.shiny.message, '当前可刷目标已拥有。可在挂机模式中选择其他目标或关闭「目标完成后暂停」。')];
    if (!running) return [state.paused ? '已暂停，随时可以继续' : '准备好下一场冒险', currentConfig().mode === 'shiny' && currentShinyProgress().message ? nameOf(currentShinyProgress().message) : '选择目标与角色，点击右下角开始挂机。'];
    const phase = game.state;
    if (normalizedPaused()) return ['暂歇一下，进度已保留', '点击继续挂机，旅伴会从当前对局接着推进。'];
    if (phase === 'modal') return ['正在选择本局强化', game.plan?.need || '按通关配置选择招式、道具和强化，随后继续冒险。'];
    if (phase === 'capturing') return ['正在捕获新伙伴', '等待游戏完成捕获演出，随后继续推进。'];
    if (['play', 'levelup', 'cinematic', 'item', 'branch', 'blessing', 'party'].includes(phase)) {
      const stage = numeric(game.stage);
      const tower = game.nativeMode === 'tower' ? game.tower : null;
      const stageName = tower ? tower.roof ? ' · 塔顶' :
        ` · ${tower.beyond ? '塔顶之后 · ' : ''}第${numberText(tower.floor)}层${numeric(tower.wave) !== null && tower.state !== 'clear' ? ` · 第${Number(tower.wave) + 1}波` : ''}` :
        stage === null ? '' : stage >= 4 ? ' · 圣域' : ` · 第${stage}区`;
      const kills = numeric(game.kills);
      const bosses = numeric(game.bosses);
      const detail = [executionMode() === 'shiny' ? nameOf(game.shiny?.message, game.shiny?.targetName ? `搜寻异色 ${game.shiny.targetName}` : '') : '', nameOf(game.targetLabel || (typeof game.target === 'string' ? game.target : game.target?.name) || game.objective), game.plan?.unlockTarget ? `目标：${game.plan.unlockTarget.name || '新角色'}` : '', game.plan?.need || '', kills !== null ? `本局击败 ${kills.toLocaleString('zh-CN')}` : '', bosses !== null ? `已击败 ${bosses} 位守护者` : ''].filter(Boolean).join(' · ');
      const difficulty = game.nativeMode === 'tower' ? null : first(game.tier, game.plan?.tier);
      return [`${mapName(game.biome)}${difficulty != null ? ` · ${difficultyName(difficulty)}` : ''}${stageName}`,
        [detail, game.plan?.preferenceOverride || game.plan?.difficultyReason].filter(Boolean).join(' · ') || '正在根据地图状态探索、战斗与拾取。'];
    }
    if (['over', 'gameover', 'summary', 'ended'].includes(phase)) return ['本局结算中', '等待游戏保存本局成绩，随后执行下一步。'];
    return ['正在准备下一局', nameOf(first(game.reason, game.plan?.reason, state.status?.message), '同步账号进度，并选择适合当前目标的角色与地图。')];
  }
  function renderOverview() {
    const [activity, detail] = currentActivity();
    setText('current-activity', activity);
$('current-activity').closest('.mission-card')?.classList.toggle('idle', !(normalizedRunning() && !normalizedPaused() && !activeRecovery() && state.compatibilityReport?.maintenanceScope?.automaticPlay !== false));
    setText('activity-detail', state.recovery?.temporaryGuest ? `临时游客刷资源，原账号方案已保留。${detail}` : detail);
    renderUnlockNotice();
    const plan = state.game.plan;
    const mode = executionMode();
    const actualModeInfo = modeInfo(mode === currentConfig().mode ? uiModeId() : mode);
    setText('current-mode', state.recovery?.temporaryGuest ? '临时游客 · 刷资源' : nameOf(first(actualModeInfo.label, actualModeInfo.name), '自动推进'));
    document.querySelector('.priority-track').hidden = Boolean(state.game.unlockProgress) && mode !== 'auto';
    const planPriority = first(plan?.priority, plan?.mode, state.game.priority, mode);
    const priorityAliases = { '开新图': 'map', '做委托': 'quests', '开图鉴': 'dex', '刷资源': 'resources', 'map': 'map', 'quests': 'quests', 'dex': 'dex', 'resources': 'resources' };
    const selectedPriority = priorityAliases[planPriority] || (mode === 'auto' ? 'map' : mode);
    document.querySelectorAll('[data-priority]').forEach((node) => node.classList.toggle('current', node.dataset.priority === selectedPriority));
    setText('session-duration', durationText(sessionSeconds()));
    setText('session-runs', numberText(first(state.session.completedRuns, state.session.runs, state.session.games)));
    setText('session-stardust', positiveText(first(state.session.stardustEarned, state.session.stardustDelta, state.session.starDustDelta, state.session.rewards?.stardust)));
    setText('session-discoveries', positiveText(first(state.session.newDex, state.session.discoveries, state.session.seenDelta, state.session.rewards?.seen)));
    const sessionStatus = normalizedPaused() ? '已暂停' : normalizedRunning() ? '持续推进中' : sessionSeconds() > 0 ? '本次已结束' : '尚未开始';
    const sessionLabel = $('session-state');
    if (sessionLabel.dataset.status !== sessionStatus) { sessionLabel.replaceChildren(element('i'), document.createTextNode(sessionStatus)); sessionLabel.dataset.status = sessionStatus; }
    sessionLabel.classList.toggle('running', normalizedRunning() && !normalizedPaused());
    const gameCharacterId = first(state.game.species, state.game.characterId, plan?.species, currentConfig().characterId);
    const character = findCharacter(gameCharacterId);
    setText('run-character', character ? characterName(character) : gameCharacterId ? `角色 #${gameCharacterId}` : '自动选择角色');
    setText('run-level', `等级 ${numberText(state.game.level)}`);
    const hp = numeric(state.game.hp), maxHP = numeric(first(state.game.maxHP, state.game.maxHp));
    setText('run-hp', hp !== null && maxHP !== null ? `${Math.ceil(hp)} / ${Math.ceil(maxHP)}` : '生命 —');
    $('health-fill').style.width = `${hp !== null && maxHP > 0 ? Math.max(0, Math.min(100, hp / maxHP * 100)) : 0}%`;
    $('health-fill').style.backgroundColor = hp !== null && maxHP > 0 && hp / maxHP < .3 ? '#bf8d6c' : '';
    const started = dateOf(first(state.session.startedAt, state.session.startTime));
    const totalStars = numeric(first(state.profile?.stardust, state.game.stars));
    const note = [started ? `开始于 ${timeText(started)}` : null, totalStars !== null ? `账号星尘 ${numberText(totalStars)}` : null, numeric(state.session.spentStardust) !== null ? `本次支出 ${numberText(state.session.spentStardust)}` : null, mode === 'shiny' ? `异色遇见 ${numberText(first(state.session.shiniesFound, state.game.shiny?.encounters))} · 捕获 ${numberText(shinyCount(first(state.session.capturedShinies, state.game.shiny?.captures)))}` : null, numeric(state.game.p95DecisionMs) !== null ? `决策 P95 ${Number(state.game.p95DecisionMs).toFixed(1)} ms` : null].filter(Boolean).join(' · ');
    setText('session-detail', [note, state.recovery?.temporaryGuest ? state.recovery.statisticsScope || '收益仅计临时游客；总时长与局数保留切换前记录。' : ''].filter(Boolean).join(' · ') || '收益在游戏正常结算后记录；未读取的数据以「—」显示。');
  }

  function renderModes() {
    const entries = modes();
    const signature = JSON.stringify([entries, limitedEventsExpanded]);
    if (signature === modeCardsSignature) return;
    modeCardsSignature = signature;
    const root = $('modes-grid'), limitedRoot = $('limited-events-grid');
    root.replaceChildren(); limitedRoot.replaceChildren();
    const makeCard = mode => {
      const card = element('button', 'mode-card');
      card.type = 'button'; card.dataset.mode = mode.id;
      card.setAttribute('role', 'radio');
      const symbol = element('span', 'mode-icon'); symbol.append(icon(icons[mode.id] ? mode.id : 'compass'));
      card.append(element('span', 'mode-radio'), symbol, element('h3', '', nameOf(mode.label || mode.name, mode.id)), element('p', '', nameOf(mode.description)));
      if (['auto','characters'].includes(mode.id)) card.append(element('p', 'mode-delay-note', '暂停选择增加3—10秒随机延迟防检测，不可关闭。'));
      if (mode.eventId) {
        const status = { active: '活动开放中', expired: '已结束 · 保留待返场', upcoming: '尚未开放', inactive: '当前未开放', unknown: '等待读取活动状态' }[mode.eventStatus] || '等待读取活动状态';
        const latest = displayEventPeriods(mode)[0];
        card.append(element('span', 'small-pill event-opening-range', latest ? eventPeriodText(latest) : '开放日期待核实'));
        card.title = `${status}；开放日期以北京时间显示。选择后可查看历次活动时间和奖励；能否计分或领取仍以原生服务器为准。`;
      } else if (mode.available === false) {
        card.disabled = true; card.title = nameOf(mode.reason, '当前游戏版本尚不可用');
        card.append(element('span', 'small-pill', '暂不可用'));
      }
      card.addEventListener('click', () => saveConfig(modeConfig(mode.id)));
      return card;
    }
    for (const mode of entries.filter(mode => !limitedEventMode(mode))) root.append(makeCard(mode));
    const limited = entries.filter(limitedEventMode), toggle = element('button', 'mode-card mode-group-card');
    toggle.id = 'limited-events-toggle'; toggle.type = 'button';
    toggle.setAttribute('aria-expanded', String(limitedEventsExpanded)); toggle.setAttribute('aria-controls', 'limited-events-region');
    const symbol = element('span', 'mode-icon'); symbol.append(icon('compass'));
    toggle.append(symbol, element('h3', '', '限时活动'), element('p', '', '展开查看各活动；已结束的活动和配置保留，供返场继续使用。'),
      element('span', 'small-pill', `${limited.length}项 · ${limitedEventsExpanded ? '收起' : '展开'}`));
    toggle.addEventListener('click', () => {
      limitedEventsExpanded = !limitedEventsExpanded;
      renderModes(); renderConfig(); $('limited-events-toggle').focus();
    });
    root.append(toggle);
    for (const mode of limited) limitedRoot.append(makeCard(mode));
    $('limited-events-region').hidden = !limitedEventsExpanded;
    limitedRoot.setAttribute('role', 'radiogroup'); limitedRoot.setAttribute('aria-label', '限时活动');
    root.setAttribute('role', 'radiogroup');
    root.setAttribute('aria-label', '挂机模式');
  }
  function renderEventHistory(mode) {
    const root = $('event-opening-history'), periods = displayEventPeriods(mode);
    root.hidden = !mode.eventId;
    $('limited-events-toggle')?.classList.toggle('contains-selection', limitedEventMode(mode));
    if (!mode.eventId) return;
    const list = $('event-opening-periods'), signature = JSON.stringify([mode.eventId, periods]);
    if (list.dataset.periodsSignature !== signature) {
      list.dataset.periodsSignature = signature; list.replaceChildren();
      for (const [index, period] of periods.entries()) {
        const row = element('li', '', eventPeriodText(period));
        if (periods.length > 1 && index === 0) row.append(element('span', 'small-pill', '最近开放'));
        list.append(row);
      }
    }
    setText('event-opening-history-note', periods.length ? `按北京时间记录已核实的${periods.length}次开放；返场沿用原活动入口。能否积累或领奖仍以原生状态为准。` : '暂无经官方核实的开放日期；入口与配置仍保留，等待公开定义更新。');
  }
  function renderMaps() {
    const select = $('biome-select');
    select.replaceChildren(new Option('自动选择', 'auto'));
    for (const map of catalog.maps) {
      const id = first(map.id, map.key);
      if (id === undefined || id === 'auto') continue;
      const supported = state.compatibilityReport?.maintenanceScope?.biomeIds;
      const outsideScope = Array.isArray(supported) && !supported.includes(id);
      const option = new Option(nameOf(map.name || map.label, id) + (outsideScope ? ' · 待适配' : map.live === false || map.available === false ? ' · 未开放' : map.unlocked === false ? ' · 未解锁' : ''), id);
      option.disabled = outsideScope || map.live === false || map.available === false || map.unlocked === false;
      select.add(option);
    }
  }
  function unlockCatalog() {
    const value = catalog.unlockGoals || catalog.unlockCatalog;
    return value && Array.isArray(value.categories) && Array.isArray(value.targets) ? value : { categories: [], targets: [] };
  }
  function targetEventId(target) {
    return target?.eventId || target?.action?.eventId ||
      (['event-complete', 'event-points', 'event-counter'].includes(target?.completion?.kind) ? target.completion.key : null) ||
      /^events:([^:]+):/.exec(String(target?.id || ''))?.[1] || null;
  }
  function selectedEventTarget(eventId) {
    const config = currentConfig();
    if (Object.hasOwn(config.eventTargets, eventId)) {
      const selected = String(config.eventTargets[eventId] || 'auto');
      return selected === 'auto' || targetEventId(unlockCatalog().targets.find(entry => entry.id === selected) || { id: selected }) === eventId ? selected : 'auto';
    }
    const legacy = String(config.unlockTargets.events || 'auto');
    const target = unlockCatalog().targets.find(entry => entry.id === legacy);
    return targetEventId(target || { id: legacy }) === eventId ? legacy : 'auto';
  }
  function selectedUnlockTarget(category) {
    const config = currentConfig();
    if (Object.hasOwn(config.unlockTargets, category)) return String(config.unlockTargets[category] || 'auto');
    return category === 'shiny' && config.shinyMode === 'target' && Number(config.shinyTargetId) > 0 ? `shiny:${Number(config.shinyTargetId)}` : 'auto';
  }
  function unlockTargetState(target) {
    const value = state.game.unlockProgress?.targetStatuses?.[target.id];
    if (value?.complete === true) return { label: '已解锁', reason: value.reason || '' };
    if (value?.available === false) return { label: ({native:'待前置或未开放',config:'当前设置冲突',script:'暂需手动 · 脚本未支持',manual:'待手动或服务器结算',unknown:'具体条件待核对'})[value.blockerKind] || (value.constraintConflict ? '当前设置冲突' : '具体条件待核对'), reason: value.reason || '' };
    if (value?.available === true) return { label: '可推进', reason: value.reason || '' };
    if (target.automation?.supported === false || target.action?.earning?.supported === false) return { label: '暂需手动 · 脚本未支持', reason: target.automation?.reason || target.action?.earning?.reason || '此目标的自动操作尚未实现，请按原生要求手动完成；这不代表游戏未解锁。' };
    if (target.executable === false) return { label: ['future','unreleased'].includes(target.availability?.state) ? '原生尚未开放' : target.availability?.state === 'manual' ? '待手动或服务器结算' : '暂需手动 · 脚本未支持', reason: target.availability?.reason || target.acquisition || '' };
    return { label: '等待读取存档', reason: '' };
  }
  function renderUnlockTargets(force = false) {
    const config = currentConfig(), mode = config.mode, definition = unlockCatalog();
    const eventMode = modeInfo(uiModeId()), eventId = eventMode.eventId || null;
    const allowedModes = ['auto', 'map', 'maps', 'dex', 'characters', 'research', 'shiny', 'lab', 'items', 'achievements', 'appearance'];
    const root = $('unlock-target-options');
    root.hidden = !eventId && !allowedModes.includes(mode);
    if (root.hidden) return;
    if (activeTab !== 'modes') { unlockTargetsSignature = ''; return; }
    const categoryFilter = 'all';
    const search = $('unlock-target-search').value.trim().toLocaleLowerCase('zh-CN');
    const defaults = { map: ['maps'], maps: ['maps'], dex: ['dex'], characters: ['characters'], research: ['research'], shiny: ['shiny'], lab: ['lab'], items: ['items'], achievements: ['achievements'], appearance: ['appearance'], auto: ['dex', 'characters', 'research', 'shiny'] };
    const relevant = definition.categories.filter(category =>
      eventId ? category.id === (eventMode.rewardCategory || 'events') :
        (Array.isArray(category.modes) ? category.modes.includes(mode) : (defaults[mode] || []).includes(category.id)));
    const categories = relevant.filter(category => categoryFilter === 'all' || category.id === categoryFilter);
    const signature = JSON.stringify([mode, eventId, eventMode.eventStatus, categoryFilter, search, config.unlockTargets, config.eventTargets, config.shinyMode, config.shinyTargetId,
      definition.sourceHash, definition.targets.length, state.game.unlockProgress?.targetStatuses || {}]);
    if (!force && signature === unlockTargetsSignature) return;
    // State polling must not close an open native select while the player is
    // making a choice. The blur handler refreshes deferred status labels.
    if (!force && root.contains(document.activeElement) && document.activeElement.tagName === 'SELECT') return;
    unlockTargetsSignature = signature;
    const selects = $('unlock-target-selects'); selects.replaceChildren();
    for (const category of categories) {
      const chosen = eventId ? selectedEventTarget(eventId) : selectedUnlockTarget(category.id), select = document.createElement('select');
      select.dataset.unlockCategory = category.id;
      if (eventId) select.dataset.eventId = eventId;
      select.setAttribute('aria-label', eventId ? `${nameOf(eventMode.label, eventId)}奖励目标` : `${nameOf(category.label || category.name, category.id)}解锁目标`);
      select.add(new Option(eventId ? '自动选择本活动未获得的奖励' : '自动选择未解锁的', 'auto'));
      const targets = definition.targets.filter(target => target.category === category.id && (!eventId || targetEventId(target) === eventId));
      for (const target of targets) {
        const status = unlockTargetState(target);
        if (!unlockSearchIndex.has(target.id)) unlockSearchIndex.set(target.id, [target.name, target.description, target.acquisition, JSON.stringify(target.requirements || []), JSON.stringify(target.sources || [])].join(' ').toLocaleLowerCase('zh-CN'));
        const searchable = unlockSearchIndex.get(target.id) + ' ' + String(status.reason).toLocaleLowerCase('zh-CN');
        if (search && !searchable.includes(search) && target.id !== chosen) continue;
        const option = new Option(`${nameOf(target.name, target.id)} · ${status.label}`, target.id);
        option.title = [target.description || target.acquisition, status.reason].filter(Boolean).join('；');
        select.add(option);
      }
      if (chosen !== 'auto' && !targets.some(target => target.id === chosen)) select.add(new Option(`${chosen} · 当前目录未提供，等待核对`, chosen));
      select.value = chosen;
      const label = element('label', 'inline-field', eventId ? '活动奖励' : nameOf(category.label || category.name, category.id));
      label.append(select); selects.append(label);
      select.addEventListener('change', () => {
        const patch = eventId ? { eventTargets: { [eventId]: select.value } } : { unlockTargets: { [category.id]: select.value } };
        if (eventId === 'halloween26' && ['events:halloween26:quest:beyond','events:halloween26:quest:abyss'].includes(select.value)) {
          patch.modeSettings={tower:{exitPolicy:'continue'}};
          showToast('已选择高层目标，同时启用持续挑战；可在上方手动改为7层通关后离开。');
        }
        saveConfig(patch); renderUnlockTargets(true); renderUnlockAcquisition();
      });
    }
    setText('unlock-target-help', !definition.targets.length ? '解锁条件目录正在同步；原有模式仍可使用，未读取的条件不会冒充已完成。' : search ? '搜索会匹配名称、条件和获取方式；已选目标始终保留。未开放或缺前置的目标也可选择，按原生条件处理。' : eventId ? '仅选择本活动奖励；自动选择会按已保存进度逐项推进，领到后选择下一个。需要普通对局的任务会按原生条件安排，不强制进入塔；未开放或结束时保留目标并提示，等待开放、返场或原生领奖窗口。' : '自动选择会根据已保存进度逐项推进，完成后选择下一个；指定目标缺少前置时先完成前置。没有可解锁内容时只提示，模式仍可继续使用。');
    renderUnlockAcquisition();
  }
  function renderUnlockAcquisition() {
    const definition = unlockCatalog(), root = $('unlock-acquisition-content');
    const eventId = modeInfo(uiModeId()).eventId || null;
    const ids = [...new Set([...$('unlock-target-selects').querySelectorAll('select')].map(select => select.value).filter(id => id && id !== 'auto'))];
    if (!ids.length && state.game.unlockProgress?.targetId && (!eventId ||
      targetEventId(definition.targets.find(target => target.id === state.game.unlockProgress.targetId)) === eventId)) ids.push(state.game.unlockProgress.targetId);
    root.replaceChildren();
    for (const id of ids) {
      const target = definition.targets.find(target => target.id === id); if (!target) continue;
      const card = element('article', 'unlock-acquisition-card');
      card.append(element('strong', '', nameOf(target.name, target.id)));
      const method = String(target.acquisition || target.description || '原生获取说明正在同步。').replace(/。；/g, '；').replace(/。。/g, '。');
      card.append(element('p', '', method));
      const dependencies = (target.dependencies || []).map(dependency => typeof dependency === 'string' ? dependency : dependency.targetId)
        .map(id => definition.targets.find(target => target.id === id)?.name).filter(Boolean);
      if (dependencies.length) card.append(element('p', '', (target.completion?.kind === 'any' ? '可选获取路径：' : '所需前置：') + dependencies.join('、')));
      const locations = [...new Set((target.sources || []).filter(source => source.live !== false && source.biome)
        .map(source => `${mapName(source.biome)}${source.stage ? ` · 第${source.stage}区` : ''}`))];
      if (locations.length) card.append(element('p', '', '已核对来源：' + locations.join('、')));
      const status = unlockTargetState(target); if (status.reason) card.append(element('p', 'unlock-acquisition-reason', status.reason));
      root.append(card);
    }
    if (!root.childElementCount) root.append(element('p', '', '自动选择会按已保存存档挑选下一目标。开始规划后，这里会显示当前目标的原生获取方法；也可在下拉栏指定目标查看。'));
  }
  function overviewModeConditions() {
    const game = state.game || {}, profile = state.profile || game.profile, config = currentConfig(),
      active = hasActiveNativeRun(), plan = game.plan || {}, mode = executionMode(), definition = modeInfo(mode === config.mode ? uiModeId() : mode),
      tower = active ? game.nativeMode === 'tower' : definition.eventId || plan.mode === 'tower',
      result = [];
    if (mode === 'mutation') {
      const daily=plan.mutationPlan, route=active&&game.nativeMode==='mutation'&&daily?mutationModeSettings({modeSettings:{mutation:daily}}):mutationModeSettings(config);
      result.push('每日变异按原生服务器日程刷新（UTC 00:00 / 北京时间08:00）；当日地图、难度、世界种子和变体固定，不使用背包加成，不支持合作。');
      result.push(route.target==='leaderboard'?'目标：重复挑战当日变异，继续冲击排行榜；注册账号的排行资格以原生规则为准。':`目标：取得当日全部奖励，确认真实保存后${route.afterDailyRewards==='stop'?'停止辅助':'停留菜单，等待次日刷新后再挑战'}。`);
      if(daily && typeof daily==='object') {
        const variant=nameOf(daily.name||daily.variant?.name||daily.variant?.label||daily.variant?.id||daily.variant,'');
        if(variant || daily.biome)result.push(`当前已核日程：${[variant,daily.biome?mapName(daily.biome):'',Number.isInteger(daily.tier)&&daily.tier>=0&&daily.tier<=2?difficultyName(daily.tier):''].filter(Boolean).join(' · ')}。`);
        if(daily.rewards?.known===true&&Number.isInteger(daily.rewards.paid)&&daily.rewards.paid>=0&&daily.rewards.paid<=5)result.push(`已保存日奖励进度：${daily.rewards.paid}/5${daily.rewards.complete===true?' · 当日奖励已完成':''}。`);
      }
      result.push('当日奖励进度只采用原生已保存资料；未核实不按零进度处理，也不会为等待刷新打断当前对局。仍遵守自动连局（结束后继续）和脚本启用时段，关闭自动连局时不会跨日重开。');
      return result;
    }
    if (mode === 'autoManage') return [
      `接管条件：须由玩家先手动开始原生对局；${active ? '当前已读取到进行中的原生对局，可接管本局' : '当前没有读取到进行中的对局，请先手动开局'}。只接管这一局，本局结束后停止，不自动开新局。`,
      config.autoManageBuildPriority === true ? '配装最高优先级已开启：本局恢复完整方案的学习、升级、替换、遗忘及融合规则；仍不自动开下一局。' : '配装最高优先级未开启：以接管时实际持有的招式与维生素为基线，只升级仍持有的同名项，不主动新增、替换、遗忘或融合；移动、捕捉与道具等其他交互继续。',
      '若原生必选页只能新增且没有合法刷新或跳过，保留该页等待你手动选择或开启配装最高优先级，不伪造跳过。原生“自动选择唯一强化”仍可能自行选卡，且不会扩展接管基线。',
    ];
    if (tower) {
      const eventId = definition.eventId || plan.activityId || 'halloween26',
        event = Array.isArray(game.eventModes) ? game.eventModes.find(entry => (entry.eventId || entry.id) === eventId) : null,
        live = typeof event?.live === 'boolean' ? event.live : game.towerActivity?.id === eventId && game.towerActivity.live === true ? true : null;
      result.push(`活动入口：${definition.label || definition.name || '紫苑塔活动'}须由服务器开放${live === null ? '；当前开放状态尚未读取' : live ? '，当前已开放' : '，当前未开放，等待官方开放或返场'}；活动入口不要求先解锁同名的普通地图。`);
      if (event && typeof event.claimable === 'boolean') result.push(`活动领奖窗口：${event.claimable ? '当前已开放' : '当前已关闭，达标后仍须等待原生允许领取'}；奖励进度以正常保存和领取回执为准。`);
      if (eventId === 'halloween26') {
        const options=towerModeSettings(), target=selectedEventTarget(eventId), highTarget=['events:halloween26:quest:beyond','events:halloween26:quest:abyss'].includes(target);
        result.push(options.exitPolicy === 'continue' ? '塔内退出设置：持续挑战；7层塔顶耿鬼战后，原生彼世门可用时继续交互进入后续楼层，直到原生不能继续或角色死亡。' : '塔内退出设置：7层通关后离开；不进入原生彼世门。'+(highTarget ? '当前15/25层目标需要持续挑战，请手动更改此设置；这是配置冲突，不是游戏未解锁。' : ''));
        result.push(options.noCandles ? '蜡烛设置：全程不点燃；移动会避开自动点燃范围。没有点灯可能影响治疗、安抚幽灵或其他需点灯事件。' : '蜡烛设置：按当前目标和原生事件判断；无光目标只在第4层避开蜡烛，第6层可按原生规则点亮纪念蜡烛安抚及治疗。');
      }
    } else {
      const preference = plan.modePreference || currentModeSettings(),
        biome = active ? game.biome || plan.biome : plan.biome || (preference.biome !== 'auto' ? preference.biome : null),
        tier = active ? game.tier ?? plan.tier : plan.tier ?? preference.tier;
      if (biome) {
        const map = catalog.maps.find(entry => String(first(entry.id,entry.key)) === String(biome)), saved = numeric(profile?.biomes?.[biome]);
        result.push(`地图入口：${mapName(biome)}${map?.unlock ? '；解锁要求：'+nameOf(map.unlock) : ''}；${saved === null ? '尚未读取该地图的已保存解锁进度' : saved < 0 ? '当前存档尚未解锁' : '当前存档已解锁'}${map?.live === false ? '；游戏当前未开放此地图' : ''}。`);
        if (mode === 'endless' || plan.mode === 'endless' || mode === 'leaderboard' && ['endless','survival'].includes(config.leaderboardGoal))
          result.push('无尽生存使用已解锁且当前开放的地图，原生固定普通难度；没有额外的困难/噩梦通关门槛。');
        else if (Number(tier) > 0 && Number.isInteger(Number(tier))) result.push(`难度要求：挑战${difficultyName(tier)}须先通关本图${difficultyName(Number(tier)-1)}；${saved === null ? '尚未读取已保存通关进度' : saved >= Number(tier) ? '已满足' : '当前未满足'}。`);
      } else result.push('地图与难度：自动选择只使用当前存档已解锁、游戏已开放的入口；指定地图/难度时必须先完成对应地图及前一难度的通关要求。具体路线尚未选定。');
    }
    const camp=active?game.leaderboardCamp:null;
    if(camp) result.push(`挂机区域：${camp.kind==='endless'?'生存排行 · 迁移区域':'击败数排行'}；当前第${camp.stage}关，目标${camp.automatic?'自动 · ':''}第${camp.targetStage}关；${camp.holding?'已驻留，不主动推进':'正在前往目标区域'}。${camp.reason || ''}${camp.kind==='endless'?'；原生时间阶段与强制首领仍照常推进':''}。`);
    const species = active ? game.species || game.characterId || plan.species : config.characterId || plan.species;
    if (species) result.push(`出战角色：${findCharacter(species) ? characterName(findCharacter(species)) : '#'+species}须已加入联盟；${Array.isArray(profile?.league) ? profile.league.some(id => String(id) === String(species)) ? '当前存档已满足' : '尚未加入联盟，请在角色页查看挑战并成功捕获' : '尚未读取已保存联盟名单'}。`);
    if (Array.isArray(plan.nativeConditions)) result.push(...plan.nativeConditions.filter(value=>typeof value === 'string'));
    if (game.unlockProgress?.action?.kind?.startsWith('claim-') && config.autoClaim === false) result.push('脚本设置：自动领取奖励已关闭；原生达标后请手动领取，或在便利功能的局外助手中打开自动领取奖励。这不是游戏解锁限制。');
    if (game.unlockProgress?.action?.kind === 'buy-lab' && config.autoUpgrade === false) result.push('脚本设置：自动升级实验室已关闭；余额和等级达标后请手动购买，或在便利功能的局外助手中打开自动升级。这不是游戏解锁限制。');
    return result;
  }
  function renderUnlockNotice() {
    const progress = state.game.unlockProgress || {}, root = $('unlock-goal-notice');
    const conflict = routeConstraintConflict();
    const nativeConditions = [...new Set([...(Array.isArray(progress.display?.nativeConditions) ? progress.display.nativeConditions : []),...overviewModeConditions()])];
    if (progress.action?.towerGoal?.trick === true && state.game.nativeMode === 'tower') {
      const tower=state.game.tower || {}, observed=numeric(tower.tricks),
        status={ 'not-spawned':'本层耿鬼墓碑尚未出现，继续探索等待原生生成',available:'本层耿鬼墓碑已出现且尚未使用，正常接近并交互',used:'本层耿鬼墓碑已使用，等待后续楼层的原生机会' }[tower.trickStatus] || '尚未读取本层墓碑状态';
      nativeConditions.push(`本次捣蛋：${status}；${observed === null ? '本局原生次数尚未读取' : `本局原生已发生 ${observed} 次（未保存，不等于服务器累计进度）`}。对话内捣蛋选项未出现时不能当作完成。`);
    }
    const verification=state.game.profileVerification;
    const message = [typeof progress?.message === 'string' ? progress.message : '', conflict ? routeConstraintText(conflict) : '',verification?.code && verification.code!=='current' ? verification.message : ''].filter(Boolean).join('；') || (nativeConditions.length ? '' : '');
    root.hidden = !message;
    root.classList.toggle('route-conflict', Boolean(conflict));
    root.closest('.mission-card').classList.toggle('has-unlock-notice', Boolean(message));
    if (!message) return;
    const remaining = numeric(progress.counts?.remaining);
    const display = progress.display || {};
    const target = unlockCatalog().targets.find(target => target.id === progress.targetId);
    const step = unlockCatalog().targets.find(target => target.id === progress.stepId);
    const targetName = nameOf(display.targetName || progress.targetName || target?.name, '');
    const title = progress.status === 'complete' && (remaining === 0 || !progress.targetId)
      ? '无可解锁内容，可继续使用此模式'
      : targetName ? `目标：${targetName}` : progress.status === 'waiting' ? ['event-earn-unsupported'].includes(progress.code) ? '目标暂需手动 · 脚本未支持' : progress.code === 'tower-exit-conflict' || conflict ? '目标与当前设置冲突' : '目标条件需要核对' : progress.status === 'unknown' ? '目标条件需要核对' : '模式原生条件';
    setText('unlock-goal-title', title);
    setText('unlock-goal-detail', message);
    const activeRun = state.game.state && !['over', 'gameover', 'summary', 'ended', 'menu'].includes(state.game.state);
    const route = activeRun ? state.game.plan : progress.route || progress.action;
    const towerRoute = route?.nativeMode === 'tower' || route?.mode === 'tower' || activeRun && state.game.nativeMode === 'tower';
    const rows = [
      ['最终目标', display.finalTarget],
      ['正在做', display.stepName || progress.stepName || step?.name],
      ['原因', display.why],
      [activeRun ? '本次地图' : '下一步地图', route?.biome ? `${mapName(route.biome)} · ${towerRoute ? '按活动规则' : difficultyName(route.tier)}` : null],
      ['配置限制', conflict ? routeConstraintText(conflict) : activeRun ? state.game.plan?.preferenceOverride || state.game.plan?.difficultyReason : null],
      ['总进度', display.totalProgress],
      ['当前进度', display.currentProgress || display.progressLabel || progress.progressLabel],
      ['已满足', display.completedLabel],
      ['接下来', display.nextStep || progress.nextStep || '按下列欠缺项完成原生要求；已满足时可正常开始或继续挂机'],
      ['原生条件', nativeConditions],
      ['资料核验', verification?.message],
      ['自动处理', verification?.nextStep],
      ['等待窗口', Number.isFinite(progress.wait?.remainingSeconds) ? `最多再等 ${Math.max(0, Math.ceil(progress.wait.remainingSeconds))} 秒，随后重评并继续推进` : null],
    ].filter(([, value]) => typeof value === 'string' && value.trim() || Array.isArray(value) && value.length);
    const list = $('unlock-goal-steps'); list.hidden = !rows.length;
    const rowsSignature = JSON.stringify(rows);
    if (rowsSignature === unlockNoticeRowsSignature) return;
    unlockNoticeRowsSignature = rowsSignature; list.replaceChildren();
    for (const [label, value] of rows) {
      const row = element('div', ''), detail = element('dd', Array.isArray(value) ? 'native-conditions' : '');
      if (Array.isArray(value)) for (const text of value) detail.append(element('p', '', text)); else detail.textContent=value;
      row.append(element('dt', '', label), detail); list.append(row);
    }
  }
  function routeConstraintConflict() {
    const conflict = state.game.unlockProgress?.constraintConflict || state.game.plan?.constraintConflict;
    return conflict && typeof conflict === 'object' && !Array.isArray(conflict) ? conflict : null;
  }
  function routeConstraintText(conflict) {
    const route = (value, required = false) => value?.mode === 'tower' || value?.nativeMode === 'tower' ? '紫苑塔活动 · 按活动规则'
      : [value?.biome && value.biome !== 'auto' ? mapName(value.biome) : required ? '任意地图' : '自动地图', required && value?.tier == null ? '任意难度' : difficultyName(value?.tier)].join(' · ');
    return `本模式配置：${route(conflict.requested)}；目标所需：${route(conflict.required, true)}。${nameOf(conflict.reason, '条件不一致，按本模式指定配置正常推进，不自动改图或视为已完成目标。')}`;
  }
  function renderRouteConstraint() {
    const sourceMode = state.game.unlockProgress?.mode || state.game.plan?.modePreference?.mode;
    const conflict = currentConfig().mode !== 'autoManage' && (!sourceMode || sourceMode === currentConfig().mode) ? routeConstraintConflict() : null, notice = $('mode-route-conflict');
    notice.hidden = !conflict;
    if (conflict) setText('mode-route-conflict', routeConstraintText(conflict));
  }
  function buildSettings() {
    const root = $('automation-settings');
    for (const [key, title, description] of SETTING_FIELDS.filter(([key])=>key==='autoRestart')) {
      const row = element('label', 'setting-row');
      const text = element('span', 'setting-label');
      text.append(element('strong', '', title), element('small', '', description));
      const toggle = element('span', 'switch');
      const input = document.createElement('input'); input.type = 'checkbox'; input.id = `setting-${key}`; input.setAttribute('aria-label', title);
      input.addEventListener('change', () => saveConfig({ [key]: input.checked }));
      toggle.append(input, element('span', 'switch-track'));
      row.append(text, toggle); root.append(row);
    }
    for (const [key, title] of HOTKEY_FIELDS) {
      const row = element('label', 'hotkey-row');
      const label = element('span', '', title), input = document.createElement('input');
      input.id = `hotkey-${key}`; input.readOnly = true; input.dataset.hotkeyCapture = 'true';
      input.setAttribute('aria-label', `${title}快捷键`); input.setAttribute('aria-describedby', 'hotkey-help');
      input.addEventListener('focus', () => { input.select(); });
      input.addEventListener('keydown', event => {
        if (event.isComposing || event.metaKey || ['ControlLeft','ControlRight','AltLeft','AltRight','ShiftLeft','ShiftRight'].includes(event.code)) return;
        if (event.code === 'Escape') { event.preventDefault(); input.blur(); return; }
        event.preventDefault(); event.stopImmediatePropagation(); if (event.repeat) return;
        const chord = [event.ctrlKey ? 'Ctrl' : null, event.altKey ? 'Alt' : null, event.shiftKey ? 'Shift' : null, event.code].filter(Boolean).join('+');
        if (!validHotkey(chord)) { setText('hotkey-error', '此按键组合无法使用，请选择字母、数字、功能键或常用导航键。'); return; }
        hotkeyDraft ||= Object.fromEntries(HOTKEY_FIELDS.map(([field]) => [field, currentConfig()[field]]));
        hotkeyDraft[key] = chord; hotkeyDraftRevision++; input.value = displayHotkey(chord); validateHotkeys();
      });
      row.append(label, input); $('hotkey-list').append(row);
    }
  }
  function validateHotkeys() {
    const keys = HOTKEY_FIELDS.map(([key]) => (hotkeyDraft || currentConfig())[key]);
    const error = keys.some(key => !validHotkey(key)) ? '快捷键无效，请重新按下需要的按键。' : new Set(keys).size !== keys.length ? '三个快捷键不能相同，请分别设置。' : '';
    setText('hotkey-error', error); $('save-hotkeys').disabled = !hotkeyDraft || Boolean(error);
    return !error;
  }
  function renderHotkeys() {
    for (const [key] of HOTKEY_FIELDS) {
      const input = $(`hotkey-${key}`);
      if (input && document.activeElement !== input) input.value = displayHotkey((hotkeyDraft || currentConfig())[key]);
    }
    validateHotkeys();
  }
  function renderRecoveryLogin() {
    if (!$('recovery-login-status')) return;
    const info = state.recoveryLogin || {};
    setText('recovery-login-status', info.message || '未保存自动重登信息。正常情况下复用游戏已有登录状态。');
    $('recovery-login-status').classList.toggle('random-delay-error', info.blocked === true);
    $('save-recovery-login').disabled = recoveryLoginBusy || !bridge;
    $('clear-recovery-login').disabled = recoveryLoginBusy || !bridge || info.saved !== true;
    $('toggle-recovery-login-visibility').disabled = recoveryLoginReadBusy || !bridge;
    setText('account-vault-badge', info.blocked ? '需重新填写' : info.complete ? '本机已保存' : info.saved ? '尚未填齐' : '未保存');
    for (const [key, id] of [['name', 'recovery-login-name'], ['password', 'recovery-login-password']]) {
      $(id).placeholder = info.saved && !recoveryLoginTouched[key] ? '***（已在本机加密保存）' : key === 'name' ? '输入游戏账号' : '输入游戏密码';
    }
    setText('recovery-runtime-status', activeRecovery() ? recoveryDetail() : '意外断线或页面崩溃后自动恢复；玩家主动暂停、停止及关闭会取消续挂。');
    const profile = state.profile;
    const temporaryGuest = state.recovery?.temporaryGuest === true;
    const type = first(profile?.accountType, state.game.accountType);
    setText('account-connection-type', !profile ? '尚未连接游戏账号' : temporaryGuest ? '临时游客' : type === 'guest' ? '游客账号' : '游戏账号已连接');
    const accountName = first(profile?.name, profile?.username, profile?.displayName, profile?.nickname);
    setText('account-profile-name', profile ? (recoveryLoginVisible && accountName ? nameOf(accountName) : '***') : '等待游戏资料');
    setText('account-profile-detail', temporaryGuest ? '当前显示临时游客的资料；原账号进度不会合并到游客。' : profile ? '' : '进入游戏后显示联盟、图鉴、异色及星尘概况。');
    const count = value => Array.isArray(value) ? new Set(value.map(entry => typeof entry === 'object' ? characterIdOf(entry) : entry)).size : numeric(value);
    for (const [id, value] of [['account-league-count', first(profile?.league, profile?.characters)], ['account-dex-count', first(profile?.seen, profile?.dex)], ['account-shiny-count', first(profile?.shinies, profile?.shinyOwnedIds)], ['account-stardust-count', profile?.stardust]]) {
      const total = profile ? count(value) : null;
      setText(id, total === null ? '—' : numberText(total));
    }
    setText('account-recovery-state', activeRecovery() ? '正在恢复连接' : state.recovery?.requiresLogin ? '等待登录' : temporaryGuest ? '已用临时游客重连' : '等待或正常连接');
  }
  function maskRecoveryLogin() {
    recoveryLoginVisibilityEpoch++;
    recoveryLoginVisible = false;
    $('recovery-login-name').type = $('recovery-login-password').type = 'password';
    $('toggle-recovery-login-visibility').setAttribute('aria-pressed', 'false');
    setText('toggle-recovery-login-visibility', '显示账号和密码');
  }
  function clearRecoveryLoginInputs() {
    $('recovery-login-name').value = $('recovery-login-password').value = '';
    recoveryLoginTouched = { name: false, password: false };
    renderRecoveryLogin();
  }
  async function flushRecoveryLogin(explicit = false) {
    clearTimeout(recoveryLoginTimer);
    if (recoveryLoginBusy || recoveryLoginRevision === recoveryLoginSavedRevision) return;
    const revision = recoveryLoginRevision;
    const name = $('recovery-login-name').value.trim(), password = $('recovery-login-password').value;
    const touched = { ...recoveryLoginTouched };
    if (explicit && (!name || !password) && !state.recoveryLogin?.complete) {
      showToast('请补齐账号和密码；输入草稿会在本机保存。', true);
    }
    recoveryLoginBusy = true; renderRecoveryLogin();
    setText('recovery-login-draft-status', '正在本机加密保存…');
    try {
      if (touched.name && touched.password && !name && !password) await command('clearRecoveryLogin');
      else await command('saveRecoveryLogin', { name, password, preserveName: !touched.name, preservePassword: !touched.password });
      recoveryLoginSavedRevision = revision;
      if (bridge?.getState) receiveState(await bridge.getState());
      setText('recovery-login-draft-status', '已在本机加密保存。');
      if (recoveryLoginRevision === revision && activeTab !== 'account') clearRecoveryLoginInputs();
      if (explicit) showToast('已在本机加密保存。');
    } catch {
      setText('recovery-login-draft-status', '保存未完成，请稍后重试；输入内容仍保留在本页。');
      if (explicit) showToast('本机保存未完成，请重试。', true);
    } finally {
      recoveryLoginBusy = false; renderRecoveryLogin();
      if (recoveryLoginRevision !== revision) recoveryLoginTimer = setTimeout(() => flushRecoveryLogin(), 700);
    }
  }
  function renderConfig() {
    const config = currentConfig();
    const modeSettings = currentModeSettings();
    const selectedMode = modeInfo(uiModeId()), eventMode = Boolean(selectedMode.eventId), managed = config.mode === 'autoManage', wardrobe=config.mode === 'wardrobe', allClears=config.mode === 'allClears', mutation=config.mode==='mutation';
    renderEventHistory(selectedMode);
    $('mode-configuration').classList.toggle('collection-active',wardrobe || allClears);
    renderCollectionSettings();
    renderAppearanceConfiguration(config);
    renderLeaderboardCamp();
    $('auto-manage-options').hidden = !managed;
    $('auto-manage-build-priority').checked = config.autoManageBuildPriority === true;
    $('mutation-options').hidden=!mutation;
    const mutationOptions=mutationModeSettings(config);
    syncBoundValue($('mutation-target'),mutationOptions.target);
    syncBoundValue($('mutation-after-daily-rewards'),mutationOptions.afterDailyRewards);
    $('mutation-after-field').hidden=mutationOptions.target!=='daily-rewards';
    const mutationDaily=config.mode==='mutation'?state.game.plan?.mutationPlan:null;
    setText('mutation-today-status',mutationDaily?[
      nameOf(mutationDaily.name||mutationDaily.variant,''),mutationDaily.biome?mapName(mutationDaily.biome):'',
      Number.isInteger(mutationDaily.tier)&&mutationDaily.tier>=0&&mutationDaily.tier<=2?difficultyName(mutationDaily.tier):'',
      ...(Array.isArray(mutationDaily.rules)?mutationDaily.rules.filter(rule=>typeof rule==='string').slice(0,12):[]),
    ].filter(Boolean).join(' · ')||'当日日程待读取，实际开局以游戏为准。':'当日日程待读取，实际开局以游戏为准。');
    const towerOptions=towerModeSettings();
    $('tower-options').hidden=config.mode!=='tower'&&selectedMode.eventId!=='halloween26';
    renderTowerConfiguration(config);
    if (document.activeElement !== $('tower-exit-policy')) $('tower-exit-policy').value=towerOptions.exitPolicy;
    $('tower-no-candles').checked=towerOptions.noCandles;
    $('tower-tomb-experience-floor').value=String(config.modeSettings?.tower?.tombExperienceFloor ?? 0);
    $('tower-only-experience').checked=towerOptions.onlyExperience;
    $('tower-save-money-after-50').checked=towerOptions.saveMoneyAfter50;
    $('tower-aggressive-ultimate').checked=towerOptions.aggressiveUltimate;
    renderTowerCursePriority();
    $('tower-experience-blessing-priority').checked=config.modeSettings?.tower?.experienceBlessingPriority === true;
    setText('tower-options-help',towerOptions.noCandles ? '已全程避开蜡烛自动点燃范围（水平2.4米、垂直1.5米内停留约1.1秒）。这可能失去蜡烛的原生安抚或治疗收益。' : '蜡烛靠近后会自动点燃，不是按E交互。未开启全程禁点时按目标和原生事件判断；无光目标在第4层避开蜡烛。选择15/25层目标会同时开启持续挑战，之后可手动改回。');
    setText('mode-configuration-title', `${nameOf(selectedMode.label || selectedMode.name)} · 配置`);
    for (const option of $('biome-select').options) {
      const map = catalog.maps.find(map => String(map.id) === option.value);
      if (!map) continue;
      const future = map.live === false || map.available === false;
      const locked = Boolean(state.profile) && Number(state.profile.biomes?.[option.value] ?? -1) < 0;
      const supported = state.compatibilityReport?.maintenanceScope?.biomeIds;
      const outsideScope = Array.isArray(supported) && !supported.includes(option.value);
      option.disabled = outsideScope || future || locked && !allClears;
      const label = nameOf(map.name || map.label, option.value) + (outsideScope ? ' · 待适配' : future ? ' · 未开放' : locked ? ' · 未解锁' : '');
      if (option.textContent !== label) option.textContent = label;
    }
    document.querySelectorAll('[data-mode]').forEach((node) => {
      const selected = node.dataset.mode === uiModeId() || node.dataset.mode === config.mode;
      node.classList.toggle('selected', selected); node.setAttribute('aria-checked', String(selected));
      const scope = state.compatibilityReport?.maintenanceScope;
      node.disabled = Boolean(scope && !scope.modeIds?.includes(modeConfig(node.dataset.mode).mode));
      node.title = node.disabled ? '第三赛季此模式尚未适配' : '';
    });
    for (const [id, value] of [['biome-select', modeSettings.biome], ['tier-select', modeSettings.tier], ['fps-select', config.fps]]) {
      if (document.activeElement !== $(id)) $(id).value = String(value);
    }
    if (document.activeElement !== $('display-mode')) $('display-mode').value = ['fit16x9','adaptive','fit16x10','fit4x3'].includes(config.display?.mode) ? config.display.mode : 'fit16x9';
    for (const id of ['biome-select', 'tier-select']) {
      $(id).disabled = eventMode || managed || wardrobe || mutation;
      $(id).closest('label').hidden = eventMode || managed || wardrobe || mutation;
      $(id).title = mutation ? '每日变异的地图与难度由原生当日日程固定，不能自选。' : managed ? '自动托管只接管玩家当前对局，不选择新地图或难度。' : eventMode ? '活动目标按原生条件选择地图与难度；保留原有模式的路线设置。' : '';
    }
    for (const [key] of SETTING_FIELDS) if ($(`setting-${key}`)) $(`setting-${key}`).checked = key==='slideMove'||key==='bossRetreat'?config[key]===true:Boolean(config[key]);
    if (!delayRangeDirty) {
      for (const [id, key] of [['random-delay-min','randomDelayMinMs'], ['random-delay-max','randomDelayMaxMs']]) {
        if (document.activeElement !== $(id)) $(id).value = String(Number(convenienceSettings().rhythm[key]) / 1000);
      }
    }
    renderDelayCadence();
    renderHotkeys();
    renderOverlaySettings();
    renderConvenienceSettings();
    renderRecoveryLogin();
    const eventStatus = { active: '活动当前开放', inactive: '活动当前未开放', expired: '活动已结束，保留目标等待返场', upcoming: '活动尚未开放', unknown: '等待读取原生活动状态' }[selectedMode.eventStatus] || '等待读取原生活动状态';
    const help = mutation ? '每日变异使用游戏当天固定规则。选择拿满当日奖励或重复冲榜，角色页仍可选择已拥有角色。' : wardrobe ? '选择角色与外观，或全部自动；角色尚未拥有时先解锁，原生专属挑战会临时采用所需配装与节奏，保存配置保留。' : allClears ? '全部自动会逐个完成所有角色 × 当前已开放标准地图 × 三个难度；缺角色或地图时先推进原生前置。' : managed ? '先手动开始游戏，再开启托管；仅接管当前对局，本局结束后停止，不自动开下一局。' : config.mode === 'auto' ? '自动推进按「开新图 → 做委托 → 开图鉴 → 刷资源」执行。' : eventMode ? `${eventStatus}；在下方指定本活动奖励或自动选择，路线按奖励的原生条件安排。` : nameOf(selectedMode.help || selectedMode.description);
    setText('mode-help', help);
    setText('mode-constraint-note', mutation ? '本模式策略独立保存，不继承其它模式的地图、难度或驻留区域。等待次日刷新只在真实结算保存后生效；未核实的奖励进度会继续核验，不假装已领取。' : wardrobe ? '这里是游戏原生更衣室，和本机 PNG 皮肤分别记录。角色与外观联动、独立保存；前置自动递归安排，挑战要求临时优先于其他配装偏好。限时奖励关闭、尚未发布或未知来源会单列，不能假装已获得；最终以真实保存和领取为准。' : allClears ? '本模式的角色、地图、难度独立保存。每一格只采用同角色、同地图、同难度的真实标准模式胜利记录；旧角色通关圆圈与地图奖牌不能拼成已通关。历史缺证据的格子会重新完成，塔与无尽不计入。' : managed ? '自动托管沿用当前原生对局的角色、地图与难度，不安排新开局；本局结束后停止，优先于“结束后继续”。配装最高优先级单独保存，默认关闭。' : eventMode ? '本活动目标单独保存。自动选择逐项推进本活动未获得、可自动达成的奖励；每项奖励的前置、所需模式与领奖条件均在下方说明。已结束的活动仍可查看和保留设置，能否计分或领奖以原生状态为准。' : '地图与难度仅用于当前模式。自动选择会安排兼容的目标路线；指定配置不会被解锁条件覆盖，条件冲突会在下方与总览说明。');
    setText('mode-apply-note', managed ? '仅接管当前对局，不自动新开局' : normalizedRunning() ? '模式、地图与角色在下一局生效' : '设置已自动保存');
    renderRouteConstraint();
    renderUnlockTargets();
    renderCharacters();
    renderShiny();
  }
  function overlayNumber(key, value) {
    const parsed = numeric(value), spec = OVERLAY_NUMBERS[key];
    if (parsed === null) return null;
    const clamped = Math.min(spec.max, Math.max(spec.min, parsed));
    return key === 'x' || key === 'y' ? Math.round(clamped * 100) / 100 : key === 'refreshMs' ? Math.round(clamped / 250) * 250 : Math.round(clamped);
  }
  function overlaySettings() {
    const stored = currentConfig().overlay;
    const raw = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
    const config = { ...DEFAULT_OVERLAY, ...raw,
      fields: { ...DEFAULT_OVERLAY.fields, ...(raw.fields && typeof raw.fields === 'object' && !Array.isArray(raw.fields) ? raw.fields : {}) } };
    for (const key of ['enabled', 'compactNumbers', 'hidePaused', 'autoPage']) config[key] = typeof config[key] === 'boolean' ? config[key] : DEFAULT_OVERLAY[key];
    for (const [key] of [...OVERLAY_FIELDS, ...OVERLAY_EXTRA_FIELDS]) config.fields[key] = typeof config.fields[key] === 'boolean' ? config.fields[key] : DEFAULT_OVERLAY.fields[key] === true;
    for (const [key, spec] of Object.entries(OVERLAY_NUMBERS)) {
      config[key] = overlayNumber(key, config[key]) ?? DEFAULT_OVERLAY[key];
    }
    for (const key of ['fontColor', 'backgroundColor']) if (!/^#[0-9a-f]{6}$/i.test(config[key])) config[key] = DEFAULT_OVERLAY[key];
    const rawTeam = raw.team && typeof raw.team === 'object' && !Array.isArray(raw.team) ? raw.team : {};
    config.team = { ...DEFAULT_OVERLAY_TEAM, ...rawTeam,
      fields: { ...DEFAULT_OVERLAY_TEAM.fields, ...(rawTeam.fields && typeof rawTeam.fields === 'object' && !Array.isArray(rawTeam.fields) ? rawTeam.fields : {}) } };
    for (const key of ['enabled', 'shareStats', 'includeSelf', 'sameAreaOnly']) config.team[key] = typeof config.team[key] === 'boolean' ? config.team[key] : false;
    for (const [key] of OVERLAY_TEAM_FIELDS) config.team.fields[key] = config.team.fields[key] === true;
    if (!['damage', 'slot', 'name'].includes(config.team.sort)) config.team.sort = 'damage';
    for (const [key, spec] of Object.entries(OVERLAY_TEAM_NUMBERS)) config.team[key] = numeric(config.team[key]) === null
      ? DEFAULT_OVERLAY_TEAM[key] : Math.round(Math.min(spec.max, Math.max(spec.min, Number(config.team[key]))));
    return config;
  }
  function saveOverlay(patch) {
    const current = overlaySettings();
    return saveConfig({ overlay: { ...current, ...patch, fields: { ...current.fields, ...patch.fields },
      team: { ...current.team, ...patch.team, fields: { ...current.team.fields, ...patch.team?.fields } } } });
  }
  function buildOverlaySettings() {
    const toggle = (root, key, label, field = false, detail = '', team = false) => {
      const row = element('label', 'setting-row'), text = element('span', 'setting-label');
      text.append(element('strong', '', label)); if (detail) text.append(element('small', '', detail));
      const box = element('span', 'switch'), input = document.createElement('input');
      input.type = 'checkbox'; input.id = `overlay-${team ? 'team-' : ''}${key}`; input.setAttribute('aria-label', label);
      input.addEventListener('change', () => { const patch = field ? { fields: { [key]: input.checked } } : { [key]: input.checked }; saveOverlay(team ? { team: patch } : patch); });
      box.append(input, element('span', 'switch-track')); row.append(text, box); root.append(row);
    };
    toggle($('overlay-main-options'), 'enabled', '显示悬浮窗', false, '默认开启，只在当前游戏画面内显示。');
    toggle($('overlay-main-options'), 'hidePaused', '原生暂停页面自动隐藏', false, '显示游戏暂停页时隐藏，返回战斗后恢复。');
    for (const [key, label, detail] of OVERLAY_FIELDS) toggle($('overlay-field-options'), key, label, true, detail);
    for (const [key, label, detail] of OVERLAY_EXTRA_FIELDS) toggle($('overlay-extra-fields'), key, label, true, detail);
    $('overlay-extra-options').hidden = !OVERLAY_EXTRA_FIELDS.length;
    toggle($('overlay-team-main-options'), 'enabled', '开启队友战斗信息', false, '总开关默认关闭；关闭后停止队友采集与本机统计共享。', true);
    toggle($('overlay-team-main-options'), 'shareStats', '共享本机战斗统计给当前队友', false, '开启后按队友订阅读取并提供本局输出、承伤、招式、道具和维生素等统计；本机显示项关闭不撤回共享授权。查看对方统计无需共享自己。仅当前合作队伍的游戏连接传递，可能经过游戏中继，不使用本工具的上传接口、不保存战斗历史。', true);
    toggle($('overlay-team-main-options'), 'includeSelf', '队伍对照中包含自己', false, '在队友分组中也列出本机角色，便于对照。', true);
    toggle($('overlay-team-main-options'), 'sameAreaOnly', '只显示同区域成员', false, '按当前原生区域筛选；不主动查询其他区域。', true);
    for (const [key, label, detail] of OVERLAY_TEAM_FIELDS) toggle($('overlay-team-fields'), key, label, true, detail, true);
    const teamSort = element('label', 'overlay-select-row'), teamSortSelect = document.createElement('select');
    teamSort.htmlFor = 'overlay-team-sort'; teamSort.append(element('span', '', '队友排序')); teamSortSelect.id = 'overlay-team-sort'; teamSortSelect.setAttribute('aria-label', '队友排序');
    for (const [value, label] of [['damage', '累计输出从高到低'], ['slot', '原生队伍顺序'], ['name', '队友名称']]) { const option = document.createElement('option'); option.value = value; option.textContent = label; teamSortSelect.append(option); }
    teamSortSelect.addEventListener('change', () => saveOverlay({ team: { sort: teamSortSelect.value } })); teamSort.append(teamSortSelect); $('overlay-team-value-options').append(teamSort);
    for (const [key, spec] of Object.entries(OVERLAY_TEAM_NUMBERS)) {
      const row = element('div', 'overlay-number-row'), label = element('label', '', `${spec.label} (${spec.unit})`), controls = element('div', 'overlay-stepper'), input = document.createElement('input');
      label.htmlFor = `overlay-team-${key}`; input.id = `overlay-team-${key}`; input.type = 'number'; input.min = spec.min; input.max = spec.max; input.step = spec.step; input.setAttribute('aria-label', spec.label);
      const commit = value => { const parsed = numeric(value); if (parsed === null) { input.setAttribute('aria-invalid', 'true'); return; } const next = Math.round(Math.min(spec.max, Math.max(spec.min, parsed))); input.value = next; input.setAttribute('aria-invalid', 'false'); saveOverlay({ team: { [key]: next } }); };
      input.addEventListener('change', () => commit(input.value));
      for (const direction of [-1, 1]) { const button = element('button', '', direction < 0 ? '−' : '+'); button.type = 'button'; button.id = `overlay-team-${key}-${direction < 0 ? 'minus' : 'plus'}`; button.setAttribute('aria-label', `${direction < 0 ? '减少' : '增加'}${spec.label}`); button.addEventListener('click', () => commit(overlaySettings().team[key] + direction)); if (direction < 0) controls.append(button, input); else controls.append(button); }
      row.append(label, controls); $('overlay-team-value-options').append(row);
    }
    $('overlay-team-common').addEventListener('click', () => saveOverlay({ team: { enabled: true, fields: Object.fromEntries(['identity', 'totalDamage', 'averageDps', 'recentDps', 'damageShare', 'health', 'status'].map(key => [key, true])) } }));
    $('overlay-team-clear').addEventListener('click', () => saveOverlay({ team: { enabled: false, shareStats: false, fields: { ...DEFAULT_OVERLAY_TEAM.fields } } }));
    toggle($('overlay-appearance-options'), 'autoPage', '内容超出时自动翻页', false, '按下方间隔轮换显示，避免信息挤出窗口。');
    const format = element('label', 'overlay-select-row'), select = document.createElement('select');
    format.htmlFor = 'overlay-number-format'; format.append(element('span', '', '数字格式'));
    select.id = 'overlay-number-format'; select.setAttribute('aria-label', '数字格式');
    for (const [value, label] of [['compact', '缩略数字 · K / M / B'], ['full', '完整数字']]) { const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option); }
    select.addEventListener('change', () => saveOverlay({ compactNumbers: select.value === 'compact' })); format.append(select); $('overlay-appearance-options').append(format);
    for (const [key, label] of [['fontColor', '文字颜色'], ['backgroundColor', '背景颜色']]) {
      const row = element('label', 'overlay-color-row'), input = document.createElement('input'), swatch = element('span', 'overlay-color-swatch');
      row.htmlFor = `overlay-${key}`; row.append(element('span', '', label));
      input.id = `overlay-${key}`; input.type = 'text'; input.maxLength = 7; input.placeholder = '#ffffff'; input.spellcheck = false; input.setAttribute('aria-label', label); input.setAttribute('aria-describedby', 'overlay-color-help');
      const commit = () => { const value = input.value.trim(); if (!/^#[0-9a-f]{6}$/i.test(value)) { input.setAttribute('aria-invalid', 'true'); showToast('颜色请输入 # 加六位十六进制数，例如 #ffffff。', true); return; } input.setAttribute('aria-invalid', 'false'); saveOverlay({ [key]: value.toLowerCase() }); };
      input.addEventListener('change', commit); row.append(swatch, input); $('overlay-appearance-options').append(row);
    }
    const colorHelp = element('p', 'editor-note', '颜色填写六位色值，例如白色 #ffffff、黑色 #000000。'); colorHelp.id = 'overlay-color-help'; $('overlay-appearance-options').append(colorHelp);
    for (const [key, spec] of Object.entries(OVERLAY_NUMBERS)) {
      const row = element('div', 'overlay-number-row'), label = element('label', '', `${spec.label} (${spec.unit})`), controls = element('div', 'overlay-stepper'), input = document.createElement('input');
      row.id = `overlay-${key}-row`;
      label.htmlFor = `overlay-${key}`; input.id = `overlay-${key}`; input.type = 'number'; input.min = spec.min; input.max = spec.max; input.step = key === 'x' || key === 'y' ? 'any' : spec.step; input.setAttribute('aria-label', spec.label);
      const commit = value => { const next = overlayNumber(key, value); if (next === null) { input.setAttribute('aria-invalid', 'true'); return; } input.value = next; input.setAttribute('aria-invalid', 'false'); saveOverlay({ [key]: next }); };
      input.addEventListener('change', () => commit(input.value));
      for (const direction of [-1, 1]) { const button = element('button', '', direction < 0 ? '−' : '+'); button.type = 'button'; button.id = `overlay-${key}-${direction < 0 ? 'minus' : 'plus'}`; button.setAttribute('aria-label', `${direction < 0 ? '减少' : '增加'}${spec.label}`); button.addEventListener('click', () => commit(overlaySettings()[key] + direction * spec.step)); if (direction < 0) controls.append(button, input); else controls.append(button); }
      row.append(label, controls); $(`overlay-${spec.group}-values`).append(row);
    }
    $('overlay-reset').addEventListener('click', () => { const current = overlaySettings(); saveOverlay({ ...DEFAULT_OVERLAY, fields: { ...current.fields, ...DEFAULT_OVERLAY.fields },
      team: { ...current.team, ...DEFAULT_OVERLAY_TEAM, fields: { ...current.team.fields, ...DEFAULT_OVERLAY_TEAM.fields } } }); });
  }
  function renderOverlaySettings() {
    if (!$('overlay-enabled')) return;
    const config = overlaySettings();
    for (const key of ['enabled', 'hidePaused', 'autoPage']) $(`overlay-${key}`).checked = config[key];
    for (const [key] of [...OVERLAY_FIELDS, ...OVERLAY_EXTRA_FIELDS]) $(`overlay-${key}`).checked = config.fields[key];
    for (const key of ['enabled', 'shareStats', 'includeSelf', 'sameAreaOnly']) $(`overlay-team-${key}`).checked = config.team[key];
    for (const [key] of OVERLAY_TEAM_FIELDS) $(`overlay-team-${key}`).checked = config.team.fields[key];
    if (document.activeElement !== $('overlay-team-sort')) $('overlay-team-sort').value = config.team.sort;
    for (const [key, spec] of Object.entries(OVERLAY_TEAM_NUMBERS)) {
      const input = $(`overlay-team-${key}`); if (document.activeElement !== input) { input.value = config.team[key]; input.setAttribute('aria-invalid', 'false'); }
      for (const direction of [-1, 1]) $(`overlay-team-${key}-${direction < 0 ? 'minus' : 'plus'}`).disabled = direction < 0 ? config.team[key] <= spec.min : config.team[key] >= spec.max;
    }
    $('overlay-team-empty-help').hidden = !config.team.enabled || OVERLAY_TEAM_FIELDS.some(([key]) => config.team.fields[key]);
    if (document.activeElement !== $('overlay-number-format')) $('overlay-number-format').value = config.compactNumbers ? 'compact' : 'full';
    for (const key of [...Object.keys(OVERLAY_NUMBERS), 'fontColor', 'backgroundColor']) {
      const input = $(`overlay-${key}`); if (document.activeElement !== input) { input.value = config[key]; input.setAttribute('aria-invalid', 'false'); }
      if (key === 'page') input.disabled = config.autoPage;
      if (key.endsWith('Color')) input.previousElementSibling.style.backgroundColor = config[key];
    }
    $('overlay-page-row').hidden = config.autoPage;
    $('overlay-page-help').hidden = config.autoPage;
    for (const [key, spec] of Object.entries(OVERLAY_NUMBERS)) for (const direction of [-1, 1]) $(`overlay-${key}-${direction < 0 ? 'minus' : 'plus'}`).disabled = key === 'page' && config.autoPage || (direction < 0 ? config[key] <= spec.min : config[key] >= spec.max);
  }
  function convenienceSettings() {
    const raw=currentConfig().convenience || {}, result={...raw};
    for(const [group,defaults] of Object.entries(DEFAULT_CONVENIENCE)) {
      const input=raw[group] && typeof raw[group]==='object' && !Array.isArray(raw[group]) ? raw[group] : {};
      result[group]={...defaults,...input};
      for(const [key,fallback] of Object.entries(defaults)) if(typeof fallback==='boolean' && typeof input[key]!=='boolean') result[group][key]=fallback;
    }
    result.alerts.events={...DEFAULT_CONVENIENCE.alerts.events,...result.alerts.events};
    return result;
  }
  function saveConvenience(group,patch) {
    const config=convenienceSettings(), next={...config[group],...patch};
    if(group==='alerts' && patch.events) next.events={...config.alerts.events,...patch.events};
    return saveConfig({convenience:{[group]:next}});
  }
  function buildRhythmFields(root) {
    convenienceToggle(root,'rhythm','randomDelay','随机操作延迟');
    root.append(element('p','editor-note help-note','解锁角色和自动推进的单人暂停选择固定等待3—10秒，不可关闭，不受此开关或范围影响。合作倒计时与即时移动不套用该等待；随机等待不构成防封号保证。'));
    root.append($('rhythm-delay-range'));
    convenienceToggle(root,'rhythm','betweenRunWait','局间随机等待');
    convenienceNumber(root,'rhythm','betweenRunWaitMinSeconds','最短局间等待（秒）',0,86400);
    convenienceNumber(root,'rhythm','betweenRunWaitMaxSeconds','最长局间等待（秒）',0,86400);
    convenienceToggle(root,'rhythm','inspectPanel','偶尔短暂查看游戏面板');
    root.append(element('p','editor-note help-note','安全时机约15—30分钟查看一次，2—4秒后继续；操作面板即交还控制，重要交互优先。'));
    convenienceToggle(root,'rhythm','activationSchedule','脚本启用时间');
    for(const [key,label] of [['activationStart','开始（北京时间）'],['activationEnd','结束（北京时间）']]) {
      const row=element('label','overlay-select-row',label),input=document.createElement('input');input.type='time';input.step='60';
      input.dataset.convenienceGroup='rhythm';input.dataset.convenienceKey=key;input.id='convenience-rhythm-'+key;
      input.addEventListener('change',()=>{if(/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input.value))saveConvenience('rhythm',{[key]:input.value});else showToast('请填写有效的24小时制时间。',true);});row.append(input);root.append(row);
    }
    const days=element('div','convenience-check-grid');
    for(let day=1;day<=7;day++) {
      const row=element('label','convenience-option'),input=document.createElement('input');input.type='checkbox';input.dataset.rhythmDay=day;
      input.addEventListener('change',()=>{const selected=[...days.querySelectorAll('input:checked')].map(x=>Number(x.dataset.rhythmDay));if(!selected.length){input.checked=true;showToast('至少选择一个星期。',true);return;}saveConvenience('rhythm',{activationDays:selected});});
      row.append(input,element('span','','周'+'一二三四五六日'[day-1]));days.append(row);
    }
    root.append(days,element('p','editor-note','起止相同表示所选日全天；跨午夜时，结束时间归次日。关闭脚本启用时间时不限时段。'));
  }
  function convenienceToggle(root,group,key,label,nested=false) {
    const row=element('label','convenience-option'), input=document.createElement('input');
    input.type='checkbox';input.id=`convenience-${group}-${key}`;input.dataset.convenienceGroup=group;input.dataset.convenienceKey=key;
    if(nested) input.dataset.convenienceNested='events';
    input.addEventListener('change',()=>saveConvenience(group,nested ? {events:{[key]:input.checked}} : {[key]:input.checked}));
    row.append(input,element('span','',label));root.append(row);
  }
  function convenienceNumber(root,group,key,label,min,max,step=1) {
    const row=element('div','overlay-number-row'), name=element('label','',label), controls=element('div','overlay-stepper'),input=document.createElement('input');
    input.id=`convenience-${group}-${key}`;input.type='number';input.min=min;input.max=max;input.step='1';name.htmlFor=input.id;
    input.dataset.convenienceGroup=group;input.dataset.convenienceKey=key;
    const commit=value=>{const number=numeric(value);if(number===null){input.setAttribute('aria-invalid','true');return;}const next=Math.max(min,Math.min(max,Math.round(number)));input.value=next;input.setAttribute('aria-invalid','false');saveConvenience(group,{[key]:next});};
    input.addEventListener('change',()=>commit(input.value));
    for(const direction of [-1,1]) {const button=element('button','',direction<0?'−':'+');button.type='button';button.setAttribute('aria-label',`${direction<0?'减少':'增加'}${label}`);button.addEventListener('click',()=>commit((numeric(convenienceSettings()[group][key]) ?? min)+direction*step));if(direction<0)controls.append(button,input);else controls.append(button);}
    row.append(name,controls);root.append(row);
  }
  function convenienceSelect(root,group,key,label,options) {
    const row=element('label','overlay-select-row'),select=document.createElement('select');
    row.htmlFor=`convenience-${group}-${key}`;select.id=row.htmlFor;select.dataset.convenienceGroup=group;select.dataset.convenienceKey=key;
    for(const [value,text] of options)select.add(new Option(text,value));
    select.addEventListener('change',()=>saveConvenience(group,{[key]:select.value}));row.append(element('span','',label),select);root.append(row);
  }
  function buildConvenienceSettings() {
    for(const [key,title] of CONVENIENCE_FEATURES) {
      const button=element('button','convenience-feature');button.type='button';button.dataset.convenienceFeature=key;button.id=`convenience-feature-${key}`;
      button.append(element('strong','',title),element('small','',key==='favorite'?'点击时保存':key==='buildImport'?'点击时导入':'默认关闭'));
      button.addEventListener('click',()=>selectConvenienceFeature(key));$('convenience-nav').append(button);
    }
    selectConvenienceFeature('rhythm');
  }
  function behaviorToggle(root,key,title=null,description=null) {
    const spec=SETTING_FIELDS.find(row=>row[0]===key);
    title ||= spec?.[1] || key; description ??= spec?.[2] || '';
    const row=element('label','setting-row convenience-behavior-row'),text=element('span','setting-label'),toggle=element('span','switch'),input=document.createElement('input');
    input.type='checkbox';input.id=`setting-${key}`;input.dataset.flatSetting=key;input.setAttribute('aria-label',title);
    input.addEventListener('change',()=>saveConfig({[key]:input.checked}));
    text.append(element('strong','',title),element('small','',description));toggle.append(input,element('span','switch-track'));row.append(text,toggle);root.append(row);
  }
  function costEffects() { return Array.isArray(catalog.costEffects)?catalog.costEffects.filter(effect=>effect&&typeof effect.id==='string'&&typeof effect.label==='string'):[]; }
  function costEffectName(key) { return costEffects().find(effect=>effect.id===key)?.label || (key?'已保存（目录暂不可用）':'自动选择'); }
  function buildCostPriorities(root) {
    const entries=costEffects(),fields=element('div','replacement-fields cost-priority-fields');
    fields.append(element('p','editor-note help-note','按1—10顺序查找本次选项中的真实正面效果；跳过空项和未出现的效果，全部未命中时使用默认策略。留空不禁用交互，不同位置可以重复选择同一效果。'));
    if(!entries.length)fields.append(element('p','replacement-error','当前版本的代价效果目录暂不可用，已保存的顺序会保留；其他页面和功能可正常使用。'));
    for(let index=0;index<10;index++) {
      const field=element('div','replacement-field'),label=element('label','',`优先级 ${index+1}`),combo=element('div','replacement-combobox'),input=document.createElement('input'),open=element('button','replacement-dropdown','▾'),options=element('div','replacement-options'),error=element('p','replacement-error');
      const savedKey=()=>currentConfig().costEffectPriorities[index]||'',savedName=()=>costEffectName(savedKey());
      input.id=`cost-effect-${index+1}`;input.type='search';input.autocomplete='off';input.placeholder='搜索正面效果';input.value=savedName();input.dataset.costPriority=String(index);
      input.setAttribute('role','combobox');input.setAttribute('aria-expanded','false');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-controls',`cost-effect-options-${index+1}`);label.htmlFor=input.id;
      open.type='button';open.setAttribute('aria-label',`展开优先级 ${index+1}效果`);options.id=`cost-effect-options-${index+1}`;options.setAttribute('role','listbox');options.hidden=true;
      let visible=[],active=-1,applying=false;
      const hide=()=>{options.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');};
      const commit=key=>{if(applying)return;applying=true;hide();error.textContent='';input.setAttribute('aria-invalid','false');const priorities=[...currentConfig().costEffectPriorities];if(priorities[index]!==key){priorities[index]=key;saveConfig({costEffectPriorities:priorities});}input.value=costEffectName(key);};
      const draw=all=>{options.replaceChildren();active=-1;const term=all?'':searchText(input.value);visible=[{id:'',label:'自动选择',description:'此位置不指定效果'},...entries].filter(entry=>!entry.id||!term||searchText([entry.label,entry.id,entry.description].join(' ')).includes(term));
        for(const [position,entry]of visible.entries()){const button=element('button','replacement-option');button.type='button';button.id=`${options.id}-${position}`;button.setAttribute('role','option');button.setAttribute('aria-selected',String(entry.id===savedKey()));button.append(element('strong','',entry.label));if(entry.description)button.append(element('small','',entry.description));button.addEventListener('pointerdown',event=>event.preventDefault());button.addEventListener('click',()=>commit(entry.id));options.append(button);}
        if(visible.length===1&&term)options.append(element('p','replacement-note','没有匹配效果，请从当前游戏目录中选择。'));options.hidden=false;input.setAttribute('aria-expanded','true');};
      input.disabled=open.disabled=!entries.length;
      input.addEventListener('focus',()=>{applying=false;draw(true);});input.addEventListener('input',()=>{applying=false;error.textContent='';input.setAttribute('aria-invalid','false');draw(false);});
      open.addEventListener('pointerdown',event=>event.preventDefault());open.addEventListener('click',()=>{if(options.hidden){input.focus();draw(true);}else hide();});
      input.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();hide();input.value=savedName();}else if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();if(options.hidden)draw(true);active=Math.max(0,Math.min(visible.length-1,active+(event.key==='ArrowDown'?1:-1)));options.querySelectorAll('button').forEach((button,position)=>button.classList.toggle('active',position===active));input.setAttribute('aria-activedescendant',`${options.id}-${active}`);options.children[active]?.scrollIntoView({block:'nearest'});}else if(event.key==='Enter'){event.preventDefault();const exact=entries.filter(entry=>entry.id===input.value.trim()||entry.label===input.value.trim());if(active>=0)commit(visible[active].id);else if(!input.value.trim()||input.value==='自动选择')commit('');else if(exact.length===1)commit(exact[0].id);}});
      input.addEventListener('blur',()=>setTimeout(()=>{if(applying||combo.contains(document.activeElement))return;hide();if(input.value===savedName())return;const exact=entries.filter(entry=>entry.id===input.value.trim()||entry.label===input.value.trim());if(!input.value.trim()||input.value==='自动选择')commit('');else if(exact.length===1)commit(exact[0].id);else{input.value=savedName();input.setAttribute('aria-invalid','true');error.textContent='请从下拉结果中选择；未匹配的文字没有保存。';}},0));
      combo.append(input,open,options);field.append(label,combo,error);fields.append(field);
    }
    root.append(fields);
  }
  function timedBehaviorSeconds(root,key,label) {
    const row=element('div','overlay-number-row timed-behavior-seconds'),title=element('label','',`${label}（秒）`),controls=element('div','overlay-stepper'),input=document.createElement('input');
    input.type='number';input.min='0';input.max='604800';input.step='1';input.inputMode='numeric';input.id=`setting-${key}`;input.dataset.flatSetting=key;title.htmlFor=input.id;input.setAttribute('aria-label',label);
    const commit=raw=>{const text=String(raw),value=Number(text);if(!/^\d+$/.test(text)||!Number.isInteger(value)||value<0||value>604800){input.setAttribute('aria-invalid','true');showToast('时间请输入0—604800的整数秒；0秒表示立即生效。',true);return;}input.setAttribute('aria-invalid','false');input.value=String(value);if(currentConfig()[key]!==value)saveConfig({[key]:value});};
    input.addEventListener('beforeinput',event=>{if(event.data&&/\D/.test(event.data))event.preventDefault();});
    input.addEventListener('keydown',event=>{if(['e','E','+','-','.',','].includes(event.key))event.preventDefault();});
    input.addEventListener('input',()=>input.setAttribute('aria-invalid',String(!/^\d+$/.test(input.value)||Number(input.value)>604800)));
    input.addEventListener('change',()=>commit(input.value));
    for(const direction of [-1,1]){const button=element('button','',direction<0?'−':'+');button.type='button';button.setAttribute('aria-label',`${direction<0?'减少':'增加'}${label}`);button.addEventListener('click',()=>commit(Math.max(0,Math.min(604800,currentConfig()[key]+direction))));if(direction<0)controls.append(button,input);else controls.append(button);}
    row.append(title,controls);root.append(row);
  }
  function buildBehaviorFields(root,group) {
    if(group==='cost'){for(const key of BEHAVIOR_GROUPS[group])behaviorToggle(root,key);buildCostPriorities(root);return;}
    if(group==='strategy'){for(const key of BEHAVIOR_GROUPS[group])behaviorToggle(root,key);timedBehaviorSeconds(root,'noInteractionsAfterSeconds','停止交互时间');root.append(element('p','editor-note help-note','按本局原生游戏时间生效，暂停和菜单等待不会当作游戏时间。0秒表示立即；未开启上方开关时仅保存时间。'));return;}
    if(group!=='movement') { for(const key of BEHAVIOR_GROUPS[group])behaviorToggle(root,key);return; }
    behaviorToggle(root,'jumpMove');behaviorToggle(root,'slideMove');behaviorToggle(root,'bossRetreat');
    const orbit=element('div','flight-movement-options');behaviorToggle(orbit,'fullMapOrbit');timedBehaviorSeconds(orbit,'fullMapOrbitAfterSeconds','环飞开始时间');orbit.append(element('p','editor-note help-note','按本局原生游戏时间生效，0秒表示立即。环飞不要求先开启飞行移动；触发后不为敌方身体或攻击范围改道。允许交互时先落地处理再继续；已开启“不再交互”或“后续不再交互”已到时，则只保持移动，不主动使用终极技或退局，原生自动攻击与强制选择照常。'));root.append(orbit);
    const flight=element('div','flight-movement-options');
    behaviorToggle(flight,'flightMove','飞行移动','达到指定跳跃道具数量后，在原生允许时持续跳跃并扩大巡航范围，不为敌方身体或攻击范围改道，仍遵守地图墙体与边界；允许交互并保持交互时，先落地完成，再恢复飞行。');
    behaviorToggle(flight,'flightKeepInteractions');
    const row=element('div','overlay-number-row flight-threshold'),label=element('label','','跳跃道具数量'),controls=element('div','overlay-stepper'),input=document.createElement('input');
    input.type='number';input.min='1';input.max='99';input.step='1';input.id='setting-flightJumpItemCount';input.dataset.flatSetting='flightJumpItemCount';label.htmlFor=input.id;input.setAttribute('aria-label','跳跃道具数量');
    const commit=value=>{const n=numeric(value);if(n===null||!Number.isInteger(n)||n<1||n>99){input.setAttribute('aria-invalid','true');showToast('跳跃道具数量请输入1—99的整数。',true);return;}input.setAttribute('aria-invalid','false');input.value=String(n);saveConfig({flightJumpItemCount:n});};
    input.addEventListener('change',()=>commit(input.value));
    for(const direction of [-1,1]){const button=element('button','',direction<0?'−':'+');button.type='button';button.setAttribute('aria-label',direction<0?'减少跳跃道具数量':'增加跳跃道具数量');button.addEventListener('click',()=>commit(Math.max(1,Math.min(99,(numeric(currentConfig().flightJumpItemCount)??5)+direction))));if(direction<0)controls.append(button,input);else controls.append(button);}
    row.append(label,controls);flight.append(row);
    behaviorToggle(flight,'flightNoInteractions','不再交互','仅在飞行移动达到道具门槛或全图环飞达到时间门槛后生效：停止主动拾取、捕捉、购买、召唤、换关、终极技及目标完成退局。此选项优先于环飞交互；原生自动攻击不变，强制选择正常处理。“后续不再交互”仍仅到设定时间才生效。');
    flight.append(element('p','editor-note help-note','数量按当前持有的气球道具计算。飞行依赖原生跳跃、状态和地形，不保证无限滞空或无伤。数量不足或关闭飞行后，自动恢复原有行动策略。'));root.append(flight);
  }
  function behaviorGroupStatus(group) {
    const flat=currentConfig(),count=BEHAVIOR_GROUPS[group].filter(key=>flat[key]===true&&(key!=='flightKeepInteractions'||flat.flightMove===true)).length;
    return count?`${count}项已开启`:'均已关闭';
  }
  function selectConvenienceFeature(group) {
    const feature=CONVENIENCE_FEATURES.find(([key])=>key===group);if(!feature)return;
    if(convenienceFeature==='wecom')closeWecomView();
    convenienceFeature=group;setText('convenience-title',feature[1]);setText('convenience-description',feature[2]);setText('convenience-detail-note',feature[3]);
    const root=$('convenience-fields');
    const delayRange=$('rhythm-delay-range');if(delayRange && root.contains(delayRange))$('rhythm-delay-parking').append(delayRange);
    root.replaceChildren();
    if(group==='wecom'){buildWecomFields(root);renderConvenienceSettings();refreshWecomStatus();return;}
    if(group==='buildImport'){buildVisibleImportFields(root);renderConvenienceSettings();return;}
    if(BEHAVIOR_GROUPS[group]) {buildBehaviorFields(root,group);renderConvenienceSettings();return;}
    if(group==='favorite') {
      const label=element('label','convenience-name-label','收藏名称（可留空自动命名）'),input=document.createElement('input');input.type='text';input.id='convenience-favorite-name';input.maxLength=120;input.placeholder='例如：这局的稳健配装';input.value=convenienceFavoriteName;
      input.addEventListener('input',()=>{convenienceFavoriteName=input.value;});label.append(input);root.append(label);
      const button=element('button','button primary','一键收藏');button.id='convenience-favorite';button.type='button';
      button.addEventListener('click',async()=>{
        if(convenienceBusy)return;convenienceBusy=true;convenienceActionMessage='正在核对当前原生对局并保存配装…';renderConvenienceSettings();
        try {const response=await command('favoriteCurrentBuild',convenienceFavoriteName.trim()?{name:convenienceFavoriteName.trim()}:{});
          if(response?.saved===false)throw new Error(nameOf(response.reason,'当前原生对局尚不能收藏，请稍后重试。'));
          const savedName=first(response?.name,response?.plan?.name);
          convenienceActionMessage=nameOf(response?.message,`已收藏${savedName ? '“'+savedName+'”' : '当前配装'}。可在自定义方案中查看，默认仅手动选择，现用方案未切换。`);}
        catch(error){convenienceActionMessage=error.message || '未能确认当前对局，请在原生战斗、暂停或结算页重试。';}
        finally{convenienceBusy=false;renderConvenienceSettings();}
      });root.append(button);renderConvenienceSettings();return;
    }
    convenienceToggle(root,group,'enabled','开启'+feature[1]);
    const fields=element('div','convenience-detail-fields');root.append(fields);
    if(group==='rhythm') {
      buildRhythmFields(fields);
    } else if(group==='fusion') {
      for(const [key,label] of [['showLevels','显示原料当前等级'],['showLocks','显示原生锁定与欠缺条件'],['onlyHeldPartners','仅列与已持有招式组成的配方']])convenienceToggle(fields,group,key,label);
      convenienceNumber(fields,group,'fontSize','提示字体 (px)',10,20);convenienceNumber(fields,group,'rowsPerCard','每张卡片同时显示配方数',1,12);convenienceNumber(fields,group,'cycleSeconds','配方轮换间隔 (秒)',3,20);
      convenienceNumber(fields,group,'offsetX','融合提示水平偏移 (px)',-240,240,8);convenienceNumber(fields,group,'gap','提示与卡片间距 (px)',0,48,2);
      fields.append(element('p','editor-note help-note','融合提示显示在卡片下方；负数向左、正数向右，实际位置会避开刷新、跳过等按钮并限制在画面内。空间不足时会轮换或隐藏提示，不覆盖原生选择。'));
    } else if(group==='quantity') {
      for(const [key,label] of [['showLimit','显示原生持有上限'],['showVitamins','同时显示维生素等级'],['compactNumbers','数量使用 K / M / B 缩略']])convenienceToggle(fields,group,key,label);
      convenienceNumber(fields,group,'fontSize','数量字体 (px)',10,24);
    } else if(group==='alerts') {
      convenienceSelect(fields,group,'tone','提示音色',[['chime','清脆音'],['bell','铃声'],['soft','柔和音'],['pulse','短脉冲']]);
      convenienceNumber(fields,group,'volume','音量 (%)',0,100,5);convenienceNumber(fields,group,'cooldownSeconds','同类事件冷却 (秒)',3,120);convenienceNumber(fields,group,'lowHealthPercent','低生命提醒阈值 (%)',5,75,5);
      const test=element('button','button secondary small','试听提示音');test.type='button';test.id='convenience-test-sound';
      test.addEventListener('click',async()=>{test.disabled=true;try{const settings=convenienceSettings().alerts;await command('testConvenienceSound',{tone:settings.tone,volume:settings.volume});showToast('已播放一次提示音。');}catch(error){showToast(error.message,true);}finally{test.disabled=false;}});fields.append(test);
      const events=element('div','convenience-check-grid');events.append(element('h4','','提醒事件'));for(const [key,label] of CONVENIENCE_EVENTS)convenienceToggle(events,group,key,label,true);fields.append(events);
    } else if(group==='coop') {
      fields.append(element('p','editor-note help-note','等待传送只在至少一名当前区域队友实际就绪后才主动进入；全部未就绪或尚无可确认队友时等待。“不主动进入传送门”优先级更高；已经就绪时只尝试通过正常走位离开门区，不直接修改就绪状态，无法撤销已经提交的原生推进或队友触发的强制事件。已经打开且原生不能取消的必选页会保留，需手动选择；已付款抽奖仅完成原生动画。'));
      const options=element('div','convenience-check-grid');for(const [key,label] of CONVENIENCE_COOP)convenienceToggle(options,group,key,label);fields.append(options);
    } else if(group==='recommendations') {
      convenienceSelect(fields,group,'source','评分依据',[['recommended','当前推荐策略'],['currentPlan','当前使用方案']]);
      for(const [key,label] of [['showReasons','显示评分理由'],['showMoves','招式选择'],['showVitamins','维生素选择'],['showItems','道具选择'],['showOther','其他原生选择']])convenienceToggle(fields,group,key,label);
      convenienceNumber(fields,group,'fontSize','评分字体 (px)',10,24);convenienceNumber(fields,group,'opacity','评分提示不透明度 (%)',20,100,5);
      const row=element('label','overlay-color-row'),input=document.createElement('input');input.id='convenience-recommendations-color';input.type='text';input.maxLength=7;input.dataset.convenienceGroup=group;input.dataset.convenienceKey='color';row.htmlFor=input.id;row.append(element('span','','评分颜色'),input);
      input.addEventListener('change',()=>{if(!/^#[0-9a-f]{6}$/i.test(input.value.trim())){input.setAttribute('aria-invalid','true');showToast('颜色请输入 # 加六位色值，例如 #23795c。',true);return;}input.setAttribute('aria-invalid','false');saveConvenience(group,{color:input.value.trim().toLowerCase()});});fields.append(row);
    }
    renderConvenienceSettings();
  }
  function renderConvenienceSettings() {
    if(!$('convenience-nav')?.children.length)return;
    const config=convenienceSettings();
    for(const [key] of CONVENIENCE_FEATURES){const button=$(`convenience-feature-${key}`);button.classList.toggle('selected',key===convenienceFeature);button.setAttribute('aria-pressed',String(key===convenienceFeature));button.lastElementChild.textContent=key==='wecom'?wecomEnabledLabel():key==='favorite'?'点击时保存':key==='buildImport'?'点击时导入':BEHAVIOR_GROUPS[key]?behaviorGroupStatus(key):config[key].enabled?'已开启':'已关闭';}
    setText('convenience-enabled-status',convenienceFeature==='wecom'?wecomEnabledLabel():['favorite','buildImport'].includes(convenienceFeature)?'按需使用':BEHAVIOR_GROUPS[convenienceFeature]?behaviorGroupStatus(convenienceFeature):config[convenienceFeature].enabled?'已开启':'已关闭');
    if(convenienceFeature==='wecom')renderWecomSettings();
    document.querySelectorAll('#convenience-fields [data-flat-setting]').forEach(input=>{const value=currentConfig()[input.dataset.flatSetting];if(input.type==='checkbox')input.checked=value===true;else if(document.activeElement!==input)input.value=String(value??5);});
    document.querySelectorAll('#convenience-fields [data-cost-priority]').forEach(input=>syncBoundValue(input,costEffectName(currentConfig().costEffectPriorities[Number(input.dataset.costPriority)])));
    document.querySelectorAll('#convenience-fields [data-convenience-key]').forEach(input=>{const group=input.dataset.convenienceGroup,key=input.dataset.convenienceKey,value=input.dataset.convenienceNested?config[group].events[key]:config[group][key];if(input.type==='checkbox')input.checked=value===true;else if(document.activeElement!==input)input.value=value;});
    document.querySelectorAll('[data-rhythm-day]').forEach(input=>input.checked=config.rhythm.activationDays.includes(Number(input.dataset.rhythmDay)));
    if($('convenience-favorite')){$('convenience-favorite').disabled=convenienceBusy;$('convenience-favorite').textContent=convenienceBusy?'正在收藏…':'一键收藏';}
    if($('convenience-build-import')){$('convenience-build-import').disabled=convenienceImportBusy;$('convenience-build-import').textContent=convenienceImportBusy?'正在核对并导入…':'一键导入方案';}
    setText('convenience-action-status',convenienceFeature==='favorite'?convenienceActionMessage:convenienceFeature==='buildImport'?convenienceImportMessage:'');
  }

  function buildVisibleImportFields(root) {
    const characters=(catalog.characters||[]).filter(row=>Number.isInteger(Number(characterIdOf(row)))&&Number(characterIdOf(row))>0),
      entries=characters.map(row=>({id:Number(characterIdOf(row)),name:nameOf(row.name,'角色 '+characterIdOf(row))}));
    if(!entries.some(row=>row.id===convenienceImportSpecies))convenienceImportSpecies=Number(currentConfig().characterId)||entries[0]?.id||null;
    if(!entries.some(row=>row.id===convenienceImportSpecies))convenienceImportSpecies=entries[0]?.id||null;
    root.append(element('p','editor-note','① 在游戏中打开某一局的“配置”窗口。② 选择保存到哪个角色，可填写名称和备注。③ 点击一键导入，之后在“角色与配装”或“自定义方案”中选择。此功能不会关闭游戏窗口或切换现用方案。'));
    const row=element('div','replacement-field'),label=element('label','','保存到角色'),combo=element('div','replacement-combobox'),
      input=document.createElement('input'),open=element('button','replacement-dropdown','▾'),options=element('div','replacement-options'),error=element('p','replacement-error');
    input.id='convenience-import-species';input.type='search';input.autocomplete='off';input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-expanded','false');input.setAttribute('aria-controls','convenience-import-species-options');
    const selectedName=()=>entries.find(row=>row.id===convenienceImportSpecies)?.name||'';
    input.value=selectedName();input.placeholder='搜索角色名称或编号';label.htmlFor=input.id;
    options.id='convenience-import-species-options';options.hidden=true;options.setAttribute('role','listbox');open.type='button';open.setAttribute('aria-label','展开导入角色列表');
    let visible=[],active=-1;
    const hide=()=>{options.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');};
    const commit=id=>{convenienceImportSpecies=id;input.value=selectedName();input.setAttribute('aria-invalid','false');error.textContent='';hide();};
    const draw=all=>{const term=all?'':searchText(input.value);visible=entries.filter(row=>!term||searchText(`${row.name} ${row.id}`).includes(term));active=-1;options.replaceChildren();
      for(const[position,item]of visible.entries()){const button=element('button','replacement-option');button.type='button';button.id=`${options.id}-${position}`;button.setAttribute('role','option');button.setAttribute('aria-selected',String(item.id===convenienceImportSpecies));button.append(element('strong','',item.name),element('small','',String(item.id)));button.addEventListener('pointerdown',event=>event.preventDefault());button.addEventListener('click',()=>commit(item.id));options.append(button);}
      if(!visible.length)options.append(element('p','replacement-note','没有匹配角色，请从当前目录选择。'));options.hidden=false;input.setAttribute('aria-expanded','true');};
    input.addEventListener('focus',()=>draw(true));input.addEventListener('input',()=>{convenienceImportSpecies=null;error.textContent='';draw(false);});
    open.addEventListener('pointerdown',event=>event.preventDefault());open.addEventListener('click',()=>{if(options.hidden){input.focus();draw(true);}else hide();});
    input.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();hide();input.value=selectedName();}else if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();if(options.hidden)draw(true);active=Math.max(0,Math.min(visible.length-1,active+(event.key==='ArrowDown'?1:-1)));options.querySelectorAll('button').forEach((button,index)=>button.classList.toggle('active',index===active));options.children[active]?.scrollIntoView({block:'nearest'});}else if(event.key==='Enter'){event.preventDefault();if(active>=0&&visible[active])commit(visible[active].id);else{const exact=entries.filter(row=>row.name===input.value.trim()||String(row.id)===input.value.trim());if(exact.length===1)commit(exact[0].id);}}});
    input.addEventListener('blur',()=>setTimeout(()=>{if(combo.contains(document.activeElement))return;hide();if(input.value===selectedName())return;const exact=entries.filter(row=>row.name===input.value.trim()||String(row.id)===input.value.trim());if(exact.length===1)commit(exact[0].id);else{convenienceImportSpecies=null;input.setAttribute('aria-invalid','true');error.textContent='请从下拉框选择一个角色，未匹配的文字不能导入。';}},0));
    combo.append(input,open,options);row.append(label,combo,error);root.append(row);
    const nameLabel=element('label','convenience-name-label','方案名称（可留空）'),name=document.createElement('input');name.type='text';name.id='convenience-import-name';name.maxLength=120;name.value=convenienceImportName;name.placeholder='例如：状态伤害融合配装';name.addEventListener('input',()=>convenienceImportName=name.value);nameLabel.append(name);root.append(nameLabel);
    const noteLabel=element('label','convenience-name-label','备注（可留空）'),note=document.createElement('textarea');note.id='convenience-import-note';note.maxLength=1800;note.rows=3;note.value=convenienceImportNote;note.placeholder='自己记录用途或调整思路，不需要填写原玩家信息。';note.addEventListener('input',()=>convenienceImportNote=note.value);noteLabel.append(note);root.append(noteLabel);
    for(const[id,title,read,write]of [['auto','允许自动匹配（下次手动开始或重启后生效）',()=>convenienceImportAutoSelect,value=>convenienceImportAutoSelect=value],['dedupe','相同角色和配装不重复导入',()=>convenienceImportSkipDuplicates,value=>convenienceImportSkipDuplicates=value],['legacy','允许旧记录：缺失字段采用通用建议，并标注未知',()=>convenienceImportAllowLegacy,value=>convenienceImportAllowLegacy=value]]){
      const label=element('label','convenience-option'),checkbox=document.createElement('input');checkbox.id='convenience-import-'+id;checkbox.type='checkbox';checkbox.checked=read();checkbox.addEventListener('change',()=>write(checkbox.checked));label.append(checkbox,element('span','',title));root.append(label);
    }
    root.append(element('p','editor-note help-note','页面通常不包含优先级，导入时会依据公开效果补齐招式、道具、维生素的通用优先级、数量目标和属性权重。等级与数量保留实际显示值；实际获得仍受本局角色、原生资格、上限和融合条件限制。未显示的同行与原料锁不会编造。'));
    const button=element('button','button primary','一键导入方案');button.id='convenience-build-import';button.type='button';button.addEventListener('click',async()=>{
      if(convenienceImportBusy)return;
      if(!entries.some(row=>row.id===convenienceImportSpecies)||input.value!==selectedName()){convenienceImportMessage='请先从下拉框选择要保存到的角色。';renderConvenienceSettings();return;}
      const request={species:convenienceImportSpecies,name:convenienceImportName.trim(),description:convenienceImportNote.trim(),autoSelect:convenienceImportAutoSelect,allowLegacy:convenienceImportAllowLegacy,skipDuplicates:convenienceImportSkipDuplicates};
      convenienceImportBusy=true;convenienceImportMessage='正在读取当前配置窗口并补齐策略…';renderConvenienceSettings();
      try{const response=await command('importVisibleBuild',request);if(response?.saved===false&&!response?.duplicate)throw Error(nameOf(response.reason,'配置尚未确认，未保存不完整方案。'));
        const savedName=first(response?.name,response?.plan?.name),summary=response?.summary;
        convenienceImportMessage=response?.duplicate?`相同配装已存在${savedName?'：“'+savedName+'”':''}，原方案保留。`:`已导入${savedName?'“'+savedName+'”':''}${summary?`：${summary.moves}个招式、${summary.items}种道具、${summary.vitamins}种维生素`:'。'}；可到对应角色的方案下拉框选择，现用方案未切换。`;
        if(Array.isArray(response?.warnings)&&response.warnings.length)convenienceImportMessage+=' '+response.warnings.join(' ');
      }catch(error){convenienceImportMessage=error.message||'未能读取当前配置，请保持该局配置窗口打开后重试。';}
      finally{convenienceImportBusy=false;renderConvenienceSettings();}
    });root.append(button);
  }
  function validateDelayRange() {
    const minimum = $('random-delay-min'), maximum = $('random-delay-max');
    const min = minimum.valueAsNumber, max = maximum.valueAsNumber;
    let error = '';
    if (!Number.isFinite(min) || !Number.isFinite(max)) error = '请填写最短和最长等待秒数，不能留空。';
    else if (min < 0 || max < 0 || min > 30 || max > 30) error = '等待范围请设在 0–30 秒之间。';
    else if (min > max) error = '最短等待不能大于最长等待；调整两个值后会自动保存。';
    setText('random-delay-error', error); $('random-delay-error').hidden = !error;
    minimum.setAttribute('aria-invalid', String(Boolean(error))); maximum.setAttribute('aria-invalid', String(Boolean(error)));
    return error ? null : { randomDelayMinMs: Math.round(min * 1000), randomDelayMaxMs: Math.round(max * 1000) };
  }
  function saveDelayRange() {
    const patch = validateDelayRange(); if (!patch) return;
    delayRangeDirty = false; saveConvenience('rhythm',patch);
  }
  function renderDelayCadence() {
    const cadence = state.game?.cadence;
    const root = $('random-delay-status');
    if (!cadence || typeof cadence !== 'object') { root.hidden = true; return; }
    const status = nameOf(first(state.status, state.game?.status));
    if (cadence.waiting && /等待|等候/.test(status)) { root.hidden = true; return; }
    root.hidden = false;
    const config = currentConfig();
    const labels = { choice:'安全选择',select:'安全选择',upgrade:'选择强化',levelup:'选择强化',purchase:'购买',buy:'购买',copy:'复制道具',menu:'局外菜单' };
    if (cadence.waiting) {
      const action = nameOf(cadence.action), category = nameOf(cadence.category);
      const label = labels[action] || labels[category] || (/[^\x00-\x7f]/.test(action) ? action : '下一项安全操作');
      const remaining = Math.max(0, Number(cadence.remainingMs) || 0) / 1000;
      setText('random-delay-status', remaining > 0.05 ? `随机等候 ${remaining.toFixed(1)} 秒后${label}；移动、躲避与招式照常响应。` : `即将${label}；移动、躲避与招式照常响应。`);
    } else setText('random-delay-status', !convenienceSettings().rhythm.enabled || !convenienceSettings().rhythm.randomDelay ? '随机延迟已关闭（可配置项）；角色解锁、自动推进的固定暂停选择等待仍保留。' : '当前即时行动；遇到安全选择或局外菜单时再安排随机等候。');
  }

  function shinyCount(value) { return Array.isArray(value) ? value.length : value; }
  function hasShinyTargetCatalog() { return Array.isArray(state.game.shiny?.targets) || Array.isArray(catalog.shinyTargets); }
  function shinyTargets() { return Array.isArray(state.game.shiny?.targets) ? state.game.shiny.targets : Array.isArray(catalog.shinyTargets) ? catalog.shinyTargets : catalog.characters; }
  function shinyTypes(values=currentConfig().shinyTypes) { const selected=['shiny','classic'].filter(type=>Array.isArray(values)&&values.includes(type)); return selected.length?selected:['shiny','classic']; }
  function shinyOwnedIds() {
    const types=shinyTypes(),progress=state.game.shiny;
    if(Array.isArray(progress?.ownedIds)&&Array.isArray(progress.types)&&JSON.stringify(progress.types)===JSON.stringify(types))return new Set(progress.ownedIds.map(id=>String(Number(id))));
    const rows=types.map(type=>type==='classic'?first(state.profile?.classics,progress?.classicOwnedIds):first(state.profile?.shinies,state.profile?.shinyOwnedIds,state.shinyOwnedIds,state.game.shinyOwnedIds));
    if(rows.some(values=>!Array.isArray(values)))return null;
    return new Set(rows[0].filter(id=>rows.every(values=>values.some(value=>Number(value)===Number(id)))).map(id=>String(Number(id))));
  }
  function shinyAvailability(target) {
    if (!hasShinyTargetCatalog()) return { available: false, label: '等待读取', reason: '等待经过核实的异色目标目录。' };
    const status = String(first(target?.availability?.status, target?.availability?.state, target?.availability, '')).toLowerCase();
    const reason = nameOf(first(target?.reason, target?.availability?.reason, target?.description));
    const explicit = first(target?.huntable, target?.available, target?.availability?.huntable, target?.availability?.available);
    if (target?.live === false || /unreleased|future|not[-_ ]?live|未开放/.test(status)) return { available: false, label: '未开放', reason: reason || '当前游戏版本尚未开放此目标。' };
    if (explicit === false || /unavailable|unhuntable|unsupported|unknown|locked|no[-_ ]?source|legend[-_ ]?owned|不可|未知|未解锁|无来源/.test(status)) {
      const info = `${status} ${reason}`;
      const label = /challenge|挑战/.test(info) ? '挑战未解锁' : /map|biome|地图.*未解锁/.test(info) && /locked|未解锁/.test(info) ? '地图未解锁' : /legend.*owned|传奇.*入盟|传说.*入盟|不再出现|已加入联盟|不会再次生成/.test(info) ? '已入盟 · 不再遇' : /no[-_ ]?source|无来源|没有.*来源|unavailable|unknown|未知/.test(info) ? '暂无来源' : /locked|未解锁/.test(info) ? '未解锁' : '当前不可刷';
      return { available: false, label, reason: reason || '当前没有已核实的可刷途径。' };
    }
    const maps = Array.isArray(target?.maps) ? target.maps.map((entry) => typeof entry === 'object' ? first(entry.id, entry.key) : entry).filter(Boolean) : [];
    const knownMaps = maps.map((id) => catalog.maps.find((map) => String(first(map.id, map.key)) === String(id))).filter(Boolean);
    if (knownMaps.length === maps.length && maps.length && knownMaps.every((map) => map.live === false || map.available === false)) return { available: false, label: '未开放', reason: '该目标的可遇见地图尚未开放。' };
    const hasProfileMaps = state.profile?.biomes && typeof state.profile.biomes === 'object';
    if (hasProfileMaps && maps.length && knownMaps.length === maps.length && knownMaps.every((map) => map.live === false || map.available === false || Number(state.profile.biomes[first(map.id, map.key)] ?? -1) < 0)) return { available: false, label: '地图未解锁', reason: '请先解锁该目标可遇见的地图。' };
    return { available: true, label: '可遇见', reason: nameOf(target?.description) };
  }
  function renderShiny() {
    const config = currentConfig();
    const active = config.mode === 'shiny';
    $('shiny-options').hidden = !active;
    $('page-modes').classList.toggle('shiny-active', active);
    if (!active) return;
    const targetMode = config.shinyMode === 'target' || shinyPickerDraft;
    const selectedGoal = unlockCatalog().targets.find(target => target.id === selectedUnlockTarget('shiny'));
    const aggregateGoal = selectedGoal && !/^shiny:\d+$/.test(selectedGoal.id) && !shinyPickerDraft ? selectedGoal : null;
    const targets = shinyTargets();
    const owned = shinyOwnedIds();
    const progress = currentShinyProgress();
    const targetId = targetMode ? config.shinyTargetId : progress.targetId;
    const selected = targets.find((entry) => idKey(characterIdOf(entry)) === idKey(targetId));
    const selectedStatus = selected ? shinyAvailability(selected) : null;
    const selectedOwned = selected && owned?.has(idKey(characterIdOf(selected)));
    $('shiny-layout').classList.toggle('target-mode', targetMode);
    $('shiny-target-picker').hidden = !targetMode || Boolean(aggregateGoal);
    document.querySelectorAll('[data-shiny-mode]').forEach((node) => {
      const checked = node.dataset.shinyMode === (targetMode ? 'target' : 'missing');
      node.classList.toggle('selected', checked);
      node.setAttribute('aria-pressed', String(checked));
    });
    $('shiny-stop-when-done').checked = config.shinyStopWhenDone !== false;
    $('shiny-use-stone').checked = config.shinyUseStone === true;
    for(const type of ['shiny','classic'])$('shiny-type-'+type).checked=shinyTypes().includes(type);
    $('shiny-use-stone').disabled=!shinyTypes().includes('shiny');
    $('shiny-stage-wait').checked=config.shinyStageWait===true;
    $('shiny-stay-after-final-clear').checked=config.shinyStayAfterFinalClear===true;
    $('shiny-stay-after-final-clear').disabled=config.shinyStageWait!==true;
    if(document.activeElement!==$('shiny-stage-wait-seconds'))$('shiny-stage-wait-seconds').value=config.shinyStageWaitSeconds ?? 600;
    setText('shiny-stop-help', targetMode ? '仅指定目标生效：目标已拥有，或捕获并结算保存后暂停。' : '自动选择会继续下一个未拥有目标；没有可刷目标时提示并继续挂机。此开关仅用于指定目标。');
    const total = numeric(first(progress.total, hasShinyTargetCatalog() ? targets.length : null));
    const ownedCount = first(progress.owned, owned?.size);
    setText('shiny-collection', numeric(ownedCount) !== null ? `收藏 ${numberText(ownedCount)}${total !== null ? ` / ${numberText(total)}` : ''}` : '等待读取收藏');
    const missing = first(progress.huntableMissing, owned && hasShinyTargetCatalog() ? targets.filter((entry) => shinyAvailability(entry).available && !owned.has(idKey(characterIdOf(entry)))).length : null);
    setText('shiny-found', numberText(first(state.session.shiniesFound, progress.encounters)));
    setText('shiny-captured', numberText(shinyCount(progress.runCaptures)));
    setText('shiny-settled', numberText(shinyCount(state.session.newShinies)));
    setText('shiny-remaining', numberText(shinyCount(missing)));
    setText('shiny-target-total', targets.length);
    const targetName = aggregateGoal ? nameOf(aggregateGoal.name) : targetMode ? selected ? characterName(selected) : '请在列表中选择目标' : progress.targetName ? nameOf(progress.targetName) : '自动寻找未拥有异色';
    setText('shiny-current-target', targetName);
    let label = progress.complete ? '目标完成' : normalizedPaused() || state.paused ? '已暂停' : normalizedRunning() ? '搜寻中' : '等待开始';
    let message = nameOf(progress.message);
    if (aggregateGoal) {
      const goalState = unlockTargetState(aggregateGoal);
      label = goalState.label;
      message = goalState.reason || aggregateGoal.acquisition || aggregateGoal.description || '按已保存异色收藏逐项推进此奖励的前置；具体步骤见总览。';
    }
    else if (targetMode && !selected) { label = '待选择目标'; message = '在列表中选择一个异色目标；缺少前置时将先推进所需条件。'; }
    else if (targetMode && !selectedStatus.available) { label = selectedStatus.label; message = selectedStatus.reason; }
    else if (targetMode && selectedOwned && !progress.pendingSave && config.shinyStopWhenDone !== false && !progress.complete) { label = '已拥有'; message = '账号已拥有此异色。开启「目标完成后暂停」时会暂停；也可关闭后继续搜寻重复异色。'; }
    if (!message) message = targetMode ? `${selectedOwned ? '账号已拥有此异色，可继续搜寻重复异色。' : '优先探索可遇见目标的地图。'}实际出现与捕获仍受随机遭遇和战斗情况影响。` : owned ? '优先探索当前可遇见、账号尚未拥有的异色。' : '正在等待读取账号异色收藏，暂不判断是否已拥有。';
    setText('shiny-status-label', label);
    setText('shiny-current-message', message);
    $('shiny-status-label').classList.toggle('complete', Boolean(progress.complete));
    const search = $('shiny-search').value.trim().toLocaleLowerCase('zh-CN');
    const signature = JSON.stringify([targets.map((entry) => [characterIdOf(entry), entry.availability, entry.available, entry.huntable, entry.reason]), owned ? [...owned].sort() : null, state.profile?.biomes, config.shinyTargetId, shinyTypes(), search]);
    if (signature !== shinySignature) {
      shinySignature = signature;
      const root = $('shiny-target-list'); root.replaceChildren();
      const visible = targets.filter((entry) => !search || [characterName(entry), nameOf(entry.nameEn), characterIdOf(entry), ...typesOf(entry)].join(' ').toLocaleLowerCase('zh-CN').includes(search));
      for (const entry of visible) {
        const id = characterIdOf(entry);
        const status = shinyAvailability(entry);
        const isOwned = owned?.has(idKey(id));
        const card = element('button', 'shiny-target');
        card.type = 'button'; card.dataset.shinyTarget = String(id); card.setAttribute('role', 'listitem');
        card.disabled = !status.available && !unlockCatalog().targets.some(target => target.id === `shiny:${id}`);
        card.classList.toggle('selected', idKey(config.shinyTargetId) === idKey(id));
        card.classList.toggle('owned', Boolean(isOwned));
        card.setAttribute('aria-pressed', String(idKey(config.shinyTargetId) === idKey(id)));
        const title = `${characterName(entry)} · ${owned ? isOwned ? '已拥有' : '未拥有' : '收藏待同步'} · ${status.label}`;
        const maps = Array.isArray(entry.maps) ? entry.maps.map((map) => mapName(typeof map === 'object' ? first(map.id, map.key) : map)).filter(Boolean) : [];
        card.title = [title, maps.length ? `可遇见地图：${maps.join('、')}` : '', status.reason].filter(Boolean).join('；');
        const name = element('span', 'shiny-target-name', characterName(entry));
        const number = element('span', 'shiny-target-number', `#${String(id).padStart(3, '0')}`);
        const ownership = owned ? isOwned ? '已拥有' : '未拥有' : '待同步';
        card.append(number, name, element('span', 'shiny-target-state', `${ownership} · ${status.label}`));
        card.addEventListener('click', () => { shinyPickerDraft = false; saveConfig({ shinyMode: 'target', shinyTargetId: Number(id) }); });
        root.append(card);
      }
      if (!visible.length) root.append(element('div', 'empty-character', catalogLoaded ? '没有匹配的异色目标，试试其他名称或编号。' : '正在读取异色目标目录…'));
    }
    setText('shiny-target-note', selected ? `${characterName(selected)}${selected.maps?.length ? ` · ${selected.maps.map((map) => mapName(typeof map === 'object' ? first(map.id, map.key) : map)).join('、')}` : ''}${selectedOwned ? ' · 已拥有' : ''}。${selected.description ? nameOf(selected.description) : '可选择待前置目标，按原生获取条件推进；不保证随机异色出现。'}` : '可选择待前置目标；未开放内容会说明原因。「已拥有」以账号异色收藏为准。');
  }

  function renderCharacters(force = false) {
    const config = currentConfig();
    const search = $('character-search').value.trim().toLocaleLowerCase('zh-CN');
    const onlyUnlocked = $('unlocked-only').checked;
    const route = configuredNativeRoute();
    const signature = JSON.stringify([catalogGeneration, catalogLoaded, profileLeague(), config.characterId, search, onlyUnlocked, previewCharacterId]);
    // Live recommendations belong to the detail pane. They must not recreate
    // every character card, portrait and click handler when a build changes.
    if (force || signature !== characterSignature) {
    characterSignature = signature;
    const root = $('character-grid'); root.replaceChildren();
    const autoCard = element('button', 'character-card automatic-card');
    autoCard.type = 'button'; autoCard.setAttribute('role', 'listitem');
    autoCard.classList.toggle('selected', idKey(config.characterId) === 'auto');
    autoCard.setAttribute('aria-pressed', String(idKey(config.characterId) === 'auto'));
    const autoAvatar = element('span', 'character-avatar'); autoAvatar.append(icon('auto'));
    const autoInfo = element('span', 'character-info'); autoInfo.append(element('span', 'character-name', '自动选择'), element('span', 'character-label', '按目标匹配'));
    autoCard.append(autoAvatar, autoInfo);
    autoCard.addEventListener('click', () => { previewCharacterId = null; saveConfig({ characterId: null, build: 'auto' }); });
    if (!search) root.append(autoCard);
    const available = catalog.characters.filter((char) => {
      const match = [characterName(char), char.nameEn || '', characterIdOf(char), ...typesOf(char)].join(' ').toLocaleLowerCase('zh-CN').includes(search);
      return match && (!onlyUnlocked || isUnlocked(char) === true);
    });
    for (const char of available) {
      const id = characterIdOf(char);
      const unlocked = isUnlocked(char);
      const card = element('button', `character-card${unlocked === false ? ' locked' : ''}`);
      card.type = 'button'; card.setAttribute('role', 'listitem');
      const selected = idKey(id) === idKey(config.characterId);
      card.classList.toggle('selected', selected);
      card.classList.toggle('previewing', !selected && idKey(id) === idKey(previewCharacterId));
      card.setAttribute('aria-pressed', String(selected));
      card.title = `${characterName(char)}${typesOf(char).length ? ` · ${typesOf(char).join(' / ')}` : ''}${unlocked === false ? ' · 尚未解锁，可查看配装' : ''}`;
      const avatar = element('span', 'character-avatar', characterName(char).slice(0, 1));
      const portrait = first(char.portrait, char.image, char.sprite);
      if (typeof portrait === 'string' && /^(https:\/\/|data:image\/|[./])/.test(portrait)) {
        const img = document.createElement('img'); img.src = portrait; img.alt = ''; img.loading = 'lazy';
        img.addEventListener('error', () => avatar.replaceChildren(document.createTextNode(characterName(char).slice(0, 1))), { once: true });
        avatar.replaceChildren(img);
      }
      const dedicated = dedicatedBuild(char);
      const label = unlocked === false ? '未解锁 · 可查看方案' : `${dedicated ? '专属配装' : '通用方案'}${typesOf(char).length ? ` · ${typesOf(char).join('/')}` : ''}`;
      const info = element('span', 'character-info'); info.append(element('span', 'character-name', characterName(char)), element('span', 'character-label', label));
      card.append(avatar, info);
      if (unlocked === false) { const lock = element('span', 'character-lock'); lock.append(icon('lock')); card.append(lock); }
      card.addEventListener('click', () => {
        previewCharacterId = id;
        if (unlocked === false) {
          renderCharacters(true);
          showToast(`${characterName(char)}尚未解锁，已显示其通关方案。`);
          return;
        }
        saveConfig({ characterId: id, build: 'auto' });
      });
      root.append(card);
    }
    if (!available.length && (search || catalog.characters.length === 0)) root.append(element('div', 'empty-character', catalogLoaded ? (search ? '没有找到这个角色，试试其他名称或属性。' : '角色目录尚未提供，请等待游戏数据加载。') : '正在读取角色目录…'));
    setText('character-total', catalogLoaded ? catalog.characters.length : '待同步');
    const unlocked = unlockedIds();
    setText('character-availability', !catalogLoaded ? '角色目录正在同步，失败会自动重试；账号进度保持不变。' : unlocked ? `${unlocked.size} / ${catalog.characters.length} 已解锁 · 灰色角色可查看方案` : '等待账号同步后显示已解锁角色');
    }
    const char = previewCharacterId !== null ? findCharacter(previewCharacterId) : findCharacter(config.characterId);
    const locked = char ? isUnlocked(char) === false : false;
    const detailSignature = JSON.stringify([catalogGeneration, characterIdOf(char), locked, config.build, config.finalReplacements?.[String(characterIdOf(char))], config.mode, currentModeSettings(), route.biome, route.tier, route.nativeMode, state.game.buildId, state.game.characterId, state.game.species, state.game.tactics?.preferredMoves, state.game.tactics?.observedMoves, receivedCustomPlansSignature]);
    if (force || detailSignature !== buildDetailsSignature) { buildDetailsSignature = detailSignature; renderBuild(char, locked); }
  }

  function renderBuild(char, locked = false) {
    const dedicated = dedicatedBuild(char);
    const build = locked ? dedicated || catalog.builds.find((entry) => isGenericBuild(entry)) : currentBuild(char);
    const generic = isGenericBuild(build), guideBuild = isGuideBuild(build);
    setText('build-kind', locked ? '方案预览 · 未解锁' : isCustomBuild(build) ? '自定义方案' : guideBuild ? '攻略参考 · 手动选择' : generic ? '通用方案' : '专属配装');
    setText('build-character', char ? characterName(char) : '自动选择角色');
    const strategy = first(build?.strategy, build?.description, build?.summary);
    const description = Array.isArray(strategy) ? strategy.map((part) => nameOf(part)).slice(0, 3).join('；') : nameOf(strategy);
    setText('build-description', description || '');
    const unlocks = Array.isArray(char?.unlockRequirements) ? char.unlockRequirements.map((entry) => nameOf(entry.description)).filter(Boolean) : [];
    $('build-unlock').hidden = !locked || !unlocks.length;
    setText('build-unlock', `解锁条件：${unlocks.join('；')}`);
    const select = $('build-select');
    const choice = currentConfig().build || 'auto', route = configuredNativeRoute();
    const selectSignature = JSON.stringify([catalogGeneration, characterIdOf(char), locked, choice, route.biome, route.tier, route.nativeMode, receivedCustomPlansSignature]);
    // A live recommendation can update tags without recreating hundreds of
    // unchanged dropdown options and their text nodes.
    if (selectSignature !== buildSelectSignature) {
    buildSelectSignature = selectSignature;
    select.replaceChildren(new Option('智能选择 · 专属优先', 'auto'), new Option('通用通关思路', 'generic'));
    const matching = char ? indexedBuilds().applicable.get(idKey(characterIdOf(char))) || [] : [];
    // Explicit dedicated ids retain the original catalog order, even if that
    // record's source did not repeat the character id.
    const applicable = dedicated && !isGenericBuild(dedicated) && !matching.includes(dedicated)
      ? catalog.builds.filter(entry => entry === dedicated || matching.includes(entry)) : matching;
    for (const entry of applicable) {
      const name = nameOf(entry.name || entry.title, `专属方案 ${entry.id}`);
      select.add(new Option([isGuideBuild(entry) && !name.startsWith('攻略参考') ? '攻略参考' : '', name,
        isGuideBuild(entry) ? '' : entry.trainer || '', !isGuideBuild(entry) && numeric(entry.time) !== null ? durationText(entry.time) : ''].filter(Boolean).join(' · '), String(entry.id)));
    }
    const custom = customPlans().filter((entry) => customPlanMatches(entry, char));
    if (custom.length) {
      const group = document.createElement('optgroup'); group.label = '我的自定义方案';
      for (const entry of custom) group.append(new Option(`${entry.name}${entry.autoSelect===false ? ' · 仅手动选择' : ''} · ${planScopeText(entry)}`, entry.id));
      select.add(group);
    }
    select.value = [...select.options].some((option) => option.value === String(choice)) ? String(choice) : 'auto';
    select.disabled = locked;
    }
    renderFinalReplacements(char);
    const tags = $('build-tags'); tags.replaceChildren();
    const customBuild = isCustomBuild(build);
    const activeCharacter = first(state.game.characterId, state.game.species, state.game.plan?.species);
    const matchingCharacter = char ? activeCharacter != null && idKey(activeCharacter) === idKey(characterIdOf(char)) : currentConfig().characterId == null && previewCharacterId === null;
    const matchingCurrentBuild = !locked && build?.id != null && state.game.buildId != null && String(build.id) === String(state.game.buildId) && matchingCharacter;
    const liveTactics = matchingCurrentBuild && state.game.tactics && Array.isArray(state.game.tactics.preferredMoves) ? state.game.tactics : null;
    const rawMoves = guideBuild ? first(build?.moves, build?.skills, []) : first(build?.observedMoves, build?.moves, build?.skills, []);
    const observedMoves = !guideBuild && Array.isArray(liveTactics?.observedMoves) ? liveTactics.observedMoves : Array.isArray(rawMoves) ? rawMoves : [];
    const preferredMoves = customBuild ? first(build?.moves, build?.skills, []) : liveTactics ? liveTactics.preferredMoves.slice(0, 4) : observedMoves.slice(0, 4);
    const moveKey = move => typeof move === 'object' && move ? first(move.key, move.k, move.id) : move;
    const moveName = move => nameOf(catalog.moveNames?.[moveKey(move)] || catalog.moves?.find(entry => entry.key === moveKey(move))?.name || move, String(moveKey(move) || '未知招式'));
    const observedKeys = new Set(observedMoves.map(moveKey));
    const inferredMoves = !customBuild && liveTactics ? preferredMoves.filter(move => !observedKeys.has(moveKey(move))) : [];
    for (const move of Array.isArray(preferredMoves) ? preferredMoves.slice(0, customBuild ? 6 : 4) : []) {
      const inferred = !customBuild && liveTactics && !observedKeys.has(moveKey(move));
      const source = customBuild ? '用户方案' : inferred ? '推荐补位' : guideBuild ? '攻略参考' : '实战记录';
      const tag = element('span', 'build-tag move', moveName(move));
      tag.dataset.moveSource = customBuild ? 'custom' : inferred ? 'inferred' : guideBuild ? 'guide' : 'observed';
      tag.title = `${source}：` + (inferred ? '按当前角色原生招式推导；并非原记录中实际获得，也不保证当前立刻可学。' : customBuild ? '由玩家的自定义规则配置，不自动强填招式。' : guideBuild ? '第三方攻略参考，按原生门槛校对；不是已完成对局的观测招式或胜利证明。' : '原始参考记录中的招式，保留历史来源。');
      tags.append(tag);
    }
    const itemEntries = first(build?.items, build?.equipment, []);
    for (const item of Array.isArray(itemEntries) ? itemEntries : []) tags.append(element('span', 'build-tag', nameOf(catalog.itemNames?.[typeof item === 'string' ? item : item.k] || item)));
    if (!tags.childElementCount) for (const label of ['远程输出优先', '兼顾回复与护甲', '按掉落灵活选择']) tags.append(element('span', 'build-tag', label));
    const extra = $('build-extra'); extra.replaceChildren();
    const moveNote = (type, text) => { const line = element('p', '', text); line.dataset.moveRecord = type; extra.append(line); };
    if (customBuild) moveNote('custom', '自定义招式由你的规则决定，不自动补位；实际选项和栏位仍以游戏为准。');
    else {
      if (guideBuild) moveNote('guide', `攻略参考招式（${observedMoves.length}项）：${observedMoves.length ? observedMoves.map(moveName).join(' → ') : '来源未提供可用招式'}。原生门槛校对不代表当前可学或实战验证；此方案不是胜利记录，不自动抢占实战方案。`);
      else moveNote('observed', observedMoves.length ? `原记录观测实战招式（${observedMoves.length}项）：${observedMoves.map(moveName).join(' → ')}。` : '原记录未提供观测实战招式；不会把推导结果冒充原玩家实战配装。');
      if (liveTactics) {
        moveNote('preferred', `本局最多4项推荐：${preferredMoves.length ? preferredMoves.map(moveName).join(' → ') : '当前没有可信的原生候选'}。`);
        if (inferredMoves.length) moveNote('inferred', `推荐补位：${inferredMoves.map(moveName).join('、')}。来自当前角色原生候选，不代表原记录已获得、当前立刻可学或已解锁4槽。`);
        if (preferredMoves.length < 4) moveNote('partial', `当前可信推荐仅${preferredMoves.length}项，候选不足时不编造第4项。`);
      } else if (observedMoves.length < 4) moveNote('runtime', guideBuild ? '攻略不足4项时保留实际建议数量；运行时仍核原生学习条件，不把攻略补位当实战记录。' : '运行时按原生角色招式补位，最多4项推荐；静态预览保留原记录，不捏造未观测的实战招式。');
      moveNote('slots', '实际只使用游戏已解锁的3槽或4槽；招式等级、进化与共享解锁会影响可得性，推荐不是必刷保证。');
    }
    const vitaminNames = { protein: '蛋白质', iron: '铁', calcium: '钙', zinc: '锌', carbos: '速度增强剂', hpUp: '体力增强剂', 'hp-up': '体力增强剂', regen: '回复', armor: '护甲', maxHp: '生命', attackSpeed: '攻速', damage: '伤害', projectiles: '投射物' };
    const vitaminValues = Array.isArray(build?.vitamins) ? build.vitamins.map((entry) => `${nameOf(catalog.vitaminNames?.[entry.k] || vitaminNames[entry.k] || entry.name || entry.k)}${numeric(entry.lv) !== null ? ` Lv.${entry.lv}` : ''}`) : [];
    if (vitaminValues.length) extra.append(element('p', '', `营养强化：${vitaminValues.join(' · ')}`));
    if (Array.isArray(build?.vitaminPriority) && build.vitaminPriority.length) extra.append(element('p', '', `强化优先级：${build.vitaminPriority.map((key) => nameOf(catalog.vitaminNames?.[key] || vitaminNames[key] || key)).join(' → ')}`));
    if (Array.isArray(build?.steps)) {
      const list = element('ol');
      for (const step of build.steps) list.append(element('li', '', nameOf(step)));
      extra.append(list);
    }
    if (build?.note) extra.append(element('p', '', nameOf(build.note)));
    $('build-details').hidden = extra.childElementCount === 0;
    const source = $('build-source'); source.replaceChildren(); source.classList.remove('has-source');
    if (isCustomBuild(build)) {
      source.textContent = '自定义选择规则 · 仅在适用范围内生效；选项由游戏实际提供，不保证掉落或通关。';
    } else if (build) {
      const sourceData = build.source;
      const title = guideBuild ? '第三方攻略参考 · 原生门槛校对，未实战验证' : nameOf(first(sourceData?.title, build.sourceTitle), generic ? '基于已核实机制与收录配置归纳' : build.victory === true ? '公开排行榜胜利记录' : '公开排行榜记录');
      const sourceUrl = first(sourceData?.url, build.sourceUrl, build.url, typeof sourceData === 'string' && sourceData.startsWith('https://') ? sourceData : null);
      const collected = dateOf(first(build.collectedAt, build.recordedAt, build.updatedAt));
      const victoryStatus = guideBuild || generic ? null : build.victory === true ? '原生记录：胜利' : build.victory === false ? '原生记录：非胜利' : '胜利状态未提供';
      const record = [victoryStatus, !guideBuild && build.trainer ? `玩家 ${build.trainer}` : null, !guideBuild && build.rank ? `排名 #${build.rank}` : null, build.biome ? mapName(build.biome) : null, !guideBuild && numeric(first(build.clearSeconds, build.time)) !== null ? `${build.victory === true ? '通关' : '对局时长'} ${durationText(first(build.clearSeconds, build.time))}` : null, collected ? `采集于 ${collected.toLocaleDateString('zh-CN')}` : null].filter(Boolean).join(' · ');
      source.append(document.createTextNode(title + (record ? ` · ${record}` : '')));
      if (typeof sourceUrl === 'string' && /^https:\/\//.test(sourceUrl)) {
        source.classList.add('has-source');
        const recordText = source.textContent;
        const summary = element('summary', '', `来源${victoryStatus ? ' · '+victoryStatus.replace('原生记录：','') : guideBuild ? ' · 攻略参考' : ''}`);
        source.replaceChildren(summary, element('span', 'build-source-record', recordText));
        const link = element('a', '', guideBuild ? ' 查看攻略来源' : ' 查看原始记录'); link.href = sourceUrl; link.target = '_blank'; link.rel = 'noopener noreferrer';
        link.addEventListener('click', async (event) => { event.preventDefault(); try { await command('openLink', { url: sourceUrl }); } catch (error) { showToast(error.message, true); } });
        source.append(link);
      }
    } else source.textContent = '专属配置只标注可核实的来源；未收录时使用通用方案。';
  }

  function normalizeFinalMoveSection(entry = {}) {
    if(!entry||typeof entry!=='object'||Array.isArray(entry))entry={};
    const clean=raw=>{const seen=new Set();return {enabled:raw?.enabled===true,
      level:typeof raw?.level==='number'&&Number.isFinite(raw.level)?Math.max(1,Math.min(999999,Math.trunc(raw.level))):30,
      targets:Array.from({length:4},(_,i)=>{const key=raw?.targets?.[i];if(typeof key!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:+-]{0,99}$/.test(key)||key!=='pb:empty-slot'&&seen.has(key))return null;seen.add(key);return key;}),...(Array.isArray(raw?.banishLevels)?{banishLevels:Array.from({length:4},(_,i)=>typeof raw.banishLevels[i]==='number'&&Number.isFinite(raw.banishLevels[i])?Math.max(0,Math.min(10,Math.trunc(raw.banishLevels[i]))):0)}:{})};};
    const archive=raw=>raw&&typeof raw==='object'&&raw.kind==='legacy-split'?{kind:'legacy-split',moves:clean(raw.moves),fusion:clean(raw.fusion),acknowledged:raw.acknowledged===true}:null;
    if(entry.moves?.schemaVersion===2){const raw=entry.moves,section=clean(raw),migration=archive(raw.migration);
      section.targets=Array.from({length:4},(_,i)=>{const key=raw.targets?.[i];return typeof key==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:+-]{0,99}$/.test(key)?key:null;});
      return {schemaVersion:2,...section,...(migration?{migration}:{})};}
    const moves=clean(entry.moves),fusion=clean(entry.fusion),enabled=moves.enabled||fusion.enabled,
      active=enabled?[...(fusion.enabled?[fusion]:[]),...(moves.enabled?[moves]:[])]:[fusion,moves],
      nonempty=active.filter(row=>row.targets.some(Boolean)),keys=active.length===1?active[0].targets:nonempty.length===1?nonempty[0].targets:[...new Set(active.flatMap(row=>row.targets.filter(Boolean)))],levels=active.filter(row=>enabled?row.enabled:row.targets.some(Boolean)).map(row=>row.level),
      migration=enabled||moves.targets.some(Boolean)||fusion.targets.some(Boolean)?{kind:'legacy-split',moves,fusion,acknowledged:false}:null;
    return {schemaVersion:2,enabled,level:levels.length?Math.max(...levels):30,targets:Array.from({length:4},(_,i)=>keys[i]||null),...(migration?{migration}:{})};
  }
  function normalizeFinalStageProfiles(value={}) {
    const result={};if(!value||typeof value!=="object"||Array.isArray(value))return result;
    for(const [map,stages]of Object.entries(value).slice(0,32)){
      if(["__proto__","prototype","constructor"].includes(map)||map!=="default"&&!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(map)||!stages||typeof stages!=="object"||Array.isArray(stages))continue;
      const rows={};for(const stage of ["1","2","3"]){const entry=stages[stage];if(!entry||typeof entry!=="object"||Array.isArray(entry))continue;
        const row={};if(entry.moves&&typeof entry.moves==="object"&&!Array.isArray(entry.moves))row.moves=normalizeFinalMoveSection({moves:entry.moves});
        if(entry.vitamins&&typeof entry.vitamins==="object"&&!Array.isArray(entry.vitamins)){
          const raw=entry.vitamins,seen=new Set();row.vitamins={enabled:raw.enabled===true,
            level:typeof raw.level==='number'&&Number.isFinite(raw.level)?Math.max(1,Math.min(999999,Math.trunc(raw.level))):30,
            targets:Array.from({length:6},(_,index)=>{const key=raw.targets?.[index];if(typeof key!=="string"||!/^[A-Za-z0-9][A-Za-z0-9_.:+-]{0,99}$/.test(key)||key!=="pb:empty-slot"&&seen.has(key))return null;seen.add(key);return key;}),
            ...(Array.isArray(raw.banishLevels)?{banishLevels:Array.from({length:6},(_,index)=>typeof raw.banishLevels[index]==='number'&&Number.isFinite(raw.banishLevels[index])?Math.max(0,Math.min(12,Math.trunc(raw.banishLevels[index]))):0)}:{})};
        }
        if(Object.keys(row).length)rows[stage]=row;
      }if(Object.keys(rows).length)result[map]=rows;
    }return result;
  }
  
  function mergeFinalStageProfiles(current={},patch={}) {
    const result=normalizeFinalStageProfiles(current);if(!patch||typeof patch!=="object"||Array.isArray(patch))return result;
    for(const [map,stages]of Object.entries(patch).slice(0,32)){
      if(["__proto__","prototype","constructor"].includes(map)||map!=="default"&&!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(map))continue;
      if(stages===null){delete result[map];continue;}
      if(!stages||typeof stages!=="object"||Array.isArray(stages))continue;
      for(const stage of ["1","2","3"]){if(!Object.hasOwn(stages,stage))continue;const entry=stages[stage];
        if(entry===null){if(result[map])delete result[map][stage];continue;}
        if(!entry||typeof entry!=="object"||Array.isArray(entry))continue;
        const previous=result[map]?.[stage]||{},row={...previous};
        for(const kind of ['moves','vitamins'])if(Object.hasOwn(entry,kind)){
          if(entry[kind]===null)delete row[kind];else if(typeof entry[kind]==='object'&&!Array.isArray(entry[kind]))row[kind]={...(previous[kind]||{}),...entry[kind]};
        }
        (result[map]||={})[stage]=row;
      }
    }return normalizeFinalStageProfiles(result);
  }
  

  function mergeFinalReplacementPatch(current, patch) {
    const result = { ...(current || {}) };
    for (const [id, entry] of Object.entries(patch || {})) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const previous=result[id];
      result[id] = { ...(previous || {}),...(previous?{moves:normalizeFinalMoveSection(previous)}:{}) };
      if(entry.fusion&&entry.moves?.schemaVersion!==2){const history=result[id].moves.migration;result[id].moves={...(history?.moves||{}),...(entry.moves||{})};result[id].fusion={...(history?.fusion||{})};}
      for (const kind of ['moves', 'fusion', 'vitamins', 'strictMoves', 'strictVitamins']) if (entry[kind] && typeof entry[kind] === 'object' && !Array.isArray(entry[kind])) {
        result[id][kind] = { ...(result[id][kind] || {}), ...entry[kind] };
        if (kind.startsWith('strict')) delete result[id][kind].level;
      }
      if(Object.hasOwn(entry,'stageProfiles'))result[id].stageProfiles=mergeFinalStageProfiles(previous?.stageProfiles,entry.stageProfiles);
      result[id].moves=normalizeFinalMoveSection(result[id]);delete result[id].fusion;
    }
    return result;
  }
  let finalReplacementEditingScope = {map:'base',stage:'1'};
  function finalReplacementEditingEntry(char) {
    const entry=currentConfig().finalReplacements?.[String(characterIdOf(char))]||{},scope=finalReplacementEditingScope;
    if(scope.map==='base')return entry;
    const profiles=normalizeFinalStageProfiles(entry.stageProfiles),defaults=profiles.default?.[scope.stage],specific=profiles[scope.map]?.[scope.stage],resolved={...entry};
    for(const row of [defaults,specific])if(row)for(const kind of ['moves','vitamins'])if(row[kind])resolved[kind]={...(resolved[kind]||{}),...row[kind]};
    return resolved;
  }
  function finalReplacementSection(char, kind) {
    const entry = finalReplacementEditingEntry(char);
    if(kind==='moves')return normalizeFinalMoveSection(entry);
    const section = entry[kind] || {};
    const seen = new Set(), strict = kind === 'strictMoves' || kind === 'strictVitamins';
    return { enabled: section.enabled === true,
      ...(!strict ? {level:typeof section.level === 'number' && Number.isFinite(section.level) ? Math.max(1, Math.min(999999, Math.trunc(section.level))) : 30} : {}),
      ...(!strict&&Array.isArray(section.banishLevels)?{banishLevels:Array.from({length:6},(_,i)=>typeof section.banishLevels[i]==='number'&&Number.isFinite(section.banishLevels[i])?Math.max(0,Math.min(12,Math.trunc(section.banishLevels[i]))):0)}:{}),
      targets: Array.from({ length: kind === 'vitamins' ? 6 : 4 }, (_, index) => {
        const key = section.targets?.[index];
        if (typeof key !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:+-]{0,99}$/.test(key) || key !== 'pb:empty-slot' && !strict && seen.has(key)) return null;
        seen.add(key); return key;
      }) };
  }
  function finalReplacementPool(char, kind) {
    if (kind === 'vitamins' || kind === 'strictVitamins') return ruleEntries('vitamins');
    if (kind === 'strictMoves') return finalReplacementPool(char,'moves');
    // A kit alone is not the complete native learnable pool. The runtime
    // catalog supplies reviewed per-character eligibility, including later
    // evolution/level requirements. Never offer every global move as learnable.
    // The packaged reviewed learning catalog must remain usable before the
    // game bridge connects. Older reviewed catalogs retained only the exact
    // per-character fusion keys; those are still legitimate selectable goals,
    // unlike guessing from the global fusion list. Runtime eligibility and
    // actual recipe execution remain separate checks.
    const candidates = kind === 'fusion' ? Array.isArray(char?.learnableFusions) ? char.learnableFusions :
      Array.isArray(char?.availableFusionKeys) ? char.availableFusionKeys.map(key=>({key,arch:'fusion',availability:'reviewed-fusion-conditional',
        description:'已核对的角色融合目标；原料路线详情暂不可用，实际融合仍以当前原生条件为准。'})) : [] : char?.learnableMoves;
    const source = Array.isArray(candidates) ? candidates : [];
    const entries=source.map(value => {
      const key = typeof value === 'string' ? value : first(value.key, value.k);
      const definition = ruleEntry('moves', key);
      return { ...definition, ...(typeof value === 'object' ? value : {}), key, strictSourceLabel:kind==='fusion'?'融合招式':'普通招式',
        name: nameOf(first(definition?.name, value?.name, catalog.moveNames?.[key]), key) };
    }).filter((entry, index, all) => typeof entry.key === 'string' && all.findIndex(other => other.key === entry.key) === index);
    return kind==='moves'?[...entries,...finalReplacementPool(char,'fusion')].filter((entry,index,all)=>all.findIndex(other=>other.key===entry.key)===index):entries;
  }
  function finalFusionConflicts(section, entries) {
    const selected = section.targets.filter(Boolean).map(key => entries.find(entry => entry.key === key)).filter(entry=>entry?.arch==='fusion'||entry?.strictSourceLabel==='融合招式');
    const recipes = entry => {
      const unique = new Map();
      for (const route of Array.isArray(entry.routes) ? entry.routes : []) {
        if (typeof route.aKey !== 'string' || typeof route.bKey !== 'string' || route.aKey === route.bKey) continue;
        const pair = [route.aKey, route.bKey].sort(); unique.set(pair.join('\0'), pair);
      }
      return [...unique.values()];
    };
    const conflicts = [];
    const ordinary=new Set(section.targets.filter(key=>key&&!selected.some(entry=>entry.key===key)));
    if(selected.length>3)conflicts.push('原生制作需要两个原料位置，四槽通常最多同时保留三个融合招式');
    for(const entry of selected){const routes=recipes(entry);if(routes.length&&routes.every(pair=>pair.some(key=>ordinary.has(key))))conflicts.push(`${nameOf(entry.name,entry.key)}会消耗仍要保留的普通招式，可能无法同时成形`);}
    for (let i = 0; i < selected.length; i++) for (let j = i + 1; j < selected.length; j++) {
      const a = recipes(selected[i]), b = recipes(selected[j]); if (!a.length || !b.length) continue;
      const counts = new Map(), exact = new Set();
      for (const pair of b) { exact.add(pair.join('\0')); for (const key of pair) counts.set(key, (counts.get(key) || 0) + 1); }
      // Count intersecting recipes in linear time; never expand a product of
      // all native routes merely to paint a configuration pane.
      const canAvoidSharedParent = a.some(pair => (counts.get(pair[0]) || 0) + (counts.get(pair[1]) || 0) - (exact.has(pair.join('\0')) ? 1 : 0) < b.length);
      if (!canAvoidSharedParent) conflicts.push(`${nameOf(selected[i].name, selected[i].key)} / ${nameOf(selected[j].name, selected[j].key)}`);
    }
    return conflicts;
  }
  function updateFinalReplacementRuntimeStatus() {
    const node = $('final-replacement-runtime'), id = $('final-replacements')?.dataset.characterId;
    if (!node || !id) return;
    const current = state.game?.tactics?.finalReplacement, fusion = current?.fusion;
    let text = `配置已保存，使用${characterName(findCharacter(id))}开局时生效。`;
    const strictStates=['strictMoves','strictVitamins'].filter(kind=>current?.[kind]?.enabled === true);
    if (String(current?.species) === id && strictStates.length) {
      text=strictStates.map(kind=>{
        const strict=current[kind],label=kind === 'strictMoves' ? '招式' : '维生素',
          reason=typeof strict.reason === 'string' ? strict.reason.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,600) : '',
          detail=reason || (strict.phase === 'empty' ? '允许列表为空，不主动获取新项目；原生强制产生的内容等待正常遗忘机会。' : '按指定允许列表推进；原生资格、必要融合原料及正常遗忘机会仍有效。');
        return `本局只选指定${label}：${detail}`;
      }).join(' ');
    } else if (String(current?.species) === id && fusion && typeof fusion === 'object' && fusion.enabled !== false) {
      const phases = {
        'waiting-level': '等待达到最终融合的开始等级。', 'before-level': '等待达到最终融合的开始等级。', 'threshold-wait': '等待达到最终融合的开始等级。',
        prepare: '正在准备原料招式。', preparing: '正在准备原料招式。', 'prepare-parents': '正在准备原料招式。', 'learn-parents': '正在准备原料招式。', 'learning-parents': '正在准备原料招式。',
        'upgrade-parents': '将原料招式升至8级。', 'upgrading-parents': '将原料招式升至8级。', 'level-parents': '将原料招式升至8级。', leveling: '将原料招式升至8级。', 'leveling-parents': '将原料招式升至8级。',
        'waiting-parent-availability': '原料仍需等级、进化或共享资格，保留当前战力等待。', 'temporary-output-before-forget': '先保留并补充可输出招式，再腾出融合准备空间。', 'remove-blocking-fusion': '通过原生遗忘调整阻挡目标配方的融合，仍保留输出。', 'remove-blocking-random': '保留输出后，先遗忘阻塞共享随机招式学习的普通招式，再按共享→本系顺序准备原料。',
        ready: '原料已就绪，寻找正辉的机器。', 'find-bill': '寻找正辉的机器。', 'seeking-bill': '寻找正辉的机器。', 'search-bill': '寻找正辉的机器。',
        capacity: '已达当前融合空间上限，保留现有输出。', 'capacity-limit': '已达当前融合空间上限，保留现有输出。', 'slot-limit': '已达当前融合空间上限，保留现有输出。', 'no-space': '普通准备空间不足，保留现有输出。',
        'waiting-preparation-slots': '需要两个普通原料位置；当前原生槽位不足，保留已成形招式，等待槽位或调整目标。',
        conflict: '原料冲突，等待其他合法配方。', 'parent-conflict': '原料冲突，等待其他合法配方。', 'ingredient-conflict': '原料冲突，等待其他合法配方。', blocked: '原料、资格或配方搜索受限，保留当前战力并等待合法路线。',
        complete: '当前有效融合目标已完成。', completed: '当前有效融合目标已完成。', done: '当前有效融合目标已完成。',
        'search-limit': '配方搜索达到限额，保留当前战力并等待重评。', 'budget-exhausted': '配方搜索达到限额，保留当前战力并等待重评。',
      };
      const reason = typeof fusion.reason === 'string' ? fusion.reason.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 600) : '';
      const description = reason || (fusion.enabled === false ? '最终融合尚未开启。' : phases[fusion.phase] || (fusion.active === false ? '等待最终融合等级或原生条件。' : '等待原生学习、升级或交互机会。'));
      const counts = [];
      for (const [key, label] of [['completed', '已完成'], ['pending', '待完成'], ['blocked', '受限']]) {
        const value = fusion[key], count = Array.isArray(value) ? value.length : typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(999999, Math.trunc(value)) : key === 'pending' && value && typeof value === 'object' && typeof value.key === 'string' ? 1 : key === 'pending' && value === null ? 0 : null;
        if (count != null) counts.push(`${label} ${count}`);
      }
      text = `本局最终招式替换：${description}${counts.length ? ` ${counts.join(' · ')}` : ''}`;
    } else if(String(current?.species)===id&&current?.moves?.enabled){
      text=current.moves.active?'本局最终招式替换：按四格普通目标逐格补位，补回一格后再替换下一格。':'本局最终招式替换：未到开始等级，先正常选择和升级过渡招式。';
    }
    if(String(current?.species)===id&&current?.unified?.unknown?.length)text+=' 部分目标尚未在当前角色目录中确认，保留配置和现有战力。';
    if(String(current?.species)===id&&current?.unified?.capacityLimited)text+=' 四个融合目标超过常规制作容量，四槽通常最多保留三个融合；请调整目标。';
    if(String(current?.species)===id&&(current?.emptySlots?.moves?.active||current?.emptySlots?.vitamins?.active)){
      const slots=current.emptySlots,details=[];if(slots.moves?.active)details.push(`招式留空 ${slots.moves.reserved}`);if(slots.vitamins?.active)details.push(`维生素留空 ${slots.vitamins.reserved}`);
      text=`本局显式空位：${details.join(' · ')}；按原生遗忘机会清理，必要融合原料和未到放逐阈值的内容先保留。${slots.moves?.nativeMinimumBlocked?'游戏至少保留一招，最后一招不强行删除。':''}`;
    }
    if(String(current?.species)===id&&current?.banishSlots?.active&&current.banishSlots.pending?.length)text+=` 等待原生放逐候选/次数：${current.banishSlots.pending.length}项；未出现候选不代表已放逐。`;
    if(String(current?.species)===id&&current?.stageScope){const scope=current.stageScope;text+=` 当前执行：${scope.source==='map-stage'?mapName(scope.biome)+'·第'+scope.stage+'关':scope.source==='default-stage'?'全部地图·第'+scope.stage+'关':'通用基础配置'}。`;}
    if (node.textContent !== text) node.textContent = text;
  }
  function renderFinalReplacements(char) {
    const root = $('final-replacements');
    root.hidden = !char;
    if (!char) { root.replaceChildren(); delete root.dataset.characterId; finalReplacementSignature = ''; return; }
    const id = String(characterIdOf(char));
    root.dataset.characterId = id;
    const kinds = ['moves', 'vitamins', 'strictMoves', 'strictVitamins'];
    const sections = Object.fromEntries(kinds.map(kind => [kind, finalReplacementSection(char, kind)]));
    const scope=finalReplacementEditingScope,storedEntry=currentConfig().finalReplacements?.[id]||{},
      signature = JSON.stringify([id, sections, catalogGeneration,scope,storedEntry.stageProfiles]);
    if (signature === finalReplacementSignature) return;
    finalReplacementSignature = signature;
    const pools = Object.fromEntries(kinds.map(kind => [kind, finalReplacementPool(char, kind)]));
    root.replaceChildren();
    const scopeFields=element('div','replacement-scope-fields'),scopeMap=document.createElement('select'),scopeStage=document.createElement('select');
    scopeMap.id='final-stage-map';scopeMap.setAttribute('aria-label','最终配装适用地图');scopeMap.add(new Option('通用基础配置','base'));scopeMap.add(new Option('全部地图·分关配置','default'));
    for(const map of catalog.maps||[])scopeMap.add(new Option(mapName(String(first(map.id,map.key))),String(first(map.id,map.key))));
    scopeMap.value=scope.map;scopeStage.id='final-stage-number';scopeStage.setAttribute('aria-label','最终配装适用关卡');
    for(const stage of ['1','2','3'])scopeStage.add(new Option(`第${stage}关`,stage));scopeStage.value=scope.stage;scopeStage.disabled=scope.map==='base';
    const changeScope=()=>{finalReplacementEditingScope={map:scopeMap.value,stage:scopeStage.value};finalReplacementSignature='';renderFinalReplacements(char);};
    scopeMap.addEventListener('change',changeScope);scopeStage.addEventListener('change',changeScope);scopeFields.append(scopeMap,scopeStage);root.append(scopeFields);
    const runtimeStatus = element('p', 'replacement-note replacement-runtime'); runtimeStatus.id = 'final-replacement-runtime'; runtimeStatus.setAttribute('aria-live', 'polite'); root.append(runtimeStatus);
    for (const kind of kinds) {
      const strict = kind === 'strictMoves' || kind === 'strictVitamins',
        section = sections[kind], label = kind === 'vitamins' || kind === 'strictVitamins' ? '维生素' : '招式';
      if(strict&&scope.map!=='base')continue;
      const box = element('section', 'replacement-section'); box.dataset.replacementKind = kind;
      const toggleLabel = element('label', 'replacement-toggle');
      const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.checked = section.enabled; toggle.id = `final-${kind}-enabled`;
      toggleLabel.append(toggle, element('strong', '', strict ? `只选指定${label}` : `最终${label}替换`)); box.append(toggleLabel);
      const explicitEmpty=!strict&&section.enabled&&section.targets.includes('pb:empty-slot'),
        overridden = !strict && !explicitEmpty && (kind === 'vitamins' ? sections.strictVitamins.enabled : sections.strictMoves.enabled);
      if (overridden) box.append(element('p','replacement-note',`当前被“只选指定${label === '维生素' ? '维生素' : '招式'}”覆盖；此处旧配置仍保留，关闭对应严格选择后恢复。`));
      if(explicitEmpty)box.append(element('p','replacement-note','当前显式留空优先于该类别的推荐方案和“只选指定”软偏好；原设置保留，取消留空后恢复。'));
      toggle.addEventListener('change', () => update({enabled:toggle.checked}));
      const fields = element('div', 'replacement-fields'); fields.hidden = !section.enabled; box.append(fields);
      const error = element('p', 'replacement-error'); error.id = `final-${kind}-error`; error.setAttribute('role', 'status');
      const update = patch => {
        const values=kind==='moves'?{...finalReplacementSection(char,kind),...patch,schemaVersion:2}:{...finalReplacementSection(char,kind),...patch};
        return saveConfig({finalReplacements:{[id]:scope.map==='base'?{[kind]:values}:{stageProfiles:{[scope.map]:{[scope.stage]:{[kind]:values}}}}}});
      };
      if(scope.map!=='base'){
        const own=storedEntry.stageProfiles?.[scope.map]?.[scope.stage]?.[kind],inherit=element('button','button secondary','恢复继承');inherit.type='button';inherit.disabled=!own;
        inherit.addEventListener('click',()=>saveConfig({finalReplacements:{[id]:{stageProfiles:{[scope.map]:{[scope.stage]:{[kind]:null}}}}}}));
        box.append(element('p','replacement-note',own?'此地图本关独立配置，其他关卡保持原设置。':'当前继承配置；修改任意字段后只为此地图本关保存。'),inherit);
      }
      if(kind==='moves'&&section.migration){
        const history=section.migration,groups=[['普通',history.moves],['融合',history.fusion]],oldKeys=[...new Set(groups.filter(([,row])=>row.enabled).flatMap(([,row])=>row.targets.filter(Boolean)))],
          omitted=oldKeys.filter(key=>!section.targets.includes(key));
        const migration=element('div','replacement-migration');
        if(!history.acknowledged)migration.append(element('p',omitted.length?'replacement-error':'replacement-note',`已合并旧配置：按原融合顺序优先，再补普通招式；最多四项目标。${omitted.length?`另有 ${omitted.length} 项旧目标保存在下方记录中，当前不生效。`:''}两组等级不同则沿用较高值，避免提前替换。请检查当前四格。`));
        const details=document.createElement('details');details.append(element('summary','','查看旧配置迁移记录'));
        for(const [name,row]of groups)details.append(element('p','replacement-note',`${name}：${row.enabled?'原已开启':'原已关闭'}，等级 ${row.level}；${row.targets.filter(Boolean).map(key=>nameOf(catalog.moveNames?.[key],key)).join('、')||'未指定'}`));
        migration.append(details);
        if(!history.acknowledged){const acknowledge=element('button','button secondary','确认使用当前四格');acknowledge.type='button';acknowledge.addEventListener('click',()=>update({migration:{...history,acknowledged:true}}));migration.append(acknowledge);}
        box.append(migration);
      }
      const entries = pools[kind];
      const entryName = entry => nameOf(entry?.name, entry?.key || '');
      const slotLabel = label;
      for (let index = 0; index < (kind === 'vitamins' ? 6 : 4); index++) {
        const field = element('div', 'replacement-field');
        const labelNode = element('label', '', `${slotLabel} ${index + 1}`); labelNode.htmlFor = `final-${kind}-${index}`; field.append(labelNode);
        const combo = element('div', 'replacement-combobox');
        const input = document.createElement('input'); input.type = 'search'; input.id = `final-${kind}-${index}`; input.placeholder = '输入名称搜索，或展开选择'; input.autocomplete = 'off'; input.spellcheck = false; input.maxLength = 100;
        input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-expanded', 'false');
        const savedKey = section.targets[index], savedEntry = entries.find(entry => entry.key === savedKey);
        const savedValue = savedKey === 'pb:empty-slot' ? '留空' : savedKey ? entryName(savedEntry) || savedKey : '';
        input.value = savedValue; input.dataset.targetKey = savedKey || '';
        const open = element('button', 'replacement-dropdown', '▾'); open.type = 'button'; open.setAttribute('aria-label', `展开${slotLabel} ${index + 1}选项`);
        const options = element('div', 'replacement-options'); options.id = `${input.id}-options`; options.hidden = true; options.setAttribute('role', 'listbox'); input.setAttribute('aria-controls', options.id);
        let visible = [], active = -1, applying = false;
        const hide = () => { options.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); };
        const commit = key => {
          if (applying) return;
          const targets = finalReplacementSection(char, kind).targets;
          if (!strict && key && key !== 'pb:empty-slot' && !(kind==='moves'&&(entries.find(entry=>entry.key===key)?.arch==='fusion'||entries.find(entry=>entry.key===key)?.strictSourceLabel==='融合招式')) && targets.some((value, slot) => slot !== index && value === key)) { error.textContent = `此${label}已选在其他位置，请选择不同内容。`; input.setAttribute('aria-invalid', 'true'); return; }
          applying = true; error.textContent = ''; input.setAttribute('aria-invalid', 'false'); hide();
          if (targets[index] !== key) { targets[index] = key; update({ targets }); }
          else { input.value = savedValue; applying = false; }
        };
        const draw = all => {
          options.replaceChildren(); active = -1;
          const term = all ? '' : searchText(input.value);
          visible = [{ key: null, name: strict ? '未指定（不增加允许项）' : '未指定（不主动替换此位置）' }, ...(!strict ? [{key:'pb:empty-slot',name:'留空',description:'立即保留一个空位，等待正常遗忘机会清理多余内容'}] : []), ...entries].filter(entry => !entry.key || !term || searchText([entryName(entry), entry.key, entry.description, entry.strictSourceLabel, entry.minLevel ? `等级 ${entry.minLevel}` : '', typeof entry.availability === 'object' ? JSON.stringify(entry.availability) : entry.availability, typeof entry.parents === 'object' ? JSON.stringify(entry.parents) : entry.parents].join(' ')).includes(term));
          for (const [position, entry] of visible.entries()) {
            const button = element('button', 'replacement-option'); button.type = 'button'; button.id = `${options.id}-${position}`; button.setAttribute('role', 'option'); button.setAttribute('aria-selected', String(entry.key === savedKey));
            button.append(element('strong', '', entryName(entry)));
            const detail = [entry.strictSourceLabel,entry.key, entry.minLevel ? `最低等级 ${entry.minLevel}` : '', entry.description, entry.availabilityLabel].filter(Boolean).join(' · ');
            if (detail) button.append(element('small', '', detail));
            button.addEventListener('pointerdown', event => event.preventDefault()); button.addEventListener('click', () => commit(entry.key)); options.append(button);
          }
          if (!entries.length) options.append(element('p', 'replacement-note', kind === 'moves' || kind === 'strictMoves' ? '等待当前版本的角色完整可学目录；现有配置会保留。' : '等待当前版本的维生素目录；现有配置会保留。'));
          else if (visible.length === 1 && term) options.append(element('p', 'replacement-note', '没有匹配内容，可尝试名称、效果或标识。'));
          options.hidden = false; input.setAttribute('aria-expanded', 'true');
        };
        input.addEventListener('focus', () => draw(true));
        input.addEventListener('input', () => { applying = false; error.textContent = ''; input.setAttribute('aria-invalid', 'false'); draw(false); });
        open.addEventListener('pointerdown', event => event.preventDefault()); open.addEventListener('click', () => { if (options.hidden) { input.focus(); draw(true); } else hide(); });
        input.addEventListener('keydown', event => {
          if (event.key === 'Escape') { hide(); input.value = savedValue; event.preventDefault(); }
          else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); if (options.hidden) draw(true);
            active = Math.max(0, Math.min(visible.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1)));
            options.querySelectorAll('button').forEach((button, position) => button.classList.toggle('active', position === active));
            input.setAttribute('aria-activedescendant', `${options.id}-${active}`); options.children[active]?.scrollIntoView({ block: 'nearest' });
          } else if (event.key === 'Enter') {
            event.preventDefault();
            const exact = [...(!strict?[{key:'pb:empty-slot',name:'留空'}]:[]),...entries].filter(entry => entry.key === input.value.trim() || entryName(entry) === input.value.trim());
            if (active >= 0) commit(visible[active].key); else if (!input.value.trim()) commit(null); else if (exact.length === 1) commit(exact[0].key);
          }
        });
        input.addEventListener('blur', () => setTimeout(() => {
          if (applying || combo.contains(document.activeElement)) return;
          hide(); if (input.value === savedValue) return;
          const exact = [...(!strict?[{key:'pb:empty-slot',name:'留空'}]:[]),...entries].filter(entry => entry.key === input.value.trim() || entryName(entry) === input.value.trim());
          if (!input.value.trim()) commit(null); else if (exact.length === 1) commit(exact[0].key);
          else { input.value = savedValue; input.setAttribute('aria-invalid', 'true'); error.textContent = '请从下拉结果中选择；未匹配的文字没有保存。'; }
        }, 0));
        combo.append(input, open, options);
        const slotControls=element('div','replacement-slot-controls');slotControls.append(combo);
        if(!strict){
          const banishLabel=element('label','replacement-banish','放逐等级'),banish=document.createElement('select');banish.id=`final-${kind}-banish-${index}`;banish.setAttribute('aria-label',`${slotLabel} ${index+1}放逐等级`);
          const maximum=kind==='vitamins'?12:savedEntry?.arch==='fusion'||savedEntry?.strictSourceLabel==='融合招式'?6:10,saved=Math.max(0,Math.min(kind==='vitamins'?12:10,Number(section.banishLevels?.[index])||0));
          banish.add(new Option('0 · 不触发','0'));for(let level=1;level<=maximum;level++)banish.add(new Option(String(level),String(level)));
          if(saved>maximum)banish.add(new Option(`${saved} · 超上限，请调整`,String(saved)));banish.value=String(saved);
          banish.addEventListener('change',()=>{const values=Array.from({length:kind==='vitamins'?6:4},(_,slot)=>Number(finalReplacementSection(char,kind).banishLevels?.[slot])||0);values[index]=Number(banish.value);update({banishLevels:values});});
          banishLabel.append(banish);slotControls.append(banishLabel);
        }
        field.append(slotControls); fields.append(field);
      }
      if (!strict) {
      fields.append(element('p','replacement-note','放逐等级0不触发。达到所选等级后，等待游戏再次提供该项候选并消耗原生放逐次数；已学招式不会因放逐消失。“留空”同时设置放逐等级时，先升级到阈值，再放逐并等待正常遗忘。已达原生上限可能不再出现升级候选，将保留真实待办，不伪造放逐；留空可先正常遗忘，再等待同项新候选。普通招式最高10、融合最高6、维生素最高12，实际仍受原生道具和资格限制。'));
      const levelField = element('label', 'replacement-level'); levelField.append(element('span', '', '开始替换等级'));
      const levelInput = document.createElement('input'); levelInput.id = `final-${kind}-level`; levelInput.type = 'number'; levelInput.min = '1'; levelInput.max = '999999'; levelInput.step = '1'; levelInput.inputMode = 'numeric'; levelInput.value = section.level;
      levelInput.addEventListener('beforeinput', event => { if (event.data && /\D/.test(event.data)) event.preventDefault(); });
      levelInput.addEventListener('keydown', event => { if (['e', 'E', '+', '-', '.', ','].includes(event.key)) event.preventDefault(); });
      levelInput.addEventListener('input', () => {
        const raw = levelInput.value;
        levelInput.setAttribute('aria-invalid', String(!/^\d+$/.test(raw) || Number(raw) < 1));
        if (/^\d+$/.test(raw) && Number(raw) > 999999) levelInput.value = '999999';
      });
      levelInput.addEventListener('change', () => {
        const value = /^\d+$/.test(levelInput.value) ? Math.max(1, Math.min(999999, Number(levelInput.value))) : section.level;
        levelInput.value = value; levelInput.setAttribute('aria-invalid', 'false'); if (value !== section.level) update({ level: value });
      });
      levelField.append(levelInput); fields.append(levelField);
      }
      fields.append(error);
      fields.append(element('p', 'replacement-note', kind === 'strictMoves'
        ? '开启后只主动获取这4格允许的普通或融合招式，优先覆盖上方最终招式替换偏好；旧配置保留，关闭后恢复。4格是允许列表，重复填写不要求持有指定份数，能否继续获得同一融合仍按原生规则。所选融合所需的普通父招式是临时准备，可正常学习并升到原生融合等级；无关招式仅在原生强制选择时暂存，之后等正常遗忘机会清理。4格全空表示不主动学习新招式；无法遗忘原生初始或强制招式时仍继续游戏，不会强改栏位。'
        : kind === 'strictVitamins'
        ? '开启后只主动获取这4格允许的维生素，优先覆盖上方最终维生素偏好；旧配置保留，关闭后恢复。没有脚本等级门槛；4格全空表示不主动获取新维生素，原生强制选择的内容等正常遗忘机会再处理。只限制维生素，不限制普通道具、资源拾取或其他交互。'
        : kind === 'moves'
        ? '四格共同指定最终成形，每格可选普通或融合招式，也可选“留空”。先规划可共存的融合路线并留出两个原料位置。未指定仍保留自由成长；显式“留空”立即保留相应数量的空位，优先保留指定目标，等待原生遗忘NPC逐项清理多余招式，不受开始等级延后。融合准备暂留必要原料，成形后再清空；游戏至少保留一招，不能遗忘时继续游玩并等待合法机会。原生必选或单张强化自动选择可能先取得非目标，之后仍等正常遗忘机会清理。没有留空时仍按原单槽补位规则逐步成形，补回后再换下一格，不连续清掉过渡战力；槽位不足时先完成可达部分，后续配置会保留。'
        : '按原生维生素栏位使用前几项；初始 3 槽，研究和祝福可增加至 6 槽，多出的配置会保留。“未指定”不删除内容；显式“留空”立即保留相应数量空位，优先保留指定维生素，通过正常遗忘NPC逐项清理多余项，不受开始等级延后。不能遗忘时保留意图，后续机会会重新核对；不修改游戏栏位或效果。'));
      if (kind === 'moves') {
        const unknown=section.targets.filter(key=>key&&key!=='pb:empty-slot'&&!entries.some(entry=>entry.key===key));
        const repeated=section.targets.filter((key,index)=>key&&section.targets.indexOf(key)!==index&&entries.some(entry=>entry.key===key&&entry.strictSourceLabel!=='融合招式'&&entry.arch!=='fusion'));
        if(unknown.length)fields.append(element('p','replacement-error',`当前角色目录尚未确认这些目标：${[...new Set(unknown)].join('、')}。配置仍会保留，等待目录确认，不会当作已经成形。`));
        if(repeated.length)fields.append(element('p','replacement-error',`普通招式不能同时持有多份：${[...new Set(repeated)].map(key=>nameOf(entries.find(entry=>entry.key===key)?.name,key)).join('、')}。重复格不会产生第二份，请改选其他目标。`));
        const conflicts = finalFusionConflicts(section, entries);
        if (conflicts.length) fields.append(element('p', 'replacement-error replacement-fusion-conflicts', `原料冲突：${conflicts.join('；')}。当前目录中的所有路线都共用父招式，原生已拥有规则可能阻止再次学习，不能保证这些融合同时达成。请调整目标或等待其他合法路线；已填配置会保留。`));
        fields.append(element('p', 'replacement-note', '原生制作需要两个原料位置，四槽通常最多同时保留三个融合招式。融合目录包含未来进化和共享解锁路线；列出目标不代表当前已经可学。普通招式若已作为材料并被成品占用，游戏可能不再提供该招式；会优先寻找其它配方，不能保证冲突目标同时成形。'));
      }
      if (kind === 'strictMoves') fields.append(element('p','replacement-note','每种融合默认只做一份。需要多份时，每份仍要准备两招各达到8级、且未被已有成品锁定的合法材料。'));
      if (strict) fields.append(element('p','replacement-note','若游戏原生设置开启“仅一张强化时跳过选择”，游戏可能在脚本看到选项前自动选择唯一卡；脚本不会擅自更改该设置或绕过原生跳过次数。需要避免这一情况时，可在游戏设置中手动关闭；已强制取得的内容仍等待正常遗忘机会处理。'));
      root.append(box);
    }
    updateFinalReplacementRuntimeStatus();
  }

  function newPlanDraft() {
    return { schemaVersion: 1, id: null, name: '新方案', description: '', enabled: true, autoSelect: true, priority: 0, species: null, biome: null, tier: null, mode: 'any', moveRules: [], itemRules: [], vitaminRules: [], interactions: { free: true, paid: true, copy: true, shop: true, roulette: true, tutor: true, shrine: true, healing: true, goldReserve: 0, maxSpend: null }, reserveUntilLevel: 20, replacementPolicy: 'smart', allowOffPlan: true, statWeights: {} };
  }
  function planScopeText(plan) {
    return [plan.species == null ? '全部角色' : characterName(findCharacter(plan.species)), plan.biome ? mapName(plan.biome) : '全部地图', plan.tier == null ? '全部难度' : ['普通', '困难', '噩梦'][plan.tier], plan.mode === 'endless' ? '生存' : plan.mode === 'tower' ? '紫苑塔' : plan.mode === 'standard' ? '经典' : '全部模式'].join(' / ');
  }
  function setPlanDirty() {
    planDraftRevision++;
    planDirty = true;
    setText('plan-save-status', '有修改尚未保存');
    setText('plan-editor-title', planDraft?.name || '未命名方案');
  }
  function setPlanBusy(value) {
    planBusy = value;
    for (const id of ['plan-save', 'plan-duplicate', 'plan-delete', 'plan-new', 'plans-import', 'plans-export', 'plans-import-json', 'plan-export-one', 'plan-export-current', 'plans-import-file', 'plans-export-file-all']) $(id).disabled = value || (['plan-delete','plan-export-current'].includes(id) && !planDraft?.id);
    setText('plan-save', value ? '处理中…' : '保存方案');
  }
  function showPlanSection(section) {
    planSection = section;
    document.querySelectorAll('[data-plan-section]').forEach((button) => { const active = button.dataset.planSection === section; button.classList.toggle('selected', active); button.setAttribute('aria-selected', String(active)); });
    document.querySelectorAll('[data-plan-panel]').forEach((panel) => { panel.hidden = panel.dataset.planPanel !== section; });
  }
  function setPlanDraft(plan) {
    planDraft = { ...newPlanDraft(), ...structuredClone(plan || {}) };
    planDraft.interactions = { ...newPlanDraft().interactions, ...(plan?.interactions || {}) };
    planDraft.statWeights = { ...(plan?.statWeights || {}) };
    for (const info of Object.values(RULE_GROUPS)) if (!Array.isArray(planDraft[info.field])) planDraft[info.field] = [];
    planDirty = false;
    fillPlanForm(); renderPlanLibrary();
  }
  function fillPlanForm() {
    if (!planDraft) return;
    setText('plan-editor-title', planDraft.name || '新建方案');
    setText('plan-editor-state', planDraft.id ? '保存后下局使用；正在进行的对局不会被中断。' : '');
    $('plan-name').value = planDraft.name || '';
    $('plan-description').value = planDraft.description || '';
    $('plan-priority').value = planDraft.priority ?? 0;
    $('plan-priority').min = catalog.planEditorSchema?.limits?.priorityMin ?? -100;
    $('plan-priority').max = catalog.planEditorSchema?.limits?.priorityMax ?? 100;
    $('plan-enabled').checked = planDraft.enabled !== false;
    $('plan-auto-select').checked = planDraft.autoSelect !== false;
    const species = $('plan-species'); species.replaceChildren(new Option('全部角色', 'all'));
    for (const char of catalog.characters) species.add(new Option(`${characterName(char)} #${characterIdOf(char)}`, String(characterIdOf(char))));
    species.value = planDraft.species == null ? 'all' : String(planDraft.species);
    const biome = $('plan-biome'); biome.replaceChildren(new Option('全部地图', 'all'));
    for (const map of catalog.maps) biome.add(new Option(nameOf(map.name, map.id), map.id));
    biome.value = planDraft.biome || 'all';
    $('plan-tier').value = planDraft.tier == null ? 'all' : String(planDraft.tier);
    $('plan-mode').replaceChildren();
    for (const entry of catalog.planEditorSchema?.modes || [{value:'any',label:'全部模式'},{value:'standard',label:'经典闯关'},{value:'endless',label:'生存模式'}]) $('plan-mode').add(new Option(entry.label, entry.value));
    $('plan-mode').value = planDraft.mode || 'any';
    for (const group of Object.keys(RULE_GROUPS)) { renderRuleResults(group); renderRuleRows(group); }
    renderPlanStrategy();
    setText('plan-save-status', planDraft.id ? '已保存到本机' : '新方案尚未保存');
    setPlanBusy(planBusy);
  }
  function renderPlanLibrary() {
    const search = $('plan-search').value.trim().toLocaleLowerCase();
    const plans = customPlans().filter((plan) => `${plan.name || ''} ${plan.description || ''} ${planScopeText(plan)}`.toLocaleLowerCase().includes(search));
    const root = $('plan-list'); root.replaceChildren();
    for (const plan of plans) {
      const button = element('button', `plan-library-card${planDraft?.id === plan.id ? ' selected' : ''}${plan.enabled === false ? ' disabled-plan' : ''}`);
      button.type = 'button'; button.dataset.planId = plan.id;
      button.append(element('strong', '', plan.name || '未命名方案'), element('small', '', planScopeText(plan)), element('span', '', `${plan.enabled === false ? '已停用' : plan.autoSelect === false ? '仅手动选择' : '参与自动匹配'} · ${(plan.moveRules || []).length} 招式 / ${(plan.itemRules || []).length} 道具 / ${(plan.vitaminRules || []).length} 强化`));
      button.addEventListener('click', () => { if (!planBusy) setPlanDraft(plan); }); root.append(button);
    }
    if (!plans.length) root.append(element('p', 'editor-note', search ? '没有匹配的方案。' : '还没有方案'));
    setText('plan-count', customPlans().length);
  }
  function renderCustomPlans(force = false) {
    const signature = JSON.stringify([customPlans(), catalog.planEditorSchema, catalog.moves?.length, catalog.items?.length, catalog.vitamins?.length]);
    renderPlanLibrary();
    if (!force && signature === customPlanSignature) return;
    customPlanSignature = signature;
    if (!planDraft) setPlanDraft();
    else if (!planDirty) {
      const saved = customPlans().find((plan) => plan.id === planDraft.id);
      if (saved) setPlanDraft(saved); else fillPlanForm();
    }
  }
  function ruleEntries(group) { return Array.isArray(catalog[group]) ? catalog[group] : []; }
  function ruleEntry(group, key) { return ruleEntries(group).find((entry) => String(first(entry.key, entry.id)) === String(key)); }
  function ruleName(group, key) { const entry = ruleEntry(group, key); return nameOf(first(entry?.name, entry?.nameZh, entry?.label), key); }
  function renderRuleResults(group) {
    const root = $(`plan-${group}-results`); root.replaceChildren();
    const search = $(`plan-${group}-search`).value.trim().toLocaleLowerCase();
    const info = RULE_GROUPS[group];
    const entries = ruleEntries(group).filter((entry) => `${nameOf(entry.name)} ${entry.key || ''} ${entry.id ?? ''} ${entry.type || ''} ${nameOf(catalog.typeNames?.[entry.type])} ${nameOf(entry.description)}`.toLocaleLowerCase().includes(search));
    for (const entry of entries.slice(0, search ? 40 : 12)) {
      const key = String(first(entry.key, entry.id));
      const selected = (planDraft?.[info.field] || []).some((rule) => rule.key === key);
      const button = element('button', `rule-result${selected ? ' selected' : ''}`); button.type = 'button'; button.disabled = selected; button.title = nameOf(entry.description);
      button.append(element('strong', '', nameOf(entry.name, key)), element('small', '', selected ? '已添加' : [entry.type ? nameOf(catalog.typeNames?.[entry.type], entry.type) : '', key].filter(Boolean).join(' · ')));
      button.addEventListener('click', () => { if (!planDraft) setPlanDraft(); planDraft[info.field].push({ key, priority: 1, [info.target]: null, avoid: false, ...(group === 'items' ? { copy: true, shop: true } : {}) }); setPlanDirty(); renderRuleRows(group); renderRuleResults(group); });
      root.append(button);
    }
    if (!entries.length) root.append(element('p', 'editor-note', ruleEntries(group).length ? '没有匹配结果，请换个名称或标识。' : '目录尚未读取，连接游戏后再试。'));
    else if (!search && entries.length > 12) root.append(element('p', 'rule-result-hint', `共 ${entries.length} 项，输入名称或效果搜索更多。`));
  }
  function numericRuleField(label, value, options, onChange) {
    const field = element('label', 'rule-field'); field.append(element('span', '', label));
    const input = document.createElement('input'); input.type = 'number'; input.min = String(options.min ?? 0); input.max = String(options.max ?? 1000); input.step = String(options.step ?? 1); input.value = value == null ? '' : value; input.placeholder = options.placeholder || '不限';
    input.addEventListener('change', () => { onChange(input.value === '' ? null : Math.max(Number(input.min), Math.min(Number(input.max), Number(input.value) || 0))); setPlanDirty(); });
    field.append(input); return field;
  }
  function ruleCheck(label, value, onChange) {
    const field = element('label', 'plan-check'); const input = document.createElement('input'); input.type = 'checkbox'; input.checked = value;
    input.addEventListener('change', () => { onChange(input.checked); setPlanDirty(); }); field.append(input, element('span', '', label)); return field;
  }
  function renderRuleRows(group) {
    const root = $(`plan-${group}-rules`); root.replaceChildren();
    const info = RULE_GROUPS[group], rules = planDraft?.[info.field] || [];
    setText(`plan-${group}-count`, `${rules.length} 条`);
    for (const [index, rule] of rules.entries()) {
      const row = element('div', 'rule-row'); const title = element('div', 'rule-row-title'); title.append(element('strong', '', ruleName(group, rule.key)), element('small', '', rule.key)); row.append(title);
      row.append(numericRuleField('优先级（小优先）', rule.priority, { min: catalog.planEditorSchema?.limits?.priorityMin ?? -100, max: catalog.planEditorSchema?.limits?.priorityMax ?? 100, placeholder: '1' }, (value) => { rule.priority = value ?? 1; }));
      row.append(numericRuleField(info.targetLabel, rule[info.target], { min: 1, max: group === 'moves' ? 999 : 9999 }, (value) => { rule[info.target] = value; }));
      row.append(ruleCheck('禁选', rule.avoid === true, (value) => { rule.avoid = value; }));
      if (group === 'items') row.append(ruleCheck('允许复制', rule.copy !== false, (value) => { rule.copy = value; }), ruleCheck('商店购买', rule.shop !== false, (value) => { rule.shop = value; }));
      const remove = element('button', 'text-button rule-remove', '移除'); remove.type = 'button'; remove.addEventListener('click', () => { rules.splice(index, 1); setPlanDirty(); renderRuleRows(group); renderRuleResults(group); }); row.append(remove); root.append(row);
    }
    if (!rules.length) root.append(element('div', 'rule-empty', `尚未添加${info.label}规则，继续使用智能选择。`));
  }
  function renderPlanStrategy() {
    const root = $('plan-strategy-fields'); root.replaceChildren(); if (!planDraft) return;
    const interactions = planDraft.interactions;
    const labels = { free: '免费奖励与选择', paid: '付费交互', copy: '复制道具', shop: '商店购物', roulette: '轮盘交互', tutor: '招式导师', shrine: '祭坛交互', healing: '治疗交互' };
    for (const [key, label] of Object.entries(labels)) root.append(ruleCheck(label, interactions[key] !== false, (value) => { interactions[key] = value; }));
    root.append(numericRuleField('保留金币', interactions.goldReserve, { min: 0, max: 1000000000, placeholder: '0' }, (value) => { interactions.goldReserve = value ?? 0; }));
    root.append(numericRuleField('单次最高花费', interactions.maxSpend, { min: 0, max: 1000000000 }, (value) => { interactions.maxSpend = value; }));
    root.append(numericRuleField('本局交互总预算', interactions.totalBudget, { min: 0, max: 1000000000 }, (value) => { interactions.totalBudget = value; }));
    root.append(numericRuleField('保留招式位至等级', planDraft.reserveUntilLevel, { min: 1, max: 999, placeholder: '20' }, (value) => { planDraft.reserveUntilLevel = value ?? 20; }));
    const replacement = element('label', 'plan-field'); replacement.append(element('span', '', '招式替换策略')); const select = document.createElement('select'); select.id = 'plan-replacement'; for (const entry of catalog.planEditorSchema?.replacementPolicies || [{value:'smart',label:'智能权衡'},{value:'weakest',label:'替换较弱招式'},{value:'never',label:'不主动替换'}]) select.add(new Option(entry.label, entry.value)); select.value = planDraft.replacementPolicy || 'smart'; select.addEventListener('change', () => { planDraft.replacementPolicy = select.value; setPlanDirty(); }); replacement.append(select); root.append(replacement);
    root.append(ruleCheck('允许方案外的智能选择', planDraft.allowOffPlan !== false, (value) => { planDraft.allowOffPlan = value; }));
    const heading = element('h3', 'editor-subheading wide', '属性评分偏好'); root.append(heading);
    const schemaStats = catalog.planEditorSchema?.stats || catalog.planEditorSchema?.statWeights;
    const stats = Array.isArray(schemaStats) ? schemaStats : ['damage', 'maxHp', 'armor', 'regen', 'moveSpeed', 'attackSpeed', 'area', 'projectiles', 'duration', 'luck', 'critChance', 'magnet'];
    const statLabels = { damage: '伤害', physical:'物理伤害',special:'特殊伤害', maxHp: '生命', armor: '护甲', regen: '回复',healing:'治疗效果', moveSpeed: '移动速度',projSpeed:'投射物速度', attackSpeed: '攻击速度', area: '范围', projectiles: '投射物', duration: '持续时间', luck: '幸运', critChance: '暴击率',critDamage:'暴击伤害',statusChance:'状态概率',statusDamage:'状态伤害', pickup: '拾取范围',xp:'经验',gold:'金币',dodge:'闪避',magnet:'拾取范围' };
    for (const entry of stats) { const key = typeof entry === 'string' ? entry : first(entry.key, entry.id); if (!key) continue; root.append(numericRuleField(nameOf(entry?.name, statLabels[key] || key), planDraft.statWeights[key], { min: 0, max: 5, step: .1, placeholder: '默认' }, (value) => { if (value == null) delete planDraft.statWeights[key]; else planDraft.statWeights[key] = value; })); }
    setText('plan-schema-note', `属性权重只影响选项评分，不改变游戏数值。${catalog.planEditorSchema?.fallbackExplanation || '全部候选被禁选时仍采用合法保底，此保底不可关闭。'}`);
  }
  function collectPlan() {
    if (!planDraft) planDraft = newPlanDraft();
    const result = { ...newPlanDraft(), ...planDraft };
    result.name = $('plan-name').value.trim(); result.description = $('plan-description').value.trim(); result.priority = Number($('plan-priority').value) || 0; result.enabled = $('plan-enabled').checked;
    result.autoSelect = $('plan-auto-select').checked;
    result.species = $('plan-species').value === 'all' ? null : Number($('plan-species').value);
    result.biome = $('plan-biome').value === 'all' ? null : $('plan-biome').value;
    result.tier = $('plan-tier').value === 'all' ? null : Number($('plan-tier').value);
    result.mode = $('plan-mode').value || 'any';
    const fields = Object.keys(newPlanDraft());
    if(result.capturedBuild) fields.push('capturedBuild');
    return Object.fromEntries(fields.map((key) => [key, result[key]]));
  }
  async function acceptPlanResponse(response) {
    if (Array.isArray(response?.customPlans)) receiveState({ customPlans: response.customPlans });
    else if (bridge?.getState) receiveState(await bridge.getState());
    characterSignature = ''; if (activeTab === 'characters') renderCharacters(true);
  }
  async function savePlan() {
    if (planBusy) return; const plan = collectPlan();
    if (!plan.name) { $('plan-name').focus(); showToast('请先给方案起个名称。', true); return; }
    const revision = planDraftRevision;
    setPlanBusy(true);
    try {
      const response = await command('saveCustomPlan', { plan }); await acceptPlanResponse(response);
      const saved = response?.plan || customPlans().find((entry) => entry.id === plan.id) || customPlans().find((entry) => entry.name === plan.name);
      if (revision === planDraftRevision) { setPlanDraft(saved || plan); setText('plan-save-status', '方案已保存，下局可选用'); showToast('方案已保存，可在「角色与配装」中选用。'); }
      else {
        // A newly created record still supplies its id for the next save, but
        // its older fields cannot replace text entered while the RPC waited.
        if (!plan.id && !planDraft?.id && saved?.id) planDraft.id = saved.id;
        planDirty = true; renderPlanLibrary(); setText('plan-save-status', '较早的内容已保存，当前新修改尚未保存。');
      }
    }
    catch (error) { showToast(error.message, true); }
    finally { setPlanBusy(false); }
  }
  function showPlansJson(value, message) { $('plans-json').value = JSON.stringify(value, null, 2); setText('plans-sharing-status', message || '可以复制 JSON 分享给其他玩家。'); showPlanSection('sharing'); }
  async function exportPlans(one = false) {
    if (planBusy) return; setPlanBusy(true);
    try { if (one) showPlansJson({ schemaVersion: 1, plans: [collectPlan()] }, '当前编辑内容已生成 JSON；尚未保存的修改也包含在内。'); else { const response = await command('exportCustomPlans'); showPlansJson({ schemaVersion: 1, plans: response?.plans || customPlans() }, response?.path ? `已导出到 ${response.path}` : '全部方案已生成 JSON。'); } }
    catch (error) { showToast(error.message, true); }
    finally { setPlanBusy(false); }
  }
  async function exportPlanFile(one = false) {
    if (planBusy) return;
    if (one && (!planDraft?.id || planDirty)) { showToast('请先保存当前方案，再导出方案文件。', true); return; }
    if (!one && !customPlans().length) { showToast('还没有已保存的方案，请先创建并保存。', true); return; }
    setPlanBusy(true);
    try {
      const response = await command('exportCustomPlans', { chooseFile: true, ...(one ? { ids: [planDraft.id] } : {}) });
      if (response?.cancelled) { showToast('已取消导出，方案保持不变。'); return; }
      if (!response?.path) throw new Error('未收到方案文件保存位置，请稍后重试。');
      setText('plans-sharing-status', `已保存到 ${response.path}，可以直接分享这个方案文件。`);
      showToast(`方案文件已保存：${response.path}`);
    } catch (error) { showToast(error.message, true); }
    finally { setPlanBusy(false); }
  }
  async function importPlanFile() {
    if (planBusy) return; setPlanBusy(true);
    try {
      const response = await command('importCustomPlanFile');
      if (response?.cancelled) { showToast('已取消导入，已有方案保持不变。'); return; }
      await acceptPlanResponse(response);
      renderPlanLibrary();
      setText('plans-sharing-status', '方案文件已校验并合并，其他方案保留。请检查范围和规则后再使用。');
      showToast('方案已导入，其他方案保留。');
    } catch (error) { showToast(error.message, true); }
    finally { setPlanBusy(false); }
  }
  async function importPlans() {
    if (planBusy) return;
    try {
      const parsed = JSON.parse($('plans-json').value);
      const plans = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.plans) ? parsed.plans : [parsed];
      if (!plans.length || plans.some((plan) => !plan || typeof plan !== 'object' || Array.isArray(plan))) throw new Error('请粘贴方案对象、方案数组或包含 plans 的方案包。');
      setPlanBusy(true); const response = await command('importCustomPlans', { plans }); await acceptPlanResponse(response); renderPlanLibrary(); setText('plans-sharing-status', `已导入 ${plans.length} 个方案，请检查范围和规则后再使用。`); showToast('方案已导入。');
    } catch (error) { showToast(error instanceof SyntaxError ? 'JSON 格式不正确，请检查后重试。' : error.message, true); }
    finally { setPlanBusy(false); }
  }
  function renderMaintenance() {
    renderConnectionDiagnostics();
    const update = state.updateStatus || state.maintenance?.updateStatus || {};
    const statusRoot = $('update-status'); statusRoot.replaceChildren();
    const statusLabel = { ready: '接口检查通过', compatible: '接口检查通过', checking: '正在检查更新', blocked: '需要适配或处理', error: '检测未完成', current: '已完成本次检测' }[update.state] || '当前更新检测';
    statusRoot.append(element('strong', '', `${statusLabel}${update.gameVersion ? ` · 游戏 ${update.gameVersion}` : ''}`));
    statusRoot.append(element('p', '', update.reason || '点击「检查更新」，获取当前官网和功能状态。'));
    if (update.checkedAt) statusRoot.append(element('small', '', `检测时间 ${timeText(update.checkedAt, true)}`));
    if (Array.isArray(update.features) && update.features.length) { const list = element('div', 'feature-status-list'); for (const feature of update.features) { const featureState = typeof feature === 'object' && ['ready','compatible','blocked','error','pending'].includes(feature.state) ? feature.state : ''; list.append(element('span', `feature-status ${featureState}`, typeof feature === 'string' ? feature : `${feature.name || feature.id || '功能'}：${feature.label || feature.status || feature.state || '待核验'}`)); } statusRoot.append(list); }
    const warnings = [
      [first(update.reloadWaitReason, state.reloadWaitReason, state.maintenance?.reloadWaitReason), '更新等待'],
      [first(update.resourceWarning, state.resourceWarning, state.maintenance?.resourceWarning), '资源提醒'],
      [first(update.catalogWarnings, state.catalogWarnings, state.maintenance?.catalogWarnings, catalog.warnings), '目录提醒'],
      [first(update.catalogWarning, state.catalogWarning, state.maintenance?.catalogWarning), '目录同步'],
    ];
    for (const [value, label] of warnings) {
      const entries = Array.isArray(value) ? value : value ? [value] : [];
      for (const warning of entries) { const text = typeof warning === 'string' ? warning : nameOf(first(warning?.message, warning?.reason, warning?.description, warning?.code), encyclopediaText(warning)); if (text) statusRoot.append(element('p', 'maintenance-warning', `${label}：${text}`)); }
    }
  }
  function connectionDiagnostics() {
    const value = state.connection || {}, diagnostic = { clientVersion: state.version || 'unknown' };
    for (const key of ['strategy', 'stage', 'runtimeVersion', 'sourceHash']) if (typeof value[key] === 'string') diagnostic[key] = value[key].slice(0, 128);
    if (value.javascriptFeatures && typeof value.javascriptFeatures === 'object') diagnostic.javascriptFeatures = {
      ok: value.javascriptFeatures.ok === true,
      missing: Array.isArray(value.javascriptFeatures.missing) ? value.javascriptFeatures.missing.filter(entry => typeof entry === 'string' && /^[a-zA-Z0-9_. -]{1,80}$/.test(entry)).slice(0, 20) : []
    };
    if (value.nativeBoot && typeof value.nativeBoot === 'object') {
      diagnostic.nativeBoot = {};
      for (const key of ['schemaVersion', 'phase', 'stage', 'startedAt', 'lastProgressAt', 'observedAt', 'progress', 'code']) {
        const entry = value.nativeBoot[key];
        if (typeof entry === 'number' && Number.isFinite(entry) || typeof entry === 'string') diagnostic.nativeBoot[key] = typeof entry === 'string' ? entry.slice(0, 100) : entry;
      }
    }
    const event = entry => {
      if (!entry || typeof entry !== 'object') return null;
      const result = {};
      for (const key of ['at', 'phase', 'code', 'httpStatus', 'exceptionType', 'hresult']) if (typeof entry[key] === 'number' && Number.isFinite(entry[key]) || typeof entry[key] === 'string') result[key] = typeof entry[key] === 'string' ? entry[key].slice(0, 100) : entry[key];
      try { const resource = new URL(entry.resource); if (resource.protocol === 'https:' && resource.hostname === 'pokebonk.com') result.resource = resource.origin + resource.pathname; } catch { }
      return result;
    };
    const latest = event(value.lastEvent); if (latest) diagnostic.lastEvent = latest;
    if (Array.isArray(value.events)) diagnostic.events = value.events.slice(-20).map(event).filter(Boolean);
    return diagnostic;
  }
  function renderConnectionDiagnostics() {
    const value = connectionDiagnostics();
    const stages = { starting: '正在初始化浏览器', waiting: '等待游戏加载', response: '已收到原生脚本', 'read-body': '正在读取原生响应', prepare: '正在检查游戏接口', prepared: '游戏脚本已适配', ready: '游戏接口已就绪', 'native-data': '游戏资源正在加载', 'native-script': '原生脚本需要重试', 'contract-blocked': '接口检查未通过', 'connection-error': '接入暂未完成，正在重试', 'runtime-unsupported': '浏览器组件需要更新' };
    const text = [stages[value.stage] || '等待读取接入状态', value.runtimeVersion ? `WebView2 ${value.runtimeVersion}` : '', value.nativeBoot?.phase ? `原生阶段 ${value.nativeBoot.phase}` : '', value.lastEvent?.httpStatus ? `HTTP ${value.lastEvent.httpStatus}` : '', value.lastEvent?.code || ''].filter(Boolean).join(' · ');
    setText('connection-status', text);
    $('copy-connection-diagnostics').disabled = !bridge;
  }
  function setMaintenanceBusy(value) {
    maintenanceBusy = value;
    for (const button of document.querySelectorAll('[data-maintenance-kind], #check-updates')) button.disabled = value;
    $('copy-update-prompt').disabled = value || !$('update-prompt').value;
  }
  function buildMaintenanceKinds() {
    const root = $('maintenance-kinds'); root.replaceChildren();
    for (const kind of MAINTENANCE_KINDS) { const button = element('button', 'maintenance-kind'); button.type = 'button'; button.dataset.maintenanceKind = kind.id; button.append(element('strong', '', kind.title), element('span', '', kind.purpose)); button.addEventListener('click', async () => { if (maintenanceBusy) return; setMaintenanceBusy(true); setText('maintenance-prompt-purpose', '正在整理完整提示词…'); try { const response = await command('generateUpdatePrompt', { kind: kind.id }); if (typeof response?.text !== 'string' || !response.text.trim()) throw new Error('未收到完整提示词，请稍后重试。'); maintenancePromptKind = kind.id; $('update-prompt').value = response.text; setText('maintenance-prompt-title', `${kind.title} · 完整提示词`); setText('maintenance-prompt-purpose', kind.purpose); document.querySelectorAll('[data-maintenance-kind]').forEach((node) => node.classList.toggle('selected', node.dataset.maintenanceKind === kind.id)); } catch (error) { showToast(error.message, true); setText('maintenance-prompt-purpose', '生成未完成，可重试或选择其他用途。'); } finally { setMaintenanceBusy(false); } }); root.append(button); }
  }

  function prerequisiteState() {
    const prerequisites = state.prerequisites;
    return prerequisites && typeof prerequisites === 'object' ? prerequisites : {};
  }
  function setBrowserOptimizationBusy(value) {
    browserOptimizationBusy = value;
    $('optimize-browser').disabled = value || !bridge;
    $('browser-optimization-accept').disabled = value || !browserOptimizationCanApply();
    $('browser-optimization-accept').setAttribute('aria-busy', String(value));
    setText('browser-optimization-accept', value ? '请稍候…' : '同意并优化');
  }
  function browserOptimizationCanApply() {
    return Array.isArray(browserOptimizationReport?.changes) && browserOptimizationReport.changes.some(change =>
      change && typeof change === 'object' && change.supported !== false && change.modifiable !== false);
  }
  function renderBrowserOptimization(report, applied = false) {
    browserOptimizationReport = report && typeof report === 'object' ? report : null;
    const root = $('browser-optimization-changes'); root.replaceChildren();
    setText('browser-optimization-scope', nameOf(report?.profileScope,
      '仅调整本客户端内置的 WebView2 浏览器，不修改电脑上 Edge 或 Chrome 的全局设置。'));
    for (const change of Array.isArray(report?.changes) ? report.changes : []) {
      if (!change || typeof change !== 'object') continue;
      const row = element('div', `browser-optimization-change${change.supported === false ? ' unsupported' : ''}`);
      row.append(element('strong', '', nameOf(change.label || change.title, change.id || '浏览器设置')));
      if (change.description) row.append(element('p', '', nameOf(change.description)));
      const displayValue = value => typeof value === 'boolean' ? value ? '开启' : '关闭' : typeof value === 'string' || typeof value === 'number' ? String(value) : '';
      const current = displayValue(change.current), proposed = displayValue(first(change.requested, change.proposed, change.target));
      const status = change.supported === false || change.modifiable === false ? '此项只作说明，不会应用修改。' : [current ? `当前：${current}` : '', proposed ? `调整为：${proposed}` : ''].filter(Boolean).join('；');
      if (status) row.append(element('p', '', status)); root.append(row);
    }
    if (!root.childElementCount) root.append(element('p', 'editor-note', '暂未读取到可修改项，未应用任何设置。'));
    const diagnostic = report?.diagnostics || {}, facts = [];
    for (const [key, label] of [['runtimeVersion','WebView2'], ['gpuSummary','图形状态'], ['gpu','图形状态'], ['hardwareAcceleration','硬件加速'], ['rendering','渲染状态']]) {
      const value = diagnostic[key];
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') facts.push(`${label}：${String(value)}`);
    }
    if (diagnostic.gpu && typeof diagnostic.gpu === 'object') {
      if (typeof diagnostic.gpu.renderer === 'string') facts.push(`图形设备：${diagnostic.gpu.renderer}`);
      if (diagnostic.gpu.contextLost === true) facts.push('图形上下文已丢失');
      if (typeof diagnostic.gpu.reason === 'string' && diagnostic.gpu.reason) facts.push(diagnostic.gpu.reason);
    }
    const memory = numeric(diagnostic.resources?.workingSetBytes);
    if (memory !== null && memory >= 0) facts.push(`浏览器工作集：${Math.round(memory / 1024 / 1024)} MB`);
    setText('browser-optimization-diagnostics', facts.length ? `${facts.join(' · ')}。显卡能力由运行组件和驱动决定，不能保证提高帧率。` : '优化效果取决于设备、驱动与游戏负载，不能保证消除所有卡顿。');
    const reload = report?.needsReload === true || report?.needsRestart === true ? report.activeRun === true ? '当前对局不会自动刷新；请正常结算后完整关闭并重开客户端，仅刷新游戏不会应用需重启项。' : '需完整关闭并重开客户端，仅刷新游戏不会应用需重启项。' : '';
    setText('browser-optimization-result', [nameOf(report?.message), nameOf(report?.warning), reload, !applied ? '同意后才会应用上述修改；选择不同意或关闭此页不会修改。' : ''].filter(Boolean).join(' '));
    $('browser-optimization-result').classList.remove('error');
  }
  async function openBrowserOptimization() {
    if (browserOptimizationBusy || !bridge) return;
    browserOptimizationReport = null;
    $('browser-optimization-dialog').showModal();
    setText('browser-optimization-result', '正在读取本客户端可用的浏览器设置…');
    $('browser-optimization-result').classList.remove('error');
    $('browser-optimization-changes').replaceChildren(); setBrowserOptimizationBusy(true);
    try { renderBrowserOptimization(await command('readBrowserOptimization')); }
    catch (error) { setText('browser-optimization-result', error.message || '设置读取未完成，请重试。'); $('browser-optimization-result').classList.add('error'); }
    finally { setBrowserOptimizationBusy(false); }
  }
  function renderPrerequisites() {
    const prerequisites = prerequisiteState();
    const status = String(prerequisites.status || prerequisites.state || '').toLocaleLowerCase();
    const missing = Array.isArray(prerequisites.missing) ? prerequisites.missing.length > 0 : Boolean(prerequisites.missing);
    const installing = prerequisiteBusy || ['installing','downloading','extracting','running','preparing'].includes(status);
    const ready = ['ready','installed','complete','ok'].includes(status) || prerequisites.ready === true;
    const message = nameOf(first(prerequisites.message, prerequisites.reason, prerequisites.detail), missing ? '检测到缺少运行组件，请点击右下「下载前置」安装内置离线包。' : ready ? '所需组件已就绪。需要修复时仍可点击「下载前置」运行离线安装包。' : '正在检测；「下载前置」使用内置离线包，不临时联网搜索。');
    setText('prerequisites-title', installing ? '正在安装运行前置' : missing ? '需要安装运行前置' : ready ? '运行前置已就绪' : ['error','failed'].includes(status) ? '前置安装未完成，可重试' : '运行前置');
    const progressText = typeof prerequisites.progress === 'string' ? prerequisites.progress : '';
    const exitText = prerequisites.installerExitCode != null ? `安装程序返回 ${prerequisites.installerExitCode}` : '';
    const restartText = prerequisites.restartRequired ? '需要重启客户端或电脑。' : '';
    setText('prerequisites-message', [message, progressText && progressText !== message ? progressText : '', exitText, restartText].filter(Boolean).join(' · '));
    const restartBeforeRetry = prerequisites.restartRequired === true && prerequisites.canInstall === false;
    const button = $('download-prerequisites'); button.disabled = installing || restartBeforeRetry || !bridge;
    button.classList.toggle('needs-prerequisite', missing || ['error','failed'].includes(status));
    button.setAttribute('aria-busy', String(installing));
    button.title = `${message} 使用客户端内置离线包。点击即同意微软许可；WebView2 含 SmartScreen，可能按微软隐私说明发送信息并自动更新。可在设置查看许可。`;
    $('prerequisites-status').classList.toggle('needs-prerequisite', missing || ['error','failed'].includes(status));
    const progress = typeof prerequisites.progress === 'object' ? first(prerequisites.progress?.percent, prerequisites.progress?.value) : prerequisites.progress;
    const value = numeric(progress);
    $('prerequisites-progress').hidden = !installing;
    if (value !== null) $('prerequisites-progress').value = Math.max(0, Math.min(100, value)); else $('prerequisites-progress').removeAttribute('value');
  }
  async function refreshPrerequisites() {
    if (!bridge) return;
    const response = await command('getPrerequisites');
    if (response && typeof response === 'object') receiveState({ prerequisites: response.prerequisites || response });
  }
  async function installPrerequisites() {
    if (prerequisiteBusy) return; prerequisiteBusy = true; renderPrerequisites();
    try {
      const response = await command('installPrerequisites');
      const snapshot = response?.prerequisites || (response && typeof response === 'object' && (typeof response.status === 'string' || typeof response.state === 'string') ? response : null);
      if (snapshot) receiveState({ prerequisites: snapshot });
      if (response?.cancelled) { showToast('已取消安装，可以稍后再次点击「下载前置」。'); return; }
      // The native installer has already rechecked availability. Keep its final
      // error/exit/restart result instead of replacing it with a generic scan.
      if (!snapshot) await refreshPrerequisites();
      showToast(response?.requiresRestart || response?.restartRequired || prerequisiteState().restartRequired ? '安装流程已结束，请按提示重启客户端或电脑。' : '安装流程已结束，请查看前置状态。');
    } catch (error) {
      receiveState({ prerequisites: { ...prerequisiteState(), status: 'failed', message: error.message } });
      showToast(error.message, true);
    } finally { prerequisiteBusy = false; renderPrerequisites(); }
  }
  function encyclopediaText(value, seen = new WeakSet()) {
    if (value == null) return '';
    if (typeof value !== 'object') return String(value);
    if (seen.has(value)) return ''; seen.add(value);
    if (Array.isArray(value)) return value.map((entry) => encyclopediaText(entry, seen)).join(' ');
    return Object.entries(value).map(([key, entry]) => `${key} ${encyclopediaText(entry, seen)}`).join(' ');
  }
  function searchText(value) { return String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim(); }
  function encyclopediaCategoryName(id) { return nameOf(catalog.encyclopedia?.categories?.find((entry) => entry.id === id)?.name, id || '未分类'); }
  function encyclopediaAvailability(entry) {
    const availability = entry.availability;
    const raw = searchText(typeof availability === 'object' ? first(availability?.state, availability?.status, availability?.kind, availability?.level, availability?.label) : availability);
    let kind = 'unknown', label = '状态见详情';
    if (/future|unreleased|unavailable|not.live|not.open|未开放|未上线|尚未/.test(raw)) { kind = 'unreleased'; label = '未开放'; }
    else if (/base|database|not.implemented|基础|未实装|未实现/.test(raw)) { kind = 'base'; label = '基础库资料'; }
    else if (/historical|历史|已下线/.test(raw)) { kind = 'historical'; label = '历史资料'; }
    else if (/locked|conditional|需解锁|条件/.test(raw)) { kind = 'conditional'; label = '有解锁条件'; }
    else if (/current|playable|implemented|available|active|live|已实装|已开放|可用/.test(raw)) { kind = 'implemented'; label = '已实装'; }
    return { kind, label: nameOf(typeof availability === 'object' ? first(availability?.label, availability?.title) : null, label) };
  }
  function indexEncyclopedia() {
    const entries = Array.isArray(catalog.encyclopedia?.entries) ? catalog.encyclopedia.entries : [];
    encyclopediaIndex = entries.map((entry, index) => ({ entry, key: String(entry.id ?? `entry-${index}`), text: searchText(`${encyclopediaText(entry)} ${encyclopediaCategoryName(entry.category)}`) }));
    const category = $('encyclopedia-category'), selected = category.value;
    category.replaceChildren(new Option('全部分类', 'all'));
    const categories = Array.isArray(catalog.encyclopedia?.categories) ? catalog.encyclopedia.categories : [];
    for (const entry of categories) category.add(new Option(nameOf(entry.name, entry.id), String(entry.id)));
    for (const id of new Set(entries.map((entry) => entry.category).filter(Boolean))) if (![...category.options].some((option) => option.value === String(id))) category.add(new Option(String(id), String(id)));
    category.value = [...category.options].some((option) => option.value === selected) ? selected : 'all';
    if (!encyclopediaIndex.some((item) => item.key === encyclopediaSelection)) encyclopediaSelection = null;
    encyclopediaPage = 0;
    if (activeTab === 'encyclopedia') renderEncyclopedia();
  }
  function appendEncyclopediaValue(root, value) {
    if (value == null || value === '') return;
    if (Array.isArray(value)) { const list = element('ul', 'encyclopedia-detail-list'); for (const entry of value) { const row = element('li'); appendEncyclopediaValue(row, entry); list.append(row); } root.append(list); return; }
    if (typeof value === 'object') { const fields = element('dl', 'encyclopedia-facts'); const labels = { effect:'效果',effects:'效果',mods:'数值效果',stat:'属性',add:'加成',mul:'倍率',description:'说明',level:'等级',max:'上限',type:'类型',rarity:'稀有度',unlock:'解锁条件',conditions:'条件',source:'来源',note:'备注',name:'名称',value:'数值',kind:'类别',status:'状态',url:'链接',title:'标题',key:'标识' }; for (const [key, entry] of Object.entries(value)) { if (entry == null || entry === '') continue; fields.append(element('dt', '', labels[key] || key)); const detail = element('dd'); appendEncyclopediaValue(detail, entry); fields.append(detail); } root.append(fields); return; }
    const text = String(value);
    if (/^https:\/\/\S+$/i.test(text)) { const link = element('a', 'encyclopedia-source-link', text); link.href = text; link.addEventListener('click', async (event) => { event.preventDefault(); try { await command('openLink', { url: text }); } catch (error) { showToast(error.message, true); } }); root.append(link); }
    else root.append(element('p', '', text));
  }
  function renderEncyclopediaDetail(entry) {
    const root = $('encyclopedia-detail'); root.replaceChildren();
    if (!entry) { const empty = element('div', 'encyclopedia-empty'); empty.append(icon('book'), element('strong', '', encyclopediaIndex.length ? '没有匹配条目' : '百科目录尚未读取'), element('p', '', encyclopediaIndex.length ? '换个关键词或分类试试。搜索也会检查效果、描述和来源。' : '连接游戏并获取公开目录后可在这里浏览。')); root.append(empty); return; }
    const availability = encyclopediaAvailability(entry); const title = element('div', 'encyclopedia-detail-title'); title.append(element('span', `encyclopedia-availability ${availability.kind}`, availability.label), element('span', 'encyclopedia-category-label', encyclopediaCategoryName(entry.category))); root.append(title, element('h2', '', nameOf(entry.name, entry.id)));
    if (entry.subtitle) root.append(element('p', 'encyclopedia-subtitle', nameOf(entry.subtitle)));
    if (entry.description) { const section = element('section', 'encyclopedia-detail-section'); section.append(element('h3', '', '功能与说明')); appendEncyclopediaValue(section, entry.description); root.append(section); }
    if (entry.details) { const section = element('section', 'encyclopedia-detail-section'); section.append(element('h3', '', '详细资料')); appendEncyclopediaValue(section, entry.details); root.append(section); }
    if (entry.availability) { const section = element('section', 'encyclopedia-detail-section'); section.append(element('h3', '', '实装与可用范围')); appendEncyclopediaValue(section, entry.availability); root.append(section); }
    if (entry.source) { const section = element('section', 'encyclopedia-detail-section'); section.append(element('h3', '', '来源与核验')); appendEncyclopediaValue(section, entry.source); root.append(section); }
    if (entry.keywords) { const keywords = element('p', 'encyclopedia-keywords', `相关词：${Array.isArray(entry.keywords) ? entry.keywords.map((word) => nameOf(word)).join(' · ') : nameOf(entry.keywords)}`); root.append(keywords); }
  }
  function renderEncyclopedia() {
    const data = catalog.encyclopedia || {};
    const terms = searchText($('encyclopedia-search').value).split(' ').filter(Boolean), category = $('encyclopedia-category').value;
    const matches = encyclopediaIndex.filter((item) => (category === 'all' || String(item.entry.category) === category) && terms.every((term) => item.text.includes(term)));
    const pages = Math.max(1, Math.ceil(matches.length / ENCYCLOPEDIA_PAGE_SIZE)); encyclopediaPage = Math.max(0, Math.min(encyclopediaPage, pages - 1));
    const visible = matches.slice(encyclopediaPage * ENCYCLOPEDIA_PAGE_SIZE, (encyclopediaPage + 1) * ENCYCLOPEDIA_PAGE_SIZE);
    if (!matches.some((item) => item.key === encyclopediaSelection)) encyclopediaSelection = visible[0]?.key || null;
    const root = $('encyclopedia-list'); root.replaceChildren();
    for (const item of visible) { const entry = item.entry, availability = encyclopediaAvailability(entry); const card = element('button', `encyclopedia-card${item.key === encyclopediaSelection ? ' selected' : ''}`); card.type = 'button'; card.dataset.entryId = item.key; const heading = element('span', 'encyclopedia-card-heading'); heading.append(element('strong', '', nameOf(entry.name, entry.id)), element('span', `encyclopedia-availability ${availability.kind}`, availability.label)); card.append(heading); if (entry.subtitle) card.append(element('small', '', nameOf(entry.subtitle))); card.append(element('p', '', encyclopediaText(entry.description || encyclopediaCategoryName(entry.category)).slice(0, 100))); card.addEventListener('click', () => { encyclopediaSelection = item.key; renderEncyclopedia(); }); root.append(card); }
    if (!visible.length) root.append(element('p', 'editor-note', encyclopediaIndex.length ? '没有匹配结果，试试功能描述、效果或其他分类。' : '正在等待读取百科目录。'));
    setText('encyclopedia-count', `${matches.length.toLocaleString('zh-CN')} / ${encyclopediaIndex.length.toLocaleString('zh-CN')} 条`);
    setText('encyclopedia-page', `${encyclopediaPage + 1} / ${pages}`); $('encyclopedia-prev').disabled = encyclopediaPage === 0; $('encyclopedia-next').disabled = encyclopediaPage >= pages - 1;
    setText('encyclopedia-meta', [data.gameVersion ? `游戏 ${data.gameVersion}` : '公开目录', data.verifiedAt ? `核对 ${timeText(data.verifiedAt, true)}` : '', '名称、描述、效果、机制和来源均可搜索'].filter(Boolean).join(' · '));
    const notes = Array.isArray(data.notes) ? data.notes.filter(Boolean).join('；') : nameOf(data.notes);
    setText('encyclopedia-notes', `${notes}${notes ? '；' : ''}基础库资料不代表已实装、已开放或玩家已解锁，请以条目说明和实际游戏为准。`);
    renderEncyclopediaDetail(matches.find((item) => item.key === encyclopediaSelection)?.entry);
  }

  const LOG_REWARD_CATEGORIES = { shiny:'异色', dex:'图鉴', appearance:'外观', bonkoin:'邦币', stardust:'星尘', character:'角色', map:'地图', research:'研究', achievement:'成就', permanentItem:'永久道具' };
  function logCategory(entry) {
    if (Object.hasOwn(LOG_REWARD_CATEGORIES,entry.category)) return entry.category;
    const type=nameOf(first(entry.type,entry.kind),'info').toLowerCase(),title=logMessage(entry);
    if (/error|fail|warn|异常|错误|失败/.test(type)) return 'error';
    if (/run|result|region|match|start|end|clear|boss|对局|结算|通关/.test(type)) return 'run';
    if (/异色/.test(title)) return 'shiny';
    if (/图鉴/.test(title)) return 'dex';
    if (/邦币/.test(title)) return 'bonkoin';
    if (/外观|形态|装扮/.test(title)) return 'appearance';
    if (/星尘/.test(title)) return 'stardust';
    if (/角色|联盟/.test(title)) return 'character';
    if(type==='unlock')return 'map';
    if(type==='research'||type==='achievement')return type;
    if(/永久道具/.test(title))return 'permanentItem';
    return /reward|loot|capture|discov|unlock|收获|奖励|捕获|解锁/.test(type)?'reward':'info';
  }
  function logKind(entry) {
    const category=logCategory(entry);
    return Object.hasOwn(LOG_REWARD_CATEGORIES,category)?'reward':category;
  }
  function isConciseLog(entry) {
    if (!entry || typeof entry !== 'object') return false;
    const type = nameOf(first(entry.type, entry.kind, entry.category), '').toLowerCase();
    const text = logMessage(entry);
    if (Object.hasOwn(LOG_REWARD_CATEGORIES,entry.category) && !/choice|movement|motion|config|cadence|upgrade/.test(type)) return true;
    if (/error|fail|warn|异常|错误|失败/.test(type) || entry.level === 'error') return true;
    if (/^(run|result|region|match|run-start|run-end|capture|unlock|research|achievement|claim)$/.test(type)) return true;
    if (/choice|movement|motion|config|cadence|upgrade/.test(type)) return false;
    return /对局.*(开始|结束|保存|通关)|开始第.*局|本局.*(结束|保存|通关)|区域推进|进入第.*区|新增.*(图鉴|角色|异色)|新角色.*联盟|发现异色|捕获异色|已解锁|解锁.*(成功|完成)|研究.*(完成|解锁)|委托.*(完成|领取)|领取.*奖励|成就.*(完成|领取)|重连|恢复.*(成功|失败)|补存|断线|掉线|重登|重试|临时游客|部署更新|接口.*重新接入|进度.*(校正|同步)|浏览器优化|客户端关闭/.test(text);
  }
  function logLabel(entry) { return LOG_REWARD_CATEGORIES[logCategory(entry)] || ({ error: '异常', reward: '收获', run: '对局', info: '动态' })[logKind(entry)] || '动态'; }
  function logMessage(entry) { return nameOf(first(entry.message, entry.text, entry.title, entry.event), '状态已更新'); }
  function logTime(entry) { return first(entry.time, entry.at, entry.timestamp, entry.date, entry.createdAt); }
  function logDetail(entry) {
    const value = first(entry.detail, entry.details, entry.summary);
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    const rewards = first(entry.rewards, value);
    if (!rewards || typeof rewards !== 'object') return '';
    if (Array.isArray(rewards)) return rewards.map((reward) => nameOf(reward)).join(' · ');
    const labels = { stardust: '星尘', stars: '星尘', seen: '图鉴', dex: '图鉴', newDex: '图鉴', league: '角色', newCharacters: '角色', research: '研究', kills: '击败', duration: '时长', gold: '金币', xp: '经验', shinies: '异色', shiniesFound: '遇见异色', capturedShinies: '捕获异色', newShinies: '已结算新异色' };
    return Object.entries(rewards).map(([key, amount]) => {
      if (typeof amount === 'object') return '';
      return `${labels[key] || key} ${typeof amount === 'number' && amount > 0 ? '+' : ''}${nameOf(amount)}`;
    }).filter(Boolean).join(' · ');
  }
  function newestLogs() { return logs.slice().reverse(); }
  function renderRecent() {
    if (panelHidden) return;
    const root = $('recent-feed');
    const recent = logs.slice(-(expanded ? 6 : 3)).reverse();
    const signature = JSON.stringify([recent, expanded, logsWereCleared]);
    if (signature === recentSignature) return;
    recentSignature = signature;
    if (!logs.length) {
      if (root.querySelector('.empty-feed')) return;
      const empty = element('div', 'empty-feed'); const symbol = element('span', 'empty-symbol'); symbol.append(icon('leaf'));
      empty.append(symbol, element('span', '', logsWereCleared ? '日志已清空' : '冒险尚未开始'), element('small', '', '记录每局起止、解锁成果与异常。')); root.replaceChildren(empty); return;
    }
    root.replaceChildren();
    for (const entry of recent) {
      const row = element('div', `feed-item ${logKind(entry)}`);
      const message = element('span', 'feed-message', logMessage(entry)); message.title = `${logMessage(entry)}${logDetail(entry) ? ` · ${logDetail(entry)}` : ''}`;
      row.append(element('i', 'feed-point'), message, element('time', 'feed-time', timeText(logTime(entry)))); root.append(row);
    }
  }
  function logPageKey() { return JSON.stringify([state.logRevision ?? [logs.length,logs.at(-1)?.id],logFilter,currentConfig().logRetentionRuns ?? 100]); }
  function retryFailedLogPage() { if(logPageFailedKey){logPageRequestedKey='';logPageFailedKey='';} }
  async function refreshLogPage() {
    const key=logPageKey();
    if(logPagePending || logPageRequestedKey===key || typeof bridge?.command!=='function' || panelHidden || activeTab!=='logs')return;
    logPagePending=true;logPageRequestedKey=key;
    const requestedFilter=logFilter;
    try {
      const result=await command('getLogEntries',{filter:requestedFilter});
      if(logPageKey()===key && Array.isArray(result?.logs)){
        logPageFailedKey='';logPage={...result,filter:requestedFilter,key,logs:result.logs.filter(isConciseLog)};
        logSignature='';renderLogs(true);
      } else if(logPageKey()===key)logPageFailedKey=key;
    } catch { logPageFailedKey=key; if(logPageKey()===key)renderLogs(true); /* Retry only on a later explicit log-page action, never recursively poll a failed journal read. */ }
    finally {
      logPagePending=false;
      if(!disposing && activeTab==='logs' && !panelHidden && logPageKey()!==key)refreshLogPage();
    }
  }
  function logSummaryText() {
    const started=dateOf(first(state.session.startedAt,state.session.startTime));
    const page=logPage?.key===logPageKey()?logPage:null;
    return `${started?`${started.toLocaleDateString('zh-CN')} ${timeText(started)} 开始 · `:''}本次运行 ${durationText(sessionSeconds())} · ${page?`${page.total} 条保留记录 · 当前筛选 ${page.matches} 条${page.matches>500?' · 显示最新500条，打开日志查看完整记录':''}`:`近期 ${logs.length} 条记录${logPageFailedKey===logPageKey()?' · 完整日志暂未读取，可重新进入此页或点击筛选重试':''}`}`;
  }
  function renderLogs(force = false) {
    if(panelHidden)return;
    const limit=currentConfig().logRetentionRuns ?? 100,range=$('log-retention-runs');
    if(range && document.activeElement!==range)range.value=String(limit);
    refreshLogPage();
    const page=logPage?.key===logPageKey()?logPage:null;
    const signature=JSON.stringify([page?.key,page?.logs?.length,logs.length,logs.at(-1),logFilter,limit]);
    if(!force && signature===logSignature)return;
    logSignature=signature;
    const rows=$('log-rows');rows.replaceChildren();
    const visible=(page?page.logs.slice().reverse():newestLogs()).filter(entry=>logFilter==='all'||(logFilter==='reward'?logKind(entry)==='reward':logCategory(entry)===logFilter));
    $('logs-empty').hidden=visible.length>0;
    $('logs-empty').querySelector('strong').textContent=logs.length||page?.total?'当前筛选下没有记录':'还没有日志';
    $('logs-empty').querySelector('p').textContent=logs.length||page?.total?'切换到「全部」查看其他动态。':'开始挂机后，记录对局起止、已保存收获和局外解锁。';
    for(const entry of visible.slice(0,500)){
      const row=element('tr'),timeCell=element('td','',timeText(logTime(entry),true)),typeCell=element('td');
      typeCell.append(element('span',`log-type ${logKind(entry)}`,logLabel(entry)));
      row.append(timeCell,typeCell,element('td','',logMessage(entry)),element('td','',logDetail(entry)||'—'));rows.append(row);
    }
    setText('log-summary',logSummaryText());
  }
  function renderFooter() {
    const running = normalizedRunning(), paused = normalizedPaused();
    const managed = currentConfig().mode === 'autoManage';
    const recovering = activeRecovery();
    const canReconnect = state.recovery?.canRetry === true && !recovering;
    const adopting = !running && hasActiveNativeRun();
    let label = !bridge ? '正在连接客户端' : !state.profile && !state.game.accountType ? '等待进入游戏' : running ? paused ? '挂机已暂停' : '旅伴正在推进' : '已就绪';
    let detail = !bridge ? '连接后自动同步游戏状态' : !state.profile && !state.game.accountType ? '在上方登录账号或选择游客，并选好初始宝可梦' : selectedLocked() ? '当前角色尚未解锁，请重新选择' : selectedShinyBlocked() ? '请在挂机模式中选择当前可刷的异色目标' : running ? paused ? '当前对局保留，点击继续即可恢复' : nameOf(first(modeInfo(uiModeId()).label, modeInfo(uiModeId()).name)) + ' · 模式与角色变更下一局生效' : '选择目标与角色后，点击开始挂机';
    if (adopting) { label = '辅助已停，可自行操作'; detail = '继续挂机将接管本局；角色与地图下局生效'; }
    else if (currentConfig().mode === 'shiny' && currentShinyProgress().complete) { label = '异色目标已完成'; detail = nameOf(currentShinyProgress().message, '已确认收藏，可选择其他目标后继续'); }
    if (managed) {
      detail = running && !paused && typeof state.game.status === 'string' && state.game.status.trim() ? state.game.status : hasActiveNativeRun() ? '自动托管只接管当前对局；本局结束后停止，不自动开下一局。' : '请先手动开始原生对局；自动托管不会替你开局。';
      if (running && !paused) label = '正在托管当前对局';
    }
    if (recovering) { label = state.recovery.requiresLogin ? '等待登录后自动续挂' : state.recovery.phase === 'blocked' ? '等待兼容检查' : '正在自动恢复'; detail = recoveryDetail(); }
    else if (state.error) { label = '需要处理'; detail = nameOf(state.error); }
    else if (!adopting && state.status && typeof state.status === 'object') { label = nameOf(state.status.title, label); detail = nameOf(state.status.message, detail); }
    else if (!adopting && typeof state.status === 'string' && state.status) detail = state.status;
    if (state.compatibilityReport?.maintenanceScope?.automaticPlay === false) { label = '第三赛季接口候选'; detail = '目录与方案编辑可用，游玩接口待核验。'; }
    setText('control-status', label); setText('control-detail', detail);
    $('control-indicator').className = `control-indicator${recovering ? ' paused' : state.error ? ' error' : paused ? ' paused' : running ? '' : ' idle'}`;
    const actionLabel = recovering ? '停止自动恢复' : canReconnect ? '重新连接并挂机' : running ? paused ? managed ? '继续托管' : '继续挂机' : managed ? '停止托管' : '暂停挂机' : adopting || paused ? managed ? '继续托管' : '继续挂机' : managed ? '开始托管' : '开始挂机';
    setText('main-action-label', recoveryCancelBusy ? '正在停止…' : busy && !recovering ? '请稍候…' : actionLabel);
    mountIcon($('main-action-icon'), recovering || running && !paused ? 'pause' : 'play');
    $('main-action').classList.toggle('paused', recovering || running && !paused);
    $('main-action').disabled = !bridge || recoveryCancelBusy || !recovering && (busy || !canReconnect && (!state.profile || ((!running || paused) && Boolean(state.error || !adopting && (selectedLocked() || selectedShinyBlocked())))));
    const interfaceOnly = state.compatibilityReport?.maintenanceScope?.automaticPlay === false && !running && !recovering;
    if (interfaceOnly) { $('main-action').disabled = true; setText('main-action-label', '游玩接口待核验'); }
    const scope = state.compatibilityReport?.maintenanceScope;
    const unsupportedMode = scope && !scope.modeIds?.includes(currentConfig().mode);
    const selectedBiome = currentModeSettings()?.biome;
    const unsupportedMap = Array.isArray(scope?.biomeIds) && selectedBiome && selectedBiome !== 'auto' && !scope.biomeIds.includes(selectedBiome);
    if (!running && !recovering && (unsupportedMode || unsupportedMap)) {
      $('main-action').disabled = true; setText('main-action-label', '当前选择待适配');
    }
    $('main-action').title = interfaceOnly ? state.compatibilityReport.maintenanceScope.reason : '';
    $('login-button').disabled = !bridge;
    $('optimize-browser').disabled = !bridge || browserOptimizationBusy;
    renderClientStage();
  }
  function renderPanelStrip() {
    const detail = activeRecovery() ? '连接恢复中' : normalizedRunning() && !normalizedPaused() ? '正在挂机' : hasActiveNativeRun() ? '可手动游戏，辅助未运行' : '辅助待机';
    setText('panel-hidden-status', `控制面板已隐藏 · ${detail} · 点击右侧恢复`);
  }
  function setPanelHidden(value) {
    if (panelHidden === value) return;
    panelHidden = value;
    document.body.classList.toggle('panel-hidden', value);
    $('panel-hidden-bar').hidden = !value;
    $('dock').hidden = value;
    if (value) { closeWecomView(); maskRecoveryLogin(); renderRecoveryLogin(); stopSkinPreview(); cancelPendingSkinPreview(true); ++skinPreviewRequest; renderPanelStrip(); }
    else {
      if (panelCatalogDirty) { panelCatalogDirty = false; receiveCatalog(catalog); }
      renderAccount(); renderClientStage(); renderModes(); renderConfig(); renderOverview(); renderFooter(); renderRecent(); renderPrerequisites();
      if (activeTab === 'characters') renderCharacters();
      if (activeTab === 'logs') renderLogs();
      if (activeTab === 'plans') renderCustomPlans(true);
      if (activeTab === 'maintenance') renderMaintenance();
      if (activeTab === 'skins') { renderSkins(); if (!skinsLoaded && !skinsBusy) refreshSkins(); }
      if (state.catalogRevision !== undefined && String(state.catalogRevision) !== catalogRevisionSeen) { catalogRevisionSeen = String(state.catalogRevision); refreshCatalog(); }
    }
  }
  async function requestPanelVisibility(hidden) {
    if (panelLayoutBusy) return;
    const previous = panelHidden;
    panelLayoutBusy = true; panelVisibilityPending = hidden;
    for (const id of ['hide-panel','restore-panel','expand-button']) $(id).disabled = true;
    setPanelHidden(hidden);
    try { await command('panelVisibility', { hidden }); }
    catch (error) { setPanelHidden(previous); if (previous) setText('panel-hidden-status', `恢复未成功：${error.message} · 可再次点击恢复`); else showToast(error.message, true); }
    finally { panelVisibilityPending = null; panelLayoutBusy = false; for (const id of ['hide-panel','restore-panel','expand-button']) $(id).disabled = false; }
  }
  function setExpanded(value) {
    expanded = value;
    document.body.classList.toggle('expanded', expanded);
    $('expand-button').setAttribute('aria-expanded', String(expanded));
    const label = expanded ? '收起控制面板' : '展开控制面板';
    $('expand-button').title = label; $('expand-button').setAttribute('aria-label', label);
    mountIcon($('expand-button'), expanded ? 'collapse' : 'expand');
    renderRecent();
  }

  document.querySelectorAll('[data-tab]').forEach((node) => {
    node.addEventListener('click', () => showTab(node.dataset.tab));
    node.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const buttons = [...document.querySelectorAll('[data-tab]')];
      const index = buttons.indexOf(node);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
      showTab(buttons[next].dataset.tab); buttons[next].focus();
    });
  });
  document.querySelectorAll('[data-go-tab]').forEach((node) => node.addEventListener('click', () => showTab(node.dataset.goTab)));
  document.querySelectorAll('[data-log-filter]').forEach((node) => node.addEventListener('click', () => {
    logFilter = node.dataset.logFilter;retryFailedLogPage();
    $('log-category-filter').value='';
    document.querySelectorAll('[data-log-filter]').forEach((button) => button.classList.toggle('selected', button === node));
    renderLogs(true);
  }));
  $('log-category-filter').addEventListener('change',event=>{
    if(!Object.hasOwn(LOG_REWARD_CATEGORIES,event.target.value))return;
    logFilter=event.target.value;retryFailedLogPage();
    document.querySelectorAll('[data-log-filter]').forEach(button=>button.classList.toggle('selected',button.dataset.logFilter==='reward'));
    renderLogs(true);
  });
  $('log-retention-runs').addEventListener('change',async event=>{
    const value=Number(event.target.value);
    if(![0,1,5,10,20,50,100,1000].includes(value))return;
    if(await saveConfig({logRetentionRuns:value})){
      logPage=null;logPageRequestedKey='';renderLogs(true);
    } else {
      event.target.value=String(currentConfig().logRetentionRuns ?? 100);renderLogs(true);
    }
  });
  $('biome-select').addEventListener('change', (event) => saveModeSettings({ biome: event.target.value }));
  $('tier-select').addEventListener('change', (event) => saveModeSettings({ tier: event.target.value === 'auto' ? 'auto' : Number(event.target.value) }));
  $('leaderboard-camp-stage').addEventListener('change', event => saveModeSettings({campStage:event.target.value==='auto'?'auto':Number(event.target.value)}));
  $('collection-species').addEventListener('change', event => saveModeSettings({species:event.target.value === 'auto' ? 'auto' : Number(event.target.value)}));
  $('wardrobe-look').addEventListener('change', event => saveModeSettings({look:event.target.value}));
  $('appearance-count-mode').addEventListener('change',event=>saveModeSettings({countMode:event.target.value}));
  $('appearance-count-camp-stage').addEventListener('change',event=>saveModeSettings({countCampStage:event.target.value==='auto'?'auto':Number(event.target.value)}));
  $('appearance-settle-on-goal').addEventListener('change',event=>saveModeSettings({settleOnGoal:event.target.checked}));
  $('tower-exit-policy').addEventListener('change',(event)=>saveConfig({modeSettings:{tower:{exitPolicy:event.target.value}}}));
  $('auto-manage-build-priority').addEventListener('change', event => saveConfig({ autoManageBuildPriority: event.target.checked }));
  $('tower-no-candles').addEventListener('change',(event)=>saveConfig({modeSettings:{tower:{noCandles:event.target.checked}}}));
  $('mutation-target').addEventListener('change',event=>saveConfig({modeSettings:{mutation:{target:event.target.value}}}));
  $('mutation-after-daily-rewards').addEventListener('change',event=>saveConfig({modeSettings:{mutation:{afterDailyRewards:event.target.value}}}));
  const tombFloor=$('tower-tomb-experience-floor');
  for(let floor=1;floor<=100;floor++)tombFloor.add(new Option('第'+floor+'层',String(floor)));
  tombFloor.addEventListener('change',()=>saveConfig({modeSettings:{tower:{tombExperienceFloor:Number(tombFloor.value)}}}));
  $('tower-only-experience').addEventListener('change',(event)=>saveConfig({modeSettings:{tower:{onlyExperience:event.target.checked}}}));
  $('tower-save-money-after-50').addEventListener('change',(event)=>saveConfig({modeSettings:{tower:{saveMoneyAfter50:event.target.checked}}}));
  $('tower-aggressive-ultimate').addEventListener('change',(event)=>saveConfig({modeSettings:{tower:{aggressiveUltimate:event.target.checked}}}));
  $('tower-curse-list').addEventListener('click',event=>{
    const button=event.target.closest('button[data-curse-move]');if(!button||button.disabled)return;
    const {order}=towerCurseOrder(currentConfig().modeSettings?.tower?.cursePriority),index=order.indexOf(button.closest('[data-curse-id]').dataset.curseId),next=index+(button.dataset.curseMove==='up'?-1:1);
    if(index<0||next<0||next>=order.length)return;
    [order[index],order[next]]=[order[next],order[index]];
    saveConfig({modeSettings:{tower:{cursePriority:order}}});
    const focus=$('tower-curse-list').querySelector(`[data-curse-id="${order[next]}"] [data-curse-move="${button.dataset.curseMove}"]`);
    if(focus&&!focus.disabled)focus.focus();
  });
  $('tower-curse-reset').addEventListener('click',()=>saveConfig({modeSettings:{tower:{cursePriority:'auto'}}}));
  $('tower-experience-blessing-priority').addEventListener('change',event=>saveConfig({modeSettings:{tower:{experienceBlessingPriority:event.target.checked}}}));
  $('fps-select').addEventListener('change', (event) => saveConfig({ fps: Number(event.target.value) }));
  $('display-mode').addEventListener('change', (event) => saveConfig({display:{mode:event.target.value}}));
  for (const [key, id] of [['name', 'recovery-login-name'], ['password', 'recovery-login-password']]) {
    $(id).addEventListener('input', () => {
      recoveryLoginTouched[key] = true; recoveryLoginRevision++;
      setText('recovery-login-draft-status', '输入停止后自动在本机加密保存。');
      clearTimeout(recoveryLoginTimer);
      recoveryLoginTimer = setTimeout(() => flushRecoveryLogin(), 1000);
    });
  }
  $('save-recovery-login').addEventListener('click', () => flushRecoveryLogin(true));
  $('toggle-recovery-login-visibility').addEventListener('click', async () => {
    if (recoveryLoginReadBusy) return;
    if (recoveryLoginVisible) { maskRecoveryLogin(); renderRecoveryLogin(); return; }
    recoveryLoginReadBusy = true; renderRecoveryLogin();
    const revision = recoveryLoginRevision;
    const visibilityEpoch = recoveryLoginVisibilityEpoch;
    try {
      const values = state.recoveryLogin?.saved && (!recoveryLoginTouched.name || !recoveryLoginTouched.password)
        ? await command('readRecoveryLogin') : {};
      if (revision !== recoveryLoginRevision || visibilityEpoch !== recoveryLoginVisibilityEpoch || activeTab !== 'account') return;
      if (!recoveryLoginTouched.name) $('recovery-login-name').value = String(values.name || '');
      if (!recoveryLoginTouched.password) $('recovery-login-password').value = String(values.password || '');
      recoveryLoginVisible = true;
      $('recovery-login-name').type = $('recovery-login-password').type = 'text';
      $('toggle-recovery-login-visibility').setAttribute('aria-pressed', 'true');
      setText('toggle-recovery-login-visibility', '隐藏账号和密码');
    } catch { showToast('无法显示本机记录，请重新填写或清除。', true); }
    finally { recoveryLoginReadBusy = false; renderRecoveryLogin(); }
  });
  $('clear-recovery-login').addEventListener('click', async () => {
    if (recoveryLoginBusy) return;
    clearTimeout(recoveryLoginTimer);
    const revision = ++recoveryLoginRevision;
    recoveryLoginBusy = true; renderRecoveryLogin();
    try {
      await command('clearRecoveryLogin'); recoveryLoginSavedRevision = revision;
      if (bridge?.getState) receiveState(await bridge.getState());
      if (recoveryLoginRevision === revision) { maskRecoveryLogin(); clearRecoveryLoginInputs(); }
      setText('recovery-login-draft-status', '本机记录已清除。');
      showToast('已清除本机加密登录信息。');
    }
    catch { showToast('清除未完成，请重试。', true); }
    finally {
      recoveryLoginBusy = false; renderRecoveryLogin();
      if (recoveryLoginRevision !== revision) recoveryLoginTimer = setTimeout(() => flushRecoveryLogin(), 700);
    }
  });
  window.addEventListener('blur', () => { maskRecoveryLogin(); renderRecoveryLogin(); });
  for (const id of ['random-delay-min','random-delay-max']) {
    $(id).addEventListener('input', () => { delayRangeDirty = true; validateDelayRange(); });
    $(id).addEventListener('change', saveDelayRange);
  }
  $('build-select').addEventListener('change', (event) => saveConfig({ build: event.target.value }));
  $('character-search').addEventListener('input', () => renderCharacters(true));
  $('unlocked-only').addEventListener('change', () => renderCharacters(true));
  document.querySelectorAll('[data-shiny-mode]').forEach((node) => node.addEventListener('click', () => {
    if (node.dataset.shinyMode === 'target' && !(Number(currentConfig().shinyTargetId) > 0)) {
      shinyPickerDraft = true; renderShiny(); return;
    }
    shinyPickerDraft = false; saveConfig({ shinyMode: node.dataset.shinyMode });
  }));
  $('shiny-search').addEventListener('input', renderShiny);
  for(const type of ['shiny','classic'])$('shiny-type-'+type).addEventListener('change',event=>{
    const selected=shinyTypes(),next=event.target.checked?[...new Set([...selected,type])]:selected.filter(value=>value!==type);
    if(!next.length){event.target.checked=true;showToast('至少选择一种异色类型。',true);return;}
    saveConfig({shinyTypes:['shiny','classic'].filter(value=>next.includes(value))});
  });
  $('unlock-target-search').addEventListener('input', () => renderUnlockTargets(true));
  $('unlock-target-options').addEventListener('focusout', () => queueMicrotask(() => {
    if (!$('unlock-target-options').contains(document.activeElement)) { unlockTargetsSignature = ''; renderUnlockTargets(); }
  }));
  $('shiny-stop-when-done').addEventListener('change', (event) => saveConfig({ shinyStopWhenDone: event.target.checked }));
  $('shiny-use-stone').addEventListener('change', (event) => saveConfig({ shinyUseStone: event.target.checked }));
  $('shiny-stage-wait').addEventListener('change',e=>saveConfig({shinyStageWait:e.target.checked}));
  $('shiny-stay-after-final-clear').addEventListener('change',e=>saveConfig({shinyStayAfterFinalClear:e.target.checked}));
  $('shiny-stage-wait-seconds').addEventListener('change',e=>{const n=e.target.valueAsNumber;if(!Number.isInteger(n)||n<1||n>86400){showToast('请输入1—86400之间的整数秒数。',true);return;}saveConfig({shinyStageWaitSeconds:n});});
  $('main-action').addEventListener('click', async () => {
    if (activeRecovery()) {
      if (recoveryCancelBusy) return;
      pendingConnectionAction = '';
      recoveryCancelBusy = true; renderFooter();
      try { await command('pause'); if (bridge?.getState) receiveState(await bridge.getState()); }
      catch (error) { showToast(error.message, true); }
      finally { recoveryCancelBusy = false; renderFooter(); }
      return;
    }
    if (busy) return;
    const observedIntent = state.recovery?.intentGeneration;
    const expectedIntentGeneration = Number.isSafeInteger(observedIntent) && observedIntent >= 0 ? observedIntent : null;
    busy = true; renderFooter();
    let action = '';
    try {
      action = normalizedRunning() && !normalizedPaused() ? 'pause' : normalizedPaused() || state.paused ? 'resume' : 'start';
      if (action !== 'pause') {
        await flushConfigWrites();
        if (expectedIntentGeneration !== null && state.recovery?.intentGeneration !== expectedIntentGeneration) throw new Error('挂机启动已取消，请按当前状态重新操作。');
        // Another explicit start can finish while settings are saved. An older
        // start click must never turn into a pause of that newer operation.
        if (normalizedRunning() && !normalizedPaused()) return;
        action = normalizedPaused() || state.paused ? 'resume' : 'start';
      }
      await command(action, action !== 'pause' && expectedIntentGeneration !== null ? { expectedIntentGeneration } : {});
      if (bridge?.getState) receiveState(await bridge.getState());
    } catch (error) { showOperationError(error, action); }
    finally { busy = false; renderFooter(); }
  });
  $('expand-button').addEventListener('click', async () => {
    const previous = expanded;
    setExpanded(!previous);
    try { await command('expand', { expanded }); }
    catch (error) { setExpanded(previous); showToast(error.message, true); }
  });
  $('hide-panel').addEventListener('click', () => requestPanelVisibility(true));
  $('restore-panel').addEventListener('click', () => requestPanelVisibility(false));
  function setLogActionBusy(value, action) {
    logActionBusy = value;
    $('open-logs').disabled = value;
    $('clear-logs').disabled = value;
    $('open-logs').setAttribute('aria-busy', String(value && action === 'open'));
    $('clear-logs').setAttribute('aria-busy', String(value && action === 'clear'));
    setText('open-logs-label', value && action === 'open' ? '打开中…' : '打开日志');
    setText('clear-logs-label', value && action === 'clear' ? '清空中…' : '清空日志');
  }
  $('open-logs').addEventListener('click', async () => {
    if (logActionBusy) return;
    setLogActionBusy(true, 'open');
    try { await command('openLogs'); }
    catch (error) { showToast(error.message, true); }
    finally { setLogActionBusy(false); }
  });
  $('clear-logs').addEventListener('click', async () => {
    if (logActionBusy) return;
    setLogActionBusy(true, 'clear');
    try {
      await command('clearLogs');
      logsWereCleared = true; logPage=null;logPageRequestedKey='';logPageFailedKey='';
      logSignature = '';
      // Only the log array changes locally. Gameplay, account and session totals
      // stay as they are while the native host returns its fresh state.
      $('recent-feed').replaceChildren();
      receiveState({ logs: [] });
      renderLogs(true);
      if (bridge?.getState) {
        try { receiveState(await bridge.getState()); }
        catch { showToast('日志已清空，状态会在连接恢复后同步。'); return; }
      }
      renderLogs(true);
      showToast('日志已清空，挂机和收益统计保留。');
    } catch (error) { showToast(error.message, true); }
    finally { setLogActionBusy(false); }
  });
  $('open-data').addEventListener('click', async () => { try { await command('openData'); } catch (error) { showToast(error.message, true); } });
  $('login-button').addEventListener('click', async () => { try { await command('login'); } catch (error) { showToast(error.message, true); } });
  let clientUpdatesBusy=false;
  $('manual-interfaces').addEventListener('click',()=>openCompatibilityEditor('interfaces'));
  $('manual-other-config').addEventListener('click',()=>openCompatibilityEditor('other'));
  $('compatibility-close').addEventListener('click',()=>$('compatibility-editor').close());
  $('compatibility-editor').addEventListener('close',()=>{compatibilityEpoch++;compatibilityBusy=false;compatibilityDrafts.clear();compatibilityInvalid.clear();compatibilityView=null;});
  $('compatibility-switch-interfaces').addEventListener('click',()=>{if(!compatibilityBusy&&compatibilityKind!=='interfaces')openCompatibilityEditor('interfaces');});
  $('compatibility-switch-other').addEventListener('click',()=>{if(!compatibilityBusy&&compatibilityKind!=='other')openCompatibilityEditor('other');});
  $('compatibility-search').addEventListener('input',renderCompatibilityEditor);
  $('compatibility-only-issues').addEventListener('change',renderCompatibilityEditor);
  $('compatibility-refresh').addEventListener('click',()=>compatibilityOperation('readCompatibility',{},'状态已重新读取；尚未应用的输入仍保留。'));
  $('compatibility-probe-all').addEventListener('click',()=>compatibilityOperation('probeCompatibility',{},'本页项目已重新获取并核验；请检查各项状态。'));
  $('compatibility-apply-all').addEventListener('click',()=>{try {const patch=collectCompatibilityPatch();if(!Object.keys(patch).length){setCompatibilityMessage('没有尚未应用的修改。');return;}compatibilityOperation('applyCompatibility',{patch},'本页修改已保存；以各项实际生效值为准。');}catch(error){setCompatibilityMessage(error.message,true);}});
  $('compatibility-reset').addEventListener('click',()=>compatibilityOperation('resetCompatibility',{},'本页已恢复自动配置；请查看最新状态。'));
  $('compatibility-copy-prompt').addEventListener('click',copyCompatibilityPrompt);
  $('compatibility-export').addEventListener('click',async()=>{
    if(compatibilityBusy)return;const epoch=compatibilityEpoch;setCompatibilityBusy(true);
    try {const response=await command('exportCompatibility',compatibilityPayload()),value=response?.config??response?.compatibility?.config??response?.json??response?.text;
      if(epoch!==compatibilityEpoch)return;if(value===undefined)throw new Error('未取得可导出的配置。');
      const text=typeof value==='string'?value:JSON.stringify(value,null,2);$('compatibility-json').value=text;setCompatibilityMessage('已导出全部已保存的兼容配置，包含接口和其他配置；可以复制留作备份。未应用的输入不在此备份中。');
    }catch(error){if(epoch===compatibilityEpoch)setCompatibilityMessage(error.message,true);}finally{if(epoch===compatibilityEpoch)setCompatibilityBusy(false);}
  });
  $('compatibility-import').addEventListener('click',()=>{
    try {const config=JSON.parse($('compatibility-json').value);if(!config||typeof config!=='object'||Array.isArray(config))throw new Error('请粘贴完整的配置 JSON 对象。');compatibilityOperation('importCompatibility',{config},'兼容配置已导入，包含接口和其他配置；请分别核对状态和实际生效值。');}
    catch(error){setCompatibilityMessage(error instanceof SyntaxError?'JSON 格式错误；请不要包含代码围栏或多余说明。':error.message,true);}
  });
  $('compatibility-official-link').addEventListener('click',async event=>{event.preventDefault();try{await command('openLink',{url:'https://pokebonk.com/'});}catch(error){setCompatibilityMessage(error.message,true);}});
  $('get-client-updates').addEventListener('click',async()=>{
    if(clientUpdatesBusy)return;clientUpdatesBusy=true;$('get-client-updates').disabled=true;
    try{await command('showClientUpdates');}catch(error){showToast(error.message||'更新地址暂未打开，请稍后重试。',true);}
    finally{clientUpdatesBusy=false;$('get-client-updates').disabled=false;}
  });
  $('show-changelog').addEventListener('click', async () => {
    if (changelogBusy) return;
    changelogBusy = true; $('show-changelog').disabled = true;
    try { await command('showChangelog'); }
    catch (error) { showToast(error.message, true); }
    finally { changelogBusy = false; $('show-changelog').disabled = false; }
  });
  $('optimize-browser').addEventListener('click', openBrowserOptimization);
  for (const id of ['browser-optimization-close','browser-optimization-decline']) $(id).addEventListener('click', () => $('browser-optimization-dialog').close());
  $('browser-optimization-accept').addEventListener('click', async () => {
    if (browserOptimizationBusy || !browserOptimizationCanApply()) return;
    setBrowserOptimizationBusy(true);
    try { renderBrowserOptimization(await command('applyBrowserOptimization', { confirmed: true }), true); }
    catch (error) { setText('browser-optimization-result', error.message || '优化未完成，请重试。'); $('browser-optimization-result').classList.add('error'); }
    finally { setBrowserOptimizationBusy(false); }
  });
  $('download-prerequisites').addEventListener('click', installPrerequisites);
  $('show-prerequisite-license').addEventListener('click', async () => { try { await command('showPrerequisiteLicense'); } catch (error) { showToast(error.message, true); } });
  $('restore-defaults').addEventListener('click', () => { previewCharacterId = null; hotkeyDraft = null; hotkeyDraftRevision++; delayRangeDirty = false; $('random-delay-error').hidden = true; for (const id of ['random-delay-min','random-delay-max']) $(id).setAttribute('aria-invalid', 'false'); saveConfig({ ...DEFAULT_CONFIG }); });
  $('save-hotkeys').addEventListener('click', async () => {
    if (!hotkeyDraft || !validateHotkeys()) return;
    const patch = { ...hotkeyDraft }, revision = hotkeyDraftRevision; $('save-hotkeys').disabled = true;
    if (await saveConfig(patch)) {
      if (revision === hotkeyDraftRevision) hotkeyDraft = null;
      renderHotkeys(); showToast(revision === hotkeyDraftRevision ? '快捷键已保存，立即生效。' : '较早的快捷键已保存，当前新修改尚未保存。');
    } else validateHotkeys();
  });
  $('reset-hotkeys').addEventListener('click', async () => {
    const patch = Object.fromEntries(HOTKEY_FIELDS.map(([key]) => [key, DEFAULT_CONFIG[key]]));
    hotkeyDraft = null; hotkeyDraftRevision++;
    const revision = hotkeyDraftRevision;
    if (await saveConfig(patch)) { renderHotkeys(); showToast(revision === hotkeyDraftRevision ? '默认快捷键已恢复。' : '默认快捷键已保存，当前新修改尚未保存。'); }
  });
  $('release-mouse').addEventListener('click', async () => { try { await command('releaseMouse'); showToast('鼠标已释放，当前运行状态保持。'); } catch (error) { showToast(error.message, true); } });
  document.querySelectorAll('[data-plan-section]').forEach((button) => button.addEventListener('click', () => showPlanSection(button.dataset.planSection)));
  for (const id of ['plan-name', 'plan-description', 'plan-priority', 'plan-enabled', 'plan-auto-select', 'plan-species', 'plan-biome', 'plan-tier', 'plan-mode']) $(id).addEventListener('input', () => { if (planDraft) { planDraft = collectPlan(); setPlanDirty(); } });
  for (const group of Object.keys(RULE_GROUPS)) $(`plan-${group}-search`).addEventListener('input', () => renderRuleResults(group));
  $('plan-search').addEventListener('input', renderPlanLibrary);
  $('plan-new').addEventListener('click', () => { if (!planBusy) { setPlanDraft(); showPlanSection('basics'); $('plan-name').focus(); $('plan-name').select(); } });
  $('plan-save').addEventListener('click', savePlan);
  $('plan-duplicate').addEventListener('click', async () => { if (planBusy) return; const copy = collectPlan(); copy.id = null; copy.name = `${copy.name || '方案'} · 副本`; setPlanDraft(copy); setPlanDirty(); await savePlan(); });
  $('plan-delete').addEventListener('click', async () => { if (planBusy || !planDraft?.id) return; const id = planDraft.id; setPlanBusy(true); try { const response = await command('deleteCustomPlan', { id }); await acceptPlanResponse(response); setPlanDraft(); showToast('方案已删除，正在进行的对局保持不变。'); } catch (error) { showToast(error.message, true); } finally { setPlanBusy(false); } });
  $('plans-import').addEventListener('click', importPlanFile);
  $('plans-export').addEventListener('click', () => exportPlanFile(false));
  $('plans-import-file').addEventListener('click', importPlanFile);
  $('plans-export-file-all').addEventListener('click', () => exportPlanFile(false));
  $('plan-export-current').addEventListener('click', () => exportPlanFile(true));
  $('plan-export-one').addEventListener('click', () => exportPlans(true));
  $('plans-import-json').addEventListener('click', importPlans);
  $('plans-copy-json').addEventListener('click', async () => { const text = $('plans-json').value; if (!text.trim()) { showToast('先导出方案或粘贴 JSON。', true); return; } try { await command('copyText', { text }); showToast('方案 JSON 已复制。'); } catch (error) { showToast(error.message, true); } });
  $('expand-plans').addEventListener('click', async () => { setExpanded(true); try { await command('expand', { expanded: true }); } catch (error) { showToast(error.message, true); } });
  $('encyclopedia-search').addEventListener('input', () => { encyclopediaPage = 0; encyclopediaSelection = null; renderEncyclopedia(); });
  $('encyclopedia-category').addEventListener('change', () => { encyclopediaPage = 0; encyclopediaSelection = null; renderEncyclopedia(); });
  $('encyclopedia-prev').addEventListener('click', () => { encyclopediaPage--; encyclopediaSelection = null; renderEncyclopedia(); });
  $('encyclopedia-next').addEventListener('click', () => { encyclopediaPage++; encyclopediaSelection = null; renderEncyclopedia(); });
  $('expand-encyclopedia').addEventListener('click', async () => {
    const previous = expanded; setExpanded(true); $('expand-encyclopedia').disabled = true;
    try { await command('expand', { expanded: true, encyclopedia: true }); }
    catch (error) { setExpanded(previous); showToast(error.message, true); }
    finally { $('expand-encyclopedia').disabled = false; }
  });
  $('copy-update-prompt').addEventListener('click', async () => { if (maintenanceBusy || !$('update-prompt').value) return; try { await command('copyText', { text: $('update-prompt').value }); showToast('完整提示词已复制，可交给 AI 继续维护。'); } catch (error) { showToast(error.message, true); } });

  $('check-updates').addEventListener('click', async () => { if (maintenanceBusy) return; setMaintenanceBusy(true); try { const response = await command('checkUpdates'); if (response?.updateStatus) receiveState({ updateStatus: response.updateStatus }); else if (response?.state && typeof response.state === 'string') receiveState({ updateStatus: response }); if (bridge?.getState) receiveState(await bridge.getState()); await refreshCatalog(); renderMaintenance(); showToast('本次更新与功能检测已完成，请查看结果。'); } catch (error) { showOperationError(error, 'checkUpdates'); } finally { setMaintenanceBusy(false); } });
  $('copy-connection-diagnostics').addEventListener('click', async () => {
    try { await command('copyText', { text: JSON.stringify(connectionDiagnostics(), null, 2) }); showToast('已复制接入诊断，不含账号、密码或存档。'); }
    catch { showToast('复制未完成，请稍后重试。', true); }
  });
  $('skin-refresh').addEventListener('click', refreshSkins);
  $('skin-import').addEventListener('click', () => skinMutation('importSkin', {}, '请选择 PNG 动作图集或皮肤文件，优先使用透明背景，正在等待导入…', response => response.duplicate ? '这个皮肤已经在列表中，已为你选中预览。' : '皮肤已导入。请检查背景清理、角色是否完整及四种动作，再点击“使用此皮肤”。', 'imported'));
  $('skin-native').addEventListener('click', () => skinMutation('selectSkin', { id: null }, '正在恢复游戏原形象…', '已恢复游戏原形象，皮肤文件仍保留在列表中。'));
  $('skin-use').addEventListener('click', () => {
    const entry = previewSkin();
    if (entry) skinMutation('selectSkin', { id: entry.id }, '正在选择并检查皮肤…', response => {
      const runtime = response?.runtime || response?.state?.runtime || skinRuntime;
      if (runtime?.phase === 'active' && runtime.skinId === entry.id) return `已将“${entry.name}”应用到当前角色。`;
      if (['unsupported', 'error', 'failed'].includes(runtime?.phase)) return `当前保持游戏原形象。${runtime.reason || '当前游戏画面暂不支持应用此皮肤，请等待接口恢复。'}`;
      return `已选择“${entry.name}”，当前尚未应用。${runtime?.reason || '进入可用的游戏对局后自动应用。'}`;
    });
  });
  $('skin-restore-builtin').addEventListener('click', () => skinMutation('restoreBuiltinSkins', {}, '正在恢复内置皮肤…', '内置皮肤已恢复到列表，当前角色形象保持不变。'));
  $('skin-name').addEventListener('input', () => {
    skinNameDirty = $('skin-name').value !== (previewSkin()?.name || '');
    $('skin-name-error').hidden = true; $('skin-name').setAttribute('aria-invalid', 'false'); renderSkinControls();
  });
  $('skin-name').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); $('skin-rename').click(); } });
  $('skin-rename').addEventListener('click', async () => {
    const entry = previewSkin(), name = $('skin-name').value.trim(); if (!entry || skinsBusy) return;
    if (!name || name.length > 40 || /[\u0000-\u001f\u007f]/.test(name)) { setText('skin-name-error', '请输入 1–40 个字符的名称，不含换行或控制字符。'); $('skin-name-error').hidden = false; $('skin-name').setAttribute('aria-invalid', 'true'); $('skin-name').focus(); return; }
    const response = await skinMutation('renameSkin', { id: entry.id, name }, '正在保存皮肤名称…', '皮肤名称已保存。');
    if (response) { skinNameDirty = false; $('skin-name-error').hidden = true; renderSkins(); }
  });
  $('skin-export').addEventListener('click', () => {
    const entry = previewSkin(); if (!entry) return;
    skinMutation('exportSkin', { id: entry.id, format: $('skin-export-format').value === 'png' ? 'png' : 'package' }, '请选择皮肤导出的保存位置…', response => `已导出${response.fileName ? `：${response.fileName}` : '皮肤文件'}。`);
  });
  $('skin-delete').addEventListener('click', () => {
    const entry = previewSkin(); if (!entry || skinsBusy) return;
    skinDeleteId = entry.id; setText('skin-delete-message', `将从本机列表中删除“${entry.name}”。${entry.builtin ? '这是内置皮肤，之后可点击“恢复内置皮肤”找回。' : ''}`); $('skin-delete-dialog').showModal();
  });
  $('skin-delete-cancel').addEventListener('click', () => { skinDeleteId = null; $('skin-delete-dialog').close(); });
  $('skin-delete-dialog').addEventListener('close', () => { skinDeleteId = null; });
  $('skin-delete-confirm').addEventListener('click', () => {
    const id = skinDeleteId; if (!id || skinsBusy) return;
    $('skin-delete-dialog').close(); skinNameDirty = false;
    skinMutation('deleteSkin', { id }, '正在删除皮肤…', '皮肤已删除。若之前正在使用它，已恢复游戏原形象。');
  });
  $('skin-preview-action').addEventListener('change', () => { skinPreviewFrame = 0; drawSkinPreview(); });
  $('skin-preview-mirror').addEventListener('change', drawSkinPreview);
  $('skin-preview-play').addEventListener('click', () => {
    if (skinPreviewTimer) { stopSkinPreview(); return; }
    if (!skinPreviewImage || panelHidden || activeTab !== 'skins' || document.hidden) return;
    $('skin-preview-play').setAttribute('aria-pressed', 'true'); setText('skin-preview-play', '暂停预览');
    skinPreviewTimer = setInterval(() => { if (panelHidden || activeTab !== 'skins' || document.hidden) { stopSkinPreview(); return; } skinPreviewFrame = (skinPreviewFrame + 1) % 4; drawSkinPreview(); }, 150);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopSkinPreview(); });
  $('skin-copy-prompt').addEventListener('click', async () => {
    if (skinsBusy) return; setSkinBusy(true); skinStatus('正在获取并复制完整提示词…');
    try { const text = await obtainSkinPrompt(); await command('copyText', { text }); skinStatus('提示词已复制。把照片和这段完整文字一起发给支持图片生成的 AI，优先下载真实透明背景的 PNG 原图导入；请在进入战斗前管理皮肤，导入后先检查预览。'); showToast('皮肤生成提示词已复制。'); }
    catch (error) { $('skin-prompt-details').open = true; skinStatus(`${error.message} 可在下方提示词框内手动选中复制。`, true); }
    finally { setSkinBusy(false); }
  });
  $('skin-save-prompt').addEventListener('click', async () => {
    if (skinsBusy) return;
    await skinMutation('saveSkinPrompt', {}, '请选择提示词文本的保存位置…', '完整皮肤生成提示词已保存为文本，可和参考照片一起交给 AI。');
  });
  $('skin-prompt-details').addEventListener('toggle', async () => {
    if (!$('skin-prompt-details').open || skinPromptText || skinsBusy) return;
    try { await obtainSkinPrompt(); } catch (error) { skinStatus(error.message, true); }
  });
  buildSettings();
  buildOverlaySettings();
  buildConvenienceSettings();
  buildMaintenanceKinds();
  renderModes();
  renderCharacters(true);
  renderConfig();
  renderFooter();
  renderPrerequisites();

  async function connect() {
    bridge = window.desktop || null;
    if (!bridge || typeof bridge.getState !== 'function') { renderFooter(); renderPrerequisites(); return false; }
    try {
      // Subscribe before the first requests: native navigation can complete
      // while an RPC is pending. Those state pushes must not be discarded.
      if(subscribedBridge!==bridge) {
        subscriptionCleanups.splice(0).forEach(cleanup=>{try{cleanup();}catch{}});
        if (typeof bridge.onState === 'function') { const cleanup=bridge.onState(receiveState);if(typeof cleanup==='function')subscriptionCleanups.push(cleanup); }
        if (typeof bridge.onLog === 'function') { const cleanup=bridge.onLog(receiveLog);if(typeof cleanup==='function')subscriptionCleanups.push(cleanup); }
        subscribedBridge=bridge;
      }
      const initialCatalog=typeof bridge.getCatalog === 'function' ? (async()=>{
        catalogRefreshPending=true;
        renderClientStage();
        try{return await bridge.getCatalog();}finally{catalogRefreshPending=false;renderClientStage();}
      })() : Promise.resolve(null);
      const initialState = bridge.getState().then(value => { if (value) receiveState(value); return value; });
      const results = await Promise.allSettled([initialState, initialCatalog]);
      if (results[1].status === 'fulfilled' && results[1].value) receiveCatalog(results[1].value);
      else retryCatalogSync();
      if (results[0].status !== 'fulfilled' || !results[0].value) retryStateSync();
      if(catalogRefreshQueued){catalogRefreshQueued=false;if(!catalogLoaded)retryCatalogSync();}
      renderFooter();
      renderPrerequisites();
      if (activeTab === 'skins' && !skinsLoaded && !skinsBusy) refreshSkins();
      if (!state.prerequisites) refreshPrerequisites().catch((error) => { receiveState({ prerequisites: { status: 'failed', message: `前置检测未完成：${error.message}` } }); });
      return true;
    } catch (error) { showToast(error.message || '客户端连接失败。', true); return false; }
  }
  let attempts = 0;
  async function tryConnect() {
    const connected = await connect();
    if (!connected && attempts++ < 30) setTimeout(tryConnect, 500);
  }
  tryConnect();
  const clockTimer = setInterval(() => { if (panelHidden) return; setText('session-duration', durationText(sessionSeconds())); if (activeTab === 'logs') setText('log-summary', logSummaryText()); }, 1000);
  window.addEventListener('beforeunload', () => { compatibilityEpoch++;compatibilityDrafts.clear();compatibilityInvalid.clear();closeWecomView();disposing=true;stopSkinPreview();cancelPendingSkinPreview();skinPreviewRequest++;clearTimeout(catalogRetryTimer);clearTimeout(stateRetryTimer);clearInterval(clockTimer); subscriptionCleanups.forEach((cleanup) => { try { cleanup(); } catch {} }); });
  // Native-host adapters and UI verification can push the same public state shape.
  window.__PB_UI = Object.freeze({ receiveState, receiveCatalog, receiveLog, showTab });
})();
