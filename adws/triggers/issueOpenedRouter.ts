/**
 * Pure routing decision + DI orchestration for the `issues.opened` label-routing path.
 *
 * Mirrors the `cronIssueFilter.ts` "testable logic extracted from a trigger" pattern:
 * pure functions carry the decision logic; a DI wrapper owns the side effects.
 */

import type { IssueClassSlashCommand } from '../types/issueTypes';
import type { AdwLabelReading } from '../core/adwLabels';
import type { EligibilityResult } from './issueEligibility';
import type { LaunchBoundary } from '../core';
import { readAdwLabelNames } from '../core/adwLabels';
import { checkIssueEligibility } from './issueEligibility';
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
  checkEligibility: (issueNumber: number, issueBody: string) => Promise<EligibilityResult>;
  classifyAndSpawn: (
    issueNumber: number,
    targetRepoArgs: string[],
    labelRouting?: { precomputedClassification?: IssueClassSlashCommand; issueTitle?: string; persistInferredLabel?: boolean },
  ) => Promise<void>;
  postComment: (issueNumber: number, body: string) => void;
  logger: (message: string, level?: LogLevel) => void;
}

export function buildDefaultIssueOpenedRouterDeps(boundary: LaunchBoundary): IssueOpenedRouterDeps {
  return {
    checkEligibility: (n, body) => checkIssueEligibility(n, body, boundary.providers),
    classifyAndSpawn: (n, args, lr) => classifyAndSpawnWorkflow(n, boundary, args, undefined, undefined, lr),
    postComment: (n, body) => boundary.providers.issueTracker.commentOnIssue(n, body),
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
    boundary: LaunchBoundary;
    targetRepoArgs: string[];
  },
  deps: IssueOpenedRouterDeps = buildDefaultIssueOpenedRouterDeps(params.boundary),
): Promise<IssueOpenedOutcome> {
  const { issueNumber, issueBody, issueTitle, labelNames, targetRepoArgs } = params;
  const route = decideIssueOpenedRoute(readAdwLabelNames(labelNames));

  if (route.kind === 'opt_out') {
    deps.logger(`Issue #${issueNumber}: opted out via adw:none`);
    return { status: 'opted_out' };
  }

  if (route.kind === 'conflict') {
    deps.postComment(issueNumber, MULTI_LABEL_REFUSAL_COMMENT);
    deps.logger(`Issue #${issueNumber}: refused — multiple adw:<type> labels; posted cleanup comment`);
    return { status: 'refused_multi_label' };
  }

  const eligibility = await deps.checkEligibility(issueNumber, issueBody);
  if (!eligibility.eligible) {
    logDeferral(issueNumber, eligibility);
    return { status: 'deferred', reason: eligibility.reason };
  }

  if (route.kind === 'classified') {
    await deps.classifyAndSpawn(issueNumber, targetRepoArgs, {
      precomputedClassification: route.classification,
      issueTitle,
    });
    return { status: 'spawned_classified' };
  }

  // route.kind === 'infer'
  await deps.classifyAndSpawn(issueNumber, targetRepoArgs, { persistInferredLabel: true });
  return { status: 'spawned_inferred' };
}
