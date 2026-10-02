import { computeCost } from '../../computation.ts';
import type { LegacyModelUsage, LegacyModelUsageMap, TokenUsageExtractor, TokenUsageMap } from '../../types.ts';
import { getAnthropicPricing } from './pricing.ts';

interface RunFigures {
  readonly reportedCostUSD: number | undefined;
  readonly estimatedTokens: TokenUsageMap | undefined;
  readonly actualTokens: TokenUsageMap | undefined;
}

function toLegacyModelUsage(model: string, tokens: TokenUsageMap, figures: RunFigures): LegacyModelUsage {
  return {
    inputTokens: tokens['input'] ?? 0,
    outputTokens: tokens['output'] ?? 0,
    cacheReadInputTokens: tokens['cache_read'] ?? 0,
    cacheCreationInputTokens: tokens['cache_write'] ?? 0,
    costUSD: computeCost(tokens, getAnthropicPricing(model)),
    ...(figures.reportedCostUSD !== undefined && { reportedCostUSD: figures.reportedCostUSD }),
    ...(figures.estimatedTokens !== undefined && { estimatedTokens: figures.estimatedTokens }),
    ...(figures.actualTokens !== undefined && { actualTokens: figures.actualTokens }),
  };
}

/**
 * The extractor's final state in the per-model shape the phases accumulate. `costUSD` is computed
 * locally from the pricing tables, never taken from the CLI.
 */
export function toLegacyModelUsageMap(extractor: TokenUsageExtractor): LegacyModelUsageMap {
  const reportedCostByModel = extractor.getReportedCostUsdByModel();
  const estimatedByModel = extractor.getEstimatedUsage();
  const finalized = extractor.isFinalized();
  return Object.fromEntries(
    Object.entries(extractor.getCurrentUsage()).map(([model, tokens]) => [
      model,
      toLegacyModelUsage(model, tokens, {
        reportedCostUSD: reportedCostByModel[model],
        estimatedTokens: estimatedByModel[model],
        actualTokens: finalized ? { ...tokens } : undefined,
      }),
    ]),
  );
}
