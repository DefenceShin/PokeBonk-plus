import {readFile,writeFile,readdir,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=process.cwd();
const reviewRoot=root,reviewEvidenceArtifacts=new WeakMap();
const read=p=>readFile(p,'utf8').then(JSON.parse).catch(()=>null);
const {readControllerPackage}=await import('../scripts/controller-sources.mjs');
const currentRevision=(await readControllerPackage()).revision;
const runs=[];
const args=process.argv.slice(2), arg=name=>args.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);
const catalog=await read('data/catalog.json');
const campaignBiomes=ordinaryCampaignMaps(catalog);
if(!campaignBiomes.length)throw Error('Missing reviewed live ordinary campaign maps');
const baselineEvidence='research/update-0.8.0-latest-review.json', baseline=await read(baselineEvidence);
if(!baseline?.coreContractReady || !/^[a-f0-9]{64}$/.test(baseline.sourceHash))throw Error('Missing reviewed baseline fingerprint');
const reviewBaselineHashes=[baseline.sourceHash,catalog.verification?.mainSha256];
const requestedHash=arg('game-hash'), requestedEvidence=arg('game-evidence');
if(Boolean(requestedHash)!==Boolean(requestedEvidence))throw Error('--game-hash and --game-evidence are required together');
const targetEvidence=requestedEvidence ? await publicEvidence(requestedEvidence) : baseline;
const currentGameHash=requestedHash || baseline.sourceHash;
if(requestedHash && !reviewedTargetEvidence(targetEvidence,requestedHash))throw Error('Target game fingerprint lacks an explicit matching public static review');
if(args.includes('--self-test')){
 const assert=(await import('node:assert/strict')).default;
 assert.deepEqual(campaignBiomes,['forest','desert','coast','glacier']);
 assert.deepEqual(ordinaryCampaignMaps({maps:[{id:'forest',live:true},{id:'graveyard',live:true},{id:'event',live:true,mode:'tower'},{id:'future',live:false}]}),['forest']);
 const reviewChecks=reviewEvidenceSelfTest(assert,baseline.sourceHash);
 const base={passed:true,saved:true,victory:true,nativeVictorySaved:true,nativeVictoryArgument:true,nativeOver:true,matchesRequested:true,mode:'standard',actualBiome:'forest',actualTier:0,requested:{biome:'forest',tier:0}};
 assert.equal(qualifyingVictory(base),true);assert.equal(qualifyingVictory({...base,nativeVictoryArgument:false}),false);
 assert.equal(qualifyingVictory({...base,victory:false,reason:'quit'}),false);assert.equal(qualifyingVictory({...base,saved:false}),false);assert.equal(qualifyingVictory({...base,actualBiome:'coast'}),false);
 const oldVictory={...base,fixedRevision:currentRevision,fixedGameHash:'a'.repeat(64)},newHash='b'.repeat(64);assert.equal(qualifyingVictory(oldVictory),true);assert.equal(qualifyingVictory(oldVictory)&&oldVictory.fixedRevision===currentRevision&&oldVictory.fixedGameHash===newHash,false,'A reviewed new game never inherits an old-source victory');
 console.log(JSON.stringify({passed:true,campaignMaps:campaignBiomes,matrixCells:campaignBiomes.length*3,checks:10+reviewChecks,reviewChecks,accountsRead:false,browserStarted:false,reportWritten:false}));process.exit(0);
}
// Tactical regression profiles use the same native campaign harness and must
// retain their defeats/incomplete trials alongside the original campaign set.
const profiles=(await readdir('artifacts',{withFileTypes:true})).filter(d=>d.isDirectory()&&
  (/^(campaign|tactics)[a-z0-9-]*$/.test(d.name)||['dedicated-account','dedicated-v2'].includes(d.name))).map(d=>d.name).sort();
