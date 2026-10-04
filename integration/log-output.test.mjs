import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,unlink,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {captureGatewayLogs,compactCompletedLogs,parseGatewayLogs} from './log-output.mjs';
import {createOriginalStore} from './compact-output.mjs';
import {produceGatewayLogs} from './log-producer.mjs';
import {captureNodeTests} from './test-output.mjs';
import {compactCompleted,receivedStream} from './completed-output.mjs';

test('C02: completed real gateway logs preserve every semantic field and original byte',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'jev-logs-'));
  const capture=await captureGatewayLogs();
  assert.equal(capture.provenance.exit_code,0);assert.equal(capture.received.stderr.data,'');
  const expected=capture.received.stdout.data.trimEnd().split('\n').map(line=>JSON.parse(line));
  assert.equal(expected.length,3);
  assert.deepEqual(expected.map(r=>r.phase),['received','connected','terminal']);
  for(const row of expected)assert.equal(Object.keys(row).length,22);
  assert.deepEqual(parseGatewayLogs(Buffer.from(capture.received.stdout.data)),expected);
  const compact=await compactCompletedLogs({capture,artifactDir:dir});
  assert.equal(compact.status,'compact');assert.equal(compact.profile,'gateway-http-models-passthrough-v2');
  assert.deepEqual(compact.events.map(event=>({...compact.common,...event})),expected);
  assert.equal(compact.records,3);assert.deepEqual(compact.provenance,capture.provenance);
  const store=createOriginalStore(dir);
  for(let i=0;i<2;i++){
    const original=await store.read(compact.original);
    assert.equal(original.stdout.toString(),capture.received.stdout.data);
    assert.equal(original.stderr.length,0);assert.deepEqual(original.provenance,capture.provenance);
  }
});

// Independent, literal schema oracle derived from the frozen existing writer.
const empty='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const base={schema_version:2,request_id:'12345678-1234-4123-8123-123456789abc',process_id:123,thread_sha256:null,
  transport:'http',route:'models',applied:false,reason:'passthrough',before_sha256:null,after_sha256:null,
  before_bytes:null,after_bytes:null,protected:[],excluded:[],upstream_status:null,completed:false,
  upstream_body_written:false,provider_usage:null,cost_usd:null};
const golden=[{...base,phase:'received',observed_at:'2026-10-04T00:00:00.000Z',latency_ms:0.25},
  {...base,before_sha256:empty,after_sha256:empty,before_bytes:0,after_bytes:0,upstream_status:200,
    phase:'connected',observed_at:'2026-10-04T00:00:00.001Z',latency_ms:1.25},
  {...base,before_sha256:empty,after_sha256:empty,before_bytes:0,after_bytes:0,upstream_status:200,
    completed:true,upstream_body_written:true,phase:'terminal',observed_at:'2026-10-04T00:00:00.002Z',latency_ms:2.25}];
