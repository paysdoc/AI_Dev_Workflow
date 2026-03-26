import { Given, When, Then, After } from '@cucumber/cucumber';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';
import { copyEnvToWorktree } from '../../adws/vcs/worktreeOperations.ts';

const ROOT = process.cwd();

// Temp directories created during E2E scenarios — cleaned up in After hook
const tempDirs: string[] = [];

function loadFile(filePath: string): string {
  const content = readFileSync(join(ROOT, filePath), 'utf-8');
  sharedCtx.fileContent = content;
  sharedCtx.filePath = filePath;
  return content;
}

// ── Step 1: copyEnvToWorktree accepts baseRepoPath ────────────────────────────

Then('the copyEnvToWorktree function signature accepts an optional baseRepoPath parameter', function () {
  const content = loadFile('adws/vcs/worktreeOperations.ts');

  // The signature must include an optional baseRepoPath parameter
  assert.ok(
    content.includes('worktreePath: string, baseRepoPath?: string'),
    'Expected copyEnvToWorktree signature to include "worktreePath: string, baseRepoPath?: string"',
  );
});

Then('copyEnvToWorktree passes baseRepoPath to getMainRepoPath when provided', function () {
  const content = loadFile('adws/vcs/worktreeOperations.ts');

  // getMainRepoPath must be called with baseRepoPath
  assert.ok(
    content.includes('getMainRepoPath(baseRepoPath)'),
    'Expected copyEnvToWorktree to call getMainRepoPath(baseRepoPath)',
  );
});

Then('copyEnvToWorktree can be called with only worktreePath and defaults to the ADW repo', function () {
  const content = loadFile('adws/vcs/worktreeOperations.ts');

  // The parameter must be optional (? suffix)
  assert.ok(
    content.includes('baseRepoPath?'),
    'Expected baseRepoPath parameter to be optional (baseRepoPath?) in copyEnvToWorktree',
  );
});

// ── Step 2: getRepoInfo accepts cwd parameter ─────────────────────────────────

Then('the getRepoInfo function signature accepts an optional cwd parameter', function () {
  const content = loadFile('adws/github/githubApi.ts');

  // The signature must include an optional cwd parameter
  assert.ok(
    content.includes('getRepoInfo(cwd?: string)'),
    'Expected getRepoInfo signature to include "cwd?: string" parameter',
  );
});

Then('getRepoInfo passes the cwd option to execSync when cwd is provided', function () {
  const content = loadFile('adws/github/githubApi.ts');

  // execSync for git remote get-url must include cwd option
  const execSyncIdx = content.indexOf("execSync('git remote get-url origin'");
  assert.ok(execSyncIdx !== -1, 'Expected execSync(\'git remote get-url origin\') in githubApi.ts');

  const callSlice = content.slice(execSyncIdx, execSyncIdx + 100);
  assert.ok(
    callSlice.includes('cwd'),
    'Expected execSync(\'git remote get-url origin\') in getRepoInfo to include cwd option',
  );
});

Then('getRepoInfo called without cwd reads the remote URL from the current working directory', function () {
  const content = loadFile('adws/github/githubApi.ts');

  // cwd must be optional — confirmed by the ? in the parameter signature
  assert.ok(
    content.includes('cwd?: string'),
    'Expected cwd parameter to be optional (cwd?: string) so backward compatibility is preserved',
  );
});

// ── Step 3: githubAppAuth.ts git remote read accepts cwd ─────────────────────

Then('the git remote get-url fallback in activateGitHubAppAuth passes cwd to execSync when available', function () {
  const content = loadFile('adws/github/githubAppAuth.ts');

  // activateGitHubAppAuth must accept cwd parameter
  assert.ok(
    content.includes('activateGitHubAppAuth(owner?: string, repo?: string, cwd?: string)'),
    'Expected activateGitHubAppAuth signature to include "cwd?: string" parameter',
  );

  // execSync for git remote get-url must include cwd option
  const execSyncIdx = content.indexOf("execSync('git remote get-url origin'");
  assert.ok(execSyncIdx !== -1, 'Expected execSync(\'git remote get-url origin\') in githubAppAuth.ts');

  const callSlice = content.slice(execSyncIdx, execSyncIdx + 100);
  assert.ok(
    callSlice.includes('cwd'),
    'Expected execSync(\'git remote get-url origin\') in activateGitHubAppAuth to include cwd option',
  );
});

