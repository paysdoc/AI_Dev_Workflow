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
import { createPhaseCostRecords } from '../../cost';
import { failingProof, makeConfig, passingProof } from './scenarioTestPhase.helpers';

const mockRunScenarioProof = vi.mocked(runScenarioProof);
const mockWithDevServer = vi.mocked(withDevServer);
const mockCreatePhaseCostRecords = vi.mocked(createPhaseCostRecords);

beforeEach(() => {
  mockRunScenarioProof.mockReset();
  mockWithDevServer.mockReset();
  mockCreatePhaseCostRecords.mockReset();
  mockCreatePhaseCostRecords.mockReturnValue([]);
  mockWithDevServer.mockImplementation(async (_cfg, work) => work());
});

describe('executeScenarioTestPhase — skip when no scenarios', () => {
  it('returns passing result immediately when scenariosMd is empty', async () => {
    const config = makeConfig({ scenariosMd: '' });
    const result = await executeScenarioTestPhase(config);

    expect(result.costUsd).toBe(0);
    expect(result.scenarioProof).toBeUndefined();
    expect(mockRunScenarioProof).not.toHaveBeenCalled();
    expect(mockWithDevServer).not.toHaveBeenCalled();
  });

  it('returns passing result when scenariosMd is whitespace only', async () => {
    const config = makeConfig({ scenariosMd: '   \n  ' });
    const result = await executeScenarioTestPhase(config);

    expect(result.scenarioProof).toBeUndefined();
    expect(mockRunScenarioProof).not.toHaveBeenCalled();
  });
});

describe('executeScenarioTestPhase — skip when runScenariosByTag is N/A', () => {
  it('returns passing result immediately when runScenariosByTag is N/A', async () => {
    const config = makeConfig({ runScenariosByTag: 'N/A' });
    const result = await executeScenarioTestPhase(config);

    expect(result.scenarioProof).toBeUndefined();
    expect(mockRunScenarioProof).not.toHaveBeenCalled();
    expect(mockWithDevServer).not.toHaveBeenCalled();
  });
});

describe('executeScenarioTestPhase — without dev server', () => {
  it('calls runScenarioProof directly when startDevServer is N/A', async () => {
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);
    const config = makeConfig({ startDevServer: 'N/A' });

    await executeScenarioTestPhase(config);

    expect(mockRunScenarioProof).toHaveBeenCalledOnce();
    expect(mockWithDevServer).not.toHaveBeenCalled();
  });

  it('calls runScenarioProof directly when startDevServer is empty string', async () => {
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);
    const config = makeConfig({ startDevServer: '' });

    await executeScenarioTestPhase(config);

    expect(mockRunScenarioProof).toHaveBeenCalledOnce();
    expect(mockWithDevServer).not.toHaveBeenCalled();
  });

  it('passes correct options to runScenarioProof', async () => {
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);
    const config = makeConfig({ startDevServer: 'N/A', runScenariosByTag: 'bunx cucumber-js --tags {tag}' });

    await executeScenarioTestPhase(config);

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
  it('wraps runScenarioProof in withDevServer when startDevServer is configured', async () => {
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);
    const config = makeConfig({ startDevServer: 'bun run dev --port {PORT}' });

    await executeScenarioTestPhase(config);

    expect(mockWithDevServer).toHaveBeenCalledOnce();
    expect(mockRunScenarioProof).toHaveBeenCalledOnce();
  });

  it('passes the parsed port from applicationUrl to withDevServer', async () => {
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);
    const config = makeConfig({ startDevServer: 'bun run dev --port {PORT}' });

    await executeScenarioTestPhase(config);

    const [devServerConfig] = mockWithDevServer.mock.calls[0];
    expect(devServerConfig.port).toBe(4567);
    expect(devServerConfig.startCommand).toBe('bun run dev --port {PORT}');
    expect(devServerConfig.cwd).toBe('/worktrees/test');
  });

  it('passes healthCheckPath to withDevServer', async () => {
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);
    const config = makeConfig({ startDevServer: 'bun run dev', healthCheckPath: '/api/health' });

    await executeScenarioTestPhase(config);

    const [devServerConfig] = mockWithDevServer.mock.calls[0];
    expect(devServerConfig.healthPath).toBe('/api/health');
  });
});

describe('executeScenarioTestPhase — structured result', () => {
  it('returns scenarioProof with hasBlockerFailures false when scenarios pass', async () => {
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);
    const config = makeConfig();

    const result = await executeScenarioTestPhase(config);

    expect(result.scenarioProof).toBeDefined();
    expect(result.scenarioProof?.hasBlockerFailures).toBe(false);
    expect(result.scenarioProof?.resultsFilePath).toBe(passingProof.resultsFilePath);
    expect(result.scenarioProof?.tagResults).toHaveLength(2);
  });

  it('returns scenarioProof with hasBlockerFailures true when scenarios fail', async () => {
    mockRunScenarioProof.mockResolvedValueOnce(failingProof);
    const config = makeConfig();

    const result = await executeScenarioTestPhase(config);

    expect(result.scenarioProof?.hasBlockerFailures).toBe(true);
  });

  it('returns costUsd of 0 (subprocess-only, no agent cost)', async () => {
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);
    const config = makeConfig();

    const result = await executeScenarioTestPhase(config);

    expect(result.costUsd).toBe(0);
  });
});

describe('executeScenarioTestPhase — phase cost records', () => {
  it('creates phase cost records with phase name "scenarioTest"', async () => {
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);
    const config = makeConfig();

    await executeScenarioTestPhase(config);

    expect(mockCreatePhaseCostRecords).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'scenarioTest' }),
    );
  });

  it('creates phase cost records with correct workflowId and issueNumber', async () => {
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);
    const config = makeConfig();

    await executeScenarioTestPhase(config);

    expect(mockCreatePhaseCostRecords).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: 'test-id', issueNumber: 42 }),
    );
  });

  it('creates phase cost records even when skipping (no scenarios)', async () => {
    const config = makeConfig({ scenariosMd: '' });

    await executeScenarioTestPhase(config);

    expect(mockCreatePhaseCostRecords).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'scenarioTest' }),
    );
  });

  it('returns phaseCostRecords from createPhaseCostRecords', async () => {
    mockRunScenarioProof.mockResolvedValueOnce(passingProof);
    mockCreatePhaseCostRecords.mockReturnValueOnce([{ id: 'record-1' } as unknown as import('../../cost').PhaseCostRecord]);
    const config = makeConfig();

    const result = await executeScenarioTestPhase(config);

    expect(result.phaseCostRecords).toEqual([{ id: 'record-1' }]);
  });
});
