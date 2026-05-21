import { describe, it, expect } from 'vitest';
import { applyTagState, detectExistingSuggestionDate } from '../promotionTagWriter.ts';

const TODAY = '2026-05-21';

describe('promotionTagWriter.applyTagState — add-suggestion', () => {
  it('appends new tag to existing tag line', () => {
    const content = `Feature: Test

  @adw-509
  Scenario: My scenario
    Given something
`;
    const result = applyTagState(content, 4, 'add-suggestion', TODAY);
    const lines = result.split('\n');
    expect(lines[2]).toBe('  @adw-509 @promotion-suggested-2026-05-21');
    // Surrounding content preserved byte-for-byte
    expect(lines[0]).toBe('Feature: Test');
    expect(lines[4]).toBe('    Given something');
  });

  it('inserts new tag line when no existing tag line above header', () => {
    const content = `Feature: Test

  Scenario: My scenario
    Given something
`;
    const result = applyTagState(content, 3, 'add-suggestion', TODAY);
    const lines = result.split('\n');
    // New tag line inserted before scenario header
    expect(lines.some(l => l.includes('@promotion-suggested-2026-05-21'))).toBe(true);
    expect(result).toContain('@promotion-suggested-2026-05-21');
    expect(result).toContain('Scenario: My scenario');
    expect(result).toContain('Given something');
  });

  it('scenario at file start with no preceding content gets new tag line', () => {
    const content = `Scenario: First thing
  Given step
`;
    const result = applyTagState(content, 1, 'add-suggestion', TODAY);
    expect(result.startsWith('@promotion-suggested-2026-05-21\n')).toBe(true);
    expect(result).toContain('Scenario: First thing');
  });

  it('scenario at file end is handled correctly', () => {
    const content = `Feature: Test

  @existing-tag
  Scenario: Last scenario
    Given last step`;
    const result = applyTagState(content, 4, 'add-suggestion', TODAY);
    expect(result).toContain('@existing-tag @promotion-suggested-2026-05-21');
    expect(result).toContain('Scenario: Last scenario');
    expect(result.endsWith('    Given last step')).toBe(true);
  });

  it('interpolates today into tag literal', () => {
    const content = `  @tag\n  Scenario: Test\n    Given step\n`;
    const result = applyTagState(content, 2, 'add-suggestion', '2026-12-31');
    expect(result).toContain('@promotion-suggested-2026-12-31');
  });

  it('throws for unsupported state', () => {
    expect(() =>
      // @ts-expect-error testing unsupported state
      applyTagState('Feature: x\n  Scenario: y\n', 2, 'refresh', TODAY),
    ).toThrow('unsupported state "refresh"');
  });

  it('preserves byte-exact content of all non-inserted lines', () => {
    const content = [
      'Feature: Multi',
      '',
      '  @tag-a',
      '  Scenario: Alpha',
      '    Given step a',
      '',
      '  @tag-b',
      '  Scenario: Beta',
      '    Given step b',
      '',
    ].join('\n');

    const result = applyTagState(content, 4, 'add-suggestion', TODAY);
    const originalLines = content.split('\n');
    const resultLines = result.split('\n');

    // The tag line index 2 (@tag-a) gets modified, all others preserved
    for (let i = 0; i < originalLines.length; i++) {
      if (originalLines[i] === '  @tag-a') continue; // this line gets modified
      expect(resultLines[i]).toBe(originalLines[i]);
    }
  });

  // ── refresh-date ──────────────────────────────────────────────────────

  it('refresh-date replaces the date on a tag line with other tags', () => {
    const content = `Feature: Test

  @adw-509 @promotion-suggested-2026-01-01
  Scenario: My scenario
    Given something
`;
    const result = applyTagState(content, 4, 'refresh-date', TODAY);
    const lines = result.split('\n');
    expect(lines[2]).toBe('  @adw-509 @promotion-suggested-2026-05-21');
    // All other lines preserved byte-for-byte
    expect(lines[0]).toBe('Feature: Test');
    expect(lines[4]).toBe('    Given something');
  });

  it('refresh-date replaces the date on a tag line that only has the suggestion tag', () => {
    const content = `Feature: Test

  @promotion-suggested-2026-01-01
  Scenario: My scenario
    Given something
`;
    const result = applyTagState(content, 4, 'refresh-date', TODAY);
    const lines = result.split('\n');
    expect(lines[2]).toBe('  @promotion-suggested-2026-05-21');
  });

  it('refresh-date throws when no existing @promotion-suggested-* tag exists', () => {
    const content = `Feature: Test

  @adw-509
  Scenario: My scenario
    Given something
`;
    expect(() => applyTagState(content, 4, 'refresh-date', TODAY)).toThrow(
      'refresh-date requires an existing @promotion-suggested-* tag',
    );
  });

  it('refresh-date throws when no tag block exists above the header', () => {
    const content = `Feature: Test

  Scenario: My scenario
    Given something
`;
    expect(() => applyTagState(content, 3, 'refresh-date', TODAY)).toThrow(
      'refresh-date requires an existing @promotion-suggested-* tag',
    );
  });

  // ── remove-suggestion ─────────────────────────────────────────────────

  it('remove-suggestion removes the whole line when the suggestion tag is the only token', () => {
    const content = `Feature: Test

  @promotion-suggested-2026-01-01
  Scenario: My scenario
    Given something
`;
    const result = applyTagState(content, 4, 'remove-suggestion', TODAY);
    const lines = result.split('\n');
    // File shrinks by one line
    expect(result).not.toContain('@promotion-suggested-');
    expect(lines.length).toBe(content.split('\n').length - 1);
    // All other lines byte-identical
    expect(lines[0]).toBe('Feature: Test');
    expect(lines[1]).toBe('');
    expect(lines[2]).toBe('  Scenario: My scenario');
    expect(lines[3]).toBe('    Given something');
  });

  it('remove-suggestion removes only the suggestion token when other tags exist', () => {
    const content = `Feature: Test

  @adw-509 @promotion-suggested-2026-01-01
  Scenario: My scenario
    Given something
`;
    const result = applyTagState(content, 4, 'remove-suggestion', TODAY);
    const lines = result.split('\n');
    expect(lines[2]).toBe('  @adw-509');
    expect(result).not.toContain('@promotion-suggested-');
    expect(lines[0]).toBe('Feature: Test');
    expect(lines[4]).toBe('    Given something');
  });

  it('remove-suggestion is a no-op when no @promotion-suggested-* tag exists', () => {
    const content = `Feature: Test

  @adw-509
  Scenario: My scenario
    Given something
`;
    const result = applyTagState(content, 4, 'remove-suggestion', TODAY);
    expect(result).toBe(content);
  });

  it('remove-suggestion preserves leading indentation when suggestion tag is the first token', () => {
    const content = `Feature: Test

  @promotion-suggested-2026-01-01 @adw-509
  Scenario: My scenario
    Given something
`;
    const result = applyTagState(content, 4, 'remove-suggestion', TODAY);
    const lines = result.split('\n');
    expect(lines[2]).toBe('  @adw-509');
    expect(result).not.toContain('@promotion-suggested-');
  });
});

