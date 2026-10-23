/**
 * Worktree-setup steps for the worktree-setup scenarios of feature-1077.feature. Worktree
 * setup here is what initializeWorkflow does to a new worktree on the --target-repo path: the copy of
 * the framework's Claude assets, then the ignore of specs/. The framework checkout is a fixture handed
 * to copyClaudeAssetsToWorktree as its `frameworkRepoRoot`, so these scenarios depend neither on the
 * real checkout's origin nor on how far behind the branch its prompts are.
 */

import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { GitContext } from '@paysdoc/devplatform/git';

import { copyClaudeAssetsToWorktree, ignoreSpecsInWorktree } from '../../../adws/phases/worktreeSetup.ts';
import { git, initRepo, commitFiles, readRepoFile, writeRepoFile, newGitContext } from './feature-930-fixtures.ts';

const FRAMEWORK_OWNER = 'acme';
const FRAMEWORK_REPO = 'framework';
const FRAMEWORK_ORIGIN = `https://github.com/${FRAMEWORK_OWNER}/${FRAMEWORK_REPO}.git`;
const GITIGNORE = '.gitignore';
const GITIGNORE_WITHOUT_SPECS = 'node_modules/\n';

interface SetupScenario {
  readonly root: string;
  readonly frameworkRoot: string;
  readonly worktreePath: string;
  readonly gitContext: GitContext;
  readonly contentsAfterFirstSetup: Map<string, string>;
}

let current: SetupScenario | null = null;

function scenario(): SetupScenario {
  assert.ok(current, 'Expected a worktree to have been set up first');
  return current;
}

Before({ tags: '@plan-worktree-only' }, function () {
  current = null;
});

After({ tags: '@plan-worktree-only' }, function () {
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

function setUpScenario(owner: string, repo: string, branchFiles: Readonly<Record<string, string>>): SetupScenario {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-930-setup-'));
  const worktreePath = path.join(root, 'worktree');
  initRepo(worktreePath, 'feature-issue-4242-plan-commit');
  commitFiles(worktreePath, branchFiles, 'files the branch tracks');
  current = {
    root,
    frameworkRoot: createFrameworkCheckout(root),
    worktreePath,
    gitContext: newGitContext(owner, repo, root),
    contentsAfterFirstSetup: new Map(),
  };
  return current;
}

function splitRepository(repoFullName: string): [string, string] {
  const [owner, repo] = repoFullName.split('/');
  return [owner, repo];
}

function trackFileThatDoesNotName(owner: string, repo: string, relPath: string, entry: string): void {
  assert.ok(!GITIGNORE_WITHOUT_SPECS.split('\n').includes(entry), `The "${relPath}" the fixture tracks must not name "${entry}"`);
  setUpScenario(owner, repo, { [relPath]: GITIGNORE_WITHOUT_SPECS });
}

/** What initializeWorkflow does to a worktree it creates on the --target-repo path. */
function runWorktreeSetup(sc: SetupScenario): void {
  copyClaudeAssetsToWorktree(sc.worktreePath, sc.gitContext, sc.frameworkRoot);
  ignoreSpecsInWorktree(sc.worktreePath);
}

Given(
  'a fresh worktree of the target repository {string}, whose branch tracks a {string} that does not name {string}',
  function (repoFullName: string, relPath: string, entry: string) {
    const [owner, repo] = splitRepository(repoFullName);
    trackFileThatDoesNotName(owner, repo, relPath, entry);
  },
);

Given(
  "a fresh worktree of the framework's own repository, whose branch tracks a {string} that does not name {string}",
  function (relPath: string, entry: string) {
    trackFileThatDoesNotName(FRAMEWORK_OWNER, FRAMEWORK_REPO, relPath, entry);
  },
);

Given(
  'a fresh worktree of the target repository {string}, whose branch tracks no {string}',
  function (repoFullName: string, relPath: string) {
    const [owner, repo] = splitRepository(repoFullName);
    const sc = setUpScenario(owner, repo, { 'README.md': 'a target repository\n' });
    assert.strictEqual(git(sc.worktreePath, 'ls-files', '--', relPath), '', `The fixture branch must track no "${relPath}"`);
  },
);

Given(
  'a fresh worktree of the target repository {string}, whose branch tracks the {string} an earlier worktree setup wrote',
  function (repoFullName: string, relPath: string) {
    const [owner, repo] = splitRepository(repoFullName);
    const sc = setUpScenario(owner, repo, { [relPath]: GITIGNORE_WITHOUT_SPECS });
    runWorktreeSetup(sc);
    git(sc.worktreePath, 'add', '--', relPath);
    git(sc.worktreePath, 'commit', '-q', '-m', `the ${relPath} an earlier worktree setup wrote`);
    // A later worktree holds what the branch tracks and nothing the earlier one copied in.
    git(sc.worktreePath, 'clean', '-fdxq');
  },
);

Given('worktree setup has run in the worktree', function () {
  const sc = scenario();
  runWorktreeSetup(sc);
  sc.contentsAfterFirstSetup.set(GITIGNORE, readRepoFile(sc.worktreePath, GITIGNORE));
});

When('worktree setup runs in the worktree', function () {
  runWorktreeSetup(scenario());
});

When('worktree setup runs in the worktree again', function () {
  runWorktreeSetup(scenario());
});

/** `git check-ignore -v` prints `<source>:<line>:<pattern>` and a tab before the path; it exits 1 when nothing ignores the path. */
function ignoringEntry(worktreePath: string, relPath: string): { source: string; pattern: string } | null {
  try {
    const match = git(worktreePath, 'check-ignore', '-v', '--', relPath).split('\t')[0].match(/^(.*?):\d+:(.*)$/);
    return match ? { source: match[1], pattern: match[2] } : null;
  } catch {
    return null;
  }
}

Then(
  'git ignores {string} in the worktree by the entry {string} of {string}',
  function (relPath: string, entry: string, source: string) {
    const ignoring = ignoringEntry(scenario().worktreePath, relPath);
    assert.ok(ignoring, `Expected git to ignore "${relPath}" in the worktree`);
    assert.deepStrictEqual(ignoring, { source, pattern: entry });
  },
);

Then('the worktree has an uncommitted change to {string}', function (relPath: string) {
  const sc = scenario();
  assert.notStrictEqual(git(sc.worktreePath, 'status', '--porcelain', '--', relPath), '', `Expected an uncommitted change to "${relPath}"`);
});

Then("the worktree's {string} is as the first run of worktree setup left it", function (relPath: string) {
  const sc = scenario();
  const left = sc.contentsAfterFirstSetup.get(relPath);
  assert.notStrictEqual(left, undefined, `Expected the first run of worktree setup to have left "${relPath}"`);
  assert.strictEqual(readRepoFile(sc.worktreePath, relPath), left);
});

Then('the worktree has no uncommitted change to {string}', function (relPath: string) {
  const sc = scenario();
  assert.strictEqual(git(sc.worktreePath, 'status', '--porcelain', '--', relPath), '', `Expected no uncommitted change to "${relPath}"`);
});

Then("git lists {string} among the worktree's untracked files that are not ignored", function (relPath: string) {
  const sc = scenario();
  const untracked = git(sc.worktreePath, 'ls-files', '--others', '--exclude-standard').split('\n');
  assert.ok(untracked.includes(relPath), `Expected "${relPath}" among the untracked files that are not ignored: ${untracked.join(', ')}`);
});
