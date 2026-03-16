/**
 * Static pricing data per Claude model.
 * Maps model identifiers to cost per million tokens.
 * Easy to update when Anthropic releases new models or changes pricing.
 */

import type { ModelUsage } from '../types/costTypes';

/** Pricing per million tokens for a model. */
export interface ModelPricing {
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
  readonly cacheReadPerMillion: number;
  readonly cacheCreationPerMillion: number;
}

/**
 * Pricing data for known Claude models (as of Feb 2026).
 * Both short aliases and full model IDs are supported.
 */
export const MODEL_PRICING: Readonly<Record<string, ModelPricing>> = {
  // Opus 4.6
  'claude-opus-4-6': { inputPerMillion: 5.0, outputPerMillion: 25.0, cacheReadPerMillion: 0.5, cacheCreationPerMillion: 6.25 },
  'opus': { inputPerMillion: 5.0, outputPerMillion: 25.0, cacheReadPerMillion: 0.5, cacheCreationPerMillion: 6.25 },

  // Sonnet 4.5
  'claude-sonnet-4-5-20250929': { inputPerMillion: 3.0, outputPerMillion: 15.0, cacheReadPerMillion: 0.3, cacheCreationPerMillion: 3.75 },
  'sonnet': { inputPerMillion: 3.0, outputPerMillion: 15.0, cacheReadPerMillion: 0.3, cacheCreationPerMillion: 3.75 },

  // Haiku 4.5
  'claude-haiku-4-5-20251001': { inputPerMillion: 1.0, outputPerMillion: 5.0, cacheReadPerMillion: 0.1, cacheCreationPerMillion: 1.25 },
  'haiku': { inputPerMillion: 1.0, outputPerMillion: 5.0, cacheReadPerMillion: 0.1, cacheCreationPerMillion: 1.25 },
} as const;

/** Default pricing (sonnet) used when a model name is not recognized. */
const DEFAULT_PRICING = MODEL_PRICING['sonnet'];

/** Returns pricing for a model, falling back to sonnet pricing for unknown models. */
function getModelPricing(modelName: string): ModelPricing {
  return MODEL_PRICING[modelName] ?? DEFAULT_PRICING;
}

/** Computes USD cost from token counts using the pricing data for the given model. */
export function computeModelCost(modelName: string, usage: ModelUsage): number {
  const pricing = getModelPricing(modelName);
  return (
    (usage.inputTokens * pricing.inputPerMillion) / 1_000_000 +
    (usage.outputTokens * pricing.outputPerMillion) / 1_000_000 +
    (usage.cacheReadInputTokens * pricing.cacheReadPerMillion) / 1_000_000 +
    (usage.cacheCreationInputTokens * pricing.cacheCreationPerMillion) / 1_000_000
  );
}
