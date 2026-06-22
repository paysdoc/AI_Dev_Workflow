/**
 * BDD step definitions for feature-658.feature
 *
 * GitContext package — mandatory identity + base-path authority
 *
 * §1   self-host base path → framework repo root
 * §2   target base path → join(targetReposDir, owner, repo) [outline]
 * §3   incomplete identity fails loudly [outline + cwd-fallback scenario]
 * §4   worktreePathFor is computed under the base path [outline]
 * §5   worktreePathFor is cwd-independent
 * §6   two contexts resolve independent base paths
 * §7   TypeScript type-check passes → feature-504.steps.ts (T22)
 * G18  "the ADW codebase is checked out" → ensureCronOnEveryEventSteps.ts
 */

import * as path from 'path';
import * as os from 'os';
import { Given, When, Then, After } from '@cucumber/cucumber';
import assert from 'assert';
import { GitContext } from '../../../adws/gitContext/index.ts';
import type { GitContextOptions } from '../../../adws/gitContext/index.ts';

// ── Shared sentinel values ───────────────────────────────────────────────────

const FRAMEWORK_ROOT = '/srv/adw/framework';
const TARGET_REPOS_ROOT = '/srv/adw/repos';

function baseOptions(): GitContextOptions {
  return {
    owner: 'test-owner',
    repo: 'test-repo',
    selfHost: false,
    token: 'test-token',
    gitIdentity: {
      authorName: 'Test Bot',
      authorEmail: 'bot@test.dev',
      committerName: 'Test Bot',
      committerEmail: 'bot@test.dev',
    },
    frameworkRepoRoot: FRAMEWORK_ROOT,
    targetReposDir: TARGET_REPOS_ROOT,
  };
}

// ── Scenario context ─────────────────────────────────────────────────────────

interface Ctx658 {
  ctx: GitContext | null;
  constructionError: Error | null;
  worktreePath1: string | null;
  worktreePath2: string | null;
  selfCtx: GitContext | null;
  targetCtx: GitContext | null;
  originalCwd: string;
}

const ctx658: Ctx658 = {
  ctx: null,
  constructionError: null,
  worktreePath1: null,
  worktreePath2: null,
  selfCtx: null,
  targetCtx: null,
  originalCwd: process.cwd(),
};

After(function () {
  if (process.cwd() !== ctx658.originalCwd) {
    process.chdir(ctx658.originalCwd);
  }
  ctx658.ctx = null;
  ctx658.constructionError = null;
  ctx658.worktreePath1 = null;
  ctx658.worktreePath2 = null;
  ctx658.selfCtx = null;
  ctx658.targetCtx = null;
});

// ── §1: Self-host base-path resolution ──────────────────────────────────────

Given(
  'a GitContext is constructed for a self-host identity with framework root {string}',
  function (frameworkRoot: string) {
    ctx658.ctx = new GitContext({ ...baseOptions(), selfHost: true, frameworkRepoRoot: frameworkRoot });
  },
);

Then('the context base path is {string}', function (expectedPath: string) {
  assert.ok(ctx658.ctx !== null, 'Expected a GitContext to have been constructed');
  assert.strictEqual(ctx658.ctx.basePath, expectedPath);
});

// ── §2: Target base-path resolution ─────────────────────────────────────────

Given(
  'a GitContext is constructed for target owner {string} repo {string} with target-repos root {string}',
  function (owner: string, repo: string, targetReposRoot: string) {
    ctx658.ctx = new GitContext({
      ...baseOptions(),
      owner,
      repo,
      selfHost: false,
      targetReposDir: targetReposRoot,
    });
  },
);

// ── §3: Incomplete identity failure ─────────────────────────────────────────

When(
  'a GitContext is constructed with {string} omitted from an otherwise-complete identity',
  function (missingField: string) {
    const opts = baseOptions() as unknown as Record<string, unknown>;
    switch (missingField) {
      case 'owner':
        opts['owner'] = '';
        break;
      case 'repo':
        opts['repo'] = '';
        break;
      case 'the self-host/target discriminator':
        delete opts['selfHost'];
        break;
      case 'the auth token':
        opts['token'] = '';
        break;
      case 'the git author/committer identity':
        opts['gitIdentity'] = { authorName: '', authorEmail: '', committerName: '', committerEmail: '' };
        break;
      default:
        throw new Error(`Unknown missing field: ${missingField}`);
    }
    try {
      ctx658.ctx = new GitContext(opts as unknown as GitContextOptions);
    } catch (e) {
      ctx658.constructionError = e as Error;
    }
  },
);

