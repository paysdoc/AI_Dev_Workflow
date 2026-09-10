/**
 * Production dependency implementations for `runPromotionSweep` — the real
 * GitContext/provider-backed I/O that `promotionSweep.ts`'s deps default to
 * when no override is injected. Split out to keep `promotionSweep.ts`'s
 * orchestration logic under the file-length guideline.
 *
 * `makeDefaultDeps(boundary)` closes every helper over the single
 * launch-boundary passed in — git ops read from `boundary.gitContext`, forge
 * ops from `boundary.providers` — so this module performs no repo-identity
 * resolution of its own, and constructs zero additional GitContexts per call.
 *
 * `tagAndCommit` and `fileIssue` are deliberately allowed to throw (no
 * internal try/catch beyond the branch-guard no-op) — the shell's
 * per-candidate try/catch is what logs and swallows a transient git/gh
 * failure. Every other default is self-defending (degrades to an empty/null
 * fallback), mirroring `perIssueScenarioSweep.ts`.
 */

import * as fs from 'fs';
import * as path from 'path';
import { log, loadProjectConfig } from '../core';
import { ADW_REGRESSION_PROMOTION_LABEL } from '../core/adwLabels';
import { loadPromotionStats } from '../promotion';
import type { PromotionStats } from '../promotion';
import type { PromotionIssueRef } from '../core/promotionReconcileLink';
import type { PromotionIssueSpec } from '../core/promotionIssueBody';
import type { LaunchBoundary } from '../core';

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

export interface PromotionSweepDefaultDeps {
  listPerIssueFeatures: () => string[];
  readFeatureContent: (filePath: string) => string | null;
  listStepDefSiblings: (featureNumber: number) => string[];
  scenariosConfig: () => ScenariosPaths;
  loadVocabulary: (vocabPath: string) => string;
  loadStats: () => PromotionStats;
  listPromotionIssues: () => PromotionIssueRef[];
  tagAndCommit: (filePath: string, newContent: string, message: string) => void;
  fileIssue: (spec: PromotionIssueSpec) => void;
}

/**
 * Builds the nine production defaults for `runPromotionSweep`, each closing
 * over the single passed launch boundary — the cron's (or CLI's). Constructs
 * no additional GitContext and mints no additional providers.
 */
export function makeDefaultDeps(boundary: LaunchBoundary): PromotionSweepDefaultDeps {
  const ctx = boundary.gitContext;
  const { issueTracker, codeHost } = boundary.providers;
  return {
    listPerIssueFeatures: () => {
      try {
        return ctx.lsFiles(ctx.basePath, PER_ISSUE_DIR).filter(p => FEATURE_FILENAME_RE.test(path.basename(p)));
      } catch {
        return [];
      }
    },

    readFeatureContent: (filePath: string) => {
      try {
        return fs.readFileSync(path.join(ctx.basePath, filePath), 'utf-8');
      } catch {
        return null;
      }
    },

    listStepDefSiblings: (featureNumber: number) => {
      try {
        return ctx.lsFiles(ctx.basePath, STEP_DEF_DIR).filter(p => path.basename(p).startsWith(`feature-${featureNumber}.`));
      } catch {
        return [];
      }
    },

    scenariosConfig: (): ScenariosPaths => {
      try {
        const scenarios = loadProjectConfig(ctx.basePath).scenarios;
        return {
          perIssueDir: scenarios.perIssueScenarioDirectory ?? PER_ISSUE_DIR,
          regressionDir: scenarios.regressionScenarioDirectory ?? DEFAULT_REGRESSION_DIR,
          vocabPath: scenarios.vocabularyRegistry ?? DEFAULT_VOCAB_PATH,
        };
      } catch {
        return { perIssueDir: PER_ISSUE_DIR, regressionDir: DEFAULT_REGRESSION_DIR, vocabPath: DEFAULT_VOCAB_PATH };
      }
    },

    loadVocabulary: (vocabPath: string) => {
      try {
        return fs.readFileSync(path.join(ctx.basePath, vocabPath), 'utf-8');
      } catch {
        return '';
      }
    },

    loadStats: (): PromotionStats => {
      try {
        return loadPromotionStats({
          gitLogSince: opts => ctx.logSince(opts),
          now: () => new Date(),
          perIssueGlob: 'features/per-issue/**/*.feature',
        });
      } catch {
        return { promotedCount90d: 0, totalPerIssueCount90d: 0 };
      }
    },

    listPromotionIssues: (): PromotionIssueRef[] => {
      try {
        return issueTracker.listIssues({
          fields: ['number', 'body', 'state', 'labels'],
          state: 'all',
          search: `label:"${ADW_REGRESSION_PROMOTION_LABEL}"`,
          limit: 200,
        }) as PromotionIssueRef[];
      } catch {
        return [];
      }
    },

    /**
     * Writes the tagged content and commits it scoped to `filePath` (never
     * `git add -A`), pushing only when something was actually committed.
     * Only mutates when the checkout is on the default branch (a deliberate
     * no-op skip, not an error).
     */
    tagAndCommit: (filePath: string, newContent: string, message: string) => {
      const branch = codeHost.getDefaultBranch();
      if (ctx.getCurrentBranch(ctx.basePath) !== branch) {
        log(`promotionSweep: checkout is not on default branch "${branch}" — skipping persistence`, 'warn');
        return;
      }
      fs.writeFileSync(path.join(ctx.basePath, filePath), newContent);
      const committed = ctx.addAndCommitPaths([filePath], message, ctx.basePath);
      if (committed) ctx.pushBranch(branch, ctx.basePath);
    },

    /** Files the issue and applies every label. */
    fileIssue: (spec: PromotionIssueSpec) => {
      const issueNumber = issueTracker.createIssue(spec.title, spec.body);
      for (const label of spec.labels) {
        issueTracker.applyLabel(issueNumber, label);
      }
    },
  };
}
