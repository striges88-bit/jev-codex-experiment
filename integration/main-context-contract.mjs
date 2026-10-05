import {sha256} from './context-binding.mjs';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const hash = value => sha256(JSON.stringify(value));
const opaqueProtected = item => ['reasoning','compaction','additional_tools','agent_message'].includes(item.type);
const neutralMetadataFields = value => object(value)&&
  (value.turn_id===undefined||typeof value.turn_id==='string')&&
  (value.create_time===undefined||Number.isFinite(value.create_time)&&value.create_time>=0);
const metadataProtected = item => {
  const value=item.internal_chat_message_metadata_passthrough;
  if(value===undefined)return false;
  return !neutralMetadataFields(value)||Object.keys(value).some(key=>!['turn_id','create_time'].includes(key));
};
const metadataReviewable = values => values.every(item=>item.role==='assistant'&&(item.type==='message'||item.type===undefined)&&
  neutralMetadataFields(item.internal_chat_message_metadata_passthrough)&&
  Object.keys(item.internal_chat_message_metadata_passthrough).every(key=>['turn_id','create_time','content_item_kinds'].includes(key))&&
  Array.isArray(item.internal_chat_message_metadata_passthrough.content_item_kinds)&&
  item.internal_chat_message_metadata_passthrough.content_item_kinds.length===item.content.length&&
  item.internal_chat_message_metadata_passthrough.content_item_kinds.every(kind=>kind==='unknown'));
const textParts = parts => parts.filter(part=>typeof part.text==='string').map(part=>part.text).join('\n');
const validParts = parts => Array.isArray(parts)&&parts.every(part=>object(part)&&
  (['input_text','output_text'].includes(part.type)?typeof part.text==='string':['input_image','input_audio','encrypted_content'].includes(part.type)));
const nonText = item => Array.isArray(item.output)&&item.output.some(part=>!['input_text','output_text'].includes(part.type)) ||
  Array.isArray(item.content)&&item.content.some(part=>!['input_text','output_text'].includes(part.type));
const itemText = item => item.type?.endsWith('_output') ? typeof item.output==='string'?item.output:textParts(item.output) :
  item.type === 'function_call' ? item.arguments : item.type === 'custom_tool_call' ? item.input :
  opaqueProtected(item) ? '' : textParts(item.content);
// Extra conservative evidence protection, in addition to default-protected items.
const essential = /\b(?:MUST_KEEP|must|required|error|failed|exception|pending|unfinished|TODO)\b|(?:нужно|нельзя|обязатель|требован|ошибк|не заверш|не готов|не выполн)|(?:[A-Za-z]:[\\/]|https?:\/\/|\b(?:git|npm|node|rg|pwsh)\s)/iu;

export function mainScope(request, headers) {
  const thread = headers['thread-id'] ?? headers['session-id'];
  if (typeof thread !== 'string' || !thread || typeof headers['chatgpt-account-id'] !== 'string' || !headers['chatgpt-account-id']) return null;
  return hash({ thread, account: headers['chatgpt-account-id'], model: request.model,
    reasoning: request.reasoning ?? null, instructions: request.instructions ?? null, tools: request.tools ?? null });
}

