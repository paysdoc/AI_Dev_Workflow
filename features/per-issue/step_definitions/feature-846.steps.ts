/**
 * Step definitions for feature-846.feature
 *
 * Drives the real `ensureTargetRepoWorkspace` (adws/core/targetRepoManager.ts)
 * in a child process (features/per-issue/support/feature-846-ensure-driver.ts)
 * against a temporary HOME and a temporary TARGET_REPOS_DIR, and asserts the
 * `~/.claude.json` workspace-trust entry `ensureWorkspaceTrusted` writes.
 *
 * A fresh temp home + temp target-repos root + bare git remote are built via
 * the Background's own Given steps, reset by this file's `@adw-846`-scoped
 * `Before`/`After` hooks. The bare remote is real git plumbing (git init
 * --bare + one commit on main), so the clone/fetch the driver performs is
 * real, not stubbed. `HOME` is overridden in the child's env because
 * `os.homedir()` honours it on POSIX; `TARGET_REPOS_DIR` because
 * `adws/core/environment.ts` binds it at import time.
 */

import { Given, When, Then, Before, After } from '@cucumber/cucumber';
import assert from 'assert';
import { execSync, spawnSync } from 'child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';

const REPO_ROOT = process.cwd();
const OWNER = 'adw-fixture';
const REPO = 'void-846';
const DRIVER_PATH = 'features/per-issue/support/feature-846-ensure-driver.ts';

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

interface World846 {
  tempHome: string | null;
  targetReposDir: string | null;
  bareRemote: string | null;
  stdout: string;
  stderr: string;
  exitCode: number;
  workspacePath: string | null;
  configBefore: string | null;
}

function freshWorld846(): World846 {
  return {
    tempHome: null,
    targetReposDir: null,
    bareRemote: null,
    stdout: '',
    stderr: '',
    exitCode: 0,
    workspacePath: null,
    configBefore: null,
  };
}

let w: World846 = freshWorld846();

Before({ tags: '@adw-846' }, function () {
  w = freshWorld846();
});

After({ tags: '@adw-846' }, function () {
  for (const dir of [w.tempHome, w.targetReposDir, w.bareRemote]) {
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
  w = freshWorld846();
});

// ---------------------------------------------------------------------------
// Git + fs helpers
// ---------------------------------------------------------------------------

function git(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
}

/** Seeds a real bare remote + one commit on a branch literally named "main"; a filesystem path passes through convertToSshUrl untouched, so the driver's clone/fetch is local and network-free. */
function seedBareRemote(): string {
  const bareRemote = mkdtempSync(path.join(tmpdir(), 'adw-846-bare-'));
  git('git init --bare', bareRemote);
  git('git symbolic-ref HEAD refs/heads/main', bareRemote);

  const seedWorkdir = mkdtempSync(path.join(tmpdir(), 'adw-846-seed-'));
  git(`git clone "${bareRemote}" .`, seedWorkdir);
  git('git config user.email "adw-846@test.local"', seedWorkdir);
  git('git config user.name "ADW Test 846"', seedWorkdir);
  writeFileSync(path.join(seedWorkdir, 'README.md'), '# fixture repo\n');
  git('git add -A', seedWorkdir);
  git('git commit -m "seed fixture repo"', seedWorkdir);
  git('git push -u origin main', seedWorkdir);
  rmSync(seedWorkdir, { recursive: true, force: true });

  return bareRemote;
}

function claudeConfigPathFor(home: string): string {
  return path.join(home, '.claude.json');
}

function writeClaudeConfig(home: string, config: unknown): void {
  writeFileSync(claudeConfigPathFor(home), JSON.stringify(config, null, 2), 'utf-8');
}

function readClaudeConfig(home: string): Record<string, unknown> {
  return JSON.parse(readFileSync(claudeConfigPathFor(home), 'utf-8')) as Record<string, unknown>;
}

function readProjects(home: string): Record<string, Record<string, unknown>> {
  const config = readClaudeConfig(home);
  return (config.projects as Record<string, Record<string, unknown>>) ?? {};
}

/** Runs the driver and records stdout/stderr/exit code; on success, extracts the workspace path from the LAST line of stdout — ensureWorkspaceTrusted's own info/warn logs share stdout and precede it. */
function runDriver(cloneUrl: string): void {
  assert.ok(w.tempHome, 'Expected a temporary home to have been created first');
  assert.ok(w.targetReposDir, 'Expected a temporary target repositories root to have been created first');

  const result = spawnSync('bunx', ['tsx', DRIVER_PATH, OWNER, REPO, cloneUrl], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    env: { ...process.env, HOME: w.tempHome, TARGET_REPOS_DIR: w.targetReposDir, NODE_OPTIONS: '' },
  });

  w.stdout = result.stdout ?? '';
  w.stderr = result.stderr ?? '';
  w.exitCode = result.status ?? 1;

  if (w.exitCode === 0) {
    const lines = w.stdout.trim().split('\n');
    const lastLine = lines[lines.length - 1];
    const parsed = JSON.parse(lastLine) as { workspacePath: string };
    w.workspacePath = parsed.workspacePath;
  }
}

