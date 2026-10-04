import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, unlink, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureNodeTests, compactCompletedTests, parseNodeSpec } from './test-output.mjs';
import { createOriginalStore, testEvidence } from './compact-output.mjs';

async function fixture(code) {
  const dir=await mkdtemp(join(tmpdir(),'jev-tests-'));
  const file=join(dir,'fixture.test.mjs');
  await writeFile(file,"import test from 'node:test';\n"+code);
  return {dir,file};
}

test('C02/C03: real completed Unicode test producer compacts only after exact stable readback',async()=>{
  const {dir,file}=await fixture("test('успех 日本語 🦉',()=>{});\n");
  const capture=await captureNodeTests({files:[file]});
  const result=await compactCompletedTests({capture,artifactDir:join(dir,'originals')});
  assert.equal(result.status,'compact',JSON.stringify(result));
  assert.deepEqual(result.counts,{tests:1,suites:0,pass:1,fail:0,cancelled:0,skipped:0,todo:0});
  assert.equal(result.provenance.exit_code,0);
  assert.equal(result.provenance.stdout_eof,true);
  const store=createOriginalStore(join(dir,'originals'));
  for(let i=0;i<2;i++){
    const original=await store.read(result.original);
    assert.equal(original.stdout.toString('utf8'),capture.received.stdout.data);
    assert.equal(original.stderr.length,0);
    assert.deepEqual(original.provenance,result.provenance);
  }
});

const valid='✔ успех 🦉 (1.25ms)\nℹ tests 1\nℹ suites 0\nℹ pass 1\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\nℹ duration_ms 2.5\n';

test('C02/C04: full LF/CRLF grammar extracts every record and rejects incomplete or unsafe text',()=>{
  const expected={records:[{name:'успех 🦉',duration_ms:1.25}],counts:{tests:1,suites:0,pass:1,fail:0,cancelled:0,skipped:0,todo:0},duration_ms:2.5};
  assert.deepEqual(parseNodeSpec(Buffer.from(valid)),expected);
  assert.deepEqual(parseNodeSpec(Buffer.from(valid.replaceAll('\n','\r\n'))),expected);
  const bad=[valid.slice(valid.indexOf('ℹ')),valid.replace('ℹ pass 1','ℹ pass 2'),valid+valid,
    valid.replace('✔ успех 🦉 (1.25ms)\n',''),valid.replace('ℹ todo 0\n',''),valid.trimEnd(),
    'Warning: unknown\n'+valid,'\x1b[32m'+valid,valid.replace('ℹ tests 1','ℹ tests 01'),
    valid.replace('ℹ duration_ms 2.5','ℹ duration_ms Infinity'),valid.replace('ℹ suites 0','ℹ suites 1'),
    valid.replace('ℹ skipped 0','ℹ skipped 1'),valid.replace('ℹ todo 0','ℹ todo 1'),
    valid.replace('ℹ cancelled 0','ℹ cancelled 1'),valid.replace('ℹ fail 0','ℹ fail 1'),
    valid.replace('ℹ pass 1\n','ℹ pass 1\nℹ pass 1\n'),valid.replace('✔','✖'),
    valid.replace('успех 🦉','nested\n  ✔ child'),valid.replace('\n','\r\n'), '\uFEFF'+valid];
  for(const text of bad) assert.throws(()=>parseNodeSpec(Buffer.from(text)),undefined,text);
  assert.throws(()=>parseNodeSpec(Buffer.from([0xff,0xfe])));
});

test('C04: real failures, diagnostics, unknown stdout and invalid encoding return exact received bytes',async()=>{
  const cases=[
    "test('failure',()=>{throw Error('важная диагностика 🦉')});",
    "process.stderr.write('unknown warning 🦉\\n'); test('ok',()=>{});",
    "console.log('unknown stdout 🦉'); test('ok',()=>{});",
    "process.stdout.write(Buffer.from([255,254])); test('ok',()=>{});",
    "test('skipped',{skip:true},()=>{});",
    "test('todo',{todo:true},()=>{});",
    "test('suite',async t=>{await t.test('nested',()=>{})});",
    "process.stdout.write('ℹ tests 1\\nℹ suites 0\\nℹ pass 1\\nℹ fail 0\\nℹ cancelled 0\\nℹ skipped 0\\nℹ todo 0\\nℹ duration_ms 2\\n');process.exit(0);",
    "process.kill(process.pid,'SIGTERM');"
  ];
  for(const code of cases){
    const {dir,file}=await fixture(code),capture=await captureNodeTests({files:[file]});
    const result=await compactCompletedTests({capture,artifactDir:join(dir,'originals')});
    assert.equal(result.status,'verbatim');assert.deepEqual(result.received,capture.received);
    assert.deepEqual(result.provenance,capture.provenance);assert.equal(result.original,undefined);
    await assert.rejects(readdir(join(dir,'originals')),{code:'ENOENT'});
  }
});

