// Actual local UI in an isolated browser with a synthetic host. No game/account.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const out=path.resolve(process.argv[2]||'artifacts/0.19.0-panel-ui/final.json');
const files=Object.fromEntries(await Promise.all(['index.html','app.js','styles.css'].map(async p=>[p,await fs.readFile('client/ui/'+p,'utf8')])));
const browser=await chromium.launch({headless:true}),results=[];
await fs.mkdir(path.dirname(out),{recursive:true});
async function check(name,run,initial={}){
 const context=await browser.newContext({viewport:{width:1280,height:600}}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async r=>{const u=new URL(r.request().url()),p=u.pathname==='/'?'index.html':u.pathname.slice(1);
  if(u.hostname!=='panel-fixture.test'||!files[p])return r.abort();return r.fulfill({body:files[p],contentType:p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'text/html'});});
 await page.addInitScript(initial=>{
  window.calls=[];window.hold=false;window.rejectNext=false;window.pending=null;
  window.server={running:true,expanded:false,panelHidden:false,game:{state:'play',time:100,enabled:true},session:{},profile:{league:[1]},logs:[],config:{mode:'resources'},prerequisites:{status:'ready'},connection:{stage:'ready'},...initial};
  window.push=patch=>{window.server={...window.server,...patch};window.listener?.(structuredClone(window.server));};
  window.desktop={getState:async()=>structuredClone(window.server),getCatalog:async()=>({characters:[{id:1,name:'隔离样例'}],builds:[],modes:[],maps:[{id:'forest',name:'样例地图',live:true}]}),onState(fn){window.listener=fn;},onLog(fn){window.logListener=fn;},command:async(action,payload)=>{
   window.calls.push({action,payload});if(window.rejectNext){window.rejectNext=false;throw Error('合成布局失败');}
   if(action==='panelVisibility'&&window.hold)await new Promise(resolve=>window.pending=resolve);
   if(action==='panelVisibility')window.server.panelHidden=payload.hidden;
   if(action==='expand')window.server.expanded=payload.expanded;
   return{ok:true,state:structuredClone(window.server)};
  }};
 },initial);
 try{await page.goto('http://panel-fixture.test/');await page.waitForFunction(()=>!!window.listener);await run(page);assert.deepEqual(errors,[]);results.push({name,passed:true});}
 catch(e){results.push({name,passed:false,error:e.stack});throw e;}finally{await context.close();}
}
try{
 await check('hide-button-next-to-expand-and-only-layout-commands',async p=>{
  assert.equal(await p.locator('#hide-panel').evaluate(n=>n.previousElementSibling.id),'expand-button');
  await p.locator('#hide-panel').click();assert.equal(await p.locator('#dock').isVisible(),false);assert.equal(await p.locator('#restore-panel').isVisible(),true);
  await p.setViewportSize({width:1280,height:32});const box=await p.locator('#panel-hidden-bar').boundingBox();assert.equal(box.height,32);
  assert.equal((await p.locator('#restore-panel').boundingBox()).height,28);await p.screenshot({path:path.join(path.dirname(out),'hidden-strip.png')});
  await p.locator('#restore-panel').click();await p.setViewportSize({width:1280,height:600});assert.equal(await p.locator('#dock').isVisible(),true);
  assert.deepEqual(await p.evaluate(()=>window.calls.map(c=>c.action)),['panelVisibility','panelVisibility']);assert.equal(await p.evaluate(()=>server.game.time),100);
 });
 await check('expanded-state-survives-hide-and-restore',async p=>{
  await p.locator('#expand-button').click();assert.equal(await p.locator('#expand-button').getAttribute('aria-expanded'),'true');
  await p.locator('#hide-panel').click();await p.locator('#restore-panel').click();assert.equal(await p.locator('#expand-button').getAttribute('aria-expanded'),'true');
  assert.deepEqual(await p.evaluate(()=>calls.map(c=>c.action)),['expand','panelVisibility','panelVisibility']);
 });
 await check('state-pushes-while-hidden-do-not-rebuild-page-dom-and-restore-is-current',async p=>{
  await p.locator('#hide-panel').click();
  const mutations=await p.evaluate(async()=>{let count=0;const observer=new MutationObserver(rs=>count+=rs.length);observer.observe(document.querySelector('#pages'),{subtree:true,childList:true,attributes:true,characterData:true});
   for(let n=0;n<500;n++){push({session:{elapsedSeconds:n},game:{state:'play',time:100+n,enabled:true}});logListener?.({id:'s'+n,type:'region',title:'区域推进',at:new Date().toISOString()});}
   await Promise.resolve();observer.disconnect();return count;});assert.equal(mutations,0);
  await p.locator('#restore-panel').click();assert.equal(await p.locator('#session-duration').innerText(),'00:08:19');
 });
 await check('stale-push-during-layout-command-cannot-flash-panel-open',async p=>{
  await p.evaluate(()=>window.hold=true);await p.locator('#hide-panel').click();await p.waitForFunction(()=>!!window.pending);
  await p.evaluate(()=>push({panelHidden:false}));assert.equal(await p.locator('#dock').isVisible(),false);
  await p.evaluate(()=>{window.hold=false;window.pending();});await p.waitForFunction(()=>!document.querySelector('#restore-panel').disabled);
  assert.equal(await p.locator('#dock').isVisible(),false);await p.locator('#restore-panel').click();assert.equal(await p.locator('#dock').isVisible(),true);
 });
 await check('failed-hide-rolls-back-and-failed-restore-leaves-retry-button',async p=>{
  await p.evaluate(()=>window.rejectNext=true);await p.locator('#hide-panel').click();assert.equal(await p.locator('#dock').isVisible(),true);
  await p.locator('#hide-panel').click();await p.evaluate(()=>window.rejectNext=true);await p.locator('#restore-panel').click();assert.equal(await p.locator('#dock').isVisible(),false);assert.match(await p.locator('#panel-hidden-status').innerText(),/可再次点击恢复/);
  await p.locator('#restore-panel').click();assert.equal(await p.locator('#dock').isVisible(),true);
 });
 await check('panel-document-rebuild-restores-host-hidden-state-and-keyboard-can-reveal',async p=>{
  assert.equal(await p.locator('#dock').isVisible(),false);await p.locator('#restore-panel').focus();await p.keyboard.press('Enter');assert.equal(await p.locator('#dock').isVisible(),true);assert.equal(await p.locator('#expand-button').getAttribute('aria-expanded'),'true');
 },{panelHidden:true,expanded:true});
}finally{await browser.close();await fs.writeFile(out,JSON.stringify({passed:results.every(r=>r.passed),syntheticOnly:true,noGameAccountOrNetwork:true,sourceSha256:Object.fromEntries(Object.entries(files).map(([p,s])=>[p,createHash('sha256').update(s).digest('hex')])),results},null,2));}
console.log(JSON.stringify({passed:true,tests:results.length,out}));
