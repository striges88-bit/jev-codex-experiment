import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,unlink,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createOriginalStore} from './compact-output.mjs';
import {createMainContextSelector} from './main-context.mjs';
import {qualityBinding} from './context-quality.mjs';
import http from 'node:http';
import {once} from 'node:events';
import {zstdCompressSync,zstdDecompressSync} from 'node:zlib';
import {createMainGateway} from './main-gateway.mjs';
import {responseContext} from './response-context.mjs';
import net from 'node:net';
import {encodeTextFrame} from './websocket-context.mjs';
import {sha256} from './context-binding.mjs';
import {writeFileSync} from 'node:fs';
import {createQualityPilot,qualityPilotCodeHashes} from './quality-pilot.mjs';

const pilotPacket=(fx,expires=Date.now()+60000)=>({schema_version:1,pilot_id:'live19-fixture',task_id:'fixture-task',
  thread_sha256:sha256(headers['thread-id']),scope_sha256:fx.binding.scope_sha256,binding_sha256:fx.binding.binding_sha256,
  policy_sha256:sha256(JSON.stringify(fx.policy)),code_hashes:qualityPilotCodeHashes(),expires_at_ms:expires,max_attempts:1});
test('Live19: no approval, wrong packet/thread/scope/inventory and explicit revoke preserve original',async t=>{
  for(const kind of ['absent','wrong approval','thread','scope','inventory','policy','revoked'])await t.test(kind,async()=>{
    const fx=await setup(),packet=pilotPacket(fx),grant={approved:true,packet_sha256:sha256(JSON.stringify(packet))};
    const pilot=createQualityPilot(packet,{approval:()=>kind==='absent'?null:kind==='wrong approval'?{...grant,packet_sha256:'f'.repeat(64)}:grant});
    if(kind==='revoked')pilot.revoke();
    const incoming=kind==='thread'?{...headers,'thread-id':'other-thread'}:headers;
    if(kind==='scope')fx.request.model='another-model';
    if(kind==='inventory')fx.request.input.push(message('new steering'));
    if(kind==='policy')fx.policy.revision++;
    const selected=await createMainContextSelector({authorizeQualityPilot:pilot.authorize}).select(fx.request,incoming,fx.policy);
    assert.equal(selected.applied,false);assert.deepEqual(selected.request,fx.request);
  });
});
test('Live19: expiry/revoked approval are rechecked at final WS commit; selected payload never escapes',async t=>{
  for(const kind of ['expiry','approval revoked','pilot revoked'])await t.test(kind,async()=>{
    const fx=await setup(),clock=Date.now(),packet=pilotPacket(fx,clock+60000);
    let current=clock,grant={approved:true,packet_sha256:sha256(JSON.stringify(packet))};
    const pilot=createQualityPilot(packet,{approval:()=>grant,now:()=>current});
    const flow=responseContext({selector:createMainContextSelector({authorizeQualityPilot:pilot.authorize}),policy:()=>fx.policy,headers});
    const before=Buffer.from(JSON.stringify({type:'response.create',...fx.request}));
    const pending=await flow.prepare(before);assert.equal(pending.receipt.task_state_attached,true);
    if(kind==='expiry')current=clock+60000;
    if(kind==='approval revoked')grant.approved=false;
    if(kind==='pilot revoked')pilot.revoke();
    assert.deepEqual(pending.commit(),before);assert.equal(pending.receipt.applied,false);
    assert.equal(pending.receipt.task_state_attached,false);assert.equal(pilot.status().attempts,1);
  });
});
test('Live19: approved exact duplicate packet removes only its frozen occurrence; failed originals spend attempt',async()=>{
  const fx=await duplicate(await setup()),packet=pilotPacket(fx);
  const pilot=createQualityPilot(packet,{approval:()=>({approved:true,packet_sha256:sha256(JSON.stringify(packet))})});
  const selected=await createMainContextSelector({authorizeQualityPilot:pilot.authorize}).select(fx.request,headers,fx.policy);
  assert.deepEqual(selected.request.input.slice(0,-1),[fx.request.input[0],...fx.request.input.slice(2)]);
  assert.deepEqual(selected.excluded,[fx.binding.occurrences[1].id]);
  const bad=await setup(),badPacket=pilotPacket(bad);
  const badPilot=createQualityPilot(badPacket,{approval:()=>({approved:true,packet_sha256:sha256(JSON.stringify(badPacket))})});
  await unlink(bad.state.sources[0].original.path);
  const failure=await createMainContextSelector({authorizeQualityPilot:badPilot.authorize}).select(bad.request,headers,bad.policy);
  assert.equal(failure.applied,false);assert.equal(badPilot.status().attempts,1);
});
test('Live19: malformed code versions, lifetime or expanded caps cannot construct an owner',async()=>{
  const fx=await setup(),packet=pilotPacket(fx);
  for(const invalid of [{...packet,max_attempts:2},{...packet,expires_at_ms:Date.now()+16*60000},
      {...packet,code_hashes:{}},{...packet,untrusted_override:true}])assert.throws(()=>createQualityPilot(invalid),/invalid_pilot_packet/);
});
test('Live19: wall-clock rollback cannot extend the monotonic pilot lease',async()=>{
  const fx=await setup(),clock=Date.now(),packet=pilotPacket(fx,clock+60000);
  let wall=clock,tick=100;
  const pilot=createQualityPilot(packet,{now:()=>wall,monotonic:()=>tick,approval:()=>({approved:true,packet_sha256:sha256(JSON.stringify(packet))})});
  wall-=600000;tick+=60000;
  const selected=await createMainContextSelector({authorizeQualityPilot:pilot.authorize}).select(fx.request,headers,fx.policy);
  assert.equal(selected.applied,false);assert.deepEqual(selected.request,fx.request);
});
test('Live19: a locally approved exact packet grants one state-only attempt; second attempt is full',async()=>{
  const fx=await setup(),expires=Date.now()+60000;
  const packet={schema_version:1,pilot_id:'live19-fixture',task_id:'fixture-task',
    thread_sha256:sha256(headers['thread-id']),scope_sha256:fx.binding.scope_sha256,
    binding_sha256:fx.binding.binding_sha256,policy_sha256:sha256(JSON.stringify(fx.policy)),
    code_hashes:qualityPilotCodeHashes(),expires_at_ms:expires,max_attempts:1};
  const approval={packet_sha256:sha256(JSON.stringify(packet)),approved:true};
  const pilot=createQualityPilot(packet,{approval:()=>approval});
  const selector=createMainContextSelector({authorizeQualityPilot:pilot.authorize});
  const first=await selector.select(fx.request,headers,fx.policy);
  assert.equal(first.applied,true);assert.deepEqual(first.request.input,[...fx.request.input,expectedStateItem(fx.state)]);
  const second=await selector.select(fx.request,headers,fx.policy);
  assert.equal(second.applied,false);assert.deepEqual(second.request,fx.request);
  assert.equal(pilot.status().attempts,1);
});

