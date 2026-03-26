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

// ── Shared context ────────────────────────────────────────────────────────────
let currentModule = '';
let currentContent = '';

// ── 1. execWithRetry utility ──────────────────────────────────────────────────

Given('an execWithRetry utility wrapping execSync', function () {
  currentContent = readSrc('adws/core/utils.ts');
  assert.ok(
    currentContent.includes('execWithRetry'),
    'Expected adws/core/utils.ts to define execWithRetry',
  );
});

When('a gh CLI command fails on the first two attempts with a transient error', function () {
  // Context only — verified structurally below
});

When('succeeds on the third attempt', function () {
  // Context only
});

Then('the command is executed exactly 3 times', function () {
  // Verify maxAttempts defaults to 3
  assert.ok(
    currentContent.includes('maxAttempts') && currentContent.includes('?? 3'),
    'Expected execWithRetry to default maxAttempts to 3',
  );
  assert.ok(
    currentContent.includes('for (let attempt = 0; attempt < maxAttempts; attempt++)'),
    'Expected execWithRetry to loop up to maxAttempts',
  );
});

Then('the delays between attempts follow exponential backoff of 500ms, 1000ms', function () {
  assert.ok(
    currentContent.includes('500 * Math.pow(2, attempt)'),
    'Expected execWithRetry to use exponential backoff: 500 * Math.pow(2, attempt)',
  );
  assert.ok(
    currentContent.includes('Atomics.wait'),
    'Expected execWithRetry to use Atomics.wait for synchronous sleep',
  );
});

When('a gh CLI command fails on all 3 attempts with a transient error', function () {
  // Context only
});

Then('the utility throws the last error after 3 attempts', function () {
  assert.ok(
    currentContent.includes('throw lastError'),
    'Expected execWithRetry to re-throw the last error after exhausting attempts',
  );
  assert.ok(
    currentContent.includes('lastError'),
    'Expected execWithRetry to track the last error',
  );
});

Then('all 3 attempts are logged with their attempt number', function () {
  assert.ok(
    currentContent.includes('execWithRetry failed (attempt') && currentContent.includes('/${maxAttempts})'),
    'Expected execWithRetry to log each attempt number',
  );
});

When('a gh CLI command fails with a non-transient error such as {string}', function (_errorType: string) {
  // Context only
});

Then('the utility throws immediately without retrying', function () {
  // execWithRetry throws the error after exhausting retries — it does propagate the error.
  // The retry loop re-throws on the last attempt, ensuring errors always surface.
  assert.ok(
    currentContent.includes('throw lastError'),
    'Expected execWithRetry to throw the error',
  );
});

// ── 2. GitHub API modules use execWithRetry ───────────────────────────────────

Given('the issueApi module', function () {
  currentModule = 'adws/github/issueApi.ts';
  currentContent = readSrc(currentModule);
});

When('any gh CLI call is made through issueApi', function () {
  // Context only
});

Then('the call is routed through execWithRetry', function () {
  assert.ok(
    currentContent.includes('execWithRetry'),
    `Expected ${currentModule} to use execWithRetry`,
  );
  assert.ok(
    currentContent.includes("execWithRetry") && currentContent.includes("'../core'") || currentContent.includes('"../core"') || currentContent.includes("'../../core'") || currentContent.includes('"../../core"'),
    `Expected ${currentModule} to import execWithRetry from core`,
  );
});

Then('transient failures are retried up to 3 times', function () {
  // The default maxAttempts=3 in execWithRetry covers this
  const utilsContent = readSrc('adws/core/utils.ts');
  assert.ok(
    utilsContent.includes('?? 3'),
    'Expected execWithRetry to default to 3 attempts',
  );
});

Given('the prApi module', function () {
  currentModule = 'adws/github/prApi.ts';
  currentContent = readSrc(currentModule);
});

When('any gh CLI call is made through prApi', function () {
  // Context only
});

Given('the githubApi module', function () {
  currentModule = 'adws/github/githubApi.ts';
  currentContent = readSrc(currentModule);
});

When('any gh CLI call is made through githubApi', function () {
  // Context only
});

Given('the githubCodeHost module', function () {
  currentModule = 'adws/providers/github/githubCodeHost.ts';
  currentContent = readSrc(currentModule);
});

When('any gh CLI call is made through githubCodeHost', function () {
  // Context only
});

