/**
 * extractionRule.integration.test.ts — the real-tree check for the
 * 'extraction-readiness' rule (#816): reads the actual repository via the
 * real `fs` and asserts the current scope is clean. Split out of
 * extractionRule.test.ts (which is otherwise pure/mock-free) to keep that
 * file under the 300-line cap.
 */

import { describe, it, expect } from 'vitest';
import { collectExtractionScopeFiles, scanExtractionScope } from '../../checkGitGhGuard';

describe('real-tree: the initial scope is clean today', () => {
  it('collects the expected files, excludes tests, and yields zero violations', () => {
    const repoRoot = process.cwd();
    const scopeFiles = collectExtractionScopeFiles(repoRoot);

    expect(scopeFiles).toContain('adws/gitContext/gitContext.ts');
    expect(scopeFiles).toContain('adws/providers/types.ts');
    expect(scopeFiles).toContain('adws/providers/github/mappers.ts');
    expect(scopeFiles).toContain('adws/providers/github/domain/issue.ts');
    expect(scopeFiles).toContain('adws/providers/github/domain/pullRequest.ts');
    expect(scopeFiles).toContain('adws/providers/gitlab/gitlabCodeHost.ts');
    expect(scopeFiles).toContain('adws/providers/gitlab/gitlabApiClient.ts');
    expect(scopeFiles).toContain('adws/providers/jira/jiraIssueTracker.ts');
    expect(scopeFiles).toContain('adws/providers/jira/jiraApiClient.ts');
    expect(scopeFiles).toContain('adws/providers/github/githubIssueTracker.ts');
    expect(scopeFiles).toContain('adws/providers/github/githubCodeHost.ts');
    expect(scopeFiles).toContain('adws/providers/github/githubBoardManager.ts');
    expect(scopeFiles).toContain('adws/providers/github/ghIssueParsers.ts');
    expect(scopeFiles).toContain('adws/providers/github/ghPrParsers.ts');
    expect(scopeFiles).toContain('adws/providers/github/contextBinding.ts');
    expect(scopeFiles).toContain('adws/providers/workspaceValidation.ts');
    expect(scopeFiles).toContain('adws/providers/index.ts');
    expect(scopeFiles).toContain('adws/providers/forgeProviders.ts');
    for (const relPath of scopeFiles) {
      expect(relPath).not.toContain('/__tests__/');
      expect(relPath.endsWith('.test.ts')).toBe(false);
    }
    expect(new Set(scopeFiles).size).toBe(scopeFiles.length);

    const { violations } = scanExtractionScope(scopeFiles, repoRoot);
    expect(violations).toEqual([]);
  });
});
