/**
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
import { runScenarioProof, type ScenarioProofResult } from './scenarioProof';
import { devServerPort, isDevServerConfigured, withDevServer } from '../core/devServerLifecycle';
import { resolveScenarioRunner } from '../core/scenarioRunner';
import { requireApplicationProfile } from './applicationTypeGate';
import type { WorkflowConfig } from './workflowInit';

/**
 * Returns immediately with a passing result when:
 * - `projectConfig.scenariosMd` is empty (no scenarios configured), or
 * - the scenario runner's command is 'N/A', which only a descriptor runner can say
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

  const { startDevServer, healthCheckPath } = projectConfig.commands;
  const { scenariosMd, reviewProofConfig } = projectConfig;
  const runner = resolveScenarioRunner(requireApplicationProfile(config).runnerMode, projectConfig);

  if (!scenariosMd.trim() || runner.runByTagCommand.trim() === 'N/A') {
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
      runByTagCommand: runner.runByTagCommand,
      issueNumber,
      proofDir,
      cwd: worktreePath,
      stepDefDirectory: runner.stepDefDirectory,
      stepDefExtensions: [...runner.stepDefExtensions],
      proofDirPerTag: runner.proofDirPerTag,
      env: { ADW_APPLICATION_URL: applicationUrl },
    });

  let scenarioProof: ScenarioProofResult;

  if (isDevServerConfigured(startDevServer)) {
    log(`Scenario test phase: starting dev server (${startDevServer})`, 'info');
    AgentStateManager.appendLog(orchestratorStatePath, `Scenario test phase: wrapping in withDevServer`);

    const port = devServerPort(applicationUrl);
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

  // Surface proof on context so executeProofPublishPhase can read it
  config.ctx.scenarioProof = scenarioProof;

  // Scenario execution is subprocess-only — no Claude Agent cost
  return { costUsd: 0, modelUsage, scenarioProof, phaseCostRecords };
}
