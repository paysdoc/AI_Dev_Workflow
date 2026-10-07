import { describe, it, expect } from 'vitest';
import { parseJUnitXml } from '../../core/testReportParser';
import { NOT_RUN, PER_ISSUE, REGRESSION, PER_ISSUE_FEATURE, artifact, assemble, attachment, indexOf, reportOf, runOf, testCase } from './proofAssembler.helpers';

describe('assembleScenarioProof — tags per scenario, from the feature files', () => {
  it('takes one image per scenario that carries the tag on its own, as the Feature does not', () => {
    const feature = `Feature: Cart

  @adw-42
  Scenario: The cart shows the total
    Given a cart

  @regression
  Scenario: The cart page loads
    Given a cart
`;
    const perIssueRun = runOf(PER_ISSUE, reportOf(
      testCase('Cart › The cart shows the total', [attachment('adw-42/total/a.png')]),
      testCase('Cart › The cart page loads', [attachment('adw-42/page/a.png')]),
    ));

    const proof = assemble({
      runs: [NOT_RUN(REGRESSION), perIssueRun],
      scenarioIndex: indexOf(feature),
      artifacts: [artifact('adw-42/total/a.png'), artifact('adw-42/page/a.png')],
    });

    expect(proof.perIssueImages.map(image => image.scenario)).toEqual(['Cart › The cart shows the total']);
  });

  it('takes the image of a scenario that carries both tags once, from the issue\'s run', () => {
    const feature = `Feature: Cart

  @adw-42 @regression
  Scenario: The cart shows the total
    Given a cart
`;
    const regressionRun = runOf(REGRESSION, reportOf(testCase('Cart › The cart shows the total', [attachment('regression/total/a.png')])));
    const perIssueRun = runOf(PER_ISSUE, reportOf(testCase('Cart › The cart shows the total', [attachment('adw-42/total/a.png')])));

    const proof = assemble({
      runs: [regressionRun, perIssueRun],
      scenarioIndex: indexOf(feature),
      artifacts: [artifact('regression/total/a.png'), artifact('adw-42/total/a.png')],
    });

    expect(proof.perIssueImages.map(image => image.relPath)).toEqual(['adw-42/total/a.png']);
  });

  it('leaves out a title that two scenarios share when their tags differ, and takes it when they agree', () => {
    const differing = indexOf(
      '@adw-42\nFeature: Cart\n\n  Scenario: Opens\n    Given a cart\n',
      '@regression\nFeature: Cart\n\n  Scenario: Opens\n    Given a cart\n',
    );
    const agreeing = indexOf(
      '@adw-42\nFeature: Cart\n\n  Scenario: Opens\n    Given a cart\n',
      '@adw-42\nFeature: Cart\n\n  Scenario: Opens\n    Given a cart\n',
    );
    const perIssueRun = runOf(PER_ISSUE, reportOf(testCase('Cart › Opens', [attachment('adw-42/opens/a.png')])));
    const artifacts = [artifact('adw-42/opens/a.png')];

    expect(assemble({ runs: [NOT_RUN(REGRESSION), perIssueRun], scenarioIndex: differing, artifacts }).perIssueImages).toEqual([]);
    expect(assemble({ runs: [NOT_RUN(REGRESSION), perIssueRun], scenarioIndex: agreeing, artifacts }).perIssueImages).toHaveLength(1);
  });

  it('tells scenarios of one name apart by their Feature', () => {
    const wish = '@adw-42\nFeature: Wish list\n\n  Scenario: The page shows the saved products\n    Given a list\n';
    const cart = 'Feature: Cart\n\n  @regression\n  Scenario: The page shows the saved products\n    Given a cart\n';
    const perIssueRun = runOf(PER_ISSUE, reportOf(
      testCase('Wish list › The page shows the saved products', [attachment('adw-42/wish/a.png')]),
      testCase('Cart › The page shows the saved products', [attachment('adw-42/cart/a.png')]),
    ));

    const proof = assemble({
      runs: [NOT_RUN(REGRESSION), perIssueRun],
      scenarioIndex: indexOf(wish, cart),
      artifacts: [artifact('adw-42/wish/a.png'), artifact('adw-42/cart/a.png')],
    });

    expect(proof.perIssueImages.map(image => image.relPath)).toEqual(['adw-42/wish/a.png']);
  });

  it('leaves out an image whose test case no scenario of the feature files has, and names the case in the proof', () => {
    const perIssueRun = runOf(PER_ISSUE, reportOf(
      testCase('Cart › The cart shows the total', [attachment('adw-42/total/a.png')]),
      testCase('Cart › A scenario named by some other runner', [attachment('adw-42/other/a.png')]),
      testCase('Cart › Another unknown one without an image'),
    ));

    const proof = assemble({
      runs: [NOT_RUN(REGRESSION), perIssueRun],
      scenarioIndex: indexOf(PER_ISSUE_FEATURE),
      artifacts: [artifact('adw-42/total/a.png'), artifact('adw-42/other/a.png')],
    });

    expect(proof.perIssueImages.map(image => image.relPath)).toEqual(['adw-42/total/a.png']);
    expect(proof.document).toContain('Left out, because no scenario in the feature files has their name: `Cart › A scenario named by some other runner`');
    expect(proof.document).not.toContain('Another unknown one without an image');
  });

  it('says nothing is left out when every case with an image is attributed', () => {
    const perIssueRun = runOf(PER_ISSUE, reportOf(testCase('Cart › The cart shows the total', [attachment('adw-42/total/a.png')])));

    const proof = assemble({
      runs: [NOT_RUN(REGRESSION), perIssueRun],
      scenarioIndex: indexOf(PER_ISSUE_FEATURE),
      artifacts: [artifact('adw-42/total/a.png')],
    });

    expect(proof.document).not.toContain('Left out');
  });
});