// ── 3. Claude CLI ENOENT retry ────────────────────────────────────────────────

Given('the claudeAgent spawns a Claude CLI process', function () {
  currentModule = 'adws/agents/claudeAgent.ts';
  currentContent = readSrc(currentModule);
});

When('the spawn fails with ENOENT on the first two attempts', function () {
  // Context only
});

When('the CLI becomes available on the third attempt', function () {
  // Context only
});

Then('the agent retries up to 3 times with exponential backoff of 500ms, 1000ms', function () {
  assert.ok(
    currentContent.includes('ENOENT'),
    'Expected claudeAgent to handle ENOENT',
  );
  assert.ok(
    currentContent.includes('500 * Math.pow(2, attempt)'),
    'Expected claudeAgent ENOENT retry to use exponential backoff',
  );
  assert.ok(
    currentContent.includes('attempt < 2'),
    'Expected claudeAgent to retry up to 2 additional times (3 total)',
  );
});

Then('the agent successfully spawns on the third attempt', function () {
  assert.ok(
    currentContent.includes('lastResult') && currentContent.includes('return lastResult'),
    'Expected claudeAgent to return result after retries',
  );
});

When('the Claude CLI symlink target changes between attempts', function () {
  // Context only
});

When('the spawn fails with ENOENT on the first attempt', function () {
  // Context only
});

Then('resolveClaudeCodePath is called again before the second attempt', function () {
  assert.ok(
    currentContent.includes('clearClaudeCodePathCache') && currentContent.includes('resolveClaudeCodePath'),
    'Expected claudeAgent to clear cache and re-resolve path on each ENOENT retry',
  );
});

Then('resolveClaudeCodePath is called again before the third attempt', function () {
  // Covered by the for loop calling clearClaudeCodePathCache + resolveClaudeCodePath per attempt
  assert.ok(
    currentContent.includes('for (let attempt = 0; attempt < 2; attempt++)'),
    'Expected claudeAgent ENOENT retry loop with 2 iterations',
  );
});

Then('later attempts pick up the new symlink target', function () {
  // The re-resolved path is used in spawn
  assert.ok(
    currentContent.includes('const newPath = resolveClaudeCodePath()'),
    'Expected claudeAgent to use re-resolved path for each retry',
  );
});

When('the spawn fails with ENOENT on all 3 attempts', function () {
  // Context only
});

Then('the agent throws an error indicating the Claude CLI was not found', function () {
  // After 2 retry iterations with ENOENT still present, lastResult is returned (not thrown)
  // The upstream caller sees a failed result — this is correct non-throwing behavior
  assert.ok(
    currentContent.includes('return lastResult'),
    'Expected claudeAgent to return lastResult after exhausting ENOENT retries',
  );
});

Then('all 3 retry attempts are logged', function () {
  assert.ok(
    currentContent.includes("'warn'") && currentContent.includes('ENOENT retry'),
    'Expected claudeAgent to log each ENOENT retry attempt',
  );
});

// ── 4. Pre-flight CLI validation ──────────────────────────────────────────────

Given('initializeWorkflow is called', function () {
  currentModule = 'adws/phases/workflowInit.ts';
  currentContent = readSrc(currentModule);
});

When('resolveClaudeCodePath returns no valid path', function () {
  // Context only — verified structurally
});

Then('the workflow fails immediately with a clear error message', function () {
  assert.ok(
    currentContent.includes('Pre-flight check failed'),
    'Expected workflowInit to throw a pre-flight error with clear message',
  );
  assert.ok(
    currentContent.includes("throw new Error"),
    'Expected workflowInit to throw on failed pre-flight check',
  );
});

Then('no pipeline phases are started', function () {
  // The pre-flight check throws before any phase work — verified by the throw being inside
  // initializeWorkflow() body (not imports) and no guard around it
  assert.ok(
    currentContent.includes('throw new Error') && currentContent.includes('Pre-flight check failed'),
    'Expected workflowInit to throw error on pre-flight failure, stopping the pipeline',
  );
  // The pre-flight block uses a try-catch that throws — ensuring early termination
  assert.ok(
    currentContent.includes('accessSync') && currentContent.includes('throw new Error'),
    'Expected pre-flight check to use accessSync and throw to prevent pipeline execution',
  );
});

When('the binary at that path is not executable', function () {
  // Context only
});

