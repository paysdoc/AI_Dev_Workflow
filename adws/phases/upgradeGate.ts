/**
 * upgradeGate — hash-check upgrade gate for initializeWorkflow().
 *
 * Compares the framework's current content hash against the target repo's stored
 * `.adw-version`. On mismatch, atomically elects a winner and either creates a
 * tracking issue + spawns adwUpgrade.tsx (winner) or attaches to the existing
 * upgrade (loser). On match, returns immediately with action: 'proceed'.
 *
 * All I/O is injected via UpgradeGateDeps for unit testing.
 */

import { computeFrameworkHash } from '../core/hashComputer';
import { readRemoteAdwVersion } from '../core/adwVersion';
import { claimUpgradeOrFindExisting, buildDefaultUpgradeClaimDeps } from '../core/upgradeClaim';
import { ADW_UPGRADE_LABEL } from '../github';
import { spawnDetached } from '../triggers/webhookGatekeeper';
import { BoardStatus, type BoundProviders } from '../providers/types';
import { log, type LogLevel } from '../core/utils';
import type { RepoInfo } from '../github/githubApi';
import type { UpgradeClaimResult } from '../core/upgradeClaim';
import type { GitContext } from '../gitContext';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UpgradeGateParams {
  issueNumber: number;
  issueBody: string;
  /** Main target repo clone root (not a feature worktree). Used for the remote version
   *  read and as the base path for the claim push. */
  worktreePath: string;
  /** Remote default branch name (e.g. "main", "dev"). Used to read
   *  `origin/<defaultBranch>:.adw-version` as the authoritative stored version. */
  defaultBranch: string;
  frameworkRepoRoot: string;
  repoInfo: RepoInfo;
  targetRepoArgs: string[];
}

export interface UpgradeGateDeps {
  computeFrameworkHash: (frameworkRepoRoot: string) => string;
  /** Reads the stored ADW version from the remote default branch, not from a local file.
   *  This is the authoritative read: stale local worktrees cannot affect the result. */
  readAdwVersion: (defaultBranch: string, workspacePath: string) => string | null;
  claimUpgrade: (hash: string, repoInfo: RepoInfo) => Promise<UpgradeClaimResult>;
  createIssue: (title: string, body: string) => number;
  applyLabel: (issueNumber: number, label: string) => void;
  updateIssueBody: (issueNumber: number, body: string) => void;
  findOpenUpgradeIssue: () => number | null;
  spawnUpgradeOrchestrator: (upgNumber: number, targetRepoArgs: string[]) => void;
  moveToStatus: (issueNumber: number, status: BoardStatus) => Promise<void>;
  log: (message: string, level?: LogLevel) => void;
}

export type UpgradeGateOutcome =
  | { action: 'proceed' }
  | { action: 'parked'; role: 'winner' | 'loser'; upgradeIssueNumber: number | null; branch: string };

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Returns true when the stored version differs from the current hash.
 * null (missing .adw-version) always triggers an upgrade — unifying first-bootstrap
 * and out-of-date into a single code path.
 */
export function shouldTriggerUpgrade(currentHash: string, storedVersion: string | null): boolean {
  return storedVersion !== currentHash;
}

/**
 * Idempotently inserts `- #<upgNumber>` into the issue body's dependency section.
 * Recognises ## Dependencies, ## Blocked by, ## Depends on headings (case-insensitive).
 * If the reference already appears, returns body unchanged.
 * If the section exists, appends the bullet to it; otherwise appends a new section.
 */