// ── Step 4: Auto-merge handler passes baseRepoPath to ensureWorktree ──────────

Then('the auto-merge handler extracts owner and repo from the webhook payload repository field', function () {
  const content = loadFile('adws/triggers/autoMergeHandler.ts');

  // repoInfo.owner and repoInfo.repo must be used with getTargetRepoWorkspacePath
  assert.ok(
    content.includes('getTargetRepoWorkspacePath'),
    'Expected autoMergeHandler.ts to call getTargetRepoWorkspacePath',
  );

  const callIdx = content.indexOf('getTargetRepoWorkspacePath(');
  assert.ok(callIdx !== -1, 'Expected getTargetRepoWorkspacePath( call in autoMergeHandler.ts');

  const callSlice = content.slice(callIdx, callIdx + 100);
  assert.ok(
    callSlice.includes('repoInfo.owner') && callSlice.includes('repoInfo.repo'),
    'Expected getTargetRepoWorkspacePath to be called with repoInfo.owner and repoInfo.repo',
  );
});

Then('the auto-merge handler derives the target repo workspace path before calling ensureWorktree', function () {
  const content = loadFile('adws/triggers/autoMergeHandler.ts');

  // getTargetRepoWorkspacePath must appear before ensureWorktree
  const workspacePathIdx = content.indexOf('getTargetRepoWorkspacePath(');
  assert.ok(workspacePathIdx !== -1, 'Expected getTargetRepoWorkspacePath( in autoMergeHandler.ts');

  const ensureWorktreeIdx = content.indexOf('ensureWorktree(');
  assert.ok(ensureWorktreeIdx !== -1, 'Expected ensureWorktree( in autoMergeHandler.ts');

  assert.ok(
    workspacePathIdx < ensureWorktreeIdx,
    'Expected getTargetRepoWorkspacePath to be derived before ensureWorktree is called',
  );
});

Then('ensureWorktree is called with baseRepoPath derived from the target repo workspace', function () {
  const content = loadFile('adws/triggers/autoMergeHandler.ts');

  const ensureWorktreeIdx = content.indexOf('ensureWorktree(');
  assert.ok(ensureWorktreeIdx !== -1, 'Expected ensureWorktree( in autoMergeHandler.ts');

  const callSlice = content.slice(ensureWorktreeIdx, ensureWorktreeIdx + 150);
  assert.ok(
    callSlice.includes('targetRepoWorkspacePath'),
    'Expected ensureWorktree() in autoMergeHandler.ts to receive targetRepoWorkspacePath as argument',
  );
});

// ── Step 5: worktreeCreation.ts threads baseRepoPath to copyEnvToWorktree ─────

Then('every call to copyEnvToWorktree inside ensureWorktree passes the baseRepoPath argument', function () {
  const content = loadFile('adws/vcs/worktreeCreation.ts');

  // Find ensureWorktree function body
  const ensureFnIdx = content.indexOf('export function ensureWorktree(');
  assert.ok(ensureFnIdx !== -1, 'Expected ensureWorktree function in worktreeCreation.ts');

  const ensureFnBody = content.slice(ensureFnIdx);

  // Both copyEnvToWorktree calls within ensureWorktree must include baseRepoPath
  const firstCallIdx = ensureFnBody.indexOf('copyEnvToWorktree(');
  assert.ok(firstCallIdx !== -1, 'Expected at least one copyEnvToWorktree( call in ensureWorktree');

  const firstCallSlice = ensureFnBody.slice(firstCallIdx, firstCallIdx + 60);
  assert.ok(
    firstCallSlice.includes('baseRepoPath'),
    `Expected first copyEnvToWorktree call in ensureWorktree to pass baseRepoPath, got: ${firstCallSlice}`,
  );

  const secondCallIdx = ensureFnBody.indexOf('copyEnvToWorktree(', firstCallIdx + 1);
  assert.ok(secondCallIdx !== -1, 'Expected a second copyEnvToWorktree( call in ensureWorktree');

  const secondCallSlice = ensureFnBody.slice(secondCallIdx, secondCallIdx + 60);
  assert.ok(
    secondCallSlice.includes('baseRepoPath'),
    `Expected second copyEnvToWorktree call in ensureWorktree to pass baseRepoPath, got: ${secondCallSlice}`,
  );
});

