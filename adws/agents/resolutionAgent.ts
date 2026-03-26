/**
 * Resolution Agent - Reconciles mismatches between an implementation plan and BDD scenarios.
 */
import { join } from "path";
import type { AgentResult } from "./claudeAgent";
import { runClaudeAgentWithCommand } from "./claudeAgent";
import { getModelForCommand, getEffortForCommand } from "../core/config";
import { extractJson } from "../core/jsonParser";
import { log } from "../core/logger";
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
 * Returns a graceful fallback result instead of throwing on invalid JSON.
 */
export function parseResolutionResult(agentOutput: string): ResolutionResult {
  const parsed = extractJson<ResolutionResult>(agentOutput);
  if (!parsed || typeof parsed.resolved !== "boolean") {
    log("Resolution agent returned invalid JSON, falling back to unresolved", "warn");
    return { resolved: false, decisions: [] };
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

  let resolutionResult = parseResolutionResult(result.output);

  // Retry once if the first output produced a non-JSON graceful fallback
  if (!resolutionResult.resolved && resolutionResult.decisions.length === 0 && extractJson(result.output) === null) {
    log("Resolution agent returned non-JSON output, retrying once...", "warn");
    const retryResult = await runClaudeAgentWithCommand(
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
    resolutionResult = parseResolutionResult(retryResult.output);
    return { ...retryResult, resolutionResult };
  }

  return { ...result, resolutionResult };
}
