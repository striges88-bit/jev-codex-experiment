import {dirname} from 'node:path';
import {readFileSync,lstatSync} from 'node:fs';
import {sha256} from './context-binding.mjs';
import {createOriginalStore} from './compact-output.mjs';
import {mainInventory,mainScope} from './main-context.mjs';

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const hash=value=>sha256(JSON.stringify(value));
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=reason=>{throw Error(reason);};
const fields=['goal','requirements','frozen_criteria','decisions','verified_results','unfinished','readback_links'];
const occurrence=(binding,index,group)=>`${binding}:${index}:${group.start}:${group.end}:${group.sha256}`;
const stateItem=state=>({type:'message',role:'assistant',content:[{type:'output_text',text:'JEV task state v1 (required context):\n'+JSON.stringify({
  schema_version:state.schema_version,task_id:state.task_id,revision:state.revision,data:state.data,field_sources:state.field_sources,empty_fields:state.empty_fields,sources:state.sources})}]});

// Coordinator inventory revision is explicit. Append, protection and scope drift
// all change this binding; identical content never supplies occurrence authority.
export function qualityBinding(request,headers,task_id,inventory_revision,state) {
  if(typeof task_id!=='string'||!task_id||typeof inventory_revision!=='string'||!inventory_revision)fail('invalid_identity');
  const inventory=mainInventory(request),scope_sha256=mainScope(request,headers);
  if(!scope_sha256)fail('scope_unavailable');
  if(!object(state)||!Number.isSafeInteger(state.revision)||state.revision<1)fail('invalid_state_revision');
  const state_revision=state.revision,state_sha256=hash(stateItem(state));
  const binding_sha256=hash({schema_version:2,task_id,inventory_revision,state_revision,state_sha256,scope_sha256,...inventory});
  return {schema_version:2,task_id,inventory_revision,state_revision,state_sha256,scope_sha256,input_sha256:inventory.input_sha256,
    item_hashes:inventory.item_hashes,binding_sha256,occurrences:inventory.groups.map((group,index)=>({id:occurrence(binding_sha256,index,group),...group}))};
}

function pointer(value,path) {
  if(typeof path!=='string'||!path.startsWith('/'))fail('invalid_source_pointer');
  for(const key of path.slice(1).split('/').map(token=>{
    if(/~(?![01])/u.test(token))fail('invalid_source_pointer');return token.replaceAll('~1','/').replaceAll('~0','~');
  })) {
    if(!object(value)&&!Array.isArray(value)||!Object.hasOwn(value,key))fail('source_pointer_unavailable');
    value=value[key];
  }
  return value;
}

