/**
 * Step definitions for: ## Cancel skips current cycle only, re-spawns on next cron cycle
 * Issue #444 — @adw-444
 */

import { Given, When, Then } from '@cucumber/cucumber';
import { readFileSync } from 'fs';
import { join } from 'path';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

const ROOT = process.cwd();

// ── Per-cycle cancelledThisCycle Set ─────────────────────────────────────────

Then(
  'the checkAndTrigger function declares a local {string} Set of numbers',
  function (setName: string) {
    const content = sharedCtx.fileContent;
    assert.ok(
      content.includes(`const ${setName} = new Set<number>()`),
      `Expected "${sharedCtx.filePath}" to declare "const ${setName} = new Set<number>()"`,
    );
  },
);

Then(
  'the cancelledThisCycle Set is declared inside checkAndTrigger, not at module scope',
  function () {
    const content = sharedCtx.fileContent;
    // The declaration must appear after the checkAndTrigger function opening brace,
    // not at the top-level module scope. We verify it appears after `async function checkAndTrigger`.
    const funcIdx = content.indexOf('async function checkAndTrigger');
    assert.ok(funcIdx !== -1, `Expected "${sharedCtx.filePath}" to contain checkAndTrigger function`);
    const declIdx = content.indexOf('const cancelledThisCycle = new Set<number>()');
    assert.ok(
      declIdx !== -1,
      `Expected "${sharedCtx.filePath}" to declare cancelledThisCycle`,
    );
    assert.ok(
      declIdx > funcIdx,
      `Expected cancelledThisCycle to be declared inside checkAndTrigger (after function definition), not at module scope`,
    );
    // Also verify it is NOT declared at module scope (before checkAndTrigger)
    const moduleDecl = content.substring(0, funcIdx).includes('cancelledThisCycle');
    assert.ok(
      !moduleDecl,
      `Expected cancelledThisCycle NOT to be declared at module scope`,
    );
  },
);

// ── Cancel loop uses cancelledThisCycle, not processedSpawns ─────────────────

Then(
  'inside the cancel loop, cancelled issue numbers are added to cancelledThisCycle',
  function () {
    const content = sharedCtx.fileContent;
    assert.ok(
      content.includes('cancelledThisCycle.add(issue.number)'),
      `Expected "${sharedCtx.filePath}" to call cancelledThisCycle.add(issue.number) in cancel loop`,
    );
  },
);

Then(
  'inside the cancel loop, cancelled issue numbers are not added to processedSpawns',
  function () {
    const content = sharedCtx.fileContent;
    // Find the cancel loop region: between isCancelComment and filterEligibleIssues
    const cancelIdx = content.indexOf('isCancelComment');
    const filterIdx = content.indexOf('filterEligibleIssues(');
    assert.ok(cancelIdx !== -1, `Expected "${sharedCtx.filePath}" to call isCancelComment`);
    assert.ok(filterIdx !== -1, `Expected "${sharedCtx.filePath}" to call filterEligibleIssues`);
    const cancelLoopRegion = content.substring(cancelIdx, filterIdx);
    assert.ok(
      !cancelLoopRegion.includes('processedSpawns.add'),
      `Expected cancel loop region NOT to call processedSpawns.add in "${sharedCtx.filePath}"`,
    );
  },
);

Then(
  'the cancelledThisCycle Set is consulted to skip cancelled issues in the current cycle',
  function () {
    const content = sharedCtx.fileContent;
    assert.ok(
      content.includes('cancelledThisCycle'),
      `Expected "${sharedCtx.filePath}" to reference cancelledThisCycle`,
    );
    // cancelledThisCycle must be passed to filterEligibleIssues
    const filterCallIdx = content.indexOf('filterEligibleIssues(');
    assert.ok(filterCallIdx !== -1, `Expected "${sharedCtx.filePath}" to call filterEligibleIssues`);
    // Find the closing paren of the filterEligibleIssues call
    const callRegion = content.substring(filterCallIdx, filterCallIdx + 400);
    assert.ok(
      callRegion.includes('cancelledThisCycle'),
      `Expected filterEligibleIssues call to include cancelledThisCycle argument in "${sharedCtx.filePath}"`,
    );
  },
);

