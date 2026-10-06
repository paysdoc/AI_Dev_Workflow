/**
 * "The workflow starts": the application-type step of `initializeWorkflow`, run the way init runs it, over the
 * workflow's own worktree and real `GitContext`, with the real gate and the real `parkWorkflow`. `process.exit` is
 * trapped, so that a start that parks is recorded rather than ending this process.
 */

import { loadProjectConfig } from '../../../adws/core/projectConfig.ts';
import { buildApplicationTypeGateDeps, runApplicationTypeGate } from '../../../adws/phases/applicationTypeGate.ts';
import { requireWorkflowGitContext } from '../../../adws/phases/workflowRepoIdentity.ts';

import type { Workflow929 } from './feature-929-workflow.ts';
import type { StartOutcome } from './feature-991-world.ts';

export function startWorkflow(workflow: Workflow929): StartOutcome {
  const { config, worktreePath } = workflow;
  // Object reference avoids TypeScript's let-variable narrowing loss through closures.
  const trapped: { exitCode: number | null } = { exitCode: null };
  const realExit = process.exit;
  process.exit = ((code?: number) => {
    trapped.exitCode = code ?? 0;
    throw new Error(`process.exit(${trapped.exitCode}) was called`);
  }) as typeof process.exit;
  try {
    const { applicationProfile } = runApplicationTypeGate(
      config,
      loadProjectConfig(worktreePath),
      buildApplicationTypeGateDeps(requireWorkflowGitContext(config)),
    );
    return { applicationProfile, exitCode: null, error: null };
  } catch (error) {
    return { applicationProfile: null, exitCode: trapped.exitCode, error: trapped.exitCode === null ? error : null };
  } finally {
    process.exit = realExit;
  }
}

export function describeStart(start: StartOutcome): string {
  if (start.exitCode !== null) return `it ended the run with exit code ${start.exitCode}`;
  return start.error === null ? 'it completed' : `it threw: ${String(start.error)}`;
}
