import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';
import { sha256 } from './context-binding.mjs';
import { createMainContextSelector, mainInventory, mainScope } from './main-context.mjs';
import { createMainGateway } from './main-gateway.mjs';
import { responseContext } from './response-context.mjs';
import { compactToolOutput, testEvidence, createOriginalStore } from './compact-output.mjs';
import { planGatewayConfig, planBuiltinGatewayConfig, rollbackGatewayConfig, applyGatewayConfig, writeGatewayConfig } from './configure-main-gateway.mjs';

const hash = value => sha256(JSON.stringify(value));
const capability = 'a'.repeat(32);
const message = (text,role = 'assistant') => ({ type:'message',role,content:[{ type:role === 'assistant' ? 'output_text' : 'input_text',text }] });
const headers = { 'chatgpt-account-id':'fixture-account','thread-id':'fixture-thread','content-type':'application/json' };
const pair = id => [{ type:'function_call',name:'reference_lookup',call_id:id,arguments:'{}' },{ type:'function_call_output',call_id:id,output:'completed obsolete reference' }];

test('C06: actual producer command result survives existing model input consumer with exact readback',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'jev-tool-seam-')),file=join(dir,'fixture.test.mjs');
  const execute=promisify(execFile),env={...process.env};delete env.NODE_TEST_CONTEXT;
  for(const diagnostic of [false,true]){
    await writeFile(file,"import test from 'node:test';\n"+(diagnostic?"process.stderr.write('unknown warning 🦉\\n');\n":'')+"test('успех 🦉',()=>{});\n");
    // Same public entry used from exec_command. This does not read an old log.
    const tool=await execute(process.execPath,['integration/test-output.mjs','run',join(dir,'originals'),file],{env,windowsHide:true});
    const result=JSON.parse(tool.stdout);assert.equal(tool.stderr,'');
    assert.equal(result.status,diagnostic?'verbatim':'compact');
    const call={type:'function_call',name:'exec_command',call_id:'fixture-producer',arguments:JSON.stringify({cmd:'explicit test producer'})};
    const output={type:'function_call_output',call_id:call.call_id,output:tool.stdout};
    const request={type:'response.create',...body(),input:[...body().input,call,output]};
    const before=structuredClone(request),policy={...policyFor(request),enabled:false};
    const consumer=responseContext({selector:createMainContextSelector(),policy:()=>policy,headers});
    const forwarded=JSON.parse(consumer.prepare(Buffer.from(JSON.stringify(request))).payload);
    assert.deepEqual(forwarded,request);assert.deepEqual(request,before);
    const visible=JSON.parse(forwarded.input.at(-1).output);
    assert.deepEqual(visible.provenance,result.provenance);
    if(!diagnostic){
      const original=await createOriginalStore(join(dir,'originals')).read(visible.original);
      assert.match(original.stdout.toString(),/✔ успех 🦉/);assert.equal(original.stderr.length,0);
      assert.deepEqual(original.provenance,visible.provenance);
      const reference=join(dir,'reference.json');await writeFile(reference,JSON.stringify(visible.original));
      const readback=JSON.parse((await execute(process.execPath,['integration/test-output.mjs','read',reference],{env,windowsHide:true})).stdout);
      assert.equal(readback.stdout.data,original.stdout.toString());assert.equal(readback.id,visible.original.id);
    } else assert.match(visible.received.stdout.data,/unknown warning 🦉\n/);
  }
});
test('C05: completed log CLI compact and diagnostic verbatim survive the existing model consumer',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'jev-log-seam-')),execute=promisify(execFile);
  for(const control of [null,'diagnostic','unexpected-record','invalid-utf8']){
    const tool=await execute(process.execPath,['integration/log-output.mjs','run',join(dir,'originals'),...(control?[`--${control}`]:[])],{windowsHide:true});
    const result=JSON.parse(tool.stdout);assert.equal(tool.stderr,'');
    assert.equal(result.status,control?'verbatim':'compact');
    const call={type:'function_call',name:'exec_command',call_id:'fixture-log-producer',arguments:JSON.stringify({cmd:'explicit local gateway log producer'})};
    const output={type:'function_call_output',call_id:call.call_id,output:tool.stdout};
    const request={type:'response.create',...body(),input:[...body().input,call,output]};
    const before=structuredClone(request),policy={...policyFor(request),enabled:false};
    const consumer=responseContext({selector:createMainContextSelector(),policy:()=>policy,headers});
    const forwarded=JSON.parse(consumer.prepare(Buffer.from(JSON.stringify(request))).payload);
    assert.deepEqual(forwarded,request);assert.deepEqual(request,before);
    assert.equal(forwarded.input.at(-1).call_id,call.call_id);
    const visible=JSON.parse(forwarded.input.at(-1).output);assert.deepEqual(visible,result);
    if(!control){
      const original=await createOriginalStore(join(dir,'originals')).read(visible.original);
      const oracle=original.stdout.toString().trimEnd().split('\n').map(line=>JSON.parse(line));
      assert.deepEqual(visible.events.map(event=>({...visible.common,...event})),oracle);
      assert.equal(original.stderr.length,0);assert.deepEqual(original.provenance,visible.provenance);
      const reference=join(dir,'log-reference.json');await writeFile(reference,JSON.stringify(visible.original));
      const readback=JSON.parse((await execute(process.execPath,['integration/test-output.mjs','read',reference],{windowsHide:true})).stdout);
      assert.equal(readback.stdout.data,original.stdout.toString());assert.equal(readback.id,visible.original.id);
      assert.deepEqual(readback.provenance,result.provenance);
    }else if(control==='diagnostic'){
      assert.match(visible.received.stderr.data,/unknown warning 🦉\n/);
      assert.equal(visible.reason,'stderr_diagnostic');assert.equal(visible.original,undefined);
      assert.equal(visible.received.stdout.data.trimEnd().split('\n').length,3);
    }else{
      assert.match(visible.reason,/^parser:/);assert.equal(visible.original,undefined);
      assert.equal(visible.received.stderr.data,'');
      if(control==='unexpected-record')assert.match(visible.received.stdout.data,/unexpected 日本語 🦉\n/);
      else{
        assert.equal(visible.received.stdout.encoding,'base64');
        const bytes=Buffer.from(visible.received.stdout.data,'base64');
        assert.deepEqual(bytes.subarray(0,2),Buffer.from([255,254]));
        assert.equal(bytes.subarray(2).toString().trimEnd().split('\n').length,3);
      }
    }
  }
});
function clientFrame(text) {
  const payload=Buffer.from(text), key=Buffer.from([1,2,3,4]);
  const head=Buffer.alloc(payload.length<126?2:payload.length<65536?4:10); head[0]=0x81;
  if(payload.length<126) head[1]=0x80|payload.length;
  else if(payload.length<65536){head[1]=0xfe;head.writeUInt16BE(payload.length,2);}
  else{head[1]=0xff;head.writeBigUInt64BE(BigInt(payload.length),2);}
  const masked=Buffer.from(payload);for(let i=0;i<masked.length;i++)masked[i]^=key[i%4];
  return Buffer.concat([head,key,masked]);
}
function framePayload(frame) {
  let offset=2, length=frame[1]&127;
  if(length===126){length=frame.readUInt16BE(2);offset=4;}
  else if(length===127){length=Number(frame.readBigUInt64BE(2));offset=10;}
  const key=frame.subarray(offset,offset+4), payload=Buffer.from(frame.subarray(offset+4,offset+4+length));
  for(let i=0;i<payload.length;i++)payload[i]^=key[i%4];return payload;
}
function serverFrame(value){const wire=clientFrame(JSON.stringify(value)),payload=framePayload(wire);let head=wire[1]%128<126?2:wire[1]%128===126?4:10;const prefix=Buffer.from(wire.subarray(0,head));prefix[1]&=127;return Buffer.concat([prefix,payload]);}
const body = () => ({ model:'gpt-6.1-sol',reasoning:{ effort:'high' },instructions:'fixture instructions',
  input:[message('текущий запрос','user'),...pair('old'),...Array.from({ length:9 },(_,i) => message(`recent ${i}`))] });
