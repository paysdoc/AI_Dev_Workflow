/**
 * Scenario Fidelity Agent — compares frozen BDD scenarios against the issue body.
 *
 * Reuses the `validationAgent`'s `ValidationResult`/`validationResultSchema` rail,
 * re-pointed to compare scenarios vs the issue body rather than plan vs scenarios.
 */

import type { AgentResult } from './claudeAgent';
import { runCommandAgent, type CommandAgentConfig, type ExtractionResult } from './commandAgent';
import { extractJson } from '../core/jsonParser';
import { log } from '../core/logger';
import { ValidationResult, validationResultSchema } from './validationAgent';

export type { ValidationResult };

export function formatFidelityArgs(
  adwId: string,
  issueNumber: number,
  scenarioGlob: string,
  issueBody: string,
): readonly string[] {
  return [adwId, String(issueNumber), scenarioGlob, issueBody];
}

export function extractFidelityResult(agentOutput: string): ExtractionResult<ValidationResult> {
  const parsed = extractJson<ValidationResult>(agentOutput);
  if (!parsed || typeof parsed.aligned !== 'boolean') {
    const preview = agentOutput.substring(0, 200);
    return {
      success: false,
      error: `Fidelity agent output missing required "aligned" boolean field. Output starts with: ${preview}`,
    };
  }
  return {
    success: true,
    data: {
      aligned: parsed.aligned,
      mismatches: Array.isArray(parsed.mismatches) ? parsed.mismatches : [],
      summary: parsed.summary ?? '',
    },
  };
}

const fidelityAgentConfig: CommandAgentConfig<ValidationResult> = {
  command: '/validate_scenario_fidelity',
  agentName: 'scenario-fidelity-agent',
  outputFileName: 'scenario-fidelity-agent.jsonl',
  extractOutput: extractFidelityResult,
  outputSchema: validationResultSchema,
};

export async function runScenarioFidelityAgent(
  adwId: string,
  issueNumber: number,
  issueBody: string,
  scenarioGlob: string,
  logsDir: string,
  statePath?: string,
  cwd?: string,
  launchContext?: { selfHost: boolean; adwId: string },
): Promise<AgentResult & { fidelityResult: ValidationResult }> {
  log(`Running scenario fidelity agent for issue ${issueNumber}`, 'info');

  const result = await runCommandAgent(fidelityAgentConfig, {
    args: formatFidelityArgs(adwId, issueNumber, scenarioGlob, issueBody),
    logsDir,
    statePath,
    cwd,
    launchContext,
  });

  return { ...result, fidelityResult: result.parsed };
}
