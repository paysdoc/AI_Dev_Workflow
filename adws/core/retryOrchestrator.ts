/**
 * Generic retry-with-resolution orchestration logic.
 * Consolidates the common retry loop pattern from testRetry.ts and reviewRetry.ts.
 */

import { type ModelUsageMap, emptyModelUsageMap } from '../types/costTypes';
import { mergeModelUsageMaps, persistTokenCounts } from './costReport';
import { type AgentIdentifier } from '../types/dataTypes';
import { AgentStateManager } from './agentState';
import { log } from './utils';

export interface RetryResult<TFailure> {
  passed: boolean;
  costUsd: number;
  totalRetries: number;
  failures: TFailure[];
  modelUsage: ModelUsageMap;
}

export interface AgentRunResult {
  success: boolean;
  totalCostUsd?: number;
  modelUsage?: ModelUsageMap;
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
 */
export async function retryWithResolution<TRunResult extends AgentRunResult, TFailure>(
  config: RetryConfig<TRunResult, TFailure>,
): Promise<RetryResult<TFailure>> {
  const { maxRetries, statePath, label, run, isPassed, extractFailures, resolveFailures, onRetryFailed } = config;

  let retryCount = 0;
  const costUsd = 0;
  let lastFailures: TFailure[] = [];
  const modelUsage = emptyModelUsageMap();
  const costState = { costUsd, modelUsage };

  while (retryCount < maxRetries) {
    log(`Running ${label} (attempt ${retryCount + 1}/${maxRetries})...`, 'info');
    AgentStateManager.appendLog(statePath, `${label} attempt ${retryCount + 1}/${maxRetries}`);

    const result = await run();
    trackCost(result, costState, statePath);

    if (!result.success) {
      log(`${label} agent execution failed`, 'error');
      AgentStateManager.appendLog(statePath, `${label} agent execution failed`);
      retryCount++;
      continue;
    }

    if (isPassed(result)) {
      log(`${label} passed!`, 'success');
      AgentStateManager.appendLog(statePath, `${label} passed`);
      return { passed: true, costUsd: costState.costUsd, totalRetries: retryCount, failures: [], modelUsage: costState.modelUsage };
    }

    lastFailures = extractFailures(result);
    log(`${label}: ${lastFailures.length} failure(s) found, resolving...`, 'info');
    AgentStateManager.appendLog(statePath, `${label}: ${lastFailures.length} failure(s) found`);
    onRetryFailed?.(retryCount + 1, maxRetries);

    const resolveResult = await resolveFailures(lastFailures);
    trackCost(resolveResult, costState, statePath);

    retryCount++;
  }

  log(`${label} still failing after ${maxRetries} attempts`, 'error');
  AgentStateManager.appendLog(statePath, `${label} still failing after ${maxRetries} attempts`);
  return { passed: false, costUsd: costState.costUsd, totalRetries: retryCount, failures: lastFailures, modelUsage: costState.modelUsage };
}
