/**
 * Validation Agent - Compares an implementation plan against BDD scenarios.
 */
import { readdirSync, readFileSync, existsSync } from "fs";
import { join, join as pathJoin } from "path";
import type { AgentResult } from "./claudeAgent";
import { runClaudeAgentWithCommand } from "./claudeAgent";
import { getModelForCommand, getEffortForCommand } from "../core/config";
import { extractJson } from "../core/jsonParser";

export interface MismatchItem {
  type: "plan_only" | "scenario_only" | "conflicting";
  description: string;
  planReference?: string;
  scenarioReference?: string;
}

export interface ValidationResult {
  aligned: boolean;
  mismatches: MismatchItem[];
  summary: string;
}

/**
 * Scans recursively for .feature files containing the @adw-{issueNumber} tag.
 */
export function findScenarioFiles(issueNumber: number, worktreePath: string): string[] {
  const tag = `@adw-${issueNumber}`;
  const results: string[] = [];

  function scanDir(dir: string): void {
    if (!existsSync(dir)) return;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".feature")) {
        try {
          const content = readFileSync(fullPath, "utf-8");
          if (content.includes(tag)) {
            results.push(fullPath);
          }
        } catch {
          // skip unreadable files
        }
      }
    }
  }

  scanDir(worktreePath);
  return results;
}

/**
 * Reads the content of scenario files and formats them for prompt inclusion.
 */
export function readScenarioContents(scenarioPaths: string[]): string {
  return scenarioPaths
    .map((p) => {
      try {
        const content = readFileSync(p, "utf-8");
        return `### File: ${p}\n\`\`\`gherkin\n${content}\n\`\`\``;
      } catch {
        return `### File: ${p}\n[Could not read file]`;
      }
    })
    .join("\n\n");
}

/**
 * Returns positional args for the /validate_plan_scenarios command.
 */
function formatValidationArgs(
  adwId: string,
  issueNumber: number,
  planFilePath: string,
  scenarioGlob: string
): readonly string[] {
  return [adwId, String(issueNumber), planFilePath, scenarioGlob];
}

/**
 * Parses and validates the JSON output from the validation agent.
 */
export function parseValidationResult(agentOutput: string): ValidationResult {
  const parsed = extractJson<ValidationResult>(agentOutput);
  if (!parsed || typeof parsed.aligned !== "boolean") {
    throw new Error(
      `Validation agent returned invalid result. Expected JSON with 'aligned' boolean. Got: ${agentOutput.substring(0, 200)}`
    );
  }
  return {
    aligned: parsed.aligned,
    mismatches: Array.isArray(parsed.mismatches) ? parsed.mismatches : [],
    summary: parsed.summary ?? "",
  };
}

/**
 * Runs the Validation Agent to compare a plan against BDD scenarios.
 */
export async function runValidationAgent(
  adwId: string,
  issueNumber: number,
  planFilePath: string,
  scenarioGlob: string,
  logsDir: string,
  statePath?: string,
  cwd?: string
): Promise<AgentResult & { validationResult: ValidationResult }> {
  const model = getModelForCommand("/validate_plan_scenarios");
  const effort = getEffortForCommand("/validate_plan_scenarios");
  const outputFile = pathJoin(logsDir, "validation-agent.jsonl");

  const result = await runClaudeAgentWithCommand(
    "/validate_plan_scenarios",
    formatValidationArgs(adwId, issueNumber, planFilePath, scenarioGlob),
    "validation-agent",
    outputFile,
    model,
    effort,
    undefined,
    statePath,
    cwd
  );

  const validationResult = parseValidationResult(result.output);
  return { ...result, validationResult };
}
