import { vi } from 'vitest';
import { makeDefaultDeps } from '../../promotionSweepDefaults';
import type { SweepBase } from '../../perIssueSweepPersist';
import type { GitContext } from '@paysdoc/devplatform/git';
import type { LaunchBoundary } from '../../../core';
import type { IssueTracker, CodeHost, RepoIdentifier } from '@paysdoc/devplatform';
import { Platform } from '@paysdoc/devplatform';

export const PER_ISSUE_DIR = 'features/per-issue';
export const STEP_DEF_DIR = 'features/per-issue/step_definitions';
export const HOST_CHECKOUT = '/host-checkout';
export const SWEEP_WORKTREE = '/sweep-worktree';
export const NOW = new Date('2026-10-02T12:00:00Z');

export function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

export function makeFakeGitContext(overrides: Record<string, unknown> = {}): GitContext {
  return {
    owner: 'test-owner',
    repo: 'test-repo',
    basePath: HOST_CHECKOUT,
    lsFiles: vi.fn(() => []),
    logSince: vi.fn(() => ''),
    getCurrentBranch: vi.fn(() => 'main'),
    addAndCommitPaths: vi.fn(() => true),
    pushBranch: vi.fn(),
    ...overrides,
  } as unknown as GitContext;
}

export function makeFakeIssueTracker(overrides: Record<string, unknown> = {}): IssueTracker {
  return {
    listIssues: vi.fn(() => []),
    createIssue: vi.fn(() => 501),
    applyLabel: vi.fn(),
    ...overrides,
  } as unknown as IssueTracker;
}

export function makeFakeCodeHost(overrides: Record<string, unknown> = {}): CodeHost {
  return {
    getDefaultBranch: vi.fn(() => 'dev'),
    listMergedPullRequests: vi.fn(() => []),
    ...overrides,
  } as unknown as CodeHost;
}

export function makeFakeBoundary(
  gitContext: GitContext,
  issueTracker: IssueTracker = makeFakeIssueTracker(),
  codeHost: CodeHost = makeFakeCodeHost(),
): LaunchBoundary {
  const repoId: RepoIdentifier = { owner: gitContext.owner, repo: gitContext.repo, platform: Platform.GitHub };
  return { gitContext, repoId, providers: { issueTracker, codeHost } } as LaunchBoundary;
}

export function makeFakeBase(ctx: GitContext, overrides: Partial<SweepBase> = {}): SweepBase {
  return {
    ctx,
    codeHost: makeFakeCodeHost(),
    defaultBranch: 'dev',
    sweepBranch: 'chore/promotion-sweep',
    worktreePath: SWEEP_WORKTREE,
    findOpenSweepPr: vi.fn(() => null),
    openPr: vi.fn(() => 42),
    mergePr: vi.fn(() => ({ success: true })),
    log: vi.fn(),
    ...overrides,
  };
}

/** Builds the defaults over a sweep base wrapping `ctx` (or over no base when `withBase` is false). */
export function defaultsFor(
  ctx: GitContext,
  options: { issueTracker?: IssueTracker; codeHost?: CodeHost; withBase?: boolean; base?: SweepBase } = {},
) {
  const base = options.withBase === false ? null : (options.base ?? makeFakeBase(ctx));
  return makeDefaultDeps(makeFakeBoundary(ctx, options.issueTracker, options.codeHost), () => base);
}

export function featureWithScenarioAdditions(count: number): string {
  const header = `diff --git a/${PER_ISSUE_DIR}/feature-611.feature b/${PER_ISSUE_DIR}/feature-611.feature`;
  return [header, ...Array.from({ length: count }, (_, i) => `+  Scenario: added ${i + 1}`)].join('\n');
}