// ---------------------------------------------------------------------------
// Background
// ---------------------------------------------------------------------------

Given('a temporary home directory for workspace trust', function () {
  w.tempHome = mkdtempSync(path.join(tmpdir(), 'adw-846-home-'));
});

Given('a temporary target repositories root for workspace trust', function () {
  w.targetReposDir = mkdtempSync(path.join(tmpdir(), 'adw-846-targets-'));
});

Given('a real git remote seeded for workspace trust', function () {
  w.bareRemote = seedBareRemote();
});

// ---------------------------------------------------------------------------
// When / shared Then
// ---------------------------------------------------------------------------

When('the target repository workspace is ensured from a child process bound to that home', function () {
  assert.ok(w.bareRemote, 'Expected a bare git remote to have been seeded first');
  runDriver(w.bareRemote);
});

Then('the driver exits 0', function () {
  assert.strictEqual(w.exitCode, 0, `Expected the driver to exit 0. stdout:\n${w.stdout}\nstderr:\n${w.stderr}`);
});

Then('the home\'s .claude.json trusts the reported workspace path', function () {
  assert.ok(w.tempHome, 'Expected a temporary home to exist');
  assert.ok(w.workspacePath, 'Expected the driver to have reported a workspace path');
  const projects = readProjects(w.tempHome);
  const entry = projects[w.workspacePath];
  assert.ok(entry, `Expected a projects entry for "${w.workspacePath}"`);
  assert.strictEqual(entry.hasTrustDialogAccepted, true);
});

Then('no .claude.json.tmp file remains in the home', function () {
  assert.ok(w.tempHome, 'Expected a temporary home to exist');
  assert.ok(!existsSync(`${claudeConfigPathFor(w.tempHome)}.tmp`), 'Expected no .claude.json.tmp sibling to remain');
});

// ---------------------------------------------------------------------------
// Scenario 1 — never-cloned repo, fresh config with no projects key
// ---------------------------------------------------------------------------

Given('the home\'s .claude.json holds a fresh config with no projects key', function () {
  assert.ok(w.tempHome, 'Expected a temporary home to exist');
  writeClaudeConfig(w.tempHome, { numStartups: 1 });
});

Then('the reported workspace path is inside the target repositories root', function () {
  assert.ok(w.workspacePath, 'Expected the driver to have reported a workspace path');
  assert.ok(w.targetReposDir, 'Expected a temporary target repositories root to exist');
  const rel = path.relative(w.targetReposDir, w.workspacePath);
  assert.ok(
    rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel),
    `Expected "${w.workspacePath}" to be inside "${w.targetReposDir}"`,
  );
});

Then('the home\'s .claude.json still has the fresh config\'s sibling key intact', function () {
  assert.ok(w.tempHome, 'Expected a temporary home to exist');
  const config = readClaudeConfig(w.tempHome);
  assert.strictEqual(config.numStartups, 1);
});

// ---------------------------------------------------------------------------
// Scenario 2 — already-cloned repo (fetch branch), sibling data preserved
// ---------------------------------------------------------------------------

Given('the workspace has already been cloned by an earlier ensure', function () {
  assert.ok(w.bareRemote, 'Expected a bare git remote to have been seeded first');
  runDriver(w.bareRemote);
  assert.strictEqual(w.exitCode, 0, `Expected the priming ensure to exit 0. stdout:\n${w.stdout}\nstderr:\n${w.stderr}`);
  assert.ok(w.workspacePath, 'Expected the priming ensure to report a workspace path');
});

