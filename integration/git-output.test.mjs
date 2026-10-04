import test from 'node:test';
import assert from 'node:assert/strict';
import {parseGitStatus,captureGitStatus,compactCompletedGit} from './git-output.mjs';
import {fixture,expectedDirty} from './git-fixture.mjs';
import {mkdtemp,readFile,writeFile,unlink,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {createOriginalStore} from './compact-output.mjs';
import {compactCompleted,receivedStream} from './completed-output.mjs';

test('C02: literal Git rename oracle preserves ordered paths and exact controls',()=>{
  const bytes=Buffer.from(' M space 日本語 🦉\0R  dest -> file\0source\t\n\r"\\\0?? -new\0');
  assert.deepEqual(parseGitStatus(bytes),[
    {xy:' M',path:'space 日本語 🦉',orig_path:null},
    {xy:'R ',path:'dest -> file',orig_path:'source\t\n\r"\\'},
    {xy:'??',path:'-new',orig_path:null}]);
});

test('C02/C03: all frozen XY codes, large output and POSIX controls preserve full grammar',t=>{
  const codes=['??',' M',' A',' D',' T',' R','D ',...['M','T','A','R'].flatMap(x=>[' ','M','T','D'].map(y=>x+y))];
  for(const xy of codes){
    const text=xy+' \uFEFFliteral -> 日本語\t\n\r"\\\x01\0'+(xy.includes('R')?'source 🦉\0':'');
    assert.deepEqual(parseGitStatus(Buffer.from(text)),[{xy,path:'\uFEFFliteral -> 日本語\t\n\r"\\\x01',orig_path:xy.includes('R')?'source 🦉':null}]);
  }
  const large=Buffer.from(Array.from({length:4000},(_,i)=>`?? file-${i} 🦉\0`).join(''));
  const parsed=parseGitStatus(large);assert.equal(parsed.length,4000);assert.deepEqual(parsed[3999],{xy:'??',path:'file-3999 🦉',orig_path:null});
  assert.deepEqual(parseGitStatus(Buffer.alloc(0)),[]);
  t.diagnostic(`${codes.length} supported status codes; 4000 complete records; POSIX controls synthetic`);
});

test('C03: conflicts and malformed byte boundaries are rejected without partial extraction',t=>{
  const variants=['DD','AU','UD','UA','DU','AA','UU','C ','!!',' m','  ','ZZ'].map(xy=>Buffer.from(xy+' file\0'));
  for(const text of ['?? path','?? \0','?? path\0\0','R  dest\0','R  dest\0\0','?? path\0extra\0',
    'R  dest\0source\0extra\0','?? path\0suffix','??path\0','## main\0','warning\n','\uFEFF?? path\0'])variants.push(Buffer.from(text));
  variants.push(Buffer.from([63,63,32,255,0]),Buffer.from([63,63,32,0xc0,0xaf,0]));
  for(const bytes of variants)assert.throws(()=>parseGitStatus(bytes),undefined,bytes.toString('hex'));
  assert.throws(()=>parseGitStatus(undefined));t.diagnostic(`${variants.length} rejected byte/status adversaries`);
});

test('C02/C04: synthetic POSIX control bytes and type changes survive atomic exact readback',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'jev-git-controls-')),store=createOriginalStore(dir);
  const stdout=Buffer.from(' T \uFEFFname\n\r\t"\\ -> 🦉\x01\0'),stderr=Buffer.from('synthetic diagnostics\n');
  const provenance={run_id:randomUUID(),source:'synthetic POSIX byte fixture; not real Windows command completion'};
  const ref=await store.publish({stdout,stderr,provenance});
  for(let i=0;i<2;i++){const read=await store.read(ref);assert.deepEqual(read.stdout,stdout);assert.deepEqual(read.stderr,stderr);assert.deepEqual(read.provenance,provenance);}
  assert.deepEqual(parseGitStatus(stdout),[{xy:' T',path:'\uFEFFname\n\r\t"\\ -> 🦉\x01',orig_path:null}]);
});

