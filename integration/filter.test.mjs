import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { createChoice } from './choice.mjs';
import { serve } from './mcp.mjs';
import { contextBinding, sha256 } from './context-binding.mjs';
import { prepareContextDispatch, createContextAuthorization } from './filter-context.mjs';

const task = { goal: 'Return 4', scope: 'Synthetic read-only arithmetic', done_when: 'Show 2+2=4' };
const context = [
  { id: 'rules', text: 'Read-only. Preserve instructions.', protected: true, kind: 'instruction' },
  { id: 'requirements', text: 'Return 4', protected: true, kind: 'requirement' },
  { id: 'pending', text: 'No answer yet', protected: true, kind: 'unfinished' },
  ...['a','b','c'].map(id => ({ id, text: 'Reference ' + id, protected: false, kind: 'reference' })),
];
const policyFor = (t = task, c = context) => ({ approval_id: 'human-test-approval', revision: 2,
  manifest_sha256: 'b'.repeat(64), binding_sha256: contextBinding(t,c), threshold: 0.80, allowed_fragment_ids: ['a','b'] });
const noul = (body, p = 0.80) => ({ answers: Object.fromEntries(Object.keys(JSON.parse(body).questions).map(key => [key, { type: 'noul', noul: p }])) });
async function opened(options = {}) {
  let calls = 0;
  const engine = createChoice({ apiKey: 'fixture-key', now: () => 0,
    fetchImpl: async (url, options) => { calls++; return Response.json(noul(options.body)); }, ...options });
  const owner = await engine.call('jev_begin_subtask', { schema_version: 1 });
  return { engine, calls: () => calls, args: { schema_version: 1, subtask_id: owner.subtask_id, task: structuredClone(task), context: structuredClone(context), policy: policyFor() } };
}
function authorization() {
  const families = Array.from({ length: 6 }, (_, index) => {
    const t = index === 0 ? task : { ...task, goal: `Other frozen task ${index}` };
    return { id: `family${index}`, task_sha256: sha256(JSON.stringify(t)), binding_sha256: contextBinding(t,context),
      fragments: context.map(({ id, kind, protected: flag, text }) => ({ id, kind, protected: flag, text_sha256: sha256(text) })), allowed_fragment_ids: ['a','b'] };
  });
  return createContextAuthorization(JSON.stringify({ schema_version: 1, threshold: 0.80, families }));
}
const grant = auth => auth.authorize({ approval_id: 'human-test-approval', material_approved: true, privacy_accepted: true, provenance_verified: true });
const selected = id => ({ schema_version: 1, subtask_id: id, status: 'selected', fallback: null,
  profile: { id: 'luna_max', model: 'gpt-6-luna', effort: 'max' } });
const dispatch = async ({ engine, args }, auth, extras = {}) => prepareContextDispatch({ client: engine, ...args,
  choice: selected(args.subtask_id), authorization: auth, ownerActive: () => engine.remainingBudget(args.subtask_id) !== null, ...extras });
const receive = prepared => prepared.dispatch(value => value);

test('scoped real manifest v2 accepts one exact task, defaults off and dispatches only allowed references', async () => {
  const family = {
    id: 'real-audit', task_sha256: sha256(JSON.stringify(task)), binding_sha256: contextBinding(task, context),
    fragments: context.map(({id,kind,protected: flag,text}) => ({id,kind,protected:flag,text_sha256:sha256(text)})),
    allowed_fragment_ids: ['a'],
  };
  const auth = createContextAuthorization(JSON.stringify({schema_version:2, scenario:'scoped_real_pilot', threshold:0.80, tasks:[family]}));
  const fixture=await opened();
  assert.deepEqual(receive(await dispatch(fixture,auth)).context,context);
  grant(auth);
  assert.deepEqual(receive(await dispatch(fixture,auth)).context.map(row=>row.id),['rules','requirements','pending','b','c']);
  auth.revoke();
  assert.equal(auth.current(task,context),null);
});

