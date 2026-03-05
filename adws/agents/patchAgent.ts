/**
 * Patch Agent - Resolves individual review blocker issues.
 * Uses the /patch slash command from .claude/commands/patch.md
 */

import * as path from 'path';
import { log, getModelForCommand } from '../core';
import { runClaudeAgentWithCommand, AgentResult, ProgressCallback } from './claudeAgent';
import { ReviewIssue } from './reviewAgent';

/**
 * Formats the patch arguments for the /patch command.
 * Combines issue description and resolution into a review change request.
 */
export function formatPatchArgs(
  adwId: string,
  reviewIssue: ReviewIssue,
  specPath?: string,
  screenshots?: string,
): string[] {
  const reviewChangeRequest = `Issue #${reviewIssue.reviewIssueNumber}: ${reviewIssue.issueDescription}\nResolution: ${reviewIssue.issueResolution}`;
  return [adwId, reviewChangeRequest, specPath ?? '', 'patchAgent', screenshots ?? ''];
}

/**
 * Runs the /patch command to resolve a single review blocker issue.
 * Uses 'opus' model for complex code modifications.
 *
 * @param adwId - ADW session identifier
 * @param reviewIssue - The blocker issue to patch
 * @param logsDir - Directory to write agent logs
 * @param specPath - Optional path to the spec file for context
 * @param onProgress - Optional callback for progress updates
 * @param statePath - Optional path to agent's state directory for state tracking
 * @param cwd - Optional working directory for the agent (defaults to process.cwd())
 */
export async function runPatchAgent(
  adwId: string,
  reviewIssue: ReviewIssue,
  logsDir: string,
  specPath?: string,
  onProgress?: ProgressCallback,
  statePath?: string,
  cwd?: string,
  issueBody?: string,
): Promise<AgentResult> {
  const args = formatPatchArgs(adwId, reviewIssue, specPath, reviewIssue.screenshotPath);
  const outputFile = path.join(logsDir, `patch-agent-issue-${reviewIssue.reviewIssueNumber}.jsonl`);
  const model = getModelForCommand('/patch', issueBody);

  log(`Patch Agent starting for issue #${reviewIssue.reviewIssueNumber}:`, 'info');
  log(`  Description: ${reviewIssue.issueDescription}`, 'info');
  log(`  Resolution: ${reviewIssue.issueResolution}`, 'info');
  log(`  Model: ${model}`, 'info');

  return runClaudeAgentWithCommand(
    '/patch',
    args,
    `Patch: ${reviewIssue.reviewIssueNumber}`,
    outputFile,
    model,
    onProgress,
    statePath,
    cwd
  );
}
