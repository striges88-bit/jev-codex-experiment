import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {realpath,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createOriginalStore} from './compact-output.mjs';
const captures=new WeakMap();
const decoder=()=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
export function receivedStream(bytes) {
  try { return {encoding:'utf8',data:decoder().decode(bytes)}; }
  catch { return {encoding:'base64',data:bytes.toString('base64')}; }
}
const gitStatuses=new Set(['??',' M',' A',' D',' T',' R','D ',...['M','T','A','R'].flatMap(x=>[' ','M','T','D'].map(y=>x+y))]);
const gitConflicts=new Set(['DD','AU','UD','UA','DU','AA','UU']);
export function parseGitStatus(stdout){
  if(!Buffer.isBuffer(stdout))throw Error('missing_bytes');
  const entries=[];let offset=0;
  const path=()=>{
    const end=stdout.indexOf(0,offset);if(end<0||end===offset)throw Error('path_boundary');
    const bytes=stdout.subarray(offset,end),text=decoder().decode(bytes);
    if(!Buffer.from(text).equals(bytes))throw Error('path_encoding');offset=end+1;return text;
  };
  while(offset<stdout.length){
    if(offset+3>=stdout.length||stdout[offset+2]!==32)throw Error('record_prefix');
    const xy=String.fromCharCode(stdout[offset],stdout[offset+1]);
    if(gitConflicts.has(xy))throw Error('unmerged_conflict');
    if(!gitStatuses.has(xy))throw Error('unsupported_status');
    offset+=3;const name=path(),orig=xy.includes('R')?path():null;
    entries.push({xy,path:name,orig_path:orig});
  }
  return entries;
}

// Explicit local producer, no ordinary-command rewriting or native host hook.
// Metadata is witnessed by child/stream events and held privately; caller edits
// to a returned view cannot manufacture completion or alter captured bytes.
// Closed command inventory. No arbitrary executable/argv or shell option.
export async function captureCompleted({profile,files,cwd=process.cwd(),signal,timeoutMs=120000,diagnostic=false,fault=null}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw Error('test_command');
  let argv,executable=process.execPath;
  const gitProfile=profile==='git-status-porcelain-v1-z';
  let root=resolve(cwd);
  if(profile === 'node-spec-flat-v1') {
    if (!Array.isArray(files) || !files.length || files.some(file=>typeof file !== 'string' || !file.endsWith('.test.mjs'))) throw Error('test_command');
    argv=['--test','--test-reporter=spec',...files.map(file=>resolve(cwd,file))];
  } else if(profile === 'gateway-http-models-passthrough-v2' && typeof diagnostic === 'boolean' &&
      [null,'unexpected-record','invalid-utf8'].includes(fault) && !(diagnostic&&fault)) {
    argv=[fileURLToPath(new URL('./log-producer.mjs',import.meta.url)),...(diagnostic?['--diagnostic']:fault?[`--${fault}`]:[])];
  } else if(gitProfile){
    executable='C:/Program Files/Git/cmd/git.exe';
    argv=['--no-optional-locks','--no-lazy-fetch','--no-pager','-c',`safe.directory=${root}`,
      '-c','core.fsmonitor=false','-c','core.untrackedCache=false','-c','status.renames=true',
      'status','--porcelain=v1','-z','--untracked-files=all','--ignore-submodules=none','--find-renames=50%','--no-column'];
  } else throw Error('unsupported_command');
  const provenance = {run_id:randomUUID(),command:{executable,argv,cwd:root,shell:false},
    node_version:process.version,host_correlation:'unavailable',completion:'pending',exit_code:null,signal:null,error:null,
    cancelled:false,timed_out:false,stdout_eof:false,stderr_eof:false,capture_complete:false,truncated:false};
  if(profile==='gateway-http-models-passthrough-v2')provenance.format_source={profile,
    module:'integration/main-gateway.mjs',schema_version:2,writer:'observeRequest HTTP GET models receipt JSONL'};
  let stdout=[],stderr=[];
  let child,timer;
  const deadline=Date.now()+timeoutMs;
  const cancel = () => {provenance.cancelled=true;child?.kill();};
  try {
    const env={...process.env};
    for(const key of Object.keys(env)) {
      if(gitProfile?key.toUpperCase().startsWith('GIT_'):
        ['NODE_OPTIONS','NODE_V8_COVERAGE','NODE_TEST_CONTEXT','FORCE_COLOR'].includes(key.toUpperCase())) delete env[key];
    }
    if(!gitProfile)env.FORCE_COLOR='0';
    const run=async args=>{
    child = spawn(executable,args,{cwd:root,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe'],
      env});
    for (const [name,chunks] of [['stdout',stdout],['stderr',stderr]]) {
      child[name].on('data',chunk=>chunks.push(chunk));
      child[name].on('end',()=>{provenance[`${name}_eof`]=true;});
      child[name].on('error',error=>{provenance.error=error.code ?? error.message;});
    }
    child.on('error',error=>{provenance.error=error.code ?? error.message;});
    signal?.addEventListener('abort',cancel,{once:true});
    if(signal?.aborted) cancel();
    timer=setTimeout(()=>{provenance.timed_out=true;child.kill();},Math.max(1,deadline-Date.now()));
    await new Promise(resolveClose=>child.on('close',(code,termination)=>{
      provenance.exit_code=code;provenance.signal=termination;provenance.completion='closed';resolveClose();
    }));
    clearTimeout(timer);signal?.removeEventListener('abort',cancel);
    };
    if(gitProfile){
      provenance.format_source={profile,version:1,encoding:'UTF-8',delimiter:'NUL',source:'git status --porcelain=v1 -z'};
      provenance.git_version=null;provenance.root_verified=false;provenance.probes=[];
      provenance.executable_sha256=createHash('sha256').update(await readFile(executable)).digest('hex');
      root=await realpath(root);provenance.command.cwd=root;argv[4]=`safe.directory=${root}`;
      if(/[\r\n]/.test(root))throw Error('unsupported_root');
      const probes=[['--version'],[...argv.slice(0,11),'rev-parse','--show-toplevel']];
      for(const [i,args] of probes.entries()){
        await run(args);
        const out=Buffer.concat(stdout),err=Buffer.concat(stderr);
        provenance.probes.push({executable,argv:args,cwd:root,exit_code:provenance.exit_code,
          stdout:receivedStream(out),stderr:receivedStream(err),stdout_eof:provenance.stdout_eof,stderr_eof:provenance.stderr_eof});
        if(provenance.exit_code!==0||provenance.error||provenance.signal||provenance.cancelled||provenance.timed_out||
          !provenance.stdout_eof||!provenance.stderr_eof||err.length)throw Error('git_probe_failed');
        if(i===0){
          if(!out.equals(Buffer.from('git version 2.56.0.windows.1\n')))throw Error('unsupported_git_version');
          provenance.git_version='git version 2.56.0.windows.1';
        }else{
          const discovered=decoder().decode(out);
          if(!discovered.endsWith('\n')||resolve(discovered.slice(0,-1)).toLowerCase()!==root.toLowerCase())throw Error('unsupported_root');
          provenance.root_verified=true;
        }
        stdout=[];stderr=[];provenance.stdout_eof=false;provenance.stderr_eof=false;provenance.exit_code=null;provenance.completion='pending';
      }
    }
    await run(argv);
  } catch(error) { provenance.error=error.code ?? error.message;provenance.completion='error'; }
  finally { clearTimeout(timer);signal?.removeEventListener('abort',cancel); }
  provenance.capture_complete=provenance.stdout_eof && provenance.stderr_eof && !provenance.error;
  const bytes={stdout:Buffer.concat(stdout),stderr:Buffer.concat(stderr),provenance,profile};
  const capture={provenance:structuredClone(provenance),received:{stdout:receivedStream(bytes.stdout),stderr:receivedStream(bytes.stderr)}};
  captures.set(capture,bytes);
  return capture;
}

