import { sha256 } from './context-binding.mjs';
import { selectQuality } from './context-quality.mjs';

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

// This policy is coordinator-owned local data. It never comes from HTTP body,
// model recommendations, user-like text inside a tool result, or subagent Choice.
export function createMainContextSelector(options={}) {
  const cache = new Map();
  return {
    clear() { cache.clear(); },
    select(request, headers, policy) {
      if(policy?.schema_version===2)return selectQuality(request,headers,policy,options);
      let inventory, scope;
      const full = reason => ({ request, applied: false, reason, excluded: [], protected: inventory?.groups.filter(g => g.protected).map(g => g.sha256) ?? [] });
      try {
        if(policy?.schema_version===1&&policy.bindings?.some(row=>row&&['state','duplicates','deliveries','occurrences','binding_sha256','state_sha256'].some(key=>Object.hasOwn(row,key))))return full('invalid_binding');
        if (!policy || policy.schema_version !== 1 || policy.enabled !== true ||
            !['shadow','filter'].includes(policy.mode) || policy.approval_id !== 'global-jev-opt-in-20261003' ||
            !Number.isSafeInteger(policy.revision) || policy.revision < 1 || !Array.isArray(policy.bindings)) return full('disabled_or_passthrough');
        inventory = mainInventory(request);
        scope = mainScope(request,headers);
        if (!scope) return full('scope_unavailable');
        const matches = policy.bindings.filter(row => row.scope_sha256 === scope);
        if (matches.length !== 1) return full('binding_unavailable');
        const binding = matches[0];
        if (!Array.isArray(binding.optional_groups) || !binding.optional_groups.every(row =>
          object(row) && /^[a-f0-9]{64}$/.test(row.sha256) && row.completed === true && row.reason === 'superseded_reference') ||
          new Set(binding.optional_groups.map(row => row.sha256)).size !== binding.optional_groups.length) return full('invalid_binding');
        const bindingHash = hash(binding);
        let entry = cache.get(scope);
        if (!entry || entry.revision !== policy.revision || entry.bindingHash !== bindingHash) {
          const originalHashes=binding.item_hashes??inventory.item_hashes;
          if(!Array.isArray(originalHashes)||!originalHashes.length||originalHashes.length>inventory.item_hashes.length||
              originalHashes.some((value,i)=>!/^[a-f0-9]{64}$/.test(value)||value!==inventory.item_hashes[i])||
              binding.input_sha256!==hash(request.input.slice(0,originalHashes.length)))return full('inventory_changed');
          const optional = new Set(binding.optional_groups.map(row => row.sha256));
          const originalGroups=inventory.groups.filter(g=>g.end<originalHashes.length);
          if ([...optional].some(value => originalGroups.filter(g => g.sha256 === value).length !== 1)) return full('ambiguous_group');
          entry = { revision: policy.revision, bindingHash, itemHashes: originalHashes,
            allowProtectedAppends:binding.allow_protected_appends===true,
            excluded: originalGroups.filter(g => optional.has(g.sha256) && (!g.protected||
              g.metadata_reviewable&&binding.optional_groups.find(row=>row.sha256===g.sha256)?.metadata_reviewed===true))
              .map(({start,end,sha256,metadata_reviewable}) => ({start,end,sha256,metadataReviewed:metadata_reviewable})) };
          // Cache only hashes/decisions. Raw context is held by the request, not retained here.
          if (cache.size >= 128) cache.delete(cache.keys().next().value);
          cache.set(scope,entry);
        }
          if (entry.itemHashes.some((value,i) => inventory.item_hashes[i] !== value)) return full('prefix_changed');
          if (request.input.slice(entry.itemHashes.length).some(item => item.role === 'user' || item.role === 'system' || item.role === 'developer')) return full('task_steered');
          if (!entry.allowProtectedAppends&&request.input.slice(entry.itemHashes.length).some(item=>essential.test(itemText(item)))) return full('working_state_changed');
        // Required data that becomes protected again overrides any cached exclusion.
        const remove = inventory.groups.filter(g => entry.excluded.some(original =>
          original.start===g.start&&original.end===g.end&&original.sha256===g.sha256&&
          (!g.protected||g.metadata_reviewable&&original.metadataReviewed)));
        const indices = new Set(remove.flatMap(g => Array.from({ length:g.end-g.start+1 },(_,i) => g.start+i)));
        const selected = { ...request, input:request.input.filter((_,index) => !indices.has(index)) };
        const shadow = policy.mode === 'shadow';
        return { request: shadow ? request : selected, applied: !shadow && indices.size > 0,
          reason:shadow ? 'shadow' : 'scoped_selection', excluded:shadow ? [] : remove.map(g => g.sha256),
          would_exclude:shadow ? remove.map(g => g.sha256) : [],
          protected:inventory.groups.filter(g => g.protected&&!remove.includes(g)).map(g => g.sha256), scope_sha256:scope, revision:policy.revision };
      } catch { return full('unknown_inventory'); }
    },
  };
}
