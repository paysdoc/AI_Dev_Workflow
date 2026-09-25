import * as path from 'path';
import { log, getModelForCommand, getEffortForCommand } from '../core';
import { runClaudeAgentWithCommand, AgentResult, ProgressCallback, AgentLaunchContext } from './claudeAgent';
import { ReviewIssue } from './reviewAgent';

/** The patch agent uses a dynamic output file name (per-issue), so it cannot use the shared CommandAgentConfig approach directly. */
export async function runPatchAgent(
  adwId: string,
  reviewIssue: ReviewIssue,
  logsDir: string,
  specPath?: string,
  onProgress?: ProgressCallback,
  statePath?: string,
  cwd?: string,
  issueBody?: string,
  subprocessEnv?: NodeJS.ProcessEnv,
  launchContext?: AgentLaunchContext,
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

  return runClaudeAgentWithCommand('/patch', args, `Patch: ${reviewIssue.reviewIssueNumber}`, outputFile, model, effort, onProgress, statePath, cwd, undefined, undefined, subprocessEnv, launchContext);
}