export async function compactCompleted({capture,artifactDir,store,profile,parse,select}) {
  const witnessed=captures.get(capture);
  const fallback=reason=>({schema_version:2,status:'verbatim',profile,reason,
    provenance:structuredClone(witnessed?.provenance ?? capture?.provenance ?? null),
    received:witnessed ? {stdout:receivedStream(witnessed.stdout),stderr:receivedStream(witnessed.stderr)} : capture?.received});
  if (!witnessed) return fallback('unwitnessed_capture');
  if(witnessed.profile !== profile) return fallback('capture_profile');
  const {stdout,stderr,provenance}=witnessed;
  if (provenance.node_version !== 'v24.13.0') return fallback('unsupported_node_version');
  if(profile==='git-status-porcelain-v1-z' &&
    (provenance.git_version!=='git version 2.56.0.windows.1'||provenance.root_verified!==true))return fallback('unsupported_git_source');
  if (provenance.completion !== 'closed' || provenance.exit_code !== 0 || provenance.signal || provenance.error ||
      provenance.cancelled || provenance.timed_out || !provenance.capture_complete || provenance.truncated) return fallback('unsafe_completion');
  if (stderr.length) return fallback('stderr_diagnostic');
  if(profile==='git-status-porcelain-v1-z'){
    // The shared API must not let callbacks turn a genuine conflict into clean.
    parse=parseGitStatus;select=entries=>({entries,records:entries.length,clean:entries.length===0});
  }
  let evidence;
  try { evidence=parse(stdout); }
  catch(error) { return fallback(`parser:${error.message}`); }
  try {
    const originals=store ?? createOriginalStore(artifactDir);
    const original=await originals.publish({stdout:Buffer.from(stdout),stderr:Buffer.from(stderr),provenance:structuredClone(provenance)});
    const restored=await originals.read(original);
    if (!Buffer.isBuffer(restored.stdout) || !Buffer.isBuffer(restored.stderr) ||
        !restored.stdout.equals(stdout) || !restored.stderr.equals(stderr) ||
        JSON.stringify(restored.provenance) !== JSON.stringify(provenance)) throw Error('readback_mismatch');
    return {schema_version:2,status:'compact',profile,provenance:structuredClone(provenance),
      ...select(evidence),original};
  } catch(error) { return fallback(`original:${error.code ?? error.message}`); }
}
