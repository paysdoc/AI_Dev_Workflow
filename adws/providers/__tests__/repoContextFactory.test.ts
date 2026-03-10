import { describe, it, expect, vi } from 'vitest';
import { createRepoContextFromConfig } from '../repoContextFactory';
import { getDefaultProvidersConfig } from '../../core/projectConfig';
import { Platform } from '../types';
import type { RepoIdentifier } from '../types';
import type { ProvidersConfig } from '../../core/projectConfig';

// Mock provider factory functions to avoid real API calls
vi.mock('../github/githubIssueTracker', () => ({
  createGitHubIssueTracker: vi.fn(() => ({ _type: 'github-issue-tracker' })),
}));

vi.mock('../github/githubCodeHost', () => ({
  createGitHubCodeHost: vi.fn(() => ({ _type: 'github-code-host' })),
}));

vi.mock('../jira/jiraIssueTracker', () => ({
  createJiraIssueTracker: vi.fn(() => ({ _type: 'jira-issue-tracker' })),
}));

const defaultRepoId: RepoIdentifier = {
  owner: 'testowner',
  repo: 'testrepo',
  platform: Platform.GitHub,
};

const defaultCwd = '/tmp/test-repo';

// ---------------------------------------------------------------------------
// createRepoContextFromConfig — github defaults
// ---------------------------------------------------------------------------

describe('createRepoContextFromConfig — github defaults', () => {
  it('creates context with github issue tracker and code host', () => {
    const config = getDefaultProvidersConfig();
    const ctx = createRepoContextFromConfig(config, defaultRepoId, defaultCwd);

    expect(ctx.issueTracker).toBeDefined();
    expect(ctx.codeHost).toBeDefined();
    expect(ctx.cwd).toBe(defaultCwd);
    expect(ctx.repoId).toBe(defaultRepoId);
  });
});

// ---------------------------------------------------------------------------
// createRepoContextFromConfig — jira issue tracker
// ---------------------------------------------------------------------------

describe('createRepoContextFromConfig — jira issue tracker', () => {
  it('creates context with jira issue tracker and github code host', () => {
    const config: ProvidersConfig = {
      codeHost: 'github',
      codeHostUrl: 'https://github.com',
      issueTracker: 'jira',
      issueTrackerUrl: 'https://jira.example.com',
      issueTrackerProjectKey: 'PROJ',
    };

    const ctx = createRepoContextFromConfig(config, defaultRepoId, defaultCwd);

    expect(ctx.issueTracker).toBeDefined();
    expect(ctx.codeHost).toBeDefined();
    expect(ctx.cwd).toBe(defaultCwd);
  });

  it('throws when jira is selected but issueTrackerUrl is missing', () => {
    const config: ProvidersConfig = {
      codeHost: 'github',
      codeHostUrl: '',
      issueTracker: 'jira',
      issueTrackerUrl: '',
      issueTrackerProjectKey: 'PROJ',
    };

    expect(() => createRepoContextFromConfig(config, defaultRepoId, defaultCwd)).toThrow(
      'Jira issue tracker requires "Issue Tracker URL"',
    );
  });

  it('throws when jira is selected but issueTrackerProjectKey is missing', () => {
    const config: ProvidersConfig = {
      codeHost: 'github',
      codeHostUrl: '',
      issueTracker: 'jira',
      issueTrackerUrl: 'https://jira.example.com',
      issueTrackerProjectKey: '',
    };

    expect(() => createRepoContextFromConfig(config, defaultRepoId, defaultCwd)).toThrow(
      'Jira issue tracker requires "Issue Tracker Project Key"',
    );
  });
});

// ---------------------------------------------------------------------------
// createRepoContextFromConfig — unsupported providers
// ---------------------------------------------------------------------------

describe('createRepoContextFromConfig — unsupported providers', () => {
  it('throws for unsupported issue tracker', () => {
    const config: ProvidersConfig = {
      codeHost: 'github',
      codeHostUrl: '',
      issueTracker: 'linear',
      issueTrackerUrl: '',
      issueTrackerProjectKey: '',
    };

    expect(() => createRepoContextFromConfig(config, defaultRepoId, defaultCwd)).toThrow(
      'Unsupported issue tracker provider: "linear"',
    );
  });

  it('throws for unsupported code host', () => {
    const config: ProvidersConfig = {
      codeHost: 'gitlab',
      codeHostUrl: '',
      issueTracker: 'github',
      issueTrackerUrl: '',
      issueTrackerProjectKey: '',
    };

    expect(() => createRepoContextFromConfig(config, defaultRepoId, defaultCwd)).toThrow(
      'Unsupported code host provider: "gitlab"',
    );
  });
});
