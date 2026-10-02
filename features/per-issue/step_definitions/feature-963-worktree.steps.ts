/**
 * Checks of the worktree G11 makes, read through real git in the worktree G11 registered. This
 * feature carries no @regression tag, so G11 runs here without REAL_GIT_PATH.
 */

import { Then } from '@cucumber/cucumber';
import assert from 'assert';
import { realpathSync } from 'fs';
import { tmpdir } from 'os';
import { isAbsolute, relative } from 'path';

import { REPO_ROOT } from '../../../adws/core/environment.ts';
import { realGit } from '../../regression/support/fixtureWorktree.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

function worktreeOf(world: RegressionWorld, adwId: string): string {
  const worktree = world.worktreePaths.get(adwId);
  assert.ok(worktree, `No worktree is registered for adwId "${adwId}": G11 has not run for it`);
  return worktree;
}

function isUnder(path: string, directory: string): boolean {
  const relativePath = relative(directory, path);
  return !relativePath.startsWith('..') && !isAbsolute(relativePath);
}

function ignores(worktree: string, name: string): boolean {
  try {
    realGit(worktree, 'check-ignore', '-q', name);
    return true;
  } catch {
    return false;
  }
}

// On macOS the temporary directory is reached through a /var link to /private/var, so both sides are resolved.
Then("the worktree for adwId {string} and its origin lie under the system's temporary directory", function (this: RegressionWorld, adwId: string) {
  const worktree = worktreeOf(this, adwId);
  const origin = realGit(worktree, 'remote', 'get-url', 'origin');
  const temporary = realpathSync(tmpdir());

  const outside = [worktree, origin].filter((path) => !isUnder(realpathSync(path), temporary));

  assert.deepStrictEqual(outside, [], `Expected the worktree and its origin to lie under ${temporary}`);
});

Then('the worktree for adwId {string} has the branch {string} checked out', function (this: RegressionWorld, adwId: string, branch: string) {
  assert.strictEqual(realGit(worktreeOf(this, adwId), 'rev-parse', '--abbrev-ref', 'HEAD'), branch);
});

Then(
  'in the worktree for adwId {string}, {string}, {string} and {string} name the same commit',
  function (this: RegressionWorld, adwId: string, first: string, second: string, third: string) {
    const worktree = worktreeOf(this, adwId);
    const refs = [first, second, third];

    const commits = refs.map((ref) => realGit(worktree, 'rev-parse', '--verify', `${ref}^{commit}`));

    assert.strictEqual(new Set(commits).size, 1, `Expected ${refs.join(', ')} to name one commit, but they name ${commits.join(', ')}`);
  },
);

Then(
  'in the worktree for adwId {string}, the branch {string} tracks every file of {string}',
  function (this: RegressionWorld, adwId: string, branch: string, directory: string) {
    const worktree = worktreeOf(this, adwId);
    const inCheckout = realGit(REPO_ROOT, 'ls-files', directory)
      .split('\n')
      .filter(Boolean)
      .map((path) => path.slice(directory.length + 1));
    assert.ok(inCheckout.length > 0, `Expected the checkout to track files under ${directory}`);

    const tracked = new Set(realGit(worktree, 'ls-tree', '-r', '--name-only', branch).split('\n'));
    const missing = inCheckout.filter((path) => !tracked.has(path));

    assert.deepStrictEqual(missing, [], `Expected the branch ${branch} to track every file of ${directory}`);
  },
);

Then(
  'git ignores {string}, {string} and {string} in the worktree for adwId {string}',
  function (this: RegressionWorld, first: string, second: string, third: string, adwId: string) {
    const worktree = worktreeOf(this, adwId);

    const notIgnored = [first, second, third].filter((name) => !ignores(worktree, name));

    assert.deepStrictEqual(notIgnored, [], `Expected git to ignore every stub file in ${worktree}`);
  },
);
