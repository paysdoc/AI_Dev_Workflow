import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('../core/utils', () => ({
  log: vi.fn(),
}));

import { execSync } from 'child_process';
import { fetchIssueCommentsRest, deleteIssueComment } from '../github/githubApi';
import { clearIssueComments } from '../adwClearComments';

function mockRepoInfo(): void {
  vi.mocked(execSync).mockReturnValueOnce('https://github.com/test-owner/test-repo.git\n');
}

function makeRawComment(overrides: Record<string, unknown> = {}) {
  return {
    id: 100,
    body: 'some comment',
    user: { login: 'testuser' },
    created_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fetchIssueCommentsRest', () => {
  it('returns mapped comments from REST API response', () => {
    mockRepoInfo();
    vi.mocked(execSync).mockReturnValueOnce(JSON.stringify([
      makeRawComment({ id: 1, body: 'first', user: { login: 'alice' }, created_at: '2025-01-01T00:00:00Z' }),
      makeRawComment({ id: 2, body: 'second', user: { login: 'bob' }, created_at: '2025-01-02T00:00:00Z' }),
    ]));

    const result = fetchIssueCommentsRest(42);

    expect(result).toEqual([
      { id: 1, body: 'first', authorLogin: 'alice', createdAt: '2025-01-01T00:00:00Z' },
      { id: 2, body: 'second', authorLogin: 'bob', createdAt: '2025-01-02T00:00:00Z' },
    ]);
  });

  it('returns empty array when no comments exist', () => {
    mockRepoInfo();
    vi.mocked(execSync).mockReturnValueOnce(JSON.stringify([]));

    const result = fetchIssueCommentsRest(42);

    expect(result).toEqual([]);
  });

  it('throws on API error', () => {
    mockRepoInfo();
    vi.mocked(execSync).mockImplementationOnce(() => {
      throw new Error('API error');
    });

    expect(() => fetchIssueCommentsRest(42)).toThrow('Failed to fetch comments for issue #42');
  });
});

describe('deleteIssueComment', () => {
  it('successfully deletes a comment', () => {
    mockRepoInfo();
    vi.mocked(execSync).mockReturnValueOnce('');

    expect(() => deleteIssueComment(123)).not.toThrow();

    const deleteCall = vi.mocked(execSync).mock.calls[1];
    expect(deleteCall[0]).toContain('DELETE');
    expect(deleteCall[0]).toContain('issues/comments/123');
  });

  it('throws on API error', () => {
    mockRepoInfo();
    vi.mocked(execSync).mockImplementationOnce(() => {
      throw new Error('Not found');
    });

    expect(() => deleteIssueComment(999)).toThrow('Failed to delete comment 999');
  });
});

describe('clearIssueComments', () => {
  it('deletes all comments and returns correct summary', () => {
    // First call: getRepoInfo for fetchIssueCommentsRest
    mockRepoInfo();
    // Second call: fetch comments
    vi.mocked(execSync).mockReturnValueOnce(JSON.stringify([
      makeRawComment({ id: 1 }),
      makeRawComment({ id: 2 }),
    ]));
    // Third call: getRepoInfo for deleteIssueComment (comment 1)
    mockRepoInfo();
    // Fourth call: delete comment 1
    vi.mocked(execSync).mockReturnValueOnce('');
    // Fifth call: getRepoInfo for deleteIssueComment (comment 2)
    mockRepoInfo();
    // Sixth call: delete comment 2
    vi.mocked(execSync).mockReturnValueOnce('');

    const result = clearIssueComments(10);

    expect(result).toEqual({ total: 2, deleted: 2, failed: 0 });
  });

  it('handles issue with no comments gracefully', () => {
    mockRepoInfo();
    vi.mocked(execSync).mockReturnValueOnce(JSON.stringify([]));

    const result = clearIssueComments(10);

    expect(result).toEqual({ total: 0, deleted: 0, failed: 0 });
  });

  it('continues deleting when one deletion fails', () => {
    // Fetch comments
    mockRepoInfo();
    vi.mocked(execSync).mockReturnValueOnce(JSON.stringify([
      makeRawComment({ id: 1 }),
      makeRawComment({ id: 2 }),
      makeRawComment({ id: 3 }),
    ]));
    // Delete comment 1 - success
    mockRepoInfo();
    vi.mocked(execSync).mockReturnValueOnce('');
    // Delete comment 2 - fail (getRepoInfo succeeds, delete throws)
    mockRepoInfo();
    vi.mocked(execSync).mockImplementationOnce(() => {
      throw new Error('Server error');
    });
    // Delete comment 3 - success
    mockRepoInfo();
    vi.mocked(execSync).mockReturnValueOnce('');

    const result = clearIssueComments(10);

    expect(result).toEqual({ total: 3, deleted: 2, failed: 1 });
  });
});
