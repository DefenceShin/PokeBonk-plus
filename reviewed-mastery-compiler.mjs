// Adapted from historical reviewed mastery compiler; build-time only, never executes native predicates.
function masterySyntax(source) {
  if(typeof source!=='string'||source.length>12000)throw Error('mastery-source-range');
  const tokens=[];let at=0,depth=0;
  while(at<source.length){
    const rest=source.slice(at);let match;
    if((match=/^\s+|^\/\/[^\n]*(?:\n|$)|^\/\*[\s\S]*?\*\//.exec(rest))){at+=match[0].length;continue;}
    if((match=/^[A-Za-z_$][\w$]*/.exec(rest)))tokens.push(['id',match[0]]);
    else if((match=/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i.exec(rest))){const number=Number(match[0]);if(!Number.isFinite(number))throw Error('mastery-number');tokens.push(['number',number]);}
    else if((match=/^([`'"])([A-Za-z0-9_:-]*)\1/.exec(rest)))tokens.push(['string',match[2]]);
    else if((match=/^(?:===|!==|=>|\.\.\.|\?\.|\?\?|&&|\|\||>=|<=|[()[\]{}.,:;?!=+*/<>-])/.exec(rest)))tokens.push(['token',match[0]]);
    else throw Error('mastery-token');
    at+=match[0].length;if(tokens.length>4000)throw Error('mastery-token-range');
  }
  let pos=0;const peek=(value,offset=0)=>tokens[pos+offset]?.[1]===value,
    take=value=>{if(!peek(value))throw Error('mastery-expected:'+value);return tokens[pos++];},
    identifier=()=>{if(tokens[pos]?.[0]!=='id')throw Error('mastery-binding');return tokens[pos++][1];},
    precedence={'??':2,'||':3,'&&':4,'===':5,'!==':5,'>':6,'<':6,'>=':6,'<=':6,'+':7,'-':7,'*':8,'/':8};
  function arrowStart(){
    if(tokens[pos]?.[0]==='id'&&peek('=>',1))return true;
    if(!peek('('))return false;let level=0;
    for(let i=pos;i<tokens.length;i++){if(tokens[i][1]==='(')level++;if(tokens[i][1]===')'&&!--level)return tokens[i+1]?.[1]==='=>';}return false;
  }
  function expression(min=0){
    if(++depth>64)throw Error('mastery-depth');let value;
    if(arrowStart()){
      const params=[];if(peek('(')){take('(');while(!peek(')')){const rest=peek('...');if(rest)take('...');const name=identifier(),initial=peek('=')?(take('='),expression()):null;
        params.push({name,rest,initial});if(!peek(','))break;take(',');}take(')');}else params.push({name:identifier(),rest:false,initial:null});
      take('=>');let body;
      if(peek('{')){take('{');const declarations=[];
        if(peek('let')){take('let');do{if(declarations.length)take(',');const name=identifier();take('=');declarations.push({name,value:expression()});}while(peek(','));take(';');}
        take('return');body=['block',declarations,expression()];if(peek(';'))take(';');take('}');
      }else body=expression();value=['arrow',params,body];
    }else if(peek('!')||peek('-')){const op=tokens[pos++][1];value=['unary',op,expression(9)];}
    else if(peek('(')){take('(');value=expression();take(')');}
    else if(peek('{')){take('{');const properties=[];while(!peek('}')){const key=tokens[pos++];if(!key||!['id','number','string'].includes(key[0]))throw Error('mastery-property');take(':');properties.push([String(key[1]),expression()]);if(!peek(','))break;take(',');}take('}');value=['object',properties];}
    else if(peek('[')){take('[');const values=[];while(!peek(']')){values.push(expression());if(!peek(','))break;take(',');}take(']');value=['array',values];}
    else {const token=tokens[pos++];if(!token||!['id','number','string'].includes(token[0]))throw Error('mastery-value');value=token;}
    while(pos<tokens.length){
      if(peek('(')){take('(');const args=[];while(!peek(')')){args.push(expression());if(!peek(','))break;take(',');}take(')');value=['call',value,args];continue;}
      if(peek('.')||peek('?.')){const optional=tokens[pos++][1]==='?.';value=['member',value,identifier(),optional];continue;}
      if(peek('[')){take('[');value=['index',value,expression()];take(']');continue;}
      if(peek('?')&&min<=1){take('?');const yes=expression();take(':');value=['conditional',value,yes,expression(1)];continue;}
      const op=tokens[pos]?.[1],power=precedence[op];if(power==null||power<min)break;pos++;value=['binary',op,value,expression(power+1)];
    }
    depth--;return value;
  }
  const result=expression();if(pos!==tokens.length)throw Error('mastery-trailing');return result;
}
function masteryCanonical(tree,roles={},bindings=[]) {
  let serial=bindings.length;
  function visit(node,scope){
    const [kind,...args]=node;
    if(kind==='id')return scope.has(args[0])?['local',scope.get(args[0])]:Object.hasOwn(roles,args[0])?['role',roles[args[0]]]:args[0]==='Math'?['intrinsic','Math']:['free',args[0]];
    if(kind==='number'||kind==='string')return node;
    if(kind==='arrow'){
      const local=new Map(scope),params=args[0],names=new Set();
      for(const param of params){if(names.has(param.name))throw Error('mastery-duplicate-binding');names.add(param.name);local.set(param.name,serial++);}
      return ['arrow',params.map(param=>[param.rest,param.initial?visit(param.initial,local):null]),visit(args[1],local)];
    }
    if(kind==='block'){
      const local=new Map(scope),names=new Set();for(const row of args[0]){if(names.has(row.name)||local.has(row.name))throw Error('mastery-duplicate-local');names.add(row.name);local.set(row.name,serial++);}
      return ['block',args[0].map(row=>visit(row.value,local)),visit(args[1],local)];
    }
    if(kind==='object')return ['object',args[0].map(([key,value])=>[key,visit(value,scope)])];
    if(kind==='array')return ['array',args[0].map(value=>visit(value,scope))];
    if(kind==='call')return ['call',visit(args[0],scope),args[1].map(value=>visit(value,scope))];
    if(kind==='member')return ['member',visit(args[0],scope),args[1],args[2]];
    if(kind==='index')return ['index',visit(args[0],scope),visit(args[1],scope)];
    if(kind==='unary')return ['unary',args[0],visit(args[1],scope)];
    if(kind==='binary')return ['binary',args[0],visit(args[1],scope),visit(args[2],scope)];
    if(kind==='conditional')return ['conditional',...args.map(value=>visit(value,scope))];
    throw Error('mastery-node');
  }
  return visit(tree,new Map(bindings.map((name,index)=>[name,index])));
}
// Complete reviewed factories, with semantic dependency names rather than
// compressed aliases. Unknown statements, globals or changed predicates fail.
const MASTERY_FACTORIES={
  victory:'e => !e.r.mode || e.r.mode === `standard` ? e.r.victory : !1',
  damageShare:'(e,t)=>{let n=e.r.build?.moves??[],r=n.reduce((e,t)=>e+(t.dmg>0?t.dmg:0),0),i=n.reduce((e,n)=>e+(n.k===t||n.p?.includes(t)?Math.max(0,n.dmg):0),0);return r>0?i/r:0}',
  biomeBits:'{forest:1,desert:2,coast:4,glacier:8}',
  wins:'(e,t=()=>!0)=>({kind:`add`,goal:e,v:e=>victory(e)&&t(e)?1:0})',
  tier:'(e,t=()=>!0)=>wins(1,n=>n.r.tier>=e&&t(n))',
  damage:'(e,t,n=0,r=()=>!0)=>wins(1,i=>i.r.tier>=n&&damageShare(i,e)>=t&&r(i))',
  allBiomes:'()=>({kind:`bits`,goal:4,v:e=>victory(e)?biomeBits[e.r.biome]??0:0})',
  biome:'(e,t=0)=>wins(1,n=>n.r.biome===e&&n.r.tier>=t)',
  counter:'(e,t)=>({kind:`add`,goal:t,v:t=>Math.max(0,Math.floor(t.d[e]??0))})',
  killsAdd:'e=>({kind:`add`,goal:e,v:e=>Math.max(0,e.r.kills)})',
  killsMax:'e=>({kind:`max`,goal:e,v:e=>Math.max(0,e.r.kills)})',
  finalSpecies:'e=>e.r.finalSpecies||e.r.species',
  species:'(...e)=>t=>e.includes(finalSpecies(t))',
  maxSpecies:'e=>t=>(t.r.clearSpecies||finalSpecies(t))<=e',
  clearSpecies:'e=>t=>(t.r.clearSpecies||finalSpecies(t))===e',
  hitsLimit:'e=>t=>!t.coop&&hits(t)<=e',
  johtoBits:'{encina:1,iris:2}',
  johtoBiomes:'()=>({kind:`bits`,goal:2,v:e=>victory(e)?johtoBits[e.r.biome]??0:0})',
  hits:'e=>e.r.end?.hits??1/0',
  eevee:'e=>({kind:`bits`,goal:3,v:t=>victory(t)&&t.r.tier>=e?({134:1,135:2,136:4}[finalSpecies(t)]??0):0})',
};
const MASTERY_ROLE_NAMES=Object.fromEntries(Object.keys(MASTERY_FACTORIES).map(role=>[role,role])),
  MASTERY_TEMPLATES=Object.fromEntries(Object.entries(MASTERY_FACTORIES).map(([role,text])=>[role,JSON.stringify(masteryCanonical(masterySyntax(text),MASTERY_ROLE_NAMES))])),
  masteryContexts=new WeakMap();
export function analyzeReviewedMasteryHelpers(helpers={}) {
  const entries=[];
  if(helpers&&typeof helpers==='object'&&!Array.isArray(helpers))for(const [name,source]of Object.entries(helpers).slice(0,100)){
    if(!/^[A-Za-z_$][\w$]*$/.test(name)||typeof source!=='string')continue;
    const match=/^\s*([\w$]+)\s*=\s*([\s\S]*)$/.exec(source);if(!match||match[1]!==name)continue;
    try{entries.push({name,tree:masterySyntax(match[2])});}catch{}
  }
  const roles={},found={};
  for(let pass=0;pass<Object.keys(MASTERY_FACTORIES).length;pass++){
    let changed=false;
    for(const [role,template]of Object.entries(MASTERY_TEMPLATES)){
      if(found[role])continue;
      const matches=entries.filter(entry=>{try{return JSON.stringify(masteryCanonical(entry.tree,roles))===template;}catch{return false;}});
      if(matches.length===1){roles[matches[0].name]=role;found[role]=matches[0].name;changed=true;}
    }
    if(!changed)break;
  }
  const context=Object.freeze({supported:Object.keys(found).length===Object.keys(MASTERY_FACTORIES).length,roles:Object.freeze({...found})});
  masteryContexts.set(context,{roles,trees:Object.fromEntries(Object.entries(found).map(([role,name])=>[role,entries.find(entry=>entry.name===name).tree]))});return context;
}

// Recognize complete reviewed predicates, never translated descriptions. The
// saved native lk counter remains the authoritative completion source.
export function reviewedMasteryEarning(look = {}, helpers = {}) {

  try{
    const context=masteryContexts.get(helpers)||masteryContexts.get(analyzeReviewedMasteryHelpers(helpers)),{roles,trees}=context,
      rule=look.rule||{},tree=masterySyntax(rule.nativeExpression),base={member:look.member,mode:'standard',minTier:0,singleRun:false},
      numeric=node=>node?.[0]==='number'&&Number.isFinite(node[1])?node[1]:null,
      integer=node=>Number.isSafeInteger(numeric(node))&&numeric(node)>=0?numeric(node):null,
      text=node=>node?.[0]==='string'?node[1]:null,
      role=node=>node?.[0]==='call'&&node[1][0]==='id'?roles[node[1][1]]:null,
      same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),
      matches=(node,pattern)=>same(masteryCanonical(node,roles),masteryCanonical(masterySyntax(pattern),MASTERY_ROLE_NAMES)),
      // Captures are scalar syntax nodes, never evaluated expressions.
      capture=(node,pattern)=>{
        const values={},expected=masteryCanonical(masterySyntax(pattern),MASTERY_ROLE_NAMES),actual=masteryCanonical(node,roles);
        const walk=(a,b)=>{if(Array.isArray(a)&&a[0]==='free'&&/^CAP_/.test(a[1])){if(!Array.isArray(b)||!['number','string'].includes(b[0]))return false;
          if(Object.hasOwn(values,a[1])&&!same(values[a[1]],b))return false;values[a[1]]=b;return true;}
          return Array.isArray(a)?Array.isArray(b)&&a.length===b.length&&a.every((value,index)=>walk(value,b[index])):a===b;};
        return walk(expected,actual)?Object.fromEntries(Object.entries(values).map(([key,value])=>[key,value[1]])):null;
      },
      factoryValue=(name)=>{const factory=trees[name];if(factory?.[0]!=='arrow'||factory[2]?.[0]!=='object')return false;
        const value=factory[2][1].find(([key])=>key==='v')?.[1],bindings=factory[1].map(param=>param.name);
        return !!value&&same(masteryCanonical(value,roles,bindings),masteryCanonical(masterySyntax(rule.vSource),roles,bindings));},
      validRule=(kind,goal,valueFactory)=>rule.kind===kind&&rule.goal===goal&&Number.isSafeInteger(goal)&&goal>0&&factoryValue(valueFactory);
    const predicate=node=>{
      if(!node)return {};const type=role(node),args=node?.[2];let found;
      if(type==='species'&&args.length&&args.every(arg=>integer(arg)>0))return {finalSpecies:args.map(integer)};
      if(type==='maxSpecies'&&args.length===1&&integer(args[0])>0)return {maxFinalSpecies:integer(args[0]),finalSpeciesAtClear:true};
      if(type==='clearSpecies'&&args.length===1&&integer(args[0])>0)return {finalSpecies:[integer(args[0])],finalSpeciesAtClear:true};
      if(type==='hitsLimit'&&args.length===1&&integer(args[0])!==null)return {maxHits:integer(args[0])};
      if((found=capture(node,'e=>species(CAP_SPECIES)(e)&&hitsLimit(CAP_HITS)(e)')))return {finalSpecies:[found.CAP_SPECIES],maxHits:found.CAP_HITS};
      if((found=capture(node,'e=>e.r.biome===CAP_BIOME&&e.r.tier>=CAP_TIER&&species(CAP_SPECIES)(e)')))return {finalSpecies:[found.CAP_SPECIES],requiredBiome:found.CAP_BIOME,requiredTier:found.CAP_TIER};
      if((found=capture(node,'e=>e.r.biome===CAP_BIOME&&species(CAP_SPECIES)(e)')))return {finalSpecies:[found.CAP_SPECIES],requiredBiome:found.CAP_BIOME};
      if((found=capture(node,'e=>e.r.tier>=CAP_TIER&&e.r.time<CAP_TIME')))return {requiredTier:found.CAP_TIER,maxTime:found.CAP_TIME};
      if((found=capture(node,'e=>species(CAP_SPECIES)(e)&&hits(e)<=CAP_HITS'))&&Number.isSafeInteger(found.CAP_SPECIES)&&found.CAP_SPECIES>0&&Number.isSafeInteger(found.CAP_HITS)&&found.CAP_HITS>=0)
        return {finalSpecies:[found.CAP_SPECIES],maxHits:found.CAP_HITS};
      if((found=capture(node,'e=>species(CAP_SPECIES)(e)&&e.r.time<CAP_TIME'))&&Number.isSafeInteger(found.CAP_SPECIES)&&found.CAP_SPECIES>0&&found.CAP_TIME>0)
        return {finalSpecies:[found.CAP_SPECIES],maxTime:found.CAP_TIME};
      for(const [pattern,key]of [['e=>e.r.time<CAP_VALUE','maxTime'],['e=>e.r.time>CAP_VALUE','minTime'],['e=>hits(e)<=CAP_VALUE','maxHits'],['e=>hits(e)!==1/0&&hits(e)>CAP_VALUE','minHits']])
        if((found=capture(node,pattern))&&Number.isSafeInteger(found.CAP_VALUE)&&found.CAP_VALUE>=0)return {[key]:found.CAP_VALUE};
      if(matches(node,'e=>(e.r.end?.hp??1)>0&&(e.r.end?.hp??1)<0.1'))return {endHpMin:0,endHpMax:0.1};
      return null;
    };
    const type=role(tree),args=tree[2];let constraints;
    if(type==='damage'&&args.length>=2&&args.length<=4&&/^[a-z0-9-]+$/.test(text(args[0])||'')&&numeric(args[1])>0&&numeric(args[1])<=1&&
        (args.length<3||[0,1,2].includes(integer(args[2])))&&(constraints=predicate(args[3]))!==null&&validRule('add',1,'wins'))
      return {...base,metric:'wins',minTier:args.length>=3?integer(args[2]):0,constraints:{...constraints,damageShare:{key:text(args[0]),min:numeric(args[1]),includeFusionParents:true}}};
    if(type==='tier'&&args.length>=1&&args.length<=2&&[0,1,2].includes(integer(args[0]))&&(constraints=predicate(args[1]))!==null&&validRule('add',1,'wins'))
      return {...base,metric:'wins',minTier:integer(args[0]),...(Object.keys(constraints).length?{constraints}:{})};
    if(type==='wins'&&args.length>=1&&args.length<=2&&integer(args[0])>0&&(constraints=predicate(args[1]))!==null&&validRule('add',integer(args[0]),'wins'))
      return {...base,metric:'wins',...(Object.keys(constraints).length?{constraints}:{})};
    if(type==='biome'&&args.length>=1&&args.length<=2&&['forest','desert','coast','glacier','encina','iris','canela','cave'].includes(text(args[0]))&&
        (args.length===1||[0,1,2].includes(integer(args[1])))&&validRule('add',1,'wins'))return {...base,metric:'wins',biome:text(args[0]),minTier:args.length===2?integer(args[1]):0};
    if(type==='allBiomes'&&args.length===0&&validRule('bits',4,'allBiomes'))return {...base,metric:'wins',
      bitTargets:[{bit:1,biome:'forest'},{bit:2,biome:'desert'},{bit:4,biome:'coast'},{bit:8,biome:'glacier'}]};
    if(type==='johtoBiomes'&&args.length===0&&validRule('bits',2,'johtoBiomes'))return {...base,metric:'wins',bitTargets:[{bit:1,biome:'encina'},{bit:2,biome:'iris'}]};
    const eeveeBits=[{bit:1,finalSpecies:[134]},{bit:2,finalSpecies:[135]},{bit:4,finalSpecies:[136]}];
    if(type==='eevee'&&args.length===1&&[0,1,2].includes(integer(args[0]))&&validRule('bits',3,'eevee'))return {...base,minTier:integer(args[0]),metric:'wins',bitTargets:eeveeBits};
    if(type==='counter'&&args.length===2&&['soaked','evolutions','poisoned','burned','slept','crits','gold','confused','paralyzed','frozen','healed','ultimates','electro','dodges','rainKills','rocks','berries','chests'].includes(text(args[0]))&&validRule('add',integer(args[1]),'counter'))return {...base,metric:text(args[0])};
    if(['killsAdd','killsMax'].includes(type)&&args.length===1&&validRule(type==='killsAdd'?'add':'max',integer(args[0]),type))return {...base,metric:'kills',singleRun:type==='killsMax'};
    // Inline definitions must match the entire object and serialized predicate,
    // including kind, scalar goal and every mode/species/health condition.
    for(const [pattern,valuePattern,kind,goal,result]of [
      ['{kind:`add`,goal:CAP_GOAL,v:e=>Math.max(0,e.r.alphas)}','e=>Math.max(0,e.r.alphas)','add',null,{metric:'alphas'}],
      ['{kind:`max`,goal:CAP_GOAL,v:e=>e.r.level}','e=>e.r.level','max',null,{metric:'maxLevel',singleRun:true}],
      ['{kind:`max`,goal:600,v:e=>e.r.mode===`endless`&&e.r.species===129?Math.floor(finalSpecies(e)===129?e.r.time:Math.min(e.r.time,e.d.holdSecs??0)):0}','e=>e.r.mode===`endless`&&e.r.species===129?Math.floor(finalSpecies(e)===129?e.r.time:Math.min(e.r.time,e.d.holdSecs??0)):0','max',600,
        {mode:'endless',metric:'maxTime',singleRun:true,constraints:{initialSpeciesHold:{species:129,seconds:600},minTime:600,minTimeInclusive:true}}],
      ['{kind:`bits`,goal:3,v:e=>victory(e)?({134:1,135:2,136:4}[finalSpecies(e)]??0):0}','e=>victory(e)?({134:1,135:2,136:4}[finalSpecies(e)]??0):0','bits',3,{metric:'wins',bitTargets:eeveeBits}],
    ]){
      const found=capture(tree,pattern),expected=goal??found?.CAP_GOAL;
      if(found&&rule.kind===kind&&rule.goal===expected&&Number.isSafeInteger(expected)&&expected>0&&matches(masterySyntax(rule.vSource),valuePattern))return {...base,...result};
    }
    return null;
  }catch{return null;}
}

/** Build a deterministic catalog from reviewed, public native definitions. */
