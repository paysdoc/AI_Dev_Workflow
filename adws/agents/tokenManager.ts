
/**
 * Token computation utilities for Claude Code agent runs.
 * Provides helpers to aggregate token usage across multiple models.
 */

import type { ModelUsageMap } from '../core';

/**
 * Aggregated token totals returned by {@link computeTotalTokens}.
 */
export interface TokenTotals {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  total: number;
}

/**
 * Computes total token counts across all models in a ModelUsageMap.
 * Sums inputTokens + outputTokens + cacheCreationInputTokens (excludes cacheReadInputTokens
 * since cached data doesn't count against the thinking budget).
 */
export function computeTotalTokens(modelUsage: ModelUsageMap): TokenTotals {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreationTokens = 0;

  for (const usage of Object.values(modelUsage)) {
    inputTokens += usage.inputTokens;
    outputTokens += usage.outputTokens;
    cacheCreationTokens += usage.cacheCreationInputTokens;
  }

  return {
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    total: inputTokens + outputTokens + cacheCreationTokens,
  };
}
