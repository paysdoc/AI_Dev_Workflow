import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { validateGitRemote, bindWorkspaceContext } from '../workspaceBinding';
import { Platform, type RepoIdentifier, type BoundProviders } from '../../providers/types';
import type { LaunchBoundary } from '../launchGitContext';

function repoId(overrides: Partial<RepoIdentifier> = {}): RepoIdentifier {
  return { owner: 'acme', repo: 'webapp', platform: Platform.GitHub, ...overrides };
}

// ── validateGitRemote ─────────────────────────────────────────────────────────

describe('validateGitRemote', () => {
  it('accepts an HTTPS remote matching the declared identity', () => {
    const ctx = { remoteUrl: () => 'https://github.com/acme/webapp.git' };
    expect(() => validateGitRemote(ctx, '/some/dir', repoId())).not.toThrow();
  });

  it('accepts an SSH remote matching the declared identity', () => {
    const ctx = { remoteUrl: () => 'git@github.com:acme/webapp.git' };
    expect(() => validateGitRemote(ctx, '/some/dir', repoId())).not.toThrow();
  });

  it('accepts a case-variant match', () => {
    const ctx = { remoteUrl: () => 'https://github.com/ACME/WebApp.git' };
    expect(() => validateGitRemote(ctx, '/some/dir', repoId())).not.toThrow();
  });

  it('refuses a wrong owner, naming both owners', () => {
    const ctx = { remoteUrl: () => 'https://github.com/octo/webapp.git' };
    expect(() => validateGitRemote(ctx, '/some/dir', repoId())).toThrow(
      'Git remote does not match declared repo. Remote owner "octo" !== declared owner "acme"',
    );
  });

  it('refuses a wrong repo, naming both repos', () => {
    const ctx = { remoteUrl: () => 'https://github.com/acme/infra.git' };
    expect(() => validateGitRemote(ctx, '/some/dir', repoId())).toThrow(
      'Git remote does not match declared repo. Remote repo "infra" !== declared repo "webapp"',
    );
  });

  it('refuses an unparsable remote URL', () => {
    const ctx = { remoteUrl: () => 'not-a-url' };
    expect(() => validateGitRemote(ctx, '/some/dir', repoId())).toThrow(/Could not parse owner\/repo/);
  });

  it('wraps a throwing reader into the "Failed to get git remote URL" message', () => {
    const ctx = { remoteUrl: () => { throw new Error('no such remote'); } };
    expect(() => validateGitRemote(ctx, '/some/dir', repoId())).toThrow(/Failed to get git remote URL in \/some\/dir/);
  });

  it('reads the remote in the given cwd', () => {
    let seenCwd: string | undefined;
    const ctx = { remoteUrl: (cwd?: string) => { seenCwd = cwd; return 'https://github.com/acme/webapp.git'; } };
    validateGitRemote(ctx, '/a/specific/dir', repoId());
    expect(seenCwd).toBe('/a/specific/dir');
  });
});

// ── bindWorkspaceContext ──────────────────────────────────────────────────────

function makeProviders(): BoundProviders {
  return Object.freeze({
    issueTracker: {} as BoundProviders['issueTracker'],
    codeHost: {} as BoundProviders['codeHost'],
    boardManager: {} as BoundProviders['boardManager'],
  });
}

describe('bindWorkspaceContext', () => {
  let tempDir: string | null = null;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  function makeWorkspace(): string {
    tempDir = mkdtempSync(join(tmpdir(), 'adw-wsbinding-'));
    mkdirSync(join(tempDir, '.git'));
    return tempDir;
  }

  it('refuses a mismatched repoId before boundary.providers is read (no mint, no config read)', () => {
    const cwd = makeWorkspace();
    let providersRead = false;
    const boundary = {
      gitContext: { remoteUrl: () => 'https://github.com/acme/webapp.git' },
      repoId: repoId(),
      get providers(): BoundProviders { providersRead = true; return makeProviders(); },
    } as unknown as LaunchBoundary;

    expect(() => bindWorkspaceContext(boundary, cwd, repoId({ owner: 'octo', repo: 'infra' }))).toThrow(
      "bindWorkspaceContext: octo/infra does not match the launch boundary's acme/webapp",
    );
    expect(providersRead).toBe(false);
  });

  it('defaults repoId to the boundary\'s own, validates the workspace and reuses the boundary\'s instances', () => {
    const cwd = makeWorkspace();
    const providers = makeProviders();
    let seenCwd: string | undefined;
    const boundary = {
      gitContext: { remoteUrl: (dir?: string) => { seenCwd = dir; return 'https://github.com/acme/webapp.git'; } },
      repoId: repoId(),
      providers,
    } as unknown as LaunchBoundary;

    const result = bindWorkspaceContext(boundary, cwd);

    expect(seenCwd).toBe(cwd);
    expect(result.issueTracker).toBe(providers.issueTracker);
    expect(result.codeHost).toBe(providers.codeHost);
    expect(result.cwd).toBe(cwd);
    expect(result.repoId).toEqual(repoId());
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('honours an explicit, matching repoId (case-variant)', () => {
    const cwd = makeWorkspace();
    const providers = makeProviders();
    const boundary = {
      gitContext: { remoteUrl: () => 'https://github.com/acme/webapp.git' },
      repoId: repoId(),
      providers,
    } as unknown as LaunchBoundary;

    const variant = repoId({ owner: 'ACME', repo: 'WebApp' });
    expect(() => bindWorkspaceContext(boundary, cwd, variant)).not.toThrow();
  });

  it('refuses a workspace whose origin contradicts the boundary, naming the remote\'s actual owner', () => {
    const cwd = makeWorkspace();
    const boundary = {
      gitContext: { remoteUrl: () => 'https://github.com/octo/infra.git' },
      repoId: repoId(),
      providers: makeProviders(),
    } as unknown as LaunchBoundary;

    expect(() => bindWorkspaceContext(boundary, cwd)).toThrow(/octo/);
  });

  it('still requires an existing directory containing .git', () => {
    const boundary = {
      gitContext: { remoteUrl: () => 'https://github.com/acme/webapp.git' },
      repoId: repoId(),
      providers: makeProviders(),
    } as unknown as LaunchBoundary;

    expect(() => bindWorkspaceContext(boundary, '/no/such/directory/adw-wsbinding')).toThrow(/does not exist/);
  });
});
