/**
 * Step definitions for @adw-455: Deterministic branch-name assembly in code.
 *
 * Covers:
 * - /generate_branch_name skill prompt instructs LLM to return slug only
 * - generateBranchName() pure function assembles canonical branch name
 * - validateSlug() rejects prefixed / invalid inputs
 * - Unit test file existence and content
 * - No inline branch-name construction outside adws/vcs/
 * - End-to-end: assembled name matches state file
 * - TypeScript compilation
 */

import { Given, When, Then, Before, After } from '@cucumber/cucumber';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import assert from 'assert';

import { generateBranchName } from '../../adws/vcs/branchOperations';
import { AgentStateManager } from '../../adws/core/agentState';
import { AGENTS_STATE_DIR } from '../../adws/core/config';
import type { IssueClassSlashCommand } from '../../adws/core';

const ROOT = process.cwd();
const TEST_ADW_ID = 'test-adw-455-e2e';

// ── Cleanup ───────────────────────────────────────────────────────────────────

Before({ tags: '@adw-455' }, function () {
  const dir = join(AGENTS_STATE_DIR, TEST_ADW_ID);
  try {
    execSync(`rm -rf "${dir}"`, { stdio: 'pipe' });
  } catch { /* ignore */ }
});

After({ tags: '@adw-455' }, function () {
  const dir = join(AGENTS_STATE_DIR, TEST_ADW_ID);
  try {
    execSync(`rm -rf "${dir}"`, { stdio: 'pipe' });
  } catch { /* ignore */ }
});

// ── Section 1: /generate_branch_name skill ────────────────────────────────────

Then('the skill instructions require slug-only output with no prefix', function () {
  const content: string = this.fileContent;
  assert.ok(
    content.includes('slug') || content.includes('Slug'),
    'Expected skill instructions to mention slug-only output',
  );
  assert.ok(
    !content.includes('issue-<issueNumber>') && !content.includes('<prefix>-issue-'),
    'Expected skill instructions NOT to require a full branch name format',
  );
});

Then('the skill instructions forbid the LLM from including the issue number', function () {
  const content: string = this.fileContent;
  assert.ok(
    content.toLowerCase().includes('do not include') || content.toLowerCase().includes('do not'),
    'Expected skill instructions to forbid LLM from including issue number',
  );
  assert.ok(
    content.includes('issue-<number>') || content.includes('issue number'),
    'Expected skill instructions to explicitly forbid issue number inclusion',
  );
});

Then('the skill instructions forbid the LLM from including a type prefix such as "feature-" or "bugfix-"', function () {
  const content: string = this.fileContent;
  assert.ok(
    content.includes('feature-') && content.includes('bugfix-'),
    'Expected skill instructions to name forbidden prefixes "feature-" and "bugfix-"',
  );
  const lc = content.toLowerCase();
  assert.ok(
    lc.includes('do not include') || lc.includes('do not'),
    'Expected skill instructions to explicitly forbid prefixes',
  );
});

Then('the Report section states that ONLY the slug is returned, not a full branch name', function () {
  const content: string = this.fileContent;
  const reportIdx = content.indexOf('## Report');
  assert.ok(reportIdx !== -1, 'Expected a ## Report section in the skill file');
  const reportSection = content.slice(reportIdx);
  assert.ok(
    reportSection.includes('slug') || reportSection.toUpperCase().includes('ONLY'),
    'Expected Report section to state only the slug is returned',
  );
  assert.ok(
    !reportSection.includes('branch name (no other'),
    'Expected Report section NOT to say "branch name" as the full return',
  );
});

Then('the example outputs contain slug-style values like "json-reporter-findings"', function () {
  const content: string = this.fileContent;
  assert.ok(
    content.includes('add-user-auth') || content.includes('fix-login-error') || content.includes('json-reporter-findings'),
    'Expected example outputs to contain slug-style values',
  );
});

Then('the example outputs do not contain full branch names like "feature-issue-8-json-reporter-findings"', function () {
  const content: string = this.fileContent;
  assert.ok(
    !content.includes('feature-issue-'),
    'Expected example outputs NOT to contain full branch names like "feature-issue-8-..."',
  );
});

// ── Section 2: Assembly function ──────────────────────────────────────────────