const headers={'thread-id':'quality-fixture-thread','chatgpt-account-id':'quality-fixture-account','content-type':'application/json'};
const message=text=>({type:'message',role:'assistant',content:[{type:'output_text',text}]});
const original=()=>({model:'fixture-model',instructions:'fixture instructions',tools:[],input:[message('artifact line 🦉\n'),message('artifact line 🦉\n'),...Array.from({length:8},(_,i)=>message(`tail ${i}`))]});
const expectedStateItem=state=>message('JEV task state v1 (required context):\n'+JSON.stringify({schema_version:1,task_id:'fixture-task',revision:state.revision,data:state.data,field_sources:state.field_sources,empty_fields:state.empty_fields,sources:state.sources}));
async function setup(request=original(),overrides={}) {
  const dir=await mkdtemp(join(tmpdir(),'jev-quality-')),store=createOriginalStore(dir);
  const sourceDocument={goal:'Finish fixture',requirements:['Retain originals'],criteria:[{id:'A1',requirement:'Retain originals',source:'fixture-spec',evidence_required:'actual bytes'}],decisions:[],results:[],unfinished:['Verify fixture'],...overrides};
  const source=await store.publish({stdout:Buffer.from(JSON.stringify(sourceDocument)),stderr:Buffer.alloc(0),provenance:{run_id:randomUUID(),profile:'task-source-json-v1'}});
  const record=(value,pointer)=>({value,source:{id:'spec',pointer},status:'current'});
  const state={schema_version:1,task_id:'fixture-task',revision:1,
    data:{goal:record(sourceDocument.goal,'/goal'),requirements:sourceDocument.requirements.map((value,i)=>record(value,`/requirements/${i}`)),frozen_criteria:sourceDocument.criteria.map((value,i)=>record(value,`/criteria/${i}`)),
      decisions:sourceDocument.decisions.map((value,i)=>({...record(value,`/decisions/${i}`),status:value.status==='unresolved'?'unresolved':'current'})),verified_results:sourceDocument.results.map((value,i)=>({...record(value,`/results/${i}`),status:'verified'})),unfinished:sourceDocument.unfinished.map((value,i)=>record(value,`/unfinished/${i}`)),readback_links:[source]},
    field_sources:{goal:{id:'spec',pointer:'/goal'},requirements:{id:'spec',pointer:'/requirements'},frozen_criteria:{id:'spec',pointer:'/criteria'},decisions:{id:'spec',pointer:'/decisions'},verified_results:{id:'spec',pointer:'/results'},unfinished:{id:'spec',pointer:'/unfinished'}},
    empty_fields:['decisions','verified_results'].filter(name=>name==='decisions'?!sourceDocument.decisions.length:!sourceDocument.results.length),sources:[{id:'spec',original:source}],protected_occurrences:[]};
  const binding=qualityBinding(request,headers,'fixture-task','inventory-1',state);state.binding_sha256=binding.binding_sha256;
  const policy={schema_version:2,enabled:true,mode:'filter',approval_id:'global-jev-opt-in-20261003',revision:1,task_id:'fixture-task',bindings:[{...binding,state,deliveries:[],duplicates:[]}]};
  return {request,policy,binding,state,store,dir,sourceDocument};
}

async function duplicate(fx,candidate=1,canonical=0,{independent=false}={}) {
  const row=fx.policy.bindings[0],deliveries=[];
  for(const index of [canonical,candidate]) {
    const occurrence=fx.binding.occurrences[index],provenance={run_id:randomUUID(),profile:'context-group-json-v1',task_id:row.task_id,inventory_revision:row.inventory_revision,occurrence_id:occurrence.id,artifact_id:independent?`independent-${index}`:'fixture-artifact-1',role_function:'artifact reference delivery'};
    const original=await fx.store.publish({stdout:Buffer.from(JSON.stringify(fx.request.input.slice(occurrence.start,occurrence.end+1))),stderr:Buffer.alloc(0),provenance});
    deliveries.push({occurrence_id:occurrence.id,artifact_id:provenance.artifact_id,role_function:provenance.role_function,original});
  }
  const grant={schema_version:1,task_id:row.task_id,revision:fx.policy.revision,inventory_revision:row.inventory_revision,binding_sha256:row.binding_sha256,
    candidate_id:fx.binding.occurrences[candidate].id,canonical_id:fx.binding.occurrences[canonical].id,artifact_id:'fixture-artifact-1',role_function:'artifact reference delivery',basis:'repeat-delivery-same-artifact'};
  const permission=await fx.store.publish({stdout:Buffer.from(JSON.stringify({grant})),stderr:Buffer.alloc(0),provenance:{run_id:randomUUID(),profile:'occurrence-permission-json-v1'}});
  row.deliveries=deliveries;row.duplicates=[{schema_version:1,candidate_id:grant.candidate_id,canonical_id:grant.canonical_id,permission:{original:permission,pointer:'/grant'}}];
  return fx;
}

test('C02: state-only transformation forwards exact sourced state, preserving all original items',async()=>{
  const fx=await setup(),before=structuredClone(fx.request);
  const selected=await createMainContextSelector({allowOfflineFilter:true}).select(fx.request,headers,fx.policy);
  assert.equal(selected.applied,true);assert.equal(selected.task_state_attached,true);assert.equal(selected.duplicate_removed,false);
  assert.deepEqual(selected.request,{...before,input:[...before.input,expectedStateItem(fx.state)]});
  assert.deepEqual(fx.request,before);
});

test('C03: only the permitted same-artifact occurrence disappears; canonical and both CLI readbacks remain exact',async()=>{
  const fx=await duplicate(await setup()),before=structuredClone(fx.request),selected=await createMainContextSelector({allowOfflineFilter:true}).select(fx.request,headers,fx.policy);
  assert.equal(selected.applied,true);assert.equal(selected.duplicate_removed,true);
  assert.deepEqual(selected.request.input.slice(0,-1),[before.input[0],...before.input.slice(2)]);
  assert.deepEqual(selected.excluded,[fx.binding.occurrences[1].id]);assert.deepEqual(fx.request,before);
  assert.equal(selected.reconstruction.length,1);assert.equal(selected.reconstruction[0].occurrence_id,fx.binding.occurrences[1].id);
  const execute=promisify(execFile);
  for(const delivery of fx.policy.bindings[0].deliveries) {
    const ref=join(fx.dir,delivery.occurrence_id===fx.binding.occurrences[0].id?'canonical.json':'candidate.json');
    await writeFile(ref,JSON.stringify(delivery.original));
    for(let i=0;i<2;i++) {
      const readback=JSON.parse((await execute(process.execPath,['integration/test-output.mjs','read',ref],{windowsHide:true})).stdout);
      assert.equal(readback.stdout.data,'[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"artifact line 🦉\\n"}]}]');
      assert.equal(readback.stderr.data,'');assert.equal(readback.provenance.occurrence_id,delivery.occurrence_id);
    }
  }
});

