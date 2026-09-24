import { log } from '../core';
import { runCommandAgent, type CommandAgentConfig, type ExtractionResult } from './commandAgent';
import type { AgentResult, AgentLaunchContext } from './claudeAgent';

export const dependencyExtractionSchema: Record<string, unknown> = {
  type: 'array',
  items: { type: 'integer', minimum: 1 },
  description: 'Array of unique positive integer GitHub issue numbers',
};

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

export async function runDependencyExtractionAgent(
  issueBody: string,
  logsDir: string,
  statePath?: string,
  cwd?: string,
  launchContext?: AgentLaunchContext,
): Promise<AgentResult & { dependencies: number[] }> {
  const result = await runCommandAgent(dependencyExtractionAgentConfig, {
    args: issueBody,
    logsDir,
    statePath,
    cwd,
    launchContext,
  });
  return { ...result, dependencies: result.parsed };
}