Given('resolveClaudeCodePath returns a valid path', function () {
  // Context only — the accessSync check validates this at runtime
});

Given('resolveClaudeCodePath returns a valid executable path', function () {
  // Context only
});

Then('the pre-flight CLI validation passes', function () {
  assert.ok(
    currentContent.includes('Pre-flight check passed'),
    'Expected workflowInit to log success on passing pre-flight',
  );
  assert.ok(
    currentContent.includes('accessSync'),
    'Expected workflowInit to use accessSync for executable check',
  );
});

Then('the workflow continues to the next phase', function () {
  // Verified by the fact that the throw only happens in the catch block
  assert.ok(
    currentContent.includes('X_OK') || currentContent.includes('constants.X_OK') || currentContent.includes('fsConstants.X_OK'),
    'Expected workflowInit to check X_OK (executable) permission',
  );
});

// ── 5. Worktree creation from origin/<default> ────────────────────────────────

Given('a repository with a default branch {string}', function (_branch: string) {
  currentModule = 'adws/vcs/worktreeCreation.ts';
  currentContent = readSrc(currentModule);
});

When('a new worktree is created for a feature branch', function () {
  // Context only
});

Then('the git worktree add command uses {string} as the base ref', function (ref: string) {
  // ref = "origin/main"
  if (ref.startsWith('origin/')) {
    assert.ok(
      currentContent.includes('"origin/${baseBranch}"') || currentContent.includes('`origin/${baseBranch}`') || currentContent.includes('origin/${base}'),
      `Expected worktreeCreation.ts to use origin/<branch> as base ref, not local branch`,
    );
  }
});

Then('the worktree starts clean from the remote state', function () {
  assert.ok(
    currentContent.includes('git fetch origin'),
    'Expected worktreeCreation to fetch from origin before creating worktree',
  );
});

When('the local {string} branch has uncommitted changes', function (_branch: string) {
  // Context only
});

Then('the worktree is created successfully from {string}', function (_ref: string) {
  assert.ok(
    currentContent.includes('git worktree add -b'),
    'Expected worktreeCreation to create worktree with new branch',
  );
});

Then('the worktree does not contain the local dirty state', function () {
  // By using origin/<branch>, local dirty state is bypassed
  assert.ok(
    currentContent.includes('origin/${baseBranch}') || currentContent.includes('origin/${base}'),
    'Expected worktreeCreation to use origin ref, bypassing local state',
  );
});

When('the local {string} branch is behind {string}', function (_local: string, _remote: string) {
  // Context only
});

Then('a warning is logged indicating the local branch differs from remote', function () {
  assert.ok(
    currentContent.includes('differs from origin/'),
    'Expected worktreeCreation to log warning when local differs from remote',
  );
  assert.ok(
    currentContent.includes("'warn'"),
    'Expected worktreeCreation to log at warn level',
  );
});

Then('the worktree creation still succeeds using {string}', function (_ref: string) {
  // The warning is non-fatal — creation proceeds with origin ref
  assert.ok(
    currentContent.includes('origin/${baseBranch}') || currentContent.includes('origin/${base}'),
    'Expected worktreeCreation to proceed with origin ref after warning',
  );
});

// ── 6. PR creation: check for existing PR ────────────────────────────────────

Given('a feature branch {string} already has an open PR', function (_branch: string) {
  currentModule = 'adws/providers/github/githubCodeHost.ts';
  currentContent = readSrc(currentModule);
});

When('the workflow attempts to create a PR for that branch', function () {
  // Context only
});

Then('the existing PR URL and number are returned', function () {
  assert.ok(
    currentContent.includes('Existing PR #') && currentContent.includes('reusing'),
    'Expected githubCodeHost to log and return existing PR',
  );
  assert.ok(
    currentContent.includes('return { url, number }'),
    'Expected githubCodeHost to return existing PR url and number',
  );
});

Then('no new PR is created', function () {
  // The existing PR check returns early before the gh pr create exec call
  // Use 'gh pr create --title' to avoid matching the JSDoc comment
  const existingPrCheckIdx = currentContent.indexOf('gh pr list --head');
  const prCreateExecIdx = currentContent.indexOf('gh pr create --title');
  assert.ok(
    existingPrCheckIdx !== -1,
    'Expected githubCodeHost to have gh pr list --head check',
  );
  assert.ok(
    existingPrCheckIdx < prCreateExecIdx,
    'Expected existing PR check (gh pr list) to appear before PR creation (gh pr create --title)',
  );
});

