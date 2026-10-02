import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { serve } from './mcp.mjs';

const task = { goal: 'Verify 2+2', scope: 'Synthetic arithmetic', done_when: 'Return 4' };
const context = [
  { id: 'rules', text: 'Preserve the full context', protected: true, kind: 'instruction' },
  { id: 'required', text: 'Answer the calculation', protected: true, kind: 'requirement' },
  { id: 'pending', text: 'Calculation unfinished', protected: true, kind: 'unfinished' },
  ...['a', 'b', 'c'].map(id => ({ id, text: 'Reference '+id, protected: false, kind: 'reference' })),
];
function client(options = {}) {
  const input = new PassThrough(), output = new PassThrough();
  let sequence = 0, buffer = '';
  const pending = new Map();
  output.on('data', chunk => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n'), msg = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end+1);
      pending.get(msg.id)?.(msg); pending.delete(msg.id);
    }
  });
  serve({ input, output, apiKey: 'fixture-key', ...options });
  const request = (method, params={}) => new Promise(resolve => {
    const id = ++sequence; pending.set(id, resolve); input.write(JSON.stringify({ jsonrpc:'2.0', id, method, params })+'\n');
  });
  return { request, notify:(method,params)=>input.write(JSON.stringify({jsonrpc:'2.0',method,params})+'\n'), async call(name, args) {
    const msg = await request('tools/call', { name, arguments:args });
    assert.equal(msg.error, undefined); assert.equal(msg.result.isError, false);
    assert.deepEqual(JSON.parse(msg.result.content[0].text), msg.result.structuredContent);
    return msg.result.structuredContent;
  }, close:()=>input.end() };
}
const open = async c => ({ schema_version:1, subtask_id:(await c.call('jev_begin_subtask', {schema_version:1})).subtask_id, task, context: structuredClone(context) });
const noul = (body, value=0.5, usage) => ({answers:Object.fromEntries(Object.keys(JSON.parse(body).questions).map(key=>[key,{type:'noul',noul:value}])),usage});
test('S14: consumer preserves full launch inventory for complete, fallback and unavailable MCP; old Choice projection',async()=>{
  const { shadowContext, choiceContext }=await import('./shadow-context.mjs');
  const baseline=JSON.stringify(context), original=structuredClone(context);
  for(const status of ['shadow_complete','fallback','unavailable']){
    let sent;
    const result=await shadowContext({client:{call:async(name,args)=>{
      assert.equal(name,'jev_shadow_filter');sent=structuredClone(args);
      args.context[0].text='mutated transport';
      if(status==='unavailable')throw Error('RAW_ERROR');
      return {status,applied:false,context_action:'preserve_full',recommendations:[{fragment_id:'a',decision:'would_exclude'}]};
    }},subtask_id:'a'.repeat(32),task,context:original});
    assert.equal(JSON.stringify(result.context),baseline);assert.equal(JSON.stringify(original),baseline);
    assert.deepEqual(sent.context,context);assert.equal(result.status,status==='unavailable'?'mcp_unavailable':status);
  }
  assert.deepEqual(choiceContext(original),original.map(({kind,...item})=>item));
  const c=client({fetchImpl:async(url,o)=>Response.json(noul(o.body,1))});
  try{const args=await open(c);const r=await shadowContext({client:c,...args});
    assert.equal(r.status,'shadow_complete');assert.equal(JSON.stringify(r.context),baseline);
    await c.call('jev_end_subtask',{schema_version:1,subtask_id:args.subtask_id});
    const closed=await shadowContext({client:c,...args});assert.equal(closed.status,'fallback');assert.equal(JSON.stringify(closed.context),baseline);
  }finally{c.close();}
});
test('S01/S02/S03: external shadow Noul mapping, threshold and protected inventory', async () => {
  let body;
  const c=client({fetchImpl:async (url, options)=>{
    body=JSON.parse(options.body);
    return Response.json({answers:{f3:{type:'noul',noul:0.899999,confidence:1},f4:{type:'noul',noul:0.9,confidence:0},f5:{type:'noul',noul:1,raw:'DO_NOT_ECHO'}}});
  }});
  try {
    const names=(await c.request('tools/list')).result.tools.map(x=>x.name);
    assert.deepEqual(names,['jev_begin_subtask','jev_choice','jev_end_subtask','jev_shadow_filter']);
    const args=await open(c), r=await c.call('jev_shadow_filter',args);
    assert.equal(r.status,'shadow_complete'); assert.equal(r.mode,'shadow'); assert.equal(r.applied,false);
    assert.equal(r.threshold,0.9); assert.equal(r.context_action,'preserve_full'); assert.equal(r.fallback,null);
    assert.deepEqual(r.recommendations.map(x=>[x.fragment_id,x.p_unneeded,x.decision]),[
      ['rules',null,'protected'],['required',null,'protected'],['pending',null,'protected'],
      ['a',0.899999,'keep'],['b',0.9,'would_exclude'],['c',1,'would_exclude']]);
    assert.deepEqual(body.state,{task,context:args.context}); assert.deepEqual(Object.keys(body.questions),['f3','f4','f5']);
    assert.ok(body.questions.f3.instructions.includes('"a"')); assert.equal(r.measured.jev_requests,1);
    assert.ok(!JSON.stringify(r).includes('DO_NOT_ECHO'));
  } finally {c.close();}
});

