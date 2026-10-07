import { describe, it, expect } from 'vitest';
import { formatWorkflowComment, formatRateLimitWaitComment } from '../workflowCommentsIssue';
import { computeTestVerdict } from '../../core/testVerdict';
import { parseWorkflowStageFromComment, isAdwComment } from '../../core/workflowCommentParsing';
import type { ReviewIssue } from '../../agents/reviewAgent';
import type { ScenarioProofResult } from '../../phases/scenarioProof';

// These tests pin the corrected
// copy and couple it back to the real verdict resolver so a future re-key of
// testVerdict's branch table fails loudly here instead of silently drifting.

const unverifiedBody = formatWorkflowComment('unverified', { issueNumber: 770, adwId: 'test-adw' });

describe('formatWorkflowComment — unverified states the real cause', () => {
  it('names the missing JUnit report, its path variable, and the Run Tests command', () => {
    expect(unverifiedBody).toContain('No JUnit Report');
    expect(unverifiedBody).toContain('$ADW_UNIT_TEST_REPORT_PATH');
    expect(unverifiedBody).toContain('## Run Tests');
  });

  it('names the testReportParser parse-failure breadcrumb, covering both ways reportPresent goes false', () => {
    expect(unverifiedBody).toContain('[testReportParser] Failed to parse');
  });
});

describe('formatWorkflowComment — unverified drops the false claims', () => {
  it('makes no zero-testcase claim, in either direction', () => {
    expect(unverifiedBody).not.toMatch(/zero testcase/i);
  });

  it('makes no dependency-detection claim', () => {
    expect(unverifiedBody).not.toMatch(/detected/i);
    expect(unverifiedBody).not.toMatch(/dependenc/i);
  });

  it('drops the stale "## Test Framework" hint', () => {
    expect(unverifiedBody).not.toContain('## Test Framework');
  });
});

describe('formatWorkflowComment — unverified stays advisory and machine-readable', () => {
  it('names the adw:unverified label and states the run was non-blocking', () => {
    expect(unverifiedBody).toContain('adw:unverified');
    expect(unverifiedBody).toMatch(/non-blocking/i);
  });

  it('preserves the ADW ID footer and bot signature', () => {
    expect(unverifiedBody).toContain('**ADW ID:** `test-adw`');
    expect(unverifiedBody).toContain('<!-- adw-bot -->');
  });
});

describe('formatWorkflowComment — unverified is coupled to the real verdict resolver', () => {
  it('the only producer of this comment (report absent -> warn) is the condition it describes; report present + zero testcases hard-fails instead and can never produce it', () => {
    const reportAbsent = computeTestVerdict({ enabled: true, reportPresent: false, hasFailures: false, testcaseCount: 0 });
    expect(reportAbsent.verdict).toBe('warn');
    expect(unverifiedBody).toContain('No JUnit Report');
    expect(unverifiedBody).not.toMatch(/zero testcase/i);

    const reportPresentZeroCases = computeTestVerdict({ enabled: true, reportPresent: true, hasFailures: false, testcaseCount: 0 });
    expect(reportPresentZeroCases.verdict).toBe('hard-fail');
  });
});

describe('formatWorkflowComment — stack_incoherent keeps its Test Framework guidance (over-reach guard)', () => {
  it('still directs the reader to confirm ## Test Framework', () => {
    const body = formatWorkflowComment('stack_incoherent', {
      issueNumber: 770,
      adwId: 'test-adw',
      coherenceWarnings: ['w'],
    });
    expect(body).toContain('## Test Framework');
    expect(body).toContain('Stack Coherence');
  });
});

describe('formatRateLimitWaitComment', () => {
  const until = new Date('2026-09-22T12:50:00.000Z');
  const body = formatRateLimitWaitComment({
    adwId: 'wait912-840',
    phaseName: 'build',
    rateLimitType: 'five_hour',
    until,
    attempt: 3,
  });

  it('carries the waiting-for-reset heading', () => {
    expect(body).toContain(':hourglass_flowing_sand: ADW Waiting for Rate Limit Reset');
  });

  it('states the wait-until time as an ISO 8601 UTC timestamp', () => {
    expect(body).toContain(until.toISOString());
    expect(body).toContain('(UTC)');
  });

  it('states the attempt number', () => {
    expect(body).toContain('**Attempt:** 3');
  });

  it('names the phase and the limit type', () => {
    expect(body).toContain('`build`');
    expect(body).toContain('`five_hour`');
  });

  it('falls back to "a rate limit" when no limit type is known', () => {
    const untyped = formatRateLimitWaitComment({ adwId: 'wait912-840', phaseName: 'build', until, attempt: 1 });
    expect(untyped).toContain('rejected by a rate limit');
    expect(untyped).not.toContain('`undefined`');
  });

  it('keeps the ADW ID footer and the bot signature', () => {
    expect(body).toContain('**ADW ID:** `wait912-840`');
    expect(body).toContain('<!-- adw-bot -->');
  });

  it('maps to no lifecycle stage, so a later resume never mistakes it for one', () => {
    expect(parseWorkflowStageFromComment(body)).toBeNull();
  });

  it('is recognised by ADW as its own comment', () => {
    expect(isAdwComment(body)).toBe(true);
  });
});

