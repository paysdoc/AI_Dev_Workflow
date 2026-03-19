/**
 * Cost tracking types for the new PhaseCostRecord model.
 * One record is produced per model per phase, enabling granular cost analysis.
 */

import type { ModelUsageMap } from '../types/costTypes';

/** Lifecycle status of a phase cost record. */
export enum PhaseCostStatus {
  Success = 'success',
  Partial = 'partial',
  Failed = 'failed',
}

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
  readonly tokenUsage: Readonly<Record<string, number>>;
  /** Cost computed from local pricing tables (equals reportedCostUsd until local computation is implemented). */
  readonly computedCostUsd: number;
  /** Cost as reported by the Claude CLI. */
  readonly reportedCostUsd: number;
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
  /** Estimated tokens at phase start via streaming (0 until streaming estimation is implemented). */
  readonly estimatedTokens: number;
  /** Actual tokens consumed as reported by the CLI (0 until streaming estimation is implemented). */
  readonly actualTokens: number;
}

export interface CreatePhaseCostRecordsOptions {
  readonly workflowId: string;
  readonly issueNumber: number;
  readonly phase: string;
  readonly status: PhaseCostStatus;
  readonly retryCount: number;
  readonly continuationCount: number;
  readonly durationMs: number;
  readonly modelUsage: ModelUsageMap;
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
    estimatedTokens: 0,
    actualTokens: 0,
  }));
}
