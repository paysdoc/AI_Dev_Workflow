import { runCommandAgent, type CommandAgentConfig } from './commandAgent';
import type { AgentResult, AgentLaunchContext } from './claudeAgent';
import type { Issue } from '@paysdoc/devplatform';
import { isAdwComment, extractActionableContent } from '../core/workflowCommentParsing';

const scenarioAgentConfig: CommandAgentConfig<void> = {
  command: '/scenario_writer',
  agentName: 'Scenario',
  outputFileName: 'scenario-agent.jsonl',
};

/** CWD is set to the worktree so the agent writes scenario files to the target repo. */
export async function runScenarioAgent(
  issue: Issue,
  logsDir: string,
  statePath?: string,
  cwd?: string,
  adwId?: string,
  contextPreamble?: string,
  launchContext?: AgentLaunchContext,
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
    author: issue.author,
    labels: issue.labels,
    createdAt: issue.createdAt,
    comments: humanComments.map(c => ({
      author: c.author,
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
    launchContext,
  });
}