function policyFor(request, index = 1) {
  const inventory = mainInventory(request);
  return { schema_version:1,enabled:true,mode:'filter',approval_id:'global-jev-opt-in-20261003',revision:1,
    bindings:[{ scope_sha256:mainScope(request,headers),input_sha256:inventory.input_sha256,
      optional_groups:[{ sha256:inventory.groups[index].sha256,completed:true,reason:'superseded_reference' }] }] };
}

test('exact scoped removal preserves roles, settings, original and complete call/result groups',() => {
  const request = body(), original = structuredClone(request);
  const result = createMainContextSelector().select(request,headers,policyFor(request));
  assert.equal(result.applied,true); assert.equal(result.request.input.length,request.input.length - 2);
  assert.deepEqual(result.request,{ ...request,input:[request.input[0],...request.input.slice(3)] });
  assert.deepEqual(request,original); assert.equal(result.excluded.length,1);
});

test('Russian requirements, >64KB evidence, explicit protection and recent tail are preserved',() => {
  for (const text of ['Нельзя менять требования', 'error: failed','C:/evidence/file.txt', 'npm test']) {
    const request = body(); request.input[2].output = text + 'Я'.repeat(70000);
    const result = createMainContextSelector().select(request,headers,policyFor(request));
    assert.equal(result.applied,false); assert.deepEqual(result.request,request);
  }
  for (const extension of [{ protected:true },{ metadata:{ protected:true } }]) {
    const request = body(); Object.assign(request.input[1],extension);
    assert.equal(createMainContextSelector().select(request,headers,policyFor(request)).applied,false);
  }
  const request = body(); assert.equal(createMainContextSelector().select(request,headers,policyFor(request,5)).applied,false);
});

