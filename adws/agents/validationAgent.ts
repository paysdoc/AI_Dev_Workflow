/**
 * Validation Agent - Compares an implementation plan against BDD scenarios.
 */
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import type { AgentResult } from "./claudeAgent";
import { runCommandAgent, type CommandAgentConfig, type ExtractionResult } from "./commandAgent";
import { extractJson } from "../core/jsonParser";
import { log } from "../core/logger";

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

export const validationResultSchema: Record<string, unknown> = {
  type: 'object',
  required: ['aligned', 'mismatches', 'summary'],
  properties: {
    aligned: { type: 'boolean' },
    mismatches: {
      type: 'array',
      items: {
        type: 'object',
        required: ['type', 'description'],
        properties: {
          type: { type: 'string', enum: ['plan_only', 'scenario_only', 'conflicting'] },
          description: { type: 'string' },
          planReference: { type: 'string' },
          scenarioReference: { type: 'string' },
        },
      },
    },
    summary: { type: 'string' },
  },
};

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
 * Extracts and validates the JSON output from the validation agent.
 * Returns a structured error if parsing fails (retry loop handles recovery).
 */
function extractValidationResult(agentOutput: string): ExtractionResult<ValidationResult> {
  const parsed = extractJson<ValidationResult>(agentOutput);
  if (!parsed || typeof parsed.aligned !== "boolean") {
    const preview = agentOutput.substring(0, 200);
    return {
      success: false,
      error: `Validation agent output missing required "aligned" boolean field. Output starts with: ${preview}`,
    };
  }
  return {
    success: true,
    data: {
      aligned: parsed.aligned,
      mismatches: Array.isArray(parsed.mismatches) ? parsed.mismatches : [],
      summary: parsed.summary ?? "",
    },
  };
}

const validationAgentConfig: CommandAgentConfig<ValidationResult> = {
  command: "/validate_plan_scenarios",
  agentName: "validation-agent",
  outputFileName: "validation-agent.jsonl",
  extractOutput: extractValidationResult,
  outputSchema: validationResultSchema,
};

/**
 * Runs the Validation Agent to compare a plan against BDD scenarios.
 * Output validation retries are handled by the commandAgent retry loop.
 * On exhaustion, throws OutputValidationError; callers catch and handle gracefully.
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
  log(`Running validation agent for issue ${issueNumber}`, "info");

  const result = await runCommandAgent(validationAgentConfig, {
    args: formatValidationArgs(adwId, issueNumber, planFilePath, scenarioGlob),
    logsDir,
    statePath,
    cwd,
  });

  return { ...result, validationResult: result.parsed };
}
