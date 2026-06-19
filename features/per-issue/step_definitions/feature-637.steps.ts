/**
 * BDD step definitions for feature-637.feature
 *
 * §1–§4 and §6 reuse steps from feature-636.steps.ts (cron/takeover step vocabulary
 * and the T22 type-check step). Only §5 (Phase Timeout comment body) needs new steps.
 */

import { When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import { formatWorkflowComment } from '../../../adws/github/workflowCommentsIssue.ts';

let phaseTimeoutCommentBody: string | null = null;

When('the workflow composes the Phase Timeout comment for a timed-out phase', function () {
  const ctx = {
    issueNumber: 1,
    adwId: 'tg4om4-test',
    timeoutPhaseName: 'build',
    timeoutMs: 30 * 60_000,
  };
  phaseTimeoutCommentBody = formatWorkflowComment('phase_timeout', ctx);
});

Then(
  'the Phase Timeout comment tells the reader the timed-out run will be recovered automatically on the next cron tick',
  function () {
    assert.ok(phaseTimeoutCommentBody !== null, 'Expected comment body to be set');
    const body = phaseTimeoutCommentBody.toLowerCase();
    const hasRecovery =
      body.includes('recover') ||
      body.includes('retried') ||
      body.includes('picked up') ||
      body.includes('taken over') ||
      body.includes('re-run');
    assert.ok(
      hasRecovery,
      `Expected comment to mention recovery but got:\n${phaseTimeoutCommentBody}`,
    );
    const claimsReEntry =
      body.includes('re-enter this phase') ||
      body.includes('reenter this phase');
    assert.ok(
      !claimsReEntry,
      `Expected comment NOT to promise in-place re-entry but found that claim:\n${phaseTimeoutCommentBody}`,
    );
  },
);
