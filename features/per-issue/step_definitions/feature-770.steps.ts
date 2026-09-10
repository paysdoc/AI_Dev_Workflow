/**
 * BDD step definitions for feature-770.feature
 *
 * The adw:unverified comment states the condition that actually produced it
 * — no JUnit report emitted, not "Zero Testcases Ran".
 *
 * Phase-import pattern: no orchestrator subprocess, no mock server. The
 * verdict is resolved through the real computeTestVerdict over the run the
 * step describes, and the comment is composed and dispatched through the
 * real postIssueStageComment → formatWorkflowComment path, with a capturing
 * RepoContext whose issueTracker.commentOnIssue records the body instead of
 * calling GitHub — the fake-commenter pattern already used by
 * feature-720.steps.ts §3 and feature-639.steps.ts §3. The verdict → stage
 * mapping (warn → unverified, hard-fail → error) is re-composed here rather
 * than driven through executeUnitTestPhase itself, because that phase runs
 * the /test agent and calls process.exit(1) on the hard-fail branch —
 * neither is hermetically drivable.
 *
 * Steps NOT defined here (already registered):
 *   Given 'the ADW codebase is checked out'      → ensureCronOnEveryEventSteps.ts (G18)
 *   Then  'the ADW TypeScript type-check passes' → feature-504.steps.ts (T22)
 */

