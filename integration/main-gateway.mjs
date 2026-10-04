import http from 'node:http';
import https from 'node:https';
import { pipeline, Writable } from 'node:stream';
import { zstdDecompressSync, zstdCompressSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sha256 } from './context-binding.mjs';
import { createMainContextSelector, mainInventory, mainScope } from './main-context.mjs';
import { websocketText } from './websocket-context.mjs';
import { responseContext } from './response-context.mjs';
import { secretSuspected } from './schema.mjs';

const HOP = new Set(['host','connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade']);
export function forwardHeaders(headers, { websocket = false } = {}) {
  const nominated = new Set(String(headers.connection ?? '').split(',').map(value => value.trim().toLowerCase()));
  return Object.fromEntries(Object.entries(headers).filter(([key]) =>
    (websocket && ['connection','upgrade'].includes(key)) ||
    (!HOP.has(key) && !nominated.has(key) && key !== 'cookie' && !key.startsWith('proxy-') && !key.startsWith('x-jev-'))));
}

function route(req, capability) {
  // Raw allowlist; neither user-supplied URL nor credential changes the destination.
  const prefix = `/jev/${capability}/backend-api/codex`;
  if (req.method === 'POST' && [prefix+'/responses',prefix+'/responses/compact'].includes(req.url)) return req.url.slice(`/jev/${capability}`.length);
  if (req.method === 'GET' && new RegExp(`^${prefix}/models(?:\\?client_version=[A-Za-z0-9._+-]+)?$`).test(req.url ?? '')) return req.url.slice(`/jev/${capability}`.length);
  if (req.method === 'GET' && req.url === prefix+'/responses' && req.headers.upgrade?.toLowerCase() === 'websocket') return '/backend-api/codex/responses';
  return null;
}

function observeRequest(receipt, fields, headers) {
  const row = { schema_version:2, request_id:randomUUID(), process_id:process.pid,
    thread_sha256:typeof headers['thread-id'] === 'string' ? sha256(headers['thread-id']) : null, ...fields };
  const started = performance.now();
  let finished = false, connected = false;
  const emit = phase => receipt({ ...row, phase, observed_at:new Date().toISOString(), latency_ms:performance.now()-started });
  emit('received');
  return { row,
    connected() { if (!finished && !connected) { connected = true; emit('connected'); } },
    finish() { if (!finished) { finished = true; emit('terminal'); } }
  };
}

