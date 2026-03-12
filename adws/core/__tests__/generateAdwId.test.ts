import { describe, it, expect } from 'vitest';
import { generateAdwId } from '../utils';
import { extractAdwIdFromComment } from '../workflowCommentParsing';

describe('generateAdwId', () => {
  describe('with summary', () => {
    it('produces {random}-{slug} format without adw- prefix', () => {
      const id = generateAdwId('Fix login bug');
      expect(id).toMatch(/^[a-z0-9]{6}-fix-login-bug$/);
    });

    it('truncates summary portion to max 20 characters', () => {
      const id = generateAdwId('This is a very long issue title that exceeds twenty characters');
      // Extract slug: everything after the first 6-char random prefix and its hyphen
      const slugPart = id.replace(/^[a-z0-9]{6}-/, '');
      expect(slugPart.length).toBeLessThanOrEqual(20);
    });

    it('removes trailing hyphen caused by truncation', () => {
      const id = generateAdwId('Add new feature for users and admins');
      const slugPart = id.replace(/^[a-z0-9]{6}-/, '');
      expect(slugPart).not.toMatch(/-$/);
    });

    it('slugifies special characters', () => {
      const id = generateAdwId("Fix bug: can't login!");
      expect(id).toMatch(/^[a-z0-9]{6}-fix-bug-can-t-login$/);
    });

    it('converts to lowercase', () => {
      const id = generateAdwId('ADD NEW Feature');
      expect(id).toMatch(/^[a-z0-9]{6}-add-new-feature$/);
    });

    it('falls back to timestamp when summary produces empty slug', () => {
      const id = generateAdwId('!!!@@@###');
      expect(id).toMatch(/^[a-z0-9]{6}-\d+$/);
    });
  });

  describe('without summary', () => {
    it('falls back to timestamp format when no summary provided', () => {
      const id = generateAdwId();
      expect(id).toMatch(/^[a-z0-9]{6}-\d+$/);
    });

    it('falls back to timestamp format for empty string', () => {
      const id = generateAdwId('');
      expect(id).toMatch(/^[a-z0-9]{6}-\d+$/);
    });
  });

  describe('random prefix', () => {
    it('always has 6 alphanumeric characters', () => {
      const ids = Array.from({ length: 10 }, () => generateAdwId('test'));
      ids.forEach((id) => {
        const prefix = id.split('-')[0];
        expect(prefix).toMatch(/^[a-z0-9]{6}$/);
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
