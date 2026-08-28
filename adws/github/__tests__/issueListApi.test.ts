import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RepoInfo } from '../githubApi';

const fakeCtx = { marker: 'fake-context' };

vi.mock('../gitContextFactory', () => ({
  gitContextForRepo: vi.fn(() => fakeCtx),
}));

const mockListOpenIssues = vi.fn();
const mockIssueComments = vi.fn();
vi.mock('../../providers/github/ghRepoApi', () => ({
  createGhRepoApi: vi.fn(() => ({ listOpenIssues: mockListOpenIssues, issueComments: mockIssueComments })),
}));

import { listIssues, fetchIssueCommentBodies } from '../issueListApi';
import { gitContextForRepo } from '../gitContextFactory';
import { createGhRepoApi } from '../../providers/github/ghRepoApi';

const repoInfo: RepoInfo = { owner: 'acme', repo: 'widgets' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listIssues', () => {
  it('binds createGhRepoApi to gitContextForRepo(repoInfo) and passes the query through unchanged', () => {
    mockListOpenIssues.mockReturnValue('[]');

    listIssues({ fields: ['number', 'body'], state: 'all', search: 'label:"x"', limit: 200 }, repoInfo);

    expect(gitContextForRepo).toHaveBeenCalledWith(repoInfo);
    expect(createGhRepoApi).toHaveBeenCalledWith(fakeCtx);
    expect(mockListOpenIssues).toHaveBeenCalledWith({ fields: ['number', 'body'], state: 'all', search: 'label:"x"', limit: 200 });
  });

  it('parses the JSON payload and returns it', () => {
    mockListOpenIssues.mockReturnValue('[{"number":42,"body":"hello"}]');

    const result = listIssues({ fields: ['number', 'body'] }, repoInfo);

    expect(result).toEqual([{ number: 42, body: 'hello' }]);
  });

  it('throws when the underlying operation throws (no swallow)', () => {
    mockListOpenIssues.mockImplementation(() => { throw new Error('gh: rate limited'); });

    expect(() => listIssues({ fields: ['number'] }, repoInfo)).toThrow('gh: rate limited');
  });
});

describe('fetchIssueCommentBodies', () => {
  it('binds createGhRepoApi to gitContextForRepo(repoInfo) and requests the issue number given', () => {
    mockIssueComments.mockReturnValue('[]');

    fetchIssueCommentBodies(42, repoInfo);

    expect(gitContextForRepo).toHaveBeenCalledWith(repoInfo);
    expect(mockIssueComments).toHaveBeenCalledWith(42);
  });

  it('parses the JSON payload and returns it', () => {
    mockIssueComments.mockReturnValue('[{"body":"aaaaaa-old"},{"body":"zzzzzz-new"}]');

    const result = fetchIssueCommentBodies(42, repoInfo);

    expect(result).toEqual([{ body: 'aaaaaa-old' }, { body: 'zzzzzz-new' }]);
  });

  it('throws when the underlying operation throws (no swallow)', () => {
    mockIssueComments.mockImplementation(() => { throw new Error('gh: not found'); });

    expect(() => fetchIssueCommentBodies(42, repoInfo)).toThrow('gh: not found');
  });
});
