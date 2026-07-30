import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readAdwYmlConfig, parseAdwYml, ADW_YML_RELATIVE_PATH, ADW_YML_TEMPLATE, writeAdwYmlTemplateIfAbsent } from '../adwYmlConfig';

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
    it('returns { hitl: false, unitTests: true, guardrails: false } when .github/adw.yml is absent', () => {
      tmpDir = mkdtempSync(join(tmpdir(), 'adw-yml-'));
      expect(readAdwYmlConfig(tmpDir)).toEqual({ hitl: false, unitTests: true, guardrails: false });
    });

    it('returns { hitl: false, unitTests: true, guardrails: false } when file has hitl: false', () => {
      tmpDir = mkdtempSync(join(tmpdir(), 'adw-yml-'));
      mkdirSync(join(tmpDir, '.github'));
      writeFileSync(join(tmpDir, ADW_YML_RELATIVE_PATH), 'hitl: false\n', 'utf-8');
      expect(readAdwYmlConfig(tmpDir)).toEqual({ hitl: false, unitTests: true, guardrails: false });
    });

    it('returns { hitl: true, unitTests: true, guardrails: false } when file has hitl: true', () => {
      tmpDir = mkdtempSync(join(tmpdir(), 'adw-yml-'));
      mkdirSync(join(tmpDir, '.github'));
      writeFileSync(join(tmpDir, ADW_YML_RELATIVE_PATH), 'hitl: true\n', 'utf-8');
      expect(readAdwYmlConfig(tmpDir)).toEqual({ hitl: true, unitTests: true, guardrails: false });
    });

    it('returns { hitl: false, unitTests: true, guardrails: false } when file has no hitl key', () => {
      tmpDir = mkdtempSync(join(tmpdir(), 'adw-yml-'));
      mkdirSync(join(tmpDir, '.github'));
      writeFileSync(join(tmpDir, ADW_YML_RELATIVE_PATH), 'other: value\n', 'utf-8');
      expect(readAdwYmlConfig(tmpDir)).toEqual({ hitl: false, unitTests: true, guardrails: false });
    });

    it('returns { hitl: false, unitTests: false, guardrails: false } when file has unitTests: false', () => {
      tmpDir = mkdtempSync(join(tmpdir(), 'adw-yml-'));
      mkdirSync(join(tmpDir, '.github'));
      writeFileSync(join(tmpDir, ADW_YML_RELATIVE_PATH), 'unitTests: false\n', 'utf-8');
      expect(readAdwYmlConfig(tmpDir)).toEqual({ hitl: false, unitTests: false, guardrails: false });
    });

    it('returns { hitl: true, unitTests: true, guardrails: false } when file has only hitl: true (no unitTests key)', () => {
      tmpDir = mkdtempSync(join(tmpdir(), 'adw-yml-'));
      mkdirSync(join(tmpDir, '.github'));
      writeFileSync(join(tmpDir, ADW_YML_RELATIVE_PATH), 'hitl: true\n', 'utf-8');
      expect(readAdwYmlConfig(tmpDir)).toEqual({ hitl: true, unitTests: true, guardrails: false });
    });
  });

  // ── parseAdwYml (pure) ──────────────────────────────────────────────────────

  describe('parseAdwYml', () => {
    it('returns { hitl: false, unitTests: true, guardrails: false } for hitl: false', () => {
      expect(parseAdwYml('hitl: false\n')).toEqual({ hitl: false, unitTests: true, guardrails: false });
    });

    it('returns { hitl: true, unitTests: true, guardrails: false } for hitl: true', () => {
      expect(parseAdwYml('hitl: true\n')).toEqual({ hitl: true, unitTests: true, guardrails: false });
    });

    it('returns { hitl: false, unitTests: true, guardrails: false } when no hitl key present', () => {
      expect(parseAdwYml('other: value\nauthor: me\n')).toEqual({ hitl: false, unitTests: true, guardrails: false });
    });

    it('returns { hitl: false, unitTests: true, guardrails: false } for empty content', () => {
      expect(parseAdwYml('')).toEqual({ hitl: false, unitTests: true, guardrails: false });
    });

    it('returns { hitl: false, unitTests: true, guardrails: false } for malformed value (hitl: maybe)', () => {
      expect(parseAdwYml('hitl: maybe\n')).toEqual({ hitl: false, unitTests: true, guardrails: false });
    });

    it('returns { hitl: false, unitTests: true, guardrails: false } for malformed value (hitl: 1)', () => {
      expect(parseAdwYml('hitl: 1\n')).toEqual({ hitl: false, unitTests: true, guardrails: false });
    });

    it('handles quoted "true" (hitl: "true")', () => {
      expect(parseAdwYml('hitl: "true"\n')).toEqual({ hitl: true, unitTests: true, guardrails: false });
    });

    it('handles quoted false (hitl: "false")', () => {
      expect(parseAdwYml("hitl: 'false'\n")).toEqual({ hitl: false, unitTests: true, guardrails: false });
    });

    it('handles uppercase (hitl: TRUE)', () => {
      expect(parseAdwYml('hitl: TRUE\n')).toEqual({ hitl: true, unitTests: true, guardrails: false });
    });

    it('handles inline comment (hitl: true # require review)', () => {
      expect(parseAdwYml('hitl: true # require review\n')).toEqual({ hitl: true, unitTests: true, guardrails: false });
    });

    it('handles surrounding whitespace in value', () => {
      expect(parseAdwYml('hitl:   true  \n')).toEqual({ hitl: true, unitTests: true, guardrails: false });
    });

    it('ignores blank lines and full-line comments', () => {
      expect(parseAdwYml('# comment\n\nhitl: true\n')).toEqual({ hitl: true, unitTests: true, guardrails: false });
    });

    it('stops at first hitl: key and ignores subsequent lines', () => {
      expect(parseAdwYml('hitl: true\nhitl: false\n')).toEqual({ hitl: true, unitTests: true, guardrails: false });
    });

    // ── unitTests parsing ───────────────────────────────────────────────────

    it('returns { hitl: false, unitTests: false, guardrails: false } for unitTests: false', () => {
      expect(parseAdwYml('unitTests: false\n')).toEqual({ hitl: false, unitTests: false, guardrails: false });
    });

    it('returns { hitl: false, unitTests: true, guardrails: false } for unitTests: true', () => {
      expect(parseAdwYml('unitTests: true\n')).toEqual({ hitl: false, unitTests: true, guardrails: false });
    });

    it('returns unitTests: true (default) when no unitTests key present', () => {
      expect(parseAdwYml('hitl: true\n')).toEqual({ hitl: true, unitTests: true, guardrails: false });
    });

    it('returns unitTests: true (default) for empty content', () => {
      expect(parseAdwYml('')).toEqual({ hitl: false, unitTests: true, guardrails: false });
    });

    it('returns unitTests: true (default + warn) for malformed unitTests: maybe', () => {
      expect(parseAdwYml('unitTests: maybe\n')).toEqual({ hitl: false, unitTests: true, guardrails: false });
    });

    it('handles quoted "false" (unitTests: "false")', () => {
      expect(parseAdwYml('unitTests: "false"\n')).toEqual({ hitl: false, unitTests: false, guardrails: false });
    });

    it('handles uppercase FALSE (unitTests: FALSE)', () => {
      expect(parseAdwYml('unitTests: FALSE\n')).toEqual({ hitl: false, unitTests: false, guardrails: false });
    });

    it('handles inline comment (unitTests: false # opt out)', () => {
      expect(parseAdwYml('unitTests: false # opt out\n')).toEqual({ hitl: false, unitTests: false, guardrails: false });
    });

    it('handles combined keys — hitl: true then unitTests: false', () => {
      expect(parseAdwYml('hitl: true\nunitTests: false\n')).toEqual({ hitl: true, unitTests: false, guardrails: false });
    });

    it('handles combined keys — unitTests: false then hitl: true', () => {
      expect(parseAdwYml('unitTests: false\nhitl: true\n')).toEqual({ hitl: true, unitTests: false, guardrails: false });
    });

    it('first-occurrence-wins for unitTests (unitTests: false then unitTests: true → false)', () => {
      expect(parseAdwYml('unitTests: false\nunitTests: true\n')).toEqual({ hitl: false, unitTests: false, guardrails: false });
    });

    it('malformed hitl does not block unitTests from being parsed', () => {
      expect(parseAdwYml('hitl: maybe\nunitTests: false\n')).toEqual({ hitl: false, unitTests: false, guardrails: false });
    });

    // ── guardrails parsing ────────────────────────────────────────────────────

    it('returns guardrails: true for guardrails: true', () => {
      expect(parseAdwYml('guardrails: true\n')).toEqual({ hitl: false, unitTests: true, guardrails: true });
    });

    it('returns guardrails: false for guardrails: false', () => {
      expect(parseAdwYml('guardrails: false\n')).toEqual({ hitl: false, unitTests: true, guardrails: false });
    });

    it('returns guardrails: false (default) when no guardrails key present', () => {
      expect(parseAdwYml('hitl: true\nunitTests: false\n')).toEqual({ hitl: true, unitTests: false, guardrails: false });
    });

    it('returns guardrails: false (default) for empty content', () => {
      expect(parseAdwYml('')).toEqual({ hitl: false, unitTests: true, guardrails: false });
    });

    it('returns guardrails: false (default + warn) for malformed guardrails: maybe', () => {
      expect(parseAdwYml('guardrails: maybe\n')).toEqual({ hitl: false, unitTests: true, guardrails: false });
    });

    it('handles quoted "true" (guardrails: "true")', () => {
      expect(parseAdwYml('guardrails: "true"\n')).toEqual({ hitl: false, unitTests: true, guardrails: true });
    });

    it('handles uppercase (guardrails: TRUE)', () => {
      expect(parseAdwYml('guardrails: TRUE\n')).toEqual({ hitl: false, unitTests: true, guardrails: true });
    });

    it('handles inline comment (guardrails: true # canary)', () => {
      expect(parseAdwYml('guardrails: true # canary\n')).toEqual({ hitl: false, unitTests: true, guardrails: true });
    });

    it('strips a full-line comment before the guardrails key', () => {
      expect(parseAdwYml('# comment\n\nguardrails: true\n')).toEqual({ hitl: false, unitTests: true, guardrails: true });
    });

    it('first-occurrence-wins for guardrails (true then false → true)', () => {
      expect(parseAdwYml('guardrails: true\nguardrails: false\n')).toEqual({ hitl: false, unitTests: true, guardrails: true });
    });

    it('parses guardrails alongside hitl and unitTests, all three independently', () => {
      expect(parseAdwYml('hitl: true\nunitTests: false\nguardrails: true\n')).toEqual({ hitl: true, unitTests: false, guardrails: true });
    });

    it('malformed guardrails does not block hitl/unitTests from being parsed', () => {
      expect(parseAdwYml('guardrails: maybe\nhitl: true\nunitTests: false\n')).toEqual({ hitl: true, unitTests: false, guardrails: false });
    });
  });

  // ── ADW_YML_TEMPLATE drift guard ────────────────────────────────────────────

  describe('ADW_YML_TEMPLATE', () => {
    it('parses to the defaults (all keys commented out)', () => {
      expect(parseAdwYml(ADW_YML_TEMPLATE)).toEqual({ hitl: false, unitTests: true, guardrails: false });
    });
  });

  // ── writeAdwYmlTemplateIfAbsent ─────────────────────────────────────────────

  describe('writeAdwYmlTemplateIfAbsent', () => {
    it('creates .github/adw.yml and returns { created: true } when absent', () => {
      tmpDir = mkdtempSync(join(tmpdir(), 'adw-yml-'));
      const result = writeAdwYmlTemplateIfAbsent(tmpDir);
      expect(result).toEqual({ created: true });
      const filePath = join(tmpDir, ADW_YML_RELATIVE_PATH);
      expect(readFileSync(filePath, 'utf-8')).toBe(ADW_YML_TEMPLATE);
    });

    it('readAdwYmlConfig returns defaults after creating the template', () => {
      tmpDir = mkdtempSync(join(tmpdir(), 'adw-yml-'));
      writeAdwYmlTemplateIfAbsent(tmpDir);
      expect(readAdwYmlConfig(tmpDir)).toEqual({ hitl: false, unitTests: true, guardrails: false });
    });

    it('returns { created: false } and leaves the file unchanged when it already exists', () => {
      tmpDir = mkdtempSync(join(tmpdir(), 'adw-yml-'));
      mkdirSync(join(tmpDir, '.github'));
      const customContent = 'unitTests: false\n';
      writeFileSync(join(tmpDir, ADW_YML_RELATIVE_PATH), customContent, 'utf-8');

      const result = writeAdwYmlTemplateIfAbsent(tmpDir);
      expect(result).toEqual({ created: false });

      const filePath = join(tmpDir, ADW_YML_RELATIVE_PATH);
      expect(readFileSync(filePath, 'utf-8')).toBe(customContent);
      expect(readAdwYmlConfig(tmpDir)).toEqual({ hitl: false, unitTests: false, guardrails: false });
    });
  });
});
