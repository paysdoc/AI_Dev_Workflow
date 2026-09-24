import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { copyAdwInitCommandToWorktree } from '../../../adws/phases/worktreeSetup.ts';
import { commitOps } from '@paysdoc/devplatform/git';

let worktreeDir: string | undefined;
let preCommitHead: string | undefined;
let commitThrew: Error | undefined;

function initGitRepo(dir: string): void {
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@adw.local"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "ADW Test"', { cwd: dir, stdio: 'pipe' });
}

function realRun(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
}

function currentHead(dir: string): string | null {
  try {
    return execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

function committedTreeFiles(): string[] {
  if (!worktreeDir) throw new Error('worktreeDir not set');
  assert.ok(!commitThrew, `Cannot inspect commit tree — commitChanges threw: ${commitThrew?.message}`);
  return execSync('git show --name-only --format= HEAD', { cwd: worktreeDir, encoding: 'utf-8' })
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean);
}

Before({ tags: '@adw-729' }, function () {
  worktreeDir = undefined;
  preCommitHead = undefined;
  commitThrew = undefined;
});

After({ tags: '@adw-729' }, function () {
  if (worktreeDir) {
    fs.rmSync(worktreeDir, { recursive: true, force: true });
    worktreeDir = undefined;
  }
});

Given(
  'an upgrade regen worktree whose command file ".claude\\/commands\\/adw_init.md" is gitignored by the real copy-init-command step',
  function () {
    worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-729-'));
    initGitRepo(worktreeDir);

    const adwDir = path.join(worktreeDir, '.adw');
    fs.mkdirSync(adwDir, { recursive: true });
    fs.writeFileSync(path.join(adwDir, 'project.md'), 'baseline\n');
    execSync('git add -A', { cwd: worktreeDir, stdio: 'pipe' });
    execSync('git commit -m "baseline"', { cwd: worktreeDir, stdio: 'pipe' });

    // frameworkRepoRoot is the ADW checkout, which holds the real command file to copy.
    copyAdwInitCommandToWorktree(worktreeDir, process.cwd());
  },
);

Given(
  'an upgrade regen worktree with a tracked, modified ".claude\\/commands\\/adw_init.md" that is not gitignored',
  function () {
    worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-729-'));
    initGitRepo(worktreeDir);

    const adwDir = path.join(worktreeDir, '.adw');
    fs.mkdirSync(adwDir, { recursive: true });
    fs.writeFileSync(path.join(adwDir, 'project.md'), 'baseline\n');

    const cmdDir = path.join(worktreeDir, '.claude', 'commands');
    fs.mkdirSync(cmdDir, { recursive: true });
    fs.writeFileSync(path.join(cmdDir, 'adw_init.md'), 'original command\n');

    execSync('git add -A', { cwd: worktreeDir, stdio: 'pipe' });
    execSync('git commit -m "baseline"', { cwd: worktreeDir, stdio: 'pipe' });

    fs.writeFileSync(path.join(cmdDir, 'adw_init.md'), 'modified command\n');
  },
);

Given(
  'the worktree has a pending regen change to {string}',
  function (file: string) {
    if (!worktreeDir) throw new Error('worktreeDir not set');
    const filePath = path.join(worktreeDir, file);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'regenerated content\n');
  },
);

When(
  'the framework upgrade commits the regen excluding {string}',
  function (excludePath: string) {
    if (!worktreeDir) throw new Error('worktreeDir not set');
    preCommitHead = currentHead(worktreeDir) ?? undefined;
    commitThrew = undefined;
    try {
      commitOps.commitChanges(realRun, 'chore: regenerate .adw/ for framework upgrade', worktreeDir, {
        excludePaths: [excludePath],
      });
    } catch (error) {
      commitThrew = error as Error;
    }
  },
);

Then(
  'the regen commit is recorded on the worktree branch',
  function () {
    assert.ok(!commitThrew, `Expected commitChanges not to throw but it threw: ${commitThrew?.message}`);
    if (!worktreeDir) throw new Error('worktreeDir not set');
    const headAfter = currentHead(worktreeDir);
    assert.ok(headAfter, 'Expected a HEAD commit to exist after the commit step');
    assert.notStrictEqual(
      headAfter,
      preCommitHead,
      `Expected HEAD to advance past the baseline (${preCommitHead}) but it did not`,
    );
  },
);

Then(
  "the recorded commit's tree includes {string}",
  function (file: string) {
    const files = committedTreeFiles();
    assert.ok(
      files.includes(file),
      `Expected commit tree to include "${file}" but it contained: ${JSON.stringify(files)}`,
    );
  },
);

Then(
  "the recorded commit's tree excludes {string}",
  function (file: string) {
    const files = committedTreeFiles();
    assert.ok(
      !files.includes(file),
      `Expected commit tree to exclude "${file}" but it contained: ${JSON.stringify(files)}`,
    );
  },
);
