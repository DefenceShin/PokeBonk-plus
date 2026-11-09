// Run from any cwd. No installed EXE, personal browser or real account is used.
import fs from'node:fs';import{spawnSync}from'node:child_process';import{fileURLToPath}from'node:url';
const root=new URL('../',import.meta.url),logDir=new URL('validation/0922/',root);fs.mkdirSync(logDir,{recursive:true});const results=[];
function run(name,exe,args,options={}){const result=spawnSync(exe,args,{cwd:root,encoding:'utf8',timeout:180000,env:{...process.env,...options.env}});fs.writeFileSync(new URL(name+'.log',logDir),(result.stdout||'')+(result.stderr||'')+(result.error?'\n'+result.error:''));const row={name,exit:result.status,error:result.error?.message};results.push(row);console.log(JSON.stringify(row));fs.writeFileSync(new URL('results.json',logDir),JSON.stringify(results,null,2));if(result.status!==0)process.exit(1);}
run('npm',process.platform==='win32'?'cmd.exe':'npm',process.platform==='win32'?['/d','/s','/c','npm --prefix source test']:['--prefix','source','test']);
run('catalogs',process.execPath,['tools/validate-0922-catalogs.mjs']);
run('parity-162',process.execPath,['source/test/season3-0922-parity.mjs']);
for(const name of ['characters-runtime','characters-start-runtime','characters-capture-runtime','skins-runtime','skins-cycle-runtime','skins-capture-runtime','shiny-source-runtime','eligibility-runtime','map-events-runtime','canela-lava-runtime','arena-actions-runtime','ball-actions-runtime','celebi-actions-runtime','iris-events-runtime','hooh-actions-runtime','hooh-hurricane-runtime','rift-success-runtime','rift-timeout-runtime','skins-ui'])run(name,process.execPath,['source/test/season3-0922-'+name+'.mjs']);
run('rift-pilot-pulse-runtime',process.execPath,['source/test/season3-0922-rift-pilot-pulse-runtime.mjs']);
run('rift-success-full',process.execPath,['source/test/season3-0922-rift-success-runtime.mjs'],{env:{M3_FULL:'1'}});
run('dotnet-release','dotnet',['build','source/client/PokeBonk Pilot.csproj','-c','Release','-r','win-x64']);
run('host-checks','dotnet',['run','--project','host-checks','--',fileURLToPath(root)]);
console.log('PASS current offline validation; logs: '+fileURLToPath(logDir));
