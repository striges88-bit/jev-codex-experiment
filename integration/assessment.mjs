import { createHash } from 'node:crypto';
import { invariantKeys, rubrics, evaluationRequestCount } from './evaluate.mjs';

// Process-local, fail-closed registry. A new coordinator cannot reset the same ID.
// Never evict entries to grant another repair. Restart requires a verified checkpoint.
const registry = new Map();
export const snapshotHash = args => createHash('sha256').update(JSON.stringify(args)).digest('hex');
const safeText = value => typeof value==='string' && value.trim().length>0 && value.length<=4096;
const hash = value => typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
const identifier = value => typeof value==='string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(value);
const unknown = p => ({p_compliant:p??null,pass:null,status:'unknown',evidence:[]});
const unavailableEstimate = id => ({schema_version:1,subtask_id:id,status:'fallback',fallback:{code:'mcp_unavailable',action:'return_to_main_agent'},
  quality:Object.fromEntries(Object.entries(rubrics).map(([key,criteria])=>[key,{rubric_id:'quality-v1',levels:criteria.map((description,value)=>({value,description})),
    raw_score:null,normalized_score:null,provider_confidence:null,provider_distribution:null,consistency:null}])),
  invariants:Object.fromEntries(invariantKeys.map(key=>[key,unknown(null)])),budget:null,
  measured:{jev_requests:null,jev_latency_ms:null,input_tokens:null,output_tokens:null,cost_usd:null,subagent_runtime_ms:null}});

function reviewedRows(estimate, review, expectedHash) {
  const trusted=review?.reviewer==='main_agent' && review.snapshot_sha256===expectedHash;
  return Object.fromEntries(invariantKeys.map(key=>{
    const p=estimate.invariants?.[key]?.p_compliant, row=trusted?review.invariants?.[key]:null;
    if(!row || !safeText(row.observed) || !safeText(row.expected) || !['complete','partial','missing'].includes(row.coverage) ||
      !Array.isArray(row.evidence) || row.evidence.length===0 || row.evidence.length>64)return [key,unknown(p)];
    const ids=new Set();
    const valid=row.evidence.every(e=>e && typeof e==='object' && identifier(e.id) && !ids.has(e.id) && (ids.add(e.id),true) &&
      ['baseline','diff','check','output','authorization'].includes(e.kind) && safeText(e.locator) && hash(e.sha256) &&
      e.readback_sha256===e.sha256 && e.claim===key && ['complete','partial'].includes(e.completeness));
    if(!valid || ![true,false,null].includes(row.pass))return [key,unknown(p)];
    const pass=row.pass===false?false:row.pass===true && row.coverage==='complete' && row.evidence.every(e=>e.completeness==='complete')?true:null;
    return [key,{p_compliant:p??null,pass,status:pass===true?'compliant':pass===false?'violation':'unknown',
      evidence:row.evidence.map(({id,kind,locator,sha256,readback_sha256,claim,completeness})=>({id,kind,locator,sha256,readback_sha256,claim,completeness})),
      review:{reviewer:'main_agent',snapshot_sha256:expectedHash,observed:row.observed,expected:row.expected,coverage:row.coverage}}];
  }));
}
function aggregate(estimate, rows) {
  if(estimate.status!=='estimated')return 'unknown';
  if(Object.values(rows).some(row=>row.pass===false))return 'violation';
  return Object.values(rows).every(row=>row.pass===true)?'compliant':'unknown';
}
function measurements(calls, runtime) {
  const sum=field=>calls.reduce((total,c)=>total===null || c.measured?.[field]===null || !Number.isFinite(c.measured?.[field])?null:total+c.measured[field],0);
  const tokenSum=field=>{const n=sum(field);return Number.isSafeInteger(n)&&n>=0?n:null;};
  return {evaluation:{jev_requests:sum('jev_requests'),jev_latency_ms:sum('jev_latency_ms'),
    input_tokens:tokenSum('input_tokens'),output_tokens:tokenSum('output_tokens'),cost_usd:null},
    lifecycle:calls.at(-1)?.budget??null,
    subagent_runtime:{initial:null,repair:null},repair_runtime:runtime,cost_usd:null};
}

