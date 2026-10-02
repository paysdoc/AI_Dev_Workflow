/**
 * Assertions for the review-gate scenarios. Each one first requires that the run happened, so a
 * run that never started cannot satisfy a "never" or "no" claim by default.
 */

import { Then } from '@cucumber/cucumber';
import assert from 'assert';

import { AgentStateManager } from '../../../adws/core/agentState.ts';
import { resolveResumeSpawn } from '../../../adws/core/resolveResumeSpawn.ts';
import { KNOWN_PHASES, REVIEW_PHASE } from './feature-927-phases.ts';
import { toOrchestratorName, world, type OpenedPullRequest, type RunOutcome } from './feature-927-world.ts';

function describeRun(): string {
  return world.phaseLog.join(' → ') || '(no phase ran)';
}

function requireRun(orchestrator?: string): RunOutcome {
  const { run } = world;
  assert.ok(run, 'Expected the orchestrator to have run before this check');
  if (orchestrator !== undefined) {
    assert.strictEqual(
      run.orchestrator,
      toOrchestratorName(orchestrator),
      `Expected the "${orchestrator}" orchestrator to have run, but "${run.orchestrator}" did`,
    );
  }
  return run;
}

function reviewAttempts(): number {
  return world.phaseLog.filter(entry => entry === REVIEW_PHASE).length;
}

function assertReviewAttempts(expected: number): void {
  requireRun();
  assert.strictEqual(
    reviewAttempts(),
    expected,
    `Expected the review to be attempted ${expected} time(s), but it was attempted ${reviewAttempts()}. The run: ${describeRun()}`,
  );
}

function assertStageNeverRecorded(adwId: string, stage: string): void {
  requireRun();
  assert.strictEqual(world.workflow?.config.adwId, adwId, `Expected the started workflow to run under adwId "${adwId}"`);
  assert.ok(world.stageHistory.length > 0, `Expected the run to write workflow stages for adwId "${adwId}", but none were recorded`);
  assert.ok(
    !world.stageHistory.includes(stage),
    `Expected workflowStage "${stage}" never to be written for adwId "${adwId}", but the stages written were: ${world.stageHistory.join(' → ')}`,
  );
}

function phasesAfterLastReview(): string[] {
  const lastReview = world.phaseLog.lastIndexOf(REVIEW_PHASE);
  assert.ok(lastReview >= 0, `Expected the run to attempt the review, but the run was: ${describeRun()}`);
  return world.phaseLog.slice(lastReview + 1);
}

function assertNothingAfterLastReview(orchestrator: string): void {
  requireRun(orchestrator);
  assert.deepStrictEqual(
    phasesAfterLastReview(),
    [],
    `Expected no phase after the last review attempt, but the run was: ${describeRun()}`,
  );
}

function assertPhasesAfterLastReview(orchestrator: string, expectedList: string): void {
  requireRun(orchestrator);
  const expected = expectedList.split(',').map(name => name.trim());
  assert.deepStrictEqual(
    phasesAfterLastReview(),
    expected,
    `Expected exactly "${expected.join(', ')}" after the last review attempt, but the run was: ${describeRun()}`,
  );
}

function assertPhaseNotRun(orchestrator: string, phase: string): void {
  requireRun(orchestrator);
  assert.ok(KNOWN_PHASES.includes(phase), `"${phase}" is not a phase the scripted run can log; known phases: ${KNOWN_PHASES.join(', ')}`);
  assert.ok(!world.phaseLog.includes(phase), `Expected the "${phase}" phase not to run, but the run was: ${describeRun()}`);
}

function pullRequestsOpenedFor(issueNumber: number): OpenedPullRequest[] {
  return world.pullRequests.filter(pullRequest => pullRequest.issueNumber === issueNumber);
}

function assertPullRequestsOpened(issueNumber: number, expected: number): void {
  requireRun();
  const opened = pullRequestsOpenedFor(issueNumber);
  assert.strictEqual(
    opened.length,
    expected,
    `Expected ${expected} pull request(s) opened for issue ${issueNumber}, but the code host recorded ${opened.length}. The run: ${describeRun()}`,
  );
}