const incomplete=[];
for(const profile of profiles){
  for(const d of await readdir(`artifacts/${profile}`,{withFileTypes:true})){
    if(!d.isDirectory())continue;
    const file=path.join('artifacts',profile,d.name,'summary.json');
    const s=await read(file); if(!s)continue;
    const fingerprints=await readFile(path.join('artifacts',profile,d.name,'revisions.jsonl'),'utf8').then(v=>v.trim().split('\n').filter(Boolean).map(v=>JSON.parse(v))).catch(()=>[]);
    const revisions=[...new Set(fingerprints.map(v=>v.revision))];
    const gameHashes=[...new Set(fingerprints.map(v=>v.gameHash).filter(Boolean))];
    // Older harnesses lost their last telemetry on a renderer crash and could
    // write incomplete=false with a started match but no settlement. Preserve
    // that original record while explicitly classifying the missing evidence.
    if(s.incomplete || (Number(s.matchesStarted)||0) > (s.outcomes||[]).length)
      incomplete.push({profile,reason:s.reason,source:path.resolve(file),at:s.endedAt,
        originalIncompleteFlag:s.incomplete??null,startedMatches:Number(s.matchesStarted)||0,
        recordedOutcomes:(s.outcomes||[]).length,settlementUnconfirmed:true,
        fixedRevision:revisions.length===1?revisions[0]:null,
        fixedGameHash:gameHashes.length===1?gameHashes[0]:null});
    for(const o of s.outcomes||[])runs.push({profile,at:s.endedAt,requested:o.requested,
      dedicatedTestAccount:s.dedicatedTestAccount===true||o.dedicatedTestAccount===true,
      actualBiome:o.actualBiome||o.finish?.biome||o.event?.biome,actualTier:o.actualTier??o.finish?.tier,mode:o.finish?.mode||'standard',
      nativeVictorySaved:o.nativeVictorySaved===true,nativeVictoryArgument:o.finish?.victoryArgument===true,nativeOver:o.finish?.actualState==='over',
      matchesRequested:o.matchesRequested===true,
      nativeMoveSlots:o.actualNativeMoveSlots??null,
      passed:o.passed,saved:o.event?.saved,victory:o.finish?.actualVictory,
      stage:o.finish?.stage,time:o.finish?.time,kills:o.finish?.stats?.kills,hits:o.finish?.stats?.hits,
      reason:o.reason,combatDefeat:o.combatDefeat??(o.finish?.actualVictory===false&&o.finish?.hp<=0),revision:o.revision,fixedRevision:oneFingerprint(o.observedRevisions||revisions),gameHashes:o.observedGameHashes||gameHashes,fixedGameHash:oneFingerprint(o.observedGameHashes||gameHashes),source:path.resolve(file)});
  }
}
runs.sort((a,b)=>a.at.localeCompare(b.at));
const matrix=[0,1,2].flatMap(tier=>campaignBiomes.map(biome=>({biome,tier,
  victories:runs.filter(r=>qualifyingVictory(r)&&r.requested?.biome===biome&&r.requested?.tier===tier).length,
  defeats:runs.filter(r=>!qualifyingVictory(r)&&r.requested?.biome===biome&&r.requested?.tier===tier).length,
  currentVersionVictories:runs.filter(r=>qualifyingVictory(r)&&r.fixedRevision===currentRevision&&r.fixedGameHash===currentGameHash&&r.requested?.biome===biome&&r.requested?.tier===tier).length,
  currentVersionDefeats:runs.filter(r=>!qualifyingVictory(r)&&r.fixedRevision===currentRevision&&r.fixedGameHash===currentGameHash&&r.requested?.biome===biome&&r.requested?.tier===tier).length})));
