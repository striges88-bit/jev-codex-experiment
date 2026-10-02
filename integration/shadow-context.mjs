// The caller supplies a provenance-checked inventory. These helpers never filter text.
export const choiceContext = context => context.map(({ id, text, protected: protectedFlag }) => ({ id, text, protected: protectedFlag }));

export async function shadowContext({ client, subtask_id, task, context }) {
  const launchContext = structuredClone(context);
  try {
    const result = await client.call('jev_shadow_filter', {
      schema_version: 1, subtask_id, task: structuredClone(task), context: structuredClone(context),
    });
    return { context: launchContext, status: result.status, result };
  } catch {
    return { context: launchContext, status: 'mcp_unavailable', result: null };
  }
}
