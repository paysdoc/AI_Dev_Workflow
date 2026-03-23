/**
 * PR Agent - Pull request creation via Claude skills.
 * Uses the /pull_request slash command from .claude/commands/pull_request.md
 */

import { runCommandAgent, type CommandAgentConfig } from './commandAgent';
import type { AgentResult } from './claudeAgent';
import { getDefaultBranch } from '../vcs/branchOperations';
import { refreshTokenIfNeeded } from '../github/githubAppAuth';

/**
 * Extracts the PR URL from the agent's output.
 * The skill returns ONLY the PR URL.
 */
function extractPrUrlFromOutput(output: string): string {
  const trimmed = output.trim();
  const lines = trimmed.split('\n').filter(line => line.trim());
  const lastLine = lines[lines.length - 1]?.trim() ?? '';
  const urlMatch = lastLine.match(/https:\/\/github\.com\/[^\s)]+\/pull\/\d+/);
  return urlMatch ? urlMatch[0] : lastLine;
}

const prAgentConfig: CommandAgentConfig<string> = {
  command: '/pull_request',
  agentName: 'Pull Request',
  outputFileName: 'pr-agent.jsonl',
  extractOutput: extractPrUrlFromOutput,
};

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
 * @param issueBody - Optional issue body for model selection
 * @param repoOwner - Optional owner of the repo where the issue lives (for cross-repo PRs)
 * @param repoName - Optional name of the repo where the issue lives (for cross-repo PRs)
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
  repoOwner?: string,
  repoName?: string,
): Promise<AgentResult & { prUrl: string }> {
  refreshTokenIfNeeded();
  const defaultBranch = getDefaultBranch(cwd);
  const args = [branchName, issueJson, planFile, adwId, defaultBranch, repoOwner ?? '', repoName ?? ''];

  const result = await runCommandAgent(prAgentConfig, {
    args,
    logsDir,
    issueBody,
    statePath,
    cwd,
  });
  return { ...result, prUrl: result.parsed };
}
