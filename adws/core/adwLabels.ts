import type { IssueClassSlashCommand } from '../types/issueTypes';
import type { Issue } from '@paysdoc/devplatform';

export const ADW_NONE_LABEL = 'adw:none';
export const ADW_UPGRADE_LABEL = 'adw:upgrade';
export const ADW_UNVERIFIED_LABEL = 'adw:unverified';
export const ADW_BLOCKED_LABEL = 'adw:blocked';

/**
 * Marks a promotion implementation issue: it skips scenario writing and is reviewed as a promotion.
 * Deliberately kept OUT of `ADW_CLASSIFICATION_LABELS` (must stay invisible to
 * `readAdwLabelNames` / `LABEL_TO_COMMAND` routing) and out of
 * `ADW_LABEL_DEFINITIONS` (keeps `ensureAdwLabelsExist` scoped to the six adw:*
 * labels its log message names).
 */
export const ADW_REGRESSION_PROMOTION_LABEL = 'regression-promotion';

/**
 * Detection keys off the *issue* label, not a PR-label fetch — a promotion implementation issue
 * carries `regression-promotion`, and that label is already on `config.issue.labels` with no extra I/O.
 */
export function hasRegressionPromotionLabel(labels: readonly string[]): boolean {
  return labels.includes(ADW_REGRESSION_PROMOTION_LABEL);
}

/**
 * Identifies a Promotion Proposal, which also carries `adw:none`. Kept out of `ADW_CLASSIFICATION_LABELS` and
 * `ADW_LABEL_DEFINITIONS` like `regression-promotion`: it never routes, and the forge creates it the first time it is applied.
 */
export const ADW_PROMOTION_PROPOSAL_LABEL = 'promotion-proposal';

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

export const PROMOTION_PROPOSAL_LABEL_DEFINITION: AdwLabelDefinition = {
  name: ADW_PROMOTION_PROPOSAL_LABEL,
  color: 'd4c5f9',
  description: 'Promotion Proposal: the owner decides it; ADW never works it',
};

export interface AdwLabelReading {
  optOut: boolean;
  classification: IssueClassSlashCommand | null;
  conflict: boolean;
}

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

export function shouldSkipScenarioAuthoring(labels: readonly string[]): boolean {
  return scenarioAuthoringSkipReason(labels) !== null;
}

/** Catalogue lookup with the `ededed`/"ADW label" fallback for a name outside the catalogue. */
export function resolveAdwLabelDefinition(label: string): AdwLabelDefinition {
  return [...ADW_LABEL_DEFINITIONS, REGRESSION_PROMOTION_LABEL_DEFINITION, PROMOTION_PROPOSAL_LABEL_DEFINITION].find(d => d.name === label)
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
