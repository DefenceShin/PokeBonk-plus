import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
// Historical arbitrary-endpoint fixture below is retained for provenance.
throw new Error('HISTORICAL_LIVE_HARNESS_DISABLED_018: Historical endless smoke is source-only and disabled for every client/account. No flag authorizes its old finish/close cleanup; current validation preserves active runs until native ending/death and confirmed save.');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const pages = browser.contexts()[0].pages();
const game = pages.find(p=>p.url().startsWith('https://pokebonk.com/'));
const panel = pages.find(p=>p.url().startsWith('https://pilot.local/'));
const run = await game.evaluate(()=>({endless:!!__PB_PILOT.run?.endless,...__PB_PILOT.snapshot()}));
assert.ok(run.endless && run.time >= 45 && run.kills >= 10, 'native client plays an actual survival session');
await game.evaluate(async()=>await __PB_BRIDGE.app.run.finish(false,true));
let state;
for(let i=0;i<40;i++) {
  state=await panel.evaluate(()=>desktop.getState());
  if(state.game.events.some(e=>e.kind==='settlement'&&e.saved&&e.kills>=10)&&state.logs.some(l=>l.type==='result'&&l.message.includes('已保存'))) break;
  await new Promise(resolve=>setTimeout(resolve,500));
}
const result=state.game.events.filter(e=>e.kind==='settlement'&&e.saved&&e.kills>=10).at(-1);
assert.ok(result,'survival result confirmed by normal game server response');
assert.equal(run.errors.length,0);
assert.ok(state.session.stardustEarned>=result.stardust, 'reward counter includes actual settled stars');
await writeFile('artifacts/client/endless-validation.json',JSON.stringify({passed:true,run,result,session:state.session,limits:'Early survival gameplay only; no full survival milestones or migration validated.'},null,2));
console.log(JSON.stringify({passed:true,time:run.time,kills:run.kills,stardust:result.stardust,loggedIncome:state.session.stardustEarned,p95:run.p95DecisionMs}));
await browser.close();
