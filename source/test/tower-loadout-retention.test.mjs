// Isolated source-path reproductions; synthetic catalogs/availability, not a live-game replay.
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as c from '../src/choice-strategy.mjs';
const root=new URL('../',import.meta.url);
const catalog=JSON.parse(await readFile(new URL('research/update-1.5.1-055-runtime-definitions.json',root),'utf8'));
const all=[...catalog.moves,...catalog.fusionMoves],byKey=new Map(all.map(d=>[d.key,d]));
const recipes=catalog.fusionMoves.map(d=>({...d.recipe,id:d.id}));
function setup(species,held,available,targets,level,build={}) {
 const definitions=available.map(k=>byKey.get(k)); assert(definitions.every(Boolean));
 const data={moves:new Map(all.map(d=>[d.id,d])),movesByKey:byKey,vitamins:new Map(catalog.vitamins.map(v=>[v.key,v])),
  items:new Map(),rarityMultipliers:[1,1.2,1.45,1.75,2.1],fusionRecipes:recipes,
  moveGuide:()=>({kit:definitions.map(d=>({id:d.id,level:1,open:true})),line:[],shared:[]}),
  fusionFor:(a,b)=>recipes.find(r=>r.kind==='signature'&&r.moves.includes(a.key)&&r.moves.includes(b.key)) ||
   recipes.find(r=>r.kind==='type'&&a.type===b.type&&r.type===a.type) ||
   recipes.find(r=>r.kind==='reaction'&&((r.pair[0].includes(a.type)&&r.pair[1].includes(b.type))||(r.pair[1].includes(a.type)&&r.pair[0].includes(b.type)))) ||
   recipes.find(r=>r.kind==='glitch')};
 const player={speciesId:species,level,hp:160,maxHp:160,types:['ghost'],moveSlots:4,vitaminSlots:5,moveCap:8,vitCap:10,
  capOf:m=>m.def.arch==='fusion'?5:8,moves:held.map(([key,lv,parents])=>({def:byKey.get(key),level:lv,parents,mods:{}})),
  vitamins:new Map(),items:new Map(),stats:{moveSpeed:1,attackSpeed:1,damage:1,special:1,physical:1,armor:20,regen:2,healing:1,projectiles:0}};
 const nativeRun={player,startSpecies:species,tower:{floor:3,curses:[]},banished:new Set(),banishes:0,skips:0,rerolls:0};
 const stored={moves:{enabled:false,targets:[],level:30},fusion:{enabled:true,targets,level:30},vitamins:{enabled:false,targets:[],level:30}};
 const settings={finalReplacements:{[species]:stored}};
 const final=c.finalReplacementState(settings,nativeRun,data,{build});
 final.towerPursuit=c.finalReplacementState({finalReplacements:{[species]:{...stored,fusion:{...stored.fusion,level:1}}}},nativeRun,data,{build});
 return {data,player,nativeRun,final,ctx:{player,nativeRun,build:c.finalReplacementBuild(build,final),finalReplacement:final}};
}
const options={kind:'upgrade',skipLegal:true,rerollLegal:true,banishLegal:true};
const vitamin={kind:'newVit',vit:'calcium',key:'vcalcium',rarity:0};
function gengar(level=25,ready=false) {
 return setup(92,ready?[['fu-missingno',5,[122,40]],['shadow-ball',8],['hex',8]]:[['lick',8],['poison-sting',8]],
  ['lick','poison-sting','shadow-ball','hex','smog','sludge-bomb'],['fu-92','fu-missingno','fu-t-poison'],level);
}
test('pre-threshold ready ingredients can gain levels from unspecified vitamins without abandoning the run',()=>{
 const h=gengar();assert.equal(h.final.fusion.active,false);assert.equal(h.final.towerPursuit.fusion.pending.ready,true);
 const d=c.chooseOfferAction([{kind:'newVit',vit:'protein',key:'vprotein',rarity:0}],h.ctx,h.data,options);assert.equal(d.action,'choose');assert.equal(d.index,0);
 assert.equal(c.chooseFusionAction([{a:0,b:1,ready:true,r:recipes.find(r=>r.key==='fu-missingno')}],h.ctx,h.data).reason,'final-fusion-threshold-wait');
});
test('ready shadow-ball and hex finish a forced upgrade with safe growth rather than searching for more materials',()=>{
 const h=gengar(45,true);h.nativeRun.rerolls=20;h.nativeRun.skips=20;
 assert.equal(h.final.needsFusion,true);
 const d=c.chooseOfferAction([vitamin],h.ctx,h.data,options);assert.equal(d.action,'choose');assert.equal(d.index,0);
 const f=c.chooseFusionAction([{a:1,b:2,ready:true,r:recipes.find(r=>r.key==='fu-92')}],h.ctx,h.data);assert.equal(f.key,'fu-92');
});
test('no legal upgrade searches before exiting even when fusion ingredients are ready',()=>{
 const h=gengar(45,true);h.nativeRun.rerolls=20;
 const d=c.chooseOfferAction([],h.ctx,h.data,options);assert.equal(d.action,'reroll');assert.equal(h.nativeRun.rerolls,20);
});
test('empty vitamin goals do not blacklist vitamins when custom allowOffPlan is true',()=>{
 const h=setup(35,[['draining-kiss',8]],['draining-kiss','gravity','moonblast','dazzling-gleam'],['fu-t-fairy','fu-35'],10,
  {sourceType:'custom',moves:[],moveRules:[],vitaminRules:[],allowOffPlan:true});
 assert.equal(c.chooseOfferAction([vitamin],h.ctx,h.data,options).action,'choose');
});
test('held material upgrades progress to their cap before ordinary vitamin growth',()=>{
 const h=setup(35,[['draining-kiss',3]],['draining-kiss','gravity','moonblast','dazzling-gleam'],['fu-t-fairy','fu-35'],10);
 const upgrade={kind:'upMove',slot:0,key:'m577',rarity:3,ups:[{key:'dmg',value:.4}]};
 let history={};
 for(let level=3;level<8;level++) {
  h.player.moves[0].level=level;
  const d=c.chooseOfferAction([upgrade,vitamin],h.ctx,h.data,{...options,history});
  assert.equal(d.action,'choose');assert.equal(d.index,0);history=d.nextHistory;
 }
 h.player.moves[0].level=8;
 const d=c.chooseOfferAction([vitamin],h.ctx,h.data,{...options,history});
 assert.equal(d.action,'choose');assert.equal(d.index,0);

});
const custom={sourceType:'custom',moves:['trick-room','perish-song'],moveRules:[{key:'trick-room',priority:6},{key:'perish-song',priority:7}],allowOffPlan:true};
test('fusion planning protects custom ordinary targets and chooses an alternative parent',()=>{
 const h=setup(151,[['fu-151',5,[94,585]],['trick-room',8],['barrier',8]],['psychic','moonblast','trick-room','barrier','psybeam','perish-song'],['fu-151','fu-t-psychic'],60,custom);
 assert(!h.final.fusion.pending.parents.includes('trick-room'));assert(h.final.fusion.pending.parents.includes('psybeam'));
});
test('fusion dispatch refuses a stale planned pair consuming a custom target',()=>{
 const h=setup(151,[['trick-room',8],['barrier',8]],['trick-room','barrier','psybeam','perish-song'],['fu-t-psychic'],60,custom);
 h.final.fusion.pending={ready:true,key:'fu-t-psychic',parents:['trick-room','barrier']};
 assert.equal(c.chooseFusionAction([{a:0,b:1,ready:true,r:recipes.find(r=>r.key==='fu-t-psychic')}],h.ctx,h.data).action,'leave');
});
test('explicit vitamin whitelist is not relaxed by tower growth fallback',()=>{
 const h=gengar();h.final.towerPursuit.vitamins={enabled:true,active:true,targets:['carbos']};
 const d=c.chooseOfferAction([vitamin],h.ctx,h.data,options);assert.equal(d.action,'restart');
});
test('disabled cards cannot become tower growth fallback',()=>{
 const h=gengar();assert.equal(c.chooseOfferAction([vitamin],h.ctx,h.data,{...options,legal:()=>false}).action,'restart');
});

