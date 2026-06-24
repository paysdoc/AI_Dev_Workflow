import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import { readAdwVersion, writeAdwVersion, readRemoteAdwVersion, ADW_VERSION_FILENAME } from '../adwVersion';

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

  describe('readRemoteAdwVersion', () => {
    const GIT = process.env['REAL_GIT_PATH'] ?? 'git';
    const fixtureRemoteDirs: string[] = [];

    /**
     * Creates a bare origin with an initial commit on `branch`, optionally including
     * `.adw-version` with `content`, then creates a local clone tracking that origin.
     * Returns the local workspace path — pass it as `workspacePath` to readRemoteAdwVersion.
     */
    function setupRemoteRepo(branch: string, content: string | null): string {
      const originDir = mkdtempSync(join(tmpdir(), 'adw-ver-origin-'));
      fixtureRemoteDirs.push(originDir);
      execSync(`"${GIT}" init --bare "${originDir}"`, { stdio: 'pipe' });

      const seedDir = mkdtempSync(join(tmpdir(), 'adw-ver-seed-'));
      fixtureRemoteDirs.push(seedDir);
      execSync(`"${GIT}" init "${seedDir}"`, { stdio: 'pipe' });
      execSync(`"${GIT}" -C "${seedDir}" config user.email "test@adw.local"`, { stdio: 'pipe' });
      execSync(`"${GIT}" -C "${seedDir}" config user.name "ADW Test"`, { stdio: 'pipe' });
      writeFileSync(join(seedDir, 'README.md'), 'test\n');
      execSync(`"${GIT}" -C "${seedDir}" add README.md`, { stdio: 'pipe' });
      if (content !== null) {
        writeFileSync(join(seedDir, ADW_VERSION_FILENAME), `${content}\n`);
        execSync(`"${GIT}" -C "${seedDir}" add "${ADW_VERSION_FILENAME}"`, { stdio: 'pipe' });
      }
      execSync(`"${GIT}" -C "${seedDir}" commit -m "init"`, { stdio: 'pipe' });
      execSync(`"${GIT}" -C "${seedDir}" branch -M "${branch}"`, { stdio: 'pipe' });
      execSync(`"${GIT}" -C "${seedDir}" remote add origin "${originDir}"`, { stdio: 'pipe' });
      execSync(`"${GIT}" -C "${seedDir}" push origin "${branch}"`, { stdio: 'pipe' });

      const wsDir = mkdtempSync(join(tmpdir(), 'adw-ver-ws-'));
      fixtureRemoteDirs.push(wsDir);
      execSync(`"${GIT}" init "${wsDir}"`, { stdio: 'pipe' });
      execSync(`"${GIT}" -C "${wsDir}" config user.email "test@adw.local"`, { stdio: 'pipe' });
      execSync(`"${GIT}" -C "${wsDir}" config user.name "ADW Test"`, { stdio: 'pipe' });
      execSync(`"${GIT}" -C "${wsDir}" remote add origin "${originDir}"`, { stdio: 'pipe' });
      execSync(`"${GIT}" -C "${wsDir}" fetch --all`, { stdio: 'pipe' });
      execSync(`"${GIT}" -C "${wsDir}" checkout -b "${branch}" "origin/${branch}"`, { stdio: 'pipe' });
      return wsDir;
    }

    afterAll(() => {
      for (const dir of fixtureRemoteDirs) {
        try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
      }
    });

    it('returns the trimmed hash committed at origin/<branch>:.adw-version', () => {
      const ws = setupRemoteRepo('main', SAMPLE_SHA);
      expect(readRemoteAdwVersion('main', ws)).toBe(SAMPLE_SHA);
    });

    it('returns null when .adw-version is absent on the remote branch (git show exits non-zero)', () => {
      const ws = setupRemoteRepo('main', null);
      // No .adw-version committed on origin/main → git show exits 128 → null
      expect(readRemoteAdwVersion('main', ws)).toBeNull();
    });

    it('returns null when the remote branch does not exist', () => {
      const ws = setupRemoteRepo('main', SAMPLE_SHA);
      // 'nonexistent-branch-xyz' is not on origin → git show exits non-zero → null
      expect(readRemoteAdwVersion('nonexistent-branch-xyz', ws)).toBeNull();
    });

    it('returns null when git show throws (invalid workspacePath)', () => {
      expect(readRemoteAdwVersion('main', '/nonexistent/path/that/does/not/exist')).toBeNull();
    });

    it('returns null when .adw-version is empty on the remote branch', () => {
      const ws = setupRemoteRepo('main', '');
      // Committed with empty content → git show returns '' → trimmed → null
      expect(readRemoteAdwVersion('main', ws)).toBeNull();
    });

    it('returns the REMOTE value, not the stale local .adw-version (immune to local drift)', () => {
      const REMOTE_HASH = SAMPLE_SHA;
      const STALE_LOCAL = OTHER_SHA;
      const ws = setupRemoteRepo('main', REMOTE_HASH);
      // Overwrite the local .adw-version with a stale hash (NOT committed to origin)
      writeFileSync(join(ws, ADW_VERSION_FILENAME), `${STALE_LOCAL}\n`);
      // readRemoteAdwVersion must return the REMOTE value, not the local one
      expect(readRemoteAdwVersion('main', ws)).toBe(REMOTE_HASH);
    });
  });
});