async function httpFixture(t,fx,getPolicy=()=>fx.policy,gatewayOptions={}) {
  const received=[],receipts=[],upstreamSockets=new Set(),upstream=http.createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    received.push({headers:req.headers,path:req.url,bytes:Buffer.concat(chunks)});res.end('ok');
  });
  upstream.on('connection',socket=>{upstreamSockets.add(socket);socket.on('close',()=>upstreamSockets.delete(socket));});
  upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  const gateway=createMainGateway({capability:'e'.repeat(32),testUpstream:true,upstream:`http://127.0.0.1:${upstream.address().port}`,policy:getPolicy,receipt:row=>receipts.push(structuredClone(row)),...gatewayOptions});
  gateway.server.listen(0,'127.0.0.1');await once(gateway.server,'listening');
  t.after(async()=>{await gateway.stop();for(const socket of upstreamSockets)socket.destroy();upstream.closeAllConnections();await new Promise(resolve=>upstream.close(resolve));});
  const url=`http://127.0.0.1:${gateway.server.address().port}/jev/${'e'.repeat(32)}/backend-api/codex/responses`;
  const send=async(bytes,extra={},route='')=>{const response=await fetch(url+route,{method:'POST',headers:{...headers,...extra},body:bytes});assert.equal(response.status,200);await response.text();await new Promise(resolve=>setImmediate(resolve));return received.at(-1);};
  return {received,receipts,send,upstream,gateway,url};
}

test('C06: actual HTTP identity/zstd state+duplicate bytes and hash-only receipts match the frozen oracle',async t=>{
  const fx=await duplicate(await setup()),transport=await httpFixture(t,fx);
  const expected={...fx.request,input:[fx.request.input[0],...fx.request.input.slice(2),expectedStateItem(fx.state)]};
  for(const encoding of ['identity','zstd']) {
    const bytes=Buffer.from(JSON.stringify(fx.request,null,2)),wire=encoding==='zstd'?zstdCompressSync(bytes):bytes;
    const received=await transport.send(wire,{'content-encoding':encoding,authorization:'Bearer synthetic-fixture'});
    const decoded=encoding==='zstd'?zstdDecompressSync(received.bytes):received.bytes;
    assert.ok(decoded.equals(Buffer.from(JSON.stringify(expected))),'exact forwarded JSON bytes');assert.equal(received.headers.authorization,'Bearer synthetic-fixture');
    const receipt=transport.receipts.at(-1);assert.equal(receipt.applied,true);assert.equal(receipt.task_state_attached,true);assert.equal(receipt.duplicate_removed,true);
    assert.doesNotMatch(JSON.stringify(transport.receipts),/Finish fixture|Retain originals|synthetic-fixture|artifact line|quality-fixture-account|\.original/);
  }
});

test('C06: WS state+duplicate, unchanged prefix reuse, stale delta and revoke reconstruct the full original',async()=>{
  const fx=await duplicate(await setup()),request={type:'response.create',...fx.request};let policy=fx.policy;
  const ctx=responseContext({selector:createMainContextSelector({allowOfflineFilter:true}),policy:()=>policy,headers});
  const first=await ctx.prepare(Buffer.from(JSON.stringify(request)));
  assert.equal(first.receipt.task_state_attached,true);assert.deepEqual(JSON.parse(first.payload).input.slice(0,-1),[request.input[0],...request.input.slice(2)]);
  ctx.observe(Buffer.from('{"type":"response.completed","response":{"id":"first","output":[]}}'));
  const noChange=Buffer.from(JSON.stringify({...request,previous_response_id:'first',input:[]}));
  const reused=await ctx.prepare(noChange);assert.equal(reused.receipt.incremental_reused,true);assert.deepEqual(reused.payload,noChange);
  ctx.observe(Buffer.from('{"type":"response.completed","response":{"id":"second","output":[]}}'));
  const added=message('artifact line 🦉\n'),delta=Buffer.from(JSON.stringify({...request,previous_response_id:'second',input:[added]}));
  const restored=await ctx.prepare(delta);
  assert.deepEqual(JSON.parse(restored.payload),{...request,previous_response_id:null,input:[...request.input,added]});
  assert.equal(restored.receipt.full_context_restored,true);assert.equal(restored.receipt.applied,false);
  const other=responseContext({selector:createMainContextSelector({allowOfflineFilter:true}),policy:()=>policy,headers});
  await other.prepare(Buffer.from(JSON.stringify(request)));other.observe(Buffer.from('{"type":"response.completed","response":{"id":"first","output":[]}}'));
  policy={...policy,enabled:false};const revoked=await other.prepare(Buffer.from(JSON.stringify({...request,previous_response_id:'first',input:[added]})));
  assert.deepEqual(JSON.parse(revoked.payload).input,[...request.input,added]);assert.equal(revoked.receipt.full_context_restored,true);
});

const rebind=fx=>{
  const old=fx.policy.bindings[0],binding=qualityBinding(fx.request,headers,'fixture-task','inventory-1',fx.state);
  fx.state.binding_sha256=binding.binding_sha256;fx.binding=binding;Object.assign(old,binding);
};
const full=async(fx,extraHeaders=headers)=>{
  const result=await createMainContextSelector({allowOfflineFilter:true}).select(fx.request,extraHeaders,fx.policy);
  assert.equal(result.applied,false);assert.deepEqual(result.request,fx.request);assert.deepEqual(result.excluded,[]);return result;
};

test('C02: complete sourced results/unfinished/conflicting decisions remain visible; conflict cannot authorize pruning',async()=>{
  const decisions=[{text:'keep artifact',status:'unresolved',source:'fixture-one'},{text:'remove artifact',status:'unresolved',source:'fixture-two'}];
  const fx=await setup(original(),{decisions,results:[{status:'PASS',scope:'offline fixture',date:'2026-10-05',evidence:'fixture bytes'}]});
  const selected=await createMainContextSelector({allowOfflineFilter:true}).select(fx.request,headers,fx.policy);
  assert.equal(selected.applied,true);assert.deepEqual(selected.request.input.at(-1),expectedStateItem(fx.state));
  const visible=JSON.parse(selected.request.input.at(-1).content[0].text.split('\n')[1]);
  assert.deepEqual(visible.data.decisions.map(row=>row.value),decisions);assert.equal(visible.data.verified_results[0].value.scope,'offline fixture');
  await duplicate(fx);await full(fx);
});

test('C02/C04: missing, invented, incomplete, stale or unverified-empty state restores the whole original',async t=>{
  const cases={
    missing_goal:fx=>delete fx.state.data.goal,
    invented_goal:fx=>fx.state.data.goal.value='invented',
    missing_requirements:fx=>delete fx.state.data.requirements,
    dropped_requirement:fx=>{fx.state.data.requirements=[];fx.state.empty_fields.push('requirements');},
    invented_criterion:fx=>fx.state.data.frozen_criteria[0].value.requirement='invented',
    missing_unfinished:fx=>delete fx.state.data.unfinished,
    stale_revision:fx=>fx.state.revision++,
    missing_readback:fx=>fx.state.data.readback_links=[],
    missing_field_source:fx=>delete fx.state.field_sources.decisions,
    unverified_empty:fx=>fx.state.empty_fields=[],
    source_pointer:fx=>fx.state.data.requirements[0].source.pointer='/missing',
    unknown_version:fx=>fx.state.schema_version=91,
    mismatched_task:fx=>fx.state.task_id='other',
    unknown_protection:fx=>fx.state.protected_occurrences.push('invented-occurrence'),
  };
  for(const [id,mutate] of Object.entries(cases))await t.test(id,async()=>{
    const fx=await duplicate(await setup());mutate(fx);
    // Rebind malformed data where possible to exercise state validation itself.
    if(id!=='stale_revision')try{rebind(fx);}catch{}
    await full(fx);
  });
  await t.test('omitted_conflict',async()=>{
    const fx=await setup(original(),{decisions:[{text:'retain',status:'unresolved'},{text:'exclude',status:'unresolved'}]});
    fx.state.data.decisions=[];fx.state.empty_fields.push('decisions');rebind(fx);await full(fx);
  });
});