Then(
  'processedSpawns continues to dedup already-spawned issues separately',
  function () {
    const content = sharedCtx.fileContent;
    // processedSpawns.add must still be called for actual spawns (line ~148)
    assert.ok(
      content.includes('processedSpawns.add(issue.number)'),
      `Expected "${sharedCtx.filePath}" to still call processedSpawns.add for actual spawns`,
    );
  },
);

// ── cancelledThisCycle is freshly allocated each cycle ───────────────────────

Then(
  'cancelledThisCycle is a local const inside checkAndTrigger, so each invocation starts with an empty set',
  function () {
    const content = sharedCtx.fileContent;
    const funcIdx = content.indexOf('async function checkAndTrigger');
    assert.ok(funcIdx !== -1, `Expected "${sharedCtx.filePath}" to contain checkAndTrigger`);
    const afterFunc = content.substring(funcIdx);
    assert.ok(
      afterFunc.includes('const cancelledThisCycle = new Set<number>()'),
      `Expected cancelledThisCycle to be declared as a local const inside checkAndTrigger`,
    );
  },
);

Then(
  'no module-level state retains cancelled issue numbers across cycles',
  function () {
    const content = sharedCtx.fileContent;
    // The module-scope section is everything before checkAndTrigger
    const funcIdx = content.indexOf('async function checkAndTrigger');
    assert.ok(funcIdx !== -1, `Expected "${sharedCtx.filePath}" to contain checkAndTrigger`);
    const moduleScope = content.substring(0, funcIdx);
    assert.ok(
      !moduleScope.includes('cancelledThisCycle'),
      `Expected no module-level "cancelledThisCycle" declaration in "${sharedCtx.filePath}"`,
    );
  },
);

// ── processedSpawns.add is not called in the cancel path ─────────────────────

Then(
  'the cancel loop does not invoke processedSpawns.add for cancelled issues',
  function () {
    const content = sharedCtx.fileContent;
    const cancelIdx = content.indexOf('isCancelComment');
    const filterIdx = content.indexOf('filterEligibleIssues(');
    assert.ok(cancelIdx !== -1, `Expected isCancelComment to exist`);
    assert.ok(filterIdx !== -1, `Expected filterEligibleIssues to exist`);
    const cancelLoopRegion = content.substring(cancelIdx, filterIdx);
    assert.ok(
      !cancelLoopRegion.includes('processedSpawns.add'),
      `Expected cancel loop NOT to call processedSpawns.add in "${sharedCtx.filePath}"`,
    );
  },
);

Then(
  'processedSpawns remains the permanent per-process dedup for spawned workflows only',
  function () {
    const content = sharedCtx.fileContent;
    // processedSpawns.add must appear in the spawn path (after filterEligibleIssues)
    const filterIdx = content.indexOf('filterEligibleIssues(');
    assert.ok(filterIdx !== -1, `Expected filterEligibleIssues to exist`);
    const afterFilter = content.substring(filterIdx);
    assert.ok(
      afterFilter.includes('processedSpawns.add'),
      `Expected processedSpawns.add to still appear after filterEligibleIssues for actual spawns`,
    );
  },
);

// ── Two-cycle behaviour: re-eligibility ──────────────────────────────────────

Given('an issue whose latest comment was {string} on cycle 1', function (_directive: string) {
  // Context only — this scenario verifies structural properties
});

When(
  'cycle 1 completes and the cancel comment has been cleared by handleCancelDirective',
  function () {
    // Context only
  },
);

Then('the issue is not in any per-cycle skip set on cycle 2', function () {
  // The cancelledThisCycle set is a local variable in checkAndTrigger.
  // Since it is re-created each invocation, on cycle 2 it starts empty.
  const content = readFileSync(join(ROOT, 'adws/triggers/trigger_cron.ts'), 'utf-8');
  const funcIdx = content.indexOf('async function checkAndTrigger');
  assert.ok(funcIdx !== -1);
  const afterFunc = content.substring(funcIdx);
  assert.ok(
    afterFunc.includes('const cancelledThisCycle = new Set<number>()'),
    'cancelledThisCycle must be a local const so cycle 2 starts with an empty set',
  );
});

