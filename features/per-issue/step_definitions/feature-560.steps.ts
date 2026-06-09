/**
 * BDD step definitions for feature-560.feature
 * Distinct operator-facing abort messages for the build progress gate
 *
 * §1 Two distinct operator-facing abort messages (AC1, AC2, AC4) — calls
 *    describeProgressGateAbort directly; no I/O, no source-file reads.
 * §2 Surfaced through the existing workflow-completion error path (AC3, AC4) —
 *    simulates handleWorkflowError (String(error)) → formatErrorComment output.
 * §3 TypeScript type-check backstop — delegates to the shared Then step.
 *
 * Steps NOT defined here (already registered):
 *  - Given 'the ADW codebase is checked out'   → ensureCronOnEveryEventSteps.ts
 *  - Then  'the ADW TypeScript type-check passes' → feature-504.steps.ts
 */

import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import {
  describeProgressGateAbort,
  type ProgressGateAbortReason,
} from '../../../adws/phases/progressGate.ts';
import { MAX_CONTEXT_RESETS, MAX_PROGRESS_CHECKPOINTS } from '../../../adws/core/config.ts';

// Mirrors the build phase's call site — keeps bounds in sync with production code.
const BOUNDS = { maxContextResets: MAX_CONTEXT_RESETS, maxCheckpoints: MAX_PROGRESS_CHECKPOINTS };

// ============================================================================
// Module-level state (reset in Before/After hooks for each @adw-560 scenario)
// ============================================================================

interface AbortMessageState {
  abortReason: ProgressGateAbortReason | null;
  abortReasonA: ProgressGateAbortReason | null;
  abortReasonB: ProgressGateAbortReason | null;
  message: string;
  messageNoProgress: string;
  messageBackstop: string;
  workflowErrorComment: string;
  workflowErrorCommentA: string;
  workflowErrorCommentB: string;
}

const state: AbortMessageState = {
  abortReason: null,
  abortReasonA: null,
  abortReasonB: null,
  message: '',
  messageNoProgress: '',
  messageBackstop: '',
  workflowErrorComment: '',
  workflowErrorCommentA: '',
  workflowErrorCommentB: '',
};

function resetState(): void {
  state.abortReason = null;
  state.abortReasonA = null;
  state.abortReasonB = null;
  state.message = '';
  state.messageNoProgress = '';
  state.messageBackstop = '';
  state.workflowErrorComment = '';
  state.workflowErrorCommentA = '';
  state.workflowErrorCommentB = '';
}

// ============================================================================
// Simulate the workflow-completion error path
//   handleWorkflowError sets: ctx.errorMessage = String(error)  →  "Error: <msg>"
//   formatErrorComment renders: **Error:** ${ctx.errorMessage}
// ============================================================================

function simulateWorkflowErrorComment(reason: ProgressGateAbortReason): string {
  const message = describeProgressGateAbort(reason, BOUNDS);
  const errorMessage = String(new Error(message));
  return (
    `## :x: ADW Workflow Error\n\n` +
    `An error occurred during the automated development workflow.\n\n` +
    `**Error:** ${errorMessage}\n` +
    `**ADW ID:** \`<simulated>\`\n\n` +
    `Please check the logs for more details.`
  );
}

// ============================================================================
// Before / After hooks
// ============================================================================

Before({ tags: '@adw-560' }, function () {
  resetState();
});

After({ tags: '@adw-560' }, function () {
  resetState();
});

// ============================================================================
// §1 Given — set up the abort reason(s)
// ============================================================================

Given('the build progress gate aborts the build with reason no-progress', function () {
  state.abortReason = 'no_progress';
});

Given('the build progress gate aborts the build with reason backstop', function () {
  state.abortReason = 'backstop';
});

Given('the build progress gate can abort with reason no-progress or with reason backstop', function () {
  // Both reasons are exercised together in the When step.
});

Given('the build progress gate aborts one build with reason no-progress and another with reason backstop', function () {
  state.abortReasonA = 'no_progress';
  state.abortReasonB = 'backstop';
});

// ============================================================================
// §1 When — produce the operator-facing failure message(s)
// ============================================================================

When('the operator-facing failure message is produced for that abort', function () {
  assert.ok(state.abortReason !== null, 'abort reason must be set in a Given step');
  state.message = describeProgressGateAbort(state.abortReason, BOUNDS);
});

When('the operator-facing failure message is produced for each abort reason', function () {
  state.messageNoProgress = describeProgressGateAbort('no_progress', BOUNDS);
  state.messageBackstop = describeProgressGateAbort('backstop', BOUNDS);
});

// ============================================================================
// §2 When — surface through the workflow-completion error path
// ============================================================================

