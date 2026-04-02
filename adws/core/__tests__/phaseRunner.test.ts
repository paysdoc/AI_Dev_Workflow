import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CostTracker, runPhase } from '../phaseRunner';
import { RateLimitError } from '../../types/agentTypes';
import type { WorkflowConfig } from '../../phases/workflowInit';

// Mock dependencies to avoid filesystem/network side effects
vi.mock('../config', () => ({ RUNNING_TOKENS: false }));
vi.mock('../../cost', () => ({
  mergeModelUsageMaps: (a: Record<string, unknown>, b: Record<string, unknown>) => ({ ...a, ...b }),
  persistTokenCounts: vi.fn(),
  computeDisplayTokens: vi.fn(() => 0),
}));
vi.mock('../../cost/d1Client', () => ({
  postCostRecordsToD1: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../agentState', () => ({
  AgentStateManager: {
    readState: vi.fn(() => null),
    writeState: vi.fn(),
  },
}));

// Mock handleRateLimitPause so we can assert it's called without exiting
const mockHandleRateLimitPause = vi.fn();
vi.mock('../../phases/workflowCompletion', () => ({
  handleRateLimitPause: (...args: unknown[]) => mockHandleRateLimitPause(...args),
}));

function makeConfig(overrides?: Partial<WorkflowConfig>): WorkflowConfig {
  return {
    orchestratorStatePath: '/tmp/test-state.json',
    ctx: {},
    completedPhases: [],
    ...overrides,
  } as unknown as WorkflowConfig;
}

describe('CostTracker', () => {
  it('starts at zero', () => {
    const tracker = new CostTracker();
    expect(tracker.totalCostUsd).toBe(0);
    expect(tracker.totalModelUsage).toEqual({});
  });

  const usage = (inputTokens: number) => ({
    inputTokens,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    costUSD: 0,
  });

  it('accumulates cost across multiple phases', () => {
    const tracker = new CostTracker();
    tracker.accumulate({ costUsd: 0.01, modelUsage: { 'model-a': usage(100) } });
    tracker.accumulate({ costUsd: 0.02, modelUsage: { 'model-b': usage(200) } });
    expect(tracker.totalCostUsd).toBeCloseTo(0.03);
  });

  it('merges model usage maps across phases', () => {
    const tracker = new CostTracker();
    tracker.accumulate({ costUsd: 0, modelUsage: { 'model-a': usage(10) } });
    tracker.accumulate({ costUsd: 0, modelUsage: { 'model-b': usage(20) } });
    expect(tracker.totalModelUsage).toHaveProperty('model-a');
    expect(tracker.totalModelUsage).toHaveProperty('model-b');
  });
});

describe('runPhase()', () => {
  beforeEach(() => {
    mockHandleRateLimitPause.mockClear();
  });

  it('returns the phase result and accumulates cost into the tracker', async () => {
    const config = makeConfig();
    const tracker = new CostTracker();
    const phaseFn = vi.fn().mockResolvedValue({ costUsd: 0.05, modelUsage: {}, phaseCostRecords: [] });

    const result = await runPhase(config, tracker, phaseFn);

    expect(result.costUsd).toBe(0.05);
    expect(tracker.totalCostUsd).toBe(0.05);
    expect(phaseFn).toHaveBeenCalledWith(config);
  });

  it('re-throws non-RateLimitError errors to the caller', async () => {
    const config = makeConfig();
    const tracker = new CostTracker();
    const boom = new Error('unexpected failure');
    const phaseFn = vi.fn().mockRejectedValue(boom);

    await expect(runPhase(config, tracker, phaseFn)).rejects.toThrow('unexpected failure');
    expect(mockHandleRateLimitPause).not.toHaveBeenCalled();
  });

  it('calls handleRateLimitPause when RateLimitError is thrown', async () => {
    const config = makeConfig();
    const tracker = new CostTracker();
    const rateLimitErr = new RateLimitError('plan');
    const phaseFn = vi.fn().mockRejectedValue(rateLimitErr);

    await expect(runPhase(config, tracker, phaseFn)).rejects.toThrow(RateLimitError);
    expect(mockHandleRateLimitPause).toHaveBeenCalledWith(
      config,
      'plan',
      'rate_limited',
      0,
      {},
    );
  });

  it('skips a phase that is already in config.completedPhases', async () => {
    const config = makeConfig({ completedPhases: ['install'] });
    const tracker = new CostTracker();
    const phaseFn = vi.fn().mockResolvedValue({ costUsd: 0.05, modelUsage: {} });

    const result = await runPhase(config, tracker, phaseFn, 'install');

    expect(phaseFn).not.toHaveBeenCalled();
    expect(result.costUsd).toBe(0);
    expect(tracker.totalCostUsd).toBe(0);
  });

  it('does not skip a phase that is not in config.completedPhases', async () => {
    const config = makeConfig({ completedPhases: ['install'] });
    const tracker = new CostTracker();
    const phaseFn = vi.fn().mockResolvedValue({ costUsd: 0.03, modelUsage: {}, phaseCostRecords: [] });

    await runPhase(config, tracker, phaseFn, 'plan');

    expect(phaseFn).toHaveBeenCalled();
    expect(tracker.totalCostUsd).toBe(0.03);
  });
});
