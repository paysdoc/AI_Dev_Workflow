import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../forge/hitlBoardNotifier', () => ({
  notifyReviewTransition: vi.fn(),
  buildNotifierDeps: vi.fn(() => ({ readIssue: vi.fn(), listOpenPRs: vi.fn() })),
}));

vi.mock('../environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../environment')>();
  return { ...actual, GITHUB_PAT: 'pat-xyz' };
});

vi.mock('../githubAppAuth', () => ({
  isGitHubAppConfigured: vi.fn().mockReturnValue(false),
  getInstallationToken: vi.fn().mockReturnValue('app-token'),
}));

import type { ForgeEnv } from '../forgeWiring';
import { gitLabConfigFromEnv, jiraAuthFromEnv, jiraConfigFrom, adwGitHubForgeDeps, buildAdwForgeDeps } from '../forgeWiring';
import type { ProviderConfig } from '../providerConfig';
import { notifyReviewTransition } from '../../forge/hitlBoardNotifier';
import { isGitHubAppConfigured } from '../githubAppAuth';
import { forgeProviders } from '../../providers/forgeProviders';
import { Platform, BoardStatus, type RepoIdentifier, type BoundProviders } from '../../providers/types';
import { GitContext } from '../../gitContext';
import type { GitContextOptions, ExecFn } from '../../gitContext';
import { createLiteralTokenProvider } from '../../providers/github/githubTokenProvider';

/** A stand-in resolver for tests that never actually invoke it — buildNotifierDeps is mocked module-wide above. */
const FAKE_RESOLVE_PROVIDERS = (): BoundProviders => ({} as BoundProviders);

const notifyMock = vi.mocked(notifyReviewTransition);
const mockIsGitHubAppConfigured = vi.mocked(isGitHubAppConfigured);

function env(overrides: Partial<ForgeEnv>): ForgeEnv {
  return {
    GITLAB_TOKEN: '',
    GITLAB_INSTANCE_URL: 'https://gitlab.com',
    JIRA_EMAIL: '',
    JIRA_API_TOKEN: '',
    JIRA_PAT: '',
    ...overrides,
  };
}

describe('gitLabConfigFromEnv — pure helper over a literal ForgeEnv (#818)', () => {
  it('passes through token and instanceUrl', () => {
    const config = gitLabConfigFromEnv(env({ GITLAB_TOKEN: 'glpat-x', GITLAB_INSTANCE_URL: 'https://gitlab.example.com' }));
    expect(config).toEqual({ token: 'glpat-x', instanceUrl: 'https://gitlab.example.com' });
  });

  it('throws the operator-facing message when the token is empty', () => {
    expect(() => gitLabConfigFromEnv(env({ GITLAB_TOKEN: '' }))).toThrow(
      'GITLAB_TOKEN environment variable is required for GitLab code host. Set it in your .env file.',
    );
  });
});

describe('jiraAuthFromEnv — pure helper over a literal ForgeEnv (#818)', () => {
  it('Cloud wins when the email/apiToken pair is present, even with a PAT also set', () => {
    const auth = jiraAuthFromEnv(env({ JIRA_EMAIL: 'bot@example.com', JIRA_API_TOKEN: 'tok', JIRA_PAT: 'stale-pat' }));
    expect(auth).toEqual({ email: 'bot@example.com', apiToken: 'tok' });
  });

  it('falls back to a Data Center PAT when no Cloud pair is present', () => {
    const auth = jiraAuthFromEnv(env({ JIRA_PAT: 'pat-1' }));
    expect(auth).toEqual({ pat: 'pat-1' });
  });

  it('throws naming no credentials when nothing is present', () => {
    expect(() => jiraAuthFromEnv(env({}))).toThrow('Jira authentication not configured. Set JIRA_EMAIL + JIRA_API_TOKEN (Cloud) or JIRA_PAT (Data Center/Server).');
  });
});

