import { describe, it, expect } from 'vitest';
import { detectApprovals } from '../promotionApprovalDetector.ts';

const SINGLE_APPROVED = `Feature: T

  @adw-511 @promotion
  Scenario: Approve me
    Given something
    When action
    Then result
`;

const SUGGESTED_ONLY = `Feature: T

  @adw-511 @promotion-suggested-2026-05-21
  Scenario: Only suggested
    Given something
`;

const MIXED_BLOCK = `Feature: T

  @adw-509 @promotion-suggested-2026-05-21 @promotion
  Scenario: Mixed tags
    Given something
`;

const MULTI_APPROVED = `Feature: T

  @promotion
  Scenario: First approved
    Given step

  @other-tag
  Scenario: Not approved
    Given step

  @promotion
  Scenario: Second approved
    Given step
`;

const NO_SCENARIOS = `Feature: T
`;

describe('detectApprovals', () => {
  it('returns one entry for a single @promotion-tagged scenario', () => {
    const result = detectApprovals(SINGLE_APPROVED);
    expect(result).toHaveLength(1);
    expect(result[0].scenarioName).toBe('Approve me');
  });

  it('returns empty for @promotion-suggested-<date> alone', () => {
    const result = detectApprovals(SUGGESTED_ONLY);
    expect(result).toHaveLength(0);
  });

  it('returns one entry when @promotion is present alongside @promotion-suggested-<date>', () => {
    const result = detectApprovals(MIXED_BLOCK);
    expect(result).toHaveLength(1);
    expect(result[0].scenarioName).toBe('Mixed tags');
  });

  it('returns multiple entries ordered by headerLine', () => {
    const result = detectApprovals(MULTI_APPROVED);
    expect(result).toHaveLength(2);
    expect(result[0].scenarioName).toBe('First approved');
    expect(result[1].scenarioName).toBe('Second approved');
    expect(result[0].headerLine).toBeLessThan(result[1].headerLine);
  });

  it('returns empty when there are no scenarios', () => {
    const result = detectApprovals(NO_SCENARIOS);
    expect(result).toHaveLength(0);
  });

  it('propagates a parser exception for malformed Gherkin', () => {
    expect(() => detectApprovals('this is <<< not gherkin')).toThrow();
  });

  it('@promotion inside step text does not trigger detection (only tags[])', () => {
    const content = `Feature: T

  @adw-511
  Scenario: Has promotion in step
    Given the user typed "@promotion"
    When action
    Then result
`;
    const result = detectApprovals(content);
    expect(result).toHaveLength(0);
  });
});
