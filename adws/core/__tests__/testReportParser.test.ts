import { describe, it, expect } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { parseJUnitXml, readJUnitReport } from '../testReportParser';

describe('parseJUnitXml — valid mixed report', () => {
  it('resolves total/passed/failed/skipped from a bare <testsuite>', () => {
    const xml = `<?xml version="1.0"?>
<testsuite tests="3" failures="1" skipped="1">
  <testcase classname="Suite" name="pass1"/>
  <testcase classname="Suite" name="fail1"><failure message="oops"/></testcase>
  <testcase classname="Suite" name="skip1"><skipped/></testcase>
</testsuite>`;
    const report = parseJUnitXml(xml);
    expect(report).not.toBeNull();
    expect(report!.total).toBe(3);
    expect(report!.passed).toBe(1);
    expect(report!.failed).toBe(1);
    expect(report!.skipped).toBe(1);
    expect(report!.cases.find(c => c.name === 'pass1')!.status).toBe('passed');
    expect(report!.cases.find(c => c.name === 'fail1')!.status).toBe('failed');
    expect(report!.cases.find(c => c.name === 'skip1')!.status).toBe('skipped');
  });
});

describe('parseJUnitXml — all passed (cucumber shape)', () => {
  it('returns failed === 0 and total > 0', () => {
    const xml = `<?xml version="1.0"?>
<testsuite tests="2">
  <testcase name="scenario1"/>
  <testcase name="scenario2"/>
</testsuite>`;
    const report = parseJUnitXml(xml);
    expect(report).not.toBeNull();
    expect(report!.failed).toBe(0);
    expect(report!.total).toBe(2);
    expect(report!.passed).toBe(2);
  });
});

describe('parseJUnitXml — <error> counts as failed', () => {
  it('a testcase with <error> child → failed === 1', () => {
    const xml = `<?xml version="1.0"?>
<testsuite tests="1">
  <testcase name="errored"><error message="boom"/></testcase>
</testsuite>`;
    const report = parseJUnitXml(xml);
    expect(report).not.toBeNull();
    expect(report!.failed).toBe(1);
    expect(report!.cases[0].status).toBe('failed');
  });
});

describe('parseJUnitXml — zero testcases', () => {
  it('returns total 0 for a <testsuite tests="0"/>', () => {
    const xml = `<?xml version="1.0"?><testsuite tests="0"/>`;
    const report = parseJUnitXml(xml);
    expect(report).not.toBeNull();
    expect(report!.total).toBe(0);
    expect(report!.passed).toBe(0);
    expect(report!.failed).toBe(0);
  });
});

describe('parseJUnitXml — malformed input', () => {
  it('returns null for non-XML', () => {
    expect(parseJUnitXml('not xml at all {{ broken')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseJUnitXml('')).toBeNull();
  });

  it('returns null for truncated XML', () => {
    expect(parseJUnitXml('<testsuite><testcase name="x"')).toBeNull();
  });
});

describe('parseJUnitXml — <testsuites> wrapper (pytest/behave shape)', () => {
  it('sums counts across nested <testsuite> elements', () => {
    const xml = `<?xml version="1.0"?>
<testsuites>
  <testsuite name="suite1">
    <testcase name="t1"/>
    <testcase name="t2"><failure message="boom"/></testcase>
  </testsuite>
  <testsuite name="suite2">
    <testcase name="t3"/>
  </testsuite>
</testsuites>`;
    const report = parseJUnitXml(xml);
    expect(report).not.toBeNull();
    expect(report!.total).toBe(3);
    expect(report!.passed).toBe(2);
    expect(report!.failed).toBe(1);
  });
});

describe('parseJUnitXml — bare <failure/> treated as skipped (cucumber pending/undefined)', () => {
  it('classifies bare <failure/> and <failure></failure> as skipped, attributed <failure> as failed', () => {
    const xml = `<?xml version="1.0"?>
<testsuite tests="4" failures="3">
  <testcase name="bare1"><failure/></testcase>
  <testcase name="bare2"><failure></failure></testcase>
  <testcase name="bare3"><failure/></testcase>
  <testcase name="real"><failure type="AssertionError" message="boom"><![CDATA[stack trace here]]></failure></testcase>
</testsuite>`;
    const report = parseJUnitXml(xml);
    expect(report).not.toBeNull();
    expect(report!.failed).toBe(1);
    expect(report!.skipped).toBe(3);
    expect(report!.cases.find(c => c.name === 'bare1')!.status).toBe('skipped');
    expect(report!.cases.find(c => c.name === 'bare2')!.status).toBe('skipped');
    expect(report!.cases.find(c => c.name === 'bare3')!.status).toBe('skipped');
    expect(report!.cases.find(c => c.name === 'real')!.status).toBe('failed');
  });

  it('all-pending suite yields failed === 0, total > 0 (the @regression-stays-green case)', () => {
    const xml = `<?xml version="1.0"?>
<testsuite tests="2" failures="2">
  <testcase name="pending1"><failure/></testcase>
  <testcase name="pending2"><failure/></testcase>
</testsuite>`;
    const report = parseJUnitXml(xml);
    expect(report).not.toBeNull();
    expect(report!.failed).toBe(0);
    expect(report!.total).toBe(2);
    expect(report!.skipped).toBe(2);
  });
});

describe('parseJUnitXml — single testcase coercion', () => {
  it('handles a suite with exactly one <testcase> (object instead of array)', () => {
    const xml = `<?xml version="1.0"?>
<testsuite tests="1">
  <testcase name="only"/>
</testsuite>`;
    const report = parseJUnitXml(xml);
    expect(report).not.toBeNull();
    expect(report!.total).toBe(1);
    expect(report!.cases).toHaveLength(1);
    expect(report!.cases[0].name).toBe('only');
  });
});

describe('readJUnitReport', () => {
  it('returns null for a missing file path', () => {
    expect(readJUnitReport('/nonexistent/path/junit.xml')).toBeNull();
  });

  it('parses a valid JUnit XML file from disk', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'junit-test-'));
    const file = path.join(tmp, 'report.xml');
    fs.writeFileSync(file, `<?xml version="1.0"?><testsuite tests="1"><testcase name="x"/></testsuite>`, 'utf-8');
    try {
      const report = readJUnitReport(file);
      expect(report).not.toBeNull();
      expect(report!.total).toBe(1);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
