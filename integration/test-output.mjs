import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createOriginalStore } from './compact-output.mjs';

export const testOutputProfile = 'node-spec-flat-v1';
const captures = new WeakMap();
const decoder = () => new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const decimal = '(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?';
const record = new RegExp(`^✔ (.+) \\((`+decimal+`)ms\\)$`);
const keys = ['tests','suites','pass','fail','cancelled','skipped','todo','duration_ms'];

// Entire grammar, not a totals scan. Any extra/missing line closes the gate.
export function parseNodeSpec(stdout) {
  const text = decoder().decode(stdout);
  const crlf = text.includes('\r');
  if (!text.endsWith('\n') || (crlf && /(?<!\r)\n|\r(?!\n)/.test(text))) throw Error('unsupported_format');
  const lines = text.slice(0,crlf?-2:-1).split(crlf?'\r\n':'\n');
  const rows = lines.slice(0,-keys.length),summary = lines.slice(-keys.length);
  if (!rows.length) throw Error('missing_records');
  const records = rows.map(line => {
    const match = record.exec(line);
    if (!match || /[\x00-\x1f\x7f]/.test(match[1]) || !Number.isFinite(Number(match[2]))) throw Error('unsupported_record');
    return {name:match[1],duration_ms:Number(match[2])};
  });
  const counts = {};
  for (const [index,key] of keys.entries()) {
    const number = key === 'duration_ms' ? decimal : '(?:0|[1-9][0-9]*)';
    const match = new RegExp(`^ℹ ${key} (${number})$`).exec(summary[index] ?? '');
    if (!match || !Number.isFinite(Number(match[1]))) throw Error('unsupported_summary');
    counts[key] = Number(match[1]);
    if (key !== 'duration_ms' && !Number.isSafeInteger(counts[key])) throw Error('invalid_counts');
  }
  if (counts.tests !== records.length || counts.pass !== counts.tests ||
      ['suites','fail','cancelled','skipped','todo'].some(key=>counts[key] !== 0)) throw Error('inconsistent_counts');
  const {duration_ms,...totals}=counts;
  return {records,counts:totals,duration_ms};
}

function receivedStream(bytes) {
  try { return {encoding:'utf8',data:decoder().decode(bytes)}; }
  catch { return {encoding:'base64',data:bytes.toString('base64')}; }
}

// Explicit local producer, no ordinary-command rewriting or native host hook.
// Metadata is witnessed by child/stream events and held privately; caller edits
// to a returned view cannot manufacture completion or alter captured bytes.
export async function captureNodeTests({files,cwd=process.cwd(),signal,timeoutMs=120000}) {
  if (!Array.isArray(files) || !files.length || files.some(file=>typeof file !== 'string' || !file.endsWith('.test.mjs')) ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw Error('test_command');
  const argv = ['--test','--test-reporter=spec',...files.map(file=>resolve(cwd,file))];
  const provenance = {run_id:randomUUID(),command:{executable:process.execPath,argv,cwd:resolve(cwd),shell:false},
    node_version:process.version,host_correlation:'unavailable',completion:'pending',exit_code:null,signal:null,error:null,
    cancelled:false,timed_out:false,stdout_eof:false,stderr_eof:false,capture_complete:false,truncated:false};
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
  const bytes={stdout:Buffer.concat(stdout),stderr:Buffer.concat(stderr),provenance};
  const capture={provenance:structuredClone(provenance),received:{stdout:receivedStream(bytes.stdout),stderr:receivedStream(bytes.stderr)}};
  captures.set(capture,bytes);
  return capture;
}

export async function compactCompletedTests({capture,artifactDir,store}) {
  const witnessed=captures.get(capture);
  const fallback=reason=>({schema_version:2,status:'verbatim',profile:testOutputProfile,reason,
    provenance:structuredClone(witnessed?.provenance ?? capture?.provenance ?? null),
    received:witnessed ? {stdout:receivedStream(witnessed.stdout),stderr:receivedStream(witnessed.stderr)} : capture?.received});
  if (!witnessed) return fallback('unwitnessed_capture');
  const {stdout,stderr,provenance}=witnessed;
  if (provenance.node_version !== 'v24.13.0') return fallback('unsupported_node_version');
  if (provenance.completion !== 'closed' || provenance.exit_code !== 0 || provenance.signal || provenance.error ||
      provenance.cancelled || provenance.timed_out || !provenance.capture_complete || provenance.truncated) return fallback('unsafe_completion');
  if (stderr.length) return fallback('stderr_diagnostic');
  let evidence;
  try { evidence=parseNodeSpec(stdout); }
  catch(error) { return fallback(`parser:${error.message}`); }
  try {
    const originals=store ?? createOriginalStore(artifactDir);
    const original=await originals.publish({stdout:Buffer.from(stdout),stderr:Buffer.from(stderr),provenance:structuredClone(provenance)});
    const restored=await originals.read(original);
    if (!Buffer.isBuffer(restored.stdout) || !Buffer.isBuffer(restored.stderr) ||
        !restored.stdout.equals(stdout) || !restored.stderr.equals(stderr) ||
        JSON.stringify(restored.provenance) !== JSON.stringify(provenance)) throw Error('readback_mismatch');
    return {schema_version:2,status:'compact',profile:testOutputProfile,provenance:structuredClone(provenance),
      counts:evidence.counts,duration_ms:evidence.duration_ms,diagnostics:[],original};
  } catch(error) { return fallback(`original:${error.code ?? error.message}`); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [command,target,...files]=process.argv.slice(2);
    let result;
    if (command === 'run' && target && files.length) {
      const capture=await captureNodeTests({files});
      result=await compactCompletedTests({capture,artifactDir:target});
      process.exitCode=capture.provenance.exit_code === 0 && !capture.provenance.error &&
        !capture.provenance.cancelled && !capture.provenance.timed_out ? 0 : 1;
    } else if(command === 'read' && target && !files.length) {
      const reference=JSON.parse(await readFile(target,'utf8'));
      const {dirname}=await import('node:path');
      const original=await createOriginalStore(dirname(reference.path)).read(reference);
      result={id:reference.id,provenance:original.provenance,
        stdout:receivedStream(original.stdout),stderr:receivedStream(original.stderr)};
    } else throw Error('Usage: node integration/test-output.mjs run ARTIFACT_DIR FILE.test.mjs... | read REFERENCE.json');
    process.stdout.write(JSON.stringify(result)+'\n');
  } catch(error) {process.stderr.write(error.message+'\n');process.exitCode=2;}
}
