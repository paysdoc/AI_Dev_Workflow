import * as path from 'path';
import { log, AgentStateManager, type LogLevel } from '../core';
import { isBaselineWaived, type BaselineRecord } from '../core/baselineGate';
import { withDevices, type DeviceEnvironment, type DeviceFailure, type DeviceOutcome, type DeviceRequest } from '../core/deviceLifecycle';
import { DeviceSourceConfigError, resolveDeviceSource, type DeviceSource } from '../core/deviceSourceConfig';
import {
  BaseScenarioOutcome,
  describeFailingScenario,
  triageRegressionFailures,
  type FailingScenario,
  type RegressionTriage,
  type TriagedScenario,
} from '../core/regressionTriage';
import { ParkReason } from '../forge/parkComment';
import { REGRESSION_SCENARIO_TAG } from '../proof/proofAssembler';
import { requireApplicationProfile } from './applicationTypeGate';
import { buildBaseScenarioRerun, type BaseScenarioRerun } from './baseScenarioRerun';
import type { ScenarioProofResult } from './scenarioProof';
import { parkWorkflow } from './workflowPark';
import type { WorkflowConfig } from './workflowInit';

// Its own file: the scenario phase's `android-emulator.log` would be truncated by the emulator of the re-run.
const EMULATOR_LOG_FILE = 'base-rerun-android-emulator.log';

export type PreExistingRegressionGate = (proof: ScenarioProofResult) => Promise<void>;

export interface PreExistingRegressionGateDeps {
  readonly rerunOnBase: BaseScenarioRerun;
  readonly readBaseline: () => BaselineRecord | undefined;
  readonly withDevices: typeof withDevices;
}

/** `null` when the tag failed without per-case results: the failing scenarios cannot be told apart. */
export function failingRegressionScenarios(proof: ScenarioProofResult): readonly FailingScenario[] | null {
  const result = proof.tagResults.find(tag => tag.resolvedTag === REGRESSION_SCENARIO_TAG);
  if (!result || result.passed || result.skipped) return [];
  if (!result.cases) return null;
  return result.cases
    .filter(testCase => testCase.status === 'failed')
    .map(({ name, classname }) => (classname === undefined ? { name } : { name, feature: classname }));
}

const rerunKey = ({ name, feature }: FailingScenario): string => `${feature ?? ''}\u0000${name}`;

function recordLine(statePath: string, message: string, level: LogLevel): void {
  log(message, level);
  AgentStateManager.appendLog(statePath, message);
}

function describeOutcome({ scenario, outcome }: TriagedScenario): { message: string; level: LogLevel } {
  const name = describeFailingScenario(scenario);
  switch (outcome) {
    case BaseScenarioOutcome.Failed:
      return { message: `Regression scenario "${name}" also fails on the base branch: pre-existing`, level: 'warn' };
    case BaseScenarioOutcome.Passed:
      return { message: `Regression scenario "${name}" passes on the base branch: introduced by this change`, level: 'info' };
    case BaseScenarioOutcome.NotRun:
      return { message: `Regression scenario "${name}" could not be run on the base branch: treated as introduced by this change`, level: 'info' };
  }
}

function logTriaged(statePath: string, triaged: readonly TriagedScenario[]): void {
  triaged.forEach((entry) => {
    const { message, level } = describeOutcome(entry);
    recordLine(statePath, message, level);
  });
}

// The scenario phase has already failed a profile that lacks a section, so in a real run the throw cannot be reached.
function deviceSourceForRerun(config: WorkflowConfig): DeviceSource | null {
  const resolution = resolveDeviceSource(config.projectConfig.deviceSources, requireApplicationProfile(config).platforms);
  if (resolution.kind === 'not_required') return null;
  if (resolution.kind === 'resolved') return resolution.deviceSource;
  throw new DeviceSourceConfigError(resolution.section, resolution.message);
}

function deviceRequest(config: WorkflowConfig, deviceSource: DeviceSource): DeviceRequest {
  return {
    adwId: config.adwId,
    deviceSource,
    emulatorOutputPath: path.join(config.logsDir, EMULATOR_LOG_FILE),
    record: (message, level) => recordLine(config.orchestratorStatePath, message, level),
  };
}

function describeDeviceFailure(failure: DeviceFailure): string {
  if (failure.kind === 'boot_failed') {
    return `Base re-run: the ${failure.platform} device did not boot in ${failure.attempts} attempts; no scenario was re-run on the base branch. The output of the attempts:`;
  }
  return `Base re-run: ${failure.tool} is not on the host's PATH, so the ${failure.platform} device could not be created; no scenario was re-run on the base branch. Its output:`;
}

