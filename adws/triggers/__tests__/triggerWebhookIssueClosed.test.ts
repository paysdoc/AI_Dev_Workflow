import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('../../core/utils', () => ({
  log: vi.fn(),
}));

vi.mock('../../core/costCsvWriter', () => ({
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

vi.mock('../../core/costCommitQueue', () => ({
  costCommitQueue: {
    enqueue: vi.fn((fn: () => Promise<void>) => fn()),
  },
}));

vi.mock('./webhookHandlers', async (importOriginal) => {
  const original = await importOriginal<typeof import('../webhookHandlers')>();
  return {
    ...original,
  };
});

import { rebuildProjectCostCsv } from '../../core/costCsvWriter';
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

    expect(rebuildProjectCostCsv).not.toHaveBeenCalled();
    expect(commitAndPushCostFiles).not.toHaveBeenCalled();
  });

  it('calls rebuildProjectCostCsv when issue was NOT handled by merged PR', async () => {
    await handleIssueCostRevert(91, 'my-repo');

    expect(pullLatestCostBranch).toHaveBeenCalled();
    expect(rebuildProjectCostCsv).toHaveBeenCalledWith(process.cwd(), 'my-repo', 0.92);
  });

  it('calls rebuildProjectCostCsv and commitAndPushCostFiles unconditionally when issue was not handled by merged PR', async () => {
    await handleIssueCostRevert(91, 'my-repo');

    expect(rebuildProjectCostCsv).toHaveBeenCalledWith(process.cwd(), 'my-repo', 0.92);
    expect(commitAndPushCostFiles).toHaveBeenCalledWith({ repoName: 'my-repo' });
  });
});
