import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readAdwVersion, writeAdwVersion, ADW_VERSION_FILENAME } from '../adwVersion';

const SAMPLE_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const OTHER_SHA = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

describe('adwVersion', () => {
  let tmpDir = '';

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = '';
    }
  });

  describe('readAdwVersion', () => {
    it('returns trimmed SHA when file exists with hash + newline', () => {
      tmpDir = mkdtempSync(join(tmpdir(), 'adw-version-'));
      writeFileSync(join(tmpDir, ADW_VERSION_FILENAME), `${SAMPLE_SHA}\n`, 'utf-8');
      expect(readAdwVersion(tmpDir)).toBe(SAMPLE_SHA);
    });

    it('returns null when file is absent', () => {
      tmpDir = mkdtempSync(join(tmpdir(), 'adw-version-'));
      expect(readAdwVersion(tmpDir)).toBeNull();
    });

    it('tolerates trailing whitespace and stray newlines', () => {
      tmpDir = mkdtempSync(join(tmpdir(), 'adw-version-'));
      writeFileSync(join(tmpDir, ADW_VERSION_FILENAME), `${SAMPLE_SHA}  \n\n\n`, 'utf-8');
      expect(readAdwVersion(tmpDir)).toBe(SAMPLE_SHA);
    });

    it('tolerates surrounding whitespace', () => {
      tmpDir = mkdtempSync(join(tmpdir(), 'adw-version-'));
      writeFileSync(join(tmpDir, ADW_VERSION_FILENAME), `\n  ${SAMPLE_SHA}\t\n`, 'utf-8');
      expect(readAdwVersion(tmpDir)).toBe(SAMPLE_SHA);
    });

    it('returns null for an empty file', () => {
      tmpDir = mkdtempSync(join(tmpdir(), 'adw-version-'));
      writeFileSync(join(tmpDir, ADW_VERSION_FILENAME), '', 'utf-8');
      expect(readAdwVersion(tmpDir)).toBeNull();
    });

    it('returns null for a whitespace-only file', () => {
      tmpDir = mkdtempSync(join(tmpdir(), 'adw-version-'));
      writeFileSync(join(tmpDir, ADW_VERSION_FILENAME), '\n  \t\n', 'utf-8');
      expect(readAdwVersion(tmpDir)).toBeNull();
    });
  });

  describe('writeAdwVersion', () => {
    it('writes hash followed by exactly one trailing newline', () => {
      tmpDir = mkdtempSync(join(tmpdir(), 'adw-version-'));
      writeAdwVersion(tmpDir, SAMPLE_SHA);
      const raw = readFileSync(join(tmpDir, ADW_VERSION_FILENAME), 'utf-8');
      expect(raw).toBe(`${SAMPLE_SHA}\n`);
    });

    it('overwrites existing content with no leftover bytes', () => {
      tmpDir = mkdtempSync(join(tmpdir(), 'adw-version-'));
      writeAdwVersion(tmpDir, SAMPLE_SHA);
      writeAdwVersion(tmpDir, OTHER_SHA);
      const raw = readFileSync(join(tmpDir, ADW_VERSION_FILENAME), 'utf-8');
      expect(raw).toBe(`${OTHER_SHA}\n`);
    });

    it('round-trips: write then read returns the same hash', () => {
      tmpDir = mkdtempSync(join(tmpdir(), 'adw-version-'));
      writeAdwVersion(tmpDir, SAMPLE_SHA);
      expect(readAdwVersion(tmpDir)).toBe(SAMPLE_SHA);
    });

    it('normalizes a hash passed with surrounding whitespace', () => {
      tmpDir = mkdtempSync(join(tmpdir(), 'adw-version-'));
      writeAdwVersion(tmpDir, `  ${SAMPLE_SHA}\n`);
      const raw = readFileSync(join(tmpDir, ADW_VERSION_FILENAME), 'utf-8');
      expect(raw).toBe(`${SAMPLE_SHA}\n`);
      expect(readAdwVersion(tmpDir)).toBe(SAMPLE_SHA);
    });
  });
});
