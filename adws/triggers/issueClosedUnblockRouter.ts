/**
 * Pure selection + DI orchestration for the `issues.closed` dependency-unblock path.
 *
 * Mirrors `issueOpenedRouter.ts`'s pure-decision + DI pattern. Selects dependents via
 * `extractDependencies` — the SAME extractor `findOpenDependencies` (detection/defer) uses —
 * instead of the narrow heading-only `parseDependencies`, so a dependent deferred at creation
 * via a prose `- blocked by #N` declaration is unblocked when its blocker closes (issue #753).
 */

import type { LaunchBoundary } from '../core';
import { log, LOGS_DIR } from '../core';
import type { LogLevel } from '../core';
import { extractDependencies } from './issueDependencies';
import { checkIssueEligibility } from './issueEligibility';
import type { EligibilityResult } from './issueEligibility';
import { classifyAndSpawnWorkflow } from './webhookGatekeeper';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OpenIssue {
  number: number;
  body: string;
}

export interface IssueWithDeps {
  number: number;
  body: string;
  deps: number[];
}

// ── Pure decision ─────────────────────────────────────────────────────────────

/** Pure mirror of decideIssueOpenedRoute: which extracted issues name the closed issue. */
export function selectDependents(issues: IssueWithDeps[], closedIssueNumber: number): IssueWithDeps[] {
  return issues.filter((i) => i.deps.includes(closedIssueNumber));
}

// ── DI interface ──────────────────────────────────────────────────────────────

export interface DependencyUnblockDeps {
  listOpenIssues: () => OpenIssue[];
  extractDependents: (issueBody: string, issueNumber: number) => Promise<number[]>;
  checkEligibility: (issueNumber: number, issueBody: string) => Promise<EligibilityResult>;
  spawn: (issueNumber: number, targetRepoArgs: string[]) => Promise<void>;
  logger: (message: string, level?: LogLevel) => void;
}

export function buildDefaultDependencyUnblockDeps(boundary: LaunchBoundary): DependencyUnblockDeps {
  return {
    listOpenIssues: () => boundary.providers.issueTracker.listIssues({ fields: ['number', 'body'], limit: 100 }) as OpenIssue[],
    extractDependents: (body, n) => extractDependencies(body, LOGS_DIR, undefined, undefined, n),
    checkEligibility: (n, body) => checkIssueEligibility(n, body, boundary.providers),
    spawn: (n, args) => classifyAndSpawnWorkflow(n, boundary, args),
    logger: log,
  };
}

// ── Per-dependent re-evaluation (guard clause keeps the loop body flat) ────────

async function reEvaluateDependent(
  dependent: IssueWithDeps,
  closedIssueNumber: number,
  targetRepoArgs: string[],
  deps: DependencyUnblockDeps,
): Promise<void> {
  const eligibility = await deps.checkEligibility(dependent.number, dependent.body);
  if (!eligibility.eligible) {
    deps.logger(`Issue #${dependent.number} still ineligible after #${closedIssueNumber} closed: ${eligibility.reason}`);
    return;
  }
  deps.logger(`Issue #${dependent.number} unblocked by closure of #${closedIssueNumber}, spawning workflow`);
  await deps.spawn(dependent.number, targetRepoArgs);
}

// ── DI orchestration ──────────────────────────────────────────────────────────

/**
 * Handles the `issues.closed` event for dependency unblocking.
 * Finds open issues that depend on the closed issue and re-evaluates eligibility.
 */
export async function handleIssueClosedDependencyUnblock(
  closedIssueNumber: number,
  boundary: LaunchBoundary,
  targetRepoArgs: string[],
  deps: DependencyUnblockDeps = buildDefaultDependencyUnblockDeps(boundary),
): Promise<void> {
  try {
    const issues = deps.listOpenIssues();
    const withDeps: IssueWithDeps[] = [];
    for (const issue of issues) {
      const d = await deps.extractDependents(issue.body || '', issue.number);
      withDeps.push({ number: issue.number, body: issue.body || '', deps: d });
    }

    const dependents = selectDependents(withDeps, closedIssueNumber);
    if (dependents.length === 0) {
      deps.logger(`No issues depend on closed issue #${closedIssueNumber}`);
      return;
    }

    deps.logger(`Found ${dependents.length} issue(s) depending on closed issue #${closedIssueNumber}`);
    for (const dependent of dependents) {
      await reEvaluateDependent(dependent, closedIssueNumber, targetRepoArgs, deps);
    }
  } catch (error) {
    deps.logger(`Error checking dependents of closed issue #${closedIssueNumber}: ${error}`, 'error');
  }
}
