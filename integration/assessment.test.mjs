import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import { createChoice } from './choice.mjs';
import { createAssessmentCoordinator, snapshotHash } from './assessment.mjs';

const task={goal:'Calculate 2+2',scope:'Synthetic output only',done_when:'Return 4'};
const context=[{id:'rule',text:'Keep full context',protected:true,kind:'instruction'}];
const material={answer:'5',baseline:'Absent result',diff:'Added value=5',checks:'Actual value=5; expected=4'};
const sourceHash='a'.repeat(64);
function review(args,pass,coverage='complete') {
  return {snapshot_sha256:snapshotHash(args),reviewer:'main_agent',invariants:Object.fromEntries(
    ['scope_preserved','user_state_preserved','blast_radius_controlled','claims_are_evidenced','secrets_protected'].map(key=>[key,{
      observed:pass===false?'Actual value=5':'Actual bounded facts checked',expected:'Value=4 within the permitted scope',coverage,
      pass,evidence:[{id:'local-check',kind:'check',locator:'tasks/synthetic-check.json',sha256:sourceHash,readback_sha256:sourceHash,claim:key,completeness:coverage}],
    }]))};
}
const provider=async(url,o)=>{const body=JSON.parse(o.body);return Response.json({answers:Object.fromEntries(Object.entries(body.questions).map(([k,q])=>[k,q.type==='score'?
  {type:'score',score:0,confidence:1,legend:Object.fromEntries(q.criteria.map((v,i)=>[i,v])),probabilities:{0:1,1:0,2:0,3:0,4:0}}:{type:'noul',noul:1}]))});};
async function setup(){const client=createChoice({apiKey:'fixture-key',fetchImpl:provider});const {subtask_id}=await client.call('jev_begin_subtask',{schema_version:1});
  return {client,args:{schema_version:1,subtask_id,task,context,material}};}
test('E07/E08/E13/E14: trusted main review, one repair for all violations; concurrency and new coordinator return same terminal record',async()=>{
  const {client,args}=await setup();let repairs=0,reviews=0;const original=JSON.stringify(args);
  const options={client,review:async({args:a})=>{reviews++;return review(a,reviews===1?false:true);},
    remainingBudget:()=>client.remainingBudget(args.subtask_id),authorizeRepair:async()=>true,
    repair:async({args:a,violations})=>{repairs++;assert.equal(violations.length,5);assert.deepEqual(a.context,context);return {...a,material:{...material,answer:'4',diff:'Added value=4',checks:'Actual value=4; expected=4'}};}};
  const c=createAssessmentCoordinator(options);const [a,b]=await Promise.all([c.run(args,{continuity:'fresh'}),c.run(args,{continuity:'fresh'})]);
  assert.deepEqual(a,b);assert.equal(a.assessment_status,'compliant');assert.equal(a.repair.status,'repair_succeeded');assert.equal(a.repair.attempts_used,1);
  assert.equal(repairs,1);assert.equal(reviews,2);assert.equal(a.measured.evaluation.jev_requests,2);assert.equal(a.measured.lifecycle.requests_used,2);
  assert.equal(a.measured.subagent_runtime.repair,null);assert.equal(a.measured.repair_runtime.basis,'callback_elapsed_upper_bound');
  assert.deepEqual(a.history.map(row=>row.measured.jev_requests),[1,1]);assert.deepEqual(a.history.map(row=>row.budget.requests_used),[1,2]);
  assert.equal(a.history[0].quality.correctness.raw_score,0);
  assert.deepEqual(await createAssessmentCoordinator(options).run(args,{continuity:'fresh'}),a);assert.equal(repairs,1);assert.equal(JSON.stringify(args),original);
});
test('E07/E08/E13: partial positive evidence, stale hash and forged caller review stay unknown; no repair',async()=>{
  for(const variant of ['partial','stale','caller','missing','unread','fake-locator','null-evidence']){const {client,args}=await setup();let repairs=0;
    const c=createAssessmentCoordinator({client,review:async()=>{const r=review(args,true,variant==='partial'?'partial':'complete');
      if(variant==='stale')r.snapshot_sha256='b'.repeat(64);if(variant==='caller')r.reviewer='subagent';if(variant==='missing')r.invariants={};
      if(variant==='unread')for(const row of Object.values(r.invariants))row.evidence[0].readback_sha256='b'.repeat(64);
      if(variant==='fake-locator')for(const row of Object.values(r.invariants))row.evidence[0].locator='';
      if(variant==='null-evidence')for(const row of Object.values(r.invariants))row.evidence[0]=null;return r;},
      remainingBudget:()=>client.remainingBudget(args.subtask_id),authorizeRepair:async()=>true,repair:async()=>{repairs++;}});
    const r=await c.run(args,{continuity:'fresh'});assert.equal(r.assessment_status,'unknown');assert.equal(r.action,'return_to_main_agent');assert.equal(repairs,0);
    assert.ok(Object.values(r.invariants).every(x=>x.pass===null));
  }
});

