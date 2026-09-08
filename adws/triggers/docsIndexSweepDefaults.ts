/**
 * Production dependency implementations for `runDocsIndexSweep` — the real
 * worktree/git/forge-backed I/O that `docsIndexSweep.ts`'s deps default to
 * when no override is injected. Split out to keep `docsIndexSweep.ts`'s
 * orchestration logic under the file-length guideline, mirroring
 * `promotionSweepDefaults.ts`.
 *
 * `makeDocsIndexSweepDefaults(boundary, getBase)` closes every helper over
 * the single launch boundary passed in and a lazily-memoised `SweepBase`
 * (created by the caller, at most once) — every default reads from the
 * sweep worktree, never from `ctx.basePath` or `process.cwd()`, and no
 * additional `GitContext` or providers are constructed here.
 */

import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_COUNT_BAND, type CountBand, type DocsIndexRepair } from '../core/docsIndexHealth';
import { formatRepair } from '../core/docsIndexHealth';
import type { DocsIndexReportIssueRef, DocsIndexReportIssueSpec } from '../core/docsIndexReportBody';
import { persistCommitViaPr, type SweepBase, type SweepPersistSpec } from './perIssueSweepPersist';
import type { LaunchBoundary } from '../core';

/** Dedicated sweep branch + PR copy — distinct from the per-issue sweep's `chore/scenario-sweep`. */
export const DOCS_INDEX_SWEEP_SPEC: SweepPersistSpec = {
  branch: 'chore/docs-index-sweep',
  prTitle: 'chore: docs-index sweep — repair .adw/conditional_docs.md',
  prBody: 'Automated repair: dropped dangling entries and pruned dead Owns: globs found by the docs-index health sweep. Details in the commit message.',
};

export const DOCS_INDEX_SWEEP_COMMIT_MESSAGE = 'chore: repair conditional_docs index (drop dangling entries, prune dead globs)';

export const INDEX_PATH = '.adw/conditional_docs.md';

const REPORT_LABEL_SEARCH = 'label:"hitl"';
const CLOSE_REPORT_COMMENT = 'Docs index is healthy again — closed by the docs-index sweep.';

export interface DocsIndexSweepDefaultDeps {
  readIndex: () => string | null;
  listFiles: () => string[];
  persistIndex: (content: string, repairs: readonly DocsIndexRepair[]) => Promise<void>;
  listReportCandidates: () => DocsIndexReportIssueRef[];
  fileReport: (spec: DocsIndexReportIssueSpec) => number;
  refreshReport: (issueNumber: number, body: string) => void;
  closeReport: (issueNumber: number) => Promise<void>;
  countBand: CountBand | null;
}

function commitMessageWith(repairs: readonly DocsIndexRepair[]): string {
  return [DOCS_INDEX_SWEEP_COMMIT_MESSAGE, '', ...repairs.map((r) => `- ${formatRepair(r)}`)].join('\n');
}

/**
 * Builds the seven production defaults for `runDocsIndexSweep`, each closing
 * over the launch boundary and the lazily-prepared `SweepBase` (via
 * `getBase()`, called at most once by the caller). `countBand` is
 * ADW-calibrated and applies only to the self-host (framework) repo — a
 * freshly initialised target repo's entry count is never policed.
 */
export function makeDocsIndexSweepDefaults(
  boundary: LaunchBoundary,
  getBase: () => SweepBase | null,
): DocsIndexSweepDefaultDeps {
  const { issueTracker } = boundary.providers;

  return {
    readIndex: () => {
      const base = getBase();
      if (!base) return null;
      try {
        return fs.readFileSync(path.join(base.worktreePath, INDEX_PATH), 'utf-8');
      } catch {
        return null;
      }
    },

    listFiles: () => {
      const base = getBase();
      if (!base) return [];
      try {
        return base.ctx.lsFiles(base.worktreePath);
      } catch {
        return [];
      }
    },

    persistIndex: (content: string, repairs: readonly DocsIndexRepair[]) => {
      const base = getBase();
      if (!base) return Promise.resolve();
      fs.writeFileSync(path.join(base.worktreePath, INDEX_PATH), content);
      return persistCommitViaPr(
        (b) => b.ctx.addAndCommitPaths([INDEX_PATH], commitMessageWith(repairs), b.worktreePath),
        base,
        'docsIndexSweep',
      );
    },

    listReportCandidates: (): DocsIndexReportIssueRef[] => {
      try {
        const entries = issueTracker.listIssues({
          fields: ['number', 'body', 'state'],
          state: 'open',
          search: REPORT_LABEL_SEARCH,
          limit: 100,
        });
        return entries.map((e) => ({ number: e.number, body: e.body ?? '', state: e.state }));
      } catch {
        return [];
      }
    },

    fileReport: (spec: DocsIndexReportIssueSpec): number => {
      const issueNumber = issueTracker.createIssue(spec.title, spec.body);
      for (const label of spec.labels) issueTracker.applyLabel(issueNumber, label);
      return issueNumber;
    },

    refreshReport: (issueNumber: number, body: string): void => {
      issueTracker.updateIssueBody(issueNumber, body);
    },

    closeReport: async (issueNumber: number): Promise<void> => {
      await issueTracker.closeIssue(issueNumber, CLOSE_REPORT_COMMENT);
    },

    countBand: boundary.gitContext.selfHost ? DEFAULT_COUNT_BAND : null,
  };
}