test('scoped real v2 rejects malformed inventories and supports two distinct tasks', () => {
  const row = {id:'one',task_sha256:sha256(JSON.stringify(task)),binding_sha256:contextBinding(task,context),
    fragments:context.map(({id,kind,protected:flag,text})=>({id,kind,protected:flag,text_sha256:sha256(text)})),allowed_fragment_ids:['a']};
  const manifest={schema_version:2,scenario:'scoped_real_pilot',threshold:0.80,tasks:[row]};
  const secondTask={...task,goal:'Second real task'};
  const two=structuredClone(manifest); two.tasks.push({...structuredClone(row),id:'two',task_sha256:sha256(JSON.stringify(secondTask)),binding_sha256:contextBinding(secondTask,context)});
  const auth=createContextAuthorization(JSON.stringify(two)); grant(auth);
  assert.ok(auth.current(secondTask,context));
  for (const mutate of [
    x=>x.schema_version=3,x=>x.scenario='anything',x=>x.threshold=0.9,x=>x.extra=true,
    x=>x.tasks=[],x=>x.tasks.push(x.tasks[0]),x=>x.tasks=Array(3).fill(x.tasks[0]),
    x=>x.tasks[0].fragments[0].protected=false,x=>x.tasks[0].fragments[0].kind='reference',
    x=>x.tasks[0].fragments.push(x.tasks[0].fragments[0]),x=>x.tasks[0].fragments[0].text_sha256='bad',
    x=>x.tasks[0].allowed_fragment_ids=['rules'],x=>x.tasks[0].allowed_fragment_ids=['missing'],
    x=>x.tasks[0].allowed_fragment_ids=['a','a'],x=>x.tasks[0].id='x'.repeat(65536),
    x=>{ for(let i=0;i<59;i++)x.tasks[0].fragments.push({...x.tasks[0].fragments[3],id:`extra${i}`}); },
  ]) {
    const value=structuredClone(manifest); mutate(value);
    assert.throws(()=>createContextAuthorization(JSON.stringify(value)),/invalid_manifest/);
  }
});

test('C02/C03: filter threshold/allowed IDs and complete protected inventory; shadow remains 0.9', async () => {
  let sent;
  const { engine, args } = await opened({ fetchImpl: async (url, options) => {
    sent = JSON.parse(options.body);
    return Response.json({ answers: { f3: { type: 'noul', noul: 0.799999 }, f4: { type: 'noul', noul: 0.80 }, f5: { type: 'noul', noul: 1 } }, raw: 'RAW_PROVIDER_SENTINEL' });
  } });
  const r = await engine.call('jev_filter_context', args);
  assert.equal(r.status,'filter_complete'); assert.equal(r.applied,false); assert.equal(r.threshold,0.80);
  assert.deepEqual(r.recommendations.map(row => row.decision), ['protected','protected','protected','keep','would_exclude','keep']);
  assert.deepEqual(sent.state,{ task, context }); assert.equal(JSON.stringify(r).includes('RAW_PROVIDER_SENTINEL'),false);
  const { policy, ...oldArgs } = args;
  const shadow = await engine.call('jev_shadow_filter',oldArgs);
  assert.equal(shadow.threshold,0.9); assert.equal(shadow.context_action,'preserve_full'); assert.equal(shadow.recommendations[4].decision,'keep');
});

test('C01/C04/C05/C07: strict policy/version/binding/protection/secrets reject before HTTP', async () => {
  const { engine, args, calls } = await opened();
  const cases = [
    [x => delete x.policy,'invalid_request'], [x => x.policy.threshold=0.9,'invalid_policy'],
    [x => x.policy.revision=0,'invalid_policy'], [x => x.policy.allowed_fragment_ids=['a','a'],'invalid_policy'],
    [x => x.policy.allowed_fragment_ids=['rules'],'invalid_policy'], [x => x.policy.allowed_fragment_ids=['missing'],'invalid_policy'],
    [x => x.policy.enabled=true,'invalid_policy'], [x => x.policy.approval_id='bad ID','invalid_policy'],
    [x => x.schema_version=2,'unsupported_schema'], [x => x.task.goal+='changed','binding_mismatch'],
    [x => x.context.reverse(),'binding_mismatch'], [x => x.context[3].text+='changed','binding_mismatch'],
    [x => x.context[0].protected=false,'invalid_request'], [x => x.context[1].kind='unknown','invalid_request'],
    [x => {x.context[3].id='fixture-key';x.policy.allowed_fragment_ids=['fixture-key','b'];},'secret_suspected'], [x => x.policy.approval_id='fixture-key','secret_suspected'],
    [x => x.context[3].text='x'.repeat(200000),'binding_mismatch'],
  ];
  for (const [mutate, code] of cases) {
    const input=structuredClone(args); mutate(input);
    const r=await engine.call('jev_filter_context',input);
    assert.equal(r.fallback.code,code); assert.equal(r.context_action,'preserve_full'); assert.deepEqual(r.recommendations,[]);
  }
  assert.equal(calls(),0);
});

