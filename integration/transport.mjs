export const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
class TransportFailure extends Error {
  constructor(code) { super(code); this.code = code; }
}

export function createTransport({ apiKey, fetchImpl = globalThis.fetch, setTimer = setTimeout, clearTimer = clearTimeout }) {
  return async (body, timeoutMs, callerSignal) => {
    const controller = new AbortController();
    let timedOut = false, reader;
    const cancel = () => controller.abort();
    callerSignal?.addEventListener('abort', cancel, { once: true });
    if (callerSignal?.aborted) cancel();
    const timer = setTimer(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      const response = await fetchImpl(ENDPOINT, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body,
      });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel(); throw new TransportFailure('redirect_rejected');
      }
      if (!response.ok) { await response.body?.cancel(); throw new TransportFailure('provider_http_error'); }
      if (!response.body) throw new TransportFailure('malformed_response');
      reader = response.body.getReader();
      let bytes = 0;
      const chunks = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 32768) { await reader.cancel(); throw new TransportFailure('response_limit'); }
        chunks.push(Buffer.from(value));
      }
      // An injected transport must honor abort too; never accept a late success.
      if (controller.signal.aborted) throw new TransportFailure(timedOut ? 'provider_timeout' : 'cancelled');
      try { return { raw: JSON.parse(Buffer.concat(chunks).toString('utf8')), code: null }; }
      catch { throw new TransportFailure('malformed_response'); }
    } catch (error) {
      const code = timedOut ? 'provider_timeout' : callerSignal?.aborted ? 'cancelled' :
        error instanceof TransportFailure ? error.code :
        /redirect/i.test(error?.cause?.message ?? '') ? 'redirect_rejected' : 'provider_unavailable';
      return { raw: null, code };
    } finally {
      clearTimer(timer); callerSignal?.removeEventListener('abort', cancel);
      reader?.releaseLock();
    }
  };
}
