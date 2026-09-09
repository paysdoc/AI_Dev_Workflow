/**
 * extractionRule.test.ts — rule-level unit tests for the 'extraction-readiness'
 * rule (#816). Pure tests only — no `fs` mock — except the final real-tree
 * test, which reads the actual repository via the real `fs`.
 */

import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';
import {
  EXTRACTABLE_SET,
  EXTRACTION_SCOPE,
  isInExtractableSet,
  isInExtractionScope,
  resolveImportTarget,
  collectImportSpecifiers,
  flagFrameworkImports,
} from '../extractionRule';
import { collectExtractionScopeFiles, scanExtractionScope } from '../../checkGitGhGuard';

describe('resolveImportTarget', () => {
  it.each([
    ['adws/gitContext/a.ts', 'typescript', null],
    ['adws/gitContext/a.ts', 'fs', null],
    ['adws/gitContext/a.ts', 'node:child_process', null],
    ['adws/gitContext/a.ts', '@types/node', null],
    ['adws/gitContext/a.ts', './types', 'adws/gitContext/types'],
    ['adws/gitContext/a.ts', './types.ts', 'adws/gitContext/types.ts'],
    ['adws/gitContext/a.ts', '../core', 'adws/core'],
    ['adws/gitContext/a.ts', '../../core', 'core'],
    ['adws/providers/types.ts', '../gitContext', 'adws/gitContext'],
    ['adws/providers/github/x.ts', '../../gitContext/types', 'adws/gitContext/types'],
    ['adws/providers/github/x.ts', '../../github/githubApi', 'adws/github/githubApi'],
    ['adws/gitContext/a.ts', '@adws/core/utils', 'adws/core/utils'],
    ['adws/gitContext/a.ts', '../gitContext/../gitContext/types', 'adws/gitContext/types'],
  ])('resolveImportTarget(%s, %s) -> %s', (importerRelPath, specifier, expected) => {
    expect(resolveImportTarget(importerRelPath, specifier)).toBe(expected);
  });
});

describe('isInExtractableSet', () => {
  it.each([
    ['adws/gitContext', true],
    ['adws/gitContext/gitContext.ts', true],
    ['adws/providers/types.ts', true],
    ['adws/providers/gitlab/gitlabCodeHost.ts', true],
    ['adws/core/utils', false],
    ['adws/github/githubApi', false],
    ['core', false],
    ['adws/gitContextExtra/x.ts', false],
    ['adws/providersX/y.ts', false],
  ])('isInExtractableSet(%s) -> %s', (relPath, expected) => {
    expect(isInExtractableSet(relPath)).toBe(expected);
  });
});

describe('isInExtractionScope', () => {
  it.each([
    ['adws/gitContext', true],
    ['adws/gitContext/worktreeCreateOps.ts', true],
    ['adws/providers/types.ts', true],
    ['adws/providers/github/githubCodeHost.ts', true],
    ['adws/providers/repoContext.ts', false],
    ['adws/providers/typesX.ts', false],
    ['adws/github/issueApi.ts', false],
    ['adws/providers/github/mappers.ts', true],
    ['adws/providers/github/domain/issue.ts', true],
    ['adws/providers/github/domain/pullRequest.ts', true],
    ['adws/providers/github/domainX.ts', true],
    ['adws/providers/github/mappersX.ts', true],
    ['adws/providers/gitlab/gitlabCodeHost.ts', true],
    ['adws/providers/jira/jiraIssueTracker.ts', true],
    ['adws/providers/jira/adfConverter.ts', true],
    ['adws/providers/gitlabX/y.ts', false],
    ['adws/providers/jiraX/y.ts', false],
    ['adws/providers/workspaceValidation.ts', true],
    ['adws/providers/index.ts', true],
    ['adws/providers/github/ghIssueParsers.ts', true],
    ['adws/providers/zzNew.ts', false],
  ])('isInExtractionScope(%s) -> %s', (relPath, expected) => {
    expect(isInExtractionScope(relPath)).toBe(expected);
  });
});

