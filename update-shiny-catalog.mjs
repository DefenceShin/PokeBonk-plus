import fs from 'node:fs';import assert from 'node:assert/strict';
const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url),'utf8')),native=read('evidence/native-shiny-pools.json'),catalog=read('source/data/unlock-catalog.json'),local=read('source/data/localization.json'),manifest=read('evidence/public-0913/manifest.json'),main=manifest.records.find(r=>r.name.startsWith('main-Dvcm'));
const source=fs.readFileSync(new URL('evidence/public-0913/'+main.name,import.meta.url),'utf8'),eclipse=[[92,41,96],[93,42,96],[94,93,97]];
assert.ok(source.includes('pool:'+JSON.stringify(eclipse)),'current native eclipse definition');
const records=new Map(native.pokemon.map(mon=>[mon.id,{id:mon.id,family:mon.root,name:local.pokemon?.[mon.id]||mon.name,sources:[]}])),add=(id,s)=>records.get(id)?.sources.push({...s,live:true}),maps=native.biomes.filter(b=>native.pools.some(p=>p.biome===b.id));
for(const pool of native.pools){for(const id of pool.ids)add(id,{kind:'wild',biome:pool.biome,stage:pool.stage});
 if(pool.ids.length)for(const mon of native.pokemon.filter(m=>m.id<=151&&!m.legendary&&!m.mythical&&m.root===m.id&&m.animated))add(mon.id,{kind:'missing-base-family',biome:pool.biome,stage:pool.stage,ordinaryOnly:true,requiresUncollectedFamily:true,requiresNonemptyRegionalPool:true,requiresRegionalMissingFamiliesExhausted:true});
 for(const id of eclipse[pool.stage-1])if(records.has(id))add(id,{kind:'eclipse',biome:pool.biome,stage:pool.stage});
}
for(const biome of maps){for(const id of biome.sanctuary?.legendaries||biome.legendaries||[])add(id,{kind:'sanctuary',biome:biome.id,stage:biome.sanctuary?4:3});
 // Use the existing conditional legendary API for actual per-account readiness.
 for(const member of native.roster){const mon=native.pokemon.find(m=>m.id===member.id);if(mon?.legendary||mon?.mythical||member.rank==='legendary')add(member.id,{kind:member.id===150?'mewtwo-event':'league-legendary',biome:biome.id,stage:member.id===150?2:1});}
}
const evidence={gameVersion:'0.9.13',sourceHash:main.sha256,sourceURL:main.url,description:'Current native Director.buildPool plus spawnShiny, classicPool, eclipse and conditional legendary routes; random spawn/save not guaranteed'};
const targets=new Map(catalog.targets.map(t=>[t.id,t])),owned=(field,value)=>({kind:'owned',field,value}),all=conditions=>({kind:'all',conditions}),any=conditions=>({kind:'any',conditions}),members=new Set(native.roster.map(r=>r.id));
for(const mon of native.pokemon){const row=records.get(mon.id),available=row.sources.length>0,base={requirements:[],dependencies:[],sources:row.sources,availability:{state:available?'available':'unavailable',reason:available?'按当前原生来源与账号资格安排':'当前已核对的常规地图没有此异色来源'},executable:available,evidence};
 targets.set('shiny:'+mon.id,{...base,id:'shiny:'+mon.id,category:'shiny',key:String(mon.id),nativeId:mon.id,name:row.name+'异色',completion:owned('shinies',mon.id),action:{kind:'capture',species:mon.id,sourceKind:'shiny'}});
 const wild=row.sources.filter(s=>s.kind==='wild').map(s=>({...s,kind:'classic'}));
 targets.set('appearance:classic:'+mon.id,{...base,id:'appearance:classic:'+mon.id,category:'appearance',key:'classic:'+mon.id,nativeId:mon.id,name:row.name+'经典异色',selectable:false,sources:wild,completion:owned('classics',mon.id),requirements:[{kind:'classic-uncovered',species:mon.id,members:members.has(mon.id)?[mon.id]:native.roster.filter(r=>native.pokemon.find(m=>m.id===r.id)?.root===mon.root).map(r=>r.id)}],action:wild.length?{kind:'capture',species:mon.id,sourceKind:'classic'}:{kind:'manual'},manualReason:'当前常规怪物池没有此经典异色；保留目标等待原生来源',executable:wild.length>0,availability:{state:wild.length?'available':'unavailable'}});
}
for(const member of native.roster){const mon=native.pokemon.find(m=>m.id===member.id),family=native.pokemon.filter(m=>m.root===mon.root&&(m.id===member.id||!members.has(m.id))).map(m=>m.id),name=local.pokemon?.[member.id]||mon.name;
 for(const [key,field,label]of [['shiny','shinies','异色'],['classic','classics','经典异色']]){const id=`appearance:skin-${key}:${member.id}`;
  targets.set(id,{id,category:'appearance',key:`skin-${key}:${member.id}`,nativeId:member.id,name:name+label+'外观',requirements:[],dependencies:['characters:'+member.id],sources:[],completion:all([owned('league',member.id),any(family.map(id=>owned(field,id)))]),action:{kind:key==='shiny'?'shiny-family':'classic-family',family:mon.root,species:family},look:{member:member.id,key},executable:true,evidence});
 }
 const id=`appearance:skin-spectral:${member.id}`;targets.set(id,{id,category:'appearance',key:`skin-spectral:${member.id}`,nativeId:member.id,name:name+'幽灵外观',requirements:[],dependencies:['characters:'+member.id,'appearance:skin:spectral'],sources:[],completion:all([owned('league',member.id),owned('cosmetics','skin:spectral')]),action:{kind:'spectral-family',species:[member.id]},look:{member:member.id,key:'spectral'},executable:true,evidence});
}
catalog.targets=[...targets.values()];catalog.rules.lookLeagueMemberIds=[...members];
// The family exclusion table is part of classicPool's current ownership rule.
catalog.rules.classicSpeciesEligibility=native.pokemon.map(mon=>({species:mon.id,members:members.has(mon.id)?[mon.id]:native.roster.filter(r=>native.pokemon.find(m=>m.id===r.id)?.root===mon.root).map(r=>r.id)}));
fs.writeFileSync(new URL('source/data/unlock-catalog.json',import.meta.url),JSON.stringify(catalog));
fs.writeFileSync(new URL('source/data/shiny-catalog.json',import.meta.url),JSON.stringify({schemaVersion:1,...evidence,species:[...records.values()]}));
console.log('Updated '+records.size+' native shiny records and '+members.size+' wardrobe families');