test('S06: exact provider/argument byte limits and size pressure do not truncate state',async()=>{
  let calls=0,last;
  const c=client({now:()=>0,fetchImpl:async(url,o)=>{calls++;last=o.body;return Response.json(noul(o.body));}});
  try{
    const args=await open(c); args.context=[{id:'u',text:'я\\"🙂',protected:false,kind:'reference'}];
    assert.equal((await c.call('jev_shadow_filter',args)).status,'shadow_complete');
    args.context[0].text+='x'.repeat(12000-Buffer.byteLength(last));
    assert.equal((await c.call('jev_shadow_filter',args)).status,'shadow_complete');assert.equal(Buffer.byteLength(last),12000);
    args.context[0].text+='x';const before=calls;
    assert.equal((await c.call('jev_shadow_filter',args)).fallback.code,'input_limit');assert.equal(calls,before);
    args.context[0].text+='x'.repeat(12000-Buffer.byteLength(JSON.stringify(args)));
    assert.equal(Buffer.byteLength(JSON.stringify(args)),12000);
    assert.equal((await c.call('jev_shadow_filter',args)).fallback.code,'input_limit');assert.equal(calls,before);
    args.context[0].text+='x';assert.equal(Buffer.byteLength(JSON.stringify(args)),12001);
    assert.equal((await c.call('jev_shadow_filter',args)).fallback.code,'input_limit');assert.equal(calls,before);
    args.context=Array.from({length:9},(_,i)=>({id:`r${i}`,text:i===0?'x'.repeat(10000):'Reference',protected:false,kind:'reference'}));
    const bodies=[]; const pressure=client({fetchImpl:async(url,o)=>{bodies.push(o.body);return Response.json(noul(o.body));}});
    try{const p={...args,subtask_id:(await open(pressure)).subtask_id};
      assert.equal((await pressure.call('jev_shadow_filter',p)).status,'shadow_complete');
      assert.ok(bodies.length>2,JSON.stringify(bodies.map(b=>({bytes:Buffer.byteLength(b),questions:Object.keys(JSON.parse(b).questions).length}))));for(const b of bodies){assert.ok(Buffer.byteLength(b)<=12000);assert.deepEqual(JSON.parse(b).state.context,p.context);}
    }finally{pressure.close();}
  }finally{c.close();}
});

test('S08/S09/S12: time exhaustion between packets discards earlier estimates; incomplete usage stays null',async()=>{
  let time=0,calls=0;
  const c=client({now:()=>time,setTimer:()=>1,clearTimer:()=>{},fetchImpl:async(url,o)=>{
    calls++;time+=calls===1?29999:1;return Response.json(noul(o.body,1,calls===1?{input_tokens:2,output_tokens:3}:{input_tokens:4}));
  }});
  try{
    const args=await open(c);args.context=Array.from({length:17},(_,i)=>({id:`r${i}`,text:'Reference',protected:false,kind:'reference'}));
    const r=await c.call('jev_shadow_filter',args);
    assert.equal(r.fallback.code,'budget_time_exhausted');assert.equal(calls,2);assert.equal(r.budget.wait_ms_used,30000);
    assert.equal(r.measured.input_tokens,6);assert.equal(r.measured.output_tokens,null);
    assert.ok(r.recommendations.every(x=>x.decision==='unknown'&&x.p_unneeded===null));
    assert.equal((await c.call('jev_shadow_filter',args)).measured.jev_requests,0);
  }finally{c.close();}
});

