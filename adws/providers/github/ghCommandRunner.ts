/**
 * ghCommandRunner.ts — the GitHub forge adapter's only route to a child process.
 *
 * Reproduces `GitContext`'s private `#runRepoApi` classifier verbatim on the
 * public `exec` surface: the same framework-root cwd class (#775's repo-API
 * contract — repo-independent gh commands carry their identity in the
 * command string and must not depend on a cloned workspace), and the same
 * per-command credential overlay resolved through the TokenProvider port
 * (#791). Imports nothing from `child_process` — every command this adapter
 * issues reaches a process only through `GitContext.exec`.
 */

import type { GitContext, CredentialPurpose } from '../../gitContext';

export interface GhCommandRunner {
  run(command: string, opts?: { input?: string; purpose?: CredentialPurpose }): string;
}

export function createGhCommandRunner(ctx: GitContext): GhCommandRunner {
  return {
    run: (command, opts = {}) => ctx.exec(command, {
      cwd: { kind: 'frameworkRoot' },
      env: ctx.commandEnv({}, opts.purpose ?? 'default'),
      input: opts.input,
    }),
  };
}