// ── detectExistingSuggestionDate ─────────────────────────────────────────────

describe('detectExistingSuggestionDate', () => {
  it('returns the date when tag block above header contains the suggestion tag', () => {
    const content = `Feature: Test

  @adw-509 @promotion-suggested-2026-03-15
  Scenario: My scenario
    Given something
`;
    expect(detectExistingSuggestionDate(content, 4)).toBe('2026-03-15');
  });

  it('returns null when no tag block sits above the header', () => {
    const content = `Feature: Test

  Scenario: My scenario
    Given something
`;
    expect(detectExistingSuggestionDate(content, 3)).toBeNull();
  });

  it('returns null when tag block exists but contains no suggestion tag', () => {
    const content = `Feature: Test

  @adw-509
  Scenario: My scenario
    Given something
`;
    expect(detectExistingSuggestionDate(content, 4)).toBeNull();
  });

  it('returns the first date when multiple suggestion tags are present', () => {
    const content = `Feature: Test

  @promotion-suggested-2026-01-01 @promotion-suggested-2026-02-01
  Scenario: My scenario
    Given something
`;
    expect(detectExistingSuggestionDate(content, 4)).toBe('2026-01-01');
  });

  it('returns null when the scenario header is the first line (no preceding content)', () => {
    const content = `Scenario: First thing
  Given step
`;
    expect(detectExistingSuggestionDate(content, 1)).toBeNull();
  });
});

