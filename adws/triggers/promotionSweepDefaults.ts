/**
 * Split out to keep `promotionSweep.ts`'s
 * orchestration logic under the file-length guideline.
 *
 * `makeDefaultDeps(boundary, getBase)` closes every helper over the single
 * launch boundary passed in and a lazily-memoised `SweepBase` (created by the
 * caller, at most once). Every default lists, reads, configures and scores
 * from that sweep worktree, synced to fresh `origin/<default>` — never from
 * `ctx.basePath`, so the cron host's own checkout (possibly stale, possibly on
 * another branch) is never read or written. Git ops read from
 * `boundary.gitContext`, forge ops from `boundary.providers`, and this module
 * performs no repo-identity resolution of its own.
 *
 * `persistMarkers` and `fileIssue` are deliberately allowed to throw — the
 * shell logs and swallows a transient git/gh failure. Every other default is
 * self-defending (degrades to an empty/null fallback), mirroring
 * `perIssueScenarioSweep.ts`.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { MergedPullRequestRecord } from '@paysdoc/devplatform';
import { log, loadProjectConfig } from '../core';
import { ADW_REGRESSION_PROMOTION_LABEL } from '../core/adwLabels';
import { bodyLinksIssue } from '../forge/issueLinkMarker';
import { loadPromotionStats } from '../promotion';
import type { PromotionStats } from '../promotion';
import type { PromotionIssueRef } from '../core/promotionReconcileLink';
import type { PromotionIssueSpec } from '../core/promotionIssueBody';
import type { LaunchBoundary } from '../core';
import { persistCommitViaPr } from './perIssueSweepPersist';
import type { SweepBase, SweepPersistSpec } from './perIssueSweepPersist';

export const FEATURE_FILENAME_RE = /^feature-(\d+)\.feature$/;

export const PROMOTION_SWEEP_SPEC: SweepPersistSpec = {
  branch: 'chore/promotion-sweep',
  prTitle: 'chore: promotion sweep — update promotion markers',
  prBody: 'Automated promotion markers: adds, declines or withdraws `@promotion-suggested-<date>` / `@promotion-declined` on per-issue scenario files found by the promotion sweep. One commit per file; details in the commit messages.',
};

const PER_ISSUE_DIR = 'features/per-issue';
const STEP_DEF_DIR = 'features/per-issue/step_definitions';
const DEFAULT_REGRESSION_DIR = 'features/regression/';
const DEFAULT_VOCAB_PATH = 'features/regression/vocabulary.md';
const MERGED_PR_SCAN_LIMIT = 200;

export interface ScenariosPaths {
  perIssueDir: string;
  regressionDir: string;
  vocabPath: string;
}

export interface MarkerWrite {
  filePath: string;
  content: string;
  message: string;
}

export interface PromotionSweepDefaultDeps {
  listPerIssueFeatures: () => string[];
  readFeatureContent: (filePath: string) => string | null;
  listStepDefSiblings: (featureNumber: number) => string[];
  scenariosConfig: () => ScenariosPaths;
  loadVocabulary: (vocabPath: string) => string;
  loadStats: () => PromotionStats;
  listPromotionIssues: () => PromotionIssueRef[];
  persistMarkers: (writes: readonly MarkerWrite[]) => Promise<boolean>;
  fileIssue: (spec: PromotionIssueSpec) => void;
}

function fallbackPaths(): ScenariosPaths {
  return { perIssueDir: PER_ISSUE_DIR, regressionDir: DEFAULT_REGRESSION_DIR, vocabPath: DEFAULT_VOCAB_PATH };
}

function isClosed(issue: PromotionIssueRef): boolean {
  return issue.state?.toUpperCase() === 'CLOSED';
}

/** `mergedPrs` is newest first, so the first linking pull request is the issue's latest merge. */
function promotionMergeDates(
  issues: readonly PromotionIssueRef[],
  mergedPrs: readonly MergedPullRequestRecord[],
): Date[] {
  return issues
    .filter(isClosed)
    .flatMap(issue => {
      const linked = mergedPrs.find(pr => pr.mergedAt && bodyLinksIssue(pr.body, issue.number));
      return linked?.mergedAt ? [new Date(linked.mergedAt)] : [];
    })
    .filter(mergedAt => !Number.isNaN(mergedAt.getTime()));
}