test('S08: deadline caps at 5000 and floor(remaining), late success rejected; measured overrun visible',async()=>{
  for(const [wait,timeout] of [[24999,5000],[29999,1],[29999.5,null]]){
    let time=0,phase=0,timer,observed;
    const c=client({now:()=>time,setTimer:(fn,ms)=>{observed=ms;timer=fn;return 1;},clearTimer:()=>{},fetchImpl:async(url,o)=>{
      if(phase++===0)time+=wait;else{timer();time+=timeout+2;}
      return Response.json(noul(o.body));
    }});
    try{
      const args=await open(c);assert.equal((await c.call('jev_shadow_filter',args)).status,'shadow_complete');
      const r=await c.call('jev_shadow_filter',args);
      if(timeout===null){assert.equal(r.fallback.code,'budget_time_exhausted');assert.equal(r.measured.jev_requests,0);}
      else{assert.equal(observed,timeout);assert.equal(r.fallback.code,'provider_timeout');assert.equal(r.measured.jev_latency_ms,timeout+2);assert.equal(r.budget.wait_ms_used,wait+timeout+2);}
    }finally{c.close();}
  }
});

test('S09/S10: queued cancellation and mixed Choice serialization count only started HTTP',async()=>{
  let release,seen,calls=0,time=0;
  const ready=new Promise(resolve=>seen=resolve);
  const c=client({now:()=>time,fetchImpl:async(url,o)=>{
    calls++;if(calls===1){seen();await new Promise(resolve=>release=resolve);}
    return Response.json(JSON.parse(o.body).questions.tool?
      {answers:{tool:{type:'choice',choice:'luna_max',probabilities:{luna_max:0.9,sol_low:0.1}}}}:noul(o.body,1));
  }});
  try{
    const args=await open(c); // RPC 1
    const a=c.call('jev_shadow_filter',args);await ready; // RPC 2
    const b=c.call('jev_shadow_filter',args); // RPC 3
    c.notify('notifications/cancelled',{requestId:3});
    const d=c.call('jev_choice',{...args,context:args.context.map(({kind,...x})=>x)}); // RPC4
    await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
    time=400;c.notify('notifications/cancelled',{requestId:2});release();
    const [r,s,t]=await Promise.all([a,b,d]);
    assert.equal(r.fallback.code,'cancelled');assert.equal(s.fallback.code,'cancelled');assert.equal(s.measured.jev_requests,0);
    assert.equal(t.status,'selected');assert.equal(t.measured.jev_latency_ms,0);assert.equal(t.budget.requests_used,2);assert.equal(t.budget.wait_ms_used,400);
  }finally{c.close();}
});

test('S09/S10: close, TTL and restart cannot revive owners or allow subsequent packets',async()=>{
  for(const expire of [false,true]){
    let time=0,calls=0,release,seen;
    const ready=new Promise(resolve=>seen=resolve);
    const c=client({now:()=>time,setTimer:()=>1,clearTimer:()=>{},fetchImpl:async(url,o)=>{calls++;seen();await new Promise(resolve=>release=resolve);return Response.json(noul(o.body,1));}});
    try{
      const args=await open(c);args.context=Array.from({length:9},(_,i)=>({id:`r${i}`,text:'Reference',protected:false,kind:'reference'}));
      const pending=c.call('jev_shadow_filter',args);await ready;
      const queued=c.call('jev_shadow_filter',args);
      if(expire)time=3600000;else assert.equal((await c.call('jev_end_subtask',{schema_version:1,subtask_id:args.subtask_id})).status,'closed');
      release();for(const r of await Promise.all([pending,queued]))assert.equal(r.fallback.code,'lifecycle_unavailable');assert.equal(calls,1);
      const restarted=client();try{assert.equal((await restarted.call('jev_shadow_filter',args)).fallback.code,'lifecycle_unavailable');}finally{restarted.close();}
    }finally{c.close();}
  }
});

