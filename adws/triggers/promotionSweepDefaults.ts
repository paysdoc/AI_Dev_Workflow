/**
 * Production dependency implementations for `runPromotionSweep` — the real
 * GitContext/fs-backed I/O that `promotionSweep.ts`'s deps default to when no
 * override is injected. Split out to keep `promotionSweep.ts`'s orchestration
 * logic under the file-length guideline.
 *
 * `defaultTagAndCommit` and `defaultFileIssue` are deliberately allowed to
 * throw (no internal try/catch beyond the branch-guard no-op) — the shell's
 * per-candidate try/catch is what logs and swallows a transient git/gh
 * failure. Every other default is self-defending (degrades to an empty/null
 * fallback), mirroring `perIssueScenarioSweep.ts`.
 */

import * as fs from 'fs';
import * as path from 'path';
import { log, loadProjectConfig } from '../core';
import { getRepoInfo, applyLabel } from '../github';
import { gitContextForRepo } from '../github/gitContextFactory';
import { ADW_REGRESSION_PROMOTION_LABEL } from '../github/labelManager';
import { loadPromotionStats } from '../promotion';
import type { PromotionStats } from '../promotion';
import type { PromotionIssueRef } from '../core/promotionReconcileLink';
import type { PromotionIssueSpec } from '../core/promotionIssueBody';

export const FEATURE_FILENAME_RE = /^feature-(\d+)\.feature$/;

const PER_ISSUE_DIR = 'features/per-issue';
const STEP_DEF_DIR = 'features/per-issue/step_definitions';
const DEFAULT_REGRESSION_DIR = 'features/regression/';
const DEFAULT_VOCAB_PATH = 'features/regression/vocabulary.md';

export interface ScenariosPaths {
  perIssueDir: string;
  regressionDir: string;
  vocabPath: string;
}

export function defaultListPerIssueFeatures(): string[] {
  try {
    const ctx = gitContextForRepo(getRepoInfo());
    return ctx.lsFiles(ctx.basePath, PER_ISSUE_DIR).filter(p => FEATURE_FILENAME_RE.test(path.basename(p)));
  } catch {
    return [];
  }
}

export function defaultReadFeatureContent(filePath: string): string | null {
  try {
    const ctx = gitContextForRepo(getRepoInfo());
    return fs.readFileSync(path.join(ctx.basePath, filePath), 'utf-8');
  } catch {
    return null;
  }
}

export function defaultListStepDefSiblings(featureNumber: number): string[] {
  try {
    const ctx = gitContextForRepo(getRepoInfo());
    return ctx.lsFiles(ctx.basePath, STEP_DEF_DIR).filter(p => path.basename(p).startsWith(`feature-${featureNumber}.`));
  } catch {
    return [];
  }
}

export function defaultScenariosConfig(): ScenariosPaths {
  try {
    const ctx = gitContextForRepo(getRepoInfo());
    const scenarios = loadProjectConfig(ctx.basePath).scenarios;
    return {
      perIssueDir: scenarios.perIssueScenarioDirectory ?? PER_ISSUE_DIR,
      regressionDir: scenarios.regressionScenarioDirectory ?? DEFAULT_REGRESSION_DIR,
      vocabPath: scenarios.vocabularyRegistry ?? DEFAULT_VOCAB_PATH,
    };
  } catch {
    return { perIssueDir: PER_ISSUE_DIR, regressionDir: DEFAULT_REGRESSION_DIR, vocabPath: DEFAULT_VOCAB_PATH };
  }
}

export function defaultLoadVocabulary(vocabPath: string): string {
  try {
    const ctx = gitContextForRepo(getRepoInfo());
    return fs.readFileSync(path.join(ctx.basePath, vocabPath), 'utf-8');
  } catch {
    return '';
  }
}

export function defaultLoadStats(): PromotionStats {
  try {
    const ctx = gitContextForRepo(getRepoInfo());
    return loadPromotionStats({
      gitLogSince: opts => ctx.logSince(opts),
      now: () => new Date(),
      perIssueGlob: 'features/per-issue/**/*.feature',
    });
  } catch {
    return { promotedCount90d: 0, totalPerIssueCount90d: 0 };
  }
}

export function defaultListPromotionIssues(): PromotionIssueRef[] {
  try {
    const ctx = gitContextForRepo(getRepoInfo());
    const json = ctx.listOpenIssues({
      fields: ['number', 'body', 'state', 'labels'],
      state: 'all',
      search: `label:"${ADW_REGRESSION_PROMOTION_LABEL}"`,
      limit: 200,
    });
    return JSON.parse(json) as PromotionIssueRef[];
  } catch {
    return [];
  }
}

/**
 * Writes the tagged content and commits it scoped to `filePath` (never
 * `git add -A`), pushing only when something was actually committed. Only
 * mutates when the checkout is on the default branch (a deliberate no-op
 * skip, not an error).
 */
export function defaultTagAndCommit(filePath: string, newContent: string, message: string): void {
  const ctx = gitContextForRepo(getRepoInfo());
  const branch = ctx.defaultBranch();
  if (ctx.getCurrentBranch(ctx.basePath) !== branch) {
    log(`promotionSweep: checkout is not on default branch "${branch}" — skipping persistence`, 'warn');
    return;
  }
  fs.writeFileSync(path.join(ctx.basePath, filePath), newContent);
  const committed = ctx.addAndCommitPaths([filePath], message, ctx.basePath);
  if (committed) ctx.pushBranch(branch, ctx.basePath);
}

function extractIssueNumber(url: string): number {
  const match = url.trim().match(/\/issues\/(\d+)$/);
  if (!match) throw new Error(`promotionSweep: could not parse issue number from gh output: "${url.trim()}"`);
  return parseInt(match[1], 10);
}

/** Files the issue and applies every label. */
export function defaultFileIssue(spec: PromotionIssueSpec): void {
  const repoInfo = getRepoInfo();
  const ctx = gitContextForRepo(repoInfo);
  const issueNumber = extractIssueNumber(ctx.createIssue(spec.title, spec.body));
  for (const label of spec.labels) {
    applyLabel(issueNumber, label, repoInfo);
  }
}
