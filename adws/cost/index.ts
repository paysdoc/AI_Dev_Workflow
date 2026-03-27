/**
 * Barrel exports for the adws/cost module.
 */

// New-format types (snake_case, used internally by extractors)
export type {
  TokenUsageMap,
  PricingMap,
  TokenUsageExtractor,
  DivergenceResult,
  PhaseCostRecord,
  CreatePhaseCostRecordsOptions,
} from './types.ts';
export { PhaseCostStatus, createPhaseCostRecords } from './types.ts';

// Legacy camelCase types (migrated from types/costTypes.ts)
// Exported under their original names for backward-compatible consumers.
// Note: `ModelUsageMap` here is the legacy Record<string, LegacyModelUsage> format,
// not the new snake_case Record<string, TokenUsageMap> format in types.ts.
export type {
  LegacyModelUsage as ModelUsage,
  LegacyModelUsageMap as ModelUsageMap,
  CurrencyAmount,
  CostBreakdown,
} from './types.ts';
export { emptyLegacyModelUsage as emptyModelUsage, emptyLegacyModelUsageMap as emptyModelUsageMap } from './types.ts';

export { computeCost, checkDivergence } from './computation.ts';
export { AnthropicTokenUsageExtractor, ANTHROPIC_PRICING, DEFAULT_ANTHROPIC_PRICING, getAnthropicPricing } from './providers/anthropic/index.ts';

export {
  FALLBACK_EUR_RATE,
  MAX_EXCHANGE_RATE_RETRIES,
  EXCHANGE_RATE_TIMEOUT_MS,
  CURRENCY_SYMBOLS,
  FALLBACK_RATES,
  lastKnownRates,
  fetchExchangeRates,
} from './exchangeRates.ts';

export type { ProjectTotalRow } from './reporting/index.ts';
export {
  FIXED_TOKEN_COLUMNS,
  collectAllTokenTypes,
  formatIssueCostCsv,
  writeIssueCostCsv,
  appendIssueCostCsv,
  parseIssueCostCsv,
  parseIssueCostTotal,
  formatProjectTotalCsv,
  rebuildProjectTotalCsv,
  formatCostTable,
  formatDivergenceWarning,
  formatEstimateVsActual,
  formatCurrencyTotals,
  formatCostCommentSection,
} from './reporting/index.ts';

// Commit queue (serializes cost-related git operations)
export { costCommitQueue, CostCommitQueue } from './commitQueue.ts';

// D1 HTTP client
export { postCostRecordsToD1 } from './d1Client.ts';

// Cost helpers (migrated from core/costReport.ts and core/tokenManager.ts)
export type { ModelTokenEntry, TokenTotals } from './costHelpers.ts';
export {
  mergeModelUsageMaps,
  computeTotalCostUsd,
  buildCostBreakdown,
  computeEurRate,
  formatCostBreakdownMarkdown,
  persistTokenCounts,
  computeTotalTokens,
  computeDisplayTokens,
  isModelMatch,
  computePrimaryModelTokens,
} from './costHelpers.ts';
