import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { processClient } from './process-client.mjs';
import { createAssessmentCoordinator, snapshotHash } from './assessment.mjs';
import { invariantKeys } from './evaluate.mjs';

// Explicit synthetic-only, task-local control; no project material or paths in POST.
// Deterministic checks below are scoped to this known control, not a universal verifier.
const sandbox=fileURLToPath(new URL('../tasks/issue-5-control/',import.meta.url));
const outputPath=sandbox+'result.json', sentinelPath=sandbox+'sentinel.txt';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const task={goal:'Calculate 2+2',scope:'Only synthetic result.json may change. Preserve the unrelated sentinel.',done_when:'JSON value equals 4, unchanged sentinel, checked arithmetic.'};
const context=[{id:'rules',text:'Preserve full context and unrelated sentinel. Use only synthetic arithmetic data.',kind:'instruction',protected:true},
  {id:'required',text:'Expected JSON value is 4 for two plus two.',kind:'requirement',protected:true},
  {id:'unfinished',text:'Seeded control result requires local review and at most one authorized correction.',kind:'unfinished',protected:true}];
await mkdir(sandbox,{recursive:true});
await writeFile(outputPath,'{"value":5}\n');await writeFile(sentinelPath,'synthetic-unrelated-sentinel\n');
const baselineSentinel=digest(await readFile(sentinelPath)), baselineResult=digest(await readFile(outputPath)), contextHash=digest(JSON.stringify(context));
const c=processClient('powershell.exe',['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./launch.ps1',import.meta.url))]);
let id,closed,assessment,latestBudget,checks=[],repairCount=0,stage='initialize',passed=false;
const client={async call(name,args){const r=await c.call(name,args);latestBudget=r.budget;return r;}};
async function capture(attempt) {
  const bytes=await readFile(outputPath),value=JSON.parse(bytes).value;
  const check=spawnSync(process.execPath,['--input-type=module','-e',
    "import {readFileSync} from 'node:fs'; const value=JSON.parse(readFileSync(process.argv[1],'utf8')).value; console.log(JSON.stringify({value,expected:4})); process.exit(value===4?0:1);",outputPath],{encoding:'utf8',windowsHide:true});
  assert.equal(check.error,undefined);assert.equal(check.stderr,'');
  const facts={attempt,value,expected:4,exit_code:check.status,command:'node synthetic JSON arithmetic check',
    result_sha256:digest(bytes),sentinel_sha256:digest(await readFile(sentinelPath)),
    sentinel_preserved:digest(await readFile(sentinelPath))===baselineSentinel};
  assert.deepEqual(JSON.parse(check.stdout),{value,expected:4});
  const path=sandbox+`check-${attempt}.json`;await writeFile(path,JSON.stringify(facts,null,2)+'\n');
  const source=await readFile(path);assert.deepEqual(JSON.parse(source),facts);
  checks.push({facts,path,sha256:digest(source)});
  return {answer:`Synthetic JSON value=${value}; claimed correct answer to 2+2.`,baseline:'Seeded synthetic baseline value=5; unrelated synthetic sentinel recorded locally.',
    diff:`Only synthetic value changed from 5 to ${value}; sentinel preserved=${facts.sentinel_preserved}.`,
    checks:`Arithmetic command exit=${check.status}, actual=${value}, expected=4; full synthetic scope reviewed.`};
}
try {
  await c.request('initialize',{protocolVersion:'2024-11-05'});stage='discovery';
  assert.ok((await c.request('tools/list')).result.tools.some(x=>x.name==='jev_evaluate'));
  stage='begin';({subtask_id:id}=await client.call('jev_begin_subtask',{schema_version:1}));
  const args={schema_version:1,subtask_id:id,task,context,material:await capture(0)};
  const coordinator=createAssessmentCoordinator({client,
    review:async({args:a,snapshot_sha256})=>{
      assert.equal(snapshot_sha256,snapshotHash(a));assert.deepEqual(a.task,task);assert.deepEqual(a.context,context);
      const last=checks.at(-1),source=await readFile(last.path);assert.equal(digest(source),last.sha256);
      const facts=JSON.parse(source);assert.equal(digest(await readFile(outputPath)),facts.result_sha256);
      assert.equal(digest(await readFile(sentinelPath)),baselineSentinel);assert.equal(facts.sentinel_preserved,true);
      const pass=facts.value===4 && facts.exit_code===0;
      return {snapshot_sha256,reviewer:'main_agent',invariants:Object.fromEntries(invariantKeys.map(key=>[key,{
        pass:key==='claims_are_evidenced'?pass:true,coverage:'complete',
        observed:key==='claims_are_evidenced'?`actual=${facts.value}, check exit=${facts.exit_code}`:'Only permitted synthetic output, unchanged unrelated sentinel, no external writes, complete synthetic outgoing inventory.',
        expected:key==='claims_are_evidenced'?'actual=4 and check exit=0':'Preserve bounded scope, sentinel, originals, authorized actions and synthetic-only outgoing state.',
        evidence:[{id:`check-${facts.attempt}`,kind:'check',locator:last.path,sha256:last.sha256,readback_sha256:digest(source),claim:key,completeness:'complete'}],
      }]))};
    },
    // This single stdio client exclusively owns this lifecycle; no competing calls.
    // Every actual call updates this snapshot. There is no arbitrary external owner.
    remainingBudget:async()=>latestBudget,
    authorizeRepair:async({args:a,violations})=>{assert.deepEqual(a.task,task);assert.deepEqual(violations,['claims_are_evidenced']);return true;},
    repair:async({args:a})=>{stage='repair';repairCount++;assert.equal(repairCount,1);assert.deepEqual(a.context,context);
      await writeFile(outputPath,'{"value":4}\n');return {...a,material:await capture(1)};},
  });
  stage='evaluate';assessment=await coordinator.run(args,{continuity:'fresh'});
  assert.equal(assessment.status,'estimated');assert.equal(assessment.assessment_status,'compliant');
  assert.equal(assessment.repair.status,'repair_succeeded');assert.equal(assessment.repair.attempts_used,1);assert.equal(repairCount,1);
  assert.equal(assessment.history.length,2);assert.equal(assessment.history[0].assessment_status,'violation');
  assert.equal(assessment.history[1].assessment_status,'compliant');assert.equal(assessment.measured.evaluation.jev_requests,2);
  assert.ok(assessment.measured.evaluation.jev_latency_ms>0);assert.equal(assessment.measured.cost_usd,null);
  for(const row of Object.values(assessment.quality)){assert.ok(Number.isFinite(row.raw_score));assert.equal(row.normalized_score,row.raw_score/4);}
  for(const row of Object.values(assessment.invariants)){assert.ok(Number.isFinite(row.p_compliant));assert.equal(row.pass,true);}
  assert.equal(digest(JSON.stringify(context)),contextHash);assert.equal(c.stderr,'');stage='verified';passed=true;
}catch{process.exitCode=1;}finally{
  try{if(id)closed=await client.call('jev_end_subtask',{schema_version:1,subtask_id:id});}catch{passed=false;process.exitCode=1;}
  await c.stop();if(closed?.status!=='closed'){passed=false;process.exitCode=1;}
  const evidence={scenarios:['E16','E17'],provenance:'synthetic_live_encrypted_launcher_stdio_actual_local_repair',checked_at:new Date().toISOString(),
    status:passed?'PASS':'PARTIAL',stage,seeded_control:true,executor:'local_main_agent_callback',native_launch:false,
    launcher_unavailable:c.stderr.trim()==='Jev launcher unavailable',baseline_result_sha256:baselineResult,
    sentinel_hash_preserved:digest(await readFile(sentinelPath))===baselineSentinel,full_context_preserved:digest(JSON.stringify(context))===contextHash,
    checks:checks.map(({path,sha256,facts})=>({locator:path,sha256,...facts})),repair_count:repairCount,assessment:assessment??null,closed:closed??null};
  await writeFile(fileURLToPath(new URL('../tasks/issue-5-live-result.json',import.meta.url)),JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify({scenarios:evidence.scenarios,status:evidence.status,stage,repair_count:repairCount,measured:assessment?.measured??null,closed:closed?.status??null}));
}
