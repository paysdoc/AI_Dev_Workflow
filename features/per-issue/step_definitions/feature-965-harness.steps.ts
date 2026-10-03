/**
 * Step definitions for the scenarios of feature-965.feature that set the mock infrastructure up
 * themselves: the log it provides per setup (§3) and the Actions-secret route of its GitHub API
 * (§5). They run outside the @regression hooks, so the state and hooks of feature-965-state.ts
 * tear the infrastructure down after each scenario.
 */

import { Given, Then, When } from '@cucumber/cucumber';
import assert from 'assert';
import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { sep } from 'path';

import { getMockServerState } from '../../../test/mocks/github-api-server.ts';
import { setupMockInfrastructure, teardownMockInfrastructure } from '../../../test/mocks/test-harness.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import { assertLogHolds, invocationOf } from './feature-965-log.ts';
import { requireMockContext, requireWorktree, setOrUnsetGitLog, stateOf } from './feature-965-state.ts';

Given('MOCK_GIT_LOG is unset before the mock infrastructure is set up', function () {
  setOrUnsetGitLog(undefined);
});

Given('MOCK_GIT_LOG is set to {string} before the mock infrastructure is set up', function (value: string) {
  setOrUnsetGitLog(value);
});

Given('the mock infrastructure is set up', async function (this: RegressionWorld) {
  this.mockContext = await setupMockInfrastructure();
  const state = stateOf(this);
  state.mockInfrastructureUp = true;
  state.exposedGitLogPath = this.mockContext.gitLogPath;
});

When('the mock infrastructure is torn down', async function (this: RegressionWorld) {
  await teardownMockInfrastructure();
  this.mockContext = null;
  stateOf(this).mockInfrastructureUp = false;
});

// `git` resolves through PATH, as it does for a phase's git: to the git-mock under the mock infrastructure and the @regression hooks.
When('git is run with the arguments {string} in the worktree for adwId {string}', function (this: RegressionWorld, argumentsText: string, adwId: string) {
  execFileSync('git', argumentsText.split(' '), { cwd: requireWorktree(this, adwId), env: process.env, stdio: 'pipe' });
});

Then("MOCK_GIT_LOG names the mock context's gitLogPath, which lies under the system's temporary directory", function (this: RegressionWorld) {
  const { gitLogPath } = requireMockContext(this);
  assert.strictEqual(process.env['MOCK_GIT_LOG'], gitLogPath, `Expected MOCK_GIT_LOG to name the context's gitLogPath ${gitLogPath}, but it is ${String(process.env['MOCK_GIT_LOG'])}`);
  assert.ok(gitLogPath.startsWith(tmpdir() + sep), `Expected the gitLogPath ${gitLogPath} to lie under the system's temporary directory ${tmpdir()}`);
  const checkout = process.cwd();
  assert.ok(gitLogPath !== checkout && !gitLogPath.startsWith(checkout + sep), `Expected the gitLogPath ${gitLogPath} to lie outside the checkout ${checkout}`);
});

Then(
  "the log at the mock context's gitLogPath holds exactly one line, recording the subcommand {string}, the arguments {string} and the worktree for adwId {string} as its working directory",
  function (this: RegressionWorld, subcommand: string, argumentsText: string, adwId: string) {
    const expected = invocationOf(subcommand, argumentsText, requireWorktree(this, adwId));
    assertLogHolds(requireMockContext(this).gitLogPath, [expected]);
  },
);

Then("the log at the mock context's gitLogPath holds no line", function (this: RegressionWorld) {
  assertLogHolds(requireMockContext(this).gitLogPath, []);
});

Then('no file is left at the gitLogPath the mock context exposed', function (this: RegressionWorld) {
  const { exposedGitLogPath } = stateOf(this);
  assert.ok(exposedGitLogPath, 'Expected the mock infrastructure to have been set up first');
  assert.ok(!existsSync(exposedGitLogPath), `Expected no file at ${exposedGitLogPath}, but it is still there`);
});

Then('MOCK_GIT_LOG is unset again', function () {
  assert.strictEqual(process.env['MOCK_GIT_LOG'], undefined, `Expected MOCK_GIT_LOG to be unset, but it is "${String(process.env['MOCK_GIT_LOG'])}"`);
});

Then('MOCK_GIT_LOG is set to {string} again', function (value: string) {
  assert.strictEqual(process.env['MOCK_GIT_LOG'], value, `Expected MOCK_GIT_LOG to be "${value}", but it is ${String(process.env['MOCK_GIT_LOG'])}`);
});

async function putSecret(url: string): Promise<number> {
  const response = await fetch(url, { method: 'PUT', body: JSON.stringify({ encrypted_value: 'surface-secret' }) });
  await response.text();
  return response.status;
}

// The path `gh secret set` takes, sent over HTTP so the listener is exercised as well as the route.
When(
  'a PUT of the Actions secret {string} on the repository {string} is sent to the mock GitHub API twice',
  async function (this: RegressionWorld, secretName: string, repoFullName: string) {
    const url = `${requireMockContext(this).serverUrl}/repos/${repoFullName}/actions/secrets/${secretName}`;
    const first = await putSecret(url);
    const second = await putSecret(url);
    stateOf(this).secretStatuses = [first, second];
  },
);

Then('the mock GitHub API answered the first PUT 201 and the second 204', function (this: RegressionWorld) {
  const { secretStatuses } = stateOf(this);
  assert.deepStrictEqual(secretStatuses, [201, 204], `Expected the mock GitHub API to answer the first PUT 201 and the second 204, but it answered: ${secretStatuses.join(', ') || 'nothing'}`);
});

Then("the mock GitHub API's state holds the Actions secret {string}", function (secretName: string) {
  const stored = getMockServerState().secrets[secretName];
  assert.ok(typeof stored === 'object' && stored !== null, `Expected the state to hold the Actions secret "${secretName}", but it holds: ${Object.keys(getMockServerState().secrets).join(', ') || 'none'}`);
  const metadata: Record<string, unknown> = { ...stored };
  assert.deepStrictEqual(Object.keys(metadata).sort(), ['created_at', 'name', 'updated_at'], `Expected the secret to be kept as its name and timestamps alone, never its value, but it holds: ${JSON.stringify(metadata)}`);
  assert.strictEqual(metadata['name'], secretName);
});