test('Mewtwo exhausted native search preserves the missing planned star piece slot',()=>{
 const build={sourceType:'custom',allowOffPlan:true,moves:['trick-room','prismatic-laser','psycho-boost'],
  vitaminRules:['elixir','star-piece-v','pp-up','calcium','super-lure'].map(key=>({key,priority:1}))};
 const h=setup(150,[['fu-t-psychic',5,[427,540]],['trick-room',8],['prismatic-laser',8],['psycho-boost',8]],
  ['psycho-cut','psyshock','trick-room','prismatic-laser','psycho-boost'],['fu-t-psychic'],93,build);
 h.player.vitamins=new Map(['elixir','pp-up','calcium','super-lure'].map(key=>[key,{level:10}]));
 const offers=['max-potion','loaded-dice','cursed','nugget'].map(vit=>({kind:'newVit',vit,key:'v'+vit,rarity:0}));
 const d=c.chooseOfferAction(offers,h.ctx,h.data,{...options,history:{rerollsThisPage:8,unplannedRounds:0}});
 assert.equal(d.action,'restart');assert.equal(h.player.hp,160);
 assert.equal(h.player.vitamins.has('star-piece-v'),false,'do not fabricate the missing native roll');
});

const starOffer={kind:'newVit',vit:'star-piece-v',key:'vstar-piece-v',rarity:0};
test('exhausted search returns exit instead of safe tower growth',()=>{
 const h=setup(92,[['hex',2]],['shadow-ball','hex'],[],25,{sourceType:'custom',allowOffPlan:true,moves:['shadow-ball']});
 const d=c.chooseOfferAction([{kind:'upMove',slot:0,rarity:0,ups:[{key:'dmg',value:.4}]}],h.ctx,h.data,options);
 assert.equal(d.reason,'tower-target-search-exhausted');assert.equal(d.action,'restart');assert.equal(d.index,null);
 assert.equal(d.searchExhausted,true);
});
function starSetup(tower=true) {
 const build={sourceType:'custom',allowOffPlan:true,moves:['shadow-ball'],
  moveRules:[{key:'shadow-ball',priority:1}],
  vitaminRules:[{key:'calcium',priority:1},{key:'star-piece-v',priority:2}]};
 const h=setup(92,[['shadow-ball',3]],['shadow-ball','hex'],[],25,build);
 h.ctx={player:h.player,nativeRun:h.nativeRun,build};
 if(!tower)delete h.nativeRun.tower;
 return h;
}
// Ordinary modes retain the historical rarity rule. All tower roles now use
// normal planned acquisition and marginal value rather than star-only priority.
for(const tower of [true,false])for(const [starRarity,otherRarity,want] of [
 [0,0,'star-piece-v'],[0,1,'star-piece-v'],[0,2,'calcium'],
 [2,2,'star-piece-v'],[3,2,'star-piece-v'],[2,3,'calcium'],[4,4,'star-piece-v'],
])test(`first star piece rarity ${starRarity} versus planned vitamin ${otherRarity}, tower=${tower}`,()=>{
 const h=starSetup(tower),offers=[{...vitamin,rarity:otherRarity},{...starOffer,rarity:starRarity}];
 const d=c.chooseOfferAction(offers,h.ctx,h.data,options);
 assert.equal(d.action,'choose');assert.equal(offers[d.index].vit,tower?'calcium':want);
});