// Intervals close over every call/result edge, including parallel and nested calls.
// Unknown/opaque types make the entire inventory ineligible, not just one item.
export function mainInventory(request) {
  if (!object(request) || typeof request.model !== 'string' || !Array.isArray(request.input) ||
      (Object.hasOwn(request,'previous_response_id') && request.previous_response_id !== null)) throw Error('incomplete_inventory');
  const items = request.input;
  const calls = new Map(), outputs = new Map(), intervals = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (!object(item)) throw Error('unknown_item');
    if (['function_call','function_call_output','custom_tool_call','custom_tool_call_output'].includes(item.type)) {
      const isCall=item.type==='function_call'||item.type==='custom_tool_call';
      const map = isCall ? calls : outputs;
      if (typeof item.call_id !== 'string' || !item.call_id || map.has(item.call_id)) throw Error('invalid_call_graph');
      if (item.type === 'function_call' && (typeof item.name !== 'string' || typeof item.arguments !== 'string')) throw Error('unknown_item');
      if (item.type === 'custom_tool_call' && (typeof item.name !== 'string' || typeof item.input !== 'string')) throw Error('unknown_item');
      if (!isCall && typeof item.output !== 'string' && !validParts(item.output)) throw Error('unknown_item');
      map.set(item.call_id, index);
    } else if (opaqueProtected(item)) {
      if(item.type==='agent_message'){
        if(typeof item.author!=='string'||typeof item.recipient!=='string'||!Array.isArray(item.content)||!item.content.every(part=>object(part)&&
          (part.type==='input_text'?typeof part.text==='string':part.type==='encrypted_content'&&typeof part.encrypted_content==='string')))throw Error('unknown_item');
      }else{
      if(item.type==='additional_tools' ? !Array.isArray(item.tools) :
          item.type==='compaction' ? typeof item.encrypted_content!=='string' : !Array.isArray(item.summary))throw Error('unknown_item');
      }
    } else if ((item.type === 'message' || item.type === undefined) && ['system','developer','user','assistant'].includes(item.role)) {
      if (!validParts(item.content)) throw Error('unknown_content');
    } else throw Error('opaque_or_unknown_item');
  }
  for (const [id, start] of calls) {
    const end = outputs.get(id);
    if (end === undefined || end <= start) throw Error('invalid_call_graph');
    intervals.push([start,end]);
  }
  if (calls.size !== outputs.size) throw Error('invalid_call_graph');
  const groups = [];
  for (let start = 0; start < items.length;) {
    let end = start;
    for (let prior = -1; prior !== end;) {
      prior = end;
      for (const [a,b] of intervals) if (a <= end && b >= start) end = Math.max(end,b);
    }
    const values = items.slice(start,end + 1);
    const text = values.map(itemText).join('\n');
    const required=values.some(item =>
      opaqueProtected(item) || nonText(item) || (item.role && item.role !== 'assistant') || item.protected === true || item.metadata !== undefined ||
      item.encrypted_function_args !== undefined) || essential.test(text);
    const classified=values.some(metadataProtected);
    groups.push({ start,end,sha256:hash(values),protected:required||classified,
      metadata_reviewable:!required&&classified&&metadataReviewable(values) });
    start = end + 1;
  }
  for (const group of groups.slice(-8)) {group.protected=true;group.metadata_reviewable=false;}
  return { groups, item_hashes: items.map(hash), input_sha256: hash(items) };
}

export const mainAppendChangesState=item=>essential.test(itemText(item));

const fail=reason=>{throw Error(reason);};
const occurrence=(binding,index,group)=>`${binding}:${index}:${group.start}:${group.end}:${group.sha256}`;
export const qualityStateItem=state=>({type:'message',role:'assistant',content:[{type:'output_text',text:'JEV task state v1 (required context):\n'+JSON.stringify({
  schema_version:state.schema_version,task_id:state.task_id,revision:state.revision,data:state.data,field_sources:state.field_sources,empty_fields:state.empty_fields,sources:state.sources})}]});

// Coordinator inventory revision is explicit. Append, protection and scope drift
// all change this binding; identical content never supplies occurrence authority.
export function qualityBinding(request,headers,task_id,inventory_revision,state) {
  if(typeof task_id!=='string'||!task_id||typeof inventory_revision!=='string'||!inventory_revision)fail('invalid_identity');
  const inventory=mainInventory(request),scope_sha256=mainScope(request,headers);
  if(!scope_sha256)fail('scope_unavailable');
  if(!object(state)||!Number.isSafeInteger(state.revision)||state.revision<1)fail('invalid_state_revision');
  const state_revision=state.revision,state_sha256=hash(qualityStateItem(state));
  const binding_sha256=hash({schema_version:2,task_id,inventory_revision,state_revision,state_sha256,scope_sha256,...inventory});
  return {schema_version:2,task_id,inventory_revision,state_revision,state_sha256,scope_sha256,input_sha256:inventory.input_sha256,
    item_hashes:inventory.item_hashes,binding_sha256,occurrences:inventory.groups.map((group,index)=>({id:occurrence(binding_sha256,index,group),...group}))};
}
