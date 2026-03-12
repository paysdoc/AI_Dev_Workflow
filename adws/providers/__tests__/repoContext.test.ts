import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Platform, type RepoIdentifier } from '../types';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  statSync: vi.fn(),
}));

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('../github/githubIssueTracker', () => ({
  createGitHubIssueTracker: vi.fn(),
}));

vi.mock('../github/githubCodeHost', () => ({
  createGitHubCodeHost: vi.fn(),
}));

vi.mock('../gitlab/gitlabCodeHost', () => ({
  createGitLabCodeHost: vi.fn(),
}));

import { existsSync, readFileSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { createGitHubIssueTracker } from '../github/githubIssueTracker';
import { createGitHubCodeHost } from '../github/githubCodeHost';
import { createGitLabCodeHost } from '../gitlab/gitlabCodeHost';
import {
  createRepoContext,
  loadProviderConfig,
  validateWorkingDirectory,
  validateGitRemote,
  resolveIssueTracker,
  resolveCodeHost,
  parseOwnerRepoFromUrl,
} from '../repoContext';

const validRepoId: RepoIdentifier = {
  owner: 'acme',
  repo: 'widgets',
  platform: Platform.GitHub,
};

const mockIssueTracker = {
  fetchIssue: vi.fn(),
  commentOnIssue: vi.fn(),
  deleteComment: vi.fn(),
  closeIssue: vi.fn(),
  getIssueState: vi.fn(),
  fetchComments: vi.fn(),
  moveToStatus: vi.fn(),
};

const mockCodeHost = {
  getDefaultBranch: vi.fn(),
  createMergeRequest: vi.fn(),
  fetchMergeRequest: vi.fn(),
  commentOnMergeRequest: vi.fn(),
  fetchReviewComments: vi.fn(),
  listOpenMergeRequests: vi.fn(),
  getRepoIdentifier: vi.fn(),
};

function setupValidEnvironment(): void {
  vi.mocked(existsSync).mockImplementation((p: unknown) => {
    const path = String(p);
    if (path.endsWith('.git')) return true;
    if (path.endsWith('providers.md')) return false;
    return true;
  });
  vi.mocked(statSync).mockReturnValue({ isDirectory: () => true } as ReturnType<typeof statSync>);
  vi.mocked(execSync).mockReturnValue('https://github.com/acme/widgets.git\n');
  vi.mocked(createGitHubIssueTracker).mockReturnValue(mockIssueTracker);
  vi.mocked(createGitHubCodeHost).mockReturnValue(mockCodeHost);
  vi.mocked(createGitLabCodeHost).mockReturnValue(mockCodeHost);
}

describe('loadProviderConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns GitHub defaults when .adw/providers.md is absent', () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const config = loadProviderConfig('/tmp/repo');

    expect(config).toEqual({
      codeHost: Platform.GitHub,
      issueTracker: Platform.GitHub,
    });
  });

  it('parses both sections from providers.md', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      '## Code Host\ngithub\n\n## Issue Tracker\ngithub\n',
    );

    const config = loadProviderConfig('/tmp/repo');

    expect(config).toEqual({
      codeHost: Platform.GitHub,
      issueTracker: Platform.GitHub,
    });
  });

  it('uses default for missing issue tracker section', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('## Code Host\ngithub\n');

    const config = loadProviderConfig('/tmp/repo');

    expect(config.codeHost).toBe(Platform.GitHub);
    expect(config.issueTracker).toBe(Platform.GitHub);
  });

  it('uses default for missing code host section', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('## Issue Tracker\ngithub\n');

    const config = loadProviderConfig('/tmp/repo');

    expect(config.codeHost).toBe(Platform.GitHub);
    expect(config.issueTracker).toBe(Platform.GitHub);
  });

  it('throws on unknown platform value', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('## Code Host\njira\n');

    expect(() => loadProviderConfig('/tmp/repo')).toThrow(
      'Unknown platform "jira" in ## Code Host section',
    );
  });

  it('handles case-insensitive platform values', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      '## Code Host\nGitHub\n\n## Issue Tracker\nGITHUB\n',
    );

    const config = loadProviderConfig('/tmp/repo');

    expect(config.codeHost).toBe(Platform.GitHub);
    expect(config.issueTracker).toBe(Platform.GitHub);
  });

  it('trims whitespace around platform values', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      '## Code Host\n  github  \n\n## Issue Tracker\n  github  \n',
    );

    const config = loadProviderConfig('/tmp/repo');

    expect(config.codeHost).toBe(Platform.GitHub);
    expect(config.issueTracker).toBe(Platform.GitHub);
  });

  it('ignores extra markdown content around sections', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      '# Provider Configuration\n\nSome intro text.\n\n## Code Host\ngithub\n\n## Issue Tracker\ngithub\n\n## Notes\nOther stuff.\n',
    );

    const config = loadProviderConfig('/tmp/repo');

    expect(config).toEqual({
      codeHost: Platform.GitHub,
      issueTracker: Platform.GitHub,
    });
  });

  it('handles empty file gracefully (returns defaults)', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('');

    const config = loadProviderConfig('/tmp/repo');

    expect(config).toEqual({
      codeHost: Platform.GitHub,
      issueTracker: Platform.GitHub,
    });
  });

  it('parses Code Host URL when present', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      '## Code Host\ngithub\n\n## Code Host URL\nhttps://github.enterprise.com\n',
    );

    const config = loadProviderConfig('/tmp/repo');

    expect(config.codeHostUrl).toBe('https://github.enterprise.com');
  });

  it('parses Issue Tracker URL when present', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      '## Issue Tracker\ngithub\n\n## Issue Tracker URL\nhttps://jira.example.com\n',
    );

    const config = loadProviderConfig('/tmp/repo');

    expect(config.issueTrackerUrl).toBe('https://jira.example.com');
  });

  it('parses Issue Tracker Project Key when present', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      '## Issue Tracker\ngithub\n\n## Issue Tracker Project Key\nMYPROJ\n',
    );

    const config = loadProviderConfig('/tmp/repo');

    expect(config.issueTrackerProjectKey).toBe('MYPROJ');
  });

  it('returns undefined for URL fields when sections are absent', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      '## Code Host\ngithub\n\n## Issue Tracker\ngithub\n',
    );

    const config = loadProviderConfig('/tmp/repo');

    expect(config.codeHostUrl).toBeUndefined();
    expect(config.issueTrackerUrl).toBeUndefined();
    expect(config.issueTrackerProjectKey).toBeUndefined();
  });

  it('parses all fields together', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      [
        '## Code Host',
        'github',
        '',
        '## Code Host URL',
        'https://github.enterprise.com',
        '',
        '## Issue Tracker',
        'github',
        '',
        '## Issue Tracker URL',
        'https://jira.example.com',
        '',
        '## Issue Tracker Project Key',
        'PROJ-KEY',
      ].join('\n'),
    );

    const config = loadProviderConfig('/tmp/repo');

    expect(config.codeHost).toBe(Platform.GitHub);
    expect(config.codeHostUrl).toBe('https://github.enterprise.com');
    expect(config.issueTracker).toBe(Platform.GitHub);
    expect(config.issueTrackerUrl).toBe('https://jira.example.com');
    expect(config.issueTrackerProjectKey).toBe('PROJ-KEY');
  });
});