export function addDependencyToBody(body: string, upgNumber: number): string {
  const ref = `#${upgNumber}`;
  const headingPattern = /^## (?:dependencies|blocked by|depends on)\b/im;
  const existingHeadingMatch = body.match(headingPattern);

  if (existingHeadingMatch) {
    const headingIdx = existingHeadingMatch.index!;
    const afterHeading = headingIdx + existingHeadingMatch[0].length;
    const nextHeadingMatch = body.slice(afterHeading).match(/^## /m);
    const sectionEnd = nextHeadingMatch?.index !== undefined
      ? afterHeading + nextHeadingMatch.index
      : body.length;
    const section = body.slice(headingIdx, sectionEnd);
    if (section.includes(ref)) return body;
    const insert = `\n- ${ref}\n`;
    return body.slice(0, sectionEnd) + insert + body.slice(sectionEnd);
  }

  return `${body}\n\n## Blocked by\n\n- ${ref}\n`;
}

// ── Orchestration ─────────────────────────────────────────────────────────────

async function registerDependencyAndPark(
  params: UpgradeGateParams,
  deps: UpgradeGateDeps,
  upgNumber: number,
  role: 'winner' | 'loser',
  branch: string,
): Promise<UpgradeGateOutcome> {
  const newBody = addDependencyToBody(params.issueBody, upgNumber);
  if (newBody !== params.issueBody) {
    deps.updateIssueBody(params.issueNumber, newBody);
  }
  try {
    await deps.moveToStatus(params.issueNumber, BoardStatus.Todo);
  } catch {
    // best-effort — body dependency drives unblocking; board move is cosmetic
  }
  return { action: 'parked', role, upgradeIssueNumber: upgNumber, branch };
}

export async function runUpgradeGate(
  params: UpgradeGateParams,
  deps: UpgradeGateDeps,
): Promise<UpgradeGateOutcome> {
  const currentHash = deps.computeFrameworkHash(params.frameworkRepoRoot);
  const storedVersion = deps.readAdwVersion(params.defaultBranch, params.worktreePath);

  if (!shouldTriggerUpgrade(currentHash, storedVersion)) {
    deps.log('Upgrade gate: hash match, proceeding', 'info');
    return { action: 'proceed' };
  }

  deps.log(
    `Upgrade gate: hash mismatch — current=${currentHash}, stored=${storedVersion ?? 'null (never initialized)'}`,
    'info',
  );

  const claim = await deps.claimUpgrade(currentHash, params.repoInfo);

  if (claim.won) {
    const title = `ADW framework upgrade ${currentHash.slice(0, 12)}`;
    const body = [
      `Auto-generated upgrade tracking issue.`,
      `Claim branch: \`${claim.branch}\``,
      `Framework hash: \`${currentHash}\``,
    ].join('\n\n');
    const upgNumber = deps.createIssue(title, body);
    deps.applyLabel(upgNumber, ADW_UPGRADE_LABEL);
    deps.spawnUpgradeOrchestrator(upgNumber, params.targetRepoArgs);
    return registerDependencyAndPark(params, deps, upgNumber, 'winner', claim.branch);
  }

  // Loser path
  const upgNumber = claim.existingIssueNumber ?? deps.findOpenUpgradeIssue();
  if (upgNumber === null) {
    deps.log('Upgrade gate: lost claim but no #UPG issue found yet (race) — parking without body edit', 'warn');
    try {
      await deps.moveToStatus(params.issueNumber, BoardStatus.Todo);
    } catch {
      // best-effort
    }
    return { action: 'parked', role: 'loser', upgradeIssueNumber: null, branch: claim.existingBranch };
  }
  return registerDependencyAndPark(params, deps, upgNumber, 'loser', claim.existingBranch);
}

// ── Default deps factory ──────────────────────────────────────────────────────

export function buildDefaultUpgradeGateDeps(
  providers: BoundProviders,
  worktreePath: string,
  gitCtx: GitContext,
): UpgradeGateDeps {
  const gitShow = (ref: string, filePath: string, cwd: string) => gitCtx.show(ref, filePath, cwd);
  return {
    computeFrameworkHash,
    readAdwVersion: (defaultBranch, workspacePath) => readRemoteAdwVersion(gitShow, defaultBranch, workspacePath),
    // The atomic claim must run against the TARGET repo's branch namespace, not the
    // framework checkout. Pin baseRepoPath to the target worktree (whose `origin` is the
    // target remote) — otherwise it defaults to process.cwd() (the framework repo) and
    // pushes the claim branch to the framework's own GitHub, scoping the winner/loser
    // election globally across every target repo instead of per-target.
    claimUpgrade: (hash, repoInfo) =>
      claimUpgradeOrFindExisting(hash, repoInfo, buildDefaultUpgradeClaimDeps(worktreePath, gitCtx, () => providers.codeHost.getDefaultBranch())),
    createIssue: (title, body) => providers.issueTracker.createIssue(title, body),
    applyLabel: (issueNumber, label) => providers.issueTracker.applyLabel(issueNumber, label),
    updateIssueBody: (issueNumber, body) => providers.issueTracker.updateIssueBody(issueNumber, body),
    findOpenUpgradeIssue: () => providers.issueTracker.findOpenUpgradeIssue(),
    spawnUpgradeOrchestrator: (upgNumber, targetRepoArgs) =>
      spawnDetached('bunx', ['tsx', 'adws/adwUpgrade.tsx', String(upgNumber), ...targetRepoArgs]),
    moveToStatus: async (issueNumber, status) => {
      try {
        await providers.issueTracker.moveToStatus(issueNumber, status);
      } catch (e) {
        log(`Upgrade gate: moveToStatus best-effort failed: ${e}`, 'warn');
      }
    },
    log,
  };
}