test('parallel call intervals remain indivisible',() => {
  const request = body(); request.input.splice(1,2,pair('a')[0],pair('b')[0],pair('a')[1],pair('b')[1]);
  const inventory = mainInventory(request); assert.equal(inventory.groups[1].end - inventory.groups[1].start,3);
  assert.equal(createMainContextSelector().select(request,headers,policyFor(request)).request.input.length,request.input.length - 4);
});

test('Desktop additional tools and encrypted items stay protected around custom call pairs',()=>{
  const request=body();request.input.splice(0,0,{type:'additional_tools',role:'developer',tools:[]},{type:'compaction',encrypted_content:'fixture opaque'});
  request.input[3]={type:'custom_tool_call',call_id:'old',name:'reference_lookup',input:'{}'};
  request.input[4]={type:'custom_tool_call_output',call_id:'old',output:[{type:'input_text',text:'completed obsolete reference'}]};
  request.input.splice(3,0,{type:'reasoning',summary:[],encrypted_content:'fixture reasoning'});
  const inventory=mainInventory(request), candidate=inventory.groups.findIndex(g=>g.start===4);
  const selected=createMainContextSelector().select(request,headers,policyFor(request,candidate));
  assert.equal(selected.applied,true);assert.deepEqual(selected.request.input.slice(0,4),request.input.slice(0,4));
  assert.equal(selected.request.input.length,request.input.length-2);
});

test('Desktop agent messages stay intact while a reviewed separate reference is selected',()=>{
  const request=body();request.input.splice(0,0,{type:'agent_message',author:'fixture-agent',recipient:'root',content:[{type:'encrypted_content',encrypted_content:'fixture opaque review'}]});
  const policy=policyFor(request,2),result=createMainContextSelector().select(request,headers,policy);
  assert.equal(result.applied,true);assert.deepEqual(result.request.input[0],request.input[0]);
});

test('Codex output_item.done supplies output when completed omits it or carries an empty placeholder',()=>{
  for(const completedOutput of [undefined,[]]){
  const request={type:'response.create',...body()},initial=policyFor(request);let policy=initial;
  const ctx=responseContext({selector:createMainContextSelector(),policy:()=>policy,headers});
  assert.equal(ctx.prepare(Buffer.from(JSON.stringify(request))).receipt.applied,true);
  const call={type:'custom_tool_call',call_id:'next',name:'fixture_tool',input:'{}'};
  ctx.observe(Buffer.from(JSON.stringify({type:'response.output_item.done',item:call})));
  ctx.observe(Buffer.from(JSON.stringify({type:'response.completed',response:{id:'fixture-response',output:completedOutput}})));
  policy={...initial,enabled:false};
  const output={type:'custom_tool_call_output',call_id:'next',output:'completed'};
  const next=ctx.prepare(Buffer.from(JSON.stringify({...request,previous_response_id:'fixture-response',input:[output]})));
  assert.deepEqual(JSON.parse(next.payload).input,[...request.input,call,output]);
  assert.equal(next.receipt.full_context_restored,true);
  }
});

test('unchanged selected prefix reuses native incremental bytes and revocation still restores it',()=>{
  const request={type:'response.create',...body()},initial=policyFor(request);let policy=initial;
  const ctx=responseContext({selector:createMainContextSelector(),policy:()=>policy,headers});
  ctx.prepare(Buffer.from(JSON.stringify(request)));
  const reply=message('completed reply');ctx.observe(Buffer.from(JSON.stringify({type:'response.completed',response:{id:'response1',output:[reply]}})));
  const added=message('incremental data'),delta=Buffer.from(JSON.stringify({...request,previous_response_id:'response1',input:[added]}));
  const reused=ctx.prepare(delta);assert.deepEqual(reused.payload,delta);assert.equal(reused.receipt.incremental_reused,true);
  assert.equal(reused.receipt.context_selected,true);assert.equal(reused.receipt.applied,false);
  ctx.observe(Buffer.from(JSON.stringify({type:'response.completed',response:{id:'response2',output:[reply]}})));
  policy={...initial,enabled:false};const restored=ctx.prepare(Buffer.from(JSON.stringify({...request,previous_response_id:'response2',input:[added]})));
  assert.deepEqual(JSON.parse(restored.payload).input,[...request.input,reply,added,reply,added]);
  assert.equal(restored.receipt.full_context_restored,true);
});

test('restoration uses complete output or validated indexed done items in original order',()=>{
  for(const completed of [true,false]){
    const request={type:'response.create',...body()},initial=policyFor(request);let policy=initial;
    const ctx=responseContext({selector:createMainContextSelector(),policy:()=>policy,headers});
    ctx.prepare(Buffer.from(JSON.stringify(request)));
    const output=[message('first reply'),message('second reply')];
    for(const index of [1,0])ctx.observe(Buffer.from(JSON.stringify({type:'response.output_item.done',output_index:index,item:output[index]})));
    ctx.observe(Buffer.from(JSON.stringify({type:'response.completed',response:{id:'response1',...(completed?{output}: {})}})));
    policy={...initial,enabled:false};const added=message('delta');
    const restored=ctx.prepare(Buffer.from(JSON.stringify({...request,previous_response_id:'response1',input:[added]})));
    assert.deepEqual(JSON.parse(restored.payload).input,[...request.input,...output,added]);
  }
});

