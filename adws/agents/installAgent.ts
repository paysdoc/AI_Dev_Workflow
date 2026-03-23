/**
 * Install Agent - Runs the /install slash command to prime agent context.
 * Uses the /install slash command from .claude/commands/install.md
 */

import { runCommandAgent, type CommandAgentConfig } from './commandAgent';
import type { AgentResult } from './claudeAgent';

const installAgentConfig: CommandAgentConfig<void> = {
  command: '/install',
  agentName: 'Install',
  outputFileName: 'install-agent.jsonl',
};

/**
 * Runs the /install skill to prime agent context with project files.
 * CWD is set to the worktree so the agent reads files from the target repo.
 *
 * @param issueNumber - GitHub issue number (for context)
 * @param adwId - ADW workflow ID
 * @param logsDir - Directory to write agent logs
 * @param statePath - Optional path to agent's state directory
 * @param cwd - Optional working directory for the agent (worktree path)
 * @param issueBody - Optional issue body for fast-mode detection
 */
export async function runInstallAgent(
  issueNumber: number,
  adwId: string,
  logsDir: string,
  statePath?: string,
  cwd?: string,
  issueBody?: string,
): Promise<AgentResult> {
  return runCommandAgent(installAgentConfig, {
    args: [String(issueNumber), adwId],
    logsDir,
    issueBody,
    statePath,
    cwd,
  });
}