const encode=rows=>rows.map(row=>JSON.stringify(row)+'\n').join('');
test('C02/C03: full log grammar accepts escapes and rejects unknown, missing and contradictory evidence',t=>{
  const valid=encode(golden);
  assert.deepEqual(parseGatewayLogs(Buffer.from(valid)),golden);
  assert.deepEqual(parseGatewayLogs(Buffer.from(valid.replaceAll('\n','\r\n'))),golden);
  assert.deepEqual(parseGatewayLogs(Buffer.from(valid.replaceAll('"http"','"h\\u0074tp"').replaceAll('"schema_version"','"schema_\\u0076ersion"'))),golden);
  const variants=[valid.trimEnd(),valid+'\n',valid+JSON.stringify(golden[2])+'\n','warning 🦉\n'+valid,
    valid+'unexpected 日本語\n',valid.replace('\n','\r\n'),'\uFEFF'+valid,
    encode(golden.slice(1)),encode([golden[0],golden[2]]),encode([golden[1],golden[0],golden[2]]),
    encode([golden[0],golden[1],golden[1]]),valid.replace('"process_id":123','"process_id":123,"process_id":123'),
    valid.replace('"process_id":123','"process_id":123,"process_\\u0069d":123'),
    valid.replace('"latency_ms":0.25','"latency_ms":0.25000000000000001'),
    valid.replace('"latency_ms":0.25','"latency_ms":1e-999'),valid.replace('"latency_ms":0.25','"latency_ms":1e999'),
    valid.replace('"latency_ms":0.25','"latency_ms":-0'),valid.replace('"process_id":123','"process_id":9007199254740993'),
    valid.replace('"schema_version":2','"schema_version":02'),valid.replace('"schema_version":2','"schema_version":2,'),
    valid.replace('"http"','{}'),valid.replace('"http"','["http"]'),valid.replace('"http"','NaN')];
  for(const [key,value] of Object.entries({schema_version:3,request_id:'invalid',process_id:0,thread_sha256:'invalid',transport:'ws',route:'responses',applied:true,reason:'warning 🦉',before_sha256:empty,after_sha256:empty,before_bytes:0,after_bytes:0,protected:['p'],excluded:['e'],upstream_status:200,completed:true,upstream_body_written:true,provider_usage:0,cost_usd:0,phase:'unknown',observed_at:'2026-02-30T00:00:00.000Z',latency_ms:-1})){
    const rows=structuredClone(golden);rows[0][key]=value;variants.push(encode(rows));
  }
  for(const key of Object.keys(base)){
    const rows=structuredClone(golden);delete rows[1][key];variants.push(encode(rows));
  }
  for(const [key,value] of Object.entries({request_id:'12345678-1234-4123-8123-123456789abd',process_id:124,thread_sha256:'a'.repeat(64),before_sha256:null,after_sha256:null,before_bytes:1,after_bytes:1,upstream_status:500,completed:true,upstream_body_written:null,observed_at:'2026-10-03T00:00:00.000Z',latency_ms:0.1})){
    const rows=structuredClone(golden);rows[1][key]=value;variants.push(encode(rows));
  }
  const unknown=structuredClone(golden);unknown[2].unknown='🦉';variants.push(encode(unknown));
  const incomplete=structuredClone(golden);incomplete[2].completed=false;variants.push(encode(incomplete));
  const unwritten=structuredClone(golden);unwritten[2].upstream_body_written=false;variants.push(encode(unwritten));
  for(const text of variants)assert.throws(()=>parseGatewayLogs(Buffer.from(text)),undefined,text);
  assert.throws(()=>parseGatewayLogs(Buffer.from([255,254])));
  t.diagnostic(`${variants.length+1} unsafe byte/record/field cases rejected; three positive grammar variants`);
});

test('C03: JSON whitespace follows object grammar without losing bytes',()=>{
  const text=golden.map(row=>' \t'+JSON.stringify(row)+'\t \n').join('');
  assert.deepEqual(parseGatewayLogs(Buffer.from(text)),golden);
});

test('C03/C04: diagnostics and actual timeout/cancel/spawn failure preserve full received streams',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'jev-log-unsafe-'));
  const diagnostic=await captureGatewayLogs({diagnostic:true});
  const warning=await compactCompletedLogs({capture:diagnostic,artifactDir:dir});
  assert.equal(warning.reason,'stderr_diagnostic');assert.deepEqual(warning.received,diagnostic.received);
  assert.match(warning.received.stderr.data,/unknown warning 🦉/);assert.equal(warning.original,undefined);
  // Capture view edits cannot erase a real diagnostic or alter provenance.
  const original=structuredClone(diagnostic);diagnostic.received.stderr.data='';diagnostic.provenance.exit_code=0;
  assert.deepEqual((await compactCompletedLogs({capture:diagnostic,artifactDir:dir})).received,original.received);
  const abort=new AbortController();abort.abort();
  const captures=[await captureGatewayLogs({timeoutMs:1}),await captureGatewayLogs({signal:abort.signal}),
    await captureGatewayLogs({cwd:join(dir,'missing')})];
  for(const capture of captures){
    const result=await compactCompletedLogs({capture,artifactDir:dir});
    assert.equal(result.status,'verbatim');assert.equal(result.reason,'unsafe_completion');
    assert.deepEqual(result.received,capture.received);assert.deepEqual(result.provenance,capture.provenance);
  }
  const publicCapture={provenance:{exit_code:0,completion:'closed',capture_complete:true,stdout_eof:true,stderr_eof:true},
    received:{stdout:{encoding:'utf8',data:encode(golden)},stderr:{encoding:'utf8',data:''}}};
  for(const flags of [{},{exit_code:null},{exit_code:1},{stdout_eof:false},{stderr_eof:false},{error:'fault'},
    {truncated:true},{signal:'SIGTERM'},{timed_out:true},{cancelled:true},{node_version:'unknown'}]){
    const capture={...publicCapture,provenance:{...publicCapture.provenance,...flags}};
    const result=await compactCompletedLogs({capture,artifactDir:dir});
    assert.equal(result.reason,'unwitnessed_capture');assert.deepEqual(result.received,capture.received);
  }
  const file=join(dir,'wrong.test.mjs');await writeFile(file,"process.stdout.write('unknown 日本語 🦉\\n');process.exit(1);");
  const wrongProfile=await captureNodeTests({files:[file]});
  const wrong=await compactCompletedLogs({capture:wrongProfile,artifactDir:dir});
  assert.equal(wrong.reason,'capture_profile');assert.deepEqual(wrong.received,wrongProfile.received);
  assert.deepEqual(receivedStream(Buffer.from([255,254,0])),{encoding:'base64',data:'//4A'});
  assert.deepEqual(receivedStream(Buffer.from('日本語 🦉\r\n')),{encoding:'utf8',data:'日本語 🦉\r\n'});
});

