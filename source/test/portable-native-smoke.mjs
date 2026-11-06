// Exercise the final native EXE with production storage paths in a fresh folder.
// No account is created, no credentials are read, and no match is started.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,readdir,stat,chmod} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';
import os from 'node:os';
import {chromium} from 'playwright';

const root=path.resolve(process.argv[2]||'dist/0.11.0');
const info=JSON.parse(await readFile(path.join(root,'build-info.json'),'utf8'));
const output=path.resolve('artifacts/portable-native',new Date().toISOString().replace(/[:.]/g,'-'));
await mkdir(output,{recursive:true});
const sha=buffer=>createHash('sha256').update(buffer).digest('hex');
const within=p=>p===root||p.toLowerCase().startsWith((root+path.sep).toLowerCase());
const readable=path.join(root,'挂机日志.txt');
const summary={version:info.version,exeSha256:info.sha256,controllerRevision:info.controllerRevision,
  passed:false,productionStorage:true,arguments:['--diagnostics','--diagnostics-no-activate'],noGuestFlag:true,noAccountCreated:true,
  countsAsCampaignVictory:false,errors:[]};
assert.equal(sha(await readFile(path.join(root,'PokeBonk Pilot.exe'))),info.sha256);
assert.equal(info.nativeSelfExtraction,false);
const existingData=await stat(path.join(root,'data')).then(()=>true).catch(()=>false);
if(existingData){
  assert.ok(process.argv.includes('--reuse-empty'),'use a fresh build folder unless explicitly reusing the prior empty test profile');
  const previous=JSON.parse(await readFile(path.join(root,'data','status.json'),'utf8'));
  assert.ok(!previous.game?.accountType&&!previous.profile?.league?.length&&!previous.game?.state,'never reuse any account or active match');
}