describe('validateWorkingDirectory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes for a valid git directory', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(statSync).mockReturnValue({ isDirectory: () => true } as ReturnType<typeof statSync>);

    expect(() => validateWorkingDirectory('/tmp/repo')).not.toThrow();
  });

  it('throws when directory does not exist', () => {
    vi.mocked(existsSync).mockReturnValue(false);

    expect(() => validateWorkingDirectory('/nonexistent')).toThrow(
      'Working directory does not exist: /nonexistent',
    );
  });

  it('throws when path is not a directory', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(statSync).mockReturnValue({ isDirectory: () => false } as ReturnType<typeof statSync>);

    expect(() => validateWorkingDirectory('/tmp/file.txt')).toThrow(
      'Working directory is not a directory: /tmp/file.txt',
    );
  });

  it('throws when .git is missing', () => {
    vi.mocked(existsSync).mockImplementation((p: unknown) => {
      const path = String(p);
      return !path.endsWith('.git');
    });
    vi.mocked(statSync).mockReturnValue({ isDirectory: () => true } as ReturnType<typeof statSync>);

    expect(() => validateWorkingDirectory('/tmp/not-a-repo')).toThrow(
      'not a git repository',
    );
  });
});

describe('validateGitRemote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes for matching HTTPS remote', () => {
    vi.mocked(execSync).mockReturnValue('https://github.com/acme/widgets.git\n');

    expect(() => validateGitRemote('/tmp/repo', validRepoId)).not.toThrow();
  });

  it('passes for matching SSH remote', () => {
    vi.mocked(execSync).mockReturnValue('git@github.com:acme/widgets.git\n');

    expect(() => validateGitRemote('/tmp/repo', validRepoId)).not.toThrow();
  });

  it('passes for HTTPS remote without .git suffix', () => {
    vi.mocked(execSync).mockReturnValue('https://github.com/acme/widgets\n');

    expect(() => validateGitRemote('/tmp/repo', validRepoId)).not.toThrow();
  });

  it('is case-insensitive for owner comparison', () => {
    vi.mocked(execSync).mockReturnValue('https://github.com/ACME/widgets.git\n');

    expect(() => validateGitRemote('/tmp/repo', validRepoId)).not.toThrow();
  });

  it('is case-insensitive for repo comparison', () => {
    vi.mocked(execSync).mockReturnValue('https://github.com/acme/WIDGETS.git\n');

    expect(() => validateGitRemote('/tmp/repo', validRepoId)).not.toThrow();
  });

  it('throws on mismatched owner', () => {
    vi.mocked(execSync).mockReturnValue('https://github.com/other/widgets.git\n');

    expect(() => validateGitRemote('/tmp/repo', validRepoId)).toThrow(
      'Git remote does not match declared repo. Remote owner "other" !== declared owner "acme"',
    );
  });

  it('throws on mismatched repo', () => {
    vi.mocked(execSync).mockReturnValue('https://github.com/acme/other-repo.git\n');

    expect(() => validateGitRemote('/tmp/repo', validRepoId)).toThrow(
      'Git remote does not match declared repo. Remote repo "other-repo" !== declared repo "widgets"',
    );
  });

  it('throws when git remote command fails', () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('fatal: No such remote');
    });

    expect(() => validateGitRemote('/tmp/repo', validRepoId)).toThrow(
      "Failed to get git remote URL in /tmp/repo. Ensure the repository has an 'origin' remote configured.",
    );
  });

  it('throws when remote URL cannot be parsed', () => {
    vi.mocked(execSync).mockReturnValue('ftp://example.com/repo\n');

    expect(() => validateGitRemote('/tmp/repo', validRepoId)).toThrow(
      'Could not parse owner/repo from git remote URL',
    );
  });

  it('passes for GitLab HTTPS remote', () => {
    const gitlabRepoId: RepoIdentifier = { owner: 'acme', repo: 'widgets', platform: Platform.GitLab };
    vi.mocked(execSync).mockReturnValue('https://gitlab.com/acme/widgets.git\n');

    expect(() => validateGitRemote('/tmp/repo', gitlabRepoId)).not.toThrow();
  });

  it('passes for GitLab SSH remote', () => {
    const gitlabRepoId: RepoIdentifier = { owner: 'acme', repo: 'widgets', platform: Platform.GitLab };
    vi.mocked(execSync).mockReturnValue('git@gitlab.com:acme/widgets.git\n');

    expect(() => validateGitRemote('/tmp/repo', gitlabRepoId)).not.toThrow();
  });

  it('passes for self-hosted GitLab HTTPS remote', () => {
    const gitlabRepoId: RepoIdentifier = { owner: 'team', repo: 'project', platform: Platform.GitLab };
    vi.mocked(execSync).mockReturnValue('https://gitlab.example.com/team/project.git\n');

    expect(() => validateGitRemote('/tmp/repo', gitlabRepoId)).not.toThrow();
  });
});

