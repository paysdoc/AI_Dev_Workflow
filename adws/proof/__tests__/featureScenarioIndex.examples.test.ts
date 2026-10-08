import { describe, it, expect } from 'vitest';
import { indexFeatureScenarios, type FeatureScenarioIndex } from '../featureScenarioIndex';

function indexOf(...contents: string[]): FeatureScenarioIndex {
  return indexFeatureScenarios(contents.map((content, position) => ({ path: `features/f${position}.feature`, content })));
}

function titlesOf(index: FeatureScenarioIndex): string[] {
  return index.scenarios.map(scenario => scenario.title);
}

describe('indexFeatureScenarios — the title of a Scenario Outline row', () => {
  it('names an Examples row "Example #<n>" when nothing in the outline names its columns', () => {
    const index = indexOf(`Feature: Checkout

  Scenario Outline: Paying
    When the shopper pays with a card

    Examples:
      | card |
      | visa |
      | amex |
`);

    expect(titlesOf(index)).toEqual(['Checkout › Paying › Example #1', 'Checkout › Paying › Example #2']);
    expect(index.scenarios.map(scenario => scenario.name)).toEqual(['Example #1', 'Example #2']);
  });

  it('counts the rows across every Examples table of the outline', () => {
    const index = indexOf(`Feature: Checkout

  Scenario Outline: Paying
    When the shopper pays with a card

    Examples:
      | card |
      | visa |
      | amex |

    Examples:
      | card   |
      | master |
`);

    expect(titlesOf(index)).toEqual(['Checkout › Paying › Example #1', 'Checkout › Paying › Example #2', 'Checkout › Paying › Example #3']);
  });

  it('counts the rows of each outline from one', () => {
    const index = indexOf(`Feature: Checkout

  Scenario Outline: Paying
    When the shopper pays with a <card>

    Examples:
      | card |
      | visa |

  Scenario Outline: Refunding
    When the shopper is refunded to a <bank>

    Examples:
      | bank |
      | ing  |
`);

    expect(titlesOf(index)).toEqual(['Checkout › Paying › Example #1', 'Checkout › Refunding › Example #1']);
  });

  it('fills the columns into the outline name when it names one', () => {
    const index = indexOf(`Feature: Product pages

  Scenario Outline: The <product> page shows its price
    When the shopper opens the page of the <product>

    Examples:
      | product |
      | lamp    |
      | chair   |
`);

    expect(titlesOf(index)).toEqual([
      'Product pages › The <product> page shows its price › The lamp page shows its price',
      'Product pages › The <product> page shows its price › The chair page shows its price',
    ]);
    expect(index.scenarios[0].name).toBe('The lamp page shows its price');
  });

  it('prefers the name of the Examples table to the outline name when it names a column', () => {
    const index = indexOf(`Feature: Product pages

  Scenario Outline: The <product> page shows its price
    When the shopper opens the page of the <product>

    Examples: The <product> in <colour>
      | product | colour |
      | lamp    | red    |
`);

    expect(titlesOf(index)).toEqual(['Product pages › The <product> page shows its price › The lamp in red']);
  });

  it('ignores an Examples name whose placeholders are no column of the table', () => {
    const index = indexOf(`Feature: Product pages

  Scenario Outline: The <product> page shows its price
    When the shopper opens the page of the <product>

    Examples: Added for <the issue>
      | product |
      | lamp    |
`);

    expect(titlesOf(index)).toEqual(['Product pages › The <product> page shows its price › The lamp page shows its price']);
  });

  it('leaves a placeholder that is no column as written', () => {
    const index = indexOf(`Feature: Product pages

  Scenario Outline: The <product> page in <currency>
    When the shopper opens the page of the <product>

    Examples:
      | product |
      | lamp    |
`);

    expect(titlesOf(index)).toEqual(['Product pages › The <product> page in <currency> › The lamp page in <currency>']);
  });

  it('uses the "# title-format:" comment directly above the Examples', () => {
    const index = indexOf(`Feature: Product pages

  Scenario Outline: The <product> page shows its price
    When the shopper opens the page of the <product>

    # title-format: Row <_index_>: <product>
    Examples:
      | product |
      | lamp    |
      | chair   |
`);

    expect(titlesOf(index)).toEqual([
      'Product pages › The <product> page shows its price › Row 1: lamp',
      'Product pages › The <product> page shows its price › Row 2: chair',
    ]);
  });

  it('uses the "# title-format:" comment directly above the first tag of the Examples', () => {
    const index = indexOf(`Feature: Product pages

  Scenario Outline: Price
    When the shopper opens the page of the <product>

    # title-format: <product> page
    @adw-5 @regression
    Examples:
      | product |
      | lamp    |
`);

    expect(titlesOf(index)).toEqual(['Product pages › Price › lamp page']);
  });

  it('takes the comment closest to the Examples when both places hold one', () => {
    const index = indexOf(`Feature: Product pages

  Scenario Outline: Price
    When the shopper opens the page of the <product>

    # title-format: far <product>
    @adw-5
    # title-format: near <product>
    Examples:
      | product |
      | lamp    |
`);

    expect(titlesOf(index)).toEqual(['Product pages › Price › near lamp']);
  });

  it('ignores a comment that is not directly above the Examples', () => {
    const index = indexOf(`Feature: Product pages

  Scenario Outline: Price
    When the shopper opens the page of the <product>

    # title-format: far <product>

    Examples:
      | product |
      | lamp    |
`);

    expect(titlesOf(index)).toEqual(['Product pages › Price › Example #1']);
  });

  it('names a row "<Examples keyword>: #<n>" in a document that is not English', () => {
    const index = indexOf(`# language: nl
Functionaliteit: Winkelwagen

  Abstract Scenario: Betalen
    Als de klant betaalt met een <kaart>

    Voorbeelden:
      | kaart |
      | visa  |
`);

    expect(titlesOf(index)).toEqual(['Winkelwagen › Betalen › Voorbeelden: #1']);
  });

  it('gives an outline without rows no entry, as the generator renders no test for it', () => {
    const index = indexOf(`Feature: Checkout

  Scenario Outline: Paying
    When the shopper pays with a <card>

    Examples:
      | card |

  Scenario: Browsing
    Given a shop
`);

    expect(titlesOf(index)).toEqual(['Checkout › Browsing']);
  });

  it('treats an outline without any Examples as a scenario of its own, as the generator does', () => {
    const index = indexOf(`Feature: Checkout

  Scenario Outline: Paying
    When the shopper pays
`);

    expect(titlesOf(index)).toEqual(['Checkout › Paying']);
  });
});
