import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { serve } from './mcp.mjs';

const answer = id => ({ answers: { tool: { type: 'choice', choice: id, probabilities: { luna_max: 0.85, sol_low: 0.9 } } } });
const task = { goal: 'Check arithmetic', scope: 'One synthetic calculation', done_when: 'Return 4 for 2+2' };
function client(options = {}) {
  const input = new PassThrough(), output = new PassThrough();
  let seq = 0, pending = new Map(), buffer = '';
  output.on('data', chunk => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n'), msg = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      pending.get(msg.id)?.(msg); pending.delete(msg.id);
    }
  });
  serve({ input, output, apiKey: 'synthetic-key', ...options });
  const request = (method, params = {}) => new Promise(resolve => {
    const id = ++seq; pending.set(id, resolve); input.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const call = async (name, args) => {
    const msg = await request('tools/call', { name, arguments: args });
    assert.equal(msg.error, undefined);
    assert.equal(msg.result.isError, false);
    assert.deepEqual(JSON.parse(msg.result.content[0].text), msg.result.structuredContent);
    return msg.result.structuredContent;
  };
  const raw = bytes => new Promise(resolve => {
    output.once('data', chunk => resolve(JSON.parse(chunk.toString()))); input.write(bytes);
  });
  return { request, call, raw, notify: (method, params) => input.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'), close: () => input.end() };
}

function fakeClock() {
  let time = 0, serial = 0;
  const timers = new Map();
  return {
    now: () => time,
    setTimer: (fn, ms) => { const id = ++serial; timers.set(id, { at: time + ms, fn }); return id; },
    clearTimer: id => timers.delete(id),
    advance(ms) {
      const target = time + ms;
      while (true) {
        const due = [...timers].filter(([, x]) => x.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        time = due[1].at; timers.delete(due[0]); due[1].fn();
      }
      time = target;
    },
  };
}

test('C01: initialize/list/begin/Choice exposes only the two profiles', async () => {
  let selected = 'luna_max', count = 0;
  const c = client({ fetchImpl: async () => { count++; return Response.json(answer(selected)); } });
  try {
    assert.equal((await c.request('initialize', { protocolVersion: '2024-11-05' })).result.protocolVersion, '2024-11-05');
    assert.deepEqual((await c.request('tools/list')).result.tools.map(x => x.name), ['jev_begin_subtask', 'jev_choice', 'jev_end_subtask', 'jev_shadow_filter', 'jev_evaluate', 'jev_filter_context']);
    const opened = await c.call('jev_begin_subtask', { schema_version: 1 });
    assert.match(opened.subtask_id, /^[a-f0-9]{32}$/);
    const args = { schema_version: 1, subtask_id: opened.subtask_id, task, context: [] };
    let r = await c.call('jev_choice', args);
    assert.deepEqual(r.profile, { id: 'luna_max', model: 'gpt-6-luna', effort: 'max' });
    selected = 'sol_low'; r = await c.call('jev_choice', args);
    assert.deepEqual(r.profile, { id: 'sol_low', model: 'gpt-6.1-sol', effort: 'low' });
    assert.deepEqual(r.execution, { enabled: false, status: 'not_started' });
    assert.equal(r.budget.requests_used, 2); assert.equal(count, 2);
  } finally { c.close(); }
});

test('C02: provider output is validated and gate uses confidence or selected probability', async () => {
  let raw;
  const c = client({ fetchImpl: async () => Response.json(raw) });
  try {
    const { subtask_id } = await c.call('jev_begin_subtask', { schema_version: 1 });
    const args = { schema_version: 1, subtask_id, task, context: [] };
    for (const mutation of [
      r => r.choice = 'arbitrary-model', r => delete r.probabilities.sol_low,
      r => r.probabilities.luna_max = '0.9', r => r.probabilities.luna_max = 1.1,
      r => r.probabilities.extra = 0.8, r => r.confidence = -1, r => r.confidence = null,
      r => r.confidence = '0.9', r => r.type = 'noul',
    ]) {
      raw = answer('luna_max'); mutation(raw.answers.tool);
      assert.equal((await c.call('jev_choice', args)).fallback.code, 'invalid_selection');
    }
    raw = answer('luna_max'); raw.answers.tool.probabilities.luna_max = 0.799;
    assert.equal((await c.call('jev_choice', args)).fallback.code, 'low_confidence');
    raw.answers.tool.probabilities.luna_max = 0.8;
    const selected = await c.call('jev_choice', args);
    assert.equal(selected.status, 'selected'); assert.equal(selected.choice.provider_confidence, null);
    raw.answers.tool.confidence = 0.7;
    assert.equal((await c.call('jev_choice', args)).fallback.code, 'low_confidence');
  } finally { c.close(); }
});

test('C03/C04/C07: strict inputs, secret protection and lossless context', async () => {
  const sent = [];
  const c = client({ fetchImpl: async (url, init) => { sent.push(JSON.parse(init.body)); return Response.json(answer('luna_max')); } });
  try {
    const { subtask_id } = await c.call('jev_begin_subtask', { schema_version: 1 });
    const args = { schema_version: 1, subtask_id, task, context: [] };
    for (const key of ['provider', 'options', 'key', 'budget', 'endpoint', 'model', 'effort']) {
      assert.equal((await c.call('jev_choice', { ...args, [key]: 'override' })).fallback.code, 'invalid_request');
    }
    assert.equal((await c.call('jev_choice', { ...args, schema_version: 2 })).fallback.code, 'unsupported_schema');
    assert.equal((await c.call('jev_choice', { ...args, task: { ...task, surprise: 1 } })).fallback.code, 'invalid_request');
    for (const secret of ['synthetic-key', 'Authorization: Bearer TEST_SECRET', 'api_key=TEST_SECRET', '-----BEGIN RSA PRIVATE KEY-----', 'ghp_' + 'a'.repeat(24)]) {
      for (const field of ['goal', 'scope', 'done_when']) {
        const result = await c.call('jev_choice', { ...args, task: { ...task, [field]: secret } });
        assert.equal(result.fallback.code, 'secret_suspected'); assert.ok(!JSON.stringify(result).includes(secret));
      }
      assert.equal((await c.call('jev_choice', { ...args, context: [{ id: 'fixture', text: secret, protected: true }] })).fallback.code, 'secret_suspected');
    }
    assert.equal(sent.length, 0);
    const long = 'START_' + 'я'.repeat(2100) + '_END';
    const context = [{ id: 'one', text: long, protected: true }, { id: 'two', text: 'SECOND', protected: false }];
    assert.equal((await c.call('jev_choice', { ...args, context })).status, 'selected');
    assert.deepEqual(sent[0].state, { task, context });
    assert.equal((await c.call('jev_choice', { ...args, context: [{ id: 'huge', text: 'я'.repeat(32100), protected: false }] })).status, 'selected');
    assert.equal(sent.length, 2);
    assert.equal((await c.request('tools/call', { name: 'unknown', arguments: args })).error.code, -32601);
  } finally { c.close(); }
});

test('C08/C10/C12: same lifecycle serializes 30 attempts; independent IDs, close, TTL and capacity', async () => {
  let ticks = 0, active = 0, peak = 0, calls = 0;
  const c = client({ now: () => ticks, fetchImpl: async () => {
    calls++; active++; peak = Math.max(peak, active); await Promise.resolve(); ticks += 10; active--;
    return Response.json(answer('luna_max'));
  } });
  try {
    const { subtask_id } = await c.call('jev_begin_subtask', { schema_version: 1 });
    const args = { schema_version: 1, subtask_id, task, context: [] };
    for (let i = 0; i < 28; i++) await c.call('jev_choice', args);
    const results = await Promise.all([1, 2, 3].map(() => c.call('jev_choice', args)));
    assert.deepEqual(results.map(x => x.status), ['selected', 'selected', 'fallback']);
    assert.equal(results[2].fallback.code, 'budget_requests_exhausted');
    assert.equal(calls, 30); assert.equal(peak, 1);
    assert.equal(results[2].budget.wait_ms_used, 300);
    assert.equal(results[1].measured.jev_requests, 1); assert.equal(results[1].measured.jev_latency_ms, 10);
    assert.equal(results[1].measured.input_tokens, null);
    assert.equal(results[2].measured.jev_requests, 0);
    const second = await c.call('jev_begin_subtask', { schema_version: 1 });
    assert.equal((await c.call('jev_choice', { ...args, subtask_id: second.subtask_id })).budget.requests_used, 1);
    await c.call('jev_end_subtask', { schema_version: 1, subtask_id });
    assert.equal((await c.call('jev_choice', args)).budget, null);
    assert.equal((await c.call('jev_end_subtask', { schema_version: 1, subtask_id })).fallback.code, 'lifecycle_unavailable');
    ticks += 3600000;
    assert.equal((await c.call('jev_choice', { ...args, subtask_id: second.subtask_id })).fallback.code, 'lifecycle_unavailable');
    for (let i = 0; i < 128; i++) assert.equal((await c.call('jev_begin_subtask', { schema_version: 1 })).status, 'opened');
    assert.equal((await c.call('jev_begin_subtask', { schema_version: 1 })).fallback.code, 'lifecycle_capacity');
  } finally { c.close(); }
});

test('C05/C06/C09/C11: fixed transport, bounded stream and remaining deadline includes body', async () => {
  const clock = fakeClock();
  let mode = 'fast', count = 0, observed;
  let started;
  const c = client({ ...clock, fetchImpl: async (url, init) => {
    count++; observed = { url, init };
    if (mode === 'network') throw new Error('RAW_SECRET_NETWORK');
    if (mode === 'http') return new Response('RAW_SECRET_HTTP', { status: 401 });
    if (mode === 'redirect') return new Response('RAW_SECRET_REDIRECT', { status: 302 });
    if (mode === 'oversize') return new Response('x'.repeat(32769));
    if (mode === 'malformed') return new Response('RAW_SECRET_NOT_JSON');
    if (mode === 'missing') return Response.json({ diagnostic: 'RAW_SECRET_DIAGNOSTIC' });
    if (mode === 'consume') clock.advance(4800);
    if (mode === 'slow-body') {
      started();
      return new Response(new ReadableStream({ start(controller) {
        init.signal.addEventListener('abort', () => controller.error(new Error('RAW_SECRET_ABORT')), { once: true });
      } }));
    }
    return Response.json(answer('luna_max'));
  } });
  try {
    const { subtask_id } = await c.call('jev_begin_subtask', { schema_version: 1 });
    const args = { schema_version: 1, subtask_id, task, context: [] };
    for (const [next, expected] of [['network', 'provider_unavailable'], ['http', 'provider_http_error'], ['redirect', 'redirect_rejected'], ['oversize', 'response_limit'], ['malformed', 'malformed_response'], ['missing', 'invalid_selection']]) {
      mode = next;
      const r = await c.call('jev_choice', args);
      assert.equal(r.fallback.code, expected); assert.ok(!JSON.stringify(r).includes('RAW_SECRET'));
    }
    assert.equal(observed.url, 'https://api.typesafe.ai/v1/systemone');
    assert.equal(observed.init.redirect, 'error'); assert.equal(observed.init.method, 'POST');
    assert.equal(observed.init.headers.Authorization, 'Bearer synthetic-key');
    assert.equal(JSON.parse(observed.init.body).model, 'jev-latest');
    mode = 'consume';
    for (let i = 0; i < 6; i++) assert.equal((await c.call('jev_choice', args)).status, 'selected');
    mode = 'slow-body';
    const seen = new Promise(resolve => { started = resolve; });
    const pending = c.call('jev_choice', args); await seen;
    await new Promise(resolve => setImmediate(resolve));
    clock.advance(1199); await Promise.resolve();
    assert.equal(observed.init.signal.aborted, false);
    clock.advance(1);
    const result = await pending;
    assert.equal(result.fallback.code, 'provider_timeout');
    assert.equal(result.measured.jev_latency_ms, 1200);
    assert.equal(result.budget.wait_ms_used, 30000);
    const before = count;
    assert.equal((await c.call('jev_choice', args)).fallback.code, 'budget_time_exhausted');
    assert.equal(count, before);
  } finally { c.close(); }
});

test('C09: cancellation in flight and in queue preserves counts and excludes queue wait', async () => {
  const clock = fakeClock();
  let count = 0, started;
  const c = client({ ...clock, fetchImpl: async (_url, init) => {
    count++; started();
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('synthetic abort')), { once: true }));
  } });
  try {
    const { subtask_id } = await c.call('jev_begin_subtask', { schema_version: 1 }); // RPC id 1
    const args = { schema_version: 1, subtask_id, task, context: [] };
    const ready = new Promise(resolve => { started = resolve; });
    const first = c.call('jev_choice', args); await ready; // RPC id 2
    const queued = c.call('jev_choice', args); // RPC id 3
    c.notify('notifications/cancelled', { requestId: 3 });
    clock.advance(400);
    c.notify('notifications/cancelled', { requestId: 2 });
    const [a, b] = await Promise.all([first, queued]);
    assert.equal(a.fallback.code, 'cancelled'); assert.equal(a.budget.wait_ms_used, 400);
    assert.equal(b.fallback.code, 'cancelled'); assert.equal(b.measured.jev_requests, 0);
    assert.equal(b.budget.requests_used, 1); assert.equal(count, 1);
  } finally { c.close(); }
});