export function createMainGateway({ capability, policy = () => null, receipt = () => {}, inspect=()=>{},
  upstream = 'https://chatgpt.com', testUpstream = false } = {}) {
  if (!/^[a-f0-9]{32}$/.test(capability ?? '')) throw Error('invalid_capability');
  const target = new URL(upstream);
  if ((!testUpstream && upstream !== 'https://chatgpt.com') || target.username || target.password ||
      target.pathname !== '/' || target.search || target.hash ||
      (testUpstream && !['127.0.0.1','localhost'].includes(target.hostname))) throw Error('invalid_upstream');
  const request = target.protocol === 'https:' ? https.request : http.request;
  const selector = createMainContextSelector();
  const sockets = new Set();
  const safeReceipt = row => { try { receipt(row); } catch { /* telemetry cannot alter transport */ } };
  const allowed = req => !req.headers.origin &&
    [`127.0.0.1:${req.socket.localPort}`,`localhost:${req.socket.localPort}`].includes(req.headers.host) &&
    ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  const server = http.createServer(async (req,res) => {
    const path = allowed(req) ? route(req,capability) : null;
    if (!path) { req.resume(); res.writeHead(404).end(); return; }
    const observation = observeRequest(safeReceipt,{ transport:'http', route:path.endsWith('/compact') ? 'compact' : req.method === 'GET' ? 'models' : 'responses',
      applied:false, reason:'passthrough', before_sha256:null, after_sha256:null, before_bytes:null, after_bytes:null,
      protected:[], excluded:[], upstream_status:null, completed:false, upstream_body_written:false,
      provider_usage:null, cost_usd:null },req.headers);
    const { row, finish } = observation;
    let original, forwarded, outgoing;
    res.on('finish',() => { row.completed = true; finish(); });
    res.on('close',() => { outgoing?.destroy(); if (!res.writableFinished) row.reason = 'client_disconnected'; finish(); });
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      original = Buffer.concat(chunks); forwarded = original;
      row.before_bytes = original.length; row.before_sha256 = sha256(original);
      const headers = forwardHeaders(req.headers);
      if (req.method === 'POST' && path.endsWith('/responses')) {
        try {
          const encoding = req.headers['content-encoding'];
          if (encoding && encoding !== 'identity' && encoding !== 'zstd') throw Error('unknown_encoding');
          if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) throw Error('unknown_content_type');
          const decoded = encoding === 'zstd' ? zstdDecompressSync(original) : original;
          const body = JSON.parse(new TextDecoder('utf-8',{ fatal:true }).decode(decoded));
          // Observe the actual inventory without persisting text or credentials.
          try {
            const inventory = mainInventory(body);
            row.scope_sha256 = mainScope(body,req.headers);
            row.input_sha256 = inventory.input_sha256;
            row.groups = inventory.groups;
          } catch { row.inventory_status = 'unknown'; }
          const currentPolicy = policy();
          const selection = selector.select(body,req.headers,currentPolicy);
          // Re-read trusted authority immediately before committing the outgoing copy.
          if (JSON.stringify(policy()) !== JSON.stringify(currentPolicy)) throw Error('authority_changed');
          row.reason = selection.reason; row.protected = selection.protected; row.excluded = selection.excluded;
          row.scope_sha256 = selection.scope_sha256 ?? row.scope_sha256 ?? null; row.policy_revision = selection.revision ?? null;
          if (selection.applied) {
            const selected = Buffer.from(JSON.stringify(selection.request));
            forwarded = encoding === 'zstd' ? zstdCompressSync(selected) : selected;
            row.applied = true;
          }
        } catch { row.reason = 'preserve_full'; row.applied = false; row.excluded = []; forwarded = original; }
      }
      row.after_bytes = forwarded.length; row.after_sha256 = sha256(forwarded);
      headers['content-length'] = String(forwarded.length);
      if (req.aborted || res.destroyed) return;
      outgoing = request({ hostname:target.hostname, port:target.port || undefined, protocol:target.protocol,
        path, method:req.method, headers }, upstreamResponse => {
        row.upstream_status = upstreamResponse.statusCode;
        observation.connected();
        if (upstreamResponse.statusCode >= 300 && upstreamResponse.statusCode < 400) {
          row.reason = 'redirect_rejected'; upstreamResponse.resume(); res.writeHead(502).end(); finish(); return;
        }
        const responseHeaders = forwardHeaders(upstreamResponse.headers);
        delete responseHeaders['set-cookie'];
        res.writeHead(upstreamResponse.statusCode,responseHeaders);
        // Pipe with backpressure. No full-response buffering or stream reconstruction.
        pipeline(upstreamResponse,res,error => {
          if (error) row.reason = 'stream_interrupted';
          else row.completed = true;
          finish();
        });
      });
      outgoing.on('error',() => { row.reason = 'upstream_unavailable'; if (!res.headersSent) res.writeHead(502).end(); else res.destroy(); finish(); });
      outgoing.setTimeout(300000,() => { row.reason = 'upstream_timeout'; outgoing.destroy(); });
      outgoing.on('finish',() => { row.upstream_body_written = true; });
      outgoing.end(forwarded);
    } catch { row.reason = 'request_unavailable'; if (!res.headersSent) res.writeHead(400).end(); finish(); }
  });
  server.on('connection',socket => { sockets.add(socket); socket.on('close',() => sockets.delete(socket)); });
  server.on('upgrade',(req,socket,head) => {
    const path = allowed(req) ? route(req,capability) : null;
    if (!path || req.headers.upgrade?.toLowerCase() !== 'websocket') { socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); return; }
    const observation = observeRequest(safeReceipt,{ transport:'websocket', route:'responses',
      applied:false, reason:'websocket_context_adapter', upstream_status:null, completed:false },req.headers);
    const { row, finish } = observation;
    let peer;
    const wsHeaders=forwardHeaders(req.headers,{ websocket:true });
    // A valid no-extension negotiation keeps plaintext observable on both legs.
    // Native client offered compression; no extension is required by RFC6455.
    delete wsHeaders['sec-websocket-extensions'];
    const outgoing = request({ hostname:target.hostname, port:target.port || undefined, protocol:target.protocol,
      path, method:'GET', headers:wsHeaders });
    socket.on('error',() => { peer?.destroy(); outgoing.destroy(); finish(); });
    socket.on('close',() => { peer?.destroy(); outgoing.destroy(); finish(); });
    outgoing.on('upgrade',(response,upstreamSocket,upstreamHead) => {
      peer = upstreamSocket; row.upstream_status = response.statusCode;
      observation.connected();
      const headers = forwardHeaders(response.headers,{ websocket:true }); delete headers['set-cookie'];
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(headers).map(([k,v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
      peer.on('error',() => { socket.destroy(); finish(); });
      peer.on('close',() => { socket.destroy(); finish(); });
      const context=responseContext({selector,policy,headers:req.headers,inspect:(body,inventory,scope)=>inspect(body,inventory,scope,row.thread_sha256)});
      socket.on('close',()=>context.clear());
      const observer=websocketText({masked:false,rewrite:bytes=>{const completed=context.observe(bytes);if(completed)safeReceipt({...row,...completed,phase:'response_completed',message_sequence:sequence,observed_at:new Date().toISOString()});return bytes;},unsupported:()=>context.invalidate()});
      observer.on('error',()=>context.invalidate());observer.resume();
      peer.on('data',chunk=>observer.write(chunk));peer.on('close',()=>observer.end());
      if(upstreamHead.length){observer.write(upstreamHead);socket.write(upstreamHead);}
      const pendingWrites=new WeakMap();let messageRow,sequence=0;
      const transform=websocketText({masked:true,canPassthrough:()=>context.safeForOpaque(),rewrite:before=>{
        const prepared=context.prepare(before);
        messageRow=prepared.receipt?{...row,...prepared.receipt,phase:'message_forwarded',message_sequence:++sequence,observed_at:new Date().toISOString(),
          before_sha256:sha256(before),before_bytes:before.length,completed:false,upstream_body_written:false}:null;
        return prepared.payload;
      },forwarded:(wire,before,after)=>{if(messageRow){Object.assign(messageRow,{after_sha256:sha256(after),after_bytes:after.length});pendingWrites.set(wire,messageRow);messageRow=null;}}});
      const sink=new Writable({write(chunk,_encoding,done){peer.write(chunk,error=>{const sent=pendingWrites.get(chunk);if(!error&&sent)safeReceipt({...sent,upstream_body_written:true});done(error);});}});
      pipeline(transform,sink,error=>{if(error){row.reason=error.message==='context_chain_unavailable'?'context_chain_unavailable':'stream_interrupted';socket.destroy();peer.destroy();finish();}});
      if(head.length)transform.write(head);socket.pipe(transform);peer.pipe(socket);
    });
    outgoing.on('response',response => {
      row.upstream_status = response.statusCode; row.reason = 'websocket_rejected';
      response.resume(); socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'); finish();
    });
    outgoing.on('error',() => { socket.destroy(); finish(); });
    outgoing.end();
  });
  server.on('clientError',(_error,socket) => socket.destroy());
  return { server, clear:() => selector.clear(), async stop() {
    selector.clear(); for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [settingsPath] = process.argv.slice(2);
  try {
    const settings = JSON.parse(readFileSync(settingsPath,'utf8'));
    if (!Number.isInteger(settings.port) || settings.port < 1024 || settings.port > 65535) throw Error('invalid_port');
    const gateway = createMainGateway({ capability:settings.capability,
      policy:() => { try { return JSON.parse(readFileSync(settings.policy_path,'utf8')); } catch { return null; } },
      inspect:(body,inventory,scope,thread)=>{
        if(!scope||thread!==settings.inspect_once_thread_sha256)return;
        // Review classification metadata separately, without granting exclusion.
        const review={...body,input:body.input.map(item=>{const copy={...item};if(item.role==='assistant')delete copy.internal_chat_message_metadata_passthrough;return copy;})};
        const reviewable=mainInventory(review).groups.filter(g=>!g.protected);
        const candidates=inventory.groups.filter(g=>reviewable.some(r=>r.start===g.start&&r.end===g.end)).flatMap(g=>{
          const values=body.input.slice(g.start,g.end+1);
          if(!values.every(item=>item.role==='assistant'&&(item.type==='message'||item.type===undefined)))return [];
          return [{...g,text:values.map(item=>item.content.map(part=>part.text).join('\n')).join('\n'),
            metadata:values.map(item=>{const m=item.internal_chat_message_metadata_passthrough;return m?{keys:Object.keys(m).map(k=>['turn_id','create_time','content_item_kinds','cell_id','executed_tool_calls','tool_calls_complete'].includes(k)?k:'unknown'),classifications:m.content_item_kinds??null}:null;})}];
        });
        const snapshot={checked_at:new Date().toISOString(),thread_sha256:thread,scope_sha256:scope,
          input_sha256:inventory.input_sha256,item_hashes:inventory.item_hashes,groups:inventory.groups,candidates};
        const material=JSON.stringify(snapshot,null,2);
        if(secretSuspected(material,''))return;
        try{writeFileSync(resolve(dirname(settingsPath),'inventory-inspection.json'),material,{flag:'wx',mode:0o600});}catch{/* capture once; never overwrite */}
      },
      receipt:row => appendFileSync(settings.receipt_path,JSON.stringify(row)+'\n',{ mode:0o600 }) });
    gateway.server.listen(settings.port,'127.0.0.1',() => process.stdout.write('Jev gateway listening on loopback\n'));
    gateway.server.on('error',() => { process.stderr.write('Jev gateway unavailable\n'); process.exitCode = 1; });
    for (const signal of ['SIGINT','SIGTERM']) process.on(signal,async () => { await gateway.stop(); process.exit(); });
  } catch { process.stderr.write('Jev gateway configuration unavailable\n'); process.exitCode = 1; }
}
