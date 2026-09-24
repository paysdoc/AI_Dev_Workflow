import { runCommandAgent, type CommandAgentConfig } from './commandAgent';
import type { AgentResult, AgentLaunchContext } from './claudeAgent';

const installAgentConfig: CommandAgentConfig<void> = {
  command: '/install',
  agentName: 'Install',
  outputFileName: 'install-agent.jsonl',
};

/** CWD is set to the worktree so the agent reads files from the target repo. */
export async function runInstallAgent(
  issueNumber: number,
  adwId: string,
  logsDir: string,
  statePath?: string,
  cwd?: string,
  issueBody?: string,
  subprocessEnv?: NodeJS.ProcessEnv,
  launchContext?: AgentLaunchContext,
): Promise<AgentResult> {
  return runCommandAgent(installAgentConfig, {
    args: [String(issueNumber), adwId],
    logsDir,
    issueBody,
    statePath,
    cwd,
    subprocessEnv,
    launchContext,
  });
}
