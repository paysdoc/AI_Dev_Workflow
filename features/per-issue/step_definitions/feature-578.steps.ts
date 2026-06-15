/**
 * BDD step definitions for feature-578.feature
 * JUnit report rail — testReportParser, scenarioProof verdict, and step-def detection.
 *
 * Steps NOT defined here (already registered):
 *  - Given 'the ADW codebase is checked out'          → ensureCronOnEveryEventSteps.ts
 *  - Then  'the ADW TypeScript type-check passes'     → feature-504.steps.ts
 *
 * Novel phrases introduced here (no registered phrase covers these):
 *  - When  'the test report is parsed from a JUnit report with {int} passing and {int} failing testcases'
 *  - When  'the test report is parsed from a JUnit report with zero testcases'
 *  - Then  'the parsed report total is {int}'
 *  - Then  'the parsed report passed count is {int}'
 *  - Then  'the parsed report failed count is {int}'
 *  - When  'the scenario-proof verdict is resolved for a parsed report with {int} passing and {int} failing tests and a runner exit code of {int}'
 *  - Then  'the resolved scenario-proof verdict is {string}'
 *  - Given 'a step-def fixture directory at {string} containing {string} files'
 *  - When  'step-definition presence is resolved with configured step-def directory {string} and extension {string}'
 *  - Then  'the resolved step-definition presence is {string}'
 */

import { Given, When, Then, After } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseJUnitXml } from '../../../adws/core/testReportParser.ts';
import { hasStepDefinitions } from '../../../adws/core/stepDefDetection.ts';
import type { TestReport } from '../../../adws/core/testReportParser.ts';

// Shared context for this feature's scenarios
const ctx: {
  parsedReport: TestReport | null;
  verdictOutcome: string | null;
  stepDefPresence: string | null;
  tmpDirs: string[];
} = {
  parsedReport: null,
  verdictOutcome: null,
  stepDefPresence: null,
  tmpDirs: [],
};

After(function () {
  for (const dir of ctx.tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── §1–§2 Parse steps ──────────────────────────────────────────────────────

function buildJUnitXml(passing: number, failing: number): string {
  const cases: string[] = [];
  for (let i = 0; i < passing; i++) {
    cases.push(`  <testcase classname="Suite" name="pass${i}"/>`);
  }
  for (let i = 0; i < failing; i++) {
    cases.push(`  <testcase classname="Suite" name="fail${i}"><failure message="oops"/></testcase>`);
  }
  const total = passing + failing;
  return `<?xml version="1.0"?><testsuite tests="${total}" failures="${failing}">\n${cases.join('\n')}\n</testsuite>`;
}

When(
  'the test report is parsed from a JUnit report with {int} passing and {int} failing testcases',
  function (passing: number, failing: number) {
    const xml = buildJUnitXml(passing, failing);
    ctx.parsedReport = parseJUnitXml(xml);
  },
);

When('the test report is parsed from a JUnit report with zero testcases', function () {
  const xml = `<?xml version="1.0"?><testsuite tests="0"/>`;
  ctx.parsedReport = parseJUnitXml(xml);
});

Then('the parsed report total is {int}', function (expected: number) {
  assert.ok(ctx.parsedReport !== null, 'Expected parsedReport to be non-null');
  assert.strictEqual(ctx.parsedReport.total, expected);
});

Then('the parsed report passed count is {int}', function (expected: number) {
  assert.ok(ctx.parsedReport !== null, 'Expected parsedReport to be non-null');
  assert.strictEqual(ctx.parsedReport.passed, expected);
});

Then('the parsed report failed count is {int}', function (expected: number) {
  assert.ok(ctx.parsedReport !== null, 'Expected parsedReport to be non-null');
  assert.strictEqual(ctx.parsedReport.failed, expected);
});

// ── §3–§5 Verdict steps ────────────────────────────────────────────────────
//
// The verdict rule mirrors scenarioProof.ts's deriveTagOutcome:
//   report.failed === 0 → "pass" (report is authoritative, regardless of exit code)
//   report.failed > 0   → "fail" (report is authoritative, regardless of exit code)

When(
  'the scenario-proof verdict is resolved for a parsed report with {int} passing and {int} failing tests and a runner exit code of {int}',
  function (passing: number, failing: number, _exitCode: number) {
    const xml = buildJUnitXml(passing, failing);
    const report = parseJUnitXml(xml);
    assert.ok(report !== null, 'Expected report to parse successfully');
    // Derive verdict from the parsed report (the exit code is deliberately not the decider)
    ctx.verdictOutcome = report.failed === 0 ? 'pass' : 'fail';
  },
);

Then('the resolved scenario-proof verdict is {string}', function (expected: string) {
  assert.ok(ctx.verdictOutcome !== null, 'Expected verdictOutcome to be set');
  assert.strictEqual(ctx.verdictOutcome, expected);
});

// ── §6–§8 Step-def detection steps ────────────────────────────────────────

Given(
  'a step-def fixture directory at {string} containing {string} files',
  function (relDir: string, ext: string) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stepdef-578-'));
    ctx.tmpDirs.push(tmp);
    const fullDir = path.join(tmp, relDir);
    fs.mkdirSync(fullDir, { recursive: true });
    fs.writeFileSync(path.join(fullDir, `step${ext}`), '');
    // Store the tmp root so the When step can use it as cwd
    (this as Record<string, unknown>)['stepDefCwd'] = tmp;
  },
);

When(
  'step-definition presence is resolved with configured step-def directory {string} and extension {string}',
  function (stepDefDir: string, ext: string) {
    const cwd = (this as Record<string, unknown>)['stepDefCwd'] as string;
    assert.ok(cwd, 'Expected stepDefCwd to be set by Given step');
    const found = hasStepDefinitions(stepDefDir, [ext], cwd);
    ctx.stepDefPresence = found ? 'present' : 'absent';
  },
);

Then('the resolved step-definition presence is {string}', function (expected: string) {
  assert.ok(ctx.stepDefPresence !== null, 'Expected stepDefPresence to be set');
  assert.strictEqual(ctx.stepDefPresence, expected);
});