Given('the home\'s .claude.json records the cloned workspace as untrusted with a sibling project already trusted', function () {
  assert.ok(w.tempHome, 'Expected a temporary home to exist');
  assert.ok(w.workspacePath, 'Expected a workspace path to already be known');
  writeClaudeConfig(w.tempHome, {
    projects: {
      [w.workspacePath]: { hasTrustDialogAccepted: false, allowedTools: ['Bash'] },
      '/elsewhere/other': { hasTrustDialogAccepted: true },
    },
  });
});

Then('the home\'s .claude.json preserved the cloned workspace\'s sibling key', function () {
  assert.ok(w.tempHome, 'Expected a temporary home to exist');
  assert.ok(w.workspacePath, 'Expected a workspace path to be known');
  const projects = readProjects(w.tempHome);
  assert.deepStrictEqual(projects[w.workspacePath].allowedTools, ['Bash']);
});

Then('the home\'s .claude.json left the sibling project untouched', function () {
  assert.ok(w.tempHome, 'Expected a temporary home to exist');
  const projects = readProjects(w.tempHome);
  assert.deepStrictEqual(projects['/elsewhere/other'], { hasTrustDialogAccepted: true });
});

// ---------------------------------------------------------------------------
// Scenario 3 — the trusted key is the exact reported workspace path
// ---------------------------------------------------------------------------

Given('the home\'s .claude.json holds an empty projects map', function () {
  assert.ok(w.tempHome, 'Expected a temporary home to exist');
  writeClaudeConfig(w.tempHome, { projects: {} });
});

Then('the home\'s .claude.json project keys contain exactly the reported workspace path', function () {
  assert.ok(w.tempHome, 'Expected a temporary home to exist');
  assert.ok(w.workspacePath, 'Expected the driver to have reported a workspace path');
  const projects = readProjects(w.tempHome);
  assert.deepStrictEqual(Object.keys(projects), [w.workspacePath]);
});

// ---------------------------------------------------------------------------
// Scenario 4 — missing ~/.claude.json never blocks the ensure
// ---------------------------------------------------------------------------

Given('the home has no .claude.json file', function () {
  assert.ok(w.tempHome, 'Expected a temporary home to exist');
  assert.ok(!existsSync(claudeConfigPathFor(w.tempHome)), 'Expected no .claude.json to exist yet');
});

Then('the reported workspace path exists as a git checkout', function () {
  assert.ok(w.workspacePath, 'Expected the driver to have reported a workspace path');
  assert.ok(existsSync(path.join(w.workspacePath, '.git')), `Expected a .git entry under "${w.workspacePath}"`);
});

Then('the driver\'s output mentions skipping workspace trust', function () {
  const combined = `${w.stdout}\n${w.stderr}`;
  assert.ok(
    combined.includes('Skipping workspace trust'),
    `Expected output to mention "Skipping workspace trust", got:\n${combined}`,
  );
});

Then('the home still has no .claude.json file', function () {
  assert.ok(w.tempHome, 'Expected a temporary home to exist');
  assert.ok(!existsSync(claudeConfigPathFor(w.tempHome)), 'Expected .claude.json still not to exist');
});

// ---------------------------------------------------------------------------
// Scenario 5 — already-trusted workspace leaves the file byte-identical
// ---------------------------------------------------------------------------

Given('the home\'s .claude.json already trusts the cloned workspace', function () {
  assert.ok(w.tempHome, 'Expected a temporary home to exist');
  assert.ok(w.workspacePath, 'Expected a workspace path to already be known');
  writeClaudeConfig(w.tempHome, { projects: { [w.workspacePath]: { hasTrustDialogAccepted: true } } });
});

Given('the home\'s .claude.json bytes are captured', function () {
  assert.ok(w.tempHome, 'Expected a temporary home to exist');
  w.configBefore = readFileSync(claudeConfigPathFor(w.tempHome), 'utf-8');
});

Then('the home\'s .claude.json bytes are unchanged', function () {
  assert.ok(w.tempHome, 'Expected a temporary home to exist');
  assert.ok(w.configBefore !== null, 'Expected the config bytes to have been captured');
  const after = readFileSync(claudeConfigPathFor(w.tempHome), 'utf-8');
  assert.strictEqual(after, w.configBefore);
});
