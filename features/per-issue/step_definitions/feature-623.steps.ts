/**
 * BDD step definitions for feature-623.feature
 * Large green JUnit reports falsely marked adw:unverified (entity-expansion limit)
 *
 * Steps NOT defined here (already registered):
 *  - Given 'the ADW codebase is checked out'      → ensureCronOnEveryEventSteps.ts (G18)
 *  - Then  'the ADW TypeScript type-check passes'  → feature-504.steps.ts (T22)
 */

import { Given, When, Then, After } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseJUnitXml, readJUnitReport } from '../../../adws/core/testReportParser.ts';
import { computeTestVerdict } from '../../../adws/core/testVerdict.ts';
import type { TestReport, TestCaseResult } from '../../../adws/core/testReportParser.ts';
import type { TestVerdictOutcome } from '../../../adws/core/testVerdict.ts';

const ctx: {
  parsedReport: TestReport | null;
  focusedCase: TestCaseResult | null;
  resolvedVerdict: TestVerdictOutcome | null;
  unitTestReportPath: string | null;
  tmpDirs: string[];
} = {
  parsedReport: null,
  focusedCase: null,
  resolvedVerdict: null,
  unitTestReportPath: null,
  tmpDirs: [],
};

After({ tags: '@adw-623' }, function () {
  for (const dir of ctx.tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  ctx.parsedReport = null;
  ctx.focusedCase = null;
  ctx.resolvedVerdict = null;
  ctx.unitTestReportPath = null;
});

// 3 entity refs per testcase (&gt; &amp; &lt;): count × 3 total entity refs > 1000 for count >= 334
function buildLargeGreenXml(count: number): string {
  const cases = Array.from({ length: count }, (_, i) =>
    `  <testcase classname="Suite" name="test &gt; case &amp; ${i} &lt; end"/>`,
  ).join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<testsuites>',
    `  <testsuite name="suite" tests="${count}">`,
    cases,
    '  </testsuite>',
    '</testsuites>',
  ].join('\n');
}

// ── §1 and §2 Given — emit / suppress the report ─────────────────────────────

Given(
  'a large all-green JUnit report of {int} testcases carrying more than 1000 XML entity references is emitted to the unit-test report path',
  function (count: number) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'junit-623-'));
    ctx.tmpDirs.push(tmp);
    const filePath = path.join(tmp, 'junit.xml');
    fs.writeFileSync(filePath, buildLargeGreenXml(count), 'utf-8');
    ctx.unitTestReportPath = filePath;
  },
);

Given('no report is emitted to the unit-test report path', function () {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'junit-623-'));
  ctx.tmpDirs.push(tmp);
  // Point to a nonexistent file — readJUnitReport returns null for absent paths
  ctx.unitTestReportPath = path.join(tmp, 'nonexistent-junit.xml');
});

// ── §1 When/Then — parse via readJUnitReport ─────────────────────────────────

When('the report at the unit-test report path is read', function () {
  assert.ok(ctx.unitTestReportPath !== null, 'unitTestReportPath was never set — did the Given step run?');
  ctx.parsedReport = readJUnitReport(ctx.unitTestReportPath);
});

Then('a non-null test report is returned', function () {
  assert.ok(ctx.parsedReport !== null, 'Expected a non-null TestReport, but got null');
});

Then('no test report is returned', function () {
  assert.strictEqual(ctx.parsedReport, null, 'Expected null (no report), but got a non-null report');
});

Then(
  'the test report counts {int} total, {int} passed, {int} failed, and {int} skipped testcases',
  function (total: number, passed: number, failed: number, skipped: number) {
    assert.ok(ctx.parsedReport !== null, 'parsedReport is null — did the When step produce a report?');
    assert.strictEqual(ctx.parsedReport.total, total, `total mismatch: expected ${total}, got ${ctx.parsedReport.total}`);
    assert.strictEqual(ctx.parsedReport.passed, passed, `passed mismatch: expected ${passed}, got ${ctx.parsedReport.passed}`);
    assert.strictEqual(ctx.parsedReport.failed, failed, `failed mismatch: expected ${failed}, got ${ctx.parsedReport.failed}`);
    assert.strictEqual(ctx.parsedReport.skipped, skipped, `skipped mismatch: expected ${skipped}, got ${ctx.parsedReport.skipped}`);
  },
);

