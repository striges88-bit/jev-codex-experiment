import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { processClient } from './process-client.mjs';
import { shadowContext } from './shadow-context.mjs';

// Explicit synthetic-only check; never reads task materials into provider state.
const task = { goal: 'Calculate 2 + 2', scope: 'One synthetic arithmetic answer', done_when: 'Return the sum 4' };
const context = [
  { id: 'instruction', text: 'Keep the complete supplied context.', protected: true, kind: 'instruction' },
  { id: 'requirement', text: 'The answer must include the sum.', protected: true, kind: 'requirement' },
  { id: 'unfinished', text: 'The arithmetic answer is pending.', protected: true, kind: 'unfinished' },
  { id: 'arithmetic', text: 'Two plus two equals four.', protected: false, kind: 'reference' },
  { id: 'unrelated', text: 'A synthetic garden has blue flowers.', protected: false, kind: 'reference' },
];
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const before = hash(context), originalTask = hash(task);
const c = processClient('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', fileURLToPath(new URL('./launch.ps1', import.meta.url))]);
let subtask_id, result, closed, passed = false, preserved = false, stage = 'initialize';
try {
  await c.request('initialize', {protocolVersion:'2024-11-05'});
  stage='discovery';
  const listed=await c.request('tools/list');assert.ok(listed.result.tools.some(x=>x.name==='jev_shadow_filter'));
  stage='begin';
  ({subtask_id}=await c.call('jev_begin_subtask',{schema_version:1}));
  stage='shadow';
  const evaluated=await shadowContext({client:c,subtask_id,task,context});result=evaluated.result;
  preserved=hash(context)===before&&hash(evaluated.context)===before&&hash(task)===originalTask;
  assert.ok(preserved);assert.equal(result.status,'shadow_complete');assert.equal(result.applied,false);
  assert.equal(result.measured.jev_requests,1);assert.ok(result.measured.jev_latency_ms>0);
  assert.deepEqual(result.recommendations.map(x=>x.fragment_id),context.map(x=>x.id));
  for(const row of result.recommendations.slice(0,3)){assert.equal(row.decision,'protected');assert.equal(row.p_unneeded,null);}
  for(const row of result.recommendations.slice(3)){assert.ok(Number.isFinite(row.p_unneeded)&&row.p_unneeded>=0&&row.p_unneeded<=1);}
  for(const text of context.map(x=>x.text))assert.ok(!JSON.stringify(result).includes(text));
  assert.equal(c.stderr,'');passed=true;
} catch {
  process.exitCode=1;
} finally {
  try {if(subtask_id)closed=await c.call('jev_end_subtask',{schema_version:1,subtask_id});}
  catch {passed=false;process.exitCode=1;}
  await c.stop();
  if(closed?.status!=='closed'){passed=false;process.exitCode=1;}
  const evidence={scenario:'S15',provenance:'synthetic_live_encrypted_launcher_stdio',checked_at:new Date().toISOString(),status:passed?'PASS':'PARTIAL',stage,
    launcher_unavailable:c.stderr.trim()==='Jev launcher unavailable',
    context_hash_before:before,context_hash_after:hash(context),task_hash_preserved:hash(task)===originalTask,consumer_full_context_preserved:preserved,result:result??null,closed:closed??null};
  await writeFile(fileURLToPath(new URL('../tasks/issue-4-live-result.json',import.meta.url)),JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify({scenario:'S15',status:evidence.status,measured:result?.measured??null,closed:closed?.status??null}));
}
