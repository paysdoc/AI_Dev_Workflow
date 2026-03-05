import { describe, it, expect } from 'vitest';
import { generateBranchName } from '../github/gitOperations';
import { IssueClassSlashCommand, branchPrefixMap, branchPrefixAliases } from '../types/dataTypes';

describe('generateBranchName', () => {
  const issueNumber = 123;
  const issueTitle = 'Fix login bug';

  describe('branch prefix based on issue type', () => {
    it('generates feature/ prefix for /feature issue type', () => {
      const result = generateBranchName(issueNumber, issueTitle, '/feature');

      expect(result).toBe('feature/issue-123-fix-login-bug');
      expect(result.startsWith('feature/')).toBe(true);
    });

    it('generates bugfix/ prefix for /bug issue type', () => {
      const result = generateBranchName(issueNumber, issueTitle, '/bug');

      expect(result).toBe('bugfix/issue-123-fix-login-bug');
      expect(result.startsWith('bugfix/')).toBe(true);
    });

    it('generates chore/ prefix for /chore issue type', () => {
      const result = generateBranchName(issueNumber, issueTitle, '/chore');

      expect(result).toBe('chore/issue-123-fix-login-bug');
      expect(result.startsWith('chore/')).toBe(true);
    });

    it('generates review/ prefix for /pr_review issue type', () => {
      const result = generateBranchName(issueNumber, issueTitle, '/pr_review');

      expect(result).toBe('review/issue-123-fix-login-bug');
      expect(result.startsWith('review/')).toBe(true);
    });
  });

  describe('default behavior', () => {
    it('defaults to feature/ prefix when no issue type is provided', () => {
      const result = generateBranchName(issueNumber, issueTitle);

      expect(result).toBe('feature/issue-123-fix-login-bug');
      expect(result.startsWith('feature/')).toBe(true);
    });
  });

  describe('title slugification', () => {
    it('converts title to lowercase', () => {
      const result = generateBranchName(123, 'ADD NEW FEATURE', '/feature');

      expect(result).toBe('feature/issue-123-add-new-feature');
    });

    it('replaces spaces with hyphens', () => {
      const result = generateBranchName(123, 'Add new feature for users', '/feature');

      expect(result).toBe('feature/issue-123-add-new-feature-for-users');
    });

    it('handles special characters by converting to hyphens', () => {
      const result = generateBranchName(123, "Fix bug: can't login!", '/bug');

      // Special characters are converted to hyphens by slugify
      expect(result).toBe('bugfix/issue-123-fix-bug-can-t-login');
    });

    it('handles empty title', () => {
      const result = generateBranchName(123, '', '/feature');

      expect(result).toBe('feature/issue-123-');
    });
  });

  describe('branch prefix map consistency', () => {
    it('uses the correct prefix from branchPrefixMap for all issue types', () => {
      const issueTypes: IssueClassSlashCommand[] = ['/feature', '/bug', '/chore', '/pr_review'];

      for (const issueType of issueTypes) {
        const result = generateBranchName(issueNumber, issueTitle, issueType);
        const expectedPrefix = branchPrefixMap[issueType];

        expect(result.startsWith(`${expectedPrefix}/`)).toBe(true);
      }
    });

    it('maps /feature to feature prefix', () => {
      expect(branchPrefixMap['/feature']).toBe('feature');
    });

    it('maps /bug to bugfix prefix', () => {
      expect(branchPrefixMap['/bug']).toBe('bugfix');
    });

    it('maps /chore to chore prefix', () => {
      expect(branchPrefixMap['/chore']).toBe('chore');
    });

    it('maps /pr_review to review prefix', () => {
      expect(branchPrefixMap['/pr_review']).toBe('review');
    });
  });

  describe('issue number formatting', () => {
    it('includes issue number in the branch name', () => {
      const result = generateBranchName(42, 'Test issue', '/feature');

      expect(result).toBe('feature/issue-42-test-issue');
      expect(result).toContain('issue-42');
    });

    it('handles large issue numbers', () => {
      const result = generateBranchName(99999, 'Test', '/bug');

      expect(result).toBe('bugfix/issue-99999-test');
    });

    it('handles issue number 0', () => {
      const result = generateBranchName(0, 'Test', '/chore');

      expect(result).toBe('chore/issue-0-test');
    });
  });
});

describe('branchPrefixAliases', () => {
  const issueTypes: IssueClassSlashCommand[] = ['/feature', '/bug', '/chore', '/pr_review'];

  it('is defined for all IssueClassSlashCommand types', () => {
    for (const issueType of issueTypes) {
      expect(branchPrefixAliases[issueType]).toBeDefined();
      expect(Array.isArray(branchPrefixAliases[issueType])).toBe(true);
    }
  });

  it('/bug aliases include "bug"', () => {
    expect(branchPrefixAliases['/bug']).toContain('bug');
  });

  it('/feature aliases include "feat"', () => {
    expect(branchPrefixAliases['/feature']).toContain('feat');
  });

  it('aliases do not contain the canonical prefix', () => {
    for (const issueType of issueTypes) {
      const canonical = branchPrefixMap[issueType];
      expect(branchPrefixAliases[issueType]).not.toContain(canonical);
    }
  });
});
