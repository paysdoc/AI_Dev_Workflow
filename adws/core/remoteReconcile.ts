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
import { log } from './utils';
import { defaultFindPRByBranch } from '../github/prApi';
import type { RepoInfo } from '../github/githubApi';
import { gitContextForRepo } from '../github/gitContextFactory';
import type { AgentState } from '../types/agentTypes';
import type { WorkflowStage } from '../types/workflowTypes';
import type { LaunchBoundary } from './launchGitContext';
import type { PullRequestSummary } from '../providers/types';

export const MAX_RECONCILE_VERIFICATION_RETRIES = 3;

/**
 * Injectable I/O boundaries for deriveStageFromRemote. Identity is closed
 * over by whichever builder constructed these — neither reads a repoInfo
 * per call.
 */
export interface ReconcileDeps {
  readonly readTopLevelState: (adwId: string) => AgentState | null;
  readonly branchExistsOnRemote: (branchName: string) => boolean;
  readonly findPRByBranch: (branchName: string) => Pick<PullRequestSummary, 'state'> | null;
}

/**
 * Maps remote artifact observations to a WorkflowStage.
 * Returns null when the artifacts are insufficient to determine stage
 * (caller should fall back to the state-file value).
 */
export function mapArtifactsToStage(branchExists: boolean, pr: Pick<PullRequestSummary, 'state'> | null): WorkflowStage | null {
  if (!branchExists) return null;
  if (pr === null) return 'branch_created';
  switch (pr.state) {
    case 'OPEN':   return 'awaiting_merge';
    case 'MERGED': return 'completed';
    case 'CLOSED': return 'discarded';
    default:       return null;
  }
}

function readOnce(branchName: string, deps: ReconcileDeps): WorkflowStage | null {
  return mapArtifactsToStage(
    deps.branchExistsOnRemote(branchName),
    deps.findPRByBranch(branchName),
  );
}

/**
 * Derives the authoritative WorkflowStage for an ADW run from remote artifacts.
 *
 * The issueNumber parameter is reserved for future commits-ahead checks.
 * `deps` defaults to the legacy `repoInfo`-scoped wiring (`buildLegacyReconcileDeps`)
 * for the no-boundary takeover callers (scanAuthQueue, webhookGatekeeper); a
 * caller holding a launch boundary should pass `buildDefaultReconcileDeps(boundary)`.
 */
export function deriveStageFromRemote(
  _issueNumber: number,
  adwId: string,
  repoInfo: RepoInfo,
  deps?: ReconcileDeps,
): WorkflowStage {
  const effectiveDeps = deps ?? buildLegacyReconcileDeps(repoInfo);
  const state = effectiveDeps.readTopLevelState(adwId);
  const branchName = state?.branchName;

  if (!branchName) {
    return (state?.workflowStage as WorkflowStage | undefined) ?? 'starting';
  }

  const stateFallback: WorkflowStage = (state?.workflowStage as WorkflowStage | undefined) ?? 'starting';

  let prev = readOnce(branchName, effectiveDeps);
  if (prev === null) return stateFallback;

  for (let i = 0; i <= MAX_RECONCILE_VERIFICATION_RETRIES; i++) {
    const next = readOnce(branchName, effectiveDeps);
    if (next === prev) return prev as WorkflowStage;
    prev = next;
    if (prev === null) return stateFallback;
  }

  return stateFallback;
}

/**
 * Today's `repoInfo`-scoped wiring, unchanged — the fallback for the two
 * legacy takeover callers (scanAuthQueue, webhookGatekeeper) that hold no
 * launch boundary.
 */
function buildLegacyReconcileDeps(repoInfo: RepoInfo): ReconcileDeps {
  return {
    readTopLevelState: (id) => AgentStateManager.readTopLevelState(id),
    branchExistsOnRemote: (branchName) => {
      try {
        return gitContextForRepo(repoInfo).lsRemote(branchName).length > 0;
      } catch (err) {
        log(`remoteReconcile: git ls-remote failed for branch '${branchName}': ${err}`, 'warn');
        return false;
      }
    },
    findPRByBranch: (branchName) => defaultFindPRByBranch(branchName, repoInfo),
  };
}

/**
 * Wires a launch boundary's git ops and providers into a ReconcileDeps
 * object — no memoisation: both `branchExistsOnRemote` and `findPRByBranch`
 * hit the code host afresh on every call, since the mandatory
 * re-verification read inside deriveStageFromRemote must reach the forge a
 * second time or the read-your-write cross-check degenerates into ceremony.
 */
export function buildDefaultReconcileDeps(boundary: LaunchBoundary): ReconcileDeps {
  return {
    readTopLevelState: (id) => AgentStateManager.readTopLevelState(id),
    branchExistsOnRemote: (branchName) => {
      try {
        return boundary.gitContext.lsRemote(branchName).length > 0;
      } catch (err) {
        log(`remoteReconcile: git ls-remote failed for branch '${branchName}': ${err}`, 'warn');
        return false;
      }
    },
    findPRByBranch: (branchName) => boundary.providers.codeHost.findPullRequestByBranch(branchName),
  };
}
