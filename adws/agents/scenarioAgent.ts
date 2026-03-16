/**
 * Scenario Agent - Generates and maintains BDD scenarios from GitHub issues.
 * Uses the /scenario_writer slash command from .claude/commands/scenario_writer.md
 */

import * as path from 'path';
import { log, getModelForCommand, getEffortForCommand } from '../core';
import { runPrimedClaudeAgentWithCommand, type AgentResult } from './claudeAgent';
import type { GitHubIssue } from '../core';
import { isAdwComment, extractActionableContent } from '../core/workflowCommentParsing';

/**
 * Formats args for the /scenario_writer skill.
 * Returns [issueNumber, adwId, issueJson] matching the plan agent arg format.
 */
function formatScenarioArgs(
  issueNumber: number,
  adwId: string,
  issueJson: string,
): string[] {
  return [String(issueNumber), adwId, issueJson];
}

/**
 * Runs the /scenario_writer skill to generate and maintain BDD scenarios.
 * CWD is set to the worktree so the agent writes scenario files to the target repo.
 *
 * @param issue - GitHub issue to generate scenarios for
 * @param logsDir - Directory to write agent logs
 * @param statePath - Optional path to agent's state directory
 * @param cwd - Optional working directory for the agent (worktree path)
 * @param adwId - Optional ADW workflow ID
 */
export async function runScenarioAgent(
  issue: GitHubIssue,
  logsDir: string,
  statePath?: string,
  cwd?: string,
  adwId?: string,
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

  const args = formatScenarioArgs(issue.number, adwId || 'adw-unknown', issueJson);
  const outputFile = path.join(logsDir, 'scenario-agent.jsonl');

  log('Scenario Agent starting:', 'info');
  log(`  ADW ID: ${adwId || 'adw-unknown'}`, 'info');
  log(`  Issue: #${issue.number}`, 'info');

  const result = await runPrimedClaudeAgentWithCommand(
    '/scenario_writer',
    args,
    'Scenario',
    outputFile,
    getModelForCommand('/scenario_writer', issue.body),
    getEffortForCommand('/scenario_writer', issue.body),
    undefined,
    statePath,
    cwd,
  );

  log('Scenario Agent completed', 'success');

  return result;
}
