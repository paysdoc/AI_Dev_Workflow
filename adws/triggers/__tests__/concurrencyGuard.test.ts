import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../core', () => ({
  log: vi.fn(),
  MAX_CONCURRENT_PER_REPO: 3,
}));

vi.mock('../../forge/linkedPrDetector', () => ({
  fetchLinkedPRs: vi.fn(() => []),
  hasLinkedMergedOrClosedPR: vi.fn(() => false),
}));

vi.mock('../../core/workflowCommentParsing', () => ({
  isAdwComment: vi.fn((body: string) => body.includes('ADW')),
}));

import { isConcurrencyLimitReached } from '../concurrencyGuard';
import { hasLinkedMergedOrClosedPR } from '../../forge/linkedPrDetector';
import { Platform } from '../../providers/types';
import type { BoundProviders, IssueListEntry } from '../../providers/types';

const REPO_INFO = { owner: 'acme', repo: 'webapp', platform: Platform.GitHub };

function makeProviders(listIssuesImpl: () => IssueListEntry[]): Pick<BoundProviders, 'issueTracker' | 'codeHost'> {
  return {
    issueTracker: { listIssues: vi.fn(listIssuesImpl) } as unknown as BoundProviders['issueTracker'],
    codeHost: { getRepoIdentifier: () => REPO_INFO, listPullRequests: () => [] } as unknown as BoundProviders['codeHost'],
  };
}

describe('isConcurrencyLimitReached — routes through the bound issue tracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false when there are no in-progress issues', async () => {
    const providers = makeProviders(() => [
      { number: 1, comments: [] },
      { number: 2, comments: [{ body: 'normal comment' }] },
    ]);

    const result = await isConcurrencyLimitReached(providers);

    expect(providers.issueTracker.listIssues).toHaveBeenCalledWith({ fields: ['number', 'comments'], limit: 100 });
    expect(result).toBe(false);
  });

  it('counts in-progress issues (has ADW comment, no merged/closed PR)', async () => {
    const providers = makeProviders(() => [
      { number: 1, comments: [{ body: 'ADW workflow started' }] },
      { number: 2, comments: [{ body: 'ADW workflow started' }] },
      { number: 3, comments: [{ body: 'ADW workflow started' }] },
    ]);
    vi.mocked(hasLinkedMergedOrClosedPR).mockReturnValue(false);

    const result = await isConcurrencyLimitReached(providers);

    expect(result).toBe(true);
  });

  it('does not count issues with merged PRs', async () => {
    const providers = makeProviders(() => [
      { number: 1, comments: [{ body: 'ADW workflow started' }] },
    ]);
    vi.mocked(hasLinkedMergedOrClosedPR).mockReturnValue(true);

    const result = await isConcurrencyLimitReached(providers);

    expect(result).toBe(false);
  });

  it('returns false and logs on a listIssues throw', async () => {
    const providers = makeProviders(() => { throw new Error('gh failed'); });

    const result = await isConcurrencyLimitReached(providers);

    expect(result).toBe(false);
  });

  it('calls listIssues with number+comments fields and limit 100', async () => {
    const providers = makeProviders(() => []);

    await isConcurrencyLimitReached(providers);

    expect(providers.issueTracker.listIssues).toHaveBeenCalledWith({ fields: ['number', 'comments'], limit: 100 });
  });
});