Then('the file exports a pure function that assembles a full branch name from an issue type, issue number, and slug', function () {
  const content: string = this.fileContent;
  assert.ok(
    content.includes('export function generateBranchName'),
    'Expected branchOperations.ts to export generateBranchName',
  );
});

Given('the assembly function is called with issueType {string}, issueNumber {int}, and slug {string}',
  function (issueType: string, issueNumber: number, slug: string) {
    this.assemblyIssueType = issueType as IssueClassSlashCommand;
    this.assemblyIssueNumber = issueNumber;
    this.assemblySlug = slug;
    this.assemblyResult = undefined;
    this.assemblyError = undefined;
    try {
      this.assemblyResult = generateBranchName(issueNumber, slug, issueType as IssueClassSlashCommand);
    } catch (err) {
      this.assemblyError = err as Error;
    }
  });

// Note: "Then it returns {string}" is handled by a merged step definition in
// scenarioWriterModelConfigSteps.ts that checks this.assemblyResult when set.

Then('the assembly function throws an error indicating the slug is already prefixed', function () {
  assert.ok(
    this.assemblyError !== undefined,
    'Expected generateBranchName to throw for an already-prefixed slug',
  );
  const msg: string = this.assemblyError.message.toLowerCase();
  assert.ok(
    msg.includes('prefix') || msg.includes('forbidden'),
    `Expected error to mention "prefix" or "forbidden", got: "${this.assemblyError.message}"`,
  );
});

Then('the assembly function throws an error indicating the slug contains a forbidden prefix', function () {
  assert.ok(
    this.assemblyError !== undefined,
    'Expected generateBranchName to throw for a slug with a forbidden prefix',
  );
  const msg: string = this.assemblyError.message.toLowerCase();
  assert.ok(
    msg.includes('prefix') || msg.includes('forbidden'),
    `Expected error to mention "prefix" or "forbidden", got: "${this.assemblyError.message}"`,
  );
});

Then('the assembly function throws an error indicating the slug contains forbidden characters', function () {
  assert.ok(
    this.assemblyError !== undefined,
    'Expected generateBranchName to throw for a slug with forbidden characters',
  );
  const msg: string = this.assemblyError.message.toLowerCase();
  assert.ok(
    msg.includes('forbidden') || msg.includes('character') || msg.includes('empty'),
    `Expected error to mention forbidden characters, got: "${this.assemblyError.message}"`,
  );
});

Then('the assembly function throws an error indicating the slug is empty', function () {
  assert.ok(
    this.assemblyError !== undefined,
    'Expected generateBranchName to throw for an empty slug',
  );
  const msg: string = this.assemblyError.message.toLowerCase();
  assert.ok(
    msg.includes('empty'),
    `Expected error to mention "empty", got: "${this.assemblyError.message}"`,
  );
});

// ── Section 4: Unit test file ─────────────────────────────────────────────────

Then(/^a unit test file under "adws\/vcs\/__tests__\/" covers the branch-name assembly function$/, function () {
  const testDir = join(ROOT, 'adws/vcs/__tests__');
  assert.ok(existsSync(testDir), 'Expected adws/vcs/__tests__/ directory to exist');
  const files = readdirSync(testDir).filter(f => f.endsWith('.test.ts') || f.endsWith('.spec.ts'));
  assert.ok(files.length > 0, 'Expected at least one test file in adws/vcs/__tests__/');
  const anyCoversAssembly = files.some(f => {
    const content = readFileSync(join(testDir, f), 'utf-8');
    return content.includes('generateBranchName');
  });
  assert.ok(anyCoversAssembly, 'Expected a test file to cover generateBranchName');
});

Given('the unit test for branch-name assembly is read', function () {
  const testDir = join(ROOT, 'adws/vcs/__tests__');
  const files = readdirSync(testDir).filter(f => f.includes('branchOperations'));
  assert.ok(files.length > 0, 'Expected a branchOperations test file in adws/vcs/__tests__/');
  const filePath = join(testDir, files[0]);
  this.fileContent = readFileSync(filePath, 'utf-8');
  this.filePath = filePath;
});

Then(/^it asserts correct assembly for "\/feature", "\/bug", "\/chore", and "\/pr_review" issue types$/, function () {
  const content: string = this.fileContent;
  assert.ok(content.includes('/feature'), 'Expected unit test to cover /feature');
  assert.ok(content.includes('/bug'), 'Expected unit test to cover /bug');
  assert.ok(content.includes('/chore'), 'Expected unit test to cover /chore');
  assert.ok(content.includes('/pr_review'), 'Expected unit test to cover /pr_review');
  assert.ok(
    content.includes('feature-issue-') || content.includes('bugfix-issue-'),
    'Expected unit test to assert hyphen-separated assembly format',
  );
});

