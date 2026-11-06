import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import babel from '../node_modules/playwright/lib/transform/babelBundle.js';
import {projectTowerFloor,towerIronReward} from '../src/choice-strategy.mjs';

const main=readFileSync(new URL('../research/update-1.5.1-055-main.min.js',import.meta.url),'utf8'),
  news=readFileSync(new URL('../research/update-1.5.1-055-news.min.js',import.meta.url),'utf8');
assert.equal(createHash('sha256').update(main).digest('hex'),'43e519cba77e5c2e3d2ee5f5db47d952f62eb741e0c8096dc468929ca4c7a149');
assert.equal(createHash('sha256').update(news).digest('hex'),'9ba51a72b04a75063eea55ef149d20af4cb5ec5e463cc62c2e572a97eb9edb52');
const declarations=source=>{
  const result=new Map();
  for(const node of babel.babelParse(source,'source.js').program.body) {
    if(node.type==='FunctionDeclaration')result.set(node.id.name,node);
    if(node.type==='VariableDeclaration')for(const d of node.declarations)if(d.id.type==='Identifier')result.set(d.id.name,d.init);
  }
  return result;
}, nodes=declarations(main), newsNodes=declarations(news), snippet=key=>main.slice(nodes.get(key).start,nodes.get(key).end);
const pureNews={},scope=new Proxy(pureNews,{has:(_,key)=>newsNodes.has(key),get:(_,key)=>{
  if(key===Symbol.unscopables)return undefined;
  if(key in pureNews)return pureNews[key];
  const node=newsNodes.get(key);return pureNews[key]=new Function('scope',`with(scope){return (${news.slice(node.start,node.end)});}`)(scope);
}});
const tower=nodes.get('qD'),method=name=>{
  const n=tower.body.body.find(n=>n.key?.name===name);assert(n,name);return main.slice(n.start,n.end);
},nativeTower=vm.runInNewContext(`({${['beyond','def','vmin','bossFloor','waveSize'].map(method).join(',')}})`,{vD:Array(7).fill({})});

function setup(floor) {
  const player={stats:{difficulty:1,enemyAmount:1.5,eliteSpawn:2,luck:100,damage:1,physical:1,attackSpeed:1},
    level:100,items:new Map(),vitamins:new Map(),moves:[{def:{arch:'strike',cls:'physical',dmg:10,cd:1},level:1}],types:['water']},
    run={tower:{floor},player,stage:4,tier:2,diff:{enemyAmount:1.2},combat:{meter:{dps:1e18}},meta:{itemInPool:()=>true},banished:new Set()},
    data={data:{get:id=>({bst:400+id}),hasSprite:()=>true},items:new Map()};
  return {run,data};
}

test('projected native HP curve, spawn pool, elite weights and wave counts agree across target floors',()=>{
  const nativePool=vm.runInNewContext(snippet('bD'));
  for(const floor of [7,24,65,66,76,77,82,98]) {
    const {run,data}=setup(floor),p=projectTowerFloor(run,data),t=Object.create(nativeTower);
    Object.assign(t,{floor:floor+1,run,curse:{amount:1}});
    for(let wave=0;wave<3;wave++) {
      Object.assign(t,{wave,waveT:0});
      const hp=nativePool.reduce((sum,id)=>sum+(12+.055*data.data.get(id).bst)*scope.Qt(t.vmin)*1.35*
        (1+3.5*Math.min(1,(.03+.012*t.floor+.04)*run.player.stats.eliteSpawn)),0)/nativePool.length;
      assert(Math.abs(p.waves[wave].meanHp/hp-1)<1e-12);
      assert.equal(p.waves[wave].count,wave===2&&t.bossFloor?0:t.waveSize(wave));
    }
  }
});

test('epic distribution agrees with native pS/vS integration, including the suppressed lower rarity weights',()=>{
  const {run,data}=setup(69);
  data.items=new Map([
    ['low',{key:'low',rarity:0,max:10}],['purple',{key:'purple',rarity:3,max:10}],
    ['gold-water',{key:'gold-water',rarity:4,max:10,tags:['type:water']}],['gold-other',{key:'gold-other',rarity:4,max:10,tags:['type:fire']}],
  ]);
  let rarityRoll=0,itemRoll=0;
  const math=Object.create(Math);math.random=()=>rarityRoll;
  const native=vm.runInNewContext(`${snippet('pS')}\n${snippet('vS')}\n(${snippet('_S')});\n vS`,{
    Math:math,pt:[...data.items.values()],_S:()=>false,P:{weighted:(rows,weight)=>{
      let cursor=itemRoll*rows.reduce((n,r)=>n+weight(r),0);return rows.find(r=>(cursor-=weight(r))<=0)||rows.at(-1);
    }},
  });
  const counts=new Map(),steps=200;
  for(let i=0;i<steps;i++)for(let j=0;j<steps;j++) {
    rarityRoll=(i+.5)/steps;itemRoll=(j+.5)/steps;
    const key=native(run,3);counts.set(key,(counts.get(key)||0)+1/steps**2);
  }
  const expected=towerIronReward(run,{data});assert.equal(expected.outcomes.length,3);
  for(const outcome of expected.outcomes)assert(Math.abs(outcome.probability-(counts.get(outcome.key)||0))<.006,outcome.key);
  run.banished=new Set(['ipurple','igold-water','igold-other']);assert.equal(native(run,3),null);
  assert.equal(towerIronReward(run,{data}).reason,'epic-pool-exhausted-gold-unpriced');
});

test('actual native damage rows separate held moves, other damage and ultimate before pricing a reward',()=>{
  const {run,data}=setup(69),Log=vm.runInNewContext(`(${snippet('sS')})`,{nS:20,rS:'#other',iS:'#ult',aS:'#allies',oS:3});
  run.player.moves[0].def.key='hit';run.player.moves[0].damageDone=0;
  run.allies={list:[]};run.stats={forgotten:{},ultDamage:0,damage:0};run.tempMods=[];
  data.items.set('max-elixir',{key:'max-elixir',rarity:3,max:10,mods:[{stat:'attackSpeed',mul:1.2}]});
  run.dpsLog=new Log();run.time=600;run.dpsLog.tick(run);
  run.time=615;run.player.moves[0].damageDone=10;run.stats.ultDamage=100;run.stats.damage=200;
  run.dpsLog.tick(run);
  const before=JSON.stringify(run.dpsLog),reward=towerIronReward(run,{data});
  assert.equal(reward.attribution.playerMoveShare,.1);
  assert(Math.abs(reward.expectedGain-.02)<1e-10);
  assert.equal(JSON.stringify(run.dpsLog),before);
});
