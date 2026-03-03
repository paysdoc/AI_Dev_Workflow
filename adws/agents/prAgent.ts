/**
 * PR Agent - Pull request creation via Claude skills.
 * Uses the /pull_request slash command from .claude/commands/pull_request.md
 */

import * as path from 'path';
import { log, getModelForCommand } from '../core';
import { runClaudeAgentWithCommand, AgentResult } from './claudeAgent';
import { getDefaultBranch } from '../github/gitOperations';

/**
 * Formats structured args for the /pull_request skill.
 */
export function formatPullRequestArgs(
  branchName: string,
  issueJson: string,
  planFile: string,
  adwId: string,
  defaultBranch: string,
): string {
  return `${branchName}\n${issueJson}\n${planFile}\n${adwId}\n${defaultBranch}`;
}

/**
 * Extracts the PR URL from the agent's output.
 * The skill returns ONLY the PR URL.
 */
export function extractPrUrlFromOutput(output: string): string {
  const trimmed = output.trim();
  const lines = trimmed.split('\n').filter(line => line.trim());
  // The PR URL is the last non-empty line
  const lastLine = lines[lines.length - 1]?.trim() ?? '';
  // Extract URL if embedded in text
  const urlMatch = lastLine.match(/https:\/\/github\.com\/[^\s)]+\/pull\/\d+/);
  return urlMatch ? urlMatch[0] : lastLine;
}

/**
 * Runs the /pull_request skill to create a pull request.
 *
 * @param branchName - Branch to create PR from
 * @param issueJson - JSON string of the GitHub issue
 * @param planFile - Path to the implementation plan file
 * @param adwId - ADW session identifier
 * @param logsDir - Directory to write agent logs
 * @param statePath - Optional path to agent's state directory
 * @param cwd - Optional working directory (worktree path)
 */
export async function runPullRequestAgent(
  branchName: string,
  issueJson: string,
  planFile: string,
  adwId: string,
  logsDir: string,
  statePath?: string,
  cwd?: string,
  issueBody?: string,
): Promise<AgentResult & { prUrl: string }> {
  const defaultBranch = getDefaultBranch(cwd);
  const args = formatPullRequestArgs(branchName, issueJson, planFile, adwId, defaultBranch);
  const outputFile = path.join(logsDir, 'pr-agent.jsonl');

  log('PR Agent starting:', 'info');
  log(`  Branch: ${branchName}`, 'info');
  log(`  Default branch: ${defaultBranch}`, 'info');
  log(`  ADW ID: ${adwId}`, 'info');
  log(`  Plan file: ${planFile}`, 'info');
  if (cwd) log(`  CWD: ${cwd}`, 'info');

  const result = await runClaudeAgentWithCommand(
    '/pull_request',
    args,
    'Pull Request',
    outputFile,
    getModelForCommand('/pull_request', issueBody),
    undefined,
    statePath,
    cwd,
  );

  const prUrl = extractPrUrlFromOutput(result.output);
  log(`Pull request created: ${prUrl}`, 'success');

  return { ...result, prUrl };
}
