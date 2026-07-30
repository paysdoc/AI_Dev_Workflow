/**
 * BDD step definitions for feature-763.feature
 *
 * Drives the REAL copyStarterSettingsToWorktree / decideStarterSettingsCopy against a
 * throwaway temp git repo — no LLM needed, the copy is deterministic. Self-contained with
 * its own @adw-763 Before/After and module-private state; mirrors feature-729.steps.ts's
 * helpers. Does NOT reach into feature-729's or feature-762's step defs.
 *
 * Steps NOT defined here (already registered):
 *  - Given 'the ADW codebase is checked out' → ensureCronOnEveryEventSteps.ts (G18)
 *  - Then 'the ADW TypeScript type-check passes' → feature-504.steps.ts (T22)
 */

import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { copyStarterSettingsToWorktree, type StarterSettingsResult } from '../../../adws/phases/worktreeSetup.ts';
import { commitOps } from '../../../adws/gitContext/commitOps.ts';

// ---------------------------------------------------------------------------
// Module-level scenario state (reset in Before/After hooks)
// ---------------------------------------------------------------------------

const frameworkRepoRoot = process.cwd();

let worktreeDir: string | undefined;
let copyResult: StarterSettingsResult | undefined;
let preExistingBytes: Buffer | undefined;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function initGitRepo(dir: string): void {
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@adw.local"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "ADW Test"', { cwd: dir, stdio: 'pipe' });
}

function realRun(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
}

function commitBaseline(dir: string): void {
  const adwDir = path.join(dir, '.adw');
  fs.mkdirSync(adwDir, { recursive: true });
  fs.writeFileSync(path.join(adwDir, 'project.md'), 'baseline\n');
  execSync('git add -A', { cwd: dir, stdio: 'pipe' });
  execSync('git commit -m "baseline"', { cwd: dir, stdio: 'pipe' });
}

function settingsPath(dir: string): string {
  return path.join(dir, '.claude', 'settings.json');
}

function committedTreeFiles(): string[] {
  if (!worktreeDir) throw new Error('worktreeDir not set');
  return execSync('git show --name-only --format= HEAD', { cwd: worktreeDir, encoding: 'utf-8' })
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean);
}

function readCommittedBlob(relPath: string): Buffer {
  if (!worktreeDir) throw new Error('worktreeDir not set');
  return execSync(`git show HEAD:${relPath}`, { cwd: worktreeDir });
}

