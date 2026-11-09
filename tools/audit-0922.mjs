import fs from 'node:fs';
import crypto from 'node:crypto';
import {nativeSyntaxIndex} from '../source/src/native-adaptation.mjs';
import {nativeMemberShape,prepareNativeMemberAliases} from '../source/src/compatibility.mjs';
const root=new URL('../',import.meta.url);
const load=version=>{const dir=new URL(`evidence/public-${version}/`,root),manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',dir)));return manifest.records.filter(r=>r.name.endsWith('.js')).map(r=>({...r,source:fs.readFileSync(new URL(r.name,dir),'utf8')})).map(r=>({...r,index:nativeSyntaxIndex(r.source)}));};
const old=load('0913'),current=load('0922');
// AST serialization ignores emitted identifier names, including contextual
// keywords used as bindings. It preserves public properties, literals and flow.
function canonical(n,parent,key){if(Array.isArray(n))return n.map(v=>canonical(v,parent,key));if(!n||typeof n!=='object')return n;
 const out={};for(const [k,v]of Object.entries(n)){if(['start','end','loc','raw'].includes(k))continue;if(n.type==='Identifier'&&k==='name'){out[k]=parent&&((parent.type==='MemberExpression'&&key==='property'&&!parent.computed)||(['Property','MethodDefinition'].includes(parent.type)&&key==='key'&&!parent.computed))&&!v.startsWith('$')?v:'@';}else out[k]=canonical(v,n,k);}return out;}
const anchors=[['tickLava','tickEruption'],['skyDive','starArms'],['inLava','distToFissure'],['tickCollapse','tickCrystals'],['tickBall','tickBlades'],['raisePylons','dropOrb'],['enterPast','spawnClock'],['tickFlight','tickWake'],['rainbow','sunnyDay'],['nearEntrance'],['spawnShiny','classicPool']];
const rows=[];
for(const a of anchors){const find=modules=>modules.flatMap(r=>r.index.classes.filter(c=>a.every(n=>r.index.methods.some(m=>m.owner===c.symbol&&m.name===n))).map(c=>({r,c})));const before=find(old),after=find(current);if(before.length!==1||after.length!==1)throw Error('ambiguous '+a);
 const b=before[0],c=after[0];for(const m of b.r.index.methods.filter(m=>m.owner===b.c.symbol)){const next=c.r.index.methods.find(n=>n.owner===c.c.symbol&&n.name===m.name);if(!next)continue;const prevCode=b.r.source.slice(m.start,m.end),nextCode=c.r.source.slice(next.start,next.end);rows.push({anchors:a,method:m.name,beforeOwner:b.c.symbol,afterOwner:c.c.symbol,beforeShape:nativeMemberShape(prevCode),afterShape:nativeMemberShape(nextCode),astEquivalent:JSON.stringify(canonical(m.node))===JSON.stringify(canonical(next.node)),before:prevCode,after:nextCode});}}
const beforeMain=old.find(r=>r.name.startsWith('main-Dvcm')),afterMain=current.find(r=>r.name.startsWith('main-BDr'));
const aliases=prepareNativeMemberAliases(beforeMain.source,undefined,{partial:true}),player=aliases.groups.find(g=>g.ownerId==='player'),rage=player.members.find(m=>m.logical==='rageBonus');
const prev=beforeMain.index.methods.find(m=>m.owner===player.symbol&&m.name===rage.actual),newPlayer=prepareNativeMemberAliases(afterMain.source,undefined,{partial:true}).groups.find(g=>g.ownerId==='player');
const candidates=afterMain.index.methods.filter(m=>m.owner===newPlayer.symbol&&JSON.stringify(canonical(m.node))===JSON.stringify(canonical(prev.node)));
const audit={checkedAt:new Date().toISOString(),rows,rage:{before:beforeMain.source.slice(prev.start,prev.end),candidates:candidates.map(m=>({actual:m.name,shape:nativeMemberShape(afterMain.source.slice(m.start,m.end)),code:afterMain.source.slice(m.start,m.end)}))}};
fs.writeFileSync(new URL('docs/native-0922-method-audit.json',root),JSON.stringify(audit,null,2));
console.log(JSON.stringify({changed:rows.filter(r=>r.beforeShape!==r.afterShape).map(({anchors,method,astEquivalent,beforeShape,afterShape})=>({anchors,method,astEquivalent,beforeShape,afterShape})),rage:audit.rage},null,2));