describe('collectImportSpecifiers', () => {
  it('collects exactly the seven literal specifiers, ignoring comments and non-literal dynamic imports', () => {
    const source = `
import { a } from './a';
import type { B } from '../b';
export * from './c';
export { d } from '../d';
import e = require('./e');
async function f() {
  const f = await import('../f');
}
const g = require('./g');
// import x from '../../core';
function h(dynamicName: string) {
  return import(dynamicName);
}
`;
    const sourceFile = ts.createSourceFile('probe.ts', source, ts.ScriptTarget.Latest, false);
    const specifiers = collectImportSpecifiers(sourceFile);

    expect(specifiers.map((s) => s.specifier).sort()).toEqual(
      ['../b', '../d', '../f', './a', './c', './e', './g'].sort(),
    );
    expect(specifiers).toHaveLength(7);
  });

  it('reports 1-based line numbers', () => {
    const source = "import { a } from './a';\nimport { b } from './b';\n";
    const sourceFile = ts.createSourceFile('probe.ts', source, ts.ScriptTarget.Latest, false);
    const specifiers = collectImportSpecifiers(sourceFile);

    expect(specifiers.find((s) => s.specifier === './a')?.line).toBe(1);
    expect(specifiers.find((s) => s.specifier === './b')?.line).toBe(2);
  });
});

describe('flagFrameworkImports', () => {
  it('flags an in-scope file importing a framework value', () => {
    const source = "import { log } from '../core';\n";
    const sourceFile = ts.createSourceFile('adws/gitContext/a.ts', source, ts.ScriptTarget.Latest, false);

    const violations = flagFrameworkImports(sourceFile, 'adws/gitContext/a.ts');

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('extraction-readiness');
    expect(violations[0].line).toBe(1);
    expect(violations[0].command).toContain('../core');
    expect(violations[0].command).toContain('adws/core');
  });

  it('flags an in-scope type-only import (type-only still counts)', () => {
    const source = "import type { ProjectConfig } from '../../core/projectConfig';\n";
    const sourceFile = ts.createSourceFile('adws/gitContext/a.ts', source, ts.ScriptTarget.Latest, false);

    const violations = flagFrameworkImports(sourceFile, 'adws/gitContext/a.ts');

    expect(violations).toHaveLength(1);
  });

  it('flags an in-scope re-export escaping the set', () => {
    const source = "export * from '../github/githubApi';\n";
    const sourceFile = ts.createSourceFile('adws/gitContext/a.ts', source, ts.ScriptTarget.Latest, false);

    const violations = flagFrameworkImports(sourceFile, 'adws/gitContext/a.ts');

    expect(violations).toHaveLength(1);
  });

  it('passes a clean in-scope file with only built-ins/npm/sibling imports', () => {
    const source = "import { execSync } from 'child_process';\nimport * as path from 'node:path';\nimport * as ts from 'typescript';\nimport type { Logger } from './types';\n";
    const sourceFile = ts.createSourceFile('adws/gitContext/a.ts', source, ts.ScriptTarget.Latest, false);

    expect(flagFrameworkImports(sourceFile, 'adws/gitContext/a.ts')).toHaveLength(0);
  });

  it('passes an intra-set import from gitContext to providers', () => {
    const source = "import type { RepoIdentifier } from '../providers/types';\n";
    const sourceFile = ts.createSourceFile('adws/gitContext/a.ts', source, ts.ScriptTarget.Latest, false);

    expect(flagFrameworkImports(sourceFile, 'adws/gitContext/a.ts')).toHaveLength(0);
  });

  it('passes an out-of-scope providers file with a framework import — the scope guard clause fires first', () => {
    const source = "import { log } from '../core/logger';\n";
    const sourceFile = ts.createSourceFile(
      'adws/providers/repoContext.ts',
      source,
      ts.ScriptTarget.Latest,
      false,
    );

    expect(flagFrameworkImports(sourceFile, 'adws/providers/repoContext.ts')).toHaveLength(0);
  });

  it('flags an in-scope GitHub port file importing ../../github/issueApi (in scope since #819)', () => {
    const source = "import { fetchGitHubIssue } from '../../github/issueApi';\n";
    const sourceFile = ts.createSourceFile('adws/providers/github/githubIssueTracker.ts', source, ts.ScriptTarget.Latest, false);

    const violations = flagFrameworkImports(sourceFile, 'adws/providers/github/githubIssueTracker.ts');

    expect(violations).toHaveLength(1);
    expect(violations[0].command).toContain('adws/github/issueApi');
  });

  it('passes a clean GitHub port file importing the executor, its own sibling modules, and the ports (in scope since #819)', () => {
    const source =
      "import type { GitContext } from '../../gitContext';\n" +
      "import { createGhRepoApi } from './ghRepoApi';\n" +
      "import { parseGitHubIssue } from './ghIssueParsers';\n" +
      "import type { RepoIdentifier } from '../types';\n";
    const sourceFile = ts.createSourceFile('adws/providers/github/githubIssueTracker.ts', source, ts.ScriptTarget.Latest, false);

    expect(flagFrameworkImports(sourceFile, 'adws/providers/github/githubIssueTracker.ts')).toHaveLength(0);
  });

  it('flags an in-scope GitLab file importing a framework value (in scope since #818)', () => {
    const source = "import { GITLAB_TOKEN } from '../../core';\n";
    const sourceFile = ts.createSourceFile('adws/providers/gitlab/gitlabCodeHost.ts', source, ts.ScriptTarget.Latest, false);

    const violations = flagFrameworkImports(sourceFile, 'adws/providers/gitlab/gitlabCodeHost.ts');

    expect(violations).toHaveLength(1);
    expect(violations[0].command).toContain('adws/core');
  });

  it('passes a clean Jira file importing the Logger port and provider types (in scope since #818)', () => {
    const source = "import type { Logger } from '../../gitContext/types';\nimport { consoleLogger } from '../../gitContext/consoleLogger';\nimport type { IssueTracker } from '../types';\n";
    const sourceFile = ts.createSourceFile('adws/providers/jira/jiraIssueTracker.ts', source, ts.ScriptTarget.Latest, false);

    expect(flagFrameworkImports(sourceFile, 'adws/providers/jira/jiraIssueTracker.ts')).toHaveLength(0);
  });
});