test('C04: no permission inheritance, semantic comparison, independent observation removal or legacy downgrade',async t=>{
  const cases={
    identical_append:fx=>fx.request.input.push(message('artifact line 🦉\n')),
    nonidentical_append:fx=>fx.request.input.push(message('new data')),
    steering:fx=>fx.request.input.push({type:'message',role:'user',content:[{type:'input_text',text:'new instruction'}]}),
    compaction:fx=>fx.request.input.push({type:'compaction',encrypted_content:'fixture opaque'}),
    model_drift:fx=>fx.request.model='other',
    tools_drift:fx=>fx.request.tools=[{type:'function',name:'new-tool'}],
    instructions_drift:fx=>fx.request.instructions='new instructions',
    revision_drift:fx=>fx.policy.revision++,
    inventory_revision_drift:fx=>fx.policy.bindings[0].inventory_revision='new',
    task_drift:fx=>fx.policy.task_id='other',
    self_canonical:fx=>fx.policy.bindings[0].duplicates[0].canonical_id=fx.binding.occurrences[1].id,
    missing_canonical:fx=>fx.policy.bindings[0].duplicates[0].canonical_id='missing',
    boolean_only:fx=>fx.policy.bindings[0].duplicates=[{interchangeable:true,completed:true}],
    malformed_permission:fx=>delete fx.policy.bindings[0].duplicates[0].permission,
    permission_pointer:fx=>fx.policy.bindings[0].duplicates[0].permission.pointer='/unknown',
    ambiguous_canonical:fx=>fx.policy.bindings[0].duplicates.push(structuredClone(fx.policy.bindings[0].duplicates[0])),
    cycle:fx=>{const proof=structuredClone(fx.policy.bindings[0].duplicates[0]);[proof.candidate_id,proof.canonical_id]=[proof.canonical_id,proof.candidate_id];fx.policy.bindings[0].duplicates.push(proof);},
    downgrade:fx=>{fx.policy.schema_version=1;fx.policy.bindings[0].optional_groups=[{sha256:fx.binding.occurrences[1].sha256,completed:true,reason:'superseded_reference'}];},
    revoked:fx=>fx.policy.enabled=false,
    unsupported_policy:fx=>fx.policy.schema_version=40,
  };
  for(const [id,mutate]of Object.entries(cases))await t.test(id,async()=>{const fx=await duplicate(await setup());mutate(fx);await full(fx);});
  for(const key of ['thread-id','chatgpt-account-id'])await t.test(key,async()=>await full(await duplicate(await setup()),{...headers,[key]:'other'}));
  await t.test('independent_identical_observations',async()=>await full(await duplicate(await setup(),1,0,{independent:true})));
  for(const [id,mutate]of Object.entries({whitespace:r=>r.input[1].content[0].text='artifact line 🦉 \n',unicode:r=>r.input[1].content[0].text='artifact line 🦉\r\n',role:r=>{r.input[1].role='user';r.input[1].content[0].type='input_text';},metadata:r=>r.input[1].internal_chat_message_metadata_passthrough={turn_id:'another'}})) {
    await t.test(id,async()=>{const r=original();mutate(r);await full(await duplicate(await setup(r)));});
  }
  await t.test('different_call_ids',async()=>{
    const r=original();r.input.splice(0,2,...['first','second'].flatMap(call_id=>[{type:'function_call',name:'lookup',call_id,arguments:'{}'},{type:'function_call_output',call_id,output:'identical artifact'}]));
    await full(await duplicate(await setup(r)));
  });
});

test('C05: genuine permission never overrides protected classes or the recent 8 boundary',async t=>{
  const variants={
    must_keep:message('MUST_KEEP artifact'),requirements:message('required criterion'),unfinished:message('unfinished work'),evidence:message('C:/fixture/evidence'),
    protected_flag:{...message('plain artifact'),protected:true},metadata:{...message('plain artifact'),metadata:{reviewed:true}},
    legacy_review:{...message('plain artifact'),internal_chat_message_metadata_passthrough:{content_item_kinds:['unknown']}},
    developer:{type:'message',role:'developer',content:[{type:'input_text',text:'plain artifact'}]},
    system:{type:'message',role:'system',content:[{type:'input_text',text:'plain artifact'}]},
    user:{type:'message',role:'user',content:[{type:'input_text',text:'plain artifact'}]},
    opaque:{type:'compaction',encrypted_content:'fixture opaque'},reasoning:{type:'reasoning',summary:[],encrypted_content:'fixture opaque'},
    additional_tools:{type:'additional_tools',tools:[]},agent:{type:'agent_message',author:'fixture',recipient:'root',content:[{type:'encrypted_content',encrypted_content:'fixture opaque'}]},
    nontext:{type:'message',role:'assistant',content:[{type:'input_image',image_url:'fixture'}]},
  };
  for(const [id,item]of Object.entries(variants))await t.test(id,async()=>{const r=original();r.input[0]=structuredClone(item);r.input[1]=structuredClone(item);await full(await duplicate(await setup(r)));});
  await t.test('coordinator_required_evidence',async()=>{const fx=await duplicate(await setup());fx.state.protected_occurrences=[fx.binding.occurrences[1].id];await full(fx);});
  await t.test('recent8_boundary',async()=>{const r=original();r.input.pop();await full(await duplicate(await setup(r)));});
  await t.test('group9_removable',async()=>{const fx=await duplicate(await setup());assert.equal((await createMainContextSelector({allowOfflineFilter:true}).select(fx.request,headers,fx.policy)).duplicate_removed,true);});
  for(const kind of ['nested','parallel'])await t.test(kind,async()=>{
    const call=id=>({type:'function_call',name:'lookup',call_id:id,arguments:'{}'}),output=id=>({type:'function_call_output',call_id:id,output:'plain'}),r=original();
    r.input.splice(0,2,call('a'),call('b'),...(kind==='nested'?[output('b'),output('a')]:[output('a'),output('b')]),...Array.from({length:8},(_,i)=>message('tail '+i)));
    const fx=await setup(r);assert.equal(fx.binding.occurrences[0].end,3);
    fx.policy.bindings[0].duplicates=[{schema_version:1,candidate_id:fx.binding.occurrences[0].id,canonical_id:'partial-call',permission:{interchangeable:true}}];await full(fx);
  });
  for(const kind of ['unknown','orphan'])await t.test(kind,async()=>{
    const fx=await duplicate(await setup());fx.request.input.push(kind==='unknown'?{type:'future-item'}:{type:'function_call_output',call_id:'orphan',output:'plain'});await full(fx);
  });
});

