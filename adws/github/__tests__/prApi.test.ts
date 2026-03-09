import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('../../core/utils', () => ({
  log: vi.fn(),
}));

vi.mock('../../core/targetRepoRegistry', () => ({
  getTargetRepo: vi.fn(() => ({ owner: 'test-owner', repo: 'test-repo' })),
}));

import { execSync } from 'child_process';
import {
  fetchPRDetails,
  fetchPRReviewComments,
  commentOnPR,
  fetchPRList,
} from '../prApi';

function makeRawPR(overrides: Record<string, unknown> = {}) {
  return {
    number: 10,
    title: 'feat: add login',
    body: 'Implements #42\n\nSome description',
    state: 'OPEN',
    headRefName: 'feat-issue-42-login',
    baseRefName: 'main',
    url: 'https://github.com/test-owner/test-repo/pull/10',
    ...overrides,
  };
}

describe('fetchPRDetails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches and transforms PR details', () => {
    vi.mocked(execSync).mockReturnValue(JSON.stringify(makeRawPR()));

    const result = fetchPRDetails(10);

    expect(result.number).toBe(10);
    expect(result.title).toBe('feat: add login');
    expect(result.headBranch).toBe('feat-issue-42-login');
    expect(result.baseBranch).toBe('main');
    expect(result.issueNumber).toBe(42);
    expect(result.reviewComments).toEqual([]);
  });

  it('extracts issue number from PR body', () => {
    vi.mocked(execSync).mockReturnValue(JSON.stringify(makeRawPR({ body: 'Implements #99' })));

    const result = fetchPRDetails(10);

    expect(result.issueNumber).toBe(99);
  });

  it('returns null issueNumber when no match in body', () => {
    vi.mocked(execSync).mockReturnValue(JSON.stringify(makeRawPR({ body: 'No issue reference' })));

    const result = fetchPRDetails(10);

    expect(result.issueNumber).toBeNull();
  });

  it('handles empty body', () => {
    vi.mocked(execSync).mockReturnValue(JSON.stringify(makeRawPR({ body: undefined })));

    const result = fetchPRDetails(10);

    expect(result.body).toBe('');
    expect(result.issueNumber).toBeNull();
  });

  it('uses provided repoInfo', () => {
    vi.mocked(execSync).mockReturnValue(JSON.stringify(makeRawPR()));

    fetchPRDetails(10, { owner: 'custom', repo: 'proj' });

    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('--repo custom/proj'),
      { encoding: 'utf-8' },
    );
  });

  it('throws on CLI failure', () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error('gh failed'); });

    expect(() => fetchPRDetails(10)).toThrow('Failed to fetch PR #10');
  });
});

describe('fetchPRReviewComments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('combines line comments and review body comments', () => {
    const lineComments = [
      {
        id: 1,
        body: 'Fix this line',
        path: 'src/app.ts',
        line: 10,
        original_line: null,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
        user: { login: 'reviewer', type: 'User' },
      },
    ];
    const reviews = [
      {
        id: 2,
        state: 'CHANGES_REQUESTED',
        body: 'Please refactor',
        submitted_at: '2025-01-02T00:00:00Z',
        user: { login: 'reviewer', type: 'User' },
      },
    ];

    vi.mocked(execSync)
      .mockReturnValueOnce(JSON.stringify(lineComments))   // line comments
      .mockReturnValueOnce(JSON.stringify(reviews));         // reviews

    const result = fetchPRReviewComments(10);

    expect(result).toHaveLength(2);
    expect(result[0].body).toBe('Fix this line');
    expect(result[0].path).toBe('src/app.ts');
    expect(result[1].body).toBe('Please refactor');
  });

  it('returns only reviews when line comment fetch fails', () => {
    const reviews = [
      { id: 2, state: 'COMMENTED', body: 'Nice work', submitted_at: '2025-01-02T00:00:00Z', user: { login: 'r' } },
    ];

    vi.mocked(execSync)
      .mockImplementationOnce(() => { throw new Error('fail'); })  // line comments fail
      .mockReturnValueOnce(JSON.stringify(reviews));                // reviews succeed

    const result = fetchPRReviewComments(10);

    expect(result).toHaveLength(1);
    expect(result[0].body).toBe('Nice work');
  });

  it('identifies bot users', () => {
    const lineComments = [
      {
        id: 1, body: 'Auto comment', path: '', line: null, original_line: null,
        created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z',
        user: { login: 'bot-user', type: 'Bot' },
      },
    ];

    vi.mocked(execSync)
      .mockReturnValueOnce(JSON.stringify(lineComments))
      .mockReturnValueOnce(JSON.stringify([]));

    const result = fetchPRReviewComments(10);

    expect(result[0].author.isBot).toBe(true);
  });
});

describe('commentOnPR', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts a comment via body-file stdin', () => {
    vi.mocked(execSync).mockReturnValue('');

    commentOnPR(10, 'PR comment body');

    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('gh pr comment 10 --repo test-owner/test-repo --body-file -'),
      expect.objectContaining({ input: 'PR comment body' }),
    );
  });

  it('does not throw on failure', () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error('fail'); });

    expect(() => commentOnPR(10, 'body')).not.toThrow();
  });
});

describe('fetchPRList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns mapped PR list items', () => {
    const raw = [
      { number: 1, headRefName: 'feat-a', updatedAt: '2025-01-01T00:00:00Z' },
      { number: 2, headRefName: 'fix-b', updatedAt: '2025-01-02T00:00:00Z' },
    ];
    vi.mocked(execSync).mockReturnValue(JSON.stringify(raw));

    const result = fetchPRList();

    expect(result).toHaveLength(2);
    expect(result[0].number).toBe(1);
    expect(result[0].headBranch).toBe('feat-a');
    expect(result[1].number).toBe(2);
  });

  it('returns empty array on CLI failure', () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error('fail'); });

    const result = fetchPRList();

    expect(result).toEqual([]);
  });
});