test('C04: forged completion, edited capture view, missing command, timeout and cancellation cannot invent success',async()=>{
  const forged={provenance:{exit_code:0,completion:'closed',capture_complete:true},received:{stdout:{encoding:'utf8',data:valid},stderr:{encoding:'utf8',data:''}}};
  assert.equal((await compactCompletedTests({capture:forged})).reason,'unwitnessed_capture');
  const {dir,file}=await fixture("test('ok',()=>{});");
  const capture=await captureNodeTests({files:[file]});
  const actual=structuredClone(capture);
  capture.provenance.exit_code=42;capture.received.stdout.data='tampered';
  const result=await compactCompletedTests({capture,artifactDir:join(dir,'originals')});
  assert.equal(result.status,'compact');assert.equal(result.provenance.exit_code,0);
  assert.equal((await createOriginalStore(join(dir,'originals')).read(result.original)).stdout.toString(),actual.received.stdout.data);
  const missing=await captureNodeTests({files:[join(dir,'missing.test.mjs')]});
  assert.equal((await compactCompletedTests({capture:missing,artifactDir:dir})).status,'verbatim');
  const spawnError=await captureNodeTests({files:[file],cwd:join(dir,'missing-directory')});
  assert.equal(spawnError.provenance.capture_complete,false);assert.notEqual(spawnError.provenance.error,null);
  assert.equal((await compactCompletedTests({capture:spawnError,artifactDir:dir})).status,'verbatim');
  for(const metadata of [{exit_code:null},{signal:'SIGTERM'},{stdout_eof:false},{stderr_eof:false},{truncated:true},{node_version:'unknown'}]){
    const untrusted={...forged,provenance:{...forged.provenance,...metadata}};
    assert.equal((await compactCompletedTests({capture:untrusted})).status,'verbatim');
  }
  const hanging=await fixture("await new Promise(r=>setTimeout(r,300));test('late',()=>{});");
  const timed=await captureNodeTests({files:[hanging.file],timeoutMs:50});
  assert.equal(timed.provenance.timed_out,true);
  assert.equal((await compactCompletedTests({capture:timed,artifactDir:dir})).status,'verbatim');
  const controller=new AbortController();controller.abort();
  const cancelled=await captureNodeTests({files:[hanging.file],signal:controller.signal});
  assert.equal(cancelled.provenance.cancelled,true);
  assert.equal((await compactCompletedTests({capture:cancelled,artifactDir:dir})).status,'verbatim');
});

test('C03/C05: atomic large-byte originals retain occurrences and reject missing, changed or colliding readbacks',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'jev-original-')),store=createOriginalStore(dir);
  const stdout=Buffer.from('🦉日本語Я\r\n'.repeat(15000)),stderr=Buffer.from([0,255,13,10]);
  const provenance={run_id:randomUUID(),exit_code:0,completion:'closed'};
  const reference=await store.publish({stdout,stderr,provenance});
  const original=await store.read(reference);assert.deepEqual(original.stdout,stdout);assert.deepEqual(original.stderr,stderr);
  await assert.rejects(store.publish({stdout,stderr,provenance}),{code:'EEXIST'});
  assert.deepEqual((await store.read(reference)).stdout,stdout);
  const refs=await Promise.all(Array.from({length:4},()=>store.publish({stdout,stderr,provenance:{...provenance,run_id:randomUUID()}})));
  assert.equal(new Set(refs.map(ref=>ref.id)).size,4);
  const same={...provenance,run_id:randomUUID()};
  const race=await Promise.allSettled([store.publish({stdout,stderr,provenance:same}),store.publish({stdout,stderr,provenance:same})]);
  assert.equal(race.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(race.find(x=>x.status==='rejected').reason.code,'EEXIST');
  assert.ok((await readdir(dir)).every(name=>name.endsWith('.original')));
  await writeFile(reference.path,'corrupted');await assert.rejects(store.read(reference),/original_mismatch/);
  await unlink(reference.path);await assert.rejects(store.read(reference),{code:'ENOENT'});
  const staging=join(dir,'interrupted.staging');await writeFile(staging,'partial');
  await assert.rejects(store.read({...reference,id:randomUUID()}),/original_reference/);
  assert.equal(await readFile(staging,'utf8'),'partial');
});