test('C07: missing, malformed, collision and interrupted or mutated originals prevent transformation',async t=>{
  for(const kind of ['source','canonical','candidate','permission'])await t.test(`missing_${kind}`,async()=>{
    const fx=await duplicate(await setup()),row=fx.policy.bindings[0];
    const ref=kind==='source'?fx.state.sources[0].original:kind==='permission'?row.duplicates[0].permission.original:row.deliveries[kind==='canonical'?0:1].original;
    await unlink(ref.path);await full(fx);
  });
  for(const kind of ['mismatch','interrupted','directory','invalid_reference','invalid_utf8'])await t.test(kind,async()=>{
    const fx=await duplicate(await setup()),ref=fx.state.sources[0].original;
    if(kind==='invalid_reference')ref.id='invalid';
    else if(kind==='directory'){await unlink(ref.path);await mkdir(ref.path);}
    else await writeFile(ref.path,kind==='interrupted'?Buffer.alloc(0):kind==='invalid_utf8'?Buffer.from([255,254]):Buffer.from('mutated original'));
    await full(fx);
  });
  await t.test('collision',async()=>{
    const fx=await setup(),ref=fx.state.sources[0].original,value=await fx.store.read(ref);
    await assert.rejects(fx.store.publish(value));assert.ok((await readFile(ref.path)).length>0);
    const selected=await createMainContextSelector({allowOfflineFilter:true}).select(fx.request,headers,fx.policy);assert.equal(selected.applied,true);
  });
  await t.test('production_filter_disabled',async()=>{const fx=await duplicate(await setup());const selected=await createMainContextSelector().select(fx.request,headers,fx.policy);assert.equal(selected.applied,false);assert.deepEqual(selected.request,fx.request);});
});

test('C02/C06: exact existing state is reused, refresh keeps old protected state and requires a new binding',async()=>{
  const fx=await setup(),item=expectedStateItem(fx.state);fx.request.input.push(item);rebind(fx);
  const already=await createMainContextSelector({allowOfflineFilter:true}).select(fx.request,headers,fx.policy);
  assert.equal(already.applied,false);assert.equal(already.task_state_attached,false);assert.deepEqual(already.request,fx.request);
  const refreshed=await setup(fx.request,{goal:'Current revised fixture',unfinished:['Finish revised fixture']});
  refreshed.state.revision=2;rebind(refreshed);
  const result=await createMainContextSelector({allowOfflineFilter:true}).select(refreshed.request,headers,refreshed.policy);
  assert.equal(result.task_state_attached,true);assert.deepEqual(result.request.input.slice(0,-1),fx.request.input);
  assert.deepEqual(result.request.input.at(-2),item);assert.deepEqual(result.request.input.at(-1),expectedStateItem(refreshed.state));
});

test('C06/C07: shadow, unsafe parsing/encoding, compact and warmup preserve exact HTTP wire',async t=>{
  const fx=await duplicate(await setup());let policy=fx.policy;const transport=await httpFixture(t,fx,()=>policy);
  const originalBytes=Buffer.from(JSON.stringify(fx.request,null,2));
  for(const kind of ['shadow','disabled','compact','warmup','invalid_utf8','invalid_json','unknown_encoding','unknown_content_type','zstd_shadow']) {
    policy={...fx.policy,mode:kind.includes('shadow')?'shadow':'filter',enabled:kind!=='disabled'};
    const bytes=kind==='invalid_utf8'?Buffer.from([255,254]):kind==='invalid_json'?Buffer.from('{ invalid JSON'):
      kind==='warmup'?Buffer.from(JSON.stringify({...fx.request,generate:false},null,2)):kind==='zstd_shadow'?zstdCompressSync(originalBytes):originalBytes;
    const extra=kind==='unknown_encoding'?{'content-encoding':'future'}:kind==='unknown_content_type'?{'content-type':'text/plain'}:kind==='zstd_shadow'?{'content-encoding':'zstd'}:{};
    const received=await transport.send(bytes,extra,kind==='compact'?'/compact':'');
    assert.ok(received.bytes.equals(bytes),kind+' exact wire');assert.equal(transport.receipts.at(-1).applied,false);
    if(kind.includes('shadow')){assert.equal(transport.receipts.at(-1).would_attach_state,true);assert.deepEqual(transport.receipts.at(-1).would_exclude,[fx.binding.occurrences[1].id]);}
  }
});

test('C06/C07: callback mutation/revoke/filter exception and original fault at HTTP commit use full wire',async t=>{
  for(const kind of ['inplace_revision','revoke','exception','state_drift','original_changed'])await t.test(kind,async t=>{
    const fx=await duplicate(await setup());let calls=0;
    const getPolicy=()=>{
      calls++;
      if(calls===2) {
        if(kind==='inplace_revision')fx.policy.revision++;
        if(kind==='revoke')fx.policy.enabled=false;
        if(kind==='exception')throw Error('fixture callback fault');
        if(kind==='state_drift')fx.state.data.goal.value='unverified revision';
      }
      // Final HTTP prewrite after selector and its immediate post-read guard.
      if(calls===3&&kind==='original_changed'){
        // Synchronous mutation deliberately happens during the actual commit check.
        const ref=fx.state.sources[0].original;writeFileSync(ref.path,'corrupt original');
      }
      return fx.policy;
    };
    const transport=await httpFixture(t,fx,getPolicy),bytes=Buffer.from(JSON.stringify(fx.request,null,2));
    assert.ok((await transport.send(bytes)).bytes.equals(bytes));assert.equal(transport.receipts.at(-1).applied,false);
  });
});

// Independent frame parser for captures; handles arbitrary TCP splits/masking.
function frameReader(onPayload) {
  let buffer=Buffer.alloc(0);
  return chunk=>{
    buffer=Buffer.concat([buffer,chunk]);
    while(buffer.length>=2) {
      let size=buffer[1]&127,offset=2;
      if(size===126){if(buffer.length<4)return;size=buffer.readUInt16BE(2);offset=4;}
      if(size===127){if(buffer.length<10)return;size=Number(buffer.readBigUInt64BE(2));offset=10;}
      const masked=Boolean(buffer[1]&128),key=buffer.subarray(offset,offset+4);if(masked)offset+=4;
      if(buffer.length<offset+size)return;
      const payload=Buffer.from(buffer.subarray(offset,offset+size));if(masked)for(let i=0;i<payload.length;i++)payload[i]^=key[i%4];
      buffer=buffer.subarray(offset+size);onPayload(payload);
    }
  };
}
async function wsFixture(t,fx,getPolicy=()=>fx.policy,gatewayOptions={}) {
  const transport=await httpFixture(t,fx,getPolicy,gatewayOptions),actual=[],replies=[],waiters=[];
  transport.upstream.on('upgrade',(_req,socket)=>{
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: fixture\r\n\r\n');
    socket.on('data',frameReader(bytes=>{actual.push(bytes);socket.write(encodeTextFrame(Buffer.from(JSON.stringify({type:'response.completed',response:{id:`response-${actual.length}`,output:replies[actual.length-1]??[]}})),false));}));
  });
  const client=net.connect(transport.gateway.server.address().port,'127.0.0.1');t.after(()=>client.destroy());await once(client,'connect');
  client.write(`GET /jev/${'e'.repeat(32)}/backend-api/codex/responses HTTP/1.1\r\nHost: 127.0.0.1:${transport.gateway.server.address().port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nthread-id: quality-fixture-thread\r\nchatgpt-account-id: quality-fixture-account\r\n\r\n`);
  const [upgrade]=await once(client,'data');assert.match(upgrade.toString(),/101 Switching Protocols/);
  client.on('data',frameReader(bytes=>waiters.shift()?.(JSON.parse(bytes))));
  const send=async bytes=>{const completed=new Promise(resolve=>waiters.push(resolve));client.write(encodeTextFrame(bytes,true));await completed;await new Promise(resolve=>setImmediate(resolve));return actual.at(-1);};
  return {...transport,actual,replies,client,send};
}

