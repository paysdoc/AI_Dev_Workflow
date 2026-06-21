import { describe, it, expect } from 'vitest';
import {
  findExistingBranchForIssue,
  recoverAdwIdForBranch,
  type BranchIdentityFallbackDeps,
} from '../branchIdentityFallback';
import type { AgentState } from '../../types/agentTypes';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(overrides: Partial<BranchIdentityFallbackDeps>): BranchIdentityFallbackDeps {
  return {
    listCandidateBranches: () => [],
    listAdwIds: () => [],
    readTopLevelState: () => null,
    ...overrides,
  };
}

function stateWith(branchName: string, lastActivity?: string): AgentState {
  const phases = lastActivity
    ? { somePhase: { startedAt: lastActivity, status: 'completed' as const } }
    : undefined;
  return {
    adwId: 'test',
    issueNumber: 641,
    workflowStage: 'completed',
    branchName,
    phases,
  } as unknown as AgentState;
}

// ---------------------------------------------------------------------------
// findExistingBranchForIssue
// ---------------------------------------------------------------------------

describe('findExistingBranchForIssue', () => {
  it('returns a matching branch when one exists', () => {
    const deps = makeDeps({
      listCandidateBranches: () => [
        'feature-issue-641-deterministic-branch-identity-fallback',
        'main',
      ],
    });
    expect(findExistingBranchForIssue('/feature', 641, deps)).toBe(
      'feature-issue-641-deterministic-branch-identity-fallback',
    );
  });

  it('returns null when no candidates match (empty list)', () => {
    const deps = makeDeps({ listCandidateBranches: () => [] });
    expect(findExistingBranchForIssue('/feature', 641, deps)).toBeNull();
  });

  it('returns null when candidates exist but none match the issue', () => {
    const deps = makeDeps({
      listCandidateBranches: () => ['feature-issue-642-other', 'main'],
    });
    expect(findExistingBranchForIssue('/feature', 641, deps)).toBeNull();
  });

  it('returns null on reclassification prefix mismatch', () => {
    const deps = makeDeps({
      // existing branch has feature prefix but we're now classifying as /bug
      listCandidateBranches: () => ['feature-issue-641-some-slug'],
    });
    expect(findExistingBranchForIssue('/bug', 641, deps)).toBeNull();
  });

  it('matches an alias prefix (feat- for /feature)', () => {
    const deps = makeDeps({
      listCandidateBranches: () => ['feat-issue-641-some-slug'],
    });
    expect(findExistingBranchForIssue('/feature', 641, deps)).toBe('feat-issue-641-some-slug');
  });

  it('returns the first matching branch when multiple match', () => {
    const deps = makeDeps({
      listCandidateBranches: () => [
        'feature-issue-641-first',
        'feature-issue-641-second',
      ],
    });
    expect(findExistingBranchForIssue('/feature', 641, deps)).toBe('feature-issue-641-first');
  });
});

// ---------------------------------------------------------------------------
// recoverAdwIdForBranch
// ---------------------------------------------------------------------------

describe('recoverAdwIdForBranch', () => {
  it('returns the adwId whose persisted branchName matches', () => {
    const deps = makeDeps({
      listAdwIds: () => ['abc123', 'xyz789'],
      readTopLevelState: (adwId) =>
        adwId === 'abc123'
          ? stateWith('feature-issue-641-some-slug')
          : stateWith('feature-issue-999-other'),
    });
    expect(recoverAdwIdForBranch('feature-issue-641-some-slug', deps)).toBe('abc123');
  });

  it('returns null when no adwId has a matching branchName', () => {
    const deps = makeDeps({
      listAdwIds: () => ['abc123', 'xyz789'],
      readTopLevelState: () => stateWith('feature-issue-999-other'),
    });
    expect(recoverAdwIdForBranch('feature-issue-641-some-slug', deps)).toBeNull();
  });

  it('returns null when state store is empty', () => {
    const deps = makeDeps({ listAdwIds: () => [] });
    expect(recoverAdwIdForBranch('feature-issue-641-some-slug', deps)).toBeNull();
  });

  it('returns null when all state files are missing (readTopLevelState returns null)', () => {
    const deps = makeDeps({
      listAdwIds: () => ['abc123'],
      readTopLevelState: () => null,
    });
    expect(recoverAdwIdForBranch('feature-issue-641-some-slug', deps)).toBeNull();
  });

  it('returns null when matching state has no branchName field', () => {
    const deps = makeDeps({
      listAdwIds: () => ['abc123'],
      readTopLevelState: () => ({ adwId: 'abc123', issueNumber: 641 } as AgentState),
    });
    expect(recoverAdwIdForBranch('feature-issue-641-some-slug', deps)).toBeNull();
  });

  it('tie-breaks on most-recently-active when multiple adwIds match', () => {
    const deps = makeDeps({
      listAdwIds: () => ['older', 'newer', 'no-phases'],
      readTopLevelState: (adwId) => {
        if (adwId === 'older') return stateWith('feature-issue-641-slug', '2024-01-01T00:00:00Z');
        if (adwId === 'newer') return stateWith('feature-issue-641-slug', '2024-06-01T00:00:00Z');
        return stateWith('feature-issue-641-slug'); // no phases → null lastActivity
      },
    });
    expect(recoverAdwIdForBranch('feature-issue-641-slug', deps)).toBe('newer');
  });

  it('prefers any adwId with activity over one with null activity on tie', () => {
    const deps = makeDeps({
      listAdwIds: () => ['no-phases', 'has-phases'],
      readTopLevelState: (adwId) => {
        if (adwId === 'no-phases') return stateWith('feature-issue-641-slug');
        return stateWith('feature-issue-641-slug', '2024-01-01T00:00:00Z');
      },
    });
    expect(recoverAdwIdForBranch('feature-issue-641-slug', deps)).toBe('has-phases');
  });
});