test('S09/S11: later invalid/HTTP/transport response discards earlier packet; bounded safe output',async()=>{
  for(const [mode,expected] of [[401,'provider_http_error'],[429,'provider_http_error'],[500,'provider_http_error'],[302,'redirect_rejected'],['network','provider_unavailable'],['json','malformed_response'],['size','response_limit'],['invalid','invalid_noul']]){
    let calls=0;
    const c=client({fetchImpl:async(url,o)=>{
      assert.equal(url,'https://api.typesafe.ai/v1/systemone');assert.equal(o.redirect,'error');assert.equal(o.headers.Authorization,'Bearer fixture-key');
      if(++calls===1)return Response.json(noul(o.body,1));
      if(typeof mode==='number')return new Response('RAW_SENTINEL',{status:mode});
      if(mode==='network')throw Error('RAW_SENTINEL');
      if(mode==='json')return new Response('RAW_SENTINEL');
      if(mode==='size')return new Response('x'.repeat(32769));
      return Response.json({answers:{},raw:'RAW_SENTINEL'});
    }});
    try{const args=await open(c);args.context=Array.from({length:17},(_,i)=>({id:`r${i}`,text:'Reference',protected:false,kind:'reference'}));
      const r=await c.call('jev_shadow_filter',args);assert.equal(r.fallback.code,expected);assert.equal(calls,2);
      assert.ok(r.recommendations.every(x=>x.decision==='unknown'));assert.ok(!JSON.stringify(r).includes('RAW_SENTINEL'));
    }finally{c.close();}
  }
});

test('S02/S03/S11: overrides, protection downgrade, invalid inventory and secrets reject before HTTP', async()=>{
  let calls=0;
  const c=client({fetchImpl:async()=>{calls++;throw Error('must not send');}});
  try {
    const args=await open(c);
    for(const [mutate,code] of [
      [a=>a.threshold=0.5,'invalid_request'],[a=>a.mode='apply','invalid_request'],[a=>a.applied=true,'invalid_request'],
      [a=>a.schema_version=2,'unsupported_schema'],[a=>a.context[0].protected=false,'invalid_request'],
      [a=>a.context[1].protected=false,'invalid_request'],[a=>a.context[2].protected=false,'invalid_request'],
      [a=>a.context[3].kind='arbitrary','invalid_request'],[a=>a.context[3].id='rules','invalid_request'],
      [a=>a.task.scope='secret=synthetic','secret_suspected'],[a=>a.context[3].text='Bearer synthetic','secret_suspected'],
      [a=>a.context[3].id='fixture-key','secret_suspected'],[a=>a.task.goal='x'.repeat(2049),'input_limit'],
    ]) {
      const a=structuredClone(args); mutate(a); const r=await c.call('jev_shadow_filter',a);
      assert.equal(r.fallback.code,code); assert.deepEqual(r.recommendations,[]); assert.equal(r.measured.jev_requests,0);
    }
    const r=await c.call('jev_shadow_filter',{...args,context:args.context.slice(0,3)});
    assert.equal(r.status,'shadow_complete'); assert.ok(r.recommendations.every(x=>x.decision==='protected')); assert.equal(calls,0);
  } finally {c.close();}
});

test('S05/S09: invalid answers including nonfinite wire values never produce partial recommendations',async()=>{
  let raw;
  const c=client({fetchImpl:async()=>new Response(raw)});
  try {
    const args=await open(c);
    const variants=[null,'0.9',true,-0.01,1.01];
    for(const value of variants){
      raw=JSON.stringify({answers:{f3:{type:'noul',noul:value},f4:{type:'noul',noul:1},f5:{type:'noul',noul:1}}});
      const r=await c.call('jev_shadow_filter',args); assert.equal(r.fallback.code,'invalid_noul');
      assert.ok(r.recommendations.slice(3).every(x=>x.p_unneeded===null&&x.decision==='unknown'));
    }
    for(const mutate of [r=>delete r.answers.f3,r=>r.answers.extra={type:'noul',noul:1},r=>r.answers.f3.type='choice',r=>{delete r.answers.f3.noul;r.answers.f3.confidence=1;}]){
      const r=noul(JSON.stringify({questions:{f3:0,f4:0,f5:0}}));mutate(r);raw=JSON.stringify(r);
      assert.equal((await c.call('jev_shadow_filter',args)).fallback.code,'invalid_noul');
    }
    raw='{"answers":{"f3":{"type":"noul","noul":1e999},"f4":{"type":"noul","noul":1},"f5":{"type":"noul","noul":1}}}';
    assert.equal((await c.call('jev_shadow_filter',args)).fallback.code,'invalid_noul');
  }finally{c.close();}
});

