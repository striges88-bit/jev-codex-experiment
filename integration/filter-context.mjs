import { contextBinding, sha256 } from './context-binding.mjs';
import { validate } from './schema.mjs';

// Created by the trusted local coordinator from the exact human-reviewed bytes.
// Nothing in a task, MCP result or persisted policy enables this process-local store.
export function createContextAuthorization(manifestBytes) {
  const manifest = JSON.parse(manifestBytes);
  const manifestHash = sha256(manifestBytes);
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw Error('invalid_manifest');
  const legacy = manifest.schema_version === 1 && manifest.threshold === 0.80 && Array.isArray(manifest.families) && manifest.families.length === 6;
  const real = manifest.schema_version === 2 && manifest.scenario === 'scoped_real_pilot' && manifest.threshold === 0.80;
  const families = legacy ? manifest.families : manifest.tasks;
  if (!legacy && (!real || !validRealManifest(manifest, manifestBytes))) throw Error('invalid_manifest');
  let enabled = false, revision = 1, approvalId = null;
  return {
    authorize({ approval_id, material_approved, privacy_accepted, provenance_verified }) {
      if (typeof approval_id !== 'string' || !/^[A-Za-z0-9_.:-]{1,64}$/.test(approval_id) ||
          material_approved !== true || privacy_accepted !== true || provenance_verified !== true) throw Error('approval_required');
      approvalId = approval_id; revision++; enabled = true;
    },
    revoke() { enabled = false; revision++; },
    current(task, context) {
      try {
        if (!enabled) return null;
        const binding = contextBinding(task, context);
        const family = families.find(row => row.binding_sha256 === binding);
        if (!family || family.task_sha256 !== sha256(JSON.stringify(task)) || family.fragments.length !== context.length ||
            !context.every((row, index) => {
              const frozen = family.fragments[index];
              return frozen.id === row.id && frozen.kind === row.kind && frozen.protected === row.protected && frozen.text_sha256 === sha256(row.text);
            })) return null;
        const policy = { approval_id: approvalId, revision, manifest_sha256: manifestHash, binding_sha256: binding,
          threshold: 0.80, allowed_fragment_ids: structuredClone(family.allowed_fragment_ids) };
        return structuredClone(policy);
      } catch { return null; }
    },
  };
}

// V2 is a separate bounded contract. V1 frozen six-family bytes keep their semantics.
function validRealManifest(manifest, bytes) {
  const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
  const id = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(value);
  const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const unique = values => new Set(values).size === values.length;
  const rows = manifest.tasks;
  return Buffer.byteLength(bytes) <= 65536 && exact(manifest,['schema_version','scenario','threshold','tasks']) &&
    Array.isArray(rows) && rows.length >= 1 && rows.length <= 2 &&
    rows.every(row => exact(row,['id','task_sha256','binding_sha256','fragments','allowed_fragment_ids']) &&
      id(row.id) && hash(row.task_sha256) && hash(row.binding_sha256) &&
      Array.isArray(row.fragments) && row.fragments.length >= 3 && row.fragments.length <= 64 &&
      row.fragments.every(fragment => exact(fragment,['id','kind','protected','text_sha256']) &&
        id(fragment.id) && hash(fragment.text_sha256) && typeof fragment.protected === 'boolean' &&
        ['instruction','requirement','unfinished','reference'].includes(fragment.kind) &&
        (fragment.kind === 'reference' || fragment.protected)) &&
      ['instruction','requirement','unfinished'].every(kind => row.fragments.some(fragment => fragment.kind === kind && fragment.protected)) &&
      unique(row.fragments.map(fragment => fragment.id)) &&
      Array.isArray(row.allowed_fragment_ids) && row.allowed_fragment_ids.length <= 64 && unique(row.allowed_fragment_ids) &&
      row.allowed_fragment_ids.every(value => id(value) && row.fragments.some(fragment => fragment.id === value && fragment.kind === 'reference' && !fragment.protected))) &&
    unique(rows.map(row => row.id)) && unique(rows.map(row => row.binding_sha256)) && unique(rows.map(row => row.task_sha256));
}

const profileValid = choice => choice?.schema_version === 1 && choice.status === 'selected' && choice.fallback === null &&
  ((choice.profile?.id === 'luna_max' && choice.profile.model === 'gpt-6-luna' && choice.profile.effort === 'max') ||
   (choice.profile?.id === 'sol_low' && choice.profile.model === 'gpt-6.1-sol' && choice.profile.effort === 'low'));

