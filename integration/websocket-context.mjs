import { Transform } from 'node:stream';
import { randomBytes } from 'node:crypto';

// RFC6455 text-message boundary. No context size cap. Unsupported wire forms
// switch to byte-exact passthrough; they never become partially rewritten JSON.
export function encodeTextFrame(payload,masked) {
    const head=Buffer.alloc(payload.length<126?2:payload.length<65536?4:10);head[0]=0x81;
    if(payload.length<126)head[1]=payload.length;
    else if(payload.length<65536){head[1]=126;head.writeUInt16BE(payload.length,2);}
    else{head[1]=127;head.writeBigUInt64BE(BigInt(payload.length),2);}
    if(!masked)return Buffer.concat([head,payload]);
    head[1]|=128;const key=randomBytes(4), encoded=Buffer.from(payload);
    for(let i=0;i<encoded.length;i++)encoded[i]^=key[i%4];
    return Buffer.concat([head,key,encoded]);
}
export function websocketText({ masked, rewrite = value => value, forwarded = () => {}, unsupported=()=>{}, canPassthrough=()=>true }) {
  let buffer=Buffer.alloc(0), fragments=[], payloads=[], opaque=false;
  const frame = payload => encodeTextFrame(payload,masked);
  return new Transform({
    async transform(chunk,_encoding,done) {
      const preserve = () => {unsupported();if(!canPassthrough())throw Error('context_chain_unavailable');opaque=true;this.push(Buffer.concat([...fragments,buffer]));buffer=Buffer.alloc(0);fragments=[];payloads=[];};
      if(opaque){this.push(chunk);done();return;}
      buffer=Buffer.concat([buffer,chunk]);
      try {
        while(buffer.length>=2){
          const fin=Boolean(buffer[0]&128),opcode=buffer[0]&15,isMasked=Boolean(buffer[1]&128);
          let length=buffer[1]&127,offset=2;
          if(length===126){if(buffer.length<4)break;length=buffer.readUInt16BE(2);offset=4;if(length<126){preserve();break;}}
          else if(length===127){if(buffer.length<10)break;const wide=buffer.readBigUInt64BE(2);if(wide>BigInt(Number.MAX_SAFE_INTEGER)||wide<65536n){preserve();break;}length=Number(wide);offset=10;}
          if((buffer[0]&112)||isMasked!==masked||![0,1,2,8,9,10].includes(opcode)||(opcode>=8&&(!fin||length>125))){preserve();break;}
          const keyOffset=offset;if(isMasked)offset+=4;
          if(buffer.length<offset+length)break;
          const wire=buffer.subarray(0,offset+length);buffer=buffer.subarray(offset+length);
          // An interleaved control abandons selection for this connection, so
          // ping/close is immediate and even the original frame order is kept.
          if(opcode>=8){if(fragments.length){buffer=Buffer.concat([wire,buffer]);preserve();break;}this.push(wire);continue;}
          if(opcode===2||(opcode===0&&!fragments.length)||(opcode===1&&fragments.length)){buffer=Buffer.concat([wire,buffer]);preserve();break;}
          const payload=Buffer.from(wire.subarray(offset));
          if(isMasked)for(let i=0;i<payload.length;i++)payload[i]^=wire[keyOffset+i%4];
          fragments.push(wire);payloads.push(payload);
          if(!fin)continue;
          const before=Buffer.concat(payloads), original=Buffer.concat(fragments);
          let after;try{after=await rewrite(before);}catch{if(!canPassthrough())throw Error('context_chain_unavailable');after=before;}
          if(after===null){done(Error('context_chain_unavailable'));return;}
          if(!Buffer.isBuffer(after))after=before;
          const outgoing=after.equals(before)?original:frame(after);
          forwarded(outgoing,before,after,original);this.push(outgoing);fragments=[];payloads=[];
        }
        done();
      }catch(error){done(error);}
    },
    flush(done){if(fragments.length||buffer.length){if(!canPassthrough()){done(Error('context_chain_unavailable'));return;}this.push(Buffer.concat([...fragments,buffer]));}done();}
  });
}
