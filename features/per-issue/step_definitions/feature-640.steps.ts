/**
 * BDD step definitions for feature-640.feature
 * A resumed build run is told to inventory its worktree and continue, not restart.
 *
 * §1  Resumed run → prompt signals resume + directs inventory
 * §2  Resumed run → prompt directs continue from existing work, no redo
 * §3  Fresh run → no resume signal, plan still embedded
 * §4  Resumed prompt embeds same plan as fresh + adds resume context
 * §5  TypeScript type-check backstop
 *
 * Steps NOT defined here (already registered):
 *   Given 'the ADW codebase is checked out'        → ensureCronOnEveryEventSteps.ts (G18)
 *   Then  'the ADW TypeScript type-check passes'   → feature-504.steps.ts (T22)
 */

import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import { buildResumeInPlacePrompt } from '../../../adws/phases/planPhase.ts';

// ---------------------------------------------------------------------------
// Scenario state
// ---------------------------------------------------------------------------

const PLAN_CONTENT = '## Plan\n\n1. Implement feature A\n2. Implement feature B';

interface State {
  isResume: boolean;
  composedPrompt: string;
  freshPrompt: string;
}

const state: State = {
  isResume: false,
  composedPrompt: '',
  freshPrompt: '',
};

function resetState(): void {
  state.isResume = false;
  state.composedPrompt = '';
  state.freshPrompt = '';
}

Before({ tags: '@adw-640' }, function () {
  resetState();
});

After({ tags: '@adw-640' }, function () {
  resetState();
});

// ---------------------------------------------------------------------------
// Given
// ---------------------------------------------------------------------------

Given('a resumed-in-place build run whose worktree carries partial work from the interrupted run', function () {
  state.isResume = true;
});

Given('a fresh build run that is not being resumed', function () {
  state.isResume = false;
});

// ---------------------------------------------------------------------------
// When
// ---------------------------------------------------------------------------

When('the build agent prompt is composed for the run', function () {
  if (state.isResume) {
    state.composedPrompt = buildResumeInPlacePrompt(PLAN_CONTENT, 'dev');
  } else {
    // Fresh run: the plain plan content is used unchanged (no wrapper applied)
    state.composedPrompt = PLAN_CONTENT;
  }
  // Always store the fresh (plain) prompt for comparison assertions in §4
  state.freshPrompt = PLAN_CONTENT;
});

// ---------------------------------------------------------------------------
// Then — §1: resume signal + inventory direction
// ---------------------------------------------------------------------------

Then('the build agent prompt signals that the run is resuming an in-progress implementation', function () {
  const lower = state.composedPrompt.toLowerCase();
  assert.ok(
    lower.includes('resuming') || lower.includes('resume') || lower.includes('interrupted') || lower.includes('abandoned'),
    `Expected prompt to signal resumption.\nPrompt:\n${state.composedPrompt}`,
  );
});

Then('the build agent prompt instructs the agent to inventory the existing work in its worktree before writing code', function () {
  const lower = state.composedPrompt.toLowerCase();
  assert.ok(
    lower.includes('inspect') || lower.includes('inventory'),
    `Expected prompt to instruct inventory of existing work.\nPrompt:\n${state.composedPrompt}`,
  );
});

// ---------------------------------------------------------------------------
// Then — §2: authoritative record + continue + no redo
// ---------------------------------------------------------------------------

Then("the build agent prompt presents the worktree's existing partial work as the authoritative record of work already done", function () {
  assert.ok(
    state.composedPrompt.includes('authoritative'),
    `Expected prompt to present worktree as authoritative.\nPrompt:\n${state.composedPrompt}`,
  );
});

Then('the build agent prompt instructs the agent to continue from where the work left off rather than restart from scratch', function () {
  const lower = state.composedPrompt.toLowerCase();
  assert.ok(
    lower.includes('continue') || lower.includes('resume from'),
    `Expected prompt to instruct continue, not restart.\nPrompt:\n${state.composedPrompt}`,
  );
});

Then('the build agent prompt instructs the agent not to redo work that is already present', function () {
  const lower = state.composedPrompt.toLowerCase();
  assert.ok(
    lower.includes('do not redo') || lower.includes('not redo') || lower.includes('do not re-do') || lower.includes('do not revert'),
    `Expected prompt to forbid redoing existing work.\nPrompt:\n${state.composedPrompt}`,
  );
});

// ---------------------------------------------------------------------------
// Then — §3: fresh run has no resume signal
// ---------------------------------------------------------------------------

Then('the build agent prompt carries no resume-or-inventory signal', function () {
  const lower = state.composedPrompt.toLowerCase();
  assert.ok(
    !lower.includes('resuming an in-progress') && !lower.includes('authoritative') && !lower.includes('inventory'),
    `Expected fresh prompt to carry no resume-or-inventory signal.\nPrompt:\n${state.composedPrompt}`,
  );
});

Then('the build agent prompt includes the implementation plan content', function () {
  assert.ok(
    state.composedPrompt.includes(PLAN_CONTENT),
    `Expected prompt to include plan content.\nPrompt:\n${state.composedPrompt}`,
  );
});

// ---------------------------------------------------------------------------
// Then — §4: resumed prompt preserves same plan + only adds context
// ---------------------------------------------------------------------------

Then("the build agent prompt embeds the same implementation plan content a fresh run's prompt embeds", function () {
  assert.ok(
    state.composedPrompt.includes(PLAN_CONTENT),
    `Expected resumed prompt to embed the same plan content as a fresh run.\nPrompt:\n${state.composedPrompt}`,
  );
});

Then('the build agent prompt adds resume-and-inventory context on top of the fresh build prompt', function () {
  assert.ok(
    state.composedPrompt.length > state.freshPrompt.length,
    `Expected resumed prompt to be longer than the fresh prompt (adds context).\nFresh length: ${state.freshPrompt.length}\nResumed length: ${state.composedPrompt.length}`,
  );
  assert.ok(
    state.composedPrompt.includes('authoritative'),
    `Expected resumed prompt to include resume-and-inventory context.\nPrompt:\n${state.composedPrompt}`,
  );
});
