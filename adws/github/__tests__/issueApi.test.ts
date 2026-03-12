import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('../../core/utils', () => ({
  log: vi.fn(),
}));

import { execSync } from 'child_process';
import {
  fetchGitHubIssue,
  commentOnIssue,
  formatIssueClosureComment,
  getIssueState,
  closeIssue,
  getIssueTitleSync,
  fetchIssueCommentsRest,
  deleteIssueComment,
} from '../issueApi';

const testRepoInfo = { owner: 'test-owner', repo: 'test-repo' };

function makeRawIssue(overrides: Record<string, unknown> = {}) {
  return {
    number: 42,
    title: 'Test issue',
    body: 'Issue body',
    state: 'OPEN',
    author: { login: 'alice', name: 'Alice', is_bot: false },
    assignees: [],
    labels: [{ name: 'bug', color: 'ff0000' }],
    milestone: null,
    comments: [],
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-02T00:00:00Z',
    closedAt: null,
    url: 'https://github.com/test-owner/test-repo/issues/42',
    ...overrides,
  };
}

describe('fetchGitHubIssue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches and transforms an issue', async () => {
    const raw = makeRawIssue();
    vi.mocked(execSync).mockReturnValue(JSON.stringify(raw));

    const result = await fetchGitHubIssue(42, testRepoInfo);

    expect(result.number).toBe(42);
    expect(result.title).toBe('Test issue');
    expect(result.author.login).toBe('alice');
    expect(result.labels).toHaveLength(1);
    expect(result.labels[0].name).toBe('bug');
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('gh issue view 42 --repo test-owner/test-repo'),
      { encoding: 'utf-8' },
    );
  });

  it('uses provided repoInfo when given', async () => {
    vi.mocked(execSync).mockReturnValue(JSON.stringify(makeRawIssue()));

    await fetchGitHubIssue(42, { owner: 'custom', repo: 'proj' });

    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('--repo custom/proj'),
      { encoding: 'utf-8' },
    );
  });

  it('handles missing optional fields gracefully', async () => {
    const raw = makeRawIssue({ body: undefined, author: undefined, assignees: undefined, labels: undefined, comments: undefined });
    vi.mocked(execSync).mockReturnValue(JSON.stringify(raw));

    const result = await fetchGitHubIssue(42, testRepoInfo);

    expect(result.body).toBe('');
    expect(result.author.login).toBe('unknown');
    expect(result.assignees).toEqual([]);
    expect(result.labels).toEqual([]);
    expect(result.comments).toEqual([]);
  });

  it('transforms milestone when present', async () => {
    const raw = makeRawIssue({
      milestone: { id: 'm1', number: 3, title: 'v1.0', description: null, state: 'open' },
    });
    vi.mocked(execSync).mockReturnValue(JSON.stringify(raw));

    const result = await fetchGitHubIssue(42, testRepoInfo);

    expect(result.milestone).toEqual({
      id: 'm1', number: 3, title: 'v1.0', description: null, state: 'open',
    });
  });

  it('throws on CLI failure', async () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error('gh failed'); });

    await expect(fetchGitHubIssue(42, testRepoInfo)).rejects.toThrow('Failed to fetch issue #42');
  });
});

describe('commentOnIssue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts a comment using body-file via stdin', () => {
    vi.mocked(execSync).mockReturnValue('');

    commentOnIssue(42, 'Hello world', testRepoInfo);

    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('gh issue comment 42 --repo test-owner/test-repo --body-file -'),
      expect.objectContaining({ input: 'Hello world' }),
    );
  });

  it('does not throw on failure (logs instead)', () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error('comment failed'); });

    expect(() => commentOnIssue(42, 'Hello', testRepoInfo)).not.toThrow();
  });
});

describe('formatIssueClosureComment', () => {
  it('formats merged closure comment', () => {
    const result = formatIssueClosureComment(10, 'https://github.com/o/r/pull/10', true);

    expect(result).toContain('ADW Workflow Complete');
    expect(result).toContain('merged');
    expect(result).toContain('PR #10');
    expect(result).toContain('https://github.com/o/r/pull/10');
  });

  it('formats non-merged closure comment', () => {
    const result = formatIssueClosureComment(10, 'https://github.com/o/r/pull/10', false);

    expect(result).toContain('closed without merging');
  });
});

describe('getIssueState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns issue state string', () => {
    vi.mocked(execSync).mockReturnValue(JSON.stringify({ state: 'OPEN' }));

    expect(getIssueState(42, testRepoInfo)).toBe('OPEN');
  });

  it('throws on CLI failure', () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error('gh failed'); });

    expect(() => getIssueState(42, testRepoInfo)).toThrow();
  });
});

describe('closeIssue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('closes an open issue and returns true', async () => {
    vi.mocked(execSync)
      .mockReturnValueOnce(JSON.stringify({ state: 'OPEN' }))  // getIssueState
      .mockReturnValueOnce('');                                  // gh issue close

    const result = await closeIssue(42, testRepoInfo);

    expect(result).toBe(true);
  });

  it('returns false if issue is already closed', async () => {
    vi.mocked(execSync).mockReturnValue(JSON.stringify({ state: 'CLOSED' }));

    const result = await closeIssue(42, testRepoInfo);

    expect(result).toBe(false);
  });

  it('posts comment before closing when provided', async () => {
    vi.mocked(execSync)
      .mockReturnValueOnce(JSON.stringify({ state: 'OPEN' }))  // getIssueState
      .mockReturnValueOnce('')                                   // commentOnIssue
      .mockReturnValueOnce('');                                  // gh issue close

    await closeIssue(42, testRepoInfo, 'Closing comment');

    expect(execSync).toHaveBeenCalledTimes(3);
  });

  it('returns false on error', async () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error('fail'); });

    const result = await closeIssue(42, testRepoInfo);

    expect(result).toBe(false);
  });
});

describe('getIssueTitleSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns issue title', () => {
    vi.mocked(execSync).mockReturnValue(JSON.stringify({ title: 'My Issue' }));

    expect(getIssueTitleSync(42, testRepoInfo)).toBe('My Issue');
  });

  it('returns (unknown) on error', () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error('fail'); });

    expect(getIssueTitleSync(42, testRepoInfo)).toBe('(unknown)');
  });
});

describe('fetchIssueCommentsRest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses REST API comments into summary format', () => {
    const raw = [
      { id: 100, body: 'comment 1', user: { login: 'bob' }, created_at: '2025-01-01T00:00:00Z' },
      { id: 101, body: 'comment 2', user: { login: 'alice' }, created_at: '2025-01-02T00:00:00Z' },
    ];
    vi.mocked(execSync).mockReturnValue(JSON.stringify(raw));

    const result = fetchIssueCommentsRest(42, testRepoInfo);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(100);
    expect(result[0].authorLogin).toBe('bob');
    expect(result[1].id).toBe(101);
  });

  it('throws on CLI failure', () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error('fail'); });

    expect(() => fetchIssueCommentsRest(42, testRepoInfo)).toThrow('Failed to fetch comments for issue #42');
  });
});

describe('deleteIssueComment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes a comment by ID', () => {
    vi.mocked(execSync).mockReturnValue('');

    deleteIssueComment(100, testRepoInfo);

    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('gh api -X DELETE repos/test-owner/test-repo/issues/comments/100'),
      expect.any(Object),
    );
  });

  it('throws on failure', () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error('fail'); });

    expect(() => deleteIssueComment(100, testRepoInfo)).toThrow('Failed to delete comment 100');
  });
});
