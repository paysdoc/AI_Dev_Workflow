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

import { executeScenarioTestPhase, type ScenarioTestPhaseDeps } from '../scenarioTestPhase';
import { runScenarioProof } from '../scenarioProof';
import { AgentStateManager } from '../../core';
import { APPLICATION_TYPE_PROFILES } from '../../core/applicationType';
import {
  EVERY_DEVICE_SOURCE,
  STAND_IN_DEVICES,
  fakeDevices,
  fakeLifecycle,
  makeConfig,
  passingProof,
  recordingServer,
} from './scenarioTestPhase.helpers';

const mockRunScenarioProof = vi.mocked(runScenarioProof);
const mockAppendLog = vi.mocked(AgentStateManager.appendLog);

const MOBILE = APPLICATION_TYPE_PROFILES['mobile:kotlincm'];
const NO_DECLARED_SERVER = { readDeclaredDevServer: () => null };

const mobileConfig = (overrides: Parameters<typeof makeConfig>[0] = {}) =>
  makeConfig({ applicationProfile: MOBILE, deviceSources: EVERY_DEVICE_SOURCE, ...overrides });

/** The scenario run notes in `events` that it ran. */
function scenariosRunning(events: string[]): void {
  mockRunScenarioProof.mockImplementation(async () => {
    events.push('scenarios ran');
    return passingProof;
  });
}

beforeEach(() => {
  mockRunScenarioProof.mockReset();
  mockAppendLog.mockClear();
});

describe('executeScenarioTestPhase — a profile with platforms runs the scenario proof on devices of its own', () => {
  it('hands the run command the three device variables beside the application address', async () => {
    const { withDevices } = fakeDevices();
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);

    await executeScenarioTestPhase(mobileConfig(), { ...NO_DECLARED_SERVER, withDevices });

    expect(mockRunScenarioProof).toHaveBeenCalledOnce();
    expect(mockRunScenarioProof.mock.calls[0][0].env).toEqual({ ADW_APPLICATION_URL: 'http://localhost:4567', ...STAND_IN_DEVICES });
  });

  it('asks for the devices of this workflow once: its ADW ID, the device source resolved from the sections, and an emulator log in the logs directory', async () => {
    const { withDevices, requests } = fakeDevices();
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);

    await executeScenarioTestPhase(mobileConfig(), { ...NO_DECLARED_SERVER, withDevices });

    expect(requests).toHaveLength(1);
    expect(requests[0].adwId).toBe('test-id');
    expect(requests[0].deviceSource).toEqual(EVERY_DEVICE_SOURCE);
    expect(requests[0].emulatorOutputPath).toBe('/logs/android-emulator.log');
  });

  it('runs the scenarios while the devices exist', async () => {
    const events: string[] = [];
    const { withDevices } = fakeDevices(events);
    scenariosRunning(events);

    await executeScenarioTestPhase(mobileConfig(), { ...NO_DECLARED_SERVER, withDevices });

    expect(events).toEqual(['devices ready', 'scenarios ran', 'devices removed']);
  });

  it('returns the proof and puts it on the context, as it does without devices', async () => {
    const { withDevices } = fakeDevices();
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);
    const config = mobileConfig();

    const result = await executeScenarioTestPhase(config, { ...NO_DECLARED_SERVER, withDevices });

    expect(result.scenarioProof).toEqual(passingProof);
    expect(config.ctx.scenarioProof).toEqual(passingProof);
  });

  it('gives the orchestrator log every line the device lifecycle records', async () => {
    const { withDevices, requests } = fakeDevices();
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);
    await executeScenarioTestPhase(mobileConfig(), { ...NO_DECLARED_SERVER, withDevices });
    const line = 'The Android emulator "adw-test-id" (emulator-5580) booted in 41.0s';

    requests[0].record(line, 'info');

    expect(mockAppendLog).toHaveBeenCalledWith('/state.json', line);
  });

  it('fails with the error of the scenario run, and has removed the devices by then', async () => {
    const events: string[] = [];
    const { withDevices } = fakeDevices(events);
    const failure = new Error('the scenario command could not be started');
    mockRunScenarioProof.mockRejectedValueOnce(failure);

    await expect(executeScenarioTestPhase(mobileConfig(), { ...NO_DECLARED_SERVER, withDevices })).rejects.toBe(failure);

    expect(events).toEqual(['devices ready', 'devices removed']);
  });

  it('fails with the error the device lifecycle throws, and runs no scenario', async () => {
    const failure = new Error('The iOS simulator could not be booted');
    const withDevices = (async () => { throw failure; }) as ScenarioTestPhaseDeps['withDevices'];

    await expect(executeScenarioTestPhase(mobileConfig(), { ...NO_DECLARED_SERVER, withDevices })).rejects.toBe(failure);

    expect(mockRunScenarioProof).not.toHaveBeenCalled();
  });
});

describe('executeScenarioTestPhase — the devices and a dev server the repository declares', () => {
  it('creates the devices inside the server, and removes them before it stops', async () => {
    const events: string[] = [];
    const { withDevices } = fakeDevices(events);
    scenariosRunning(events);

    await executeScenarioTestPhase(mobileConfig(), {
      readDeclaredDevServer: () => 'bun run dev --port {PORT}',
      withHealthyDevServer: recordingServer(events),
      withDevices,
    });

    expect(events).toEqual(['server started', 'devices ready', 'scenarios ran', 'devices removed', 'server stopped']);
  });

  it('creates no device when the server does not start', async () => {
    const { withDevices, requests } = fakeDevices();
    const lifecycle = fakeLifecycle({ output: 'Error: Cannot find module' });

    const result = await executeScenarioTestPhase(mobileConfig(), {
      readDeclaredDevServer: () => 'bun run dev --port {PORT}',
      withHealthyDevServer: lifecycle.withHealthyDevServer,
      withDevices,
    });

    expect(requests).toEqual([]);
    expect(mockRunScenarioProof).not.toHaveBeenCalled();
    expect(result.scenarioProof).toBeUndefined();
  });
});

describe('executeScenarioTestPhase — no scenario to run means no device to create', () => {
  it.each([
    ['scenariosMd is empty', { scenariosMd: '' }],
    ['the run-by-tag command is N/A', { runScenariosByTag: 'N/A' }],
  ])('creates no device when %s', async (_case, overrides) => {
    const { withDevices, requests } = fakeDevices();

    await executeScenarioTestPhase(mobileConfig(overrides), { ...NO_DECLARED_SERVER, withDevices });

    expect(requests).toEqual([]);
    expect(mockRunScenarioProof).not.toHaveBeenCalled();
  });
});

describe.each([
  ['cli', APPLICATION_TYPE_PROFILES.cli],
  ['web', APPLICATION_TYPE_PROFILES.web],
])('executeScenarioTestPhase — a %s repository declares no platform, so it issues no device command', (_type, profile) => {
  it.each([
    ['names no device source', undefined],
    ['names every device source', EVERY_DEVICE_SOURCE],
  ])('asks for no device, and hands the run only the application address, when it %s', async (_case, deviceSources) => {
    const { withDevices, requests } = fakeDevices();
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);

    await executeScenarioTestPhase(makeConfig({ applicationProfile: profile, deviceSources }), { ...NO_DECLARED_SERVER, withDevices });

    expect(requests).toEqual([]);
    expect(mockRunScenarioProof).toHaveBeenCalledOnce();
    expect(mockRunScenarioProof.mock.calls[0][0].env).toEqual({ ADW_APPLICATION_URL: 'http://localhost:4567' });
  });
});
