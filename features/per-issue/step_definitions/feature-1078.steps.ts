/**
 * The in-process scenarios of feature-1078.feature carry `@surface` but no `@regression`, so the regression hooks
 * give them neither the mock infrastructure nor a cleanup. The hooks here do what the `@regression` hooks do, for
 * those scenarios alone. The cron scenario runs under the `@dead-orchestrator-takeover` hooks, and the type-check
 * scenario needs none. The rest are the phrases no other file defines: the Given that seeds the comments an earlier
 * run of a workflow posted, the two Whens that run a phase resuming that run, and the Then for a phase that ended
 * the process without failing.
 */

import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import assert from 'assert';

import { detectRecoveryState } from '../../../adws/core/index.ts';
import { STAGE_ORDER } from '../../../adws/core/workflowCommentParsing.ts';
import { formatWorkflowComment, type WorkflowContext } from '../../../adws/forge/workflowCommentsIssue.ts';
import type { RecoveryState, WorkflowStage } from '../../../adws/types/workflowTypes.ts';
import { getMockServerState } from '../../../test/mocks/github-api-server.ts';
import { setupMockInfrastructure, teardownMockInfrastructure } from '../../../test/mocks/test-harness.ts';
import { runCleanup } from '../../regression/support/cleanup.ts';
import { runDirectSurfacePhase, runSurfacePhase } from '../../regression/support/phaseRun.ts';
import { seededIssue, seededIssueComments } from '../../regression/support/seededRecords.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

const OWN_SURFACE_SCENARIO = '@adw-1078 and @surface and not @regression';

const AN_HOUR_MS = 60 * 60_000;
const ONE_SECOND_MS = 1_000;

Before({ tags: OWN_SURFACE_SCENARIO }, async function (this: RegressionWorld) {
  this.mockContext = await setupMockInfrastructure();
});

After({ tags: OWN_SURFACE_SCENARIO }, async function (this: RegressionWorld) {
  await runCleanup(this);
  await teardownMockInfrastructure();
  this.mockContext = null;
  this.lastExitCode = -1;
  this.lastOutput = '';
  this.seededIssues = new Set();
  this.worktreePaths.clear();
  this.targetBranch = '';
  this.harnessEnv = {};
  this.phaseOutcome = undefined;
  this.cleanup = [];
});

/** `resuming` is posted only by a run that itself resumed, so the first run an earlier run stands for never posted it. */
function stagesPostedUpTo(lastStage: WorkflowStage): WorkflowStage[] {
  return STAGE_ORDER.slice(0, STAGE_ORDER.indexOf(lastStage) + 1).filter((stage) => stage !== 'resuming');
}

/** The scenarios branch the worktree after the adwId, and the plan is the one the plan Given commits. */
function earlierRunContext(issueNumber: number, adwId: string, stage: WorkflowStage): WorkflowContext {
  const planCreated = STAGE_ORDER.indexOf(stage) >= STAGE_ORDER.indexOf('plan_created');
  return {
    issueNumber,
    adwId,
    issueType: '/feature',
    branchName: adwId,
    ...(planCreated ? { planPath: `specs/issue-${issueNumber}-adw-${adwId}-sdlc_planner-surface-plan.md` } : {}),
  };
}

Given(
  'issue {int} holds the workflow comments an earlier run of workflow {string} posted, up to the stage {string}',
  async function (this: RegressionWorld, issueNumber: number, adwId: string, lastStage: string) {
    assert.ok(this.mockContext, 'mockContext must be initialised in a Before hook');
    const last = STAGE_ORDER.find((stage) => stage === lastStage);
    assert.ok(last, `"${lastStage}" is no stage a workflow comment records; the stages are: ${STAGE_ORDER.join(', ')}`);

    const startedAt = Date.now() - AN_HOUR_MS;
    const comments = stagesPostedUpTo(last).map((stage, index) => ({
      id: index + 1,
      body: formatWorkflowComment(stage, earlierRunContext(issueNumber, adwId, stage)),
      user: { login: 'mock-server', type: 'Bot' },
      created_at: new Date(startedAt + index * ONE_SECOND_MS).toISOString(),
    }));
    // Seeded through the server's state, never as requests, so a Then that counts the posts counts the resumed run's alone.
    await this.mockContext.setState({ comments: { ...getMockServerState().comments, [String(issueNumber)]: comments } });
  },
);

/** Read from the comments the Given seeded, as `initializeWorkflow` reads them from the forge; asserted here so that a seeding mistake fails here and not in a Then. */
function recoveryStateOfEarlierRun(): RecoveryState {
  const issue = seededIssue();
  const recoveryState = detectRecoveryState(seededIssueComments(issue.number));
  assert.ok(recoveryState.canResume, `Expected the comments seeded on issue ${issue.number} to hold a run that can be resumed, but recovery reads none`);
  return recoveryState;
}

When(
  'the {string} phase of the {string} orchestrator runs for adwId {string}, resuming the earlier run',
  async function (this: RegressionWorld, phase: string, orchestrator: string, adwId: string) {
    this.phaseOutcome = await runSurfacePhase(this, adwId, orchestrator, phase, recoveryStateOfEarlierRun());
  },
);

When(
  'the {string} phase, which no orchestrator runs, is driven directly for adwId {string}, resuming the earlier run',
  async function (this: RegressionWorld, phase: string, adwId: string) {
    this.phaseOutcome = await runDirectSurfacePhase(this, adwId, phase, recoveryStateOfEarlierRun());
  },
);

Then('the {string} phase run stopped the workflow without an error', function (this: RegressionWorld, phase: string) {
  const outcome = this.phaseOutcome;
  assert.ok(outcome, 'Expected a phase to have been run first');
  assert.strictEqual(outcome.phase, phase, `Expected the outcome of the "${phase}" phase, but the phase that ran is "${outcome.phase}"`);

  const expectation = `Expected the "${phase}" phase run to end the process with exit code 0 and no error, but it`;
  assert.ok(!outcome.resolved, `${expectation} resolved`);
  assert.strictEqual(outcome.error, undefined, `${expectation} failed with ${String(outcome.error)}`);
  assert.strictEqual(outcome.exitCode, 0, `${expectation} ended the process with exit code ${String(outcome.exitCode)}`);
});