// The whole output goes to the execution log: the park comment cuts it.
function parkOnDeviceFailure(config: WorkflowConfig, failure: DeviceFailure): never {
  recordLine(config.orchestratorStatePath, describeDeviceFailure(failure), 'error');
  recordLine(config.orchestratorStatePath, failure.output, 'error');
  return parkWorkflow(config, { reason: ParkReason.DeviceBootFailed, failure });
}

function settleTriage(config: WorkflowConfig, triage: RegressionTriage): void {
  if (triage.kind === 'waived') {
    recordLine(config.orchestratorStatePath, 'The baseline was waived by `## Continue`: the failing regression scenarios go to the fix agent', 'info');
    return;
  }

  logTriaged(config.orchestratorStatePath, triage.triaged);
  if (triage.kind === 'pre_existing') {
    parkWorkflow(config, {
      reason: ParkReason.PreExistingRegression,
      baseBranch: config.defaultBranch,
      scenario: describeFailingScenario(triage.scenario),
    });
  }
}

/**
 * The real re-run is built on first need, so a run whose regression scenarios pass never touches git.
 * For a profile with platforms, the scenarios are re-run on an emulator and a simulator created for the triage and
 * removed after it, and a device that does not boot parks the workflow for `device_boot_failed`. A scenario re-run in
 * an earlier attempt is answered from memory, and a triage that re-runs nothing creates no device.
 * Returns only when no failing regression scenario also fails on the base branch; otherwise it parks.
 */
export function createPreExistingRegressionGate(
  config: WorkflowConfig,
  deps: Partial<PreExistingRegressionGateDeps> = {},
): PreExistingRegressionGate {
  const statePath = config.orchestratorStatePath;
  let realRerun: BaseScenarioRerun | undefined;
  const rerunOnBase: BaseScenarioRerun = deps.rerunOnBase ?? ((scenario, devices) => {
    realRerun ??= buildBaseScenarioRerun(config);
    return realRerun(scenario, devices);
  });
  const readBaseline = deps.readBaseline ?? (() => AgentStateManager.readTopLevelState(config.adwId)?.baseline);
  const runOnDevices = deps.withDevices ?? withDevices;

  // The gate keeps what it has learned about the base branch itself, not only in the re-run, so that it knows
  // before it boots devices whether a triage will re-run anything.
  const learned = new Map<string, BaseScenarioOutcome>();

  async function rerunAndLearn(scenario: FailingScenario, devices?: DeviceEnvironment): Promise<BaseScenarioOutcome> {
    const known = learned.get(rerunKey(scenario));
    if (known !== undefined) return known;

    const outcome = await rerunOnBase(scenario, devices);
    learned.set(rerunKey(scenario), outcome);
    return outcome;
  }

  async function triageOnBase(failing: readonly FailingScenario[], waived: boolean): Promise<DeviceOutcome<RegressionTriage>> {
    const triage = (devices?: DeviceEnvironment): Promise<RegressionTriage> =>
      triageRegressionFailures({ failing, waived, rerunOnBase: scenario => rerunAndLearn(scenario, devices) });

    // A waived baseline re-runs nothing, and a scenario learned before is answered from memory: neither needs a device.
    const rerunsSomething = !waived && failing.some(scenario => !learned.has(rerunKey(scenario)));
    const deviceSource = rerunsSomething ? deviceSourceForRerun(config) : null;
    if (deviceSource === null) return { kind: 'ready', result: await triage() };

    recordLine(statePath, 'Base re-run: creating an emulator and a simulator to re-run the failing regression scenarios on the base branch', 'info');
    return runOnDevices(deviceRequest(config, deviceSource), triage);
  }

  return async (proof) => {
    const failing = failingRegressionScenarios(proof);
    if (failing === null) {
      recordLine(statePath, 'The failing regression scenarios cannot be identified (no per-case results): they go to the fix agent', 'warn');
      return;
    }
    if (failing.length === 0) return;

    // Every park comes after `withDevices` has returned: `process.exit` would skip the devices' teardown.
    const outcome = await triageOnBase(failing, isBaselineWaived(readBaseline()));
    if (outcome.kind !== 'ready') return parkOnDeviceFailure(config, outcome);
    settleTriage(config, outcome.result);
  };
}
