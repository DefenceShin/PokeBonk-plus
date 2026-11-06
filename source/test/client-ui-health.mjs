// Isolated UI regression: mocked host only, no game, profile, account or network.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'artifacts', 'ui-health', new Date().toISOString().replace(/[:.]/g, '-'));
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 620 } });
const checks = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('https://**/*', route => route.abort());
await page.addInitScript(() => {
  const catalog = { characters: [{id:1,name:'目录角色',unlocked:true}], maps: [{id:'forest',name:'翠绿森林'},{id:'desert',name:'灼热沙漠'}], builds:[], modes:[], difficulties:[{id:0,name:'普通'},{id:1,name:'困难'}] };
  window.__calls = [];
  window.__state = { running:false, paused:false, profile:{league:[1]}, game:{state:'over',accountType:'guest'}, config:{mode:'characters',modeSettings:{characters:{biome:'forest',tier:0}}}, logs:[], session:{}, connection:{stage:'ready',nativeBoot:{phase:'ready'}} };
  window.__startMode = 'normal';
  window.__optimization = {profileScope:'仅修改本客户端的WebView2独立环境，不修改Edge或Chrome全局设置。',changes:[
    {id:'normal-memory',label:'保持正常内存目标',description:'活动游戏不使用省内存目标。',supported:true,current:'低内存',requested:'正常'},
    {id:'shader-disk-cache',label:'启用着色器磁盘缓存',description:'在客户端目录保留可复用缓存；不保证提高帧率。',supported:true,current:false,requested:true},
    {id:'hardware',label:'硬件加速由驱动决定',description:'仅诊断，不强制修改。',supported:false}], diagnostics:{runtimeVersion:'test-runtime',gpuSummary:'驱动默认'},needsReload:true,activeRun:true,message:'需下次启动生效。'};
  window.__push = patch => { window.__state={...window.__state,...patch};window.__listener?.(structuredClone(window.__state)); };
  window.desktop = {
    getState:async()=>structuredClone(window.__state),
    getCatalog:()=>new Promise(resolve=>{window.__resolveCatalog=()=>resolve(structuredClone(catalog));}),
    onState:listener=>{window.__listener=listener;return()=>{};}, onLog:listener=>{window.__logListener=listener;return()=>{};},
    command:async(action,payload={})=>{
      window.__calls.push({action,payload});
      if(action==='readBrowserOptimization') return structuredClone(window.__optimization);
      if(action==='applyBrowserOptimization') return {...structuredClone(window.__optimization),enabled:true,message:'优化已保存。'};
      if(action==='start') {
        if(window.__startMode==='late-success') { window.__push({running:true,game:{state:'play',accountType:'guest'}}); throw Error('客户端响应超时，请重试'); }
        if(window.__startMode==='loading') { window.__push({connection:{stage:'prepare',nativeBoot:{phase:'loading',stage:'data-loading'}}}); throw Error('客户端响应超时，请重试'); }
        if(window.__startMode==='hard-failure') throw Error('明确的接口不兼容错误');
      }
      return {ok:true,state:structuredClone(window.__state)};
    },
  };
});
const push = patch=>page.evaluate(patch=>window.__push(patch),patch);
const check = async(name, run)=>{await run();checks.push(name);};
try {
  await page.goto(pathToFileURL(path.join(root,'client/ui/index.html')).href);
  await check('catalog-pending-stage-is-visible-before-initial-all-settled',async()=>{
    await page.waitForFunction(()=>typeof window.__resolveCatalog==='function');
    await page.waitForFunction(()=>document.getElementById('client-stage-label').textContent.includes('目录'));
    await page.evaluate(()=>window.__resolveCatalog());
    await page.waitForFunction(()=>document.getElementById('client-stage-label').textContent==='就绪');
  });
  await check('performance-uses-only-measured-fields-not-configured-cap',async()=>{
    await push({config:{fps:144},game:{state:'over',accountType:'guest'}});
    assert.equal(await page.locator('#client-performance').isVisible(),false);
    await push({game:{state:'play',accountType:'guest',performance:{fps:57.6,pingMs:82}}});
    assert.match(await page.locator('#client-performance').innerText(),/58 FPS.*82 ms/);
    await push({game:{state:'play',accountType:'guest',gameFps:61.2}});
    assert.match(await page.locator('#client-performance').innerText(),/原生 61 FPS/);
    assert.match(await page.locator('#client-stage').getAttribute('title'),/原生更新计数估算/);
  });
  await check('loading-and-recovery-phases-replace-ready-status',async()=>{
    await push({connection:{stage:'prepare',nativeBoot:{phase:'loading',stage:'auth-loading'}}});
    assert.match(await page.locator('#client-stage-label').innerText(),/存档/);
    await push({recovery:{wantedRun:true,phase:'reloading',requiresLogin:false}});
    assert.match(await page.locator('#client-stage-label').innerText(),/恢复/);
    await push({recovery:null,connection:{stage:'ready',nativeBoot:{phase:'ready'}},game:{state:'over',accountType:'guest'}});
  });
  await check('optimization-sits-left-of-changelog-and-requires-explicit-agreement',async()=>{
    assert.equal(await page.locator('#show-changelog').evaluate(node=>node.previousElementSibling.id),'optimize-browser');
    await page.locator('#optimize-browser').click();
    await page.locator('.browser-optimization-change').first().waitFor();
    assert.equal(await page.locator('.browser-optimization-change').count(),3);
    assert.match(await page.locator('#browser-optimization-scope').innerText(),/不修改Edge或Chrome/);
    assert.match(await page.locator('.browser-optimization-change.unsupported').innerText(),/不会应用/);
    await page.locator('#browser-optimization-decline').click();
    assert.equal(await page.evaluate(()=>__calls.filter(call=>call.action==='applyBrowserOptimization').length),0);
    await page.locator('#optimize-browser').click();
    await page.locator('#browser-optimization-accept:not([disabled])').waitFor();
    await page.locator('#browser-optimization-accept').click();
    await page.waitForFunction(()=>__calls.some(call=>call.action==='applyBrowserOptimization'));
    assert.deepEqual(await page.evaluate(()=>__calls.find(call=>call.action==='applyBrowserOptimization').payload),{confirmed:true});
    assert.match(await page.locator('#browser-optimization-result').innerText(),/当前对局不会自动刷新/);
    await page.locator('#browser-optimization-close').click();
  });
  await check('late-success-does-not-display-timeout-failure-or-repeat-start',async()=>{
    await page.evaluate(()=>{window.__startMode='late-success';window.__push({running:false,paused:false,game:{state:'over',accountType:'guest'}});});
    await page.locator('#main-action').click(); await page.waitForTimeout(80);
    assert.equal(await page.locator('#toast.error:visible').count(),0);
    assert.equal(await page.evaluate(()=>__calls.filter(call=>call.action==='start').length),1);
    assert.match(await page.locator('#client-stage-label').innerText(),/挂机中/);
  });
  await check('long-loading-timeout-waits-for-state-without-reissuing-command',async()=>{
    await page.evaluate(()=>{window.__startMode='loading';window.__push({running:false,paused:false,game:{state:'over',accountType:'guest'}});});
    await page.locator('#main-action').click(); await page.waitForTimeout(80);
    assert.equal(await page.locator('#toast.error:visible').count(),0);
    assert.match(await page.locator('#client-stage-label').innerText(),/加载|同步/);
    await push({running:true,connection:{stage:'ready',nativeBoot:{phase:'ready'}},game:{state:'play',accountType:'guest'}});
    assert.match(await page.locator('#client-stage-label').innerText(),/挂机中/);
    assert.equal(await page.evaluate(()=>__calls.filter(call=>call.action==='start').length),2);
  });
  await check('genuine-operation-error-remains-visible',async()=>{
    await page.evaluate(()=>{window.__startMode='hard-failure';window.__push({running:false,paused:false,game:{state:'over',accountType:'guest'}});});
    await page.locator('#main-action').click();
    assert.match(await page.locator('#toast.error').innerText(),/明确的接口不兼容/);
  });
  await check('concise-logs-retain-results-unlocks-recovery-and-errors',async()=>{
    const at='2026-10-22T00:00:00Z';
    await push({logs:[
      {id:'1',type:'choice',title:'已选择强化',at},{id:'2',type:'reward',title:'本局获得道具',at},
      {id:'3',type:'reward',title:'获得星尘',detail:'+1',at},{id:'4',type:'info',title:'挂机设置已保存',at},
      {id:'5',type:'run',title:'开始第1局',detail:'翠绿森林 · 普通 · 目录角色',at},
      {id:'6',type:'result',title:'本局结束并已保存',detail:'星尘+12',at},
      {id:'7',type:'reward',title:'新角色已加入联盟',detail:'目录角色',at},
      {id:'8',type:'info',title:'前局补存成功',at},{id:'9',type:'error',title:'网络异常',at},
      {id:'10',type:'info',title:'浏览器优化已保存',at},{id:'11',type:'info',title:'接口已重新接入',at}]});
    await page.locator('#tab-logs').click();
    assert.equal(await page.locator('#log-rows tr').count(),7);
    assert.doesNotMatch(await page.locator('#log-rows').innerText(),/已选择强化|获得星尘|设置已保存|本局获得道具/);
    assert.match(await page.locator('#log-rows').innerText(),/翠绿森林.*普通.*目录角色/);
  });
  await check('explicit-route-conflict-is-visible-without-changing-selectors',async()=>{
    await push({config:{mode:'characters',modeSettings:{characters:{biome:'forest',tier:0}}},running:true,game:{state:'play',biome:'forest',tier:0,accountType:'guest',plan:{biome:'forest',tier:0,modePreference:{mode:'characters'}},unlockProgress:{mode:'characters',status:'waiting',message:'当前目标等待符合条件的路线',constraintConflict:{requested:{biome:'forest',tier:0},required:{biome:'desert',tier:1},reason:'按指定地图刷资源，不把普通森林当作困难沙漠条件。'}}}});
    await page.locator('#tab-modes').click();
    assert.equal(await page.locator('#biome-select').inputValue(),'forest');
    assert.equal(await page.locator('#tier-select').inputValue(),'0');
    assert.match(await page.locator('#mode-route-conflict').innerText(),/翠绿森林.*普通.*灼热沙漠.*困难/);
    await page.locator('#tab-overview').click();
    assert.match(await page.locator('#unlock-goal-steps').innerText(),/本次地图.*翠绿森林.*普通/s);
    assert.match(await page.locator('#unlock-goal-detail').innerText(),/不把普通森林当作困难沙漠/);
  });
  await check('small-window-controls-and-confirmation-stay-within-viewport',async()=>{
    for(const width of [880,740,620,520]) {
      await page.setViewportSize({width,height:320}); await page.waitForTimeout(50);
      const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,buttons:[...document.querySelectorAll('.control-actions button')].map(node=>{const r=node.getBoundingClientRect();return{left:r.left,right:r.right,bottom:r.bottom};})}));
      assert.ok(layout.scroll<=layout.width+1,`${width}: document overflow`);
      assert.ok(layout.buttons.every(box=>box.left>=0&&box.right<=width+1&&box.bottom<=321),`${width}: footer clipped`);
      await page.screenshot({path:path.join(output,`small-${width}.png`)});
    }
    await page.locator('#optimize-browser').click();
    const dialog=await page.locator('#browser-optimization-dialog').boundingBox();
    assert.ok(dialog.x>=0&&dialog.y>=0&&dialog.x+dialog.width<=521&&dialog.y+dialog.height<=321);
    const confirmation=await page.locator('#browser-optimization-accept').boundingBox();
    assert.ok(confirmation.y>=0&&confirmation.y+confirmation.height<=321,'confirmation buttons visible without scrolling');
    await page.screenshot({path:path.join(output,'optimization-small.png')});
    await page.locator('#browser-optimization-decline').click();
    await page.setViewportSize({width:620,height:480});
    await page.locator('#tab-settings').click();
    await page.locator('#native-controls-note').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('#setting-expertMode').count(),0);
    assert.match(await page.locator('#native-controls-note').innerText(),/不会以瞄准设置为由禁止启动/);
    await page.locator('#tab-convenience').click();await page.locator('#convenience-feature-strategy').click();
    assert.match(await page.locator('#setting-capturePriority').evaluate(node=>node.closest('label').innerText),/先处理真实弱化\/倒地.*首领和出口之前/);
    assert.match(await page.locator('#setting-capturePriority').evaluate(node=>node.closest('label').innerText),/开启时已有也抓.*普通超梦入盟后.*暂无可重复异色超梦来源.*等待新来源/);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:path.join(output,'native-controls-small.png')});
  });
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(output,'summary.json'),JSON.stringify({passed:true,checks,errors},null,2));
  console.log(JSON.stringify({passed:true,checks:checks.length,output}));
} catch(error) {
  await fs.writeFile(path.join(output,'summary.json'),JSON.stringify({passed:false,checks,errors,error:error.message},null,2));
  throw error;
} finally {await browser.close();}
