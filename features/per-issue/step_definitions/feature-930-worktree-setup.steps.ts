/**
 * Worktree-setup steps for feature-930.feature. The framework checkout is a fixture handed to
 * copyClaudeAssetsToWorktree as its `frameworkRepoRoot`, so these scenarios depend neither on the
 * real checkout's origin nor on how far behind the branch its prompts are.
 */

import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { GitContext } from '@paysdoc/devplatform/git';

import { copyClaudeAssetsToWorktree } from '../../../adws/phases/worktreeSetup.ts';
import { git, initRepo, commitFiles, readRepoFile, writeRepoFile, newGitContext } from './feature-930-fixtures.ts';

const FRAMEWORK_ORIGIN = 'https://github.com/acme/framework.git';

interface SetupScenario {
  readonly root: string;
  readonly frameworkRoot: string;
  readonly worktreePath: string;
  readonly gitContext: GitContext;
}

let current: SetupScenario | null = null;

function scenario(): SetupScenario {
  assert.ok(current, 'Expected a worktree to have been set up first');
  return current;
}

Before({ tags: '@adw-930' }, function () {
  current = null;
});

After({ tags: '@adw-930' }, function () {
  if (current) fs.rmSync(current.root, { recursive: true, force: true });
  current = null;
});

function frontmatter(target: boolean, body: string): string {
  return `---\ntarget: ${target}\n---\n${body}\n`;
}

/** Older than the branch's copies, and shaped like the real checkout: `feature.md` is `target: false`, `install.md` is `target: true`. */
function createFrameworkCheckout(root: string): string {
  const frameworkRoot = path.join(root, 'framework');
  initRepo(frameworkRoot, 'main');
  git(frameworkRoot, 'remote', 'add', 'origin', FRAMEWORK_ORIGIN);
  writeRepoFile(frameworkRoot, '.claude/commands/scenario_writer.md', frontmatter(false, 'older copy in the framework checkout'));
  writeRepoFile(frameworkRoot, '.claude/skills/tdd/SKILL.md', frontmatter(true, 'older copy in the framework checkout'));
  writeRepoFile(frameworkRoot, '.claude/commands/feature.md', frontmatter(false, 'framework feature planner'));
  writeRepoFile(frameworkRoot, '.claude/commands/install.md', frontmatter(true, 'framework installer'));
  return frameworkRoot;
}

function setUpScenario(owner: string, repo: string, branchFiles: Readonly<Record<string, string>>): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-930-setup-'));
  const worktreePath = path.join(root, 'worktree');
  initRepo(worktreePath, 'feature-issue-4242-plan-commit');
  commitFiles(worktreePath, branchFiles, 'files the branch tracks');
  current = {
    root,
    frameworkRoot: createFrameworkCheckout(root),
    worktreePath,
    gitContext: newGitContext(owner, repo, root),
  };
}

Given(
  "a worktree of the framework's own repository whose branch carries a newer {string} than the framework checkout running the workflow",
  function (relPath: string) {
    setUpScenario('acme', 'framework', { [relPath]: frontmatter(false, `newer copy on the branch: ${relPath}`) });
  },
);

Given('a worktree of a target repository that tracks nothing under {string}', function (_relDir: string) {
  setUpScenario('acme', 'widgets', { 'README.md': 'a target repository\n' });
});

When("worktree setup copies the framework's Claude assets into the worktree", function () {
  const sc = scenario();
  copyClaudeAssetsToWorktree(sc.worktreePath, sc.gitContext, sc.frameworkRoot);
});

Then("the worktree's {string} is the copy its branch carries", function (relPath: string) {
  const sc = scenario();
  assert.strictEqual(readRepoFile(sc.worktreePath, relPath), git(sc.worktreePath, 'show', `HEAD:${relPath}`) + '\n');
});

Then('the worktree has no uncommitted change to {string}', function (relPath: string) {
  const sc = scenario();
  assert.strictEqual(git(sc.worktreePath, 'status', '--porcelain', '--', relPath), '', `Expected no uncommitted change to "${relPath}"`);
});

Then("git lists {string} among the worktree's ignored files", function (relPath: string) {
  const sc = scenario();
  const ignored = git(sc.worktreePath, 'ls-files', '--others', '--ignored', '--exclude-standard').split('\n');
  assert.ok(ignored.includes(relPath), `Expected "${relPath}" among the ignored files: ${ignored.join(', ')}`);
});

Then("git lists {string} among the worktree's untracked files that are not ignored", function (relPath: string) {
  const sc = scenario();
  const untracked = git(sc.worktreePath, 'ls-files', '--others', '--exclude-standard').split('\n');
  assert.ok(untracked.includes(relPath), `Expected "${relPath}" among the untracked files that are not ignored: ${untracked.join(', ')}`);
});
