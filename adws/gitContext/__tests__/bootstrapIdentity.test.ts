import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { readOriginRemoteUrl, readEnvGitIdentity, readGitConfigIdentity } from '../bootstrapIdentity';

// ---------------------------------------------------------------------------
// readOriginRemoteUrl — real git remote, generic read (no parse, no forge)
// ---------------------------------------------------------------------------

describe('readOriginRemoteUrl', () => {
  let tempDir = '';

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-793-core-'));
    execSync('git init -q', { cwd: tempDir, stdio: 'pipe' });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns the trimmed remote URL of a throwaway repo', () => {
    execSync('git remote add origin https://git.acme.internal/acme/webapp.git', { cwd: tempDir, stdio: 'pipe' });
    expect(readOriginRemoteUrl(tempDir)).toBe('https://git.acme.internal/acme/webapp.git');
  });

  it('returns a GitHub remote URL unchanged — no parse, no forge judgment', () => {
    execSync('git remote add origin git@github.com:paysdoc/paysdoc.nl.git', { cwd: tempDir, stdio: 'pipe' });
    expect(readOriginRemoteUrl(tempDir)).toBe('git@github.com:paysdoc/paysdoc.nl.git');
  });

  it('propagates the git failure when there is no origin remote', () => {
    expect(() => readOriginRemoteUrl(tempDir)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// readEnvGitIdentity — GIT_AUTHOR_* / GIT_COMMITTER_*, pure
// ---------------------------------------------------------------------------

describe('readEnvGitIdentity', () => {
  it('returns null on an incomplete env', () => {
    expect(readEnvGitIdentity({ GIT_AUTHOR_NAME: 'CI Bot' })).toBeNull();
  });

  it('returns null when the env has neither author nor committer fields', () => {
    expect(readEnvGitIdentity({ ADW_UNRELATED: '1' })).toBeNull();
  });

  it('returns a complete identity when GIT_AUTHOR_* is fully set, defaulting committer to author', () => {
    const identity = readEnvGitIdentity({ GIT_AUTHOR_NAME: 'CI Bot', GIT_AUTHOR_EMAIL: 'ci@test.dev' });
    expect(identity).toEqual({
      authorName: 'CI Bot',
      authorEmail: 'ci@test.dev',
      committerName: 'CI Bot',
      committerEmail: 'ci@test.dev',
    });
  });

  it('honours distinct GIT_COMMITTER_* values when set', () => {
    const identity = readEnvGitIdentity({
      GIT_AUTHOR_NAME: 'CI Bot',
      GIT_AUTHOR_EMAIL: 'ci@test.dev',
      GIT_COMMITTER_NAME: 'Merge Bot',
      GIT_COMMITTER_EMAIL: 'merge@test.dev',
    });
    expect(identity).toEqual({
      authorName: 'CI Bot',
      authorEmail: 'ci@test.dev',
      committerName: 'Merge Bot',
      committerEmail: 'merge@test.dev',
    });
  });

  it('never fabricates a forge address — no GitHub-shaped default', () => {
    const identity = readEnvGitIdentity({});
    expect(identity).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// readGitConfigIdentity — `git config user.name` / `user.email`
// ---------------------------------------------------------------------------

describe('readGitConfigIdentity', () => {
  it('returns null when git config throws', () => {
    const identity = readGitConfigIdentity({
      env: {},
      exec: () => { throw new Error('git not available'); },
    });
    expect(identity).toBeNull();
  });

  it('returns the git-config identity exactly as git config holds it', () => {
    const fakeExec = (cmd: string) => {
      if (cmd === 'git config user.name') return 'Config Bot\n';
      if (cmd === 'git config user.email') return 'config@bot.dev\n';
      throw new Error(`Unexpected: ${cmd}`);
    };
    const identity = readGitConfigIdentity({ exec: fakeExec as never });
    expect(identity).toEqual({
      authorName: 'Config Bot',
      authorEmail: 'config@bot.dev',
      committerName: 'Config Bot',
      committerEmail: 'config@bot.dev',
    });
  });

  it('returns null when git config resolves an empty name or email', () => {
    const fakeExec = (cmd: string) => {
      if (cmd === 'git config user.name') return '';
      if (cmd === 'git config user.email') return 'config@bot.dev\n';
      throw new Error(`Unexpected: ${cmd}`);
    };
    expect(readGitConfigIdentity({ exec: fakeExec as never })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC pin — no forge vocabulary survives in the core module's source (issue #793)
// ---------------------------------------------------------------------------

describe('bootstrapIdentity.ts source — no forge vocabulary (AC2)', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'bootstrapIdentity.ts'), 'utf-8');

  it('contains no github.com literal', () => {
    expect(source).not.toContain('github.com');
  });

  it('contains no gh CLI command string', () => {
    expect(source).not.toMatch(/['"]gh /);
  });
});
