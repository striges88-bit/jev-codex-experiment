import { validate } from './schema.mjs';
import { snapshot } from './budget.mjs';
import { createShadow } from './shadow.mjs';

// Advisory only: trusted authorization and actual selection belong to the caller.
export function createFilter(options) {
  const shadow = createShadow(options);
  return async (args, signal) => {
    const invalid = validate('jev_filter_context', args, options.apiKey);
    if (invalid) return {
      schema_version: 1, subtask_id: null, status: 'fallback', mode: 'opt_in', threshold: 0.80,
      applied: false, context_action: 'preserve_full', binding_sha256: null, policy_revision: null,
      recommendations: [], fallback: { code: invalid, action: 'preserve_full_context' }, budget: snapshot(null),
      measured: { jev_requests: 0, jev_latency_ms: 0, input_tokens: null, output_tokens: null, cost_usd: null, subagent_runtime_ms: null },
    };
    const { policy, ...inventory } = args;
    const result = await shadow(inventory, signal);
    // Even a final packet cannot authorize selection after measured exhaustion.
    if (result.status === 'shadow_complete' && result.budget?.wait_ms_used >= 30000) {
      result.status = 'fallback';
      result.fallback = { code: 'budget_time_exhausted', action: 'preserve_full_context' };
      result.recommendations = result.recommendations.map(row => ({ ...row, p_unneeded: null, decision: row.protected ? 'protected' : 'unknown' }));
    }
    const allowed = new Set(policy.allowed_fragment_ids);
    return { ...result, status: result.status === 'shadow_complete' ? 'filter_complete' : 'fallback',
      mode: 'opt_in', threshold: 0.80, binding_sha256: policy.binding_sha256, policy_revision: policy.revision,
      context_action: result.status === 'shadow_complete' ? 'select_allowed' : 'preserve_full',
      recommendations: result.recommendations.map(row => ({ ...row, decision: row.protected ? 'protected' :
        row.p_unneeded === null ? 'unknown' : allowed.has(row.fragment_id) && row.p_unneeded >= 0.80 ? 'would_exclude' : 'keep' })),
    };
  };
}