describe('assembleScenarioProof — the rows of a Scenario Outline', () => {
  const products = `@adw-42
Feature: Product pages

  Scenario Outline: The <product> page shows its price
    When the shopper opens the page of the <product>

    Examples:
      | product |
      | lamp    |
      | chair   |
      | table   |
`;

  it('selects the image of each row, in the order of the report', () => {
    const perIssueRun = runOf(PER_ISSUE, reportOf(
      testCase('Product pages › The <product> page shows its price › The lamp page shows its price', [attachment('adw-42/lamp/a.png')]),
      testCase('Product pages › The <product> page shows its price › The chair page shows its price', [attachment('adw-42/chair/a.png')]),
      testCase('Product pages › The <product> page shows its price › The table page shows its price', [attachment('adw-42/table/a.png')]),
    ));

    const proof = assemble({
      runs: [NOT_RUN(REGRESSION), perIssueRun],
      scenarioIndex: indexOf(products),
      artifacts: [artifact('adw-42/lamp/a.png'), artifact('adw-42/chair/a.png'), artifact('adw-42/table/a.png')],
    });

    expect(proof.perIssueImages.map(image => image.relPath)).toEqual(['adw-42/lamp/a.png', 'adw-42/chair/a.png', 'adw-42/table/a.png']);
  });

  it('selects the rows of the Examples table that carries the tag, though the run also lists a row of the one that does not', () => {
    const split = `Feature: Product pages

  Scenario Outline: The <product> page shows its price
    When the shopper opens the page of the <product>

    @adw-42
    Examples: Added by this issue
      | product |
      | lamp    |
      | chair   |

    @regression
    Examples: Already covered
      | product |
      | table   |
`;
    const perIssueRun = runOf(PER_ISSUE, reportOf(
      testCase('Product pages › The <product> page shows its price › The lamp page shows its price', [attachment('adw-42/lamp/a.png')]),
      testCase('Product pages › The <product> page shows its price › The chair page shows its price', [attachment('adw-42/chair/a.png')]),
      testCase('Product pages › The <product> page shows its price › The table page shows its price', [attachment('adw-42/table/a.png')]),
    ));

    const proof = assemble({
      runs: [NOT_RUN(REGRESSION), perIssueRun],
      scenarioIndex: indexOf(split),
      artifacts: [artifact('adw-42/lamp/a.png'), artifact('adw-42/chair/a.png'), artifact('adw-42/table/a.png')],
    });

    expect(proof.perIssueImages.map(image => image.relPath)).toEqual(['adw-42/lamp/a.png', 'adw-42/chair/a.png']);
  });
});

describe('assembleScenarioProof — names that hold markup characters and long names', () => {
  // The name as ADW's Playwright project writes it into the report, entities and all: the parser decodes it, the feature file never encodes it.
  const longName = `The cart shows ${'a very long description of what the shopper sees '.repeat(8)}at the end`;
  const feature = `@adw-42
Feature: Checkout

  Scenario: Pay & "refund" <fast> -> done
    Given a cart

  Scenario: ${longName}
    Given a cart
`;
  const report = parseJUnitXml(`<?xml version="1.0"?>
<testsuites><testsuite name="checkout.feature.spec.js">
<testcase name="Checkout › Pay &amp; &quot;refund&quot; &lt;fast&gt; -&gt; done" classname="checkout.feature.spec.js"><system-out><![CDATA[
[[ATTACHMENT|artifacts/adw-42/pay/a.png]]
]]></system-out></testcase>
<testcase name="Checkout › ${longName}" classname="checkout.feature.spec.js"><system-out><![CDATA[
[[ATTACHMENT|artifacts/adw-42/long/a.png]]
]]></system-out></testcase>
</testsuite></testsuites>`);

  it('matches a case to its scenario although the name holds &, <, >, quotes and a very long description', () => {
    expect(longName.length).toBeGreaterThan(400);

    const proof = assemble({
      runs: [NOT_RUN(REGRESSION), runOf(PER_ISSUE, report)],
      scenarioIndex: indexOf(feature),
      artifacts: [artifact('adw-42/pay/a.png'), artifact('adw-42/long/a.png')],
    });

    expect(proof.perIssueImages.map(image => image.relPath)).toEqual(['adw-42/pay/a.png', 'adw-42/long/a.png']);
    expect(proof.perIssueImages[0].scenario).toBe('Checkout › Pay & "refund" <fast> -> done');
    expect(proof.document).not.toContain('Left out');
  });
});
