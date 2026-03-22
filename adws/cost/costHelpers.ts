/**
 * Cost utility helpers: merging usage maps, computing totals,
 * fetching exchange rates, persisting state, and formatting markdown cost tables.
 * Migrated from core/costReport.ts and core/tokenManager.ts.
 */

import type { LegacyModelUsageMap, CostBreakdown, CurrencyAmount } from './types.ts';
import { emptyLegacyModelUsage } from './types.ts';
import { AgentStateManager } from '../core/agentState';
import { fetchExchangeRates, CURRENCY_SYMBOLS } from './exchangeRates';

// ---------------------------------------------------------------------------
// ModelUsageMap merge and aggregation helpers
// ---------------------------------------------------------------------------

/** Merges multiple LegacyModelUsageMaps by summing corresponding fields per model key. */
export function mergeModelUsageMaps(...maps: LegacyModelUsageMap[]): LegacyModelUsageMap {
  const result: LegacyModelUsageMap = {};

  for (const map of maps) {
    for (const [model, usage] of Object.entries(map)) {
      const existing = result[model] ?? emptyLegacyModelUsage();
      result[model] = {
        inputTokens: existing.inputTokens + usage.inputTokens,
        outputTokens: existing.outputTokens + usage.outputTokens,
        cacheReadInputTokens: existing.cacheReadInputTokens + usage.cacheReadInputTokens,
        cacheCreationInputTokens: existing.cacheCreationInputTokens + usage.cacheCreationInputTokens,
        costUSD: existing.costUSD + usage.costUSD,
      };
    }
  }

  return result;
}

/** Sums costUSD across all models using CLI-reported cost as source of truth. */
export function computeTotalCostUsd(usageMap: LegacyModelUsageMap): number {
  return Object.values(usageMap).reduce((sum, usage) => sum + usage.costUSD, 0);
}

/** Builds a complete CostBreakdown by fetching exchange rates and computing totals. */
export async function buildCostBreakdown(
  usageMap: LegacyModelUsageMap,
  currencies: string[],
): Promise<CostBreakdown> {
  const totalCostUsd = computeTotalCostUsd(usageMap);
  const rates = await fetchExchangeRates(currencies);

  const currencyAmounts: CurrencyAmount[] = currencies
    .filter(currency => typeof rates[currency] === 'number')
    .map(currency => ({
      currency,
      amount: totalCostUsd * rates[currency],
      symbol: CURRENCY_SYMBOLS[currency] ?? currency,
    }));

  return {
    totalCostUsd,
    modelUsage: usageMap,
    currencies: currencyAmounts,
  };
}

/** Computes the EUR exchange rate from a cost breakdown, guarding against division by zero. */
export function computeEurRate(costBreakdown: CostBreakdown): number {
  const eurEntry = costBreakdown.currencies.find(c => c.currency === 'EUR');
  if (eurEntry && costBreakdown.totalCostUsd > 0) {
    return eurEntry.amount / costBreakdown.totalCostUsd;
  }
  return 0;
}

/** Formats a number with commas as thousands separator. */
function formatTokenCount(count: number): string {
  return count.toLocaleString('en-US');
}

/** Formats a cost breakdown as a markdown table for GitHub comments. */
export function formatCostBreakdownMarkdown(breakdown: CostBreakdown): string {
  const models = Object.entries(breakdown.modelUsage);

  if (models.length === 0) {
    return `**Total Cost:** $${breakdown.totalCostUsd.toFixed(4)}`;
  }

  const lines: string[] = [
    '| Model | Input Tokens | Output Tokens | Cache Read | Cache Write | Cost (USD) |',
    '|-------|-------------|---------------|------------|-------------|------------|',
  ];

  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;

  for (const [model, usage] of models) {
    totalInput += usage.inputTokens;
    totalOutput += usage.outputTokens;
    totalCacheRead += usage.cacheReadInputTokens;
    totalCacheWrite += usage.cacheCreationInputTokens;

    lines.push(
      `| ${model} | ${formatTokenCount(usage.inputTokens)} | ${formatTokenCount(usage.outputTokens)} | ${formatTokenCount(usage.cacheReadInputTokens)} | ${formatTokenCount(usage.cacheCreationInputTokens)} | $${usage.costUSD.toFixed(4)} |`
    );
  }

  lines.push(
    `| **Total** | **${formatTokenCount(totalInput)}** | **${formatTokenCount(totalOutput)}** | **${formatTokenCount(totalCacheRead)}** | **${formatTokenCount(totalCacheWrite)}** | **$${breakdown.totalCostUsd.toFixed(4)}** |`
  );

  lines.push('');
  lines.push(`**Total Cost:** $${breakdown.totalCostUsd.toFixed(4)} USD`);

  for (const currency of breakdown.currencies) {
    lines.push(`**Total Cost:** ${currency.symbol}${currency.amount.toFixed(4)} ${currency.currency}`);
  }

  return lines.join('\n');
}

/**
 * Persists accumulated token counts to the orchestrator's state.json metadata.
 * Reads existing state first to preserve other metadata fields, then merges
 * totalCostUsd and modelUsage into the metadata object.
 */
export function persistTokenCounts(statePath: string, costUsd: number, modelUsage: LegacyModelUsageMap): void {
  const existingState = AgentStateManager.readState(statePath);
  const existingMetadata = (existingState?.metadata ?? {}) as Record<string, unknown>;

  AgentStateManager.writeState(statePath, {
    metadata: { ...existingMetadata, totalCostUsd: costUsd, modelUsage },
  });
}

// ---------------------------------------------------------------------------
// Token counting helpers (migrated from core/tokenManager.ts)
// ---------------------------------------------------------------------------

/** A single model's total token count for use in per-model breakdowns. */
export interface ModelTokenEntry {
  model: string;
  total: number;
}

/** Aggregated token totals returned by {@link computeTotalTokens}. */
export interface TokenTotals {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  total: number;
  modelBreakdown: ModelTokenEntry[];
}

/**
 * Computes total token counts across all models in a LegacyModelUsageMap.
 * Sums inputTokens + outputTokens + cacheCreationInputTokens (excludes cacheReadInputTokens
 * since cached data doesn't count against the thinking budget).
 */
export function computeTotalTokens(modelUsage: LegacyModelUsageMap): TokenTotals {
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
 * Computes display-only token totals (input + output) across all models.
 * Excludes all cache tokens (both cacheCreationInputTokens and cacheReadInputTokens)
 * so the running total is easily cross-referenced with the cost breakdown table.
 * Used exclusively for the running token total shown in GitHub comments.
 */
export function computeDisplayTokens(modelUsage: LegacyModelUsageMap): TokenTotals {
  const { inputTokens, outputTokens } = Object.values(modelUsage).reduce(
    (acc, usage) => ({
      inputTokens: acc.inputTokens + usage.inputTokens,
      outputTokens: acc.outputTokens + usage.outputTokens,
    }),
    { inputTokens: 0, outputTokens: 0 },
  );

  const modelBreakdown: ModelTokenEntry[] = Object.entries(modelUsage)
    .map(([model, usage]) => ({
      model,
      total: usage.inputTokens + usage.outputTokens,
    }))
    .sort((a, b) => b.total - a.total);

  return {
    inputTokens,
    outputTokens,
    cacheCreationTokens: 0,
    total: inputTokens + outputTokens,
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
export function computePrimaryModelTokens(modelUsage: LegacyModelUsageMap, primaryModel: string): TokenTotals {
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
