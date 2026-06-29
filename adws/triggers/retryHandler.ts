/**
 * Handles the `## Retry` directive for human-gated issues.
 *
 * Mirrors cancelHandler.ts but is state-only: no process kill, no worktree
 * removal, no comment clearing.
 *
 * Three recovery paths:
 *   merge_blocked  → awaiting_merge  (clears mergeRetryCount)
 *   human_gated   → phase_timeout   (re-arms resumeAttempts to 0)
 *   review_failed → phase_timeout   (re-arms resumeAttempts to 0; review re-runs)
 *
 * No-op for any other stage, so `## Retry` cannot disturb an active, completed,
 * or otherwise non-human-gated workflow.
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
 * Handles a `## Retry` directive for human-gated issues.
 *
 * merge_blocked → reset to awaiting_merge, clear mergeRetryCount.
 * human_gated  → reset to phase_timeout, clear resumeAttempts (re-arm).
 *
 * No-op for any other stage. Returns true only when a reset was performed.
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
  const stage = state?.workflowStage;

  if (stage === 'merge_blocked') {
    deps.writeTopLevelState(adwId, { workflowStage: 'awaiting_merge', mergeRetryCount: 0 });
    log(`Retry #${issueNumber}: reset adwId=${adwId} merge_blocked → awaiting_merge, cleared retry counter`, 'success');
    return true;
  }

  if (stage === 'human_gated') {
    deps.writeTopLevelState(adwId, { workflowStage: 'phase_timeout', resumeAttempts: 0 });
    log(`Retry #${issueNumber}: re-armed adwId=${adwId} human_gated → phase_timeout, cleared resume counter`, 'success');
    return true;
  }

  if (stage === 'review_failed') {
    deps.writeTopLevelState(adwId, { workflowStage: 'phase_timeout', resumeAttempts: 0 });
    log(`Retry #${issueNumber}: re-armed adwId=${adwId} review_failed → phase_timeout, cleared resume counter`, 'success');
    return true;
  }

  log(`Retry #${issueNumber}: adwId=${adwId} not human-gated (stage=${stage ?? 'none'}), ignoring`);
  return false;
}
