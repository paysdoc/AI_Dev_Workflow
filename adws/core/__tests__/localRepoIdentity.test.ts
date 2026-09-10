import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { readLocalRepoIdentity } from '../localRepoIdentity';
import { Platform } from '../../providers/types';

describe('readLocalRepoIdentity — injected reader', () => {
  it.each([
    ['https://github.com/acme/webapp', 'acme', 'webapp'],
    ['https://github.com/acme/webapp.git', 'acme', 'webapp'],
    ['https://github.com/acme/webapp/', 'acme', 'webapp'],
    ['git@github.com:acme/webapp.git', 'acme', 'webapp'],
    ['git@github.com:acme/webapp', 'acme', 'webapp'],
    ['https://x-access-token:TOKEN@github.com/acme/webapp.git', 'acme', 'webapp'],
    ['ssh://git@github.com/acme/webapp', 'acme', 'webapp'],
    ['ssh://git@github.com/acme/webapp.git', 'acme', 'webapp'],
    ['https://github.com/paysdoc/paysdoc.nl', 'paysdoc', 'paysdoc.nl'],
    ['https://github.com/paysdoc/paysdoc.nl.git', 'paysdoc', 'paysdoc.nl'],
  ])('resolves %s to owner=%s repo=%s', (remote, owner, repo) => {
    const identity = readLocalRepoIdentity(undefined, { readRemoteUrl: () => remote });
    expect(identity).toEqual({ owner, repo, platform: Platform.GitHub });
  });

  it('resolves a non-GitHub HTTPS remote instead of throwing (a deliberate change from readLocalRepoInfo)', () => {
    const identity = readLocalRepoIdentity(undefined, { readRemoteUrl: () => 'https://gitlab.com/acme/webapp.git' });
    expect(identity).toEqual({ owner: 'acme', repo: 'webapp', platform: Platform.GitHub });
  });

  it('resolves a non-GitHub SCP-style SSH remote', () => {
    const identity = readLocalRepoIdentity(undefined, { readRemoteUrl: () => 'git@gitlab.com:acme/webapp.git' });
    expect(identity).toEqual({ owner: 'acme', repo: 'webapp', platform: Platform.GitHub });
  });

  it('throws "Failed to get repo info" with the inner parse failure for a garbage remote', () => {
    expect(() => readLocalRepoIdentity(undefined, { readRemoteUrl: () => 'not-a-url' })).toThrow(
      /Failed to get repo info:.*Could not parse owner\/repo from remote URL: not-a-url/s,
    );
  });

  it('wraps a throwing reader in "Failed to get repo info"', () => {
    expect(() =>
      readLocalRepoIdentity(undefined, {
        readRemoteUrl: () => { throw new Error('fatal: No such remote \'origin\''); },
      }),
    ).toThrow(/Failed to get repo info/);
  });

  it('passes the cwd argument through to the injected reader', () => {
    let receivedCwd: string | undefined;
    readLocalRepoIdentity('/some/worktree', {
      readRemoteUrl: (cwd) => {
        receivedCwd = cwd;
        return 'https://github.com/acme/webapp.git';
      },
    });
    expect(receivedCwd).toBe('/some/worktree');
  });
});

describe('readLocalRepoIdentity — real git remote (mirrors the #779 dotted-name proof)', () => {
  let tempDir = '';

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-844-'));
    execSync('git init -q', { cwd: tempDir, stdio: 'pipe' });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('resolves a dotted-name SSH remote to the full repository name', () => {
    execSync('git remote add origin git@github.com:paysdoc/paysdoc.nl.git', { cwd: tempDir, stdio: 'pipe' });
    expect(readLocalRepoIdentity(tempDir)).toEqual({ owner: 'paysdoc', repo: 'paysdoc.nl', platform: Platform.GitHub });
  });

  it('throws "Failed to get repo info" when there is no origin remote', () => {
    expect(() => readLocalRepoIdentity(tempDir)).toThrow(/Failed to get repo info/);
  });
});
