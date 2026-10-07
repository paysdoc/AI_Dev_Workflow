import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

vi.mock('../../core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core')>();
  return {
    ...actual,
    MAX_TEST_RETRY_ATTEMPTS: 3,
    AgentStateManager: {
      initializeState: vi.fn(() => '/mock/state'),
      appendLog: vi.fn(),
    },
    log: vi.fn(),
  };
});

vi.mock('../../agents/validationAgent', () => ({
  findScenarioFiles: vi.fn(() => []),
}));

vi.mock('../../agents/scenarioFidelityAgent', () => ({
  runScenarioFidelityAgent: vi.fn(),
}));

vi.mock('../../agents/commandAgent', () => ({
  OutputValidationError: class OutputValidationError extends Error {
    readonly name = 'OutputValidationError';
    readonly lastValidationError: string;
    constructor(msg: string) { super(msg); this.lastValidationError = msg; }
  },
}));

vi.mock('../../core/resolveVerdict', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/resolveVerdict')>();
  return actual;
});

vi.mock('../scenarioTestPhase', () => ({
  executeScenarioTestPhase: vi.fn(),
}));

vi.mock('../scenarioFixPhase', () => ({
  executeScenarioFixPhase: vi.fn(),
}));

vi.mock('../../core/phaseRunner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/phaseRunner')>();
  return {
    ...actual,
    runPhase: vi.fn(async (_config, _tracker, fn) => fn(_config)),
    CostTracker: actual.CostTracker,
  };
});

import { runScenarioTestFixLoop, ScenarioHermeticityError, GoalFidelityError } from '../scenarioTestFixLoop';
import { executeScenarioTestPhase } from '../scenarioTestPhase';
import { executeScenarioFixPhase } from '../scenarioFixPhase';
import { runScenarioFidelityAgent } from '../../agents/scenarioFidelityAgent';
import { findScenarioFiles } from '../../agents/validationAgent';
import { AgentStateManager } from '../../core';
import { CostTracker } from '../../core/phaseRunner';
import type { PreExistingRegressionGate } from '../preExistingRegressionGate';

function makeConfig(overrides?: Record<string, unknown>) {
  return {
    issueNumber: 42,
    adwId: 'test-id',
    worktreePath: '/tmp/wt',
    logsDir: '/tmp/logs',
    orchestratorStatePath: '/tmp/state',
    issue: { body: 'issue body', number: 42 },
    ...overrides,
  } as never;
}

const NOT_STARTED = { status: 'not_started' };
const SERVER_OUTPUT = "Error: Cannot find module './routes'";

function makePassingProof(extra?: Partial<{ hasBlockerFailures: boolean }>, devServer: object = NOT_STARTED) {
  return {
    costUsd: 0,
    modelUsage: {},
    devServer,
    scenarioProof: {
      hasBlockerFailures: extra?.hasBlockerFailures ?? false,
      resultsFilePath: '/proof.md',
      tagResults: [
        { resolvedTag: '@regression', severity: 'blocker', passed: true, skipped: false },
      ],
      artifactsDir: '/artifacts',
    },
    phaseCostRecords: [],
  };
}

function makeFailingProof() {
  return {
    costUsd: 0,
    modelUsage: {},
    devServer: NOT_STARTED,
    scenarioProof: {
      hasBlockerFailures: true,
      resultsFilePath: '/proof.md',
      tagResults: [
        { resolvedTag: '@regression', severity: 'blocker', passed: true, skipped: false },
        { resolvedTag: '@adw-42', severity: 'blocker', passed: false, skipped: false },
      ],
      artifactsDir: '/artifacts',
    },
    phaseCostRecords: [],
  };
}

function makeFixResult() {
  return { costUsd: 0, modelUsage: {}, phaseCostRecords: [], gherkinFreezeViolations: [] };
}

function makeFailedStart() {
  return {
    costUsd: 0,
    modelUsage: {},
    scenarioProof: undefined,
    devServer: { status: 'failed', command: 'bun run dev --port 4567', healthUrl: 'http://localhost:4567/', output: SERVER_OUTPUT },
    phaseCostRecords: [],
  };
}

