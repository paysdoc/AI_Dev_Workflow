/**
 * Dependency Extraction Agent - Extracts issue dependency numbers from natural-language issue bodies.
 * Uses the /extract_dependencies slash command with the haiku model for fast, cheap extraction.
 */

import { log } from '../core';
import { runCommandAgent, type CommandAgentConfig, type ExtractionResult } from './commandAgent';
import type { AgentResult } from './claudeAgent';

export const dependencyExtractionSchema: Record<string, unknown> = {
  type: 'array',
  items: { type: 'integer', minimum: 1 },
  description: 'Array of unique positive integer GitHub issue numbers',
};

/**
 * Extracts a JSON array of dependency issue numbers from agent output.
 * Finds the first JSON array pattern in the output, parses it, and filters
 * to unique positive integers.
 * Returns a structured error on any parse failure.
 */
export function parseDependencyArray(output: string): ExtractionResult<number[]> {
  try {
    const match = output.match(/\[[-\d,\s]*\]/);
    if (!match) {
      return { success: false, error: 'No JSON array found in dependency extraction output' };
    }

    const parsed: unknown = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) {
      return { success: false, error: 'Parsed value is not an array' };
    }

    const unique = new Set(
      parsed
        .filter((v): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0)
    );
    return { success: true, data: [...unique] };
  } catch (err) {
    log('parseDependencyArray: failed to parse agent output', 'warn');
    return { success: false, error: `Failed to parse dependency array: ${String(err)}` };
  }
}

const dependencyExtractionAgentConfig: CommandAgentConfig<number[]> = {
  command: '/extract_dependencies',
  agentName: 'Dependency Extraction',
  outputFileName: 'dependency-extraction-agent.jsonl',
  extractOutput: parseDependencyArray,
  outputSchema: dependencyExtractionSchema,
};

/**
 * Runs the Dependency Extraction Agent to extract issue dependency numbers
 * from a raw issue body using LLM-based natural-language understanding.
 *
 * @param issueBody - Raw issue body text to analyze
 * @param logsDir - Directory to write agent logs
 * @param statePath - Optional path to agent's state directory for state tracking
 * @param cwd - Optional working directory for the agent (defaults to process.cwd())
 */
export async function runDependencyExtractionAgent(
  issueBody: string,
  logsDir: string,
  statePath?: string,
  cwd?: string,
): Promise<AgentResult & { dependencies: number[] }> {
  const result = await runCommandAgent(dependencyExtractionAgentConfig, {
    args: issueBody,
    logsDir,
    statePath,
    cwd,
  });
  return { ...result, dependencies: result.parsed };
}
