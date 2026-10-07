import { describe, it, expect } from 'vitest';
import { indexFeatureScenarios, type FeatureScenarioIndex } from '../featureScenarioIndex';

function indexOf(...contents: string[]): FeatureScenarioIndex {
  return indexFeatureScenarios(contents.map((content, position) => ({ path: `features/f${position}.feature`, content })));
}

function titlesOf(index: FeatureScenarioIndex): string[] {
  return index.scenarios.map(scenario => scenario.title);
}

function tagsOf(index: FeatureScenarioIndex, title: string): readonly string[] | undefined {
  return index.scenarios.find(scenario => scenario.title === title)?.tags;
}

describe('indexFeatureScenarios — effective tags', () => {
  it('gives every scenario the tags of its Feature and its own', () => {
    const index = indexOf(`@adw-1
Feature: Cart

  @regression
  Scenario: Opens
    Given a cart

  Scenario: Closes
    Given a cart
`);

    expect(tagsOf(index, 'Cart › Opens')).toEqual(['@adw-1', '@regression']);
    expect(tagsOf(index, 'Cart › Closes')).toEqual(['@adw-1']);
  });

  it('gives a Rule\'s tags to the scenarios of that Rule only', () => {
    const index = indexOf(`Feature: Cart

  Scenario: Outside
    Given a cart

  @adw-2
  Rule: Totals

    Scenario: Sums
      Given a cart

  Rule: Other

    Scenario: Counts
      Given a cart
`);

    expect(tagsOf(index, 'Cart › Totals › Sums')).toEqual(['@adw-2']);
    expect(tagsOf(index, 'Cart › Outside')).toEqual([]);
    expect(tagsOf(index, 'Cart › Other › Counts')).toEqual([]);
  });

  it('lists a tag once, however many levels carry it', () => {
    const index = indexOf(`@adw-3
Feature: Cart

  @adw-3 @regression
  Scenario: Opens
    Given a cart
`);

    expect(tagsOf(index, 'Cart › Opens')).toEqual(['@adw-3', '@regression']);
  });

  it('gives the rows of a Scenario Outline the tags of the outline and of their own Examples table only', () => {
    const index = indexOf(`@feature
Feature: Products

  @outline
  Scenario Outline: The <product> page
    When the shopper opens the <product> page

    @adw-4
    Examples: Added
      | product |
      | lamp    |

    @regression
    Examples: Covered
      | product |
      | table   |
`);

    expect(tagsOf(index, 'Products › The <product> page › The lamp page')).toEqual(['@feature', '@outline', '@adw-4']);
    expect(tagsOf(index, 'Products › The <product> page › The table page')).toEqual(['@feature', '@outline', '@regression']);
  });
});

describe('indexFeatureScenarios — the name the Playwright project gives a test', () => {
  it('names a scenario "Feature › Scenario"', () => {
    const index = indexOf(`Feature: Order total

  Scenario: The cart shows the total
    Given a cart
`);

    expect(index.scenarios).toEqual([
      { featurePath: 'features/f0.feature', title: 'Order total › The cart shows the total', name: 'The cart shows the total', tags: [] },
    ]);
  });

  it('puts the Rule between the Feature and the scenario', () => {
    const index = indexOf(`Feature: Order total

  Rule: Discounts

    Scenario: A voucher lowers the total
      Given a cart
`);

    expect(titlesOf(index)).toEqual(['Order total › Discounts › A voucher lowers the total']);
    expect(index.scenarios[0].name).toBe('A voucher lowers the total');
  });

  it('indexes every file given, in the order given', () => {
    const index = indexOf(
      'Feature: One\n\n  Scenario: First\n    Given a\n',
      'Feature: Two\n\n  Scenario: Second\n    Given b\n',
    );

    expect(index.scenarios.map(scenario => [scenario.featurePath, scenario.title])).toEqual([
      ['features/f0.feature', 'One › First'],
      ['features/f1.feature', 'Two › Second'],
    ]);
  });

  it('ignores the Background, which is no test of its own', () => {
    const index = indexOf(`Feature: Cart

  Background:
    Given the shop is open

  Scenario: Opens
    Given a cart
`);

    expect(titlesOf(index)).toEqual(['Cart › Opens']);
  });

  it('gives a file without a Feature no entry', () => {
    expect(indexOf('# only a comment\n')).toEqual({ scenarios: [], unparsed: [] });
  });
});


describe('indexFeatureScenarios — a file that does not parse', () => {
  it('is kept apart, and the files around it are still indexed', () => {
    const broken = { path: 'features/broken.feature', content: '@adw-6\nthis is not Gherkin\n' };
    const fine = { path: 'features/fine.feature', content: 'Feature: Fine\n\n  Scenario: Works\n    Given a\n' };

    const index = indexFeatureScenarios([broken, fine]);

    expect(index.unparsed).toEqual([broken]);
    expect(titlesOf(index)).toEqual(['Fine › Works']);
  });
});