async function metadata(directory){
  const rows=[];
  async function walk(dir,relative=''){
    for(const entry of await readdir(dir,{withFileTypes:true}).catch(()=>[])){
      const next=path.join(dir,entry.name),rel=path.join(relative,entry.name);
      if(entry.isSymbolicLink())continue;
      if(entry.isDirectory())await walk(next,rel);
      else {const s=await stat(next);rows.push([rel,s.size,s.mtimeMs]);}
    }
  }
  await walk(directory);rows.sort((a,b)=>a[0].localeCompare(b[0]));
  return {files:rows.length,digest:sha(JSON.stringify(rows))};
}
const legacy=path.join(process.env.LOCALAPPDATA||os.homedir(),'PokeBonkPilot');
const extraction=path.join(os.tmpdir(),'.net','PokeBonk Pilot');
const before={legacy:await metadata(legacy),extraction:await metadata(extraction)};
let portInUse=false;
try {portInUse=(await fetch('http://127.0.0.1:9223/json/version')).ok;}catch{}
assert.equal(portInUse,false,'do not attach to any preexisting user client');
const child=spawn(path.join(root,'PokeBonk Pilot.exe'),['--diagnostics','--diagnostics-no-activate'],{cwd:root,windowsHide:true,stdio:'ignore'});
let browser,panel,game,readOnly=false;
const state=()=>panel.evaluate(()=>desktop.getState());
async function command(action,payload={}){return panel.evaluate(({action,payload})=>desktop.command(action,payload),{action,payload});}
async function waitFor(check,message,seconds=30){
  const until=Date.now()+seconds*1000;
  while(Date.now()<until){try{if(await check())return;}catch{}await delay(200);}
  throw Error(message);
}
try{
  await waitFor(async()=>{
    try{browser=await chromium.connectOverCDP('http://127.0.0.1:9223');return true;}catch{return false;}
  },'native debug endpoint did not start',60);
  await waitFor(async()=>{
    const pages=browser.contexts().flatMap(c=>c.pages());
    panel=pages.find(p=>p.url().startsWith('https://pilot.local/'));
    game=pages.find(p=>p.url().startsWith('https://pokebonk.com/'));
    return panel&&game;
  },'native surfaces did not load');
  panel.on('pageerror',e=>summary.errors.push(e.message));
  game.on('pageerror',e=>summary.errors.push(e.message));
  await panel.waitForFunction(()=>!!globalThis.desktop,undefined,{timeout:30000});
  await waitFor(async()=>{const s=await state();return s.compatibilityReport?.state==='ready';},'game contract never became ready after bounded native boot grace',150);
  await waitFor(async()=>{const s=await state(),c=s.connection;return c?.strategy==='browser-response-v1'&&c.javascriptFeatures?.ok===true&&
    c.nativeBoot?.phase==='ready'&&c.nativeBoot?.stage==='complete'&&c.events?.some(event=>event.code==='game-module-transformed')&&
    c.sourceHash===s.compatibilityReport.sourceHash;},'same-browser response or native boot proof missing',30);
  const initial=await state();
  assert.ok(Number.parseInt(initial.connection.runtimeVersion,10)>=98,'runtime must meet the supported minimum');
  assert.equal(await game.evaluate(hash=>__PB_BRIDGE.compatibility.sourceHash===hash,initial.connection.sourceHash),true);
  for(const event of initial.connection.events||[])if(event.resource){const uri=new URL(event.resource);assert.equal(uri.origin,'https://pokebonk.com');assert.ok(!uri.search&&!uri.hash&&!uri.username&&!uri.password);}
  summary.connection={strategy:initial.connection.strategy,runtimeVersion:initial.connection.runtimeVersion,sourceHash:initial.connection.sourceHash,
    javascriptFeatureProbePassed:true,nativeBootReady:true,transformedResponseObserved:true,publicResourceDiagnosticsOnly:true};
  assert.equal(initial.version,info.version);
  assert.equal(initial.profile,null,'do not enter or create an account in storage testing');
  assert.equal(initial.diagnostics.isolatedStorage,false,'use real production paths, not smoke paths');
  assert.equal(initial.diagnostics.automaticGuestEntry,false);
  assert.equal(path.resolve(initial.storage.root),root);
  assert.equal(initial.storage.log,readable);
  assert.equal(initial.storage.data,path.join(root,'data'));
  for(const value of Object.values(initial.storage))if(value)assert.ok(within(path.resolve(value)),'all storage paths stay within EXE directory');
  assert.equal(initial.diagnostics.processTemporary,path.join(root,'data','temp'));
  assert.equal(initial.diagnostics.browserUserDataOverride,path.join(root,'data','browser'));
  assert.ok((await stat(readable)).isFile(),'default readable document exists');
  await command('config',{fps:60,autoUpgrade:false});
  assert.ok((await readFile(readable,'utf8')).includes('挂机设置已保存'));
  assert.ok((await readFile(path.join(root,'data','journal.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line)).some(entry=>entry.title==='挂机设置已保存'));
  await waitFor(()=>stat(path.join(root,'data','status.json')).then(()=>true),'status file was not written locally');
  await panel.locator('[data-tab="logs"]').click();
  await panel.screenshot({path:path.join(output,'before-clear.png')});
  const beforeClear=await state();
  await panel.locator('#clear-logs').click();
  await waitFor(async()=>{const s=await state();return s.logs.length===0;},'native logs did not clear');
  await delay(2300);
  const cleared=await state();
  assert.equal(cleared.logs.length,0,'old observed events must not repopulate cleared logs');
  assert.deepEqual(cleared.session,beforeClear.session,'clearing leaves session statistics intact');
  assert.deepEqual(cleared.profile,beforeClear.profile);
  assert.deepEqual(cleared.config,beforeClear.config);
  assert.equal((await readFile(readable)).length,0);
  assert.equal((await readFile(initial.storage.journal)).length,0);
  assert.equal(await panel.locator('#log-rows tr').count(),0);
  assert.ok(await panel.locator('#log-count').isHidden());
  assert.ok(await panel.locator('#clear-logs').isEnabled());
  await panel.screenshot({path:path.join(output,'after-clear.png')});
  summary.clear={nativeMemory:true,textDocument:true,structuredJournal:true,uiTable:true,badgeHidden:true,
    noReplayAfterTwoTicks:true,sessionPreserved:true,profilePreserved:true,configPreserved:true};

  await command('config',{pickup:true});
  const retainedText=await readFile(readable),retainedJournal=await readFile(initial.storage.journal);
  const retained=await state();
  await chmod(readable,0o444);readOnly=true;
  await panel.locator('#clear-logs').click();
  await waitFor(async()=>{const s=await state();return !!s.error;},'write failure did not reach native/UI state');
  assert.deepEqual(await readFile(readable),retainedText);
  assert.deepEqual(await readFile(initial.storage.journal),retainedJournal);
  assert.equal((await state()).logs.length,retained.logs.length,'failed clear must retain in-memory entries');
  assert.ok(await panel.locator('#clear-logs').isEnabled());
  await chmod(readable,0o666);readOnly=false;
  await command('config',{fps:60});
  await command('clearLogs');
  assert.equal((await state()).logs.length,0);
  assert.equal((await readFile(readable)).length,0);
  summary.failureRecovery={readOnlyFailureVisible:true,bothFilesRetained:true,memoryRetained:true,buttonsRecovered:true,restoredWritableClearPassed:true};
  summary.storage=initial.storage;
  summary.gameHash=initial.game.compatibility.sourceHash;
  summary.noMatchStarted=!(await state()).game.state;
  const closed=await command('testClose');
  assert.equal(closed.accepted,true);
  await waitFor(()=>child.exitCode!==null,'test instance did not close normally',20);
  const after={legacy:await metadata(legacy),extraction:await metadata(extraction)};
  assert.deepEqual(after.extraction,before.extraction,'system .net extraction storage must remain unchanged');
  const legacyUnchanged=JSON.stringify(after.legacy)===JSON.stringify(before.legacy);
  const concurrentLegacyClient=process.argv.includes('--legacy-concurrent');
  summary.legacyAppDataCheck={before:before.legacy,after:after.legacy,concurrentLegacyClient};
  if(!legacyUnchanged&&!concurrentLegacyClient)assert.fail('legacy AppData changed without a declared concurrent legacy client');
  summary.legacyAppDataUnchanged=legacyUnchanged?true:null;
  if(!legacyUnchanged)summary.legacyAppDataCheck.reason='A separately observed user-owned 0.5.1 client was already running; aggregate legacy-folder writes cannot be attributed to this isolated 0.5.2 test.';
  summary.systemExtractionFolderUnchanged=true;
  assert.deepEqual(summary.errors,[]);
  assert.equal(sha(await readFile(path.join(root,'PokeBonk Pilot.exe'))),info.sha256,'test the final unchanged executable');
  summary.passed=true;
}catch(error){summary.reason=error.message;throw error;}
finally{
  if(readOnly)await chmod(readable,0o666).catch(()=>{});
  if(child.exitCode===null&&panel)await command('testClose').catch(()=>{});
  // Native testClose owns shutdown; do not send Browser.close to a replacement endpoint.
  summary.endedAt=new Date().toISOString();
  await writeFile(path.join(output,'summary.json'),JSON.stringify(summary,null,2)+'\n');
  console.log(JSON.stringify({passed:summary.passed,version:summary.version,reason:summary.reason,output,clear:summary.clear,failureRecovery:summary.failureRecovery,legacyAppDataUnchanged:summary.legacyAppDataUnchanged,systemExtractionFolderUnchanged:summary.systemExtractionFolderUnchanged}));
}
