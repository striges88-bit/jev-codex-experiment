import { contextBinding } from './context-binding.mjs';

const string = { type: 'string', minLength: 1 };
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const version = { type: 'integer', const: 1 };
const id = { type: 'string', pattern: '^[a-f0-9]{32}$' };
export const schemas = {
  jev_begin_subtask: object({ schema_version: version }),
  jev_choice: object({ schema_version: version, subtask_id: id,
    task: object({ goal: string, scope: string, done_when: string }),
    context: { type: 'array', maxItems: 64, items: object({ id: { type: 'string', pattern: '^[A-Za-z0-9_.:-]{1,64}$' }, text: string, protected: { type: 'boolean' } }) },
  }),
  jev_end_subtask: object({ schema_version: version, subtask_id: id }),
};
schemas.jev_shadow_filter = object({
  schema_version: version, subtask_id: id, task: schemas.jev_choice.properties.task,
  context: { type: 'array', maxItems: 64, items: object({
    ...schemas.jev_choice.properties.context.items.properties,
    kind: { type: 'string', enum: ['instruction', 'requirement', 'unfinished', 'reference'] },
  }) },
});
schemas.jev_evaluate = object({
  ...schemas.jev_shadow_filter.properties,
  material: object({answer:string, baseline:{type:['string','null'],minLength:1},
    diff:{type:['string','null'],minLength:1}, checks:{type:['string','null'],minLength:1}}),
});
schemas.jev_filter_context = object({
  ...schemas.jev_shadow_filter.properties,
  policy: object({
    approval_id: { type: 'string', pattern: '^[A-Za-z0-9_.:-]{1,64}$' },
    revision: { type: 'integer', minimum: 1 },
    manifest_sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    binding_sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    threshold: { type: 'number', const: 0.80 },
    allowed_fragment_ids: { type: 'array', maxItems: 64, uniqueItems: true, items: { type: 'string', pattern: '^[A-Za-z0-9_.:-]{1,64}$' } },
  }),
});
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const secret = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:ghp_|github_pat_|sk-)[A-Za-z0-9_-]{20,}|\bBearer\s+\S+|\b(?:api[_-]?key|password|passwd|secret|token|authorization|cookie|credential)\s*[:=]\s*\S+/i;
export const secretSuspected = (text, apiKey) => secret.test(text) || Boolean(apiKey && text.includes(apiKey));
export function validate(name, args, apiKey) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return 'invalid_request';
  if (args.schema_version !== 1) return 'unsupported_schema';
  const required = schemas[name]?.required;
  if (!required || !exact(args, required)) return 'invalid_request';
  const encoded = JSON.stringify(args);
  if (Buffer.byteLength(encoded) > 12000) return 'input_limit';
  if (name === 'jev_begin_subtask') return null;
  if (typeof args.subtask_id === 'string' && apiKey && args.subtask_id.includes(apiKey)) return 'secret_suspected';
  if (typeof args.subtask_id !== 'string' || !/^[a-f0-9]{32}$/.test(args.subtask_id)) return 'invalid_request';
  if (name === 'jev_end_subtask') return null;
  if (!exact(args.task, ['goal', 'scope', 'done_when']) || !Object.values(args.task).every(nonempty) ||
      !Array.isArray(args.context) || args.context.length > 64) return 'invalid_request';
  if (Object.values(args.task).some(value => Buffer.byteLength(value) > 2048)) return 'input_limit';
  const seen = new Set(), texts = Object.values(args.task);
  for (const item of args.context) {
    if (!exact(item, ['jev_shadow_filter','jev_evaluate','jev_filter_context'].includes(name) ? ['id', 'text', 'protected', 'kind'] : ['id', 'text', 'protected']) || typeof item.id !== 'string' || !/^[A-Za-z0-9_.:-]{1,64}$/.test(item.id) ||
        seen.has(item.id) || !nonempty(item.text) || typeof item.protected !== 'boolean') return 'invalid_request';
    seen.add(item.id); texts.push(item.id, item.text);
    if (['jev_shadow_filter','jev_evaluate','jev_filter_context'].includes(name) && (!['instruction', 'requirement', 'unfinished', 'reference'].includes(item.kind) ||
        (item.kind !== 'reference' && !item.protected))) return 'invalid_request';
  }
  if (name === 'jev_filter_context') {
    const policy = args.policy;
    if (!exact(policy, ['approval_id','revision','manifest_sha256','binding_sha256','threshold','allowed_fragment_ids']) ||
        typeof policy.approval_id !== 'string' || !/^[A-Za-z0-9_.:-]{1,64}$/.test(policy.approval_id) ||
        !Number.isSafeInteger(policy.revision) || policy.revision < 1 || policy.threshold !== 0.80 ||
        ![policy.manifest_sha256,policy.binding_sha256].every(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) ||
        !Array.isArray(policy.allowed_fragment_ids) || policy.allowed_fragment_ids.length > 64 ||
        new Set(policy.allowed_fragment_ids).size !== policy.allowed_fragment_ids.length ||
        !policy.allowed_fragment_ids.every(id => args.context.some(item => item.id === id && !item.protected && item.kind === 'reference'))) return 'invalid_policy';
    if (secretSuspected(encoded,apiKey)) return 'secret_suspected';
    if (policy.binding_sha256 !== contextBinding(args.task,args.context)) return 'binding_mismatch';
  }
  if (name === 'jev_evaluate') {
    if (!exact(args.material,['answer','baseline','diff','checks']) || !nonempty(args.material.answer) ||
        !Object.values(args.material).every(value=>value===null||nonempty(value))) return 'invalid_request';
    texts.push(...Object.values(args.material).filter(value=>value!==null));
    if (secretSuspected(encoded,apiKey)) return 'secret_suspected';
  }
  if (texts.some(value => secret.test(value) || (apiKey && value.includes(apiKey)))) return 'secret_suspected';
  return null;
}
