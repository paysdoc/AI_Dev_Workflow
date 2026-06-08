/**
 * Pure routing decision + DI orchestration for the `issues.opened` label-routing path.
 *
 * Mirrors the `cronIssueFilter.ts` "testable logic extracted from a trigger" pattern:
 * pure functions carry the decision logic; a DI wrapper owns the side effects.
 */

import type { RepoInfo } from '../github/githubApi';
import type { IssueClassSlashCommand } from '../types/issueTypes';
import type { AdwLabelReading } from '../github/labelManager';
import type { EligibilityResult } from './issueEligibility';
import { readAdwLabelNames } from '../github/labelManager';
import { checkIssueEligibility } from './issueEligibility';
import { commentOnIssue } from '../github/issueApi';
import { classifyAndSpawnWorkflow } from './webhookGatekeeper';
import { log } from '../core';
import type { LogLevel } from '../core';
import { logDeferral } from './webhookGatekeeper';

// ── Route type ────────────────────────────────────────────────────────────────

export type IssueOpenedRoute =
  | { kind: 'opt_out' }
  | { kind: 'conflict' }
  | { kind: 'classified'; classification: IssueClassSlashCommand }
  | { kind: 'infer' };

// ── Outcome type ──────────────────────────────────────────────────────────────

export type IssueOpenedOutcome = {
  status: 'opted_out' | 'refused_multi_label' | 'deferred' | 'spawned_classified' | 'spawned_inferred';
  reason?: string;
};

// ── Refusal comment ───────────────────────────────────────────────────────────

export const MULTI_LABEL_REFUSAL_COMMENT =
  '**Multiple conflicting ADW labels detected — please clean up before ADW can process this issue.**\n\n' +
  'This issue has more than one `adw:<type>` label (e.g. `adw:bug`, `adw:feature`, `adw:chore`, `adw:pr_review`). ' +
  'ADW cannot determine which workflow to run when multiple classification labels are present.\n\n' +
  'Please remove all but one `adw:` classification label. Once only one `adw:<type>` label remains, ' +
  'the CRON recovery layer will pick this issue up automatically.';

// ── Pure decision ─────────────────────────────────────────────────────────────

/**
 * Pure routing decision from a label reading. opt-out takes unconditional precedence.
 */
export function decideIssueOpenedRoute(reading: AdwLabelReading): IssueOpenedRoute {
  if (reading.optOut) return { kind: 'opt_out' };
  if (reading.conflict) return { kind: 'conflict' };
  if (reading.classification !== null) return { kind: 'classified', classification: reading.classification };
  return { kind: 'infer' };
}

// ── Defensive payload extraction ──────────────────────────────────────────────

/**
 * Defensively extracts label name strings from the raw webhook issue object.
 * Accepts only array entries that are objects with a string `name`.
 */
export function extractPayloadLabelNames(issue: Record<string, unknown> | undefined): string[] {
  const labels = issue?.labels;
  if (!Array.isArray(labels)) return [];
  const names: string[] = [];
  for (const entry of labels) {
    if (entry !== null && typeof entry === 'object' && typeof (entry as Record<string, unknown>).name === 'string') {
      names.push((entry as Record<string, unknown>).name as string);
    }
  }
  return names;
}

// ── DI interface ──────────────────────────────────────────────────────────────

export interface IssueOpenedRouterDeps {
  checkEligibility: (issueNumber: number, issueBody: string, repoInfo: RepoInfo) => Promise<EligibilityResult>;
  classifyAndSpawn: (
    issueNumber: number,
    repoInfo: RepoInfo | undefined,
    targetRepoArgs: string[],
    labelRouting?: { precomputedClassification?: IssueClassSlashCommand; issueTitle?: string; persistInferredLabel?: boolean },
  ) => Promise<void>;
  postComment: (issueNumber: number, body: string, repoInfo: RepoInfo) => void;
  logger: (message: string, level?: LogLevel) => void;
}

export function buildDefaultIssueOpenedRouterDeps(): IssueOpenedRouterDeps {
  return {
    checkEligibility: checkIssueEligibility,
    classifyAndSpawn: (n, r, a, lr) => classifyAndSpawnWorkflow(n, r, a, undefined, undefined, lr),
    postComment: commentOnIssue,
    logger: log,
  };
}

// ── DI orchestration ──────────────────────────────────────────────────────────

export async function routeIssueOpened(
  params: {
    issueNumber: number;
    issueBody: string;
    issueTitle?: string;
    labelNames: string[];
    repoInfo: RepoInfo;
    targetRepoArgs: string[];
  },
  deps: IssueOpenedRouterDeps = buildDefaultIssueOpenedRouterDeps(),
): Promise<IssueOpenedOutcome> {
  const { issueNumber, issueBody, issueTitle, labelNames, repoInfo, targetRepoArgs } = params;
  const route = decideIssueOpenedRoute(readAdwLabelNames(labelNames));

  if (route.kind === 'opt_out') {
    deps.logger(`Issue #${issueNumber}: opted out via adw:none`);
    return { status: 'opted_out' };
  }

  if (route.kind === 'conflict') {
    deps.postComment(issueNumber, MULTI_LABEL_REFUSAL_COMMENT, repoInfo);
    deps.logger(`Issue #${issueNumber}: refused — multiple adw:<type> labels; posted cleanup comment`);
    return { status: 'refused_multi_label' };
  }

  const eligibility = await deps.checkEligibility(issueNumber, issueBody, repoInfo);
  if (!eligibility.eligible) {
    logDeferral(issueNumber, eligibility);
    return { status: 'deferred', reason: eligibility.reason };
  }

  if (route.kind === 'classified') {
    await deps.classifyAndSpawn(issueNumber, repoInfo, targetRepoArgs, {
      precomputedClassification: route.classification,
      issueTitle,
    });
    return { status: 'spawned_classified' };
  }

  // route.kind === 'infer'
  await deps.classifyAndSpawn(issueNumber, repoInfo, targetRepoArgs, { persistInferredLabel: true });
  return { status: 'spawned_inferred' };
}
