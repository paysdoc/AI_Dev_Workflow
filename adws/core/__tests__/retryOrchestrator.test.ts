import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing the module under test
vi.mock('../costReport', () => ({
  mergeModelUsageMaps: vi.fn((_a, b) => b),
  persistTokenCounts: vi.fn(),
}));

vi.mock('../agentState', () => ({
  AgentStateManager: {
    readState: vi.fn(() => ({ adwId: 'test-adw-id' })),
    initializeState: vi.fn(() => '/tmp/test-state'),
    appendLog: vi.fn(),
  },
}));

vi.mock('../utils', () => ({
  log: vi.fn(),
}));

import {
  retryWithResolution,
  trackCost,
  getAdwIdFromState,
  initAgentState,
  type RetryConfig,
  type AgentRunResult,
} from '../retryOrchestrator';
import { AgentStateManager } from '../agentState';
import { persistTokenCounts } from '../costReport';
import { emptyModelUsageMap } from '../../types/costTypes';

describe('getAdwIdFromState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the ADW ID from agent state', () => {
    vi.mocked(AgentStateManager.readState).mockReturnValue({ adwId: 'my-adw-id' } as never);
    const result = getAdwIdFromState('/tmp/state');
    expect(result).toBe('my-adw-id');
  });

  it('returns empty string when state is null', () => {
    vi.mocked(AgentStateManager.readState).mockReturnValue(null as never);
    const result = getAdwIdFromState('/tmp/state');
    expect(result).toBe('');
  });
});

describe('initAgentState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls initializeState with the correct arguments', () => {
    vi.mocked(AgentStateManager.readState).mockReturnValue({ adwId: 'init-adw' } as never);
    vi.mocked(AgentStateManager.initializeState).mockReturnValue('/tmp/agent-state');

    const result = initAgentState('/tmp/state', 'test-agent');
    expect(result).toBe('/tmp/agent-state');
    expect(AgentStateManager.initializeState).toHaveBeenCalledWith('init-adw', 'test-agent', '/tmp/state');
  });
});

describe('trackCost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accumulates cost and persists token counts', () => {
    const state = { costUsd: 1.0, modelUsage: emptyModelUsageMap() };
    const result: AgentRunResult = {
      success: true,
      totalCostUsd: 0.5,
      modelUsage: { 'claude-3-opus': { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.5 } },
    };

    trackCost(result, state, '/tmp/state');

    expect(state.costUsd).toBe(1.5);
    expect(persistTokenCounts).toHaveBeenCalledWith('/tmp/state', 1.5, expect.any(Object));
  });

  it('handles result without cost', () => {
    const state = { costUsd: 1.0, modelUsage: emptyModelUsageMap() };
    const result: AgentRunResult = { success: true };

    trackCost(result, state, '/tmp/state');

    expect(state.costUsd).toBe(1.0);
    expect(persistTokenCounts).toHaveBeenCalled();
  });
});