test('C12: actual token counts are allowlisted per call; unknown values remain null', async () => {
  let raw = { ...answer('luna_max'), usage: { input_tokens: 123, output_tokens: 4, cost: 99 }, diagnostic: 'PRIVATE_DIAGNOSTIC' };
  const c = client({ fetchImpl: async () => Response.json(raw) });
  try {
    const { subtask_id } = await c.call('jev_begin_subtask', { schema_version: 1 });
    const args = { schema_version: 1, subtask_id, task, context: [] };
    const a = await c.call('jev_choice', args);
    assert.equal(a.measured.input_tokens, 123); assert.equal(a.measured.output_tokens, 4); assert.equal(a.measured.cost_usd, null);
    assert.ok(!JSON.stringify(a).includes('PRIVATE_DIAGNOSTIC'));
    raw = { ...answer('luna_max'), usage: { input_tokens: -3, output_tokens: '4' } };
    const b = await c.call('jev_choice', args);
    assert.equal(b.measured.input_tokens, null); assert.equal(b.measured.output_tokens, null);
    assert.equal(b.measured.jev_requests, 1); assert.equal(b.budget.requests_used, 2);
    assert.equal((await c.call('jev_choice', { ...args, subtask_id: 'f'.repeat(32) })).budget, null);
  } finally { c.close(); }
});

