import fs from 'node:fs';import {openSeason3Fixture}from './source/test/season3-0913-browser-fixture.mjs';
const f=await openSeason3Fixture('shiny-pools');
try{const result=await f.page.evaluate(()=>{const b=__PB_BRIDGE,pools=[];
 for(const biome of b.biomes.filter(b=>__PB_BRIDGE.biomeLive(b.id)))for(const stage of [1,2,3]){
  const director=Object.create(__M2_TYPES.director.prototype);director.run={biome,stage};director.rng={shuffle:rows=>rows};director.buildPool();
  pools.push({biome:biome.id,stage,ids:[...new Set(director.pool.filter(mon=>b.data.hasAnimated(mon.id)).map(mon=>mon.id))]});
 }
 return {pools,biomes:b.biomes,roster:b.roster,pokemon:b.data.pokemon.filter(mon=>b.data.hasSprite(mon.id)).map(mon=>({...mon,animated:b.data.hasAnimated(mon.id),root:b.data.root(mon.id)?.id})),captureFeatures:b.captureFeatures};});
 fs.writeFileSync(new URL('evidence/native-shiny-pools.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify({pools:result.pools.length,species:result.pokemon.length,johto:result.pools.filter(p=>['encina','iris'].includes(p.biome)).map(p=>({biome:p.biome,stage:p.stage,size:p.ids.length})),errors:f.errors}));
}finally{await f.context.close();}