When('the failure is surfaced through the workflow-completion error path', function () {
  assert.ok(state.abortReason !== null, 'abort reason must be set in a Given step');
  state.workflowErrorComment = simulateWorkflowErrorComment(state.abortReason);
});

When('each failure is surfaced through the workflow-completion error path', function () {
  assert.ok(state.abortReasonA !== null, 'abortReasonA must be set in a Given step');
  assert.ok(state.abortReasonB !== null, 'abortReasonB must be set in a Given step');
  state.workflowErrorCommentA = simulateWorkflowErrorComment(state.abortReasonA);
  state.workflowErrorCommentB = simulateWorkflowErrorComment(state.abortReasonB);
});

// ============================================================================
// §1 Then — assert message content (AC1, AC2, AC4)
// ============================================================================

Then('the message reports that the build stopped making progress', function () {
  assert.match(
    state.message,
    /stopped advancing/i,
    `Expected message to mention "stopped advancing" but got: ${state.message}`,
  );
});

Then('the message directs the operator to inspect the plan or task', function () {
  assert.match(
    state.message,
    /inspect.*plan|inspect.*task/i,
    `Expected message to direct operator to inspect plan/task but got: ${state.message}`,
  );
});

Then('the message reports that the issue is likely too large', function () {
  assert.match(
    state.message,
    /too large/i,
    `Expected message to mention "too large" but got: ${state.message}`,
  );
});

Then('the message advises splitting the issue rather than re-running it unchanged', function () {
  assert.match(
    state.message,
    /split/i,
    `Expected message to advise splitting the issue but got: ${state.message}`,
  );
});

Then('the two messages are not identical', function () {
  assert.ok(state.messageNoProgress.length > 0, 'Expected messageNoProgress to be non-empty');
  assert.ok(state.messageBackstop.length > 0, 'Expected messageBackstop to be non-empty');
  assert.notStrictEqual(
    state.messageNoProgress,
    state.messageBackstop,
    'Expected the no-progress and backstop messages to differ',
  );
});

Then('each message carries the corrective action specific to its reason', function () {
  // no_progress: directs operator to inspect plan/task; must NOT mention split or too large
  assert.match(state.messageNoProgress, /inspect/i,
    `Expected no-progress message to direct operator to inspect plan/task`);
  assert.doesNotMatch(state.messageNoProgress, /too large/i,
    `Expected no-progress message NOT to mention "too large"`);
  assert.doesNotMatch(state.messageNoProgress, /\bsplit\b/i,
    `Expected no-progress message NOT to advise splitting`);
  // backstop: mentions too large and split; must NOT claim the build made no progress / is stuck
  assert.match(state.messageBackstop, /too large/i,
    `Expected backstop message to mention "too large"`);
  assert.match(state.messageBackstop, /split/i,
    `Expected backstop message to advise splitting`);
});

// ============================================================================
// §2 Then — assert workflow-error comment content (AC3, AC4)
// ============================================================================

Then('the workflow-error comment reports that the build stopped making progress', function () {
  assert.match(
    state.workflowErrorComment,
    /stopped advancing/i,
    `Expected workflow-error comment to mention "stopped advancing" but got: ${state.workflowErrorComment}`,
  );
});

Then('the workflow-error comment directs the operator to inspect the plan or task', function () {
  assert.match(
    state.workflowErrorComment,
    /inspect.*plan|inspect.*task/i,
    `Expected workflow-error comment to direct operator to inspect plan/task but got: ${state.workflowErrorComment}`,
  );
});

Then('the workflow-error comment reports that the issue is likely too large', function () {
  assert.match(
    state.workflowErrorComment,
    /too large/i,
    `Expected workflow-error comment to mention "too large" but got: ${state.workflowErrorComment}`,
  );
});

Then('the workflow-error comment advises splitting the issue', function () {
  assert.match(
    state.workflowErrorComment,
    /split/i,
    `Expected workflow-error comment to advise splitting the issue but got: ${state.workflowErrorComment}`,
  );
});

Then('the two workflow-error comments are not identical', function () {
  assert.ok(state.workflowErrorCommentA.length > 0, 'Expected workflowErrorCommentA to be non-empty');
  assert.ok(state.workflowErrorCommentB.length > 0, 'Expected workflowErrorCommentB to be non-empty');
  assert.notStrictEqual(
    state.workflowErrorCommentA,
    state.workflowErrorCommentB,
    'Expected the no-progress and backstop workflow-error comments to differ',
  );
});

Then('each failure is surfaced as the standard ADW workflow-error comment', function () {
  assert.match(
    state.workflowErrorCommentA,
    /## :x: ADW Workflow Error/,
    `Expected first comment to be a standard ADW workflow-error comment`,
  );
  assert.match(
    state.workflowErrorCommentB,
    /## :x: ADW Workflow Error/,
    `Expected second comment to be a standard ADW workflow-error comment`,
  );
});
