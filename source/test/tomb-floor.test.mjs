import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readControllerPackage} from '../scripts/controller-sources.mjs';
const {sharedSource}=await readControllerPackage();
function fresh(settings={}){
 const boot={console,performance:{now:()=>10000},document:{body:null,addEventListener(){},querySelector(){return null}},addEventListener(){},setInterval(){},opts:{autoStart:false,embedded:true,settings}};boot.window=boot;vm.createContext(boot);vm.runInContext(sharedSource+';installPilot(opts)',boot);return boot.__PB_PILOT;
}
test('tomb schedule: world intent and actual native trade agree across both boundaries and XP overrides',()=>{
 const p=fresh();p.costStrategySettings=()=>({});p.interactionRules=()=>({});p.decisionBuild=()=>({});p.goalWorldInteraction=()=>null;
 const modal={kind:'trade',entity:{kind:'tower'},offers:{offers:[{key:'treat'},{key:'trick'}]}},root={querySelectorAll:()=>[{},{}]};
 for(const onlyExperience of [false,true])for(const experienceBlessingPriority of [false,true])
 for(const start of [0,30])for(const floor of [29,30,31])for(const luck of [124,125,126]){
 p.settings.modeSettings.tower={onlyExperience,experienceBlessingPriority,tombExperienceFloor:start};
 const r={tower:{floor},player:{stats:{luck},hp:10,maxHp:10,moves:[],items:new Map()}};p.app={run:r};
 const trick=luck>=125&&(start ? floor<start : !(onlyExperience||experienceBlessingPriority));
 assert.equal(p.towerTrickRequested(r),trick);assert.equal(p.costModalDecision(modal,root).key,trick?'trick':'treat');
 }
});
