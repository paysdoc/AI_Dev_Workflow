/**
 * Core type definitions for the cost module.
 * Extensible provider-agnostic interfaces for token usage and cost tracking,
 * plus the PhaseCostRecord model for per-phase cost tracking.
 */

import type { ModelUsageMap as LegacyModelUsageMap } from '../types/costTypes.ts';

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
  /**
   * Returns the pre-finalization estimated usage snapshot for estimate-vs-actual comparison.
   * Before finalization, returns the current accumulated per-turn estimates.
   * After finalization, returns the snapshot captured just before the result message replaced estimates with actuals.
   */
  getEstimatedUsage(): ModelUsageMap;
}

/** Result of a divergence check between locally computed and CLI-reported costs. */
export interface DivergenceResult {
  readonly isDivergent: boolean;
  readonly percentDiff: number;
  readonly computedCostUsd: number;
  readonly reportedCostUsd: number | undefined;
}

/** Lifecycle status of a phase cost record. */
export const PhaseCostStatus = {
  Success: 'success',
  Partial: 'partial',
  Failed: 'failed',
} as const;

export type PhaseCostStatus = (typeof PhaseCostStatus)[keyof typeof PhaseCostStatus];

/** Granular cost record for a single model within a single workflow phase. */
export interface PhaseCostRecord {
  /** The ADW workflow run identifier (adwId). */
  readonly workflowId: string;
  /** The GitHub issue number this workflow is processing. */
  readonly issueNumber: number;
  /** Phase name: 'plan' | 'build' | 'test' | 'pr' | 'review' | 'document' | 'scenario' | 'kpi'. */
  readonly phase: string;
  /** Model identifier as reported by the Claude CLI (e.g. 'claude-opus-4-5'). */
  readonly model: string;
  /** Provider identifier. Currently always 'anthropic'. */
  readonly provider: string;
  /** Extensible map of token type to token count. Keys include 'input', 'output', 'cache_read', 'cache_write'. */
  readonly tokenUsage: TokenUsageMap;
  /** Cost computed from local pricing tables (equals reportedCostUsd until local computation is implemented). */
  readonly computedCostUsd: number;
  /** Cost as reported by the Claude CLI (undefined if the phase terminated before a result message). */
  readonly reportedCostUsd: number | undefined;
  /** Phase outcome. */
  readonly status: PhaseCostStatus;
  /** Number of times the phase was retried (e.g. test/review retry loops). */
  readonly retryCount: number;
  /** Number of token-limit continuation spawns within this phase (build phase only). */
  readonly continuationCount: number;
  /** Wall-clock duration of the phase in milliseconds. */
  readonly durationMs: number;
  /** ISO 8601 timestamp for when the record was created (phase completion time). */
  readonly timestamp: string;
  /** Per-type estimated token usage snapshot before finalization (undefined until streaming estimation is implemented). */
  readonly estimatedTokens: TokenUsageMap | undefined;
  /** Per-type actual token usage as reported by the CLI (undefined until streaming estimation is implemented). */
  readonly actualTokens: TokenUsageMap | undefined;
}

export interface CreatePhaseCostRecordsOptions {
  readonly workflowId: string;
  readonly issueNumber: number;
  readonly phase: string;
  readonly status: PhaseCostStatus;
  readonly retryCount: number;
  readonly continuationCount: number;
  readonly durationMs: number;
  readonly modelUsage: LegacyModelUsageMap;
}

/**
 * Converts a phase's accumulated ModelUsageMap into an array of PhaseCostRecords,
 * one per model. Returns an empty array when modelUsage is empty.
 */
export function createPhaseCostRecords(options: CreatePhaseCostRecordsOptions): PhaseCostRecord[] {
  const { workflowId, issueNumber, phase, status, retryCount, continuationCount, durationMs, modelUsage } = options;
  const timestamp = new Date().toISOString();

  return Object.entries(modelUsage).map(([model, usage]) => ({
    workflowId,
    issueNumber,
    phase,
    model,
    provider: 'anthropic',
    tokenUsage: {
      input: usage.inputTokens,
      output: usage.outputTokens,
      cache_read: usage.cacheReadInputTokens,
      cache_write: usage.cacheCreationInputTokens,
    },
    computedCostUsd: usage.costUSD,
    reportedCostUsd: usage.costUSD,
    status,
    retryCount,
    continuationCount,
    durationMs,
    timestamp,
    estimatedTokens: undefined,
    actualTokens: undefined,
  }));
}
