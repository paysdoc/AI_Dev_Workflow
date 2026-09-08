/**
 * forgeEnvWiring.test.ts — ADW's environment→config wiring for the GitLab and
 * Jira adapters (#818): `gitLabConfigFromEnv`/`jiraAuthFromEnv` over literal
 * `ForgeEnv` values, plus the first positive GitLab mint through
 * `mintBoundProviders` under a partial environment mock.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ForgeEnv } from '../repoContext';
import { gitLabConfigFromEnv, jiraAuthFromEnv } from '../repoContext';

vi.mock('../../core/environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/environment')>();
  return {
    ...actual,
    GITLAB_TOKEN: 'glpat-test',
  };
});

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

describe('mintBoundProviders — the first positive GitLab mint (#818)', () => {
  it('mints a working GitLab code host from the (mocked) environment, with boardManager undefined', async () => {
    const { mintBoundProviders } = await import('../repoContext');
    const { Platform } = await import('../types');
    const repoId = { owner: 'acme', repo: 'widget', platform: Platform.GitLab };

    const providers = mintBoundProviders({
      repoId,
      codeHostPlatform: Platform.GitLab,
      issueTrackerPlatform: Platform.GitHub,
    });

    expect(providers.codeHost.getRepoIdentifier()).toEqual(repoId);
    expect(providers.issueTracker).toBeDefined();
    expect(providers.boardManager).toBeUndefined();
  });
});
