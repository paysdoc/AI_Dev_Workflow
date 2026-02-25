
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

/**
 * Checks whether a full model ID key (e.g., `claude-opus-4-6`) matches a
 * model tier shorthand (e.g., `opus`). Uses a case-insensitive includes check
 * so it works with any versioned model ID format.
 */
export function isModelMatch(modelKey: string, modelTier: string): boolean {
  return modelKey.toLowerCase().includes(modelTier.toLowerCase());
}

/**
 * Computes token totals for only the primary model, filtering out subagent
 * models (e.g., haiku/sonnet spawned internally by the CLI for Task tools).
 * Used for token limit checks so that subagent usage does not trigger false
 * positive terminations.
 */
export function computePrimaryModelTokens(modelUsage: ModelUsageMap, primaryModel: string): TokenTotals {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreationTokens = 0;

  for (const [key, usage] of Object.entries(modelUsage)) {
    if (isModelMatch(key, primaryModel)) {
      inputTokens += usage.inputTokens;
      outputTokens += usage.outputTokens;
      cacheCreationTokens += usage.cacheCreationInputTokens;
    }
  }

  return {
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    total: inputTokens + outputTokens + cacheCreationTokens,
  };
}
