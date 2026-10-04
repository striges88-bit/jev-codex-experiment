import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { serve } from './mcp.mjs';

const task = { goal: 'Calculate 2+2', scope: 'Synthetic arithmetic', done_when: 'Return 4' };
const context = [{ id:'rule', text:'Keep the full context', protected:true, kind:'instruction' }];
const material = { answer:'4', baseline:'Synthetic result absent', diff:'Added result 4', checks:'2+2=4 checked' };
function client(options={}) {
  const input=new PassThrough(), output=new PassThrough(); let seq=0, buffer=''; const pending=new Map();
  output.on('data', chunk=>{buffer+=chunk; while(buffer.includes('\n')) {
    const end=buffer.indexOf('\n'), msg=JSON.parse(buffer.slice(0,end)); buffer=buffer.slice(end+1);
    pending.get(msg.id)?.(msg); pending.delete(msg.id);
  }});
  serve({input,output,apiKey:'fixture-key',...options});
  const request=(method,params={})=>new Promise(resolve=>{const id=++seq;pending.set(id,resolve);input.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
  return {request,notify:(method,params)=>input.write(JSON.stringify({jsonrpc:'2.0',method,params})+'\n'), async call(name,args){const msg=await request('tools/call',{name,arguments:args});
    assert.equal(msg.error,undefined);assert.deepEqual(JSON.parse(msg.result.content[0].text),msg.result.structuredContent);return msg.result.structuredContent;},close:()=>input.end()};
}
const open=async c=>({schema_version:1,subtask_id:(await c.call('jev_begin_subtask',{schema_version:1})).subtask_id,task,context:structuredClone(context),material:structuredClone(material)});
function response(body,score=2.5,p=0.5) {
  const probabilities=Object.fromEntries([0,1,2,3,4].map(n=>[n,0]));
  probabilities[Math.floor(score)]=1-(score%1); if(score%1)probabilities[Math.ceil(score)]=score%1;
  return {answers:Object.fromEntries(Object.entries(JSON.parse(body).questions).map(([key,q])=>[key,q.type==='score'?
    {type:'score',score,legend:Object.fromEntries(q.criteria.map((text,i)=>[i,text])),probabilities,confidence:0.2}:{type:'noul',noul:p}])),usage:{input_tokens:10,output_tokens:5}};
}
test('E01/E02/E04: public MCP combines three fractional Score and five positive Noul, without provider pass',async()=>{
  let bodies=[];const c=client({fetchImpl:async(url,o)=>{bodies.push(JSON.parse(o.body));return Response.json(response(o.body));}});
  try{const args=await open(c);const listed=(await c.request('tools/list')).result.tools;
    assert.ok(listed.some(x=>x.name==='jev_evaluate'));
    const r=await c.call('jev_evaluate',args);assert.equal(r.status,'estimated');assert.equal(bodies.length,1);
    assert.equal(Object.keys(bodies[0].questions).length,8);assert.deepEqual(bodies[0].state,{task,context,material});
    assert.deepEqual(Object.keys(r.quality),['correctness','completeness','verification']);
    for(const row of Object.values(r.quality)){assert.equal(row.raw_score,2.5);assert.equal(row.normalized_score,0.625);assert.equal(row.rubric_id,'quality-v1');}
    for(const row of Object.values(r.invariants)){assert.equal(row.p_compliant,0.5);assert.equal(row.pass,null);assert.equal(row.status,'unknown');assert.deepEqual(row.evidence,[]);}
    assert.equal(r.measured.jev_requests,1);assert.equal(r.budget.requests_used,1);
  }finally{c.close();}
});

test('E10/E11: cancellation, queue, close/TTL/restart reject late success and never revive an owner',async()=>{
  for(const event of ['cancel','close','ttl']){let release,started,calls=0,time=0;
    const ready=new Promise(resolve=>started=resolve);const wait=new Promise(resolve=>release=resolve);
    const c=client({now:()=>time,fetchImpl:async(url,o)=>{calls++;started();await wait;return Response.json(response(o.body));}});
    try{const args=await open(c),first=c.call('jev_evaluate',args);await ready;
      const second=c.call('jev_evaluate',args); // begin=RPC1, first=2, second=3
      if(event==='cancel'){c.notify('notifications/cancelled',{requestId:2});c.notify('notifications/cancelled',{requestId:3});}
      if(event==='close')await c.call('jev_end_subtask',{schema_version:1,subtask_id:args.subtask_id});
      if(event==='ttl')time=3600000;
      release();const a=await first,b=await second;assert.equal(a.fallback.code,event==='cancel'?'cancelled':'lifecycle_unavailable');
      assert.equal(b.fallback.code,event==='cancel'?'cancelled':'lifecycle_unavailable');assert.equal(calls,1);
      assert.equal(a.measured.jev_requests,1);assert.equal(b.measured.jev_requests,0);
      const restarted=client();try{assert.equal((await restarted.call('jev_evaluate',args)).fallback.code,'lifecycle_unavailable');}finally{restarted.close();}
    }finally{c.close();}
  }
});

test('E10/E12: actual overrun consumes wait, bounded timeout and <1ms stop before HTTP',async()=>{
  let time=0,timeoutMs=[];const c=client({now:()=>time,setTimer:(fn,ms)=>{timeoutMs.push(ms);return 1;},clearTimer:()=>{},
    fetchImpl:async(url,o)=>{time+=timeoutMs.length<=5?5000:4999.5;return Response.json(response(o.body));}});
  try{const args=await open(c);for(let i=0;i<6;i++)await c.call('jev_evaluate',args);
    const r=await c.call('jev_evaluate',args);assert.equal(r.fallback.code,'budget_time_exhausted');assert.equal(r.measured.jev_requests,0);
    assert.equal(r.budget.wait_ms_used,29999.5);assert.deepEqual(timeoutMs,[5000,5000,5000,5000,5000,5000]);
  }finally{c.close();}
  let fired;const late=client({setTimer:(fn,ms)=>{assert.equal(ms,5000);fired=fn;return 1;},clearTimer:()=>{},
    fetchImpl:async(url,o)=>{fired();return Response.json(response(o.body));}});
  try{const r=await late.call('jev_evaluate',await open(late));assert.equal(r.fallback.code,'provider_timeout');assert.equal(r.measured.jev_requests,1);}finally{late.close();}
});

test('E10: remaining 5001ms caps at5000, remaining1ms permits one attempt; scheduler overrun is not clamped',async()=>{
  let time=0,count=0,deadlines=[];const c=client({now:()=>time,setTimer:(fn,ms)=>{deadlines.push(ms);return 1;},clearTimer:()=>{},
    fetchImpl:async(url,o)=>{count++;time+=count<=5?4999.8:count===6?5000:1;return Response.json(response(o.body));}});
  try{const args=await open(c);for(let i=0;i<7;i++)assert.equal((await c.call('jev_evaluate',args)).status,'estimated');
    assert.deepEqual(deadlines,[5000,5000,5000,5000,5000,5000,1]);assert.equal(time,30000);
    assert.equal((await c.call('jev_evaluate',args)).fallback.code,'budget_time_exhausted');assert.equal(count,7);
  }finally{c.close();}
  time=0;const over=client({now:()=>time,setTimer:()=>1,clearTimer:()=>{},fetchImpl:async(url,o)=>{time+=30500;return Response.json(response(o.body));}});
  try{const args=await open(over),r=await over.call('jev_evaluate',args);assert.equal(r.measured.jev_latency_ms,30500);assert.equal(r.budget.wait_ms_used,30500);
    assert.equal((await over.call('jev_evaluate',args)).measured.jev_requests,0);}finally{over.close();}
});

test('E12/E15: provider failures are sanitized and consume real requests; missing key sends none',async()=>{
  const cases=[['provider_http_error',async()=>new Response('RAW_SECRET',{status:401})],
    ['provider_http_error',async()=>new Response('RAW_SECRET',{status:429})],['provider_http_error',async()=>new Response('RAW_SECRET',{status:500})],
    ['redirect_rejected',async()=>new Response('RAW_SECRET',{status:302})],['malformed_response',async()=>new Response('RAW_SECRET')],
    ['response_limit',async()=>new Response('x'.repeat(32769))],['provider_unavailable',async()=>{throw Error('RAW_SECRET');}]];
  for(const [code,fetchImpl] of cases){const c=client({fetchImpl});try{const r=await c.call('jev_evaluate',await open(c));
    assert.equal(r.fallback.code,code);assert.equal(r.measured.jev_requests,1);assert.equal(r.budget.requests_used,1);
    assert.equal(r.measured.input_tokens,null);assert.ok(!JSON.stringify(r).includes('RAW_SECRET'));}finally{c.close();}}
  const c=client({apiKey:''});try{const r=await c.call('jev_evaluate',await open(c));assert.equal(r.fallback.code,'missing_key');assert.equal(r.measured.jev_requests,0);}finally{c.close();}
});

test('E02/E03/E04/E06: exact rubric, probability distributions and packet keys are validated, estimates roll back',async()=>{
  const mutations=[
    [r=>r.answers.correctness.score=-1,'invalid_score'],[r=>r.answers.correctness.score=5,'invalid_score'],
    [r=>r.answers.correctness.score=null,'invalid_score'],[r=>r.answers.correctness.score='2.5','invalid_score'],
    [r=>r.answers.correctness.type='noul','invalid_score'],[r=>delete r.answers.correctness.confidence,'invalid_score'],
    [r=>r.answers.correctness.confidence=1.1,'invalid_score'],[r=>r.answers.correctness.legend[0]='untrusted','invalid_score'],
    [r=>delete r.answers.correctness.legend[0],'invalid_score'],[r=>r.answers.correctness.probabilities[0]=0.1,'invalid_score'],
    [r=>r.answers.correctness.probabilities[2]=-0.1,'invalid_score'],[r=>r.answers.correctness.score=3,'invalid_score'],
    [r=>r.answers.scope_preserved.noul=-0.1,'invalid_noul'],[r=>r.answers.scope_preserved.noul='1','invalid_noul'],
    [r=>r.answers.scope_preserved.type='score','invalid_noul'],[r=>delete r.answers.secrets_protected,'invalid_assessment'],
    [r=>r.answers.extra={type:'noul',noul:1},'invalid_assessment'],
  ];
  for(const [mutate,code] of mutations){const c=client({fetchImpl:async(url,o)=>{const r=response(o.body);mutate(r);return Response.json(r);}});
    try{const r=await c.call('jev_evaluate',await open(c));assert.equal(r.fallback.code,code);
      assert.ok(Object.values(r.quality).every(row=>row.raw_score===null));assert.ok(Object.values(r.invariants).every(row=>row.p_compliant===null));
    }finally{c.close();}}
  for(const score of [0,4])for(const p of [0,0.5,1]){const c=client({fetchImpl:async(url,o)=>Response.json(response(o.body,score,p))});
    try{const r=await c.call('jev_evaluate',await open(c));assert.equal(r.quality.correctness.normalized_score,score===0?0:1);assert.equal(r.invariants.scope_preserved.p_compliant,p);}finally{c.close();}}
});

test('E05/E06/E15: large complete state reaches provider once; actual rejection leaves all estimates unknown',{timeout:2000},async()=>{
  for(const rejected of [false,true]){const bodies=[];const c=client({fetchImpl:async(url,o)=>{
    bodies.push(JSON.parse(o.body));return rejected?new Response('PRIVATE_ERROR_BODY',{status:413}):Response.json(response(o.body));
  }});
  try{const args=await open(c);args.material.baseline='界\n'.repeat(50000);const original=JSON.stringify(args);
    const r=await c.call('jev_evaluate',args);
    assert.equal(bodies.length,1);assert.ok(Buffer.byteLength(JSON.stringify(bodies[0]))>131072);
    assert.deepEqual(bodies[0].state,{task,context,material:args.material});assert.equal(Object.keys(bodies[0].questions).length,8);
    assert.equal(JSON.stringify(args),original);assert.equal(r.measured.jev_requests,1);
    if(rejected){assert.equal(r.fallback.code,'provider_http_error');assert.equal(r.fallback.action,'return_to_main_agent');
      assert.ok(Object.values(r.quality).every(x=>x.raw_score===null));assert.ok(Object.values(r.invariants).every(x=>x.p_compliant===null));
      assert.ok(!JSON.stringify(r).includes('PRIVATE_ERROR_BODY'));}
    else assert.equal(r.status,'estimated');
  }finally{c.close();}}
});

test('E09: secrets, nested overrides and unprotected instructions are rejected before HTTP without echo',async()=>{
  let calls=0;const c=client({fetchImpl:async()=>{calls++;throw Error('should not run');}});
  try{const args=await open(c);
    const edits=[a=>a.material.answer='Bearer synthetic-sensitive',a=>a.material.baseline='fixture-key',
      a=>a.material.diff='password=synthetic',a=>a.material.checks='token=synthetic',
      a=>a.context[0].id='fixture-key',a=>a.task.goal='fixture-key',a=>a.context[0].text='fixture-key'];
    for(const edit of edits){const a=structuredClone(args);edit(a);const r=await c.call('jev_evaluate',a);assert.equal(r.fallback.code,'secret_suspected');assert.equal(r.measured.jev_requests,0);assert.ok(!JSON.stringify(r).includes('fixture-key'));}
    for(const edit of [a=>a.model='override',a=>a.material.extra='override',a=>a.context[0].protected=false,a=>a.material.answer=null]){
      const a=structuredClone(args);edit(a);assert.equal((await c.call('jev_evaluate',a)).fallback.code,'invalid_request');
    }
    assert.equal(calls,0);
  }finally{c.close();}
});

test('E09: arguments and POST exceed former byte caps without truncating UTF-8, escapes or task text',{timeout:2000},async()=>{
  let bodies=[];const c=client({fetchImpl:async(url,o)=>{bodies.push(o.body);return Response.json(response(o.body));}});
  try{const args=await open(c);args.material.baseline='界\n'.repeat(50000);args.task={...task,goal:'Goal '.repeat(1000)};
    const r=await c.call('jev_evaluate',args);assert.equal(r.status,'estimated');assert.equal(bodies.length,1);
    assert.ok(Buffer.byteLength(JSON.stringify(args))>64000);assert.ok(Buffer.byteLength(bodies[0])>131072);
    assert.deepEqual(JSON.parse(bodies[0]).state,{task:args.task,context:args.context,material:args.material});
  }finally{c.close();}
});

test('E09/E15: final POST secret preflight and invalid/overflow usage fail safely',async()=>{
  let calls=0;const guarded=client({apiKey:'correctness',fetchImpl:async()=>{calls++;throw Error('must not run');}});
  try{const r=await guarded.call('jev_evaluate',await open(guarded));assert.equal(r.fallback.code,'secret_suspected');assert.equal(calls,0);}finally{guarded.close();}
  for(const usage of [undefined,{input_tokens:-1,output_tokens:2},{input_tokens:'1',output_tokens:null},{input_tokens:1e100,output_tokens:2}]){
    const c=client({fetchImpl:async(url,o)=>{const r=response(o.body);r.usage=usage;return Response.json(r);}});
    try{const r=await c.call('jev_evaluate',await open(c));assert.equal(r.status,'estimated');assert.equal(r.measured.input_tokens,null);assert.equal(r.measured.cost_usd,null);assert.equal(r.measured.subagent_runtime_ms,null);}finally{c.close();}
  }
  const c=client({fetchImpl:async(url,o)=>{const r=response(o.body);r.usage={input_tokens:Number.MAX_SAFE_INTEGER,output_tokens:1};return Response.json(r);}});
  try{const args=await open(c);args.material.baseline='x'.repeat(200000);const r=await c.call('jev_evaluate',args);assert.equal(r.measured.input_tokens,Number.MAX_SAFE_INTEGER);assert.equal(r.measured.jev_requests,1);}finally{c.close();}
});

test('E03: approved wire consistency budget preserves raw/distribution, accepts 0.055 and rejects larger discrepancy',async()=>{
  for(const [score,expected] of [[2.555,'estimated'],[2.555001,'fallback']]){const c=client({fetchImpl:async(url,o)=>{
    const r=response(o.body);for(const value of Object.values(r.answers))if(value.type==='score')value.score=score;return Response.json(r);
  }});
  try{const r=await c.call('jev_evaluate',await open(c));assert.equal(r.status,expected);
    if(expected==='estimated'){const q=r.quality.correctness;assert.equal(q.raw_score,2.555);assert.equal(q.normalized_score,0.63875);
      assert.equal(q.consistency.weighted_score,2.5);assert.ok(Math.abs(q.consistency.absolute_difference-0.055)<1e-12);
      assert.equal(q.consistency.tolerance,0.055);assert.deepEqual(q.provider_distribution,{0:0,1:0,2:0.5,3:0.5,4:0});}
    else {assert.equal(r.fallback.code,'invalid_score');assert.equal(r.quality.correctness.provider_distribution,null);assert.equal(r.quality.correctness.consistency,null);}
  }finally{c.close();}}
});

test('E10: Choice/shadow/evaluation share one owner; large request 30 sends once and request 31 sends HTTP0',async()=>{
  let calls=0;const c=client({fetchImpl:async(url,o)=>{calls++;const q=JSON.parse(o.body).questions;
    if(q.tool)return Response.json({answers:{tool:{type:'choice',choice:'luna_max',probabilities:{luna_max:1,sol_low:0}}}});
    if(Object.keys(q)[0]?.startsWith('f'))return Response.json({answers:Object.fromEntries(Object.keys(q).map(k=>[k,{type:'noul',noul:1}]))});
    return Response.json(response(o.body));
  }});
  try{const args=await open(c);await c.call('jev_choice',{...args,material:undefined,context:args.context.map(({kind,...v})=>v)});
    const shadow={...args};delete shadow.material;shadow.context.push({id:'reference',text:'Reference',kind:'reference',protected:false});await c.call('jev_shadow_filter',shadow);
    for(let i=0;i<27;i++)assert.equal((await c.call('jev_evaluate',args)).status,'estimated');
    assert.equal(calls,29);const large={...args,material:{...material,baseline:'x'.repeat(200000)}};
    const last=await c.call('jev_evaluate',large);assert.equal(last.budget.requests_used,30);assert.equal(last.measured.jev_requests,1);
    const blocked=await c.call('jev_evaluate',large);assert.equal(blocked.fallback.code,'budget_requests_exhausted');assert.equal(blocked.measured.jev_requests,0);assert.equal(calls,30);
    const r=await c.call('jev_evaluate',args);assert.equal(r.fallback.code,'budget_requests_exhausted');assert.equal(r.measured.jev_requests,0);assert.equal(calls,30);
  }finally{c.close();}
});
