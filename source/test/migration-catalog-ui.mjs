import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
const out='../catalog-ui';await fs.mkdir(out,{recursive:true});
const catalog=JSON.parse(await fs.readFile('data/catalog.json','utf8'));
assert.equal(catalog.characters.length,79);
assert(catalog.characters.every(c=>c.learnableFusions?.length>0));
const character=catalog.characters.find(c=>c.id===1),fusion=character.learnableFusions[0];
const browser=await chromium.launch({headless:true,executablePath:process.env.PB_TEST_BROWSER});
const page=await browser.newPage({viewport:{width:1280,height:900},recordVideo:{dir:out,size:{width:1280,height:900}}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const files=Object.fromEntries(await Promise.all(['index.html','app.js','styles.css','product-source.js'].map(async n=>[n,await fs.readFile('client/ui/'+n,'utf8')])));
await page.route('**/*',route=>{const u=new URL(route.request().url()),n=u.pathname==='/'?'index.html':u.pathname.slice(1);return u.hostname==='catalog.test'&&files[n]?route.fulfill({body:files[n],contentType:n.endsWith('.js')?'application/javascript':n.endsWith('.css')?'text/css':'text/html'}):route.abort();});
await page.addInitScript(({character,maps,modes})=>{
 window.__state={running:false,game:{state:'menu'},session:{},logs:[],profile:{league:[1]},connection:{stage:'ready'},config:{mode:'tower',characterId:1,modeSettings:{tower:{}}}};
 window.__calls=[];window.desktop={getState:async()=>window.__state,getCatalog:async()=>({characters:[character],maps,modes,builds:[]}),onState(){return()=>{};},onLog(){return()=>{};},command:async(action,payload)=>{window.__calls.push({action,payload});if(action==='config')Object.assign(window.__state.config,payload);return {ok:true,state:window.__state};}};
},{character,maps:catalog.maps,modes:catalog.modes});
try{
 await page.goto('http://catalog.test/');await page.locator('#tab-characters').click();
 await page.locator('.character-card:not(.automatic-card)').first().click();
 await page.locator('#final-moves-enabled').check();
 const input=page.locator('[data-replacement-kind="moves"] input[role="combobox"]').first();
 await input.fill(fusion.key);await input.press('ArrowDown');
 const choice=page.locator('[data-replacement-kind="moves"] .replacement-option').filter({hasText:fusion.key}).first();
 await choice.waitFor();await page.screenshot({path:out+'/fusion-list.png'});await choice.click();
 assert(await page.evaluate(key=>window.__calls.some(c=>c.action==='config'&&JSON.stringify(c.payload).includes(key)),fusion.key));
 await page.locator('#final-stage-map').selectOption('default');assert.equal(await page.locator('#final-stage-number').isEnabled(),true);
 assert.deepEqual(errors,[]);
 await fs.writeFile(out+'/report.json',JSON.stringify({passed:3,characters:79,allHaveFusions:true,selectedFusion:fusion.key,checks:['offline fusion option visible and saved','stage editor enabled','all 79 offline characters retain fusion catalog'],isolatedHost:true,liveGame:false},null,2));
 console.log('PASS 3 catalog/UI checks; 79 characters have fusion lists');
}finally{await page.close();await browser.close();}