describe('runScenarioTestFixLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (findScenarioFiles as Mock).mockReturnValue([]);
  });

  it('pass on first attempt → no fix, no fidelity call, scenarioRetries:0', async () => {
    (executeScenarioTestPhase as Mock).mockResolvedValueOnce(makePassingProof());
    const tracker = new CostTracker();
    const result = await runScenarioTestFixLoop(makeConfig(), tracker);
    expect(result.scenarioRetries).toBe(0);
    expect(result.scenarioProofPath).toBe('/proof.md');
    expect(executeScenarioFixPhase).not.toHaveBeenCalled();
    expect(runScenarioFidelityAgent).not.toHaveBeenCalled();
  });

  it('fail then pass within cap → fix called; fidelity called once (no scenario files → skip fidelity)', async () => {
    (findScenarioFiles as Mock).mockReturnValue([]);
    (executeScenarioTestPhase as Mock)
      .mockResolvedValueOnce(makeFailingProof())
      .mockResolvedValueOnce(makePassingProof());
    (executeScenarioFixPhase as Mock).mockResolvedValueOnce(makeFixResult());

    const tracker = new CostTracker();
    const result = await runScenarioTestFixLoop(makeConfig(), tracker, { maxAttempts: 3 });

    expect(result.scenarioRetries).toBe(1);
    expect(executeScenarioFixPhase).toHaveBeenCalledTimes(1);
    expect(runScenarioFidelityAgent).not.toHaveBeenCalled();
  });

  it('fidelity returns aligned:false → throws GoalFidelityError', async () => {
    (findScenarioFiles as Mock).mockReturnValue(['/feat.feature']);
    (runScenarioFidelityAgent as Mock).mockResolvedValue({
      costUsd: 0, modelUsage: {}, fidelityResult: { aligned: false, mismatches: [], summary: 'drift' },
    });
    (executeScenarioTestPhase as Mock)
      .mockResolvedValueOnce(makeFailingProof())
      .mockResolvedValueOnce(makePassingProof());
    (executeScenarioFixPhase as Mock).mockResolvedValueOnce(makeFixResult());

    const tracker = new CostTracker();
    await expect(runScenarioTestFixLoop(makeConfig(), tracker, { maxAttempts: 3 }))
      .rejects.toThrow(GoalFidelityError);
  });

  it('blocker failures persist to cap → throws ScenarioHermeticityError', async () => {
    (executeScenarioTestPhase as Mock).mockResolvedValue(makeFailingProof());
    (executeScenarioFixPhase as Mock).mockResolvedValue(makeFixResult());

    const tracker = new CostTracker();
    await expect(runScenarioTestFixLoop(makeConfig(), tracker, { maxAttempts: 2 }))
      .rejects.toThrow(ScenarioHermeticityError);
  });

  it('no scenarios configured (proof undefined) → returns cleanly, no throw, no fidelity call', async () => {
    (executeScenarioTestPhase as Mock).mockResolvedValueOnce({
      costUsd: 0,
      modelUsage: {},
      scenarioProof: undefined,
      devServer: NOT_STARTED,
      phaseCostRecords: [],
    });

    const tracker = new CostTracker();
    const result = await runScenarioTestFixLoop(makeConfig(), tracker);
    expect(result.scenarioRetries).toBe(0);
    expect(result.scenarioProof).toBeUndefined();
    expect(result.devServer).toEqual(NOT_STARTED);
    expect(runScenarioFidelityAgent).not.toHaveBeenCalled();
  });

  it('carries the dev server start of the last run on a pass', async () => {
    (executeScenarioTestPhase as Mock).mockResolvedValueOnce(makePassingProof(undefined, { status: 'started' }));

    const result = await runScenarioTestFixLoop(makeConfig(), new CostTracker());

    expect(result.devServer).toEqual({ status: 'started' });
  });
});

describe('runScenarioTestFixLoop — a dev server that does not start on the issue branch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (findScenarioFiles as Mock).mockReturnValue(['/feat.feature']);
  });

  function failedStartDeps(): { gate: Mock<PreExistingRegressionGate> } {
    return { gate: vi.fn<PreExistingRegressionGate>(async () => undefined) };
  }

  it('is handed back at once on the first run, with no scenario retry counted', async () => {
    (executeScenarioTestPhase as Mock).mockResolvedValueOnce(makeFailedStart());
    const { gate } = failedStartDeps();

    const result = await runScenarioTestFixLoop(makeConfig(), new CostTracker(), { maxAttempts: 3, preExistingRegressionGate: gate });

    expect(result).toEqual({
      scenarioProof: undefined,
      scenarioProofPath: '',
      scenarioRetries: 0,
      devServer: expect.objectContaining({ status: 'failed', output: SERVER_OUTPUT }),
    });
    expect(executeScenarioTestPhase).toHaveBeenCalledTimes(1);
  });

  it('reaches neither the scenario fix agent, nor the fidelity check, nor the pre-existing regression gate', async () => {
    (executeScenarioTestPhase as Mock).mockResolvedValueOnce(makeFailedStart());
    const { gate } = failedStartDeps();

    await runScenarioTestFixLoop(makeConfig(), new CostTracker(), { maxAttempts: 3, preExistingRegressionGate: gate });

    expect(executeScenarioFixPhase).not.toHaveBeenCalled();
    expect(runScenarioFidelityAgent).not.toHaveBeenCalled();
    expect(gate).not.toHaveBeenCalled();
  });

  it('is not turned into a hermeticity failure by a budget of one attempt', async () => {
    (executeScenarioTestPhase as Mock).mockResolvedValueOnce(makeFailedStart());
    const { gate } = failedStartDeps();

    const result = await runScenarioTestFixLoop(makeConfig(), new CostTracker(), { maxAttempts: 1, preExistingRegressionGate: gate });

    expect(result.devServer).toMatchObject({ status: 'failed' });
  });

  it('says in the state log that the failed start goes to the review loop', async () => {
    (executeScenarioTestPhase as Mock).mockResolvedValueOnce(makeFailedStart());
    const { gate } = failedStartDeps();

    await runScenarioTestFixLoop(makeConfig(), new CostTracker(), { maxAttempts: 3, preExistingRegressionGate: gate });

    const appended = vi.mocked(AgentStateManager.appendLog).mock.calls.map(([, message]) => message).join('\n');
    expect(appended).toMatch(/dev server did not start/i);
    expect(appended).toMatch(/review loop/i);
  });

  it('is handed back after a fix round with the one retry that round counted, and the fix round is not repeated', async () => {
    (executeScenarioTestPhase as Mock)
      .mockResolvedValueOnce(makeFailingProof())
      .mockResolvedValueOnce(makeFailedStart());
    (executeScenarioFixPhase as Mock).mockResolvedValueOnce(makeFixResult());
    const { gate } = failedStartDeps();

    const result = await runScenarioTestFixLoop(makeConfig(), new CostTracker(), { maxAttempts: 3, preExistingRegressionGate: gate });

    expect(result).toEqual({
      scenarioProof: undefined,
      scenarioProofPath: '',
      scenarioRetries: 1,
      devServer: expect.objectContaining({ status: 'failed' }),
    });
    expect(executeScenarioFixPhase).toHaveBeenCalledTimes(1);
    expect(runScenarioFidelityAgent).not.toHaveBeenCalled();
    expect(gate).toHaveBeenCalledTimes(1);
  });
});