// ── Step 6: workflowInit.ts passes repo context to VCS functions ──────────────

Then('findWorktreeForIssue is called with targetRepoWorkspacePath as the cwd parameter', function () {
  const content = loadFile('adws/phases/workflowInit.ts');

  const callIdx = content.indexOf('findWorktreeForIssue(');
  assert.ok(callIdx !== -1, 'Expected findWorktreeForIssue( call in workflowInit.ts');

  const callSlice = content.slice(callIdx, callIdx + 100);
  assert.ok(
    callSlice.includes('targetRepoWorkspacePath'),
    'Expected findWorktreeForIssue() in workflowInit.ts to receive targetRepoWorkspacePath as cwd argument',
  );
});

Then('every call to copyEnvToWorktree in workflowInit passes the repo context when targetRepoWorkspacePath is available', function () {
  const content = loadFile('adws/phases/workflowInit.ts');

  // Find all copyEnvToWorktree calls and verify they include targetRepoWorkspacePath
  const allCalls: string[] = [];
  let searchIdx = 0;
  while (true) {
    const callIdx = content.indexOf('copyEnvToWorktree(', searchIdx);
    if (callIdx === -1) break;
    const callSlice = content.slice(callIdx, callIdx + 80);
    allCalls.push(callSlice);
    searchIdx = callIdx + 1;
  }

  assert.ok(allCalls.length > 0, 'Expected at least one copyEnvToWorktree( call in workflowInit.ts');

  for (const call of allCalls) {
    assert.ok(
      call.includes('targetRepoWorkspacePath'),
      `Expected copyEnvToWorktree call in workflowInit.ts to include targetRepoWorkspacePath: ${call}`,
    );
  }
});

// ── Step 7: Target repo clones use SSH URLs ───────────────────────────────────

Then('HTTPS clone URLs are converted to SSH format before cloning', function () {
  const content = loadFile('adws/core/targetRepoManager.ts');

  // convertToSshUrl must be called before the git clone execSync
  assert.ok(
    content.includes('convertToSshUrl('),
    'Expected convertToSshUrl( call in targetRepoManager.ts cloneTargetRepo',
  );

  const convertCallIdx = content.indexOf('convertToSshUrl(cloneUrl)');
  assert.ok(convertCallIdx !== -1, 'Expected convertToSshUrl(cloneUrl) in cloneTargetRepo');

  const cloneIdx = content.indexOf('git clone');
  assert.ok(cloneIdx !== -1, 'Expected git clone in cloneTargetRepo');

  assert.ok(
    convertCallIdx < cloneIdx,
    'Expected convertToSshUrl to be called before git clone',
  );
});

Then(/^the SSH URL conversion transforms "https:\/\/github\.com\/owner\/repo" to "git@github\.com:owner\/repo\.git"$/, function () {
  const content = loadFile('adws/core/targetRepoManager.ts');

  // The conversion function must handle HTTPS → SSH transformation
  assert.ok(
    content.includes('convertToSshUrl'),
    'Expected convertToSshUrl function in targetRepoManager.ts',
  );

  // Must produce git@github.com:... format
  assert.ok(
    content.includes('git@github.com:'),
    'Expected convertToSshUrl to produce git@github.com: SSH format',
  );

  // Must handle https://github.com/ pattern
  assert.ok(
    content.includes('https://github.com/'),
    'Expected convertToSshUrl to match https://github.com/ URLs',
  );
});

Then('clone URLs already in SSH format are passed through unchanged', function () {
  const content = loadFile('adws/core/targetRepoManager.ts');

  // The function must return non-HTTPS URLs unchanged — look for the passthrough return
  const fnIdx = content.indexOf('export function convertToSshUrl(');
  assert.ok(fnIdx !== -1, 'Expected convertToSshUrl function definition in targetRepoManager.ts');

  const fnBody = content.slice(fnIdx, fnIdx + 400);
  assert.ok(
    fnBody.includes('return cloneUrl'),
    'Expected convertToSshUrl to return cloneUrl unchanged when it is not an HTTPS GitHub URL',
  );
});

// ── Step 8: No silent process.cwd() defaults ─────────────────────────────────