describe('scope-list invariants', () => {
  it('every EXTRACTION_SCOPE entry carries a non-empty path, reason, and since', () => {
    for (const entry of EXTRACTION_SCOPE) {
      expect(entry.path.length).toBeGreaterThan(0);
      expect(entry.reason.length).toBeGreaterThan(0);
      expect(entry.since.length).toBeGreaterThan(0);
    }
  });

  it('every EXTRACTION_SCOPE entry path is inside EXTRACTABLE_SET (scope ⊆ set)', () => {
    for (const entry of EXTRACTION_SCOPE) {
      expect(isInExtractableSet(entry.path)).toBe(true);
    }
  });

  it('the two initial entries are present — asserted as a superset, so widening never breaks this test', () => {
    const paths = EXTRACTION_SCOPE.map((e) => e.path);
    expect(paths).toContain('adws/gitContext');
    expect(paths).toContain('adws/providers/types.ts');
  });

  it('the #817 entries are present — asserted as a superset, so further widening never breaks this test', () => {
    const byPath = new Map(EXTRACTION_SCOPE.map((e) => [e.path, e.since]));
    expect(byPath.get('adws/providers/github/domain')).toBe('#817');
    expect(byPath.get('adws/providers/github/mappers.ts')).toBe('#817');
  });

  it('the #818 entries are present — asserted as a superset, so further widening never breaks this test', () => {
    const byPath = new Map(EXTRACTION_SCOPE.map((e) => [e.path, e.since]));
    expect(byPath.get('adws/providers/gitlab')).toBe('#818');
    expect(byPath.get('adws/providers/jira')).toBe('#818');
  });

  it('the #819 entries are present — asserted as a superset, so further widening never breaks this test', () => {
    const byPath = new Map(EXTRACTION_SCOPE.map((e) => [e.path, e.since]));
    expect(byPath.get('adws/providers/github')).toBe('#819');
    expect(byPath.get('adws/providers/workspaceValidation.ts')).toBe('#819');
    expect(byPath.get('adws/providers/index.ts')).toBe('#819');
  });

  it('EXTRACTABLE_SET is exactly the two directories', () => {
    expect(EXTRACTABLE_SET).toEqual(['adws/gitContext', 'adws/providers']);
  });
});

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
    for (const relPath of scopeFiles) {
      expect(relPath).not.toContain('/__tests__/');
      expect(relPath.endsWith('.test.ts')).toBe(false);
    }

    const { violations } = scanExtractionScope(scopeFiles, repoRoot);
    expect(violations).toEqual([]);
  });
});
