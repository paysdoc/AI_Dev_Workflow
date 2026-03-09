/**
 * Cost report utilities: merging usage maps, computing totals,
 * fetching exchange rates, and formatting markdown cost tables.
 */

import type { ModelUsageMap, CostBreakdown, CurrencyAmount } from '../types/costTypes';
import { emptyModelUsage } from '../types/costTypes';
import { log } from './utils';
import { AgentStateManager } from './agentState';

/** Last-resort fallback EUR/USD rate used when the exchange rate API is unreachable after all retries. */
const FALLBACK_EUR_RATE = 0.92;

/** Maximum number of retry attempts after the initial fetch (3 total attempts). */
const MAX_EXCHANGE_RATE_RETRIES = 2;

/** Timeout in milliseconds for each exchange rate fetch request. */
const EXCHANGE_RATE_TIMEOUT_MS = 5000;

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

/** Known fallback rates keyed by currency code. */
const FALLBACK_RATES: Readonly<Record<string, number>> = { EUR: FALLBACK_EUR_RATE };

/** Mutable cache of the most recently fetched live rates, seeded from FALLBACK_RATES. */
let lastKnownRates: Record<string, number> = { ...FALLBACK_RATES };

/** @internal Resets cached rates — for testing only. */
export function resetLastKnownRates(): void {
  lastKnownRates = { ...FALLBACK_RATES };
}

/**
 * Fetches exchange rates from the free ExchangeRate-API with retry,
 * timeout, and fallback. Retries up to {@link MAX_EXCHANGE_RATE_RETRIES}
 * additional times with exponential backoff. Falls back to approximate
 * hardcoded rates when all attempts are exhausted.
 */
export async function fetchExchangeRates(targetCurrencies: string[]): Promise<Record<string, number>> {
  if (targetCurrencies.length === 0) return {};

  const totalAttempts = MAX_EXCHANGE_RATE_RETRIES + 1;

  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    try {
      const response = await fetch('https://open.er-api.com/v6/latest/USD', {
        signal: AbortSignal.timeout(EXCHANGE_RATE_TIMEOUT_MS),
      });

      if (!response.ok) {
        log(`Exchange rate API returned status ${response.status}`, 'error');
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json() as { rates?: Record<string, number> };
      if (!data.rates) return {};

      const rates: Record<string, number> = {};
      for (const currency of targetCurrencies) {
        const rate = data.rates[currency];
        if (typeof rate === 'number') {
          rates[currency] = rate;
          lastKnownRates[currency] = rate;
        }
      }
      return rates;
    } catch (error) {
      log(`Failed to fetch exchange rates: ${error}`, 'error');

      if (attempt < totalAttempts - 1) {
        const delay = 500 * Math.pow(2, attempt);
        log(`Retrying exchange rate fetch (attempt ${attempt + 2}/${totalAttempts})...`, 'info');
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // All retries exhausted — return fallback rates for known currencies
  log('All exchange rate fetch attempts failed, using fallback rates', 'error');
  const fallbackRates: Record<string, number> = {};
  for (const currency of targetCurrencies) {
    const fallback = lastKnownRates[currency];
    if (typeof fallback === 'number') {
      fallbackRates[currency] = fallback;
    }
  }
  return fallbackRates;
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
