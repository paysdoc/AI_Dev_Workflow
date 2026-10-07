import { describe, it, expect } from 'vitest';
import { parseJUnitXml } from '../testReportParser';

describe('parseJUnitXml — attachments listed in <system-out>', () => {
  // Playwright's junit reporter: each attachment is a "[[ATTACHMENT|<path>]]" line, relative to the report's directory.
  const playwrightReport = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites id="" name="" tests="3" failures="1" skipped="0" errors="0" time="1.2">
<testsuite name="per-issue/feature-1.feature.spec.js" timestamp="2026-10-07T00:00:00.000Z" hostname="chromium" tests="3" failures="1" skipped="0" time="1.1" errors="0">
<testcase name="Checkout › Pay" classname="per-issue/feature-1.feature.spec.js" time="0.5">
<system-out>
<![CDATA[
[[ATTACHMENT|artifacts/adw-1/pay-chromium/test-finished-1.png]]

[[ATTACHMENT|artifacts/adw-1/pay-chromium/trace.zip]]
]]>
</system-out>
</testcase>
<testcase name="Checkout › Pay &amp; &lt;confirm&gt;" classname="per-issue/feature-1.feature.spec.js" time="0.4">
<failure message="expect(locator).toBeVisible()" type="FAILURE">
<![CDATA[Error: expected the page to show the receipt]]>
</failure>
<system-out>
<![CDATA[
[[ATTACHMENT|artifacts/adw-1/confirm-chromium/test-failed-1.png]]
]]>
</system-out>
</testcase>
<testcase name="Checkout › Refund" classname="per-issue/feature-1.feature.spec.js" time="0.2"/>
</testsuite>
</testsuites>`;

  it('lists the paths of a case in the order the report gives them', () => {
    const report = parseJUnitXml(playwrightReport);

    expect(report!.cases[0].attachments).toEqual([
      'artifacts/adw-1/pay-chromium/test-finished-1.png',
      'artifacts/adw-1/pay-chromium/trace.zip',
    ]);
  });

  it('decodes the entities of the name, which the attachments never share', () => {
    const report = parseJUnitXml(playwrightReport);

    expect(report!.cases.map(c => c.name)).toEqual(['Checkout › Pay', 'Checkout › Pay & <confirm>', 'Checkout › Refund']);
  });

  it('keeps the attachments of a failed case beside its status', () => {
    const failed = parseJUnitXml(playwrightReport)!.cases[1];

    expect(failed.status).toBe('failed');
    expect(failed.attachments).toEqual(['artifacts/adw-1/confirm-chromium/test-failed-1.png']);
  });

  it('gives a case without <system-out> no attachments', () => {
    expect(parseJUnitXml(playwrightReport)!.cases[2].attachments).toEqual([]);
  });

  it('gives a case whose <system-out> names no attachment none, as vitest and cucumber write it', () => {
    const xml = `<?xml version="1.0"?>
<testsuites><testsuite name="suite"><testcase name="t" classname="Suite"><system-out>warn: value &apos;1&apos; is &quot;ok&quot;</system-out></testcase></testsuite></testsuites>`;

    expect(parseJUnitXml(xml)!.cases[0].attachments).toEqual([]);
  });

  it('reads a path that holds spaces whole', () => {
    const xml = `<testsuite><testcase name="t"><system-out>[[ATTACHMENT|artifacts/adw-1/the cart-chromium/test-finished-1.png]]</system-out></testcase></testsuite>`;

    expect(parseJUnitXml(xml)!.cases[0].attachments).toEqual(['artifacts/adw-1/the cart-chromium/test-finished-1.png']);
  });

  it('reads the attachments of every <system-out> a case repeats', () => {
    const xml = `<testsuite><testcase name="t"><system-out>[[ATTACHMENT|a.png]]</system-out><system-out>[[ATTACHMENT|b.png]]</system-out></testcase></testsuite>`;

    expect(parseJUnitXml(xml)!.cases[0].attachments).toEqual(['a.png', 'b.png']);
  });
});
