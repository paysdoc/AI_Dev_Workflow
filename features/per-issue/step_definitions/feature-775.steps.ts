/**
 * BDD step definitions for feature-775.feature
 *
 * Repo-API gh commands run from a working directory that always exists —
 * a Cancel/Retry directive is processable on a host that has never cloned
 * the target workspace.
 *
 * Self-contained module-private world — deliberately does NOT import
 * gitContextSharedWorld.ts (its roots are imaginary sentinels and its
 * makeNoOpFsDeps hardcodes existsSync: () => false; this feature needs REAL
 * directories, because the failure being fixed is a real spawn against a
 * real missing path).
 *
 * §1/§2   the repo-API fetch succeeds pre-clone and post-clone
 * §3      the repo-API spawn cwd is workspace-independent
 * §4      the directory exists, is not the workspace, identity unmoved
 * §5      the injected framework root, not the ambient cwd
 * §6      the whole repo-API surface (outline)
 * §7      the token is still the target repo's
 * §8/§9   git/worktree commands keep basePath / the supplied worktree cwd
 * §10     a pre-clone git read still fails, never answered from the framework checkout
 * §11     self-host is unchanged
 * §T      TypeScript type-check passes → feature-504.steps.ts (T22)
 * G18     "the ADW codebase is checked out" → ensureCronOnEveryEventSteps.ts
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { Given, When, Then, After } from '@cucumber/cucumber';
import assert from 'assert';
import { GitContext } from '../../../adws/gitContext/index.ts';
import type { ExecFn } from '../../../adws/gitContext/index.ts';

interface RecordedCall {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

interface World775 {
  owner: string;
  repo: string;
  selfHost: boolean;
  token: string;
  targetReposDir: string;
  frameworkRepoRoot: string;
  ctx: GitContext | null;
  calls: RecordedCall[];
  lastError: Error | null;
  lastResult: unknown;
  originalCwd: string;
  chdirDir: string | null;
}

const TEST_IDENTITY = {
  authorName: 'ADW Fixture Bot',
  authorEmail: 'fixture-bot@adw.dev',
  committerName: 'ADW Fixture Bot',
  committerEmail: 'fixture-bot@adw.dev',
};

const w: World775 = {
  owner: '',
  repo: '',
  selfHost: false,
  token: 'test-sentinel-token-775',
  targetReposDir: '',
  frameworkRepoRoot: '',
  ctx: null,
  calls: [],
  lastError: null,
  lastResult: null,
  originalCwd: process.cwd(),
  chdirDir: null,
};

After(function () {
  if (process.cwd() !== w.originalCwd) process.chdir(w.originalCwd);
  for (const dir of [w.targetReposDir, w.frameworkRepoRoot, w.chdirDir]) {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
  w.owner = '';
  w.repo = '';
  w.selfHost = false;
  w.token = 'test-sentinel-token-775';
  w.targetReposDir = '';
  w.frameworkRepoRoot = '';
  w.ctx = null;
  w.calls = [];
  w.lastError = null;
  w.lastResult = null;
  w.chdirDir = null;
});

// ── Fixture construction ─────────────────────────────────────────────────────

function stageIdentity(fullName: string): void {
  const [owner, repo] = fullName.split('/');
  w.owner = owner;
  w.repo = repo;
  w.targetReposDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-775-target-'));
  w.frameworkRepoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-775-framework-'));
}

function workspaceDir(): string {
  return path.join(w.targetReposDir, w.owner, w.repo);
}

function buildContext(exec: ExecFn): GitContext {
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
    { exec },
  );
}

Given('a target repository {string} registered on a host that has never cloned its workspace', function (fullName: string) {
  stageIdentity(fullName);
  // basePath (targetReposDir/owner/repo) is deliberately left absent.
});

Given('a target repository {string} registered on a host that has already cloned its workspace', function (fullName: string) {
  stageIdentity(fullName);
  fs.mkdirSync(workspaceDir(), { recursive: true });
});

Given('a self-host framework context for {string}', function (fullName: string) {
  stageIdentity(fullName);
  w.selfHost = true;
});

Given('the context is authenticated with the installation token {string}', function (token: string) {
  w.token = token;
});

// ── Recorder installation — two modes ────────────────────────────────────────

Given("the context's spawned commands are recorded by a spawn recorder", function () {
  w.calls = [];
  const exec: ExecFn = (command, options) => {
    w.calls.push({ command, cwd: options.cwd, env: { ...options.env } });
    return '[]';
  };
  w.ctx = buildContext(exec);
});

Given(
  "the context's spawned commands are recorded and then really spawned with a harmless stand-in command",
  function () {
    w.calls = [];
    // Mirrors defaultExec's own input branch (gitContext.ts) so the stand-in
    // spawn is a faithful stand-in for the real execSync contract.
    const exec: ExecFn = (command, options) => {
      w.calls.push({ command, cwd: options.cwd, env: { ...options.env } });
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

// ── Process cwd perturbation ─────────────────────────────────────────────────

Given(
  'the process working directory is moved to a directory that is neither the framework repository root nor the target workspace',
  function () {
    w.chdirDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-775-chdir-'));
    process.chdir(w.chdirDir);
  },
);

// ── Operation dispatch ────────────────────────────────────────────────────────

function runRepoApiOp(ctx: GitContext, opName: string): unknown {
  switch (opName) {
    case 'fetch-issue-comments': return ctx.fetchIssueComments(28);
    case 'issue-title': return ctx.issueTitle(28);
    case 'issue-has-label': return ctx.issueHasLabel(28, 'adw:bug');
    case 'default-branch': return ctx.defaultBranch();
    case 'issue-state': return ctx.issueState(28);
    case 'list-open-issues': return ctx.listOpenIssues({ fields: ['number'] });
    case 'find-pr-by-branch': return ctx.findPRByBranch('feature/x');
    case 'pr-changed-files': return ctx.fetchPRChangedFiles(7);
    case 'issue-comment': return ctx.commentOnIssue(28, 'body');
    case 'apply-label': return ctx.applyLabel(28, 'adw:bug');
    case 'authenticated-user': return ctx.authenticatedUser();
    case 'board-status-move': return ctx.moveIssueToStatus(28, 'In Progress');
    default: throw new Error(`Unknown repo-API operation: "${opName}"`);
  }
}

function runWorkspaceGitOp(ctx: GitContext, opName: string, worktreePath?: string): unknown {
  switch (opName) {
    case 'remote-url': return ctx.remoteUrl();
    case 'current-branch': return ctx.getCurrentBranch(worktreePath);
    default: throw new Error(`Unknown workspace-git operation: "${opName}"`);
  }
}

When('the issue comments for issue {int} are fetched through the context', function (issueNumber: number) {
  assert.ok(w.ctx !== null, 'Expected a GitContext to be set up');
  try {
    w.lastResult = w.ctx.fetchIssueComments(issueNumber);
    w.lastError = null;
  } catch (err) {
    w.lastError = err as Error;
    w.lastResult = null;
  }
});

When('the {string} repo-API operation runs through the context', function (opName: string) {
  assert.ok(w.ctx !== null, 'Expected a GitContext to be set up');
  try {
    w.lastResult = runRepoApiOp(w.ctx, opName);
    w.lastError = null;
  } catch (err) {
    w.lastError = err as Error;
    w.lastResult = null;
  }
});

When('the {string} workspace-git operation runs through the context', function (opName: string) {
  assert.ok(w.ctx !== null, 'Expected a GitContext to be set up');
  try {
    w.lastResult = runWorkspaceGitOp(w.ctx, opName);
    w.lastError = null;
  } catch (err) {
    w.lastError = err as Error;
    w.lastResult = null;
  }
});

When(
  'the {string} workspace-git operation runs through the context for the worktree of branch {string}',
  function (opName: string, branch: string) {
    assert.ok(w.ctx !== null, 'Expected a GitContext to be set up');
    const worktreePath = w.ctx.worktreePathFor(branch);
    try {
      w.lastResult = runWorkspaceGitOp(w.ctx, opName, worktreePath);
      w.lastError = null;
    } catch (err) {
      w.lastError = err as Error;
      w.lastResult = null;
    }
  },
);

When("the target repository's workspace directory is created on this host", function () {
  fs.mkdirSync(workspaceDir(), { recursive: true });
});

// ── Assertions ────────────────────────────────────────────────────────────────

function lastRecordedCall(): RecordedCall {
  assert.ok(w.calls.length > 0, 'Expected at least one recorded command');
  return w.calls[w.calls.length - 1];
}

Then('the repo-API operation completes without a spawn working-directory failure', function () {
  assert.strictEqual(w.lastError, null, `Expected no error but got: ${w.lastError?.message}`);
});

Then("the repo-API operation returns the stand-in command's output", function () {
  assert.strictEqual(w.lastResult, '[]');
});

Then("the recorded repo-API command's spawn working directory exists on disk", function () {
  const recorded = lastRecordedCall();
  assert.ok(fs.existsSync(recorded.cwd), `Expected "${recorded.cwd}" to exist on disk`);
});

Then("the recorded repo-API command's spawn working directory is not the target workspace directory", function () {
  const recorded = lastRecordedCall();
  assert.notStrictEqual(recorded.cwd, workspaceDir());
});

Then('the recorded repo-API command still addresses the repository {string}', function (fullName: string) {
  const recorded = lastRecordedCall();
  assert.ok(recorded.command.includes(fullName), `Expected command to reference "${fullName}" but got: ${recorded.command}`);
});

Then('both recorded repo-API commands ran with the same spawn working directory', function () {
  assert.strictEqual(w.calls.length, 2, `Expected exactly 2 recorded commands but got ${w.calls.length}`);
  assert.strictEqual(w.calls[0].cwd, w.calls[1].cwd);
});

Then("the recorded repo-API command's spawn working directory is the injected framework repository root", function () {
  const recorded = lastRecordedCall();
  assert.strictEqual(recorded.cwd, w.frameworkRepoRoot);
});

Then('the recorded repo-API command carried the auth token {string} in its child environment', function (token: string) {
  const recorded = lastRecordedCall();
  assert.strictEqual(recorded.env.GH_TOKEN, token);
});

Then("the recorded workspace-git command's spawn working directory is the target workspace directory", function () {
  const recorded = lastRecordedCall();
  assert.strictEqual(recorded.cwd, workspaceDir());
});

Then(
  "the recorded workspace-git command's spawn working directory is the worktree directory for branch {string}",
  function (branch: string) {
    assert.ok(w.ctx !== null, 'Expected a GitContext to be set up');
    const recorded = lastRecordedCall();
    assert.strictEqual(recorded.cwd, w.ctx.worktreePathFor(branch));
  },
);

Then('the workspace-git operation fails with a spawn working-directory failure', function () {
  assert.ok(w.lastError !== null, 'Expected the operation to throw');
  assert.strictEqual((w.lastError as NodeJS.ErrnoException).code, 'ENOENT');
});

Then('no recorded command ran with the injected framework repository root as its spawn working directory', function () {
  const offending = w.calls.filter((c) => c.cwd === w.frameworkRepoRoot);
  assert.strictEqual(offending.length, 0, `Expected no recorded call at the framework root, found: ${JSON.stringify(offending)}`);
});
