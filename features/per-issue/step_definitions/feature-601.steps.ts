/**
 * BDD step definitions for feature-601.feature
 * Unit-test rail onto the JUnit report — verdict keyed on report presence,
 * discovery-break hard-fail restored.
 *
 * Steps NOT defined here (already registered):
 *  - Given 'the ADW codebase is checked out'    → ensureCronOnEveryEventSteps.ts (G18)
 *  - Then  'the ADW TypeScript type-check passes' → feature-504.steps.ts (T22)
 *
 * Novel vocabulary introduced here:
 *  - When  'a JUnit report with a passing testcase {string} and a failing testcase {string} reporting failure message {string} is parsed'
 *  - Then  "the parsed report's failed case {string} reports the failure message {string}"
 *  - Then  "the parsed report's passed case {string} reports no failure message"
 *  - Then  'the parsed report counts {int} passed and {int} failed'
 *  - When  'the unit-test verdict is resolved from a JUnit report with {int} passing and {int} failing testcases'
 *  - When  'the unit-test verdict is resolved from a JUnit report that discovered zero testcases'
 *  - When  'the unit-test verdict is resolved from an absent JUnit report'
 *  - When  'the unit-test verdict is resolved from a malformed JUnit report'
 *  - Then  'the resolved JUnit-keyed unit verdict is {string}'
 */

import { When, Then, After } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseJUnitXml, readJUnitReport } from '../../../adws/core/testReportParser.ts';
import { computeTestVerdict } from '../../../adws/core/testVerdict.ts';
import type { TestReport } from '../../../adws/core/testReportParser.ts';
import type { TestVerdictOutcome } from '../../../adws/core/testVerdict.ts';

const ctx: {
  parsedReport: TestReport | null;
  resolvedVerdict: TestVerdictOutcome | null;
  tmpDirs: string[];
} = {
  parsedReport: null,
  resolvedVerdict: null,
  tmpDirs: [],
};

After({ tags: '@adw-601' }, function () {
  for (const dir of ctx.tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  ctx.parsedReport = null;
  ctx.resolvedVerdict = null;
});

// ── §1 Parse — failure-message extension ──────────────────────────────────

When(
  'a JUnit report with a passing testcase {string} and a failing testcase {string} reporting failure message {string} is parsed',
  function (passingName: string, failingName: string, failureMessage: string) {
    const xml = [
      '<?xml version="1.0"?>',
      '<testsuite tests="2" failures="1">',
      `  <testcase classname="Suite" name="${passingName}"/>`,
      `  <testcase classname="Suite" name="${failingName}"><failure message="${failureMessage}">stack trace here</failure></testcase>`,
      '</testsuite>',
    ].join('\n');
    ctx.parsedReport = parseJUnitXml(xml);
  },
);

Then(
  "the parsed report's failed case {string} reports the failure message {string}",
  function (caseName: string, expectedMessage: string) {
    assert.ok(ctx.parsedReport !== null, 'parsedReport is null — did the When step run?');
    const tc = ctx.parsedReport.cases.find(c => c.name === caseName);
    assert.ok(tc !== undefined, `No case named "${caseName}" in the parsed report`);
    assert.strictEqual(tc.failureMessage, expectedMessage);
  },
);

Then(
  "the parsed report's passed case {string} reports no failure message",
  function (caseName: string) {
    assert.ok(ctx.parsedReport !== null, 'parsedReport is null — did the When step run?');
    const tc = ctx.parsedReport.cases.find(c => c.name === caseName);
    assert.ok(tc !== undefined, `No case named "${caseName}" in the parsed report`);
    assert.strictEqual(tc.failureMessage, undefined);
  },
);

Then(
  'the parsed report counts {int} passed and {int} failed',
  function (expectedPassed: number, expectedFailed: number) {
    assert.ok(ctx.parsedReport !== null, 'parsedReport is null — did the When step run?');
    assert.strictEqual(ctx.parsedReport.passed, expectedPassed);
    assert.strictEqual(ctx.parsedReport.failed, expectedFailed);
  },
);

// ── §2–§4 Verdict — report present ────────────────────────────────────────

function writeTempJUnit(passing: number, failing: number): string {
  const cases: string[] = [];
  for (let i = 0; i < passing; i++) {
    cases.push(`  <testcase classname="Suite" name="pass${i}"/>`);
  }
  for (let i = 0; i < failing; i++) {
    cases.push(`  <testcase classname="Suite" name="fail${i}"><failure message="oops"/></testcase>`);
  }
  const total = passing + failing;
  const xml = [
    '<?xml version="1.0"?>',
    `<testsuite tests="${total}" failures="${failing}">`,
    ...cases,
    '</testsuite>',
  ].join('\n');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'junit-601-'));
  ctx.tmpDirs.push(tmp);
  const filePath = path.join(tmp, 'junit.xml');
  fs.writeFileSync(filePath, xml, 'utf-8');
  return filePath;
}

