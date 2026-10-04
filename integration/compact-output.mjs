import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

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
