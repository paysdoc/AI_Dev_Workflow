import { describe, it, expect } from 'vitest';
import {
  EMPTY_FEATURE_SCENARIO_INDEX,
  hasScenarioTagged,
  indexFeatureScenarios,
  scenariosForTestCase,
  type FeatureScenarioIndex,
} from '../featureScenarioIndex';

function indexOf(...contents: string[]): FeatureScenarioIndex {
  return indexFeatureScenarios(contents.map((content, position) => ({ path: `features/f${position}.feature`, content })));
}

describe('hasScenarioTagged', () => {
  it('finds a tag of a scenario', () => {
    const index = indexOf('Feature: Cart\n\n  @adw-99\n  Scenario: Opens\n    Given a cart\n');

    expect(hasScenarioTagged(index, '@adw-99')).toBe(true);
    expect(hasScenarioTagged(index, '@regression')).toBe(false);
  });

  it('compares whole tags: @adw-99 is not @adw-992', () => {
    const index = indexOf('Feature: Cart\n\n  @adw-992\n  Scenario: Opens\n    Given a cart\n');

    expect(hasScenarioTagged(index, '@adw-99')).toBe(false);
    expect(hasScenarioTagged(index, '@adw-992')).toBe(true);
  });

  it('finds a tag the scenario inherits from its Feature', () => {
    const index = indexOf('@adw-7\nFeature: Cart\n\n  Scenario: Opens\n    Given a cart\n');

    expect(hasScenarioTagged(index, '@adw-7')).toBe(true);
  });

  it('finds a tag that only one Examples table carries', () => {
    const index = indexOf(`Feature: Products

  Scenario Outline: The <product> page
    When the shopper opens the <product> page

    Examples:
      | product |
      | lamp    |

    @adw-8
    Examples:
      | product |
      | chair   |
`);

    expect(hasScenarioTagged(index, '@adw-8')).toBe(true);
  });

  it('finds no tag in a Feature without scenarios, where nothing is run', () => {
    const index = indexOf('@adw-9\nFeature: Empty\n');

    expect(hasScenarioTagged(index, '@adw-9')).toBe(false);
  });

  it('counts a tag in the raw text of a file that does not parse, so that the run goes ahead and reports the error', () => {
    const index = indexOf('@adw-77\nthis is not Gherkin\n');

    expect(hasScenarioTagged(index, '@adw-77')).toBe(true);
  });

  it('does not count a file that does not parse for a tag it does not hold, nor for a longer tag', () => {
    const index = indexOf('@adw-777 @regression\nthis is not Gherkin\n');

    expect(hasScenarioTagged(index, '@adw-77')).toBe(false);
    expect(hasScenarioTagged(index, '@adw-7777')).toBe(false);
  });

  it('finds no tag in an empty index', () => {
    expect(hasScenarioTagged(EMPTY_FEATURE_SCENARIO_INDEX, '@regression')).toBe(false);
  });
});

describe('scenariosForTestCase', () => {
  const index = indexOf(
    `@adw-1
Feature: Wish list

  Scenario: The page shows the saved products
    Given a wish list
`,
    `Feature: Cart

  @regression
  Scenario: The page shows the saved products
    Given a cart

  Scenario: The cart is empty
    Given a cart
`,
    `Feature: Cart

  Scenario: The cart is empty
    Given another cart
`,
  );

  it('finds the scenario whose full name the test case carries', () => {
    const matched = scenariosForTestCase(index, 'Wish list › The page shows the saved products');

    expect(matched.map(scenario => [scenario.featurePath, scenario.tags])).toEqual([['features/f0.feature', ['@adw-1']]]);
  });

  it('tells apart scenarios of one name by their Feature', () => {
    const matched = scenariosForTestCase(index, 'Cart › The page shows the saved products');

    expect(matched.map(scenario => scenario.featurePath)).toEqual(['features/f1.feature']);
  });

  it('returns every scenario of a title that two files share', () => {
    const matched = scenariosForTestCase(index, 'Cart › The cart is empty');

    expect(matched.map(scenario => scenario.featurePath)).toEqual(['features/f1.feature', 'features/f2.feature']);
  });

  it('matches a name without a separator, as a runner that reports the scenario title alone writes it, by the last segment', () => {
    const matched = scenariosForTestCase(index, 'The page shows the saved products');

    expect(matched.map(scenario => scenario.featurePath)).toEqual(['features/f0.feature', 'features/f1.feature']);
  });

  it('does not match a name that carries a Feature by the last segment alone', () => {
    expect(scenariosForTestCase(index, 'Checkout › The cart is empty')).toEqual([]);
  });

  it('matches nothing for a name no scenario has', () => {
    expect(scenariosForTestCase(index, 'Cart › A scenario nobody wrote')).toEqual([]);
    expect(scenariosForTestCase(EMPTY_FEATURE_SCENARIO_INDEX, 'Cart › The cart is empty')).toEqual([]);
  });
});
