import { describe, it, expect } from 'vitest';
import { applyTagState } from '../promotionTagWriter.ts';

const TODAY = '2026-05-21';

describe('promotionTagWriter.applyTagState', () => {
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
    ).toThrow('only "add-suggestion" is supported in this slice');
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
});
