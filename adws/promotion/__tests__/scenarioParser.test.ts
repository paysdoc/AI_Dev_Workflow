import { describe, it, expect } from 'vitest';
import { parse } from '../scenarioParser.ts';

const MULTI_SCENARIO = `
Feature: Test feature

  @tag-one
  Scenario: First scenario
    Given a precondition
    When an action occurs
    Then a result is observed

  @tag-two @tag-three
  Scenario: Second scenario
    Given another precondition
    When another action occurs
    Then another result
`;

const TAGLESS_SCENARIO = `
Feature: Tagless

  Scenario: No tags here
    Given something
    When something else
    Then done
`;

const BACKGROUND_FEATURE = `
Feature: With background

  Background:
    Given the system is set up

  @my-tag
  Scenario: Has background
    Given something extra
    When action
    Then result
`;

const MULTI_LINE_TAGS = `
Feature: Multi tags

  @tag-a
  @tag-b
  @tag-c
  Scenario: Three tags on separate lines
    Given something
    When action
    Then result
`;

describe('scenarioParser.parse', () => {
  it('parses a multi-scenario feature and returns the correct count with tags', () => {
    const result = parse(MULTI_SCENARIO);
    expect(result).toHaveLength(2);
    expect(result[0].tags).toEqual(['@tag-one']);
    expect(result[1].tags).toEqual(['@tag-two', '@tag-three']);
  });

  it('populates scenario name from the Gherkin AST', () => {
    const result = parse(MULTI_SCENARIO);
    expect(result[0].name).toBe('First scenario');
    expect(result[1].name).toBe('Second scenario');
  });

  it('returns correct steps for each scenario', () => {
    const result = parse(MULTI_SCENARIO);
    expect(result[0].steps).toHaveLength(3);
    expect(result[0].steps[0]).toMatchObject({ keyword: 'Given', text: 'a precondition' });
    expect(result[0].steps[1]).toMatchObject({ keyword: 'When', text: 'an action occurs' });
    expect(result[0].steps[2]).toMatchObject({ keyword: 'Then', text: 'a result is observed' });
  });

  it('tagless scenarios return empty tags array', () => {
    const result = parse(TAGLESS_SCENARIO);
    expect(result).toHaveLength(1);
    expect(result[0].tags).toEqual([]);
  });

  it('Background blocks are excluded from Scenario[] results', () => {
    const result = parse(BACKGROUND_FEATURE);
    expect(result).toHaveLength(1);
    expect(result[0].tags).toEqual(['@my-tag']);
  });

  it('scenarios with multi-line tag blocks return all tags', () => {
    const result = parse(MULTI_LINE_TAGS);
    expect(result).toHaveLength(1);
    expect(result[0].tags).toEqual(['@tag-a', '@tag-b', '@tag-c']);
  });

  it('line positions are accurate — headerLine matches scenario keyword location', () => {
    const content = `Feature: Line positions

  Scenario: First
    Given step one

  @some-tag
  Scenario: Second
    Given step two
`;
    const result = parse(content);
    expect(result).toHaveLength(2);
    expect(result[0].headerLine).toBe(3);
    expect(result[1].headerLine).toBe(7);
    expect(result[1].startLine).toBe(6); // tag line
  });

  it('propagates ParserException for malformed Gherkin', () => {
    const malformed = 'this is not gherkin at all <<<BROKEN>>>';
    expect(() => parse(malformed)).toThrow();
  });
});
