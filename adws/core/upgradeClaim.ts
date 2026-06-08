/**
 * upgradeClaim — atomic upgrade-claim primitive using the GitHub branch namespace.
 *
 * Uses GitHub's branch namespace as the only create-if-not-exists atomic primitive
 * visible to distributed, single-host-uncoordinated orchestrators:
 *
 * 1. Creates an empty commit with a unique nonce on branch `adw-upgrade-<hash>`
 *    and pushes it WITHOUT --force.
 * 2. Push success  → this orchestrator is the WINNER  → { won: true, branch }.
 * 3. Push rejected → this orchestrator is the LOSER   → { won: false, existingIssueNumber, existingBranch }.
 *
 * Nonce correctness: without a unique token in the claim commit, two orchestrators
 * with identical author/committer identity and the same wall-clock second produce
 * the SAME SHA; the second `git push` would be "everything up-to-date" (not rejected),
 * and both would believe they won. The nonce makes the second push a true
 * non-fast-forward rejection — exactly one winner guaranteed.
 *
 * All I/O is injected via UpgradeClaimDeps so the winner/loser decision logic is
 * unit-testable without network or filesystem access.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { defaultFindPRByBranch, fetchPRDetails, type RawPR } from '../github/prApi';
import type { RepoInfo } from '../github/githubApi';
import { log, type LogLevel } from './utils';
import { getDefaultBranch } from '../vcs/branchOperations';

// ── Types ─────────────────────────────────────────────────────────────────────

export type UpgradeClaimResult =
  | { readonly won: true; readonly branch: string }
  | { readonly won: false; readonly existingIssueNumber: number | null; readonly existingBranch: string };

export interface UpgradeClaimDeps {
  readonly pushClaimBranch: (branchName: string, hash: string, repoInfo: RepoInfo) => boolean;
  readonly findPRByBranch: (branchName: string, repoInfo: RepoInfo) => RawPR | null;
  readonly resolveIssueNumberFromPR: (prNumber: number, repoInfo: RepoInfo) => number | null;
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
  repoInfo: RepoInfo,
  deps?: UpgradeClaimDeps,
): Promise<UpgradeClaimResult> {
  const effectiveDeps = deps ?? buildDefaultUpgradeClaimDeps();
  const branch = buildClaimBranchName(hash);

  const pushed = effectiveDeps.pushClaimBranch(branch, hash, repoInfo);
  if (pushed) return { won: true, branch };

  const pr = effectiveDeps.findPRByBranch(branch, repoInfo);
  const existingIssueNumber = pr
    ? effectiveDeps.resolveIssueNumberFromPR(pr.number, repoInfo)
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

function cleanupClaimTempWorktree(cwd: string, tmpdir: string): void {
  try {
    execSync(`git worktree remove --force "${tmpdir}"`, { stdio: 'pipe', cwd });
  } catch {
    // best-effort
  }
  try {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

function defaultPushClaimBranch(
  branchName: string,
  hash: string,
  baseRepoPath: string,
): boolean {
  const defaultBranch = getDefaultBranch(baseRepoPath);
  execSync(`git fetch origin "${defaultBranch}"`, { stdio: 'pipe', cwd: baseRepoPath });

  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-claim-'));
  try {
    execSync(
      `git worktree add --detach "${tmpdir}" "origin/${defaultBranch}"`,
      { stdio: 'pipe', cwd: baseRepoPath },
    );
    execSync(`git checkout -b "${branchName}"`, { stdio: 'pipe', cwd: tmpdir });

    const nonce = Math.random().toString(36).slice(2, 10);
    execSync(
      `git commit --allow-empty -m "ADW upgrade in progress: ${hash} [${nonce}]"`,
      { stdio: 'pipe', cwd: tmpdir },
    );

    try {
      execSync(`git push origin "${branchName}"`, { stdio: 'pipe', cwd: tmpdir });
      return true;
    } catch (pushErr) {
      const buf = (pushErr as { stderr?: Buffer | string }).stderr;
      const msg = buf instanceof Buffer ? buf.toString() : (typeof buf === 'string' ? buf : String(pushErr));
      if (isRejectionError(msg)) return false;
      throw pushErr;
    }
  } finally {
    cleanupClaimTempWorktree(baseRepoPath, tmpdir);
  }
}

export function buildDefaultUpgradeClaimDeps(baseRepoPath: string = process.cwd()): UpgradeClaimDeps {
  return {
    pushClaimBranch: (branchName, hash) => defaultPushClaimBranch(branchName, hash, baseRepoPath),
    findPRByBranch: (branchName, repoInfo) => defaultFindPRByBranch(branchName, repoInfo),
    resolveIssueNumberFromPR: (prNumber, repoInfo) => {
      try {
        const details = fetchPRDetails(prNumber, repoInfo);
        const n = details.issueNumber;
        return typeof n === 'number' && n > 0 ? n : null;
      } catch {
        return null;
      }
    },
    log: (message, level) => log(message, level),
  };
}
