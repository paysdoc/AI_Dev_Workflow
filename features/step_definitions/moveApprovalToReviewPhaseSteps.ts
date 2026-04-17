import { Then } from '@cucumber/cucumber';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

/**
 * Step definitions for move_approval_to_review_phase.feature
 *
 * These steps verify that:
 * - approvePR uses the PAT-swap pattern (not delete GH_TOKEN)
 * - reviewPhase calls approvePR after review passes, non-fatally
 * - autoMergePhase reads approval state from GitHub and is silent on hitl re-entry
 */

// ── hitl early-return silent-path check ────────────────────────────────────────

Then(
  'the hitl label early-return path does not call {string}',
  function (funcName: string) {
    const content = sharedCtx.fileContent;

    // Find the hitl early-return block: locate issueHasLabel check, then find the
    // return statement that ends the early-return path.
    const hitlCheckIdx = content.indexOf('issueHasLabel');
    assert.ok(
      hitlCheckIdx !== -1,
      `Expected "${sharedCtx.filePath}" to contain "issueHasLabel" for the hitl gate`,
    );

    // Find the return statement that terminates the hitl early-return path.
    // Look for the first 'return' after the hitlCheckIdx that is inside the hitl if-block.
    const afterHitlCheck = content.indexOf('return', hitlCheckIdx);
    assert.ok(
      afterHitlCheck !== -1,
      `Expected an early-return after the hitl check in "${sharedCtx.filePath}"`,
    );

    // Extract the content from the hitl check up to and including the early return.
    // The hitl block ends at the closing brace before the next non-hitl code.
    // Find the block: from issueHasLabel to the first 'return { costUsd: 0' or similar.
    const earlyReturnEnd = content.indexOf('}', afterHitlCheck);
    const hitlBlock = content.slice(hitlCheckIdx, earlyReturnEnd + 1);

    assert.ok(
      !hitlBlock.includes(funcName),
      `Expected the hitl early-return path in "${sharedCtx.filePath}" NOT to call "${funcName}", but it was found in the hitl block`,
    );
  },
);

// ── Proximity check for non-fatal approvePR logging ────────────────────────────

Then(
  'the file contains {string} or {string} near the approvePR call',
  function (keyword1: string, keyword2: string) {
    const content = sharedCtx.fileContent;

    // Find the approvePR call
    const approvePRIdx = content.indexOf('approvePR(');
    assert.ok(
      approvePRIdx !== -1,
      `Expected "${sharedCtx.filePath}" to contain an approvePR() call`,
    );

    // Check a window of 400 chars around the approvePR call for the keywords
    const windowStart = Math.max(0, approvePRIdx - 50);
    const windowEnd = Math.min(content.length, approvePRIdx + 400);
    const window = content.slice(windowStart, windowEnd);

    const hasKeyword1 = window.includes(keyword1);
    const hasKeyword2 = window.includes(keyword2);

    assert.ok(
      hasKeyword1 || hasKeyword2,
      `Expected "${sharedCtx.filePath}" to contain "${keyword1}" or "${keyword2}" near the approvePR call`,
    );
  },
);
