/**
 * Step definitions for the git-mock scenarios of feature-965.feature (§2): they run
 * test/mocks/git-remote-mock.ts directly, from a G11 worktree, and read the log it wrote. The
 * harness's own log (§3) and the Actions-secret route (§5) are in feature-965-harness.steps.ts, the
 * per-scenario state and hooks in feature-965-state.ts.
 */

import { DataTable, Given, Then, When } from '@cucumber/cucumber';
import assert from 'assert';
import { execSync, spawnSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

import { REPO_ROOT } from '../../../adws/core/environment.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import { assertLogHolds, invocationOf } from './feature-965-log.ts';
import { requireWorktree, stateOf, type GitMockRun, type ScenarioState } from './feature-965-state.ts';

const GIT_MOCK_PATH = join(REPO_ROOT, 'test/mocks/git-remote-mock.ts');

/** Resolved before the mock runs, so a delegated subcommand never finds the mock itself on PATH. */
function realGitPath(): string {
  return process.env['REAL_GIT_PATH'] ?? execSync('which git', { encoding: 'utf-8' }).trim();
}

function gitMockEnvironment(logPath: string | undefined): NodeJS.ProcessEnv {
  const { MOCK_GIT_LOG: _outerLog, ...inherited } = process.env;
  return { ...inherited, ...(logPath === undefined ? {} : { MOCK_GIT_LOG: logPath }), REAL_GIT_PATH: realGitPath() };
}

function requireLogPath(state: ScenarioState): string {
  assert.ok(state.gitMockLogPath, 'Expected the git-mock to have been given a MOCK_GIT_LOG first');
  return state.gitMockLogPath;
}

function requireRun(state: ScenarioState): GitMockRun {
  assert.ok(state.gitMockRun, 'Expected the git-mock to have been run first');
  return state.gitMockRun;
}

Given("the git-mock's MOCK_GIT_LOG names a log file that does not exist yet", function (this: RegressionWorld) {
  const directory = mkdtempSync(join(tmpdir(), 'adw-965-git-log-'));
  this.cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  stateOf(this).gitMockLogPath = join(directory, 'git.jsonl');
});

Given('MOCK_GIT_LOG is unset for the git-mock', function (this: RegressionWorld) {
  stateOf(this).gitMockLogPath = undefined;
});

When(
  'the git-mock is run with the arguments {string} in the worktree for adwId {string}',
  function (this: RegressionWorld, argumentsText: string, adwId: string) {
    const state = stateOf(this);
    const result = spawnSync('bun', [GIT_MOCK_PATH, ...argumentsText.split(' ')], {
      cwd: requireWorktree(this, adwId),
      env: gitMockEnvironment(state.gitMockLogPath),
      encoding: 'utf-8',
    });
    assert.ok(!result.error, `Could not run the git-mock: ${result.error?.message}`);
    state.gitMockRun = { status: result.status, stdout: result.stdout ?? '' };
  },
);

Then('the git-mock exits 0', function (this: RegressionWorld) {
  const { status } = requireRun(stateOf(this));
  assert.strictEqual(status, 0, `Expected the git-mock to exit 0, but it exited ${String(status)}`);
});

Then('the git-mock exits 0 and prints {string}', function (this: RegressionWorld, text: string) {
  const { status, stdout } = requireRun(stateOf(this));
  assert.strictEqual(status, 0, `Expected the git-mock to exit 0, but it exited ${String(status)}`);
  assert.strictEqual(stdout.trim(), text, `Expected the git-mock to print "${text}", but it printed "${stdout.trim()}"`);
});

Then(
  'the git-mock log holds exactly one line, recording the subcommand {string}, the arguments {string} and the worktree for adwId {string} as its working directory',
  function (this: RegressionWorld, subcommand: string, argumentsText: string, adwId: string) {
    const expected = invocationOf(subcommand, argumentsText, requireWorktree(this, adwId));
    assertLogHolds(requireLogPath(stateOf(this)), [expected]);
  },
);

Then(
  'the git-mock log holds these lines, in this order, each with the worktree for adwId {string} as its working directory:',
  function (this: RegressionWorld, adwId: string, table: DataTable) {
    const worktreePath = requireWorktree(this, adwId);
    const expected = table.hashes().map(({ subcommand, arguments: argumentsText }) => invocationOf(subcommand, argumentsText, worktreePath));
    assertLogHolds(requireLogPath(stateOf(this)), expected);
  },
);

Then('the git-mock wrote no line to its log', function (this: RegressionWorld) {
  assertLogHolds(requireLogPath(stateOf(this)), []);
});

// G11 puts the origin beside the worktree. `show-ref --verify --quiet` exits 1 for a ref that is absent and 128 for a repository it cannot read.
Then('the origin of the worktree for adwId {string} holds no branch {string}', function (this: RegressionWorld, adwId: string, branch: string) {
  const originPath = join(dirname(requireWorktree(this, adwId)), 'origin.git');
  const result = spawnSync(realGitPath(), ['--git-dir', originPath, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
  assert.strictEqual(result.status, 1, `Expected the origin at ${originPath} to hold no branch "${branch}" (show-ref exits 1), but it exited ${String(result.status)}`);
});
