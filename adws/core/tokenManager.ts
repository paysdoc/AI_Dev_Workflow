
/**
 * Token computation utilities for Claude Code agent runs.
 * Provides helpers to aggregate token usage across multiple models.
 */

import type { ModelUsageMap } from '../types/costTypes';

/** A single model's total token count for use in per-model breakdowns. */
export interface ModelTokenEntry {
  model: string;
  total: number;
}

/**
 * Aggregated token totals returned by {@link computeTotalTokens}.
 */
export interface TokenTotals {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  total: number;
  modelBreakdown: ModelTokenEntry[];
}

/**
 * Computes total token counts across all models in a ModelUsageMap.
 * Sums inputTokens + outputTokens + cacheCreationInputTokens (excludes cacheReadInputTokens
 * since cached data doesn't count against the thinking budget).
 */
export function computeTotalTokens(modelUsage: ModelUsageMap): TokenTotals {
  const { inputTokens, outputTokens, cacheCreationTokens } = Object.values(modelUsage).reduce(
    (acc, usage) => ({
      inputTokens: acc.inputTokens + usage.inputTokens,
      outputTokens: acc.outputTokens + usage.outputTokens,
      cacheCreationTokens: acc.cacheCreationTokens + usage.cacheCreationInputTokens,
    }),
    { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0 },
  );

  const modelBreakdown: ModelTokenEntry[] = Object.entries(modelUsage)
    .map(([model, usage]) => ({
      model,
      total: usage.inputTokens + usage.outputTokens + usage.cacheCreationInputTokens,
    }))
    .sort((a, b) => b.total - a.total);

  return {
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    total: inputTokens + outputTokens + cacheCreationTokens,
    modelBreakdown,
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
  const matchingEntries = Object.entries(modelUsage).filter(([key]) => isModelMatch(key, primaryModel));

  const { inputTokens, outputTokens, cacheCreationTokens } = matchingEntries.reduce(
    (acc, [, usage]) => ({
      inputTokens: acc.inputTokens + usage.inputTokens,
      outputTokens: acc.outputTokens + usage.outputTokens,
      cacheCreationTokens: acc.cacheCreationTokens + usage.cacheCreationInputTokens,
    }),
    { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0 },
  );

  const modelBreakdown: ModelTokenEntry[] = matchingEntries
    .map(([model, usage]) => ({
      model,
      total: usage.inputTokens + usage.outputTokens + usage.cacheCreationInputTokens,
    }))
    .sort((a, b) => b.total - a.total);

  return {
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    total: inputTokens + outputTokens + cacheCreationTokens,
    modelBreakdown,
  };
}