test('uncertain indexed output closes before forwarding a filtered continuation',()=>{
  for(const indices of [[1],[0,0],[0,undefined],[0,-1]]){
    const request={type:'response.create',...body()},ctx=responseContext({selector:createMainContextSelector(),policy:()=>policyFor(request),headers});
    ctx.prepare(Buffer.from(JSON.stringify(request)));
    for(const index of indices)ctx.observe(Buffer.from(JSON.stringify({type:'response.output_item.done',...(index===undefined?{}:{output_index:index}),item:message('reply')})));
    ctx.observe(Buffer.from(JSON.stringify({type:'response.completed',response:{id:'response1'}})));
    assert.equal(ctx.prepare(Buffer.from(JSON.stringify({...request,previous_response_id:'response1',input:[message('delta')]}))).payload,null);
  }
});

test('unknown client message after filtering cannot bypass original-prefix restoration',()=>{
  const request={type:'response.create',...body()},ctx=responseContext({selector:createMainContextSelector(),policy:()=>policyFor(request),headers});
  ctx.prepare(Buffer.from(JSON.stringify(request)));
  assert.equal(ctx.prepare(Buffer.from('unknown protocol')).payload,null);
  assert.equal(ctx.prepare(Buffer.from('{"type":"future-request"}')).payload,null);
});

test('unknown/opaque/incremental/orphan inventory always preserves full',() => {
  for (const mutate of [r => { r.previous_response_id = 'prior'; },r => r.input.push({ type:'reasoning',encrypted_content:'opaque' }),
    r => r.input.push({ type:'compaction',encrypted_content:'opaque' }),r => r.input.splice(2,1),
    r => r.input.push({ type:'future-item' }),r => { r.input[0].content[0].type = 'input_image'; }]) {
    const request = body(), policy = policyFor(request); mutate(request);
    const result = createMainContextSelector().select(request,headers,policy);
    assert.equal(result.applied,false); assert.equal(result.request,request);
  }
});

test('stable-prefix append, steering, revision, cross-thread/account and revoke',() => {
  const selector = createMainContextSelector(), request = body(), policy = policyFor(request);
  const selected = selector.select(request,headers,policy);
  const append = { ...request,input:[...request.input,...pair('new')] };
  assert.deepEqual(selector.select(append,headers,policy).request.input.slice(0,selected.request.input.length),selected.request.input);
  for (const differentHeaders of [{ ...headers,'thread-id':'other' },{ ...headers,'chatgpt-account-id':'other' },{}])
    assert.equal(selector.select(request,differentHeaders,policy).applied,false);
  assert.equal(selector.select(append,headers,{ ...policy,revision:2 }).applied,false);
  assert.equal(selector.select(request,headers,{ ...policy,enabled:false }).applied,false);
  assert.equal(selector.select({ ...request,input:[...request.input,message('новое уточнение','user')] },headers,policy).reason,'task_steered');
  const errorAppend = structuredClone(append); errorAppend.input.at(-1).output = 'ошибка: требуется старое свидетельство';
  assert.equal(selector.select(errorAppend,headers,policy).reason,'working_state_changed');
  const changed = structuredClone(request); changed.input[0].content[0].text += ' changed';
  assert.equal(selector.select(changed,headers,policy).reason,'prefix_changed');
  selector.clear(); assert.equal(selector.select(append,headers,policy).reason,'inventory_changed');
  assert.equal(selector.select(request,headers,{ ...policy,mode:'shadow' }).applied,false);
});

test('cached exclusion preserves a new identical unapproved occurrence outside recent tail',() => {
  const reference = message('obsolete reference');
  const request = { model:'fixture',input:[reference,...Array.from({length:9},(_,i)=>message(`recent ${i}`))] };
  const policy = policyFor(request,0), selector = createMainContextSelector();
  assert.equal(selector.select(request,headers,policy).request.input.length,9);
  const appended = { ...request,input:[...request.input,structuredClone(reference),...Array.from({length:9},(_,i)=>message(`later ${i}`))] };
  const selected = selector.select(appended,headers,policy);
  assert.deepEqual(selected.request.input,appended.input.slice(1));
  assert.equal(selected.excluded.length,1);
});

test('reviewed prefix binding permits protected tool appends and rejects fresh user steering',()=>{
  const request=body(),policy=policyFor(request);policy.bindings[0].item_hashes=mainInventory(request).item_hashes;
  policy.bindings[0].allow_protected_appends=true;
  const append={...request,input:[...request.input,...pair('new')]};append.input.at(-1).output='error: required C:/evidence';
  const selector=createMainContextSelector(),selected=selector.select(append,headers,policy);
  assert.equal(selected.applied,true);assert.deepEqual(selected.request.input.slice(-2),append.input.slice(-2));
  const steered={...append,input:[...append.input,message('Restore earlier reference','user')]};
  assert.equal(selector.select(steered,headers,policy).reason,'task_steered');
});