describe('promotionTagWriter.applyTagState — unsupported state', () => {
  it('throws for unsupported state', () => {
    expect(() =>
      // @ts-expect-error testing unsupported state
      applyTagState('Feature: x\n  Scenario: y\n', 2, 'unknown-op', TODAY),
    ).toThrow('unsupported state "unknown-op"');
  });
});

describe('promotionTagWriter.applyTagState — remove-suggestion', () => {
  it('strips @promotion-suggested-<date> from a tag line, preserving other tags', () => {
    const content = `Feature: T\n\n  @adw-509 @promotion-suggested-2026-05-21\n  Scenario: S\n    Given step\n`;
    const result = applyTagState(content, 4, 'remove-suggestion', TODAY);
    expect(result).toContain('  @adw-509');
    expect(result).not.toContain('@promotion-suggested-');
    expect(result).toContain('Scenario: S');
    expect(result).toContain('Given step');
  });

  it('is a no-op when no suggestion tag is present', () => {
    const content = `Feature: T\n\n  @adw-509\n  Scenario: S\n    Given step\n`;
    const result = applyTagState(content, 4, 'remove-suggestion', TODAY);
    expect(result).toBe(content);
  });

  it('strips multiple @promotion-suggested-<date> tokens on the same line', () => {
    const content = `Feature: T\n\n  @promotion-suggested-2026-01-01 @promotion-suggested-2026-05-21\n  Scenario: S\n    Given step\n`;
    const result = applyTagState(content, 4, 'remove-suggestion', TODAY);
    expect(result).not.toContain('@promotion-suggested-');
  });
});

describe('promotionTagWriter.applyTagState — strip-approval', () => {
  it('strips bare @promotion from a tag line', () => {
    const content = `Feature: T\n\n  @adw-509 @promotion\n  Scenario: S\n    Given step\n`;
    const result = applyTagState(content, 4, 'strip-approval', TODAY);
    expect(result).toContain('  @adw-509');
    expect(result).not.toMatch(/@promotion(?!-)/);
  });

  it('is a no-op when only @promotion-suggested-<date> is present', () => {
    const content = `Feature: T\n\n  @promotion-suggested-2026-05-21\n  Scenario: S\n    Given step\n`;
    const result = applyTagState(content, 4, 'strip-approval', TODAY);
    expect(result).toBe(content);
  });

  it('strips bare @promotion but leaves @promotion-suggested-<date> intact in mixed block', () => {
    const content = `Feature: T\n\n  @promotion-suggested-2026-05-21 @promotion\n  Scenario: S\n    Given step\n`;
    const result = applyTagState(content, 4, 'strip-approval', TODAY);
    expect(result).toContain('@promotion-suggested-2026-05-21');
    expect(result).not.toMatch(/ @promotion(?!-)/);
  });

  it('byte-exact preservation of all non-tag lines for strip-approval', () => {
    const content = [
      'Feature: Multi',
      '',
      '  @adw-111 @promotion',
      '  Scenario: Alpha',
      '    Given step a',
      '',
      '  @tag-b',
      '  Scenario: Beta',
      '    Given step b',
      '',
    ].join('\n');
    const result = applyTagState(content, 4, 'strip-approval', TODAY);
    const rLines = result.split('\n');
    expect(rLines[5]).toBe('');
    expect(rLines[6]).toBe('  @tag-b');
    expect(rLines[7]).toBe('  Scenario: Beta');
    expect(rLines[8]).toBe('    Given step b');
  });
});
