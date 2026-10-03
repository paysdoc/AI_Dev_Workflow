// The surface rows' steps: they run the production phases and orchestrator lifecycle in-process
// (features/regression/support/phaseRun.ts) and read what those runs produced. No step reads a source file.

import { Given, Then, When } from '@cucumber/cucumber';
import assert from 'assert';
import { isProcessLive } from '../../../adws/core/processLiveness.ts';
import type { ScenarioProofResult } from '../../../adws/phases/scenarioProof.ts';
import { readSpawnLockRecord } from '../../../adws/triggers/spawnGate.ts';
import { commitFileOnBranch } from '../support/fixtureWorktree.ts';
import { SURFACE_REPO, runDirectSurfacePhase, runSurfaceLifecycle, runSurfacePhase } from '../support/phaseRun.ts';
import type { LifecycleOutcome, PhaseOutcome, RegressionWorld } from './world.ts';

function describeEnd({ resolved, error, exitCode }: PhaseOutcome): string {
  if (resolved) return 'resolved';
  if (exitCode !== undefined) return `ended the process with exit code ${exitCode}`;
  return `failed with ${String(error)}`;
}

// A process.exit, the pause and timeout path, is no failure of the phase.
function failedWithError({ resolved, error, exitCode }: PhaseOutcome): boolean {
  return !resolved && error !== undefined && exitCode === undefined;
}

function requireWorktree(world: RegressionWorld, adwId: string): string {
  const worktreePath = world.worktreePaths.get(adwId);
  assert.ok(worktreePath, `No worktree is registered for adwId "${adwId}": G11 must initialise it first`);
  return worktreePath;
}

function requirePhaseOutcome(world: RegressionWorld, phase: string): PhaseOutcome {
  const { phaseOutcome } = world;
  assert.ok(phaseOutcome, 'Expected a phase to have been run first');
  assert.strictEqual(phaseOutcome.phase, phase, `Expected the outcome of the "${phase}" phase, but the phase that ran is "${phaseOutcome.phase}"`);
  return phaseOutcome;
}

function requireScenarioProof(world: RegressionWorld): ScenarioProofResult {
  const { scenarioProofResult } = world;
  assert.ok(scenarioProofResult, 'Expected a phase to have left a scenario proof first');
  return scenarioProofResult;
}

function heldTags({ tagResults }: ScenarioProofResult): string {
  return tagResults.map(({ resolvedTag }) => resolvedTag).join(', ');
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
  'the {string} phase, which no orchestrator runs, is driven directly for adwId {string}',
  async function (this: RegressionWorld, phase: string, adwId: string) {
    this.phaseOutcome = await runDirectSurfacePhase(this, adwId, phase);
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
    commitFileOnBranch(
      requireWorktree(this, adwId),
      `specs/issue-${issueNumber}-adw-${adwId}-sdlc_planner-surface-plan.md`,
      `# Implementation Plan: surface plan for issue ${issueNumber}\n\n## Steps\n1. Implement the plan\n`,
      `plan: add the plan for issue ${issueNumber}`,
    );
  },
);

// The fixture's `## Scenario Directory` is features/ and names no per-issue directory; the phases find a scenario by its @adw-<N> tag anywhere in the worktree.
Given(
  'the worktree for adwId {string} has a scenario for issue {int} committed on its branch',
  function (this: RegressionWorld, adwId: string, issueNumber: number) {
    commitFileOnBranch(
      requireWorktree(this, adwId),
      `features/feature-${issueNumber}.feature`,
      [
        `@adw-${issueNumber}`,
        `Feature: Surface scenarios for issue ${issueNumber}`,
        '',
        '  Scenario: The surface fixture answers',
        '    Given the surface fixture is running',
        '    Then the surface fixture answers',
        '',
      ].join('\n'),
      `scenarios: add the scenarios for issue ${issueNumber}`,
    );
  },
);

// The fixture's .adw/scenarios.md names no step definition directory or BDD framework, so the proof looks for .ts files under the default one.
Given(
  'the worktree for adwId {string} has step definitions committed on its branch',
  function (this: RegressionWorld, adwId: string) {
    commitFileOnBranch(
      requireWorktree(this, adwId),
      'features/step_definitions/surface.steps.ts',
      [
        "import { Given, Then } from '@cucumber/cucumber';",
        '',
        "Given('the surface fixture is running', function () {});",
        "Then('the surface fixture answers', function () {});",
        '',
      ].join('\n'),
      'step definitions: add the surface step definitions',
    );
  },
);

Then('the {string} phase run succeeded', function (this: RegressionWorld, phase: string) {
  const outcome = requirePhaseOutcome(this, phase);
  assert.ok(outcome.resolved, `Expected the "${phase}" phase run to succeed, but it ${describeEnd(outcome)}`);
});

Then('the {string} phase run failed', function (this: RegressionWorld, phase: string) {
  const outcome = requirePhaseOutcome(this, phase);
  assert.ok(failedWithError(outcome), `Expected the "${phase}" phase run to fail with an error, but it ${describeEnd(outcome)}`);
});

Then('the {string} phase run failed with an error that names {string}', function (this: RegressionWorld, phase: string, text: string) {
  const outcome = requirePhaseOutcome(this, phase);
  const expectation = `Expected the "${phase}" phase run to fail with an error that names "${text}", but it`;
  assert.ok(failedWithError(outcome), `${expectation} ${describeEnd(outcome)}`);
  const { error } = outcome;
  const message = error instanceof Error ? error.message : String(error);
  assert.ok(message.includes(text), `${expectation} ${describeEnd(outcome)}`);
});

Then('the scenario proof ran no tag', function (this: RegressionWorld) {
  const proof = requireScenarioProof(this);
  assert.strictEqual(proof.tagResults.length, 0, `Expected the scenario proof to run no tag, but it holds a result for: ${heldTags(proof)}`);
});

Then('the scenario proof records a blocker failure for the tag {string}', function (this: RegressionWorld, tag: string) {
  const proof = requireScenarioProof(this);
  const result = proof.tagResults.find(({ resolvedTag }) => resolvedTag === tag);
  const held = proof.tagResults.length > 0 ? `it holds: ${heldTags(proof)}` : 'it ran no tag, as it does when the worktree has no step definitions';
  assert.ok(result, `Expected the scenario proof to hold a result for ${tag}, but ${held}`);
  assert.strictEqual(result.severity, 'blocker', `Expected ${tag} to be a blocker, but its severity is ${result.severity}`);
  assert.strictEqual(result.skipped, false, `Expected ${tag} to have run, but it was skipped`);
  assert.strictEqual(result.passed, false, `Expected ${tag} to have failed, but it passed`);
  assert.ok(proof.hasBlockerFailures, `Expected the scenario proof to record blocker failures for ${tag}, but it records none`);
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
