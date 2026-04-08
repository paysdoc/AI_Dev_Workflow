import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing the module under test
vi.mock('../../agents/regressionScenarioProof', () => ({
  runScenarioProof: vi.fn(),
}));

vi.mock('../../core/devServerLifecycle', () => ({
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
import { runScenarioProof } from '../../agents/regressionScenarioProof';
import { withDevServer } from '../../core/devServerLifecycle';
import { createPhaseCostRecords } from '../../cost';

const mockRunScenarioProof = vi.mocked(runScenarioProof);
const mockWithDevServer = vi.mocked(withDevServer);
const mockCreatePhaseCostRecords = vi.mocked(createPhaseCostRecords);

const passingProof = {
  tagResults: [
    { tag: '@adw-{issueNumber}', resolvedTag: '@adw-42', severity: 'blocker' as const, optional: false, passed: true, output: 'ok', exitCode: 0, skipped: false },
    { tag: '@regression', resolvedTag: '@regression', severity: 'blocker' as const, optional: true, passed: true, output: 'ok', exitCode: 0, skipped: false },
  ],
  hasBlockerFailures: false,
  resultsFilePath: '/agents/test-id/scenario-test/scenario_proof.md',
};

const failingProof = {
  tagResults: [
    { tag: '@adw-{issueNumber}', resolvedTag: '@adw-42', severity: 'blocker' as const, optional: false, passed: false, output: 'FAILED', exitCode: 1, skipped: false },
  ],
  hasBlockerFailures: true,
  resultsFilePath: '/agents/test-id/scenario-test/scenario_proof.md',
};

function makeConfig(overrides: {
  scenariosMd?: string;
  runScenariosByTag?: string;
  startDevServer?: string;
  healthCheckPath?: string;
} = {}): Parameters<typeof executeScenarioTestPhase>[0] {
  return {
    issueNumber: 42,
    adwId: 'test-id',
    issue: { body: 'issue body', number: 42, title: 'Test', state: 'OPEN', author: { login: 'user', isBot: false }, assignees: [], labels: [], comments: [], createdAt: '', updatedAt: '', url: '' },
    issueType: '/feature' as const,
    worktreePath: '/worktrees/test',
    defaultBranch: 'main',
    logsDir: '/logs',
    orchestratorStatePath: '/state.json',
    orchestratorName: 'sdlc',
    recoveryState: { isRecovery: false, adwId: null, branchName: null },
    ctx: {} as any,
    branchName: 'feature-42-test',
    applicationUrl: 'http://localhost:4567',
    topLevelStatePath: '/agents/test-id/state.json',
    projectConfig: {
      commands: {
        packageManager: 'bun',
        installDeps: 'bun install',
        runLinter: 'bun run lint',
        typeCheck: 'bunx tsc --noEmit',
        runTests: 'bun run test',
        runBuild: 'bun run build',
        startDevServer: overrides.startDevServer ?? 'N/A',
        healthCheckPath: overrides.healthCheckPath ?? '/',
        prepareApp: 'N/A',
        runE2ETests: 'N/A',
        additionalTypeChecks: '',
        libraryInstall: 'bun add',
        scriptExecution: 'bunx tsx',
        runScenariosByTag: overrides.runScenariosByTag ?? 'bunx cucumber-js --tags {tag}',
        runRegressionScenarios: 'bunx cucumber-js --tags @regression',
      },
      projectMd: '',
      conditionalDocsMd: '',
      reviewProofMd: '',
      hasAdwDir: true,
      providers: { codeHost: 'github', issueTracker: 'github' },
      scenarios: { scenarioDirectory: 'features', runByTag: 'bunx cucumber-js --tags {tag}', runRegression: '' },
      scenariosMd: overrides.scenariosMd ?? 'some scenario content',
      reviewProofConfig: {
        tags: [
          { tag: '@adw-{issueNumber}', severity: 'blocker', optional: false },
          { tag: '@regression', severity: 'blocker', optional: true },
        ],
        supplementaryChecks: [],
      },
      applicationType: 'cli',
    },
  } as any;
}

beforeEach(() => {
  mockRunScenarioProof.mockReset();
  mockWithDevServer.mockReset();
  mockCreatePhaseCostRecords.mockReset();
  mockCreatePhaseCostRecords.mockReturnValue([]);
  // withDevServer calls work() and returns the result
  mockWithDevServer.mockImplementation(async (_cfg, work) => work());
});

// ---------------------------------------------------------------------------
// 1. Skip when no scenarios configured
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 2. Skip when runScenariosByTag is N/A
// ---------------------------------------------------------------------------

describe('executeScenarioTestPhase — skip when runScenariosByTag is N/A', () => {
  it('returns passing result immediately when runScenariosByTag is N/A', async () => {
    const config = makeConfig({ runScenariosByTag: 'N/A' });
    const result = await executeScenarioTestPhase(config);

    expect(result.scenarioProof).toBeUndefined();
    expect(mockRunScenarioProof).not.toHaveBeenCalled();
    expect(mockWithDevServer).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. Runs without dev server
// ---------------------------------------------------------------------------

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
    }));
  });
});

// ---------------------------------------------------------------------------
// 4. Runs with dev server
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 5. Returns structured result
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 6. Phase cost records
// ---------------------------------------------------------------------------

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
    mockCreatePhaseCostRecords.mockReturnValueOnce([{ id: 'record-1' } as any]);
    const config = makeConfig();

    const result = await executeScenarioTestPhase(config);

    expect(result.phaseCostRecords).toEqual([{ id: 'record-1' }]);
  });
});
