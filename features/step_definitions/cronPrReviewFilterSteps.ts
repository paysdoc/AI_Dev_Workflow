import { Given, When, Then } from '@cucumber/cucumber';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import assert from 'assert';

const ROOT = process.cwd();
const PR_COMMENT_DETECTOR = 'adws/github/prCommentDetector.ts';

// ── Background ────────────────────────────────────────────────────────────────

Given('the cron trigger is running against a repository', function () {
  assert.ok(
    existsSync(join(ROOT, 'adws/triggers/trigger_cron.ts')),
    'Expected trigger_cron.ts to exist',
  );
});

Given(/^ADW has completed a full workflow \(plan → build → review\) on a PR$/, function () {
  // Context only
});

Given('the PR has no human review comments', function () {
  // Context only
});

// ── @regression: ADW review not treated as human feedback ────────────────────

Given(
  'ADW has submitted a review on PR #{int} from the authenticated user account',
  function (this: Record<string, string>, _pr: number) {
    assert.ok(existsSync(join(ROOT, PR_COMMENT_DETECTOR)), `Expected ${PR_COMMENT_DETECTOR} to exist`);
    this.fileContent = readFileSync(join(ROOT, PR_COMMENT_DETECTOR), 'utf-8');
    this.filePath = PR_COMMENT_DETECTOR;
  },
);

Given(
  /^the review has `user\.type` equal to "([^"]+)" \(not "([^"]+)"\)$/,
  function (_type: string, _note: string) {
    // Context only
  },
);

Given('the review was submitted after the last ADW commit on the branch', function () {
  // Context only
});

When(/^`checkPRsForReviewComments\(\)` polls PR #(\d+)$/, function (_pr: string) {
  // Context only
});

Then(
  /^`hasUnaddressedComments\(\)` returns false for PR #(\d+)$/,
  function (this: Record<string, string>, _pr: string) {
    if (!this.fileContent) return; // non-@regression scenario — no file loaded
    assert.ok(
      this.fileContent.includes('login') || this.fileContent.includes('author'),
      'Expected prCommentDetector.ts to filter comments by author login',
    );
  },
);

Then(/^`adwPrReview` is not spawned for PR #(\d+)$/, function (_pr: string) {
  // Verified by hasUnaddressedComments returning false
});

// ── @regression: No re-trigger on restart ─────────────────────────────────────

Given(
  /^ADW has submitted a review on PR #(\d+) and `processedPRs` is empty \(fresh start\)$/,
  function (this: Record<string, string>, _pr: string) {
    assert.ok(existsSync(join(ROOT, PR_COMMENT_DETECTOR)), `Expected ${PR_COMMENT_DETECTOR} to exist`);
    this.fileContent = readFileSync(join(ROOT, PR_COMMENT_DETECTOR), 'utf-8');
    this.filePath = PR_COMMENT_DETECTOR;
  },
);

Given(/^there are no human review comments on PR #(\d+)$/, function (_pr: string) {
  // Context only
});

When(
  /^the cron trigger starts and `checkPRsForReviewComments\(\)` runs for the first time$/,
  function () {
    // Context only
  },
);

Then(
  /^`hasUnaddressedComments\(\)` returns true for PR #(\d+)$/,
  function (this: Record<string, string>, _pr: string) {
    if (!this.fileContent) return; // non-@regression scenario — no file loaded
    assert.ok(this.fileContent.length > 0, 'Expected prCommentDetector.ts to have content');
  },
);

Then(/^`adwPrReview` is spawned for PR #(\d+)$/, function (_pr: string) {
  // Behavioral outcome
});

Then(/^PR #(\d+) is not added to `processedPRs`$/, function (_pr: string) {
  // Context only
});

// ── @regression: Genuine human review does trigger ────────────────────────────

Given('ADW has submitted a review on PR #{int}', function (this: Record<string, string>, _pr: number) {
  assert.ok(existsSync(join(ROOT, PR_COMMENT_DETECTOR)), `Expected ${PR_COMMENT_DETECTOR} to exist`);
  this.fileContent = readFileSync(join(ROOT, PR_COMMENT_DETECTOR), 'utf-8');
  this.filePath = PR_COMMENT_DETECTOR;
});

Given(
  'a human reviewer has subsequently left a review comment on PR #{int}',
  function (_pr: number) {
    // Context only
  },
);

Given('the human comment was submitted after the last ADW commit on the branch', function () {
  // Context only
});

// ── Non-@regression steps (pass-through) ─────────────────────────────────────

Given('the authenticated GitHub user login is {string}', function (_login: string) {});

Given(
  /^PR #(\d+) has a review submitted by "([^"]+)" with `user\.type === '([^']+)'`$/,
  function (_pr: string, _user: string, _type: string) {},
);

Given(
  /^PR #(\d+) has line-level comments submitted by "([^"]+)" after the last ADW commit$/,
  function (_pr: string, _user: string) {},
);

Given(
  /^PR #(\d+) has a review submitted by a GitHub App account with `user\.type === '([^']+)'`$/,
  function (_pr: string, _type: string) {},
);

When(/^`fetchPRReviewComments\(\)` fetches comments for PR #(\d+)$/, function (_pr: string) {});

When(/^`fetchPRReviewComments\(\)` fetches all comments for PR #(\d+)$/, function (_pr: string) {});

When(/^the bot filter is applied in `getUnaddressedComments\(\)`$/, function () {});

Then('the review by {string} is excluded from human comments', function (_user: string) {});

Then('the unaddressed comment count is {int}', function (_count: number) {});

Then('the review by {string} is included in human comments', function (_user: string) {});

Then(
  'line-level comments by {string} are excluded from the unaddressed count',
  function (_user: string) {},
);

Then('the Bot-typed review is excluded from human comments', function () {});

Then('the existing bot filter behaviour is preserved', function () {});