Then('every git execSync call in repo-specific functions accepts a cwd parameter', function () {
  // Check worktreeOperations.ts: copyEnvToWorktree uses getMainRepoPath(baseRepoPath)
  const worktreeOpsContent = loadFile('adws/vcs/worktreeOperations.ts');
  assert.ok(
    worktreeOpsContent.includes('getMainRepoPath(baseRepoPath)'),
    'Expected copyEnvToWorktree in worktreeOperations.ts to call getMainRepoPath(baseRepoPath)',
  );

  // Check githubApi.ts: getRepoInfo accepts cwd
  const githubApiContent = readFileSync(join(ROOT, 'adws/github/githubApi.ts'), 'utf-8');
  assert.ok(
    githubApiContent.includes('getRepoInfo(cwd?: string)'),
    'Expected getRepoInfo in githubApi.ts to accept optional cwd parameter',
  );

  const execSyncInGetRepoInfo = githubApiContent.indexOf("execSync('git remote get-url origin'");
  assert.ok(execSyncInGetRepoInfo !== -1, 'Expected execSync git remote call in githubApi.ts');
  const slice = githubApiContent.slice(execSyncInGetRepoInfo, execSyncInGetRepoInfo + 100);
  assert.ok(
    slice.includes('cwd'),
    'Expected execSync(\'git remote get-url origin\') in getRepoInfo to include cwd option',
  );

  // Check githubAppAuth.ts: activateGitHubAppAuth accepts cwd
  const githubAppAuthContent = readFileSync(join(ROOT, 'adws/github/githubAppAuth.ts'), 'utf-8');
  assert.ok(
    githubAppAuthContent.includes('activateGitHubAppAuth(owner?: string, repo?: string, cwd?: string)'),
    'Expected activateGitHubAppAuth in githubAppAuth.ts to accept optional cwd parameter',
  );

  const execSyncInAuth = githubAppAuthContent.indexOf("execSync('git remote get-url origin'");
  assert.ok(execSyncInAuth !== -1, 'Expected execSync git remote call in githubAppAuth.ts');
  const authSlice = githubAppAuthContent.slice(execSyncInAuth, execSyncInAuth + 100);
  assert.ok(
    authSlice.includes('cwd'),
    'Expected execSync(\'git remote get-url origin\') in activateGitHubAppAuth to include cwd option',
  );
});

// ── Scenario 19: E2E — external target repo copies .env from target repo ─────

Given('an external target repo exists at a workspace path', function (this: Record<string, string>) {
  const targetRepoPath = mkdtempSync(join(tmpdir(), 'adw-target-repo-'));
  tempDirs.push(targetRepoPath);
  execSync('git init', { cwd: targetRepoPath, stdio: 'pipe' });
  execSync('git config user.email "test@adw.test"', { cwd: targetRepoPath, stdio: 'pipe' });
  execSync('git config user.name "ADW Test"', { cwd: targetRepoPath, stdio: 'pipe' });
  execSync('git commit --allow-empty -m "init"', { cwd: targetRepoPath, stdio: 'pipe' });
  this.targetRepoPath = targetRepoPath;
});

Given('the target repo has its own .env file', function (this: Record<string, string>) {
  const envContent = 'TARGET_REPO_ENV=true\nUNIQUE_KEY=target-repo-value\n';
  writeFileSync(join(this.targetRepoPath, '.env'), envContent, 'utf-8');
  this.targetRepoEnvContent = envContent;
});

Given('the ADW repo has a different .env file', function (this: Record<string, string>) {
  const adwEnvPath = join(ROOT, '.env');
  if (existsSync(adwEnvPath)) {
    const adwEnvContent = readFileSync(adwEnvPath, 'utf-8');
    assert.notStrictEqual(
      adwEnvContent.trim(),
      this.targetRepoEnvContent.trim(),
      'ADW .env and target repo .env must differ for this test to be meaningful',
    );
    this.adwEnvContent = adwEnvContent;
  } else {
    const adwEnvContent = 'ADW_REPO_ENV=true\n';
    writeFileSync(adwEnvPath, adwEnvContent, 'utf-8');
    this.adwEnvContent = adwEnvContent;
    this.createdAdwEnv = 'true';
  }
});

