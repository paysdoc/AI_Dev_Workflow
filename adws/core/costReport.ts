/**
 * Cost report utilities: merging usage maps, computing totals,
 * fetching exchange rates, and formatting markdown cost tables.
 */

import type { ModelUsageMap, CostBreakdown, CurrencyAmount } from './costTypes';
import { emptyModelUsage } from './costTypes';
import { log } from './utils';
import { AgentStateManager } from './agentState';

/** Maps common currency codes to their symbols. */
export const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  USD: '$',
  EUR: '\u20ac',
  GBP: '\u00a3',
  JPY: '\u00a5',
  CAD: 'CA$',
  AUD: 'AU$',
  CHF: 'CHF',
} as const;

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

/**
 * Fetches exchange rates from the free ExchangeRate-API.
 * Returns a map of currency code to conversion rate from USD.
 * Handles network errors gracefully by returning an empty map.
 */
export async function fetchExchangeRates(targetCurrencies: string[]): Promise<Record<string, number>> {
  if (targetCurrencies.length === 0) return {};

  try {
    const response = await fetch('https://open.er-api.com/v6/latest/USD');
    if (!response.ok) {
      log(`Exchange rate API returned status ${response.status}`, 'error');
      return {};
    }

    const data = await response.json() as { rates?: Record<string, number> };
    if (!data.rates) return {};

    const rates: Record<string, number> = {};
    for (const currency of targetCurrencies) {
      const rate = data.rates[currency];
      if (typeof rate === 'number') {
        rates[currency] = rate;
      }
    }
    return rates;
  } catch (error) {
    log(`Failed to fetch exchange rates: ${error}`, 'error');
    return {};
  }
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
