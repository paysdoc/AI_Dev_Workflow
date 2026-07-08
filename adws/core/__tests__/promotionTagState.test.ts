import { describe, it, expect } from 'vitest';
import { parsePromotionTagState, serializePromotionTagState, isPromotionExempt } from '../promotionTagState';

describe('parsePromotionTagState', () => {
  it('untagged feature content → none', () => {
    const content = `Feature: Test\n\n  Scenario: My scenario\n    Given something\n`;
    expect(parsePromotionTagState(content)).toBe('none');
  });

  it('feature-level @promotion-suggested-<date> tag → suggested', () => {
    const content = `@promotion-suggested-2026-07-08\nFeature: Test\n\n  Scenario: My scenario\n    Given something\n`;
    expect(parsePromotionTagState(content)).toBe('suggested');
  });

  it('@promotion-declined tag → declined', () => {
    const content = `@promotion-declined\nFeature: Test\n\n  Scenario: My scenario\n    Given something\n`;
    expect(parsePromotionTagState(content)).toBe('declined');
  });

  it('both markers present → declined wins (terminal precedence)', () => {
    const content = `@promotion-suggested-2026-07-08 @promotion-declined\nFeature: Test\n\n  Scenario: My scenario\n    Given something\n`;
    expect(parsePromotionTagState(content)).toBe('declined');
  });

  it('untagged stale file is not treated as declined or suggested', () => {
    const content = `Feature: Test\n\n  Scenario: My scenario\n    Given something\n`;
    expect(parsePromotionTagState(content)).toBe('none');
  });

  it('prose mentioning a marker as literal text (not a tag line) is not matched', () => {
    const content = [
      'Feature: Test',
      '',
      '  Scenario scores well and receives a `@promotion-suggested-2026-07-08` tag automatically.',
      '',
      '  Scenario: My scenario',
      '    Given the file has no literal @promotion-declined marker either',
    ].join('\n');
    expect(parsePromotionTagState(content)).toBe('none');
  });

  it('marker on a scenario-level tag line is still detected', () => {
    const content = [
      'Feature: Test',
      '',
      '  @promotion-suggested-2026-07-08',
      '  Scenario: My scenario',
      '    Given something',
    ].join('\n');
    expect(parsePromotionTagState(content)).toBe('suggested');
  });

  it('malformed/undated @promotion-suggested (no YYYY-MM-DD) is treated as none', () => {
    const content = `@promotion-suggested\nFeature: Test\n\n  Scenario: My scenario\n    Given something\n`;
    expect(parsePromotionTagState(content)).toBe('none');
  });
});

describe('serializePromotionTagState', () => {
  it('none→suggested adds the dated marker beside an existing @adw-N tag', () => {
    const content = `@adw-509\nFeature: Test\n\n  Scenario: My scenario\n    Given something\n`;
    const result = serializePromotionTagState(content, 'suggested', { date: '2026-07-08' });
    expect(result.split('\n')[0]).toBe('@adw-509 @promotion-suggested-2026-07-08');
    expect(parsePromotionTagState(result)).toBe('suggested');
  });

  it('suggested→declined strips the dated marker and adds @promotion-declined', () => {
    const content = `@adw-509 @promotion-suggested-2026-07-08\nFeature: Test\n\n  Scenario: My scenario\n    Given something\n`;
    const result = serializePromotionTagState(content, 'declined');
    expect(result.split('\n')[0]).toBe('@adw-509 @promotion-declined');
    expect(result).not.toContain('@promotion-suggested-2026-07-08');
    expect(parsePromotionTagState(result)).toBe('declined');
  });

  it('→none strips both markers (withdraw)', () => {
    const content = `@adw-509 @promotion-declined\nFeature: Test\n\n  Scenario: My scenario\n    Given something\n`;
    const result = serializePromotionTagState(content, 'none');
    expect(result.split('\n')[0]).toBe('@adw-509');
    expect(result).not.toContain('@promotion-declined');
    expect(parsePromotionTagState(result)).toBe('none');
  });

  it('creates a tag line above Feature: with matching indentation when none exists', () => {
    const content = `Feature: Test\n\n  Scenario: My scenario\n    Given something\n`;
    const result = serializePromotionTagState(content, 'suggested', { date: '2026-07-08' });
    const lines = result.split('\n');
    expect(lines[0]).toBe('@promotion-suggested-2026-07-08');
    expect(lines[1]).toBe('Feature: Test');
  });

  it('preserves non-marker tokens and all other content byte-for-byte', () => {
    const content = `@adw-509 @adw-abc123\nFeature: Test\n\n  Scenario: My scenario\n    Given something\n    Then done\n`;
    const result = serializePromotionTagState(content, 'suggested', { date: '2026-07-08' });
    expect(result.split('\n')[0]).toBe('@adw-509 @adw-abc123 @promotion-suggested-2026-07-08');
    expect(result).toContain('\nFeature: Test\n');
    expect(result).toContain('  Scenario: My scenario');
    expect(result).toContain('    Given something');
    expect(result).toContain('    Then done');
  });

  it('throws when target is "suggested" without opts.date', () => {
    const content = `Feature: Test\n`;
    expect(() => serializePromotionTagState(content, 'suggested')).toThrow();
  });

  it('round-trips and is idempotent for target=suggested', () => {
    const content = `@adw-509\nFeature: Test\n\n  Scenario: My scenario\n    Given something\n`;
    const once = serializePromotionTagState(content, 'suggested', { date: '2026-07-08' });
    const twice = serializePromotionTagState(once, 'suggested', { date: '2026-07-08' });
    expect(twice).toBe(once);
    expect(parsePromotionTagState(once)).toBe('suggested');
  });

  it('round-trips and is idempotent for target=declined', () => {
    const content = `@adw-509 @promotion-suggested-2026-07-08\nFeature: Test\n\n  Scenario: My scenario\n    Given something\n`;
    const once = serializePromotionTagState(content, 'declined');
    const twice = serializePromotionTagState(once, 'declined');
    expect(twice).toBe(once);
    expect(parsePromotionTagState(once)).toBe('declined');
  });

  it('round-trips and is idempotent for target=none', () => {
    const content = `@adw-509 @promotion-declined\nFeature: Test\n\n  Scenario: My scenario\n    Given something\n`;
    const once = serializePromotionTagState(content, 'none');
    const twice = serializePromotionTagState(once, 'none');
    expect(twice).toBe(once);
    expect(parsePromotionTagState(once)).toBe('none');
  });

  it('is a no-op on a file with only a feature-level tag line and no scenarios', () => {
    const content = `@promotion-suggested-2026-07-08\nFeature: Solo feature line\n`;
    const result = serializePromotionTagState(content, 'suggested', { date: '2026-07-08' });
    expect(result).toBe(content);
  });
});

describe('isPromotionExempt', () => {
  it('suggested → true', () => {
    expect(isPromotionExempt('suggested')).toBe(true);
  });

  it('none → false', () => {
    expect(isPromotionExempt('none')).toBe(false);
  });

  it('declined → false', () => {
    expect(isPromotionExempt('declined')).toBe(false);
  });
});
