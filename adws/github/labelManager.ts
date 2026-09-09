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
import type { RepoIdentifier } from '../providers/types';
import type { GitContext } from '../gitContext';
import { gitContextForRepo } from './gitContextFactory';
import { createGhRepoApi } from '../providers/github/ghRepoApi';
import { resolveAdwLabelDefinition, ADW_LABEL_DEFINITIONS } from '../core/adwLabels';

// ── ADW label vocabulary (pure) — moved to adws/core/adwLabels.ts (#820) ──────
export {
  ADW_NONE_LABEL,
  ADW_UPGRADE_LABEL,
  ADW_UNVERIFIED_LABEL,
  ADW_BLOCKED_LABEL,
  ADW_REGRESSION_PROMOTION_LABEL,
  hasRegressionPromotionLabel,
  ADW_CLASSIFICATION_LABELS,
  ADW_LABEL_DEFINITIONS,
  REGRESSION_PROMOTION_LABEL_DEFINITION,
  readAdwLabelNames,
  readAdwLabels,
  issueTypeToAdwLabel,
  shouldSkipScenarioAuthoring,
  resolveAdwLabelDefinition,
  type AdwLabelDefinition,
  type AdwLabelReading,
} from '../core/adwLabels';

// ── DI scaffolding ────────────────────────────────────────────────────────────

export interface LabelManagerDeps {
  readonly gitContextForRepo: (repoId: RepoIdentifier) => GitContext;
  readonly logger: (message: string, level?: LogLevel) => void;
}

export function buildDefaultLabelManagerDeps(): LabelManagerDeps {
  return { gitContextForRepo, logger: log };
}

// ── Private helpers ───────────────────────────────────────────────────────────

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
  repoInfo: RepoIdentifier,
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
  repoInfo: RepoIdentifier,
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
  repoInfo: RepoIdentifier,
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
  const def = resolveAdwLabelDefinition(label);
  gh.createLabel(def.name, def.color, def.description);
  gh.applyLabel(issueNumber, label);
}
