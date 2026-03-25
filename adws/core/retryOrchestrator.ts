/**
 * Generic retry-with-resolution orchestration logic.
 * Consolidates the common retry loop pattern from testRetry.ts and reviewRetry.ts.
 */

import { type ModelUsageMap, emptyModelUsageMap, mergeModelUsageMaps, persistTokenCounts } from '../cost';
import { type AgentIdentifier } from '../types/agentTypes';
import { AgentStateManager } from './agentState';
import { log } from './utils';
import { MAX_TOKEN_CONTINUATIONS } from './config';

export interface RetryResult<TFailure> {
  passed: boolean;
  costUsd: number;
  totalRetries: number;
  failures: TFailure[];
  modelUsage: ModelUsageMap;
  continuationCount: number;
}

export interface AgentRunResult {
  success: boolean;
  totalCostUsd?: number;
  modelUsage?: ModelUsageMap;
  compactionDetected?: boolean;
}

export interface RetryConfig<TRunResult extends AgentRunResult, TFailure> {
  maxRetries: number;
  statePath: string;
  label: string;

  /** Run the agent and return the result */
  run: () => Promise<TRunResult>;

  /** Determine if the run passed */
  isPassed: (result: TRunResult) => boolean;

  /** Extract failures from a failed run */
  extractFailures: (result: TRunResult) => TFailure[];

  /** Resolve failures (e.g., fix test, patch blocker) and return cost */
  resolveFailures: (failures: TFailure[]) => Promise<AgentRunResult>;

  /** Optional callback when a retry attempt fails */
  onRetryFailed?: (attempt: number, maxAttempts: number) => void;

  /** Optional callback when context compaction is detected; triggers a continuation without incrementing retryCount */
  onCompactionDetected?: (continuationNumber: number) => void;

  /** Maximum compaction continuations before throwing (defaults to MAX_TOKEN_CONTINUATIONS) */
  maxContinuations?: number;
}

/**
 * Helper to get ADW ID from state path.
 */
function getAdwIdFromState(statePath: string): string {
  return AgentStateManager.readState(statePath)?.adwId || '';
}

/**
 * Helper to initialize agent state.
 */
export function initAgentState(statePath: string, agentName: AgentIdentifier): string {
  return AgentStateManager.initializeState(getAdwIdFromState(statePath), agentName, statePath);
}

/**
 * Tracks cost and model usage, persisting token counts.
 */
export function trackCost(
  result: AgentRunResult,
  state: { costUsd: number; modelUsage: ModelUsageMap },
  statePath: string,
): void {
  state.costUsd += result.totalCostUsd || 0;
  if (result.modelUsage) {
    state.modelUsage = mergeModelUsageMaps(state.modelUsage, result.modelUsage);
  }
  persistTokenCounts(statePath, state.costUsd, state.modelUsage);
}

/**
 * Generic retry loop with resolution.
 * Runs an agent, checks for failures, resolves them, and retries.
 * When `onCompactionDetected` is provided, compaction events restart the current
 * step without incrementing the retry counter, up to `maxContinuations` times.
 */
export async function retryWithResolution<TRunResult extends AgentRunResult, TFailure>(
  config: RetryConfig<TRunResult, TFailure>,
): Promise<RetryResult<TFailure>> {
  const { maxRetries, statePath, label, run, isPassed, extractFailures, resolveFailures, onRetryFailed, onCompactionDetected } = config;
  const maxContinuations = config.maxContinuations ?? MAX_TOKEN_CONTINUATIONS;

  let retryCount = 0;
  let continuationCount = 0;
  const costUsd = 0;
  let lastFailures: TFailure[] = [];
  const modelUsage = emptyModelUsageMap();
  const costState = { costUsd, modelUsage };

  while (retryCount < maxRetries) {
    log(`Running ${label} (attempt ${retryCount + 1}/${maxRetries})...`, 'info');
    AgentStateManager.appendLog(statePath, `${label} attempt ${retryCount + 1}/${maxRetries}`);

    const result = await run();
    trackCost(result, costState, statePath);

    // Handle compaction recovery for run() — only when callback is provided
    if (onCompactionDetected && result.compactionDetected) {
      continuationCount++;
      log(`${label} agent context compacted (continuation ${continuationCount}/${maxContinuations})`, 'info');
      AgentStateManager.appendLog(statePath, `${label} agent context compacted (continuation ${continuationCount})`);
      if (continuationCount > maxContinuations) {
        throw new Error(`${label} exceeded maximum continuations (${maxContinuations}) due to context compaction`);
      }
      onCompactionDetected(continuationCount);
      continue; // don't increment retryCount
    }

    if (!result.success) {
      log(`${label} agent execution failed`, 'error');
      AgentStateManager.appendLog(statePath, `${label} agent execution failed`);
      retryCount++;
      continue;
    }

    if (isPassed(result)) {
      log(`${label} passed!`, 'success');
      AgentStateManager.appendLog(statePath, `${label} passed`);
      return { passed: true, costUsd: costState.costUsd, totalRetries: retryCount, failures: [], modelUsage: costState.modelUsage, continuationCount };
    }

    lastFailures = extractFailures(result);
    log(`${label}: ${lastFailures.length} failure(s) found, resolving...`, 'info');
    AgentStateManager.appendLog(statePath, `${label}: ${lastFailures.length} failure(s) found`);
    onRetryFailed?.(retryCount + 1, maxRetries);

    const resolveResult = await resolveFailures(lastFailures);
    trackCost(resolveResult, costState, statePath);

    // Handle compaction recovery for resolveFailures() — only when callback is provided
    if (onCompactionDetected && resolveResult.compactionDetected) {
      continuationCount++;
      log(`${label} resolver context compacted (continuation ${continuationCount}/${maxContinuations})`, 'info');
      AgentStateManager.appendLog(statePath, `${label} resolver context compacted (continuation ${continuationCount})`);
      if (continuationCount > maxContinuations) {
        throw new Error(`${label} exceeded maximum continuations (${maxContinuations}) due to context compaction during resolution`);
      }
      onCompactionDetected(continuationCount);
      continue; // don't increment retryCount
    }

    retryCount++;
  }

  log(`${label} still failing after ${maxRetries} attempts`, 'error');
  AgentStateManager.appendLog(statePath, `${label} still failing after ${maxRetries} attempts`);
  return { passed: false, costUsd: costState.costUsd, totalRetries: retryCount, failures: lastFailures, modelUsage: costState.modelUsage, continuationCount };
}