test('C03: private capture cannot be forged, edited or switched to a different profile',async()=>{
  for(const flags of [{},{exit_code:null},{exit_code:1},{stdout_eof:false},{stderr_eof:false},{error:'fault'},
    {truncated:true},{signal:'SIGTERM'},{timed_out:true},{cancelled:true},{git_version:'unsupported'}]){
    const capture={provenance:{exit_code:0,completion:'closed',capture_complete:true,...flags},received:{stdout:{encoding:'utf8',data:''},stderr:{encoding:'utf8',data:''}}};
    const result=await compactCompletedGit({capture,artifactDir:'unused'});
    assert.equal(result.status,'verbatim');assert.equal(result.reason,'unwitnessed_capture');assert.equal(result.clean,undefined);
    assert.deepEqual(result.received,capture.received);
  }
  const root=await fixture('dirty'),capture=await captureGitStatus({cwd:root}),original=structuredClone(capture);
  capture.received.stdout.data='';capture.provenance.exit_code=1;capture.provenance.git_version='invented';
  const dir=await mkdtemp(join(tmpdir(),'jev-git-edited-'));
  const result=await compactCompletedGit({capture,artifactDir:dir,parse:()=>[],select:()=>({clean:true})});
  assert.equal(result.clean,false);assert.deepEqual(result.entries,expectedDirty);assert.deepEqual(result.provenance,original.provenance);
  const wrong=await compactCompleted({capture,profile:'node-spec-flat-v1',artifactDir:dir,parse:()=>[],select:()=>({clean:true})});
  assert.equal(wrong.reason,'capture_profile');assert.deepEqual(wrong.received,original.received);
});

test('C03: real conflict, diagnostics, nonrepository, cancel and timeout retain exact received',async()=>{
  const conflict=await captureGitStatus({cwd:await fixture('conflict')});
  assert.equal(conflict.provenance.exit_code,0);
  const conflictResult=await compactCompletedGit({capture:conflict,artifactDir:'unused'});
  assert.equal(conflictResult.reason,'parser:unmerged_conflict');assert.deepEqual(conflictResult.received,conflict.received);
  const bypass=await compactCompleted({capture:conflict,profile:'git-status-porcelain-v1-z',artifactDir:'unused',parse:()=>[],select:()=>({clean:true})});
  assert.equal(bypass.reason,'parser:unmerged_conflict');assert.equal(bypass.clean,undefined);
  const root=await fixture('dirty'),indexPath=join(root,'.git/index'),index=await readFile(indexPath),extension=Buffer.alloc(8);
  extension.write('JEVX');const body=Buffer.concat([index.subarray(0,-20),extension]);
  await writeFile(indexPath,Buffer.concat([body,createHash('sha1').update(body).digest()]));
  const warning=await captureGitStatus({cwd:root}),result=await compactCompletedGit({capture:warning,artifactDir:'unused'});
  assert.equal(warning.provenance.exit_code,0);assert.ok(warning.received.stdout.data.includes('MM modify.txt'));
  assert.ok(warning.received.stderr.data.length>0);assert.equal(result.reason,'stderr_diagnostic');assert.deepEqual(result.received,warning.received);
  const dir=await mkdtemp(join(tmpdir(),'jev-git-unsafe-')),abort=new AbortController();abort.abort();
  for(const capture of [await captureGitStatus({cwd:dir}),await captureGitStatus({cwd:join(dir,'missing')}),
    await captureGitStatus({cwd:await fixture(),signal:abort.signal}),await captureGitStatus({cwd:await fixture(),timeoutMs:1})]){
    const full=await compactCompletedGit({capture,artifactDir:'unused'});
    assert.equal(full.status,'verbatim');assert.equal(full.clean,undefined);assert.equal(full.original,undefined);assert.deepEqual(full.received,capture.received);
  }
  assert.deepEqual(receivedStream(Buffer.from([255,0])),{encoding:'base64',data:'/wA='});
});

test('C01/C03: inherited Git overrides cannot redirect real root, index, version or streams',async()=>{
  const root=await fixture(),previous={...process.env};
  try{
    process.env.GIT_DIR='missing';process.env.GIT_INDEX_FILE='missing';process.env.GIT_WORK_TREE='missing';
    process.env.GIT_CONFIG_COUNT='1';process.env.GIT_CONFIG_KEY_0='core.bare';process.env.GIT_CONFIG_VALUE_0='true';
    process.env.GIT_TRACE='1';process.env.GIT_REDIRECT_STDOUT='missing';
    const capture=await captureGitStatus({cwd:root});
    assert.equal(capture.provenance.exit_code,0);assert.equal(capture.provenance.root_verified,true);
    assert.equal(capture.provenance.git_version,'git version 2.56.0.windows.1');assert.equal(capture.received.stdout.data,'');assert.equal(capture.received.stderr.data,'');
    assert.equal(capture.provenance.probes.length,2);assert.match(capture.provenance.executable_sha256,/^[a-f0-9]{64}$/);
  }finally{for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);}
});