When(
  'the unit-test verdict is resolved from a JUnit report with {int} passing and {int} failing testcases',
  function (passing: number, failing: number) {
    const reportPath = writeTempJUnit(passing, failing);
    const report = readJUnitReport(reportPath);
    const reportPresent = report !== null;
    const hasFailures = report !== null && report.failed > 0;
    const testcaseCount = report?.total ?? 0;
    const result = computeTestVerdict({ enabled: true, reportPresent, hasFailures, testcaseCount });
    ctx.resolvedVerdict = result.verdict;
  },
);

When(
  'the unit-test verdict is resolved from a JUnit report that discovered zero testcases',
  function () {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'junit-601-'));
    ctx.tmpDirs.push(tmp);
    const filePath = path.join(tmp, 'junit-zero.xml');
    fs.writeFileSync(filePath, '<?xml version="1.0"?><testsuite tests="0"/>', 'utf-8');
    const report = readJUnitReport(filePath);
    const reportPresent = report !== null;
    const hasFailures = report !== null && report.failed > 0;
    const testcaseCount = report?.total ?? 0;
    const result = computeTestVerdict({ enabled: true, reportPresent, hasFailures, testcaseCount });
    ctx.resolvedVerdict = result.verdict;
  },
);

// ── §5 Verdict — report absent ─────────────────────────────────────────────

When(
  'the unit-test verdict is resolved from an absent JUnit report',
  function () {
    const reportPath = path.join(os.tmpdir(), 'nonexistent-junit-601-absent.xml');
    const report = readJUnitReport(reportPath);
    const reportPresent = report !== null;
    const hasFailures = false;
    const testcaseCount = 0;
    const result = computeTestVerdict({ enabled: true, reportPresent, hasFailures, testcaseCount });
    ctx.resolvedVerdict = result.verdict;
  },
);

// ── §6 Verdict — malformed report ──────────────────────────────────────────

When(
  'the unit-test verdict is resolved from a malformed JUnit report',
  function () {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'junit-601-'));
    ctx.tmpDirs.push(tmp);
    const filePath = path.join(tmp, 'malformed.xml');
    fs.writeFileSync(filePath, 'NOT XML AT ALL {{ broken', 'utf-8');
    const report = readJUnitReport(filePath);
    const reportPresent = report !== null;
    const hasFailures = report !== null && report.failed > 0;
    const testcaseCount = report?.total ?? 0;
    const result = computeTestVerdict({ enabled: true, reportPresent, hasFailures, testcaseCount });
    ctx.resolvedVerdict = result.verdict;
  },
);

// ── §2–§6 Then — verdict assertion ────────────────────────────────────────

Then(
  'the resolved JUnit-keyed unit verdict is {string}',
  function (expected: string) {
    assert.ok(ctx.resolvedVerdict !== null, 'resolvedVerdict was never set — did the When step run?');
    assert.strictEqual(ctx.resolvedVerdict, expected);
  },
);