test('S04/S06/S12: full state in each bounded packet; aggregate usage distinct from cumulative budget',async()=>{
  const bodies=[];
  const c=client({now:()=>0,fetchImpl:async(url,o)=>{bodies.push(o.body);return Response.json(noul(o.body,0.5,{input_tokens:3,output_tokens:2}));}});
  try{
    const args=await open(c);
    args.context=[...args.context.slice(0,3),...Array.from({length:17},(_,i)=>({id:`r${i}`,text:'Одинаково\\"\n🙂',protected:false,kind:'reference'}))];
    const baseline=JSON.stringify(args);
    const r=await c.call('jev_shadow_filter',args);
    assert.equal(r.status,'shadow_complete');assert.equal(bodies.length,3);
    assert.deepEqual(bodies.map(b=>Object.keys(JSON.parse(b).questions).length),[8,8,1]);
    for(const b of bodies){assert.ok(Buffer.byteLength(b)<=12000);assert.deepEqual(JSON.parse(b).state,{task:args.task,context:args.context});}
    assert.equal(JSON.stringify(args),baseline);assert.equal(r.measured.input_tokens,9);assert.equal(r.measured.output_tokens,6);
    assert.equal(r.measured.subagent_runtime_ms,null);assert.equal(r.measured.cost_usd,null);
    assert.equal(r.budget.requests_used,3); assert.equal(r.measured.jev_requests,3);
    const again=await c.call('jev_shadow_filter',args);assert.equal(again.budget.requests_used,6);assert.equal(again.measured.jev_requests,3);
  }finally{c.close();}
});

test('S07: Choice/shadow use one owner, preflight all packets and do not reset remaining budget',async()=>{
  let calls=0;
  const c=client({now:()=>0,fetchImpl:async(url,o)=>{calls++;return Response.json(JSON.parse(o.body).questions.tool?
    {answers:{tool:{type:'choice',choice:'luna_max',probabilities:{luna_max:0.9,sol_low:0.1}}}}:noul(o.body));}});
  try{
    const args=await open(c),old={...args,context:args.context.map(({kind,...rest})=>rest)};
    for(let i=0;i<29;i++)assert.equal((await c.call('jev_choice',old)).status,'selected');
    const many={...args,context:Array.from({length:9},(_,i)=>({id:`r${i}`,text:'Reference',protected:false,kind:'reference'}))};
    let r=await c.call('jev_shadow_filter',many);assert.equal(r.fallback.code,'budget_requests_exhausted');assert.equal(r.measured.jev_requests,0);assert.equal(calls,29);
    r=await c.call('jev_shadow_filter',args);assert.equal(r.status,'shadow_complete');assert.equal(r.budget.requests_used,30);
    assert.equal((await c.call('jev_choice',old)).fallback.code,'budget_requests_exhausted');
    assert.equal((await c.call('jev_shadow_filter',args)).fallback.code,'budget_requests_exhausted');assert.equal(calls,30);
  }finally{c.close();}
});

test('S03/S06/S11/S12: 64 candidates, exact response limit, empty/protected zero requests and missing key',async()=>{
  let count=0,responseBytes=32768;
  const c=client({now:()=>0,fetchImpl:async(url,o)=>{
    count++;const payload=JSON.stringify(noul(o.body,0,{input_tokens:1,output_tokens:1}));
    return new Response(payload+' '.repeat(responseBytes-Buffer.byteLength(payload)));
  }});
  try{const args=await open(c);args.context=Array.from({length:64},(_,i)=>({id:`r${i}`,text:'Reference',protected:false,kind:'reference'}));
    const r=await c.call('jev_shadow_filter',args);assert.equal(r.status,'shadow_complete');assert.equal(r.measured.jev_requests,8);assert.equal(r.recommendations.length,64);
    responseBytes++;const tooLarge=await c.call('jev_shadow_filter',{...args,context:args.context.slice(0,1)});
    assert.equal(tooLarge.fallback.code,'response_limit');assert.equal(count,9);
    const empty=await c.call('jev_shadow_filter',{...args,context:[]});assert.equal(empty.status,'shadow_complete');assert.equal(empty.measured.input_tokens,null);assert.equal(empty.measured.jev_requests,0);
  }finally{c.close();}
  const noKey=client({apiKey:'',fetchImpl:()=>{throw Error('must not send');}});
  try{const args=await open(noKey);const r=await noKey.call('jev_shadow_filter',args);assert.equal(r.fallback.code,'missing_key');assert.equal(r.measured.jev_requests,0);
    const allProtected=await noKey.call('jev_shadow_filter',{...args,context:args.context.slice(0,3)});assert.equal(allProtected.status,'shadow_complete');
  }finally{noKey.close();}
});
