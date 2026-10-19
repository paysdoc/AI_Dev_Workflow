/**
 * This is a deep module — the caller passes WorkflowConfig and receives a
 * structured result; all dev-server lifecycle, device lifecycle, subprocess
 * management, and proof file I/O are hidden inside.
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
import type { Platform } from '../core/applicationType';
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
import { withDevices, type DeviceEnvironment, type DeviceRequest } from '../core/deviceLifecycle';
import { DeviceSourceConfigError, resolveDeviceSource, type DeviceSource } from '../core/deviceSourceConfig';
import { resolveScenarioRunner } from '../core/scenarioRunner';
import { requireApplicationProfile } from './applicationTypeGate';
import { readDeclaredDevServer } from './declaredDevServer';
import { runScenarioProof, type ScenarioProofResult } from './scenarioProof';
import type { WorkflowConfig } from './workflowInit';

const DEV_SERVER_LOG_FILE = 'dev-server.log';
const EMULATOR_LOG_FILE = 'android-emulator.log';

export interface ScenarioTestPhaseDeps {
  readonly readDeclaredDevServer: typeof readDeclaredDevServer;
  readonly withHealthyDevServer: typeof withHealthyDevServer;
  readonly withDevices: typeof withDevices;
}

export interface ScenarioTestPhaseResult {
  costUsd: number;
  modelUsage: ModelUsageMap;
  scenarioProof: ScenarioProofResult | undefined;
  devServer: DevServerStart;
  phaseCostRecords: PhaseCostRecord[];
}

const DEFAULT_DEPS: ScenarioTestPhaseDeps = { readDeclaredDevServer, withHealthyDevServer, withDevices };

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
    `Scenario test phase ${statusLabel}. Proof: ${scenarioProof.resultsFilePath} (${scenarioProof.perIssueImages.length} per-issue image(s))`,
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

function requireDeviceSource(run: PhaseRun, platforms: readonly Platform[]): DeviceSource | null {
  const resolution = resolveDeviceSource(run.config.projectConfig.deviceSources, platforms);
  if (resolution.kind === 'not_required') return null;
  if (resolution.kind === 'resolved') return resolution.deviceSource;
  recordLine(run.config.orchestratorStatePath, `Scenario test phase failed before running anything: ${resolution.message}`, 'error');
  throw new DeviceSourceConfigError(resolution.section, resolution.message);
}

function deviceRequest({ config }: PhaseRun, deviceSource: DeviceSource): DeviceRequest {
  return {
    adwId: config.adwId,
    deviceSource,
    emulatorOutputPath: path.join(config.logsDir, EMULATOR_LOG_FILE),
    record: (message, level) => recordLine(config.orchestratorStatePath, message, level),
  };
}

/**
 * For a profile with platforms, a missing or empty device-source section throws `DeviceSourceConfigError` before
 * anything else runs, the skips below included. The orchestrator fails the workflow with that message and does not
 * park it.
 *
 * Returns immediately with a passing result when:
 * - `projectConfig.scenariosMd` is empty (no scenarios configured), or
 * - the scenario runner's command is 'N/A', which only a descriptor runner can say
 *
 * Starts only the dev server the repository declares, the one the baseline starts. When that server does not
 * start, no scenario runs and the result says so in `devServer`: what a failed start means is for the caller.
 *
 * For a profile with platforms, the proof runs on one emulator and one simulator that the device lifecycle creates for
 * the workflow, inside the dev server when there is one. The scenario command gets their identities as `ADW_ANDROID_AVD`,
 * `ADW_ANDROID_SERIAL` and `ADW_IOS_UDID`, and they are removed afterwards. A device that does not come up rejects with
 * `DeviceLifecycleError`.
 */
export async function executeScenarioTestPhase(
  config: WorkflowConfig,
  deps: Partial<ScenarioTestPhaseDeps> = {},
): Promise<ScenarioTestPhaseResult> {
  const lifecycle: ScenarioTestPhaseDeps = { ...DEFAULT_DEPS, ...deps };
  const { orchestratorStatePath, issueNumber, adwId, worktreePath, applicationUrl, logsDir, projectConfig } = config;
  const run: PhaseRun = { config, startedAt: Date.now(), modelUsage: emptyModelUsageMap() };

  const { scenariosMd } = projectConfig;
  const applicationProfile = requireApplicationProfile(config);
  const deviceSource = requireDeviceSource(run, applicationProfile.platforms);
  const runner = resolveScenarioRunner(applicationProfile.runnerMode, projectConfig);

  if (!scenariosMd.trim() || runner.runByTagCommand.trim() === 'N/A') return skipPhase(run);

  log('Phase: Scenario Tests', 'info');
  AgentStateManager.appendLog(orchestratorStatePath, 'Starting scenario test phase');

  const proofDir = path.join('agents', adwId, 'scenario-test');

  const runProof = (devices?: DeviceEnvironment): Promise<ScenarioProofResult> =>
    runScenarioProof({
      scenariosMd,
      runByTagCommand: runner.runByTagCommand,
      issueNumber,
      proofDir,
      cwd: worktreePath,
      stepDefDirectory: runner.stepDefDirectory,
      stepDefExtensions: [...runner.stepDefExtensions],
      proofDirPerTag: runner.proofDirPerTag,
      applicationProfile,
      featureDirectory: runner.featureDirectory,
      env: { ADW_APPLICATION_URL: applicationUrl, ...devices },
    });

  const runProofOnDevices = deviceSource === null
    ? () => runProof()
    : () => lifecycle.withDevices(deviceRequest(run, deviceSource), runProof);

  const declaredServer = lifecycle.readDeclaredDevServer(worktreePath);
  if (declaredServer === null) return settleProof(run, await runProofOnDevices(), NO_DEV_SERVER_START);

  const server: HealthyDevServerConfig = {
    startCommand: declaredServer,
    port: devServerPort(applicationUrl),
    healthPath: projectConfig.commands.healthCheckPath || '/',
    cwd: worktreePath,
    outputPath: path.join(logsDir, DEV_SERVER_LOG_FILE),
  };
  return runUnderServer(run, server, runProofOnDevices, lifecycle);
}
