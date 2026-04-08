/**
 * Patch Agent - Resolves individual review blocker issues.
 * Uses the /patch slash command from .claude/commands/patch.md
 */

import * as path from 'path';
import { log, getModelForCommand, getEffortForCommand } from '../core';
import { runClaudeAgentWithCommand, AgentResult, ProgressCallback } from './claudeAgent';
import { ReviewIssue } from './reviewAgent';

/**
 * Runs the /patch command to resolve a single review blocker issue.
 * Uses 'opus' model for complex code modifications.
 *
 * The patch agent uses a dynamic output file name (per-issue), so it cannot
 * use the shared CommandAgentConfig approach directly.
 *
 * @param adwId - ADW session identifier
 * @param reviewIssue - The blocker issue to patch
 * @param logsDir - Directory to write agent logs
 * @param specPath - Optional path to the spec file for context
 * @param onProgress - Optional callback for progress updates
 * @param statePath - Optional path to agent's state directory for state tracking
 * @param cwd - Optional working directory for the agent (defaults to process.cwd())
 * @param issueBody - Optional issue body for model/effort selection
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
  const reviewChangeRequest = `Issue #${reviewIssue.reviewIssueNumber}: ${reviewIssue.issueDescription}\nResolution: ${reviewIssue.issueResolution}`;
  const args = [adwId, reviewChangeRequest, specPath ?? '', 'patchAgent'];
  const outputFile = path.join(logsDir, `patch-agent-issue-${reviewIssue.reviewIssueNumber}.jsonl`);
  const model = getModelForCommand('/patch', issueBody);
  const effort = getEffortForCommand('/patch', issueBody);

  log(`Patch Agent starting for issue #${reviewIssue.reviewIssueNumber}:`, 'info');
  log(`  Description: ${reviewIssue.issueDescription}`, 'info');
  log(`  Resolution: ${reviewIssue.issueResolution}`, 'info');
  log(`  Model: ${model}`, 'info');

  return runClaudeAgentWithCommand('/patch', args, `Patch: ${reviewIssue.reviewIssueNumber}`, outputFile, model, effort, onProgress, statePath, cwd);
}
