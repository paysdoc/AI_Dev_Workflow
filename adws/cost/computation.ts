/**
 * Generic, provider-agnostic cost computation functions.
 */

import type { TokenUsageMap, PricingMap, DivergenceResult } from './types';

/**
 * Computes total cost in USD by multiplying matching keys in usage and pricing maps.
 * Keys present in usage but absent from pricing contribute zero cost.
 */
export function computeCost(usage: TokenUsageMap, pricing: PricingMap): number {
  return Object.keys(usage).reduce((total, key) => {
    const price = pricing[key];
    return price !== undefined ? total + usage[key] * price : total;
  }, 0);
}

/**
 * Checks whether the locally computed cost diverges from the CLI-reported cost
 * by more than the given threshold (default 5%).
 */
export function checkDivergence(
  computedCostUsd: number,
  reportedCostUsd: number | undefined,
  thresholdPercent = 5,
): DivergenceResult {
  if (reportedCostUsd === undefined) {
    return { isDivergent: false, percentDiff: 0, computedCostUsd, reportedCostUsd: undefined };
  }

  if (computedCostUsd === 0 && reportedCostUsd === 0) {
    return { isDivergent: false, percentDiff: 0, computedCostUsd, reportedCostUsd };
  }

  if (reportedCostUsd === 0) {
    return { isDivergent: true, percentDiff: Infinity, computedCostUsd, reportedCostUsd };
  }

  const percentDiff = (Math.abs(computedCostUsd - reportedCostUsd) / reportedCostUsd) * 100;
  return { isDivergent: percentDiff > thresholdPercent, percentDiff, computedCostUsd, reportedCostUsd };
}