test('first star piece beats a higher rarity off-plan card in ordinary upgrade choices',()=>{
 const h=starSetup(false),offers=[{...vitamin,vit:'protein',key:'vprotein',rarity:4},starOffer];
 const d=c.chooseOfferAction(offers,h.ctx,h.data,options);assert.equal(d.index,1);
});
test('automatic vitamin fallback completion does not turn every vitamin into a planned exception',()=>{
 const h=starSetup(false);h.ctx.build={sourceType:'guide',moves:['shadow-ball'],vitaminPriority:['star-piece-v']};
 const d=c.chooseOfferAction([{...vitamin,rarity:4},starOffer],h.ctx,h.data,options);assert.equal(d.index,1);
});
test('same rarity planned move upgrade cannot displace the first star piece even when growth is overdue',()=>{
 const h=starSetup(),offers=[{kind:'upMove',slot:0,key:'m247',rarity:2,ups:[{key:'dmg',value:.4}]},{...starOffer,rarity:2}];
 const d=c.chooseOfferAction(offers,h.ctx,h.data,{...options,history:{moveDeferrals:4}});assert.equal(d.index,1);
});
test('first planned star piece precedes an owned move upgrade in tower',()=>{
 const h=starSetup(),offers=[{kind:'upMove',slot:0,key:'m247',rarity:2,ups:[{key:'dmg',value:.4}]},starOffer];
 const d=c.chooseOfferAction(offers,h.ctx,h.data,options);assert.equal(d.index,1);
});
test('urgent fusion material wins over equal rarity first star piece',()=>{
 const h=gengar(45),offers=[{kind:'newMove',id:byKey.get('shadow-ball').id,key:'m247',rarity:0},starOffer];
 const d=c.chooseOfferAction(offers,h.ctx,h.data,options);assert.equal(d.index,0);
});
test('tower planned calcium acquisition is not displaced by the star-only exception',()=>{
 const h=starSetup(),offers=[{...starOffer,rarity:0},{kind:'upMove',slot:0,key:'m247',rarity:2,ups:[{key:'dmg',value:.4}]},vitamin];
 const d=c.chooseOfferAction(offers,h.ctx,h.data,{...options,history:{vitaminDeferrals:3}});assert.equal(d.index,2);
});

