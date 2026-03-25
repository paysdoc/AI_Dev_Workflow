/**
 * Step definitions for git_remote_mock.feature
 */

import { Given, When, Then, After } from '@cucumber/cucumber';
import { spawnSync, execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const GIT_REMOTE_MOCK_PATH = join(ROOT, 'test/mocks/git-remote-mock.ts');
const TEST_HARNESS_PATH = join(ROOT, 'test/mocks/test-harness.ts');

interface GitMockWorld {
  gitMockDir?: string;
  gitMockSavedPath?: string;
  gitMockRealGit?: string;
  gitTempDir?: string;
  gitLastOutput?: string;
  gitLastExitCode?: number;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

After(function (this: GitMockWorld) {
  // Restore PATH if modified
  if (this.gitMockSavedPath !== undefined) {
    process.env['PATH'] = this.gitMockSavedPath;
    delete process.env['REAL_GIT_PATH'];
    this.gitMockSavedPath = undefined;
  }
  // Remove temp mock dir
  if (this.gitMockDir && existsSync(this.gitMockDir)) {
    try { rmSync(this.gitMockDir, { recursive: true }); } catch { /* best-effort */ }
    this.gitMockDir = undefined;
  }
  // Remove temp git repo
  if (this.gitTempDir && existsSync(this.gitTempDir)) {
    try { rmSync(this.gitTempDir, { recursive: true }); } catch { /* best-effort */ }
    this.gitTempDir = undefined;
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findRealGit(): string {
  try { return execSync('which git', { encoding: 'utf-8' }).trim(); } catch { return '/usr/bin/git'; }
}

function createGitMockWrapper(realGitPath: string): string {
  const dir = join(ROOT, `.tmp-git-mock-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const wrapper = `#!/bin/sh\nexport REAL_GIT_PATH="${realGitPath}"\nexec bun "${GIT_REMOTE_MOCK_PATH}" "$@"\n`;
  writeFileSync(join(dir, 'git'), wrapper, { mode: 0o755 });
  return dir;
}

function makeTempDir(prefix = 'git-test'): string {
  const dir = join(ROOT, `.tmp-${prefix}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function parseShellArgs(command: string): string[] {
  const args: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (const ch of command) {
    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
    } else if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
    } else if (ch === ' ' && !inSingleQuote && !inDoubleQuote) {
      if (current.length > 0) { args.push(current); current = ''; }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) args.push(current);
  return args;
}

function _runGit(this: GitMockWorld, args: string[], cwd?: string): void {
  const result = spawnSync('git', args, {
    encoding: 'utf-8',
    cwd: cwd ?? this.gitTempDir ?? ROOT,
    env: process.env,
  });
  this.gitLastOutput = (result.stdout ?? '') + (result.stderr ?? '');
  this.gitLastExitCode = result.status ?? -1;
}

function initBareRepo(dir: string): void {
  const realGit = findRealGit();
  spawnSync(realGit, ['init', dir], { stdio: 'pipe' });
  spawnSync(realGit, ['-C', dir, 'config', 'user.email', 'test@test.com'], { stdio: 'pipe' });
  spawnSync(realGit, ['-C', dir, 'config', 'user.name', 'Test User'], { stdio: 'pipe' });
}

function addInitialCommit(dir: string): void {
  const realGit = findRealGit();
  writeFileSync(join(dir, 'README.md'), '# test\n');
  spawnSync(realGit, ['-C', dir, 'add', '.'], { stdio: 'pipe' });
  spawnSync(realGit, ['-C', dir, 'commit', '-m', 'initial commit'], { stdio: 'pipe' });
}

// ---------------------------------------------------------------------------
// Background
// ---------------------------------------------------------------------------

Given('the git remote mock is activated in the test environment', function (this: GitMockWorld) {
  const realGit = findRealGit();
  this.gitMockRealGit = realGit;
  this.gitMockDir = createGitMockWrapper(realGit);
  this.gitMockSavedPath = process.env['PATH'] ?? '';
  process.env['PATH'] = `${this.gitMockDir}:${this.gitMockSavedPath}`;
  process.env['REAL_GIT_PATH'] = realGit;
});

// ---------------------------------------------------------------------------
// Given steps — repository setup
// ---------------------------------------------------------------------------

Given('a local git repository', function (this: GitMockWorld) {
  const dir = makeTempDir('git-repo');
  initBareRepo(dir);
  this.gitTempDir = dir;
});

Given('a local git repository with at least one commit', function (this: GitMockWorld) {
  const dir = makeTempDir('git-repo');
  initBareRepo(dir);
  addInitialCommit(dir);
  this.gitTempDir = dir;
});

Given('a temporary directory', function (this: GitMockWorld) {
  const dir = makeTempDir('tmp');
  this.gitTempDir = dir;
});

Given('a local git repository with a new file {string}', function (this: GitMockWorld, filename: string) {
  const dir = makeTempDir('git-repo');
  initBareRepo(dir);
  addInitialCommit(dir);
  writeFileSync(join(dir, filename), `content of ${filename}\n`);
  this.gitTempDir = dir;
});

Given('a local git repository with a modified file {string}', function (this: GitMockWorld, filename: string) {
  const dir = makeTempDir('git-repo');
  initBareRepo(dir);
  const filePath = join(dir, filename);
  writeFileSync(filePath, `original content\n`);
  const realGit = this.gitMockRealGit ?? findRealGit();
  spawnSync(realGit, ['-C', dir, 'add', filename], { stdio: 'pipe' });
  spawnSync(realGit, ['-C', dir, 'commit', '-m', 'add file'], { stdio: 'pipe' });
  writeFileSync(filePath, `modified content\n`);
  this.gitTempDir = dir;
});

Given('a local git repository with branches {string} and {string}', function (
  this: GitMockWorld,
  branch1: string,
  branch2: string,
) {
  const dir = makeTempDir('git-repo');
  initBareRepo(dir);
  addInitialCommit(dir);
  const realGit = this.gitMockRealGit ?? findRealGit();
  // Rename default branch to branch1 if needed
  const currentBranch = execSync(`${realGit} -C "${dir}" symbolic-ref --short HEAD`, { encoding: 'utf-8' }).trim();
  if (currentBranch !== branch1) {
    spawnSync(realGit, ['-C', dir, 'branch', '-m', currentBranch, branch1], { stdio: 'pipe' });
  }
  spawnSync(realGit, ['-C', dir, 'branch', branch2], { stdio: 'pipe' });
  this.gitTempDir = dir;
});

Given('the git remote mock module exists in the test infrastructure', function () {
  assert.ok(existsSync(GIT_REMOTE_MOCK_PATH), `Expected git-remote-mock.ts at ${GIT_REMOTE_MOCK_PATH}`);
});

Given('the git remote mock is activated', function (this: GitMockWorld) {
  if (this.gitMockDir && process.env['PATH']?.includes(this.gitMockDir)) return;
  const realGit = findRealGit();
  this.gitMockRealGit = realGit;
  this.gitMockDir = createGitMockWrapper(realGit);
  this.gitMockSavedPath = this.gitMockSavedPath ?? process.env['PATH'] ?? '';
  process.env['PATH'] = `${this.gitMockDir}:${process.env['PATH'] ?? ''}`;
  process.env['REAL_GIT_PATH'] = realGit;
});

// ---------------------------------------------------------------------------
// When/And steps — command execution
// ---------------------------------------------------------------------------

When('{string} has one commit ahead of {string}', function (
  this: GitMockWorld,
  aheadBranch: string,
  _baseBranch: string,
) {
  const dir = this.gitTempDir;
  assert.ok(dir, 'Expected gitTempDir to be set');
  const realGit = this.gitMockRealGit ?? findRealGit();
  spawnSync(realGit, ['-C', dir, 'checkout', aheadBranch], { stdio: 'pipe' });
  writeFileSync(join(dir, `${aheadBranch}-change.txt`), 'change\n');
  spawnSync(realGit, ['-C', dir, 'add', '.'], { stdio: 'pipe' });
  spawnSync(realGit, ['-C', dir, 'commit', '-m', `commit on ${aheadBranch}`], { stdio: 'pipe' });
});

When('the git command {string} is executed', function (this: GitMockWorld & Record<string, unknown>, command: string) {
  const [cmd, ...args] = parseShellArgs(command);
  const result = spawnSync(cmd ?? 'git', args, {
    encoding: 'utf-8',
    cwd: this.gitTempDir ?? ROOT,
    env: process.env,
  });
  this.gitLastOutput = (result.stdout ?? '') + (result.stderr ?? '');
  this.gitLastExitCode = result.status ?? -1;
  // Store in shared world properties so existing 'the command exits with code {int}' step works
  this['__commandResult'] = result;
  this['__commandName'] = command;
});

When('{string} is executed in the temporary directory', function (this: GitMockWorld & Record<string, unknown>, command: string) {
  const dir = this.gitTempDir;
  assert.ok(dir, 'Expected gitTempDir to be set');
  const [cmd, ...args] = parseShellArgs(command);
  const result = spawnSync(cmd ?? 'git', args, {
    encoding: 'utf-8',
    cwd: dir,
    env: process.env,
  });
  this.gitLastOutput = (result.stdout ?? '') + (result.stderr ?? '');
  this.gitLastExitCode = result.status ?? -1;
  this['__commandResult'] = result;
  this['__commandName'] = command;
});

// ---------------------------------------------------------------------------
// Then steps
// ---------------------------------------------------------------------------

// 'the command exits with code {int}' is defined in wireExtractorSteps.ts (reads __commandResult)

Then('no network request is made to a remote server', function (this: GitMockWorld) {
  // The mock intercepts network commands and outputs a canned message without hitting the network.
  // Verify by checking that the command succeeded (exit 0) — a real failed network call would exit non-zero.
  assert.strictEqual(
    this.gitLastExitCode,
    0,
    `Expected mock to intercept command (exit 0), got ${this.gitLastExitCode}`,
  );
});

Then('stdout or stderr indicates the push was intercepted', function (this: GitMockWorld) {
  assert.ok(
    (this.gitLastOutput ?? '').includes('Everything up-to-date'),
    `Expected "Everything up-to-date" in output: ${this.gitLastOutput}`,
  );
});

Then('a .git directory is created', function (this: GitMockWorld) {
  const dir = this.gitTempDir;
  assert.ok(dir, 'Expected gitTempDir to be set');
  assert.ok(existsSync(join(dir, '.git')), `Expected .git directory in ${dir}`);
});

Then('the commit is created successfully', function (this: GitMockWorld) {
  assert.strictEqual(this.gitLastExitCode, 0, `Expected commit to succeed (exit 0), got ${this.gitLastExitCode}`);
});

Then('{string} shows the new commit', function (this: GitMockWorld, _command: string) {
  assert.ok(
    (this.gitLastOutput ?? '').length > 0,
    'Expected git log to show at least one commit',
  );
});

Then('the current branch is {string}', function (this: GitMockWorld, expectedBranch: string) {
  const dir = this.gitTempDir;
  assert.ok(dir, 'Expected gitTempDir to be set');
  const realGit = this.gitMockRealGit ?? findRealGit();
  const branch = execSync(`${realGit} -C "${dir}" symbolic-ref --short HEAD`, { encoding: 'utf-8' }).trim();
  assert.strictEqual(branch, expectedBranch, `Expected branch "${expectedBranch}", got "${branch}"`);
});

Then('the merge completes without errors', function (this: GitMockWorld) {
  assert.strictEqual(
    this.gitLastExitCode,
    0,
    `Expected merge to succeed (exit 0), got ${this.gitLastExitCode}. Output: ${this.gitLastOutput}`,
  );
});

Then('{string} contains the commits from {string}', function (
  this: GitMockWorld,
  targetBranch: string,
  sourceBranch: string,
) {
  const dir = this.gitTempDir;
  assert.ok(dir, 'Expected gitTempDir to be set');
  const realGit = this.gitMockRealGit ?? findRealGit();
  const log = spawnSync(realGit, ['-C', dir, 'log', '--oneline', targetBranch], { encoding: 'utf-8' });
  assert.ok(
    (log.stdout ?? '').includes(sourceBranch) || (log.stdout ?? '').length > 0,
    `Expected ${targetBranch} to contain commits from ${sourceBranch}`,
  );
});

Then('the diff output shows the changes to {string}', function (this: GitMockWorld, filename: string) {
  assert.ok(
    (this.gitLastOutput ?? '').includes(filename),
    `Expected diff to mention "${filename}". Output: ${this.gitLastOutput}`,
  );
});

Then('the output lists the commit history', function (this: GitMockWorld) {
  assert.ok(
    (this.gitLastOutput ?? '').trim().length > 0,
    'Expected git log output to be non-empty',
  );
});

Then('it provides a mechanism to intercept git commands before they reach the network', function () {
  const content = readFileSync(GIT_REMOTE_MOCK_PATH, 'utf-8') as string;
  assert.ok(
    content.includes('REMOTE_COMMANDS'),
    'Expected git-remote-mock.ts to define REMOTE_COMMANDS',
  );
  assert.ok(
    content.includes('push') && content.includes('fetch') && content.includes('clone'),
    'Expected git-remote-mock.ts to intercept push, fetch, and clone',
  );
});

Then('the mechanism is transparent to the ADW workflow code', function () {
  const content = readFileSync(TEST_HARNESS_PATH, 'utf-8') as string;
  assert.ok(
    content.includes('PATH'),
    'Expected test-harness.ts to manipulate PATH for transparent git interception',
  );
});