Then(
  'cycle 2 evaluates the issue through filterEligibleIssues as a fresh candidate',
  function () {
    // Structural: cancelledThisCycle is passed to filterEligibleIssues which checks it
    const content = readFileSync(join(ROOT, 'adws/triggers/cronIssueFilter.ts'), 'utf-8');
    assert.ok(
      content.includes('cancelledThisCycle'),
      'cronIssueFilter.ts must accept and use cancelledThisCycle',
    );
  },
);

Then('the cron spawns the workflow for the issue on cycle 2', function () {
  // Structural: since cancelledThisCycle is empty on cycle 2 and processedSpawns was
  // not polluted, filterEligibleIssues will return the issue as eligible.
  const cronContent = readFileSync(join(ROOT, 'adws/triggers/trigger_cron.ts'), 'utf-8');
  const filterContent = readFileSync(join(ROOT, 'adws/triggers/cronIssueFilter.ts'), 'utf-8');
  // Verify processedSpawns is NOT populated in the cancel path
  const cancelIdx = cronContent.indexOf('isCancelComment');
  const filterIdx = cronContent.indexOf('filterEligibleIssues');
  const cancelLoopRegion = cronContent.substring(cancelIdx, filterIdx);
  assert.ok(
    !cancelLoopRegion.includes('processedSpawns.add'),
    'processedSpawns must not be populated in cancel loop',
  );
  // Verify cronIssueFilter honours cancelledThisCycle (an empty set on cycle 2 = no skip)
  assert.ok(
    filterContent.includes("reason: 'cancelled'"),
    'cronIssueFilter.ts must handle cancelled reason',
  );
});

// ── Cycle 1: cancel path does not pollute processedSpawns ────────────────────

Given(
  'an issue with {string} as the latest comment on cycle 1',
  function (_directive: string) {
    // Context only
  },
);

When('cycle 1 runs checkAndTrigger', function () {
  // Context only
});

Then('handleCancelDirective is invoked for the issue', function () {
  const content = readFileSync(join(ROOT, 'adws/triggers/trigger_cron.ts'), 'utf-8');
  assert.ok(
    content.includes('handleCancelDirective'),
    'trigger_cron.ts must call handleCancelDirective',
  );
});

Then(
  'the issue is listed as filtered with reason {string} or similar in the cycle-1 log',
  function (reason: string) {
    const content = readFileSync(join(ROOT, 'adws/triggers/cronIssueFilter.ts'), 'utf-8');
    assert.ok(
      content.includes(`reason: '${reason}'`) || content.includes(`reason: "cancelled"`),
      `cronIssueFilter.ts must return reason '${reason}' for cancelled issues`,
    );
  },
);

Then(
  'processedSpawns does not contain the issue number after cycle 1',
  function () {
    const content = readFileSync(join(ROOT, 'adws/triggers/trigger_cron.ts'), 'utf-8');
    const cancelIdx = content.indexOf('isCancelComment');
    const filterIdx = content.indexOf('filterEligibleIssues(');
    const cancelLoopRegion = content.substring(cancelIdx, filterIdx);
    assert.ok(
      !cancelLoopRegion.includes('processedSpawns.add'),
      'The cancel loop must not add issue numbers to processedSpawns',
    );
  },
);

// ── handleCancelDirective still cleans the permanent dedup sets ───────────────

Then(
  'handleCancelDirective deletes the issueNumber from processedSets.spawns',
  function () {
    assert.ok(
      sharedCtx.fileContent.includes('processedSets.spawns.delete(issueNumber)'),
      `Expected "${sharedCtx.filePath}" to call processedSets.spawns.delete(issueNumber)`,
    );
  },
);

Then(
  'handleCancelDirective deletes the issueNumber from processedSets.merges',
  function () {
    assert.ok(
      sharedCtx.fileContent.includes('processedSets.merges.delete(issueNumber)'),
      `Expected "${sharedCtx.filePath}" to call processedSets.merges.delete(issueNumber)`,
    );
  },
);

