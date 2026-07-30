/**
 * BDD step definitions for feature-777.feature
 *
 * A GitContext spawn into a workspace that was never cloned names the missing
 * directory and the repository, instead of the cryptic "spawnSync /bin/sh ENOENT".
 *
 * Self-contained module-private world — deliberately does NOT import
 * gitContextSharedWorld.ts (imaginary sentinel roots, existsSync: () => false)
 * nor feature-775's module-private world. Real fixture directories, production
 * layout: two mkdtempSync roots per scenario, {owner}/{repo} created or not per
 * the Given, real defaultExec spawns for real in most scenarios.
 *
 * §1     the headline: names the directory, the repo, selfHost, asks about cloning
 * §2     the explicit worktree path counts too
 * §3     construct-before-clone still works (real ensureRepoWorkspace)
 * §4     spawn-time, not a construction-time snapshot
 * §5     repo-API commands are not affected (outline)
 * §6     a real git failure is not misreported as a missing directory
 * §7     self-host is unaffected
 * §8     the swallowing probes still swallow
 * §9     the error code survives, and so does the original failure
 * §T     TypeScript type-check passes → feature-504.steps.ts (T22)
 * G18    "the ADW codebase is checked out" → ensureCronOnEveryEventSteps.ts
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { Given, When, Then, After } from '@cucumber/cucumber';
import assert from 'assert';
import { GitContext, ensureRepoWorkspace } from '../../../adws/gitContext/index.ts';
import type { ExecFn, WorktreeRegistration } from '../../../adws/gitContext/index.ts';

interface RecordedCall {
  command: string;
  cwd: string;
}

interface ProbeResults {
  gitDir: string | null;
  branch: string | null;
  registration: WorktreeRegistration;
}

interface World777 {
  owner: string;
  repo: string;
  selfHost: boolean;
  token: string;
  targetReposDir: string;
  frameworkRepoRoot: string;
  ctx: GitContext | null;
  lastError: (Error & { cause?: unknown }) | null;
  lastResult: unknown;
  recordedCalls: RecordedCall[];
  ensureWorkspaceRecordedCalls: RecordedCall[];
  ensureWorkspaceResultPath: string | null;
  probeResults: ProbeResults | null;
}

const TEST_IDENTITY = {
  authorName: 'ADW Fixture Bot',
  authorEmail: 'fixture-bot@adw.dev',
  committerName: 'ADW Fixture Bot',
  committerEmail: 'fixture-bot@adw.dev',
};

const w: World777 = {
  owner: '',
  repo: '',
  selfHost: false,
  token: 'test-sentinel-token-777',
  targetReposDir: '',
  frameworkRepoRoot: '',
  ctx: null,
  lastError: null,
  lastResult: null,
  recordedCalls: [],
  ensureWorkspaceRecordedCalls: [],
  ensureWorkspaceResultPath: null,
  probeResults: null,
};

After(function () {
  for (const dir of [w.targetReposDir, w.frameworkRepoRoot]) {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
  w.owner = '';
  w.repo = '';
  w.selfHost = false;
  w.token = 'test-sentinel-token-777';
  w.targetReposDir = '';
  w.frameworkRepoRoot = '';
  w.ctx = null;
  w.lastError = null;
  w.lastResult = null;
  w.recordedCalls = [];
  w.ensureWorkspaceRecordedCalls = [];
  w.ensureWorkspaceResultPath = null;
  w.probeResults = null;
});

// ── Fixture construction ─────────────────────────────────────────────────────

function stageIdentity(fullName: string): void {
  const [owner, repo] = fullName.split('/');
  w.owner = owner;
  w.repo = repo;
  w.targetReposDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-777-target-'));
  w.frameworkRepoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-777-framework-'));
}

function workspaceDir(): string {
  return path.join(w.targetReposDir, w.owner, w.repo);
}

function buildContext(exec?: ExecFn): GitContext {
  return new GitContext(
    {
      owner: w.owner,
      repo: w.repo,
      selfHost: w.selfHost,
      token: w.token,
      gitIdentity: TEST_IDENTITY,
      frameworkRepoRoot: w.frameworkRepoRoot,
      targetReposDir: w.targetReposDir,
    },
    exec ? { exec } : {},
  );
}

Given('a target workspace repository {string} that has never been cloned on this host', function (fullName: string) {
  stageIdentity(fullName);
  w.selfHost = false;
  // workspaceDir() is deliberately left absent.
  w.ctx = buildContext();
});

Given('a target workspace repository {string} whose workspace directory exists but holds no git checkout', function (fullName: string) {
  stageIdentity(fullName);
  w.selfHost = false;
  fs.mkdirSync(workspaceDir(), { recursive: true });
  w.ctx = buildContext();
});

Given('a target workspace repository {string} whose workspace holds a git checkout on branch {string}', function (fullName: string, branch: string) {
  stageIdentity(fullName);
  w.selfHost = false;
  fs.mkdirSync(workspaceDir(), { recursive: true });
  execSync(`git init -q -b ${branch}`, { cwd: workspaceDir(), encoding: 'utf-8' });
  w.ctx = buildContext();
});

Given('a self-hosted framework repository {string} whose framework checkout is on branch {string}', function (fullName: string, branch: string) {
  stageIdentity(fullName);
  w.selfHost = true;
  execSync(`git init -q -b ${branch}`, { cwd: w.frameworkRepoRoot, encoding: 'utf-8' });
  w.ctx = buildContext();
});

Given(
  "the repository's spawns are stood in for by a harmless command that really runs in the given working directory",
  function () {
    const exec: ExecFn = (command, options) => {
      w.recordedCalls.push({ command, cwd: options.cwd });
      // Mirrors defaultExec's own input branch (gitContext.ts) so the stand-in
      // spawn is a faithful stand-in for the real execSync contract.
      if (options.input !== undefined) {
        return execSync("printf '%s' '[]'", {
          cwd: options.cwd,
          env: options.env,
          encoding: 'utf-8',
          input: options.input,
          stdio: ['pipe', 'pipe', 'pipe'],
          maxBuffer: 10 * 1024 * 1024,
        }) as string;
      }
      return execSync("printf '%s' '[]'", {
        cwd: options.cwd,
        env: options.env,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      }) as string;
    };
    w.ctx = buildContext(exec);
  },
);

// ── Operation dispatch ────────────────────────────────────────────────────────

function runRepoApiOp(ctx: GitContext, opName: string): unknown {
  switch (opName) {
    case 'fetch-issue-comments': return ctx.fetchIssueComments(28);
    case 'default-branch': return ctx.defaultBranch();
    case 'issue-comment': return ctx.commentOnIssue(28, 'body');
    case 'apply-label': return ctx.applyLabel(28, 'adw:bug');
    case 'authenticated-user': return ctx.authenticatedUser();
    default: throw new Error(`Unknown repository-API operation: "${opName}"`);
  }
}

// ── When ──────────────────────────────────────────────────────────────────────

When('a workspace-scoped git read is issued for the repository', function () {
  assert.ok(w.ctx !== null, 'Expected a GitContext to be set up');
  try {
    w.lastResult = w.ctx.getCurrentBranch();
    w.lastError = null;
  } catch (err) {
    w.lastError = err as Error;
    w.lastResult = null;
  }
});

When('a worktree-scoped git read is issued for the worktree of branch {string}', function (branch: string) {
  assert.ok(w.ctx !== null, 'Expected a GitContext to be set up');
  const worktreePath = w.ctx.worktreePathFor(branch);
  try {
    w.lastResult = w.ctx.getCurrentBranch(worktreePath);
    w.lastError = null;
  } catch (err) {
    w.lastError = err as Error;
    w.lastResult = null;
  }
});

When('the workspace-ensure flow runs for the repository', function () {
  w.ensureWorkspaceRecordedCalls = [];
  const cloneUrl = `https://github.com/${w.owner}/${w.repo}.git`;
  try {
    w.ensureWorkspaceResultPath = ensureRepoWorkspace(w.owner, w.repo, cloneUrl, {
      targetReposDir: w.targetReposDir,
      getDefaultBranch: () => {
        assert.ok(w.ctx !== null, 'Expected a GitContext to be set up');
        return w.ctx.defaultBranch();
      },
      exec: (command, opts) => {
        w.ensureWorkspaceRecordedCalls.push({ command, cwd: opts.cwd ?? '' });
      },
    });
    w.lastError = null;
  } catch (err) {
    w.lastError = err as Error;
    w.ensureWorkspaceResultPath = null;
  }
});

When('the workspace is cloned on this host after the context was built, on branch {string}', function (branch: string) {
  fs.mkdirSync(workspaceDir(), { recursive: true });
  execSync(`git init -q -b ${branch}`, { cwd: workspaceDir(), encoding: 'utf-8' });
});

When('the {string} repository-API operation is issued for the repository', function (opName: string) {
  assert.ok(w.ctx !== null, 'Expected a GitContext to be set up');
  try {
    w.lastResult = runRepoApiOp(w.ctx, opName);
    w.lastError = null;
  } catch (err) {
    w.lastError = err as Error;
    w.lastResult = null;
  }
});

When('the takeover probe inspects the worktree of branch {string}', function (branch: string) {
  assert.ok(w.ctx !== null, 'Expected a GitContext to be set up');
  const worktreePath = w.ctx.worktreePathFor(branch);
  try {
    w.probeResults = {
      gitDir: w.ctx.resolveGitDir(worktreePath),
      branch: w.ctx.currentBranchSymbolic(worktreePath),
      registration: w.ctx.worktreeRegistration(worktreePath),
    };
    w.lastError = null;
  } catch (err) {
    w.lastError = err as Error;
    w.probeResults = null;
  }
});

When('the worktree listing is requested for the repository', function () {
  assert.ok(w.ctx !== null, 'Expected a GitContext to be set up');
  try {
    w.lastResult = w.ctx.listWorktrees();
    w.lastError = null;
  } catch (err) {
    w.lastError = err as Error;
    w.lastResult = null;
  }
});

// ── Then ──────────────────────────────────────────────────────────────────────

Then('the failure names the missing workspace directory', function () {
  assert.ok(w.lastError !== null, 'Expected an error to be thrown');
  assert.ok(w.ctx !== null, 'Expected a GitContext to be set up');
  assert.ok(
    w.lastError.message.includes(w.ctx.basePath),
    `Expected message to include "${w.ctx.basePath}" but got: ${w.lastError.message}`,
  );
});

Then('the failure names the missing worktree directory for branch {string}', function (branch: string) {
  assert.ok(w.lastError !== null, 'Expected an error to be thrown');
  assert.ok(w.ctx !== null, 'Expected a GitContext to be set up');
  const worktreePath = w.ctx.worktreePathFor(branch);
  assert.ok(
    w.lastError.message.includes(worktreePath),
    `Expected message to include "${worktreePath}" but got: ${w.lastError.message}`,
  );
});

Then('the failure names the repository {string}', function (fullName: string) {
  assert.ok(w.lastError !== null, 'Expected an error to be thrown');
  assert.ok(
    w.lastError.message.includes(fullName),
    `Expected message to include "${fullName}" but got: ${w.lastError.message}`,
  );
});

Then('the failure reports the self-host discriminator as {string}', function (flag: string) {
  assert.ok(w.lastError !== null, 'Expected an error to be thrown');
  const re = new RegExp(`selfHost\\s*[=:]\\s*${flag}`, 'i');
  assert.ok(re.test(w.lastError.message), `Expected message to report selfHost=${flag} but got: ${w.lastError.message}`);
});

Then('the failure asks whether the workspace was ever cloned on this host', function () {
  assert.ok(w.lastError !== null, 'Expected an error to be thrown');
  assert.ok(/clon(e|ed|ing)/i.test(w.lastError.message), `Expected message to ask about cloning but got: ${w.lastError.message}`);
});

Then('no missing-working-directory failure is raised', function () {
  if (w.lastError === null) return;
  const isWorkingDirFailure = /working directory does not exist/i.test(w.lastError.message);
  assert.fail(
    isWorkingDirFailure
      ? `Expected no missing-working-directory failure but got one: ${w.lastError.message}`
      : `Expected no error at all but got an unrelated failure: ${w.lastError.message}`,
  );
});

Then('the workspace-ensure flow records a clone into the workspace directory', function () {
  assert.ok(w.ensureWorkspaceResultPath !== null, 'Expected ensureRepoWorkspace to return a workspace path');
  const cloneCalls = w.ensureWorkspaceRecordedCalls.filter((c) => c.command.startsWith('git clone'));
  assert.ok(cloneCalls.length > 0, 'Expected a recorded "git clone" command');
  assert.ok(
    cloneCalls.some((c) => c.command.includes(w.ensureWorkspaceResultPath as string)),
    `Expected a clone command to mention "${w.ensureWorkspaceResultPath}", got: ${JSON.stringify(cloneCalls)}`,
  );
});

Then('the workspace-scoped git read returns the branch name {string}', function (branch: string) {
  assert.strictEqual(w.lastResult, branch);
});

Then(
  "the failure is the git command's own failure rather than a missing-working-directory report",
  function () {
    assert.ok(w.lastError !== null, 'Expected an error to be thrown');
    const err = w.lastError as NodeJS.ErrnoException & { status?: number };
    assert.strictEqual(typeof err.status, 'number', `Expected a numeric exit status but got: ${err.status}`);
    assert.notStrictEqual(err.status, 0);
    assert.ok(
      !/working directory does not exist/i.test(err.message),
      `Expected the git command's own failure but got a missing-working-directory report: ${err.message}`,
    );
  },
);

Then('the failure is still recognisable by the missing-working-directory error code', function () {
  assert.ok(w.lastError !== null, 'Expected an error to be thrown');
  assert.strictEqual((w.lastError as NodeJS.ErrnoException).code, 'ENOENT');
});

Then('the failure carries the original spawn failure as its cause', function () {
  assert.ok(w.lastError !== null, 'Expected an error to be thrown');
  const cause = w.lastError.cause;
  assert.ok(cause !== undefined && cause !== null, 'Expected the error to carry a cause');
  assert.strictEqual((cause as NodeJS.ErrnoException).code, 'ENOENT');
});

Then('the takeover probe reports the worktree as missing without raising', function () {
  assert.strictEqual(w.lastError, null, `Expected no error but got: ${w.lastError?.message}`);
  assert.ok(w.probeResults !== null, 'Expected probe results to be recorded');
  assert.strictEqual(w.probeResults.gitDir, null);
  assert.strictEqual(w.probeResults.branch, null);
  assert.strictEqual(w.probeResults.registration, 'missing');
});

Then('the worktree listing answers empty without raising', function () {
  assert.strictEqual(w.lastError, null, `Expected no error but got: ${w.lastError?.message}`);
  assert.ok(Array.isArray(w.lastResult), 'Expected the worktree listing to be an array');
  assert.strictEqual((w.lastResult as unknown[]).length, 0);
});
