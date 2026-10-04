import http from 'node:http';
import {once} from 'node:events';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createMainGateway} from './main-gateway.mjs';

// Finite, offline log source. Destination and disabled policy are fixed here.
// Await every write callback: safeReceipt deliberately suppresses exceptions.
export async function produceGatewayLogs({write=bytes=>new Promise((done,reject)=>{
  process.stdout.write(bytes,error=>error?reject(error):done());
})}={}) {
  const capability='a'.repeat(32),writes=[];
  let terminal,writerError;
  const completed=new Promise(done=>{terminal=done;});
  const upstream=http.createServer((_req,res)=>res.writeHead(200,{'content-type':'application/json'}).end('{"models":[]}'));
  let gateway;
  const timer=setTimeout(()=>{upstream.closeAllConnections();gateway?.server.closeAllConnections();},10000);
  try{
    upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
    gateway=createMainGateway({capability,policy:()=>null,testUpstream:true,
      upstream:`http://127.0.0.1:${upstream.address().port}`,receipt:row=>{
        try{writes.push(Promise.resolve(write(JSON.stringify(row)+'\n')).catch(error=>{writerError??=error;}));}
        catch(error){writerError??=error;}
        if(row.phase==='terminal')terminal(row);
      }});
    gateway.server.listen(0,'127.0.0.1');await once(gateway.server,'listening');
    await new Promise((done,reject)=>{
      http.get(`http://127.0.0.1:${gateway.server.address().port}/jev/${capability}/backend-api/codex/models`,{agent:false},res=>{
        res.resume();res.on('error',reject);res.on('aborted',()=>reject(Error('response_incomplete')));
        res.on('end',()=>res.complete&&res.statusCode===200?done():reject(Error('response_failed')));
      }).on('error',reject);
    });
    const row=await completed;
    await Promise.all(writes);
    if(writerError)throw writerError;
    if(!row.completed||!row.upstream_body_written||row.upstream_status!==200)throw Error('terminal_incomplete');
  }finally{
    clearTimeout(timer);
    if(gateway)await gateway.stop();
    upstream.closeAllConnections();await new Promise(done=>upstream.close(done));
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const args=process.argv.slice(2);
    if(args.length && !(args.length===1&&['--diagnostic','--unexpected-record','--invalid-utf8'].includes(args[0])))throw Error('unsupported_arguments');
    // Explicit offline negative control. Never classified as successful logs.
    if(args[0]==='--diagnostic')process.stderr.write('unknown warning 🦉\n');
    if(args[0]==='--unexpected-record')process.stdout.write('unexpected 日本語 🦉\n');
    if(args[0]==='--invalid-utf8')process.stdout.write(Buffer.from([255,254]));
    await produceGatewayLogs();
  }catch(error){process.stderr.write(`log producer: ${error.code??error.message}\n`);process.exitCode=1;}
}
