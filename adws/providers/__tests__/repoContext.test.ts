import { describe, it, expect } from 'vitest';
import { parseOwnerRepoFromUrl, mintBoundProviders } from '../repoContext';
import { Platform, type RepoIdentifier } from '../types';

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

// ── mintBoundProviders ────────────────────────────────────────────────────────
//
// No filesystem, no git, no network: mintBoundProviders touches none of them,
// so these run over plain repoId/platform inputs with no fixtures.

function makeRepoId(overrides: Partial<RepoIdentifier> = {}): RepoIdentifier {
  return { owner: 'acme', repo: 'webapp', platform: Platform.GitHub, ...overrides };
}

describe('mintBoundProviders', () => {
  it('GitHub/GitHub mints all three providers bound to the supplied repoId', () => {
    const repoId = makeRepoId();
    const providers = mintBoundProviders({
      repoId,
      codeHostPlatform: Platform.GitHub,
      issueTrackerPlatform: Platform.GitHub,
    });
    expect(providers.issueTracker).toBeDefined();
    expect(providers.codeHost).toBeDefined();
    expect(providers.boardManager).toBeDefined();
    expect(providers.codeHost.getRepoIdentifier()).toEqual(repoId);
  });

  it('refuses an unsupported code-host platform by name, never substituting GitHub', () => {
    expect(() =>
      mintBoundProviders({
        repoId: makeRepoId(),
        codeHostPlatform: Platform.Bitbucket,
        issueTrackerPlatform: Platform.GitHub,
      }),
    ).toThrow(/bitbucket/);
  });

  it('refuses an unsupported issue-tracker platform by name, never substituting GitHub', () => {
    expect(() =>
      mintBoundProviders({
        repoId: makeRepoId(),
        codeHostPlatform: Platform.GitHub,
        issueTrackerPlatform: Platform.GitLab,
      }),
    ).toThrow(/gitlab/);
  });

  it('throws through validateRepoIdentifier for an empty owner', () => {
    expect(() =>
      mintBoundProviders({
        repoId: makeRepoId({ owner: '' }),
        codeHostPlatform: Platform.GitHub,
        issueTrackerPlatform: Platform.GitHub,
      }),
    ).toThrow(/owner/);
  });

  it('throws through validateRepoIdentifier for an empty repo', () => {
    expect(() =>
      mintBoundProviders({
        repoId: makeRepoId({ repo: '' }),
        codeHostPlatform: Platform.GitHub,
        issueTrackerPlatform: Platform.GitHub,
      }),
    ).toThrow(/repo/);
  });

  it('returns a frozen triple', () => {
    const providers = mintBoundProviders({
      repoId: makeRepoId(),
      codeHostPlatform: Platform.GitHub,
      issueTrackerPlatform: Platform.GitHub,
    });
    expect(Object.isFrozen(providers)).toBe(true);
  });

  it('two calls with the same repoId mint distinct codeHost/issueTracker instances', () => {
    const repoId = makeRepoId();
    const first = mintBoundProviders({ repoId, codeHostPlatform: Platform.GitHub, issueTrackerPlatform: Platform.GitHub });
    const second = mintBoundProviders({ repoId, codeHostPlatform: Platform.GitHub, issueTrackerPlatform: Platform.GitHub });
    expect(first.codeHost).not.toBe(second.codeHost);
    expect(first.issueTracker).not.toBe(second.issueTracker);
  });
});