describe('parseOwnerRepoFromUrl', () => {
  it('parses GitHub HTTPS URL', () => {
    const result = parseOwnerRepoFromUrl('https://github.com/acme/widgets.git');
    expect(result).toEqual({ owner: 'acme', repo: 'widgets' });
  });

  it('parses GitHub SSH URL', () => {
    const result = parseOwnerRepoFromUrl('git@github.com:acme/widgets.git');
    expect(result).toEqual({ owner: 'acme', repo: 'widgets' });
  });

  it('parses GitLab HTTPS URL', () => {
    const result = parseOwnerRepoFromUrl('https://gitlab.com/acme/widgets.git');
    expect(result).toEqual({ owner: 'acme', repo: 'widgets' });
  });

  it('parses GitLab SSH URL', () => {
    const result = parseOwnerRepoFromUrl('git@gitlab.com:acme/widgets.git');
    expect(result).toEqual({ owner: 'acme', repo: 'widgets' });
  });

  it('parses self-hosted GitLab HTTPS URL', () => {
    const result = parseOwnerRepoFromUrl('https://gitlab.example.com/team/project.git');
    expect(result).toEqual({ owner: 'team', repo: 'project' });
  });

  it('parses self-hosted GitLab SSH URL', () => {
    const result = parseOwnerRepoFromUrl('git@gitlab.example.com:team/project.git');
    expect(result).toEqual({ owner: 'team', repo: 'project' });
  });

  it('parses URL without .git suffix', () => {
    const result = parseOwnerRepoFromUrl('https://gitlab.com/acme/widgets');
    expect(result).toEqual({ owner: 'acme', repo: 'widgets' });
  });

  it('returns null for unparseable URL', () => {
    const result = parseOwnerRepoFromUrl('ftp://example.com/repo');
    expect(result).toBeNull();
  });
});

