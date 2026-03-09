import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PullRequestWebhookPayload } from '../../core';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('../../core/utils', () => ({
  log: vi.fn(),
}));

vi.mock('../../github/githubApi', () => ({
  closeIssue: vi.fn(() => Promise.resolve(true)),
  formatIssueClosureComment: vi.fn(() => 'Closed by PR'),
}));

vi.mock('../../github/worktreeOperations', () => ({
  removeWorktree: vi.fn(() => true),
}));

vi.mock('../../github/gitOperations', () => ({
  deleteRemoteBranch: vi.fn(() => true),
  commitAndPushCostFiles: vi.fn(() => true),
  pullLatestCostBranch: vi.fn(),
}));

vi.mock('../../core/targetRepoRegistry', () => ({
  hasTargetRepo: vi.fn(() => false),
}));

vi.mock('../../core/targetRepoManager', () => ({
  getTargetRepoWorkspacePath: vi.fn((owner: string, repo: string) => `/mock/repos/${owner}/${repo}`),
}));

vi.mock('../../core/costCsvWriter', () => ({
  rebuildProjectCostCsv: vi.fn(),
  getIssueCsvPath: vi.fn(),
  getProjectCsvPath: vi.fn((repoName: string) => `projects/${repoName}/total-cost.csv`),
  formatIssueCostCsv: vi.fn(),
  formatProjectCostCsv: vi.fn(),
  parseProjectCostCsv: vi.fn(),
  writeIssueCostCsv: vi.fn(),
  parseIssueCostTotal: vi.fn(),
}));

vi.mock('../../core/costReport', () => ({
  fetchExchangeRates: vi.fn(() => Promise.resolve({ EUR: 0.92 })),
}));

vi.mock('../../core/costCommitQueue', () => ({
  costCommitQueue: {
    enqueue: vi.fn((fn: () => Promise<void>) => fn()),
  },
}));

import { removeWorktree } from '../../github/worktreeOperations';
import { deleteRemoteBranch, commitAndPushCostFiles, pullLatestCostBranch } from '../../github/gitOperations';
import { closeIssue } from '../../github/githubApi';
import { hasTargetRepo } from '../../core/targetRepoRegistry';
import { rebuildProjectCostCsv } from '../../core/costCsvWriter';
import { fetchExchangeRates } from '../../core/costReport';
import {
  handlePullRequestEvent,
  extractIssueNumberFromPRBody,
  extractIssueNumberFromBranch,
  recordMergedPrIssue,
  wasMergedViaPR,
  resetMergedPrIssues,
} from '../webhookHandlers';

function createPayload(overrides: Partial<PullRequestWebhookPayload> = {}): PullRequestWebhookPayload {
  return {
    action: 'closed',
    pull_request: {
      number: 1,
      state: 'closed',
      merged: true,
      body: 'Implements #42',
      html_url: 'https://github.com/owner/repo/pull/1',
      title: 'Add feature',
      base: { ref: 'main' },
      head: { ref: 'feature/issue-42-add-login' },
    },
    repository: {
      name: 'repo',
      owner: { login: 'owner' },
      full_name: 'owner/repo',
    },
    ...overrides,
  };
}

describe('extractIssueNumberFromPRBody', () => {
  it('extracts issue number from valid PR body', () => {
    expect(extractIssueNumberFromPRBody('Implements #42')).toBe(42);
  });

  it('returns null for null body', () => {
    expect(extractIssueNumberFromPRBody(null)).toBeNull();
  });

  it('returns null when no pattern matches', () => {
    expect(extractIssueNumberFromPRBody('No issue reference')).toBeNull();
  });
});

