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

export {fixture,sandbox};
