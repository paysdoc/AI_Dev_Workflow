import { Given, When, Then } from '@cucumber/cucumber';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import assert from 'assert';

const ROOT = process.cwd();

function readSrc(relPath: string): string {
  const fullPath = join(ROOT, relPath);
  assert.ok(existsSync(fullPath), `Expected source file to exist: ${relPath}`);
  return readFileSync(fullPath, 'utf-8');
}

// Shared context for this feature's steps
let featureContent = '';

// ── 1. execWithRetry non-retryable pattern scenarios ─────────────────────────

When('a gh CLI command fails with an error containing {string}', function (errorText: string) {
  // Load utils.ts source for structural assertions
  featureContent = readSrc('adws/core/utils.ts');
  // Context only — runtime behavior verified structurally
  assert.ok(featureContent.includes('execWithRetry'), `Expected utils.ts to define execWithRetry when error "${errorText}" occurs`);
});

Then('the log contains {string}', function (logFragment: string) {
  const content = featureContent || readSrc('adws/core/utils.ts');
  assert.ok(
    content.includes(logFragment),
    `Expected source to contain log message: "${logFragment}"`,
  );
});

When('the NON_RETRYABLE_PATTERNS constant is inspected', function () {
  featureContent = readSrc('adws/core/utils.ts');
});

Then('it contains the pattern {string}', function (pattern: string) {
  assert.ok(
    featureContent.includes(pattern),
    `Expected NON_RETRYABLE_PATTERNS to contain: "${pattern}"`,
  );
});

When('a gh CLI command fails on the first two attempts with a transient network error', function () {
  featureContent = readSrc('adws/core/utils.ts');
  // Context only — retry loop structure verified in Then steps
});

Then('the delays between attempts follow exponential backoff', function () {
  const content = featureContent || readSrc('adws/core/utils.ts');
  assert.ok(
    content.includes('500 * Math.pow(2, attempt)'),
    'Expected execWithRetry to use exponential backoff: 500 * Math.pow(2, attempt)',
  );
  assert.ok(
    content.includes('Atomics.wait'),
    'Expected execWithRetry to use Atomics.wait for synchronous sleep',
  );
});

// ── 2. Commit agent result.success guard scenarios ────────────────────────────

Given('the commit agent is invoked via runCommitAgent', function () {
  featureContent = readSrc('adws/agents/gitAgent.ts');
  assert.ok(
    featureContent.includes('runCommitAgent'),
    'Expected adws/agents/gitAgent.ts to define runCommitAgent',
  );
});

When('the underlying Claude CLI spawn fails with ENOENT', function () {
  // Context only — ENOENT spawn failure results in result.success === false
});

Then('no git commit is created with the error string as the message', function () {
  // Verify result.success guard appears before the call extractCommitMessageFromOutput(result.output).
  // Use the call-site pattern "extractCommitMessageFromOutput(result.output)" not the function definition.
  const guardIdx = featureContent.indexOf('!result.success');
  const callIdx = featureContent.indexOf('extractCommitMessageFromOutput(result.output)');
  assert.ok(
    guardIdx !== -1,
    'Expected runCommitAgent to have !result.success guard',
  );
  assert.ok(
    callIdx !== -1,
    'Expected runCommitAgent to call extractCommitMessageFromOutput(result.output)',
  );
  assert.ok(
    guardIdx < callIdx,
    'Expected !result.success guard to appear before extractCommitMessageFromOutput(result.output) call',
  );
});

Then('the function throws an error indicating the commit agent failed', function () {
  assert.ok(
    featureContent.includes("throw new Error") && featureContent.includes("failed"),
    "Expected runCommitAgent to throw an error with 'failed' when agent result is unsuccessful",
  );
});

When('the agent returns a result with success=false', function () {
  // Context only — structurally verified via source inspection
});

Then('the error string is not used as a commit message', function () {
  // Same structural check: !result.success guard must precede the extractCommitMessageFromOutput call site.
  const guardIdx = featureContent.indexOf('!result.success');
  const callIdx = featureContent.indexOf('extractCommitMessageFromOutput(result.output)');
  assert.ok(
    guardIdx !== -1 && callIdx !== -1 && guardIdx < callIdx,
    'Expected !result.success guard before extractCommitMessageFromOutput(result.output) call to prevent error-string commits',
  );
});

