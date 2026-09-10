/**
 * Sweep persist orchestration — the generic dedicated-worktree /
 * dedicated-branch / immediately-merged-PR path every cron sweep persists
 * through.
 *
 * Persists a batch via a dedicated worktree synced to fresh
 * `origin/<default>`, a dedicated sweep branch, and an immediately-merged PR —
 * never a direct commit/push onto the shared default-branch checkout. Mirrors
 * `adwUpgrade`'s non-SDLC chore-PR pattern (push a dedicated branch → open a
 * PR → immediate best-effort merge). The cron host's own base checkout
 * (`frameworkRepoRoot`) is never reset or mutated.
 *
 * `SweepPersistSpec` parameterises the branch name and PR title/body so a
 * sibling sweep (the docs-index sweep) gets its own dedicated branch and PR
 * copy instead of colliding with the per-issue scenario sweep's
 * `chore/scenario-sweep`. `persistRemovalViaPr` — the per-issue sweep's
 * original entry point — is now a one-line wrapper over the generic
 * `persistCommitViaPr`, so its behaviour and log wording it kept are
 * unchanged for existing callers and tests.
 *
 * The base is resolved from the passed launch boundary's own repo — never
 * from cwd. This module performs no repo-identity resolution.
 */

import { log as coreLog, type LogLevel } from '../core';
import type { LaunchBoundary } from '../core';
import type { GitContext } from '../gitContext';
import type { CodeHost } from '../providers/types';

/** Stable dedicated branch the per-issue sweep's removal is pushed to and PR'd from. */
export const SWEEP_BRANCH = 'chore/scenario-sweep';

/** Unchanged from the pre-#758 direct-commit message. */
export const SWEEP_COMMIT_MESSAGE = 'chore: sweep stale per-issue scenarios (>14d post-merge)';

const PR_TITLE = 'chore: sweep stale per-issue scenarios';
const PR_BODY = 'Automated removal of per-issue scenario files whose linked PR merged more than 14 days ago.';

/** The dedicated branch + PR title/body a sweep persists its change through. */
export interface SweepPersistSpec {
  readonly branch: string;
  readonly prTitle: string;
  readonly prBody: string;
}

/** The per-issue scenario sweep's spec — today's `chore/scenario-sweep` branch and PR copy, unchanged. */
export const PER_ISSUE_SWEEP_SPEC: SweepPersistSpec = {
  branch: SWEEP_BRANCH,
  prTitle: PR_TITLE,
  prBody: PR_BODY,
};

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
 * unwrapped caller in trigger_cron.ts. `spec` defaults to the per-issue
 * sweep's own branch/PR copy so every pre-#810 caller is unaffected.
 */
export function prepareSweepBase(boundary: LaunchBoundary, spec: SweepPersistSpec = PER_ISSUE_SWEEP_SPEC): SweepBase | null {
  try {
    const ctx = boundary.gitContext;
    const codeHost = boundary.providers.codeHost;
    const defaultBranch = codeHost.getDefaultBranch();

    try {
      ctx.removeWorktree(spec.branch);
    } catch {
      // best-effort pre-clean of a stale prior sweep worktree/branch — nothing to remove is expected
    }
    const worktreePath = ctx.createWorktreeForNewBranch(spec.branch, defaultBranch);

    return {
      ctx,
      codeHost,
      defaultBranch,
      sweepBranch: spec.branch,
      worktreePath,
      findOpenSweepPr: (branch) => {
        const pr = codeHost.findPullRequestByBranch(branch);
        return pr && pr.state.toUpperCase() === 'OPEN' ? pr.number : null;
      },
      openPr: (head, base) => codeHost.createPullRequest({ title: spec.prTitle, body: spec.prBody, sourceBranch: head, targetBranch: base }).number,
      mergePr: (prNumber) => codeHost.mergePullRequest(prNumber),
      log: coreLog,
    };
  } catch (err) {
    coreLog(`perIssueSweepPersist: prepareSweepBase failed: ${err} — sweep persistence disabled for this cycle`, 'warn');
    return null;
  }
}

/**
 * Persists one commit through the dedicated sweep branch: `commit(base)`
 * stages and commits (returning whether anything was actually staged), then
 * this pushes, opens a PR into the default branch, and immediately merges
 * it. Never throws — a push/PR/merge failure is logged at error and the
 * sweep recovers on the next cycle, since nothing lands on the shared base
 * until the PR merges. `label` prefixes every log line so a shared sweep
 * (e.g. the docs-index sweep) reads distinctly from the per-issue sweep's.
 */
export async function persistCommitViaPr(
  commit: (base: SweepBase) => boolean,
  base: SweepBase,
  label = 'perIssueSweepPersist',
): Promise<void> {
  const openPrNumber = base.findOpenSweepPr(base.sweepBranch);
  if (openPrNumber !== null) {
    base.log(`${label}: existing open sweep PR #${openPrNumber} — skipping to avoid duplicate`, 'info');
    return;
  }

  const committed = commit(base);
  if (!committed) return;

  try {
    base.ctx.pushBranch(base.sweepBranch, base.worktreePath);

    const prNumber = base.openPr(base.sweepBranch, base.defaultBranch);
    if (!prNumber) {
      base.log(`${label}: could not resolve PR number for sweep branch — retried next sweep`, 'error');
      return;
    }

    const merge = base.mergePr(prNumber);
    if (!merge.success) {
      base.log(`${label}: sweep PR #${prNumber} merge failed (left open, retried next sweep): ${merge.error}`, 'error');
      return;
    }

    base.log(`${label}: sweep PR #${prNumber} merged; changes landed on origin`, 'success');
  } catch (err) {
    base.log(`${label}: persistCommitViaPr failed: ${err} — retried next sweep (nothing committed to the base)`, 'error');
  }
}

/**
 * Persists a removal batch via `persistCommitViaPr`. Unchanged behaviour and
 * log-message prefix for every existing caller/test.
 */
export async function persistRemovalViaPr(paths: readonly string[], base: SweepBase): Promise<void> {
  if (paths.length === 0) return;
  return persistCommitViaPr((b) => b.ctx.removeAndCommitPaths(paths, SWEEP_COMMIT_MESSAGE, b.worktreePath), base);
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
