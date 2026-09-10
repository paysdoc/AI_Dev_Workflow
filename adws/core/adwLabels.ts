/**
 * The ADW label policy — pure constants and readers, no I/O. Moved out of
 * `adws/github/labelManager.ts` (#820); the gh-issuing half stays there
 * until #821.
 */

import type { IssueClassSlashCommand } from '../types/issueTypes';
import type { Issue } from '../providers/types';

// ── Canonical label data ──────────────────────────────────────────────────────

export const ADW_NONE_LABEL = 'adw:none';
export const ADW_UPGRADE_LABEL = 'adw:upgrade';
export const ADW_UNVERIFIED_LABEL = 'adw:unverified';
export const ADW_BLOCKED_LABEL = 'adw:blocked';

/**
 * Scenario promotion candidate marker — reconciliation key for the promotion
 * sweep (`Promotes: feature-N` linkage) and the scenario-authoring skip-flag.
 * Deliberately kept OUT of `ADW_CLASSIFICATION_LABELS` (must stay invisible to
 * `readAdwLabelNames` / `LABEL_TO_COMMAND` routing) and out of
 * `ADW_LABEL_DEFINITIONS` (keeps `ensureAdwLabelsExist` scoped to the six adw:*
 * labels its log message names).
 */
export const ADW_REGRESSION_PROMOTION_LABEL = 'regression-promotion';

/**
 * Gates the promotion-only rot/reuse advisory step (User Story 12/13). Detection keys
 * off the *issue* label, not a PR-label fetch — promotion issues carry
 * `regression-promotion` (`buildPromotionIssue`), and that label is already on
 * `config.issue.labels` with no extra I/O.
 */
export function hasRegressionPromotionLabel(labels: readonly string[]): boolean {
  return labels.includes(ADW_REGRESSION_PROMOTION_LABEL);
}

export const ADW_CLASSIFICATION_LABELS = {
  'adw:chore':     '/chore',
  'adw:bug':       '/bug',
  'adw:feature':   '/feature',
  'adw:pr_review': '/pr_review',
} as const satisfies Record<string, IssueClassSlashCommand>;

export interface AdwLabelDefinition {
  name: string;
  color: string;
  description: string;
}

export const ADW_LABEL_DEFINITIONS: readonly AdwLabelDefinition[] = [
  { name: 'adw:chore',     color: 'fbca04', description: 'ADW chore workflow' },
  { name: 'adw:bug',       color: 'd73a4a', description: 'ADW bug workflow' },
  { name: 'adw:feature',   color: '0e8a16', description: 'ADW feature workflow' },
  { name: 'adw:pr_review', color: '1d76db', description: 'ADW PR review workflow' },
  { name: 'adw:upgrade',     color: '5319e7', description: 'ADW upgrade tracking' },
  { name: 'adw:none',        color: 'e4e4e4', description: 'Opt out of ADW automation' },
  { name: 'adw:unverified',  color: 'fbca04', description: 'ADW could not verify tests' },
  { name: 'adw:blocked', color: 'b60205', description: 'ADW lane escalated to human (terminal)' },
] as const;

/** Definition for the promotion label — resolved via `resolveAdwLabelDefinition`, not part of `ADW_LABEL_DEFINITIONS`. */
export const REGRESSION_PROMOTION_LABEL_DEFINITION: AdwLabelDefinition = {
  name: ADW_REGRESSION_PROMOTION_LABEL,
  color: 'c5def5',
  description: 'Scenario promotion candidate (reconciliation key + authoring skip-flag)',
};

export interface AdwLabelReading {
  optOut: boolean;
  classification: IssueClassSlashCommand | null;
  conflict: boolean;
}

// ── Pure read-side ────────────────────────────────────────────────────────────

/**
 * Reads ADW classification state from a plain array of label name strings.
 * Pure function — no I/O, no logging.
 */
export function readAdwLabelNames(labelNames: readonly string[]): AdwLabelReading {
  const nameSet = new Set(labelNames);
  const optOut = nameSet.has(ADW_NONE_LABEL);
  const matched = Object.keys(ADW_CLASSIFICATION_LABELS).filter(l => nameSet.has(l));
  const conflict = matched.length > 1;
  const classification = matched.length === 1
    ? ADW_CLASSIFICATION_LABELS[matched[0] as keyof typeof ADW_CLASSIFICATION_LABELS]
    : null;
  return { optOut, classification, conflict };
}

/**
 * Reads an issue's labels and returns the structured ADW classification shape.
 * Pure function — no I/O, no logging.
 */
export function readAdwLabels(issue: Pick<Issue, 'labels'>): AdwLabelReading {
  return readAdwLabelNames(issue.labels);
}

/**
 * Returns the adw:* label name for a given issue type slash command,
 * or null when no classification label corresponds (e.g. /adw_init).
 */
export function issueTypeToAdwLabel(issueType: IssueClassSlashCommand): string | null {
  const entry = Object.entries(ADW_CLASSIFICATION_LABELS).find(([, cmd]) => cmd === issueType);
  return entry ? entry[0] : null;
}

/** The label that decided scenario authoring must be skipped. */
export type ScenarioAuthoringSkipReason = typeof ADW_REGRESSION_PROMOTION_LABEL | typeof ADW_NONE_LABEL;

/**
 * The label that makes scenario authoring skip for this issue, or null when authoring
 * runs. Two reasons, both pure reads of labels the caller already holds:
 *
 *   • `regression-promotion` — promotion issues relocate an EXISTING per-issue scenario
 *     into the regression suite; authoring a fresh feature-<promotionIssueN>.feature for
 *     them would redden the run and create a promotion-of-a-promotion candidate.
 *   • `adw:none` — the issue opted out of ADW automation. The triggers already refuse to
 *     start a run for it, so a phase only ever sees this label when the opt-out landed
 *     mid-run or an orchestrator was hand-launched; either way no authoring agent may be
 *     spent on an issue that asked ADW to stay out.
 *
 * Pure — no I/O, no logging, and (deliberately) no forge call: every caller already holds
 * the labels on `config.issue`.
 */
export function scenarioAuthoringSkipReason(
  labels: readonly string[],
): ScenarioAuthoringSkipReason | null {
  const names = new Set(labels);
  if (names.has(ADW_REGRESSION_PROMOTION_LABEL)) return ADW_REGRESSION_PROMOTION_LABEL;
  if (names.has(ADW_NONE_LABEL)) return ADW_NONE_LABEL;
  return null;
}

/** Boolean face of {@link scenarioAuthoringSkipReason} for callers that need no reason. */
export function shouldSkipScenarioAuthoring(labels: readonly string[]): boolean {
  return scenarioAuthoringSkipReason(labels) !== null;
}

/** Catalogue lookup with the `ededed`/"ADW label" fallback for a name outside the catalogue. */
export function resolveAdwLabelDefinition(label: string): AdwLabelDefinition {
  return [...ADW_LABEL_DEFINITIONS, REGRESSION_PROMOTION_LABEL_DEFINITION].find(d => d.name === label)
    ?? { name: label, color: 'ededed', description: 'ADW label' };
}

/**
 * True when `labels` carries a "won't fix" name (matched leniently: case- and
 * punctuation-insensitive, so `wontfix`, `Won't fix`, `wont-fix` all count).
 */
export function hasWontFixLabelName(labels: readonly string[]): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return labels.some((name) => norm(name) === 'wontfix');
}
