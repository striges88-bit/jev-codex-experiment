// Pure exact-session collector. Caller reads one explicitly identified full JSONL;
// no directory discovery or session history scanning. Cumulative counters are not summed.
export function collectNativeUsage(rows, expected) {
  const unknown = reason => ({status:'UNKNOWN',reason,usage:null,harness_duration_ms:null});
  if (!Array.isArray(rows) || rows.some(row=>!row || typeof row!=='object') || !expected || !['session_id','agent_path','parent_thread_id','model','effort'].every(key=>typeof expected[key]==='string' && expected[key].length>0) || !Array.isArray(expected.turn_ids) || !expected.turn_ids.length ||
      new Set(expected.turn_ids).size !== expected.turn_ids.length) return unknown('invalid_attribution');
  const meta=rows[0];
  const source=meta?.payload?.source?.subagent?.thread_spawn;
  if(meta?.type!=='session_meta' || meta.payload.id!==expected.session_id ||
      source?.agent_path!==expected.agent_path || source.parent_thread_id!==expected.parent_thread_id) return unknown('session_binding_mismatch');
  const turns=rows.filter(row=>row.type==='turn_context').map(row=>row.payload);
  if (!turns.length || turns.some(turn=>!turn || !expected.turn_ids.includes(turn.turn_id) || turn.model!==expected.model || turn.effort!==expected.effort) ||
      expected.turn_ids.some(id=>!turns.some(turn=>turn.turn_id===id))) return unknown('turn_profile_binding_mismatch');
  // More than one terminal task needs a separate explicit delta window, not this fresh-child collector.
  const ends=rows.map((row,index)=>({row,index})).filter(({row})=>row.type==='event_msg' && row.payload?.type==='task_complete');
  if(ends.length!==1) return unknown('terminal_missing_or_ambiguous');
  const end=ends[0];
  const records=rows.map((row,index)=>({row,index})).filter(({row})=>row.type==='event_msg' && row.payload?.type==='token_count');
  if(!records.length || records.some(({index})=>index>end.index)) return unknown('usage_missing_or_after_terminal');
  if(rows.some((row,index)=>row.type==='response_item' && index>records.at(-1).index)) return unknown('terminal_usage_incomplete');
  const fields=['input_tokens','cached_input_tokens','output_tokens'];
  if(rows.filter(row=>row.type==='session_meta').length!==1 || records.some(({index})=>index<rows.findIndex(row=>row.type==='turn_context'))) return unknown('nonfresh_or_unbound_counter');
  let previous=null;
  for(const {row} of records) {
    const value=row.payload?.info?.total_token_usage;
    if(!value || !fields.every(key=>Number.isSafeInteger(value[key]) && value[key]>=0) || value.cached_input_tokens>value.input_tokens) return unknown('invalid_or_partial_usage');
    if(previous && fields.some(key=>value[key]<previous[key])) return unknown('counter_reset');
    previous=value;
  }
  const attributed=rows.map((row,index)=>({row,index})).filter(({row})=>row.type==='token_usage_record');
  let priorAttributed=null;
  for(const {row,index} of attributed) {
    const value=row.payload?.thread_token_usage;
    if(index>end.index || row.payload?.thread_id!==expected.session_id || !expected.turn_ids.includes(row.payload?.turn_id)) return unknown('usage_record_binding_mismatch');
    if(!value || !fields.every(key=>Number.isSafeInteger(value[key]) && value[key]>=0) || value.cached_input_tokens>value.input_tokens) return unknown('invalid_or_partial_usage_record');
    if(priorAttributed && fields.some(key=>value[key]<priorAttributed[key])) return unknown('counter_reset');
    priorAttributed=value;
  }
  if(priorAttributed && fields.some(key=>priorAttributed[key]!==previous[key])) return unknown('usage_sources_disagree');
  return {status:'AVAILABLE',reason:'fresh_bound_session_final_cumulative',
    usage:Object.fromEntries(fields.map(key=>[key,previous[key]])),
    harness_duration_ms:Number.isFinite(end.row.payload.duration_ms) && end.row.payload.duration_ms>=0 ? end.row.payload.duration_ms : null};
}

// For an explicitly bounded primary window in one counter scope. Never subtract across sessions.
export function usageDelta(before, after) {
  const unknown=reason=>({status:'UNKNOWN',reason,usage:null});
  if(!before || !after || typeof before.scope_id!=='string' || !before.scope_id || before.scope_id!==after.scope_id) return unknown('counter_scope_mismatch');
  const fields=['input_tokens','cached_input_tokens','output_tokens'];
  if(![before,after].every(row=>fields.every(key=>Number.isSafeInteger(row[key]) && row[key]>=0) && row.cached_input_tokens<=row.input_tokens)) return unknown('invalid_or_partial_usage');
  if(fields.some(key=>after[key]<before[key])) return unknown('counter_reset');
  const usage=Object.fromEntries(fields.map(key=>[key,after[key]-before[key]]));
  if(usage.cached_input_tokens>usage.input_tokens) return unknown('invalid_delta');
  return {status:'AVAILABLE',reason:'same_scope_bounded_delta',usage};
}
