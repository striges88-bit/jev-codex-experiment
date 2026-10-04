import test from 'node:test';
import assert from 'node:assert/strict';
import { websocketText } from './websocket-context.mjs';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

function wire(text,{opcode=1,fin=true,rsv=0}={}){
  const bytes=Buffer.from(text),key=Buffer.from([11,22,33,44]);
  const header=Buffer.alloc(bytes.length<126?2:bytes.length<65536?4:10);
  header[0]=(fin?128:0)|rsv|opcode;
  if(bytes.length<126)header[1]=128|bytes.length;
  else if(bytes.length<65536){header[1]=254;header.writeUInt16BE(bytes.length,2);}
  else{header[1]=255;header.writeBigUInt64BE(BigInt(bytes.length),2);}
  const masked=Buffer.from(bytes);for(let i=0;i<masked.length;i++)masked[i]^=key[i%4];
  return Buffer.concat([header,key,masked]);
}
async function transform(chunks,rewrite=value=>value){
  const stream=websocketText({masked:true,rewrite}),out=[];stream.on('data',chunk=>out.push(chunk));
  const done=new Promise((resolve,reject)=>{stream.on('end',resolve);stream.on('error',reject);});
  for(const chunk of chunks)stream.write(chunk);stream.end();await done;return Buffer.concat(out);
}
function payload(frame){
  const length=frame[1]&127,offset=length===126?4:length===127?10:2;
  const key=frame.subarray(offset,offset+4),bytes=Buffer.from(frame.subarray(offset+4));
  for(let i=0;i<bytes.length;i++)bytes[i]^=key[i%4];return bytes;
}

test('fragmented text and split TCP headers are rewritten as one masked message',async()=>{
  const first=wire('old ',{fin:false}),last=wire('reference',{opcode:0});
  const chunks=[first.subarray(0,1),first.subarray(1,4),first.subarray(4),last.subarray(0,3),last.subarray(3)];
  let read;const selected=await transform(chunks,bytes=>{read=bytes.toString();return Buffer.from('selected');});
  assert.equal(read,'old reference');assert.equal(selected[0],129);assert.equal(selected[1]&128,128);assert.equal(payload(selected).toString(),'selected');
});
test('large UTF8 input has no 64KB cap and unchanged frames retain exact bytes',async()=>{
  const original=wire('Я'.repeat(80000));const chunks=[];for(let i=0;i<original.length;i+=7919)chunks.push(original.subarray(i,i+7919));
  assert.deepEqual(await transform(chunks),original);
  const changed=await transform(chunks,bytes=>Buffer.concat([bytes,Buffer.from('!')]));
  assert.equal(payload(changed).toString(),'Я'.repeat(80000)+'!');
});
test('interleaved ping, binary, RSV compression, invalid masking and incomplete frames stay byte exact',async()=>{
  const control=Buffer.concat([wire('a',{fin:false}),wire('ping',{opcode:9}),wire('b',{opcode:0})]);
  const unmasked=Buffer.from([129,1,65]);
  for(const original of [control,wire('binary',{opcode:2}),wire('compressed',{rsv:64}),unmasked,Buffer.from([129,254,0])]){
    let rewritten=false;assert.deepEqual(await transform([original],()=>{rewritten=true;return Buffer.from('changed');}),original);assert.equal(rewritten,false);
  }
});
test('unsupported text after filtered state closes before forwarding a partial continuation',async()=>{
  const stream=websocketText({masked:true,canPassthrough:()=>false}),out=[];stream.on('data',value=>out.push(value));
  const failure=new Promise(resolve=>stream.on('error',resolve));stream.end(wire('unknown',{rsv:64}));
  assert.equal((await failure).message,'context_chain_unavailable');assert.equal(out.length,0);
});

test('incomplete close and rewrite error after selection forward no hidden-prefix continuation',async()=>{
  for(const [bytes,rewrite]of [[Buffer.from([129,254,0]),value=>value],[wire('delta'),()=>{throw Error('inspection failed');}]]){
    const stream=websocketText({masked:true,canPassthrough:()=>false,rewrite}),out=[];stream.on('data',value=>out.push(value));
    const error=new Promise(resolve=>stream.on('error',resolve));stream.end(bytes);
    assert.equal((await error).message,'context_chain_unavailable');assert.equal(out.length,0);
  }
});
test('slow downstream preserves multiple large messages in order with stream backpressure',async()=>{
  const inputs=Array.from({length:10},(_,i)=>wire(`${i}:`+'x'.repeat(70000))),actual=[];
  const sink=new Writable({highWaterMark:1024,write(chunk,_encoding,done){actual.push(Buffer.from(chunk));setTimeout(done,2);}});
  await pipeline(Readable.from(inputs),websocketText({masked:true}),sink);
  assert.deepEqual(Buffer.concat(actual),Buffer.concat(inputs));
});
