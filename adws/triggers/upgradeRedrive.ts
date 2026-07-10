/**
 * upgradeRedrive — cron redrive scan for stranded framework-upgrade tracking issues.
 *
 * `adwUpgrade` is spawned exactly once per framework hash, by the claim winner in
 * `upgradeGate.ts`. The claim branch `adw-upgrade-<hash>` is created once and never
 * released on failure, so a workflow that fails after claiming (e.g. a step-6 commit
 * or push error) leaves the `#UPG` tracking issue permanently stranded — nothing ever
 * re-invokes `adwUpgrade` for it. The cron's standard candidate loop never routes
 * `#UPG` issues to `adwUpgrade` either: `adw:upgrade` is not an ADW classification
 * label, so it reads as `reserved_label` and is filtered out.
 *
 * This module adds an independent cron pass: a pure eligibility predicate
 * (`decideUpgradeRedrive`) plus a composing scanner (`findRedrivableUpgrades` /
 * `runUpgradeRedriveScan`) that re-spawns `adwUpgrade` for a stranded `#UPG`. The
 * predicate mirrors `adwUpgrade`'s own entry gate, idempotency guard, and spawn
 * lock, so this scan is a cheap pre-filter — `adwUpgrade` remains the correctness
 * authority. Bounding comes from the existing `MAX_FAILURES` cap: each re-spawn that
 * fails posts a counted failure comment (see adwUpgrade.tsx step 6), and once the cap
 * escalates (`adw:blocked` applied), this predicate's `terminal` guard stops the loop.
 *
 * All I/O is injected via UpgradeRedriveDeps for unit testing.
 */

import { readSpawnLockRecord } from './spawnGate';
import { isProcessLive } from '../core/processLiveness';
import { spawnDetached } from './webhookGatekeeper';
import { log, type LogLevel } from '../core';
import { defaultFindPRByBranch, type RawPR } from '../github/prApi';
import { ADW_UPGRADE_LABEL, ADW_BLOCKED_LABEL } from '../github/labelManager';
import type { RepoInfo } from '../github/githubApi';

// ── Pure claim-branch parser ──────────────────────────────────────────────────

/** Matches the `Claim branch: \`adw-upgrade-<hash>\`` line written by runUpgradeGate. */
const CLAIM_BRANCH_PATTERN = /claim branch:\s*`([^`]+)`/i;

/**
 * Extracts the claim branch name from a `#UPG` tracking-issue body.
 * Tolerant of case in the heading; returns null when absent or malformed
 * (e.g. empty backticks).
 */
export function parseClaimBranch(issueBody: string): string | null {
  const match = issueBody.match(CLAIM_BRANCH_PATTERN);
  if (!match) return null;
  const branch = match[1].trim();
  return branch.length > 0 ? branch : null;
}

// ── Pure redrive-eligibility decision ─────────────────────────────────────────

export interface UpgradeRedriveSignals {
  readonly isOpen: boolean;
  readonly hasUpgradeLabel: boolean;
  readonly isTerminalLabeled: boolean;
  readonly hasClaimPr: boolean;
  readonly spawnLockHeldByLiveProcess: boolean;
}

export interface UpgradeRedriveDecision {
  readonly redrive: boolean;
  readonly reason: string;
}

/**
 * Pure guard-clause decision: which `#UPG` issues are stranded and safe to redrive.
 * Order matters only for issues that would otherwise match multiple guards; each
 * clause returns eagerly so the first matching reason wins.
 */
export function decideUpgradeRedrive(signals: UpgradeRedriveSignals): UpgradeRedriveDecision {
  if (!signals.isOpen) return { redrive: false, reason: 'closed' };
  if (!signals.hasUpgradeLabel) return { redrive: false, reason: 'not_upgrade' };
  if (signals.isTerminalLabeled) return { redrive: false, reason: 'terminal' };
  if (signals.hasClaimPr) return { redrive: false, reason: 'pr_present' };
  if (signals.spawnLockHeldByLiveProcess) return { redrive: false, reason: 'live_lock' };
  return { redrive: true, reason: 'stranded' };
}

// ── Composing scanner ──────────────────────────────────────────────────────────

/** Minimal issue shape the redrive scan needs — structurally compatible with
 *  trigger_cron's RawIssue and cronIssueFilter's CronIssue. */
