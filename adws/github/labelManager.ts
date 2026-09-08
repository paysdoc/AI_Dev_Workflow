/**
 * labelManager — owns the lifecycle of the six adw:* labels on every target
 * repo and exposes a pure read-side that interprets the labels present on an
 * issue.
 *
 * All I/O is injected via LabelManagerDeps so every code path is unit-testable
 * without touching the real GitHub API. Production callers omit the deps
 * parameter; tests inject vi.fn() stubs.
 */

import { log, type LogLevel } from '../core';
import type { RepoInfo } from './githubApi';
import type { GitHubIssue, GitHubLabel, IssueClassSlashCommand } from '../types/issueTypes';
import type { GitContext } from '../gitContext';
import { gitContextForRepo } from './gitContextFactory';
import { createGhRepoApi } from '../providers/github/ghRepoApi';

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
export function hasRegressionPromotionLabel(labels: readonly { name: string }[]): boolean {
  return labels.some(l => l.name === ADW_REGRESSION_PROMOTION_LABEL);
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

/** Definition for the promotion label — resolved via `resolveLabelDefinition`, not part of `ADW_LABEL_DEFINITIONS`. */
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
export function readAdwLabels(issue: Pick<GitHubIssue, 'labels'>): AdwLabelReading {
  return readAdwLabelNames(issue.labels.map((l: GitHubLabel) => l.name));
}

/**
 * Returns the adw:* label name for a given issue type slash command,
 * or null when no classification label corresponds (e.g. /adw_init).
 */
export function issueTypeToAdwLabel(issueType: IssueClassSlashCommand): string | null {
  const entry = Object.entries(ADW_CLASSIFICATION_LABELS).find(([, cmd]) => cmd === issueType);
  return entry ? entry[0] : null;
}

/**
 * True when scenario authoring must be skipped for this issue — i.e. the issue
 * carries the `regression-promotion` label. Promotion issues relocate an existing
 * per-issue scenario into the regression suite; authoring a fresh
 * feature-<promotionIssueN>.feature for them would redden the run and create a
 * promotion-of-a-promotion candidate. Pure — no I/O, no logging.
 */
export function shouldSkipScenarioAuthoring(labels: readonly GitHubLabel[]): boolean {
  return labels.some((l) => l.name === ADW_REGRESSION_PROMOTION_LABEL);
}

// ── DI scaffolding ────────────────────────────────────────────────────────────

export interface LabelManagerDeps {
  readonly gitContextForRepo: (repoInfo: RepoInfo) => GitContext;
  readonly logger: (message: string, level?: LogLevel) => void;
}

export function buildDefaultLabelManagerDeps(): LabelManagerDeps {
  return { gitContextForRepo, logger: log };
}

// ── Private helpers ───────────────────────────────────────────────────────────

function resolveLabelDefinition(label: string): AdwLabelDefinition {
  return [...ADW_LABEL_DEFINITIONS, REGRESSION_PROMOTION_LABEL_DEFINITION].find(d => d.name === label)
    ?? { name: label, color: 'ededed', description: 'ADW label' };
}

function isLabelNotFoundError(error: unknown): boolean {
  return /not found/i.test(String(error));
}

// ── Public I/O operations ─────────────────────────────────────────────────────

/**
 * Idempotently ensures all six adw:* labels exist on the target repo.
 * Uses --force so a repeat run never errors on an already-existing label.
 * A single label's failure does not abort provisioning of the rest.
 */
export function ensureAdwLabelsExist(
  repoInfo: RepoInfo,
  deps: LabelManagerDeps = buildDefaultLabelManagerDeps(),
): void {
  const gh = createGhRepoApi(deps.gitContextForRepo(repoInfo));
  let succeeded = 0;
  for (const def of ADW_LABEL_DEFINITIONS) {
    try {
      gh.createLabel(def.name, def.color, def.description);
      succeeded++;
    } catch (error) {
      deps.logger(`ensureAdwLabelsExist: failed to create label "${def.name}": ${error}`, 'warn');
    }
  }
  deps.logger(
    `ensureAdwLabelsExist: ensured ${succeeded}/${ADW_LABEL_DEFINITIONS.length} adw:* labels on ${repoInfo.owner}/${repoInfo.repo}`,
    'info',
  );
}

/**
 * Idempotently creates/updates a label definition (`gh label create --force`).
 */
export function ensureLabelExists(
  name: string,
  color: string,
  description: string,
  repoInfo: RepoInfo,
  deps: LabelManagerDeps = buildDefaultLabelManagerDeps(),
): void {
  createGhRepoApi(deps.gitContextForRepo(repoInfo)).createLabel(name, color, description);
}

/**
 * Adds a label to an issue. If the label is missing from the repo (not found
 * error), lazy-creates it and retries once. Non-"not found" errors are
 * rethrown without creating a label.
 */
export function applyLabel(
  issueNumber: number,
  label: string,
  repoInfo: RepoInfo,
  deps: LabelManagerDeps = buildDefaultLabelManagerDeps(),
): void {
  const gh = createGhRepoApi(deps.gitContextForRepo(repoInfo));
  try {
    gh.applyLabel(issueNumber, label);
    return;
  } catch (error) {
    if (!isLabelNotFoundError(error)) {
      deps.logger(
        `applyLabel: unexpected error adding label "${label}" to issue #${issueNumber}: ${error}`,
        'error',
      );
      throw error;
    }
  }
  deps.logger(`applyLabel: label "${label}" not found on repo, lazy-creating`, 'warn');
  const def = resolveLabelDefinition(label);
  gh.createLabel(def.name, def.color, def.description);
  gh.applyLabel(issueNumber, label);
}