test('reviewed assistant references may carry neutral timestamps but classified metadata stays protected',()=>{
  for(const [metadata,expected]of [[{turn_id:'fixture',create_time:1},true],[{turn_id:'fixture',content_item_kinds:['instruction']},false]]){
    const request=body();request.input[1].internal_chat_message_metadata_passthrough=metadata;
    const result=createMainContextSelector().select(request,headers,policyFor(request));
    assert.equal(result.applied,expected);
  }
});

test('exact coordinator metadata review only permits an obsolete plain assistant group',()=>{
  const request={model:'fixture',input:[message('completed obsolete comparison introduction'),...Array.from({length:9},(_,i)=>message(`recent ${i}`))]};
  request.input[0].internal_chat_message_metadata_passthrough={turn_id:'fixture',content_item_kinds:['unknown']};
  const policy=policyFor(request,0);policy.bindings[0].optional_groups[0].metadata_reviewed=true;
  const selector=createMainContextSelector();assert.equal(selector.select(request,headers,policy).applied,true);
  for(const alter of [r=>{r.input[0].protected=true;},r=>{r.input[0].content[0].text='required current requirement';},r=>{r.input[0].internal_chat_message_metadata_passthrough.content_item_kinds=['instruction'];},r=>{r.input[0].internal_chat_message_metadata_passthrough.cell_id='fixture';},r=>{r.input[0].internal_chat_message_metadata_passthrough.turn_id={opaque:true};},r=>{r.input[0].internal_chat_message_metadata_passthrough.create_time='opaque';}]){
    const changed=structuredClone(request);alter(changed);const trusted=policyFor(changed,0);trusted.bindings[0].optional_groups[0].metadata_reviewed=true;
    assert.equal(createMainContextSelector().select(changed,headers,trusted).applied,false);
  }
});

async function fixture(t, handle, policy = () => null) {
  const receipts = [];
  const upstream = http.createServer(handle), upstreamSockets = new Set();
  upstream.on('connection',socket => { upstreamSockets.add(socket); socket.on('close',() => upstreamSockets.delete(socket)); });
  upstream.listen(0,'127.0.0.1'); await once(upstream,'listening');
  const gateway = createMainGateway({ capability,policy,receipt:row => receipts.push(row),
    upstream:`http://127.0.0.1:${upstream.address().port}`,testUpstream:true });
  gateway.server.listen(0,'127.0.0.1'); await once(gateway.server,'listening');
  t.after(async () => { await gateway.stop(); for (const socket of upstreamSockets) socket.destroy(); await new Promise(resolve => upstream.close(resolve)); });
  const base = `http://127.0.0.1:${gateway.server.address().port}/jev/${capability}/backend-api/codex`;
  return { gateway,upstream,receipts,base };
}

test('HTTP passthrough is byte-exact, status/SSE increments survive and receipts contain no auth/body',async t => {
  let received, release;
  const next = new Promise(resolve => { release=resolve; });
  const fx = await fixture(t,async (req,res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    received = Buffer.concat(chunks);
    assert.equal(req.headers.authorization,'Bearer fixture-only'); assert.equal(req.headers.cookie,undefined);
    res.writeHead(200,{ 'content-type':'text/event-stream' }); res.write('event: response.output_text.delta\ndata: {"delta":"ok"}\n\n');
    await next; res.end('event: response.completed\ndata: {"type":"response.completed"}\n\n');
  });
  const original = Buffer.from(JSON.stringify(body(),null,2));
  const response = await fetch(fx.base+'/responses',{ method:'POST',headers:{ ...headers,authorization:'Bearer fixture-only',cookie:'private=fixture' },body:original });
  const reader = response.body.getReader(); const first = await reader.read(); assert.equal(first.done,false);
  assert.doesNotMatch(Buffer.from(first.value).toString(),/response.completed/);
  assert.deepEqual(fx.receipts.map(row => row.phase),['received','connected']);
  assert.ok(fx.receipts.every(row => row.completed === false)); release();
  let streamed = Buffer.from(first.value).toString(); for (;;) { const next = await reader.read(); if (next.done) break; streamed += Buffer.from(next.value); }
  assert.match(streamed,/response.completed/); assert.deepEqual(received,original);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(fx.receipts.map(row => row.phase),['received','connected','terminal']);
  assert.equal(new Set(fx.receipts.map(row => row.request_id)).size,1);
  assert.equal(fx.receipts.at(-1).after_sha256,sha256(received));
  assert.equal(fx.receipts.at(-1).upstream_body_written,true);
  assert.doesNotMatch(JSON.stringify(fx.receipts),/fixture-only|private=|текущий запрос|fixture-account/);
});

