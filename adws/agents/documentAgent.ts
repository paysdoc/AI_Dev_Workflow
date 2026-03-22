/**
 * Document Agent - Feature documentation generation via Claude skills.
 * Uses the /document slash command from .claude/commands/document.md
 */

import { runCommandAgent, type CommandAgentConfig } from './commandAgent';
import type { AgentResult } from './claudeAgent';

/**
 * Extracts the documentation file path from the agent's output.
 * The skill returns ONLY the path to the created documentation file.
 */
function extractDocPathFromOutput(output: string): string {
  const trimmed = output.trim();
  const lines = trimmed.split('\n').filter(line => line.trim());
  return lines[lines.length - 1]?.trim() ?? '';
}

const documentAgentConfig: CommandAgentConfig<string> = {
  command: '/document',
  agentName: 'Document',
  outputFileName: 'document-agent.jsonl',
  extractOutput: extractDocPathFromOutput,
};

/**
 * Runs the /document skill to generate feature documentation.
 *
 * @param adwId - ADW session identifier
 * @param logsDir - Directory to write agent logs
 * @param specPath - Optional path to the spec file for context
 * @param screenshotsDir - Optional directory containing review screenshots
 * @param statePath - Optional path to agent's state directory
 * @param cwd - Optional working directory (worktree path)
 * @param issueBody - Optional issue body for model/effort selection
 */
export async function runDocumentAgent(
  adwId: string,
  logsDir: string,
  specPath?: string,
  screenshotsDir?: string,
  statePath?: string,
  cwd?: string,
  issueBody?: string,
): Promise<AgentResult & { docPath: string }> {
  const result = await runCommandAgent(documentAgentConfig, {
    args: [adwId, specPath ?? '', screenshotsDir ?? ''],
    logsDir,
    issueBody,
    statePath,
    cwd,
  });
  return { ...result, docPath: result.parsed };
}
