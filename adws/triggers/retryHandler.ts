/**
 * Handles the `## Retry` directive for merge_blocked issues.
 *
 * Mirrors cancelHandler.ts but is state-only: no process kill, no worktree
 * removal, no comment clearing. Simply resets merge_blocked → awaiting_merge
 * and clears the PR-resolution retry counter so the cron re-dispatches adwMerge.
 */

import { log } from '../core/logger';
import { AgentStateManager } from '../core/agentState';
import { extractLatestAdwId } from './cronStageResolver';
import type { AgentState } from '../types/agentTypes';

export interface RetryHandlerDeps {
  readTopLevelState: (adwId: string) => AgentState | null;
  writeTopLevelState: (adwId: string, state: Partial<AgentState>) => void;
}

function defaultDeps(): RetryHandlerDeps {
  return {
    readTopLevelState: (id) => AgentStateManager.readTopLevelState(id),
    writeTopLevelState: (id, state) => AgentStateManager.writeTopLevelState(id, state),
  };
}

/**
 * Handles a `## Retry` directive: if the issue's latest workflow is in
 * `merge_blocked`, reset it to `awaiting_merge` and clear the PR-resolution
 * retry counter so the cron re-dispatches adwMerge on the next tick. No-op for
 * any other stage (so `## Retry` cannot disturb an active or completed workflow).
 * Returns true only when a reset was performed.
 */
export function handleRetryDirective(
  issueNumber: number,
  comments: readonly { body: string }[],
  deps: RetryHandlerDeps = defaultDeps(),
): boolean {
  const adwId = extractLatestAdwId([...comments]);
  if (!adwId) {
    log(`Retry directive on issue #${issueNumber}: no adw-id in comments, ignoring`, 'warn');
    return false;
  }
  const state = deps.readTopLevelState(adwId);
  if (!state || state.workflowStage !== 'merge_blocked') {
    log(`Retry #${issueNumber}: adwId=${adwId} not in merge_blocked (stage=${state?.workflowStage ?? 'none'}), ignoring`);
    return false;
  }
  deps.writeTopLevelState(adwId, { workflowStage: 'awaiting_merge', mergeRetryCount: 0 });
  log(`Retry #${issueNumber}: reset adwId=${adwId} merge_blocked → awaiting_merge, cleared retry counter`, 'success');
  return true;
}