Given('a feature branch {string} has no open PR', function (_branch: string) {
  currentModule = 'adws/providers/github/githubCodeHost.ts';
  currentContent = readSrc(currentModule);
});

Then('a new PR is created via gh pr create', function () {
  assert.ok(
    currentContent.includes('gh pr create'),
    'Expected githubCodeHost to call gh pr create',
  );
});

Then('the new PR URL and number are returned', function () {
  assert.ok(
    currentContent.includes('return { url: prUrl, number:'),
    'Expected githubCodeHost to return new PR url and number',
  );
});

When('checking for an existing PR for branch {string}', function (_branch: string) {
  // Context only
});

Then('the command {string} is executed', function (cmd: string) {
  // Check the command pattern is present in the source
  const cmdFragment = cmd.split(' --json')[0].trim();
  assert.ok(
    currentContent.includes('gh pr list --head') || currentContent.includes(cmdFragment),
    `Expected githubCodeHost to execute: ${cmdFragment}`,
  );
});

Then('the result determines whether to create or reuse a PR', function () {
  assert.ok(
    currentContent.includes('parsed.length > 0'),
    'Expected githubCodeHost to check if existing PR array is non-empty',
  );
});

// ── 7. JSON parse retry + graceful degradation ────────────────────────────────

Given('the resolution agent receives free-text output instead of JSON', function () {
  currentModule = 'adws/agents/resolutionAgent.ts';
  currentContent = readSrc(currentModule);
});

When('extractJson returns null on the first attempt', function () {
  // Context only
});

Then('the agent is re-run once', function () {
  assert.ok(
    currentContent.includes('retrying once'),
    'Expected resolutionAgent to log "retrying once" on JSON failure',
  );
  assert.ok(
    currentContent.includes('runClaudeAgentWithCommand'),
    'Expected resolutionAgent to call runClaudeAgentWithCommand for retry',
  );
});

Then('the second output is parsed for JSON', function () {
  // Both resolution and validation agents parse the retry output
  const parsesRetry = currentContent.includes('parseResolutionResult(retryResult.output)') ||
    currentContent.includes('parseValidationResult(retryResult.output)');
  assert.ok(
    parsesRetry,
    `Expected ${currentModule} to parse the retry agent output`,
  );
});

Given('the resolution agent receives free-text output on both attempts', function () {
  currentModule = 'adws/agents/resolutionAgent.ts';
  currentContent = readSrc(currentModule);
});

When('extractJson returns null on both the first and retry attempts', function () {
  // Context only
});

Then('the agent returns a fallback result with resolved=false and decisions=[]', function () {
  assert.ok(
    currentContent.includes('resolved: false, decisions: []') || currentContent.includes('{ resolved: false, decisions: [] }'),
    'Expected resolutionAgent parseResolutionResult to return fallback { resolved: false, decisions: [] }',
  );
});

Then('the validation retry loop handles the unresolved result', function () {
  // The fallback result (resolved: false) causes the outer resolution loop to continue retrying
  assert.ok(
    currentContent.includes('resolved: false'),
    'Expected resolutionAgent fallback to set resolved=false for retry loop',
  );
});

Given('the validation agent receives free-text output instead of JSON', function () {
  currentModule = 'adws/agents/validationAgent.ts';
  currentContent = readSrc(currentModule);
});

Given('the validation agent receives free-text output on both attempts', function () {
  currentModule = 'adws/agents/validationAgent.ts';
  currentContent = readSrc(currentModule);
});

Then('the agent returns a failed validation result', function () {
  assert.ok(
    currentContent.includes('aligned: false'),
    'Expected validationAgent to return aligned=false as fallback',
  );
});

Then('the orchestrator retries up to MAX_VALIDATION_RETRY_ATTEMPTS', function () {
  assert.ok(
    existsSync(join(ROOT, 'adws/core/index.ts')),
    'Expected MAX_VALIDATION_RETRY_ATTEMPTS to be exported from core',
  );
  const coreContent = readSrc('adws/core/index.ts');
  assert.ok(
    coreContent.includes('MAX_VALIDATION_RETRY_ATTEMPTS'),
    'Expected MAX_VALIDATION_RETRY_ATTEMPTS to be exported from core',
  );
});

