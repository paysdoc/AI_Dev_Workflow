/**
 * PR Agent - Pull request content generation via Claude skills.
 * Uses the /pull_request slash command from .claude/commands/pull_request.md
 * The agent generates PR title and body as JSON; the caller handles git push and PR creation.
 */

import { runCommandAgent, type CommandAgentConfig, type ExtractionResult } from './commandAgent';
import type { AgentResult } from './claudeAgent';
import { getDefaultBranch } from '../vcs/branchOperations';
import { refreshTokenIfNeeded } from '../github/githubAppAuth';

/**
 * Structured PR content returned by the agent.
 */
export interface PrContent {
  title: string;
  body: string;
}

export const prContentSchema: Record<string, unknown> = {
  type: 'object',
  required: ['title', 'body'],
  properties: {
    title: { type: 'string', minLength: 1 },
    body: { type: 'string' },
  },
  additionalProperties: false,
};

/**
 * Extracts PR title and body from the agent's JSON output.
 * Handles markdown code fences. Returns structured error if extraction fails.
 */
function extractPrContentFromOutput(output: string): ExtractionResult<PrContent> {
  const trimmed = output.trim();

  // Strip markdown code fences if present
  const fenceStripped = trimmed.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();

  // Find the first JSON object in the output
  const jsonMatch = fenceStripped.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      if (typeof parsed.title === 'string' && typeof parsed.body === 'string') {
        return { success: true, data: { title: parsed.title, body: parsed.body } };
      }
      return { success: false, error: 'Parsed JSON missing required "title" or "body" string fields' };
    } catch (err) {
      return { success: false, error: `Failed to parse PR content JSON: ${String(err)}` };
    }
  }

  // Fallback: first non-empty line as title, rest as body
  const lines = trimmed.split('\n').filter(line => line.trim());
  const title = lines[0]?.trim() ?? '';
  const body = lines.slice(1).join('\n').trim();
  if (!title) {
    return { success: false, error: 'No JSON object found and no fallback title available' };
  }
  return { success: true, data: { title, body } };
}

const prAgentConfig: CommandAgentConfig<PrContent> = {
  command: '/pull_request',
  agentName: 'Pull Request',
  outputFileName: 'pr-agent.jsonl',
  extractOutput: extractPrContentFromOutput,
  outputSchema: prContentSchema,
};

/**
 * Runs the /pull_request skill to generate PR title and body as structured JSON.
 * The caller is responsible for pushing the branch and creating the PR programmatically.
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
): Promise<AgentResult & { prContent: PrContent }> {
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
  return { ...result, prContent: result.parsed };
}