test('HTTP selected bytes and zstd are bound to the actual upstream write',async t => {
  const request = body(), policy = policyFor(request); let received;
  const fx = await fixture(t,async (req,res) => { const chunks=[]; for await (const chunk of req) chunks.push(chunk); received=Buffer.concat(chunks); res.end('ok'); },() => policy);
  const compressed = zstdCompressSync(Buffer.from(JSON.stringify(request)));
  const response = await fetch(fx.base+'/responses',{ method:'POST',headers:{ ...headers,'content-encoding':'zstd' },body:compressed }); await response.text();
  assert.equal(JSON.parse(zstdDecompressSync(received)).input.length,request.input.length - 2);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fx.receipts.at(-1).applied,true); assert.equal(fx.receipts.at(-1).after_sha256,sha256(received));
});

test('unknown encoding/invalid policy/auth change uses full bytes, redirect rejected, no retry',async t => {
  let received, count = 0, revision = 0;
  const request = body(), fx = await fixture(t,async (req,res) => { count++; const chunks=[]; for await (const chunk of req) chunks.push(chunk); received=Buffer.concat(chunks); res.writeHead(307,{ location:'http://invalid.example' }).end(); },() => ({ ...policyFor(request),revision:++revision }));
  const original = JSON.stringify(request);
  const response = await fetch(fx.base+'/responses',{ method:'POST',headers,body:original });
  assert.equal(response.status,502); assert.equal(received.toString(),original); assert.equal(count,1);
  const unknown = await fetch(fx.base+'/responses',{ method:'POST',headers:{ ...headers,'content-encoding':'unknown' },body:original });
  assert.equal(unknown.status,502); assert.equal(received.toString(),original); assert.equal(count,2);
});

test('route/capability/origin/host failures never reach upstream',async t => {
  let count=0; const fx = await fixture(t,(_req,res) => { count++; res.end(); });
  for (const [url,extra] of [[fx.base+'/../responses',{}],[fx.base+'/responses?url=https://other',{}],
    [fx.base.replace(capability,'b'.repeat(32))+'/responses',{}],[fx.base+'/responses',{ origin:'https://untrusted.example' }],
    [fx.base+'/responses',{ host:'untrusted.example' }]]) {
    const response = await new Promise((resolve,reject) => {
      const req = http.request(url,{ method:'POST',headers:{ ...headers,...extra } },res => { res.resume(); resolve(res); });
      req.on('error',reject); req.end('{}');
    });
    assert.equal(response.statusCode,404);
  }
  assert.equal(count,0); assert.throws(() => createMainGateway({ capability,upstream:'https://other.example' }),/invalid_upstream/);
});

test('client cancellation closes the upstream stream without replay',async t => {
  let calls=0, closed;
  const done = new Promise(resolve => { closed=resolve; });
  const fx = await fixture(t,(_req,res) => { calls++; res.writeHead(200); res.write('first'); res.on('close',closed); });
  const response = await fetch(fx.base+'/responses',{ method:'POST',headers,body:JSON.stringify(body()) });
  await response.body.cancel(); await done; assert.equal(calls,1);
});