for(const boundary of ['avoid','native-disabled','native-hidden','legal-callback','full-slots','strict-whitelist','custom-whitelist','challenge'])
test(`first star piece cannot bypass ${boundary}`,()=>{
 const h=starSetup(),star={...starOffer},opts={...options};
 if(boundary==='avoid')h.ctx.build.avoidVitamins=['star-piece-v'];
 if(boundary==='native-disabled')star.disabled=true;
 if(boundary==='native-hidden')star.hidden=true;
 if(boundary==='legal-callback')opts.legal=index=>index===0;
 if(boundary==='full-slots'){h.player.vitaminSlots=1;h.player.vitamins.set('calcium',1);}
 if(boundary==='strict-whitelist')h.ctx.finalReplacement={strictVitamins:{enabled:true,targets:['calcium']}};
 if(boundary==='custom-whitelist'){h.ctx.build.allowOffPlan=false;h.ctx.build.vitaminRules=[{key:'calcium',priority:1}];}
 if(boundary==='challenge')h.ctx.build.masteryConstraints={noVitamins:true};
 const d=c.chooseOfferAction([{kind:'upMove',slot:0,key:'m247',rarity:0,ups:[{key:'dmg',value:.4}]},star],h.ctx,h.data,opts);
 assert.equal(d.action,'choose');assert.equal(d.index,0);
});
test('strictly rejected first star piece cannot re-enter the tower forced-choice fallback',()=>{
 const h=starSetup();h.ctx.finalReplacement={strictVitamins:{enabled:true,targets:['calcium']},towerPursuit:{vitamins:{enabled:true,targets:['star-piece-v']}}};
 const d=c.chooseOfferAction([starOffer],h.ctx,h.data,options);assert.equal(d.action,'restart');assert.equal(d.index,null);
});
test('a banned tower target preserves the choice page when no permitted growth exists',()=>{
 const h=starSetup();h.ctx.build.avoidVitamins=['star-piece-v'];
 const d=c.chooseOfferAction([starOffer],h.ctx,h.data,options);assert.equal(d.action,'restart');assert.equal(d.index,null);
});
test('first planned calcium precedes an equal rarity held star upgrade in tower',()=>{
 const h=starSetup();h.player.vitamins.set('star-piece-v',{level:1});
 const d=c.chooseOfferAction([vitamin,{...starOffer,kind:'upVit'}],h.ctx,h.data,options);assert.equal(d.index,0);
});

for(const tower of [false,true])for(const rarity of [0,1,2,3,4])
test(`held star piece beats a same-rarity move at rarity ${rarity}, tower=${tower}`,()=>{
 const h=starSetup(tower);h.player.vitamins.set('star-piece-v',{level:1,acc:1});
 const d=c.chooseOfferAction([{kind:'upMove',slot:0,rarity,ups:[{key:'count',value:1}]},
  {...starOffer,kind:'upVit',rarity}],h.ctx,h.data,options);
 assert.equal(d.action,'choose');assert.equal(d.index,tower||rarity===4?0:1);
 if(!tower&&rarity!==4)assert.equal(d.reason,'same-rarity-star-piece-priority');
 if(tower)assert.notEqual(d.reason,'same-rarity-star-piece-priority');
});

