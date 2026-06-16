export type TestVerdictOutcome = 'pass' | 'hard-fail' | 'warn';

export interface TestVerdictInput {
  enabled: boolean;
  reportPresent: boolean;
  hasFailures: boolean;
  testcaseCount: number;
}

export interface TestVerdictResult {
  verdict: TestVerdictOutcome;
  reason: string;
}

/**
 * Pure function: maps (enabled, reportPresent, hasFailures, testcaseCount) → verdict.
 * No I/O — directly unit-testable.
 *
 * Branch table (guard-clause order, max depth 2):
 *   !enabled        → pass   (unit tests disabled)
 *   !reportPresent  → warn   (no JUnit report — unverified)
 *   hasFailures     → hard-fail
 *   count === 0     → hard-fail (discovery break — report present but nothing ran)
 *   else            → pass
 */
export function computeTestVerdict(input: TestVerdictInput): TestVerdictResult {
  const { enabled, reportPresent, hasFailures, testcaseCount } = input;

  if (!enabled) {
    return { verdict: 'pass', reason: 'unit tests disabled' };
  }
  if (!reportPresent) {
    return { verdict: 'warn', reason: 'no JUnit report emitted — marking unverified' };
  }
  if (hasFailures) {
    return { verdict: 'hard-fail', reason: 'unit tests failed' };
  }
  if (testcaseCount === 0) {
    return { verdict: 'hard-fail', reason: 'zero testcases ran but a JUnit report was emitted — discovery break' };
  }
  return { verdict: 'pass', reason: `${testcaseCount} testcases passed` };
}
