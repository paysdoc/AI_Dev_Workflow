import { describe, it, expect } from 'vitest';
import { formatWorkflowComment } from '../workflowCommentsIssue';
import { computeTestVerdict } from '../../core/testVerdict';

// ── formatUnverifiedComment (issue #770 — real-cause rewrite) ─────────────
//
// The comment posted when the unit-test phase resolves a `warn` verdict was
// describing a condition (report present, zero testcases) that resolves to
// `hard-fail` and never reaches this comment. These tests pin the corrected
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