test('WebSocket upgrade and opaque frames pass through unchanged',{timeout:5000},async t => {
  const fx = await fixture(t,(_req,res) => res.end());
  fx.upstream.on('upgrade',(_req,socket,head) => { socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: fixture\r\n\r\n'); if(head.length) socket.write(head); socket.on('data',data => socket.write(data)); });
  const accepted = once(fx.gateway.server,'connection');
  const socket = net.connect(fx.gateway.server.address().port,'127.0.0.1'); t.after(() => socket.destroy()); await once(socket,'connect');
  const [gatewaySocket] = await accepted;
  socket.write(`GET /jev/${capability}/backend-api/codex/responses HTTP/1.1\r\nHost: 127.0.0.1:${fx.gateway.server.address().port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: fixture\r\nSec-WebSocket-Version: 13\r\n\r\n`);
  const [reply] = await once(socket,'data'); assert.match(reply.toString(),/101 Switching Protocols/);
  const frame=Buffer.from([0x81,0x83,1,2,3,4,100,101,102]); socket.write(frame);
  const [echo] = await once(socket,'data'); assert.deepEqual(echo,frame);
  assert.deepEqual(fx.receipts.map(row => row.phase),['received','connected']);
  assert.equal(fx.receipts[1].upstream_status,101);
  assert.equal(fx.receipts[0].upstream_status,null,'earlier observations must remain immutable');
  assert.ok(fx.receipts.every(row => row.completed === false));
  const closed = once(gatewaySocket,'close'); socket.destroy(); gatewaySocket.destroy(); await closed;
  assert.deepEqual(fx.receipts.map(row => row.phase),['received','connected','terminal']);
  assert.equal(new Set(fx.receipts.map(row => row.request_id)).size,1);
  assert.ok(fx.receipts.every(row => row.schema_version === 2 && Number.isFinite(Date.parse(row.observed_at)) && row.latency_ms >= 0));
  assert.doesNotMatch(JSON.stringify(fx.receipts),/fixture|Sec-WebSocket|\/jev\//);
});

test('WS response.create selects actual upstream input and emits hash-only inventory',{timeout:5000},async t => {
  const request={type:'response.create',...body()}, policy=policyFor(request);let offered;
  const fx=await fixture(t,(_req,res)=>res.end(),()=>policy);
  fx.upstream.on('upgrade',(req,socket)=>{offered=req.headers['sec-websocket-extensions'];socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: fixture\r\n\r\n');socket.on('data',data=>socket.write(data));});
  const socket=net.connect(fx.gateway.server.address().port,'127.0.0.1');t.after(()=>socket.destroy());await once(socket,'connect');
  socket.write(`GET /jev/${capability}/backend-api/codex/responses HTTP/1.1\r\nHost: 127.0.0.1:${fx.gateway.server.address().port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nthread-id: fixture-thread\r\nchatgpt-account-id: fixture-account\r\nSec-WebSocket-Extensions: permessage-deflate\r\n\r\n`);
  await once(socket,'data');socket.write(clientFrame(JSON.stringify(request)));
  const echoed=Buffer.concat((await once(socket,'data'))), selected=JSON.parse(framePayload(echoed));
  assert.deepEqual(selected.input,[request.input[0],...request.input.slice(3)]);
  assert.equal(offered,undefined);
  const sent=fx.receipts.find(row=>row.phase==='message_forwarded');
  assert.equal(sent.applied,true);assert.equal(sent.after_sha256,sha256(framePayload(echoed)));
  assert.doesNotMatch(JSON.stringify(fx.receipts),/obsolete reference|fixture-account|текущий запрос/);
});

test('WS policy revocation restores original prefix on a native incremental continuation',{timeout:5000},async t=>{
  const request={type:'response.create',...body()},initial=policyFor(request);let policy=initial;const received=[];
  const output=message('completed reply');
  const fx=await fixture(t,(_req,res)=>res.end(),()=>policy);
  fx.upstream.on('upgrade',(_req,s)=>{s.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: fixture\r\n\r\n');s.on('data',wire=>{received.push(JSON.parse(framePayload(wire)));s.write(serverFrame({type:'response.completed',response:{id:`response-${received.length}`,output:[output]}}));});});
  const socket=net.connect(fx.gateway.server.address().port,'127.0.0.1');t.after(()=>socket.destroy());await once(socket,'connect');
  socket.write(`GET /jev/${capability}/backend-api/codex/responses HTTP/1.1\r\nHost: 127.0.0.1:${fx.gateway.server.address().port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nthread-id: fixture-thread\r\nchatgpt-account-id: fixture-account\r\n\r\n`);await once(socket,'data');
  socket.write(clientFrame(JSON.stringify(request)));await once(socket,'data');
  assert.equal(received[0].input.length,request.input.length-2);
  policy={...initial,enabled:false};
  const added=message('followup');socket.write(clientFrame(JSON.stringify({...request,previous_response_id:'response-1',input:[added]})));await once(socket,'data');
  assert.deepEqual(received[1].input,[...request.input,output,added]);
  assert.equal(received[1].previous_response_id,null);
  assert.equal(fx.receipts.filter(r=>r.phase==='message_forwarded').at(-1).applied,false);
  assert.equal(fx.receipts.filter(r=>r.phase==='message_forwarded').at(-1).full_context_restored,true);
});

test('a rejected WS has one terminal observation and never claims connection',{timeout:5000},async t => {
  let calls = 0;
  const fx = await fixture(t,(_req,res) => { calls++; res.writeHead(403).end(); });
  const socket = net.connect(fx.gateway.server.address().port,'127.0.0.1'); t.after(() => socket.destroy()); await once(socket,'connect');
  socket.write(`GET /jev/${capability}/backend-api/codex/responses HTTP/1.1\r\nHost: 127.0.0.1:${fx.gateway.server.address().port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`);
  assert.match((await once(socket,'data'))[0].toString(),/502 Bad Gateway/);
  await once(socket,'close');
  assert.equal(calls,1);
  assert.deepEqual(fx.receipts.map(row => row.phase),['received','terminal']);
  assert.equal(fx.receipts[1].upstream_status,403);
  assert.equal(fx.receipts[1].reason,'websocket_rejected');
});

test('compact result preserves full UTF8/JSON bytes and complete failure diagnostics',async () => {
  const dir = await mkdtemp(join(tmpdir(),'jev-output-'));
  const output = 'Я'.repeat(70000)+'\n# tests 2\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
  const result = await compactToolOutput({ output,artifactDir:dir,select:testEvidence });
  assert.equal(result.status,'compact'); assert.equal(result.evidence.pass,2);
  assert.equal(await readFile(result.original.path,'utf8'),output); assert.equal(result.original.sha256,sha256(output));
  const failed = output+'not ok 1 - error\nCOMPLETE STACK\n'; assert.equal(testEvidence(failed).complete_log,failed);
  assert.equal(testEvidence('unknown dialect').status,'unknown');
  assert.equal((await compactToolOutput({ output,artifactDir:dir,select:() => { throw Error('bad selector'); } })).output,output);
  const file = join(dir,'file'); await writeFile(file,'occupied');
  assert.equal((await compactToolOutput({ output,artifactDir:file,select:testEvidence })).status,'full');
});

test('config plan preserves original settings and rollback preserves unrelated newer edits',() => {
  const original = 'model = "gpt-6.1-sol"\r\nmodel_reasoning_effort = "high"\r\n[features]\r\nexample = true\r\n';
  const plan = planGatewayConfig(original,{ port:8768,capability });
  assert.equal(applyGatewayConfig(original,plan),plan.after);
  assert.throws(() => applyGatewayConfig(original+'# changed',plan));
  const tampered = { ...plan,root:plan.root+'unauthorized = true\r\n' };
  tampered.after = tampered.root+original+plan.provider; tampered.after_sha256 = sha256(tampered.after);
  assert.throws(() => applyGatewayConfig(original,tampered));
  assert.equal(rollbackGatewayConfig(plan.after,plan),original);
  assert.equal(rollbackGatewayConfig(plan.after+'# unrelated new comment\r\n',plan),original+'# unrelated new comment\r\n');
  assert.throws(() => planGatewayConfig('model_provider = "existing"\n'+original,{ port:8768,capability }));
  assert.throws(() => rollbackGatewayConfig(plan.after.replace('supports_websockets = false','supports_websockets = true'),plan));
});

test('test output alone does not prove command success and a failing exit cannot pass',() => {
  const output='# tests 1\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
  assert.equal(testEvidence(output).status,'reported_passed');
  assert.equal(testEvidence(output,0).status,'passed');
  assert.equal(testEvidence(output,1).status,'failed');
  assert.equal(testEvidence(output,1).complete_log,output);
});

test('built-in endpoint migration preserves later user edits and validates owned legacy blocks',() => {
  const original = 'model = "gpt-6.1-sol"\r\nmodel_reasoning_effort = "high"\r\n[features]\r\nexample = true\r\n';
  const legacy = planGatewayConfig(original,{ port:8768,capability });
  const current = legacy.after.replace('"high"','"medium"')+'# newer user setting\r\n';
  const plan = planBuiltinGatewayConfig(current,{ port:8768,capability },legacy);
  const applied = applyGatewayConfig(current,plan);
  assert.match(applied,/^# jev-main-gateway root begin\r\nopenai_base_url = "http:\/\/127\.0\.0\.1:8768/);
  assert.doesNotMatch(applied,/model_provider\s*=|\[model_providers\.jev_main\]/);
  assert.equal(rollbackGatewayConfig(applied,plan),original.replace('"high"','"medium"')+'# newer user setting\r\n');
  assert.equal(rollbackGatewayConfig(applied+'# later\r\n',plan),rollbackGatewayConfig(applied,plan)+'# later\r\n');
  assert.throws(() => applyGatewayConfig(current+'# raced',plan));
  const tampered={ ...plan,after:plan.after+'injected = true\r\n' }; tampered.after_sha256=sha256(tampered.after);
  assert.throws(() => applyGatewayConfig(current,tampered));
  assert.throws(() => planBuiltinGatewayConfig(current.replace('supports_websockets = false','supports_websockets = true'),{ port:8768,capability },legacy));
  assert.throws(() => rollbackGatewayConfig(applied.replace('openai_base_url =','openai_base_url_changed ='),plan));
  const fresh=planBuiltinGatewayConfig(original,{ port:8768,capability });
  assert.equal(rollbackGatewayConfig(applyGatewayConfig(original,fresh),fresh),original);
  assert.throws(() => planBuiltinGatewayConfig('openai_base_url = "https://existing.example"\n'+original,{ port:8768,capability }));
  assert.throws(() => planBuiltinGatewayConfig('model_provider = "existing"\n'+original,{ port:8768,capability }));
});

test('config replacement refuses a changed baseline and leaves the complete file intact',async () => {
  const dir = await mkdtemp(join(tmpdir(),'jev-config-')), file = join(dir,'config.toml');
  await writeFile(file,'newer user configuration');
  await assert.rejects(writeGatewayConfig(file,'old baseline','replacement'),/baseline_changed/);
  assert.equal(await readFile(file,'utf8'),'newer user configuration');
  assert.deepEqual(await readdir(dir),['config.toml']);
  await writeGatewayConfig(file,'newer user configuration','complete replacement');
  assert.equal(await readFile(file,'utf8'),'complete replacement');
  assert.deepEqual(await readdir(dir),['config.toml']);
});

test('HTTP error status and compact side call preserve original bytes and do not retry',async t => {
  const received=[];
  const fx = await fixture(t,async (req,res) => { const chunks=[]; for await(const chunk of req) chunks.push(chunk); received.push(Buffer.concat(chunks)); res.writeHead(429,{'retry-after':'3'}).end('upstream error'); },() => policyFor(body()));
  const original=Buffer.from('unparsed compact payload');
  const response=await fetch(fx.base+'/responses/compact',{method:'POST',headers,body:original});
  assert.equal(response.status,429); assert.equal(response.headers.get('retry-after'),'3'); assert.equal(await response.text(),'upstream error');
  assert.deepEqual(received,[original]);
});
