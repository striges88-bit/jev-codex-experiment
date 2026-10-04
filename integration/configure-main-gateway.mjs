import { readFile, writeFile, open, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sha256 } from './context-binding.mjs';

const rootStart = '# jev-main-gateway root begin';
const rootEnd = '# jev-main-gateway root end';
const providerStart = '# jev-main-gateway provider begin';
const providerEnd = '# jev-main-gateway provider end';

export function planGatewayConfig(original, { port,capability }) {
  if (typeof original !== 'string' || !Number.isInteger(port) || port < 1024 || port > 65535 || !/^[a-f0-9]{32}$/.test(capability)) throw Error('invalid_config_plan');
  const top = original.split(/^\s*\[/m)[0];
  if (/^\s*(?:model_provider|profile)\s*=/m.test(top) || /\[model_providers\.jev_main\]|jev-main-gateway (?:root|provider) begin/.test(original)) throw Error('existing_provider_or_profile');
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  const root = [rootStart,'model_provider = "jev_main"',rootEnd,''].join(newline);
  const provider = [providerStart,'[model_providers.jev_main]','name = "Local Jev gateway"',
    `base_url = "http://127.0.0.1:${port}/jev/${capability}/backend-api/codex"`,
    'wire_api = "responses"','requires_openai_auth = true','supports_websockets = false',providerEnd,''].join(newline);
  // Preserve all original bytes between owned marker blocks, including model/effort.
  const separator = original.endsWith('\n') ? '' : newline;
  const after = root + original + separator + provider;
  return { schema_version:1,port,capability,before_sha256:sha256(original),after_sha256:sha256(after),
    root,provider:separator+provider,after };
}

function builtinRoot(original, { port,capability }) {
  // Reuse the endpoint validation and marker conventions of the legacy planner.
  planGatewayConfig('',{ port,capability });
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  return [rootStart,`openai_base_url = "http://127.0.0.1:${port}/jev/${capability}/backend-api/codex"`,rootEnd,''].join(newline);
}

export function planBuiltinGatewayConfig(current, { port,capability }, previousPlan = null) {
  let original = current;
  if (previousPlan) {
    if (previousPlan.schema_version !== 1) throw Error('invalid_previous_plan');
    applyGatewayConfig(rollbackGatewayConfig(previousPlan.after,previousPlan),previousPlan);
    original = rollbackGatewayConfig(current,previousPlan);
  }
  planGatewayConfig(original,{ port,capability });
  if (/^\s*openai_base_url\s*=/m.test(original.split(/^\s*\[/m)[0])) throw Error('existing_endpoint');
  const root = builtinRoot(original,{ port,capability }), after = root + original;
  return { schema_version:2, port, capability, before_sha256:sha256(current), after_sha256:sha256(after),
    root, after, previous_plan:previousPlan };
}

export function rollbackGatewayConfig(current, plan) {
  if (plan.schema_version === 2) {
    if (plan.root !== builtinRoot(plan.after,plan) || current.split(plan.root).length !== 2) throw Error('owned_block_changed');
    // Disable the gateway, preserving all unrelated edits; do not resurrect the old provider.
    return current.replace(plan.root,'');
  }
  for (const block of [plan.root,plan.provider]) if (!block || current.split(block).length !== 2) throw Error('owned_block_changed');
  return current.replace(plan.root,'').replace(plan.provider,'');
}

export function applyGatewayConfig(current, plan) {
  if (sha256(current) !== plan.before_sha256 || sha256(plan.after) !== plan.after_sha256) throw Error('baseline_changed');
  const rebuilt = plan.schema_version === 2 ? planBuiltinGatewayConfig(current,plan,plan.previous_plan) : planGatewayConfig(current,plan);
  if (JSON.stringify(rebuilt) !== JSON.stringify(plan)) throw Error('plan_changed');
  const unowned = plan.previous_plan ? rollbackGatewayConfig(current,plan.previous_plan) : current;
  if (rollbackGatewayConfig(plan.after,plan) !== unowned) throw Error('invalid_owned_diff');
  return plan.after;
}

export async function writeGatewayConfig(configPath, expected, next) {
  const stagedPath = `${configPath}.jev-${randomUUID()}.tmp`;
  try {
    const staged = await open(stagedPath,'wx',0o600);
    try { await staged.writeFile(next,'utf8'); await staged.sync(); } finally { await staged.close(); }
    if (await readFile(configPath,'utf8') !== expected) throw Error('baseline_changed');
    // Same-directory replacement avoids exposing a partially written configuration.
    // This is not a lock against another writer between the final read and rename.
    await rename(stagedPath,configPath);
    if (await readFile(configPath,'utf8') !== next) throw Error('readback_failed');
  } finally { await rm(stagedPath,{ force:true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode,configPath,planPath,settingsPath,previousPlanPath] = process.argv.slice(2);
  try {
    const current = await readFile(configPath,'utf8');
    if (mode === 'plan' || mode === 'plan-openai') {
      const settings = JSON.parse(await readFile(settingsPath,'utf8'));
      const previous = previousPlanPath ? JSON.parse(await readFile(previousPlanPath,'utf8')) : null;
      const plan = mode === 'plan-openai' ? planBuiltinGatewayConfig(current,settings,previous) : planGatewayConfig(current,settings);
      await writeFile(planPath,JSON.stringify(plan,null,2),{ flag:'wx',mode:0o600 });
      process.stdout.write(JSON.stringify({ status:'planned',before_sha256:plan.before_sha256,after_sha256:plan.after_sha256,primary_model_preserved:true })+'\n');
    } else {
      const plan = JSON.parse(await readFile(planPath,'utf8'));
      let next;
      if (mode === 'apply') {
        next = applyGatewayConfig(current,plan);
      } else if (mode === 'rollback') next = rollbackGatewayConfig(current,plan);
      else throw Error('invalid_mode');
      await writeGatewayConfig(configPath,current,next);
      process.stdout.write(JSON.stringify({ status:mode === 'apply' ? 'configured_passthrough_pending_restart' : 'rolled_back',sha256:sha256(next) })+'\n');
    }
  } catch { process.stderr.write('Gateway configuration operation refused; inspect owned plan and current configuration locally\n'); process.exitCode = 1; }
}