test('C05: storage and readback faults never hide the completed received result',async()=>{
  const {dir,file}=await fixture("test('ok',()=>{});");
  const capture=await captureNodeTests({files:[file]});
  const denied=join(dir,'not-a-directory');await writeFile(denied,'original user data');
  const failures=[{artifactDir:denied},{store:{publish:async()=>{throw Error('publication_interrupted');}}}];
  const real=createOriginalStore(join(dir,'originals'));
  for(const fault of ['missing','mismatch','denied']){
    failures.push({store:{publish:real.publish.bind(real),read:async ref=>{
      if(fault==='missing'){await unlink(ref.path);return real.read(ref);}
      if(fault==='denied')throw Error('read_denied');
      const original=await real.read(ref);return {...original,stdout:Buffer.from('mismatch')};
    }}});
  }
  failures.push({store:{publish:async original=>{
    original.stdout.fill(0);original.provenance.exit_code=1;return real.publish(original);
  },read:real.read.bind(real)}});
  for(const options of failures){
    // Fresh occurrence prevents a previous published name from masking the fault.
    const next=await captureNodeTests({files:[file]});
    const result=await compactCompletedTests({capture:next,...options});
    assert.equal(result.status,'verbatim');assert.deepEqual(result.received,next.received);
    assert.equal(result.original,undefined);assert.match(result.reason,/^original:/);
  }
  assert.equal(await readFile(denied,'utf8'),'original user data');
  assert.equal(capture.provenance.capture_complete,true);
});

test('C03/C05: final publication exposes complete bytes only; interrupted staging is never a reference',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'jev-publication-')),store=createOriginalStore(dir);
  const stdout=Buffer.from('🦉'.repeat(1000000)),stderr=Buffer.alloc(0),provenance={run_id:randomUUID()};
  const path=join(dir,`${provenance.run_id}.original`),observed=[];
  const publication=store.publish({stdout,stderr,provenance});
  let done=false;publication.then(()=>{done=true;},()=>{done=true;});
  while(!done){
    try{observed.push(await readFile(path));}catch(error){assert.equal(error.code,'ENOENT');}
    await new Promise(r=>setTimeout(r,1));
  }
  const reference=await publication,complete=await readFile(path);observed.push(complete);
  for(const bytes of observed)assert.deepEqual(bytes,complete);
  assert.deepEqual((await store.read(reference)).stdout,stdout);
  const collision={run_id:randomUUID()},blocked=join(dir,`${collision.run_id}.original`);
  await mkdir(blocked);await assert.rejects(store.publish({stdout,stderr,provenance:collision}),{code:'EEXIST'});
  assert.ok((await readdir(dir)).every(name=>!name.endsWith('.staging')));
});

test('C07: old explicit helper CLI remains schema1 partial view, not strict witnessed success',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'jev-legacy-')),file=join(dir,'log.txt');
  const legacy='Я'.repeat(70000)+'\nℹ tests 1\nℹ pass 1\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\n';
  await writeFile(file,legacy);
  const result=JSON.parse((await promisify(execFile)(process.execPath,['integration/compact-output.mjs',file,dir,'0'],{windowsHide:true})).stdout);
  assert.equal(result.schema_version,1);assert.equal(result.selection,'explicit_partial_view');
  assert.equal(result.evidence.status,'passed');assert.equal(await readFile(result.original.path,'utf8'),legacy);
  assert.equal(testEvidence(legacy).status,'reported_passed');
  assert.throws(()=>parseNodeSpec(Buffer.from(legacy)));
});

test('C04: timeout stops the owned test worker as well as the reporting parent',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'jev-cancel-tree-')),file=join(dir,'worker.test.mjs'),marker=join(dir,'late-write'),started=join(dir,'started');
  await writeFile(file,"import {writeFile} from 'node:fs/promises';\nawait writeFile("+JSON.stringify(started)+",'started');\nawait new Promise(r=>setTimeout(r,1000));\nawait writeFile("+JSON.stringify(marker)+",'orphan worker');\n");
  const capture=await captureNodeTests({files:[file],timeoutMs:400});
  assert.equal(capture.provenance.timed_out,true);
  assert.equal(await readFile(started,'utf8'),'started');
  await new Promise(r=>setTimeout(r,1100));
  await assert.rejects(readFile(marker),{code:'ENOENT'});
});
