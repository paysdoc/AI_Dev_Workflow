/**
 * Runs a feature-990 workflow as a real orchestrator process through the regression suite's subprocess harness: the
 * `gh` shadow answers the forge, the git mock turns fetch and push into no-ops, and the Claude CLI stub answers each
 * agent from the scenario's manifest, behind a wrapper that records every start. A second run is a new process with the
 * same adwId, as the takeover makes it. What the process posted is then handed to the recording tracker of feature-796,
 * which the steps shared with feature-989 read, and the workflow of feature-988's world is pointed at its adwId.
 */

import assert from 'assert';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

import { AgentStateManager } from '../../../adws/core/agentState.ts';
import type { WorkflowConfig } from '../../../adws/phases/workflowInit.ts';
import { buildContinueHandlerDeps, handleContinueDirective, type ContinueHandlerDeps } from '../../../adws/triggers/continueHandler.ts';
import { handleRetryDirective, type RetryHandlerDeps } from '../../../adws/triggers/retryHandler.ts';
import { dispatchMockRequest, getMockServerState } from '../../../test/mocks/github-api-server.ts';
import type { MockContext } from '../../../test/mocks/types.ts';
import { STUB_MANIFEST_MARKER } from '../../../test/mocks/stubMarker.ts';
import { harnessNameForStem, orchestratorArgv } from '../../regression/support/harnessOrchestrators.ts';
import { SURFACE_REPO } from '../../regression/support/mockForgeProviders.ts';
import { claimAdwId, claimIssue, requireHarness } from '../../regression/support/subprocessHarness.ts';
import { findRealBunx, runThroughHarness } from '../../regression/support/subprocessRun.ts';

import { world796 } from '../../regression/step_definitions/feature-796.steps.ts';
import { commentsOn } from './feature-929-workflow.ts';
import { s as state988 } from './feature-988-world.ts';
import { buildManifest } from './feature-990-manifest.ts';
import { ensurePullRequestBranch, PR_REVIEW_ORCHESTRATOR, seedPullRequestReview } from './feature-990-pr-review.ts';
import { writeScripts } from './feature-990-scripts.ts';
import { buildTarget } from './feature-990-target.ts';
import { webRunEnvironment } from './feature-990-web.ts';
import { BASE_BRANCH, requireScratch, requireWorkflowSetup, requireWorld, s, type RunRecord } from './feature-990-world.ts';
import { CLAUDE_CLI_STUB } from '../../regression/support/claudeCliStub.ts';

/**
 * A start that fails waits out the dev-server lifecycle's three 20 s probes, and a workflow that never gets its server
 * to start makes three starts: nine probes, three minutes, before it has done anything else. That outlasts the harness's
 * two-minute default.
 */
export const RUN_TIMEOUT_MS = 330_000;
export const STEP_TIMEOUT_MS = 340_000;

const ISSUE_AGE_MS = 60 * 60_000;

export async function describeWorkflow(orchestrator: string, issue: number, adwId = `throwaway${issue}-bdd990`): Promise<void> {
  const world = requireWorld();
  claimAdwId(world, adwId);
  claimIssue(world, issue);
  s.workflow = { orchestrator, harnessName: harnessNameForStem(orchestrator), issue, adwId };
  state988.workflow = { config: { adwId, issueNumber: issue } as unknown as WorkflowConfig, issueNumber: issue, adwId, worktreePath: '', logsDir: '' };
  await seedIssue(issue);
  if (orchestrator === PR_REVIEW_ORCHESTRATOR) await seedPullRequestReview(requireMock(), issue, adwId);
}

function requireMock(): MockContext {
  const { mockContext } = requireWorld();
  assert.ok(mockContext, 'Expected the mock infrastructure to have been set up by the @adw-990 Before hook');
  return mockContext;
}

