import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {isAbsolute,resolve} from 'node:path';
import {sha256} from './context-binding.mjs';
import {mainScope,mainInventory,qualityBinding} from './main-context-contract.mjs';

// Local coordinator surface only: no request field or global opt-in opens this gate.
const files=['quality-pilot.mjs','context-quality.mjs','main-context.mjs','main-gateway.mjs',
  'response-context.mjs','websocket-context.mjs','compact-output.mjs','main-context-contract.mjs'];
const hash=value=>sha256(JSON.stringify(value));
export const qualityPilotCodeHashes=(schemaVersion=1)=>Object.fromEntries(
  [...files,...(schemaVersion===2?['schema.mjs']:[])].map(name=>[name,sha256(readFileSync(new URL(name,import.meta.url)))]));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

export function createQualityPilot(packet,options={}) {
  if(packet?.schema_version===2)return createSourcePilot(packet,options);
  const {approval=()=>null,now=Date.now,monotonic=()=>performance.now()}=options;
  packet=structuredClone(packet);
  const expected=['schema_version','pilot_id','task_id','thread_sha256','scope_sha256','binding_sha256',
    'policy_sha256','code_hashes','expires_at_ms','max_attempts'];
  if(!packet||Object.keys(packet).length!==expected.length||expected.some(key=>!Object.hasOwn(packet,key))||
      packet.schema_version!==1||typeof packet.pilot_id!=='string'||!packet.pilot_id||
      typeof packet.task_id!=='string'||!packet.task_id||
      !['thread_sha256','scope_sha256','binding_sha256','policy_sha256'].every(key=>digest(packet[key]))||
      !Number.isSafeInteger(packet.expires_at_ms)||packet.expires_at_ms<=now()||
      packet.expires_at_ms>now()+15*60*1000||packet.max_attempts!==1||
      !same(packet.code_hashes,qualityPilotCodeHashes()))throw Error('invalid_pilot_packet');
  const packet_sha256=hash(packet);
  const monotonicDeadline=monotonic()+packet.expires_at_ms-now();
  let attempts=0,revoked=false;
  const validate=()=>{
    const grant=approval();
    if(revoked||now()>=packet.expires_at_ms||monotonic()>=monotonicDeadline||!grant||grant.approved!==true||
        grant.packet_sha256!==packet_sha256||!same(packet.code_hashes,qualityPilotCodeHashes()))throw Error('pilot_unavailable');
  };
  return {
    authorize(request,headers,policy) {
      try {
        validate();
        if(attempts>=packet.max_attempts||sha256(headers['thread-id']??'')!==packet.thread_sha256||
            policy.task_id!==packet.task_id||hash(policy)!==packet.policy_sha256||
            mainScope(request,headers)!==packet.scope_sha256)return null;
        const binding=policy.bindings?.find(row=>row.scope_sha256===packet.scope_sha256);
        if(!binding||qualityBinding(request,headers,packet.task_id,binding.inventory_revision,binding.state).binding_sha256!==packet.binding_sha256)return null;
        // A failed readback/selection spends the sole attempt; no implicit retry.
        attempts++;
        return validate;
      } catch {return null;}
    },
    revoke(){revoked=true;},
    status(){return {pilot_id:packet.pilot_id,packet_sha256,attempts,revoked,expires_at_ms:packet.expires_at_ms};}
  };
}