describe('resolveIssueTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns GitHub issue tracker for Platform.GitHub', () => {
    vi.mocked(createGitHubIssueTracker).mockReturnValue(mockIssueTracker);

    const tracker = resolveIssueTracker(Platform.GitHub, validRepoId);

    expect(createGitHubIssueTracker).toHaveBeenCalledWith(validRepoId);
    expect(tracker).toBe(mockIssueTracker);
  });

  it('throws for unsupported platform GitLab', () => {
    expect(() => resolveIssueTracker(Platform.GitLab, validRepoId)).toThrow(
      'Unsupported issue tracker platform: gitlab',
    );
  });

  it('throws for unsupported platform Bitbucket', () => {
    expect(() => resolveIssueTracker(Platform.Bitbucket, validRepoId)).toThrow(
      'Unsupported issue tracker platform: bitbucket',
    );
  });
});

describe('resolveCodeHost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns GitHub code host for Platform.GitHub', () => {
    vi.mocked(createGitHubCodeHost).mockReturnValue(mockCodeHost);

    const host = resolveCodeHost(Platform.GitHub, validRepoId);

    expect(createGitHubCodeHost).toHaveBeenCalledWith(validRepoId);
    expect(host).toBe(mockCodeHost);
  });

  it('returns GitLab code host for Platform.GitLab', () => {
    vi.mocked(createGitLabCodeHost).mockReturnValue(mockCodeHost);

    const host = resolveCodeHost(Platform.GitLab, validRepoId);

    expect(createGitLabCodeHost).toHaveBeenCalledWith(validRepoId);
    expect(host).toBe(mockCodeHost);
  });

  it('throws for unsupported platform Bitbucket', () => {
    expect(() => resolveCodeHost(Platform.Bitbucket, validRepoId)).toThrow(
      'Unsupported code host platform: bitbucket',
    );
  });
});

