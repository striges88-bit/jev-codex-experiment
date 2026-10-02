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
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const secret = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:ghp_|github_pat_|sk-)[A-Za-z0-9_-]{20,}|\bBearer\s+\S+|\b(?:api[_-]?key|password|passwd|secret|token|authorization|cookie|credential)\s*[:=]\s*\S+/i;
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
    if (!exact(item, name === 'jev_shadow_filter' ? ['id', 'text', 'protected', 'kind'] : ['id', 'text', 'protected']) || typeof item.id !== 'string' || !/^[A-Za-z0-9_.:-]{1,64}$/.test(item.id) ||
        seen.has(item.id) || !nonempty(item.text) || typeof item.protected !== 'boolean') return 'invalid_request';
    seen.add(item.id); texts.push(item.id, item.text);
    if (name === 'jev_shadow_filter' && (!['instruction', 'requirement', 'unfinished', 'reference'].includes(item.kind) ||
        (item.kind !== 'reference' && !item.protected))) return 'invalid_request';
  }
  if (texts.some(value => secret.test(value) || (apiKey && value.includes(apiKey)))) return 'secret_suspected';
  return null;
}
