import { describe, it, expect, vi } from 'vitest';

vi.mock('../../core', () => ({
  log: vi.fn(),
}));

import { runDocsIndexSweep } from '../docsIndexSweep';
import type { ConditionalDocEntry } from '../../core/conditionalDocsRegistry';
import type { DocsIndexRepair } from '../../core/docsIndexHealth';
import type { DocsIndexReportIssueSpec } from '../../core/docsIndexReportBody';
import { entry, registryContent, makeFakeBoundary } from './fixtures/docsIndexSweepHarness';

describe('runDocsIndexSweep — decisions', () => {
  const ADR_44 = 'specs/adr/0044-living-docs-per-module.md';
  const DECIDED = 'app_docs/feature-decided.md';
  const DECISIONS_DOC = `# Module\n\n## Decisions\n\n- [ADR-0044](../${ADR_44}) — One living doc per module, rewritten in place\n`;

  const liveEntries = (count: number): ConditionalDocEntry[] =>
    Array.from({ length: count }, (_, i) => entry({ docPath: `app_docs/feature-live${i}.md` }));

  it('a block survives a persisted repair — the dead glob is pruned and the Decisions: block stays', async () => {
    const live = liveEntries(29);
    const decided = entry({ docPath: DECIDED, ownedGlobs: ['adws/gone.ts'], decisions: ['0044'] });
    const persistIndex = vi.fn((_content: string, _repairs: readonly DocsIndexRepair[]) => Promise.resolve());

    const report = await runDocsIndexSweep({
      boundary: makeFakeBoundary(),
      readIndex: () => registryContent([...live, decided]),
      listFiles: () => [...live.map((e) => e.docPath), DECIDED, ADR_44],
      readDoc: (docPath) => (docPath === DECIDED ? DECISIONS_DOC : null),
      persistIndex,
      listReportCandidates: () => [],
      fileReport: vi.fn(),
      refreshReport: vi.fn(),
      closeReport: vi.fn(),
      countBand: null,
    });

    expect(persistIndex).toHaveBeenCalledTimes(1);
    expect(persistIndex.mock.calls[0][0]).toBe(registryContent([...live, { ...decided, ownedGlobs: [] }]));
    expect(report.violations).toEqual([]);
  });

  it('reports a block whose doc lacks the section in the report issue, and persists nothing for it', async () => {
    const entries = [...liveEntries(30), entry({ docPath: DECIDED, decisions: ['0044'] })];
    const persistIndex = vi.fn((_content: string, _repairs: readonly DocsIndexRepair[]) => Promise.resolve());
    const fileReport = vi.fn((_spec: DocsIndexReportIssueSpec) => 301);

    const report = await runDocsIndexSweep({
      boundary: makeFakeBoundary(),
      readIndex: () => registryContent(entries),
      listFiles: () => [...entries.map((e) => e.docPath), ADR_44],
      readDoc: () => '# Module\n',
      persistIndex,
      listReportCandidates: () => [],
      fileReport,
      refreshReport: vi.fn(),
      closeReport: vi.fn(),
      countBand: null,
    });

    expect(persistIndex).not.toHaveBeenCalled();
    expect(report.repairs).toEqual([]);
    expect(report.violations).toEqual([{ kind: 'decisions-mismatch', docPath: DECIDED, onlyInBlock: ['0044'], onlyInSection: [] }]);
    expect(fileReport).toHaveBeenCalledTimes(1);
    expect(fileReport.mock.calls[0][0].body).toContain(DECIDED);
    expect(report.reportAction).toBe('filed');
  });

  it('a throwing readDoc is logged at warn and treated as an unreadable doc — the sweep still returns its report', async () => {
    const entries = [...liveEntries(30), entry({ docPath: DECIDED, decisions: ['0044'] })];
    const logger = vi.fn((_msg: string, _level?: string) => undefined);

    const report = await runDocsIndexSweep({
      boundary: makeFakeBoundary(),
      readIndex: () => registryContent(entries),
      listFiles: () => [...entries.map((e) => e.docPath), ADR_44],
      readDoc: () => {
        throw new Error('disk gone');
      },
      persistIndex: vi.fn(),
      listReportCandidates: () => [],
      fileReport: vi.fn(() => 302),
      refreshReport: vi.fn(),
      closeReport: vi.fn(),
      countBand: null,
      log: logger,
    });

    expect(report.violations.some((v) => v.kind === 'decisions-mismatch')).toBe(true);
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('disk gone'), 'warn');
  });
});
