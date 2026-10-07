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
  type LogLevel,
  type ModelUsageMap,
} from '../core';
import { createPhaseCostRecords, PhaseCostStatus, type PhaseCostRecord } from '../cost';
import {
  DevServerStartStatus,
  NO_DEV_SERVER_START,
  serverOutputTail,
  type DevServerStart,
} from '../core/devServerFailure';
import {
  MAX_START_ATTEMPTS,
  devServerPort,
  substitutePort,
  withHealthyDevServer,
  type HealthyDevServerConfig,
} from '../core/devServerLifecycle';
import { resolveScenarioRunner } from '../core/scenarioRunner';
import { requireApplicationProfile } from './applicationTypeGate';
import { readDeclaredDevServer } from './declaredDevServer';
import { runScenarioProof, type ScenarioProofResult } from './scenarioProof';
import type { WorkflowConfig } from './workflowInit';

const DEV_SERVER_LOG_FILE = 'dev-server.log';

export interface ScenarioTestPhaseDeps {
  readonly readDeclaredDevServer: typeof readDeclaredDevServer;
  readonly withHealthyDevServer: typeof withHealthyDevServer;
}

export interface ScenarioTestPhaseResult {
  costUsd: number;
  modelUsage: ModelUsageMap;
  scenarioProof: ScenarioProofResult | undefined;
  devServer: DevServerStart;
  phaseCostRecords: PhaseCostRecord[];
}

const DEFAULT_DEPS: ScenarioTestPhaseDeps = { readDeclaredDevServer, withHealthyDevServer };

interface PhaseRun {
  readonly config: WorkflowConfig;
  readonly startedAt: number;
  readonly modelUsage: ModelUsageMap;
}

function recordLine(statePath: string, message: string, level: LogLevel): void {
  log(message, level);
  AgentStateManager.appendLog(statePath, message);
}

// Scenario execution is subprocess-only — no Claude Agent cost
function resultOf(
  { config, startedAt, modelUsage }: PhaseRun,
  scenarioProof: ScenarioProofResult | undefined,
  devServer: DevServerStart,
  status: PhaseCostStatus,
): ScenarioTestPhaseResult {
  const phaseCostRecords = createPhaseCostRecords({
    workflowId: config.adwId,
    issueNumber: config.issueNumber,
    phase: 'scenarioTest',
    status,
    retryCount: 0,
    contextResetCount: 0,
    durationMs: Date.now() - startedAt,
    modelUsage,
  });
  return { costUsd: 0, modelUsage, scenarioProof, devServer, phaseCostRecords };
}

function skipPhase(run: PhaseRun): ScenarioTestPhaseResult {
  log('Scenario test phase: no scenarios configured — skipping', 'info');
  AgentStateManager.appendLog(run.config.orchestratorStatePath, 'Scenario test phase: skipped (no scenarios configured)');
  return resultOf(run, undefined, NO_DEV_SERVER_START, PhaseCostStatus.Success);
}

function settleProof(run: PhaseRun, scenarioProof: ScenarioProofResult, devServer: DevServerStart): ScenarioTestPhaseResult {
  const { config } = run;
  const { hasBlockerFailures } = scenarioProof;
  const statusLabel = hasBlockerFailures ? 'FAILED (blocker failures)' : 'PASSED';
  log(`Scenario test phase: ${statusLabel}`, hasBlockerFailures ? 'error' : 'success');
  AgentStateManager.appendLog(
    config.orchestratorStatePath,
    `Scenario test phase ${statusLabel}. Proof: ${scenarioProof.resultsFilePath}`,
  );

  // Surface proof on context so executeProofPublishPhase can read it
  config.ctx.scenarioProof = scenarioProof;

  return resultOf(run, scenarioProof, devServer, hasBlockerFailures ? PhaseCostStatus.Failed : PhaseCostStatus.Success);
}

function failedStart(run: PhaseRun, server: HealthyDevServerConfig, output: string): ScenarioTestPhaseResult {
  const { config } = run;

  // No scenario ran, so a proof on the context is an earlier attempt's: it must not reach a comment or the PR.
  config.ctx.scenarioProof = undefined;

  recordLine(
    config.orchestratorStatePath,
    `Scenario test phase: the dev server did not start on the issue branch after ${MAX_START_ATTEMPTS} attempts; no scenario ran. Its output:`,
    'error',
  );
  recordLine(config.orchestratorStatePath, serverOutputTail(output), 'error');

  const devServer: DevServerStart = {
    status: DevServerStartStatus.Failed,
    command: substitutePort(server.startCommand, server.port),
    healthUrl: `http://localhost:${server.port}${server.healthPath}`,
    output,
  };
  return resultOf(run, undefined, devServer, PhaseCostStatus.Failed);
}

async function runUnderServer(
  run: PhaseRun,
  server: HealthyDevServerConfig,
  runProof: () => Promise<ScenarioProofResult>,
  lifecycle: ScenarioTestPhaseDeps,
): Promise<ScenarioTestPhaseResult> {
  recordLine(run.config.orchestratorStatePath, `Scenario test phase: starting the dev server the repository declares (${server.startCommand})`, 'info');

  const outcome = await lifecycle.withHealthyDevServer(server, runProof);
  if (!outcome.started) return failedStart(run, server, outcome.output);
  return settleProof(run, outcome.result, { status: DevServerStartStatus.Started });
}

/**
 * Returns immediately with a passing result when:
 * - `projectConfig.scenariosMd` is empty (no scenarios configured), or
 * - the scenario runner's command is 'N/A', which only a descriptor runner can say
 *
 * Starts only the dev server the repository declares, the one the baseline starts. When that server does not
 * start, no scenario runs and the result says so in `devServer`: what a failed start means is for the caller.
 */
export async function executeScenarioTestPhase(
  config: WorkflowConfig,
  deps: Partial<ScenarioTestPhaseDeps> = {},
): Promise<ScenarioTestPhaseResult> {
  const lifecycle: ScenarioTestPhaseDeps = { ...DEFAULT_DEPS, ...deps };
  const { orchestratorStatePath, issueNumber, adwId, worktreePath, applicationUrl, logsDir, projectConfig } = config;
  const run: PhaseRun = { config, startedAt: Date.now(), modelUsage: emptyModelUsageMap() };

  const { scenariosMd, reviewProofConfig } = projectConfig;
  const runner = resolveScenarioRunner(requireApplicationProfile(config).runnerMode, projectConfig);

  if (!scenariosMd.trim() || runner.runByTagCommand.trim() === 'N/A') return skipPhase(run);

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

  const declaredServer = lifecycle.readDeclaredDevServer(worktreePath);
  if (declaredServer === null) return settleProof(run, await runProof(), NO_DEV_SERVER_START);

  const server: HealthyDevServerConfig = {
    startCommand: declaredServer,
    port: devServerPort(applicationUrl),
    healthPath: projectConfig.commands.healthCheckPath || '/',
    cwd: worktreePath,
    outputPath: path.join(logsDir, DEV_SERVER_LOG_FILE),
  };
  return runUnderServer(run, server, runProof, lifecycle);
}
