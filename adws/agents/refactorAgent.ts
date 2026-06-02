/**
 * Refactor Agent - Applies coding-guideline fixes via the /refactor skill.
 * Mirrors patchAgent.ts but routes to /refactor instead of /patch.
 */

import * as path from 'path';
import { log, getModelForCommand, getEffortForCommand } from '../core';
import { runClaudeAgentWithCommand, type AgentResult } from './claudeAgent';
import type { ReviewIssue } from './reviewAgent';

/**
 * Runs the /refactor command for a consolidated guideline-violation blocker.
 *
 * Receives the blocker whose issueDescription enumerates affected files and
 * violated rules. Forwards the description verbatim so the /refactor skill
 * has a clean, deterministic file list without losing rule context.
 */
export async function runRefactorAgent(
  adwId: string,
  refactorBlocker: ReviewIssue,
  logsDir: string,
  statePath?: string,
  cwd?: string,
  issueBody?: string,
): Promise<AgentResult> {
  const args = [adwId, refactorBlocker.issueDescription];
  const outputFile = path.join(logsDir, 'refactor-agent.jsonl');
  const model = getModelForCommand('/refactor', issueBody);
  const effort = getEffortForCommand('/refactor', issueBody);

  log(`Refactor Agent starting for blocker #${refactorBlocker.reviewIssueNumber}:`, 'info');
  log(`  Description: ${refactorBlocker.issueDescription}`, 'info');
  log(`  Model: ${model}`, 'info');

  return runClaudeAgentWithCommand('/refactor', args, 'Refactor', outputFile, model, effort, undefined, statePath, cwd);
}
