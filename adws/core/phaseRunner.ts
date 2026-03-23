/**
 * PhaseRunner — encapsulates per-phase cost-tracking boilerplate.
 *
 * Every composite orchestrator repeats the same pattern after each phase:
 *   1. Accumulate costUsd and modelUsage into running totals.
 *   2. Persist token counts to the orchestrator state file.
 *   3. Optionally update config.ctx.runningTokenTotal for live GitHub comments.
 *   4. Commit phase cost records to the CSV.
 *
 * PhaseRunner captures that pattern so orchestrators only list which phases
 * to run rather than repeating the bookkeeping lines.
 */

import { RUNNING_TOKENS } from './config';
import { mergeModelUsageMaps, persistTokenCounts, computeDisplayTokens } from '../cost';
import type { ModelUsageMap, PhaseCostRecord } from '../cost';
import { commitPhasesCostData } from '../phases/phaseCostCommit';
import type { WorkflowConfig } from '../phases/workflowInit';

/**
 * The result shape every phase function must return.
 * Matches the existing return type of all executeXxxPhase() functions.
 * phaseCostRecords is optional for phases that do not track CSV cost records.
 */
export interface PhaseResult {
  costUsd: number;
  modelUsage: ModelUsageMap;
  phaseCostRecords?: PhaseCostRecord[];
}

/**
 * A workflow phase function: receives the current WorkflowConfig
 * (which may include an updated totalModelUsage) and returns a PhaseResult.
 */
export type PhaseFn = (config: WorkflowConfig) => Promise<PhaseResult>;

/**
 * CostTracker accumulates cost and model usage across phases and provides
 * helpers to persist and commit after each phase.
 */
export class CostTracker {
  private _totalCostUsd = 0;
  private _totalModelUsage: ModelUsageMap = {};

  get totalCostUsd(): number {
    return this._totalCostUsd;
  }

  get totalModelUsage(): ModelUsageMap {
    return this._totalModelUsage;
  }

  /**
   * Adds a phase result's cost and model usage to the running totals.
   */
  accumulate(result: PhaseResult): void {
    this._totalCostUsd += result.costUsd;
    this._totalModelUsage = mergeModelUsageMaps(this._totalModelUsage, result.modelUsage);
  }

  /**
   * Persists the current token totals to the orchestrator state file
   * and optionally updates the live running-token display.
   */
  persist(config: WorkflowConfig): void {
    persistTokenCounts(config.orchestratorStatePath, this._totalCostUsd, this._totalModelUsage);
    if (RUNNING_TOKENS) {
      config.ctx.runningTokenTotal = computeDisplayTokens(this._totalModelUsage);
    }
    // Mirror accumulated totals so subsequent phases can read them via config.
    config.totalModelUsage = this._totalModelUsage;
  }

  /**
   * Commits phase cost records to the per-issue CSV and triggers a git commit.
   * Errors are swallowed so cost failures never abort a workflow.
   */
  async commit(config: WorkflowConfig, records: PhaseCostRecord[]): Promise<void> {
    await commitPhasesCostData(config, records);
  }
}

/**
 * Runs a single phase, accumulates its results into the tracker,
 * persists token counts, and commits cost data.
 *
 * @param config - Mutable WorkflowConfig shared across all phases.
 * @param tracker - CostTracker accumulating totals across the workflow.
 * @param fn - The phase function to execute.
 * @returns The phase result (for callers that need phase-specific fields).
 */
export async function runPhase<R extends PhaseResult>(
  config: WorkflowConfig,
  tracker: CostTracker,
  fn: (config: WorkflowConfig) => Promise<R>,
): Promise<R> {
  const result = await fn(config);
  tracker.accumulate(result);
  tracker.persist(config);
  await tracker.commit(config, result.phaseCostRecords ?? []);
  return result;
}

/**
 * Runs a sequence of phases in order, returning all results.
 * Each phase sees the updated config.totalModelUsage from the previous phase.
 */
export async function runPhasesSequential<R extends PhaseResult>(
  config: WorkflowConfig,
  tracker: CostTracker,
  fns: ReadonlyArray<(config: WorkflowConfig) => Promise<R>>,
): Promise<R[]> {
  const results: R[] = [];
  for (const fn of fns) {
    results.push(await runPhase(config, tracker, fn));
  }
  return results;
}

/**
 * Runs phases concurrently and merges their combined results into the tracker.
 * Use only when the phases have no data dependency on each other.
 */
export async function runPhasesParallel<R extends PhaseResult>(
  config: WorkflowConfig,
  tracker: CostTracker,
  fns: ReadonlyArray<(config: WorkflowConfig) => Promise<R>>,
): Promise<R[]> {
  const results = await Promise.all(fns.map(fn => fn(config)));
  const mergedRecords: PhaseCostRecord[] = results.flatMap(r => r.phaseCostRecords ?? []);
  const mergedUsage = results.reduce(
    (acc, r) => mergeModelUsageMaps(acc, r.modelUsage),
    {} as ModelUsageMap,
  );
  const mergedCost = results.reduce((sum, r) => sum + r.costUsd, 0);
  // Accumulate merged totals in one shot so persist() reflects all parallel phases.
  tracker.accumulate({ costUsd: mergedCost, modelUsage: mergedUsage, phaseCostRecords: mergedRecords });
  tracker.persist(config);
  await tracker.commit(config, mergedRecords);
  return results;
}