for(const tower of [false,true])for(const rarity of [0,1,2,3,4])
test(`orange vitamin keeps ordinary score against held star ${rarity}, tower=${tower}`,()=>{
 const h=starSetup(tower);h.player.vitamins.set('star-piece-v',{level:1,acc:1});
 const d=c.chooseOfferAction([{...vitamin,rarity:4},{...starOffer,kind:'upVit',rarity}],h.ctx,h.data,options);
 assert.equal(d.index,0);assert(!['same-rarity-star-piece-priority','higher-rarity-star-piece-priority'].includes(d.reason));
});

for(const [starRarity,otherRarity] of [[0,2],[1,2]])
test(`held star piece preserves ordinary different-rarity choice ${starRarity}/${otherRarity}`,()=>{
 const h=starSetup();h.player.vitamins.set('star-piece-v',{level:1});
 const d=c.chooseOfferAction([{...vitamin,rarity:otherRarity},{...starOffer,kind:'upVit',rarity:starRarity}],h.ctx,h.data,options);
 assert.equal(d.index,0);assert.notEqual(d.reason,'same-rarity-star-piece-priority');
});

for(const tower of [false,true])for(const starRarity of [1,2,3,4])for(let otherRarity=0;otherRarity<starRarity;otherRarity++)
test(`higher-rarity held star wins ${starRarity}/${otherRarity}, tower=${tower}`,()=>{
 const h=starSetup(tower);h.player.vitamins.set('star-piece-v',{level:1,acc:1});
 for(const other of [{...vitamin,rarity:otherRarity},{kind:'upMove',slot:0,rarity:otherRarity,ups:[{key:'count',value:1}]}]){
  const d=c.chooseOfferAction([other,{...starOffer,kind:'upVit',rarity:starRarity}],h.ctx,h.data,options);
  assert.equal(d.action,'choose');assert.equal(d.index,tower?0:1);
  assert.equal(['same-rarity-star-piece-priority','higher-rarity-star-piece-priority'].includes(d.reason),!tower);
 }
});

for(const boundary of ['avoid','disabled','legal','strict','challenge'])
test(`held star piece tie priority does not bypass ${boundary}`,()=>{
 const h=starSetup();h.player.vitamins.set('star-piece-v',{level:1});
 const star={...starOffer,kind:'upVit'},opts={...options};
 if(boundary==='avoid')h.ctx.build.avoidVitamins=['star-piece-v'];
 if(boundary==='disabled')star.disabled=true;
 if(boundary==='legal')opts.legal=i=>i===0;
 if(boundary==='strict')h.ctx.finalReplacement={strictVitamins:{enabled:true,targets:['calcium']}};
 if(boundary==='challenge')h.ctx.build.masteryConstraints={noVitamins:true};
 const d=c.chooseOfferAction([{kind:'upMove',slot:0,rarity:0,ups:[{key:'dmg',value:.4}]},star],h.ctx,h.data,opts);
 assert.equal(d.index,0);
});

test('an unconfigured held star piece keeps ordinary scoring',()=>{
 const h=starSetup(false);h.ctx.build={};h.player.vitamins.set('star-piece-v',{level:1});
 const d=c.chooseOfferAction([vitamin,{...starOffer,kind:'upVit'}],h.ctx,h.data,options);
 assert.equal(d.index,0);
});

for(const tower of [false,true])for(const held of [false,true])
test(`off-plan star piece cannot override five configured vitamins, tower=${tower}, held=${held}`,()=>{
 const h=starSetup(tower);
 h.ctx.build.vitaminRules=['calcium','protein','iron','carbos','hp-up'].map((key,index)=>({key,priority:index+1}));
 if(held)h.player.vitamins.set('star-piece-v',{level:1,acc:1});
 const offers=[vitamin,{...starOffer,kind:held?'upVit':'newVit'}];
 const d=c.chooseOfferAction(offers,h.ctx,h.data,options);
 assert.equal(d.action,'choose');assert.equal(d.index,0);
});

