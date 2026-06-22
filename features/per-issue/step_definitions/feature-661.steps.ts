/**
 * BDD step definitions for feature-661.feature
 *
 * Worktree operations route through GitContext — real git artefact assertions.
 * Every scenario uses a REAL temporary git repository so the operations
 * produce actual git artefacts (worktree directories, list output, etc.).
 *
 * §1   create materialises worktree under base path
 * §1b  list enumerates worktrees
 * §2   target context creates under target workspace despite framework cwd
 * §2b  cwd-independence: worktree creation ignores process.cwd()
 * §3   reset discards all local work and matches origin
 * §3b  reset fails loudly when origin is unreachable
 * §4   remove deletes worktree from under base path
 * §4b  removing absent worktree reports nothing removed
 * §5   TypeScript type-check passes → feature-504.steps.ts (T22)
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { Given, When, Then, After } from '@cucumber/cucumber';
import assert from 'assert';
import { GitContext } from '../../../adws/gitContext/index.ts';
import type { GitContextOptions } from '../../../adws/gitContext/index.ts';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-661-'));
  // Resolve symlinks (e.g. macOS /tmp → /private/tmp) so paths are canonical
  // and git output matches the paths we construct.
  return fs.realpathSync(dir);
}

function git(cmd: string, cwd: string): string {
  return execSync(`git ${cmd}`, { encoding: 'utf-8', stdio: 'pipe', cwd }).trim();
}

/** Init a bare git repo at `dir` and return the path. */
function initBareRepo(dir: string): string {
  execSync('git init --bare', { stdio: 'pipe', cwd: dir });
  return dir;
}

/** Init a git repo with a single commit. Optionally add a remote. */
function initGitRepo(dir: string, remotePath?: string): void {
  execSync('git init', { stdio: 'pipe', cwd: dir });
  execSync('git config user.email "test@test.dev"', { stdio: 'pipe', cwd: dir });
  execSync('git config user.name "Test"', { stdio: 'pipe', cwd: dir });
  // Create initial commit
  const readmePath = path.join(dir, 'README.md');
  fs.writeFileSync(readmePath, '# Test repo\n');
  execSync('git add README.md', { stdio: 'pipe', cwd: dir });
  execSync('git commit -m "initial commit"', { stdio: 'pipe', cwd: dir });
  if (remotePath) {
    execSync(`git remote add origin "${remotePath}"`, { stdio: 'pipe', cwd: dir });
    execSync('git push origin HEAD', { stdio: 'pipe', cwd: dir });
  }
}

function baseOptions(frameworkRoot: string, targetRoot: string): GitContextOptions {
  return {
    owner: 'test-owner',
    repo: 'test-repo',
    selfHost: true,
    token: 'test-token',
    gitIdentity: {
      authorName: 'Test Bot',
      authorEmail: 'bot@test.dev',
      committerName: 'Test Bot',
      committerEmail: 'bot@test.dev',
    },
    frameworkRepoRoot: frameworkRoot,
    targetReposDir: targetRoot,
  };
}

// ── Scenario context ─────────────────────────────────────────────────────────

interface Ctx661 {
  ctx: GitContext | null;
  createdWorktreePath: string | null;
  listedWorktrees: string[] | null;
  removeResult: boolean | null;
  resetError: Error | null;
  tempDirs: string[];
  originalCwd: string;
  targetReposRoot: string | null;
  frameworkRoot: string | null;
  originDir: string | null;
}

const ctx661: Ctx661 = {
  ctx: null,
  createdWorktreePath: null,
  listedWorktrees: null,
  removeResult: null,
  resetError: null,
  tempDirs: [],
  originalCwd: process.cwd(),
  targetReposRoot: null,
  frameworkRoot: null,
  originDir: null,
};