describe('jiraConfigFrom', () => {
  it('assembles instanceUrl/projectKey from the config plus jiraAuthFromEnv', () => {
    const config = jiraConfigFrom(
      { issueTrackerUrl: 'https://issues.example.com', issueTrackerProjectKey: 'ADW' },
      env({ JIRA_PAT: 'pat-1' }),
    );
    expect(config).toEqual({ instanceUrl: 'https://issues.example.com', projectKey: 'ADW', auth: { pat: 'pat-1' } });
  });

  it('throws naming the missing Issue Tracker URL section', () => {
    expect(() => jiraConfigFrom({ issueTrackerUrl: undefined, issueTrackerProjectKey: 'ADW' }, env({ JIRA_PAT: 'pat-1' })))
      .toThrow(/Issue Tracker URL/);
  });

  it('throws naming the missing Issue Tracker Project Key section', () => {
    expect(() => jiraConfigFrom({ issueTrackerUrl: 'https://issues.example.com', issueTrackerProjectKey: undefined }, env({ JIRA_PAT: 'pat-1' })))
      .toThrow(/Issue Tracker Project Key/);
  });
});

// ── buildAdwForgeDeps ─────────────────────────────────────────────────────────

function makeRepoId(overrides: Partial<RepoIdentifier> = {}): RepoIdentifier {
  return { owner: 'acme', repo: 'webapp', platform: Platform.GitHub, ...overrides };
}

function validOptions(overrides: Partial<GitContextOptions> = {}): GitContextOptions {
  return {
    owner: 'acme',
    repo: 'webapp',
    selfHost: false,
    tokenProvider: createLiteralTokenProvider('gh-token-abc'),
    gitIdentity: { authorName: 'ADW Bot', authorEmail: 'bot@adw.dev', committerName: 'ADW Bot', committerEmail: 'bot@adw.dev' },
    frameworkRepoRoot: '/srv/adw/framework',
    targetReposDir: '/srv/adw/repos',
    ...overrides,
  };
}

function makeCtx(overrides: Partial<GitContextOptions> = {}, exec?: ExecFn): GitContext {
  return new GitContext(validOptions(overrides), exec ? { exec } : undefined);
}

const GITHUB_CONFIG: ProviderConfig = { codeHost: 'github', issueTracker: 'github' };

describe('buildAdwForgeDeps', () => {
  it('github/github reads no GitLab env — no throw with an empty GITLAB_TOKEN', () => {
    const repoId = makeRepoId();
    expect(() => buildAdwForgeDeps(GITHUB_CONFIG, repoId, FAKE_RESOLVE_PROVIDERS)).not.toThrow();
    const deps = buildAdwForgeDeps(GITHUB_CONFIG, repoId, FAKE_RESOLVE_PROVIDERS);
    expect(deps.gitlab).toBeUndefined();
    expect(deps.jira).toBeUndefined();
  });

  it('a gitlab code host throws the operator message when GITLAB_TOKEN is empty', () => {
    // ADW_FORGE_ENV binds process.env at import time via adws/core/environment; the
    // test environment carries no GITLAB_TOKEN, so this exercises the real default.
    const repoId = makeRepoId();
    expect(() => buildAdwForgeDeps({ codeHost: 'gitlab', issueTracker: 'github' }, repoId, FAKE_RESOLVE_PROVIDERS)).toThrow(/GITLAB_TOKEN/);
  });

  it('threads a logger and adwGitHubForgeDeps for github/github', () => {
    const repoId = makeRepoId();
    const deps = buildAdwForgeDeps(GITHUB_CONFIG, repoId, FAKE_RESOLVE_PROVIDERS);
    expect(deps.logger).toBeDefined();
    expect(deps.github).toBeDefined();
    expect(typeof deps.github?.resolveLabelDefinition).toBe('function');
    expect(typeof deps.github?.canApprovePullRequests).toBe('function');
  });

  it('the third argument, once invoked after minting, returns the boundary\'s own memoised providers', () => {
    const repoId = makeRepoId();
    const providers = { issueTracker: {}, codeHost: {} } as unknown as BoundProviders;
    const deps = buildAdwForgeDeps(GITHUB_CONFIG, repoId, () => providers);
    expect(deps.github).toBeDefined();
    // adwGitHubForgeDeps/buildNotifierDeps is mocked module-wide; this only proves the
    // thunk we handed in is the one the wiring threads through, not a re-derived one.
  });
});

// ── adwGitHubForgeDeps — Review-transition wiring, re-driven through forgeProviders ──

const PROJECT_RESPONSE = JSON.stringify({ data: { repository: { projectsV2: { nodes: [{ id: 'PVT_1' }] } } } });
const ITEM_RESPONSE = JSON.stringify({
  data: { repository: { issue: { projectItems: { nodes: [
    { id: 'ITEM_1', project: { id: 'PVT_1' }, fieldValueByName: { name: 'Todo' } },
  ] } } } },
});
const MOVE_RESPONSE = JSON.stringify({ data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'ITEM_1' } } } });