test('C06: incoming frame, arguments and POST exceed former byte caps; streamed response guard remains', {timeout:2000}, async () => {
  let responseBytes = 32768, count = 0, lastBody;
  const c = client({ fetchImpl: async (_url, init) => {
    count++; lastBody = init.body;
    const payload = JSON.stringify(answer('luna_max'));
    return new Response(payload + ' '.repeat(responseBytes - Buffer.byteLength(payload)));
  } });
  try {
    const ping = { jsonrpc: '2.0', id: 900, method: 'ping', params: { padding: '' } };
    const overhead = Buffer.byteLength(JSON.stringify(ping));
    ping.params.padding = 'x'.repeat(262144 - overhead);
    assert.deepEqual((await c.raw(JSON.stringify(ping) + '\n')).result, {});
    ping.params.padding += 'x';
    assert.deepEqual((await c.raw(JSON.stringify(ping) + '\n')).result, {});
    assert.equal((await c.raw('{invalid json}\n')).error.code, -32700);
    assert.equal((await c.raw('[]\n')).error.code, -32600);
    const { subtask_id } = await c.call('jev_begin_subtask', { schema_version: 1 });
    const args = { schema_version: 1, subtask_id, task, context: [{ id: 'utf8', text: 'я', protected: true }] };
    assert.equal((await c.call('jev_choice', args)).status, 'selected');
    const originalBodyBytes = Buffer.byteLength(lastBody);
    // Keep Cyrillic multibyte content; fill independently from observed POST length.
    args.context[0].text += 'x'.repeat(262144 - originalBodyBytes);
    assert.equal((await c.call('jev_choice', args)).status, 'selected');
    assert.equal(Buffer.byteLength(lastBody), 262144);
    args.context[0].text += 'x';
    const before = count;
    assert.equal((await c.call('jev_choice', args)).status, 'selected'); assert.equal(count, before + 1);
    assert.ok(Buffer.byteLength(JSON.stringify(args)) > 131072);
    assert.deepEqual(JSON.parse(lastBody).state, { task, context: args.context });
    responseBytes = 32769; args.context = [];
    assert.equal((await c.call('jev_choice', args)).fallback.code, 'response_limit');
  } finally { c.close(); }
});

