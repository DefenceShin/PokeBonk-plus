import {test} from 'node:test';import assert from 'node:assert/strict';import {scoreMods} from '../src/policy.mjs';
test('status chance scoring preserves real empty move slots',()=>{for(const moves of [[null,null,null,null],[null,{def:{key:'rain-dance',arch:'weather'}}]])assert.equal(scoreMods([{stat:'statusChance',op:'mul',value:.2}],1,{moves,stats:{statusChance:1}}),0);});
