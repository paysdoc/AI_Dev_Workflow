import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../github/prApi', () => ({
  fetchPRDetails: vi.fn(),
  fetchPRReviewComments: vi.fn(),
  commentOnPR: vi.fn(),
  fetchPRList: vi.fn(),
  defaultFindPRByBranch: vi.fn(),
  fetchPRApprovalState: vi.fn(),
  approvePR: vi.fn(),
  mergePR: vi.fn(),
}));

const mockSetSecret = vi.fn();
vi.mock('../../../github/gitContextFactory', () => ({
  gitContextForSync: vi.fn(),
  gitContextForRepo: vi.fn(() => ({ setSecret: mockSetSecret, findPRByBranch: vi.fn(), createPR: vi.fn() })),
}));

const mockFetchMergedPRs = vi.fn();
vi.mock('../ghRepoApi', () => ({
  // setSecret is included so the existing setSecret test below (which asserts on
  // mockSetSecret) keeps passing now that GitHubCodeHost.setSecret routes through
  // createGhRepoApi(gitContextForRepo(...)).setSecret(...) instead of calling
  // gitContextForRepo(...).setSecret(...) directly (#797). createPullRequest and
  // getDefaultBranch also now route through createGhRepoApi, but neither has test
  // coverage in this file, so no fake methods are added for findPRByBranch/createPR/
  // defaultBranch.
  createGhRepoApi: vi.fn(() => ({ fetchMergedPRs: mockFetchMergedPRs, setSecret: mockSetSecret })),
}));

import { createGitHubCodeHost } from '../githubCodeHost';
import { mapRawPRToSummary } from '../mappers';
import { Platform, type RepoIdentifier } from '../../types';
import {
  defaultFindPRByBranch,
  fetchPRApprovalState,
  approvePR,
  mergePR,
} from '../../../github/prApi';

const REPO_ID: RepoIdentifier = { owner: 'acme', repo: 'widget', platform: Platform.GitHub };
const REPO_INFO = { owner: 'acme', repo: 'widget' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GitHubCodeHost — new method delegation', () => {
  it('findPullRequestByBranch delegates to defaultFindPRByBranch and maps the result', () => {
    vi.mocked(defaultFindPRByBranch).mockReturnValue({
      number: 7, state: 'OPEN', headRefName: 'feature-x', baseRefName: 'main', labels: [{ name: 'hitl' }],
    });
    const codeHost = createGitHubCodeHost(REPO_ID);

    const result = codeHost.findPullRequestByBranch('feature-x');

    expect(defaultFindPRByBranch).toHaveBeenCalledTimes(1);
    expect(defaultFindPRByBranch).toHaveBeenCalledWith('feature-x', REPO_INFO);
    expect(result).toEqual({ number: 7, state: 'OPEN', sourceBranch: 'feature-x', targetBranch: 'main', labels: ['hitl'] });
  });

  it('findPullRequestByBranch returns null when no PR is found', () => {
    vi.mocked(defaultFindPRByBranch).mockReturnValue(null);
    const codeHost = createGitHubCodeHost(REPO_ID);

    expect(codeHost.findPullRequestByBranch('feature-x')).toBeNull();
  });

  it('isPullRequestApproved delegates to fetchPRApprovalState with the bound repoInfo', () => {
    vi.mocked(fetchPRApprovalState).mockReturnValue(true);
    const codeHost = createGitHubCodeHost(REPO_ID);

    const result = codeHost.isPullRequestApproved(7);

    expect(fetchPRApprovalState).toHaveBeenCalledTimes(1);
    expect(fetchPRApprovalState).toHaveBeenCalledWith(7, REPO_INFO);
    expect(result).toBe(true);
  });

  it('approvePullRequest delegates to approvePR and returns its value unchanged', () => {
    vi.mocked(approvePR).mockReturnValue({ success: true });
    const codeHost = createGitHubCodeHost(REPO_ID);

    const result = codeHost.approvePullRequest(7);

    expect(approvePR).toHaveBeenCalledTimes(1);
    expect(approvePR).toHaveBeenCalledWith(7, REPO_INFO);
    expect(result).toEqual({ success: true });
  });

  it('mergePullRequest delegates to mergePR and returns its value unchanged', () => {
    vi.mocked(mergePR).mockReturnValue({ success: false, error: 'conflict' });
    const codeHost = createGitHubCodeHost(REPO_ID);

    const result = codeHost.mergePullRequest(7);

    expect(mergePR).toHaveBeenCalledTimes(1);
    expect(mergePR).toHaveBeenCalledWith(7, REPO_INFO);
    expect(result).toEqual({ success: false, error: 'conflict' });
  });

  it('setSecret delegates to createGhRepoApi(gitContextForRepo(repoInfo)).setSecret', () => {
    const codeHost = createGitHubCodeHost(REPO_ID);

    codeHost.setSecret('SOCKET_API_TOKEN', 'sktsec_abc');

    expect(mockSetSecret).toHaveBeenCalledTimes(1);
    expect(mockSetSecret).toHaveBeenCalledWith('SOCKET_API_TOKEN', 'sktsec_abc');
  });

  it('listMergedPullRequests parses createGhRepoApi(...).fetchMergedPRs(limit) and returns it unchanged', () => {
    mockFetchMergedPRs.mockReturnValue(JSON.stringify([{ body: 'Closes #1', mergedAt: '2024-01-01' }]));
    const codeHost = createGitHubCodeHost(REPO_ID);

    const result = codeHost.listMergedPullRequests(200);

    expect(mockFetchMergedPRs).toHaveBeenCalledTimes(1);
    expect(mockFetchMergedPRs).toHaveBeenCalledWith(200);
    expect(result).toEqual([{ body: 'Closes #1', mergedAt: '2024-01-01' }]);
  });

  it('listMergedPullRequests rethrows when fetchMergedPRs throws', () => {
    mockFetchMergedPRs.mockImplementation(() => { throw new Error('gh: rate limited'); });
    const codeHost = createGitHubCodeHost(REPO_ID);

    expect(() => codeHost.listMergedPullRequests(200)).toThrow('gh: rate limited');
  });
});

describe('mapRawPRToSummary', () => {
  it('flattens labels to a string array', () => {
    const summary = mapRawPRToSummary({
      number: 7, state: 'OPEN', headRefName: 'feature-x', baseRefName: 'main',
      labels: [{ name: 'hitl' }, { name: 'wontfix' }],
    });
    expect(summary).toEqual({ number: 7, state: 'OPEN', sourceBranch: 'feature-x', targetBranch: 'main', labels: ['hitl', 'wontfix'] });
  });

  it('defaults a missing labels field to an empty array', () => {
    const summary = mapRawPRToSummary({ number: 7, state: 'MERGED', headRefName: 'feature-x', baseRefName: 'main' });
    expect(summary.labels).toEqual([]);
  });
});
