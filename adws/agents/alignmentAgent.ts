/**
 * Alignment Agent - Aligns an implementation plan with BDD scenarios in a single pass.
 * Resolves conflicts using the GitHub issue as the sole source of truth.
 * Flags unresolvable conflicts as inline warnings in the plan rather than throwing.
 */
import { join } from "path";
import type { AgentResult } from "./claudeAgent";
import { runClaudeAgentWithCommand } from "./claudeAgent";
import { getModelForCommand, getEffortForCommand } from "../core/config";
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
 * Parses and validates the JSON output from the alignment agent.
 * Returns a fully-aligned result on parse failure so the workflow is never
 * blocked by a malformed response — the warning is logged instead.
 */
export function parseAlignmentResult(agentOutput: string): AlignmentResult {
  const parsed = extractJson<AlignmentResult>(agentOutput);
  if (!parsed || typeof parsed.aligned !== "boolean") {
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
  return {
    aligned: parsed.aligned,
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    changes: Array.isArray(parsed.changes) ? parsed.changes : [],
    summary: parsed.summary ?? "",
  };
}

/**
 * Runs the Alignment Agent to align a plan against BDD scenarios in a single pass.
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
  const model = getModelForCommand("/align_plan_scenarios");
  const effort = getEffortForCommand("/align_plan_scenarios");
  const outputFile = join(logsDir, "alignment-agent.jsonl");

  const result = await runClaudeAgentWithCommand(
    "/align_plan_scenarios",
    formatAlignmentArgs(adwId, issueNumber, planFilePath, worktreePath, issueJson),
    "alignment-agent",
    outputFile,
    model,
    effort,
    undefined,
    statePath,
    cwd
  );

  const alignmentResult = parseAlignmentResult(result.output);
  return { ...result, alignmentResult };
}

// Re-export findScenarioFiles so the phase doesn't need to import from validationAgent
export { findScenarioFiles };
