import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import type { AgentResult, AgentLaunchContext } from "./claudeAgent";
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

function formatValidationArgs(
  adwId: string,
  issueNumber: number,
  planFilePath: string,
  scenarioGlob: string
): readonly string[] {
  return [adwId, String(issueNumber), planFilePath, scenarioGlob];
}

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

/** On exhaustion, throws OutputValidationError; callers catch and handle gracefully. */
export async function runValidationAgent(
  adwId: string,
  issueNumber: number,
  planFilePath: string,
  scenarioGlob: string,
  logsDir: string,
  statePath?: string,
  cwd?: string,
  launchContext?: AgentLaunchContext,
): Promise<AgentResult & { validationResult: ValidationResult }> {
  log(`Running validation agent for issue ${issueNumber}`, "info");

  const result = await runCommandAgent(validationAgentConfig, {
    args: formatValidationArgs(adwId, issueNumber, planFilePath, scenarioGlob),
    logsDir,
    statePath,
    cwd,
    launchContext,
  });

  return { ...result, validationResult: result.parsed };
}
