/**
 * Cost report utilities: merging usage maps, computing totals,
 * fetching exchange rates, and formatting markdown cost tables.
 */

import type { ModelUsageMap, CostBreakdown, CurrencyAmount } from '../types/costTypes';
import { emptyModelUsage } from '../types/costTypes';
import { AgentStateManager } from './agentState';

// Exchange rate logic lives in adws/cost/exchangeRates.ts — re-exported here for backward compatibility.
export { fetchExchangeRates, CURRENCY_SYMBOLS } from '../cost/exchangeRates';
import { fetchExchangeRates, CURRENCY_SYMBOLS } from '../cost/exchangeRates';

/** Merges multiple ModelUsageMaps by summing corresponding fields per model key. */
export function mergeModelUsageMaps(...maps: ModelUsageMap[]): ModelUsageMap {
  const result: ModelUsageMap = {};

  for (const map of maps) {
    for (const [model, usage] of Object.entries(map)) {
      const existing = result[model] ?? emptyModelUsage();
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
export function computeTotalCostUsd(usageMap: ModelUsageMap): number {
  return Object.values(usageMap).reduce((sum, usage) => sum + usage.costUSD, 0);
}

/** Builds a complete CostBreakdown by fetching exchange rates and computing totals. */
export async function buildCostBreakdown(
  usageMap: ModelUsageMap,
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
export function persistTokenCounts(statePath: string, costUsd: number, modelUsage: ModelUsageMap): void {
  const existingState = AgentStateManager.readState(statePath);
  const existingMetadata = (existingState?.metadata ?? {}) as Record<string, unknown>;

  AgentStateManager.writeState(statePath, {
    metadata: { ...existingMetadata, totalCostUsd: costUsd, modelUsage },
  });
}
