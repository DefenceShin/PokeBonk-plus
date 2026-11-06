import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import babel from '../node_modules/playwright/lib/transform/babelBundle.js';
import {evaluateOfferBenefit,evaluatePlayerMods,playerBenefitContext,scoreOffer,selectCopyItem} from '../src/policy.mjs';
import {chooseOfferAction} from '../src/choice-strategy.mjs';

// Execute the actual reviewed 0.8.55 stat grouping, clamping and recompute body.
// Dependencies supplying catalogs are inert fixtures; no App/UI/Run is created.
const text=await readFile(new URL('../research/update-1.5.1-055-main.min.js',import.meta.url),'utf8'),
  ast=babel.babelParse(text,'native.js'), nodes={},methods=[];
assert.equal(createHash('sha256').update(text).digest('hex'),'43e519cba77e5c2e3d2ee5f5db47d952f62eb741e0c8096dc468929ca4c7a149');
babel.traverse(ast,{FunctionDeclaration(p){if(['by','xy','Cy'].includes(p.node.id?.name))nodes[p.node.id.name]=p.node;},ClassMethod(p){if(p.node.key?.name==='recompute')methods.push(p.node);}});
const method=methods.find(n=>text.slice(n.start,n.end).includes('this.run.tempMods'));
assert.ok(method);assert.equal(Object.keys(nodes).length,3);
const catalog=new Map([['ether',{stat:'attackSpeed',per:.08,kind:'mul'}],['protein',{stat:'physical',per:.1,kind:'mul'}]]);
const sandbox={Sy:new WeakMap(),Tt:catalog,Kn:new Map(),le:{},Dy:{},A:{evolutionsOf:()=>[]},
  My:()=>[],vy:[{stat:'damage',mul:1.25},{stat:'attackSpeed',mul:1.2}],
  xp:has=>has('tm-agility')?[{stat:'attackSpeed',mul:1.3}]:[],
  xt:(def,held)=>[{stat:def.stat,mul:1+def.per*held.acc}]};
vm.createContext(sandbox);
vm.runInContext(Object.values(nodes).map(n=>text.slice(n.start,n.end)).join('\n')+`\nglobalThis.recompute=({${text.slice(method.start,method.end)}}).recompute;`,sandbox);
function fixture({speed=1,moves,temporary=false}={}) {
  const p={speciesId:99,ability:'imposter',data:{stats:{hp:1,atk:1,def:1,spa:1,spd:1,spe:1}},evoStage:0,growth:0,meta:{},
    items:new Map(),vitamins:new Map(),buffs:new Map(temporary?[['tm-agility',{t:1}]]:[]),hp:100,maxHp:100,
    moves:moves || [{def:{key:'hit',arch:'strike',dmg:100,cls:'physical',cd:1,count:1,dur:1},mods:{cd:1},level:8}],
    moveSlots:1,vitaminSlots:0,capOf:()=>8,vitCap:10,recompute:sandbox.recompute};
  const native={tempMods:[{stat:'attackSpeed',mul:speed}],stats:{kills:0},streak:0,time:30,stage:1,player:p};
  p.run=native;p.recompute();
  return {player:p,nativeRun:native,build:{},data:{vitamins:catalog,data:{evolutionsOf:()=>[]}}};
}
const speedOffer={rarity:4,mods:[{stat:'attackSpeed',mul:1.2}]};

test('native grouped shadow before/after is exact and cannot mutate real player, buffs or tempMods',()=>{
 const run=fixture({speed:2});run.nativeRun.tempMods.push({stat:'damage',mul:2});run.player.recompute();
 const snapshot=JSON.stringify({stats:run.player.stats,temp:run.nativeRun.tempMods,hp:run.player.hp,buffs:[...run.player.buffs]}),
   result=evaluatePlayerMods([{stat:'damage',mul:1.2}],run);
 assert.ok(Math.abs(result.after.damage/result.before.damage-1-.1)<1e-10);
 assert.equal(result.confidence,'native-shadow');
 assert.equal(JSON.stringify({stats:run.player.stats,temp:run.nativeRun.tempMods,hp:run.player.hp,buffs:[...run.player.buffs]}),snapshot);
});

test('pure speed caps reject competing cards but permit the sole native upgrade',()=>{
 const run=fixture({speed:20});run.build={statWeights:{attackSpeed:5},sourceType:'custom',allowOffPlan:false};
 assert.equal(evaluateOfferBenefit(speedOffer,run).hardRejected,true);
 assert.equal(scoreOffer(speedOffer,run),-Infinity);
 const positive={mods:[{stat:'damage',mul:1.1}],rarity:0};
 for(const options of [{kind:'blessing'},{kind:'upgrade',history:{rerollsThisPage:99}},{}]) {
   const d=chooseOfferAction([speedOffer,positive],run,{},options);
   assert.equal(d.index,1);assert.deepEqual(d.candidates.map(v=>v.index),[1]);
 }
 const forced={...run,finalReplacement:{strictVitamins:{enabled:true,targets:[]}}};
 const d=chooseOfferAction([speedOffer],forced,{}, {kind:'upgrade'});
 assert.equal(d.action,'choose');assert.equal(d.index,0);
 assert.equal(d.benefitEvaluations[0].hardRejected,true);
});