test('E08/E13/E15: unavailable client has unknown actual counters and no stale numerical estimates',async()=>{
  for(const failAt of [1,2]){const {client:actual,args}=await setup();let calls=0,repairs=0;
    const client={call:async(name,a)=>{calls++;if(calls===failAt)throw Error('PRIVATE_FAILURE');return actual.call(name,a);}};
    const coordinator=createAssessmentCoordinator({client,review:async({args:a})=>review(a,false),remainingBudget:()=>actual.remainingBudget(args.subtask_id),
      authorizeRepair:async()=>true,repair:async({args:a})=>{repairs++;return {...a,material:{...material,answer:'4'}};}});
    const r=await coordinator.run(args,{continuity:'fresh'});assert.equal(r.assessment_status,'unknown');assert.equal(r.action,'return_to_main_agent');
    assert.equal(r.measured.evaluation.jev_requests,null);assert.equal(r.measured.evaluation.jev_latency_ms,null);
    assert.equal(r.quality.correctness.raw_score,null);assert.equal(r.invariants.scope_preserved.p_compliant,null);
    assert.equal(repairs,failAt===1?0:1);assert.ok(!JSON.stringify(r).includes('PRIVATE_FAILURE'));
  }
});

test('E07/E13/E14: counterexample with partial coverage permits one repair; repeated violation/unknown/error hand off',async()=>{
  for(const outcome of ['violation','unknown','error','scope']){const {client,args}=await setup();let reviews=0,repairs=0;
    const c=createAssessmentCoordinator({client,review:async({args:a})=>{reviews++;return review(a,reviews===1?false:outcome==='unknown'?null:false,'partial');},
      remainingBudget:()=>client.remainingBudget(args.subtask_id),authorizeRepair:async()=>true,repair:async({args:a})=>{repairs++;
        if(outcome==='error')throw Error('RAW_ERROR');return {...a,task:outcome==='scope'?{...task,scope:'Expanded'}:task,material:{...material,answer:'4'}};}});
    const r=await c.run(args,{continuity:'fresh'});assert.equal(r.repair.attempts_used,1);assert.equal(r.action,'return_to_main_agent');
    assert.equal(repairs,1);assert.notEqual(r.repair.status,'repair_succeeded');assert.ok(!JSON.stringify(r).includes('RAW_ERROR'));
    if(outcome==='scope')assert.equal(r.repair.reason,'repair_scope_changed');
  }
});

