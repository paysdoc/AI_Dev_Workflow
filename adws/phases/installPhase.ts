/**
 * Install phase execution for workflows.
 * Runs the /install agent once, caches the file context it reads,
 * and injects it into subsequent agent prompts.
 * Non-fatal: errors are caught and logged without blocking workflow completion.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  log,
  AgentStateManager,
  type ModelUsageMap,
  emptyModelUsageMap,
} from '../core';
import { createPhaseCostRecords, PhaseCostStatus, type PhaseCostRecord } from '../cost';
import { runInstallAgent } from '../agents';
import type { WorkflowConfig } from './workflowInit';

/**
 * Extracts project context from the install agent's JSONL output.
 * Pairs tool_use (Read/Bash) with their tool_result content.
 * Returns a formatted context string for injection into agent prompts.
 * Returns empty string if no context could be extracted.
 */
export function extractInstallContext(jsonlPath: string): string {
  let content: string;
  try {
    content = fs.readFileSync(jsonlPath, 'utf-8');
  } catch {
    return '';
  }

  const lines = content.split('\n').filter(line => line.trim());
  const toolUseMap = new Map<string, { name: string; input: Record<string, unknown> }>();
  const sections: string[] = [];

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;

      if (parsed['type'] === 'assistant') {
        const message = parsed['message'] as { content?: unknown[] } | undefined;
        const contentBlocks = message?.content ?? [];
        for (const block of contentBlocks) {
          const tb = block as Record<string, unknown>;
          if (
            tb['type'] === 'tool_use' &&
            typeof tb['input'] === 'object' &&
            tb['input'] !== null
          ) {
            toolUseMap.set(String(tb['id']), {
              name: String(tb['name']),
              input: tb['input'] as Record<string, unknown>,
            });
          }
        }
      }

      if (parsed['type'] === 'tool_result') {
        if (parsed['is_error'] === true) continue;
        const toolUseId = String(parsed['tool_use_id'] ?? '');
        const toolUse = toolUseMap.get(toolUseId);
        if (!toolUse) continue;
        const outputText =
          typeof parsed['content'] === 'string'
            ? parsed['content']
            : JSON.stringify(parsed['content']);
        if (!outputText) continue;

        if (toolUse.name === 'Read') {
          const filePath = String(toolUse.input['file_path'] ?? '');
          sections.push(`## File: ${filePath}\n\`\`\`\n${outputText}\n\`\`\``);
        } else if (toolUse.name === 'Bash') {
          const command = String(toolUse.input['command'] ?? '');
          sections.push(`## Command: ${command}\n\`\`\`\n${outputText}\n\`\`\``);
        }
      }
    } catch {
      // Skip malformed lines
    }
  }

  if (sections.length === 0) return '';

  return [
    'The following project context has been pre-loaded. Use it as your understanding of the codebase. Do not re-read these files or run /install.',
    '',
    '<project-context>',
    sections.join('\n\n'),
    '</project-context>',
  ].join('\n');
}

/**
 * Executes the Install phase: runs the install agent, caches file contents,
 * and populates config.installContext for injection into subsequent agents.
 * This phase is non-fatal — errors are caught and logged, never thrown.
 *
 * @param config - Workflow configuration
 */
export async function executeInstallPhase(
  config: WorkflowConfig,
): Promise<{ costUsd: number; modelUsage: ModelUsageMap; phaseCostRecords: PhaseCostRecord[] }> {
  const { orchestratorStatePath, adwId, issueNumber, issue, worktreePath, logsDir } = config;
  const phaseStartTime = Date.now();

  let costUsd = 0;
  let modelUsage = emptyModelUsageMap();

  log('Phase: Install', 'info');
  AgentStateManager.appendLog(orchestratorStatePath, 'Starting install phase');

  try {
    const installAgentStatePath = AgentStateManager.initializeState(adwId, 'install-agent', orchestratorStatePath);
    AgentStateManager.writeState(installAgentStatePath, {
      adwId,
      issueNumber,
      agentName: 'install-agent',
      execution: AgentStateManager.createExecutionState('running'),
    });

    const result = await runInstallAgent(issueNumber, adwId, logsDir, installAgentStatePath, worktreePath, issue.body);

    costUsd = result.totalCostUsd || 0;
    if (result.modelUsage) modelUsage = result.modelUsage;

    if (!result.success) {
      AgentStateManager.writeState(installAgentStatePath, {
        execution: AgentStateManager.completeExecution(
          AgentStateManager.createExecutionState('running'),
          false,
          result.output,
        ),
      });
      log(`Install Agent failed: ${result.output}`, 'warn');
      AgentStateManager.appendLog(orchestratorStatePath, `Install phase failed: ${result.output}`);
      return { costUsd, modelUsage, phaseCostRecords: [] };
    }

    AgentStateManager.writeState(installAgentStatePath, {
      output: result.output.substring(0, 1000),
      execution: AgentStateManager.completeExecution(
        AgentStateManager.createExecutionState('running'),
        true,
      ),
    });

    const jsonlPath = path.join(logsDir, 'install-agent.jsonl');
    const contextString = extractInstallContext(jsonlPath);

    if (contextString) {
      const cacheDir = path.join('agents', adwId);
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(path.join(cacheDir, 'install_cache.md'), contextString, 'utf-8');
      config.installContext = contextString;
      if (config.phaseState) {
        config.phaseState.install.installContext = contextString;
      }
      log(`Install context cached (${contextString.length} chars)`, 'success');
    } else {
      log('Install agent ran but no file context extracted', 'warn');
    }

    AgentStateManager.appendLog(orchestratorStatePath, 'Install phase completed');
    log('Install phase completed', 'success');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log(`Install phase error (non-fatal): ${errorMsg}`, 'warn');
    AgentStateManager.appendLog(orchestratorStatePath, `Install phase error: ${errorMsg}`);
    return { costUsd: 0, modelUsage: emptyModelUsageMap(), phaseCostRecords: [] };
  }

  const phaseCostRecords = createPhaseCostRecords({
    workflowId: adwId,
    issueNumber,
    phase: 'install',
    status: PhaseCostStatus.Success,
    retryCount: 0,
    contextResetCount: 0,
    durationMs: Date.now() - phaseStartTime,
    modelUsage,
  });

  return { costUsd, modelUsage, phaseCostRecords };
}
