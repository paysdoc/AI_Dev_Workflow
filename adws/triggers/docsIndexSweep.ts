/**
 * Docs-index sweep — full repair + reconcile lifecycle, cron-dispatched via
 * `runDocsIndexSweepTick` (see `trigger_cron.ts`) on the
 * `DOCS_INDEX_SWEEP_INTERVAL_CYCLES` cadence.
 *
 * Reads `.adw/conditional_docs.md` and lists tracked files from a dedicated
 * worktree synced to fresh `origin/<default>` (`perIssueSweepPersist.ts`'s
 * `prepareSweepBase`, generalised via `SweepPersistSpec`), assesses index
 * health with the shared `assessDocsIndexHealth` (the same pure module the
 * CI gate uses), and:
 *
 *  - **repairs** (dangling entries, dead `Owns:` globs) — persists the
 *    repaired index through an immediately-merged pull request
 *    (`persistCommitViaPr`), never a direct commit;
 *  - **violations** (overlap, orphan doc, duplicate, non-canonical, count
 *    out of band) — reconciles into exactly one open `hitl` + `adw:none`
 *    issue via a `Reconciles: docs-index-health` back-link marker plus a
 *    violation-set fingerprint, refreshed only when the fingerprint changes,
 *    closed when the index goes clean. Violations are NEVER auto-repaired.
 *
 * Mirrors `perIssueScenarioSweep.ts` / `promotionSweep.ts`: injectable deps
 * with production defaults closing over the caller's launch-boundary
 * GitContext (`docsIndexSweepDefaults.ts`'s `makeDocsIndexSweepDefaults`),
 * and non-fatal — every I/O step is wrapped so the sweep always returns its
 * report and never throws. This module performs no repo-identity resolution
 * of its own; it acts on the repo of the passed `boundary`.
 *
 * Invoke by hand: `bunx tsx adws/triggers/docsIndexSweep.ts [--target-repo owner/repo]`.
 */

import { log, type LogLevel, buildLaunchBoundary, parseTargetRepoArgs } from '../core';
import type { LaunchBoundary } from '../core';
import { assessDocsIndexHealth, formatRepair, type CountBand, type DocsIndexRepair, type DocsIndexViolation } from '../core/docsIndexHealth';
import {
  buildDocsIndexReportIssue,
  docsIndexViolationFingerprint,
  findOpenDocsIndexReport,
  parseDocsIndexReportMarker,
  type DocsIndexReportIssueRef,
  type DocsIndexReportIssueSpec,
} from '../core/docsIndexReportBody';
import { serializeConditionalDocs } from '../core/conditionalDocsRegistry';
import { prepareSweepBase, cleanupSweepBase, type SweepBase } from './perIssueSweepPersist';
import { makeDocsIndexSweepDefaults, DOCS_INDEX_SWEEP_SPEC, INDEX_PATH } from './docsIndexSweepDefaults';

export interface DocsIndexSweepDeps {
  boundary: LaunchBoundary;
  readIndex?: () => string | null;
  listFiles?: () => string[];
  persistIndex?: (content: string, repairs: readonly DocsIndexRepair[]) => Promise<void>;
  listReportCandidates?: () => DocsIndexReportIssueRef[];
  fileReport?: (spec: DocsIndexReportIssueSpec) => number;
  refreshReport?: (issueNumber: number, body: string) => void;
  closeReport?: (issueNumber: number) => Promise<void> | void;
  countBand?: CountBand | null;
  log?: (msg: string, level?: LogLevel) => void;
}

export type DocsIndexSweepReportAction = 'filed' | 'refreshed' | 'closed' | 'unchanged' | 'none';

export interface DocsIndexSweepReport {
  repairs: readonly DocsIndexRepair[];
  violations: readonly DocsIndexViolation[];
  persisted: boolean;
  reportIssue: number | null;
  reportAction: DocsIndexSweepReportAction;
}

const EMPTY_REPORT: DocsIndexSweepReport = { repairs: [], violations: [], persisted: false, reportIssue: null, reportAction: 'none' };

function safeDefaultBranch(boundary: LaunchBoundary): string {
  try {
    return boundary.providers.codeHost.getDefaultBranch();
  } catch {
    return 'main';
  }
}

interface ReconcileArgs {
  violations: readonly DocsIndexViolation[];
  listReportCandidates: () => DocsIndexReportIssueRef[];
  fileReport: (spec: DocsIndexReportIssueSpec) => number;
  refreshReport: (issueNumber: number, body: string) => void;
  closeReport: (issueNumber: number) => Promise<void> | void;
  boundary: LaunchBoundary;
  logger: (msg: string, level?: LogLevel) => void;
}

/** Reconciles the violation set into at most one open report issue. Never throws. */
async function reconcileReport(args: ReconcileArgs): Promise<{ reportIssue: number | null; reportAction: DocsIndexSweepReportAction }> {
  let candidates: DocsIndexReportIssueRef[];
  try {
    candidates = args.listReportCandidates();
  } catch (err) {
    args.logger(`docsIndexSweep: listReportCandidates failed (non-fatal): ${err}`, 'warn');
    candidates = [];
  }
  const openReport = findOpenDocsIndexReport(candidates);

  if (args.violations.length === 0) return closeIfOpen(openReport, args);

  const spec = buildDocsIndexReportIssue({ violations: args.violations, indexPath: INDEX_PATH, defaultBranch: safeDefaultBranch(args.boundary) });
  if (!openReport) return fileNew(spec, args);

  const currentFingerprint = parseDocsIndexReportMarker(openReport.body)?.fingerprint;
  const newFingerprint = docsIndexViolationFingerprint(args.violations);
  if (currentFingerprint === newFingerprint) return { reportIssue: openReport.number, reportAction: 'unchanged' };

  try {
    args.refreshReport(openReport.number, spec.body);
    args.logger(`docsIndexSweep: refreshed docs-index health issue #${openReport.number} (violation set changed)`, 'info');
    return { reportIssue: openReport.number, reportAction: 'refreshed' };
  } catch (err) {
    args.logger(`docsIndexSweep: refreshReport failed for #${openReport.number} (non-fatal): ${err}`, 'warn');
    return { reportIssue: openReport.number, reportAction: 'none' };
  }
}

