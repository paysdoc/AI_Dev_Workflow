import { describe, it, expect } from 'vitest';
import { computeTestVerdict } from '../testVerdict';

describe('computeTestVerdict — disabled gate', () => {
  it('disabled → pass', () => {
    const result = computeTestVerdict({ enabled: false, reportPresent: false, hasFailures: false, testcaseCount: 0 });
    expect(result.verdict).toBe('pass');
    expect(result.reason).toBe('unit tests disabled');
  });

  it('disabled overrides failures → pass', () => {
    const result = computeTestVerdict({ enabled: false, reportPresent: true, hasFailures: true, testcaseCount: 3 });
    expect(result.verdict).toBe('pass');
    expect(result.reason).toBe('unit tests disabled');
  });
});

describe('computeTestVerdict — report absent → unverified', () => {
  it('no JUnit report → warn', () => {
    const result = computeTestVerdict({ enabled: true, reportPresent: false, hasFailures: false, testcaseCount: 0 });
    expect(result.verdict).toBe('warn');
    expect(result.reason).toContain('no JUnit report');
  });
});

describe('computeTestVerdict — report present, failures → hard-fail', () => {
  it('enabled + failures → hard-fail', () => {
    const result = computeTestVerdict({ enabled: true, reportPresent: true, hasFailures: true, testcaseCount: 3 });
    expect(result.verdict).toBe('hard-fail');
    expect(result.reason).toBe('unit tests failed');
  });

  it('failures take precedence over zero-testcase → hard-fail', () => {
    const result = computeTestVerdict({ enabled: true, reportPresent: true, hasFailures: true, testcaseCount: 0 });
    expect(result.verdict).toBe('hard-fail');
  });
});

describe('computeTestVerdict — report present, zero testcases → hard-fail (discovery break restored)', () => {
  it('report present + zero testcases → hard-fail', () => {
    const result = computeTestVerdict({ enabled: true, reportPresent: true, hasFailures: false, testcaseCount: 0 });
    expect(result.verdict).toBe('hard-fail');
    expect(result.reason).toContain('discovery break');
  });
});

describe('computeTestVerdict — report present, count > 0, no failures → pass', () => {
  it('enabled + passing + count > 0 → pass', () => {
    const result = computeTestVerdict({ enabled: true, reportPresent: true, hasFailures: false, testcaseCount: 5 });
    expect(result.verdict).toBe('pass');
    expect(result.reason).toBe('5 testcases passed');
  });

  it('single passing testcase → pass', () => {
    const result = computeTestVerdict({ enabled: true, reportPresent: true, hasFailures: false, testcaseCount: 1 });
    expect(result.verdict).toBe('pass');
    expect(result.reason).toBe('1 testcases passed');
  });
});
