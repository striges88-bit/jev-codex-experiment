import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { processClient } from './process-client.mjs';

test('C13: isolated executable stdio MCP writes no state/replay/raw data', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'jev-choice-isolation-'));
  const env = { ...process.env }; delete env.TYPESAFE_API_KEY;
  const c = processClient(process.execPath, [fileURLToPath(new URL('./mcp.mjs', import.meta.url))], { cwd, env });
  try {
    assert.ok((await c.request('initialize', { protocolVersion: '2024-11-05' })).result);
    const { subtask_id } = await c.call('jev_begin_subtask', { schema_version: 1 });
    const result = await c.call('jev_choice', {
      schema_version: 1, subtask_id, task: { goal: 'RAW_CONTEXT_MARKER', scope: 'synthetic', done_when: 'synthetic' }, context: [],
    });
    assert.equal(result.fallback.code, 'missing_key');
    assert.ok(!JSON.stringify(result).includes('RAW_CONTEXT_MARKER'));
    assert.equal(c.stderr, ''); assert.deepEqual(await readdir(cwd), []);
    await c.call('jev_end_subtask', { schema_version: 1, subtask_id });
  } finally { await c.stop(); await rmdir(cwd); }
});

test('C13: controlled executable transport never emits raw context, key or error body', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'jev-choice-isolation-'));
  const bootstrap = `import { serve } from ${JSON.stringify(new URL('./mcp.mjs', import.meta.url).href)};
    serve({ apiKey: 'PRIVATE_FIXTURE_KEY', fetchImpl: async () => new Response('PRIVATE_ERROR_BODY', { status: 500 }) });`;
  const c = processClient(process.execPath, ['--input-type=module', '--eval', bootstrap], { cwd });
  try {
    const { subtask_id } = await c.call('jev_begin_subtask', { schema_version: 1 });
    const r = await c.call('jev_choice', { schema_version: 1, subtask_id,
      task: { goal: 'PRIVATE_CONTEXT_MARKER', scope: 'synthetic', done_when: 'synthetic' }, context: [] });
    assert.equal(r.fallback.code, 'provider_http_error'); assert.equal(r.budget.requests_used, 1);
    for (const value of ['PRIVATE_FIXTURE_KEY', 'PRIVATE_ERROR_BODY', 'PRIVATE_CONTEXT_MARKER']) assert.ok(!JSON.stringify(r).includes(value));
    assert.equal(c.stderr, ''); assert.deepEqual(await readdir(cwd), []);
  } finally { await c.stop(); await rmdir(cwd); }
});
