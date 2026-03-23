/**
 * Scenario Agent - Generates and maintains BDD scenarios from GitHub issues.
 * Uses the /scenario_writer slash command from .claude/commands/scenario_writer.md
 */

import { runCommandAgent, type CommandAgentConfig } from './commandAgent';
import type { AgentResult } from './claudeAgent';
import type { GitHubIssue } from '../core';
import { isAdwComment, extractActionableContent } from '../core/workflowCommentParsing';

const scenarioAgentConfig: CommandAgentConfig<void> = {
  command: '/scenario_writer',
  agentName: 'Scenario',
  outputFileName: 'scenario-agent.jsonl',
};

/**
 * Runs the /scenario_writer skill to generate and maintain BDD scenarios.
 * CWD is set to the worktree so the agent writes scenario files to the target repo.
 *
 * @param issue - GitHub issue to generate scenarios for
 * @param logsDir - Directory to write agent logs
 * @param statePath - Optional path to agent's state directory
 * @param cwd - Optional working directory for the agent (worktree path)
 * @param adwId - Optional ADW workflow ID
 * @param contextPreamble - Optional context preamble for the agent
 */
export async function runScenarioAgent(
  issue: GitHubIssue,
  logsDir: string,
  statePath?: string,
  cwd?: string,
  adwId?: string,
  contextPreamble?: string,
): Promise<AgentResult> {
  const humanComments = issue.comments.filter(c => !isAdwComment(c.body));
  const latestActionableContent = [...issue.comments]
    .reverse()
    .reduce<string | null>((found, c) => found ?? extractActionableContent(c.body), null);

  const issueJson = JSON.stringify({
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state,
    author: issue.author.login,
    labels: issue.labels.map(l => l.name),
    createdAt: issue.createdAt,
    comments: humanComments.map(c => ({
      author: c.author.login,
      createdAt: c.createdAt,
      body: c.body,
    })),
    actionableComment: latestActionableContent,
  });

  return runCommandAgent(scenarioAgentConfig, {
    args: [String(issue.number), adwId ?? 'adw-unknown', issueJson],
    logsDir,
    issueBody: issue.body,
    statePath,
    cwd,
    contextPreamble,
  });
}