// ── §2 When/Then — verdict via computeTestVerdict ───────────────────────────

When('the unit-test verdict is computed from the report at the unit-test report path', function () {
  assert.ok(ctx.unitTestReportPath !== null, 'unitTestReportPath was never set — did the Given step run?');
  // Mirror exactly how testRetry.ts derives reportPresent/hasFailures/testcaseCount
  const report = readJUnitReport(ctx.unitTestReportPath);
  ctx.parsedReport = report;
  const reportPresent = report !== null;
  const hasFailures = report !== null && report.failed > 0;
  const testcaseCount = report?.total ?? 0;
  const result = computeTestVerdict({ enabled: true, reportPresent, hasFailures, testcaseCount });
  ctx.resolvedVerdict = result.verdict;
});

Then('the resolved unit verdict is {string}', function (expected: string) {
  assert.ok(ctx.resolvedVerdict !== null, 'resolvedVerdict was never set — did the When step run?');
  assert.strictEqual(ctx.resolvedVerdict, expected);
});

Then('the unit suite is not marked unverified', function () {
  assert.notStrictEqual(ctx.resolvedVerdict, 'warn', `Expected verdict not to be "warn" (unverified), but it was`);
});

Then('the unit suite is marked unverified', function () {
  assert.strictEqual(ctx.resolvedVerdict, 'warn', `Expected verdict "warn" (unverified), but got "${ctx.resolvedVerdict}"`);
});

// ── §3 When/Then — preserved parse behaviour (direct parseJUnitXml calls) ───

When(
  'a JUnit report whose failing case carries the encoded failure message {string} is parsed',
  function (encodedMessage: string) {
    // encodedMessage arrives with XML entities intact (e.g. "&gt;") — embed as-is
    // so fast-xml-parser decodes them to their character values.
    const xml = [
      '<?xml version="1.0"?>',
      '<testsuite tests="1" failures="1">',
      `  <testcase name="fails"><failure message="${encodedMessage}">stack trace</failure></testcase>`,
      '</testsuite>',
    ].join('\n');
    ctx.parsedReport = parseJUnitXml(xml);
    ctx.focusedCase = ctx.parsedReport?.cases.find(c => c.status === 'failed') ?? null;
  },
);

Then('the parsed failing case decodes its failure message to {string}', function (expected: string) {
  assert.ok(ctx.focusedCase !== null, 'No failed case found in the parsed report');
  assert.strictEqual(ctx.focusedCase.failureMessage, expected);
});

When('a JUnit report whose only testcase carries a bare empty failure marker is parsed', function () {
  const xml = [
    '<?xml version="1.0"?>',
    '<testsuite tests="1" failures="1">',
    '  <testcase name="pending"><failure/></testcase>',
    '</testsuite>',
  ].join('\n');
  ctx.parsedReport = parseJUnitXml(xml);
  ctx.focusedCase = ctx.parsedReport?.cases[0] ?? null;
});

Then('that testcase is classified as skipped', function () {
  assert.ok(ctx.focusedCase !== null, 'focusedCase was not set');
  assert.strictEqual(ctx.focusedCase.status, 'skipped', `Expected "skipped", but got "${ctx.focusedCase.status}"`);
});

When(
  'a JUnit report in the {string} shape of {int} all-passing testcases is parsed',
  function (shape: string, count: number) {
    const cases = Array.from({ length: count }, (_, i) =>
      `  <testcase classname="Suite" name="test${i}"/>`,
    ).join('\n');
    const xml =
      shape === 'testsuites'
        ? ['<?xml version="1.0"?>', '<testsuites>', `  <testsuite name="suite" tests="${count}">`, cases, '  </testsuite>', '</testsuites>'].join('\n')
        : ['<?xml version="1.0"?>', `<testsuite tests="${count}">`, cases, '</testsuite>'].join('\n');
    ctx.parsedReport = parseJUnitXml(xml);
  },
);

When('malformed JUnit XML that is {string} is parsed', function (kind: string) {
  const xmlByKind: Record<string, string> = {
    'not XML at all': 'not xml at all {{ broken',
    'truncated mid-element': '<testsuite><testcase name="x"',
    'an empty document': '',
  };
  ctx.parsedReport = parseJUnitXml(xmlByKind[kind] ?? kind);
});