test('C10/C11: restart never revives ID, missing key performs no HTTP, all HTTP errors stay safe', async () => {
  let count = 0;
  const noKey = client({ apiKey: '', fetchImpl: () => { count++; throw new Error('must not run'); } });
  let saved;
  try {
    saved = await noKey.call('jev_begin_subtask', { schema_version: 1 });
    const r = await noKey.call('jev_choice', { schema_version: 1, subtask_id: saved.subtask_id, task, context: [] });
    assert.equal(r.fallback.code, 'missing_key'); assert.equal(r.budget.requests_used, 0); assert.equal(count, 0);
  } finally { noKey.close(); }
  const restarted = client({ fetchImpl: async () => { count++; return Response.json(answer('luna_max')); } });
  try {
    const r = await restarted.call('jev_choice', { schema_version: 1, subtask_id: saved.subtask_id, task, context: [] });
    assert.equal(r.fallback.code, 'lifecycle_unavailable'); assert.equal(r.budget, null); assert.equal(count, 0);
  } finally { restarted.close(); }
  for (const status of [401, 429, 500]) {
    const c = client({ fetchImpl: async () => new Response('synthetic-key RAW_CONTEXT', { status }) });
    try {
      const { subtask_id } = await c.call('jev_begin_subtask', { schema_version: 1 });
      const r = await c.call('jev_choice', { schema_version: 1, subtask_id, task, context: [] });
      assert.equal(r.fallback.code, 'provider_http_error'); assert.ok(!JSON.stringify(r).includes('RAW_CONTEXT'));
    } finally { c.close(); }
  }
});

