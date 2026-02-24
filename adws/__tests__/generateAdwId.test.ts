import { describe, it, expect } from 'vitest';
import { generateAdwId } from '../core/utils';
import { extractAdwIdFromComment } from '../github/workflowCommentsBase';

describe('generateAdwId', () => {
  describe('with summary', () => {
    it('produces {slug}-{random} format without adw- prefix', () => {
      const id = generateAdwId('Fix login bug');
      expect(id).toMatch(/^fix-login-bug-[a-z0-9]{6}$/);
    });

    it('truncates summary portion to max 20 characters', () => {
      const id = generateAdwId('This is a very long issue title that exceeds twenty characters');
      const parts = id.split('-');
      // Remove last random suffix
      const summaryPart = parts.slice(0, -1).join('-');
      expect(summaryPart.length).toBeLessThanOrEqual(20);
    });

    it('removes trailing hyphen caused by truncation', () => {
      const id = generateAdwId('Add new feature for users and admins');
      const parts = id.split('-');
      const summaryPart = parts.slice(0, -1).join('-');
      expect(summaryPart).not.toMatch(/-$/);
    });

    it('slugifies special characters', () => {
      const id = generateAdwId("Fix bug: can't login!");
      expect(id).toMatch(/^fix-bug-can-t-login-[a-z0-9]{6}$/);
    });

    it('converts to lowercase', () => {
      const id = generateAdwId('ADD NEW Feature');
      expect(id).toMatch(/^add-new-feature-[a-z0-9]{6}$/);
    });

    it('falls back to timestamp when summary produces empty slug', () => {
      const id = generateAdwId('!!!@@@###');
      expect(id).toMatch(/^\d+-[a-z0-9]{6}$/);
    });
  });

  describe('without summary', () => {
    it('falls back to timestamp format when no summary provided', () => {
      const id = generateAdwId();
      expect(id).toMatch(/^\d+-[a-z0-9]{6}$/);
    });

    it('falls back to timestamp format for empty string', () => {
      const id = generateAdwId('');
      expect(id).toMatch(/^\d+-[a-z0-9]{6}$/);
    });
  });

  describe('random suffix', () => {
    it('always has 6 alphanumeric characters', () => {
      const ids = Array.from({ length: 10 }, () => generateAdwId('test'));
      ids.forEach((id) => {
        const suffix = id.split('-').pop();
        expect(suffix).toMatch(/^[a-z0-9]{6}$/);
      });
    });
  });

  describe('uniqueness', () => {
    it('produces different IDs for same summary', () => {
      const id1 = generateAdwId('Same summary');
      const id2 = generateAdwId('Same summary');
      expect(id1).not.toBe(id2);
    });
  });
});

describe('extractAdwIdFromComment', () => {
  it('extracts old-format ADW ID (timestamp-based)', () => {
    const body = '**ADW ID:** `adw-1770819277126-v2n6pm`';
    expect(extractAdwIdFromComment(body)).toBe('adw-1770819277126-v2n6pm');
  });

  it('extracts new-format ADW ID (summary-based)', () => {
    const body = '**ADW ID:** `adw-replace-timestamp-v2n6pm`';
    expect(extractAdwIdFromComment(body)).toBe('adw-replace-timestamp-v2n6pm');
  });

  it('extracts short old-format ADW ID', () => {
    const body = '**ADW ID:** `adw-123-abc`';
    expect(extractAdwIdFromComment(body)).toBe('adw-123-abc');
  });

  it('returns null when no ADW ID is present', () => {
    const body = 'Just a regular comment';
    expect(extractAdwIdFromComment(body)).toBeNull();
  });

  it('returns null for incomplete ADW ID without backticks', () => {
    const body = 'ADW ID: adw-123-abc';
    expect(extractAdwIdFromComment(body)).toBeNull();
  });
});