describe('createRepoContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupValidEnvironment();
  });

  describe('successful creation', () => {
    it('returns a RepoContext with correct fields', () => {
      const ctx = createRepoContext({ repoId: validRepoId, cwd: '/tmp/repo' });

      expect(ctx.cwd).toBe('/tmp/repo');
      expect(ctx.repoId).toEqual(validRepoId);
      expect(ctx.issueTracker).toBe(mockIssueTracker);
      expect(ctx.codeHost).toBe(mockCodeHost);
    });

    it('delegates to GitHub provider factories', () => {
      createRepoContext({ repoId: validRepoId, cwd: '/tmp/repo' });

      expect(createGitHubIssueTracker).toHaveBeenCalledWith(validRepoId);
      expect(createGitHubCodeHost).toHaveBeenCalledWith(validRepoId);
    });
  });

  describe('validation failures', () => {
    it('throws on empty owner', () => {
      const badId = { owner: '', repo: 'widgets', platform: Platform.GitHub };

      expect(() => createRepoContext({ repoId: badId, cwd: '/tmp/repo' })).toThrow(
        'owner must not be empty',
      );
    });

    it('throws on whitespace-only owner', () => {
      const badId = { owner: '   ', repo: 'widgets', platform: Platform.GitHub };

      expect(() => createRepoContext({ repoId: badId, cwd: '/tmp/repo' })).toThrow(
        'owner must not be empty',
      );
    });

    it('throws on empty repo', () => {
      const badId = { owner: 'acme', repo: '', platform: Platform.GitHub };

      expect(() => createRepoContext({ repoId: badId, cwd: '/tmp/repo' })).toThrow(
        'repo must not be empty',
      );
    });

    it('throws on whitespace-only repo', () => {
      const badId = { owner: 'acme', repo: '  ', platform: Platform.GitHub };

      expect(() => createRepoContext({ repoId: badId, cwd: '/tmp/repo' })).toThrow(
        'repo must not be empty',
      );
    });

    it('throws when working directory does not exist', () => {
      vi.mocked(existsSync).mockReturnValue(false);

      expect(() => createRepoContext({ repoId: validRepoId, cwd: '/nonexistent' })).toThrow(
        'Working directory does not exist',
      );
    });

    it('throws when working directory has no .git', () => {
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const path = String(p);
        return !path.endsWith('.git');
      });
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => true } as ReturnType<typeof statSync>);

      expect(() => createRepoContext({ repoId: validRepoId, cwd: '/tmp/repo' })).toThrow(
        'not a git repository',
      );
    });

    it('throws when git remote does not match', () => {
      vi.mocked(execSync).mockReturnValue('https://github.com/other/project.git\n');

      expect(() => createRepoContext({ repoId: validRepoId, cwd: '/tmp/repo' })).toThrow(
        'Git remote does not match',
      );
    });
  });

  describe('immutability', () => {
    it('returns a frozen object', () => {
      const ctx = createRepoContext({ repoId: validRepoId, cwd: '/tmp/repo' });

      expect(Object.isFrozen(ctx)).toBe(true);
    });

    it('prevents property assignment', () => {
      const ctx = createRepoContext({ repoId: validRepoId, cwd: '/tmp/repo' });

      expect(() => {
        (ctx as Record<string, unknown>).cwd = '/other';
      }).toThrow();
    });

    it('prevents adding new properties', () => {
      const ctx = createRepoContext({ repoId: validRepoId, cwd: '/tmp/repo' });

      expect(() => {
        (ctx as Record<string, unknown>).extra = 'value';
      }).toThrow();
    });

    it('prevents reassigning repoId', () => {
      const ctx = createRepoContext({ repoId: validRepoId, cwd: '/tmp/repo' });

      expect(() => {
        (ctx as Record<string, unknown>).repoId = { owner: 'x', repo: 'y', platform: Platform.GitHub };
      }).toThrow();
    });
  });

  describe('provider config from .adw/providers.md', () => {
    it('reads config when no platform overrides are provided', () => {
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const path = String(p);
        if (path.endsWith('.git')) return true;
        if (path.endsWith('providers.md')) return true;
        return true;
      });
      vi.mocked(readFileSync).mockReturnValue(
        '## Code Host\ngithub\n\n## Issue Tracker\ngithub\n',
      );

      const ctx = createRepoContext({ repoId: validRepoId, cwd: '/tmp/repo' });

      expect(ctx.issueTracker).toBe(mockIssueTracker);
      expect(ctx.codeHost).toBe(mockCodeHost);
    });

    it('falls back to GitHub when providers.md is absent', () => {
      const ctx = createRepoContext({ repoId: validRepoId, cwd: '/tmp/repo' });

      expect(createGitHubIssueTracker).toHaveBeenCalledWith(validRepoId);
      expect(createGitHubCodeHost).toHaveBeenCalledWith(validRepoId);
      expect(ctx.issueTracker).toBe(mockIssueTracker);
    });
  });

  describe('platform option overrides', () => {
    it('codeHostPlatform option overrides config file', () => {
      vi.mocked(existsSync).mockImplementation((p: unknown) => {
        const path = String(p);
        if (path.endsWith('.git')) return true;
        if (path.endsWith('providers.md')) return true;
        return true;
      });
      vi.mocked(readFileSync).mockReturnValue(
        '## Code Host\ngithub\n\n## Issue Tracker\ngithub\n',
      );

      createRepoContext({
        repoId: validRepoId,
        cwd: '/tmp/repo',
        codeHostPlatform: Platform.GitHub,
      });

      expect(createGitHubCodeHost).toHaveBeenCalledWith(validRepoId);
    });

    it('issueTrackerPlatform option overrides config file', () => {
      createRepoContext({
        repoId: validRepoId,
        cwd: '/tmp/repo',
        issueTrackerPlatform: Platform.GitHub,
      });

      expect(createGitHubIssueTracker).toHaveBeenCalledWith(validRepoId);
    });

    it('skips config file loading when both overrides are provided', () => {
      createRepoContext({
        repoId: validRepoId,
        cwd: '/tmp/repo',
        codeHostPlatform: Platform.GitHub,
        issueTrackerPlatform: Platform.GitHub,
      });

      // readFileSync should not be called for providers.md since both overrides provided
      expect(readFileSync).not.toHaveBeenCalled();
    });

    it('throws for unsupported issue tracker platform override', () => {
      expect(() =>
        createRepoContext({
          repoId: validRepoId,
          cwd: '/tmp/repo',
          issueTrackerPlatform: Platform.GitLab,
          codeHostPlatform: Platform.GitHub,
        }),
      ).toThrow('Unsupported issue tracker platform: gitlab');
    });

    it('resolves GitLab code host when codeHostPlatform is GitLab', () => {
      vi.mocked(createGitLabCodeHost).mockReturnValue(mockCodeHost);

      const ctx = createRepoContext({
        repoId: validRepoId,
        cwd: '/tmp/repo',
        codeHostPlatform: Platform.GitLab,
        issueTrackerPlatform: Platform.GitHub,
      });

      expect(createGitLabCodeHost).toHaveBeenCalledWith(validRepoId);
      expect(ctx.codeHost).toBe(mockCodeHost);
    });
  });

  describe('providersConfig option', () => {
    it('accepts ProvidersConfig and uses it for platform resolution', () => {
      const ctx = createRepoContext({
        repoId: validRepoId,
        cwd: '/tmp/repo',
        providersConfig: { codeHost: 'github', issueTracker: 'github' },
      });

      expect(ctx.issueTracker).toBe(mockIssueTracker);
      expect(ctx.codeHost).toBe(mockCodeHost);
    });

    it('skips file read when providersConfig is provided', () => {
      createRepoContext({
        repoId: validRepoId,
        cwd: '/tmp/repo',
        providersConfig: { codeHost: 'github', issueTracker: 'github' },
      });

      expect(readFileSync).not.toHaveBeenCalled();
    });

    it('throws on unknown platform string in providersConfig', () => {
      expect(() =>
        createRepoContext({
          repoId: validRepoId,
          cwd: '/tmp/repo',
          providersConfig: { codeHost: 'unknown', issueTracker: 'github' },
        }),
      ).toThrow('Unknown platform "unknown"');
    });

    it('platform overrides take precedence over providersConfig', () => {
      createRepoContext({
        repoId: validRepoId,
        cwd: '/tmp/repo',
        codeHostPlatform: Platform.GitHub,
        issueTrackerPlatform: Platform.GitHub,
        providersConfig: { codeHost: 'gitlab', issueTracker: 'gitlab' },
      });

      // Should not throw even though providersConfig has gitlab
      expect(createGitHubCodeHost).toHaveBeenCalledWith(validRepoId);
      expect(createGitHubIssueTracker).toHaveBeenCalledWith(validRepoId);
    });
  });

  describe('git remote parsing edge cases', () => {
    it('matches HTTPS remote with .git suffix', () => {
      vi.mocked(execSync).mockReturnValue('https://github.com/acme/widgets.git\n');

      const ctx = createRepoContext({ repoId: validRepoId, cwd: '/tmp/repo' });

      expect(ctx.repoId).toEqual(validRepoId);
    });

    it('matches SSH remote', () => {
      vi.mocked(execSync).mockReturnValue('git@github.com:acme/widgets.git\n');

      const ctx = createRepoContext({ repoId: validRepoId, cwd: '/tmp/repo' });

      expect(ctx.repoId).toEqual(validRepoId);
    });

    it('matches HTTPS remote without .git suffix', () => {
      vi.mocked(execSync).mockReturnValue('https://github.com/acme/widgets\n');

      const ctx = createRepoContext({ repoId: validRepoId, cwd: '/tmp/repo' });

      expect(ctx.repoId).toEqual(validRepoId);
    });

    it('case-insensitive owner/repo comparison', () => {
      vi.mocked(execSync).mockReturnValue('https://github.com/ACME/WIDGETS.git\n');

      const ctx = createRepoContext({ repoId: validRepoId, cwd: '/tmp/repo' });

      expect(ctx.repoId).toEqual(validRepoId);
    });

    it('throws descriptive error when git remote command fails', () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('fatal: No such remote');
      });

      expect(() =>
        createRepoContext({ repoId: validRepoId, cwd: '/tmp/repo' }),
      ).toThrow("Ensure the repository has an 'origin' remote configured");
    });
  });
});

