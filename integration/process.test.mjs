import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { processClient } from './process-client.mjs';

test('S13: executable shadow MCP sanitizes success/error and creates no raw files', async () => {
  for (const failure of [false, true]) {
    const cwd = await mkdtemp(join(tmpdir(), 'jev-shadow-isolation-'));
    const bootstrap = `import { serve } from ${JSON.stringify(new URL('./mcp.mjs', import.meta.url).href)};
      serve({ apiKey: 'PRIVATE_FIXTURE_KEY', fetchImpl: async (url, o) => ${failure ? "new Response('PRIVATE_ERROR_BODY', {status:500})" : "Response.json({answers:Object.fromEntries(Object.keys(JSON.parse(o.body).questions).map(k=>[k,{type:'noul',noul:1,raw:'PRIVATE_RAW_DIAGNOSTIC'}]))})"} });`;
    const c = processClient(process.execPath, ['--input-type=module', '--eval', bootstrap], {cwd});
    try {
      const list=await c.request('tools/list');assert.ok(list.result.tools.some(x=>x.name==='jev_shadow_filter'));
      const {subtask_id}=await c.call('jev_begin_subtask',{schema_version:1});
      const context=[{id:'protected',text:'PRIVATE_CONTEXT_MARKER',protected:true,kind:'instruction'},
        {id:'reference',text:'PRIVATE_REFERENCE_MARKER',protected:false,kind:'reference'}];
      const original=JSON.stringify(context);
      const r=await c.call('jev_shadow_filter',{schema_version:1,subtask_id,task:{goal:'Synthetic',scope:'Synthetic',done_when:'Synthetic'},context});
      assert.equal(r.status,failure?'fallback':'shadow_complete');assert.equal(r.measured.jev_requests,1);
      assert.equal(r.recommendations[0].decision,'protected');assert.equal(r.recommendations[1].decision,failure?'unknown':'would_exclude');
      for(const value of ['PRIVATE_FIXTURE_KEY','PRIVATE_ERROR_BODY','PRIVATE_RAW_DIAGNOSTIC','PRIVATE_CONTEXT_MARKER','PRIVATE_REFERENCE_MARKER'])assert.ok(!JSON.stringify(r).includes(value));
      assert.equal(JSON.stringify(context),original);assert.equal(c.stderr,'');assert.deepEqual(await readdir(cwd),[]);
      await c.call('jev_end_subtask',{schema_version:1,subtask_id});
    } finally {await c.stop();await rmdir(cwd);}
  }
});

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
