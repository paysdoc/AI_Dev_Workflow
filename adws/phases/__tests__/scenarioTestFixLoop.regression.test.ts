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

import { runScenarioTestFixLoop, ScenarioHermeticityError } from '../scenarioTestFixLoop';
import { executeScenarioTestPhase } from '../scenarioTestPhase';
import { executeScenarioFixPhase } from '../scenarioFixPhase';
import { CostTracker } from '../../core/phaseRunner';
import type { PreExistingRegressionGate } from '../preExistingRegressionGate';

class ParkedSignal extends Error {
  constructor() {
    super('the gate parked the workflow');
  }
}

function makeConfig() {
  return {
    issueNumber: 42,
    adwId: 'test-id',
    worktreePath: '/tmp/wt',
    logsDir: '/tmp/logs',
    orchestratorStatePath: '/tmp/state',
    issue: { body: 'issue body', number: 42 },
  } as never;
}

function testRun(tagResults: Array<{ resolvedTag: string; passed: boolean }>, id: string) {
  return {
    costUsd: 0,
    modelUsage: {},
    scenarioProof: {
      hasBlockerFailures: tagResults.some(result => !result.passed),
      resultsFilePath: `/proof-${id}.md`,
      tagResults: tagResults.map(result => ({ ...result, severity: 'blocker', skipped: false })),
      artifactsDir: '/artifacts',
    },
    phaseCostRecords: [],
  };
}

const regressionFails = (id = 'regression') => testRun([{ resolvedTag: '@regression', passed: false }, { resolvedTag: '@adw-42', passed: true }], id);
const allPass = (id = 'green') => testRun([{ resolvedTag: '@regression', passed: true }, { resolvedTag: '@adw-42', passed: true }], id);

function fixResult() {
  return { costUsd: 0, modelUsage: {}, phaseCostRecords: [], gherkinFreezeViolations: [] };
}

function resolvingGate(): Mock<PreExistingRegressionGate> {
  return vi.fn<PreExistingRegressionGate>(async () => undefined);
}

function parkingGate(): Mock<PreExistingRegressionGate> {
  return vi.fn<PreExistingRegressionGate>(async () => {
    throw new ParkedSignal();
  });
}

describe('runScenarioTestFixLoop — a regression scenario that also fails on the base branch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('never reaches the fix agent: the gate parks the workflow first', async () => {
    (executeScenarioTestPhase as Mock).mockResolvedValueOnce(regressionFails());
    const gate = parkingGate();

    await expect(runScenarioTestFixLoop(makeConfig(), new CostTracker(), { preExistingRegressionGate: gate })).rejects.toThrow(ParkedSignal);

    expect(gate).toHaveBeenCalledTimes(1);
    expect(executeScenarioFixPhase).not.toHaveBeenCalled();
  });

  it('parks, instead of failing on the cap, when it is the last attempt', async () => {
    (executeScenarioTestPhase as Mock).mockResolvedValueOnce(regressionFails());
    const gate = parkingGate();

    const run = runScenarioTestFixLoop(makeConfig(), new CostTracker(), { maxAttempts: 1, preExistingRegressionGate: gate });

    await expect(run).rejects.toThrow(ParkedSignal);
    await expect(run).rejects.not.toBeInstanceOf(ScenarioHermeticityError);
    expect(executeScenarioFixPhase).not.toHaveBeenCalled();
  });

  it('is still failed by the cap on the last attempt when the gate lets the failure through', async () => {
    (executeScenarioTestPhase as Mock).mockResolvedValueOnce(regressionFails());

    await expect(
      runScenarioTestFixLoop(makeConfig(), new CostTracker(), { maxAttempts: 1, preExistingRegressionGate: resolvingGate() }),
    ).rejects.toBeInstanceOf(ScenarioHermeticityError);
  });
});

describe('runScenarioTestFixLoop — a regression scenario the change broke', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('goes to the fix agent as before when the gate lets it through', async () => {
    const failing = regressionFails();
    (executeScenarioTestPhase as Mock).mockResolvedValueOnce(failing).mockResolvedValueOnce(allPass());
    (executeScenarioFixPhase as Mock).mockResolvedValueOnce(fixResult());
    const gate = resolvingGate();

    const result = await runScenarioTestFixLoop(makeConfig(), new CostTracker(), { preExistingRegressionGate: gate });

    expect(executeScenarioFixPhase).toHaveBeenCalledTimes(1);
    expect(executeScenarioFixPhase).toHaveBeenCalledWith(expect.anything(), failing.scenarioProof);
    expect(result.scenarioRetries).toBe(1);
  });

  it('consults the gate before it starts the fix agent', async () => {
    const order: string[] = [];
    (executeScenarioTestPhase as Mock).mockResolvedValueOnce(regressionFails()).mockResolvedValueOnce(allPass());
    (executeScenarioFixPhase as Mock).mockImplementationOnce(async () => {
      order.push('fix agent');
      return fixResult();
    });
    const gate = vi.fn<PreExistingRegressionGate>(async () => {
      order.push('gate');
    });

    await runScenarioTestFixLoop(makeConfig(), new CostTracker(), { preExistingRegressionGate: gate });

    expect(order).toEqual(['gate', 'fix agent']);
  });
});

describe('runScenarioTestFixLoop — the gate sees every failing run', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is called once per failing run, with that run’s proof, and never for a passing run', async () => {
    const first = regressionFails('first');
    const second = regressionFails('second');
    (executeScenarioTestPhase as Mock)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
      .mockResolvedValueOnce(allPass('last'));
    (executeScenarioFixPhase as Mock).mockResolvedValue(fixResult());
    const gate = resolvingGate();

    await runScenarioTestFixLoop(makeConfig(), new CostTracker(), { preExistingRegressionGate: gate });

    expect(gate.mock.calls.map(call => call[0])).toEqual([first.scenarioProof, second.scenarioProof]);
  });

  it('is not called when the first run passes', async () => {
    (executeScenarioTestPhase as Mock).mockResolvedValueOnce(allPass());
    const gate = resolvingGate();

    await runScenarioTestFixLoop(makeConfig(), new CostTracker(), { preExistingRegressionGate: gate });

    expect(gate).not.toHaveBeenCalled();
  });
});