test('C06: actual WS full/delta renewed state, signature drift and revoke restore original in upstream captures',{timeout:10000},async t=>{
  const fx=await duplicate(await setup()),request={type:'response.create',...fx.request};let policy=fx.policy;
  const transport=await wsFixture(t,fx,()=>policy),output=message('completed observation');transport.replies.push([output],[],[]);
  const first=await transport.send(Buffer.from(JSON.stringify(request,null,2)));
  assert.ok(first.equals(Buffer.from(JSON.stringify({...request,input:[request.input[0],...request.input.slice(2),expectedStateItem(fx.state)]}))));
  const added=message('delta observation'),reconstructed={...request,previous_response_id:null,input:[...request.input,output,added]};
  const fresh=await duplicate(await setup(reconstructed,{goal:'Current revised fixture'}));fresh.state.revision=2;rebind(fresh);
  // Reissue occurrence grants for the exact revised state binding.
  await duplicate(fresh);policy=fresh.policy;
  const delta=Buffer.from(JSON.stringify({...request,previous_response_id:'response-1',input:[added]})),second=await transport.send(delta);
  assert.deepEqual(JSON.parse(second),{...reconstructed,input:[reconstructed.input[0],...reconstructed.input.slice(2),expectedStateItem(fresh.state)]});
  assert.equal(transport.receipts.filter(row=>row.phase==='message_forwarded').at(-1).incremental_reused,false);
  policy={...policy,enabled:false};const last=message('third observation');
  const third=await transport.send(Buffer.from(JSON.stringify({...request,previous_response_id:'response-2',input:[last]})));
  assert.deepEqual(JSON.parse(third),{...request,previous_response_id:null,input:[...request.input,output,added,last]});
  const receipt=transport.receipts.filter(row=>row.phase==='message_forwarded').at(-1);
  assert.equal(receipt.full_context_restored,true);assert.equal(receipt.request_changed,true);assert.equal(receipt.task_state_attached,false);
  assert.equal(receipt.after_sha256,sha256(third));assert.equal(receipt.upstream_body_written,true);
  assert.doesNotMatch(JSON.stringify(transport.receipts),/artifact line|Current revised|\.original|quality-fixture-account/);
  await writeFile('tasks/issue-19/ws-captures.json',JSON.stringify({original:request,first:JSON.parse(first),second:JSON.parse(second),third:JSON.parse(third),receipts:transport.receipts},null,2)+'\n');
});

test('C06: WS sink rechecks authority/originals after preparation; unknown filtered chain closes',{timeout:10000},async t=>{
  for(const kind of ['revoke','original_changed'])await t.test(kind,async t=>{
    const fx=await duplicate(await setup()),request={type:'response.create',...fx.request};let calls=0;
    const transport=await wsFixture(t,fx,()=>{calls++;if(calls===3){if(kind==='revoke')fx.policy.enabled=false;else writeFileSync(fx.state.sources[0].original.path,'corrupt original');}return fx.policy;});
    const bytes=Buffer.from(JSON.stringify(request,null,2)),received=await transport.send(bytes);
    assert.ok(received.equals(bytes),'exact original after final WS sink check');assert.equal(transport.receipts.filter(row=>row.phase==='message_forwarded').at(-1).applied,false);
  });
  await t.test('unknown_chain_after_selection',async t=>{
    const fx=await duplicate(await setup()),request={type:'response.create',...fx.request},transport=await wsFixture(t,fx);
    await transport.send(Buffer.from(JSON.stringify(request)));const closed=once(transport.client,'close');
    transport.client.write(encodeTextFrame(Buffer.from(JSON.stringify({...request,previous_response_id:'unknown-chain',input:[message('delta')]})),true));
    await closed;assert.equal(transport.actual.length,1);assert.equal(transport.receipts.at(-1).reason,'context_chain_unavailable');
  });
});

test('C04: genuinely sourced cycle/chain proofs cannot remove the retained canonical',async t=>{
  for(const kind of ['cycle','chain'])await t.test(kind,async()=>{
    const request=original();if(kind==='chain')request.input.splice(2,0,message('artifact line 🦉\n'));
    const fx=await duplicate(await setup(request)),first=structuredClone(fx.policy.bindings[0]);
    await duplicate(fx,kind==='cycle'?0:2,kind==='cycle'?1:1);
    const second=fx.policy.bindings[0];second.duplicates.push(...first.duplicates);
    second.deliveries=[...new Map([...second.deliveries,...first.deliveries].map(row=>[row.occurrence_id,row])).values()];
    await full(fx);
  });
});

test('C06: active chain commit revoke restores the full prefix; output-order faults and reconnect never invent it',async()=>{
  const fx=await duplicate(await setup()),request={type:'response.create',...fx.request};let policy=fx.policy;
  const ctx=responseContext({selector:createMainContextSelector({allowOfflineFilter:true}),policy:()=>policy,headers});
  const first=await ctx.prepare(Buffer.from(JSON.stringify(request)));first.commit();
  ctx.observe(Buffer.from('{"type":"response.completed","response":{"id":"first","output":[]}}'));
  const prepared=await ctx.prepare(Buffer.from(JSON.stringify({...request,previous_response_id:'first',input:[]})));
  assert.equal(prepared.receipt.incremental_reused,true);policy={...policy,enabled:false};
  assert.deepEqual(JSON.parse(prepared.commit()),{...request,previous_response_id:null});assert.equal(prepared.receipt.full_context_restored,true);
  for(const indices of [[0,0],[1],[0,undefined],[-1]]) {
    policy=fx.policy;const other=responseContext({selector:createMainContextSelector({allowOfflineFilter:true}),policy:()=>policy,headers});
    await other.prepare(Buffer.from(JSON.stringify(request)));
    for(const index of indices)other.observe(Buffer.from(JSON.stringify({type:'response.output_item.done',...(index===undefined?{}:{output_index:index}),item:message('observed')})));
    other.observe(Buffer.from('{"type":"response.completed","response":{"id":"first"}}'));
    const next=await other.prepare(Buffer.from(JSON.stringify({...request,previous_response_id:'first',input:[]})));assert.equal(next.payload,null);
  }
  const reconnect=responseContext({selector:createMainContextSelector({allowOfflineFilter:true}),policy:()=>fx.policy,headers});
  const untouched=Buffer.from(JSON.stringify({...request,previous_response_id:'unknown',input:[]}));
  assert.ok((await reconnect.prepare(untouched)).payload.equals(untouched));
});

