import { describe, it, expect, vi, beforeEach } from 'vitest';
import { persistTokenCounts } from '../costReport';
import { AgentStateManager } from '../agentState';
import type { ModelUsageMap } from '../../types/costTypes';
import { OrchestratorId } from '../constants';

vi.mock('../agentState', () => ({
  AgentStateManager: {
    readState: vi.fn(),
    writeState: vi.fn(),
  },
}));

vi.mock('../utils', () => ({
  log: vi.fn(),
}));

describe('persistTokenCounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes totalCostUsd and modelUsage to state metadata', () => {
    vi.mocked(AgentStateManager.readState).mockReturnValue(null);

    const modelUsage: ModelUsageMap = {
      'sonnet': { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.01 },
    };

    persistTokenCounts('/mock/state/path', 0.01, modelUsage);

    expect(AgentStateManager.readState).toHaveBeenCalledWith('/mock/state/path');
    expect(AgentStateManager.writeState).toHaveBeenCalledWith('/mock/state/path', {
      metadata: { totalCostUsd: 0.01, modelUsage },
    });
  });

  it('preserves existing metadata fields', () => {
    vi.mocked(AgentStateManager.readState).mockReturnValue({
      adwId: 'test-adw',
      issueNumber: 1,
      agentName: OrchestratorId.Plan,
      execution: { status: 'running', startedAt: '2024-01-01' },
      metadata: { unitTestsPassed: true, someOtherField: 'preserved' },
    });

    const modelUsage: ModelUsageMap = {
      'opus': { inputTokens: 500, outputTokens: 200, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.1 },
    };

    persistTokenCounts('/mock/state/path', 0.1, modelUsage);

    expect(AgentStateManager.writeState).toHaveBeenCalledWith('/mock/state/path', {
      metadata: {
        unitTestsPassed: true,
        someOtherField: 'preserved',
        totalCostUsd: 0.1,
        modelUsage,
      },
    });
  });

  it('handles empty model usage map', () => {
    vi.mocked(AgentStateManager.readState).mockReturnValue(null);

    persistTokenCounts('/mock/state/path', 0, {});

    expect(AgentStateManager.writeState).toHaveBeenCalledWith('/mock/state/path', {
      metadata: { totalCostUsd: 0, modelUsage: {} },
    });
  });

  it('handles no prior state', () => {
    vi.mocked(AgentStateManager.readState).mockReturnValue(null);

    const modelUsage: ModelUsageMap = {
      'haiku': { inputTokens: 50, outputTokens: 25, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.005 },
    };

    persistTokenCounts('/mock/state/path', 0.005, modelUsage);

    expect(AgentStateManager.writeState).toHaveBeenCalledWith('/mock/state/path', {
      metadata: { totalCostUsd: 0.005, modelUsage },
    });
  });

  it('overwrites previous totalCostUsd and modelUsage in metadata', () => {
    vi.mocked(AgentStateManager.readState).mockReturnValue({
      adwId: 'test-adw',
      issueNumber: 1,
      agentName: OrchestratorId.Plan,
      execution: { status: 'running', startedAt: '2024-01-01' },
      metadata: {
        totalCostUsd: 0.5,
        modelUsage: { 'sonnet': { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.5 } },
        reviewPassed: true,
      },
    });

    const newModelUsage: ModelUsageMap = {
      'sonnet': { inputTokens: 300, outputTokens: 150, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 1.5 },
    };

    persistTokenCounts('/mock/state/path', 1.5, newModelUsage);

    expect(AgentStateManager.writeState).toHaveBeenCalledWith('/mock/state/path', {
      metadata: {
        totalCostUsd: 1.5,
        modelUsage: newModelUsage,
        reviewPassed: true,
      },
    });
  });

  it('handles state with no metadata field', () => {
    vi.mocked(AgentStateManager.readState).mockReturnValue({
      adwId: 'test-adw',
      issueNumber: 1,
      agentName: OrchestratorId.Plan,
      execution: { status: 'running', startedAt: '2024-01-01' },
    });

    const modelUsage: ModelUsageMap = {};

    persistTokenCounts('/mock/state/path', 0, modelUsage);

    expect(AgentStateManager.writeState).toHaveBeenCalledWith('/mock/state/path', {
      metadata: { totalCostUsd: 0, modelUsage: {} },
    });
  });
});