describe('parseOwnerRepoFromUrl', () => {
  it('parses GitHub HTTPS URL', () => {
    const result = parseOwnerRepoFromUrl('https://github.com/acme/widgets.git');

    expect(result).toEqual({ owner: 'acme', repo: 'widgets' });
  });

  it('parses GitHub SSH URL', () => {
    const result = parseOwnerRepoFromUrl('git@github.com:acme/widgets.git');

    expect(result).toEqual({ owner: 'acme', repo: 'widgets' });
  });

  it('parses GitLab HTTPS URL', () => {
    const result = parseOwnerRepoFromUrl('https://gitlab.com/acme/widgets.git');

    expect(result).toEqual({ owner: 'acme', repo: 'widgets' });
  });

  it('parses GitLab SSH URL', () => {
    const result = parseOwnerRepoFromUrl('git@gitlab.com:acme/widgets.git');

    expect(result).toEqual({ owner: 'acme', repo: 'widgets' });
  });

  it('parses self-hosted GitLab HTTPS URL', () => {
    const result = parseOwnerRepoFromUrl('https://gitlab.example.com/team/project.git');

    expect(result).toEqual({ owner: 'team', repo: 'project' });
  });

  it('parses self-hosted GitLab SSH URL', () => {
    const result = parseOwnerRepoFromUrl('git@gitlab.example.com:team/project.git');

    expect(result).toEqual({ owner: 'team', repo: 'project' });
  });

  it('parses URL without .git suffix', () => {
    const result = parseOwnerRepoFromUrl('https://github.com/acme/widgets');

    expect(result).toEqual({ owner: 'acme', repo: 'widgets' });
  });

  it('returns null for unparseable URL', () => {
    const result = parseOwnerRepoFromUrl('ftp://example.com/repo');

    expect(result).toBeNull();
  });

  it('returns null for URL with only one path segment', () => {
    const result = parseOwnerRepoFromUrl('https://example.com/only-one');

    expect(result).toBeNull();
  });
});
