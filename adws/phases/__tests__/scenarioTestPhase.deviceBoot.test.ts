import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../scenarioProof', () => ({
  runScenarioProof: vi.fn(),
}));

vi.mock('../../cost', () => ({
  createPhaseCostRecords: vi.fn(() => []),
  PhaseCostStatus: { Success: 'success', Failed: 'failed', Partial: 'partial' },
}));

vi.mock('../../core', () => ({
  log: vi.fn(),
  AgentStateManager: {
    appendLog: vi.fn(),
  },
  emptyModelUsageMap: vi.fn(() => ({})),
}));

import { executeScenarioTestPhase } from '../scenarioTestPhase';
import { runScenarioProof } from '../scenarioProof';
import { AgentStateManager } from '../../core';
import { APPLICATION_TYPE_PROFILES } from '../../core/applicationType';
import { DeviceSourceConfigError } from '../../core/deviceSourceConfig';
import { ParkReason, buildParkComment, parkDirectives } from '../../forge/parkComment';
import {
  BOOT_FAILED,
  EVERY_DEVICE_SOURCE,
  Parked,
  TOOL_MISSING,
  failingDevices,
  fakeDevices,
  makeConfig,
  passingProof,
  failingProof,
  recordingPark,
  recordingServer,
} from './scenarioTestPhase.helpers';

const mockRunScenarioProof = vi.mocked(runScenarioProof);
const mockAppendLog = vi.mocked(AgentStateManager.appendLog);

const MOBILE = APPLICATION_TYPE_PROFILES['mobile:kotlincm'];
const NO_DECLARED_SERVER = { readDeclaredDevServer: () => null };

const mobileConfig = (overrides: Parameters<typeof makeConfig>[0] = {}) =>
  makeConfig({ applicationProfile: MOBILE, deviceSources: EVERY_DEVICE_SOURCE, ...overrides });

const loggedToState = (): string[] => mockAppendLog.mock.calls.filter(([statePath]) => statePath === '/state.json').map(([, message]) => message);

beforeEach(() => {
  mockRunScenarioProof.mockReset();
  mockAppendLog.mockReset();
});

