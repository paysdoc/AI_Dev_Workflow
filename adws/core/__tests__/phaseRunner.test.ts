import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CostTracker, runPhase } from '../phaseRunner';
import { RateLimitError } from '../../types/agentTypes';
import type { WorkflowConfig } from '../../phases/workflowInit';

// Hoist mock variables so they are available when vi.mock factory runs
const { writeTopLevelStateMock, readTopLevelStateMock } = vi.hoisted(() => ({
  writeTopLevelStateMock: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readTopLevelStateMock: vi.fn(() => null as any),
}));

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
    writeTopLevelState: writeTopLevelStateMock,
    readTopLevelState: readTopLevelStateMock,
    getTopLevelStatePath: vi.fn((id: string) => `/tmp/agents/${id}/state.json`),
  },
}));

// Mock handleRateLimitPause so we can assert it's called without exiting
const mockHandleRateLimitPause = vi.fn();
vi.mock('../../phases/workflowCompletion', () => ({
  handleRateLimitPause: (...args: unknown[]) => mockHandleRateLimitPause(...args),
}));

function makeConfig(overrides?: Partial<WorkflowConfig>): WorkflowConfig {
  return {
    adwId: 'test-adwid',
    orchestratorStatePath: '/tmp/test-state',
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
    writeTopLevelStateMock.mockClear();
    readTopLevelStateMock.mockReset();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readTopLevelStateMock.mockReturnValue(null as any);
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

  it('writes running status to top-level state before executing phase', async () => {
    const config = makeConfig();
    const tracker = new CostTracker();
    const phaseFn = vi.fn().mockResolvedValue({ costUsd: 0, modelUsage: {}, phaseCostRecords: [] });

    await runPhase(config, tracker, phaseFn, 'build');

    type CallArg = { phases?: { build?: { status: string } }; workflowStage?: string };
    const runningCall = writeTopLevelStateMock.mock.calls.find(
      (call: unknown[]) => (call[1] as CallArg)?.phases?.build?.status === 'running'
    );
    expect(runningCall).toBeDefined();
    expect((runningCall![1] as CallArg).workflowStage).toBe('build_running');
  });

  it('writes completed status to top-level state after successful phase', async () => {
    const config = makeConfig();
    const tracker = new CostTracker();
    const phaseFn = vi.fn().mockResolvedValue({ costUsd: 0, modelUsage: {}, phaseCostRecords: [] });

    await runPhase(config, tracker, phaseFn, 'build');

    type CallArg = { phases?: { build?: { status: string } }; workflowStage?: string };
    const completedCall = writeTopLevelStateMock.mock.calls.find(
      (call: unknown[]) => (call[1] as CallArg)?.phases?.build?.status === 'completed'
    );
    expect(completedCall).toBeDefined();
    expect((completedCall![1] as CallArg).workflowStage).toBe('build_completed');
  });

  it('writes failed status to top-level state when phase throws', async () => {
    const config = makeConfig();
    const tracker = new CostTracker();
    const phaseFn = vi.fn().mockRejectedValue(new Error('phase failed'));

    await expect(runPhase(config, tracker, phaseFn, 'build')).rejects.toThrow('phase failed');

    type CallArg = { phases?: { build?: { status: string } } };
    const failedCall = writeTopLevelStateMock.mock.calls.find(
      (call: unknown[]) => (call[1] as CallArg)?.phases?.build?.status === 'failed'
    );
    expect(failedCall).toBeDefined();
  });

  it('skips phase when top-level phases map shows completed status', async () => {
    readTopLevelStateMock.mockReturnValue(
      { phases: { install: { status: 'completed', startedAt: '2024-01-01T00:00:00Z' } } // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const config = makeConfig({ completedPhases: [] });
    const tracker = new CostTracker();
    const phaseFn = vi.fn().mockResolvedValue({ costUsd: 0.05, modelUsage: {} });

    const result = await runPhase(config, tracker, phaseFn, 'install');

    expect(phaseFn).not.toHaveBeenCalled();
    expect(result.costUsd).toBe(0);
  });

  it('does not skip phase when top-level phases map shows failed status', async () => {
    readTopLevelStateMock.mockReturnValue(
      { phases: { build: { status: 'failed', startedAt: '2024-01-01T00:00:00Z' } } // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const config = makeConfig({ completedPhases: ['build'] });
    const tracker = new CostTracker();
    const phaseFn = vi.fn().mockResolvedValue({ costUsd: 0.01, modelUsage: {}, phaseCostRecords: [] });

    await runPhase(config, tracker, phaseFn, 'build');

    expect(phaseFn).toHaveBeenCalled();
  });

  it('falls back to config.completedPhases when top-level state has no phases map', async () => {
    readTopLevelStateMock.mockReturnValue({ workflowStage: 'starting' } as Record<string, unknown>); // no phases
    const config = makeConfig({ completedPhases: ['install'] });
    const tracker = new CostTracker();
    const phaseFn = vi.fn().mockResolvedValue({ costUsd: 0.05, modelUsage: {} });

    const result = await runPhase(config, tracker, phaseFn, 'install');

    expect(phaseFn).not.toHaveBeenCalled();
    expect(result.costUsd).toBe(0);
  });

  it('does not write top-level state when phaseName is undefined', async () => {
    const config = makeConfig();
    const tracker = new CostTracker();
    const phaseFn = vi.fn().mockResolvedValue({ costUsd: 0, modelUsage: {}, phaseCostRecords: [] });

    await runPhase(config, tracker, phaseFn);

    expect(writeTopLevelStateMock).not.toHaveBeenCalled();
  });
});
