import fs from 'node:fs';
import assert from 'node:assert/strict';
import {analyzeReviewedMasteryHelpers,reviewedMasteryEarning} from './reviewed-mastery-compiler.mjs';
const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url),'utf8'));
const native=read('evidence/native-skins.json'),catalog=read('evidence/unlock-catalog-base.json'),local=read('source/data/localization.json'),audit=read('evidence/skin-audit.json').result;
const helpers=analyzeReviewedMasteryHelpers(native.helpers);assert.equal(helpers.supported,true);
const targets=new Map(catalog.targets.map(t=>[t.id,t])),owned=(field,value)=>({kind:'owned',field,value}),all=conditions=>({kind:'all',conditions});
const metrics={healed:'恢复生命值',ultimates:'释放终极技能',electro:'触发感电',dodges:'闪避',rainKills:'雨天击败敌人',rocks:'打碎岩石',berries:'拾取树果',chests:'开启宝箱',soaked:'使敌人浸湿',evolutions:'进化',poisoned:'使敌人中毒',paralyzed:'使敌人麻痹',burned:'使敌人灼伤',slept:'使敌人睡眠',crits:'暴击',gold:'获得金币',confused:'使敌人混乱',frozen:'使敌人冰冻',alphas:'击败首领',kills:'击败敌人',maxLevel:'达到等级',maxTime:'生存秒数'};
const names={forest:'翠绿森林',desert:'岩石沙漠',coast:'风暴海岸',glacier:'天蓝冰川',canela:'红莲岛',cave:'华蓝洞窟',encina:'栎树林',iris:'圆朱市'};
const evidence={gameVersion:'0.9.13',sourceURL:native.source.url,sourceHash:native.source.sha256,description:'Current native mastery factories, counters and claim rewards; independently extracted from public module'};
function describe(earning,goal){const c=earning.constraints||{},who=local.pokemon?.[earning.member]||'#'+earning.member,details=[];
 if(earning.metric==='wins')details.push('标准模式'+(earning.minTier===2?'噩梦':earning.minTier===1?'困难及以上':'普通及以上')+'胜利'+(goal>1?' '+goal+' 次':''));
 else details.push((earning.singleRun?'单局':'累计')+(metrics[earning.metric]||earning.metric)+' '+goal);
 if(earning.biome)details.push(names[earning.biome]||earning.biome);
 if(earning.bitTargets)details.push(earning.bitTargets.map(b=>b.biome?names[b.biome]:b.finalSpecies.map(id=>local.pokemon?.[id]||'#'+id).join('/')).join('、'));
 if(c.finalSpecies)details.push((c.finalSpeciesAtClear?'通关时':'最终')+'形态为 '+c.finalSpecies.map(id=>local.pokemon?.[id]||'#'+id).join('/'));
 if(c.maxFinalSpecies)details.push('通关时保持指定进化阶段（编号不超过 '+c.maxFinalSpecies+'）');
 if(c.damageShare)details.push((local.moves?.[c.damageShare.key]||c.damageShare.key)+'及其融合招式伤害占比至少 '+Math.round(c.damageShare.min*100)+'%');
 if(c.maxHits!=null)details.push('单人受击不超过 '+c.maxHits+' 次');if(c.minHits!=null)details.push('受击超过 '+c.minHits+' 次');
 if(c.maxTime!=null)details.push('用时少于 '+c.maxTime+' 秒');if(c.minTime!=null&&!c.initialSpeciesHold)details.push('用时超过 '+c.minTime+' 秒');
 if(c.initialSpeciesHold)details.push('无尽中以鲤鱼王保持初始形态至少 600 秒');
 return '使用'+who+'起始：'+details.join('；');}
const rows=[];
for(const look of native.looks){const earning=reviewedMasteryEarning(look,helpers);assert.ok(earning,'unreviewed '+look.member+':'+look.n);
 if(earning.constraints?.requiredBiome){earning.biome=earning.constraints.requiredBiome;delete earning.constraints.requiredBiome;}
 if(earning.constraints?.requiredTier!=null){earning.minTier=earning.constraints.requiredTier;delete earning.constraints.requiredTier;}
 earning.allowCoop=!Number.isFinite(earning.constraints?.maxHits);
 const id=look.member,n=look.n,key=`lk${id}_${n}`,counter=`lk:${id}:${n}`,cosmetic=`look:${id}:${n}`,quest=native.quests.find(q=>q.id===key);assert.ok(quest);assert.equal(quest.goal,look.rule.goal);
 const label=describe(earning,quest.goal),name=(local.pokemon?.[id]||'#'+id)+' · 专属外观'+(n===1?'一':'二');
 const info={member:id,level:n,key:'m'+n,style:look.style,palette:look.pal,questId:key,cosmeticKey:cosmetic,rule:look.rule};
 targets.set('achievements:'+key,{id:'achievements:'+key,category:'achievements',key,nativeId:key,name,counter,goal:quest.goal,acquisition:label,requirements:[owned('league',id),{kind:'counter',counter,goal:quest.goal,label,description:label,mastery:earning}],completion:owned('quests',key),action:{kind:'claim-quest',key},reward:{dust:quest.reward,cosmetics:[cosmetic]},look:info,automation:{earningSupported:true,reason:label},executable:true,evidence});
 targets.set(`appearance:skin-m${n}:${id}`,{id:`appearance:skin-m${n}:${id}`,category:'appearance',key:`skin-m${n}:${id}`,nativeId:cosmetic,name,acquisition:label+'；达标后领取原生成就奖励。',requirements:[],dependencies:['characters:'+id,'achievements:'+key],sources:[],availability:{state:'available'},completion:all([owned('league',id),owned('cosmetics',cosmetic)]),action:{kind:'claim-quest',key},look:info,executable:true,evidence});
 rows.push({member:id,level:n,goal:quest.goal,earning});
}
// Current map/character definitions are already read at runtime; persist the
// same public records for offline planning and the desktop target selectors.
for(const t of audit.catalog.targets.filter(t=>t.category==='maps'||t.category==='characters'))targets.set(t.id,t);
catalog.targets=[...targets.values()];catalog.rules.lookLeagueMemberIds=audit.roster.map(r=>r.id);catalog.rules.masteryLookCount=rows.length;catalog.rules.masteryAutomaticEarningCount=rows.length;
catalog.skinReview={...evidence,looks:rows.length,legendaryLooksPending:native.legendary.length};
fs.writeFileSync(new URL('source/data/unlock-catalog.json',import.meta.url),JSON.stringify(catalog));
fs.writeFileSync(new URL('evidence/compiled-mastery.json',import.meta.url),JSON.stringify({helpers,rows},null,2));console.log('Compiled '+rows.length+' current native mastery routes');