describe('executeScenarioTestPhase — a device that does not come up parks the workflow', () => {
  it('parks for device_boot_failed with the failure when a device did not boot, runs no scenario, and does not return', async () => {
    const { withDevices } = failingDevices(BOOT_FAILED);
    const { park, parked } = recordingPark();

    await expect(executeScenarioTestPhase(mobileConfig(), { ...NO_DECLARED_SERVER, withDevices, park })).rejects.toBeInstanceOf(Parked);

    expect(parked).toEqual([{ reason: ParkReason.DeviceBootFailed, failure: BOOT_FAILED }]);
    expect(mockRunScenarioProof).not.toHaveBeenCalled();
  });

  it('parks for device_boot_failed too when a host tool is missing, with evidence that carries the tool', async () => {
    const { withDevices } = failingDevices(TOOL_MISSING);
    const { park, parked } = recordingPark();

    await expect(executeScenarioTestPhase(mobileConfig(), { ...NO_DECLARED_SERVER, withDevices, park })).rejects.toBeInstanceOf(Parked);

    expect(parked).toEqual([{ reason: ParkReason.DeviceBootFailed, failure: TOOL_MISSING }]);
    expect(mockRunScenarioProof).not.toHaveBeenCalled();
  });

  it('parks with evidence that makes a comment naming the platform, quoting the output, and saying that "## Retry" re-runs the scenario phase', async () => {
    const { withDevices } = failingDevices(BOOT_FAILED);
    const { park, parked } = recordingPark();
    await expect(executeScenarioTestPhase(mobileConfig(), { ...NO_DECLARED_SERVER, withDevices, park })).rejects.toBeInstanceOf(Parked);

    const comment = buildParkComment('test-id', parked[0]);

    expect(comment).toContain('`android`');
    expect(comment).toContain('\n    PANIC: Broken AVD system path');
    expect(parkDirectives(parked[0]).retry).toContain('re-runs the scenario phase');
    expect(comment).toContain(`\`## Retry\` — ${parkDirectives(parked[0]).retry}`);
  });

  it.each([
    ['a device that did not boot', BOOT_FAILED, 'Scenario test phase: the android device did not boot in 3 attempts; no scenario ran. The output of the attempts:'],
    ['a missing host tool', TOOL_MISSING, "Scenario test phase: xcrun simctl is not on the host's PATH, so the ios device could not be created; no scenario ran. Its output:"],
  ])('writes the summary and then the whole output to the execution log before it parks, for %s', async (_case, failure, summary) => {
    const events: string[] = [];
    mockAppendLog.mockImplementation((_statePath, message) => {
      events.push(`logged ${message}`);
    });
    const { withDevices } = failingDevices(failure);
    const { park } = recordingPark(events);

    await expect(executeScenarioTestPhase(mobileConfig(), { ...NO_DECLARED_SERVER, withDevices, park })).rejects.toBeInstanceOf(Parked);

    expect(loggedToState()).toEqual(expect.arrayContaining([summary, failure.output]));
    expect(events.slice(-3)).toEqual([`logged ${summary}`, `logged ${failure.output}`, 'parked']);
  });

  it('parks after the dev server the repository declares has stopped, so that the park leaves no server running', async () => {
    const events: string[] = [];
    const { withDevices } = failingDevices(BOOT_FAILED, events);
    const { park } = recordingPark(events);

    await expect(
      executeScenarioTestPhase(mobileConfig(), {
        readDeclaredDevServer: () => 'bun run dev --port {PORT}',
        withHealthyDevServer: recordingServer(events),
        withDevices,
        park,
      }),
    ).rejects.toBeInstanceOf(Parked);

    expect(events).toEqual(['server started', 'devices failed', 'server stopped', 'parked']);
  });

  it('starts afresh on a later run, as "## Retry" resumes it: devices are asked for again and the scenarios run', async () => {
    const config = mobileConfig();
    const { park } = recordingPark();
    await expect(executeScenarioTestPhase(config, { ...NO_DECLARED_SERVER, withDevices: failingDevices(BOOT_FAILED).withDevices, park })).rejects.toBeInstanceOf(Parked);
    const events: string[] = [];
    const { withDevices, requests } = fakeDevices(events);
    mockRunScenarioProof.mockImplementationOnce(async () => {
      events.push('scenarios ran');
      return passingProof;
    });

    const result = await executeScenarioTestPhase(config, { ...NO_DECLARED_SERVER, withDevices, park });

    expect(requests).toHaveLength(1);
    expect(events).toEqual(['devices ready', 'scenarios ran', 'devices removed']);
    expect(result.scenarioProof).toEqual(passingProof);
  });

  it('still throws, and does not park, for a device source the repository does not name', async () => {
    const { withDevices, requests } = fakeDevices();
    const { park, parked } = recordingPark();

    await expect(executeScenarioTestPhase(mobileConfig({ deviceSources: undefined }), { ...NO_DECLARED_SERVER, withDevices, park })).rejects.toBeInstanceOf(DeviceSourceConfigError);

    expect(parked).toEqual([]);
    expect(requests).toEqual([]);
  });
});

describe('executeScenarioTestPhase — devices that are ready do not park the workflow', () => {
  it('does not park when the scenarios pass', async () => {
    const { withDevices } = fakeDevices();
    const { park, parked } = recordingPark();
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);

    const result = await executeScenarioTestPhase(mobileConfig(), { ...NO_DECLARED_SERVER, withDevices, park });

    expect(parked).toEqual([]);
    expect(result.scenarioProof).toEqual(passingProof);
  });

  it('does not park when a scenario fails: a failing scenario is the change’s, not the host’s', async () => {
    const { withDevices } = fakeDevices();
    const { park, parked } = recordingPark();
    mockRunScenarioProof.mockResolvedValueOnce(failingProof);

    const result = await executeScenarioTestPhase(mobileConfig(), { ...NO_DECLARED_SERVER, withDevices, park });

    expect(parked).toEqual([]);
    expect(result.scenarioProof?.hasBlockerFailures).toBe(true);
  });
});

describe.each([
  ['cli', APPLICATION_TYPE_PROFILES.cli],
  ['web', APPLICATION_TYPE_PROFILES.web],
])('executeScenarioTestPhase — a %s repository reaches neither the device lifecycle nor the park', (_type, profile) => {
  it('asks for no device and does not park, even on a host whose devices would not boot', async () => {
    const { withDevices, requests } = failingDevices(BOOT_FAILED);
    const { park, parked } = recordingPark();
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);

    const result = await executeScenarioTestPhase(makeConfig({ applicationProfile: profile, deviceSources: EVERY_DEVICE_SOURCE }), { ...NO_DECLARED_SERVER, withDevices, park });

    expect(requests).toEqual([]);
    expect(parked).toEqual([]);
    expect(result.scenarioProof).toEqual(passingProof);
  });
});