// review/repair/authorization/budget are trusted main-agent capabilities.
// Data supplied in args (including verified:true) never substitutes for review().
// Truth and completeness of local facts are the main reviewer's responsibility.
export function createAssessmentCoordinator({client,review,repair,authorizeRepair,remainingBudget,now=()=>performance.now()}) {
  async function execute(original, continuity) {
    const args=structuredClone(original), calls=[], history=[]; let attempts=0,runtime=null;
    const assess=async current=>{
      const expectedHash=snapshotHash(current);
      let estimate;try{estimate=await client.call('jev_evaluate',structuredClone(current));}catch{estimate=unavailableEstimate(current.subtask_id);}
      calls.push(estimate);
      let factReview;try{factReview=await review({args:structuredClone(current),estimate:structuredClone(estimate),snapshot_sha256:expectedHash});}catch{factReview=null;}
      const invariants=reviewedRows(estimate,factReview,expectedHash),status=aggregate(estimate,invariants);
      history.push({snapshot_sha256:expectedHash,status:estimate.status,assessment_status:status,
        quality:estimate.quality,invariants,measured:estimate.measured,budget:estimate.budget});
      return {...estimate,invariants,assessment_status:status};
    };
    const finish=(result,reason,repairStatus)=>({...result,
      action:result.assessment_status==='compliant'?'stop':'return_to_main_agent',
      repair:{attempts_used:attempts,status:repairStatus,reason},history,
      measured:measurements(calls,runtime)});
    let initial;
    try{initial=await assess(args);}catch{return {schema_version:1,subtask_id:args.subtask_id,assessment_status:'unknown',action:'return_to_main_agent',repair:{attempts_used:0,status:'not_started',reason:'assessment_unavailable'},measured:measurements(calls,null)};}
    if(initial.assessment_status!=='violation')return finish(initial,initial.assessment_status==='compliant'?'facts_compliant':'facts_unknown','not_started');
    if(continuity!=='fresh')return finish(initial,'continuity_unverified','not_started');
    const violations=invariantKeys.filter(key=>initial.invariants[key].pass===false);
    let authorized=false,budget;
    try{authorized=await authorizeRepair({args:structuredClone(args),violations,review:structuredClone(history[0])});
      budget=await remainingBudget(args.subtask_id);}catch{return finish(initial,'repair_preflight_unavailable','not_started');}
    if(authorized!==true)return finish(initial,'repair_not_authorized','not_started');
    const planned=evaluationRequestCount(args);
    if(!budget || planned===null || !Number.isSafeInteger(budget.requests_remaining) || budget.requests_remaining<planned ||
      typeof budget.wait_ms_remaining!=='number' || !Number.isFinite(budget.wait_ms_remaining) || Math.floor(budget.wait_ms_remaining)<1)
      return finish(initial,'repair_budget_unavailable','not_started');
    // Set once before invoking the executor, including failed executions.
    attempts=1;const start=now();let revised;
    try{revised=await repair({args:structuredClone(args),violations,review:structuredClone(history[0])});}
    catch{runtime={ms:Math.max(0,now()-start),basis:'callback_elapsed_upper_bound'};return finish(initial,'repair_failed','return_to_main_agent');}
    runtime={ms:Math.max(0,now()-start),basis:'callback_elapsed_upper_bound'};
    if(!revised || revised.subtask_id!==args.subtask_id || revised.schema_version!==args.schema_version ||
      JSON.stringify(revised.task)!==JSON.stringify(args.task) || JSON.stringify(revised.context)!==JSON.stringify(args.context))
      return finish(initial,'repair_scope_changed','return_to_main_agent');
    let final;try{final=await assess(structuredClone(revised));}catch{return finish({...initial,assessment_status:'unknown'},'reassessment_unavailable','return_to_main_agent');}
    return finish(final,final.assessment_status==='compliant'?'facts_compliant':'repair_unresolved',
      final.assessment_status==='compliant'?'repair_succeeded':'return_to_main_agent');
  }
  return {async run(args,{continuity='unknown'}={}) {
    const id=args?.subtask_id;
    if(typeof id!=='string'||!/^[a-f0-9]{32}$/.test(id))throw new Error('Invalid local lifecycle');
    if(!registry.has(id)) {
      if(registry.size>=4096)throw new Error('Local lifecycle capacity');
      // Promise is stored before the first awaited callback can admit another run.
      const original=structuredClone(args);
      registry.set(id,Promise.resolve().then(()=>execute(original,continuity)));
    }
    return structuredClone(await registry.get(id));
  }};
}
