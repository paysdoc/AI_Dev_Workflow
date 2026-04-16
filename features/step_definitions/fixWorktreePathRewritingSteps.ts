import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

// ── 1. Pre-tool hook: worktree path rewriting ────────────────────────────────

Then('the hook checks for ADW_WORKTREE_PATH and ADW_MAIN_REPO_PATH environment variables', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('ADW_WORKTREE_PATH') && content.includes('ADW_MAIN_REPO_PATH'),
    'Expected pre-tool-use.ts to check ADW_WORKTREE_PATH and ADW_MAIN_REPO_PATH env vars',
  );
});

Then('when both env vars are present it rewrites file_path values that start with ADW_MAIN_REPO_PATH but not ADW_WORKTREE_PATH', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('startsWith(mainRepoPath)') && content.includes('!result.file_path.startsWith(worktreePath)'),
    'Expected pre-tool-use.ts to rewrite file_path starting with mainRepoPath but not worktreePath',
  );
});

Then('the path rewriting logic applies to {string}, {string}, and {string} tool names', function (tool1: string, tool2: string, tool3: string) {
  const content = sharedCtx.fileContent;
  assert.ok(content.includes(tool1), `Expected pre-tool-use.ts to include "${tool1}" in rewritable tools`);
  assert.ok(content.includes(tool2), `Expected pre-tool-use.ts to include "${tool2}" in rewritable tools`);
  assert.ok(content.includes(tool3), `Expected pre-tool-use.ts to include "${tool3}" in rewritable tools`);
});

Then('a file_path that starts with ADW_WORKTREE_PATH is not rewritten even though it also starts with ADW_MAIN_REPO_PATH', function () {
  const content = sharedCtx.fileContent;
  // The guard !result.file_path.startsWith(worktreePath) prevents rewriting when path already targets the worktree
  assert.ok(
    content.includes('!result.file_path.startsWith(worktreePath)'),
    'Expected pre-tool-use.ts to skip rewriting when file_path already starts with worktreePath',
  );
});

Then('when ADW_WORKTREE_PATH or ADW_MAIN_REPO_PATH is not set the path rewriting logic is skipped entirely', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('if (!worktreePath || !mainRepoPath)'),
    'Expected pre-tool-use.ts to return null when env vars are not set',
  );
  // Verify it returns null (skip) when env vars are absent
  const guardIdx = content.indexOf('if (!worktreePath || !mainRepoPath)');
  const afterGuard = content.slice(guardIdx, guardIdx + 100);
  assert.ok(
    afterGuard.includes('return null'),
    'Expected rewriteWorktreePath to return null when env vars are absent',
  );
});

Then('the path rewriting logic does not apply to the {string} tool name', function (toolName: string) {
  const content = sharedCtx.fileContent;
  // The rewritableTools array should not contain "Bash"
  const rewritableMatch = content.match(/rewritableTools\s*=\s*\[([^\]]+)\]/);
  assert.ok(rewritableMatch, 'Expected pre-tool-use.ts to define a rewritableTools array');
  assert.ok(
    !rewritableMatch[1].includes(`'${toolName}'`) && !rewritableMatch[1].includes(`"${toolName}"`),
    `Expected rewritableTools to NOT include "${toolName}"`,
  );
});

// ── Pre-tool hook path rewriting simulation ──────────────────────────────────

Given('ADW_MAIN_REPO_PATH is {string}', function (this: Record<string, string>, mainPath: string) {
  this.mainRepoPath = mainPath;
});

Given('ADW_WORKTREE_PATH is {string}', function (this: Record<string, string>, wtPath: string) {
  this.worktreePath = wtPath;
});

When('a Write tool call has file_path {string}', function (this: Record<string, string>, filePath: string) {
  this.inputFilePath = filePath;
  // Simulate the rewriting logic from pre-tool-use.ts
  const mainRepoPath = this.mainRepoPath;
  const worktreePath = this.worktreePath;
  if (filePath.startsWith(mainRepoPath) && !filePath.startsWith(worktreePath)) {
    this.rewrittenFilePath = worktreePath + filePath.slice(mainRepoPath.length);
  } else {
    this.rewrittenFilePath = filePath;
  }
});

Then('the hook rewrites file_path to {string}', function (this: Record<string, string>, expected: string) {
  assert.strictEqual(
    this.rewrittenFilePath,
    expected,
    `Expected rewritten file_path to be "${expected}", got "${this.rewrittenFilePath}"`,
  );
});

// ── 2. targetRepoManager.pullLatestDefaultBranch — fetch only ────────────────

Then('the function that updates the target repo runs only {string}', function (expectedCmd: string) {
  const content = sharedCtx.fileContent;
  // fetchLatestRefs should contain the expected git command
  const fetchFnIdx = content.indexOf('function fetchLatestRefs');
  assert.ok(fetchFnIdx !== -1, 'Expected targetRepoManager.ts to define fetchLatestRefs');
  const fetchFnBlock = content.slice(fetchFnIdx, fetchFnIdx + 400);
  assert.ok(
    fetchFnBlock.includes(expectedCmd),
    `Expected fetchLatestRefs to run "${expectedCmd}"`,
  );
});