test('C06/C07: malformed provider and cancellation keep full; shared 30-request owner cannot reset', async () => {
  for (const p of [null, -1, 1.01, '0.80']) {
    const { engine, args }=await opened({fetchImpl:async (url,options)=>Response.json(noul(options.body,p))});
    const r=await engine.call('jev_filter_context',args);
    assert.equal(r.fallback.code,'invalid_noul'); assert.ok(r.recommendations.filter(row=>!row.protected).every(row=>row.p_unneeded===null));
  }
  const { engine,args,calls }=await opened();
  const controller=new AbortController(); controller.abort();
  assert.equal((await engine.call('jev_filter_context',args,controller.signal)).fallback.code,'cancelled');
  for(let i=0;i<30;i++) assert.equal((await engine.call(i%2?'jev_filter_context':'jev_shadow_filter',i%2?args:(({policy,...rest})=>rest)(args))).status,i%2?'filter_complete':'shadow_complete');
  assert.equal((await engine.call('jev_filter_context',args)).fallback.code,'budget_requests_exhausted'); assert.equal(calls(),30);
  await engine.call('jev_end_subtask',{schema_version:1,subtask_id:args.subtask_id});
  assert.equal((await engine.call('jev_filter_context',args)).fallback.code,'lifecycle_unavailable');
  const restarted=await opened();
  assert.equal((await restarted.engine.call('jev_filter_context',args)).fallback.code,'lifecycle_unavailable');
});

test('C01/C03/C04/C08: default full, scoped exact selection, immutable originals, revoke/revision/cached copy',async()=>{
  const fixture=await opened(), auth=authorization(), baseline=JSON.stringify(context);
  const off=receive(await dispatch(fixture,auth)); assert.equal(off.receipt.applied,false); assert.deepEqual(off.context,context); assert.equal(fixture.calls(),0);
  grant(auth);
  const prepared=await dispatch(fixture,auth);
  // Exposed advisory copy must not mutate the private selection or receipt.
  prepared.result.recommendations[3].p_unneeded=0;
  const on=receive(prepared); assert.equal(on.receipt.applied,true); assert.deepEqual(on.context.map(row=>row.id),['rules','requirements','pending','c']);
  assert.equal(on.receipt.excluded[0].p_unneeded,0.80); assert.equal(JSON.stringify(context),baseline); assert.equal(JSON.stringify(fixture.args.context),baseline);
  assert.throws(()=>receive(prepared),/dispatch_already_used/);
  for(const change of [()=>auth.revoke(),()=>{auth.revoke();grant(auth);}]){
    grant(auth); const waiting=await dispatch(fixture,auth); change();
    assert.deepEqual(receive(waiting).context,context);
  }
  grant(auth); const stale=structuredClone(fixture.args.context); stale[3].text+='changed';
  const unknown=receive(await dispatch(fixture,auth,{context:stale})); assert.deepEqual(unknown.context,stale); assert.equal(unknown.receipt.applied,false);
  assert.equal(authorization().current(task,context),null); // fresh process defaults off
});