describe('extractIssueNumberFromBranch', () => {
  it('extracts issue number from feature branch', () => {
    expect(extractIssueNumberFromBranch('feature/issue-42-add-login')).toBe(42);
  });

  it('extracts issue number from bugfix branch', () => {
    expect(extractIssueNumberFromBranch('bugfix/issue-99-fix-currency-conversion')).toBe(99);
  });

  it('returns null for branch without issue pattern', () => {
    expect(extractIssueNumberFromBranch('feature/random-branch')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(extractIssueNumberFromBranch(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractIssueNumberFromBranch('')).toBeNull();
  });
});

describe('handlePullRequestEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMergedPrIssues();
  });

  it('calls removeWorktree and deleteRemoteBranch when PR is closed', async () => {
    vi.mocked(hasTargetRepo).mockReturnValue(false);
    const payload = createPayload();

    await handlePullRequestEvent(payload);

    expect(removeWorktree).toHaveBeenCalledWith('feature/issue-42-add-login', undefined);
    expect(deleteRemoteBranch).toHaveBeenCalledWith('feature/issue-42-add-login', undefined);
  });

  it('passes target repo cwd to removeWorktree and deleteRemoteBranch when registry is set', async () => {
    vi.mocked(hasTargetRepo).mockReturnValue(true);
    const payload = createPayload();

    await handlePullRequestEvent(payload);

    expect(removeWorktree).toHaveBeenCalledWith('feature/issue-42-add-login', '/mock/repos/owner/repo');
    expect(deleteRemoteBranch).toHaveBeenCalledWith('feature/issue-42-add-login', '/mock/repos/owner/repo');
  });

  it('handles missing headBranch gracefully', async () => {
    const payload = createPayload({
      pull_request: {
        number: 1,
        state: 'closed',
        merged: true,
        body: 'Implements #42',
        html_url: 'https://github.com/owner/repo/pull/1',
        title: 'Add feature',
        base: { ref: 'main' },
        head: { ref: '' },
      },
    });

    const result = await handlePullRequestEvent(payload);

    expect(removeWorktree).not.toHaveBeenCalled();
    expect(deleteRemoteBranch).not.toHaveBeenCalled();
    expect(result.status).toBe('closed');
  });

  it('does not fail if remote branch deletion fails', async () => {
    vi.mocked(deleteRemoteBranch).mockImplementation(() => {
      throw new Error('network error');
    });

    const payload = createPayload();

    const result = await handlePullRequestEvent(payload);

    // Should still close the issue successfully
    expect(closeIssue).toHaveBeenCalledWith(42, expect.any(String), { owner: 'owner', repo: 'repo' });
    expect(result.status).toBe('closed');
  });

  it('ignores non-closed PR events', async () => {
    const payload = createPayload({ action: 'opened' });

    const result = await handlePullRequestEvent(payload);

    expect(result.status).toBe('ignored');
    expect(removeWorktree).not.toHaveBeenCalled();
    expect(deleteRemoteBranch).not.toHaveBeenCalled();
  });

  it('extracts issue number and closes linked issue', async () => {
    const payload = createPayload();

    const result = await handlePullRequestEvent(payload);

    expect(closeIssue).toHaveBeenCalledWith(42, expect.any(String), { owner: 'owner', repo: 'repo' });
    expect(result).toEqual({ status: 'closed', issue: 42 });
  });

  it('calls pullLatestCostBranch before cost operations for merged PRs', async () => {
    const payload = createPayload();
    const callOrder: string[] = [];
    vi.mocked(pullLatestCostBranch).mockImplementation(() => { callOrder.push('pull'); });
    vi.mocked(rebuildProjectCostCsv).mockImplementation(() => { callOrder.push('rebuild'); });
    vi.mocked(commitAndPushCostFiles).mockImplementation(() => { callOrder.push('commit'); return true; });

    await handlePullRequestEvent(payload);

    expect(pullLatestCostBranch).toHaveBeenCalled();
    expect(fetchExchangeRates).toHaveBeenCalledWith(['EUR']);
    expect(rebuildProjectCostCsv).toHaveBeenCalledWith(process.cwd(), 'repo', 0.92);
    expect(commitAndPushCostFiles).toHaveBeenCalledWith({ repoName: 'repo' });
    expect(callOrder).toEqual(['pull', 'rebuild', 'commit']);
  });

  it('calls rebuildProjectCostCsv and commitAndPushCostFiles for closed-without-merge PRs', async () => {
    const payload = createPayload({
      pull_request: {
        number: 1,
        state: 'closed',
        merged: false,
        body: 'Implements #42',
        html_url: 'https://github.com/owner/repo/pull/1',
        title: 'Add feature',
        base: { ref: 'main' },
        head: { ref: 'feature/issue-42-add-login' },
      },
    });
    const callOrder: string[] = [];
    vi.mocked(rebuildProjectCostCsv).mockImplementation(() => { callOrder.push('rebuild'); });
    vi.mocked(commitAndPushCostFiles).mockImplementation(() => { callOrder.push('commit'); return true; });

    await handlePullRequestEvent(payload);

    expect(rebuildProjectCostCsv).toHaveBeenCalledWith(process.cwd(), 'repo', 0.92);
    expect(commitAndPushCostFiles).toHaveBeenCalledWith({ repoName: 'repo' });
    expect(callOrder).toEqual(['rebuild', 'commit']);
  });

  it('does not call commitAndPushCostFiles when PR action is not closed', async () => {
    const payload = createPayload({ action: 'opened' });

    await handlePullRequestEvent(payload);

    expect(commitAndPushCostFiles).not.toHaveBeenCalled();
  });

  it('does not call commitAndPushCostFiles when no issue link found', async () => {
    const payload = createPayload({
      pull_request: {
        number: 1,
        state: 'closed',
        merged: true,
        body: 'No issue reference here',
        html_url: 'https://github.com/owner/repo/pull/1',
        title: 'Add feature',
        base: { ref: 'main' },
        head: { ref: 'feature/random-branch' },
      },
    });

    await handlePullRequestEvent(payload);

    expect(commitAndPushCostFiles).not.toHaveBeenCalled();
  });

  it('falls back to branch name for issue extraction when PR body has no Implements #N (merged PR)', async () => {
    vi.mocked(fetchExchangeRates).mockResolvedValue({ EUR: 0.92 });
    vi.mocked(commitAndPushCostFiles).mockReturnValue(true);
    const payload = createPayload({
      pull_request: {
        number: 10,
        state: 'closed',
        merged: true,
        body: 'Some PR description without issue link',
        html_url: 'https://github.com/owner/repo/pull/10',
        title: 'Some feature',
        base: { ref: 'main' },
        head: { ref: 'feature/issue-55-some-feature' },
      },
    });

    const result = await handlePullRequestEvent(payload);

    expect(rebuildProjectCostCsv).toHaveBeenCalledWith(process.cwd(), 'repo', 0.92);
    expect(commitAndPushCostFiles).toHaveBeenCalledWith({ repoName: 'repo' });
    expect(wasMergedViaPR(55)).toBe(true);
    expect(result).toEqual({ status: 'closed', issue: 55 });
  });

  it('falls back to branch name for issue extraction when PR body has no Implements #N (closed without merge)', async () => {
    vi.mocked(fetchExchangeRates).mockResolvedValue({ EUR: 0.92 });
    vi.mocked(commitAndPushCostFiles).mockReturnValue(true);
    const payload = createPayload({
      pull_request: {
        number: 10,
        state: 'closed',
        merged: false,
        body: 'Some PR description without issue link',
        html_url: 'https://github.com/owner/repo/pull/10',
        title: 'Some fix',
        base: { ref: 'main' },
        head: { ref: 'bugfix/issue-55-some-fix' },
      },
    });

    const result = await handlePullRequestEvent(payload);

    expect(rebuildProjectCostCsv).toHaveBeenCalledWith(process.cwd(), 'repo', 0.92);
    expect(commitAndPushCostFiles).toHaveBeenCalledWith({ repoName: 'repo' });
    expect(wasMergedViaPR(55)).toBe(false);
    expect(result).toEqual({ status: 'closed', issue: 55 });
  });

  it('still succeeds when cost operations throw', async () => {
    vi.mocked(fetchExchangeRates).mockRejectedValue(new Error('network error'));

    const payload = createPayload();

    const result = await handlePullRequestEvent(payload);

    expect(result.status).toBe('closed');
    expect(result.issue).toBe(42);
  });

  it('still succeeds when commitAndPushCostFiles throws', async () => {
    vi.mocked(commitAndPushCostFiles).mockImplementation(() => {
      throw new Error('git push failed');
    });

    const payload = createPayload();

    const result = await handlePullRequestEvent(payload);

    expect(result.status).toBe('closed');
    expect(result.issue).toBe(42);
  });

  it('uses eurRate of 0 when fetchExchangeRates returns empty map', async () => {
    vi.mocked(fetchExchangeRates).mockResolvedValue({});

    const payload = createPayload();

    await handlePullRequestEvent(payload);

    expect(rebuildProjectCostCsv).toHaveBeenCalledWith(process.cwd(), 'repo', 0);
  });

  it('calls recordMergedPrIssue after successful merged PR cost commit', async () => {
    vi.mocked(fetchExchangeRates).mockResolvedValue({ EUR: 0.92 });
    vi.mocked(commitAndPushCostFiles).mockReturnValue(true);
    const payload = createPayload();

    await handlePullRequestEvent(payload);

    // The issue should now be recorded as merged
    expect(wasMergedViaPR(42)).toBe(true);
  });

  it('does NOT record merged PR issue for closed-without-merge PRs', async () => {
    vi.mocked(fetchExchangeRates).mockResolvedValue({ EUR: 0.92 });
    vi.mocked(commitAndPushCostFiles).mockReturnValue(true);
    const payload = createPayload({
      pull_request: {
        number: 1,
        state: 'closed',
        merged: false,
        body: 'Implements #42',
        html_url: 'https://github.com/owner/repo/pull/1',
        title: 'Add feature',
        base: { ref: 'main' },
        head: { ref: 'feature/issue-42-add-login' },
      },
    });

    await handlePullRequestEvent(payload);

    expect(wasMergedViaPR(42)).toBe(false);
  });
});

describe('mergedPrIssues tracking', () => {
  beforeEach(() => {
    resetMergedPrIssues();
  });

  it('records an issue number and wasMergedViaPR returns true', () => {
    recordMergedPrIssue(91);
    expect(wasMergedViaPR(91)).toBe(true);
  });

  it('returns false for an unrecorded issue number', () => {
    expect(wasMergedViaPR(99)).toBe(false);
  });

  it('does NOT consume the entry — returns true on repeated calls', () => {
    recordMergedPrIssue(91);
    expect(wasMergedViaPR(91)).toBe(true);
    expect(wasMergedViaPR(91)).toBe(true);
  });
});
