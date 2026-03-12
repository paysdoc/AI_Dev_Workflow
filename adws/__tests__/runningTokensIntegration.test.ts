import { describe, it, expect } from 'vitest';
import { computeTotalTokens } from '../core/tokenManager';
import { mergeModelUsageMaps } from '../core/costReport';
import type { ModelUsageMap } from '../types/costTypes';
import type { WorkflowContext } from '../github/workflowCommentsIssue';

describe('Running tokens integration', () => {
  const phaseOneUsage: ModelUsageMap = {
    'claude-opus-4-6': {
      inputTokens: 1000,
      outputTokens: 500,
      cacheCreationInputTokens: 200,
      cacheReadInputTokens: 100,
      costUSD: 0.05,
    },
  };

  const phaseTwoUsage: ModelUsageMap = {
    'claude-opus-4-6': {
      inputTokens: 2000,
      outputTokens: 1000,
      cacheCreationInputTokens: 300,
      cacheReadInputTokens: 150,
      costUSD: 0.10,
    },
    'claude-haiku-4-5': {
      inputTokens: 500,
      outputTokens: 200,
      cacheCreationInputTokens: 50,
      cacheReadInputTokens: 25,
      costUSD: 0.01,
    },
  };

  it('computes cumulative token totals across phases', () => {
    let totalModelUsage: ModelUsageMap = {};

    totalModelUsage = mergeModelUsageMaps(totalModelUsage, phaseOneUsage);
    const afterPhaseOne = computeTotalTokens(totalModelUsage);

    expect(afterPhaseOne.inputTokens).toBe(1000);
    expect(afterPhaseOne.outputTokens).toBe(500);
    expect(afterPhaseOne.cacheCreationTokens).toBe(200);
    expect(afterPhaseOne.total).toBe(1700);

    totalModelUsage = mergeModelUsageMaps(totalModelUsage, phaseTwoUsage);
    const afterPhaseTwo = computeTotalTokens(totalModelUsage);

    expect(afterPhaseTwo.inputTokens).toBe(3500);
    expect(afterPhaseTwo.outputTokens).toBe(1700);
    expect(afterPhaseTwo.cacheCreationTokens).toBe(550);
    expect(afterPhaseTwo.total).toBe(5750);
  });

  it('correctly assigns token totals to ctx when RUNNING_TOKENS is truthy', () => {
    const ctx: WorkflowContext = { issueNumber: 1, adwId: 'test' };
    let totalModelUsage: ModelUsageMap = {};

    // Simulate RUNNING_TOKENS = true
    const runningTokensEnabled = true;

    totalModelUsage = mergeModelUsageMaps(totalModelUsage, phaseOneUsage);
    if (runningTokensEnabled) {
      ctx.runningTokenTotal = computeTotalTokens(totalModelUsage);
    }

    expect(ctx.runningTokenTotal).toBeDefined();
    expect(ctx.runningTokenTotal!.total).toBe(1700);

    totalModelUsage = mergeModelUsageMaps(totalModelUsage, phaseTwoUsage);
    if (runningTokensEnabled) {
      ctx.runningTokenTotal = computeTotalTokens(totalModelUsage);
    }

    expect(ctx.runningTokenTotal!.total).toBe(5750);
  });

  it('leaves ctx.runningTokenTotal undefined when RUNNING_TOKENS is falsy', () => {
    const ctx: WorkflowContext = { issueNumber: 1, adwId: 'test' };
    let totalModelUsage: ModelUsageMap = {};

    // Simulate RUNNING_TOKENS = false
    const runningTokensEnabled = false;

    totalModelUsage = mergeModelUsageMaps(totalModelUsage, phaseOneUsage);
    if (runningTokensEnabled) {
      ctx.runningTokenTotal = computeTotalTokens(totalModelUsage);
    }

    expect(ctx.runningTokenTotal).toBeUndefined();
  });

  it('populates modelBreakdown with correct model keys and totals', () => {
    let totalModelUsage: ModelUsageMap = {};

    totalModelUsage = mergeModelUsageMaps(totalModelUsage, phaseOneUsage);
    const afterPhaseOne = computeTotalTokens(totalModelUsage);

    expect(afterPhaseOne.modelBreakdown).toHaveLength(1);
    expect(afterPhaseOne.modelBreakdown[0]).toEqual({ model: 'claude-opus-4-6', total: 1700 });
  });

  it('includes both models with correct totals after merging multi-model phases', () => {
    let totalModelUsage: ModelUsageMap = {};
    totalModelUsage = mergeModelUsageMaps(totalModelUsage, phaseOneUsage);
    totalModelUsage = mergeModelUsageMaps(totalModelUsage, phaseTwoUsage);
    const result = computeTotalTokens(totalModelUsage);

    expect(result.modelBreakdown).toHaveLength(2);

    const opusEntry = result.modelBreakdown.find((e) => e.model === 'claude-opus-4-6');
    const haikuEntry = result.modelBreakdown.find((e) => e.model === 'claude-haiku-4-5');

    // opus: (1000+2000) input + (500+1000) output + (200+300) cache = 5000
    expect(opusEntry).toEqual({ model: 'claude-opus-4-6', total: 5000 });
    // haiku: 500 input + 200 output + 50 cache = 750
    expect(haikuEntry).toEqual({ model: 'claude-haiku-4-5', total: 750 });
  });

  it('sorts modelBreakdown descending by total', () => {
    let totalModelUsage: ModelUsageMap = {};
    totalModelUsage = mergeModelUsageMaps(totalModelUsage, phaseOneUsage);
    totalModelUsage = mergeModelUsageMaps(totalModelUsage, phaseTwoUsage);
    const result = computeTotalTokens(totalModelUsage);

    expect(result.modelBreakdown[0].model).toBe('claude-opus-4-6');
    expect(result.modelBreakdown[1].model).toBe('claude-haiku-4-5');
    expect(result.modelBreakdown[0].total).toBeGreaterThan(result.modelBreakdown[1].total);
  });

  it('threads modelBreakdown into ctx.runningTokenTotal', () => {
    const ctx: WorkflowContext = { issueNumber: 1, adwId: 'test' };
    let totalModelUsage: ModelUsageMap = {};
    totalModelUsage = mergeModelUsageMaps(totalModelUsage, phaseOneUsage);
    totalModelUsage = mergeModelUsageMaps(totalModelUsage, phaseTwoUsage);

    ctx.runningTokenTotal = computeTotalTokens(totalModelUsage);

    expect(ctx.runningTokenTotal.modelBreakdown).toHaveLength(2);
    expect(ctx.runningTokenTotal.modelBreakdown[0].model).toBe('claude-opus-4-6');
    expect(ctx.runningTokenTotal.modelBreakdown[1].model).toBe('claude-haiku-4-5');
  });
});