for(const held of [false,true])
test(`final vitamin targets can explicitly request star priority, held=${held}`,()=>{
 const h=starSetup(false);h.ctx.build.vitaminRules=[{key:'calcium',priority:1}];
 h.ctx.finalReplacement={vitamins:{enabled:true,active:true,targets:['calcium','star-piece-v']}};
 if(held)h.player.vitamins.set('star-piece-v',{level:1,acc:1});
 const d=c.chooseOfferAction([vitamin,{...starOffer,kind:held?'upVit':'newVit'}],h.ctx,h.data,options);
 assert.equal(d.action,'choose');assert.equal(d.index,1);
});
test('a stale new-vitamin star card is not a second first-acquisition priority',()=>{
 const h=starSetup();h.player.vitamins.set('star-piece-v',1);
 const d=c.chooseOfferAction([vitamin,starOffer],h.ctx,h.data,options);assert.equal(d.index,0);
});
test('stardust is not the first star piece vitamin',()=>{
 const h=starSetup(false);
 const d=c.chooseOfferAction([vitamin,{...starOffer,vit:'stardust',key:'vstardust'}],h.ctx,h.data,options);assert.equal(d.index,0);
});
test('unconfigured builds keep ordinary benefit scoring',()=>{
 const h=starSetup(false);h.ctx.build={};
 const d=c.chooseOfferAction([vitamin,starOffer],h.ctx,h.data,options);assert.equal(d.index,0);
});
test('first star piece preference is not applied to unrelated choice pages',()=>{
 const h=starSetup(false);
 const d=c.chooseOfferAction([vitamin,starOffer],h.ctx,h.data,{kind:'itemChoice'});assert.equal(d.index,0);
});
test('a preserved custom move remains planned after the host prepares an active fusion build',()=>{
 const h=starSetup(false);
 const final={fusion:{enabled:true,active:true,targets:['fu-t-poison'],pending:{available:true,
  parents:['smog','sludge-bomb'],needLearn:['smog','sludge-bomb'],learningOrder:['smog','sludge-bomb'],relearnSlots:[]}}};
 h.ctx.finalReplacement=final;h.ctx.build=c.finalReplacementBuild(h.ctx.build,final);
 const d=c.chooseOfferAction([{kind:'upMove',slot:0,key:'m247',rarity:2,ups:[{key:'dmg',value:.4}]},starOffer],h.ctx,h.data,options);
 assert.equal(d.index,0);
});
test('tower star item ownership does not create a first-vitamin star exception',()=>{
 const h=starSetup();h.player.items.set('star-piece',1);
 const d=c.chooseOfferAction([vitamin,starOffer],h.ctx,h.data,options);assert.equal(d.index,0);
});
test('first star piece priority does not mutate the saved plan or held vitamins',()=>{
 const h=starSetup(),before=structuredClone(h.ctx.build);
 c.chooseOfferAction([vitamin,starOffer],h.ctx,h.data,options);
 assert.deepEqual(h.ctx.build,before);assert.equal(h.player.vitamins.size,0);
});
test('allowing off-plan vitamins does not grant an off-plan first star piece priority',()=>{
 const h=starSetup();h.ctx.build.vitaminRules=[{key:'calcium',priority:1}];
 const d=c.chooseOfferAction([vitamin,starOffer],h.ctx,h.data,options);assert.equal(d.index,0);
});
test('explicit final vitamin targets keep the first star piece outside their whitelist',()=>{
 const h=starSetup();h.ctx.finalReplacement={vitamins:{enabled:true,active:true,targets:['calcium'],missing:['calcium']}};
 const d=c.chooseOfferAction([vitamin,starOffer],h.ctx,h.data,options);assert.equal(d.index,0);
});