const active=[];
for(const profile of profiles){
  const s=await read(`artifacts/${profile}/status.json`);
  const metadata=await read(`artifacts/${profile}/active.json`);
  let alive=false;
  if(metadata?.pid)try{process.kill(metadata.pid,0);alive=true;}catch{}
  if(alive&&s?.run&&s.run.state!=='over')active.push({profile,requested:s.requested,revision:s.revision,at:s.at,stage:s.run.stage,time:s.run.time,hp:s.run.player.hp,runDir:s.runDir});
}
const registered=[];
for(const d of await readdir('artifacts/registered-campaign',{withFileTypes:true}).catch(()=>[])){
  if(!d.isDirectory())continue;
  const file=path.join('artifacts/registered-campaign',d.name,'outcome.json'), s=await read(file);
  if(s)registered.push({saved:s.event.saved,victory:s.event.victory,biome:s.event.biome,time:s.event.time,kills:s.event.kills,source:path.resolve(file)});
}
const report={updatedAt:new Date().toISOString(),revision:currentRevision,gameHash:currentGameHash,
  baseline:{gameHash:baseline.sourceHash,gameVersion:baseline.gameVersion,evidence:baselineEvidence,definitionGameHash:catalog.verification?.mainSha256},
  targetGame:{gameHash:currentGameHash,evidence:requestedEvidence||baselineEvidence,explicit:Boolean(requestedHash),staticReviewOnly:true},
  scope:{mode:'standard',biomes:campaignBiomes,tiers:[0,1,2],cells:matrix.length,source:'data/catalog.json live ordinary maps',excluded:['tower','endless','graveyard','future/non-live maps'],tower:'Separate live-event validation required; never counted as an ordinary campaign cell'},
  acceptance:'Every ordinary live-map/tier cell needs native victory, confirmed server save, matching requested map/tier and one fixed controller+actual game hash. Historical failures/incomplete attempts remain; static equivalence does not transfer victories. Native smoke-test quits are never campaign clears.',
  accepted:matrix.every(m=>m.currentVersionVictories>0&&m.currentVersionDefeats===0)&&
    !incomplete.some(attempt=>attempt.fixedRevision===currentRevision&&attempt.fixedGameHash===currentGameHash),matrix,runs,registered,active,incomplete};
