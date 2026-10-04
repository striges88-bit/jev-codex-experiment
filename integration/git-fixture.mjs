import {mkdir,writeFile,mkdtemp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const hash=bytes=>createHash('sha1').update(bytes).digest();
// Finite Git object/index fixture built with filesystem writes only. No Git
// mutation commands. DIRC v2 entries, loose objects, known literal HEAD tree.
export async function fixture(kind='clean'){
  const root=await mkdtemp(join(tmpdir(),'jev-git18-'));
  await mkdir(join(root,'.git/objects'),{recursive:true});await mkdir(join(root,'.git/refs/heads'),{recursive:true});
  async function object(type,body){
    const bytes=Buffer.concat([Buffer.from(`${type} ${body.length}\0`),body]),id=hash(bytes),hex=id.toString('hex');
    await mkdir(join(root,'.git/objects',hex.slice(0,2)),{recursive:true});
    await writeFile(join(root,'.git/objects',hex.slice(0,2),hex.slice(2)),deflateSync(bytes));return id;
  }
  const names=['delete.txt','modify.txt','rename.txt'];
  const blobs=new Map();for(const name of names)blobs.set(name,await object('blob',Buffer.from(`${name} baseline\n`)));
  const tree=await object('tree',Buffer.concat(names.map(name=>Buffer.concat([Buffer.from(`100644 ${name}\0`),blobs.get(name)]))));
  const commit=await object('commit',Buffer.from(`tree ${tree.toString('hex')}\nauthor Fixture <fixture@example.invalid> 0 +0000\ncommitter Fixture <fixture@example.invalid> 0 +0000\n\nfinite fixture\n`));
  await writeFile(join(root,'.git/HEAD'),'ref: refs/heads/main\n');await writeFile(join(root,'.git/refs/heads/main'),commit.toString('hex')+'\n');
  await writeFile(join(root,'.git/config'),'[core]\nrepositoryformatversion = 0\nbare = false\nfilemode = false\nautocrlf = false\n');
  let indexNames=names.map(name=>({name,id:blobs.get(name),stage:0}));
  if(kind==='dirty')indexNames=[{name:'modify.txt',id:await object('blob',Buffer.from('staged replacement\n')),stage:0},{name:'renamed 🦉 → target.txt',id:blobs.get('rename.txt'),stage:0}];
  if(kind==='conflict')indexNames=names.flatMap(name=>name==='modify.txt'?[1,2,3].map(stage=>({name,id:blobs.get(name),stage})):[{name,id:blobs.get(name),stage:0}]);
  indexNames.sort((a,b)=>Buffer.compare(Buffer.from(a.name),Buffer.from(b.name))||a.stage-b.stage);
  const header=Buffer.alloc(12);header.write('DIRC');header.writeUInt32BE(2,4);header.writeUInt32BE(indexNames.length,8);
  const entries=indexNames.map(({name,id,stage})=>{
    const path=Buffer.from(name),bytes=Buffer.alloc(Math.ceil((62+path.length+1)/8)*8);
    bytes.writeUInt32BE(0o100644,24);id.copy(bytes,40);bytes.writeUInt16BE(path.length|(stage<<12),60);path.copy(bytes,62);return bytes;
  });
  const index=Buffer.concat([header,...entries]);await writeFile(join(root,'.git/index'),Buffer.concat([index,hash(index)]));
  for(const name of names)if(!(kind==='dirty'&&['delete.txt','rename.txt'].includes(name)))await writeFile(join(root,name),name==='modify.txt'&&kind==='dirty'?'working replacement\n':`${name} baseline\n`);
  if(kind==='dirty'){
    await writeFile(join(root,'renamed 🦉 → target.txt'),'rename.txt baseline\n');
    await writeFile(join(root,'-new 日本語 🦉.txt'),'untracked\n');
    await mkdir(join(root,'nested space'));await writeFile(join(root,'nested space','child.txt'),'untracked child\n');
  }
  return root;
}
export const expectedDirty=[{xy:'D ',path:'delete.txt',orig_path:null},{xy:'MM',path:'modify.txt',orig_path:null},
  {xy:'R ',path:'renamed 🦉 → target.txt',orig_path:'rename.txt'},{xy:'??',path:'-new 日本語 🦉.txt',orig_path:null},
  {xy:'??',path:'nested space/child.txt',orig_path:null}];
