import { describe, it, expect } from 'vitest';
import { APPLICATION_TYPE_PROFILES } from '../../core/applicationType';
import { formatPrProofComment } from '../prProofPublisher';
import { PASSED_ON_EXIT_CODE_ONLY } from '../proofDocument';
import type { TagRunRecord } from '../proofAssembler';
import {
  assemble,
  indexOf,
  NOT_RUN,
  PER_ISSUE,
  PER_ISSUE_FEATURE,
  REGRESSION,
  REGRESSION_FEATURE,
  reportOf,
  runOf,
  testCase,
} from './proofAssembler.helpers';

const COUNTS_UNAVAILABLE = '**Counts unavailable: no JUnit report at ADW_JUNIT_REPORT_PATH**';
const TABLE_HEAD = ['| Suite | Scenarios | Status | Severity |', '|-------|-----------|--------|----------|'];

function proofOf(...runs: TagRunRecord[]) {
  return assemble({
    runs,
    scenarioIndex: indexOf(REGRESSION_FEATURE, PER_ISSUE_FEATURE),
    applicationProfile: APPLICATION_TYPE_PROFILES.cli,
  });
}

type Proof = ReturnType<typeof proofOf>;

function commentOf(proof: Proof): string {
  return formatPrProofComment({ tagResults: proof.tagResults, uploaded: [], r2Configured: true });
}

function markersOf(proof: Proof): Array<boolean | undefined> {
  return proof.tagResults.map(result => result.reportMissing);
}

describe('a tag run that wrote no JUnit report', () => {
  describe('when the exit code passed it', () => {
    const proof = proofOf(runOf(REGRESSION, null, { exitCode: 0 }), runOf(PER_ISSUE, null, { exitCode: 0 }));

    it('renders "no report", the counts-unavailable tally and the warning', () => {
      expect(commentOf(proof)).toBe([
        '## :camera: BDD Proof', '', '✅ All blocker suites passed', '', COUNTS_UNAVAILABLE, '',
        ...TABLE_HEAD,
        '| `@regression` | no report | ✅ passed | blocker |',
        '| `@adw-42` | no report | ✅ passed | blocker |',
        '', `⚠️ **Warning:** \`@regression\` ${PASSED_ON_EXIT_CODE_ONLY}`,
        '', `⚠️ **Warning:** \`@adw-42\` ${PASSED_ON_EXIT_CODE_ONLY}`,
      ].join('\n'));
    });

    it('never renders "0 passed, 0 failed", nor any other tally', () => {
      const comment = commentOf(proof);

      expect(comment).not.toContain('0 passed, 0 failed');
      expect(comment).not.toMatch(/\d+ passed, \d+ failed/);
    });

    it('still passes both tags, as the exit code decided', () => {
      expect(proof.hasBlockerFailures).toBe(false);
      for (const result of proof.tagResults) {
        expect(result).toMatchObject({ passed: true, skipped: false, reportMissing: true, warning: PASSED_ON_EXIT_CODE_ONLY });
      }
    });

    it('carries the warning in the section of each tag of the scenario proof', () => {
      const issueSection = proof.document.indexOf('## @adw-42');
      const warning = `**Warning:** ${PASSED_ON_EXIT_CODE_ONLY}`;

      expect(issueSection).toBeGreaterThan(0);
      expect(proof.document.slice(0, issueSection)).toContain(warning);
      expect(proof.document.slice(issueSection)).toContain(warning);
    });

    it('words the warning as the issue does', () => {
      expect(PASSED_ON_EXIT_CODE_ONLY).toBe(
        "passed based on the exit code only; the repository's scenario runner writes no JUnit report to `ADW_JUNIT_REPORT_PATH`",
      );
    });
  });

  describe('when the exit code failed it', () => {
    const proof = proofOf(runOf(REGRESSION, null, { exitCode: 1 }), NOT_RUN(PER_ISSUE));

    it('shows "no report" and the counts-unavailable tally, leaves the skipped tag as it was, and warns of no pass', () => {
      expect(commentOf(proof)).toBe([
        '## :camera: BDD Proof', '', '❌ One or more blocker suites failed', '', COUNTS_UNAVAILABLE, '',
        ...TABLE_HEAD,
        '| `@regression` | no report | ❌ failed | blocker |',
        '| `@adw-42` | - | ⏭️ skipped | blocker |',
      ].join('\n'));
    });

    it('still fails the tag, with no warning in the scenario proof', () => {
      expect(proof.hasBlockerFailures).toBe(true);
      expect(proof.tagResults[0]).toMatchObject({ passed: false, skipped: false, reportMissing: true });
      expect(proof.tagResults[0].warning).toBeUndefined();
      expect(proof.document).not.toContain(PASSED_ON_EXIT_CODE_ONLY);
    });

    it('does not mark the tag that was not run', () => {
      expect(markersOf(proof)).toEqual([true, undefined]);
    });
  });

  it('says the counts are unavailable when only one tag wrote no report, keeps the counts of the other, and warns of that tag alone', () => {
    const proof = proofOf(
      runOf(REGRESSION, reportOf(testCase('Wish list › The wish list opens'))),
      runOf(PER_ISSUE, null, { exitCode: 0 }),
    );

    expect(commentOf(proof)).toBe([
      '## :camera: BDD Proof', '', '✅ All blocker suites passed', '', COUNTS_UNAVAILABLE, '',
      ...TABLE_HEAD,
      '| `@regression` | 1/1 | ✅ passed | blocker |',
      '| `@adw-42` | no report | ✅ passed | blocker |',
      '', `⚠️ **Warning:** \`@adw-42\` ${PASSED_ON_EXIT_CODE_ONLY}`,
    ].join('\n'));
    expect(markersOf(proof)).toEqual([undefined, true]);
  });

  it('never takes a tag that was not run for one that left no report, whatever its result says', () => {
    const comment = formatPrProofComment({
      tagResults: [{ resolvedTag: '@adw-42', severity: 'blocker', passed: true, skipped: true, reportMissing: true }],
      uploaded: [],
      r2Configured: true,
    });

    expect(comment).toBe([
      '## :camera: BDD Proof', '', '✅ All blocker suites passed', '', '**0 passed, 0 failed**', '',
      ...TABLE_HEAD,
      '| `@adw-42` | - | ⏭️ skipped | blocker |',
    ].join('\n'));
  });
});

