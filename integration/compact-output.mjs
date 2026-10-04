import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, lstat, open, link, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

const magic = Buffer.from('JEV-ORIGINAL-1\n');
const occurrence = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// A trusted task-local store. Hardlink publication is atomic and refuses an
// existing final name, including on Windows; unsupported filesystems fail full.
// Only staging files are removed. Published originals have no automatic GC.
export function createOriginalStore(artifactDir) {
  const root = resolve(artifactDir);
  return {
    async publish({ stdout, stderr, provenance }) {
      if (!occurrence.test(provenance.run_id)) throw Error('original_id');
      await mkdir(root,{ recursive:true });
      if ((await lstat(root)).isSymbolicLink()) throw Error('artifact_symlink');
      const metadata = Buffer.from(JSON.stringify({ schema_version:1,provenance,
        stdout_bytes:stdout.length,stderr_bytes:stderr.length }));
      const size = Buffer.alloc(4); size.writeUInt32BE(metadata.length);
      const bytes = Buffer.concat([magic,size,metadata,stdout,stderr]);
      const path = join(root,`${provenance.run_id}.original`);
      const staging = join(root,`${provenance.run_id}.${randomUUID()}.staging`);
      let writer;
      try {
        writer = await open(staging,'wx',0o600);
        await writer.writeFile(bytes);
        await writer.close(); writer = null;
        await link(staging,path);
        const reference = { schema_version:1,id:provenance.run_id,path,
          sha256:digest(bytes),bytes:bytes.length,
          stdout:{ bytes:stdout.length,sha256:digest(stdout) },
          stderr:{ bytes:stderr.length,sha256:digest(stderr) } };
        await this.read(reference);
        return reference;
      } finally {
        if (writer) await writer.close();
        await unlink(staging).catch(() => {});
      }
    },
    async read(reference) {
      if (reference?.schema_version !== 1 || !occurrence.test(reference.id) ||
          reference.path !== join(root,`${reference.id}.original`)) throw Error('original_reference');
      if ((await lstat(reference.path)).isSymbolicLink()) throw Error('original_symlink');
      const bytes = await readFile(reference.path);
      if (bytes.length !== reference.bytes || digest(bytes) !== reference.sha256 ||
          !bytes.subarray(0,magic.length).equals(magic)) throw Error('original_mismatch');
      const start = magic.length+4, end = start+bytes.readUInt32BE(magic.length);
      const metadata = JSON.parse(bytes.subarray(start,end).toString('utf8'));
      if (metadata.schema_version !== 1 || metadata.provenance?.run_id !== reference.id ||
          !Number.isSafeInteger(metadata.stdout_bytes) || metadata.stdout_bytes < 0 ||
          !Number.isSafeInteger(metadata.stderr_bytes) || metadata.stderr_bytes < 0 ||
          end+metadata.stdout_bytes+metadata.stderr_bytes !== bytes.length) throw Error('original_metadata');
      const stdout=bytes.subarray(end,end+metadata.stdout_bytes),stderr=bytes.subarray(end+metadata.stdout_bytes);
      for (const [name,value] of [['stdout',stdout],['stderr',stderr]]) {
        if (value.length !== reference[name]?.bytes || digest(value) !== reference[name]?.sha256) throw Error('original_stream');
      }
      return {stdout,stderr,provenance:metadata.provenance};
    }
  };
}

// Explicit caller selection, never an automatic hook or silent result truncation.
// A write/selector failure returns full original data and no false artifact claim.
export async function compactToolOutput({ output, artifactDir, select }) {
  let path = null;
  try {
    const bytes = Buffer.isBuffer(output) ? output : Buffer.from(typeof output === 'string' ? output : JSON.stringify(output));
    await mkdir(artifactDir,{ recursive:true });
    // The caller supplies the trusted task artifact directory. Windows sandbox
    // can deny realpath on accessible paths; exclusive writes need no traversal.
    const root = resolve(artifactDir);
    if ((await lstat(root)).isSymbolicLink()) throw Error('artifact_symlink');
    path = join(root,`${randomUUID()}.tool-output`);
    await writeFile(path,bytes,{ flag:'wx', mode:0o600 });
    if (digest(await readFile(path)) !== digest(bytes)) throw Error('artifact_mismatch');
    const evidence = await select(output);
    if (evidence === undefined) throw Error('selection_unavailable');
    return { schema_version:1, status:'compact', evidence, selection:'explicit_partial_view',
      original:{ path, sha256:digest(bytes), bytes:bytes.length } };
  } catch { return { schema_version:1, status:'full', output, artifact:path, reason:'compact_unavailable' }; }
}

export function testEvidence(output, exitCode = null) {
  const text = String(output);
  // Failures retain the complete log, including diagnostics and stack traces.
  // Unknown test dialect/counts also returns full instead of guessing success.
  if ((Number.isInteger(exitCode) && exitCode !== 0) || /^not ok\b/m.test(text) || /^[#ℹ] fail [1-9]/m.test(text) || /^✖/m.test(text)) return { status:'failed', command_exit_code:exitCode, complete_log:text };
  const counts = Object.fromEntries([...text.matchAll(/^[#ℹ] (tests|pass|fail|cancelled|skipped|todo) (\d+)\r?$/gm)].map(m => [m[1],Number(m[2])]));
  if (!Number.isSafeInteger(counts.tests) || counts.fail !== 0 || counts.cancelled !== 0 || counts.pass + (counts.skipped ?? 0) + (counts.todo ?? 0) !== counts.tests) return { status:'unknown', complete_log:text };
  return { status:exitCode === 0 ? 'passed' : 'reported_passed', command_exit_code:exitCode, ...counts };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [input,artifactDir,rawExit] = process.argv.slice(2);
  if (!input || !artifactDir || (rawExit !== undefined && !/^\d{1,3}$/.test(rawExit))) { process.stderr.write('Usage: node integration/compact-output.mjs TEST_LOG ARTIFACT_DIR [COMMAND_EXIT_CODE]\n'); process.exitCode = 2; }
  else {
    const output = await readFile(input,'utf8');
    const result = await compactToolOutput({ output,artifactDir,select:value => testEvidence(value,rawExit === undefined ? null : Number(rawExit)) });
    process.stdout.write(JSON.stringify(result) + '\n');
  }
}
