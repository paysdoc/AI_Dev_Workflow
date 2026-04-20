/**
 * remoteReconcile — derives the authoritative WorkflowStage from remote artifacts.
 *
 * Reads branch existence and PR state from GitHub rather than trusting the
 * potentially-stale local state file. Because the GitHub API exhibits
 * read-your-write lag, a mandatory re-verification read fires immediately after
 * the first read; the two results must agree before the stage is returned.
 * If they diverge, the function retries up to MAX_RECONCILE_VERIFICATION_RETRIES
 * additional times. Persistent divergence falls back to the state-file value.
 *
 * All I/O is injected via ReconcileDeps so every code path is unit-testable
 * without touching real GitHub or the file system.
 */

import { AgentStateManager } from './agentState';
import { execWithRetry, log } from './utils';
import { defaultFindPRByBranch, type RawPR } from '../github/prApi';
import type { RepoInfo } from '../github/githubApi';
import type { AgentState } from '../types/agentTypes';
import type { WorkflowStage } from '../types/workflowTypes';

export const MAX_RECONCILE_VERIFICATION_RETRIES = 3;

/** Injectable I/O boundaries for deriveStageFromRemote. */
export interface ReconcileDeps {
  readonly readTopLevelState: (adwId: string) => AgentState | null;
  readonly branchExistsOnRemote: (branchName: string, repoInfo: RepoInfo) => boolean;
  readonly findPRByBranch: (branchName: string, repoInfo: RepoInfo) => RawPR | null;
}

/**
 * Maps remote artifact observations to a WorkflowStage.
 * Returns null when the artifacts are insufficient to determine stage
 * (caller should fall back to the state-file value).
 */
export function mapArtifactsToStage(branchExists: boolean, pr: RawPR | null): WorkflowStage | null {
  if (!branchExists) return null;
  if (pr === null) return 'branch_created';
  switch (pr.state) {
    case 'OPEN':   return 'awaiting_merge';
    case 'MERGED': return 'completed';
    case 'CLOSED': return 'discarded';
    default:       return null;
  }
}

function readOnce(branchName: string, repoInfo: RepoInfo, deps: ReconcileDeps): WorkflowStage | null {
  return mapArtifactsToStage(
    deps.branchExistsOnRemote(branchName, repoInfo),
    deps.findPRByBranch(branchName, repoInfo),
  );
}

/**
 * Derives the authoritative WorkflowStage for an ADW run from remote artifacts.
 *
 * The issueNumber parameter is reserved for future commits-ahead checks.
 */
export function deriveStageFromRemote(
  _issueNumber: number,
  adwId: string,
  repoInfo: RepoInfo,
  deps?: ReconcileDeps,
): WorkflowStage {
  const effectiveDeps = deps ?? buildDefaultReconcileDeps();
  const state = effectiveDeps.readTopLevelState(adwId);
  const branchName = state?.branchName;

  if (!branchName) {
    return (state?.workflowStage as WorkflowStage | undefined) ?? 'starting';
  }

  const stateFallback: WorkflowStage = (state?.workflowStage as WorkflowStage | undefined) ?? 'starting';

  let prev = readOnce(branchName, repoInfo, effectiveDeps);
  if (prev === null) return stateFallback;

  for (let i = 0; i <= MAX_RECONCILE_VERIFICATION_RETRIES; i++) {
    const next = readOnce(branchName, repoInfo, effectiveDeps);
    if (next === prev) return prev as WorkflowStage;
    prev = next;
    if (prev === null) return stateFallback;
  }

  return stateFallback;
}

function defaultBranchExistsOnRemote(branchName: string, _repoInfo: RepoInfo): boolean {
  try {
    execWithRetry(`git ls-remote --exit-code origin ${branchName}`);
    return true;
  } catch (err) {
    const exitCode = (err as { status?: number }).status;
    if (exitCode !== 2) {
      log(`remoteReconcile: git ls-remote failed for branch '${branchName}': ${err}`, 'warn');
    }
    return false;
  }
}

/** Wires production I/O implementations into a ReconcileDeps object. */
export function buildDefaultReconcileDeps(): ReconcileDeps {
  return {
    readTopLevelState: (id) => AgentStateManager.readTopLevelState(id),
    branchExistsOnRemote: defaultBranchExistsOnRemote,
    findPRByBranch: defaultFindPRByBranch,
  };
}