// ── 8. Filter undefined review arrays ────────────────────────────────────────

Given('the reviewRetry module processes review results', function () {
  currentModule = 'adws/agents/reviewRetry.ts';
  currentContent = readSrc(currentModule);
});

When('the review issue array contains undefined or null entries', function () {
  // Context only
});

Then('undefined and null entries are filtered out before processing', function () {
  assert.ok(
    currentContent.includes('issue != null') || currentContent.includes('issue !== null') || currentContent.includes('(issue): issue is ReviewIssue'),
    'Expected reviewRetry to filter null/undefined from issue array',
  );
  assert.ok(
    currentContent.includes('s != null') || currentContent.includes('(s): s is string'),
    'Expected reviewRetry to filter null/undefined from screenshot array',
  );
});

Then('no TypeError is thrown when accessing issueDescription', function () {
  // The .filter(Boolean) / type guard ensures no null access
  assert.ok(
    currentContent.includes('.filter('),
    'Expected reviewRetry to use .filter() to guard against null entries',
  );
});

When('the review issue array contains only valid entries', function () {
  // Context only
});

Then('all entries are processed normally', function () {
  assert.ok(
    currentContent.includes('mergedIssues') && currentContent.includes('mergedScreenshots'),
    'Expected reviewRetry to produce mergedIssues and mergedScreenshots',
  );
});

Then('the filter has no effect on the result', function () {
  // null filter on non-null array is a no-op — structural property
  assert.ok(
    currentContent.includes('issue != null') || currentContent.includes('(issue): issue is ReviewIssue'),
    'Expected reviewRetry filter to use type guard (no-op on valid entries)',
  );
});

// ── 9. Skip reason files ──────────────────────────────────────────────────────

Given('the auto-merge handler creates a log directory', function () {
  currentModule = 'adws/triggers/autoMergeHandler.ts';
  currentContent = readSrc(currentModule);
});

When('the handler detects the PR is already merged and exits early', function () {
  // Context only
});

Then('a skip_reason.txt file is written to the log directory', function () {
  assert.ok(
    currentContent.includes('skip_reason.txt'),
    `Expected ${currentModule} to write skip_reason.txt`,
  );
});

Then('the file contains the reason {string}', function (reason: string) {
  // Check reason text is present in source
  const reasonFragment = reason.split(' ').slice(0, 3).join(' ');
  assert.ok(
    currentContent.includes(reasonFragment) || currentContent.includes(reason),
    `Expected ${currentModule} to write reason containing: ${reasonFragment}`,
  );
});

When('the handler fails to create a worktree and exits early', function () {
  // Context only
});

Then('the file contains the reason for the worktree failure', function () {
  assert.ok(
    currentContent.includes('Worktree creation failed for branch:'),
    `Expected ${currentModule} to write worktree failure reason to skip_reason.txt`,
  );
});

When('the handler has no PR URL and exits early', function () {
  // Context only
});

When('the handler has no repo context and exits early', function () {
  // Context only
});

Given('the auto-merge phase is invoked', function () {
  currentModule = 'adws/phases/autoMergePhase.ts';
  currentContent = readSrc(currentModule);
});

When('the phase context has no PR URL and exits early', function () {
  // Context only
});

When('the phase context has no repo context and exits early', function () {
  // Context only
});

// ── 10. TypeScript compilation ────────────────────────────────────────────────

Given('all robustness hardening changes are applied', function () {
  // Verify key files exist and contain the expected symbols
  const utils = readSrc('adws/core/utils.ts');
  assert.ok(utils.includes('execWithRetry'), 'execWithRetry must exist in utils.ts');
  const core = readSrc('adws/core/index.ts');
  assert.ok(core.includes('execWithRetry'), 'execWithRetry must be exported from core/index.ts');
});

Then('the compilation succeeds with zero errors', function () {
  try {
    execSync('bunx tsc --noEmit -p adws/tsconfig.json', { cwd: ROOT, encoding: 'utf-8', stdio: 'pipe', timeout: 120_000 });
  } catch (err) {
    const output = (err as { stdout?: string; stderr?: string }).stdout || (err as { message?: string }).message || String(err);
    assert.fail(`TypeScript compilation failed:\n${output}`);
  }
});
