import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../github/issueListApi', () => ({
  listIssues: vi.fn(),
}));

vi.mock('../../core', () => ({
  log: vi.fn(),
  MAX_CONCURRENT_PER_REPO: 3,
}));

vi.mock('../../github/linkedPrDetector', () => ({
  fetchLinkedPRs: vi.fn(() => []),
  hasLinkedMergedOrClosedPR: vi.fn(() => false),
}));

vi.mock('../../core/workflowCommentParsing', () => ({
  isAdwComment: vi.fn((body: string) => body.includes('ADW')),
}));

import { isConcurrencyLimitReached } from '../concurrencyGuard';
import { listIssues } from '../../github/issueListApi';
import { hasLinkedMergedOrClosedPR } from '../../github/linkedPrDetector';
import { Platform } from '../../providers/types';

const REPO_INFO = { owner: 'acme', repo: 'webapp', platform: Platform.GitHub };

describe('isConcurrencyLimitReached — routes through issueListApi.listIssues', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false when there are no in-progress issues', async () => {
    vi.mocked(listIssues).mockReturnValue([
      { number: 1, comments: [] },
      { number: 2, comments: [{ body: 'normal comment' }] },
    ]);

    const result = await isConcurrencyLimitReached(REPO_INFO);

    expect(listIssues).toHaveBeenCalledWith({ fields: ['number', 'comments'], limit: 100 }, REPO_INFO);
    expect(result).toBe(false);
  });

  it('counts in-progress issues (has ADW comment, no merged/closed PR)', async () => {
    vi.mocked(listIssues).mockReturnValue([
      { number: 1, comments: [{ body: 'ADW workflow started' }] },
      { number: 2, comments: [{ body: 'ADW workflow started' }] },
      { number: 3, comments: [{ body: 'ADW workflow started' }] },
    ]);
    vi.mocked(hasLinkedMergedOrClosedPR).mockReturnValue(false);

    const result = await isConcurrencyLimitReached(REPO_INFO);

    expect(result).toBe(true);
  });

  it('does not count issues with merged PRs', async () => {
    vi.mocked(listIssues).mockReturnValue([
      { number: 1, comments: [{ body: 'ADW workflow started' }] },
    ]);
    vi.mocked(hasLinkedMergedOrClosedPR).mockReturnValue(true);

    const result = await isConcurrencyLimitReached(REPO_INFO);

    expect(result).toBe(false);
  });

  it('returns false and logs on a listIssues throw', async () => {
    vi.mocked(listIssues).mockImplementation(() => { throw new Error('gh failed'); });

    const result = await isConcurrencyLimitReached(REPO_INFO);

    expect(result).toBe(false);
  });

  it('calls listIssues with number+comments fields and limit 100', async () => {
    vi.mocked(listIssues).mockReturnValue([]);

    await isConcurrencyLimitReached(REPO_INFO);

    expect(listIssues).toHaveBeenCalledWith({ fields: ['number', 'comments'], limit: 100 }, REPO_INFO);
  });
});
