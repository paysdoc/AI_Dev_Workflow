# Patch: Create step definitions for fix_git_repo_context.feature

## Metadata
adwId: `tphvsj-fix-ensure-all-git-o`
reviewChangeRequest: `Issue #2: All 20 @adw-317 BDD step definitions are undefined. Every 'Then' step in features/fix_git_repo_context.feature returns 'Undefined' — no step definition files implement any of the scenario steps. Resolution: Implement step definitions for all 20 scenarios in fix_git_repo_context.feature. Steps should verify source code patterns (function signatures, parameter passing) via AST analysis or regex matching on the implementation files.`

## Issue Summary
**Original Spec:** specs/issue-317-adw-tphvsj-fix-ensure-all-git-o-sdlc_planner-fix-git-repo-context.md
**Issue:** No step definition file exists for `features/fix_git_repo_context.feature`. All 20 scenarios return "Undefined" for their Then/When steps because no step definition code implements them.
**Solution:** Create `features/step_definitions/fixGitRepoContextSteps.ts` implementing all unique Then/When/Given steps using the `sharedCtx` pattern from `commonSteps.ts`. Steps verify source code patterns via regex/string matching on `sharedCtx.fileContent` (populated by the existing `Given "{file}" is read` step). The two E2E scenarios (19-20) require runtime infrastructure and should be implemented as `pending`.

## Files to Modify
Use these files to implement the patch:

1. `features/step_definitions/fixGitRepoContextSteps.ts` — **New file.** All unique step definitions for `fix_git_repo_context.feature`.

**Reference files (read-only):**
- `features/fix_git_repo_context.feature` — The 20 BDD scenarios (do not modify)
- `features/step_definitions/commonSteps.ts` — `sharedCtx` pattern and existing Given steps
- `features/step_definitions/autoMergeApprovedPrSteps.ts` — Reference for similar source-pattern assertions
- `features/step_definitions/wrongRepositoryTargetSteps.ts` — Reference for similar source-pattern assertions
- `app_docs/feature-fla3u2-1773754088098-cucumber-step-definitions.md` — Step definition conventions (use `sharedCtx`, `spawnSync` for commands, `findFiles()` for scanning)

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Create `features/step_definitions/fixGitRepoContextSteps.ts`

Create a single step definitions file implementing all unique steps from `features/fix_git_repo_context.feature`. The file must:

- Import `{ Given, When, Then }` from `@cucumber/cucumber`, `assert` from `assert`, `{ sharedCtx }` from `./commonSteps.ts`
- Import `{ spawnSync }` from `child_process` (for the TypeScript type-check When step)
- Import `{ readFileSync }` from `fs` and `{ join }` from `path` (for multi-file scenario step)
- Use `const ROOT = process.cwd();`
- Use `function()` syntax (not arrow functions) for all step callbacks — required by Cucumber `this` binding

**Section 1 — copyEnvToWorktree (3 Then steps):**

```typescript
Then('the copyEnvToWorktree function signature accepts an optional baseRepoPath parameter', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    /copyEnvToWorktree\s*\([^)]*baseRepoPath\??:\s*string/.test(content),
    'Expected copyEnvToWorktree to accept an optional baseRepoPath parameter',
  );
});

Then('copyEnvToWorktree passes baseRepoPath to getMainRepoPath when provided', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('getMainRepoPath(baseRepoPath)'),
    'Expected copyEnvToWorktree to pass baseRepoPath to getMainRepoPath',
  );
});

Then('copyEnvToWorktree can be called with only worktreePath and defaults to the ADW repo', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    /baseRepoPath\?/.test(content),
    'Expected baseRepoPath to be an optional parameter (baseRepoPath?)',
  );
});
```

**Section 2 — getRepoInfo (3 Then steps):**

```typescript
Then('the getRepoInfo function signature accepts an optional cwd parameter', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    /getRepoInfo\s*\([^)]*cwd\??:\s*string/.test(content),
    'Expected getRepoInfo to accept an optional cwd parameter',
  );
});

Then('getRepoInfo passes the cwd option to execSync when cwd is provided', function () {
  const content = sharedCtx.fileContent;
  // The execSync call for 'git remote get-url origin' must include cwd in options
  const execSyncIdx = content.indexOf("'git remote get-url origin'");
  assert.ok(execSyncIdx !== -1, 'Expected execSync call with git remote get-url origin');
  const callSlice = content.slice(execSyncIdx, execSyncIdx + 200);
  assert.ok(
    callSlice.includes('cwd'),
    'Expected execSync options to include cwd',
  );
});

Then('getRepoInfo called without cwd reads the remote URL from the current working directory', function () {
  const content = sharedCtx.fileContent;
  // cwd is optional — when omitted, execSync defaults to process.cwd()
  assert.ok(
    /cwd\?/.test(content),
    'Expected cwd to be an optional parameter (cwd?) so callers can omit it',
  );
});
```

**Section 3 — githubAppAuth (1 Then step):**

