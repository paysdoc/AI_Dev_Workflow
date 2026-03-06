/**
 * Build Agent - Implements solutions based on implementation plans.
 * Uses the /implement slash command from .claude/commands/implement.md
 */

import * as path from 'path';
import { GitHubIssue, PRDetails, log, getModelForCommand, getEffortForCommand } from '../core';
import { runClaudeAgentWithCommand, AgentResult, ProgressCallback } from './claudeAgent';

/**
 * Formats the plan content as arguments for the /implement command.
 * Includes issue context to provide additional information to the agent.
 */
function formatImplementArgs(issue: GitHubIssue, planContent: string): string {
  return `## GitHub Issue #${issue.number}
**Title:** ${issue.title}
**URL:** ${issue.url}

## Implementation Plan
${planContent}`;
}

/**
 * Formats the revision plan as arguments for the /implement command.
 * Includes PR context to provide additional information to the agent.
 */
function formatPrReviewImplementArgs(prDetails: PRDetails, revisionPlan: string): string {
  return `## PR #${prDetails.number}: ${prDetails.title}
**URL:** ${prDetails.url}
**Branch:** ${prDetails.headBranch}

## Revision Plan
${revisionPlan}`;
}

/**
 * Runs the Build Agent to implement PR review changes.
 * Uses the /implement slash command with the revision plan as arguments.
 *
 * @param prDetails - PR details including number, title, branch, etc.
 * @param revisionPlan - The revision plan to implement
 * @param logsDir - Directory to write agent logs
 * @param onProgress - Optional callback for progress updates
 * @param statePath - Optional path to agent's state directory for state tracking
 * @param cwd - Optional working directory for the agent (defaults to process.cwd())
 */
export async function runPrReviewBuildAgent(
  prDetails: PRDetails,
  revisionPlan: string,
  logsDir: string,
  onProgress?: ProgressCallback,
  statePath?: string,
  cwd?: string,
  issueBody?: string,
): Promise<AgentResult> {
  const args = formatPrReviewImplementArgs(prDetails, revisionPlan);
  const outputFile = path.join(logsDir, 'pr-review-build-agent.jsonl');
  const model = getModelForCommand('/implement', issueBody);
  const effort = getEffortForCommand('/implement', issueBody);

  log('PR Review Build Agent starting with arguments:', 'info');
  log(`  PR: #${prDetails.number} - ${prDetails.title}`, 'info');
  log(`  Output file: ${outputFile}`, 'info');
  log(`  Revision plan length: ${revisionPlan.length} characters`, 'info');
  log(`  Model: ${model}`, 'info');

  return runClaudeAgentWithCommand('/implement', args, 'PR Review Build', outputFile, model, effort, onProgress, statePath, cwd);
}

/**
 * Runs the Build Agent to implement the solution.
 * Uses the /implement slash command with the plan content as arguments.
 *
 * @param issue - GitHub issue to implement
 * @param logsDir - Directory to write agent logs
 * @param planContent - The implementation plan content
 * @param onProgress - Optional callback for progress updates
 * @param statePath - Optional path to agent's state directory for state tracking
 * @param cwd - Optional working directory for the agent (defaults to process.cwd())
 */
export async function runBuildAgent(
  issue: GitHubIssue,
  logsDir: string,
  planContent: string,
  onProgress?: ProgressCallback,
  statePath?: string,
  cwd?: string
): Promise<AgentResult> {
  const args = formatImplementArgs(issue, planContent);
  const outputFile = path.join(logsDir, 'build-agent.jsonl');

  const model = getModelForCommand('/implement', issue.body);
  const effort = getEffortForCommand('/implement', issue.body);

  // Log the arguments with which the agent is started
  log('Build Agent starting with arguments:', 'info');
  log(`  Issue: #${issue.number} - ${issue.title}`, 'info');
  log(`  Issue URL: ${issue.url}`, 'info');
  log(`  Output file: ${outputFile}`, 'info');
  log(`  Plan content length: ${planContent.length} characters`, 'info');
  log(`  Model: ${model}`, 'info');

  return runClaudeAgentWithCommand('/implement', args, 'Build', outputFile, model, effort, onProgress, statePath, cwd);
}
