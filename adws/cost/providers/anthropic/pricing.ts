/**
 * Anthropic model pricing tables using extensible PricingMap format.
 * Keys use snake_case to match the Anthropic API token type convention.
 * Values are per-token (i.e. per-million price / 1,000,000).
 */

import type { PricingMap } from '../../types';

const OPUS_PRICING: PricingMap = {
  input: 0.000005,
  output: 0.000025,
  cache_read: 0.0000005,
  cache_write: 0.00000625,
} as const;

const SONNET_PRICING: PricingMap = {
  input: 0.000003,
  output: 0.000015,
  cache_read: 0.0000003,
  cache_write: 0.00000375,
} as const;

const HAIKU_PRICING: PricingMap = {
  input: 0.000001,
  output: 0.000005,
  cache_read: 0.0000001,
  cache_write: 0.00000125,
} as const;

/** Pricing per token for known Anthropic Claude models. */
export const ANTHROPIC_PRICING: Readonly<Record<string, PricingMap>> = {
  'claude-opus-4-6': OPUS_PRICING,
  'opus': OPUS_PRICING,
  'claude-sonnet-4-5-20250929': SONNET_PRICING,
  'sonnet': SONNET_PRICING,
  'claude-haiku-4-5-20251001': HAIKU_PRICING,
  'haiku': HAIKU_PRICING,
} as const;

/** Fallback pricing when a model identifier is not recognized. */
export const DEFAULT_ANTHROPIC_PRICING: PricingMap = SONNET_PRICING;

/** Returns pricing for a model, falling back to sonnet pricing for unknown models. */
export function getAnthropicPricing(model: string): PricingMap {
  return ANTHROPIC_PRICING[model] ?? DEFAULT_ANTHROPIC_PRICING;
}