test('confirmed native banishment of a missing required vitamin permits abandonment with evidence',()=>{
 const h=starSetup();h.nativeRun.banished.add('vstar-piece-v');
 const d=c.chooseOfferAction([vitamin],h.ctx,h.data,options);
 assert.equal(d.action,'restart');assert.equal(d.impossibility.confirmed,true);
 assert.deepEqual(d.impossibility.evidence,[{category:'vitamin',key:'star-piece-v',reason:'native-banish',nativeKey:'vstar-piece-v'}]);
});
test('a missing required ordinary move banished by the native game permits abandonment',()=>{
 const h=starSetup();h.player.moves=[];h.nativeRun.banished.add('m247');
 assert.equal(c.chooseOfferAction([vitamin],h.ctx,h.data,options).action,'restart');
});
test('banishing the unique missing signature parent proves that fusion cannot be completed',()=>{
 const h=gengar(45);h.nativeRun.banished.add('m247');
 const d=c.chooseOfferAction([vitamin],h.ctx,h.data,options);
 assert.equal(d.action,'restart');assert(d.impossibility.evidence.some(row=>row.goal==='fu-92'&&row.key==='shadow-ball'));
});
for(const reason of ['native-cannot-learn','native-unlock-closed','plan-unavailable','native-fusion-parent-consumed','not-in-native-available-directory'])
test(`temporary or unproven ${reason} is not proof for abandoning the tower`,()=>{
 const h=starSetup();h.player.moves=[];
 h.ctx.finalReplacement={towerPursuit:{moves:{enabled:true,targets:['shadow-ball'],readiness:[{key:'shadow-ball',state:'unavailable',reason}]}}};
 assert.notEqual(c.chooseOfferAction([vitamin],h.ctx,h.data,options).action,'restart');
});
test('a native card contradicting an old ban marker must not trigger abandonment',()=>{
 const h=starSetup();h.nativeRun.banished.add('vstar-piece-v');
 assert.notEqual(c.chooseOfferAction([starOffer],h.ctx,h.data,options).action,'restart');
});
test('a held completed signature fusion no longer requires its banned parents',()=>{
 const h=setup(92,[['fu-92',5,[247,506]]],['shadow-ball','hex'],['fu-92'],45);
 h.nativeRun.banished.add('m247');
 assert.notEqual(c.chooseOfferAction([vitamin],h.ctx,h.data,options).action,'restart');
});
test('a held maxed vitamin does not become impossible solely because it is banished',()=>{
 const h=starSetup();h.player.vitamins.set('star-piece-v',{level:10});h.nativeRun.banished.add('vstar-piece-v');
 assert.notEqual(c.chooseOfferAction([vitamin],h.ctx,h.data,options).action,'restart');
});
test('new abandonment proof stays within tower upgrade decisions',()=>{
 const h=starSetup(false);h.nativeRun.banished.add('vstar-piece-v');
 assert.notEqual(c.chooseOfferAction([vitamin],h.ctx,h.data,options).action,'restart');
 h.nativeRun.tower={floor:3};
 assert.notEqual(c.chooseOfferAction([vitamin],h.ctx,h.data,{kind:'blessing'}).action,'restart');
});
test('fusion planning can pursue a later compatible recipe offered now without sacrificing the earlier one',()=>{
 const build={sourceType:'custom',allowOffPlan:true,moves:[],moveRules:[]};
 const h=setup(92,[['shadow-ball',1],['smog',1]],['shadow-ball','hex','smog','sludge-bomb'],['fu-92','fu-t-poison'],45,build);
 const settings={finalReplacements:{92:{fusion:{enabled:true,targets:['fu-92','fu-t-poison'],level:1}}}};
 const offered={kind:'newMove',id:byKey.get('sludge-bomb').id,key:'m188',rarity:0};
 const final=c.finalReplacementState(settings,h.nativeRun,h.data,{build,offers:[offered]});
 assert.equal(final.fusion.pending.key,'fu-t-poison');
 assert.equal(final.fusion.assignments.length,2);
 assert.deepEqual(new Set(final.fusion.assignments.flatMap(row=>row.parents)),new Set(['shadow-ball','hex','smog','sludge-bomb']));
 const d=c.chooseOfferAction([offered],{...h.ctx,build,finalReplacement:final},h.data,options);
 assert.equal(d.action,'choose');assert.equal(d.index,0);
});
test('explicit final ordinary targets are protected even before the first desired fusion',()=>{
 const h=setup(151,[['trick-room',8],['barrier',8]],['trick-room','barrier','psybeam'],['fu-t-psychic'],60);
 const settings={finalReplacements:{151:{moves:{enabled:true,targets:['trick-room'],level:1},fusion:{enabled:true,targets:['fu-t-psychic'],level:1}}}};
 const final=c.finalReplacementState(settings,h.nativeRun,h.data);
 assert(!final.fusion.pending.parents.includes('trick-room'));
 assert(final.fusion.pending.parents.includes('psybeam'));
});
test('fusion dispatch rechecks explicit final ordinary targets against a stale pending pair',()=>{
 const h=setup(151,[['trick-room',8],['barrier',8]],['trick-room','barrier','psybeam'],['fu-t-psychic'],60);
 h.ctx.finalReplacement={moves:{enabled:true,targets:['trick-room']},fusion:{enabled:true,active:true,targets:['fu-t-psychic'],
  pending:{ready:true,key:'fu-t-psychic',parents:['trick-room','barrier']}}};
 const d=c.chooseFusionAction([{a:0,b:1,ready:true,r:recipes.find(row=>row.key==='fu-t-psychic')}],h.ctx,h.data);
 assert.equal(d.action,'leave');
});
test('signature metadata without a working native resolver cannot prove impossibility',()=>{
 const h=gengar(45);h.nativeRun.banished.add('m247');h.data.fusionFor=()=>null;
 assert.notEqual(c.chooseOfferAction([vitamin],h.ctx,h.data,options).action,'restart');
});


