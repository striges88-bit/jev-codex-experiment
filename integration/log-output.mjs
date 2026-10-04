import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {captureCompleted,compactCompleted} from './completed-output.mjs';

export const logOutputProfile='gateway-http-models-passthrough-v2';
const fields=['schema_version','request_id','process_id','thread_sha256','transport','route','applied','reason',
  'before_sha256','after_sha256','before_bytes','after_bytes','protected','excluded','upstream_status','completed',
  'upstream_body_written','provider_usage','cost_usd','phase','observed_at','latency_ms'];
const emptyHash='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sha=/^[0-9a-f]{64}$/;

// This profile has only top-level primitive values and empty arrays. Lexical
// inspection before JSON.parse detects escaped duplicate keys and numeric loss.
function parseRow(line){
  line=line.replace(/[ \t]+$/,'');
  const token=/\s*(?:([{}:\[\],])|("(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*")|(-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)|(true|false|null))/gy;
  const tokens=[];let end=0;
  while(end<line.length){token.lastIndex=end;const match=token.exec(line);if(!match)throw Error('invalid_json');tokens.push(match);end=token.lastIndex;}
  let pos=0;const take=literal=>{if(tokens[pos++]?.[1]!==literal)throw Error('invalid_json');};
  take('{');const keys=new Set();
  do{
    const key=tokens[pos++]?.[2];if(!key)throw Error('invalid_key');
    const name=JSON.parse(key);if(keys.has(name))throw Error('duplicate_key');keys.add(name);
    take(':');const value=tokens[pos++];
    if(value?.[1]==='[')take(']');
    else if(!value||!(value[2]||value[3]||value[4]))throw Error('unsupported_value');
    if(value?.[3]){
      const raw=value[3],number=Number(raw);
      // Accept ordinary JS writer numbers only when their decimal value can
      // round-trip exactly. Do not turn overflow/underflow or rounded JSON into success.
      if(!Number.isFinite(number)||number<0||Object.is(number,-0))throw Error('lossy_number');
      const canonical=decimalValue(String(number)),original=decimalValue(raw);
      if(canonical!==original)throw Error('lossy_number');
    }
    if(tokens[pos]?.[1]===','){pos++;continue;}break;
  }while(pos<tokens.length);
  take('}');if(pos!==tokens.length)throw Error('invalid_json');
  if(keys.size!==fields.length||fields.some(key=>!keys.has(key)))throw Error('field_set');
  return JSON.parse(line);
}
function decimalValue(raw){
  const [mantissa,exponent='0']=raw.toLowerCase().split('e');
  const [integer,fraction='']=mantissa.split('.');
  let digits=(integer+fraction).replace(/^0+/,'')||'0',power=BigInt(exponent)-BigInt(fraction.length);
  if(digits==='0')return '0';
  while(digits.endsWith('0')){digits=digits.slice(0,-1);power++;}
  return `${digits}e${power}`;
}
export function parseGatewayLogs(stdout){
  const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(stdout),crlf=text.includes('\r');
  if(!text.endsWith('\n')||(crlf&&/(?<!\r)\n|\r(?!\n)/.test(text)))throw Error('unsupported_format');
  const lines=text.slice(0,crlf?-2:-1).split(crlf?'\r\n':'\n');
  if(lines.length!==3)throw Error('record_count');
  const rows=lines.map(parseRow),phases=['received','connected','terminal'];
  let previousTime=-Infinity,previousLatency=-Infinity;
  for(const [i,row] of rows.entries()){
    const fail=()=>{throw Error('inconsistent_record');};
    if(row.schema_version!==2||row.transport!=='http'||row.route!=='models'||row.applied!==false||row.reason!=='passthrough'||
      !uuid.test(row.request_id)||!Number.isSafeInteger(row.process_id)||row.process_id<=0||
      !(row.thread_sha256===null||typeof row.thread_sha256==='string'&&sha.test(row.thread_sha256))||
      row.phase!==phases[i]||!Array.isArray(row.protected)||row.protected.length||!Array.isArray(row.excluded)||row.excluded.length||
      row.provider_usage!==null||row.cost_usd!==null||typeof row.latency_ms!=='number'||row.latency_ms<previousLatency)fail();
    if(['request_id','process_id','thread_sha256'].some(key=>row[key]!==rows[0][key]))fail();
    if(typeof row.observed_at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.observed_at))fail();
    const time=Date.parse(row.observed_at);
    if(!Number.isFinite(time)||new Date(time).toISOString()!==row.observed_at||time<previousTime)fail();
    previousTime=time;previousLatency=row.latency_ms;
    for(const key of ['before_sha256','after_sha256'])if(row[key]!== (i===0?null:emptyHash))fail();
    for(const key of ['before_bytes','after_bytes'])if(row[key]!== (i===0?null:0))fail();
    if(row.upstream_status!==(i===0?null:200)||row.completed!==(i===2)||typeof row.upstream_body_written!=='boolean'||
      i===0&&row.upstream_body_written!==false||i===2&&row.upstream_body_written!==true)fail();
  }
  return rows;
}
function compactRows(rows){
  const common={},events=rows.map(()=>({}));
  for(const key of fields){
    if(rows.every(row=>JSON.stringify(row[key])===JSON.stringify(rows[0][key])))common[key]=rows[0][key];
    else rows.forEach((row,i)=>{events[i][key]=row[key];});
  }
  return {common,events,records:rows.length};
}
export const captureGatewayLogs=(options={})=>captureCompleted({...options,profile:logOutputProfile});
export const compactCompletedLogs=options=>compactCompleted({...options,profile:logOutputProfile,parse:parseGatewayLogs,select:compactRows});

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const [command,dir,...args]=process.argv.slice(2);
    if(command!=='run'||!dir||args.length&&!(args.length===1&&['--diagnostic','--unexpected-record','--invalid-utf8'].includes(args[0])))throw Error('Usage: node integration/log-output.mjs run ARTIFACT_DIR [--diagnostic|--unexpected-record|--invalid-utf8]');
    const capture=await captureGatewayLogs({diagnostic:args[0]==='--diagnostic',fault:args[0]&&args[0]!=='--diagnostic'?args[0].slice(2):null});
    const result=await compactCompletedLogs({capture,artifactDir:dir});
    process.exitCode=capture.provenance.exit_code===0&&!capture.provenance.error&&!capture.provenance.cancelled&&!capture.provenance.timed_out?0:1;
    process.stdout.write(JSON.stringify(result)+'\n');
  }catch(error){process.stderr.write(error.message+'\n');process.exitCode=2;}
}
