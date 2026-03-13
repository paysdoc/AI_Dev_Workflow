/**
 * Resolution Agent - Reconciles mismatches between an implementation plan and BDD scenarios.
 */
import { join } from "path";
import type { AgentResult } from "./claudeAgent";
import { runClaudeAgent } from "./claudeAgent";
import { getModelForCommand, getEffortForCommand } from "../core/config";
import { extractJson } from "../core/jsonParser";
import type { MismatchItem } from "./validationAgent";

export interface ResolutionResult {
  updatedPlan?: string;
  updatedScenarios?: Array<{ path: string; content: string }>;
  reasoning: string;
  decision: "plan_updated" | "scenarios_updated" | "both_updated";
}

/**
 * Builds the resolution prompt for reconciling plan/scenario mismatches.
 */
export function buildResolutionPrompt(
  issueBody: string,
  planContent: string,
  scenarioContent: string,
  mismatches: MismatchItem[]
): string {
  const mismatchList = mismatches
    .map(
      (m, i) =>
        `${i + 1}. [${m.type}] ${m.description}${m.planReference ? `\n   Plan reference: ${m.planReference}` : ""}${m.scenarioReference ? `\n   Scenario reference: ${m.scenarioReference}` : ""}`
    )
    .join("\n");

  return `You are a resolution agent. Your task is to reconcile mismatches between an implementation plan and BDD scenarios.

## SOURCE OF TRUTH: GitHub Issue
The GitHub issue below is the SOLE ARBITER OF TRUTH. When plan and scenarios diverge, the issue body defines the correct behavior. Do not default to the plan or scenarios — only the issue matters.

\`\`\`
${issueBody}
\`\`\`

## Current Implementation Plan
\`\`\`
${planContent}
\`\`\`

## Current BDD Scenarios
${scenarioContent}

## Identified Mismatches
${mismatchList}

## Instructions

Using the GitHub issue as the sole source of truth, reconcile the mismatches above. You may:
- Update the implementation plan to align with the issue and scenarios
- Update the BDD scenarios to align with the issue and plan
- Update both artifacts

Output a JSON object with this exact structure (no other text, just the JSON):
\`\`\`json
{
  "updatedPlan": "Full updated plan content (omit this field if plan needs no changes)",
  "updatedScenarios": [
    { "path": "/path/to/scenario.feature", "content": "Full updated scenario content" }
  ],
  "reasoning": "Explanation of what was changed and why, referencing the issue as truth",
  "decision": "plan_updated" | "scenarios_updated" | "both_updated"
}
\`\`\`

The "updatedScenarios" field should only include scenario files that were actually modified. If no scenarios need updating, omit the field entirely.`;
}

/**
 * Parses and validates the JSON output from the resolution agent.
 */
export function parseResolutionResult(agentOutput: string): ResolutionResult {
  const parsed = extractJson<ResolutionResult>(agentOutput);
  if (!parsed || !parsed.reasoning || !parsed.decision) {
    throw new Error(
      `Resolution agent returned invalid result. Expected JSON with 'reasoning' and 'decision'. Got: ${agentOutput.substring(0, 200)}`
    );
  }
  return {
    updatedPlan: parsed.updatedPlan,
    updatedScenarios: Array.isArray(parsed.updatedScenarios) ? parsed.updatedScenarios : undefined,
    reasoning: parsed.reasoning,
    decision: parsed.decision,
  };
}

/**
 * Runs the Resolution Agent to reconcile mismatches between plan and BDD scenarios.
 */
export async function runResolutionAgent(
  issueBody: string,
  planContent: string,
  scenarioContent: string,
  mismatches: MismatchItem[],
  logsDir: string,
  statePath?: string,
  cwd?: string
): Promise<AgentResult & { resolutionResult: ResolutionResult }> {
  const prompt = buildResolutionPrompt(issueBody, planContent, scenarioContent, mismatches);
  const model = getModelForCommand("/resolve_plan_scenarios");
  const effort = getEffortForCommand("/resolve_plan_scenarios");
  const outputFile = join(logsDir, "resolution-agent.jsonl");

  const result = await runClaudeAgent(
    prompt,
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
