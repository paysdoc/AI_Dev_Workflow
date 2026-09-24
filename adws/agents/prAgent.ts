import { runCommandAgent, type CommandAgentConfig, type ExtractionResult } from './commandAgent';
import type { AgentResult, AgentLaunchContext } from './claudeAgent';

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

function extractPrContentFromOutput(output: string): ExtractionResult<PrContent> {
  const trimmed = output.trim();

  const fenceStripped = trimmed.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();

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
 * The caller is responsible for pushing the branch and creating the PR programmatically.
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
  resolvedDefaultBranch?: string,
  subprocessEnv?: NodeJS.ProcessEnv,
  launchContext?: AgentLaunchContext,
): Promise<AgentResult & { prContent: PrContent }> {
  const defaultBranch = resolvedDefaultBranch ?? '';
  const args = [branchName, issueJson, planFile, adwId, defaultBranch, repoOwner ?? '', repoName ?? ''];

  const result = await runCommandAgent(prAgentConfig, {
    args,
    logsDir,
    issueBody,
    statePath,
    cwd,
    subprocessEnv,
    launchContext,
  });
  return { ...result, prContent: result.parsed };
}