function readCommittedJson(relPath: string): Record<string, unknown> {
  return JSON.parse(readCommittedBlob(relPath).toString('utf-8')) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Before / After hooks — scoped to @adw-763
// ---------------------------------------------------------------------------

Before({ tags: '@adw-763' }, function () {
  worktreeDir = undefined;
  copyResult = undefined;
  preExistingBytes = undefined;
});

After({ tags: '@adw-763' }, function () {
  if (worktreeDir) {
    fs.rmSync(worktreeDir, { recursive: true, force: true });
    worktreeDir = undefined;
  }
});

// ---------------------------------------------------------------------------
// Given
// ---------------------------------------------------------------------------

Given('a fresh target-repo worktree with no ".claude\\/settings.json"', function () {
  worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-763-'));
  initGitRepo(worktreeDir);
  commitBaseline(worktreeDir);
});

Given('a target-repo worktree that already ships an owner-authored ".claude\\/settings.json"', function () {
  worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-763-'));
  initGitRepo(worktreeDir);

  const destPath = settingsPath(worktreeDir);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const ownerContent = `${JSON.stringify({ permissions: { allow: ['Bash(ls:*)'] } }, null, 2)}\n`;
  fs.writeFileSync(destPath, ownerContent);

  execSync('git add -A', { cwd: worktreeDir, stdio: 'pipe' });
  execSync('git commit -m "owner-authored settings"', { cwd: worktreeDir, stdio: 'pipe' });

  preExistingBytes = fs.readFileSync(destPath);
});

Given('the starter guardrail settings have already been written and committed into the target worktree', function () {
  if (!worktreeDir) throw new Error('worktreeDir not set — the "fresh target-repo worktree" Given must run first');
  copyStarterSettingsToWorktree(worktreeDir, frameworkRepoRoot);
  commitOps.commitChanges(realRun, 'chore: copy starter guardrails settings (prior)', worktreeDir);
  preExistingBytes = fs.readFileSync(settingsPath(worktreeDir));
});

// ---------------------------------------------------------------------------
// When
// ---------------------------------------------------------------------------

When('the framework init runs its starter-guardrail-settings step over the target worktree', function () {
  if (!worktreeDir) throw new Error('worktreeDir not set');
  copyResult = copyStarterSettingsToWorktree(worktreeDir, frameworkRepoRoot);
  // Guarded by commitChanges' own `git status --porcelain` check — a skip case that leaves
  // nothing to stage is a safe no-op here, exactly like the real adwUpgrade.tsx call site.
  commitOps.commitChanges(realRun, 'chore: copy starter guardrails settings', worktreeDir);
});

// ---------------------------------------------------------------------------
// Then
// ---------------------------------------------------------------------------

Then('the resulting commit tree carries {string}', function (file: string) {
  const files = committedTreeFiles();
  assert.ok(
    files.includes(file),
    `Expected commit tree to include "${file}" but it contained: ${JSON.stringify(files)}`,
  );
});

Then('{string} is not gitignored in the target worktree', function (relPath: string) {
  if (!worktreeDir) throw new Error('worktreeDir not set');
  let ignoredOutput = '';
  let threw = false;
  try {
    ignoredOutput = execSync(`git check-ignore -- '${relPath}'`, {
      cwd: worktreeDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    // Non-zero exit (1) is git check-ignore's "nothing matched" signal — not ignored.
    threw = true;
  }
  const ignored = !threw && ignoredOutput.trim().length > 0;
  assert.strictEqual(ignored, false, `Expected "${relPath}" not to be gitignored in the target worktree`);
});

Then(
  'the committed ".claude\\/settings.json" is a verbatim copy of the starter guardrail template',
  function () {
    const committed = readCommittedBlob('.claude/settings.json');
    const template = fs.readFileSync(
      path.join(frameworkRepoRoot, 'templates', 'claude-settings-starter.json'),
    );
    assert.ok(
      committed.equals(template),
      'Expected committed .claude/settings.json to be byte-for-byte identical to templates/claude-settings-starter.json',
    );
  },
);

Then('the pre-existing ".claude\\/settings.json" is left byte-for-byte unchanged', function () {
  if (!worktreeDir) throw new Error('worktreeDir not set');
  assert.ok(preExistingBytes, 'preExistingBytes snapshot was not captured by the Given step');
  const current = fs.readFileSync(settingsPath(worktreeDir));
  assert.ok(
    current.equals(preExistingBytes!),
    'Expected .claude/settings.json bytes to be unchanged from the pre-existing snapshot',
  );
});

Then('the framework init records that it skipped the existing settings file', function () {
  assert.ok(copyResult, 'copyResult was not captured by the When step');
  assert.strictEqual(
    copyResult!.action,
    'skipped',
    `Expected the starter-settings step to record a skip but got action="${copyResult!.action}"`,
  );
});

Then('the starter-guardrail-settings step stages no change to {string}', function (relPath: string) {
  if (!worktreeDir) throw new Error('worktreeDir not set');
  const status = execSync(`git status --porcelain -- '${relPath}'`, { cwd: worktreeDir, encoding: 'utf-8' });
  assert.strictEqual(
    status.trim(),
    '',
    `Expected no staged/dirty change to "${relPath}" but git status reported:\n${status}`,
  );
});

Then('the committed starter settings carries a deny permission list', function () {
  const json = readCommittedJson('.claude/settings.json');
  const permissions = json['permissions'] as { deny?: unknown } | undefined;
  assert.ok(
    Array.isArray(permissions?.deny) && permissions!.deny.length > 0,
    `Expected committed settings to carry a non-empty permissions.deny array, got: ${JSON.stringify(json)}`,
  );
});

Then('the committed starter settings carries no hooks', function () {
  const json = readCommittedJson('.claude/settings.json');
  assert.ok(
    !('hooks' in json),
    `Expected committed settings to carry no "hooks" key, got: ${JSON.stringify(json)}`,
  );
});
