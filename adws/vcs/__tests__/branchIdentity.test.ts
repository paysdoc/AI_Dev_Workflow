import { describe, it, expect } from 'vitest';
import { deterministicBranchName, branchMatchesIssue } from '../branchIdentity';

describe('deterministicBranchName', () => {
  it.each([
    ['/feature', 641, 'feature-issue-641'],
    ['/bug',     641, 'bugfix-issue-641'],
    ['/chore',   641, 'chore-issue-641'],
    ['/pr_review', 641, 'review-issue-641'],
    ['/adw_init', 641, 'adwinit-issue-641'],
    ['/bug',     12,  'bugfix-issue-12'],
    ['/chore',   7,   'chore-issue-7'],
    ['/pr_review', 3, 'review-issue-3'],
    ['/adw_init', 641, 'adwinit-issue-641'],
  ] as const)('classifier=%s issue=%d → %s', (classifier, issue, expected) => {
    expect(deterministicBranchName(classifier, issue)).toBe(expected);
  });
});

describe('branchMatchesIssue', () => {
  describe('returns true', () => {
    it('exact match (no slug)', () => {
      expect(branchMatchesIssue('feature-issue-641', '/feature', 641)).toBe(true);
    });

    it('slug-suffixed match', () => {
      expect(
        branchMatchesIssue('feature-issue-641-deterministic-branch-identity-fallback', '/feature', 641),
      ).toBe(true);
    });

    it('any slug tail matches', () => {
      expect(branchMatchesIssue('feature-issue-641-some-other-slug', '/feature', 641)).toBe(true);
    });

    it('alias prefix match (feat- for /feature)', () => {
      expect(branchMatchesIssue('feat-issue-641-some-slug', '/feature', 641)).toBe(true);
    });
  });

  describe('returns false', () => {
    it('different issue number (one off)', () => {
      expect(
        branchMatchesIssue('feature-issue-642-deterministic-branch-identity-fallback', '/feature', 641),
      ).toBe(false);
    });

    it('number boundary — 641 must not match 6410', () => {
      expect(
        branchMatchesIssue('feature-issue-6410-deterministic-branch', '/feature', 641),
      ).toBe(false);
    });

    it('number boundary — 641 must not match 64', () => {
      expect(branchMatchesIssue('feature-issue-64-something', '/feature', 641)).toBe(false);
    });

    it('number boundary — 6411 must not match 641', () => {
      expect(branchMatchesIssue('feature-issue-6411', '/feature', 641)).toBe(false);
    });

    it('different classifier prefix (re-classified to /bug)', () => {
      expect(
        branchMatchesIssue('bugfix-issue-641-deterministic-branch-identity-fallback', '/feature', 641),
      ).toBe(false);
    });

    it('classifier mismatch (feature branch vs /bug)', () => {
      expect(
        branchMatchesIssue('feature-issue-641-deterministic-branch-identity-fallback', '/bug', 641),
      ).toBe(false);
    });
  });
});
