/** Extensible token count map with provider-specific keys (e.g. input, output, cache_read, cache_write). */
export type TokenUsageMap = Record<string, number>;

/** Per-token pricing map with provider-specific keys matching TokenUsageMap keys. */
export type PricingMap = Record<string, number>;

/** Token usage keyed by model identifier (new snake_case format, used by extractors). */
export type ModelUsageMap = Record<string, TokenUsageMap>;

export interface LegacyModelUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly costUSD: number;
}

export type LegacyModelUsageMap = Record<string, LegacyModelUsage>;

export interface CurrencyAmount {
  readonly currency: string;
  readonly amount: number;
  readonly symbol: string;
}

export interface CostBreakdown {
  readonly totalCostUsd: number;
  readonly modelUsage: LegacyModelUsageMap;
  readonly currencies: readonly CurrencyAmount[];
}

export function emptyLegacyModelUsage(): LegacyModelUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    costUSD: 0,
  };
}

export function emptyLegacyModelUsageMap(): LegacyModelUsageMap {
  return {};
}

/** Pull-model interface for streaming token usage extraction. */
export interface TokenUsageExtractor {
  /** Feed raw stdout chunks from the CLI. */
  onChunk(chunk: string): void;
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

export interface DivergenceResult {
  readonly isDivergent: boolean;
  readonly percentDiff: number;
  readonly computedCostUsd: number;
  readonly reportedCostUsd: number | undefined;
}

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
  readonly issueNumber: number;
  /** Phase name: 'plan' | 'build' | 'test' | 'pr' | 'review' | 'document' | 'scenario'. */
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
  readonly status: PhaseCostStatus;
  /** Number of times the phase was retried (e.g. test/review retry loops). */
  readonly retryCount: number;
  /** Number of context resets within this phase (build phase only). */
  readonly contextResetCount: number;
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
  readonly contextResetCount: number;
  readonly durationMs: number;
  readonly modelUsage: LegacyModelUsageMap;
}

/**
 * Converts a phase's accumulated ModelUsageMap into an array of PhaseCostRecords,
 * one per model. Returns an empty array when modelUsage is empty.
 */
export function createPhaseCostRecords(options: CreatePhaseCostRecordsOptions): PhaseCostRecord[] {
  const { workflowId, issueNumber, phase, status, retryCount, contextResetCount, durationMs, modelUsage } = options;
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
    contextResetCount,
    durationMs,
    timestamp,
    estimatedTokens: undefined,
    actualTokens: undefined,
  }));
}
