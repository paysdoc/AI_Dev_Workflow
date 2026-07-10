/**
 * Pure selection + DI orchestration for the `issues.closed` dependency-unblock path.
 *
 * Mirrors `issueOpenedRouter.ts`'s pure-decision + DI pattern. Selects dependents via
 * `extractDependencies` — the SAME extractor `findOpenDependencies` (detection/defer) uses —
 * instead of the narrow heading-only `parseDependencies`, so a dependent deferred at creation
 * via a prose `- blocked by #N` declaration is unblocked when its blocker closes (issue #753).
 */

import type { RepoInfo } from '../github/githubApi';
import type { GitContext } from '../gitContext';
import { log, LOGS_DIR } from '../core';
import type { LogLevel } from '../core';
import { extractDependencies } from './issueDependencies';
import { checkIssueEligibility } from './issueEligibility';
import type { EligibilityResult } from './issueEligibility';
import { classifyAndSpawnWorkflow } from './webhookGatekeeper';
import { gitContextForRepo } from '../github/gitContextFactory';

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
  checkEligibility: (issueNumber: number, issueBody: string, repoInfo: RepoInfo) => Promise<EligibilityResult>;
  spawn: (issueNumber: number, repoInfo: RepoInfo, targetRepoArgs: string[], gitContext?: GitContext) => Promise<void>;
  logger: (message: string, level?: LogLevel) => void;
}

export function buildDefaultDependencyUnblockDeps(repoInfo: RepoInfo, gitContext?: GitContext): DependencyUnblockDeps {
  const ctx = gitContext ?? gitContextForRepo(repoInfo);
  return {
    listOpenIssues: () => JSON.parse(ctx.listOpenIssues({ fields: ['number', 'body'], limit: 100 })) as OpenIssue[],
    extractDependents: (body, n) => extractDependencies(body, LOGS_DIR, undefined, undefined, n),
    checkEligibility: checkIssueEligibility,
    spawn: (n, r, a, gc) => classifyAndSpawnWorkflow(n, r, a, undefined, undefined, undefined, gc),
    logger: log,
  };
}

// ── Per-dependent re-evaluation (guard clause keeps the loop body flat) ────────

async function reEvaluateDependent(
  dependent: IssueWithDeps,
  closedIssueNumber: number,
  repoInfo: RepoInfo,
  targetRepoArgs: string[],
  gitContext: GitContext | undefined,
  deps: DependencyUnblockDeps,
): Promise<void> {
  const eligibility = await deps.checkEligibility(dependent.number, dependent.body, repoInfo);
  if (!eligibility.eligible) {
    deps.logger(`Issue #${dependent.number} still ineligible after #${closedIssueNumber} closed: ${eligibility.reason}`);
    return;
  }
  deps.logger(`Issue #${dependent.number} unblocked by closure of #${closedIssueNumber}, spawning workflow`);
  await deps.spawn(dependent.number, repoInfo, targetRepoArgs, gitContext);
}

// ── DI orchestration ──────────────────────────────────────────────────────────

/**
 * Handles the `issues.closed` event for dependency unblocking.
 * Finds open issues that depend on the closed issue and re-evaluates eligibility.
 */
export async function handleIssueClosedDependencyUnblock(
  closedIssueNumber: number,
  repoInfo: RepoInfo,
  targetRepoArgs: string[],
  gitContext?: GitContext,
  deps: DependencyUnblockDeps = buildDefaultDependencyUnblockDeps(repoInfo, gitContext),
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
      await reEvaluateDependent(dependent, closedIssueNumber, repoInfo, targetRepoArgs, gitContext, deps);
    }
  } catch (error) {
    deps.logger(`Error checking dependents of closed issue #${closedIssueNumber}: ${error}`, 'error');
  }
}
