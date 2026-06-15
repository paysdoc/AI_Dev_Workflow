export type TestVerdictOutcome = 'pass' | 'hard-fail' | 'warn';

export interface TestVerdictInput {
  enabled: boolean;
  hasFailures: boolean;
  testcaseCount: number;
  frameworkDetected: boolean;
}

export interface TestVerdictResult {
  verdict: TestVerdictOutcome;
  reason: string;
}

/**
 * Pure function: maps (enabled, hasFailures, testcaseCount, frameworkDetected) → verdict.
 * No I/O — directly unit-testable.
 */
export function computeTestVerdict(input: TestVerdictInput): TestVerdictResult {
  const { enabled, hasFailures, testcaseCount, frameworkDetected } = input;

  if (!enabled) {
    return { verdict: 'pass', reason: 'unit tests disabled' };
  }
  if (hasFailures) {
    return { verdict: 'hard-fail', reason: 'unit tests failed' };
  }
  if (testcaseCount > 0) {
    return { verdict: 'pass', reason: `${testcaseCount} testcases passed` };
  }
  if (frameworkDetected) {
    return { verdict: 'hard-fail', reason: 'zero testcases ran but a test framework is configured — discovery break' };
  }
  return { verdict: 'warn', reason: 'zero testcases ran and no test framework detected — marking unverified' };
}