describe('tag runs that wrote a report render exactly as before', () => {
  it('a passing pair: the summed tally and each tag\'s counts', () => {
    const proof = proofOf(
      runOf(REGRESSION, reportOf(testCase('Wish list › The wish list opens'))),
      runOf(PER_ISSUE, reportOf(testCase('Cart › The cart shows the total'))),
    );

    expect(commentOf(proof)).toBe([
      '## :camera: BDD Proof', '', '✅ All blocker suites passed', '', '**2 passed, 0 failed**', '',
      ...TABLE_HEAD,
      '| `@regression` | 1/1 | ✅ passed | blocker |',
      '| `@adw-42` | 1/1 | ✅ passed | blocker |',
    ].join('\n'));
    expect(markersOf(proof)).toEqual([undefined, undefined]);
  });

  it('a failed case beside a tag that was not run', () => {
    const failedCase = testCase('Wish list › Other', [], 'failed');
    const proof = proofOf(
      runOf(REGRESSION, reportOf(testCase('Wish list › The wish list opens'), failedCase), { exitCode: 1 }),
      NOT_RUN(PER_ISSUE),
    );

    expect(commentOf(proof)).toBe([
      '## :camera: BDD Proof', '', '❌ One or more blocker suites failed', '', '**1 passed, 1 failed**', '',
      ...TABLE_HEAD,
      '| `@regression` | 1/2 | ❌ failed | blocker |',
      '| `@adw-42` | - | ⏭️ skipped | blocker |',
    ].join('\n'));
    expect(markersOf(proof)).toEqual([undefined, undefined]);
  });

  it('a report that holds no case is a report: "-" and the tally as before, not "no report"', () => {
    const proof = proofOf(runOf(REGRESSION, reportOf()));

    expect(commentOf(proof)).toBe([
      '## :camera: BDD Proof', '', '❌ One or more blocker suites failed', '', '**0 passed, 0 failed**', '',
      ...TABLE_HEAD,
      '| `@regression` | - | ❌ failed | blocker |',
    ].join('\n'));
    expect(markersOf(proof)).toEqual([undefined]);
  });

  it('a clean report from a run that exited non-zero keeps its assembler warning out of the comment', () => {
    const proof = proofOf(runOf(REGRESSION, reportOf(testCase('Wish list › The wish list opens')), { exitCode: 1 }));
    const comment = commentOf(proof);

    expect(comment).toBe([
      '## :camera: BDD Proof', '', '✅ All blocker suites passed', '', '**1 passed, 0 failed**', '',
      ...TABLE_HEAD,
      '| `@regression` | 1/1 | ✅ passed | blocker |',
    ].join('\n'));
    expect(comment).not.toContain('Warning');
    expect(markersOf(proof)).toEqual([undefined]);
  });
});
