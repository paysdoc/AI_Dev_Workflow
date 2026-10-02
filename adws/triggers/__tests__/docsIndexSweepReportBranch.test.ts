import { describe, it, expect, vi } from 'vitest';

vi.mock('../../core', () => ({
  log: vi.fn(),
}));

import { runDocsIndexSweep } from '../docsIndexSweep';
import type { DocsIndexReportIssueSpec } from '../../core/docsIndexReportBody';
import type { LaunchBoundary } from '../../core';
import { entry, registryContent, makeFakeBoundary } from './fixtures/docsIndexSweepHarness';

describe('runDocsIndexSweep — the branch the report names', () => {
  const overlapEntries = [
    entry({ docPath: 'app_docs/feature-a.md', ownedGlobs: ['adws/shared/*.ts'] }),
    entry({ docPath: 'app_docs/feature-b.md', ownedGlobs: ['adws/shared/x.ts'] }),
  ];

  async function filedBodyFor(boundary: LaunchBoundary): Promise<string> {
    const fileReport = vi.fn((_spec: DocsIndexReportIssueSpec) => 101);

    await runDocsIndexSweep({
      boundary,
      readDoc: () => null,
      readIndex: () => registryContent(overlapEntries),
      listFiles: () => ['adws/shared/x.ts', ...overlapEntries.map((e) => e.docPath)],
      persistIndex: vi.fn(),
      listReportCandidates: () => [],
      fileReport,
      refreshReport: vi.fn(),
      closeReport: vi.fn(),
      countBand: null,
    });

    expect(fileReport).toHaveBeenCalledTimes(1);
    return fileReport.mock.calls[0][0].body;
  }

  function boundaryWhoseDefaultBranchIs(getDefaultBranch: () => string): LaunchBoundary {
    const fake = makeFakeBoundary();
    return { ...fake, providers: { ...fake.providers, codeHost: { getDefaultBranch } as never } } as LaunchBoundary;
  }

  it('names the default branch the code host returns', async () => {
    const body = await filedBodyFor(boundaryWhoseDefaultBranchIs(() => 'trunk'));

    expect(body).toContain('on `trunk` that need a human decision');
  });

  it('files the report and names no branch when the default-branch lookup throws', async () => {
    const body = await filedBodyFor(makeFakeBoundary());

    expect(body).toContain('in `.adw/conditional_docs.md` that need a human decision.');
    expect(body).not.toMatch(/ on `/);
  });

  it('does not let the lookup error escape the sweep', async () => {
    const boundary = boundaryWhoseDefaultBranchIs(() => {
      throw new Error('default branch lookup failed');
    });

    await expect(filedBodyFor(boundary)).resolves.toContain('need a human decision');
  });
});
