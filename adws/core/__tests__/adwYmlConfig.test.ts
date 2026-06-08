import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readAdwYmlConfig, parseAdwYml, ADW_YML_RELATIVE_PATH } from '../adwYmlConfig';

describe('adwYmlConfig', () => {
  let tmpDir = '';

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = '';
    }
  });

  // ── readAdwYmlConfig ────────────────────────────────────────────────────────

  describe('readAdwYmlConfig', () => {
    it('returns { hitl: false } when .github/adw.yml is absent', () => {
      tmpDir = mkdtempSync(join(tmpdir(), 'adw-yml-'));
      expect(readAdwYmlConfig(tmpDir)).toEqual({ hitl: false });
    });

    it('returns { hitl: false } when file has hitl: false', () => {
      tmpDir = mkdtempSync(join(tmpdir(), 'adw-yml-'));
      mkdirSync(join(tmpDir, '.github'));
      writeFileSync(join(tmpDir, ADW_YML_RELATIVE_PATH), 'hitl: false\n', 'utf-8');
      expect(readAdwYmlConfig(tmpDir)).toEqual({ hitl: false });
    });

    it('returns { hitl: true } when file has hitl: true', () => {
      tmpDir = mkdtempSync(join(tmpdir(), 'adw-yml-'));
      mkdirSync(join(tmpDir, '.github'));
      writeFileSync(join(tmpDir, ADW_YML_RELATIVE_PATH), 'hitl: true\n', 'utf-8');
      expect(readAdwYmlConfig(tmpDir)).toEqual({ hitl: true });
    });

    it('returns { hitl: false } when file has no hitl key', () => {
      tmpDir = mkdtempSync(join(tmpdir(), 'adw-yml-'));
      mkdirSync(join(tmpDir, '.github'));
      writeFileSync(join(tmpDir, ADW_YML_RELATIVE_PATH), 'other: value\n', 'utf-8');
      expect(readAdwYmlConfig(tmpDir)).toEqual({ hitl: false });
    });
  });

  // ── parseAdwYml (pure) ──────────────────────────────────────────────────────

  describe('parseAdwYml', () => {
    it('returns { hitl: false } for hitl: false', () => {
      expect(parseAdwYml('hitl: false\n')).toEqual({ hitl: false });
    });

    it('returns { hitl: true } for hitl: true', () => {
      expect(parseAdwYml('hitl: true\n')).toEqual({ hitl: true });
    });

    it('returns { hitl: false } when no hitl key present', () => {
      expect(parseAdwYml('other: value\nauthor: me\n')).toEqual({ hitl: false });
    });

    it('returns { hitl: false } for empty content', () => {
      expect(parseAdwYml('')).toEqual({ hitl: false });
    });

    it('returns { hitl: false } for malformed value (hitl: maybe)', () => {
      expect(parseAdwYml('hitl: maybe\n')).toEqual({ hitl: false });
    });

    it('returns { hitl: false } for malformed value (hitl: 1)', () => {
      expect(parseAdwYml('hitl: 1\n')).toEqual({ hitl: false });
    });

    it('handles quoted "true" (hitl: "true")', () => {
      expect(parseAdwYml('hitl: "true"\n')).toEqual({ hitl: true });
    });

    it('handles quoted false (hitl: "false")', () => {
      expect(parseAdwYml("hitl: 'false'\n")).toEqual({ hitl: false });
    });

    it('handles uppercase (hitl: TRUE)', () => {
      expect(parseAdwYml('hitl: TRUE\n')).toEqual({ hitl: true });
    });

    it('handles inline comment (hitl: true # require review)', () => {
      expect(parseAdwYml('hitl: true # require review\n')).toEqual({ hitl: true });
    });

    it('handles surrounding whitespace in value', () => {
      expect(parseAdwYml('hitl:   true  \n')).toEqual({ hitl: true });
    });

    it('ignores blank lines and full-line comments', () => {
      expect(parseAdwYml('# comment\n\nhitl: true\n')).toEqual({ hitl: true });
    });

    it('stops at first hitl: key and ignores subsequent lines', () => {
      expect(parseAdwYml('hitl: true\nhitl: false\n')).toEqual({ hitl: true });
    });
  });
});
