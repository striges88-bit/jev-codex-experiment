import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createOriginalStore} from './compact-output.mjs';
const captures=new WeakMap();
const decoder=()=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
export function receivedStream(bytes) {
  try { return {encoding:'utf8',data:decoder().decode(bytes)}; }
  catch { return {encoding:'base64',data:bytes.toString('base64')}; }
}

// Explicit local producer, no ordinary-command rewriting or native host hook.
// Metadata is witnessed by child/stream events and held privately; caller edits
// to a returned view cannot manufacture completion or alter captured bytes.
// Closed command inventory. No arbitrary executable/argv or shell option.
export async function captureCompleted({profile,files,cwd=process.cwd(),signal,timeoutMs=120000,diagnostic=false,fault=null}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw Error('test_command');
  let argv;
  if(profile === 'node-spec-flat-v1') {
    if (!Array.isArray(files) || !files.length || files.some(file=>typeof file !== 'string' || !file.endsWith('.test.mjs'))) throw Error('test_command');
    argv=['--test','--test-reporter=spec',...files.map(file=>resolve(cwd,file))];
  } else if(profile === 'gateway-http-models-passthrough-v2' && typeof diagnostic === 'boolean' &&
      [null,'unexpected-record','invalid-utf8'].includes(fault) && !(diagnostic&&fault)) {
    argv=[fileURLToPath(new URL('./log-producer.mjs',import.meta.url)),...(diagnostic?['--diagnostic']:fault?[`--${fault}`]:[])];
  } else throw Error('unsupported_command');
  const provenance = {run_id:randomUUID(),command:{executable:process.execPath,argv,cwd:resolve(cwd),shell:false},
    node_version:process.version,host_correlation:'unavailable',completion:'pending',exit_code:null,signal:null,error:null,
    cancelled:false,timed_out:false,stdout_eof:false,stderr_eof:false,capture_complete:false,truncated:false};
  if(profile==='gateway-http-models-passthrough-v2')provenance.format_source={profile,
    module:'integration/main-gateway.mjs',schema_version:2,writer:'observeRequest HTTP GET models receipt JSONL'};
  const stdout=[],stderr=[];
  let child,timer;
  const cancel = () => {provenance.cancelled=true;child?.kill();};
  try {
    const env={...process.env};
    for(const key of Object.keys(env)) {
      if(['NODE_OPTIONS','NODE_V8_COVERAGE','NODE_TEST_CONTEXT','FORCE_COLOR'].includes(key.toUpperCase())) delete env[key];
    }
    env.FORCE_COLOR='0';
    child = spawn(process.execPath,argv,{cwd:resolve(cwd),shell:false,windowsHide:true,stdio:['ignore','pipe','pipe'],
      env});
    for (const [name,chunks] of [['stdout',stdout],['stderr',stderr]]) {
      child[name].on('data',chunk=>chunks.push(chunk));
      child[name].on('end',()=>{provenance[`${name}_eof`]=true;});
      child[name].on('error',error=>{provenance.error=error.code ?? error.message;});
    }
    child.on('error',error=>{provenance.error=error.code ?? error.message;});
    signal?.addEventListener('abort',cancel,{once:true});
    if(signal?.aborted) cancel();
    timer=setTimeout(()=>{provenance.timed_out=true;child.kill();},timeoutMs);
    await new Promise(resolveClose=>child.on('close',(code,termination)=>{
      provenance.exit_code=code;provenance.signal=termination;provenance.completion='closed';resolveClose();
    }));
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
  if (provenance.completion !== 'closed' || provenance.exit_code !== 0 || provenance.signal || provenance.error ||
      provenance.cancelled || provenance.timed_out || !provenance.capture_complete || provenance.truncated) return fallback('unsafe_completion');
  if (stderr.length) return fallback('stderr_diagnostic');
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