export interface UpgradeRedriveIssue {
  readonly number: number;
  readonly body?: string;
  readonly labels: readonly { readonly name: string }[];
}

/** Injectable dependencies for the redrive scan — enables unit testing without I/O. */
export interface UpgradeRedriveDeps {
  readonly findClaimPr: (issueBody: string) => RawPR | null;
  readonly readSpawnLock: (issueNumber: number) => { pid: number; pidStartedAt: string } | null;
  readonly isProcessLive: (pid: number, pidStartedAt: string) => boolean;
  readonly spawn: (upgNumber: number, targetRepoArgs: readonly string[]) => void;
  readonly log: (message: string, level?: LogLevel) => void;
}

function isSpawnLockHeldByLiveProcess(issueNumber: number, deps: UpgradeRedriveDeps): boolean {
  const lock = deps.readSpawnLock(issueNumber);
  if (lock === null) return false;
  if (!lock.pidStartedAt) return false;
  return deps.isProcessLive(lock.pid, lock.pidStartedAt);
}

function deriveSignals(issue: UpgradeRedriveIssue, deps: UpgradeRedriveDeps): UpgradeRedriveSignals {
  const labelNames = new Set(issue.labels.map((l) => l.name));
  return {
    // Only ever receives open issues (the cron fetches open issues only), so this
    // guard is defensive rather than load-bearing in production — kept so the
    // decision stays complete and unit-testable on its own.
    isOpen: true,
    hasUpgradeLabel: labelNames.has(ADW_UPGRADE_LABEL),
    isTerminalLabeled: labelNames.has(ADW_BLOCKED_LABEL),
    hasClaimPr: deps.findClaimPr(issue.body ?? '') !== null,
    spawnLockHeldByLiveProcess: isSpawnLockHeldByLiveProcess(issue.number, deps),
  };
}

/**
 * Evaluates every candidate issue and returns the `#UPG` numbers that are stranded
 * and safe to redrive (open, adw:upgrade, not terminal-labeled, no claim PR, spawn
 * lock free or stale).
 */
export function findRedrivableUpgrades(
  issues: readonly UpgradeRedriveIssue[],
  repoInfo: RepoInfo,
  deps: UpgradeRedriveDeps,
): number[] {
  const redrivable: number[] = [];
  for (const issue of issues) {
    const decision = decideUpgradeRedrive(deriveSignals(issue, deps));
    if (!decision.redrive) continue;
    deps.log(`upgradeRedrive: issue #${issue.number} (${repoInfo.owner}/${repoInfo.repo}) is stranded — redriving`, 'info');
    redrivable.push(issue.number);
  }
  return redrivable;
}

/**
 * Re-spawns `adwUpgrade` for every stranded `#UPG` found among `issues`. Safe to call
 * every cron tick — non-stranded issues (terminal, PR-present, live-locked, or not an
 * upgrade issue) are left untouched, and `adwUpgrade`'s own idempotency guard is the
 * correctness backstop if this pre-filter is ever wrong.
 */
export function runUpgradeRedriveScan(
  issues: readonly UpgradeRedriveIssue[],
  repoInfo: RepoInfo,
  targetRepoArgs: readonly string[],
  deps: UpgradeRedriveDeps = buildDefaultUpgradeRedriveDeps(repoInfo),
): void {
  const redrivable = findRedrivableUpgrades(issues, repoInfo, deps);
  for (const upgNumber of redrivable) {
    deps.spawn(upgNumber, targetRepoArgs);
  }
}

// ── Default deps factory ──────────────────────────────────────────────────────

export function buildDefaultUpgradeRedriveDeps(repoInfo: RepoInfo): UpgradeRedriveDeps {
  return {
    findClaimPr: (issueBody) => {
      const branch = parseClaimBranch(issueBody);
      return branch === null ? null : defaultFindPRByBranch(branch, repoInfo);
    },
    readSpawnLock: (issueNumber) => readSpawnLockRecord(repoInfo, issueNumber),
    isProcessLive,
    spawn: (upgNumber, targetRepoArgs) =>
      spawnDetached('bunx', ['tsx', 'adws/adwUpgrade.tsx', String(upgNumber), ...targetRepoArgs]),
    log,
  };
}