After(function () {
  if (process.cwd() !== ctx661.originalCwd) {
    try { process.chdir(ctx661.originalCwd); } catch { /* ignore */ }
  }

  for (const dir of ctx661.tempDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  ctx661.ctx = null;
  ctx661.createdWorktreePath = null;
  ctx661.listedWorktrees = null;
  ctx661.removeResult = null;
  ctx661.resetError = null;
  ctx661.tempDirs = [];
  ctx661.targetReposRoot = null;
  ctx661.frameworkRoot = null;
  ctx661.originDir = null;
});

// ── Given steps ──────────────────────────────────────────────────────────────

Given('a GitContext whose base path is a fresh temporary git repository', function () {
  const repoDir = makeTempDir();
  ctx661.tempDirs.push(repoDir);
  const targetRoot = makeTempDir();
  ctx661.tempDirs.push(targetRoot);
  ctx661.frameworkRoot = repoDir;

  initGitRepo(repoDir);

  ctx661.ctx = new GitContext({
    ...baseOptions(repoDir, targetRoot),
    selfHost: true,
    frameworkRepoRoot: repoDir,
  });
});

Given('a GitContext whose base path is a temporary git repository with an origin remote', function () {
  const originDir = makeTempDir();
  ctx661.tempDirs.push(originDir);
  initBareRepo(originDir);

  const repoDir = makeTempDir();
  ctx661.tempDirs.push(repoDir);
  ctx661.frameworkRoot = repoDir;
  ctx661.originDir = originDir;

  const targetRoot = makeTempDir();
  ctx661.tempDirs.push(targetRoot);

  initGitRepo(repoDir, originDir);

  ctx661.ctx = new GitContext({
    ...baseOptions(repoDir, targetRoot),
    selfHost: true,
    frameworkRepoRoot: repoDir,
  });
});

Given(
  'a target GitContext for owner {string} repo {string} rooted at a temporary target-repos workspace',
  function (owner: string, repo: string) {
    const targetRoot = makeTempDir();
    ctx661.tempDirs.push(targetRoot);
    ctx661.targetReposRoot = targetRoot;

    const repoDir = path.join(targetRoot, owner, repo);
    fs.mkdirSync(repoDir, { recursive: true });
    initGitRepo(repoDir);

    const fakeFramework = makeTempDir();
    ctx661.tempDirs.push(fakeFramework);
    initGitRepo(fakeFramework);

    ctx661.ctx = new GitContext({
      owner,
      repo,
      selfHost: false,
      token: 'test-token',
      gitIdentity: {
        authorName: 'Test Bot',
        authorEmail: 'bot@test.dev',
        committerName: 'Test Bot',
        committerEmail: 'bot@test.dev',
      },
      frameworkRepoRoot: fakeFramework,
      targetReposDir: targetRoot,
    });
  },
);

Given('the process working directory is a separate framework git repository', function () {
  const frameworkDir = makeTempDir();
  ctx661.tempDirs.push(frameworkDir);
  initGitRepo(frameworkDir);
  process.chdir(frameworkDir);
});

Given('the process working directory is changed to an unrelated temporary directory', function () {
  const unrelated = makeTempDir();
  ctx661.tempDirs.push(unrelated);
  process.chdir(unrelated);
});

Given('a worktree has been created through the context for branch {string}', function (branch: string) {
  assert.ok(ctx661.ctx !== null, 'Expected a GitContext to be constructed');
  ctx661.ctx.createWorktreeForNewBranch(branch);
});

Given(
  'a worktree created through the context for branch {string} whose branch exists on origin',
  function (branch: string) {
    assert.ok(ctx661.ctx !== null, 'Expected a GitContext to be constructed');
    assert.ok(ctx661.originDir !== null, 'Expected an origin remote to be set up');

    // Create the worktree (new branch)
    ctx661.ctx.createWorktreeForNewBranch(branch);

    // Push the branch to origin so origin/<branch> exists for reset
    const wtPath = ctx661.ctx.worktreePathFor(branch);
    execSync(`git push origin "${branch}"`, { stdio: 'pipe', cwd: wtPath });
  },
);

Given(
  'the worktree for branch {string} has uncommitted changes and an unpushed local commit',
  function (branch: string) {
    assert.ok(ctx661.ctx !== null, 'Expected a GitContext to be constructed');
    const wtPath = ctx661.ctx.worktreePathFor(branch);

    // Add an untracked file
    fs.writeFileSync(path.join(wtPath, 'dirty.txt'), 'dirty\n');

    // Add a local commit on top of origin
    fs.writeFileSync(path.join(wtPath, 'local.txt'), 'local commit\n');
    execSync('git add local.txt', { stdio: 'pipe', cwd: wtPath });
    execSync('git commit -m "local divergent commit"', { stdio: 'pipe', cwd: wtPath });
  },
);

Given(
  'the origin remote for branch {string} has become unreachable',
  function (branch: string) {
    assert.ok(ctx661.ctx !== null, 'Expected a GitContext to be constructed');
    assert.ok(ctx661.originDir !== null, 'Expected an origin remote to be set up');
    const wtPath = ctx661.ctx.worktreePathFor(branch);
    // Point origin at a non-existent path so fetch fails
    execSync(`git remote set-url origin "/nonexistent/path/that/does/not/exist"`, {
      stdio: 'pipe',
      cwd: wtPath,
    });
  },
);

// ── When steps ───────────────────────────────────────────────────────────────

When('a worktree is created through the context for branch {string}', function (branch: string) {
  assert.ok(ctx661.ctx !== null, 'Expected a GitContext to be constructed');
  ctx661.createdWorktreePath = ctx661.ctx.createWorktreeForNewBranch(branch);
});

When('the worktrees are listed through the context', function () {
  assert.ok(ctx661.ctx !== null, 'Expected a GitContext to be constructed');
  ctx661.listedWorktrees = ctx661.ctx.listWorktrees();
});

When(
  'the worktree for branch {string} is reset to its remote through the context',
  function (branch: string) {
    assert.ok(ctx661.ctx !== null, 'Expected a GitContext to be constructed');
    try {
      ctx661.ctx.resetWorktree(branch);
      ctx661.resetError = null;
    } catch (e) {
      ctx661.resetError = e as Error;
    }
  },
);

When('the worktree for branch {string} is removed through the context', function (branch: string) {
  assert.ok(ctx661.ctx !== null, 'Expected a GitContext to be constructed');
  ctx661.removeResult = ctx661.ctx.removeWorktree(branch);
});

// ── Then steps ───────────────────────────────────────────────────────────────

Then('a git worktree exists under the context base path for branch {string}', function (branch: string) {
  assert.ok(ctx661.ctx !== null, 'Expected a GitContext to be constructed');
  const expected = ctx661.ctx.worktreePathFor(branch);
  assert.ok(
    fs.existsSync(expected),
    `Expected worktree directory to exist at ${expected}`,
  );
  // Confirm git tracks it
  const listOutput = execSync('git worktree list --porcelain', {
    encoding: 'utf-8',
    cwd: ctx661.ctx.basePath,
  });
  assert.ok(
    listOutput.includes(expected),
    `Expected git worktree list to include ${expected}`,
  );
});

Then('no git worktree exists under the context base path for branch {string}', function (branch: string) {
  assert.ok(ctx661.ctx !== null, 'Expected a GitContext to be constructed');
  const expected = ctx661.ctx.worktreePathFor(branch);
  assert.ok(
    !fs.existsSync(expected),
    `Expected worktree directory to NOT exist at ${expected}`,
  );
});

Then(
  "the created worktree path equals the context's worktree path for branch {string}",
  function (branch: string) {
    assert.ok(ctx661.ctx !== null, 'Expected a GitContext to be constructed');
    assert.ok(ctx661.createdWorktreePath !== null, 'Expected a worktree path to have been created');
    assert.strictEqual(
      ctx661.createdWorktreePath,
      ctx661.ctx.worktreePathFor(branch),
    );
  },
);

Then(
  "looking up the worktree for branch {string} through the context returns its path under the base path",
  function (branch: string) {
    assert.ok(ctx661.ctx !== null, 'Expected a GitContext to be constructed');
    const result = ctx661.ctx.getWorktreeForBranch(branch);
    assert.ok(result !== null, `Expected getWorktreeForBranch('${branch}') to return a path`);
    assert.ok(
      result.startsWith(ctx661.ctx.basePath),
      `Expected path '${result}' to be under base path '${ctx661.ctx.basePath}'`,
    );
  },
);

Then('the listed worktrees include the worktree for branch {string}', function (branch: string) {
  assert.ok(ctx661.ctx !== null, 'Expected a GitContext to be constructed');
  assert.ok(ctx661.listedWorktrees !== null, 'Expected worktrees to have been listed');
  const expected = ctx661.ctx.worktreePathFor(branch);
  assert.ok(
    ctx661.listedWorktrees.includes(expected),
    `Expected listed worktrees to include ${expected}, got: ${ctx661.listedWorktrees.join(', ')}`,
  );
});

Then('the listed worktrees exclude the main repository root', function () {
  assert.ok(ctx661.ctx !== null, 'Expected a GitContext to be constructed');
  assert.ok(ctx661.listedWorktrees !== null, 'Expected worktrees to have been listed');
  assert.ok(
    !ctx661.listedWorktrees.includes(ctx661.ctx.basePath),
    `Expected listed worktrees to NOT include base path ${ctx661.ctx.basePath}`,
  );
});

Then(
  "the listed worktrees exclude the worktree for branch {string}",
  function (branch: string) {
    assert.ok(ctx661.ctx !== null, 'Expected a GitContext to be constructed');
    const wtPath = ctx661.ctx.worktreePathFor(branch);
    const listed = ctx661.ctx.listWorktrees();
    assert.ok(
      !listed.includes(wtPath),
      `Expected listed worktrees to NOT include ${wtPath}`,
    );
  },
);

Then(
  "no worktree directory exists under the process working directory for branch {string}",
  function (branch: string) {
    // Check that no worktree was created under cwd
    const cwdWorktree = path.join(process.cwd(), '.worktrees', branch.replace(/[/\\:*?"<>|`]/g, '-'));
    assert.ok(
      !fs.existsSync(cwdWorktree),
      `Expected no worktree at cwd-based path ${cwdWorktree}`,
    );
  },
);

Then('the worktree for branch {string} has no uncommitted changes', function (branch: string) {
  assert.ok(ctx661.ctx !== null, 'Expected a GitContext to be constructed');
  const wtPath = ctx661.ctx.worktreePathFor(branch);
  const status = execSync('git status --porcelain', { encoding: 'utf-8', cwd: wtPath }).trim();
  assert.strictEqual(status, '', `Expected no uncommitted changes, got: ${status}`);
});

Then('the worktree for branch {string} matches its branch on origin', function (branch: string) {
  assert.ok(ctx661.ctx !== null, 'Expected a GitContext to be constructed');
  const wtPath = ctx661.ctx.worktreePathFor(branch);

  const localHead = git(`rev-parse HEAD`, wtPath);
  const originHead = git(`rev-parse "origin/${branch}"`, wtPath);

  assert.strictEqual(
    localHead,
    originHead,
    `Expected HEAD (${localHead}) to equal origin/${branch} (${originHead})`,
  );
});

Then('the worktree reset through the context fails loudly', function () {
  assert.ok(
    ctx661.resetError !== null,
    'Expected the reset operation to throw an error but it did not',
  );
});

Then('the context reports that no worktree was removed', function () {
  assert.strictEqual(
    ctx661.removeResult,
    false,
    `Expected removeWorktree to return false (nothing removed), got: ${ctx661.removeResult}`,
  );
});
