/**
 * Runs the real cron the way the cron probe does, for one tick, but with the passes a step names due on that tick, and reads
 * what it did: the forge writes the `gh` shadow recorded, and the merged pull requests the shadow landed on the target
 * repository's default branch. The shadow lands a merge only when `ADW_GH_LAND_PATH` names the workspace, as GitHub's merge
 * reaches the remote; without it, nothing the sweep removed would ever leave `origin/main`.
 */

import assert from 'assert';
import { existsSync, readdirSync } from 'fs';

import { AgentStateManager } from '../../../adws/core/agentState.ts';
import { AGENTS_STATE_DIR } from '../../../adws/core/config.ts';
import { getMockServerState } from '../../../test/mocks/github-api-server.ts';
import type { RecordedRequest } from '../../../test/mocks/types.ts';
import { DEFAULT_BRANCH, targetCloneUrl } from '../../regression/support/fixtureTargetRepo.ts';
import { realGit } from '../../regression/support/fixtureWorktree.ts';
import { isOrchestratorLaunch, realScriptPath } from '../../regression/support/harnessOrchestrators.ts';
import { settleLaunches, waitForLaunch, type LaunchRecorder } from '../../regression/support/launchRecorder.ts';
import { SURFACE_REPO } from '../../regression/support/mockForgeProviders.ts';
import { ensureTargetWorkspace, requireHarness } from '../../regression/support/subprocessHarness.ts';
import { findRealBunx, runThroughHarness } from '../../regression/support/subprocessRun.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

const CRON_TIMEOUT_MS = 150_000;
/** How long the cron may take, after it has polled, to launch the orchestrator for a candidate it found. */
const DISPATCH_WAIT_MS = 20_000;
const DAY_MS = 86_400_000;
/** Keeps the seeded pull request's number clear of the issue numbers the scenarios name. */
const PULL_REQUEST_OFFSET = 1_000_000;
const OUTPUT_TAIL_LINES = 40;
const POLL_LINE = /POLL: [^\n]*\n/;
const POLL_CANDIDATES = /POLL: \d+ open, (\d+) candidate\(s\)/;
const TICK_FAILED = 'checkAndTrigger: tick failed';
const SWEEP_BRANCH = 'chore/scenario-sweep';
const FILED_ISSUE = /filed removal issue #(\d+)/g;
const REPO_PATH = `/repos/${SURFACE_REPO.owner}/${SURFACE_REPO.repo}`;
/** A host `.env` that lowers one of these would let the tick run its pass against the checkout, so each is out of reach unless a run makes it due. */
const CADENCES = [
  'PROBE_INTERVAL_CYCLES',
  'JANITOR_INTERVAL_CYCLES',
  'HUNG_DETECTOR_INTERVAL_CYCLES',
  'DOCS_INDEX_SWEEP_INTERVAL_CYCLES',
  'PER_ISSUE_SCENARIO_SWEEP_INTERVAL_CYCLES',
  'PROMOTION_PROPOSAL_INTERVAL_CYCLES',
  'PROMOTION_DECISION_INTERVAL_CYCLES',
] as const;
const DUE_ON_FIRST_TICK = '1';
const OUT_OF_REACH = '1000000';

export type CronCadence = (typeof CADENCES)[number];

const cronOutputs = new WeakMap<RegressionWorld, string[]>();

export interface FiledIssue {
  readonly title: string;
  readonly body: string;
  readonly filedAt: string;
}

export function outputTail(output: string): string {
  return output.trim().split('\n').slice(-OUTPUT_TAIL_LINES).join('\n');
}

/** `scanAuthQueue` rewrites every `paused_auth` workflow in the checkout, whatever its repository, and the cron would resume it. */
function assertNoPausedAuthWorkflows(): void {
  const entries = existsSync(AGENTS_STATE_DIR) ? readdirSync(AGENTS_STATE_DIR, { withFileTypes: true }) : [];
  const adwIds = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const paused = adwIds.filter((adwId) => AgentStateManager.readTopLevelState(adwId)?.workflowStage === 'paused_auth');
  assert.deepStrictEqual(paused, [], `The cron was not run: the checkout holds workflows paused for authentication (${paused.join(', ')}), which the cron would rewrite and resume`);
}

async function settleAfterPoll(recorder: LaunchRecorder, output: string): Promise<void> {
  const candidates = Number(POLL_CANDIDATES.exec(output)?.[1] ?? 0);
  if (candidates > 0) await waitForLaunch(recorder, isOrchestratorLaunch, DISPATCH_WAIT_MS);
  await settleLaunches(recorder);
}

function cadenceEnv(due: readonly CronCadence[]): Record<string, string> {
  return Object.fromEntries(CADENCES.map((cadence) => [cadence, due.includes(cadence) ? DUE_ON_FIRST_TICK : OUT_OF_REACH]));
}

/** The output of every cron run of the scenario, in the order they ran. */
export function cronOutputsOf(world: RegressionWorld): string[] {
  const outputs = cronOutputs.get(world) ?? [];
  cronOutputs.set(world, outputs);
  return outputs;
}

export function runCronWithSweepDue(world: RegressionWorld): Promise<string> {
  return runCronWithDue(world, ['PER_ISSUE_SCENARIO_SWEEP_INTERVAL_CYCLES']);
}

