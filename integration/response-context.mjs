import { mainInventory, mainScope } from './main-context.mjs';
import { sha256 } from './context-binding.mjs';

const knownTypes=new Set(['additional_tools','agent_message','message','function_call','function_call_output','custom_tool_call','custom_tool_call_output','reasoning','compaction','item_reference']);
const parse=bytes=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));

// Connection-local original input and one completed response; never persisted.
// Reconstruct original input before selecting; retain native incremental bytes
// only for an unchanged selected prefix. Revocation restores the server prefix.
export function responseContext({selector,policy,headers,inspect=()=>{}}) {
  let pending=null,last=null,everFiltered=false;
  return {
    prepare(before) {
      let body;
      try{body=parse(before);}catch{return {payload:everFiltered?null:before,receipt:null};}
      if(body?.type!=='response.create')return {payload:everFiltered?null:before,receipt:null};
      const types=Array.isArray(body.input)?body.input.map(i=>knownTypes.has(i?.type??'message')?(i?.type??'message'):'unknown'):null;
      const receipt={applied:false,reason:'preserve_full',input_items:types?.length??null,
        incremental:typeof body.previous_response_id==='string',protected:[],excluded:[],
        item_types:types?Object.fromEntries([...new Set(types)].map(type=>[type,types.filter(t=>t===type).length])):null,
        full_context_restored:false};
      if(body.stream_id!==undefined){if(everFiltered)return {payload:null,receipt:{...receipt,reason:'context_chain_unavailable'}};return {payload:before,receipt};}
      let original=body,inherited=false;
      if(receipt.incremental){
        if(last?.id===body.previous_response_id&&Array.isArray(body.input)){
          original={...body,previous_response_id:null,input:[...last.input,...last.output,...body.input]};
          inherited=last.filtered;
        }else{
          if(everFiltered)return {payload:null,receipt:{...receipt,reason:'context_chain_unavailable'}};
          pending=null;return {payload:before,receipt:{...receipt,inventory_status:'incomplete'}};
        }
      }
      if(pending){if(everFiltered)return {payload:null,receipt:{...receipt,reason:'context_chain_unavailable'}};pending=null;last=null;return {payload:before,receipt};}
      if(!Array.isArray(original.input))return {payload:everFiltered?null:before,receipt};
      try{
        const inventory=mainInventory(original),scope=mainScope(original,headers);
        Object.assign(receipt,{input_sha256:inventory.input_sha256,groups:inventory.groups,scope_sha256:scope,inventory_status:'complete',original_input_items:original.input.length});
        try{inspect(original,inventory,scope);}catch{/* inspection never grants authority */}
      }catch(error){receipt.inventory_status='unknown';receipt.inventory_reason=['unknown_content','unknown_item','invalid_call_graph','opaque_or_unknown_item','incomplete_inventory'].includes(error.message)?error.message:'unknown';}
      let selection;
      try{
        const current=policy();
        selection=body.generate===false?{request:original,applied:false,reason:'warmup',protected:[],excluded:[]}:selector.select(original,headers,current);
        if(JSON.stringify(policy())!==JSON.stringify(current))throw Error('authority_changed');
      }catch{selection={request:original,applied:false,reason:'preserve_full',protected:[],excluded:[]};}
      Object.assign(receipt,{reason:selection.reason,applied:selection.applied,protected:selection.protected,excluded:selection.excluded,would_exclude:selection.would_exclude??[],policy_revision:selection.revision??null,
        full_context_restored:inherited&&!selection.applied});
      const signature=sha256(JSON.stringify({scope:receipt.scope_sha256,revision:selection.revision,excluded:selection.excluded}));
      const reuse=selection.applied&&inherited&&last.signature===signature&&
        sha256(JSON.stringify(selection.request.input))===sha256(JSON.stringify([...last.selected_input,...last.output,...body.input]));
      Object.assign(receipt,{context_selected:selection.applied,incremental_reused:reuse,applied:selection.applied&&!reuse});
      const changed=selection.applied&&!reuse||inherited&&!selection.applied;
      pending={input:original.input,selected_input:selection.request.input,signature,filtered:selection.applied,output:[],warmup:body.generate===false};
      everFiltered||=selection.applied;
      return {payload:changed?Buffer.from(JSON.stringify(selection.request)):before,receipt};
    },
    observe(after) {
      try{
        const event=parse(after);
        if(event.type==='response.output_item.done'&&pending&&event.item&&typeof event.item==='object'){
          pending.output.push({index:event.output_index,item:event.item});
        }else if(event.type==='response.completed'&&pending&&typeof event.response?.id==='string'){
          const completed=Array.isArray(event.response.output)?event.response.output:null;
          // Subscription completion can carry an empty placeholder after done
          // events. Native Codex consumes those events, not the empty array.
          let output=completed&&(completed.length||!pending.output.length)?completed:null;
          if(!output&&pending.output.length){
            const done=pending.output;
            // The pinned Codex dialect also accepts unindexed done events in
            // stream order. Mixed, duplicate or incomplete indexed sets are unsafe.
            if(done.every(row=>row.index===undefined))output=done.map(row=>row.item);
            else if(done.every(row=>Number.isSafeInteger(row.index)&&row.index>=0)){
              const ordered=[...done].sort((a,b)=>a.index-b.index);
              if(ordered.every((row,index)=>row.index===index))output=ordered.map(row=>row.item);
            }
          }
          if(!output&&pending.warmup&&!pending.output.length)output=[];
          if(!output){pending=null;last=null;return null;}
          last={...pending,id:event.response.id,output};pending=null;
          return {provider_completed:true,response_id_sha256:sha256(last.id),output_items:output.length,
            done_output_items:last.output===completed?null:last.output.length,completed_output_items:completed?.length??null};
        }else if(['response.failed','response.incomplete','error'].includes(event.type)){pending=null;last=null;}
      }catch{/* unknown events remain unchanged; an unsafe continuation closes */}
      return null;
    },
    invalidate(){pending=null;last=null;},
    safeForOpaque(){return !everFiltered;},
    clear(){pending=null;last=null;everFiltered=false;}
  };
}
