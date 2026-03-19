/**
 * Shared helper for per-phase cost CSV writes and git commits.
 * Orchestrators call this after each phase completes to write incremental cost data
 * and enqueue a git commit, providing crash-resilient cost visibility.
 */

import { log, costCommitQueue } from '../core';
import { appendIssueCostCsv, rebuildProjectTotalCsv } from '../cost/reporting';
import { fetchExchangeRates } from '../cost/exchangeRates';
import { commitAndPushCostFiles } from '../vcs';
import type { PhaseCostRecord } from '../cost';
import type { WorkflowConfig } from './workflowLifecycle';

export interface PhaseCostCommitOptions {
  /** ADW repo root directory (process.cwd() for standard workflows). */
  readonly repoRoot: string;
  /** Repository name (e.g. 'AI_Dev_Workflow'). */
  readonly repoName: string;
  /** The GitHub issue number being worked on. */
  readonly issueNumber: number;
  /** The issue title (used to generate the CSV filename slug). */
  readonly issueTitle: string;
  /** New phase cost records to append to the per-issue CSV. */
  readonly newRecords: readonly PhaseCostRecord[];
}

/**
 * Appends phase cost records to the per-issue CSV, rebuilds the project total CSV,
 * and enqueues a cost git commit. Safe to call after every phase — errors are logged
 * but never thrown so they do not disrupt the workflow.
 */
export async function commitPhaseCostData(options: PhaseCostCommitOptions): Promise<void> {
  const { repoRoot, repoName, issueNumber, issueTitle, newRecords } = options;

  if (newRecords.length === 0) return;

  try {
    appendIssueCostCsv(repoRoot, repoName, issueNumber, issueTitle, newRecords);

    const rates = await fetchExchangeRates(['EUR']);
    const eurRate = rates['EUR'] ?? 0;
    rebuildProjectTotalCsv(repoRoot, repoName, eurRate);

    costCommitQueue.enqueue(async () => {
      commitAndPushCostFiles({ repoName, cwd: repoRoot });
    });
  } catch (error) {
    log(`Failed to commit phase cost data: ${error}`, 'error');
  }
}

/**
 * Convenience wrapper that derives repoRoot and repoName from a WorkflowConfig
 * and calls commitPhaseCostData. Orchestrators use this to avoid computing
 * repoRoot/repoName at each call site.
 */
export async function commitPhasesCostData(
  config: WorkflowConfig,
  newRecords: readonly PhaseCostRecord[],
): Promise<void> {
  const repoName = config.targetRepo?.repo ?? config.repoContext?.repoId.repo ?? 'unknown';
  const repoRoot = config.targetRepo ? process.cwd() : config.worktreePath;

  await commitPhaseCostData({
    repoRoot,
    repoName,
    issueNumber: config.issueNumber,
    issueTitle: config.issue.title,
    newRecords,
  });
}
