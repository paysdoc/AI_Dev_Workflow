import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PullRequestWebhookPayload } from '../core';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('../core/utils', () => ({
  log: vi.fn(),
}));

vi.mock('../github/githubApi', () => ({
  closeIssue: vi.fn(() => Promise.resolve(true)),
  formatIssueClosureComment: vi.fn(() => 'Closed by PR'),
}));

vi.mock('../github/worktreeOperations', () => ({
  removeWorktree: vi.fn(() => true),
}));

vi.mock('../github/gitOperations', () => ({
  deleteRemoteBranch: vi.fn(() => true),
}));

import { removeWorktree } from '../github/worktreeOperations';
import { deleteRemoteBranch } from '../github/gitOperations';
import { closeIssue } from '../github/githubApi';
import {
  handlePullRequestEvent,
  extractIssueNumberFromPRBody,
} from '../triggers/webhookHandlers';

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

describe('handlePullRequestEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls removeWorktree and deleteRemoteBranch when PR is closed', async () => {
    const payload = createPayload();

    await handlePullRequestEvent(payload);

    expect(removeWorktree).toHaveBeenCalledWith('feature/issue-42-add-login');
    expect(deleteRemoteBranch).toHaveBeenCalledWith('feature/issue-42-add-login');
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
});
