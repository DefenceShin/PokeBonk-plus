import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import babel from '../node_modules/playwright/lib/transform/babelBundle.js';

const source=readFileSync(new URL('../research/update-1.5.1-055-main.min.js',import.meta.url),'utf8');
assert.equal(createHash('sha256').update(source).digest('hex'),'43e519cba77e5c2e3d2ee5f5db47d952f62eb741e0c8096dc468929ca4c7a149');
const methods={};
babel.traverse(babel.babelParse(source,'native-items055'),{ClassMethod(p){
 const name=p.node.key.name,code=source.slice(p.node.start,p.node.end);
 if(name==='itemProcs'||name==='onKill'&&code.includes('fire-stone'))methods[name]=code;
}});
const noop=()=>{},fx=new Proxy(noop,{get:()=>fx,apply:()=>{}});
function fixture(random=.5){
 const odds=[],hits=[],statuses=[],later=[],heals=[];
 const P={chance:p=>{odds.push(p);return random<p;}},MathLocal=Object.assign(Object.create(Math),{random:()=>random});
 const compiled=Object.fromEntries(Object.entries(methods).map(([name,code])=>[name,
  new Function('P','F','Math',`return ({${code}}).${name}`)(P,{},MathLocal)]));
 const enemies={x:[0,1],y:[0,0],z:[0,1],hgt:[1,1],burn:[0,0],poison:[0,0],frozen:[0,0],chill:[0,0],within:()=>[1],nearest:()=>1};
 const player={items:new Map(),level:10,maxHp:1000,scopeIdx:-1,stats:{statusChance:2},heal:n=>heals.push(n),refreshScaling:noop};
 const run={time:10,enemies,player,vfx:fx,combat:{hit:(...args)=>hits.push(args)}};
 run.later=(delay,fn)=>later.push({delay,fn});player.run=run;
 const combat={run,sparkT:0,applyStatus:(...args)=>statuses.push(args),hit:(...args)=>hits.push(args)};
 return {compiled,odds,hits,statuses,later,heals,player,run,enemies,combat};
}
test('actual055 item proc probabilities scale copies and status chance, thunder needs a critical and cooldown',()=>{
 const h=fixture(0);for(const key of ['flame-orb','toxic-orb','snowball','grip-claw','awakening'])h.player.items.set(key,2);
 h.compiled.itemProcs.call(h.combat,0,100,false);
 assert.deepEqual(h.odds,[.2,.24,.24,.16,.1]);assert.deepEqual(h.statuses.map(x=>x[1]),['burn','poison','freeze','root','sleep']);
 h.player.items=new Map([['thunder-stone',2]]);
 h.compiled.itemProcs.call(h.combat,0,100,false);assert.equal(h.hits.length,0);
 h.compiled.itemProcs.call(h.combat,0,100,true);assert.equal(h.hits.length,1);assert.equal(h.hits[0][1],36);assert.equal(h.hits[0][2].noReact,true);
 h.compiled.itemProcs.call(h.combat,0,100,true);assert.equal(h.hits.length,1);
});
test('actual055 fire-stone needs burning death AND its 50 percent roll',()=>{
 for(const [burn,roll,expected]of [[0,.1,0],[1,.499,1],[1,.5,0]]){
  const h=fixture(roll);h.player.items.set('fire-stone',2);h.enemies.burn[0]=burn;
  h.compiled.onKill.call(h.player,0);assert.equal(h.hits.length,expected);
  if(expected)assert.equal(h.hits[0][1],72);
 }
});
test('actual055 griseous-orb is delayed and extra copies increase damage rather than probability',()=>{
 for(const copies of [1,3]){
  const h=fixture(.119);h.player.items.set('griseous-orb',copies);h.compiled.onKill.call(h.player,0);
  assert.equal(h.odds[0],.12);assert.equal(h.hits.length,0);assert.equal(h.later[0].delay,.6);
  h.later[0].fn();assert.equal(h.hits[0][1],18*copies*1.8);assert.equal(h.hits[0][2].status,'curse');
 }
 const h=fixture(.12);h.player.items.set('griseous-orb',1);h.compiled.onKill.call(h.player,0);assert.equal(h.later.length,0);
});
test('actual055 ice-stone also triggers from chill; berry juice chance caps at half',()=>{
 const h=fixture(.49);h.player.items=new Map([['ice-stone',1],['berry-juice',20]]);h.enemies.chill[0]=1;
 h.compiled.onKill.call(h.player,0);assert.equal(h.hits[0][2].src,'ice-stone');assert.deepEqual(h.odds,[.5]);assert.deepEqual(h.heals,[20]);
});
