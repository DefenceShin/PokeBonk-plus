import fs from 'node:fs';import crypto from 'node:crypto';
const root=new URL('../evidence/public-0922/data/',import.meta.url);fs.mkdirSync(root,{recursive:true});
const old=JSON.parse(fs.readFileSync(new URL('../evidence/public-0913/data/manifest.json',import.meta.url)));const records=[];
for(const row of old.records){const response=await fetch(row.url);if(!response.ok)throw Error(`${response.status} ${row.url}`);const bytes=Buffer.from(await response.arrayBuffer());JSON.parse(bytes.toString());fs.writeFileSync(new URL(row.file,root),bytes);records.push({...row,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});}
fs.writeFileSync(new URL('manifest.json',root),JSON.stringify({checkedAt:new Date().toISOString(),records},null,2));console.log(records.map(r=>({file:r.file,unchanged:r.sha256===old.records.find(o=>o.file===r.file).sha256})));