test('C06: revocation during async readback never reaches HTTP or WS as a partial transform',async t=>{
  const fx=await duplicate(await setup()),transport=await httpFixture(t,fx,()=>{
    if(fx.policy.enabled)queueMicrotask(()=>{fx.policy.enabled=false;});return fx.policy;
  });
  const bytes=Buffer.from(JSON.stringify(fx.request,null,2));assert.ok((await transport.send(bytes)).bytes.equals(bytes));
  fx.policy.enabled=true;const ctx=responseContext({selector:createMainContextSelector({allowOfflineFilter:true}),policy:()=>fx.policy,headers});
  const request=Buffer.from(JSON.stringify({type:'response.create',...fx.request},null,2)),pending=ctx.prepare(request);
  fx.policy.enabled=false;const result=await pending;assert.ok(result.payload.equals(request));assert.equal(result.receipt.applied,false);
});

test('C07: actual read denial on one fixture original returns full; removing fixture ACL restores exact readback',{skip:process.platform!=='win32'},async()=>{
  const fx=await duplicate(await setup()),execute=promisify(execFile),ref=fx.state.sources[0].original;
  const identity=await execute('whoami',['/user','/fo','csv','/nh'],{windowsHide:true}),sid=identity.stdout.match(/S-1-5-[\d-]+/u)?.[0];
  assert.ok(sid);const principal='*'+sid,original=await fx.store.read(ref);
  await execute('icacls',[ref.path,'/deny',principal+':(R)'],{windowsHide:true});
  try {
    await assert.rejects(fx.store.read(ref),error=>['EACCES','EPERM'].includes(error.code));await full(fx);
  } finally {await execute('icacls',[ref.path,'/remove:d',principal],{windowsHide:true});}
  assert.ok((await fx.store.read(ref)).stdout.equals(original.stdout));
  assert.equal((await createMainContextSelector({allowOfflineFilter:true}).select(fx.request,headers,fx.policy)).applied,true);
});


function sourcePilot(fx,{approval=null,packetChange={},manifestChange={},spentPath=join(fx.dir,'pilot-spent.json')}={}) {
  const state=structuredClone(fx.state);delete state.binding_sha256;
  const manifest={schema_version:1,task_id:'fixture-task',inventory_revision:'source-inventory-1',state,...manifestChange};
  const packet={schema_version:2,pilot_id:'source-fixture',task_id:'fixture-task',thread_sha256:sha256(headers['thread-id']),
    scope_sha256:fx.binding.scope_sha256,source_manifest_sha256:sha256(JSON.stringify(manifest)),state_sha256:sha256(JSON.stringify(state)),
    code_hashes:qualityPilotCodeHashes(2),expires_at_ms:Date.now()+60000,max_initial_applies:1,operation:'state_only',spent_path_sha256:sha256(spentPath),...packetChange};
  const grant={approved:true,packet_sha256:sha256(JSON.stringify(packet))};
  const pilot=createQualityPilot(packet,{manifest,spentPath,approval:approval??(()=>grant)});
  const selector=createMainContextSelector({prepareQualityPilot:pilot.prepare});
  const flow=()=>responseContext({selector,policy:()=>pilot.policy(),headers});
  return {pilot,packet,manifest,grant,selector,flow,spentPath};
}

test('D09: WS sink uses one complete check and retains both validator branches',async t=>{
  for(const verified of [false,true])for(const revoked of [false,true])await t.test(`${verified?'ordered':'legacy'} ${revoked?'revoked':'active'}`,()=>{
    const request={type:'response.create',...original()},before=Buffer.from(JSON.stringify(request));
    const selected={...request,input:[...request.input,message('Sourced state')]};
    let validations=0,comparisons=0,denied=false;
    const validateOriginals=()=>{validations++;if(denied)throw Error('pilot_unavailable');};
    const selection={request:selected,applied:true,reason:'verified_context_quality',protected:[],excluded:[],validateOriginals,
      ...(verified?{verifyForwarded:()=>{comparisons++;validateOriginals();return true;}}:{})};
    const ctx=responseContext({selector:{select:()=>selection},policy:()=>({schema_version:2,revision:1}),headers});
    const pending=ctx.prepare(before);
    assert.equal(validations,1,'post-preparation source/authority check remains');
    denied=revoked;
    const sent=pending.commit();
    assert.equal(validations,2,'exactly one source/authority check at actual sink');
    assert.equal(comparisons,verified?1:0);
    assert.deepEqual(JSON.parse(sent),revoked?request:selected);
    assert.equal(pending.receipt.applied,!revoked);
  });
});

test('D02/D03: prepare binds actual appended native request and preserves every original item',async()=>{
  const fx=await setup(),run=sourcePilot(fx),request={type:'response.create',...fx.request,input:[...fx.request.input,{type:'message',role:'user',content:[{type:'input_text',text:'Current steering'}]}]};
  const pending=await run.flow().prepare(Buffer.from(JSON.stringify(request)));
  assert.equal(pending.receipt.task_state_attached,true);assert.deepEqual(JSON.parse(pending.commit()).input,[...request.input,expectedStateItem(fx.state)]);
  assert.equal(pending.receipt.ordered_context_verified,true);assert.equal(run.pilot.status().attempts,1);
  assert.deepEqual(JSON.parse(await readFile(run.spentPath,'utf8')).packet_sha256,sha256(JSON.stringify(run.packet)));
});

test('D05: same-connection native delta reuses selected prefix until isolated revoke',async()=>{
  const fx=await setup(),run=sourcePilot(fx),ctx=run.flow(),request={type:'response.create',...fx.request};
  const first=await ctx.prepare(Buffer.from(JSON.stringify(request)));first.commit();
  ctx.observe(Buffer.from(JSON.stringify({type:'response.completed',response:{id:'source-first',output:[]}})));
  const added=message('New reference'),delta=Buffer.from(JSON.stringify({...request,previous_response_id:'source-first',input:[added]}));
  const second=await ctx.prepare(delta);assert.ok(second.commit().equals(delta));assert.equal(second.receipt.context_prefix_reused,true);assert.equal(second.receipt.ordered_context_verified,true);
  ctx.observe(Buffer.from(JSON.stringify({type:'response.completed',response:{id:'source-second',output:[]}})));
  assert.equal(run.grant.approved,true);assert.ok(Date.now()<run.packet.expires_at_ms);assert.equal(run.pilot.status().attempts,1);
  const last=message('After revoke');run.pilot.revoke();
  const third=await ctx.prepare(Buffer.from(JSON.stringify({...request,previous_response_id:'source-second',input:[last]})));
  assert.deepEqual(JSON.parse(third.commit()),{...request,previous_response_id:null,input:[...request.input,added,last]});assert.equal(third.receipt.full_context_restored,true);
});

