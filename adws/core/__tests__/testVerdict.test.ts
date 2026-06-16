import { describe, it, expect } from 'vitest';
import { computeTestVerdict } from '../testVerdict';

describe('computeTestVerdict — all branches', () => {
  it('disabled → pass', () => {
    const result = computeTestVerdict({ enabled: false, hasFailures: false, testcaseCount: 0, frameworkDetected: false });
    expect(result.verdict).toBe('pass');
    expect(result.reason).toBe('unit tests disabled');
  });

  it('disabled overrides failures → pass', () => {
    const result = computeTestVerdict({ enabled: false, hasFailures: true, testcaseCount: 0, frameworkDetected: true });
    expect(result.verdict).toBe('pass');
  });

  it('enabled + failures → hard-fail', () => {
    const result = computeTestVerdict({ enabled: true, hasFailures: true, testcaseCount: 3, frameworkDetected: true });
    expect(result.verdict).toBe('hard-fail');
    expect(result.reason).toBe('unit tests failed');
  });

  it('enabled + failures + no framework → hard-fail (failures take precedence)', () => {
    const result = computeTestVerdict({ enabled: true, hasFailures: true, testcaseCount: 0, frameworkDetected: false });
    expect(result.verdict).toBe('hard-fail');
  });

  it('enabled + passing + count > 0 → pass', () => {
    const result = computeTestVerdict({ enabled: true, hasFailures: false, testcaseCount: 5, frameworkDetected: true });
    expect(result.verdict).toBe('pass');
    expect(result.reason).toBe('5 testcases passed');
  });

  it('enabled + passing + count > 0 + no framework → pass', () => {
    const result = computeTestVerdict({ enabled: true, hasFailures: false, testcaseCount: 1, frameworkDetected: false });
    expect(result.verdict).toBe('pass');
  });

  // TEMPORARY hand-relief (deadlock breaker): discovery-break demoted hard-fail → warn
  // so self-hosted runs can open PRs. A1 restores hard-fail once the verdict keys on
  // JUnit-report presence instead of the static frameworkDetected signal.
  it('enabled + count == 0 + framework detected → warn (temporary; A1 restores hard-fail)', () => {
    const result = computeTestVerdict({ enabled: true, hasFailures: false, testcaseCount: 0, frameworkDetected: true });
    expect(result.verdict).toBe('warn');
    expect(result.reason).toContain('discovery break');
  });

  it('enabled + count == 0 + no framework → warn', () => {
    const result = computeTestVerdict({ enabled: true, hasFailures: false, testcaseCount: 0, frameworkDetected: false });
    expect(result.verdict).toBe('warn');
    expect(result.reason).toBe('zero testcases ran and no test framework detected — marking unverified');
  });
});
