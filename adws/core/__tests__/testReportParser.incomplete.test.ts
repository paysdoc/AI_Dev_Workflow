import { describe, it, expect } from 'vitest';
import { parseJUnitXml, type TestCaseResult, type TestReport } from '../testReportParser';

const MIXED_REPORT = `<?xml version="1.0"?>
<testsuite tests="6" failures="4" skipped="1">
  <testcase name="bare failure"><failure/></testcase>
  <testcase name="empty failure"><failure></failure></testcase>
  <testcase name="bare error"><error/></testcase>
  <testcase name="skipped"><skipped/></testcase>
  <testcase name="attributed failure"><failure message="boom"/></testcase>
  <testcase name="passing"/>
</testsuite>`;

function parsed(xml: string): TestReport {
  const report = parseJUnitXml(xml);
  if (report === null) throw new Error('the JUnit report did not parse');
  return report;
}

function caseNamed(name: string): TestCaseResult | undefined {
  return parsed(MIXED_REPORT).cases.find(testCase => testCase.name === name);
}

describe('parseJUnitXml — a bare marker is incomplete (cucumber undefined/pending)', () => {
  it.each(['bare failure', 'empty failure', 'bare error'])('keeps the %s case skipped and flags it as incomplete', name => {
    expect(caseNamed(name)).toMatchObject({ status: 'skipped', incomplete: true });
  });

  it.each([
    ['skipped', 'skipped'],
    ['attributed failure', 'failed'],
    ['passing', 'passed'],
  ] as const)('does not flag the %s case as incomplete', (name, status) => {
    expect(caseNamed(name)).toMatchObject({ status, incomplete: false });
  });

  it('counts only the bare-marker cases as incomplete, and still counts them as skipped', () => {
    const report = parsed(MIXED_REPORT);

    expect(report.incomplete).toBe(3);
    expect(report.skipped).toBe(4);
    expect(report.failed).toBe(1);
    expect(report.passed).toBe(1);
    expect(report.total).toBe(6);
  });

  it('counts no incomplete case in a report without a bare marker', () => {
    const report = parsed(`<?xml version="1.0"?>
<testsuite tests="2">
  <testcase name="passing"/>
  <testcase name="skipped"><skipped/></testcase>
</testsuite>`);

    expect(report.incomplete).toBe(0);
    expect(report.skipped).toBe(1);
  });
});
