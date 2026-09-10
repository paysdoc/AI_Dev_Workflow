import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseOwnerRepoFromUrl, validateWorkingDirectory } from '../workspaceValidation';

describe('parseOwnerRepoFromUrl', () => {
  describe('HTTPS URLs', () => {
    it('parses standard repo name', () => {
      expect(parseOwnerRepoFromUrl('https://github.com/paysdoc/AI_Dev_Workflow')).toEqual({
        owner: 'paysdoc',
        repo: 'AI_Dev_Workflow',
      });
    });

    it('parses standard repo name with .git suffix', () => {
      expect(parseOwnerRepoFromUrl('https://github.com/paysdoc/AI_Dev_Workflow.git')).toEqual({
        owner: 'paysdoc',
        repo: 'AI_Dev_Workflow',
      });
    });

    it('parses dotted repo name', () => {
      expect(parseOwnerRepoFromUrl('https://github.com/paysdoc/paysdoc.nl')).toEqual({
        owner: 'paysdoc',
        repo: 'paysdoc.nl',
      });
    });

    it('parses dotted repo name with .git suffix', () => {
      expect(parseOwnerRepoFromUrl('https://github.com/paysdoc/paysdoc.nl.git')).toEqual({
        owner: 'paysdoc',
        repo: 'paysdoc.nl',
      });
    });

    it('parses repo name with multiple dots', () => {
      expect(parseOwnerRepoFromUrl('https://github.com/org/api.v2.staging.git')).toEqual({
        owner: 'org',
        repo: 'api.v2.staging',
      });
    });
  });

  describe('SSH URLs', () => {
    it('parses standard repo name', () => {
      expect(parseOwnerRepoFromUrl('git@github.com:paysdoc/AI_Dev_Workflow')).toEqual({
        owner: 'paysdoc',
        repo: 'AI_Dev_Workflow',
      });
    });

    it('parses standard repo name with .git suffix', () => {
      expect(parseOwnerRepoFromUrl('git@github.com:paysdoc/AI_Dev_Workflow.git')).toEqual({
        owner: 'paysdoc',
        repo: 'AI_Dev_Workflow',
      });
    });

    it('parses dotted repo name', () => {
      expect(parseOwnerRepoFromUrl('git@github.com:paysdoc/paysdoc.nl')).toEqual({
        owner: 'paysdoc',
        repo: 'paysdoc.nl',
      });
    });

    it('parses dotted repo name with .git suffix', () => {
      expect(parseOwnerRepoFromUrl('git@github.com:paysdoc/paysdoc.nl.git')).toEqual({
        owner: 'paysdoc',
        repo: 'paysdoc.nl',
      });
    });

    it('parses repo name with multiple dots', () => {
      expect(parseOwnerRepoFromUrl('git@github.com:org/api.v2.staging.git')).toEqual({
        owner: 'org',
        repo: 'api.v2.staging',
      });
    });
  });

  describe('edge cases', () => {
    it('returns null for unrecognised URL format', () => {
      expect(parseOwnerRepoFromUrl('not-a-url')).toBeNull();
    });
  });
});

describe('validateWorkingDirectory', () => {
  let tempDir: string | null = null;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('throws when the path does not exist', () => {
    expect(() => validateWorkingDirectory('/no/such/path/adw-workspace-validation')).toThrow(/does not exist/);
  });

  it('throws when the path is a file, not a directory', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'adw-wsval-'));
    const filePath = join(tempDir, 'not-a-dir');
    writeFileSync(filePath, 'x');
    expect(() => validateWorkingDirectory(filePath)).toThrow(/not a directory/);
  });

  it('throws when the directory has no .git', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'adw-wsval-'));
    expect(() => validateWorkingDirectory(tempDir!)).toThrow(/not a git repository/);
  });

  it('passes when the directory contains a .git directory', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'adw-wsval-'));
    mkdirSync(join(tempDir, '.git'));
    expect(() => validateWorkingDirectory(tempDir!)).not.toThrow();
  });
});
