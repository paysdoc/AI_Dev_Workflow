import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('../core/utils', () => ({
  log: vi.fn(),
}));

import { execSync } from 'child_process';
import { log } from '../core/utils';
import { fetchIssueCommentsRest, deleteIssueComment } from '../github/githubApi';
import { clearIssueComments } from '../adwClearComments';
import type { RepoInfo } from '../github/githubApi';

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
    vi.mocked(execSync).mockReturnValueOnce(JSON.stringify([
      makeRawComment({ id: 1, body: 'first', user: { login: 'alice' }, created_at: '2025-01-01T00:00:00Z' }),
      makeRawComment({ id: 2, body: 'second', user: { login: 'bob' }, created_at: '2025-01-02T00:00:00Z' }),
    ]));

    const result = fetchIssueCommentsRest(42, { owner: 'test-owner', repo: 'test-repo' });

    expect(result).toEqual([
      { id: 1, body: 'first', authorLogin: 'alice', createdAt: '2025-01-01T00:00:00Z' },
      { id: 2, body: 'second', authorLogin: 'bob', createdAt: '2025-01-02T00:00:00Z' },
    ]);
  });

  it('returns empty array when no comments exist', () => {
    vi.mocked(execSync).mockReturnValueOnce(JSON.stringify([]));

    const result = fetchIssueCommentsRest(42, { owner: 'test-owner', repo: 'test-repo' });

    expect(result).toEqual([]);
  });

  it('throws on API error', () => {
    vi.mocked(execSync).mockImplementationOnce(() => {
      throw new Error('API error');
    });

    expect(() => fetchIssueCommentsRest(42, { owner: 'test-owner', repo: 'test-repo' })).toThrow('Failed to fetch comments for issue #42');
  });
});

describe('deleteIssueComment', () => {
  it('successfully deletes a comment', () => {
    vi.mocked(execSync).mockReturnValueOnce('');

    expect(() => deleteIssueComment(123, { owner: 'test-owner', repo: 'test-repo' })).not.toThrow();

    const deleteCall = vi.mocked(execSync).mock.calls[0];
    expect(deleteCall[0]).toContain('DELETE');
    expect(deleteCall[0]).toContain('issues/comments/123');
  });

  it('throws on API error', () => {
    vi.mocked(execSync).mockImplementationOnce(() => {
      throw new Error('Not found');
    });

    expect(() => deleteIssueComment(999, { owner: 'test-owner', repo: 'test-repo' })).toThrow('Failed to delete comment 999');
  });
});

describe('clearIssueComments', () => {
  it('deletes all comments and returns correct summary', () => {
    // getRepoInfo fallback (no repoInfo passed)
    mockRepoInfo();
    // fetchIssueCommentsRest
    vi.mocked(execSync).mockReturnValueOnce(JSON.stringify([
      makeRawComment({ id: 1, body: 'first comment body' }),
      makeRawComment({ id: 2, body: 'second comment' }),
    ]));
    // getIssueTitleSync
    vi.mocked(execSync).mockReturnValueOnce(JSON.stringify({ title: 'My Test Issue' }));
    // deleteIssueComment (comment 1)
    vi.mocked(execSync).mockReturnValueOnce('');
    // deleteIssueComment (comment 2)
    vi.mocked(execSync).mockReturnValueOnce('');

    const result = clearIssueComments(10);

    expect(result).toEqual({ total: 2, deleted: 2, failed: 0 });
  });

  it('handles issue with no comments gracefully', () => {
    // getRepoInfo fallback
    mockRepoInfo();
    // fetchIssueCommentsRest
    vi.mocked(execSync).mockReturnValueOnce(JSON.stringify([]));
    // getIssueTitleSync
    vi.mocked(execSync).mockReturnValueOnce(JSON.stringify({ title: 'Empty Issue' }));

    const result = clearIssueComments(10);

    expect(result).toEqual({ total: 0, deleted: 0, failed: 0 });
  });

  it('continues deleting when one deletion fails', () => {
    // getRepoInfo fallback
    mockRepoInfo();
    // fetchIssueCommentsRest
    vi.mocked(execSync).mockReturnValueOnce(JSON.stringify([
      makeRawComment({ id: 1, body: 'comment one' }),
      makeRawComment({ id: 2, body: 'comment two' }),
      makeRawComment({ id: 3, body: 'comment three' }),
    ]));
    // getIssueTitleSync
    vi.mocked(execSync).mockReturnValueOnce(JSON.stringify({ title: 'Failing Issue' }));
    // Delete comment 1 - success
    vi.mocked(execSync).mockReturnValueOnce('');
    // Delete comment 2 - fail
    vi.mocked(execSync).mockImplementationOnce(() => {
      throw new Error('Server error');
    });
    // Delete comment 3 - success
    vi.mocked(execSync).mockReturnValueOnce('');

    const result = clearIssueComments(10);

    expect(result).toEqual({ total: 3, deleted: 2, failed: 1 });
  });

  it('passes repoInfo to API calls without falling back to getRepoInfo', () => {
    const customRepo: RepoInfo = { owner: 'custom-owner', repo: 'custom-repo' };

    // fetchIssueCommentsRest with repoInfo — no getRepoInfo call needed
    vi.mocked(execSync).mockReturnValueOnce(JSON.stringify([
      makeRawComment({ id: 1, body: 'repo comment' }),
    ]));
    // getIssueTitleSync with repoInfo — no getRepoInfo call needed
    vi.mocked(execSync).mockReturnValueOnce(JSON.stringify({ title: 'External Issue' }));
    // deleteIssueComment with repoInfo — no getRepoInfo call needed
    vi.mocked(execSync).mockReturnValueOnce('');

    const result = clearIssueComments(5, customRepo);

    expect(result).toEqual({ total: 1, deleted: 1, failed: 0 });

    // Verify the fetch call uses custom repo
    const fetchCall = vi.mocked(execSync).mock.calls[0];
    expect(fetchCall[0]).toContain('custom-owner/custom-repo');

    // Verify the title call uses custom repo
    const titleCall = vi.mocked(execSync).mock.calls[1];
    expect(titleCall[0]).toContain('custom-owner/custom-repo');

    // Verify the delete call uses custom repo
    const deleteCall = vi.mocked(execSync).mock.calls[2];
    expect(deleteCall[0]).toContain('custom-owner/custom-repo');
  });

  it('logs issue title and comment body preview', () => {
    const customRepo: RepoInfo = { owner: 'log-owner', repo: 'log-repo' };

    // fetchIssueCommentsRest
    vi.mocked(execSync).mockReturnValueOnce(JSON.stringify([
      makeRawComment({ id: 1, body: 'Hello world this is a long comment' }),
    ]));
    // getIssueTitleSync
    vi.mocked(execSync).mockReturnValueOnce(JSON.stringify({ title: 'Bug Report' }));
    // deleteIssueComment
    vi.mocked(execSync).mockReturnValueOnce('');

    clearIssueComments(7, customRepo);

    const logCalls = vi.mocked(log).mock.calls.map((call) => call[0]);
    expect(logCalls).toContainEqual(expect.stringContaining('"Bug Report"'));
    expect(logCalls).toContainEqual(expect.stringContaining('"Hello worl..."'));
  });
});