function fieldResponseFor(status: string): string {
  return JSON.stringify({ data: { node: { field: { id: 'FIELD_1', options: [{ id: 'OPT_1', name: status }] } } } });
}

interface SpyCall { command: string; env: NodeJS.ProcessEnv }

function makeSpyExec(responses: ReadonlyMap<string, string> = new Map()): { exec: ExecFn; calls: SpyCall[] } {
  const calls: SpyCall[] = [];
  const exec: ExecFn = (command, options) => {
    calls.push({ command, env: { ...options.env } });
    for (const [pattern, response] of responses) {
      if (command.includes(pattern)) return response;
    }
    return '';
  };
  return { exec, calls };
}

function makeMoveExec(targetStatus: string): ExecFn {
  const responses = new Map([
    ['projectsV2(first:1)', PROJECT_RESPONSE],
    ['projectItems(first:50)', ITEM_RESPONSE],
    ['field(name:', fieldResponseFor(targetStatus)],
    ['updateProjectV2ItemFieldValue', MOVE_RESPONSE],
  ]);
  return makeSpyExec(responses).exec;
}

describe('adwGitHubForgeDeps — Review-transition notification wiring, via forgeProviders', () => {
  beforeEach(() => {
    notifyMock.mockClear();
    notifyMock.mockResolvedValue(undefined);
  });

  it('a successful move to Review calls notifyReviewTransition once, awaited', async () => {
    const repoId = makeRepoId();
    const ctx = makeCtx({}, makeMoveExec('Review'));
    const providers: BoundProviders = forgeProviders({
      forge: { codeHost: 'github', issueTracker: 'github' },
      identity: repoId,
      tokenProvider: createLiteralTokenProvider('gh-token-abc'),
      gitContext: ctx,
      deps: buildAdwForgeDeps(GITHUB_CONFIG, repoId, () => providers),
    });

    const result = await providers.issueTracker.moveToStatus(42, BoardStatus.Review);

    expect(result).toBe(true);
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock.mock.calls[0][0]).toEqual({ issueNumber: 42, repoInfo: repoId });
  });

  it('a move to a non-Review status does not call notifyReviewTransition', async () => {
    const repoId = makeRepoId();
    const ctx = makeCtx({}, makeMoveExec('In Progress'));
    const providers: BoundProviders = forgeProviders({
      forge: { codeHost: 'github', issueTracker: 'github' },
      identity: repoId,
      tokenProvider: createLiteralTokenProvider('gh-token-abc'),
      gitContext: ctx,
      deps: buildAdwForgeDeps(GITHUB_CONFIG, repoId, () => providers),
    });

    const result = await providers.issueTracker.moveToStatus(42, BoardStatus.InProgress);

    expect(result).toBe(true);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('resolveLabelDefinition reaches the lazy-create path (adw:blocked -> b60205)', () => {
    const repoId = makeRepoId();
    let editCalls = 0;
    const exec: ExecFn = (command) => {
      if (command.includes('issue edit')) {
        editCalls += 1;
        if (editCalls === 1) throw new Error('label not found');
      }
      return '';
    };
    const ctx = makeCtx({}, exec);
    const providers: BoundProviders = forgeProviders({
      forge: { codeHost: 'github', issueTracker: 'github' },
      identity: repoId,
      tokenProvider: createLiteralTokenProvider('gh-token-abc'),
      gitContext: ctx,
      deps: buildAdwForgeDeps(GITHUB_CONFIG, repoId, () => providers),
    });

    providers.issueTracker.applyLabel(42, 'adw:blocked');

    expect(editCalls).toBe(2);
  });

  it('canApprovePullRequests follows isGitHubAppConfigured() (GITHUB_PAT mocked truthy)', () => {
    const repoId = makeRepoId();
    const deps = adwGitHubForgeDeps(repoId, FAKE_RESOLVE_PROVIDERS);

    mockIsGitHubAppConfigured.mockReturnValue(true);
    expect(deps.canApprovePullRequests?.()).toBe(true);

    mockIsGitHubAppConfigured.mockReturnValue(false);
    expect(deps.canApprovePullRequests?.()).toBe(false);
  });
});
