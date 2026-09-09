/**
 * GitHub-specific workflow comment utilities.
 *
 * Platform-agnostic parsing has been moved to core/workflowCommentParsing.ts.
 * This file retains only functions that depend on a forge read.
 */

import { WorkflowStage, AgentStateManager } from '../core';
import { parseWorkflowStageFromComment, extractAdwIdFromComment } from '../core/workflowCommentParsing';
import type { IssueTracker } from '../providers/types';

const TERMINAL_STAGES: ReadonlyArray<WorkflowStage> = ['completed', 'error'];

/**
 * Returns true if an ADW workflow is currently active (not completed or errored) for the given issue.
 * @param issueNumber - The issue number to check
 * @param tracker - The bound issue tracker to read the issue's comments through
 */
export async function isAdwRunningForIssue(issueNumber: number, tracker: Pick<IssueTracker, 'fetchIssue'>): Promise<boolean> {
  const issue = await tracker.fetchIssue(issueNumber);

  const stageComments = issue.comments
    .map((c) => ({ stage: parseWorkflowStageFromComment(c.body), createdAt: c.createdAt, body: c.body }))
    .filter((entry): entry is { stage: WorkflowStage; createdAt: string; body: string } => entry.stage !== null);

  if (stageComments.length === 0) return false;

  const sorted = [...stageComments].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  if (TERMINAL_STAGES.includes(sorted[0].stage)) return false;

  // Latest stage is non-terminal — verify the agent process is actually alive
  const adwId = extractAdwIdFromComment(sorted[0].body);
  if (!adwId) return true; // Cannot verify without ADW ID; conservatively assume running

  return AgentStateManager.isAgentProcessRunning(adwId);
}
