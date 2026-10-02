import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { processClient } from './process-client.mjs';

const c = processClient('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', fileURLToPath(new URL('./launch.ps1', import.meta.url))]);
try {
  await c.request('initialize', { protocolVersion: '2024-11-05' });
  const { subtask_id } = await c.call('jev_begin_subtask', { schema_version: 1 });
  const result = await c.call('jev_choice', {
    schema_version: 1, subtask_id,
    task: { goal: 'Verify that 2 + 2 = 4', scope: 'One synthetic arithmetic check; no files or network tools', done_when: 'Return the correct sum with one short explanation' },
    context: [{ id: 'synthetic', text: 'This is a simple bounded arithmetic verification. Use the least costly suitable candidate, while preserving correctness.', protected: true }],
  });
  // Write only the already allowlisted public envelope, never raw provider data.
  await writeFile(fileURLToPath(new URL('../tasks/issue-2-live-result.json', import.meta.url)), JSON.stringify({ checked_at: new Date().toISOString(), result }, null, 2) + '\n');
  assert.equal(result.status, 'selected');
  assert.equal(result.measured.jev_requests, 1);
  assert.ok(result.measured.jev_latency_ms > 0);
  assert.equal(result.execution.enabled, false);
  assert.equal(c.stderr, '');
  await c.call('jev_end_subtask', { schema_version: 1, subtask_id });
  console.log(JSON.stringify({ status: 'PASS', profile: result.profile, measured: result.measured }));
} catch {
  console.error('Live Choice not verified; inspect the safe result artifact if present.'); process.exitCode = 1;
} finally { await c.stop(); }