export async function prepareContextDispatch({ client, subtask_id, task, context, choice, authorization, ownerActive }) {
  choice = structuredClone(choice);
  const original = structuredClone(context), boundedTask = structuredClone(task);
  const binding = contextBinding(boundedTask, original);
  let policy = null, result = null, reason = 'authorization_unavailable', proposed = original;
  try {
    policy = authorization?.current(boundedTask, original);
    const args = { schema_version: 1, subtask_id, task: boundedTask, context: original, policy };
    if (!policy || validate('jev_filter_context', args, '') || !profileValid(choice) || choice.subtask_id !== subtask_id || ownerActive?.() !== true) throw Error('preflight');
    result = await client.call('jev_filter_context', structuredClone(args));
    const rows = result?.recommendations;
    if (result?.schema_version !== 1 || result.subtask_id !== subtask_id || result.status !== 'filter_complete' || result.mode !== 'opt_in' ||
        result.threshold !== 0.80 || result.applied !== false || result.context_action !== 'select_allowed' || result.fallback !== null ||
        result.binding_sha256 !== binding || result.policy_revision !== policy.revision || !Array.isArray(rows) || rows.length !== original.length ||
        !rows.every((row, index) => {
          const fragment = original[index];
          if (row.fragment_id !== fragment.id || row.protected !== fragment.protected) return false;
          if (fragment.protected) return row.p_unneeded === null && row.decision === 'protected';
          const p = row.p_unneeded;
          if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1) return false;
          const excluded = policy.allowed_fragment_ids.includes(fragment.id) && p >= 0.80;
          return row.decision === (excluded ? 'would_exclude' : 'keep');
        })) throw Error('invalid_result');
    proposed = original.filter((fragment, index) => rows[index].decision !== 'would_exclude');
    reason = 'filter_complete';
  } catch { proposed = original; reason = result?.fallback?.code ? 'filter_fallback' : 'preserve_full'; }
  // No filtered copy is exposed as dispatch authority. Revoke is checked inside
  // the synchronous callback immediately before invoking the native adapter.
  let dispatched = false;
  return {
    status: reason, result: structuredClone(result),
    dispatch(callback) {
      if (dispatched) throw Error('dispatch_already_used');
      dispatched = true;
      let stillAuthorized = false;
      try {
        stillAuthorized = reason === 'filter_complete' && profileValid(choice) && choice.subtask_id === subtask_id && ownerActive?.() === true &&
          JSON.stringify(authorization?.current(boundedTask, original)) === JSON.stringify(policy);
      } catch { /* unknown authority preserves original context */ }
      const selected = stillAuthorized ? proposed : original;
      const kept = new Set(selected.map(row => row.id));
      const receipt = {
        schema_version: 1, applied: selected.length < original.length,
        reason: stillAuthorized ? reason : 'preserve_full', binding_sha256: binding,
        subtask_id, mode: stillAuthorized ? 'opt_in' : 'full',
        approval_sha256: policy?.approval_id ? sha256(policy.approval_id) : null,
        manifest_sha256: policy?.manifest_sha256 ?? null, policy_revision: policy?.revision ?? null,
        selected_profile: profileValid(choice) ? structuredClone(choice.profile) : null,
        launch_context_sha256: contextBinding(boundedTask, selected),
        kept: selected.map(row => ({ id: row.id, text_sha256: sha256(row.text) })),
        excluded: original.filter(row => !kept.has(row.id)).map(row => ({ id: row.id, text_sha256: sha256(row.text),
          p_unneeded: result.recommendations.find(value => value.fragment_id === row.id).p_unneeded })),
        actual_profile: null, native_runtime_ms: null, cost_usd: null,
        measured: result?.measured ? Object.fromEntries(['jev_requests','jev_latency_ms','input_tokens','output_tokens'].map(key => [key,
          typeof result.measured[key] === 'number' && Number.isFinite(result.measured[key]) && result.measured[key] >= 0 ? result.measured[key] : null])) : null,
        budget: result?.budget ? Object.fromEntries(['requests_used','wait_ms_used','requests_remaining','wait_ms_remaining'].map(key => [key,
          typeof result.budget[key] === 'number' && Number.isFinite(result.budget[key]) && result.budget[key] >= 0 ? result.budget[key] : null])) : null,
      };
      return callback({ task: structuredClone(boundedTask), context: structuredClone(selected), receipt });
    },
  };
}