test('C09: slow headers stop at 5000ms; transport failure is counted with no retry', async () => {
  const clock = fakeClock();
  let count = 0, started;
  const c = client({ ...clock, fetchImpl: (_url, init) => {
    count++; started();
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('PRIVATE_NETWORK')), { once: true }));
  } });
  try {
    const { subtask_id } = await c.call('jev_begin_subtask', { schema_version: 1 });
    const ready = new Promise(resolve => { started = resolve; });
    const pending = c.call('jev_choice', { schema_version: 1, subtask_id, task, context: [] });
    await ready; clock.advance(5000);
    const r = await pending;
    assert.equal(r.fallback.code, 'provider_timeout'); assert.equal(r.measured.jev_requests, 1);
    assert.equal(r.measured.jev_latency_ms, 5000); assert.equal(r.budget.wait_ms_remaining, 25000); assert.equal(count, 1);
  } finally { c.close(); }
});

test('C04: an exact key shaped like an ID is blocked and never echoed', async () => {
  const key = 'e'.repeat(32);
  const c = client({ apiKey: key, fetchImpl: () => { throw new Error('must not run'); } });
  try {
    const r = await c.call('jev_choice', { schema_version: 1, subtask_id: key, task, context: [] });
    assert.equal(r.fallback.code, 'secret_suspected'); assert.equal(r.subtask_id, null);
    assert.ok(!JSON.stringify(r).includes(key)); assert.equal(r.measured.jev_requests, 0);
    const msg = await c.raw(JSON.stringify({ jsonrpc: '2.0', id: key, method: 'ping' }) + '\n');
    assert.equal(msg.id, null); assert.equal(msg.error.code, -32600); assert.ok(!JSON.stringify(msg).includes(key));
  } finally { c.close(); }
});