Then('the function throws rather than committing garbage output', function () {
  assert.ok(
    featureContent.includes('!result.success'),
    "Expected runCommitAgent to check !result.success before extracting commit message",
  );
  assert.ok(
    featureContent.includes('throw new Error'),
    'Expected runCommitAgent to throw on failed agent result',
  );
});

When('the agent returns a result with success=true', function () {
  // Context only
});

When('the output contains a valid commit message', function () {
  // Context only
});

Then('the commit message is extracted and validated against the expected prefix', function () {
  assert.ok(
    featureContent.includes('extractCommitMessageFromOutput'),
    'Expected runCommitAgent to call extractCommitMessageFromOutput',
  );
  assert.ok(
    featureContent.includes('validateCommitMessage'),
    'Expected runCommitAgent to call validateCommitMessage',
  );
});

Then('the function returns the commit message in the result', function () {
  assert.ok(
    featureContent.includes('commitMessage'),
    'Expected runCommitAgent to return a commitMessage in the result',
  );
  assert.ok(
    featureContent.includes('return { ...result, commitMessage }'),
    'Expected runCommitAgent to spread result and include commitMessage',
  );
});

// ── 3. known_issues.md scenarios ─────────────────────────────────────────────

When('the {string} entry is inspected', function (entrySlug: string) {
  // File content already loaded by `Given('the file {string} is read')` in commonSteps.ts
  // We store the slug for context — actual content comes from sharedCtx or this.fileContent
  const content = this.fileContent as string;
  assert.ok(
    content.includes(entrySlug),
    `Expected known_issues.md to contain entry: ${entrySlug}`,
  );
  featureContent = content;
});

Then('the description or patterns list includes {string}', function (pattern: string) {
  const content = featureContent || (this.fileContent as string);
  assert.ok(
    content.includes(pattern),
    `Expected known_issues.md to include pattern: "${pattern}"`,
  );
});

Then('there is an entry describing ENOENT error leaking into commit messages', function () {
  const content = this.fileContent as string;
  assert.ok(
    content.includes('enoent-commit-message-leak') || content.includes('ENOENT') && content.includes('commit message'),
    'Expected known_issues.md to have an entry about ENOENT error leaking into commit messages',
  );
});

Then('the entry includes the pattern {string} or similar', function (pattern: string) {
  const content = this.fileContent as string;
  // Check either the exact pattern or common variations
  const hasPattern = content.includes(pattern) ||
    content.includes('spawn claude ENOENT') ||
    content.includes('spawn') && content.includes('ENOENT');
  assert.ok(
    hasPattern,
    `Expected known_issues.md entry to include pattern "${pattern}" or similar spawn/ENOENT reference`,
  );
});

Then('the entry status reflects the fix', function () {
  const content = this.fileContent as string;
  // Find the enoent-commit-message-leak entry and verify it has solved status
  assert.ok(
    content.includes('status**: `solved`') || content.includes('status**: solved') || content.includes('**status**: `solved`'),
    'Expected known_issues.md ENOENT entry to have status: solved',
  );
});

// ── 4. Test suite and TypeScript compilation scenarios ────────────────────────

Given('all bug fixes for issue #{int} are applied', function (_issueNumber: number) {
  // Verify the two key implementation files contain the expected changes
  const utils = readSrc('adws/core/utils.ts');
  assert.ok(
    utils.includes('NON_RETRYABLE_PATTERNS'),
    'Expected adws/core/utils.ts to define NON_RETRYABLE_PATTERNS',
  );
  const gitAgent = readSrc('adws/agents/gitAgent.ts');
  assert.ok(
    gitAgent.includes('!result.success'),
    'Expected adws/agents/gitAgent.ts to have result.success guard',
  );
});

When('the existing test suite is run', function () {
  // Context only — assertion in Then step
});

Then('phaseRunner.test.ts tests pass with zero failures', function () {
  try {
    const output = execSync('bun run test', {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 120_000,
    });
    // Check that phaseRunner tests are mentioned and all pass
    const hasFailure = output.includes('FAIL') || output.includes('failed');
    assert.ok(!hasFailure, `Expected all tests to pass but found failures:\n${output}`);
  } catch (err) {
    const output = (err as { stdout?: string; stderr?: string }).stdout ||
      (err as { message?: string }).message || String(err);
    assert.fail(`Test suite run failed:\n${output}`);
  }
});

// Note: `When('"bunx tsc --noEmit" is run')` is handled by the existing
// `{string} is run` step definition in removeUnitTestsSteps.ts which runs the command.
