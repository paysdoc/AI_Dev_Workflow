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
import { readAdwVersion } from '../core/adwVersion';
import { claimUpgradeOrFindExisting } from '../core/upgradeClaim';
import {
  createIssue,
  updateIssueBody,
  findOpenUpgradeIssue,
  applyLabel,
  ADW_UPGRADE_LABEL,
} from '../github';
import { spawnDetached } from '../triggers/webhookGatekeeper';
import { createRepoContext } from '../providers/repoContext';
import { BoardStatus, type RepoIdentifier } from '../providers/types';
import { log, type LogLevel } from '../core/utils';
import type { RepoInfo } from '../github/githubApi';
import type { UpgradeClaimResult } from '../core/upgradeClaim';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UpgradeGateParams {
  issueNumber: number;
  issueBody: string;
  worktreePath: string;
  frameworkRepoRoot: string;
  repoInfo: RepoInfo;
  targetRepoArgs: string[];
}

export interface UpgradeGateDeps {
  computeFrameworkHash: (frameworkRepoRoot: string) => string;
  readAdwVersion: (worktreePath: string) => string | null;
  claimUpgrade: (hash: string, repoInfo: RepoInfo) => Promise<UpgradeClaimResult>;
  createIssue: (title: string, body: string, repoInfo: RepoInfo) => number;
  applyLabel: (issueNumber: number, label: string, repoInfo: RepoInfo) => void;
  updateIssueBody: (issueNumber: number, body: string, repoInfo: RepoInfo) => void;
  findOpenUpgradeIssue: (repoInfo: RepoInfo) => number | null;
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
    const insert = `\n- ${ref}`;
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
    deps.updateIssueBody(params.issueNumber, newBody, params.repoInfo);
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
  const storedVersion = deps.readAdwVersion(params.worktreePath);

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
    const upgNumber = deps.createIssue(title, body, params.repoInfo);
    deps.applyLabel(upgNumber, ADW_UPGRADE_LABEL, params.repoInfo);
    deps.spawnUpgradeOrchestrator(upgNumber, params.targetRepoArgs);
    return registerDependencyAndPark(params, deps, upgNumber, 'winner', claim.branch);
  }

  // Loser path
  const upgNumber = claim.existingIssueNumber ?? deps.findOpenUpgradeIssue(params.repoInfo);
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
  repoId: RepoIdentifier,
  worktreePath: string,
): UpgradeGateDeps {
  return {
    computeFrameworkHash,
    readAdwVersion,
    claimUpgrade: (hash, repoInfo) => claimUpgradeOrFindExisting(hash, repoInfo),
    createIssue,
    applyLabel,
    updateIssueBody,
    findOpenUpgradeIssue,
    spawnUpgradeOrchestrator: (upgNumber, targetRepoArgs) =>
      spawnDetached('bunx', ['tsx', 'adws/adwUpgrade.tsx', String(upgNumber), ...targetRepoArgs]),
    moveToStatus: async (issueNumber, status) => {
      try {
        const rc = createRepoContext({ repoId, cwd: worktreePath });
        await rc.issueTracker.moveToStatus(issueNumber, status);
      } catch (e) {
        log(`Upgrade gate: moveToStatus best-effort failed: ${e}`, 'warn');
      }
    },
    log,
  };
}
