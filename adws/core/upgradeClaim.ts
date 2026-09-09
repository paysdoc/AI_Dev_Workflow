/**
 * upgradeClaim — atomic upgrade-claim primitive using the GitHub branch namespace.
 *
 * Uses GitHub's branch namespace as the only create-if-not-exists atomic primitive
 * visible to distributed, single-host-uncoordinated orchestrators:
 *
 * 1. Creates an empty commit with a unique nonce on branch `adw-upgrade-<hash>`
 *    and pushes it WITHOUT --force (via GitContext).
 * 2. Push success  → this orchestrator is the WINNER  → { won: true, branch }.
 * 3. Push rejected → this orchestrator is the LOSER   → { won: false, existingIssueNumber, existingBranch }.
 *
 * Nonce correctness: without a unique token in the claim commit, two orchestrators
 * with identical author/committer identity and the same wall-clock second produce
 * the SAME SHA; the second `git push` would be "everything up-to-date" (not rejected),
 * and both would believe they won. The nonce makes the second push a true
 * non-fast-forward rejection — exactly one winner guaranteed.
 *
 * All git ops (fetch, worktree add, commit, push, worktree remove) route through
 * GitContext — inheriting per-command token injection, git-identity injection, and
 * explicit cwd. All I/O is injected via UpgradeClaimDeps so the winner/loser
 * decision logic is unit-testable without network or filesystem access.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { CodeHost, PullRequestSummary } from '../providers/types';
import { log, type LogLevel } from './utils';
import type { GitContext } from '../gitContext';

// ── Types ─────────────────────────────────────────────────────────────────────

export type UpgradeClaimResult =
  | { readonly won: true; readonly branch: string }
  | { readonly won: false; readonly existingIssueNumber: number | null; readonly existingBranch: string };

export interface UpgradeClaimDeps {
  readonly pushClaimBranch: (branchName: string, hash: string) => boolean;
  readonly findPRByBranch: (branchName: string) => PullRequestSummary | null;
  readonly resolveIssueNumberFromPR: (prNumber: number) => number | null;
  readonly log: (message: string, level?: LogLevel) => void;
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

export function buildClaimBranchName(hash: string): string {
  if (!hash || !hash.trim()) {
    throw new Error(`upgradeClaim: hash must be a non-empty string (got "${hash}")`);
  }
  return `adw-upgrade-${hash}`;
}

export function buildClaimResult(
  pushed: boolean,
  branch: string,
  resolvedIssueNumber: number | null,
): UpgradeClaimResult {
  if (pushed) return { won: true, branch };
  return { won: false, existingIssueNumber: resolvedIssueNumber, existingBranch: branch };
}

// ── Orchestration function ────────────────────────────────────────────────────

export async function claimUpgradeOrFindExisting(
  hash: string,
  deps: UpgradeClaimDeps,
): Promise<UpgradeClaimResult> {
  const branch = buildClaimBranchName(hash);

  const pushed = deps.pushClaimBranch(branch, hash);
  if (pushed) return { won: true, branch };

  const pr = deps.findPRByBranch(branch);
  const existingIssueNumber = pr
    ? deps.resolveIssueNumberFromPR(pr.number)
    : null;
  return { won: false, existingIssueNumber, existingBranch: branch };
}

// ── Default implementation ────────────────────────────────────────────────────

const REJECTION_PATTERNS = [
  'rejected',
  'non-fast-forward',
  'failed to push some refs',
  'already exists',
  '[rejected]',
];

function isRejectionError(stderr: string): boolean {
  const lower = stderr.toLowerCase();
  return REJECTION_PATTERNS.some((pat) => lower.includes(pat));
}

/**
 * Extracts the human-readable git error text from an unknown thrown value.
 * execSync rejections carry the useful text on `.stderr` (a Buffer); fall back to
 * String(err) for anything else. Shared by the claim-push loser detection and any
 * caller (e.g. adwUpgrade's regen-push) that must distinguish a non-fast-forward
 * "someone else owns this branch" rejection from a genuine git failure.
 */
export function extractGitErrorText(err: unknown): string {
  const buf = (err as { stderr?: Buffer | string }).stderr;
  if (buf instanceof Buffer) return buf.toString();
  if (typeof buf === 'string') return buf;
  return String(err);
}

/**
 * True when a thrown git error is a non-fast-forward / branch-already-exists
 * rejection — i.e. the remote ref moved out from under us and a non-force push
 * was refused. Callers treat this as "another orchestrator owns this branch"
 * rather than a crash, and must NOT respond by force-pushing.
 */
export function isPushRejectionError(err: unknown): boolean {
  return isRejectionError(extractGitErrorText(err));
}

function cleanupClaimTempWorktree(ctx: GitContext, baseRepoPath: string, tmpdir: string): void {
  ctx.removeDetachedWorktree(tmpdir, baseRepoPath);
  try {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

/**
 * Exported (and `getDefaultBranchFn`-injectable) so integration tests can exercise the
 * REAL push logic against a sandbox bare repo, rather than hand-copying it — the copy is
 * exactly what let the original `git checkout -b` + process.cwd() bugs survive the suite.
 */
export function defaultPushClaimBranch(
  branchName: string,
  hash: string,
  baseRepoPath: string,
  ctx: GitContext,
  getDefaultBranchFn: () => string,
): boolean {
  const defaultBranch = getDefaultBranchFn();
  ctx.fetchRemote(defaultBranch, baseRepoPath);

  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-claim-'));
  try {
    // Detached worktree at origin/<default>. We deliberately do NOT create a local
    // branch: a named `git checkout -b <branchName>` is not idempotent and a leftover
    // local branch from a prior attempt (cleanup removes the worktree, not the branch)
    // makes the next run crash with "branch already exists" — a hard throw that escapes
    // the push try/catch below and bypasses the loser path entirely. Committing in
    // detached HEAD and pushing HEAD to the remote namespace keeps the remote push as
    // the single atomic gate and leaves no local branch to leak.
    ctx.addDetachedWorktree(tmpdir, `origin/${defaultBranch}`, baseRepoPath);

    const nonce = Math.random().toString(36).slice(2, 10);
    ctx.commitAllowEmpty(`ADW upgrade in progress: ${hash} [${nonce}]`, tmpdir);

    try {
      ctx.pushHeadToBranch(branchName, tmpdir);
      return true;
    } catch (pushErr) {
      if (isPushRejectionError(pushErr)) return false;
      throw pushErr;
    }
  } finally {
    cleanupClaimTempWorktree(ctx, baseRepoPath, tmpdir);
  }
}

export function buildDefaultUpgradeClaimDeps(
  baseRepoPath: string,
  ctx: GitContext,
  codeHost: Pick<CodeHost, 'getDefaultBranch' | 'findPullRequestByBranch' | 'fetchPullRequest'>,
): UpgradeClaimDeps {
  return {
    pushClaimBranch: (branchName, hash) => defaultPushClaimBranch(branchName, hash, baseRepoPath, ctx, () => codeHost.getDefaultBranch()),
    findPRByBranch: (branchName) => codeHost.findPullRequestByBranch(branchName),
    resolveIssueNumberFromPR: (prNumber) => {
      try {
        const linked = codeHost.fetchPullRequest(prNumber).linkedIssueNumber;
        return typeof linked === 'number' && linked > 0 ? linked : null;
      } catch {
        return null;
      }
    },
    log: (message, level) => log(message, level),
  };
}