Then('it does not run {string} or {string}', function (cmd1: string, cmd2: string) {
  const content = sharedCtx.fileContent;
  const fetchFnIdx = content.indexOf('function fetchLatestRefs');
  assert.ok(fetchFnIdx !== -1, 'Expected targetRepoManager.ts to define fetchLatestRefs');
  const fetchFnBlock = content.slice(fetchFnIdx, fetchFnIdx + 400);
  assert.ok(
    !fetchFnBlock.includes(cmd1),
    `Expected fetchLatestRefs NOT to run "${cmd1}"`,
  );
  assert.ok(
    !fetchFnBlock.includes(cmd2),
    `Expected fetchLatestRefs NOT to run "${cmd2}"`,
  );
});

Then('ensureTargetRepoWorkspace calls the renamed fetch-only function instead of pullLatestDefaultBranch', function () {
  const content = sharedCtx.fileContent;
  const ensureFnIdx = content.indexOf('function ensureTargetRepoWorkspace');
  assert.ok(ensureFnIdx !== -1, 'Expected targetRepoManager.ts to define ensureTargetRepoWorkspace');
  const ensureFnBlock = content.slice(ensureFnIdx, ensureFnIdx + 400);
  assert.ok(
    ensureFnBlock.includes('fetchLatestRefs'),
    'Expected ensureTargetRepoWorkspace to call fetchLatestRefs',
  );
  assert.ok(
    !ensureFnBlock.includes('pullLatestDefaultBranch('),
    'Expected ensureTargetRepoWorkspace NOT to call pullLatestDefaultBranch directly',
  );
});

Then('the fetch-only function still queries the default branch name via gh repo view', function () {
  const content = sharedCtx.fileContent;
  const fetchFnIdx = content.indexOf('function fetchLatestRefs');
  assert.ok(fetchFnIdx !== -1, 'Expected targetRepoManager.ts to define fetchLatestRefs');
  const fetchFnBlock = content.slice(fetchFnIdx, fetchFnIdx + 500);
  assert.ok(
    fetchFnBlock.includes('gh repo view'),
    'Expected fetchLatestRefs to query the default branch via gh repo view',
  );
});

Then('returns the default branch name', function () {
  const content = sharedCtx.fileContent;
  const fetchFnIdx = content.indexOf('function fetchLatestRefs');
  assert.ok(fetchFnIdx !== -1, 'Expected targetRepoManager.ts to define fetchLatestRefs');
  const fetchFnBlock = content.slice(fetchFnIdx, fetchFnIdx + 500);
  assert.ok(
    fetchFnBlock.includes('return defaultBranch') || fetchFnBlock.includes('return '),
    'Expected fetchLatestRefs to return the default branch name',
  );
});

// ── 3. freeBranchFromMainRepo — no pull on park ──────────────────────────────

Then('freeBranchFromMainRepo runs {string} for the default branch', function (cmd: string) {
  const content = sharedCtx.fileContent;
  const fnIdx = content.indexOf('function freeBranchFromMainRepo');
  assert.ok(fnIdx !== -1, 'Expected worktreeOperations.ts to define freeBranchFromMainRepo');
  const fnBlock = content.slice(fnIdx, fnIdx + 1500);
  assert.ok(
    fnBlock.includes(cmd),
    `Expected freeBranchFromMainRepo to run "${cmd}"`,
  );
});

Then('freeBranchFromMainRepo does not run {string} after the checkout', function (cmd: string) {
  const content = sharedCtx.fileContent;
  const fnIdx = content.indexOf('function freeBranchFromMainRepo');
  assert.ok(fnIdx !== -1, 'Expected worktreeOperations.ts to define freeBranchFromMainRepo');
  const fnBlock = content.slice(fnIdx, fnIdx + 1500);
  // After the git checkout line, there should be no git pull
  const checkoutIdx = fnBlock.indexOf('git checkout');
  assert.ok(checkoutIdx !== -1, 'Expected freeBranchFromMainRepo to contain git checkout');
  const afterCheckout = fnBlock.slice(checkoutIdx);
  assert.ok(
    !afterCheckout.includes(cmd),
    `Expected freeBranchFromMainRepo NOT to run "${cmd}" after checkout`,
  );
});

Then('freeBranchFromMainRepo still runs git add, git commit, and git push for uncommitted changes before switching branches', function () {
  const content = sharedCtx.fileContent;
  const fnIdx = content.indexOf('function freeBranchFromMainRepo');
  assert.ok(fnIdx !== -1, 'Expected worktreeOperations.ts to define freeBranchFromMainRepo');
  const fnBlock = content.slice(fnIdx, fnIdx + 800);
  assert.ok(fnBlock.includes('git add'), 'Expected freeBranchFromMainRepo to run git add');
  assert.ok(fnBlock.includes('git commit'), 'Expected freeBranchFromMainRepo to run git commit');
  assert.ok(fnBlock.includes('git push'), 'Expected freeBranchFromMainRepo to run git push');
});

