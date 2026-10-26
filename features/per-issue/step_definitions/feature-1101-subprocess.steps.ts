/**
 * The scenario of feature-1101.feature that runs the SDLC and merge orchestrators as processes carries `@subprocess` but no
 * `@regression`, so the regression hooks give it neither the mock infrastructure nor the subprocess harness nor a cleanup. The
 * hooks here do what those do, for that scenario alone; the `@regression` scenarios that carry `@adw-1101` get theirs from the
 * regression hooks.
 *
 * The target repository's workspace is configured to run its scenarios through the stand-in of feature-1101-standin.ts. The
 * stand-in fails the issue's scenario on a checkout that holds the workflow's build and a commit landed on the default branch,
 * until the scenario fix agent's fix is in it. The manifest (adw-sdlc-post-merge-retry.json) is what writes the build, the fix and
 * the issue's feature file, so the steps check that it names what they rely on. Git's network commands are no-ops under the
 * harness, so a commit "lands" on the default branch by moving the workspace's `origin/` ref along with it.
 */

import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import assert from 'assert';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { AGENTS_STATE_DIR, LOGS_DIR } from '../../../adws/core/config.ts';
import { OrchestratorId } from '../../../adws/core/index.ts';
import { getMockServerState } from '../../../test/mocks/github-api-server.ts';
import { setupMockInfrastructure, teardownMockInfrastructure } from '../../../test/mocks/test-harness.ts';
import type { RecordedRequest } from '../../../test/mocks/types.ts';
import { runCleanup } from '../../regression/support/cleanup.ts';
import { commitOnDefaultBranch, DEFAULT_BRANCH } from '../../regression/support/fixtureTargetRepo.ts';
import { realGit } from '../../regression/support/fixtureWorktree.ts';
import { createSubprocessHarness, ensureTargetWorkspace, requireHarness } from '../../regression/support/subprocessHarness.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import { FEATURE_FILE, featureFile, stepDefinitionFiles } from './feature-1101-content.ts';
import {
  describeScenarios,
  fixPathFor,
  installStandIn,
  recordLandedCommit,
  runByTagCommand,
  slugOf,
  standInRequirements,
  standInRuns,
  type ScenarioRow,
} from './feature-1101-standin.ts';

const OWN_SUBPROCESS_SCENARIO = '@adw-1101 and @subprocess and not @regression';

