/**
 * Install Agent - Runs the /install slash command to prime agent context.
 * Uses the /install slash command from .claude/commands/install.md
 */

import * as path from 'path';
import { log, getModelForCommand, getEffortForCommand } from '../core';
import { runClaudeAgentWithCommand, type AgentResult } from './claudeAgent';

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
  const args = [String(issueNumber), adwId];
  const outputFile = path.join(logsDir, 'install-agent.jsonl');

  log('Install Agent starting:', 'info');
  log(`  ADW ID: ${adwId}`, 'info');
  log(`  Issue: #${issueNumber}`, 'info');

  const result = await runClaudeAgentWithCommand(
    '/install',
    args,
    'Install',
    outputFile,
    getModelForCommand('/install', issueBody),
    getEffortForCommand('/install', issueBody),
    undefined,
    statePath,
    cwd,
  );

  log('Install Agent completed', result.success ? 'success' : 'warn');

  return result;
}
