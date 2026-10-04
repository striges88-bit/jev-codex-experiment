import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createOriginalStore } from './compact-output.mjs';
import {captureCompleted,compactCompleted,receivedStream} from './completed-output.mjs';

export const testOutputProfile = 'node-spec-flat-v1';
const decoder = () => new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const decimal = '(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?';
const record = new RegExp(`^✔ (.+) \\((`+decimal+`)ms\\)$`);
const keys = ['tests','suites','pass','fail','cancelled','skipped','todo','duration_ms'];

// Entire grammar, not a totals scan. Any extra/missing line closes the gate.
export function parseNodeSpec(stdout) {
  const text = decoder().decode(stdout);
  const crlf = text.includes('\r');
  if (!text.endsWith('\n') || (crlf && /(?<!\r)\n|\r(?!\n)/.test(text))) throw Error('unsupported_format');
  const lines = text.slice(0,crlf?-2:-1).split(crlf?'\r\n':'\n');
  const rows = lines.slice(0,-keys.length),summary = lines.slice(-keys.length);
  if (!rows.length) throw Error('missing_records');
  const records = rows.map(line => {
    const match = record.exec(line);
    if (!match || /[\x00-\x1f\x7f]/.test(match[1]) || !Number.isFinite(Number(match[2]))) throw Error('unsupported_record');
    return {name:match[1],duration_ms:Number(match[2])};
  });
  const counts = {};
  for (const [index,key] of keys.entries()) {
    const number = key === 'duration_ms' ? decimal : '(?:0|[1-9][0-9]*)';
    const match = new RegExp(`^ℹ ${key} (${number})$`).exec(summary[index] ?? '');
    if (!match || !Number.isFinite(Number(match[1]))) throw Error('unsupported_summary');
    counts[key] = Number(match[1]);
    if (key !== 'duration_ms' && !Number.isSafeInteger(counts[key])) throw Error('invalid_counts');
  }
  if (counts.tests !== records.length || counts.pass !== counts.tests ||
      ['suites','fail','cancelled','skipped','todo'].some(key=>counts[key] !== 0)) throw Error('inconsistent_counts');
  const {duration_ms,...totals}=counts;
  return {records,counts:totals,duration_ms};
}

// Public fixed test command and existing output contract remain unchanged.
export const captureNodeTests = options => captureCompleted({...options,profile:testOutputProfile});
export const compactCompletedTests = options => compactCompleted({...options,profile:testOutputProfile,
  parse:parseNodeSpec,select:evidence=>({counts:evidence.counts,duration_ms:evidence.duration_ms,diagnostics:[]})});

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [command,target,...files]=process.argv.slice(2);
    let result;
    if (command === 'run' && target && files.length) {
      const capture=await captureNodeTests({files});
      result=await compactCompletedTests({capture,artifactDir:target});
      process.exitCode=capture.provenance.exit_code === 0 && !capture.provenance.error &&
        !capture.provenance.cancelled && !capture.provenance.timed_out ? 0 : 1;
    } else if(command === 'read' && target && !files.length) {
      const reference=JSON.parse(await readFile(target,'utf8'));
      const {dirname}=await import('node:path');
      const original=await createOriginalStore(dirname(reference.path)).read(reference);
      result={id:reference.id,provenance:original.provenance,
        stdout:receivedStream(original.stdout),stderr:receivedStream(original.stderr)};
    } else throw Error('Usage: node integration/test-output.mjs run ARTIFACT_DIR FILE.test.mjs... | read REFERENCE.json');
    process.stdout.write(JSON.stringify(result)+'\n');
  } catch(error) {process.stderr.write(error.message+'\n');process.exitCode=2;}
}
