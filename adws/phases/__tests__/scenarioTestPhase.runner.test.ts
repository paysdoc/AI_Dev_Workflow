import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../scenarioProof', () => ({
  runScenarioProof: vi.fn(),
}));

vi.mock('../../core/devServerLifecycle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../core/devServerLifecycle')>()),
  withDevServer: vi.fn(),
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
import { withDevServer } from '../../core/devServerLifecycle';
import { APPLICATION_TYPE_PROFILES } from '../../core/applicationType';
import { ADW_PLAYWRIGHT_RUN_BY_TAG } from '../../core/adwPlaywrightProject';
import { makeConfig, passingProof } from './scenarioTestPhase.helpers';

const mockRunScenarioProof = vi.mocked(runScenarioProof);
const mockWithDevServer = vi.mocked(withDevServer);

/** The options the one scenario run was started with. */
function proofOptions(): Parameters<typeof runScenarioProof>[0] {
  expect(mockRunScenarioProof).toHaveBeenCalledOnce();
  return mockRunScenarioProof.mock.calls[0][0];
}

beforeEach(() => {
  mockRunScenarioProof.mockReset();
  mockWithDevServer.mockReset();
  mockWithDevServer.mockImplementation(async (_cfg, work) => work());
});

describe('executeScenarioTestPhase — a cli repository runs the scenario runner its descriptors name', () => {
  it("keeps today's command, step definition directory, extensions and shared proof directory", async () => {
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);

    await executeScenarioTestPhase(makeConfig({ applicationProfile: APPLICATION_TYPE_PROFILES.cli }));

    const { runByTagCommand, stepDefDirectory, stepDefExtensions, proofDirPerTag } = proofOptions();
    expect(runByTagCommand).toBe('bunx cucumber-js --tags {tag}');
    expect(stepDefDirectory).toBe('features/step_definitions');
    expect(stepDefExtensions).toEqual(['.ts']);
    expect(proofDirPerTag).toBe(false);
  });

  it('also hands the run the application address, which only adds a variable', async () => {
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);

    await executeScenarioTestPhase(makeConfig({ applicationProfile: APPLICATION_TYPE_PROFILES.cli }));

    const { env } = proofOptions();
    expect(env).toEqual({ ADW_APPLICATION_URL: 'http://localhost:4567' });
  });
});

describe("executeScenarioTestPhase — a web repository runs ADW's Playwright project", () => {
  it("runs ADW's command over features/steps in .ts with a proof directory per tag, whatever the descriptors name", async () => {
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);

    await executeScenarioTestPhase(makeConfig({ applicationProfile: APPLICATION_TYPE_PROFILES.web, runScenariosByTag: 'npx cucumber-js --tags @{tag}' }));

    const { runByTagCommand, stepDefDirectory, stepDefExtensions, proofDirPerTag } = proofOptions();
    expect(runByTagCommand).toBe(ADW_PLAYWRIGHT_RUN_BY_TAG);
    expect(stepDefDirectory).toBe('features/steps');
    expect(stepDefExtensions).toEqual(['.ts']);
    expect(proofDirPerTag).toBe(true);
  });

  it('hands the run the address of the dev server ADW starts', async () => {
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);

    await executeScenarioTestPhase(makeConfig({ applicationProfile: APPLICATION_TYPE_PROFILES.web }));

    const { env } = proofOptions();
    expect(env).toEqual({ ADW_APPLICATION_URL: 'http://localhost:4567' });
  });

  it('runs although the descriptors name N/A, which only a descriptor runner can mean', async () => {
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);

    const result = await executeScenarioTestPhase(makeConfig({ applicationProfile: APPLICATION_TYPE_PROFILES.web, runScenariosByTag: 'N/A' }));

    expect(mockRunScenarioProof).toHaveBeenCalledOnce();
    expect(result.scenarioProof).toBe(passingProof);
  });

  it('still skips when the repository has no scenarios', async () => {
    const result = await executeScenarioTestPhase(makeConfig({ applicationProfile: APPLICATION_TYPE_PROFILES.web, scenariosMd: '' }));

    expect(result.scenarioProof).toBeUndefined();
    expect(mockRunScenarioProof).not.toHaveBeenCalled();
  });
});

describe('executeScenarioTestPhase — a config without an application profile', () => {
  it('rejects instead of assuming a type', async () => {
    await expect(executeScenarioTestPhase(makeConfig({ applicationProfile: null }))).rejects.toThrow(/requireApplicationProfile/);

    expect(mockRunScenarioProof).not.toHaveBeenCalled();
  });
});

describe('executeScenarioTestPhase — the dev server wraps the run in both modes', () => {
  it.each([
    ['cli', APPLICATION_TYPE_PROFILES.cli],
    ['web', APPLICATION_TYPE_PROFILES.web],
  ] as const)('wraps the run in the dev server for a %s repository too, with the scenario run inside it', async (_type, applicationProfile) => {
    const order: string[] = [];
    mockWithDevServer.mockImplementation(async (_cfg, work) => {
      order.push('server started');
      const result = await work();
      order.push('server stopped');
      return result;
    });
    mockRunScenarioProof.mockImplementationOnce(async () => {
      order.push('scenarios ran');
      return passingProof;
    });

    await executeScenarioTestPhase(makeConfig({ applicationProfile, startDevServer: 'bun run dev --port {PORT}' }));

    expect(order).toEqual(['server started', 'scenarios ran', 'server stopped']);
  });
});