function createSourcePilot(packet,{manifest,spentPath,approval=()=>null,now=Date.now,monotonic=()=>performance.now()}={}) {
  const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&
    Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
  packet=structuredClone(packet);manifest=structuredClone(manifest);
  const fields=['schema_version','pilot_id','task_id','thread_sha256','scope_sha256','source_manifest_sha256',
    'state_sha256','code_hashes','expires_at_ms','max_initial_applies','operation','spent_path_sha256'];
  if(!exact(packet,fields)||packet.schema_version!==2||typeof packet.pilot_id!=='string'||!packet.pilot_id||
    typeof packet.task_id!=='string'||!packet.task_id||packet.operation!=='state_only'||packet.max_initial_applies!==1||
    !['thread_sha256','scope_sha256','source_manifest_sha256','state_sha256'].every(key=>digest(packet[key]))||
    !Number.isSafeInteger(packet.expires_at_ms)||packet.expires_at_ms<=now()||packet.expires_at_ms>now()+900000||
    !same(packet.code_hashes,qualityPilotCodeHashes(2))||typeof spentPath!=='string'||!isAbsolute(spentPath)||
    !digest(packet.spent_path_sha256)||sha256(resolve(spentPath))!==packet.spent_path_sha256||
    !exact(manifest,['schema_version','task_id','inventory_revision','state'])||manifest.schema_version!==1||
    manifest.task_id!==packet.task_id||typeof manifest.inventory_revision!=='string'||!manifest.inventory_revision||
    !exact(manifest.state,['schema_version','task_id','revision','data','field_sources','empty_fields','sources','protected_occurrences'])||
    manifest.state.schema_version!==1||manifest.state.task_id!==packet.task_id||
    !Number.isSafeInteger(manifest.state.revision)||manifest.state.revision<1||
    !Array.isArray(manifest.state.protected_occurrences)||manifest.state.protected_occurrences.length||
    hash(manifest)!==packet.source_manifest_sha256||hash(manifest.state)!==packet.state_sha256)throw Error('invalid_pilot_packet');
  const packet_sha256=hash(packet),deadline=monotonic()+packet.expires_at_ms-now();
  const control={schema_version:2,enabled:true,mode:'filter',approval_id:'global-jev-opt-in-20261003',
    task_id:packet.task_id,pilot_packet_sha256:packet_sha256};
  let attempts=0,revoked=false,spent=existsSync(spentPath),connection=null,prefix=null,insertAt=null;
  const validate=()=>{
    const grant=approval();
    if(revoked||now()>=packet.expires_at_ms||monotonic()>=deadline||grant?.approved!==true||
      grant.packet_sha256!==packet_sha256||!same(packet.code_hashes,qualityPilotCodeHashes(2)))throw Error('pilot_unavailable');
  };
  return {
    policy:()=>structuredClone(control),
    prepare(request,headers,policy,continuity) {
      try {
        validate();
        if(!same(policy,control)||sha256(headers['thread-id']??'')!==packet.thread_sha256||
          mainScope(request,headers)!==packet.scope_sha256||!continuity?.connection)return null;
        if(attempts||spent){
          if(spent&&attempts===0||continuity.connection!==connection||continuity.inherited!==true||
            !same(continuity.original_prefix,prefix)||!Array.isArray(request.input)||
            !same(request.input.slice(0,prefix.length),prefix))return null;
        }else{
          // Reserve before inventory/readback; all failed preparations are spent.
          try{writeFileSync(spentPath,JSON.stringify({schema_version:2,packet_sha256,reserved_at_ms:now()})+'\n',{flag:'wx',mode:0o600});}
          catch{spent=true;return null;}
          spent=true;attempts=1;connection=continuity.connection;insertAt=request.input?.length;
        }
        mainInventory(request);
        const state=structuredClone(manifest.state);
        const binding=qualityBinding(request,headers,packet.task_id,manifest.inventory_revision,state);
        state.binding_sha256=binding.binding_sha256;
        prefix=structuredClone(request.input);
        return {policy:{schema_version:2,enabled:true,mode:'filter',approval_id:control.approval_id,
          revision:1,task_id:packet.task_id,bindings:[{...binding,state,deliveries:[],duplicates:[]}]},
          validate,stateInsertAt:insertAt};
      }catch{return null;}
    },
    revoke(){revoked=true;},
    status(){return {pilot_id:packet.pilot_id,packet_sha256,attempts,spent,revoked,expires_at_ms:packet.expires_at_ms};}
  };
}