async function closeIfOpen(
  openReport: DocsIndexReportIssueRef | null,
  args: ReconcileArgs,
): Promise<{ reportIssue: number | null; reportAction: DocsIndexSweepReportAction }> {
  if (!openReport) return { reportIssue: null, reportAction: 'none' };
  try {
    await args.closeReport(openReport.number);
    args.logger(`docsIndexSweep: closed docs-index health issue #${openReport.number} — index is clean`, 'info');
    return { reportIssue: openReport.number, reportAction: 'closed' };
  } catch (err) {
    args.logger(`docsIndexSweep: closeReport failed for #${openReport.number} (non-fatal): ${err}`, 'warn');
    return { reportIssue: openReport.number, reportAction: 'none' };
  }
}

function fileNew(spec: DocsIndexReportIssueSpec, args: ReconcileArgs): { reportIssue: number | null; reportAction: DocsIndexSweepReportAction } {
  try {
    const issueNumber = args.fileReport(spec);
    args.logger(`docsIndexSweep: filed docs-index health issue #${issueNumber} (${args.violations.length} violation(s))`, 'info');
    return { reportIssue: issueNumber, reportAction: 'filed' };
  } catch (err) {
    args.logger(`docsIndexSweep: fileReport failed (non-fatal): ${err}`, 'warn');
    return { reportIssue: null, reportAction: 'none' };
  }
}

/**
 * Runs one docs-index sweep pass: read → assess → repair-and-persist →
 * reconcile-report. Never throws. Returns `EMPTY_REPORT` when the repo has
 * no readable index (a target repo without living-docs is a no-op — no PR,
 * no issue).
 */
export async function runDocsIndexSweep(deps: DocsIndexSweepDeps): Promise<DocsIndexSweepReport> {
  const logger = deps.log ?? log;

  let cachedBase: SweepBase | null | undefined;
  const getBase = (): SweepBase | null => {
    if (cachedBase === undefined) cachedBase = prepareSweepBase(deps.boundary, DOCS_INDEX_SWEEP_SPEC);
    return cachedBase;
  };

  const defaults = makeDocsIndexSweepDefaults(deps.boundary, getBase);
  const readIndex = deps.readIndex ?? defaults.readIndex;
  const listFiles = deps.listFiles ?? defaults.listFiles;
  const persistIndex = deps.persistIndex ?? defaults.persistIndex;
  const listReportCandidates = deps.listReportCandidates ?? defaults.listReportCandidates;
  const fileReport = deps.fileReport ?? defaults.fileReport;
  const refreshReport = deps.refreshReport ?? defaults.refreshReport;
  const closeReport = deps.closeReport ?? defaults.closeReport;
  const countBand = deps.countBand !== undefined ? deps.countBand : defaults.countBand;

  try {
    let content: string | null;
    try {
      content = readIndex();
    } catch (err) {
      logger(`docsIndexSweep: readIndex failed (non-fatal): ${err}`, 'warn');
      content = null;
    }
    if (!content || !content.trim()) {
      logger('docsIndexSweep: no docs index found — nothing to sweep', 'info');
      return EMPTY_REPORT;
    }

    let files: readonly string[];
    try {
      files = listFiles();
    } catch (err) {
      logger(`docsIndexSweep: listFiles failed (non-fatal): ${err}`, 'warn');
      files = [];
    }

    const { repairs, repaired, violations } = assessDocsIndexHealth({ content, files }, countBand ?? null);

    let persisted = false;
    if (repairs.length > 0) {
      for (const repair of repairs) logger(`docsIndexSweep: ${formatRepair(repair)}`, 'info');
      try {
        await persistIndex(serializeConditionalDocs(repaired), repairs);
        persisted = true;
      } catch (err) {
        logger(`docsIndexSweep: persistIndex failed (non-fatal): ${err}`, 'error');
      }
    }

    const { reportIssue, reportAction } = await reconcileReport({
      violations,
      listReportCandidates,
      fileReport,
      refreshReport,
      closeReport,
      boundary: deps.boundary,
      logger,
    });

    return { repairs, violations, persisted, reportIssue, reportAction };
  } finally {
    if (cachedBase) cleanupSweepBase(cachedBase);
  }
}

// ── CLI entry point ──────────────────────────────────────────────────────────

if (process.argv[1]?.replace(/\\/g, '/').includes('docsIndexSweep')) {
  const targetRepo = parseTargetRepoArgs(process.argv.slice(2));
  runDocsIndexSweep({ boundary: buildLaunchBoundary(targetRepo) })
    .then((r) =>
      log(
        `docsIndexSweep: ${r.repairs.length} repair(s), ${r.violations.length} violation(s), persisted=${r.persisted}, report=${r.reportAction}${r.reportIssue ? ` (#${r.reportIssue})` : ''}`,
        'info',
      ),
    )
    .catch((e) => {
      log(`docsIndexSweep: fatal ${e}`, 'error');
      process.exit(1);
    });
}