Given('the process working directory is a usable git repository', function () {
  // The test runs inside the ADW checkout — cwd is already a git repo.
  // This step is a documentation marker for the no-fallback scenario.
});

When('a GitContext is constructed for a target identity with no target-repos root supplied', function () {
  try {
    ctx658.ctx = new GitContext({ ...baseOptions(), selfHost: false, targetReposDir: '' });
  } catch (e) {
    ctx658.constructionError = e as Error;
  }
});

Then('the GitContext construction fails with a loud error', function () {
  assert.ok(
    ctx658.constructionError !== null,
    'Expected GitContext construction to throw but it did not',
  );
});

// ── §4: worktreePathFor under base path ─────────────────────────────────────

Given('a GitContext whose resolved base path is {string}', function (basePath: string) {
  // Build a self-host context where frameworkRepoRoot === the sentinel basePath
  ctx658.ctx = new GitContext({
    ...baseOptions(),
    selfHost: true,
    frameworkRepoRoot: basePath,
  });
});

Then(
  'the worktree path for branch {string} is under the context base path',
  function (branch: string) {
    assert.ok(ctx658.ctx !== null, 'Expected a GitContext to have been constructed');
    const worktreePath = ctx658.ctx.worktreePathFor(branch);
    assert.ok(
      worktreePath.startsWith(ctx658.ctx.basePath),
      `Expected worktree path "${worktreePath}" to start with base path "${ctx658.ctx.basePath}"`,
    );
  },
);

Then(
  'the worktree path for branch {string} is {string}',
  function (branch: string, expectedPath: string) {
    assert.ok(ctx658.ctx !== null, 'Expected a GitContext to have been constructed');
    assert.strictEqual(ctx658.ctx.worktreePathFor(branch), expectedPath);
  },
);

// ── §5: worktreePathFor cwd-independence ────────────────────────────────────

When(
  'the worktree path for branch {string} is computed from two different working directories',
  function (branch: string) {
    assert.ok(ctx658.ctx !== null, 'Expected a GitContext to have been constructed');
    ctx658.worktreePath1 = ctx658.ctx.worktreePathFor(branch);
    process.chdir(os.tmpdir());
    ctx658.worktreePath2 = ctx658.ctx.worktreePathFor(branch);
  },
);

Then(
  'both worktree-path computations return {string}',
  function (expectedPath: string) {
    assert.strictEqual(ctx658.worktreePath1, expectedPath);
    assert.strictEqual(ctx658.worktreePath2, expectedPath);
  },
);

// ── §6: Two-context isolation ────────────────────────────────────────────────

Given(
  'a self-host GitContext with framework root {string}',
  function (frameworkRoot: string) {
    ctx658.selfCtx = new GitContext({
      ...baseOptions(),
      selfHost: true,
      frameworkRepoRoot: frameworkRoot,
    });
  },
);

Given(
  'a target GitContext for owner {string} repo {string} with target-repos root {string}',
  function (owner: string, repo: string, targetReposRoot: string) {
    ctx658.targetCtx = new GitContext({
      ...baseOptions(),
      owner,
      repo,
      selfHost: false,
      targetReposDir: targetReposRoot,
    });
  },
);

Then('the self-host context base path is {string}', function (expectedPath: string) {
  assert.ok(ctx658.selfCtx !== null, 'Expected a self-host GitContext to have been constructed');
  assert.strictEqual(ctx658.selfCtx.basePath, expectedPath);
});

Then('the target context base path is {string}', function (expectedPath: string) {
  assert.ok(ctx658.targetCtx !== null, 'Expected a target GitContext to have been constructed');
  assert.strictEqual(ctx658.targetCtx.basePath, path.join(expectedPath));
});
