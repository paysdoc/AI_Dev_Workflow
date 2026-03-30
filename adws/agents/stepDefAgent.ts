/**
 * Step Definition Agent - Generates Cucumber step definitions from BDD scenarios.
 * Uses the /generate_step_definitions slash command from .claude/commands/generate_step_definitions.md
 */

import { runCommandAgent, type CommandAgentConfig, type ExtractionResult } from './commandAgent';
import type { AgentResult } from './claudeAgent';

export interface RemovedScenario {
  featureFile: string;
  scenarioName: string;
  reason: string;
}

export interface StepDefAgentResult extends AgentResult {
  removedScenarios: RemovedScenario[];
}

export const removedScenariosSchema: Record<string, unknown> = {
  type: 'object',
  required: ['removedScenarios'],
  properties: {
    removedScenarios: {
      type: 'array',
      items: {
        type: 'object',
        required: ['featureFile', 'scenarioName', 'reason'],
        properties: {
          featureFile: { type: 'string' },
          scenarioName: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
  },
};

/**
 * Parses the JSON output from the step def agent to extract removed scenarios.
 * Returns a structured error on parse failure.
 */
function parseRemovedScenarios(output: string): ExtractionResult<RemovedScenario[]> {
  try {
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { success: false, error: 'No JSON object found in step def agent output' };
    }
    const parsed = JSON.parse(jsonMatch[0]) as { removedScenarios?: RemovedScenario[] };
    const scenarios = Array.isArray(parsed.removedScenarios) ? parsed.removedScenarios : [];
    return { success: true, data: scenarios };
  } catch (err) {
    return { success: false, error: `Failed to parse step def output: ${String(err)}` };
  }
}

const stepDefAgentConfig: CommandAgentConfig<RemovedScenario[]> = {
  command: '/generate_step_definitions',
  agentName: 'StepDef',
  outputFileName: 'step-def-agent.jsonl',
  extractOutput: parseRemovedScenarios,
  outputSchema: removedScenariosSchema,
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
