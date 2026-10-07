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
import { APPLICATION_TYPE_PROFILES } from '../../core/applicationType';
import { ADW_PLAYWRIGHT_RUN_BY_TAG } from '../../core/adwPlaywrightProject';
import type { HealthyDevServerOutcome } from '../../core/devServerLifecycle';
import { makeConfig, passingProof } from './scenarioTestPhase.helpers';

const mockRunScenarioProof = vi.mocked(runScenarioProof);

const NO_DECLARED_SERVER = { readDeclaredDevServer: () => null };

/** The options the one scenario run was started with. */
function proofOptions(): Parameters<typeof runScenarioProof>[0] {
  expect(mockRunScenarioProof).toHaveBeenCalledOnce();
  return mockRunScenarioProof.mock.calls[0][0];
}

beforeEach(() => {
  mockRunScenarioProof.mockReset();
});

describe('executeScenarioTestPhase — a cli repository runs the scenario runner its descriptors name', () => {
  it("keeps today's command, step definition directory, extensions and shared proof directory", async () => {
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);

    await executeScenarioTestPhase(makeConfig({ applicationProfile: APPLICATION_TYPE_PROFILES.cli }), NO_DECLARED_SERVER);

    const { runByTagCommand, stepDefDirectory, stepDefExtensions, proofDirPerTag } = proofOptions();
    expect(runByTagCommand).toBe('bunx cucumber-js --tags {tag}');
    expect(stepDefDirectory).toBe('features/step_definitions');
    expect(stepDefExtensions).toEqual(['.ts']);
    expect(proofDirPerTag).toBe(false);
  });

  it('hands the run the cli profile and the scenario directory the descriptors name, which hold its feature files', async () => {
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);

    await executeScenarioTestPhase(makeConfig({ applicationProfile: APPLICATION_TYPE_PROFILES.cli, scenarioDirectory: 'e2e/features/' }));

    const { applicationProfile, featureDirectory } = proofOptions();
    expect(applicationProfile).toBe(APPLICATION_TYPE_PROFILES.cli);
    expect(featureDirectory).toBe('e2e/features/');
  });

  it('also hands the run the application address, which only adds a variable', async () => {
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);

    await executeScenarioTestPhase(makeConfig({ applicationProfile: APPLICATION_TYPE_PROFILES.cli }), NO_DECLARED_SERVER);

    const { env } = proofOptions();
    expect(env).toEqual({ ADW_APPLICATION_URL: 'http://localhost:4567' });
  });
});

describe("executeScenarioTestPhase — a web repository runs ADW's Playwright project", () => {
  it("runs ADW's command over features/steps in .ts with a proof directory per tag, whatever the descriptors name", async () => {
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);

    await executeScenarioTestPhase(
      makeConfig({ applicationProfile: APPLICATION_TYPE_PROFILES.web, runScenariosByTag: 'npx cucumber-js --tags @{tag}' }),
      NO_DECLARED_SERVER,
    );

    const { runByTagCommand, stepDefDirectory, stepDefExtensions, proofDirPerTag } = proofOptions();
    expect(runByTagCommand).toBe(ADW_PLAYWRIGHT_RUN_BY_TAG);
    expect(stepDefDirectory).toBe('features/steps');
    expect(stepDefExtensions).toEqual(['.ts']);
    expect(proofDirPerTag).toBe(true);
  });

  it("hands the run the web profile and the Playwright project's directory, whatever scenario directory the descriptors name", async () => {
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);

    await executeScenarioTestPhase(makeConfig({ applicationProfile: APPLICATION_TYPE_PROFILES.web, scenarioDirectory: 'e2e/features/' }));

    const { applicationProfile, featureDirectory } = proofOptions();
    expect(applicationProfile).toBe(APPLICATION_TYPE_PROFILES.web);
    expect(featureDirectory).toBe('features');
  });

  it('hands the run the address of the dev server ADW starts', async () => {
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);

    await executeScenarioTestPhase(makeConfig({ applicationProfile: APPLICATION_TYPE_PROFILES.web }), NO_DECLARED_SERVER);

    const { env } = proofOptions();
    expect(env).toEqual({ ADW_APPLICATION_URL: 'http://localhost:4567' });
  });

  it('runs although the descriptors name N/A, which only a descriptor runner can mean', async () => {
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);

    const result = await executeScenarioTestPhase(
      makeConfig({ applicationProfile: APPLICATION_TYPE_PROFILES.web, runScenariosByTag: 'N/A' }),
      NO_DECLARED_SERVER,
    );

    expect(mockRunScenarioProof).toHaveBeenCalledOnce();
    expect(result.scenarioProof).toBe(passingProof);
  });

  it('still skips when the repository has no scenarios', async () => {
    const result = await executeScenarioTestPhase(
      makeConfig({ applicationProfile: APPLICATION_TYPE_PROFILES.web, scenariosMd: '' }),
      NO_DECLARED_SERVER,
    );

    expect(result.scenarioProof).toBeUndefined();
    expect(mockRunScenarioProof).not.toHaveBeenCalled();
  });
});

describe('executeScenarioTestPhase — a config without an application profile', () => {
  it('rejects instead of assuming a type', async () => {
    await expect(executeScenarioTestPhase(makeConfig({ applicationProfile: null }), NO_DECLARED_SERVER)).rejects.toThrow(/requireApplicationProfile/);

    expect(mockRunScenarioProof).not.toHaveBeenCalled();
  });
});

describe('executeScenarioTestPhase — the dev server wraps the run in both modes', () => {
  it.each([
    ['cli', APPLICATION_TYPE_PROFILES.cli],
    ['web', APPLICATION_TYPE_PROFILES.web],
  ] as const)('wraps the run in the dev server for a %s repository too, with the scenario run inside it', async (_type, applicationProfile) => {
    const order: string[] = [];
    const withHealthyDevServer = (async <T>(_config: unknown, work: () => Promise<T>): Promise<HealthyDevServerOutcome<T>> => {
      order.push('server started');
      const result = await work();
      order.push('server stopped');
      return { started: true, result };
    }) as ScenarioTestPhaseDeps['withHealthyDevServer'];
    mockRunScenarioProof.mockImplementationOnce(async () => {
      order.push('scenarios ran');
      return passingProof;
    });

    await executeScenarioTestPhase(makeConfig({ applicationProfile }), {
      readDeclaredDevServer: () => 'bun run dev --port {PORT}',
      withHealthyDevServer,
    });

    expect(order).toEqual(['server started', 'scenarios ran', 'server stopped']);
  });
});