test('C03: suppressed receipt writer faults remain producer failures',async()=>{
  for(const write of [()=>{throw Error('sync_write_failed');},()=>Promise.reject(Error('async_write_failed'))]){
    await assert.rejects(produceGatewayLogs({write}),/write_failed/);
  }
  const rows=[];await produceGatewayLogs({write:text=>rows.push(JSON.parse(text))});
  assert.equal(rows.length,3);assert.equal(rows[2].completed,true);
});

test('C03/C05: real unexpected records and invalid UTF8 flow byte-exact through the log fallback',async()=>{
  for(const fault of ['unexpected-record','invalid-utf8']){
    const capture=await captureGatewayLogs({fault});
    assert.equal(capture.provenance.exit_code,0);
    const result=await compactCompletedLogs({capture,artifactDir:'unused-unsafe-originals'});
    assert.equal(result.status,'verbatim');assert.match(result.reason,/^parser:/);
    assert.deepEqual(result.received,capture.received);assert.equal(result.original,undefined);
    if(fault==='unexpected-record')assert.match(result.received.stdout.data,/unexpected 日本語 🦉/);
    else{assert.equal(result.received.stdout.encoding,'base64');assert.equal(Buffer.from(result.received.stdout.data,'base64')[0],255);}
  }
});

test('C04: log publication/readback faults and parser faults keep exact received; originals persist',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'jev-log-store-')),real=createOriginalStore(join(dir,'originals'));
  const blocker=join(dir,'blocker');await writeFile(blocker,'user state 🦉');
  const options=[{artifactDir:blocker},{store:{publish:async()=>{throw Error('interrupted');}}}];
  for(const fault of ['missing','denied','mismatch','metadata'])options.push({store:{publish:real.publish.bind(real),read:async ref=>{
    if(fault==='missing'){await unlink(ref.path);return real.read(ref);}
    if(fault==='denied')throw Error('read_denied');
    const original=await real.read(ref);
    return fault==='mismatch'?{...original,stdout:Buffer.from('🦉 mismatch')}:{...original,provenance:{...original.provenance,exit_code:1}};
  }}});
  options.push({store:{publish:async original=>{original.stdout.fill(0);original.provenance.exit_code=1;return real.publish(original);},read:real.read.bind(real)}});
  for(const option of options){
    const capture=await captureGatewayLogs(),result=await compactCompletedLogs({capture,...option});
    assert.equal(result.status,'verbatim');assert.match(result.reason,/^original:/);
    assert.deepEqual(result.received,capture.received);assert.equal(result.original,undefined);
  }
  assert.equal(await readFile(blocker,'utf8'),'user state 🦉');
  const capture=await captureGatewayLogs();
  const parserFault=await compactCompleted({capture,profile:'gateway-http-models-passthrough-v2',artifactDir:dir,
    parse:()=>{throw Error('parser_unavailable');},select:()=>{throw Error('unexpected');}});
  assert.equal(parserFault.reason,'parser:parser_unavailable');assert.deepEqual(parserFault.received,capture.received);
  const completed=await compactCompletedLogs({capture,store:real});assert.equal(completed.status,'compact');
  const collision=await compactCompletedLogs({capture,store:real});assert.equal(collision.reason,'original:EEXIST');
  assert.deepEqual(collision.received,capture.received);
  assert.deepEqual((await real.read(completed.original)).stdout,Buffer.from(capture.received.stdout.data));
  const next=await captureGatewayLogs(),results=await Promise.all([compactCompletedLogs({capture:next,store:real}),compactCompletedLogs({capture:next,store:real})]);
  assert.equal(results.filter(r=>r.status==='compact').length,1);assert.equal(results.find(r=>r.status==='verbatim').reason,'original:EEXIST');
  assert.ok((await readdir(join(dir,'originals'))).every(name=>name.endsWith('.original')));
});
