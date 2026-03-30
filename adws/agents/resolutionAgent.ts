/**
 * Resolution Agent - Reconciles mismatches between an implementation plan and BDD scenarios.
 * Output validation retries are delegated to the commandAgent retry loop.
 */
import type { AgentResult } from "./claudeAgent";
import { runCommandAgent, type CommandAgentConfig, type ExtractionResult } from "./commandAgent";
import { extractJson } from "../core/jsonParser";
import type { MismatchItem } from "./validationAgent";

export interface ResolutionDecision {
  mismatch: string;
  action: "updated_plan" | "updated_scenarios" | "updated_both";
  reasoning: string;
}

export interface ResolutionResult {
  resolved: boolean;
  decisions: ResolutionDecision[];
}

export const resolutionResultSchema: Record<string, unknown> = {
  type: 'object',
  required: ['resolved', 'decisions'],
  properties: {
    resolved: { type: 'boolean' },
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['mismatch', 'action', 'reasoning'],
        properties: {
          mismatch: { type: 'string' },
          action: { type: 'string', enum: ['updated_plan', 'updated_scenarios', 'updated_both'] },
          reasoning: { type: 'string' },
        },
      },
    },
  },
};

/**
 * Returns positional args for the /resolve_plan_scenarios command.
 */
function formatResolutionArgs(
  adwId: string,
  issueNumber: number,
  planFilePath: string,
  scenarioGlob: string,
  issueJson: string,
  mismatches: MismatchItem[]
): readonly string[] {
  return [adwId, String(issueNumber), planFilePath, scenarioGlob, issueJson, JSON.stringify(mismatches)];
}

/**
 * Extracts and validates the JSON output from the resolution agent.
 * Returns a structured error on invalid JSON (retry loop handles recovery).
 */
function extractResolutionResult(agentOutput: string): ExtractionResult<ResolutionResult> {
  const parsed = extractJson<ResolutionResult>(agentOutput);
  if (!parsed || typeof parsed.resolved !== "boolean") {
    return {
      success: false,
      error: 'Resolution agent output missing required "resolved" boolean field',
    };
  }
  return {
    success: true,
    data: {
      resolved: parsed.resolved,
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
    },
  };
}

const resolutionAgentConfig: CommandAgentConfig<ResolutionResult> = {
  command: "/resolve_plan_scenarios",
  agentName: "resolution-agent",
  outputFileName: "resolution-agent.jsonl",
  extractOutput: extractResolutionResult,
  outputSchema: resolutionResultSchema,
};

/**
 * Runs the Resolution Agent to reconcile mismatches between plan and BDD scenarios.
 * Output validation retries are handled by the commandAgent retry loop.
 * On exhaustion, throws OutputValidationError; the resolution phase catches and handles gracefully.
 */
export async function runResolutionAgent(
  adwId: string,
  issueNumber: number,
  planFilePath: string,
  scenarioGlob: string,
  issueJson: string,
  mismatches: MismatchItem[],
  logsDir: string,
  statePath?: string,
  cwd?: string
): Promise<AgentResult & { resolutionResult: ResolutionResult }> {
  const result = await runCommandAgent(resolutionAgentConfig, {
    args: formatResolutionArgs(adwId, issueNumber, planFilePath, scenarioGlob, issueJson, mismatches),
    logsDir,
    statePath,
    cwd,
  });

  return { ...result, resolutionResult: result.parsed };
}
