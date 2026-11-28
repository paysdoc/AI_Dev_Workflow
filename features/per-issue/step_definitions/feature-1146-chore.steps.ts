/**
 * The chore scenario of feature-1146.feature runs adwChore as a process on the implementation issue the cron's decision pass
 * files, in the cli-tool workspace, whose scenarios a stand-in runner runs. The manifest the claude-cli-stub is loaded with is
 * what moves the approved scenario into the Regression Suite, so the step that describes that scenario to the stand-in checks
 * the manifest first. What the run did is read from the forge writes the `gh` shadow recorded, the stand-in's runs and the
 * workflow's state and logs.
 */

import { Given, Then } from '@cucumber/cucumber';
import assert from 'assert';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { basename, join } from 'path';

import { AGENTS_STATE_DIR, LOGS_DIR } from '../../../adws/core/config.ts';
import { bodyLinksIssue } from '../../../adws/forge/issueLinkMarker.ts';
import { buildPromotionImplementationIssue } from '../../../adws/promotion/promotionImplementationIssue.ts';
import type { RecordedRequest } from '../../../test/mocks/types.ts';
import { commitOnDefaultBranch } from '../../regression/support/fixtureTargetRepo.ts';
import { SURFACE_REPO } from '../../regression/support/mockForgeProviders.ts';
import { ensureTargetWorkspace, requireHarness } from '../../regression/support/subprocessHarness.ts';
import { describeScenarios, installStandIn, standInRuns } from '../../regression/step_definitions/feature-1101-standin.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

/** The Promotion Proposal whose approval the seeded implementation issue carries out. */
const APPROVING_PROPOSAL = 114_698;
/** Older than the cron's grace period, as an issue the pipeline picks up is. */
const SEEDED_ISSUE_AGE_MS = 60 * 60_000;
const BUILD_COMMAND = '/implement';
const REGRESSION_TAG = '@regression';
const SCENARIO_AGENT = 'scenario-agent';
const REPO_PATH = `/repos/${SURFACE_REPO.owner}/${SURFACE_REPO.repo}`;

interface ManifestEdit {
  readonly path: string;
  readonly contents: string;
}

interface CreatedPullRequest {
  readonly number?: number;
  readonly body?: string;
}

function perIssueFeature(issue: number, scenarioName: string): string {
  return [`@adw-${issue}`, `Feature: feature-${issue}`, '', `  @adw-${issue} @nominated`, `  Scenario: ${scenarioName}`, '    Given an order', ''].join('\n');
}

function manifestEditsOf(world: RegressionWorld, command: string): readonly ManifestEdit[] {
  const manifestPath = world.harnessEnv['MOCK_MANIFEST_PATH'];
  assert.ok(manifestPath, 'Expected the claude-cli-stub to be loaded with a manifest first');
  const entry = JSON.parse(readFileSync(manifestPath, 'utf-8')).byCommand?.[command];
  assert.ok(entry, `Expected the manifest ${manifestPath} to answer ${command}`);
  return entry.edits ?? [];
}

function tagsAbove(lines: readonly string[], scenarioName: string): string[] {
  const at = lines.indexOf(`Scenario: ${scenarioName}`);
  return at > 0 && lines[at - 1].startsWith('@') ? lines[at - 1].split(/\s+/) : [];
}

/** The stand-in reports only the scenarios described to it: the build moves this one into the Regression Suite, where it passes. */
function describePromotedScenario(world: RegressionWorld, scenarioName: string): void {
  const promoting = manifestEditsOf(world, BUILD_COMMAND).filter((edit) => edit.path.endsWith('.feature') && tagsAbove(edit.contents.split('\n').map((line) => line.trim()), scenarioName).includes(REGRESSION_TAG));
  assert.strictEqual(promoting.length, 1, `Expected the build to move "${scenarioName}" into one feature file tagged ${REGRESSION_TAG}, but it writes it into ${promoting.length}`);
  const harness = requireHarness(world);
  installStandIn(harness);
  describeScenarios(harness, [{ tag: REGRESSION_TAG, scenario: scenarioName, result: { kind: 'passes' } }]);
}

function claimedAdwId(world: RegressionWorld): string {
  const adwIds = [...requireHarness(world).claimedAdwIds];
  assert.strictEqual(adwIds.length, 1, `Expected exactly one workflow to have run, but the claimed adwIds are: ${adwIds.join(', ') || 'none'}`);
  return adwIds[0];
}

/** Every path below `directory` whose last segment is `name`; none when the directory does not exist. */
function pathsNamed(directory: string, name: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { recursive: true, encoding: 'utf-8' }).filter((entry) => basename(entry) === name).map((entry) => join(directory, entry));
}

