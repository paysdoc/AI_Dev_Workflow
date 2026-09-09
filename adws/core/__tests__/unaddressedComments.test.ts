import { describe, it, expect, vi } from 'vitest';
import { readUnaddressedComments, getLastAdwCommitTimestamp, type UnaddressedCommentReads, type UnaddressedCommentCandidate } from '../unaddressedComments';
import type { GitContext } from '../../gitContext';

type TestComment = UnaddressedCommentCandidate;

function makeReads(overrides: Partial<UnaddressedCommentReads<TestComment>> = {}): UnaddressedCommentReads<TestComment> {
  return {
    fetchPullRequest: () => ({ sourceBranch: 'feature-x' }),
    fetchReviewComments: () => [],
    getAuthenticatedUser: () => null,
    lastAdwCommitTimestamp: () => null,
    ...overrides,
  };
}

describe('readUnaddressedComments', () => {
  it('drops bot comments', () => {
    const comments: TestComment[] = [{ author: 'dependabot', isBot: true, body: 'bump a dep', createdAt: '2026-09-02T00:00:00Z' }];
    const result = readUnaddressedComments(7, makeReads({ fetchReviewComments: () => comments }), () => {});
    expect(result).toEqual([]);
  });

  it('drops self-authored comments', () => {
    const comments: TestComment[] = [{ author: 'adw-bot', body: 'approving my own work', createdAt: '2026-09-02T00:00:00Z' }];
    const reads = makeReads({ fetchReviewComments: () => comments, getAuthenticatedUser: () => 'adw-bot' });
    expect(readUnaddressedComments(7, reads, () => {})).toEqual([]);
  });

  it('drops ADW-signed comments', () => {
    const comments: TestComment[] = [{ author: 'someone', body: 'ADW review complete <!-- adw-bot -->', createdAt: '2026-09-02T00:00:00Z' }];
    expect(readUnaddressedComments(7, makeReads({ fetchReviewComments: () => comments }), () => {})).toEqual([]);
  });

  it('never asks for the last-ADW-commit timestamp when no human comments remain', () => {
    const comments: TestComment[] = [{ author: 'dependabot', isBot: true, body: 'bump a dep', createdAt: '2026-09-02T00:00:00Z' }];
    const lastAdwCommitTimestamp = vi.fn(() => null);
    readUnaddressedComments(7, makeReads({ fetchReviewComments: () => comments, lastAdwCommitTimestamp }), () => {});
    expect(lastAdwCommitTimestamp).not.toHaveBeenCalled();
  });

  it('returns every human comment when no ADW commit is found', () => {
    const comments: TestComment[] = [
      { author: 'alice', body: 'please rename this', createdAt: '2026-09-02T00:00:00Z' },
      { author: 'bob', body: 'looks good', createdAt: '2026-08-30T00:00:00Z' },
    ];
    const result = readUnaddressedComments(7, makeReads({ fetchReviewComments: () => comments }), () => {});
    expect(result).toEqual(comments);
  });

  it('returns only comments created after the last ADW commit', () => {
    const comments: TestComment[] = [
      { author: 'alice', body: 'please rename this', createdAt: '2026-09-02T00:00:00Z' },
      { author: 'bob', body: 'looks good', createdAt: '2026-08-30T00:00:00Z' },
    ];
    const reads = makeReads({
      fetchReviewComments: () => comments,
      lastAdwCommitTimestamp: () => new Date('2026-09-01T00:00:00Z'),
    });
    const result = readUnaddressedComments(7, reads, () => {});
    expect(result).toEqual([comments[0]]);
  });
});

describe('getLastAdwCommitTimestamp', () => {
  function makeGitContext(logOutput: () => string): GitContext {
    return { log: logOutput } as unknown as GitContext;
  }

  it('parses the timestamp off the first ADW-formatted commit line', () => {
    const ctx = makeGitContext(() => [
      '2026-09-02T00:00:00Z docs: update readme',
      '2026-09-01T00:00:00Z build-agent: feat: implement the thing',
    ].join('\n'));
    const result = getLastAdwCommitTimestamp('feature-x', ctx);
    expect(result).toEqual(new Date('2026-09-01T00:00:00Z'));
  });

  it('returns null when the git context throws', () => {
    const ctx = makeGitContext(() => { throw new Error('boom'); });
    expect(getLastAdwCommitTimestamp('feature-x', ctx)).toBeNull();
  });
});
