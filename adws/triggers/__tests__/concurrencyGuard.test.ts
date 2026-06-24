import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../github/gitContextFactory', () => ({
  gitContextForRepo: vi.fn(),
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
import { gitContextForRepo } from '../../github/gitContextFactory';
import { hasLinkedMergedOrClosedPR } from '../../github/linkedPrDetector';

const REPO_INFO = { owner: 'acme', repo: 'webapp' };

function makeCtx(listOpenIssuesResult: string) {
  return { listOpenIssues: vi.fn(() => listOpenIssuesResult) };
}

describe('isConcurrencyLimitReached — routes through gitContextForRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false when there are no in-progress issues', async () => {
    const issues = [
      { number: 1, comments: [] },
      { number: 2, comments: [{ body: 'normal comment' }] },
    ];
    vi.mocked(gitContextForRepo).mockReturnValue(makeCtx(JSON.stringify(issues)) as never);

    const result = await isConcurrencyLimitReached(REPO_INFO);

    expect(gitContextForRepo).toHaveBeenCalledWith(REPO_INFO);
    expect(result).toBe(false);
  });

  it('counts in-progress issues (has ADW comment, no merged/closed PR)', async () => {
    const issues = [
      { number: 1, comments: [{ body: 'ADW workflow started' }] },
      { number: 2, comments: [{ body: 'ADW workflow started' }] },
      { number: 3, comments: [{ body: 'ADW workflow started' }] },
    ];
    vi.mocked(gitContextForRepo).mockReturnValue(makeCtx(JSON.stringify(issues)) as never);
    vi.mocked(hasLinkedMergedOrClosedPR).mockReturnValue(false);

    const result = await isConcurrencyLimitReached(REPO_INFO);

    expect(result).toBe(true);
  });

  it('does not count issues with merged PRs', async () => {
    const issues = [
      { number: 1, comments: [{ body: 'ADW workflow started' }] },
    ];
    vi.mocked(gitContextForRepo).mockReturnValue(makeCtx(JSON.stringify(issues)) as never);
    vi.mocked(hasLinkedMergedOrClosedPR).mockReturnValue(true);

    const result = await isConcurrencyLimitReached(REPO_INFO);

    expect(result).toBe(false);
  });

  it('returns false and logs on parse/throw error', async () => {
    vi.mocked(gitContextForRepo).mockReturnValue({ listOpenIssues: vi.fn(() => { throw new Error('gh failed'); }) } as never);

    const result = await isConcurrencyLimitReached(REPO_INFO);

    expect(result).toBe(false);
  });

  it('calls listOpenIssues with number+comments fields and limit 100', async () => {
    const ctx = makeCtx('[]');
    vi.mocked(gitContextForRepo).mockReturnValue(ctx as never);

    await isConcurrencyLimitReached(REPO_INFO);

    expect(ctx.listOpenIssues).toHaveBeenCalledWith({ fields: ['number', 'comments'], limit: 100 });
  });
});