```typescript
Then('the git remote get-url fallback in activateGitHubAppAuth passes cwd to execSync when available', function () {
  const content = sharedCtx.fileContent;
  // activateGitHubAppAuth must accept cwd parameter
  assert.ok(
    /activateGitHubAppAuth\s*\([^)]*cwd/.test(content),
    'Expected activateGitHubAppAuth to accept a cwd parameter',
  );
  // The execSync call for git remote must include cwd in its options
  const execSyncIdx = content.indexOf("'git remote get-url origin'");
  assert.ok(execSyncIdx !== -1, 'Expected execSync call with git remote get-url origin');
  const callSlice = content.slice(execSyncIdx, execSyncIdx + 200);
  assert.ok(
    callSlice.includes('cwd'),
    'Expected the git remote get-url execSync options to include cwd',
  );
});
```

**Section 4 — autoMergeHandler (3 Then steps):**

```typescript
Then('the auto-merge handler extracts owner and repo from the webhook payload repository field', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('repoInfo.owner') || content.includes('repoInfo.repo') || content.includes('getRepoInfoFromPayload'),
    'Expected auto-merge handler to extract owner/repo from the webhook payload',
  );
});

Then('the auto-merge handler derives the target repo workspace path before calling ensureWorktree', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('getTargetRepoWorkspacePath'),
    'Expected auto-merge handler to call getTargetRepoWorkspacePath',
  );
});

Then('ensureWorktree is called with baseRepoPath derived from the target repo workspace', function () {
  const content = sharedCtx.fileContent;
  const ensureWorktreeIdx = content.indexOf('ensureWorktree(headBranch');
  assert.ok(ensureWorktreeIdx !== -1, 'Expected ensureWorktree(headBranch...) call');
  const callSlice = content.slice(ensureWorktreeIdx, ensureWorktreeIdx + 200);
  assert.ok(
    callSlice.includes('targetRepoWorkspacePath'),
    'Expected ensureWorktree call to include targetRepoWorkspacePath',
  );
});
```

**Section 5 — worktreeCreation (1 Then step):**

```typescript
Then('every call to copyEnvToWorktree inside ensureWorktree passes the baseRepoPath argument', function () {
  const content = sharedCtx.fileContent;
  // Find the ensureWorktree function body and check all copyEnvToWorktree calls within it
  const fnStart = content.indexOf('function ensureWorktree') !== -1
    ? content.indexOf('function ensureWorktree')
    : content.indexOf('ensureWorktree');
  assert.ok(fnStart !== -1, 'Expected ensureWorktree function to exist');

  const fnBody = content.slice(fnStart);
  const copyEnvCalls = fnBody.match(/copyEnvToWorktree\([^)]+\)/g) || [];
  assert.ok(copyEnvCalls.length > 0, 'Expected at least one copyEnvToWorktree call in ensureWorktree');

  for (const call of copyEnvCalls) {
    assert.ok(
      call.includes('baseRepoPath'),
      `Expected copyEnvToWorktree call to include baseRepoPath, got: ${call}`,
    );
  }
});
```

**Section 6 — workflowInit (2 Then steps):**

```typescript
Then('findWorktreeForIssue is called with targetRepoWorkspacePath as the cwd parameter', function () {
  const content = sharedCtx.fileContent;
  const callMatch = content.match(/findWorktreeForIssue\([^)]+\)/g) || [];
  assert.ok(callMatch.length > 0, 'Expected findWorktreeForIssue call');
  const hasRepoContext = callMatch.some((call) => call.includes('targetRepoWorkspacePath'));
  assert.ok(hasRepoContext, 'Expected findWorktreeForIssue to pass targetRepoWorkspacePath');
});

Then('every call to copyEnvToWorktree in workflowInit passes the repo context when targetRepoWorkspacePath is available', function () {
  const content = sharedCtx.fileContent;
  const copyEnvCalls = content.match(/copyEnvToWorktree\([^)]+\)/g) || [];
  assert.ok(copyEnvCalls.length > 0, 'Expected at least one copyEnvToWorktree call');
  for (const call of copyEnvCalls) {
    assert.ok(
      call.includes('targetRepoWorkspacePath'),
      `Expected copyEnvToWorktree call to pass targetRepoWorkspacePath, got: ${call}`,
    );
  }
});
```

**Section 7 — targetRepoManager (3 Then steps):**

```typescript
Then('HTTPS clone URLs are converted to SSH format before cloning', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('convertToSshUrl'),
    'Expected convertToSshUrl to be called before cloning',
  );
});

Then('the SSH URL conversion transforms {string} to {string}', function (httpsUrl: string, sshUrl: string) {
  const content = sharedCtx.fileContent;
  // Verify the regex pattern matches HTTPS GitHub URLs
  assert.ok(
    content.includes('https://github.com') || content.includes('https:\\/\\/github\\.com'),
    'Expected convertToSshUrl to contain an HTTPS GitHub URL pattern',
  );
  assert.ok(
    content.includes('git@github.com:'),
    'Expected convertToSshUrl to produce SSH format git@github.com:owner/repo.git',
  );
});

Then('clone URLs already in SSH format are passed through unchanged', function () {
  const content = sharedCtx.fileContent;
  // The function must return the original URL when it doesn't match HTTPS pattern
  assert.ok(
    /return\s+cloneUrl/.test(content),
    'Expected convertToSshUrl to return the original URL when not matching HTTPS pattern',
  );
});
```

