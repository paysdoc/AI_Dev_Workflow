/**
 * Alignment Agent - Aligns an implementation plan with BDD scenarios in a single pass.
 * Resolves conflicts using the GitHub issue as the sole source of truth.
 * Flags unresolvable conflicts as inline warnings in the plan rather than throwing.
 */
import type { AgentResult } from "./claudeAgent";
import { runCommandAgent, type CommandAgentConfig, type ExtractionResult } from "./commandAgent";
import { extractJson } from "../core/jsonParser";
import { log } from "../core/logger";
import { findScenarioFiles } from "./validationAgent";

export interface AlignmentResult {
  /** True when all conflicts were resolved (or there were none). */
  aligned: boolean;
  /** Descriptions of conflicts that could not be resolved from the issue. */
  warnings: string[];
  /** Descriptions of changes made to plan or scenario files. */
  changes: string[];
  /** One-sentence summary of the alignment result. */
  summary: string;
}

export const alignmentResultSchema: Record<string, unknown> = {
  type: 'object',
  required: ['aligned', 'warnings', 'changes', 'summary'],
  properties: {
    aligned: { type: 'boolean' },
    warnings: { type: 'array', items: { type: 'string' } },
    changes: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
};

/**
 * Returns positional args for the /align_plan_scenarios command.
 */
function formatAlignmentArgs(
  adwId: string,
  issueNumber: number,
  planFilePath: string,
  scenarioGlob: string,
  issueJson: string
): readonly string[] {
  return [adwId, String(issueNumber), planFilePath, scenarioGlob, issueJson];
}

/**
 * Extracts and validates the JSON output from the alignment agent.
 * Returns a structured error on parse failure (retry loop handles recovery).
 */
function extractAlignmentResult(agentOutput: string): ExtractionResult<AlignmentResult> {
  const parsed = extractJson<AlignmentResult>(agentOutput);
  if (!parsed || typeof parsed.aligned !== "boolean") {
    const preview = agentOutput.substring(0, 200);
    return {
      success: false,
      error: `Alignment agent output missing required "aligned" boolean field. Output starts with: ${preview}`,
    };
  }
  return {
    success: true,
    data: {
      aligned: parsed.aligned,
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
      changes: Array.isArray(parsed.changes) ? parsed.changes : [],
      summary: parsed.summary ?? "",
    },
  };
}

/**
 * Parses the alignment result from raw agent output.
 * Returns a fully-aligned result on parse failure so the workflow is never
 * blocked by a malformed response — the warning is logged instead.
 * Used by the alignment phase as a fallback when the retry loop is exhausted.
 */
export function parseAlignmentResult(agentOutput: string): AlignmentResult {
  const result = extractAlignmentResult(agentOutput);
  if (result.success) {
    return result.data;
  }
  const preview = agentOutput.substring(0, 200);
  log(
    `Alignment agent returned non-JSON output, treating as aligned with warning: ${preview}`,
    "warn"
  );
  return {
    aligned: true,
    warnings: [
      `Alignment agent did not return valid JSON. Raw output starts with: ${preview}`,
    ],
    changes: [],
    summary: "Alignment output could not be parsed; proceeding with warnings.",
  };
}

const alignmentAgentConfig: CommandAgentConfig<AlignmentResult> = {
  command: "/align_plan_scenarios",
  agentName: "alignment-agent",
  outputFileName: "alignment-agent.jsonl",
  extractOutput: extractAlignmentResult,
  outputSchema: alignmentResultSchema,
};

/**
 * Runs the Alignment Agent to align a plan against BDD scenarios in a single pass.
 * Output validation retries are handled by the commandAgent retry loop.
 */
export async function runAlignmentAgent(
  adwId: string,
  issueNumber: number,
  planFilePath: string,
  worktreePath: string,
  issueJson: string,
  logsDir: string,
  statePath?: string,
  cwd?: string
): Promise<AgentResult & { alignmentResult: AlignmentResult }> {
  const result = await runCommandAgent(alignmentAgentConfig, {
    args: formatAlignmentArgs(adwId, issueNumber, planFilePath, worktreePath, issueJson),
    logsDir,
    statePath,
    cwd,
  });

  return { ...result, alignmentResult: result.parsed };
}

// Re-export findScenarioFiles so the phase doesn't need to import from validationAgent
export { findScenarioFiles };
