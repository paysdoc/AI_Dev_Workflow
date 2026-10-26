/**
 * The in-process scenarios of feature-1103.feature carry `@surface` but no `@regression`, so the regression hooks
 * give them neither the mock infrastructure nor a cleanup. The hooks here do what the `@regression` hooks do, for
 * those scenarios alone. The rest are the phrases no other file defines: the plan the build agent works from, the
 * stand-in Claude CLI that plays the build agent context by context (feature-1103-cli.ts), and the Thens that read
 * what the stand-in ran and was asked.
 */

import { After, Before, Given, Then, type DataTable } from '@cucumber/cucumber';
import assert from 'assert';
import { rmSync } from 'fs';

import { MAX_CONTEXT_RESETS, MAX_PROGRESS_CHECKPOINTS } from '../../../adws/core/config.ts';
import { setupMockInfrastructure, teardownMockInfrastructure } from '../../../test/mocks/test-harness.ts';
import { runCleanup } from '../../regression/support/cleanup.ts';
import { commitFileOnBranch } from '../../regression/support/fixtureWorktree.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import {
  identifyingLine,
  planStepFile,
  readRunLog,
  writeStandInCli,
  type ContextRecord,
  type ContextRule,
  type InstalledStandIn,
} from './feature-1103-cli.ts';
import { BUILD_COMPLETE, rulesOf } from './feature-1103-contexts.ts';

const OWN_SURFACE_SCENARIO = '@adw-1103 and @surface and not @regression';

const BASE_BRANCH = 'main';

interface State1103 {
  worktreePath: string | undefined;
  planStepFiles: readonly string[];
  commitsEverything: boolean;
  rules: readonly ContextRule[] | undefined;
  installed: InstalledStandIn | undefined;
}

function freshState(): State1103 {
  return { worktreePath: undefined, planStepFiles: [], commitsEverything: false, rules: undefined, installed: undefined };
}

const s: State1103 = freshState();

function resetState(): void {
  Object.assign(s, freshState());
}

Before({ tags: OWN_SURFACE_SCENARIO }, async function (this: RegressionWorld) {
  resetState();
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
  this.claudeCliStandIn = undefined;
  this.cleanup = [];
  resetState();
});

Given(
  'the build phase checkpoints the build after every {int} contexts that end at the token limit or at a compaction, and allows at most {int} checkpoints',
  function (contexts: number, checkpoints: number) {
    assert.strictEqual(
      MAX_CONTEXT_RESETS,
      contexts,
      `The scenarios assume a checkpoint after every ${contexts} contexts, but MAX_CONTEXT_RESETS is ${MAX_CONTEXT_RESETS}. The MAX_CONTEXT_RESETS environment variable overrides it, and every context count in the feature follows from it`,
    );
    assert.strictEqual(
      MAX_PROGRESS_CHECKPOINTS,
      checkpoints,
      `The scenarios assume at most ${checkpoints} checkpoints, but MAX_PROGRESS_CHECKPOINTS is ${MAX_PROGRESS_CHECKPOINTS}. The MAX_PROGRESS_CHECKPOINTS environment variable overrides it, and every context count in the feature follows from it`,
    );
  },
);

function planText(issueNumber: number, stepFiles: readonly string[]): string {
  return [
    `# Implementation Plan: surface plan for issue ${issueNumber}`,
    '',
    '## Steps',
    ...stepFiles.map((file, index) => `${index + 1}. Create \`${file}\`.`),
    '',
    '## Validation Commands',
    '- `bunx tsc --noEmit`',
    '',
  ].join('\n');
}

// Each step names a file of its own, which is how a scenario row says that a context finished a given plan step.
Given(
  'the worktree for adwId {string} has a plan of {int} steps for issue {int} committed on its branch',
  function (this: RegressionWorld, adwId: string, steps: number, issueNumber: number) {
    const worktreePath = this.worktreePaths.get(adwId);
    assert.ok(worktreePath, `No worktree is registered for adwId "${adwId}": the worktree Given must initialise it first`);
    s.worktreePath = worktreePath;
    s.planStepFiles = Array.from({ length: steps }, (_, index) => planStepFile(index + 1));
    commitFileOnBranch(
      worktreePath,
      `specs/issue-${issueNumber}-adw-${adwId}-sdlc_planner-surface-plan.md`,
      planText(issueNumber, s.planStepFiles),
      `plan: add the plan for issue ${issueNumber}`,
    );
  },
);

Given('the stand-in commit agent commits every change in the worktree whenever it is asked to commit', function () {
  s.commitsEverything = true;
});

function installStandIn(world: RegressionWorld): string {
  if (s.installed) return s.installed.scriptPath;
  assert.ok(s.worktreePath, 'Expected the scenario to commit a plan on the worktree before the phase runs');
  assert.ok(s.rules, "Expected the scenario to script the stand-in build agent's contexts before the phase runs");
  const installed = writeStandInCli({
    worktreePath: s.worktreePath,
    planStepFiles: s.planStepFiles,
    commitsEverything: s.commitsEverything,
    rules: s.rules,
  });
  world.cleanup.push(() => rmSync(installed.dir, { recursive: true, force: true }));
  s.installed = installed;
  return installed.scriptPath;
}

