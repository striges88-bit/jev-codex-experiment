import { pathToFileURL } from 'node:url';
import { createChoice } from './choice.mjs';
import { schemas } from './schema.mjs';

const names = ['jev_begin_subtask', 'jev_choice', 'jev_end_subtask', 'jev_shadow_filter'];
export function serve({ input = process.stdin, output = process.stdout, ...options } = {}) {
  const choice = createChoice(options);
  const active = new Map();
  let buffer = Buffer.alloc(0), oversized = false;
  const send = msg => output.write(JSON.stringify(msg) + '\n');
  const error = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
  async function dispatch(msg) {
    if (!msg || Array.isArray(msg) || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      error(null, -32600, 'Invalid request'); return;
    }
    const { id, method, params = {} } = msg;
    if (method === 'notifications/cancelled' && id === undefined) {
      active.get(params?.requestId)?.abort(); return;
    }
    if (id === undefined) return;
    if (typeof id === 'string' && options.apiKey && id.includes(options.apiKey)) { error(null, -32600, 'Invalid request ID'); return; }
    if (!(typeof id === 'number' && Number.isSafeInteger(id)) && !(typeof id === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(id))) {
      error(null, -32600, 'Invalid request ID'); return;
    }
    if (!params || typeof params !== 'object' || Array.isArray(params) || active.has(id)) { error(id, -32600, 'Invalid request'); return; }
    const controller = new AbortController(); active.set(id, controller);
    try {
      let result;
      if (method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'jev-choice-experiment', version: '1.0.0' } };
      else if (method === 'ping') result = {};
      else if (method === 'tools/list') result = { tools: names.map(name => ({ name, description: name, inputSchema: schemas[name] })) };
      else if (method === 'tools/call' && names.includes(params.name)) {
        if (Object.keys(params).some(key => !['name', 'arguments', '_meta'].includes(key))) { error(id, -32602, 'Invalid tool parameters'); return; }
        const envelope = await choice.call(params.name, params.arguments, controller.signal);
        result = { isError: false, structuredContent: envelope, content: [{ type: 'text', text: JSON.stringify(envelope) }] };
      } else { error(id, -32601, 'Method or tool unavailable'); return; }
      send({ jsonrpc: '2.0', id, result });
    } catch { error(id, -32603, 'Internal error'); }
    finally { active.delete(id); }
  }
  input.on('data', chunk => {
    // Scan bytes before concatenation so even one huge chunk cannot grow retained state.
    let offset = 0;
    while (offset < chunk.length) {
      const end = chunk.indexOf(10, offset), finish = end < 0 ? chunk.length : end;
      const part = chunk.subarray(offset, finish);
      if (!oversized && buffer.length + part.length > 16384) {
        buffer = Buffer.alloc(0); oversized = true; error(null, -32600, 'Frame limit exceeded');
      }
      if (!oversized) buffer = Buffer.concat([buffer, part]);
      if (end >= 0) {
        if (!oversized && buffer.length) {
          try { void dispatch(JSON.parse(buffer.toString('utf8'))); }
          catch { error(null, -32700, 'Invalid JSON'); }
        }
        buffer = Buffer.alloc(0); oversized = false;
      }
      offset = end < 0 ? chunk.length : end + 1;
    }
  });
  input.on('end', () => { for (const controller of active.values()) controller.abort(); buffer = Buffer.alloc(0); });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) serve({ apiKey: process.env.TYPESAFE_API_KEY ?? '' });
