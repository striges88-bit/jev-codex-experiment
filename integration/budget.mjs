import { randomBytes } from 'node:crypto';

export const snapshot = entry => entry ? {
  requests_used: entry.requests, wait_ms_used: entry.wait,
  requests_remaining: Math.max(0, 30 - entry.requests), wait_ms_remaining: Math.max(0, 30000 - entry.wait),
} : null;

// One process-local owner. Future Jev tools must use this same instance and run().
export function createBudget(now) {
  const entries = new Map();
  const get = id => {
    const entry = entries.get(id);
    if (entry && now() - entry.opened >= 3600000) { entries.delete(id); return undefined; }
    return entry;
  };
  return {
    get,
    open() {
      for (const id of entries.keys()) get(id);
      if (entries.size >= 128) return null;
      const id = randomBytes(16).toString('hex');
      entries.set(id, { requests: 0, wait: 0, opened: now(), tail: Promise.resolve() });
      return id;
    },
    close(id) { const entry = get(id); entries.delete(id); return entry; },
    async run(id, operation) {
      const entry = get(id);
      if (!entry) return operation(undefined);
      const previous = entry.tail;
      let release;
      entry.tail = new Promise(resolve => { release = resolve; });
      try { await previous; return await operation(get(id) === entry ? entry : undefined); }
      finally { release(); }
    },
  };
}
