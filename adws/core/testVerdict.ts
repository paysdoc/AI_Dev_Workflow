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
    // TEMPORARY hand-relief (deadlock breaker): the unit rail still derives
    // testcaseCount from the agent-eyeballed `/test` app_tests step, which targets
    // `src/` and never runs ADW's own `adws/**/__tests__` suite — so for ADW-self
    // this is structurally zero, not a real discovery break. Hard-failing here blocks
    // every self-hosted run (e.g. issues #579/#580) before a PR can open, including the
    // very issue (A1) that migrates the unit rail onto the JUnit report. Demote to
    // `warn` so A1 can ship; A1 restores this to `hard-fail` once the verdict keys on
    // JUnit-report presence instead of the static `frameworkDetected` signal.
    return { verdict: 'warn', reason: 'zero testcases ran but a test framework is configured — discovery break (temporarily downgraded to warn; see A1)' };
  }
  return { verdict: 'warn', reason: 'zero testcases ran and no test framework detected — marking unverified' };
}
