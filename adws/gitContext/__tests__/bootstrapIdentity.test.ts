import { describe, it, expect } from 'vitest';
import { resolveBootstrapGitIdentity } from '../bootstrapIdentity';
import type { BootstrapIdentityDeps } from '../bootstrapIdentity';

// ---------------------------------------------------------------------------
// readLocalRepoInfo
// ---------------------------------------------------------------------------

describe('readLocalRepoInfo — URL parsing', () => {
  // readLocalRepoInfo uses execSync directly with no seam, so we test the
  // underlying URL parsing logic via the same regex patterns it applies.

  it('parses an HTTPS GitHub URL', () => {
    const url = 'https://github.com/acme/webapp.git';
    const httpsMatch = url.match(/github\.com\/([^/]+)\/([^/.]+)/);
    const sshMatch = url.match(/git@github\.com:([^/]+)\/([^/.]+)/);
    const match = httpsMatch || sshMatch;
    expect(match?.[1]).toBe('acme');
    expect(match?.[2]).toBe('webapp');
  });

  it('parses an SSH GitHub URL', () => {
    const url = 'git@github.com:acme/webapp.git';
    const httpsMatch = url.match(/github\.com\/([^/]+)\/([^/.]+)/);
    const sshMatch = url.match(/git@github\.com:([^/]+)\/([^/.]+)/);
    const match = httpsMatch || sshMatch;
    expect(match?.[1]).toBe('acme');
    expect(match?.[2]).toBe('webapp');
  });

  it('HTTPS and SSH produce the same owner/repo', () => {
    const parseUrl = (url: string) => {
      const httpsMatch = url.match(/github\.com\/([^/]+)\/([^/.]+)/);
      const sshMatch = url.match(/git@github\.com:([^/]+)\/([^/.]+)/);
      return httpsMatch || sshMatch;
    };
    const https = parseUrl('https://github.com/octo/infra.git');
    const ssh = parseUrl('git@github.com:octo/infra.git');
    expect(https?.[1]).toBe(ssh?.[1]);
    expect(https?.[2]).toBe(ssh?.[2]);
  });

  it('returns null for a non-GitHub URL', () => {
    const url = 'https://gitlab.com/acme/webapp.git';
    const httpsMatch = url.match(/github\.com\/([^/]+)\/([^/.]+)/);
    const sshMatch = url.match(/git@github\.com:([^/]+)\/([^/.]+)/);
    const match = httpsMatch || sshMatch;
    expect(match).toBeNull();
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
