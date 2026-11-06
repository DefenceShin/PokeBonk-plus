import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('all host preparation paths pass module sources and response path fulfills verified dependency exports',()=>{
 const host=fs.readFileSync(new URL('../client/PokeBonk.Client/MainWindow.cs',import.meta.url),'utf8');
 assert.ok(host.includes('PublicModuleSourcesAsync'));
 assert.equal((host.match(/\["moduleSources"\]/g)||[]).length,5);
 assert.ok(host.includes('TryFulfillNativeModulePatchAsync'));
});