function requestsTo(world: RegressionWorld, method: string, path: string): RecordedRequest[] {
  return world.getRecordedRequests().filter((request) => request.method === method && request.url === path);
}

function pullRequestFor(world: RegressionWorld, issueNumber: number): number {
  const created = requestsTo(world, 'POST', `${REPO_PATH}/pulls`).map((request) => JSON.parse(request.body) as CreatedPullRequest);
  const numbers = created.filter((pullRequest) => bodyLinksIssue(pullRequest.body, issueNumber)).map((pullRequest) => pullRequest.number);
  assert.ok(numbers.length === 1 && numbers[0] !== undefined, `Expected the run to have opened one pull request for issue ${issueNumber}, but it opened ${numbers.length}`);
  return numbers[0];
}

function labelsRequestedFor(world: RegressionWorld, issueNumber: number): string[] {
  return requestsTo(world, 'POST', `${REPO_PATH}/issues/${issueNumber}/labels`).flatMap((request) => (JSON.parse(request.body) as { labels?: string[] }).labels ?? []);
}

Given(
  "the implementation issue {int} that the cron's decision pass files for the approved scenario {string} of issue {int}, labelled {string} and {string}, exists in the mock issue tracker",
  async function (this: RegressionWorld, issueNumber: number, scenarioName: string, approvedIssue: number, firstLabel: string, secondLabel: string) {
    assert.ok(this.mockContext, 'mockContext must be initialised in a Before hook');
    const featurePath = `features/per-issue/feature-${approvedIssue}.feature`;
    const spec = buildPromotionImplementationIssue({ proposalNumber: APPROVING_PROPOSAL, approved: [{ issueNumber: approvedIssue, scenarioName, featurePath }] });
    assert.deepStrictEqual([...spec.labels], [firstLabel, secondLabel], `Expected the decision pass to label its implementation issue ${firstLabel} and ${secondLabel}, but it labels it ${spec.labels.join(' and ')}`);

    commitOnDefaultBranch(ensureTargetWorkspace(this), featurePath, perIssueFeature(approvedIssue, scenarioName), `Write ${featurePath}`);
    describePromotedScenario(this, scenarioName);

    const anHourAgo = new Date(Date.now() - SEEDED_ISSUE_AGE_MS).toISOString();
    const issue = { number: issueNumber, title: spec.title, body: spec.body, state: 'open', user: { login: 'adw-harness' }, labels: spec.labels.map((name) => ({ name })), created_at: anHourAgo, updated_at: anHourAgo };
    await this.mockContext.setState({ issues: { [String(issueNumber)]: issue } });
    this.seededIssues = new Set([issueNumber]);
    const serverUrl = this.mockContext.serverUrl;
    this.harnessEnv = { ...this.harnessEnv, GH_HOST: serverUrl.replace(/^https?:\/\//, ''), GITHUB_API_URL: serverUrl };
  },
);

Then('the scenario agent was not started', function (this: RegressionWorld) {
  const adwId = claimedAdwId(this);
  const states = pathsNamed(join(AGENTS_STATE_DIR, adwId), SCENARIO_AGENT);
  const outputs = pathsNamed(join(LOGS_DIR, adwId), `${SCENARIO_AGENT}.jsonl`);
  assert.deepStrictEqual(states, [], `Expected the scenario agent never to have been started, but its state is at: ${states.join(', ')}`);
  assert.deepStrictEqual(outputs, [], `Expected the scenario agent to have left no output, but it left: ${outputs.join(', ')}`);
});

Then('the stand-in ran the scenarios of {string}', function (this: RegressionWorld, tag: string) {
  const ranTags = standInRuns(requireHarness(this)).map((run) => run.tag);
  assert.ok(ranTags.includes(tag), `Expected the scenario runner to have run ${tag}, but it ran: ${ranTags.join(', ') || 'nothing'}`);
});

Then('ADW approved the pull request for issue {int}', function (this: RegressionWorld, issueNumber: number) {
  const pullRequest = pullRequestFor(this, issueNumber);
  const approvals = requestsTo(this, 'POST', `${REPO_PATH}/pulls/${pullRequest}/reviews`).filter((request) => (JSON.parse(request.body) as { event?: string }).event === 'APPROVE');
  assert.strictEqual(approvals.length, 1, `Expected ADW to have approved pull request #${pullRequest} of issue ${issueNumber} once, but it approved it ${approvals.length} time(s)`);
});

Then('ADW applied no {string} label to issue {int}', function (this: RegressionWorld, label: string, issueNumber: number) {
  const requested = labelsRequestedFor(this, issueNumber);
  assert.ok(!requested.includes(label), `Expected ADW to apply no ${label} label to issue ${issueNumber}, but it applied: ${requested.join(', ')}`);
});
