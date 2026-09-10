import { describe, it, expect } from 'vitest';
import { resolvePrReviewInvocation, type PrReviewInvocationDeps } from '../prReviewInvocation';
import type { AgentState } from '../../types/agentTypes';

function makeDeps(overrides: Partial<PrReviewInvocationDeps> = {}): PrReviewInvocationDeps {
  return {
    readTopLevelState: () => null,
    findPullRequestByBranch: () => null,
    resolveSpawn: () => null,
    ...overrides,
  };
}

describe('resolvePrReviewInvocation', () => {
  it('resolves the canonical form to the PR found for the persisted branch', () => {
    const deps = makeDeps({
      readTopLevelState: (adwId) => (adwId === 'wgg98x-void' ? ({ branchName: 'feature-issue-42-void' } as AgentState) : null),
      findPullRequestByBranch: (branch) => (branch === 'feature-issue-42-void' ? { number: 7 } : null),
    });
    const result = resolvePrReviewInvocation(['42', 'wgg98x-void'], deps);
    expect(result).toEqual({ kind: 'run', prNumber: 7, adwId: 'wgg98x-void' });
  });

  it('errors when the resume adwId has no persisted branch name', () => {
    const result = resolvePrReviewInvocation(['42', 'wgg98x-void'], makeDeps());
    expect(result).toEqual({ kind: 'error', message: 'Resume adwId wgg98x-void has no persisted branchName in top-level state' });
  });

  it('errors when the canonical form\'s branch has no resolvable PR', () => {
    const deps = makeDeps({
      readTopLevelState: () => ({ branchName: 'feature-issue-42-void' } as AgentState),
      findPullRequestByBranch: () => null,
    });
    const result = resolvePrReviewInvocation(['42', 'wgg98x-void'], deps);
    expect(result).toEqual({ kind: 'error', message: 'Could not resolve PR for branch feature-issue-42-void (adwId wgg98x-void)' });
  });

  it('skips the manual fallback when the PR is not issue-linked', () => {
    const result = resolvePrReviewInvocation(['7'], makeDeps({ resolveSpawn: () => null }));
    expect(result).toEqual({ kind: 'skip', message: 'PR #7 is not issue-linked — skipping' });
  });

  it('errors on a non-numeric manual PR number', () => {
    const result = resolvePrReviewInvocation(['not-a-number'], makeDeps());
    expect(result).toEqual({ kind: 'error', message: 'Invalid PR number: not-a-number' });
  });
});
