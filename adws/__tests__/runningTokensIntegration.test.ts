import { describe, it, expect } from 'vitest';
import { computeTotalTokens, computeDisplayTokens } from '../core/tokenManager';
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

  it('correctly assigns display token totals to ctx when RUNNING_TOKENS is truthy', () => {
    const ctx: WorkflowContext = { issueNumber: 1, adwId: 'test' };
    let totalModelUsage: ModelUsageMap = {};

    const runningTokensEnabled = true;

    totalModelUsage = mergeModelUsageMaps(totalModelUsage, phaseOneUsage);
    if (runningTokensEnabled) {
      ctx.runningTokenTotal = computeDisplayTokens(totalModelUsage);
    }

    expect(ctx.runningTokenTotal).toBeDefined();
    // Display tokens: input (1000) + output (500) = 1500 (no cache)
    expect(ctx.runningTokenTotal!.total).toBe(1500);

    totalModelUsage = mergeModelUsageMaps(totalModelUsage, phaseTwoUsage);
    if (runningTokensEnabled) {
      ctx.runningTokenTotal = computeDisplayTokens(totalModelUsage);
    }

    // Display tokens: input (3500) + output (1700) = 5200 (no cache)
    expect(ctx.runningTokenTotal!.total).toBe(5200);
  });

  it('leaves ctx.runningTokenTotal undefined when RUNNING_TOKENS is falsy', () => {
    const ctx: WorkflowContext = { issueNumber: 1, adwId: 'test' };
    let totalModelUsage: ModelUsageMap = {};

    const runningTokensEnabled = false;

    totalModelUsage = mergeModelUsageMaps(totalModelUsage, phaseOneUsage);
    if (runningTokensEnabled) {
      ctx.runningTokenTotal = computeDisplayTokens(totalModelUsage);
    }

    expect(ctx.runningTokenTotal).toBeUndefined();
  });

  it('populates modelBreakdown with I/O-only totals', () => {
    let totalModelUsage: ModelUsageMap = {};

    totalModelUsage = mergeModelUsageMaps(totalModelUsage, phaseOneUsage);
    const afterPhaseOne = computeDisplayTokens(totalModelUsage);

    expect(afterPhaseOne.modelBreakdown).toHaveLength(1);
    // Display: 1000 + 500 = 1500 (no cache)
    expect(afterPhaseOne.modelBreakdown[0]).toEqual({ model: 'claude-opus-4-6', total: 1500 });
  });

  it('includes both models with I/O-only totals after merging multi-model phases', () => {
    let totalModelUsage: ModelUsageMap = {};
    totalModelUsage = mergeModelUsageMaps(totalModelUsage, phaseOneUsage);
    totalModelUsage = mergeModelUsageMaps(totalModelUsage, phaseTwoUsage);
    const result = computeDisplayTokens(totalModelUsage);

    expect(result.modelBreakdown).toHaveLength(2);

    const opusEntry = result.modelBreakdown.find((e) => e.model === 'claude-opus-4-6');
    const haikuEntry = result.modelBreakdown.find((e) => e.model === 'claude-haiku-4-5');

    // opus: (1000+2000) input + (500+1000) output = 4500 (no cache)
    expect(opusEntry).toEqual({ model: 'claude-opus-4-6', total: 4500 });
    // haiku: 500 input + 200 output = 700 (no cache)
    expect(haikuEntry).toEqual({ model: 'claude-haiku-4-5', total: 700 });
  });

  it('sorts modelBreakdown descending by total', () => {
    let totalModelUsage: ModelUsageMap = {};
    totalModelUsage = mergeModelUsageMaps(totalModelUsage, phaseOneUsage);
    totalModelUsage = mergeModelUsageMaps(totalModelUsage, phaseTwoUsage);
    const result = computeDisplayTokens(totalModelUsage);

    expect(result.modelBreakdown[0].model).toBe('claude-opus-4-6');
    expect(result.modelBreakdown[1].model).toBe('claude-haiku-4-5');
    expect(result.modelBreakdown[0].total).toBeGreaterThan(result.modelBreakdown[1].total);
  });

  it('threads modelBreakdown into ctx.runningTokenTotal', () => {
    const ctx: WorkflowContext = { issueNumber: 1, adwId: 'test' };
    let totalModelUsage: ModelUsageMap = {};
    totalModelUsage = mergeModelUsageMaps(totalModelUsage, phaseOneUsage);
    totalModelUsage = mergeModelUsageMaps(totalModelUsage, phaseTwoUsage);

    ctx.runningTokenTotal = computeDisplayTokens(totalModelUsage);

    expect(ctx.runningTokenTotal.modelBreakdown).toHaveLength(2);
    expect(ctx.runningTokenTotal.modelBreakdown[0].model).toBe('claude-opus-4-6');
    expect(ctx.runningTokenTotal.modelBreakdown[1].model).toBe('claude-haiku-4-5');
  });

  it('computeDisplayTokens excludes cache tokens while computeTotalTokens includes them', () => {
    let totalModelUsage: ModelUsageMap = {};
    totalModelUsage = mergeModelUsageMaps(totalModelUsage, phaseOneUsage);

    const displayResult = computeDisplayTokens(totalModelUsage);
    const totalResult = computeTotalTokens(totalModelUsage);

    // Display: 1000 + 500 = 1500
    expect(displayResult.total).toBe(1500);
    expect(displayResult.cacheCreationTokens).toBe(0);

    // Total (internal): 1000 + 500 + 200 = 1700
    expect(totalResult.total).toBe(1700);
    expect(totalResult.cacheCreationTokens).toBe(200);

    expect(displayResult.total).toBeLessThan(totalResult.total);
  });
});
