/**
 * labelManager — owns the lifecycle of the six adw:* labels on every target
 * repo and exposes a pure read-side that interprets the labels present on an
 * issue.
 *
 * All I/O is injected via LabelManagerDeps so every code path is unit-testable
 * without touching the real GitHub API. Production callers omit the deps
 * parameter; tests inject vi.fn() stubs.
 */

import { execWithRetry, log, type LogLevel } from '../core';
import type { RepoInfo } from './githubApi';
import type { GitHubIssue, GitHubLabel, IssueClassSlashCommand } from '../types/issueTypes';
import type { ExecSyncOptions } from 'child_process';

// ── Canonical label data ──────────────────────────────────────────────────────

export const ADW_NONE_LABEL = 'adw:none';

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
  { name: 'adw:upgrade',   color: '5319e7', description: 'ADW upgrade tracking' },
  { name: 'adw:none',      color: 'e4e4e4', description: 'Opt out of ADW automation' },
] as const;

export interface AdwLabelReading {
  optOut: boolean;
  classification: IssueClassSlashCommand | null;
  conflict: boolean;
}

// ── Pure read-side ────────────────────────────────────────────────────────────

/**
 * Reads an issue's labels and returns the structured ADW classification shape.
 * Pure function — no I/O, no logging.
 */
export function readAdwLabels(issue: Pick<GitHubIssue, 'labels'>): AdwLabelReading {
  const labelNames = new Set(issue.labels.map((l: GitHubLabel) => l.name));
  const optOut = labelNames.has(ADW_NONE_LABEL);
  const matched = Object.keys(ADW_CLASSIFICATION_LABELS).filter(l => labelNames.has(l));
  const conflict = matched.length > 1;
  const classification = matched.length === 1
    ? ADW_CLASSIFICATION_LABELS[matched[0] as keyof typeof ADW_CLASSIFICATION_LABELS]
    : null;
  return { optOut, classification, conflict };
}

/**
 * Returns the adw:* label name for a given issue type slash command,
 * or null when no classification label corresponds (e.g. /adw_init).
 */
export function issueTypeToAdwLabel(issueType: IssueClassSlashCommand): string | null {
  const entry = Object.entries(ADW_CLASSIFICATION_LABELS).find(([, cmd]) => cmd === issueType);
  return entry ? entry[0] : null;
}

// ── DI scaffolding ────────────────────────────────────────────────────────────

export interface LabelManagerDeps {
  readonly exec: (command: string, options?: ExecSyncOptions & { maxAttempts?: number }) => string;
  readonly logger: (message: string, level?: LogLevel) => void;
}

export function buildDefaultLabelManagerDeps(): LabelManagerDeps {
  return { exec: execWithRetry, logger: log };
}

// ── Private helpers ───────────────────────────────────────────────────────────

function createLabel(def: AdwLabelDefinition, repoInfo: RepoInfo, deps: LabelManagerDeps): void {
  const { owner, repo } = repoInfo;
  deps.exec(
    `gh label create '${def.name}' --repo ${owner}/${repo} --color ${def.color} --description '${def.description}' --force`,
  );
}

function resolveLabelDefinition(label: string): AdwLabelDefinition {
  return ADW_LABEL_DEFINITIONS.find(d => d.name === label)
    ?? { name: label, color: 'ededed', description: 'ADW label' };
}

function addLabelToIssue(
  issueNumber: number,
  label: string,
  repoInfo: RepoInfo,
  deps: LabelManagerDeps,
): void {
  const { owner, repo } = repoInfo;
  deps.exec(
    `gh issue edit ${issueNumber} --repo ${owner}/${repo} --add-label '${label}'`,
    { stdio: ['pipe', 'pipe', 'pipe'], maxAttempts: 1 },
  );
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
  let succeeded = 0;
  for (const def of ADW_LABEL_DEFINITIONS) {
    try {
      createLabel(def, repoInfo, deps);
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
  try {
    addLabelToIssue(issueNumber, label, repoInfo, deps);
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
  createLabel(resolveLabelDefinition(label), repoInfo, deps);
  addLabelToIssue(issueNumber, label, repoInfo, deps);
}
