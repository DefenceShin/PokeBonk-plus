import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readControllerPackage} from '../scripts/controller-sources.mjs';
const {sharedSource}=await readControllerPackage();
const keys=['autoUpgrade','autoUnlockItems','autoClaim','reserveMoveSlot'];
function fresh(settings={}){
 const boot={console,performance:{now:()=>10000},document:{body:null,addEventListener(){},querySelector(){return null}},addEventListener(){},setInterval(){},opts:{autoStart:false,embedded:true,settings}};boot.window=boot;vm.createContext(boot);vm.runInContext(sharedSource+';installPilot(opts)',boot);return boot.__PB_PILOT;
}
test('outside helpers opt in separately, survive partial patches and reject malformed saved values',()=>{
 const all=(p,values)=>assert.deepEqual(keys.map(k=>p.settings[k]),values);
 all(fresh(),[false,false,false,false]);all(fresh(Object.fromEntries(keys.map(k=>[k,'true']))),[false,false,false,false]);
 const p=fresh({autoUpgrade:true,autoClaim:true});p.setSettings({fps:30});all(p,[true,false,true,false]);p.setSettings({autoClaim:false,autoUnlockItems:true});all(p,[true,true,false,false]);
});
for(const mode of ['wardrobe','allClears'])for(const [kind,key] of [['buy-item','autoUnlockItems'],['buy-lab','autoUpgrade'],['claim-quest','autoClaim']])test(mode+' must honor permission for '+kind,async()=>{
 const p=fresh({mode,...Object.fromEntries(keys.map(k=>[k,false]))});let calls=0;const act=()=>{calls++;return true;};
 p.app={meta:{account:{id:'offline'},profile:{stardust:10000,itemsOwned:[],quests:[]},queued:0,hasPending:()=>false,queue:Promise.resolve(),lab:()=>0,buyLab:act,buyItem:act,claimQuest:act,questProgress:()=>1000,canUnlockItem:()=>true}};
 p.bridge={lab:[{id:'test',max:3,cost:()=>1}],quests:[{id:'test',goal:1}]};p.menuOperationsAllowed=()=>true;p.menuProfileScopeCurrent=()=>true;p.safeAction=()=>true;p.completeSafeAction=()=>{};p.commitUnlockProfile=()=>{};
 const plan={goalMode:mode,goalProgress:{status:'ready',message:''},unlockAction:{kind,key:'test',price:1}};
 const result=await p.prepareUnlockMenuAction(plan,()=>true);assert.equal(calls,0);assert.equal(result,false);assert.match(plan.goalProgress.message,/关闭/);p.settings[key]=true;assert.equal(await p.prepareUnlockMenuAction(plan,()=>true),true);assert.equal(calls,1);
});
