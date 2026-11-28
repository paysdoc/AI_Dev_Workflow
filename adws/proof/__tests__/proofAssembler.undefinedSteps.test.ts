import { describe, it, expect } from 'vitest';
import type { TestCaseResult } from '../../core/testReportParser';
import { NOT_RUN, PER_ISSUE, REGRESSION, REGRESSION_FEATURE, assemble, indexOf, reportOf, runOf, testCase } from './proofAssembler.helpers';

const CART_FEATURE = `@adw-42
Feature: Cart

  Scenario: The cart shows the total
    Given a cart

  Scenario: The cart shows the discount
    Given a cart with a discount
`;

const SCENARIOS = indexOf(REGRESSION_FEATURE, CART_FEATURE);

/** How the reader takes cucumber's bare `<failure/>` for a scenario with an undefined or pending step. */
function incompleteCase(name: string): TestCaseResult {
  return testCase(name, [], 'skipped', true);
}

describe('assembleScenarioProof — a scenario with an undefined or pending step', () => {
  const perIssueReport = reportOf(testCase('Cart › The cart shows the total'), incompleteCase('Cart › The cart shows the discount'));

  it('fails the issue\'s tag as a blocker, and names the cause, when the run exited non-zero', () => {
    const proof = assemble({ runs: [NOT_RUN(REGRESSION), runOf(PER_ISSUE, perIssueReport, { exitCode: 1 })], scenarioIndex: SCENARIOS });

    expect(proof.tagResults[1]).toMatchObject({
      resolvedTag: '@adw-42',
      passed: false,
      skipped: false,
      warning: '1 scenario(s) have an undefined or pending step and the run exited 1: write the missing step definitions',
      counts: { total: 2, passed: 1, failed: 0 },
    });
    expect(proof.hasBlockerFailures).toBe(true);
    expect(proof.document).toContain('**Warning:** 1 scenario(s) have an undefined or pending step');
  });

  it('passes the same report when the run exited 0, as a run that is not strict does for a pending step', () => {
    const proof = assemble({ runs: [NOT_RUN(REGRESSION), runOf(PER_ISSUE, perIssueReport, { exitCode: 0 })], scenarioIndex: SCENARIOS });

    expect(proof.tagResults[1]).toMatchObject({ resolvedTag: '@adw-42', passed: true, skipped: false });
    expect(proof.tagResults[1].warning).toBeUndefined();
    expect(proof.hasBlockerFailures).toBe(false);
  });

  it('fails the regression tag as well', () => {
    const regressionRun = runOf(REGRESSION, reportOf(incompleteCase('Wish list › The wish list opens')), { exitCode: 1 });

    const proof = assemble({ runs: [regressionRun, NOT_RUN(PER_ISSUE)], scenarioIndex: SCENARIOS });

    expect(proof.tagResults[0]).toMatchObject({ resolvedTag: '@regression', passed: false, skipped: false });
    expect(proof.hasBlockerFailures).toBe(true);
  });
});
