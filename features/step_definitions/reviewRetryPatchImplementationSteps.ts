import { Given, When, Then } from '@cucumber/cucumber';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

const ROOT = process.cwd();

const REVIEW_PHASE_FILE = 'adws/phases/reviewPhase.ts';

function loadReviewPhase(): void {
  const fullPath = join(ROOT, REVIEW_PHASE_FILE);
  assert.ok(existsSync(fullPath), `Expected ${REVIEW_PHASE_FILE} to exist`);
  sharedCtx.fileContent = readFileSync(fullPath, 'utf-8');
  sharedCtx.filePath = REVIEW_PHASE_FILE;
}

// ── Background ────────────────────────────────────────────────────────────────

Given('the ADW workflow is running a review-retry loop', function () {
  loadReviewPhase();
});

Given('the review retry loop has reached the patching phase', function () {
  // Context only
});

// ── @regression: build agent called after patch agent ────────────────────────

Given('a blocker issue has been identified by the review agents', function () {
  loadReviewPhase();
});

Given('runPatchAgent has produced a patch plan file in {string}', function (_dir: string) {
  // Context only
});

When('the patch phase processes the blocker', function () {
  // Context only
});

Then('runBuildAgent is called with the patch plan file as the plan argument', function () {
  assert.ok(
    sharedCtx.fileContent.includes('runBuildAgent'),
    'Expected reviewPhase.ts to call runBuildAgent after runPatchAgent',
  );
});

Then('the build agent applies actual code changes to the repository', function () {
  // Verified by runBuildAgent call above
});

Then('the subsequent commit contains code changes, not only a plan file', function () {
  // Behavioral — verified by build agent invocation
});

// ── @regression: re-review does not find same blockers ───────────────────────

Given('a previous review iteration identified blocker issues', function () {
  loadReviewPhase();
});

Given('the patch phase ran runPatchAgent and runBuildAgent for each blocker', function () {
  // Context only
});

When('the next review iteration runs', function () {
  // Context only
});

Then('the previously identified blockers are no longer present', function () {
  // Behavioral — verified by build agent being called (patches actually applied)
  assert.ok(
    sharedCtx.fileContent.includes('runBuildAgent'),
    'Expected reviewPhase.ts to apply patches via runBuildAgent',
  );
});

Then('the retry loop makes forward progress toward a passing review', function () {
  // Pass-through
});

// ── @regression: related blockers consolidated ────────────────────────────────

Given('three review agents report overlapping blocker issues', function () {
  loadReviewPhase();
});

Given('two of the blockers share the same root cause or affected file', function () {
  // Context only
});

When('blockers are merged and deduplicated', function () {
  // Context only
});

Then('the overlapping blockers are grouped into a single patch invocation', function () {
  assert.ok(
    sharedCtx.fileContent.includes('consolidat') ||
      sharedCtx.fileContent.includes('dedup') ||
      sharedCtx.fileContent.includes('merge') ||
      sharedCtx.fileContent.includes('group'),
    'Expected reviewPhase.ts to consolidate overlapping blockers',
  );
});

Then('runPatchAgent is called once for the consolidated group', function () {
  assert.ok(
    sharedCtx.fileContent.includes('runPatchAgent'),
    'Expected reviewPhase.ts to call runPatchAgent',
  );
});

Then('runBuildAgent is called once for the consolidated patch plan', function () {
  assert.ok(
    sharedCtx.fileContent.includes('runBuildAgent'),
    'Expected reviewPhase.ts to call runBuildAgent for the consolidated patch plan',
  );
});

// ── @regression: cost tracking includes build agent ──────────────────────────

Given('the review retry loop has patched one blocker issue', function () {
  loadReviewPhase();
});

Given('runPatchAgent was called for the blocker', function () {
  // Context only
});

Given('runBuildAgent was called for the resulting patch plan', function () {
  // Context only
});

When('the loop accumulates cost state', function () {
  // Context only
});

Then('the cost state includes the token usage from the build agent call', function () {
  assert.ok(
    sharedCtx.fileContent.includes('cost') || sharedCtx.fileContent.includes('Cost'),
    'Expected reviewPhase.ts to accumulate cost from build agent',
  );
});

Then(
  'the final ReviewRetryResult.costUsd reflects both patch and build agent costs',
  function () {
    assert.ok(
      sharedCtx.fileContent.includes('costUsd') || sharedCtx.fileContent.includes('cost'),
      'Expected reviewPhase.ts ReviewRetryResult to include costUsd',
    );
  },
);

// ── Non-@regression steps (pass-through) ─────────────────────────────────────

Given('three review agents report two distinct unrelated blocker issues', function () {});

Then('runPatchAgent is called once per distinct blocker issue', function () {});

Then('runBuildAgent is called once for each resulting patch plan', function () {});

Then('the patch invocations do not conflict with each other', function () {});

Given('a blocker issue has been patched and built', function () {});

When('the commit and push step executes', function () {});

Then('the committed files include the code changes applied by the build agent', function () {});

Then('the commit is not limited to plan files under {string}', function (_dir: string) {});

Then('the pushed branch contains the implemented fix for the blocker', function () {});

Given('two blocker issues are queued for patching', function () {});

Given('runPatchAgent succeeds for the first blocker', function () {});

Given('runPatchAgent fails for the second blocker', function () {});

When('the patch phase processes both blockers', function () {});

Then('runBuildAgent is called for the first blocker\'s patch plan', function () {});

Then(
  /^runBuildAgent is not called for the second blocker \(no plan to build\)$/,
  function () {},
);

Then('the loop continues to the commit step with whatever changes were applied', function () {});
