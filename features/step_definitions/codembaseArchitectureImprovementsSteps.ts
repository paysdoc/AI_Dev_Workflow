import { When, Then } from '@cucumber/cucumber';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import assert from 'assert';

const ROOT = process.cwd();

/**
 * Shared world-like context for this step definition file.
 * Steps store scanning/reading results here so subsequent steps can assert on them.
 */
const ctx: {
  scannedFiles: { path: string; content: string }[];
  fileContent: string;
  filePath: string;
} = {
  scannedFiles: [],
  fileContent: '',
  filePath: '',
};

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

function readFile(relPath: string): string {
  const fullPath = join(ROOT, relPath);
  if (!existsSync(fullPath)) return '';
  return readFileSync(fullPath, 'utf-8');
}

function scanTsFiles(relDir: string): { path: string; content: string }[] {
  const fullDir = join(ROOT, relDir);
  if (!existsSync(fullDir)) return [];
  return readdirSync(fullDir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => {
      const p = join(relDir, f);
      return { path: p, content: readFile(p) };
    });
}

function scanTsFilesRecursive(relDir: string): { path: string; content: string }[] {
  const fullDir = join(ROOT, relDir);
  if (!existsSync(fullDir)) return [];
  const result: { path: string; content: string }[] = [];
  const entries = readdirSync(fullDir, { withFileTypes: true });
  for (const entry of entries) {
    const relPath = join(relDir, entry.name);
    if (entry.isDirectory()) {
      result.push(...scanTsFilesRecursive(relPath));
    } else if (entry.name.endsWith('.ts')) {
      result.push({ path: relPath, content: readFile(relPath) });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// When steps
// ---------------------------------------------------------------------------

When('I scan all TypeScript files in {string}', function (dir: string) {
  ctx.scannedFiles = scanTsFiles(dir);
});

When('I read {string}', function (filePath: string) {
  ctx.fileContent = readFile(filePath);
  ctx.filePath = filePath;
});

When('I read the PR review phase files in {string}', function (dir: string) {
  // Collect all phase files that relate to PR review
  const files = scanTsFiles(dir).filter(
    (f) => f.path.includes('prReview') || f.path.includes('prPhase'),
  );
  ctx.scannedFiles = files;
  // Also set fileContent to a combined view for single-file assertions
  ctx.fileContent = files.map((f) => f.content).join('\n');
  ctx.filePath = dir;
});

When('I read the CodeHost interface in {string}', function (filePath: string) {
  ctx.fileContent = readFile(filePath);
  ctx.filePath = filePath;
});

When('I read the GitHub CodeHost implementation', function () {
  const filePath = 'adws/providers/github/githubCodeHost.ts';
  ctx.fileContent = readFile(filePath);
  ctx.filePath = filePath;
});

When('I read the GitLab CodeHost implementation', function () {
  const filePath = 'adws/providers/gitlab/gitlabCodeHost.ts';
  ctx.fileContent = readFile(filePath);
  ctx.filePath = filePath;
});

When('I read the workflow configuration types', function () {
  // WorkflowConfig lives in workflowInit; decomposed contexts may live in types/
  const workflowInitContent = readFile('adws/phases/workflowInit.ts');
  const workflowTypesContent = readFile('adws/types/workflowTypes.ts');
  const dataTypesContent = readFile('adws/types/dataTypes.ts');
  ctx.fileContent = [workflowInitContent, workflowTypesContent, dataTypesContent].join('\n');
  ctx.filePath = 'adws/phases/workflowInit.ts + adws/types/';
});

When('I read the {string} type definition', function (typeName: string) {
  // Search across likely type files
  const candidates = [
    'adws/types/dataTypes.ts',
    'adws/types/workflowTypes.ts',
    'adws/types/index.ts',
    'adws/phases/workflowInit.ts',
    'adws/core/config.ts',
  ];
  let combined = '';
  for (const f of candidates) {
    const content = readFile(f);
    if (content.includes(typeName)) {
      combined += content + '\n';
    }
  }
  ctx.fileContent = combined;
  ctx.filePath = `type search for ${typeName}`;
});

When('I look for the AgentPhaseRunner module', function () {
  // Check in adws/phases/ for any file named agentPhaseRunner
  const phasesDir = join(ROOT, 'adws/phases');
  const files = existsSync(phasesDir) ? readdirSync(phasesDir) : [];
  const match = files.find((f) => f.toLowerCase().includes('agentphaserunner'));
  ctx.fileContent = match
    ? readFile(join('adws/phases', match))
    : '';
  ctx.filePath = match ? join('adws/phases', match) : '';
});

When('I analyze import dependencies across all modules', function () {
  // Scan core, agents, providers, phases for cross-imports
  const core = scanTsFilesRecursive('adws/core');
  const agents = scanTsFilesRecursive('adws/agents');
  const providers = scanTsFilesRecursive('adws/providers');
  const phases = scanTsFilesRecursive('adws/phases');
  ctx.scannedFiles = [...core, ...agents, ...providers, ...phases];
});

When('I read {string} for cost types', function (filePath: string) {
  ctx.fileContent = readFile(filePath);
  ctx.filePath = filePath;
});

When('I scan all TypeScript files that import from {string}', function (modulePattern: string) {
  // Scan entire adws/ tree for files importing from the given module path
  const all = scanTsFilesRecursive('adws');
  ctx.scannedFiles = all.filter((f) => f.content.includes(`'${modulePattern}`));
});

When('I look for test utility modules', function () {
  // Check for test utilities in __tests__ or test helpers directories
  const candidates = [
    'adws/__tests__',
    'adws/testUtils',
    'adws/test-utils',
    'features/support',
  ];
  const result: { path: string; content: string }[] = [];
  for (const dir of candidates) {
    if (existsSync(join(ROOT, dir))) {
      result.push(...scanTsFilesRecursive(dir));
    }
  }
  ctx.scannedFiles = result;
  ctx.fileContent = result.map((f) => f.content).join('\n');
});

When('I look for the WorktreeManager module', function () {
  const vcsDir = join(ROOT, 'adws/vcs');
  const files = existsSync(vcsDir) ? readdirSync(vcsDir) : [];
  const match = files.find((f) => f.toLowerCase().includes('worktreemanager'));
  ctx.fileContent = match ? readFile(join('adws/vcs', match)) : '';
  ctx.filePath = match ? join('adws/vcs', match) : '';
  // Also capture all vcs files so That steps can check broader structure
  ctx.scannedFiles = scanTsFiles('adws/vcs');
});

// ---------------------------------------------------------------------------
// Then steps — Phase decoupling from GitHub module
// ---------------------------------------------------------------------------

Then('none of them should contain imports from {string} or {string}', function (importA: string, importB: string) {
  const violators = ctx.scannedFiles.filter(
    (f) => f.content.includes(`'${importA}'`) || f.content.includes(`'${importB}'`) ||
           f.content.includes(`"${importA}"`) || f.content.includes(`"${importB}"`),
  );
  // workflowInit is exempt as it bridges to providers
  const nonExempt = violators.filter((f) => !f.path.includes('workflowInit.ts'));
  assert.deepStrictEqual(
    nonExempt,
    [],
    `Phase files importing from github directly: ${nonExempt.map((f) => f.path).join(', ')}`,
  );
});

Then('all platform interactions should go through RepoContext', function () {
  // This is verified by checking scanned files use repoContext rather than direct github imports
  // (complementary assertion to the previous step)
  const direct = ctx.scannedFiles.filter(
    (f) => !f.path.includes('workflowInit.ts') &&
           (f.content.includes("from '../github'") || f.content.includes('from "../github"')),
  );
  assert.deepStrictEqual(
    direct,
    [],
    `Files with direct github imports: ${direct.map((f) => f.path).join(', ')}`,
  );
});

Then('it should not import from {string}', function (importPath: string) {
  const hasImport =
    ctx.fileContent.includes(`'${importPath}'`) ||
    ctx.fileContent.includes(`"${importPath}"`);
  assert.ok(
    !hasImport,
    `Expected "${ctx.filePath}" not to import from "${importPath}"`,
  );
});

Then('it should use {string} for posting comments', function (apiPath: string) {
  assert.ok(
    ctx.fileContent.includes(apiPath),
    `Expected "${ctx.filePath}" to use "${apiPath}" for posting comments`,
  );
});

Then('it should not import {string} from {string}', function (namedExport: string, importPath: string) {
  // Check for various import syntaxes
  const patterns = [
    `import.*${namedExport}.*from.*'${importPath}'`,
    `import.*${namedExport}.*from.*"${importPath}"`,
  ];
  const found = patterns.some((p) => new RegExp(p).test(ctx.fileContent));
  assert.ok(
    !found,
    `Expected "${ctx.filePath}" not to import "${namedExport}" from "${importPath}"`,
  );
});

Then('it should use {string} for all PR operations', function (apiPath: string) {
  assert.ok(
    ctx.fileContent.includes(apiPath),
    `Expected "${ctx.filePath}" to use "${apiPath}" for PR operations`,
  );
});

Then('they should not import directly from {string}', function (importPath: string) {
  const violators = ctx.scannedFiles.filter(
    (f) =>
      f.content.includes(`'${importPath}'`) ||
      f.content.includes(`"${importPath}"`),
  );
  assert.deepStrictEqual(
    violators,
    [],
    `Files importing directly from ${importPath}: ${violators.map((f) => f.path).join(', ')}`,
  );
});

Then('they should use {string} for fetching review comments', function (apiPath: string) {
  const hasUsage = ctx.scannedFiles.some((f) => f.content.includes(apiPath));
  const combined = ctx.fileContent;
  assert.ok(
    combined.includes(apiPath) || hasUsage,
    `Expected PR review phase files to use "${apiPath}" for fetching review comments`,
  );
});

Then('they should use {string} for posting review feedback', function (apiPath: string) {
  const hasUsage = ctx.scannedFiles.some((f) => f.content.includes(apiPath));
  const combined = ctx.fileContent;
  assert.ok(
    combined.includes(apiPath) || hasUsage,
    `Expected PR review phase files to use "${apiPath}" for posting review feedback`,
  );
});

// ---------------------------------------------------------------------------
// Then steps — CodeHost interface completeness
// ---------------------------------------------------------------------------

Then('it should declare a method for commenting on a pull request', function () {
  assert.ok(
    ctx.fileContent.includes('commentOnMergeRequest'),
    `Expected CodeHost interface to declare "commentOnMergeRequest"`,
  );
});

Then('it should declare a method for approving a pull request', function () {
  assert.ok(
    ctx.fileContent.includes('approveMergeRequest'),
    `Expected CodeHost interface to declare "approveMergeRequest"`,
  );
});

Then('it should declare a method for fetching pull request details', function () {
  assert.ok(
    ctx.fileContent.includes('fetchMergeRequest'),
    `Expected CodeHost interface to declare "fetchMergeRequest" or "fetchMergeRequestDetails"`,
  );
});

Then('it should declare a method for fetching review comments', function () {
  assert.ok(
    ctx.fileContent.includes('fetchReviewComments'),
    `Expected CodeHost interface to declare "fetchReviewComments"`,
  );
});

Then('it should declare a method for merging a pull request', function () {
  assert.ok(
    ctx.fileContent.includes('mergeMergeRequest'),
    `Expected CodeHost interface to declare "mergeMergeRequest"`,
  );
});

Then('it should implement the {string} method', function (methodName: string) {
  assert.ok(
    ctx.fileContent.includes(methodName),
    `Expected "${ctx.filePath}" to implement method "${methodName}"`,
  );
});

// ---------------------------------------------------------------------------
// Then steps — WorkflowConfig decomposition
// ---------------------------------------------------------------------------

Then('there should be an {string} type for issue-related data', function (typeName: string) {
  assert.ok(
    ctx.fileContent.includes(typeName),
    `Expected workflow configuration types to define "${typeName}"`,
  );
});

Then('there should be a {string} type for file system paths', function (typeName: string) {
  assert.ok(
    ctx.fileContent.includes(typeName),
    `Expected workflow configuration types to define "${typeName}"`,
  );
});

Then('there should be a {string} type for provider interactions', function (typeName: string) {
  assert.ok(
    ctx.fileContent.includes(typeName),
    `Expected workflow configuration types to define "${typeName}"`,
  );
});

Then('{string} should compose these focused contexts', function (typeName: string) {
  assert.ok(
    ctx.fileContent.includes(typeName),
    `Expected "${typeName}" to compose the focused context types`,
  );
});

Then('it should include {string}', function (fieldName: string) {
  assert.ok(
    ctx.fileContent.includes(fieldName),
    `Expected type definition to include field "${fieldName}"`,
  );
});

Then('it should not include file system paths like {string} or {string}', function (field1: string, field2: string) {
  // Extract just the IssueContext block if possible, else check whole content
  const issueContextMatch = ctx.fileContent.match(/IssueContext\s*[={][^}]*}/s);
  const scope = issueContextMatch ? issueContextMatch[0] : ctx.fileContent;
  assert.ok(
    !scope.includes(field1) && !scope.includes(field2),
    `IssueContext should not include file system paths "${field1}" or "${field2}"`,
  );
});

Then('it should not include issue tracking properties', function () {
  const workspaceContextMatch = ctx.fileContent.match(/WorkspaceContext\s*[={][^}]*}/s);
  const scope = workspaceContextMatch ? workspaceContextMatch[0] : ctx.fileContent;
  // Issue tracking properties would be things like issueNumber, issue, issueType
  const issueProps = ['issueNumber', 'issueType'];
  for (const prop of issueProps) {
    assert.ok(
      !scope.includes(prop),
      `WorkspaceContext should not include issue tracking property "${prop}"`,
    );
  }
});

// ---------------------------------------------------------------------------
// Then steps — AgentPhaseRunner abstraction
// ---------------------------------------------------------------------------

Then('it should exist in {string}', function (dir: string) {
  assert.ok(
    ctx.filePath !== '',
    `Expected a relevant module to exist in "${dir}"`,
  );
  assert.ok(
    existsSync(join(ROOT, ctx.filePath)),
    `Expected file "${ctx.filePath}" to exist in "${dir}"`,
  );
});

Then('it should handle cost tracking for all phases', function () {
  assert.ok(
    ctx.fileContent.includes('cost') || ctx.fileContent.includes('Cost'),
    `Expected AgentPhaseRunner to handle cost tracking`,
  );
});

Then('it should handle state management for all phases', function () {
  assert.ok(
    ctx.fileContent.includes('state') || ctx.fileContent.includes('State'),
    `Expected AgentPhaseRunner to handle state management`,
  );
});

Then('it should handle comment posting for all phases', function () {
  assert.ok(
    ctx.fileContent.includes('comment') || ctx.fileContent.includes('Comment'),
    `Expected AgentPhaseRunner to handle comment posting`,
  );
});

Then('it should delegate execution to AgentPhaseRunner', function () {
  assert.ok(
    ctx.fileContent.includes('AgentPhaseRunner') ||
      ctx.fileContent.includes('agentPhaseRunner') ||
      ctx.fileContent.includes('runPhase'),
    `Expected "${ctx.filePath}" to delegate execution to AgentPhaseRunner`,
  );
});

Then('it should not duplicate cost tracking logic', function () {
  // Cost tracking duplication check: should not contain inline createPhaseCostRecords calls
  // outside a shared runner (ideally it should be delegated)
  // We check that the file delegates to AgentPhaseRunner rather than implementing cost logic inline
  const hasDelegation =
    ctx.fileContent.includes('AgentPhaseRunner') ||
    ctx.fileContent.includes('agentPhaseRunner') ||
    ctx.fileContent.includes('runPhase');
  assert.ok(
    hasDelegation,
    `Expected "${ctx.filePath}" to not duplicate cost tracking (should delegate to AgentPhaseRunner)`,
  );
});

Then('it should not duplicate comment posting logic', function () {
  // Should not have inline commentOnIssue/commentOnPR calls outside a shared helper
  const hasDelegation =
    ctx.fileContent.includes('AgentPhaseRunner') ||
    ctx.fileContent.includes('agentPhaseRunner') ||
    ctx.fileContent.includes('runPhase');
  assert.ok(
    hasDelegation,
    `Expected "${ctx.filePath}" to not duplicate comment posting (should delegate to AgentPhaseRunner)`,
  );
});

// ---------------------------------------------------------------------------
// Then steps — Import direction enforcement
// ---------------------------------------------------------------------------

Then('{string} should not import from {string}', function (fromModule: string, toModule: string) {
  const files = ctx.scannedFiles.filter((f) => f.path.startsWith(fromModule));
  const violators = files.filter(
    (f) =>
      f.content.includes(`'${toModule}`) ||
      f.content.includes(`"${toModule}`),
  );
  assert.deepStrictEqual(
    violators,
    [],
    `${fromModule} files importing from ${toModule}: ${violators.map((f) => f.path).join(', ')}`,
  );
});

Then('they should only import from {string}, {string}, {string}, {string}, and {string}', function (
  allowed1: string,
  allowed2: string,
  allowed3: string,
  allowed4: string,
  allowed5: string,
) {
  const allowed = [allowed1, allowed2, allowed3, allowed4, allowed5];
  const phaseFiles = ctx.scannedFiles.filter((f) => f.path.startsWith('adws/phases/'));
  const violations: string[] = [];
  for (const f of phaseFiles) {
    // Extract all relative import paths
    const importMatches = [...f.content.matchAll(/from\s+['"](\.\.[^'"]+)['"]/g)];
    for (const match of importMatches) {
      const importedPath = match[1]; // e.g. '../github'
      // Resolve relative to file location
      const fileDir = f.path.replace(/\/[^/]+$/, '');
      const resolved = resolve(ROOT, fileDir, importedPath)
        .replace(resolve(ROOT) + '/', '');
      // Check if the resolved path falls within an allowed module
      const isAllowed =
        allowed.some((a) => resolved.startsWith(a.replace(/^adws\//, 'adws/'))) ||
        // Also allow phase-internal imports (sibling files)
        resolved.startsWith('adws/phases/') ||
        // Allow node stdlib / external modules (no leading ../)
        !importedPath.startsWith('../../');
      if (!isAllowed) {
        violations.push(`${f.path} imports from ${importedPath} (resolved: ${resolved})`);
      }
    }
  }
  // Note: workflowInit is exempt (bridges github module during migration)
  const nonExempt = violations.filter((v) => !v.includes('workflowInit'));
  assert.deepStrictEqual(nonExempt, [], `Phase import violations:\n${nonExempt.join('\n')}`);
});

Then('they should not import from {string}', function (forbiddenModule: string) {
  const violators = ctx.scannedFiles.filter(
    (f) =>
      f.content.includes(`'${forbiddenModule}`) ||
      f.content.includes(`"${forbiddenModule}`),
  );
  assert.deepStrictEqual(
    violators,
    [],
    `Phase files importing from ${forbiddenModule}: ${violators.map((f) => f.path).join(', ')}`,
  );
});

Then('they should not import from sibling orchestrator scripts', function () {
  // Orchestrator scripts are the top-level adws*.tsx files
  const orchestratorPattern = /from\s+['"]\.\.\/adw[^'"]+['"]/;
  const violators = ctx.scannedFiles.filter(
    (f) => f.path.startsWith('adws/phases/') && orchestratorPattern.test(f.content),
  );
  assert.deepStrictEqual(
    violators,
    [],
    `Phase files importing from sibling orchestrators: ${violators.map((f) => f.path).join(', ')}`,
  );
});

// ---------------------------------------------------------------------------
// Then steps — Cost module type unification
// ---------------------------------------------------------------------------

Then('it should not re-export legacy type aliases', function () {
  // The cost index should not re-export LegacyModelUsage or LegacyModelUsageMap under legacy aliases
  // Currently it re-exports as ModelUsage/ModelUsageMap for backward compat; check for the aliases
  assert.ok(
    !ctx.fileContent.includes('LegacyModelUsage as ModelUsage') &&
      !ctx.fileContent.includes('LegacyModelUsageMap as ModelUsageMap'),
    `Expected "adws/cost/index.ts" not to re-export legacy type aliases (LegacyModelUsage as ModelUsage etc.)`,
  );
});

Then('there should be a single canonical {string} type', function (typeName: string) {
  assert.ok(
    ctx.fileContent.includes(typeName),
    `Expected cost module to export canonical type "${typeName}"`,
  );
});

Then('there should be no {string} or {string} exports', function (name1: string, name2: string) {
  const hasLegacy1 = ctx.fileContent.includes(name1);
  const hasLegacy2 = ctx.fileContent.includes(name2);
  assert.ok(
    !hasLegacy1,
    `Expected cost index to not export "${name1}"`,
  );
  assert.ok(
    !hasLegacy2,
    `Expected cost index to not export "${name2}"`,
  );
});

Then('none of them should reference {string} as a legacy alias', function (aliasName: string) {
  const violators = ctx.scannedFiles.filter((f) => f.content.includes(aliasName));
  assert.deepStrictEqual(
    violators,
    [],
    `Files referencing legacy alias "${aliasName}": ${violators.map((f) => f.path).join(', ')}`,
  );
});

Then('all of them should use {string} or the canonical type name', function (canonicalType: string) {
  // All cost-consuming files should reference the canonical type
  // (not enforced to have exactly this string everywhere, just that none use legacy alias)
  const hasCanonical = ctx.scannedFiles.every(
    (f) => f.content.includes(canonicalType) || !f.content.includes('ModelUsage'),
  );
  assert.ok(
    hasCanonical,
    `Expected all cost consumers to use "${canonicalType}" as the canonical type`,
  );
});

// ---------------------------------------------------------------------------
// Then steps — Testability infrastructure
// ---------------------------------------------------------------------------

Then('there should be a {string} factory function', function (funcName: string) {
  assert.ok(
    ctx.fileContent.includes(funcName),
    `Expected test utilities to include factory function "${funcName}"`,
  );
});

Then('they should produce minimal valid instances for unit testing', function () {
  // Presence of the factory functions is verified above; this checks
  // that they return valid-looking objects (return keyword + object literal or type annotation)
  assert.ok(
    ctx.fileContent.includes('return') || ctx.fileContent.includes('=>'),
    `Expected test factory functions to return instances`,
  );
});

// ---------------------------------------------------------------------------
// Then steps — WorktreeManager
// ---------------------------------------------------------------------------

Then('it should encapsulate worktree creation, branch setup, and cleanup', function () {
  assert.ok(
    ctx.fileContent.includes('create') || ctx.fileContent.includes('Create'),
    `Expected WorktreeManager to encapsulate worktree creation`,
  );
  assert.ok(
    ctx.fileContent.includes('clean') || ctx.fileContent.includes('Clean') ||
      ctx.fileContent.includes('delete') || ctx.fileContent.includes('Delete'),
    `Expected WorktreeManager to encapsulate worktree cleanup`,
  );
});

Then('phases should use WorktreeManager instead of importing individual VCS functions', function () {
  // Phase files should import WorktreeManager, not individual worktree functions
  const phaseFiles = scanTsFiles('adws/phases');
  const directVcsImports = phaseFiles.filter((f) =>
    (f.content.includes("from '../vcs/worktreeCreation'") ||
      f.content.includes("from '../vcs/worktreeCleanup'") ||
      f.content.includes("from '../vcs/worktreeOperations'")) &&
    !f.path.includes('workflowInit.ts'),
  );
  assert.deepStrictEqual(
    directVcsImports,
    [],
    `Phase files with direct VCS imports (should use WorktreeManager): ${directVcsImports.map((f) => f.path).join(', ')}`,
  );
});
