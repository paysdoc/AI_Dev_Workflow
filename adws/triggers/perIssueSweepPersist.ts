/**
 * Sweep persist orchestration for the per-issue scenario retention sweep.
 *
 * Persists a removal batch via a dedicated worktree synced to fresh
 * `origin/<default>`, a dedicated sweep branch, and an immediately-merged PR —
 * never a direct commit/push onto the shared default-branch checkout. Mirrors
 * `adwUpgrade`'s non-SDLC chore-PR pattern (push a dedicated branch → open a
 * PR → immediate best-effort merge). The cron host's own base checkout
 * (`frameworkRepoRoot`) is never reset or mutated.
 *
 * The base is resolved from the passed launch boundary's own repo — never
 * from cwd. This module performs no repo-identity resolution.
 */

import { log as coreLog, type LogLevel } from '../core';
import type { LaunchBoundary } from '../core';
import type { GitContext } from '../gitContext';
import type { CodeHost } from '../providers/types';

/** Stable dedicated branch the sweep removal is pushed to and PR'd from. */
export const SWEEP_BRANCH = 'chore/scenario-sweep';

/** Unchanged from the pre-#758 direct-commit message. */
export const SWEEP_COMMIT_MESSAGE = 'chore: sweep stale per-issue scenarios (>14d post-merge)';

const PR_TITLE = 'chore: sweep stale per-issue scenarios';
const PR_BODY = 'Automated removal of per-issue scenario files whose linked PR merged more than 14 days ago.';

/** Resolved collaborators for one sweep persist cycle. */
export interface SweepBase {
  readonly ctx: GitContext;
  readonly codeHost: CodeHost;
  readonly defaultBranch: string;
  readonly sweepBranch: string;
  readonly worktreePath: string;
  /** Returns the open sweep PR number for `sweepBranch`, or null if none is open. */
  readonly findOpenSweepPr: (sweepBranch: string) => number | null;
  /** Opens a PR from `sweepBranch` into `baseBranch`; returns the PR number. */
  readonly openPr: (sweepBranch: string, baseBranch: string) => number;
  readonly mergePr: (prNumber: number) => { success: boolean; error?: string };
  readonly log: (msg: string, level?: LogLevel) => void;
}

/**
 * Creates a dedicated worktree off fresh `origin/<default>` for the sweep to
 * list, decide, and commit against — the cron host's own base checkout is
 * never reset or mutated. Returns null (logged) on any resolution failure so
 * the sweep degrades to a no-op for this cycle instead of crashing its
 * unwrapped caller in trigger_cron.ts.
 */
export function prepareSweepBase(boundary: LaunchBoundary): SweepBase | null {
  try {
    const ctx = boundary.gitContext;
    const codeHost = boundary.providers.codeHost;
    const defaultBranch = codeHost.getDefaultBranch();

    try {
      ctx.removeWorktree(SWEEP_BRANCH);
    } catch {
      // best-effort pre-clean of a stale prior sweep worktree/branch — nothing to remove is expected
    }
    const worktreePath = ctx.createWorktreeForNewBranch(SWEEP_BRANCH, defaultBranch);

    return {
      ctx,
      codeHost,
      defaultBranch,
      sweepBranch: SWEEP_BRANCH,
      worktreePath,
      findOpenSweepPr: (branch) => {
        const pr = codeHost.findPullRequestByBranch(branch);
        return pr && pr.state.toUpperCase() === 'OPEN' ? pr.number : null;
      },
      openPr: (head, base) => codeHost.createPullRequest({ title: PR_TITLE, body: PR_BODY, sourceBranch: head, targetBranch: base }).number,
      mergePr: (prNumber) => codeHost.mergePullRequest(prNumber),
      log: coreLog,
    };
  } catch (err) {
    coreLog(`perIssueSweepPersist: prepareSweepBase failed: ${err} — sweep persistence disabled for this cycle`, 'warn');
    return null;
  }
}

/**
 * Persists a removal batch: commits it on the dedicated sweep branch, pushes,
 * opens a PR into the default branch, and immediately merges it. Never
 * throws — a push/PR/merge failure is logged at error and the sweep recovers
 * on the next cycle, since the removal is never committed to the shared base
 * and the files stay tracked on origin until the PR lands.
 */
export async function persistRemovalViaPr(paths: readonly string[], base: SweepBase): Promise<void> {
  if (paths.length === 0) return;

  const openPrNumber = base.findOpenSweepPr(base.sweepBranch);
  if (openPrNumber !== null) {
    base.log(`perIssueSweepPersist: existing open sweep PR #${openPrNumber} — skipping to avoid duplicate`, 'info');
    return;
  }

  const committed = base.ctx.removeAndCommitPaths(paths, SWEEP_COMMIT_MESSAGE, base.worktreePath);
  if (!committed) return;

  try {
    base.ctx.pushBranch(base.sweepBranch, base.worktreePath);

    const prNumber = base.openPr(base.sweepBranch, base.defaultBranch);
    if (!prNumber) {
      base.log('perIssueSweepPersist: could not resolve PR number for sweep branch — retried next sweep', 'error');
      return;
    }

    const merge = base.mergePr(prNumber);
    if (!merge.success) {
      base.log(`perIssueSweepPersist: sweep PR #${prNumber} merge failed (left open, retried next sweep): ${merge.error}`, 'error');
      return;
    }

    base.log(`perIssueSweepPersist: sweep PR #${prNumber} merged; removal landed on origin`, 'success');
  } catch (err) {
    base.log(`perIssueSweepPersist: persistRemovalViaPr failed: ${err} — retried next sweep (removal not committed to the base)`, 'error');
  }
}

/** Best-effort teardown of the sweep's remote branch and local worktree. Never throws. */
export function cleanupSweepBase(base: SweepBase): void {
  try {
    base.ctx.deleteRemoteBranch(base.sweepBranch);
  } catch {
    // best-effort — the branch may already be gone (e.g. deleted by GitHub on merge)
  }
  try {
    base.ctx.removeWorktree(base.sweepBranch);
  } catch {
    // best-effort — cleanup must never crash the cron
  }
}
