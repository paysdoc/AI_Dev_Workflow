/**
 * Type definitions for token usage and cost tracking.
 * Captures per-model token breakdowns from the Claude CLI's modelUsage field.
 */

/** Per-model token usage counts and cost. */
export interface ModelUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly costUSD: number;
}

/** Map of model name/ID to its token usage. */
export type ModelUsageMap = Record<string, ModelUsage>;

/** A cost amount in a specific currency. */
export interface CurrencyAmount {
  readonly currency: string;
  readonly amount: number;
  readonly symbol: string;
}

/** Complete cost breakdown for a workflow run. */
export interface CostBreakdown {
  readonly totalCostUsd: number;
  readonly modelUsage: ModelUsageMap;
  readonly currencies: readonly CurrencyAmount[];
}

/** Creates a zero-valued ModelUsage. */
export function emptyModelUsage(): ModelUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    costUSD: 0,
  };
}

/** Creates an empty ModelUsageMap. */
export function emptyModelUsageMap(): ModelUsageMap {
  return {};
}
