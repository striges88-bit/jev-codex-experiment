import { sha256 } from './context-binding.mjs';
import { selectQuality } from './context-quality.mjs';
import {secretSuspected} from './schema.mjs';

import {mainInventory,mainScope,mainAppendChangesState} from './main-context-contract.mjs';
export {mainInventory,mainScope} from './main-context-contract.mjs';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const hash = value => sha256(JSON.stringify(value));

// This policy is coordinator-owned local data. It never comes from HTTP body,
// model recommendations, user-like text inside a tool result, or subagent Choice.
export function createMainContextSelector(options={}) {
  const cache = new Map();
  return {
    clear() { cache.clear(); },
    select(request, headers, policy,continuity=null) {
      if(policy?.schema_version===2&&typeof options.prepareQualityPilot==='function'){
        const full=()=>({request,applied:false,request_changed:false,task_state_attached:false,duplicate_removed:false,
          reason:'disabled_or_passthrough',excluded:[],protected:[]});
        const key=JSON.stringify(request);
        return (async()=>{
          try{
            const prepared=await options.prepareQualityPilot(request,headers,policy,continuity);
            if(!prepared||JSON.stringify(request)!==key)return full();
            return await selectQuality(request,headers,prepared.policy,{authorizeQualityPilot:()=>prepared.validate,
              stateInsertAt:prepared.stateInsertAt,verifyStateOnly:true,
              validateSource:bytes=>{if(secretSuspected(bytes.toString('utf8')))throw Error('unsafe_source');}});
          }catch{return full();}
        })();
      }
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
          if (!entry.allowProtectedAppends&&request.input.slice(entry.itemHashes.length).some(item=>mainAppendChangesState(item))) return full('working_state_changed');
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