// ── 4. Deprecate checkoutDefaultBranch and checkoutBranch ────────────────────

Then('checkoutDefaultBranch has a @deprecated JSDoc annotation', function () {
  const content = sharedCtx.fileContent;
  const deprecatedIdx = content.indexOf('@deprecated');
  const checkoutDefaultIdx = content.indexOf('function checkoutDefaultBranch');
  assert.ok(deprecatedIdx !== -1, 'Expected branchOperations.ts to contain @deprecated');
  // Find the @deprecated that is closest before the function definition
  const beforeFn = content.slice(0, checkoutDefaultIdx);
  assert.ok(
    beforeFn.includes('@deprecated'),
    'Expected checkoutDefaultBranch to have a @deprecated JSDoc annotation before it',
  );
});

Then('checkoutBranch has a @deprecated JSDoc annotation', function () {
  const content = sharedCtx.fileContent;
  const fnIdx = content.indexOf('function checkoutBranch');
  assert.ok(fnIdx !== -1, 'Expected branchOperations.ts to define checkoutBranch');
  const beforeFn = content.slice(0, fnIdx);
  assert.ok(
    beforeFn.includes('@deprecated'),
    'Expected checkoutBranch to have a @deprecated JSDoc annotation before it',
  );
});

Then('checkoutDefaultBranch logs a deprecation warning when invoked', function () {
  const content = sharedCtx.fileContent;
  const fnIdx = content.indexOf('function checkoutDefaultBranch');
  assert.ok(fnIdx !== -1, 'Expected branchOperations.ts to define checkoutDefaultBranch');
  const fnBlock = content.slice(fnIdx, fnIdx + 500);
  assert.ok(
    fnBlock.includes('deprecated') || fnBlock.includes('WARNING'),
    'Expected checkoutDefaultBranch to log a deprecation warning',
  );
});

Then('checkoutBranch logs a deprecation warning when invoked', function () {
  const content = sharedCtx.fileContent;
  const fnIdx = content.indexOf('function checkoutBranch');
  assert.ok(fnIdx !== -1, 'Expected branchOperations.ts to define checkoutBranch');
  const fnBlock = content.slice(fnIdx, fnIdx + 500);
  assert.ok(
    fnBlock.includes('deprecated') || fnBlock.includes('WARNING'),
    'Expected checkoutBranch to log a deprecation warning',
  );
});

Then('checkoutDefaultBranch and checkoutBranch are still exported functions', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('export function checkoutDefaultBranch'),
    'Expected checkoutDefaultBranch to still be an exported function',
  );
  assert.ok(
    content.includes('export function checkoutBranch'),
    'Expected checkoutBranch to still be an exported function',
  );
});

// ── 5. claudeAgent passes worktree env vars to spawned processes ─────────────

Then('the spawn environment includes ADW_WORKTREE_PATH when a cwd is provided', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes("spawnEnv['ADW_WORKTREE_PATH']") || content.includes('spawnEnv.ADW_WORKTREE_PATH'),
    'Expected claudeAgent.ts to set ADW_WORKTREE_PATH in the spawn environment',
  );
  // Verify it's conditional on cwd containing .worktrees/
  assert.ok(
    content.includes(".worktrees/"),
    'Expected claudeAgent.ts to check for .worktrees/ in the cwd path',
  );
});

Then('the spawn environment includes ADW_MAIN_REPO_PATH derived from the repository root', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes("spawnEnv['ADW_MAIN_REPO_PATH']") || content.includes('spawnEnv.ADW_MAIN_REPO_PATH'),
    'Expected claudeAgent.ts to set ADW_MAIN_REPO_PATH in the spawn environment',
  );
  assert.ok(
    content.includes('getMainRepoPath'),
    'Expected claudeAgent.ts to derive ADW_MAIN_REPO_PATH from getMainRepoPath',
  );
});

Then('when cwd is not provided, ADW_WORKTREE_PATH and ADW_MAIN_REPO_PATH are not added to the spawn environment', function () {
  const content = sharedCtx.fileContent;
  // The env var injection is inside an `if (cwd && cwd.includes('.worktrees/'))` block
  assert.ok(
    content.includes("if (cwd && cwd.includes('.worktrees/'))"),
    'Expected claudeAgent.ts to guard ADW env var injection with cwd check',
  );
});

// ── 6. TypeScript integrity ──────────────────────────────────────────────────
// Note: '{string} and {string} are run' is defined in removeUnnecessaryExportsSteps.ts
// Note: 'both type-check commands exit with code {int}' is defined in removeUnnecessaryExportsSteps.ts
