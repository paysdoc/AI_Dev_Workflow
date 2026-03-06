#!/usr/bin/env bunx tsx
/**
 * ADW Document - AI Developer Workflow Documentation Phase
 *
 * Usage: bunx tsx adws/adwDocument.tsx [adw-id] [--cwd <path>]
 *
 * Workflow:
 * 1. Run the /document skill to generate feature documentation
 * 2. Documentation is created in the app_docs/ directory
 * 3. Conditional docs are updated automatically
 *
 * Environment Requirements:
 * - ANTHROPIC_API_KEY: Anthropic API key
 * - CLAUDE_CODE_PATH: Path to Claude CLI (default: /usr/local/bin/claude)
 */

import {
  log,
  setLogAdwId,
  generateAdwId,
  ensureLogsDirectory,
  AgentStateManager,
  type AgentState,
} from './core';
import { runDocumentAgent } from './agents';

/**
 * Prints usage information and exits.
 */
function printUsageAndExit(): never {
  console.error('Usage: bunx tsx adws/adwDocument.tsx [adw-id] [--cwd <path>]');
  console.error('');
  console.error('Generates feature documentation based on git diff analysis.');
  console.error('');
  console.error('Options:');
  console.error('  --cwd <path>  Working directory for documentation generation (worktree path)');
  console.error('');
  console.error('Environment Requirements:');
  console.error('  ANTHROPIC_API_KEY  - Anthropic API key');
  console.error('  CLAUDE_CODE_PATH   - Path to Claude CLI (default: /usr/local/bin/claude)');
  process.exit(1);
}

/**
 * Parses and validates command line arguments.
 */
function parseArguments(args: string[]): { adwId: string; cwd: string | null } {
  if (args.includes('--help') || args.includes('-h')) {
    printUsageAndExit();
  }

  // Parse --cwd option
  let cwd: string | null = null;
  const cwdIndex = args.indexOf('--cwd');
  if (cwdIndex !== -1 && args[cwdIndex + 1]) {
    cwd = args[cwdIndex + 1];
    args.splice(cwdIndex, 2);
  }

  const adwId = args[0] || generateAdwId();
  setLogAdwId(adwId);
  return { adwId, cwd };
}

/**
 * Main document workflow.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { adwId, cwd } = parseArguments(args);

  const logsDir = ensureLogsDirectory(adwId);

  log('===================================', 'info');
  log('ADW Document Workflow', 'info');
  log(`ADW ID: ${adwId}`, 'info');
  log(`Logs: ${logsDir}`, 'info');
  if (cwd) {
    log(`Working directory: ${cwd}`, 'info');
  }
  log('===================================', 'info');

  const orchestratorStatePath = AgentStateManager.initializeState(adwId, 'document-orchestrator');

  const initialState: Partial<AgentState> = {
    adwId,
    issueNumber: 0,
    agentName: 'document-orchestrator',
    execution: AgentStateManager.createExecutionState('running'),
  };
  AgentStateManager.writeState(orchestratorStatePath, initialState);
  AgentStateManager.appendLog(orchestratorStatePath, 'Starting ADW Document workflow');

  try {
    const result = await runDocumentAgent(
      adwId,
      logsDir,
      undefined,
      undefined,
      undefined,
      cwd || undefined,
    );

    const totalCostUsd = result.totalCostUsd || 0;

    AgentStateManager.writeState(orchestratorStatePath, {
      execution: AgentStateManager.completeExecution(
        AgentStateManager.createExecutionState('running'),
        result.success,
        result.success ? undefined : result.output,
      ),
      metadata: { totalCostUsd, docPath: result.docPath },
    });

    if (result.success) {
      AgentStateManager.appendLog(orchestratorStatePath, `Documentation created: ${result.docPath}`);
    } else {
      AgentStateManager.appendLog(orchestratorStatePath, `Document workflow failed: ${result.output}`);
    }

    log('===================================', 'info');
    if (result.success) {
      log('ADW Document workflow completed!', 'success');
      log(`Documentation: ${result.docPath}`, 'info');
    } else {
      log('ADW Document workflow failed!', 'error');
    }
    log(`ADW ID: ${adwId}`, 'info');
    log(`Logs: ${logsDir}`, 'info');
    if (totalCostUsd > 0) {
      log(`Cost: $${totalCostUsd.toFixed(4)}`, 'info');
    }
    log('===================================', 'info');

    if (!result.success) {
      process.exit(1);
    }
  } catch (error) {
    AgentStateManager.writeState(orchestratorStatePath, {
      execution: AgentStateManager.completeExecution(
        AgentStateManager.createExecutionState('running'),
        false,
        String(error),
      ),
    });
    AgentStateManager.appendLog(orchestratorStatePath, `Document workflow failed: ${error}`);
    log(`Document workflow failed: ${error}`, 'error');
    process.exit(1);
  }
}

main();