test('C02: real large nonignored untracked listing retains every file',async()=>{
  const root=await fixture();for(let i=0;i<250;i++)await writeFile(join(root,`file-${String(i).padStart(3,'0')} 🦉.txt`),'fixture\n');
  const capture=await captureGitStatus({cwd:root}),dir=await mkdtemp(join(tmpdir(),'jev-git-large-'));
  const result=await compactCompletedGit({capture,artifactDir:dir});assert.equal(result.status,'compact');assert.equal(result.records,250);
  assert.deepEqual(result.entries,Array.from({length:250},(_,i)=>({xy:'??',path:`file-${String(i).padStart(3,'0')} 🦉.txt`,orig_path:null})));
});

test('C04: Git store/readback failures, collision, concurrency and mutation preserve originals',async()=>{
  const root=await fixture('dirty'),dir=await mkdtemp(join(tmpdir(),'jev-git-faults-')),real=createOriginalStore(join(dir,'originals'));
  const blocker=join(dir,'blocker');await writeFile(blocker,'preserved 🦉');
  const options=[{artifactDir:blocker},{store:{publish:async()=>{throw Error('interrupted');}}}];
  for(const fault of ['missing','denied','mismatch','metadata'])options.push({store:{publish:real.publish.bind(real),read:async ref=>{
    if(fault==='missing'){await unlink(ref.path);return real.read(ref);}if(fault==='denied')throw Error('read_denied');
    const original=await real.read(ref);return fault==='mismatch'?{...original,stdout:Buffer.from('wrong')}:{...original,provenance:{}};
  }}});
  options.push({store:{publish:async original=>{original.stdout.fill(0);original.provenance.exit_code=1;return real.publish(original);},read:real.read.bind(real)}});
  for(const option of options){const capture=await captureGitStatus({cwd:root}),result=await compactCompletedGit({capture,...option});
    assert.equal(result.status,'verbatim');assert.match(result.reason,/^original:/);assert.deepEqual(result.received,capture.received);assert.equal(result.original,undefined);}
  assert.equal(await readFile(blocker,'utf8'),'preserved 🦉');
  const capture=await captureGitStatus({cwd:root}),saved=await compactCompletedGit({capture,store:real});assert.equal(saved.status,'compact');
  const collision=await compactCompletedGit({capture,store:real});assert.equal(collision.reason,'original:EEXIST');
  const next=await captureGitStatus({cwd:root}),results=await Promise.all([compactCompletedGit({capture:next,store:real}),compactCompletedGit({capture:next,store:real})]);
  assert.equal(results.filter(x=>x.status==='compact').length,1);assert.equal(results.find(x=>x.status==='verbatim').reason,'original:EEXIST');
  assert.equal((await real.read(saved.original)).stdout.toString(),capture.received.stdout.data);
  assert.ok((await readdir(join(dir,'originals'))).every(x=>x.endsWith('.original')));
});

test('C02/C04: real clean and dirty Git producer preserves literal oracle and original twice',async()=>{
  for(const kind of ['clean','dirty']){
    const root=await fixture(kind),dir=await mkdtemp(join(tmpdir(),'jev-git-original-'));
    const before=await readFile(join(root,'.git/index'));
    const capture=await captureGitStatus({cwd:root});
    assert.equal(capture.provenance.exit_code,0);assert.equal(capture.received.stderr.data,'');
    const result=await compactCompletedGit({capture,artifactDir:dir});
    assert.equal(result.status,'compact',JSON.stringify(result));assert.equal(result.clean,kind==='clean');
    assert.deepEqual(result.entries,kind==='clean'?[]:expectedDirty);assert.equal(result.records,result.entries.length);
    const reconstructed=Buffer.from(result.entries.map(r=>r.xy+' '+r.path+'\0'+(r.orig_path===null?'':r.orig_path+'\0')).join(''));
    assert.equal(reconstructed.toString(),capture.received.stdout.data);
    for(let i=0;i<2;i++){
      const restored=await createOriginalStore(dir).read(result.original);
      assert.deepEqual(restored.stdout,reconstructed);assert.equal(restored.stderr.length,0);
      assert.deepEqual(restored.provenance,capture.provenance);
    }
    assert.deepEqual(await readFile(join(root,'.git/index')),before);
  }
});
