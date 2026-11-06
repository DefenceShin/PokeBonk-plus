// Node maintenance/runner adapter for the one reviewed controller registry.
// The browser and host receive source text only; no filesystem/account access.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export function validateControllerManifest(value) {
  const keys=(object,expected)=>object&&typeof object==='object'&&!Array.isArray(object)&&
    Object.keys(object).sort().join('|')===expected.slice().sort().join('|');
  if(!keys(value,['schemaVersion','entries'])||value.schemaVersion!==1||!Array.isArray(value.entries)||value.entries.length<3||value.entries.length>64)
    throw Error('Invalid controller source registry');
  const names=new Set(),orders=new Set(),entries=value.entries.map(row=>{
    if(!keys(row,['name','scope','loadOrder'])||typeof row.name!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(row.name)||
      !['shared','isolated'].includes(row.scope)||!Number.isInteger(row.loadOrder)||row.loadOrder<0||row.loadOrder>=value.entries.length||names.has(row.name)||orders.has(row.loadOrder))
      throw Error('Invalid or duplicate controller source entry');
    names.add(row.name);orders.add(row.loadOrder);return Object.freeze({...row});
  });
  for(const name of ['policy','pilot','compatibility'])if(!names.has(name))throw Error('Missing core controller source: '+name);
  if(entries.filter(row=>row.scope==='shared').some(row=>row.loadOrder>Math.min(...entries.filter(row=>row.scope==='isolated').map(row=>row.loadOrder))))
    throw Error('Shared controller sources must precede isolated features');
  return Object.freeze({schemaVersion:1,entries:Object.freeze(entries)});
}
export async function readControllerManifest(root=new URL('../',import.meta.url)) {
  return validateControllerManifest(JSON.parse(await readFile(new URL('data/controller-sources.json',root),'utf8')));
}
export function browserControllerSource(text){return text.replace(/^import[^;]*;\s*/gm,'').replace(/^export /gm,'');}
export async function readControllerPackage(root=new URL('../',import.meta.url)) {
  const manifestText=await readFile(new URL('data/controller-sources.json',root),'utf8'),
    manifest=validateControllerManifest(JSON.parse(manifestText)),hash=createHash('sha256').update(manifestText).update('\0'),sources=new Map();
  const loaded=await Promise.all(manifest.entries.map(async row=>[row.name,await readFile(new URL('src/'+row.name+'.mjs',root))]));
  for(const[name,bytes]of loaded){
    if(bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf)throw Error('Controller sources must use UTF-8 without BOM: '+name);
    hash.update(bytes);sources.set(name,bytes.toString('utf8'));
  }
  return {manifest,manifestText,sources,revision:hash.digest('hex').slice(0,12),
    sharedSource:manifest.entries.filter(row=>row.scope==='shared').sort((a,b)=>a.loadOrder-b.loadOrder).map(row=>browserControllerSource(sources.get(row.name))).join('\n')};
}
export function controllerResourceProps(manifest){
  const entries=validateControllerManifest(manifest).entries;
  return '<!-- Generated from data/controller-sources.json; edit that registry and regenerate. -->\n<Project>\n  <ItemGroup>\n'+
    entries.map(row=>`    <EmbeddedResource Include="..\\src\\${row.name}.mjs" LogicalName="payload.${row.name}.mjs" />`).join('\n')+
    '\n    <EmbeddedResource Include="..\\data\\controller-sources.json" LogicalName="payload.controller-sources.json" />\n  </ItemGroup>\n</Project>\n';
}
