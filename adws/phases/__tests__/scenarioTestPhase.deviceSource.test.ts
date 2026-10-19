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
import { DEVICE_SOURCE_SECTION_TITLES, DeviceSourceConfigError, type DeviceSource, type DeviceSourceSections } from '../../core/deviceSourceConfig';
import type { WorkflowConfig } from '../workflowInit';
import { fakeDevices, fakeLifecycle, makeConfig, passingProof } from './scenarioTestPhase.helpers';

const mockRunScenarioProof = vi.mocked(runScenarioProof);
const mockAppendLog = vi.mocked(AgentStateManager.appendLog);

const NO_DECLARED_SERVER = { readDeclaredDevServer: () => null };

function declaring(command: string): { deps: Partial<ScenarioTestPhaseDeps>; lifecycle: ReturnType<typeof fakeLifecycle> } {
  const lifecycle = fakeLifecycle();
  return { deps: { readDeclaredDevServer: () => command, withHealthyDevServer: lifecycle.withHealthyDevServer }, lifecycle };
}

beforeEach(() => {
  mockRunScenarioProof.mockReset();
});

describe('executeScenarioTestPhase — the device source of a profile with platforms', () => {
  const MOBILE = APPLICATION_TYPE_PROFILES['mobile:kotlincm'];

  const EVERY_SECTION: DeviceSource = {
    androidSystemImage: 'system-images;android-35;google_apis;arm64-v8a',
    androidDeviceProfile: 'pixel_8',
    iosDeviceType: 'com.apple.CoreSimulator.SimDeviceType.iPhone-16',
    iosRuntime: 'com.apple.CoreSimulator.SimRuntime.iOS-18-2',
  };

  const NO_SECTION: DeviceSourceSections = {
    androidSystemImage: null,
    androidDeviceProfile: null,
    iosDeviceType: null,
    iosRuntime: null,
  };

  const SECTIONS = Object.keys(DEVICE_SOURCE_SECTION_TITLES) as Array<keyof DeviceSourceSections>;

  function withDeviceSources(config: WorkflowConfig, deviceSources: DeviceSourceSections): WorkflowConfig {
    return { ...config, projectConfig: { ...config.projectConfig, deviceSources } };
  }

  async function deviceSourceError(config: WorkflowConfig, deps: Partial<ScenarioTestPhaseDeps> = NO_DECLARED_SERVER): Promise<DeviceSourceConfigError> {
    try {
      await executeScenarioTestPhase(config, deps);
    } catch (error) {
      if (error instanceof DeviceSourceConfigError) return error;
      throw error;
    }
    throw new Error('executeScenarioTestPhase resolved: it should have failed with a DeviceSourceConfigError');
  }

  beforeEach(() => {
    mockAppendLog.mockClear();
  });

  it.each(SECTIONS)('fails before anything runs when %s is missing: the error names its section, no proof runs and no dev server starts', async (missing) => {
    const { deps, lifecycle } = declaring('bun run dev');
    const config = withDeviceSources(makeConfig({ applicationProfile: MOBILE }), { ...EVERY_SECTION, [missing]: null });

    const error = await deviceSourceError(config, deps);

    expect(error.message).toContain(`"## ${DEVICE_SOURCE_SECTION_TITLES[missing]}"`);
    expect(mockRunScenarioProof).not.toHaveBeenCalled();
    expect(lifecycle.configs).toHaveLength(0);
  });

  it('names only the first missing section, in the order of the four, when several are missing', async () => {
    const config = withDeviceSources(makeConfig({ applicationProfile: MOBILE }), { ...EVERY_SECTION, iosRuntime: null, androidDeviceProfile: null });

    const error = await deviceSourceError(config);

    expect(error.section).toBe('## Android Device Profile');
    expect(error.message).not.toContain('iOS Runtime');
  });

  it('writes the message to the run log', async () => {
    const config = withDeviceSources(makeConfig({ applicationProfile: MOBILE }), { ...EVERY_SECTION, iosRuntime: null });

    const error = await deviceSourceError(config);

    expect(mockAppendLog).toHaveBeenCalledWith('/state.json', expect.stringContaining(error.message));
  });

  it.each([
    ['scenariosMd is empty', { scenariosMd: '' }],
    ['the run-by-tag command is N/A', { runScenariosByTag: 'N/A' }],
  ])('fails even when no scenario is configured, because the device source is required before the skip: %s', async (_case, overrides) => {
    const config = withDeviceSources(makeConfig({ applicationProfile: MOBILE, ...overrides }), { ...EVERY_SECTION, iosRuntime: null });

    await deviceSourceError(config);

    expect(mockRunScenarioProof).not.toHaveBeenCalled();
  });

  it('runs the proof, on the devices the device lifecycle creates, when every section is set', async () => {
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);
    const config = withDeviceSources(makeConfig({ applicationProfile: MOBILE }), EVERY_SECTION);
    const { withDevices, requests } = fakeDevices();

    const result = await executeScenarioTestPhase(config, { ...NO_DECLARED_SERVER, withDevices });

    expect(mockRunScenarioProof).toHaveBeenCalledOnce();
    expect(requests).toHaveLength(1);
    expect(result.scenarioProof).toEqual(passingProof);
  });

  it.each([
    ['cli', APPLICATION_TYPE_PROFILES.cli],
    ['web', APPLICATION_TYPE_PROFILES.web],
  ])('ignores the sections of a %s profile, which declares no platform: with none set the proof runs once and nothing throws', async (_type, profile) => {
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);
    const config = withDeviceSources(makeConfig({ applicationProfile: profile }), NO_SECTION);

    const result = await executeScenarioTestPhase(config, NO_DECLARED_SERVER);

    expect(mockRunScenarioProof).toHaveBeenCalledOnce();
    expect(result.scenarioProof).toEqual(passingProof);
  });
});
