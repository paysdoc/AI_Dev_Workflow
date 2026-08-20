import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { resolveBootstrapGitIdentity, parseGitHubRemoteUrl, readLocalRepoInfo } from '../githubIdentity';
import type { BootstrapIdentityDeps } from '../githubIdentity';
import { getRepoInfo } from '../../../github/githubApi';

// ---------------------------------------------------------------------------
// parseGitHubRemoteUrl
// ---------------------------------------------------------------------------

describe('parseGitHubRemoteUrl', () => {
  it.each([
    ['https://github.com/acme/webapp.git', 'acme', 'webapp'],
    ['git@github.com:acme/webapp.git', 'acme', 'webapp'],
    ['https://github.com/octo/infra.git', 'octo', 'infra'],
    ['git@github.com:octo/infra.git', 'octo', 'infra'],
  ])('parses %s as owner/repo (dot-free regression)', (url, owner, repo) => {
    expect(parseGitHubRemoteUrl(url)).toEqual({ owner, repo });
  });

  it('returns null for a non-GitHub URL', () => {
    expect(parseGitHubRemoteUrl('https://gitlab.com/acme/webapp.git')).toBeNull();
  });

  // The bug (issue #779): `([^/.]+)` stopped at the FIRST dot, so
  // `paysdoc.nl` truncated to `paysdoc`. All four canonical forms must
  // resolve to the full dotted name.
  it.each([
    ['git@github.com:paysdoc/paysdoc.nl.git', 'paysdoc', 'paysdoc.nl'],
    ['git@github.com:paysdoc/paysdoc.nl', 'paysdoc', 'paysdoc.nl'],
    ['https://github.com/paysdoc/paysdoc.nl.git', 'paysdoc', 'paysdoc.nl'],
    ['https://github.com/paysdoc/paysdoc.nl', 'paysdoc', 'paysdoc.nl'],
  ])('parses %s as the full dotted repository name', (url, owner, repo) => {
    expect(parseGitHubRemoteUrl(url)).toEqual({ owner, repo });
  });

  // The rest of the dotted family — multi-dot, GitHub Pages, trailing slash,
  // and a leading-dot name (which the old class couldn't match AT ALL,
  // because it required a non-dot character immediately after the slash).
  it.each([
    ['git@github.com:paysdoc/a.b.c.git', 'paysdoc', 'a.b.c'],
    ['git@github.com:paysdoc/paysdoc.github.io.git', 'paysdoc', 'paysdoc.github.io'],
    ['https://github.com/paysdoc/paysdoc.nl/', 'paysdoc', 'paysdoc.nl'],
    ['git@github.com:paysdoc/.github.git', 'paysdoc', '.github'],
  ])('parses %s as owner/repo (rest of the dotted family)', (url, owner, repo) => {
    expect(parseGitHubRemoteUrl(url)).toEqual({ owner, repo });
  });

  // Only the TRAILING .git is stripped — a repo whose real name ends in
  // ".git" keeps it.
  it('strips only the trailing .git suffix', () => {
    expect(parseGitHubRemoteUrl('https://github.com/paysdoc/repo.git.git')).toEqual({
      owner: 'paysdoc',
      repo: 'repo.git',
    });
  });

  // Tolerated forms that must keep working: SSH without .git, trailing
  // slash, credential-bearing (App-push) HTTPS, and the ssh:// scheme form.
  it.each([
    ['git@github.com:acme/webapp', 'acme', 'webapp'],
    ['https://github.com/acme/webapp/', 'acme', 'webapp'],
    ['ssh://git@github.com/acme/webapp.git', 'acme', 'webapp'],
    ['https://x-access-token:TOK@github.com/acme/webapp.git', 'acme', 'webapp'],
  ])('tolerates %s', (url, owner, repo) => {
    expect(parseGitHubRemoteUrl(url)).toEqual({ owner, repo });
  });

  // Non-GitHub remotes still return null rather than a fabricated identity —
  // including the Bitbucket SSH form, which must not be caught by the SSH pattern.
  it.each([
    ['https://gitlab.com/acme/webapp.git'],
    ['git@bitbucket.org:acme/webapp.git'],
  ])('returns null for the non-GitHub remote %s', (url) => {
    expect(parseGitHubRemoteUrl(url)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// readLocalRepoInfo — end-to-end against a real throwaway git repo
// ---------------------------------------------------------------------------

describe('readLocalRepoInfo — real git remote (issue #779 end-to-end proof)', () => {
  let tempDir = '';

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-779-'));
    execSync('git init -q', { cwd: tempDir, stdio: 'pipe' });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('resolves a dotted-name SSH remote to the full repository name', () => {
    execSync('git remote add origin git@github.com:paysdoc/paysdoc.nl.git', { cwd: tempDir, stdio: 'pipe' });
    expect(readLocalRepoInfo(tempDir)).toEqual({ owner: 'paysdoc', repo: 'paysdoc.nl' });
  });

  it('resolves a dotted-name HTTPS remote to the full repository name', () => {
    execSync('git remote add origin https://github.com/paysdoc/paysdoc.nl.git', { cwd: tempDir, stdio: 'pipe' });
    expect(readLocalRepoInfo(tempDir)).toEqual({ owner: 'paysdoc', repo: 'paysdoc.nl' });
  });

  it('getRepoInfo agrees with readLocalRepoInfo on the dotted clone (one shared parse)', () => {
    execSync('git remote add origin git@github.com:paysdoc/paysdoc.nl.git', { cwd: tempDir, stdio: 'pipe' });
    expect(getRepoInfo(tempDir)).toEqual(readLocalRepoInfo(tempDir));
    expect(getRepoInfo(tempDir)).toEqual({ owner: 'paysdoc', repo: 'paysdoc.nl' });
  });

  it('throws with a "Failed to get repo info" message for a non-GitHub remote', () => {
    execSync('git remote add origin https://gitlab.com/acme/webapp.git', { cwd: tempDir, stdio: 'pipe' });
    expect(() => readLocalRepoInfo(tempDir)).toThrow(/Failed to get repo info/);
  });
});

// ---------------------------------------------------------------------------
// resolveBootstrapGitIdentity
// ---------------------------------------------------------------------------

describe('resolveBootstrapGitIdentity — resolution order', () => {
  const appEnv = {
    GITHUB_APP_ID: '12345',
    GITHUB_APP_SLUG: 'my-app',
    GITHUB_APP_PRIVATE_KEY_PATH: '/path/to/key',
  };

  it('App-slug bot identity wins when App is configured', () => {
    const identity = resolveBootstrapGitIdentity({
      env: { ...appEnv, GIT_AUTHOR_NAME: 'Should Not Win' },
      isAppConfigured: () => true,
    });
    expect(identity.authorName).toBe('my-app[bot]');
    expect(identity.authorEmail).toContain('12345+my-app[bot]');
  });

  it('env vars win when App is not configured', () => {
    const identity = resolveBootstrapGitIdentity({
      env: { GIT_AUTHOR_NAME: 'CI Bot', GIT_AUTHOR_EMAIL: 'ci@test.dev' },
      isAppConfigured: () => false,
    });
    expect(identity.authorName).toBe('CI Bot');
    expect(identity.authorEmail).toBe('ci@test.dev');
  });

  it('falls back to git-config when no env vars are set', () => {
    const fakeExec = (cmd: string, _opts: unknown) => {
      if (cmd === 'git config user.name') return 'Config Bot\n';
      if (cmd === 'git config user.email') return 'config@bot.dev\n';
      throw new Error(`Unexpected: ${cmd}`);
    };
    const identity = resolveBootstrapGitIdentity({
      env: {},
      isAppConfigured: () => false,
      exec: fakeExec as unknown as BootstrapIdentityDeps['exec'],
    });
    expect(identity.authorName).toBe('Config Bot');
    expect(identity.authorEmail).toBe('config@bot.dev');
  });

  it('falls back to ADW Bot default when nothing is available', () => {
    const identity = resolveBootstrapGitIdentity({
      env: {},
      isAppConfigured: () => false,
      exec: () => { throw new Error('git not available'); },
    });
    expect(identity.authorName).toBe('ADW Bot');
    expect(identity.authorEmail).toBe('adw-bot@users.noreply.github.com');
  });

  it('never returns empty fields', () => {
    const identity = resolveBootstrapGitIdentity({
      env: {},
      isAppConfigured: () => false,
      exec: () => { throw new Error('fail'); },
    });
    expect(identity.authorName.trim()).not.toBe('');
    expect(identity.authorEmail.trim()).not.toBe('');
    expect(identity.committerName.trim()).not.toBe('');
    expect(identity.committerEmail.trim()).not.toBe('');
  });

  it('App identity has the correct bot-email format', () => {
    const identity = resolveBootstrapGitIdentity({
      env: appEnv,
      isAppConfigured: () => true,
    });
    expect(identity.authorEmail).toBe('12345+my-app[bot]@users.noreply.github.com');
    expect(identity.committerEmail).toBe(identity.authorEmail);
  });
});