async function seedIssue(issue: number): Promise<void> {
  const mockContext = requireMock();
  const aWhileAgo = new Date(Date.now() - ISSUE_AGE_MS).toISOString();
  await mockContext.setState({
    issues: {
      [String(issue)]: {
        number: issue,
        title: `Check the base branch before any work (${issue})`,
        state: 'open',
        body: 'A workflow checks the base branch before it does any work on an issue.',
        user: { login: 'test-user' },
        labels: [{ name: 'adw:feature' }],
        created_at: aWhileAgo,
        updated_at: aWhileAgo,
      },
    },
  });
  const world = requireWorld();
  world.harnessEnv = { ...world.harnessEnv, GH_HOST: mockContext.serverUrl.replace(/^https?:\/\//, ''), GITHUB_API_URL: mockContext.serverUrl };
}

/** What the process posted since the last run, handed to the tracker that `commentsOn` reads. */
function handPostedCommentsToTracker(issue: number): void {
  const posted = getMockServerState().comments[String(issue)] ?? [];
  const alreadyHanded = s.syncedComments.get(issue) ?? 0;
  posted.slice(alreadyHanded).forEach((comment) => {
    const body = (comment as { body?: unknown }).body;
    world796().activeCallLog.push({ operation: 'commentOnIssue', args: [issue, typeof body === 'string' ? body : ''] });
  });
  s.syncedComments.set(issue, posted.length);
}

export async function runWorkflow(): Promise<RunRecord> {
  const workflow = requireWorkflowSetup();
  const world = requireWorld();
  const scratch = requireScratch();

  const workspace = buildTarget();
  if (workflow.orchestrator === PR_REVIEW_ORCHESTRATOR) ensurePullRequestBranch(workspace, workflow.issue);
  writeScripts(scratch, { stubPath: CLAUDE_CLI_STUB, requiresServer: s.requiresServer, scenarios: s.scenarios, buildFailure: s.buildFailure });
  const { manifest, payloads } = buildManifest(workflow.issue, workflow.adwId, scratch.answersDir);
  payloads.forEach((contents, file) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, contents);
  });
  writeFileSync(join(requireHarness(world).targetReposDir, STUB_MANIFEST_MARKER), JSON.stringify(manifest));

  const startedAt = Date.now();
  const result = await runThroughHarness(
    world,
    {
      command: findRealBunx(),
      args: ['tsx', ...orchestratorArgv(workflow.harnessName, workflow.adwId, workflow.issue, SURFACE_REPO)],
      timeoutMs: RUN_TIMEOUT_MS,
      label: `The "${workflow.orchestrator}" orchestrator`,
      env: { CLAUDE_CODE_PATH: scratch.recorderScript, ...webRunEnvironment(workflow.issue) },
    },
    { recordsExitCode: true, defaultBranch: BASE_BRANCH },
  );
  const record: RunRecord = { exitCode: result.exitCode, output: result.output, startedAt, endedAt: Date.now() };
  s.runs.push(record);
  handPostedCommentsToTracker(workflow.issue);
  return record;
}

export function lastRun(): RunRecord {
  const run = s.runs[s.runs.length - 1];
  assert.ok(run, 'Expected the workflow to have run first');
  return run;
}

/** Posts the owner's comment on the issue, as the forge would hold it, without handing it to the tracker as one of ADW's. */
function postOwnerComment(issue: number, body: string): void {
  const response = dispatchMockRequest('POST', `/repos/${SURFACE_REPO.owner}/${SURFACE_REPO.repo}/issues/${issue}/comments`, JSON.stringify({ body }));
  assert.ok(response.status < 400, `Expected the mock forge to take the comment on issue ${issue}, but it answered ${response.status}`);
  s.syncedComments.set(issue, (s.syncedComments.get(issue) ?? 0) + 1);
}

/** Recording dependencies of a `## Retry`: state is the real top-level state, and nothing else a retry could touch is real. */
function retryDeps(): RetryHandlerDeps {
  return {
    readTopLevelState: adwId => AgentStateManager.readTopLevelState(adwId),
    writeTopLevelState: (adwId, state) => AgentStateManager.writeTopLevelState(adwId, state),
    findPauseQueueEntry: () => null,
    removeFromPauseQueue: () => undefined,
    acquireIssueSpawnLock: () => true,
    releaseIssueSpawnLock: () => undefined,
    spawnDetached: () => assert.fail('A "## Retry" on a parked workflow spawns nothing: the orchestrator resumes through the re-armed stage'),
    postStageComment: () => undefined,
    targetRepoArgs: [],
  };
}

export const RETRY_DIRECTIVE = '## Retry';
export const CONTINUE_DIRECTIVE = '## Continue';

export function ownerComments(directive: string, issue: number): void {
  const comments = [...commentsOn(issue), directive].map(body => ({ body }));
  postOwnerComment(issue, directive);

  if (directive === RETRY_DIRECTIVE) {
    assert.ok(handleRetryDirective(issue, comments, retryDeps()), `Expected "${directive}" to act on the parked workflow of issue ${issue}`);
    return;
  }
  assert.strictEqual(directive, CONTINUE_DIRECTIVE, `The directives this feature posts are "${RETRY_DIRECTIVE}" and "${CONTINUE_DIRECTIVE}"`);
  const deps: ContinueHandlerDeps = buildContinueHandlerDeps();
  assert.ok(handleContinueDirective(issue, comments, deps), `Expected "${directive}" to act on the parked workflow of issue ${issue}`);
}
