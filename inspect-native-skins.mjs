import fs from 'node:fs';
import {nativeSyntaxIndex} from './source/src/native-adaptation.mjs';
import {openSeason3Fixture} from './source/test/season3-0913-browser-fixture.mjs';
const dir=new URL('evidence/public-0913/',import.meta.url),manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',dir))),entry=manifest.records.find(r=>r.name.startsWith('defineProperty-')),source=fs.readFileSync(new URL(entry.name,dir),'utf8');
const declarations=nativeSyntaxIndex(source).ast.body.flatMap(n=>n.type==='VariableDeclaration'?n.declarations:[]),expressions={};
for(const name of ['Bi','Vi'])for(const row of declarations.find(n=>n.id.name===name).init.elements){const id=row.elements[0].value;for(const [level,index]of [[1,5],[2,10]])expressions[id+':'+level]=source.slice(row.elements[index].start,row.elements[index].end);}
const start=declarations.find(n=>n.id.name==='wi').start,end=declarations.find(n=>n.id.name==='B').start;
const helpers=Object.fromEntries(declarations.filter(n=>n.start>=start&&n.start<end).map(n=>[n.id.name,source.slice(n.start,n.end)]));
const f=await openSeason3Fixture('native-skins');
try{const runtime=await f.page.evaluate(()=>({looks:__SKIN_NATIVE.looks.map(l=>({...l,rule:{...l.rule,vSource:String(l.rule.v)}})),quests:__SKIN_NATIVE.quests.filter(q=>q.look),legendary:__SKIN_NATIVE.legendary.map(l=>({...l,rule:{...l.rule,vSource:String(l.rule.v)}})),treasures:__SKIN_NATIVE.treasures,available:String(__SKIN_NATIVE.lookAvailable),classic:String(__SKIN_NATIVE.classicAvailable)}));
 const result={source:entry,helpers,looks:runtime.looks.map(l=>({...l,rule:{...l.rule,nativeExpression:expressions[l.member+':'+l.n]}})),quests:runtime.quests,legendary:runtime.legendary,treasures:runtime.treasures,available:runtime.available,classic:runtime.classic};
 fs.writeFileSync(new URL('evidence/native-skins.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify({looks:result.looks.length,legendary:result.legendary.length,expressions:[...new Set(result.looks.map(l=>l.rule.nativeExpression))],errors:f.errors},null,2));
}finally{await f.context.close();}