/** The passes run inside the cron's first tick, before its poll, so the run is stopped at the poll as the cron probe's is. */
export async function runCronWithDue(world: RegressionWorld, due: readonly CronCadence[]): Promise<string> {
  const { recorder } = requireHarness(world);
  assert.ok(world.mockContext, 'mockContext must be initialised in a Before hook');
  assertNoPausedAuthWorkflows();
  const workspace = ensureTargetWorkspace(world);
  const server = world.mockContext.serverUrl;

  const { output } = await runThroughHarness(
    world,
    {
      command: findRealBunx(),
      args: ['tsx', realScriptPath('adws/triggers/trigger_cron.ts'), '--target-repo', `${SURFACE_REPO.owner}/${SURFACE_REPO.repo}`, '--clone-url', targetCloneUrl(SURFACE_REPO.owner, SURFACE_REPO.repo)],
      timeoutMs: CRON_TIMEOUT_MS,
      label: 'The cron',
      env: { ...cadenceEnv(due), ADW_GH_LAND_PATH: workspace, GH_HOST: server.replace(/^https?:\/\//, ''), GITHUB_API_URL: server },
      stopWhen: (text) => POLL_LINE.test(text) || text.includes(TICK_FAILED),
      beforeStop: (text) => settleAfterPoll(recorder, text),
    },
    { recordsExitCode: false },
  );
  assert.ok(POLL_LINE.test(output), `The cron's first tick failed before it polled. Last output:\n${outputTail(output)}`);
  cronOutputsOf(world).push(output);
  return output;
}

/** The cron would otherwise poll, and launch an orchestrator for, the issues the mock server starts with. */
export async function emptyIssueQueue(world: RegressionWorld): Promise<void> {
  assert.ok(world.mockContext, 'mockContext must be initialised in a Before hook');
  await world.mockContext.setState({ issues: {} });
}

export async function seedMergedPullRequest(world: RegressionWorld, issue: number, daysAgo: number): Promise<void> {
  assert.ok(world.mockContext, 'mockContext must be initialised in a Before hook');
  const number = PULL_REQUEST_OFFSET + issue;
  const mergedAt = new Date(Date.now() - daysAgo * DAY_MS).toISOString();
  const pullRequest = { number, title: `Implement issue ${issue}`, body: `Implements #${issue}\n\nCloses #${issue}`, state: 'MERGED', mergedAt, headRefName: `feature-issue-${issue}`, baseRefName: DEFAULT_BRANCH };
  await world.mockContext.setState({ prs: { ...getMockServerState().prs, [String(number)]: pullRequest } });
}

function requestsTo(world: RegressionWorld, method: string, path: string): RecordedRequest[] {
  return world.getRecordedRequests().filter((request) => request.method === method && request.url === path);
}

export function filedIssues(world: RegressionWorld): FiledIssue[] {
  return requestsTo(world, 'POST', `${REPO_PATH}/issues`).map((request) => {
    const { title, body } = JSON.parse(request.body) as { title: string; body: string };
    return { title, body, filedAt: request.timestamp };
  });
}

export function labelsOf(world: RegressionWorld, issueNumber: number): string[] {
  return requestsTo(world, 'POST', `${REPO_PATH}/issues/${issueNumber}/labels`).flatMap((request) => (JSON.parse(request.body) as { labels?: string[] }).labels ?? []);
}

/** The shadow numbers an issue as it files it; the mock it is replayed against does not, so the number is read from the cron's line. */
export function filedIssueNumber(outputs: readonly string[]): number {
  const numbers = outputs.flatMap((output) => [...output.matchAll(FILED_ISSUE)].map((match) => Number(match[1])));
  assert.strictEqual(numbers.length, 1, `Expected the cron to have logged filing exactly one removal issue, but it logged ${numbers.length}: ${numbers.join(', ')}`);
  return numbers[0];
}

/**
 * The mock records an issue the shadow filed, but keeps no issue it did not create itself, so the next run's forge would
 * not hold it. It is put into the mock as the forge holds it: open, with the labels it was given.
 */
export async function keepIssueOpen(world: RegressionWorld, issueNumber: number, filed: FiledIssue): Promise<void> {
  assert.ok(world.mockContext, 'mockContext must be initialised in a Before hook');
  const labels = labelsOf(world, issueNumber).map((name) => ({ name }));
  const issue = { number: issueNumber, title: filed.title, body: filed.body, state: 'OPEN', labels, createdAt: filed.filedAt, updatedAt: filed.filedAt };
  await world.mockContext.setState({ issues: { ...getMockServerState().issues, [String(issueNumber)]: issue } });
}

export function mergedSweepPullRequests(world: RegressionWorld): number[] {
  const created = requestsTo(world, 'POST', `${REPO_PATH}/pulls`).map((request) => JSON.parse(request.body) as { head?: string; number?: number });
  const numbers = created.filter((body) => body.head === SWEEP_BRANCH).map((body) => body.number);
  return numbers.filter((number): number is number => number !== undefined && requestsTo(world, 'PUT', `${REPO_PATH}/pulls/${number}/merge`).length > 0);
}

export function isOnDefaultBranch(world: RegressionWorld, path: string): boolean {
  return realGit(ensureTargetWorkspace(world), 'ls-tree', '--name-only', DEFAULT_BRANCH, '--', path) !== '';
}

export function subjectOfCommitDeleting(world: RegressionWorld, path: string): string {
  return realGit(ensureTargetWorkspace(world), 'log', '-1', '--format=%s', '--diff-filter=D', DEFAULT_BRANCH, '--', path);
}

export function remoteFollowsDefaultBranch(world: RegressionWorld): boolean {
  const workspace = ensureTargetWorkspace(world);
  return realGit(workspace, 'rev-parse', DEFAULT_BRANCH) === realGit(workspace, 'rev-parse', `origin/${DEFAULT_BRANCH}`);
}