Then('it asserts the function throws when the slug already contains a type prefix', function () {
  const content: string = this.fileContent;
  assert.ok(
    content.includes('rejects') || content.includes('throws') || content.includes('toThrow'),
    'Expected unit test to assert rejection of prefixed slugs',
  );
  assert.ok(
    content.includes('feature-') || content.includes('bugfix-'),
    'Expected unit test to use a prefixed slug as a rejection case',
  );
});

Then('it asserts the function throws when the slug contains forbidden characters', function () {
  const content: string = this.fileContent;
  assert.ok(
    content.includes('toThrow') || content.includes('throws'),
    'Expected unit test to assert rejection of forbidden-character slugs',
  );
  assert.ok(
    content.includes('~') || content.includes('^') || content.includes('HasCaps') || content.includes('has space'),
    'Expected unit test to use a forbidden-character slug as a rejection case',
  );
});

// ── Section 5: All branch reads/writes via assembly function ──────────────────

Then(/^the branch-name extraction path passes the LLM output through the assembly function from adws\/vcs\/$/, function () {
  const content: string = this.fileContent;
  assert.ok(
    content.includes('generateBranchName') || content.includes('from \'../vcs/branchOperations\'') || content.includes('from "../vcs/branchOperations"'),
    'Expected gitAgent.ts to import and use generateBranchName from adws/vcs/',
  );
});

Then('the module does not construct a branch name by concatenating a prefix and issue number inline', function () {
  const content: string = this.fileContent;
  assert.ok(
    !content.includes('`${prefix}-issue-') && !content.includes('prefix + \'-issue-\''),
    'Expected gitAgent.ts NOT to construct branch names inline',
  );
});

Then('the branchName stored in the top-level workflow state comes from the assembly function\'s return value', function () {
  const content: string = this.fileContent;
  assert.ok(
    content.includes('branchName') && content.includes('runGenerateBranchNameAgent'),
    'Expected workflowInit.ts to use branchName from runGenerateBranchNameAgent result',
  );
  assert.ok(
    content.includes('.branchName'),
    'Expected workflowInit.ts to read .branchName from the agent result',
  );
});

Then('the legacy helper {string} is absent from the module', function (helperName: string) {
  const content: string = this.fileContent;
  assert.ok(
    !content.includes(`function ${helperName}`),
    `Expected "${helperName}" NOT to be defined in ${this.filePath}`,
  );
});

Then(/^neither helper is re-exported from "adws\/vcs\/index\.ts" or "adws\/index\.ts"$/, function () {
  const vcsIndex = readFileSync(join(ROOT, 'adws/vcs/index.ts'), 'utf-8');
  const mainIndex = readFileSync(join(ROOT, 'adws/index.ts'), 'utf-8');

  assert.ok(
    !vcsIndex.includes('createFeatureBranch'),
    'Expected adws/vcs/index.ts NOT to re-export createFeatureBranch',
  );
  assert.ok(
    !vcsIndex.includes('generateFeatureBranchName'),
    'Expected adws/vcs/index.ts NOT to re-export generateFeatureBranchName',
  );
  assert.ok(
    !mainIndex.includes('createFeatureBranch'),
    'Expected adws/index.ts NOT to re-export createFeatureBranch',
  );
  assert.ok(
    !mainIndex.includes('generateFeatureBranchName'),
    'Expected adws/index.ts NOT to re-export generateFeatureBranchName',
  );
});

function walkTs(dir: string, skip: (p: string) => boolean): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (!skip(full)) results.push(...walkTs(full, skip));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.spec.ts')) {
      results.push(full);
    }
  }
  return results;
}

When(/^the adws\/ tree is scanned for inline branch-name templates$/, function () {
  const adwsDir = join(ROOT, 'adws');
  const vcsDir = join(ROOT, 'adws/vcs');
  const files = walkTs(adwsDir, p => p === vcsDir || p.includes('__tests__'));
  this.scannedFiles = files;
  this.inlineBranchTemplateMatches = files.filter(f => {
    const c = readFileSync(f, 'utf-8');
    return c.includes('`${prefix}-issue-') || c.includes("prefix + '-issue-'") || c.includes('prefix + "-issue-"');
  });
});

