import { describe, it, expect } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';
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

describe('parseJUnitXml — large report with > 1000 XML entity expansions', () => {
  it('parses without throwing when entity-expansion count exceeds 1000', () => {
    // 500 testcases × 3 XML entity refs each (&gt; &amp; &lt;) = 1500 expansions —
    // clearly exceeds 1000, tripping fast-xml-parser's maxTotalExpansions when finite.
    const cases = Array.from({ length: 500 }, (_, i) =>
      `<testcase name="a &gt; b &amp; c &lt; ${i}"/>`,
    ).join('\n');
    const xml = `<?xml version="1.0"?>\n<testsuite tests="500">\n${cases}\n</testsuite>`;
    const report = parseJUnitXml(xml);
    expect(report).not.toBeNull();
    expect(report!.total).toBe(500);
    expect(report!.failed).toBe(0);
    // Entity decoding still applied: &gt; → '>' and &amp; → '&' and &lt; → '<'
    expect(report!.cases[0].name).toBe('a > b & c < 0');
  });

  it('limit override is load-bearing — local finite-ceiling parser throws, module parser does not', () => {
    // This is the version-independent proof: explicitly setting maxTotalExpansions: 1000
    // on a local parser causes it to throw on 1500 entity refs, regardless of whether
    // the installed fast-xml-parser default is Infinity or 1000. The module's
    // parseJUnitXml does NOT throw because it pins maxTotalExpansions: Infinity.
    const cases = Array.from({ length: 500 }, (_, i) =>
      `<testcase name="a &gt; b &amp; c &lt; ${i}"/>`,
    ).join('\n');
    const xml = `<?xml version="1.0"?>\n<testsuite tests="500">\n${cases}\n</testsuite>`;

    const finiteCeilingParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      isArray: (name) => name === 'testcase' || name === 'testsuite',
      processEntities: { maxTotalExpansions: 1000 },
    });
    expect(() => finiteCeilingParser.parse(xml)).toThrow(/Entity expansion count limit exceeded/);

    // The module's parser (maxTotalExpansions: Infinity) does NOT throw on the same input
    const report = parseJUnitXml(xml);
    expect(report).not.toBeNull();
    expect(report!.total).toBe(500);
    expect(report!.failed).toBe(0);
  });

  it('parses a vitest-shaped large report (testsuites wrapper, system-out, apos/quot entities)', () => {
    // Simulate the vitest JUnit shape: <testsuites><testsuite>…</testsuite></testsuites>
    // with system-out blocks containing &apos; / &quot; — the real-world trigger.
    const cases = Array.from({ length: 350 }, (_, i) =>
      `<testcase classname="Suite" name="mod &gt; case ${i}" time="0.001">` +
      `<system-out>warn: value &apos;${i}&apos; is &quot;ok&quot; &amp; &lt;fine&gt;</system-out>` +
      `</testcase>`
    ).join('\n');
    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<testsuites tests="350">\n` +
      `<testsuite name="suite" tests="350">\n` +
      `${cases}\n` +
      `</testsuite>\n</testsuites>`;
    const report = parseJUnitXml(xml);
    expect(report).not.toBeNull();
    expect(report!.total).toBe(350);
    expect(report!.passed).toBe(350);
    expect(report!.failed).toBe(0);
    // Entity decoding preserved in testcase name
    expect(report!.cases[0].name).toBe('mod > case 0');
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

describe('parseJUnitXml — failureMessage extraction', () => {
  it('extracts failureMessage from the @_message attribute', () => {
    const xml = `<?xml version="1.0"?>
<testsuite tests="1">
  <testcase name="fails"><failure message="Expected 0 to be &gt; -1">stack here</failure></testcase>
</testsuite>`;
    const report = parseJUnitXml(xml);
    expect(report).not.toBeNull();
    const tc = report!.cases.find(c => c.name === 'fails');
    expect(tc!.status).toBe('failed');
    expect(tc!.failureMessage).toBe('Expected 0 to be > -1');
  });

  it('falls back to the text body when no @_message attribute', () => {
    const xml = `<?xml version="1.0"?>
<testsuite tests="1">
  <testcase name="fails"><failure>body only message</failure></testcase>
</testsuite>`;
    const report = parseJUnitXml(xml);
    expect(report).not.toBeNull();
    const tc = report!.cases.find(c => c.name === 'fails');
    expect(tc!.status).toBe('failed');
    expect(tc!.failureMessage).toBe('body only message');
  });

  it('extracts failureMessage from <error message="…">', () => {
    const xml = `<?xml version="1.0"?>
<testsuite tests="1">
  <testcase name="errored"><error message="boom"/></testcase>
</testsuite>`;
    const report = parseJUnitXml(xml);
    expect(report).not.toBeNull();
    const tc = report!.cases.find(c => c.name === 'errored');
    expect(tc!.status).toBe('failed');
    expect(tc!.failureMessage).toBe('boom');
  });

  it('bare <failure/> → skipped with no failureMessage', () => {
    const xml = `<?xml version="1.0"?>
<testsuite tests="1">
  <testcase name="pending"><failure/></testcase>
</testsuite>`;
    const report = parseJUnitXml(xml);
    expect(report).not.toBeNull();
    const tc = report!.cases.find(c => c.name === 'pending');
    expect(tc!.status).toBe('skipped');
    expect(tc!.failureMessage).toBeUndefined();
  });

  it('passed case has no failureMessage', () => {
    const xml = `<?xml version="1.0"?>
<testsuite tests="1">
  <testcase name="passes"/>
</testsuite>`;
    const report = parseJUnitXml(xml);
    expect(report).not.toBeNull();
    const tc = report!.cases.find(c => c.name === 'passes');
    expect(tc!.status).toBe('passed');
    expect(tc!.failureMessage).toBeUndefined();
  });

  it('multiple failed cases each carry their own message', () => {
    const xml = `<?xml version="1.0"?>
<testsuite tests="2">
  <testcase name="fail1"><failure message="msg1"/></testcase>
  <testcase name="fail2"><failure message="msg2"/></testcase>
</testsuite>`;
    const report = parseJUnitXml(xml);
    expect(report).not.toBeNull();
    expect(report!.cases.find(c => c.name === 'fail1')!.failureMessage).toBe('msg1');
    expect(report!.cases.find(c => c.name === 'fail2')!.failureMessage).toBe('msg2');
  });
});