describe('retryWithResolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createConfig(overrides: Partial<RetryConfig<AgentRunResult & { passed?: boolean; failures?: string[] }, string>> = {}): RetryConfig<AgentRunResult & { passed?: boolean; failures?: string[] }, string> {
    return {
      maxRetries: 3,
      statePath: '/tmp/state',
      label: 'test',
      run: vi.fn(),
      isPassed: vi.fn((result) => result.passed ?? false),
      extractFailures: vi.fn((result) => result.failures ?? []),
      resolveFailures: vi.fn(async () => ({ success: true, totalCostUsd: 0.1 })),
      ...overrides,
    };
  }

  it('returns passed=true on first attempt when run passes', async () => {
    const config = createConfig({
      run: vi.fn(async () => ({ success: true, passed: true, totalCostUsd: 0.5 })),
      isPassed: vi.fn(() => true),
    });

    const result = await retryWithResolution(config);

    expect(result.passed).toBe(true);
    expect(result.totalRetries).toBe(0);
    expect(result.failures).toEqual([]);
    expect(config.run).toHaveBeenCalledTimes(1);
    expect(config.resolveFailures).not.toHaveBeenCalled();
  });

  it('retries and passes on second attempt', async () => {
    let callCount = 0;
    const config = createConfig({
      run: vi.fn(async () => {
        callCount++;
        return { success: true, passed: callCount >= 2, failures: callCount < 2 ? ['error1'] : [], totalCostUsd: 0.2 };
      }),
      isPassed: vi.fn((result) => result.passed ?? false),
      extractFailures: vi.fn((result) => result.failures ?? []),
    });

    const result = await retryWithResolution(config);

    expect(result.passed).toBe(true);
    expect(result.totalRetries).toBe(1);
    expect(config.run).toHaveBeenCalledTimes(2);
    expect(config.resolveFailures).toHaveBeenCalledTimes(1);
  });

  it('fails after max retries are exhausted', async () => {
    const config = createConfig({
      maxRetries: 2,
      run: vi.fn(async () => ({ success: true, passed: false, failures: ['persistent-error'], totalCostUsd: 0.1 })),
      isPassed: vi.fn(() => false),
      extractFailures: vi.fn(() => ['persistent-error']),
    });

    const result = await retryWithResolution(config);

    expect(result.passed).toBe(false);
    expect(result.totalRetries).toBe(2);
    expect(result.failures).toEqual(['persistent-error']);
    expect(config.run).toHaveBeenCalledTimes(2);
    expect(config.resolveFailures).toHaveBeenCalledTimes(2);
  });

  it('handles agent execution failure (success=false in run result)', async () => {
    const config = createConfig({
      maxRetries: 2,
      run: vi.fn(async () => ({ success: false, totalCostUsd: 0 })),
    });

    const result = await retryWithResolution(config);

    expect(result.passed).toBe(false);
    expect(result.totalRetries).toBe(2);
    // When success is false, isPassed is not called and resolveFailures is not called
    expect(config.isPassed).not.toHaveBeenCalled();
    expect(config.resolveFailures).not.toHaveBeenCalled();
  });

  it('calls onRetryFailed callback when provided', async () => {
    const onRetryFailed = vi.fn();
    const config = createConfig({
      maxRetries: 2,
      run: vi.fn(async () => ({ success: true, passed: false, failures: ['err'], totalCostUsd: 0 })),
      isPassed: vi.fn(() => false),
      extractFailures: vi.fn(() => ['err']),
      onRetryFailed,
    });

    await retryWithResolution(config);

    expect(onRetryFailed).toHaveBeenCalledTimes(2);
    expect(onRetryFailed).toHaveBeenCalledWith(1, 2);
    expect(onRetryFailed).toHaveBeenCalledWith(2, 2);
  });

  it('accumulates cost across retries', async () => {
    let callCount = 0;
    const config = createConfig({
      maxRetries: 3,
      run: vi.fn(async () => {
        callCount++;
        return { success: true, passed: callCount >= 3, failures: callCount < 3 ? ['err'] : [], totalCostUsd: 1.0 };
      }),
      isPassed: vi.fn((result) => result.passed ?? false),
      extractFailures: vi.fn((result) => result.failures ?? []),
      resolveFailures: vi.fn(async () => ({ success: true, totalCostUsd: 0.5 })),
    });

    const result = await retryWithResolution(config);

    expect(result.passed).toBe(true);
    // Cost should accumulate: 3 runs * 1.0 + 2 resolves * 0.5 = 4.0
    expect(result.costUsd).toBe(4.0);
  });

  it('logs appropriate messages via AgentStateManager.appendLog', async () => {
    const config = createConfig({
      maxRetries: 1,
      run: vi.fn(async () => ({ success: true, passed: true, totalCostUsd: 0 })),
      isPassed: vi.fn(() => true),
    });

    await retryWithResolution(config);

    expect(AgentStateManager.appendLog).toHaveBeenCalledWith('/tmp/state', 'test attempt 1/1');
    expect(AgentStateManager.appendLog).toHaveBeenCalledWith('/tmp/state', 'test passed');
  });

  it('returns empty failures array on pass', async () => {
    const config = createConfig({
      run: vi.fn(async () => ({ success: true, passed: true, totalCostUsd: 0 })),
      isPassed: vi.fn(() => true),
    });

    const result = await retryWithResolution(config);
    expect(result.failures).toEqual([]);
  });

  it('works with maxRetries of 1', async () => {
    const config = createConfig({
      maxRetries: 1,
      run: vi.fn(async () => ({ success: true, passed: false, failures: ['only-error'], totalCostUsd: 0 })),
      isPassed: vi.fn(() => false),
      extractFailures: vi.fn(() => ['only-error']),
    });

    const result = await retryWithResolution(config);

    expect(result.passed).toBe(false);
    expect(result.totalRetries).toBe(1);
    expect(result.failures).toEqual(['only-error']);
    expect(config.run).toHaveBeenCalledTimes(1);
    expect(config.resolveFailures).toHaveBeenCalledTimes(1);
  });
});
