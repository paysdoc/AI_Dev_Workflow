/**
 * Scenario test phase execution for workflows.
 *
 * Runs BDD scenarios tagged @adw-{issueNumber} and @regression via the
 * project-configured tag runner. Optionally wraps execution in withDevServer
 * when the target repo requires a running dev server for its scenarios.
 *
 * This is a deep module — the caller passes WorkflowConfig and receives a
 * structured result; all dev-server lifecycle, subprocess management, and
 * proof file I/O are hidden inside.
 */

import * as path from 'path';
import {
  log,
  AgentStateManager,
  emptyModelUsageMap,
  type ModelUsageMap,
} from '../core';
import { createPhaseCostRecords, PhaseCostStatus, type PhaseCostRecord } from '../cost';
import { runScenarioProof, type ScenarioProofResult } from '../agents/regressionScenarioProof';
import { withDevServer } from '../core/devServerLifecycle';
import type { WorkflowConfig } from './workflowInit';

function extractPort(applicationUrl: string): number {
  try {
    const { port } = new URL(applicationUrl);
    const parsed = parseInt(port, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 3000;
  } catch {
    return 3000;
  }
}

function isDevServerConfigured(startDevServer: string): boolean {
  const trimmed = startDevServer.trim();
  return trimmed.length > 0 && trimmed !== 'N/A';
}

/**
 * Executes the Scenario Test phase: runs BDD scenarios via the configured
 * tag runner, optionally wrapping execution in withDevServer.
 *
 * Returns immediately with a passing result when:
 * - `projectConfig.scenariosMd` is empty (no scenarios configured), or
 * - `projectConfig.commands.runScenariosByTag` is 'N/A'
 */
export async function executeScenarioTestPhase(config: WorkflowConfig): Promise<{
  costUsd: number;
  modelUsage: ModelUsageMap;
  scenarioProof: ScenarioProofResult | undefined;
  phaseCostRecords: PhaseCostRecord[];
}> {
  const {
    orchestratorStatePath,
    issueNumber,
    adwId,
    worktreePath,
    applicationUrl,
    projectConfig,
  } = config;

  const phaseStartTime = Date.now();
  const modelUsage = emptyModelUsageMap();

  const { runScenariosByTag: runByTagCommand, startDevServer, healthCheckPath } = projectConfig.commands;
  const { scenariosMd, reviewProofConfig } = projectConfig;

  // Guard: skip when scenarios are not configured
  if (!scenariosMd.trim() || runByTagCommand.trim() === 'N/A') {
    log('Scenario test phase: no scenarios configured — skipping', 'info');
    AgentStateManager.appendLog(orchestratorStatePath, 'Scenario test phase: skipped (no scenarios configured)');

    const phaseCostRecords = createPhaseCostRecords({
      workflowId: adwId,
      issueNumber,
      phase: 'scenarioTest',
      status: PhaseCostStatus.Success,
      retryCount: 0,
      contextResetCount: 0,
      durationMs: Date.now() - phaseStartTime,
      modelUsage,
    });

    return { costUsd: 0, modelUsage, scenarioProof: undefined, phaseCostRecords };
  }

  log('Phase: Scenario Tests', 'info');
  AgentStateManager.appendLog(orchestratorStatePath, 'Starting scenario test phase');

  const proofDir = path.join('agents', adwId, 'scenario-test');

  const runProof = (): Promise<ScenarioProofResult> =>
    runScenarioProof({
      scenariosMd,
      reviewProofConfig,
      runByTagCommand,
      issueNumber,
      proofDir,
      cwd: worktreePath,
    });

  let scenarioProof: ScenarioProofResult;

  if (isDevServerConfigured(startDevServer)) {
    log(`Scenario test phase: starting dev server (${startDevServer})`, 'info');
    AgentStateManager.appendLog(orchestratorStatePath, `Scenario test phase: wrapping in withDevServer`);

    const port = extractPort(applicationUrl);
    scenarioProof = await withDevServer(
      {
        startCommand: startDevServer,
        port,
        healthPath: healthCheckPath || '/',
        cwd: worktreePath,
      },
      runProof,
    );
  } else {
    scenarioProof = await runProof();
  }

  const { hasBlockerFailures } = scenarioProof;
  const statusLabel = hasBlockerFailures ? 'FAILED (blocker failures)' : 'PASSED';
  log(`Scenario test phase: ${statusLabel}`, hasBlockerFailures ? 'error' : 'success');
  AgentStateManager.appendLog(
    orchestratorStatePath,
    `Scenario test phase ${statusLabel}. Proof: ${scenarioProof.resultsFilePath}`,
  );

  const phaseCostRecords = createPhaseCostRecords({
    workflowId: adwId,
    issueNumber,
    phase: 'scenarioTest',
    status: hasBlockerFailures ? PhaseCostStatus.Failed : PhaseCostStatus.Success,
    retryCount: 0,
    contextResetCount: 0,
    durationMs: Date.now() - phaseStartTime,
    modelUsage,
  });

  // Scenario execution is subprocess-only — no Claude Agent cost
  return { costUsd: 0, modelUsage, scenarioProof, phaseCostRecords };
}
