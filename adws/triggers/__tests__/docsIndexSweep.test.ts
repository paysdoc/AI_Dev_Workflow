import { describe, it, expect, vi } from 'vitest';

// ── Module mocks (hoisted) ───────────────────────────────────────────────────

vi.mock('../../core', () => ({
  log: vi.fn(),
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { runDocsIndexSweep } from '../docsIndexSweep';
import { serializeConditionalDocs, type ConditionalDocsRegistry, type ConditionalDocEntry } from '../../core/conditionalDocsRegistry';
import { assessDocsIndexHealth, type DocsIndexRepair } from '../../core/docsIndexHealth';
import { DOCS_INDEX_REPORT_MARKER, docsIndexViolationFingerprint, type DocsIndexReportIssueSpec } from '../../core/docsIndexReportBody';
import type { LaunchBoundary } from '../../core';
import type { RepoIdentifier } from '../../providers/types';
import { Platform } from '../../providers/types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function entry(overrides: Partial<ConditionalDocEntry> & { docPath: string }): ConditionalDocEntry {
  return { ownedGlobs: [], conditions: ['When X'], ...overrides };
}

function registryContent(entries: ConditionalDocEntry[]): string {
  const registry: ConditionalDocsRegistry = { preamble: '# Conditional Documentation\n', entries };
  return serializeConditionalDocs(registry);
}

/** Fully-injected boundary — no SweepBase is ever prepared since every base-dependent dep is overridden in these tests. */
function makeFakeBoundary(selfHost = true): LaunchBoundary {
  const repoId: RepoIdentifier = { owner: 'test-owner', repo: 'test-repo', platform: Platform.GitHub };
  return {
    gitContext: { owner: 'test-owner', repo: 'test-repo', selfHost } as unknown as LaunchBoundary['gitContext'],
    repoId,
    providers: { issueTracker: {} as never, codeHost: {} as never },
  } as LaunchBoundary;
}

function reportRef(number: number, fingerprint: string, state = 'OPEN') {
  return { number, body: `${DOCS_INDEX_REPORT_MARKER}\nFingerprint: ${fingerprint}\n`, state };
}

describe('runDocsIndexSweep — repair persistence', () => {
  it('20 dangling entries → persistIndex receives content with exactly those entries gone, repairs.length === 20', async () => {
    const liveEntries = Array.from({ length: 30 }, (_, i) => entry({ docPath: `app_docs/feature-live${i}.md` }));
    const danglingEntries = Array.from({ length: 20 }, (_, i) => entry({ docPath: `app_docs/feature-ghost${i}.md` }));
    const content = registryContent([...liveEntries, ...danglingEntries]);
    const files = liveEntries.map((e) => e.docPath);

    const persistIndex = vi.fn((_content: string, _repairs: readonly DocsIndexRepair[]) => Promise.resolve());
    const report = await runDocsIndexSweep({
      boundary: makeFakeBoundary(),
      readIndex: () => content,
      listFiles: () => files,
      persistIndex,
      listReportCandidates: () => [],
      fileReport: vi.fn(),
      refreshReport: vi.fn(),
      closeReport: vi.fn(),
    });

    expect(report.repairs).toHaveLength(20);
    expect(persistIndex).toHaveBeenCalledTimes(1);
    const [persistedContent] = persistIndex.mock.calls[0];
    expect(persistedContent).toBe(registryContent(liveEntries));
    for (const e of danglingEntries) expect(persistedContent).not.toContain(e.docPath);
  });

  it('no repairs → persistIndex is not called', async () => {
    const liveEntries = Array.from({ length: 30 }, (_, i) => entry({ docPath: `app_docs/feature-live${i}.md` }));
    const content = registryContent(liveEntries);
    const persistIndex = vi.fn((_content: string, _repairs: readonly DocsIndexRepair[]) => Promise.resolve());

    const report = await runDocsIndexSweep({
      boundary: makeFakeBoundary(),
      readIndex: () => content,
      listFiles: () => liveEntries.map((e) => e.docPath),
      persistIndex,
      listReportCandidates: () => [],
      fileReport: vi.fn(),
      refreshReport: vi.fn(),
      closeReport: vi.fn(),
    });

    expect(report.repairs).toEqual([]);
    expect(persistIndex).not.toHaveBeenCalled();
  });

  it('a dead glob is pruned from the persisted content while the entry survives', async () => {
    const liveEntries = Array.from({ length: 29 }, (_, i) => entry({ docPath: `app_docs/feature-live${i}.md` }));
    const deadGlobEntry = entry({ docPath: 'app_docs/feature-deadglob.md', ownedGlobs: ['adws/gone.ts'] });
    const content = registryContent([...liveEntries, deadGlobEntry]);
    const files = [...liveEntries.map((e) => e.docPath), deadGlobEntry.docPath];

    const persistIndex = vi.fn((_content: string, _repairs: readonly DocsIndexRepair[]) => Promise.resolve());
    await runDocsIndexSweep({
      boundary: makeFakeBoundary(),
      readIndex: () => content,
      listFiles: () => files,
      persistIndex,
      listReportCandidates: () => [],
      fileReport: vi.fn(),
      refreshReport: vi.fn(),
      closeReport: vi.fn(),
    });

    const [persistedContent] = persistIndex.mock.calls[0];
    expect(persistedContent).not.toContain('adws/gone.ts');
    expect(persistedContent).toContain('app_docs/feature-deadglob.md');
  });
});

describe('runDocsIndexSweep — one-issue reconcile', () => {
  const overlapEntries = [
    entry({ docPath: 'app_docs/feature-a.md', ownedGlobs: ['adws/shared/*.ts'] }),
    entry({ docPath: 'app_docs/feature-b.md', ownedGlobs: ['adws/shared/x.ts'] }),
  ];
  const overlapContent = registryContent(overlapEntries);
  const overlapFiles = ['adws/shared/x.ts', ...overlapEntries.map((e) => e.docPath)];

  it('violations with no open report file exactly one issue with hitl + adw:none labels and the marker', async () => {
    const fileReport = vi.fn((_spec: DocsIndexReportIssueSpec) => 101);
    const report = await runDocsIndexSweep({
      boundary: makeFakeBoundary(),
      readIndex: () => overlapContent,
      listFiles: () => overlapFiles,
      persistIndex: vi.fn(),
      listReportCandidates: () => [],
      fileReport,
      refreshReport: vi.fn(),
      closeReport: vi.fn(),
      countBand: null,
    });

    expect(fileReport).toHaveBeenCalledTimes(1);
    const [spec] = fileReport.mock.calls[0];
    expect(spec.labels).toEqual(['hitl', 'adw:none']);
    expect(spec.body).toContain(DOCS_INDEX_REPORT_MARKER);
    expect(report.reportAction).toBe('filed');
    expect(report.reportIssue).toBe(101);
  });

  it('violations with an open report of the same fingerprint → no fileReport/refreshReport (unchanged)', async () => {
    const { violations } = assessDocsIndexHealth({ content: overlapContent, files: overlapFiles }, null);
    const fingerprint = docsIndexViolationFingerprint(violations);
    const fileReport = vi.fn();
    const refreshReport = vi.fn();

    const report = await runDocsIndexSweep({
      boundary: makeFakeBoundary(),
      readIndex: () => overlapContent,
      listFiles: () => overlapFiles,
      persistIndex: vi.fn(),
      listReportCandidates: () => [reportRef(5, fingerprint)],
      fileReport,
      refreshReport,
      closeReport: vi.fn(),
      countBand: null,
    });

    expect(fileReport).not.toHaveBeenCalled();
    expect(refreshReport).not.toHaveBeenCalled();
    expect(report.reportAction).toBe('unchanged');
    expect(report.reportIssue).toBe(5);
  });

  it('a different fingerprint refreshes the lowest-numbered open report', async () => {
    const refreshReport = vi.fn();
    const report = await runDocsIndexSweep({
      boundary: makeFakeBoundary(),
      readIndex: () => overlapContent,
      listFiles: () => overlapFiles,
      persistIndex: vi.fn(),
      listReportCandidates: () => [reportRef(12, 'aaaaaaaaaaaa')],
      fileReport: vi.fn(),
      refreshReport,
      closeReport: vi.fn(),
      countBand: null,
    });

    expect(refreshReport).toHaveBeenCalledTimes(1);
    expect(refreshReport.mock.calls[0][0]).toBe(12);
    expect(report.reportAction).toBe('refreshed');
  });

  it('two open reports with a stale fingerprint → the lowest-numbered one is refreshed', async () => {
    const refreshReport = vi.fn();
    await runDocsIndexSweep({
      boundary: makeFakeBoundary(),
      readIndex: () => overlapContent,
      listFiles: () => overlapFiles,
      persistIndex: vi.fn(),
      listReportCandidates: () => [reportRef(205, 'aaaaaaaaaaaa'), reportRef(101, 'bbbbbbbbbbbb')],
      fileReport: vi.fn(),
      refreshReport,
      closeReport: vi.fn(),
      countBand: null,
    });

    expect(refreshReport).toHaveBeenCalledTimes(1);
    expect(refreshReport.mock.calls[0][0]).toBe(101);
  });

  it('no violations with an open report → closeReport is called', async () => {
    const entries = Array.from({ length: 30 }, (_, i) => entry({ docPath: `app_docs/feature-live${i}.md`, ownedGlobs: [`adws/live${i}.ts`] }));
    const content = registryContent(entries);
    const files = [...entries.map((e) => e.docPath), ...entries.map((_e, i) => `adws/live${i}.ts`)];
    const closeReport = vi.fn(() => Promise.resolve());

    const report = await runDocsIndexSweep({
      boundary: makeFakeBoundary(),
      readIndex: () => content,
      listFiles: () => files,
      persistIndex: vi.fn(),
      listReportCandidates: () => [reportRef(9, 'cccccccccccc')],
      fileReport: vi.fn(),
      refreshReport: vi.fn(),
      closeReport,
      countBand: null,
    });

    expect(closeReport).toHaveBeenCalledWith(9);
    expect(report.reportAction).toBe('closed');
  });
});

describe('runDocsIndexSweep — target-repo band skip and edge cases', () => {
  it('countBand: null skips the count-out-of-band check even with a tiny index', async () => {
    const entries = [entry({ docPath: 'app_docs/feature-a.md' }), entry({ docPath: 'app_docs/feature-b.md' })];
    const content = registryContent(entries);

    const report = await runDocsIndexSweep({
      boundary: makeFakeBoundary(false),
      readIndex: () => content,
      listFiles: () => entries.map((e) => e.docPath),
      persistIndex: vi.fn(),
      listReportCandidates: () => [],
      fileReport: vi.fn(),
      refreshReport: vi.fn(),
      closeReport: vi.fn(),
      countBand: null,
    });

    expect(report.violations.some((v) => v.kind === 'count-out-of-band')).toBe(false);
  });

  it('readIndex returning null → empty report, no other dep is called', async () => {
    const listFiles = vi.fn();
    const persistIndex = vi.fn();
    const fileReport = vi.fn();
    const listReportCandidates = vi.fn();

    const report = await runDocsIndexSweep({
      boundary: makeFakeBoundary(),
      readIndex: () => null,
      listFiles,
      persistIndex,
      listReportCandidates,
      fileReport,
      refreshReport: vi.fn(),
      closeReport: vi.fn(),
    });

    expect(report).toEqual({ repairs: [], violations: [], persisted: false, reportIssue: null, reportAction: 'none' });
    expect(listFiles).not.toHaveBeenCalled();
    expect(persistIndex).not.toHaveBeenCalled();
    expect(fileReport).not.toHaveBeenCalled();
    expect(listReportCandidates).not.toHaveBeenCalled();
  });

  it('a throwing persistIndex is swallowed — the report is still returned with persisted: false', async () => {
    const entries = [entry({ docPath: 'app_docs/feature-ghost.md' })];
    const content = registryContent(entries);

    const report = await runDocsIndexSweep({
      boundary: makeFakeBoundary(),
      readIndex: () => content,
      listFiles: () => [],
      persistIndex: vi.fn(() => Promise.reject(new Error('push failed'))),
      listReportCandidates: () => [],
      fileReport: vi.fn(),
      refreshReport: vi.fn(),
      closeReport: vi.fn(),
      countBand: null,
    });

    expect(report.persisted).toBe(false);
    expect(report.repairs).toHaveLength(1);
  });

  it('a throwing fileReport is swallowed — the report is still returned', async () => {
    const entries = [
      entry({ docPath: 'app_docs/feature-a.md', ownedGlobs: ['adws/shared/*.ts'] }),
      entry({ docPath: 'app_docs/feature-b.md', ownedGlobs: ['adws/shared/x.ts'] }),
    ];
    const content = registryContent(entries);
    const files = ['adws/shared/x.ts', ...entries.map((e) => e.docPath)];

    const report = await runDocsIndexSweep({
      boundary: makeFakeBoundary(),
      readIndex: () => content,
      listFiles: () => files,
      persistIndex: vi.fn(),
      listReportCandidates: () => [],
      fileReport: vi.fn(() => { throw new Error('createIssue failed'); }),
      refreshReport: vi.fn(),
      closeReport: vi.fn(),
      countBand: null,
    });

    expect(report.reportAction).toBe('none');
    expect(report.reportIssue).toBe(null);
  });
});
