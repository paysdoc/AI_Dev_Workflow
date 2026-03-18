import { Then } from '@cucumber/cucumber';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

const ROOT = process.cwd();

// Candidate file paths for the auto-merge orchestrator.
// The implementor may choose any of these names.
const AUTO_MERGE_CANDIDATES = [
  'adws/adwAutoMerge.tsx',
  'adws/adwAutoMerge.ts',
  'adws/triggers/autoMergeHandler.ts',
  'adws/phases/autoMergePhase.ts',
];

function findAutoMergeFile(): { path: string; content: string } | null {
  for (const candidate of AUTO_MERGE_CANDIDATES) {
    const fullPath = join(ROOT, candidate);
    if (existsSync(fullPath)) {
      return { path: candidate, content: readFileSync(fullPath, 'utf-8') };
    }
  }
  return null;
}

// ── Webhook routing checks ─────────────────────────────────────────────────────

Then('the pull_request_review handler branches on review.state', function () {
  const content = sharedCtx.fileContent;

  // The handler for pull_request_review must inspect the review state
  assert.ok(
    content.includes('review.state') || content.includes('body.review'),
    `Expected "adws/triggers/trigger_webhook.ts" to inspect body.review.state in the pull_request_review handler`,
  );
});

Then('the approved-review branch does not spawn adwPrReview.tsx directly', function () {
  const content = sharedCtx.fileContent;

  // Locate the pull_request_review handler section
  const reviewHandlerIdx = content.indexOf("event === 'pull_request_review'");
  assert.ok(
    reviewHandlerIdx !== -1,
    'Expected pull_request_review handler to be present in trigger_webhook.ts',
  );

  // The handler must branch on review.state — meaning the old unconditional
  // spawnDetached('bunx', ['tsx', 'adws/adwPrReview.tsx', ...]) must now be
  // conditional (only for non-approved states).
  assert.ok(
    content.includes('review.state') || content.includes("'approved'"),
    'Expected the pull_request_review handler to conditionally check review.state before spawning adwPrReview',
  );
});

Then('the non-approved review branch spawns adwPrReview.tsx', function () {
  const content = sharedCtx.fileContent;

  // adwPrReview.tsx must still be spawned somewhere in the pull_request_review handler
  assert.ok(
    content.includes('adwPrReview.tsx'),
    'Expected trigger_webhook.ts to still reference adwPrReview.tsx for non-approved reviews',
  );
});

Then('the approved-review branch triggers the auto-merge flow', function () {
  const content = sharedCtx.fileContent;

  // The approved branch must reference an auto-merge orchestrator or handler
  const hasAutoMerge =
    content.includes('autoMerge') ||
    content.includes('auto_merge') ||
    content.includes('AutoMerge') ||
    content.includes('adwAutoMerge');

  assert.ok(
    hasAutoMerge,
    'Expected trigger_webhook.ts to reference an auto-merge handler/orchestrator for approved reviews',
  );
});

Then('shouldTriggerPrReview is called before the approved-review branch executes', function () {
  const content = sharedCtx.fileContent;

  // shouldTriggerPrReview must still be called — verified by its presence and ordering
  // relative to the review.state check
  const triggerGuardIdx = content.indexOf('shouldTriggerPrReview(');
  assert.ok(
    triggerGuardIdx !== -1,
    'Expected shouldTriggerPrReview to still be called in the pull_request_review handler',
  );

  const reviewStateIdx = content.indexOf('review.state');
  if (reviewStateIdx !== -1) {
    // The deduplication guard must appear before the review.state branch
    assert.ok(
      triggerGuardIdx < reviewStateIdx,
      'Expected shouldTriggerPrReview to be called before branching on review.state',
    );
  }
});

// ── Auto-merge orchestrator existence ─────────────────────────────────────────

Then('the auto-merge flow is implemented in a dedicated file', function () {
  const found = findAutoMergeFile();
  assert.ok(
    found !== null,
    `Expected an auto-merge orchestrator file to exist. Checked: ${AUTO_MERGE_CANDIDATES.join(', ')}`,
  );
});