/** What the manifest's build agent writes: the workflow's own work, which the failing scenario needs to see. */
const BUILD_FILE = 'src/orders.ts';
const REGRESSION_SCENARIO = 'Orders are accepted';
const COMMANDS_FILE = '.adw/commands.md';
const SCENARIOS_FILE = '.adw/scenarios.md';
const RUN_BY_TAG_BLOCK = /(## Run Scenarios by Tag\n\n```sh\n)[\s\S]*?(\n```)/;
const HUMAN = 'a-human';
/** One line of the orchestrator's execution log for each failed tag that the scenario fix phase hands to the fix agent. */
const FIX_STARTED = 'Resolving failed scenario:';
const FIX_AGENT_OUTPUT = /^resolve-e2e-.*\.jsonl$/;

Before({ tags: OWN_SUBPROCESS_SCENARIO }, async function (this: RegressionWorld) {
  this.mockContext = await setupMockInfrastructure();
});

// Declared after the hook above, which sets up the mock server, so the order is guaranteed by this file.
Before({ tags: OWN_SUBPROCESS_SCENARIO }, function (this: RegressionWorld) {
  this.subprocess = createSubprocessHarness(this);
});

After({ tags: OWN_SUBPROCESS_SCENARIO }, async function (this: RegressionWorld) {
  await runCleanup(this);
  await teardownMockInfrastructure();
  this.mockContext = null;
  this.subprocess = null;
  this.lastExitCode = -1;
  this.lastOutput = '';
  this.seededIssues = new Set();
  this.worktreePaths.clear();
  this.harnessEnv = {};
  this.cleanup = [];
});

function withRunByTag(markdown: string, command: string, file: string): string {
  assert.ok(RUN_BY_TAG_BLOCK.test(markdown), `Expected "${file}" of the fixture to hold a fenced "## Run Scenarios by Tag" block`);
  return markdown.replace(RUN_BY_TAG_BLOCK, (_block, head: string, tail: string) => `${head}${command}${tail}`);
}

function workspaceOf(world: RegressionWorld): string {
  const { workspacePath } = requireHarness(world);
  assert.ok(workspacePath, "Expected the target repository's workspace to exist: a step that configures it comes first");
  return workspacePath;
}

function seededIssue(world: RegressionWorld): number {
  const issues = [...world.seededIssues];
  assert.strictEqual(issues.length, 1, `Expected the scenario to seed exactly one issue, but it seeded: ${issues.join(', ') || 'none'}`);
  return issues[0];
}

function claimedAdwId(world: RegressionWorld): string {
  const adwIds = [...requireHarness(world).claimedAdwIds];
  assert.strictEqual(adwIds.length, 1, `Expected exactly one workflow to have run, but the claimed adwIds are: ${adwIds.join(', ') || 'none'}`);
  return adwIds[0];
}

/** The manifest writes the build, the fix and the issue's feature file, so a step that relies on a name checks that the manifest uses it. */
function assertManifestNames(world: RegressionWorld, names: readonly string[]): void {
  const manifestPath = world.harnessEnv['MOCK_MANIFEST_PATH'];
  assert.ok(manifestPath, 'Expected the claude-cli-stub to be loaded with a manifest first');
  const manifest = readFileSync(manifestPath, 'utf-8');
  const missing = names.filter((name) => !manifest.includes(name));
  assert.deepStrictEqual(missing, [], `Expected the manifest ${manifestPath} to name ${missing.join(', ')}`);
}

function commitInWorkspaceHolds(workspace: string, commit: string, path: string): boolean {
  try {
    realGit(workspace, 'cat-file', '-e', `${commit}:${path}`);
    return true;
  } catch {
    return false;
  }
}

function commitIsAncestor(workspace: string, ancestor: string, descendant: string): boolean {
  try {
    realGit(workspace, 'merge-base', '--is-ancestor', ancestor, descendant);
    return true;
  } catch {
    return false;
  }
}

/** The commit on the default branch with this subject, which the step that landed it made. */
function commitLanded(workspace: string, subject: string): string {
  const landed = realGit(workspace, 'log', '--format=%H %s', DEFAULT_BRANCH)
    .split('\n')
    .filter((line) => line.slice(line.indexOf(' ') + 1) === subject);
  assert.strictEqual(landed.length, 1, `Expected exactly one commit "${subject}" on "${DEFAULT_BRANCH}", but found ${landed.length}`);
  return landed[0].slice(0, landed[0].indexOf(' '));
}

Given("the target repository's workspace runs its scenarios by tag with a stand-in that records each run", function (this: RegressionWorld) {
  const harness = requireHarness(this);
  const workspace = ensureTargetWorkspace(this);
  installStandIn(harness);

  const runByTag = runByTagCommand(harness);
  for (const file of [COMMANDS_FILE, SCENARIOS_FILE]) {
    const configured = withRunByTag(readFileSync(join(workspace, file), 'utf-8'), runByTag, file);
    commitOnDefaultBranch(workspace, file, configured, `Run the scenarios by tag with the stand-in (${file})`);
  }
  for (const [path, contents] of Object.entries(stepDefinitionFiles())) commitOnDefaultBranch(workspace, path, contents, `Add ${path}`);
});

Given(
  "the stand-in fails the scenario {string} with the error {string} on any checkout that holds both the workflow's build and the commit {string} from {string}, until the scenario fix agent's fix is in it",
  function (this: RegressionWorld, scenario: string, error: string, subject: string, baseBranch: string) {
    assert.strictEqual(baseBranch, DEFAULT_BRANCH, `Only commits landed on "${DEFAULT_BRANCH}" are known to the stand-in, but the step names "${baseBranch}"`);
    assert.ok(subject.length > 0, 'Expected the step to name the commit');
    const issueTag = `@adw-${seededIssue(this)}`;
    assertManifestNames(this, [BUILD_FILE, fixPathFor(scenario), scenario, issueTag]);

    const regression: ScenarioRow = { tag: '@regression', scenario: REGRESSION_SCENARIO, result: { kind: 'passes' } };
    const issueScenario: ScenarioRow = { tag: issueTag, scenario, result: { kind: 'fails', error } };
    describeScenarios(requireHarness(this), [regression, issueScenario], { requires: [BUILD_FILE] });
    commitOnDefaultBranch(workspaceOf(this), FEATURE_FILE, featureFile([regression]), 'Add the regression scenario');
  },
);

When("the commit {string} lands on {string} in the target repository's workspace", function (this: RegressionWorld, subject: string, baseBranch: string) {
  assert.strictEqual(baseBranch, DEFAULT_BRANCH, `Commits land on "${DEFAULT_BRANCH}" in the workspace, but the step names "${baseBranch}"`);
  const workspace = workspaceOf(this);
  commitOnDefaultBranch(workspace, `docs/${slugOf(subject)}.md`, `${subject}\n`, subject);
  recordLandedCommit(requireHarness(this), realGit(workspace, 'rev-parse', DEFAULT_BRANCH));
});

When('a human comments {string} on issue {int} in the mock issue tracker', async function (this: RegressionWorld, body: string, issueNumber: number) {
  assert.ok(this.mockContext, 'mockContext must be initialised in a Before hook');
  const comments = getMockServerState().comments;
  const key = String(issueNumber);
  const now = new Date().toISOString();
  const comment = { id: Date.now(), body, user: { login: HUMAN, type: 'User' }, created_at: now, updated_at: now };
  await this.mockContext.setState({ comments: { ...comments, [key]: [...(comments[key] ?? []), comment] } });
});

function pullRequestCreations(requests: readonly RecordedRequest[], issueNumber: number): RecordedRequest[] {
  return requests.filter((request) => request.method === 'POST' && request.url.includes('/pulls') && request.body.includes(String(issueNumber)));
}

Then('the mock GitHub API recorded exactly {int} PR creation for issue {int}', function (this: RegressionWorld, expected: number, issueNumber: number) {
  const created = pullRequestCreations(this.getRecordedRequests(), issueNumber).length;
  assert.strictEqual(created, expected, `Expected exactly ${expected} PR creation(s) for issue ${issueNumber}, but recorded ${created}`);
});

function logLinesAbout(adwId: string, text: string): string[] {
  const log = join(AGENTS_STATE_DIR, adwId, OrchestratorId.Sdlc, 'execution.log');
  return existsSync(log) ? readFileSync(log, 'utf-8').split('\n').filter((line) => line.includes(text)) : [];
}

function fixAgentOutputs(adwId: string): string[] {
  const logsDir = join(LOGS_DIR, adwId);
  return existsSync(logsDir) ? readdirSync(logsDir).filter((name) => FIX_AGENT_OUTPUT.test(name)) : [];
}

/** The orchestrator logs one line before it starts the fix agent for a failed tag, and the agent leaves one output file per tag. */
Then('the scenario fix agent was started once', function (this: RegressionWorld) {
  const adwId = claimedAdwId(this);
  const started = logLinesAbout(adwId, FIX_STARTED);
  const outputs = fixAgentOutputs(adwId);
  assert.strictEqual(started.length, 1, `Expected the scenario fix phase to start the fix agent once, but the orchestrator's log has ${started.length} "${FIX_STARTED}" line(s):\n${started.join('\n')}`);
  assert.strictEqual(outputs.length, 1, `Expected the fix agent to leave one output file, but ${LOGS_DIR}/${adwId} holds: ${outputs.join(', ') || 'none'}`);
});

Then(
  "the stand-in last ran the scenarios on a checkout that holds the workflow's build, the commit {string} from {string} and the scenario fix agent's fix",
  function (this: RegressionWorld, subject: string, baseBranch: string) {
    assert.strictEqual(baseBranch, DEFAULT_BRANCH, `Commits land on "${DEFAULT_BRANCH}" in the workspace, but the step names "${baseBranch}"`);
    const harness = requireHarness(this);
    const workspace = workspaceOf(this);
    const runs = standInRuns(harness);
    assert.ok(runs.length > 0, 'Expected the scenario runner to have run');

    const landed = commitLanded(workspace, subject);
    const { requires, fixes } = standInRequirements(harness);
    assert.ok(requires.length > 0 && fixes.length > 0, 'Expected the stand-in to have been told what the build and the fix are');
    const lastOfEachTag = [...new Set(runs.map((run) => run.tag))].map((tag) => runs.filter((run) => run.tag === tag).pop() ?? runs[0]);
    for (const { tag, commit } of lastOfEachTag) {
      const missing = [...requires, ...fixes].filter((path) => !commitInWorkspaceHolds(workspace, commit, path));
      assert.deepStrictEqual(missing, [], `Expected the last run of ${tag} (on ${commit}) to be on a checkout that holds ${missing.join(', ')}`);
      assert.ok(commitIsAncestor(workspace, landed, commit), `Expected the last run of ${tag} (on ${commit}) to be on a checkout that holds the commit "${subject}" (${landed})`);
    }
  },
);