test('E13/E14: denial, closed owner, no remaining budget, restart uncertainty and initial compliance never invoke repair',async()=>{
  for(const variant of ['denied','closed','budget','bad-budget','continuity','compliant']){const {client,args}=await setup();let repairs=0;
    const c=createAssessmentCoordinator({client,review:async({args:a})=>review(a,variant==='compliant'),
      remainingBudget:async()=>{if(variant==='closed')await client.call('jev_end_subtask',{schema_version:1,subtask_id:args.subtask_id});
        return variant==='budget'?{requests_remaining:0,wait_ms_remaining:100}:variant==='bad-budget'?{}:client.remainingBudget(args.subtask_id);},
      authorizeRepair:async()=>variant!=='denied',repair:async()=>{repairs++;}});
    const r=await c.run(args,{continuity:variant==='continuity'?'unknown':'fresh'});assert.equal(repairs,0);assert.equal(r.repair.attempts_used,0);
    if(variant==='compliant'){assert.equal(r.assessment_status,'compliant');assert.equal(r.quality.correctness.normalized_score,0);
      assert.equal(r.invariants.scope_preserved.p_compliant,1);assert.equal(r.invariants.scope_preserved.pass,true);}
    else assert.equal(r.action,'return_to_main_agent');
  }
});

test('E04/E08/E15: p=0 cannot veto complete local compliance, low quality never repairs, runtime/cost stay separate',async()=>{
  const client=createChoice({apiKey:'fixture-key',fetchImpl:async(url,o)=>{const r=await provider(url,o),body=await r.json();
    for(const answer of Object.values(body.answers))if(answer.type==='noul')answer.noul=0;return Response.json(body);}});
  const {subtask_id}=await client.call('jev_begin_subtask',{schema_version:1}),args={schema_version:1,subtask_id,task,context,material};
  let repairs=0;const c=createAssessmentCoordinator({client,review:async({args:a})=>review(a,true),repair:async()=>{repairs++;}});
  const r=await c.run(args,{continuity:'fresh'});assert.equal(r.assessment_status,'compliant');assert.equal(repairs,0);
  assert.equal(r.invariants.scope_preserved.p_compliant,0);assert.equal(r.invariants.scope_preserved.pass,true);
  assert.equal(r.quality.correctness.raw_score,0);assert.equal(r.measured.cost_usd,null);assert.equal(r.measured.subagent_runtime.initial,null);
  assert.equal(r.measured.subagent_runtime.repair,null);assert.equal(r.measured.repair_runtime,null);assert.equal(r.measured.evaluation.jev_requests,1);
});

test('E07/E08: actual local source readback distinguishes compliance, counterexample, partial log, drift and unavailable source',async()=>{
  for(const variant of ['compliant','violation','partial-log','drift','unavailable']){
    const directory=await mkdtemp(join(tmpdir(),'jev-local-evidence-')),path=join(directory,'check.json');
    const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
    await writeFile(path,JSON.stringify({exit_code:variant==='violation'?1:0,complete:variant!=='partial-log',command:'bounded synthetic check'}));
    const expectedHash=digest(await readFile(path));const {client,args}=await setup();
    if(variant==='drift')await writeFile(path,'{"exit_code":0,"complete":true,"command":"changed source"}');
    if(variant==='unavailable')await unlink(path);
    try{const coordinator=createAssessmentCoordinator({client,authorizeRepair:async()=>false,review:async({args:a})=>{
      const source=await readFile(path);if(digest(source)!==expectedHash)throw Error('Evidence drift');const facts=JSON.parse(source);
      const r=review(a,facts.exit_code===0,facts.complete?'complete':'partial');
      for(const [key,row] of Object.entries(r.invariants))row.evidence=[{id:'actual-check',kind:'check',locator:path,sha256:expectedHash,readback_sha256:digest(source),claim:key,completeness:facts.complete?'complete':'partial'}];
      return r;
    }});
    const r=await coordinator.run(args,{continuity:'fresh'});assert.equal(r.assessment_status,variant==='compliant'?'compliant':variant==='violation'?'violation':'unknown');
    if(variant==='partial-log')assert.ok(Object.values(r.invariants).every(row=>row.pass===null));
    }finally{if(variant!=='unavailable')await unlink(path);await rmdir(directory);}
  }
});