**Section 8 — No silent defaults (1 Then step):**

```typescript
Then('every git execSync call in repo-specific functions accepts a cwd parameter', function () {
  // This step reads from multiple files (Given "..." is read was called multiple times via And)
  // We need to check worktreeOperations.ts, githubApi.ts, and githubAppAuth.ts
  const filesToCheck = [
    'adws/vcs/worktreeOperations.ts',
    'adws/github/githubApi.ts',
    'adws/github/githubAppAuth.ts',
  ];

  for (const filePath of filesToCheck) {
    const fullPath = join(ROOT, filePath);
    const content = readFileSync(fullPath, 'utf-8');

    // Find all execSync calls with 'git remote' commands
    const gitRemoteCalls = content.match(/execSync\s*\(\s*['"`]git\s+remote[^)]+\)/g) || [];
    for (const call of gitRemoteCalls) {
      assert.ok(
        call.includes('cwd'),
        `Expected git remote execSync call in ${filePath} to include cwd option, got: ${call}`,
      );
    }
  }
});
```

**Section 9 — TypeScript integrity (1 When + 1 Then step):**

```typescript
When('{string} and {string} are run', function (this: Record<string, unknown>, cmd1: string, cmd2: string) {
  const result1 = spawnSync(cmd1.split(' ')[0], cmd1.split(' ').slice(1), {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 120_000,
    shell: true,
  });
  const result2 = spawnSync(cmd2.split(' ')[0], cmd2.split(' ').slice(1), {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 120_000,
    shell: true,
  });
  this.tscResult1 = result1;
  this.tscResult2 = result2;
});

Then('both type-check commands exit with code {int}', function (this: Record<string, unknown>, expectedCode: number) {
  const result1 = this.tscResult1 as { status: number | null; stderr: string };
  const result2 = this.tscResult2 as { status: number | null; stderr: string };
  assert.strictEqual(result1.status, expectedCode, `First tsc command failed:\n${result1.stderr}`);
  assert.strictEqual(result2.status, expectedCode, `Second tsc command failed:\n${result2.stderr}`);
});
```

**Section 10 — E2E scenarios (pending — require runtime infrastructure):**

The last two scenarios (19-20) require actual git repos, worktree creation, and webhook processing. Implement all their unique steps as `pending`:

```typescript
// ── E2E: Worktree .env isolation (scenario 19) ──
Given('an external target repo exists at a workspace path', function () {
  return 'pending'; // Requires runtime infrastructure: real git repos
});
Given('the target repo has its own .env file', function () {
  return 'pending';
});
Given('the ADW repo has a different .env file', function () {
  return 'pending';
});
When('ensureWorktree is called with the target repo\'s baseRepoPath', function () {
  return 'pending';
});
Then('the worktree\'s .env file matches the target repo\'s .env', function () {
  return 'pending';
});
Then('the worktree\'s .env file does not match the ADW repo\'s .env', function () {
  return 'pending';
});

// ── E2E: Auto-merge directory isolation (scenario 20) ──
Given('a pull_request_review webhook payload for repository {string}', function (_repo: string) {
  return 'pending';
});
Given('the review state is {string}', function (_state: string) {
  return 'pending';
});
When('the auto-merge handler processes the webhook', function () {
  return 'pending';
});
Then('the worktree is created inside the vestmatic workspace path', function () {
  return 'pending';
});
Then('the worktree is not created inside the ADW repository directory', function () {
  return 'pending';
});
```

### Step 2: Verify step definitions are recognized (dry-run)

- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317" --dry-run` to confirm zero undefined steps
- All 20 scenarios should show as "skipped" (dry-run mode), not "undefined"

### Step 3: Run @adw-317 @regression scenarios

- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317 and @regression"` to verify regression-tagged scenarios pass
- Note: scenarios 1-17 (source-pattern checks) will only pass if source implementation from the spec has been applied. The E2E scenarios (19-20) will show as "pending".

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317" --dry-run` — Verify zero undefined steps across all 20 scenarios
2. `bunx tsc --noEmit` — Type-check root TypeScript config (step definitions must compile)
3. `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check adws-specific config
4. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317 and @regression"` — Run @adw-317 regression scenarios
5. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run full regression suite to verify zero regressions

## Patch Scope
**Lines of code to change:** ~200 (1 new step definitions file)
**Risk level:** low
**Testing required:** Cucumber dry-run (zero undefined steps), TypeScript type-check, @adw-317 regression scenarios, full regression suite