function assertNoApprovals(): void {
  requireRun();
  assert.deepStrictEqual(world.approvals, [], `Expected no pull request to be approved, but the code host recorded approvals of: ${world.approvals.join(', ')}`);
}

function assertOpenedPullRequestApproved(issueNumber: number): void {
  assertPullRequestsOpened(issueNumber, 1);
  const [opened] = pullRequestsOpenedFor(issueNumber);
  assert.deepStrictEqual(
    world.approvals,
    [opened.number],
    `Expected exactly one approval, of pull request ${opened.number}, but the code host recorded: ${world.approvals.join(', ') || '(none)'}`,
  );
}

function assertEndedWithoutError(orchestrator: string): void {
  const run = requireRun(orchestrator);
  assert.ok(run.resolved, `Expected the "${orchestrator}" orchestrator to end without an error, but it did not: ${run.failure}`);
  assert.deepStrictEqual(
    run.exitCodes.filter(code => code !== 0),
    [],
    `Expected no non-zero exit, but the process was told to exit with: ${run.exitCodes.join(', ')}`,
  );
}

function assertCommentNamesBranch(issueNumber: number, branch: string, text: string): void {
  requireRun();
  const bodies = world.comments.filter(comment => comment.issueNumber === issueNumber).map(comment => comment.body);
  assert.ok(
    bodies.some(body => body.includes(branch) && body.includes(text)),
    `Expected a comment on issue ${issueNumber} naming the branch "${branch}" and telling a human to post "${text}". The comments on the issue were:\n${bodies.join('\n---\n') || '(none)'}`,
  );
}

function assertResumeLaunches(adwId: string, script: string, issueNumber: number): void {
  requireRun();
  const state = AgentStateManager.readTopLevelState(adwId);
  assert.ok(state, `Expected a top-level state file for adwId "${adwId}"`);
  const spawn = resolveResumeSpawn(state);
  assert.strictEqual(spawn.script, script, `Expected the resume to launch ${script}, but it launches ${spawn.script}`);
  assert.deepStrictEqual([...spawn.args], [String(issueNumber), adwId], 'Expected the resume to pass the issue number and the adwId');
}

Then('the review was attempted {int} time(s)', function (expected: number) {
  assertReviewAttempts(expected);
});

Then('the review was never attempted', function () {
  assertReviewAttempts(0);
});

Then('the state file for adwId {string} never recorded workflowStage {string}', function (adwId: string, stage: string) {
  assertStageNeverRecorded(adwId, stage);
});

Then('the {string} orchestrator ran no phase after its last review attempt', function (orchestrator: string) {
  assertNothingAfterLastReview(orchestrator);
});

Then(
  'after its last review attempt, the {string} orchestrator ran exactly these phases, in order: {string}',
  function (orchestrator: string, phases: string) {
    assertPhasesAfterLastReview(orchestrator, phases);
  },
);

Then('the {string} orchestrator did not run the {string} phase', function (orchestrator: string, phase: string) {
  assertPhaseNotRun(orchestrator, phase);
});

Then('the code host opened no pull request for issue {int}', function (issueNumber: number) {
  assertPullRequestsOpened(issueNumber, 0);
});

Then('the code host opened one pull request for issue {int}', function (issueNumber: number) {
  assertPullRequestsOpened(issueNumber, 1);
});

Then('the code host approved no pull request', function () {
  assertNoApprovals();
});

Then('the code host approved the pull request it opened for issue {int}', function (issueNumber: number) {
  assertOpenedPullRequestApproved(issueNumber);
});

Then('the {string} orchestrator ended without an error', function (orchestrator: string) {
  assertEndedWithoutError(orchestrator);
});

Then(
  'a comment on issue {int} names the branch {string} and tells a human to post {string}',
  function (issueNumber: number, branch: string, text: string) {
    assertCommentNamesBranch(issueNumber, branch, text);
  },
);

Then(
  'the resume that follows a {string} on adwId {string} launches {string} for issue {int}',
  function (_event: string, adwId: string, script: string, issueNumber: number) {
    assertResumeLaunches(adwId, script, issueNumber);
  },
);
