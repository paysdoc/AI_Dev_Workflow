import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('fs', () => ({
  mkdtempSync: vi.fn(() => '/tmp/adw-pr-test'),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  rmdirSync: vi.fn(),
}));

vi.mock('os', () => ({
  tmpdir: vi.fn(() => '/tmp'),
}));

vi.mock('../../core/utils', () => ({
  log: vi.fn(),
}));

vi.mock('../gitOperations', () => ({
  getCurrentBranch: vi.fn(() => 'feat-issue-42-add-login'),
  pushBranch: vi.fn(),
}));

import { execSync } from 'child_process';
import * as fs from 'fs';
import { createPullRequest } from '../pullRequestCreator';
import { pushBranch } from '../gitOperations';
import type { GitHubIssue } from '../../core';

const testRepoInfo = { owner: 'test-owner', repo: 'test-repo' };
const testCwd = '/test/cwd';

function makeIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 42,
    title: 'Add user login',
    body: 'Implement login functionality',
    state: 'OPEN',
    author: { login: 'alice', name: 'Alice', isBot: false },
    assignees: [],
    labels: [],
    milestone: null,
    comments: [],
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-02T00:00:00Z',
    closedAt: null,
    url: 'https://github.com/test-owner/test-repo/issues/42',
    ...overrides,
  };
}

describe('createPullRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a PR and returns the URL', () => {
    vi.mocked(execSync).mockReturnValue('https://github.com/test-owner/test-repo/pull/55\n');

    const result = createPullRequest(makeIssue(), 'Plan summary', 'Build summary', 'develop', testCwd, testRepoInfo);

    expect(result).toBe('https://github.com/test-owner/test-repo/pull/55');
    expect(pushBranch).toHaveBeenCalledWith('feat-issue-42-add-login', testCwd);
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      '/tmp/adw-pr-test/pr-body.md',
      expect.stringContaining('Implements #42'),
      'utf-8',
    );
  });

  it('includes plan and build summaries in PR body', () => {
    vi.mocked(execSync).mockReturnValue('https://github.com/o/r/pull/1\n');

    createPullRequest(makeIssue(), 'My plan', 'My build', 'develop', testCwd, testRepoInfo);

    const writtenBody = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    expect(writtenBody).toContain('My plan');
    expect(writtenBody).toContain('My build');
  });

  it('generates correct PR title from issue', () => {
    vi.mocked(execSync).mockReturnValue('https://github.com/o/r/pull/1\n');

    createPullRequest(makeIssue({ title: 'Fix bug', number: 99 }), '', '', 'develop', testCwd, testRepoInfo);

    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('feat: Fix bug (#99)'),
      expect.any(Object),
    );
  });

  it('uses custom repoInfo when provided', () => {
    vi.mocked(execSync).mockReturnValue('https://github.com/custom/proj/pull/1\n');

    createPullRequest(makeIssue(), '', '', 'develop', testCwd, { owner: 'custom', repo: 'proj' });

    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('--repo custom/proj'),
      expect.any(Object),
    );
  });

  it('uses custom base branch', () => {
    vi.mocked(execSync).mockReturnValue('https://github.com/o/r/pull/1\n');

    createPullRequest(makeIssue(), '', '', 'main', testCwd, testRepoInfo);

    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('--base main'),
      expect.any(Object),
    );
  });

  it('returns empty string on failure', () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error('PR create failed'); });

    const result = createPullRequest(makeIssue(), '', '', 'develop', testCwd, testRepoInfo);

    expect(result).toBe('');
  });

  it('cleans up temp files after success', () => {
    vi.mocked(execSync).mockReturnValue('https://github.com/o/r/pull/1\n');

    createPullRequest(makeIssue(), '', '', 'develop', testCwd, testRepoInfo);

    expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/adw-pr-test/pr-body.md');
    expect(fs.rmdirSync).toHaveBeenCalledWith('/tmp/adw-pr-test');
  });

  it('cleans up temp files after failure', () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error('fail'); });

    createPullRequest(makeIssue(), '', '', 'develop', testCwd, testRepoInfo);

    expect(fs.unlinkSync).toHaveBeenCalled();
    expect(fs.rmdirSync).toHaveBeenCalled();
  });
});