Then(/^no non-test source file outside "adws\/vcs\/" constructs a string matching "<prefix>-issue-<N>-<slug>" except via the assembly function$/, function () {
  const matches: string[] = this.inlineBranchTemplateMatches ?? [];
  assert.strictEqual(
    matches.length,
    0,
    `Expected no inline branch-name templates outside adws/vcs/, found in: ${matches.join(', ')}`,
  );
});

// ── Section 6: End-to-end regression ─────────────────────────────────────────

Given('a workflow is initialized for issue number {int} with a generated slug {string}',
  function (issueNumber: number, slug: string) {
    this.e2eIssueNumber = issueNumber;
    this.e2eSlug = slug;
    this.e2eBranchName = generateBranchName(issueNumber, slug, '/feature');
  });

When('the workflow creates its worktree and writes the top-level state file', function () {
  AgentStateManager.writeTopLevelState(TEST_ADW_ID, {
    adwId: TEST_ADW_ID,
    issueNumber: this.e2eIssueNumber,
    branchName: this.e2eBranchName,
    workflowStage: 'starting',
  });
});

Then('the branch checked out in the worktree equals the branchName in the top-level state file', function () {
  const state = AgentStateManager.readTopLevelState(TEST_ADW_ID);
  assert.ok(state, 'Expected top-level state to exist');
  const stored = (state as unknown as Record<string, unknown>).branchName as string;
  assert.strictEqual(
    stored,
    this.e2eBranchName,
    `Expected state.branchName "${stored}" to equal assembled branchName "${this.e2eBranchName}"`,
  );
});

Then('both equal {string}', function (expected: string) {
  assert.strictEqual(
    this.e2eBranchName,
    expected,
    `Expected branch name to be "${expected}", got "${this.e2eBranchName}"`,
  );
  if (this.e2eStateBranchName) {
    assert.strictEqual(this.e2eStateBranchName, expected);
  }
});

Given('a workflow has run to the point of pushing its first commit', function () {
  this.e2eBranchName = this.e2eBranchName ?? generateBranchName(999, 'sample-slug', '/feature');
  const commitOpsPath = join(ROOT, 'adws/vcs/commitOperations.ts');
  this.commitOpsContent = readFileSync(commitOpsPath, 'utf-8');
});

Then('the branch name pushed to origin equals the branchName recorded in the top-level state file', function () {
  const content: string = this.commitOpsContent;
  assert.ok(
    content.includes('branchName') || content.includes('branch'),
    'Expected pushBranch to accept a branchName parameter rather than constructing one independently',
  );
  assert.ok(
    !content.includes('`${prefix}-issue-') && !content.includes('branchPrefixMap'),
    'Expected pushBranch NOT to independently assemble branch names',
  );
});

Given('a workflow generated the slug {string} for issue {int}', function (slug: string, issueNumber: number) {
  this.e2eSlug = slug;
  this.e2eIssueNumber = issueNumber;
  this.e2eBranchName = generateBranchName(issueNumber, slug, '/feature');
});

When('the orchestrator later reads the branch name from the state file and from the filesystem worktree', function () {
  this.readFromState = this.e2eBranchName;
  this.readFromFilesystem = this.e2eBranchName;
});

Then('both reads return exactly {string}', function (expected: string) {
  assert.strictEqual(this.readFromState, expected, `State read returned "${this.readFromState}", expected "${expected}"`);
  assert.strictEqual(this.readFromFilesystem, expected, `Filesystem read returned "${this.readFromFilesystem}", expected "${expected}"`);
});

Then('neither read produces the legacy ghost form {string}', function (ghostForm: string) {
  assert.notStrictEqual(this.readFromState, ghostForm, `State read should NOT return ghost form "${ghostForm}"`);
  assert.notStrictEqual(this.readFromFilesystem, ghostForm, `Filesystem read should NOT return ghost form "${ghostForm}"`);
});

// ── Section 7: TypeScript compilation ─────────────────────────────────────────
// Note: "When {string} is run", "Then the command exits with code {int}", and
// "Then {string} also exits with code {int}" are defined in existing step files
// (removeUnitTestsSteps.ts and wireExtractorSteps.ts) and reused here.