await writeFile('research/combat-validation.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({revision:report.revision,runs:runs.length,matrix,active}));


function ordinaryCampaignMaps(value){
 return (value?.maps||[]).filter(map=>map.live===true&&map.id!=='graveyard'&&!map.eventOnly&&!map.event&&(!map.mode||map.mode==='standard'))
  .sort((a,b)=>(a.index??0)-(b.index??0)).map(map=>map.id);
}
function oneFingerprint(values){const unique=[...new Set((values||[]).filter(value=>typeof value==='string'&&value))];return unique.length===1?unique[0]:null;}
function qualifyingVictory(run){return run.passed===true&&run.saved===true&&run.victory===true&&run.nativeVictorySaved===true&&run.nativeVictoryArgument===true&&run.nativeOver===true&&run.matchesRequested===true&&run.mode==='standard'&&run.actualBiome===run.requested?.biome&&run.actualTier===run.requested?.tier;}
// BEGIN PUBLIC REVIEW EVIDENCE CONTRACT: mirrored by the two validation tools.
function reviewDigest(bytes){return createHash("sha256").update(bytes).digest("hex");}
function reviewSourcePath(value){return typeof value==="string"&&(/^(src\/(policy|pilot|objectives|shiny|compatibility|custom-plans|action-cadence|interaction-navigation|battle-tactics|choice-strategy|unlock-goals|player-overlay|player-convenience|unlock-catalog|encyclopedia|telemetry)\.mjs|client\/GameUpdates\.cs)$/.test(value));}
function reviewedTargetEvidence(report,hash,observed=reviewEvidenceArtifacts.get(report)) {
  try {
    const actual=report?.actual, validHash=value=>/^[a-f0-9]{64}$/.test(value||""),
      bodyMatches=(record,body)=>record?.status===200&&Number.isInteger(record.bytes)&&record.bytes>0&&
        typeof record.file==="string"&&/^[A-Za-z0-9._-]+\.js$/.test(record.file)&&validHash(record.sha256)&&
        Buffer.isBuffer(body)&&body.length===record.bytes&&reviewDigest(body)===record.sha256;
    if (!validHash(hash)||report?.reportType!=="pokebonk-public-static-review"||report.publicOnly!==true||report.reviewed!==true||
        report.reviewedGameHash!==hash||actual?.sha256!==hash||report.accountUsed!==false||report.credentialsRead!==false||
        report.browserOpened!==false||report.gameplayValidated!==false||report.requestsAuthenticated===true||report.gameExecuted===true||report.contract?.ok!==true||
        !Array.isArray(report.contract.missing)||report.contract.missing.length||
        !bodyMatches(actual,observed?.mainBytes)||!bodyMatches(actual.news,observed?.newsBytes)) return false;
    if (report.definitionEquivalent===true&&report.definitionsAndCombatUnchanged===true) {
      return observed.baselineHashes?.includes(report.definitionEquivalentToHash)===true&&
        report.assessment?.battleChangesIdentified!==true&&!(report.changes||[]).some(change=>change.gameplay===true);
    }
    if (report.definitionEquivalent!==false||report.definitionsAndCombatUnchanged!==false||
        report.assessment?.staticReviewComplete!==true||report.assessment.connectionContractSatisfied!==true) return false;
    const mr=report.mechanicsReview, ref=mr?.proof;
    if (mr?.schemaVersion!==1||mr.reviewed!==true||mr.allChangesReviewed!==true||mr.adapterCoverageConfirmed!==true||
        !Array.isArray(mr.unresolvedRequiredChanges)||mr.unresolvedRequiredChanges.length||ref?.passed!==true||
        ref.reportType!=="pokebonk-public-mechanics-adapter-proof"||!validHash(ref.sha256)||
        !Number.isInteger(ref.bytes)||ref.bytes<=0||!Buffer.isBuffer(observed.proofBytes)||
        observed.proofBytes.length!==ref.bytes||reviewDigest(observed.proofBytes)!==ref.sha256) return false;
    const proof=JSON.parse(observed.proofBytes.toString("utf8"));
    if (proof.schemaVersion!==1||proof.reportType!==ref.reportType||proof.publicOnly!==true||proof.passed!==true||
        proof.actualSourceHash!==hash||proof.accountUsed!==false||proof.credentialsRead!==false||proof.browserOpened!==false||
        proof.AppRunBackendExecuted!==false||proof.gameplayValidated!==false) return false;
    const exactSources=entries=>Array.isArray(entries)&&entries.length>0&&new Set(entries.map(entry=>entry.file)).size===entries.length&&
      entries.every(entry=>reviewSourcePath(entry.file)&&validHash(entry.sha256)&&
        Buffer.isBuffer(observed.sourceBytes?.get(entry.file))&&reviewDigest(observed.sourceBytes.get(entry.file))===entry.sha256);
    if (!exactSources(proof.sourceFiles)||!exactSources(mr.adapterSourceFiles)||
        proof.sourceFiles.length!==mr.adapterSourceFiles.length||
        !proof.sourceFiles.every(entry=>mr.adapterSourceFiles.some(item=>item.file===entry.file&&item.sha256===entry.sha256))) return false;
    const details=[...(proof.driveCases||[]),...(proof.proofCases||[])], ids=new Set(details.map(item=>item.id));
    if (!details.length||proof.caseCount!==details.length||ids.size!==details.length||
        !details.every(item=>typeof item.id==="string"&&item.id&&((item.equal===true&&item.nativeDriveSpeed===item.productDriveSpeed)||item.passed===true))) return false;
    if (!Array.isArray(proof.checks)||!proof.checks.length||new Set(proof.checks.map(item=>item.id)).size!==proof.checks.length||
        !proof.checks.every(item=>typeof item.id==="string"&&item.id&&item.passed===true&&Array.isArray(item.caseIds)&&
          item.caseIds.length>0&&new Set(item.caseIds).size===item.caseIds.length&&item.caseIds.every(id=>ids.has(id)))) return false;
    if (!Array.isArray(report.changes)||!report.changes.length||
        !report.changes.every(change=>typeof change.id==="string"&&change.id&&typeof change.gameplay==="boolean")||
        new Set(report.changes.map(change=>change.id)).size!==report.changes.length) return false;
    const gameplay=report.changes.filter(change=>change.gameplay), coverage=mr.changes;
    if (!gameplay.length||!Array.isArray(coverage)||coverage.length!==gameplay.length||
        new Set(coverage.map(change=>change.id)).size!==coverage.length) return false;
    return gameplay.every(change=>coverage.some(entry=>entry.id===change.id&&entry.coverage?.state==="covered"&&
      Array.isArray(entry.coverage.checkIds)&&entry.coverage.checkIds.length>0&&
      entry.coverage.checkIds.every(id=>proof.checks.some(check=>check.id===id&&check.passed===true))&&
      Array.isArray(entry.evidence)&&entry.evidence.length>0&&entry.evidence.every(item=>proof.sourceFiles.some(source=>source.file===item.file)&&
        Array.isArray(item.lines)&&item.lines.length>0&&item.lines.every(n=>Number.isInteger(n)&&n>0&&
          n<=observed.sourceBytes.get(item.file).toString("utf8").split("\n").length))));
  } catch { return false; }
}
async function readReviewFile(reference,source=false) {
  if(typeof reference!=="string"||reference.includes("\\")||path.isAbsolute(reference)||reference.split("/").some(part=>!part||part==="."||part==="..")||
      !(source?reviewSourcePath(reference):/^(research\/[^/]+\.(json|js)|artifacts\/official-[^/]+\/[^/]+\.(json|js))$/.test(reference)))
    throw Error("Public review attachment path is outside the reviewed source/public-evidence scope");
  const absolute=path.resolve(reviewRoot,reference);
  for(let current=absolute;current!==path.resolve(reviewRoot);current=path.dirname(current))
    if((await lstat(current)).isSymbolicLink())throw Error("Public review attachments cannot follow links");
  return readFile(absolute);
}
async function loadReviewAttachments(report,reference,baselineHashes) {
  const relative=path.relative(reviewRoot,path.resolve(reviewRoot,reference)).replaceAll("\\","/");
  if(!/^(research\/[^/]+\.json|artifacts\/official-[^/]+\/[^/]+\.json)$/.test(relative))throw Error("Game evidence must be public research/official-review JSON");
  const local=record=>{
    if(!record||typeof record.file!=="string"||!/^[A-Za-z0-9._-]+\.js$/.test(record.file))throw Error("Public review must identify exact local main/news bodies");
    return path.posix.join(path.posix.dirname(relative),record.file);
  };
  const result={baselineHashes,mainBytes:await readReviewFile(local(report.actual)),newsBytes:await readReviewFile(local(report.actual?.news)),sourceBytes:new Map()};
  if(report.definitionEquivalent===false||report.definitionsAndCombatUnchanged===false){
    result.proofBytes=await readReviewFile(report.mechanicsReview?.proof?.path);
    const proof=JSON.parse(result.proofBytes.toString("utf8"));
    for(const entry of [...(report.mechanicsReview?.adapterSourceFiles||[]),...(proof.sourceFiles||[])])
      if(!result.sourceBytes.has(entry.file))result.sourceBytes.set(entry.file,await readReviewFile(entry.file,true));
  }
  return result;
}
async function publicEvidence(reference) {
  const relative=path.relative(reviewRoot,path.resolve(reviewRoot,reference)).replaceAll("\\","/");
  const report=JSON.parse((await readReviewFile(relative)).toString("utf8").replace(/^\uFEFF/,""));
  reviewEvidenceArtifacts.set(report,await loadReviewAttachments(report,reference,reviewBaselineHashes));
  return report;
}
function reviewEvidenceSelfTest(assert,baselineHash) {
  const mainBytes=Buffer.from("public-main"),newsBytes=Buffer.from("public-news"),hash=reviewDigest(mainBytes),source=Buffer.from("public-controller");
  const observed={mainBytes,newsBytes,baselineHashes:[baselineHash],sourceBytes:new Map([["src/policy.mjs",source]])};
  const original={reportType:"pokebonk-public-static-review",publicOnly:true,reviewed:true,reviewedGameHash:hash,
    actual:{file:"main.min.js",status:200,bytes:mainBytes.length,sha256:hash,news:{file:"news.min.js",status:200,bytes:newsBytes.length,sha256:reviewDigest(newsBytes)}},
    definitionEquivalent:true,definitionsAndCombatUnchanged:true,definitionEquivalentToHash:baselineHash,
    accountUsed:false,credentialsRead:false,browserOpened:false,gameplayValidated:false,contract:{ok:true,missing:[]}};
  let checks=0;const accept=(report,evidence=observed)=>{assert.equal(reviewedTargetEvidence(report,hash,evidence),true);checks++;},
    reject=(report,evidence=observed)=>{assert.equal(reviewedTargetEvidence(report,hash,evidence),false);checks++;};
  accept(original);for(const patch of [{publicOnly:false},{reviewed:false},{reviewedGameHash:"b".repeat(64)},{accountUsed:true},{credentialsRead:true},{browserOpened:true},{gameplayValidated:true},{requestsAuthenticated:true},{gameExecuted:true},{contract:{ok:false,missing:[]}},{definitionEquivalent:false}])reject({...original,...patch});
  reject({sourceHash:hash});reject({...original,actual:{...original.actual,bytes:mainBytes.length+1}});reject(original,{...observed,mainBytes:Buffer.from("wrong")});reject(original,{...observed,newsBytes:Buffer.from("wrong")});
  const sourceFiles=[{file:"src/policy.mjs",sha256:reviewDigest(source)}],proof={schemaVersion:1,reportType:"pokebonk-public-mechanics-adapter-proof",publicOnly:true,passed:true,actualSourceHash:hash,
    accountUsed:false,credentialsRead:false,browserOpened:false,AppRunBackendExecuted:false,gameplayValidated:false,sourceFiles,
    proofCases:[{id:"case-one",passed:true},{id:"case-two",passed:true}],driveCases:[],caseCount:2,
    checks:[{id:"check-one",passed:true,caseIds:["case-one"]},{id:"check-two",passed:true,caseIds:["case-two"]}]};
  const proofBytes=Buffer.from(JSON.stringify(proof)),changed={...original,definitionEquivalent:false,definitionsAndCombatUnchanged:false,definitionEquivalentToHash:null,
    assessment:{staticReviewComplete:true,connectionContractSatisfied:true,battleChangesIdentified:true},
    changes:[{id:"mechanic-one",gameplay:true},{id:"mechanic-two",gameplay:true},{id:"display",gameplay:false}],
    mechanicsReview:{schemaVersion:1,reviewed:true,allChangesReviewed:true,adapterCoverageConfirmed:true,unresolvedRequiredChanges:[],adapterSourceFiles:sourceFiles,
      proof:{path:"artifacts/official-fixture/proof.json",sha256:reviewDigest(proofBytes),bytes:proofBytes.length,reportType:proof.reportType,passed:true},
      changes:["one","two"].map(n=>({id:"mechanic-"+n,coverage:{state:"covered",checkIds:["check-"+n]},evidence:[{file:"src/policy.mjs",lines:[1]}]}))}};
  const evidence={...observed,proofBytes};accept(changed,evidence);
  for(const patch of [{mechanicsReview:null},{changes:[...changed.changes,{id:"uncovered",gameplay:true}]},{changes:changed.changes.map(({gameplay,...rest})=>rest)},
      {mechanicsReview:{...changed.mechanicsReview,allChangesReviewed:false}},{mechanicsReview:{...changed.mechanicsReview,unresolvedRequiredChanges:["missing"]}},
      {mechanicsReview:{...changed.mechanicsReview,changes:changed.mechanicsReview.changes.slice(1)}},
      {mechanicsReview:{...changed.mechanicsReview,changes:changed.mechanicsReview.changes.map(x=>({...x,coverage:{state:"covered",checkIds:["generic sentence"]}}))}}])reject({...changed,...patch},evidence);
  reject(changed,{...evidence,proofBytes:Buffer.from("wrong")});reject(changed,{...evidence,sourceBytes:new Map([["src/policy.mjs",Buffer.from("changed-controller")]])});
  const rejectedProof={...proof,checks:[{id:"check-one",passed:true,caseIds:["nonexistent"]},proof.checks[1]]},bad=Buffer.from(JSON.stringify(rejectedProof));
  reject({...changed,mechanicsReview:{...changed.mechanicsReview,proof:{...changed.mechanicsReview.proof,sha256:reviewDigest(bad),bytes:bad.length}}},{...evidence,proofBytes:bad});
  for(const patch of [{actualSourceHash:"b".repeat(64)},{publicOnly:false},{accountUsed:true},{credentialsRead:true},{gameplayValidated:true},{caseCount:99},
      {checks:[{id:"check-one",passed:true},proof.checks[1]]}]) {
    const bytes=Buffer.from(JSON.stringify({...proof,...patch}));
    reject({...changed,mechanicsReview:{...changed.mechanicsReview,proof:{...changed.mechanicsReview.proof,sha256:reviewDigest(bytes),bytes:bytes.length}}},{...evidence,proofBytes:bytes});
  }
  reject({...changed,definitionEquivalent:true,definitionsAndCombatUnchanged:true},evidence);
  return checks;
}
// END PUBLIC REVIEW EVIDENCE CONTRACT
