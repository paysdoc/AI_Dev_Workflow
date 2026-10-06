/**
 * The launch boundary the §2 and §3 scenarios share: built by `buildLaunchBoundary` over the recording
 * providers of feature-796's `world796` harness, with every seam injected, so no call reaches GitHub.
 * The code host answers `getDefaultBranch()` from the scenario's own Given steps, read when the code
 * under test asks, so the order of those steps does not matter.
 */

import { Before, Given } from '@cucumber/cucumber';
import assert from 'assert';

import type { LaunchBoundary } from '../../../adws/core/launchGitContext.ts';

import { buildRecordingBoundary, resetWorld, splitRepo, world796 } from '../../regression/step_definitions/feature-796.steps.ts';
import { trackTempDir } from './feature-933-fixture.ts';

Before({ tags: '@adw-933' }, function () {
  resetWorld();
});

/** One boundary per scenario: the §2 and §3 scenarios each act on a single repository. */
export function ensureBoundary(repoStr: string): LaunchBoundary {
  const w = world796();
  const { owner, repo } = splitRepo(repoStr);
  if (w.boundary) {
    assert.deepStrictEqual(
      { owner: w.boundary.repoId.owner, repo: w.boundary.repoId.repo },
      { owner, repo },
      `Expected the scenario's single boundary to belong to ${repoStr}`,
    );
    return w.boundary;
  }
  buildRecordingBoundary(owner, repo);
  trackTempDir(w.frameworkRoot);
  trackTempDir(w.targetReposDir);
  assert.ok(w.boundary, 'Expected the recording launch boundary to have been built');
  return w.boundary;
}

export function targetReposDir(): string {
  return world796().targetReposDir;
}

function codeHostFixture(repoStr: string): NonNullable<ReturnType<typeof world796>['activeFixture']> {
  ensureBoundary(repoStr);
  const { activeFixture } = world796();
  assert.ok(activeFixture, 'Expected the recording code host to have been set up');
  return activeFixture;
}

Given('the code host reports {string} as the default branch of {string}', function (branch: string, repoStr: string) {
  const fixture = codeHostFixture(repoStr);
  fixture.defaultBranch = branch;
  fixture.refuseDefaultBranch = false;
});

Given('the code host fails to report the default branch of {string}', function (repoStr: string) {
  codeHostFixture(repoStr).refuseDefaultBranch = true;
});
