import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import { AgentStateManager } from '../../core/agentState';
import { APPLICATION_TYPE_PROFILES } from '../../core/applicationType';
import { DeviceSourceConfigError, parseDeviceSourceSections, type DeviceSourceSections } from '../../core/deviceSourceConfig';
import { BaseScenarioOutcome } from '../../core/regressionTriage';
import { ParkReason, buildParkComment } from '../../forge/parkComment';
import { createPreExistingRegressionGate, type PreExistingRegressionGateDeps } from '../preExistingRegressionGate';
import type { WorkflowConfig } from '../workflowInit';
import {
  ADW_ID,
  ExitSignal,
  PASSED_BASELINE,
  WAIVED_BASELINE,
  cleanUpGateFixtures,
  executionLog,
  failingRegression,
  makeConfig,
  proofOf,
  scriptedRerun,
  stubProcessExit,
  tagResult,
  testCase,
} from './preExistingRegressionGate.helpers';
import {
  BOOT_FAILED,
  EVERY_DEVICE_SOURCE,
  STAND_IN_DEVICES,
  TOOL_MISSING,
  failingDevices,
  fakeDevices,
} from './scenarioTestPhase.helpers';

const MOBILE = APPLICATION_TYPE_PROFILES['mobile:kotlincm'];

beforeEach(stubProcessExit);
afterEach(cleanUpGateFixtures);

const mobileConfig = (
  commentOnIssue: (issueNumber: number, body: string) => void = vi.fn(),
  deviceSources: DeviceSourceSections = EVERY_DEVICE_SOURCE,
) => makeConfig(commentOnIssue, { applicationProfile: MOBILE, deviceSources });

const gateOf = (config: WorkflowConfig, deps: Partial<PreExistingRegressionGateDeps>) =>
  createPreExistingRegressionGate(config, { readBaseline: () => PASSED_BASELINE, ...deps });

const failsA = () => failingRegression(testCase('A', 'failed'));
const failsAAndB = () => failingRegression(testCase('A', 'failed'), testCase('B', 'failed'));

describe('the pre-existing regression gate — a profile with platforms re-runs on devices of its own', () => {
  it('hands each re-run on the base branch the three device variables', async () => {
    const { withDevices } = fakeDevices();
    const { rerunOnBase, rerun } = scriptedRerun({ A: BaseScenarioOutcome.Passed, B: BaseScenarioOutcome.Passed });

    await gateOf(mobileConfig(), { rerunOnBase, withDevices })(failsAAndB());

    expect(rerun.mock.calls.map(([, devices]) => devices)).toEqual([STAND_IN_DEVICES, STAND_IN_DEVICES]);
  });

  it('asks once for the devices of all the failing scenarios: for this workflow, from the device source the sections name, with an emulator log of the re-run’s own', async () => {
    const config = mobileConfig();
    const { withDevices, requests } = fakeDevices();
    const { rerunOnBase } = scriptedRerun({ A: BaseScenarioOutcome.Passed, B: BaseScenarioOutcome.Passed });

    await gateOf(config, { rerunOnBase, withDevices })(failsAAndB());

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      adwId: ADW_ID,
      deviceSource: EVERY_DEVICE_SOURCE,
      emulatorOutputPath: path.join(config.logsDir, 'base-rerun-android-emulator.log'),
    });
  });

  it('re-runs the scenarios while the devices exist, and has removed them when it returns', async () => {
    const events: string[] = [];
    const { withDevices } = fakeDevices(events);
    const { rerunOnBase } = scriptedRerun({ A: BaseScenarioOutcome.Passed, B: BaseScenarioOutcome.Passed }, events);

    await gateOf(mobileConfig(), { rerunOnBase, withDevices })(failsAAndB());

    expect(events).toEqual(['devices ready', 're-ran A', 're-ran B', 'devices removed']);
  });

  it('parks for a pre-existing regression only once the devices are removed', async () => {
    const events: string[] = [];
    const commentOnIssue = vi.fn(() => { events.push('parked'); });
    const { withDevices } = fakeDevices(events);
    const { rerunOnBase } = scriptedRerun({ A: BaseScenarioOutcome.Failed }, events);

    await expect(gateOf(mobileConfig(commentOnIssue), { rerunOnBase, withDevices })(failsA())).rejects.toThrow(ExitSignal);

    expect(events).toEqual(['devices ready', 're-ran A', 'devices removed', 'parked']);
    expect(AgentStateManager.readTopLevelState(ADW_ID)).toMatchObject({ workflowStage: 'human_gated', parkReason: 'pre_existing_regression' });
  });

  it('gives the execution log every line the device lifecycle records, after a line that says the devices are for the re-run on the base branch', async () => {
    const config = mobileConfig();
    const { withDevices, requests } = fakeDevices();
    const { rerunOnBase } = scriptedRerun({ A: BaseScenarioOutcome.Passed });
    await gateOf(config, { rerunOnBase, withDevices })(failsA());
    const line = 'The Android emulator "adw-x" (emulator-5580) booted in 41.0s';

    requests[0].record(line, 'info');

    const lines = executionLog(config).split('\n');
    const creating = lines.findIndex(entry => /Base re-run: creating an emulator and a simulator/.test(entry));
    expect(creating).toBeGreaterThanOrEqual(0);
    expect(lines.findIndex(entry => entry.includes(line))).toBeGreaterThan(creating);
  });
});