function commitMarkerWrite(base: SweepBase, { filePath, content, message }: MarkerWrite): boolean {
  fs.writeFileSync(path.join(base.worktreePath, filePath), content);
  return base.ctx.addAndCommitPaths([filePath], message, base.worktreePath);
}

/** One scoped commit per file, never `git add -A`; true when any write changed its file. */
function commitMarkerWrites(base: SweepBase, writes: readonly MarkerWrite[]): boolean {
  return writes.map(write => commitMarkerWrite(base, write)).includes(true);
}

export function makeDefaultDeps(boundary: LaunchBoundary, getBase: () => SweepBase | null): PromotionSweepDefaultDeps {
  const { issueTracker, codeHost } = boundary.providers;

  const trackedFiles = (prefix: string): string[] => {
    const base = getBase();
    if (!base) return [];
    try {
      return base.ctx.lsFiles(base.worktreePath, prefix);
    } catch {
      return [];
    }
  };

  const readFromWorktree = (relPath: string): string | null => {
    const base = getBase();
    if (!base) return null;
    try {
      return fs.readFileSync(path.join(base.worktreePath, relPath), 'utf-8');
    } catch {
      return null;
    }
  };

  const listPromotionIssues = (): PromotionIssueRef[] => {
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
  };

  return {
    listPerIssueFeatures: () => trackedFiles(PER_ISSUE_DIR).filter(p => FEATURE_FILENAME_RE.test(path.basename(p))),

    readFeatureContent: readFromWorktree,

    listStepDefSiblings: (featureNumber: number) =>
      trackedFiles(STEP_DEF_DIR).filter(p => path.basename(p).startsWith(`feature-${featureNumber}.`)),

    scenariosConfig: (): ScenariosPaths => {
      const base = getBase();
      if (!base) return fallbackPaths();
      try {
        const scenarios = loadProjectConfig(base.worktreePath).scenarios;
        return {
          perIssueDir: scenarios.perIssueScenarioDirectory ?? PER_ISSUE_DIR,
          regressionDir: scenarios.regressionScenarioDirectory ?? DEFAULT_REGRESSION_DIR,
          vocabPath: scenarios.vocabularyRegistry ?? DEFAULT_VOCAB_PATH,
        };
      } catch {
        return fallbackPaths();
      }
    },

    loadVocabulary: (vocabPath: string) => readFromWorktree(vocabPath) ?? '',

    loadStats: (): PromotionStats => {
      const base = getBase();
      if (!base) return { promotedCount90d: 0, totalPerIssueCount90d: 0 };
      try {
        return loadPromotionStats({
          gitLogSince: opts => base.ctx.logSince(opts, base.worktreePath),
          listPromotionMergeDates: () =>
            promotionMergeDates(listPromotionIssues(), codeHost.listMergedPullRequests(MERGED_PR_SCAN_LIMIT)),
          now: () => new Date(),
          perIssueDir: PER_ISSUE_DIR,
          log,
        });
      } catch {
        return { promotedCount90d: 0, totalPerIssueCount90d: 0 };
      }
    },

    listPromotionIssues,

    persistMarkers: async (writes: readonly MarkerWrite[]): Promise<boolean> => {
      const base = getBase();
      if (!base) return false;
      return persistCommitViaPr(b => commitMarkerWrites(b, writes), base, 'promotionSweep');
    },

    fileIssue: (spec: PromotionIssueSpec) => {
      const issueNumber = issueTracker.createIssue(spec.title, spec.body);
      for (const label of spec.labels) {
        issueTracker.applyLabel(issueNumber, label);
      }
    },
  };
}
