/**
 * Exchange rate utilities: fetching live rates with retry and fallback.
 * Moved from adws/core/costReport.ts for modular cost architecture.
 */

import { log } from '../core/utils';

/** Last-resort fallback EUR/USD rate used when the exchange rate API is unreachable after all retries. */
export const FALLBACK_EUR_RATE = 0.92;

/** Maximum number of retry attempts after the initial fetch (3 total attempts). */
export const MAX_EXCHANGE_RATE_RETRIES = 2;

/** Timeout in milliseconds for each exchange rate fetch request. */
export const EXCHANGE_RATE_TIMEOUT_MS = 5000;

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

/** Known fallback rates keyed by currency code. */
export const FALLBACK_RATES: Readonly<Record<string, number>> = { EUR: FALLBACK_EUR_RATE };

/** Cache of the most recently fetched live rates, seeded from FALLBACK_RATES. */
export const lastKnownRates: Record<string, number> = { ...FALLBACK_RATES };

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