describe('the pre-existing regression gate — a device that does not come up parks the workflow', () => {
  it.each([
    ['a device that did not boot', BOOT_FAILED],
    ['a missing host tool', TOOL_MISSING],
  ])('parks for device_boot_failed with the failure, and re-runs nothing on the base branch, for %s', async (_case, failure) => {
    const commentOnIssue = vi.fn();
    const { withDevices } = failingDevices(failure);
    const { rerunOnBase, rerun } = scriptedRerun({ A: BaseScenarioOutcome.Failed });

    await expect(gateOf(mobileConfig(commentOnIssue), { rerunOnBase, withDevices })(failsA())).rejects.toThrow(ExitSignal);

    expect(process.exit).toHaveBeenCalledWith(0);
    expect(AgentStateManager.readTopLevelState(ADW_ID)).toMatchObject({ workflowStage: 'human_gated', parkReason: 'device_boot_failed' });
    expect(commentOnIssue).toHaveBeenCalledTimes(1);
    expect(commentOnIssue).toHaveBeenCalledWith(990, buildParkComment(ADW_ID, { reason: ParkReason.DeviceBootFailed, failure }));
    expect(rerun).not.toHaveBeenCalled();
  });

  it.each([
    ['a device that did not boot', BOOT_FAILED, 'Base re-run: the android device did not boot in 3 attempts; no scenario was re-run on the base branch. The output of the attempts:'],
    ['a missing host tool', TOOL_MISSING, "Base re-run: xcrun simctl is not on the host's PATH, so the ios device could not be created; no scenario was re-run on the base branch. Its output:"],
  ])('writes the summary and then the whole output to the execution log before it parks, for %s', async (_case, failure, summary) => {
    const config = mobileConfig();
    const { withDevices } = failingDevices(failure);
    const { rerunOnBase } = scriptedRerun({ A: BaseScenarioOutcome.Failed });

    await expect(gateOf(config, { rerunOnBase, withDevices })(failsA())).rejects.toThrow(ExitSignal);

    const log = executionLog(config);
    const summaryAt = log.indexOf(summary);
    const outputAt = log.indexOf(failure.output);
    const parkedAt = log.indexOf('Workflow parked as human_gated: device_boot_failed');
    expect(summaryAt).toBeGreaterThanOrEqual(0);
    expect(outputAt).toBeGreaterThan(summaryAt);
    expect(parkedAt).toBeGreaterThan(outputAt);
  });
});