Then(
  'handleCancelDirective does not reference processedSets.merges',
  function () {
    assert.ok(
      !sharedCtx.fileContent.includes('processedSets.merges'),
      `Expected "${sharedCtx.filePath}" NOT to reference processedSets.merges`,
    );
  },
);

// ── Cancel loop does not re-add to processedSpawns ───────────────────────────

Then(
  'after calling handleCancelDirective the cancel loop does not call processedSpawns.add for the same issue',
  function () {
    const content = sharedCtx.fileContent;
    const cancelIdx = content.indexOf('isCancelComment');
    const filterIdx = content.indexOf('filterEligibleIssues(');
    const cancelLoopRegion = content.substring(cancelIdx, filterIdx);
    assert.ok(
      !cancelLoopRegion.includes('processedSpawns.add'),
      `Cancel loop must not call processedSpawns.add in "${sharedCtx.filePath}"`,
    );
  },
);

Then(
  'the only add-to-set on the cancel path is cancelledThisCycle.add',
  function () {
    const content = sharedCtx.fileContent;
    const cancelIdx = content.indexOf('isCancelComment');
    const filterIdx = content.indexOf('filterEligibleIssues(');
    const cancelLoopRegion = content.substring(cancelIdx, filterIdx);
    assert.ok(
      cancelLoopRegion.includes('cancelledThisCycle.add'),
      `Cancel loop must call cancelledThisCycle.add in "${sharedCtx.filePath}"`,
    );
  },
);

// ── replace_clear_with_cancel_directive.feature steps (@adw-444 update) ──────

Then('issue numbers that were cancelled are added to cancelledThisCycle', function () {
  assert.ok(
    sharedCtx.fileContent.includes('cancelledThisCycle.add(issue.number)'),
    `Expected "${sharedCtx.filePath}" to add cancelled issues to cancelledThisCycle`,
  );
});

Then(
  'filterEligibleIssues skips them in the current cycle via the per-cycle skip set',
  function () {
    const content = sharedCtx.fileContent;
    const filterCallIdx = content.indexOf('filterEligibleIssues(');
    assert.ok(filterCallIdx !== -1, `Expected "${sharedCtx.filePath}" to call filterEligibleIssues`);
    const callRegion = content.substring(filterCallIdx, filterCallIdx + 400);
    assert.ok(
      callRegion.includes('cancelledThisCycle'),
      `Expected filterEligibleIssues call to pass cancelledThisCycle in "${sharedCtx.filePath}"`,
    );
  },
);

Then('cancelled issues are not added to processedSpawns', function () {
  const content = sharedCtx.fileContent;
  const cancelIdx = content.indexOf('isCancelComment');
  const filterIdx = content.indexOf('filterEligibleIssues(');
  assert.ok(cancelIdx !== -1, `Expected isCancelComment in "${sharedCtx.filePath}"`);
  assert.ok(filterIdx !== -1, `Expected filterEligibleIssues in "${sharedCtx.filePath}"`);
  const cancelLoopRegion = content.substring(cancelIdx, filterIdx);
  assert.ok(
    !cancelLoopRegion.includes('processedSpawns.add'),
    `Cancel loop must NOT call processedSpawns.add in "${sharedCtx.filePath}"`,
  );
});

Then(
  'the issue is re-evaluated on the next cron cycle because cancelledThisCycle is discarded at cycle end',
  function () {
    // cancelledThisCycle is a local const so it is garbage-collected after checkAndTrigger returns.
    const content = readFileSync(join(ROOT, 'adws/triggers/trigger_cron.ts'), 'utf-8');
    const funcIdx = content.indexOf('async function checkAndTrigger');
    assert.ok(funcIdx !== -1, 'checkAndTrigger must exist');
    const afterFunc = content.substring(funcIdx);
    assert.ok(
      afterFunc.includes('const cancelledThisCycle = new Set<number>()'),
      'cancelledThisCycle must be declared as a local const (discarded after each cycle)',
    );
    // Must NOT be at module scope
    const moduleScope = content.substring(0, funcIdx);
    assert.ok(
      !moduleScope.includes('cancelledThisCycle'),
      'cancelledThisCycle must not be at module scope',
    );
  },
);