// The script is written when the phase starts the agent, so the Givens that configure it may come in any order.
Given("the stand-in build agent's contexts go as follows:", function (this: RegressionWorld, table: DataTable) {
  s.rules = rulesOf(table.hashes());
  this.claudeCliStandIn = () => installStandIn(this);
});

function contextsRun(): ContextRecord[] {
  assert.ok(s.installed, 'Expected the phase to have started the stand-in build agent first');
  return readRunLog(s.installed).contexts;
}

/** A run the stand-in could not play as scripted says why a count is off, so the count assertions name it. */
function problemsOfStandIn(): string {
  const problems = s.installed ? readRunLog(s.installed).problems : [];
  return problems.length > 0 ? `. The stand-in reports: ${problems.join('; ')}` : '';
}

Then('the stand-in build agent ran {int} contexts', function (expected: number) {
  const ran = contextsRun().length;
  assert.strictEqual(ran, expected, `Expected the stand-in build agent to run ${expected} contexts, but it ran ${ran}${problemsOfStandIn()}`);
});

// The bound the issue allows: the build ends at the context that reports, or after one short verify-only pass.
Then('the stand-in build agent ran at most one context after context {int}', function (reporting: number) {
  const ran = contextsRun().length;
  assert.ok(ran <= reporting + 1, `Expected the stand-in build agent to run at most one context after context ${reporting}, but it ran ${ran} contexts${problemsOfStandIn()}`);
});

const PREVIOUS_OUTPUT = /<previous-agent-output[^>]*>([\s\S]*?)<\/previous-agent-output>/;

/** The agent runner single-quotes the whole prompt, and writes each apostrophe in it as '\''. */
function promptOf(run: number): string {
  const context = contextsRun().find((candidate) => candidate.run === run);
  assert.ok(context, `Expected the stand-in build agent to have run context ${run}, but it ran ${contextsRun().length} contexts`);
  return context.prompt.replace(/'\\''/g, "'");
}

/** What the prompt itself says, with the previous agent's words left out: they are not instructions. */
function instructionsOf(run: number): string {
  return promptOf(run).replace(PREVIOUS_OUTPUT, '');
}

function previousOutputOf(run: number): string {
  const block = PREVIOUS_OUTPUT.exec(promptOf(run));
  assert.ok(block, `Expected the prompt of context ${run} to carry the output of the context before it`);
  return block[1];
}

function runsFrom(first: number, last: number): number[] {
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

function quoted(phrases: readonly string[]): string {
  return phrases.map((phrase) => `"${phrase}"`).join(', ');
}

function assertEveryPromptHolds(first: number, last: number, expectedPhrases: readonly string[]): void {
  for (const run of runsFrom(first, last)) {
    const instructions = instructionsOf(run);
    const missing = expectedPhrases.filter((phrase) => !instructions.includes(phrase));
    assert.deepStrictEqual(missing, [], `Expected the prompt of context ${run} to contain ${quoted(expectedPhrases)}, but it lacks: ${quoted(missing)}`);
  }
}

Then(
  "the prompt of each of the stand-in build agent's contexts {int} to {int} asks it, before it edits anything, to check every plan step against the git state, and, once every plan step is done and the plan's validation commands pass, to end with the BUILD_COMPLETE result and edit nothing more",
  function (first: number, last: number) {
    assertEveryPromptHolds(first, last, [
      '## Completion Check',
      'before you change anything',
      'check every step of the plan above against the git state',
      "run the plan's validation commands",
      'Make no further edits',
    ]);
    for (const run of runsFrom(first, last)) {
      const reportsItOnALineOfItsOwn = instructionsOf(run).split('\n').includes(BUILD_COMPLETE);
      assert.ok(reportsItOnALineOfItsOwn, `Expected the prompt of context ${run} to show ${BUILD_COMPLETE} on a line of its own, for the agent to end with`);
    }
  },
);

Then(
  "the prompt of each of the stand-in build agent's contexts {int} to {int} tells it that once every plan step is committed, refactors, extra hardening, stress tests and mutation tests that no plan step asks for are out of scope, and that uncommitted edits outside the plan's steps are not work to continue",
  function (first: number, last: number) {
    assertEveryPromptHolds(first, last, [
      '## Scope',
      'out of scope',
      'refactors',
      'extra hardening',
      'stress tests',
      'mutation tests',
      "Uncommitted edits outside the plan's steps are not work to continue",
    ]);
  },
);

Then(
  "the prompt of the stand-in build agent's context {int}, the first after a checkpoint, still points it at the commits its branch carries ahead of the base branch as the record of the work already done",
  function (run: number) {
    assertEveryPromptHolds(run, run, [`git log --oneline --stat origin/${BASE_BRANCH}..HEAD`]);
  },
);

Then(
  "the prompts of the stand-in build agent's contexts {int} and {int}, before any checkpoint, still carry the output of the context before each",
  function (first: number, second: number) {
    for (const run of [first, second]) {
      const carried = previousOutputOf(run);
      const expected = identifyingLine(run - 1);
      assert.ok(carried.includes(expected), `Expected the output carried into the prompt of context ${run} to hold the line "${expected}" of context ${run - 1}, but it holds: ${carried.slice(-200)}`);
    }
  },
);