// Entire v2 branch is async only because originals must actually be read. Legacy
// selection stays synchronous. This branch is never selected by incoming text.
export async function selectQuality(request,headers,policy,{allowOfflineFilter=false}={}) {
  const originalRequest=request;let requestKey;
  const full=reason=>({request:originalRequest,applied:false,request_changed:false,task_state_attached:false,duplicate_removed:false,reason,excluded:[],protected:[]});
  try {
    // Freeze callback-owned data before yielding to filesystem reads.
    policy=structuredClone(policy);
    requestKey=JSON.stringify(request);
    request=structuredClone(request);
    if(policy.schema_version!==2||policy.enabled!==true||!['shadow','filter'].includes(policy.mode)||
        policy.mode==='filter'&&!allowOfflineFilter||policy.approval_id!=='global-jev-opt-in-20261003')return full('disabled_or_passthrough');
    if(!Number.isSafeInteger(policy.revision)||policy.revision<1||!Array.isArray(policy.bindings))fail('invalid_policy');
    const matches=policy.bindings.filter(row=>row?.scope_sha256===mainScope(request,headers));
    if(matches.length!==1)fail('binding_unavailable');
    const binding=matches[0],actual=qualityBinding(request,headers,policy.task_id,binding.inventory_revision,binding.state);
    for(const key of Object.keys(actual))if(!equal(binding[key],actual[key]))fail('inventory_changed');
    const state=binding.state;
    if(!object(state)||state.schema_version!==1||state.task_id!==policy.task_id||state.binding_sha256!==actual.binding_sha256||
        state.revision!==actual.state_revision||!object(state.data)||!equal(Object.keys(state.data),fields)||!object(state.field_sources)||
        !equal(Object.keys(state.field_sources),fields.slice(0,-1))||
        !Array.isArray(state.sources)||!state.sources.length||!Array.isArray(state.empty_fields)||
        new Set(state.empty_fields).size!==state.empty_fields.length||!Array.isArray(state.protected_occurrences)||
        !state.protected_occurrences.every(id=>actual.occurrences.some(row=>row.id===id)))fail('invalid_task_state');
    const references=new Map(),documents=new Map();
    async function read(reference) {
      if(!object(reference)||typeof reference.path!=='string')fail('readback_unavailable');
      const value=await createOriginalStore(dirname(reference.path)).read(reference);
      if(value.stderr.length)fail('unexpected_original_stderr');
      // Two independent store reads prove bytes, not merely reference hashes.
      const again=await createOriginalStore(dirname(reference.path)).read(reference);
      if(!value.stdout.equals(again.stdout)||!value.stderr.equals(again.stderr)||!equal(value.provenance,again.provenance))fail('readback_changed');
      const prior=references.get(reference.path);
      if(prior&&!equal(prior,reference))fail('ambiguous_original');
      references.set(reference.path,reference);
      return value;
    }
    for(const row of state.sources) {
      if(!object(row)||typeof row.id!=='string'||!row.id||documents.has(row.id))fail('ambiguous_state_source');
      const source=await read(row.original);
      documents.set(row.id,JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(source.stdout)));
    }
    function record(row) {
      if(!object(row)||!Object.hasOwn(row,'value')||!['current','unresolved','verified','pending'].includes(row.status)||
          !object(row.source)||!documents.has(row.source.id)||!equal(row.value,pointer(documents.get(row.source.id),row.source.pointer)))fail('state_source_mismatch');
    }
    record(state.data.goal);
    if(typeof state.data.goal.value!=='string'||!state.data.goal.value)fail('invalid_goal');
    for(const name of fields.slice(1,-1)) {
      const rows=state.data[name];
      if(!Array.isArray(rows)||(rows.length===0)!==state.empty_fields.includes(name))fail('unverified_empty_state');
      rows.forEach(record);
    }
    for(const name of fields.slice(0,-1)) {
      const source=state.field_sources[name];
      if(!object(source)||!documents.has(source.id))fail('field_source_unavailable');
      const value=name==='goal'?state.data.goal.value:state.data[name].map(row=>row.value);
      if(!equal(value,pointer(documents.get(source.id),source.pointer)))fail('state_collection_incomplete');
    }
    if(state.empty_fields.some(name=>!fields.slice(1,-1).includes(name)))fail('invalid_empty_state');
    if(!state.data.requirements.every(row=>typeof row.value==='string')||!state.data.unfinished.every(row=>typeof row.value==='string')||
        !state.data.frozen_criteria.every(row=>object(row.value)&&['id','requirement','source','evidence_required'].every(key=>typeof row.value[key]==='string'&&row.value[key]))||
        new Set(state.data.frozen_criteria.map(row=>row.value.id)).size!==state.data.frozen_criteria.length||
        !state.data.verified_results.every(row=>row.status==='verified'&&object(row.value)&&['PASS','FAIL','UNKNOWN'].includes(row.value.status)&&typeof row.value.scope==='string'&&typeof row.value.date==='string'))fail('invalid_state_records');
    if(!Array.isArray(state.data.readback_links)||!state.data.readback_links.length)fail('readback_links_unavailable');
    if(state.sources.some(source=>!state.data.readback_links.some(ref=>equal(ref,source.original))))fail('required_readback_missing');
    for(const reference of state.data.readback_links)await read(reference);
    if(!Array.isArray(binding.deliveries)||!Array.isArray(binding.duplicates))fail('invalid_duplicate_proof');
    const deliveries=new Map();
    for(const delivery of binding.deliveries) {
      const group=actual.occurrences.find(row=>row.id===delivery?.occurrence_id);
      if(!group||deliveries.has(group.id)||typeof delivery.artifact_id!=='string'||!delivery.artifact_id||
          typeof delivery.role_function!=='string'||!delivery.role_function)fail('invalid_delivery');
      const original=await read(delivery.original),p=original.provenance;
      if(p.profile!=='context-group-json-v1'||p.task_id!==policy.task_id||p.inventory_revision!==actual.inventory_revision||
          p.occurrence_id!==group.id||p.artifact_id!==delivery.artifact_id||p.role_function!==delivery.role_function||
          !original.stdout.equals(Buffer.from(JSON.stringify(request.input.slice(group.start,group.end+1)))))fail('delivery_original_mismatch');
      deliveries.set(group.id,{...delivery,group,bytes:original.stdout});
    }
    const remove=new Set(),canonical=new Set(),reconstruction=[];
    const conflicting=[state.data.goal,...fields.slice(1,-1).flatMap(name=>state.data[name])].some(row=>row.status==='unresolved');
    for(const proof of binding.duplicates) {
      if(!object(proof)||proof.schema_version!==1||!object(proof.permission)||
          proof.candidate_id===proof.canonical_id||remove.has(proof.candidate_id)||conflicting)fail('invalid_duplicate_proof');
      const candidate=deliveries.get(proof.candidate_id),retained=deliveries.get(proof.canonical_id);
      if(!candidate||!retained||candidate.group.protected||state.protected_occurrences.includes(candidate.group.id)||
          candidate.group.sha256!==retained.group.sha256||!candidate.bytes.equals(retained.bytes)||candidate.artifact_id!==retained.artifact_id||
          candidate.role_function!==retained.role_function)fail('duplicate_not_interchangeable');
      const permission=await read(proof.permission.original);
      if(permission.provenance.profile!=='occurrence-permission-json-v1')fail('permission_origin_unavailable');
      const expected={schema_version:1,task_id:policy.task_id,revision:policy.revision,inventory_revision:actual.inventory_revision,binding_sha256:actual.binding_sha256,
        candidate_id:candidate.group.id,canonical_id:retained.group.id,artifact_id:candidate.artifact_id,role_function:candidate.role_function,basis:'repeat-delivery-same-artifact'};
      const granted=pointer(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(permission.stdout)),proof.permission.pointer);
      if(!equal(granted,expected))fail('occurrence_permission_unavailable');
      remove.add(candidate.group.id);canonical.add(retained.group.id);
      reconstruction.push({occurrence_id:candidate.group.id,canonical_id:retained.group.id,original:candidate.original,canonical_original:retained.original});
    }
    if([...canonical].some(id=>remove.has(id)))fail('canonical_also_removed');
    const indices=new Set(actual.occurrences.filter(row=>remove.has(row.id)).flatMap(row=>Array.from({length:row.end-row.start+1},(_,i)=>row.start+i)));
    const item=stateItem(state);
    const attached=!request.input.some(value=>equal(value,item));
    const kept=request.input.filter((_,index)=>!indices.has(index));
    const selected={...request,input:attached?[...kept,item]:kept};
    const shadow=policy.mode==='shadow';
    const validateOriginals=()=>{
      if(JSON.stringify(originalRequest)!==requestKey)fail('request_changed_before_write');
      for(const ref of references.values()) {
        if(lstatSync(ref.path).isSymbolicLink())fail('original_symlink');
        const bytes=readFileSync(ref.path);
        if(bytes.length!==ref.bytes||sha256(bytes)!==ref.sha256)fail('original_changed_before_write');
      }
    };
    validateOriginals();
    return {request:shadow?request:selected,applied:!shadow&&(attached||indices.size>0),request_changed:!shadow&&(attached||indices.size>0),
      task_state_attached:!shadow&&attached,duplicate_removed:!shadow&&indices.size>0,reason:shadow?'shadow':'verified_context_quality',excluded:shadow?[]:[...remove],
      would_exclude:shadow?[...remove]:[],would_attach_state:shadow&&attached,protected:actual.occurrences.filter(row=>row.protected||state.protected_occurrences.includes(row.id)).map(row=>row.sha256),
      scope_sha256:actual.scope_sha256,revision:policy.revision,state_revision:state.revision,state_sha256:hash(item),reconstruction,validateOriginals};
  } catch(error) {return full(['inventory_changed','binding_unavailable','disabled_or_passthrough'].includes(error.message)?error.message:'context_quality_unavailable');}
}