describe('the pre-existing regression gate — no re-run means no device', () => {
  it('asks for no device when the baseline was waived, and leaves every failure to the fix agent', async () => {
    const config = mobileConfig();
    const { withDevices, requests } = fakeDevices();
    const { rerunOnBase, rerun } = scriptedRerun({ A: BaseScenarioOutcome.Failed });

    await expect(gateOf(config, { rerunOnBase, withDevices, readBaseline: () => WAIVED_BASELINE })(failsA())).resolves.toBeUndefined();

    expect(requests).toEqual([]);
    expect(rerun.mock.calls).toEqual([]);
    expect(executionLog(config)).toMatch(/baseline was waived/);
  });

  it('asks for no device when no regression scenario failed, or when the failing ones cannot be identified', async () => {
    const { withDevices, requests } = fakeDevices();
    const { rerunOnBase } = scriptedRerun({});
    const gate = gateOf(mobileConfig(), { rerunOnBase, withDevices });

    await gate(proofOf(tagResult('@regression')));
    await gate(proofOf(tagResult('@regression', { passed: false, exitCode: 1 })));

    expect(requests).toEqual([]);
  });

  it('asks for no device for a later proof whose failing scenarios it has re-run before, and answers them from what it learned', async () => {
    const { withDevices, requests } = fakeDevices();
    const { rerunOnBase, rerun } = scriptedRerun({ A: BaseScenarioOutcome.Passed });
    const gate = gateOf(mobileConfig(), { rerunOnBase, withDevices });

    await gate(failsA());
    await expect(gate(failsA())).resolves.toBeUndefined();

    expect(requests).toHaveLength(1);
    expect(rerun).toHaveBeenCalledTimes(1);
  });

  it('re-runs once a scenario that both platform runs report, and answers the duplicate from what it learned', async () => {
    const { withDevices, requests } = fakeDevices();
    const { rerunOnBase, rerun } = scriptedRerun({ A: BaseScenarioOutcome.Passed });

    await gateOf(mobileConfig(), { rerunOnBase, withDevices })(failingRegression(testCase('A', 'failed'), testCase('A', 'failed')));

    expect(requests).toHaveLength(1);
    expect(rerun).toHaveBeenCalledTimes(1);
  });

  it('learns a scenario the base branch could not run too, so that a later proof boots no device for it', async () => {
    const { withDevices, requests } = fakeDevices();
    const { rerunOnBase, rerun } = scriptedRerun({ A: BaseScenarioOutcome.NotRun });
    const gate = gateOf(mobileConfig(), { rerunOnBase, withDevices });

    await gate(failsA());
    await gate(failsA());

    expect(requests).toHaveLength(1);
    expect(rerun).toHaveBeenCalledTimes(1);
  });

  it('asks for devices again for a later proof with a failing scenario it has not re-run yet, and re-runs only that one', async () => {
    const { withDevices, requests } = fakeDevices();
    const { rerunOnBase, rerun } = scriptedRerun({ A: BaseScenarioOutcome.Passed, B: BaseScenarioOutcome.Passed });
    const gate = gateOf(mobileConfig(), { rerunOnBase, withDevices });

    await gate(failsA());
    await gate(failsAAndB());

    expect(requests).toHaveLength(2);
    expect(rerun.mock.calls.map(([scenario]) => scenario.name)).toEqual(['A', 'B']);
    expect(rerun.mock.calls.map(([, devices]) => devices)).toEqual([STAND_IN_DEVICES, STAND_IN_DEVICES]);
  });

  it('throws DeviceSourceConfigError naming the section, and asks for no device and re-runs nothing, when a device-source section is missing', async () => {
    const { withDevices, requests } = fakeDevices();
    const { rerunOnBase, rerun } = scriptedRerun({ A: BaseScenarioOutcome.Passed });
    const gate = gateOf(mobileConfig(vi.fn(), parseDeviceSourceSections('')), { rerunOnBase, withDevices });

    const thrown = await gate(failsA()).catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(DeviceSourceConfigError);
    expect(thrown).toMatchObject({ section: '## Android System Image' });
    expect(requests).toEqual([]);
    expect(rerun.mock.calls).toEqual([]);
  });
});

describe.each([
  ['cli', APPLICATION_TYPE_PROFILES.cli],
  ['web', APPLICATION_TYPE_PROFILES.web],
])('the pre-existing regression gate — a %s re-run is unchanged', (_type, applicationProfile) => {
  it.each([
    ['names no device source', undefined],
    ['names every device source', EVERY_DEVICE_SOURCE],
  ])('asks for no device and re-runs without devices, even on a host whose devices would not boot, when it %s', async (_case, deviceSources) => {
    const commentOnIssue = vi.fn();
    const { withDevices, requests } = failingDevices(BOOT_FAILED);
    const { rerunOnBase, rerun } = scriptedRerun({ A: BaseScenarioOutcome.Passed });
    const gate = gateOf(makeConfig(commentOnIssue, { applicationProfile, deviceSources }), { rerunOnBase, withDevices });

    await expect(gate(failsA())).resolves.toBeUndefined();

    expect(requests).toEqual([]);
    expect(rerun.mock.calls.map(([, devices]) => devices)).toEqual([undefined]);
    expect(commentOnIssue).not.toHaveBeenCalled();
  });
});
