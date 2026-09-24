import { runCommandAgent, type CommandAgentConfig, type ExtractionResult } from './commandAgent';
import type { AgentResult, AgentLaunchContext } from './claudeAgent';

export const documentOutputSchema: Record<string, unknown> = {
  type: 'string',
  minLength: 1,
  description: 'Path to the created documentation file',
};

/** The skill returns ONLY the path to the created documentation file. */
function extractDocPathFromOutput(output: string): ExtractionResult<string> {
  const trimmed = output.trim();
  const lines = trimmed.split('\n').filter(line => line.trim());
  const docPath = lines[lines.length - 1]?.trim() ?? '';
  if (!docPath) {
    return { success: false, error: 'No documentation file path found in agent output' };
  }
  return { success: true, data: docPath };
}

const documentAgentConfig: CommandAgentConfig<string> = {
  command: '/document',
  agentName: 'Document',
  outputFileName: 'document-agent.jsonl',
  extractOutput: extractDocPathFromOutput,
  outputSchema: documentOutputSchema,
};

export async function runDocumentAgent(
  adwId: string,
  logsDir: string,
  specPath?: string,
  screenshotsDir?: string,
  statePath?: string,
  cwd?: string,
  issueBody?: string,
  subprocessEnv?: NodeJS.ProcessEnv,
  launchContext?: AgentLaunchContext,
): Promise<AgentResult & { docPath: string }> {
  const result = await runCommandAgent(documentAgentConfig, {
    args: [adwId, specPath ?? '', screenshotsDir ?? ''],
    logsDir,
    issueBody,
    statePath,
    cwd,
    subprocessEnv,
    launchContext,
  });
  return { ...result, docPath: result.parsed };
}
