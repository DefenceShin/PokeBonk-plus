import fs from 'node:fs';import{spawnSync}from'node:child_process';
const logDir=new URL('../validation/0922-isolated/',import.meta.url);fs.mkdirSync(logDir,{recursive:true});
const names=process.argv.slice(2);const rows=[];
for(const name of names){const p=spawnSync(process.execPath,['source/test/season3-0922-'+name+'.mjs'],{cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:90000});fs.writeFileSync(new URL('runtime-'+name+'.log',logDir),(p.stdout||'')+(p.stderr||'')+(p.error?'\n'+p.error:''));const row={name,exit:p.status,error:p.error?.message};rows.push(row);console.log(row);}
fs.writeFileSync(new URL('isolated-results-'+Date.now()+'.json',logDir),JSON.stringify(rows,null,2));
if(rows.some(r=>r.exit!==0))process.exitCode=1;