test('sole zero-benefit upgrade is taken while mandatory blessing keeps its existing wait policy',()=>{
 const run=fixture({speed:20});
 for (const [options,expected] of [[{kind:'upgrade',rerolls:1,rerollLegal:true},'choose'],
   [{kind:'upgrade',skips:1,skipLegal:true},'choose'],[{kind:'upgrade',skips:1},'choose'],
   [{kind:'blessing',skips:5,skipLegal:true},'wait']]) {
   const d=chooseOfferAction([speedOffer],run,{},options);assert.equal(d.action,expected);assert.equal(d.index,expected==='choose'?0:null);
 }
});

test('mixed card retains damage while speed is capped; mod ordering preserves explicit stat weights',()=>{
 const run=fixture({speed:20}),mixed={mods:[...speedOffer.mods,{stat:'damage',mul:1.1}]};
 assert.equal(evaluateOfferBenefit(mixed,run).hardRejected,false);assert.ok(scoreOffer(mixed,run)>0);
 run.build={statWeights:{physical:0,damage:5}};
 const mods=[{stat:'physical',mul:1.1},{stat:'damage',mul:1.1}];
 assert.equal(scoreOffer({mods},run),scoreOffer({mods:[...mods].reverse()},run));
 assert.ok(scoreOffer({mods},run)>0);
});

test('partial buff coverage earns positive speed value after all direct attacks cap; full coverage rejects',()=>{
 const run=fixture({speed:20});run.player.moves.push({def:{key:'buff',arch:'buff',cd:100,dur:1},level:8});run.player.moveSlots=2;
 assert.equal(evaluateOfferBenefit(speedOffer,run).hardRejected,false);assert.ok(scoreOffer(speedOffer,run)>0);
 run.player.moves[1].def.dur=100;
 assert.equal(evaluateOfferBenefit(speedOffer,run).hardRejected,true);
});

test('temporary agility cap cannot prove stable zero, but truly stable native cap can',()=>{
 const run=fixture({speed:7,temporary:true}),benefit=evaluateOfferBenefit(speedOffer,run);
 assert.equal(benefit.hardRejected,false);assert.ok(benefit.stableBefore.attackSpeed<benefit.before.attackSpeed);
 run.nativeRun.tempMods=[{stat:'attackSpeed',mul:20}];run.player.recompute();
 assert.equal(evaluateOfferBenefit(speedOffer,run).hardRejected,true);
});

test('fusion .6 versus ordinary .12 floors, sustained active time, random and absent definitions',()=>{
 const run=fixture({speed:3}),def=run.player.moves[0].def;
 def.arch='fusion';assert.equal(evaluateOfferBenefit(speedOffer,run).hardRejected,true);
 def.arch='strike';assert.equal(evaluateOfferBenefit(speedOffer,run).hardRejected,false);
 def.arch='beam';def.dur=100;assert.equal(evaluateOfferBenefit(speedOffer,run).hardRejected,false,'active time does not stop cooldown reducing after the active branch');
 def.arch='random';assert.equal(evaluateOfferBenefit(speedOffer,run).state,'unknown');assert.equal(evaluateOfferBenefit(speedOffer,run).hardRejected,false);
 delete def.cd;assert.equal(evaluateOfferBenefit(speedOffer,run).state,'unknown');
});

test('secondary skill benefit is weighted by player damage contribution and companions cannot reopen zero',()=>{
 const run=fixture({speed:20}),primary=run.player.moves[0];
 run.player.moves.push({def:{key:'small',arch:'strike',cd:100,dmg:1,cls:'physical'},level:8});
 const small=scoreOffer(speedOffer,run);primary.def.dmg=.01;
 assert.ok(scoreOffer(speedOffer,run)>small);
 run.player.moves.pop();primary.def.dmg=100;
 run.nativeRun.allies={list:[{dmg:100000}],mods:()=>[]};
 assert.equal(evaluateOfferBenefit(speedOffer,run).hardRejected,true);
});

test('completion includes explicit fusion/core targets, excludes chest item gaps and preserves XP evolution objectives',()=>{
 const run=fixture(),data=run.data,ready=playerBenefitContext(run,data);
 assert.equal(ready.completion,1);assert.ok(ready.weights.growth<.2);
 run.build.items=['missing-chest-only'];assert.equal(playerBenefitContext(run,data).weights.growth,ready.weights.growth);
 run.finalReplacement={moves:{active:true,missing:['core']},fusion:{active:true,pending:{}}};
 assert.ok(playerBenefitContext(run,data).completion<ready.completion);
 assert.ok(playerBenefitContext(run,data).weights.growth>ready.weights.growth);
 delete run.finalReplacement;data.data.evolutionsOf=()=>[100];
 assert.ok(playerBenefitContext(run,data).weights.growth>=.8);
 run.objectiveMetric='xp';assert.equal(playerBenefitContext(run,data).weights.growth,1.5);
});