test('D04: failed source spends reservation; restart/reconnect cannot issue new permission',async()=>{
  const fx=await setup(),run=sourcePilot(fx);await unlink(fx.state.sources[0].original.path);
  const before=Buffer.from(JSON.stringify({type:'response.create',...fx.request})),failed=await run.flow().prepare(before);
  assert.ok(failed.commit().equals(before));assert.equal(run.pilot.status().attempts,1);
  const restarted=createQualityPilot(run.packet,{manifest:run.manifest,spentPath:run.spentPath,approval:()=>run.grant});
  const ctx=responseContext({selector:createMainContextSelector({prepareQualityPilot:restarted.prepare}),policy:()=>restarted.policy(),headers});
  assert.ok((await ctx.prepare(before)).commit().equals(before));assert.equal(restarted.status().spent,true);
});

test('D01/D02: expanded/malformed source packet is rejected and foreign scope never reserves',async t=>{
  for(const change of [{max_initial_applies:2},{operation:'duplicates'},{extra:true},{state_sha256:'f'.repeat(64)},{source_manifest_sha256:'f'.repeat(64)}]){
    const fx=await setup();assert.throws(()=>sourcePilot(fx,{packetChange:change}),/invalid_pilot_packet/);
  }
  for(const kind of ['thread','model','opaque','source','grant'])await t.test(kind,async()=>{
    const fx=await setup(kind==='source'?original():undefined,kind==='source'?{goal:'password=example'}:{}),run=sourcePilot(fx);
    const incoming=kind==='thread'?{...headers,'thread-id':'foreign'}:headers;
    const ctx=responseContext({selector:run.selector,policy:()=>run.pilot.policy(),headers:incoming});
    const request={type:'response.create',...fx.request};if(kind==='model')request.model='foreign';if(kind==='opaque')request.input.push({type:'unrecognized'});if(kind==='grant')run.grant.approved=false;
    const before=Buffer.from(JSON.stringify(request)),pending=await ctx.prepare(before);assert.ok(pending.commit().equals(before));assert.equal(pending.receipt.applied,false);
  });
});

test('D06: changed original or revoke between prepare and actual commit cannot escape',async t=>{
  for(const kind of ['revoke','source_changed'])await t.test(kind,async()=>{
    const fx=await setup(),run=sourcePilot(fx),before=Buffer.from(JSON.stringify({type:'response.create',...fx.request}));
    const pending=await run.flow().prepare(before);assert.equal(pending.receipt.applied,true);
    if(kind==='revoke')run.pilot.revoke();else await writeFile(fx.state.sources[0].original.path,'corrupt');
    assert.ok(pending.commit().equals(before));assert.equal(pending.receipt.applied,false);assert.notEqual(pending.receipt.ordered_context_verified,true);
  });
});


test('D04/D05/D06: real WS sink proves state-only prefix reuse and explicit revoke under active lease',{timeout:10000},async t=>{
  const fx=await setup(),run=sourcePilot(fx),request={type:'response.create',...fx.request};
  const transport=await wsFixture(t,fx,()=>run.pilot.policy(),{prepareQualityPilot:run.pilot.prepare});
  const first=await transport.send(Buffer.from(JSON.stringify(request)));
  assert.deepEqual(JSON.parse(first),{...request,input:[...request.input,expectedStateItem(fx.state)]});
  const added=message('actual socket delta'),delta=Buffer.from(JSON.stringify({...request,previous_response_id:'response-1',input:[added]}));
  assert.ok((await transport.send(delta)).equals(delta));
  assert.equal(transport.receipts.filter(r=>r.phase==='message_forwarded').at(-1).context_prefix_reused,true);
  assert.equal(run.grant.approved,true);assert.equal(run.pilot.status().attempts,1);assert.ok(Date.now()<run.packet.expires_at_ms);
  run.pilot.revoke();const last=message('after actual revoke');
  const restored=await transport.send(Buffer.from(JSON.stringify({...request,previous_response_id:'response-2',input:[last]})));
  assert.deepEqual(JSON.parse(restored),{...request,previous_response_id:null,input:[...request.input,added,last]});
  const forwarded=transport.receipts.filter(r=>r.phase==='message_forwarded');
  assert.ok(forwarded.slice(0,2).every(r=>r.ordered_context_verified===true&&r.upstream_body_written===true));
  assert.equal(forwarded[2].full_context_restored,true);
  assert.equal(forwarded[2].ordered_context_verified,true);
  assert.ok(transport.receipts.some(r=>r.phase==='response_completed'&&r.message_sequence===3&&r.provider_completed===true));
  assert.doesNotMatch(JSON.stringify(transport.receipts),/Finish fixture|quality-fixture-account|\.original/);
});

test('D04/D05: reconnect and unknown continuation never inherit active authority',async()=>{
  const fx=await setup(),run=sourcePilot(fx),ctx=run.flow(),request={type:'response.create',...fx.request},before=Buffer.from(JSON.stringify(request));
  (await ctx.prepare(before)).commit();ctx.observe(Buffer.from(JSON.stringify({type:'response.completed',response:{id:'known',output:[]}})));
  assert.ok((await run.flow().prepare(before)).commit().equals(before));
  const unknown=await ctx.prepare(Buffer.from(JSON.stringify({...request,previous_response_id:'unknown',input:[message('new')]})));
  assert.equal(unknown.payload,null);
  assert.throws(()=>createQualityPilot(run.packet,{manifest:run.manifest,spentPath:join(fx.dir,'other-spent.json'),approval:()=>run.grant}),/invalid_pilot_packet/);
});

test('D06: selected-state tampering and concurrent request mutation fail before commit',async()=>{
  const fx=await setup(),run=sourcePilot(fx),request={type:'response.create',...fx.request};
  const selection=await run.selector.select(request,headers,run.pilot.policy(),{connection:{},inherited:false});
  assert.equal(selection.applied,true);selection.request.input.at(-1).content[0].text='invented state';
  assert.throws(()=>selection.verifyForwarded(Buffer.from(JSON.stringify(selection.request)),selection.request),/state_only_comparison_failed/);
  const second=await setup(),other=sourcePilot(second),input={type:'response.create',...second.request};
  const pending=other.selector.select(input,headers,other.pilot.policy(),{connection:{},inherited:false});
  input.input.push(message('changed after prepare'));const result=await pending;
  assert.equal(result.applied,false);assert.deepEqual(result.request,input);
});


test('D04/D06: schema2 monotonic expiry, approval drift and async readback revocation remain fail-closed',async t=>{
  for(const kind of ['monotonic','grant','during_read'])await t.test(kind,async()=>{
    const fx=await setup(),seed=sourcePilot(fx),wall=Date.now();let tick=0,grant=seed.grant;
    const pilot=createQualityPilot(seed.packet,{manifest:seed.manifest,spentPath:seed.spentPath,now:()=>wall-600000,monotonic:()=>tick,approval:()=>grant});
    const ctx=responseContext({selector:createMainContextSelector({prepareQualityPilot:pilot.prepare}),policy:()=>pilot.policy(),headers});
    const before=Buffer.from(JSON.stringify({type:'response.create',...fx.request}));
    const preparing=ctx.prepare(before);
    if(kind==='during_read')pilot.revoke();
    const pending=await preparing;
    if(kind==='monotonic')tick=seed.packet.expires_at_ms-(wall-600000);
    if(kind==='grant')grant={...grant,approved:false};
    assert.ok(pending.commit().equals(before));assert.equal(pending.receipt.applied,false);
  });
});