import { Before, Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import { computeTestVerdict } from '../../../adws/core/testVerdict.ts';
import { isAdwComment, extractAdwIdFromComment } from '../../../adws/core/index.ts';
import type { WorkflowStage } from '../../../adws/core/index.ts';
import { postIssueStageComment } from '../../../adws/phases/phaseCommentHelpers.ts';
import type { WorkflowContext } from '../../../adws/forge/workflowCommentsIssue.ts';
import type { RepoContext } from '../../../adws/providers/types.ts';

const ISSUE_NUMBER = 770;

const state: {
  adwId: string;
  lastChannel: WorkflowStage | null;
  lastCommentBody: string | null;
  composedStages: WorkflowStage[];
} = {
  adwId: '',
  lastChannel: null,
  lastCommentBody: null,
  composedStages: [],
};

Before({ tags: '@adw-770' }, function () {
  state.adwId = '';
  state.lastChannel = null;
  state.lastCommentBody = null;
  state.composedStages = [];
});

/** Minimal RepoContext whose issueTracker.commentOnIssue records the body instead of calling GitHub. */
function makeCapturingRepoContext(sink: { issueNumber: number; body: string }[]): RepoContext {
  return {
    issueTracker: {
      commentOnIssue(issueNumber: number, body: string) {
        sink.push({ issueNumber, body });
      },
    },
  } as unknown as RepoContext;
}

/**
 * Composes and dispatches the unit-test channel comment for a described run,
 * re-composing the warn → unverified / hard-fail → error mapping that
 * unitTestPhase.ts applies (see file docstring for why that phase itself
 * cannot be driven hermetically).
 */
function composeUnitTestChannelComment(input: { reportPresent: boolean; hasFailures: boolean; testcaseCount: number }): void {
  const verdictResult = computeTestVerdict({ enabled: true, ...input });
  const sink: { issueNumber: number; body: string }[] = [];
  const repoContext = makeCapturingRepoContext(sink);
  const ctx: WorkflowContext = { adwId: state.adwId, issueNumber: ISSUE_NUMBER };

  let stage: WorkflowStage;
  if (verdictResult.verdict === 'hard-fail') {
    stage = 'error';
    ctx.errorMessage = `Unit tests hard-failed: ${verdictResult.reason}. No PR was created.`;
  } else if (verdictResult.verdict === 'warn') {
    stage = 'unverified';
  } else {
    throw new Error(`Unexpected verdict "${verdictResult.verdict}" for a feature-770 scenario input`);
  }

  postIssueStageComment(repoContext, ISSUE_NUMBER, stage, ctx);

  state.lastChannel = stage;
  state.lastCommentBody = sink[0]?.body ?? null;
  state.composedStages = sink.length > 0 ? [stage] : [];
}

function requireBody(): string {
  assert.ok(state.lastCommentBody !== null, 'No comment body captured — did a When step compose a channel comment?');
  return state.lastCommentBody;
}

// ---------------------------------------------------------------------------
// Background
// ---------------------------------------------------------------------------

Given('the composed channel comments carry the ADW ID {string}', function (adwId: string) {
  state.adwId = adwId;
});

// ---------------------------------------------------------------------------
// §1–§5 When — unit-test channel, report absent
// §6    When — unit-test channel, report present with zero testcases
// ---------------------------------------------------------------------------

When('the unit-test channel comment is composed for a run whose JUnit report was absent', function () {
  composeUnitTestChannelComment({ reportPresent: false, hasFailures: false, testcaseCount: 0 });
});

When('the unit-test channel comment is composed for a run whose JUnit report was present with zero testcases', function () {
  composeUnitTestChannelComment({ reportPresent: true, hasFailures: false, testcaseCount: 0 });
});

// ---------------------------------------------------------------------------
// §7 When — stack-coherence channel
// ---------------------------------------------------------------------------

When('the stack-coherence channel comment is composed for a run with an incoherent stack', function () {
  const sink: { issueNumber: number; body: string }[] = [];
  const repoContext = makeCapturingRepoContext(sink);
  const ctx: WorkflowContext = {
    adwId: state.adwId,
    issueNumber: ISSUE_NUMBER,
    coherenceWarnings: [
      "Detected stack spans multiple languages — testFramework 'pytest'→python, bddFramework 'cucumber-js'→javascript.",
    ],
  };

  postIssueStageComment(repoContext, ISSUE_NUMBER, 'stack_incoherent', ctx);

  state.lastChannel = 'stack_incoherent';
  state.lastCommentBody = sink[0]?.body ?? null;
  state.composedStages = sink.length > 0 ? ['stack_incoherent'] : [];
});

// ---------------------------------------------------------------------------
// Then — channel identity
// ---------------------------------------------------------------------------

Then('the composed channel is the unverified comment', function () {
  assert.strictEqual(state.lastChannel, 'unverified', `Expected channel "unverified" but got "${String(state.lastChannel)}"`);
});

Then('the composed channel is the hard-fail error comment', function () {
  assert.strictEqual(state.lastChannel, 'error', `Expected channel "error" but got "${String(state.lastChannel)}"`);
});

Then('no unverified comment is composed for that run', function () {
  assert.ok(
    !state.composedStages.includes('unverified'),
    `Expected no "unverified" channel comment, but composedStages = ${JSON.stringify(state.composedStages)}`,
  );
});

// ---------------------------------------------------------------------------
// Then — §1 real cause stated
// ---------------------------------------------------------------------------

Then('the composed comment reports that no JUnit report was emitted', function () {
  const body = requireBody();
  assert.match(body, /\bjunit\b/i, `Expected the comment to mention JUnit:\n${body}`);
  assert.match(body, /\bno\b[^.]*\breport\b/i, `Expected the comment to carry the absent-report sense ("no ... report"):\n${body}`);
});

Then('the composed comment names the report path variable {string}', function (varName: string) {
  const body = requireBody();
  assert.ok(body.includes(varName), `Expected the comment to name "${varName}":\n${body}`);
});

// ---------------------------------------------------------------------------
// Then — §2 false claims gone
// ---------------------------------------------------------------------------

Then('the composed comment makes no claim that zero testcases were discovered', function () {
  const body = requireBody();
  assert.doesNotMatch(body, /zero testcase/i, `Expected no "zero testcase" claim:\n${body}`);
});

Then("the composed comment makes no claim about test frameworks in the repository's dependencies", function () {
  const body = requireBody();
  assert.doesNotMatch(body, /detected/i, `Expected no dependency-detection claim ("detected"):\n${body}`);
  assert.doesNotMatch(body, /dependenc/i, `Expected no dependency-detection claim ("dependenc*"):\n${body}`);
});

// ---------------------------------------------------------------------------
// Then — §3 next steps re-aimed
// ---------------------------------------------------------------------------

Then('the composed comment directs the reader to emit a JUnit report from the {string} command', function (commandHeading: string) {
  const body = requireBody();
  assert.ok(body.includes(commandHeading), `Expected the comment to mention "${commandHeading}":\n${body}`);
  assert.match(body, /\bjunit\b/i, `Expected the comment's next steps to reference JUnit:\n${body}`);
});

Then('the composed comment does not direct the reader to configure {string}', function (commandHeading: string) {
  const body = requireBody();
  assert.ok(!body.includes(commandHeading), `Expected the comment NOT to mention "${commandHeading}":\n${body}`);
});

// ---------------------------------------------------------------------------
// Then — §4 still non-blocking, still labelled
// ---------------------------------------------------------------------------

Then('the composed comment names the {string} label', function (label: string) {
  const body = requireBody();
  assert.ok(body.includes(label), `Expected the comment to name the "${label}" label:\n${body}`);
});

Then('the composed comment states the workflow was not blocked', function () {
  const body = requireBody();
  assert.match(
    body,
    /(non-blocking|not blocked|continued without a hard gate)/i,
    `Expected the comment to state the workflow was not blocked:\n${body}`,
  );
});

// ---------------------------------------------------------------------------
// Then — §5 machine-readable
// ---------------------------------------------------------------------------

Then('the composed comment is recognised as an ADW workflow comment', function () {
  const body = requireBody();
  assert.ok(isAdwComment(body), `Expected isAdwComment() to recognise the comment:\n${body}`);
});

Then('the composed comment carries the ADW ID {string}', function (expectedAdwId: string) {
  const body = requireBody();
  assert.strictEqual(extractAdwIdFromComment(body), expectedAdwId);
});

// ---------------------------------------------------------------------------
// Then — §7 coherence channel keeps its guidance
// ---------------------------------------------------------------------------

Then('the composed comment still directs the reader to confirm {string}', function (commandHeading: string) {
  const body = requireBody();
  assert.ok(body.includes(commandHeading), `Expected the comment to still mention "${commandHeading}":\n${body}`);
});
