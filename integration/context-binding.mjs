import { createHash } from 'node:crypto';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const contextBinding = (task, context) => sha256(JSON.stringify({
  task: { goal: task.goal, scope: task.scope, done_when: task.done_when },
  context: context.map(({ id, text, protected: protectedFlag, kind }) => ({ id, text, protected: protectedFlag, kind })),
}));