test('C05/C06/C08: consumer rejects missing/duplicate/nonfinite/forged/stale/cross-owner responses and closed owner',async()=>{
  const fixture=await opened(), auth=authorization(); grant(auth);
  const invalidRows = [
    r=>r.recommendations.pop(),r=>r.recommendations[4]=r.recommendations[3],r=>r.recommendations[3].p_unneeded=NaN,
    r=>r.recommendations[3].p_unneeded=null,r=>r.recommendations[0].decision='would_exclude',
    r=>r.policy_revision++,r=>r.binding_sha256='c'.repeat(64),r=>r.subtask_id='d'.repeat(32),
    r=>r.schema_version=2,r=>r.mode='shadow',r=>r.applied=true,r=>r.threshold=0.9,
  ];
  for(const mutate of invalidRows){
    const client={call:async(name,args)=>{const r=await fixture.engine.call(name,args);mutate(r);return r;}};
    assert.deepEqual(receive(await dispatch(fixture,auth,{client})).context,context);
  }
  for(const choice of [null,{...selected(fixture.args.subtask_id),status:'fallback'},selected('f'.repeat(32)),
    {...selected(fixture.args.subtask_id),profile:{id:'luna_max',model:'gpt-6-luna',effort:'low'}}]) {
    assert.deepEqual(receive(await dispatch(fixture,auth,{choice})).context,context);
  }
  assert.deepEqual(receive(await dispatch(fixture,auth,{client:{call:async()=>{throw Error('RAW_ERROR');}}})).context,context);
  const prepared=await dispatch(fixture,auth);
  await fixture.engine.call('jev_end_subtask',{schema_version:1,subtask_id:fixture.args.subtask_id});
  assert.deepEqual(receive(prepared).context,context);
});

test('C06: later packet failure discards all earlier recommendations, time/TTL/response overflow remain full',async()=>{
  for(const mode of ['invalid','time','ttl','overflow']){
    let count=0,time=0;
    const fixture=await opened({now:()=>time,setTimer:()=>1,clearTimer:()=>{},fetchImpl:async(url,options)=>{
      count++;
      if(mode==='time')time+=30000;
      if(mode==='ttl')time=3600000;
      if(mode==='overflow')return new Response('x'.repeat(32769));
      return Response.json(count===2?{answers:{}}:noul(options.body,1));
    }});
    const args=fixture.args;
    args.context=Array.from({length:17},(_,i)=>({id:`r${i}`,text:'Synthetic reference',kind:'reference',protected:false}));
    args.policy=policyFor(task,args.context);args.policy.allowed_fragment_ids=['r0'];
    const r=await fixture.engine.call('jev_filter_context',args);
    assert.equal(r.status,'fallback');assert.equal(r.context_action,'preserve_full');assert.ok(r.recommendations.every(row=>row.p_unneeded===null));
  }
});

test('C06: measured time exhaustion on the final packet also preserves full context',async()=>{
  let time=0;
  const {engine,args}=await opened({now:()=>time,setTimer:()=>1,clearTimer:()=>{},fetchImpl:async(url,options)=>{
    time=30000;return Response.json(noul(options.body,1));
  }});
  const r=await engine.call('jev_filter_context',args);
  assert.equal(r.fallback.code,'budget_time_exhausted');assert.equal(r.context_action,'preserve_full');
  assert.ok(r.recommendations.filter(row=>!row.protected).every(row=>row.p_unneeded===null));
});

test('C09: JSON-RPC discovery and actual stdio filtering advisory output, no launch commands',async()=>{
  const input=new PassThrough(),output=new PassThrough();let sequence=0,buffer='';const pending=new Map();
  output.on('data',chunk=>{buffer+=chunk;while(buffer.includes('\n')){const end=buffer.indexOf('\n');const msg=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);pending.get(msg.id)(msg);pending.delete(msg.id);}});
  serve({input,output,apiKey:'fixture-key',fetchImpl:async(url,options)=>Response.json(noul(options.body,1))});
  const rpc=(method,params={})=>new Promise(resolve=>{const id=++sequence;pending.set(id,resolve);input.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
  const call=async(name,args)=>(await rpc('tools/call',{name,arguments:args})).result.structuredContent;
  try{
    const listed=(await rpc('tools/list')).result.tools;
    assert.equal(listed.length,6);assert.ok(listed.find(row=>row.name==='jev_filter_context').inputSchema.required.includes('policy'));
    const owner=await call('jev_begin_subtask',{schema_version:1});
    const r=await call('jev_filter_context',{schema_version:1,subtask_id:owner.subtask_id,task,context,policy:policyFor()});
    assert.equal(r.status,'filter_complete');assert.equal(r.applied,false);assert.equal(r.recommendations[5].decision,'keep');
    assert.equal((await call('jev_end_subtask',{schema_version:1,subtask_id:owner.subtask_id})).status,'closed');
  }finally{input.end();}
});
