import { vi } from 'vitest';
import { SWEEP_BRANCH, type SweepBase } from '../../perIssueSweepPersist';
import type { GitContext } from '@paysdoc/devplatform/git';
import type { LaunchBoundary } from '../../../core';
import type { CodeHost, RepoIdentifier } from '@paysdoc/devplatform';
import { Platform } from '@paysdoc/devplatform';

export function makeFakeGitContext(overrides: Record<string, unknown> = {}): GitContext {
  return {
    owner: 'test-owner',
    repo: 'test-repo',
    removeWorktree: vi.fn(() => true),
    createWorktreeForNewBranch: vi.fn(() => '/repo/.worktrees/chore-scenario-sweep'),
    ...overrides,
  } as unknown as GitContext;
}

export function makeFakeCodeHost(overrides: Record<string, unknown> = {}): CodeHost {
  return {
    getDefaultBranch: vi.fn(() => 'dev'),
    findPullRequestByBranch: vi.fn(() => null),
    createPullRequest: vi.fn(() => ({ url: 'https://github.com/test-owner/test-repo/pull/99', number: 99 })),
    mergePullRequest: vi.fn(() => ({ success: true })),
    ...overrides,
  } as unknown as CodeHost;
}

export function makeFakeBoundary(gitContext: GitContext, codeHost: CodeHost = makeFakeCodeHost()): LaunchBoundary {
  const repoId: RepoIdentifier = { owner: gitContext.owner, repo: gitContext.repo, platform: Platform.GitHub };
  return { gitContext, repoId, providers: { issueTracker: {} as never, codeHost } } as LaunchBoundary;
}

export function makeFakeBase(overrides: Partial<SweepBase> = {}): SweepBase {
  return {
    ctx: {
      removeAndCommitPaths: vi.fn(() => true),
      pushBranch: vi.fn(),
    } as unknown as SweepBase['ctx'],
    codeHost: makeFakeCodeHost(),
    defaultBranch: 'dev',
    sweepBranch: SWEEP_BRANCH,
    worktreePath: '/tmp/worktree',
    findOpenSweepPr: vi.fn(() => null),
    openPr: vi.fn(() => 42),
    mergePr: vi.fn(() => ({ success: true })),
    log: vi.fn(),
    ...overrides,
  };
}