When("ensureWorktree is called with the target repo's baseRepoPath", function (this: Record<string, string>) {
  const worktreePath = mkdtempSync(join(tmpdir(), 'adw-worktree-'));
  tempDirs.push(worktreePath);
  this.worktreePath = worktreePath;
  copyEnvToWorktree(worktreePath, this.targetRepoPath);
});

Then("the worktree's .env file matches the target repo's .env", function (this: Record<string, string>) {
  const worktreeEnv = readFileSync(join(this.worktreePath, '.env'), 'utf-8');
  const targetEnv = readFileSync(join(this.targetRepoPath, '.env'), 'utf-8');
  assert.strictEqual(
    worktreeEnv,
    targetEnv,
    'Expected worktree .env to match the target repo .env',
  );
});

Then("the worktree's .env file does not match the ADW repo's .env", function (this: Record<string, string>) {
  const worktreeEnv = readFileSync(join(this.worktreePath, '.env'), 'utf-8');
  assert.notStrictEqual(
    worktreeEnv.trim(),
    this.adwEnvContent.trim(),
    'Expected worktree .env to differ from the ADW repo .env',
  );
});

// ── Scenario 20: Structural — auto-merge handler uses correct worktree location ──

Given('a pull_request_review webhook payload for repository {string}', function (
  this: Record<string, unknown>,
  fullName: string,
) {
  this.webhookPayload = {
    action: 'submitted',
    review: { state: 'approved', id: 1, user: { login: 'reviewer' } },
    pull_request: {
      number: 42,
      head: { ref: 'feature-branch', sha: 'abc123' },
      base: { ref: 'main', sha: 'def456' },
      state: 'open',
    },
    repository: {
      full_name: fullName,
      name: fullName.split('/')[1],
      owner: { login: fullName.split('/')[0] },
    },
    sender: { login: 'reviewer' },
  };
  // Load the autoMergeHandler source into sharedCtx for structural assertions
  sharedCtx.fileContent = readFileSync(join(ROOT, 'adws/triggers/autoMergeHandler.ts'), 'utf-8');
  sharedCtx.filePath = 'adws/triggers/autoMergeHandler.ts';
});

Given('the review state is {string}', function (
  this: Record<string, unknown>,
  state: string,
) {
  (this.webhookPayload as Record<string, unknown> & { review: Record<string, unknown> }).review.state = state;
});

When('the auto-merge handler processes the webhook', function () {
  // Structural verification: read the source to confirm the code path
  // derives targetRepoWorkspacePath from repoInfo before calling ensureWorktree.
  const content = sharedCtx.fileContent;
  assert.ok(content.length > 0, 'Expected autoMergeHandler.ts content to be loaded');

  const workspacePathIdx = content.indexOf('getTargetRepoWorkspacePath(');
  assert.ok(
    workspacePathIdx !== -1,
    'Expected handleApprovedReview to call getTargetRepoWorkspacePath',
  );

  const ensureWorktreeIdx = content.indexOf('ensureWorktree(');
  assert.ok(ensureWorktreeIdx !== -1, 'Expected ensureWorktree( call in autoMergeHandler.ts');

  assert.ok(
    workspacePathIdx < ensureWorktreeIdx,
    'Expected getTargetRepoWorkspacePath to be derived before ensureWorktree is called',
  );
});

Then('the worktree is not created inside the ADW repository directory', function () {
  const content = sharedCtx.fileContent;

  // Verify ensureWorktree is called with targetRepoWorkspacePath (not bare/without baseRepoPath)
  const ensureWorktreeIdx = content.indexOf('ensureWorktree(');
  assert.ok(ensureWorktreeIdx !== -1, 'Expected ensureWorktree( in autoMergeHandler.ts');

  const callSlice = content.slice(ensureWorktreeIdx, ensureWorktreeIdx + 150);
  assert.ok(
    callSlice.includes('targetRepoWorkspacePath'),
    'Expected ensureWorktree() to receive targetRepoWorkspacePath, preventing bare call that defaults to ADW directory',
  );
});

// ── Cleanup ───────────────────────────────────────────────────────────────────

After(function (this: Record<string, string>) {
  for (const dir of tempDirs.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  if (this.createdAdwEnv === 'true') {
    try { rmSync(join(ROOT, '.env')); } catch { /* ignore */ }
  }
});