test('native vitamin uses vitamin accumulator group rather than blessing group, including >100% critical range',()=>{
 const run=fixture({speed:1});run.player.vitamins.set('ether',{level:10,acc:10});run.player.recompute();
 const b=evaluateOfferBenefit({kind:'upVit',vit:'ether',rarity:0},run,run.data);
 assert.ok(Math.abs(b.after.attackSpeed/b.before.attackSpeed-1-.08/1.8)<1e-10);
 run.nativeRun.tempMods.push({stat:'critChance',add:1});run.player.recompute();
 const c=evaluatePlayerMods([{stat:'critChance',add:.1}],run);
 assert.ok(c.after.megaCrit>c.before.megaCrit);assert.ok(c.components.output>0);
});


test('saturated speed items are taken free without reopening automatic copy eligibility',()=>{
 const run=fixture({speed:20}),items=new Map([['quick-claw',{mods:[{stat:'attackSpeed',mul:1.1}]}]]);
 sandbox.Kn=items;
 const data={items};run.player.items.set('quick-claw',1);run.player.recompute();
 assert.equal(evaluateOfferBenefit({kind:'item',id:'quick-claw'},run,data).hardRejected,true);
 assert.equal(selectCopyItem(run.player,{items:['quick-claw']},data),null);
 assert.equal(chooseOfferAction(['quick-claw'],run,data,{kind:'itemChoice'}).index,0);
 sandbox.Kn=new Map();
});


test('critical benefits match native ordinary and mega rolls including per-move crit bonus and caps',()=>{
 const expected=(chance,damage)=>chance<=1?1+chance*(damage-1):damage*(1+Math.min(1,chance-1)*.5*(damage-1));
 for(const [chance,bonus,add] of [[.9,0,.2],[1,0,.2],[1.9,0,.2],[2,0,.2],[.9,.3,.1],[1.8,.3,.1]]) {
  const run=fixture();run.player.moves[0].mods.crit=bonus;
  run.nativeRun.tempMods.push({stat:'critChance',add:chance-run.player.stats.critChance});run.player.recompute();
  const result=evaluatePlayerMods([{stat:'critChance',add}],run),damage=run.player.stats.critDamage;
  const relative=expected(Math.min(2,chance+add)+bonus,damage)/expected(chance+bonus,damage)-1;
  assert.ok(Math.abs(result.components.output-relative)<1e-10,JSON.stringify({chance,bonus,add,result:result.components.output,relative}));
  assert.ok(Math.abs(result.components.contributions.critChance-relative)<1e-10);
 }
});


test('capped ordinary and mega critical chance is excluded automatically and numeric priority cannot change a free zero-benefit tie',()=>{
 const r=fixture();r.nativeRun.tower={floor:20};
 r.nativeRun.tempMods.push({stat:'critChance',add:3});r.player.recompute();
 const offer={mods:[{stat:'critChance',add:.06}]};
 assert.equal(evaluateOfferBenefit(offer,r).hardRejected,true);
 assert.equal(chooseOfferAction([offer,{mods:[{stat:'armor',add:1}]}],r,{}, {kind:'blessing'}).index,1);
 const items=new Map([['scope-lens',{mods:offer.mods}],['quick-claw',{mods:[{stat:'attackSpeed',mul:1.1}]}]]);
 sandbox.Kn=items;
 r.nativeRun.tempMods.push({stat:'attackSpeed',mul:100});r.player.recompute();
 r.build={itemRules:[{key:'scope-lens',priority:0},{key:'quick-claw',priority:1}]};
 const d=chooseOfferAction(['quick-claw','scope-lens'],r,{items},{kind:'itemChoice'});
 assert.equal(d.index,0);assert.equal(d.candidates[0].rawScore,0);
 sandbox.Kn=new Map();
});


test('host dispatch accepts the sole zero-benefit upgrade and rechecks native legality before clicking',async()=>{
 const source=await readFile(new URL('../src/pilot.mjs',import.meta.url),'utf8'),tree=babel.babelParse(source,'pilot-dispatch');
 let expression;
 babel.traverse(tree,{VariableDeclarator(p){if(p.node.id?.name==='choiceStillAllowed')expression=p.node.init;}});
 assert.ok(expression);
 const run=fixture({speed:20}),modal={kind:'upgrade',offers:[{...speedOffer}]},
   decide=()=>chooseOfferAction(modal.offers,run,{}, {kind:'upgrade',rerolls:4,rerollLegal:true}),decision=decide();
 assert.equal(decision.action,'choose');assert.equal(decision.reason,'sole-native-upgrade');
 const allowed=new Function('decision','decide','modal',`return (${source.slice(expression.start,expression.end)});`)(decision,decide,modal);
 assert.equal(allowed(),true);
 modal.offers[0].disabled=true;
 assert.equal(allowed(),false);
});
