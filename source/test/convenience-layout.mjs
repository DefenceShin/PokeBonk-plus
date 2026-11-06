// Offline DOM layout regression. No real game, account, profile or network.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
import {browserControllerSource} from '../scripts/controller-sources.mjs';
const module=browserControllerSource(await fs.readFile('src/player-convenience.mjs','utf8'));
const browser=await chromium.launch({headless:true}),results=[];
try {
 for(const [width,height]of [[1042,418],[1280,800],[640,480],[320,240]]) {
  const page=await browser.newPage({viewport:{width,height}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.abort());
  await page.setContent(`<style>*{box-sizing:border-box}body{margin:0;background:#ddd;font:14px sans-serif}.cards{display:grid;grid-template-columns:repeat(${width<600?2:4},1fr);gap:12px;margin:12px 20px}.card{position:relative;height:${width<600?65:Math.min(312,height-100)}px;padding:0;background:white;border:0;border-radius:15px;overflow:hidden}.top{position:relative;height:${width<600?30:110}px;background:#9ce7a0}.rar{position:absolute;top:5px;left:5px}.kind{position:absolute;top:5px;right:5px}.bd{position:absolute;top:${width<600?30:110}px;bottom:0;width:100%}.key{position:absolute;right:5px;bottom:5px}.actions{display:flex;justify-content:center;gap:12px}.actions button{height:40px;width:140px}h3,p{margin:4px}</style><section id=modal><div class=cards>${[0,1,2,3].map((n)=>`<button class="card offer"><div class=top><span class=rar>招式</span><span class=kind>新</span></div><div class=bd><h3>技能${n}</h3><p>保留全部原生信息</p><span class=key>[${n+1}]</span></div></button>`).join('')}</div><div class=actions><button>刷新</button><button>跳过</button><button>放逐</button></div></section>`);
  await page.addScriptTag({content:`(()=>{const scoreOffer=()=>0,configurePlan=()=>({});${module}\nlet clock=0;const modal=document.querySelector('#modal'),ui={modalEl:modal,showLevelUp(run,offers){return modal},hideModal(){modal.remove()}};const moves=new Map([[1,{id:1,key:'leaf',name:'飞叶快刀',arch:'projectile'}],[2,{id:2,key:'water',name:'催眠粉',arch:'projectile'}]]);const run={state:'modal',stage:1,terrain:{},ui,startSpecies:1,player:{moves:[],items:new Map(),vitamins:new Map()}};const app={run,ui,meta:{account:{}}},bridge={app,data:{moves},moveDef:id=>moves.get(id),fusionFor:()=>({key:'fusion',name:'融合成品与完整原料路线'})};window.__instance=installPlayerConvenience(()=>({run,bridge}),{fusion:{enabled:true,cycleSeconds:3}},{now:()=>clock,setInterval:()=>1,clearInterval(){}});window.__tick=()=>{clock+=3000;window.__instance.tick()};ui.showLevelUp(run,[1,2,1,2].map(id=>({kind:'newMove',id})));})();`});
  const checks=await page.evaluate(()=>{
    const native=[...document.querySelectorAll('.card,.actions button')].map(n=>n.getBoundingClientRect()),root=document.querySelector('#pb-convenience-choices'),all=new Set(),shown=new Set();let maxNotes=0;
    const overlap=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
    for(let n=0;n<300;n++){
      const notes=[...root.children].map((node,index)=>({node:node.children[2],index})).filter(({node})=>getComputedStyle(node).display!=='none');maxNotes=Math.max(maxNotes,notes.length);
      for(const {node:note,index}of notes){shown.add(index);const box=note.getBoundingClientRect();if(native.some(r=>overlap(box,r)))throw Error('native content covered');if(box.bottom>innerHeight||box.left<0||box.right>innerWidth)throw Error('out of viewport');if(note.scrollHeight>note.clientHeight)throw Error('text clipped');all.add(note.textContent);}
      for(let i=0;i<notes.length;i++)for(let j=i+1;j<notes.length;j++)if(overlap(notes[i].node.getBoundingClientRect(),notes[j].node.getBoundingClientRect()))throw Error('notes cover each other');
      __tick();
    }
    return {notes:shown.size,maxNotes,pages:all.size,text:[...all].join(''),pointerEvents:getComputedStyle(root).pointerEvents};
  });
  assert.equal(checks.notes,4);assert.ok(checks.pages>1);assert.equal(checks.pointerEvents,'none');assert.ok(checks.text.includes('融合成品'));assert.deepEqual(errors,[]);
  if(width===1042)await page.screenshot({path:'artifacts/1.0.0-convenience-layout.png'});
  await page.evaluate(()=>{__instance.configure({fusion:{enabled:false}});if(document.querySelector('#pb-convenience-choices'))throw Error('disabled annotations retained');__instance.dispose();});
  results.push({width,height,notes:checks.notes,pages:checks.pages,passed:true});await page.close();
 }
} finally {await browser.close();}
await fs.writeFile('artifacts/1.0.0-convenience-layout.json',JSON.stringify({passed:true,realGameUsed:false,results},null,2));console.log(JSON.stringify(results));
