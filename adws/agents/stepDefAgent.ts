/**
 * Step Definition Agent - Generates Cucumber step definitions from BDD scenarios.
 * Uses the /generate_step_definitions slash command from .claude/commands/generate_step_definitions.md
 */

import * as path from 'path';
import { log, getModelForCommand, getEffortForCommand } from '../core';
import { runClaudeAgentWithCommand, type AgentResult } from './claudeAgent';

export interface RemovedScenario {
  featureFile: string;
  scenarioName: string;
  reason: string;
}

export interface StepDefAgentResult extends AgentResult {
  removedScenarios: RemovedScenario[];
}

/**
 * Parses the JSON output from the step def agent to extract removed scenarios.
 * Returns empty array on parse failure.
 */
function parseRemovedScenarios(output: string): RemovedScenario[] {
  try {
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]) as { removedScenarios?: RemovedScenario[] };
    return Array.isArray(parsed.removedScenarios) ? parsed.removedScenarios : [];
  } catch {
    return [];
  }
}

/**
 * Runs the /generate_step_definitions skill to generate step definitions for BDD scenarios.
 * CWD is set to the worktree so the agent reads and writes files in the target repo.
 *
 * @param issueNumber - GitHub issue number
 * @param adwId - ADW workflow ID
 * @param logsDir - Directory to write agent logs
 * @param statePath - Optional path to agent's state directory
 * @param cwd - Optional working directory for the agent (worktree path)
 * @param issueBody - Optional issue body for fast-mode detection
 */
export async function runStepDefAgent(
  issueNumber: number,
  adwId: string,
  logsDir: string,
  statePath?: string,
  cwd?: string,
  issueBody?: string,
): Promise<StepDefAgentResult> {
  const args = [String(issueNumber), adwId];
  const outputFile = path.join(logsDir, 'step-def-agent.jsonl');

  log('Step Def Agent starting:', 'info');
  log(`  ADW ID: ${adwId}`, 'info');
  log(`  Issue: #${issueNumber}`, 'info');

  const result = await runClaudeAgentWithCommand(
    '/generate_step_definitions',
    args,
    'StepDef',
    outputFile,
    getModelForCommand('/generate_step_definitions', issueBody),
    getEffortForCommand('/generate_step_definitions', issueBody),
    undefined,
    statePath,
    cwd,
  );

  const removedScenarios = parseRemovedScenarios(result.output);

  log('Step Def Agent completed', 'success');

  return { ...result, removedScenarios };
}
