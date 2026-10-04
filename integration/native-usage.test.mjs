import test from 'node:test';
import assert from 'node:assert/strict';
import {collectNativeUsage,usageDelta} from './native-usage.mjs';

const expected={session_id:'child-1',agent_path:'/root/issue10_full',parent_thread_id:'parent-1',turn_ids:['turn-1'],model:'gpt-6.1-sol',effort:'low'};
const count=(input,cached,output)=>({type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{input_tokens:input,cached_input_tokens:cached,output_tokens:output}}}});
const fixture=()=>[
  {type:'session_meta',payload:{id:'child-1',source:{subagent:{thread_spawn:{agent_path:expected.agent_path,parent_thread_id:'parent-1'}}}}},
  {type:'turn_context',payload:{turn_id:'turn-1',model:expected.model,effort:expected.effort}},
  count(100,40,10),count(100,40,10),count(120,50,20),
  {type:'event_msg',payload:{type:'task_complete',duration_ms:250}},
];
test('native usage counts final complete cumulative once and cached is subset of input',()=>{
  const result=collectNativeUsage(fixture(),expected);
  assert.equal(result.status,'AVAILABLE');
  assert.deepEqual(result.usage,{input_tokens:120,cached_input_tokens:50,output_tokens:20});
  assert.equal(result.harness_duration_ms,250);
});

test('missing, partial, reset, wrong-arm/profile or ambiguous terminal produce UNKNOWN, never zero',()=>{
  for(const mutate of [
    x=>x.pop(),x=>x.splice(2,3),x=>delete x[2].payload.info.total_token_usage.output_tokens,
    x=>x[4]=count(99,20,5),x=>x[0].payload.id='other-arm',
    x=>x[1].payload.turn_id='other-turn',x=>x[1].payload.model='other-model',
    x=>x[1].payload.effort='max',x=>x.push(count(130,60,30)),
    x=>x.push({...x[5]}),x=>x[2]=count(10,11,1),x=>x.splice(5,0,{type:'response_item',payload:{type:'message'}}),
    x=>x[1].payload=null,x=>x.push(null),
  ]) {
    const rows=fixture();mutate(rows);
    const result=collectNativeUsage(rows,expected);
    assert.equal(result.status,'UNKNOWN');assert.equal(result.usage,null);
  }
});

test('primary delta requires complete same-scope counters and cannot conceal resets',()=>{
  const before={scope_id:'primary-window',input_tokens:1000,cached_input_tokens:400,output_tokens:100};
  const after={scope_id:'primary-window',input_tokens:1120,cached_input_tokens:450,output_tokens:120};
  assert.deepEqual(usageDelta(before,after).usage,{input_tokens:120,cached_input_tokens:50,output_tokens:20});
  assert.deepEqual(usageDelta(before,before).usage,{input_tokens:0,cached_input_tokens:0,output_tokens:0});
  for(const value of [{...after,scope_id:'other'},{...after,input_tokens:999},{...after,output_tokens:null}]) {
    assert.equal(usageDelta(before,value).status,'UNKNOWN');
  }
});

test('current attributed usage records must agree with final cumulative count and exact arm',()=>{
  const rows=fixture();
  rows.splice(5,0,{type:'token_usage_record',payload:{thread_id:expected.session_id,turn_id:'turn-1',thread_token_usage:{input_tokens:120,cached_input_tokens:50,output_tokens:20}}});
  assert.equal(collectNativeUsage(rows,expected).status,'AVAILABLE');
  for(const mutate of [x=>x[5].payload.thread_id='other',x=>x[5].payload.turn_id='other',x=>x[5].payload.thread_token_usage.input_tokens=121]) {
    const changed=structuredClone(rows);mutate(changed);
    assert.equal(collectNativeUsage(changed,expected).status,'UNKNOWN');
  }
});
