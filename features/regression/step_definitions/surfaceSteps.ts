// The surface rows' steps: they run the production phases and orchestrator lifecycle in-process
// (features/regression/support/phaseRun.ts) and read what those runs produced. No step reads a source file.

import { Given, Then, When } from '@cucumber/cucumber';
import assert from 'assert';
import { isProcessLive } from '../../../adws/core/processLiveness.ts';
import { readSpawnLockRecord } from '../../../adws/triggers/spawnGate.ts';
import { commitFileOnBranch } from '../support/fixtureWorktree.ts';
import { SURFACE_REPO, runSurfaceLifecycle, runSurfacePhase } from '../support/phaseRun.ts';
import type { LifecycleOutcome, PhaseOutcome, RegressionWorld } from './world.ts';

function describeEnd({ resolved, error, exitCode }: PhaseOutcome): string {
  if (resolved) return 'resolved';
  if (exitCode !== undefined) return `ended the process with exit code ${exitCode}`;
  return `failed with ${String(error)}`;
}

function requirePhaseOutcome(world: RegressionWorld, phase: string): PhaseOutcome {
  const { phaseOutcome } = world;
  assert.ok(phaseOutcome, 'Expected a phase to have been run first');
  assert.strictEqual(phaseOutcome.phase, phase, `Expected the outcome of the "${phase}" phase, but the phase that ran is "${phaseOutcome.phase}"`);
  return phaseOutcome;
}

function requireLifecycleOutcome(world: RegressionWorld): LifecycleOutcome {
  const { lifecycleOutcome } = world;
  assert.ok(lifecycleOutcome, 'Expected an orchestrator lifecycle to have been run first');
  return lifecycleOutcome;
}

function commentBodyContains(requestBody: string, text: string): boolean {
  try {
    const { body } = JSON.parse(requestBody) as { body?: unknown };
    return typeof body === 'string' && body.includes(text);
  } catch {
    return false;
  }
}

When(
  'the {string} phase of the {string} orchestrator runs for adwId {string}',
  async function (this: RegressionWorld, phase: string, orchestrator: string, adwId: string) {
    this.phaseOutcome = await runSurfacePhase(this, adwId, orchestrator, phase);
  },
);

When(
  "the {string} orchestrator's lifecycle runs for adwId {string}",
  async function (this: RegressionWorld, orchestrator: string, adwId: string) {
    this.lifecycleOutcome = await runSurfaceLifecycle(this, adwId, orchestrator);
  },
);

Given(
  'the worktree for adwId {string} has the plan for issue {int} committed on its branch',
  function (this: RegressionWorld, adwId: string, issueNumber: number) {
    const worktreePath = this.worktreePaths.get(adwId);
    assert.ok(worktreePath, `No worktree is registered for adwId "${adwId}": G11 must initialise it first`);
    commitFileOnBranch(
      worktreePath,
      `specs/issue-${issueNumber}-adw-${adwId}-sdlc_planner-surface-plan.md`,
      `# Implementation Plan: surface plan for issue ${issueNumber}\n\n## Steps\n1. Implement the plan\n`,
      `plan: add the plan for issue ${issueNumber}`,
    );
  },
);

Then('the {string} phase run succeeded', function (this: RegressionWorld, phase: string) {
  const outcome = requirePhaseOutcome(this, phase);
  assert.ok(outcome.resolved, `Expected the "${phase}" phase run to succeed, but it ${describeEnd(outcome)}`);
});

// A process.exit, the pause and timeout path, is no failure of the phase.
Then('the {string} phase run failed', function (this: RegressionWorld, phase: string) {
  const outcome = requirePhaseOutcome(this, phase);
  const failed = !outcome.resolved && outcome.error !== undefined && outcome.exitCode === undefined;
  assert.ok(failed, `Expected the "${phase}" phase run to fail with an error, but it ${describeEnd(outcome)}`);
});

Then('the spawn-gate lock for issue {int} was held by the orchestrator while its lifecycle ran', function (this: RegressionWorld, issueNumber: number) {
  const outcome = requireLifecycleOutcome(this);
  assert.strictEqual(outcome.issueNumber, issueNumber, `Expected the lifecycle that ran to be for issue ${issueNumber}, but it was for issue ${outcome.issueNumber}`);
  assert.strictEqual(outcome.returned, true, `Expected the lifecycle to run the workflow and return true, but it returned ${String(outcome.returned)} (error: ${String(outcome.error)}, exit code: ${String(outcome.exitCode)})`);
  assert.ok(outcome.ran, 'Expected the workflow to have run under the lifecycle');
  assert.strictEqual(outcome.lockHolderPid, process.pid, `Expected the orchestrator (pid ${process.pid}) to hold the lock while the workflow ran, but its holder was ${String(outcome.lockHolderPid)}`);
});

Then("the orchestrator's lifecycle for adwId {string} did not run the workflow", function (this: RegressionWorld, adwId: string) {
  const outcome = requireLifecycleOutcome(this);
  assert.strictEqual(outcome.adwId, adwId, `Expected the lifecycle that ran to be for adwId "${adwId}", but it was for "${outcome.adwId}"`);
  assert.strictEqual(outcome.ran, false, 'Expected the workflow not to have run under the lifecycle');
  assert.strictEqual(outcome.returned, false, `Expected the lifecycle to return false, but it returned ${String(outcome.returned)}`);
  assert.strictEqual(outcome.error, undefined, `Expected the lifecycle to end without an error, but it failed with ${String(outcome.error)}`);
  assert.strictEqual(outcome.exitCode, undefined, `Expected the lifecycle not to end the process, but it exited with code ${String(outcome.exitCode)}`);
});

Then('the spawn-gate lock for issue {int} is still held by the other live process', function (this: RegressionWorld, issueNumber: number) {
  const record = readSpawnLockRecord(SURFACE_REPO, issueNumber);
  assert.ok(record, `Expected a spawn-gate lock for issue ${issueNumber} to be held, but there is none`);
  assert.notStrictEqual(record.pid, process.pid, `Expected the lock for issue ${issueNumber} to be held by another process, but this one holds it`);
  assert.ok(isProcessLive(record.pid, record.pidStartedAt), `Expected pid ${record.pid}, which holds the lock for issue ${issueNumber}, to be live`);
});

Then(
  'the mock harness recorded zero comment posts on issue {int} containing the text {string}',
  function (this: RegressionWorld, issueNumber: number, text: string) {
    const posts = this.getRecordedRequests().filter(
      (request) => request.method === 'POST' && request.url.includes(`/issues/${issueNumber}/comments`) && commentBodyContains(request.body, text),
    );
    assert.strictEqual(posts.length, 0, `Expected zero comment posts on issue ${issueNumber} containing "${text}", but recorded ${posts.length}`);
  },
);
