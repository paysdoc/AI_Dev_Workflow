import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('../../core/utils', () => ({
  log: vi.fn(),
}));

vi.mock('../../core/costCsvWriter', () => ({
  revertIssueCostFile: vi.fn(() => []),
  rebuildProjectCostCsv: vi.fn(),
  getProjectCsvPath: vi.fn((repoName: string) => `projects/${repoName}/total-cost.csv`),
  getIssueCsvPath: vi.fn(),
  formatIssueCostCsv: vi.fn(),
  formatProjectCostCsv: vi.fn(),
  parseProjectCostCsv: vi.fn(),
  writeIssueCostCsv: vi.fn(),
  parseIssueCostTotal: vi.fn(),
}));

vi.mock('../../core/costReport', () => ({
  fetchExchangeRates: vi.fn(() => Promise.resolve({ EUR: 0.92 })),
}));

vi.mock('../../github/gitOperations', () => ({
  commitAndPushCostFiles: vi.fn(() => true),
  pullLatestCostBranch: vi.fn(),
}));

vi.mock('./webhookHandlers', async (importOriginal) => {
  const original = await importOriginal<typeof import('../webhookHandlers')>();
  return {
    ...original,
  };
});

import { revertIssueCostFile, rebuildProjectCostCsv } from '../../core/costCsvWriter';
import { commitAndPushCostFiles, pullLatestCostBranch } from '../../github/gitOperations';
import { recordMergedPrIssue, resetMergedPrIssues } from '../webhookHandlers';
import { handleIssueCostRevert } from '../trigger_webhook';

describe('handleIssueCostRevert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMergedPrIssues();
  });

  it('skips cost revert when issue was already handled by merged PR', async () => {
    recordMergedPrIssue(91);

    await handleIssueCostRevert(91, 'my-repo');

    expect(revertIssueCostFile).not.toHaveBeenCalled();
    expect(rebuildProjectCostCsv).not.toHaveBeenCalled();
    expect(commitAndPushCostFiles).not.toHaveBeenCalled();
  });

  it('calls revertIssueCostFile when issue was NOT handled by merged PR', async () => {
    await handleIssueCostRevert(91, 'my-repo');

    expect(pullLatestCostBranch).toHaveBeenCalled();
    expect(revertIssueCostFile).toHaveBeenCalledWith(process.cwd(), 'my-repo', 91);
  });

  it('does NOT call rebuildProjectCostCsv or commitAndPushCostFiles when revert returns empty array', async () => {
    vi.mocked(revertIssueCostFile).mockReturnValue([]);

    await handleIssueCostRevert(91, 'my-repo');

    expect(rebuildProjectCostCsv).not.toHaveBeenCalled();
    expect(commitAndPushCostFiles).not.toHaveBeenCalled();
  });

  it('calls commitAndPushCostFiles with specific paths when files were reverted', async () => {
    vi.mocked(revertIssueCostFile).mockReturnValue(['projects/my-repo/91-some-issue.csv']);

    await handleIssueCostRevert(91, 'my-repo');

    expect(rebuildProjectCostCsv).toHaveBeenCalledWith(process.cwd(), 'my-repo', 0.92);
    expect(commitAndPushCostFiles).toHaveBeenCalledWith({
      repoName: 'my-repo',
      paths: ['projects/my-repo/91-some-issue.csv', 'projects/my-repo/total-cost.csv'],
    });
  });
});
