import fs from 'node:fs';import assert from 'node:assert/strict';import {nativeSyntaxIndex}from './source/src/native-adaptation.mjs';
const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url))),native=read('evidence/native-skins.json'),catalog=read('source/data/unlock-catalog.json'),local=read('source/data/localization.json');
const source=fs.readFileSync(new URL('evidence/public-0913/'+native.source.name,import.meta.url),'utf8'),defs=nativeSyntaxIndex(source).ast.body.flatMap(n=>n.declarations||[]),get=name=>defs.find(n=>n.id?.name===name).init;
const factory=get('Yi').body.elements.map(n=>source.slice(n.elements[1].start,n.elements[1].end));
assert.deepEqual(factory,['M(1,t=>t.r.biome===e&&t.r.tier>=2&&Pi(100)(t))','{kind:`max`,goal:Gi,v:e=>e.r.mode===`endless`&&!e.coop?Math.floor(e.r.time):0}','{kind:`bits`,goal:6,v:e=>wi(e)&&!e.coop&&e.r.tier>=2&&e.r.time<1200?qi[e.r.biome]??0:0}']);assert.equal(get('Gi').value,2400);
const bitTargets=get('qi').properties.map(p=>({bit:p.value.value,biome:p.key.name||p.key.value}));assert.deepEqual(bitTargets,[{bit:1,biome:'forest'},{bit:2,biome:'desert'},{bit:4,biome:'coast'},{bit:8,biome:'glacier'},{bit:16,biome:'canela'},{bit:32,biome:'cave'},{bit:64,biome:'encina'},{bit:128,biome:'iris'}]);
const maps=new Map(get('Xi').elements.map(row=>[row.elements[0].value,row.elements[1].quasis[0].value.cooked])),targets=new Map(catalog.targets.map(t=>[t.id,t])),owned=(field,value)=>({kind:'owned',field,value});
for(const l of native.legendary){const id=l.member,n=l.n,key=`lk${id}_${n}`,counter=`lk:${id}:${n}`,cosmetic=`look:${id}:${n}`,kind='l'+(n-4),q=native.quests.find(q=>q.id===key);assert.equal(q.goal,l.rule.goal);
 const route={member:id,mode:n===6?'endless':'standard',minTier:n===6?0:2,singleRun:n===6,metric:n===6?'maxTime':'wins',allowCoop:false,
  ...(n===5?{biome:maps.get(id),constraints:{maxHits:100}}:n===7?{bitTargets,constraints:{maxTime:1200}}:{})};
 const name=(local.pokemon[id]||'#'+id)+' · 传说外观'+(n-4),label=n===5?'单人标准噩梦：指定地图胜利，受击不超过100次':n===6?'单人无尽生存40分钟':'单人标准噩梦：在6张不同地图分别于20分钟以内获胜',
  look={member:id,level:n,key:kind,style:l.style,palette:l.pal,questId:key,cosmeticKey:cosmetic,rule:{...l.rule,nativeExpression:factory[n-5]}},evidence={gameVersion:'0.9.13',sourceHash:native.source.sha256,sourceURL:native.source.url};
 targets.set('achievements:'+key,{id:'achievements:'+key,category:'achievements',key,nativeId:key,name,counter,goal:q.goal,requirements:[owned('league',id),{kind:'counter',counter,goal:q.goal,label,mastery:route}],completion:owned('quests',key),action:{kind:'claim-quest',key},look,reward:{dust:q.reward,cosmetics:[cosmetic]},automation:{earningSupported:true,reason:label},executable:true,evidence});
 const tid=`appearance:skin-${kind}:${id}`;targets.set(tid,{id:tid,category:'appearance',key:`skin-${kind}:${id}`,nativeId:cosmetic,name,requirements:[],dependencies:['characters:'+id,'achievements:'+key],completion:{kind:'all',conditions:[owned('league',id),owned('cosmetics',cosmetic)]},action:{kind:'claim-quest',key},look,executable:true,evidence});
}
catalog.targets=[...targets.values()];catalog.wardrobeLookKinds=[...(catalog.wardrobeLookKinds||[]).filter(k=>!/^l[123]$/.test(k.key)),...[1,2,3].map(n=>({key:'l'+n,name:'传说外观'+n,members:[...new Set(native.legendary.filter(l=>l.n===n+4).map(l=>l.member))]}))];
catalog.skinReview.legendaryLooks=33;delete catalog.skinReview.legendaryLooksPending;
fs.writeFileSync(new URL('source/data/unlock-catalog.json',import.meta.url),JSON.stringify(catalog));console.log('Compiled 33 native legendary outfit challenges');
