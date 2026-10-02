// Test/smoke client: failures deliberately omit raw child output.
import { spawn } from 'node:child_process';
export function processClient(command, args, options = {}) {
  const child = spawn(command, args, { ...options, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let sequence = 0, buffer = '', stderr = '';
  const pending = new Map();
  const fail = () => { for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(new Error('MCP process unavailable')); } pending.clear(); };
  child.on('error', fail); child.on('exit', fail);
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.on('data', chunk => {
    buffer += chunk;
    if (buffer.length > 65536) { fail(); child.kill(); return; }
    while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n'), line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      let msg;
      try { msg = JSON.parse(line); } catch { fail(); child.kill(); return; }
      const waiter = pending.get(msg.id);
      if (waiter) { clearTimeout(waiter.timer); pending.delete(msg.id); waiter.resolve(msg); }
    }
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('MCP response timeout')); child.kill(); }, 15000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  return {
    request,
    async call(name, args) {
      const msg = await request('tools/call', { name, arguments: args });
      if (msg.error || msg.result?.isError || !msg.result?.structuredContent) throw new Error('MCP tool unavailable');
      return msg.result.structuredContent;
    },
    get stderr() { return stderr; },
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.stdin.end();
      const timer = setTimeout(() => child.kill(), 2000);
      await exited; clearTimeout(timer);
    },
  };
}
