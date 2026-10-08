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
import { createPhaseCostRecords } from '../../cost';
import { failingProof, fakeLifecycle, makeConfig, passingProof } from './scenarioTestPhase.helpers';

const mockRunScenarioProof = vi.mocked(runScenarioProof);
const mockCreatePhaseCostRecords = vi.mocked(createPhaseCostRecords);

const NO_DECLARED_SERVER = { readDeclaredDevServer: () => null };

function declaring(command: string): { deps: Partial<ScenarioTestPhaseDeps>; lifecycle: ReturnType<typeof fakeLifecycle> } {
  const lifecycle = fakeLifecycle();
  return { deps: { readDeclaredDevServer: () => command, withHealthyDevServer: lifecycle.withHealthyDevServer }, lifecycle };
}

beforeEach(() => {
  mockRunScenarioProof.mockReset();
  mockCreatePhaseCostRecords.mockReset();
  mockCreatePhaseCostRecords.mockReturnValue([]);
});

describe('executeScenarioTestPhase — skip when no scenarios', () => {
  it('returns passing result immediately when scenariosMd is empty', async () => {
    const { deps, lifecycle } = declaring('bun run dev');
    const config = makeConfig({ scenariosMd: '' });
    const result = await executeScenarioTestPhase(config, deps);

    expect(result.costUsd).toBe(0);
    expect(result.scenarioProof).toBeUndefined();
    expect(mockRunScenarioProof).not.toHaveBeenCalled();
    expect(lifecycle.configs).toHaveLength(0);
  });

  it('returns passing result when scenariosMd is whitespace only', async () => {
    const config = makeConfig({ scenariosMd: '   \n  ' });
    const result = await executeScenarioTestPhase(config, NO_DECLARED_SERVER);

    expect(result.scenarioProof).toBeUndefined();
    expect(mockRunScenarioProof).not.toHaveBeenCalled();
  });
});

describe('executeScenarioTestPhase — skip when runScenariosByTag is N/A', () => {
  it('returns passing result immediately when runScenariosByTag is N/A', async () => {
    const { deps, lifecycle } = declaring('bun run dev');
    const config = makeConfig({ runScenariosByTag: 'N/A' });
    const result = await executeScenarioTestPhase(config, deps);

    expect(result.scenarioProof).toBeUndefined();
    expect(mockRunScenarioProof).not.toHaveBeenCalled();
    expect(lifecycle.configs).toHaveLength(0);
  });
});

describe('executeScenarioTestPhase — without dev server', () => {
  it('calls runScenarioProof directly when the repository declares no dev server', async () => {
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);
    const lifecycle = fakeLifecycle();
    const config = makeConfig();

    await executeScenarioTestPhase(config, { ...NO_DECLARED_SERVER, withHealthyDevServer: lifecycle.withHealthyDevServer });

    expect(mockRunScenarioProof).toHaveBeenCalledOnce();
    expect(lifecycle.configs).toHaveLength(0);
  });

  it('passes correct options to runScenarioProof', async () => {
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);
    const config = makeConfig({ runScenariosByTag: 'bunx cucumber-js --tags {tag}' });

    await executeScenarioTestPhase(config, NO_DECLARED_SERVER);

    expect(mockRunScenarioProof).toHaveBeenCalledWith(expect.objectContaining({
      issueNumber: 42,
      runByTagCommand: 'bunx cucumber-js --tags {tag}',
      cwd: '/worktrees/test',
      stepDefDirectory: 'features/step_definitions',
      stepDefExtensions: ['.ts'],
    }));
  });
});

describe('executeScenarioTestPhase — with dev server', () => {
  it('wraps runScenarioProof in the lifecycle when the repository declares a dev server', async () => {
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);
    const { deps, lifecycle } = declaring('bun run dev --port {PORT}');

    await executeScenarioTestPhase(makeConfig(), deps);

    expect(lifecycle.configs).toHaveLength(1);
    expect(mockRunScenarioProof).toHaveBeenCalledOnce();
  });

  it('passes the parsed port from applicationUrl to the lifecycle', async () => {
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);
    const { deps, lifecycle } = declaring('bun run dev --port {PORT}');

    await executeScenarioTestPhase(makeConfig(), deps);

    const [devServerConfig] = lifecycle.configs;
    expect(devServerConfig.port).toBe(4567);
    expect(devServerConfig.startCommand).toBe('bun run dev --port {PORT}');
    expect(devServerConfig.cwd).toBe('/worktrees/test');
  });

  it('passes healthCheckPath to the lifecycle', async () => {
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);
    const { deps, lifecycle } = declaring('bun run dev');

    await executeScenarioTestPhase(makeConfig({ healthCheckPath: '/api/health' }), deps);

    expect(lifecycle.configs[0].healthPath).toBe('/api/health');
  });
});

describe('executeScenarioTestPhase — structured result', () => {
  it('returns scenarioProof with hasBlockerFailures false when scenarios pass', async () => {
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);
    const config = makeConfig();

    const result = await executeScenarioTestPhase(config, NO_DECLARED_SERVER);

    expect(result.scenarioProof).toBeDefined();
    expect(result.scenarioProof?.hasBlockerFailures).toBe(false);
    expect(result.scenarioProof?.resultsFilePath).toBe(passingProof.resultsFilePath);
    expect(result.scenarioProof?.tagResults).toHaveLength(2);
  });

  it('returns scenarioProof with hasBlockerFailures true when scenarios fail', async () => {
    mockRunScenarioProof.mockResolvedValueOnce(failingProof);
    const config = makeConfig();

    const result = await executeScenarioTestPhase(config, NO_DECLARED_SERVER);

    expect(result.scenarioProof?.hasBlockerFailures).toBe(true);
  });

  it('returns costUsd of 0 (subprocess-only, no agent cost)', async () => {
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);
    const config = makeConfig();

    const result = await executeScenarioTestPhase(config, NO_DECLARED_SERVER);

    expect(result.costUsd).toBe(0);
  });
});

describe('executeScenarioTestPhase — phase cost records', () => {
  it('creates phase cost records with phase name "scenarioTest"', async () => {
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);
    const config = makeConfig();

    await executeScenarioTestPhase(config, NO_DECLARED_SERVER);

    expect(mockCreatePhaseCostRecords).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'scenarioTest' }),
    );
  });

  it('creates phase cost records with correct workflowId and issueNumber', async () => {
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);
    const config = makeConfig();

    await executeScenarioTestPhase(config, NO_DECLARED_SERVER);

    expect(mockCreatePhaseCostRecords).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: 'test-id', issueNumber: 42 }),
    );
  });

  it('creates phase cost records even when skipping (no scenarios)', async () => {
    const config = makeConfig({ scenariosMd: '' });

    await executeScenarioTestPhase(config, NO_DECLARED_SERVER);

    expect(mockCreatePhaseCostRecords).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'scenarioTest' }),
    );
  });

  it('returns phaseCostRecords from createPhaseCostRecords', async () => {
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);
    mockCreatePhaseCostRecords.mockReturnValueOnce([{ id: 'record-1' } as unknown as import('../../cost').PhaseCostRecord]);
    const config = makeConfig();

    const result = await executeScenarioTestPhase(config, NO_DECLARED_SERVER);

    expect(result.phaseCostRecords).toEqual([{ id: 'record-1' }]);
  });
});
