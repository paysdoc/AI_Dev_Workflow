import { runCommandAgent, type CommandAgentConfig, type ExtractionResult } from './commandAgent';
import type { AgentResult, AgentLaunchContext } from './claudeAgent';

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

/** CWD is set to the worktree so the agent reads and writes files in the target repo. */
export async function runStepDefAgent(
  issueNumber: number,
  adwId: string,
  logsDir: string,
  statePath?: string,
  cwd?: string,
  issueBody?: string,
  contextPreamble?: string,
  launchContext?: AgentLaunchContext,
): Promise<StepDefAgentResult> {
  const result = await runCommandAgent(stepDefAgentConfig, {
    args: [String(issueNumber), adwId],
    logsDir,
    issueBody,
    statePath,
    cwd,
    contextPreamble,
    phaseName: 'step-def',
    launchContext,
  });
  return { ...result, removedScenarios: result.parsed };
}
