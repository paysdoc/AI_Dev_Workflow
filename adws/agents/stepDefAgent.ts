/**
 * Step Definition Agent - Generates Cucumber step definitions from BDD scenarios.
 * Uses the /generate_step_definitions slash command from .claude/commands/generate_step_definitions.md
 */

import { runCommandAgent, type CommandAgentConfig } from './commandAgent';
import type { AgentResult } from './claudeAgent';

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

const stepDefAgentConfig: CommandAgentConfig<RemovedScenario[]> = {
  command: '/generate_step_definitions',
  agentName: 'StepDef',
  outputFileName: 'step-def-agent.jsonl',
  extractOutput: parseRemovedScenarios,
};

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
 * @param contextPreamble - Optional context preamble for the agent
 */
export async function runStepDefAgent(
  issueNumber: number,
  adwId: string,
  logsDir: string,
  statePath?: string,
  cwd?: string,
  issueBody?: string,
  contextPreamble?: string,
): Promise<StepDefAgentResult> {
  const result = await runCommandAgent(stepDefAgentConfig, {
    args: [String(issueNumber), adwId],
    logsDir,
    issueBody,
    statePath,
    cwd,
    contextPreamble,
  });
  return { ...result, removedScenarios: result.parsed };
}