describe('formatWorkflowComment — compaction recovery comments', () => {
  const ctx = { issueNumber: 929, adwId: 'test-adw', tokenContinuationNumber: 2 };

  it.each([
    ['compaction_recovery', 'Context Compaction Recovery'],
    ['test_compaction_recovery', 'Test Compaction Recovery'],
  ] as const)('formats %s under its own heading, which reads back as that stage', (stage, heading) => {
    const body = formatWorkflowComment(stage, ctx);
    expect(body).toContain(`## :warning: ${heading}`);
    expect(body).toContain('**Continuation:** #2');
    expect(parseWorkflowStageFromComment(body)).toBe(stage);
  });
});

describe('formatWorkflowComment — review comments embed screenshot URLs', () => {
  const scenarioProof: ScenarioProofResult = {
    tagResults: [],
    hasBlockerFailures: false,
    perIssueImages: [],
    resultsFilePath: '/tmp/scenario_proof.md',
    artifactsDir: '/tmp/artifacts',
  };
  const screenshotUrls = [
    'https://screenshots.paysdoc.nl/repo/proof/adw-1/login/step-1.png',
    'https://screenshots.paysdoc.nl/repo/proof/adw-1/checkout/step-2.png',
  ];
  const blocker: ReviewIssue = {
    reviewIssueNumber: 1,
    issueDescription: 'The login form accepts an empty password',
    issueResolution: 'Reject an empty password',
    issueSeverity: 'blocker',
  };
  const ctx = { issueNumber: 937, adwId: 'adw-1' };

  describe('when a scenario proof exists', () => {
    it('embeds every URL as an image link under a Screenshots summary in a passing review', () => {
      const body = formatWorkflowComment('review_passed', { ...ctx, scenarioProof, screenshotUrls });

      expect(body).toContain('## :white_check_mark: Review Passed');
      expect(body).toContain('<summary>Screenshots (2)</summary>');
      expect(body).toContain(`[![Screenshot 1](${screenshotUrls[0]})](${screenshotUrls[0]})`);
      expect(body).toContain(`[![Screenshot 2](${screenshotUrls[1]})](${screenshotUrls[1]})`);
    });

    it('embeds every URL in a failing review and still lists the blocker', () => {
      const body = formatWorkflowComment('review_failed', {
        ...ctx,
        scenarioProof,
        screenshotUrls,
        reviewIssues: [blocker],
      });

      expect(body).toContain('## :x: Review Failed');
      expect(body).toContain(`[![Screenshot 1](${screenshotUrls[0]})](${screenshotUrls[0]})`);
      expect(body).toContain(`[![Screenshot 2](${screenshotUrls[1]})](${screenshotUrls[1]})`);
      expect(body).toContain('<summary>Blocker issues (1)</summary>');
      expect(body).toContain(blocker.issueDescription);
    });

    it.each([
      ['absent', undefined],
      ['empty', []],
    ] as const)('has no Screenshots section when screenshotUrls is %s', (_label, urls) => {
      const passed = formatWorkflowComment('review_passed', { ...ctx, scenarioProof, screenshotUrls: urls && [...urls] });
      const failed = formatWorkflowComment('review_failed', {
        ...ctx,
        scenarioProof,
        screenshotUrls: urls && [...urls],
        reviewIssues: [blocker],
      });

      expect(passed).not.toContain('Screenshots (');
      expect(failed).not.toContain('Screenshots (');
    });
  });

  describe('when there is no scenario proof', () => {
    it('still embeds the URLs in a passing review', () => {
      const body = formatWorkflowComment('review_passed', { ...ctx, screenshotUrls });

      expect(body).toContain('<summary>Screenshots (2)</summary>');
      expect(body).toContain(`[![Screenshot 1](${screenshotUrls[0]})](${screenshotUrls[0]})`);
    });

    it('still embeds the URLs in a failing review', () => {
      const body = formatWorkflowComment('review_failed', { ...ctx, screenshotUrls, reviewIssues: [blocker] });

      expect(body).toContain('<summary>Screenshots (2)</summary>');
      expect(body).toContain(`[![Screenshot 2](${screenshotUrls[1]})](${screenshotUrls[1]})`);
    });
  });

  describe('stage recovery', () => {
    it.each([
      ['review_passed', 'scenario proof'],
      ['review_failed', 'scenario proof'],
      ['review_passed', 'no scenario proof'],
      ['review_failed', 'no scenario proof'],
    ] as const)('reads %s with %s the same with screenshots as without', (stage, proof) => {
      const base = { ...ctx, ...(proof === 'scenario proof' ? { scenarioProof } : {}) };

      const withScreenshots = formatWorkflowComment(stage, { ...base, screenshotUrls });
      const withoutScreenshots = formatWorkflowComment(stage, base);

      expect(parseWorkflowStageFromComment(withScreenshots)).toBe(parseWorkflowStageFromComment(withoutScreenshots));
    });
  });
});
