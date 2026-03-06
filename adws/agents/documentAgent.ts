/**
 * Document Agent - Feature documentation generation via Claude skills.
 * Uses the /document slash command from .claude/commands/document.md
 */

import * as path from 'path';
import { log, getModelForCommand, getEffortForCommand } from '../core';
import { runClaudeAgentWithCommand, AgentResult } from './claudeAgent';

/**
 * Formats structured args for the /document skill.
 */
export function formatDocumentArgs(
  adwId: string,
  specPath?: string,
  screenshotsDir?: string,
): string[] {
  return [adwId, specPath ?? '', screenshotsDir ?? ''];
}

/**
 * Extracts the documentation file path from the agent's output.
 * The skill returns ONLY the path to the created documentation file.
 */
export function extractDocPathFromOutput(output: string): string {
  const trimmed = output.trim();
  const lines = trimmed.split('\n').filter(line => line.trim());
  return lines[lines.length - 1]?.trim() ?? '';
}

/**
 * Runs the /document skill to generate feature documentation.
 *
 * @param adwId - ADW session identifier
 * @param logsDir - Directory to write agent logs
 * @param specPath - Optional path to the spec file for context
 * @param screenshotsDir - Optional directory containing review screenshots
 * @param statePath - Optional path to agent's state directory
 * @param cwd - Optional working directory (worktree path)
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
  const args = formatDocumentArgs(adwId, specPath, screenshotsDir);
  const outputFile = path.join(logsDir, 'document-agent.jsonl');

  log('Document Agent starting:', 'info');
  log(`  ADW ID: ${adwId}`, 'info');
  if (specPath) log(`  Spec: ${specPath}`, 'info');
  if (screenshotsDir) log(`  Screenshots: ${screenshotsDir}`, 'info');
  if (cwd) log(`  CWD: ${cwd}`, 'info');

  const result = await runClaudeAgentWithCommand(
    '/document',
    args,
    'Document',
    outputFile,
    getModelForCommand('/document', issueBody),
    getEffortForCommand('/document', issueBody),
    undefined,
    statePath,
    cwd,
  );

  const docPath = extractDocPathFromOutput(result.output);
  log(`Documentation created: ${docPath}`, 'success');

  return { ...result, docPath };
}
