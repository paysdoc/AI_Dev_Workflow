/**
 * Resolution Agent - Reconciles mismatches between an implementation plan and BDD scenarios.
 */
import { join } from "path";
import type { AgentResult } from "./claudeAgent";
import { runClaudeAgentWithCommand } from "./claudeAgent";
import { getModelForCommand, getEffortForCommand } from "../core/config";
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
 * Parses and validates the JSON output from the resolution agent.
 */
export function parseResolutionResult(agentOutput: string): ResolutionResult {
  const parsed = extractJson<ResolutionResult>(agentOutput);
  if (!parsed || typeof parsed.resolved !== "boolean") {
    throw new Error(
      `Resolution agent returned invalid result. Expected JSON with 'resolved' boolean. Got: ${agentOutput.substring(0, 200)}`
    );
  }
  return {
    resolved: parsed.resolved,
    decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
  };
}

/**
 * Runs the Resolution Agent to reconcile mismatches between plan and BDD scenarios.
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
  const model = getModelForCommand("/resolve_plan_scenarios");
  const effort = getEffortForCommand("/resolve_plan_scenarios");
  const outputFile = join(logsDir, "resolution-agent.jsonl");

  const result = await runClaudeAgentWithCommand(
    "/resolve_plan_scenarios",
    formatResolutionArgs(adwId, issueNumber, planFilePath, scenarioGlob, issueJson, mismatches),
    "resolution-agent",
    outputFile,
    model,
    effort,
    undefined,
    statePath,
    cwd
  );

  const resolutionResult = parseResolutionResult(result.output);
  return { ...result, resolutionResult };
}
