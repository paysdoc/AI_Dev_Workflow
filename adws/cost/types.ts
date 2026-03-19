/**
 * Core type definitions for the cost module.
 * Extensible provider-agnostic interfaces for token usage and cost tracking.
 */

/** Extensible token count map with provider-specific keys (e.g. input, output, cache_read, cache_write). */
export type TokenUsageMap = Record<string, number>;

/** Per-token pricing map with provider-specific keys matching TokenUsageMap keys. */
export type PricingMap = Record<string, number>;

/** Token usage keyed by model identifier. */
export type ModelUsageMap = Record<string, TokenUsageMap>;

/** Pull-model interface for streaming token usage extraction. */
export interface TokenUsageExtractor {
  /** Feed raw stdout chunks from the CLI. */
  onChunk(chunk: string): void;
  /** Poll current accumulated usage by model. */
  getCurrentUsage(): ModelUsageMap;
  /** Whether the result message has been received and finalized. */
  isFinalized(): boolean;
  /** CLI-reported total cost in USD (available after finalization). */
  getReportedCostUsd(): number | undefined;
}

/** Result of a divergence check between locally computed and CLI-reported costs. */
export interface DivergenceResult {
  readonly isDivergent: boolean;
  readonly percentDiff: number;
  readonly computedCostUsd: number;
  readonly reportedCostUsd: number | undefined;
}

/** Cost record for a single workflow phase. */
export interface PhaseCostRecord {
  readonly workflowId: string;
  readonly issueNumber: number;
  readonly phase: string;
  readonly model: string;
  readonly provider: string;
  readonly tokenUsage: TokenUsageMap;
  readonly computedCostUsd: number;
  readonly reportedCostUsd: number | undefined;
  readonly status: 'success' | 'partial' | 'failed';
  readonly retryCount: number;
  readonly continuationCount: number;
  readonly durationMs: number;
  readonly timestamp: string;
  readonly estimatedTokens: TokenUsageMap | undefined;
  readonly actualTokens: TokenUsageMap | undefined;
}