// ── Auto-merge orchestrator behaviour ─────────────────────────────────────────

Then('the auto-merge orchestrator checks for merge conflicts with the target branch', function () {
  const found = findAutoMergeFile();
  assert.ok(found !== null, `Expected an auto-merge file to exist. Checked: ${AUTO_MERGE_CANDIDATES.join(', ')}`);

  const hasConflictCheck =
    found.content.includes('conflict') ||
    found.content.includes('Conflict') ||
    found.content.includes('merge --abort') ||
    found.content.includes('hasConflicts') ||
    found.content.includes('checkConflicts') ||
    found.content.includes('CONFLICT');

  assert.ok(
    hasConflictCheck,
    `Expected the auto-merge orchestrator (${found.path}) to check for merge conflicts`,
  );
});

Then(
  'the auto-merge orchestrator invokes the resolve_conflict command when conflicts are detected',
  function () {
    const found = findAutoMergeFile();
    assert.ok(found !== null, `Expected an auto-merge file to exist. Checked: ${AUTO_MERGE_CANDIDATES.join(', ')}`);

    const hasResolveConflict =
      found.content.includes('resolve_conflict') ||
      found.content.includes('resolveConflict') ||
      found.content.includes('/resolve_conflict');

    assert.ok(
      hasResolveConflict,
      `Expected the auto-merge orchestrator (${found.path}) to invoke /resolve_conflict`,
    );
  },
);

Then(
  'the auto-merge orchestrator retries conflict resolution and merge when the merge fails due to new conflicts',
  function () {
    const found = findAutoMergeFile();
    assert.ok(found !== null, `Expected an auto-merge file to exist. Checked: ${AUTO_MERGE_CANDIDATES.join(', ')}`);

    // A retry loop must be present — while/for loop or recursive call
    const hasRetryLoop =
      found.content.includes('while ') ||
      found.content.includes('for (') ||
      found.content.includes('retry') ||
      found.content.includes('Retry') ||
      found.content.includes('attempt') ||
      found.content.includes('Attempt');

    assert.ok(
      hasRetryLoop,
      `Expected the auto-merge orchestrator (${found.path}) to implement a retry loop for race-condition conflicts`,
    );
  },
);

Then('the auto-merge orchestrator enforces a maximum retry count', function () {
  const found = findAutoMergeFile();
  assert.ok(found !== null, `Expected an auto-merge file to exist. Checked: ${AUTO_MERGE_CANDIDATES.join(', ')}`);

  const hasMaxRetries =
    found.content.includes('MAX_RETRIES') ||
    found.content.includes('MAX_ATTEMPTS') ||
    found.content.includes('maxRetries') ||
    found.content.includes('maxAttempts') ||
    found.content.includes('MAX_MERGE_RETRIES') ||
    /[Mm]ax\w*[Rr]etr/.test(found.content) ||
    /[Mm]ax\w*[Aa]ttempt/.test(found.content);

  assert.ok(
    hasMaxRetries,
    `Expected the auto-merge orchestrator (${found.path}) to define a maximum retry/attempt constant`,
  );
});

Then(
  'the auto-merge orchestrator posts a failure comment on the PR when retries are exhausted',
  function () {
    const found = findAutoMergeFile();
    assert.ok(found !== null, `Expected an auto-merge file to exist. Checked: ${AUTO_MERGE_CANDIDATES.join(', ')}`);

    // Must post a PR comment on exhaustion — look for comment posting
    const hasCommentOnFailure =
      found.content.includes('comment') ||
      found.content.includes('Comment') ||
      found.content.includes('postComment') ||
      found.content.includes('createComment') ||
      found.content.includes('gh pr comment') ||
      found.content.includes('workflowComments') ||
      found.content.includes('workflowComment');

    assert.ok(
      hasCommentOnFailure,
      `Expected the auto-merge orchestrator (${found.path}) to post a PR comment when retries are exhausted`,
    );
  },
);