// A sole legal upgrade must complete the modal even when its combat gain is zero.
function soleUpgradeFixture(tower=true) {
 const h=setup(35,[['fu-t-fairy',5],[ 'fu-35',5],['fu-39',5],['misty-explosion',8]],[],[],120,
  {sourceType:'custom',allowOffPlan:true,vitaminRules:[{key:'pp-up',priority:1}],vitaminPriority:['pp-up']});
 h.player.moves.forEach((m,i)=>{m.mods={count:[12,11,3,0][i],cd:1,dmg:1,area:1,dur:1};});
 h.player.vitamins=new Map([['pp-up',{level:3,acc:3.65}]]);h.player.stats.projectiles=1.825;
 h.nativeRun.rerolls=4;h.nativeRun.skips=7;
 if(!tower)delete h.nativeRun.tower;
 return h;
}
const solePP={kind:'upVit',vit:'pp-up',key:'vpp-up',rarity:2};
for(const tower of [true,false])test(`sole negative-score PP upgrade is taken without consuming searches (tower=${tower})`,()=>{
 const h=soleUpgradeFixture(tower),d=c.chooseOfferAction([solePP],h.ctx,h.data,options);
 assert.equal(d.action,'choose');assert.equal(d.index,0);assert.equal(d.candidates[0].rawScore,-12);
 assert.equal(d.nextHistory.rerollsThisPage,0);
});
test('sole zero-score upgrade is taken rather than searched away',()=>{
 const h=soleUpgradeFixture();h.data.compatibility={capabilities:{vitaminCatalog:false}};
 const d=c.chooseOfferAction([solePP],h.ctx,h.data,options);
 assert.equal(d.action,'choose');assert.equal(d.index,0);assert.equal(d.candidates[0].rawScore,0);
});
test('sole native-disabled PP upgrade is not clicked',()=>{
 const h=soleUpgradeFixture();const d=c.chooseOfferAction([{...solePP,disabled:true}],h.ctx,h.data,options);
 assert.notEqual(d.action,'choose');
});
test('sole explicitly avoided upgrade stays excluded',()=>{
 const h=soleUpgradeFixture();h.ctx.build.avoidVitamins=['pp-up'];
 assert.notEqual(c.chooseOfferAction([solePP],h.ctx,h.data,options).action,'choose');
});
test('multiple negative-score options do not use the sole-card exception',()=>{
 const h=soleUpgradeFixture();const d=c.chooseOfferAction([solePP,{...solePP,rarity:3}],h.ctx,h.data,options);
 assert.notEqual(d.action,'choose');
});
test('sole confirmed zero-benefit speed upgrade still completes the page',()=>{
 const h=soleUpgradeFixture();h.player.moves=[{def:{key:'fast',arch:'bolt',cls:'special',dmg:10,cd:1,count:1},mods:{cd:1},level:8}];
 h.player.stats.attackSpeed=100;h.player.vitamins=new Map([['ether',{level:2}]]);
 h.ctx.build={};h.ctx.finalReplacement=undefined;
 const d=c.chooseOfferAction([{kind:'upVit',vit:'ether',key:'vether',rarity:0}],h.ctx,h.data,options);
 assert.equal(d.action,'choose');assert.equal(d.index,0);
});
